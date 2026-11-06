// The academy wing (bank $10, $61B1-$73ED): the coach's office corridor: the coach (by the scene variant), the
// notice board and the senior champion's welcome (facing actions), the office doors (step-on triggers), the init
// script (the trophies, the dialogue stage, the scroll limits, the doors), the farewell of the story's end
// (entry $0D: the team sees the player off) and the Island Open invitation (entry $0F).
// The location's tables (AcademyWingMapScripts_10, the actor lists, entries and records) are data.
// Port of src/story/academy_wing_10.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss1_acwing*.mtrec (scripted: the wing by stage and entry).
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FACE_DOWN, FACE_UP, FACE_LEFT, FACE_RIGHT, ANIM_WALK, ANIM_BOUNCE, ANIM_NOD,
  ANIM_SHAKE, FLAG_DOUBLES, pushTextNumber, FLAG_TEMP_SCENE_VARIANT_A, testFlag, setFlag, setText, advanceText, speak,
  speakRestore, yesNo, closeDialogue, askYesNo, setAnim, waitIdle, wait, face, faceToward, facePair, lockFacing,
  unlockFacing, setPosition, moveTarget, waitMove, moveAngle, movePlayer, waitPlayerMove, setSpeed, playerSpeed,
  nullScript, setObjdef, setActorScript, actorState, copySceneRect, copyBehaviorRect, copySceneToVram, beginCutscene,
  endCutscene, respawnActors, fadeIn, waitFadeEnd, fadeOutAndWait, sound, disableLCDSafely, enableLCD, goToLocation,
  scene,
} from "./common.js";
import {
  speakNpc03SinglesOrDoublesLine, showNpc03SinglesOrDoublesPrompt, academyWingInstallDoorTriggers,
  academyWingHideActorByProgressFlag, setAcademyWingDialogueStage,
} from "./academy_main_10.js";

const BANK = 0x10;
// actors of the wing (AcademyWingActors_10)
const ACTOR_ACADEMY_WING_WALK_75_06 = 0x03, ACTOR_ACADEMY_WING_INVISIBLE = 0x04;
const ACTOR_ACADEMY_WING_TROPHY_1 = 0x05, ACTOR_ACADEMY_WING_TROPHY_2 = 0x06;
const ACTOR_ACADEMY_WING_SLOT_6 = 0x06;               // (the second trophy's slot: the coach's "!" balloon here)
// the farewell's actors (AcademyWingInitActors0_10)
const ACTOR_ACADEMY_WING_INIT0_BALLOON_ANGRY = 0x03, ACTOR_ACADEMY_WING_INIT0_BALLOON_SWEAT = 0x04, ACTOR_ACADEMY_WING_INIT0_BALLOON_MUSIC = 0x05;
const ACTOR_ACADEMY_WING_INIT0_WALK_75_06 = 0x06, ACTOR_ACADEMY_WING_INIT0_KEVIN = 0x07, ACTOR_ACADEMY_WING_INIT0_MARK = 0x08, ACTOR_ACADEMY_WING_INIT0_EMILY = 0x09;
const ACTOR_ACADEMY_WING_INIT0_TROPHY_1 = 0x0A, ACTOR_ACADEMY_WING_INIT0_TROPHY_2 = 0x0B;
// the invitation's actors (AcademyWingInitActors1_10)
const ACTOR_ACADEMY_WING_INIT1_WALK_75_06 = 0x03, ACTOR_ACADEMY_WING_INIT1_TROPHY_1 = 0x04, ACTOR_ACADEMY_WING_INIT1_TROPHY_2 = 0x05;
const ACTOR_ACADEMY_WING_INIT1_BALLOON_EXCLAIM_1 = 0x06, ACTOR_ACADEMY_WING_INIT1_BALLOON_EXCLAIM_2 = 0x07;
const OBJ_BALLOON_QUESTION = 0x4D, OBJ_BALLOON_MUSIC = 0x51, OBJ_BALLOON_SWEAT = 0x53;
const ANIM_TROPHY_SINGLES = 0x06;
const ACTORF_OAM_ATTR = 0x37, OAM_XFLIP = 0x20;
const SFX_APPEAR2 = 0x96, SFX_CHIME = 0x97, SFX_EMOTE = 0x98, SFX_APPEAR1 = 0x99, SFX_DOOR_ALT = 0x79;
const STORYLOC_DORM_ROOM = 0x0A, STORYLOC_ACADEMY_ENTRANCE = 0x14;
const ACADEMYWINGSTAGE_SENIOR_CHAMP = 0x01, ACADEMYWINGSTAGE_COMPLETE = 0x03;
const FLAG_WON_ISLAND_OPEN_DOUBLES_FINAL = 0x35, FLAG_WON_ISLAND_OPEN_SINGLES_FINAL = 0x3C;
const FLAG_REACHED_ISLAND_OPEN_SINGLES = 0xAE, FLAG_REACHED_ISLAND_OPEN_DOUBLES = 0xAF;
const Text_30_449 = 0x01C1, Text_30_451 = 0x01C3, Text_30_475 = 0x01DB, Text_30_482 = 0x01E2, Text_30_491 = 0x01EB;
const Text_30_492 = 0x01EC, Text_30_498 = 0x01F2, Text_30_504 = 0x01F8, Text_30_511 = 0x01FF, Text_30_512 = 0x0200;
const Text_30_513 = 0x0201, Text_30_515 = 0x0203, Text_30_516 = 0x0204, Text_30_517 = 0x0205;
// data of this bank: the two actor lists, the walk into the office
const AcademyWingInitActors0_10 = 0x6F45, AcademyWingInitActors1_10 = 0x739E, ActorScript_10_0 = 0x741C;
// routines not ported here (src/story/walks_10.asm)
const MapArrivalWalkPair_10 = 0x7B5F;
const YES = 0;

