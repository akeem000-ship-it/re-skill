// The match's graphics (bank $28): the palettes and tiles every match loads (the ball, effects, HUD font), the
// minigames' variants, the effect frames swapped in during play and the story match's extra tiles. A port of
// variants_28 in the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm), whose names
// and addresses these are. The tiles are queued for VRAM through the bank-0 routines (palettes: LoadPaletteShadow,
// tiles: QueueVRAMCopy, compressed sets: DecompressData), called as the ROM calls them, with bank $28 mapped.
// Covered by out/engine/exh1.mtrec and rec1.mtrec (every match start; the effects during play).
import { callHome } from "./draw.js";
import { advanceFrame } from "../home/frame.js";
import { sub8 } from "./leftovers.js";

const BANK = 0x28, VRAM_BANK1 = 0x2000, TILE = 16;
const vTiles0 = 0x8000, vTiles1 = 0x8800, vTiles2 = 0x9000;
const WRAM_STAGING = 1, DECOMP_BUFFER = 0xD000, TEXT_TILE_BUFFER = 0xD800, TEXT_TILE_BUFFER_SIZE = 0x800;   // WRAM bank 1
const MINIGAME_TENNIS_MACHINE_1 = 0x12, MATCHCONTEXT_MINIGAME = 2;
// bank $28 data
const MATCH_GRAPHICS_GFX = 0x4020, SPECIAL_HIT_EFFECT_TILES = 0x4360, BALL_TOUCH_TILES_A = 0x4460, BALL_TOUCH_TILES_B = 0x4560;
const MATCH_GFX_TILES_A = 0x45E0, MATCH_GFX_PALETTES_A = 0x4BA0, MATCH_GRAPHICS_PALETTES = 0x4BE0, MATCH_GFX_MAPS_A = 0x4BF0;
const VARIANT_TILES = [0x4D30, 0x4E30, 0x5130, 0x5470, 0x5490], MATCH_SHARED_TILES = 0x5590, MATCH_GFX_PALETTES_B = 0x5E30;
const VARIANT_PALETTES = [0x5E38, 0x5E50, 0x5E68, 0x5E78, 0x5E80, 0x5E98, 0x5EA0];
const SPRITE_FRAME_A_TABLE = 0x6080, SPRITE_FRAME_B_TABLE = 0x609A, EFFECT_FRAME_TABLE = 0x60C1;
const MATCH_GFX_TILES_B = 0x6180, MATCH_GFX_PALETTES_C = 0x6D1C, MATCH_STORY_GFX_PALETTES = 0x6D54;
const u8 = v => v & 0xFF, u16 = v => v & 0xFFFF;
const hl = v => ({ h: (v >> 8) & 0xFF, l: v & 0xFF }), de = v => ({ d: (v >> 8) & 0xFF, e: v & 0xFF });

// LoadPaletteShadow (00:05B0): n palettes from bank $28 into slot first (OBJ palettes are slots 8-15: ld_obj_pals)
const loadPalettes = (P, src, first, n) => callHome(P, 0x05B0, { ...hl(src), d: first, e: n }, BANK);
const objPals = (P, src, first, n) => loadPalettes(P, src, 8 + first, n);
// QueueVRAMCopy (00:0480): c 16-byte blocks from hl to VRAM de (+ VRAM_BANK1: bank 1)
const queueVRAMCopy = (P, src, dest, c) => callHome(P, 0x0480, { ...hl(src), ...de(dest), c }, BANK);
const decompress = (P, src, dest) => callHome(P, 0x1797, { ...hl(src), ...de(dest) }, BANK);   // DecompressData
const advanceFrameIfLcdOn = function* (P) { if (P.bus.u8(0xFF40) & 0x80) yield* advanceFrame(P); };   // AdvanceFrame (home/frame.js)

