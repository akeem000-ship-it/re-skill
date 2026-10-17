// The training gym (bank $0E, $40FF-$4680): the arrival walks by entry (the door's frames opening and closing for the
// side doors), the exits through those doors, the gym's NPCs' lines by the story stage (their text tables), the
// repair counter's step-up (wMapSceneStage2 = its return entry), the exit tiles and the init script: the progress
// stage, the jumping-jacks actors' exercise, the actors by progress and the repair counter's four returns.
// The map tables and text tables are data.
// Port of src/story/training_0e.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/engine/rec2.mtrec (the gym: arrival, its NPCs), out/port/ss2_repair*.mtrec, ss2_gym*.mtrec
// (scripted: the side doors, the counter); tests: web/tests/port/routines_story_scripts2.mjs.
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FACE_DOWN, FACE_UP, FLAG_DOUBLES, STORYENTRY_NONE, testFlag, setText, advanceText,
  speak, askYesNo, setAnim, wait, face, lockFacing, unlockFacing, moveTarget, waitMove, moveAngle, movePlayer,
  waitPlayerMove, setSpeed, playerSpeed, copySceneRect, fadeIn, fadeOut, waitFadeEnd, sound, requestExit, actorState,
  hook, scene,
} from "./common.js";
import { computeRankingProgressIndex } from "./twins.js";
import { setupGymActorsForProgress } from "./gym_actors_0e.js";
import { runRepairCounterDialogue, repairCounterReturnA, repairCounterReturnB } from "./repair_0e.js";
import { repairCounterChangedReturnA, repairCounterChangedReturnB } from "./mario_world_0e.js";

const BANK = 0x0E;
// the gym's actors (TrainingGymActors_0e)
const ACTOR_TRAINING_GYM_WEIGHTLIFTER_A = 0x03, ACTOR_TRAINING_GYM_WEIGHTLIFTER_B = 0x04;
const ACTOR_TRAINING_GYM_SITUPS_A = 0x05, ACTOR_TRAINING_GYM_SITUPS_B = 0x06;
const ACTOR_TRAINING_GYM_JUMPING_JACKS_B_1 = 0x07, ACTOR_TRAINING_GYM_JUMPING_JACKS_A = 0x08;
const ACTOR_TRAINING_GYM_JUMPING_JACKS_B_2 = 0x09, ACTOR_TRAINING_GYM_WALK_72_04_1 = 0x0A;
const ACTOR_TRAINING_GYM_WALK_72_05 = 0x0B, ACTOR_TRAINING_GYM_WALK_72_04_2 = 0x0C;
const ANIM_EXERCISE = 0x05;
const SFX_DOOR = 0x71;
const STORYTIER_ISLAND_OPEN = 0x03;
const Text_35_210 = 0x14D2;
const PARTNER_CATCH_UP_SPEED = 7.96875, WALK_SPEED = 0.5;
const ACTOR_ANIM_FIELD = 0x18, EXERCISE_FRAMES = 0x03;
// the NPCs' text tables (text_ids: a word per stage or per tier)
const TrainingGymNpc03TextIds = 0x43BD, TrainingGymNpc04TextIds = 0x43EA, TrainingGymNpc05TextIds = 0x440B;
const TrainingGymNpc06TextIds = 0x4436, TrainingGymNpc07TextIds = 0x4467, TrainingGymNpc08TextIds = 0x44AE;
const TrainingGymNpc09TextIds = 0x44D1, TrainingGymNpc0ATextIds = 0x44F2, TrainingGymNpc0BTextIds = 0x451D;
const TrainingGymNpc0CTextIds = 0x454A;
// the side doors' frames in the scene tilemap: closed at column 61 row 12, then 61 / 58 / 55 row 10 opening
const DOOR_CLOSED = [61, 12], DOOR_FRAMES = [[61, 10], [58, 10], [55, 10]];

