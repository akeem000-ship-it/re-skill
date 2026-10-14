// The match results screen (bank $1E): after a story, ranking, Island Open, practice, dream or exhibition match the
// "Continue?" prompt window at the top (a second page warns that quitting without saving loses the progress), the
// player's panel (name and level), the match's header (by game mode: results_text.js) and score at the bottom,
// the characters celebrating; with c != 0 the EXP award screen instead (award_screen.js). Returns hl = the EXP
// total, a = the prompt's result (1 continue, 0 / $FF quit after the warning or B).
// Port of the code of src/engine/menus/results/results_screen_1e.asm of the gerbiljames/mario-tennis-gbc-disasm
// (MIT, third_party/mario-tennis-gbc-disasm); names and addresses are its own. Graphics and maps are read from the
// ROM.
// Covered by the lockstep on out/engine/exh1.mtrec, rec1.mtrec and the out/port/xr_* recordings.
import {
  FZ, rd, wr, far, rom, home, HOME, FAR, hook, hookGen, testFlag, setFlag, clearFlag, sound, advanceFrame, fadeIn,
  registerFrameTask, unregisterFrameTask, queueVRAMCopy, resetScrollAndCamera, BANK_EXP, BANK_BOOT, WRAM_STAGING,
  WRAM_COURT_PLANES, WRAM_SCREEN, WRAM_SCENE, TILE_SIZE, TILEMAP_WIDTH, SCREEN_HEIGHT, VRAM_BANK1, vTiles1, vTiles2,
  vBGMap0, wDecompBuffer, wTextTileBuffer, wTextTileBuffer_BLOCKS, wShadowTilemap, wScreenAttrmap, BGM_MENU, GAMEMODE,
  FLAG, STORYLOC_PEACHS_CASTLE, rWY, cell, getRegs,
} from "../exp/defs.js";
import { enableLCD } from "../../home/system.js";
import { clearFrameTasks } from "../../home/debugtext.js";
import { clearSpriteQueue } from "../../home/fade.js";
import { decompressData } from "../../home/decompress.js";
import { loadPaletteShadow } from "../../home/palettes.js";
import { beginFadeOut, waitFadeEnd } from "../../home/colorfade.js";
import { loadMenuFontGfx } from "../main_menu/boot.js";
import { showExpAwardScreen, copyWram1To } from "../exp/award_screen.js";
import {
  drawProportionalTextLine, fetchAndDrawDialogueText, drawContinuePromptText, drawExhibitionResultsHeader,
  drawRankMatchResultsHeader, drawTournamentResultsHeader, drawPracticeResultsHeader, drawMarioExhibitionResultsHeader,
} from "./results_text.js";
import { drawPlayerNameAndLevel, initResultsScreenCharacters, runContinuePrompt } from "./results_prompt.js";

export const BANK = BANK_EXP;
// ROM data (bank $1E)
const ResultsScreenPalettes = 0x4C40, ResultsScreenGfx_1e = 0x4C70, ResultsScreenTilemap_1e = 0x521F;
const ResultsScreenAttrmap_1e = 0x52EC, PanelFrameGfx_1e = 0x5343, PanelFrameGfx_BLOCKS = 0x10;
const ResultsSinglesLabelTilemap_1e = 0x53DF, ResultsDoublesLabelTilemap_1e = 0x53F2;
const ResultsScreenGfx_BLOCKS = 128;                                 // (128 of its 176 tiles)
const DrawResultsCharSprites = 0x4A76;                               // a frame task
const Text_31_210 = 0x04D2, Text_31_211 = 0x04D3, Text_31_212 = 0x04D4, Text_31_213 = 0x04D5, Text_31_214 = 0x04D6;
const Text_31_216 = 0x04D8, Text_31_217 = 0x04D9;
const STORY_LOCATION_NAMES = 0x0179;                                 // the location names' text ids (+ location)
const SCREEN_MAP_BYTES = 0x240, TEXT_ROW = 0x0020, BLANK = 0x20, LABEL_ATTR = 0x08;
const NO_EXP_SCREEN = [GAMEMODE.TRAINING_DRILL, GAMEMODE.TENNIS_MACHINE, GAMEMODE.WALL_PRACTICE];

