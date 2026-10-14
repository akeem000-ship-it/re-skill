// The story's still scenes (bank $18, RunStorySceneByMode, slot $408E): after a story match or at the ending, a
// screen asset by wStorySceneAssetIndex in one of three sequences:
//   0 (PlayScreenSequence0): a picture held ~4 seconds, then faded to gray (the palette fade of bank 3) until A or
//     B; then a plain screen with sprites until A or B.
//   1 (PlayScreenSequence1): a picture with 16 drifting objects (sprites: the objects' state in WRAM 3 at
//     wScreenScratch, 16 bytes each, updated by TaskUpdateObjects_18 and drawn by TaskDrawObjectSprites_18) over
//     the credits music for ~12 seconds; the scrolling text screen; then "the end" with sprites until A or B.
//   2 (PlayScreenSequence2): the ending: a picture with the other objects until A or B; the ending credits (unless
//     this ending, singles or doubles, was seen); the last picture, its sprites fading in, until A or B; the
//     opening-seen save flag and the ending-seen game flag set, the story saved.
// InitObjectSceneA / InitObjectSceneB end with a WRAM bank pushed and never popped: their `ret` jumps to the pushed
// word (the bank, then the flags: an address in bank 0, around ReadJoypad for WRAM 3), whose code returns to the
// caller in their stead. The port runs that code from there as the ROM does.
// Also here: the bank's unused helpers of the confirm screens and the character select (their graphics and sprites)
// and the on-court character tiles the match loads (LoadOnCourtCharTilesA / B).
// Port of src/engine/menus/scenes/scene_assets_18.asm, sequences_18.asm and object_18.asm of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses are its own;
// tables and graphics are read from the ROM. (slots_18.asm and slots_1b.asm are the banks' slot tables: data.)
// Tests: lockstep on out/port/scene_*.mtrec (each sequence, from stubs: see web/tests/port/routines_menus_pause.mjs)
// and on the match recordings (LoadOnCourtCharTiles*); routines_menus_pause.mjs.
import {
  FAR, HOME, rom, romWait, home, wram, rd, wr, u8, w8, u16, sound, advanceFrame, registerFrameTask, clearFrameTasks,
  queueVRAMCopy, copyMemoryBC, decompressData, loadPaletteShadow, loadPalettesImmediate, queueSprite,
  queueSpriteTemplate, enableLCD, disableLCDSafely, fadeIn, fadeOut, loadCompressedTileBlock, loadScreenAssetRecord,
  queueWram3MapToVRAM, testFlag, setFlag, hook, hookGen, getRegs, setRegs, OBJ_PALETTES, WRAM_SCREEN, TILE_SIZE,
  VRAM_BANK1, vTiles0, rVBK, wDecompBuffer, wScreenScratch, PADF_A, PADF_B, BGM_WIN, BGM_CREDITS, BGM_THE_END,
  FLAG_DOUBLES, FLAG_ENDING_SEEN_SINGLES, FLAG_ENDING_SEEN_DOUBLES,
} from "../pause/defs.js";

