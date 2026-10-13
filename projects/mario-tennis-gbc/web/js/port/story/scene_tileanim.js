// The camera on the player, court-scene graphics, and the scene's animated tiles (bank $0A, $6235-$6595).
// Port of scene_tileanim_0a.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm),
// whose routine names these are.
//
// Tile animations. A scene's header slot (asset slot 0) carries, after its 8 bytes, up to 4 tile animations
// (wSceneTileAnimEntries, WRAM 5): each a run of 4-byte frames [source tile (in slot 6's tile data), count of
// tiles, destination tile (VRAM 1 $8000 + n * 16), frames to show], ended by $FF and a byte; the list ends with
// $FE. wSceneTileAnimState holds each animation's cursor and countdown, wSceneTileAnimStart its first frame
// ($FF: no animation). The UpdateSceneTileAnimations frame task counts the animations down and, when one runs
// out, copies its next frame's tiles (through wSceneTileAnimBuffer) to VRAM.
// Tests: web/tests/port/routines_story.mjs; lockstep on out/engine/rec2.mtrec and out/port/story1.mtrec.
import {
  FZ, FN, FH, FC, WRAM_STAGING, WRAM_COURT_PLANES, WRAM_ACTORS, WRAM_TEXT, BANK_STORY, wActors, ACTORF_X,
  FLAG_VRAM_UPDATE_BUSY, FLAG_DEBUG_FREEZE_TILE_ANIM, hook, testFlag, withWramBank, decFlags,
} from "./common.js";
import { decompressDataFromBank, copyDataFromBank } from "../home/decompress.js";
import { queueVRAMCopy } from "../home/memory.js";
import { loadPaletteShadow, farCopyBytes } from "../home/palettes.js";
import { registerFrameTask, unregisterFrameTask } from "../home/colorfade.js";
import { getSceneSlotPtr, SceneGfxSlotTable, SCENE_RECORD_SIZE, SCENE_SLOT_HEADER, SCENE_SLOT_TILE_ANIMS } from "./scene_collision.js";

const BANK = BANK_STORY;
const PLAYER_CAMERA_X = 0xF610, PLAYER_CAMERA_Y = 0xF510;    // the camera corner: the player less (9.94, 10.94) tiles
const SCREEN_WIDTH_TILES = 0x14, SCREEN_HEIGHT_TILES = 0x12;
const VRAM_BANK1_TILES = 0xB000;          // vTiles2 + VRAM_BANK1 ($9000 in bank 1)
const VRAM_BANK1_TILES1 = 0xA800;         // vTiles1 + VRAM_BANK1
const wDecompBuffer = 0xD000, wTextTileBuffer = 0xD800, TEXT_TILE_BLOCKS = 0x80;
const wScoreboardColumnAttrs = 0xDEA8, wScoreboardColumnTiles = 0xDE80, SCOREBOARD_COLUMN_SIZE = 40;
const wCourtAttrmapSaved = 0xDC00, wCourtTilemapSaved = 0xD800, wScreenAttrmap = 0xD000;
const CameraFromPlayerSpriteList = 0x62EB, LoadCourtSceneGraphics = 0x62F8;
export const UpdateSceneTileAnimations = 0x6465;
const TILE_ANIMS = 4, ANIM_LIST_END = 0xFE, ANIM_END = 0xFF, NO_ANIM = 0xFF;
const wSceneTileAnimHeader = 0xDA80, wSceneTileAnimEntries = 0xDA88, TILE_ANIM_HEADER_SIZE = 0x88;
const wSceneTileAnimBuffer = 0xD900, wSceneTileAnimBufferPtr = 0xDB10, wSceneTileAnimSrcPtr = 0xDB12;

// UpdateCameraFromPlayer (0A:6235): the camera's corner on the player less (9.94, 10.94) tiles, clamped to the map
// (not cut to pixels). Returns bc = camera X, de = camera Y, and the registers it leaves. WRAM bank 4.
export function updateCameraFromPlayer(P) {
  const { bus, V } = P;
  P.wramBank(WRAM_ACTORS);
  const x = clamp((bus.u16(wActors + ACTORF_X) + PLAYER_CAMERA_X) & 0xFFFF, V.mapScrollMinX, V.mapWidthTiles - SCREEN_WIDTH_TILES);
  const y = clamp((bus.u16(wActors + ACTORF_X + 2) + PLAYER_CAMERA_Y) & 0xFFFF, V.mapScrollMinY, V.mapHeightTiles - SCREEN_HEIGHT_TILES);
  V.cameraX = x; V.cameraY = y;
  return { a: y >> 8, bc: x, de: y, hl: P.A.cameraY + 1 };
}
function clamp(hl, min, max) {
  if (((hl >> 8) - min) & 0x80) return min << 8;
  if (!(((hl >> 8) - (max & 0xFF)) & 0x80)) return (max & 0xFF) << 8;
  return hl;
}

