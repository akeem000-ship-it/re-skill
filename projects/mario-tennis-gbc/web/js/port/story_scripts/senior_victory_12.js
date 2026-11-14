// The senior court's victory scenes (bank $12, $7071-$782C): the Island Open doubles pair's send-off, the
// singles ranks' victories (the beaten opponent's line, Emily's jump), the shared senior-champion scene (Fay's
// line, Emily's talk, back to the court at entry 1), the court's stage by the titles won, and the fade-ins near
// the rally pairs. The actor scripts are data.
// Port of src/story/senior_victory_12.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss2_senior*.mtrec (scripted: each rank's victory, singles and doubles).
import {
  ACTOR_PARTNER, ACTOR_PLAYER, ANIM_BOUNCE, ANIM_NOD, ANIM_SHAKE, ANIM_WALK, FACE_DOWN, FACE_LEFT, FACE_RIGHT,
  FACE_UP, FLAG_DOUBLES, endCutscene, face, facePair, fadeIn, fadeOutAndWait, goToLocation, hook, jumpVelocity,
  movePlayer, moveTarget, nullScript, playerSpeed, scene, setActorScript, setAnim, setFlag, setPosition, setSpeed,
  setText, sound, speak, testFlag, testFlagF, wait, waitFadeEnd, waitIdle, waitJump, waitMove, waitPlayerMove,
} from "./common.js";
import { startSeniorCourtPairARally, startSeniorCourtPairBRally, placeSeniorCourtPairA, placeSeniorCourtPairB } from "./senior_intros_12.js";

const BANK = 0x12;
const ACTOR_ROLE_SENIOR_COURT_FAY = 0x04;
const ACTOR_SENIOR_COURT_A_ALLIE = 0x05;
const ACTOR_SENIOR_COURT_A_BALLOON_SWEAT = 0x11;
const ACTOR_SENIOR_COURT_A_BETH = 0x08;
const ACTOR_SENIOR_COURT_A_BRIAN = 0x07;
const ACTOR_SENIOR_COURT_A_EMILY = 0x03;
const ACTOR_SENIOR_COURT_A_JOY = 0x06;
const ACTOR_SENIOR_COURT_B_CURT = 0x09;
const ACTOR_SENIOR_COURT_B_FAY = 0x04;
const ActorScript_12_03 = 0x6C3A;
const ActorScript_12_07 = 0x6C84;
const ActorScript_12_10 = 0x6CC3;
const FLAG_REACHED_ISLAND_OPEN_DOUBLES = 0xAF;
const FLAG_REACHED_ISLAND_OPEN_SINGLES = 0xAE;
const FLAG_STORY_COMPLETE_DOUBLES = 0xB1;
const FLAG_STORY_COMPLETE_SINGLES = 0xB0;
const FLAG_WON_JUNIOR_DOUBLES_RANK_1 = 0x42;
const FLAG_WON_JUNIOR_SINGLES_RANK_1 = 0x53;
const FLAG_WON_SENIOR_DOUBLES_RANK_1 = 0x46;
const FLAG_WON_SENIOR_DOUBLES_RANK_2 = 0x45;
const FLAG_WON_SENIOR_DOUBLES_RANK_3 = 0x44;
const FLAG_WON_SENIOR_SINGLES_RANK_1 = 0x57;
const FLAG_WON_SENIOR_SINGLES_RANK_2 = 0x56;
const FLAG_WON_SENIOR_SINGLES_RANK_3 = 0x55;
const FLAG_WON_SENIOR_SINGLES_RANK_4 = 0x54;
const SFX_APPEAR2 = 0x96;
const STORYLOC_SENIOR_CLASS_COURT = 0x10;
const Text_34_130 = 0x1082;
const Text_34_135 = 0x1087;
const Text_34_32 = 0x1020;
const Text_34_35 = 0x1023;
const Text_34_74 = 0x104A;
const Text_34_76 = 0x104C;
const Text_34_77 = 0x104D;
const Text_34_78 = 0x104E;

