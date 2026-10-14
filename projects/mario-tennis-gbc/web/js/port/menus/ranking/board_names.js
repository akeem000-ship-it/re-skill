// The ranking board's names and singles highlights (bank $1B): the story player's name (split over two rows with a
// hyphen when longer than 5) and the other entrants' names rendered into the bracket, their boxes' attributes, and
// the singles bracket's highlighted rows (rects from the map's hidden rows 18-24 and columns 20-27).
// Port of the code of src/engine/menus/ranking/board_names_1b.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm); names and addresses are its own. Tables are read from the ROM.
// Covered by the lockstep on the out/port/xr_island*.mtrec recordings.
import {
  FZ, ix, far, rom, romWait, FAR, hook, hookGen, advanceFrame, romWord, BANK_RANKING, BANK_MENU_LIB, WRAM_SCREEN, WRAM_TEXT,
  wShadowTilemap, wShadowAttrmap, PADF_A, PADF_B, cell,
} from "../exp/defs.js";
import { copyMemoryBC } from "../../home/memory.js";
import { copyTilemapRect, fillTilemapRect } from "../common/tilemaps.js";
import { drawNameWithDiacritics } from "../main_menu/n64.js";

export const BANK = BANK_RANKING;
// ROM data and routines (bank $1B)
const SinglesRankingEntryTable = 0x555E, SinglesRankingEntryTable1 = 0x5576;
const DoublesRankingEntryTable = 0x5627, DoublesRankingEntryTable1 = 0x5641, RankingRowDrawHandlers_1b = 0x5761;
const hInputPressed = 0xFF91;
const ENTRIES = 0x0C, NAME_CELLS = 0x05, NAME_FITS = 6, NAME_ROW = 4, NAME_ROW_BUFFER = 7, HYPHEN = 0x2D;
const tile = (row, col) => cell(wShadowTilemap, row, col);

// WaitForAOrBPress (1B:5507): frames until A or B is held
export function* waitForAOrBPress(P) {
  for (;;) {
    yield* advanceFrame(P);
    const a = P.bus.u8(hInputPressed) & (PADF_A | PADF_B);
    if (a) return { a };
  }
}
// DrawSinglesRankingNames (1B:5511): the singles bracket: the player and entrants 1-11, the glyphs uploaded
export function* drawSinglesRankingNames(P) {
  initRankingNameRender(P);
  P.wramBank(WRAM_SCREEN);
  clearSinglesRankingNameRects(P);
  renderPlayerNameFitted(P, P.A.storyModeNameOfMainCharacter, tile(1, 1));
  for (let b = 1; b < ENTRIES; b++) drawRankingEntry(P, b, SinglesRankingEntryTable, SinglesRankingEntryTable1);
  return yield* romWait(P, FAR.UploadGlyphBuffer);
}
// DrawSinglesRankingEntry (1B:5536) / DrawDoublesRankingEntry (1B:55FF): entrant b's name (its text) at its cell,
// 5 cells wide. Registers kept.
export function drawRankingEntry(P, b, texts, cells) {
  const de = romWord(P, ix(cells, b * 2)), hl = romWord(P, ix(texts, b * 2));
  rom(P, FAR.RenderProportionalTextAt, { hl, de, c: NAME_CELLS });
}
// ClearSinglesRankingNameRects (1B:558E) / ClearDoublesRankingNameRects (1B:5659): the name boxes' attributes: the
// left column palette 0, the right one palette 1. Registers kept.
export function clearRankingNameRects(P, start, boxes, height, step) {
  for (const [col, h] of [[0, 0], [13, 1]]) {
    let de = (start + col) & 0xFFFF;
    for (let b = 0; b < boxes; b++) {
      far(P, BANK_MENU_LIB, () => fillTilemapRect(P, de, NAME_CELLS, height, h));
      de = (de + step) & 0xFFFF;
    }
  }
}
const clearSinglesRankingNameRects = P => clearRankingNameRects(P, cell(wShadowAttrmap, 0, 1), 6, 2, 0x60);
const clearDoublesRankingNameRects = P => clearRankingNameRects(P, cell(wShadowAttrmap, 1, 1), 3, 4, 0xA0);
// DrawDoublesRankingNames (1B:55D1): the doubles bracket: the player and partner, entrants 2-11
export function* drawDoublesRankingNames(P) {
  initRankingNameRender(P);
  P.wramBank(WRAM_SCREEN);
  clearDoublesRankingNameRects(P);
  renderPlayerNameFitted(P, P.A.storyModeNameOfMainCharacter, tile(2, 1));
  renderPlayerNameFitted(P, P.A.storyModeNameOfPartnerCharacter, tile(4, 1));
  for (let b = 2; b < ENTRIES; b++) drawRankingEntry(P, b, DoublesRankingEntryTable, DoublesRankingEntryTable1);
  return yield* romWait(P, FAR.UploadGlyphBuffer);
}
// InitRankingNameRender (1B:569C): the text windows reset, glyphs stamped into WRAM 3's map (attribute 0)
export function initRankingNameRender(P) {
  rom(P, FAR.InitTextWindows);
  P.wramBank(WRAM_TEXT);
  P.V.shadowTilemapBank = WRAM_SCREEN;
  P.V.windowTileAttr = 0;
  return rom(P, FAR.PrepareGlyphBuffer);
}
// RenderPlayerNameFitted (1B:56B3): the name at hl into the map at de: one row, or over two (RenderNameTwoRows)
export function renderPlayerNameFitted(P, hl, de) {
  if (getStringLength(P, hl).a < NAME_FITS) return drawNameWithDiacritics(P, hl, de);
  return renderNameTwoRows(P, hl, de);
}
// GetStringLength (1B:56C2): a = the length of the 0-ended string at hl
export function getStringLength(P, hl) {
  let c = 0;
  while (P.bus.u8((hl + c) & 0xFFFF)) c++;
  return { a: c & 0xFF, f: FZ };                                    // (the flags of the last `or a`)
}
// RenderNameTwoRows (1B:56CF): the name's first 4 letters and a hyphen a row above de, the rest at de
export function renderNameTwoRows(P, hl, de) {
  renderNameTopRow(P, hl, (de - 0x20) & 0xFFFF);
  return renderNameBottomRow(P, hl, de);
}
// RenderNameTopRow (1B:56E2) / RenderNameBottomRow (1B:56FA): through wRankingNameRowBuffer
export function renderNameTopRow(P, hl, de) {
  const buf = P.A.rankingNameRowBuffer;
  copyMemoryBC(P, hl, buf, NAME_ROW);
  P.bus.w8(buf + NAME_ROW, HYPHEN); P.bus.w8(buf + NAME_ROW + 1, 0);
  return drawNameWithDiacritics(P, buf, de);
}
export function renderNameBottomRow(P, hl, de) {
  const buf = P.A.rankingNameRowBuffer;
  copyMemoryBC(P, (hl + NAME_ROW) & 0xFFFF, buf, NAME_ROW_BUFFER);
  return { bc: 0, ...drawNameWithDiacritics(P, buf, de) };
}
// HighlightSinglesRankingRows (1B:5710): the rows already won before the round: rows 1-4 (row 2), 5-8 (row 3), or
// row 11 (past it)
export function highlightSinglesRankingRows(P) {
  const a = P.bus.u8(P.A.rankingBoardPlayerRow);
  if (a === 0 || a === 1) return { a, f: FZ };
  const rows = a === 2 ? [1, 2, 3, 4] : a === 3 ? [5, 6, 7, 8] : [11];
  let r;
  for (const b of rows) r = highlightRankingRow(P, b);
  return r;
}
// HighlightRankingRow (1B:5750): row b's highlight (RankingRowDrawHandlers_1b: DrawRankingRow0-11, then
// StubNop_1b_07)
const SINGLES_ROWS = {                                               // handler: [src row, col, dest row, col, w, h]
  0x5779: [18, 0, 1, 6, 5, 2], 0x5789: [20, 0, 10, 6, 4, 2], 0x5799: [18, 4, 1, 10, 4, 2], 0x57A9: [20, 4, 10, 10, 4, 2],
  0x57B9: [22, 0, 1, 6, 4, 7], 0x57C9: [22, 8, 10, 6, 4, 7], 0x57D9: [22, 4, 1, 10, 4, 7], 0x57E9: [22, 12, 10, 10, 4, 7],
  0x57F9: [0, 20, 1, 6, 4, 16], 0x5809: [0, 24, 1, 10, 4, 16], 0x5819: [0, 20, 1, 6, 8, 16],
};
export function highlightRankingRow(P, b) {
  if (!b) return { a: 0, f: FZ };
  const handler = romWord(P, ix(RankingRowDrawHandlers_1b, b * 2)), rect = SINGLES_ROWS[handler];
  if (!rect) throw new Error(`HighlightRankingRow: row ${b} jumps to ${handler.toString(16)}`);
  return drawRankingRow(P, ...rect);
}
export function drawRankingRow(P, sr, sc, dr, dc, w, h) {
  far(P, BANK_MENU_LIB, () => copyTilemapRect(P, tile(sr, sc), tile(dr, dc), w, h));
  return { b: w, c: h, de: tile(dr, dc), hl: tile(sr, sc) };
}

