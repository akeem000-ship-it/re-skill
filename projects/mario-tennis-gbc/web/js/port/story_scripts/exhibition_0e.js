// Mario World's exhibition (bank $0E, $5938-$6481): the exhibition accepted (singles or doubles: everyone nods,
// the crowd walks off to the special court, Toad leads the party through the star warp), the doubles party's
// arrival in Mario World (the welcome, Bowser's company crowding in, Peach's demand for an exhibition and the
// question; the short version while the ending credits run), and the party stepping in front of Peach from below
// or above before her prompt. The actor scripts (ActorScript_0e_08..11) are data.
// Port of src/story/exhibition_0e.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss1_mw*.mtrec (scripted: Mario World in singles and doubles).
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FACE_DOWN, FACE_LEFT, FACE_RIGHT, FACE_UP, ANIM_NOD, ANIM_BOUNCE, FLAG_DOUBLES,
  testFlag, setFlag, setText, speak, askYesNo, gesture, setAnim, waitIdle, face, setPosition, moveTarget, waitMove,
  setSpeed, playerSpeed, movePlayer, waitPlayerMove, jumpVelocity, setActorScript, waitActorScript, lockFacing,
  unlockFacing, wait, fadeInAndWait, sound, goToLocation, requestExit, followPlayer, BANK_SAVE, scene,
} from "./common.js";

const BANK = 0x0E;
const ACTOR_MARIO_WORLD_BALLOON_SWEAT_1 = 0x04, ACTOR_MARIO_WORLD_BALLOON_SWEAT_2 = 0x05;
const ACTOR_MARIO_WORLD_BALLOON_SWEAT_3 = 0x06, ACTOR_MARIO_WORLD_BALLOON_ANGRY = 0x07;
const ACTOR_MARIO_WORLD_PEACH = 0x08, ACTOR_MARIO_WORLD_YOSHI = 0x09, ACTOR_MARIO_WORLD_BABY_MARIO = 0x0A;
const ACTOR_MARIO_WORLD_LUIGI = 0x0B, ACTOR_MARIO_WORLD_DK = 0x0C, ACTOR_MARIO_WORLD_BOO = 0x0D;
const ACTOR_MARIO_WORLD_WALUIGI = 0x0E, ACTOR_MARIO_WORLD_BOWSER = 0x0F, ACTOR_MARIO_WORLD_WARIO = 0x10;
const ACTOR_MARIO_WORLD_WALK_77_05 = 0x11, ACTOR_MARIO_WORLD_MARIO = 0x12, ACTOR_MARIO_WORLD_TOAD = 0x13;
const PEACH = ACTOR_MARIO_WORLD_PEACH, BOWSER = ACTOR_MARIO_WORLD_BOWSER, WARIO = ACTOR_MARIO_WORLD_WARIO;
const WALUIGI = ACTOR_MARIO_WORLD_WALUIGI, TOAD = ACTOR_MARIO_WORLD_TOAD, MARIO = ACTOR_MARIO_WORLD_MARIO;
const BOO = ACTOR_MARIO_WORLD_BOO, ANGRY = ACTOR_MARIO_WORLD_BALLOON_ANGRY;
const ActorScript_0e_06 = 0x552D, ActorScript_0e_07 = 0x5545, ActorScript_0e_08 = 0x630B;
const ActorScript_0e_09 = 0x6324, ActorScript_0e_10 = 0x63DA, ActorScript_0e_11 = 0x63E7, ActorScript_0e_22 = 0x7C6E;
const FLAG_ENDING_CREDITS_RUNNING = 0x6E, FLAG_REACHED_MARIO_WORLD_DOUBLES = 0xB3;
const SFX_THUD = 0x86, SFX_APPEAR2 = 0x96, SFX_APPEAR1 = 0x99;
const STORYLOC_SPECIAL_COURT = 0x1C;
const Text_5e_99 = 0x3063, Text_5e_102 = 0x3066, Text_5e_125 = 0x307D, Text_5e_128 = 0x3080;
const SaveStorySlotWithTimer = 0x4D10;
// mario_world_0e.asm's scenes (not ported here)
const PromptExhibitionMatch = 0x65D4, MoveDoublesPartnerToPlayer = 0x6987, MarioWorldEntry0eScene_doubles = 0x69C5;
const MarioWorldArrivalIntroCutscene = 0x6A51, MarioWorldWelcomeCutscene = 0x6AD4;
const MarioWorldLuigiDefendsChampCutscene = 0x6DB7, MarioWorldExhibitionDemandCutscene = 0x6F2B;
const ExhibitionDeclinedCutscene = 0x7082, PlayStarWarpTransition = 0x7150;
const rom = (P, addr) => P.runRom(BANK, addr);

