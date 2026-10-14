// The match statistics screen and the result portraits (bank $16): RIGHT on the win / lose screen opens the match's
// statistics (aces, smashes, returns, lobs, drops, double faults of each player, sets won as digit sprites, the
// players' portraits); LEFT goes back to the win / lose screen, A or B on. Also the portraits both screens show: a
// character's face, or (the win / lose screen) its winning or losing variant.
// Port of the code of src/engine/menus/results/match_16.asm and winlose_16.asm of the gerbiljames/mario-tennis-gbc-disasm
// (MIT, third_party/mario-tennis-gbc-disasm); names and addresses are its own. Graphics and tables are read from the
// ROM.
// Covered by the lockstep on out/port/xr_stats.mtrec (the statistics screen after an exhibition match).
import {
  FZ, FN, FH, cpFlags, far, rom, FAR, hook, hookGen, home, HOME, testFlag, advanceFrame, fadeIn, fadeOut,
  registerFrameTask, romWord, ix, BANK_RESULT, BANK_BOOT, BANK_CURSORBOX, BANK_MENU_LIB, BANK_BRACKET, BANK_STORY,
  WRAM_SCREEN, TILE_SIZE, VRAM_BANK1, vTiles0, vTiles1, wShadowTilemap, wShadowAttrmap, PADF_A, PADF_B, PADF_LEFT,
  GAMEMODE, FLAG, WINLOSE_WIN, WINLOSE_LOSE, LINKSTATE_MASTER, LINKSTATE_SLAVE, SCREENASSET_MatchStats3, cell,
} from "../exp/defs.js";
import { enableLCD } from "../../home/system.js";
import { decompressData } from "../../home/decompress.js";
import { loadMenuFontGfx } from "../main_menu/boot.js";
import { printNumberRightAligned } from "../main_menu/main_menu.js";
import { loadIndexedPalette18 } from "../common/cursorbox.js";
import { loadScreenAssetRecord, fillTilemapRect, copyTilemapRect, queueWram3MapToVRAM } from "../common/tilemaps.js";
import { initNumberSpriteGfx, drawDecimalNumberSprites } from "../common/widgets.js";
import { loadMatchResultPalettes, loadResultScreenTileGraphics } from "./result.js";

export const BANK = BANK_RESULT;
// ROM data and routines (bank $16)
const ResultPortraitSlotTable = 0x60B7, WinLosePortraitVariantTable_16 = 0x60F1, CharacterPortraitTable_16 = 0x6968;
const UpdateResultScreenAnimatedTilesTask = 0x43F6;
const hInputPressed = 0xFF91;
const DOUBLES_GFX_INDEX = 0x11, DOUBLES_GFX_REMAPPED = 0x10;
const PORTRAIT_PALETTES = 4;                                         // BG palettes 4-7: the four portraits
const doubles = P => testFlag(P, FLAG.DOUBLES);
const attr = (row, col) => cell(wShadowAttrmap, row, col), tile = (row, col) => cell(wShadowTilemap, row, col);
const fill = (P, de, w, h, v) => far(P, BANK_MENU_LIB, () => fillTilemapRect(P, de, w, h, v));
const copy = (P, hl, de, w, h) => far(P, BANK_MENU_LIB, () => copyTilemapRect(P, hl, de, w, h));

