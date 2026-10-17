// The junior class courts' practice pairs (bank $11, $7A76-$7E0C): the racket students practising on the left and
// middle courts, stopped at the side for a ranking scene and sent back to their rallies after; the bank's map-script
// stubs and its copies of the story-rank routines. The actor scripts here (ActorScript_11_45..52) are data.
// Port of src/story/court_practice_11.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are; ComputeRankingProgressIndex_11 is
// src/twins/compute_ranking_progress_index.asm (twins.js).
// Recordings: out/engine/rec2.mtrec (MapScriptNop_11), out/port/ss1_jr*.mtrec (scripted: the ranking scenes).
import {
  FACE_UP, FACE_LEFT, FACE_RIGHT, ANIM_WALK, setAnim, wait, face, setPosition, moveTarget, waitMove, nullScript,
  setActorScript, sound, hook, scene,
} from "./common.js";
import { computeRankingProgressIndex, computeStoryRankTier } from "./twins.js";
import { unusedMapScriptClearActiveFlag, unusedMapScriptHideLocationName } from "./actor_0f.js";

const BANK = 0x11;
// the racket students of the two junior courts' lists
const ACTOR_JUNIOR_CLASS_COURT_SINGLES_RACKET_STUDENT_1 = 0x0C, ACTOR_JUNIOR_CLASS_COURT_SINGLES_RACKET_STUDENT_2 = 0x0D;
const ACTOR_JUNIOR_CLASS_COURT_SINGLES_RACKET_STUDENT_3 = 0x0E, ACTOR_JUNIOR_CLASS_COURT_SINGLES_RACKET_STUDENT_4 = 0x0F;
const ACTOR_JUNIOR_CLASS_COURT_DOUBLES_RACKET_STUDENT_1 = 0x0C, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_RACKET_STUDENT_2 = 0x0D;
const ActorScript_11_48 = 0x7BDF, ActorScript_11_49 = 0x7C42, ActorScript_11_50 = 0x7CA9, ActorScript_11_51 = 0x7D10;
const SFX_STORY_CUE = 0xA2;

// a pair stopped (scripts detached), standing at the side of its court facing one way
function park(P, a, b, x, ya, yb, facing, anims) {
  nullScript(P, a);
  nullScript(P, b);
  if (anims) { setAnim(P, a, ANIM_WALK); setAnim(P, b, ANIM_WALK); }
  setPosition(P, a, x, ya);
  setPosition(P, b, x, yb);
  face(P, a, facing);
  face(P, b, facing);
}
// ParkMiddleCourtPracticePair (11:7A76): the middle court's pair (singles students 3, 4) at x 31
export function parkMiddleCourtPracticePair(P) {
  park(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_RACKET_STUDENT_3, ACTOR_JUNIOR_CLASS_COURT_SINGLES_RACKET_STUDENT_4,
    31.0, 11.0, 19.0, FACE_LEFT, true);
}
// ParkLeftCourtPracticePairRightSide (11:7AB3): the left court's pair (singles students 1, 2) at x 15, 20 frames
export function* parkLeftCourtPracticePairRightSide(P) {
  park(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_RACKET_STUDENT_1, ACTOR_JUNIOR_CLASS_COURT_SINGLES_RACKET_STUDENT_2,
    15.0, 11.0, 19.0, FACE_LEFT, true);
  yield* wait(P, 20);
}
// ParkLeftCourtPracticePairLeftSide (11:7AF7): the doubles court's left pair at x 5 facing right, 20 frames
export function* parkLeftCourtPracticePairLeftSide(P) {
  park(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_RACKET_STUDENT_1, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_RACKET_STUDENT_2,
    5.0, 11.0, 19.0, FACE_RIGHT, false);
  yield* wait(P, 20);
}
// a pair back to its rally positions, then on its rally scripts
function* resume(P, a, b, ax, bx, scriptA, scriptB) {
  moveTarget(P, a, ax, 11.0);
  moveTarget(P, b, bx, 23.0);
  yield* waitMove(P, b);
  face(P, b, FACE_UP);
  yield* waitMove(P, a);
  setActorScript(P, a, scriptA);
  setActorScript(P, b, scriptB);
}
// ResumeMiddleCourtPractice (11:7B2D) / ResumeLeftCourtPractice (11:7B6B)
export const resumeMiddleCourtPractice = P => resume(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_RACKET_STUDENT_3,
  ACTOR_JUNIOR_CLASS_COURT_SINGLES_RACKET_STUDENT_4, 24.0, 28.0, ActorScript_11_48, ActorScript_11_49);
export const resumeLeftCourtPractice = P => resume(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_RACKET_STUDENT_1,
  ACTOR_JUNIOR_CLASS_COURT_DOUBLES_RACKET_STUDENT_2, 8.0, 12.0, ActorScript_11_50, ActorScript_11_51);

export const HOOKS = [
  [BANK, 0x7A76, hook(P => { parkMiddleCourtPracticePair(P); })],
  scene(BANK, 0x7AB3, parkLeftCourtPracticePairRightSide),
  scene(BANK, 0x7AF7, parkLeftCourtPracticePairLeftSide),
  scene(BANK, 0x7B2D, resumeMiddleCourtPractice),
  scene(BANK, 0x7B6B, resumeLeftCourtPractice),
  [BANK, 0x7BD1, hook(() => {})],                                     // MapScriptNop_11
  [BANK, 0x7BD2, hook(P => unusedMapScriptClearActiveFlag(P))],       // Unused_11_MapScriptClearActiveFlag
  [BANK, 0x7BD7, hook(P => { sound(P, SFX_STORY_CUE); })],            // Unused_11_MapScriptPlaySoundA2
  [BANK, 0x7BDA, hook(P => unusedMapScriptHideLocationName(P))],      // Unused_11_MapScriptHideLocationName
  [BANK, 0x7D95, hook(P => computeRankingProgressIndex(P))],          // ComputeRankingProgressIndex_11
  [BANK, 0x7DDC, hook(P => computeStoryRankTier(P))],                 // Unused_11_ComputeStoryRankTier
];
