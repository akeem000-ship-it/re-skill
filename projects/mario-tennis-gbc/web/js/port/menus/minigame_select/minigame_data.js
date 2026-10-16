// Bank $1b: the saved-data type select's cursor and redraw (level_variants.js has its loop) and the Mario minigame
// data screen (ShowMinigameDataScreen): a chart of the minigames (a row each: the character's icon, a clear mark, a
// star mark and the best score), scrolling over five rows when the ninth character is unlocked, with scroll arrows and
// the score numbers as frame tasks. Its state is in WRAM 3: wMinigameDataClearFlags / StarFlags (one a minigame, from
// the save's flags), wMinigameDataHighScores (words, from the minigame records), and the two-on-one cleared pair.
// Port of src/engine/menus/minigame_select/minigame_data_1b.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own; tables, templates and graphics are read
// from the ROM.
// Tests: lockstep on out/port/menus_status1.mtrec (the type select and the data screen) and out/port/ms_data9.mtrec
// (the scrolling chart, scripted with every character unlocked); web/tests/port/routines_menus_misc.mjs.
import {
  FZ, FAR, rom, near, wram, rd, wr, u8, w8, idx, sound, advanceFrame, registerFrameTask, clearFrameTasks,
  queueSpriteTemplate, enableLCD, fadeIn, fadeOut, loadPaletteShadow, loadScreenAssetRecord, queueWram3MapToVRAM,
  queueCopy, disableLCDSafely, hook, hookGen, regs8, WRAM_SCREEN, WRAM_SOUND, TILEMAP_WIDTH, TILE_SIZE, VRAM_BANK1,
  vTiles0, vTiles1, vBGMap0, wShadowTilemap, wShadowAttrmap, PADF_A, PADF_B, PADF_UP, PADF_DOWN, BGM_STATUS_SCREEN,
  SFX_MENU_MOVE, SFX_MENU_SELECT, SFX_MENU_CANCEL,
} from "../equipment/defs.js";
import { clearBytes } from "../../home/system.js";
import { getMenuCursorIndex } from "../common/cursors.js";
import { setSelectPanelAttrRect, clearMinigameLevelDescriptionRow, flushLevelSelectTextRows } from "./level_variants.js";
import {
  checkMinigameDataScrollable, compactMinigameDataRows, mapMinigameRowToMugshotSlot, getMinigameRowTilemapDest,
  drawMinigameDataMarks, drawStarLegendMark, DrawMinigameDataScrollArrows, DrawMinigameHighScoreNumbers,
} from "./data_marks.js";
import { CHAR_UNUSED_15 } from "./minigame.js";

export const BANK = 0x1B;
const rw = (P, a) => P.rom.u16(BANK, a & 0xFFFF);
export const TickMenuBgScrollTask_1b = 0x72A4, DrawSavedDataTypeSelectCursor = 0x72A8;
const DrawSavedDataCursorOption0_SpriteTemplate = 0x72FA, DrawSavedDataCursorOption1_SpriteTemplate = 0x731B;
const SpriteTemplate_1b = 0x7340, SavedDataTypeDescriptionTable = 0x73B2, SavedDataTypePalettePtrs = 0x73C9;
const MinigameClearFlagsTable = 0x750D, MinigameStarFlagsTable = 0x754D;
const UpdateAnimatedTilesTask_1b = 0x4430;
const Text_30_202 = 0x00CA, SCREENASSET_MarioMiniGames = 0x2B, SAVEFLAG_CLEARED_TWO_ON_ONE_3 = 0x06C0;
const MINIGAMES = 9, RECORDS = 8, FIRST_RECORD = 2, HIGH_SCORES_SIZE = 0x12, LAST_SCROLL_ROW = 4, VISIBLE_ROWS = 5;
const LOCKED_ROW_ICON = 9, STATIC_FIFTH_ROW = 5, DIGIT_SPRITE_ATTR = 0x09, DIGIT_SPRITE_TILE_BASE = 0x10;
const CURSOR_ATTR = 0x08, CURSOR_LABEL_TILE = 0x70;
const TestSaveFlag = [0x03, 0x4D86], ReadMinigameRecord = [0x03, 0x5015];
const BuildMarioCastUnlockMask = [0x3B, 0x667F], GetUnlockedMarioCastCharAtGridSlot = [0x3B, 0x66B5];
const LoadChartWindowTiles = [0x3B, 0x48F2], DrawChartCharIcon = [0x3B, 0x48FA], InitNumberSpriteGfx = [0x39, 0x6EC0];