// IslandOpenDoublesVictory (12:7071): the doubles pair at the Island Open stage: Fay and Allie's lines, Emily's
// talk (the pair answers), back to the court at entry 1
export function* islandOpenDoublesVictory(P) {
  setPosition(P, ACTOR_SENIOR_COURT_B_CURT, 27.0, 11.0);
  setPosition(P, ACTOR_SENIOR_COURT_A_BETH, 27.0, 13.0);
  face(P, ACTOR_SENIOR_COURT_B_CURT, FACE_LEFT);
  face(P, ACTOR_SENIOR_COURT_A_BETH, FACE_LEFT);
  nullScript(P, ACTOR_SENIOR_COURT_A_BETH);
  setAnim(P, ACTOR_SENIOR_COURT_A_BETH, ANIM_WALK);
  nullScript(P, ACTOR_PARTNER);
  setPosition(P, ACTOR_SENIOR_COURT_A_EMILY, 43.0, 39.0);
  setPosition(P, ACTOR_SENIOR_COURT_B_FAY, 37.0, 15.0);
  face(P, ACTOR_SENIOR_COURT_B_FAY, FACE_DOWN);
  nullScript(P, ACTOR_SENIOR_COURT_B_FAY);
  setAnim(P, ACTOR_SENIOR_COURT_B_FAY, ANIM_WALK);
  setPosition(P, ACTOR_SENIOR_COURT_A_ALLIE, 35.0, 19.0);
  face(P, ACTOR_SENIOR_COURT_A_ALLIE, FACE_DOWN);
  nullScript(P, ACTOR_SENIOR_COURT_A_ALLIE);
  setAnim(P, ACTOR_SENIOR_COURT_A_ALLIE, ANIM_WALK);
  setPosition(P, ACTOR_PLAYER, 37.0, 27.0);
  face(P, ACTOR_PLAYER, FACE_UP);
  setPosition(P, ACTOR_PARTNER, 35.0, 27.0);
  face(P, ACTOR_PARTNER, FACE_UP);
  playerSpeed(P, 2.0);
  yield* movePlayer(P, 36.0, 21.0);
  yield* waitPlayerMove(P);
  face(P, ACTOR_SENIOR_COURT_A_EMILY, FACE_LEFT);
  yield* waitPlayerMove(P);
  fadeIn(P, 32);
  yield* waitFadeEnd(P);
  yield* setText(P, Text_34_130);
  moveTarget(P, ACTOR_SENIOR_COURT_B_FAY, 37.0, 19.0);
  yield* waitMove(P, ACTOR_SENIOR_COURT_B_FAY);
  facePair(P, ACTOR_SENIOR_COURT_A_ALLIE, ACTOR_SENIOR_COURT_B_FAY);
  setAnim(P, ACTOR_SENIOR_COURT_B_FAY, ANIM_BOUNCE);
  yield* speak(P, ACTOR_SENIOR_COURT_B_FAY);
  face(P, ACTOR_SENIOR_COURT_A_ALLIE, FACE_DOWN);
  setAnim(P, ACTOR_SENIOR_COURT_A_ALLIE, ANIM_SHAKE);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_ALLIE);
  yield* speak(P, ACTOR_SENIOR_COURT_A_ALLIE);
  setAnim(P, ACTOR_SENIOR_COURT_A_EMILY, ANIM_NOD);
  yield* speak(P, ACTOR_SENIOR_COURT_A_EMILY);
  setAnim(P, ACTOR_SENIOR_COURT_B_FAY, ANIM_BOUNCE);
  setAnim(P, ACTOR_SENIOR_COURT_A_ALLIE, ANIM_BOUNCE);
  setAnim(P, ACTOR_PARTNER, ANIM_BOUNCE);
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  face(P, ACTOR_PARTNER, FACE_DOWN);
  face(P, ACTOR_SENIOR_COURT_B_FAY, FACE_DOWN);
  playerSpeed(P, 0.5);
  setSpeed(P, ACTOR_SENIOR_COURT_A_EMILY, 0.5);
  yield* movePlayer(P, 43.0, 32.0);
  moveTarget(P, ACTOR_SENIOR_COURT_A_EMILY, 43.0, 32.0);
  yield* waitMove(P, ACTOR_SENIOR_COURT_A_EMILY);
  yield* waitPlayerMove(P);
  yield* movePlayer(P, 36.0, 27.0);
  moveTarget(P, ACTOR_SENIOR_COURT_A_EMILY, 37.0, 31.0);
  yield* waitMove(P, ACTOR_SENIOR_COURT_A_EMILY);
  face(P, ACTOR_SENIOR_COURT_A_EMILY, FACE_UP);
  setAnim(P, ACTOR_SENIOR_COURT_A_EMILY, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_EMILY);
  yield* speak(P, ACTOR_SENIOR_COURT_A_EMILY);
  facePair(P, ACTOR_PARTNER, ACTOR_PLAYER);
  yield* wait(P, 30);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  face(P, ACTOR_PARTNER, FACE_DOWN);
  setAnim(P, ACTOR_PARTNER, ANIM_NOD);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  setAnim(P, ACTOR_SENIOR_COURT_A_EMILY, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_EMILY);
  yield* setText(P, Text_34_135);
  yield* speak(P, ACTOR_SENIOR_COURT_A_EMILY);
  moveTarget(P, ACTOR_SENIOR_COURT_A_EMILY, 37.0, 29.0);
  yield* waitMove(P, ACTOR_SENIOR_COURT_A_EMILY);
  setAnim(P, ACTOR_SENIOR_COURT_A_EMILY, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_EMILY);
  yield* wait(P, 30);
  setAnim(P, ACTOR_SENIOR_COURT_A_EMILY, ANIM_NOD);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* speak(P, ACTOR_PLAYER);
  setAnim(P, ACTOR_SENIOR_COURT_A_EMILY, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_EMILY);
  yield* speak(P, ACTOR_SENIOR_COURT_A_EMILY);
  setAnim(P, ACTOR_SENIOR_COURT_A_EMILY, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_EMILY);
  yield* speak(P, ACTOR_SENIOR_COURT_A_EMILY);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  setAnim(P, ACTOR_SENIOR_COURT_A_EMILY, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_EMILY);
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, ACTOR_PARTNER, FACE_UP);
  yield* wait(P, 40);
  yield* movePlayer(P, 36.0, 23.0);
  yield* waitPlayerMove(P);
  setAnim(P, ACTOR_SENIOR_COURT_A_ALLIE, ANIM_BOUNCE);
  yield* wait(P, 40);
  yield* speak(P, ACTOR_SENIOR_COURT_A_ALLIE);
  moveTarget(P, ACTOR_SENIOR_COURT_B_FAY, 37.0, 21.0);
  yield* waitMove(P, ACTOR_SENIOR_COURT_B_FAY);
  yield* speak(P, ACTOR_SENIOR_COURT_B_FAY);
  facePair(P, ACTOR_PARTNER, ACTOR_PLAYER);
  yield* wait(P, 10);
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  setAnim(P, ACTOR_PARTNER, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_PARTNER);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, ACTOR_PARTNER, FACE_UP);
  setAnim(P, ACTOR_PARTNER, ANIM_NOD);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 10);
  setAnim(P, ACTOR_SENIOR_COURT_B_FAY, ANIM_NOD);
  setAnim(P, ACTOR_SENIOR_COURT_A_ALLIE, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_ALLIE);
  goToLocation(P, STORYLOC_SENIOR_CLASS_COURT, 0x01);
  setAnim(P, ACTOR_SENIOR_COURT_A_EMILY, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_EMILY);
  yield* wait(P, 30);
  yield* fadeOutAndWait(P, 8);
  endCutscene(P);
}

