// The training court's water sprite and Emily's tour (bank $15, $55F0-$5D73): the swing contest at the fountain
// (the HUD's timer and counter panels sliding in, the 3-2-1 countdown, ten seconds of A/B presses counted by a frame
// task, the panels sliding out, the count spoken), its HUD (tiles, palettes, sprite panels), the court's intro
// tour with Emily, and the serve challenger's result scene. The actor scripts, sprite templates, tiles, palettes and
// the tour's actor list are data.
// Port of src/story/water_15.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are; TogglePlayerSpriteXFlip is
// src/twins/mirror_player_sprite_if_left_handed.asm (mario_world_0e.js).
// Recordings: out/port/ss2_water_*.mtrec (scripted: the swing contest), out/port/ss2_tc_tour.mtrec (scripted: the
// intro tour), out/port/ss1_tc_sm*.mtrec (part 1's scripted serve matches' results).
import {
  ACTOR_PLAYER, ANIM_BOUNCE, ANIM_NOD, FACE_DOWN, FACE_LEFT, FACE_RIGHT, FZ, OAM_BANK1, TILE_SIZE, VRAM_BANK1,
  advanceFrame, beginCutscene, endCutscene, face, faceToward, farcall, fadeIn, fadeOut,
  jumpTableTarget, lockFacing, movePlayer, movePlayerToActor, moveTarget, playerSpeed, pushTextNumber,
  queueSpriteTemplate, registerFrameTask, requestExit, respawnActors, scene, hook, setAnim, setPosition, setText,
  sound, speak, unlockFacing, vTiles0, wait, waitFadeEnd, waitIdle, waitMove, waitPlayerMove,
} from "./common.js";
import { unregisterFrameTask as homeUnregisterFrameTask } from "../home/colorfade.js";
import { divAHLByE } from "../home/math.js";
import { printHexWord } from "../home/debugtext.js";
import { pushWord, dropWords } from "../story/common.js";
import { waitFramesCmd } from "../cutscenes/common.js";
import { initNumberSpriteGfx, drawDecimalNumberSprites } from "../menus/common/widgets.js";
import { farcallFlags } from "../menus/common/defs.js";
import { mirrorPlayerSpriteIfLeftHanded } from "./mario_world_0e.js";
import { loadGfx } from "./plane_14.js";
import { enterServeChallengerCourt } from "./training_npcs_15.js";

const BANK = 0x15, BANK_MENU_LIB = 0x39;
const ACTOR_TRAINING_COURT_TOUR_BOB = 0x0B, ACTOR_TRAINING_COURT_TOUR_EMILY = 0x0D;
const EMILY = ACTOR_TRAINING_COURT_TOUR_EMILY;
const PADF_A = 0x01, PADF_B = 0x02;
const SFX_COUNTDOWN_GO = 0x75, SFX_CONTEST_WIN = 0x8C, SFX_CONTEST_FINISH = 0x8D;
const ANIM_CONTEST_SWING = 0x09, ANIM_CONTEST_WAIT = 0x0A;     // the player's swing and its wait between swings
const CONTEST_FRAMES = 0x0258;                                  // ten seconds
const SWING_NONE = 0x00, SWING_WAIT = 0x01, SWING_SWUNG = 0x02; // wSwingContestSwingState (none: the time is up)
const DIGIT_PALETTE = 0x0A, DIGIT_TILE_BASE = 0x10;
const STORYLOC_TRAINING_COURT = 0x0F;
const Text_36_627 = 0x1A73, Text_36_676 = 0x1AA4, Text_6e_29 = 0x201D;
// data of this bank (read from the ROM)
const QueueWaterSpriteMinigameTimerPanel_SpriteTemplate = 0x57AD;
const QueueWaterSpriteMinigameCounterPanel_SpriteTemplate = 0x57BA;
const WaterSpriteHudTiles_15 = 0x57D0, WaterSpriteHudPalette_15 = 0x5890, TrainingCourtTourActors_15 = 0x5C4F;
const ServeChallengerResults = 0x5D6B;                          // ServeChallengerResultScene's jump table
// routines of this bank (frame tasks, by their addresses)
const WaterSpriteSwingCountTask = 0x55F0, DrawWaterSpriteMinigameCounters = 0x578D;
const QueueWaterSpriteMinigameHudPanels = 0x58D1;

