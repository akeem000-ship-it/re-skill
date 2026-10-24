// The game-progress screen (bank $1E): the story file's list of reward categories (the classes, the Island Open,
// the drills: those reached) as a scrolling text window, each entry earned marked with a trophy or a star; up / down
// scroll it, A or B leaves. With the Star court open the list starts with the "all done" entry.
// Port of the code of src/engine/menus/exp/gameprogress_1e.asm and progress_1e.asm of the gerbiljames/
// mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm); names and addresses are its own. Graphics, lists
// and flag tables are read from the ROM.
//
// The list's state (WRAM 5, over the character struct's addresses): wProgressEntryUnlocked (48 entries),
// wProgressEntryEarned (37), wProgressVisibleEntries (the unlocked ones' numbers, $FF after), wProgressVisibleCount,
// wProgressListIndex (the first row shown); the window's id at wCharPosX + 1, the arrows' flags at wCharPosHeight + 1.
// Covered by the lockstep on out/port/xr_progress.mtrec (the story pause menu's progress screen).
import {
  FZ, FN, rd, wr, ix, far, rom, romWait, home, HOME, FAR, hook, hookGen, testFlag, setFlag, clearFlag, testGameFlag, sound,
  advanceFrame, fadeIn, fadeOut, registerFrameTask, queueVRAMCopy, romWord, romByte, regs8, BANK_EXP, BANK_SAVE,
  BANK_MENU_LIB, WRAM_STAGING, WRAM_TEXT, TILE_SIZE, VRAM_BANK1, vTiles0, vTiles2, vBGMap0, wDecompBuffer,
  wWindowShadowTilemap, PADF_A, PADF_B, PADF_UP, PADF_DOWN, BGM_STATUS_SCREEN, SFX_MENU_MOVE, SFX_MENU_SELECT,
  SFX_MENU_CANCEL, FLAG, SAVEFLAG, CHAR, PROGRESS,
} from "./defs.js";
import { enableLCD } from "../../home/system.js";
import { clearFrameTasks } from "../../home/debugtext.js";
import { clearSpriteQueue, queueSprite16 } from "../../home/fade.js";
import { decompressData } from "../../home/decompress.js";
import { loadPaletteShadow } from "../../home/palettes.js";
import { testSaveFlag } from "../../save/storyslots.js";
import { updateAnimatedTiles } from "../common/tilemaps.js";
import { loadMenuFontTiles, loadMenuArrowSpriteTiles, loadIndexedPalette, queueStackedSpritePair } from "../common/menu_lib.js";

export const BANK = BANK_EXP;
// ROM data and routines (bank $1E)
const ProgressEntryFlagList_1e = 0x6D80, RewardCategoryFlagTable_1e = 0x6DD2, RewardCategoryEntryListPtrs_1e = 0x7445;
const GameProgressHeaderGfx_1e = 0x75A6, GameProgressHeaderTilemap_1e = 0x7692, GameProgressHeaderAttrmap_1e = 0x76E2;
const GameProgressScreenPalettes0 = 0x7700, GameProgressScreenTiles0 = 0x7710, GameProgressScreenPalettes1 = 0x7810;
const GameProgressScreenTiles1 = 0x7820, GameProgressScreenTiles2 = 0x7960, GameProgressScreenPalettes2 = 0x79E0;
const HeaderGfx_BLOCKS = 0x20, HeaderTilemap_BLOCKS = 0x06, Tiles0_BLOCKS = 0x10, Tiles2_BLOCKS = 4, Tiles1_BLOCKS = 0x14;
const UpdateProgressScreenAnimatedTiles = 0x737E, DrawProgressScreenSprites = 0x7A8D;
const Text_31_160 = 0x04A0;                                          // the entries' names
const hInputPressed = 0xFF91, hScrollX = 0xFF8B, hScrollY = 0xFF8A;
const ENTRIES = 0x30, EARNED_ENTRIES = 0x25, ROWS = 7, ROWS_SCROLL = 6, ROW_CELLS = 0x10, NO_ENTRY = 0xFF;
const WINDOW_ID = CHAR.PosX + 1, ARROW_UP = CHAR.PosHeight + 1, ARROW_DOWN = CHAR.PosHeight + 2;
const LIST_FIRST_ROW = 0x82, LIST_ROW = 0x40, GLYPH_ROW_START = 0x70;
const u8 = (P, a) => P.bus.u8(a & 0xFFFF), w8 = (P, a, v) => P.bus.w8(a & 0xFFFF, v & 0xFF);

