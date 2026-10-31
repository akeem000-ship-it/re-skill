// The ending's varsity scenes (bank $27, $5557-$617F): End10 on the varsity court (the party met by the varsity
// students: Bob's question, Kate or the partner's bounce, the others' reactions; in doubles the partner's dance)
// and End8 on the senior court (Fay and Allie, Emily running after the player). The location tables, actor
// lists, actor scripts and palettes are data.
// Port of src/story/ending_varsity_27.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/cs_credits.mtrec, cs_epilogue.mtrec (the ending), out/port/ss1_end*.mtrec (scripted).
import {
  ACTOR_PLAYER, ACTOR_PLAYER_SHADOW, ACTOR_PARTNER, FACE_DOWN, FACE_LEFT, FACE_RIGHT, FACE_UP, ANIM_NOD,
  ANIM_BOUNCE, ANIM_SHAKE, ANIM_WALK, FLAG_DOUBLES, FLAG_TEMP_SCENE_VARIANT_A, WRAM_SCENE, testFlag, setFlag,
  setObjdef, setAnim, waitIdle, gesture, face, faceToward, facePair, setPosition, moveTarget, moveAngle, waitMove,
  setSpeed, playerSpeed, movePlayer, movePlayerToActor, waitPlayerMove, lockFacing, unlockFacing, nullScript,
  setActorScript, waitActorScript, actorState, wait, fadeIn, sound, respawnActors, beginCutscene, requestExit,
  hook, scene,
} from "./common.js";
import { waitScriptFramesSaveA as delay } from "./actor_27.js";

const BANK = 0x27;
// End10VarsityCourtActorsAlt_27 (singles) and End10VarsityCourtActorsAltB_27 (doubles): the same slots
const ACTOR_END10_VARSITY_COURT_ALT_KEVIN = 0x03, ACTOR_END10_VARSITY_COURT_ALT_BOB = 0x04;
const ACTOR_END10_VARSITY_COURT_ALT_EMILY = 0x08, ACTOR_END10_VARSITY_COURT_ALT_MARK = 0x09;
const ACTOR_END10_VARSITY_COURT_ALT_BALLOON_QUESTION = 0x0C, ACTOR_END10_VARSITY_COURT_ALT_KATE = 0x0D;
const ACTOR_END10_BALLOON_0A = 0x0A;                    // (script_set_position $0a: the doubles list's balloon)
const ACTOR_END8_SR_COURT_ALT_EMILY = 0x03, ACTOR_END8_SR_COURT_ALT_FAY = 0x04;
const ACTOR_END8_SR_COURT_ALT_ALLIE = 0x05;
const OBJ_HARRY = 0x28;
const ACTOR_RECORD_BYTE_18 = 0x18;                      // a byte of the actor record the disassembly leaves unnamed
const SFX_APPEAR2 = 0x96, SFX_EMOTE = 0x98;
const ActorScript_27_07 = 0x5C30, ActorScript_27_08 = 0x5C4D, ActorScript_27_09 = 0x5C6A;
const ActorScript_27_10 = 0x5C8D, ActorScript_27_11 = 0x5C94, ActorScript_27_12 = 0x5CB6;
const End10VarsityCourtActorsAlt_27 = 0x5CCD, End10VarsityCourtActorsAltB_27 = 0x5D71;
const End8SrCourtActorsAlt_27 = 0x5E81;
const KEVIN = ACTOR_END10_VARSITY_COURT_ALT_KEVIN, BOB = ACTOR_END10_VARSITY_COURT_ALT_BOB;
const EMILY = ACTOR_END10_VARSITY_COURT_ALT_EMILY, MARK = ACTOR_END10_VARSITY_COURT_ALT_MARK;
const KATE = ACTOR_END10_VARSITY_COURT_ALT_KATE;

// a byte 18 write: script_get_actor_state actor / ld de, $0018 / add hl, de / ld [hl], v
const setRecordByte18 = (P, actor, v) => P.bus.w8((actorState(P, actor) + ACTOR_RECORD_BYTE_18) & 0xFFFF, v);
// setAnim for several actors, then wait for one to be idle
function* animAll(P, actors, anim, waitFor) {
  for (const actor of actors) setAnim(P, actor, anim);
  yield* waitIdle(P, waitFor);
}

