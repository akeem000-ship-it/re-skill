// The Island Open's awards ceremony (bank $0F, $5628-$5F79): Spike's line, the stand-in actors, the frame wait
// that keeps a (DelayFrames), Spike's stomps, the arrival scenes (entry $0A singles: the rivals; $0B doubles: the
// partner), the podium announcement, the chairman's speech, the trophy hand-over and the player's saved position.
// The ceremony's map tables and its init and step-on scripts are in testmaps_0f.asm (part 2); its doubles NPC list
// and ActorScript_0f_00 here are data.
// Port of src/story/awards_0f.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss1_awards*.mtrec (scripted: the ceremony, singles and doubles).
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FACE_DOWN, FACE_UP, FACE_LEFT, FACE_RIGHT, ANIM_WALK, ANIM_BOUNCE, ANIM_NOD,
  ANIM_SHAKE, WRAM_ACTORS, BANK_ACTORS, setText, advanceText, speak, setAnim, waitIdle, wait, face, faceToward,
  facePair, lockFacing, unlockFacing, setPosition, moveTarget, waitMove, movePlayer, movePlayerToActor,
  waitPlayerMove, setSpeed, playerSpeed, jumpVelocity, waitJump, nullScript, setObjdef, actorState, followPlayer,
  screenShake, fadeIn, waitFadeEnd, sound, farcall, hook, hookGen, scene, ACTORF_X, ACTORF_Y,
} from "./common.js";
import { loadActorObjectDef } from "../story/actor_objdefs.js";
import { checkAwardsCeremonyRivalSceneDone } from "./island_open_0f.js";

const BANK = 0x0F;
// actors of the ceremony (AwardsCeremonyActors_0f, testmaps_0f.asm)
const ACTOR_WALK_74_08 = 0x03, ACTOR_A_COZ = 0x04, ACTOR_B_COZ = 0x05, ACTOR_SAMMI = 0x06, ACTOR_SEAN = 0x07;
const ACTOR_SPIKE = 0x08, ACTOR_WALK_6F_06 = 0x09, ACTOR_WALK_6F_05 = 0x0A, ACTOR_WALK_6F_07_1 = 0x0B;
const ACTOR_WALK_75_06 = 0x0C, ACTOR_TROPHY_3 = 0x0F, ACTOR_WALK_6F_07_2 = 0x10, ACTOR_WALK_74_07 = 0x11;
const ACTOR_WALK_74_06 = 0x12, ACTOR_BALLOON_ANGRY = 0x13, ACTOR_BALLOON_SWEAT = 0x14;
const ACTOR_BALLOON_QUESTION = 0x15, ACTOR_ALEX = 0x16;
const OBJ_WALK_6F_07 = 0x25, OBJ_WALK_71_03 = 0x30, OBJ_WALK_72_03 = 0x3A, OBJ_BALLOON_ANGRY = 0x4E;
const OBJ_BALLOON_SWEAT = 0x53, OBJ_ALEX_B = 0x56, OBJ_TROPHY = 0x74;
const ANIM_TROPHY_SMALL = 0x07;
const SFX_STOMP = 0x83, SFX_EMOTE = 0x98, SFX_APPEAR1 = 0x99;
const Text_25_107 = 0x286B, Text_25_125 = 0x287D, Text_25_129 = 0x2881, Text_25_133 = 0x2885, Text_25_151 = 0x2897;

// DelayFrames (0F:5678): WaitScriptFrames a frames, every register kept
export function* delayFrames(P, frames) { yield* wait(P, frames); }
const delay = delayFrames;
// script_set_anim actor, anim / script_wait_idle actor
function* animIdle(P, actor, anim) {
  setAnim(P, actor, anim);
  yield* waitIdle(P, actor);
}
// a balloon: placed, its sound, 60 frames
function* balloonAt(P, actor, x, y, sfx) {
  setPosition(P, actor, x, y);
  sound(P, sfx);
  yield* delay(P, 60);
}
// objdef into actor (script_set_objdef), walking
function changeObj(P, objdef, actor) {
  setObjdef(P, objdef, actor);
  setAnim(P, actor, ANIM_WALK);
}

