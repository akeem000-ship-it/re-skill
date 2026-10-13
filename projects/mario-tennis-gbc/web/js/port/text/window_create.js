// Window creation, window state, and the menu cursor loop over a text menu window (bank $05,
// src/engine/text/window_create_05.asm). Port of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own.
//
// Menus over windows: CreateMenuWindowFromText sizes a window from its text, pushes a frame on wMenuStack
// ([rowCount << 4 | cursorRow, windowId], wMenuDepth the top) so nested menus get their cursor back.
// RunMenuSelection returns the row picked (< $7F), $FF (B or START), $FE / $FD (page left / right, paged menus).
// Covered by out/port/story1.mtrec (the Yes/No menus), out/port/debug1.mtrec and out/engine/rec2.mtrec; web/tests/port/routines_text.mjs.
import {
  WRAM_TEXT, TILEATTR_PRIORITY, PAD, SFX_MENU_MOVE, SFX_MENU_SELECT, SFX_MENU_CANCEL, vBGMap0, mapped, hook,
  playSound, advanceFrame, registerFrameTask, unregisterFrameTask, queueBGTileWrite, pushWramBank, cpFlags,
  addFlags, Z,
} from "./common.js";
import { createWindowFromScreenRect, allocWindowStruct, getWindowStructPtr } from "./window_alloc.js";
import { fetchDialogueText } from "./dialogue.js";
import { measureTextDimensions } from "./window_text.js";
import { setWindowTextId } from "./window_text.js";
import { writeTileToShadowMapCell, getTilemapCellAddress, writeWindowCellTileAttr } from "./window_tilemap.js";

const AnimateTextArrowTask = 0x48F1;
const ARROW_TILE = 0x0D, BLANK = 0x20;
export const WINDOWSTATE_MENU = 0x02, WINDOWSTATE_PAGED_MENU = 0x03, WINDOWSTATE_HIDDEN = 0xFF;
// a shadow-map cell address as a BG map address in VRAM ($D000 + offset -> $9800 + offset; the ROM adds $3000 + $9800)
export const cellToVram = cell => (cell + 0x3000 + vBGMap0) & 0xFFFF;

// GetScreenTopLeftCell (05:464B): the map cell at the screen's top-left corner, from hScrollX/Y (rounded up)
export function getScreenTopLeftCell(P) {
  return { col: ((P.V.scrollX + 7) & 0xFF) >> 3 & 0x1F, row: ((P.V.scrollY + 7) & 0xFF) >> 3 & 0x1F };
}

// CreateWindowWithAttr (05:4664): CreateWindow with wWindowTileAttr = attr for the duration (then $80 again).
// Returns the window id.
export function createWindowWithAttr(P, attr, col, row, width, height) {
  const R = mapped(P), oldBank = pushWramBank(P, WRAM_TEXT);
  R.windowTileAttr = attr;
  const id = createWindowFromScreenRect(P, col, row, width, height).id;
  R.windowTileAttr = TILEATTR_PRIORITY;
  P.wramBank(oldBank);
  return id;
}

// CreateDialogueWindow (05:4688): a window that becomes the dialogue window; its screen rect is kept in
// wDialogueWindow{Width,Height,Col,Row} (column and row as map cells). Returns the id with its compare flags, and the
// screen's top-left cell, which it leaves in de.
export function createDialogueWindow(P, col, row, width, height) {
  const R = mapped(P);
  R.dialogueWindowWidth = width;
  R.dialogueWindowHeight = height;
  const w = createWindowFromScreenRect(P, col, row, width, height);
  R.dialogueWindowId = w.id;
  const top = getScreenTopLeftCell(P);
  R.dialogueWindowCol = (top.col + col) & 0x1F;
  R.dialogueWindowRow = (top.row + row) & 0x1F;
  return { id: w.id, f: w.f, de: top.col << 8 | top.row };
}