// `call` of a JS routine at the ROM's stack depth: its return address pushed while it runs
function nearCall(P, ret, fn) {
  pushWord(P, ret);
  try { return fn(); } finally { dropWords(P, 1); }
}
// farcall DrawDecimalNumberSprites_39 (39:6F10): the number at (d, e); registers kept
const drawNumber = (P, n, d, e) => farcall(P, BANK_MENU_LIB, () => drawDecimalNumberSprites(P, n & 0xFFFF, d & 0xFF, e));

// WaterSpriteSwingCountTask (15:55F0), a frame task: an A or B press after none counts a swing (the count printed
// at (15, 4) too, a debug print), the swing state toggled between swung and waiting; the timer counted down, at
// 1 the task unregistered and the state none
export function waterSpriteSwingCountTask(P) {
  const { V } = P;
  const pressed = V.inputRisingEdge & (PADF_A | PADF_B), prev = V.swingContestPrevInput;
  V.swingContestPrevInput = pressed;
  if (!prev && pressed) {
    const swings = (V.swingContestSwings + 1) & 0xFFFF;
    V.swingContestSwings = swings;
    nearCall(P, 0x5618, () => printHexWord(P, 0x0F, 0x04, swings));
    V.swingContestSwingState = V.swingContestSwingState === SWING_SWUNG ? SWING_WAIT : SWING_SWUNG;
  }
  const de = (V.swingContestTimer - 1) & 0xFFFF;              // .tick
  if (de) {
    V.swingContestTimer = de;
    return { a: de & 0xFF, de, hl: P.A.swingContestTimer + 1, f: 0 };
  }
  const r = homeUnregisterFrameTask(P, WaterSpriteSwingCountTask, (P.cpu.sp - 2) & 0xFFFF);   // .finish
  V.swingContestSwingState = SWING_NONE;
  return { ...r, a: 0, f: FZ };
}

