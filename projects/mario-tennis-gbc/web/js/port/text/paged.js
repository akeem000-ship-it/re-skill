// Paged text menus (consecutive text ids, a page each) and the unused shared menu loop of the pause-options layer
// (bank $05, src/engine/text/paged_05.asm). Port of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own.
// Covered by out/port/debug1.mtrec, out/engine/rec2.mtrec and web/tests/port/routines_text.mjs.
import {
  WRAM_TEXT, PAD, SFX_MENU_MOVE, SFX_MENU_SELECT, SFX_MENU_CANCEL, mapped, hook, playSound, advanceFrame,
  registerFrameTask, unregisterFrameTask, pushWramBank,
} from "./common.js";
import { getWindowStructPtr } from "./window_alloc.js";
import { createMenuWindowPaged, runMenuSelection, getWindowState, cellToVram, WINDOWSTATE_PAGED_MENU } from "./window_create.js";
import { restoreShadowTilemap } from "./shadow.js";
import { renderMenuWindowText, closeWindow } from "./rows.js";
import { fetchDialogueText } from "./dialogue.js";
import { measureTextDimensions } from "./window_text.js";
import { isCursorOnAdjustRow } from "./cursor.js";
import { getTilemapCellAddress, writeTileToShadowMapCell, writeWindowCellTileAttr } from "./window_tilemap.js";

const Unused_05_PagedMenuFrameTask = 0x49DC, Unused_05_AnimateMenuScrollArrowsTask = 0x4C9D;
const MENU_ROWS_PER_PAGE = 4;

// the choice of a page's RunMenuSelection: a row (page * 4 + row), cancel ($FF), or the page before / after
function nextPage(R, choice, pages) {
  if (choice < 0x7F) return { done: ((R.menuPage * MENU_ROWS_PER_PAGE) + choice) & 0xFF };
  if (choice === 0xFF) return { done: 0xFF };
  if (choice === 0xFE) { const p = (R.menuPage - 1) & 0xFF; R.menuPage = p === 0xFF ? (pages - 1) & 0xFF : p; return { wrapped: p === 0xFF }; }
  const p = (R.menuPage + 1) & 0xFF;
  R.menuPage = p < pages ? p : 0;
  return { forward: true };
}

// RunPagedTextMenu (05:4944): a menu of `pages` pages, page n being text id `baseId` + n, at cell (1, 1); left /
// right turn the page (wrapping). Returns page * 4 + row, or $FF.
export function* runPagedTextMenu(P, baseId, pages) {
  const R = mapped(P), oldBank = pushWramBank(P, WRAM_TEXT);
  R.menuPage = 0;
  let result;
  for (;;) {
    createMenuWindowPaged(P, (baseId + R.menuPage) & 0xFFFF, 1, 1);
    yield* restoreShadowTilemap(P);
    yield* renderMenuWindowText(P);
    const choice = yield* runMenuSelection(P);
    yield* closeWindow(P, R.menuWindowId);
    R.menuWindowId = 0xFF;
    const next = nextPage(R, choice, pages);
    if ("done" in next) { result = next.done; break; }
  }
  R.menuCursorRow = result;
  P.wramBank(oldBank);
  return result;
}

// Unused_05_PagedMenuFrameTask (05:49DC): reads wMenuCursorRow and drops it (docs/bugs.md)
export function pagedMenuFrameTask(P) {
  const oldBank = pushWramBank(P, WRAM_TEXT);
  void mapped(P).menuCursorRow;
  P.wramBank(oldBank);
}

// Unused_05_RunPagedTextMenuAutoSize (05:49F6): RunPagedTextMenu with the column taken from a measured width — but
// it measures the text at whatever hl holds (what RegisterFrameTask left, a stack address, or the window struct),
// fetched with whatever de holds. Pages at row 5. Nothing calls it.
export function* runPagedTextMenuAutoSize(P, baseId, pages) {
  const R = mapped(P), sp0 = P.cpu.sp, oldBank = pushWramBank(P, WRAM_TEXT);
  const stackSlot = (sp0 - 11 + 2) & 0xFFFF;                 // ld hl, sp + 2 under its 4 pushes and add sp, -3
  R.menuPage = 0;
  const reg = registerFrameTask(P, 0x01, Unused_05_PagedMenuFrameTask);
  let hl = reg.hl, de = reg.de, result;
  for (;;) {
    fetchDialogueText(P, hl, de);
    const col = (1 + ((measureTextDimensions(P).b << 24 >> 24) >> 1)) & 0xFF;
    const w = createMenuWindowPaged(P, (baseId + R.menuPage) & 0xFFFF, col, 0x05);
    hl = w.hl; de = col << 8 | 0x05;
    yield* restoreShadowTilemap(P);
    const choice = yield* runMenuSelection(P);
    yield* closeWindow(P, R.menuWindowId);
    R.menuWindowId = 0xFF;
    const next = nextPage(R, choice, pages);
    if ("done" in next) { result = next.done; break; }
    if (next.wrapped || next.forward) hl = stackSlot;
  }
  R.menuCursorRow = result;
  unregisterFrameTask(P, Unused_05_PagedMenuFrameTask);
  P.wramBank(oldBank);
  return result;
}

