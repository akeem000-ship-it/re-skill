// The tabbed choice panels of bank $3e and the equipment status screen. A choice panel (two tabs over the menu
// background, sliding in and out a step a frame: the menu library's panels $10 / $11) serves the racket-or-shoes
// choice (racket_choice.js) and the play-alone partner menu (RunPlayAlonePartnerMenu: alone or with a partner, which
// sets FLAG_DOUBLES), with a bobbing cursor sprite over the chosen tab (ChoiceTabCursorSpriteTask). The equipment
// status screen (ShowEquipmentStatusScreen) shows the racket and shoes equipped with their stat changes, until A or B.
// Port of src/engine/menus/equipment/choicetab_3e.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own; templates, tables, palettes and graphics are
// read from the ROM.
// Tests: lockstep on out/port/menus_file1.mtrec (racket-or-shoes), save1.mtrec and out/engine/rec2.mtrec (partner
// menu), story_pause_items.mtrec (status screen) and out/port/eq_*.mtrec; web/tests/port/routines_menus_misc.mjs.
import {
  FZ, FAR, rom, romWait, near, wram, w8, sound, advanceFrame, registerFrameTask, clearFrameTasks, queueSpriteTemplate,
  loadPaletteShadow, enableLCD, fadeIn, fadeOut, fillTilemapRect, loadCompressedTileBlock, loadScreenAssetRecord,
  queueWram3MapToVRAM, prepareGlyphBuffer, disableLCDSafely, setFlag, clearFlag, hook, hookGen, orFlags, WRAM_SCREEN,
  WRAM_TEXT, TILEMAP_WIDTH, TILE_SIZE, VRAM_BANK1, vTiles0, vTiles2, wShadowAttrmap, wScreenScratch, OAM_BANK1,
  PADF_A, PADF_B, rIE, IE_TIMER, BGM_MENU, SFX_MENU_MOVE, SFX_MENU_SELECT, SFX_MENU_CANCEL, MENUSLIDE_BACK,
  MENUSLIDE_FORWARD, FLAG_DOUBLES,
} from "./defs.js";
import { clearMemory16 } from "../../home/memory.js";
import { moveMenuCursorGrid, getMenuCursorIndex } from "../common/cursors.js";
import { drawTextWindow, loadChoiceTabGraphics, redrawChoiceTabMenu } from "./racket_choice.js";
import { drawEquippedRacketPanel, drawEquippedShoesPanel } from "./racket_select.js";

export const BANK = 0x3E;
export const ChoiceTabCursorSpriteTask = 0x50F5;
const rb = (P, a) => P.rom.u8(BANK, a & 0xFFFF), rw = (P, a) => P.rom.u16(BANK, a & 0xFFFF);
const ChoiceTabCursorSpriteTask_SpriteTemplate0 = 0x5132, ChoiceTabCursorSpriteTask_SpriteTemplate1 = 0x5153;
const ChoiceTabCursorPositions_3e = 0x515C, ChoiceTabCursorTiles_3e = 0x5162, ChoiceTabAttrAddrs_3e = 0x518E;
const PlayAlonePartnerGfxParams_3e = 0x52AF, PlayAlonePartnerGfxDests_3e = 0x52B3;
const PlayAlonePartnerPalettePtrs = 0x5333, PlayAlonePartnerCaptionDests_3e = 0x5384;
const Text_30_226 = 0x00E2;
const SCREENASSET_EquipmentSelect = 0x21;
const TILEBLOCK_SharedMenuGfx17Alias17 = 0x11, SharedMenuGfx17_BLOCKS = 0x10;
const TILEBLOCK_SharedMenuGfx35 = 0x23, TILEBLOCK_SharedMenuGfx36 = 0x24, TILEBLOCK_SharedMenuGfx27 = 0x1B;
const PANEL_TABS_IN = 0x10, PANEL_TABS_OUT = 0x11, FLUSH_LAYOUT_TABS = 3;
const TAB_ATTR_ACTIVE = 0x0C, TAB_ATTR_INACTIVE = 0x0D, CHOICE_TABS = 2, BG_PALETTE_4 = 4;
const TAB_LABEL_OFFSET = 0x17F8, TAB_LABEL_TILE = 0x70;     // the cursor's label sprite: (+$17, -8) from the cursor
const STATUS_ATTR = 0x08;                                    // the stat rows' attributes (palette 0, VRAM bank 1)

