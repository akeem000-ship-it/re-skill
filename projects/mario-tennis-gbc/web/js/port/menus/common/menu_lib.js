// The menu library of bank $39: indexed palettes, the compressed tile blocks every menu loads (TileBlockPtrs_39),
// the menu arrows, stacked and bobbing sprites, the scrolling banner sprites behind the main menu, the menu font,
// and the stadium background with the text window most menus are drawn on.
// Port of src/engine/menus/common/menu_lib_39.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm). Tables, graphics and their sizes are read from the ROM.
// Tests: web/tests/port/routines_menus_common.mjs; the main menu (lockstep on out/engine/exh1.mtrec) uses
// LoadCompressedTileBlock, InitMenuBgScroll, LoadMenuSpritePalettePair, TickMenuBgScroll, ApplySpriteBobOffset.
import { decompressDataFromBank, copyDataFromBank } from "../../home/decompress.js";
import { queueSprite, queueSpriteTemplate } from "../../home/fade.js";
import {
  FZ, FH, FC, addFlags, hook, hookGen, callFar, waitFarCall, withRomBank, wramBank, withWramBank, queueCopy, loadPalettes, FAR,
  WRAM_STAGING, WRAM_SCREEN, WRAM_TEXT, VRAM_BANK1, vTiles1, vTiles2, wDecompBuffer, wTextTileBuffer,
  wTextTileBuffer_SIZE, wShadowTilemap, wShadowAttrmap, wScreenScratch, wRulesScreenAnimFrame,
} from "./defs.js";
import { BANK_MENU_LIB, queueWram3MapToVRAM } from "./tilemaps.js";

const IndexedPalettes = 0x4599, FixedPaletteSetPalettes = 0x466B, TileBlockPtrs_39 = 0x46B7;
const ApplySpriteWaveOffsetTable = 0x4A84, ApplySpriteBobOffsetTable = 0x4AD3;
const MenuSpritePalettePairPalettes = 0x4B65, TickMenuBgScroll_SpriteTemplate = 0x4BBF;
const PALETTE_SIZE = 8, OBJ_PALETTES = 8;

// tile blocks of TileBlockPtrs_39 (the tileblock records' TILEBLOCK_* numbers)
export const TILEBLOCK = {
  SharedMenuGfx17Alias17: 17, NumberSpriteGfxWideGfx: 20, MenuArrowGfx0: 23, SharedMenuGfx27: 27, MainMenuGfx0: 28,
  SharedMenuGfx29: 29, SharedMenuGfx30: 30, MainMenuGfx1: 31, MainMenuGfx2: 32, MainMenuGfx3: 33, MainMenuGfx4: 34,
  SharedMenuGfx35: 35, SharedMenuGfx36: 36, SharedMenuGfx37: 37, SharedMenuGfx38: 38, SharedMenuGfx39: 39,
  SharedMenuGfx40: 40, SharedMenuGfx41: 41, SavedDataSourceGfx0: 42, EraseSavedDataGfx0: 46, MinigameSelectGfx0: 51,
  N64RecordTypeGfx0: 57, N64TransferItemGfx0: 59, MainMenuGfx5Alias4: 62, SharedMenuGfx63: 63, SharedMenuGfx65: 65,
  SavedDataSourceGfx4: 66, N64RecordTypeGfx2: 67, N64TransferItemGfx3: 68, MinigameSelectGfx6: 71,
  NumberSpriteGfx: 73, N64TransferItemGfx4: 115, SavedDataSourceGfx5: 118, SavedDataTypeSelectGfx: 120,
  DigitFontTiles: 121,
};
// The decoded size, in 16-byte blocks, of a tile block's stream (the ROM's <Label>_SIZE / 16 constants; read from
// the ROM's stream here).
const blockSizes = new WeakMap();
export function tileBlockBlocks(P, block) {
  let sizes = blockSizes.get(P.rom);
  if (!sizes) blockSizes.set(P.rom, sizes = new Map());
  if (!sizes.has(block)) {
    const slot = P.rom.u16(BANK_MENU_LIB, TileBlockPtrs_39 + 2 * block), bank = slot >> 8;
    sizes.set(block, (P.rom.lz(bank, P.rom.u16(bank, 0x4000 + (slot & 0xFF))).length >> 4) & 0xFF);
  }
  return sizes.get(block);
}
// the same for an LZ stream at bank:addr
const streamSizes = new WeakMap();
export function streamBlocks(P, bank, addr) {
  let sizes = streamSizes.get(P.rom);
  if (!sizes) streamSizes.set(P.rom, sizes = new Map());
  const key = bank << 16 | addr;
  if (!sizes.has(key)) sizes.set(key, (P.rom.lz(bank, addr).length >> 4) & 0xFF);
  return sizes.get(key);
}

