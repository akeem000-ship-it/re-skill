// The ending's shared pieces (bank $27, $760E-$7AC0): the group's departure from the main building (the first
// ending scene), the frame wait that keeps a (script_delay), the bank's map-script stubs and its copies of the
// story-rank routines. The actor scripts here (ActorScript_27_26..33) are data.
// Port of src/story/actor_27.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are; Unused_27_ComputeRankingProgressIndex is
// src/twins/compute_ranking_progress_index.asm (twins.js).
// Recordings: out/port/cs_credits.mtrec (MapScriptNop_27) and out/port/ss1_end*.mtrec (scripted: the ending).
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FACE_DOWN, FACE_UP, ANIM_WALK, ANIM_BOUNCE, ANIM_NOD, BANK_ACTORS, FLAG_DOUBLES,
  testFlag, setAnim, waitIdle, wait, face, facePair, lockFacing, unlockFacing, setPosition, moveTarget, waitMove,
  movePlayer, playerSpeed, nullScript, actorState, fadeIn, waitFadeEnd, sound, requestExit, farcall, hook, hookGen, scene,
} from "./common.js";
import { computeRankingProgressIndex, computeStoryRankTier } from "./twins.js";
import { loadActorObjectDef } from "../story/actor_objdefs.js";
import { unusedMapScriptClearActiveFlag, unusedMapScriptHideLocationName } from "./actor_0f.js";

const BANK = 0x27;
// actors of the main building's ending list (End1MainBldgActors_27, restaurant_27.asm)
const ACTOR_END1_MAIN_BLDG_WALK_75_06_1 = 0x06, ACTOR_END1_MAIN_BLDG_WALK_75_06_2 = 0x08, ACTOR_END1_MAIN_BLDG_WALK_74_08 = 0x09;
const ACTOR_END1_MAIN_BLDG_WALK_74_07 = 0x0A, ACTOR_END1_MAIN_BLDG_WALK_74_06 = 0x0B, ACTOR_END1_MAIN_BLDG_MARK = 0x0C;
const OBJ_ALEX_B = 0x56, OBJ_HARRY_B = 0x58;
const SFX_STORY_CUE = 0xA2;

// WaitScriptFramesSaveA (27:7856): script_delay n: WaitScriptFrames a frames, every register kept
export function* waitScriptFramesSaveA(P, frames) { yield* wait(P, frames); }
const delay = waitScriptFramesSaveA;
// script_set_anim actor, anim / script_wait_idle actor
function* animIdle(P, actor, anim) {
  setAnim(P, actor, anim);
  yield* waitIdle(P, actor);
}
// the court sprite objdef + gender into actor (script_get_actor_state / LoadActorObjectDefIfValid), walking
function setCourtSprite(P, actor, objdef) {
  const bc = actorState(P, actor);
  if (bc >> 8) farcall(P, BANK_ACTORS, () => loadActorObjectDef(P, bc, objdef));
  setAnim(P, actor, ANIM_WALK);
}

