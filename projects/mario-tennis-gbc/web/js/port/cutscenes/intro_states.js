// The intro cutscene (bank $6b): RunIntroCutscene and its state machine, the 18 scenes from the ball thrown up in
// the sky to the ball coming down before the title. Port of src/engine/cutscenes/intro_states_6b.asm and the
// states of intro_finale_6b.asm (with src/twins/intro_cutscene_state00_update.asm) of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses are its own.
//
// The state machine. IntroCutsceneStateTable_6b (6b:40BD) lists the states in play order (wCutsceneStep); each
// state is a record of three handlers: Init, Update, Exit. DispatchCutsceneStateInit jumps to the step's Init;
// every handler ends with a jump back into the dispatcher:
//   .loop  (6b:407C)  return if wIntroCutsceneCheck is set, else AdvanceFrame and the step's Update
//   .loopB (6b:4099)  the step's Exit
//   .loop2 (6b:40AF)  the next step; return if wIntroCutsceneCheck is set, else its Init
// Here a handler is a generator returning the label it jumps to. The handlers are found through the ROM's tables
// (by address), as the ROM finds them. wIntroCutsceneCheck is set by the A/START skip check (CheckIntroSkipInput,
// a frame task) or by the last state.
// Covered by the lockstep on out/port/intro1.mtrec (power-on, the pad left alone: the intro twice and the title in
// between) and out/port/intro_skip*.mtrec (the intro skipped in several states).
import {
  WRAM_STAGING, WRAM_SCREEN, WRAM_ACTORS, WRAM_TEXT, TILEMAP_WIDTH, TILEMAP_AREA, TILE_SIZE, VRAM_BANK1, vTiles1,
  vTiles2, vBGMap0, vBGMap1, wDecompBuffer, wTextTileBuffer, wTextTileBuffer_SIZE, wShadowTilemap, wShadowAttrmap,
  wScreenScratch, wRulesScreenAnimFrame, wIntroCharactersTilemap, wIntroCharactersAttrmap, wWindowShadowTilemap,
  wWindowShadowAttrmap, rLCDC, rSTAT, rIE, LCDC_WIN_MAP, IE_STAT, STAT_HBLANK_INT, BGM_INTRO, HOME, FAR, ram,
  callHome, farcall, sound, queueVRAMCopy, decompressData, decompressDataFromBank, loadPaletteShadow,
  loadPalettesImmediate, registerFrameTask, unregisterFrameTask, clearFrameTasks, enableLCD, disableLCDSafely,
  advanceFrame, fadeIn, fadeOut, beginFadeIn, wramBank, pushWramBank, popWramBank, call, hook,
} from "./common.js";
import {
  BANK, CheckIntroSkipInput, QueueCutsceneSpriteGroupA, QueueCutsceneSpriteGroupB, UpdateCutsceneScroll,
  IntroSequenceTimerTask, ScrollCutsceneXRightTask, ScrollCutsceneXLeftTask, ScrollCutsceneLeftTask, Palette_6b_1,
  initCutsceneSceneA, initCutsceneSceneB, initCutsceneSceneC, loadIntroTilesAndPalette, initTitleSceneGraphics,
  setCameraYFromScrollPos, queueScrollingSprite, advanceSpriteAnimTimer, updateCutsceneScrollX, updateCutsceneScrollY,
  queueCutsceneAnimatedSprites, loadCutsceneTileset,
} from "./intro_scenes.js";
import { decompressIntroTitleTiles } from "./title.js";

const IntroCutsceneStateTable_6b = 0x40BD;
const ApplyScrollYFromWram = 0x7569;                       // (title.js)
// background palettes of the scenes
const IntroCutsceneState02InitPalette_6b = 0x436F, IntroCutsceneState04InitPalettes = 0x44D0;
const IntroCutsceneState13InitPalettes_6b = 0x475A, IntroCutsceneState16InitPalettes_6b = 0x4A58;
const IntroCutsceneState18InitPalettes_6b = 0x756F, Palettes_6b_03 = 0x4C00;   // (the last: palettes 1-7)
const CutsceneSceneAGfx0 = 0x551D;
// screen assets (LoadScreenAssetRecord) and compressed data slots (bank, slot of its $4000 table)
const SCREENASSET = { IntroRallies: 0x16, IntroRallies2: 0x17, IntroRallies3: 0x18, IntroRallies4: 0x19,
  IntroWave: 0x1C, IntroDive: 0x1D, IntroGirlSwing: 0x1E, DecompressIntroTitleTilesPtrs: 0x20 };