// WaterSpriteSwingContestScene (15:564A): the wide digits (palette $0A, tiles from $10 of VRAM bank 1), the HUD;
// the player faces down; the timer panel (showing 10) and the counter (0) slide in over 32 frames; the timer set,
// the count cleared, the counters' task; the countdown 3-2-1 (60 frames each); go: the player turned to swing
// (left-handed: mirrored), the swing counter; each frame the player's animation follows the swing state until the
// time is up; then the bounce, the panels slide out over 48 frames (the timer at 0, the count), the HUD's task
// ends; the count spoken
export function* waterSpriteSwingContestScene(P) {
  const { V } = P;
  farcall(P, BANK_MENU_LIB, () => initNumberSpriteGfx(P, DIGIT_PALETTE, 1, vTiles0 + 0x10 * TILE_SIZE + VRAM_BANK1));
  V.digitSpriteAttr = DIGIT_PALETTE;
  V.digitSpriteTileBase = DIGIT_TILE_BASE;
  nearCall(P, 0x5661, () => initWaterSpriteMinigameHud(P));
  face(P, ACTOR_PLAYER, FACE_DOWN);
  for (let b = 0x20; b > 0; b--) {                             // .contest
    drawNumber(P, 10, 0x20 - b, 0x10);
    V.swingContestHudMode = (0x18 - b) & 0xFF;
    drawNumber(P, 0, 0x80 + b, 0x10);
    V.swingContestHudPage = (0x74 + b) & 0xFF;
    yield* wait(P, 1);
  }
  V.swingContestTimer = CONTEST_FRAMES;
  V.swingContestSwings = 0;
  V.swingContestPrevInput = 0;
  V.swingContestSwingState = SWING_NONE;
  V.swingContestSwingState = SWING_WAIT;
  registerFrameTask(P, 0x01, DrawWaterSpriteMinigameCounters);
  yield* wait(P, 50);
  for (let l = 3; l > 0; l--) {                                // .win
    sound(P, SFX_CONTEST_WIN);
    for (let b = 0x3C; b > 0; b--) {                           // .lose
      drawNumber(P, l, 0x50, 0x2C);
      yield* wait(P, 1);
    }
  }
  sound(P, SFX_COUNTDOWN_GO);
  mirrorPlayerSpriteIfLeftHanded(P);
  registerFrameTask(P, 0x01, WaterSpriteSwingCountTask);
  for (;;) {                                                   // .reward
    yield* advanceFrame(P);
    const state = V.swingContestSwingState;
    if (state === SWING_NONE) break;
    setAnim(P, ACTOR_PLAYER, state === SWING_WAIT ? ANIM_CONTEST_WAIT : ANIM_CONTEST_SWING);
  }
  sound(P, SFX_CONTEST_FINISH);                                // .finish
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 60);
  mirrorPlayerSpriteIfLeftHanded(P);
  unregisterFrameTask(P, DrawWaterSpriteMinigameCounters);
  for (let b = 0x30; b > 0; b--) {                             // .done
    drawNumber(P, 0, b - 0x10, 0x10);
    V.swingContestHudMode = (0xE8 + b) & 0xFF;
    drawNumber(P, V.swingContestSwings, 0xB0 - b, 0x10);
    V.swingContestHudPage = (0xA4 - b) & 0xFF;
    yield* wait(P, 1);
  }
  unregisterFrameTask(P, QueueWaterSpriteMinigameHudPanels);
  yield* waitFramesCmd(P, 60, 0x5762);
  yield* setText(P, Text_36_676);
  pushTextNumber(P, V.swingContestSwings);
  yield* speak(P, ACTOR_PLAYER);
}
// (UnregisterFrameTask of the scene's own frame tasks)
const unregisterFrameTask = (P, routine) => homeUnregisterFrameTask(P, routine, (P.cpu.sp - 2) & 0xFFFF);

// DrawWaterSpriteMinigameCounters (15:578D), a frame task: the seconds left (the timer / 60) at ($20, $10), the
// count at ($80, $10)
export function drawWaterSpriteMinigameCounters(P) {
  const q = divAHLByE(P, 0x00, P.V.swingContestTimer, 0x3C);
  drawNumber(P, q.hl, 0x20, 0x10);
  const swings = P.V.swingContestSwings;
  drawNumber(P, swings, 0x80, 0x10);
  return { a: swings & 0xFF, f: farcallFlags(P.cpu.sp), hl: swings, de: 0x8010 };   // (F: the farcall callee's, kept)
}
// LoadWaterSpriteMinigameHudGfx (15:5898): (WRAM 1) the HUD's tiles to VRAM bank 1's $8000, object palettes 0-1
export const loadWaterSpriteMinigameHudGfx = (P, f) => loadGfx(P, f, WaterSpriteHudTiles_15, vTiles0 + VRAM_BANK1,
  (WaterSpriteHudPalette_15 - WaterSpriteHudTiles_15) / 16, WaterSpriteHudPalette_15, 0, 2);
