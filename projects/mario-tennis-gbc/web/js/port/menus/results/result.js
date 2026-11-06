// The win / lose screen after a match (bank $16): "You win" / "You lose" over the match's graphics (by match: the
// story's opponents, the exhibition's set), the players' portraits wobbling, the winner's and loser's markers, the
// band of the court diagram scrolling under a raster split (the STAT interrupt, rows $48-$57); A or B goes on,
// RIGHT opens the statistics (match_stats.js). Also bank $16's copies of the shared menu helpers.
// Port of the code of src/engine/menus/results/result_16.asm and result_tasks_16.asm (and its twin routines,
// src/twins/) of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm); names and
// addresses are its own. Graphics, scripts, templates and tables are read from the ROM.
// Covered by the lockstep on out/engine/exh1.mtrec, rec1.mtrec and the out/port/xr_* recordings.
import {
  FZ, FN, FH, FC, addFlags, subFlags, far, rom, home, HOME, FAR, hook, hookGen, testFlag, sound, advanceFrame, fadeIn,
  fadeOut, registerFrameTask, queueVRAMCopy, queueSprite, romWord, romByte, ix, getRegs, setRegs, BANK_RESULT,
  BANK_MENU_LIB, BANK_CURSORBOX, WRAM_STAGING, WRAM_SCREEN, TILE_SIZE, VRAM_BANK1, vTiles0, vTiles1, vTiles2,
  wDecompBuffer, wShadowTilemap, wShadowAttrmap, OAM_BANK1, PADF_A, PADF_B, PADF_RIGHT, BGM_WIN, BGM_LOSE, SFX_MENU_SELECT,
  GAMEMODE, FLAG, WINLOSE_LOSE, MATCHLIST_DOUBLES, MATCHABORTB_MATCH, SCREENASSET_MatchStats, SCREENASSET_MatchStats2,
  TILEBLOCK_MatchWinLoseGfx, MatchWinLoseGfx_BLOCKS, rSTAT, rIE, IE_STAT, cell,
} from "../exp/defs.js";
import { enableLCD } from "../../home/system.js";
import { clearFrameTasks, printDecimalByte } from "../../home/debugtext.js";
import { decompressData } from "../../home/decompress.js";
import { loadPaletteShadow } from "../../home/palettes.js";
import { queueSpriteTemplate } from "../../home/fade.js";
import { pop } from "../../home/cpu.js";
import { loadIndexedPalette18 } from "../common/cursorbox.js";
import { loadScreenAssetRecord, fillTilemapRect, copyTilemapRect, queueWram3MapToVRAM, updateAnimatedTiles } from "../common/tilemaps.js";
import { loadCompressedTileBlock } from "../common/menu_lib.js";
import {
  unusedClearWram3Row64, drawNameWithDiacritics, unusedDrawDecimalNumber, unusedDrawAsciiDigitString,
  unusedDrawAsciiDigitChar,
} from "../main_menu/n64.js";
import {
  remapDoublesMatchGfxIndex, applyLinkRoleToWinLoseFlag, runMatchStatsScreen, setMatchStatsPortraitPaletteAttrs,
  loadResultScreenPortraits,
} from "./match_stats.js";