const DataPtr = {
  IntroSwingTiles: [0x6C, 0x2A], IntroSwingTilemap: [0x6C, 0x2C], IntroSwingAttrmap: [0x6C, 0x2E],
  IntroCloseupTiles: [0x6C, 0x32], IntroCloseupTilemap: [0x6C, 0x34], IntroCloseupAttrmap: [0x6C, 0x36],
  IntroGreatestPlayerTiles: [0x6D, 0x12], IntroGreatestPlayerTilemap: [0x6D, 0x14], IntroGreatestPlayerAttrmap: [0x6D, 0x16],
  IntroCharactersTiles: [0x6D, 0x1A], IntroCharactersTilemap: [0x6D, 0x1C], IntroCharactersAttrmap: [0x6D, 0x1E],
  IntroCharactersTilemap2: [0x6D, 0x22], IntroCharactersAttrmap2: [0x6D, 0x24],
};
const ROW = TILEMAP_WIDTH, rowBlocks = rows => rows * TILEMAP_WIDTH / 16;   // map rows -> QueueVRAMCopy blocks
const BAND_ATTR = 0x8A;                                    // the rally scenes' black bands: priority, palette 2, bank 1
const SKY_CAMERA_Y = 0x2400, SKY_SCROLL_ACCUM = 0x015C, SKY_SCROLL_Y = 0x0120;   // the sky scene's start
const LOOP = "loop", LOOP_B = "loopB", LOOP2 = "loop2";     // the dispatcher's labels (above)
const INIT = 0, UPDATE = 1, EXIT = 2;

// ---- the cutscene ----
// RunIntroCutscene (6b:402A): play the intro from its first state (or until A/START), then fade out
export function* runIntroCutscene(P) {
  const R = ram(P), { bus } = P;
  R.cutsceneStep = 0; R.cutsceneStepTimer = 0; R.introCutsceneCheck = 0; R.cutsceneScrollX = 0;
  R.introCutsceneSubState = 0;
  P.V.showDebugConsole = 0;
  bus.w8(rLCDC, bus.u8(rLCDC) & ~LCDC_WIN_MAP);
  sound(P, BGM_INTRO);
  registerFrameTask(P, 1, CheckIntroSkipInput);
  yield* call(P, 0x404E, dispatchCutsceneStateInit(P));
  yield* fadeOut(P, 127);
  clearFrameTasks(P);
  bus.w8(rIE, bus.u8(rIE) & ~IE_STAT);
  P.V.showDebugConsole = 0;
  bus.w8(rLCDC, bus.u8(rLCDC) & ~LCDC_WIN_MAP);
  callHome(P, HOME.ClearDebugTextBuffer);
}

// DispatchCutsceneStateInit (6b:406A): run the states from wCutsceneStep (see the header). Returns a =
// wIntroCutsceneCheck (its `or a`: flags 0).
export function* dispatchCutsceneStateInit(P) {
  const R = ram(P);
  let next = yield* runHandler(P, INIT);
  for (;;) {
    if (next === LOOP) {                                      // .loop
      if (R.introCutsceneCheck) break;
      yield* advanceFrame(P);
      next = yield* runHandler(P, UPDATE);
    } else if (next === LOOP_B) {                             // .loopB
      next = yield* runHandler(P, EXIT);
    } else {                                                  // .loop2
      R.cutsceneStep += 1;
      if (R.introCutsceneCheck) break;
      next = yield* runHandler(P, INIT);
    }
  }
  return { a: R.introCutsceneCheck, f: 0 };
}
// the handler `which` of the current step, found as the ROM finds it: the step's record in
// IntroCutsceneStateTable_6b, the handler's address in the record
function* runHandler(P, which) {
  const record = P.rom.u16(BANK, IntroCutsceneStateTable_6b + ((ram(P).cutsceneStep * 2) & 0xFFFF));
  const addr = P.rom.u16(BANK, record + which * 2), handler = HANDLERS.get(addr);
  if (!handler) throw new Error(`intro state handler 6b:${addr.toString(16)} (step ${ram(P).cutsceneStep}) has no port`);
  return yield* handler(P);
}