const timerInterruptOff = P => P.bus.w8(rIE, P.bus.u8(rIE) & ~IE_TIMER);
const timerInterruptOn = P => P.bus.w8(rIE, P.bus.u8(rIE) | IE_TIMER);
const setMenuCursorFromIndex3e = (P, cols, index) => near(P, FAR.SetMenuCursorFromIndex_3e[1], { b: cols, c: index });
// a step of a choice panel: the menu background with panel `panel` at step c, the rows flushed (it waits a frame)
function* panelStep(P, panel, step) {
  yield* advanceFrame(P);
  rom(P, FAR.RestoreMenuBgAndDrawPanel, { b: panel, c: step });
  return yield* romWait(P, FAR.FlushWram3MapRows, { b: FLUSH_LAYOUT_TABS });
}

// OpenChoiceTabPanel (3E:5092): the panel sliding in, forward (b != 0: panel $10 steps 0-11) or back (panel $11
// steps 8-0). Leaves a = c = the step after the last.
export function* openChoiceTabPanel(P, forward) {
  let c;
  if (forward) for (c = 0; c !== 0x0C; c++) yield* panelStep(P, PANEL_TABS_IN, c);
  else for (c = 0x08; c !== 0xFF; c = (c - 1) & 0xFF) yield* panelStep(P, PANEL_TABS_OUT, c);
  return { a: c, c, f: FZ | 0x40 };
}
// CloseChoiceTabPanel (3E:50C4): the panel sliding out, forward (panel $11 steps 0-9) or back (panel $10 steps 12-1)
export function* closeChoiceTabPanel(P, forward) {
  let c;
  if (forward) { for (c = 0; c !== 0x0A; c++) yield* panelStep(P, PANEL_TABS_OUT, c); return { a: c, c, f: FZ | 0x40 }; }
  for (c = 0x0C; c; c--) yield* panelStep(P, PANEL_TABS_IN, c);
  return { a: 0, c: 0, f: FZ };
}
// ChoiceTabCursorSpriteTask (3E:50F5), a frame task: the menu background's scroll; the cursor over its tab (the
// tab's tile and place, bobbing) and the tab's label sprite below it
export function choiceTabCursorSpriteTask(P) {
  rom(P, FAR.TickMenuBgScroll);
  const tab = getMenuCursorIndex(P, CHOICE_TABS).a;
  const tile = rb(P, ChoiceTabCursorTiles_3e + tab), pos = rw(P, ChoiceTabCursorPositions_3e + ((tab * 2) & 0xFF));
  const { d, e } = rom(P, FAR.ApplySpriteBobOffset, { c: tile, d: pos >> 8, e: pos & 0xFF });
  queueSpriteTemplate(P, ChoiceTabCursorSpriteTask_SpriteTemplate0, d, e, tile, OAM_BANK1);
  const de = ((d << 8 | e) + TAB_LABEL_OFFSET) & 0xFFFF;
  return queueSpriteTemplate(P, ChoiceTabCursorSpriteTask_SpriteTemplate1, de >> 8, de & 0xFF, TAB_LABEL_TILE, OAM_BANK1);
}
// SetChoiceTabAttrRect (3E:5165): tab b's 5 x 3 attribute rect, active (c != 0: $0C) or not ($0D). Registers kept.
// (Callers pass tabs 0-2: the table has two entries, the third address is read from the code after it.)
export function setChoiceTabAttrRect(P, tab, active) {
  fillTilemapRect(P, rw(P, ChoiceTabAttrAddrs_3e + ((tab * 2) & 0xFF)), 0x05, 0x03, active ? TAB_ATTR_ACTIVE : TAB_ATTR_INACTIVE);
}