// SeniorSinglesRank4And3Victory (12:73B2): Brian beaten (ranks 4 and 3): his line, Emily's jump and line, back
// to Emily, the rally pair A again
export function* seniorSinglesRank4And3Victory(P) {
  setPosition(P, ACTOR_SENIOR_COURT_A_BRIAN, 35.0, 15.0);
  face(P, ACTOR_SENIOR_COURT_A_BRIAN, FACE_DOWN);
  yield* fadeInSeniorCourtNearPairA(P);
  yield* setText(P, Text_34_74);
  yield* speak(P, ACTOR_SENIOR_COURT_A_BRIAN);
  jumpVelocity(P, ACTOR_SENIOR_COURT_A_EMILY, -2.0);
  yield* waitJump(P, 0x03);
  yield* speak(P, ACTOR_SENIOR_COURT_A_EMILY);
  setActorScript(P, ACTOR_SENIOR_COURT_A_BRIAN, ActorScript_12_03);
  yield* wait(P, 60);
  moveTarget(P, ACTOR_SENIOR_COURT_A_EMILY, 45.0, 25.0);
  yield* movePlayer(P, 45.0, 27.0);
  moveTarget(P, ACTOR_PLAYER, 36.0, 29.0);
  yield* waitMove(P, ACTOR_PLAYER);
  moveTarget(P, ACTOR_PLAYER, 45.0, 29.0);
  yield* wait(P, 60);
  yield* startSeniorCourtPairARally(P);
  face(P, ACTOR_SENIOR_COURT_A_EMILY, FACE_DOWN);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  yield* wait(P, 1);
  endCutscene(P);
}