// ---- small pieces the states share ----
// count wCutsceneStepTimer up; at `end` the state is over
function timerUpTo(P, end) {
  const R = ram(P);
  R.cutsceneStepTimer += 1;
  return R.cutsceneStepTimer === end ? LOOP_B : LOOP;
}
// QueueVRAMCopy of `rows` map rows from `row` of a tile plane and of its attribute plane (to VRAM bank 1)
function copyMapRows(P, tiles, attrs, vram, row, rows) {
  queueVRAMCopy(P, tiles + row * ROW, vram + row * ROW, rowBlocks(rows));
  queueVRAMCopy(P, attrs + row * ROW, vram + row * ROW + VRAM_BANK1, rowBlocks(rows));
}
// the black band of the rally scenes: one row of attributes BAND_ATTR in the shadow map (WRAM 3)
function fillBandRow(P, row) {
  const at = wShadowAttrmap + row * ROW;
  farcall(P, FAR.FillTilemapRect, { h: BAND_ATTR, d: at >> 8, e: at & 0xFF, b: 0x20, c: 0x01 });
}
// the "ball in the sky" scene's start: camera, sprite animation and scroll positions
function resetSkyScene(P) {
  const R = ram(P);
  P.bus.w8(P.A.cameraY, SKY_CAMERA_Y & 0xFF); P.bus.w8(P.A.cameraY + 1, SKY_CAMERA_Y >> 8);
  R.cutsceneSpriteAnimTick = 0; R.cutsceneSpriteAnimFrame = 0;
  R.cutsceneScrollAccum = SKY_SCROLL_ACCUM;
  R.introCutsceneScrollY = SKY_SCROLL_Y;
}
// the scroll and the camera back to 0 (states 00 and 07, which also run the skip check alone again)
function resetScroll(P) {
  const R = ram(P);
  P.V.scrollX = 0; P.V.scrollY = 0;
  R.cameraX = 0; R.cameraY = 0;
}
// a rally scene's swing pictures: tiles into $9000 (through WRAM 1, with the text tiles to $8800), the map planes
// into WRAM 3 at wScreenScratch / wRulesScreenAnimFrame (the close-ups copy rows of them later)
function loadSwingPictures(P, tiles, tilemap, attrmap) {
  wramBank(P, WRAM_STAGING);
  decompressDataFromBank(P, ...tiles, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles2, 128);
  queueVRAMCopy(P, wTextTileBuffer, vTiles1, wTextTileBuffer_SIZE / 16);
  wramBank(P, WRAM_SCREEN);
  decompressDataFromBank(P, ...tilemap, wScreenScratch);
  decompressDataFromBank(P, ...attrmap, wRulesScreenAnimFrame);
}
// a close-up (states 02 and 04): rows 4-13 of the swing picture (read at wIntroCharactersTilemap /
// wIntroCharactersAttrmap through WRAM 3: the planes loadSwingPictures put there) over the band, in two frames;
// then the close-up's 8 background palettes at once
function* showCloseup(P, palettes) {
  pushWramBank(P, WRAM_SCREEN);
  copyMapRows(P, wIntroCharactersTilemap, wIntroCharactersAttrmap, vBGMap0, 4, 5);
  yield* advanceFrame(P);
  copyMapRows(P, wIntroCharactersTilemap, wIntroCharactersAttrmap, vBGMap0, 9, 5);
  popWramBank(P);
  loadPalettesImmediate(P, palettes, 0, 8);
  return LOOP;
}
// the opponents' scenes (08-10): a screen asset scrolled by a frame task
function* initPanScene(P, asset, scrollX, task, setHardware) {
  const R = ram(P);
  disableLCDSafely(P);
  farcall(P, FAR.LoadScreenAssetRecord, { c: asset });
  farcall(P, FAR.QueueWram3MapToVRAM);
  if (setHardware) { R.cutsceneScrollX = scrollX; P.V.scrollX = scrollX; R.cutsceneStepTimer = 0; }
  else { R.cutsceneStepTimer = 0; R.cutsceneScrollX = scrollX; }
  registerFrameTask(P, 1, task);
  enableLCD(P);
  yield* fadeIn(P, 16);
  return LOOP;
}
function* exitPanScene(P, task) {
  yield* fadeOut(P, 10);
  unregisterFrameTask(P, task);
  P.V.scrollX = 0;
  return LOOP2;
}
// the timer back to 0, and the given label
const clearTimer = (P, label) => { ram(P).cutsceneStepTimer = 0; return label; };

