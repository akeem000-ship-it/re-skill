// The ending's academy scenes (bank $27, $4B67-$5580): End12 in the principal's office (entry 1: the principal
// paces, the students turn, the party comes in through the door, then the nods; entry 2: the trophies shown, the
// party leaves and the credits are set to follow) and its door; End11 the training court (entry 1: the player
// alone, looking round, a light flashes and the player jumps; entry 2: Bob's farewell run). The location tables,
// actor lists, actor scripts and palettes are data.
// Port of src/story/ending_office_27.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/cs_credits.mtrec, cs_epilogue.mtrec (the ending), out/port/ss1_end*.mtrec (scripted).
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FACE_DOWN, FACE_LEFT, FACE_RIGHT, FACE_UP, ANIM_NOD, ANIM_BOUNCE, ANIM_WALK,
  FLAG_DOUBLES, testFlag, setFlag, setAnim, waitIdle, gesture, face, faceToward, facePair, setPosition, moveTarget,
  moveAngle, waitMove, setSpeed, playerSpeed, movePlayer, movePlayerToActor, waitPlayerMove, waitJump, jumpVelocity,
  lockFacing, unlockFacing, nullScript, setActorScript, setActive, actorState, wait, copySceneRect, copySceneToVram,
  fadeIn, fadeInAndWait, fadeOutAndWait, sound, disableLCDSafely, enableLCD, respawnActors, beginCutscene,
  requestExit, loadPalettesImmediate, scene,
} from "./common.js";
import { waitScriptFramesSaveA as delay } from "./actor_27.js";

const BANK = 0x27;
const ACTOR_END12_PRINCIPALS_OFFICE_BALLOON_SWEAT_1 = 0x04, ACTOR_END12_PRINCIPALS_OFFICE_BALLOON_SWEAT_2 = 0x06;
const ACTOR_END12_PRINCIPALS_OFFICE_WALK_75_06 = 0x07, ACTOR_END12_PRINCIPALS_OFFICE_KEVIN = 0x08;
const ACTOR_END12_PRINCIPALS_OFFICE_MARK = 0x09, ACTOR_END12_PRINCIPALS_OFFICE_EMILY = 0x0A;
const ACTOR_END12_PRINCIPALS_OFFICE_ALT_WALK_75_06 = 0x03, ACTOR_END12_PRINCIPALS_OFFICE_ALT_TROPHY_1 = 0x04;
const ACTOR_END12_PRINCIPALS_OFFICE_ALT_TROPHY_2 = 0x05;
const ACTOR_END11_TRAINING_COURT_WALK_76_06 = 0x03, ACTOR_END11_TRAINING_COURT_BALLOON_QUESTION = 0x04;
const ACTOR_END11_TRAINING_COURT_BALLOON_EXCLAIM = 0x05, ACTOR_END11_TRAINING_COURT_ALT_BOB = 0x06;
const ANIM_TROPHY_SINGLES = 0x06;
const ACTORF_OAM_ATTR = 0x37, OAM_XFLIP = 0x20;
const ACTOR_RECORD_BYTE_18 = 0x18;                      // a byte of the actor record the disassembly leaves unnamed
const FLAG_WON_ISLAND_OPEN_DOUBLES_FINAL = 0x35, FLAG_WON_ISLAND_OPEN_SINGLES_FINAL = 0x3C;
const FLAG_ENDING_CREDITS_PENDING = 0x6D;
const SFX_DOOR_ALT = 0x79, SFX_APPEAR2 = 0x96, SFX_CHIME = 0x97, SFX_EMOTE = 0x98;
const ActorScript_27_04 = 0x51D0, ActorScript_27_06 = 0x555E, ActorScript_27_27 = 0x785D;
const End12PrincipalsOfficeActorsAlt_27 = 0x51DD, End11TrainingCourtActorsAlt_27 = 0x5507;
const End11TrainingCourtInitScriptPalette0_27 = 0x5580, End11TrainingCourtInitScriptPalette1_27 = 0x55C0;

// the scroll bounds and size of the view, the scene copied to VRAM with the LCD off
function* setView(P, minX, minY, width, height) {
  const { V } = P;
  V.mapScrollMinX = minX;
  V.mapScrollMinY = minY;
  V.mapWidthTiles = width;
  V.mapHeightTiles = height;
  disableLCDSafely(P);
  copySceneToVram(P, 0x00);
  enableLCD(P);
}
// moveTarget for several actors, then wait for one
function* moveAll(P, moves, waitFor) {
  for (const [actor, x, y] of moves) moveTarget(P, actor, x, y);
  yield* waitMove(P, waitFor);
}
// setAnim for several actors, then wait for one to be idle
function* animAll(P, actors, anim, waitFor) {
  for (const actor of actors) setAnim(P, actor, anim);
  yield* waitIdle(P, waitFor);
}

