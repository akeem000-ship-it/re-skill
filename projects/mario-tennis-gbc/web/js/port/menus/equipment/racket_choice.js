// Two small menus of bank $3e: the erase-data warning (RunEraseDataConfirmMenu: a warning screen with a flashing
// frame and a yes / no cursor, its texts by variant: a story slot, a saved character, or a third kind with its own
// picture) and the story's racket-or-shoes choice (RunRacketShoesChoiceMenu: two tabs on a menu panel, each with its
// palette and caption; returns the tab, remembered in wRacketShoesTabIndex).
// Port of src/engine/menus/equipment/racket_choice_3e.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own; palettes, tables and graphics are read
// from the ROM.
// Tests: lockstep on out/port/menus_erase1.mtrec, save1.mtrec, menus_file1.mtrec and out/port/eq_all.mtrec (scripted
// from a story state: the warning's three variants, the choice's two answers); web/tests/port/routines_menus_misc.mjs.
import {
  FZ, FAR, rom, near, nested, chain, addFlags, wram, w8, sound, advanceFrame, registerFrameTask, clearFrameTasks,
  queueVRAMCopy, queueSprite, loadPaletteShadow, enableLCD, fadeIn, fadeOut, fillTilemapRect, loadCompressedTileBlock,
  loadScreenAssetRecord, queueWram3MapToVRAM, prepareGlyphBuffer, uploadGlyphBuffer, renderProportionalTextAt,
  disableLCDSafely, hook, hookGen, WRAM_STAGING, WRAM_SCREEN, WRAM_TEXT, TILEMAP_WIDTH, TILE_SIZE, VRAM_BANK1,
  vTiles0, vTiles2, vBGMap0, wDecompBuffer, wShadowTilemap, wShadowAttrmap, OAM_BANK1, PADF_A, PADF_B, PADF_UP,
  PADF_DOWN, rIE, IE_TIMER, BGM_MENU, SFX_MENU_MOVE, SFX_MENU_SELECT, SFX_MENU_DECIDE, SFX_MENU_CANCEL,
  MENUSLIDE_BACK, MENUSLIDE_FORWARD,
} from "./defs.js";
import { copyMemoryBC } from "../../home/memory.js";
import { decompressDataFromBank as homeDecompressFromBank } from "../../home/decompress.js";
import { moveMenuCursorGrid, getMenuCursorIndex } from "../common/cursors.js";
import {
  openChoiceTabPanel, closeChoiceTabPanel, setChoiceTabAttrRect, ChoiceTabCursorSpriteTask,
} from "./choicetab.js";

export const BANK = 0x3E;
export const UpdateAnimatedTiles_3e = 0x4438, EraseConfirmCursorSpriteTask = 0x4E0C, AnimateEraseConfirmPalette = 0x4E34;
const rw = (P, a) => P.rom.u16(BANK, a);
const EraseConfirmPalette_3e = 0x4E80, EraseConfirmFlashColors_3e = 0x4E88, ERASE_FLASH_STEPS = 12;
const RacketShoesChoiceGfxParams_3e = 0x4FC3, RacketShoesChoiceGfxDests_3e = 0x4FC9;
const RacketShoesChoicePalettePtrs = 0x504B;
const SCREENASSET_WarningScreen = 0x10;
const TILEBLOCK_SharedMenuGfx17Alias17 = 0x11, SharedMenuGfx17_BLOCKS = 0x10;
const TILEBLOCK_SharedMenuGfx65 = 0x41, TILEBLOCK_EraseDataConfirmGfx0 = 0x45, TILEBLOCK_EraseDataConfirmGfx1 = 0x46;
const ERASE_PICTURE_BLOCKS = 0x14;
const TILEBLOCK_RacketShoesChoiceGfx0 = 0x4A, TILEBLOCK_RacketShoesChoiceGfx1 = 0x4B, TILEBLOCK_SharedMenuGfx27 = 0x1B;
const TILEBLOCK_RacketShoesChoiceGfx2 = 0x4C;
// the warning's texts by variant (wScreenScratch): two message lines, the line before the answers, then the
// question (Text_30_220) and the answers (Text_30_122 / 123)
const ERASE_TEXTS = { 0: [0x00D6, 0x00D7, 0x00DA], 1: [0x00D8, 0x00D9, 0x00DB], 2: [0x00DD, 0x00DE, 0x00DF] };
const ERASE_PICTURES = { 0: TILEBLOCK_EraseDataConfirmGfx1, 1: TILEBLOCK_EraseDataConfirmGfx0, 2: TILEBLOCK_SharedMenuGfx65 };
const Text_30_220 = 0x00DC, Text_30_122 = 0x007A, Text_30_123 = 0x007B, Text_30_224 = 0x00E0;
const ERASE_VARIANT_OTHER = 0x02;                       // any value but 0 and 2 shows variant 1's texts
const DIGIT_SPRITE_ATTR = 0x0A, DIGIT_SPRITE_TILE_BASE = 0x10;
const BOX_TEXT_WIDTH = 0x0E, ANSWER_WIDTH = 0x04;
const CURSOR_YES = 0x7376, CURSOR_NO = 0x7386;          // the hand cursor's (x, y) by answer
const BG_PALETTE_4 = 4, CHOICE_TABS = 2, CHOICE_CAPTION_ROW = 16;
const TAB_ATTR_ACTIVE = 1, TAB_ATTR_INACTIVE = 0, CHOICE_TAB_SLOTS = 3;
const FRAME_TOP = 0x03, FRAME_LEFT_CORNER = 0x02, FRAME_RIGHT_CORNER = 0x04, BLANK = 0x20;