export const BANK_SCENES = 0x18;
const rb = (P, a) => P.rom.u8(BANK_SCENES, a), rw = (P, a) => P.rom.u16(BANK_SCENES, a);
// graphics, tables and templates (bank $18)
const ConfirmScreenSpriteGfx0 = 0x5633, ConfirmScreenSpritePalette0 = 0x582D, ConfirmScreenSpriteGfx1 = 0x5845;
const ConfirmScreenSpritePalette1 = 0x58AD, CharSelectCursorGfx = 0x58E0, CharSelectCursorPalette = 0x59B9;
const CharSelectCursorAnimTable = 0x59FE, CharSelectCursorTemplatePtrs = 0x5A1E, SpriteBobRamp_18 = 0x5A79;
const OnCourtCharTilesAGfx = 0x5AF0, OnCourtCharTilesBGfx = 0x62F0, OnCourtCharTilesFallbackGfx = 0x6AF0;
const CharRosterIcon00 = 0x6B30;
const DebugScreenAssetViewerRecords = 0x769C, Screen0AssetIdTable = 0x773A, Screen0Palette = 0x7754;
const QueueScreen0Sprites_SpriteTemplate = 0x776A, Screen1AssetIdTable = 0x784F, AllBgPalettes = 0x78A9;
const Screen1ObjPalette = 0x78C5, QueueScreen1Sprites_SpriteTemplate = 0x78DB, Screen2AssetIdATable = 0x7A14;
const Screen2AssetIdBTable = 0x7A27, Screen2ObjPalette = 0x7A41, QueueScreen2Sprites_SpriteTemplate = 0x7A57;
const PaletteFadeTable_18 = 0x7AB5, ObjectSceneATilesPalettes = 0x7C0F, ObjectArrayASpawnTable = 0x7C53;
const ObjectSceneBPalette = 0x7D44, ObjectArrayBSpawnTable = 0x7D88, ObjectArrayAWaveTable_18 = 0x7E69;
const ObjectArrayBDriftTable_18 = 0x7EC8;
// frame tasks and object callbacks (bank $18)
export const QueueScreen0Sprites = 0x775C, QueueScreen1Sprites = 0x78CD, QueueScreen2Sprites = 0x7A49;
export const TaskFadeInPalette_18 = 0x7A81, TaskDrawObjectSprites_18 = 0x7B36, TaskUpdateObjects_18 = 0x7B6E;
const ObjectArrayAUpdateCallback_18 = 0x7E38, ObjectArrayBUpdateCallback_18 = 0x7E89;
const SCREENASSET_ShopCutscene = 0x32;
const TILEBLOCK_Screen0Gfx = 0x06, TILEBLOCK_Screen1ObjGfx = 0x07, TILEBLOCK_Screen2ObjGfx = 0x08;
const Screen0Gfx_BLOCKS = 0x28, Screen1ObjGfx_BLOCKS = 0x28, Screen2ObjGfx_BLOCKS = 0x14;
const OBJECT_SCENE_A_BLOCKS = [0x00, 0x01, 0x02], OBJECT_SCENE_B_BLOCKS = [0x03, 0x04, 0x05], OBJECT_BLOCKS = 0x10;
const ConfirmScreenSpriteGfx0_BLOCKS = 0x1C;
const SAVEFLAG_OPENING_SEEN = 0x0120;
const SEQUENCE0_HOLD = 0xFA, SEQUENCE1_FRAMES = 0xAF, SEQUENCE2_HOLD = 0xB4;
const OBJECTS = 16, OBJECT_SIZE = 16, SPAWN_SIZE = 11;
const OBJECT_WRAP_Y = 0xC0, OBJECT_TOP_Y = 0x10;
const FADE_STEPS = 0x10;
const DEBUG_SCREENS = 0x18;
const ON_COURT_TILE_BLOCKS = 4, FALLBACK_BLOCKS = (CharRosterIcon00 - OnCourtCharTilesFallbackGfx) / 16;
const NO_CHARACTER = 0xFF;