export const BANK = BANK_RESULT;
// ROM data and frame tasks (bank $16)
const MatchResultPalettes0 = 0x4A46, MatchResultPalettes1 = 0x4A4E, MatchResultTilemapScripts_16 = 0x4ABD;
const ResultSpriteTemplateLeft_16 = 0x4D04, ResultSpriteTemplateRight_16 = 0x4D55, ResultSpriteWobbleOffsetTable = 0x4DEE;
const GfxSetPointerTable_16 = 0x4E9D, MatchResultTitleGfx = 0x542E, MatchResultTitleGfxAlt = 0x54BD;
const MatchResultGfxA2 = 0x5357, MatchResultGfxB4 = 0x53C1, MatchResultGfxC9 = 0x5BF5;
const MatchWinLoseScreenGfx = 0x4608, MatchWinLoseScreenGfx1 = 0x4784, MatchWinLoseScreenPalettes = 0x48F4;
const UpdateResultScreenAnimatedTilesTask = 0x43F6, QueueResultScreenSprites = 0x4CB1, AdvanceResultScreenTimer = 0x4C9D;
const hInputPressed = 0xFF91, hVBlankCounter = 0xFF8C, hScrollX = 0xFF8B, hScrollY = 0xFF8A;
const GFX_A = vTiles1 + 0x10 * TILE_SIZE, GFX_B = vTiles1 + 0x24 * TILE_SIZE, GFX_C = vTiles2 + 0x14 * TILE_SIZE;
const STAT_LYC_INT = 0x08, RASTER_START = 0x48, RASTER_END = 0x57;
const ANIM_SET_WIN = 0x02, ANIM_SET_LOSE = 0x03, ANIM_PERIOD_LOSE = 0x06, ANIM_PERIOD_NORMAL = 0x03;
const PORTRAIT_PALETTES = 4;
const lost = P => P.V.matchWinLoseFlag === WINLOSE_LOSE;
const doubles = P => testFlag(P, FLAG.DOUBLES);
const fill = (P, de, w, h, v) => far(P, BANK_MENU_LIB, () => fillTilemapRect(P, de, w, h, v));
const copy = (P, hl, de, w, h) => far(P, BANK_MENU_LIB, () => copyTilemapRect(P, hl, de, w, h));
const tile = (row, col) => cell(wShadowTilemap, row, col), attr = (row, col) => cell(wShadowAttrmap, row, col);