// TickMenuBgScrollTask_1b (1B:72A4), a frame task: the menu background's scroll
export const tickMenuBgScrollTask = P => rom(P, FAR.TickMenuBgScroll);
// DrawSavedDataTypeSelectCursor (1B:72A8), a frame task: the cursor over the hovered tab
export const drawSavedDataTypeSelectCursor = P => (getMenuCursorIndex(P, 2).a ? drawSavedDataCursorOption1(P) : drawSavedDataCursorOption0(P));
// a tab's cursor: its sprites (from tile c) at (d, e) and the label sprite at the second place, both bobbing
function drawSavedDataCursor(P, tile, at, template, labelAt) {
  let r = rom(P, FAR.ApplySpriteBobOffset, { c: tile, b: CURSOR_ATTR, d: at >> 8, e: at & 0xFF });
  queueSpriteTemplate(P, template, r.d, r.e, r.c, r.b);
  r = rom(P, FAR.ApplySpriteBobOffset, { b: CURSOR_ATTR, c: CURSOR_LABEL_TILE, d: labelAt >> 8, e: labelAt & 0xFF });
  return queueSpriteTemplate(P, SpriteTemplate_1b, r.d, r.e, r.c, r.b);
}
// DrawSavedDataCursorOption0 (1B:72B8) / DrawSavedDataCursorOption1 (1B:72D9)
export const drawSavedDataCursorOption0 = P => drawSavedDataCursor(P, 0x00, 0x0C50, DrawSavedDataCursorOption0_SpriteTemplate, 0x2448);
export const drawSavedDataCursorOption1 = P => drawSavedDataCursor(P, 0x10, 0x5050, DrawSavedDataCursorOption1_SpriteTemplate, 0x6C48);
// RedrawSavedDataTypeSelect (1B:7352): the tabs' attributes, the type's palette, its description, the rows queued
export function redrawSavedDataTypeSelect(P) {
  wram(P, WRAM_SCREEN);
  for (let tab = 0; tab < 2; tab++) setSelectPanelAttrRect(P, tab, 0);
  setSelectPanelAttrRect(P, getMenuCursorIndex(P, 2).a, 1);
  loadSavedDataTypePalette(P, getMenuCursorIndex(P, 3).a);
  clearMinigameLevelDescriptionRow(P);
  drawSavedDataTypeDescription(P);
  return flushLevelSelectTextRows(P);
}
// DrawSavedDataTypeDescription (1B:7383): the hovered type's description (Text_30_202 + type) at its place
export function drawSavedDataTypeDescription(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  const type = getMenuCursorIndex(P, 3).a;
  const r = rom(P, FAR.RenderTextToBuffer64, { hl: idx(Text_30_202, type), de: rw(P, idx(SavedDataTypeDescriptionTable, type * 2)), c: 0x20 });
  wram(P, bank);
  return { ...r, a: bank, b: type, f: entryF };
}
// LoadSavedDataTypePalette (1B:73B6): BG palette 4 from type a's entry of SavedDataTypePalettePtrs
export const loadSavedDataTypePalette = (P, type) => loadPaletteShadow(P, rw(P, idx(SavedDataTypePalettePtrs, type * 2)), 4, 1);

