// Shared pieces of the pause, briefing, court-select and scene menu ports (web/js/port/menus/pause, briefing,
// court_select, scenes): constants, RAM access, the routines of other parts of the game these menus call, and the
// hook adapters. Names, addresses and constants from the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm); the values of its generated constants (screen assets, tile blocks, decoded
// sizes) are the operands of the ROM's own instructions.
//
// Calls. A routine here calls
//   - verified ports directly (home/*, audio): AdvanceFrame, the VRAM queue, sprites, palettes, fades, frame tasks;
//   - its own routines directly (far ones inside far(P, bank, ...), as FarCall maps the callee's bank: the frame
//     tasks and the VRAM queue note the bank mapped);
//   - anything else (the match engine, text, the menu library, story, link) through its ROM address: rom() for a
//     farcall that does not wait, yield* romWait() for one that may. Those run the ported JS where other parts
//     hooked it. FarCall hands its callee the flags of `ld hl, sp+5`; rom() and romWait() do the same.
// Waiting routines are generators (`yield* advanceFrame(P)`); the lockstep test does not need the ROM's stack.
// RAM is read and written through the WRAM bank mapped at the time (P.bus), as the ROM does.
import { queueVRAMCopy, copyMemoryFast, copyMemoryBC } from "../../home/memory.js";
import { queueSprite, queueSprite16, queueSpriteTemplate as homeQueueSpriteTemplate } from "../../home/fade.js";
import { registerFrameTask as homeRegisterFrameTask, unregisterFrameTask as homeUnregisterFrameTask, beginFadeOut,
  beginFadeIn, waitFadeEnd as homeWaitFadeEnd } from "../../home/colorfade.js";
import { advanceFrame } from "../../home/frame.js";
import { clearFrameTasks } from "../../home/debugtext.js";
import { decompressData } from "../../home/decompress.js";
import { loadPaletteShadow, loadPalettesImmediate } from "../../home/palettes.js";
import { enableLCD } from "../../home/system.js";
import { testGameFlag, setGameFlag, clearGameFlag, flagOperand } from "../../home/flags.js";
import { playSoundManaged } from "../../audio/requests.js";
import { getRegs, setRegs } from "../../home/cpu.js";
import { farcallFlags } from "../common/defs.js";

export { queueVRAMCopy, copyMemoryFast, copyMemoryBC, queueSprite, queueSprite16, beginFadeOut, beginFadeIn,
  advanceFrame, clearFrameTasks, decompressData, loadPaletteShadow, loadPalettesImmediate, enableLCD, getRegs, setRegs };

// ---- flags ----
export const FZ = 0x80, FN = 0x40, FH = 0x20, FC = 0x10;
export const orFlags = v => ((v & 0xFF) === 0 ? FZ : 0);
export const cpFlags = (a, n) => ((a & 0xFF) === (n & 0xFF) ? FZ : 0) | FN | ((a & 0xF) < (n & 0xF) ? FH : 0) | ((a & 0xFF) < (n & 0xFF) ? FC : 0);

