// The results screen's texts (bank $1E): the headers by game mode (exhibition and dream-match players, the class and
// rank of a ranking match, the Island Open round, a practice match), the players' names, the sets and games won,
// and the text helpers the EXP screens share (WriteTextToTilemap: a string into the maps with its diacritics in the
// row above; FetchAndDrawDialogueText; DrawProportionalTextLine).
// Port of the code of src/engine/menus/results/exhibresults_1e.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm); names and addresses are its own.
// Covered by the lockstep on out/engine/exh1.mtrec, rec1.mtrec (an exhibition's results) and the out/port/xr_*
// recordings (xr_results: each game mode's layout; xr_misc: the Island Open semifinal and final), and by
// web/tests/port/routines_menus_exp.mjs.
import {
  FZ, FN, far, rom, FAR, hook, testFlag, formatDecimalNumberUnsigned, regs8, cpFlags, BANK_EXP, WRAM_COURT_PLANES,
  WRAM_SCREEN, wShadowTilemap, wScreenAttrmap, wTextBuffer, FLAG, cell,
} from "../exp/defs.js";
import { loadSinglesLabelTiles, loadDoublesLabelTiles, drawResultsNameLabelRows } from "./results_screen.js";
import { clearRoundLabelRow, drawPracticeMatchLabel, drawMarioExhibitionLabel } from "./results_prompt.js";

export const BANK = BANK_EXP;
const Text_31_215 = 0x04D7, Text_31_218 = 0x04DA, Text_31_219 = 0x04DB, Text_31_220 = 0x04DC, Text_31_221 = 0x04DD;
const Text_31_222 = 0x04DE, Text_31_223 = 0x04DF, Text_31_225 = 0x04E1, Text_31_226 = 0x04E2, Text_31_227 = 0x04E3;
const Text_31_229 = 0x04E5, Text_31_230 = 0x04E6;
const TEXT_ROW = 0x0020, LINE_WIDTH = 0x12;
const DAKUTEN = 0xDE, HANDAKUTEN = 0xDF, WINDOW_BLANK = 0x03, MARK_ON_BLANK = 0xD0, BLANK = 0x20;
const NAME_FITS = 5;
const doubles = P => testFlag(P, FLAG.TEMP_RESULTS_SCREEN_OPEN);

// ---- the headers (BuildResultsScreenPanels' last step, by wGameMode) ----
// the name-label rows of singles or doubles (the labels' tiles decompressed, then DrawResultsNameLabelRows with a)
function labels(P, rowsLayout) {
  if (doubles(P)) loadDoublesLabelTiles(P); else loadSinglesLabelTiles(P);
  drawResultsNameLabelRows(P, rowsLayout);
}
// DrawExhibitionResultsHeader (1E:44B1): the players' names (two rows each in doubles), the score
export function drawExhibitionResultsHeader(P) {
  const two = doubles(P);
  labels(P, two ? 1 : 0);
  if (two) drawDoublesPlayerNames(P); else drawSinglesPlayerNames(P);
  return drawSetsGamesScore(P);
}
// DrawMarioExhibitionResultsHeader (1E:44D3): "Mario exhibition", the score
export function drawMarioExhibitionResultsHeader(P) { labels(P, 0); drawMarioExhibitionLabel(P); return drawSetsGamesScore(P); }
// DrawRankMatchResultsHeader (1E:44F4): the class and the rank played for, the score
export function drawRankMatchResultsHeader(P) {
  labels(P, 0); drawClassNameLabel(P); drawRankMatchLabel(P); return drawSetsGamesScore(P);
}
// DrawTournamentResultsHeader (1E:451B): the Island Open round, the score
export function drawTournamentResultsHeader(P) { labels(P, 0); drawTournamentRoundLabel(P); return drawSetsGamesScore(P); }
// DrawPracticeResultsHeader (1E:453C): the class, "practice match", the score
export function drawPracticeResultsHeader(P) {
  labels(P, 0); drawClassNameLabel(P); drawPracticeMatchLabel(P); return drawSetsGamesScore(P);
}

