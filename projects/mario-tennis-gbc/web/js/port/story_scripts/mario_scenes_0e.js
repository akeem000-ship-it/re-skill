// Mario World's scenes (bank $0E, $647E-$7081): Peach's exhibition offer (stepping up from either side, the
// doubles partner brought alongside first), the exhibition: the crowd's nods and the walk off to the special court
// (its star warp); the arrival on a return (the cast placed), and the story's first visit: the welcome, Bowser's
// challenge, Luigi defending the champion and the demand for an exhibition. The actor scripts
// (ActorScript_0e_12..15) are data.
// Port of src/story/mario_scenes_0e.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss2_mw*.mtrec (scripted: Mario World in singles and doubles, the first visit and the
// exhibition offer).
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FACE_RIGHT, FACE_DOWN, FACE_LEFT, FACE_UP, ANIM_BOUNCE, ANIM_NOD, ANIM_SHAKE,
  FLAG_DOUBLES, BANK_STORY, WRAM_ACTORS, wActors, ACTORF_X, ACTORF_Y, testFlag, setText, advanceText, speak,
  askYesNo, setAnim, waitIdle, wait, face, lockFacing, unlockFacing, setPosition, moveTarget, moveTargetRaw, waitMove,
  movePlayer, waitPlayerMove, setSpeed, playerSpeed, jumpVelocity, setActorScript, waitActorScript, actorState,
  attachStepMover, beginCutscene, endCutscene, pagedTextMenu, sound, goToLocation, farcall, scene,
} from "./common.js";
import { moveActorByDelta } from "../story/actor_moves.js";
import { playStarWarpTransition } from "./mario_world_0e.js";

const BANK = 0x0E;
// Mario World's actors (MarioWorldActors_0e, mario_world_0e.asm)
const ACTOR_MARIO_WORLD_BALLOON_EXCLAIM = 0x03, ACTOR_MARIO_WORLD_BALLOON_SWEAT_1 = 0x04;
const ACTOR_MARIO_WORLD_BALLOON_SWEAT_2 = 0x05, ACTOR_MARIO_WORLD_BALLOON_SWEAT_3 = 0x06;
const ACTOR_MARIO_WORLD_BALLOON_ANGRY = 0x07, ACTOR_MARIO_WORLD_PEACH = 0x08, ACTOR_MARIO_WORLD_YOSHI = 0x09;
const ACTOR_MARIO_WORLD_BABY_MARIO = 0x0A, ACTOR_MARIO_WORLD_LUIGI = 0x0B, ACTOR_MARIO_WORLD_DK = 0x0C;
const ACTOR_MARIO_WORLD_BOO = 0x0D, ACTOR_MARIO_WORLD_WALUIGI = 0x0E, ACTOR_MARIO_WORLD_BOWSER = 0x0F;
const ACTOR_MARIO_WORLD_WARIO = 0x10, ACTOR_MARIO_WORLD_WALK_77_05 = 0x11, ACTOR_MARIO_WORLD_MARIO = 0x12;
const ACTOR_MARIO_WORLD_TOAD = 0x13;
const FLAG_REACHED_MARIO_WORLD_SINGLES = 0xB2, FLAG_REACHED_MARIO_WORLD_DOUBLES = 0xB3;
const STORYLOC_SPECIAL_COURT = 0x1C;
const SFX_APPEAR2 = 0x96, SFX_CHIME = 0x97, SFX_APPEAR1 = 0x99;
const Text_5e_136 = 0x3088;
// the offer's texts (the singles and doubles exhibitions: three messages each, the match text 3 on) and entry points
const OFFER_TEXT_SINGLES = 0x3083, OFFER_TEXT_DOUBLES = 0x3089, ENTRY_SINGLES = 0x02, ENTRY_DOUBLES = 0x05;
const MENU_CANCELLED = 0xFF;
// actor scripts (data of this bank)
const ActorScript_0e_06 = 0x552D, ActorScript_0e_07 = 0x5545, ActorScript_0e_12 = 0x647E, ActorScript_0e_13 = 0x6491;
const ActorScript_0e_14 = 0x6529, ActorScript_0e_15 = 0x653C, ActorScript_0e_22 = 0x7C6E;
const OFFSTAGE = 63.0;                                 // the balloons parked off the map