// CreateMenuWindowFromText (05:46B0): a menu window at screen cell (col, row) sized to text id `textId` (fetched
// and measured: one row per line, width rounded up to cells + 3), with the text id and state 2 (menu). It is pushed
// on the menu stack (the current frame keeps wMenuCursorRow) and becomes wMenuWindowId with the cursor on row 0.
// Leaves WRAM bank 5 mapped. Returns the id ($FF when no slot is free) and the flags it leaves.
export function createMenuWindowFromText(P, textId, col, row) {
  const R = mapped(P), { bus } = P;
  P.wramBank(WRAM_TEXT);
  fetchDialogueText(P, textId, (col << 8 | row) & 0xFFFF);
  const top = getScreenTopLeftCell(P);
  const size = measureTextDimensions(P);                        // b: width in pixels + 3, c: lines * 2 + 1
  R.menuRowCount = (((size.c - 1) & 0xFF) << 24 >> 24 >> 1) & 0xFF;
  const width = ((size.b >> 3) + (size.b & 7 ? 1 : 0) + 3) & 0xFF;
  allocWindowStruct(P, (top.col + col) & 0x1F, (top.row + row) & 0x1F, width, size.c);
  const id = R.windowId;
  if (id === 0xFF) return { id, f: cpFlags(0xFF, 0xFF) };
  setWindowTextId(P, id, textId);
  setWindowState(P, id, WINDOWSTATE_MENU);
  const depth = R.menuDepth;
  if (depth !== 0xFF) {                                         // the current menu keeps its cursor row
    const p = P.A.menuStack + ((depth * 2) & 0xFF);
    bus.w8(p, (bus.u8(p) & 0xF0) | R.menuCursorRow);
  }
  R.menuDepth = (depth + 1) & 0xFF;
  const p = P.A.menuStack + ((R.menuDepth * 2) & 0xFF);
  bus.w8(p, (R.menuRowCount << 4) & 0xFF);
  R.menuWindowId = R.windowId;
  bus.w8(p + 1, R.windowId);
  R.menuCursorRow = 0;
  return { id: R.windowId, f: Z };
}

// CreateMenuWindowPaged (05:4747): CreateMenuWindowFromText with state 3 (a paged menu). Leaves hl at the state.
export function createMenuWindowPaged(P, textId, col, row) {
  const w = createMenuWindowFromText(P, textId, col, row);
  const hl = setWindowState(P, mapped(P).windowId, WINDOWSTATE_PAGED_MENU).hl;
  return { ...w, hl };
}

// ResetWindowState (05:4757): window `id` not drawn (state $FF). Leaves hl at the state.
export function resetWindowState(P, id) {
  const hl = getWindowStructPtr(id) + 4;
  P.bus.w8(hl, WINDOWSTATE_HIDDEN);
  return hl;
}
// SetWindowState (05:4767) / GetWindowState (05:4773): byte +4 of the struct. Both leave hl at it, and a (the
// state read, or the pointer's low byte) with its flags.
export function setWindowState(P, id, state) {
  const hl = getWindowStructPtr(id) + 4;
  P.bus.w8(hl, state);
  return { hl, a: hl & 0xFF, f: addFlags(4, (hl - 4) & 0xFF) };
}
export function getWindowState(P, id) {
  const hl = getWindowStructPtr(id) + 4;
  return { hl, a: P.bus.u8(hl), f: addFlags(4, (hl - 4) & 0xFF) };
}

// The cursor of a menu window: the arrow blinks in the cell before the row (AnimateTextArrowTask, a frame task);
// a move blanks the new cell in the shadow map, and the old cell in VRAM at the next blink.
function startMenuArrow(P) {
  const R = mapped(P);
  R.textArrowEraseAddr = 0;
  R.textArrowCell = 0xFFFF;
  const s = getWindowStructPtr(R.menuWindowId);
  const origin = { col: (P.bus.u8(s) + 1) & 0xFF, row: (P.bus.u8(s + 1) + 1) & 0xFF };
  return origin;
}
function placeArrow(P, origin, cursor) {
  const R = mapped(P);
  R.textArrowBlinkCounter = 0;
  R.textArrowCell = getTilemapCellAddress(P, origin.col, (cursor * 2 + origin.row) & 0xFF);
}
function moveArrow(P, origin, cursor) {
  const R = mapped(P);
  playSound(P, SFX_MENU_MOVE);
  R.textArrowBlinkCounter = 0;
  writeTileToShadowMapCell(P, BLANK, origin.col, (cursor * 2 + origin.row) & 0xFF);
  R.textArrowEraseAddr = cellToVram(R.textArrowCell);
  R.textArrowCell = getTilemapCellAddress(P, origin.col, (cursor * 2 + origin.row) & 0xFF);
  R.menuCursorRow = cursor;
}
// the picked row keeps an arrow in the shadow map; on leaving, the parent menu's arrow cell is blanked
function markPickedRow(P) {
  const R = mapped(P);
  writeWindowCellTileAttr(P, R.menuWindowId, 1, (R.menuCursorRow * 2 + 1) & 0xFF, ARROW_TILE, 0x80);
}
function clearParentArrow(P) {
  const R = mapped(P), depth = R.menuDepth;
  if (!depth) return;
  const p = P.A.menuStack + (((depth - 1) * 2) & 0xFF);
  writeWindowCellTileAttr(P, P.bus.u8(p + 1) & 0x0F, 1, (((P.bus.u8(p) & 0x0F) * 2) + 1) & 0xFF, BLANK, 0x80);
}

