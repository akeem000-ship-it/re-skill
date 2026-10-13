// The intro cutscene's scenes and sprites (bank $6b): the screen setups the intro states call, the per-frame
// helpers of the scrolling "ball in the sky" scene, the sprite groups of the rally scenes, the frame tasks (the
// skip check, the scrolls, the palette animations of the "Raucous rallies" scene) and the logo screen.
// Port of src/engine/cutscenes/intro_scenes_6b.asm and the routines of intro_finale_6b.asm (from
// UpdateCutsceneScrollX on) of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm):
// names and addresses are its own. The intro's state machine is in intro_states.js.
//
// Tables, palettes, sprite templates and compressed graphics are read from the ROM at their addresses.
// Covered by the lockstep on out/port/intro1.mtrec (the whole intro, twice, and the title screen); the routines
// that do not wait also by the routine tests in web/tests/port/routines_cutscenes.mjs.
import {
  WRAM_STAGING, WRAM_COURT_PLANES, WRAM_SCREEN, TILE_SIZE, VRAM_BANK1, vTiles0, vTiles1, vTiles2, OAM_BANK1,
  wDecompBuffer, wTextTileBuffer, wTextTileBuffer_SIZE, wScreenAttrmap, wShadowTilemap, SFX_LOGO_JINGLE, FAR,
  ram, farcall, sound, queueVRAMCopy, decompressData, loadPaletteShadow, loadPalettesImmediate, queueSpriteTemplate,
  registerFrameTask, unregisterFrameTask, enableLCD, disableLCDSafely, advanceFrame, fadeIn, fadeOut, wramBank,
  hook, FZ, FN, FH, FC, cpFlags, addFlags, andFlags,
} from "./common.js";

export const BANK = 0x6B;
const rom = (P, addr) => P.rom.u8(BANK, addr);