// wMapScratch: the offer's text (a word) and, at +2, the special court's entry point
const scratchText = P => P.bus.u16(P.A.mapScratch);
function setOffer(P, text, entry) {
  P.bus.w8(P.A.mapScratch + 2, entry);
  P.bus.w16(P.A.mapScratch, text);
}

// MarioWorldNpc08FaceRight_0e / FaceLeft_0e (0E:64A4 / 0E:654F): the step up to Peach from her left or right: in
// singles the player walks round to (18, 13) facing up; in doubles the partner joins the player, then both walk in
// on actor scripts. Then the offer (PromptExhibitionMatch)
function* stepUpToPeach(P, x, playerScript, partnerScript) {
  setSpeed(P, ACTOR_PLAYER, 0.75);
  setSpeed(P, ACTOR_PARTNER, 0.75);
  if (!testFlag(P, FLAG_DOUBLES)) {
    moveTarget(P, ACTOR_PLAYER, x, 13.0);
    yield* waitMove(P, ACTOR_PLAYER);
    moveTarget(P, ACTOR_PLAYER, 18.0, 13.0);
    yield* waitMove(P, ACTOR_PLAYER);
    face(P, ACTOR_PLAYER, FACE_UP);
    face(P, ACTOR_MARIO_WORLD_PEACH, FACE_DOWN);
  } else {
    setActorScript(P, ACTOR_PARTNER, ActorScript_0e_22);
    yield* moveDoublesPartnerToPlayer(P);
    face(P, ACTOR_MARIO_WORLD_PEACH, FACE_DOWN);
    setActorScript(P, ACTOR_PLAYER, playerScript);
    yield* wait(P, 20);
    setActorScript(P, ACTOR_PARTNER, partnerScript);
    yield* waitActorScript(P, ACTOR_PLAYER);
    yield* waitActorScript(P, ACTOR_PARTNER);
  }
  yield* promptExhibitionMatch(P);
}
export const marioWorldNpc08FaceRight = P => stepUpToPeach(P, 16.0, ActorScript_0e_12, ActorScript_0e_13);
export const marioWorldNpc08FaceLeft = P => stepUpToPeach(P, 20.0, ActorScript_0e_14, ActorScript_0e_15);
// PromptExhibitionMatch (0E:65D4): Peach's offer (singles or doubles text) and Yes/No. No: her answer, the partner
// following again. Yes: on an odd story stage a menu of the exhibitions (cancel: the offer again) picks the entry
// point; her confirmation (text 3 on), the crowd turns and nods, Mario, Peach and the others walk off, Toad brings
// the players up, the star warp to the special court at that entry.
export function* promptExhibitionMatch(P) {
  beginCutscene(P);
  playerSpeed(P, 0.75);
  yield* movePlayer(P, 18.0, 13.0);
  yield* waitPlayerMove(P);
  setOffer(P, OFFER_TEXT_SINGLES, ENTRY_SINGLES);
  if (testFlag(P, FLAG_DOUBLES)) setOffer(P, OFFER_TEXT_DOUBLES, ENTRY_DOUBLES);
  for (;;) {
    yield* setText(P, scratchText(P));                             // .prompt
    if ((yield* askYesNo(P, ACTOR_MARIO_WORLD_PEACH)) !== 0) {
      yield* speak(P, ACTOR_MARIO_WORLD_PEACH);
      if (testFlag(P, FLAG_DOUBLES)) attachStepMover(P, actorState(P, ACTOR_PARTNER), wActors);
      endCutscene(P);
      return;
    }
    if (!(P.V.mapSceneStage & 1)) break;                           // (.accepted)
    advanceText(P);
    yield* speak(P, ACTOR_MARIO_WORLD_PEACH);
    const choice = yield* pagedTextMenu(P, Text_5e_136, 1);
    if (choice === MENU_CANCELLED) continue;
    P.bus.w8(P.A.mapScratch + 2, (choice + 1 + (testFlag(P, FLAG_DOUBLES) ? 3 : 0)) & 0xFF);
    break;
  }
  yield* setText(P, (scratchText(P) + 3) & 0xFFFF);                // .startMatchScene
  yield* speak(P, ACTOR_MARIO_WORLD_PEACH);
  for (const actor of [ACTOR_MARIO_WORLD_LUIGI, ACTOR_MARIO_WORLD_BOWSER, ACTOR_MARIO_WORLD_WARIO,
    ACTOR_MARIO_WORLD_BABY_MARIO, ACTOR_MARIO_WORLD_YOSHI]) {
    face(P, actor, FACE_UP);
    yield* wait(P, 4);
  }
  face(P, ACTOR_MARIO_WORLD_WALUIGI, FACE_UP);
  yield* wait(P, 10);
  for (const actor of [ACTOR_MARIO_WORLD_BOWSER, ACTOR_MARIO_WORLD_WARIO, ACTOR_MARIO_WORLD_WALUIGI,
    ACTOR_MARIO_WORLD_WALK_77_05, ACTOR_MARIO_WORLD_MARIO, ACTOR_MARIO_WORLD_LUIGI, ACTOR_MARIO_WORLD_BABY_MARIO,
    ACTOR_MARIO_WORLD_YOSHI, ACTOR_MARIO_WORLD_DK, ACTOR_MARIO_WORLD_TOAD]) setAnim(P, actor, ANIM_NOD);
  yield* waitIdle(P, ACTOR_MARIO_WORLD_TOAD);
  playerSpeed(P, 0.75);
  yield* movePlayer(P, 21.0, 13.0);
  for (const actor of [ACTOR_MARIO_WORLD_PEACH, ACTOR_MARIO_WORLD_BOWSER, ACTOR_MARIO_WORLD_WARIO,
    ACTOR_MARIO_WORLD_WALUIGI, ACTOR_MARIO_WORLD_WALK_77_05, ACTOR_MARIO_WORLD_MARIO, ACTOR_MARIO_WORLD_LUIGI,
    ACTOR_MARIO_WORLD_BABY_MARIO, ACTOR_MARIO_WORLD_YOSHI, ACTOR_MARIO_WORLD_BOO, ACTOR_MARIO_WORLD_DK,
    ACTOR_MARIO_WORLD_TOAD, ACTOR_PLAYER]) setSpeed(P, actor, 1.0);
  face(P, ACTOR_MARIO_WORLD_MARIO, FACE_RIGHT);
  yield* wait(P, 10);
  face(P, ACTOR_MARIO_WORLD_PEACH, FACE_RIGHT);
  yield* wait(P, 10);
  face(P, ACTOR_MARIO_WORLD_WALK_77_05, FACE_RIGHT);
  yield* wait(P, 20);
  setActorScript(P, ACTOR_MARIO_WORLD_MARIO, ActorScript_0e_06);
  yield* wait(P, 20);
  setActorScript(P, ACTOR_MARIO_WORLD_PEACH, ActorScript_0e_06);
  yield* wait(P, 20);
  setActorScript(P, ACTOR_MARIO_WORLD_WALK_77_05, ActorScript_0e_06);
  yield* wait(P, 100);
  if (!testFlag(P, FLAG_DOUBLES)) moveTarget(P, ACTOR_PLAYER, 18.0, 9.0);
  else {
    setSpeed(P, ACTOR_PARTNER, 1.0);
    moveTarget(P, ACTOR_PLAYER, 17.0, 9.0);
    moveTarget(P, ACTOR_PARTNER, 19.0, 9.0);
  }
  for (const actor of [ACTOR_MARIO_WORLD_LUIGI, ACTOR_MARIO_WORLD_BABY_MARIO, ACTOR_MARIO_WORLD_YOSHI,
    ACTOR_MARIO_WORLD_DK, ACTOR_MARIO_WORLD_BOO]) setActorScript(P, actor, ActorScript_0e_06);   // .crowdFollows
  yield* wait(P, 30);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  if (testFlag(P, FLAG_DOUBLES)) face(P, ACTOR_PARTNER, FACE_DOWN);
  setActorScript(P, ACTOR_MARIO_WORLD_BOWSER, ActorScript_0e_06);   // .dismissCrowd
  yield* wait(P, 40);
  setActorScript(P, ACTOR_MARIO_WORLD_WARIO, ActorScript_0e_06);
  yield* wait(P, 20);
  setActorScript(P, ACTOR_MARIO_WORLD_WALUIGI, ActorScript_0e_06);
  yield* waitActorScript(P, ACTOR_MARIO_WORLD_WALUIGI);
  yield* movePlayer(P, 18.0, 13.0);
  if (!testFlag(P, FLAG_DOUBLES)) moveTarget(P, ACTOR_PLAYER, 18.0, 11.0);
  else {
    moveTarget(P, ACTOR_PLAYER, 17.0, 11.0);
    moveTarget(P, ACTOR_PARTNER, 19.0, 11.0);
  }
  moveTarget(P, ACTOR_MARIO_WORLD_TOAD, 18.0, 13.0);                // .coachArrives
  yield* waitMove(P, ACTOR_MARIO_WORLD_TOAD);
  face(P, ACTOR_MARIO_WORLD_TOAD, FACE_UP);
  yield* wait(P, 20);
  yield* speak(P, ACTOR_MARIO_WORLD_TOAD);
  yield* wait(P, 10);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  if (testFlag(P, FLAG_DOUBLES)) setAnim(P, ACTOR_PARTNER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);                                 // .bothReady
  yield* wait(P, 20);
  setActorScript(P, ACTOR_MARIO_WORLD_TOAD, ActorScript_0e_07);
  yield* wait(P, 20);
  setActorScript(P, ACTOR_PLAYER, ActorScript_0e_07);
  if (testFlag(P, FLAG_DOUBLES)) {
    yield* wait(P, 40);
    setActorScript(P, ACTOR_PARTNER, ActorScript_0e_07);
  }
  yield* movePlayer(P, 21.0, 13.0);                                 // .leave
  yield* waitActorScript(P, ACTOR_PLAYER);
  yield* playStarWarpTransition(P);
  goToLocation(P, STORYLOC_SPECIAL_COURT, P.bus.u8(P.A.mapScratch + 2));
  endCutscene(P);
}
// MoveDoublesPartnerToPlayer (0E:6987): the partner walks to the player's position (WRAM 4 left mapped)
export function* moveDoublesPartnerToPlayer(P) {
  P.wramBank(WRAM_ACTORS);
  const bc = actorState(P, ACTOR_PLAYER);
  moveTargetRaw(P, ACTOR_PARTNER, P.bus.u16(bc + ACTORF_X), P.bus.u16(bc + ACTORF_Y));
  yield* waitMove(P, ACTOR_PARTNER);
}
// MarioWorldEntry0eScene (0E:69AD): back in Mario World once it was reached: the player (in doubles walked in, with
// the partner beside) below Peach's place, Peach at it, the crowd facing in, Toad at the side
export function* marioWorldEntry0eScene(P) {
  if (!testFlag(P, FLAG_DOUBLES)) {
    if (!testFlag(P, FLAG_REACHED_MARIO_WORLD_SINGLES)) return;
    setPosition(P, ACTOR_PLAYER, 18.0, 15.0);
  } else {
    if (!testFlag(P, FLAG_REACHED_MARIO_WORLD_DOUBLES)) return;
    beginCutscene(P);
    playerSpeed(P, 0.5);
    yield* movePlayer(P, 17.0, 15.0);
    yield* waitPlayerMove(P);
    setPosition(P, ACTOR_PLAYER, 17.0, 15.0);
    setPosition(P, ACTOR_PARTNER, 19.0, 15.0);
    endCutscene(P);
  }
  setPosition(P, ACTOR_MARIO_WORLD_PEACH, 18.0, 11.0);              // .placeActors
  for (const actor of [ACTOR_MARIO_WORLD_WARIO, ACTOR_MARIO_WORLD_BOWSER, ACTOR_MARIO_WORLD_BOO,
    ACTOR_MARIO_WORLD_WALUIGI]) face(P, actor, FACE_RIGHT);
  for (const actor of [ACTOR_MARIO_WORLD_LUIGI, ACTOR_MARIO_WORLD_BABY_MARIO, ACTOR_MARIO_WORLD_YOSHI,
    ACTOR_MARIO_WORLD_DK]) face(P, actor, FACE_LEFT);
  setPosition(P, ACTOR_MARIO_WORLD_TOAD, 13.0, 19.0);
  face(P, ACTOR_MARIO_WORLD_TOAD, FACE_RIGHT);
}
// MarioWorldArrivalIntroCutscene (0E:6A51): the first arrival: the player runs down the path, a chime and Toad's
// surprised jump, Toad hurries over (3 tiles right, 1 up) and turns down
export function* marioWorldArrivalIntroCutscene(P) {
  playerSpeed(P, 1.0);
  yield* movePlayer(P, 18.0, 15.0);
  yield* waitPlayerMove(P);
  yield* wait(P, 40);
  playerSpeed(P, 2.0);
  yield* movePlayer(P, 18.0, 25.0);
  yield* waitPlayerMove(P);
  sound(P, SFX_CHIME);
  setPosition(P, ACTOR_MARIO_WORLD_BALLOON_EXCLAIM, 16.0, 29.0);
  yield* wait(P, 10);
  jumpVelocity(P, ACTOR_MARIO_WORLD_TOAD, -2.0);
  jumpVelocity(P, ACTOR_MARIO_WORLD_BALLOON_EXCLAIM, -2.0);
  yield* wait(P, 30);
  setPosition(P, ACTOR_MARIO_WORLD_BALLOON_EXCLAIM, OFFSTAGE, OFFSTAGE);
  setSpeed(P, ACTOR_MARIO_WORLD_TOAD, 2.0);
  farcall(P, BANK_STORY, () => moveActorByDelta(P, ACTOR_MARIO_WORLD_TOAD, 0x0300, 0xFF00));
  yield* waitMove(P, ACTOR_MARIO_WORLD_TOAD);
  face(P, ACTOR_MARIO_WORLD_TOAD, FACE_DOWN);
}
// a run of turns: [actor, facing, frames after] (frames 0: no wait)
function* turns(P, list) {
  for (const [actor, facing, frames] of list) {
    face(P, actor, facing);
    if (frames) yield* wait(P, frames);
  }
}
// gestures played together, waited for on the last actor given
function* nods(P, actors, anim, waitOn) {
  for (const actor of actors) setAnim(P, actor, anim);
  yield* waitIdle(P, waitOn);
}
// the three sweat balloons off the map
function hideSweat(P) {
  for (const actor of [ACTOR_MARIO_WORLD_BALLOON_SWEAT_1, ACTOR_MARIO_WORLD_BALLOON_SWEAT_2,
    ACTOR_MARIO_WORLD_BALLOON_SWEAT_3]) setPosition(P, actor, OFFSTAGE, OFFSTAGE);
}
// MarioWorldWelcomeCutscene (0E:6AD4): the crowd turns to the player; Peach and Toad's partner welcome, Mario nods;
// Wario and Waluigi jump in, the crowd sweats; Bowser steps forward, shakes his head, is angry
export function* marioWorldWelcomeCutscene(P) {
  yield* wait(P, 10);
  yield* turns(P, [[ACTOR_MARIO_WORLD_PEACH, FACE_DOWN, 4], [ACTOR_MARIO_WORLD_WARIO, FACE_RIGHT, 4],
    [ACTOR_MARIO_WORLD_BOWSER, FACE_RIGHT, 4], [ACTOR_MARIO_WORLD_BOO, FACE_RIGHT, 4],
    [ACTOR_MARIO_WORLD_WALUIGI, FACE_RIGHT, 4], [ACTOR_MARIO_WORLD_LUIGI, FACE_LEFT, 4],
    [ACTOR_MARIO_WORLD_BABY_MARIO, FACE_LEFT, 4], [ACTOR_MARIO_WORLD_YOSHI, FACE_LEFT, 4],
    [ACTOR_MARIO_WORLD_TOAD, FACE_UP, 4], [ACTOR_MARIO_WORLD_DK, FACE_UP, 20]]);
  yield* nods(P, [ACTOR_MARIO_WORLD_PEACH], ANIM_NOD, ACTOR_MARIO_WORLD_PEACH);
  yield* speak(P, ACTOR_MARIO_WORLD_PEACH);
  yield* wait(P, 20);
  yield* nods(P, [ACTOR_MARIO_WORLD_WALK_77_05], ANIM_NOD, ACTOR_MARIO_WORLD_WALK_77_05);
  yield* speak(P, ACTOR_MARIO_WORLD_WALK_77_05);
  yield* turns(P, [[ACTOR_MARIO_WORLD_PEACH, FACE_LEFT, 10], [ACTOR_MARIO_WORLD_WALK_77_05, FACE_RIGHT, 20]]);
  yield* nods(P, [ACTOR_MARIO_WORLD_WALK_77_05, ACTOR_MARIO_WORLD_PEACH], ANIM_NOD, ACTOR_MARIO_WORLD_PEACH);
  yield* wait(P, 10);
  yield* turns(P, [[ACTOR_MARIO_WORLD_PEACH, FACE_DOWN, 10], [ACTOR_MARIO_WORLD_WALK_77_05, FACE_DOWN, 30]]);
  yield* speak(P, ACTOR_MARIO_WORLD_PEACH);
  yield* turns(P, [[ACTOR_MARIO_WORLD_PEACH, FACE_RIGHT, 10], [ACTOR_MARIO_WORLD_MARIO, FACE_LEFT, 20]]);
  yield* nods(P, [ACTOR_MARIO_WORLD_MARIO, ACTOR_MARIO_WORLD_PEACH], ANIM_NOD, ACTOR_MARIO_WORLD_PEACH);
  yield* wait(P, 10);
  yield* turns(P, [[ACTOR_MARIO_WORLD_PEACH, FACE_DOWN, 10], [ACTOR_MARIO_WORLD_MARIO, FACE_DOWN, 30]]);
  yield* speak(P, ACTOR_MARIO_WORLD_PEACH);
  yield* wait(P, 20);
  jumpVelocity(P, ACTOR_MARIO_WORLD_WARIO, -2.0);
  yield* wait(P, 20);
  face(P, ACTOR_MARIO_WORLD_WARIO, FACE_UP);
  yield* nods(P, [ACTOR_MARIO_WORLD_WARIO], ANIM_BOUNCE, ACTOR_MARIO_WORLD_WARIO);
  yield* speak(P, ACTOR_MARIO_WORLD_WARIO);
  yield* wait(P, 10);
  jumpVelocity(P, ACTOR_MARIO_WORLD_WALUIGI, -3.0);
  yield* wait(P, 40);
  face(P, ACTOR_MARIO_WORLD_WALUIGI, FACE_UP);
  yield* nods(P, [ACTOR_MARIO_WORLD_WALUIGI], ANIM_BOUNCE, ACTOR_MARIO_WORLD_WALUIGI);
  yield* speak(P, ACTOR_MARIO_WORLD_WALUIGI);
  yield* wait(P, 20);
  sound(P, SFX_APPEAR2);
  setPosition(P, ACTOR_MARIO_WORLD_BALLOON_SWEAT_1, 15.0, 9.0);
  yield* wait(P, 4);
  sound(P, SFX_APPEAR2);
  setPosition(P, ACTOR_MARIO_WORLD_BALLOON_SWEAT_2, 19.0, 7.0);
  yield* wait(P, 4);
  sound(P, SFX_APPEAR2);
  setPosition(P, ACTOR_MARIO_WORLD_BALLOON_SWEAT_3, 23.0, 9.0);
  yield* wait(P, 40);
  yield* turns(P, [[ACTOR_MARIO_WORLD_PEACH, FACE_LEFT, 10], [ACTOR_MARIO_WORLD_WALK_77_05, FACE_RIGHT, 40],
    [ACTOR_MARIO_WORLD_PEACH, FACE_RIGHT, 10], [ACTOR_MARIO_WORLD_MARIO, FACE_LEFT, 60]]);
  moveTarget(P, ACTOR_MARIO_WORLD_BOWSER, 14.0, 15.0);
  yield* waitMove(P, ACTOR_MARIO_WORLD_BOWSER);
  yield* turns(P, [[ACTOR_MARIO_WORLD_BOWSER, FACE_UP, 4], [ACTOR_MARIO_WORLD_WALK_77_05, FACE_DOWN, 4],
    [ACTOR_MARIO_WORLD_PEACH, FACE_DOWN, 4], [ACTOR_MARIO_WORLD_MARIO, FACE_DOWN, 20]]);
  hideSweat(P);
  yield* speak(P, ACTOR_MARIO_WORLD_BOWSER);
  yield* wait(P, 10);
  yield* nods(P, [ACTOR_MARIO_WORLD_BOWSER], ANIM_SHAKE, ACTOR_MARIO_WORLD_BOWSER);
  face(P, ACTOR_MARIO_WORLD_BOWSER, FACE_RIGHT);
  sound(P, SFX_APPEAR1);
  setPosition(P, ACTOR_MARIO_WORLD_BALLOON_ANGRY, 15.0, 13.0);
  yield* wait(P, 20);
  yield* speak(P, ACTOR_MARIO_WORLD_BOWSER);
}
// MarioWorldLuigiDefendsChampCutscene (0E:6DB7): Luigi jumps up for the champion and walks in; Bowser, angry,
// bounces and steps up with Wario and Waluigi; Luigi backs off
export function* marioWorldLuigiDefendsChampCutscene(P) {
  jumpVelocity(P, ACTOR_MARIO_WORLD_LUIGI, -2.0);
  yield* wait(P, 20);
  yield* speak(P, ACTOR_MARIO_WORLD_LUIGI);
  hideSweat(P);
  yield* wait(P, 10);
  yield* turns(P, [[ACTOR_MARIO_WORLD_BOWSER, FACE_RIGHT, 4], [ACTOR_MARIO_WORLD_WARIO, FACE_RIGHT, 4],
    [ACTOR_MARIO_WORLD_WALUIGI, FACE_RIGHT, 4], [ACTOR_MARIO_WORLD_PEACH, FACE_RIGHT, 0],
    [ACTOR_MARIO_WORLD_BABY_MARIO, FACE_UP, 4], [ACTOR_MARIO_WORLD_WALK_77_05, FACE_RIGHT, 0],
    [ACTOR_MARIO_WORLD_YOSHI, FACE_UP, 0]]);
  setSpeed(P, ACTOR_MARIO_WORLD_LUIGI, 1.0);
  moveTarget(P, ACTOR_MARIO_WORLD_LUIGI, 22.0, 13.0);
  yield* waitMove(P, ACTOR_MARIO_WORLD_LUIGI);
  yield* wait(P, 10);
  yield* speak(P, ACTOR_MARIO_WORLD_LUIGI);
  yield* wait(P, 10);
  face(P, ACTOR_MARIO_WORLD_BOWSER, FACE_RIGHT);
  sound(P, SFX_APPEAR1);
  setPosition(P, ACTOR_MARIO_WORLD_BALLOON_ANGRY, 18.0, 11.0);
  yield* wait(P, 10);
  yield* nods(P, [ACTOR_MARIO_WORLD_BOWSER], ANIM_BOUNCE, ACTOR_MARIO_WORLD_BOWSER);
  yield* wait(P, 10);
  yield* speak(P, ACTOR_MARIO_WORLD_BOWSER);
  face(P, ACTOR_MARIO_WORLD_WARIO, FACE_RIGHT);
  face(P, ACTOR_MARIO_WORLD_WALUIGI, FACE_RIGHT);
  setPosition(P, ACTOR_MARIO_WORLD_BALLOON_ANGRY, OFFSTAGE, OFFSTAGE);
  moveTarget(P, ACTOR_MARIO_WORLD_BOWSER, 19.0, 13.0);
  yield* waitMove(P, ACTOR_MARIO_WORLD_BOWSER);
  yield* wait(P, 10);
  face(P, ACTOR_MARIO_WORLD_BABY_MARIO, FACE_LEFT);
  moveTarget(P, ACTOR_MARIO_WORLD_WARIO, 17.0, 13.0);
  yield* wait(P, 10);
  face(P, ACTOR_MARIO_WORLD_YOSHI, FACE_LEFT);
  moveTarget(P, ACTOR_MARIO_WORLD_WALUIGI, 19.0, 15.0);
  yield* waitMove(P, ACTOR_MARIO_WORLD_WALUIGI);
  yield* wait(P, 10);
  lockFacing(P, ACTOR_MARIO_WORLD_LUIGI);
  moveTarget(P, ACTOR_MARIO_WORLD_LUIGI, 24.0, 13.0);
  yield* waitMove(P, ACTOR_MARIO_WORLD_LUIGI);
  face(P, ACTOR_MARIO_WORLD_LUIGI, FACE_LEFT);
  unlockFacing(P, ACTOR_MARIO_WORLD_LUIGI);
}
// MarioWorldExhibitionDemandCutscene (0E:6F2B): Wario demands a match, Bowser and Waluigi nod, Waluigi jumps; Peach
// and Mario agree; the villains nod, Wario jumps once more
export function* marioWorldExhibitionDemandCutscene(P) {
  face(P, ACTOR_MARIO_WORLD_WARIO, FACE_UP);
  yield* wait(P, 10);
  yield* speak(P, ACTOR_MARIO_WORLD_WARIO);
  yield* wait(P, 10);
  yield* turns(P, [[ACTOR_MARIO_WORLD_BOWSER, FACE_DOWN, 10], [ACTOR_MARIO_WORLD_WALUIGI, FACE_UP, 40]]);
  yield* nods(P, [ACTOR_MARIO_WORLD_BOWSER, ACTOR_MARIO_WORLD_WALUIGI], ANIM_NOD, ACTOR_MARIO_WORLD_WALUIGI);
  yield* wait(P, 10);
  yield* turns(P, [[ACTOR_MARIO_WORLD_BOWSER, FACE_UP, 4], [ACTOR_MARIO_WORLD_WALUIGI, FACE_UP, 10]]);
  jumpVelocity(P, ACTOR_MARIO_WORLD_WALUIGI, -3.0);
  yield* wait(P, 40);
  yield* speak(P, ACTOR_MARIO_WORLD_WALUIGI);
  yield* wait(P, 10);
  sound(P, SFX_APPEAR2);
  setPosition(P, ACTOR_MARIO_WORLD_BALLOON_SWEAT_1, 19.0, 9.0);
  setPosition(P, ACTOR_MARIO_WORLD_BALLOON_SWEAT_2, 23.0, 9.0);
  yield* wait(P, 20);
  yield* turns(P, [[ACTOR_MARIO_WORLD_PEACH, FACE_RIGHT, 10], [ACTOR_MARIO_WORLD_MARIO, FACE_LEFT, 20]]);
  setPosition(P, ACTOR_MARIO_WORLD_BALLOON_SWEAT_1, OFFSTAGE, OFFSTAGE);
  setPosition(P, ACTOR_MARIO_WORLD_BALLOON_SWEAT_2, OFFSTAGE, OFFSTAGE);
  yield* wait(P, 20);
  yield* nods(P, [ACTOR_MARIO_WORLD_PEACH, ACTOR_MARIO_WORLD_MARIO], ANIM_NOD, ACTOR_MARIO_WORLD_MARIO);
  yield* wait(P, 10);
  yield* turns(P, [[ACTOR_MARIO_WORLD_PEACH, FACE_DOWN, 10], [ACTOR_MARIO_WORLD_MARIO, FACE_DOWN, 0]]);
  yield* speak(P, ACTOR_MARIO_WORLD_PEACH);
  yield* wait(P, 20);
  yield* nods(P, [ACTOR_MARIO_WORLD_BOWSER, ACTOR_MARIO_WORLD_WARIO, ACTOR_MARIO_WORLD_WALUIGI], ANIM_NOD,
    ACTOR_MARIO_WORLD_WALUIGI);
  yield* wait(P, 20);
  jumpVelocity(P, ACTOR_MARIO_WORLD_WARIO, -2.0);
  yield* wait(P, 40);
  yield* speak(P, ACTOR_MARIO_WORLD_WARIO);
  yield* wait(P, 10);
}

export const HOOKS = [
  scene(BANK, 0x64A4, marioWorldNpc08FaceRight),
  scene(BANK, 0x654F, marioWorldNpc08FaceLeft),
  scene(BANK, 0x65D4, promptExhibitionMatch),
  scene(BANK, 0x6987, moveDoublesPartnerToPlayer),
  scene(BANK, 0x69AD, marioWorldEntry0eScene),
  scene(BANK, 0x6A51, marioWorldArrivalIntroCutscene),
  scene(BANK, 0x6AD4, marioWorldWelcomeCutscene),
  scene(BANK, 0x6DB7, marioWorldLuigiDefendsChampCutscene),
  scene(BANK, 0x6F2B, marioWorldExhibitionDemandCutscene),
];