// ---- result_16 ----
// LoadMatchResultPalettes (16:4A0F): the result's two BG palettes (the win / lose colours on palettes 1 and 2,
// swapped for a loss) and its animated tile set
export function loadMatchResultPalettes(P) {
  const loss = lost(P);
  P.V.animatedTileSet = loss ? ANIM_SET_LOSE : ANIM_SET_WIN;
  loadPaletteShadow(P, MatchResultPalettes1, loss ? 2 : 1, 1);
  return loadPaletteShadow(P, MatchResultPalettes0, loss ? 1 : 2, 1);
}
// AdjustResultTilemapForLoss (16:4A56): for a loss the "lose" rows (from the map's hidden rows 18-19) over rows
// 9-10, the tiles animated slower
export function adjustResultTilemapForLoss(P) {
  if (!lost(P)) return { a: P.V.matchWinLoseFlag };
  copy(P, tile(18, 0), tile(9, 0), 0x20, 0x02);
  P.V.animatedTilePeriod = ANIM_PERIOD_LOSE;
  return { a: ANIM_PERIOD_LOSE };
}
// Unused_16_BuildMatchResultTilemap (16:4A71): the match's script of 2-row rect copies (MatchResultTilemapScripts_16:
// [dest, src, width] until a dest of 0), then the title's rect; nothing calls it
export function unusedBuildMatchResultTilemap(P) {
  let hl = romWord(P, ix(MatchResultTilemapScripts_16, P.bus.u8(P.A.currentMinigameStoryMatch + 1) * 2));
  for (;;) {
    const de = romWord(P, hl);
    if (!de) break;
    const src = romWord(P, hl + 2), width = romByte(P, hl + 4);
    hl = (hl + 5) & 0xFFFF;
    copy(P, src, de, width, 0x02);
  }
  if (P.bus.u8(P.A.currentMinigameStoryMatch) === MATCHLIST_DOUBLES) copy(P, 0xD3C7, 0xD200, 6, 2);
  else copy(P, 0xD3C0, 0xD200, 7, 2);
  return {};
}
// AdvanceResultScreenTimer (16:4C9D), a frame task: the diagram band's scroll, every frame (every other after a loss)
export function advanceResultScreenTimer(P) {
  if (lost(P) && !(P.bus.u8(hVBlankCounter) & 1)) return { a: 0, f: FZ | FH };
  const a = (P.V.rasterScrollX + 1) & 0xFF;
  P.V.rasterScrollX = a;
  return { a };
}
// QueueResultScreenSprites (16:4CB1), a frame task: the two portraits and the winner / loser markers (swapped
// sides for a loss)
export function queueResultScreenSprites(P) {
  if (!lost(P)) {
    queueResultPortraitTop(P, 0x08, 0x24); queueWinnerMarkerForPlayer(P, 0x50, 0x2C);
    queueResultPortraitBottom(P, 0x50, 0x60); return queueLoserMarkerForOpponent(P, 0x4E, 0x68);
  }
  queueResultPortraitTop(P, 0x58, 0x60); queueLoserMarkerForPlayer(P, 0x50, 0x68);
  queueResultPortraitBottom(P, 0x00, 0x24); return queueWinnerMarkerForOpponent(P, 0x48, 0x2C);
}
const blinkAttr = P => (P.bus.u8(hVBlankCounter) & 0x10 ? OAM_BANK1 | 2 : 0x08);
// QueueResultPortraitTop (16:4CEA): the player's portrait (8 x 16 sprites), wobbling left, blinking palettes
export function queueResultPortraitTop(P, d, e) {
  const x = (d - getResultSpriteWobbleOffset(P).a) & 0xFF;
  return queueSpriteTemplate(P, ResultSpriteTemplateLeft_16, x, e, 0x00, blinkAttr(P), P.cpu.sp - 2);
}
// QueueResultPortraitBottom (16:4D45): the opponent's portrait, wobbling right
export function queueResultPortraitBottom(P, d, e) {
  const x = (d + getResultSpriteWobbleOffset(P).a) & 0xFF;
  return queueSpriteTemplate(P, ResultSpriteTemplateRight_16, x, e, 0x20, OAM_BANK1 | 1, P.cpu.sp - 2);
}
// QueueWinnerMarkerForPlayer (16:4D96) / QueueLoserMarkerForOpponent (16:4DAD) / QueueWinnerMarkerForOpponent
// (16:4DBA) / QueueLoserMarkerForPlayer (16:4DC7): a marker sprite (tile $40 winner, $42 loser) with its portrait's
// wobble
const marker = (P, d, e, tileId, player) => {
  const w = getResultSpriteWobbleOffset(P).a, x = player ? (d - w) & 0xFF : (d + w) & 0xFF;
  const b = player ? blinkAttr(P) : OAM_BANK1 | 1;
  return { b, c: tileId, d: x, e, ...queueSprite(P, b, tileId, x, e) };
};
export const queueWinnerMarkerForPlayer = (P, d, e) => marker(P, d, e, 0x40, true);
export const queueLoserMarkerForOpponent = (P, d, e) => marker(P, d, e, 0x42, false);
export const queueWinnerMarkerForOpponent = (P, d, e) => marker(P, d, e, 0x40, false);
export const queueLoserMarkerForPlayer = (P, d, e) => marker(P, d, e, 0x42, true);
// GetResultSpriteWobbleOffset (16:4DDE): the wobble of hVBlankCounter / 2 (16 steps)
export function getResultSpriteWobbleOffset(P) {
  const hl = ix(ResultSpriteWobbleOffsetTable, (P.bus.u8(hVBlankCounter) >> 1) & 0x0F);
  return { a: romByte(P, hl), hl };
}
// LoadResultScreenTileGraphics (16:4DFE): the top and bottom rows' attributes (palette 3), the title's tiles
// (doubles: its own), and the result graphics (the exhibition's set when wResultScreenWon, else the match's)
export function loadResultScreenTileGraphics(P) {
  fill(P, attr(0, 0), 0x14, 0x02, 0x0B);
  fill(P, attr(16, 0), 0x14, 0x02, 0x0B);
  decompressData(P, doubles(P) ? MatchResultTitleGfxAlt : MatchResultTitleGfx, vTiles2);
  if (!P.bus.u8(P.A.resultScreenWon)) return loadMatchResultGfxSet(P);
  decompressData(P, MatchResultGfxA2, GFX_A);
  decompressData(P, MatchResultGfxB4, GFX_B);
  return { hl: decompressData(P, MatchResultGfxC9, GFX_C) };
}
// LoadMatchResultGfxSet (16:4E54): the match's three graphics (GfxSetPointerTable_16 by match number, remapped in
// doubles)
export function loadMatchResultGfxSet(P) {
  const a = remapDoublesMatchGfxIndex(P, P.bus.u8(P.A.currentMinigameStoryMatch + 1), 0).a;
  const set = romWord(P, ix(GfxSetPointerTable_16, a * 2));
  decompressData(P, romWord(P, set), GFX_A);
  decompressData(P, romWord(P, set + 2), GFX_B);
  return { hl: decompressData(P, romWord(P, set + 4), GFX_C) };
}