// ---- the minigame data screen ----
// ShowMinigameDataScreen (1B:73DD), slot $402C: the chart built with the LCD off, its frame tasks (animated tiles,
// scroll arrows, score numbers), faded in; up / down scroll; A or B fade out (B returns $FF)
export function* showMinigameDataScreen(P) {
  sound(P, BGM_STATUS_SCREEN);
  disableLCDSafely(P);
  buildMinigameDataScreen(P);
  P.V.animatedTileSet = 1;
  registerFrameTask(P, 1, UpdateAnimatedTilesTask_1b);
  registerFrameTask(P, 1, DrawMinigameDataScrollArrows);
  registerFrameTask(P, 1, DrawMinigameHighScoreNumbers);
  enableLCD(P);
  yield* fadeIn(P, 16);
  wram(P, WRAM_SCREEN);
  for (;;) {
    P.V.menuInputPressed = P.V.inputPressed;
    yield* scrollMinigameDataList(P);
    yield* advanceFrame(P);
    const input = P.V.menuInputPressed;
    if (input & (PADF_A | PADF_B)) {
      sound(P, input & PADF_A ? SFX_MENU_SELECT : SFX_MENU_CANCEL);
      yield* fadeOut(P, 16);
      const r = clearFrameTasks(P);
      return input & PADF_A ? r : { a: 0xFF };
    }
  }
}
// BuildMinigameDataScreen (1B:7449): the chart's screen asset, the cursor (scroll row) at 0, the data loaded, the
// chart window, arrow and digit tiles, the icons and marks, the screen queued
export function buildMinigameDataScreen(P) {
  loadScreenAssetRecord(P, SCREENASSET_MarioMiniGames);
  P.V.menuCursorX = 0;
  P.V.menuCursorY = 0;
  wram(P, WRAM_SCREEN);
  loadMinigameDataState(P);
  rom(P, LoadChartWindowTiles, { de: vTiles1 + 0x2C * TILE_SIZE + VRAM_BANK1 });
  rom(P, FAR.LoadMenuArrowSpriteTiles, { de: vTiles0 + VRAM_BANK1 });
  rom(P, FAR.LoadIndexedPalette, { b: 0x08, c: 0x0F });
  rom(P, InitNumberSpriteGfx, { de: vTiles0 + 0x10 * TILE_SIZE + VRAM_BANK1, b: 0x09, c: 0x00 });
  P.V.digitSpriteAttr = DIGIT_SPRITE_ATTR;
  P.V.digitSpriteTileBase = DIGIT_SPRITE_TILE_BASE;
  if (checkMinigameDataScrollable(P).a) drawMinigameDataMugshotsScrolled(P);
  else drawMinigameDataMugshotsStatic(P);
  drawMinigameDataMarks(P);
  drawStarLegendMark(P);
  return queueWram3MapToVRAM(P);
}
// ScrollMinigameDataList (1B:749D): a scrollable chart's rows one down (to row 4) or up (to 0) by the pad, redrawn
export function* scrollMinigameDataList(P) {
  if (!checkMinigameDataScrollable(P).a) return { a: 0, f: FZ };
  const input = P.V.menuInputPressed;
  let y;
  if (input & PADF_DOWN) { y = (P.V.menuCursorY + 1) & 0xFF; if (y === VISIBLE_ROWS) return { a: y, f: FZ | 0x40 }; }
  else if (input & PADF_UP) { y = (P.V.menuCursorY - 1) & 0xFF; if (y === 0xFF) return { a: y, f: FZ | 0x40 }; }
  else return { a: input, f: FZ | 0x20 };
  P.V.menuCursorY = y;
  sound(P, SFX_MENU_MOVE);
  return yield* redrawMinigameDataRows(P);
}
// LoadMinigameDataState (1B:74CA): the unlock mask, the clear and star flags and the best scores; for a chart that
// does not scroll, the fifth row's data from the sixth (CompactMinigameDataRows)
export function loadMinigameDataState(P) {
  rom(P, BuildMarioCastUnlockMask);
  loadMinigameClearFlags(P);
  loadMinigameStarFlags(P);
  loadMinigameHighScores(P);
  if (!checkMinigameDataScrollable(P).a) return compactMinigameDataRows(P);
}
// one flag a minigame (1 when its save flag in the table is set)
function loadMinigameFlags(P, flags, table) {
  clearBytes(P, flags, MINIGAMES);
  let r;
  for (let c = 0; c < MINIGAMES; c++) {
    r = rom(P, TestSaveFlag, { de: rw(P, idx(table, c * 2)), c });
    if (!(r.f & FZ)) w8(P, flags + c, 1);
  }
  return { a: MINIGAMES, c: MINIGAMES, d: r.d, e: r.e, hl: flags + MINIGAMES, f: FZ | 0x40 };
}
// LoadMinigameClearFlags (1B:74DF) / LoadMinigameStarFlags (1B:751F)
export const loadMinigameClearFlags = P => loadMinigameFlags(P, P.A.minigameDataClearFlags, MinigameClearFlagsTable);
export const loadMinigameStarFlags = P => loadMinigameFlags(P, P.A.minigameDataStarFlags, MinigameStarFlagsTable);
// LoadMinigameHighScores (1B:7560): the two-on-one pair (both set when its third level is cleared), then the best
// scores of records 2-9 (ReadMinigameRecord, its value in WRAM 7)
export function loadMinigameHighScores(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank, scores = P.A.minigameDataHighScores;
  clearBytes(P, scores, HIGH_SCORES_SIZE);
  if (!(rom(P, TestSaveFlag, { de: SAVEFLAG_CLEARED_TWO_ON_ONE_3 }).f & FZ)) {
    w8(P, P.A.minigameDataTwoOnOneCleared, 1);
    w8(P, P.A.minigameDataTwoOnOneCleared + 1, 1);
  }
  let de = 0, hl = 0;
  for (let c = 0; c < RECORDS; c++) {
    rom(P, ReadMinigameRecord, { a: c + FIRST_RECORD, c });
    wram(P, WRAM_SOUND);
    de = P.bus.u16(P.A.minigameRecordValue);
    wram(P, WRAM_SCREEN);
    hl = idx(scores, c * 2);
    P.bus.w16(hl, de);
    hl = (hl + 1) & 0xFFFF;
  }
  wram(P, bank);
  return { a: bank, c: RECORDS, de, hl, f: entryF };
}
// RedrawMinigameDataRows (1B:75AE): the rows' icons and marks redrawn and flushed (three frames)
export function* redrawMinigameDataRows(P) {
  drawMinigameDataMugshotsScrolled(P);
  drawMinigameDataMarks(P);
  return yield* flushMinigameDataRowsToVram(P);
}
// FlushMinigameDataRowsToVram (1B:75B8): the chart's rows 6-15 (tiles and attributes) queued over three frames
export function* flushMinigameDataRowsToVram(P) {
  let r;
  for (const [row, rows] of [[6, 4], [10, 4], [14, 2]]) {
    queueCopy(P, wShadowTilemap + row * TILEMAP_WIDTH, vBGMap0 + row * TILEMAP_WIDTH, rows * TILEMAP_WIDTH / 16);
    queueCopy(P, wShadowAttrmap + row * TILEMAP_WIDTH, vBGMap0 + row * TILEMAP_WIDTH + VRAM_BANK1, rows * TILEMAP_WIDTH / 16);
    r = yield* advanceFrame(P);
  }
  return r;
}
// the icon of each chart row: row c's character (a locked one's icon is row 9's) in slot b
function drawMugshotRow(P, row, slot) {
  const ch = rom(P, GetUnlockedMarioCastCharAtGridSlot, { b: slot, c: row }).a;
  drawMinigameDataMugshot(P, ch === CHAR_UNUSED_15 ? LOCKED_ROW_ICON : row, slot);
}
// DrawMinigameDataMugshotsScrolled (1B:7604): the five rows' icons from the scroll row on
export function drawMinigameDataMugshotsScrolled(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  for (let b = 0, c = P.V.menuCursorY; b < VISIBLE_ROWS; b++, c = (c + 1) & 0xFF) drawMugshotRow(P, c, b);
  wram(P, bank);
  return { a: bank, f: entryF };
}
// DrawMinigameDataMugshotsStatic (1B:7634): rows 0-3, and row 5's icon (the sixth minigame) in the fifth slot
export function drawMinigameDataMugshotsStatic(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  for (let b = 0; b < LAST_SCROLL_ROW; b++) drawMugshotRow(P, b, b);
  drawMinigameDataMugshot(P, STATIC_FIFTH_ROW, LAST_SCROLL_ROW);
  wram(P, bank);
  return { a: bank, f: entryF };
}
// DrawMinigameDataMugshot (1B:7669): row c's character icon (bank $3b's DrawChartCharIcon) in chart slot b.
// Registers kept.
export function drawMinigameDataMugshot(P, row, slot) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  const mug = mapMinigameRowToMugshotSlot(P, row), dest = getMinigameRowTilemapDest(P, slot);
  rom(P, DrawChartCharIcon, { a: dest.a, f: dest.f, b: mug.c, c: mug.c, hl: dest.hl });
  wram(P, bank);
}

