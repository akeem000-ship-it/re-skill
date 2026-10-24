// Two menus of the N64-data side of the main menu (bank $3B):
//   - the N64 record type (RunN64RecordTypeSelect): a row of three panels (exhibition, tournament, ring shot
//     records), wSubMenuCursor; A slides out forward and returns the cell, B back with $FF;
//   - the N64 transfer item (RunN64TransferItemSelect): a 2 x 2 grid of what to bring over from the N64 game, drawn
//     with the court-select menu's four-tab panel (OpenCourtSelect4Panel / CloseCourtSelect4Panel /
//     SetCourtSelect4TabAttrRect, bank $3E), wN64TransferMenuCursor.
// Both: load (frames of labels and panel tiles), slide in, choose with MoveMenuCursorGrid, the chosen cell's frame
// (a frame task) and caption.
// Port of src/engine/menus/main_menu/n64transfer_3b.asm (RunN64RecordTypeSelect ..
// N64TransferItemCursorSpriteTask) of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm).
// Tables are read from the ROM.
// Tests: the menu recordings (out/port/menus_n64*.mtrec) in the lockstep; web/tests/port/routines_menus_main.mjs.
import { registerFrameTask } from "../../home/colorfade.js";
import {
  hook, hookGen, callGen, callHome, waitFarCall, callFar, advanceFrame, sound, withRomBank, wramBank, pushWramBank,
  popWramBank, HOME, WRAM_STAGING, WRAM_SCREEN, PADF_A, PADF_B, rIE, IE_TIMER, MENUSLIDE_BACK, MENUSLIDE_FORWARD,
  BGM_MENU, SFX_MENU_MOVE, SFX_MENU_SELECT, SFX_MENU_CANCEL,
} from "../common/defs.js";
import { moveMenuCursorGrid, getMenuCursorIndex, setMenuCursorFromIndex } from "../common/cursors.js";
import { BANK_MENU_LIB } from "../common/tilemaps.js";
import { TILEBLOCK, initMenuBgScroll, loadMenuSpritePalettePair } from "../common/menu_lib.js";
import {
  ix, slideIn, slideOut, fillPickerCell, loadPickerCellPalette, drawCaptionFrame, queuePickerRows, bankedCaptionText,
  pickerCursorTask, loadLabelSets, loadPanelBlocks,
} from "./picker.js";

export const BANK_MAIN_MENU = 0x3B;
const OpenCourtSelect4Panel = [0x3E, 0x5E2A], CloseCourtSelect4Panel = [0x3E, 0x5E62], SetCourtSelect4TabAttrRect = [0x3E, 0x5FAD];

