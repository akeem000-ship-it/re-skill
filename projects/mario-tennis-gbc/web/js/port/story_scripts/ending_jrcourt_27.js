// The ending's training-ground scenes (bank $27, $617F-$6C1C): End7 at the training center (the machine room
// with its cleared levels' lights, entry 1; the gym, entry 2), End5 the service-ace court (a student's surprise),
// End4 the junior court (Pam and the coach in singles, Brian and Fay in doubles, the party walking out). The
// location tables, actor lists and actor scripts are data.
// Port of src/story/ending_jrcourt_27.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/cs_credits.mtrec, cs_epilogue.mtrec (the ending), out/port/ss1_end*.mtrec (scripted).
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FACE_DOWN, FACE_LEFT, FACE_RIGHT, FACE_UP, ANIM_NOD, ANIM_BOUNCE, ANIM_WALK,
  FLAG_DOUBLES, testFlag, setAnim, gesture, face, faceToward, setPosition, moveTarget, moveAngle, waitMove, setSpeed,
  playerSpeed, movePlayer, movePlayerToActor, waitPlayerMove, nullScript, setActorScript, waitActorScript, wait,
  copySceneRect, copySceneToVram, fadeIn, sound, disableLCDSafely, enableLCD, respawnActors, beginCutscene,
  endCutscene, requestExit, hookGen, scene,
} from "./common.js";

const BANK = 0x27;
const ACTOR_END7_TRAINING_CTR_WALK_72_07 = 0x05, ACTOR_END7_TRAINING_CTR_WALK_72_02_2 = 0x07;
const ACTOR_END5_SERVICE_ACE_BALLOON_EXCLAIM = 0x07, ACTOR_END5_SERVICE_ACE_WALK_72_03_2 = 0x12;
const ACTOR_END4_JR_COURT_ALT_WALK_72_00 = 0x03, ACTOR_END4_JR_COURT_ALT_PAM = 0x07;
const ACTOR_END4_JR_COURT_ALT_BRIAN = 0x08, ACTOR_END4_JR_COURT_ALT_FAY = 0x09;
const ACTOR_END4_JR_COURT_ALT_RACKET_STUDENT_3 = 0x0E, ACTOR_END4_JR_COURT_ALT_RACKET_STUDENT_4 = 0x0F;
const FLAG_CLEARED_MACHINE_LEVEL_1 = 0xD2, FLAG_CLEARED_MACHINE_LEVEL_2 = 0xD3;
const FLAG_CLEARED_MACHINE_LEVEL_3 = 0xD4, FLAG_CLEARED_MACHINE_LEVEL_4 = 0xD5;
const SFX_CHIME = 0x97;
const ActorScript_27_13 = 0x6424, ActorScript_27_14 = 0x6811, ActorScript_27_15 = 0x6820;
const ActorScript_27_17 = 0x6918, ActorScript_27_18 = 0x692F, ActorScript_27_19 = 0x6940;
const ActorScript_27_24 = 0x6BF0, ActorScript_27_25 = 0x6C04;
const End4JrCourtActorsAlt_27 = 0x671A;

