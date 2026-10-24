// The minigame rules screen (bank $17, ShowRulesScreen, slot $400C): before a minigame, its rules page by page in a
// window framed by an animated border, two characters animating beside it (sprites), the player's record (the
// first page can show it: a page byte with bit 7 is skipped forward when the record is 9999), and a next-page arrow.
// A or DOWN turns the page (after the first page the colored first row is plain), B leaves with wRulesExitCode
// $FF (back to the level select), START leaves at once; after the last page A ends the screen. The screen fades in
// and out (32).
// Port of src/engine/menus/briefing/rules_17.asm (from ShowRulesScreen) of the gerbiljames/mario-tennis-gbc-disasm
// (MIT, third_party/mario-tennis-gbc-disasm): names and addresses are its own; tables and graphics are read from
// the ROM.
// Tests: lockstep on out/port/rules_*.mtrec (the minigames' rules from the main menu); routines_menus_pause.mjs.
import {
  FAR, rom, wram, rd, wr, u16, sound, advanceFrame, prepareGlyphBuffer, uploadGlyphBuffer, renderProportionalTextAt,
  registerFrameTask, unregisterFrameTask, clearFrameTasks, queueVRAMCopy, decompressData, loadPalettesImmediate,
  queueSpriteTemplate, enableLCD, disableLCDSafely, fadeIn, fadeOut, fillTilemapRect, loadCompressedTileBlock,
  loadScreenAssetRecord, queueWram3MapToVRAM, hook, hookGen, WRAM_STAGING, WRAM_SCREEN, WRAM_TEXT, WRAM_SOUND,
  OBJ_PALETTES, TILE_SIZE, VRAM_BANK1, vTiles0, vTiles2, vBGMap0, wDecompBuffer, wShadowTilemap, wShadowAttrmap,
  SFX_MENU_SELECT, SFX_MENU_DECIDE, SFX_MENU_CANCEL, PADF_A, PADF_B, PADF_START, PADF_DOWN,
} from "../pause/defs.js";
import { BANK_BRIEFING, AnimatedTiles } from "./screen.js";

const rb = (P, a) => P.rom.u8(BANK_BRIEFING, a), rw = (P, a) => P.rom.u16(BANK_BRIEFING, a);
const MinigameRulesTextIdBases_17 = 0x6FDB, MinigameRulesPageLists_17 = 0x6FED;
const RulesScreenAnimFrameTable = 0x747F, RulesScreenAnimFrameTable1 = 0x749F;
const DrawRulesScreenCharacters_SpriteTemplate = 0x7527;
const RulesScreenCharactersTable0 = 0x754C, RulesScreenCharactersTable1 = 0x7552, RulesScreenCharactersTable2 = 0x7558;
const RulesScreenTiles = 0x7570, RulesScreenPalette = 0x7B39;
const RulesBorderAnimTiles0 = 0x793C, RulesBorderAnimTiles1 = 0x7A08, RulesBorderAnimTiles2 = 0x7A2F;
const RulesBorderAnimTiles3 = 0x7A56, RulesBorderAnimTiles4 = 0x7AF8, RulesBorderAnimTiles5 = 0x7B18;
const RulesBorderAnimTiles0_BLOCKS = 0x12, RulesBorderAnimTiles1_BLOCKS = 0x02;    // (the ROM's `ld bc` operands)
const RulesBorderAnimTiles3_BLOCKS = 0x12, RulesBorderAnimTiles4_BLOCKS = 0x02;
export const AdvanceRulesScreenAnimFrame = 0x7420, DrawRulesScreenCharacters = 0x74DB, DrawRulesNextPageArrow = 0x755E;
const ApplySpriteWobbleY_17 = [0x17, 0x40A3];
const SCREENASSET_RulesScreen = 0x44;
const TILEBLOCK_SharedMenuGfx17Alias17 = 0x11, SharedMenuGfx17_BLOCKS = 0x10;
const RULES_PAGES_STRIDE = 6, RULES_PAGES_END = 0xFF, PAGE_IF_NOT_MAXED = 0x80;
const RECORD_MAX = 0x270F;                                       // 9999
const FIRST_RECORD = 2;                                          // ReadMinigameRecord: the minigame's record, + 2
const PAGE_TEXT = wShadowTilemap + 4 * 32 + 2, PAGE_TEXT_WIDTH = 0x10;
const CHARACTERS_X = 0x7E, CHARACTERS_Y = 0x68, SECOND_CHARACTER_TILES = 0x12;
const ARROW_X = 0x78, ARROW_Y = 0x88;

