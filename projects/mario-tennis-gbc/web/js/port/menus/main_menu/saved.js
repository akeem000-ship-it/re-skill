// The Saved Data menu (bank $3B), and the minigame menu's helpers that share its source file.
// Saved Data: a grid of the three story files (top row) over Game Pak and N64 (bottom row), on the stadium. States
// of RunSavedDataSourceSelect: load (14 frames: labels, the files' mugshots, panel tiles), slide in, choose (the
// SavedDataPicker cursor: 3 cells over 2); A on an empty file or on N64 without N64 data refuses (SFX_MENU_LOCKED),
// else slides out forward and returns the cell (wSavedDataMenuCursor); B slides out back and returns $FF.
// Minigames: the Mario-cast unlock mask (BuildMarioCastUnlockMask: which of the six cast members' save flags are
// set), the character of each cell of the minigame grid and whether it is unlocked, the grid's slide and cells.
// Port of src/engine/menus/main_menu/saved_3b.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm). Tables are read from the ROM.
// Tests: lockstep on out/port/save1.mtrec (Saved Data) and the menu recordings; web/tests/port/routines_menus_main.mjs.
import { registerFrameTask } from "../../home/colorfade.js";
import { testSaveFlag } from "../../save/storyslots.js";
import {
  FZ, FN, cpFlags, ixFlags, hook, hookGen, callGen, farGen, callHome, advanceFrame, sound, withRomBank, wramBank,
  pushWramBank, popWramBank, queueCopy, cell, HOME, WRAM_STAGING, WRAM_SCREEN, TILEMAP_WIDTH, VRAM_BANK1, vBGMap0,
  vTiles1, wShadowAttrmap, PADF_A, PADF_B, rIE, IE_TIMER, MENUSLIDE_BACK, MENUSLIDE_FORWARD, BGM_MENU, SFX_MENU_MOVE,
  SFX_MENU_SELECT, SFX_MENU_LOCKED, SFX_MENU_CANCEL,
} from "../common/defs.js";
import { getMenuCursorIndex, setMenuCursorFromIndex } from "../common/cursors.js";
import { BANK_MENU_LIB } from "../common/tilemaps.js";
import { TILEBLOCK, initMenuBgScroll, loadMenuSpritePalettePair } from "../common/menu_lib.js";
import { fillMenuGridCellTile } from "../common/widgets.js";
import {
  ix, slideIn, slideOut, fillPickerCell, loadPickerCellPalette, drawCaptionFrame, queuePickerRows, bankedCaptionText,
  drawFileCaption, loadFilePalette, summaryOf, NO_FILE, pickerCursorTask, loadLabelSet, loadFileMugshots, loadPanelBlocks,
} from "./picker.js";
import { buildSaveSlotSummaries } from "./main_menu.js";
import { loadN64RecordsToWram2, checkN64DataPresent, SAVED_DATA_PICKER, moveSavedDataPickerCursor } from "./erase.js";

export const BANK_MAIN_MENU = 0x3B;
const BANK_SAVE = 0x03;