// ---- result_tasks_16 ----
// UpdateResultScreenAnimatedTilesTask (16:43F6), a frame task: UpdateAnimatedTiles
export function updateResultScreenAnimatedTilesTask(P) { far(P, BANK_MENU_LIB, () => updateAnimatedTiles(P)); }
// RunMatchWinLoseScreen (16:4477): the win / lose screen (not after a match left). Exhibition and link matches show
// their own set (wResultScreenWon); the link's second player sees the result flipped while it is up. The match's
// number is printed at (3, 3) in the debug text each frame. RIGHT shows the statistics, and the screen again after
// them unless they were left with A / B.
export function* runMatchWinLoseScreen(P) {
  for (;;) {
    if (P.V.matchAbortFlag & (1 << MATCHABORTB_MATCH)) return {};
    home(P, HOME.DisableLCDSafely);
    clearFrameTasks(P);
    P.wramBank(WRAM_SCREEN);
    const own = P.V.gameMode === GAMEMODE.EXHIBITION || P.V.gameMode === GAMEMODE.LINK_MATCH ? 1 : 0;
    P.bus.w8(P.A.resultScreenWon, own);
    P.bus.w8(P.A.resultScreenMode, own);
    P.V.matchWinLoseState = P.V.matchWinLoseFlag;
    applyLinkRoleToWinLoseFlag(P);
    sound(P, lost(P) ? BGM_LOSE : BGM_WIN);
    initMatchWinLoseScreen(P);
    far(P, BANK_MENU_LIB, () => updateAnimatedTiles(P));
    registerFrameTask(P, 1, UpdateResultScreenAnimatedTilesTask);
    registerFrameTask(P, 1, QueueResultScreenSprites);
    enableLCD(P);
    yield* fadeIn(P, 16);
    P.bus.w8(rSTAT, STAT_LYC_INT);
    P.bus.w8(rIE, P.bus.u8(rIE) | IE_STAT);
    P.V.rasterScrollStartLY = RASTER_START;
    P.V.rasterScrollEndLY = RASTER_END;
    P.V.rasterScrollX = 0;
    registerFrameTask(P, 1, AdvanceResultScreenTimer);
    let input;
    for (;;) {
      yield* advanceFrame(P);
      printDecimalByte(P, 3, 3, P.bus.u8(P.A.currentMinigameStoryMatch + 1));
      input = P.bus.u8(hInputPressed);
      P.V.menuInputPressed = input;
      P.winLoseSeen = { at: P.frames, lost: !!lost(P) };             // TOUR+ (tour.js: the rewards card over this screen), read only
      if (input & (PADF_A | PADF_B | PADF_RIGHT)) break;
    }
    const rasterOff = () => P.bus.w8(rIE, P.bus.u8(rIE) & ~IE_STAT);
    if (input & (PADF_A | PADF_B)) {                                 // .playSfx2
      sound(P, SFX_MENU_SELECT);
      clearFrameTasks(P);
      yield* fadeOut(P, 64);
      rasterOff();
      P.V.animatedTilePeriod = ANIM_PERIOD_NORMAL;
      P.V.matchWinLoseFlag = P.V.matchWinLoseState;
      return { a: P.V.matchWinLoseState };
    }
    yield* fadeOut(P, 64);                                           // .bit4Set: the statistics
    rasterOff();
    clearFrameTasks(P);
    const r = yield* runMatchStatsScreen(P);
    P.V.matchWinLoseFlag = P.V.matchWinLoseState;
    if (r.a !== 0xFF) continue;
    clearFrameTasks(P);
    yield* fadeOut(P, 8);
    rasterOff();
    P.V.animatedTilePeriod = ANIM_PERIOD_NORMAL;
    return { a: ANIM_PERIOD_NORMAL };
  }
}
// InitMatchWinLoseScreen (16:4571): the screen's maps, the portraits' palettes, the result palettes and rows, the
// result graphics, the portraits, the diagram sprites' tiles and palettes; the maps queued
export function initMatchWinLoseScreen(P) {
  clearFrameTasks(P);
  P.bus.w8(hScrollX, 0); P.bus.w8(hScrollY, 0);
  loadWinLoseScreenAssets(P);
  P.wramBank(WRAM_SCREEN);
  fill(P, attr(11, 0), 0x14, 0x05, 0x0A);
  for (let k = 0; k < 4; k++) far(P, BANK_CURSORBOX, () => loadIndexedPalette18(P, 0, PORTRAIT_PALETTES + k));
  loadMatchResultPalettes(P);
  adjustResultTilemapForLoss(P);
  loadResultScreenTileGraphics(P);
  setWinLosePortraitPaletteAttrs(P);
  loadResultScreenPortraits(P, 0);
  const bank = P.V.wramBank;
  P.wramBank(WRAM_STAGING);
  decompressData(P, MatchWinLoseScreenGfx, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles0 + VRAM_BANK1, 32);
  decompressData(P, MatchWinLoseScreenGfx1, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles0 + 0x20 * TILE_SIZE + VRAM_BANK1, 32);
  loadPaletteShadow(P, MatchWinLoseScreenPalettes, 8, 3);
  far(P, BANK_MENU_LIB, () => loadCompressedTileBlock(P, TILEBLOCK_MatchWinLoseGfx, vTiles0 + 0x40 * TILE_SIZE + VRAM_BANK1,
    MatchWinLoseGfx_BLOCKS));
  P.wramBank(bank);
  return far(P, BANK_MENU_LIB, () => queueWram3MapToVRAM(P));
}
// LoadWinLoseScreenAssets (16:490C): the screen's maps (the exhibition / link layout or the story's); in singles
// the portrait boxes moved in from the hidden rows 20-24
export function loadWinLoseScreenAssets(P) {
  far(P, BANK_MENU_LIB, () => loadScreenAssetRecord(P, P.bus.u8(P.A.resultScreenWon) ? SCREENASSET_MatchStats2 : SCREENASSET_MatchStats));
  if (doubles(P)) return {};
  P.wramBank(WRAM_SCREEN);
  copy(P, tile(20, 0), tile(4, 11), 9, 5); copy(P, attr(20, 0), attr(4, 11), 9, 5);
  copy(P, tile(20, 9), tile(11, 1), 8, 5); copy(P, attr(20, 9), attr(11, 1), 8, 5);
  return {};
}
// SetWinLosePortraitPaletteAttrs (16:4963): the portraits' palettes on their cells (the story's layout with the
// winner's big portrait, or the exhibition's; doubles: four)
export function setWinLosePortraitPaletteAttrs(P) {
  const two = doubles(P);
  const spots = P.bus.u8(P.A.resultScreenMode)
    ? (two ? [[5, 12, 3, 0x0C], [5, 15, 3, 0x0D], [12, 2, 3, 0x0E], [12, 5, 3, 0x0F]] : [[5, 13, 3, 0x0C], [12, 3, 3, 0x0E]])
    : (two ? [[4, 11, 4, 0x0C], [4, 15, 4, 0x0D], [12, 2, 3, 0x0E], [12, 5, 3, 0x0F]] : [[4, 13, 4, 0x0C], [12, 3, 3, 0x0E]]);
  for (const [row, col, size, h] of spots) fill(P, attr(row, col), size, size, h);
}