// ---- the unused confirm screen and character select helpers ----
// Unused_18_CopyBytes11 (18:55B9): 11 bytes from hl to de. Returns hl, de after them, a = the last.
export function unusedCopyBytes11(P, hl, de) {
  let a = 0;
  for (let i = 0; i < 11; i++) { a = u8(P, hl); w8(P, de, a); hl = (hl + 1) & 0xFFFF; de = (de + 1) & 0xFFFF; }
  return { a, hl, de };
}
// Unused_18_ClearTileVramBothBanks (18:55DB): $8000-$87FF cleared in VRAM bank 0 and 1 (rVBK flipped and back)
export function unusedClearTileVramBothBanks(P) {
  home(P, HOME.ClearMemory16, { hl: vTiles0, c: 0x80 });
  P.bus.w8(rVBK, P.bus.u8(rVBK) ^ 1);
  home(P, HOME.ClearMemory16, { hl: vTiles0, c: 0x80 });
  P.bus.w8(rVBK, P.bus.u8(rVBK) ^ 1);
}
// Unused_18_LoadConfirmScreenSpriteGfx (18:55F8): the confirm screen's sprite tiles and palettes
export function unusedLoadConfirmScreenSpriteGfx(P) {
  decompressData(P, ConfirmScreenSpriteGfx0, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles0 + VRAM_BANK1, ConfirmScreenSpriteGfx0_BLOCKS);
  loadPalettesImmediate(P, ConfirmScreenSpritePalette0, OBJ_PALETTES + 4, 3);
  decompressData(P, ConfirmScreenSpriteGfx1, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles0 + 0x20 * TILE_SIZE + VRAM_BANK1, 12);
  return loadPalettesImmediate(P, ConfirmScreenSpritePalette1, OBJ_PALETTES, 1);
}
// Unused_18_LoadCharSelectCursorGfx (18:59C1): the cursor's tiles ($40-$4B) and its palette (object 2)
export function unusedLoadCharSelectCursorGfx(P) {
  queueVRAMCopy(P, CharSelectCursorGfx, vTiles0 + 0x40 * TILE_SIZE, 12);
  return loadPaletteShadow(P, CharSelectCursorPalette, OBJ_PALETTES + 2, 1);
}
// Unused_18_DrawCharSelectCursor (18:59D6): the cursor at (d, e), animated (CharSelectCursorAnimTable by frame);
// a = $84 picks the second pair of templates
export function unusedDrawCharSelectCursor(P, a, x, y) {
  const pair = a === 0x84 ? 1 : 0;
  const frame = rb(P, (CharSelectCursorAnimTable + (P.V.vBlankCounter & 0x1F)) & 0xFFFF);
  const template = rw(P, (CharSelectCursorTemplatePtrs + (((pair * 2 + frame) * 2) & 0xFF)) & 0xFFFF);
  return queueSpriteTemplate(P, template, x, y, 0x40, 0x02);
}
// Unused_18_ApplySpriteBobOffset (18:5A6A): e + SpriteBobRamp_18[frame & 63]
export function unusedApplySpriteBobOffset(P, e) {
  const at = (SpriteBobRamp_18 + (P.V.vBlankCounter & 0x3F)) & 0xFFFF;
  return { e: (rb(P, at) + e) & 0xFF, a: (rb(P, at) + e) & 0xFF, hl: at };
}
// LoadOnCourtCharTilesA (18:5AB9), slot $4044 / LoadOnCourtCharTilesB (18:5ACE), slot $4046: character a's four
// tiles of set A / B (64 bytes a character) queued to de; B with a = $FF: the fallback tiles
export function loadOnCourtCharTilesA(P, ch, de) {
  return { b: OnCourtCharTilesAGfx >> 8, c: ON_COURT_TILE_BLOCKS, ...queueVRAMCopy(P, (OnCourtCharTilesAGfx + ch * 0x40) & 0xFFFF, de, ON_COURT_TILE_BLOCKS) };
}
// (b: the graphics' high byte, from `ld bc, OnCourtCharTiles?Gfx / add hl, bc`, unless QueueVRAMCopy changes it)
export function loadOnCourtCharTilesB(P, ch, de) {
  if (ch === NO_CHARACTER) return loadOnCourtCharTilesFallback(P, de);
  return { b: OnCourtCharTilesBGfx >> 8, c: ON_COURT_TILE_BLOCKS, ...queueVRAMCopy(P, (OnCourtCharTilesBGfx + ch * 0x40) & 0xFFFF, de, ON_COURT_TILE_BLOCKS) };
}
// LoadOnCourtCharTilesFallback (18:5AE7)
export function loadOnCourtCharTilesFallback(P, de) {
  return { c: FALLBACK_BLOCKS, ...queueVRAMCopy(P, OnCourtCharTilesFallbackGfx, de, FALLBACK_BLOCKS) };
}