// ---- the states, in play order ----
// State 00 (step 0): a ball thrown up into the sky. The sky map (scene C) scrolls down under the camera; the ball
// (a sprite block) and three sprites ride the scroll.
function* state00Init(P) {
  const R = ram(P);
  initCutsceneSceneC(P);
  loadIntroTilesAndPalette(P);
  P.bus.w8(P.A.cameraY, 0); P.bus.w8(P.A.cameraY + 1, SKY_CAMERA_Y >> 8);
  R.cutsceneStepTimer = 0; R.cutsceneSpriteAnimFrame = 0; R.cutsceneSpriteAX = 0; R.cutsceneSpriteAnimTick = 0;
  resetSkyScene(P);
  enableLCD(P);
  yield* fadeIn(P, 32);
  return LOOP;
}
// IntroCutsceneState00Update_6b (6b:41FA) and its twin IntroCutsceneState19Update_6b (6b:4C79): $80 frames; the
// ball's animation runs for the first $64
function* skySceneUpdate(P) {
  const R = ram(P);
  R.cutsceneStepTimer += 1;
  const t = R.cutsceneStepTimer;
  if (t === 0x80) return LOOP_B;
  if (t < 0x64) advanceSpriteAnimTimer(P);
  updateCutsceneScrollY(P);
  updateCutsceneScrollX(P);
  setCameraYFromScrollPos(P);
  queueScrollingSprite(P);
  queueCutsceneAnimatedSprites(P);
  return LOOP;
}
function* state00Exit(P) {
  yield* fadeOut(P, 10);
  clearFrameTasks(P);
  registerFrameTask(P, 1, CheckIntroSkipInput);
  resetScroll(P);
  return LOOP2;
}
// State 15 (step 1): 10 frames of black
function* state15Init(P) { return clearTimer(P, LOOP); }
function* state15Update(P) { return timerUpTo(P, 0x0A); }
function* state15Exit(P) { return clearTimer(P, LOOP2); }
// State 01 (step 2): the first rally. The court (IntroRallies) pans right 3 pixels a frame between black bands;
// the boy (sprite group A, a frame task) runs along. $69 frames.
function* state01Init(P) {
  const R = ram(P);
  disableLCDSafely(P);
  R.cutsceneScrollX = 0; R.cutsceneStepTimer = 0;
  R.cutsceneSpriteAX = 0xD0; R.cutsceneSpriteAY = 0x28; R.cutsceneSpriteBX = 0x30; R.cutsceneSpriteBY = 0x28;
  farcall(P, FAR.LoadScreenAssetRecord, { c: SCREENASSET.IntroRallies });
  loadCutsceneTileset(P);
  pushWramBank(P, WRAM_SCREEN);
  fillBandRow(P, 11);
  popWramBank(P);
  farcall(P, FAR.QueueWram3MapToVRAM);
  loadSwingPictures(P, DataPtr.IntroSwingTiles, DataPtr.IntroSwingTilemap, DataPtr.IntroSwingAttrmap);
  registerFrameTask(P, 1, QueueCutsceneSpriteGroupA);
  enableLCD(P);
  beginFadeIn(P, 64);                                          // (no wait: the scene runs during the fade)
  return LOOP;
}
function* state01Update(P) {
  const R = ram(P);
  R.cutsceneScrollX += 3;
  P.V.scrollX = R.cutsceneScrollX;
  if (timerUpTo(P, 0x69) === LOOP_B) return LOOP_B;
  R.cutsceneSpriteAX += 1;
  return LOOP;
}
function* state01Exit(P) {
  const R = ram(P);
  unregisterFrameTask(P, QueueCutsceneSpriteGroupA);
  R.cutsceneStepTimer = 0; R.cutsceneScrollX = 0;
  P.V.scrollX = 0;
  return LOOP2;
}
// State 02 (step 3): the boy's swing in close-up, 30 frames
function* state02Init(P) { return yield* showCloseup(P, IntroCutsceneState02InitPalette_6b); }
function* closeupUpdate(P) { return timerUpTo(P, 0x1E); }
function* closeupExit(P) {
  yield* fadeOut(P, 6);
  return clearTimer(P, LOOP2);
}
// State 03 (step 4): the second rally: the court (IntroRallies2) pans left; the girl (group B) runs the other way.
// $7D frames.
function* state03Init(P) {
  const R = ram(P);
  disableLCDSafely(P);
  farcall(P, FAR.LoadScreenAssetRecord, { c: SCREENASSET.IntroRallies2 });
  pushWramBank(P, WRAM_SCREEN);
  fillBandRow(P, 11);
  popWramBank(P);
  farcall(P, FAR.QueueWram3MapToVRAM);
  loadSwingPictures(P, DataPtr.IntroCloseupTiles, DataPtr.IntroCloseupTilemap, DataPtr.IntroCloseupAttrmap);
  registerFrameTask(P, 1, QueueCutsceneSpriteGroupB);
  R.cutsceneSpriteBX = 0xA0; R.cutsceneSpriteBY = 0x28;
  R.introCutsceneSubState = 0;
  enableLCD(P);
  yield* fadeIn(P, 127);
  return LOOP;
}
function* state03Update(P) {
  const R = ram(P);
  if (timerUpTo(P, 0x7D) === LOOP_B) return LOOP_B;
  R.introCutsceneSubState -= 3;                                // (the scene's scroll)
  P.V.scrollX = R.introCutsceneSubState;
  R.cutsceneSpriteBX -= 1;
  return LOOP;
}
function* state03Exit(P) {
  const R = ram(P);
  unregisterFrameTask(P, QueueCutsceneSpriteGroupB);
  R.cutsceneStepTimer = 0; R.introCutsceneSubState = 0;
  P.V.scrollX = 0;
  return LOOP2;
}
// State 04 (step 5): the girl's swing in close-up, 30 frames
function* state04Init(P) { return yield* showCloseup(P, IntroCutsceneState04InitPalettes); }
// State 05 (step 6): both rallies at once: two courts (IntroRallies3 and 4) in bands, the lower band scrolled the
// other way by the LCD STAT handler (UpdateCutsceneScroll, wRasterScroll*); both players. $60 frames.
function* state05Init(P) {
  const R = ram(P), { bus } = P;
  disableLCDSafely(P);
  farcall(P, FAR.LoadScreenAssetRecord, { c: SCREENASSET.IntroRallies3 });
  pushWramBank(P, WRAM_SCREEN);
  fillBandRow(P, 8);
  fillBandRow(P, 14);
  popWramBank(P);
  farcall(P, FAR.QueueWram3MapToVRAM);
  farcall(P, FAR.LoadScreenAssetRecord, { c: SCREENASSET.IntroRallies4 });
  bus.w8(rSTAT, STAT_HBLANK_INT);
  bus.w8(rIE, bus.u8(rIE) | IE_STAT);
  R.rasterScrollStartLY = 0x44; R.rasterScrollEndLY = 0x78; R.rasterScrollX = 0;
  registerFrameTask(P, 1, UpdateCutsceneScroll);
  R.cutsceneSpriteBX = 0xA0; R.cutsceneSpriteBY = 0x40; R.cutsceneSpriteAX = 0xC0; R.cutsceneSpriteAY = 0x10;
  registerFrameTask(P, 1, QueueCutsceneSpriteGroupA);
  registerFrameTask(P, 1, QueueCutsceneSpriteGroupB);
  enableLCD(P);
  yield* fadeIn(P, 16);
  return LOOP;
}
function* state05Update(P) {
  const R = ram(P);
  if (timerUpTo(P, 0x60) === LOOP_B) return LOOP_B;
  R.cutsceneSpriteAX += 1;
  R.cutsceneSpriteBX -= 1;
  return LOOP;
}
// the raster split off; the shadow map's rows 3-14 back on screen in two frames, the sprites and the scroll stopped
function* state05Exit(P) {
  const { bus } = P;
  bus.w8(rIE, bus.u8(rIE) & ~IE_STAT);
  pushWramBank(P, WRAM_SCREEN);
  copyMapRows(P, wShadowTilemap, wShadowAttrmap, vBGMap0, 3, 6);
  popWramBank(P);
  unregisterFrameTask(P, QueueCutsceneSpriteGroupA);
  unregisterFrameTask(P, UpdateCutsceneScroll);
  P.V.scrollX = 0;
  yield* advanceFrame(P);
  pushWramBank(P, WRAM_SCREEN);
  copyMapRows(P, wShadowTilemap, wShadowAttrmap, vBGMap0, 9, 6);
  popWramBank(P);
  unregisterFrameTask(P, QueueCutsceneSpriteGroupB);
  yield* advanceFrame(P);
  return LOOP2;
}
// State 06 (step 7): the last picture held 100 frames, then a fade out
function* state06Init(P) { return clearTimer(P, LOOP); }
function* state06Update(P) { return timerUpTo(P, 0x64); }
function* state06Exit(P) { yield* fadeOut(P, 16); return LOOP2; }
// State 07 (step 8): "Raucous rallies...": the title scene's picture pans in ($20 a frame until camera X $4000),
// with its palettes animated by frame tasks (IntroSequenceTimerTask); then $28 frames
function* state07Init(P) {
  const R = ram(P);
  initTitleSceneGraphics(P);
  decompressIntroTitleTiles(P);
  R.cutsceneStepTimer = 0; R.cutsceneSpriteAX = 0; R.cutsceneSpriteAY = 0; R.cutsceneSpriteBX = 0; R.cutsceneSpriteBY = 0;
  enableLCD(P);
  yield* fadeIn(P, 8);
  registerFrameTask(P, 1, IntroSequenceTimerTask);
  return LOOP;
}
function* state07Exit(P) {
  clearFrameTasks(P);
  registerFrameTask(P, 1, CheckIntroSkipInput);
  resetScroll(P);
  return LOOP2;
}
function* state07Update(P) {
  const R = ram(P);
  if (R.cameraX >> 8 === 0x40) return timerUpTo(P, 0x29);
  if (R.cutsceneStepTimer !== 1) { R.cutsceneStepTimer += 1; return LOOP; }   // (one frame first)
  R.cameraX += 0x20;
  return LOOP;
}
// State 13 (step 9): the caption (from DecompressIntroTitleTiles, in WRAM 5) over the picture in two frames,
// held 100 frames, then a fade out
function* state13Init(P) {
  const R = ram(P);
  P.V.scrollY = 0; P.V.scrollX = 0;
  R.cutsceneStepTimer = 0;
  pushWramBank(P, WRAM_TEXT);
  loadPaletteShadow(P, IntroCutsceneState13InitPalettes_6b, 0, 8);
  copyMapRows(P, wWindowShadowTilemap, wWindowShadowAttrmap, vBGMap0, 6, 8);
  yield* advanceFrame(P);
  copyMapRows(P, wWindowShadowTilemap, wWindowShadowAttrmap, vBGMap0, 4, 2);
  yield* advanceFrame(P);
  popWramBank(P);
  return LOOP;
}
function* state13Exit(P) {
  yield* fadeOut(P, 16);
  disableLCDSafely(P);
  return clearTimer(P, LOOP2);
}
function* state13Update(P) { return timerUpTo(P, 0x64); }
// States 08-10 (steps 10-12): the opponents, three pictures panned quickly (a frame task each)
function* state08Init(P) { return yield* initPanScene(P, SCREENASSET.IntroWave, 0xB0, ScrollCutsceneXRightTask, false); }
function* state08Exit(P) { return yield* exitPanScene(P, ScrollCutsceneXRightTask); }
function* state08Update(P) { return timerUpTo(P, 0x2C); }
function* state09Init(P) { return yield* initPanScene(P, SCREENASSET.IntroDive, 0x94, ScrollCutsceneXLeftTask, true); }
function* state09Exit(P) { return yield* exitPanScene(P, ScrollCutsceneXLeftTask); }
function* state09Update(P) { return timerUpTo(P, 0x2B); }
function* state10Init(P) { return yield* initPanScene(P, SCREENASSET.IntroGirlSwing, 0xA8, ScrollCutsceneLeftTask, true); }
function* state10Exit(P) { return yield* exitPanScene(P, ScrollCutsceneLeftTask); }
function* state10Update(P) { return timerUpTo(P, 0x2B); }
// Unused states 11 and 12 (not in the table): a debug-console picture, and the sky scene without its setup
function* state11Init(P) {
  const { bus } = P;
  disableLCDSafely(P);
  farcall(P, FAR.LoadScreenAssetRecord, { c: SCREENASSET.DecompressIntroTitleTilesPtrs });
  P.V.showDebugConsole = 1;
  bus.w8(rLCDC, bus.u8(rLCDC) | LCDC_WIN_MAP);
  wramBank(P, WRAM_SCREEN);
  queueVRAMCopy(P, wShadowTilemap, vBGMap1, TILEMAP_AREA / 16);
  queueVRAMCopy(P, wShadowAttrmap, vBGMap1 + VRAM_BANK1, TILEMAP_AREA / 16);
  initCutsceneSceneB(P);
  loadIntroTilesAndPalette(P);
  enableLCD(P);
  yield* fadeIn(P, 32);
  return clearTimer(P, LOOP);
}
function* state11Exit(P) {
  const { bus } = P;
  P.V.showDebugConsole = 0;
  bus.w8(rLCDC, bus.u8(rLCDC) & ~LCDC_WIN_MAP);
  loadPaletteShadow(P, Palette_6b_1, 0, 8);
  return clearTimer(P, LOOP2);
}
function* state11Update(P) { return timerUpTo(P, 0x70); }
function* state12Init(P) {
  const R = ram(P);
  R.cutsceneStepTimer = 0; R.cutsceneSpriteAY = 0;
  resetSkyScene(P);
  return LOOP;
}
function* state12Exit(P) { yield* fadeOut(P, 4); return LOOP2; }
// the ball alone for 10 frames, then the sky scene
function* state12Update(P) {
  const R = ram(P);
  if (R.cutsceneSpriteAY !== 0x0A) {
    R.cutsceneSpriteAY += 1;
    queueScrollingSprite(P);
    return LOOP;
  }
  return yield* skySceneUpdate(P);
}
// State 16 (step 13): "Awesome opponents..." over the characters: scene A, the caption picture (IntroGreatestPlayer)
// on the window map ($9C00, shown with hShowDebugConsole 2), and the characters' pictures loaded for 17 and 18.
// $70 frames.
function* state16Init(P) {
  const R = ram(P), { bus } = P;
  disableLCDSafely(P);
  initCutsceneSceneA(P);
  loadIntroTilesAndPalette(P);
  P.V.showDebugConsole = 2;
  bus.w8(rLCDC, bus.u8(rLCDC) | LCDC_WIN_MAP);
  wramBank(P, WRAM_STAGING);
  decompressDataFromBank(P, ...DataPtr.IntroGreatestPlayerTiles, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles2, 128);
  queueVRAMCopy(P, wTextTileBuffer, vTiles1, wTextTileBuffer_SIZE / 16);
  decompressDataFromBank(P, ...DataPtr.IntroGreatestPlayerTilemap, wDecompBuffer);
  decompressDataFromBank(P, ...DataPtr.IntroGreatestPlayerAttrmap, wDecompBuffer + 64 * TILE_SIZE);
  queueVRAMCopy(P, wDecompBuffer, vBGMap1, TILEMAP_AREA / 16);
  queueVRAMCopy(P, wDecompBuffer + 64 * TILE_SIZE, vBGMap1 + VRAM_BANK1, TILEMAP_AREA / 16);
  loadPaletteShadow(P, IntroCutsceneState16InitPalettes_6b, 0, 8);
  wramBank(P, WRAM_STAGING);
  decompressDataFromBank(P, ...DataPtr.IntroCharactersTiles, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles2 + VRAM_BANK1, 128);
  queueVRAMCopy(P, wTextTileBuffer, vTiles1 + VRAM_BANK1, wTextTileBuffer_SIZE / 16);
  wramBank(P, WRAM_ACTORS);
  decompressDataFromBank(P, ...DataPtr.IntroCharactersTilemap, wIntroCharactersTilemap);
  decompressDataFromBank(P, ...DataPtr.IntroCharactersAttrmap, wIntroCharactersAttrmap);
  wramBank(P, WRAM_TEXT);
  decompressDataFromBank(P, ...DataPtr.IntroCharactersTilemap2, wWindowShadowTilemap);
  decompressDataFromBank(P, ...DataPtr.IntroCharactersAttrmap2, wWindowShadowAttrmap);
  wramBank(P, WRAM_STAGING);
  decompressData(P, CutsceneSceneAGfx0, wDecompBuffer);       // (scene A's tiles again, for state 18)
  P.V.scrollX = 0; P.V.scrollY = 0;
  R.cutsceneStepTimer = 0;
  enableLCD(P);
  yield* fadeIn(P, 8);
  return LOOP;
}
function* state16Update(P) { return timerUpTo(P, 0x70); }
function* state16Exit(P) { return clearTimer(P, LOOP2); }
// State 17 (step 14): the characters' picture (WRAM 4) on the window map in two frames, with its palettes.
// $70 frames.
function* state17Init(P) {
  wramBank(P, WRAM_ACTORS);
  copyMapRows(P, wIntroCharactersTilemap, wIntroCharactersAttrmap, vBGMap1, 6, 8);
  yield* advanceFrame(P);
  copyMapRows(P, wIntroCharactersTilemap, wIntroCharactersAttrmap, vBGMap1, 4, 2);
  yield* advanceFrame(P);
  loadPaletteShadow(P, Palettes_6b_03, 1, 7);
  return clearTimer(P, LOOP);
}
function* state17Update(P) { return timerUpTo(P, 0x70); }
function* state17Exit() { return LOOP2; }
// State 18 (step 15): "And the greatest player ever!": Mario's picture (WRAM 5) on the window map in four frames,
// scrolled up from Y $48 by 4 a frame (ApplyScrollYFromWram, a frame task, keeps hScrollY on
// wCutsceneSpriteAX); scene A's tiles back into $9000 and $8800 over five frames. Ends at Y 0.
function* state18Init(P) {
  const R = ram(P);
  loadPaletteShadow(P, IntroCutsceneState18InitPalettes_6b, 0, 8);
  wramBank(P, WRAM_TEXT);
  copyMapRows(P, wWindowShadowTilemap, wWindowShadowAttrmap, vBGMap1, 19, 8);
  yield* advanceFrame(P);
  copyMapRows(P, wWindowShadowTilemap, wWindowShadowAttrmap, vBGMap1, 11, 8);
  yield* advanceFrame(P);
  R.cutsceneSpriteAX = 0x48;
  P.V.scrollY = 0x48;
  registerFrameTask(P, 8, ApplyScrollYFromWram);
  copyMapRows(P, wWindowShadowTilemap, wWindowShadowAttrmap, vBGMap1, 3, 8);
  yield* advanceFrame(P);
  copyMapRows(P, wWindowShadowTilemap, wWindowShadowAttrmap, vBGMap1, 0, 4);
  loadPaletteShadow(P, Palettes_6b_03, 1, 7);
  yield* advanceFrame(P);
  wramBank(P, WRAM_STAGING);
  for (let quarter = 0; quarter < 4; quarter++) {
    queueVRAMCopy(P, wDecompBuffer + quarter * 32 * TILE_SIZE, vTiles2 + quarter * 0x20 * TILE_SIZE, 32);
    yield* advanceFrame(P);
  }
  queueVRAMCopy(P, wTextTileBuffer, vTiles1, 32);
  yield* advanceFrame(P);
  return clearTimer(P, LOOP);
}
function* state18Update(P) {
  const R = ram(P);
  R.cutsceneSpriteAX -= 4;
  P.V.scrollY = R.cutsceneSpriteAX;
  if (!R.cutsceneSpriteAX) return LOOP_B;
  R.cutsceneStepTimer += 1;
  return LOOP;
}
function* state18Exit(P) {
  unregisterFrameTask(P, ApplyScrollYFromWram);
  wramBank(P, WRAM_SCREEN);
  P.V.showDebugConsole = 0;
  return LOOP2;
}
// State 19 (step 16): the ball comes down through the sky again (the sky scene with Palette_6b_1)
function* state19Init(P) {
  const R = ram(P);
  loadPaletteShadow(P, Palette_6b_1, 0, 8);
  R.cutsceneStepTimer = 0; R.cutsceneSpriteAY = 0;
  resetSkyScene(P);
  return LOOP;
}
function* state19Exit(P) { yield* fadeOut(P, 4); return LOOP2; }
// State 14 (step 17): the end
function* state14Init(P) { ram(P).introCutsceneCheck = 1; return LOOP; }
function* toLoop() { return LOOP; }                            // IntroCutsceneState14Update_6b, Unused_6b_UpdateHandler_6b
function* toLoop2() { return LOOP2; }                          // IntroCutsceneState14Exit_6b

