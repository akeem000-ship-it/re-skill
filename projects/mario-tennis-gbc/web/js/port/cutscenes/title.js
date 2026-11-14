// The title screen and the intro's title-text helpers (bank $6b): RunTitleScreen with its "START" sprite,
// DecompressIntroTitleTiles (the caption tiles and maps of the intro's last scenes) and two small helpers.
// Port of src/engine/cutscenes/title_6b.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own. (slots_6b.asm and slots_03.asm are the
// banks' $4000 tables: data, nothing to port.)
//
// The title screen: the logo map and its tiles, the "START" sprite (QueueTitleSprite, a frame task) shimmering
// through 8 frames (StepTitleSpriteAnimation); A or START returns 0 (the menus), and after about 13 seconds
// without a press ($9F counted up to $100 every 8 frames) it returns $FF (the intro plays again).
// Covered by the lockstep on out/port/intro1.mtrec (the title times out) and out/engine/exh1.mtrec (START);
// the routines that do not wait also by web/tests/port/routines_cutscenes.mjs.
import {
  WRAM_STAGING, WRAM_SCREEN, WRAM_TEXT, TILE_SIZE, VRAM_BANK1, vTiles0, vTiles1, vTiles2, wDecompBuffer,
  wTextTileBuffer, wTextTileBuffer_SIZE, wWindowShadowTilemap, wWindowShadowAttrmap, BGM_NONE, BGM_TITLE_SCREEN,
  SFX_MENU_DECIDE, PADF_A, PADF_START, FAR, ram, farcall, sound, queueVRAMCopy, decompressData, decompressDataFromBank,
  loadPaletteShadow, queueSpriteTemplate, registerFrameTask, clearFrameTasks, enableLCD, disableLCDSafely,
  advanceFrame, fadeIn, fadeOut, beginFadeOut, waitFadeEnd, wramBank, pushWramBank, popWramBank, hook, FZ, FN,
  cpFlags, incFlags,
} from "./common.js";

const BANK = 0x6B;
const rom = (P, addr) => P.rom.u8(BANK, addr);
export const QueueTitleSprite = 0x76B6;
const TitleSpriteTable0 = 0x76E6, TitleSpriteTable1 = 0x76EE;   // per frame: the first tile, the attribute
const QueueTitleSprite_SpriteTemplate = 0x76F6;
const Palettes_6b_11 = 0x794F;                                   // object palette 0
const DecompressIntroTitleTiles1 = 0x7438, DecompressIntroTitleTiles2 = 0x7515;
const DataPtr_IntroAwesomeTiles = [0x6D, 0x10];                  // (bank, slot)
const SCREENASSET_TitleScreen = 0x1F;
const TITLE_TILE_BLOCKS = [                                      // TILEBLOCK_TitleGfx0-7: block, VRAM destination
  [0x5B, vTiles0 + VRAM_BANK1], [0x5C, vTiles0 + 0x20 * TILE_SIZE + VRAM_BANK1],
  [0x5D, vTiles0 + 0x40 * TILE_SIZE + VRAM_BANK1], [0x5E, vTiles0 + 0x60 * TILE_SIZE + VRAM_BANK1],
  [0x5F, vTiles0], [0x60, vTiles0 + 0x20 * TILE_SIZE], [0x61, vTiles0 + 0x40 * TILE_SIZE], [0x62, vTiles0 + 0x60 * TILE_SIZE],
];
const TITLE_TILES_PER_BLOCK = 0x14;                              // TitleGfx?_SIZE / 16
const TITLE_SPRITE_X = 0x28, TITLE_SPRITE_Y = 0x58;
const TITLE_SPRITE_FRAMES = 8, TITLE_SPRITE_PAUSE = 0x10;
const TITLE_TIMEOUT_START = 0x9F;                                // counted up every 8 frames; $100 ends the screen
export const TITLE_START = 0x00, TITLE_TIMEOUT = 0xFF;           // RunTitleScreen's results

// DecompressIntroTitleTiles (6b:73F2), also its slots $400C-$4010: IntroAwesomeTiles' first 128 tiles to $9000
// (through WRAM 1, with the text tiles to $8800) and the intro's caption map (DecompressIntroTitleTiles1/2, tiles
// and attributes) into WRAM 5's window shadow maps. Leaves a = the WRAM bank restored and the entry flags.
export function decompressIntroTitleTiles(P) {
  pushWramBank(P, WRAM_STAGING);
  decompressDataFromBank(P, ...DataPtr_IntroAwesomeTiles, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles2, 128);
  queueVRAMCopy(P, wTextTileBuffer, vTiles1, wTextTileBuffer_SIZE / 16);
  wramBank(P, WRAM_TEXT);
  decompressData(P, DecompressIntroTitleTiles1, wWindowShadowTilemap);
  decompressData(P, DecompressIntroTitleTiles2, wWindowShadowAttrmap);
  const af = popWramBank(P);
  return { a: af >> 8, f: af & 0xF0 };
}
// Unused_6b_IncrementCutsceneStepTimer (6b:7561): wCutsceneStepTimer + 1. Nothing calls it.
export function incrementCutsceneStepTimer(P, f) {
  const R = ram(P), t = R.cutsceneStepTimer;
  R.cutsceneStepTimer = t + 1;
  return { a: (t + 1) & 0xFF, f: incFlags(t, f) };
}
// ApplyScrollYFromWram (6b:7569), a frame task of intro state 18: hScrollY = wCutsceneSpriteAX
export function applyScrollYFromWram(P) {
  const a = ram(P).cutsceneSpriteAX;
  P.V.scrollY = a;
  return { a };
}