// ShowGameProgressScreen (1E:7263): the screen (the "all done" entry once the Star court is open)
export function* showGameProgressScreen(P) {
  if (far(P, BANK_SAVE, () => testSaveFlag(P, SAVEFLAG.COURT_STAR))) setFlag(P, FLAG.TEMP_PROGRESS_SCREEN_OPEN);
  setFlag(P, FLAG.TEMP_WIDE_GLYPH_STREAM);
  yield* buildGameProgressScreen(P);
  clearFlag(P, FLAG.TEMP_WIDE_GLYPH_STREAM);
  return clearFrameTasks(P);
}
// InitGameProgressScreen (1E:727D): the music, no tasks or sprites, the text windows on WRAM 5's map, no entries
export function initGameProgressScreen(P) {
  sound(P, BGM_STATUS_SCREEN);
  clearFrameTasks(P);
  clearSpriteQueue(P);
  P.bus.w8(hScrollX, 0); P.bus.w8(hScrollY, 0);
  rom(P, FAR.ResetTextWindowState);
  P.bus.w16(P.A.shadowTilemapPtr, wWindowShadowTilemap);
  P.V.shadowTilemapBank = WRAM_TEXT;
  P.V.windowTileAttr = 0;
  wr(P, "menuWindowId", 0);
  for (let i = 0; i < ENTRIES; i++) w8(P, PROGRESS.VisibleEntries + i, NO_ENTRY);
  return { a: NO_ENTRY, c: 0, f: FZ, hl: PROGRESS.VisibleEntries + ENTRIES };
}
// BuildGameProgressScreen (1E:72AF): the screen built (the categories reached by the class wins), shown, and its
// loop until A or B. The WRAM bank kept.
export function* buildGameProgressScreen(P) {
  const bank = P.V.wramBank;
  P.wramBank(WRAM_TEXT);
  yield* fadeOut(P, 16);
  home(P, HOME.DisableLCDSafely);
  initGameProgressScreen(P);
  loadGameProgressScreenAssets(P);
  if (testFlag(P, FLAG.TEMP_PROGRESS_SCREEN_OPEN)) runRewardCategoryList(P, 5);
  runRewardCategoryList(P, 0);
  [[FLAG.WON_JUNIOR_SINGLES_RANK_1, 1], [FLAG.WON_SENIOR_SINGLES_RANK_1, 2], [FLAG.WON_VARSITY_SINGLES_RANK_4, 3],
    [FLAG.WON_ISLAND_OPEN_SINGLES_FINAL, 4]].forEach(([flag, list]) => { if (testFlag(P, flag)) runRewardCategoryList(P, list); });
  buildProgressEntryEarnedTable(P);
  buildVisibleProgressEntryList(P);
  w8(P, WINDOW_ID, createProgressListWindow(P).a);
  drawWindowFrame(P);
  const r = yield* drawProgressListRows(P);
  rom(P, FAR.RedrawWindowRows, regs8(r));
  loadGameProgressScreenTiles(P);
  loadProgressScreenIconTiles(P);
  enableLCD(P);
  P.V.animatedTileSet = 1;
  P.V.animatedTilePeriod = 3;
  registerFrameTask(P, 1, UpdateProgressScreenAnimatedTiles);
  registerFrameTask(P, 1, DrawProgressScreenSprites);
  yield* fadeIn(P, 16);
  for (;;) {
    yield* advanceFrame(P);
    P.wramBank(WRAM_TEXT);
    const input = P.bus.u8(hInputPressed);
    if (input & PADF_UP) yield* scrollProgressListUp(P);
    if (input & PADF_DOWN) yield* scrollProgressListDown(P);
    if (input & PADF_A) { sound(P, SFX_MENU_SELECT); break; }
    if (input & PADF_B) { sound(P, SFX_MENU_CANCEL); break; }
  }
  P.wramBank(bank);
  return { a: bank };
}
// the list window's frame redrawn (DrawTextWindowFrame with the text renderer flagged)
function drawWindowFrame(P) {
  const a = u8(P, WINDOW_ID);
  setFlag(P, FLAG.TEXT_RENDER_ACTIVE);
  rom(P, FAR.DrawTextWindowFrame, { a });
  clearFlag(P, FLAG.TEXT_RENDER_ACTIVE);
}
// UpdateProgressScreenAnimatedTiles (1E:737E), a frame task
export function updateProgressScreenAnimatedTiles(P) { far(P, BANK_MENU_LIB, () => updateAnimatedTiles(P)); }
// ScrollProgressListDown (1E:7382) / ScrollProgressListUp (1E:73B0): the list one row on (while rows are left past
// the six shown) or back, redrawn. af kept.
export function* scrollProgressListDown(P) {
  rom(P, FAR.ResetGlyphStream);
  P.wramBank(WRAM_TEXT);
  const count = u8(P, PROGRESS.VisibleCount);
  if (count < ROWS_SCROLL) return;
  const next = (u8(P, PROGRESS.ListIndex) + 1) & 0xFF;
  if (next >= ((count - ROWS_SCROLL) & 0xFF)) return;
  yield* scrollTo(P, next);
}
export function* scrollProgressListUp(P) {
  rom(P, FAR.ResetGlyphStream);
  P.wramBank(WRAM_TEXT);
  const next = (u8(P, PROGRESS.ListIndex) - 1) & 0xFF;
  if (next & 0x80) return;
  yield* scrollTo(P, next);
}
function* scrollTo(P, index) {
  w8(P, PROGRESS.ListIndex, index);
  sound(P, SFX_MENU_MOVE);
  drawWindowFrame(P);
  yield* drawProgressListRows(P);
}
// UnusedCreateProgressHeaderWindow (1E:73D7) / CreateProgressListWindow (1E:73E3): a text window over (2, 0) 16 x 3
// / (1, 3) 18 x 15. Returns its id (a).
export const unusedCreateProgressHeaderWindow = P => rom(P, FAR.CreateWindowFromScreenRect, { d: 0x02, e: 0x00, b: 0x10, c: 0x03 });
export const createProgressListWindow = P => rom(P, FAR.CreateWindowFromScreenRect, { d: 0x01, e: 0x03, b: 0x12, c: 0x0F });
// TestProgressEntryFlag (1E:73EF): a = 1 when entry a's earned flag (ProgressEntryFlagList_1e on) is set
export function testProgressEntryFlag(P, a) {
  const set = testGameFlag(P, romWord(P, ix(ProgressEntryFlagList_1e, a * 2)));
  return set ? { a: 1 } : { a: 0, f: FZ };
}
// RunRewardCategoryList (1E:7408): category list a's entries unlocked by their flags (RewardCategoryFlagTable_1e;
// a flag id of 0: always)
export function runRewardCategoryList(P, a) {
  let de = romWord(P, ix(RewardCategoryEntryListPtrs_1e, a * 2));
  for (;;) {
    const entry = romByte(P, de);
    if (entry === NO_ENTRY) return { a: entry, de };
    const flag = romWord(P, ix(RewardCategoryFlagTable_1e, entry * 2));
    w8(P, ix(PROGRESS.EntryUnlocked, entry), !flag || testGameFlag(P, flag) ? 1 : 0);
    de = (de + 1) & 0xFFFF;
  }
}
// BuildVisibleProgressEntryList (1E:747C): the unlocked entries' numbers in order, and their count
export function buildVisibleProgressEntryList(P) {
  let b = 0;
  for (let c = 0; c < ENTRIES; c++) if (u8(P, PROGRESS.EntryUnlocked + c)) w8(P, PROGRESS.VisibleEntries + b++, c);
  w8(P, PROGRESS.VisibleCount, b);
  return { a: b, b, c: ENTRIES };
}
// BuildProgressEntryEarnedTable (1E:7499): each of the 37 entries earned or not (TestProgressEntryFlag)
export function buildProgressEntryEarnedTable(P) {
  for (let a = 0; a < EARNED_ENTRIES; a++) w8(P, PROGRESS.EntryEarned + a, testProgressEntryFlag(P, a).a);
  return { a: EARNED_ENTRIES, c: 0, hl: PROGRESS.EntryEarned + EARNED_ENTRIES };
}
// GetProgressEntryEarned (1E:74AA): entry a earned. hl kept.
export const getProgressEntryEarned = (P, a) => ({ a: u8(P, ix(PROGRESS.EntryEarned, a)) });
// DrawProgressListRows (1E:74B6): up to 7 entries' names from the first shown, two map rows apart in the window, the
// glyphs uploaded
export function* drawProgressListRows(P) {
  rom(P, FAR.PrepareGlyphBuffer);
  let de = (P.bus.u16(P.A.shadowTilemapPtr) + LIST_FIRST_ROW) & 0xFFFF;
  let hl = ix(PROGRESS.VisibleEntries, u8(P, PROGRESS.ListIndex));
  for (let c = ROWS; c; c--) {
    const entry = u8(P, hl); hl = (hl + 1) & 0xFFFF;
    if (entry === NO_ENTRY) break;
    const r = rom(P, FAR.RenderProportionalTextAt, { hl: ix(Text_31_160, entry), de, c: ROW_CELLS });
    de = (((r.d << 8) | r.e) + LIST_ROW) & 0xFFFF;
  }
  P.V.glyphRowStartCol = GLYPH_ROW_START;
  return yield* romWait(P, FAR.UploadGlyphBuffer);
}
// LoadGameProgressScreenAssets (1E:74FA): the menu font, the list window's background (FillProgressListRow*)
export function loadGameProgressScreenAssets(P) {
  far(P, BANK_MENU_LIB, () => loadMenuFontTiles(P));
  fillProgressListRowTiles(P);
  return fillProgressListRowAttrs(P);
}
// LoadGameProgressScreenTiles (1E:7504): the header's tiles, map and attributes (palette 1 under its two text boxes),
// the BG palettes 0-1, the icon sprites' tiles and OBJ palettes 1-2
export function loadGameProgressScreenTiles(P) {
  const bank = P.V.wramBank;
  P.wramBank(WRAM_STAGING);
  decompressData(P, GameProgressHeaderGfx_1e, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles2 + VRAM_BANK1, HeaderGfx_BLOCKS);
  decompressData(P, GameProgressHeaderTilemap_1e, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vBGMap0, HeaderTilemap_BLOCKS);
  decompressData(P, GameProgressHeaderAttrmap_1e, wDecompBuffer);
  let hl = wDecompBuffer;
  for (let c = 0; c < 3; c++) for (let half = 0; half < 2; half++) {
    for (let i = 0; i < 4; i++) P.bus.w8(hl + i, 0x09);
    hl = (hl + 4 + 0x0C) & 0xFFFF;
  }
  queueVRAMCopy(P, wDecompBuffer, vBGMap0 + VRAM_BANK1, 3 * 32 / 16);
  loadPaletteShadow(P, GameProgressScreenPalettes0, 0, 2);
  P.wramBank(bank);
  queueVRAMCopy(P, GameProgressScreenTiles0, vTiles0 + VRAM_BANK1, Tiles0_BLOCKS);
  queueVRAMCopy(P, GameProgressScreenTiles2, vTiles0 + 0x10 * TILE_SIZE + VRAM_BANK1, Tiles2_BLOCKS);
  queueVRAMCopy(P, GameProgressScreenTiles1, vTiles0 + 0x20 * TILE_SIZE + VRAM_BANK1, Tiles1_BLOCKS);
  loadPaletteShadow(P, GameProgressScreenPalettes1, 8 + 2, 1);
  return loadPaletteShadow(P, GameProgressScreenPalettes2, 8 + 1, 1);
}

