// Shared pieces of the cutscene port (web/js/port/cutscenes): constants, the cutscene variables as the ROM sees
// them, the calls into code other parts of the port own, and the hook adapters.
// Names and addresses from the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm).
//
// Calls into home (bank 0) and other banks go through P.callRom / P.runRom (they run the ported JS through the
// hooks where there is some, the ROM's code elsewhere). Doing so also keeps the stack where the ROM keeps it: the
// ROM's `call` pushes a return address and P.callRom / P.runRom push theirs, so AdvanceFrame is reached at the ROM's
// stack depth (the lockstep test compares the machines there). Where the ROM pushes around a wait (push_wram_bank,
// push af ... pop af, or a `call` of a waiting routine that is ported here), the port pushes the same words.
import { RAM_FIELDS } from "../fields.js";

// ---- constants (include/constants/*.inc, include/hardware.inc) ----
export const WRAM_STAGING = 1, WRAM_COURT_PLANES = 2, WRAM_SCREEN = 3, WRAM_ACTORS = 4, WRAM_TEXT = 5, WRAM_SCENE = 6;
export const WRAM_SOUND = 7;
export const TILE_SIZE = 16, TILEMAP_WIDTH = 32, TILEMAP_AREA = 32 * 32, SCREEN_HEIGHT = 18;
export const VRAM_BANK1 = 0x2000;                         // a VRAM address + VRAM_BANK1: the same address in VRAM bank 1
export const vTiles0 = 0x8000, vTiles1 = 0x8800, vTiles2 = 0x9000, vBGMap0 = 0x9800, vBGMap1 = 0x9C00;
export const OAM_BANK1 = 0x08;                            // sprite attribute: tiles from VRAM bank 1
export const PADF_A = 0x01, PADF_B = 0x02, PADF_SELECT = 0x04, PADF_START = 0x08;
export const rLCDC = 0xFF40, rSTAT = 0xFF41, rWY = 0xFF4A, rIE = 0xFFFF;
export const LCDC_WIN_MAP = 0x08;                         // rLCDC bit 3: the background map at $9C00 (vBGMap1)
export const IE_STAT = 0x02;                              // rIE bit 1: the LCD STAT (raster) interrupt
export const STAT_HBLANK_INT = 0x08;                      // rSTAT: interrupt at HBlank (the raster scroll)
// WRAM buffers (wram/*.asm): staging bank 1, screen bank 3, text bank 5
export const wDecompBuffer = 0xD000, wTextTileBuffer = 0xD800, wTextTileBuffer_SIZE = 0x800;
export const wCutsceneTextScrollBuffer = 0xD000;          // bank 1, over wDecompBuffer
export const wScreenAttrmap = 0xD000;                     // bank 2
export const wShadowTilemap = 0xD000, wShadowAttrmap = 0xD400, wScreenScratch = 0xD800, wRulesScreenAnimFrame = 0xDC00;   // bank 3
export const wIntroCharactersTilemap = 0xD800, wIntroCharactersAttrmap = 0xDC00;   // bank 4 (read through whatever is mapped)
export const wWindowShadowTilemap = 0xD000, wWindowShadowAttrmap = 0xD400;        // bank 5
export const wTextBuffer = 0xC600;
// sounds (include/constants/sound.inc)
export const BGM_NONE = 0x00, BGM_INTRO = 0x01, BGM_TITLE_SCREEN = 0x02, BGM_CREDITS = 0x2C;
export const SFX_MENU_DECIDE = 0x60, SFX_LOGO_JINGLE = 0x65;