// ---- the Mario cast's minigames ----
const MarioCastUnlockMaskTable = 0x66A9, UnlockedMarioCastCharAtGridSlotTable = 0x66D8, MarioCastCharAtGridSlotTable = 0x66E9;
const CAST_MEMBERS = 6;
const CHAR_LUIGI = 0x17, CHAR_DK = 0x18, CHAR_BABY_MARIO = 0x19, FIRST_CAST_CHAR = 0x1A, CHAR_UNUSED_15 = 0x15;
const MARIOGAME_TREASURE_BOX = 0x06;
// BuildMarioCastUnlockMask (3B:667F): wMarioCastUnlockMask = the six save flags of MarioCastUnlockMaskTable, the
// first in bit 5 down to the last in bit 0.
export function buildMarioCastUnlockMask(P) {
  let mask = 0, at = 0;
  for (let i = 0; i < CAST_MEMBERS; i++) {
    at = MarioCastUnlockMaskTable + 2 * i;
    const flag = P.bus.u16(at);
    if (withRomBank(P, BANK_SAVE, () => testSaveFlag(P, flag))) mask |= 1;
    if (i < CAST_MEMBERS - 1) mask = (mask << 1) & 0xFF;
  }
  P.V.marioCastUnlockMask = mask;
  return { a: mask, b: mask, c: CAST_MEMBERS, de: P.bus.u16(at), hl: at + 1, f: FZ | FN };
}
// GetMarioCastCharAtGridSlot (3B:66DE): the character of minigame cell c. Returns a and hl = its entry.
export function getMarioCastCharAtGridSlot(P, slot) {
  const hl = ix(MarioCastCharAtGridSlotTable, slot);
  return { a: P.bus.u8(hl), hl, f: ixFlags(MarioCastCharAtGridSlotTable, slot) };
}
// GetUnlockedMarioCastCharAtGridSlot (3B:66B5): the character of cell c, or CHAR_UNUSED_15 if it is a cast member
// whose bit of wMarioCastUnlockMask is clear (Luigi, DK and Baby Mario are always there: Z).
export function getUnlockedMarioCastCharAtGridSlot(P, slot) {
  const r = getMarioCastCharAtGridSlot(P, slot), ch = r.a;
  for (const always of [CHAR_LUIGI, CHAR_BABY_MARIO, CHAR_DK]) if (ch === always) return { ...r, f: FZ | FN };
  const hl = ix(UnlockedMarioCastCharAtGridSlotTable, (ch - FIRST_CAST_CHAR) & 0xFF), bit = P.bus.u8(hl);
  const unlocked = P.V.marioCastUnlockMask & bit;
  return { a: unlocked ? ch : CHAR_UNUSED_15, b: bit, d: ch, hl, f: unlocked ? 0x20 : FZ | 0x20 };
}
// CheckMinigameGridExpanded (3B:66F2): a = 1 if the treasure-box cell's character is unlocked (the grid of 9), else 0
export function checkMinigameGridExpanded(P) {
  const r = getUnlockedMarioCastCharAtGridSlot(P, MARIOGAME_TREASURE_BOX);
  if (r.a === CHAR_UNUSED_15) return { ...r, c: MARIOGAME_TREASURE_BOX, a: 0, f: FZ };
  return { ...r, c: MARIOGAME_TREASURE_BOX, a: 1, f: cpFlags(r.a, CHAR_UNUSED_15) };
}
// MinigameSelectSlideIn6 (3B:6700) / MinigameSelectSlideOut6 (3B:6732): the six-cell minigame grid's panels
const MINIGAME_SLIDE = { inPanel: 0x16, inSteps: 0x0E, backFrom: 0x0C, outPanel: 0x17, outSteps: 0x0B, backOutFrom: 0x0D, rows: 2 };
export const minigameSelectSlideIn6 = (P, forward) => slideIn(P, forward, MINIGAME_SLIDE);
export const minigameSelectSlideOut6 = (P, forward) => slideOut(P, forward, MINIGAME_SLIDE);
// DrawMinigameSelectGrid6 (3B:6763): the six cells plain, the chosen one highlighted, its character's palette
// (LoadMinigameCharPalette, the minigame menu's), the two rows queued. Leaves WRAM 3.
const LoadMinigameCharPalette = 0x6672;
export function drawMinigameSelectGrid6(P) {
  wramBank(P, WRAM_SCREEN);
  withRomBank(P, BANK_MENU_LIB, () => {
    for (let i = 0; i < 6; i++) fillMenuGridCellTile(P, i, 0);
    fillMenuGridCellTile(P, getMenuCursorIndex(P, 3).a, 1);
  });
  P.callRom(BANK_MAIN_MENU, LoadMinigameCharPalette, { a: getMenuCursorIndex(P, 3).a });
  queueCopy(P, cell(wShadowAttrmap, 0, 4), vBGMap0 + 4 * TILEMAP_WIDTH + VRAM_BANK1, 3 * TILEMAP_WIDTH / 16);
  return queueCopy(P, cell(wShadowAttrmap, 0, 9), vBGMap0 + 9 * TILEMAP_WIDTH + VRAM_BANK1, 3 * TILEMAP_WIDTH / 16);
}

