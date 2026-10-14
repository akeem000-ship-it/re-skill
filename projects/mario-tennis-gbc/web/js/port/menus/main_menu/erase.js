// The Erase menu (bank $3B): which saved data to erase: the three story files (top row) or all the Game Pak's or the
// N64 data (bottom row). States of RunEraseSavedDataSelect: load (15 frames), slide in, choose (the SavedDataPicker
// cursor: 3 cells over 2); A on an empty file refuses (SFX_MENU_CANCEL), else slides out forward and returns the
// cell; B slides out back and returns $FF. (The confirmation and the erasing are the story flow's, bank $10.)
// Also the N64 records block read into WRAM 2 and the test for N64 data, which Saved Data uses.
// Port of src/engine/menus/main_menu/erase_3b.asm and DrawEraseSavedDataCaption (n64transfer_3b.asm) of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm). Tables are read from the ROM.
// Tests: lockstep on out/port/save1.mtrec (erasing a file and everything) and the menu recordings;
// web/tests/port/routines_menus_main.mjs.
import { clearMemory16 } from "../../home/memory.js";
import { registerFrameTask } from "../../home/colorfade.js";
import { readSaveBlock } from "../../save/storyslots.js";
import {
  FZ, FC, cpFlags, decFlags, hook, hookGen, callGen, callHome, advanceFrame, sound, withRomBank, withWramBank, wramBank,
  pushWramBank, popWramBank, VRAM_BANK1, vTiles1, PADF_A, PADF_B, PADF_LEFT, PADF_RIGHT, PADF_UP, PADF_DOWN, rIE,
  IE_TIMER, HOME, WRAM_STAGING, WRAM_COURT_PLANES, WRAM_SCREEN, wScreenAttrmap, MENUSLIDE_BACK, MENUSLIDE_FORWARD,
  BGM_MENU, SFX_MENU_MOVE, SFX_MENU_SELECT, SFX_MENU_CANCEL,
} from "../common/defs.js";
import { getMenuCursorIndex, setMenuCursorFromIndex } from "../common/cursors.js";
import { BANK_MENU_LIB } from "../common/tilemaps.js";
import { TILEBLOCK, initMenuBgScroll, loadMenuSpritePalettePair } from "../common/menu_lib.js";
import {
  ix, slideIn, slideOut, fillPickerCell, loadPickerCellPalette, drawCaptionFrame, queuePickerRows, captionText,
  drawFileCaption, loadFilePalette, summaryOf, NO_FILE, pickerCursorTask, loadLabelSet, loadFileMugshots, loadPanelBlocks,
} from "./picker.js";
import { buildSaveSlotSummaries } from "./main_menu.js";

export const BANK_MAIN_MENU = 0x3B;
const BANK_SAVE = 0x03, SAVEBLOCK_N64_RECORDS = 0x0B, N64_RECORDS_BLOCKS = 0x20;
const wN64BlockProbe = 0xD000;                              // WRAM 2: the N64 records block's first two bytes

// LoadN64RecordsToWram2 (3B:6C3D): the N64 records block (save block $0B) into WRAM 2 $D000 (512 bytes cleared
// first). Leaves a = the WRAM bank, the flags of the call, b = $0B, c = 0, hl = $D000.
export function loadN64RecordsToWram2(P, f = 0) {
  const old = P.V.wramBank;
  withWramBank(P, WRAM_COURT_PLANES, () => {
    clearMemory16(P, wScreenAttrmap, N64_RECORDS_BLOCKS);
    withRomBank(P, BANK_SAVE, () => readSaveBlock(P, SAVEBLOCK_N64_RECORDS, wScreenAttrmap));
  });
  return { a: old, f, b: SAVEBLOCK_N64_RECORDS, c: 0, hl: wScreenAttrmap };
}
// CheckN64DataPresent (3B:6C5D): a = 1 if the block read there has data (its first two bytes not both 0), else 0
// (Z). b = the first byte; with data the flags are the call's.
export function checkN64DataPresent(P, f = 0) {
  const b = withWramBank(P, WRAM_COURT_PLANES, () => P.bus.u8(wN64BlockProbe));
  const present = withWramBank(P, WRAM_COURT_PLANES, () => P.bus.u8(wN64BlockProbe + 1)) | b;
  return present ? { a: 1, b, f } : { a: 0, b, f: FZ };
}