// ---- code owned by other parts of the port (bank 0 "home" unless noted) ----
export const HOME = {
  DecompressDataFromBank: 0x0234, DisableLCDSafely: 0x0346, EnableLCD: 0x0376, QueueVRAMCopy: 0x0480,
  LoadPaletteShadow: 0x05B0, LoadPalettesImmediate: 0x05B5, MulHLByA: 0x0926, DivHLByDE: 0x0987,
  DecompressData: 0x1797, ClearDebugTextBuffer: 0x188B, ClearFrameTasks: 0x1B38, RegisterFrameTask: 0x1B6A,
  UnregisterFrameTask: 0x1BCB, SplitColorComponents: 0x1C6A, CombineColorComponents: 0x1C83, ForceFadeIn: 0x1D0C,
  BeginFadeOut: 0x1D20, BeginFadeIn: 0x1D2E, WaitFadeEnd: 0x1DA4, ClearSpriteQueue: 0x1E1D,
  QueueSpriteTemplate: 0x1E9D, AdvanceFrame: 0x2631, WaitFrames: 0x2740, PlaySoundManaged: 0x3024,
};
// far routines: [bank, slot in the bank's $4000 table] (FarCall resolves them the same way)
export const FAR = {
  LoadMenuFontGfx: [0x01, 0x0A], InitTextWindows: [0x05, 0x00], FetchDialogueText: [0x05, 0x1E],
  InitSceneScroll: [0x0A, 0x6A], CopyScrolledSceneTilemapToVram: [0x0A, 0x76], StopSceneScrollTask: [0x0A, 0xA0],
  FetchAndDrawDialogueText: [0x1E, 0x0A], LoadScreenAssetRecord: [0x39, 0x00], QueueWram3MapToVRAM: [0x39, 0x02],
  FillTilemapRect: [0x39, 0x0C], LoadCompressedTileBlock: [0x39, 0x10],
};