// RemapDoublesMatchGfxIndex (16:4E8A): in doubles match graphics set $11 is set $10 (hl left with the pushed af)
export function remapDoublesMatchGfxIndex(P, a, f) {
  if (!doubles(P) || a !== DOUBLES_GFX_INDEX) return { a, de: FLAG.DOUBLES };   // (pop af: a and F as they were)
  return { a: DOUBLES_GFX_REMAPPED, f: FZ | FN, de: FLAG.DOUBLES, hl: (a << 8) | (f & 0xF0) };
}
// ApplyLinkRoleToWinLoseFlag (16:5C11): on the link's second Game Boy the result is the other player's: flipped
export function applyLinkRoleToWinLoseFlag(P) {
  if (P.V.gameMode !== GAMEMODE.LINK_MATCH) return { a: P.V.gameMode };
  const role = P.V.linkMatchRole;
  if (role === LINKSTATE_MASTER || role !== LINKSTATE_SLAVE) return { a: role };
  const a = P.V.matchWinLoseFlag === WINLOSE_LOSE ? WINLOSE_WIN : WINLOSE_LOSE;
  P.V.matchWinLoseFlag = a;
  return { a };
}
// RunMatchStatsScreen (16:5C35): the statistics screen. Returns a = 0 (LEFT: back to the win / lose screen) or $FF.
export function* runMatchStatsScreen(P) {
  home(P, HOME.DisableLCDSafely);
  far(P, BANK_BOOT, () => loadMenuFontGfx(P));
  P.wramBank(WRAM_SCREEN);
  P.bus.w8(P.A.resultScreenMode, 1);
  initMatchStatsScreen(P);
  loadMatchResultPalettes(P);
  registerFrameTask(P, 1, UpdateResultScreenAnimatedTilesTask);
  enableLCD(P);
  yield* fadeIn(P, 16);
  for (;;) {
    printMatchSetScores(P);
    const input = P.bus.u8(hInputPressed);
    if (input & PADF_LEFT) { yield* fadeOut(P, 64); return { a: 0, f: FZ }; }
    if (input & (PADF_A | PADF_B)) { yield* fadeOut(P, 32); return { a: 0xFF }; }
    yield* advanceFrame(P);
  }
}
// InitMatchStatsScreen (16:5C8A): the screen's maps and tiles, the digit sprites, the portraits' palettes and
// attributes, the portraits, the statistics; the maps queued
export function initMatchStatsScreen(P) {
  far(P, BANK_MENU_LIB, () => loadScreenAssetRecord(P, SCREENASSET_MatchStats3));
  far(P, BANK_MENU_LIB, () => initNumberSpriteGfx(P, 8, 0, vTiles0 + VRAM_BANK1));
  for (let k = 0; k < 4; k++) far(P, BANK_CURSORBOX, () => loadIndexedPalette18(P, 0, PORTRAIT_PALETTES + k));
  P.wramBank(WRAM_SCREEN);
  copyMatchStatsHeaderRects(P);
  loadResultScreenTileGraphics(P);
  fill(P, attr(16, 0), 0x14, 0x02, 0x08);
  setMatchStatsPortraitPaletteAttrs(P);
  loadResultScreenPortraits(P, 1);
  printMatchStatistics(P);
  return far(P, BANK_MENU_LIB, () => queueWram3MapToVRAM(P));
}
// SetMatchStatsPortraitPaletteAttrs (16:5CDC): the portraits' palettes (4 in doubles, 2 in singles) on their 3 x 3
// cells
export function setMatchStatsPortraitPaletteAttrs(P) {
  const spots = doubles(P) ? [[1, 0x0C], [4, 0x0D], [13, 0x0E], [16, 0x0F]] : [[2, 0x0C], [14, 0x0E]];
  for (const [col, h] of spots) fill(P, attr(4, col), 3, 3, h);
}
// PrintMatchStatistics (16:5D2F): the numbers area cleared, then the singles' or doubles' columns
export function printMatchStatistics(P) {
  clearMatchStatsNumberArea(P);
  if (doubles(P)) printDoublesMatchStats(P); else printSinglesMatchStats(P);
}
// the six statistics of character n (1-4) right-aligned in the column ending at col, rows 11-16
const STATS = ["ServiceAces", "SmashAces", "ReturnAces", "LobShotWinners", "DropShotWinners", "DoubleFaults"];
function printColumn(P, n, col) {
  STATS.forEach((stat, i) => {
    const value = P.V[`character${n}${stat}`];
    far(P, BANK_BRACKET, () => printNumberRightAligned(P, value, tile(11 + i, col), P.A.statsPrintBuffer, 0));
  });
}
// PrintSinglesMatchStats (16:5D43) / PrintDoublesMatchStats (16:5DF8)
export function printSinglesMatchStats(P) { printColumn(P, 1, 3); printColumn(P, 2, 16); }
export function printDoublesMatchStats(P) { printColumn(P, 1, 2); printColumn(P, 3, 5); printColumn(P, 2, 15); printColumn(P, 4, 18); }

