// The restaurant plaza (bank $13, $405F-$4C7D): its arrival walks (the twins of entries 4 and 6; the distant walks
// in of entries 1 and 3, the restaurant's door of entry 2), its exit tiles (the walk off into the distance, the
// door, the walk right), its init script and its two cutscenes: the academy courts' tour with Emily (entry $0F:
// the pointer over the courts) and the service-ace coach's introduction (entry $0E: Mark and Kevin out of the
// door). The map tables and actor lists are data.
// Port of src/story/restaurant_13.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are; RestaurantPlazaArrival04_13 / 06_13 are src/twins/
// academy_main_bldg_arrival01.asm and restaurant_plaza_arrival06.asm (twins.js).
// Recordings: out/engine/rec1.mtrec, rec2.mtrec (the plaza: the tour and its walks), out/port/ss2_plaza*.mtrec
// (scripted: each entry and exit tile, singles and doubles; the coach's introduction).
import {
  ACTOR_PARTNER, ACTOR_PLAYER, ANIM_BOUNCE, ANIM_NOD, ANIM_SHAKE, ANIM_WALK, FACE_DOWN, FACE_LEFT, FACE_RIGHT,
  FACE_UP, FLAG_DOUBLES, advanceText, beginCutscene, copySceneRect, endCutscene, face, facePair, faceToward, fadeIn,
  fadeOut, moveAngle, movePlayer, moveTarget, registerFrameTask, requestExit, respawnActors, scene, setActive,
  setAnim, setPosition, setSpeed, setText, sound, speak, testFlag, unregisterFrameTask, wait, waitFadeEnd, waitIdle,
  waitMove, waitPlayerMove,
} from "./common.js";
import { getRegs } from "../home/cpu.js";
import { animateDoorOpen, animateDoorClose, loadTourPointerSpriteGfx } from "./dorm_13.js";
import { arrivalWalkUp, arrivalWalkLeft } from "./twins.js";

const BANK = 0x13;
const ACTOR_ACADEMY_COURTS_TOUR_EMILY = 0x06;
const ACTOR_SERVICE_ACE_COACH_INTRO_BALLOON_ELLIPSIS = 0x05;
const ACTOR_SERVICE_ACE_COACH_INTRO_BALLOON_EXCLAIM = 0x03;
const ACTOR_SERVICE_ACE_COACH_INTRO_BALLOON_QUESTION = 0x04;
const ACTOR_SERVICE_ACE_COACH_INTRO_EMILY = 0x06;
const ACTOR_SERVICE_ACE_COACH_INTRO_KEVIN = 0x08;
const ACTOR_SERVICE_ACE_COACH_INTRO_MARK = 0x07;
const ANIM_DISTANT = 0x08;
const SFX_CHIME = 0x97;
const SFX_EMOTE = 0x98;
const SFX_STOP = 0x50;
const Text_31_48 = 0x430;
const Text_31_53 = 0x435;
const Text_31_62 = 0x43E;
const Text_35_48 = 0x1430;
const STORYENTRY_KEEP = 0xFF;                            // entering keeping the saved position: no walk
// data of this bank (read from the ROM)
const AcademyCourtsTourActors_13 = 0x472C, ServiceAceCoachIntroActors_13 = 0x4C7E;
const AnimateTourPointerSprite_13 = 0x4D0A;

