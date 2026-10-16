// Bank $1b: unused debug menus: two text menus (level-up / status / trophies, and the save-data menu, whose text
// depends on whether the N64 records block holds anything) and the unlock-flags debug screen (a 5x2 grid of
// character mugshots over the roster table; Start toggles the hovered character's unlock flag, A on an unlocked one
// or B leaves, writing the block back).
// Port of src/engine/menus/debug/debugmenu_1b.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own; the grid and roster tables are read from
// the ROM. Nothing in the game reaches this code.
// Tests: web/tests/port/routines_menus_misc.mjs (the routines that do not wait); lockstep on
// out/port/dbg_menus.mtrec (scripted: the three screens called from a stub).
import {
  FZ, FN, FH, FC, FAR, rom, romWait, home, near, u8, w8, wram, sound, advanceFrame, fadeIn, beginFadeOut, waitFadeEnd,
  clearFrameTasks, disableLCDSafely, enableLCD, registerFrameTask, hook, hookGen, nop, ixF, cpFlags,
  WRAM_STAGING, WRAM_COURT_PLANES, WRAM_SCREEN, WRAM_TEXT, WRAM_SCENE, VRAM_BANK1, vTiles1, vTiles2, vBGMap0,
  wDecompBuffer, wTextTileBuffer, wShadowTilemap, wScreenAttrmap, PADF_A, PADF_B, PADF_START, SFX_MENU_MOVE,
  SFX_MENU_SELECT, SFX_MENU_CANCEL, HOME, chain, hlIndexed, farFlagsAt, regs8,
} from "./defs.js";
import { queueVRAMCopy, copyMemoryBC } from "../../home/memory.js";
import { decompressData } from "../../home/decompress.js";
import { loadPaletteShadow } from "../../home/palettes.js";
import { queueSpriteTemplate } from "../../home/fade.js";
import { getRegs } from "../../home/cpu.js";

export const BANK = 0x1B;
export const Unused_1b_UpdateBobbingDecorSprite = 0x6671, Unused_1b_UpdateUnlockDebugCursorTask = 0x668D;
export const Unused_1b_UpdateUnlockDebugStatOnChange = 0x66C4;
const Unused_1b_ToggleSelectedUnlockFlag = 0x68A4, Unused_1b_LoadUnlockDebugCursorGfx = 0x68D6;
const UnlockDebugNavGridTable = 0x6572, UnlockDebugRosterTable = 0x6592;
const wNavGridBuffer = 0xC7A0, NAV_GRID_BYTES = 0x20, wCharSelectRoster = 0xCE40, ROSTER_BYTES = 0x80;
const wCharSelectChar = 0xC781, wCharSelectPrevChar = 0xC782, wCharSelectCol = 0xC783, wCharSelectRow = 0xC784;
const wUnlockDebugSelection = 0xCB1F, wMenuWindowId = 0xD82F, wUnlockFlagsBlock = 0xD400;   // (WRAM 5 / WRAM 6)
const wCharRecordBuffer = 0xD580, RECORD_MUGSHOT = 11, RECORD_MUGSHOT_ATTRS = 12, NO_MUGSHOT = 0x20;
const ROSTER_ENTRY_SIZE = 8, ROSTER_END = 0xFF, FIELD_CURSOR = 4, FIELD_MUGSHOT_VRAM = 2, FIELD_STAT = 6;
const GRID_COLUMNS = 5, GRID_ROWS = 2, GRID_STRIDE = 8;
const SAVEBLOCK_N64_RECORDS = 0x0B;
const Text_31_124 = 0x047C, Text_31_125 = 0x047D, MENU_AT = 0x0202, MAP_BLOCKS = 0x24, SCREEN_MAP_BYTES = 0x500;
const DECOR_AT = 0x2CFA, TASK_PRIORITY = 0x0A;

