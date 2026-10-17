// The tennis dictionary's index and list pages (bank $3f): the letter labels above the list (the selected term's
// letter and the next), the list placed from an index letter and the index letter from the list, the index cursor
// (a 2x2 highlight over the letter row, drawn into the map and queued a row at a time), the index page's and the list
// page's input (screen.js has the screen and the term grid's scans), the glyph tiles and list rows queued.
// Port of src/engine/menus/dictionary/index_3f.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own; the term grid and tables are read from
// the ROM.
// Tests: lockstep on out/port/menus_saved1.mtrec, story_walk2.mtrec and out/port/dc_*.mtrec; web/tests/port/
// routines_menus_misc.mjs.
import {
  FZ, FAR, cpFlags, rom, romWait, wram, u8, w8, idx, ixF, sound, advanceFrame, setFlag, clearFlag, queueCopy, hook,
  hookGen, regs8, WRAM_SCREEN, WRAM_TEXT, WRAM_SCENE, WRAM_SOUND, TILEMAP_WIDTH, TILE_SIZE, vTiles1, vBGMap0,
  wShadowTilemap, wWindowShadowTilemap, PADF_A, PADF_B, PADF_UP, PADF_DOWN, PADF_LEFT, PADF_RIGHT, SFX_MENU_MOVE,
  SFX_MENU_SELECT, SFX_MENU_CANCEL,
} from "../equipment/defs.js";
import {
  STATE_LEAVE, STATE_TO_LIST, STATE_TO_INDEX, DICT_DEFINITION, DICT_ARROW_LEFT, DICT_ARROW_RIGHT,
  getTennisDictionarySelectedIndex, getTennisDictionaryEntryIndex, getTennisDictionaryEntryCategory,
  startTennisDictionaryAnim, endTennisDictionaryAnim, scrollTennisDictionaryToPrevLetter,
  scrollTennisDictionaryToNextLetter, drawTennisDictionaryList,
} from "./screen.js";

export const BANK = 0x3F;
const rb = (P, a) => P.rom.u8(BANK, a & 0xFFFF);
export const SelectionMaskGrid_3f = 0x539E;
const TennisDictionaryRowFirstLetterTable = 0x545F, TennisDictionaryLetterRowTable = 0x54AD;
const TennisDictionaryIndexCursorTable0 = 0x5540, TennisDictionaryIndexCursorTable1 = 0x5564;
const Text_35_143 = 0x148F, TERM_TEXTS = 0x1430, CATEGORY_TEXTS = 0x14A9;     // letter names, definitions
const LETTERS = 0x17, LAST_LETTER = 0x16, LIST_ROWS = 6, INDEX_ROWS = 9, GRID_END = 0x40, LETTER_BREAK = 0x00;
const LABEL_LEFT = wShadowTilemap + 2 * TILEMAP_WIDTH + 16, LABEL_RIGHT = wShadowTilemap + 2 * TILEMAP_WIDTH + 30;
const LABEL_ROW_MARK = 0x06;
const FLAG_TEXT_RENDER_ACTIVE = 0x23, INSTANT_TEXT = 0x80;
const MODE_INDEX = 6;
const ResetTextWindowsAndRestoreMap = [0x05, 0x617A], CreateDialogueWindow = [0x05, 0x4688];
const AddTextIdOffset = [0x05, 0x5D2B], SetWindowTextId = [0x05, 0x55D5], RedrawWindowText = [0x05, 0x61A2];
const RestoreTilemapUnderWindow = [0x05, 0x43A8], RedrawWindowRowsSafe = [0x05, 0x62BC], CloseWindowAlt = [0x05, 0x62D8];