// SeniorSinglesRank2Victory (12:7449): Joy beaten (the rank-3 flag set): the same at pair B
export function* seniorSinglesRank2Victory(P) {
  setFlag(P, FLAG_WON_SENIOR_SINGLES_RANK_3);
  setPosition(P, ACTOR_SENIOR_COURT_A_JOY, 51.0, 15.0);
  face(P, ACTOR_SENIOR_COURT_A_JOY, FACE_DOWN);
  yield* fadeInSeniorCourtNearPairB(P);
  setPosition(P, ACTOR_PLAYER, 52.0, 27.0);
  yield* setText(P, Text_34_35);
  yield* speak(P, ACTOR_SENIOR_COURT_A_JOY);
  jumpVelocity(P, ACTOR_SENIOR_COURT_A_EMILY, -2.0);
  yield* waitJump(P, 0x03);
  yield* setText(P, Text_34_76);
  yield* speak(P, ACTOR_SENIOR_COURT_A_EMILY);
  setActorScript(P, ACTOR_SENIOR_COURT_A_JOY, ActorScript_12_07);
  moveTarget(P, ACTOR_PLAYER, 45.0, 27.0);
  yield* waitMove(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  yield* startSeniorCourtPairBRally(P);
  endCutscene(P);
}

// SeniorSinglesRank1Victory (12:74B8): Allie beaten (the rank-2 flag set): the same at pair B
export function* seniorSinglesRank1Victory(P) {
  setFlag(P, FLAG_WON_SENIOR_SINGLES_RANK_2);
  yield* placeSeniorCourtPairB(P);
  setPosition(P, ACTOR_SENIOR_COURT_A_ALLIE, 51.0, 15.0);
  face(P, ACTOR_SENIOR_COURT_A_ALLIE, FACE_DOWN);
  yield* fadeInSeniorCourtNearPairB(P);
  setPosition(P, ACTOR_PLAYER, 52.0, 27.0);
  yield* setText(P, Text_34_32);
  yield* speak(P, ACTOR_SENIOR_COURT_A_ALLIE);
  jumpVelocity(P, ACTOR_SENIOR_COURT_A_EMILY, -2.0);
  yield* waitJump(P, 0x03);
  yield* setText(P, Text_34_77);
  yield* speak(P, ACTOR_SENIOR_COURT_A_EMILY);
  setActorScript(P, ACTOR_SENIOR_COURT_A_ALLIE, ActorScript_12_10);
  moveTarget(P, ACTOR_PLAYER, 45.0, 27.0);
  yield* waitMove(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  yield* startSeniorCourtPairBRally(P);
  endCutscene(P);
}

// SeniorSharedVictoryScene (12:752A): the senior title: Fay's line, Emily's talk with the player, the sweat
// balloon, Fay's last line; back to the court at entry 1
export function* seniorSharedVictoryScene(P) {
  playerSpeed(P, 2.0);
  setSpeed(P, ACTOR_ROLE_SENIOR_COURT_FAY, 0.75);
  setPosition(P, ACTOR_SENIOR_COURT_A_EMILY, 43.0, 39.0);
  setPosition(P, ACTOR_ROLE_SENIOR_COURT_FAY, 34.0, 15.0);
  setPosition(P, ACTOR_PLAYER, 36.0, 27.0);
  yield* movePlayer(P, 36.0, 21.0);
  yield* waitPlayerMove(P);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, ACTOR_ROLE_SENIOR_COURT_FAY, FACE_DOWN);
  face(P, ACTOR_SENIOR_COURT_A_EMILY, FACE_UP);
  yield* placeSeniorCourtPairA(P);
  fadeIn(P, 8);
  yield* waitFadeEnd(P);
  yield* wait(P, 30);
  yield* setText(P, Text_34_78);
  moveTarget(P, ACTOR_ROLE_SENIOR_COURT_FAY, 36.0, 19.0);
  yield* waitMove(P, ACTOR_ROLE_SENIOR_COURT_FAY);
  setAnim(P, ACTOR_ROLE_SENIOR_COURT_FAY, ANIM_BOUNCE);
  yield* speak(P, ACTOR_ROLE_SENIOR_COURT_FAY);
  setAnim(P, ACTOR_SENIOR_COURT_A_EMILY, ANIM_NOD);
  yield* speak(P, ACTOR_SENIOR_COURT_A_EMILY);
  setAnim(P, ACTOR_ROLE_SENIOR_COURT_FAY, ANIM_BOUNCE);
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  playerSpeed(P, 0.5);
  setSpeed(P, ACTOR_SENIOR_COURT_A_EMILY, 0.5);
  yield* movePlayer(P, 43.0, 32.0);
  moveTarget(P, ACTOR_SENIOR_COURT_A_EMILY, 43.0, 31.0);
  yield* waitMove(P, ACTOR_SENIOR_COURT_A_EMILY);
  yield* waitPlayerMove(P);
  yield* movePlayer(P, 36.0, 30.0);
  moveTarget(P, ACTOR_SENIOR_COURT_A_EMILY, 36.0, 31.0);
  yield* waitMove(P, ACTOR_SENIOR_COURT_A_EMILY);
  moveTarget(P, ACTOR_SENIOR_COURT_A_EMILY, 36.0, 30.0);
  yield* waitMove(P, ACTOR_SENIOR_COURT_A_EMILY);
  setAnim(P, ACTOR_SENIOR_COURT_A_EMILY, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_EMILY);
  yield* speak(P, ACTOR_SENIOR_COURT_A_EMILY);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  setAnim(P, ACTOR_SENIOR_COURT_A_EMILY, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_EMILY);
  yield* speak(P, ACTOR_SENIOR_COURT_A_EMILY);
  moveTarget(P, ACTOR_SENIOR_COURT_A_EMILY, 36.0, 29.0);
  yield* waitMove(P, ACTOR_SENIOR_COURT_A_EMILY);
  setAnim(P, ACTOR_SENIOR_COURT_A_EMILY, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_EMILY);
  yield* wait(P, 30);
  setAnim(P, ACTOR_SENIOR_COURT_A_EMILY, ANIM_NOD);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* speak(P, ACTOR_PLAYER);
  setAnim(P, ACTOR_SENIOR_COURT_A_EMILY, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_EMILY);
  yield* speak(P, ACTOR_SENIOR_COURT_A_EMILY);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  setAnim(P, ACTOR_SENIOR_COURT_A_EMILY, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_EMILY);
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_UP);
  setPosition(P, ACTOR_SENIOR_COURT_A_BALLOON_SWEAT, 37.5, 25.5);
  sound(P, SFX_APPEAR2);
  yield* wait(P, 40);
  yield* movePlayer(P, 36.0, 23.0);
  yield* waitPlayerMove(P);
  setAnim(P, ACTOR_ROLE_SENIOR_COURT_FAY, ANIM_BOUNCE);
  yield* wait(P, 40);
  moveTarget(P, ACTOR_ROLE_SENIOR_COURT_FAY, 36.0, 21.0);
  yield* waitMove(P, ACTOR_ROLE_SENIOR_COURT_FAY);
  setPosition(P, ACTOR_SENIOR_COURT_A_BALLOON_SWEAT, 63.0, 63.0);
  yield* speak(P, ACTOR_ROLE_SENIOR_COURT_FAY);
  goToLocation(P, STORYLOC_SENIOR_CLASS_COURT, 0x01);
  setAnim(P, ACTOR_SENIOR_COURT_A_EMILY, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_EMILY);
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 30);
  yield* fadeOutAndWait(P, 8);
  endCutscene(P);
}

