// The story's team bracket and the Mario-cast exhibition chart (bank $3B): the varsity team chart (singles or
// doubles) with the player's row highlighted and blinking; the chart of the Mario cast's exhibition victories (who
// beat whom, at what difficulty: a 9 x 9 grid saved with the records), scrolled with the d-pad, smaller until all
// columns are unlocked. And the exhibition victory itself: recorded in the grid, the Warehouse court unlocked once a
// character has beaten all the others.
// Port of the code of src/engine/menus/ranking/bracket_3b.asm and victory_3b.asm of the gerbiljames/
// mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm); names and addresses are its own. Tables are
// read from the ROM.
// Covered by the lockstep on out/engine/exh1.mtrec (RecordExhibitionVictory after an exhibition) and the out/port/xr_*
// recordings (the team bracket, the exhibition chart from the main menu).
import {
  FZ, rd, wr, ix, far, rom, home, HOME, FAR, hook, hookGen, sound, advanceFrame, waitFrames, fadeIn, fadeOut,
  registerFrameTask, queueVRAMCopy, romWord, romByte, testFlag, regs8, BANK_BRACKET, BANK_MENU_LIB, BANK_SAVE,
  BANK_CURSOR_38, WRAM_SCREEN, TILE_SIZE, VRAM_BANK1, vTiles0, vTiles1, vTiles2, vBGMap0, wShadowTilemap, wShadowAttrmap,
  PADF_A, PADF_B, PADF_LEFT, PADF_RIGHT, PADF_UP, PADF_DOWN, BGM_STATUS_SCREEN, SFX_MARKER, SFX_MENU_MOVE,
  SFX_MENU_SELECT, SFX_MENU_CANCEL, FLAG, SAVEFLAG, WINLOSE_LOSE, SCREENASSET_VarsityTeamChart, SCREENASSET_VarsityTeamChart2,
  SCREENASSET_ExhibitionMenu, TILEBLOCK_TournamentBracketGfx, TournamentBracketGfx_BLOCKS, cell,
} from "../exp/defs.js";
import { enableLCD } from "../../home/system.js";
import { clearFrameTasks } from "../../home/debugtext.js";
import { loadPalettesImmediate } from "../../home/palettes.js";
import { copyMemoryBC } from "../../home/memory.js";
import { testSaveFlag, setSaveFlag } from "../../save/storyslots.js";
import { readMarioCastVictoryGrid, writeMarioCastVictoryGrid } from "../../save/results.js";
import { loadScreenAssetRecord, fillTilemapRect, copyTilemapRect, queueWram3MapToVRAM } from "../common/tilemaps.js";
import { loadCompressedTileBlock, loadMenuArrowSpriteTiles, loadIndexedPalette, queueStackedSpritePair } from "../common/menu_lib.js";
import { isMarioCastCharacter } from "../char_select/grid_data.js";
import { drawNameWithDiacritics } from "../main_menu/n64.js";
import { drawChartIconRow, drawChartIconColumn, drawChartCellRows, loadChartWindowTiles, initChartRowFlags } from "../main_menu/n64data.js";

export const BANK = BANK_BRACKET;
// ROM data and routines (bank $3B)
const WriteBracketSinglesNamesPtrs = 0x7889, WriteBracketEntrantNameTable = 0x78E4;
const HighlightBracketPlayerRowTable = 0x79B6, BracketPlayerRowTable0 = 0x79C0, BracketPlayerRowTable1 = 0x79CA;
const BracketPlayerRowTable2 = 0x79D0, BracketHighlightBlinkTaskPalettes0 = 0x79E9, BracketHighlightBlinkTaskPalettes1 = 0x79F1;
const MarioCastChartColumnListTable = 0x7D03, MarioCastChartColumnTable = 0x7D15;
const VictoryScoreTable = 0x7DD9, VictoryScoreTable1 = 0x7DDD, MarioCastOrderTable = 0x7DED;
const BracketHighlightBlinkTask = 0x79D6, UpdateAnimatedTilesTask_3b = 0x4428, MarioCastChartScrollArrowsTask = 0x7A6D;
const hInputPressed = 0xFF91, hVBlankCounter = 0xFF8C;
const Text_30_75 = 0x004B, Text_30_76 = 0x004C, ENTRANT_NAMES = 0x004B;   // the entrants' names: text $4B + n - 1
const MARIO_CAST = 9, FIRST_MARIO_CAST = 0x17, CHART_ROW = 0x10, COLUMN_LOCKED = 0x10;
const tile = (row, col) => cell(wShadowTilemap, row, col), attr = (row, col) => cell(wShadowAttrmap, row, col);
const fill = (P, de, w, h, v) => far(P, BANK_MENU_LIB, () => fillTilemapRect(P, de, w, h, v));

