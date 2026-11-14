// The ending's tournament scenes (bank $27, $4018-$4B8B): End17, the award ceremony seen in the credits (the
// trophy carried up and handed over, singles or doubles, the champion's sprite walking off small), and End16,
// before the finals (the party and A. Coz meet the referees and walk out to the court). The location tables, actor
// lists and actor scripts are data.
// Port of src/story/ending_finals_27.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/cs_credits.mtrec, cs_epilogue.mtrec (the ending), out/port/ss1_end*.mtrec (scripted).
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FACE_DOWN, FACE_LEFT, FACE_RIGHT, FACE_UP, ANIM_NOD, ANIM_BOUNCE, FLAG_DOUBLES,
  testFlag, setAnim, gesture, face, facePair, setPosition, moveTarget, waitMove, setSpeed, playerSpeed,
  movePlayer, waitPlayerMove, lockFacing, unlockFacing, nullScript, setActorScript, waitActorScript, wait,
  copySceneRect, fadeInAndWait, respawnActors, beginCutscene, requestExit, hook, scene,
} from "./common.js";
import { loadObjdef, OBJ_ALEX_B, OBJ_HARRY_B } from "./twins.js";
import { waitScriptFramesSaveA as delay } from "./actor_27.js";

const BANK = 0x27;
const ACTOR_END17_AWARD_CEREMONY_ALT_WALK_6F_07_1 = 0x03, ACTOR_END17_AWARD_CEREMONY_ALT_WALK_75_06 = 0x04;
const ACTOR_END17_AWARD_CEREMONY_ALT_TROPHY = 0x05, ACTOR_END17_AWARD_CEREMONY_ALT_WALK_6F_07_2 = 0x06;
const ACTOR_END17_AWARD_CEREMONY_ALT_07 = 0x07;          // (script_face $07: the list's actor 7)
const ACTOR_END17_AWARD_CEREMONY_ALT_A_COZ = 0x08, ACTOR_END17_AWARD_CEREMONY_ALT_ALEX = 0x09;
const ACTOR_END17_AWARD_CEREMONY_ALT_WALK_6F_07_3 = 0x0E;
const ACTOR_END16_BEFORE_FINALS_ALT_WALK_6F_07_2 = 0x04, ACTOR_END16_BEFORE_FINALS_ALT_WALK_6F_07_3 = 0x05;
const ACTOR_END16_BEFORE_FINALS_ALT_B_A_COZ = 0x0A, ACTOR_END16_BEFORE_FINALS_ALT_0B = 0x0B;   // (script_set_actor_script $0b)
const ANIM_TROPHY_SINGLES = 0x06, ANIM_DISTANT = 0x08;
const OBJ_ALEX = 0x26;
const End17AwardCeremonyActorsAlt_27 = 0x40D8, End16BeforeFinalsActorsAlt_27 = 0x471A;
const End16BeforeFinalsActorsAltB_27 = 0x47E8;
const ActorScript_27_00 = 0x48CE, ActorScript_27_01 = 0x48D9, ActorScript_27_02 = 0x4B67, ActorScript_27_03 = 0x4B80;

