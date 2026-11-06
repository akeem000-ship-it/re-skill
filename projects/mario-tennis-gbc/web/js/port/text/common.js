// Shared pieces of the text engine's port (bank $05, web/js/port/text): constants, RAM as the ROM sees it, the
// hook adapter, and the calls into code that other parts of the port own (bank 0 "home", other banks) — those still
// run as the ROM's code through P.callRom / P.runRom until their ports land.
// Names and addresses from the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm).
import { RAM_FIELDS } from "../fields.js";

// ---- constants (include/constants/*.inc, include/flag_constants.inc) ----
export const WRAM_COURT_PLANES = 2, WRAM_SCREEN = 3, WRAM_ACTORS = 4, WRAM_TEXT = 5, WRAM_SOUND = 7;
export const TILEATTR_PRIORITY = 0x80;                 // BG colours 1-3 above sprites
export const DIALOGUEWIN_NONE = 0xFF;                  // wDialogueWindowId: no dialogue window open
export const VRAM_BANK1 = 0x2000;                      // $9800 + VRAM_BANK1: the same address in VRAM bank 1
export const vTiles0 = 0x8000, vTiles1 = 0x8800, vBGMap0 = 0x9800;
export const wMapBuffer64 = 0xD000;                    // the 64x64 scrolling map (tiles in WRAM 3, attributes in WRAM 2)
export const rLCDC = 0xFF40, rVBK = 0xFF4F, rVDMA_SRC_HIGH = 0xFF51;
export const PAD = { A: 0x01, B: 0x02, SELECT: 0x04, START: 0x08, RIGHT: 0x10, LEFT: 0x20, UP: 0x40, DOWN: 0x80 };
export const PAD_ANY_BUTTON = 0xF3;                    // the "skip text" mask: A B and the d-pad (not SELECT/START)
export const FLAG = {
  CUTSCENE_FAST_FORWARD: 22, VRAM_UPDATE_BUSY: 24, TEXT_WAITING_FOR_BUTTON: 25, DEBUG_STATIC_TEXT_WINDOW: 27,
  CHAR_DATA_START_EXITS: 28, DEBUG_FLAG_EDITOR_OPEN: 31, DEBUG_SHORT_GLYPH_UPLOAD: 34, TEXT_RENDER_ACTIVE: 35,
  PROPORTIONAL_TEXT_MODE: 36, PAUSE_OPTIONS_MENU_OPEN: 48, MINIGAME_PAUSE_MENU_OPEN: 49, TEMP_WIDE_GLYPH_STREAM: 253,
};
export const SFX_MENU_MOVE = 0x5E, SFX_MENU_SELECT = 0x5F, SFX_MENU_CANCEL = 0x62, SFX_BEEP = 0x72;
export const STORYENTRY_NONE = 0xFF;

// ---- code owned by other parts of the port: still the ROM's (bank 0 unless noted) ----
export const HOME = {
  ClearMemory16: 0x03AF, CopyMemoryBC: 0x03DB, CopyMemoryFast: 0x03F3, QueueVRAMCopy: 0x0480, QueueBGTileWrite: 0x0507,
  DisableLCDSafely: 0x0346, EnableLCD: 0x0376, MulHLByA: 0x0926, AdvanceRandomSeed: 0x0A3A,
  StartVRAMDMAFromHL: 0x18EB, FormatHexWord: 0x1935, FormatDecimalNumber: 0x1972,
  RegisterFrameTask: 0x1B6A, UnregisterFrameTask: 0x1BCB, SplitColorComponents: 0x1C6A,
  AdjustColorRed: 0x1CAD, AdjustColorGreen: 0x1CB9, AdjustColorBlue: 0x1CC9,
  BeginFadeOut: 0x1D20, BeginFadeIn: 0x1D2E, WaitFadeEnd: 0x1DA4, QueueSprite16: 0x1E55, QueueSprite: 0x1F51,
  TestGameFlag: 0x249F, SetGameFlag: 0x24BA, ClearGameFlag: 0x24D4,
  TestGameFlagByNumber: 0x24EF, SetGameFlagByNumber: 0x2509, ClearGameFlagByNumber: 0x2523,
  AdvanceFrame: 0x2631, WaitFramesCmd: 0x2725, PlaySoundManaged: 0x3024,
};

