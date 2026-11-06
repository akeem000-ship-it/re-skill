// The pause menus' scoreboard and graphics (bank 6): the scoreboard drawn over the court (its frame and rows in the
// court's map buffers, the set / game digits and the mode title as sprites), the result pips of drills and point
// matches, the mode title graphics and the menu item labels.
// wScoreboardLayout picks the board: 0-2 a match (sets, games), 3 / 4 one or two rows of drill shot results
// (2 bits a shot: 1 a hit, 2-3 a miss), 5 the points of a point match (pips), 6 / 7 a minigame score with its target
// or high score (sprite digits). wScoreboardOrigin is its screen cell (y, then x).
// Port of src/engine/menus/pause/scoreboard_06.asm and menu_gfx_06.asm of the gerbiljames/mario-tennis-gbc-disasm
// (MIT, third_party/mario-tennis-gbc-disasm): names and addresses are its own; tables, maps and graphics are read
// from the ROM.
// Tests: lockstep on out/engine/rec1.mtrec and out/port/pause_*.mtrec; web/tests/port/routines_menus_pause.mjs.
import {
  FAR, rom, wram, rd, wr, rd16, u16, sound, stepMatchFrame, queueVRAMCopy, decompressData, queueSpriteTemplate,
  hook, hookGen, WRAM_STAGING, WRAM_COURT_PLANES, WRAM_ACTORS, WRAM_TEXT, WRAM_SCENE, WRAM_SOUND, TILE_SIZE, vTiles0,
  wDecompBuffer, GAMEMODE_TRAINING_DRILL, MATCHCONTEXT_MINIGAME,
} from "./defs.js";
import { copyTextRect } from "../../home/ui.js";
import { getShadowTilemapAddr, getShadowAttrmapAddr, adjustSpriteCoordsForScroll } from "./match_pause.js";

const BANK = 0x06;
const rb = (P, a) => P.rom.u8(BANK, a), rw = (P, a) => P.rom.u16(BANK, a);
const ScoreboardPipFilledRect = 0x4A9B, ScoreboardPipAltRect = 0x4AA1, ScoreboardPipEmptyRect = 0x4AA7;
const ScoreboardTilemapPointers = 0x5035, ScoreboardSpriteTemplatePointers = 0x509C;
const MatchMenuItemGfxPointers = 0x5244, ScoreboardModeGfxPointers = 0x5CC9, ScoreboardMinigameGfxPointers = 0x5CDF;
const MatchMenuItemRectPointers = 0x6835;
export const DrawScoreboardSprites = 0x506A;
export const ScoreboardModeGfxTail = 0x5280, SCOREBOARD_TAIL_BLOCKS = (0x52C0 - 0x5280) / 16;
const LAYOUT_DRILL_ROW = 3, LAYOUT_DRILL_ROWS = 4, LAYOUT_POINT_PIPS = 5, LAYOUT_SCORE_TARGET = 6, LAYOUT_SCORE_HIGH = 7;
const ITEM_LABEL_BLOCKS = 16, MODE_TITLE_BLOCKS = 20;
const SCORE_DIGITS = 4;