// TrainingGymArrival01_0e (0E:40FF): with an entry point, in doubles the partner steps 2 tiles down at full speed
// and turns back; the player walks 2 tiles up (not waited for)
export function* trainingGymArrival01(P) {
  if (P.V.storyModeEntryPoint === STORYENTRY_NONE) return;
  if (testFlag(P, FLAG_DOUBLES)) {
    setSpeed(P, ACTOR_PARTNER, PARTNER_CATCH_UP_SPEED);
    moveAngle(P, ACTOR_PARTNER, FACE_DOWN, 2.0);
    yield* waitMove(P, ACTOR_PARTNER);
    face(P, ACTOR_PARTNER, FACE_UP);
    setSpeed(P, ACTOR_PARTNER, WALK_SPEED);
  }
  setSpeed(P, ACTOR_PLAYER, WALK_SPEED);
  moveAngle(P, ACTOR_PLAYER, FACE_UP, 2.0);
}
// TrainingGymArrival02_0e / 03_0e (0E:4145 / 0E:41E2): with an entry point, through a side door (column 10 or
// 20): the door drawn open (the closed frame kept at column 61, the open one copied in), faded in, the player walks
// out (to x + 1, 14), the door closes frame by frame (the first door also waits 2 frames before the fade)
function* arrivalThroughDoor(P, col, waitBeforeFade) {
  if (P.V.storyModeEntryPoint === STORYENTRY_NONE) return;
  setSpeed(P, ACTOR_PLAYER, WALK_SPEED);
  setSpeed(P, ACTOR_PARTNER, WALK_SPEED);
  yield* waitPlayerMove(P);
  yield* copySceneRect(P, 10, 10, ...DOOR_CLOSED, 2, 2);
  yield* copySceneRect(P, ...DOOR_FRAMES[0], col, 10, 2, 2);
  if (waitBeforeFade) yield* wait(P, 2);
  fadeIn(P, 8);
  yield* waitFadeEnd(P);
  moveTarget(P, ACTOR_PLAYER, col + 1.0, 14.0);
  yield* waitMove(P, ACTOR_PLAYER);
  sound(P, SFX_DOOR);
  for (const [sc, sr] of [DOOR_FRAMES[1], DOOR_FRAMES[2], DOOR_CLOSED]) {
    yield* wait(P, 2);
    yield* copySceneRect(P, sc, sr, col, 10, 2, 2);
  }
}
export const trainingGymArrival02 = P => arrivalThroughDoor(P, 10, true);
export const trainingGymArrival03 = P => arrivalThroughDoor(P, 20, false);
// TrainingGymExit02_0e / 03_0e (0E:4290 / 0E:431B): the player backs up to the door (facing up), it opens frame by
// frame, a tile up through it and the fade out
function* exitThroughDoor(P, col) {
  face(P, ACTOR_PLAYER, FACE_UP);
  lockFacing(P, ACTOR_PLAYER);
  setSpeed(P, ACTOR_PLAYER, 0.75);
  moveTarget(P, ACTOR_PLAYER, col + 1.0, 13.0);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* waitPlayerMove(P);
  sound(P, SFX_DOOR);
  for (const [sc, sr] of [DOOR_FRAMES[2], DOOR_FRAMES[1], DOOR_FRAMES[0]]) {
    yield* copySceneRect(P, sc, sr, col, 10, 2, 2);
    yield* wait(P, 2);
  }
  moveAngle(P, ACTOR_PLAYER, FACE_UP, 1.0);
  fadeOut(P, 8);
  unlockFacing(P, ACTOR_PLAYER);
  yield* wait(P, 10);
}
export const trainingGymExit02 = P => exitThroughDoor(P, 10);
export const trainingGymExit03 = P => exitThroughDoor(P, 20);
// the NPCs: the text of the table's entry for the story stage (wMapSceneStage), or for the tier (stage >> 1)
function* npcByStage(P, actor, table, byTier) {
  let a = P.V.mapSceneStage;
  if (byTier) a = ((a >> 1) | (a & 0x80)) & 0xFF;                  // (`sra a`)
  yield* setText(P, P.rom.u16(BANK, (table + ((a * 2) & 0xFF)) & 0xFFFF));
  yield* speak(P, actor);
}
// TrainingGymNpc07_0e (0E:444A): a jumping-jacks student: his line by tier; at the Island Open a question (yes: the
// line, no: the other)
export function* trainingGymNpc07(P) {
  const tier = ((P.V.mapSceneStage >> 1) | (P.V.mapSceneStage & 0x80)) & 0xFF;
  if (tier !== STORYTIER_ISLAND_OPEN) return yield* npcByStage(P, ACTOR_TRAINING_GYM_JUMPING_JACKS_B_1, TrainingGymNpc07TextIds, true);
  yield* setText(P, Text_35_210);                                    // .speak
  if ((yield* askYesNo(P, ACTOR_TRAINING_GYM_JUMPING_JACKS_B_1)) !== 0) advanceText(P);
  yield* speak(P, ACTOR_TRAINING_GYM_JUMPING_JACKS_B_1);
}
// TrainingGymFacing01_0e / 02_0e (0E:45BE / 0E:45DA): stepping up to the repair counter (its return entry $0B /
// $0C into wMapSceneStage2): the player runs to (13, 19), then the counter's dialogue
function* stepUpToCounter(P, stage) {
  P.V.mapSceneStage2 = stage;
  playerSpeed(P, 2.0);
  yield* movePlayer(P, 13.0, 19.0);
  yield* waitPlayerMove(P);
  yield* runRepairCounterDialogue(P);
}
// TrainingGymInitScript_0e (0E:4619): the progress stage; the jumping-jacks students exercising (their animation
// field 3, ANIM_EXERCISE); the actors by progress; entries $0B-$0E: the repair counter's returns
export function* trainingGymInitScript(P) {
  computeRankingProgressIndex(P);
  for (const actor of [ACTOR_TRAINING_GYM_JUMPING_JACKS_B_1, ACTOR_TRAINING_GYM_JUMPING_JACKS_A, ACTOR_TRAINING_GYM_JUMPING_JACKS_B_2]) {
    P.bus.w8((actorState(P, actor) + ACTOR_ANIM_FIELD) & 0xFFFF, EXERCISE_FRAMES);
  }
  for (const actor of [ACTOR_TRAINING_GYM_JUMPING_JACKS_B_1, ACTOR_TRAINING_GYM_JUMPING_JACKS_A, ACTOR_TRAINING_GYM_JUMPING_JACKS_B_2]) {
    setAnim(P, actor, ANIM_EXERCISE);
  }
  setupGymActorsForProgress(P);
  const returns = { 0x0B: repairCounterReturnA, 0x0C: repairCounterReturnB, 0x0D: repairCounterChangedReturnA,
    0x0E: repairCounterChangedReturnB };
  const back = returns[P.V.storyModeEntryPoint];
  if (back) yield* back(P);
}

