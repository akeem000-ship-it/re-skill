// Bank $0F's small-character test map and the awards ceremony's steps ($40D0-$5627): the test map's NPCs (the
// player's sprite through the object defs), its init script and button task; the ceremony's step tiles (Spike's
// stomp and the friend's line by format; the podium: the winners called up, the trophies handed over, the
// chairman's speech, the ceremony's screens, on to the academy wing) and its init script (the doubles lists, the
// entries' scenes, Spike aside once seen, the friend following). The map tables and actor lists are data.
// Port of src/story/testmaps_0f.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss1_end*.mtrec and ss1_awards*.mtrec (part 1's scripted ceremony), out/port/ss2_smallchar*.mtrec,
// ss2_talk_smallchar*.mtrec, ss2_talk_mapscriptnop.mtrec (scripted: the test map and its NPCs).
import {
  ACTOR_PARTNER, ACTOR_PLAYER, ANIM_BOUNCE, ANIM_NOD, ANIM_SHAKE, ANIM_WALK, BANK_ACTORS, FACE_DOWN, FACE_LEFT,
  FACE_RIGHT, FACE_UP, FLAG_DOUBLES, WRAM_ACTORS, actorState, attachStepMover, beginCutscene, copyBehaviorRect,
  copySceneRect, face, faceToward, fadeOutAndWait, farcall, followPlayer, goToLocation, lockFacing, movePlayer,
  moveTarget, nullScript, playerSpeed, registerFrameTask, respawnActors, scene, setActorScript, setAnim, setFlag,
  setNpcScripts, setObjdef, setPosition, setPositionRaw, setSpeed, setText, sound, speak, testFlag, unlockFacing,
  wActors, waitIdle, waitMove, waitPlayerMove,
} from "./common.js";
import { loadObjdef, OBJ_HARRY_B } from "./twins.js";
import { loadActorObjectDef } from "../story/actor_objdefs.js";
import { restorePalettesFromMaster } from "../home/palettes.js";
import { delayFrames, replacePlayerWithStandInActor, cutsceneStompScreenShake, announceWinnersToPodiums,
  faceAwardsCeremonyCrowdUp, awardsCeremonyChairmanSpeech, awardsCeremonySwapActors, awardsCeremonyEntry0aScene,
  awardsCeremonyEntry0bScene, savePlayerActorPosition } from "./awards_0f.js";
import { checkAwardsCeremonyRivalSceneDone } from "./island_open_0f.js";
import { setPlayerAndPartnerObjectDefs } from "./actor_0f.js";

const AwardsCeremonyActorsDoubles_0f = 0x430B;
const BANK = 0x0F;
const ACTOR_RECORD_BYTE_18 = 0x18;                      // a byte of the actor record the disassembly leaves unnamed
const OBJ_ALEX = 0x26;
const SCENE_MODE_CEREMONY = 0x01;                       // RunStorySceneByMode's b: the ceremony's screens
// data of this bank (read from the ROM)
const AwardsCeremonyNpcScriptsDoubles_0f = 0x5B04;
const SmallCharTestButtonTask_0f = 0x41B7;
// routines of other banks (run as the ROM's, or the JS another part hooked there)
const GetObjectDefCount = [0x04, 0x4C0B], RunStorySceneByMode = [0x18, 0x7617];
const ACTOR_AWARDS_CEREMONY_ALEX = 0x16;
const ACTOR_AWARDS_CEREMONY_A_COZ = 0x04;
const ACTOR_AWARDS_CEREMONY_BALLOON_ANGRY = 0x13;
const ACTOR_AWARDS_CEREMONY_BALLOON_QUESTION = 0x15;
const ACTOR_AWARDS_CEREMONY_BALLOON_SWEAT = 0x14;
const ACTOR_AWARDS_CEREMONY_B_COZ = 0x05;
const ACTOR_AWARDS_CEREMONY_DOUBLES_SPIKE = 0x08;
const ACTOR_AWARDS_CEREMONY_DOUBLES_TROPHY_1 = 0x0D;
const ACTOR_AWARDS_CEREMONY_DOUBLES_TROPHY_2 = 0x0E;
const ACTOR_AWARDS_CEREMONY_DOUBLES_TROPHY_3 = 0x0F;
const ACTOR_AWARDS_CEREMONY_DOUBLES_WALK_74_08 = 0x03;
const ACTOR_AWARDS_CEREMONY_SPIKE = 0x08;
const ACTOR_AWARDS_CEREMONY_TROPHY_1 = 0x0D;
const ACTOR_AWARDS_CEREMONY_TROPHY_2 = 0x0E;
const ACTOR_AWARDS_CEREMONY_TROPHY_3 = 0x0F;
const ACTOR_AWARDS_CEREMONY_WALK_6F_06 = 0x09;
const ACTOR_AWARDS_CEREMONY_WALK_6F_07_1 = 0x0B;
const ACTOR_AWARDS_CEREMONY_WALK_6F_07_2 = 0x10;
const ACTOR_AWARDS_CEREMONY_WALK_74_06 = 0x12;
const ACTOR_AWARDS_CEREMONY_WALK_74_07 = 0x11;
const ACTOR_AWARDS_CEREMONY_WALK_74_08 = 0x03;
const ACTOR_AWARDS_CEREMONY_WALK_75_06 = 0x0C;
const ANIM_DISTANT = 0x08;
const ANIM_TROPHY_SINGLES = 0x06;
const ANIM_TROPHY_SMALL = 0x08;
const ActorScript_0f_00 = 0x5665;
const FLAG_AWARDS_CEREMONY_SEEN_DOUBLES = 0x84;
const FLAG_AWARDS_CEREMONY_SEEN_SINGLES = 0x83;
const OBJ_A_COZ = 0x61;
const OBJ_BALLOON_ANGRY = 0x4E;
const OBJ_BALLOON_QUESTION = 0x4D;
const OBJ_B_COZ = 0x62;
const OBJ_TROPHY = 0x74;
const OBJ_WALK_6F_07 = 0x25;
const OBJ_WALK_74_08 = 0x5C;
const SFX_APPEAR1 = 0x99;
const SFX_APPEAR2 = 0x96;
const SFX_EMOTE = 0x98;
const STORYLOC_ACADEMY_WING = 0x06;
const Text_25_126 = 0x287E;
const Text_25_180 = 0x28B4;
const Text_25_185 = 0x28B9;

