// The scene's background and collision maps (bank $0A, $5C29-$5F30): copying the visible part of the 64x64-tile
// scene map (its tiles in WRAM 3, attributes in WRAM 2, wMapBuffer64) into the 32x32 BG map, the scene's asset
// slots, the collision map's cells, and the scene viewer's debug loaders (nothing calls those).
// Port of scene_collision_0a.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm), whose routine names these are.
//
// The scene model. A story scene (wCurrentScene) has 8 asset slots (SceneGfxSlotTable, $59D9, 16 bytes a scene:
// [header, palettes, tilemap, attribute map, collision map, behaviour map, -, tiles], each a (slot, bank) word
// into a bank's $4000 table). The tilemap and attribute map are 64x64 tiles; the collision map (WRAM 6 $D000)
// and the behaviour map (WRAM 6 $D400) have one byte per 2x2-tile cell, 32 to a row.
// Tests: web/tests/port/routines_story.mjs; lockstep on out/engine/rec2.mtrec and out/port/story1.mtrec.
import {
  FZ, FN, FH, FC, WRAM_STAGING, WRAM_COURT_PLANES, WRAM_SCREEN, WRAM_SCENE, WRAM_TEXT, BANK_STORY, hook, hookGen,
  advanceFrame, DisableLCDSafely, EnableLCD, zf, addHLFlags, withWramBank,
} from "./common.js";
import { decompressDataFromBank, copyDataFromBank } from "../home/decompress.js";
import { startVRAMDMAFromHL } from "../home/memory.js";
import { loadPalettesMasterOnly } from "../home/palettes.js";
import { updateCameraFromPlayer, stopSceneTileAnimations, initSceneTileAnimations } from "./scene_tileanim.js";
import { initSceneScroll, loadStorySceneGraphics } from "./scene_triggers.js";

const BANK = BANK_STORY;
export const SceneGfxSlotTable = 0x59D9, SCENE_RECORD_SIZE = 16;
export const SCENE_SLOT_HEADER = 0, SCENE_SLOT_TILE_ANIMS = 6;
const wMapBuffer64 = 0xD000, wCollisionMap = 0xD000, wBehaviorMap = 0xD400;
const wDecompBuffer = 0xD000, wTextTileBuffer = 0xD800, wStorySceneUnusedBuffer = 0xD800;
const wScreenAttrmap = 0xD000, wShadowTilemap = 0xD000, wTextBuffer = 0xC600;
const vBGMap0 = 0x9800, vTiles1 = 0x8800, vTiles2 = 0x9000;
const rVBK = 0xFF4F;
const MAP_ROW = 0x40, BG_ROW = 0x20;
const COPY_ROWS = 0x15, COPY_COLUMNS = 0x17;            // 21 rows of 23 tiles: the screen and a margin
const Text_30_374 = 0x0176;                              // the scene viewer's list of scenes
const BANK_TEXT = 0x05;
const RunPagedTextMenu = 0x4944, CreateMenuWindowFromText = 0x46B0, RestoreShadowTilemap = 0x436F;
const Unused_05_StubNop_05_0 = 0x4626, RunMenuSelection = 0x477F, CloseWindow = 0x72BD, ResetTextWindowState = 0x6E09;
const wMenuWindowState = 0xD820, wMenuWindowId = 0xD82F;     // (WRAM 5) the menu window just created, and its id
const PADF_B = 0x02;

// CopyScrolledSceneTilemapToVram (0A:5C29): with the LCD off, copy 21 x 23 tiles of the scene map round the camera
// (a = 0: first put the camera on the player) into both BG map planes, wrapping both the 64-wide map and the
// 32-wide BG map. Keeps the registers (VRAM bank 0 and WRAM bank 3 left mapped).
export function copyScrolledSceneTilemapToVram(P, a) {
  const { bus, V } = P;
  let camX, camY;
  if (a) { camX = V.cameraX >> 8; camY = V.cameraY >> 8; }
  else { const r = updateCameraFromPlayer(P); camX = r.bc >> 8; camY = r.de >> 8; }
  const dest = vBGMap0 + ((((camY & 0x1F) * 32) & 0xFF00) | ((((camY & 0x1F) * 32) + (camX & 0x1F)) & 0xFF));
  const rowOff = (camY * 64) & 0xFFFF, src = (wMapBuffer64 + ((rowOff & 0xFF00) | ((rowOff + camX) & 0xFF))) & 0xFFFF;
  const plane = (wram, vbk) => {
    P.wramBank(wram);
    bus.w8(rVBK, vbk);
    let hlRow = src, deRow = dest;
    for (let b = COPY_ROWS; b > 0; b--) {
      let hl = hlRow, de = deRow;
      for (let c = COPY_COLUMNS; c > 0; c--) {
        bus.w8(de, bus.u8(hl));
        hl = (hl + 1) & 0xFFFF; de = (de + 1) & 0xFFFF;
        if (!(hl & 0x3F)) { hl = (hl - MAP_ROW) & 0xFFFF; de = (de - BG_ROW) & 0xFFFF; }   // the map's row wrapped
        else if (!(de & 0x1F)) de = (de - BG_ROW) & 0xFFFF;                               // the BG map's
      }
      const l = (hlRow & 0xFF) + MAP_ROW;
      hlRow = l > 0xFF ? (((((hlRow >> 8) + 1) & 0x0F) | 0xD0) << 8) | (l & 0xFF) : (hlRow & 0xFF00) | l;
      const e = (deRow & 0xFF) + BG_ROW;
      deRow = e > 0xFF ? ((((deRow >> 8) + 1) & ~0x04) << 8) | (e & 0xFF) : (deRow & 0xFF00) | e;
    }
  };
  plane(WRAM_COURT_PLANES, 1);
  plane(WRAM_SCREEN, 0);
}