// ComputeSeniorCourtStage (12:7756): the court's stage (wMapSceneStage2) by the titles won: singles 0 before the
// junior title, 2-5 at the ranks 4-1, 9 senior champion, $0B at the Island Open, $0D complete; doubles 1, 6-8,
// $0A, $0C, $0E. Returns a and the last flag test's F.
const STAGE_STEPS_SINGLES = [[0x00, FLAG_WON_JUNIOR_SINGLES_RANK_1], [0x02, FLAG_WON_SENIOR_SINGLES_RANK_4],
  [0x03, FLAG_WON_SENIOR_SINGLES_RANK_3], [0x04, FLAG_WON_SENIOR_SINGLES_RANK_2], [0x05, FLAG_WON_SENIOR_SINGLES_RANK_1],
  [0x09, FLAG_REACHED_ISLAND_OPEN_SINGLES], [0x0B, FLAG_STORY_COMPLETE_SINGLES]];
const STAGE_STEPS_DOUBLES = [[0x01, FLAG_WON_JUNIOR_DOUBLES_RANK_1], [0x06, FLAG_WON_SENIOR_DOUBLES_RANK_3],
  [0x07, FLAG_WON_SENIOR_DOUBLES_RANK_2], [0x08, FLAG_WON_SENIOR_DOUBLES_RANK_1], [0x0A, FLAG_REACHED_ISLAND_OPEN_DOUBLES],
  [0x0C, FLAG_STORY_COMPLETE_DOUBLES]];