// ---- the team bracket ----
// ShowTournamentBracket (3B:775D): the chart (b: 0 singles, 1 doubles) with row c highlighted, until A or B
export function* showTournamentBracket(P, b, c) {
  P.wramBank(WRAM_SCREEN);
  wr(P, "screenScratch", b);
  wr(P, "dataScreenPage", c);
  home(P, HOME.DisableLCDSafely);
  buildTournamentBracketScreen(P);
  enableLCD(P);
  yield* fadeIn(P, 16);
  registerFrameTask(P, 1, BracketHighlightBlinkTask);
  sound(P, SFX_MARKER);
  yield* waitFrames(P, 120);
  for (;;) {
    if (P.bus.u8(hInputPressed) & (PADF_A | PADF_B)) break;
    yield* advanceFrame(P);
  }
  sound(P, SFX_MENU_SELECT);
  clearFrameTasks(P);
  yield* fadeOut(P, 16);
  return {};
}
// BuildTournamentBracketScreen (3B:77A7): the chart's maps and tiles, the name boxes, the names, the highlight
export function buildTournamentBracketScreen(P) {
  const two = rd(P, "screenScratch");
  far(P, BANK_MENU_LIB, () => loadScreenAssetRecord(P, two ? SCREENASSET_VarsityTeamChart2 : SCREENASSET_VarsityTeamChart));
  far(P, BANK_MENU_LIB, () => loadCompressedTileBlock(P, TILEBLOCK_TournamentBracketGfx, vTiles2, TournamentBracketGfx_BLOCKS));
  P.wramBank(WRAM_SCREEN);
  clearTournamentBracketAttrs(P);
  drawTournamentBracketNameBoxes(P);
  if (two) writeBracketDoublesNames(P); else writeBracketSinglesNames(P);
  highlightBracketPlayerRow(P);
  return far(P, BANK_MENU_LIB, () => queueWram3MapToVRAM(P));
}
// ClearTournamentBracketAttrs (3B:77F7): the names' area (7 x 8) attribute 0
export function clearTournamentBracketAttrs(P) { fill(P, attr(8, 9), 7, 8, 0x00); }
// DrawTournamentBracketNameBoxes (3B:7804): the names' area blank, a box edge above each name (4 rows; doubles 2)
export function drawTournamentBracketNameBoxes(P) {
  fill(P, tile(8, 9), 7, 8, 0x20);
  for (const row of rd(P, "screenScratch") ? [8, 12] : [8, 10, 12, 14]) fill(P, tile(row, 9), 7, 1, 0x03);
}
// WriteBracketSinglesNames (3B:786C): the four entrants of the player's group (WriteBracketSinglesNamesPtrs by row)
export function writeBracketSinglesNames(P) {
  let hl = romWord(P, ix(WriteBracketSinglesNamesPtrs, rd(P, "dataScreenPage") * 2));
  for (let b = 0; b < 4; b++) { writeBracketEntrantName(P, romByte(P, hl), b); hl = (hl + 1) & 0xFFFF; }
  return { b: 4, hl };
}
// WriteBracketEntrantName (3B:78A3): entrant a (0: the story player's name, else text $4B + a - 1) on line b.
// Registers kept.
export function writeBracketEntrantName(P, a, b) {
  const de = romWord(P, ix(WriteBracketEntrantNameTable, b * 2));
  if (!a) { drawNameWithDiacritics(P, P.A.storyModeNameOfMainCharacter, de); return; }
  rom(P, FAR.RenderTextToBuffer64, { hl: ix(ENTRANT_NAMES, a - 1), de, c: 0x20 });
}
// WriteBracketDoublesNames (3B:78EC): the player's pair and the rival pair (text $4B, $4C), the player's first on
// row 1, else second
export function writeBracketDoublesNames(P) {
  const [mine, theirs] = rd(P, "dataScreenPage") === 1 ? [9, 13] : [13, 9];
  drawNameWithDiacritics(P, P.A.storyModeNameOfMainCharacter, tile(mine, 9));
  drawNameWithDiacritics(P, P.A.storyModeNameOfPartnerCharacter, tile(mine + 2, 9));
  rom(P, FAR.RenderTextToBuffer64, { hl: Text_30_75, de: tile(theirs, 9), c: 0x20 });
  return rom(P, FAR.RenderTextToBuffer64, { hl: Text_30_76, de: tile(theirs + 2, 9), c: 0x20 });
}
// HighlightBracketPlayerRow (3B:7945): the player's name box palette 5, its bracket line palette $0D (one row less
// for the singles' row 4)
export function highlightBracketPlayerRow(P) {
  const page = rd(P, "dataScreenPage");
  if (!rd(P, "screenScratch")) {
    fill(P, romWord(P, ix(HighlightBracketPlayerRowTable, page * 2)), 7, 2, 0x05);
    fill(P, romWord(P, ix(BracketPlayerRowTable0, page * 2)), 2, page === 4 ? 1 : 2, 0x0D);
    return;
  }
  fill(P, romWord(P, ix(BracketPlayerRowTable1, page * 2)), 7, 4, 0x05);
  fill(P, romWord(P, ix(BracketPlayerRowTable2, page * 2)), 2, 3, 0x0D);
}
// BracketHighlightBlinkTask (3B:79D6), a frame task: BG palette 5 blinking (16 frames each)
export function bracketHighlightBlinkTask(P) {
  const hl = P.bus.u8(hVBlankCounter) & 0x10 ? BracketHighlightBlinkTaskPalettes1 : BracketHighlightBlinkTaskPalettes0;
  return loadPalettesImmediate(P, hl, 5, 1);
}

