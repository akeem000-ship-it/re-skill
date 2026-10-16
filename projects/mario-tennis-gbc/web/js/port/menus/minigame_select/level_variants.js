// Bank $1b: the minigame level select's panels (two levels on a choice-tab panel, RunMinigameLevelSelect2, the second
// refused while no level is cleared; three on the N64 record-type panel, RunMinigameLevelSelect3, once two are
// cleared) with their cursors, palettes and descriptions, and the saved-data type select (minigame records or the
// other kind, RunSavedDataTypeSelect) built the same way. See level_select.js for the WRAM 2 state bytes.
// Port of src/engine/menus/minigame_select/level_variants_1b.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own; tables, templates and graphics are read
// from the ROM.
// Tests: lockstep on out/port/mg_*.mtrec and minigame_*.mtrec (the two-level panel), out/port/ms_levels3.mtrec (the
// three-level panel, scripted with the levels cleared) and menus_status1.mtrec (the saved-data type select);
// web/tests/port/routines_menus_misc.mjs.
import {
  FZ, FAR, HOME, rom, romWait, home, farGen, wram, u8, w8, idx, sound, advanceFrame, registerFrameTask,
  clearFrameTasks, queueSpriteTemplate, fillTilemapRect, queueCopy, hook, hookGen, WRAM_COURT_PLANES, WRAM_SCREEN,
  TILEMAP_WIDTH, TILE_SIZE, VRAM_BANK1, vTiles0, vBGMap0, wShadowTilemap, wShadowAttrmap, wScreenAttrmap, OAM_BANK1,
  PADF_A, PADF_B, rIE, IE_TIMER, BGM_MENU, SFX_MENU_MOVE, SFX_MENU_SELECT, SFX_MENU_LOCKED, SFX_MENU_CANCEL,
  MENUSLIDE_BACK, MENUSLIDE_FORWARD,
} from "../equipment/defs.js";
import { moveMenuCursorGrid, getMenuCursorIndex, setMenuCursorFromIndex } from "../common/cursors.js";
import { openChoiceTabPanel, closeChoiceTabPanel } from "../equipment/choicetab.js";
import { loadChoiceTabGraphics } from "../equipment/racket_choice.js";
import {
  LEVEL_CLEARED, LEVEL_SHOWN, LEVEL_CHOSEN, levelState, loadMinigameLevelSelectPalette, drawMinigameLevelDescription,
} from "./level_select.js";
import { redrawSavedDataTypeSelect, TickMenuBgScrollTask_1b, DrawSavedDataTypeSelectCursor } from "./minigame_data.js";

export const BANK = 0x1B;
const rb = (P, a) => P.rom.u8(BANK, a & 0xFFFF), rw = (P, a) => P.rom.u16(BANK, a & 0xFFFF);
export const DrawMinigameLevelSelect2Cursor = 0x6F62, DrawMinigameLevelSelect3Cursor = 0x70ED;
const SelectPanelAttrRectTable = 0x6F5E, SelectPanelAttrRect3Table = 0x70E7;
const DrawMinigameLevelSelect2Cursor_SpriteTemplate0 = 0x6F9F, DrawMinigameLevelSelect2Cursor_SpriteTemplate1 = 0x6FC0;
const MinigameLevelSelect2CursorTable0 = 0x6FC9, MinigameLevelSelect2CursorTable1 = 0x6FCF;
const DrawMinigameLevelSelect3Cursor_SpriteTemplate0 = 0x712A, DrawMinigameLevelSelect3Cursor_SpriteTemplate1 = 0x714B;
const MinigameLevelSelect3CursorTable0 = 0x7154, MinigameLevelSelect3CursorTable1 = 0x715A;
const SavedDataTypeSelectGfx0 = 0x729A, SavedDataTypeSelectGfx1 = 0x729E;
const BANK_CHOICE_TAB = 0x3E;
const N64RecordTypeSlideIn = [0x3B, 0x72EC], N64RecordTypeSlideOut = [0x3B, 0x731E], ResumeBGM = 0x2F32;
const BGM_MARIO_MINIGAME = 0x08, LEVEL_COLUMNS = 3, PANEL_ACTIVE = 0x0C, PANEL_INACTIVE = 0x0D;
const CURSOR_LABEL_OFFSET = 0x17F8, CURSOR_LABEL_TILE = 0x70;
const FRAME_TOP = 0x03, FRAME_LEFT_CORNER = 0x02, FRAME_RIGHT_CORNER = 0x04, BLANK = 0x20;
const TILEBLOCK_SharedMenuGfx29 = 0x1D, TILEBLOCK_SharedMenuGfx30 = 0x1E, TILEBLOCK_SharedMenuGfx27 = 0x1B;
const TILEBLOCK_SavedDataTypeSelectGfx = 0x78;