// ---- addresses in bank $6b ----
export const CheckIntroSkipInput = 0x53F1;
export const QueueCutsceneSpriteGroupA = 0x526A, QueueCutsceneSpriteGroupB = 0x52F9;
export const UpdateCutsceneScroll = 0x53DB;
export const IntroSequenceTimerTask = 0x7083, AnimateBgPalette1Task = 0x72AF, AnimateBgPalettes2And3Task = 0x72DD;
export const CycleBgPalettes4To7Task = 0x731B;
export const ScrollCutsceneXRightTask = 0x7366, ScrollCutsceneXLeftTask = 0x7395, ScrollCutsceneLeftTask = 0x73C4;
const CutsceneSceneAGfx0 = 0x551D, CutsceneSceneAGfx1 = 0x5D65, CutsceneSceneAGfx2 = 0x5EA8;
const CutsceneSceneBGfx0 = 0x59D7, CutsceneSceneBGfx1 = 0x5BD7;
export const Palette_6b_1 = 0x5D25;                        // 8 background palettes
const IntroPalettes = 0x60C5, CutsceneTilesetPalettes = 0x525A;   // 2 object palettes each
const TitleSceneGraphicsGfx0 = 0x61E6, TitleSceneGraphicsGfx1 = 0x6CBC, TitleSceneGraphicsGfx2 = 0x6F0F;
const TitleScenePalette = 0x7043;
const IntroSpriteBlockTable = 0x6139, QueueIntroSpriteBlock_SpriteTemplate = 0x613D;
const CutsceneScrollXTable = 0x4CC1, CutsceneScrollYTable = 0x4D84;
// the three sprites riding the "ball in the sky" scene's scroll: their position tables (y, x per frame from
// step $20) and templates, drawn in this order with tiles $40, $44, $48
const ANIMATED_SPRITES = [[0x506D, 0x4E8E, 0x40], [0x4F95, 0x4E97, 0x44], [0x4EA5, 0x4EA0, 0x48]];
const CutsceneBobOffsetTable = 0x53CB;                     // 16 bytes: the rally sprites' bob, by the step timer
const BgPalette1TaskPalettes = 0x70AF, BgPalettes2And3TaskPalettes0 = 0x712F, BgPalettes2And3TaskPalettes1 = 0x71AF;
const BgPalettes4To7TaskPalettes = 0x722F;
const ScrollCutsceneXRightTaskTable = 0x7381, ScrollCutsceneXLeftTaskTable = 0x73B0, ScrollCutsceneLeftTaskTable = 0x73DF;
// sprite groups: [template, x offset, y offset, tile] from (wCutsceneSprite?X, wCutsceneSprite?Y)
const SPRITE_GROUP_A = [[0x52B6, 0x10, 0x00, 0x00], [0x52C3, 0x08, 0x10, 0x06], [0x52D8, 0x00, 0x20, 0x10]];
const SPRITE_GROUP_B = [[0x5360, 0x18, 0x00, 0x20], [0x536D, 0x08, 0x10, 0x26], [0x5392, 0x00, 0x20, 0x38], [0x53B3, 0x48, 0x20, 0x48]];
// tile blocks (LoadCompressedTileBlock: block, tiles, VRAM destination), in the order loaded
const INTRO_TILE_BLOCKS = [                                // TILEBLOCK_IntroGfx0-6
  [0x54, 0x10, vTiles0 + VRAM_BANK1], [0x55, 0x10, vTiles0 + 0x10 * TILE_SIZE + VRAM_BANK1],
  [0x56, 0x10, vTiles0 + 0x20 * TILE_SIZE + VRAM_BANK1], [0x57, 0x10, vTiles0 + 0x30 * TILE_SIZE + VRAM_BANK1],
  [0x58, 0x04, vTiles0 + 0x40 * TILE_SIZE + VRAM_BANK1], [0x59, 0x04, vTiles0 + 0x44 * TILE_SIZE + VRAM_BANK1],
  [0x5A, 0x04, vTiles0 + 0x48 * TILE_SIZE + VRAM_BANK1],   // (4 tiles of IntroGfx6's 2)
];
const CUTSCENE_TILE_BLOCKS = [                             // TILEBLOCK_CutsceneGfx0-6
  [0x4D, 0x06, vTiles0 + VRAM_BANK1], [0x4E, 0x0A, vTiles0 + 0x06 * TILE_SIZE + VRAM_BANK1],
  [0x4F, 0x10, vTiles0 + 0x10 * TILE_SIZE + VRAM_BANK1], [0x50, 0x06, vTiles0 + 0x20 * TILE_SIZE + VRAM_BANK1],
  [0x51, 0x12, vTiles0 + 0x26 * TILE_SIZE + VRAM_BANK1], [0x52, 0x10, vTiles0 + 0x38 * TILE_SIZE + VRAM_BANK1],
  [0x53, 0x02, vTiles0 + 0x48 * TILE_SIZE + VRAM_BANK1],
];
const SCREENASSET_CompanyLogos = 0x15;
const LOGO_SCROLL_Y = 0xD8, LOGO_SCROLL_OUT_Y = 0x40;
const CAMERA_Y_SCENE = 0x24;                               // the high byte of wCameraY the scenes are copied at
const INTRO_SKIP_BUTTONS = 0x09;                           // A or START
const PALETTE_STEPS = 0x10;                                // the palette animations' 16 steps (8 bytes each)

// a 16-bit `ld a, l / sub e / ld l, a / ld a, h / sbc d / ld h, a`: hl - de and the flags of the sbc
function sub16(hl, de) {
  const borrow = (hl & 0xFF) < (de & 0xFF) ? 1 : 0, h = hl >> 8, d = de >> 8;
  const f = (((h - d - borrow) & 0xFF) === 0 ? FZ : 0) | FN | ((h & 0xF) < (d & 0xF) + borrow ? FH : 0) | (h < d + borrow ? FC : 0);
  return { v: (hl - de) & 0xFFFF, f };
}
const loadTileBlocks = (P, blocks) => { for (const [b, c, dest] of blocks) farcall(P, FAR.LoadCompressedTileBlock, { b, c, d: dest >> 8, e: dest & 0xFF }); };

// CheckIntroSkipInput (6b:53F1), a frame task: A or START pressed ends the intro (wIntroCutsceneCheck)
export function checkIntroSkipInput(P) {
  const a = P.V.inputRisingEdge & INTRO_SKIP_BUTTONS;
  if (!a) return { a, f: FZ | FH };
  ram(P).introCutsceneCheck = 1;
  return { a: 1, f: FH };
}