// ---- the Mario-cast exhibition chart ----
// RunMarioCastExhibResults (3B:79F9): the chart until A (a as left) or B (a = $FF)
export function* runMarioCastExhibResults(P) {
  sound(P, BGM_STATUS_SCREEN);
  home(P, HOME.DisableLCDSafely);
  buildMarioCastExhibScreen(P);
  P.V.animatedTileSet = 1;
  P.V.animatedTilePeriod = 3;
  registerFrameTask(P, 1, UpdateAnimatedTilesTask_3b);
  registerFrameTask(P, 1, MarioCastChartScrollArrowsTask);
  enableLCD(P);
  yield* fadeIn(P, 16);
  P.wramBank(WRAM_SCREEN);
  for (;;) {
    yield* advanceFrame(P);
    P.V.menuInputPressed = P.bus.u8(hInputPressed);
    if (checkMarioCastChartExpanded(P).a) yield* scrollMarioCastChartCursorFull(P);
    else yield* scrollMarioCastChartCursorSmall(P);
    const input = P.V.menuInputPressed;
    if (input & PADF_A) { sound(P, SFX_MENU_SELECT); yield* fadeOut(P, 16); return clearFrameTasks(P); }
    if (input & PADF_B) { sound(P, SFX_MENU_CANCEL); yield* fadeOut(P, 16); clearFrameTasks(P); return { a: 0xFF }; }
  }
}
// MarioCastChartScrollArrowsTask (3B:7A6D), a frame task: the bouncing arrows on the sides the chart can scroll to
export function marioCastChartScrollArrowsTask(P) {
  const bank = P.V.wramBank;
  P.wramBank(WRAM_SCREEN);
  const x = P.V.menuCursorX, y = P.V.menuCursorY;
  const arrow = (d, e, c, bounce, h) => {
    const r = rom(P, bounce, { d, e, c });
    far(P, BANK_MENU_LIB, () => queueStackedSpritePair(P, 0x08, 0x00, r.d, r.e, h));
  };
  if (checkMarioCastChartExpanded(P).a) {
    if (x !== 2) arrow(0x93, 0x2F, 1, FAR.ApplyCursorBounceX, 0);
    if (x !== 0) arrow(0x08, 0x2F, 0, FAR.ApplyCursorBounceX, 1);
    if (y !== 0) arrow(0x0A, 0x20, 1, FAR.ApplyCursorBounceY, 2);
    if (y !== 5) arrow(0x0A, 0x78, 0, FAR.ApplyCursorBounceY, 3);
  } else {
    if (y !== 0) arrow(0x1A, 0x20, 1, FAR.ApplyCursorBounceY, 2);
    if (y !== 1) arrow(0x1A, 0x78, 0, FAR.ApplyCursorBounceY, 3);
  }
  P.wramBank(bank);
  return { a: bank };
}
// BuildMarioCastExhibScreen (3B:7B11): the chart's maps and tiles, the arrows, the column list, the grid, the smaller
// layout when not all are unlocked, the window drawn
export function buildMarioCastExhibScreen(P) {
  P.wramBank(WRAM_SCREEN);
  wr(P, "n64ExhibCursorRow", 0);
  wr(P, "n64ExhibPage", 0);
  far(P, BANK_MENU_LIB, () => loadScreenAssetRecord(P, SCREENASSET_ExhibitionMenu));
  loadChartWindowTiles(P, vTiles1 + 0x2C * TILE_SIZE + VRAM_BANK1);
  far(P, BANK_MENU_LIB, () => loadMenuArrowSpriteTiles(P, vTiles0 + VRAM_BANK1));
  far(P, BANK_MENU_LIB, () => loadIndexedPalette(P, 0x08, 0x0F));
  P.wramBank(WRAM_SCREEN);
  buildMarioCastChartColumnList(P);
  loadMarioCastExhibGrid(P);
  applyMarioCastChartReducedLayout(P);
  initChartRowFlags(P);
  redrawMarioCastChartWindow(P);
  return far(P, BANK_MENU_LIB, () => queueWram3MapToVRAM(P));
}
// the cursor moved (a menu sound, the window redrawn and flushed)
function* moved(P, name, v) {
  P.V[name] = v;
  sound(P, SFX_MENU_MOVE);
  redrawMarioCastChartWindow(P);
  yield* flushMarioCastChartWindowToVram(P);
}
// ScrollMarioCastChartCursorFull (3B:7B4F): the full chart's window (3 x 6 positions) moved by the d-pad
export function* scrollMarioCastChartCursorFull(P) {
  const input = P.V.menuInputPressed, x = P.V.menuCursorX, y = P.V.menuCursorY;
  if (input & PADF_LEFT) { if (x) yield* moved(P, "menuCursorX", x - 1); }
  else if (input & PADF_RIGHT) { if (x !== 2) yield* moved(P, "menuCursorX", x + 1); }
  else if (input & PADF_UP) { if (y) yield* moved(P, "menuCursorY", y - 1); }
  else if (input & PADF_DOWN) { if (y !== 5) yield* moved(P, "menuCursorY", y + 1); }
  return {};
}
// ScrollMarioCastChartCursorSmall (3B:7BB5): the smaller chart's window (2 positions) moved up / down
export function* scrollMarioCastChartCursorSmall(P) {
  const input = P.V.menuInputPressed, y = P.V.menuCursorY;
  if (input & PADF_UP) { if (y) yield* moved(P, "menuCursorY", y - 1); }
  else if (input & PADF_DOWN) { if (y !== 1) yield* moved(P, "menuCursorY", y + 1); }
  return {};
}
// RedrawMarioCastChartWindow (3B:7BEA): the window onto the chart at the cursor: the column heads, the row heads, the
// cells (7 x 4 in the full chart, 5 x 4 in the smaller one)
export function redrawMarioCastChartWindow(P) {
  P.wramBank(WRAM_SCREEN);
  const full = checkMarioCastChartExpanded(P).a, n = full ? 7 : 5, left = full ? 4 : 6;
  const list = P.A.chartColumnList, x = P.V.menuCursorX, y = P.V.menuCursorY;
  drawChartIconRow(P, ix(list, x), tile(5, left), n);
  drawChartIconColumn(P, ix(list, y), tile(7, left - 2));
  return drawChartCellRows(P, ix((P.A.chartRows + CHART_ROW * y) & 0xFFFF, x), tile(7, left), n);
}
// FlushMarioCastChartWindowToVram (3B:7C81): map rows 5-14 (both maps) queued over three frames
export function* flushMarioCastChartWindowToVram(P) {
  const rows = [[5, 4], [9, 4], [13, 2]];
  let r;
  for (let i = 0; i < rows.length; i++) {
    const [row, n] = rows[i];
    queueVRAMCopy(P, tile(row, 0), vBGMap0 + row * 32, n * 2);
    r = queueVRAMCopy(P, attr(row, 0), vBGMap0 + row * 32 + VRAM_BANK1, n * 2);
    if (i < rows.length - 1) yield* advanceFrame(P);
  }
  return r;
}
// BuildMarioCastChartColumnList (3B:7CCA): the chart's 9 columns: each character (MarioCastChartColumnTable), or
// $10 (locked) while its unlock save flag (MarioCastChartColumnListTable; $FFFF: always there) is clear
export function buildMarioCastChartColumnList(P) {
  for (let c = 0; c < MARIO_CAST; c++) {
    const de = romWord(P, ix(MarioCastChartColumnListTable, c * 2));
    const always = ((de >> 8) | de) & 0xFF;
    const open = always === 0xFF || far(P, BANK_SAVE, () => testSaveFlag(P, de));
    P.bus.w8(ix(P.A.chartColumnList, c), open ? romByte(P, ix(MarioCastChartColumnTable, c)) : COLUMN_LOCKED);
  }
  return { c: MARIO_CAST };
}
// LoadMarioCastExhibGrid (3B:7D1E): the saved victory grid (9 x 9) into the chart's rows (16 bytes apart)
export function loadMarioCastExhibGrid(P) {
  const bank = P.V.wramBank;
  P.wramBank(WRAM_SCREEN);
  far(P, BANK_SAVE, () => readMarioCastVictoryGrid(P, P.A.n64RecordsBlock));
  for (let c = 0; c < MARIO_CAST; c++) copyMemoryBC(P, P.A.n64RecordsBlock + 9 * c, P.A.chartRows + CHART_ROW * c, 9);
  P.wramBank(bank);
  return { a: bank };
}

