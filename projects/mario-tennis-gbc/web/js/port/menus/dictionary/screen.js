// The tennis dictionary (bank $3f): a scrolling list of terms on the right half of a wide scene (the index of letters
// on the other half, reached by scrolling the camera: ShowTennisDictionaryPageDefault / Char6), filtered by a category
// mask (TennisDictionaryScreen's mode 0-4: one category; 5: all, opened on one entry; 6: all, opened on the index),
// a term's definition shown in a dialogue window with a page-turning book sprite (UpdateTennisDictionarySprites).
// The terms are SelectionMaskGrid_3f: one byte a term (its category bits), $00 between letters, $40 at the end.
// The screen's loop keeps its state in a: 2 the index, 8 the list, 4 / $10 turning to the list / index, 1 leave.
// Port of src/engine/menus/dictionary/screen_3f.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own; the term grid, tables, templates, palettes
// and graphics are read from the ROM. (slots_3f.asm is the bank's slot table: data.)
// Tests: lockstep on out/port/menus_saved1.mtrec and story_walk2.mtrec (the dictionary from the story, index and
// list) and out/port/dc_*.mtrec (scripted: each mode, scrolling, letters, a definition); web/tests/port/
// routines_menus_misc.mjs.
import {
  FZ, FN, FAR, HOME, rom, romWait, home, wram, u8, w8, idx, ixF, cpFlags, sound, advanceFrame, waitFrames,
  registerFrameTask, unregisterFrameTask, clearFrameTasks, queueSpriteTemplate, enableLCD, fadeIn, fadeOut,
  disableLCDSafely, testFlag, hook, hookGen, regs8, WRAM_STAGING, WRAM_COURT_PLANES, WRAM_SCREEN, WRAM_SCENE,
  TILE_SIZE, VRAM_BANK1, vTiles0, vTiles1, vTiles2, wDecompBuffer, wShadowTilemap, wScreenAttrmap, OAM_BANK1,
  SFX_MENU_SELECT,
} from "../equipment/defs.js";
import { decompressData, decompressDataFromBank } from "../../home/decompress.js";
import { queueVRAMCopy } from "../../home/memory.js";
import { clearBytes } from "../../home/system.js";
import { loadPalettesMasterOnly, restorePalettesFromMaster } from "../../home/palettes.js";
import {
  SelectionMaskGrid_3f, drawTennisDictionaryLetterLabels, setTennisDictionaryListFromIndexRow,
  setTennisDictionaryIndexRowFromList, drawTennisDictionaryIndexCursor, handleTennisDictionaryIndexInput,
  handleTennisDictionaryListInput, queueTennisDictionaryGlyphTiles, queueTennisDictionaryListRows,
} from "./index_list.js";

export const BANK = 0x3F;
export const UpdateTennisDictionarySprites = 0x4E8D;
const rb = (P, a) => P.rom.u8(BANK, a & 0xFFFF);
const TennisDictionaryClearList2 = 0x4487, CLEAR_RECORDS = 14;
const TennisDictionaryListDataChar6 = 0x44BF, TennisDictionaryListDataDefault = 0x4541, TennisDictionaryListData = 0x459C;
const TennisDictionaryPalettesChar6 = 0x47AE, TennisDictionaryPalettesDefault = 0x47F6, TennisDictionaryPalettes = 0x4E39;
// the tiles: compressed source, VRAM destination (each $20 blocks)
const DICTIONARY_TILES = [[0x483E, vTiles0], [0x495D, vTiles0 + 0x20 * TILE_SIZE], [0x4A9F, vTiles0 + 0x40 * TILE_SIZE],
  [0x4BD5, vTiles0 + VRAM_BANK1], [0x4C89, vTiles0 + 0x20 * TILE_SIZE + VRAM_BANK1], [0x4D8B, vTiles0 + 0x40 * TILE_SIZE + VRAM_BANK1]];
