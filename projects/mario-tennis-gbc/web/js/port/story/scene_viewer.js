// The behaviour map and map rectangles (bank $0A, $5F31-$6234): the behaviour map's cells (what a cell does: a
// trigger, an exit, an action, a long talk reach; its high nibble the id), copying rectangles of the collision,
// behaviour and scene maps (the scripts use them to open doors and move things), and the debug scene viewer
// (nothing calls it).
// Port of scene_viewer_0a.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm),
// whose routine names these are.
// Tests: web/tests/port/routines_story.mjs; lockstep on out/engine/rec2.mtrec and out/port/story1.mtrec.
import {
  FZ, FN, FH, FC, WRAM_COURT_PLANES, WRAM_SCREEN, WRAM_SCENE, WRAM_TEXT, BANK_STORY, hook, hookGen, advanceFrame,
  withWramBank, PrintHexByte, BlitBGRowFrom64, BlitBGColumnFrom64, zf, addHLFlags,
} from "./common.js";
import { copyMemoryBC } from "../home/memory.js";
import { registerFrameTask, unregisterFrameTask } from "../home/colorfade.js";
import { divHLByDE } from "../home/math.js";
import { getMapCellAddr, SceneGfxSlotTable, unusedLoadAndDisplayScene, unusedSceneViewerSelectScene } from "./scene_collision.js";
import { initSceneTileAnimations } from "./scene_tileanim.js";

const BANK = BANK_STORY;
const wBehaviorMap = 0xD400, wMapBuffer64 = 0xD000;
const CELL_ROW = 0x20, MAP_ROW = 0x40;
const DEBUG_CELL = 0x0E0E;                    // where ReadBehaviorMapCell prints the cell it read (debug overlay)
const DPadMoveVectors_0a = 0x6120;            // per d-pad nibble: (dx, dy) words of the viewer's camera
export const Unused_0a_StubNop = 0x60C1;
const BANK_TEXT = 0x05, InitTextWindows = 0x4096, RestoreShadowTilemap = 0x436F, RedrawTilemapRowRange = 0x7223;
const SCENE_VIEWER_LIST_STEP = 9;

// GetBehaviorMapCellAddr (0A:5F31): hl = the behaviour cell of tile (d, e). Returns { hl, f }.
export const getBehaviorMapCellAddr = (d, e) => getMapCellAddr(wBehaviorMap, d, e);
// ReadBehaviorMapCell (0A:5F4F): the behaviour cell of tile (d, e), from WRAM 6; printed in hex at (14, 14) of
// the debug overlay. Returns a (the flags: those of the address's computation).
export function readBehaviorMapCell(P, d, e) {
  const at = getBehaviorMapCellAddr(d, e);
  const a = withWramBank(P, WRAM_SCENE, () => P.bus.u8(at.hl));
  P.callRom(0, PrintHexByte, { a, de: DEBUG_CELL, hl: at.hl, b: a });
  return a;
}
// WriteBehaviorMapCell (0A:5F74): write cell (d, e) = a. Keeps the registers.
export function writeBehaviorMapCell(P, d, e, v) {
  const at = getBehaviorMapCellAddr(d, e);
  withWramBank(P, WRAM_SCENE, () => P.bus.w8(at.hl, v));
}
// CopyCollisionMapRect (0A:5F90) / CopyBehaviorMapRect (0A:5FD6): copy a rectangle of h x l tiles (halved to
// cells) from the cells of tile (b, c) to those of tile (d, e), row by row, in WRAM 6. Keeps the registers.
export function copyCollisionMapRect(P, size, from, to) { copyMapRect(P, 0xD000, size, from, to); }
export function copyBehaviorMapRect(P, size, from, to) { copyMapRect(P, wBehaviorMap, size, from, to); }
function copyMapRect(P, base, size, from, to) {
  const sra = v => ((v >> 1) | (v & 0x80)) & 0xFF;
  const w = sra(size >> 8), rows = sra(size & 0xFF);
  let de = getMapCellAddr(base, to >> 8, to & 0xFF).hl, hl = getMapCellAddr(base, from >> 8, from & 0xFF).hl;
  withWramBank(P, WRAM_SCENE, () => {
    let a = rows;
    do {
      copyMemoryBC(P, hl, de, w);
      de = (de + CELL_ROW) & 0xFFFF; hl = (hl + CELL_ROW) & 0xFFFF;
      a = (a - 1) & 0xFF;
    } while (a);
  });
}