// ---- End17: the award ceremony ----
const W1 = ACTOR_END17_AWARD_CEREMONY_ALT_WALK_6F_07_1, W2 = ACTOR_END17_AWARD_CEREMONY_ALT_WALK_6F_07_2;
const HOST = ACTOR_END17_AWARD_CEREMONY_ALT_WALK_75_06, TROPHY = ACTOR_END17_AWARD_CEREMONY_ALT_TROPHY;
const ALEX = ACTOR_END17_AWARD_CEREMONY_ALT_ALEX;
// moveTarget for several actors, then wait for one
function* moveAll(P, moves, waitFor) {
  for (const [actor, x, y] of moves) moveTarget(P, actor, x, y);
  yield* waitMove(P, waitFor);
}
// an actor backs to (x, y) with its facing kept
function* backTo(P, actor, x, y) {
  lockFacing(P, actor);
  moveTarget(P, actor, x, y);
  yield* waitMove(P, actor);
  unlockFacing(P, actor);
}
// End17AwardCeremonyInitScript_27 (27:419F): the doubles ceremony's actors and its scene patch (or the singles
// trophy), the champions' sprites; the trophy carried up the steps and given; the champion walks off
export function* end17AwardCeremonyInitScript(P) {
  const doubles = testFlag(P, FLAG_DOUBLES);
  if (doubles) {
    respawnActors(P, End17AwardCeremonyActorsAlt_27);
    yield* copySceneRect(P, 26, 13, 8, 13, 8, 3);
    beginCutscene(P);
  } else setAnim(P, TROPHY, ANIM_TROPHY_SINGLES);       // .animate
  setEnd17CeremonyObjectDefs(P);
  setPosition(P, W1, 63.0, 63.0);                       // .placeActors
  setPosition(P, ACTOR_PLAYER, 63.0, 63.0);
  P.V.storyModeShowLocationName = 0;
  yield* fadeInAndWait(P, 4);
  for (const actor of [W1, HOST, TROPHY, W2]) setSpeed(P, actor, 0.5);
  if (doubles) yield* end17DoublesCeremony(P);
  else yield* end17SinglesCeremony(P);
  yield* end17ChampionWalksOff(P);
}
function* end17SinglesCeremony(P) {
  face(P, W2, FACE_DOWN);
  yield* delay(P, 30);
  setPosition(P, TROPHY, 15.5, 22.0);
  yield* delay(P, 30);
  setPosition(P, W2, 63.0, 63.0);
  setPosition(P, W1, 15.0, 22.0);
  setPosition(P, TROPHY, 15.0, 21.0);
  face(P, W1, FACE_UP);
  yield* moveAll(P, [[TROPHY, 15.0, 18.0], [W1, 15.0, 19.0]], W1);
  setPosition(P, W1, 63.0, 63.0);
  setPosition(P, W2, 15.0, 19.0);
  setPosition(P, TROPHY, 14.0, 19.0);
  face(P, W2, FACE_LEFT);
  yield* moveAll(P, [[W2, 14.0, 19.0], [TROPHY, 13.0, 19.0]], TROPHY);
  yield* backTo(P, W2, 15.0, 19.0);
  moveTarget(P, W2, 15.0, 22.0);
  yield* waitMove(P, W2);
  face(P, W2, FACE_UP);
  yield* moveAll(P, [[HOST, 12.0, 17.0], [TROPHY, 12.0, 16.0]], TROPHY);
  yield* delay(P, 80);
  yield* moveAll(P, [[HOST, 12.0, 15.5], [TROPHY, 12.0, 14.25]], TROPHY);
  yield* backTo(P, HOST, 12.0, 17.0);
  face(P, HOST, FACE_UP);
  yield* gesture(P, ACTOR_END17_AWARD_CEREMONY_ALT_WALK_6F_07_3, ANIM_BOUNCE);
  yield* delay(P, 50);
  face(P, ACTOR_END17_AWARD_CEREMONY_ALT_07, FACE_LEFT);
  face(P, ACTOR_END17_AWARD_CEREMONY_ALT_A_COZ, FACE_RIGHT);
  yield* delay(P, 60);
  setPosition(P, TROPHY, 11.25, 12.25);
}
// End17AwardCeremonyInitScript_27.isDoubles (27:43C2)
function* end17DoublesCeremony(P) {
  yield* moveAll(P, [[W2, 15.0, 22.0]], W2);
  face(P, W2, FACE_DOWN);
  yield* delay(P, 20);
  setPosition(P, TROPHY, 15.5, 22.0);
  yield* delay(P, 20);
  setPosition(P, W2, 63.0, 63.0);
  setPosition(P, W1, 15.0, 22.0);
  setPosition(P, TROPHY, 15.0, 21.0);
  face(P, W1, FACE_UP);
  yield* moveAll(P, [[TROPHY, 15.0, 19.0], [W1, 15.0, 20.0]], W1);
  face(P, W2, FACE_UP);
  yield* backTo(P, W1, 15.0, 22.0);
  face(P, W1, FACE_UP);
  setPosition(P, TROPHY, 14.75, 19.0);
  yield* moveAll(P, [[HOST, 15.0, 19.0], [TROPHY, 15.75, 19.0]], TROPHY);
  yield* moveAll(P, [[HOST, 15.0, 17.0], [TROPHY, 15.75, 17.0]], TROPHY);
  yield* delay(P, 60);
  yield* gesture(P, ACTOR_PARTNER, ANIM_NOD);
  yield* gesture(P, HOST, ANIM_NOD);
  yield* delay(P, 60);
  setPosition(P, TROPHY, 14.25, 17.0);
  yield* moveAll(P, [[HOST, 13.0, 17.0], [TROPHY, 12.25, 17.0]], TROPHY);
  yield* delay(P, 4);
  face(P, HOST, FACE_UP);
  yield* moveAll(P, [[TROPHY, 13.0, 16.0]], TROPHY);
  yield* delay(P, 50);
  yield* moveAll(P, [[HOST, 13.0, 16.0], [TROPHY, 13.0, 14.5]], TROPHY);
  yield* delay(P, 5);
  yield* backTo(P, HOST, 13.0, 17.0);
  face(P, HOST, FACE_UP);
  yield* gesture(P, ACTOR_END17_AWARD_CEREMONY_ALT_WALK_6F_07_3, ANIM_BOUNCE);
  yield* delay(P, 30);
  setAnim(P, ALEX, ANIM_NOD);
  yield* gesture(P, ACTOR_PARTNER, ANIM_NOD);
  yield* delay(P, 30);
  face(P, ACTOR_PARTNER, FACE_LEFT);
  face(P, ACTOR_END17_AWARD_CEREMONY_ALT_07, FACE_RIGHT);
  face(P, ACTOR_END17_AWARD_CEREMONY_ALT_A_COZ, FACE_RIGHT);
  yield* delay(P, 60);
  setPosition(P, TROPHY, 12.25, 12.375);
}
// End17AwardCeremonyInitScript_27.loop (27:437B): the champion (its small sprite, OBJ_ALEX + gender) walks off
// slowly; exit 1
function* end17ChampionWalksOff(P) {
  loadObjdef(P, ALEX, (P.V.storyModeGenderOfMainCharacter + OBJ_ALEX) & 0xFF);
  face(P, ALEX, FACE_RIGHT);
  setAnim(P, ALEX, ANIM_DISTANT);
  playerSpeed(P, 0.1875);
  yield* movePlayer(P, 12.0, 13.0);
  yield* waitPlayerMove(P);
  yield* delay(P, 50);
  requestExit(P, 0x01);
}
// SetEnd17CeremonyObjectDefs_27 (27:45BE): in doubles the partner's court sprite, placed on the podium facing
// down; the champion's court sprite on the ceremony's Alex
export function setEnd17CeremonyObjectDefs(P) {
  const { V } = P;
  if (testFlag(P, FLAG_DOUBLES)) {
    loadObjdef(P, ACTOR_PARTNER, (V.storyModeGenderOfPartnerCharacter + OBJ_HARRY_B) & 0xFF);
    nullScript(P, ACTOR_PARTNER);
    setPosition(P, ACTOR_PARTNER, 15.0, 13.375);
    face(P, ACTOR_PARTNER, FACE_DOWN);
  }
  loadObjdef(P, ALEX, (V.storyModeGenderOfMainCharacter + OBJ_ALEX_B) & 0xFF);   // .checkStoryModeGenderOfMainCharacter
}