// GetSceneSlotPtr (0A:5D0B): hl = asset slot a of the current scene (a (slot, bank) word).
export function getSceneSlotPtr(P, slot) {
  const at = (P.V.currentScene * SCENE_RECORD_SIZE + SceneGfxSlotTable + ((slot << 1) & 0xFF)) & 0xFFFF;
  return P.rom.u16(BANK, at);
}

// Unused_0a_LoadSceneGraphicsDirect (0A:5D2A): the scene viewer's loader, with the LCD off (VRAM DMA directly).
// It indexes the table by 18 bytes a scene, not 16, and takes its slots one word late (words 1-8). Nothing calls
// it. Keeps the registers.
export function unusedLoadSceneGraphicsDirect(P, scene) {
  const { bus } = P, base = (SceneGfxSlotTable + scene * 18 + 2) & 0xFFFF;
  const w = i => P.rom.u16(BANK, (base + 2 * i) & 0xFFFF);
  const slot = (word, dest) => decompressDataFromBank(P, word >> 8, word & 0xFF, dest);
  P.wramBank(WRAM_STAGING);
  bus.w8(rVBK, 1);
  slot(w(7), wDecompBuffer);
  startVRAMDMAFromHL(P, wDecompBuffer, vTiles2, 0x80);
  startVRAMDMAFromHL(P, wTextTileBuffer, vTiles1, 0x80);
  P.wramBank(WRAM_SCENE);
  slot(w(6), wStorySceneUnusedBuffer);
  slot(w(4), wBehaviorMap);
  slot(w(3), wCollisionMap);
  P.wramBank(WRAM_COURT_PLANES);
  slot(w(2), wScreenAttrmap);
  P.wramBank(WRAM_SCREEN);
  slot(w(1), wShadowTilemap);
  P.wramBank(WRAM_STAGING);
  copyDataFromBank(P, w(0) >> 8, w(0) & 0xFF, wDecompBuffer, 0x40);
  loadPalettesMasterOnly(P, wDecompBuffer + 8, 1, 7);
}

// Unused_0a_LoadAndDisplayScene (0A:5DE2): load scene a that way, its header's scroll limits, and show it round
// the camera (b = 0: on the player). Nothing calls it.
export function* unusedLoadAndDisplayScene(P, scene, b) {
  const { bus, V } = P;
  P.callRom(0, DisableLCDSafely);
  unusedLoadSceneGraphicsDirect(P, scene);
  const hdr = getSceneSlotPtr(P, SCENE_SLOT_HEADER);
  copyDataFromBank(P, hdr >> 8, hdr & 0xFF, wTextBuffer, 0x10);
  V.mapScrollMinX = bus.u8(wTextBuffer + 2); V.mapScrollMinY = bus.u8(wTextBuffer + 3);
  V.mapWidthTiles = bus.u8(wTextBuffer + 4); V.mapHeightTiles = bus.u8(wTextBuffer + 5);
  copyScrolledSceneTilemapToVram(P, b);
  P.callRom(0, EnableLCD);
  yield* advanceFrame(P);
  yield* advanceFrame(P);
}

