// Shared pieces of the menu port (web/js/port/menus): constants, RAM buffers, the routines of other parts of the
// game the menus call, and the adapters between the ROM's calling conventions and JavaScript.
// Names and addresses from the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm).
//
// Calls. A menu routine calls
//   - a verified port directly (home/memory, decompress, palettes, colorfade, fade, math, joypad; audio; save),
//   - its own menu routines directly (far ones inside withRomBank, as FarCall maps the callee's bank),
//   - anything else through the ROM's address: callHome / callFar (P.callRom) and, for code that waits,
//     yield* waitRom (as P.runRom). Those run the ported JS where other parts have hooked it.
// The stack. Where the ROM waits (AdvanceFrame) deep in a call chain, the port keeps its stack pointer where the
// ROM's is: a ROM `call` of a waiting routine is callGen (one word), a farcall farGen (FarCall's four words), and
// a push around a wait is push / pop. So the lockstep test sees the machines at the same stack depth.
import { queueVRAMCopy } from "../../home/memory.js";
import { loadPaletteShadow } from "../../home/palettes.js";
import { playSoundManaged } from "../../audio/requests.js";

// ---- flags, registers ----
export const FZ = 0x80, FN = 0x40, FH = 0x20, FC = 0x10;
export const cpFlags = (a, n) => (a === n ? FZ : 0) | FN | ((a & 0x0F) < (n & 0x0F) ? FH : 0) | (a < n ? FC : 0);
export const orFlags = a => (a & 0xFF ? 0 : FZ);
export const decFlags = (v, carry = 0) => (((v - 1) & 0xFF) === 0 ? FZ : 0) | FN | ((v & 0x0F) === 0 ? FH : 0) | carry;
export const incFlags = (v, carry = 0) => (((v + 1) & 0xFF) === 0 ? FZ : 0) | ((v & 0x0F) === 0x0F ? FH : 0) | carry;
export const addFlags = (a, x) => (((a + x) & 0xFF) === 0 ? FZ : 0) | ((a & 0xF) + (x & 0xF) > 0xF ? FH : 0) | (a + x > 0xFF ? FC : 0);
export const subFlags = (a, x) => (((a - x) & 0xFF) === 0 ? FZ : 0) | FN | ((a & 0xF) < (x & 0xF) ? FH : 0) | (a < x ? FC : 0);

const REGS = ["a", "f", "b", "c", "d", "e", "h", "l"];
export function getRegs(cpu) { const r = {}; for (const k of REGS) r[k] = cpu[k]; return r; }
export function setRegs(cpu, r) {
  for (const k in r) {
    const v = r[k];
    if (v === undefined) continue;
    if (k === "bc" || k === "de" || k === "hl") cpu[k] = v & 0xFFFF;
    else if (k === "f") cpu.f = v & 0xF0;
    else cpu[k] = v & 0xFF;
  }
}
// Hook adapters. fn(P, cpu) runs the port and returns the registers the ROM routine leaves changed ({ a, f, hl,
// ... }); every other register is put back as it was at the call (ROM code the port called may have changed it).
export const hook = fn => (P, cpu) => {
  const saved = getRegs(cpu);
  const out = fn(P, cpu);
  setRegs(cpu, saved);
  if (out) setRegs(cpu, out);
};
// the same for a routine that may wait: fn is a generator function (a path that does not wait finishes at once)
export const hookGen = fn => function* (P, cpu) {
  const saved = getRegs(cpu);
  const out = yield* fn(P, cpu);
  setRegs(cpu, saved);
  if (out) setRegs(cpu, out);
};

// ---- the stack ----
export function push(P, v) { const c = P.cpu; c.sp = (c.sp - 2) & 0xFFFF; P.bus.w16(c.sp, v); }
export function pop(P) { const c = P.cpu, v = P.bus.u16(c.sp); c.sp = (c.sp + 2) & 0xFFFF; return v; }
// `call X` of a waiting routine ported here: its return address on the stack while it runs
export function* callGen(P, gen) {
  push(P, 0);
  try { return yield* gen; } finally { pop(P); }
}
// `farcall X` of a waiting routine ported here: FarCall's frame (the rst's return address, hl, af with the caller's
// bank, CallVectorEntryA's return) and the callee's bank mapped while it runs
export function* farGen(P, bank, gen) {
  const sp = P.cpu.sp, old = P.V.romBank;
  for (let i = 0; i < 4; i++) push(P, 0);
  setRomBank(P, bank);
  try { return yield* gen; } finally { setRomBank(P, old); P.cpu.sp = sp; }
}