// ---- the exhibition accepted ----
// Bowser's nod and line (text), Peach's; the crowd turns up one after another, all nod; everyone to walking speed
// and off on ActorScript_0e_06 in groups; Bowser and Wario last
function* exhibitionCrowdLeaves(P, text) {
  yield* wait(P, 10);
  yield* gesture(P, BOWSER, ANIM_NOD);
  yield* wait(P, 10);
  yield* setText(P, text);
  yield* speak(P, BOWSER);
  yield* speak(P, PEACH);
  const turning = [ACTOR_MARIO_WORLD_LUIGI, BOWSER, WARIO, ACTOR_MARIO_WORLD_BABY_MARIO, ACTOR_MARIO_WORLD_YOSHI, WALUIGI];
  for (const [i, actor] of turning.entries()) {
    face(P, actor, FACE_UP);
    yield* wait(P, i < turning.length - 1 ? 4 : 10);
  }
  for (const actor of [BOWSER, WARIO, WALUIGI, ACTOR_MARIO_WORLD_WALK_77_05, MARIO, ACTOR_MARIO_WORLD_LUIGI,
    ACTOR_MARIO_WORLD_BABY_MARIO, ACTOR_MARIO_WORLD_YOSHI, ACTOR_MARIO_WORLD_DK, TOAD]) setAnim(P, actor, ANIM_NOD);
  yield* waitIdle(P, TOAD);
  playerSpeed(P, 0.5);
  yield* movePlayer(P, 21.0, 13.0);
  for (const actor of [PEACH, BOWSER, WARIO, WALUIGI, ACTOR_MARIO_WORLD_WALK_77_05, MARIO, ACTOR_MARIO_WORLD_LUIGI,
    ACTOR_MARIO_WORLD_BABY_MARIO, ACTOR_MARIO_WORLD_YOSHI, BOO, ACTOR_MARIO_WORLD_DK, TOAD, ACTOR_PLAYER]) {
    setSpeed(P, actor, 0.625);
  }
  setActorScript(P, ACTOR_MARIO_WORLD_WALK_77_05, ActorScript_0e_06);
  yield* wait(P, 20);
  setActorScript(P, PEACH, ActorScript_0e_06);
  yield* wait(P, 20);
  setActorScript(P, MARIO, ActorScript_0e_06);
  yield* wait(P, 100);
  for (const actor of [ACTOR_MARIO_WORLD_LUIGI, ACTOR_MARIO_WORLD_BABY_MARIO, ACTOR_MARIO_WORLD_YOSHI,
    ACTOR_MARIO_WORLD_DK, BOO]) setActorScript(P, actor, ActorScript_0e_06);
  yield* wait(P, 60);
  setActorScript(P, BOWSER, ActorScript_0e_06);
  setActorScript(P, WARIO, ActorScript_0e_06);
}
// the party in front of Toad: the player to (18, 13), Toad around to face it and his line
function* toadLeads(P) {
  yield* movePlayer(P, 18.0, 13.0);
  moveTarget(P, TOAD, 16.0, 15.0);
  yield* waitMove(P, TOAD);
  moveTarget(P, TOAD, 18.0, 15.0);
  yield* waitMove(P, TOAD);
  face(P, TOAD, FACE_DOWN);
  yield* wait(P, 20);
  yield* speak(P, TOAD);
  yield* wait(P, 10);
}
// the star warp (PlayStarWarpTransition, 0E:7150), to the special court at entry
function* starWarpTo(P, entry) {
  yield* rom(P, PlayStarWarpTransition);
  goToLocation(P, STORYLOC_SPECIAL_COURT, entry);
}
// ExhibitionAcceptedSingles (0E:5938): Waluigi last; the player nods and follows Toad through the warp (entry 1)
export function* exhibitionAcceptedSingles(P) {
  yield* exhibitionCrowdLeaves(P, Text_5e_99);
  yield* wait(P, 40);
  setActorScript(P, WALUIGI, ActorScript_0e_06);
  yield* waitActorScript(P, WALUIGI);
  yield* toadLeads(P);
  yield* gesture(P, ACTOR_PLAYER, ANIM_NOD);
  yield* wait(P, 20);
  setActorScript(P, TOAD, ActorScript_0e_07);
  yield* wait(P, 20);
  setActorScript(P, ACTOR_PLAYER, ActorScript_0e_07);
  yield* wait(P, 60);
  yield* movePlayer(P, 21.0, 13.0);
  yield* waitActorScript(P, ACTOR_PLAYER);
  yield* starWarpTo(P, 0x01);
}
// ExhibitionAcceptedDoubles (0E:6060): Waluigi steps aside first; both nod and follow Toad (entry 4)
export function* exhibitionAcceptedDoubles(P) {
  yield* exhibitionCrowdLeaves(P, Text_5e_128);
  yield* wait(P, 30);
  moveTarget(P, WALUIGI, 21.0, 19.0);
  yield* waitMove(P, WALUIGI);
  setActorScript(P, WALUIGI, ActorScript_0e_06);
  yield* waitActorScript(P, WALUIGI);
  yield* toadLeads(P);
  setAnim(P, ACTOR_PARTNER, ANIM_NOD);
  yield* gesture(P, ACTOR_PLAYER, ANIM_NOD);
  yield* wait(P, 20);
  setActorScript(P, TOAD, ActorScript_0e_07);
  yield* wait(P, 20);
  setActorScript(P, ACTOR_PLAYER, ActorScript_0e_07);
  yield* wait(P, 50);
  setActorScript(P, ACTOR_PARTNER, ActorScript_0e_07);
  yield* wait(P, 60);
  yield* movePlayer(P, 21.0, 13.0);
  yield* waitActorScript(P, ACTOR_PARTNER);
  yield* starWarpTo(P, 0x04);
}

