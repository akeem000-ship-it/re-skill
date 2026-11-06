// The ending's visits (bank $27, $6C85-$7606): the dorm entrance (entry 1: Emily walks the player in, the
// partner-to-be comes out), the restaurant entrance (entry 1: Emily, Mark and Kevin by the door) and the main
// building (entry 1: the late student knocks the player over; entry 2: the group's departure, actor_27's). The
// actor scripts, the map tables and the actor lists are data.
// Port of src/story/restaurant_27.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss1_end*.mtrec (part 1's scripted ending), out/port/ss2_end27*.mtrec (scripted: each
// visit, singles and doubles, both partner genders).
import {
  ACTOR_PARTNER, ACTOR_PLAYER, ACTOR_PLAYER_SHADOW, ACTOR_SIZE, ANIM_BOUNCE, ANIM_NOD, ANIM_SHAKE, ANIM_WALK,
  BANK_ACTORS, FACE_DOWN, FACE_LEFT, FACE_RIGHT, FACE_UP, FLAG_DOUBLES, actorState, beginCutscene, copySceneRect,
  endCutscene, face, faceToward, fadeIn, farcall, jumpVelocity, movePlayer, moveTarget, nullScript, playerSpeed,
  requestExit, respawnActors, scene, screenShake, setActive, setActorScript, setAnim, setObjdef, setPosition,
  setSpeed, sound, testFlag, wActors, wait, waitFadeEnd, waitIdle, waitJump, waitMove, waitPlayerMove,
} from "./common.js";
import { ACTORF_OAM_ATTR } from "../story/common.js";
import { attachActorWaypointFollower } from "../story/actor_slots.js";
import { end1MainBldgGroupDepartureCutscene } from "./actor_27.js";

const BANK = 0x27;
const OAM_YFLIP = 0x40;
// data of this bank (read from the ROM)
const EndRestaurantEntActorsAlt_27 = 0x710D;
const ACTOR_END1_MAIN_BLDG_BALLOON_ELLIPSIS = 0x07;
const ACTOR_END1_MAIN_BLDG_BALLOON_EXCLAIM = 0x04;
const ACTOR_END1_MAIN_BLDG_BALLOON_QUESTION = 0x03;
const ACTOR_END1_MAIN_BLDG_BALLOON_SWEAT = 0x05;
const ACTOR_END1_MAIN_BLDG_MARK = 0x0C;
const ACTOR_END1_MAIN_BLDG_WALK_74_06 = 0x0B;
const ACTOR_END1_MAIN_BLDG_WALK_74_07 = 0x0A;
const ACTOR_END1_MAIN_BLDG_WALK_74_08 = 0x09;
const ACTOR_END1_MAIN_BLDG_WALK_75_06_1 = 0x06;
const ACTOR_END1_MAIN_BLDG_WALK_75_06_2 = 0x08;
const ACTOR_END3_DORM_ENT_BALLOON_EXCLAIM = 0x05;
const ACTOR_END3_DORM_ENT_BALLOON_QUESTION = 0x06;
const ACTOR_END3_DORM_ENT_EMILY = 0x03;
const ACTOR_END3_DORM_ENT_KATE = 0x04;
const ACTOR_END_RESTAURANT_ENT_ALT_BALLOON_EXCLAIM = 0x03;
const ACTOR_END_RESTAURANT_ENT_ALT_EMILY = 0x06;
const ACTOR_END_RESTAURANT_ENT_ALT_KEVIN = 0x08;
const ACTOR_END_RESTAURANT_ENT_ALT_MARK = 0x07;
const ActorScript_27_26 = 0x7607;
const ActorScript_27_27 = 0x785D;
const OBJ_HARRY = 0x28;
const SFX_APPEAR2 = 0x96;
const SFX_CHIME = 0x97;
const SFX_DOOR = 0x71;
const SFX_EMOTE = 0x98;
const SFX_IMPACT = 0x70;

// End3DormEntInitScript_27 (27:6C85): in cutscene mode, entry 1 the dorm entrance's scene
export function* end3DormEntInitScript(P) {
  beginCutscene(P);
  if (P.V.storyModeEntryPoint === 0x01) yield* end3DormEntCutscene(P);
  endCutscene(P);
}

