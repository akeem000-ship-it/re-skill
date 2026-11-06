// Screen assets and tilemap work in bank $39: loading a whole screen (tiles, tilemap, attribute map, palettes) from
// ScreenAssetRecordTable, the animated tiles of the menus, copying and filling rectangles of the 32-wide map
// buffers, and the menu panels that slide in and out: RestoreMenuBgAndDrawPanel rebuilds the screen from its
// clean copy and draws the panel of one slide step (a list of rectangle copies from TilemapAssemblyDispatch_39),
// FlushWram3MapRows queues the changed rows to VRAM over two frames.
// Port of src/engine/menus/common/animated_39.asm and assets_39.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm). The tables are read from the ROM.
// Tests: web/tests/port/routines_menus_common.mjs; FlushWram3MapRows (it waits) and the main menu's use of the rest
// in the lockstep on out/engine/exh1.mtrec and out/port/save1.mtrec.
import { decompressData, decompressDataFromBank, copyDataFromBank } from "../../home/decompress.js";
import {
  hook, hookGen, push, pop, advanceFrame, wramBank, pushWramBank, popWramBank, withWramBank, queueCopy, loadPalettes,
  WRAM_STAGING, WRAM_COURT_PLANES, WRAM_SCREEN, TILE_SIZE, TILEMAP_WIDTH, TILEMAP_AREA, VRAM_BANK1,
  vTiles1, vTiles2, vBGMap0, wDecompBuffer, wTextTileBuffer, wTextTileBuffer_SIZE, wShadowTilemap, wShadowAttrmap,
  wScreenScratch, wRulesScreenAnimFrame,
} from "./defs.js";

export const BANK_MENU_LIB = 0x39;
const ScreenAssetRecordTable = 0x40F5;          // 70 records of 4 slot words: tiles, tilemap, attribute map, palettes
const SCREEN_ASSET_SIZE = 8;
const UpdateAnimatedTilesTable = 0x4403;        // per tile set (0-3): the frame table of the first animated pair
const AnimatedTilesTable0 = 0x440B;             // per tile set: the second pair's ($FFFF: none)
const NO_TABLE = 0xFF;
const FixedTileBlockAndPalette = 0x44F6, FixedTileBlockPalette = 0x4516, FixedBgPalette0Palette = 0x4528;
const TilemapAssemblyDispatch_39 = 0x4E60;      // per panel: a list (by slide step) of rectangle-copy lists
const RECT_SIZE = 6;                            // [src lo, hi, dest lo, hi, width, height]; width 0 ends a list
const ATTR_PLANE = 0x400;                       // the attribute buffer of a tilemap buffer, $400 after it
const OBJ_PALETTES = 8;                         // LoadPaletteShadow's first OBJ palette
const SCREEN_PALETTE_BYTES = 0x40;              // 8 BG palettes

// a slot word of a ROM table: [slot, bank] -> DecompressDataFromBank / CopyDataFromBank's h = bank, l = slot
const slotWord = (P, addr) => P.bus.u16(addr);

// LoadScreenAssetRecord (39:407E): screen record c: its tiles decompressed into wDecompBuffer (WRAM 1) and queued
// to VRAM bank 1 $9000 (128 tiles) with wTextTileBuffer to $8800 (128 tiles: the second half of the stream); its
// tilemap and attribute map into wShadowTilemap / wShadowAttrmap (WRAM 3); its 8 BG palettes. Leaves WRAM 1 mapped.
export function loadScreenAssetRecord(P, record) {
  const at = ScreenAssetRecordTable + ((record << 3) & 0x7FF);
  const word = i => slotWord(P, at + 2 * i);
  wramBank(P, WRAM_STAGING);
  let w = word(0);
  decompressDataFromBank(P, w >> 8, w & 0xFF, wDecompBuffer);
  queueCopy(P, wDecompBuffer, vTiles2 + VRAM_BANK1, 128);
  queueCopy(P, wTextTileBuffer, vTiles1 + VRAM_BANK1, wTextTileBuffer_SIZE / 16);
  wramBank(P, WRAM_SCREEN);
  w = word(1); decompressDataFromBank(P, w >> 8, w & 0xFF, wShadowTilemap);
  w = word(2); decompressDataFromBank(P, w >> 8, w & 0xFF, wShadowAttrmap);
  wramBank(P, WRAM_STAGING);
  w = word(3);
  const copied = copyDataFromBank(P, w >> 8, w & 0xFF, wDecompBuffer, SCREEN_PALETTE_BYTES);
  return { de: copied.de, b: 0, ...loadPalettes(P, wDecompBuffer, 0, 8) };
}