// ---- the doubles arrival ----
// an actor stepping to (x, y) facing first `before`, then up
function* stepTo(P, actor, before, x, y) {
  face(P, actor, before);
  moveTarget(P, actor, x, y);
  yield* waitMove(P, actor);
  face(P, actor, FACE_UP);
}
// MarioWorldArrivalDoubles (0E:5BBA): (once there before, outside the credits: MarioWorldEntry0eScene.doubles)
// the intro; the party walks up to Peach and Toad (their lines outside the credits); in the credits Peach turns and
// the scene leaves through exit 1; else the welcome and the whole cast's scene up to Peach's question
export function* marioWorldArrivalDoubles(P) {
  const credits = () => testFlag(P, FLAG_ENDING_CREDITS_RUNNING);
  if (!credits() && testFlag(P, FLAG_REACHED_MARIO_WORLD_DOUBLES)) return yield* rom(P, MarioWorldEntry0eScene_doubles);
  setActorScript(P, ACTOR_PARTNER, ActorScript_0e_22);  // .arrive
  setPosition(P, ACTOR_PLAYER, 63.0, 63.0);
  setPosition(P, ACTOR_PARTNER, 63.0, 63.0);
  yield* fadeInAndWait(P, 4);
  yield* wait(P, 40);
  yield* rom(P, MarioWorldArrivalIntroCutscene);
  setPosition(P, ACTOR_PLAYER, 17.0, 37.0);
  setPosition(P, ACTOR_PARTNER, 19.0, 37.0);
  setSpeed(P, ACTOR_PLAYER, 0.5);
  setSpeed(P, ACTOR_PARTNER, 0.5);
  moveTarget(P, ACTOR_PLAYER, 17.0, 32.5);
  moveTarget(P, ACTOR_PARTNER, 19.0, 32.5);
  playerSpeed(P, 0.5);
  yield* movePlayer(P, 18.0, 27.0);
  yield* wait(P, 80);
  face(P, TOAD, FACE_UP);
  yield* wait(P, 10);
  if (!credits()) {
    yield* setText(P, Text_5e_102);
    yield* speak(P, TOAD);
    yield* speak(P, TOAD);
  }
  playerSpeed(P, 1.0);                                  // .walkIn
  yield* movePlayer(P, 18.0, 24.0);
  yield* waitPlayerMove(P);
  yield* wait(P, 10);
  yield* gesture(P, PEACH, ANIM_NOD);
  if (!credits()) yield* speak(P, PEACH);
  playerSpeed(P, 0.625);                                // .approach
  for (const actor of [ACTOR_PLAYER, ACTOR_PARTNER, TOAD, PEACH]) setSpeed(P, actor, 0.625);
  moveTarget(P, TOAD, 18.0, 23.0);
  yield* wait(P, 20);
  moveTarget(P, ACTOR_PLAYER, 17.0, 17.0);
  moveTarget(P, ACTOR_PARTNER, 19.0, 17.0);
  yield* wait(P, 40);
  yield* movePlayer(P, 18.0, 13.0);
  yield* waitMove(P, TOAD);
  moveTarget(P, PEACH, 18.0, 9.0);
  moveTarget(P, TOAD, 18.0, 19.0);
  yield* waitMove(P, TOAD);
  moveTarget(P, TOAD, 13.0, 19.0);
  yield* waitMove(P, PEACH);
  if (credits()) {
    face(P, PEACH, FACE_DOWN);
    yield* wait(P, 20);
    requestExit(P, 0x01);
    return;
  }
  yield* rom(P, MarioWorldWelcomeCutscene);             // .done
  setPosition(P, ANGRY, 63.0, 63.0);
  face(P, BOWSER, FACE_LEFT);
  yield* wait(P, 40);
  yield* speak(P, BOWSER);
  yield* wait(P, 20);
  jumpVelocity(P, BOO, -2.0);
  yield* wait(P, 20);
  jumpVelocity(P, BOO, -2.0);
  yield* wait(P, 40);
  sound(P, SFX_THUD);
  yield* speak(P, BOO);
  sound(P, SFX_APPEAR1);
  setPosition(P, ANGRY, 15.0, 13.0);
  setSpeed(P, BOWSER, 1.0);
  setSpeed(P, ANGRY, 1.0);
  yield* wait(P, 40);
  yield* gesture(P, BOWSER, ANIM_BOUNCE);
  moveTarget(P, BOWSER, 15.0, 14.0);
  moveTarget(P, ANGRY, 16.0, 12.0);
  yield* waitMove(P, ANGRY);
  setPosition(P, ANGRY, 63.0, 63.0);
  face(P, BOWSER, FACE_UP);
  yield* wait(P, 20);
  yield* speak(P, BOWSER);
  setSpeed(P, WARIO, 1.0);
  setSpeed(P, WALUIGI, 1.0);
  moveTarget(P, BOWSER, 15.0, 13.0);
  yield* waitMove(P, BOWSER);
  yield* wait(P, 10);
  yield* stepTo(P, WARIO, FACE_RIGHT, 13.5, 13.0);
  yield* wait(P, 10);
  yield* stepTo(P, WALUIGI, FACE_RIGHT, 15.5, 15.5);
  yield* wait(P, 40);
  for (const [balloon, x, y] of [[ACTOR_MARIO_WORLD_BALLOON_SWEAT_1, 15.0, 9.0],
    [ACTOR_MARIO_WORLD_BALLOON_SWEAT_2, 19.0, 7.0], [ACTOR_MARIO_WORLD_BALLOON_SWEAT_3, 23.0, 9.0]]) {
    sound(P, SFX_APPEAR1);
    setPosition(P, balloon, x, y);
    yield* wait(P, 4);
  }
  yield* stepTo(P, BOWSER, FACE_RIGHT, 17.0, 13.0);
  yield* wait(P, 10);
  yield* stepTo(P, WARIO, FACE_RIGHT, 15.0, 13.0);
  yield* wait(P, 10);
  yield* stepTo(P, WALUIGI, FACE_RIGHT, 17.0, 15.0);
  yield* wait(P, 10);
  yield* rom(P, MarioWorldLuigiDefendsChampCutscene);
  sound(P, SFX_APPEAR2);
  setPosition(P, ACTOR_MARIO_WORLD_BALLOON_SWEAT_1, 17.5, 15.5);
  setPosition(P, ACTOR_MARIO_WORLD_BALLOON_SWEAT_2, 19.5, 15.5);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  face(P, ACTOR_PARTNER, FACE_LEFT);
  yield* wait(P, 40);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, ACTOR_PARTNER, FACE_UP);
  yield* wait(P, 20);
  setPosition(P, ACTOR_MARIO_WORLD_BALLOON_SWEAT_1, 63.0, 63.0);
  setPosition(P, ACTOR_MARIO_WORLD_BALLOON_SWEAT_2, 63.0, 63.0);
  face(P, MARIO, FACE_LEFT);
  yield* wait(P, 40);
  setAnim(P, PEACH, ANIM_NOD);
  yield* gesture(P, MARIO, ANIM_NOD);
  yield* wait(P, 10);
  face(P, PEACH, FACE_DOWN);
  yield* wait(P, 10);
  setSpeed(P, PEACH, 1.0);
  moveTarget(P, PEACH, 18.0, 11.0);
  yield* waitMove(P, PEACH);
  face(P, ACTOR_MARIO_WORLD_WALK_77_05, FACE_DOWN);
  face(P, MARIO, FACE_DOWN);
  yield* speak(P, PEACH);
  yield* rom(P, MarioWorldExhibitionDemandCutscene);
  moveTarget(P, BOWSER, 19.0, 15.0);
  moveTarget(P, WARIO, 17.0, 15.0);
  moveTarget(P, WALUIGI, 21.0, 15.0);
  yield* waitMove(P, WALUIGI);
  moveTarget(P, WALUIGI, 21.0, 19.0);
  yield* waitMove(P, WALUIGI);
  moveTarget(P, WALUIGI, 19.0, 19.0);
  yield* waitMove(P, WALUIGI);
  face(P, WALUIGI, FACE_UP);
  yield* wait(P, 40);
  setFlag(P, FLAG_REACHED_MARIO_WORLD_DOUBLES);
  yield* P.runRom(BANK_SAVE, SaveStorySlotWithTimer);
  if ((yield* askYesNo(P, PEACH)) === 0) return yield* exhibitionAcceptedDoubles(P);
  yield* setText(P, Text_5e_125);
  yield* rom(P, ExhibitionDeclinedCutscene);
  followPlayer(P, ACTOR_PARTNER);
}

