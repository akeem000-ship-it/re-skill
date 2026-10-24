// Bank 0 palettes and far-access helpers: the palette shadows (wBGPalettes/wOBJPalettes, the copies the hardware
// gets in VBlank, and wMasterPalettes, the undimmed copy fades work from), loading them into the CGB palette
// RAM, reading and copying across ROM banks, the jump-table dispatch, and the OAM DMA stub.
// Port of palettes_00.asm (00:05E1-00:090C), LoadPaletteShadow/LoadPalettesImmediate (00:05B0, memory_00.asm)
// and LoadBGPaletteData/LoadOBJPaletteData (00:027F/0287, vectors_00.asm); names and addresses from the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm).
// Covered by the routine tests (web/tests/port/routines_home_gfx.mjs) and the lockstep on out/engine/*.mtrec.
import { FZ, FN, FH, FC, rROMB0, pushWord, dropWords, switchRomBank, byte, setRegs, cpFlags, copyMemoryBC, copyMemoryFast, clearMemory16,
  queueVRAMCopy, startVRAMDMAFromHL } from "./memory.js";
import { decompressData } from "./decompress.js";

const rBGPI = 0xFF68, rBGPD = 0xFF69, rOBPI = 0xFF6A, rOBPD = 0xFF6B;
const AUTO_INCREMENT = 0x80;                                // palette index register: step after each data write
const wBGPalettes = 0xC100, wOBJPalettes = 0xC140, wMasterPalettes = 0xC200;
const PALETTES_SIZE = 0x40;                                 // 8 palettes x 4 colors x 2 bytes
const BG_DIRTY = 1, OBJ_DIRTY = 2;                          // hPaletteDirtyFlags bits
const SLOT_TABLE = 0x4000;                                  // every bank's export/asset table of words

// ---- the palette shadows ----
// LoadBGPaletteData (00:027F) / LoadOBJPaletteData (00:0287): the 64 bytes at hl into the CGB palette RAM
// through the auto-incrementing index port. Returns the registers they leave (carry kept).
function loadPaletteData(P, indexPort, hl, carry) {
  const { bus } = P;
  bus.w8(indexPort, AUTO_INCREMENT);
  let a = 0;
  for (let i = 0; i < PALETTES_SIZE; i++) { a = bus.u8(hl); bus.w8(indexPort + 1, a); hl = (hl + 1) & 0xFFFF; }
  return { a, b: 0, c: (indexPort + 1) & 0xFF, hl, f: FZ | FN | carry };
}
export const loadBGPaletteData = (P, hl, carry = 0) => loadPaletteData(P, rBGPI, hl, carry);
export const loadOBJPaletteData = (P, hl, carry = 0) => loadPaletteData(P, rOBPI, hl, carry);