// End1MainBldgGroupDepartureCutscene_27 (27:760E): the main building at the ending: the player (and the partner,
// shown by a stand-in) with the team; nods all round, and they walk out together (exit 5).
export function* end1MainBldgGroupDepartureCutscene(P) {
  const { V } = P;
  setPosition(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_1, 63.0, 63.0);
  if (testFlag(P, FLAG_DOUBLES)) {
    nullScript(P, ACTOR_PARTNER);
    setPosition(P, ACTOR_PARTNER, 63.0, 63.0);
    setCourtSprite(P, ACTOR_END1_MAIN_BLDG_WALK_74_07, (V.storyModeGenderOfPartnerCharacter + OBJ_HARRY_B) & 0xFF);
    setPosition(P, ACTOR_END1_MAIN_BLDG_MARK, 26.0, 17.0);
    face(P, ACTOR_END1_MAIN_BLDG_MARK, FACE_DOWN);
  }
  setCourtSprite(P, ACTOR_PLAYER, (V.storyModeGenderOfMainCharacter + OBJ_ALEX_B) & 0xFF);   // .checkStoryModeGenderOfMainCharacter
  setPosition(P, ACTOR_PLAYER, 23.0, 23.0);
  face(P, ACTOR_PLAYER, FACE_UP);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  yield* delay(P, 60);
  if (testFlag(P, FLAG_DOUBLES)) {
    facePair(P, ACTOR_END1_MAIN_BLDG_WALK_74_07, ACTOR_PLAYER);
    yield* delay(P, 30);
    setAnim(P, ACTOR_PLAYER, ANIM_NOD);
    yield* animIdle(P, ACTOR_END1_MAIN_BLDG_WALK_74_07, ANIM_NOD);
    yield* delay(P, 30);
    face(P, ACTOR_END1_MAIN_BLDG_WALK_74_07, FACE_UP);
    yield* delay(P, 30);
    yield* animIdle(P, ACTOR_END1_MAIN_BLDG_MARK, ANIM_BOUNCE);
    yield* delay(P, 50);
    facePair(P, ACTOR_END1_MAIN_BLDG_MARK, ACTOR_END1_MAIN_BLDG_WALK_75_06_2);
    setAnim(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_2, ANIM_NOD);
    yield* animIdle(P, ACTOR_END1_MAIN_BLDG_MARK, ANIM_NOD);
    face(P, ACTOR_END1_MAIN_BLDG_MARK, FACE_DOWN);
    face(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_2, FACE_DOWN);
  } else {                                                            // .face
    facePair(P, ACTOR_END1_MAIN_BLDG_WALK_74_06, ACTOR_PLAYER);
    yield* delay(P, 30);
    setAnim(P, ACTOR_PLAYER, ANIM_NOD);
    yield* animIdle(P, ACTOR_END1_MAIN_BLDG_WALK_74_06, ANIM_NOD);
    yield* delay(P, 10);
    face(P, ACTOR_PLAYER, FACE_UP);
    face(P, ACTOR_END1_MAIN_BLDG_WALK_74_06, FACE_UP);
    yield* delay(P, 20);
    yield* animIdle(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_2, ANIM_NOD);
  }
  yield* delay(P, 40);                                                // .step
  setAnim(P, ACTOR_END1_MAIN_BLDG_WALK_74_08, ANIM_NOD);
  setAnim(P, ACTOR_END1_MAIN_BLDG_WALK_74_07, ANIM_NOD);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* animIdle(P, ACTOR_END1_MAIN_BLDG_WALK_74_06, ANIM_NOD);
  yield* delay(P, 20);
  facePair(P, ACTOR_END1_MAIN_BLDG_WALK_74_06, ACTOR_PLAYER);
  facePair(P, ACTOR_END1_MAIN_BLDG_WALK_74_08, ACTOR_END1_MAIN_BLDG_WALK_74_07);
  yield* delay(P, 10);
  // they step apart facing each other, then walk out
  const group = [ACTOR_PLAYER, ACTOR_END1_MAIN_BLDG_WALK_74_06, ACTOR_END1_MAIN_BLDG_WALK_74_07, ACTOR_END1_MAIN_BLDG_WALK_74_08];
  for (const actor of group) lockFacing(P, actor);
  moveTarget(P, ACTOR_PLAYER, 22.0, 23.0);
  moveTarget(P, ACTOR_END1_MAIN_BLDG_WALK_74_06, 26.0, 23.0);
  moveTarget(P, ACTOR_END1_MAIN_BLDG_WALK_74_07, 21.0, 21.0);
  moveTarget(P, ACTOR_END1_MAIN_BLDG_WALK_74_08, 27.0, 21.0);
  yield* waitMove(P, ACTOR_END1_MAIN_BLDG_WALK_74_08);
  playerSpeed(P, 1.0);
  yield* movePlayer(P, 24.0, 47.0);
  moveTarget(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_2, 24.0, 25.0);
  yield* waitMove(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_2);
  for (const actor of group) unlockFacing(P, actor);
  moveTarget(P, ACTOR_PLAYER, 22.0, 31.0);
  moveTarget(P, ACTOR_END1_MAIN_BLDG_WALK_74_06, 26.0, 31.0);
  moveTarget(P, ACTOR_END1_MAIN_BLDG_WALK_74_07, 21.0, 29.0);
  moveTarget(P, ACTOR_END1_MAIN_BLDG_WALK_74_08, 27.0, 29.0);
  moveTarget(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_2, 24.0, 33.0);
  yield* waitMove(P, ACTOR_END1_MAIN_BLDG_WALK_75_06_2);
  requestExit(P, 0x05);
}

export const HOOKS = [
  scene(BANK, 0x760E, end1MainBldgGroupDepartureCutscene),
  [BANK, 0x7856, hookGen((P, c) => waitScriptFramesSaveA(P, c.a))],
  [BANK, 0x7885, hook(() => {})],                                     // MapScriptNop_27
  [BANK, 0x7886, hook(P => unusedMapScriptClearActiveFlag(P))],       // Unused_27_MapScriptClearActiveFlag
  [BANK, 0x788B, hook(P => { sound(P, SFX_STORY_CUE); })],            // Unused_27_MapScriptPlaySoundA2
  [BANK, 0x788E, hook(P => unusedMapScriptHideLocationName(P))],      // Unused_27_MapScriptHideLocationName
  [BANK, 0x7A49, hook(P => computeRankingProgressIndex(P))],          // Unused_27_ComputeRankingProgressIndex
  [BANK, 0x7A90, hook(P => computeStoryRankTier(P))],                 // Unused_27_SetStoryRankTier
];