// ---- screen setups (the LCD is switched off first) ----
// InitCutsceneSceneA (6b:53FC) / Unused_6b_InitCutsceneSceneB (6b:545E) / InitCutsceneSceneC (6b:54B9): the scroll
// and the text windows reset, CutsceneSceneAGfx0's first 128 tiles to $9000 (and the text tiles to $8800), a scene
// map (attributes into WRAM 2, tiles into WRAM 3: scene A's own, or scene B's) copied to the screen at camera Y
// $2400. C also loads Palette_6b_1; A leaves the camera's high Y at 0 and clears the low X too.
function initCutsceneScene(P, { attrmap, tilemap, palette, clearX, resetY }) {
  disableLCDSafely(P);
  farcall(P, FAR.InitSceneScroll);
  farcall(P, FAR.InitTextWindows);
  wramBank(P, WRAM_STAGING);
  decompressData(P, CutsceneSceneAGfx0, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles2, 128);               // 128 of CutsceneSceneAGfx0's 144 tiles
  queueVRAMCopy(P, wTextTileBuffer, vTiles1, wTextTileBuffer_SIZE / 16);
  wramBank(P, WRAM_COURT_PLANES);
  decompressData(P, attrmap, wScreenAttrmap);
  wramBank(P, WRAM_SCREEN);
  decompressData(P, tilemap, wShadowTilemap);
  if (palette) loadPaletteShadow(P, palette, 0, 8);
  P.bus.w8(P.A.cameraY, 0);
  if (clearX) P.bus.w8(P.A.cameraX, 0);
  P.bus.w8(P.A.cameraY + 1, CAMERA_Y_SCENE);
  farcall(P, FAR.CopyScrolledSceneTilemapToVram, { a: 1 });
  if (!resetY) return {};
  P.bus.w8(P.A.cameraY + 1, 0);
  return { a: 0, f: FZ };
}
export const initCutsceneSceneA = P => initCutsceneScene(P, { attrmap: CutsceneSceneAGfx1, tilemap: CutsceneSceneAGfx2, clearX: true, resetY: true });
export const initCutsceneSceneB = P => initCutsceneScene(P, { attrmap: CutsceneSceneBGfx1, tilemap: CutsceneSceneBGfx0 });
export const initCutsceneSceneC = P => initCutsceneScene(P, { attrmap: CutsceneSceneBGfx1, tilemap: CutsceneSceneBGfx0, palette: Palette_6b_1 });

// LoadIntroTilesAndPalette (6b:6075): the intro's sprite tiles (IntroGfx0-6) into VRAM bank 1 and its two object
// palettes
export function loadIntroTilesAndPalette(P) {
  loadTileBlocks(P, INTRO_TILE_BLOCKS);
  loadPaletteShadow(P, IntroPalettes, 8, 2);
}

// InitTitleSceneGraphics (6b:617C): the "Raucous rallies" scene: TitleSceneGraphicsGfx0's first 128 tiles to
// $9000 in VRAM bank 1 (and the text tiles to $8800 there), its map (attributes into WRAM 2, tiles into WRAM 3),
// its 8 background palettes, and the map copied to the screen at camera X $2000, Y 0
export function initTitleSceneGraphics(P) {
  const R = ram(P);
  disableLCDSafely(P);
  farcall(P, FAR.InitSceneScroll);
  farcall(P, FAR.InitTextWindows);
  wramBank(P, WRAM_STAGING);
  decompressData(P, TitleSceneGraphicsGfx0, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles2 + VRAM_BANK1, 128);  // 128 of its 241 tiles
  queueVRAMCopy(P, wTextTileBuffer, vTiles1 + VRAM_BANK1, wTextTileBuffer_SIZE / 16);
  wramBank(P, WRAM_COURT_PLANES);
  decompressData(P, TitleSceneGraphicsGfx2, wScreenAttrmap);
  wramBank(P, WRAM_SCREEN);
  decompressData(P, TitleSceneGraphicsGfx1, wShadowTilemap);
  loadPaletteShadow(P, TitleScenePalette, 0, 8);
  R.cameraX = 0x2000;
  R.cameraY = 0;
  farcall(P, FAR.CopyScrolledSceneTilemapToVram, { a: 1 });
}