// PrepareScoreboardGfx (06:4915): the board's origin (row 2, column 0; column 2 for the minigame scores); every
// on-court character's frame graphics reloaded (its struct in WRAM 4-7) and, but in a minigame, the four score
// digits (games and sets of both players) into the sprite tiles. Leaves WRAM 2 mapped.
const CHAR_STRUCT_BANKS = [WRAM_SCENE, WRAM_SOUND, WRAM_TEXT, WRAM_ACTORS];     // characters 3, 2, 1, 0
export function* prepareScoreboardGfx(P) {
  wr(P, "scoreboardOrigin", 0x00, 1);
  wr(P, "scoreboardOrigin", 0x02);
  if (rd(P, "scoreboardLayout") === LAYOUT_SCORE_TARGET) wr(P, "scoreboardOrigin", 0x02, 1);
  if (rd(P, "scoreboardLayout") === LAYOUT_SCORE_HIGH) wr(P, "scoreboardOrigin", 0x02, 1);
  const chars = rd(P, "onCourtCharCountMinus1");
  if (chars > 3) throw new Error(`PrepareScoreboardGfx: ${chars + 1} characters jump off its table`);
  for (const bank of CHAR_STRUCT_BANKS.slice(3 - chars)) {
    wram(P, bank);
    rom(P, FAR.ReloadCharFrameGfx);
  }
  yield* stepMatchFrame(P);
  if (rd(P, "matchContext") !== MATCHCONTEXT_MINIGAME) {
    rom(P, FAR.LoadScoreDigitGfx, { a: rd(P, "player1GamesWon"), b: 1, de: vTiles0 + 0x70 * TILE_SIZE });
    rom(P, FAR.LoadScoreDigitGfx, { a: rd(P, "player1SetsWon"), b: 1, de: vTiles0 + 0x68 * TILE_SIZE });
    rom(P, FAR.LoadScoreDigitGfx, { a: rd(P, "player2GamesWon"), b: 1, de: vTiles0 + 0x74 * TILE_SIZE });
    rom(P, FAR.LoadScoreDigitGfx, { a: rd(P, "player2SetsWon"), b: 1, de: vTiles0 + 0x6C * TILE_SIZE });
    yield* stepMatchFrame(P);
  }
  wram(P, WRAM_COURT_PLANES);
  return { a: WRAM_COURT_PLANES };
}