// ---- victory_3b ----
// RecordExhibitionVictory (3B:7D57): a singles exhibition won between two Mario-cast characters: the winner's row,
// the loser's column of the victory grid takes the difficulty's score if higher; the unlocks checked; the grid
// saved. The WRAM bank kept.
export function recordExhibitionVictory(P) {
  const bank = P.V.wramBank;
  P.wramBank(WRAM_SCREEN);
  const done = () => { P.wramBank(bank); return { a: bank }; };
  if (P.V.matchWinLoseFlag === WINLOSE_LOSE || testFlag(P, FLAG.DOUBLES)) return done();
  const p1 = P.V.player1CurrentMainCharacter, p2 = P.V.player2CurrentMainCharacter;
  if (!far(P, BANK_CURSOR_38, () => isMarioCastCharacter(p1)).a) return done();
  if (!far(P, BANK_CURSOR_38, () => isMarioCastCharacter(p2)).a) return done();
  const d = getMarioCastIndex(P, p1).a, e = getMarioCastIndex(P, p2).a;
  far(P, BANK_SAVE, () => readMarioCastVictoryGrid(P, P.A.n64RecordsBlock));
  const hl = ix(P.A.n64RecordsBlock, d * 9 + e);
  const score = getVictoryScore(P, P.V.exhibitionModeCPUMainCharacterDifficulty).a;
  if (score < P.bus.u8(hl)) return done();
  P.bus.w8(hl, score);
  updateMarioCastUnlocks(P);
  far(P, BANK_SAVE, () => writeMarioCastVictoryGrid(P, P.A.n64RecordsBlock));   // (Z: on a failure the ROM hangs)
  return done();
}
// GetVictoryScore (3B:7DC4): the score of difficulty a (VictoryScoreTable, or ...1 with wVictoryScoreTableAlt)
export function getVictoryScore(P, a) {
  const hl = ix(P.V.victoryScoreTableAlt ? VictoryScoreTable1 : VictoryScoreTable, a);
  return { a: romByte(P, hl), b: a, hl };
}
// GetMarioCastIndex (3B:7DE1): Mario-cast character a's grid index
export function getMarioCastIndex(P, a) {
  const hl = ix(MarioCastOrderTable, a - FIRST_MARIO_CAST);
  return { a: romByte(P, hl), hl };
}
// UpdateMarioCastUnlocks (3B:7DF6): a grid row with a victory over every other character opens the Warehouse court
export function updateMarioCastUnlocks(P) {
  for (let c = 0; c < MARIO_CAST; c++) {
    const row = ix(P.A.n64RecordsBlock, c * 9);
    let all = true;
    for (let b = 0; b < MARIO_CAST && all; b++) if (b !== c && !P.bus.u8(row + b)) all = false;
    if (all) { far(P, BANK_SAVE, () => setSaveFlag(P, SAVEFLAG.COURT_WAREHOUSE)); return {}; }
  }
  return { c: MARIO_CAST };
}
// CheckMarioCastChartExpanded (3B:7E25): a = 1 when the chart's seventh column is unlocked (the full chart)
export function checkMarioCastChartExpanded(P) {
  const bank = P.V.wramBank, open = P.bus.u8(P.A.chartColumnList + 6) !== COLUMN_LOCKED;
  P.wramBank(bank);
  return open ? { a: 1 } : { a: 0, f: FZ };
}
// ApplyMarioCastChartReducedLayout (3B:7E43): for the smaller chart its map (from the hidden rows 18-29), the header
// column and the rows compacted. Registers and the WRAM bank kept.
export function applyMarioCastChartReducedLayout(P) {
  const bank = P.V.wramBank;
  P.wramBank(WRAM_SCREEN);
  if (!checkMarioCastChartExpanded(P).a) {
    copyMarioCastChartReducedTilemap(P);
    fixupMarioCastChartHeaderRow(P);
    compactMarioCastChartRows(P);
  }
  P.wramBank(bank);
}
// CopyMarioCastChartReducedTilemap (3B:7E69)
export function copyMarioCastChartReducedTilemap(P) {
  far(P, BANK_MENU_LIB, () => copyTilemapRect(P, tile(18, 1), tile(4, 1), 0x12, 0x0C));
  far(P, BANK_MENU_LIB, () => copyTilemapRect(P, attr(18, 1), attr(4, 1), 0x12, 0x0C));
}
// FixupMarioCastChartHeaderRow (3B:7E84): column 5 moved to column 4
export function fixupMarioCastChartHeaderRow(P) {
  const a = P.bus.u8(P.A.chartColumnList + 5);
  P.bus.w8(P.A.chartColumnList + 4, a);
  return { a };
}
// CompactMarioCastChartRows (3B:7E8B): row 5 over row 4, and column 5 over column 4 in rows 0-5
export function compactMarioCastChartRows(P) {
  const rows = P.A.chartRows;
  copyMemoryBC(P, rows + 80, rows + 64, CHART_ROW);
  for (let c = 0; c < 6; c++) P.bus.w8(rows + 4 + CHART_ROW * c, P.bus.u8(rows + 5 + CHART_ROW * c));
  return { c: 6, f: FZ };
}