// QueueWaterSpriteMinigameTimerPanel (15:58BB) / QueueWaterSpriteMinigameCounterPanel (15:58C6): the panel's
// sprites at (d, e), VRAM bank 1 (tiles from 0 / 6)
export function queueWaterSpriteMinigameTimerPanel(P, d, e) {
  const t = QueueWaterSpriteMinigameTimerPanel_SpriteTemplate;
  return { hl: t, b: OAM_BANK1, c: 0x00, ...queueSpriteTemplate(P, t, d, e, 0x00, OAM_BANK1) };
}
export function queueWaterSpriteMinigameCounterPanel(P, d, e) {
  const t = QueueWaterSpriteMinigameCounterPanel_SpriteTemplate;
  return { hl: t, b: OAM_BANK1, c: 0x06, ...queueSpriteTemplate(P, t, d, e, 0x06, OAM_BANK1) };
}
// QueueWaterSpriteMinigameHudPanels (15:58D1), a frame task: the timer panel at x wSwingContestHudMode, the counter
// panel at x wSwingContestHudPage, both at y $18
export function queueWaterSpriteMinigameHudPanels(P) {
  nearCall(P, 0x58DA, () => queueWaterSpriteMinigameTimerPanel(P, P.V.swingContestHudMode, 0x18));
  const x = P.V.swingContestHudPage;
  return { a: x, d: x, e: 0x18, ...nearCall(P, 0x58E3, () => queueWaterSpriteMinigameCounterPanel(P, x, 0x18)) };
}
// InitWaterSpriteMinigameHud (15:58E4): the HUD's graphics, the panels off screen (x $E8 and $A0), their task
export function initWaterSpriteMinigameHud(P, f = P.cpu.f) {
  nearCall(P, 0x58E7, () => loadWaterSpriteMinigameHudGfx(P, f));
  P.V.swingContestHudMode = 0xE8;
  P.V.swingContestHudPage = 0xA0;
  return nearCall(P, 0x58F9, () => registerFrameTask(P, 0x01, QueueWaterSpriteMinigameHudPanels));
}

// TrainingCourtIntroTourScene (15:59C0): (entry $0F) no location name; the tour's actors, a cutscene: Emily and
// the player walk in from the left, Emily looks around and shows the courts (the player walks to the net court
// and back, then to Bob), more words, nods and a bounce; the two walk back out to the left; a slow fade out, back
// to the training court's entry $0F
export function* trainingCourtIntroTourScene(P) {
  P.V.storyModeShowLocationName = 0;
  respawnActors(P, TrainingCourtTourActors_15);
  beginCutscene(P);
  setPosition(P, ACTOR_PLAYER, 63.0, 63.0);
  setPosition(P, EMILY, 63.0, 63.0);
  setPosition(P, EMILY, 7.0, 54.75);
  moveTarget(P, EMILY, 31.0, 54.75);
  yield* wait(P, 10);
  setPosition(P, ACTOR_PLAYER, 5.0, 55.0);
  moveTarget(P, ACTOR_PLAYER, 31.0, 55.0);
  yield* movePlayer(P, 31.0, 55.0);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  yield* waitMove(P, EMILY);
  moveTarget(P, EMILY, 31.0, 43.0);
  yield* waitMove(P, ACTOR_PLAYER);
  moveTarget(P, ACTOR_PLAYER, 31.0, 45.0);
  yield* waitPlayerMove(P);
  yield* movePlayer(P, 31.0, 45.0);
  yield* waitPlayerMove(P);
  for (const dir of [FACE_RIGHT, FACE_LEFT, FACE_DOWN, FACE_RIGHT]) {
    yield* wait(P, 60);
    face(P, EMILY, dir);
  }
  playerSpeed(P, 2.0);
  yield* setText(P, Text_36_627);
  yield* speak(P, EMILY);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  yield* movePlayer(P, 45.0, 41.0);
  yield* waitPlayerMove(P);
  yield* speak(P, EMILY);
  yield* wait(P, 60);
  faceToward(P, ACTOR_PLAYER, EMILY);
  yield* movePlayer(P, 31.0, 45.0);
  yield* waitPlayerMove(P);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  face(P, EMILY, FACE_LEFT);
  yield* wait(P, 40);
  face(P, ACTOR_PLAYER, FACE_LEFT);
  yield* speak(P, EMILY);
  yield* movePlayerToActor(P, ACTOR_TRAINING_COURT_TOUR_BOB);
  yield* waitPlayerMove(P);
  yield* wait(P, 60);
  faceToward(P, ACTOR_PLAYER, EMILY);
  yield* movePlayerToActor(P, EMILY);
  yield* waitPlayerMove(P);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* speak(P, EMILY);
  faceToward(P, EMILY, ACTOR_PLAYER);
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* speak(P, EMILY);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  setAnim(P, EMILY, ANIM_NOD);
  yield* waitIdle(P, EMILY);
  yield* speak(P, EMILY);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  playerSpeed(P, 1.0);
  face(P, ACTOR_PLAYER, FACE_LEFT);
  moveTarget(P, EMILY, 30.0, 43.0);
  yield* waitMove(P, EMILY);
  lockFacing(P, ACTOR_PLAYER);
  moveTarget(P, ACTOR_PLAYER, 32.0, 45.0);
  moveTarget(P, EMILY, 30.0, 47.0);
  yield* waitMove(P, EMILY);
  moveTarget(P, ACTOR_PLAYER, 31.0, 45.0);
  yield* waitMove(P, ACTOR_PLAYER);
  unlockFacing(P, ACTOR_PLAYER);
  moveTarget(P, EMILY, 31.0, 47.0);
  yield* waitMove(P, EMILY);
  moveTarget(P, ACTOR_PLAYER, 31.0, 55.0);
  yield* movePlayer(P, 31.0, 55.0);
  moveTarget(P, EMILY, 31.0, 55.0);
  yield* waitMove(P, EMILY);
  moveTarget(P, EMILY, 3.0, 55.0);
  yield* movePlayer(P, 9.0, 55.0);
  yield* waitMove(P, ACTOR_PLAYER);
  moveTarget(P, ACTOR_PLAYER, 3.0, 55.0);
  yield* wait(P, 90);
  fadeOut(P, 8);
  yield* wait(P, 20);
  requestExit(P, STORYLOC_TRAINING_COURT);
  endCutscene(P);
}

