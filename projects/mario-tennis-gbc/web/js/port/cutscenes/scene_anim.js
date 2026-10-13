// The epilogue's animated sprites (bank $03): a row of six small sprites whose tiles are swapped frame by frame,
// $36 animation frames in six groups of nine, run from a frame task of the epilogue scene (match_10.asm).
// Port of SetupSceneAnimationPalettes and UpdateSceneAnimation (src/engine/cutscenes/scrolltext_03.asm) and the
// LoadCutsceneAnimFrameGfx_* routines (scrolltext_03.asm and cutsceneanim_03.asm) of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses are its own.
//
// Each LoadCutsceneAnimFrameGfx_X_Y routine owns the animation frames X-Y (wSceneAnimFrame, WRAM 6) and a sprite
// slot (its tiles at a fixed tile number, its x position, its palette): on one of its frames it decompresses the
// frame's tiles (CutsceneAnimFrameLZ_<frame>, through WRAM 1), queues them to VRAM and queues its sprite with the
// frame's template; past its frames it queues the last template again; before them (all but the first) nothing.
// The compressed frames' sizes are read off their LZ streams. The frame advances when wCutsceneSlideTimer & 3 is 0, up to $36.
// Reached only from the debug match-select map's epilogue scene, which no recording reaches: covered by the
// routine tests (web/tests/port/routines_cutscenes.mjs).
import { WRAM_STAGING, WRAM_SCENE, TILE_SIZE, vTiles0, wDecompBuffer, ram, queueVRAMCopy, decompressData, loadPaletteShadow,
  queueSpriteTemplate, wramBank, callSub, pushWramBank, popWramBank, hook, FZ, FN, FH, FC, cpFlags } from "./common.js";

const BANK = 0x03;
const SceneAnimObjPalette0_03 = 0x65BC, SceneAnimObjPalette1_03 = 0x65C4;   // object palettes 2 and 3
const wSceneAnimFrame = 0xD000;                              // WRAM 6
const ANIM_FRAMES = 0x36, FRAMES_PER_GROUP = 9, SPRITE_Y = 0x80;
// the groups: their routine's address, first frame, tile number, x, palette, first template, template size
const GROUPS = [
  { addr: 0x5B89, first: 0x00, tile: 0x00, x: 0xFE, palette: 3, templates: 0x6E75, size: 9 },   // LoadCutsceneAnimFrameGfx_00_08
  { addr: 0x5D38, first: 0x09, tile: 0x04, x: 0x0E, palette: 2, templates: 0x6EC6, size: 9 },   // _09_11
  { addr: 0x5EEC, first: 0x12, tile: 0x08, x: 0x1E, palette: 3, templates: 0x6F17, size: 9 },   // _12_1A
  { addr: 0x60A0, first: 0x1B, tile: 0x0C, x: 0x2E, palette: 3, templates: 0x6F68, size: 5 },   // _1B_23
  { addr: 0x6254, first: 0x24, tile: 0x0E, x: 0x36, palette: 2, templates: 0x6F95, size: 5 },   // _24_2C
  { addr: 0x6408, first: 0x2D, tile: 0x10, x: 0x3E, palette: 3, templates: 0x6FC2, size: 5 },   // _2D_35 (cutsceneanim_03.asm)
];