// ---- the play-alone partner menu ----
// RunPlayAlonePartnerMenu (3E:5192), slot $400A: alone (0) or with a partner (1, FLAG_DOUBLES set); returns the
// choice, or $FF for B
export function* runPlayAlonePartnerMenu(P) {
  sound(P, BGM_MENU);
  timerInterruptOff(P);
  yield* loadPlayAlonePartnerGraphics(P);
  wram(P, WRAM_SCREEN);
  yield* openChoiceTabPanel(P, P.V.menuSlideDirection);
  rom(P, FAR.InitMenuBgScroll);
  rom(P, FAR.LoadMenuSpritePalettePair, { b: 1, c: 1 });
  setMenuCursorFromIndex3e(P, CHOICE_TABS, 0);
  registerFrameTask(P, 1, ChoiceTabCursorSpriteTask);
  redrawPlayAlonePartnerMenu(P);
  wram(P, WRAM_SCREEN);
  for (;;) {
    yield* advanceFrame(P);
    P.V.menuInputPressed = P.V.inputPressed;
    if (moveMenuCursorGrid(P, CHOICE_TABS, 1).a) { sound(P, SFX_MENU_MOVE); redrawPlayAlonePartnerMenu(P); }
    const input = P.V.menuInputPressed;
    if (input & PADF_A) {
      sound(P, SFX_MENU_SELECT);
      clearFrameTasks(P);
      timerInterruptOn(P);
      yield* closeChoiceTabPanel(P, 1);
      P.V.menuSlideDirection = MENUSLIDE_FORWARD;
      const choice = getMenuCursorIndex(P, CHOICE_TABS).a;
      clearFlag(P, FLAG_DOUBLES);
      if (choice) setFlag(P, FLAG_DOUBLES);
      return { a: choice, f: orFlags(choice) };
    }
    if (input & PADF_B) {
      sound(P, SFX_MENU_CANCEL);
      clearFrameTasks(P);
      timerInterruptOn(P);
      yield* closeChoiceTabPanel(P, 0);
      P.V.menuSlideDirection = MENUSLIDE_BACK;
      return { a: 0xFF };
    }
  }
}
// LoadPlayAlonePartnerGraphics (3E:5229): the two tabs' labels, the tab, cursor and panel tiles, the cursor palette
export function* loadPlayAlonePartnerGraphics(P, entryF = P.cpu.f) {
  return yield* loadChoiceTabGraphics(P, PlayAlonePartnerGfxParams_3e, PlayAlonePartnerGfxDests_3e, [
    [TILEBLOCK_SharedMenuGfx35, 0x10, vTiles0 + VRAM_BANK1, 1],
    [TILEBLOCK_SharedMenuGfx36, 0x10, vTiles0 + 0x10 * TILE_SIZE + VRAM_BANK1, 1],
    [TILEBLOCK_SharedMenuGfx27, 0x04, vTiles0 + 0x70 * TILE_SIZE + VRAM_BANK1, 2],
  ], entryF);
}
// RedrawPlayAlonePartnerMenu (3E:52B7)
export const redrawPlayAlonePartnerMenu = P => redrawChoiceTabMenu(P, setPlayAlonePartnerPalette, drawPlayAlonePartnerCaption);
// SetPlayAlonePartnerPalette (3E:5320): BG palette 4 from the choice's entry of PlayAlonePartnerPalettePtrs
export function setPlayAlonePartnerPalette(P, tab) {
  return loadPaletteShadow(P, rw(P, PlayAlonePartnerPalettePtrs + ((tab * 2) & 0xFF)), BG_PALETTE_4, 1);
}
// DrawPlayAlonePartnerCaption (3E:5355): the choice's caption (Text_30_226 + choice) at its place
export function drawPlayAlonePartnerCaption(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  const tab = getMenuCursorIndex(P, CHOICE_TABS).a;
  const r = rom(P, FAR.RenderTextToBuffer64, { hl: Text_30_226 + tab, de: rw(P, PlayAlonePartnerCaptionDests_3e + ((tab * 2) & 0xFF)), c: 0x20 });
  wram(P, bank);
  return { ...r, a: bank, b: tab, f: entryF };
}