// RunMenuSelection (05:477F): run the cursor of the menu window (wMenuWindowId) until a choice: A picks the row
// (returned), B / START cancel ($FF); on a paged menu with more than 4 rows, LEFT / RIGHT return $FE / $FD.
// (The page check reads window 0's state, not the menu's: a is 0 there.) Up/down wrap.
export function* runMenuSelection(P) {
  const R = mapped(P), V = P.V, oldBank = pushWramBank(P, WRAM_TEXT);
  const origin = startMenuArrow(P);
  placeArrow(P, origin, R.menuCursorRow);
  registerFrameTask(P, 0x01, AnimateTextArrowTask);
  let cursor = R.menuCursorRow, result;
  for (;;) {
    yield* advanceFrame(P);
    if (V.inputRisingEdge & PAD.A) {
      R.menuCursorRow = cursor;
      playSound(P, SFX_MENU_SELECT);
      unregisterFrameTask(P, AnimateTextArrowTask);
      yield* advanceFrame(P);
      markPickedRow(P);
      result = cursor;
      break;
    }
    let moved = false;
    if (V.inputPressed & PAD.UP) {
      cursor = (cursor - 1) & 0xFF;
      if (cursor & 0x80) cursor = (R.menuRowCount - 1) & 0xFF;
      moved = true;
    } else if (V.inputPressed & PAD.DOWN) {
      cursor = (cursor + 1) & 0xFF;
      if (cursor >= R.menuRowCount) cursor = 0;
      moved = true;
    }
    if (moved) moveArrow(P, origin, cursor);
    if (V.inputRisingEdge & PAD.START) { playSound(P, SFX_MENU_CANCEL); result = 0xFF; }
    else if (V.inputPressed & PAD.B) { playSound(P, SFX_MENU_CANCEL); result = 0xFF; }
    else {
      if (getWindowState(P, 0).a !== WINDOWSTATE_PAGED_MENU) continue;
      if (!((((R.scrollListLength - 1) & 0xFF) >> 2))) continue;
      if (V.inputPressed & PAD.LEFT) result = 0xFE;
      else if (V.inputPressed & PAD.RIGHT) result = 0xFD;
      else continue;
    }
    R.menuCursorRow = result;
    unregisterFrameTask(P, AnimateTextArrowTask);
    yield* advanceFrame(P);
    clearParentArrow(P);
    break;
  }
  P.wramBank(oldBank);
  return result;
}

// AnimateTextArrowTask (05:48F1, a frame task): blink the menu arrow (16 frames on, 16 off) at wTextArrowCell in
// VRAM, and blank the cell the arrow left (wTextArrowEraseAddr, once). Leaves WRAM bank 5 mapped.
export function animateTextArrowTask(P) {
  const R = mapped(P);
  P.wramBank(WRAM_TEXT);
  const tile = R.textArrowBlinkCounter & 0x10 ? BLANK : ARROW_TILE;
  queueBGTileWrite(P, cellToVram(R.textArrowCell), tile);
  R.textArrowBlinkCounter = (R.textArrowBlinkCounter + 1) & 0xFF;
  const erase = R.textArrowEraseAddr;
  if (erase & 0xFF) {
    queueBGTileWrite(P, erase, BLANK);
    P.bus.w8(P.A.textArrowEraseAddr, 0);
  }
}

export const HOOKS = [
  hook(5, 0x4626, () => {}),                                  // Unused_05_StubNop_05_0
  hook(5, 0x464B, P => { const t = getScreenTopLeftCell(P); return { d: t.col, e: t.row }; }),
  hook(5, 0x4664, (P, r) => ({ a: createWindowWithAttr(P, r.a, r.d, r.e, r.b, r.c) })),
  hook(5, 0x4684, (P, r) => { const w = createWindowFromScreenRect(P, r.d, r.e, r.b, r.c); return { a: w.id, f: w.f }; }),
  hook(5, 0x4688, (P, r) => { const w = createDialogueWindow(P, r.d, r.e, r.b, r.c); return { a: w.id, f: w.f, de: w.de }; }),
  hook(5, 0x46B0, (P, r) => { const w = createMenuWindowFromText(P, r.hl, r.d, r.e); return { a: w.id, f: w.f }; }),
  hook(5, 0x4747, (P, r) => { const w = createMenuWindowPaged(P, r.hl, r.d, r.e); return { a: w.id, f: w.f, hl: w.hl }; }),
  hook(5, 0x4757, (P, r) => ({ hl: resetWindowState(P, r.a) })),
  hook(5, 0x4766, () => {}),                                  // Unused_05_StubNop_05_1
  hook(5, 0x4767, (P, r) => setWindowState(P, r.a, r.b)),
  hook(5, 0x4773, (P, r) => getWindowState(P, r.a)),
  hook(5, 0x477F, P => (function* () { return { a: yield* runMenuSelection(P) }; })()),
  hook(5, 0x48F1, P => { animateTextArrowTask(P); }),
];