// LoadIndexedPalette (39:457F): palette c of IndexedPalettes into palette slot b (0-7 BG, 8-15 OBJ).
export function loadIndexedPalette(P, slot, index) {
  return { b: slot, ...loadPalettes(P, IndexedPalettes + ((index << 3) & 0x7FF), slot, 1) };
}
// Unused_39_LoadFixedPaletteSet (39:4661): OBJ palettes 1-4 from FixedPaletteSetPalettes
export const unusedLoadFixedPaletteSet = P => loadPalettes(P, FixedPaletteSetPalettes, OBJ_PALETTES + 1, 4);

// LoadCompressedTileBlock (39:468B): tile block b of TileBlockPtrs_39, decompressed into wDecompBuffer (WRAM 1),
// queued to VRAM de (+ VRAM_BANK1 for bank 1), c blocks of 16 bytes. The WRAM bank is kept. Leaves QueueVRAMCopy's
// registers but a = the WRAM bank and the flags of the call.
export function loadCompressedTileBlock(P, block, dest, blocks, f = 0) {
  const old = P.V.wramBank;
  const slot = P.bus.u16(TileBlockPtrs_39 + ((block * 2) & 0xFF));
  wramBank(P, WRAM_STAGING);
  decompressDataFromBank(P, slot >> 8, slot & 0xFF, wDecompBuffer);
  const q = queueCopy(P, wDecompBuffer, dest, blocks);
  wramBank(P, old);
  return { ...q, a: old, f };
}
// the same as a farcall from another bank: bank $39 mapped meanwhile
export const farLoadCompressedTileBlock = (P, block, dest, blocks) =>
  withRomBank(P, BANK_MENU_LIB, () => loadCompressedTileBlock(P, block, dest, blocks));
// a tile block whole (blocks: its decoded size)
export const farLoadTileBlock = (P, block, dest) => farLoadCompressedTileBlock(P, block, dest, tileBlockBlocks(P, block));

// LoadMenuArrowSpriteTiles (39:4A16): the four menu-arrow tile blocks (4 tiles each) one after another at de.
// Leaves de = hl = de + $100.
const ARROW_BLOCKS = 4, ARROW_TILES = 4, ARROW_BYTES = 0x40;
export function loadMenuArrowSpriteTiles(P, dest, f = 0) {
  let r = { f };
  for (let i = 0; i < ARROW_BLOCKS; i++) {
    r = loadCompressedTileBlock(P, TILEBLOCK.MenuArrowGfx0 + i, dest, ARROW_TILES, r.f);
    dest = (dest + ARROW_BYTES) & 0xFFFF;
  }
  const before = (dest - ARROW_BYTES) & 0xFFFF;               // the last `add hl, de`'s flags (Z kept from the call)
  return { ...r, de: dest, hl: dest, f: (r.f & FZ) | (((before & 0xFFF) + ARROW_BYTES) > 0xFFF ? FH : 0) | (before + ARROW_BYTES > 0xFFFF ? FC : 0) };
}

// QueueStackedSpritePair (39:4A53): two sprites stacked 8 apart in x at (d, e): tile c + h * 4 and the next pair,
// attribute b. Registers kept.
export function queueStackedSpritePair(P, attr, tile, x, y, frame) {
  const t = (frame * 4 + tile) & 0xFF;
  queueSprite(P, attr, t, x, y);
  queueSprite(P, attr, (t + 2) & 0xFF, (x + 8) & 0xFF, y);
}