// ---- Saved Data ----
const SavedDataSourceCursorSpriteTask = 0x69DC, SavedDataSourceCursorSpriteTask_SpriteTemplate0 = 0x6A19;
const SavedDataSourceCursorSpriteTask_SpriteTemplate1 = 0x6A3A, SavedDataSourceCursorSpriteTaskTable0 = 0x6A43;
const SavedDataSourceCursorSpriteTaskTable1 = 0x6A4F, FillSavedDataSourceCellTable = 0x6B44, SavedDataSourceCellPalettePtrs = 0x6B61;
const Text_30_199 = 0x00C7, Text_30_200 = 0x00C8, Text_30_201 = 0x00C9;   // N64, no file, Game Pak
const COLS = 3, CELLS = 5, FILES = 3, N64_CELL = 4;
const ModeSelectLabelTiles1 = [0x3C, 0x14], ModeSelectLabelTiles7 = [0x3C, 0x20];
// RunSavedDataSourceSelect (3B:67A1): see the header. Returns a = the cell or $FF.
export function* runSavedDataSourceSelect(P) {
  const { V, bus } = P;
  sound(P, BGM_MENU);
  bus.w8(rIE, bus.u8(rIE) & ~IE_TIMER);
  buildSaveSlotSummaries(P);
  yield* callGen(P, loadSavedDataSourceGfx(P));
  withRomBank(P, BANK_MENU_LIB, () => { initMenuBgScroll(P); loadMenuSpritePalettePair(P, 1, 1); });
  loadN64RecordsToWram2(P);
  wramBank(P, WRAM_SCREEN);
  yield* farGen(P, BANK_MAIN_MENU, slideIn(P, V.menuSlideDirection, SAVED_DATA_PICKER));
  setMenuCursorFromIndex(P, COLS, V.savedDataMenuCursor);
  registerFrameTask(P, 1, SavedDataSourceCursorSpriteTask, P.cpu.sp - 2);
  drawSavedDataSourceGrid(P);
  wramBank(P, WRAM_SCREEN);
  for (;;) {
    yield* advanceFrame(P);
    V.menuInputPressed = V.inputPressed;
    if (moveSavedDataPickerCursor(P).a) { sound(P, SFX_MENU_MOVE); drawSavedDataSourceGrid(P); }
    if (P.menuWheel && P.menuWheel.on) P.menuWheel.skin = { id: "files", at: P.frames, mode: "status", sel: V.menuCursorX + COLS * V.menuCursorY };   // MENU: Wheel (menuskins.js), read only
    const input = V.menuInputPressed;
    if (input & PADF_A) {
      const index = getMenuCursorIndex(P, COLS).a;
      const refused = index === N64_CELL ? !checkN64DataPresent(P).a : index < FILES && bus.u8(summaryOf(index)) === NO_FILE;
      if (refused) { sound(P, SFX_MENU_LOCKED); continue; }
      sound(P, SFX_MENU_SELECT);
      callHome(P, HOME.ClearFrameTasks);
      bus.w8(rIE, bus.u8(rIE) | IE_TIMER);
      yield* farGen(P, BANK_MAIN_MENU, slideOut(P, 1, SAVED_DATA_PICKER));
      V.menuSlideDirection = MENUSLIDE_FORWARD;
      const r = getMenuCursorIndex(P, COLS);
      V.savedDataMenuCursor = r.a;
      return r;
    }
    if (input & PADF_B) {
      sound(P, SFX_MENU_CANCEL);
      callHome(P, HOME.ClearFrameTasks);
      bus.w8(rIE, bus.u8(rIE) | IE_TIMER);
      yield* farGen(P, BANK_MAIN_MENU, slideOut(P, 0, SAVED_DATA_PICKER));
      V.menuSlideDirection = MENUSLIDE_BACK;
      return { a: 0xFF };
    }
  }
}
// LoadSavedDataSourceGfx (3B:686E), over 14 frames: two label sets (VRAM bank 1 $8800, $8900), the files'
// mugshots, the panel tiles. The WRAM bank is kept.
const SAVED_DATA_BLOCKS = [[42, 0x00], [43, 0x10], [44, 0x20], [45, 0x30], [TILEBLOCK.SavedDataSourceGfx5, 0x40], [TILEBLOCK.SharedMenuGfx27, 0x70]];
export function* loadSavedDataSourceGfx(P) {
  pushWramBank(P, WRAM_STAGING);
  yield* loadLabelSet(P, ModeSelectLabelTiles1, vTiles1 + VRAM_BANK1);
  yield* loadLabelSet(P, ModeSelectLabelTiles7, vTiles1 + 0x100 + VRAM_BANK1);
  yield* loadFileMugshots(P);
  yield* loadPanelBlocks(P, SAVED_DATA_BLOCKS, TILEBLOCK.SavedDataSourceGfx4);
  popWramBank(P);
}
// Unused_3b_SlideMenuPanel_1 (3B:6979) / _2 (3B:69AB): the slide of a panel pair (layouts 6 and 7) nothing shows
const UNUSED_SLIDE = { inPanel: 6, inSteps: 0x0C, backFrom: 0x0A, outPanel: 7, outSteps: 0x0D, backOutFrom: 0x0C, rows: 2 };
export const unusedSlideMenuPanel1 = (P, forward) => slideIn(P, forward, UNUSED_SLIDE);
export const unusedSlideMenuPanel2 = (P, forward) => slideOut(P, forward, UNUSED_SLIDE);
// SavedDataSourceCursorSpriteTask (3B:69DC), a frame task: the banners and the chosen cell's frame
export const savedDataSourceCursorSpriteTask = (P, sp = P.cpu.sp - 2) => pickerCursorTask(P, sp, getMenuCursorIndex(P, COLS).a,
  SavedDataSourceCursorSpriteTaskTable0, SavedDataSourceCursorSpriteTaskTable1, SavedDataSourceCursorSpriteTask_SpriteTemplate0,
  SavedDataSourceCursorSpriteTask_SpriteTemplate1);