// CutsceneAnimFrameLZ_00 ... _35, the compressed tiles of each animation frame
const CutsceneAnimFrameLZ = [
  0x65D0, 0x65FA, 0x6628, 0x6658, 0x6699, 0x66DB, 0x6723, 0x676C, 0x67B5,
  0x67FC, 0x6822, 0x6850, 0x687E, 0x68C1, 0x690C, 0x6957, 0x69A2, 0x69EC,
  0x6A35, 0x6A5C, 0x6A8D, 0x6AC2, 0x6B04, 0x6B49, 0x6B92, 0x6BDC, 0x6C26,
  0x6C6B, 0x6C7A, 0x6C89, 0x6C98, 0x6CAB, 0x6CC1, 0x6CD7, 0x6CED, 0x6D03,
  0x6D19, 0x6D28, 0x6D37, 0x6D46, 0x6D5A, 0x6D6F, 0x6D85, 0x6D9B, 0x6DB1,
  0x6DC7, 0x6DD6, 0x6DE5, 0x6DF4, 0x6E07, 0x6E1D, 0x6E33, 0x6E49, 0x6E5F,
];
// a frame's decoded size in 16-byte blocks (the ROM's `ld c, CutsceneAnimFrameLZ_xx_SIZE / 16`), from its LZ
// stream (the format of DecompressData, 00:1797: a flag byte for 8 items, low bit first; 1: a literal byte; 0: a
// back-reference lo, hi of (hi & $1F) + 3 bytes; 0, 0 ends)
const BLOCKS = new Map();
function frameBlocks(P, frame) {
  if (BLOCKS.has(frame)) return BLOCKS.get(frame);
  let p = CutsceneAnimFrameLZ[frame], size = 0;
  for (let done = false; !done;) {
    const flags = P.rom.u8(BANK, p++);
    for (let bit = 0; bit < 8 && !done; bit++) {
      if (flags >> bit & 1) { p++; size++; continue; }
      const lo = P.rom.u8(BANK, p++), hi = P.rom.u8(BANK, p++);
      if (!lo && !hi) done = true; else size += (hi & 0x1F) + 3;
    }
  }
  BLOCKS.set(frame, size >> 4);
  return size >> 4;
}

// SetupSceneAnimationPalettes (03:5B28): the animation from frame 0; object palettes 2 and 3. Leaves a = the WRAM
// bank restored and the entry flags.
export function setupSceneAnimationPalettes(P) {
  pushWramBank(P, WRAM_SCENE);
  P.bus.w8(wSceneAnimFrame, 0);
  loadPaletteShadow(P, SceneAnimObjPalette0_03, 8 + 2, 1);
  loadPaletteShadow(P, SceneAnimObjPalette1_03, 8 + 3, 1);
  const af = popWramBank(P);
  return { a: af >> 8, f: af & 0xF0 };
}
// UpdateSceneAnimation (03:5B4D): the six groups' sprites, then the next frame (above). Leaves a = the WRAM bank
// restored and the entry flags.
export function updateSceneAnimation(P) {
  const { bus } = P;
  pushWramBank(P, WRAM_SCENE);
  let r = {};
  GROUPS.forEach((g, i) => { r = callSub(P, 0x5B59 + 3 * i, () => loadCutsceneAnimFrameGfx(P, g)); });
  wramBank(P, WRAM_SCENE);
  if (!(ram(P).cutsceneSlideTimer & 3)) {
    const frame = bus.u8(wSceneAnimFrame);
    r = { b: frame };
    if (frame < ANIM_FRAMES) bus.w8(wSceneAnimFrame, frame + 1);
  }
  const af = popWramBank(P);
  return { ...r, a: af >> 8, f: af & 0xF0 };
}
// LoadCutsceneAnimFrameGfx_00_08 (03:5B89) ... _2D_35 (03:6408): one group (above)
export function loadCutsceneAnimFrameGfx(P, g) {
  wramBank(P, WRAM_SCENE);
  const frame = P.bus.u8(wSceneAnimFrame);
  if (g.first && frame < g.first) return { a: (frame - g.first) & 0xFF, b: frame, f: cpFlags(frame, g.first) };
  const k = frame - g.first, tileAddr = g.tile * TILE_SIZE;
  if (k >= FRAMES_PER_GROUP) return queueSpriteTemplate(P, g.templates + (FRAMES_PER_GROUP - 1) * g.size, g.x, SPRITE_Y, g.tile, g.palette);
  const src = CutsceneAnimFrameLZ[frame], blocks = frameBlocks(P, frame);
  wramBank(P, WRAM_STAGING);
  decompressData(P, src, wDecompBuffer + tileAddr);
  queueVRAMCopy(P, wDecompBuffer + tileAddr, vTiles0 + tileAddr, blocks);
  return queueSpriteTemplate(P, g.templates + k * g.size, g.x, SPRITE_Y, g.tile, g.palette);
}

export const HOOKS = [
  hook(BANK, 0x5B28, setupSceneAnimationPalettes),
  hook(BANK, 0x5B4D, updateSceneAnimation),
  ...GROUPS.map(g => hook(BANK, g.addr, P => loadCutsceneAnimFrameGfx(P, g))),
];
