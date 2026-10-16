// Bank $1a: the unused debug character viewer's outer screens: the viewer's loop (a grid of character names in two
// pages of 16, then the chosen character's scene, back to the grid), the grid's input and drawing (names rendered in
// columns, a blinking cursor and page arrows) and the viewer screen's graphics and maps.
// Port of the code of src/engine/menus/debug/exp_gfx_1a.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own; graphics, palettes and tables are read from
// the ROM. Nothing in the game reaches this code.
// Tests: web/tests/port/routines_menus_misc.mjs (the routines that do not wait); lockstep on
// out/port/dbg_viewer.mtrec (scripted: the viewer called from a stub).
import {
  FZ, FN, FC, FAR, rom, near, u8, w8, wram, sound, advanceFrame, fadeOut, fadeIn, clearFrameTasks, disableLCDSafely,
  enableLCD, registerFrameTask, unregisterFrameTask, hook, hookGen, addFlags, decFlags, WRAM_STAGING,
  WRAM_COURT_PLANES, WRAM_SCREEN, WRAM_SCENE, VRAM_BANK1, TILEMAP_WIDTH, vTiles0, vTiles1, vTiles2, vBGMap0,
  wDecompBuffer, wTextTileBuffer, wShadowTilemap, wScreenAttrmap, OAM_BANK1, PADF_A, PADF_B, PADF_UP, PADF_DOWN,
  PADF_LEFT, PADF_RIGHT, SFX_MENU_MOVE, SFX_MENU_SELECT, SFX_MENU_CANCEL, chain, hlIndexed, farFlagsAt,
} from "./defs.js";
import { queueVRAMCopy } from "../../home/memory.js";
import { decompressData } from "../../home/decompress.js";
import { loadPaletteShadow } from "../../home/palettes.js";
import { clearSpriteQueue, queueSprite } from "../../home/fade.js";
import { getRegs } from "../../home/cpu.js";
import {
  unusedCopyBank1ToBank3Buffer, unusedCopyBank1ToBank2Buffer, unusedInitCharViewerState, unusedSetupCharViewerScene,
  unusedRefreshCharViewerSelection, unusedRunCharViewerInputLoop, Unused_1a_DrawCharViewerCursorSprite,
} from "./char_viewer.js";

export const BANK = 0x1A;
export const Unused_1a_DrawCharViewerGridCursor = 0x6AB3, Unused_1a_ApplyCharViewerPalette = 0x70C0;
const rb = (P, a) => P.rom.u8(BANK, a);
const wDebugCharViewerPage = 0xCB62, wDebugCharViewerIndex = 0xCB63, wCharViewerCharId = 0xD002;   // (the last WRAM 6)
const wCameraX = 0xC320, wCameraY = 0xC322, rWY = 0xFF4A, WINDOW_OFF_Y = 0x90;
const Palette_1a_0 = 0x70D9, CharViewerScreenGfx0 = 0x7119, CharViewerScreenGfx1 = 0x777D, CharViewerScreenGfx2 = 0x7831;
const CharViewerGridTilemap0 = 0x78B2, CharViewerGridTilemap1 = 0x78EC, DrawCharViewerGridCursorTable = 0x6B0F;
const MAP_BYTES = 0x240, MAP_BLOCKS = 0x24, TILE_BLOCKS = 0x80;
const PAGE_SIZE = 16, COLUMN = 8, LAST_PAGE = 1, CANCELLED = 0xFF;
const CHAR_TILES_AT = vTiles0 + 0x70 * 16;
// the page names: two columns of 8 text ids by page
const PAGE_NAMES = [[0x001B, 0x0023], [0x002B, 0x0033], [0x003B, 0x0043]];
const NAMES_LEFT = wShadowTilemap + 2 * TILEMAP_WIDTH + 3, NAMES_RIGHT = wShadowTilemap + 2 * TILEMAP_WIDTH + 11;
const NAME_ROWS = 8, NAME_WIDTH = 0x20, NAME_ROW_STEP = 0x40;
const ARROW_ATTR = OAM_BANK1 | 2, ARROW_LEFT = [0x84, 0x0A, 0x4A], ARROW_RIGHT = [0x86, 0x96, 0x4A];
const CURSOR_ATTR = OAM_BANK1, CURSOR_TILE = 0x88, ARROWS_BLINK = 0x1C, CURSOR_BLINK = 0x2A;