// ShowMatchResultsScreen (1E:400E): the results screen, or (c != 0) the EXP award screen. Doubles (FLAG_DOUBLES,
// outside the drills) shows the doubles layout (FLAG_TEMP_RESULTS_SCREEN_OPEN).
export function* showMatchResultsScreen(P, c) {
  clearFlag(P, FLAG.TEMP_RESULTS_SCREEN_OPEN);
  if (!NO_EXP_SCREEN.includes(P.V.gameMode) && testFlag(P, FLAG.DOUBLES)) setFlag(P, FLAG.TEMP_RESULTS_SCREEN_OPEN);
  if (c) return yield* showExpAwardScreen(P);
  beginFadeOut(P, 16);
  c = (yield* waitFadeEnd(P, { ...getRegs(P.cpu), c: 16 })).c;      // (the prompt kind is the c the fade leaves)
  sound(P, BGM_MENU);
  rom(P, FAR.InitTextWindows);
  P.V.shadowTilemapBank = WRAM_SCREEN;
  rom(P, FAR.PrepareGlyphBuffer);
  clearFrameTasks(P);
  home(P, HOME.DisableLCDSafely);
  resetScrollAndCamera(P);
  P.bus.w8(rWY, 0x90);
  clearSpriteQueue(P);
  rom(P, FAR.InitActorEngine);
  initResultsPromptState(P, c);
  buildResultsScreenTilemap(P);
  initResultsScreenCharacters(P);
  enableLCD(P);
  yield* advanceFrame(P);
  registerFrameTask(P, 1, DrawResultsCharSprites);
  yield* fadeIn(P, 16);
  yield* runContinuePrompt(P);
  beginFadeOut(P, 16);
  yield* waitFadeEnd(P, getRegs(P.cpu));
  unregisterFrameTask(P, DrawResultsCharSprites);
  far(P, BANK_BOOT, () => loadMenuFontGfx(P));
  P.wramBank(WRAM_SCENE);
  return { hl: P.bus.u16(P.A.expAwardRunningTotal), a: rd(P, "continuePromptResult") };
}
// InitResultsPromptState (1E:40AC): the prompt kind c, row 0 of page 0
export function initResultsPromptState(P, c) {
  P.wramBank(WRAM_SCENE);
  wr(P, "continuePromptKind", c);
  wr(P, "continuePromptRow", 0);
  wr(P, "continuePromptPage", 0);
  return { a: 0 };
}
// BuildResultsScreenTilemap (1E:40BE): the graphics, the three prompt lines (proportional text into the glyph
// tiles), the panels and the player's panel, both maps queued, the glyphs uploaded
export function buildResultsScreenTilemap(P) {
  loadResultsScreenGraphics(P);
  let r = drawProportionalTextLine(P, Text_31_210, wDecompBuffer + 4 * TILE_SIZE + 1);
  r = drawProportionalTextLine(P, Text_31_211, (r.d << 8) | r.e);
  drawProportionalTextLine(P, Text_31_212, (r.d << 8) | r.e);
  buildResultsScreenPanels(P);
  drawPlayerNameAndLevel(P);
  P.wramBank(WRAM_SCREEN);
  queueVRAMCopy(P, wShadowTilemap, vBGMap0, SCREEN_HEIGHT * TILEMAP_WIDTH / 16);
  P.wramBank(WRAM_COURT_PLANES);
  queueVRAMCopy(P, wScreenAttrmap, vBGMap0 + VRAM_BANK1, SCREEN_HEIGHT * TILEMAP_WIDTH / 16);
  return rom(P, FAR.UploadGlyphBuffer);
}
// LoadResultsScreenGraphics (1E:4105): palettes (BG 0-5, OBJ 0), the screen's tiles and the text tiles, its maps,
// the panel frame tiles
export function loadResultsScreenGraphics(P) {
  loadPaletteShadow(P, ResultsScreenPalettes, 0, 6);
  loadPaletteShadow(P, ResultsScreenPalettes, 8, 1);
  P.wramBank(WRAM_STAGING);
  decompressData(P, ResultsScreenGfx_1e, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles2 + VRAM_BANK1, ResultsScreenGfx_BLOCKS);
  queueVRAMCopy(P, wTextTileBuffer, vTiles1 + VRAM_BANK1, wTextTileBuffer_BLOCKS);
  P.wramBank(WRAM_STAGING);
  decompressData(P, ResultsScreenTilemap_1e, wDecompBuffer);
  resultsCopyToTilemap(P, wDecompBuffer, SCREEN_MAP_BYTES);
  P.wramBank(WRAM_STAGING);
  decompressData(P, ResultsScreenAttrmap_1e, wDecompBuffer);
  resultsCopyToAttrmap(P, wDecompBuffer, SCREEN_MAP_BYTES);
  P.wramBank(WRAM_STAGING);
  decompressData(P, PanelFrameGfx_1e, wDecompBuffer);
  return queueVRAMCopy(P, wDecompBuffer, vTiles2, PanelFrameGfx_BLOCKS);
}
// ResultsCopyToTilemap (1E:4187) / ResultsCopyToAttrmap (1E:419C): bc bytes at hl from WRAM 1 to WRAM 3 / WRAM 2
export const resultsCopyToTilemap = (P, hl, bc) => copyWram1To(P, WRAM_SCREEN, hl, bc);
export const resultsCopyToAttrmap = (P, hl, bc) => copyWram1To(P, WRAM_COURT_PLANES, hl, bc);
// a frame of window tiles in WRAM 3: corners, edges, blank inside (rows top..bottom, columns left..right)
function frame(P, top, bottom, left, right) {
  const put = (row, col, t) => P.bus.w8(cell(wShadowTilemap, row, col), t);
  put(top, left, 0x02); put(top, right, 0x04); put(bottom, left, 0x07); put(bottom, right, 0x09);
}
// BuildResultsScreenPanels (1E:41B1): the prompt window (rows 0-4) with "Continue?", the bottom window (rows 13-17),
// the small "Lv" box (rows 6-9, columns 14-19), all attributes 0; then the header by game mode
export function buildResultsScreenPanels(P) {
  const fill = (row, col, a, c) => fillMemoryC(P, cell(wShadowTilemap, row, col), a, c);
  const put = (row, col, t) => P.bus.w8(cell(wShadowTilemap, row, col), t);
  for (const [top, bottom] of [[0, 4], [13, 17]]) {
    P.wramBank(WRAM_SCREEN);
    frame(P, top, bottom, 0, 19);
    fill(top, 1, 0x03, 0x12);
    fill(bottom, 1, 0x08, 0x12);
    for (let row = top + 1; row < bottom; row++) put(row, 0, 0x05);
    for (let row = top + 1; row < bottom; row++) put(row, 19, 0x06);
    for (let row = top + 1; row < bottom; row++) fill(row, 1, BLANK, 0x12);
    P.wramBank(WRAM_COURT_PLANES);
    fillMemoryC(P, cell(wScreenAttrmap, top, 0), 0, 0xA0);
    if (top === 0) drawContinuePromptText(P, cell(wScreenAttrmap, 2, 1));
  }
  P.wramBank(WRAM_SCREEN);
  frame(P, 6, 9, 14, 19);
  for (let i = 0; i < 4; i++) put(6, 15 + i, 0x03);
  for (let i = 0; i < 4; i++) put(9, 15 + i, 0x08);
  put(7, 14, 0x05); put(8, 14, 0x05); put(7, 19, 0x06); put(8, 19, 0x06);
  put(7, 15, 0); put(7, 18, 0); put(8, 15, 0); put(8, 18, 0);
  fetchAndDrawDialogueText(P, Text_31_213, cell(wShadowTilemap, 7, 16), TEXT_ROW);
  fetchAndDrawDialogueText(P, Text_31_214, cell(wShadowTilemap, 8, 16), TEXT_ROW);
  P.wramBank(WRAM_COURT_PLANES);
  for (let row = 6; row <= 9; row++) fillMemoryC(P, cell(wScreenAttrmap, row, 14), 0, 0x06);
  switch (P.V.gameMode) {
    case GAMEMODE.NONE: return drawStoryResultsHeader(P);
    case GAMEMODE.EXHIBITION: return drawExhibitionResultsHeader(P);
    case GAMEMODE.RANKING_MATCH: return drawRankMatchResultsHeader(P);
    case GAMEMODE.ISLAND_OPEN: return drawTournamentResultsHeader(P);
    case GAMEMODE.PRACTICE_MATCH: return drawPracticeResultsHeader(P);
    case GAMEMODE.DREAM_MATCH: return drawMarioExhibitionResultsHeader(P);
    default: return {};
  }
}
// LoadSinglesLabelTiles (1E:433A) / LoadDoublesLabelTiles (1E:434A): the name labels' tiles into wDecompBuffer
export function loadSinglesLabelTiles(P) { P.wramBank(WRAM_STAGING); return { hl: decompressData(P, ResultsSinglesLabelTilemap_1e, wDecompBuffer) }; }
export function loadDoublesLabelTiles(P) { P.wramBank(WRAM_STAGING); return { hl: decompressData(P, ResultsDoublesLabelTilemap_1e, wDecompBuffer) }; }
// DrawResultsNameLabelRows (1E:435A): the two label rows (7 cells, attribute 8) above the names: rows 11-12 and the
// box's edge on row 13 (a = 0), or rows 9-10 with the doubles box from row 11 (a != 0)
export function drawResultsNameLabelRows(P, a) {
  const put = (row, col, t) => P.bus.w8(cell(wShadowTilemap, row, col), t);
  let r;
  if (!a) {
    r = copyLabelTilesToTilemap(P, wScreenAttrmap, cell(wScreenAttrmap, 11, 0), 7);
    copyLabelTilesToTilemap(P, r.hl, cell(wScreenAttrmap, 12, 0), 7);
    P.wramBank(WRAM_SCREEN);
    fillMemoryC(P, cell(wShadowTilemap, 13, 1), BLANK, 5);
    put(13, 0, 0x05); put(13, 6, 0x08);
    P.wramBank(WRAM_COURT_PLANES);
    P.bus.w8(cell(wScreenAttrmap, 13, 6), LABEL_ATTR);
    return { a: LABEL_ATTR };
  }
  r = copyLabelTilesToTilemap(P, wScreenAttrmap, cell(wScreenAttrmap, 9, 0), 7);   // .doublesLayout
  copyLabelTilesToTilemap(P, r.hl, cell(wScreenAttrmap, 10, 0), 7);
  P.wramBank(WRAM_SCREEN);
  fillMemoryC(P, cell(wShadowTilemap, 12, 1), BLANK, 0x12);
  fillMemoryC(P, cell(wShadowTilemap, 13, 1), BLANK, 0x12);
  fillMemoryC(P, cell(wShadowTilemap, 11, 1), BLANK, 5);
  put(11, 19, 0x04);
  fillMemoryC(P, cell(wShadowTilemap, 11, 7), 0x03, 0x0C);
  put(11, 0, 0x05); put(12, 0, 0x05); put(13, 0, 0x05);
  put(12, 19, 0x06); put(13, 19, 0x06);
  put(11, 6, 0x08);
  P.wramBank(WRAM_COURT_PLANES);
  fillMemoryC(P, cell(wScreenAttrmap, 11, 0), 0, 0x14);
  fillMemoryC(P, cell(wScreenAttrmap, 12, 0), 0, 0x14);
  P.bus.w8(cell(wScreenAttrmap, 11, 6), LABEL_ATTR);
  return { a: LABEL_ATTR };
}
// CopyLabelTilesToTilemap (1E:440D): c label tiles from hl (WRAM 1) to de (WRAM 3), attribute 8 (WRAM 2)
export function copyLabelTilesToTilemap(P, hl, de, c) {
  let b = 0;
  for (let n = c || 0x100; n > 0; n--) {
    P.wramBank(WRAM_STAGING); b = P.bus.u8(hl);
    P.wramBank(WRAM_SCREEN); P.bus.w8(de, b);
    P.wramBank(WRAM_COURT_PLANES); P.bus.w8(de, LABEL_ATTR);
    hl = (hl + 1) & 0xFFFF; de = (de + 1) & 0xFFFF;
  }
  return { a: LABEL_ATTR, b, c: 0, f: FZ, hl, de };
}
// UnusedClearLabelTilemapRow (1E:442B): row 13's label part blanked (nothing calls it)
export function unusedClearLabelTilemapRow(P) {
  P.wramBank(WRAM_SCREEN);
  fillMemoryC(P, cell(wShadowTilemap, 13, 1), BLANK, 5);
  P.wramBank(WRAM_SCREEN);
  P.bus.w8(cell(wShadowTilemap, 13, 0), 0x05);
  P.wramBank(WRAM_COURT_PLANES);
  P.bus.w8(cell(wScreenAttrmap, 13, 0), 0);
  P.bus.w8(cell(wScreenAttrmap, 13, 6), LABEL_ATTR);
  P.wramBank(WRAM_SCREEN);
  P.bus.w8(cell(wShadowTilemap, 13, 6), LABEL_ATTR);
  return { a: LABEL_ATTR };
}
// FillMemoryC (1E:4461): c bytes of a from hl
export function fillMemoryC(P, hl, a, c) {
  for (let n = c || 0x100; n > 0; n--) { P.bus.w8(hl, a); hl = (hl + 1) & 0xFFFF; }
  return { hl, c: 0, f: FZ };
}
// DrawStoryResultsHeader (1E:4466): a story match's place: "match at" / "match in the sky" and the location's name
// (Peach's Castle: its name alone, a row higher)
export function drawStoryResultsHeader(P) {
  const location = P.V.storyReturnLocation, name = (STORY_LOCATION_NAMES + location) & 0xFFFF;
  if (!testFlag(P, FLAG.ISLAND_SKY_SCENE_ACTIVE)) {
    if (location === STORYLOC_PEACHS_CASTLE) return drawProportionalTextLine(P, name, cell(wScreenAttrmap, 15, 7));
    drawProportionalTextLine(P, Text_31_216, cell(wScreenAttrmap, 14, 3));
  } else drawProportionalTextLine(P, Text_31_217, cell(wScreenAttrmap, 14, 2));
  return drawProportionalTextLine(P, (STORY_LOCATION_NAMES + P.V.storyReturnLocation) & 0xFFFF, cell(wScreenAttrmap, 16, 4));
}