// ---- progress_1e ----
// FillProgressListRowTiles (1E:79E8): the window's background in the shadow map: 9 pairs of rows of tiles
// $2E/$2F over $3E/$3F
export function fillProgressListRowTiles(P) {
  let hl = P.bus.u16(P.A.shadowTilemapPtr);
  for (let e = 0; e < 9; e++) for (const [a, b] of [[0x2E, 0x2F], [0x3E, 0x3F]]) {
    for (let c = 0; c < 10; c++) { w8(P, hl, a); w8(P, hl + 1, b); hl = (hl + 2) & 0xFFFF; }
    hl = (hl + 0x0C) & 0xFFFF;
  }
  return { a: 0x3E, b: 0, c: 0x0C, e: 0, f: FZ | FN, hl };
}
// FillProgressListRowAttrs (1E:7A14): its attributes ($400 on): 18 rows of 20 cells, palette 1 in bank 1
export function fillProgressListRowAttrs(P) {
  let hl = (P.bus.u16(P.A.shadowTilemapPtr) + 0x400) & 0xFFFF;
  for (let e = 0; e < 0x12; e++) {
    for (let c = 0; c < 0x14; c++) { w8(P, hl, 0x09); hl = (hl + 1) & 0xFFFF; }
    hl = (hl + 0x0C) & 0xFFFF;
  }
  return { a: 0x09, bc: 0x0C, de: 0x0400, f: FZ | FN, hl };
}
// UnusedCopyProgressListTilemap (1E:7A30): the list's rows (from $D060) queued; nothing calls it
export const unusedCopyProgressListTilemap = P => queueVRAMCopy(P, 0xD060, vBGMap0 + 3 * 32, 15 * 32 / 16);
// the icon's y beside list row b (scrolled with hScrollY)
const iconY = (P, b) => ((((((b * 2) & 0xFF) + 5) * 8) & 0xFF) - P.bus.u8(hScrollY) + 3) & 0xFF;
// DrawProgressEntryDefaultIcon (1E:7A3C): the star beside row b. Registers kept.
export function drawProgressEntryDefaultIcon(P, b) { queueSprite16(P, OAM_ICON, 0x0C, 0x8C, iconY(P, b)); }
// DrawProgressEntryTrophyIcon (1E:7A68): trophy c beside row b. Registers kept.
export function drawProgressEntryTrophyIcon(P, b, c) { queueSprite16(P, OAM_ICON, (c * 4 + 0x20) & 0xFF, 0x8C, iconY(P, b)); }
const OAM_ICON = 0x08 | 2;
// DrawProgressScreenSprites (1E:7A8D), a frame task: the scroll arrows (bobbing) where the list goes on, and the
// earned entries' icons: the trophy of the class (entries 0-10: their class's), a star for the rest
export function drawProgressScreenSprites(P) {
  w8(P, ARROW_UP, 0); w8(P, ARROW_DOWN, 0);
  const last = (u8(P, PROGRESS.VisibleCount) - ROWS) & 0xFF, index = u8(P, PROGRESS.ListIndex);
  if (index) w8(P, ARROW_UP, index);
  if (index < last) w8(P, ARROW_DOWN, 1);
  const arrow = (y, c, h) => {
    const r = rom(P, FAR.ApplySpriteBobOffsetY, { d: 0x0A, e: y, c });
    far(P, BANK_MENU_LIB, () => queueStackedSpritePair(P, 0x00, 0x20, r.d, r.e, h));
  };
  if (u8(P, ARROW_UP)) arrow(0x18, 0, 2);
  if (u8(P, ARROW_DOWN)) arrow(0x86, 1, 3);
  let hl = ix(PROGRESS.VisibleEntries, u8(P, PROGRESS.ListIndex));
  for (let b = 0; b < ROWS; b++) {
    const entry = u8(P, hl); hl = (hl + 1) & 0xFFFF;
    if (entry === NO_ENTRY || !getProgressEntryEarned(P, entry).a) continue;
    if (entry >= 0x0B) { drawProgressEntryDefaultIcon(P, b); continue; }
    const trophy = entry === 0 ? 0 : ((entry - 1) >> 1);
    if (trophy <= 4) drawProgressEntryTrophyIcon(P, b, trophy);
    else drawProgressEntryDefaultIcon(P, b);
  }
  return { b: ROWS, c: 0, f: FZ | FN };
}
// LoadProgressScreenIconTiles (1E:7B4C): the arrow sprites' tiles at $8200 and their palette (OBJ palette 0)
export function loadProgressScreenIconTiles(P) {
  far(P, BANK_MENU_LIB, () => loadMenuArrowSpriteTiles(P, vTiles0 + 0x20 * TILE_SIZE));
  return far(P, BANK_MENU_LIB, () => loadIndexedPalette(P, 0x08, 0x0F));
}

