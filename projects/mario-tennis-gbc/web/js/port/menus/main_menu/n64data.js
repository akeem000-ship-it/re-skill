// The records screens of bank $3B, all drawn from the N64 records block (save block $0B, read into
// wN64RecordsBlock, WRAM 3 $D900): what the N64 game sent over the Transfer Pak.
//   - Exhibition (RunN64ExhibData): a chart of 16 characters against 16 opponents (a 7 x 4 window of it scrolled by
//     the d-pad, wN64ExhibPage / wN64ExhibCursorRow), each cell a mark for the best difficulty beaten.
//   - Tournament (RunN64TnmtData): for 16 characters, the trophies of each cup in singles and doubles (two pages of
//     a 5-row window, wDataScreenPage / wDataScreenCursorRow).
//   - Ring Shot (RunN64RingShotData): per character the rings cleared in each of 4 modes and the best scores (the
//     scores as digit sprites by a frame task; wMenuCursorX the mode, wMenuCursorY the first row).
//   - Trophies (RunTrophiesScreen): the story file's own trophies (wN64TrophyCounts), not the N64's; left / right
//     count up two bytes that A with SELECT checks as a cheat code (12, 34: unlock everything).
// Each: built with the LCD off, faded in, scroll arrows and the animated tiles as frame tasks; A returns (a from
// ClearFrameTasks), B returns $FF, both after a fade-out.
// Port of src/engine/menus/main_menu/{n64_3b (RunN64ExhibData ..), n64exhib_3b, n64tnmt_3b, n64trophies_3b,
// ring_3b}.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm). Tables are read
// from the ROM.
// Tests: lockstep on out/port/menus_n64data1.mtrec (an N64 records block written into save1's SRAM: all three N64
// screens) and out/port/menus_file1.mtrec (the trophies); web/tests/port/routines_menus_main.mjs.
import { clearMemory16, copyMemoryFast, copyMemoryBC } from "../../home/memory.js";
import { registerFrameTask, beginFadeIn, beginFadeOut, waitFadeEnd } from "../../home/colorfade.js";
import { setGameFlag } from "../../home/flags.js";
import { readSaveBlock, setSaveFlag, saveStorySlot, checkStorySlot } from "../../save/storyslots.js";
import { setAllUnlockablesInSaveBlock } from "../../save/repair.js";
import {
  FZ, FN, FH, FC, addFlags, incFlags, hook, hookGen, callGen, callHome, advanceFrame, sound, withRomBank, wramBank,
  pushWramBank, popWramBank, withWramBank, queueCopy, getRegs, cell, HOME, WRAM_SCREEN, TILE_SIZE, TILEMAP_WIDTH,
  VRAM_BANK1, vTiles0, vTiles1, vBGMap0, wShadowTilemap, wShadowAttrmap, PADF_A, PADF_B, PADF_SELECT, PADF_LEFT,
  PADF_RIGHT, PADF_UP, PADF_DOWN, BGM_STATUS_SCREEN, SFX_MENU_MOVE, SFX_MENU_SELECT, SFX_MENU_CANCEL,
} from "../common/defs.js";
import { applyBobOffset } from "../common/cursors.js";
import { BANK_MENU_LIB, loadScreenAssetRecord, queueWram3MapToVRAM, copyTilemapRect } from "../common/tilemaps.js";
import { loadCompressedTileBlock, loadMenuArrowSpriteTiles, loadIndexedPalette, queueStackedSpritePair } from "../common/menu_lib.js";
import { initNumberSpriteGfx, drawDecimalNumberSprites } from "../common/widgets.js";
import { ix } from "./picker.js";

export const BANK_MAIN_MENU = 0x3B;
const BANK_SAVE = 0x03;
// WRAM 3 (ram/wram/wramx3.asm)
const wScreenScratch = 0xD800, wDataScreenPage = 0xD801, wDataScreenCursorRow = 0xD802;
const wTrophyCellsMainSet1 = 0xD800, wTrophyCellsPartnerSet1 = 0xD806, wTrophyCellsMainSet2 = 0xD80C;
const wTrophyCellsPartnerSet2 = 0xD812, wTrophySecondSetPresent = 0xD819, wTrophyCellsSize = 0x18;
const wN64TnmtLayout = 0xD810, wN64TnmtTrophyCells = 0xD830, TNMT_ROW = 12;
const wN64RecordsBlock = 0xD900, N64_RECORDS_SIZE = 0x200;
const N64_HALVES = wN64RecordsBlock + 344;                  // bit 0: singles data, bit 1: doubles data
const N64_EXHIB_ROWS = wN64RecordsBlock + 216, N64_TNMT_ROWS = wN64RecordsBlock + 8;
const N64_RING_CLEARS = wN64RecordsBlock + 24, N64_RING_SCORES = wN64RecordsBlock + 88;
const wChartRows = 0xDB00, wChartColumnList = 0xDC01, wN64ExhibPage = 0xDC12, wN64ExhibCursorRow = 0xDC13;
const wExhibCellBits = 0xDC20, wRingShotEntryList = 0xDC40, LIST_SIZE = 0x10, NO_ENTRY = 0x10;
const SAVEBLOCK_N64_RECORDS = 0x0B;
const SCREENASSET_ExhibitionMenu = 12, SCREENASSET_N64Tournament = 13, SCREENASSET_N64Tournament2 = 14;
const SCREENASSET_ModeSelect = 15, SCREENASSET_RingShotHud = 18;
const TILEBLOCK_MugshotTiles = 22, CHART_WINDOW_TILES = 68;
const CHART_WINDOW_VRAM = vTiles1 + 0x2C * TILE_SIZE + VRAM_BANK1, ARROWS_VRAM = vTiles0 + VRAM_BANK1;
const ApplyCursorBounceX = 0x409B, ApplyCursorBounceY = 0x40C5;
const UpdateAnimatedTilesTask_3b = 0x4428, N64ExhibScrollArrowsTask = 0x4567, N64TnmtScrollArrowsTask = 0x50D6;
const RingShotScrollArrowsTask = 0x5491, RingShotScoreDrawTask = 0x558F;
const BGM_SENIOR_RANKING = 0x22;
const ROW = TILEMAP_WIDTH, TWO_ROWS = 2 * TILEMAP_WIDTH, ATTR = 0x400;
const u8 = (P, a) => P.bus.u8(a), w8 = (P, a, v) => P.bus.w8(a, v);