// ShowRulesScreen (17:6F1B), slot $400C: the rules of page list a (see the header). Returns a = wRulesExitCode.
export function* showRulesScreen(P, list) {
  wram(P, WRAM_SCREEN);
  wr(P, "rulesPageListId", list);
  wr(P, "rulesMinigameLevel", rd(P, "minigameLevel"));
  for (const name of ["rulesExitCode", "rulesAnimEnabled", "rulesAnimCounter", "rulesIsMinigame", "rulesScreenAnimFrame"]) wr(P, name, 0);
  yield* fadeOut(P, 32);
  disableLCDSafely(P);
  loadRulesScreen(P);
  wr(P, "animatedTileSet", 1);
  wr(P, "animatedTilePeriod", 0x03);
  registerFrameTask(P, 1, AnimatedTiles);
  enableLCD(P);
  yield* fadeIn(P, 32);
  wram(P, WRAM_SCREEN);
  registerFrameTask(P, 1, AdvanceRulesScreenAnimFrame);
  wr(P, "rulesAnimEnabled", 1);
  wr(P, "rulesAnimCounter", 0);
  yield* runMinigameRulesPages(P);
  yield* fadeOut(P, 32);
  clearFrameTasks(P);
  return rd(P, "rulesExitCode");
}
// RunMinigameRulesPages (17:6F91): the minigame's record read (and pushed as the text's number argument), its
// first page text, then its page list (MinigameRulesPageLoop)
export function* runMinigameRulesPages(P) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  const game = rd(P, "selectedMinigame");
  rom(P, FAR.ReadMinigameRecord, { a: (game + FIRST_RECORD) & 0xFF });
  rom(P, FAR.PushTextArgNumber, { hl: minigameRecordValue(P) });
  P.bus.w16(P.A.rulesPageTextIdBase, rw(P, (MinigameRulesTextIdBases_17 + ((game * 2) & 0xFF)) & 0xFFFF));
  yield* minigameRulesPageLoop(P, MinigameRulesPageLists_17, rd(P, "rulesPageListId"));
  wram(P, bank);
}
// wMinigameRecordValue (WRAM 7), read with WRAM 7 mapped; WRAM 3 mapped after
function minigameRecordValue(P) {
  wram(P, WRAM_SOUND);
  const v = u16(P, P.A.minigameRecordValue);
  wram(P, WRAM_SCREEN);
  return v;
}
// MinigameRulesPageLoop (17:709B): the pages of list a of the table hl (6 bytes a list, $FF-ended)
export function* minigameRulesPageLoop(P, table, list) {
  let hl = (table + ((list * RULES_PAGES_STRIDE) & 0xFF)) & 0xFFFF;
  for (;;) {
    let page = rb(P, hl);
    hl = (hl + 1) & 0xFFFF;
    if (page === RULES_PAGES_END) { sound(P, SFX_MENU_DECIDE); return; }
    if (page & PAGE_IF_NOT_MAXED && minigameRecordValue(P) === RECORD_MAX) page = (page + 1) & 0xFF;
    page &= 0x7F;
    if (rb(P, hl) !== RULES_PAGES_END) registerFrameTask(P, 1, DrawRulesNextPageArrow);
    prepareRulesPageTilemap(P);
    prepareGlyphBuffer(P);
    yield* renderProportionalTextAt(P, (P.bus.u16(P.A.rulesPageTextIdBase) + page) & 0xFFFF, PAGE_TEXT, PAGE_TEXT_WIDTH);
    yield* uploadGlyphBuffer(P);
    yield* queueRulesPageToVRAM(P);
    for (;;) {
      yield* advanceFrame(P);
      const edge = P.V.inputRisingEdge;
      if (edge & (PADF_A | PADF_DOWN)) {
        sound(P, SFX_MENU_SELECT);
        unregisterFrameTask(P, DrawRulesNextPageArrow);
        unregisterFrameTask(P, RulesScreenTiles);                  // (no such task: the ROM's slip)
        wr(P, "rulesAnimEnabled", 1);
        wr(P, "rulesIsMinigame", 1);
        wr(P, "rulesAnimCounter", 0);
        break;
      }
      if (edge & PADF_B) {
        sound(P, SFX_MENU_CANCEL);
        unregisterFrameTask(P, DrawRulesNextPageArrow);
        unregisterFrameTask(P, RulesScreenTiles);
        wr(P, "rulesExitCode", 0xFF);
        sound(P, SFX_MENU_DECIDE);
        return;
      }
      if (edge & PADF_START) { sound(P, SFX_MENU_DECIDE); return; }
    }
  }
}
// LoadRulesScreen (17:7157): the border tiles, the font, the screen asset, the text windows over WRAM 3 ($D000),
// the page area cleared, the sprite palettes, arrows and tiles, the characters' task, the maps to VRAM
export function loadRulesScreen(P) {
  loadRulesBorderAnimTiles(P);
  rom(P, FAR.LoadMenuFontGfx);
  loadScreenAssetRecord(P, SCREENASSET_RulesScreen);
  const bank = P.V.wramBank;
  rom(P, FAR.InitTextWindows);
  wram(P, WRAM_TEXT);
  wr(P, "shadowTilemapBank", WRAM_SCREEN);
  wr(P, "windowTileAttr", 0);
  wram(P, bank);
  prepareGlyphBuffer(P);
  clearRulesScreenTextArea(P);
  loadPalettesImmediate(P, RulesScreenPalette, OBJ_PALETTES + 1, 2);
  rom(P, FAR.LoadMenuArrowSpriteTiles, { de: vTiles0 + VRAM_BANK1 });
  rom(P, FAR.LoadIndexedPalette, { b: 0x08, c: 0x0F });
  loadCompressedTileBlock(P, TILEBLOCK_SharedMenuGfx17Alias17, vTiles2, SharedMenuGfx17_BLOCKS);
  wr(P, "shadowTilemapBank", WRAM_SCREEN);
  P.bus.w16(P.A.shadowTilemapPtr, wDecompBuffer);
  registerFrameTask(P, 1, DrawRulesScreenCharacters);
  return queueWram3MapToVRAM(P);
}
function inScreenBank(P, fn) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  const r = fn();
  wram(P, bank);
  return r;
}
// ClearRulesScreenTextArea (17:71BD): the page area's attributes 0, its rows blank
export const clearRulesScreenTextArea = P => inScreenBank(P, () => {
  fillTilemapRect(P, wShadowAttrmap + 3 * 32 + 2, 0x10, 0x0E, 0x00);
  clearRulesPageRows(P);
});
// ClearRulesPageRows (17:71DB): the page's border row (tile 3) and its 13 text rows blank
export const clearRulesPageRows = P => inScreenBank(P, () => {
  fillTilemapRect(P, wShadowTilemap + 3 * 32 + 2, 0x10, 0x01, 0x03);
  fillTilemapRect(P, wShadowTilemap + 4 * 32 + 2, 0x10, 0x0D, 0x20);
});
// PrepareRulesPageTilemap (17:7202): the page rows blank; the first text row colored by the level (palette level
// + 3) on the first page, plain after
export const prepareRulesPageTilemap = P => inScreenBank(P, () => {
  fillTilemapRect(P, wShadowTilemap + 3 * 32 + 2, 0x10, 0x01, 0x03);
  fillTilemapRect(P, wShadowTilemap + 4 * 32 + 2, 0x10, 0x0D, 0x20);
  const attr = rd(P, "rulesIsMinigame") ? 0x00 : (rd(P, "rulesMinigameLevel") + 3) & 0xFF;
  fillTilemapRect(P, wShadowAttrmap + 4 * 32 + 2, 0x10, 0x01, attr);
});
// QueueRulesPageToVRAM (17:724D): the page's rows to VRAM over three frames (from row 4 on the first page, 3 after)
export function* queueRulesPageToVRAM(P) {
  const first = rd(P, "rulesIsMinigame") ? 3 : 4;
  queueVRAMCopy(P, wShadowTilemap + first * 32, vBGMap0 + first * 32, 5 * 32 / 16);
  queueVRAMCopy(P, wShadowAttrmap + 4 * 32, vBGMap0 + 4 * 32 + VRAM_BANK1, 32 / 16);
  yield* advanceFrame(P);
  queueVRAMCopy(P, wShadowTilemap + 8 * 32, vBGMap0 + 8 * 32, 5 * 32 / 16);
  yield* advanceFrame(P);
  queueVRAMCopy(P, wShadowTilemap + 13 * 32, vBGMap0 + 13 * 32, 4 * 32 / 16);
}
// LoadRulesBorderAnimTiles (17:7293): the border's animated tiles, each set decompressed into WRAM 1 and copied
// to its places in both VRAM banks (leaves WRAM 1 mapped)
const T = tile => vTiles0 + tile * TILE_SIZE, T1 = tile => vTiles0 + tile * TILE_SIZE + VRAM_BANK1;
export function loadRulesBorderAnimTiles(P) {
  wram(P, WRAM_STAGING);
  const set = (src, copies) => {
    decompressData(P, src, wDecompBuffer);
    for (const [from, dest, blocks] of copies) queueVRAMCopy(P, wDecompBuffer + from * TILE_SIZE, dest, blocks);
  };
  set(RulesBorderAnimTiles0, [[0, T(0x00), RulesBorderAnimTiles0_BLOCKS], [0, T(0x24), RulesBorderAnimTiles0_BLOCKS],
    [0, T(0x48), RulesBorderAnimTiles0_BLOCKS], [0, T1(0x10), 18], [0, T1(0x34), 18], [0, T1(0x58), 18]]);
  set(RulesBorderAnimTiles1, [[0, T(0x4A), RulesBorderAnimTiles1_BLOCKS], [0, T1(0x12), RulesBorderAnimTiles1_BLOCKS],
    [0, T1(0x36), RulesBorderAnimTiles1_BLOCKS], [0, T1(0x5A), 2]]);
  set(RulesBorderAnimTiles2, [[2, T(0x2C), 1], [2, T1(0x18), 1], [0, T1(0x3C), 1], [4, T1(0x60), 1]]);
  set(RulesBorderAnimTiles3, [[0, T(0x12), RulesBorderAnimTiles3_BLOCKS], [0, T(0x36), RulesBorderAnimTiles3_BLOCKS],
    [0, T(0x5A), RulesBorderAnimTiles3_BLOCKS], [0, T1(0x22), 18], [0, T1(0x46), 18], [0, T1(0x6A), 18]]);
  set(RulesBorderAnimTiles4, [[0, T(0x5C), RulesBorderAnimTiles4_BLOCKS], [0, T1(0x24), RulesBorderAnimTiles4_BLOCKS],
    [0, T1(0x48), RulesBorderAnimTiles4_BLOCKS], [0, T1(0x6C), 2]]);
  set(RulesBorderAnimTiles5, [[2, T(0x3E), 1], [2, T1(0x2A), 1], [0, T1(0x4E), 1], [4, T1(0x72), 1]]);
}
// AdvanceRulesScreenAnimFrame (17:7420), a frame task: the characters' frame: after a page turn (wRulesAnimEnabled,
// for 255 frames) RulesScreenAnimFrameTable1 by 8-frame steps, else RulesScreenAnimFrameTable by 16-frame steps
export const advanceRulesScreenAnimFrame = P => inScreenBank(P, () => {
  const counter = (rd(P, "rulesAnimCounter") + 1) & 0xFF;
  wr(P, "rulesAnimCounter", counter);
  const vbc = P.V.vBlankCounter;
  if (rd(P, "rulesAnimEnabled")) wr(P, "rulesScreenAnimFrame", rb(P, RulesScreenAnimFrameTable1 + ((vbc >> 3) & 0x3F)));
  else wr(P, "rulesScreenAnimFrame", rb(P, RulesScreenAnimFrameTable + ((vbc >> 4) & 0x1F)));
  if (rd(P, "rulesAnimEnabled") && counter === 0xFF) wr(P, "rulesAnimEnabled", 0);
});
// DrawRulesScreenCharacters (17:74DB), a frame task: the two characters (3x3 sprites each) in frame
// wRulesScreenAnimFrame (tiles and attributes from RulesScreenCharactersTable0-2)
export const drawRulesScreenCharacters = P => inScreenBank(P, () => {
  const frame = rd(P, "rulesScreenAnimFrame"), tiles = rb(P, (RulesScreenCharactersTable0 + frame) & 0xFFFF);
  queueSpriteTemplate(P, DrawRulesScreenCharacters_SpriteTemplate, CHARACTERS_X, CHARACTERS_Y, tiles, rb(P, (RulesScreenCharactersTable1 + frame) & 0xFFFF));
  return queueSpriteTemplate(P, DrawRulesScreenCharacters_SpriteTemplate, CHARACTERS_X, CHARACTERS_Y,
    tiles + SECOND_CHARACTER_TILES, rb(P, (RulesScreenCharactersTable2 + frame) & 0xFFFF));
});
// DrawRulesNextPageArrow (17:755E), a frame task: the next-page arrow at ($78, $88), wobbling
export function drawRulesNextPageArrow(P) {
  const { e } = rom(P, ApplySpriteWobbleY_17, { c: 0, d: ARROW_X, e: ARROW_Y });
  return rom(P, FAR.QueueStackedSpritePair, { b: 0x08, c: 0x00, h: 0x03, d: ARROW_X, e });
}

const B = BANK_BRIEFING;
export const HOOKS = [
  [B, 0x6F1B, hookGen(function* (P, c) { return { a: yield* showRulesScreen(P, c.a) }; })],
  [B, 0x6F91, hookGen(P => runMinigameRulesPages(P))],
  [B, 0x709B, hookGen((P, c) => minigameRulesPageLoop(P, c.hl, c.a))],
  [B, 0x7157, hook(P => { loadRulesScreen(P); })],
  [B, 0x71BD, hook(P => { clearRulesScreenTextArea(P); })],
  [B, 0x71DB, hook(P => { clearRulesPageRows(P); })],
  [B, 0x7202, hook(P => { prepareRulesPageTilemap(P); })],
  [B, 0x724D, hookGen(P => queueRulesPageToVRAM(P))],
  [B, 0x7293, hook(P => { loadRulesBorderAnimTiles(P); })],
  [B, AdvanceRulesScreenAnimFrame, hook(P => { advanceRulesScreenAnimFrame(P); })],
  [B, DrawRulesScreenCharacters, hook(P => { drawRulesScreenCharacters(P); })],
  [B, DrawRulesNextPageArrow, hook(P => { drawRulesNextPageArrow(P); })],
];
