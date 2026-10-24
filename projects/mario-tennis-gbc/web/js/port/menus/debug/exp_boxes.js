// Bank $1a: the unused EXP gain screen's graphics and boxes: its frame task (the character's 16x16 sprite, and on
// request the caption row redrawn), its tiles and palettes (two layouts, by h), the message box and the yes / no
// box drawn into the tile buffer, and an unused 4x8 block filler.
// Port of src/engine/menus/debug/exp_boxes_1a.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own; graphics, palettes and tile tables are
// read from the ROM. Nothing in the game reaches this code.
// Tests: web/tests/port/routines_menus_misc.mjs; lockstep on out/port/dbg_expgain.mtrec (scripted).
import {
  FZ, FN, FAR, rom, romWait, u8, w8, wram, hook, hookGen, nop, cpFlags, WRAM_STAGING, WRAM_COURT_PLANES, WRAM_SCREEN, WRAM_SCENE,
  VRAM_BANK1, TILEMAP_WIDTH, TILE_SIZE, vTiles1, vTiles2, vBGMap0, wDecompBuffer, wTextTileBuffer,
  wExpScreenFlags, EXPSCREEN_REDRAW_CAPTION, wStoryModeMainCharacterOverworldSpriteColor,
  wStoryModeMainCharacterOverworldSprite, chain, farFlagsAt, runNow,
} from "./defs.js";
import { queueVRAMCopy, copyMemoryFast, processVRAMCopyQueues } from "../../home/memory.js";
import { decompressData } from "../../home/decompress.js";
import { loadPalettesMasterOnly } from "../../home/palettes.js";
import { queueSpriteTemplate } from "../../home/fade.js";
import { getRegs } from "../../home/cpu.js";
import { writeTileBufferCell } from "./expscreen.js";
import { drawExpScreenCaption } from "./exp_gauge.js";

export const BANK = 0x1A;
const rb = (P, a) => P.rom.u8(BANK, a);
const ExpScreenDrawTask_SpriteTemplate = 0x4840, SPRITE_X = 0x70, SPRITE_Y = 0x58, SPRITE_TILE = 0xC0;
const SPRITE_ATTR = 0x09;                                         // OAM_BANK1 | 1
// the caption rows' buffer ($d800 of WRAM 2 for the attributes, then of WRAM 3 for the tiles)
const CAPTION_ROWS = 0xD800, CAPTION_ROW = 15, CAPTION_BYTES = 2 * TILEMAP_WIDTH, CAPTION_ATTR = 0x01;
const CAPTION_BLANK = 0x20, CAPTION_EXP = 0x03;
const ExpScreenGfx0 = 0x5530, ExpScreenGfx1 = 0x5BE0, ExpScreenGfx2 = 0x5E20, ExpScreenGfx3 = 0x6060;
const ExpScreenGfx4 = 0x62A0, ExpScreenGfxPalettes0 = 0x64E0, ExpScreenGfx5 = 0x6650, ExpScreenGfxPalettes1 = 0x6668;
const ExpScreenGfx6 = 0x6680, ExpScreenGfx7 = 0x66C8, ExpScreenGfxPalettes2 = 0x6711, ExpScreenGfxPalettes3 = 0x6721;
const ExpScreenGfx8 = 0x6729, EXP_MAP_BLOCKS = 0x24;              // each map's 64 tiles (36 blocks)
const LAYOUT_SINGLE = 0x01;                                       // h: the layout without the partner's sprite
const ExpScreenMessageBoxTilemap = 0x4950, ExpScreenYesNoBoxTilemap = 0x4A41, TileBufferBlockCells_1a = 0x4AB4;
const Text_31_235 = 0x04EB, YES_NO_TEXT_AT = 0xD400 + 6 * TILEMAP_WIDTH + 2, YES_NO_TEXT_WIDTH = 0x20;