// script_set_anim actor, anim / script_wait_idle actor
function* animIdle(P, actor, anim) {
  setAnim(P, actor, anim);
  yield* waitIdle(P, actor);
}
// a balloon over a head: placed, its sound, held, put away
function* balloon(P, actor, x, y, sfx, frames) {
  setPosition(P, actor, x, y);
  sound(P, sfx);
  yield* wait(P, frames);
  setPosition(P, actor, 63.0, 63.0);
}

// AcademyWingNpc03_10 (10:623B): the coach: in variant A his short line; else a "!" over him (mirrored), his
// question (doubles: its other wording) and on a yes the variant A answer (FLAG_TEMP_SCENE_VARIANT_A set)
export function* academyWingNpc03(P) {
  faceToward(P, ACTOR_PLAYER, ACTOR_ACADEMY_WING_WALK_75_06);
  if (testFlag(P, FLAG_TEMP_SCENE_VARIANT_A)) yield* setText(P, Text_30_517);
  else {                                                              // .altText
    const attr = (actorState(P, ACTOR_ACADEMY_WING_SLOT_6) + ACTORF_OAM_ATTR) & 0xFFFF;
    P.bus.w8(attr, P.bus.u8(attr) | OAM_XFLIP);
    setPosition(P, ACTOR_ACADEMY_WING_SLOT_6, 27.5, 46.0);
    sound(P, SFX_CHIME);
    yield* wait(P, 60);
    setPosition(P, ACTOR_ACADEMY_WING_SLOT_6, 1.0, 1.0);
    yield* setText(P, Text_30_513);
    if (testFlag(P, FLAG_DOUBLES)) advanceText(P);
    yield* speakRestore(P, ACTOR_ACADEMY_WING_WALK_75_06);            // .speak
    yield* setText(P, Text_30_515);
    const choice = yield* yesNo(P);
    yield* closeDialogue(P);
    yield* wait(P, 5);
    if (choice === YES) {
      yield* setText(P, Text_30_516);
      setFlag(P, FLAG_TEMP_SCENE_VARIANT_A);
    }
  }
  yield* speak(P, ACTOR_ACADEMY_WING_WALK_75_06);                    // .done
}