// the small-character test map: wMapSceneStage is the object def shown as the player (wMapSceneStage2 the count)
// stage's step: n - 1 / n + 1 (below 0: the last; past the count: 0), then clamped as the ROM does: below limit, the
// count (StepDown) or the limit itself (Npc04)
function smallCharTestStep(P, delta, limit, low) {
  const count = P.V.mapSceneStage2;
  let a = (P.V.mapSceneStage + delta) & 0xFF;
  if (a & 0x80) a = (count - 1) & 0xFF;                   // (add a: carry)
  else if (a >= count) a = 0;                             // .checkMax (rra / cp [hl])
  return a >= limit ? a : low(count);                     // .compare
}
// Unused_0f_SmallCharTestStageStepDown (0F:40D0): the previous object def (below $29: the count's)
export function* unusedSmallCharTestStageStepDown(P) {
  yield* smallCharTestApplyStage(P, smallCharTestStep(P, -1, 0x29, count => count));
}
// SmallCharTestApplyStage_0f (0F:40EC) / UnusedSmallCharTestApplyStage_0f (0F:411F, its unreached copy): stage = a,
// the player's sprite that object def
export function* smallCharTestApplyStage(P, a = P.cpu.a) {
  P.V.mapSceneStage = a;
  setPlayerActorObjectDef(P, a);
}
// SmallCharTestNpc03_0f (0F:40F4): the player as object def $26 + (stage & 3); stage + 1
export function* smallCharTestNpc03(P) {
  const a = P.V.mapSceneStage;
  P.V.mapSceneStage = (a + 1) & 0xFF;
  setPlayerActorObjectDef(P, ((a & 0x03) + 0x26) & 0xFF);
}
// SmallCharTestNpc04_0f (0F:4101): the next object def (below $2A: $2A)
export function* smallCharTestNpc04(P) {
  yield* smallCharTestApplyStage(P, smallCharTestStep(P, 1, 0x2A, () => 0x2A));
}
// SmallCharTestNpc05_0f (0F:4127) / SmallCharTestNpc06_0f (0F:412F): the player nods / shakes
export function* smallCharTestNpc05(P) {
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
}

export function* smallCharTestNpc06(P) {
  setAnim(P, ACTOR_PLAYER, ANIM_SHAKE);
}

// MapScriptNop_0f (0F:4137), SmallCharTestTile01_0f (0F:419A), AwardsCeremonyFacing01_0f (0F:44A1): `ret`
export function* mapScriptNop(P) {
}

export function* smallCharTestTile01(P) {
}

// SmallCharTestInitScript_0f (0F:41A4): stage 0, the count of object defs (GetObjectDefCount, bank 4), the button
// frame task
export function* smallCharTestInitScript(P) {
  P.V.mapSceneStage = 0;
  P.V.mapSceneStage2 = P.callRom(...GetObjectDefCount).a;
  registerFrameTask(P, 0x01, SmallCharTestButtonTask_0f);
}
// SmallCharTestButtonTask_0f (0F:41B7), a frame task: a d-pad press: the player's walk animation
export function smallCharTestButtonTask(P) {
  if (!(P.V.inputRisingEdge & 0xF0)) return;
  setAnim(P, ACTOR_PLAYER, ANIM_WALK);
}
// SetPlayerActorObjectDef (0F:41C5): (WRAM 4 mapped) the player's sprite object def a (no def pending); the palettes
// back from the master copy
export function setPlayerActorObjectDef(P, objdef) {
  P.wramBank(WRAM_ACTORS);
  P.V.playerObjDefPending = 0;
  farcall(P, BANK_ACTORS, () => loadActorObjectDef(P, wActors, objdef));
  restorePalettesFromMaster(P);
}

export function* awardsCeremonyFacing01(P) {
}