// Unused_0a_InitSceneViewer (0A:601C): the debug scene viewer on scene a & $7F (bit 7: do not load it). Nothing
// calls it. Keeps the registers.
export function* unusedInitSceneViewer(P, a, sp) {
  const { V } = P;
  V.currentScene = a & 0x7F;
  V.scrollY = 0; V.scrollX = 0;
  V.unusedPrevSceneIndex = 0xFF;
  let n = 0;
  for (let at = SceneGfxSlotTable; P.rom.u16(BANK, at); at += 2) n++;
  V.scrollListLength = divHLByDE(P, n & 0xFFFF, SCENE_VIEWER_LIST_STEP) & 0xFF;
  if (!(a & 0x80)) yield* unusedLoadAndDisplayScene(P, a & 0x7F, 0);
  V.bGColumnBlitPending = 0; V.bGRowBlitPending = 0;
  yield* P.runRom(BANK_TEXT, InitTextWindows);
  registerFrameTask(P, 1, Unused_0a_StubNop, sp - 2);
  initSceneTileAnimations(P, V.currentScene);
}
// UnusedUnregisterSceneViewerFrameTask (0A:606F)
export function unusedUnregisterSceneViewerFrameTask(P, sp) { return unregisterFrameTask(P, Unused_0a_StubNop, sp - 2); }
// Unused_0a_InitSceneViewerDefault (0A:6076): the viewer on scene 0 (its count of the table steps c alone).
export function* unusedInitSceneViewerDefault(P) {
  const { V } = P;
  V.scrollY = 0; V.scrollX = 0;
  let c = 0xFF;
  for (let at = SceneGfxSlotTable; ; at += 2) { c = (c + 1) & 0xFF; if (!P.rom.u16(BANK, at)) break; }
  V.scrollListLength = divHLByDE(P, 0xFF00 | c, SCENE_VIEWER_LIST_STEP) & 0xFF;
  V.currentScene = 0;
  yield* unusedLoadAndDisplayScene(P, 0, 0);
  yield* P.runRom(BANK_TEXT, InitTextWindows);
  yield* P.runRom(BANK_TEXT, RestoreShadowTilemap);
  initSceneTileAnimations(P, V.currentScene);
}
// UnusedSceneViewerMainLoop (0A:60B3): the viewer, for ever.
export function* unusedSceneViewerMainLoop(P) {
  yield* unusedInitSceneViewerDefault(P);
  for (;;) {
    unusedUpdateSceneViewerScroll(P);
    yield* unusedSceneViewerSelectScene(P);
    yield* advanceFrame(P);
  }
}
// Unused_0a_UpdateSceneViewerScroll (0A:60C2): move the camera with the d-pad, blitting the BG row or column
// that comes into view, and set the scroll registers' shadows.
export function unusedUpdateSceneViewerScroll(P) {
  const { V } = P;
  const oldX = V.cameraX >> 8, oldY = V.cameraY >> 8;
  unusedMoveSceneViewerCamera(P);
  const y = V.cameraY >> 8;
  if (y !== oldY) P.callRom(0, BlitBGRowFrom64, { bc: y < oldY ? 0xFB00 : 0xFB13 });
  const x = V.cameraX >> 8;
  if (x !== oldX) P.callRom(0, BlitBGColumnFrom64, { bc: x < oldX ? 0x00FA : 0x15FA });
  V.scrollY = (V.cameraY << 3) >> 8 & 0xFF;
  V.scrollX = (V.cameraX << 3) >> 8 & 0xFF;
}
// Unused_0a_MoveSceneViewerCamera (0A:6160): the camera moved by the d-pad's vector.
export function unusedMoveSceneViewerCamera(P) {
  const { V } = P, at = DPadMoveVectors_0a + ((V.playerInputFlags >> 2) & 0x3C);
  V.cameraX = V.cameraX + P.rom.u16(BANK, at);
  V.cameraY = V.cameraY + P.rom.u16(BANK, at + 2);
}

