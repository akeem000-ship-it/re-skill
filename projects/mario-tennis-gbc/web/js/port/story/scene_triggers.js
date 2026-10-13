// A location's triggers and its scene (bank $0A, $5574-$59D8): running the map record of a facing tile, a tile
// trigger or an exit; the story locations' table; loading a story scene's graphics and maps; and the scene's
// scroll (the UpdateSceneScroll frame task blits the BG row or column the camera brings into view).
// Port of scene_triggers_0a.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm),
// whose routine names these are.
//
// Map records (8 bytes, in the location's bank; the lists end with id $FF): [id, facing mask, condition(2),
// handler(2), arg6, arg7] (FindStoryScriptEntry, story_interact.js). The handler is a message id below $4000
// (dialogue) or a script in the location's bank. An exit's arg6/arg7 are the destination location and entry
// point; a tile trigger with arg6 = 1 acts only on an A press, not when walked onto.
// Tests: web/tests/port/routines_story.mjs; lockstep on out/engine/rec2.mtrec and out/port/story1.mtrec.
import {
  FZ, FN, FH, FC, WRAM_STAGING, WRAM_COURT_PLANES, WRAM_SCREEN, WRAM_SCENE, BANK_STORY, hook, hookGen,
  BlitBGRowFrom64, BlitBGColumnFrom64, addFlags, subFlags,
} from "./common.js";
import { farCopyBytes, loadPaletteShadow } from "../home/palettes.js";
import { decompressDataFromBank, copyDataFromBank } from "../home/decompress.js";
import { queueVRAMCopy } from "../home/memory.js";
import { registerFrameTask, unregisterFrameTask } from "../home/colorfade.js";
import { findStoryScriptEntry, runStoryScriptOrDialogue } from "./story_interact.js";
import { initSceneTileAnimations } from "./scene_tileanim.js";
import { SceneGfxSlotTable, SCENE_RECORD_SIZE } from "./scene_collision.js";

const BANK = BANK_STORY;
const StoryLocationTable_0a = 0x564F, STORY_LOCATION_SIZE = 6, NUM_STORY_LOCATIONS = 0x2A;
export const UpdateSceneScroll = 0x5976;
const SCENE_SCROLL_PRIORITY = 0x0F, SCENE_LIST_LENGTH = 0x25, MAP_TILES = 0x40;
const TILETRIGGER_PRESS_ONLY = 0x01;
const rRAMB = 0x4000;
const wDecompBuffer = 0xD000, wTextTileBuffer = 0xD800, wBehaviorMap = 0xD400, wCollisionMap = 0xD000;
const wScreenAttrmap = 0xD000, wShadowTilemap = 0xD000, wStorySceneRecord = 0xDC08, STORY_SCENE_RECORD_SIZE = 0x88;
const VRAM_BANK1_TILES = 0xB000, VRAM_BANK1_TILES1 = 0xA800;
const vBGMap0 = 0x9800, rVBK = 0xFF4F;
// the BG rows / columns UpdateSceneScroll blits as the camera moves (b: column offset, c: row offset)
const BLIT_ROW_BELOW = 0xFB13, BLIT_ROW_ABOVE = 0xFB00, BLIT_COLUMN_RIGHT = 0x15FA, BLIT_COLUMN_LEFT = 0x00FA;

// The map record for id d in the list at wMap*Ptr, copied to wStoryMapRecord; null when there is none.
function findRecord(P, listPtrName, id) {
  const at = findStoryScriptEntry(P, P.bus.u16(P.A[listPtrName]), id);
  if (!at) return null;
  farCopyBytes(P, P.V.storyLocationBank, at, P.A.storyMapRecord, 8);
  return at;
}
const recordHandler = P => P.bus.u16(P.A.storyMapRecord + 4);
// the registers the record's handler gets: FarCopyBytes left bc = 0 and de past the record
const afterCopy = P => ({ bc: 0, de: P.A.storyMapRecord + 8 });

// RunFacingTileScript (0A:5574): the action of the tile the player faces (id a). Keeps the registers.
export function* runFacingTileScript(P, id) {
  P.V.unusedStoryScriptId = id;
  if (findRecord(P, "mapFacingScriptsPtr", id)) yield* runStoryScriptOrDialogue(P, 0, recordHandler(P), afterCopy(P));
}
// RunQueuedTriggerScript (0A:55A5): the step-on trigger walked onto (id a), unless it acts on A presses only.
export function* runQueuedTriggerScript(P, id) {
  P.V.unusedStoryScriptId = id;
  if (!findRecord(P, "mapTileTriggersPtr", id)) return;
  if (P.bus.u8(P.A.storyMapRecord + 6) === TILETRIGGER_PRESS_ONLY) return;
  yield* runStoryScriptOrDialogue(P, 0, recordHandler(P), afterCopy(P));
}
// RunTileTriggerScript (0A:55DD): the trigger under the player on an A press (id a).
export function* runTileTriggerScript(P, id) {
  if (findRecord(P, "mapTileTriggersPtr", id)) yield* runStoryScriptOrDialogue(P, 0, recordHandler(P), afterCopy(P));
}
// RunLocationExit (0A:560B): exit id a: its script, then the destination location and entry point. Always maps
// SRAM bank 0 after.
export function* runLocationExit(P, id) {
  const { V } = P;
  V.unusedStoryScriptId = id;
  if (findRecord(P, "mapExitTriggersPtr", id)) {
    yield* runStoryScriptOrDialogue(P, 0, recordHandler(P), afterCopy(P));
    V.storyModeCurrentLocation = P.bus.u8(P.A.storyMapRecord + 6);
    V.storyModeEntryPoint = P.bus.u8(P.A.storyMapRecord + 7);
  }
  V.sramBank = 0;
  P.bus.w8(rRAMB, 0);
}