// ---- the equipment status screen ----
// ShowEquipmentStatusScreen (3E:5388), slot $4010: fade out, the screen drawn with the LCD off, fade in; on A or B
// (checked before each frame), SFX_MENU_SELECT and fade out
export function* showEquipmentStatusScreen(P) {
  clearFrameTasks(P);
  yield* fadeOut(P, 16);
  yield* advanceFrame(P);
  yield* advanceFrame(P);
  disableLCDSafely(P);
  rom(P, FAR.LoadMenuFontGfx);
  P.V.scrollX = 0;
  P.V.scrollY = 0;
  drawEquipmentStatusScreen(P);
  enableLCD(P);
  yield* fadeIn(P, 16);
  while (!(P.V.inputPressed & (PADF_A | PADF_B))) yield* advanceFrame(P);
  sound(P, SFX_MENU_SELECT);
  clearFrameTasks(P);
  return yield* fadeOut(P, 16);
}
// DrawEquipmentStatusScreen (3E:53CF): the windows, then the racket's and the shoes' panels (the item list buffer
// cleared first), the glyphs uploaded and the screen queued
export function drawEquipmentStatusScreen(P) {
  loadEquipmentStatusWindows(P);
  prepareGlyphBuffer(P);
  wram(P, WRAM_SCREEN);
  clearMemory16(P, wScreenScratch, 3);
  drawEquippedRacketPanel(P);
  drawEquippedShoesPanel(P);
  rom(P, FAR.UploadGlyphBuffer);
  return queueWram3MapToVRAM(P);
}
// LoadEquipmentStatusWindows (3E:53F1): the equipment screen asset, the font, two 20 x 9 windows (racket over shoes)
// and their stat rows' attributes
export function loadEquipmentStatusWindows(P) {
  loadScreenAssetRecord(P, SCREENASSET_EquipmentSelect);
  rom(P, FAR.ResetTextWindowState);
  loadCompressedTileBlock(P, TILEBLOCK_SharedMenuGfx17Alias17, vTiles2, SharedMenuGfx17_BLOCKS);
  wram(P, WRAM_TEXT);
  P.V.shadowTilemapBank = WRAM_SCREEN;
  P.V.windowTileAttr = 0;
  drawTextWindow(P, 0x00, 0x00, 0x14, 0x09);
  drawTextWindow(P, 0x00, 0x09, 0x14, 0x09);
  return setEquipmentStatusAttrRects(P);
}
// SetEquipmentStatusAttrRects (3E:5439): the two panels' stat rows (18 x 5) in attribute $08
export function setEquipmentStatusAttrRects(P) {
  wram(P, WRAM_SCREEN);
  fillTilemapRect(P, wShadowAttrmap + 12 * TILEMAP_WIDTH + 1, 0x12, 0x05, STATUS_ATTR);
  return fillTilemapRect(P, wShadowAttrmap + 3 * TILEMAP_WIDTH + 1, 0x12, 0x05, STATUS_ATTR);
}

export const HOOKS = [
  [BANK, 0x5092, hookGen((P, c) => openChoiceTabPanel(P, c.b))],
  [BANK, 0x50C4, hookGen((P, c) => closeChoiceTabPanel(P, c.b))],
  [BANK, 0x50F5, hook(P => choiceTabCursorSpriteTask(P))],
  [BANK, 0x5165, hook((P, c) => { setChoiceTabAttrRect(P, c.b, c.c); })],
  [BANK, 0x5192, hookGen(P => runPlayAlonePartnerMenu(P))],
  [BANK, 0x5229, hookGen((P, c) => loadPlayAlonePartnerGraphics(P, c.f))],
  [BANK, 0x52B7, hook(P => redrawPlayAlonePartnerMenu(P))],
  [BANK, 0x5320, hook((P, c) => setPlayAlonePartnerPalette(P, c.a))],
  [BANK, 0x5355, hook((P, c) => drawPlayAlonePartnerCaption(P, c.f))],
  [BANK, 0x5388, hookGen(P => showEquipmentStatusScreen(P))],
  [BANK, 0x53CF, hook(P => drawEquipmentStatusScreen(P))],
  [BANK, 0x53F1, hook(P => loadEquipmentStatusWindows(P))],
  [BANK, 0x5439, hook(P => setEquipmentStatusAttrRects(P))],
];