// ---- the scenes ----
// RunStorySceneByMode (18:7617), slot $408E: scene c (wStorySceneAssetIndex) in sequence b (see the header)
export function* runStorySceneByMode(P, scene, mode) {
  wr(P, "storySceneAssetIndex", scene);
  yield* fadeOutAndResetScreen(P);
  if (mode === 0) yield* playScreenSequence0(P);
  else if (mode === 1) yield* playScreenSequence1(P);
  else yield* playScreenSequence2(P);
}
// FadeOutAndResetScreen (18:7632): the LCD on, a fade out (16), the LCD off, no frame tasks, the scroll reset
export function* fadeOutAndResetScreen(P) {
  enableLCD(P);
  yield* fadeOut(P, 16);
  disableLCDSafely(P);
  clearFrameTasks(P);
  resetScrollAndCamera(P);
}
// ResetScrollAndCamera (18:7647): hScrollX / Y and wCameraX / Y 0
export function resetScrollAndCamera(P) {
  P.V.scrollX = 0; P.V.scrollY = 0;
  wr(P, "cameraX", 0); wr(P, "cameraX", 0, 1); wr(P, "cameraY", 0); wr(P, "cameraY", 0, 1);
  return { a: 0 };
}
// Unused_18_DebugScreenAssetViewer (18:7659), slot $4090: the 24 screen assets of DebugScreenAssetViewerRecords in
// turn, the next on any button, for ever
export function* unusedDebugScreenAssetViewer(P) {
  yield* fadeOutAndResetScreen(P);
  for (let i = 0; ; i = (i + 1) % DEBUG_SCREENS) {
    yield* fadeOut(P, 16);
    disableLCDSafely(P);
    loadScreenAssetRecord(P, rb(P, (DebugScreenAssetViewerRecords + i) & 0xFFFF));
    queueWram3MapToVRAM(P);
    enableLCD(P);
    yield* fadeIn(P, 16);
    do yield* advanceFrame(P); while (!P.V.inputPressed);
  }
}
// frames until A or B (hInputPressed)
function* waitAOrB(P) { do yield* advanceFrame(P); while (!(P.V.inputPressed & (PADF_A | PADF_B))); }
// PlayScreenSequence0 (18:76B4): see the header
export function* playScreenSequence0(P) {
  setupScreen0Assets(P);
  loadScreen0TilesAndPalette(P);
  enableLCD(P);
  yield* fadeIn(P, 2);
  wram(P, WRAM_SCREEN);
  wr(P, "screenSequenceTimer", 0);
  do {
    yield* advanceFrame(P);
    wr(P, "screenSequenceTimer", rd(P, "screenSequenceTimer") + 1);
  } while (rd(P, "screenSequenceTimer") !== SEQUENCE0_HOLD);
  rom(P, FAR.InitGrayscalePaletteFade);
  rom(P, FAR.SetupPaletteFadeMask, { b: 0x3F, c: 0x3F, d: 0x1E });
  yield* romWait(P, FAR.AnimatePaletteFadeToTarget);
  yield* waitAOrB(P);
  yield* fadeOut(P, 16);
  disableLCDSafely(P);
  fillAllBgPalettes(P);
  enableLCD(P);
  yield* fadeIn(P, 16);
  registerFrameTask(P, 1, QueueScreen0Sprites);
  yield* waitAOrB(P);
}
// SetupScreen0Assets (18:7720) / SetupScreen1Assets (18:7835): the scene's screen asset (Screen0/1AssetIdTable by
// wStorySceneAssetIndex) and its maps to VRAM. Returns the registers QueueWram3MapToVRAM leaves.
export function setupScreen0Assets(P) {
  resetScrollAndCamera(P);
  loadScreenAssetRecord(P, lookupScreen0AssetId(P));
  return queueWram3MapToVRAM(P);
}
export function setupScreen1Assets(P) {
  resetScrollAndCamera(P);
  loadScreenAssetRecord(P, lookupScreen1AssetId(P));
  return queueWram3MapToVRAM(P);
}
// LookupScreen0AssetId (18:772D) / ...1 (18:7842) / LookupScreen2AssetIdA (18:7A07) / ...B (18:7A1A)
const lookup = (P, table) => rb(P, (table + rd(P, "storySceneAssetIndex")) & 0xFFFF);
export const lookupScreen0AssetId = P => lookup(P, Screen0AssetIdTable);
export const lookupScreen1AssetId = P => lookup(P, Screen1AssetIdTable);
export const lookupScreen2AssetIdA = P => lookup(P, Screen2AssetIdATable);
export const lookupScreen2AssetIdB = P => lookup(P, Screen2AssetIdBTable);
// LoadScreen0TilesAndPalette (18:7740) / LoadScreen1ObjTiles (18:78B1) / LoadScreen2ObjTiles (18:7A2D): the
// sequence's sprite tiles to $8000 and object palette 0
export function loadScreen0TilesAndPalette(P) {
  loadCompressedTileBlock(P, TILEBLOCK_Screen0Gfx, vTiles0, Screen0Gfx_BLOCKS);
  return loadPaletteShadow(P, Screen0Palette, OBJ_PALETTES, 1);
}
export function loadScreen1ObjTiles(P) {
  loadCompressedTileBlock(P, TILEBLOCK_Screen1ObjGfx, vTiles0, Screen1ObjGfx_BLOCKS);
  return loadPaletteShadow(P, Screen1ObjPalette, OBJ_PALETTES, 1);
}
export function loadScreen2ObjTiles(P) {
  loadCompressedTileBlock(P, TILEBLOCK_Screen2ObjGfx, vTiles0, Screen2ObjGfx_BLOCKS);
  return loadPaletteShadow(P, Screen2ObjPalette, OBJ_PALETTES, 1);
}
// QueueScreen0Sprites (18:775C) / QueueScreen1Sprites (18:78CD) / QueueScreen2Sprites (18:7A49), frame tasks
export const queueScreen0Sprites = P => queueSpriteTemplate(P, QueueScreen0Sprites_SpriteTemplate, 0x28, 0x3A, 0, 0);
export const queueScreen1Sprites = P => queueSpriteTemplate(P, QueueScreen1Sprites_SpriteTemplate, 0x28, 0x3A, 0, 0);
export const queueScreen2Sprites = P => queueSpriteTemplate(P, QueueScreen2Sprites_SpriteTemplate, 0x28, 0x40, 0, 0);
// PlayScreenSequence1 (18:77BB): see the header
export function* playScreenSequence1(P) {
  const { f } = setupScreen1Assets(P);
  yield* initObjectScene(P, f, OBJECT_SCENE_A_BLOCKS, ObjectArrayASpawnTable, ObjectSceneATilesPalettes);
  registerFrameTask(P, 1, TaskDrawObjectSprites_18);
  registerFrameTask(P, 1, TaskUpdateObjects_18);
  sound(P, BGM_CREDITS);
  enableLCD(P);
  yield* fadeIn(P, 2);
  wram(P, WRAM_SCREEN);
  wr(P, "screenSequenceTimer", 0);
  for (;;) {
    yield* advanceFrame(P);
    if (P.V.vBlankCounter & 3) continue;
    wr(P, "screenSequenceTimer", rd(P, "screenSequenceTimer") + 1);
    if (rd(P, "screenSequenceTimer") === SEQUENCE1_FRAMES) break;
  }
  yield* fadeOut(P, 1);
  clearFrameTasks(P);
  disableLCDSafely(P);
  yield* romWait(P, FAR.RunScrollingTextScreen);
  disableLCDSafely(P);
  loadScreen1ObjTiles(P);
  fillAllBgPalettes(P);
  registerFrameTask(P, 1, QueueScreen1Sprites);
  enableLCD(P);
  yield* fadeIn(P, 64);
  sound(P, BGM_THE_END);
  yield* waitAOrB(P);
}
// FillAllBgPalettes (18:7855): a plain screen (the shop cutscene's asset) with all eight BG palettes AllBgPalettes
export function fillAllBgPalettes(P) {
  resetScrollAndCamera(P);
  loadScreenAssetRecord(P, SCREENASSET_ShopCutscene);
  for (let pal = 0; pal < 8; pal++) loadPaletteShadow(P, AllBgPalettes, pal, 1);
  return queueWram3MapToVRAM(P);
}
// PlayScreenSequence2 (18:792C): the ending (see the header)
export function* playScreenSequence2(P) {
  resetScrollAndCamera(P);
  sound(P, BGM_WIN);
  loadScreenAssetRecord(P, lookupScreen2AssetIdA(P));
  const { f } = queueWram3MapToVRAM(P);
  yield* initObjectScene(P, f, OBJECT_SCENE_B_BLOCKS, ObjectArrayBSpawnTable, ObjectSceneBPalette);
  registerFrameTask(P, 1, TaskDrawObjectSprites_18);
  registerFrameTask(P, 1, TaskUpdateObjects_18);
  enableLCD(P);
  yield* fadeIn(P, 1);
  yield* waitAOrB(P);
  yield* fadeOut(P, 2);
  const seen = testFlag(P, FLAG_DOUBLES) ? testFlag(P, FLAG_ENDING_SEEN_DOUBLES) : testFlag(P, FLAG_ENDING_SEEN_SINGLES);
  if (!seen) {
    sound(P, BGM_CREDITS);
    yield* romWait(P, FAR.RunEndingCreditsSequence);
  }
  wram(P, WRAM_SCREEN);
  wr(P, "endingSceneStep", 0);
  clearFrameTasks(P);
  resetScrollAndCamera(P);
  disableLCDSafely(P);
  loadScreenAssetRecord(P, lookupScreen2AssetIdB(P));
  queueWram3MapToVRAM(P);
  loadScreen2ObjTiles(P);
  enableLCD(P);
  yield* fadeIn(P, 2);
  wram(P, WRAM_SCREEN);
  wr(P, "screenSequenceTimer", 0);
  do {
    yield* advanceFrame(P);
    wr(P, "screenSequenceTimer", rd(P, "screenSequenceTimer") + 1);
  } while (rd(P, "screenSequenceTimer") !== SEQUENCE2_HOLD);
  registerFrameTask(P, 1, TaskFadeInPalette_18);
  registerFrameTask(P, 1, QueueScreen2Sprites);
  sound(P, BGM_THE_END);
  yield* waitAOrB(P);
  rom(P, FAR.SetSaveFlag, { de: SAVEFLAG_OPENING_SEEN });
  setFlag(P, testFlag(P, FLAG_DOUBLES) ? FLAG_ENDING_SEEN_DOUBLES : FLAG_ENDING_SEEN_SINGLES);
  rom(P, FAR.SaveStorySlotWithTimer);
}
// TaskFadeInPalette_18 (18:7A81), a frame task: object palette 0 from PaletteFadeTable_18, a step every 4 frames
// (16 steps)
export function taskFadeInPalette(P) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  const step = rd(P, "endingSceneStep");
  if (step !== FADE_STEPS) {
    loadPalettesImmediate(P, (PaletteFadeTable_18 + ((step * 8) & 0xFF)) & 0xFFFF, OBJ_PALETTES, 1);
    if (!(P.V.vBlankCounter & 3)) wr(P, "endingSceneStep", step + 1);
  }
  wram(P, bank);
}
// TaskDrawObjectSprites_18 (18:7B36), a frame task: each object as two sprites side by side (attribute +0, x +2,
// y +4, first tile +7)
export function taskDrawObjectSprites(P) {
  let r;
  for (let i = 0; i < OBJECTS; i++) {
    const obj = (wScreenScratch + i * OBJECT_SIZE) & 0xFFFF;
    const attr = u8(P, obj), x = u8(P, obj + 2), y = u8(P, obj + 4), tile = u8(P, obj + 7);
    queueSprite(P, attr, tile, x, y);
    r = queueSprite(P, attr, (tile + 2) & 0xFF, (x + 8) & 0xFF, y);
  }
  return r;
}
// TaskUpdateObjects_18 (18:7B6E), a frame task: each object moved (x word +1 by its speed +5, y word +3 by +6), its
// callback (+9) run, and wrapped to the top when it fell below $C0
export function taskUpdateObjects(P) {
  for (let i = 0; i < OBJECTS; i++) {
    const obj = (wScreenScratch + i * OBJECT_SIZE) & 0xFFFF;
    P.bus.w16(obj + 1, (u16(P, obj + 1) + u8(P, obj + 5)) & 0xFFFF);
    P.bus.w16(obj + 3, (u16(P, obj + 3) + u8(P, obj + 6)) & 0xFFFF);
    const callback = u16(P, obj + 9);
    if (callback === ObjectArrayAUpdateCallback_18) objectArrayAUpdateCallback(P, obj);
    else if (callback === ObjectArrayBUpdateCallback_18) objectArrayBUpdateCallback(P, obj);
    else throw new Error(`TaskUpdateObjects_18: callback ${callback.toString(16)}`);
    if (u8(P, obj + 4) >= OBJECT_WRAP_Y) w8(P, obj + 4, OBJECT_TOP_Y);      // ObjectUpdateLoopTail_18
  }
}
// the animation frame (+7, low nibble) stepped by 4 every 8 frames from the object's phase (+8)
const animationDue = (P, obj) => !((P.V.vBlankCounter - u8(P, obj + 8)) & 7);
// ObjectArrayAUpdateCallback_18 (18:7E38): scene A's objects sway (x speed +5 from ObjectArrayAWaveTable_18 by the
// frame and the object's address); the animation steps
export function objectArrayAUpdateCallback(P, obj) {
  w8(P, obj + 5, rb(P, (ObjectArrayAWaveTable_18 + ((P.V.vBlankCounter + obj) & 0x1F)) & 0xFFFF));
  if (!animationDue(P, obj)) return;
  const v = u8(P, obj + 7);
  w8(P, obj + 7, (v & 0xF0) | ((v + 4) & 0x0F));
}
// ObjectArrayBUpdateCallback_18 (18:7E89): scene B's objects: x speed 0-3 by the frame, x drifting
// (ObjectArrayBDriftTable_18); the animation steps (the ROM stores the new low nibble alone: the high one is lost)
export function objectArrayBUpdateCallback(P, obj) {
  const phase = (P.V.vBlankCounter + obj) & 0xFF;
  w8(P, obj + 5, phase & 3);
  w8(P, obj + 2, u8(P, obj + 2) + rb(P, (ObjectArrayBDriftTable_18 + (phase & 0x1F)) & 0xFFFF));
  if (!animationDue(P, obj)) return;
  w8(P, obj + 7, (u8(P, obj + 7) + 4) & 0x0F);
}
// InitObjectSceneA (18:7BCE) / InitObjectSceneB (18:7D03): the objects (16 spawn records of 11 bytes into 16-byte
// slots at wScreenScratch, WRAM 3), their tiles and palettes (LoadObjectSceneATiles 18:7BE7 / ...B 18:7D1C,
// PopulateObjectArrayA 18:7C27 / ...B 18:7D5C). Then the routine's `ret` takes the WRAM bank it pushed (and the
// flags f at its call) as its return address: that code of bank 0 runs and returns to the caller.
export function* initObjectScene(P, f, blocks, spawns, palette) {
  const jump = (P.V.wramBank << 8 | (f & 0xF0)) & 0xFFFF;
  wram(P, WRAM_SCREEN);
  home(P, HOME.ClearBytes, { hl: wScreenScratch, bc: OBJECTS * OBJECT_SIZE });
  populateObjectArray(P, spawns);
  const regs = loadObjectSceneTiles(P, blocks, palette);
  setRegs(P.cpu, regs);
  yield* P.runRom(0, jump);
}
export function populateObjectArray(P, spawns) {
  for (let i = 0; i < OBJECTS; i++) copyMemoryBC(P, (spawns + i * SPAWN_SIZE) & 0xFFFF, (wScreenScratch + i * OBJECT_SIZE) & 0xFFFF, SPAWN_SIZE);
}
// (returns the registers LoadPaletteShadow leaves: the code the scene's `ret` jumps to starts with them)
export function loadObjectSceneTiles(P, blocks, palette) {
  blocks.forEach((block, i) => loadCompressedTileBlock(P, block, vTiles0 + i * 0x10 * TILE_SIZE, OBJECT_BLOCKS));
  return home(P, 0x05B0, { hl: palette, d: OBJ_PALETTES + 1, e: 3 });       // LoadPaletteShadow
}
// the InitObjectScene hooks: as the ROM, the bank pushed stays on the stack for the hook's `ret` to jump to
function initObjectSceneHook(blocks, spawns, palette) {
  return (P, cpu) => {
    const jump = (P.V.wramBank << 8 | (cpu.f & 0xF0)) & 0xFFFF;
    wram(P, WRAM_SCREEN);
    home(P, HOME.ClearBytes, { hl: wScreenScratch, bc: OBJECTS * OBJECT_SIZE });
    populateObjectArray(P, spawns);
    setRegs(cpu, loadObjectSceneTiles(P, blocks, palette));
    cpu.sp = (cpu.sp - 2) & 0xFFFF;                                            // the pushed bank word, under the
    P.bus.w16(cpu.sp, jump);                                                   // return address: the hook's `ret`
  };
}