// ---- the text menus ----
// a text menu on a cleared screen: CreateMenuWindowFromText at (2, 2), faded in, the choice made, faded out.
// Returns a = the choice, with the caller's flags (pop_wram_bank).
function* runTextMenu(P, text, old, entryF) {
  wram(P, WRAM_TEXT);
  rom(P, FAR.CreateMenuWindowFromText, { d: MENU_AT >> 8, e: MENU_AT & 0xFF, hl: text });
  yield* romWait(P, FAR.RestoreShadowTilemap);
  yield* romWait(P, FAR.RenderMenuWindowText);
  yield* fadeIn(P, 32);
  const choice = (yield* romWait(P, FAR.RunMenuSelection)).a;
  beginFadeOut(P, 32);
  yield* waitFadeEnd(P);
  yield* romWait(P, FAR.CloseWindow, { a: u8(P, wMenuWindowId) });
  wram(P, old);
  return { a: choice, f: entryF };
}
// Unused_1b_RunLevelUpStatusTrophiesMenu (1B:6467): the level-up / status / trophies menu (Text_31_124)
export function* unusedRunLevelUpStatusTrophiesMenu(P, entryF) {
  const old = P.V.wramBank;
  clearFrameTasks(P);
  disableLCDSafely(P);
  rom(P, FAR.LoadMenuFontGfx);
  disableLCDSafely(P);
  rom(P, FAR.ResetTextWindowState);
  unusedClearScreenMaps(P, getRegs(P.cpu));
  return yield* runTextMenu(P, Text_31_124, old, entryF);
}
// Unused_1b_RunDebugSaveDataMenu (1B:64B9): the save-data menu: Text_31_125, or Text_31_126 when the N64 records
// block (read into wUnlockFlagsBlock) starts with a 0 word
export function* unusedRunDebugSaveDataMenu(P, entryF) {
  const old = P.V.wramBank;
  clearFrameTasks(P);
  disableLCDSafely(P);
  rom(P, FAR.LoadMenuFontGfx);
  enableLCD(P);
  rom(P, FAR.ResetTextWindowState);
  unusedClearScreenMaps(P, getRegs(P.cpu));
  unusedReadUnlockFlagsSaveBlock(P, getRegs(P.cpu));
  wram(P, WRAM_SCENE);
  const empty = !P.bus.u16(wUnlockFlagsBlock);
  return yield* runTextMenu(P, empty ? Text_31_125 + 1 : Text_31_125, old, entryF);
}
// Unused_1b_ClearScreenMaps (1B:651E): the screen's maps cleared (attributes 0, tiles blank) and queued
export function unusedClearScreenMaps(P, entry) {
  const r = chain({ ...entry }, home(P, HOME.DisableLCDSafely));
  const queue = (src, dest) => chain(chain(r, { hl: src, de: dest, c: MAP_BLOCKS }), queueVRAMCopy(P, src, dest, MAP_BLOCKS));
  wram(P, WRAM_COURT_PLANES);
  chain(r, unusedFillBytesWithValue(P, 0x00, wScreenAttrmap, SCREEN_MAP_BYTES));
  wram(P, WRAM_SCREEN);
  chain(r, unusedFillBytesWithValue(P, 0x20, wShadowTilemap, SCREEN_MAP_BYTES));
  wram(P, WRAM_SCREEN);
  queue(wShadowTilemap, vBGMap0);
  wram(P, WRAM_COURT_PLANES);
  queue(wScreenAttrmap, vBGMap0 + VRAM_BANK1);
  return chain(r, enableLCD(P));
}
// Unused_1b_FillBytesWithValue (1B:6569): bc bytes at hl = a (bc = 0: 64 KB)
export function unusedFillBytesWithValue(P, value, hl, bc) {
  do {
    w8(P, hl, value);
    hl = (hl + 1) & 0xFFFF;
    bc = (bc - 1) & 0xFFFF;
  } while (bc);
  return { a: 0, f: FZ, bc: 0, e: value, hl };
}