// ---- constants (include/constants/*.inc, include/hardware.inc) ----
export const WRAM_STAGING = 1, WRAM_COURT_PLANES = 2, WRAM_SCREEN = 3, WRAM_ACTORS = 4, WRAM_TEXT = 5, WRAM_SCENE = 6;
export const WRAM_SOUND = 7, WRAM_CHAR0 = 4;
export const TILE_SIZE = 16, TILEMAP_WIDTH = 32;
export const VRAM_BANK1 = 0x2000;
export const vTiles0 = 0x8000, vTiles1 = 0x8800, vTiles2 = 0x9000, vBGMap0 = 0x9800;
export const OAM_BANK1 = 0x08, OAM_XFLIP = 0x20, OAM_YFLIP = 0x40;
export const PADF_A = 0x01, PADF_B = 0x02, PADF_SELECT = 0x04, PADF_START = 0x08;
export const PADF_RIGHT = 0x10, PADF_LEFT = 0x20, PADF_UP = 0x40, PADF_DOWN = 0x80;
export const rVBK = 0xFF4F, rIE = 0xFFFF, IE_TIMER = 0x04;
export const OBJ_PALETTES = 8;                                   // LoadPaletteShadow's first object palette
// sounds (include/constants/sound.inc)
export const BGM_MENU = 0x03, BGM_WIN = 0x09, BGM_CREDITS = 0x2C, BGM_THE_END = 0x2D;
export const SFX_MENU_MOVE = 0x5E, SFX_MENU_SELECT = 0x5F, SFX_MENU_DECIDE = 0x60, SFX_MENU_LOCKED = 0x61;
export const SFX_MENU_CANCEL = 0x62, SFX_PAUSE_MENU = 0x63, SFX_OPTION_TOGGLE = 0x9B;
// the game (include/constants/modes.inc, match.inc, menus.inc, story.inc)
export const GAMEMODE_TRAINING_DRILL = 0x05, GAMEMODE_MARIO_MINIGAME = 0x08, GAMEMODE_LINK_MATCH = 0x09;
export const MATCHCONTEXT_MINIGAME = 0x02;
export const MINIGAME_SERVICE_PRACTICE_1 = 0x03, MINIGAME_TENNIS_MACHINE_1 = 0x12, MINIGAME_BOO_BLAST = 0x1C;
export const MATCHMENUSEL_CANCELLED = 0xFF, MATCHABORT_ALL = 0xFF;
export const MENUSLIDE_BACK = 0, MENUSLIDE_FORWARD = 1;
export const STORYLOC_MAIN_MENU = 0x00, STORYENTRY_NONE = 0xFF;
export const TILEATTR_PAL1 = 0x01, TILEATTR_PRIORITY = 0x80;

// ---- RAM buffers (ram/*.asm, include/ram_mirrored.inc) ----
export const wDecompBuffer = 0xD000;                                                            // WRAM 1
export const wScreenAttrmap = 0xD000;                                                           // WRAM 2
export const wCourtTilemap = 0xD000, wCourtAttrmap = 0xD400, wCourtTilemapSaved = 0xD800, wCourtAttrmapSaved = 0xDC00;   // WRAM 2
export const wActiveTilemap = 0xD000, wActiveAttrmap = 0xD400;                                  // WRAM 2 / 5
export const wShadowTilemap = 0xD000, wShadowAttrmap = 0xD400, wScreenScratch = 0xD800;        // WRAM 3
export const wCharPosX = 0xDF00, wCharInputSource = 0xDF1E;                                     // WRAM 4-7
export const cell = (base, x, y) => (base + y * TILEMAP_WIDTH + x) & 0xFFFF;

// ---- RAM through the mapped banks ----
const addr = (P, name) => { const a = P.A[name]; if (a === undefined) throw new Error(`no RAM name ${name}`); return a; };
export const rd = (P, name, off = 0) => P.bus.u8((addr(P, name) + off) & 0xFFFF);
export const wr = (P, name, v, off = 0) => P.bus.w8((addr(P, name) + off) & 0xFFFF, v & 0xFF);
export const rd16 = (P, name, off = 0) => P.bus.u16((addr(P, name) + off) & 0xFFFF);
export const wr16 = (P, name, v, off = 0) => P.bus.w16((addr(P, name) + off) & 0xFFFF, v & 0xFFFF);
export const u8 = (P, a) => P.bus.u8(a & 0xFFFF);
export const w8 = (P, a, v) => P.bus.w8(a & 0xFFFF, v & 0xFF);
export const u16 = (P, a) => P.bus.u16(a & 0xFFFF);
// the ROM's table index: `ld hl, table / add l / ld l, a / jr nc / inc h` (an 8-bit index, carry into h)
export const idx = (table, a) => (table + (a & 0xFF)) & 0xFFFF;