// ---- the "ball in the sky" scene (intro states 00 and 19): a sprite block over the map scrolling down ----
// SetCameraYFromScrollPos (6b:60D5): wCameraY = wIntroCutsceneScrollY * 32
export function setCameraYFromScrollPos(P) {
  const R = ram(P), y = R.introCutsceneScrollY, v = (y << 5) & 0xFFFF;
  R.cameraY = v;
  return { a: v >> 8, de: v, hl: P.A.introCutsceneScrollY + 1, f: (v >> 8 ? 0 : FZ) | (y & 0x800 ? FC : 0) };
}
// QueueScrollingSprite (6b:60F8): the sprite block of wCutsceneSpriteAnimFrame at x $40, y = wCutsceneScrollAccum -
// wIntroCutsceneScrollY (low byte)
export function queueScrollingSprite(P) {
  const R = ram(P), y = (R.cutsceneScrollAccum - R.introCutsceneScrollY) & 0xFF;
  return queueIntroSpriteBlock(P, R.cutsceneSpriteAnimFrame, 0x40, y);
}
// AdvanceSpriteAnimTimer (6b:6115): the tick counts up; the frame is its bits 4-5 (a new frame every 16 ticks)
export function advanceSpriteAnimTimer(P) {
  const R = ram(P), tick = (R.cutsceneSpriteAnimTick + 1) & 0xFF;
  R.cutsceneSpriteAnimTick = tick;
  const frame = (tick & 0x30) >> 4;
  R.cutsceneSpriteAnimFrame = frame;
  return { a: frame, f: 0 };
}
// QueueIntroSpriteBlock (6b:6126): frame c's 2x4 block of 16-pixel sprites (tiles from IntroSpriteBlockTable[c],
// VRAM bank 1) at (d, e)
export function queueIntroSpriteBlock(P, frame, x, y) {
  return queueSpriteTemplate(P, QueueIntroSpriteBlock_SpriteTemplate, x, y, rom(P, IntroSpriteBlockTable + frame), OAM_BANK1);
}
// Unused_6b_RewriteCutsceneCameraY (6b:615E): from step $14 on with a camera high Y byte, writes wCameraY back
// unchanged. Nothing calls it.
export function rewriteCutsceneCameraY(P) {
  const R = ram(P), t = R.cutsceneStepTimer;
  if (t < 0x14) return { a: t, f: cpFlags(t, 0x14) };
  const y = R.cameraY;
  if (!(y >> 8)) return { a: 0, f: FZ };
  R.cameraY = y;
  return { a: y & 0xFF, hl: y, f: 0 };
}
// UpdateCutsceneScrollX (6b:4C9E) / UpdateCutsceneScrollY (6b:4D61): wIntroCutsceneScrollY / wCutsceneScrollAccum
// minus this step's byte of CutsceneScrollXTable / CutsceneScrollYTable
function scrollByTable(P, name, table) {
  const R = ram(P), e = rom(P, table + R.cutsceneStepTimer), r = sub16(R[name], e);
  R[name] = r.v;
  return { a: r.v & 0xFF, hl: r.v, de: e, f: r.f };
}
export const updateCutsceneScrollX = P => scrollByTable(P, "introCutsceneScrollY", CutsceneScrollXTable);
export const updateCutsceneScrollY = P => scrollByTable(P, "cutsceneScrollAccum", CutsceneScrollYTable);
// QueueCutsceneAnimatedSprites (6b:4E2D): from step $20, three sprites at this step's (y, x) of their tables,
// y scrolled with the scene (ApplyCutsceneScrollToSpriteX); palette 1, VRAM bank 1
export function queueCutsceneAnimatedSprites(P) {
  const t = ram(P).cutsceneStepTimer;
  if (t < 0x20) return { a: t, f: cpFlags(t, 0x20) };
  let r;
  for (const [table, template, tile] of ANIMATED_SPRITES) {
    const at = table + (((t - 0x20) * 2) & 0xFF);
    const pos = applyCutsceneScrollToSpriteX(P, rom(P, at + 1), rom(P, at));
    r = queueSpriteTemplate(P, template, pos.d, pos.e, tile, OAM_BANK1 | 1);
  }
  return r;
}
// ApplyCutsceneScrollToSpriteX (6b:518D): e = e - wIntroCutsceneScrollY (as a 16-bit difference, low byte); d kept.
// Leaves a = the difference's high byte, and the flags of its sbc; bc and hl kept.
export function applyCutsceneScrollToSpriteX(P, d, e) {
  const r = sub16(e, ram(P).introCutsceneScrollY);
  return { d, e: r.v & 0xFF, a: r.v >> 8, f: r.f };
}

