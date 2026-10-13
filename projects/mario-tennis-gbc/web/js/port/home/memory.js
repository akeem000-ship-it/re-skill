// Bank 0 memory routines: clears and copies, the VRAM copy queue (the game's only way into VRAM), the BG tile
// write queue and the BG row/column blit, both drained in VBlank.
// Port of memory_00.asm (00:03AE-00:05AF) and ProcessBGBlitQueue (00:218D); names and addresses from the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm).
// Also the small helpers the other bank-0 graphics modules share (ROM banking, flags, register write-back).
// Covered by the routine tests (web/tests/port/routines_home_gfx.mjs) and the lockstep on out/engine/*.mtrec.

// ---- shared helpers ----
export const FZ = 0x80, FN = 0x40, FH = 0x20, FC = 0x10;    // the F register's flag bits
export const rROMB0 = 0x2000;                               // MBC5 ROM bank select (low 8 bits)
const rLCDC = 0xFF40, rVBK = 0xFF4F;
const rVDMA_SRC_HIGH = 0xFF51, rVDMA_LEN = 0xFF55;         // CGB VRAM DMA: src hi/lo, dest hi/lo, length/start

// The ROM's bank switch: hRomBank (which the VBlank handler and far calls restore) and then the MBC.
export function switchRomBank(P, bank) {
  P.V.romBank = bank;
  P.bus.w8(rROMB0, bank);
}
// One-byte variables that fields.js sizes by the gap to the next symbol (hFadeCounter, hFadedOut, hMusic,
// hBGColumnBlitDone, wSpriteBufferPage): only their first byte is the variable.
export const byte = (P, name) => P.bus.u8(P.A[name]);
export const setByte = (P, name, v) => P.bus.w8(P.A[name], v);
// Write a routine's results back to the CPU (a hook adapter): any of a b c d e h l f bc de hl.
export function setRegs(cpu, r) {
  for (const k in r) {
    const v = r[k];
    if (v === undefined) continue;
    if (k === "f") cpu.f = v & 0xF0; else cpu[k] = k.length === 2 ? v & 0xFFFF : v & 0xFF;
  }
}
// The CPU stack, for calls into the ROM made at the same stack depth as the ROM's own (what the ROM pushed
// before the call, the frames a far call adds): code the call reaches sees the same sp, and AdvanceFrame is
// reached at the same depth (the lockstep compares sp there).
export function pushWord(P, v) { const c = P.cpu; c.sp = (c.sp - 2) & 0xFFFF; P.bus.w16(c.sp, v); }
export function dropWords(P, n) { const c = P.cpu; c.sp = (c.sp + 2 * n) & 0xFFFF; }
// Flags of `dec r` from r (C is not touched: pass the carry to keep), and of `cp n` with a.
export const decFlags = (v, carry = 0) => (((v - 1) & 0xFF) === 0 ? FZ : 0) | FN | ((v & 0x0F) === 0 ? FH : 0) | carry;
export const cpFlags = (a, n) => (a === n ? FZ : 0) | FN | ((a & 0x0F) < (n & 0x0F) ? FH : 0) | (a < n ? FC : 0);

// ---- clears and copies ----
// ClearMemory16 (00:03AF): zero c blocks of 16 bytes at hl (c = 0: 256 blocks). Returns hl after.
export function clearMemory16(P, hl, blocks) {
  const n = (blocks || 0x100) * 16;
  for (let i = 0; i < n; i++) P.bus.w8(hl + i, 0);
  return (hl + n) & 0xFFFF;
}
// ClearMemoryBC16 (00:03C4): zero bc blocks of 16 bytes at hl. Returns hl after.
export function clearMemoryBC16(P, hl, blocks) {
  const n = (blocks || 0x10000) * 16;
  for (let i = 0; i < n; i++) P.bus.w8(hl + i, 0);
  return (hl + n) & 0xFFFF;
}
// CopyMemoryBC (00:03DB): copy bc bytes from hl to de, forwards byte by byte (bc = 0: 64 KB).
// Returns { hl, de } after and a, the last byte copied.
export function copyMemoryBC(P, hl, de, count) {
  const { bus } = P;
  let a = 0;
  for (let n = count || 0x10000; n > 0; n--) { a = bus.u8(hl); bus.w8(de, a); hl = (hl + 1) & 0xFFFF; de = (de + 1) & 0xFFFF; }
  return { hl, de, a };
}
// Unused_00_CopyMemoryReverseBC (00:03EA): copy bc bytes backwards, from hl down to de down. Nothing calls it.
export function copyMemoryReverseBC(P, hl, de, count) {
  const { bus } = P;
  for (let n = count || 0x10000; n > 0; n--) { bus.w8(de, bus.u8(hl)); hl = (hl - 1) & 0xFFFF; de = (de - 1) & 0xFFFF; }
  return { hl, de };
}
// CopyMemoryFast (00:03F3): copy c blocks of 16 bytes from hl to de (c = 0: 256 blocks). Unrolled in the ROM,
// with a variant for a 16-aligned de that steps e alone inside a block; the bytes written are the same.
export function copyMemoryFast(P, hl, de, blocks) {
  return copyMemoryBC(P, hl, de, (blocks || 0x100) * 16);
}
// Unused_00_FillMemoryCFast (00:0460): fill c bytes at hl with a (c = 0: 256). Returns hl after. Nothing calls it.
export function fillMemoryCFast(P, hl, a, count) {
  for (let n = count || 0x100; n > 0; n--) { P.bus.w8(hl, a); hl = (hl + 1) & 0xFFFF; }
  return hl;
}