// ---- banks ----
const rROMB0 = 0x2000;
export function setRomBank(P, bank) { P.V.romBank = bank; P.bus.w8(rROMB0, bank); }
// a farcall into code ported here (or a verified port) that does not wait: the callee's bank mapped meanwhile
export function far(P, bank, fn) {
  const old = P.V.romBank;
  if (old === bank) return fn();
  setRomBank(P, bank);
  try { return fn(); } finally { setRomBank(P, old); }
}
export function* farGen(P, bank, gen) {
  const old = P.V.romBank;
  setRomBank(P, bank);
  try { return yield* gen; } finally { setRomBank(P, old); }
}
// wram_bank b (hWramBank and rSVBK); push_wram_bank ... pop_wram_bank around fn
export const wram = (P, b) => P.wramBank(b);
export function withWram(P, b, fn) {
  const old = P.V.wramBank;
  P.wramBank(b);
  const r = fn();
  P.wramBank(old);
  return r;
}

// ---- the ROM's routines, by address ----
export const HOME = {
  DisableLCDSafely: 0x0346, ClearBytes: 0x03A7, ClearMemory16: 0x03AF, QueueBGTileWrite: 0x0507, PrintHexByte: 0x1AB7,
  TestGameFlag: 0x249F, SetGameFlag: 0x24BA, ResetSerialState: 0x28F8, EnableTimerInterrupt: 0x2A0E,
  Unused_00_CopyTextString: 0x2AA6, Unused_00_DrawHexWord: 0x2AD3, Unused_00_MoveCursorVertical: 0x2C04,
  SetMusicMuted: 0x2F86, WaitFramesCmd: 0x2725,
};
export const FAR = {
  LoadMenuFontGfx: [0x01, 0x50E2], LoadMenuFontGfxStaged: [0x01, 0x50EC], Unused_01_LoadMenuTilesBChunk2: [0x01, 0x50D6],
  SetStorySlotFlagB: [0x02, 0x4CB1], SetStorySlotFlagA: [0x02, 0x4CED],
  SaveStorySlotWithTimer: [0x03, 0x4D10], TestSaveFlag: [0x03, 0x4D86], SetSaveFlag: [0x03, 0x4DB6],
  ReadMinigameRecord: [0x03, 0x5015], RunScrollingTextScreen: [0x03, 0x59C5], InitGrayscalePaletteFade: [0x03, 0x75AB],
  SetupPaletteFadeMask: [0x03, 0x7687], AnimatePaletteFadeToTarget: [0x03, 0x7719],
  InitTextWindows: [0x05, 0x4096], GetTilemapCellAddress: [0x05, 0x4122], RestoreShadowTilemap: [0x05, 0x436F],
  CreateMenuWindowFromText: [0x05, 0x46B0], Unused_05_RunMenuSelectionShared: [0x05, 0x4AA8],
  PushTextArgNumber: [0x05, 0x5147], RenderProportionalTextAt: [0x05, 0x5DB3], ResetTextWindowState: [0x05, 0x6E09],
  CreateWindowFromScreenRect: [0x05, 0x6E45], GetWindowStructPtr: [0x05, 0x6EEA], DrawTextWindowFrame: [0x05, 0x6F70],
  RedrawWindowRows: [0x05, 0x7205], RenderMenuWindowText: [0x05, 0x7232], CloseWindow: [0x05, 0x72BD],
  RedrawAllTilemapRows: [0x05, 0x72D2], PrepareGlyphBuffer: [0x05, 0x72DC], UploadGlyphBuffer: [0x05, 0x7792],
  SyncLinkFrame: [0x07, 0x4747], RunLinkInputFrame: [0x07, 0x4833], ResyncLinkSessionWithTimer: [0x07, 0x4AA9],
  ReadMatchInputPressed: [0x08, 0x4415], ReadMatchInputRepeat: [0x08, 0x441D], StepMatchFrames: [0x08, 0x4428],
  StepMatchFrame: [0x08, 0x4465], ReloadCharFrameGfx: [0x08, 0x69C2],
  LoadScoreDigitGfx: [0x09, 0x6100],
  ScriptCloseDialogueWindow: [0x0A, 0x41F2], RunDialogueYesNoPrompt: [0x0A, 0x41F6], SaveStoryReturnPoint: [0x0A, 0x527F],
  InitSceneTileAnimations: [0x0A, 0x639B], StopSceneTileAnimations: [0x0A, 0x6456], DrawNumberWithSprites: [0x0A, 0x67CA],
  RunEndingCreditsSequence: [0x0A, 0x6E74],
  AddBobbingOffsetY: [0x18, 0x4478], AddBobbingOffsetYLarge: [0x18, 0x449B],
  ShowCharDataScreen: [0x1D, 0x4016], ShowGameProgressScreen: [0x1E, 0x7263],
  LoadMatchStoryGfx: [0x28, 0x60C9],
  LoadScreenAssetRecord: [0x39, 0x407E], QueueWram3MapToVRAM: [0x39, 0x4325], UpdateAnimatedTiles: [0x39, 0x4342],
  CopyTilemapRect: [0x39, 0x4530], FillTilemapRect: [0x39, 0x4558], LoadIndexedPalette: [0x39, 0x457F],
  LoadCompressedTileBlock: [0x39, 0x468B], LoadMenuArrowSpriteTiles: [0x39, 0x4A16], QueueStackedSpritePair: [0x39, 0x4A53],
  ApplySpriteBobOffset: [0x39, 0x4AC4], InitMenuBgScroll: [0x39, 0x4B13], LoadMenuSpritePalettePair: [0x39, 0x4B3A],
  TickMenuBgScroll: [0x39, 0x4B6D], FlushWram3MapRows: [0x39, 0x4CAB], RestoreMenuBgAndDrawPanel: [0x39, 0x4DEB],
  ResetScreenAndTextWindows: [0x39, 0x4BF3], FillIncrementingBytes: [0x39, 0x745A],
  ShowEquipmentStatusScreen: [0x3E, 0x5388], MoveMenuCursorGrid_3e: [0x3E, 0x413A], GetMenuCursorIndex_3e: [0x3E, 0x43C9],
  SetMenuCursorFromIndex_3e: [0x3E, 0x43EB],
};
// a farcall of a routine that is the ROM's or another part's: through its address (P.callRom maps its bank and sets
// hRomBank, and puts the caller's back afterwards, as FarCall does), with the flags FarCall hands its callee.
// Returns the registers it leaves.
export const rom = (P, [bank, a], regs = {}) => P.callRom(bank, a, { f: farcallFlags(P.cpu.sp), ...regs });
export const home = (P, a, regs = {}) => P.callRom(0, a, regs);
export function* romWait(P, [bank, a], regs = {}) { return yield* P.runRom(bank, a, { f: farcallFlags(P.cpu.sp), ...regs }); }
export function* homeWait(P, a, regs = {}) { return yield* P.runRom(0, a, regs); }