// ---- the rally scenes: two sprite groups and the raster-split scroll ----
// LoadCutsceneTileset (6b:520A): the rally sprites' tiles (CutsceneGfx0-6) into VRAM bank 1, two object palettes
export function loadCutsceneTileset(P) {
  loadTileBlocks(P, CUTSCENE_TILE_BLOCKS);
  return loadPaletteShadow(P, CutsceneTilesetPalettes, 8, 2);
}
// QueueCutsceneSpriteGroupA (6b:526A) / QueueCutsceneSpriteGroupB (6b:52F9), frame tasks: the player on the left
// (three templates around (wCutsceneSpriteAX, wCutsceneSpriteAY), palette 0) / on the right (four around
// (BX, BY), palette 1), both bobbing with the step timer
function queueSpriteGroup(P, group, x, y, attr) {
  let r;
  for (const [template, dx, dy, tile] of group) {
    const bob = applyCutsceneBobOffset(P, (y + dy) & 0xFF);
    r = queueSpriteTemplate(P, template, x + dx, bob.e, tile, attr);
  }
  return r;
}
export const queueCutsceneSpriteGroupA = P => queueSpriteGroup(P, SPRITE_GROUP_A, ram(P).cutsceneSpriteAX, ram(P).cutsceneSpriteAY, OAM_BANK1);
export const queueCutsceneSpriteGroupB = P => queueSpriteGroup(P, SPRITE_GROUP_B, ram(P).cutsceneSpriteBX, ram(P).cutsceneSpriteBY, OAM_BANK1 | 1);
// ApplyCutsceneBobOffset (6b:53B8): e + CutsceneBobOffsetTable[step timer & 15]; hl kept
export function applyCutsceneBobOffset(P, e) {
  const bob = rom(P, CutsceneBobOffsetTable + (ram(P).cutsceneStepTimer & 0x0F)), v = (bob + e) & 0xFF;
  return { a: v, e: v, f: addFlags(bob, e) };
}
// UpdateCutsceneScroll (6b:53DB), a frame task: the screen scrolls right 3 pixels a frame, the raster band
// (wRasterScrollX, drawn by the LCD STAT handler) left 3
export function updateCutsceneScroll(P) {
  const R = ram(P);
  R.cutsceneScrollX += 3;
  P.V.scrollX = R.cutsceneScrollX;
  const band = R.introCutsceneSubState;
  R.introCutsceneSubState = band - 3;
  R.rasterScrollX = R.introCutsceneSubState;
  return { a: R.introCutsceneSubState, f: cpFlags(band, 3) };
}