// End3DormEntCutscene_27 (27:6C94): the partner out of sight; Emily walks the player up to the dorm, the
// player looks around the entrance, Emily goes in and comes out with the partner-to-be (Harry for a boy partner)
// in Kate's place, the question balloon; exit $0F
export function* end3DormEntCutscene(P) {
  if (testFlag(P, FLAG_DOUBLES)) {
    setActorScript(P, ACTOR_PARTNER, ActorScript_27_27);
    setPosition(P, ACTOR_PARTNER, 63.0, 63.0);
  }
  setSpeed(P, ACTOR_END3_DORM_ENT_EMILY, 0.5);
  setSpeed(P, ACTOR_END3_DORM_ENT_KATE, 0.5);
  setSpeed(P, ACTOR_PLAYER, 0.5);
  playerSpeed(P, 0.5);
  setPosition(P, ACTOR_PLAYER, 22.0, 31.0);
  setPosition(P, ACTOR_END3_DORM_ENT_EMILY, 22.0, 29.0);
  face(P, ACTOR_END3_DORM_ENT_EMILY, FACE_UP);
  fadeIn(P, 32);
  moveTarget(P, ACTOR_END3_DORM_ENT_EMILY, 22.0, 17.0);
  yield* movePlayer(P, 22.0, 15.0);
  moveTarget(P, ACTOR_PLAYER, 22.0, 20.0);
  yield* waitMove(P, ACTOR_PLAYER);
  moveTarget(P, ACTOR_END3_DORM_ENT_EMILY, 22.0, 17.0);
  moveTarget(P, ACTOR_PLAYER, 22.0, 19.0);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* wait(P, 20);
  yield* waitMove(P, ACTOR_END3_DORM_ENT_EMILY);
  faceToward(P, ACTOR_PLAYER, ACTOR_END3_DORM_ENT_EMILY);
  setAnim(P, ACTOR_END3_DORM_ENT_EMILY, ANIM_NOD);
  yield* waitIdle(P, ACTOR_END3_DORM_ENT_EMILY);
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  playerSpeed(P, 0.75);
  yield* movePlayer(P, 22.0, 11.0);
  yield* waitPlayerMove(P);
  yield* wait(P, 20);
  yield* movePlayer(P, 17.0, 11.0);
  yield* waitPlayerMove(P);
  yield* wait(P, 10);
  yield* movePlayer(P, 26.0, 11.0);
  yield* waitPlayerMove(P);
  yield* wait(P, 10);
  yield* movePlayer(P, 22.0, 11.0);
  yield* waitPlayerMove(P);
  yield* wait(P, 30);
  yield* movePlayer(P, 22.0, 16.0);
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 20);
  playerSpeed(P, 0.5);
  sound(P, SFX_CHIME);
  setPosition(P, ACTOR_END3_DORM_ENT_BALLOON_EXCLAIM, 23.5, 15.0);
  setAnim(P, ACTOR_END3_DORM_ENT_EMILY, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_END3_DORM_ENT_EMILY);
  setPosition(P, ACTOR_END3_DORM_ENT_BALLOON_EXCLAIM, 1.0, 1.0);
  moveTarget(P, ACTOR_END3_DORM_ENT_EMILY, 22.0, 11.0);
  yield* waitMove(P, ACTOR_END3_DORM_ENT_EMILY);
  setPosition(P, ACTOR_END3_DORM_ENT_KATE, 23.0, 11.0);
  yield* wait(P, 60);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  yield* wait(P, 20);
  setAnim(P, ACTOR_PLAYER, ANIM_SHAKE);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 20);
  face(P, ACTOR_PLAYER, FACE_UP);
  setActive(P, ACTOR_END3_DORM_ENT_EMILY, 0x02);
  setPosition(P, ACTOR_END3_DORM_ENT_EMILY, 21.0, 11.0);
  if (!P.V.storyModeGenderOfPartnerCharacter) {
    setObjdef(P, OBJ_HARRY, ACTOR_END3_DORM_ENT_KATE);
    setAnim(P, ACTOR_END3_DORM_ENT_KATE, ANIM_WALK);
  }
  moveTarget(P, ACTOR_END3_DORM_ENT_EMILY, 21.0, 15.0);
  yield* waitMove(P, ACTOR_END3_DORM_ENT_EMILY);
  moveTarget(P, ACTOR_END3_DORM_ENT_KATE, 23.0, 15.0);
  yield* waitMove(P, ACTOR_END3_DORM_ENT_KATE);
  sound(P, SFX_EMOTE);
  setPosition(P, ACTOR_END3_DORM_ENT_BALLOON_QUESTION, 23.5, 17.0);
  yield* wait(P, 60);
  setAnim(P, ACTOR_END3_DORM_ENT_EMILY, ANIM_SHAKE);
  yield* waitIdle(P, ACTOR_END3_DORM_ENT_EMILY);
  setPosition(P, ACTOR_END3_DORM_ENT_BALLOON_QUESTION, 1.0, 1.0);
  faceToward(P, ACTOR_END3_DORM_ENT_KATE, ACTOR_END3_DORM_ENT_EMILY);
  yield* wait(P, 60);
  faceToward(P, ACTOR_PLAYER, ACTOR_END3_DORM_ENT_EMILY);
  setAnim(P, ACTOR_END3_DORM_ENT_KATE, ANIM_NOD);
  yield* waitIdle(P, ACTOR_END3_DORM_ENT_KATE);
  requestExit(P, 0x0F);
}