// LoadPalettesImmediate (00:05B5): e palettes (4 colors each) from hl into the shadows from palette d (0-7 BG,
// 8-15 OBJ), into both the live copy (wBGPalettes/wOBJPalettes) and wMasterPalettes, and mark them for VBlank:
// BG when d < 8, OBJ when d + e > 8. Offsets wrap in their 256-byte page as in the ROM.
// Returns the registers it leaves.
export function loadPalettesImmediate(P, hl, d, e) {
  const { bus } = P;
  let off = (d * 8) & 0xFF;
  for (let n = ((e * 4) & 0xFF) || 0x100; n > 0; n--) {    // one color (2 bytes) each
    const lo = bus.u8(hl);
    bus.w8(wBGPalettes | off, lo); bus.w8(wMasterPalettes | off, lo);
    off = (off + 1) & 0xFF;
    const hi = bus.u8(hl + 1);
    bus.w8(wMasterPalettes | off, hi); bus.w8(wBGPalettes | off, hi);
    off = (off + 1) & 0xFF;
    hl = (hl + 2) & 0xFFFF;
  }
  const dirty = P.A.paletteDirtyFlags;
  if (!(d & 8)) bus.w8(dirty, bus.u8(dirty) | BG_DIRTY);
  const end = (e + d) & 0xFF;
  if (end >= 9) bus.w8(dirty, bus.u8(dirty) | OBJ_DIRTY);
  return { a: end, c: 0, hl: dirty, f: cpFlags(end, 9) };
}
// LoadPalettesMasterOnly (00:05E1): the same into wMasterPalettes alone (what a fade-in will bring up).
export function loadPalettesMasterOnly(P, hl, d, e) {
  const { bus } = P;
  let off = (d * 8) & 0xFF, a = 0;
  for (let n = ((e * 8) & 0xFF) || 0x100; n > 0; n--) {
    a = bus.u8(hl); bus.w8(wMasterPalettes | off, a);
    off = (off + 1) & 0xFF; hl = (hl + 1) & 0xFFFF;
  }
  return { a, c: 0, d: wMasterPalettes >> 8, e: off, hl, f: FZ | FN | (d & 0x20 ? FC : 0) };
}
// LoadPaletteShadow (00:05B0): load palettes as LoadPalettesImmediate, or only into the master copy while the
// screen is faded out (the fade-in brings them up).
export function loadPaletteShadow(P, hl, d, e) {
  return byte(P, "fadedOut") ? loadPalettesMasterOnly(P, hl, d, e) : loadPalettesImmediate(P, hl, d, e);
}
// RestorePalettesFromMaster (00:05F4): undo a fade: the master copy back into the live shadows, both marked.
export function restorePalettesFromMaster(P) {
  copyMemoryFast(P, wMasterPalettes, wBGPalettes, 2 * PALETTES_SIZE / 16);
  P.V.paletteDirtyFlags = BG_DIRTY | OBJ_DIRTY;
}
// ApplyPendingPaletteUpdates (00:060D), in VBlank: load the shadows marked in hPaletteDirtyFlags into the
// palette RAM, then clear the marks. Returns the registers it leaves.
export function applyPendingPaletteUpdates(P) {
  let r = {};
  if (P.V.paletteDirtyFlags & BG_DIRTY) r = loadBGPaletteData(P, wBGPalettes);
  if (P.V.paletteDirtyFlags & OBJ_DIRTY) r = loadOBJPaletteData(P, wOBJPalettes);
  P.V.paletteDirtyFlags = 0;
  return { ...r, a: 0, f: FZ };
}

// ---- reading across ROM banks ----
// FarReadByte (00:0628): the byte at hl with ROM bank a mapped.
export function farReadByte(P, bank, hl) {
  const old = P.V.romBank;
  switchRomBank(P, bank);
  const v = P.bus.u8(hl);
  switchRomBank(P, old);
  return v;
}
// FarReadWord (00:063D): the word at hl with ROM bank a mapped (returned in bc; a = the bank restored).
export function farReadWord(P, bank, hl) {
  const old = P.V.romBank;
  switchRomBank(P, bank);
  const v = P.bus.u16(hl);
  switchRomBank(P, old);
  return v;
}
// FarReadWordDI (00:0652): the same with interrupts off, switching the MBC only (hRomBank stays), then ei.
export function farReadWordDI(P, bank, hl) {
  P.di();
  P.bus.w8(rROMB0, bank);
  const v = P.bus.u16(hl);
  P.bus.w8(rROMB0, P.V.romBank);
  P.ei();
  return v;
}
// Read entry `slot` (a byte offset) of bank's $4000 table, with the bank mapped as the ROM does.
function slotEntry(P, bank, slot) { switchRomBank(P, bank); return P.bus.u16(SLOT_TABLE | slot); }
// Entry `index` of the word table that bank's slot points to (the index doubled as a byte: it wraps at 128).
function indexedEntry(P, bank, slot, index) { return P.bus.u16((slotEntry(P, bank, slot) + ((index * 2) & 0xFF)) & 0xFFFF); }
// Unused_00_ReadFarVectorEntry (00:0661): entry l of bank h's table. Nothing calls it.
export function readFarVectorEntry(P, bank, slot) {
  const old = P.V.romBank;
  const v = slotEntry(P, bank, slot);
  switchRomBank(P, old);
  return v;
}
// FarCopyBytes (00:067A): CopyMemoryBC with ROM bank a mapped. Returns CopyMemoryBC's { hl, de }.
export function farCopyBytes(P, bank, hl, de, count) {
  const old = P.V.romBank;
  switchRomBank(P, bank);
  const r = copyMemoryBC(P, hl, de, count);
  switchRomBank(P, old);
  return { hl: r.hl, de: r.de, a: old };
}
// Unused_00_FarDecompressData (00:0692): DecompressData with ROM bank a mapped. Returns the length.
export function farDecompressData(P, bank, hl, de) {
  const old = P.V.romBank;
  switchRomBank(P, bank);
  const n = decompressData(P, hl, de);
  switchRomBank(P, old);
  return n;
}