// AwardsCeremonyTile01_0f (0F:44B3): stepping up to the ceremony: the steps opened, Spike stomps and blocks the
// way; doubles: the pair's stand-ins, Spike's anger at the partner; singles: the friend's; Spike stomps off, the
// party back (doubles: the partner follows; singles: the friend)
export function* awardsCeremonyTile01(P) {
  copyBehaviorRect(P, 0x04, 0x02, 0x0A, 0x1C, 0x0A, 0x1A);   // the stage's steps opened
  yield* cutsceneStompScreenShake(P);
  yield* cutsceneStompScreenShake(P);
  yield* setText(P, Text_25_126);
  yield* speak(P, ACTOR_AWARDS_CEREMONY_SPIKE);
  if (testFlag(P, FLAG_DOUBLES)) {
    setFlag(P, FLAG_AWARDS_CEREMONY_SEEN_DOUBLES);
    yield* setText(P, Text_25_180);
    nullScript(P, ACTOR_PARTNER);
    moveTarget(P, ACTOR_PARTNER, 13.0, 27.0);
    yield* waitMove(P, ACTOR_PARTNER);
    moveTarget(P, ACTOR_PLAYER, 11.0, 27.0);
    yield* waitMove(P, ACTOR_PLAYER);
    replacePlayerWithStandInActor(P);
    setPosition(P, ACTOR_AWARDS_CEREMONY_ALEX, 11.0, 27.0);
    loadObjdef(P, ACTOR_AWARDS_CEREMONY_BALLOON_QUESTION, (P.V.storyModeGenderOfPartnerCharacter + OBJ_HARRY_B) & 0xFF);
    setPosition(P, ACTOR_PARTNER, 63.0, 63.0);
    setPosition(P, ACTOR_AWARDS_CEREMONY_BALLOON_QUESTION, 13.0, 27.0);
    face(P, ACTOR_AWARDS_CEREMONY_ALEX, FACE_DOWN);
    face(P, ACTOR_AWARDS_CEREMONY_BALLOON_QUESTION, FACE_DOWN);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_SPIKE, 12.0, 29.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_SPIKE);
    face(P, ACTOR_AWARDS_CEREMONY_SPIKE, FACE_UP);
    setPosition(P, ACTOR_AWARDS_CEREMONY_BALLOON_ANGRY, 13.5, 27.0);
    sound(P, SFX_APPEAR1);
    yield* speak(P, ACTOR_AWARDS_CEREMONY_SPIKE);
    setPosition(P, ACTOR_AWARDS_CEREMONY_BALLOON_ANGRY, 63.0, 63.0);
    setAnim(P, ACTOR_AWARDS_CEREMONY_SPIKE, ANIM_BOUNCE);
    yield* waitIdle(P, ACTOR_AWARDS_CEREMONY_SPIKE);
    yield* speak(P, ACTOR_AWARDS_CEREMONY_SPIKE);
    setPosition(P, ACTOR_AWARDS_CEREMONY_BALLOON_SWEAT, 12.5, 25.0);
    sound(P, SFX_APPEAR2);
    yield* delayFrames(P, 120);
    setPosition(P, ACTOR_AWARDS_CEREMONY_BALLOON_SWEAT, 63.0, 63.0);
  } else {                                             // (.doubles: singles)
    setFlag(P, FLAG_AWARDS_CEREMONY_SEEN_SINGLES);
    nullScript(P, ACTOR_AWARDS_CEREMONY_WALK_74_08);
    moveTarget(P, ACTOR_PLAYER, 11.5, 27.0);
    yield* waitMove(P, ACTOR_PLAYER);
    replacePlayerWithStandInActor(P);
    setPosition(P, ACTOR_AWARDS_CEREMONY_ALEX, 11.5, 27.0);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_74_08, 13.0, 29.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_74_08);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_74_08, FACE_LEFT);
    yield* delayFrames(P, 1);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_SPIKE, 11.0, 29.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_SPIKE);
    face(P, ACTOR_AWARDS_CEREMONY_ALEX, FACE_DOWN);
    face(P, ACTOR_AWARDS_CEREMONY_SPIKE, FACE_UP);
    setPosition(P, ACTOR_AWARDS_CEREMONY_BALLOON_ANGRY, 12.5, 27.0);
    sound(P, SFX_APPEAR1);
    yield* speak(P, ACTOR_AWARDS_CEREMONY_SPIKE);
    setPosition(P, ACTOR_AWARDS_CEREMONY_BALLOON_ANGRY, 63.0, 63.0);
    setAnim(P, ACTOR_AWARDS_CEREMONY_SPIKE, ANIM_BOUNCE);
    yield* waitIdle(P, ACTOR_AWARDS_CEREMONY_SPIKE);
    yield* speak(P, ACTOR_AWARDS_CEREMONY_SPIKE);
    setPosition(P, ACTOR_AWARDS_CEREMONY_BALLOON_SWEAT, 13.0, 25.0);
    sound(P, SFX_APPEAR2);
    yield* delayFrames(P, 120);
    setPosition(P, ACTOR_AWARDS_CEREMONY_BALLOON_SWEAT, 63.0, 63.0);
  }
  yield* cutsceneStompScreenShake(P);
  yield* cutsceneStompScreenShake(P);
  yield* speak(P, ACTOR_AWARDS_CEREMONY_SPIKE);
  yield* cutsceneStompScreenShake(P);
  yield* cutsceneStompScreenShake(P);
  moveTarget(P, ACTOR_AWARDS_CEREMONY_SPIKE, 9.0, 29.0);
  yield* waitMove(P, ACTOR_AWARDS_CEREMONY_SPIKE);
  face(P, ACTOR_AWARDS_CEREMONY_SPIKE, FACE_RIGHT);
  yield* delayFrames(P, 1);
  setPosition(P, ACTOR_AWARDS_CEREMONY_ALEX, 63.0, 63.0);
  if (testFlag(P, FLAG_DOUBLES)) {
    setPosition(P, ACTOR_AWARDS_CEREMONY_BALLOON_QUESTION, 63.0, 63.0);
    setObjdef(P, OBJ_BALLOON_QUESTION, ACTOR_AWARDS_CEREMONY_BALLOON_QUESTION);
    setAnim(P, ACTOR_AWARDS_CEREMONY_BALLOON_QUESTION, ANIM_WALK);
    face(P, ACTOR_PLAYER, FACE_DOWN);
    setPosition(P, ACTOR_PLAYER, 11.0, 27.0);
    setPosition(P, ACTOR_PARTNER, 13.0, 27.0);
    yield* delayFrames(P, 1);
    face(P, ACTOR_PLAYER, FACE_DOWN);
    face(P, ACTOR_PARTNER, FACE_DOWN);
    yield* delayFrames(P, 1);
    followPlayer(P, ACTOR_PARTNER);
  } else {                                             // .done
    setPosition(P, ACTOR_PLAYER, 11.5, 27.0);
    face(P, ACTOR_PLAYER, FACE_DOWN);
    yield* delayFrames(P, 1);
    followPlayer(P, ACTOR_AWARDS_CEREMONY_WALK_74_08);
  }
}