// UnusedStepCourtSceneGfxStream (0A:629B): a stepper that would queue tiles from a list (its source is code
// bytes here); nothing calls it. Returns the registers it leaves.
export function unusedStepCourtSceneGfxStream(P) {
  const { bus } = P;
  let a = bus.u8(P.A.courtSceneGfxStepsLeft), out = {};
  if (!a) {
    let hl, v;
    for (;;) {
      hl = (CameraFromPlayerSpriteList + bus.u8(P.A.courtSceneGfxCursor)) & 0xFFFF;
      v = P.rom.u8(BANK, hl);
      if (v !== 0xFF) break;
      bus.w8(P.A.courtSceneGfxCursor, 0);
    }
    const b = v, c = P.rom.u8(BANK, hl + 1), e = P.rom.u8(BANK, hl + 2);
    a = P.rom.u8(BANK, hl + 3);
    const dest = (e * 16 + VRAM_BANK1_TILES) & 0xFFFF, src = (b * 16 + LoadCourtSceneGraphics) & 0xFFFF;
    out = queueVRAMCopy(P, src, dest, c);
    bus.w8(P.A.courtSceneGfxCursor, bus.u8(P.A.courtSceneGfxCursor) + 4);
    out = { ...out, bc: b << 8 | c };
    delete out.b; delete out.c;
  }
  bus.w8(P.A.courtSceneGfxStepsLeft, a - 1);
  return { ...out, a: (a - 1) & 0xFF, f: decFlags(a, 0) };
}

// LoadCourtSceneGraphics (0A:62F8): load court scene a's graphics for a match: tiles (queued for VRAM 1), the
// scoreboard column's attributes and tiles, the court's saved attribute map and tilemap (WRAM 2), and its BG and
// OBJ palettes. Keeps the registers.
export function loadCourtSceneGraphics(P, scene) {
  P.V.currentScene = scene;
  const base = (scene * SCENE_RECORD_SIZE + SceneGfxSlotTable) & 0xFFFF, w = i => P.rom.u16(BANK, (base + 2 * i) & 0xFFFF);
  const unpack = (word, dest) => decompressDataFromBank(P, word >> 8, word & 0xFF, dest);
  const copy = (word, dest, n) => copyDataFromBank(P, word >> 8, word & 0xFF, dest, n);
  P.wramBank(WRAM_STAGING);
  unpack(w(7), wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, VRAM_BANK1_TILES, 128);
  queueVRAMCopy(P, wTextTileBuffer, VRAM_BANK1_TILES1, TEXT_TILE_BLOCKS);
  P.wramBank(WRAM_ACTORS);
  copy(w(5), wScoreboardColumnAttrs, SCOREBOARD_COLUMN_SIZE);
  copy(w(4), wScoreboardColumnTiles, SCOREBOARD_COLUMN_SIZE);
  P.wramBank(WRAM_COURT_PLANES);
  unpack(w(3), wCourtAttrmapSaved);
  unpack(w(2), wCourtTilemapSaved);
  copy(w(1), wScreenAttrmap, 0x40);
  loadPaletteShadow(P, wScreenAttrmap + 16, 2, 6);
  loadPaletteShadow(P, wScreenAttrmap + 32 + 8, 8 + 3, 1);
}

// InitSceneTileAnimations (0A:639B): read the current scene's tile animations (above) and start the
// UpdateSceneTileAnimations frame task for them (none: no task). Keeps the registers. sp: the stack pointer at
// the call (RegisterFrameTask builds its entry below it).
export function initSceneTileAnimations(P, scene, sp = P.cpu.sp) {
  const { bus } = P, state = P.A.sceneTileAnimState, start = P.A.sceneTileAnimStart;
  withWramBank(P, WRAM_TEXT, () => {
    for (let i = 0; i < TILE_ANIMS; i++) { bus.w8(state + 2 * i, 0xFF); bus.w8(state + 2 * i + 1, 1); }
    for (let i = 0; i < TILE_ANIMS; i++) bus.w8(start + i, NO_ANIM);
    const hdr = getSceneSlotPtr(P, SCENE_SLOT_HEADER);
    copyDataFromBank(P, hdr >> 8, hdr & 0xFF, wSceneTileAnimHeader, TILE_ANIM_HEADER_SIZE);
    if (bus.u8(wSceneTileAnimEntries) === ANIM_LIST_END) return;
    let cursorAt = state + 2;                       // the next animation's cursor (a word on the ROM's stack)
    let de = wSceneTileAnimEntries, b = 0xFF, c = TILE_ANIMS - 1;
    bus.w8(state, 0);                              // animation 0 starts at entry 0
    bus.w8(start, 0);
    let hl = start + 1;
    for (;;) {
      b = (b + 1) & 0xFF;
      const a = bus.u8(de); de = (de + 1) & 0xFFFF;
      if (a === ANIM_LIST_END) break;
      if (a !== ANIM_END) continue;
      b = (b + 1) & 0xFF;                          // an animation's end: the next one starts after its byte
      const next = (b + 1) & 0xFF;
      bus.w8(hl, next);
      bus.w8(cursorAt, next); cursorAt += 2;
      bus.w8(state + 2 * (TILE_ANIMS - c) + 1, bus.u8(de) + 1);
      de = (de + 1) & 0xFFFF;
      hl++;
      if (!--c) break;
    }
    if (c) {                                        // the last end marked had no animation after it
      bus.w8(hl - 1, NO_ANIM);
      bus.w8(cursorAt - 2, NO_ANIM);
    }
    registerFrameTask(P, 1, UpdateSceneTileAnimations, sp - 2);
  });
}
// StopSceneTileAnimations (0A:6456): stop the frame task. Keeps the registers.
export function stopSceneTileAnimations(P, sp = P.cpu.sp) { unregisterFrameTask(P, UpdateSceneTileAnimations, sp - 2); }