// QueueWram3MapToVRAM (39:4325): the whole BG map from wShadowTilemap / wShadowAttrmap (WRAM 3, left mapped) to
// $9800 in both VRAM banks, in VBlank.
export function queueWram3MapToVRAM(P) {
  wramBank(P, WRAM_SCREEN);
  const r = queueCopy(P, wShadowTilemap, vBGMap0, TILEMAP_AREA / 16);
  return { ...r, ...queueCopy(P, wShadowAttrmap, vBGMap0 + VRAM_BANK1, TILEMAP_AREA / 16) };   // (b: the first's, if the queue was full)
}

// UpdateAnimatedTiles (39:4342), a frame task: every wAnimatedTilePeriod frames, the next of the 16 frames of the
// tile set wAnimatedTileSet (0-3): up to two pairs of 2x2-tile icons, decompressed into wDecompBuffer and queued to
// VRAM bank 1 ($9000 tiles $2E/$3E and $4E/$5E). Every register kept.
const ANIM_FRAMES = 16, ANIM_SETS = 3;
const ANIM_PAIR_A = [vTiles2 + 0x2E * TILE_SIZE, vTiles2 + 0x3E * TILE_SIZE], ANIM_PAIR_B = [vTiles2 + 0x4E * TILE_SIZE, vTiles2 + 0x5E * TILE_SIZE];
const ANIM_BUFFER_B = wDecompBuffer + 16 * TILE_SIZE;
export function updateAnimatedTiles(P) {
  const { V, bus } = P;
  withWramBank(P, P.V.wramBank, () => {                      // (push hWramBank ... pop_wram_bank)
    const next = (V.animatedTileTimer + 1) & 0xFF, period = V.animatedTilePeriod;
    const timer = next & 0x80 ? (period - 1) & 0xFF : next < period ? next : 0;
    V.animatedTileTimer = timer;
    if (timer) return;
    wramBank(P, WRAM_COURT_PLANES);
    const frame = (V.animatedTileFrame + 1) & 0xFF;
    V.animatedTileFrame = frame;
    const step = (frame % ANIM_FRAMES) * 2, set = (V.animatedTileSet & ANIM_SETS) * 2;
    const loadPair = (tableList, buffer, [dest1, dest2]) => {
      const table = bus.u16(tableList + set);
      if (((table >> 8) & table & 0xFF) === NO_TABLE) return;
      const w = bus.u16((table & 0xFF00) + (((table & 0xFF) + step) & 0x1FF));
      decompressDataFromBank(P, w >> 8, w & 0xFF, buffer);
      queueCopy(P, buffer, dest1 + VRAM_BANK1, 2);
      queueCopy(P, buffer + 2 * TILE_SIZE, dest2 + VRAM_BANK1, 2);
    };
    const tableA = bus.u16(UpdateAnimatedTilesTable + set);
    if (((tableA >> 8) & tableA & 0xFF) !== NO_TABLE) {
      wramBank(P, WRAM_STAGING);
      loadPair(UpdateAnimatedTilesTable, wDecompBuffer, ANIM_PAIR_A);
    }
    loadPair(AnimatedTilesTable0, ANIM_BUFFER_B, ANIM_PAIR_B);   // (into whichever WRAM bank is mapped by now)
  });
}

// LoadFixedTileBlockAndPalette (39:44D3): a small fixed tile block (decompressed into wDecompBuffer, WRAM 1 left
// mapped) to VRAM de, and its palette as OBJ palette 0.
export function loadFixedTileBlockAndPalette(P, dest) {
  wramBank(P, WRAM_STAGING);
  const size = decompressData(P, FixedTileBlockAndPalette, wDecompBuffer);
  const q = queueCopy(P, wDecompBuffer, dest, (size >> 4) & 0xFF);
  return { ...q, ...loadPalettes(P, FixedTileBlockPalette, OBJ_PALETTES, 1) };
}
// Unused_39_LoadFixedBgPalette0 (39:451E): BG palette 0 from FixedBgPalette0Palette
export function unusedLoadFixedBgPalette0(P) { return loadPalettes(P, FixedBgPalette0Palette, 0, 1); }

// CopyTilemapRect (39:4530): copy a b x c rectangle from hl to de, rows 32 bytes apart (0 = 256). Registers kept.
export function copyTilemapRect(P, src, dest, width, height) {
  const { bus } = P;
  for (let row = height || 0x100; row > 0; row--) {
    for (let i = 0; i < (width || 0x100); i++) bus.w8(dest + i, bus.u8(src + i));
    src = (src + TILEMAP_WIDTH) & 0xFFFF; dest = (dest + TILEMAP_WIDTH) & 0xFFFF;
  }
}
// FillTilemapRect (39:4558): fill a b x c rectangle at de with h, rows 32 bytes apart. Registers kept.
export function fillTilemapRect(P, dest, width, height, value) {
  for (let row = height || 0x100; row > 0; row--) {
    for (let i = 0; i < (width || 0x100); i++) P.bus.w8(dest + i, value);
    dest = (dest + TILEMAP_WIDTH) & 0xFFFF;
  }
}