export const HOOKS = [
  scene(BANK, 0x40FF, trainingGymArrival01),
  scene(BANK, 0x4145, trainingGymArrival02),
  scene(BANK, 0x41E2, trainingGymArrival03),
  scene(BANK, 0x4290, trainingGymExit02),
  scene(BANK, 0x431B, trainingGymExit03),
  scene(BANK, 0x43A6, P => npcByStage(P, ACTOR_TRAINING_GYM_WEIGHTLIFTER_A, TrainingGymNpc03TextIds, false)),
  scene(BANK, 0x43D1, P => npcByStage(P, ACTOR_TRAINING_GYM_WEIGHTLIFTER_B, TrainingGymNpc04TextIds, true)),
  scene(BANK, 0x43F4, P => npcByStage(P, ACTOR_TRAINING_GYM_SITUPS_A, TrainingGymNpc05TextIds, false)),
  scene(BANK, 0x441F, P => npcByStage(P, ACTOR_TRAINING_GYM_SITUPS_B, TrainingGymNpc06TextIds, false)),
  scene(BANK, 0x444A, trainingGymNpc07),
  scene(BANK, 0x4495, P => npcByStage(P, ACTOR_TRAINING_GYM_JUMPING_JACKS_A, TrainingGymNpc08TextIds, true)),
  scene(BANK, 0x44B8, P => npcByStage(P, ACTOR_TRAINING_GYM_JUMPING_JACKS_B_2, TrainingGymNpc09TextIds, true)),
  scene(BANK, 0x44DB, P => npcByStage(P, ACTOR_TRAINING_GYM_WALK_72_04_1, TrainingGymNpc0ATextIds, false)),
  scene(BANK, 0x4506, P => npcByStage(P, ACTOR_TRAINING_GYM_WALK_72_05, TrainingGymNpc0BTextIds, false)),
  scene(BANK, 0x4531, P => npcByStage(P, ACTOR_TRAINING_GYM_WALK_72_04_2, TrainingGymNpc0CTextIds, true)),
  scene(BANK, 0x45BE, P => stepUpToCounter(P, 0x0B)),                // TrainingGymFacing01_0e
  scene(BANK, 0x45DA, P => stepUpToCounter(P, 0x0C)),                // TrainingGymFacing02_0e
  [BANK, 0x4607, hook(P => { requestExit(P, 0x02); return { a: 0x02 }; })],   // TrainingGymTile02_0e
  [BANK, 0x4610, hook(P => { requestExit(P, 0x03); return { a: 0x03 }; })],   // TrainingGymTile03_0e
  scene(BANK, 0x4619, trainingGymInitScript),
];