// Unused_1a_ExpScreenDrawTask (1A:477A), a frame task: the character sprite; when the caption is to be redrawn
// (wExpScreenFlags bit 7), rows 15-16 cleared (attribute 1) and the EXP caption queued, the request cleared
export function expScreenDrawTask(P) {
  const old = P.V.wramBank;
  wram(P, WRAM_SCENE);
  queueSpriteTemplate(P, ExpScreenDrawTask_SpriteTemplate, SPRITE_X, SPRITE_Y, SPRITE_TILE, SPRITE_ATTR, (P.cpu.sp - 12) & 0xFFFF);
  if (u8(P, wExpScreenFlags) & EXPSCREEN_REDRAW_CAPTION) {
    wram(P, WRAM_COURT_PLANES);
    for (let i = 0; i < CAPTION_BYTES; i++) w8(P, CAPTION_ROWS + i, CAPTION_ATTR);
    queueVRAMCopy(P, CAPTION_ROWS, vBGMap0 + CAPTION_ROW * TILEMAP_WIDTH + VRAM_BANK1, CAPTION_BYTES / 16);
    wram(P, WRAM_SCREEN);
    for (let i = 0; i < CAPTION_BYTES; i++) w8(P, CAPTION_ROWS + i, CAPTION_BLANK);
    runNow(drawExpScreenCaption(P, CAPTION_EXP));
    queueVRAMCopy(P, CAPTION_ROWS, vBGMap0 + CAPTION_ROW * TILEMAP_WIDTH, CAPTION_BYTES / 16);
    wram(P, WRAM_SCENE);
    w8(P, wExpScreenFlags, u8(P, wExpScreenFlags) & ~EXPSCREEN_REDRAW_CAPTION);
  }
  wram(P, old);
}
// Unused_1a_LoadExpScreenGfx (1A:4852): the screen's tiles (VRAM 1), BG palettes, the character's palette and its
// sprite tiles; then for layout h = 1 the second sprite's palette, the extra tiles (queue flushed first) and maps 2 /
// 1, else the partner sprite's tiles and palette and maps 4 / 3, into the buffers (WRAM 1)
export function loadExpScreenGfx(P, entry) {
  const r = { ...entry };
  const decompress = (src, dest) => chain(r, { hl: decompressData(P, src, dest), de: dest });
  const queue = (src, dest, blocks) => chain(chain(r, { hl: src, de: dest, c: blocks }), queueVRAMCopy(P, src, dest, blocks));
  const palettes = (src, d, e) => chain(chain(r, { hl: src, d, e }), loadPalettesMasterOnly(P, src, d, e));
  const copy = (src, dest) => chain(r, { ...copyMemoryFast(P, src, dest, EXP_MAP_BLOCKS), c: 0, f: FZ | FN });
  const staging = () => { wram(P, WRAM_STAGING); r.a = WRAM_STAGING; };
  const layout = entry.h;
  staging();
  decompress(ExpScreenGfx0, wDecompBuffer);
  queue(wDecompBuffer, vTiles2 + VRAM_BANK1, 0x80);
  queue(wTextTileBuffer, vTiles1 + VRAM_BANK1, 0x50);
  palettes(ExpScreenGfxPalettes0, 0, 8);
  staging();
  chain(r, rom(P, FAR.LoadIndexedPalette_18, { ...r, farF: farFlagsAt(P, 1), a: u8(P, wStoryModeMainCharacterOverworldSpriteColor), d: 0x0E }));
  chain(r, { a: u8(P, wStoryModeMainCharacterOverworldSprite), b: 0 });
  staging();
  decompress(ExpScreenGfx6, wDecompBuffer);
  queue(wDecompBuffer, vTiles1 + 0x40 * TILE_SIZE + VRAM_BANK1, 0x04);
  decompress(ExpScreenGfx7, wDecompBuffer);
  queue(wDecompBuffer, vTiles1 + 0x44 * TILE_SIZE + VRAM_BANK1, 0x04);
  palettes(ExpScreenGfxPalettes2, 9, 1);
  chain(r, { hl: entry.hl, a: layout, f: cpFlags(layout, LAYOUT_SINGLE) });
  if (layout !== LAYOUT_SINGLE) {
    decompress(ExpScreenGfx5, wDecompBuffer);
    queue(wDecompBuffer, vTiles1 + 0x48 * TILE_SIZE + VRAM_BANK1, 0x02);
    palettes(ExpScreenGfxPalettes1, 0x0A, 1);
    staging();
    copy(ExpScreenGfx4, wDecompBuffer);
    copy(ExpScreenGfx3, wDecompBuffer + 64 * TILE_SIZE);
    return r;
  }
  chain(r, processVRAMCopyQueues(P, r.b));
  palettes(ExpScreenGfxPalettes3, 0x0F, 1);
  staging();
  decompress(ExpScreenGfx8, wTextTileBuffer + 96 * TILE_SIZE);
  queue(wTextTileBuffer + 96 * TILE_SIZE, vTiles1 + 0x4A * TILE_SIZE + VRAM_BANK1, 20);
  staging();
  copy(ExpScreenGfx2, wDecompBuffer);
  copy(ExpScreenGfx1, wDecompBuffer + 64 * TILE_SIZE);
  return r;
}
// a box of the tile buffer from a table of (attribute, tile) pairs, row by row
function drawBoxFromTable(P, table, left, top, width, height) {
  let hl = table;
  for (let c = top; c < top + height; c++)
    for (let b = left; b < left + width; b++, hl += 2) writeTileBufferCell(P, b, c, rb(P, hl), rb(P, hl + 1));
}
// Unused_1a_DrawExpScreenMessageBox (1A:4A18): the message box (rows 0-4, 20 columns)
export function drawExpScreenMessageBox(P) { drawBoxFromTable(P, ExpScreenMessageBoxTilemap, 0, 0, 20, 5); }
// Unused_1a_DrawExpScreenYesNoBox (1A:4A7D): the yes / no box (columns 0-5, rows 5-9) and its text
export function* drawExpScreenYesNoBox(P) {
  drawBoxFromTable(P, ExpScreenYesNoBoxTilemap, 0, 5, 6, 5);
  yield* romWait(P, FAR.RenderProportionalTextAt, { hl: Text_31_235, de: YES_NO_TEXT_AT, c: YES_NO_TEXT_WIDTH });
}
// Unused_1a_FillTileBufferBlockFromTable (1A:4AF4): the 4x8 block at columns 1-8, rows 11-14 from its table
export function fillTileBufferBlockFromTable(P) { drawBoxFromTable(P, TileBufferBlockCells_1a, 1, 0x0B, 8, 4); }

export const HOOKS = [
  [BANK, 0x4779, nop],                                              // Unused_1a_StubNop_1a_0
  [BANK, 0x477A, hook(P => { expScreenDrawTask(P); })],
  [BANK, 0x4852, hook((P, c) => loadExpScreenGfx(P, getRegs(c)))],
  [BANK, 0x4A18, hook(P => { drawExpScreenMessageBox(P); })],
  [BANK, 0x4A7D, hookGen(function* (P) { yield* drawExpScreenYesNoBox(P); })],
  [BANK, 0x4AF4, hook(P => { fillTileBufferBlockFromTable(P); })],
];