// ---- winlose_16 ----
// ClearMatchStatsNumberArea (16:5F61): both number columns (5 x 6 cells) blank, attribute 0
export function clearMatchStatsNumberArea(P) {
  fill(P, attr(11, 1), 5, 6, 0x00); fill(P, attr(11, 14), 5, 6, 0x00);
  fill(P, tile(11, 1), 5, 6, 0x20); fill(P, tile(11, 14), 5, 6, 0x20);
}
// CopyMatchStatsHeaderRects (16:5F92): in singles the header boxes (8 x 4, from the map's hidden rows 18-21)
export function copyMatchStatsHeaderRects(P) {
  if (doubles(P)) return { f: FH };
  copy(P, tile(18, 0), tile(4, 0), 8, 4); copy(P, tile(18, 12), tile(4, 12), 8, 4);
  copy(P, attr(18, 0), attr(4, 0), 8, 4); copy(P, attr(18, 12), attr(4, 12), 8, 4);
  return {};
}
// PrintMatchSetScores (16:5FCE): both players' sets won in digit sprites
export function printMatchSetScores(P) {
  far(P, BANK_MENU_LIB, () => drawDecimalNumberSprites(P, P.V.player1SetsWon, 0x1C, 0x48));
  far(P, BANK_MENU_LIB, () => drawDecimalNumberSprites(P, P.V.player2SetsWon, 0x84, 0x48));
}
// LoadResultScreenPortraits (16:5FE7): the four (doubles) or two portraits: player 1's side in slots 0 / 1, player
// 2's in 2 / 3, swapped on the link's second Game Boy (for the win / lose screen, c = 0)
export function loadResultScreenPortraits(P, c) {
  const V = P.V;
  const swapped = !c && V.gameMode === GAMEMODE.LINK_MATCH && V.linkMatchRole === LINKSTATE_SLAVE;
  const [p1, p2] = swapped ? [2, 0] : [0, 2];
  loadResultPortraitSlot(P, V.player1CurrentMainCharacter, V.player1MainPalette, p1);
  loadResultPortraitSlot(P, V.player2CurrentMainCharacter, V.player2MainPalette, p2);
  if (!doubles(P)) return {};
  loadResultPortraitSlot(P, V.player1CurrentPartnerCharacter, V.player1PartnerPalette, p1 + 1);
  loadResultPortraitSlot(P, V.player2CurrentPartnerCharacter, V.player2PartnerPalette, p2 + 1);
  return {};
}
// LoadResultPortraitSlot (16:6073): character d's portrait in slot c (palette b as BG palette 4 + c, tiles at
// ResultPortraitSlotTable[c]); slots 0-1 on the win / lose screen show the win or lose variant
export function loadResultPortraitSlot(P, d, b, c) {
  far(P, BANK_CURSORBOX, () => loadIndexedPalette18(P, b, (c + PORTRAIT_PALETTES) & 0xFF));
  const de = romWord(P, ix(ResultPortraitSlotTable, c * 2));
  let variant = 0;
  if (c !== 2 && c !== 3 && !P.bus.u8(P.A.resultScreenMode)) variant = P.V.matchWinLoseFlag === WINLOSE_LOSE ? 2 : 1;
  return decompressResultPortrait(P, d, variant, de);
}
// DecompressResultPortrait (16:60C0): variant c (DecompressWinLosePortraitVariant), or the plain portrait (the ROM's
// check for a character id of $20 and up tests c, which is 0 there: RemapExtendedCharId is never reached)
export function decompressResultPortrait(P, b, c, de) {
  if (c) return decompressWinLosePortraitVariant(P, b, c, de);
  if (c >= 0x20) b = rom(P, FAR.RemapExtendedCharId, { a: b }).a;
  return decompressCharacterPortrait(P, b, de);
}
// DecompressWinLosePortraitVariant (16:60D5): the winning (c = 1) or losing face of palette group b * 2 & 7
export function decompressWinLosePortraitVariant(P, b, c, de) {
  let a = (b * 2) & 0x07;
  if (c !== 1) a++;
  return { hl: decompressData(P, romWord(P, ix(WinLosePortraitVariantTable_16, a * 2)), de) };
}
// DecompressCharacterPortrait (16:6955): character b's portrait (CharacterPortraitTable_16) to de
export function decompressCharacterPortrait(P, b, de) {
  return { hl: decompressData(P, romWord(P, ix(CharacterPortraitTable_16, (b & 0x1F) * 2)), de) };
}

export const HOOKS = [
  [BANK, 0x4E8A, hook((P, c) => remapDoublesMatchGfxIndex(P, c.a, c.f))],
  [BANK, 0x5C11, hook(P => applyLinkRoleToWinLoseFlag(P))],
  [BANK, 0x5C35, hookGen(P => runMatchStatsScreen(P))],
  [BANK, 0x5C8A, hook(P => { initMatchStatsScreen(P); })],
  [BANK, 0x5CDC, hook(P => { setMatchStatsPortraitPaletteAttrs(P); })],
  [BANK, 0x5D2F, hook(P => { printMatchStatistics(P); })],
  [BANK, 0x5D43, hook(P => { printSinglesMatchStats(P); })],
  [BANK, 0x5DF8, hook(P => { printDoublesMatchStats(P); })],
  [BANK, 0x5F61, hook(P => { clearMatchStatsNumberArea(P); })],
  [BANK, 0x5F92, hook(P => copyMatchStatsHeaderRects(P))],
  [BANK, 0x5FCE, hook(P => { printMatchSetScores(P); })],
  [BANK, 0x5FE7, hook((P, c) => { loadResultScreenPortraits(P, c.c); })],
  [BANK, 0x6073, hook((P, c) => { loadResultPortraitSlot(P, c.d, c.b, c.c); })],
  [BANK, 0x60C0, hook((P, c) => { decompressResultPortrait(P, c.b, c.c, c.de); })],
  [BANK, 0x60D5, hook((P, c) => { decompressWinLosePortraitVariant(P, c.b, c.c, c.de); })],
  [BANK, 0x6955, hook((P, c) => { decompressCharacterPortrait(P, c.b, c.de); })],
];