export const HOOKS = [
  [BANK, 0x72A4, hook(P => tickMenuBgScrollTask(P))],
  [BANK, 0x72A8, hook(P => drawSavedDataTypeSelectCursor(P))],
  [BANK, 0x72B8, hook(P => drawSavedDataCursorOption0(P))],
  [BANK, 0x72D9, hook(P => drawSavedDataCursorOption1(P))],
  [BANK, 0x7352, hook(P => redrawSavedDataTypeSelect(P))],
  [BANK, 0x7383, hook((P, c) => drawSavedDataTypeDescription(P, c.f))],
  [BANK, 0x73B6, hook((P, c) => loadSavedDataTypePalette(P, c.a))],
  [BANK, 0x73DD, hookGen(P => showMinigameDataScreen(P))],
  [BANK, 0x7449, hook(P => buildMinigameDataScreen(P))],
  [BANK, 0x749D, hookGen(P => scrollMinigameDataList(P))],
  [BANK, 0x74CA, hook(P => loadMinigameDataState(P))],
  [BANK, 0x74DF, hook(P => loadMinigameClearFlags(P))],
  [BANK, 0x751F, hook(P => loadMinigameStarFlags(P))],
  [BANK, 0x7560, hook((P, c) => loadMinigameHighScores(P, c.f))],
  [BANK, 0x75AE, hookGen(P => redrawMinigameDataRows(P))],
  [BANK, 0x75B8, hookGen(P => flushMinigameDataRowsToVram(P))],
  [BANK, 0x7604, hook((P, c) => drawMinigameDataMugshotsScrolled(P, c.f))],
  [BANK, 0x7634, hook((P, c) => drawMinigameDataMugshotsStatic(P, c.f))],
  [BANK, 0x7669, hook((P, c) => { drawMinigameDataMugshot(P, c.c, c.b); })],
];