export const HOOKS = [
  [BANK, 0x775D, hookGen((P, c) => showTournamentBracket(P, c.b, c.c))],
  [BANK, 0x77A7, hook(P => { buildTournamentBracketScreen(P); })],
  [BANK, 0x77F7, hook(P => { clearTournamentBracketAttrs(P); })],
  [BANK, 0x7804, hook(P => { drawTournamentBracketNameBoxes(P); })],
  [BANK, 0x786C, hook(P => writeBracketSinglesNames(P))],
  [BANK, 0x78A3, hook((P, c) => { writeBracketEntrantName(P, c.a, c.b); })],
  [BANK, 0x78EC, hook(P => { writeBracketDoublesNames(P); })],
  [BANK, 0x7945, hook(P => { highlightBracketPlayerRow(P); })],
  [BANK, 0x79D6, hook(P => { bracketHighlightBlinkTask(P); })],
  [BANK, 0x79F9, hookGen(P => runMarioCastExhibResults(P))],
  [BANK, 0x7A6D, hook(P => marioCastChartScrollArrowsTask(P))],
  [BANK, 0x7B11, hook(P => { buildMarioCastExhibScreen(P); })],
  [BANK, 0x7B4F, hookGen(P => scrollMarioCastChartCursorFull(P))],
  [BANK, 0x7BB5, hookGen(P => scrollMarioCastChartCursorSmall(P))],
  [BANK, 0x7BEA, hook(P => { redrawMarioCastChartWindow(P); })],
  [BANK, 0x7C81, hookGen(P => flushMarioCastChartWindowToVram(P))],
  [BANK, 0x7CCA, hook(P => buildMarioCastChartColumnList(P))],
  [BANK, 0x7D1E, hook(P => loadMarioCastExhibGrid(P))],
  [BANK, 0x7D57, hook(P => recordExhibitionVictory(P))],
  [BANK, 0x7DC3, () => {}],                                          // Unused_3b_StubNop5
  [BANK, 0x7DC4, hook((P, c) => getVictoryScore(P, c.a))],
  [BANK, 0x7DE1, hook((P, c) => getMarioCastIndex(P, c.a))],
  [BANK, 0x7DF6, hook(P => updateMarioCastUnlocks(P))],
  [BANK, 0x7E25, hook(P => checkMarioCastChartExpanded(P))],
  [BANK, 0x7E43, hook(P => { applyMarioCastChartReducedLayout(P); })],
  [BANK, 0x7E69, hook(P => { copyMarioCastChartReducedTilemap(P); })],
  [BANK, 0x7E84, hook(P => fixupMarioCastChartHeaderRow(P))],
  [BANK, 0x7E8B, hook(P => compactMarioCastChartRows(P))],
];