// ---- the roster ----
// Unused_1b_FindUnlockDebugRosterEntry (1B:65EA): Unused_18_FindRosterEntry over wCharSelectRoster (a: the
// character, de: the field). pushed: the words below the hook's sp at the entry (a caller's pushes and `call`)
export function unusedFindUnlockDebugRosterEntry(P, entry, pushed = 0) {
  return rom(P, FAR.Unused_18_FindRosterEntry, { ...entry, f: farFlagsAt(P, pushed), hl: wCharSelectRoster });
}
// Unused_1b_GetUnlockDebugRosterField (1B:65F1): de = the word at field de of character a's roster entry (hl kept)
export function unusedGetUnlockDebugRosterField(P, entry, pushed = 0) {
  const r = unusedFindUnlockDebugRosterEntry(P, entry, pushed + 2);
  const e = u8(P, r.hl), d = u8(P, r.hl + 1);
  return { ...regs8(r), a: e, d, e, h: entry.h, l: entry.l };
}
// Unused_1b_LoadUnlockDebugNavGrid (1B:65FA): the grid's characters (5 x 2, 8 a row) to wNavGridBuffer
export function unusedLoadUnlockDebugNavGrid(P, f) {
  return { ...copyMemoryBC(P, UnlockDebugNavGridTable, wNavGridBuffer, NAV_GRID_BYTES), bc: 0, f: FZ | FN | (f & FC) };
}
// Unused_1b_LoadUnlockDebugRosterTable (1B:6609): the roster table to wCharSelectRoster
export function unusedLoadUnlockDebugRosterTable(P, f) {
  return { ...copyMemoryBC(P, UnlockDebugRosterTable, wCharSelectRoster, ROSTER_BYTES), bc: 0, f: FZ | FN | (f & FC) };
}
// Unused_1b_LoadUnlockDebugScreenGfx (1B:6618): the decoded tiles queued, then (a leftover: the nav grid's table
// taken for its assets) "maps" and palettes decoded from UnlockDebugNavGridTable
export function unusedLoadUnlockDebugScreenGfx(P, entry) {
  const r = { ...entry };
  const queue = (src, dest, blocks) => chain(chain(r, { hl: src, de: dest, c: blocks }), queueVRAMCopy(P, src, dest, blocks));
  queue(wDecompBuffer, vTiles2 + VRAM_BANK1, 0x80);
  queue(wTextTileBuffer, vTiles1 + VRAM_BANK1, 0x80);
  chain(r, { hl: decompressData(P, UnlockDebugNavGridTable, wTextTileBuffer + 0x400), de: wTextTileBuffer + 0x400 });
  chain(r, { hl: decompressData(P, UnlockDebugNavGridTable, wTextTileBuffer), de: wTextTileBuffer });
  chain(r, { hl: UnlockDebugNavGridTable, d: 0, e: 8 });
  return chain(r, loadPaletteShadow(P, UnlockDebugNavGridTable, 0, 8));
}
// Unused_1b_UpdateBobbingDecorSprite (1B:6671), a frame task of the never-run Unused_1b_LoadUnlockDebugNavGridGfx:
// a bobbing sprite template
export function unusedUpdateBobbingDecorSprite(P) {
  const r = rom(P, FAR.Unused_18_ApplySpriteBobOffset, { de: DECOR_AT });
  chain(r, { hl: UnlockDebugNavGridTable, b: 0x00, c: 0x50 });
  return chain(r, queueSpriteTemplate(P, UnlockDebugNavGridTable, r.d, r.e, 0x50, 0x00, (P.cpu.sp - 2) & 0xFFFF));
}
// Unused_1b_StartUnlockDebugCursorTask (1B:6681): the cursor's tiles and its frame task
export function unusedStartUnlockDebugCursorTask(P) {
  const r = rom(P, FAR.Unused_18_LoadCharSelectCursorGfx);
  chain(r, { a: TASK_PRIORITY, hl: Unused_1b_UpdateUnlockDebugCursorTask });
  return chain(r, registerFrameTask(P, TASK_PRIORITY, Unused_1b_UpdateUnlockDebugCursorTask));
}
// Unused_1b_UpdateUnlockDebugCursorTask (1B:668D), a frame task: the cursor at the hovered character's cell
export function unusedUpdateUnlockDebugCursorTask(P, entry) {
  const r = unusedGetUnlockDebugRosterField(P, { ...entry, a: u8(P, wCharSelectChar), d: 0, e: FIELD_CURSOR }, 1);
  return rom(P, FAR.Unused_18_DrawCharSelectCursor, { ...r, f: farFlagsAt(P, 0), a: u8(P, wCharSelectChar) });
}
// Unused_1b_UpdateUnlockDebugSelectedMugshot (1B:669D): the hovered character's record (none: no mugshot) and the
// stat task
export function unusedUpdateUnlockDebugSelectedMugshot(P, entry) {
  const char = u8(P, wCharSelectChar);
  const r = unusedGetUnlockDebugRosterField(P, { ...entry, a: char, d: 0, e: FIELD_STAT }, 2);
  loadHoveredRecord(P, r, char);
  chain(r, { a: TASK_PRIORITY, hl: Unused_1b_UpdateUnlockDebugStatOnChange });
  return chain(r, registerFrameTask(P, TASK_PRIORITY, Unused_1b_UpdateUnlockDebugStatOnChange));
}
// character `char`'s record into wCharRecordBuffer if unlocked, else its mugshot byte blank (r: the registers,
// updated)
function loadHoveredRecord(P, r, char) {
  const c = r.c;
  chain(r, rom(P, FAR.Unused_18_CheckUnlockFlag, { ...r, f: farFlagsAt(P, 1), a: char, b: char }));
  chain(r, { a: char, b: char, c });
  if (r.f & FZ) {
    w8(P, wCharRecordBuffer + RECORD_MUGSHOT, NO_MUGSHOT);
    r.a = NO_MUGSHOT;
  } else chain(r, rom(P, FAR.LoadCharacterRecordToBuffer, { ...r, f: farFlagsAt(P, 0) }));
  return r;
}
// Unused_1b_UpdateUnlockDebugStatOnChange (1B:66C4), a frame task: on a new hovered character, its stat field read
// (nothing done with it)
export function unusedUpdateUnlockDebugStatOnChange(P, entry) {
  const prev = u8(P, wCharSelectPrevChar), char = u8(P, wCharSelectChar);
  if (prev === char) return { a: prev, f: cpFlags(prev, char), hl: wCharSelectChar };
  return unusedGetUnlockDebugRosterField(P, { ...entry, a: char, d: 0, e: FIELD_STAT, h: wCharSelectChar >> 8, l: wCharSelectChar & 0xFF }, 1);
}
// Unused_1b_DrawUnlockDebugMugshots (1B:66D7): every unlocked roster character's mugshot to its VRAM slot with its
// attributes; then the hovered character's record
export function unusedDrawUnlockDebugMugshots(P, entry) {
  const r = chain({ ...entry }, rom(P, FAR.Unused_1b_ResetMugshotPalettes, { ...entry, f: farFlagsAt(P, 0) }));
  const far = (fn, regs = {}) => chain(r, rom(P, fn, { ...r, f: farFlagsAt(P, 0), ...regs }));
  const hl = () => r.h << 8 | r.l, field = de => chain(r, unusedGetUnlockDebugRosterField(P, { ...r, a: u8(P, hl()), d: 0, e: de }, 1));
  chain(r, { hl: wCharSelectRoster });
  do {
    far(FAR.LoadCharacterRecordToBuffer, { a: u8(P, hl()) });
    far(FAR.Unused_18_CheckUnlockFlag);
    if (!(r.f & FZ)) {
      far(FAR.LoadCharMugshotToBuffer, { a: u8(P, wCharRecordBuffer + RECORD_MUGSHOT) });
      field(FIELD_MUGSHOT_VRAM);
      far(FAR.CopyMugshotBufferToVram);
      field(FIELD_STAT);
      far(FAR.Unused_1b_SetMugshotAttrs, { a: u8(P, wCharRecordBuffer + RECORD_MUGSHOT_ATTRS) });
    }
    const next = ixF(hl(), ROSTER_ENTRY_SIZE);
    chain(r, { hl: next.hl, f: next.f });
    r.a = u8(P, hl());
    r.f = cpFlags(r.a, ROSTER_END);
  } while (r.a !== ROSTER_END);
  far(FAR.LoadCharacterRecordToBuffer, { a: u8(P, wCharSelectChar) });
  return far(FAR.Unused_1b_StubNop_1b_01, { a: u8(P, wCharRecordBuffer + RECORD_MUGSHOT) });
}