// the handlers by address
const HANDLERS = new Map([
  [0x418E, state00Init], [0x41FA, skySceneUpdate], [0x41D3, state00Exit],
  [0x421F, state01Init], [0x4304, state01Update], [0x42F2, state01Exit],
  [0x4326, state02Init], [0x43BE, closeupUpdate], [0x43AF, closeupExit],
  [0x43CF, state03Init], [0x4467, state03Update], [0x4455, state03Exit],
  [0x4487, state04Init], [0x451F, closeupUpdate], [0x4510, closeupExit],
  [0x452E, state05Init], [0x4620, state05Update], [0x45B5, state05Exit],
  [0x463D, state06Init], [0x464F, state06Update], [0x4644, state06Exit],
  [0x465E, state07Init], [0x46A9, state07Update], [0x468A, state07Exit],
  [0x479A, state08Init], [0x47D8, state08Update], [0x47C4, state08Exit],
  [0x47E7, state09Init], [0x4827, state09Update], [0x4813, state09Exit],
  [0x4836, state10Init], [0x4876, state10Update], [0x4862, state10Exit],
  [0x4885, state11Init], [0x48E3, state11Update], [0x48CA, state11Exit],
  [0x48F2, state12Init], [0x492A, state12Update], [0x491F, state12Exit],
  [0x46E5, state13Init], [0x474B, state13Update], [0x4739, state13Exit],
  [0x4166, state14Init], [0x416E, toLoop], [0x415C, toLoop2],
  [0x4171, state15Init], [0x417F, state15Update], [0x4178, state15Exit],
  [0x4960, state16Init], [0x4A42, state16Update], [0x4A51, state16Exit],
  [0x4A98, state17Init], [0x4AE0, state17Update], [0x4AEF, state17Exit],
  [0x4AF2, state18Init], [0x4BD0, state18Update], [0x4BED, state18Exit],
  [0x4C38, state19Init], [0x4C79, skySceneUpdate], [0x4C6E, state19Exit],
  [0x4159, toLoop], [0x415F, function* (P) { return clearTimer(P, LOOP2); }],   // Unused_6b_UpdateHandler_6b, Unused_6b_ExitHandler_6b
]);

export const HOOKS = [
  hook(BANK, 0x402A, runIntroCutscene),
  hook(BANK, 0x406A, dispatchCutsceneStateInit),
];