// FlushWram3MapRows (39:4CAB): queue the rows of the screen a menu panel of layout b covers, from wShadowTilemap /
// wShadowAttrmap (WRAM 3) to $9800 in both VRAM banks: the top two rows and a first band, then a frame later the
// rest (the VRAM queue holds ten copies). Registers and the WRAM bank kept.
// [rows of the first band], [rows after the frame], per layout 0-2 (3 and above: the last)
const FLUSH_BANDS = [
  [[0, 2], [3, 3]], [[7, 3], [11, 3]],
  [[0, 2], [4, 3]], [[10, 3]],
  [[0, 2], [4, 3]], [[9, 3]],
  [[0, 2]], [[7, 3]],
];
function queueRows(P, [row, count]) {
  const off = row * TILEMAP_WIDTH, blocks = count * TILEMAP_WIDTH / 16;
  queueCopy(P, wShadowTilemap + off, vBGMap0 + off, blocks);
  queueCopy(P, wShadowAttrmap + off, vBGMap0 + off + VRAM_BANK1, blocks);
}
export function* flushWram3MapRows(P, layout) {
  for (let i = 0; i < 4; i++) push(P, 0);                    // push af / bc / de / hl
  pushWramBank(P, WRAM_SCREEN);
  const k = Math.min(layout, 3) * 2;
  for (const band of FLUSH_BANDS[k]) queueRows(P, band);
  yield* advanceFrame(P);
  for (const band of FLUSH_BANDS[k + 1]) queueRows(P, band);
  popWramBank(P);
  for (let i = 0; i < 4; i++) pop(P);
}

// RestoreMenuBgAndDrawPanel (39:4DEB): the screen (20 x 16 cells) back from its clean copy (wScreenScratch /
// wRulesScreenAnimFrame into wShadowTilemap / wShadowAttrmap, WRAM 3 mapped by the caller), then the panel b at
// slide step c: each rectangle of its list copied, tiles and attributes. Registers kept.
export function restoreMenuBgAndDrawPanel(P, panel, step) {
  const { bus } = P;
  copyTilemapRect(P, wScreenScratch, wShadowTilemap, 20, 16);
  copyTilemapRect(P, wRulesScreenAnimFrame, wShadowAttrmap, 20, 16);
  const steps = bus.u16(TilemapAssemblyDispatch_39 + ((panel * 2) & 0xFF));
  let rect = bus.u16((steps & 0xFF00) + (((steps & 0xFF) + ((step * 2) & 0xFF)) & 0x1FF));
  for (;;) {
    const src = bus.u16(rect), dest = bus.u16(rect + 2), width = bus.u8(rect + 4), height = bus.u8(rect + 5);
    if (!width) return;
    copyTilemapRect(P, src, dest, width, height);
    copyTilemapRect(P, (src + ATTR_PLANE) & 0xFFFF, (dest + ATTR_PLANE) & 0xFFFF, width, height);
    rect = (rect & 0xFF00) + (((rect & 0xFF) + RECT_SIZE) & 0x1FF);
  }
}

export const HOOKS = [
  [BANK_MENU_LIB, 0x407E, hook((P, c) => loadScreenAssetRecord(P, c.c))],
  [BANK_MENU_LIB, 0x4325, hook(P => queueWram3MapToVRAM(P))],
  [BANK_MENU_LIB, 0x4342, hook(P => { updateAnimatedTiles(P); })],
  [BANK_MENU_LIB, 0x44D3, hook((P, c) => loadFixedTileBlockAndPalette(P, c.de))],
  [BANK_MENU_LIB, 0x451E, hook(P => unusedLoadFixedBgPalette0(P))],
  [BANK_MENU_LIB, 0x4530, hook((P, c) => { copyTilemapRect(P, c.hl, c.de, c.b, c.c); })],
  [BANK_MENU_LIB, 0x4558, hook((P, c) => { fillTilemapRect(P, c.de, c.b, c.c, c.h); })],
  [BANK_MENU_LIB, 0x4CAB, hookGen((P, c) => flushWram3MapRows(P, c.b))],
  [BANK_MENU_LIB, 0x4DEB, hook((P, c) => { restoreMenuBgAndDrawPanel(P, c.b, c.c); })],
];