const timerInterruptOff = P => P.bus.w8(rIE, P.bus.u8(rIE) & ~IE_TIMER);
const timerInterruptOn = P => P.bus.w8(rIE, P.bus.u8(rIE) | IE_TIMER);

// FlushLevelSelectTextRows (1B:6DC6): the panel's attribute rows (7-9) and the caption rows (15-16) queued
export function flushLevelSelectTextRows(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  queueCopy(P, wShadowAttrmap + 7 * TILEMAP_WIDTH, vBGMap0 + 7 * TILEMAP_WIDTH + VRAM_BANK1, 3 * TILEMAP_WIDTH / 16);
  const r = queueCopy(P, wShadowTilemap + 15 * TILEMAP_WIDTH, vBGMap0 + 15 * TILEMAP_WIDTH, 2 * TILEMAP_WIDTH / 16);
  wram(P, bank);
  return { ...r, a: bank, f: entryF };
}
// ClearMinigameLevelDescriptionRow (1B:6DEB): the caption row's frame and inside blank
export function clearMinigameLevelDescriptionRow(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  fillTilemapRect(P, wShadowTilemap + 15 * TILEMAP_WIDTH, 0x14, 0x01, FRAME_TOP);
  w8(P, wShadowTilemap + 15 * TILEMAP_WIDTH, FRAME_LEFT_CORNER);
  w8(P, wShadowTilemap + 15 * TILEMAP_WIDTH + 19, FRAME_RIGHT_CORNER);
  const r = fillTilemapRect(P, wShadowTilemap + 16 * TILEMAP_WIDTH + 1, 0x12, 0x01, BLANK);
  wram(P, bank);
  return { ...r, a: bank, f: entryF };
}
// GetMinigameLevelColumnCount (1B:6E1C): b = the levels shown (the cursor grid's width); af kept
export const getMinigameLevelColumnCount = P => ({ b: P.withWramBank(WRAM_COURT_PLANES, () => levelState(P, LEVEL_SHOWN)) });