export const HOOKS = [
  [BANK, 0x7263, hookGen(P => showGameProgressScreen(P))],
  [BANK, 0x727D, hook(P => initGameProgressScreen(P))],
  [BANK, 0x72AF, hookGen(P => buildGameProgressScreen(P))],
  [BANK, 0x737E, hook(P => { updateProgressScreenAnimatedTiles(P); })],
  [BANK, 0x7382, hookGen(function* (P) { yield* scrollProgressListDown(P); })],
  [BANK, 0x73B0, hookGen(function* (P) { yield* scrollProgressListUp(P); })],
  [BANK, 0x73D7, hook(P => ({ a: unusedCreateProgressHeaderWindow(P).a }))],
  [BANK, 0x73E3, hook(P => ({ a: createProgressListWindow(P).a }))],
  [BANK, 0x73EF, hook((P, c) => testProgressEntryFlag(P, c.a))],
  [BANK, 0x7408, hook((P, c) => runRewardCategoryList(P, c.a))],
  [BANK, 0x747C, hook(P => buildVisibleProgressEntryList(P))],
  [BANK, 0x7499, hook(P => buildProgressEntryEarnedTable(P))],
  [BANK, 0x74AA, hook((P, c) => getProgressEntryEarned(P, c.a))],
  [BANK, 0x74B6, hookGen(function* (P) { yield* drawProgressListRows(P); })],
  [BANK, 0x74FA, hook(P => { loadGameProgressScreenAssets(P); })],
  [BANK, 0x7504, hook(P => { loadGameProgressScreenTiles(P); })],
  [BANK, 0x79E8, hook(P => fillProgressListRowTiles(P))],
  [BANK, 0x7A14, hook(P => fillProgressListRowAttrs(P))],
  [BANK, 0x7A30, hook(P => { unusedCopyProgressListTilemap(P); })],
  [BANK, 0x7A3C, hook((P, c) => { drawProgressEntryDefaultIcon(P, c.b); })],
  [BANK, 0x7A68, hook((P, c) => { drawProgressEntryTrophyIcon(P, c.b, c.c); })],
  [BANK, 0x7A8D, hook(P => drawProgressScreenSprites(P))],
  [BANK, 0x7B4C, hook(P => { loadProgressScreenIconTiles(P); })],
];