// AwardsCeremonyTile02_0f (0F:4725): the podium: the winners called up (singles: the player, the friend, A Coz;
// doubles: the pairs), the chairman's speech, the trophies handed over one by one, the winner's pose; the
// ceremony's screens, then the academy wing (entry $0F)
export function* awardsCeremonyTile02(P) {
  if (!testFlag(P, FLAG_DOUBLES)) {
    nullScript(P, ACTOR_AWARDS_CEREMONY_WALK_74_08);
    moveTarget(P, ACTOR_PLAYER, 12.0, 25.0);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_74_08, 12.0, 27.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_74_08);
    yield* delayFrames(P, 10);
    faceToward(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_1, ACTOR_PLAYER);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_74_08, FACE_UP);
    yield* delayFrames(P, 60);
    yield* announceWinnersToPodiums(P);
    face(P, ACTOR_PLAYER, FACE_DOWN);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_A_COZ, 12.0, 29.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_A_COZ);
    yield* delayFrames(P, 10);
    faceAwardsCeremonyCrowdUp(P);
    setSpeed(P, ACTOR_PLAYER, 1.0);
    setSpeed(P, ACTOR_AWARDS_CEREMONY_WALK_74_08, 1.0);
    setSpeed(P, ACTOR_AWARDS_CEREMONY_A_COZ, 1.0);
    setActorScript(P, ACTOR_PLAYER, ActorScript_0f_00);
    setActorScript(P, ACTOR_AWARDS_CEREMONY_WALK_74_08, ActorScript_0f_00);
    setActorScript(P, ACTOR_AWARDS_CEREMONY_A_COZ, ActorScript_0f_00);
    yield* delayFrames(P, 180);
    setPosition(P, ACTOR_PLAYER, 12.0, 13.25);
    setPosition(P, ACTOR_AWARDS_CEREMONY_WALK_74_08, 14.0, 14.25);
    setPosition(P, ACTOR_AWARDS_CEREMONY_A_COZ, 10.0, 13.75);
    replacePlayerWithStandInActor(P);
    setPosition(P, ACTOR_AWARDS_CEREMONY_ALEX, 12.0, 13.25);
    face(P, ACTOR_AWARDS_CEREMONY_ALEX, FACE_DOWN);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_74_08, FACE_DOWN);
    face(P, ACTOR_AWARDS_CEREMONY_A_COZ, FACE_DOWN);
    playerSpeed(P, 0.1875);
    yield* movePlayer(P, 12.0, 19.0);
    yield* waitPlayerMove(P);
    yield* awardsCeremonyChairmanSpeech(P);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 14.0, 19.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, FACE_UP);
    setSpeed(P, ACTOR_AWARDS_CEREMONY_TROPHY_3, 0.5);
    setSpeed(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 0.5);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 17.0, 22.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, FACE_DOWN);
    yield* delayFrames(P, 20);
    setPosition(P, ACTOR_AWARDS_CEREMONY_TROPHY_3, 17.5, 22.0);
    yield* delayFrames(P, 20);
    yield* awardsCeremonySwapActors(P);
    setObjdef(P, OBJ_WALK_74_08, ACTOR_AWARDS_CEREMONY_WALK_74_07);
    setAnim(P, ACTOR_AWARDS_CEREMONY_WALK_74_07, ANIM_WALK);
    setPosition(P, ACTOR_AWARDS_CEREMONY_WALK_74_08, 63.0, 63.0);
    setPosition(P, ACTOR_AWARDS_CEREMONY_WALK_74_07, 14.0, 14.25);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_74_07, FACE_DOWN);
    setSpeed(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 0.5);
    setSpeed(P, ACTOR_AWARDS_CEREMONY_TROPHY_3, 0.5);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 14.0, 17.0);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_TROPHY_3, 14.0, 16.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_TROPHY_3);
    yield* delayFrames(P, 30);
    yield* speak(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    yield* delayFrames(P, 30);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 14.0, 16.25);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_TROPHY_3, 14.0, 15.25);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_TROPHY_3);
    yield* delayFrames(P, 5);
    lockFacing(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 14.0, 17.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    unlockFacing(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, FACE_UP);
    yield* delayFrames(P, 20);
    setPosition(P, ACTOR_AWARDS_CEREMONY_TROPHY_3, 63.0, 63.0);
    setAnim(P, ACTOR_AWARDS_CEREMONY_WALK_74_07, ANIM_BOUNCE);
    yield* waitIdle(P, ACTOR_AWARDS_CEREMONY_WALK_74_07);
    yield* speak(P, ACTOR_AWARDS_CEREMONY_WALK_74_07);
    setPosition(P, ACTOR_AWARDS_CEREMONY_BALLOON_QUESTION, 15.5, 15.5);
    sound(P, SFX_EMOTE);
    yield* delayFrames(P, 120);
    setPosition(P, ACTOR_AWARDS_CEREMONY_BALLOON_QUESTION, 63.0, 63.0);
    setAnim(P, ACTOR_AWARDS_CEREMONY_WALK_74_07, ANIM_SHAKE);
    yield* waitIdle(P, ACTOR_AWARDS_CEREMONY_WALK_74_07);
    yield* speak(P, ACTOR_AWARDS_CEREMONY_WALK_74_07);
    P.bus.w8((actorState(P, ACTOR_AWARDS_CEREMONY_ALEX) + ACTOR_RECORD_BYTE_18) & 0xFFFF, 0x01);
    P.bus.w8((actorState(P, ACTOR_AWARDS_CEREMONY_WALK_75_06) + ACTOR_RECORD_BYTE_18) & 0xFFFF, 0x01);
    setAnim(P, ACTOR_AWARDS_CEREMONY_ALEX, ANIM_BOUNCE);
    yield* waitIdle(P, ACTOR_AWARDS_CEREMONY_ALEX);
    setAnim(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, ANIM_NOD);
    yield* waitIdle(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    yield* speak(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    yield* delayFrames(P, 30);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 14.0, 19.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 10.0, 19.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, FACE_UP);
    yield* delayFrames(P, 20);
    setSpeed(P, ACTOR_AWARDS_CEREMONY_TROPHY_2, 0.5);
    setSpeed(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 0.5);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 16.0, 22.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, FACE_DOWN);
    yield* delayFrames(P, 20);
    setPosition(P, ACTOR_AWARDS_CEREMONY_TROPHY_2, 16.5, 22.0);
    yield* delayFrames(P, 20);
    setObjdef(P, OBJ_TROPHY, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2);
    setAnim(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, ANIM_WALK);
    setObjdef(P, OBJ_WALK_6F_07, ACTOR_AWARDS_CEREMONY_TROPHY_2);
    setAnim(P, ACTOR_AWARDS_CEREMONY_TROPHY_2, ANIM_WALK);
    setPosition(P, ACTOR_AWARDS_CEREMONY_TROPHY_2, 16.0, 22.0);
    setPosition(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 16.0, 21.0);
    face(P, ACTOR_AWARDS_CEREMONY_TROPHY_2, FACE_UP);
    setAnim(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, ANIM_TROPHY_SMALL);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 16.0, 18.0);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_TROPHY_2, 16.0, 19.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_TROPHY_2);
    setObjdef(P, OBJ_WALK_6F_07, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2);
    setAnim(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, ANIM_WALK);
    setObjdef(P, OBJ_TROPHY, ACTOR_AWARDS_CEREMONY_TROPHY_2);
    setAnim(P, ACTOR_AWARDS_CEREMONY_TROPHY_2, ANIM_WALK);
    setPosition(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 16.0, 19.0);
    setPosition(P, ACTOR_AWARDS_CEREMONY_TROPHY_2, 15.0, 19.0);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, FACE_LEFT);
    setAnim(P, ACTOR_AWARDS_CEREMONY_TROPHY_2, ANIM_TROPHY_SMALL);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 12.0, 19.0);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_TROPHY_2, 11.0, 19.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_TROPHY_2);
    lockFacing(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 14.0, 19.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2);
    unlockFacing(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2);
    setSpeed(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 1.0);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 16.0, 22.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, FACE_UP);
    setObjdef(P, OBJ_A_COZ, ACTOR_AWARDS_CEREMONY_WALK_74_06);
    setAnim(P, ACTOR_AWARDS_CEREMONY_WALK_74_06, ANIM_WALK);
    setPosition(P, ACTOR_AWARDS_CEREMONY_A_COZ, 63.0, 63.0);
    setPosition(P, ACTOR_AWARDS_CEREMONY_WALK_74_06, 10.0, 13.75);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_74_06, FACE_DOWN);
    setSpeed(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 0.5);
    setSpeed(P, ACTOR_AWARDS_CEREMONY_TROPHY_2, 0.5);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 10.0, 17.0);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_TROPHY_2, 10.0, 16.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_TROPHY_2);
    yield* delayFrames(P, 30);
    yield* speak(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    yield* delayFrames(P, 30);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 10.0, 15.75);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_TROPHY_2, 10.0, 14.75);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_TROPHY_2);
    yield* delayFrames(P, 5);
    setAnim(P, ACTOR_AWARDS_CEREMONY_WALK_74_06, ANIM_BOUNCE);
    yield* waitIdle(P, ACTOR_AWARDS_CEREMONY_WALK_74_06);
    lockFacing(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 10.0, 17.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    unlockFacing(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, FACE_UP);
    yield* delayFrames(P, 20);
    setPosition(P, ACTOR_AWARDS_CEREMONY_TROPHY_2, 63.0, 63.0);
    setPosition(P, ACTOR_AWARDS_CEREMONY_BALLOON_ANGRY, 11.5, 12.25);
    sound(P, SFX_APPEAR1);
    yield* speak(P, ACTOR_AWARDS_CEREMONY_WALK_74_06);
    setPosition(P, ACTOR_AWARDS_CEREMONY_BALLOON_ANGRY, 63.0, 63.0);
    setPosition(P, ACTOR_AWARDS_CEREMONY_BALLOON_QUESTION, 11.5, 15.5);
    sound(P, SFX_EMOTE);
    yield* delayFrames(P, 120);
    setPosition(P, ACTOR_AWARDS_CEREMONY_BALLOON_QUESTION, 63.0, 63.0);
    setAnim(P, ACTOR_AWARDS_CEREMONY_WALK_74_06, ANIM_SHAKE);
    yield* waitIdle(P, ACTOR_AWARDS_CEREMONY_WALK_74_06);
    yield* speak(P, ACTOR_AWARDS_CEREMONY_WALK_74_06);
    setAnim(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, ANIM_NOD);
    yield* waitIdle(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    yield* speak(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    yield* delayFrames(P, 30);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 10.0, 19.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 12.0, 19.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, FACE_UP);
    setSpeed(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, 0.5);
    setSpeed(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 0.5);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 15.0, 22.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, FACE_DOWN);
    yield* delayFrames(P, 20);
    setPosition(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, 15.5, 22.0);
    yield* delayFrames(P, 20);
    setObjdef(P, OBJ_TROPHY, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2);
    setAnim(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, ANIM_WALK);
    setObjdef(P, OBJ_WALK_6F_07, ACTOR_AWARDS_CEREMONY_TROPHY_1);
    setAnim(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, ANIM_WALK);
    setPosition(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, 15.0, 22.0);
    setPosition(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 15.0, 21.0);
    face(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, FACE_UP);
    setAnim(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, ANIM_TROPHY_SINGLES);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 15.0, 18.0);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, 15.0, 19.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_TROPHY_1);
    setObjdef(P, OBJ_WALK_6F_07, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2);
    setAnim(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, ANIM_WALK);
    setObjdef(P, OBJ_TROPHY, ACTOR_AWARDS_CEREMONY_TROPHY_1);
    setAnim(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, ANIM_WALK);
    setPosition(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 15.0, 19.0);
    setPosition(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, 14.0, 19.0);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, FACE_LEFT);
    setAnim(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, ANIM_TROPHY_SINGLES);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 14.0, 19.0);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, 13.0, 19.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_TROPHY_1);
    lockFacing(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 15.0, 19.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2);
    unlockFacing(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2);
    setSpeed(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 1.0);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 15.0, 22.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, FACE_UP);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 12.0, 17.0);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, 12.0, 16.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_TROPHY_1);
    yield* speak(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    yield* delayFrames(P, 20);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 12.0, 15.5);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, 12.0, 14.25);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_TROPHY_1);
    lockFacing(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 12.0, 17.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    unlockFacing(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, FACE_UP);
    setAnim(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_1, ANIM_BOUNCE);
    yield* waitIdle(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_1);
    yield* speak(P, ACTOR_AWARDS_CEREMONY_ALEX);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_74_07, FACE_LEFT);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_74_06, FACE_RIGHT);
    yield* delayFrames(P, 60);
    loadObjdef(P, ACTOR_AWARDS_CEREMONY_ALEX, (P.V.storyModeGenderOfMainCharacter + OBJ_ALEX) & 0xFF);
    face(P, ACTOR_AWARDS_CEREMONY_ALEX, FACE_RIGHT);
    setAnim(P, ACTOR_AWARDS_CEREMONY_ALEX, ANIM_DISTANT);
    setPosition(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, 11.25, 12.25);
    yield* movePlayer(P, 12.0, 13.0);
    yield* waitPlayerMove(P);
    yield* delayFrames(P, 180);
    yield* fadeOutAndWait(P, 1);
    yield* P.runRom(...RunStorySceneByMode, { b: SCENE_MODE_CEREMONY, c: (P.V.storyModeGenderOfMainCharacter + 0x04) & 0xFF });
    goToLocation(P, STORYLOC_ACADEMY_WING, 0x0F);
  } else {                                             // .doubles
    nullScript(P, ACTOR_PARTNER);
    moveTarget(P, ACTOR_PLAYER, 12.0, 25.0);
    moveTarget(P, ACTOR_PARTNER, 12.0, 27.0);
    yield* waitMove(P, ACTOR_PARTNER);
    yield* delayFrames(P, 10);
    faceToward(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_1, ACTOR_PLAYER);
    face(P, ACTOR_PARTNER, FACE_UP);
    yield* delayFrames(P, 60);
    yield* announceWinnersToPodiums(P);
    face(P, ACTOR_PLAYER, FACE_DOWN);
    attachStepMover(P, actorState(P, ACTOR_AWARDS_CEREMONY_B_COZ), actorState(P, ACTOR_AWARDS_CEREMONY_A_COZ));   // B Coz follows A
    moveTarget(P, ACTOR_AWARDS_CEREMONY_A_COZ, 12.0, 29.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_A_COZ);
    yield* delayFrames(P, 10);
    nullScript(P, ACTOR_AWARDS_CEREMONY_B_COZ);
    faceAwardsCeremonyCrowdUp(P);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_74_08, FACE_UP);
    setSpeed(P, ACTOR_PLAYER, 1.0);
    setSpeed(P, ACTOR_PARTNER, 1.0);
    setSpeed(P, ACTOR_AWARDS_CEREMONY_A_COZ, 1.0);
    setSpeed(P, ACTOR_AWARDS_CEREMONY_B_COZ, 1.0);
    setActorScript(P, ACTOR_PLAYER, ActorScript_0f_00);
    setActorScript(P, ACTOR_PARTNER, ActorScript_0f_00);
    setActorScript(P, ACTOR_AWARDS_CEREMONY_A_COZ, ActorScript_0f_00);
    setActorScript(P, ACTOR_AWARDS_CEREMONY_B_COZ, ActorScript_0f_00);
    yield* delayFrames(P, 180);
    replacePlayerWithStandInActor(P);
    setPosition(P, ACTOR_AWARDS_CEREMONY_ALEX, 13.0, 13.375);
    loadObjdef(P, ACTOR_AWARDS_CEREMONY_WALK_74_07, (P.V.storyModeGenderOfPartnerCharacter + OBJ_HARRY_B) & 0xFF);
    setPosition(P, ACTOR_PARTNER, 63.0, 63.0);
    setPosition(P, ACTOR_AWARDS_CEREMONY_WALK_74_07, 15.0, 13.375);
    setObjdef(P, OBJ_A_COZ, ACTOR_AWARDS_CEREMONY_BALLOON_ANGRY);
    setAnim(P, ACTOR_AWARDS_CEREMONY_BALLOON_ANGRY, ANIM_WALK);
    setObjdef(P, OBJ_B_COZ, ACTOR_AWARDS_CEREMONY_BALLOON_QUESTION);
    setAnim(P, ACTOR_AWARDS_CEREMONY_BALLOON_QUESTION, ANIM_WALK);
    setPosition(P, ACTOR_AWARDS_CEREMONY_A_COZ, 63.0, 63.0);
    setPosition(P, ACTOR_AWARDS_CEREMONY_B_COZ, 63.0, 63.0);
    setPosition(P, ACTOR_AWARDS_CEREMONY_BALLOON_ANGRY, 11.0, 14.0);
    setPosition(P, ACTOR_AWARDS_CEREMONY_BALLOON_QUESTION, 9.0, 14.0);
    setObjdef(P, OBJ_BALLOON_ANGRY, ACTOR_AWARDS_CEREMONY_A_COZ);
    setAnim(P, ACTOR_AWARDS_CEREMONY_A_COZ, ANIM_WALK);
    setObjdef(P, OBJ_BALLOON_QUESTION, ACTOR_AWARDS_CEREMONY_B_COZ);
    setAnim(P, ACTOR_AWARDS_CEREMONY_B_COZ, ANIM_WALK);
    face(P, ACTOR_AWARDS_CEREMONY_ALEX, FACE_DOWN);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_74_07, FACE_DOWN);
    face(P, ACTOR_AWARDS_CEREMONY_BALLOON_ANGRY, FACE_DOWN);
    face(P, ACTOR_AWARDS_CEREMONY_BALLOON_QUESTION, FACE_DOWN);
    playerSpeed(P, 0.1875);
    yield* movePlayer(P, 12.0, 19.0);
    yield* waitPlayerMove(P);
    yield* awardsCeremonyChairmanSpeech(P);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 10.0, 19.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, FACE_UP);
    setSpeed(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 0.5);
    setSpeed(P, ACTOR_AWARDS_CEREMONY_WALK_6F_06, 0.5);
    setSpeed(P, ACTOR_AWARDS_CEREMONY_TROPHY_3, 0.5);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 17.0, 22.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, FACE_DOWN);
    yield* delayFrames(P, 20);
    setPosition(P, ACTOR_AWARDS_CEREMONY_TROPHY_2, 63.0, 63.0);
    setPosition(P, ACTOR_AWARDS_CEREMONY_TROPHY_3, 17.0, 22.0);
    yield* delayFrames(P, 20);
    setObjdef(P, OBJ_WALK_6F_07, ACTOR_AWARDS_CEREMONY_WALK_6F_06);
    setAnim(P, ACTOR_AWARDS_CEREMONY_WALK_6F_06, ANIM_WALK);
    setPosition(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 63.0, 63.0);
    setPosition(P, ACTOR_AWARDS_CEREMONY_WALK_6F_06, 17.0, 22.0);
    setPosition(P, ACTOR_AWARDS_CEREMONY_TROPHY_3, 17.0, 21.0);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_6F_06, FACE_UP);
    setAnim(P, ACTOR_AWARDS_CEREMONY_TROPHY_3, ANIM_TROPHY_SMALL);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_TROPHY_3, 17.0, 18.0);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_6F_06, 17.0, 19.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_6F_06);
    setPosition(P, ACTOR_AWARDS_CEREMONY_WALK_6F_06, 63.0, 63.0);
    setPosition(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 17.0, 19.0);
    setPosition(P, ACTOR_AWARDS_CEREMONY_TROPHY_3, 16.0, 19.0);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, FACE_LEFT);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 12.0, 19.0);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_TROPHY_3, 11.0, 19.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_TROPHY_3);
    lockFacing(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 15.0, 19.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2);
    unlockFacing(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 17.0, 22.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, FACE_UP);
    yield* setText(P, Text_25_185);
    setSpeed(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 0.5);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 10.0, 17.0);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_TROPHY_3, 10.0, 16.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_TROPHY_3);
    yield* delayFrames(P, 30);
    yield* speak(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    yield* delayFrames(P, 30);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 10.0, 16.0);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_TROPHY_3, 10.0, 15.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_TROPHY_3);
    yield* delayFrames(P, 5);
    setAnim(P, ACTOR_AWARDS_CEREMONY_BALLOON_ANGRY, ANIM_BOUNCE);
    yield* waitIdle(P, ACTOR_AWARDS_CEREMONY_BALLOON_ANGRY);
    lockFacing(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 10.0, 17.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    unlockFacing(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, FACE_UP);
    yield* delayFrames(P, 50);
    setPosition(P, ACTOR_AWARDS_CEREMONY_TROPHY_3, 63.0, 63.0);
    setPosition(P, ACTOR_AWARDS_CEREMONY_A_COZ, 12.5, 12.5);
    sound(P, SFX_APPEAR1);
    yield* delayFrames(P, 80);
    setPosition(P, ACTOR_AWARDS_CEREMONY_A_COZ, 63.0, 63.0);
    yield* speak(P, ACTOR_AWARDS_CEREMONY_BALLOON_ANGRY);
    setAnim(P, ACTOR_AWARDS_CEREMONY_BALLOON_QUESTION, ANIM_BOUNCE);
    yield* waitIdle(P, ACTOR_AWARDS_CEREMONY_BALLOON_QUESTION);
    yield* speak(P, ACTOR_AWARDS_CEREMONY_BALLOON_QUESTION);
    setPosition(P, ACTOR_AWARDS_CEREMONY_B_COZ, 11.5, 15.5);
    sound(P, SFX_EMOTE);
    yield* delayFrames(P, 120);
    setPosition(P, ACTOR_AWARDS_CEREMONY_B_COZ, 63.0, 63.0);
    setAnim(P, ACTOR_AWARDS_CEREMONY_BALLOON_ANGRY, ANIM_SHAKE);
    yield* waitIdle(P, ACTOR_AWARDS_CEREMONY_BALLOON_ANGRY);
    yield* speak(P, ACTOR_AWARDS_CEREMONY_BALLOON_ANGRY);
    setAnim(P, ACTOR_AWARDS_CEREMONY_ALEX, ANIM_BOUNCE);
    setAnim(P, ACTOR_AWARDS_CEREMONY_WALK_74_07, ANIM_BOUNCE);
    yield* waitIdle(P, ACTOR_AWARDS_CEREMONY_WALK_74_07);
    face(P, ACTOR_AWARDS_CEREMONY_ALEX, FACE_LEFT);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_74_07, FACE_LEFT);
    yield* delayFrames(P, 60);
    face(P, ACTOR_AWARDS_CEREMONY_ALEX, FACE_DOWN);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_74_07, FACE_DOWN);
    setAnim(P, ACTOR_AWARDS_CEREMONY_BALLOON_QUESTION, ANIM_BOUNCE);
    yield* waitIdle(P, ACTOR_AWARDS_CEREMONY_BALLOON_QUESTION);
    yield* speak(P, ACTOR_AWARDS_CEREMONY_BALLOON_QUESTION);
    setAnim(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, ANIM_NOD);
    yield* waitIdle(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    yield* speak(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    yield* delayFrames(P, 30);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 10.0, 19.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 14.0, 19.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, FACE_UP);
    yield* delayFrames(P, 20);
    setSpeed(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, 0.5);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 15.0, 22.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, FACE_DOWN);
    yield* delayFrames(P, 20);
    setPosition(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, 15.5, 22.0);
    yield* delayFrames(P, 20);
    setPosition(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 63.0, 63.0);
    setPosition(P, ACTOR_AWARDS_CEREMONY_WALK_6F_06, 15.0, 22.0);
    setPosition(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, 15.0, 21.0);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_6F_06, FACE_UP);
    setAnim(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, ANIM_TROPHY_SMALL);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, 15.0, 19.0);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_6F_06, 15.0, 20.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_6F_06);
    setPosition(P, ACTOR_AWARDS_CEREMONY_WALK_6F_06, 63.0, 63.0);
    setPosition(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 15.0, 20.0);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, FACE_UP);
    lockFacing(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, 15.0, 22.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2);
    unlockFacing(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_2, FACE_UP);
    setPosition(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, 14.75, 19.0);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 15.0, 19.0);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, 15.75, 19.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_TROPHY_1);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 15.0, 17.0);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, 15.75, 17.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_TROPHY_1);
    yield* delayFrames(P, 30);
    yield* speak(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    yield* delayFrames(P, 10);
    setAnim(P, ACTOR_AWARDS_CEREMONY_WALK_74_07, ANIM_NOD);
    yield* waitIdle(P, ACTOR_AWARDS_CEREMONY_WALK_74_07);
    yield* speak(P, ACTOR_AWARDS_CEREMONY_WALK_74_07);
    yield* delayFrames(P, 20);
    setPosition(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, 14.25, 17.0);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 13.0, 17.0);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, 12.25, 17.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_TROPHY_1);
    yield* delayFrames(P, 4);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, FACE_UP);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, 13.0, 16.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_TROPHY_1);
    yield* delayFrames(P, 20);
    yield* speak(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    yield* delayFrames(P, 30);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 13.0, 16.0);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, 13.0, 14.5);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_TROPHY_1);
    yield* delayFrames(P, 5);
    lockFacing(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    moveTarget(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, 13.0, 17.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    unlockFacing(P, ACTOR_AWARDS_CEREMONY_WALK_75_06);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_75_06, FACE_UP);
    setAnim(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_1, ANIM_BOUNCE);
    yield* waitIdle(P, ACTOR_AWARDS_CEREMONY_WALK_6F_07_1);
    yield* speak(P, ACTOR_AWARDS_CEREMONY_ALEX);
    setAnim(P, ACTOR_AWARDS_CEREMONY_ALEX, ANIM_NOD);
    setAnim(P, ACTOR_AWARDS_CEREMONY_WALK_74_07, ANIM_NOD);
    yield* waitIdle(P, ACTOR_AWARDS_CEREMONY_WALK_74_07);
    yield* speak(P, ACTOR_AWARDS_CEREMONY_ALEX);
    face(P, ACTOR_AWARDS_CEREMONY_WALK_74_07, FACE_LEFT);
    face(P, ACTOR_AWARDS_CEREMONY_BALLOON_ANGRY, FACE_RIGHT);
    face(P, ACTOR_AWARDS_CEREMONY_BALLOON_QUESTION, FACE_RIGHT);
    yield* delayFrames(P, 60);
    loadObjdef(P, ACTOR_AWARDS_CEREMONY_ALEX, (P.V.storyModeGenderOfMainCharacter + OBJ_ALEX) & 0xFF);
    face(P, ACTOR_AWARDS_CEREMONY_ALEX, FACE_RIGHT);
    setAnim(P, ACTOR_AWARDS_CEREMONY_ALEX, ANIM_DISTANT);
    setPosition(P, ACTOR_AWARDS_CEREMONY_TROPHY_1, 12.25, 12.375);
    yield* movePlayer(P, 12.0, 13.0);
    yield* waitPlayerMove(P);
    yield* delayFrames(P, 180);
    yield* fadeOutAndWait(P, 1);
    const main = P.V.storyModeGenderOfMainCharacter, c = ((main << 1) | (P.V.storyModeGenderOfPartnerCharacter ^ main)) & 0xFF;
    yield* P.runRom(...RunStorySceneByMode, { b: SCENE_MODE_CEREMONY, c, d: main });
    goToLocation(P, STORYLOC_ACADEMY_WING, 0x0F);
  }
}