// ---- the picker shared with Saved Data: 3 cells over 2 ----
// SavedDataPickerSlideIn (3B:6E24) / SavedDataPickerSlideOut (3B:6E56)
export const SAVED_DATA_PICKER = { inPanel: 8, inSteps: 0x0F, backFrom: 0x0B, outPanel: 9, outSteps: 0x0A, backOutFrom: 0x0E, rows: 2 };
export const savedDataPickerSlideIn = (P, forward) => slideIn(P, forward, SAVED_DATA_PICKER);
export const savedDataPickerSlideOut = (P, forward) => slideOut(P, forward, SAVED_DATA_PICKER);
// MoveSavedDataPickerCursor (3B:6E87): left / right wrap along the row (3 cells on top, 2 below); up / down change
// rows, x through the row's table. Returns a = 1 if a direction was pressed, else 0 (Z); the flags of the last step,
// hl = the table entry for up/down.
const SavedDataPickerCursorTable0 = 0x6F56, SavedDataPickerCursorTable1 = 0x6F59;
const TOP_CELLS = 3, BOTTOM_CELLS = 2;
export function moveSavedDataPickerCursor(P) {
  const { V, bus } = P, input = V.menuInputPressed, top = V.menuCursorY === 0;
  if (input & (PADF_RIGHT | PADF_LEFT)) {
    const n = top ? TOP_CELLS : BOTTOM_CELLS, v = (V.menuCursorX + (input & PADF_RIGHT ? 1 : -1)) & 0xFF;
    let x, f;
    if (v & 0x80) { x = n - 1; f = decFlags(n, FC); } else if (v < n) { x = v; f = cpFlags(v, n); } else { x = 0; f = FZ; }
    V.menuCursorX = x;
    return { a: 1, f };
  }
  if (input & (PADF_UP | PADF_DOWN)) {
    const at = ix(top ? SavedDataPickerCursorTable0 : SavedDataPickerCursorTable1, V.menuCursorX);
    V.menuCursorX = bus.u8(at);
    const y = V.menuCursorY ^ 1;
    V.menuCursorY = y;
    return { a: 1, hl: at, f: y ? 0 : FZ };
  }
  return { a: 0, f: FZ };
}

// ---- Erase ----
const EraseSavedDataCursorSpriteTask = 0x6F5B, EraseSavedDataCursorSpriteTask_SpriteTemplate0 = 0x6F98;
const EraseSavedDataCursorSpriteTask_SpriteTemplate1 = 0x6FB9, EraseSavedDataCursorSpriteTaskTable0 = 0x6FC2;
const EraseSavedDataCursorSpriteTaskTable1 = 0x6FCC, FillEraseSavedDataCellTable = 0x70C1, EraseSavedDataCellPalettePtrs = 0x70DE;
const Text_30_204 = 0x00CC, Text_30_206 = 0x00CE;          // Game Pak / N64 data texts; "no file"
const COLS = 3, CELLS = 5, FILES = 3;
const N64TransferLabelTiles0 = [0x3D, 0x0E], N64TransferLabelTiles1 = [0x3D, 0x10];
// RunEraseSavedDataSelect (3B:6C7F): see the header. Returns a = the cell or $FF.
export function* runEraseSavedDataSelect(P) {
  const { V, bus } = P;
  bus.w8(rIE, bus.u8(rIE) & ~IE_TIMER);
  sound(P, BGM_MENU);
  buildSaveSlotSummaries(P);
  yield* callGen(P, loadEraseSavedDataGfx(P));
  wramBank(P, WRAM_SCREEN);
  yield* callGen(P, savedDataPickerSlideIn(P, V.menuSlideDirection));
  withRomBank(P, BANK_MENU_LIB, () => { initMenuBgScroll(P); loadMenuSpritePalettePair(P, 1, 1); });
  setMenuCursorFromIndex(P, COLS, 0);
  registerFrameTask(P, 1, EraseSavedDataCursorSpriteTask, P.cpu.sp - 2);
  drawEraseSavedDataGrid(P);
  wramBank(P, WRAM_SCREEN);
  for (;;) {
    V.menuInputPressed = V.inputPressed;                     // (the pad of the frame before: read before the wait)
    if (moveSavedDataPickerCursor(P).a) { sound(P, SFX_MENU_MOVE); drawEraseSavedDataGrid(P); }
    yield* advanceFrame(P);
    const input = V.menuInputPressed;
    if (input & PADF_A) {
      const index = getMenuCursorIndex(P, COLS).a;
      if (index < FILES && bus.u8(summaryOf(index)) === NO_FILE) { sound(P, SFX_MENU_CANCEL); continue; }
      sound(P, SFX_MENU_SELECT);
      callHome(P, HOME.ClearFrameTasks);
      bus.w8(rIE, bus.u8(rIE) | IE_TIMER);
      yield* callGen(P, savedDataPickerSlideOut(P, 1));
      V.menuSlideDirection = MENUSLIDE_FORWARD;
      return getMenuCursorIndex(P, COLS);
    }
    if (input & PADF_B) {
      sound(P, SFX_MENU_CANCEL);
      callHome(P, HOME.ClearFrameTasks);
      bus.w8(rIE, bus.u8(rIE) | IE_TIMER);
      yield* callGen(P, savedDataPickerSlideOut(P, 0));
      V.menuSlideDirection = MENUSLIDE_BACK;
      return { a: 0xFF };
    }
  }
}
// LoadEraseSavedDataGfx (3B:6D31), over 15 frames: the files' mugshots, two label sets, the panel tiles. The WRAM
// bank is kept.
const ERASE_BLOCKS = [[46, 0x00], [47, 0x10], [48, 0x20], [49, 0x30], [50, 0x40], [TILEBLOCK.SharedMenuGfx27, 0x70]];
export function* loadEraseSavedDataGfx(P) {
  pushWramBank(P, WRAM_STAGING);
  yield* loadFileMugshots(P);
  wramBank(P, WRAM_STAGING);
  yield* loadLabelSet(P, N64TransferLabelTiles0, vTiles1 + VRAM_BANK1);
  yield* loadLabelSet(P, N64TransferLabelTiles1, vTiles1 + 0x100 + VRAM_BANK1);
  yield* loadPanelBlocks(P, ERASE_BLOCKS, TILEBLOCK.SharedMenuGfx65);
  popWramBank(P);
}
// EraseSavedDataCursorSpriteTask (3B:6F5B), a frame task
export const eraseSavedDataCursorSpriteTask = (P, sp = P.cpu.sp - 2) => pickerCursorTask(P, sp, getMenuCursorIndex(P, COLS).a,
  EraseSavedDataCursorSpriteTaskTable0, EraseSavedDataCursorSpriteTaskTable1, EraseSavedDataCursorSpriteTask_SpriteTemplate0,
  EraseSavedDataCursorSpriteTask_SpriteTemplate1);