// UpdateSceneTileAnimations (0A:6465), a frame task (not while VRAM is busy or the animations frozen): count each
// animation down; animations 0-2 that run out show their next frame (the fourth only counts: the loop stops at
// it first). Returns the flags of its early exits (else keeps the registers).
export function updateSceneTileAnimations(P) {
  const { bus } = P;
  if (testFlag(P, FLAG_VRAM_UPDATE_BUSY) || testFlag(P, FLAG_DEBUG_FREEZE_TILE_ANIM)) return { f: FH };
  withWramBank(P, WRAM_TEXT, () => {
    bus.w16(wSceneTileAnimBufferPtr, wSceneTileAnimBuffer);
    let c = 0, hl = P.A.sceneTileAnimStart;
    while (bus.u8(hl) !== NO_ANIM) {
      const countAt = P.A.sceneTileAnimState + c * 2 + 1, a = (bus.u8(countAt) - 1) & 0xFF;
      bus.w8(countAt, a);
      hl++;
      const b = c++;
      if (c === TILE_ANIMS) break;
      if (a) continue;
      advanceSceneTileAnimation(P, b);
      if (c === TILE_ANIMS) break;
    }
  });
}
// AdvanceSceneTileAnimation (0A:64BB): show animation a's next frame (from its first again after its end):
// copy its tiles from the scene's tile-animation slot (6) into wSceneTileAnimBuffer and queue them for VRAM;
// its countdown is the frame's length. Keeps the registers.
export function advanceSceneTileAnimation(P, anim) {
  const { bus } = P, state = P.A.sceneTileAnimState, cursor = P.A.sceneTileAnimCursor;
  bus.w8(cursor, bus.u8(state + anim * 2));
  let entry;
  for (;;) {
    entry = (wSceneTileAnimEntries + bus.u8(cursor)) & 0xFFFF;
    if (bus.u8(entry) !== ANIM_END) break;
    bus.w8(cursor, bus.u8(P.A.sceneTileAnimStart + anim));
  }
  const srcTile = bus.u8(entry), count = bus.u8(entry + 1), destTile = bus.u8(entry + 2), length = bus.u8(entry + 3);
  const size = (count << 4) & 0xFFFF, dest = (destTile * 16 + VRAM_BANK1_TILES) & 0xFFFF, srcOff = (srcTile * 16) & 0xFFFF;
  const slot = getSceneSlotPtr(P, SCENE_SLOT_TILE_ANIMS);
  farCopyBytes(P, slot >> 8, 0x4000 | (slot & 0xFF), wSceneTileAnimSrcPtr, 2);
  const buf = bus.u16(wSceneTileAnimBufferPtr);
  farCopyBytes(P, slot >> 8, (bus.u16(wSceneTileAnimSrcPtr) + srcOff) & 0xFFFF, buf, size);
  queueVRAMCopy(P, bus.u16(wSceneTileAnimBufferPtr), dest, (size >> 4) & 0xFF);
  bus.w16(wSceneTileAnimBufferPtr, bus.u16(wSceneTileAnimBufferPtr) + size);
  bus.w8(cursor, bus.u8(cursor) + 4);
  bus.w8(state + anim * 2, bus.u8(cursor));
  bus.w8(state + anim * 2 + 1, length);
}

export const HOOKS = [
  [BANK, 0x6235, hook(P => updateCameraFromPlayer(P))],
  [BANK, 0x629B, hook(P => unusedStepCourtSceneGfxStream(P))],
  [BANK, 0x62F8, hook((P, c) => { loadCourtSceneGraphics(P, c.a); })],
  [BANK, 0x639B, hook((P, c) => { initSceneTileAnimations(P, c.a, c.sp); })],
  [BANK, 0x6456, hook((P, c) => { stopSceneTileAnimations(P, c.sp); })],
  [BANK, 0x6465, hook(P => updateSceneTileAnimations(P))],
  [BANK, 0x64BB, hook((P, c) => { advanceSceneTileAnimation(P, c.a); })],
];