// ---- text helpers ----
// DrawProportionalTextLine (1E:4563): text hl rendered proportionally at map cell de, rows $12 wide
// (RenderProportionalTextAt); the WRAM bank kept. Returns the renderer's registers (the next line goes on from its
// de), a = the WRAM bank.
export function drawProportionalTextLine(P, hl, de) {
  const bank = P.V.wramBank;
  const r = rom(P, FAR.RenderProportionalTextAt, { hl, de, bc: LINE_WIDTH });
  P.wramBank(bank);
  return { ...regs8(r), a: bank, f: undefined };
}
// DrawContinuePromptText (1E:4572) / DrawSaveWarningTextLine1 (1E:458C) / Line2 (1E:45A6): a run of the screen's
// text tiles ($80-$90, $92-$9D, $A4-$B4) into WRAM 3 from hl. The WRAM bank kept.
export const drawContinuePromptText = (P, hl) => tileRun(P, hl, 0x80, 0x91);
export const drawSaveWarningTextLine1 = (P, hl) => tileRun(P, hl, 0x92, 0x9E);
export const drawSaveWarningTextLine2 = (P, hl) => tileRun(P, hl, 0xA4, 0xB5);
function tileRun(P, hl, first, end) {
  const bank = P.V.wramBank;
  P.wramBank(WRAM_SCREEN);
  for (let a = first; a !== end; a = (a + 1) & 0xFF) { P.bus.w8(hl, a); hl = (hl + 1) & 0xFFFF; }
  P.wramBank(bank);
  return { a: bank, hl };
}
// FetchAndDrawDialogueText (1E:45C0): dialogue text hl (AddTextIdOffset, FetchDialogueText into wTextBuffer), then
// WriteTextToTilemap at de with bc
export function fetchAndDrawDialogueText(P, hl, de, bc) {
  const id = rom(P, FAR.AddTextIdOffset, { a: 0, hl, de, bc });
  const r = rom(P, FAR.FetchDialogueText, regs8(id));
  return writeTextToTilemap(P, (r.d << 8) | r.e, bc >> 8, bc & 0xFF);
}
// WriteTextToTilemap (1E:45C9): the 0-ended string in wTextBuffer into the maps at de, a character a cell (tile in
// WRAM 3, attribute b in WRAM 2). A dakuten / handakuten mark goes to the cell above-left of the next cell, c cells
// back and one more (c = the map's width), as $0E / $0F over the window's blank (tile 3). Leaves WRAM 3 mapped.
export function writeTextToTilemap(P, de, b, c) {
  const { bus } = P;
  let hl = wTextBuffer;
  for (;;) {
    P.wramBank(WRAM_SCREEN);
    const ch = bus.u8(hl);
    hl = (hl + 1) & 0xFFFF;
    if (!ch) return { a: 0, f: FZ, hl, de, b, c };
    if (ch === DAKUTEN || ch === HANDAKUTEN) {                       // .markChar
      const at = (de - (c || 0x100) - 1) & 0xFFFF;
      bus.w8(at, bus.u8(at) === WINDOW_BLANK ? ch - MARK_ON_BLANK : ch);
      P.wramBank(WRAM_COURT_PLANES); bus.w8(at, b);
      continue;
    }
    bus.w8(de, ch);
    P.wramBank(WRAM_COURT_PLANES); bus.w8(de, b);
    de = (de + 1) & 0xFFFF;
  }
}
// DrawSinglesPlayerNames (1E:4606): "P1 name vs P2 name" on row 14 (a long first name moved left)
export function drawSinglesPlayerNames(P) {
  copyStringToTextBuffer(P, P.A.player1MainName);
  writeTextToTilemap(P, shiftDestForLongName(P, cell(wScreenAttrmap, 14, 3)).de, 0, TEXT_ROW);
  fetchAndDrawDialogueText(P, Text_31_215, cell(wScreenAttrmap, 14, 9), TEXT_ROW);
  copyStringToTextBuffer(P, P.A.player2MainName);
  return writeTextToTilemap(P, cell(wScreenAttrmap, 14, 12), 0, TEXT_ROW);
}
// DrawDoublesPlayerNames (1E:4634): the two pairs, rows 12 and 14, "vs" between them on row 13
export function drawDoublesPlayerNames(P) {
  copyStringToTextBuffer(P, P.A.player1MainName);
  writeTextToTilemap(P, shiftDestForLongName(P, cell(wScreenAttrmap, 12, 3)).de, 0, TEXT_ROW);
  copyStringToTextBuffer(P, P.A.player1PartnerName);
  writeTextToTilemap(P, shiftDestForLongName(P, cell(wScreenAttrmap, 14, 3)).de, 0, TEXT_ROW);
  fetchAndDrawDialogueText(P, Text_31_215, cell(wScreenAttrmap, 13, 9), TEXT_ROW);
  copyStringToTextBuffer(P, P.A.player2MainName);
  writeTextToTilemap(P, cell(wScreenAttrmap, 12, 12), 0, TEXT_ROW);
  copyStringToTextBuffer(P, P.A.player2PartnerName);
  return writeTextToTilemap(P, cell(wScreenAttrmap, 14, 12), 0, TEXT_ROW);
}
// ShiftDestForLongName (1E:4683): de moved left by the letters of wTextBuffer's name past 5 (marks not counted)
export function shiftDestForLongName(P, de) {
  let c = 0, hl = wTextBuffer;
  for (;;) {
    const a = P.bus.u8(hl); hl = (hl + 1) & 0xFFFF;
    if (!a) break;
    if (a !== DAKUTEN && a !== HANDAKUTEN) c = (c + 1) & 0xFF;
  }
  if (c <= NAME_FITS) return { a: NAME_FITS, c, de, hl, f: cpFlags(NAME_FITS, c) };
  de = (de - (c - NAME_FITS)) & 0xFFFF;
  return { a: c - NAME_FITS, c: 0, de, hl, f: FZ | FN };
}
// DrawSetsGamesScore (1E:46A4): "Sets  n - n   Games  n - n" on row 16
export function drawSetsGamesScore(P) {
  const row = col => cell(wScreenAttrmap, 16, col);
  fetchAndDrawDialogueText(P, Text_31_225, row(2), TEXT_ROW);
  formatAndDrawNumber(P, P.V.player1SetsWon, row(6));
  fetchAndDrawDialogueText(P, Text_31_227, row(7), TEXT_ROW);
  formatAndDrawNumber(P, P.V.player2SetsWon, row(8));
  fetchAndDrawDialogueText(P, Text_31_226, row(11), TEXT_ROW);
  formatAndDrawNumber(P, P.V.player1GamesWon, row(15));
  fetchAndDrawDialogueText(P, Text_31_227, row(16), TEXT_ROW);
  return formatAndDrawNumber(P, P.V.player2GamesWon, row(17));
}
// FormatAndDrawNumber (1E:46F6): a in decimal (no padding) at de
export function formatAndDrawNumber(P, a, de) {
  formatDecimalNumberUnsigned(P, a, 1, wTextBuffer);
  return writeTextToTilemap(P, de, 0, TEXT_ROW);
}
// CopyStringToTextBuffer (1E:470D): the 0-ended string at hl into wTextBuffer
export function copyStringToTextBuffer(P, hl) {
  let de = wTextBuffer;
  for (;;) {
    const a = P.bus.u8(hl); hl = (hl + 1) & 0xFFFF;
    P.bus.w8(de, a);
    if (!a) return { a: 0, f: FZ, hl, de };
    de = (de + 1) & 0xFFFF;
  }
}
// DrawClassNameLabel (1E:4717): the class the player is in (junior, senior, varsity: by the rank-1 wins of singles
// or doubles)
export function drawClassNameLabel(P) {
  const two = doubles(P);
  const senior1 = testFlag(P, two ? FLAG.WON_SENIOR_DOUBLES_RANK_1 : FLAG.WON_SENIOR_SINGLES_RANK_1);
  const junior1 = !senior1 && testFlag(P, two ? FLAG.WON_JUNIOR_DOUBLES_RANK_1 : FLAG.WON_JUNIOR_SINGLES_RANK_1);
  return drawProportionalTextLine(P, senior1 ? Text_31_220 : junior1 ? Text_31_219 : Text_31_218, cell(wScreenAttrmap, 14, 1));
}
// DrawRankMatchLabel (1E:4749): "Rank n" of the match (the first rank of the class not yet won, from 4 down; 3 in
// doubles); a varsity player's label cleared; none once the class is all won
export function drawRankMatchLabel(P) {
  const two = doubles(P);
  const ranks = two
    ? { top: FLAG.WON_SENIOR_DOUBLES_RANK_1, mid: FLAG.WON_JUNIOR_DOUBLES_RANK_1, first: 3,
      senior: [FLAG.WON_SENIOR_DOUBLES_RANK_3, FLAG.WON_SENIOR_DOUBLES_RANK_2, FLAG.WON_SENIOR_DOUBLES_RANK_1],
      junior: [FLAG.WON_JUNIOR_DOUBLES_RANK_3, FLAG.WON_JUNIOR_DOUBLES_RANK_2, FLAG.WON_JUNIOR_DOUBLES_RANK_1] }
    : { top: FLAG.WON_SENIOR_SINGLES_RANK_1, mid: FLAG.WON_JUNIOR_SINGLES_RANK_1, first: 4,
      senior: [FLAG.WON_SENIOR_SINGLES_RANK_4, FLAG.WON_SENIOR_SINGLES_RANK_3, FLAG.WON_SENIOR_SINGLES_RANK_2, FLAG.WON_SENIOR_SINGLES_RANK_1],
      junior: [FLAG.WON_JUNIOR_SINGLES_RANK_4, FLAG.WON_JUNIOR_SINGLES_RANK_3, FLAG.WON_JUNIOR_SINGLES_RANK_2, FLAG.WON_JUNIOR_SINGLES_RANK_1] };
  P.bus.w8(wTextBuffer, 0x30 + ranks.first);
  if (testFlag(P, ranks.top)) {                                      // .checkWramBank: varsity, no rank shown
    const bank = P.V.wramBank;
    P.wramBank(WRAM_SCREEN);
    for (let i = 0; i < 9; i++) P.bus.w8(cell(wShadowTilemap, 14, 10 + i), BLANK);
    P.wramBank(bank);
    return { a: bank };
  }
  const list = testFlag(P, ranks.mid) ? ranks.senior : ranks.junior;
  for (let i = 0; i < list.length; i++) {
    if (!testFlag(P, list[i])) return drawNumberedLabel(P, Text_31_221, cell(wScreenAttrmap, 14, 10));   // .read
    if (i < list.length - 1) P.bus.w8(wTextBuffer, P.bus.u8(wTextBuffer) - 1);
  }
  return { a: P.bus.u8(wTextBuffer) };
}
// .read: the digit in wTextBuffer as the text's number argument, then the text
function drawNumberedLabel(P, text, de) {
  rom(P, FAR.PushTextArgNumber, { a: 0, hl: (P.bus.u8(wTextBuffer) - 0x30) & 0xFF });
  return drawProportionalTextLine(P, text, de);
}
// DrawTournamentRoundLabel (1E:47F4): "Island Open" and the round: "Round n" (n from the rounds won), or the
// semifinal / final (ClearRoundLabelRow first)
export function drawTournamentRoundLabel(P) {
  drawProportionalTextLine(P, Text_31_222, cell(wScreenAttrmap, 14, 1));
  P.bus.w8(wTextBuffer, 0x31);
  const round = () => drawNumberedLabel(P, Text_31_223, cell(wScreenAttrmap, 14, 10));
  const semi = () => { clearRoundLabelRow(P); return drawProportionalTextLine(P, Text_31_230, cell(wScreenAttrmap, 14, 9)); };
  const final = () => { clearRoundLabelRow(P); return drawProportionalTextLine(P, Text_31_229, cell(wScreenAttrmap, 14, 10)); };
  if (doubles(P)) {
    if (!testFlag(P, FLAG.WON_ISLAND_OPEN_DOUBLES_ROUND_1)) return round();
    if (!testFlag(P, FLAG.WON_ISLAND_OPEN_DOUBLES_SEMIFINAL)) return semi();
    if (!testFlag(P, FLAG.WON_ISLAND_OPEN_DOUBLES_FINAL)) return final();
    return {};
  }
  if (!testFlag(P, FLAG.WON_ISLAND_OPEN_SINGLES_ROUND_1)) return round();
  P.bus.w8(wTextBuffer, 0x32);
  if (!testFlag(P, FLAG.WON_ISLAND_OPEN_SINGLES_ROUND_2)) return round();
  if (!testFlag(P, FLAG.WON_ISLAND_OPEN_SINGLES_SEMIFINAL)) return semi();
  if (!testFlag(P, FLAG.WON_ISLAND_OPEN_SINGLES_FINAL)) return final();
  return {};
}