// ---- the VRAM copy queue ----
// wVRAMCopyQueue: ten 8-byte slots [ROM bank, WRAM bank, src hi, src lo, VRAM bank, dest hi, dest lo, blocks-1],
// the last five being the CGB VDMA register values. Byte 0 (the ROM bank, never 0) marks a slot in use.
const VRAM_COPY_QUEUE = 0xC0A0, VRAM_COPY_SLOTS = 10, VRAM_COPY_SLOT_SIZE = 8;
const VRAM_BANK1 = 0x2000;                                  // bit 13 of a destination selects VRAM bank 1
// wTileWriteQueue: sixteen 4-byte entries [dest hi, dest lo, tile, attribute]; dest hi (never 0) marks one in use.
const TILE_WRITE_QUEUE = 0xC180, TILE_WRITE_SLOTS = 16;
const SFX_DEBUG_ALARM = 0x6F;
const PlaySoundManaged = 0x3024;                            // the sound request with the id in a (as rst $08)

// StartVRAMDMATransfer (00:18D7, debugtext_00.asm, not hooked here): program the VDMA registers in order;
// the length write starts it (bit 7 clear: a general DMA, done at once).
function startVRAMDMA(P, src, dest, len) {
  const { bus } = P;
  bus.w8(rVDMA_SRC_HIGH, src >> 8); bus.w8(rVDMA_SRC_HIGH + 1, src);
  bus.w8(rVDMA_SRC_HIGH + 2, dest >> 8); bus.w8(rVDMA_SRC_HIGH + 3, dest);
  bus.w8(rVDMA_LEN, len);
}
// StartVRAMDMAFromHL (00:18EB): the same from hl (source), de (destination), c (blocks). Returns its registers
// (the flags of its last `inc l`: all clear but the carry).
export function startVRAMDMAFromHL(P, hl, de, blocks, carry = 0) {
  const len = (blocks - 1) & 0xFF;
  startVRAMDMA(P, hl, de, len);
  return { a: len, b: hl >> 8, c: hl & 0xFF, hl: rVDMA_LEN, f: carry };
}

// ClearVRAMCopyQueue (00:0465): empty all ten slots.
export function clearVRAMCopyQueue(P) { return clearMemory16(P, VRAM_COPY_QUEUE, VRAM_COPY_SLOTS * VRAM_COPY_SLOT_SIZE / 16); }

