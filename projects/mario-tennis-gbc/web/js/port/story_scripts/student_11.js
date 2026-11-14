// The academy's arrival (bank $11, $46CF-$537C): the late student's crash (he runs into the player and knocks him
// over, then guides him up to the academy, the shadow following), Emily's greeting and her offer of the tour (no:
// the entrance cells armed as a trigger to resume it; yes: into the academy), and the doubles pairing scene on
// arrival (the partner met, the four set out, off to the island sky).
// The actor lists' end record and ActorScript_11_02 are data.
// Port of src/story/student_11.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/engine/rec1.mtrec, rec2.mtrec (the story's start: the crash, the greeting, the tour; the singles
// arrival), out/port/cs_story_new2.mtrec.
import {
  ACTOR_PARTNER, ACTOR_PLAYER, ACTOR_PLAYER_SHADOW, ACTOR_SIZE, ANIM_BOUNCE, ANIM_NOD, ANIM_SHAKE, ANIM_WALK,
  BANK_ACTORS, BEHAVIOR_TRIGGER, FACE_DOWN, FACE_LEFT, FACE_RIGHT, FACE_UP, FLAG_DOUBLES, actorState, advanceText,
  askYesNo, beginCutscene, clearFlag, face, facePair, faceToward, fadeIn, fadeOutAndWait, farcall, goToLocation,
  hook, jumpVelocity, lockFacing, moveAngle, movePlayer, movePlayerToActor, moveTarget, nullScript, playerSpeed,
  requestExit, respawnActors, scene, screenShake, setActive, setActorScript, setAnim, setFlag, setObjdef,
  setPosition, setSpeed, setText, sound, speak, testFlag, unlockFacing, wActors, wait, waitFadeEnd, waitIdle,
  waitJump, waitMove, waitPlayerMove, writeBehaviorCell,
} from "./common.js";
import { attachActorWaypointFollower } from "../story/actor_slots.js";

const BANK = 0x11;
const ACTORF_OAM_ATTR = 0x37, OAM_YFLIP = 0x40;
const OBJ_ALEX_B = 0x56, OBJ_HARRY_B = 0x58;
const ActorList_11_0 = 0x537D;              // (junior_doubles_11.asm: the arrival scene's actors)
const ACTOR_ACADEMY_ARRIVAL_BALLOON_ELLIPSIS = 0x13;
const ACTOR_ACADEMY_ARRIVAL_BALLOON_EXCLAIM = 0x0F;
const ACTOR_ACADEMY_ARRIVAL_BALLOON_QUESTION = 0x0E;
const ACTOR_ACADEMY_ARRIVAL_BALLOON_SWEAT = 0x10;
const ACTOR_ACADEMY_ARRIVAL_EMILY = 0x12;
const ACTOR_ACADEMY_ARRIVAL_WALK_71_03_1 = 0x03;
const ACTOR_ACADEMY_ARRIVAL_WALK_71_03_2 = 0x14;
const ACTOR_ACADEMY_ARRIVAL_WALK_71_05 = 0x04;
const ACTOR_ACADEMY_ARRIVAL_WALK_72_02 = 0x05;
const ACTOR_ACADEMY_ARRIVAL_WALK_75_06 = 0x11;
const ACTOR_LIST_11_0_MARK = 0x07;
const ACTOR_LIST_11_0_WALK_71_03 = 0x08;
const ACTOR_LIST_11_0_WALK_74_06 = 0x06;
const ACTOR_LIST_11_0_WALK_74_07 = 0x05;
const ACTOR_LIST_11_0_WALK_74_08 = 0x04;
const ACTOR_LIST_11_0_WALK_75_06 = 0x03;
const ANIM_HOP = 0x05;
const ActorScript_11_02 = 0x4D8D;
const FLAG_STORY_MENU_LOCKED = 0x2E;
const SFX_APPEAR2 = 0x96;
const SFX_CHIME = 0x97;
const SFX_EMOTE = 0x98;
const SFX_IMPACT = 0x70;
const STORYLOC_ISLAND_SKY = 0x1B;
const Text_30_419 = 0x1A3;
const Text_30_421 = 0x1A5;
const Text_30_426 = 0x1AA;
const Text_30_427 = 0x1AB;
const Text_30_428 = 0x1AC;
const Text_30_493 = 0x1ED;
const Text_36_79 = 0x184F;
const Text_36_87 = 0x1857;
const Text_36_89 = 0x1859;