// 28:5EB0 LoadMatchGraphics: the match palettes (OBJ 0-2, BG 0-1), the ball and effects tiles (VRAM bank 1 tile $40),
// the court-side tiles (decompressed; the first 128 to $9000) and the text tiles; a minigame adds its variant
export function loadMatchGraphics(P) {
  P.wramBank(WRAM_STAGING);
  objPals(P, MATCH_GFX_PALETTES_A, 0, 3);
  loadPalettes(P, MATCH_GRAPHICS_PALETTES, 0, 2);
  queueVRAMCopy(P, MATCH_GRAPHICS_GFX, vTiles0 + 0x40 * TILE + VRAM_BANK1, 64);
  decompress(P, MATCH_GFX_TILES_A, DECOMP_BUFFER);
  queueVRAMCopy(P, DECOMP_BUFFER, vTiles2, 128);
  queueVRAMCopy(P, TEXT_TILE_BUFFER, vTiles1, TEXT_TILE_BUFFER_SIZE / 16);
  if (P.V.matchContext === MATCHCONTEXT_MINIGAME) loadMatchVariantGraphics(P);
}
// 28:5EFB LoadMatchVariantGraphics: by the minigame (wCurrentMinigameStoryMatch + 1, from the first tennis machine;
// earlier ones take the default), its palettes and tiles. The jump table's cases, by name of their first step:
function variantDefault(P) { queueVRAMCopy(P, MATCH_GFX_MAPS_A, vTiles0 + 0x20 * TILE + VRAM_BANK1, 32); }   // .carry
function variantShared(P) { loadMatchSharedTiles(P); }                                                    // .loadMatchSharedTiles
function variantPaletteShadow(P) {                                                                        // .loadPaletteShadow
  objPals(P, MATCH_GFX_PALETTES_B, 3, 1);
  objPals(P, VARIANT_PALETTES[0], 5, 3);
  queueVRAMCopy(P, VARIANT_TILES[0], vTiles0 + 0x10 * TILE + VRAM_BANK1, (VARIANT_TILES[1] - VARIANT_TILES[0]) / 16);
  loadMatchSharedTiles(P);
}
function variantMaps(P) { queueVRAMCopy(P, MATCH_GFX_MAPS_A, vTiles0 + 0x20 * TILE + VRAM_BANK1, 8); loadMatchSharedTiles(P); }   // .queueVRAMCopy
const variantTiles3 = (P, pal) => {                                                                       // .loadPaletteShadow2 / 3
  objPals(P, VARIANT_PALETTES[pal], 6, 2);
  queueVRAMCopy(P, VARIANT_TILES[3], vTiles0 + 0x3C * TILE + VRAM_BANK1, (VARIANT_TILES[4] - VARIANT_TILES[3]) / 16);
  loadMatchSharedTiles(P);
};
function variantPaletteShadow4(P) {                                                                       // .loadPaletteShadow4
  objPals(P, VARIANT_PALETTES[3], 7, 1);
  queueVRAMCopy(P, VARIANT_TILES[4], vTiles0 + 0x20 * TILE + VRAM_BANK1, (MATCH_SHARED_TILES - VARIANT_TILES[4]) / 16);
  queueVRAMCopy(P, VARIANT_TILES[3], vTiles0 + 0x3C * TILE + VRAM_BANK1, (VARIANT_TILES[4] - VARIANT_TILES[3]) / 16);
  loadMatchSharedTiles(P);
}
function variantMaps2(P) {                                                                                // .queueVRAMCopy2
  queueVRAMCopy(P, MATCH_GFX_MAPS_A, vTiles0 + 0x20 * TILE + VRAM_BANK1, 8);
  objPals(P, VARIANT_PALETTES[4], 6, 1);
  objPals(P, VARIANT_PALETTES[5], 7, 1);
  queueVRAMCopy(P, VARIANT_TILES[3], vTiles0 + 0x3C * TILE + VRAM_BANK1, (VARIANT_TILES[4] - VARIANT_TILES[3]) / 16);
  loadMatchSharedTiles(P);
}
function variantPaletteShadow5(P) {                                                                       // .loadPaletteShadow5
  objPals(P, VARIANT_PALETTES[1], 5, 3);
  queueVRAMCopy(P, VARIANT_TILES[1], vTiles0 + 0x10 * TILE + VRAM_BANK1, 16);
  queueVRAMCopy(P, VARIANT_TILES[2], vTiles0 + 0x20 * TILE + VRAM_BANK1, 16);
  loadMatchSharedTiles(P);
}
function variantPaletteShadow6(P) {                                                                       // .loadPaletteShadow6
  objPals(P, VARIANT_PALETTES[1], 5, 3);
  queueVRAMCopy(P, VARIANT_TILES[1], vTiles0 + 0x10 * TILE + VRAM_BANK1, (VARIANT_TILES[2] - VARIANT_TILES[1]) / 16);
  loadMatchSharedTiles(P);
}
const VARIANTS = [variantShared, variantShared, variantShared, variantShared, variantPaletteShadow, variantPaletteShadow,
  variantPaletteShadow, variantPaletteShadow, variantShared, variantPaletteShadow, P => variantTiles3(P, 6), P => variantTiles3(P, 2),
  variantPaletteShadow, variantMaps, variantPaletteShadow6, variantPaletteShadow5, variantMaps2, variantPaletteShadow4, variantDefault];