// DrawTennisDictionaryLetterLabels (3F:5334): the selected term's letter (d: the letter breaks before it) gives the
// labels: the previous letter's name at the left (wrapping to the last), the next's at the right (wrapping to the
// first); the label row queued (waiting a frame while the queue is full)
export function* drawTennisDictionaryLetterLabels(P) {
  let b = (getTennisDictionarySelectedIndex(P).a + 1) & 0xFF, hl = SelectionMaskGrid_3f, d = 0;
  const e = P.V.tennisDictCategoryMask;
  for (;;) {
    const a = u8(P, hl);
    hl = (hl + 1) & 0xFFFF;
    if (a === LETTER_BREAK) { d = (d + 1) & 0xFF; continue; }
    if (!(a & e)) continue;
    b = (b - 1) & 0xFF;
    if (!b) break;
  }
  wram(P, WRAM_SCREEN);
  let prev = (d - 1) & 0xFF;
  if (prev === 0xFF) prev = LAST_LETTER;
  const t1 = ixF(Text_35_143, prev);
  const r1 = rom(P, FAR.RenderTextToBuffer64, { a: t1.hl & 0xFF, f: t1.f, b, hl: t1.hl, de: LABEL_LEFT, c: 0x40 });
  let next = (d + 1) & 0xFF;
  if (next === LETTERS) next = 0;
  const t2 = ixF(Text_35_143, next);                                 // (c as the first call left it)
  rom(P, FAR.RenderTextToBuffer64, { ...regs8(r1), a: t2.hl & 0xFF, f: t2.f, hl: t2.hl, de: LABEL_RIGHT });
  w8(P, wShadowTilemap + 2 * TILEMAP_WIDTH, LABEL_ROW_MARK);
  for (;;) {
    const r = queueCopy(P, LABEL_LEFT, vBGMap0 + 1 * TILEMAP_WIDTH + 16, 1);
    if (r.a) return { ...r, f: 0 };
    yield* advanceFrame(P);
  }
}
// SetTennisDictionaryListFromIndexRow (3F:5417): the list placed at the index row's letter: the scroll top counts
// the terms with the mask up to the row's first letter (the scan counts a letter at every byte the mask leaves 0);
// the cursor on the top row
export function setTennisDictionaryListFromIndexRow(P) {
  wram(P, WRAM_SCENE);
  let c = 0, hl = SelectionMaskGrid_3f;
  const e = P.V.tennisDictCategoryMask;
  let b = getTennisDictionaryRowFirstLetter(P, P.V.tennisDictCursorRow).a;
  const clear = top => { P.V.tennisDictCursorRow = 0; P.V.tennisDictScrollTop = top; return { a: top, b, c, e, hl }; };
  if (!b) return { ...clear(0), a: 0, f: FZ };
  for (;;) {
    const m = u8(P, hl) & e;
    hl = (hl + 1) & 0xFFFF;
    if (m) c = (c + 1) & 0xFF;
    if (m === GRID_END) return { ...clear(0), a: 0, f: FZ };
    if (m !== LETTER_BREAK) continue;
    b = (b - 1) & 0xFF;
    if (!b) return { ...clear(c), b, f: FZ };
  }
}
// GetTennisDictionaryRowFirstLetter (3F:5453): a = index row a's first letter (hl kept)
export function getTennisDictionaryRowFirstLetter(P, row) {
  const { hl, f } = ixF(TennisDictionaryRowFirstLetterTable, row);
  return { a: rb(P, hl), f };
}
// SetTennisDictionaryIndexRowFromList (3F:5468): the index row of the selected term's letter (counting a letter at
// every byte the mask leaves 0 before the term)
export function setTennisDictionaryIndexRowFromList(P) {
  wram(P, WRAM_SCENE);
  const { a: index, d } = getTennisDictionarySelectedIndex(P);
  let b = (index + 1) & 0xFF, c = 0, hl = SelectionMaskGrid_3f;
  const e = P.V.tennisDictCategoryMask;
  for (;;) {
    const m = u8(P, hl) & e;
    hl = (hl + 1) & 0xFFFF;
    if (m) {
      b = (b - 1) & 0xFF;
      if (!b) break;
      continue;
    }
    if (m === GRID_END) { P.V.tennisDictCursorRow = 0; return { a: 0, b, c, d, e, hl, f: FZ }; }
    c = (c + 1) & 0xFF;
  }
  const r = getTennisDictionaryLetterRow(P, c);
  P.V.tennisDictCursorRow = r.a;
  return { ...r, b, c, d, e, hl };
}
// GetTennisDictionaryLetterRow (3F:54A1): a = letter a's index row (hl kept)
export function getTennisDictionaryLetterRow(P, letter) {
  const { hl, f } = ixF(TennisDictionaryLetterRowTable, letter);
  return { a: rb(P, hl), f };
}
// DrawTennisDictionaryIndexCursor (3F:54C8): index row b's 2x2 cursor cells (highlighted, a != 0, or plain) into the
// WRAM 3 map (rows 4 apart from (19, 1)), then its two map rows queued (the map's rows are 2 apart there)
export function drawTennisDictionaryIndexCursor(P, highlighted, row) {
  let hl = highlighted ? TennisDictionaryIndexCursorTable0 : TennisDictionaryIndexCursorTable1;
  wram(P, WRAM_SCREEN);
  // (the ROM steps its pointers a row at a time, row + 1 steps from one row back: 256 steps for row $FF)
  const steps = n => n & 0xFF || 0x100;
  let de = (wShadowTilemap + 1 * TILEMAP_WIDTH + 19 - 0x80 + steps(row + 1) * 0x80) & 0xFFFF;
  hl = idx(hl, row * 4);
  w8(P, de, rb(P, hl)); w8(P, de + 1, rb(P, hl + 1));
  de = (de + 1 + 0x3F) & 0xFFFF;
  w8(P, de, rb(P, hl + 2)); w8(P, de + 1, rb(P, hl + 3));
  const n = steps(row * 2 + 1);
  const src = (wShadowTilemap + 1 * TILEMAP_WIDTH + 16 - 0x40 + n * 0x40) & 0xFFFF;
  const dest = (vBGMap0 + 16 - TILEMAP_WIDTH + n * TILEMAP_WIDTH) & 0xFFFF;
  queueCopy(P, src, dest, 1);
  const r = queueCopy(P, (src + 0x40) & 0xFFFF, (dest + TILEMAP_WIDTH) & 0xFFFF, 1);
  wram(P, WRAM_SCENE);
  return { ...r, a: WRAM_SCENE };
}
// HandleTennisDictionaryIndexInput (3F:5588): a frame of the index page (a = the screen's state): A turns to the
// list (4), B leaves (1); up / down move the cursor over the nine rows. Returns the state; bc, f kept.
export function handleTennisDictionaryIndexInput(P, state) {
  wram(P, WRAM_SCENE);
  const edge = P.V.inputRisingEdge;
  if (edge & PADF_A) { sound(P, SFX_MENU_SELECT); return { a: STATE_TO_LIST }; }
  if (edge & PADF_B) { sound(P, SFX_MENU_CANCEL); return { a: STATE_LEAVE }; }
  const input = P.V.inputPressed, row = P.V.tennisDictCursorRow;
  let next = null;
  if (input & PADF_UP) { if (row !== 0) next = row - 1; }
  else if (input & PADF_DOWN) { if (row + 1 !== INDEX_ROWS) next = (row + 1) & 0xFF; }
  if (next === null) return { a: state };
  P.V.tennisDictCursorRow = next;
  drawTennisDictionaryIndexCursor(P, 0, row);
  sound(P, SFX_MENU_MOVE);
  const r = drawTennisDictionaryIndexCursor(P, 1, next);
  return { ...r, a: state, b: undefined, c: undefined, f: undefined };
}
// HandleTennisDictionaryListInput (3F:55FF): a frame of the list page: A shows the selected term's definition (its
// text id by the term's grid index, or with one entry shown by its category) in a dialogue window, instantly, with
// the book opening and closing; B leaves (to the index, $10, in mode 6; else 1); up / down move the cursor over the
// six rows, scrolling at the ends (wrapping); left / right jump a letter back / on (the letter arrow lit).
// Returns the state; bc, f kept.
export function* handleTennisDictionaryListInput(P, state) {
  const { V } = P;
  wram(P, WRAM_SCENE);
  V.tennisDictFlags &= ~(DICT_ARROW_LEFT | DICT_ARROW_RIGHT);
  const edge = V.inputRisingEdge;
  if (edge & PADF_A) {
    sound(P, SFX_MENU_SELECT);
    startTennisDictionaryAnim(P);
    V.tennisDictFlags |= DICT_DEFINITION;
    const b = V.tennisDictCategoryMask;
    let hl;
    if (V.tennisDictSingleEntry === 1) hl = idx(CATEGORY_TEXTS, getTennisDictionaryEntryCategory(P, getTennisDictionarySelectedIndex(P).a, b).a);
    else hl = idx(TERM_TEXTS, getTennisDictionaryEntryIndex(P, getTennisDictionarySelectedIndex(P).a, b).a);
    let r = yield* romWait(P, ResetTextWindowsAndRestoreMap, { a: hl & 0xFF, hl, b });
    V.shadowTilemapBank = WRAM_TEXT;
    r = yield* romWait(P, CreateDialogueWindow, { ...regs8(r), a: WRAM_TEXT, hl, d: 0x00, e: 0x06, b: 0x14, c: 0x05 });
    const window = r.hl;
    r = yield* romWait(P, AddTextIdOffset, { ...regs8(r), a: 0 });
    r = yield* romWait(P, SetWindowTextId, { ...regs8(r), b: 0 });
    const speed = V.messageSpeed;
    V.messageSpeed = INSTANT_TEXT;
    setFlag(P, FLAG_TEXT_RENDER_ACTIVE);
    r = yield* romWait(P, RedrawWindowText, { ...regs8(r), a: 0, hl: window });
    clearFlag(P, FLAG_TEXT_RENDER_ACTIVE);
    V.messageSpeed = speed;
    r = yield* romWait(P, RestoreTilemapUnderWindow, { ...regs8(r), a: 0 });
    r = yield* romWait(P, RedrawWindowRowsSafe, regs8(r));
    yield* romWait(P, CloseWindowAlt, regs8(r));
    wram(P, WRAM_SCENE);
    V.tennisDictFlags &= ~DICT_DEFINITION;
    endTennisDictionaryAnim(P);
    return { a: state };
  }
  if (edge & PADF_B) {
    sound(P, SFX_MENU_CANCEL);
    const mode = V.tennisDictMode;                                  // (the flags of its `cp $06`)
    return { a: mode === MODE_INDEX ? STATE_TO_INDEX : STATE_LEAVE, f: cpFlags(mode, MODE_INDEX) };
  }
  const input = V.inputPressed;
  if (input & PADF_UP) {
    sound(P, SFX_MENU_MOVE);
    const row = (V.tennisDictCursorRow - 1) & 0xFF;
    if (row !== 0xFF) { V.tennisDictCursorRow = row; yield* drawTennisDictionaryLetterLabels(P); return { a: state }; }
    const top = (V.tennisDictScrollTop - 1) & 0xFF;
    V.tennisDictScrollTop = top === 0xFF ? (V.tennisDictEntryCount - 1) & 0xFF : top;
  } else if (input & PADF_DOWN) {
    sound(P, SFX_MENU_MOVE);
    const row = (V.tennisDictCursorRow + 1) & 0xFF;
    if (row < LIST_ROWS) { V.tennisDictCursorRow = row; yield* drawTennisDictionaryLetterLabels(P); return { a: state }; }
    const top = (V.tennisDictScrollTop + 1) & 0xFF;
    V.tennisDictScrollTop = top === V.tennisDictEntryCount ? 0 : top;
  } else if (input & PADF_LEFT) {
    V.tennisDictFlags |= DICT_ARROW_LEFT;
    sound(P, SFX_MENU_MOVE);
    yield* advanceFrame(P);
    scrollTennisDictionaryToPrevLetter(P);
  } else if (input & PADF_RIGHT) {
    V.tennisDictFlags |= DICT_ARROW_RIGHT;
    sound(P, SFX_MENU_MOVE);
    yield* advanceFrame(P);
    scrollTennisDictionaryToNextLetter(P);
  } else return { a: state };
  yield* drawTennisDictionaryList(P);
  return { a: state };
}
// QueueTennisDictionaryGlyphTiles (3F:5749): the list's glyph tiles (WRAM 7's buffer, tiles $36-$7D) queued in
// three parts, a frame between them while the LCD is on
export function* queueTennisDictionaryGlyphTiles(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SOUND);
  const buffer = P.A.glyphTileBuffer;
  let r;
  for (const [tile, last] of [[0x36, false], [0x4E, false], [0x66, true]]) {
    r = queueCopy(P, (buffer + tile * TILE_SIZE) & 0xFFFF, vTiles1 + tile * TILE_SIZE, 24);
    if (!last && P.bus.u8(0xFF40) & 0x80) yield* advanceFrame(P);
  }
  wram(P, bank);
  return { ...r, a: bank, f: entryF };
}
// QueueTennisDictionaryListRows (3F:578F): the list's six rows (WRAM 5's window map, columns 16-31 of rows 5-15,
// every other row) queued, a frame after while the LCD is on
export function* queueTennisDictionaryListRows(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_TEXT);
  let r;
  for (let row = 5; row <= 15; row += 2)
    r = queueCopy(P, wWindowShadowTilemap + row * TILEMAP_WIDTH + 16, vBGMap0 + row * TILEMAP_WIDTH + 16, 1);
  if (P.bus.u8(0xFF40) & 0x80) yield* advanceFrame(P);
  wram(P, bank);
  return { ...r, a: bank, f: entryF };
}

export const HOOKS = [
  [BANK, 0x5334, hookGen(P => drawTennisDictionaryLetterLabels(P))],
  [BANK, 0x5417, hook(P => setTennisDictionaryListFromIndexRow(P))],
  [BANK, 0x5453, hook((P, c) => getTennisDictionaryRowFirstLetter(P, c.a))],
  [BANK, 0x5468, hook(P => setTennisDictionaryIndexRowFromList(P))],
  [BANK, 0x54A1, hook((P, c) => getTennisDictionaryLetterRow(P, c.a))],
  [BANK, 0x54C8, hook((P, c) => drawTennisDictionaryIndexCursor(P, c.a, c.b))],
  [BANK, 0x5588, hook((P, c) => handleTennisDictionaryIndexInput(P, c.a))],
  [BANK, 0x55FF, hookGen((P, c) => handleTennisDictionaryListInput(P, c.a))],
  [BANK, 0x5749, hookGen((P, c) => queueTennisDictionaryGlyphTiles(P, c.f))],
  [BANK, 0x578F, hookGen((P, c) => queueTennisDictionaryListRows(P, c.f))],
];