// ---- End12: the principal's office ----
const PRINCIPAL = ACTOR_END12_PRINCIPALS_OFFICE_WALK_75_06, KEVIN = ACTOR_END12_PRINCIPALS_OFFICE_KEVIN;
const MARK = ACTOR_END12_PRINCIPALS_OFFICE_MARK, EMILY = ACTOR_END12_PRINCIPALS_OFFICE_EMILY;
const SWEAT_1 = ACTOR_END12_PRINCIPALS_OFFICE_BALLOON_SWEAT_1, SWEAT_2 = ACTOR_END12_PRINCIPALS_OFFICE_BALLOON_SWEAT_2;
// End12PrincipalsOfficeInitScript_27 (27:4C61): the office's view; entry 2 the trophies, else the arrival
export function* end12PrincipalsOfficeInitScript(P) {
  yield* setView(P, 0x16, 0x28, 0x40, 0x3E);
  if (P.V.storyModeEntryPoint === 0x02) return yield* end12Trophies(P);
  yield* end12Arrival(P);
}
// .clearStoryModeShowLocationName (27:4C8C): the principal paces, bounces; the students turn up, sweat; the party
// walks in through the door; all bounce, the students step aside; the nods (singles: a sweat balloon, Emily);
// exit 1
function* end12Arrival(P) {
  const doubles = () => testFlag(P, FLAG_DOUBLES);
  P.V.storyModeShowLocationName = 0;
  setPosition(P, ACTOR_PLAYER, 43.0, 59.0);
  setPosition(P, ACTOR_PARTNER, 43.0, 59.0);
  fadeIn(P, 4);
  yield* delay(P, 20);
  for (const [x, frames] of [[30.0, 30], [34.0, 30], [32.0, 10]]) {
    moveTarget(P, PRINCIPAL, x, 47.0);
    yield* waitMove(P, PRINCIPAL);
    face(P, PRINCIPAL, FACE_DOWN);
    yield* delay(P, frames);
  }
  yield* gesture(P, PRINCIPAL, ANIM_BOUNCE);
  for (const actor of [KEVIN, MARK, EMILY]) face(P, actor, FACE_UP);
  for (const [balloon, x] of [[SWEAT_1, 31.5], [SWEAT_2, 33.5], [SWEAT_1, 35.5]]) {
    sound(P, SFX_APPEAR2);
    setPosition(P, balloon, x, 49.5);
    yield* delay(P, 40);
  }
  setPosition(P, SWEAT_2, 63.0, 63.0);
  yield* delay(P, 40);
  setPosition(P, SWEAT_1, 63.0, 63.0);
  if (doubles()) {
    nullScript(P, ACTOR_PARTNER);
    setPosition(P, ACTOR_PARTNER, 45.0, 59.0);
    yield* moveAll(P, [[ACTOR_PLAYER, 33.0, 59.0], [ACTOR_PARTNER, 35.0, 59.0]], ACTOR_PARTNER);
    yield* wait(P, 5);
    face(P, ACTOR_PLAYER, FACE_UP);
    yield* openPrincipalsOfficeDoor(P);
    yield* moveAll(P, [[ACTOR_PLAYER, 33.0, 53.0], [ACTOR_PARTNER, 33.0, 59.0]], ACTOR_PARTNER);
    yield* moveAll(P, [[ACTOR_PLAYER, 31.0, 53.0], [ACTOR_PARTNER, 33.0, 53.0]], ACTOR_PARTNER);
    yield* moveAll(P, [[ACTOR_PARTNER, 33.0, 53.0]], ACTOR_PARTNER);
    face(P, ACTOR_PLAYER, FACE_UP);
    face(P, ACTOR_PARTNER, FACE_UP);
  } else {
    yield* moveAll(P, [[ACTOR_PLAYER, 33.0, 59.0]], ACTOR_PLAYER);   // .walkPlayer
    face(P, ACTOR_PLAYER, FACE_UP);
    yield* openPrincipalsOfficeDoor(P);
    yield* moveAll(P, [[ACTOR_PLAYER, 33.0, 53.0]], ACTOR_PLAYER);
    yield* moveAll(P, [[ACTOR_PLAYER, 32.0, 53.0]], ACTOR_PLAYER);
    face(P, ACTOR_PLAYER, FACE_UP);
  }
  yield* delay(P, 1);
  yield* closePrincipalsOfficeDoor(P);                  // .closePrincipalsOfficeDoor
  yield* animAll(P, [PRINCIPAL, KEVIN, MARK, EMILY], ANIM_BOUNCE, EMILY);
  yield* delay(P, 30);
  yield* moveAll(P, [[EMILY, 29.0, 53.0], [MARK, 35.0, 53.0], [KEVIN, 37.0, 53.0]], KEVIN);
  face(P, EMILY, FACE_RIGHT);
  face(P, MARK, FACE_LEFT);
  face(P, KEVIN, FACE_LEFT);
  yield* delay(P, 10);
  if (doubles()) {
    yield* delay(P, 60);
    faceToward(P, ACTOR_PARTNER, ACTOR_PLAYER);
    yield* gesture(P, ACTOR_PLAYER, ANIM_BOUNCE);
    yield* delay(P, 20);
    faceToward(P, ACTOR_PLAYER, ACTOR_PARTNER);
    yield* delay(P, 1);
    yield* gesture(P, ACTOR_PARTNER, ANIM_NOD);
    yield* delay(P, 20);
    face(P, ACTOR_PLAYER, FACE_UP);
    face(P, ACTOR_PARTNER, FACE_UP);
    yield* animAll(P, [KEVIN, MARK, EMILY], ANIM_NOD, EMILY);
    yield* delay(P, 40);
    yield* animAll(P, [ACTOR_PLAYER, ACTOR_PARTNER], ANIM_NOD, ACTOR_PARTNER);
    yield* moveAll(P, [[ACTOR_PLAYER, 31.0, 50.0], [ACTOR_PARTNER, 33.0, 50.0]], ACTOR_PARTNER);
  } else {
    sound(P, SFX_APPEAR2);                              // .playSfx
    setPosition(P, SWEAT_1, 33.5, 51.5);
    yield* delay(P, 80);
    setPosition(P, SWEAT_1, 63.0, 63.0);
    faceToward(P, EMILY, ACTOR_PLAYER);
    yield* delay(P, 40);
    faceToward(P, ACTOR_PLAYER, EMILY);
    yield* delay(P, 1);
    yield* gesture(P, EMILY, ANIM_NOD);
    yield* delay(P, 20);
    face(P, ACTOR_PLAYER, FACE_UP);
    yield* animAll(P, [KEVIN, MARK, EMILY], ANIM_NOD, EMILY);
    yield* delay(P, 40);
    setAnim(P, ACTOR_PLAYER, ANIM_NOD);
    yield* moveAll(P, [[ACTOR_PLAYER, 32.0, 50.0]], ACTOR_PLAYER);
  }
  requestExit(P, 0x01);                                 // .storeStoryModeExitLocationRequest
}
// .eq02 (27:4FF0): the trophies on display (only those won); the principal's nod; the party leaves through the
// door; the credits are set to come (FLAG_ENDING_CREDITS_PENDING); a fade out, exit 1
function* end12Trophies(P) {
  const doubles = testFlag(P, FLAG_DOUBLES), PRINCIPAL_ALT = ACTOR_END12_PRINCIPALS_OFFICE_ALT_WALK_75_06;
  respawnActors(P, End12PrincipalsOfficeActorsAlt_27);
  beginCutscene(P);
  setAnim(P, ACTOR_END12_PRINCIPALS_OFFICE_ALT_TROPHY_1, ANIM_TROPHY_SINGLES);
  if (doubles) {
    nullScript(P, ACTOR_PARTNER);
    setPosition(P, ACTOR_PLAYER, 31.0, 52.0);
    setPosition(P, ACTOR_PARTNER, 33.0, 52.0);
    face(P, ACTOR_PARTNER, FACE_UP);
    if (!testFlag(P, FLAG_WON_ISLAND_OPEN_SINGLES_FINAL)) setPosition(P, ACTOR_END12_PRINCIPALS_OFFICE_ALT_TROPHY_1, 63.0, 63.0);
  } else {
    setPosition(P, ACTOR_PLAYER, 32.0, 52.0);           // .placeActors
    if (!testFlag(P, FLAG_WON_ISLAND_OPEN_DOUBLES_FINAL)) setPosition(P, ACTOR_END12_PRINCIPALS_OFFICE_ALT_TROPHY_2, 63.0, 63.0);
  }
  face(P, ACTOR_PLAYER, FACE_UP);                       // .face
  P.V.storyModeShowLocationName = 0;
  yield* fadeInAndWait(P, 4);
  yield* gesture(P, ACTOR_PLAYER, ANIM_NOD);
  yield* gesture(P, PRINCIPAL_ALT, ANIM_NOD);
  yield* delay(P, 60);
  if (testFlag(P, FLAG_DOUBLES)) {
    facePair(P, ACTOR_PARTNER, ACTOR_PLAYER);
    yield* delay(P, 30);
    yield* animAll(P, [ACTOR_PLAYER, ACTOR_PARTNER], ANIM_NOD, ACTOR_PARTNER);
    face(P, ACTOR_PARTNER, FACE_DOWN);
    yield* moveAll(P, [[ACTOR_PLAYER, 33.0, 54.0]], ACTOR_PLAYER);
    yield* moveAll(P, [[ACTOR_PLAYER, 33.0, 55.0], [ACTOR_PARTNER, 33.0, 53.0]], ACTOR_PARTNER);
    yield* openPrincipalsOfficeDoor(P);
    setActorScript(P, ACTOR_PLAYER, ActorScript_27_04);
    setActorScript(P, ACTOR_PARTNER, ActorScript_27_04);
  } else {
    yield* moveAll(P, [[ACTOR_PLAYER, 33.0, 52.0]], ACTOR_PLAYER);   // .animate
    yield* moveAll(P, [[ACTOR_PLAYER, 33.0, 55.0]], ACTOR_PLAYER);
    yield* openPrincipalsOfficeDoor(P);
    setActorScript(P, ACTOR_PLAYER, ActorScript_27_04);
  }
  yield* delay(P, 20);
  yield* closePrincipalsOfficeDoor(P);                  // .closePrincipalsOfficeDoor2
  yield* delay(P, 60);
  setFlag(P, FLAG_ENDING_CREDITS_PENDING);
  yield* fadeOutAndWait(P, 4);
  requestExit(P, 0x01);
}
// OpenPrincipalsOfficeDoor_27 (27:516B) / ClosePrincipalsOfficeDoor_27 (27:51A1): the door's two frames copied
// onto the scene with its sound
export function* openPrincipalsOfficeDoor(P) {
  yield* wait(P, 10);
  sound(P, SFX_DOOR_ALT);
  yield* doorFrames(P, 11);
}
export function* closePrincipalsOfficeDoor(P) {
  sound(P, SFX_DOOR_ALT);
  yield* doorFrames(P, 3);
}
function* doorFrames(P, lastColumn) {
  yield* copySceneRect(P, 7, 56, 32, 56, 2, 2);
  yield* wait(P, 2);
  yield* copySceneRect(P, lastColumn, 56, 32, 56, 2, 2);
  yield* wait(P, 4);
}