// Unused_1a_RunDebugCharViewer (1A:67D4): the viewer, for ever: the name grid; a name chosen opens its scene (the
// character drawn and animated, with palettes and poses to pick), B goes back to the grid
export function* unusedRunDebugCharViewer(P) {
  w8(P, wDebugCharViewerPage, 0);
  w8(P, wDebugCharViewerIndex, 0);
  for (;;) {
    clearFrameTasks(P);
    disableLCDSafely(P);
    rom(P, FAR.LoadMenuFontGfx);
    P.V.scrollX = 0;
    P.V.scrollY = 0;
    P.bus.w16(wCameraX, 0);
    P.bus.w16(wCameraY, 0);
    P.bus.w8(rWY, WINDOW_OFF_Y);
    clearSpriteQueue(P);
    rom(P, FAR.InitActorEngine);
    rom(P, FAR.ResetTextWindowState);
    if ((yield* unusedRunCharViewerSelectGrid(P)).a !== CANCELLED) {
      yield* fadeOut(P, 64);
      disableLCDSafely(P);
      unusedInitCharViewerState(P, getRegs(P.cpu));
      unusedLoadCharViewerScreen(P, getRegs(P.cpu));
      unusedSetupCharViewerScene(P, getRegs(P.cpu));
      enableLCD(P);
      registerFrameTask(P, 1, Unused_1a_DrawCharViewerCursorSprite);
      near(P, Unused_1a_ApplyCharViewerPalette);
      unusedRefreshCharViewerSelection(P, getRegs(P.cpu));
      yield* advanceFrame(P);
      wram(P, WRAM_SCENE);
      rom(P, FAR.LoadOnCourtCharTilesA, { a: u8(P, wCharViewerCharId), de: CHAR_TILES_AT });
      yield* advanceFrame(P);
      yield* fadeIn(P, 16);
      yield* unusedRunCharViewerInputLoop(P);
      unregisterFrameTask(P, Unused_1a_DrawCharViewerCursorSprite);
    }
    yield* fadeOut(P, 16);
    disableLCDSafely(P);
    rom(P, FAR.LoadMenuFontGfx);
    enableLCD(P);
    yield* advanceFrame(P);
  }
}
// Unused_1a_RunCharViewerSelectGrid (1A:686C): the name grid (page wDebugCharViewerPage, cursor
// wDebugCharViewerIndex: two columns of 8). Up / down move in a column, left / right change columns and, past the
// edge, the page (redrawn). A returns a = the character (page * 16 + index, also in wCharViewerCharId), B $ff.
export function* unusedRunCharViewerSelectGrid(P) {
  wram(P, WRAM_SCENE);
  loadPaletteShadow(P, Palette_1a_0, 0, 8);
  loadPaletteShadow(P, Palette_1a_0, 8, 8);
  wram(P, WRAM_STAGING);
  decompressData(P, CharViewerScreenGfx0, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles2 + VRAM_BANK1, TILE_BLOCKS);
  queueVRAMCopy(P, wTextTileBuffer, vTiles1 + VRAM_BANK1, TILE_BLOCKS);
  unusedLoadCharViewerGridTilemap(P);
  unusedDrawCharViewerPageNames(P, u8(P, wDebugCharViewerPage), getRegs(P.cpu));
  wram(P, WRAM_SCREEN);
  queueVRAMCopy(P, wShadowTilemap, vBGMap0, MAP_BLOCKS);
  wram(P, WRAM_COURT_PLANES);
  queueVRAMCopy(P, wScreenAttrmap, vBGMap0 + VRAM_BANK1, MAP_BLOCKS);
  enableLCD(P);
  registerFrameTask(P, 1, Unused_1a_DrawCharViewerGridCursor);
  yield* fadeIn(P, 16);
  const index = () => u8(P, wDebugCharViewerIndex), setIndex = v => w8(P, wDebugCharViewerIndex, v);
  const page = () => u8(P, wDebugCharViewerPage);
  for (;;) {
    wram(P, WRAM_SCENE);
    yield* advanceFrame(P);
    const input = P.V.inputPressed;
    let newPage = -1;
    if (input & PADF_UP) {
      const i = (index() - 1) & 0xFF;
      setIndex(i === 0xFF ? COLUMN - 1 : i === COLUMN - 1 ? PAGE_SIZE - 1 : i);
      sound(P, SFX_MENU_MOVE);
    } else if (input & PADF_DOWN) {
      const i = index() + 1;
      setIndex(i === COLUMN ? 0 : i === PAGE_SIZE ? COLUMN : i);
      sound(P, SFX_MENU_MOVE);
    } else if (input & PADF_LEFT) {
      if (index() >= COLUMN) { setIndex(index() - COLUMN); sound(P, SFX_MENU_MOVE); continue; }
      setIndex(index() + COLUMN);
      if (!page()) { setIndex(index() - COLUMN); continue; }
      newPage = page() - 1;
    } else if (input & PADF_RIGHT) {
      if (index() + COLUMN < PAGE_SIZE) { setIndex(index() + COLUMN); sound(P, SFX_MENU_MOVE); continue; }
      setIndex(index() + COLUMN - PAGE_SIZE);
      if (page() === LAST_PAGE) { setIndex(index() + COLUMN); continue; }
      newPage = page() + 1;
    } else if (input & PADF_A) {
      const r = unregisterFrameTask(P, Unused_1a_DrawCharViewerGridCursor);
      sound(P, SFX_MENU_SELECT);
      const b = (page() << 4 | page() >> 4) & 0xFF, id = (index() + b) & 0xFF;
      w8(P, wCharViewerCharId, id);
      return { ...r, a: id, b, f: addFlags(index(), b) };
    } else if (input & PADF_B) {
      const r = unregisterFrameTask(P, Unused_1a_DrawCharViewerGridCursor);
      sound(P, SFX_MENU_CANCEL);
      return { ...r, a: CANCELLED };
    }
    if (newPage < 0) continue;
    w8(P, wDebugCharViewerPage, newPage);
    sound(P, SFX_MENU_MOVE);
    unusedLoadCharViewerGridTilemap(P);
    unusedDrawCharViewerPageNames(P, newPage, getRegs(P.cpu));
    wram(P, WRAM_SCREEN);
    queueVRAMCopy(P, wShadowTilemap + TILEMAP_WIDTH, vBGMap0 + TILEMAP_WIDTH, 16 * TILEMAP_WIDTH / 16);
    yield* advanceFrame(P);
  }
}
// Unused_1a_LoadCharViewerGridTilemap (1A:69EB): the grid's tile and attribute maps (WRAM 3 / 2), the attributes of
// the 18x16 inside cleared
export function unusedLoadCharViewerGridTilemap(P) {
  wram(P, WRAM_STAGING);
  decompressData(P, CharViewerGridTilemap0, wDecompBuffer);
  unusedCopyBank1ToBank3Buffer(P, wDecompBuffer, MAP_BYTES);
  wram(P, WRAM_STAGING);
  decompressData(P, CharViewerGridTilemap1, wDecompBuffer);
  const { d } = unusedCopyBank1ToBank2Buffer(P, wDecompBuffer, MAP_BYTES);
  wram(P, WRAM_COURT_PLANES);
  let hl = wScreenAttrmap + TILEMAP_WIDTH + 1, a = 0, carry = 0;
  for (let c = 16; c > 0; c--) {
    for (let b = 0; b < 18; b++) w8(P, hl + b, 0);
    const l = (hl & 0xFF) + TILEMAP_WIDTH;
    a = l & 0xFF; carry = l > 0xFF;
    hl = (hl & 0xFF00) + l & 0xFFFF;
  }
  return { a, b: 0, c: 0, d, e: wDecompBuffer & 0xFF, hl, f: FZ | FN | (carry ? FC : 0) };
}
// Unused_1a_DrawCharViewerPageNames (1A:6A3A): page a's names (pages 0-2; others none) in two columns of 8
export function unusedDrawCharViewerPageNames(P, page, entry) {
  if (page > 2) return { a: (page - 2) & 0xFF, f: decFlags((page - 1) & 0xFF, 0) };
  wram(P, WRAM_SCREEN);
  const r = unusedRenderTextColumnToBuffer64(P, PAGE_NAMES[page][0], NAMES_LEFT, NAME_ROWS, WRAM_SCREEN, entry.b);
  return unusedRenderTextColumnToBuffer64(P, PAGE_NAMES[page][1], NAMES_RIGHT, NAME_ROWS, r.a, entry.b);
}
// Unused_1a_RenderTextColumnToBuffer64 (1A:6A9B): c texts from id hl on, one a row (64 bytes apart) from de
export function unusedRenderTextColumnToBuffer64(P, hl, de, c, a, b) {
  for (;;) {
    const r = rom(P, FAR.RenderTextToBuffer64, { a, f: farFlagsAt(P, 3), b, c: NAME_WIDTH, de, hl });
    a = r.a;
    c = (c - 1) & 0xFF;
    if (!c) return { a, b, c: 0, de, hl, f: FZ | FN | (r.f & FC) };
    hl = (hl + 1) & 0xFFFF;
    de = (de + NAME_ROW_STEP) & 0xFFFF;
  }
}
// Unused_1a_DrawCharViewerGridCursor (1A:6AB3), a frame task: blinking, the page arrow (left on pages 1 and 2,
// right otherwise) and the cursor on the hovered name
export function unusedDrawCharViewerGridCursor(P, entry) {
  const r = { ...entry };
  wram(P, WRAM_SCENE);
  r.a = WRAM_SCENE;
  let vb = P.V.vBlankCounter;
  if (vb & ARROWS_BLINK) {
    const page = u8(P, wDebugCharViewerPage);
    const [tile, x, y] = page === 1 || page === 2 ? ARROW_LEFT : ARROW_RIGHT;
    chain(r, { b: ARROW_ATTR, c: tile, d: x, e: y });
    chain(r, queueSprite(P, ARROW_ATTR, tile, x, y));
  }
  vb = P.V.vBlankCounter;
  if (!(vb & CURSOR_BLINK)) return chain(r, { a: 0, f: FZ | 0x20 });
  const at = hlIndexed(DrawCharViewerGridCursorTable, (u8(P, wDebugCharViewerIndex) << 1 | u8(P, wDebugCharViewerIndex) >> 7) & 0xFF);
  const e = rb(P, at.hl), d = rb(P, at.hl + 1);
  chain(r, { hl: at.hl + 1, f: at.f, b: CURSOR_ATTR, c: CURSOR_TILE, d, e, a: e });
  return chain(r, queueSprite(P, CURSOR_ATTR, CURSOR_TILE, d, e));
}
// Unused_1a_LoadCharViewerScreen (1A:6B2F): the viewer screen's graphics, its maps queued
export function unusedLoadCharViewerScreen(P, entry) {
  const r = chain({ ...entry }, unusedLoadCharViewerScreenGfx(P, entry));
  wram(P, WRAM_SCREEN);
  chain(r, { a: WRAM_SCREEN, hl: wShadowTilemap, de: vBGMap0, c: MAP_BLOCKS });
  chain(r, queueVRAMCopy(P, wShadowTilemap, vBGMap0, MAP_BLOCKS));
  wram(P, WRAM_COURT_PLANES);
  chain(r, { a: WRAM_COURT_PLANES, hl: wScreenAttrmap, de: vBGMap0 + VRAM_BANK1, c: MAP_BLOCKS });
  return chain(r, queueVRAMCopy(P, wScreenAttrmap, vBGMap0 + VRAM_BANK1, MAP_BLOCKS));
}
// Unused_1a_LoadCharViewerScreenGfx (1A:6B55): BG palettes, the screen's tiles, its tile and attribute maps (WRAM 3 /
// 2), the attributes of the two name rows (15-16) cleared
export function unusedLoadCharViewerScreenGfx(P, entry) {
  const r = { ...entry };
  loadPaletteShadow(P, Palette_1a_0, 0, 8);
  wram(P, WRAM_STAGING);
  decompressData(P, CharViewerScreenGfx0, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles2 + VRAM_BANK1, TILE_BLOCKS);
  queueVRAMCopy(P, wTextTileBuffer, vTiles1 + VRAM_BANK1, TILE_BLOCKS);
  wram(P, WRAM_STAGING);
  decompressData(P, CharViewerScreenGfx1, wDecompBuffer);
  unusedCopyBank1ToBank3Buffer(P, wDecompBuffer, MAP_BYTES);
  wram(P, WRAM_STAGING);
  decompressData(P, CharViewerScreenGfx2, wDecompBuffer);
  chain(r, unusedCopyBank1ToBank2Buffer(P, wDecompBuffer, MAP_BYTES));
  wram(P, WRAM_COURT_PLANES);
  for (let i = 0; i < 16; i++) {
    w8(P, wScreenAttrmap + 15 * TILEMAP_WIDTH + 1 + i, 0);
    w8(P, wScreenAttrmap + 16 * TILEMAP_WIDTH + 1 + i, 0);
  }
  return chain(r, { a: 0, f: FZ, e: wDecompBuffer & 0xFF, hl: wScreenAttrmap + 16 * TILEMAP_WIDTH + 17 });
}

export const HOOKS = [
  [BANK, 0x67D4, hookGen(P => unusedRunDebugCharViewer(P))],
  [BANK, 0x686C, hookGen(P => unusedRunCharViewerSelectGrid(P))],
  [BANK, 0x69EB, hook(P => unusedLoadCharViewerGridTilemap(P))],
  [BANK, 0x6A3A, hook((P, c) => unusedDrawCharViewerPageNames(P, c.a, getRegs(c)))],
  [BANK, 0x6A9B, hook((P, c) => unusedRenderTextColumnToBuffer64(P, c.hl, c.de, c.c, c.a, c.b))],
  [BANK, 0x6AB3, hook((P, c) => unusedDrawCharViewerGridCursor(P, getRegs(c)))],
  [BANK, 0x6B2F, hook((P, c) => unusedLoadCharViewerScreen(P, getRegs(c)))],
  [BANK, 0x6B55, hook((P, c) => unusedLoadCharViewerScreenGfx(P, getRegs(c)))],
];