// QueueVRAMCopy (00:0480): copy c 16-byte blocks from hl to VRAM at de (VRAM bank 1 when de has bit 13 set).
// With the LCD off it runs at once as a general DMA; with it on, the request goes into the first free slot of
// wVRAMCopyQueue for ProcessVRAMCopyQueues to run in VBlank. The source's ROM and WRAM banks are those mapped
// now (hRomBank, hWramBank). hVRAMQueueDirty is cleared while a slot is written, so a VBlank in the middle
// leaves the queue alone; a full queue sets it and, in debug step mode, sounds an alarm.
// Returns the registers it leaves (a = 0 when the queue was full; bc is then the caller's, not returned).
export function queueVRAMCopy(P, src, dest, blocks) {
  const { bus, V } = P;
  const vramBank = dest & VRAM_BANK1 ? 1 : 0, vdest = dest & ~VRAM_BANK1;
  if (!(bus.u8(rLCDC) & 0x80)) {                            // LCD off: VRAM is free, copy now
    bus.w8(rVBK, vramBank);
    return { ...startVRAMDMAFromHL(P, src, vdest, blocks), d: vdest >> 8, e: vdest & 0xFF };
  }
  V.vRAMQueueDirty = 0;
  for (let i = 0; i < VRAM_COPY_SLOTS; i++) {
    const slot = VRAM_COPY_QUEUE + i * VRAM_COPY_SLOT_SIZE;
    if (bus.u8(slot)) continue;
    bus.w8(slot, V.romBank);
    bus.w8(slot + 1, V.wramBank);
    bus.w8(slot + 2, src >> 8); bus.w8(slot + 3, src);
    bus.w8(slot + 4, vramBank);
    bus.w8(slot + 5, vdest >> 8); bus.w8(slot + 6, vdest);
    bus.w8(slot + 7, blocks - 1);
    V.vRAMQueueDirty = 1;
    return { a: 1, b: src >> 8, c: src & 0xFF, d: vdest >> 8, e: vdest & 0xFF, hl: slot + 7, f: decFlags(blocks) };
  }
  V.vRAMQueueDirty = 1;                                     // full: the request is dropped
  if (V.debugStepMode) {                                    // `sound` (rst $08) with the length and hl pushed
    pushWord(P, ((blocks - 1) & 0xFF) << 8 | decFlags(blocks)); pushWord(P, src);
    P.callRom(0, PlaySoundManaged, { a: SFX_DEBUG_ALARM });
    dropWords(P, 2);
  }
  return { a: 0, d: dest >> 8, e: dest & 0xFF, hl: src, f: FZ };
}
// QueueVRAMCopyFromBank (00:046D): QueueVRAMCopy with ROM bank b mapped for the source.
// Returns QueueVRAMCopy's registers, a = the bank restored (the flags are the caller's).
export function queueVRAMCopyFromBank(P, bank, src, dest, blocks) {
  const old = P.V.romBank;
  switchRomBank(P, bank);
  const r = queueVRAMCopy(P, src, dest, blocks);
  switchRomBank(P, old);
  return { ...r, a: old, f: undefined };
}

// QueueBGTileWrite (00:0507): queue one BG map cell for VBlank: tile l and attribute h at VRAM address de.
// Returns the registers it leaves.
export function queueBGTileWrite(P, hl, de) {
  const { bus, V } = P;
  V.vRAMQueueDirty = 0;
  for (let i = 0; i < TILE_WRITE_SLOTS; i++) {
    const slot = TILE_WRITE_QUEUE + i * 4;
    if (bus.u8(slot)) continue;
    bus.w8(slot, de >> 8); bus.w8(slot + 1, de);
    bus.w8(slot + 2, hl); bus.w8(slot + 3, hl >> 8);
    V.vRAMQueueDirty = 1;
    return { a: 1, bc: hl, hl: slot + 3, f: FZ };
  }
  V.vRAMQueueDirty = 1;                                     // full: dropped
  return { a: 1, c: 0, f: FZ | FN };
}

// ProcessVRAMCopyQueues (00:052E), in VBlank: run the queued VRAM copies in order, each with its source's ROM
// and WRAM banks mapped, up to the first free slot (freeing each as it goes); then restore the banks and write
// the queued BG map cells (tile in VRAM bank 0, attribute in bank 1). hVRAMQueueDirty stays as it is.
// b: the caller's b (kept). Returns the registers it leaves.
export function processVRAMCopyQueues(P, b) {
  const { bus, V } = P;
  if (!V.vRAMQueueDirty) return { a: 0, f: FZ };
  const savedRom = V.romBank, savedWram = V.wramBank;
  for (let i = 0; i < VRAM_COPY_SLOTS; i++) {
    const slot = VRAM_COPY_QUEUE + i * VRAM_COPY_SLOT_SIZE;
    const romBank = bus.u8(slot);
    if (!romBank) break;
    switchRomBank(P, romBank);
    bus.w8(slot, 0);                                        // the slot is free again
    P.wramBank(bus.u8(slot + 1));
    bus.w8(rVDMA_SRC_HIGH, bus.u8(slot + 2));
    bus.w8(rVDMA_SRC_HIGH + 1, bus.u8(slot + 3));
    bus.w8(rVBK, bus.u8(slot + 4));
    bus.w8(rVDMA_SRC_HIGH + 2, bus.u8(slot + 5));
    bus.w8(rVDMA_SRC_HIGH + 3, bus.u8(slot + 6));
    bus.w8(rVDMA_LEN, bus.u8(slot + 7));                    // starts the copy
  }
  P.wramBank(savedWram);
  switchRomBank(P, savedRom);
  let de = savedRom << 8 | savedWram, a = 0;
  for (let i = 0; i < TILE_WRITE_SLOTS; i++) {
    const slot = TILE_WRITE_QUEUE + i * 4;
    const hi = bus.u8(slot);
    if (!hi) return { a: 0, b, c: TILE_WRITE_SLOTS - i, de, hl: slot, f: FZ };
    bus.w8(slot, 0);
    de = hi << 8 | bus.u8(slot + 1);
    const tile = bus.u8(slot + 2), attr = bus.u8(slot + 3);
    bus.w8(rVBK, 0); bus.w8(de, tile);
    bus.w8(rVBK, 1); bus.w8(de, attr);
    a = attr;
  }
  return { a, b, c: 0, de, hl: TILE_WRITE_QUEUE + TILE_WRITE_SLOTS * 4, f: FZ | FN };
}