// AwardsCeremonyInitScript_0f (0F:5581): doubles: its actors, NPC scripts and scene cells (in cutscene mode);
// the trophies' animations; the court sprites; entries $0A / $0B the ceremonies; seen once: Spike aside and the
// steps open; singles: the friend at the player's place, following
export function* awardsCeremonyInitScript(P) {
  if (testFlag(P, FLAG_DOUBLES)) {
    respawnActors(P, AwardsCeremonyActorsDoubles_0f);
    setNpcScripts(P, AwardsCeremonyNpcScriptsDoubles_0f);
    yield* copySceneRect(P, 26, 13, 8, 13, 8, 3);
    beginCutscene(P);
  }
  setAnim(P, ACTOR_AWARDS_CEREMONY_DOUBLES_TROPHY_2, ANIM_TROPHY_SMALL);
  setAnim(P, ACTOR_AWARDS_CEREMONY_DOUBLES_TROPHY_3, ANIM_TROPHY_SMALL);
  if (!testFlag(P, FLAG_DOUBLES)) {
    setAnim(P, ACTOR_AWARDS_CEREMONY_DOUBLES_TROPHY_1, ANIM_TROPHY_SINGLES);
  }
  setPlayerAndPartnerObjectDefs(P);                       // .setObjectDefs
  const entry = P.V.storyModeEntryPoint;
  if (entry === 0x0A) return yield* awardsCeremonyEntry0aScene(P);
  if (entry === 0x0B) return yield* awardsCeremonyEntry0bScene(P);
  if (checkAwardsCeremonyRivalSceneDone(P).a & 0x01) {    // seen: Spike aside, the steps open
    moveTarget(P, ACTOR_AWARDS_CEREMONY_DOUBLES_SPIKE, 9.0, 29.0);
    yield* waitMove(P, ACTOR_AWARDS_CEREMONY_DOUBLES_SPIKE);
    face(P, ACTOR_AWARDS_CEREMONY_DOUBLES_SPIKE, FACE_RIGHT);
    copyBehaviorRect(P, 0x04, 0x02, 0x0A, 0x1C, 0x0A, 0x1A);
  }
  if (testFlag(P, FLAG_DOUBLES)) return;                  // .checkDoubles
  savePlayerActorPosition(P);                             // the friend (actor 3) at the player's place, following
  setPositionRaw(P, ACTOR_AWARDS_CEREMONY_DOUBLES_WALK_74_08, P.bus.u16(P.A.mapScratch), P.bus.u16((P.A.mapScratch + 2) & 0xFFFF));
  followPlayer(P, ACTOR_AWARDS_CEREMONY_DOUBLES_WALK_74_08);
}

export const HOOKS = [
  // (the test map's handlers: their registers are read by no caller, and put back as at the call)
  scene(BANK, 0x40D0, unusedSmallCharTestStageStepDown),
  scene(BANK, 0x40EC, smallCharTestApplyStage),
  scene(BANK, 0x40F4, smallCharTestNpc03),
  scene(BANK, 0x4101, smallCharTestNpc04),
  scene(BANK, 0x411F, smallCharTestApplyStage),
  scene(BANK, 0x4127, smallCharTestNpc05),
  scene(BANK, 0x412F, smallCharTestNpc06),
  scene(BANK, 0x4137, mapScriptNop),
  scene(BANK, 0x419A, smallCharTestTile01),
  scene(BANK, 0x41A4, smallCharTestInitScript),
  scene(BANK, 0x41B7, function* (P) { smallCharTestButtonTask(P); }),
  scene(BANK, 0x41C5, function* (P) { setPlayerActorObjectDef(P, P.cpu.a); }),
  scene(BANK, 0x44A1, awardsCeremonyFacing01),
  scene(BANK, 0x44B3, awardsCeremonyTile01),
  scene(BANK, 0x4725, awardsCeremonyTile02),
  scene(BANK, 0x5581, awardsCeremonyInitScript),
];