// ---- End11: the training court ----
const LIGHT = ACTOR_END11_TRAINING_COURT_WALK_76_06, QUESTION = ACTOR_END11_TRAINING_COURT_BALLOON_QUESTION;
const EXCLAIM = ACTOR_END11_TRAINING_COURT_BALLOON_EXCLAIM, BOB = ACTOR_END11_TRAINING_COURT_ALT_BOB;
// End11TrainingCourtInitScript_27 (27:5270): by the entry point
export function* end11TrainingCourtInitScript(P) {
  const entry = P.V.storyModeEntryPoint;
  if (entry === 0x01) return yield* end11Alone(P);
  if (entry === 0x02) return yield* end11BobsRun(P);
}
// .checkDoubles (27:527E): the partner away; the player (mirrored when left-handed) on its practice script; it
// stops, looks left and right; a question; the light on the wall flashes (the background palettes changed,
// faster and faster); the player looks up, jumps; exit 1
function* end11Alone(P) {
  if (testFlag(P, FLAG_DOUBLES)) {
    setActorScript(P, ACTOR_PARTNER, ActorScript_27_27);
    setPosition(P, ACTOR_PARTNER, 63.0, 63.0);
  }
  if (P.V.storyModeMainCharacterLeftHanded) {           // .checkStoryModeMainCharacterLeftHanded
    const at = (actorState(P, ACTOR_PLAYER) + ACTORF_OAM_ATTR) & 0xFFFF;
    P.bus.w8(at, P.bus.u8(at) ^ OAM_XFLIP);
  }
  face(P, ACTOR_PLAYER, FACE_DOWN);                     // .face
  setActorScript(P, ACTOR_PLAYER, ActorScript_27_06);
  P.V.storyModeShowLocationName = 0;
  fadeIn(P, 4);
  yield* delay(P, 120);
  P.bus.w8((actorState(P, ACTOR_PLAYER) + ACTOR_RECORD_BYTE_18) & 0xFFFF, 0x01);
  yield* gesture(P, ACTOR_PLAYER, ANIM_BOUNCE);
  nullScript(P, ACTOR_PLAYER);
  setAnim(P, ACTOR_PLAYER, ANIM_WALK);
  yield* delay(P, 60);
  for (const facing of [FACE_LEFT, FACE_RIGHT, FACE_LEFT, FACE_RIGHT, FACE_DOWN]) {
    face(P, ACTOR_PLAYER, facing);
    yield* delay(P, 30);
  }
  sound(P, SFX_EMOTE);
  setPosition(P, QUESTION, 52.5, 11.5);
  yield* delay(P, 60);
  setPosition(P, LIGHT, 51.0, 7.0);
  setActive(P, LIGHT, 0x00);
  playerSpeed(P, 0.5);
  yield* movePlayerToActor(P, LIGHT);
  loadPalettesImmediate(P, End11TrainingCourtInitScriptPalette0_27, 2, 6);
  yield* delay(P, 30);
  loadPalettesImmediate(P, End11TrainingCourtInitScriptPalette1_27, 2, 6);
  for (let d = 0x10; d !== 0; d = (d - 2) & 0xFF) {      // .loop: on 4 frames, off d frames
    setActive(P, LIGHT, 0x02);
    yield* wait(P, 4);
    setActive(P, LIGHT, 0x00);
    yield* wait(P, d);
  }
  setActive(P, LIGHT, 0x02);
  yield* delay(P, 60);
  setPosition(P, QUESTION, 63.0, 63.0);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* delay(P, 30);
  sound(P, SFX_CHIME);
  setPosition(P, EXCLAIM, 52.5, 11.5);
  yield* delay(P, 20);
  jumpVelocity(P, EXCLAIM, -3.0);
  jumpVelocity(P, ACTOR_PLAYER, -3.0);
  yield* waitJump(P, ACTOR_PLAYER);
  yield* delay(P, 30);
  requestExit(P, 0x01);
}
// .eq02 (27:53F9): Bob in front of the party: two bounces backing off, then he runs off the court; exit 1
function* end11BobsRun(P) {
  respawnActors(P, End11TrainingCourtActorsAlt_27);
  setPosition(P, ACTOR_PLAYER, 24.0, 17.0);
  beginCutscene(P);
  face(P, ACTOR_PLAYER, FACE_UP);
  setPosition(P, BOB, 24.0, 13.0);
  face(P, BOB, FACE_DOWN);
  nullScript(P, ACTOR_PARTNER);
  setPosition(P, ACTOR_PARTNER, 19.0, 17.0);
  face(P, ACTOR_PARTNER, FACE_RIGHT);
  yield* movePlayer(P, 24.0, 15.0);
  yield* waitPlayerMove(P);
  yield* fadeInAndWait(P, 8);
  yield* wait(P, 30);
  yield* gesture(P, BOB, ANIM_BOUNCE);
  lockFacing(P, BOB);
  moveAngle(P, BOB, FACE_UP, 1.0);
  yield* waitMove(P, BOB);
  yield* wait(P, 40);
  moveAngle(P, BOB, FACE_UP, 1.0);
  yield* waitMove(P, BOB);
  yield* gesture(P, BOB, ANIM_BOUNCE);
  unlockFacing(P, BOB);
  setSpeed(P, BOB, 1.5);
  P.bus.w8((actorState(P, BOB) + ACTOR_RECORD_BYTE_18) & 0xFFFF, 0x04);
  yield* moveAll(P, [[BOB, 31.0, 11.0]], BOB);
  yield* moveAll(P, [[BOB, 31.0, 17.0]], BOB);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  yield* moveAll(P, [[BOB, 31.0, 31.0]], BOB);
  setPosition(P, BOB, 63.0, 63.0);
  requestExit(P, 0x01);
}

export const HOOKS = [
  scene(BANK, 0x4C61, end12PrincipalsOfficeInitScript),
  scene(BANK, 0x516B, openPrincipalsOfficeDoor),
  scene(BANK, 0x51A1, closePrincipalsOfficeDoor),
  scene(BANK, 0x5270, end11TrainingCourtInitScript),
];