const DICTIONARY_TILE_BLOCKS = 0x20, LIST_TILE_BLOCKS = 0x80, wTextTileBuffer = 0xD800;
const DataPtr_TennisDictionaryTiles = 0x3A00, DataPtr_TennisDictionaryListTiles = 0x3A02;   // (bank $3a, slot)
const TennisDictionarySprites0 = 0x4FF6, SpriteTemplate0 = 0x5006, SpriteTemplate1 = 0x501F;
const TennisDictionarySprites1 = 0x5028, TennisDictionarySprites2 = 0x5078, SpriteTemplate2 = 0x50D0, SpriteTemplate3 = 0x50D9;
const UpdateSceneScroll = [0x0A, 0x5976], CopyScrolledSceneTilemapToVram = [0x0A, 0x5C29], LoadMenuTilesA = [0x01, 0x5062];
const BGM_DICTIONARY = 0x05, FLAG_TEXT_WAITING_FOR_BUTTON = 25, SPRITES_TASK_PRIORITY = 0x1D;
// the modes (TennisDictionaryScreen's a) and their category masks
const MODE_ALL_ONE_ENTRY = 5, MODE_INDEX = 6, ALL_CATEGORIES = 0x1F;
const MODE_MASKS = [0x01, 0x02, 0x04, 0x08, 0x10];
// the loop's states (in a)
export const STATE_LEAVE = 0x01, STATE_INDEX = 0x02, STATE_TO_LIST = 0x04, STATE_LIST = 0x08, STATE_TO_INDEX = 0x10;
// wTennisDictFlags bits: 0 a definition shown, 1 the list page shown, 2 / 3 the left / right letter arrows
export const DICT_DEFINITION = 0x01, DICT_LIST_PAGE = 0x02, DICT_ARROW_LEFT = 0x04, DICT_ARROW_RIGHT = 0x08;
// the camera's column (wCameraX + 1 / hScrollX) of the list and index pages
const CAMERA_LIST = 0x0D, CAMERA_INDEX = 0x21;
// the book sprite's animation (wTennisDictAnimState / Timer)
const ANIM_IDLE = 0x03, ANIM_CLOSING = 0x04, ANIM_START_TIMER = 0xB4, ANIM_CLOSE_TIMER = 0xFF;
const SPRITE_PHASE_FRAMES = 8, SPRITE_PHASES = 0x10;
const LETTERS_ROW_A = wShadowTilemap + 2 * 32 + 18, LETTERS_ROW_B = wShadowTilemap + 4 * 32 + 18, LETTER_TILES = 11;