// ---- in front of Peach ----
// in doubles: the partner on its waypoint script and to the player (MoveDoublesPartnerToPlayer, 0E:6987), Peach
// turned down, the two on their walk scripts (scriptA, then scriptB 20 frames later) to her
function* doublesToPeach(P, scriptA, scriptB) {
  setActorScript(P, ACTOR_PARTNER, ActorScript_0e_22);
  yield* rom(P, MoveDoublesPartnerToPlayer);
  face(P, PEACH, FACE_DOWN);
  setActorScript(P, ACTOR_PLAYER, scriptA);
  yield* wait(P, 20);
  setActorScript(P, ACTOR_PARTNER, scriptB);
  yield* waitActorScript(P, ACTOR_PLAYER);
  yield* waitActorScript(P, ACTOR_PARTNER);
}
// MarioWorldNpc08FaceDown_0e (0E:633D): Peach talked to from below: the player around to (18, 13) facing her
// (in doubles both walk there); then her prompt (PromptExhibitionMatch, 0E:65D4)
export function* marioWorldNpc08FaceDown(P) {
  setSpeed(P, ACTOR_PLAYER, 0.75);
  setSpeed(P, ACTOR_PARTNER, 0.75);
  if (testFlag(P, FLAG_DOUBLES)) yield* doublesToPeach(P, ActorScript_0e_08, ActorScript_0e_09);
  else {
    for (const [x, y] of [[16.0, 9.0], [16.0, 13.0], [18.0, 13.0]]) {
      moveTarget(P, ACTOR_PLAYER, x, y);
      yield* waitMove(P, ACTOR_PLAYER);
    }
    face(P, ACTOR_PLAYER, FACE_UP);
    face(P, PEACH, FACE_DOWN);
    setSpeed(P, ACTOR_PLAYER, 0.5);
  }
  yield* rom(P, PromptExhibitionMatch);
}
// MarioWorldNpc08FaceUp_0e (0E:63F4): from above: the player backs down to (18, 13) (facing kept), turns up
export function* marioWorldNpc08FaceUp(P) {
  setSpeed(P, ACTOR_PLAYER, 0.75);
  setSpeed(P, ACTOR_PARTNER, 0.75);
  if (testFlag(P, FLAG_DOUBLES)) yield* doublesToPeach(P, ActorScript_0e_10, ActorScript_0e_11);
  else {
    lockFacing(P, ACTOR_PLAYER);
    moveTarget(P, ACTOR_PLAYER, 18.0, 13.0);
    yield* waitMove(P, ACTOR_PLAYER);
    unlockFacing(P, ACTOR_PLAYER);
    face(P, ACTOR_PLAYER, FACE_UP);
    face(P, ACTOR_PLAYER, FACE_UP);
    face(P, PEACH, FACE_DOWN);
  }
  yield* rom(P, PromptExhibitionMatch);
}

export const HOOKS = [
  scene(BANK, 0x5938, exhibitionAcceptedSingles),
  scene(BANK, 0x5BBA, marioWorldArrivalDoubles),
  scene(BANK, 0x6060, exhibitionAcceptedDoubles),
  scene(BANK, 0x633D, marioWorldNpc08FaceDown),
  scene(BANK, 0x63F4, marioWorldNpc08FaceUp),
];