const STAGE_SINGLES_COMPLETE = 0x0D, STAGE_DOUBLES_COMPLETE = 0x0E;
export function computeSeniorCourtStage(P) {
  const doubles = testFlag(P, FLAG_DOUBLES);
  let a = doubles ? STAGE_DOUBLES_COMPLETE : STAGE_SINGLES_COMPLETE, f = testFlagF(true);
  for (const [stage, flag] of doubles ? STAGE_STEPS_DOUBLES : STAGE_STEPS_SINGLES) {
    if (!testFlag(P, flag)) { a = stage; f = testFlagF(false); break; }
  }
  P.V.mapSceneStage2 = a;                                 // .loop
  return { a, f };
}

// FadeInSeniorCourtNearPairA (12:77C2) / FadeInSeniorCourtNearPairB (12:77FD): the pair placed aside, the player
// walked to its court's front, Emily turned, faded in
export function* fadeInSeniorCourtNearPairA(P) {
  yield* placeSeniorCourtPairA(P);
  playerSpeed(P, 2.0);
  setPosition(P, ACTOR_PLAYER, 36.0, 27.0);
  yield* movePlayer(P, 36.0, 21.0);
  yield* waitPlayerMove(P);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, ACTOR_SENIOR_COURT_A_EMILY, FACE_LEFT);
  yield* waitPlayerMove(P);
  fadeIn(P, 32);
  yield* waitFadeEnd(P);
}

export function* fadeInSeniorCourtNearPairB(P) {
  yield* placeSeniorCourtPairB(P);
  playerSpeed(P, 2.0);
  yield* movePlayer(P, 53.0, 21.0);
  yield* waitPlayerMove(P);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, ACTOR_SENIOR_COURT_A_EMILY, FACE_RIGHT);
  yield* waitPlayerMove(P);
  fadeIn(P, 32);
  yield* waitFadeEnd(P);
}

// the victory scenes of this module, by address (SeniorMatchVictorySceneDispatchPtrs' targets)
export const SENIOR_VICTORY_SCENES = {
  0x7071: islandOpenDoublesVictory, 0x73B2: seniorSinglesRank4And3Victory, 0x7449: seniorSinglesRank2Victory,
  0x74B8: seniorSinglesRank1Victory, 0x752A: seniorSharedVictoryScene,
};

export const HOOKS = [
  scene(BANK, 0x7071, islandOpenDoublesVictory),
  scene(BANK, 0x73B2, seniorSinglesRank4And3Victory),
  scene(BANK, 0x7449, seniorSinglesRank2Victory),
  scene(BANK, 0x74B8, seniorSinglesRank1Victory),
  scene(BANK, 0x752A, seniorSharedVictoryScene),
  [BANK, 0x7756, hook(computeSeniorCourtStage)],
  scene(BANK, 0x77C2, fadeInSeniorCourtNearPairA),
  scene(BANK, 0x77FD, fadeInSeniorCourtNearPairB),
];