// A level panel's loop: the cursor over the levels shown; A picks (refused by `locked`), B returns $FF (the choice
// into the state's [3]). open / close slide the panel, redraw redraws it.
function* runLevelPanel(P, { open, close, cols, cursorTask, redraw, locked }) {
  home(P, ResumeBGM);
  sound(P, BGM_MARIO_MINIGAME);
  timerInterruptOff(P);
  wram(P, WRAM_SCREEN);
  yield* open(P.V.menuSlideDirection);
  rom(P, FAR.InitMenuBgScroll);
  rom(P, FAR.LoadMenuSpritePalettePair, { b: 1, c: 1 });
  wram(P, WRAM_COURT_PLANES);
  setMenuCursorFromIndex(P, cols, levelState(P, LEVEL_CLEARED));
  wram(P, WRAM_SCREEN);
  registerFrameTask(P, 1, cursorTask);
  redraw(P);
  wram(P, WRAM_SCREEN);
  for (;;) {
    yield* advanceFrame(P);
    P.V.menuInputPressed = P.V.inputPressed;
    if (moveMenuCursorGrid(P, getMinigameLevelColumnCount(P).b, 1).a) { sound(P, SFX_MENU_MOVE); redraw(P); }
    const input = P.V.menuInputPressed;
    if (input & PADF_A) {
      if (locked(P)) { sound(P, SFX_MENU_LOCKED); continue; }
      sound(P, SFX_MENU_SELECT);
      clearFrameTasks(P);
      timerInterruptOn(P);
      wram(P, WRAM_SCREEN);
      yield* close(1);
      P.V.menuSlideDirection = MENUSLIDE_FORWARD;
      wram(P, WRAM_COURT_PLANES);
      const r = getMenuCursorIndex(P, LEVEL_COLUMNS);
      w8(P, wScreenAttrmap + LEVEL_CHOSEN, r.a);
      return r;
    }
    if (input & PADF_B) {
      sound(P, SFX_MENU_CANCEL);
      clearFrameTasks(P);
      timerInterruptOn(P);
      wram(P, WRAM_SCREEN);
      yield* close(0);
      P.V.menuSlideDirection = MENUSLIDE_BACK;
      wram(P, WRAM_COURT_PLANES);
      w8(P, wScreenAttrmap + LEVEL_CHOSEN, 0xFF);
      return { a: 0xFF };
    }
  }
}
// RunMinigameLevelSelect2 (1B:6E31): two levels on bank $3e's choice-tab panel; the second (any but the first) is
// locked while no level is cleared (the check leaves WRAM 2 mapped)
export const runMinigameLevelSelect2 = P => runLevelPanel(P, {
  open: dir => farGen(P, BANK_CHOICE_TAB, openChoiceTabPanel(P, dir)),
  close: fwd => farGen(P, BANK_CHOICE_TAB, closeChoiceTabPanel(P, fwd)),
  cols: 2, cursorTask: DrawMinigameLevelSelect2Cursor, redraw: redrawMinigameLevelSelect2,
  locked: P => {
    if (!getMenuCursorIndex(P, LEVEL_COLUMNS).a) return false;
    wram(P, WRAM_COURT_PLANES);
    return !levelState(P, LEVEL_CLEARED);
  },
});
// RunMinigameLevelSelect3 (1B:6FD2): three levels on bank $3b's N64 record-type panel
export const runMinigameLevelSelect3 = P => runLevelPanel(P, {
  open: dir => romWait(P, N64RecordTypeSlideIn, { b: dir }), close: fwd => romWait(P, N64RecordTypeSlideOut, { b: fwd }),
  cols: 3, cursorTask: DrawMinigameLevelSelect3Cursor, redraw: redrawMinigameLevelSelect3, locked: () => false,
});
// a panel's redraw: its tabs' attributes (the cursor's active), the level's palette, description and rows queued
function redrawLevelPanel(P, tabs, setAttr) {
  wram(P, WRAM_SCREEN);
  for (let tab = 0; tab < tabs; tab++) setAttr(P, tab, 0);
  setAttr(P, getMenuCursorIndex(P, 2).a, 1);
  loadMinigameLevelSelectPalette(P, getMenuCursorIndex(P, LEVEL_COLUMNS).a);
  clearMinigameLevelDescriptionRow(P);
  drawMinigameLevelDescription(P);
  return flushLevelSelectTextRows(P);
}
// RedrawMinigameLevelSelect2 (1B:6F04) / RedrawMinigameLevelSelect3 (1B:708D)
export const redrawMinigameLevelSelect2 = P => redrawLevelPanel(P, 2, setSelectPanelAttrRect);
export const redrawMinigameLevelSelect3 = P => redrawLevelPanel(P, 3, setSelectPanelAttrRect3);
// SetSelectPanelAttrRect (1B:6F35) / SetSelectPanelAttrRect3 (1B:70BE): panel tab b's 5 x 3 attributes, active
// (c != 0: $0C) or not ($0D). Registers kept.
export function setSelectPanelAttrRect(P, tab, active) {
  fillTilemapRect(P, rw(P, idx(SelectPanelAttrRectTable, tab * 2)), 0x05, 0x03, active ? PANEL_ACTIVE : PANEL_INACTIVE);
}
export function setSelectPanelAttrRect3(P, tab, active) {
  fillTilemapRect(P, rw(P, idx(SelectPanelAttrRect3Table, tab * 2)), 0x05, 0x03, active ? PANEL_ACTIVE : PANEL_INACTIVE);
}
// a panel's cursor (frame task): the menu background's scroll; the cursor over the hovered tab (its tile and place,
// bobbing) and its label sprite
function drawLevelCursor(P, places, tiles, template0, template1) {
  rom(P, FAR.TickMenuBgScroll);
  const cell = getMenuCursorIndex(P, LEVEL_COLUMNS).a;
  const tile = rb(P, idx(tiles, cell)), pos = rw(P, idx(places, cell * 2));
  const { d, e } = rom(P, FAR.ApplySpriteBobOffset, { c: tile, d: pos >> 8, e: pos & 0xFF });
  queueSpriteTemplate(P, template0, d, e, tile, OAM_BANK1);
  const de = ((d << 8 | e) + CURSOR_LABEL_OFFSET) & 0xFFFF;
  return queueSpriteTemplate(P, template1, de >> 8, de & 0xFF, CURSOR_LABEL_TILE, OAM_BANK1);
}
// DrawMinigameLevelSelect2Cursor (1B:6F62) / DrawMinigameLevelSelect3Cursor (1B:70ED)
export const drawMinigameLevelSelect2Cursor = P => drawLevelCursor(P, MinigameLevelSelect2CursorTable0,
  MinigameLevelSelect2CursorTable1, DrawMinigameLevelSelect2Cursor_SpriteTemplate0, DrawMinigameLevelSelect2Cursor_SpriteTemplate1);
export const drawMinigameLevelSelect3Cursor = P => drawLevelCursor(P, MinigameLevelSelect3CursorTable0,
  MinigameLevelSelect3CursorTable1, DrawMinigameLevelSelect3Cursor_SpriteTemplate0, DrawMinigameLevelSelect3Cursor_SpriteTemplate1);