// LateStudentCrashCutscene (11:46CF), entry $0F: the player looks around the gate, the late student runs down,
// crashes into him (the impact), apologises, asks to be followed (until a yes) and runs up to the academy, the
// player after him; then Emily's greeting
export function* lateStudentCrashCutscene(P) {
  setSpeed(P, ACTOR_PLAYER, 0.5);
  P.V.storyModeShowLocationName = 0;
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 24.0, 13.0);
  setPosition(P, ACTOR_PLAYER, 24.0, 55.0);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_WALK_71_03_2, 63.0, 63.0);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_WALK_71_03_1, 34.5, 21.0);
  face(P, ACTOR_ACADEMY_ARRIVAL_WALK_71_03_1, FACE_RIGHT);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_WALK_71_05, 51.0, 21.0);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_WALK_72_02, 51.0, 21.0);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  moveTarget(P, ACTOR_PLAYER, 24.0, 45.0);
  yield* waitMove(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  yield* wait(P, 40);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* wait(P, 40);
  face(P, ACTOR_PLAYER, FACE_LEFT);
  yield* wait(P, 40);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* wait(P, 40);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  yield* wait(P, 10);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  yield* wait(P, 60);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 60);
  moveTarget(P, ACTOR_PLAYER, 24.0, 33.0);
  playerSpeed(P, 2.0);
  yield* movePlayer(P, 24.0, 18.0);
  yield* waitPlayerMove(P);
  yield* wait(P, 60);
  setPosition(P, ACTOR_PLAYER, 24.0, 32.0);
  face(P, ACTOR_PLAYER, FACE_UP);
  setSpeed(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 1.125);
  moveTarget(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 24.0, 20.0);
  yield* waitMove(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  setAnim(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, ANIM_SHAKE);
  yield* waitIdle(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  face(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, FACE_UP);
  yield* setText(P, Text_36_79);
  yield* speak(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  setAnim(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, ANIM_NOD);
  yield* waitIdle(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  setSpeed(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 1.0);
  yield* speak(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  face(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, FACE_DOWN);
  jumpVelocity(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, -2.0);
  yield* waitJump(P, 0x11);
  moveTarget(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 24.0, 23.0);
  yield* waitMove(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_BALLOON_QUESTION, 25.5, 21.75);
  sound(P, SFX_EMOTE);
  setSpeed(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 0.5);
  setSpeed(P, ACTOR_ACADEMY_ARRIVAL_BALLOON_QUESTION, 0.5);
  moveTarget(P, ACTOR_ACADEMY_ARRIVAL_BALLOON_QUESTION, 25.5, 24.75);
  moveTarget(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 24.0, 26.0);
  yield* waitMove(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  yield* speak(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_BALLOON_QUESTION, 63.0, 63.0);
  moveTarget(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 24.0, 22.0);
  yield* waitMove(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  yield* wait(P, 30);
  setAnim(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, ANIM_BOUNCE);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_BALLOON_EXCLAIM, 25.5, 20.75);
  sound(P, SFX_CHIME);
  yield* wait(P, 20);
  yield* speak(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_BALLOON_EXCLAIM, 63.0, 63.0);
  setSpeed(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 1.0);
  jumpVelocity(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, -2.0);
  yield* waitJump(P, 0x11);
  moveTarget(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 24.0, 32.0);
  yield* wait(P, 30);
  const leader = actorState(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);  // the player's shadow follows the student
  farcall(P, BANK_ACTORS, () => attachActorWaypointFollower(P, wActors + ACTOR_SIZE, leader));
  moveTarget(P, ACTOR_PLAYER, 24.0, 30.0);
  yield* wait(P, 20);
  yield* lateStudentCrashImpact(P);
  yield* waitMove(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  setAnim(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, ANIM_BOUNCE);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_BALLOON_SWEAT, 25.0, 30.0);
  sound(P, SFX_APPEAR2);
  yield* wait(P, 60);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_BALLOON_SWEAT, 63.0, 63.0);
  moveTarget(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 23.0, 34.0);
  yield* waitMove(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  faceToward(P, ACTOR_PLAYER, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  yield* speak(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  moveTarget(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 25.0, 36.0);
  yield* waitMove(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  nullScript(P, ACTOR_PLAYER_SHADOW);
  faceToward(P, ACTOR_PLAYER, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  setAnim(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  yield* speak(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_BALLOON_ELLIPSIS, 26.5, 34.5);
  yield* wait(P, 60);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_BALLOON_ELLIPSIS, 63.0, 63.0);
  moveTarget(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 25.0, 35.0);
  yield* waitMove(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  moveTarget(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 26.0, 35.0);
  yield* waitMove(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  moveTarget(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 26.0, 36.0);
  yield* waitMove(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  moveTarget(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 25.0, 36.0);
  yield* waitMove(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  moveTarget(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 25.0, 37.0);
  yield* waitMove(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  moveTarget(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 26.0, 37.0);
  yield* waitMove(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  moveTarget(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 26.0, 36.0);
  yield* waitMove(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  moveTarget(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 25.0, 36.0);
  yield* waitMove(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  faceToward(P, ACTOR_PLAYER, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  yield* wait(P, 60);
  setAnim(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  yield* speak(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  yield* knockPlayerAirborneFlipped(P);
  lockFacing(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  setAnim(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, ANIM_HOP);
  yield* wait(P, 20);
  jumpVelocity(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, -2.0);
  moveTarget(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 27.0, 36.0);
  yield* wait(P, 20);
  faceToward(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, ACTOR_PLAYER);
  yield* wait(P, 20);
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_PLAYER);
  setAnim(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  faceToward(P, ACTOR_PLAYER, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  moveTarget(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 26.0, 36.0);
  yield* waitMove(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  unlockFacing(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_PLAYER);
  setAnim(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  yield* speak(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  setAnim(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  for (;;) {                                                         // .loop: until a yes
    yield* setText(P, Text_36_87);
    if ((yield* askYesNo(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06)) === 0) break;
    setAnim(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, ANIM_BOUNCE);
    yield* speak(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  }
  yield* setText(P, Text_36_89);
  setAnim(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, ANIM_NOD);
  yield* waitIdle(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  yield* speak(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  yield* wait(P, 60);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_BALLOON_QUESTION, 27.5, 33.75);
  sound(P, SFX_EMOTE);
  yield* wait(P, 40);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_BALLOON_QUESTION, 63.0, 63.0);
  moveAngle(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, FACE_LEFT, 1.0);
  yield* waitMove(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  yield* speak(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_BALLOON_QUESTION, 26.5, 33.75);
  yield* wait(P, 60);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_BALLOON_QUESTION, 63.0, 63.0);
  yield* wait(P, 60);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_BALLOON_EXCLAIM, 26.5, 33.75);
  sound(P, SFX_CHIME);
  jumpVelocity(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, -2.0);
  yield* waitJump(P, 0x11);
  yield* wait(P, 10);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_BALLOON_EXCLAIM, 63.0, 63.0);
  yield* speak(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  setAnim(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  yield* speak(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  setAnim(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, ANIM_NOD);
  yield* waitIdle(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  yield* speak(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  yield* wait(P, 10);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 60);
  playerSpeed(P, 3.0);
  face(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, FACE_UP);
  setAnim(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_BALLOON_EXCLAIM, 26.5, 33.75);
  sound(P, SFX_CHIME);
  yield* wait(P, 40);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_BALLOON_EXCLAIM, 63.0, 63.0);
  face(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, FACE_UP);
  setAnim(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, ANIM_BOUNCE);
  yield* movePlayer(P, 24.0, 11.0);
  yield* waitPlayerMove(P);
  setActive(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 0x00);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 25.0, 6.0);
  yield* speak(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 25.0, 36.0);
  setActive(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 0x02);
  yield* movePlayer(P, 24.0, 36.0);
  yield* waitPlayerMove(P);
  faceToward(P, ACTOR_PLAYER, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  yield* speak(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  setAnim(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, ANIM_NOD);
  yield* waitIdle(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  jumpVelocity(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, -2.0);
  yield* waitJump(P, 0x11);
  moveTarget(P, ACTOR_ACADEMY_ARRIVAL_WALK_75_06, 24.0, 51.0);
  yield* wait(P, 20);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  yield* wait(P, 90);
  yield* academyArrivalGreetingScene(P);
}

// LateStudentCrashImpact (11:4CF6): the crash: the shadow detached, the thud and a shake, the player knocked back
// upside down (y flip), bouncing, on ActorScript_11_02
export function* lateStudentCrashImpact(P) {
  nullScript(P, ACTOR_PLAYER_SHADOW);
  sound(P, SFX_IMPACT);
  screenShake(P, 0x03);
  yield* wait(P, 10);
  screenShake(P, 0x00);
  setSpeed(P, ACTOR_PLAYER, 2.0);
  yield* movePlayer(P, 24.0, 36.0);
  moveTarget(P, ACTOR_PLAYER, 23.0, 36.0);
  jumpVelocity(P, ACTOR_PLAYER, -4.0);
  const attr = (actorState(P, ACTOR_PLAYER) + ACTORF_OAM_ATTR) & 0xFFFF;   // upside down (y flip)
  P.bus.w8(attr, P.bus.u8(attr) | OAM_YFLIP);
  yield* wait(P, 30);
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 30);
  setActorScript(P, ACTOR_PLAYER, ActorScript_11_02);
}

// KnockPlayerAirborneFlipped_11 (11:4D68): the player knocked into a small jump, the y flip toggled
export function* knockPlayerAirborneFlipped(P) {
  nullScript(P, ACTOR_PLAYER);
  setSpeed(P, ACTOR_PLAYER, 0.5);
  jumpVelocity(P, ACTOR_PLAYER, -2.0);
  const attr = (actorState(P, ACTOR_PLAYER) + ACTORF_OAM_ATTR) & 0xFFFF;   // the y flip toggled
  P.bus.w8(attr, P.bus.u8(attr) ^ OAM_YFLIP);
}

// AcademyArrivalGreetingScene (11:4D94): Emily comes out (her line by the player's gender), the greetings, her
// questions; no to the tour: the entrance armed to resume it (the story menu locked); yes: follow her in
export function* academyArrivalGreetingScene(P) {
  playerSpeed(P, 0.5);
  setSpeed(P, ACTOR_PLAYER, 0.75);
  setSpeed(P, ACTOR_ACADEMY_ARRIVAL_EMILY, 0.75);
  yield* movePlayer(P, 24.0, 19.0);
  moveTarget(P, ACTOR_PLAYER, 24.0, 36.0);
  yield* waitMove(P, ACTOR_PLAYER);
  moveTarget(P, ACTOR_PLAYER, 24.0, 19.0);
  yield* setText(P, Text_30_419);
  yield* wait(P, 120);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_EMILY, 24.0, 15.0);
  yield* waitMove(P, ACTOR_PLAYER);
  if (P.V.storyModeGenderOfMainCharacter) advanceText(P);           // (her line for a girl)
  yield* speak(P, ACTOR_ACADEMY_ARRIVAL_EMILY);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_BALLOON_EXCLAIM, 25.25, 17.75);
  sound(P, SFX_CHIME);
  yield* wait(P, 40);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_BALLOON_EXCLAIM, 63.0, 63.0);
  faceToward(P, ACTOR_ACADEMY_ARRIVAL_EMILY, ACTOR_PLAYER);
  playerSpeed(P, 1.0);
  moveTarget(P, ACTOR_ACADEMY_ARRIVAL_EMILY, 24.0, 17.0);
  yield* wait(P, 15);
  yield* movePlayer(P, 24.0, 17.0);
  yield* waitPlayerMove(P);
  yield* wait(P, 60);
  facePair(P, ACTOR_PLAYER, ACTOR_ACADEMY_ARRIVAL_EMILY);
  yield* wait(P, 30);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 15);
  setAnim(P, ACTOR_ACADEMY_ARRIVAL_EMILY, ANIM_NOD);
  yield* waitIdle(P, ACTOR_ACADEMY_ARRIVAL_EMILY);
  yield* setText(P, Text_30_421);
  yield* speak(P, ACTOR_ACADEMY_ARRIVAL_WALK_71_03_1);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_BALLOON_QUESTION, 25.25, 17.75);
  sound(P, SFX_EMOTE);
  yield* wait(P, 50);
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_BALLOON_QUESTION, 63.0, 63.0);
  setAnim(P, ACTOR_ACADEMY_ARRIVAL_EMILY, ANIM_NOD);
  yield* waitIdle(P, ACTOR_ACADEMY_ARRIVAL_EMILY);
  yield* speak(P, ACTOR_ACADEMY_ARRIVAL_EMILY);
  yield* wait(P, 15);
  setAnim(P, ACTOR_ACADEMY_ARRIVAL_EMILY, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_ACADEMY_ARRIVAL_EMILY);
  if ((yield* askYesNo(P, ACTOR_ACADEMY_ARRIVAL_EMILY)) !== 0) advanceText(P);
  if ((yield* askYesNo(P, ACTOR_ACADEMY_ARRIVAL_EMILY)) !== 0) {   // .finish: no: look around first
    P.V.storyModeShowLocationName = 0;
    yield* setText(P, Text_30_427);
    yield* speak(P, ACTOR_ACADEMY_ARRIVAL_EMILY);
    setFlag(P, FLAG_STORY_MENU_LOCKED);
    armAcademyEntranceTileTrigger(P);
    return;
  }
  yield* setText(P, Text_30_426);                                    // .done
  yield* speak(P, ACTOR_ACADEMY_ARRIVAL_EMILY);
  yield* followGuideIntoAcademy(P);
}

// ArmAcademyEntranceTileTrigger (11:4F1B): the four cells before the academy's door become trigger 15 (the guide's
// tour resumed when stepped on: AcademyArrivalTile0F_11). Leaves a = the cell value, de = the last cell, F as
// WriteBehaviorMapCell leaves it (0)
export function armAcademyEntranceTileTrigger(P) {
  const cells = [[22, 16], [24, 16], [22, 18], [24, 18]], v = BEHAVIOR_TRIGGER | 15 << 4;
  for (const [col, row] of cells) writeBehaviorCell(P, col, row, v);
  return { a: v, d: 24, e: 18, f: 0 };
}

// ResumeAcademyGuideTour (11:4F40): stepping on the armed entrance: Emily calls, the tour goes on
export function* resumeAcademyGuideTour(P) {
  setAnim(P, ACTOR_ACADEMY_ARRIVAL_EMILY, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_ACADEMY_ARRIVAL_EMILY);
  moveTarget(P, ACTOR_PLAYER, 24.0, 19.0);
  yield* waitMove(P, ACTOR_PLAYER);
  faceToward(P, ACTOR_ACADEMY_ARRIVAL_EMILY, ACTOR_PLAYER);
  setAnim(P, ACTOR_ACADEMY_ARRIVAL_EMILY, ANIM_NOD);
  yield* waitIdle(P, ACTOR_ACADEMY_ARRIVAL_EMILY);
  yield* setText(P, Text_30_428);
  yield* speak(P, ACTOR_ACADEMY_ARRIVAL_EMILY);
  yield* speak(P, ACTOR_ACADEMY_ARRIVAL_EMILY);
  yield* followGuideIntoAcademy(P);
}

// FollowGuideIntoAcademy (11:4F84): the story menu unlocked, both walk in, exit $0F with a fade
export function* followGuideIntoAcademy(P) {
  setSpeed(P, ACTOR_PLAYER, 0.75);
  setSpeed(P, ACTOR_ACADEMY_ARRIVAL_EMILY, 0.75);
  clearFlag(P, FLAG_STORY_MENU_LOCKED);
  moveTarget(P, ACTOR_ACADEMY_ARRIVAL_EMILY, 24.0, 14.0);
  moveTarget(P, ACTOR_PLAYER, 24.0, 14.0);
  yield* wait(P, 30);
  requestExit(P, 0x0F);
  yield* fadeOutAndWait(P, 4);
}

// AcademyArrivalInitScript_11.scriptRespawnLocationActors (11:4FCF), entry $0A: the scene's actors (ActorList_11_0)
// spawned; in doubles the partner's stand-in (by gender) and Mark placed; then the arrival (.notDoubles)
export function* academyArrivalRespawnScene(P) {
  respawnActors(P, ActorList_11_0);
  beginCutscene(P);
  if (testFlag(P, FLAG_DOUBLES)) {
    nullScript(P, ACTOR_PARTNER);                                    // (the partner: a stand-in actor)
    setPosition(P, ACTOR_PARTNER, 63.0, 63.0);
    setObjdef(P, (P.V.storyModeGenderOfPartnerCharacter + OBJ_HARRY_B) & 0xFF, ACTOR_LIST_11_0_WALK_74_07);
    setAnim(P, ACTOR_LIST_11_0_WALK_74_07, ANIM_WALK);
    setPosition(P, ACTOR_LIST_11_0_MARK, 26.0, 17.0);
    face(P, ACTOR_LIST_11_0_MARK, FACE_DOWN);
  }
  return yield* academyArrivalNotDoubles(P);
}

// AcademyArrivalInitScript_11.notDoubles (11:501A): the player's court sprite, walked up to the coach; his welcome;
// in doubles the partner introduced and Mark's line, in singles the line about the partner (.animate); then .speak
export function* academyArrivalNotDoubles(P) {
  setObjdef(P, (P.V.storyModeGenderOfMainCharacter + OBJ_ALEX_B) & 0xFF, ACTOR_PLAYER);
  setAnim(P, ACTOR_PLAYER, ANIM_WALK);
  setPosition(P, ACTOR_PLAYER, 23.0, 23.0);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* movePlayerToActor(P, ACTOR_LIST_11_0_WALK_75_06);
  yield* waitPlayerMove(P);
  fadeIn(P, 8);
  yield* waitFadeEnd(P);
  yield* wait(P, 60);
  yield* setText(P, Text_30_493);
  yield* speak(P, ACTOR_LIST_11_0_WALK_75_06);
  if (!testFlag(P, FLAG_DOUBLES)) return yield* academyArrivalAnimate(P);
  setAnim(P, ACTOR_LIST_11_0_WALK_74_08, ANIM_NOD);
  setAnim(P, ACTOR_LIST_11_0_WALK_74_06, ANIM_NOD);
  yield* waitIdle(P, ACTOR_LIST_11_0_WALK_74_06);
  yield* wait(P, 30);
  facePair(P, ACTOR_LIST_11_0_WALK_74_07, ACTOR_PLAYER);
  yield* wait(P, 30);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  setAnim(P, ACTOR_LIST_11_0_WALK_74_07, ANIM_NOD);
  yield* waitIdle(P, ACTOR_LIST_11_0_WALK_74_07);
  yield* wait(P, 30);
  face(P, ACTOR_LIST_11_0_WALK_74_07, FACE_UP);
  yield* wait(P, 30);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  setAnim(P, ACTOR_LIST_11_0_WALK_74_07, ANIM_NOD);
  yield* waitIdle(P, ACTOR_LIST_11_0_WALK_74_07);
  yield* wait(P, 30);
  setAnim(P, ACTOR_LIST_11_0_WALK_75_06, ANIM_NOD);
  yield* waitIdle(P, ACTOR_LIST_11_0_WALK_75_06);
  yield* wait(P, 10);
  setAnim(P, ACTOR_LIST_11_0_MARK, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_LIST_11_0_MARK);
  yield* speak(P, ACTOR_LIST_11_0_MARK);
  setAnim(P, ACTOR_LIST_11_0_WALK_74_08, ANIM_NOD);
  setAnim(P, ACTOR_LIST_11_0_WALK_74_07, ANIM_NOD);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  setAnim(P, ACTOR_LIST_11_0_WALK_74_06, ANIM_NOD);
  yield* waitIdle(P, ACTOR_LIST_11_0_WALK_74_06);
  yield* wait(P, 30);
  facePair(P, ACTOR_LIST_11_0_MARK, ACTOR_LIST_11_0_WALK_75_06);
  setAnim(P, ACTOR_LIST_11_0_WALK_75_06, ANIM_NOD);
  setAnim(P, ACTOR_LIST_11_0_MARK, ANIM_NOD);
  yield* waitIdle(P, ACTOR_LIST_11_0_MARK);
  face(P, ACTOR_LIST_11_0_MARK, FACE_DOWN);
  face(P, ACTOR_LIST_11_0_WALK_75_06, FACE_DOWN);
  yield* wait(P, 30);
  return yield* academyArrivalSpeak(P);
}

// AcademyArrivalInitScript_11.animate (11:5158): the singles' greetings, the coach's next line
export function* academyArrivalAnimate(P) {
  setAnim(P, ACTOR_LIST_11_0_WALK_74_08, ANIM_NOD);
  setAnim(P, ACTOR_LIST_11_0_WALK_74_07, ANIM_NOD);
  yield* waitIdle(P, ACTOR_LIST_11_0_WALK_74_07);
  yield* wait(P, 30);
  facePair(P, ACTOR_LIST_11_0_WALK_74_06, ACTOR_PLAYER);
  yield* wait(P, 30);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  setAnim(P, ACTOR_LIST_11_0_WALK_74_06, ANIM_NOD);
  yield* waitIdle(P, ACTOR_LIST_11_0_WALK_74_06);
  yield* wait(P, 30);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, ACTOR_LIST_11_0_WALK_74_06, FACE_UP);
  yield* wait(P, 30);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  setAnim(P, ACTOR_LIST_11_0_WALK_74_06, ANIM_NOD);
  yield* waitIdle(P, ACTOR_LIST_11_0_WALK_74_06);
  yield* wait(P, 30);
  setAnim(P, ACTOR_LIST_11_0_WALK_75_06, ANIM_NOD);
  yield* waitIdle(P, ACTOR_LIST_11_0_WALK_75_06);
  advanceText(P);
  return yield* academyArrivalSpeak(P);
}

// AcademyArrivalInitScript_11.speak (11:51D9): the coach's word, the four line up and walk off the bottom, faded
// out to the island sky (entry 1)
export function* academyArrivalSpeak(P) {
  yield* speak(P, ACTOR_LIST_11_0_WALK_75_06);
  yield* wait(P, 30);
  setAnim(P, ACTOR_LIST_11_0_WALK_74_08, ANIM_NOD);
  setAnim(P, ACTOR_LIST_11_0_WALK_74_07, ANIM_NOD);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  setAnim(P, ACTOR_LIST_11_0_WALK_74_06, ANIM_NOD);
  yield* waitIdle(P, ACTOR_LIST_11_0_WALK_74_06);
  yield* wait(P, 20);
  facePair(P, ACTOR_LIST_11_0_WALK_74_06, ACTOR_PLAYER);
  facePair(P, ACTOR_LIST_11_0_WALK_74_08, ACTOR_LIST_11_0_WALK_74_07);
  yield* wait(P, 10);
  lockFacing(P, ACTOR_PLAYER);
  lockFacing(P, ACTOR_LIST_11_0_WALK_74_06);
  lockFacing(P, ACTOR_LIST_11_0_WALK_74_07);
  lockFacing(P, ACTOR_LIST_11_0_WALK_74_08);
  moveTarget(P, ACTOR_PLAYER, 22.0, 23.0);
  moveTarget(P, ACTOR_LIST_11_0_WALK_74_06, 26.0, 23.0);
  moveTarget(P, ACTOR_LIST_11_0_WALK_74_07, 21.0, 21.0);
  moveTarget(P, ACTOR_LIST_11_0_WALK_74_08, 27.0, 21.0);
  yield* waitMove(P, ACTOR_LIST_11_0_WALK_74_08);
  yield* movePlayer(P, 24.0, 47.0);
  moveTarget(P, ACTOR_LIST_11_0_WALK_75_06, 24.0, 25.0);
  yield* waitMove(P, ACTOR_LIST_11_0_WALK_75_06);
  unlockFacing(P, ACTOR_PLAYER);
  unlockFacing(P, ACTOR_LIST_11_0_WALK_74_06);
  unlockFacing(P, ACTOR_LIST_11_0_WALK_74_07);
  unlockFacing(P, ACTOR_LIST_11_0_WALK_74_08);
  moveTarget(P, ACTOR_PLAYER, 22.0, 43.0);
  moveTarget(P, ACTOR_LIST_11_0_WALK_74_06, 26.0, 43.0);
  moveTarget(P, ACTOR_LIST_11_0_WALK_74_07, 21.0, 41.0);
  moveTarget(P, ACTOR_LIST_11_0_WALK_74_08, 27.0, 41.0);
  moveTarget(P, ACTOR_LIST_11_0_WALK_75_06, 24.0, 45.0);
  yield* waitMove(P, ACTOR_LIST_11_0_WALK_75_06);
  setAnim(P, ACTOR_LIST_11_0_WALK_71_03, ANIM_NOD);
  moveTarget(P, ACTOR_PLAYER, 23.0, 47.0);
  moveTarget(P, ACTOR_LIST_11_0_WALK_74_06, 25.0, 47.0);
  moveTarget(P, ACTOR_LIST_11_0_WALK_74_07, 23.0, 45.0);
  moveTarget(P, ACTOR_LIST_11_0_WALK_74_08, 25.0, 45.0);
  moveTarget(P, ACTOR_LIST_11_0_WALK_75_06, 24.0, 49.0);
  yield* waitMove(P, ACTOR_LIST_11_0_WALK_75_06);
  moveTarget(P, ACTOR_PLAYER, 23.0, 59.0);
  moveTarget(P, ACTOR_LIST_11_0_WALK_74_06, 25.0, 59.0);
  moveTarget(P, ACTOR_LIST_11_0_WALK_74_07, 23.0, 57.0);
  moveTarget(P, ACTOR_LIST_11_0_WALK_74_08, 25.0, 57.0);
  moveTarget(P, ACTOR_LIST_11_0_WALK_75_06, 24.0, 61.0);
  yield* waitMove(P, ACTOR_LIST_11_0_WALK_75_06);
  yield* fadeOutAndWait(P, 4);
  goToLocation(P, STORYLOC_ISLAND_SKY, 0x01);
}

export const HOOKS = [
  scene(BANK, 0x46CF, lateStudentCrashCutscene),
  scene(BANK, 0x4CF6, lateStudentCrashImpact),
  scene(BANK, 0x4D68, knockPlayerAirborneFlipped),
  scene(BANK, 0x4D94, academyArrivalGreetingScene),
  [BANK, 0x4F1B, hook(P => armAcademyEntranceTileTrigger(P))],
  scene(BANK, 0x4F40, resumeAcademyGuideTour),
  scene(BANK, 0x4F84, followGuideIntoAcademy),
  scene(BANK, 0x4FCF, academyArrivalRespawnScene),                 // AcademyArrivalInitScript_11.scriptRespawnLocationActors
  scene(BANK, 0x501A, academyArrivalNotDoubles),                   // AcademyArrivalInitScript_11.notDoubles
  scene(BANK, 0x5158, academyArrivalAnimate),                      // AcademyArrivalInitScript_11.animate
  scene(BANK, 0x51D9, academyArrivalSpeak),                        // AcademyArrivalInitScript_11.speak
];