// ---- home routines used as JavaScript ----
export const sound = (P, id) => playSoundManaged(P, id);
export const disableLCDSafely = P => home(P, HOME.DisableLCDSafely);      // (busy-waits on rLY: still the ROM's)
export function* waitFadeEnd(P) { return yield* homeWaitFadeEnd(P, getRegs(P.cpu)); }
// `ld c, speed / call BeginFadeOut / call WaitFadeEnd` and `script_fade_in speed / call WaitFadeEnd`
export function* fadeOut(P, speed) { beginFadeOut(P, speed); yield* waitFadeEnd(P); }
export function* fadeIn(P, speed) { beginFadeIn(P, speed); yield* waitFadeEnd(P); }
// `wait_frames n` (WaitFramesCmd): n AdvanceFrames
export function* waitFrames(P, n) { for (let i = n || 0x100; i > 0; i--) yield* advanceFrame(P); }
// RegisterFrameTask / UnregisterFrameTask / QueueSpriteTemplate of a routine or template in the ROM bank mapped now
// (the caller's); the ROM builds its key on the stack below the call's return address
export const registerFrameTask = (P, priority, routine) => homeRegisterFrameTask(P, priority, routine, (P.cpu.sp - 2) & 0xFFFF);
export const unregisterFrameTask = (P, routine) => homeUnregisterFrameTask(P, routine, (P.cpu.sp - 2) & 0xFFFF);
export const queueSpriteTemplate = (P, template, x, y, tile, attr) =>
  homeQueueSpriteTemplate(P, template, x & 0xFF, y & 0xFF, tile & 0xFF, attr & 0xFF, (P.cpu.sp - 2) & 0xFFFF);