// DrawSavedDataSourceGrid (3B:6A7E): the cells, the chosen one's palette (a file's character, else its own), the
// caption; queued. Leaves WRAM 3.
export function drawSavedDataSourceGrid(P) {
  wramBank(P, WRAM_SCREEN);
  for (let i = 0; i < CELLS; i++) fillSavedDataSourceCell(P, i, 0);
  const index = getMenuCursorIndex(P, COLS).a;
  fillSavedDataSourceCell(P, index, 1);
  if (index < FILES) loadFilePalette(P, index); else loadSavedDataSourceCellPalette(P, index);
  drawCaptionFrame(P);
  drawSavedDataSourceCaption(P);
  return queuePickerRows(P, [4, 9]);
}
// FillSavedDataSourceCell (3B:6B0E): cell b's attributes (a file 3 wide, the others 5), highlighted if c
export const fillSavedDataSourceCell = (P, index, highlighted) => fillPickerCell(P, FillSavedDataSourceCellTable, index, highlighted, index < FILES ? 3 : 5);
// LoadSavedDataSourceCellPalette (3B:6B4E)
export const loadSavedDataSourceCellPalette = (P, index) => loadPickerCellPalette(P, SavedDataSourceCellPalettePtrs, index);
// DrawSavedDataSourceCaption (3B:6B83): a file's caption, or the Game Pak / N64 text
export function drawSavedDataSourceCaption(P, f = 0) {
  const index = getMenuCursorIndex(P, COLS).a;
  if (index < FILES) return drawFileCaption(P, index, Text_30_200, false, f);
  return bankedCaptionText(P, index === N64_CELL ? Text_30_199 : Text_30_201, index, index, f);
}

export const HOOKS = [
  [BANK_MAIN_MENU, 0x667F, hook(P => buildMarioCastUnlockMask(P))],
  [BANK_MAIN_MENU, 0x66B5, hook((P, c) => getUnlockedMarioCastCharAtGridSlot(P, c.c))],
  [BANK_MAIN_MENU, 0x66DE, hook((P, c) => getMarioCastCharAtGridSlot(P, c.c))],
  [BANK_MAIN_MENU, 0x66F2, hook(P => checkMinigameGridExpanded(P))],
  [BANK_MAIN_MENU, 0x6700, hookGen((P, c) => minigameSelectSlideIn6(P, c.b))],
  [BANK_MAIN_MENU, 0x6732, hookGen((P, c) => minigameSelectSlideOut6(P, c.b))],
  [BANK_MAIN_MENU, 0x6763, hook(P => drawMinigameSelectGrid6(P))],
  [BANK_MAIN_MENU, 0x67A1, hookGen(P => runSavedDataSourceSelect(P))],
  [BANK_MAIN_MENU, 0x686E, hookGen(P => loadSavedDataSourceGfx(P))],
  [BANK_MAIN_MENU, 0x6979, hookGen((P, c) => unusedSlideMenuPanel1(P, c.b))],
  [BANK_MAIN_MENU, 0x69AB, hookGen((P, c) => unusedSlideMenuPanel2(P, c.b))],
  [BANK_MAIN_MENU, 0x69DC, hook((P, c) => savedDataSourceCursorSpriteTask(P, c.sp - 2))],
  [BANK_MAIN_MENU, 0x6A7E, hook(P => drawSavedDataSourceGrid(P))],
  [BANK_MAIN_MENU, 0x6B0E, hook((P, c) => { fillSavedDataSourceCell(P, c.b, c.c); })],
  [BANK_MAIN_MENU, 0x6B4E, hook((P, c) => loadSavedDataSourceCellPalette(P, c.a))],
  [BANK_MAIN_MENU, 0x6B83, hook((P, c) => drawSavedDataSourceCaption(P, c.f))],
];