// RestaurantPlazaArrival01_13 (13:40EB): (unless entering keeping the position) the walk in from the
// distance: the party walks to (7, 12.5) / (7, 11), the player then facing right
export function* restaurantPlazaArrival01(P) {
  if (P.V.storyModeEntryPoint === STORYENTRY_KEEP) return;
  setSpeed(P, ACTOR_PLAYER, 0.75);
  setAnim(P, ACTOR_PLAYER, ANIM_DISTANT);
  setSpeed(P, ACTOR_PARTNER, 0.75);
  setAnim(P, ACTOR_PARTNER, ANIM_DISTANT);
  fadeIn(P, 8);
  yield* wait(P, 20);
  moveTarget(P, ACTOR_PLAYER, 7.0, 12.5);
  yield* wait(P, 20);
  moveTarget(P, ACTOR_PARTNER, 7.0, 11.0);
  yield* wait(P, 20);
  setAnim(P, ACTOR_PLAYER, ANIM_WALK);
  yield* wait(P, 10);
  setAnim(P, ACTOR_PARTNER, ANIM_WALK);
  yield* waitMove(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
}

// RestaurantPlazaArrival02_13 (13:4163): out of the restaurant's door (the door drawn open), the music stopped;
// the party to (21, 13) / (21, 11), the door closed behind
export function* restaurantPlazaArrival02(P) {
  if (P.V.storyModeEntryPoint === STORYENTRY_KEEP) return;
  yield* copySceneRect(P, 20, 8, 6, 21, 2, 2);
  yield* copySceneRect(P, 4, 21, 20, 8, 2, 2);
  setSpeed(P, ACTOR_PLAYER, 0.75);
  fadeIn(P, 8);
  yield* waitFadeEnd(P);
  yield* wait(P, 5);
  sound(P, SFX_STOP);
  yield* wait(P, 5);
  moveTarget(P, ACTOR_PLAYER, 21.0, 13.0);
  moveTarget(P, ACTOR_PARTNER, 21.0, 11.0);
  if (testFlag(P, FLAG_DOUBLES)) yield* wait(P, 12);
  yield* animateDoorClose(P);                             // .notDoubles
}

// RestaurantPlazaArrivalWalkIn_13 (13:41CF): the walk down into the plaza from the distance (5 / 4 tiles)
export function* restaurantPlazaArrivalWalkIn(P) {
  if (P.V.storyModeEntryPoint === STORYENTRY_KEEP) return;
  setSpeed(P, ACTOR_PLAYER, 0.375);
  setAnim(P, ACTOR_PLAYER, ANIM_DISTANT);
  setSpeed(P, ACTOR_PARTNER, 0.375);
  setAnim(P, ACTOR_PARTNER, ANIM_DISTANT);
  fadeIn(P, 8);
  yield* wait(P, 10);
  moveAngle(P, ACTOR_PLAYER, FACE_DOWN, 5.0);
  yield* wait(P, 40);
  moveAngle(P, ACTOR_PARTNER, FACE_DOWN, 4.0);
  setAnim(P, ACTOR_PLAYER, ANIM_WALK);
  yield* wait(P, 16);
  setAnim(P, ACTOR_PARTNER, ANIM_WALK);
  yield* waitMove(P, ACTOR_PLAYER);
}

// Unused_13_PlayerSpeaksText35_48 (13:427F): a line of the player (nothing points at it)
export function* unused_13_PlayerSpeaksText35_48(P) {
  yield* setText(P, Text_35_48);
  yield* speak(P, ACTOR_PLAYER);
}

// RestaurantPlazaTile01_13 (13:42DE): the walk off up the left street; exit 1
export function* restaurantPlazaTile01(P) {
  moveTarget(P, ACTOR_PARTNER, 7.0, 13.0);
  setSpeed(P, ACTOR_PLAYER, 0.5);
  moveAngle(P, ACTOR_PLAYER, FACE_UP, 1.0);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* storyActorsWalkOffAndFadeOut(P);
  requestExit(P, 0x01);
}

// RestaurantPlazaTile02_13 (13:430C): into the restaurant (its door opened); exit 2
export function* restaurantPlazaTile02(P) {
  setSpeed(P, ACTOR_PLAYER, 0.5);
  moveTarget(P, ACTOR_PARTNER, 21.0, 13.0);
  moveAngle(P, ACTOR_PLAYER, 0xC2, 2.0);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* animateDoorOpen(P);
  moveAngle(P, ACTOR_PLAYER, 0xC2, 2.0);
  yield* wait(P, 2);
  fadeOut(P, 16);
  yield* wait(P, 30);
  requestExit(P, 0x02);
}

// RestaurantPlazaTile03_13 (13:4357): the walk off up the middle street; exit 3
export function* restaurantPlazaTile03(P) {
  setSpeed(P, ACTOR_PARTNER, 2.0);
  moveTarget(P, ACTOR_PARTNER, 37.0, 13.0);
  setSpeed(P, ACTOR_PLAYER, 0.5);
  setSpeed(P, ACTOR_PARTNER, 0.5);
  moveAngle(P, ACTOR_PLAYER, FACE_UP, 1.0);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* storyActorsWalkOffAndFadeOut(P);
  fadeOut(P, 16);
  yield* wait(P, 30);
  requestExit(P, 0x03);
}

// RestaurantPlazaTile05_13 (13:43A1): the walk off up the right street; exit 5 (doubles $0D)
export function* restaurantPlazaTile05(P) {
  moveTarget(P, ACTOR_PARTNER, 55.0, 13.0);
  setSpeed(P, ACTOR_PLAYER, 0.5);
  setSpeed(P, ACTOR_PARTNER, 0.5);
  moveAngle(P, ACTOR_PLAYER, FACE_UP, 0.5);
  yield* storyActorsWalkOffAndFadeOut(P);
  const doubles = testFlag(P, FLAG_DOUBLES);
  requestExit(P, 0x05);
  if (doubles) requestExit(P, 0x0D);
}

// RestaurantPlazaTile06_13 (13:43DF): off to the right; exit 6 (doubles the same)
export function* restaurantPlazaTile06(P) {
  setSpeed(P, ACTOR_PLAYER, 1.0);
  moveTarget(P, ACTOR_PARTNER, 59.0, 13.0);
  moveAngle(P, ACTOR_PLAYER, FACE_RIGHT, 6.0);
  yield* wait(P, 60);
  fadeOut(P, 16);
  yield* wait(P, 30);
  const doubles = testFlag(P, FLAG_DOUBLES);
  requestExit(P, 0x06);
  if (doubles) requestExit(P, 0x06);
}

// StoryActorsWalkOffAndFadeOut_13 (13:4425): the player walks off into the distance (up, then the far
// animation), faded out and gone
export function* storyActorsWalkOffAndFadeOut(P) {
  if (testFlag(P, FLAG_DOUBLES)) return yield* storyActorsWalkOffAndFadeOutDoubles(P);
  face(P, ACTOR_PLAYER, FACE_UP);
  moveAngle(P, ACTOR_PLAYER, 0xC8, 4.0);
  setSpeed(P, ACTOR_PLAYER, 0.5);
  yield* wait(P, 40);
  setAnim(P, ACTOR_PLAYER, ANIM_DISTANT);
  fadeOut(P, 8);
  yield* waitMove(P, ACTOR_PLAYER);
  setActive(P, ACTOR_PLAYER, 0x00);
  yield* wait(P, 10);
}

// StoryActorsWalkOffAndFadeOutDoubles_13 (13:446A): the same for the pair, one after the other
export function* storyActorsWalkOffAndFadeOutDoubles(P) {
  yield* waitMove(P, ACTOR_PARTNER);
  moveAngle(P, ACTOR_PLAYER, 0xC8, 2.5);
  setSpeed(P, ACTOR_PLAYER, 0.5);
  setSpeed(P, ACTOR_PARTNER, 0.5);
  yield* wait(P, 10);
  moveAngle(P, ACTOR_PARTNER, 0xCA, 5.0);
  yield* waitMove(P, ACTOR_PLAYER);
  setAnim(P, ACTOR_PLAYER, ANIM_DISTANT);
  moveAngle(P, ACTOR_PLAYER, 0xCA, 1.0);
  yield* waitMove(P, ACTOR_PARTNER);
  setAnim(P, ACTOR_PARTNER, ANIM_DISTANT);
  moveAngle(P, ACTOR_PARTNER, 0xCA, 2.0);
  yield* waitMove(P, ACTOR_PLAYER);
  setActive(P, ACTOR_PLAYER, 0x00);
  fadeOut(P, 16);
  yield* wait(P, 10);
}

// RestaurantPlazaInitScript_13 (13:44DF): entry $0F the courts' tour, entry $0E the coach's introduction
export function* restaurantPlazaInitScript(P) {
  const entry = P.V.storyModeEntryPoint;
  if (entry === 0x0F) yield* academyCourtsTourCutscene(P);
  if (entry === 0x0E) yield* serviceAceCoachIntroCutscene(P);   // .ne0f (after the tour a = $0F)
}

// AcademyCourtsTourCutscene (13:44F1): Emily shows the player the courts (the pointer sprite over each one in
// turn), then leads on to the right; exit $0F
export function* academyCourtsTourCutscene(P) {
  respawnActors(P, AcademyCourtsTourActors_13);
  beginCutscene(P);
  setPosition(P, ACTOR_PLAYER, 63.0, 63.0);
  setPosition(P, ACTOR_ACADEMY_COURTS_TOUR_EMILY, 63.0, 63.0);
  loadTourPointerSpriteGfx(P, getRegs(P.cpu));
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  setPosition(P, ACTOR_ACADEMY_COURTS_TOUR_EMILY, 50.0, 19.0);
  moveTarget(P, ACTOR_ACADEMY_COURTS_TOUR_EMILY, 50.0, 13.0);
  yield* wait(P, 15);
  setPosition(P, ACTOR_PLAYER, 50.0, 19.0);
  moveTarget(P, ACTOR_PLAYER, 50.0, 15.0);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* wait(P, 30);
  faceToward(P, ACTOR_PLAYER, ACTOR_ACADEMY_COURTS_TOUR_EMILY);
  yield* wait(P, 60);
  face(P, ACTOR_ACADEMY_COURTS_TOUR_EMILY, FACE_RIGHT);
  yield* wait(P, 15);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  yield* wait(P, 15);
  yield* movePlayer(P, 54.0, 13.0);
  yield* waitPlayerMove(P);
  P.V.mapSceneStage = 0x50;                               // the pointer's position
  P.V.mapSceneStage2 = 0x48;
  registerFrameTask(P, 0x01, AnimateTourPointerSprite_13);
  yield* setText(P, Text_31_48);
  yield* speak(P, ACTOR_ACADEMY_COURTS_TOUR_EMILY);
  unregisterFrameTask(P, AnimateTourPointerSprite_13);
  yield* movePlayer(P, 50.0, 19.0);
  yield* waitPlayerMove(P);
  yield* wait(P, 30);
  facePair(P, ACTOR_PLAYER, ACTOR_ACADEMY_COURTS_TOUR_EMILY);
  yield* speak(P, ACTOR_ACADEMY_COURTS_TOUR_EMILY);
  yield* wait(P, 15);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 30);
  face(P, ACTOR_ACADEMY_COURTS_TOUR_EMILY, FACE_LEFT);
  yield* wait(P, 15);
  face(P, ACTOR_PLAYER, FACE_LEFT);
  yield* wait(P, 15);
  yield* movePlayer(P, 42.0, 13.0);
  yield* waitPlayerMove(P);
  P.V.mapSceneStage = 0x20;                               // the pointer's position
  P.V.mapSceneStage2 = 0x48;
  registerFrameTask(P, 0x01, AnimateTourPointerSprite_13);
  yield* speak(P, ACTOR_ACADEMY_COURTS_TOUR_EMILY);
  unregisterFrameTask(P, AnimateTourPointerSprite_13);
  yield* movePlayer(P, 50.0, 13.0);
  yield* waitPlayerMove(P);
  facePair(P, ACTOR_PLAYER, ACTOR_ACADEMY_COURTS_TOUR_EMILY);
  yield* speak(P, ACTOR_ACADEMY_COURTS_TOUR_EMILY);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  setAnim(P, ACTOR_ACADEMY_COURTS_TOUR_EMILY, ANIM_NOD);
  yield* waitIdle(P, ACTOR_ACADEMY_COURTS_TOUR_EMILY);
  yield* wait(P, 50);
  face(P, ACTOR_ACADEMY_COURTS_TOUR_EMILY, FACE_LEFT);
  yield* wait(P, 40);
  face(P, ACTOR_ACADEMY_COURTS_TOUR_EMILY, FACE_DOWN);
  yield* wait(P, 10);
  face(P, ACTOR_ACADEMY_COURTS_TOUR_EMILY, FACE_RIGHT);
  yield* wait(P, 40);
  face(P, ACTOR_ACADEMY_COURTS_TOUR_EMILY, FACE_DOWN);
  yield* wait(P, 10);
  face(P, ACTOR_ACADEMY_COURTS_TOUR_EMILY, FACE_LEFT);
  yield* wait(P, 40);
  face(P, ACTOR_ACADEMY_COURTS_TOUR_EMILY, FACE_DOWN);
  yield* wait(P, 10);
  face(P, ACTOR_ACADEMY_COURTS_TOUR_EMILY, FACE_RIGHT);
  yield* wait(P, 50);
  setAnim(P, ACTOR_ACADEMY_COURTS_TOUR_EMILY, ANIM_NOD);
  yield* waitIdle(P, ACTOR_ACADEMY_COURTS_TOUR_EMILY);
  yield* speak(P, ACTOR_ACADEMY_COURTS_TOUR_EMILY);
  moveTarget(P, ACTOR_ACADEMY_COURTS_TOUR_EMILY, 65.0, 13.0);
  yield* wait(P, 5);
  yield* movePlayer(P, 54.0, 13.0);
  moveTarget(P, ACTOR_PLAYER, 50.0, 13.125);
  yield* waitMove(P, ACTOR_PLAYER);
  moveTarget(P, ACTOR_PLAYER, 65.0, 13.125);
  yield* waitMove(P, ACTOR_PLAYER);
  requestExit(P, 0x0F);
  endCutscene(P);
}