const B = BANK_SCENES;
export const HOOKS = [
  [B, 0x55B9, hook((P, c) => unusedCopyBytes11(P, c.hl, c.de))],
  [B, 0x55DB, hook(P => { unusedClearTileVramBothBanks(P); })],
  [B, 0x55F8, hook(P => { unusedLoadConfirmScreenSpriteGfx(P); })],
  [B, 0x59C1, hook(P => { unusedLoadCharSelectCursorGfx(P); })],
  [B, 0x59D6, hook((P, c) => { unusedDrawCharSelectCursor(P, c.a, c.d, c.e); })],
  [B, 0x5A6A, hook((P, c) => unusedApplySpriteBobOffset(P, c.e))],
  [B, 0x5AB9, hook((P, c) => loadOnCourtCharTilesA(P, c.a, c.de))],
  [B, 0x5ACE, hook((P, c) => loadOnCourtCharTilesB(P, c.a, c.de))],
  [B, 0x5AE7, hook((P, c) => loadOnCourtCharTilesFallback(P, c.de))],
  [B, 0x7617, hookGen((P, c) => runStorySceneByMode(P, c.c, c.b))],
  [B, 0x7632, hookGen(P => fadeOutAndResetScreen(P))],
  [B, 0x7647, hook(P => resetScrollAndCamera(P))],
  [B, 0x7659, hookGen(P => unusedDebugScreenAssetViewer(P))],
  [B, 0x76B4, hookGen(P => playScreenSequence0(P))],
  [B, 0x7720, hook(P => { setupScreen0Assets(P); })],
  [B, 0x772D, hook(P => ({ c: lookupScreen0AssetId(P) }))],
  [B, 0x7740, hook(P => { loadScreen0TilesAndPalette(P); })],
  [B, QueueScreen0Sprites, hook(P => { queueScreen0Sprites(P); })],
  [B, 0x77BB, hookGen(P => playScreenSequence1(P))],
  [B, 0x7835, hook(P => setupScreen1Assets(P))],
  [B, 0x7842, hook(P => ({ c: lookupScreen1AssetId(P) }))],
  [B, 0x7855, hook(P => { fillAllBgPalettes(P); })],
  [B, 0x78B1, hook(P => { loadScreen1ObjTiles(P); })],
  [B, QueueScreen1Sprites, hook(P => { queueScreen1Sprites(P); })],
  [B, 0x792C, hookGen(P => playScreenSequence2(P))],
  [B, 0x7A07, hook(P => ({ c: lookupScreen2AssetIdA(P) }))],
  [B, 0x7A1A, hook(P => ({ c: lookupScreen2AssetIdB(P) }))],
  [B, 0x7A2D, hook(P => { loadScreen2ObjTiles(P); })],
  [B, QueueScreen2Sprites, hook(P => { queueScreen2Sprites(P); })],
  [B, 0x7A80, hook(() => {})],
  [B, TaskFadeInPalette_18, hook(P => { taskFadeInPalette(P); })],
  [B, 0x7B35, hook(() => {})],
  [B, TaskDrawObjectSprites_18, hook(P => { taskDrawObjectSprites(P); })],
  [B, TaskUpdateObjects_18, hook(P => { taskUpdateObjects(P); })],
  [B, 0x7BCE, initObjectSceneHook(OBJECT_SCENE_A_BLOCKS, ObjectArrayASpawnTable, ObjectSceneATilesPalettes)],
  [B, 0x7BE7, hook(P => loadObjectSceneTiles(P, OBJECT_SCENE_A_BLOCKS, ObjectSceneATilesPalettes))],
  [B, 0x7C27, hook(P => { populateObjectArray(P, ObjectArrayASpawnTable); })],
  [B, 0x7D03, initObjectSceneHook(OBJECT_SCENE_B_BLOCKS, ObjectArrayBSpawnTable, ObjectSceneBPalette)],
  [B, 0x7D1C, hook(P => loadObjectSceneTiles(P, OBJECT_SCENE_B_BLOCKS, ObjectSceneBPalette))],
  [B, 0x7D5C, hook(P => { populateObjectArray(P, ObjectArrayBSpawnTable); })],
];