// RunTitleScreen (6b:75AF): the title screen (above). Returns a = TITLE_START or TITLE_TIMEOUT.
export function* runTitleScreen(P) {
  const R = ram(P), { V } = P;
  clearFrameTasks(P);
  wramBank(P, WRAM_SCREEN);
  V.scrollX = 0; V.scrollY = 0;
  R.screenScratch = 0; R.titleSpriteFrame = 0; R.titleSpriteTimer = 0;
  R.screenScratch = 0x98;
  yield* fadeOut(P, 127);
  disableLCDSafely(P);
  yield* fadeOut(P, 127);
  farcall(P, FAR.LoadScreenAssetRecord, { c: SCREENASSET_TitleScreen });
  farcall(P, FAR.QueueWram3MapToVRAM);
  for (const [b, dest] of TITLE_TILE_BLOCKS) farcall(P, FAR.LoadCompressedTileBlock, { c: TITLE_TILES_PER_BLOCK, b, d: dest >> 8, e: dest & 0xFF });
  loadPaletteShadow(P, Palettes_6b_11, 8, 1);
  registerFrameTask(P, 1, QueueTitleSprite);
  sound(P, BGM_TITLE_SCREEN);
  enableLCD(P);
  yield* fadeIn(P, 4);
  wramBank(P, WRAM_SCREEN);
  R.screenScratch = TITLE_TIMEOUT_START;
  for (;;) {
    stepTitleSpriteAnimation(P);
    yield* advanceFrame(P);
    if (V.inputRisingEdge & (PADF_A | PADF_START)) {
      sound(P, BGM_NONE);
      sound(P, SFX_MENU_DECIDE);
      clearFrameTasks(P);
      yield* fadeOut(P, 16);
      return { a: TITLE_START, f: FZ };
    }
    if (V.vBlankCounter & 7) continue;
    R.screenScratch += 1;
    if (!R.screenScratch) break;
  }
  sound(P, BGM_NONE);
  clearFrameTasks(P);
  beginFadeOut(P, 8);
  yield* waitFadeEnd(P);
  return { a: TITLE_TIMEOUT };
  // (RunTitleScreen 6b:7691-76A5, after the first return: the music stopped, a fade, the LCD STAT interrupt off and
  // a = 1. Nothing reaches it; not ported.)
}
// QueueTitleSprite (6b:76B6), a frame task: the "START" sprite's frame (first tile and attribute from the two
// tables) at ($28, $58). Leaves a = the WRAM bank restored and the entry flags.
export function queueTitleSprite(P) {
  pushWramBank(P, WRAM_SCREEN);
  const frame = ram(P).titleSpriteFrame;
  queueSpriteTemplate(P, QueueTitleSprite_SpriteTemplate, TITLE_SPRITE_X, TITLE_SPRITE_Y, rom(P, TitleSpriteTable0 + frame), rom(P, TitleSpriteTable1 + frame));
  const af = popWramBank(P);
  return { a: af >> 8, f: af & 0xF0 };
}
// StepTitleSpriteAnimation (6b:771F): every 8 frames the next of the 8 frames; after the last, a pause of 15
// frames (wTitleSpriteTimer counting up to $10)
export function stepTitleSpriteAnimation(P) {
  const R = ram(P);
  const timer = R.titleSpriteTimer;
  if (timer) {
    const t = (timer + 1) & 0xFF;
    R.titleSpriteTimer = t;
    if (t !== TITLE_SPRITE_PAUSE) return { a: t, f: cpFlags(t, TITLE_SPRITE_PAUSE) };
    R.titleSpriteTimer = 0;
    return { a: 0, f: FZ };
  }
  const tick = P.V.vBlankCounter & 7;
  if (tick !== 7) return { a: tick, f: cpFlags(tick, 7) };
  const frame = (R.titleSpriteFrame + 1) & (TITLE_SPRITE_FRAMES - 1);
  R.titleSpriteFrame = frame;
  if (frame !== TITLE_SPRITE_FRAMES - 1) return { a: frame, f: cpFlags(frame, 7) };
  R.titleSpriteTimer = 1;
  return { a: 1, f: FZ | FN };
}

export const HOOKS = [
  hook(BANK, 0x73F2, decompressIntroTitleTiles),
  hook(BANK, 0x7561, (P, c) => incrementCutsceneStepTimer(P, c.f)),
  hook(BANK, 0x7569, applyScrollYFromWram),
  hook(BANK, 0x75AF, runTitleScreen),
  hook(BANK, QueueTitleSprite, queueTitleSprite),
  hook(BANK, 0x771F, stepTitleSpriteAnimation),
];