// ServiceAceCoachIntroCutscene (13:476E): Emily and the player walk in; Mark and Kevin come out of the
// restaurant's door, talk, and go back in; Emily leads the player up the street; exit $0E
export function* serviceAceCoachIntroCutscene(P) {
  respawnActors(P, ServiceAceCoachIntroActors_13);
  beginCutscene(P);
  setPosition(P, ACTOR_PLAYER, 63.0, 63.0);
  setPosition(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY, 63.0, 63.0);
  setPosition(P, ACTOR_SERVICE_ACE_COACH_INTRO_MARK, 63.0, 63.0);
  setPosition(P, ACTOR_SERVICE_ACE_COACH_INTRO_KEVIN, 63.0, 63.0);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  setPosition(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY, 65.0, 13.0);
  moveTarget(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY, 27.0, 13.0);
  setPosition(P, ACTOR_PLAYER, 67.0, 13.0);
  moveTarget(P, ACTOR_PLAYER, 29.0, 13.0);
  yield* wait(P, 15);
  yield* movePlayer(P, 27.0, 13.0);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* wait(P, 30);
  faceToward(P, ACTOR_PLAYER, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY);
  yield* setText(P, Text_31_53);
  yield* speak(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  face(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY, FACE_UP);
  yield* wait(P, 15);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* speak(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 30);
  yield* animateDoorOpen(P);
  yield* speak(P, ACTOR_SERVICE_ACE_COACH_INTRO_MARK);
  yield* wait(P, 15);
  setPosition(P, ACTOR_SERVICE_ACE_COACH_INTRO_BALLOON_EXCLAIM, 28.0, 11.0);
  sound(P, SFX_CHIME);
  yield* wait(P, 30);
  setPosition(P, ACTOR_SERVICE_ACE_COACH_INTRO_BALLOON_EXCLAIM, 63.0, 63.0);
  face(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY, FACE_LEFT);
  yield* wait(P, 15);
  face(P, ACTOR_PLAYER, FACE_LEFT);
  yield* movePlayer(P, 24.0, 13.0);
  yield* wait(P, 15);
  setPosition(P, ACTOR_SERVICE_ACE_COACH_INTRO_MARK, 21.0, 9.5);
  yield* wait(P, 15);
  setSpeed(P, ACTOR_SERVICE_ACE_COACH_INTRO_MARK, 0.5);
  moveTarget(P, ACTOR_SERVICE_ACE_COACH_INTRO_MARK, 21.0, 13.0);
  yield* waitMove(P, ACTOR_SERVICE_ACE_COACH_INTRO_MARK);
  face(P, ACTOR_SERVICE_ACE_COACH_INTRO_MARK, FACE_RIGHT);
  setPosition(P, ACTOR_SERVICE_ACE_COACH_INTRO_KEVIN, 21.0, 9.0);
  yield* wait(P, 15);
  setSpeed(P, ACTOR_SERVICE_ACE_COACH_INTRO_KEVIN, 0.5);
  moveTarget(P, ACTOR_SERVICE_ACE_COACH_INTRO_KEVIN, 21.0, 11.0);
  yield* waitMove(P, ACTOR_SERVICE_ACE_COACH_INTRO_KEVIN);
  yield* animateDoorClose(P);
  face(P, ACTOR_SERVICE_ACE_COACH_INTRO_KEVIN, FACE_RIGHT);
  yield* wait(P, 15);
  setAnim(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY);
  yield* speak(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY);
  face(P, ACTOR_SERVICE_ACE_COACH_INTRO_MARK, FACE_DOWN);
  setAnim(P, ACTOR_SERVICE_ACE_COACH_INTRO_MARK, ANIM_SHAKE);
  yield* waitIdle(P, ACTOR_SERVICE_ACE_COACH_INTRO_MARK);
  yield* wait(P, 30);
  faceToward(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY, ACTOR_SERVICE_ACE_COACH_INTRO_MARK);
  yield* speak(P, ACTOR_SERVICE_ACE_COACH_INTRO_MARK);
  setAnim(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY);
  yield* speak(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY);
  setAnim(P, ACTOR_SERVICE_ACE_COACH_INTRO_KEVIN, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SERVICE_ACE_COACH_INTRO_KEVIN);
  yield* speak(P, ACTOR_SERVICE_ACE_COACH_INTRO_KEVIN);
  yield* wait(P, 15);
  setAnim(P, ACTOR_SERVICE_ACE_COACH_INTRO_KEVIN, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_SERVICE_ACE_COACH_INTRO_KEVIN);
  setPosition(P, ACTOR_SERVICE_ACE_COACH_INTRO_BALLOON_QUESTION, 22.25, 9.25);
  sound(P, SFX_EMOTE);
  yield* wait(P, 30);
  setPosition(P, ACTOR_SERVICE_ACE_COACH_INTRO_BALLOON_QUESTION, 63.0, 63.0);
  yield* wait(P, 30);
  setAnim(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY);
  faceToward(P, ACTOR_PLAYER, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY);
  yield* wait(P, 50);
  faceToward(P, ACTOR_SERVICE_ACE_COACH_INTRO_MARK, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY);
  if (P.V.storyModeGenderOfMainCharacter) advanceText(P);
  yield* speak(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY);
  yield* setText(P, Text_31_62);
  yield* wait(P, 15);
  setSpeed(P, ACTOR_PLAYER, 0.75);
  moveTarget(P, ACTOR_PLAYER, 29.0, 12.0);
  yield* waitMove(P, ACTOR_PLAYER);
  moveTarget(P, ACTOR_PLAYER, 27.0, 11.0);
  yield* waitMove(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_LEFT);
  setSpeed(P, ACTOR_PLAYER, 1.0);
  yield* wait(P, 15);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 15);
  facePair(P, ACTOR_SERVICE_ACE_COACH_INTRO_KEVIN, ACTOR_SERVICE_ACE_COACH_INTRO_MARK);
  yield* wait(P, 70);
  faceToward(P, ACTOR_PLAYER, ACTOR_SERVICE_ACE_COACH_INTRO_MARK);
  faceToward(P, ACTOR_PLAYER, ACTOR_SERVICE_ACE_COACH_INTRO_KEVIN);
  yield* wait(P, 15);
  yield* speak(P, ACTOR_SERVICE_ACE_COACH_INTRO_MARK);
  setAnim(P, ACTOR_SERVICE_ACE_COACH_INTRO_MARK, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SERVICE_ACE_COACH_INTRO_MARK);
  yield* speak(P, ACTOR_SERVICE_ACE_COACH_INTRO_MARK);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 30);
  setAnim(P, ACTOR_SERVICE_ACE_COACH_INTRO_KEVIN, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_SERVICE_ACE_COACH_INTRO_KEVIN);
  yield* speak(P, ACTOR_SERVICE_ACE_COACH_INTRO_KEVIN);
  setAnim(P, ACTOR_SERVICE_ACE_COACH_INTRO_KEVIN, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SERVICE_ACE_COACH_INTRO_KEVIN);
  yield* speak(P, ACTOR_SERVICE_ACE_COACH_INTRO_KEVIN);
  yield* wait(P, 90);
  moveTarget(P, ACTOR_SERVICE_ACE_COACH_INTRO_KEVIN, 21.0, 9.5);
  yield* animateDoorOpen(P);
  moveTarget(P, ACTOR_SERVICE_ACE_COACH_INTRO_KEVIN, 20.75, 9.0);
  moveTarget(P, ACTOR_SERVICE_ACE_COACH_INTRO_MARK, 21.0, 11.0);
  setPosition(P, ACTOR_SERVICE_ACE_COACH_INTRO_KEVIN, 63.0, 63.0);
  yield* waitMove(P, ACTOR_SERVICE_ACE_COACH_INTRO_MARK);
  yield* wait(P, 15);
  faceToward(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY, ACTOR_SERVICE_ACE_COACH_INTRO_MARK);
  yield* speak(P, ACTOR_SERVICE_ACE_COACH_INTRO_MARK);
  moveTarget(P, ACTOR_SERVICE_ACE_COACH_INTRO_MARK, 21.0, 9.5);
  yield* waitMove(P, ACTOR_SERVICE_ACE_COACH_INTRO_MARK);
  moveTarget(P, ACTOR_SERVICE_ACE_COACH_INTRO_MARK, 20.75, 9.0);
  yield* wait(P, 15);
  setPosition(P, ACTOR_SERVICE_ACE_COACH_INTRO_MARK, 63.0, 63.0);
  yield* animateDoorClose(P);
  yield* movePlayer(P, 27.0, 13.0);
  yield* wait(P, 60);
  faceToward(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY, ACTOR_PLAYER);
  yield* wait(P, 15);
  setPosition(P, ACTOR_SERVICE_ACE_COACH_INTRO_BALLOON_ELLIPSIS, 28.0, 9.0);
  yield* wait(P, 90);
  setPosition(P, ACTOR_SERVICE_ACE_COACH_INTRO_BALLOON_ELLIPSIS, 63.0, 63.0);
  yield* wait(P, 15);
  yield* speak(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY);
  faceToward(P, ACTOR_PLAYER, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY);
  yield* wait(P, 30);
  yield* speak(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY);
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 60);
  moveTarget(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY, 21.0, 13.0);
  yield* waitMove(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY);
  faceToward(P, ACTOR_PLAYER, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY);
  yield* wait(P, 30);
  yield* speak(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY);
  yield* wait(P, 15);
  moveTarget(P, ACTOR_PLAYER, 23.0, 13.0);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* wait(P, 10);
  moveTarget(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY, 7.0, 13.0);
  yield* wait(P, 10);
  yield* movePlayer(P, 9.0, 13.0);
  moveTarget(P, ACTOR_PLAYER, 7.0, 13.0);
  yield* waitMove(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY);
  face(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY, FACE_UP);
  moveAngle(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY, FACE_UP, 5.0);
  setSpeed(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY, 0.34375);
  yield* wait(P, 10);
  yield* waitMove(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_UP);
  moveAngle(P, ACTOR_PLAYER, FACE_UP, 5.0);
  setSpeed(P, ACTOR_PLAYER, 0.34375);
  yield* waitMove(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY);
  setAnim(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY, ANIM_DISTANT);
  moveAngle(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY, FACE_UP, 1.0);
  yield* waitMove(P, ACTOR_PLAYER);
  setAnim(P, ACTOR_PLAYER, ANIM_DISTANT);
  moveAngle(P, ACTOR_PLAYER, FACE_UP, 1.0);
  setPosition(P, ACTOR_SERVICE_ACE_COACH_INTRO_EMILY, 63.0, 63.0);
  setPosition(P, ACTOR_PLAYER, 63.0, 63.0);
  requestExit(P, 0x0E);
  endCutscene(P);
}