// TennisDictionaryScreen (3F:407A), slot $4000: the dictionary in mode a (see the header); ends when the loop's
// state becomes 1 (B on the index or a filtered list)
export function* tennisDictionaryScreen(P, mode) {
  const { V } = P;
  wram(P, WRAM_SCENE);
  V.tennisDictMode = mode;
  if (mode === MODE_ALL_ONE_ENTRY) V.tennisDictSingleEntry = 1;
  V.tennisDictCategoryMask = mode < MODE_MASKS.length ? MODE_MASKS[mode] : ALL_CATEGORIES;
  V.tennisDictSpritePhase = 0;
  V.tennisDictFlags = 0;
  V.tennisDictScrollTop = 0;
  V.tennisDictCursorRow = 0;
  V.tennisDictScrollTimer = 0;
  V.tennisDictSpriteTimer = SPRITE_PHASE_FRAMES;
  V.tennisDictAnimState = 0;
  V.tennisDictAnimTimer = ANIM_START_TIMER;
  yield* loadTennisDictionaryScreen(P);
  wram(P, WRAM_SCENE);
  V.tennisDictSingleEntry = 0;
  if (V.tennisDictMode !== MODE_INDEX) {
    yield* advanceFrame(P);
    yield* drawTennisDictionaryList(P);
    if (V.tennisDictMode === MODE_ALL_ONE_ENTRY) V.tennisDictSingleEntry = 1;
  }
  disableLCDSafely(P);
  rom(P, LoadMenuTilesA);
  enableLCD(P);
  sound(P, BGM_DICTIONARY);
  yield* advanceFrame(P);
  yield* fadeIn(P, 16);
  registerFrameTask(P, SPRITES_TASK_PRIORITY, UpdateTennisDictionarySprites);
  wram(P, WRAM_SCENE);
  let state;
  if (V.tennisDictMode === MODE_INDEX) {
    wram(P, WRAM_SCENE);
    V.tennisDictFlags &= ~DICT_DEFINITION;
    endTennisDictionaryAnim(P);
    yield* waitFrames(P, 1);
    state = STATE_INDEX;
  } else {
    V.tennisDictFlags |= DICT_LIST_PAGE;
    state = STATE_LIST;
  }
  do {
    yield* advanceFrame(P);
    let r;
    if (state === STATE_TO_LIST) r = yield* showTennisDictionaryPageDefault(P);
    else if (state === STATE_TO_INDEX) r = yield* showTennisDictionaryPageChar6(P);
    else if (state === STATE_LIST) r = yield* handleTennisDictionaryListInput(P, state);
    else r = handleTennisDictionaryIndexInput(P, state);
    state = r.a;
    restorePalettesFromMaster(P);
  } while (state !== STATE_LEAVE);
  yield* fadeOut(P, 16);
  resetTennisDictionaryScroll(P);
  return unregisterFrameTask(P, UpdateTennisDictionarySprites);           // (its a = 1: the state left)
}
// the page turn: fade out, the camera on the other page, its cursor and assets, its map, fade in
// ShowTennisDictionaryPageDefault (3F:4194): to the list page (the list from the index's letter); returns state 8
export function* showTennisDictionaryPageDefault(P) {
  yield* fadeOut(P, 16);
  P.V.cameraX = CAMERA_LIST << 8;
  wram(P, WRAM_SCENE);
  drawTennisDictionaryIndexCursor(P, 0, P.V.tennisDictCursorRow);
  rom(P, UpdateSceneScroll);
  yield* advanceFrame(P);
  disableLCDSafely(P);
  loadTennisDictionaryAssetsDefault(P);
  rom(P, CopyScrolledSceneTilemapToVram, { a: 1 });
  enableLCD(P);
  setTennisDictionaryListFromIndexRow(P);
  yield* drawTennisDictionaryList(P);
  P.V.tennisDictFlags |= DICT_LIST_PAGE;
  yield* fadeIn(P, 16);
  return { a: STATE_LIST };
}
// ShowTennisDictionaryPageChar6 (3F:41E0): to the index page (its letter from the list's term); returns state 2
export function* showTennisDictionaryPageChar6(P) {
  yield* fadeOut(P, 16);
  P.V.cameraX = CAMERA_INDEX << 8;
  setTennisDictionaryIndexRowFromList(P);
  drawTennisDictionaryIndexCursor(P, 1, P.V.tennisDictCursorRow);
  rom(P, UpdateSceneScroll);
  yield* advanceFrame(P);
  disableLCDSafely(P);
  loadTennisDictionaryAssetsChar6(P);
  rom(P, CopyScrolledSceneTilemapToVram, { a: 1 });
  enableLCD(P);
  wram(P, WRAM_SCENE);
  P.V.tennisDictFlags &= ~DICT_LIST_PAGE;
  yield* fadeIn(P, 16);
  return { a: STATE_INDEX };
}
// ResetTennisDictionaryScroll (3F:4244): the scroll, the camera and the pending map blits back to 0
export function resetTennisDictionaryScroll(P) {
  const { V } = P;
  wram(P, WRAM_SCENE);
  V.scrollX = 0;
  V.cameraX = 0;
  V.scrollY = 0;
  V.cameraY = 0;
  V.bGColumnBlitPending = 0;
  V.bGRowBlitPending = 0;
  return { a: 0, hl: (P.A.cameraY + 2) & 0xFFFF, f: FZ };
}
// a page's assets: its list tiles (bank $3a) and the text tiles to VRAM bank 1, its BG palettes (into the master
// copy: the fade brings them up), its list map into WRAM 2
function loadPageAssets(P, slot, palettes, listData) {
  wram(P, WRAM_STAGING);
  decompressDataFromBank(P, slot >> 8, slot & 0xFF, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles2 + VRAM_BANK1, LIST_TILE_BLOCKS);
  queueVRAMCopy(P, wTextTileBuffer, vTiles1 + VRAM_BANK1, LIST_TILE_BLOCKS);
  loadPalettesMasterOnly(P, palettes, 0, 8);
  wram(P, WRAM_COURT_PLANES);
  decompressData(P, listData, wScreenAttrmap);
}
// LoadTennisDictionaryAssetsDefault (3F:425F): the list page's (its list map's cells then cleared)
export function loadTennisDictionaryAssetsDefault(P) {
  loadPageAssets(P, DataPtr_TennisDictionaryListTiles, TennisDictionaryPalettesDefault, TennisDictionaryListDataDefault);
  return clearTennisDictionaryTilemap(P);
}
// LoadTennisDictionaryAssetsChar6 (3F:42A0): the index page's
export function loadTennisDictionaryAssetsChar6(P) {
  loadPageAssets(P, DataPtr_TennisDictionaryTiles, TennisDictionaryPalettesChar6, TennisDictionaryListDataChar6);
}
// the clear list's 14 records (address, count): each passed to fn
function forClearRecords(P, fn) {
  let hl = TennisDictionaryClearList2;
  for (let i = 0; i < CLEAR_RECORDS; i++, hl += 4) fn(P.rom.u16(BANK, hl), P.rom.u16(BANK, hl + 2));
  return hl;
}
// ClearTennisDictionaryTilemap (3F:42DE): the list cells of the WRAM 2 map zeroed (TennisDictionaryClearList2)
export function clearTennisDictionaryTilemap(P) {
  wram(P, WRAM_COURT_PLANES);
  const hl = forClearRecords(P, (at, count) => clearBytes(P, at, count));
  return { a: 0, bc: 0, c: 0, hl, f: FZ };
}
// LoadTennisDictionaryScreen (3F:42FE): the camera on the mode's page, the terms counted, the graphics and palettes,
// the page's assets, the scene map (its list cells blank, the mode's title tiles in rows 2 and 4), the map scrolled
// into VRAM
export function* loadTennisDictionaryScreen(P) {
  const { V } = P;
  wram(P, WRAM_SCENE);
  const column = V.tennisDictMode === MODE_INDEX ? CAMERA_INDEX : CAMERA_LIST;
  V.scrollX = column;
  V.cameraX = column << 8;
  V.scrollY = 0;
  V.cameraY = 0;
  V.bGColumnBlitPending = 0;
  V.bGRowBlitPending = 0;
  disableLCDSafely(P);
  clearFrameTasks(P);
  countTennisDictionaryEntries(P);
  findTennisDictionaryListEnd(P);
  wram(P, WRAM_STAGING);
  for (const [src, dest] of DICTIONARY_TILES) {
    decompressData(P, src, wDecompBuffer);
    queueVRAMCopy(P, wDecompBuffer, dest, DICTIONARY_TILE_BLOCKS);
  }
  loadPalettesMasterOnly(P, TennisDictionaryPalettes, 8, 8);
  wram(P, WRAM_SCENE);
  if (V.tennisDictMode === MODE_INDEX) loadTennisDictionaryAssetsChar6(P);
  else loadTennisDictionaryAssetsDefault(P);
  wram(P, WRAM_SCREEN);
  decompressData(P, TennisDictionaryListData, wShadowTilemap);
  wram(P, WRAM_SCREEN);
  forClearRecords(P, (at, count) => fillBytes(P, 0x20, at, count & 0xFF));
  wram(P, WRAM_SCENE);
  const mode = V.tennisDictMode;
  wram(P, WRAM_SCREEN);
  let tile = ((mode + 1) * 0x20) & 0xFF;                          // the mode's title: two rows of 11 tiles
  for (let i = 0; i < LETTER_TILES; i++, tile = (tile + 1) & 0xFF) w8(P, LETTERS_ROW_A + i, tile);
  tile = (tile + 5) & 0xFF;
  for (let i = 0; i < LETTER_TILES; i++, tile = (tile + 1) & 0xFF) w8(P, LETTERS_ROW_B + i, tile);
  wram(P, WRAM_SCENE);
  enableLCD(P);
  wram(P, WRAM_SCENE);
  rom(P, UpdateSceneScroll);
  disableLCDSafely(P);
  wram(P, WRAM_SCREEN);
  rom(P, CopyScrolledSceneTilemapToVram, { a: 1 });
  return enableLCD(P);
}
// EndTennisDictionaryAnim (3F:4E69): the book sprite closing (unless idle or closing already)
export function endTennisDictionaryAnim(P) {
  const st = P.V.tennisDictAnimState;
  if (st >= ANIM_IDLE) return { a: st, f: cpFlags(st, ANIM_IDLE) };
  P.V.tennisDictAnimState = ANIM_CLOSING;
  P.V.tennisDictAnimTimer = ANIM_CLOSE_TIMER;
  return { a: ANIM_CLOSE_TIMER, f: cpFlags(st, ANIM_IDLE) };
}
// StartTennisDictionaryAnim (3F:4E7B): the book sprite opening, in one of its three looks (by the frame counter)
export function startTennisDictionaryAnim(P) {
  P.V.tennisDictAnimTimer = ANIM_START_TIMER;
  let a = P.V.vBlankCounter & 0x03, f = cpFlags(a, 3);
  if (a === 3) { a = 0; f = FZ; }
  P.V.tennisDictAnimState = a;
  return { a, f };
}
// UpdateTennisDictionarySprites (3F:4E8D), a frame task: the book's animation stepped (a text waiting for a button
// opens it); on the index page (mode 6) the book's four sprites by its phase; on the list page the cursor's arrow
// (bobbing by wTennisDictScrollTimer) and the letter arrows shown. Registers kept, the WRAM bank put back.
export function updateTennisDictionarySprites(P, entryF = P.cpu.f) {
  const { V } = P, bank = V.wramBank;
  wram(P, WRAM_SCENE);
  if (testFlag(P, FLAG_TEXT_WAITING_FOR_BUTTON)) { sound(P, SFX_MENU_SELECT); startTennisDictionaryAnim(P); }
  const st = V.tennisDictAnimState;
  if (st === ANIM_CLOSING) {
    V.tennisDictAnimTimer = (V.tennisDictAnimTimer - 1) & 0xFF;
    if (!V.tennisDictAnimTimer) V.tennisDictAnimState = ANIM_IDLE;
  } else if (st !== ANIM_IDLE) {
    V.tennisDictAnimTimer = (V.tennisDictAnimTimer - 1) & 0xFF;
    if (!V.tennisDictAnimTimer) { V.tennisDictAnimState = ANIM_CLOSING; V.tennisDictAnimTimer = ANIM_CLOSE_TIMER; }
  }
  const listPage = () => V.tennisDictFlags & DICT_LIST_PAGE;
  if (V.tennisDictMode === MODE_INDEX) {
    V.tennisDictSpriteTimer = (V.tennisDictSpriteTimer - 1) & 0xFF;
    if (!V.tennisDictSpriteTimer) {
      V.tennisDictSpriteTimer = SPRITE_PHASE_FRAMES;
      const phase = (V.tennisDictSpritePhase + 1) & 0xFF;
      V.tennisDictSpritePhase = phase === SPRITE_PHASES ? 0 : phase;
    }
    const frame = rb(P, idx(idx(TennisDictionarySprites1, V.tennisDictAnimState * 16), V.tennisDictSpritePhase));
    let hl = idx(TennisDictionarySprites2, frame * 8);
    // the book's four pieces: (tile, attribute) pairs, at their places (shifted right on the list page)
    const PIECES = [[SpriteTemplate2, 0x907D, 0x807D], [SpriteTemplate3, 0x886D, 0x786D], [SpriteTemplate3, 0x887D, 0x787D],
      [SpriteTemplate3, 0x888D, 0x788D]];
    for (const [template, right, left] of PIECES) {
      const c = rb(P, hl), b = rb(P, hl + 1);
      hl = (hl + 2) & 0xFFFF;
      const de = listPage() ? right : left;
      queueSpriteTemplate(P, template, de >> 8, de & 0xFF, c, b);
    }
  }
  if (listPage()) {
    if (!(V.tennisDictFlags & DICT_DEFINITION)) V.tennisDictScrollTimer = (V.tennisDictScrollTimer + 1) & 0xFF;
    const y = ((V.tennisDictCursorRow + 1) * 0x10 + 0x28) & 0xFF;
    const x = (rb(P, idx(TennisDictionarySprites0, V.tennisDictScrollTimer & 0x0F)) + 0x0A) & 0xFF;
    queueSpriteTemplate(P, SpriteTemplate1, x, y, 0x28, OAM_BANK1 | 3);
    if (V.tennisDictFlags & DICT_ARROW_LEFT) queueSpriteTemplate(P, SpriteTemplate0, 0x18, 0x10, 0x34, OAM_BANK1 | 5);
    if (V.tennisDictFlags & DICT_ARROW_RIGHT) queueSpriteTemplate(P, SpriteTemplate0, 0x88, 0x10, 0x3A, OAM_BANK1 | 5);
  }
  wram(P, bank);
  return { a: bank, f: entryF };
}
// FillBytes_3f (3F:50EA): c bytes of a at hl (c = 0: 256). Registers kept.
export function fillBytes(P, a, hl, count) {
  for (let n = count || 0x100; n > 0; n--, hl = (hl + 1) & 0xFFFF) w8(P, hl, a);
}