// ---- the unlock-flags screen ----
// Unused_1b_RunMinigameFlagsDebugScreen (1B:671C): the screen; Start toggles the hovered character's flag, the pad
// moves; A on an unlocked character, or B (wUnlockDebugSelection = 0), fades out and writes the flags back. A on a
// locked one spins in the ROM (a sound each pass) until the pad changes in VBlank.
export function* unusedRunMinigameFlagsDebugScreen(P, entry) {
  wram(P, WRAM_STAGING);
  clearFrameTasks(P);
  unusedLoadUnlockDebugNavGrid(P, entry.f);
  unusedLoadUnlockDebugRosterTable(P, entry.f);
  unusedUpdateUnlockDebugSelection(P);
  w8(P, wCharSelectPrevChar, u8(P, wCharSelectChar));
  unusedReadUnlockFlagsSaveBlock(P, getRegs(P.cpu));
  beginFadeOut(P, 32);
  yield* waitFadeEnd(P);
  disableLCDSafely(P);
  unusedStartUnlockDebugCursorTask(P);
  unusedLoadUnlockDebugScreenGfx(P, getRegs(P.cpu));
  unusedDrawUnlockDebugMugshots(P, getRegs(P.cpu));
  unusedUpdateUnlockDebugSelectedMugshot(P, getRegs(P.cpu));
  queueVRAMCopy(P, wTextTileBuffer + 0x400, vBGMap0 + VRAM_BANK1, MAP_BLOCKS);
  queueVRAMCopy(P, wTextTileBuffer, vBGMap0, MAP_BLOCKS);
  near(P, Unused_1b_LoadUnlockDebugCursorGfx);
  enableLCD(P);
  yield* fadeIn(P, 32);
  let f;
  for (;;) {
    wram(P, WRAM_STAGING);
    const edge = P.V.inputRisingEdge;
    if (edge & PADF_A) {
      const char = u8(P, wCharSelectChar);
      const r = rom(P, FAR.Unused_18_CheckUnlockFlag, { ...getRegs(P.cpu), f: farFlagsAt(P, 1), a: char, b: char });
      if (r.f & FZ) return yield* P.runRom(BANK, 0x6792, { ...regs8(r), a: char, b: char, c: getRegs(P.cpu).c });   // .playSfx
      sound(P, SFX_MENU_SELECT);
      f = r.f;
      break;
    }
    if (edge & PADF_B) {
      sound(P, SFX_MENU_CANCEL);
      w8(P, wUnlockDebugSelection, 0);
      f = FH;
      break;
    }
    if (edge & PADF_START) near(P, Unused_1b_ToggleSelectedUnlockFlag);
    unusedMoveUnlockDebugCursor(P, getRegs(P.cpu));
    unusedUpdateUnlockDebugSelection(P);
    yield* advanceFrame(P);
  }
  beginFadeOut(P, 8);
  yield* waitFadeEnd(P);
  const r = unusedWriteUnlockFlagsSaveBlock(P, { ...getRegs(P.cpu), f });
  yield* advanceFrame(P);
  yield* advanceFrame(P);
  return r;
}
// Unused_1b_UpdateUnlockDebugSelection (1B:67D8): the hovered character = the grid's cell (column, row); the old one
// in wCharSelectPrevChar
export function unusedUpdateUnlockDebugSelection(P) {
  w8(P, wCharSelectPrevChar, u8(P, wCharSelectChar));
  const at = hlIndexed(wNavGridBuffer, u8(P, wCharSelectRow) * GRID_STRIDE + u8(P, wCharSelectCol));
  const char = u8(P, at.hl);
  w8(P, wCharSelectChar, char);
  return { a: char, hl: at.hl, f: at.f };
}
// Unused_1b_MoveUnlockDebugCursor (1B:67F4): a pressed direction moves the cursor (wrapping), the record of the
// character there loaded (or the mugshot blank when locked)
export function unusedMoveUnlockDebugCursor(P, entry) {
  const input = P.V.inputPressed;
  if (!(input & 0xF0)) return { a: 0, b: input, f: FZ | FH };
  sound(P, SFX_MENU_MOVE);
  const step = unusedStepUnlockDebugCursor(P, input, u8(P, wCharSelectCol), u8(P, wCharSelectRow), wNavGridBuffer);
  const r = chain({ ...entry }, { ...step, b: input, hl: wNavGridBuffer });
  loadHoveredRecord(P, r, step.a);
  w8(P, wCharSelectCol, r.d);
  w8(P, wCharSelectRow, r.e);
  return chain(r, { a: r.e });
}
// Unused_1b_StepUnlockDebugCursor (1B:6827): (d, e) moved by direction b (left / right / up / down, the first
// held), wrapped to the 5 x 2 grid; a = the grid's character there
export function unusedStepUnlockDebugCursor(P, b, d, e, hl) {
  if (b & 0x20) d = (d - 1) & 0xFF;
  else if (b & 0x10) d = (d + 1) & 0xFF;
  else if (b & 0x40) e = (e - 1) & 0xFF;
  else if (b & 0x80) e = (e + 1) & 0xFF;
  const wrap = (v, n) => (v & 0x80 ? n - 1 : v < n ? v : 0);
  d = wrap(d, GRID_COLUMNS);
  e = wrap(e, GRID_ROWS);
  const at = ixF(hl, e * GRID_STRIDE + d);
  return { a: u8(P, at.hl), d, e, f: at.f };
}
// Unused_1b_ReadUnlockFlagsSaveBlock (1B:686F): the N64 records save block into wUnlockFlagsBlock (WRAM 6); a = its
// result
export function unusedReadUnlockFlagsSaveBlock(P, entry) {
  const old = P.V.wramBank;
  wram(P, WRAM_SCENE);
  const r = rom(P, FAR.ReadSaveBlock, { ...entry, f: farFlagsAt(P, 2), hl: wUnlockFlagsBlock, b: SAVEBLOCK_N64_RECORDS });
  wram(P, old);
  return { ...regs8(r), f: entry.f, b: entry.b, c: entry.c };
}
// Unused_1b_WriteUnlockFlagsSaveBlock (1B:688A): wUnlockFlagsBlock written back to the N64 records save block
export function unusedWriteUnlockFlagsSaveBlock(P, entry) {
  const old = P.V.wramBank;
  wram(P, WRAM_SCENE);
  const r = rom(P, FAR.WriteSaveBlock, { ...entry, f: farFlagsAt(P, 1), hl: wUnlockFlagsBlock, de: 0, b: SAVEBLOCK_N64_RECORDS });
  wram(P, old);
  return { ...regs8(r), a: old, f: entry.f };
}