// AdvanceFrame (00:2631): wait for the next frame — home's, run as the ROM's code until its port lands
export function* advanceFrame(P) { yield* P.runRom(0, HOME.AdvanceFrame); }
// rst $08 ; db id — the sound request (PlaySoundCmd 00:2FB3); PlaySoundManaged (00:3024) is the same with the id in a
export function playSound(P, id) { P.callRom(0, HOME.PlaySoundManaged, { a: id }); }
// rst $30 / $20 / $28 ; db bit << 5, byte — test / set / clear a bit of wGameFlags (home's TestGameFlag etc.)
const flagOperand = n => ({ d: n >> 3, e: (n & 7) << 5 });
export function testFlagF(P, n) { return P.callRom(0, HOME.TestGameFlag, flagOperand(n)).f; }    // the flags it leaves: Z = clear
export function testFlag(P, n) { return (testFlagF(P, n) & 0x80) === 0; }                          // true when the flag is set
export function setFlag(P, n) { P.callRom(0, HOME.SetGameFlag, flagOperand(n)); }
export function clearFlag(P, n) { P.callRom(0, HOME.ClearGameFlag, flagOperand(n)); }
export const callHome = (P, addr, regs) => P.callRom(0, addr, regs);
// QueueVRAMCopy (00:0480): c 16-byte blocks from hl to de (bit 5 of d: VRAM bank 1); queued for VBlank, or a DMA now
// with the LCD off. Returns the registers it leaves.
export function queueVRAMCopy(P, src, dest, blocks, regs = {}) {
  return P.callRom(0, HOME.QueueVRAMCopy, { ...regs, h: src >> 8, l: src & 0xFF, d: dest >> 8, e: dest & 0xFF, c: blocks });
}
// QueueBGTileWrite (00:0507): one tile (l) and attribute (h) to the BG map address de at the next VBlank
export function queueBGTileWrite(P, dest, tile, attr = 0x80) { P.callRom(0, HOME.QueueBGTileWrite, { d: dest >> 8, e: dest & 0xFF, h: attr, l: tile }); }
// RegisterFrameTask (00:1B6A) / UnregisterFrameTask (00:1BCB): a routine of the current ROM bank run every frame
export function registerFrameTask(P, kind, addr) { return P.callRom(0, HOME.RegisterFrameTask, { a: kind, h: addr >> 8, l: addr & 0xFF }); }
export function unregisterFrameTask(P, addr) { return P.callRom(0, HOME.UnregisterFrameTask, { h: addr >> 8, l: addr & 0xFF }); }
// CopyMemoryFast (00:03F3): c 16-byte blocks hl -> de; ClearMemory16 (00:03AF): c 16-byte blocks at hl; CopyMemoryBC (00:03DB)
export function copyMemoryFast(P, src, dest, blocks, regs = {}) { return P.callRom(0, HOME.CopyMemoryFast, { ...regs, h: src >> 8, l: src & 0xFF, d: dest >> 8, e: dest & 0xFF, c: blocks }); }
export function clearMemory16(P, addr, blocks) { return P.callRom(0, HOME.ClearMemory16, { h: addr >> 8, l: addr & 0xFF, c: blocks }); }
export function copyMemoryBC(P, src, dest, count) { return P.callRom(0, HOME.CopyMemoryBC, { h: src >> 8, l: src & 0xFF, d: dest >> 8, e: dest & 0xFF, b: count >> 8, c: count & 0xFF }); }
// far calls into other banks: the bank's $4000 slot table, as FarCall (00:01B6) does
export function farcall(P, bank, slot, regs = {}) { return P.callRom(bank, P.rom.u16(bank, 0x4000 + slot), regs); }
export function* farcallWaiting(P, bank, slot, regs = {}) { return yield* P.runRom(bank, P.rom.u16(bank, 0x4000 + slot), regs); }