// the far routines used most, with their arguments by name
export const fillTilemapRect = (P, de, w, h, value) => rom(P, FAR.FillTilemapRect, { de, b: w, c: h, h: value });
export const copyTilemapRect = (P, hl, de, w, h) => rom(P, FAR.CopyTilemapRect, { hl, de, b: w, c: h });
export const loadCompressedTileBlock = (P, block, dest, blocks) => rom(P, FAR.LoadCompressedTileBlock, { b: block, c: blocks, de: dest });
export const loadScreenAssetRecord = (P, asset) => rom(P, FAR.LoadScreenAssetRecord, { c: asset });
export const queueWram3MapToVRAM = P => rom(P, FAR.QueueWram3MapToVRAM);
export const prepareGlyphBuffer = P => rom(P, FAR.PrepareGlyphBuffer);
// (these two wait for frames during a link session)
export function* uploadGlyphBuffer(P) { return yield* romWait(P, FAR.UploadGlyphBuffer); }
export function* renderProportionalTextAt(P, text, de, c) { return yield* romWait(P, FAR.RenderProportionalTextAt, { hl: text, de, c }); }
// the match's frame step and pad (bank 8): StepMatchFrame runs one frame of the (frozen) match and waits for it
export function* stepMatchFrame(P) { return yield* romWait(P, FAR.StepMatchFrame); }
export const readMatchInputPressed = P => rom(P, FAR.ReadMatchInputPressed).a;
export const readMatchInputRepeat = P => rom(P, FAR.ReadMatchInputRepeat).a;
// test_flag / set_flag / clear_flag n (include/flag_constants.inc)
export const testFlag = (P, n) => testGameFlag(P, flagOperand(n));
export const setFlag = (P, n) => setGameFlag(P, flagOperand(n));
export const clearFlag = (P, n) => clearGameFlag(P, flagOperand(n));
export const FLAG_HIDE_OVERWORLD_ACTORS = 20, FLAG_VRAM_UPDATE_BUSY = 24, FLAG_DOUBLES = 47;
export const FLAG_PAUSE_OPTIONS_MENU_OPEN = 48, FLAG_MINIGAME_PAUSE_MENU_OPEN = 49;
export const FLAG_ENDING_SEEN_SINGLES = 183, FLAG_ENDING_SEEN_DOUBLES = 184;

// ---- hook adapters ----
// fn(P, cpu) runs the routine and returns the registers the ROM routine leaves that its callers use ({ a, f, ... });
// the others are put back as they were at the call (the routine's calls into the ROM change the CPU's registers).
export const hook = fn => (P, cpu) => {
  const saved = getRegs(cpu);
  const out = fn(P, cpu);
  setRegs(cpu, saved);
  if (out) setRegs(cpu, out);
};
export const hookGen = fn => function* (P, cpu) {
  const saved = getRegs(cpu);
  const out = yield* fn(P, cpu);
  setRegs(cpu, saved);
  if (out) setRegs(cpu, out);
};