const timerInterruptOff = P => P.bus.w8(rIE, P.bus.u8(rIE) & ~IE_TIMER);
const timerInterruptOn = P => P.bus.w8(rIE, P.bus.u8(rIE) | IE_TIMER);
const setMenuCursorFromIndex3e = (P, cols, index) => near(P, FAR.SetMenuCursorFromIndex_3e[1], { b: cols, c: index });
// a text window over a screen rect (rect_cell x, y / rect_size w, h)
export function drawTextWindow(P, x, y, w, h) {
  rom(P, FAR.CreateWindowFromScreenRect, { d: x, e: y, b: w, c: h });
  rom(P, FAR.DrawTextWindowFrame);
  return rom(P, FAR.RedrawWindowRows);
}

// ---- the erase-data warning ----
// RunEraseDataConfirmMenu (3E:4C12), slot $4006: the warning for variant b (0: a story slot, 1: a saved character,
// 2: the third kind), the cursor on "no". A on "yes" returns a = 1; B, or A on "no", returns 0 (both fade out).
export function* runEraseDataConfirmMenu(P, variant) {
  timerInterruptOff(P);
  wram(P, WRAM_SCREEN);
  P.V.screenScratch = variant;
  disableLCDSafely(P);
  clearFrameTasks(P);
  yield* loadEraseDataConfirmScreen(P);
  P.V.animatedTileSet = 0;
  registerFrameTask(P, 1, UpdateAnimatedTiles_3e);
  registerFrameTask(P, 1, EraseConfirmCursorSpriteTask);
  animateEraseConfirmPalette(P);
  enableLCD(P);
  yield* fadeIn(P, 8);
  registerFrameTask(P, 1, AnimateEraseConfirmPalette);
  wram(P, WRAM_SCREEN);
  for (;;) {
    yield* advanceFrame(P);
    const input = P.V.inputPressed;
    P.V.menuInputPressed = input;
    if (input & PADF_A && P.V.menuCursorY === 0) {
      sound(P, SFX_MENU_DECIDE);
      return yield* closeEraseConfirm(P, 1);
    }
    if (input & (PADF_A | PADF_B)) {
      sound(P, SFX_MENU_CANCEL);
      return yield* closeEraseConfirm(P, 0);
    }
    if (input & (PADF_UP | PADF_DOWN)) {
      P.V.menuCursorY ^= 1;
      sound(P, SFX_MENU_MOVE);
    }
    if (P.menuWheel && P.menuWheel.on) P.menuWheel.skin = { id: "confirm", at: P.frames, sel: P.V.menuCursorY, texts: [...ERASE_TEXTS[variant === ERASE_VARIANT_OTHER ? 2 : variant ? 1 : 0], Text_30_220] };   // MENU: Wheel (menuskins.js: the warning's own words), read only
  }
}
function* closeEraseConfirm(P, answer) {
  timerInterruptOn(P);
  clearFrameTasks(P);
  yield* fadeOut(P, 16);
  return answer ? { a: 1 } : { a: 0, f: FZ };
}
// LoadEraseDataConfirmScreen (3E:4CAF): the cursor on "no" (cell 1 of a 1-wide list), the hand cursor's tiles, the
// warning screen with its message box cleared, the font, the message and answer windows, the menu background's
// scroll and sprite palettes, then the variant's texts and picture and the answers (the screen queued)
export function* loadEraseDataConfirmScreen(P) {
  setMenuCursorFromIndex3e(P, 1, 1);
  rom(P, FAR.LoadMenuHandCursorGfx, { hl: vTiles0 + VRAM_BANK1, de: 0x0801 });
  P.V.digitSpriteAttr = DIGIT_SPRITE_ATTR;
  P.V.digitSpriteTileBase = DIGIT_SPRITE_TILE_BASE;
  loadScreenAssetRecord(P, SCREENASSET_WarningScreen);
  wram(P, WRAM_SCREEN);
  fillTilemapRect(P, wShadowAttrmap + 5 * TILEMAP_WIDTH + 3, 0x0E, 0x06, 0x00);
  fillTilemapRect(P, wShadowTilemap + 5 * TILEMAP_WIDTH + 3, 0x0E, 0x06, BLANK);
  rom(P, FAR.ResetTextWindowState);
  loadCompressedTileBlock(P, TILEBLOCK_SharedMenuGfx17Alias17, vTiles2, SharedMenuGfx17_BLOCKS);
  wram(P, WRAM_TEXT);
  P.V.shadowTilemapBank = WRAM_SCREEN;
  P.V.windowTileAttr = 0;
  drawTextWindow(P, 0x00, 0x0D, 0x0F, 0x05);
  drawTextWindow(P, 0x0F, 0x0D, 0x05, 0x05);
  rom(P, FAR.InitMenuBgScroll);
  rom(P, FAR.LoadMenuSpritePalettePair, { b: 1, c: 1 });
  prepareGlyphBuffer(P);
  wram(P, WRAM_SCREEN);
  const variant = P.V.screenScratch;
  const v = variant === ERASE_VARIANT_OTHER ? 2 : variant ? 1 : 0, [line1, line2, line3] = ERASE_TEXTS[v];
  yield* renderProportionalTextAt(P, line1, wShadowTilemap + 6 * TILEMAP_WIDTH + 3, BOX_TEXT_WIDTH);
  yield* renderProportionalTextAt(P, line2, wShadowTilemap + 8 * TILEMAP_WIDTH + 3, BOX_TEXT_WIDTH);
  yield* renderProportionalTextAt(P, line3, wShadowTilemap + 14 * TILEMAP_WIDTH + 2, BOX_TEXT_WIDTH);
  yield* renderProportionalTextAt(P, Text_30_220, wShadowTilemap + 16 * TILEMAP_WIDTH + 2, BOX_TEXT_WIDTH);
  loadCompressedTileBlock(P, ERASE_PICTURES[v], vTiles0, ERASE_PICTURE_BLOCKS);
  yield* renderProportionalTextAt(P, Text_30_122, wShadowTilemap + 14 * TILEMAP_WIDTH + 16, ANSWER_WIDTH);
  yield* renderProportionalTextAt(P, Text_30_123, wShadowTilemap + 16 * TILEMAP_WIDTH + 16, ANSWER_WIDTH);
  yield* uploadGlyphBuffer(P);
  return queueWram3MapToVRAM(P);
}
// EraseConfirmCursorSpriteTask (3E:4E0C), a frame task: the hand cursor by the answer under it
export function eraseConfirmCursorSpriteTask(P) {
  const de = P.V.menuCursorY ? CURSOR_NO : CURSOR_YES;
  return nested(P, 1, () => queueEraseConfirmCursorSprites(P, de, P.V.menuCursorY));
}
// QueueEraseConfirmCursorSprites (3E:4E1C): the hand (two sprites side by side, tiles 0 and 2) at de, then the menu
// background's scroll (a: the caller's, for the registers left)
export function queueEraseConfirmCursorSprites(P, de, a = P.cpu.a) {
  const x = de >> 8, y = de & 0xFF, x2 = (x + 8) & 0xFF;
  const r = { a, b: OAM_BANK1, c: 0x00, d: x, e: y };
  chain(r, queueSprite(P, OAM_BANK1, 0x00, x, y));
  chain(r, { a: x2, f: addFlags(8, x), b: OAM_BANK1, c: 0x02, d: x2, e: y });
  chain(r, queueSprite(P, OAM_BANK1, 0x02, x2, y));
  return rom(P, FAR.TickMenuBgScroll, r);
}
// AnimateEraseConfirmPalette (3E:4E34), also a frame task: BG palette 4 from EraseConfirmPalette_3e with its third
// color stepping through EraseConfirmFlashColors_3e every 4 frames (12 steps: the frame's red glow)
export function animateEraseConfirmPalette(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  const pal = P.A.eraseConfirmPalette;
  copyMemoryBC(P, EraseConfirmPalette_3e, pal, 8);
  // (counter & $3C) / 4 is 0-15; the ROM's `add a / jr nc` never carries, steps 12-15 show step 0
  let step = (P.V.vBlankCounter & 0x3C) >> 2;
  if (step >= ERASE_FLASH_STEPS) step = 0;
  P.bus.w16(pal + 4, rw(P, EraseConfirmFlashColors_3e + 2 * step));
  const r = loadPaletteShadow(P, pal, BG_PALETTE_4, 1);
  wram(P, bank);
  return { ...r, a: bank, b: 0, f: entryF };                        // (b: CopyMemoryBC's count run out)
}