// ---- frame tasks of the "Raucous rallies" scene (intro state 07) ----
// IntroSequenceTimerTask (6b:7083): counts frames in wCutsceneSpriteAX and starts the palette animations: 4-7 at
// $5A, 1 at $AA, 2-3 at 1. RegisterFrameTask leaves a = 1, so a start at $5A or $AA also (re)starts 2-3.
export function introSequenceTimerTask(P) {
  const R = ram(P);
  let a = (R.cutsceneSpriteAX + 1) & 0xFF;
  R.cutsceneSpriteAX = a;
  if (a === 0x5A) a = registerFrameTask(P, 1, CycleBgPalettes4To7Task).a;
  if (a === 0xAA) a = registerFrameTask(P, 1, AnimateBgPalette1Task).a;
  if (a !== 0x01) return { a, f: cpFlags(a, 0x01) };
  return registerFrameTask(P, 1, AnimateBgPalettes2And3Task);
}
// a palette step every 4 frames (when hVBlankCounter & 3 is 3)
const notThisFrame = P => { const a = P.V.vBlankCounter & 3; return a === 3 ? null : { a, f: cpFlags(a, 3) }; };
// AnimateBgPalette1Task (6b:72AF): background palette 1 through BgPalette1TaskPalettes' 16 steps (wCutsceneSpriteAY),
// then the task ends
export function animateBgPalette1Task(P) {
  const skip = notThisFrame(P); if (skip) return skip;
  const R = ram(P), step = (R.cutsceneSpriteAY + 1) & 0xFF;
  R.cutsceneSpriteAY = step;
  if (step >= PALETTE_STEPS) return unregisterFrameTask(P, AnimateBgPalette1Task);
  return loadPalettesImmediate(P, BgPalette1TaskPalettes + ((step << 3) & 0xFF), 1, 1);
}
// AnimateBgPalettes2And3Task (6b:72DD): background palettes 2 and 3 through their 16 steps (wCutsceneSpriteBX)
export function animateBgPalettes2And3Task(P) {
  const skip = notThisFrame(P); if (skip) return skip;
  const R = ram(P), step = (R.cutsceneSpriteBX + 1) & 0xFF;
  R.cutsceneSpriteBX = step;
  if (step >= PALETTE_STEPS) return unregisterFrameTask(P, AnimateBgPalettes2And3Task);
  const offset = (step << 3) & 0xFF;
  loadPalettesImmediate(P, BgPalettes2And3TaskPalettes0 + offset, 2, 1);
  return loadPalettesImmediate(P, BgPalettes2And3TaskPalettes1 + offset, 3, 1);
}
// CycleBgPalettes4To7Task (6b:731B): background palettes 4-7 through BgPalettes4To7TaskPalettes' steps
// (wCutsceneSpriteBY, 8 bytes a step: one color of each); the task ends at step $10. (A step of $20 or more,
// never reached, would count back from $20.)
export function cycleBgPalettes4To7Task(P) {
  const skip = notThisFrame(P); if (skip) return skip;
  const R = ram(P), step = (R.cutsceneSpriteBY + 1) & 0xFF;
  R.cutsceneSpriteBY = step;
  if (step < PALETTE_STEPS) return loadPalettesImmediate(P, BgPalettes4To7TaskPalettes + ((step << 3) & 0xFF), 4, 4);
  if (step < 0x20) return unregisterFrameTask(P, CycleBgPalettes4To7Task);
  const back = (0x20 - step) & 0xFF;
  return { ...loadPalettesImmediate(P, BgPalettes4To7TaskPalettes + ((back << 3) & 0xFF), 4, 4), b: step };
}

// ---- frame tasks of the opponents' scenes (intro states 08-10): a quick pan that slows down ----
// ScrollCutsceneXRightTask (6b:7366) / ScrollCutsceneXLeftTask (6b:7395) / ScrollCutsceneLeftTask (6b:73C4): for the
// first 16 steps, wCutsceneScrollX (and hScrollX) moves by the step's byte of the task's table
function scrollTask(P, table, sign) {
  const R = ram(P), t = R.cutsceneStepTimer;
  if (t >= 0x10) return { a: t, f: cpFlags(t, 0x10) };
  const at = table + t, b = rom(P, at), x = R.cutsceneScrollX;
  const v = (x + sign * b) & 0xFF;
  R.cutsceneScrollX = v;
  P.V.scrollX = v;
  return { a: v, b, hl: at, f: sign > 0 ? addFlags(x, b) : cpFlags(x, b) };
}
export const scrollCutsceneXRightTask = P => scrollTask(P, ScrollCutsceneXRightTaskTable, 1);
export const scrollCutsceneXLeftTask = P => scrollTask(P, ScrollCutsceneXLeftTaskTable, -1);
export const scrollCutsceneLeftTask = P => scrollTask(P, ScrollCutsceneLeftTaskTable, -1);