export const HOOKS = [
  [BANK, 0x5507, hookGen(P => waitForAOrBPress(P))],
  [BANK, 0x5511, hookGen(function* (P) { yield* drawSinglesRankingNames(P); })],
  [BANK, 0x5536, hook((P, c) => { drawRankingEntry(P, c.b, SinglesRankingEntryTable, SinglesRankingEntryTable1); })],
  [BANK, 0x558E, hook(P => { clearSinglesRankingNameRects(P); })],
  [BANK, 0x55D1, hookGen(function* (P) { yield* drawDoublesRankingNames(P); })],
  [BANK, 0x55FF, hook((P, c) => { drawRankingEntry(P, c.b, DoublesRankingEntryTable, DoublesRankingEntryTable1); })],
  [BANK, 0x5659, hook(P => { clearDoublesRankingNameRects(P); })],
  [BANK, 0x569C, hook(P => { initRankingNameRender(P); })],
  [BANK, 0x56B3, hook((P, c) => renderPlayerNameFitted(P, c.hl, c.de))],
  [BANK, 0x56C2, hook((P, c) => getStringLength(P, c.hl))],
  [BANK, 0x56CF, hook((P, c) => renderNameTwoRows(P, c.hl, c.de))],
  [BANK, 0x56E2, hook((P, c) => renderNameTopRow(P, c.hl, c.de))],
  [BANK, 0x56FA, hook((P, c) => renderNameBottomRow(P, c.hl, c.de))],
  [BANK, 0x5710, hook(P => { highlightSinglesRankingRows(P); })],
  [BANK, 0x5750, hook((P, c) => { highlightRankingRow(P, c.b); })],
  [BANK, 0x5760, () => {}],                                          // StubNop_1b_07
  ...Object.entries(SINGLES_ROWS).map(([addr, rect]) => [BANK, +addr, hook(P => { drawRankingRow(P, ...rect); })]),
];