// ---- the OAM DMA stub ----
const OAMDMARoutine = 0x06BA, OAM_DMA_ROUTINE_SIZE = 10;
// CopyOAMDMARoutineToHRAM (00:06AC): copy the 10-byte OAM DMA routine (00:06BA, run from HRAM while the CPU
// can only reach HRAM) to hOAMDMARoutine. Returns the registers it leaves.
export function copyOAMDMARoutineToHRAM(P, carry = 0) {
  let a = 0;
  for (let i = 0; i < OAM_DMA_ROUTINE_SIZE; i++) { a = P.bus.u8(OAMDMARoutine + i); P.bus.w8(P.A.oAMDMARoutine + i, a); }
  return { a, b: 0, c: (P.A.oAMDMARoutine + OAM_DMA_ROUTINE_SIZE) & 0xFF, hl: OAMDMARoutine + OAM_DMA_ROUTINE_SIZE, f: FZ | FN | carry };
}

// ---- jumps ----
// JumpTableDispatch (00:06C4, reached by rst $00): jump to entry a of the word table that follows the rst (its
// return address). As a hook: the entry replaces the return address, so the hook's `ret` jumps there.
// Leaves a = the entry's low byte, hl = the entry, and the flags of the index addition.
function jumpTableDispatch(P, c) {
  const { bus } = P;
  const table = bus.u16(c.sp), index2 = (c.a * 2) & 0xFF, sum = index2 + (table & 0xFF);
  let h = table >> 8;
  let f = ((sum & 0xFF) === 0 ? FZ : 0) | ((index2 & 0x0F) + (table & 0x0F) > 0x0F ? FH : 0) | (sum > 0xFF ? FC : 0);
  if (sum > 0xFF) { h = (h + 1) & 0xFF; f = (h === 0 ? FZ : 0) | ((h & 0x0F) === 0 ? FH : 0) | FC; }   // inc h
  const target = bus.u16(h << 8 | (sum & 0xFF));
  bus.w16(c.sp, target);
  setRegs(c, { a: target & 0xFF, hl: target, f });
}
// JumpToHL (00:06CE): `jp hl`, called as `call JumpToHL` for an indirect call. As a hook: push hl, then ret.
function jumpToHL(P, c) {
  c.sp = (c.sp - 2) & 0xFFFF;
  P.bus.w16(c.sp, c.hl);
}