// EndRestaurantEntInitScript_27 (27:6F4C): entry 1 the restaurant entrance's scene
export function* endRestaurantEntInitScript(P) {
  if (P.V.storyModeEntryPoint !== 0x01) return;
  yield* endRestaurantEntCutscene(P);
}

// EndRestaurantEntCutscene_27 (27:6F57): its actors; Emily and the player walk in, Mark and Kevin come out of
// the door; exit $0E
export function* endRestaurantEntCutscene(P) {
  respawnActors(P, EndRestaurantEntActorsAlt_27);
  beginCutscene(P);
  if (testFlag(P, FLAG_DOUBLES)) {
    setActorScript(P, ACTOR_PARTNER, ActorScript_27_27);
    setPosition(P, ACTOR_PARTNER, 63.0, 63.0);
  }
  setPosition(P, ACTOR_PLAYER, 63.0, 63.0);
  setPosition(P, ACTOR_END_RESTAURANT_ENT_ALT_EMILY, 63.0, 63.0);
  setPosition(P, ACTOR_END_RESTAURANT_ENT_ALT_MARK, 63.0, 63.0);
  setPosition(P, ACTOR_END_RESTAURANT_ENT_ALT_KEVIN, 63.0, 63.0);
  fadeIn(P, 4);
  setPosition(P, ACTOR_END_RESTAURANT_ENT_ALT_EMILY, 65.0, 13.0);
  moveTarget(P, ACTOR_END_RESTAURANT_ENT_ALT_EMILY, 27.0, 13.0);
  setPosition(P, ACTOR_PLAYER, 67.0, 13.0);
  moveTarget(P, ACTOR_PLAYER, 29.0, 13.0);
  yield* wait(P, 15);
  yield* movePlayer(P, 27.0, 13.0);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* wait(P, 30);
  faceToward(P, ACTOR_PLAYER, ACTOR_END_RESTAURANT_ENT_ALT_EMILY);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  face(P, ACTOR_END_RESTAURANT_ENT_ALT_EMILY, FACE_UP);
  yield* wait(P, 15);
  face(P, ACTOR_PLAYER, FACE_UP);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 30);
  yield* openRestaurantEntDoor(P);
  yield* wait(P, 15);
  sound(P, SFX_CHIME);
  setPosition(P, ACTOR_END_RESTAURANT_ENT_ALT_BALLOON_EXCLAIM, 28.0, 11.0);
  yield* wait(P, 30);
  setPosition(P, ACTOR_END_RESTAURANT_ENT_ALT_BALLOON_EXCLAIM, 63.0, 63.0);
  face(P, ACTOR_END_RESTAURANT_ENT_ALT_EMILY, FACE_LEFT);
  yield* wait(P, 15);
  face(P, ACTOR_PLAYER, FACE_LEFT);
  yield* movePlayer(P, 24.0, 13.0);
  yield* wait(P, 15);
  setPosition(P, ACTOR_END_RESTAURANT_ENT_ALT_MARK, 21.0, 9.5);
  yield* wait(P, 15);
  setSpeed(P, ACTOR_END_RESTAURANT_ENT_ALT_MARK, 0.5);
  moveTarget(P, ACTOR_END_RESTAURANT_ENT_ALT_MARK, 21.0, 13.0);
  yield* waitMove(P, ACTOR_END_RESTAURANT_ENT_ALT_MARK);
  face(P, ACTOR_END_RESTAURANT_ENT_ALT_MARK, FACE_RIGHT);
  setPosition(P, ACTOR_END_RESTAURANT_ENT_ALT_KEVIN, 21.0, 9.0);
  yield* wait(P, 15);
  setSpeed(P, ACTOR_END_RESTAURANT_ENT_ALT_KEVIN, 0.5);
  moveTarget(P, ACTOR_END_RESTAURANT_ENT_ALT_KEVIN, 21.0, 11.0);
  yield* waitMove(P, ACTOR_END_RESTAURANT_ENT_ALT_KEVIN);
  yield* closeRestaurantEntDoor(P);
  face(P, ACTOR_END_RESTAURANT_ENT_ALT_KEVIN, FACE_RIGHT);
  yield* wait(P, 15);
  setAnim(P, ACTOR_END_RESTAURANT_ENT_ALT_EMILY, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_END_RESTAURANT_ENT_ALT_EMILY);
  face(P, ACTOR_END_RESTAURANT_ENT_ALT_MARK, FACE_DOWN);
  requestExit(P, 0x0E);
  endCutscene(P);
}