// ServeChallengerResultScene (15:5CF3): the party by the serve challenger, faded in; then by wPointWinLoseFlag + 1
// (rst $00) the finish, the loss (its text id kept in wUnusedChallengerLoseTextId), the draw or the jump for joy
export function* serveChallengerResultScene(P) {
  yield* enterServeChallengerCourt(P);
  const index = (P.V.pointWinLoseFlag + 1) & 0xFF;
  if (index === 0x01) P.V.unusedChallengerLoseTextId = Text_6e_29;
  yield* P.runRom(BANK, jumpTableTarget(P, BANK, ServeChallengerResults, index));
}

export const HOOKS = [
  [BANK, 0x55F0, hook(P => waterSpriteSwingCountTask(P))],
  scene(BANK, 0x564A, waterSpriteSwingContestScene),
  [BANK, 0x5777, hook(P => mirrorPlayerSpriteIfLeftHanded(P))],      // TogglePlayerSpriteXFlip
  [BANK, 0x578D, hook(P => drawWaterSpriteMinigameCounters(P))],
  [BANK, 0x5898, hook((P, c) => loadWaterSpriteMinigameHudGfx(P, c.f))],
  [BANK, 0x58BB, hook((P, c) => queueWaterSpriteMinigameTimerPanel(P, c.d, c.e))],
  [BANK, 0x58C6, hook((P, c) => queueWaterSpriteMinigameCounterPanel(P, c.d, c.e))],
  [BANK, 0x58D1, hook(P => queueWaterSpriteMinigameHudPanels(P))],
  [BANK, 0x58E4, hook((P, c) => initWaterSpriteMinigameHud(P, c.f))],
  scene(BANK, 0x59C0, trainingCourtIntroTourScene),
  scene(BANK, 0x5CF3, serveChallengerResultScene),
];