const hl = v => ({ h: (v >> 8) & 0xFF, l: v & 0xFF }), de = v => ({ d: (v >> 8) & 0xFF, e: v & 0xFF });
export const callHome = (P, addr, regs = {}) => P.callRom(0, addr, regs);
// farcall: the routine of entry `slot` of `bank`'s $4000 table, with that bank mapped (P.callRom maps it, sets
// hRomBank, and maps the caller's bank back afterwards, as FarCall's tail does)
export function farcall(P, [bank, slot], regs = {}) { return P.callRom(bank, P.rom.u16(bank, 0x4000 + slot), regs); }
// AdvanceFrame (00:2631): the frame barrier (home's)
export function* advanceFrame(P) { return yield* P.runRom(0, HOME.AdvanceFrame); }
// `sound id` (rst $08 ; db id): the sound request, as PlaySoundManaged with the id in a (every register kept)
export function sound(P, id) { callHome(P, HOME.PlaySoundManaged, { a: id }); }
// QueueVRAMCopy (00:0480): `blocks` 16-byte blocks from src (through the ROM/WRAM banks mapped now) to VRAM dest
export function queueVRAMCopy(P, src, dest, blocks) { return callHome(P, HOME.QueueVRAMCopy, { ...hl(src), ...de(dest), c: blocks & 0xFF }); }
// DecompressData (00:1797): the LZ stream at src (in the ROM bank mapped now) to dest
export function decompressData(P, src, dest) { return callHome(P, HOME.DecompressData, { ...hl(src), ...de(dest) }); }
// DecompressDataFromBank (00:0234): entry `slot` of `bank`'s $4000 table (the ld_slot operand) to dest
export function decompressDataFromBank(P, bank, slot, dest) { return callHome(P, HOME.DecompressDataFromBank, { h: bank, l: slot, ...de(dest) }); }
// LoadPaletteShadow (00:05B0) / LoadPalettesImmediate (00:05B5): `count` palettes from src (ROM bank mapped now)
// into the shadows from palette `first` (0-7 background, 8-15 objects)
export function loadPaletteShadow(P, src, first, count) { return callHome(P, HOME.LoadPaletteShadow, { ...hl(src), d: first, e: count }); }
export function loadPalettesImmediate(P, src, first, count) { return callHome(P, HOME.LoadPalettesImmediate, { ...hl(src), d: first, e: count }); }
// QueueSpriteTemplate (00:1E9D): the sprites of the template at `template` (ROM bank mapped now) at (x, y),
// tile + `tile`, attribute + `attr`
export function queueSpriteTemplate(P, template, x, y, tile, attr) {
  return callHome(P, HOME.QueueSpriteTemplate, { ...hl(template), d: x & 0xFF, e: y & 0xFF, c: tile & 0xFF, b: attr & 0xFF });
}
// RegisterFrameTask (00:1B6A) / UnregisterFrameTask (00:1BCB): a routine of the ROM bank mapped now, run from
// AdvanceFrame every frame with priority `priority`
export function registerFrameTask(P, priority, routine) { return callHome(P, HOME.RegisterFrameTask, { a: priority, ...hl(routine) }); }
export function unregisterFrameTask(P, routine) { return callHome(P, HOME.UnregisterFrameTask, hl(routine)); }
export const clearFrameTasks = P => callHome(P, HOME.ClearFrameTasks);
export const enableLCD = P => callHome(P, HOME.EnableLCD);
export const disableLCDSafely = P => callHome(P, HOME.DisableLCDSafely);   // (busy-waits on rLY: the CPU's time passes)
export const beginFadeOut = (P, speed) => callHome(P, HOME.BeginFadeOut, { c: speed });
export const beginFadeIn = (P, speed) => callHome(P, HOME.BeginFadeIn, { c: speed });   // script_fade_in speed
// WaitFadeEnd (00:1DA4): frames until the fade is over
export function* waitFadeEnd(P) { return yield* P.runRom(0, HOME.WaitFadeEnd); }
// `ld c, speed ; call BeginFadeOut ; call WaitFadeEnd`
export function* fadeOut(P, speed) { beginFadeOut(P, speed); return yield* waitFadeEnd(P); }
// `script_fade_in speed ; call WaitFadeEnd`
export function* fadeIn(P, speed) { beginFadeIn(P, speed); return yield* waitFadeEnd(P); }
// `wait_frames n` (call WaitFramesCmd ; db n): WaitFramesCmd (00:2725) pushes bc and calls WaitFrames (00:2740)
// with c = n. Every register kept but F (left by its `ld hl, sp+6`; not used by the callers here).
export function* waitFramesCmd(P, n, retAddr) {
  const { cpu } = P, bc = cpu.bc;
  push(P, retAddr); push(P, bc);
  yield* P.runRom(0, HOME.WaitFrames, { c: n });
  P.cpu.sp = (P.cpu.sp + 4) & 0xFFFF;
  cpu.bc = bc;
}

// ---- the stack (see the header) ----
export function push(P, value) { P.cpu.sp = (P.cpu.sp - 2) & 0xFFFF; P.bus.w16(P.cpu.sp, value & 0xFFFF); }
export function pop(P) { const v = P.bus.u16(P.cpu.sp); P.cpu.sp = (P.cpu.sp + 2) & 0xFFFF; return v; }
// `call routine` of a waiting routine ported here: its return address pushed while it runs
export function* call(P, retAddr, gen) {
  push(P, retAddr);
  try { return yield* gen; } finally { pop(P); }
}
// wram_bank b: hWramBank and rSVBK
export const wramBank = (P, b) => P.wramBank(b);
// push_wram_bank b (`ldh a, [hWramBank] / push af / wram_bank b`): returns the bank pop_wram_bank gives back.
// The word is pushed where the ROM pushes it (a routine that waits inside keeps the ROM's stack depth).
export function pushWramBank(P, b) { const old = P.V.wramBank; push(P, old << 8 | P.cpu.f); P.wramBank(b); return old; }
// pop_wram_bank (`pop af / wram_bank`): leaves a = the bank, and the flags pushed with it
export function popWramBank(P) { const af = pop(P); P.wramBank(af >> 8); return af; }