// ---- the N64 record type ----
const N64RecordTypeTable0 = 0x72E0, N64RecordTypeTable1 = 0x72E6, N64RecordTypeCursorSpriteTask = 0x734F;
const N64RecordTypeCursorSpriteTask_SpriteTemplate0 = 0x738C, N64RecordTypeCursorSpriteTask_SpriteTemplate1 = 0x73AD;
const N64RecordTypeCursorSpriteTaskTable0 = 0x73B6, N64RecordTypeCursorSpriteTaskTable1 = 0x73BC;
const FillN64RecordTypeCellTable = 0x7451, N64RecordTypeCellPalettePtrs = 0x7470;
const Text_30_207 = 0x00CF;
const RECORD_TYPES = 3, RECORD_TYPE_COLS = 3;
const RECORD_TYPE_SLIDE = { inPanel: 0x0A, inSteps: 0x0D, backFrom: 0x0A, outPanel: 0x0B, outSteps: 0x0B, backOutFrom: 0x0C, rows: 3 };
// RunN64RecordTypeSelect (3B:71B0): see the header
export function* runN64RecordTypeSelect(P) {
  const { V, bus } = P;
  sound(P, BGM_MENU);
  bus.w8(rIE, bus.u8(rIE) & ~IE_TIMER);
  yield* callGen(P, loadN64RecordTypeGfx(P));
  withRomBank(P, BANK_MENU_LIB, () => { initMenuBgScroll(P); loadMenuSpritePalettePair(P, 1, 1); });
  wramBank(P, WRAM_SCREEN);
  yield* callGen(P, n64RecordTypeSlideIn(P, V.menuSlideDirection));
  setMenuCursorFromIndex(P, RECORD_TYPE_COLS, V.subMenuCursor);
  registerFrameTask(P, 1, N64RecordTypeCursorSpriteTask, P.cpu.sp - 2);
  drawN64RecordTypeGrid(P);
  wramBank(P, WRAM_SCREEN);
  for (;;) {
    yield* advanceFrame(P);
    V.menuInputPressed = V.inputPressed;
    if (moveMenuCursorGrid(P, RECORD_TYPE_COLS, 1).a) { sound(P, SFX_MENU_MOVE); drawN64RecordTypeGrid(P); }
    if (P.menuWheel && P.menuWheel.on) P.menuWheel.skin = { id: "tabs", at: P.frames, title: "N64 DATA", icon: "n64", texts: Array.from({ length: RECORD_TYPES }, (_, i) => Text_30_207 + i), sel: getMenuCursorIndex(P, RECORD_TYPE_COLS).a };   // MENU: Wheel, read only
    const input = V.menuInputPressed;
    if (input & (PADF_A | PADF_B)) {
      const forward = input & PADF_A ? 1 : 0;
      sound(P, forward ? SFX_MENU_SELECT : SFX_MENU_CANCEL);
      callHome(P, HOME.ClearFrameTasks);
      bus.w8(rIE, bus.u8(rIE) | IE_TIMER);
      yield* callGen(P, n64RecordTypeSlideOut(P, forward));
      V.menuSlideDirection = forward ? MENUSLIDE_FORWARD : MENUSLIDE_BACK;
      if (!forward) return { a: 0xFF };
      const r = getMenuCursorIndex(P, RECORD_TYPE_COLS);
      V.subMenuCursor = r.a;
      return r;
    }
  }
}
// LoadN64RecordTypeGfx (3B:7243), over 8 frames: three label sets and the panel tiles. The WRAM bank is kept.
const RECORD_TYPE_BLOCKS = [[57, 0x00], [29, 0x10], [58, 0x20], [TILEBLOCK.SharedMenuGfx27, 0x70]];
export function* loadN64RecordTypeGfx(P) {
  pushWramBank(P, WRAM_STAGING);
  yield* loadLabelSets(P, N64RecordTypeTable0, N64RecordTypeTable1, RECORD_TYPES);
  yield* loadPanelBlocks(P, RECORD_TYPE_BLOCKS, TILEBLOCK.N64RecordTypeGfx2);
  popWramBank(P);
}
// N64RecordTypeSlideIn (3B:72EC) / N64RecordTypeSlideOut (3B:731E)
export const n64RecordTypeSlideIn = (P, forward) => slideIn(P, forward, RECORD_TYPE_SLIDE);
export const n64RecordTypeSlideOut = (P, forward) => slideOut(P, forward, RECORD_TYPE_SLIDE);
// N64RecordTypeCursorSpriteTask (3B:734F), a frame task
export const n64RecordTypeCursorSpriteTask = (P, sp = P.cpu.sp - 2) => pickerCursorTask(P, sp, getMenuCursorIndex(P, RECORD_TYPE_COLS).a,
  N64RecordTypeCursorSpriteTaskTable0, N64RecordTypeCursorSpriteTaskTable1, N64RecordTypeCursorSpriteTask_SpriteTemplate0,
  N64RecordTypeCursorSpriteTask_SpriteTemplate1);