// ---- the logo screen (the debug map's intro: ShowIntroLogoScreen, then ScrollOutIntroLogo) ----
// ShowIntroLogoScreen (6b:51AE): the company logos at scroll Y $D8, the logo jingle, a fade in, 60 frames
export function* showIntroLogoScreen(P) {
  const R = ram(P), { V } = P;
  disableLCDSafely(P);
  farcall(P, FAR.LoadScreenAssetRecord, { c: SCREENASSET_CompanyLogos });
  farcall(P, FAR.QueueWram3MapToVRAM);
  V.scrollX = 0; V.scrollY = 0;
  R.cutsceneStepTimer = 0;
  V.scrollY = LOGO_SCROLL_Y;
  sound(P, SFX_LOGO_JINGLE);
  enableLCD(P);
  yield* fadeIn(P, 32);
  do {
    yield* advanceFrame(P);
    R.cutsceneStepTimer += 1;
  } while (R.cutsceneStepTimer !== 0x3C);
  R.cutsceneStepTimer = 0;
  return { a: 0, f: FZ };
}
// ScrollOutIntroLogo (6b:51E7): scroll Y $40 until the step timer (left at 0 by ShowIntroLogoScreen) reaches $3E,
// then fade out and switch the LCD off
export function* scrollOutIntroLogo(P) {
  const R = ram(P);
  P.V.scrollY = LOGO_SCROLL_OUT_Y;
  do {
    yield* advanceFrame(P);
    R.cutsceneStepTimer += 1;
  } while (R.cutsceneStepTimer !== 0x3E);
  yield* fadeOut(P, 16);
  disableLCDSafely(P);
  P.V.scrollY = 0;
  return { a: 0, f: FZ };
}
// (ApplyCutsceneScrollToSpriteX.loop, 6b:51A5: a loop waiting for A that nothing reaches; not ported)

export const HOOKS = [
  hook(BANK, CheckIntroSkipInput, checkIntroSkipInput),
  hook(BANK, 0x53FC, initCutsceneSceneA),
  hook(BANK, 0x545E, initCutsceneSceneB),
  hook(BANK, 0x54B9, initCutsceneSceneC),
  hook(BANK, 0x6075, loadIntroTilesAndPalette),
  hook(BANK, 0x617C, initTitleSceneGraphics),
  hook(BANK, 0x60D5, setCameraYFromScrollPos),
  hook(BANK, 0x60F8, queueScrollingSprite),
  hook(BANK, 0x6115, advanceSpriteAnimTimer),
  hook(BANK, 0x6126, (P, c) => queueIntroSpriteBlock(P, c.c, c.d, c.e)),
  hook(BANK, 0x615E, rewriteCutsceneCameraY),
  hook(BANK, 0x4C9E, updateCutsceneScrollX),
  hook(BANK, 0x4D61, updateCutsceneScrollY),
  hook(BANK, 0x4E2D, queueCutsceneAnimatedSprites),
  hook(BANK, 0x518D, (P, c) => applyCutsceneScrollToSpriteX(P, c.d, c.e)),
  hook(BANK, 0x520A, loadCutsceneTileset),
  hook(BANK, QueueCutsceneSpriteGroupA, queueCutsceneSpriteGroupA),
  hook(BANK, QueueCutsceneSpriteGroupB, queueCutsceneSpriteGroupB),
  hook(BANK, 0x53B8, (P, c) => applyCutsceneBobOffset(P, c.e)),
  hook(BANK, UpdateCutsceneScroll, updateCutsceneScroll),
  hook(BANK, IntroSequenceTimerTask, introSequenceTimerTask),
  hook(BANK, AnimateBgPalette1Task, animateBgPalette1Task),
  hook(BANK, AnimateBgPalettes2And3Task, animateBgPalettes2And3Task),
  hook(BANK, CycleBgPalettes4To7Task, cycleBgPalettes4To7Task),
  hook(BANK, ScrollCutsceneXRightTask, scrollCutsceneXRightTask),
  hook(BANK, ScrollCutsceneXLeftTask, scrollCutsceneXLeftTask),
  hook(BANK, ScrollCutsceneLeftTask, scrollCutsceneLeftTask),
  hook(BANK, 0x51AE, showIntroLogoScreen),
  hook(BANK, 0x51E7, scrollOutIntroLogo),
];