// ---- indexed far helpers (Unused_00_*: nothing calls them) and FarCallVector ----
// Unused_00_FarDispatchIndexed (00:06CF): decompress entry a of the table at bank h's slot l to de.
export function farDispatchIndexed(P, bank, slot, index, de) {
  const old = P.V.romBank;
  const n = decompressData(P, indexedEntry(P, bank, slot, index), de);
  switchRomBank(P, old);
  return n;
}
// Unused_00_FarCopyIndexed (00:06F7): copy c bytes (0: 256) of entry a of that table to de.
export function farCopyIndexed(P, bank, slot, index, de, count) {
  const old = P.V.romBank;
  copyMemoryBC(P, indexedEntry(P, bank, slot, index), de, count || 0x100);
  switchRomBank(P, old);
}
// Unused_00_FarCallIndexed1/2/3 (00:0726/0752/077E): QueueVRAMCopy, StartVRAMDMAFromHL or CopyMemoryFast from
// entry a of that table to de, c blocks.
export function farCallIndexed(P, which, bank, slot, index, de, blocks) {
  const old = P.V.romBank;
  const src = indexedEntry(P, bank, slot, index);
  if (which === 1) queueVRAMCopy(P, src, de, blocks);
  else if (which === 2) startVRAMDMAFromHL(P, src, de, blocks);
  else copyMemoryFast(P, src, de, blocks);
  switchRomBank(P, old);
}
// FarCallVector (00:07C5): call entry l of bank h's table with that bank mapped (a = the entry's low byte,
// bc and de passed on). The callee may wait for frames (UpdateAllObjSprites does). Returns the callee's bc, de,
// hl; a = the bank restored.
export function* farCallVector(P, bank, slot, bc, de, f = 0) {
  const old = P.V.romBank;
  pushWord(P, old << 8 | f);                                // (push af: the bank to restore)
  const target = slotEntry(P, bank, slot);
  const r = yield* P.runRom(bank, target, { a: target & 0xFF, b: bc >> 8, c: bc & 0xFF, d: de >> 8, e: de & 0xFF, h: target >> 8, l: target & 0xFF });
  dropWords(P, 1);
  switchRomBank(P, old);
  return { a: old, bc: r.bc, de: r.de, hl: r.hl };
}
// Unused_00_FarReadPtrIndexed (00:07AA): entry l of bank h's table, then a jump to CallHLInBankA (00:015E,
// vectors_00.asm) with that bank. Returns the registers for the jump (a = the bank, hl = the entry).
const CallHLInBankA = 0x015E;
export function farReadPtrIndexed(P, bank, slot) {
  const old = P.V.romBank;
  const target = slotEntry(P, bank, slot);
  switchRomBank(P, old);
  return { a: bank, hl: target };
}

// ---- map rows (unused) ----
const TILE_SIZE = 16;
const WRAM_STAGING = 1, WRAM_COURT_PLANES = 2, WRAM_SCREEN = 3;
const wDecompBuffer = 0xD000, wTextBuffer = 0xC600, wMapScrollPlane0 = 0xD000, wMapScrollPlane1 = 0xD800;
const wShadowTilemap = 0xD000, wScreenScratch = 0xD800, WRAMX_END = 0xE000;
// Unused_00_CopyMapRows32To64 (00:07DD): 16 rows of 32 bytes from hl into rows of 64 at de, the right halves
// zeroed. Returns { hl, de } after.
export function copyMapRows32To64(P, hl, de) {
  for (let row = 0; row < 16; row++) {
    for (let i = 0; i < 32; i++) P.bus.w8(de + i, P.bus.u8(hl + i));
    for (let i = 32; i < 64; i++) P.bus.w8(de + i, 0);
    hl = (hl + 32) & 0xFFFF; de = (de + 64) & 0xFFFF;
  }
  return { hl, de };
}
// Unused_00_CopyMapToScrollBuffers (00:086C): spread four 32x16 map quarters from wDecompBuffer (via
// wTextBuffer) into the 64-wide scroll planes, clearing the planes' second halves. Nothing calls it.
export function copyMapToScrollBuffers(P) {
  P.withWramBank(WRAM_STAGING, () => {
    const quarter = (k, wram, dest) => {
      if (k) P.wramBank(WRAM_STAGING);                      // (the first is already mapped)
      copyMemoryFast(P, wDecompBuffer + k * 32 * TILE_SIZE, wTextBuffer, 0x20);
      P.wramBank(wram);
      copyMapRows32To64(P, wTextBuffer, dest);
    };
    quarter(0, WRAM_COURT_PLANES, wMapScrollPlane0);
    quarter(1, WRAM_COURT_PLANES, wMapScrollPlane1);
    clearMemory16(P, wMapScrollPlane1, (WRAMX_END - wMapScrollPlane1) / 16);
    quarter(2, WRAM_SCREEN, wShadowTilemap);
    quarter(3, WRAM_SCREEN, wScreenScratch);
    clearMemory16(P, wScreenScratch, (WRAMX_END - wScreenScratch) / 16);
  });
}