// ---- the screens' common steps ----
// the 2 x 2 cell at de: tiles t, t+1 / t+2, t+3
function put2x2(P, de, t) {
  w8(P, de, t); w8(P, de + 1, t + 1); w8(P, de + ROW, t + 2); w8(P, de + ROW + 1, t + 3);
}
function fill2x2(P, de, v) { w8(P, de, v); w8(P, de + 1, v); w8(P, de + ROW, v); w8(P, de + ROW + 1, v); }
// a records screen's loop: each frame the pad into wMenuInputPressed, the scroll, a frame; A or B end it
function* recordsLoop(P, scroll, onA = null) {
  const { V } = P;
  wramBank(P, WRAM_SCREEN);
  for (;;) {
    V.menuInputPressed = V.inputPressed;
    if (scroll) yield* callGen(P, scroll(P));
    yield* advanceFrame(P);
    const input = V.menuInputPressed;
    if (input & PADF_A) {
      if (onA) yield* onA(P, input);
      return yield* closeRecordsScreen(P, SFX_MENU_SELECT, null);
    }
    if (input & PADF_B) return yield* closeRecordsScreen(P, SFX_MENU_CANCEL, 0xFF);
    if (!scroll) yield* trophyCounters(P, input);
  }
}
function* closeRecordsScreen(P, sfx, a) {
  sound(P, sfx);
  beginFadeOut(P, 16);
  yield* callGen(P, waitFadeEnd(P, getRegs(P.cpu)));
  const r = callHome(P, HOME.ClearFrameTasks);
  return { a: a ?? r.a };
}
// the screen's opening: LCD on, fade in (16) and its end
function* openRecordsScreen(P) {
  callHome(P, HOME.EnableLCD);
  beginFadeIn(P, 16);
  yield* callGen(P, waitFadeEnd(P, getRegs(P.cpu)));
}
const registerTask = (P, routine) => registerFrameTask(P, 1, routine, P.cpu.sp - 2);
// rows of the WRAM 3 map queued to VRAM: [[first row, count, with attributes], ...]
function queueMapRows(P, bands) {
  for (const [row, count, attrs] of bands) {
    queueCopy(P, cell(wShadowTilemap, 0, row), vBGMap0 + row * ROW, count * ROW / 16);
    if (attrs) queueCopy(P, cell(wShadowAttrmap, 0, row), vBGMap0 + row * ROW + VRAM_BANK1, count * ROW / 16);
  }
}
// the four scroll arrows (QueueStackedSpritePair frames 0-3: right, left, up, down), each bouncing outwards; WRAM 3
// mapped meanwhile. arrowsOf() -> [[shown, x, y, frame], ...]
function scrollArrows(P, arrowsOf) {
  pushWramBank(P, WRAM_SCREEN);
  for (const [shown, x, y, frame] of arrowsOf()) {
    if (!shown) continue;
    const outwards = frame === 0 || frame === 2 ? 1 : 0;
    let d = x, e = y;
    if (frame >= 2) e = applyBobOffset(P, ApplyCursorBounceY, outwards, e).value;
    else d = applyBobOffset(P, ApplyCursorBounceX, outwards, d).value;
    withRomBank(P, BANK_MENU_LIB, () => queueStackedSpritePair(P, 0x08, 0x00, d, e, frame));
  }
  popWramBank(P);
}

// ReadN64RecordsSaveBlock (3B:493F): wN64RecordsBlock (WRAM 3) cleared and the N64 records block read into it.
// Returns a = ReadSaveBlock's result, the flags of the call, hl = the block; bc kept.
export function readN64RecordsSaveBlock(P, f = 0) {
  const a = withWramBank(P, WRAM_SCREEN, () => {
    clearMemory16(P, wN64RecordsBlock, N64_RECORDS_SIZE / 16);
    return withRomBank(P, BANK_SAVE, () => readSaveBlock(P, SAVEBLOCK_N64_RECORDS, wN64RecordsBlock));
  });
  return { a, f, hl: wN64RecordsBlock };
}
// LoadChartWindowTiles (3B:48F2): 68 tiles of the character mugshots (the chart's icons) to de
export const loadChartWindowTiles = (P, dest) => withRomBank(P, BANK_MENU_LIB, () => loadCompressedTileBlock(P, TILEBLOCK_MugshotTiles, dest, CHART_WINDOW_TILES));
// the chart screens' graphics: the icons, the arrows, the arrows' palette (IndexedPalettes $0F as OBJ 0)
function loadChartGraphics(P) {
  loadChartWindowTiles(P, CHART_WINDOW_VRAM);
  withRomBank(P, BANK_MENU_LIB, () => { loadMenuArrowSpriteTiles(P, ARROWS_VRAM); loadIndexedPalette(P, 0x08, 0x0F); });
}
// DrawChartCharIcon (3B:48FA): character b's icon (2 x 2 tiles from $AC + 4b) at hl, its palette
// (ChartCharIconTable) in the attributes. Registers kept.
const ChartCharIconTable = 0x492E, CHAR_ICON_TILES = 0xAC;
export function drawChartCharIcon(P, hl, ch) {
  put2x2(P, hl, (ch * 4 + CHAR_ICON_TILES) & 0xFF);
  fill2x2(P, (hl + ATTR) & 0xFFFF, u8(P, ix(ChartCharIconTable, ch)));
}
// DrawChartIconColumn (3B:46C0): the four characters of the list at hl down from bc, two rows apart
export function drawChartIconColumn(P, list, dest) {
  for (let i = 0; i < 4; i++) drawChartCharIcon(P, (dest + i * TWO_ROWS) & 0xFFFF, u8(P, list + i));
  return { a: 4, b: u8(P, list + 3), c: 4, de: list + 4, hl: (dest + 4 * TWO_ROWS) & 0xFFFF, f: FZ | FN };
}
// DrawChartIconRow (3B:46DA): a characters of the list at hl along from bc
export function drawChartIconRow(P, list, dest, count) {
  let i = 0;
  do { drawChartCharIcon(P, (dest + 2 * i) & 0xFFFF, u8(P, list + i)); i++; count = (count - 1) & 0xFF; } while (count);
  return { a: 0, b: u8(P, list + i - 1), c: 0, de: list + i, hl: (dest + 2 * i) & 0xFFFF, f: FZ | FN };
}
// DrawChartCellRows (3B:46ED): four rows of a cells (rows of the chart 16 bytes apart at hl) as marks from de, two
// map rows apart. a and the flags kept.
export function drawChartCellRows(P, cells, dest, count) {
  for (let r = 0; r < 4; r++) {
    let n = count, i = 0;
    do { drawChartCellMark(P, (dest + r * TWO_ROWS + 2 * i) & 0xFFFF, u8(P, cells + 16 * r + i)); i++; n = (n - 1) & 0xFF; } while (n);
  }
  return { c: 4, de: (dest + 4 * TWO_ROWS) & 0xFFFF, hl: (cells + 64) & 0xFFFF };
}
// DrawChartCellMark (3B:4718): the mark of value b (ChartCellMarkTable) as a 2 x 2 at de. Registers kept.
const ChartCellMarkTable = 0x4738;
export function drawChartCellMark(P, de, v) { put2x2(P, de, u8(P, ix(ChartCellMarkTable, v))); }