// OpenRestaurantEntDoor_27 (27:716B): the door's sound and its frames (scene cells (0..4, 21)) over the door,
// the closed door kept at (6, 21) first
export function* openRestaurantEntDoor(P) {
  sound(P, SFX_DOOR);
  yield* copySceneRect(P, 20, 8, 6, 21, 2, 2);
  yield* copySceneRect(P, 0, 21, 20, 8, 2, 2);
  yield* wait(P, 2);
  yield* copySceneRect(P, 2, 21, 20, 8, 2, 2);
  yield* wait(P, 2);
  yield* copySceneRect(P, 4, 21, 20, 8, 2, 2);
  yield* wait(P, 2);
}

// CloseRestaurantEntDoor_27 (27:71BF): the frames back, the closed door last
export function* closeRestaurantEntDoor(P) {
  sound(P, SFX_DOOR);
  yield* copySceneRect(P, 4, 21, 20, 8, 2, 2);
  yield* wait(P, 1);
  yield* copySceneRect(P, 2, 21, 20, 8, 2, 2);
  yield* wait(P, 1);
  yield* copySceneRect(P, 0, 21, 20, 8, 2, 2);
  yield* wait(P, 1);
  yield* copySceneRect(P, 6, 21, 20, 8, 2, 2);
}

// End1MainBldgInitScript_27 (27:72FC): entry 2 the group's departure (actor_27); entry 1: the others out of
// sight, the player walks up from the gate, the late student runs out, jumps, sees the player, runs into the
// player (End1MainBldgKnockdown_27; the shadow following him meanwhile), apologizes; exit 1
export function* end1MainBldgInitScript(P) {
  if (P.V.storyModeEntryPoint !== 0x01) {
    if (P.V.storyModeEntryPoint === 0x02) yield* end1MainBldgGroupDepartureCutscene(P);
    return;
  }
  setSpeed(P, ACTOR_PLAYER, 0.5);
  P.V.storyModeShowLocationName = 0;
  setPosition(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1, 24.0, 13.0);
  setPosition(P, ACTOR_PLAYER, 24.0, 55.0);
  setPosition(P, ACTOR_END1_MAIN_BLDG_WALK_74_06, 63.0, 63.0);
  setPosition(P, ACTOR_END1_MAIN_BLDG_WALK_74_07, 63.0, 63.0);
  setPosition(P, ACTOR_END1_MAIN_BLDG_WALK_74_08, 63.0, 63.0);
  setPosition(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_2, 63.0, 63.0);
  setPosition(P, ACTOR_END1_MAIN_BLDG_MARK, 63.0, 63.0);
  if (testFlag(P, FLAG_DOUBLES)) {
    setActorScript(P, ACTOR_PARTNER, ActorScript_27_27);
    setPosition(P, ACTOR_PARTNER, 63.0, 63.0);
  }
  playerSpeed(P, 2.0);
  yield* movePlayer(P, 24.0, 18.0);
  yield* waitPlayerMove(P);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  moveTarget(P, ACTOR_PLAYER, 24.0, 33.0);
  yield* wait(P, 20);
  setPosition(P, ACTOR_PLAYER, 24.0, 32.0);
  face(P, ACTOR_PLAYER, FACE_UP);
  setSpeed(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1, 1.125);
  moveTarget(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1, 24.0, 20.0);
  yield* waitMove(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1);
  setAnim(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1, ANIM_SHAKE);
  yield* waitIdle(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1);
  face(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1, FACE_UP);
  setAnim(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1, ANIM_NOD);
  yield* waitIdle(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1);
  setSpeed(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1, 1.0);
  face(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1, FACE_DOWN);
  jumpVelocity(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1, -2.0);
  yield* waitJump(P, 0x06);
  moveTarget(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1, 24.0, 23.0);
  yield* waitMove(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1);
  sound(P, SFX_EMOTE);
  setPosition(P, ACTOR_END1_MAIN_BLDG_BALLOON_QUESTION, 25.5, 21.75);
  setSpeed(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1, 0.5);
  setSpeed(P, ACTOR_END1_MAIN_BLDG_BALLOON_QUESTION, 0.5);
  moveTarget(P, ACTOR_END1_MAIN_BLDG_BALLOON_QUESTION, 25.5, 24.75);
  moveTarget(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1, 24.0, 26.0);
  yield* waitMove(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1);
  setPosition(P, ACTOR_END1_MAIN_BLDG_BALLOON_QUESTION, 63.0, 63.0);
  moveTarget(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1, 24.0, 22.0);
  yield* waitMove(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1);
  yield* wait(P, 30);
  setAnim(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1, ANIM_BOUNCE);
  sound(P, SFX_CHIME);
  setPosition(P, ACTOR_END1_MAIN_BLDG_BALLOON_EXCLAIM, 25.5, 20.75);
  yield* wait(P, 20);
  setPosition(P, ACTOR_END1_MAIN_BLDG_BALLOON_EXCLAIM, 63.0, 63.0);
  setSpeed(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1, 1.0);
  jumpVelocity(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1, -2.0);
  yield* waitJump(P, 0x06);
  moveTarget(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1, 24.0, 32.0);
  yield* wait(P, 30);
  const leader = actorState(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1);   // the player's shadow follows the student
  farcall(P, BANK_ACTORS, () => attachActorWaypointFollower(P, wActors + ACTOR_SIZE, leader));
  moveTarget(P, ACTOR_PLAYER, 24.0, 30.0);
  yield* wait(P, 20);
  yield* end1MainBldgKnockdown(P);
  yield* waitMove(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1);
  setAnim(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1, ANIM_BOUNCE);
  sound(P, SFX_APPEAR2);
  setPosition(P, ACTOR_END1_MAIN_BLDG_BALLOON_SWEAT, 25.0, 30.0);
  yield* wait(P, 60);
  setPosition(P, ACTOR_END1_MAIN_BLDG_BALLOON_SWEAT, 63.0, 63.0);
  moveTarget(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1, 23.0, 34.0);
  yield* waitMove(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1);
  faceToward(P, ACTOR_PLAYER, ACTOR_END1_MAIN_BLDG_WALK_75_06_1);
  yield* wait(P, 20);
  moveTarget(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1, 25.0, 36.0);
  yield* waitMove(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1);
  nullScript(P, ACTOR_PLAYER_SHADOW);
  faceToward(P, ACTOR_PLAYER, ACTOR_END1_MAIN_BLDG_WALK_75_06_1);
  setAnim(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1);
  yield* wait(P, 20);
  setPosition(P, ACTOR_END1_MAIN_BLDG_BALLOON_ELLIPSIS, 26.5, 34.5);
  yield* wait(P, 60);
  setPosition(P, ACTOR_END1_MAIN_BLDG_BALLOON_ELLIPSIS, 63.0, 63.0);
  setAnim(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1);
  requestExit(P, 0x01);
}

// End1MainBldgKnockdown_27 (27:7595): the impact (the screen shaken 10 frames), the player thrown back upside
// down, a bounce, then the player's script ActorScript_27_26
export function* end1MainBldgKnockdown(P) {
  sound(P, SFX_IMPACT);
  nullScript(P, ACTOR_PLAYER_SHADOW);
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
  setActorScript(P, ACTOR_PLAYER, ActorScript_27_26);
}

export const HOOKS = [
  scene(BANK, 0x6C85, end3DormEntInitScript),
  scene(BANK, 0x6C94, end3DormEntCutscene),
  scene(BANK, 0x6F4C, endRestaurantEntInitScript),
  scene(BANK, 0x6F57, endRestaurantEntCutscene),
  scene(BANK, 0x716B, openRestaurantEntDoor),
  scene(BANK, 0x71BF, closeRestaurantEntDoor),
  scene(BANK, 0x72FC, end1MainBldgInitScript),
  scene(BANK, 0x7595, end1MainBldgKnockdown),
];