export const HOOKS = [
  [BANK, 0x400E, hookGen((P, c) => showMatchResultsScreen(P, c.c))],
  [BANK, 0x40AC, hook((P, c) => initResultsPromptState(P, c.c))],
  [BANK, 0x40BE, hook(P => { buildResultsScreenTilemap(P); })],
  [BANK, 0x4105, hook(P => { loadResultsScreenGraphics(P); })],
  [BANK, 0x4187, hook((P, c) => resultsCopyToTilemap(P, c.hl, c.bc))],
  [BANK, 0x419C, hook((P, c) => resultsCopyToAttrmap(P, c.hl, c.bc))],
  [BANK, 0x41B1, hook(P => { buildResultsScreenPanels(P); })],
  [BANK, 0x433A, hook(P => loadSinglesLabelTiles(P))],
  [BANK, 0x434A, hook(P => loadDoublesLabelTiles(P))],
  [BANK, 0x435A, hook((P, c) => drawResultsNameLabelRows(P, c.a))],
  [BANK, 0x440D, hook((P, c) => copyLabelTilesToTilemap(P, c.hl, c.de, c.c))],
  [BANK, 0x442B, hook(P => unusedClearLabelTilemapRow(P))],
  [BANK, 0x4461, hook((P, c) => fillMemoryC(P, c.hl, c.a, c.c))],
  [BANK, 0x4466, hook(P => { drawStoryResultsHeader(P); })],
];