// ---- banks ----
const rROMB0 = 0x2000;
// ldh [hRomBank], a / ld [rROMB0], a
export function setRomBank(P, bank) { P.V.romBank = bank; P.bus.w8(rROMB0, bank); }
// a farcall of a routine ported here that does not wait: the callee's bank mapped (hRomBank and the MBC) while it
// runs, then the caller's again, as FarCall does
export function withRomBank(P, bank, fn) {
  const old = P.V.romBank;
  if (old === bank) return fn();
  setRomBank(P, bank);
  try { return fn(); } finally { setRomBank(P, old); }
}
// the wram_bank macro: hWramBank, then rSVBK
export const wramBank = (P, b) => P.wramBank(b);
// push_wram_bank b: the old bank on the CPU stack (as `push af`), then the new one; pop_wram_bank undoes it
export function pushWramBank(P, b) { push(P, P.V.wramBank << 8); P.wramBank(b); }
export function popWramBank(P) { P.wramBank(pop(P) >> 8); }
// push_wram_bank ... pop_wram_bank around fn (no stack: for code that does not wait)
export function withWramBank(P, b, fn) {
  const old = P.V.wramBank;
  P.wramBank(b);
  try { return fn(); } finally { P.wramBank(old); }
}

// ---- calls into the ROM ----
export const callHome = (P, addr, regs = {}) => P.callRom(0, addr, regs);
export const callFar = (P, [bank, addr], regs = {}) => P.callRom(bank, addr, regs);
// A call into ROM code that may wait (P.runRom: it ends when the routine's `ret` brings the stack back, whatever
// return address that took, as the lockstep may have copied the ROM's stack page in).
export function* waitRom(P, bank, addr, regs = {}) { return yield* P.runRom(bank, addr, regs); }
export const waitFar = (P, [bank, addr], regs = {}) => waitRom(P, bank, addr, regs);
// a farcall into ROM code that may wait, with FarCall's frame on the stack (three words, then the callee's return)
export function* waitFarCall(P, [bank, addr], regs = {}) {
  const sp = P.cpu.sp;
  for (let i = 0; i < 3; i++) push(P, 0);
  try { return yield* waitRom(P, bank, addr, regs); } finally { P.cpu.sp = sp; }
}
// AdvanceFrame (00:2631): the game's frame barrier (home's; still called through the ROM's address)
export function* advanceFrame(P) { yield* waitRom(P, 0, HOME.AdvanceFrame); }

// ---- memory ----
export const rd = (P, addr) => P.bus.u8(addr);
export const wr = (P, addr, v) => P.bus.w8(addr, v);
export const rd16 = (P, addr) => P.bus.u16(addr);
// the ROM's table lookups: hl = table + a (8-bit index, carry into h)
export const romByte = (P, addr) => P.bus.u8(addr);          // ROM read through the bank mapped now (the routine's)
export const romWord = (P, addr) => P.bus.u16(addr);
// the common sound request (`sound X`: rst $08): every register kept
export const sound = (P, id) => playSoundManaged(P, id);
// QueueVRAMCopy (00:0480) and LoadPaletteShadow (00:05B0), verified home ports
export const queueCopy = (P, src, dest, blocks) => queueVRAMCopy(P, src, dest, blocks);
// (with the registers LoadPaletteShadow leaves: d, e are kept on its usual path)
export const loadPalettes = (P, src, first, count) => ({ d: first, e: count, ...loadPaletteShadow(P, src, first, count) });