// ---- the BG row/column blit (numberfont_00.asm) ----
const wBGRowBlitAttrs = 0xC300, wBGRowBlitTiles = 0xC340, wBGColumnBlitAttrs = 0xC380, wBGColumnBlitTiles = 0xC3C0;
const vBGMap0 = 0x9800, TILEMAP_WIDTH = 32, TILEMAP_HEIGHT = 32;
// ProcessBGBlitQueue (00:218D), in VBlank: a pending BG row goes to the map at wBGRowBlitDest by VDMA (32
// attributes into VRAM bank 1, then 32 tiles into bank 0); a pending column (32 cells at x = wBGColumnBlitX of
// vBGMap0) is written byte by byte, attributes then tiles. Clears both requests. Returns a = 1 when a column was
// written (the VBlank handler then skips the VRAM queues this time), and the registers it leaves.
export function processBGBlitQueue(P) {
  const { bus, V } = P;
  let r = {};
  setByte(P, "bGColumnBlitDone", 0);
  if (V.bGRowBlitPending) {
    const dest = V.bGRowBlitDest;
    bus.w8(rVBK, 1);
    startVRAMDMA(P, wBGRowBlitAttrs, dest, 1);              // two 16-byte blocks
    bus.w8(rVBK, 0);
    startVRAMDMA(P, wBGRowBlitTiles, dest, 1);
    r = { bc: wBGRowBlitTiles, de: dest, hl: rVDMA_LEN };
  }
  if (V.bGColumnBlitPending) {
    setByte(P, "bGColumnBlitDone", 1);
    const x = V.bGColumnBlitX;
    bus.w8(rVBK, 1);
    for (let y = 0; y < TILEMAP_HEIGHT; y++) bus.w8(vBGMap0 + x + y * TILEMAP_WIDTH, bus.u8(wBGColumnBlitAttrs + y));
    bus.w8(rVBK, 0);
    for (let y = 0; y < TILEMAP_HEIGHT; y++) bus.w8(vBGMap0 + x + y * TILEMAP_WIDTH, bus.u8(wBGColumnBlitTiles + y));
    r = { b: 0, c: TILEMAP_WIDTH, de: wBGColumnBlitTiles + TILEMAP_HEIGHT, hl: vBGMap0 + x + TILEMAP_HEIGHT * TILEMAP_WIDTH };
  }
  V.bGRowBlitPending = 0;
  V.bGColumnBlitPending = 0;
  return { ...r, a: byte(P, "bGColumnBlitDone"), f: FZ };
}

export const HOOKS = [
  [0, 0x03AE, () => {}],                                                       // RetStub
  [0, 0x03AF, (P, c) => setRegs(c, { hl: clearMemory16(P, c.hl, c.c), a: 0, c: 0, f: FZ | FN })],
  [0, 0x03C4, (P, c) => setRegs(c, { hl: clearMemoryBC16(P, c.hl, c.bc), a: 0, bc: 0, f: FZ })],
  [0, 0x03DB, (P, c) => setRegs(c, { ...copyMemoryBC(P, c.hl, c.de, c.bc), bc: 0, f: FZ | FN | (c.f & FC) })],
  [0, 0x03EA, (P, c) => setRegs(c, { ...copyMemoryReverseBC(P, c.hl, c.de, c.bc), a: 0, bc: 0, f: FZ })],
  [0, 0x03F3, (P, c) => setRegs(c, { ...copyMemoryFast(P, c.hl, c.de, c.c), c: 0, f: FZ | FN })],
  [0, 0x0460, (P, c) => setRegs(c, { hl: fillMemoryCFast(P, c.hl, c.a, c.c), c: 0, f: FZ | FN | (c.f & FC) })],
  [0, 0x0465, (P, c) => setRegs(c, { hl: clearVRAMCopyQueue(P), a: 0, c: 0, f: FZ | FN })],
  [0, 0x046D, (P, c) => setRegs(c, queueVRAMCopyFromBank(P, c.b, c.hl, c.de, c.c))],
  [0, 0x0480, (P, c) => setRegs(c, queueVRAMCopy(P, c.hl, c.de, c.c))],
  [0, 0x0507, (P, c) => setRegs(c, queueBGTileWrite(P, c.hl, c.de))],
  [0, 0x052E, (P, c) => setRegs(c, processVRAMCopyQueues(P, c.b))],
  [0, 0x218D, (P, c) => setRegs(c, processBGBlitQueue(P))],
];