// AcademyWingFacing02_10 (10:62D0): the coach's door: as senior champion his welcome (the player and partner cheer,
// he shakes his head; they walk back down); otherwise the notice (AcademyWingFacing01_10)
export function* academyWingFacing02(P) {
  if (P.V.mapSceneStage !== ACADEMYWINGSTAGE_SENIOR_CHAMP) return yield* academyWingFacing01(P);
  beginCutscene(P);
  playerSpeed(P, 1.0);
  yield* movePlayer(P, 33.0, 51.0);
  yield* setText(P, Text_30_449);
  face(P, ACTOR_ACADEMY_WING_WALK_75_06, FACE_DOWN);
  yield* wait(P, 10);
  yield* speak(P, ACTOR_ACADEMY_WING_INVISIBLE);
  yield* wait(P, 10);
  setAnim(P, ACTOR_PARTNER, ANIM_BOUNCE);
  yield* animIdle(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* animIdle(P, ACTOR_ACADEMY_WING_WALK_75_06, ANIM_SHAKE);
  playerSpeed(P, 0.75);
  yield* speak(P, ACTOR_ACADEMY_WING_INVISIBLE);
  face(P, ACTOR_ACADEMY_WING_WALK_75_06, FACE_RIGHT);
  yield* movePlayer(P, 33.0, 59.0);
  yield* animIdle(P, ACTOR_PLAYER, ANIM_BOUNCE);
  endCutscene(P);
}
// AcademyWingFacing01_10 (10:6355): the notice
export function* academyWingFacing01(P) {
  yield* setText(P, Text_30_451);
  yield* speak(P, ACTOR_PLAYER);
}

// AcademyWingTile01_10 (10:6372) / AcademyWingTile02_10 (10:63E0): through the coach's door, in (walking up) and
// out (down); the door opens and closes around the walk
export function* academyWingTile01(P) {
  setSpeed(P, ACTOR_PLAYER, 0.625);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* academyWingOpenDoor(P);
  if (testFlag(P, FLAG_DOUBLES)) {
    moveTarget(P, ACTOR_PARTNER, 33.0, 61.0);
    yield* waitMove(P, ACTOR_PARTNER);
  }
  moveTarget(P, ACTOR_PLAYER, 33.0, 57.0);                            // .walkPlayer
  yield* waitMove(P, ACTOR_PLAYER);
  yield* wait(P, 2);
  moveAngle(P, ACTOR_PLAYER, FACE_UP, 2.0);
  yield* waitMove(P, ACTOR_PLAYER);
  moveAngle(P, ACTOR_PLAYER, FACE_LEFT, 2.0);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* wait(P, 10);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* academyWingCloseDoor(P);
}
export function* academyWingTile02(P) {
  face(P, ACTOR_PLAYER, FACE_DOWN);
  setSpeed(P, ACTOR_PLAYER, 0.5);
  yield* academyWingOpenDoor(P);
  moveTarget(P, ACTOR_PARTNER, 33.0, 53.0);
  testFlag(P, FLAG_DOUBLES);                                          // (its jump goes to the next line either way)
  moveTarget(P, ACTOR_PLAYER, 33.0, 57.0);                            // .walkPlayer
  yield* waitMove(P, ACTOR_PLAYER);
  moveAngle(P, ACTOR_PLAYER, FACE_DOWN, 2.0);
  yield* waitMove(P, ACTOR_PLAYER);
  moveAngle(P, ACTOR_PLAYER, FACE_RIGHT, 2.0);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* wait(P, 5);
  yield* academyWingCloseDoor(P);
}

// AcademyWingInitScript_10 (10:643B): the trophy case (the Island Open trophies shown once won), the dialogue
// stage; at the story's end the coach's list (AcademyWingInitActors1_10) with him at the top of the corridor; as
// senior champion he waits at his door; the corridor's scroll limits and the screen redrawn; then by the entry:
// $0D the farewell (.stage6), $0F the invitation (AcademyWingEntry0fScene), else the doors' exits.
export function* academyWingInitScript(P) {
  const { V } = P;
  setAnim(P, ACTOR_ACADEMY_WING_TROPHY_1, ANIM_TROPHY_SINGLES);
  if (!testFlag(P, FLAG_WON_ISLAND_OPEN_SINGLES_FINAL)) setPosition(P, ACTOR_ACADEMY_WING_TROPHY_1, 1.0, 1.0);
  if (!testFlag(P, FLAG_WON_ISLAND_OPEN_DOUBLES_FINAL)) setPosition(P, ACTOR_ACADEMY_WING_TROPHY_2, 1.0, 1.0);
  setAcademyWingDialogueStage(P);                                     // .byStage
  if (V.mapSceneStage === ACADEMYWINGSTAGE_COMPLETE) {
    respawnActors(P, AcademyWingInitActors1_10);
    beginCutscene(P);
    copyBehaviorRect(P, 0x02, 0x02, 0x1E, 0x38, 0x20, 0x38);          // the coach's door closed
    P.callRom(BANK, MapArrivalWalkPair_10);
    academyWingHideActorByProgressFlag(P);
    setPosition(P, ACTOR_ACADEMY_WING_INIT1_WALK_75_06, 29.0, 48.0);
    face(P, ACTOR_ACADEMY_WING_INIT1_WALK_75_06, FACE_UP);
  }
  if (V.mapSceneStage === ACADEMYWINGSTAGE_SENIOR_CHAMP) setPosition(P, ACTOR_ACADEMY_WING_WALK_75_06, 25.625, 50.75);   // .stage4
  V.mapScrollMinX = 0x16; V.mapScrollMinY = 0x28;                     // .stage5
  V.mapWidthTiles = 0x40; V.mapHeightTiles = 0x3E;
  disableLCDSafely(P);
  copySceneToVram(P, 0);
  enableLCD(P);
  switch (V.storyModeEntryPoint) {
    case 0x0D: return yield* academyWingFarewell(P);
    case 0x0F: return yield* academyWingEntry0fScene(P);
  }
  academyWingInstallDoorTriggers(P);
}

// AcademyWingInitScript_10.stage6: the farewell (entry $0D, after the dorm room's door scene): the team (Kevin,
// Mark, Emily) and the coach say goodbye; the coach tells how many Island Opens are reached; his question (no:
// Emily asks again until yes); on to the dorm room's narration (entry $0A).
function* academyWingFarewell(P) {
  const { V } = P;
  const COACH = ACTOR_ACADEMY_WING_INIT0_WALK_75_06, KEVIN = ACTOR_ACADEMY_WING_INIT0_KEVIN, MARK = ACTOR_ACADEMY_WING_INIT0_MARK, EMILY = ACTOR_ACADEMY_WING_INIT0_EMILY;
  const doubles = () => testFlag(P, FLAG_DOUBLES);
  respawnActors(P, AcademyWingInitActors0_10);
  beginCutscene(P);
  setAnim(P, ACTOR_ACADEMY_WING_INIT0_TROPHY_1, ANIM_TROPHY_SINGLES);
  if (!testFlag(P, FLAG_WON_ISLAND_OPEN_SINGLES_FINAL)) setPosition(P, ACTOR_ACADEMY_WING_INIT0_TROPHY_1, 1.0, 1.0);
  if (!testFlag(P, FLAG_WON_ISLAND_OPEN_DOUBLES_FINAL)) setPosition(P, ACTOR_ACADEMY_WING_INIT0_TROPHY_2, 1.0, 1.0);   // .placeActors
  playerSpeed(P, 7.5);                                                // .done
  yield* movePlayer(P, 31.0, 59.0);
  yield* waitPlayerMove(P);
  setPosition(P, ACTOR_PLAYER, 53.0, 59.0);
  V.storyModeShowLocationName = 0;
  setPosition(P, ACTOR_PLAYER, 43.0, 59.0);
  fadeIn(P, 8);
  yield* waitFadeEnd(P);
  yield* wait(P, 60);
  yield* animIdle(P, COACH, ANIM_BOUNCE);
  yield* setText(P, Text_30_475);
  yield* speak(P, COACH);
  setAnim(P, KEVIN, ANIM_BOUNCE);
  setAnim(P, MARK, ANIM_BOUNCE);
  yield* animIdle(P, EMILY, ANIM_BOUNCE);
  facePair(P, KEVIN, MARK);
  yield* wait(P, 40);
  face(P, KEVIN, FACE_UP);
  face(P, MARK, FACE_UP);
  yield* wait(P, 40);
  setPosition(P, ACTOR_ACADEMY_WING_INIT0_BALLOON_MUSIC, 35.5, 49.0);
  sound(P, SFX_CHIME);
  yield* speak(P, KEVIN);
  setPosition(P, ACTOR_ACADEMY_WING_INIT0_BALLOON_MUSIC, 63.0, 63.0);
  yield* animIdle(P, COACH, ANIM_NOD);
  yield* speak(P, COACH);
  if (doubles()) {
    // Mark is angry; Kevin and Emily step to him in turn and answer
    setPosition(P, ACTOR_ACADEMY_WING_INIT0_BALLOON_ANGRY, 33.5, 49.0);
    sound(P, SFX_APPEAR1);
    yield* wait(P, 10);
    advanceText(P);
    yield* speak(P, MARK);
    setPosition(P, ACTOR_ACADEMY_WING_INIT0_BALLOON_ANGRY, 63.0, 63.0);
    yield* stepToMark(P, KEVIN, 33.0, 34.0, () => setAnim(P, MARK, ANIM_BOUNCE));
    yield* speak(P, KEVIN);
    yield* stepToMark(P, EMILY, 31.0, 30.0, () => setAnim(P, MARK, ANIM_BOUNCE));
    yield* speak(P, EMILY);
  } else {                                                            // .placeActors2
    setPosition(P, ACTOR_ACADEMY_WING_INIT0_BALLOON_MUSIC, 33.5, 49.0);
    sound(P, SFX_CHIME);
    yield* wait(P, 30);
    yield* speak(P, MARK);
    setPosition(P, ACTOR_ACADEMY_WING_INIT0_BALLOON_MUSIC, 63.0, 63.0);
  }
  yield* stepToMark(P, KEVIN, 33.0, 34.0, () => {});                  // .face
  yield* animIdle(P, MARK, ANIM_BOUNCE);
  yield* stepToMark(P, EMILY, 31.0, 30.0, () => {});
  yield* animIdle(P, MARK, ANIM_BOUNCE);
  setAnim(P, EMILY, ANIM_NOD);
  yield* animIdle(P, KEVIN, ANIM_NOD);
  // the coach paces before them
  for (const x of [30.0, 34.0, 32.0]) {
    moveTarget(P, COACH, x, 47.0);
    yield* waitMove(P, COACH);
    face(P, COACH, FACE_DOWN);
    yield* wait(P, x === 32.0 ? 10 : 30);
  }
  yield* animIdle(P, COACH, ANIM_BOUNCE);
  face(P, KEVIN, FACE_UP);
  face(P, MARK, FACE_UP);
  face(P, EMILY, FACE_UP);
  yield* setText(P, Text_30_482);
  yield* speak(P, COACH);
  // the team's reaction: sweat drops and angry marks (the music balloon becomes a sweat drop too)
  setObjdef(P, OBJ_BALLOON_SWEAT, ACTOR_ACADEMY_WING_INIT0_BALLOON_ANGRY);
  setAnim(P, ACTOR_ACADEMY_WING_INIT0_BALLOON_ANGRY, ANIM_WALK);
  setObjdef(P, OBJ_BALLOON_SWEAT, ACTOR_ACADEMY_WING_INIT0_BALLOON_MUSIC);
  setAnim(P, ACTOR_ACADEMY_WING_INIT0_BALLOON_MUSIC, ANIM_WALK);
  setPosition(P, ACTOR_ACADEMY_WING_INIT0_BALLOON_ANGRY, 31.5, 49.0);
  sound(P, SFX_APPEAR2);
  yield* wait(P, 40);
  setPosition(P, ACTOR_ACADEMY_WING_INIT0_BALLOON_SWEAT, 33.5, 49.0);
  sound(P, SFX_APPEAR2);
  yield* wait(P, 40);
  setPosition(P, ACTOR_ACADEMY_WING_INIT0_BALLOON_ANGRY, 63.0, 63.0);
  setPosition(P, ACTOR_ACADEMY_WING_INIT0_BALLOON_MUSIC, 35.5, 49.0);
  sound(P, SFX_APPEAR2);
  yield* wait(P, 40);
  setPosition(P, ACTOR_ACADEMY_WING_INIT0_BALLOON_SWEAT, 63.0, 63.0);
  yield* wait(P, 40);
  setPosition(P, ACTOR_ACADEMY_WING_INIT0_BALLOON_MUSIC, 63.0, 63.0);
  yield* teamFaces(P, FACE_DOWN);
  yield* wait(P, 120);
  yield* teamFaces(P, FACE_UP);
  yield* wait(P, 40);
  faceToward(P, KEVIN, MARK);
  yield* wait(P, 1);
  yield* animIdle(P, MARK, ANIM_BOUNCE);
  setPosition(P, ACTOR_ACADEMY_WING_INIT0_BALLOON_MUSIC, 35.5, 49.0);
  sound(P, SFX_APPEAR2);
  yield* wait(P, 60);
  faceToward(P, EMILY, MARK);
  yield* wait(P, 1);
  yield* animIdle(P, MARK, ANIM_BOUNCE);
  setPosition(P, ACTOR_ACADEMY_WING_INIT0_BALLOON_ANGRY, 31.5, 49.0);
  sound(P, SFX_APPEAR2);
  yield* wait(P, 60);
  // the player (and partner) walk up through the coach's door
  if (doubles()) {
    nullScript(P, ACTOR_PARTNER);
    setPosition(P, ACTOR_PARTNER, 45.0, 59.0);
    moveTarget(P, ACTOR_PLAYER, 33.0, 59.0);
    moveTarget(P, ACTOR_PARTNER, 35.0, 59.0);
    yield* waitMove(P, ACTOR_PARTNER);
    yield* wait(P, 5);
    face(P, ACTOR_PLAYER, FACE_UP);
    yield* academyWingOpenDoor(P);
    moveTarget(P, ACTOR_PLAYER, 33.0, 53.0);
    moveTarget(P, ACTOR_PARTNER, 33.0, 59.0);
    yield* waitMove(P, ACTOR_PARTNER);
    moveTarget(P, ACTOR_PLAYER, 31.0, 53.0);
    moveTarget(P, ACTOR_PARTNER, 33.0, 53.0);
    yield* waitMove(P, ACTOR_PARTNER);
    moveTarget(P, ACTOR_PARTNER, 33.0, 53.0);
    yield* waitMove(P, ACTOR_PARTNER);
    face(P, ACTOR_PLAYER, FACE_UP);
    face(P, ACTOR_PARTNER, FACE_UP);
    yield* wait(P, 1);
  } else {                                                            // .walkPlayer
    moveTarget(P, ACTOR_PLAYER, 33.0, 59.0);
    yield* waitMove(P, ACTOR_PLAYER);
    face(P, ACTOR_PLAYER, FACE_UP);
    yield* academyWingOpenDoor(P);
    moveTarget(P, ACTOR_PLAYER, 33.0, 53.0);
    yield* waitMove(P, ACTOR_PLAYER);
    moveTarget(P, ACTOR_PLAYER, 32.0, 53.0);
    yield* waitMove(P, ACTOR_PLAYER);
    face(P, ACTOR_PLAYER, FACE_UP);
    yield* wait(P, 1);
  }
  yield* academyWingCloseDoor(P);                                     // .academyWingCloseDoor
  setPosition(P, ACTOR_ACADEMY_WING_INIT0_BALLOON_ANGRY, 63.0, 63.0);
  setPosition(P, ACTOR_ACADEMY_WING_INIT0_BALLOON_MUSIC, 63.0, 63.0);
  yield* wait(P, 10);
  yield* teamFaces(P, FACE_DOWN);
  yield* wait(P, 1);
  setAnim(P, COACH, ANIM_BOUNCE);
  setAnim(P, KEVIN, ANIM_BOUNCE);
  setAnim(P, MARK, ANIM_BOUNCE);
  yield* animIdle(P, EMILY, ANIM_BOUNCE);
  yield* wait(P, 30);
  moveTarget(P, MARK, 35.0, 51.0);
  moveTarget(P, KEVIN, 37.0, 51.0);
  moveTarget(P, EMILY, 29.0, 53.0);
  yield* waitMove(P, EMILY);
  face(P, EMILY, FACE_RIGHT);
  moveTarget(P, MARK, 35.0, 53.0);
  moveTarget(P, KEVIN, 37.0, 53.0);
  yield* waitMove(P, KEVIN);
  face(P, MARK, FACE_LEFT);
  face(P, KEVIN, FACE_LEFT);
  yield* wait(P, 10);
  if (doubles()) {
    yield* wait(P, 60);
    faceToward(P, ACTOR_PARTNER, ACTOR_PLAYER);
    yield* animIdle(P, ACTOR_PLAYER, ANIM_BOUNCE);
    yield* wait(P, 20);
    faceToward(P, ACTOR_PLAYER, ACTOR_PARTNER);
    yield* wait(P, 1);
    yield* animIdle(P, ACTOR_PARTNER, ANIM_NOD);
    yield* wait(P, 20);
    face(P, ACTOR_PLAYER, FACE_UP);
    face(P, ACTOR_PARTNER, FACE_UP);
    setAnim(P, KEVIN, ANIM_NOD);
    setAnim(P, MARK, ANIM_NOD);
    yield* animIdle(P, EMILY, ANIM_NOD);
    yield* wait(P, 40);
    setAnim(P, ACTOR_PLAYER, ANIM_NOD);
    yield* animIdle(P, ACTOR_PARTNER, ANIM_NOD);
    moveTarget(P, ACTOR_PLAYER, 31.0, 50.0);
    moveTarget(P, ACTOR_PARTNER, 33.0, 50.0);
    yield* waitMove(P, ACTOR_PARTNER);
  } else {                                                            // .placeActors3
    yield* balloon(P, ACTOR_ACADEMY_WING_INIT0_BALLOON_SWEAT, 33.5, 51.0, SFX_APPEAR2, 80);
    faceToward(P, EMILY, ACTOR_PLAYER);
    yield* wait(P, 40);
    faceToward(P, ACTOR_PLAYER, EMILY);
    yield* wait(P, 1);
    yield* animIdle(P, EMILY, ANIM_NOD);
    yield* wait(P, 20);
    face(P, ACTOR_PLAYER, FACE_UP);
    setAnim(P, KEVIN, ANIM_NOD);
    setAnim(P, MARK, ANIM_NOD);
    yield* animIdle(P, EMILY, ANIM_NOD);
    yield* wait(P, 40);
    setAnim(P, ACTOR_PLAYER, ANIM_NOD);
    moveTarget(P, ACTOR_PLAYER, 32.0, 50.0);
    yield* waitMove(P, ACTOR_PLAYER);
  }
  yield* wait(P, 1);                                                  // .wait
  moveTarget(P, EMILY, 30.0, 53.0);
  moveTarget(P, MARK, 32.0, 53.0);
  moveTarget(P, KEVIN, 34.0, 53.0);
  yield* waitMove(P, KEVIN);
  face(P, EMILY, FACE_UP);
  face(P, MARK, FACE_UP);
  face(P, KEVIN, FACE_UP);
  yield* animIdle(P, COACH, ANIM_NOD);
  // "N Island Opens": 2, + 1 for each format reached
  let opens = 0x0002;
  if (testFlag(P, FLAG_REACHED_ISLAND_OPEN_SINGLES)) opens++;
  if (testFlag(P, FLAG_REACHED_ISLAND_OPEN_DOUBLES)) opens++;          // .checkFlag
  pushTextNumber(P, opens);                                           // .pushArg
  yield* speak(P, COACH);
  yield* animIdle(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* speak(P, COACH);
  yield* animIdle(P, ACTOR_PLAYER, ANIM_NOD);
  setObjdef(P, OBJ_BALLOON_MUSIC, ACTOR_ACADEMY_WING_INIT0_BALLOON_MUSIC);
  setAnim(P, ACTOR_ACADEMY_WING_INIT0_BALLOON_MUSIC, ANIM_WALK);
  setPosition(P, ACTOR_ACADEMY_WING_INIT0_BALLOON_MUSIC, 35.5, 51.0);
  sound(P, SFX_CHIME);
  yield* wait(P, 20);
  yield* speak(P, KEVIN);
  setPosition(P, ACTOR_ACADEMY_WING_INIT0_BALLOON_MUSIC, 63.0, 63.0);
  yield* animIdle(P, COACH, ANIM_NOD);
  yield* speak(P, COACH);
  facePair(P, MARK, KEVIN);
  setAnim(P, KEVIN, ANIM_NOD);
  yield* animIdle(P, MARK, ANIM_NOD);
  yield* wait(P, 40);
  facePair(P, MARK, EMILY);
  setAnim(P, EMILY, ANIM_NOD);
  yield* animIdle(P, MARK, ANIM_NOD);
  yield* wait(P, 40);
  face(P, KEVIN, FACE_UP);
  face(P, MARK, FACE_UP);
  face(P, EMILY, FACE_UP);
  yield* wait(P, 40);
  setAnim(P, EMILY, ANIM_NOD);
  setAnim(P, KEVIN, ANIM_NOD);
  yield* animIdle(P, MARK, ANIM_NOD);
  yield* wait(P, 60);
  setObjdef(P, OBJ_BALLOON_QUESTION, ACTOR_ACADEMY_WING_INIT0_BALLOON_MUSIC);
  setAnim(P, ACTOR_ACADEMY_WING_INIT0_BALLOON_MUSIC, ANIM_WALK);
  yield* balloon(P, ACTOR_ACADEMY_WING_INIT0_BALLOON_MUSIC, 33.5, 45.5, SFX_EMOTE, 80);
  if ((yield* askYesNo(P, COACH)) !== YES) {
    yield* animIdle(P, COACH, ANIM_BOUNCE);
    yield* speak(P, COACH);
    // the team steps up to the player (and partner) one by one
    const doubles2 = doubles();
    const turnTo = actor => { faceToward(P, actor, ACTOR_PLAYER); if (doubles2) faceToward(P, actor, ACTOR_PARTNER); };
    moveTarget(P, MARK, 32.0, 52.0);
    yield* waitMove(P, MARK);
    turnTo(MARK);
    yield* speak(P, MARK);
    yield* wait(P, 30);
    moveTarget(P, KEVIN, 34.0, 52.0);
    yield* waitMove(P, KEVIN);
    turnTo(KEVIN);
    yield* speak(P, KEVIN);
    yield* wait(P, 30);
    moveTarget(P, EMILY, doubles2 ? 29.0 : 30.0, 50.0);
    yield* waitMove(P, EMILY);
    facePair(P, EMILY, ACTOR_PLAYER);
    if (doubles2) faceToward(P, EMILY, ACTOR_PARTNER);
    do {                                                              // .loop: Emily asks until yes
      yield* animIdle(P, EMILY, ANIM_SHAKE);
      yield* setText(P, Text_30_491);
    } while ((yield* askYesNo(P, EMILY)) !== YES);
  }
  yield* animIdle(P, COACH, ANIM_NOD);                                // .animate
  face(P, KEVIN, FACE_UP);
  face(P, MARK, FACE_UP);
  face(P, EMILY, FACE_UP);
  face(P, ACTOR_PLAYER, FACE_UP);
  if (doubles()) face(P, ACTOR_PARTNER, FACE_UP);
  yield* wait(P, 20);                                                 // .wait2
  setAnim(P, KEVIN, ANIM_NOD);
  setAnim(P, MARK, ANIM_NOD);
  setAnim(P, EMILY, ANIM_NOD);
  if (doubles()) setAnim(P, ACTOR_PARTNER, ANIM_NOD);
  yield* animIdle(P, ACTOR_PLAYER, ANIM_NOD);                         // .animate2
  yield* setText(P, Text_30_492);
  yield* speak(P, COACH);
  yield* fadeOutAndWait(P, 4);
  yield* wait(P, 50);
  goToLocation(P, STORYLOC_DORM_ROOM, 0x0A);
}
// a team member steps to Mark's side (turning Mark to it first, its facing locked for the two steps), Mark
// reacting (between the steps) and both face each other
function* stepToMark(P, actor, x1, x2, between) {
  faceToward(P, ACTOR_ACADEMY_WING_INIT0_MARK, actor);
  yield* wait(P, 1);
  lockFacing(P, actor);
  moveTarget(P, actor, x1, 51.0);
  yield* waitMove(P, actor);
  between();
  moveTarget(P, actor, x2, 51.0);
  yield* waitMove(P, actor);
  unlockFacing(P, actor);
  facePair(P, ACTOR_ACADEMY_WING_INIT0_MARK, actor);
}
// Kevin, Mark and Emily face one way
function* teamFaces(P, facing) {
  face(P, ACTOR_ACADEMY_WING_INIT0_KEVIN, facing);
  face(P, ACTOR_ACADEMY_WING_INIT0_MARK, facing);
  face(P, ACTOR_ACADEMY_WING_INIT0_EMILY, facing);
}

// AcademyWingEntry0fScene (10:6FCD): the Island Open invitation: the coach (his list) with the trophy case; his
// lines of the format, the player's answer (yes: a nod; no: a shake) and his news (the "!" balloons); his question
// until yes (Text_30_511 again on no); then the player (and partner) walk into the office and on to the academy
// entrance (entry $0C).
export function* academyWingEntry0fScene(P) {
  const COACH = ACTOR_ACADEMY_WING_INIT1_WALK_75_06;
  respawnActors(P, AcademyWingInitActors1_10);
  beginCutscene(P);
  setAnim(P, ACTOR_ACADEMY_WING_INIT1_TROPHY_1, ANIM_TROPHY_SINGLES);
  if (testFlag(P, FLAG_DOUBLES)) {
    nullScript(P, ACTOR_PARTNER);
    setPosition(P, ACTOR_PLAYER, 31.0, 52.0);
    setPosition(P, ACTOR_PARTNER, 33.0, 52.0);
    face(P, ACTOR_PARTNER, FACE_UP);
    if (!testFlag(P, FLAG_WON_ISLAND_OPEN_SINGLES_FINAL)) setPosition(P, ACTOR_ACADEMY_WING_INIT1_TROPHY_1, 63.0, 63.0);
  } else if (!testFlag(P, FLAG_WON_ISLAND_OPEN_DOUBLES_FINAL)) setPosition(P, ACTOR_ACADEMY_WING_INIT1_TROPHY_2, 63.0, 63.0);   // .checkFlag2
  face(P, ACTOR_PLAYER, FACE_UP);                                     // .face2
  P.V.storyModeShowLocationName = 0;
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  yield* wait(P, 60);
  yield* setText(P, Text_30_498);
  yield* speakNpc03SinglesOrDoublesLine(P);
  if (testFlag(P, FLAG_DOUBLES)) setAnim(P, ACTOR_PARTNER, ANIM_BOUNCE);
  yield* animIdle(P, ACTOR_PLAYER, ANIM_BOUNCE);                      // .animate3
  yield* showNpc03SinglesOrDoublesPrompt(P);
  const choice = yield* yesNo(P);
  yield* closeDialogue(P);
  yield* wait(P, 5);
  if (choice === YES) {
    yield* animIdle(P, ACTOR_PLAYER, ANIM_NOD);
    advanceText(P);
  } else yield* animIdle(P, ACTOR_PLAYER, ANIM_SHAKE);                // .animate4
  yield* wait(P, 10);                                                 // .wait3
  yield* animIdle(P, COACH, ANIM_NOD);
  yield* speak(P, COACH);
  face(P, COACH, FACE_UP);
  yield* wait(P, 80);
  yield* setText(P, Text_30_504);
  yield* speakNpc03SinglesOrDoublesLine(P);
  if (testFlag(P, FLAG_DOUBLES)) {
    setPosition(P, ACTOR_ACADEMY_WING_INIT1_BALLOON_EXCLAIM_1, 32.5, 50.0);
    setPosition(P, ACTOR_ACADEMY_WING_INIT1_BALLOON_EXCLAIM_2, 34.5, 50.0);
    sound(P, SFX_CHIME);
    yield* wait(P, 80);
    setPosition(P, ACTOR_ACADEMY_WING_INIT1_BALLOON_EXCLAIM_1, 63.0, 63.0);
    setPosition(P, ACTOR_ACADEMY_WING_INIT1_BALLOON_EXCLAIM_2, 63.0, 63.0);
  } else yield* balloon(P, ACTOR_ACADEMY_WING_INIT1_BALLOON_EXCLAIM_1, 33.5, 50.0, SFX_CHIME, 80);   // .placeActors4
  face(P, COACH, FACE_DOWN);                                          // .face3
  yield* wait(P, 1);
  yield* speakNpc03SinglesOrDoublesLine(P);
  yield* wait(P, 30);
  yield* animIdle(P, COACH, ANIM_NOD);
  yield* speak(P, COACH);
  setSpeed(P, COACH, 0.5);
  moveTarget(P, COACH, 34.0, 48.0);
  yield* waitMove(P, COACH);
  yield* wait(P, 40);
  yield* animIdle(P, COACH, ANIM_NOD);
  yield* animIdle(P, COACH, ANIM_NOD);
  moveTarget(P, COACH, 32.0, 48.0);
  yield* waitMove(P, COACH);
  face(P, COACH, FACE_DOWN);
  yield* wait(P, 10);
  yield* speak(P, COACH);
  yield* animIdle(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* animIdle(P, COACH, ANIM_NOD);
  while ((yield* askYesNo(P, COACH)) !== YES) {                       // .loopB
    yield* animIdle(P, ACTOR_PLAYER, ANIM_SHAKE);
    yield* animIdle(P, COACH, ANIM_BOUNCE);
    yield* setText(P, Text_30_511);
  }
  if (testFlag(P, FLAG_DOUBLES)) {                                    // .checkDoubles
    yield* animIdle(P, ACTOR_PLAYER, ANIM_NOD);
    yield* animIdle(P, COACH, ANIM_NOD);
    yield* setText(P, Text_30_512);
    yield* speak(P, COACH);
    setAnim(P, ACTOR_PLAYER, ANIM_NOD);
    yield* animIdle(P, ACTOR_PARTNER, ANIM_NOD);
    yield* wait(P, 10);
    facePair(P, ACTOR_PARTNER, ACTOR_PLAYER);
    yield* wait(P, 30);
    setAnim(P, ACTOR_PLAYER, ANIM_NOD);
    yield* animIdle(P, ACTOR_PARTNER, ANIM_NOD);
    face(P, ACTOR_PARTNER, FACE_DOWN);
    moveTarget(P, ACTOR_PLAYER, 33.0, 54.0);
    yield* waitMove(P, ACTOR_PLAYER);
    moveTarget(P, ACTOR_PLAYER, 33.0, 55.0);
    moveTarget(P, ACTOR_PARTNER, 33.0, 53.0);
    yield* waitMove(P, ACTOR_PARTNER);
    yield* academyWingOpenDoor(P);
    setActorScript(P, ACTOR_PLAYER, ActorScript_10_0);
    setActorScript(P, ACTOR_PARTNER, ActorScript_10_0);
    yield* wait(P, 40);
  } else {                                                            // .animate5
    yield* animIdle(P, ACTOR_PLAYER, ANIM_NOD);
    yield* animIdle(P, COACH, ANIM_NOD);
    yield* setText(P, Text_30_512);
    yield* speak(P, COACH);
    yield* animIdle(P, ACTOR_PLAYER, ANIM_NOD);
    yield* wait(P, 30);
    moveTarget(P, ACTOR_PLAYER, 33.0, 52.0);
    yield* waitMove(P, ACTOR_PLAYER);
    moveTarget(P, ACTOR_PLAYER, 33.0, 55.0);
    yield* waitMove(P, ACTOR_PLAYER);
    yield* academyWingOpenDoor(P);
    setActorScript(P, ACTOR_PLAYER, ActorScript_10_0);
    yield* wait(P, 20);
  }
  yield* academyWingCloseDoor(P);                                     // .academyWingCloseDoor2
  yield* wait(P, 60);
  yield* fadeOutAndWait(P, 2);
  goToLocation(P, STORYLOC_ACADEMY_ENTRANCE, 0x0C);
}

// AcademyWingOpenDoor_10 (10:7339) / AcademyWingCloseDoor_10 (10:736F): the coach's door frames (scene cells
// (3/7/11, 56)) copied over the door at (32, 56)
export function* academyWingOpenDoor(P) {
  yield* wait(P, 10);
  sound(P, SFX_DOOR_ALT);
  yield* copySceneRect(P, 7, 56, 32, 56, 2, 2);
  yield* wait(P, 2);
  yield* copySceneRect(P, 11, 56, 32, 56, 2, 2);
  yield* wait(P, 4);
}
export function* academyWingCloseDoor(P) {
  sound(P, SFX_DOOR_ALT);
  yield* copySceneRect(P, 7, 56, 32, 56, 2, 2);
  yield* wait(P, 2);
  yield* copySceneRect(P, 3, 56, 32, 56, 2, 2);
  yield* wait(P, 4);
}

export const HOOKS = [
  scene(BANK, 0x623B, academyWingNpc03),
  scene(BANK, 0x62D0, academyWingFacing02),
  scene(BANK, 0x6355, academyWingFacing01),
  scene(BANK, 0x6372, academyWingTile01),
  scene(BANK, 0x63E0, academyWingTile02),
  scene(BANK, 0x643B, academyWingInitScript),
  scene(BANK, 0x6FCD, academyWingEntry0fScene),
  scene(BANK, 0x7339, academyWingOpenDoor),
  scene(BANK, 0x736F, academyWingCloseDoor),
];
