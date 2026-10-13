// The ending credits (bank $0A, $6E40-$6F44): the ending's 21 scenes, each a re-dressed story location run as
// usual (with FLAG_ENDING_CREDITS_RUNNING: no music change, the raster scroll), then frozen, greyed and overlaid
// with a page of scrolling text (bank 3's cutscene window); then the result screen.
// Port of credits_0a.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm),
// whose routine names these are (CheckBallHitsMinigameTargetAlt, at its start, is in minigame.js).
// Covered by the lockstep when a recording reaches the ending (none does yet: see the report).
import {
  FZ, FN, FH, FC, WRAM_ACTORS, BANK_STORY, wActors, ACTOR_SIZE, NUM_ACTORS, ACTORF_FLAGS,
  FLAG_ENDING_CREDITS_RUNNING, FLAG_ENDING_CREDITS_PENDING, FLAG_VRAM_UPDATE_BUSY, FLAG_ACTORS_FROZEN, hook,
  hookGen, testFlag, setFlag, clearFlag, ClearFrameTasks, spAddFlags,
} from "./common.js";
import { beginFadeOut, waitFadeEnd } from "../home/colorfade.js";
import { loadPalettesMasterOnly } from "../home/palettes.js";
import { playSoundManaged } from "../audio/requests.js";
import { runStoryLocation } from "./story_loop.js";

const BANK = BANK_STORY;
const EndingCutsceneLocationList = 0x6E40, EndingCreditsSequencePalette = 0x6E6C;
const BGM_CREDITS = 0x2C, PADF_SELECT = 0x04, rWY = 0xFF4A, WY_HIDDEN = 0x90;
const BANK_GAME = 0x01, LoadMenuFontGfx = 0x50E2;
const BANK_CUTSCENE = 0x03, InitGrayscalePaletteFade = 0x75AB, SetupPaletteFadeMask = 0x7687;
const AnimatePaletteFadeToTarget = 0x7719, PlayScrollingStoryCutscene = 0x6FF7, ShowStoryResultScreen = 0x751E;
const GREY_PALETTES = 0x3F, GREY_MASK = 0xFF, GREY_STEPS = 0x1E;
const SCENE_FADE_SPEED = 4, RESULT_FADE_SPEED = 8;
const fadeRegs = c => ({ a: 0, f: 0, b: 0, c, d: 0, e: 0, h: 0, l: 0 });

// RunEndingCreditsSequence (0A:6E74): the ending (above); SELECT in debug mode skips to the result screen.
// Returns the registers it leaves (bank 1's LoadMenuFontGfx's, and the flags of its last flag clear). sp: the
// stack pointer at the call.
export function* runEndingCreditsSequence(P, sp) {
  const { bus, V } = P;
  beginFadeOut(P, SCENE_FADE_SPEED);
  yield* waitFadeEnd(P, fadeRegs(SCENE_FADE_SPEED));
  setFlag(P, FLAG_ENDING_CREDITS_RUNNING);
  playSoundManaged(P, BGM_CREDITS);
  yield* P.runRom(BANK_GAME, LoadMenuFontGfx);
  loadPalettesMasterOnly(P, EndingCreditsSequencePalette, 0, 1);
  V.storyCharacterSlot = 0;
  for (;;) {
    P.callRom(0, ClearFrameTasks);
    let hl = (EndingCutsceneLocationList + ((V.storyCharacterSlot * 2) & 0xFF)) & 0xFFFF;
    let loc = P.rom.u8(BANK, hl); hl++;
    if (loc === 0xFF) break;
    if (!loc) { loc = P.rom.u8(BANK, hl); hl++; }            // (no entry has 0: the next byte would be the location)
    V.storyModeCurrentLocation = loc;
    V.storyModeEntryPoint = P.rom.u8(BANK, hl);
    clearFlag(P, FLAG_VRAM_UPDATE_BUSY);
    clearFlag(P, FLAG_ACTORS_FROZEN);
    V.rasterScrollStartLY = 0; V.rasterScrollEndLY = 0;
    yield* runStoryLocation(P);
    if (!testFlag(P, FLAG_ENDING_CREDITS_PENDING)) {
      setFlag(P, FLAG_VRAM_UPDATE_BUSY);
      freezeAllActors(P);
      yield* P.runRom(BANK_CUTSCENE, InitGrayscalePaletteFade);
      yield* P.runRom(BANK_CUTSCENE, SetupPaletteFadeMask, { b: GREY_PALETTES, c: GREY_MASK, d: GREY_STEPS });
      yield* P.runRom(BANK_CUTSCENE, AnimatePaletteFadeToTarget);
      yield* P.runRom(BANK_CUTSCENE, PlayScrollingStoryCutscene, { a: V.storyCharacterSlot });
    }
    clearFlag(P, FLAG_ENDING_CREDITS_PENDING);
    beginFadeOut(P, SCENE_FADE_SPEED);
    yield* waitFadeEnd(P, fadeRegs(SCENE_FADE_SPEED));
    bus.w8(rWY, WY_HIDDEN);
    V.storyCharacterSlot = V.storyCharacterSlot + 1;
    if (V.debugStepMode && V.playerInputFlags & PADF_SELECT) break;
  }
  yield* P.runRom(BANK_CUTSCENE, ShowStoryResultScreen);
  beginFadeOut(P, RESULT_FADE_SPEED);
  yield* waitFadeEnd(P, fadeRegs(RESULT_FADE_SPEED));
  V.scrollX = 0; V.scrollY = 0;
  const r = yield* P.runRom(BANK_GAME, LoadMenuFontGfx, { a: 0 });
  clearFlag(P, FLAG_ENDING_CREDITS_RUNNING);
  clearFlag(P, FLAG_ACTORS_FROZEN);
  return { a: r.a, bc: r.bc, de: r.de, hl: r.hl, f: spAddFlags((sp - 6) & 0xFFFF, 4) };
}
// FreezeAllActors (0A:6F1D): every live actor paused and frozen in place; FLAG_ACTORS_FROZEN (their frames stop
// being uploaded). Returns the registers it leaves.
export function freezeAllActors(P, sp = P.cpu.sp) {
  const { bus } = P;
  P.wramBank(WRAM_ACTORS);
  let a = 0;
  for (let n = 0, de = wActors; n < NUM_ACTORS; n++, de += ACTOR_SIZE) {
    a = bus.u8((de & 0xFF00) | ((de + 1) & 0xFF));
    if (a) bus.w8(de + ACTORF_FLAGS, bus.u8(de + ACTORF_FLAGS) | 0x03);
  }
  setFlag(P, FLAG_ACTORS_FROZEN);
  const end = wActors + NUM_ACTORS * ACTOR_SIZE;
  return { a, c: 0, de: end, hl: end, f: spAddFlags((sp - 6) & 0xFFFF, 4) };
}

export const HOOKS = [
  [BANK, 0x6E74, hookGen((P, c) => runEndingCreditsSequence(P, c.sp))],
  [BANK, 0x6F1D, hook((P, c) => freezeAllActors(P, c.sp))],
];
