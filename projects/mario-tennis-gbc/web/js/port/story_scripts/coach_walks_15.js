// The training court's coach walks (bank $15, $7B96-$7FFF): the return coach leading the party to his court and
// starting the lesson's drill, the party stepping to the serve, net and return coaches' spots; the bank's map-script
// stubs and its copies of the story-rank routines. The actor scripts here (ActorScript_15_16..25) are data.
// Port of src/story/coach_walks_15.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are; Unused_15_ComputeRankingProgressIndex and
// ComputeStoryRankTier_15 are src/twins/compute_ranking_progress_index_13.asm and compute_story_rank_tier.asm
// (twins.js).
// Recordings: out/port/ss1_coach*.mtrec (scripted: the training court's lessons).
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FACE_LEFT, FACE_RIGHT, FLAG_DOUBLES, testFlag, rd, nullScript, playerSpeed,
  setActorScript, movePlayer, waitActorScript, waitPlayerMove, wait, setSpeed, moveTarget, waitMove, face,
  goToLocation, sound, hook, scene,
} from "./common.js";
import { computeRankingProgressIndex, computeStoryRankTier } from "./twins.js";
import { unusedMapScriptClearActiveFlag, unusedMapScriptHideLocationName } from "./actor_0f.js";

const BANK = 0x15;
export const BANK_DRILLS = 0x0B, RunTrainingDrillByID = 0x4705;
export const PlayerPartnerGestureCutscene = 0x6647;     // serve_coach_15.asm (not ported here)
const ACTOR_TRAINING_COURT_BOB_2 = 0x0D;
const ActorScript_15_19 = 0x7C2F, ActorScript_15_20 = 0x7C4C, ActorScript_15_21 = 0x7C57;
export const STORYLOC_TRAINING_COURT = 0x0F;
const SFX_STORY_CUE = 0xA2;

// farcall RunTrainingDrillByID (0B:4705) with a = drill: the drill or minigame (the minigames' part)
export function* runTrainingDrill(P, drill) { yield* P.runRom(BANK_DRILLS, RunTrainingDrillByID, { a: drill }); }
// call PlayerPartnerGestureCutscene (15:6647)
export function* playerPartnerGesture(P) { yield* P.runRom(BANK, PlayerPartnerGestureCutscene); }

// ReturnCoachWalkToCourtAndStartLesson (15:7BC9): Bob, the player and the partner on their walk scripts to the
// return court (the player to (24, 39)); the gesture cutscene; back to the training court at entry $0A after the
// lesson's drill (wCurrentMinigameStoryMatch + 1)
export function* returnCoachWalkToCourtAndStartLesson(P) {
  nullScript(P, ACTOR_PARTNER);
  playerSpeed(P, 1.0);
  setActorScript(P, ACTOR_TRAINING_COURT_BOB_2, ActorScript_15_19);
  setActorScript(P, ACTOR_PLAYER, ActorScript_15_20);
  setActorScript(P, ACTOR_PARTNER, ActorScript_15_21);
  yield* movePlayer(P, 24.0, 39.0);
  yield* waitActorScript(P, ACTOR_PLAYER);
  yield* waitPlayerMove(P);
  yield* waitActorScript(P, ACTOR_TRAINING_COURT_BOB_2);
  yield* wait(P, 5);
  yield* playerPartnerGesture(P);
  goToLocation(P, STORYLOC_TRAINING_COURT, 0x0A);
  yield* runTrainingDrill(P, rd(P, "currentMinigameStoryMatch", 1));
}

// the party at a coach's spot at half speed: the player to (px, py), in doubles the partner (its follow script
// detached) to (qx, qy); both facing one way, back to full speed
function* movePartyTo(P, px, py, qx, qy, facing) {
  setSpeed(P, ACTOR_PLAYER, 0.5);
  setSpeed(P, ACTOR_PARTNER, 0.5);
  moveTarget(P, ACTOR_PLAYER, px, py);
  if (testFlag(P, FLAG_DOUBLES)) {
    nullScript(P, ACTOR_PARTNER);
    moveTarget(P, ACTOR_PARTNER, qx, qy);
    yield* waitMove(P, ACTOR_PARTNER);
  }
  yield* waitMove(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, facing);
  face(P, ACTOR_PARTNER, facing);
  setSpeed(P, ACTOR_PLAYER, 1.0);
  setSpeed(P, ACTOR_PARTNER, 1.0);
}
// MovePartyToServeCoachSpot (15:7C62) / MovePartyToNetCoachSpot (15:7CBB) / MovePartyToReturnCoachSpot (15:7D14)
export const movePartyToServeCoachSpot = P => movePartyTo(P, 19.0, 19.0, 19.0, 17.0, FACE_RIGHT);
export const movePartyToNetCoachSpot = P => movePartyTo(P, 45.0, 43.0, 47.0, 43.0, FACE_LEFT);
export const movePartyToReturnCoachSpot = P => movePartyTo(P, 19.0, 43.0, 17.0, 43.0, FACE_RIGHT);

export const HOOKS = [
  scene(BANK, 0x7BC9, returnCoachWalkToCourtAndStartLesson),
  scene(BANK, 0x7C62, movePartyToServeCoachSpot),
  scene(BANK, 0x7CBB, movePartyToNetCoachSpot),
  scene(BANK, 0x7D14, movePartyToReturnCoachSpot),
  [BANK, 0x7D95, hook(() => {})],                                     // MapScriptNop_15
  [BANK, 0x7D96, hook(P => unusedMapScriptClearActiveFlag(P))],       // Unused_15_MapScriptClearActiveFlag
  [BANK, 0x7D9B, hook(P => { sound(P, SFX_STORY_CUE); })],            // Unused_15_MapScriptPlaySoundA2
  [BANK, 0x7D9E, hook(P => unusedMapScriptHideLocationName(P))],      // Unused_15_MapScriptHideLocationName
  [BANK, 0x7F59, hook(P => computeRankingProgressIndex(P))],          // Unused_15_ComputeRankingProgressIndex
  [BANK, 0x7FA0, hook(P => computeStoryRankTier(P))],                 // ComputeStoryRankTier_15
];