// ---- the exhibition chart (n64_3b, n64exhib_3b) ----
const ChartIconColumn = cell(wShadowTilemap, 2, 7), ChartIconRow = cell(wShadowTilemap, 4, 5), ChartCells = cell(wShadowTilemap, 4, 7);
const EXHIB_PAGES_LAST = 9, EXHIB_ROWS_LAST = 0x0C, EXHIB_WINDOW = 7;
// RunN64ExhibData (3B:44AA): see the header
export function* runN64ExhibData(P) {
  sound(P, BGM_STATUS_SCREEN);
  callHome(P, HOME.DisableLCDSafely);
  yield* callGen(P, buildN64ExhibDataScreen(P));
  P.V.animatedTileSet = 0;
  registerTask(P, UpdateAnimatedTilesTask_3b);
  registerTask(P, N64ExhibScrollArrowsTask);
  yield* openRecordsScreen(P);
  return yield* recordsLoop(P, scrollN64ExhibDataCursor);
}
// ScrollN64ExhibDataCursor (3B:450D): left / right a column (0-9), up / down a row (0-12), redrawn
export function* scrollN64ExhibDataCursor(P) {
  const input = P.V.menuInputPressed;
  const step = (addr, delta, limit) => {
    const v = u8(P, addr);
    if (v === limit) return false;
    w8(P, addr, v + delta);
    return true;
  };
  let moved;
  if (input & PADF_LEFT) moved = step(wN64ExhibPage, -1, 0);
  else if (input & PADF_RIGHT) moved = step(wN64ExhibPage, 1, EXHIB_PAGES_LAST);
  else if (input & PADF_UP) moved = step(wN64ExhibCursorRow, -1, 0);
  else if (input & PADF_DOWN) moved = step(wN64ExhibCursorRow, 1, EXHIB_ROWS_LAST);
  if (!moved) return;
  sound(P, SFX_MENU_MOVE);
  yield* callGen(P, redrawN64ExhibDataWindow(P));
}
// N64ExhibScrollArrowsTask (3B:4567), a frame task: the arrows where the window can scroll
export function n64ExhibScrollArrowsTask(P) {
  scrollArrows(P, () => {
    const page = u8(P, wN64ExhibPage), row = u8(P, wN64ExhibCursorRow);
    return [[page !== EXHIB_PAGES_LAST, 0x93, 0x2F, 0], [page !== 0, 0x08, 0x2F, 1], [row !== 0, 0x0A, 0x20, 2], [row !== EXHIB_ROWS_LAST, 0x0A, 0x78, 3]];
  });
}
// BuildN64ExhibDataScreen (3B:45D4): the screen asset, chart graphics, the records (an unreadable block hangs here,
// as on the ROM: `jr nz` to itself), the column list and cells, drawn into the WRAM 3 map and queued.
export function* buildN64ExhibDataScreen(P) {
  wramBank(P, WRAM_SCREEN);
  w8(P, wN64ExhibCursorRow, 0); w8(P, wN64ExhibPage, 0);
  withRomBank(P, BANK_MENU_LIB, () => loadScreenAssetRecord(P, SCREENASSET_ExhibitionMenu));
  loadChartWindowTiles(P, CHART_WINDOW_VRAM);
  withRomBank(P, BANK_MENU_LIB, () => loadMenuArrowSpriteTiles(P, ARROWS_VRAM));
  const f = withRomBank(P, BANK_MENU_LIB, () => loadIndexedPalette(P, 0x08, 0x0F)).f;
  wramBank(P, WRAM_SCREEN);
  readN64RecordsSaveBlock(P, f);
  if (!(f & FZ)) for (;;) yield "halt";                     // .buildN64ExhibColumnList: jr nz, .buildN64ExhibColumnList
  buildN64ExhibColumnList(P);
  initChartRowFlags(P);
  drawChartIconColumn(P, wChartColumnList, ChartIconColumn);
  drawChartIconRow(P, wChartColumnList, ChartIconRow, EXHIB_WINDOW);
  drawChartCellRows(P, wChartRows, ChartCells, EXHIB_WINDOW);
  withRomBank(P, BANK_MENU_LIB, () => queueWram3MapToVRAM(P));
}
// RedrawN64ExhibDataWindow (3B:462D): the window at the page / row: icons, cells; queued over three frames
export function* redrawN64ExhibDataWindow(P) {
  wramBank(P, WRAM_SCREEN);
  const page = u8(P, wN64ExhibPage), row = u8(P, wN64ExhibCursorRow);
  drawChartIconRow(P, ix(wChartColumnList, page), ChartIconRow, EXHIB_WINDOW);
  drawChartIconColumn(P, ix(wChartColumnList, row), ChartIconColumn);
  drawChartCellRows(P, ix((wChartRows + 16 * row) & 0xFFFF, page), ChartCells, EXHIB_WINDOW);
  queueMapRows(P, [[5, 4, true]]);
  yield* advanceFrame(P);
  queueMapRows(P, [[9, 4, true]]);
  yield* advanceFrame(P);
  queueMapRows(P, [[13, 2, true]]);
}
// BuildN64ExhibColumnList (3B:4743): the 16 characters in chart order (N64ExhibColumn), the last two ($10: none) when
// the block has no singles / doubles half; then the results grid.
const N64ExhibColumn = 0x4772;
export function buildN64ExhibColumnList(P) {
  wramBank(P, WRAM_SCREEN);
  copyMemoryFast(P, N64ExhibColumn, wChartColumnList, LIST_SIZE / 16);
  maskMissingHalves(P, wChartColumnList);
  buildN64ExhibResultsGrid(P);
}
function maskMissingHalves(P, list) {
  const halves = u8(P, N64_HALVES);
  if (!(halves & 1)) w8(P, list + 14, NO_ENTRY);
  if (!(halves & 2)) w8(P, list + 15, NO_ENTRY);
}
// InitChartRowFlags (3B:4783): 1 every 17 bytes of wChartRows, 16 times
export function initChartRowFlags(P) {
  let hl = wChartRows;
  for (let i = 0; i < 16; i++) { w8(P, hl, 1); hl = ix(hl, 0x11); }
  return { a: 0x10, c: 0x10, hl, f: FZ | FN };
}
// BuildN64ExhibResultsGrid (3B:479A): row i of wChartRows from the record of character N64ExhibResultsGridTable[i]
const N64ExhibResultsGridTable = 0x47BC;
export function buildN64ExhibResultsGrid(P) {
  for (let i = 0; i < 16; i++) decodeN64ExhibResultsRow(P, u8(P, N64ExhibResultsGridTable + i), wChartRows + 16 * i);
  return { a: 0x10, b: 0x10, de: wChartRows + 0x100, hl: wChartRows + 0x100, f: FZ | FN };
}
// DecodeN64ExhibResultsRow (3B:47CC): character b's 8 record bytes (64 bits: 4 bit planes x 16 opponents)
// expanded, then each opponent (in DecodeN64ExhibResultsRowTable order) its 4-bit value's glyph, into de.
// Registers kept.
const DecodeN64ExhibResultsRowTable = 0x4808, MapExhibCellValueToGlyphTable = 0x4824;
export function decodeN64ExhibResultsRow(P, ch, dest) {
  expandRowBytesToBits(P, ix(N64_EXHIB_ROWS, ch * 8));
  for (let i = 0; i < 16; i++) {
    const v = combineExhibCellBits(P, u8(P, DecodeN64ExhibResultsRowTable + i)).a;
    w8(P, dest + i, mapExhibCellValueToGlyph(P, v).a);
  }
}
// MapExhibCellValueToGlyph (3B:4818): a through MapExhibCellValueToGlyphTable; hl kept, the flags of the index
export function mapExhibCellValueToGlyph(P, v) {
  const l = (MapExhibCellValueToGlyphTable & 0xFF) + v, carry = l > 0xFF;
  const f = carry ? incFlags(MapExhibCellValueToGlyphTable >> 8, FC) : addFlags(v, MapExhibCellValueToGlyphTable & 0xFF);
  return { a: u8(P, ix(MapExhibCellValueToGlyphTable, v)), f };
}
// CombineExhibCellBits (3B:4834): opponent b's (& 15) four bits from the planes of wExhibCellBits, as a value 0-15
export function combineExhibCellBits(P, b) {
  const i = b & 0x0F, bit = plane => u8(P, wExhibCellBits + 16 * plane + i);
  const e = (bit(2) << 2) & 0xFF, d = (bit(1) << 1) & 0xFF, c = bit(0), hi = (bit(3) << 3) & 0xFF;
  const s1 = (hi + e) & 0xFF, s2 = (s1 + d) & 0xFF;
  return { a: (s2 + c) & 0xFF, f: addFlags(s2, c) };
}
// ExpandRowBytesToBits (3B:4870): the 8 bytes at de as 64 bytes of 0/1 (wExhibCellBits, cleared first), each byte
// most significant bit first. Registers kept.
export function expandRowBytesToBits(P, src) {
  clearMemory16(P, wExhibCellBits, 4);
  for (let i = 0; i < 8; i++) expandByteToBitArray(P, wExhibCellBits + 8 * i, u8(P, src + i));
}
// ExpandByteToBitArray (3B:489D): byte b's bits into hl..hl+7, bit 7 first. hl, bc kept; a = the last bit.
export function expandByteToBitArray(P, hl, b) {
  for (let i = 0; i < 8; i++) w8(P, hl + 7 - i, (b >> i) & 1);
  return { a: (b >> 7) & 1, f: FZ | FN };
}
// Unused_3b_FillN64RecordsPalettes (3B:48B8): eight copies of the colors $FFFF, $7777, $3333, $1111 over the
// exhibition rows of the records block (WRAM 3, left mapped)
export function unusedFillN64RecordsPalettes(P) {
  wramBank(P, WRAM_SCREEN);
  let hl = N64_EXHIB_ROWS;
  for (let i = 0; i < 8; i++) for (const v of [0xFF, 0xFF, 0x77, 0x77, 0x33, 0x33, 0x11, 0x11]) w8(P, hl++, v);
  return { a: 0x11, c: 8, hl, f: FZ | FN };
}