// ---- End7: the training center ----
// End7TrainingCtrInitScript_27 (27:6202): by the entry point
export function* end7TrainingCtrInitScript(P) {
  const entry = P.V.storyModeEntryPoint;
  if (entry === 0x01) return yield* end7TrainingCtrEntry01Scene(P);
  if (entry === 0x02) return yield* end7TrainingCtrEntry02Scene(P);
}
// ComputeMachineCourtProgress_27 (27:620F): the light of each cleared machine level copied onto the scene (in
// order, up to the first not cleared); wMapSceneStage = the levels cleared. Returns a = that count.
export function* computeMachineCourtProgress(P) {
  const levels = [[FLAG_CLEARED_MACHINE_LEVEL_1, 44], [FLAG_CLEARED_MACHINE_LEVEL_2, 48],
    [FLAG_CLEARED_MACHINE_LEVEL_3, 52], [FLAG_CLEARED_MACHINE_LEVEL_4, 56]];
  let cleared = 0;
  for (const [flag, row] of levels) {
    if (!testFlag(P, flag)) break;
    yield* copySceneRect(P, 30, row, 48, row, 2, 2);
    cleared++;
  }
  P.V.mapSceneStage = cleared;                          // (.store)
  return cleared === levels.length ? { a: cleared, b: cleared } : { a: cleared };   // (ld b, a after the fourth)
}
// End7TrainingCtrEntry01Scene (27:6270): the machine room's view (its scroll bounds), the levels' lights; the
// party walks in, the attendant nods and steps aside, the player walks around to the machine court; exit 1
export function* end7TrainingCtrEntry01Scene(P) {
  const { V } = P, ATTENDANT = ACTOR_END7_TRAINING_CTR_WALK_72_07;
  V.mapScrollMinX = 0x26;
  V.mapScrollMinY = 0x23;
  V.mapWidthTiles = 0x40;
  V.mapHeightTiles = 0x3C;
  disableLCDSafely(P);
  copySceneToVram(P, 0x00);
  enableLCD(P);
  yield* computeMachineCourtProgress(P);
  yield* waitPlayerMove(P);
  setPosition(P, ACTOR_PLAYER, 41.0, 55.0);
  setPosition(P, ACTOR_PARTNER, 41.0, 55.0);
  fadeIn(P, 4);
  yield* movePlayer(P, 41.0, 43.0);
  yield* walk(P, [[41.0, 43.0], [43.0, 43.0]]);
  face(P, ACTOR_PARTNER, FACE_RIGHT);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  yield* wait(P, 30);
  yield* gesture(P, ATTENDANT, ANIM_NOD);
  moveTarget(P, ATTENDANT, 45.0, 41.0);
  yield* waitMove(P, ATTENDANT);
  face(P, ATTENDANT, FACE_DOWN);
  nullScript(P, ACTOR_PARTNER);
  setSpeed(P, ACTOR_PLAYER, 1.0);
  yield* movePlayer(P, 56.0, 51.0);
  yield* walk(P, [[51.0, 43.0], [51.0, 51.0], [56.0, 53.0]]);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* wait(P, 10);
  requestExit(P, 0x01);
}
// the player's actor through points, each waited for
function* walk(P, points) {
  for (const [x, y] of points) {
    moveTarget(P, ACTOR_PLAYER, x, y);
    yield* waitMove(P, ACTOR_PLAYER);
  }
}
// End7TrainingCtrEntry02Scene (27:6370): the gym: the player walks up to a student, bounces, she nods; the player
// on its exercise script for 120 frames; exit 1
export function* end7TrainingCtrEntry02Scene(P) {
  const STUDENT = ACTOR_END7_TRAINING_CTR_WALK_72_02_2;
  setPosition(P, ACTOR_PARTNER, 22.0, 26.0);
  setSpeed(P, ACTOR_PARTNER, 0.5);
  setSpeed(P, ACTOR_PLAYER, 0.5);
  playerSpeed(P, 0.75);
  fadeIn(P, 4);
  moveAngle(P, ACTOR_PLAYER, FACE_UP, 4.0);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* movePlayer(P, 15.0, 19.0);
  yield* walk(P, [[17.0, 19.0]]);
  faceToward(P, ACTOR_PLAYER, STUDENT);
  yield* wait(P, 20);
  yield* gesture(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* gesture(P, STUDENT, ANIM_NOD);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  setActorScript(P, ACTOR_PLAYER, ActorScript_27_13);
  yield* wait(P, 120);
  nullScript(P, ACTOR_PLAYER);
  setAnim(P, ACTOR_PLAYER, ANIM_WALK);
  setSpeed(P, ACTOR_PLAYER, 1.0);
  faceToward(P, STUDENT, ACTOR_PLAYER);
  requestExit(P, 0x01);
}

// ---- End5: the service-ace court ----
// End5ServiceAceCutscene_27 (27:656F): the player's walk round the court to a student, who turns and starts with
// a balloon; exit 1
export function* end5ServiceAceCutscene(P) {
  const STUDENT = ACTOR_END5_SERVICE_ACE_WALK_72_03_2;
  beginCutscene(P);
  playerSpeed(P, 0.5);
  yield* movePlayer(P, 15.0, 17.0);
  fadeIn(P, 8);
  setSpeed(P, ACTOR_PLAYER, 0.75);
  yield* walk(P, [[13.0, 23.0], [15.0, 23.0], [15.0, 17.0]]);
  playerSpeed(P, 0.75);
  yield* movePlayer(P, 25.0, 17.0);
  yield* walk(P, [[25.0, 17.0]]);
  yield* wait(P, 20);
  face(P, STUDENT, FACE_LEFT);
  yield* wait(P, 40);
  sound(P, SFX_CHIME);
  setPosition(P, ACTOR_END5_SERVICE_ACE_BALLOON_EXCLAIM, 28.0, 17.0);
  setAnim(P, STUDENT, ANIM_BOUNCE);
  yield* wait(P, 60);
  requestExit(P, 0x01);
  endCutscene(P);
}
// End5ServiceAceInitScript_27 (27:661E)
export const end5ServiceAceInitScript = P => end5ServiceAceCutscene(P);

// ---- End4: the junior court ----
const COACH = ACTOR_END4_JR_COURT_ALT_WALK_72_00, PAM = ACTOR_END4_JR_COURT_ALT_PAM;
const BRIAN = ACTOR_END4_JR_COURT_ALT_BRIAN, FAY = ACTOR_END4_JR_COURT_ALT_FAY;
// End4JrCourtInitScript_27 (27:67F8): the doubles court's actors (and the cutscene mode); entry 1 plays the scene
export function* end4JrCourtInitScript(P) {
  if (testFlag(P, FLAG_DOUBLES)) {
    respawnActors(P, End4JrCourtActorsAlt_27);
    beginCutscene(P);
  }
  if (P.V.storyModeEntryPoint === 0x01) yield* end4JrCourtWalkPlayer(P);   // (.checkStoryModeEntryPoint)
}
// End4JrCourtApproachSingles_27 (27:6866): Pam looks from the coach to the player, who walks up; she nods, walks
// round on her script; the two face each other, her bounce and nod
export function* end4JrCourtApproachSingles(P) {
  yield* wait(P, 15);
  faceToward(P, PAM, COACH);
  yield* wait(P, 10);
  faceToward(P, PAM, ACTOR_PLAYER);
  yield* wait(P, 30);
  playerSpeed(P, 1.0);
  yield* movePlayerToActor(P, PAM);
  yield* waitPlayerMove(P);
  faceToward(P, COACH, PAM);
  yield* gesture(P, PAM, ANIM_NOD);
  face(P, PAM, FACE_DOWN);
  yield* wait(P, 10);
  setActorScript(P, PAM, ActorScript_27_17);
  yield* wait(P, 20);
  yield* movePlayerToActor(P, ACTOR_PLAYER);
  face(P, COACH, FACE_DOWN);
  yield* movePlayerToActor(P, ACTOR_PLAYER);
  yield* waitActorScript(P, PAM);
  faceToward(P, ACTOR_PLAYER, PAM);
  yield* gesture(P, PAM, ANIM_BOUNCE);
  yield* gesture(P, PAM, ANIM_NOD);
  yield* wait(P, 15);
  face(P, PAM, FACE_UP);
}
// the coach's bounce, then everyone turns right to the court
function* coachCheers(P) {
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* wait(P, 15);
  yield* gesture(P, COACH, ANIM_BOUNCE);
  face(P, COACH, FACE_RIGHT);
  yield* wait(P, 15);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  face(P, PAM, FACE_RIGHT);
  yield* wait(P, 30);
}
// End4JrCourtSceneSingles_27 (27:6951): Pam's approach, the coach's cheer; two students rally (their scripts), the
// player and Pam walk out; exit 1
export function* end4JrCourtSceneSingles(P) {
  beginCutscene(P);
  face(P, COACH, FACE_DOWN);
  yield* end4JrCourtApproachSingles(P);
  yield* coachCheers(P);
  setActorScript(P, ACTOR_END4_JR_COURT_ALT_RACKET_STUDENT_3, ActorScript_27_14);
  setActorScript(P, ACTOR_END4_JR_COURT_ALT_RACKET_STUDENT_4, ActorScript_27_15);
  yield* waitActorScript(P, ACTOR_END4_JR_COURT_ALT_RACKET_STUDENT_4);
  yield* movePlayer(P, 23.0, 17.0);
  setActorScript(P, PAM, ActorScript_27_18);
  setActorScript(P, ACTOR_PLAYER, ActorScript_27_19);
  yield* waitPlayerMove(P);
  yield* waitActorScript(P, PAM);
  yield* wait(P, 20);
  requestExit(P, 0x01);
}
// End4JrCourtSceneSingles_27.loop (27:69EE): the doubles scene: the coach and the player face each other; Brian
// and Fay's approach, the coach's cheer, the departure; exit 1 (over the departure's exit $0F)
export function* end4JrCourtSceneDoubles(P) {
  beginCutscene(P);
  faceToward(P, COACH, ACTOR_PLAYER);
  yield* wait(P, 30);
  faceToward(P, ACTOR_PLAYER, COACH);
  yield* end4JrCourtApproachDoubles(P);
  yield* coachCheers(P);
  yield* end4JrCourtDepartureDoubles(P);
  requestExit(P, 0x01);
}
// End4JrCourtSceneSingles_27.walkPlayer (27:6A54): the player walks in with the fade; the scene of the format
export function* end4JrCourtWalkPlayer(P) {
  yield* movePlayer(P, 19.0, 21.0);
  fadeIn(P, 4);
  yield* walk(P, [[19.0, 21.0]]);
  if (testFlag(P, FLAG_DOUBLES)) return yield* end4JrCourtSceneDoubles(P);
  yield* end4JrCourtSceneSingles(P);
}
// End4JrCourtApproachDoubles_27 (27:6A7D): the party walks up to Brian, who bounces and steps over with Fay; her
// nod; all face up
export function* end4JrCourtApproachDoubles(P) {
  playerSpeed(P, 1.0);
  face(P, COACH, FACE_RIGHT);
  yield* movePlayerToActor(P, BRIAN);
  yield* waitPlayerMove(P);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  face(P, ACTOR_PARTNER, FACE_RIGHT);
  nullScript(P, BRIAN);
  face(P, BRIAN, FACE_LEFT);
  yield* gesture(P, BRIAN, ANIM_BOUNCE);
  yield* movePlayerToActor(P, ACTOR_PLAYER);
  moveTarget(P, BRIAN, 21.0, 21.0);
  moveTarget(P, FAY, 21.0, 23.0);
  yield* waitMove(P, FAY);
  face(P, FAY, FACE_LEFT);
  face(P, COACH, FACE_DOWN);
  yield* gesture(P, BRIAN, ANIM_BOUNCE);
  setAnim(P, FAY, ANIM_NOD);
  yield* wait(P, 15);
  for (const actor of [ACTOR_PLAYER, ACTOR_PARTNER, BRIAN, FAY]) face(P, actor, FACE_UP);
}
// End4JrCourtDepartureDoubles_27 (27:6B21): Brian and Fay off on their scripts, the pair to the court's edge;
// exit $0F
export function* end4JrCourtDepartureDoubles(P) {
  face(P, COACH, FACE_RIGHT);
  yield* wait(P, 30);
  nullScript(P, ACTOR_PARTNER);
  yield* movePlayer(P, 25.0, 17.0);
  setActorScript(P, BRIAN, ActorScript_27_24);
  setActorScript(P, FAY, ActorScript_27_25);
  moveTarget(P, ACTOR_PLAYER, 27.0, 25.0);
  yield* wait(P, 10);
  moveTarget(P, ACTOR_PARTNER, 25.0, 21.0);
  yield* waitMove(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, ACTOR_PARTNER, FACE_UP);
  yield* wait(P, 60);
  requestExit(P, 0x0F);
}

export const HOOKS = [
  scene(BANK, 0x6202, end7TrainingCtrInitScript),
  [BANK, 0x620F, hookGen(P => computeMachineCourtProgress(P))],
  scene(BANK, 0x6270, end7TrainingCtrEntry01Scene),
  scene(BANK, 0x6370, end7TrainingCtrEntry02Scene),
  scene(BANK, 0x656F, end5ServiceAceCutscene),
  scene(BANK, 0x661E, end5ServiceAceInitScript),
  scene(BANK, 0x67F8, end4JrCourtInitScript),
  scene(BANK, 0x6866, end4JrCourtApproachSingles),
  scene(BANK, 0x6951, end4JrCourtSceneSingles),
  scene(BANK, 0x69EE, end4JrCourtSceneDoubles),                       // End4JrCourtSceneSingles_27.loop
  scene(BANK, 0x6A54, end4JrCourtWalkPlayer),                         // End4JrCourtSceneSingles_27.walkPlayer
  scene(BANK, 0x6A7D, end4JrCourtApproachDoubles),
  scene(BANK, 0x6B21, end4JrCourtDepartureDoubles),
];