// ---- the saved-data type select ----
// RunSavedDataTypeSelect (1B:715D), slot $4028: two tabs on bank $3e's choice-tab panel, the cursor on the last
// choice (wSavedDataTypeTabIndex); A returns the tab, B $FF (WRAM 2 mapped)
export function* runSavedDataTypeSelect(P) {
  sound(P, BGM_MENU);
  timerInterruptOff(P);
  yield* loadSavedDataTypeSelectGfx(P);
  wram(P, WRAM_SCREEN);
  yield* farGen(P, BANK_CHOICE_TAB, openChoiceTabPanel(P, P.V.menuSlideDirection));
  rom(P, FAR.InitMenuBgScroll);
  rom(P, FAR.LoadMenuSpritePalettePair, { b: 1, c: 1 });
  setMenuCursorFromIndex(P, 2, P.V.savedDataTypeTabIndex);
  registerFrameTask(P, 1, TickMenuBgScrollTask_1b);
  registerFrameTask(P, 1, DrawSavedDataTypeSelectCursor);
  redrawSavedDataTypeSelect(P);
  wram(P, WRAM_SCREEN);
  for (;;) {
    yield* advanceFrame(P);
    P.V.menuInputPressed = P.V.inputPressed;
    if (moveMenuCursorGrid(P, 2, 1).a) { sound(P, SFX_MENU_MOVE); redrawSavedDataTypeSelect(P); }
    const input = P.V.menuInputPressed;
    if (input & PADF_A) {
      sound(P, SFX_MENU_SELECT);
      clearFrameTasks(P);
      timerInterruptOn(P);
      wram(P, WRAM_SCREEN);
      yield* farGen(P, BANK_CHOICE_TAB, closeChoiceTabPanel(P, 1));
      P.V.menuSlideDirection = MENUSLIDE_FORWARD;
      const r = getMenuCursorIndex(P, 2);
      P.V.savedDataTypeTabIndex = r.a;
      return r;
    }
    if (input & PADF_B) {
      sound(P, SFX_MENU_CANCEL);
      clearFrameTasks(P);
      timerInterruptOn(P);
      wram(P, WRAM_SCREEN);
      yield* farGen(P, BANK_CHOICE_TAB, closeChoiceTabPanel(P, 0));
      P.V.menuSlideDirection = MENUSLIDE_BACK;
      wram(P, WRAM_COURT_PLANES);
      return { a: 0xFF };
    }
  }
}
// LoadSavedDataTypeSelectGfx (1B:720A): the two tabs' labels, the panel's tiles, the cursor palette
export function* loadSavedDataTypeSelectGfx(P, entryF = P.cpu.f) {
  return yield* loadChoiceTabGraphics(P, SavedDataTypeSelectGfx0, SavedDataTypeSelectGfx1, [
    [TILEBLOCK_SharedMenuGfx29, 0x10, vTiles0 + VRAM_BANK1, 1],
    [TILEBLOCK_SharedMenuGfx30, 0x12, vTiles0 + 0x10 * TILE_SIZE + VRAM_BANK1, 1],
    [TILEBLOCK_SharedMenuGfx27, 0x04, vTiles0 + 0x70 * TILE_SIZE + VRAM_BANK1, 1],
    [TILEBLOCK_SavedDataTypeSelectGfx, 0x14, vTiles0, 1],
  ], entryF);
}

export const HOOKS = [
  [BANK, 0x6DC6, hook((P, c) => flushLevelSelectTextRows(P, c.f))],
  [BANK, 0x6DEB, hook((P, c) => clearMinigameLevelDescriptionRow(P, c.f))],
  [BANK, 0x6E1C, hook(P => getMinigameLevelColumnCount(P))],
  [BANK, 0x6E31, hookGen(P => runMinigameLevelSelect2(P))],
  [BANK, 0x6F04, hook(P => redrawMinigameLevelSelect2(P))],
  [BANK, 0x6F35, hook((P, c) => { setSelectPanelAttrRect(P, c.b, c.c); })],
  [BANK, 0x6F62, hook(P => drawMinigameLevelSelect2Cursor(P))],
  [BANK, 0x6FD2, hookGen(P => runMinigameLevelSelect3(P))],
  [BANK, 0x708D, hook(P => redrawMinigameLevelSelect3(P))],
  [BANK, 0x70BE, hook((P, c) => { setSelectPanelAttrRect3(P, c.b, c.c); })],
  [BANK, 0x70ED, hook(P => drawMinigameLevelSelect3Cursor(P))],
  [BANK, 0x715D, hookGen(P => runSavedDataTypeSelect(P))],
  [BANK, 0x720A, hookGen((P, c) => loadSavedDataTypeSelectGfx(P, c.f))],
];