// ---- the trophies (n64exhib_3b RunTrophiesScreen .., n64trophies_3b) ----
const CHEAT_CODE = [0x0C, 0x22];
// RunTrophiesScreen (3B:4963): see the header
export function* runTrophiesScreen(P) {
  sound(P, BGM_STATUS_SCREEN);
  callHome(P, HOME.DisableLCDSafely);
  buildTrophiesScreen(P);
  P.V.animatedTileSet = 0;
  registerTask(P, UpdateAnimatedTilesTask_3b);
  w8(P, wN64RecordsBlock + 1, 0); w8(P, wN64RecordsBlock, 0);
  yield* openRecordsScreen(P);
  return yield* recordsLoop(P, null, function* (P2, input) { if (input & PADF_SELECT) checkTrophiesCheatCode(P2); });
}
// the cheat-code counters: left counts up wN64RecordsBlock + 1, right wN64RecordsBlock
function* trophyCounters(P, input) {
  if (input & PADF_LEFT) w8(P, wN64RecordsBlock + 1, u8(P, wN64RecordsBlock + 1) + 1);
  else if (input & PADF_RIGHT) w8(P, wN64RecordsBlock, u8(P, wN64RecordsBlock) + 1);
}
// BuildTrophiesScreen (3B:49E5): the trophy rows decoded; the screen with two rows (the main character and partner)
// or four (both sets, when the second set has any); the rows and the characters' sprites drawn; queued.
const TROPHY_CHAR_ROWS = [6, 13, 8, 15];
export function buildTrophiesScreen(P) {
  const { V } = P;
  wramBank(P, WRAM_SCREEN);
  decodeTrophyCounts(P);
  const both = u8(P, wTrophySecondSetPresent);
  withRomBank(P, BANK_MENU_LIB, () => loadScreenAssetRecord(P, both ? SCREENASSET_N64Tournament : SCREENASSET_N64Tournament2));
  wramBank(P, WRAM_SCREEN);
  drawTrophiesWonRows(P);
  const at = row => cell(wShadowTilemap, 2, row);
  if (!both) {
    drawTrophiesCharSprite(P, V.storyModeMainCharacterOverworldSprite, at(8));
    drawTrophiesCharSprite(P, V.storyModePartnerCharacterOverworldSprite, at(10));
  } else {
    for (const [ch, row] of [[0, 6], [0, 13], [3, 8], [3, 15]]) drawTrophiesCharSprite(P, ch, at(row));
    drawTrophiesCharSprite(P, V.storyModeMainCharacterOverworldSprite, at(6));
    drawTrophiesCharSprite(P, V.storyModePartnerCharacterOverworldSprite, at(8));
    drawTrophiesCharSprite(P, V.storyModeMainCharacterOverworldSprite, at(13));
    drawTrophiesCharSprite(P, V.storyModePartnerCharacterOverworldSprite, at(15));
  }
  withRomBank(P, BANK_MENU_LIB, () => queueWram3MapToVRAM(P));
}
// DrawTrophiesWonRows (3B:4A71): the trophy rows, one after another from wTrophyCellsMainSet1, at rows 8, 10 (or
// 6, 8, 13, 15)
export function drawTrophiesWonRows(P) {
  let hl = wTrophyCellsMainSet1, r;
  for (const row of u8(P, wTrophySecondSetPresent) ? [6, 8, 13, 15] : [8, 10]) r = drawTrophyRowPair(P, hl, cell(wShadowTilemap, 5, row)), hl = r.hl;
  return r;
}
// DrawTrophyRowPair (3B:4AA3): six cells at hl (three, a gap, three) as won trophies from de. Returns hl and de after.
export function drawTrophyRowPair(P, hl, de) {
  for (let half = 0; half < 2; half++) {
    for (let i = 0; i < 3; i++) { if (u8(P, hl++)) drawWonTrophyIcon(P, de); de += 2; }
    if (!half) de++;
  }
  return { a: 3, c: 3, hl, de, f: FZ | FN };
}
// DrawWonTrophyIcon (3B:4AC9): the trophy (tiles $60-$63, attribute $0A) at de. Registers kept.
export function drawWonTrophyIcon(P, de) { put2x2(P, de, 0x60); fill2x2(P, (de + ATTR) & 0xFFFF, 0x0A); }
// DrawTrophiesCharSprite (3B:4AF1): character c's 2 x 2 face (from row 18 of the map, 2c across) at de, attributes too
export function drawTrophiesCharSprite(P, ch, de) {
  const src = ix(cell(wShadowTilemap, 0, 18), ch * 2);
  withRomBank(P, BANK_MENU_LIB, () => {
    copyTilemapRect(P, src, de, 2, 2);
    copyTilemapRect(P, (src + ATTR) & 0xFFFF, (de + ATTR) & 0xFFFF, 2, 2);
  });
  return { bc: 0x0202, hl: (src + ATTR) & 0xFFFF, de: (de + ATTR) & 0xFFFF };
}
// CheckTrophiesCheatCode (3B:4B19): a jingle; counters at 12 and 34 unlock everything; the story file saved.
export function checkTrophiesCheatCode(P) {
  sound(P, BGM_SENIOR_RANKING);
  if (u8(P, wN64RecordsBlock) === CHEAT_CODE[0] && u8(P, wN64RecordsBlock + 1) === CHEAT_CODE[1]) applyUnlockEverythingCheat(P);
  withRomBank(P, BANK_SAVE, () => saveStorySlot(P));
  return { a: 0, f: FZ };
}
// ApplyUnlockEverythingCheat (3B:4B33): every court, hidden character and minigame level's save flag; in each story
// file, the 13 cheat game flags (then saved); the N64 unlockables.
const UNLOCK_SAVE_FLAGS = [0x0720, 0x0740, 0x0760, 0x0780, 0x07A0, 0x0140, 0x0160, 0x0180, 0x01A0, 0x01C0, 0x01E0,
  0x0280, 0x02A0, 0x02E0, 0x0300, 0x0340, 0x0360, 0x03A0, 0x03C0, 0x0500, 0x0520, 0x0560, 0x0580, 0x05C0, 0x05E0,
  0x0620, 0x0640, 0x0680, 0x06A0];