// ---- the term grid ----
const grid = (P, hl) => u8(P, hl);                                // (SelectionMaskGrid_3f, bank $3f mapped)
const GRID_END = 0x40, LETTER_BREAK = 0x00;
// CountTennisDictionaryEntries (3F:50F7): wTennisDictEntryCount = the terms in the mask's categories
export function countTennisDictionaryEntries(P) {
  wram(P, WRAM_SCENE);
  let hl = SelectionMaskGrid_3f, c = 0;
  const d = P.V.tennisDictCategoryMask;
  for (;;) {
    const a = grid(P, hl);
    hl = (hl + 1) & 0xFFFF;
    if (a === LETTER_BREAK) continue;
    if (a === GRID_END) break;
    if (a & d) c = (c + 1) & 0xFF;
  }
  P.V.tennisDictEntryCount = c;
  return { a: c, c, d, hl, f: FZ | FN };
}
// FindTennisDictionaryListEnd (3F:511A): wTennisDictListEnd = the grid's end mark (high byte first)
export function findTennisDictionaryListEnd(P) {
  wram(P, WRAM_SCENE);
  let hl = SelectionMaskGrid_3f;
  while (grid(P, hl) !== GRID_END) hl = (hl + 1) & 0xFFFF;
  w8(P, P.A.tennisDictListEnd, hl >> 8);
  w8(P, P.A.tennisDictListEnd + 1, hl & 0xFF);
  return { a: hl & 0xFF, c: 0, hl, f: FZ | FN };
}
// the n-th (0-based) term in categories b: its grid address after it, and how many terms (of any category) up to it
function findTerm(P, n, b) {
  let hl = SelectionMaskGrid_3f, d = 0, c = (n + 1) & 0xFF, a;
  for (;;) {
    a = grid(P, hl);
    hl = (hl + 1) & 0xFFFF;
    if (a === LETTER_BREAK) continue;
    d = (d + 1) & 0xFF;
    if (!(a & b)) continue;
    c = (c - 1) & 0xFF;
    if (!c) return { hl, d, a: a & b };
  }
}
// GetTennisDictionaryEntryIndex (3F:5134): a = the grid index (among all terms) of term a of categories b
export function getTennisDictionaryEntryIndex(P, n, b) {
  const t = findTerm(P, n, b), d = (t.d - 1) & 0xFF;
  return { a: d, c: 0, d, hl: t.hl, f: (d === 0 ? FZ : 0) | FN | ((t.d & 0xF) === 0 ? 0x20 : 0) };
}
// GetTennisDictionaryEntryCategory (3F:514A): a = the category (0-3, else 4) of term a of categories b
export function getTennisDictionaryEntryCategory(P, n, b) {
  const t = findTerm(P, n, b), cat = t.a, out = { c: 0, d: t.d, hl: t.hl };
  const CATEGORIES = { 0x01: 0, 0x02: 1, 0x04: 2, 0x08: 3 };
  if (cat === 0x01) return { ...out, a: 0, f: FZ };
  if (cat in CATEGORIES) return { ...out, a: CATEGORIES[cat], f: FZ | FN };
  return { ...out, a: 4, f: cpFlags(cat, 0x08) };
}
// GetTennisDictionarySelectedIndex (3F:517B): a = the term under the cursor (scroll top + cursor row, wrapping)
export function getTennisDictionarySelectedIndex(P) {
  wram(P, WRAM_SCENE);
  const d = P.V.tennisDictEntryCount, c = P.V.tennisDictCursorRow, sum = (P.V.tennisDictScrollTop + c) & 0xFF;
  if (sum < d) return { a: sum, c, d, f: cpFlags(sum, d) };
  return { a: (sum - d) & 0xFF, c, d, f: (sum === d ? FZ : 0) | FN | ((sum & 0xF) < (d & 0xF) ? 0x20 : 0) };
}
// WrapTennisDictionaryScanToEnd (3F:51AB): a backwards scan wrapped to the grid's last term (hl = before the end
// mark, c = the last term's number); af kept
export function wrapTennisDictionaryScanToEnd(P) {
  const end = (u8(P, P.A.tennisDictListEnd) << 8 | u8(P, P.A.tennisDictListEnd + 1)) - 1;
  return { c: (P.V.tennisDictEntryCount - 1) & 0xFF, hl: end & 0xFFFF };
}
// ScrollTennisDictionaryToPrevLetter (3F:5192): the list scrolled to the first term of the previous letter (with
// terms of the mask; wrapping from the first letter to the last), the cursor on the top row. c counts the terms
// back from the selected one; the scan runs backwards (wrapping at the start mark) to the previous letter's start.
export function scrollTennisDictionaryToPrevLetter(P) {
  wram(P, WRAM_SCENE);
  const sel = getTennisDictionarySelectedIndex(P).a;
  let hl = SelectionMaskGrid_3f, c = sel, b = (sel + 1) & 0xFF, a, d;
  P.V.tennisDictCursorRow = 0;
  const e = P.V.tennisDictCategoryMask;
  const read = () => { const v = u8(P, hl); return v; };
  const wrap = () => { const w = wrapTennisDictionaryScanToEnd(P); c = w.c; hl = w.hl; };
  do { do { a = read(); hl = (hl + 1) & 0xFFFF; } while (!(a & e)); b = (b - 1) & 0xFF; } while (b);   // to the term
  hl = (hl - 1) & 0xFFFF;
  // back to the start of the term's letter
  for (;;) {
    d = read(); hl = (hl - 1) & 0xFFFF;
    if (d & e) c = (c - 1) & 0xFF;
    if (d === GRID_END) { wrap(); break; }
    if (d === LETTER_BREAK) break;
  }
  // back over the break(s) to the previous letter's last term
  for (;;) {
    a = read(); hl = (hl - 1) & 0xFFFF;
    if (a === GRID_END) wrap();
    if (a & e) break;
  }
  c = (c - 1) & 0xFF;
  // back to that letter's start
  for (;;) {
    d = read(); hl = (hl - 1) & 0xFFFF;
    if (d & e) c = (c - 1) & 0xFF;
    if (d === GRID_END) { wrap(); hl = (hl + 1) & 0xFFFF; break; }
    if (d === LETTER_BREAK) { hl = (hl + 1) & 0xFFFF; c = (c + 1) & 0xFF; break; }
  }
  // forward to its first term with the mask (wrapping at the end mark)
  for (;;) {
    a = read(); hl = (hl + 1) & 0xFFFF;
    if (a === GRID_END) { c = 0; hl = SelectionMaskGrid_3f; continue; }
    if (a & e) break;
  }
  P.V.tennisDictScrollTop = c;
  return { a: c, b: 0, c, d, e, hl, f: 0x20 };                    // (the flags of its last `and e`)
}
// ScrollTennisDictionaryToNextLetter (3F:520F): the list scrolled to the first term of the next letter (wrapping),
// the cursor on the top row
export function scrollTennisDictionaryToNextLetter(P) {
  wram(P, WRAM_SCENE);
  const { V } = P, count = V.tennisDictEntryCount;
  let sum = (V.tennisDictScrollTop + V.tennisDictCursorRow) & 0xFF;
  if (sum >= count) sum = (sum - count) & 0xFF;
  let hl = SelectionMaskGrid_3f, b = (sum + 1) & 0xFF, d = sum, a, c = V.tennisDictCursorRow;
  V.tennisDictCursorRow = 0;
  const e = V.tennisDictCategoryMask;
  do { do { a = u8(P, hl); hl = (hl + 1) & 0xFFFF; } while (!(a & e)); b = (b - 1) & 0xFF; } while (b);   // to the term
  // on to the letter's end, counting the terms with the mask; at the grid's end, from the start
  for (;;) {
    a = u8(P, hl); hl = (hl + 1) & 0xFFFF;
    if (a === LETTER_BREAK) break;
    c = a;
    if (a & e) d = (d + 1) & 0xFF;
    if (a === GRID_END) { hl = SelectionMaskGrid_3f; d = 0xFF; break; }
  }
  d = (d + 1) & 0xFF;
  // to the next term with the mask (wrapping at the end mark)
  for (;;) {
    a = u8(P, hl); hl = (hl + 1) & 0xFFFF;
    if (a === GRID_END) { hl = SelectionMaskGrid_3f; d = 0; }
    if (a & e) break;
  }
  V.tennisDictScrollTop = d;
  return { a: d, b: 0, c, d, e, hl, f: 0x20 };
}