// ---- End16: before the finals ----
const REF2 = ACTOR_END16_BEFORE_FINALS_ALT_WALK_6F_07_2, REF3 = ACTOR_END16_BEFORE_FINALS_ALT_WALK_6F_07_3;
const COZ = ACTOR_END16_BEFORE_FINALS_ALT_B_A_COZ;
// End16BeforeFinalsInitScript_27 (27:46FD): the actors of the format, then the cutscene
export function* end16BeforeFinalsInitScript(P) {
  respawnActors(P, testFlag(P, FLAG_DOUBLES) ? End16BeforeFinalsActorsAltB_27 : End16BeforeFinalsActorsAlt_27);
  yield* end16BeforeFinalsCutscene(P);
}
// End16BeforeFinalsScriptBody_27 (27:48A8): the player to (28, 25), then on its walk script (in doubles the
// pair's, SetEnd16BeforeFinalsDoublesWalkScripts_27)
export function* end16BeforeFinalsScriptBody(P) {
  moveTarget(P, ACTOR_PLAYER, 28.0, 25.0);
  yield* waitMove(P, ACTOR_PLAYER);
  if (testFlag(P, FLAG_DOUBLES)) return yield* setEnd16BeforeFinalsDoublesWalkScripts(P);
  setActorScript(P, ACTOR_PLAYER, ActorScript_27_01);
  yield* waitActorScript(P, ACTOR_PLAYER);
}
// SetEnd16BeforeFinalsDoublesWalkScripts_27 (27:48F0)
export function* setEnd16BeforeFinalsDoublesWalkScripts(P) {
  setActorScript(P, ACTOR_PLAYER, ActorScript_27_00);
  setActorScript(P, ACTOR_PARTNER, ActorScript_27_01);
  yield* waitActorScript(P, ACTOR_PLAYER);
}
// End16BeforeFinalsCutscene_27 (27:490C): the walk in; the referees' greeting and walk to the court's side; the
// party (A. Coz in singles) nod and follow them out; exit 1
export function* end16BeforeFinalsCutscene(P) {
  yield* fadeInAndWait(P, 8);
  yield* end16BeforeFinalsScriptBody(P);
  beginCutscene(P);
  yield* movePlayer(P, 17.0, 15.0);
  yield* waitPlayerMove(P);
  yield* moveAll(P, [[REF3, 14.0, 12.0]], REF3);
  yield* moveAll(P, [[REF3, 19.0, 12.0]], REF3);
  face(P, REF3, FACE_DOWN);
  yield* gesture(P, REF3, ANIM_BOUNCE);
  face(P, REF2, FACE_UP);
  yield* gesture(P, REF2, ANIM_NOD);
  face(P, REF2, FACE_DOWN);
  moveTarget(P, REF2, 19.0, 23.0);
  moveTarget(P, REF3, 19.0, 23.0);
  yield* movePlayer(P, 17.0, 19.0);
  yield* waitMove(P, REF2);
  yield* moveAll(P, [[REF2, 21.0, 23.0]], REF2);
  face(P, REF2, FACE_UP);
  yield* waitMove(P, REF3);
  face(P, REF3, FACE_UP);
  facePair(P, REF3, REF2);
  yield* gesture(P, REF2, ANIM_NOD);
  yield* moveAll(P, [[REF3, 16.0, 23.0]], REF3);
  face(P, REF3, FACE_UP);
  if (testFlag(P, FLAG_DOUBLES)) return yield* end16DoublesWalkOut(P);
  setSpeed(P, ACTOR_PLAYER, 1.0);
  facePair(P, COZ, ACTOR_PLAYER);
  yield* wait(P, 30);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  face(P, COZ, FACE_DOWN);
  setAnim(P, COZ, ANIM_NOD);
  yield* gesture(P, ACTOR_PLAYER, ANIM_NOD);
  yield* moveAll(P, [[REF3, 19.0, 23.0]], REF3);
  setActorScript(P, REF3, ActorScript_27_02);
  yield* wait(P, 20);
  setActorScript(P, COZ, ActorScript_27_02);
  yield* wait(P, 20);
  setActorScript(P, ACTOR_PLAYER, ActorScript_27_02);
  yield* wait(P, 20);
  yield* movePlayer(P, 17.0, 13.0);
  yield* waitPlayerMove(P);
  yield* wait(P, 30);
  requestExit(P, 0x01);
}
// End16BeforeFinalsCutscene_27.face (27:4A88): the doubles pair nod to each other and walk out
function* end16DoublesWalkOut(P) {
  facePair(P, ACTOR_PARTNER, ACTOR_PLAYER);
  setSpeed(P, ACTOR_PLAYER, 1.0);
  setSpeed(P, ACTOR_PARTNER, 1.0);
  yield* wait(P, 20);
  setAnim(P, ACTOR_PARTNER, ANIM_NOD);
  yield* gesture(P, ACTOR_PLAYER, ANIM_NOD);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  face(P, ACTOR_PARTNER, FACE_DOWN);
  yield* moveAll(P, [[REF3, 19.0, 23.0]], REF3);
  setActorScript(P, REF3, ActorScript_27_02);
  yield* wait(P, 20);
  setActorScript(P, ACTOR_PLAYER, ActorScript_27_02);
  yield* wait(P, 20);
  setActorScript(P, ACTOR_PARTNER, ActorScript_27_02);
  yield* wait(P, 60);
  setActorScript(P, ACTOR_END16_BEFORE_FINALS_ALT_0B, ActorScript_27_03);
  yield* wait(P, 20);
  setActorScript(P, COZ, ActorScript_27_03);
  yield* movePlayer(P, 17.0, 13.0);
  yield* waitPlayerMove(P);
  requestExit(P, 0x01);
}

export const HOOKS = [
  scene(BANK, 0x419F, end17AwardCeremonyInitScript),
  [BANK, 0x45BE, hook(P => { setEnd17CeremonyObjectDefs(P); })],
  scene(BANK, 0x46FD, end16BeforeFinalsInitScript),
  scene(BANK, 0x48A8, end16BeforeFinalsScriptBody),
  scene(BANK, 0x48F0, setEnd16BeforeFinalsDoublesWalkScripts),
  scene(BANK, 0x490C, end16BeforeFinalsCutscene),
];