// AwardsCeremonyNpc08_0f (0F:5628): Spike: his line, another once the rival scene of this format was seen
export function* awardsCeremonyNpc08(P) {
  yield* setText(P, Text_25_125);
  if (checkAwardsCeremonyRivalSceneDone(P).a & 0x01) yield* setText(P, Text_25_129);
  yield* speak(P, ACTOR_SPIKE);
}
// ReplacePlayerWithStandInActor (0F:5641): the ceremony's stand-in shows the player (its court sprite by gender);
// the player itself put away
export function replacePlayerWithStandInActor(P) {
  const bc = actorState(P, ACTOR_ALEX), objdef = (P.V.storyModeGenderOfMainCharacter + OBJ_ALEX_B) & 0xFF;
  if (bc >> 8) farcall(P, BANK_ACTORS, () => loadActorObjectDef(P, bc, objdef));
  setAnim(P, ACTOR_ALEX, ANIM_WALK);
  setPosition(P, ACTOR_PLAYER, 63.0, 63.0);
}
// CutsceneStompScreenShake (0F:567F): Spike jumps and lands with a stomp; the screen shakes (2, then 1)
export function* cutsceneStompScreenShake(P) {
  jumpVelocity(P, ACTOR_SPIKE, -2.0);
  yield* waitJump(P, ACTOR_SPIKE);
  sound(P, SFX_STOMP);
  screenShake(P, 2);
  yield* delay(P, 8);
  screenShake(P, 1);
  yield* delay(P, 8);
  screenShake(P, 0);
}