export const HOOKS = [
  scene(BANK, 0x405F, arrivalWalkUp),                    // RestaurantPlazaArrival04_13 (twin academy_main_bldg_arrival01)
  scene(BANK, 0x40A5, arrivalWalkLeft),                  // RestaurantPlazaArrival06_13 (twin restaurant_plaza_arrival06)
  scene(BANK, 0x40EB, restaurantPlazaArrival01),
  scene(BANK, 0x4163, restaurantPlazaArrival02),
  scene(BANK, 0x41CF, restaurantPlazaArrivalWalkIn),
  scene(BANK, 0x427F, unused_13_PlayerSpeaksText35_48),
  scene(BANK, 0x42DE, restaurantPlazaTile01),
  scene(BANK, 0x430C, restaurantPlazaTile02),
  scene(BANK, 0x4357, restaurantPlazaTile03),
  scene(BANK, 0x43A1, restaurantPlazaTile05),
  scene(BANK, 0x43DF, restaurantPlazaTile06),
  scene(BANK, 0x4425, storyActorsWalkOffAndFadeOut),
  scene(BANK, 0x446A, storyActorsWalkOffAndFadeOutDoubles),
  scene(BANK, 0x44DF, restaurantPlazaInitScript),
  scene(BANK, 0x44F1, academyCourtsTourCutscene),
  scene(BANK, 0x476E, serviceAceCoachIntroCutscene),
];