// the parent menu's arrow cell blanked on leaving (as RunMenuSelection)
function clearParentArrow(P) {
  const R = mapped(P), depth = R.menuDepth;
  if (!depth) return;
  const p = P.A.menuStack + (((depth - 1) * 2) & 0xFF);
  writeWindowCellTileAttr(P, P.bus.u8(p + 1) & 0x0F, 1, (((P.bus.u8(p) & 0x0F) * 2) + 1) & 0xFF, 0x20, 0x80);
}

// Unused_05_RunMenuSelectionShared (05:4AA8): RunMenuSelection for the unreached pause-options layer (bank $1A): the
// cursor starts on wMenuInitialRow; on an "adjust" row (wMenuAdjustRowMask) A does nothing and left / right set
// wPauseMenuOptionBits (1 / 2) and return the row; B / START clear them and return $FF; paged menus page.
// (The labels Unused_05_LoadOverworldSpriteDef and its locals are inside this routine.)
export function* runMenuSelectionShared(P) {
  const R = mapped(P), V = P.V, oldBank = pushWramBank(P, WRAM_TEXT);
  R.textArrowEraseAddr = 0;
  R.textArrowCell = 0xFFFF;
  const s = getWindowStructPtr(R.menuWindowId);
  const origin = { col: (P.bus.u8(s) + 1) & 0xFF, row: (P.bus.u8(s + 1) + 1) & 0xFF };
  R.menuCursorRow = R.menuInitialRow;
  R.menuInitialRow = 0;
  R.textArrowBlinkCounter = 0;
  R.textArrowCell = getTilemapCellAddress(P, origin.col, (R.menuCursorRow * 2 + origin.row) & 0xFF);
  registerFrameTask(P, 0x01, Unused_05_AnimateMenuScrollArrowsTask);
  let cursor = R.menuCursorRow, result;
  const leave = function* (a) {                               // .unregisterFrameTask
    unregisterFrameTask(P, Unused_05_AnimateMenuScrollArrowsTask);
    yield* advanceFrame(P);
    clearParentArrow(P);
    return a;
  };
  for (;;) {
    yield* advanceFrame(P);
    if (V.inputPressed & PAD.A) {
      if (isCursorOnAdjustRow(P).a) continue;
      playSound(P, SFX_MENU_SELECT);
      R.menuCursorRow = cursor;
      unregisterFrameTask(P, Unused_05_AnimateMenuScrollArrowsTask);
      yield* advanceFrame(P);
      writeWindowCellTileAttr(P, R.menuWindowId, 1, (R.menuCursorRow * 2 + 1) & 0xFF, 0x0D, 0x80);
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
    if (moved) {
      playSound(P, SFX_MENU_MOVE);
      R.textArrowBlinkCounter = 0;
      writeTileToShadowMapCell(P, 0x20, origin.col, (cursor * 2 + origin.row) & 0xFF);
      R.textArrowEraseAddr = cellToVram(R.textArrowCell);
      R.textArrowCell = getTilemapCellAddress(P, origin.col, (cursor * 2 + origin.row) & 0xFF);
      R.menuCursorRow = cursor;
    }
    if (V.inputRisingEdge & PAD.START || V.inputPressed & PAD.B) {
      playSound(P, SFX_MENU_CANCEL);
      R.pauseMenuOptionBits &= 0xF0;
      R.menuCursorRow = 0xFF;
      result = yield* leave(0xFF);
      break;
    }
    if (isCursorOnAdjustRow(P).a) {
      const side = V.inputPressed & PAD.LEFT ? 0x01 : V.inputPressed & PAD.RIGHT ? 0x02 : 0;
      if (side) {
        R.pauseMenuOptionBits = (R.pauseMenuOptionBits & 0xF0) | side;
        result = yield* leave(R.menuCursorRow);
        break;
      }
    }
    if (getWindowState(P, 0).a !== WINDOWSTATE_PAGED_MENU) continue;   // (a is 0 here: window 0's state)
    if (!((((R.scrollListLength - 1) & 0xFF) << 24 >> 24 >> 2) & 0xFF)) continue;
    const page = V.inputPressed & PAD.LEFT ? 0xFE : V.inputPressed & PAD.RIGHT ? 0xFD : 0;
    if (!page) continue;
    R.menuCursorRow = page;
    result = yield* leave(page);
    break;
  }
  P.wramBank(oldBank);
  return result;
}

export const HOOKS = [
  hook(5, 0x4944, (P, r) => (function* () { return { a: yield* runPagedTextMenu(P, r.hl, r.a) }; })()),
  hook(5, 0x49DC, P => { pagedMenuFrameTask(P); }),
  hook(5, 0x49F6, (P, r) => (function* () { return { a: yield* runPagedTextMenuAutoSize(P, r.hl, r.a) }; })()),
  hook(5, 0x4AA8, P => (function* () { return { a: yield* runMenuSelectionShared(P) }; })()),
];