// AwardsCeremonyEntry0aScene (0F:56A8): the ceremony (singles): the player's friend and the rival (A Coz) argue,
// the chairman calls the player up to the stage and back; at the end the friend follows the player.
export function* awardsCeremonyEntry0aScene(P) {
  const FRIEND = ACTOR_WALK_74_08, RIVAL = ACTOR_A_COZ, CHAIRMAN = ACTOR_WALK_6F_07_1;
  yield* awardsCeremonyArrivalIntro(P);
  yield* animIdle(P, FRIEND, ANIM_BOUNCE);
  faceToward(P, ACTOR_PLAYER, FRIEND);
  yield* delay(P, 10);
  yield* setText(P, Text_25_107);
  yield* speak(P, FRIEND);
  yield* animIdle(P, FRIEND, ANIM_NOD);
  yield* speak(P, FRIEND);
  yield* animIdle(P, ACTOR_PLAYER, ANIM_NOD);
  faceToward(P, FRIEND, RIVAL);
  yield* animIdle(P, RIVAL, ANIM_BOUNCE);
  yield* speak(P, RIVAL);
  yield* balloonAt(P, ACTOR_BALLOON_ANGRY, 12.5, 37.5, SFX_APPEAR1);
  setPosition(P, ACTOR_BALLOON_ANGRY, 63.0, 63.0);
  yield* animIdle(P, FRIEND, ANIM_BOUNCE);
  faceToward(P, RIVAL, FRIEND);
  yield* speak(P, FRIEND);
  yield* animIdle(P, RIVAL, ANIM_BOUNCE);
  yield* speak(P, RIVAL);
  yield* delay(P, 30);
  facePair(P, ACTOR_PLAYER, FRIEND);
  yield* delay(P, 80);
  faceToward(P, RIVAL, FRIEND);
  facePair(P, RIVAL, ACTOR_PLAYER);
  yield* delay(P, 30);
  yield* animIdle(P, RIVAL, ANIM_SHAKE);
  yield* speak(P, RIVAL);
  yield* delay(P, 40);
  yield* speak(P, CHAIRMAN);
  face(P, FRIEND, FACE_UP);
  face(P, RIVAL, FACE_UP);
  yield* delay(P, 20);
  yield* toTheStageAndBack(P);
  face(P, RIVAL, FACE_DOWN);
  yield* speak(P, RIVAL);
  face(P, FRIEND, FACE_RIGHT);
  yield* animIdle(P, RIVAL, ANIM_BOUNCE);
  yield* speak(P, RIVAL);
  yield* animIdle(P, FRIEND, ANIM_BOUNCE);
  face(P, RIVAL, FACE_LEFT);
  yield* speak(P, FRIEND);
  yield* balloonAt(P, ACTOR_BALLOON_ANGRY, 14.5, 37.5, SFX_APPEAR1);
  setPosition(P, ACTOR_BALLOON_ANGRY, 63.0, 63.0);
  face(P, RIVAL, FACE_UP);
  yield* delay(P, 40);
  face(P, FRIEND, FACE_DOWN);
  yield* speak(P, FRIEND);
  yield* animIdle(P, FRIEND, ANIM_BOUNCE);
  yield* speak(P, FRIEND);
  yield* animIdle(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* speak(P, FRIEND);
  yield* animIdle(P, ACTOR_PLAYER, ANIM_NOD);
  followPlayer(P, FRIEND);
}
// the chairman's call: the player walks up to the stage, the chairman speaks, the player walks back
function* toTheStageAndBack(P) {
  playerSpeed(P, 0.75);
  yield* movePlayer(P, 12.0, 19.0);
  yield* waitPlayerMove(P);
  yield* delay(P, 30);
  yield* animIdle(P, ACTOR_WALK_6F_07_1, ANIM_BOUNCE);
  yield* speak(P, ACTOR_WALK_6F_07_1);
  yield* delay(P, 40);
  yield* movePlayer(P, 12.0, 41.0);
  yield* waitPlayerMove(P);
}

// AwardsCeremonyEntry0bScene (0F:5889): the ceremony (doubles): the partner and the Coz twins (A and B), the
// chairman's call; at the end the partner follows the player.
export function* awardsCeremonyEntry0bScene(P) {
  const A = ACTOR_A_COZ, B = ACTOR_B_COZ;
  nullScript(P, ACTOR_PARTNER);
  setPosition(P, ACTOR_PARTNER, 11.0, 39.0);
  face(P, ACTOR_PARTNER, FACE_UP);
  yield* awardsCeremonyArrivalIntro(P);
  yield* setText(P, Text_25_151);
  yield* animIdle(P, ACTOR_PARTNER, ANIM_BOUNCE);
  face(P, ACTOR_PARTNER, FACE_DOWN);
  yield* speakPartnerVariantLine(P);
  yield* animIdle(P, ACTOR_PLAYER, ANIM_NOD);
  yield* animIdle(P, ACTOR_PARTNER, ANIM_NOD);
  yield* speakPartnerVariantLine(P);
  yield* animIdle(P, ACTOR_PLAYER, ANIM_NOD);
  faceToward(P, ACTOR_PARTNER, A);
  yield* delay(P, 10);
  yield* animIdle(P, A, ANIM_BOUNCE);
  yield* speak(P, A);
  faceToward(P, ACTOR_PLAYER, B);
  yield* speak(P, B);
  yield* balloonAt(P, ACTOR_BALLOON_QUESTION, 12.5, 37.5, SFX_EMOTE);
  setPosition(P, ACTOR_BALLOON_QUESTION, 63.0, 63.0);
  face(P, ACTOR_PARTNER, FACE_RIGHT);
  yield* animIdle(P, ACTOR_PARTNER, ANIM_BOUNCE);
  yield* speakPartnerVariantLine(P);
  yield* animIdle(P, A, ANIM_BOUNCE);
  yield* speak(P, A);
  yield* animIdle(P, B, ANIM_BOUNCE);
  yield* speak(P, B);
  yield* delay(P, 30);
  facePair(P, ACTOR_PARTNER, ACTOR_PLAYER);
  yield* delay(P, 60);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  face(P, ACTOR_PARTNER, FACE_RIGHT);
  yield* delay(P, 30);
  face(P, A, FACE_DOWN);
  yield* animIdle(P, A, ANIM_SHAKE);
  yield* speak(P, A);
  yield* delay(P, 40);
  yield* speak(P, ACTOR_WALK_6F_07_1);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, ACTOR_PARTNER, FACE_UP);
  face(P, A, FACE_UP);
  face(P, B, FACE_UP);
  yield* delay(P, 20);
  yield* toTheStageAndBack(P);
  face(P, A, FACE_LEFT);
  yield* speak(P, A);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  face(P, ACTOR_PARTNER, FACE_RIGHT);
  yield* animIdle(P, A, ANIM_BOUNCE);
  yield* speak(P, A);
  face(P, B, FACE_LEFT);
  yield* animIdle(P, B, ANIM_BOUNCE);
  yield* speak(P, B);
  yield* animIdle(P, ACTOR_PARTNER, ANIM_BOUNCE);
  yield* speakPartnerVariantLine(P);
  yield* balloonAt(P, ACTOR_BALLOON_ANGRY, 14.5, 37.5, SFX_APPEAR1);
  yield* balloonAt(P, ACTOR_BALLOON_ANGRY, 14.5, 39.5, SFX_APPEAR1);
  setPosition(P, ACTOR_BALLOON_ANGRY, 63.0, 63.0);
  face(P, A, FACE_UP);
  face(P, B, FACE_UP);
  yield* delay(P, 30);
  facePair(P, ACTOR_PLAYER, ACTOR_PARTNER);
  yield* speakPartnerVariantLine(P);
  yield* animIdle(P, ACTOR_PARTNER, ANIM_BOUNCE);
  yield* speakPartnerVariantLine(P);
  yield* animIdle(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* animIdle(P, ACTOR_PARTNER, ANIM_NOD);
  yield* speakPartnerVariantLine(P);
  yield* animIdle(P, ACTOR_PLAYER, ANIM_NOD);
  followPlayer(P, ACTOR_PARTNER);
}
// SpeakPartnerVariantLine (0F:5AEC): of two messages, the partner says the first if male, the second if female
export function* speakPartnerVariantLine(P) {
  if (!P.V.storyModeGenderOfPartnerCharacter) {
    yield* speak(P, ACTOR_PARTNER);
    advanceText(P);
    return;
  }
  advanceText(P);                                                     // .femalePartner
  yield* speak(P, ACTOR_PARTNER);
}

// AwardsCeremonyArrivalIntro (0F:5B4D): the player arrives at the hall; two latecomers (shown by the balloon
// actors with walker sprites) come running, one jumps; the balloons get their own sprites back.
export function* awardsCeremonyArrivalIntro(P) {
  const RUNNER = ACTOR_BALLOON_ANGRY, SECOND = ACTOR_BALLOON_SWEAT;
  playerSpeed(P, 7.96875);
  yield* movePlayer(P, 12.0, 11.0);
  yield* waitPlayerMove(P);
  P.V.storyModeShowLocationName = 0;
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  changeObj(P, OBJ_WALK_71_03, RUNNER);
  changeObj(P, OBJ_WALK_72_03, SECOND);
  setPosition(P, RUNNER, 7.0, 1.0);
  setPosition(P, SECOND, 15.0, 1.0);
  setSpeed(P, RUNNER, 1.0);
  moveTarget(P, RUNNER, 7.0, 5.0);
  yield* waitMove(P, RUNNER);
  yield* animIdle(P, RUNNER, ANIM_SHAKE);
  jumpVelocity(P, RUNNER, -2.0);
  yield* waitJump(P, RUNNER);
  setSpeed(P, SECOND, 1.0);
  moveTarget(P, SECOND, 15.0, 7.5);
  yield* waitMove(P, SECOND);
  jumpVelocity(P, RUNNER, -2.0);
  setAnim(P, SECOND, ANIM_BOUNCE);
  playerSpeed(P, 0.5);
  yield* movePlayerToActor(P, ACTOR_PLAYER);
  yield* waitPlayerMove(P);
  yield* delay(P, 30);
  changeObj(P, OBJ_BALLOON_ANGRY, RUNNER);
  changeObj(P, OBJ_BALLOON_SWEAT, SECOND);
  setPosition(P, RUNNER, 63.0, 63.0);
  setPosition(P, SECOND, 63.0, 63.0);
}

// AnnounceWinnersToPodiums (0F:5C52): the chairman and his aide nod and turn to the hall; the winners' announcement
export function* announceWinnersToPodiums(P) {
  facePair(P, ACTOR_WALK_75_06, ACTOR_WALK_6F_07_1);
  yield* delay(P, 30);
  yield* animIdle(P, ACTOR_WALK_6F_07_1, ANIM_NOD);
  yield* animIdle(P, ACTOR_WALK_75_06, ANIM_NOD);
  yield* delay(P, 30);
  face(P, ACTOR_WALK_6F_07_1, FACE_RIGHT);
  face(P, ACTOR_WALK_75_06, FACE_RIGHT);
  yield* setText(P, Text_25_133);
  yield* speak(P, ACTOR_WALK_6F_07_1);
}
// FaceAwardsCeremonyCrowdUp (0F:5C96): the audience faces the stage
export function faceAwardsCeremonyCrowdUp(P) {
  for (const actor of [ACTOR_B_COZ, ACTOR_SPIKE, ACTOR_WALK_6F_06, ACTOR_WALK_6F_05, ACTOR_SAMMI, ACTOR_WALK_74_06,
    ACTOR_SEAN, ACTOR_WALK_74_07]) face(P, actor, FACE_UP);
}
// AwardsCeremonyChairmanSpeech (0F:5CCF): the chairman steps aside for the president's speech (five lines), they
// change places back; the latecomers' sprites go to Sean and the balloon (now standing at the side); the
// president walks to the player's place below the stage.
export function* awardsCeremonyChairmanSpeech(P) {
  const CHAIRMAN = ACTOR_WALK_6F_07_1, PRESIDENT = ACTOR_WALK_75_06;
  yield* delay(P, 30);
  yield* speak(P, CHAIRMAN);
  yield* animIdle(P, CHAIRMAN, ANIM_NOD);
  face(P, CHAIRMAN, FACE_UP);
  yield* delay(P, 30);
  lockFacing(P, CHAIRMAN);
  moveTarget(P, CHAIRMAN, 7.0, 27.0);
  yield* waitMove(P, CHAIRMAN);
  unlockFacing(P, CHAIRMAN);
  face(P, CHAIRMAN, FACE_RIGHT);
  moveTarget(P, PRESIDENT, 8.0, 25.0);
  yield* waitMove(P, PRESIDENT);
  face(P, PRESIDENT, FACE_RIGHT);
  yield* delay(P, 30);
  for (const anim of [ANIM_NOD, ANIM_SHAKE, ANIM_BOUNCE, ANIM_SHAKE, ANIM_NOD]) {
    yield* animIdle(P, PRESIDENT, anim);
    yield* speak(P, PRESIDENT);
  }
  yield* animIdle(P, PRESIDENT, ANIM_NOD);
  yield* delay(P, 60);
  moveTarget(P, PRESIDENT, 8.0, 23.0);
  yield* waitMove(P, PRESIDENT);
  face(P, PRESIDENT, FACE_RIGHT);
  moveTarget(P, CHAIRMAN, 8.0, 25.0);
  yield* waitMove(P, CHAIRMAN);
  face(P, CHAIRMAN, FACE_RIGHT);
  yield* delay(P, 30);
  yield* speak(P, CHAIRMAN);
  changeObj(P, OBJ_WALK_71_03, ACTOR_SEAN);
  changeObj(P, OBJ_WALK_72_03, ACTOR_BALLOON_SWEAT);
  setPosition(P, ACTOR_SEAN, 7.0, 5.0);
  setPosition(P, ACTOR_BALLOON_SWEAT, 15.0, 7.5);
  face(P, ACTOR_SEAN, FACE_DOWN);
  face(P, ACTOR_BALLOON_SWEAT, FACE_DOWN);
  yield* delay(P, 30);
  yield* movePlayer(P, 12.0, 17.0);
  moveTarget(P, PRESIDENT, 12.0, 23.0);
  yield* waitMove(P, PRESIDENT);
  moveTarget(P, PRESIDENT, 12.0, 19.0);
  yield* waitMove(P, PRESIDENT);
}
// AwardsCeremonySwapActors_0f (0F:5E4A): the trophy hand-over: the official carrying the trophy (actor and trophy
// swap sprites as it passes from hand to hand) brings it up and steps back down.
export function* awardsCeremonySwapActors(P) {
  const OFFICIAL = ACTOR_WALK_6F_07_2, TROPHY = ACTOR_TROPHY_3;
  changeObj(P, OBJ_TROPHY, OFFICIAL);
  changeObj(P, OBJ_WALK_6F_07, TROPHY);
  setPosition(P, TROPHY, 17.0, 22.0);
  setPosition(P, OFFICIAL, 17.0, 21.0);
  face(P, TROPHY, FACE_UP);
  setAnim(P, OFFICIAL, ANIM_TROPHY_SMALL);
  moveTarget(P, OFFICIAL, 17.0, 18.0);
  moveTarget(P, TROPHY, 17.0, 19.0);
  yield* waitMove(P, TROPHY);
  changeObj(P, OBJ_WALK_6F_07, OFFICIAL);
  changeObj(P, OBJ_TROPHY, TROPHY);
  setPosition(P, OFFICIAL, 17.0, 19.0);
  setPosition(P, TROPHY, 16.0, 19.0);
  face(P, OFFICIAL, FACE_LEFT);
  setAnim(P, TROPHY, ANIM_TROPHY_SMALL);
  moveTarget(P, OFFICIAL, 16.0, 19.0);
  moveTarget(P, TROPHY, 15.0, 19.0);
  yield* waitMove(P, TROPHY);
  lockFacing(P, OFFICIAL);
  moveTarget(P, OFFICIAL, 17.0, 19.0);
  yield* waitMove(P, OFFICIAL);
  unlockFacing(P, OFFICIAL);
  setSpeed(P, OFFICIAL, 1.0);
  moveTarget(P, OFFICIAL, 17.0, 22.0);
  yield* waitMove(P, OFFICIAL);
  face(P, OFFICIAL, FACE_UP);
}
// SavePlayerActorPosition (0F:5F52): the player's position words into wMapScratch (x) and wMapScratch + 2 (y).
// Returns a, bc (the record), de (y), hl as the ROM leaves them.
export function savePlayerActorPosition(P) {
  const { bus } = P;
  P.wramBank(WRAM_ACTORS);
  const actor = actorState(P, ACTOR_PLAYER);
  const x = bus.u16(actor + ACTORF_X), y = bus.u16(actor + ACTORF_Y);
  bus.w16(P.A.mapScratch, x);
  bus.w16(P.A.mapScratch + 2, y);
  return { a: y & 0xFF, bc: actor, de: y, hl: P.A.mapScratch + 3 };
}

export const HOOKS = [
  scene(BANK, 0x5628, awardsCeremonyNpc08),
  [BANK, 0x5641, hook(P => { replacePlayerWithStandInActor(P); })],
  [BANK, 0x5678, hookGen((P, c) => delayFrames(P, c.a))],
  scene(BANK, 0x567F, cutsceneStompScreenShake),
  scene(BANK, 0x56A8, awardsCeremonyEntry0aScene),
  scene(BANK, 0x5889, awardsCeremonyEntry0bScene),
  scene(BANK, 0x5AEC, speakPartnerVariantLine),
  scene(BANK, 0x5B4D, awardsCeremonyArrivalIntro),
  scene(BANK, 0x5C52, announceWinnersToPodiums),
  [BANK, 0x5C96, hook(P => { faceAwardsCeremonyCrowdUp(P); })],
  scene(BANK, 0x5CCF, awardsCeremonyChairmanSpeech),
  scene(BANK, 0x5E4A, awardsCeremonySwapActors),
  [BANK, 0x5F52, hook(P => savePlayerActorPosition(P))],
];