// ---- bank $16's copies of shared helpers (nothing calls most of them) ----
// Unused_16_GetCellIndexFromCursorPtr (16:4399): [hl - 1] + [hl] * c (8 bits); hl - 1
export function unusedGetCellIndexFromCursorPtr(P, hl, c) {
  const rows = P.bus.u8(hl);
  hl = (hl - 1) & 0xFFFF;
  const product = (rows * c) & 0xFF, x = P.bus.u8(hl);
  return { a: (x + product) & 0xFF, hl, f: addFlags(x, product) };
}
// Unused_16_SetMenuCursorFromIndex (16:43A9) / ...ToPtr (16:43BB): index c over b columns as the cursor's column and
// row (wMenuCursorX / Y, or [hl], [hl + 1])
export function unusedSetMenuCursorFromIndex(P, b, c, hl = null) {
  if (!b) throw new Error("SetMenuCursorFromIndex with 0 columns: the ROM loops for ever");
  const x = c % b, d = Math.floor(c / b) & 0xFF;
  if (hl === null) { P.V.menuCursorX = x; P.V.menuCursorY = d; return { a: d, d, f: subFlags(x, b) }; }
  P.bus.w8(hl, x); P.bus.w8(hl + 1, d);
  return { a: d, d, hl: (hl + 1) & 0xFFFF, f: subFlags(x, b) };
}
// UnusedDrawCourtDiagramMarkers (16:43FA): DrawNameWithDiacritics' body (bank $3B's port)
// Unused_16_CourtDiagramBaseTask (16:4406): the same entered mid-loop (at the check of the mark after a letter, with
// the caller's a and Z); it pops two words it did not push (bc, af) before returning
function courtDiagramBaseTask(P, cpu) {
  const { bus } = P;
  let hl = cpu.hl, de = cpu.de, a = cpu.a, mid = true;
  for (;;) {
    if (!mid) {
      a = bus.u8(hl);
      if (!a) break;
      bus.w8(de, a);
      hl = (hl + 1) & 0xFFFF;
      a = bus.u8(hl);
    }
    const isMark = mid ? (cpu.f & FZ) || a === 0xDF : a === 0xDE || a === 0xDF;
    mid = false;
    if (isMark) {
      const above = (de - 0x20) & 0xFFFF;
      bus.w8(above, bus.u8(above) === 0x03 ? (a - 0xD0) & 0xFF : a);
      hl = (hl + 1) & 0xFFFF;
    }
    de = (de + 1) & 0xFFFF;
    if (!(de & 0x1F)) de = (de * 2) & 0xFFFF;
  }
  cpu.hl = hl; cpu.de = de;
  cpu.bc = pop(P);
  const af = pop(P);
  cpu.a = af >> 8; cpu.f = af & 0xF0;
}
// Unused_16_PrintDecimalNumber (16:4443): UnusedPrintDecimalNumber_16's second half entered on its own (b = d, then
// FormatDecimalNumber into bc, the string drawn at the popped de; then the caller's 10 bytes and hl, bc, af popped)
function unusedPrintDecimalNumberTail(P, cpu) {
  const r = P.callRom(0, HOME.FormatDecimalNumber, { a: cpu.a, hl: cpu.hl, de: cpu.de, b: cpu.d, c: cpu.c });
  const text = r.bc;
  const de = pop(P), bc = pop(P);
  const s = unusedDrawAsciiDigitString(P, text, de);
  cpu.sp = (cpu.sp + 10) & 0xFFFF;
  cpu.hl = pop(P); cpu.bc = pop(P);
  const af = pop(P);
  cpu.a = af >> 8; cpu.f = af & 0xF0; cpu.de = s.de;
  void bc;
}