// DrawEraseSavedDataGrid (3B:6FFB): the cells, the chosen one's palette, the caption; queued. Leaves WRAM 3.
export function drawEraseSavedDataGrid(P) {
  wramBank(P, WRAM_SCREEN);
  for (let i = 0; i < CELLS; i++) fillEraseSavedDataCell(P, i, 0);
  const index = getMenuCursorIndex(P, COLS).a;
  fillEraseSavedDataCell(P, index, 1);
  if (index < FILES) loadFilePalette(P, index); else loadEraseSavedDataCellPalette(P, index);
  drawCaptionFrame(P);
  drawEraseSavedDataCaption(P);
  return queuePickerRows(P, [4, 9]);
}
// FillEraseSavedDataCell (3B:708B) / LoadEraseSavedDataCellPalette (3B:70CB)
export const fillEraseSavedDataCell = (P, index, highlighted) => fillPickerCell(P, FillEraseSavedDataCellTable, index, highlighted, index < FILES ? 3 : 5);
export const loadEraseSavedDataCellPalette = (P, index) => loadPickerCellPalette(P, EraseSavedDataCellPalettePtrs, index);
// DrawEraseSavedDataCaption (3B:7100): a file's caption, or the Game Pak / N64 text
export function drawEraseSavedDataCaption(P) {
  const index = getMenuCursorIndex(P, COLS).a;
  if (index < FILES) { drawFileCaption(P, index, Text_30_206, false); return; }
  pushWramBank(P, WRAM_SCREEN);
  captionText(P, ix(Text_30_204, index - FILES));
  popWramBank(P);
}

export const HOOKS = [
  [BANK_MAIN_MENU, 0x6C3D, hook((P, c) => loadN64RecordsToWram2(P, c.f))],
  [BANK_MAIN_MENU, 0x6C5D, hook((P, c) => checkN64DataPresent(P, c.f))],
  [BANK_MAIN_MENU, 0x6C7F, hookGen(P => runEraseSavedDataSelect(P))],
  [BANK_MAIN_MENU, 0x6D31, hookGen(P => loadEraseSavedDataGfx(P))],
  [BANK_MAIN_MENU, 0x6E24, hookGen((P, c) => savedDataPickerSlideIn(P, c.b))],
  [BANK_MAIN_MENU, 0x6E56, hookGen((P, c) => savedDataPickerSlideOut(P, c.b))],
  [BANK_MAIN_MENU, 0x6E87, hook(P => moveSavedDataPickerCursor(P))],
  [BANK_MAIN_MENU, 0x6F5B, hook((P, c) => eraseSavedDataCursorSpriteTask(P, c.sp - 2))],
  [BANK_MAIN_MENU, 0x6FFB, hook(P => drawEraseSavedDataGrid(P))],
  [BANK_MAIN_MENU, 0x708B, hook((P, c) => { fillEraseSavedDataCell(P, c.b, c.c); })],
  [BANK_MAIN_MENU, 0x70CB, hook((P, c) => loadEraseSavedDataCellPalette(P, c.a))],
  [BANK_MAIN_MENU, 0x7100, hook(P => { drawEraseSavedDataCaption(P); })],
];