export const HOOKS = [
  [0, 0x027F, (P, c) => setRegs(c, loadBGPaletteData(P, c.hl, c.f & FC))],
  [0, 0x0287, (P, c) => setRegs(c, loadOBJPaletteData(P, c.hl, c.f & FC))],
  [0, 0x05B0, (P, c) => setRegs(c, loadPaletteShadow(P, c.hl, c.d, c.e))],
  [0, 0x05B5, (P, c) => setRegs(c, loadPalettesImmediate(P, c.hl, c.d, c.e))],
  [0, 0x05E1, (P, c) => setRegs(c, loadPalettesMasterOnly(P, c.hl, c.d, c.e))],
  [0, 0x05F4, P => restorePalettesFromMaster(P)],
  [0, 0x060D, (P, c) => setRegs(c, applyPendingPaletteUpdates(P))],
  [0, 0x0628, (P, c) => { c.a = farReadByte(P, c.a, c.hl); }],
  [0, 0x063D, (P, c) => setRegs(c, { a: P.V.romBank, bc: farReadWord(P, c.a, c.hl) })],
  [0, 0x0652, (P, c) => setRegs(c, { bc: farReadWordDI(P, c.a, c.hl), a: P.V.romBank })],
  [0, 0x0661, (P, c) => setRegs(c, { hl: readFarVectorEntry(P, c.h, c.l), a: c.h })],
  [0, 0x067A, (P, c) => setRegs(c, { ...farCopyBytes(P, c.a, c.hl, c.de, c.bc), bc: 0 })],
  [0, 0x0692, (P, c) => { c.hl = farDecompressData(P, c.a, c.hl, c.de); }],
  [0, 0x06AC, (P, c) => setRegs(c, copyOAMDMARoutineToHRAM(P, c.f & FC))],
  [0, 0x06C4, jumpTableDispatch],
  [0, 0x06CE, jumpToHL],
  [0, 0x06CF, (P, c) => { c.hl = farDispatchIndexed(P, c.h, c.l, c.a, c.de); }],
  [0, 0x06F7, (P, c) => farCopyIndexed(P, c.h, c.l, c.a, c.de, c.c)],
  [0, 0x0726, (P, c) => farCallIndexed(P, 1, c.h, c.l, c.a, c.de, c.c)],
  [0, 0x0752, (P, c) => farCallIndexed(P, 2, c.h, c.l, c.a, c.de, c.c)],
  [0, 0x077E, (P, c) => farCallIndexed(P, 3, c.h, c.l, c.a, c.de, c.c)],
  // (jp CallHLInBankA: its address pushed, the hook's ret goes there)
  [0, 0x07AA, (P, c) => { setRegs(c, farReadPtrIndexed(P, c.h, c.l)); pushWord(P, CallHLInBankA); }],
  [0, 0x07C5, function* (P, c) { const f = c.f; setRegs(c, { ...(yield* farCallVector(P, c.h, c.l, c.bc, c.de, f)), f }); }],
  [0, 0x07DD, (P, c) => setRegs(c, { ...copyMapRows32To64(P, c.hl, c.de), a: 0, c: 0, f: FZ | FN })],
  [0, 0x086C, P => copyMapToScrollBuffers(P)],
];