// ---- constants (include/constants/*.inc, include/hardware.inc) ----
export const WRAM_STAGING = 1, WRAM_COURT_PLANES = 2, WRAM_SCREEN = 3, WRAM_ACTORS = 4, WRAM_TEXT = 5, WRAM_SCENE = 6;
export const WRAM_SOUND = 7;
export const TILE_SIZE = 16, TILEMAP_WIDTH = 32, TILEMAP_AREA = 32 * 32, SCREEN_WIDTH = 20, SCREEN_HEIGHT = 18;
export const VRAM_BANK1 = 0x2000;                         // a VRAM address + VRAM_BANK1: the same address in VRAM bank 1
export const vTiles0 = 0x8000, vTiles1 = 0x8800, vTiles2 = 0x9000, vBGMap0 = 0x9800, vBGMap1 = 0x9C00;
export const OAM_BANK1 = 0x08, OAM_XFLIP = 0x20, OAM_YFLIP = 0x40;
export const PADF_A = 0x01, PADF_B = 0x02, PADF_SELECT = 0x04, PADF_START = 0x08;
export const PADF_RIGHT = 0x10, PADF_LEFT = 0x20, PADF_UP = 0x40, PADF_DOWN = 0x80;
export const rLCDC = 0xFF40, rBGP = 0xFF47, rIF = 0xFF0F, rIE = 0xFFFF;
export const IE_TIMER = 0x04;                             // rIE bit 2: the timer interrupt (sound with the LCD off)
export const LINKSTATE_IDLE = 0, LINKSTATE_MASTER = 1, LINKSTATE_SLAVE = 2;
export const MENUSLIDE_BACK = 0, MENUSLIDE_FORWARD = 1;
// sounds (include/constants/sound.inc)
export const BGM_MENU = 0x03, BGM_STATUS_SCREEN = 0x04;
export const SFX_MENU_MOVE = 0x5E, SFX_MENU_SELECT = 0x5F, SFX_MENU_DECIDE = 0x60, SFX_MENU_LOCKED = 0x61;
export const SFX_MENU_CANCEL = 0x62, SFX_LOGO_JINGLE = 0x65;
// WRAM buffers (ram/*.asm): bank 1 staging, bank 2 court planes, bank 3 screen, bank 5 text
export const wDecompBuffer = 0xD000, wTextTileBuffer = 0xD800, wTextTileBuffer_SIZE = 0x800;   // bank 1
export const wScreenAttrmap = 0xD000;                                                          // bank 2
export const wShadowTilemap = 0xD000, wShadowAttrmap = 0xD400, wScreenScratch = 0xD800, wRulesScreenAnimFrame = 0xDC00;   // bank 3
export const wWindowShadowTilemap = 0xD000;                                                    // bank 5
export const wTextBuffer = 0xC600;
// a cell of a 32-wide map buffer
export const cell = (base, x, y) => base + y * TILEMAP_WIDTH + x;

// ---- routines of other parts of the game ----
// bank 0 (home)
export const HOME = {
  CallHLInBankA: 0x015E, ClearBytes: 0x03A7, DisableLCDSafely: 0x0346, EnableLCD: 0x0376, CopyMemoryFast: 0x03F3,
  ClearDebugTextBuffer: 0x188B, PrintString: 0x1906, FormatDecimalNumber: 0x1972, PrintDecimalByte: 0x1AE4,
  ClearFrameTasks: 0x1B38, BeginFadeIn: 0x1D2E, ClearSpriteQueue: 0x1E1D, TestGameFlag: 0x249F,
  SetGameFlagByNumber: 0x2509, ClearGameFlagByNumber: 0x2523, AdvanceFrame: 0x2631, WaitFrames: 0x2740,
  LinkErrorReset: 0x284B, InitSerialLink: 0x28B9, ResetSerialState: 0x28F8, PlaySoundManaged: 0x3024,
};
// far routines: [bank, address]
export const FAR = {
  InitStoryModeState: [0x02, 0x421C], InitPlayerRecordFromTemplate: [0x02, 0x43A3],
  Unused_02_LoadMainCharacterFromRoster: [0x02, 0x443B], LoadCharacterRecordToCa80: [0x02, 0x52AA],
  RenderProportionalTextAt: [0x05, 0x5DB3], Unused_05_WriteStringToTilemap: [0x05, 0x6B82],
  ResetTextWindowState: [0x05, 0x6E09], CreateWindowFromScreenRect: [0x05, 0x6E45], DrawTextWindowFrame: [0x05, 0x6F70],
  RedrawWindowRows: [0x05, 0x7205], InitDefaultMatchSettings: [0x08, 0x4070], RunStoryModeOverworld: [0x0A, 0x4F2C],
  LoadCharMugshotToBuffer: [0x1B, 0x4E37], CopyMugshotBufferToVram: [0x1B, 0x4E46],
  Unused_18_CopyBytes11: [0x18, 0x55B9], Unused_18_ClearTileVramBothBanks: [0x18, 0x55DB],
  Unused_18_LoadConfirmScreenSpriteGfx: [0x18, 0x55F8],
};