// ---- the list ----
// DrawTennisDictionaryList (3F:5261): the list's six rows from the scroll top (wrapping), each term's name (its text
// id $10F0 + grid index) rendered into the WRAM 3 map; the letter labels, glyph tiles and rows queued
export function* drawTennisDictionaryList(P) {
  rom(P, FAR.PrepareGlyphBuffer);
  wram(P, WRAM_SCREEN);
  forClearRecords(P, (at, count) => fillBytes(P, 0x20, at, count & 0xFF));
  wram(P, WRAM_SCENE);
  const e = P.V.tennisDictCategoryMask;
  let hl = SelectionMaskGrid_3f, c = 0, b = (P.V.tennisDictScrollTop + 1) & 0xFF, a;
  // the scroll top's term: c = its grid index
  for (;;) {
    c = (c + 1) & 0xFF;
    do { a = u8(P, hl); hl = (hl + 1) & 0xFFFF; } while (a === LETTER_BREAK);
    if (!(a & e)) continue;
    b = (b - 1) & 0xFF;
    if (!b) break;
  }
  c = (c - 1) & 0xFF;
  hl = (hl - 1) & 0xFFFF;
  wram(P, WRAM_SCREEN);
  // the glyph pen for the list's text
  P.bus.w16(P.A.glyphPenX, 0x1B00);
  P.V.textRowWidth = 0x0C;
  for (let i = 0; i < 3; i++) w8(P, P.A.textRowColumn + i, 0x36);
  for (b = 0; b !== 6; ) {
    c = (c + 1) & 0xFF;
    do { a = u8(P, hl); hl = (hl + 1) & 0xFFFF; } while (a === LETTER_BREAK);
    if (a === GRID_END) { hl = SelectionMaskGrid_3f; c = 0; continue; }
    if (!(a & e)) continue;
    const text = idx(0x10F0, (c - 1) & 0xFF);
    b++;
    const de = (wShadowTilemap + 6 * 32 + 16 + b * 0x80) & 0xFFFF;
    const bank = P.V.shadowTilemapBank;
    P.V.shadowTilemapBank = WRAM_SCREEN;
    const r = yield* romWait(P, FAR.RenderProportionalTextAt, { a: c, hl: text, de, c: 0x0C, b });
    c = r.a;                                                         // (`ld c, a`: the a it leaves)
    P.V.shadowTilemapBank = bank;
  }
  yield* romWait(P, FAR.RestoreShadowTilemap);
  yield* drawTennisDictionaryLetterLabels(P);
  yield* queueTennisDictionaryGlyphTiles(P);
  const r = yield* queueTennisDictionaryListRows(P);
  wram(P, WRAM_SCENE);
  return { ...r, a: WRAM_SCENE };
}