export const HOOKS = [
  [BANK, 0x4399, hook((P, c) => unusedGetCellIndexFromCursorPtr(P, c.hl, c.c))],
  [BANK, 0x43A9, hook((P, c) => unusedSetMenuCursorFromIndex(P, c.b, c.c))],
  [BANK, 0x43BB, hook((P, c) => unusedSetMenuCursorFromIndex(P, c.b, c.c, c.hl))],
  [BANK, 0x43C9, hook((P, c) => unusedClearWram3Row64(P, c.hl, c.f))],
  [BANK, 0x43DF, hook((P, c) => unusedClearWram3Row64(P, c.hl, c.f))],
  [BANK, 0x43F6, hook(P => { updateResultScreenAnimatedTilesTask(P); })],
  [BANK, 0x43FA, hook((P, c) => drawNameWithDiacritics(P, c.hl, c.de))],
  [BANK, 0x4406, courtDiagramBaseTask],
  [BANK, 0x4433, hook((P, c) => unusedDrawDecimalNumber(P, c))],
  [BANK, 0x4443, unusedPrintDecimalNumberTail],
  [BANK, 0x4454, hook((P, c) => unusedDrawAsciiDigitString(P, c.hl, c.de))],
  [BANK, 0x445E, hook((P, c) => unusedDrawAsciiDigitChar(P, c.a, c.de))],
  [BANK, 0x4477, hookGen(P => runMatchWinLoseScreen(P))],
  [BANK, 0x4571, hook(P => { initMatchWinLoseScreen(P); })],
  [BANK, 0x490C, hook(P => { loadWinLoseScreenAssets(P); })],
  [BANK, 0x4963, hook(P => { setWinLosePortraitPaletteAttrs(P); })],
  [BANK, 0x4A0F, hook(P => { loadMatchResultPalettes(P); })],
  [BANK, 0x4A56, hook(P => adjustResultTilemapForLoss(P))],
  [BANK, 0x4A70, () => {}],                                          // Unused_16_StubNop: ret
  [BANK, 0x4A71, hook(P => { unusedBuildMatchResultTilemap(P); })],
  [BANK, 0x4C9D, hook(P => advanceResultScreenTimer(P))],
  [BANK, 0x4CB1, hook(P => { queueResultScreenSprites(P); })],
  [BANK, 0x4CEA, hook((P, c) => { queueResultPortraitTop(P, c.d, c.e); })],
  [BANK, 0x4D45, hook((P, c) => { queueResultPortraitBottom(P, c.d, c.e); })],
  [BANK, 0x4D96, hook((P, c) => queueWinnerMarkerForPlayer(P, c.d, c.e))],
  [BANK, 0x4DAD, hook((P, c) => queueLoserMarkerForOpponent(P, c.d, c.e))],
  [BANK, 0x4DBA, hook((P, c) => queueWinnerMarkerForOpponent(P, c.d, c.e))],
  [BANK, 0x4DC7, hook((P, c) => queueLoserMarkerForPlayer(P, c.d, c.e))],
  [BANK, 0x4DDE, hook(P => getResultSpriteWobbleOffset(P))],
  [BANK, 0x4DFE, hook(P => { loadResultScreenTileGraphics(P); })],
  [BANK, 0x4E54, hook(P => { loadMatchResultGfxSet(P); })],
];