// DrawScoreboard (06:49A7): the board's frame and rows for wScoreboardLayout (CopyTextRectPair), then its pips.
// b: draw the empty pips too (0 in the pause menus, which leave the court's own; 1 on the scoreboard screen).
export function drawScoreboard(P, b) {
  const layout = rd(P, "scoreboardLayout");
  copyTextRectPair(P, rd16(P, "scoreboardOrigin"), rw(P, (ScoreboardTilemapPointers + ((layout * 2) & 0xFF)) & 0xFFFF));
  if (layout === LAYOUT_DRILL_ROW) drawScoreboardDrillResultRow(P, b);
  else if (layout === LAYOUT_DRILL_ROWS) drawScoreboardDrillResultRows(P, b);
  else if (layout === LAYOUT_POINT_PIPS) drawScoreboardPointPips(P, b);
  else if (layout > LAYOUT_SCORE_HIGH) throw new Error(`DrawScoreboard: layout ${layout} jumps off its table`);
}
// DrawScoreboardDrillResultRows (06:49D5): the second row of drill results (the shots' second byte), then the first
export function drawScoreboardDrillResultRows(P, b) {
  drawScoreboardEmptyPips(P, b, 4, 0x0504);
  drawScoreboardPackedPips(P, rd(P, "drillShotResultBits", 1), 0x0504);
  drawScoreboardDrillResultRow(P, b);
}
// DrawScoreboardDrillResultRow (06:49E4): the first row of drill results
export function drawScoreboardDrillResultRow(P, b) {
  drawScoreboardEmptyPips(P, b, 4, 0x0502);
  drawScoreboardPackedPips(P, rd(P, "drillShotResultBits"), 0x0502);
}
// DrawScoreboardPointPips (06:49F4): the points won of both players, 5 pips a row
export function drawScoreboardPointPips(P, b) {
  drawScoreboardEmptyPips(P, b, 5, 0x0302);
  drawScoreboardFilledPips(P, rd(P, "player1PointsWon"), 0x0302);
  drawScoreboardEmptyPips(P, b, 5, 0x0304);
  drawScoreboardFilledPips(P, rd(P, "player2PointsWon"), 0x0304);
}
// DrawScoreboardPackedPips (06:4A13): a pip per 2 bits of c from the low ones (0 none, 1 filled, 2-3 the other),
// at cell de (from the board's origin), 2 cells apart, until no bits are left
export function drawScoreboardPackedPips(P, bits, de) {
  let at = (rd16(P, "scoreboardOrigin") + de) & 0xFFFF;
  do {
    const shot = bits & 3;
    if (shot === 1) drawScoreboardPipFilled(P, at);
    else if (shot) drawScoreboardPipAlt(P, at);
    at = (at + 0x0200) & 0xFFFF;
    bits >>= 2;
  } while (bits);
}
// DrawScoreboardFilledPips (06:4A3A): c filled pips at cell de (from the origin)
export function drawScoreboardFilledPips(P, count, de) {
  if (!count) return;
  let at = (rd16(P, "scoreboardOrigin") + de) & 0xFFFF;
  for (let n = count; n > 0; n--) { drawScoreboardPipFilled(P, at); at = (at + 0x0200) & 0xFFFF; }
}
// DrawScoreboardEmptyPips (06:4A53): c empty pips at cell de (from the origin), unless b is 0
export function drawScoreboardEmptyPips(P, b, count, de) {
  if (!b) return;
  let at = (rd16(P, "scoreboardOrigin") + de) & 0xFFFF;
  for (let n = count || 0x100; n > 0; n--) { drawScoreboardPipEmpty(P, at); at = (at + 0x0200) & 0xFFFF; }
}
// DrawScoreboardPipFilled (06:4A6E) / ...Alt (06:4A75) / ...Empty (06:4A7C): one 2x2 pip at screen cell de
export const drawScoreboardPipFilled = (P, at) => copyTextRectPair(P, at, ScoreboardPipFilledRect);
export const drawScoreboardPipAlt = (P, at) => copyTextRectPair(P, at, ScoreboardPipAltRect);
export const drawScoreboardPipEmpty = (P, at) => copyTextRectPair(P, at, ScoreboardPipEmptyRect);
// CopyTextRectPair (06:5045): the rectangle of the descriptor hl ({height, width, tiles, attributes}) at screen
// cell de (d = column, e = row) of the court's tile and attribute maps
export function copyTextRectPair(P, de, desc) {
  const x = de >> 8, y = de & 0xFF, h = rb(P, desc), w = rb(P, desc + 1);
  copyTextRect(P, rw(P, desc + 2), getShadowTilemapAddr(P, x, y), w, h);
  return copyTextRect(P, rw(P, desc + 4), getShadowAttrmapAddr(P, x, y), w, h);
}

// DrawScoreboardSprites (06:506A), a frame task: the board's sprites (ScoreboardSpriteTemplatePointers) at its
// origin; for the minigame scores, the score and its target (or the high score) in sprite digits
export function drawScoreboardSprites(P) {
  const pos = (rd16(P, "scoreboardOrigin") * 8) & 0xFFFF, layout = rd(P, "scoreboardLayout");
  const at = adjustSpriteCoordsForScroll(P, pos >> 8, pos & 0xFF);
  const r = queueSpriteTemplate(P, rw(P, (ScoreboardSpriteTemplatePointers + ((layout * 2) & 0xFF)) & 0xFFFF), at.d, at.e, 0, 0);
  if (layout !== LAYOUT_SCORE_TARGET && layout !== LAYOUT_SCORE_HIGH) return r;
  const scorePos = (pos + 0x4C0C) & 0xFFFF;
  const score = adjustSpriteCoordsForScroll(P, scorePos >> 8, scorePos & 0xFF);
  rom(P, FAR.DrawNumberWithSprites, { hl: rd16(P, "minigamesCurrentScore"), b: 1, a: SCORE_DIGITS, d: score.d, e: score.e });
  const second = adjustSpriteCoordsForScroll(P, scorePos >> 8, ((scorePos & 0xFF) + 0x18) & 0xFF);
  const value = rd(P, "minigameHighScoreMode") ? rd16(P, "minigameHighScore") : rd16(P, "minigamesTargetScore");
  return rom(P, FAR.DrawNumberWithSprites, { hl: value, b: 2, a: SCORE_DIGITS, d: second.d, e: second.e });
}