// ApplySpriteWaveOffset (39:4A75) / ApplySpriteBobOffset (39:4AC4): e + the 64-step table entry of hVBlankCounter.
// Leaves a = e = the result, hl = the entry, the flags of the add.
function apply64(P, table, e) {
  const at = table + (P.V.vBlankCounter & 0x3F), v = P.bus.u8(at), r = (v + e) & 0xFF;
  return { a: r, e: r, hl: at, f: addFlags(v, e) };
}
export const applySpriteWaveOffset = (P, e) => apply64(P, ApplySpriteWaveOffsetTable, e);
export const applySpriteBobOffset = (P, e) => apply64(P, ApplySpriteBobOffsetTable, e);

// ---- the banner sprites scrolling up behind the main menu ----
// Two rows of ten 8x16 sprites (wMenuBgScrollY/Tile/Attr: one byte per lane), drawn on alternate frames
// (wMenuBgScrollLane) at x = wMenuBgScrollX. Each lane's y counts down from $C6 / $40 and wraps from $B0 to $A0.
const SCROLL_START_Y = 0x40, SCROLL_LANE_GAP = 0x86, SCROLL_WRAP_AT = 0xB0, SCROLL_WRAP_TO = 0xA0;
// InitMenuBgScroll (39:4B13)
export function initMenuBgScroll(P) {
  const { bus, A } = P;
  bus.w8(A.menuBgScrollAttr, 1); bus.w8(A.menuBgScrollAttr + 1, 1);
  P.V.menuBgScrollX = 0;
  bus.w8(A.menuBgScrollY, SCROLL_START_Y); bus.w8(A.menuBgScrollY + 1, SCROLL_START_Y + SCROLL_LANE_GAP);
  bus.w8(A.menuBgScrollTile, 0); bus.w8(A.menuBgScrollTile + 1, 0);
  P.V.menuBgScrollLane = 0;
  return { a: 0, f: FZ };
}
// TickMenuBgScroll (39:4B6D), from the main menu's frame task: both lanes up a line, one lane's row queued.
export function tickMenuBgScroll(P, sp = P.cpu.sp - 2) {
  const { bus, A, V } = P;
  for (let lane = 0; lane < 2; lane++) {
    const y = (bus.u8(A.menuBgScrollY + lane) - 1) & 0xFF;
    bus.w8(A.menuBgScrollY + lane, y === SCROLL_WRAP_AT ? SCROLL_WRAP_TO : y);
  }
  const lane = V.menuBgScrollLane ? 1 : 0;
  V.menuBgScrollLane = lane ^ 1;
  const x = bus.u8(A.menuBgScrollY + lane), tile = bus.u8(A.menuBgScrollTile + lane), attr = bus.u8(A.menuBgScrollAttr + lane);
  return queueSpriteTemplate(P, TickMenuBgScroll_SpriteTemplate, x, V.menuBgScrollX, tile, attr, sp);
}

// LoadMenuSpritePalettePair (39:4B3A): MenuSpritePalettePairPalettes as OBJ palettes c and b (in that order).
export function loadMenuSpritePalettePair(P, first, second) {
  loadPalettes(P, MenuSpritePalettePairPalettes, (second + OBJ_PALETTES) & 0xFF, 1);
  return loadPalettes(P, MenuSpritePalettePairPalettes, (first + OBJ_PALETTES) & 0xFF, 1);
}

// LoadMenuFontTiles (39:4BE8): the menu font (SharedMenuGfx17) to $9000.
export const loadMenuFontTiles = P => farLoadTileBlock(P, TILEBLOCK.SharedMenuGfx17Alias17, vTiles2);

// ResetScreenAndTextWindows (39:4BF3): the scroll and camera at a (callers pass 0), the stadium background, the
// text windows reset, the menu font, and a 20 x 3 text window at the bottom of the screen (row 15) drawn into the
// WRAM 3 map (RedrawWindowRows flushes the window's rows to VRAM, a frame at a time), then the whole map queued.
// Leaves WRAM 3 mapped.
export function* resetScreenAndTextWindows(P, a) {
  const { V, bus, A } = P;
  V.scrollX = a; V.scrollY = a;
  bus.w8(A.cameraX, a); bus.w8(A.cameraX + 1, a); bus.w8(A.cameraY, a); bus.w8(A.cameraY + 1, a);
  withRomBank(P, BANK_MENU_LIB, () => loadStadiumBgGraphics(P));
  callFar(P, FAR.ResetTextWindowState);
  loadMenuFontTiles(P);
  wramBank(P, WRAM_TEXT);
  V.shadowTilemapBank = WRAM_SCREEN;
  V.windowTileAttr = 0;
  callFar(P, FAR.CreateWindowFromScreenRect, { d: 0x00, e: 0x0F, b: 0x14, c: 0x03 });
  callFar(P, FAR.DrawTextWindowFrame);
  yield* waitFarCall(P, FAR.RedrawWindowRows);
  return withRomBank(P, BANK_MENU_LIB, () => queueWram3MapToVRAM(P));
}