// DrawN64RecordTypeGrid (3B:73BF): the three cells, the chosen one's palette, the caption; queued. Leaves WRAM 3.
export function drawN64RecordTypeGrid(P) {
  wramBank(P, WRAM_SCREEN);
  for (let i = 0; i < RECORD_TYPES; i++) fillN64RecordTypeCell(P, i, 0);
  const index = getMenuCursorIndex(P, RECORD_TYPE_COLS).a;
  fillN64RecordTypeCell(P, index, 1);
  loadN64RecordTypeCellPalette(P, getMenuCursorIndex(P, RECORD_TYPE_COLS).a);
  drawCaptionFrame(P);
  drawN64RecordTypeCaption(P);
  return queuePickerRows(P, [7]);
}
// FillN64RecordTypeCell (3B:7428) / LoadN64RecordTypeCellPalette (3B:745D) / DrawN64RecordTypeCaption (3B:749A)
export const fillN64RecordTypeCell = (P, index, highlighted) => fillPickerCell(P, FillN64RecordTypeCellTable, index, highlighted, 5);
export const loadN64RecordTypeCellPalette = (P, index) => loadPickerCellPalette(P, N64RecordTypeCellPalettePtrs, index);
export function drawN64RecordTypeCaption(P, f = 0) {
  const index = getMenuCursorIndex(P, RECORD_TYPE_COLS).a, text = ix(Text_30_207, index);
  return bankedCaptionText(P, text, text & 0xFF, index, f);
}

// ---- the N64 transfer item ----
const N64TransferItemTable0 = 0x75FC, N64TransferItemTable1 = 0x7604, N64TransferItemCellPalettePtrs = 0x7693;
const N64TransferItemCursorSpriteTask = 0x76EA, N64TransferItemCursorSpriteTask_SpriteTemplate0 = 0x7727;
const N64TransferItemCursorSpriteTask_SpriteTemplate1 = 0x7748, N64TransferItemCursorSpriteTaskTable0 = 0x7751;
const N64TransferItemCursorSpriteTaskTable1 = 0x7759;
const Text_30_210 = 0x00D2;
const ITEMS = 4, ITEM_COLS = 2, ITEM_ROWS = 2;
// RunN64TransferItemSelect (3B:74BF): see the header
export function* runN64TransferItemSelect(P) {
  const { V, bus } = P;
  sound(P, BGM_MENU);
  bus.w8(rIE, bus.u8(rIE) & ~IE_TIMER);
  yield* callGen(P, loadN64TransferItemGfx(P));
  wramBank(P, WRAM_SCREEN);
  yield* waitFarCall(P, OpenCourtSelect4Panel, { b: V.menuSlideDirection });
  withRomBank(P, BANK_MENU_LIB, () => { initMenuBgScroll(P); loadMenuSpritePalettePair(P, 1, 1); });
  setMenuCursorFromIndex(P, ITEM_COLS, V.n64TransferMenuCursor);
  registerFrameTask(P, 1, N64TransferItemCursorSpriteTask, P.cpu.sp - 2);
  drawN64TransferItemGrid(P);
  wramBank(P, WRAM_SCREEN);
  for (;;) {
    yield* advanceFrame(P);
    V.menuInputPressed = V.inputPressed;
    if (moveMenuCursorGrid(P, ITEM_COLS, ITEM_ROWS).a) { sound(P, SFX_MENU_MOVE); drawN64TransferItemGrid(P); }
    if (P.menuWheel && P.menuWheel.on) P.menuWheel.skin = { id: "tabs", at: P.frames, title: "GB DATA", icon: "data", texts: Array.from({ length: ITEMS }, (_, i) => Text_30_210 + i), sel: getMenuCursorIndex(P, ITEM_COLS).a };   // MENU: Wheel, read only
    const input = V.menuInputPressed;
    if (input & (PADF_A | PADF_B)) {
      const forward = input & PADF_A ? 1 : 0;
      sound(P, forward ? SFX_MENU_SELECT : SFX_MENU_CANCEL);
      callHome(P, HOME.ClearFrameTasks);
      bus.w8(rIE, bus.u8(rIE) | IE_TIMER);
      yield* waitFarCall(P, CloseCourtSelect4Panel, { b: forward });
      V.menuSlideDirection = forward ? MENUSLIDE_FORWARD : MENUSLIDE_BACK;
      if (!forward) return { a: 0xFF };
      const r = getMenuCursorIndex(P, ITEM_COLS);
      V.n64TransferMenuCursor = r.a;
      return r;
    }
  }
}
// LoadN64TransferItemGfx (3B:7552), over 11 frames: four label sets and the panel tiles. The WRAM bank is kept.
const ITEM_BLOCKS = [[59, 0x00], [TILEBLOCK.N64TransferItemGfx4, 0x10], [60, 0x20], [61, 0x30], [TILEBLOCK.SharedMenuGfx27, 0x70]];
export function* loadN64TransferItemGfx(P) {
  pushWramBank(P, WRAM_STAGING);
  yield* loadLabelSets(P, N64TransferItemTable0, N64TransferItemTable1, ITEMS);
  yield* loadPanelBlocks(P, ITEM_BLOCKS, TILEBLOCK.N64TransferItemGfx3);
  popWramBank(P);
}
// DrawN64TransferItemGrid (3B:760C): the four tabs (the court-select panel's), the chosen one's palette, the
// caption; queued. Leaves WRAM 3.
export function drawN64TransferItemGrid(P) {
  wramBank(P, WRAM_SCREEN);
  for (let i = 0; i < ITEMS; i++) callFar(P, SetCourtSelect4TabAttrRect, { b: i, c: 0 });
  callFar(P, SetCourtSelect4TabAttrRect, { b: getMenuCursorIndex(P, ITEM_COLS).a, c: 1 });
  loadN64TransferItemCellPalette(P, getMenuCursorIndex(P, ITEM_COLS).a);
  drawCaptionFrame(P);
  drawN64TransferItemCaption(P);
  return queuePickerRows(P, [4, 9]);
}
// LoadN64TransferItemCellPalette (3B:7680) / DrawN64TransferItemCaption (3B:76C5)
export const loadN64TransferItemCellPalette = (P, index) => loadPickerCellPalette(P, N64TransferItemCellPalettePtrs, index);
export function drawN64TransferItemCaption(P, f = 0) {
  const index = getMenuCursorIndex(P, ITEM_COLS).a, text = ix(Text_30_210, index);
  return bankedCaptionText(P, text, text & 0xFF, index, f);
}
// N64TransferItemCursorSpriteTask (3B:76EA), a frame task
export const n64TransferItemCursorSpriteTask = (P, sp = P.cpu.sp - 2) => pickerCursorTask(P, sp, getMenuCursorIndex(P, ITEM_COLS).a,
  N64TransferItemCursorSpriteTaskTable0, N64TransferItemCursorSpriteTaskTable1, N64TransferItemCursorSpriteTask_SpriteTemplate0,
  N64TransferItemCursorSpriteTask_SpriteTemplate1);