const CHEAT_GAME_FLAGS = [160, 161, 162, 163, 164, 165, 166, 167, 168, 171, 172, 169, 170];   // FLAG_CHEAT_UNLOCK_0-12
const SAVE_NO_BLOCK = 0xFE;
export function applyUnlockEverythingCheat(P) {
  const { V } = P;
  withRomBank(P, BANK_SAVE, () => { for (const flag of UNLOCK_SAVE_FLAGS) setSaveFlag(P, flag); });
  const slot = V.currentStorySlot;
  for (let file = 0; file < 3; file++) {
    V.currentStorySlot = file;
    if (withRomBank(P, BANK_SAVE, () => checkStorySlot(P)).a === SAVE_NO_BLOCK) continue;
    for (const flag of CHEAT_GAME_FLAGS) setGameFlag(P, (flag >> 3) << 8 | (flag & 7) << 5);
    withRomBank(P, BANK_SAVE, () => saveStorySlot(P));
  }
  V.currentStorySlot = slot;
  withRomBank(P, BANK_SAVE, () => setAllUnlockablesInSaveBlock(P));
  return { a: slot };
}
// DecodeTrophyCounts (3B:4C53): the four 2-bit counts of each of wN64TrophyCounts' two bytes (bits 0-1 and 4-5:
// the first set; 2-3 and 6-7: the second) as rows of cells; wTrophySecondSetPresent = 1 if the second set has any
// (it is not cleared otherwise).
const TROPHY_FIELDS = [[0, 0, 0], [0, 4, 3], [0, 2, 0x0C], [0, 6, 0x0F], [1, 0, 6], [1, 4, 9], [1, 2, 0x12], [1, 6, 0x15]];
export function decodeTrophyCounts(P) {
  wramBank(P, WRAM_SCREEN);
  callHome(P, HOME.ClearBytes, { hl: wTrophyCellsMainSet1, bc: wTrophyCellsSize });
  for (const [byte, shift, at] of TROPHY_FIELDS) fillTrophyCountCells(P, wTrophyCellsMainSet1 + at, (u8(P, P.A.n64TrophyCounts + byte) >> shift) & 3);
  if ([wTrophyCellsMainSet2, wTrophyCellsMainSet2 + 3, wTrophyCellsPartnerSet2, wTrophyCellsPartnerSet2 + 3].some(a => u8(P, a))) w8(P, wTrophySecondSetPresent, 1);
}
// FillTrophyCountCells (3B:4ED1): b cells of 1 from de. Leaves a = 0 (Z); bc, de kept.
export function fillTrophyCountCells(P, de, count) {
  for (; count; count = (count - 1) & 0xFF) w8(P, de++, 1);
  return { a: 0, f: FZ };
}

// ---- the tournament records (n64trophies_3b RunN64TnmtData .., n64tnmt_3b) ----
const N64TnmtData = 0x4E44, N64CharTrophyRowPtrTable = 0x4E87, TNMT_ROWS_LAST = 0x0B, TNMT_WINDOW = 5;
// RunN64TnmtData (3B:4CFA): see the header
export function* runN64TnmtData(P) {
  sound(P, BGM_STATUS_SCREEN);
  callHome(P, HOME.DisableLCDSafely);
  buildN64TnmtDataScreen(P);
  P.V.animatedTileSet = 0;
  registerTask(P, UpdateAnimatedTilesTask_3b);
  registerTask(P, N64TnmtScrollArrowsTask);
  yield* openRecordsScreen(P);
  return yield* recordsLoop(P, scrollN64TnmtDataCursor);
}
// ScrollN64TnmtDataCursor (3B:4D5D): left / right between the pages (the second only if there is one:
// wScreenScratch), up / down a row (0-11), redrawn
export function* scrollN64TnmtDataCursor(P) {
  const input = P.V.menuInputPressed, page = u8(P, wDataScreenPage), row = u8(P, wDataScreenCursorRow);
  if (input & PADF_LEFT) { if (!page) return; w8(P, wDataScreenPage, 0); }
  else if (input & PADF_RIGHT) { if (!u8(P, wScreenScratch) || page) return; w8(P, wDataScreenPage, 1); }
  else if (input & PADF_UP) { if (!row) return; w8(P, wDataScreenCursorRow, row - 1); }
  else if (input & PADF_DOWN) { if (row === TNMT_ROWS_LAST) return; w8(P, wDataScreenCursorRow, row + 1); }
  else return;
  sound(P, SFX_MENU_MOVE);
  yield* callGen(P, redrawN64TnmtDataWindow(P));
}
// BuildN64TnmtDataScreen (3B:4DBD): the screen asset, the records, the chart graphics, the window drawn; queued
export function buildN64TnmtDataScreen(P) {
  withRomBank(P, BANK_MENU_LIB, () => loadScreenAssetRecord(P, SCREENASSET_ModeSelect));
  wramBank(P, WRAM_SCREEN);
  w8(P, wScreenScratch, 0); w8(P, wDataScreenPage, 0); w8(P, wDataScreenCursorRow, 0);
  loadN64TnmtDataRecords(P);
  wramBank(P, WRAM_SCREEN);
  loadChartGraphics(P);
  drawN64TnmtRowIcons(P);
  drawN64TnmtPageLabels(P);
  drawN64TnmtTrophyRows(P);
  withRomBank(P, BANK_MENU_LIB, () => queueWram3MapToVRAM(P));
}
// LoadN64TnmtDataRecords (3B:4DFF): WRAM 3 from $D800 cleared, the character list, the records, the trophy grid;
// wScreenScratch = 1 if there is a second page
export function loadN64TnmtDataRecords(P) {
  wramBank(P, WRAM_SCREEN);
  clearMemory16(P, wScreenScratch, 0x80);
  copyMemoryBC(P, N64TnmtData, wN64TnmtLayout, LIST_SIZE);
  readN64RecordsSaveBlock(P);
  maskMissingHalves(P, wN64TnmtLayout);
  buildN64TnmtTrophyGrid(P);
  if (checkN64TnmtSecondPage(P).a) w8(P, wScreenScratch, 1);
}
// BuildN64TnmtTrophyGrid (3B:4E54): row i (12 cells) of wN64TnmtTrophyCells from the trophy byte of character i
export function buildN64TnmtTrophyGrid(P) {
  for (let i = 0; i < 16; i++) decodeN64CharTrophyCounts(P, getN64CharTrophyRowPtr(P, i).hl, wN64TnmtTrophyCells + TNMT_ROW * i);
  return { a: 0x10, c: 0x10, de: wN64TnmtTrophyCells + 16 * TNMT_ROW, f: FZ | FN };
}
// GetN64CharTrophyRowPtr (3B:4E74): hl = character b's trophy byte (N64CharTrophyRowPtrTable order)
export function getN64CharTrophyRowPtr(P, b) {
  const a = u8(P, ix(N64CharTrophyRowPtrTable, b)), l = (N64_TNMT_ROWS & 0xFF) + a;
  return { a: l & 0xFF, hl: ix(N64_TNMT_ROWS, a), f: l > 0xFF ? incFlags(N64_TNMT_ROWS >> 8, FC) : addFlags(a, N64_TNMT_ROWS & 0xFF) };
}
// DecodeN64CharTrophyCounts (3B:4E97): the byte at hl's four 2-bit counts (bits 0-1, 4-5, 2-3, 6-7) as four groups
// of three cells at de. Registers kept.
export function decodeN64CharTrophyCounts(P, hl, de) {
  const v = u8(P, hl);
  [v & 3, (v >> 4) & 3, (v >> 2) & 3, (v >> 6) & 3].forEach((n, i) => fillTrophyCountCells(P, de + 3 * i, n));
}
// CheckN64TnmtSecondPage (3B:4EE3): whether the tournament records need the second page, by the ROM's test of
// columns 2 and 5 of the rows: a = 1 or 0
export function checkN64TnmtSecondPage(P) {
  const col = (c, rows) => Array.from({ length: rows }, (_, i) => u8(P, wN64TnmtTrophyCells + c + TNMT_ROW * i));
  if (col(2, 14).every(Boolean) && col(5, 16).some(Boolean)) return { a: 1, f: 0 };
  if (!col(5, 14).every(Boolean)) return { a: 0, f: FZ };
  return { a: 1, f: col(2, 16).some(Boolean) ? 0 : FZ | FN };
}
// RedrawN64TnmtDataWindow (3B:4F38): icons, page labels, trophies; queued over three frames
export function* redrawN64TnmtDataWindow(P) {
  drawN64TnmtRowIcons(P);
  drawN64TnmtPageLabels(P);
  drawN64TnmtTrophyRows(P);
  yield* callGen(P, flushN64TnmtWindowToVram(P));
}
// DrawN64TnmtRowIcons (3B:4F45): the five characters of the window down the left. Registers and the WRAM bank kept.
export function drawN64TnmtRowIcons(P) {
  withWramBank(P, WRAM_SCREEN, () => {
    const list = ix(wN64TnmtLayout, u8(P, wDataScreenCursorRow));
    for (let i = 0; i < TNMT_WINDOW; i++) drawChartCharIcon(P, cell(wShadowTilemap, 2, 7 + 2 * i), u8(P, list + i));
  });
}
// DrawN64TnmtPageLabels (3B:4F81): the two column headings (singles, doubles) of the page, from row 18 of the map
export function drawN64TnmtPageLabels(P) {
  withWramBank(P, WRAM_SCREEN, () => {
    const src = u8(P, wDataScreenPage) ? 6 : 0;
    withRomBank(P, BANK_MENU_LIB, () => {
      for (const map of [wShadowTilemap, wShadowAttrmap]) for (const x of [5, 12]) copyTilemapRect(P, cell(map, src, 18), cell(map, x, 5), 6, 2);
    });
  });
}
// DrawN64TnmtTrophyRows (3B:5000): the window's five rows of trophies (the page's six cells of each)
export function drawN64TnmtTrophyRows(P) {
  wramBank(P, WRAM_SCREEN);
  let hl = ix(wN64TnmtTrophyCells, u8(P, wDataScreenCursorRow) * TNMT_ROW);
  if (u8(P, wDataScreenPage)) hl = ix(hl, 6);
  for (let i = 0; i < TNMT_WINDOW; i++) { drawN64TnmtTrophyRow(P, hl, cell(wShadowTilemap, 5, 7 + 2 * i)); hl = ix(hl, TNMT_ROW); }
}
// DrawN64TnmtTrophyRow (3B:5042): six cells at hl (three, a gap, three): won trophies or empty cells. Registers kept.
export function drawN64TnmtTrophyRow(P, hl, de) {
  for (let half = 0; half < 2; half++) {
    for (let i = 0; i < 3; i++) { if (u8(P, hl++)) drawWonTrophyIcon(P, de); else drawEmptyTrophyCell(P, de); de += 2; }
    de++;
  }
}
// DrawEmptyTrophyCell (3B:507A): the empty cell's tiles (row 18 of the map, x 12) at de. Registers kept.
export function drawEmptyTrophyCell(P, de) { withRomBank(P, BANK_MENU_LIB, () => copyTilemapRect(P, cell(wShadowTilemap, 12, 18), de, 2, 2)); }
// FlushN64TnmtWindowToVram (3B:508D): map rows 5-16 queued, four at a time, over three frames
export function* flushN64TnmtWindowToVram(P) {
  queueMapRows(P, [[5, 4, true]]);
  yield* advanceFrame(P);
  queueMapRows(P, [[9, 4, true]]);
  yield* advanceFrame(P);
  queueMapRows(P, [[13, 4, true]]);
}
// N64TnmtScrollArrowsTask (3B:50D6), a frame task
export function n64TnmtScrollArrowsTask(P) {
  scrollArrows(P, () => {
    const page = u8(P, wDataScreenPage), row = u8(P, wDataScreenCursorRow);
    return [[u8(P, wScreenScratch) && !page, 0x93, 0x2F, 0], [page, 0x20, 0x2F, 1], [row, 0x0C, 0x32, 2], [row !== TNMT_ROWS_LAST, 0x0C, 0x88, 3]];
  });
}