// LoadMatchMenuItemGfx (06:5219): menu item a's label tiles (MatchMenuItemGfxPointers, compressed) to sprite
// tiles $40-$4F, through WRAM 1
export function loadMatchMenuItemGfx(P, item) {
  const src = rw(P, (MatchMenuItemGfxPointers + ((item * 2) & 0xFF)) & 0xFFFF);
  const bank = P.V.wramBank;
  wram(P, WRAM_STAGING);
  decompressData(P, src, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles0 + 0x40 * TILE_SIZE, ITEM_LABEL_BLOCKS);
  wram(P, bank);
}
// LoadScoreboardModeGfx (06:5C8A): the mode title's tiles (by wGameMode; a training drill's by the drill) to sprite
// tiles $50-$63, through WRAM 1
export function loadScoreboardModeGfx(P) {
  const mode = rd(P, "gameMode");
  const ptr = mode === GAMEMODE_TRAINING_DRILL
    ? (ScoreboardMinigameGfxPointers + ((rd(P, "currentMinigameStoryMatch", 1) * 2) & 0xFF)) & 0xFFFF
    : (ScoreboardModeGfxPointers + ((mode * 2) & 0xFF)) & 0xFFFF;
  const bank = P.V.wramBank;
  wram(P, WRAM_STAGING);
  decompressData(P, rw(P, ptr), wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles0 + 0x50 * TILE_SIZE, MODE_TITLE_BLOCKS);
  wram(P, bank);
}
// DrawMatchMenuItem (06:6802): menu item a's 3x2 label (MatchMenuItemRectPointers: tiles, attributes) at screen
// cell (d, e) of the court's maps
export function drawMatchMenuItem(P, item, x, y) {
  const rect = (MatchMenuItemRectPointers + ((item * 4) & 0xFF)) & 0xFFFF;
  copyTextRect(P, rw(P, rect), getShadowTilemapAddr(P, x, y), 3, 2);
  return copyTextRect(P, rw(P, rect + 2), getShadowAttrmapAddr(P, x, y), 3, 2);
}

const B = BANK;
export const HOOKS = [
  [B, 0x4915, hookGen(P => prepareScoreboardGfx(P))],
  [B, 0x49A7, hook((P, c) => { drawScoreboard(P, c.b); })],
  [B, 0x49D5, hook((P, c) => { drawScoreboardDrillResultRows(P, c.b); })],
  [B, 0x49E4, hook((P, c) => { drawScoreboardDrillResultRow(P, c.b); })],
  [B, 0x49F4, hook((P, c) => { drawScoreboardPointPips(P, c.b); })],
  [B, 0x4A13, hook((P, c) => { drawScoreboardPackedPips(P, c.c, c.de); })],
  [B, 0x4A3A, hook((P, c) => { drawScoreboardFilledPips(P, c.c, c.de); })],
  [B, 0x4A53, hook((P, c) => { drawScoreboardEmptyPips(P, c.b, c.c, c.de); })],
  [B, 0x4A6E, hook((P, c) => { drawScoreboardPipFilled(P, c.de); })],
  [B, 0x4A75, hook((P, c) => { drawScoreboardPipAlt(P, c.de); })],
  [B, 0x4A7C, hook((P, c) => { drawScoreboardPipEmpty(P, c.de); })],
  [B, 0x5045, hook((P, c) => { copyTextRectPair(P, c.de, c.hl); })],
  [B, DrawScoreboardSprites, hook(P => { drawScoreboardSprites(P); })],
  [B, 0x5219, hook((P, c) => { loadMatchMenuItemGfx(P, c.a); })],
  [B, 0x5C8A, hook(P => { loadScoreboardModeGfx(P); })],
  [B, 0x6802, hook((P, c) => { drawMatchMenuItem(P, c.a, c.d, c.e); })],
];