export const HOOKS = [
  [BANK_MAIN_MENU, 0x71B0, hookGen(P => runN64RecordTypeSelect(P))],
  [BANK_MAIN_MENU, 0x7243, hookGen(P => loadN64RecordTypeGfx(P))],
  [BANK_MAIN_MENU, 0x72EC, hookGen((P, c) => n64RecordTypeSlideIn(P, c.b))],
  [BANK_MAIN_MENU, 0x731E, hookGen((P, c) => n64RecordTypeSlideOut(P, c.b))],
  [BANK_MAIN_MENU, 0x734F, hook((P, c) => n64RecordTypeCursorSpriteTask(P, c.sp - 2))],
  [BANK_MAIN_MENU, 0x73BF, hook(P => drawN64RecordTypeGrid(P))],
  [BANK_MAIN_MENU, 0x7428, hook((P, c) => { fillN64RecordTypeCell(P, c.b, c.c); })],
  [BANK_MAIN_MENU, 0x745D, hook((P, c) => loadN64RecordTypeCellPalette(P, c.a))],
  [BANK_MAIN_MENU, 0x749A, hook((P, c) => drawN64RecordTypeCaption(P, c.f))],
  [BANK_MAIN_MENU, 0x74BF, hookGen(P => runN64TransferItemSelect(P))],
  [BANK_MAIN_MENU, 0x7552, hookGen(P => loadN64TransferItemGfx(P))],
  [BANK_MAIN_MENU, 0x760C, hook(P => drawN64TransferItemGrid(P))],
  [BANK_MAIN_MENU, 0x7680, hook((P, c) => loadN64TransferItemCellPalette(P, c.a))],
  [BANK_MAIN_MENU, 0x76C5, hook((P, c) => drawN64TransferItemCaption(P, c.f))],
  [BANK_MAIN_MENU, 0x76EA, hook((P, c) => n64TransferItemCursorSpriteTask(P, c.sp - 2))],
];