// CopySceneTilemapRect (0A:619E): copy a rectangle of h x l tiles of the scene map from tile (b, c) to tile (d, e),
// both planes, then redraw the screen rows it covers (bank 5's RestoreShadowTilemap and RedrawTilemapRowRange).
// Keeps the registers.
export function* copySceneTilemapRect(P, size, from, to) {
  const old = P.V.wramBank;
  const de = getSceneTilemapAddr(to).hl, hl = getSceneTilemapAddr(from).hl;
  const plane = wram => {
    P.wramBank(wram);
    let s = hl, d = de, a = size & 0xFF;
    do {
      copyMemoryBC(P, s, d, size >> 8);
      d = (d + MAP_ROW) & 0xFFFF; s = (s + MAP_ROW) & 0xFFFF;
      a = (a - 1) & 0xFF;
    } while (a);
  };
  plane(WRAM_COURT_PLANES);
  plane(WRAM_SCREEN);
  P.wramBank(WRAM_TEXT);
  yield* P.runRom(BANK_TEXT, RestoreShadowTilemap);
  yield* P.runRom(BANK_TEXT, RedrawTilemapRowRange, { d: to & 0xFF, e: size & 0xFF });
  P.wramBank(old);
}
// GetSceneTilemapAddr (0A:621F): hl = the scene map cell of tile (h, l) (64 to a row; l taken as signed).
export function getSceneTilemapAddr(hl) {
  const row = (((hl & 0xFF) << 24 >> 24) * MAP_ROW) & 0xFFFF, col = hl >> 8;
  const sum = (col + row) & 0xFFFF;
  return { hl: (sum + wMapBuffer64) & 0xFFFF, f: addHLFlags(sum, wMapBuffer64, 0) };
}

export const HOOKS = [
  [BANK, 0x5F31, hook((P, c) => getBehaviorMapCellAddr(c.d, c.e))],
  [BANK, 0x5F4F, hook((P, c) => ({ a: readBehaviorMapCell(P, c.d, c.e), f: getBehaviorMapCellAddr(c.d, c.e).f }))],
  [BANK, 0x5F74, hook((P, c) => { writeBehaviorMapCell(P, c.d, c.e, c.a); })],
  [BANK, 0x5F90, hook((P, c) => { copyCollisionMapRect(P, c.hl, c.bc, c.de); })],
  [BANK, 0x5FD6, hook((P, c) => { copyBehaviorMapRect(P, c.hl, c.bc, c.de); })],
  [BANK, 0x601C, hookGen((P, c) => unusedInitSceneViewer(P, c.a, c.sp))],
  [BANK, 0x606F, hook((P, c) => unusedUnregisterSceneViewerFrameTask(P, c.sp))],
  [BANK, 0x6076, hookGen(P => unusedInitSceneViewerDefault(P))],
  [BANK, 0x60B3, hookGen(P => unusedSceneViewerMainLoop(P))],
  [BANK, 0x60C1, () => {}],
  [BANK, 0x60C2, hook(P => { unusedUpdateSceneViewerScroll(P); })],
  [BANK, 0x6160, hook(P => { unusedMoveSceneViewerCamera(P); })],
  [BANK, 0x619E, hookGen((P, c) => copySceneTilemapRect(P, c.hl, c.bc, c.de))],
  [BANK, 0x621F, hook((P, c) => getSceneTilemapAddr(c.hl))],
];