export const HOOKS = [
  [BANK, 0x407A, hookGen((P, c) => tennisDictionaryScreen(P, c.a))],
  [BANK, 0x4194, hookGen(P => showTennisDictionaryPageDefault(P))],
  [BANK, 0x41E0, hookGen(P => showTennisDictionaryPageChar6(P))],
  [BANK, 0x4244, hook(P => resetTennisDictionaryScroll(P))],
  [BANK, 0x425F, hook(P => loadTennisDictionaryAssetsDefault(P))],
  [BANK, 0x42A0, hook(P => loadTennisDictionaryAssetsChar6(P))],
  [BANK, 0x42DE, hook(P => clearTennisDictionaryTilemap(P))],
  [BANK, 0x42FE, hookGen(P => loadTennisDictionaryScreen(P))],
  [BANK, 0x4E69, hook(P => endTennisDictionaryAnim(P))],
  [BANK, 0x4E7B, hook(P => startTennisDictionaryAnim(P))],
  [BANK, 0x4E8D, hook((P, c) => updateTennisDictionarySprites(P, c.f))],
  [BANK, 0x50EA, hook((P, c) => { fillBytes(P, c.a, c.hl, c.c); })],
  [BANK, 0x50F7, hook(P => countTennisDictionaryEntries(P))],
  [BANK, 0x511A, hook(P => findTennisDictionaryListEnd(P))],
  [BANK, 0x5134, hook((P, c) => getTennisDictionaryEntryIndex(P, c.a, c.b))],
  [BANK, 0x514A, hook((P, c) => getTennisDictionaryEntryCategory(P, c.a, c.b))],
  [BANK, 0x517B, hook(P => getTennisDictionarySelectedIndex(P))],
  [BANK, 0x5192, hook(P => scrollTennisDictionaryToPrevLetter(P))],
  [BANK, 0x51AB, hook(P => wrapTennisDictionaryScanToEnd(P))],
  [BANK, 0x520F, hook(P => scrollTennisDictionaryToNextLetter(P))],
  [BANK, 0x5261, hookGen(P => drawTennisDictionaryList(P))],
];