// ---- RAM ----
// The ROM's code reads its variables through whatever WRAM bank is mapped (rSVBK); P.V reads a banked variable in
// its own bank. This view is the ROM's: every name read and written at its address as mapped now. (In normal play
// the text engine maps bank 5 first, so both agree; the mapped view keeps the odd paths exact too.)
// Every name is a byte except these words (fields.js's sizes are the gaps between symbols, not the declarations:
// wGlyphBufferHoldCount is a db with a 2-byte gap, wTextStreamPtr a dw with a 6-byte one).
const WORDS = new Set(["cameraX", "cameraY", "glyphPenX", "shadowTilemapPtr", "shadowTilemapReadOffset", "textArrowCell",
  "textArrowEraseAddr", "textResumePtr", "textStreamPtr", "glyphVramDest", "glyphTileWritePtr"]);
export function mapped(P) {
  if (P._textRam) return P._textRam;
  const bus = P.bus, R = {};
  for (const [name, , addr] of RAM_FIELDS) {
    if (name in R) continue;
    Object.defineProperty(R, name, WORDS.has(name)
      ? { get: () => bus.u16(addr), set: v => bus.w16(addr, v) }
      : { get: () => bus.u8(addr), set: v => bus.w8(addr, v) });
  }
  return (P._textRam = R);
}
export const lcdOn = P => (P.bus.u8(rLCDC) & 0x80) !== 0;
// push_wram_bank b: returns the bank to give back to popWramBank (the ROM's pop_wram_bank)
export function pushWramBank(P, b) { const old = P.V.wramBank; P.wramBank(b); return old; }

// ---- flags as the SM83 leaves them (only where callers test them) ----
export const Z = 0x80, N = 0x40, H = 0x20, C = 0x10;
export function cpFlags(a, b) { return ((a & 0xFF) === (b & 0xFF) ? Z : 0) | N | ((a & 0xF) < (b & 0xF) ? H : 0) | ((a & 0xFF) < (b & 0xFF) ? C : 0); }
export function addFlags(a, b) { const r = (a + b) & 0xFF; return (r === 0 ? Z : 0) | ((a & 0xF) + (b & 0xF) > 0xF ? H : 0) | (a + b > 0xFF ? C : 0); }

// ---- the hook adapter ----
// hook(bank, addr, fn): fn(P, r) gets the entry registers (r.a ... r.l, r.f, r.bc, r.de, r.hl) and returns the
// registers the ROM routine leaves changed ({a, f, b, ..., bc, de, hl}; a pair wins over its halves), or a
// generator (a routine that waits)
// returning them. Every other register is put back as it was at the entry: calls into the ROM made by the JS
// (P.callRom) use the CPU's registers, which the ROM routine would have preserved.
const REGS = ["a", "f", "b", "c", "d", "e", "h", "l"];
function setRegs(cpu, o) {
  for (const k of REGS) if (k in o) cpu[k] = k === "f" ? o.f & 0xF0 : o[k] & 0xFF;
  for (const [p, hi, lo] of [["bc", "b", "c"], ["de", "d", "e"], ["hl", "h", "l"]]) if (p in o) { cpu[hi] = (o[p] >> 8) & 0xFF; cpu[lo] = o[p] & 0xFF; }
}
export function hook(bank, addr, fn) {
  return [bank, addr, (P, cpu) => {
    const saved = {}; for (const k of REGS) saved[k] = cpu[k];
    const r = { ...saved, bc: saved.b << 8 | saved.c, de: saved.d << 8 | saved.e, hl: saved.h << 8 | saved.l };
    const out = fn(P, r);
    const finish = o => { for (const k of REGS) cpu[k] = saved[k]; if (o) setRegs(cpu, o); };
    if (out && typeof out.next === "function") return (function* () { finish(yield* out); })();
    finish(out);
  }];
}
export const hi = v => (v >> 8) & 0xFF, lo = v => v & 0xFF, w16 = (h, l) => ((h & 0xFF) << 8) | (l & 0xFF);