// Unused_0a_SceneViewerSelectScene (0A:5E1F): on B, pick a scene from the paged list and show it.
export function* unusedSceneViewerSelectScene(P) {
  const { V } = P;
  if (!(V.inputRisingEdge & PADF_B)) return;
  const pages = (((V.scrollListLength - 1) & 0xFF) >> 2) + 1;
  V.unusedPrevSceneIndex = V.currentScene;
  stopSceneTileAnimations(P);
  const r = yield* P.runRom(BANK_TEXT, RunPagedTextMenu, { a: pages, hl: Text_30_374 });
  V.currentScene = r.a;
  if (r.a === 0xFF) return;
  yield* unusedLoadAndDisplayScene(P, r.a, 1);
  initSceneTileAnimations(P, V.currentScene);
}
// UnusedSceneViewerSelectSceneMenu (0A:5E52): the same with a plain menu window. Nothing calls it.
export function* unusedSceneViewerSelectSceneMenu(P) {
  const { bus, V } = P;
  yield* P.runRom(BANK_TEXT, CreateMenuWindowFromText, { hl: Text_30_374, d: 1, e: 1 });
  bus.w8(wMenuWindowId, bus.u8(wMenuWindowState));
  yield* P.runRom(BANK_TEXT, RestoreShadowTilemap);
  yield* P.runRom(BANK_TEXT, Unused_05_StubNop_05_0);
  do yield* advanceFrame(P); while (V.playerInputFlags & PADF_B);
  const r = yield* P.runRom(BANK_TEXT, RunMenuSelection);
  V.currentScene = r.a;
  yield* P.runRom(BANK_TEXT, CloseWindow, { a: bus.u8(wMenuWindowId) });
  if (V.currentScene === 0xFF) return;
  yield* unusedLoadAndDisplayScene(P, V.currentScene, 1);
  yield* P.runRom(BANK_TEXT, RestoreShadowTilemap);
}
// Unused_0a_RunSceneSelectDebugMenu (0A:5E91): pick a scene from the list and load it as a story scene.
export function* unusedRunSceneSelectDebugMenu(P) {
  const { V } = P;
  V.scrollListLength = 8;
  V.unusedPrevSceneIndex = V.currentScene;
  stopSceneTileAnimations(P);
  const r = yield* P.runRom(BANK_TEXT, RunPagedTextMenu, { a: ((8 - 1) >> 2) + 1, hl: Text_30_374 });
  V.currentScene = r.a;
  if (r.a === 0xFF) return;
  yield* P.runRom(BANK_TEXT, ResetTextWindowState, { b: 1 });
  P.callRom(0, DisableLCDSafely);
  initSceneScroll(P, P.cpu.sp - 2);
  loadStorySceneGraphics(P, V.currentScene);
  copyScrolledSceneTilemapToVram(P, 0);
  P.callRom(0, EnableLCD);
  initSceneTileAnimations(P, V.currentScene);
}

// GetCollisionMapCellAddr (0A:5EDD): hl = the collision cell of tile (d, e) (cells are 2x2 tiles, 32 a row; the
// column by an arithmetic shift, as the ROM's sra). Returns { hl, f }.
export function getMapCellAddr(base, d, e) {
  const c = (((d & 0xFE) >> 1) | (d & 0x80)) & 0xFF, row = (e & 0xFE) * 16;
  const hl = (row + c) & 0xFFFF;
  return { hl: (hl + base) & 0xFFFF, f: addHLFlags(hl, base, zf(c)) };
}
export const getCollisionMapCellAddr = (d, e) => getMapCellAddr(wCollisionMap, d, e);
// ReadCollisionMapCell (0A:5EFB): the collision cell of tile (d, e), from WRAM 6 (the WRAM bank put back after).
export function readCollisionMapCell(P, d, e) {
  const at = getCollisionMapCellAddr(d, e);
  return withWramBank(P, WRAM_SCENE, () => P.bus.u8(at.hl));
}
// Unused_0a_WriteCollisionMapCell (0A:5F15): write it. Nothing calls it.
export function unusedWriteCollisionMapCell(P, d, e, v) {
  const at = getCollisionMapCellAddr(d, e);
  withWramBank(P, WRAM_SCENE, () => P.bus.w8(at.hl, v));
}

export const HOOKS = [
  [BANK, 0x5C29, hook((P, c) => { copyScrolledSceneTilemapToVram(P, c.a); })],
  [BANK, 0x5D0B, hook((P, c) => ({ hl: getSceneSlotPtr(P, c.a) }))],
  [BANK, 0x5D2A, hook((P, c) => { unusedLoadSceneGraphicsDirect(P, c.a); })],
  [BANK, 0x5DE2, hookGen((P, c) => unusedLoadAndDisplayScene(P, c.a, c.b))],
  [BANK, 0x5E1F, hookGen(P => unusedSceneViewerSelectScene(P))],
  [BANK, 0x5E52, hookGen(P => unusedSceneViewerSelectSceneMenu(P))],
  [BANK, 0x5E91, hookGen(P => unusedRunSceneSelectDebugMenu(P))],
  [BANK, 0x5EDD, hook((P, c) => getCollisionMapCellAddr(c.d, c.e))],
  [BANK, 0x5EFB, hook((P, c) => ({ a: readCollisionMapCell(P, c.d, c.e), f: getCollisionMapCellAddr(c.d, c.e).f }))],
  [BANK, 0x5F15, hook((P, c) => { unusedWriteCollisionMapCell(P, c.d, c.e, c.a); })],
];