// ---- the ring shot records (n64tnmt_3b RunN64RingShotData .., ring_3b) ----
const N64RingShot = 0x5278, DefaultRingShot0 = 0x52E9, DefaultRingShot1 = 0x52F9, RingShotResultsGridTable = 0x5358;
const RingShotModeTabTable = 0x544E, RingShotClearMarkRowTable = 0x5564, RingShotMarkCellTable = 0x558B;
const RING_MODES_LAST = 3, RING_ROWS_LAST = 0x0B, RING_WINDOW = 5, RING_MARKS = 5, RING_ROW = 12, RING_SCORES = 4;
// RunN64RingShotData (3B:5148): see the header
export function* runN64RingShotData(P) {
  callHome(P, HOME.DisableLCDSafely);
  sound(P, BGM_STATUS_SCREEN);
  buildN64RingShotScreen(P);
  P.V.animatedTileSet = 0;
  registerTask(P, UpdateAnimatedTilesTask_3b);
  registerTask(P, RingShotScrollArrowsTask);
  registerTask(P, RingShotScoreDrawTask);
  yield* openRecordsScreen(P);
  return yield* recordsLoop(P, scrollRingShotCursor);
}
// BuildN64RingShotScreen (3B:51B3): the cursor at mode 0, row 0; the screen asset, the records, the chart graphics,
// the digit sprites (attribute 9, from tile $10); the window drawn; queued
export function buildN64RingShotScreen(P) {
  const { V } = P;
  V.menuCursorX = 0; V.menuCursorY = 0;
  withRomBank(P, BANK_MENU_LIB, () => loadScreenAssetRecord(P, SCREENASSET_RingShotHud));
  wramBank(P, WRAM_SCREEN);
  loadN64RingShotRecords(P);
  wramBank(P, WRAM_SCREEN);
  loadChartGraphics(P);
  withRomBank(P, BANK_MENU_LIB, () => initNumberSpriteGfx(P, 0x09, 0, vTiles0 + 0x10 * TILE_SIZE + VRAM_BANK1));
  V.digitSpriteAttr = 0x09;
  V.digitSpriteTileBase = 0x10;
  drawRingShotRowIcons(P);
  drawRingShotModeTab(P);
  drawRingShotClearMarks(P);
  withRomBank(P, BANK_MENU_LIB, () => queueWram3MapToVRAM(P));
}
// DrawRingShotRowIcons (3B:5202): the window's five characters down the left. Registers and the WRAM bank kept.
export function drawRingShotRowIcons(P) {
  withWramBank(P, WRAM_SCREEN, () => {
    const list = ix(wRingShotEntryList, P.V.menuCursorY);
    for (let i = 0; i < RING_WINDOW; i++) drawChartCharIcon(P, cell(wShadowTilemap, 2, 6 + 2 * i), u8(P, list + i));
  });
}
// LoadN64RingShotRecords (3B:523E): the records, the character list, the results grid ($140 bytes cleared first)
export function loadN64RingShotRecords(P) {
  wramBank(P, WRAM_SCREEN);
  readN64RecordsSaveBlock(P);
  copyMemoryBC(P, N64RingShot, wRingShotEntryList, LIST_SIZE);
  maskMissingHalves(P, wRingShotEntryList);
  callHome(P, HOME.ClearBytes, { hl: wChartRows, bc: 0x140 });
  buildRingShotResultsGrid(P);
}
// Unused_3b_SeedDefaultRingShotRecords (3B:5288): default records copied into the block's ring-shot part
export function unusedSeedDefaultRingShotRecords(P) {
  let r;
  for (let i = 0; i < 4; i++) r = copyMemoryBC(P, DefaultRingShot0, N64_RING_CLEARS + 16 * i, 0x10);
  for (let i = 0; i < 4; i++) r = copyMemoryBC(P, DefaultRingShot1, N64_RING_SCORES + 32 * i, 0x20);
  return { ...r, bc: 0, f: FZ | FN };
}
// BuildRingShotResultsGrid (3B:5319): 16 rows of 12: the clears of 4 modes (0-6 rings each), then the 4 scores
// (words), each row a character in RingShotResultsGridTable order
export function buildRingShotResultsGrid(P) {
  for (let i = 0; i < 16; i++) decodeRingShotCharClears(P, u8(P, RingShotResultsGridTable + i), wChartRows + RING_ROW * i);
  for (let i = 0; i < 16; i++) copyRingShotCharScores(P, u8(P, RingShotResultsGridTable + i), wChartRows + 4 + RING_ROW * i);
  return { a: 0x10, c: 0x10, de: wChartRows + 4 + RING_ROW * 16, hl: wChartRows + 4 + RING_ROW * 16, f: FZ | FN };
}
// CopyRingShotCharScores (3B:5368): character b's four big-endian scores as little-endian words at de. Registers kept.
export function copyRingShotCharScores(P, ch, de) {
  const hl = ix(N64_RING_SCORES, ch * 8);
  for (let i = 0; i < RING_SCORES; i++) { w8(P, de + 2 * i, u8(P, hl + 2 * i + 1)); w8(P, de + 2 * i + 1, u8(P, hl + 2 * i)); }
}
// DecodeRingShotCharClears (3B:538E): character b's four mode bytes as counts of rings cleared. Registers kept.
export function decodeRingShotCharClears(P, ch, de) {
  const hl = ix(N64_RING_CLEARS, ch * 4);
  for (let i = 0; i < 4; i++) w8(P, de + i, countConsecutiveSetBits(u8(P, hl + i)).a);
}
// CountConsecutiveSetBits (3B:53B2): the number of 1 bits from bit 0 up to the first 0, at most 6
export function countConsecutiveSetBits(b) {
  let n = 0;
  while (b & 1) { b >>= 1; n++; if (n === 6) return { a: 6, f: FZ | FN }; }
  return { a: n, f: FZ | FH };
}
// ScrollRingShotCursor (3B:53C6): right / left the mode (0-3), up / down the first row (0-11), redrawn
export function* scrollRingShotCursor(P) {
  const { V } = P, input = V.menuInputPressed;
  if (input & PADF_RIGHT) { if (V.menuCursorX === RING_MODES_LAST) return; V.menuCursorX++; }
  else if (input & PADF_LEFT) { if (!V.menuCursorX) return; V.menuCursorX--; }
  else if (input & PADF_UP) { if (!V.menuCursorY) return; V.menuCursorY--; }
  else if (input & PADF_DOWN) { if (V.menuCursorY === RING_ROWS_LAST) return; V.menuCursorY++; }
  else return;
  yield* callGen(P, redrawRingShotWindow(P));
}
// RedrawRingShotWindow (3B:5417): the move sound; icons, marks, mode tab; queued over two frames
export function* redrawRingShotWindow(P) {
  sound(P, SFX_MENU_MOVE);
  drawRingShotRowIcons(P);
  drawRingShotClearMarks(P);
  drawRingShotModeTab(P);
  yield* callGen(P, flushRingShotWindowToVram(P));
}
// DrawRingShotModeTab (3B:5426): the mode's 8 x 2 tab (from the right of the map) at the top
export function drawRingShotModeTab(P) {
  withWramBank(P, WRAM_SCREEN, () => {
    const src = P.bus.u16(ix(RingShotModeTabTable, P.V.menuCursorX * 2));
    withRomBank(P, BANK_MENU_LIB, () => copyTilemapRect(P, src, cell(wShadowTilemap, 6, 1), 8, 2));
  });
}
// FlushRingShotWindowToVram (3B:5456): the tab and the rows 6-15 queued over two frames
export function* flushRingShotWindowToVram(P) {
  queueMapRows(P, [[1, 2, false], [6, 4, true]]);
  yield* advanceFrame(P);
  queueMapRows(P, [[10, 6, true]]);
}
// RingShotScrollArrowsTask (3B:5491), a frame task
export function ringShotScrollArrowsTask(P) {
  scrollArrows(P, () => {
    const { V } = P;
    return [[V.menuCursorX !== RING_MODES_LAST, 0x78, 0x12, 0], [V.menuCursorX, 0x23, 0x12, 1], [V.menuCursorY, 0x0C, 0x26, 2], [V.menuCursorY !== RING_ROWS_LAST, 0x0C, 0x82, 3]];
  });
}
// DrawRingShotClearMarks (3B:54FE): for the window's five rows, the mode's count of rings cleared as marks
export function drawRingShotClearMarks(P) {
  let hl = ix((wChartRows + RING_ROW * P.V.menuCursorY) & 0xFFFF, P.V.menuCursorX);
  for (let row = 0; row < RING_WINDOW; row++) { drawRingShotClearMarkRow(P, row, u8(P, hl)); hl = (hl + RING_ROW) & 0xFFFF; }
}
// DrawRingShotClearMarkRow (3B:5529): on window row b, c cleared marks then 5 - c empty ones (c = 6: 255 empty
// ones, as on the ROM). Registers kept.
export function drawRingShotClearMarkRow(P, row, cleared) {
  let de = P.bus.u16(ix(RingShotClearMarkRowTable, row * 2));
  for (let n = cleared; n; n = (n - 1) & 0xFF) { drawRingShotMarkCell(P, 0, de); de += 2; }
  for (let n = (RING_MARKS - cleared) & 0xFF; n; n = (n - 1) & 0xFF) { drawRingShotMarkCell(P, 1, de); de = (de + 2) & 0xFFFF; }
}
// DrawRingShotMarkCell (3B:556E): mark b (0 cleared, 1 not) as a 2 x 2 at de. Registers kept.
export function drawRingShotMarkCell(P, mark, de) {
  const src = P.bus.u16(ix(RingShotMarkCellTable, mark * 2));
  withRomBank(P, BANK_MENU_LIB, () => copyTilemapRect(P, src, de, 2, 2));
}
// RingShotScoreDrawTask (3B:558F), a frame task: the window's five scores of the mode as digit sprites
export function ringShotScoreDrawTask(P) {
  const { V } = P;
  let hl = ix(ix((wChartRows + RING_ROW * V.menuCursorY) & 0xFFFF, 4), V.menuCursorX * 2), de = 0x8A35;
  for (let i = 0; i < RING_WINDOW; i++) {
    withRomBank(P, BANK_MENU_LIB, () => drawDecimalNumberSprites(P, P.bus.u16(hl), de >> 8, de & 0xFF));
    de = (de + 0x10) & 0xFFFF;
    hl = ix(hl, RING_ROW);
  }
  return { a: 5, c: 5, de, hl, f: FZ | FN };
}