export function loadMatchVariantGraphics(P) {
  const k = u8(P.bus.u8(0xC8F7) - MINIGAME_TENNIS_MACHINE_1);            // wCurrentMinigameStoryMatch + 1
  if (P.bus.u8(0xC8F7) < MINIGAME_TENNIS_MACHINE_1) { variantDefault(P); return; }
  if (k >= VARIANTS.length) throw new Error(`LoadMatchVariantGraphics: minigame $${P.bus.u8(0xC8F7).toString(16)} past its jump table`);
  VARIANTS[k](P);
}
// 28:6024 LoadMatchSharedTiles_28: 20 shared tiles to tile 8
export function loadMatchSharedTiles(P) { queueVRAMCopy(P, MATCH_SHARED_TILES, vTiles0 + 0x08 * TILE, 20); }
// 28:6030 LoadSpecialHitEffectTiles (frames 0-3) / 28:6044 LoadBallTouchCharEffectTilesA / 28:6058 ...B (frames 0-1):
// frame a of the effect, four blocks to VRAM bank 1 tiles $74 / $78 / $7C
const rrca2 = a => u8((a >> 2) | (a << 6));
export function loadSpecialHitEffectTiles(P, a) { queueVRAMCopy(P, u16(SPECIAL_HIT_EFFECT_TILES + (rrca2(a) & 0xC0)), vTiles0 + 0x74 * TILE + VRAM_BANK1, 4); }
export function loadBallTouchCharEffectTilesA(P, a) { queueVRAMCopy(P, u16(BALL_TOUCH_TILES_A + (rrca2(a) & 0x40)), vTiles0 + 0x78 * TILE + VRAM_BANK1, 4); }
export function loadBallTouchCharEffectTilesB(P, a) { queueVRAMCopy(P, u16(BALL_TOUCH_TILES_B + (rrca2(a) & 0x40)), vTiles0 + 0x7C * TILE + VRAM_BANK1, 4); }
// 28:606C QueueMatchSpriteFrameA / 28:6086 QueueMatchSpriteFrameB: frame a of a 12-block sprite (by its table) to
// VRAM bank 1 tile $30
const spriteFrame = (P, table, a) => queueVRAMCopy(P, P.rom.u16(BANK, u16(table + u8(a * 2))), vTiles0 + 0x30 * TILE + VRAM_BANK1, 12);
export const queueMatchSpriteFrameA = (P, a) => spriteFrame(P, SPRITE_FRAME_A_TABLE, a);
export const queueMatchSpriteFrameB = (P, a) => spriteFrame(P, SPRITE_FRAME_B_TABLE, a);
// 28:60A0 LoadEffectFrameTiles_28: frame a (64 bytes each) of effect b, four blocks to VRAM bank 1 tile $30
export function loadEffectFrameTiles(P, a, b) {
  const src = u16(P.rom.u16(BANK, u16(EFFECT_FRAME_TABLE + u8(b * 2))) + a * 64);
  queueVRAMCopy(P, src, vTiles0 + 0x30 * TILE + VRAM_BANK1, 4);
}
// 28:60C9 LoadMatchStoryGfx: the story match's palettes and court-side tiles, uploaded 32 tiles a frame while the LCD
// is on. (Of the four text-tile uploads only the last is queued: the ROM loads hl/de/c for the other three and
// overwrites them.)
export function* loadMatchStoryGfx(P) {
  P.wramBank(WRAM_STAGING);
  objPals(P, MATCH_GFX_PALETTES_C, 1, 2);
  loadPalettes(P, MATCH_STORY_GFX_PALETTES, 0, 2);
  decompress(P, MATCH_GFX_TILES_B, DECOMP_BUFFER);
  for (let k = 0; k < 4; k++) {
    queueVRAMCopy(P, DECOMP_BUFFER + k * 32 * TILE, vTiles2 + k * 0x20 * TILE, 32);
    yield* advanceFrameIfLcdOn(P);
  }
  queueVRAMCopy(P, TEXT_TILE_BUFFER + 96 * TILE, vTiles1 + 0x60 * TILE, 32);
  yield* advanceFrameIfLcdOn(P);
}

// Each routine's last step is a call to a bank-0 routine (QueueVRAMCopy, LoadPaletteShadow ...) made with the
// registers the ROM gives it, the others flowing from one call to the next as in the ROM, so the registers the
// last call leaves are the routine's (passCpu); LoadMatchGraphics outside a minigame ends on its `cp`.
const tail = fn => (P, c) => { fn(P, c); c.passCpu(); };
export const HOOKS = [
  [BANK, 0x5EB0, (P, c) => {
    loadMatchGraphics(P); c.passCpu();
    const context = P.V.matchContext;
    if (context !== MATCHCONTEXT_MINIGAME) { c.a = context; c.f = sub8(context, MATCHCONTEXT_MINIGAME).f; }
  }],
  [BANK, 0x5EFB, tail(P => loadMatchVariantGraphics(P))],
  [BANK, 0x6024, tail(P => loadMatchSharedTiles(P))],
  [BANK, 0x6030, tail((P, c) => loadSpecialHitEffectTiles(P, c.a))],
  [BANK, 0x6044, tail((P, c) => loadBallTouchCharEffectTilesA(P, c.a))],
  [BANK, 0x6058, tail((P, c) => loadBallTouchCharEffectTilesB(P, c.a))],
  [BANK, 0x606C, tail((P, c) => queueMatchSpriteFrameA(P, c.a))],
  [BANK, 0x6086, tail((P, c) => queueMatchSpriteFrameB(P, c.a))],
  [BANK, 0x60A0, tail((P, c) => loadEffectFrameTiles(P, c.a, c.b))],
  [BANK, 0x60C9, P => loadMatchStoryGfx(P)],
];