// ---- End10: the varsity court ----
// End10VarsityCourtInitScript_27 (27:561D): entry 1 plays the scene
export function* end10VarsityCourtInitScript(P) {
  if (P.V.storyModeEntryPoint === 0x01) yield* end10VarsityCourtEntry01Scene(P);
}
// SetPartnerObjDefByGender_27 (27:5626): with a male partner (gender 0), Kate's slot ($0D) wears Harry's sprite
// and FLAG_TEMP_SCENE_VARIANT_A is set
export function setPartnerObjDefByGender(P) {
  if (P.V.storyModeGenderOfPartnerCharacter) return;
  setObjdef(P, OBJ_HARRY, KATE);
  setAnim(P, KATE, ANIM_WALK);
  setFlag(P, FLAG_TEMP_SCENE_VARIANT_A);
}
// the party placed out of sight below, the player walking in with the fade
function* end10WalkIn(P) {
  setPosition(P, ACTOR_PLAYER, 11.0, 29.0);
  setPosition(P, ACTOR_PARTNER, 13.0, 35.0);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, ACTOR_PARTNER, FACE_UP);
  yield* movePlayer(P, 11.0, 17.0);
  yield* waitPlayerMove(P);
  fadeIn(P, 4);
  playerSpeed(P, 1.0);
  yield* movePlayer(P, 11.0, 23.0);
  yield* waitPlayerMove(P);
}
// End10VarsityCourtEntry01Scene (27:5643): the singles scene (.notDoubles) or the doubles one; exit 1
export function* end10VarsityCourtEntry01Scene(P) {
  if (testFlag(P, FLAG_DOUBLES)) return yield* end10DoublesScene(P);
  P.wramBank(WRAM_SCENE);                               // (wram_bank WRAM_SCENE, left mapped)
  respawnActors(P, End10VarsityCourtActorsAlt_27);
  nullScript(P, ACTOR_PLAYER_SHADOW);
  playerSpeed(P, 7.5);
  setPartnerObjDefByGender(P);
  yield* end10WalkIn(P);
  moveTarget(P, BOB, 11.0, 23.0);
  yield* waitMove(P, BOB);
  sound(P, SFX_EMOTE);
  setPosition(P, ACTOR_END10_VARSITY_COURT_ALT_BALLOON_QUESTION, 12.25, 27.75);
  yield* wait(P, 40);
  setPosition(P, ACTOR_END10_VARSITY_COURT_ALT_BALLOON_QUESTION, 63.0, 63.0);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  yield* movePlayerToActor(P, KATE);
  setActorScript(P, EMILY, ActorScript_27_07);
  setActorScript(P, MARK, ActorScript_27_11);
  setActorScript(P, KATE, ActorScript_27_10);
  yield* wait(P, 10);
  setActorScript(P, KEVIN, ActorScript_27_09);
  yield* wait(P, 30);
  yield* movePlayerToActor(P, ACTOR_PLAYER);
  yield* waitPlayerMove(P);
  yield* waitActorScript(P, KEVIN);
  faceToward(P, ACTOR_PLAYER, KATE);
  // (.animate with Kate's own sprite; with Harry's both branches are Kate's slot: the same steps)
  yield* gesture(P, KATE, ANIM_BOUNCE);
  faceToward(P, KATE, ACTOR_PLAYER);
  yield* gesture(P, MARK, ANIM_SHAKE);                  // .animate2
  faceToward(P, MARK, ACTOR_PLAYER);
  yield* gesture(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* wait(P, 20);
  moveTarget(P, EMILY, 10.0, 31.0);
  yield* waitMove(P, EMILY);
  yield* wait(P, 20);
  faceToward(P, EMILY, ACTOR_PLAYER);
  faceToward(P, EMILY, KATE);
  yield* wait(P, 20);
  yield* wait(P, 20);
  moveTarget(P, KEVIN, 12.0, 31.0);
  yield* waitMove(P, KEVIN);
  yield* wait(P, 20);
  yield* gesture(P, KEVIN, ANIM_BOUNCE);
  yield* gesture(P, KATE, ANIM_BOUNCE);
  faceToward(P, ACTOR_PLAYER, KATE);
  faceToward(P, KATE, ACTOR_PLAYER);                    // .face
  yield* wait(P, 10);
  faceToward(P, EMILY, ACTOR_PLAYER);
  yield* wait(P, 10);
  requestExit(P, 0x01);
}
// End10VarsityCourtEntry01Scene.scriptRespawnLocationActors (27:582C): the doubles scene: the doubles list (its
// slots: 3, 4, 8, 9, $0A the balloon), the partner's reaction (CeremonyDoublesReaction_27 with a female partner,
// a longer dance with a male one), then the students' farewell
function* end10DoublesScene(P) {
  respawnActors(P, End10VarsityCourtActorsAltB_27);
  beginCutscene(P);
  setPartnerObjDefByGender(P);
  nullScript(P, ACTOR_PARTNER);
  nullScript(P, ACTOR_PLAYER_SHADOW);
  playerSpeed(P, 7.5);
  yield* end10WalkIn(P);
  moveTarget(P, ACTOR_PARTNER, 13.0, 29.0);
  moveTarget(P, MARK, 11.0, 23.0);
  yield* waitMove(P, MARK);
  yield* gesture(P, MARK, ANIM_SHAKE);
  yield* gesture(P, BOB, ANIM_BOUNCE);
  yield* animAll(P, [ACTOR_PARTNER, ACTOR_PLAYER], ANIM_NOD, ACTOR_PLAYER);
  faceToward(P, ACTOR_PLAYER, ACTOR_PARTNER);
  yield* wait(P, 30);
  yield* gesture(P, ACTOR_PARTNER, ANIM_NOD);
  if (!testFlag(P, FLAG_TEMP_SCENE_VARIANT_A)) return yield* ceremonyDoublesReaction(P);
  faceToward(P, ACTOR_PARTNER, ACTOR_PLAYER);
  yield* gesture(P, ACTOR_PARTNER, ANIM_BOUNCE);
  face(P, ACTOR_PLAYER, FACE_LEFT);
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  sound(P, SFX_APPEAR2);
  setPosition(P, ACTOR_END10_BALLOON_0A, 12.0, 27.5);
  yield* wait(P, 40);
  setPosition(P, ACTOR_END10_BALLOON_0A, 63.0, 63.0);
  faceToward(P, ACTOR_PARTNER, ACTOR_PLAYER);
  yield* wait(P, 10);
  yield* playerStepsBack(P);
  setRecordByte18(P, ACTOR_PARTNER, 0x04);
  for (const facing of [null, FACE_UP, null, FACE_DOWN, FACE_UP, null]) {   // the partner's dance
    if (facing !== null) face(P, ACTOR_PARTNER, facing);
    yield* gesture(P, ACTOR_PARTNER, ANIM_BOUNCE);
  }
  yield* partnerNodsBack(P);
  yield* ceremonyDoublesReactionContinue(P);
}
// the player, facing kept, a step right, a bounce, a step back
function* playerStepsBack(P) {
  lockFacing(P, ACTOR_PLAYER);
  yield* wait(P, 10);
  moveAngle(P, ACTOR_PLAYER, FACE_RIGHT, 1.0);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* gesture(P, ACTOR_PLAYER, ANIM_BOUNCE);
  moveAngle(P, ACTOR_PLAYER, FACE_LEFT, 1.0);
  yield* waitMove(P, ACTOR_PLAYER);
}
// the partner's byte 18 back to 1, a nod each
function* partnerNodsBack(P) {
  setRecordByte18(P, ACTOR_PARTNER, 0x01);
  face(P, ACTOR_PARTNER, FACE_LEFT);
  yield* wait(P, 20);
  yield* gesture(P, ACTOR_PARTNER, ANIM_NOD);
  yield* wait(P, 20);
  yield* gesture(P, ACTOR_PLAYER, ANIM_NOD);
}
// CeremonyDoublesReaction_27 (27:5A25): the female partner's reaction: her bounce and balloon, the player's step,
// her shorter dance
export function* ceremonyDoublesReaction(P) {
  yield* gesture(P, ACTOR_PARTNER, ANIM_BOUNCE);
  faceToward(P, ACTOR_PARTNER, ACTOR_PLAYER);
  sound(P, SFX_APPEAR2);
  setPosition(P, ACTOR_END10_BALLOON_0A, 12.0, 27.5);
  yield* wait(P, 40);
  setPosition(P, ACTOR_END10_BALLOON_0A, 63.0, 63.0);
  yield* wait(P, 10);
  yield* playerStepsBack(P);
  setRecordByte18(P, ACTOR_PARTNER, 0x03);
  yield* gesture(P, ACTOR_PARTNER, ANIM_BOUNCE);
  face(P, ACTOR_PARTNER, FACE_DOWN);
  yield* gesture(P, ACTOR_PARTNER, ANIM_BOUNCE);
  yield* wait(P, 40);
  yield* gesture(P, ACTOR_PARTNER, ANIM_BOUNCE);
  yield* partnerNodsBack(P);
  yield* ceremonyDoublesReactionContinue(P);
}
// CeremonyDoublesReaction_27.continue (27:5B0C): the students (doubles slots 8, 3, 9) walk over and react; the
// pair's nods; exit 1
export function* ceremonyDoublesReactionContinue(P) {
  const A = 0x08, B = 0x03, C = 0x09;                   // (script_set_actor_script $08 / $03 / $09)
  yield* wait(P, 20);
  unlockFacing(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  face(P, ACTOR_PARTNER, FACE_RIGHT);
  setActorScript(P, A, ActorScript_27_07);
  setActorScript(P, B, ActorScript_27_08);
  yield* wait(P, 20);
  setActorScript(P, C, ActorScript_27_12);
  yield* movePlayer(P, 11.0, 29.0);
  yield* waitPlayerMove(P);
  yield* waitActorScript(P, C);
  faceToward(P, ACTOR_PLAYER, C);
  faceToward(P, B, ACTOR_PARTNER);
  yield* gesture(P, C, ANIM_SHAKE);
  faceToward(P, C, ACTOR_PLAYER);
  moveTarget(P, A, 10.0, 31.0);
  yield* waitMove(P, A);
  faceToward(P, A, ACTOR_PLAYER);
  faceToward(P, B, ACTOR_PARTNER);
  yield* gesture(P, A, ANIM_NOD);
  moveTarget(P, B, 12.0, 31.0);
  yield* waitMove(P, B);
  yield* gesture(P, B, ANIM_BOUNCE);
  faceToward(P, ACTOR_PLAYER, ACTOR_PARTNER);
  yield* gesture(P, ACTOR_PARTNER, ANIM_NOD);
  faceToward(P, ACTOR_PARTNER, ACTOR_PLAYER);           // .facePartner
  yield* gesture(P, ACTOR_PLAYER, ANIM_NOD);
  yield* wait(P, 10);
  faceToward(P, A, ACTOR_PLAYER);
  faceToward(P, B, ACTOR_PARTNER);
  yield* wait(P, 10);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  setAnim(P, ACTOR_PARTNER, ANIM_NOD);
  requestExit(P, 0x01);
}

// ---- End8: the senior court ----
const FAY = ACTOR_END8_SR_COURT_ALT_FAY, ALLIE = ACTOR_END8_SR_COURT_ALT_ALLIE, SR_EMILY = ACTOR_END8_SR_COURT_ALT_EMILY;
// End8SrCourtInitScript_27 (27:5ED8): doubles (.step) or singles (.notDoubles): Fay's bounce, Emily runs after
// the player and nods; exit 1
export function* end8SrCourtInitScript(P) {
  if (!testFlag(P, FLAG_DOUBLES)) return yield* end8Singles(P);
  respawnActors(P, End8SrCourtActorsAlt_27);
  beginCutscene(P);
  nullScript(P, ACTOR_PARTNER);                         // .step
  setPosition(P, ACTOR_PLAYER, 37.0, 27.0);
  face(P, ACTOR_PLAYER, FACE_UP);
  setPosition(P, ACTOR_PARTNER, 35.0, 27.0);
  face(P, ACTOR_PARTNER, FACE_UP);
  face(P, SR_EMILY, FACE_LEFT);
  P.V.storyModeShowLocationName = 0;
  fadeIn(P, 4);
  moveTarget(P, FAY, 37.0, 19.0);
  yield* waitMove(P, FAY);
  facePair(P, ALLIE, FAY);
  setAnim(P, FAY, ANIM_BOUNCE);
  yield* delay(P, 50);
  face(P, ALLIE, FACE_DOWN);
  yield* gesture(P, ALLIE, ANIM_SHAKE);
  yield* delay(P, 50);
  for (const actor of [FAY, ALLIE, ACTOR_PARTNER, ACTOR_PLAYER]) setAnim(P, actor, ANIM_BOUNCE);
  for (const actor of [ACTOR_PLAYER, ACTOR_PARTNER, FAY]) face(P, actor, FACE_DOWN);
  yield* delay(P, 30);
  playerSpeed(P, 1.5);
  setSpeed(P, SR_EMILY, 0.5);
  yield* movePlayer(P, 43.0, 31.0);
  moveTarget(P, SR_EMILY, 43.0, 32.0);
  yield* delay(P, 90);
  playerSpeed(P, 0.5);
  yield* movePlayer(P, 36.0, 27.0);
  moveTarget(P, SR_EMILY, 37.0, 31.0);
  yield* waitMove(P, SR_EMILY);
  face(P, SR_EMILY, FACE_UP);
  yield* gesture(P, SR_EMILY, ANIM_BOUNCE);
  yield* delay(P, 20);
  facePair(P, ACTOR_PARTNER, ACTOR_PLAYER);
  yield* delay(P, 40);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  face(P, ACTOR_PARTNER, FACE_DOWN);
  yield* animAll(P, [ACTOR_PARTNER, ACTOR_PLAYER], ANIM_NOD, ACTOR_PLAYER);
  yield* gesture(P, SR_EMILY, ANIM_NOD);
  yield* delay(P, 20);
  moveTarget(P, SR_EMILY, 37.0, 29.0);
  yield* waitMove(P, SR_EMILY);
  yield* gesture(P, SR_EMILY, ANIM_BOUNCE);
  yield* wait(P, 30);
  yield* animAll(P, [SR_EMILY, ACTOR_PLAYER], ANIM_NOD, ACTOR_PLAYER);
  requestExit(P, 0x01);
}
// End8SrCourtInitScript_27.notDoubles (27:6075)
function* end8Singles(P) {
  setSpeed(P, FAY, 0.75);
  setPosition(P, ACTOR_PLAYER, 36.0, 27.0);
  face(P, ACTOR_PLAYER, FACE_UP);
  P.V.storyModeShowLocationName = 0;
  fadeIn(P, 4);
  moveTarget(P, FAY, 36.0, 19.0);
  yield* waitMove(P, FAY);
  yield* delay(P, 20);
  yield* delay(P, 40);
  yield* animAll(P, [FAY, ACTOR_PLAYER], ANIM_BOUNCE, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  yield* delay(P, 30);
  playerSpeed(P, 1.5);
  setSpeed(P, SR_EMILY, 0.5);
  yield* movePlayer(P, 43.0, 31.0);
  moveTarget(P, SR_EMILY, 43.0, 31.0);
  yield* delay(P, 90);
  playerSpeed(P, 0.5);
  yield* movePlayer(P, 36.0, 27.0);
  yield* waitMove(P, SR_EMILY);
  for (const y of [31.0, 30.0, 29.0]) {
    moveTarget(P, SR_EMILY, 36.0, y);
    yield* waitMove(P, SR_EMILY);
  }
  yield* delay(P, 30);
  yield* gesture(P, SR_EMILY, ANIM_BOUNCE);
  yield* delay(P, 30);
  yield* gesture(P, ACTOR_PLAYER, ANIM_NOD);
  yield* delay(P, 20);
  yield* gesture(P, SR_EMILY, ANIM_NOD);
  yield* delay(P, 40);
  requestExit(P, 0x01);
}

export const HOOKS = [
  scene(BANK, 0x561D, end10VarsityCourtInitScript),
  [BANK, 0x5626, hook(P => { setPartnerObjDefByGender(P); })],
  scene(BANK, 0x5643, end10VarsityCourtEntry01Scene),
  scene(BANK, 0x5A25, ceremonyDoublesReaction),
  scene(BANK, 0x5B0C, ceremonyDoublesReactionContinue),               // CeremonyDoublesReaction_27.continue
  scene(BANK, 0x5ED8, end8SrCourtInitScript),
];