// LoadStadiumBgGraphics (39:4C38): the stadium screen: its tiles to VRAM bank 1 $9000 / $8800 (via wDecompBuffer
// and wTextTileBuffer), its tilemap and attribute map into WRAM 3 twice (the live map and the clean copy menus
// restore from: wScreenScratch / wRulesScreenAnimFrame), its 8 BG palettes. The WRAM bank is kept (pop_wram_bank:
// a = the bank, f = the flags at the call).
const BANK_STADIUM = 0x3C, StadiumTiles = 0x08, StadiumTilemap = 0x0A, StadiumAttrmap = 0x0C, StadiumPalettes = 0x0E;
export function loadStadiumBgGraphics(P, f = 0) {
  const old = P.V.wramBank;
  return withWramBank(P, WRAM_STAGING, () => {
    decompressDataFromBank(P, BANK_STADIUM, StadiumTiles, wDecompBuffer);
    queueCopy(P, wDecompBuffer, vTiles2 + VRAM_BANK1, 128);
    queueCopy(P, wTextTileBuffer, vTiles1 + VRAM_BANK1, wTextTileBuffer_SIZE / 16);
    wramBank(P, WRAM_SCREEN);
    decompressDataFromBank(P, BANK_STADIUM, StadiumTilemap, wShadowTilemap);
    decompressDataFromBank(P, BANK_STADIUM, StadiumTilemap, wScreenScratch);
    decompressDataFromBank(P, BANK_STADIUM, StadiumAttrmap, wShadowAttrmap);
    decompressDataFromBank(P, BANK_STADIUM, StadiumAttrmap, wRulesScreenAnimFrame);
    wramBank(P, WRAM_STAGING);
    copyDataFromBank(P, BANK_STADIUM, StadiumPalettes, wDecompBuffer, 0x40);
    return { ...loadPalettes(P, wDecompBuffer, 0, 8), b: 0, a: old, f };
  });
}

export const HOOKS = [
  [BANK_MENU_LIB, 0x457F, hook((P, c) => loadIndexedPalette(P, c.b, c.c))],
  [BANK_MENU_LIB, 0x4661, hook(P => unusedLoadFixedPaletteSet(P))],
  [BANK_MENU_LIB, 0x468B, hook((P, c) => loadCompressedTileBlock(P, c.b, c.de, c.c, c.f))],
  [BANK_MENU_LIB, 0x4A16, hook((P, c) => loadMenuArrowSpriteTiles(P, c.de, c.f))],
  [BANK_MENU_LIB, 0x4A53, hook((P, c) => { queueStackedSpritePair(P, c.b, c.c, c.d, c.e, c.h); })],
  [BANK_MENU_LIB, 0x4A75, hook((P, c) => applySpriteWaveOffset(P, c.e))],
  [BANK_MENU_LIB, 0x4AC4, hook((P, c) => applySpriteBobOffset(P, c.e))],
  [BANK_MENU_LIB, 0x4B13, hook(P => initMenuBgScroll(P))],
  [BANK_MENU_LIB, 0x4B3A, hook((P, c) => loadMenuSpritePalettePair(P, c.b, c.c))],
  [BANK_MENU_LIB, 0x4B6D, hook((P, c) => tickMenuBgScroll(P, c.sp - 2))],
  [BANK_MENU_LIB, 0x4BE8, hook(P => loadMenuFontTiles(P))],
  [BANK_MENU_LIB, 0x4BF3, hookGen((P, c) => resetScreenAndTextWindows(P, c.a))],
  [BANK_MENU_LIB, 0x4C38, hook((P, c) => loadStadiumBgGraphics(P, c.f))],
];