export const HOOKS = [
  [BANK_MAIN_MENU, 0x44AA, hookGen(P => runN64ExhibData(P))],
  [BANK_MAIN_MENU, 0x450D, hookGen(P => scrollN64ExhibDataCursor(P))],
  [BANK_MAIN_MENU, 0x4567, hook(P => { n64ExhibScrollArrowsTask(P); })],
  [BANK_MAIN_MENU, 0x45D4, hookGen(P => buildN64ExhibDataScreen(P))],
  [BANK_MAIN_MENU, 0x462D, hookGen(P => redrawN64ExhibDataWindow(P))],
  [BANK_MAIN_MENU, 0x46C0, hook((P, c) => drawChartIconColumn(P, c.hl, c.bc))],
  [BANK_MAIN_MENU, 0x46DA, hook((P, c) => drawChartIconRow(P, c.hl, c.bc, c.a))],
  [BANK_MAIN_MENU, 0x46ED, hook((P, c) => drawChartCellRows(P, c.hl, c.de, c.a))],
  [BANK_MAIN_MENU, 0x4718, hook((P, c) => { drawChartCellMark(P, c.de, c.b); })],
  [BANK_MAIN_MENU, 0x4743, hook(P => { buildN64ExhibColumnList(P); })],
  [BANK_MAIN_MENU, 0x4771, () => {}],                        // Unused_3b_StubNop1
  [BANK_MAIN_MENU, 0x4783, hook(P => initChartRowFlags(P))],
  [BANK_MAIN_MENU, 0x479A, hook(P => buildN64ExhibResultsGrid(P))],
  [BANK_MAIN_MENU, 0x47CC, hook((P, c) => { decodeN64ExhibResultsRow(P, c.b, c.de); })],
  [BANK_MAIN_MENU, 0x4818, hook((P, c) => mapExhibCellValueToGlyph(P, c.a))],
  [BANK_MAIN_MENU, 0x4834, hook((P, c) => combineExhibCellBits(P, c.b))],
  [BANK_MAIN_MENU, 0x4870, hook((P, c) => { expandRowBytesToBits(P, c.de); })],
  [BANK_MAIN_MENU, 0x489D, hook((P, c) => expandByteToBitArray(P, c.hl, c.b))],
  [BANK_MAIN_MENU, 0x48B8, hook(P => unusedFillN64RecordsPalettes(P))],
  [BANK_MAIN_MENU, 0x48F2, hook((P, c) => loadChartWindowTiles(P, c.de))],
  [BANK_MAIN_MENU, 0x48FA, hook((P, c) => { drawChartCharIcon(P, c.hl, c.b); })],
  [BANK_MAIN_MENU, 0x493F, hook((P, c) => readN64RecordsSaveBlock(P, c.f))],
  [BANK_MAIN_MENU, 0x4963, hookGen(P => runTrophiesScreen(P))],
  [BANK_MAIN_MENU, 0x49E4, () => {}],                        // Unused_3b_StubNop2
  [BANK_MAIN_MENU, 0x49E5, hook(P => { buildTrophiesScreen(P); })],
  [BANK_MAIN_MENU, 0x4A71, hook(P => drawTrophiesWonRows(P))],
  [BANK_MAIN_MENU, 0x4AA3, hook((P, c) => drawTrophyRowPair(P, c.hl, c.de))],
  [BANK_MAIN_MENU, 0x4AC9, hook((P, c) => { drawWonTrophyIcon(P, c.de); })],
  [BANK_MAIN_MENU, 0x4AF1, hook((P, c) => drawTrophiesCharSprite(P, c.c, c.de))],
  [BANK_MAIN_MENU, 0x4B19, hook(P => checkTrophiesCheatCode(P))],
  [BANK_MAIN_MENU, 0x4B33, hook(P => applyUnlockEverythingCheat(P))],
  [BANK_MAIN_MENU, 0x4C53, hook(P => { decodeTrophyCounts(P); })],
  [BANK_MAIN_MENU, 0x4CFA, hookGen(P => runN64TnmtData(P))],
  [BANK_MAIN_MENU, 0x4D5D, hookGen(P => scrollN64TnmtDataCursor(P))],
  [BANK_MAIN_MENU, 0x4DBD, hook(P => { buildN64TnmtDataScreen(P); })],
  [BANK_MAIN_MENU, 0x4DFF, hook(P => { loadN64TnmtDataRecords(P); })],
  [BANK_MAIN_MENU, 0x4E54, hook(P => buildN64TnmtTrophyGrid(P))],
  [BANK_MAIN_MENU, 0x4E74, hook((P, c) => getN64CharTrophyRowPtr(P, c.b))],
  [BANK_MAIN_MENU, 0x4E97, hook((P, c) => { decodeN64CharTrophyCounts(P, c.hl, c.de); })],
  [BANK_MAIN_MENU, 0x4ED1, hook((P, c) => fillTrophyCountCells(P, c.de, c.b))],
  [BANK_MAIN_MENU, 0x4EE3, hook(P => checkN64TnmtSecondPage(P))],
  [BANK_MAIN_MENU, 0x4F38, hookGen(P => redrawN64TnmtDataWindow(P))],
  [BANK_MAIN_MENU, 0x4F45, hook(P => { drawN64TnmtRowIcons(P); })],
  [BANK_MAIN_MENU, 0x4F81, hook(P => { drawN64TnmtPageLabels(P); })],
  [BANK_MAIN_MENU, 0x5000, hook(P => { drawN64TnmtTrophyRows(P); })],
  [BANK_MAIN_MENU, 0x5042, hook((P, c) => { drawN64TnmtTrophyRow(P, c.hl, c.de); })],
  [BANK_MAIN_MENU, 0x507A, hook((P, c) => { drawEmptyTrophyCell(P, c.de); })],
  [BANK_MAIN_MENU, 0x508D, hookGen(P => flushN64TnmtWindowToVram(P))],
  [BANK_MAIN_MENU, 0x50D6, hook(P => { n64TnmtScrollArrowsTask(P); })],
  [BANK_MAIN_MENU, 0x5148, hookGen(P => runN64RingShotData(P))],
  [BANK_MAIN_MENU, 0x51B3, hook(P => { buildN64RingShotScreen(P); })],
  [BANK_MAIN_MENU, 0x5202, hook(P => { drawRingShotRowIcons(P); })],
  [BANK_MAIN_MENU, 0x523E, hook(P => { loadN64RingShotRecords(P); })],
  [BANK_MAIN_MENU, 0x5288, hook(P => unusedSeedDefaultRingShotRecords(P))],
  [BANK_MAIN_MENU, 0x5319, hook(P => buildRingShotResultsGrid(P))],
  [BANK_MAIN_MENU, 0x5368, hook((P, c) => { copyRingShotCharScores(P, c.b, c.de); })],
  [BANK_MAIN_MENU, 0x538E, hook((P, c) => { decodeRingShotCharClears(P, c.b, c.de); })],
  [BANK_MAIN_MENU, 0x53B2, hook((P, c) => countConsecutiveSetBits(c.b))],
  [BANK_MAIN_MENU, 0x53C6, hookGen(P => scrollRingShotCursor(P))],
  [BANK_MAIN_MENU, 0x5417, hookGen(P => redrawRingShotWindow(P))],
  [BANK_MAIN_MENU, 0x5426, hook(P => { drawRingShotModeTab(P); })],
  [BANK_MAIN_MENU, 0x5456, hookGen(P => flushRingShotWindowToVram(P))],
  [BANK_MAIN_MENU, 0x5491, hook(P => { ringShotScrollArrowsTask(P); })],
  [BANK_MAIN_MENU, 0x54FE, hook(P => { drawRingShotClearMarks(P); })],
  [BANK_MAIN_MENU, 0x5529, hook((P, c) => { drawRingShotClearMarkRow(P, c.b, c.c); })],
  [BANK_MAIN_MENU, 0x556E, hook((P, c) => { drawRingShotMarkCell(P, c.b, c.de); })],
  [BANK_MAIN_MENU, 0x558F, hook(P => ringShotScoreDrawTask(P))],
];