// ---- the racket-or-shoes choice ----
// RunRacketShoesChoiceMenu (3E:4EA0), slot $4008: the two tabs slide in (the way wMenuSlideDirection says), the
// cursor on the last choice; A returns the tab (0 racket, 1 shoes; kept in wRacketShoesTabIndex), B returns $FF
export function* runRacketShoesChoiceMenu(P) {
  sound(P, BGM_MENU);
  timerInterruptOff(P);
  yield* loadRacketShoesChoiceGraphics(P);
  wram(P, WRAM_SCREEN);
  yield* openChoiceTabPanel(P, P.V.menuSlideDirection);
  rom(P, FAR.InitMenuBgScroll);
  rom(P, FAR.LoadMenuSpritePalettePair, { b: 1, c: 1 });
  setMenuCursorFromIndex3e(P, CHOICE_TABS, P.V.racketShoesTabIndex);
  registerFrameTask(P, 1, ChoiceTabCursorSpriteTask);
  redrawRacketShoesChoiceMenu(P);
  wram(P, WRAM_SCREEN);
  for (;;) {
    yield* advanceFrame(P);
    P.V.menuInputPressed = P.V.inputPressed;
    if (moveMenuCursorGrid(P, CHOICE_TABS, 1).a) { sound(P, SFX_MENU_MOVE); redrawRacketShoesChoiceMenu(P); }
    const input = P.V.menuInputPressed;
    if (input & PADF_A) {
      sound(P, SFX_MENU_SELECT);
      clearFrameTasks(P);
      timerInterruptOn(P);
      yield* closeChoiceTabPanel(P, 1);
      P.V.menuSlideDirection = MENUSLIDE_FORWARD;
      const r = getMenuCursorIndex(P, CHOICE_TABS);
      P.V.racketShoesTabIndex = r.a;
      return r;
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
// The tabs' label pictures (two; decompressed and queued a frame apart), then the tab tiles, the cursor's, the
// panel's (a frame or two each), and the cursor's palette. Shared with the play-alone partner menu (choicetab.js),
// the link match rules (menus/link/rules.js: seven labels) and bank $1b's saved-data type select
// (menus/minigame_select/level_variants.js).
export function* loadChoiceTabGraphics(P, params, dests, blocks, entryF, labels = CHOICE_TABS) {
  const bank = P.V.wramBank;
  wram(P, WRAM_STAGING);
  for (let i = 0; i < labels; i++) {
    const slot = P.bus.u16(params + 2 * i);                      // (the tables of the bank mapped: the caller's)
    homeDecompressFromBank(P, slot >> 8, slot & 0xFF, wDecompBuffer);
    queueVRAMCopy(P, wDecompBuffer, P.bus.u16(dests + 2 * i), 16);
    yield* advanceFrame(P);
  }
  for (const [block, n, dest, frames] of blocks) {
    loadCompressedTileBlock(P, block, dest, n);
    for (let k = 0; k < frames; k++) yield* advanceFrame(P);
  }
  const r = rom(P, FAR.LoadIndexedPalette, { b: 0x08, c: 0x10 });
  wram(P, bank);
  return { ...r, a: bank, f: entryF };
}
// LoadRacketShoesChoiceGraphics (3E:4F33): as above with the racket and shoes labels
export function* loadRacketShoesChoiceGraphics(P, entryF = P.cpu.f) {
  return yield* loadChoiceTabGraphics(P, RacketShoesChoiceGfxParams_3e, RacketShoesChoiceGfxDests_3e, [
    [TILEBLOCK_RacketShoesChoiceGfx0, 0x10, vTiles0 + VRAM_BANK1, 1],
    [TILEBLOCK_RacketShoesChoiceGfx1, 0x10, vTiles0 + 0x10 * TILE_SIZE + VRAM_BANK1, 1],
    [TILEBLOCK_SharedMenuGfx27, 0x04, vTiles0 + 0x70 * TILE_SIZE + VRAM_BANK1, 1],
    [TILEBLOCK_RacketShoesChoiceGfx2, 0x14, vTiles0, 1],
  ], entryF);
}
// The tabs' attributes (all inactive, the cursor's active), its palette, the caption row's frame and caption, the
// rows queued. Shared with the play-alone partner menu.
export function redrawChoiceTabMenu(P, setPalette, drawCaption) {
  wram(P, WRAM_SCREEN);
  for (let tab = 0; tab < CHOICE_TAB_SLOTS; tab++) setChoiceTabAttrRect(P, tab, TAB_ATTR_INACTIVE);
  setChoiceTabAttrRect(P, getMenuCursorIndex(P, CHOICE_TABS).a, TAB_ATTR_ACTIVE);
  setPalette(P, getMenuCursorIndex(P, CHOICE_TABS).a);
  wram(P, WRAM_SCREEN);
  fillTilemapRect(P, wShadowTilemap + 15 * TILEMAP_WIDTH, 0x14, 0x01, FRAME_TOP);
  w8(P, wShadowTilemap + 15 * TILEMAP_WIDTH, FRAME_LEFT_CORNER);
  w8(P, wShadowTilemap + 15 * TILEMAP_WIDTH + 19, FRAME_RIGHT_CORNER);
  fillTilemapRect(P, wShadowTilemap + 16 * TILEMAP_WIDTH + 1, 0x12, 0x01, BLANK);
  drawCaption(P);
  queueVRAMCopy(P, wShadowAttrmap + 7 * TILEMAP_WIDTH, vBGMap0 + 7 * TILEMAP_WIDTH + VRAM_BANK1, 3 * TILEMAP_WIDTH / 16);
  return queueVRAMCopy(P, wShadowTilemap + 15 * TILEMAP_WIDTH, vBGMap0 + 15 * TILEMAP_WIDTH, 2 * TILEMAP_WIDTH / 16);
}
// RedrawRacketShoesChoiceMenu (3E:4FCF)
export const redrawRacketShoesChoiceMenu = P => redrawChoiceTabMenu(P, setRacketShoesChoicePalette, drawRacketShoesChoiceCaption);
// SetRacketShoesChoicePalette (3E:5038): BG palette 4 from the tab's entry of RacketShoesChoicePalettePtrs
export function setRacketShoesChoicePalette(P, tab) {
  return loadPaletteShadow(P, rw(P, (RacketShoesChoicePalettePtrs + ((tab * 2) & 0xFF)) & 0xFFFF), BG_PALETTE_4, 1);
}
// DrawRacketShoesChoiceCaption (3E:506D): the tab's caption (Text_30_224 + tab) in the caption row
export function drawRacketShoesChoiceCaption(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  const tab = getMenuCursorIndex(P, CHOICE_TABS).a;
  const r = rom(P, FAR.RenderTextToBuffer64, { hl: Text_30_224 + tab, de: wShadowTilemap + CHOICE_CAPTION_ROW * TILEMAP_WIDTH + 1, c: 0x20 });
  wram(P, bank);
  return { ...r, a: bank, b: tab, f: entryF };
}

export const HOOKS = [
  [BANK, 0x4C12, hookGen((P, c) => runEraseDataConfirmMenu(P, c.b))],
  [BANK, 0x4CAF, hookGen(P => loadEraseDataConfirmScreen(P))],
  [BANK, 0x4E0C, hook(P => eraseConfirmCursorSpriteTask(P))],
  [BANK, 0x4E1C, hook((P, c) => queueEraseConfirmCursorSprites(P, c.de))],
  [BANK, 0x4E34, hook((P, c) => animateEraseConfirmPalette(P, c.f))],
  [BANK, 0x4EA0, hookGen(P => runRacketShoesChoiceMenu(P))],
  [BANK, 0x4F33, hookGen((P, c) => loadRacketShoesChoiceGraphics(P, c.f))],
  [BANK, 0x4FCF, hook(P => redrawRacketShoesChoiceMenu(P))],
  [BANK, 0x5038, hook((P, c) => setRacketShoesChoicePalette(P, c.a))],
  [BANK, 0x506D, hook((P, c) => drawRacketShoesChoiceCaption(P, c.f))],
];