// ---- RAM as the ROM sees it ----
// Every name read and written at its address through the WRAM bank mapped now (the ROM's view; the cutscene code
// maps the right bank first). Bytes, but for these words (fields.js's sizes are the gaps between symbols).
const WORDS = new Set(["cameraX", "cameraY", "cutsceneScrollAccum", "introCutsceneScrollY", "scrollTextId", "minigameRecordValue"]);
export function ram(P) {
  if (P._cutsceneRam) return P._cutsceneRam;
  const bus = P.bus, R = {};
  for (const [name, , addr] of RAM_FIELDS) {
    if (name in R) continue;
    Object.defineProperty(R, name, WORDS.has(name)
      ? { get: () => bus.u16(addr), set: v => bus.w16(addr, v & 0xFFFF) }
      : { get: () => bus.u8(addr), set: v => bus.w8(addr, v & 0xFF) });
  }
  return (P._cutsceneRam = R);
}

// ---- flags as the SM83 leaves them (where a caller can test them) ----
export const FZ = 0x80, FN = 0x40, FH = 0x20, FC = 0x10;
export const cpFlags = (a, n) => ((a & 0xFF) === (n & 0xFF) ? FZ : 0) | FN | ((a & 0xF) < (n & 0xF) ? FH : 0) | ((a & 0xFF) < (n & 0xFF) ? FC : 0);
export const subFlags = cpFlags;
export const incFlags = (v, f) => (f & FC) | (((v + 1) & 0xFF) === 0 ? FZ : 0) | ((v & 0xF) === 0xF ? FH : 0);
export const decFlags = (v, f) => (f & FC) | FN | (((v - 1) & 0xFF) === 0 ? FZ : 0) | ((v & 0xF) === 0 ? FH : 0);
export const addFlags = (a, n) => (((a + n) & 0xFF) === 0 ? FZ : 0) | ((a & 0xF) + (n & 0xF) > 0xF ? FH : 0) | (a + n > 0xFF ? FC : 0);
export const orFlags = v => ((v & 0xFF) === 0 ? FZ : 0);
export const andFlags = v => ((v & 0xFF) === 0 ? FZ : 0) | FH;

// ---- hook adapters ----
const REGS = ["a", "f", "b", "c", "d", "e", "h", "l"];
// (pairs first, then single registers: a result of P.callRom carries both, and a single one set over it wins)
export function setRegs(cpu, o) {
  for (const [p, hi, lo] of [["bc", "b", "c"], ["de", "d", "e"], ["hl", "h", "l"]]) if (p in o) { cpu[hi] = (o[p] >> 8) & 0xFF; cpu[lo] = o[p] & 0xFF; }
  for (const k of REGS) if (k in o) cpu[k] = k === "f" ? o.f & 0xF0 : o[k] & 0xFF;
}
const finish = (cpu, out, saved) => { if (saved) for (const k of REGS) cpu[k] = saved[k]; if (out) setRegs(cpu, out); };
// hook(bank, addr, fn): fn(P, cpu) runs the routine (reading its arguments from cpu at once) and returns the
// registers the routine itself sets last ({a, f, bc, ...}), or a generator for a routine that waits. The other
// registers stay as the routine's calls into the ROM left them on the CPU, as they do in the ROM.
export function hook(bank, addr, fn) {
  return [bank, addr, (P, cpu) => {
    const out = fn(P, cpu);
    if (out && typeof out.next === "function") return (function* () { finish(cpu, yield* out); })();
    finish(cpu, out);
  }];
}
// the same for a routine that saves the registers around its work (push af/bc/de/hl ... pop): all are put back,
// then the ones it returns set
export function hookSaving(bank, addr, fn) {
  return [bank, addr, (P, cpu) => {
    const saved = {}; for (const k of REGS) saved[k] = cpu[k];
    const out = fn(P, cpu);
    if (out && typeof out.next === "function") return (function* () { finish(cpu, yield* out, saved); })();
    finish(cpu, out, saved);
  }];
}