export const HOOKS = [
  [BANK, 0x6467, hookGen((P, c) => unusedRunLevelUpStatusTrophiesMenu(P, c.f))],
  [BANK, 0x64B9, hookGen((P, c) => unusedRunDebugSaveDataMenu(P, c.f))],
  [BANK, 0x651E, hook((P, c) => unusedClearScreenMaps(P, getRegs(c)))],
  [BANK, 0x6569, hook((P, c) => unusedFillBytesWithValue(P, c.a, c.hl, c.bc))],
  [BANK, 0x65EA, hook((P, c) => unusedFindUnlockDebugRosterEntry(P, getRegs(c)))],
  [BANK, 0x65F1, hook((P, c) => unusedGetUnlockDebugRosterField(P, getRegs(c)))],
  [BANK, 0x65FA, hook((P, c) => unusedLoadUnlockDebugNavGrid(P, c.f))],
  [BANK, 0x6609, hook((P, c) => unusedLoadUnlockDebugRosterTable(P, c.f))],
  [BANK, 0x6618, hook((P, c) => unusedLoadUnlockDebugScreenGfx(P, getRegs(c)))],
  [BANK, 0x664A, nop],                                              // Unused_1b_LoadUnlockDebugNavGridGfx: `ret` first
  [BANK, 0x6671, hook(P => unusedUpdateBobbingDecorSprite(P))],
  [BANK, 0x6681, hook(P => unusedStartUnlockDebugCursorTask(P))],
  [BANK, 0x668D, hook((P, c) => unusedUpdateUnlockDebugCursorTask(P, getRegs(c)))],
  [BANK, 0x669D, hook((P, c) => unusedUpdateUnlockDebugSelectedMugshot(P, getRegs(c)))],
  [BANK, 0x66C4, hook((P, c) => unusedUpdateUnlockDebugStatOnChange(P, getRegs(c)))],
  [BANK, 0x66D7, hook((P, c) => unusedDrawUnlockDebugMugshots(P, getRegs(c)))],
  [BANK, 0x671C, hookGen((P, c) => unusedRunMinigameFlagsDebugScreen(P, getRegs(c)))],
  [BANK, 0x67D8, hook(P => unusedUpdateUnlockDebugSelection(P))],
  [BANK, 0x67F4, hook((P, c) => unusedMoveUnlockDebugCursor(P, getRegs(c)))],
  [BANK, 0x6827, hook((P, c) => unusedStepUnlockDebugCursor(P, c.b, c.d, c.e, c.hl))],
  [BANK, 0x686F, hook((P, c) => unusedReadUnlockFlagsSaveBlock(P, getRegs(c)))],
  [BANK, 0x688A, hook((P, c) => unusedWriteUnlockFlagsSaveBlock(P, getRegs(c)))],
];