// GetStoryLocationCount (0A:574B): $2A locations.
export const getStoryLocationCount = () => NUM_STORY_LOCATIONS;
// GetStoryLocationRecordPtr (0A:574E): hl = location a's record [location, scene, map scripts slot(2), music, 0].
export function getStoryLocationRecordPtr(a) {
  const x = (a * STORY_LOCATION_SIZE) & 0xFF, sum = x + (StoryLocationTable_0a & 0xFF), l = sum & 0xFF;
  const t = (l + (StoryLocationTable_0a >> 8) + (sum > 0xFF ? 1 : 0)) & 0xFF;
  const h = (t - l) & 0xFF;
  return { hl: h << 8 | l, a: h, f: subFlags(t, l) };
}

// Unused_0a_CopySceneTilemapToVram (0A:575C): an older copy of the scene map round the camera into the BG map
// (20 rows of 22 tiles, both planes). Nothing calls it. Keeps the registers.
export function unusedCopySceneTilemapToVram(P) {
  const { bus, V } = P;
  const camX = V.cameraX >> 8, camY = V.cameraY >> 8;
  const y32 = (camY & 0x1F) * 32, dest = (vBGMap0 + ((y32 & 0xFF00) | ((y32 + (camX & 0x1F)) & 0xFF))) & 0xFFFF;
  const y64 = (camY * 64) & 0xFFFF, src = (0xD000 + ((y64 & 0xFF00) | ((y64 + camX) & 0xFF))) & 0xFFFF;
  const plane = (wram, vbk) => {
    P.wramBank(wram);
    bus.w8(rVBK, vbk);
    let hl = src, de = dest;
    for (let i = 0; i < 20; i++) ({ hl, de } = unusedCopySceneTilemapChunk(P, hl, de));
  };
  plane(WRAM_COURT_PLANES, 1);
  plane(WRAM_SCREEN, 0);
}
// Unused_0a_CopySceneTilemapChunk (0A:5823): one row of 22 tiles from hl to de, both wrapping; returns hl and de
// moved a row on (and the registers it leaves).
export function unusedCopySceneTilemapChunk(P, hl0, de0) {
  const { bus } = P;
  let hl = hl0, de = de0;
  for (let c = 0x16; c > 0; c--) {
    bus.w8(de, bus.u8(hl));
    hl = (hl + 1) & 0xFFFF; de = (de + 1) & 0xFFFF;
    if (!(hl & 0x3F)) { hl = (hl - 0x40) & 0xFFFF; de = (de - 0x20) & 0xFFFF; }
    else if (!(de & 0x1F)) de = (de - 0x20) & 0xFFFF;
  }
  const h = (((hl0 + 0x40) & 0xFFFF) >> 8 & 0x0F) | 0xD0, nhl = h << 8 | ((hl0 + 0x40) & 0xFF);
  const e = (de0 & 0xFF) + 0x20, d = ((de0 >> 8) + (e > 0xFF ? 1 : 0)) & 0xFF & ~0x04;
  return { hl: nhl, de: d << 8 | (e & 0xFF), a: e & 0xFF, c: 0 };
}

// LoadStorySceneGraphics (0A:585D): load story scene a: tiles (queued for VRAM 1) and the text tiles, the behaviour
// and collision maps (WRAM 6), attribute map (WRAM 2) and tilemap (WRAM 3), BG palettes 2-7, and the header
// (wStorySceneRecord: scroll minimum and size into wMapScrollMinX..wMapHeightTiles); then its tile animations.
// Keeps the registers (WRAM 6 left mapped).
export function loadStorySceneGraphics(P, scene, sp = P.cpu.sp) {
  const { bus, V } = P;
  V.currentScene = scene;
  const base = (scene * SCENE_RECORD_SIZE + SceneGfxSlotTable) & 0xFFFF, w = i => P.rom.u16(BANK, (base + 2 * i) & 0xFFFF);
  const unpack = (word, dest) => decompressDataFromBank(P, word >> 8, word & 0xFF, dest);
  const copy = (word, dest, n) => copyDataFromBank(P, word >> 8, word & 0xFF, dest, n);
  P.wramBank(WRAM_STAGING);
  unpack(w(7), wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, VRAM_BANK1_TILES, 128);
  queueVRAMCopy(P, wTextTileBuffer, VRAM_BANK1_TILES1, 0x80);
  P.wramBank(WRAM_SCENE);
  unpack(w(5), wBehaviorMap);
  unpack(w(4), wCollisionMap);
  P.wramBank(WRAM_COURT_PLANES);
  unpack(w(3), wScreenAttrmap);
  P.wramBank(WRAM_SCREEN);
  unpack(w(2), wShadowTilemap);
  P.wramBank(WRAM_STAGING);
  copy(w(1), wDecompBuffer, 0x40);
  loadPaletteShadow(P, wDecompBuffer + 16, 2, 6);
  P.wramBank(WRAM_SCENE);
  copy(w(0), wStorySceneRecord, STORY_SCENE_RECORD_SIZE);
  V.mapScrollMinX = bus.u8(wStorySceneRecord + 2); V.mapScrollMinY = bus.u8(wStorySceneRecord + 3);
  V.mapWidthTiles = bus.u8(wStorySceneRecord + 4); V.mapHeightTiles = bus.u8(wStorySceneRecord + 5);
  initSceneTileAnimations(P, V.currentScene, sp - 2);
}