export const HOOKS = [
  [BANK, 0x44B1, hook(P => { drawExhibitionResultsHeader(P); })],
  [BANK, 0x44D3, hook(P => { drawMarioExhibitionResultsHeader(P); })],
  [BANK, 0x44F4, hook(P => { drawRankMatchResultsHeader(P); })],
  [BANK, 0x451B, hook(P => { drawTournamentResultsHeader(P); })],
  [BANK, 0x453C, hook(P => { drawPracticeResultsHeader(P); })],
  [BANK, 0x4563, hook((P, c) => drawProportionalTextLine(P, c.hl, c.de))],
  [BANK, 0x4572, hook((P, c) => drawContinuePromptText(P, c.hl))],
  [BANK, 0x458C, hook((P, c) => drawSaveWarningTextLine1(P, c.hl))],
  [BANK, 0x45A6, hook((P, c) => drawSaveWarningTextLine2(P, c.hl))],
  [BANK, 0x45C0, hook((P, c) => fetchAndDrawDialogueText(P, c.hl, c.de, c.bc))],
  [BANK, 0x45C9, hook((P, c) => writeTextToTilemap(P, c.de, c.b, c.c))],
  [BANK, 0x4606, hook(P => { drawSinglesPlayerNames(P); })],
  [BANK, 0x4634, hook(P => { drawDoublesPlayerNames(P); })],
  [BANK, 0x4683, hook((P, c) => shiftDestForLongName(P, c.de))],
  [BANK, 0x46A4, hook(P => { drawSetsGamesScore(P); })],
  [BANK, 0x46F6, hook((P, c) => formatAndDrawNumber(P, c.a, c.de))],
  [BANK, 0x470D, hook((P, c) => copyStringToTextBuffer(P, c.hl))],
  [BANK, 0x4717, hook(P => { drawClassNameLabel(P); })],
  [BANK, 0x4749, hook(P => { drawRankMatchLabel(P); })],
  [BANK, 0x47F4, hook(P => { drawTournamentRoundLabel(P); })],
];