// InitSceneScroll (0A:5930): the camera and scroll at 0, a 64x64-tile map, and the UpdateSceneScroll frame task
// (priority $0F). Keeps the registers.
export function initSceneScroll(P, sp = P.cpu.sp) {
  const { V } = P;
  V.scrollListLength = SCENE_LIST_LENGTH;
  V.scrollY = 0; V.scrollX = 0; V.bGColumnBlitPending = 0; V.bGRowBlitPending = 0;
  V.cameraX = 0; V.cameraY = 0; V.cameraTileXPrev = 0; V.cameraTileYPrev = 0;
  V.mapScrollMinX = 0; V.mapScrollMinY = 0; V.mapWidthTiles = MAP_TILES; V.mapHeightTiles = MAP_TILES;
  registerFrameTask(P, SCENE_SCROLL_PRIORITY, UpdateSceneScroll, sp - 2);
}
// StopSceneScrollTask (0A:596F)
export function stopSceneScrollTask(P, sp = P.cpu.sp) { return unregisterFrameTask(P, UpdateSceneScroll, sp - 2); }
// UpdateSceneScroll (0A:5976), a frame task: when the camera's tile row or column changed, blit the row
// (or column) coming into view; then the scroll registers' shadows from the camera (pixels) and the screen shake.
// Returns the registers it leaves.
export function updateSceneScroll(P) {
  const { V } = P;
  let r = {};
  const dy = ((V.cameraY >> 8) - V.cameraTileYPrev) & 0xFF;
  if (dy) r = P.callRom(0, BlitBGRowFrom64, { bc: dy & 0x80 ? BLIT_ROW_ABOVE : BLIT_ROW_BELOW });
  const dx = ((V.cameraX >> 8) - V.cameraTileXPrev) & 0xFF;
  if (dx) r = P.callRom(0, BlitBGColumnFrom64, { bc: dx & 0x80 ? BLIT_COLUMN_LEFT : BLIT_COLUMN_RIGHT });
  V.cameraTileYPrev = V.cameraY >> 8;
  const sy = ((V.cameraY << 3) & 0xFFFF) >> 8;
  V.scrollY = sy + V.screenShakeOffsetY;
  V.cameraTileXPrev = V.cameraX >> 8;
  const sx = ((V.cameraX << 3) & 0xFFFF) >> 8, shake = V.screenShakeOffsetX;
  V.scrollX = sx + shake;
  const out = { a: (sx + shake) & 0xFF, f: addFlags(sx, shake), hl: P.A.screenShakeOffsetX };
  if (r.bc !== undefined) Object.assign(out, { bc: r.bc, de: r.de });
  return out;
}

export const HOOKS = [
  [BANK, 0x5574, hookGen((P, c) => runFacingTileScript(P, c.a))],
  [BANK, 0x55A5, hookGen((P, c) => runQueuedTriggerScript(P, c.a))],
  [BANK, 0x55DD, hookGen((P, c) => runTileTriggerScript(P, c.a))],
  [BANK, 0x560B, hookGen((P, c) => runLocationExit(P, c.a))],
  [BANK, 0x574B, hook(() => ({ a: NUM_STORY_LOCATIONS }))],
  [BANK, 0x574E, hook((P, c) => getStoryLocationRecordPtr(c.a))],
  [BANK, 0x575C, hook(P => { unusedCopySceneTilemapToVram(P); })],
  [BANK, 0x5823, hook((P, c) => unusedCopySceneTilemapChunk(P, c.hl, c.de))],
  [BANK, 0x585D, hook((P, c) => { loadStorySceneGraphics(P, c.a, c.sp); })],
  [BANK, 0x5930, hook((P, c) => { initSceneScroll(P, c.sp); })],
  [BANK, 0x596F, hook((P, c) => stopSceneScrollTask(P, c.sp))],
  [BANK, 0x5976, hook(P => updateSceneScroll(P))],
];
