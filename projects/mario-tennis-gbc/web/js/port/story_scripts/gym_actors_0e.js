// The training gym's actors by the story's progress (bank $0E, $4681-$4C37): the second weightlifter from the
// junior title on, the jumping-jacks trio at the Island Open and after. The runners' actor scripts
// (ActorScript_0e_00..02, calls of training_0e.asm's waypoint waits) are data.
// Port of src/story/gym_actors_0e.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss1_gym*.mtrec (scripted: the gym at each tier).
import { FACE_RIGHT, ANIM_WALK, ANIM_BOUNCE, setObjdef, setAnim, setPosition, face, actorState, hook } from "./common.js";

const BANK = 0x0E;
const ACTOR_TRAINING_GYM_WEIGHTLIFTER_A = 0x03, ACTOR_TRAINING_GYM_WEIGHTLIFTER_B = 0x04;
const ACTOR_TRAINING_GYM_JUMPING_JACKS_B_1 = 0x07, ACTOR_TRAINING_GYM_JUMPING_JACKS_A = 0x08;
const ACTOR_TRAINING_GYM_JUMPING_JACKS_B_2 = 0x09;
const OBJ_WALK_71_07 = 0x34;
const STORYTIER_JUNIOR_CHAMP = 0x01, STORYTIER_ISLAND_OPEN = 0x03, STORYTIER_COMPLETE = 0x04;
const ACTOR_RECORD_BYTE_18 = 0x18;                      // a byte of the actor record the disassembly leaves unnamed

// the trio of jumping jacks in their places
function placeJumpingJacks(P) {
  setPosition(P, ACTOR_TRAINING_GYM_JUMPING_JACKS_B_1, 41.0, 7.0);
  setPosition(P, ACTOR_TRAINING_GYM_JUMPING_JACKS_A, 39.0, 5.0);
  setPosition(P, ACTOR_TRAINING_GYM_JUMPING_JACKS_B_2, 37.0, 7.0);
}
// SetupGymActorsForProgress (0E:4681): by the story tier (wMapSceneStage / 2, the ranking progress): the junior
// champion's gym gets the second weightlifter; at the Island Open the trio, the first one's record byte $18 set to 1
// (out of step); when the story is complete the trio, the first one bouncing
export function setupGymActorsForProgress(P) {
  const tier = ((P.V.mapSceneStage << 24) >> 25) & 0xFF;            // (sra a)
  if (tier === STORYTIER_JUNIOR_CHAMP) {
    setObjdef(P, OBJ_WALK_71_07, ACTOR_TRAINING_GYM_WEIGHTLIFTER_B);
    setAnim(P, ACTOR_TRAINING_GYM_WEIGHTLIFTER_A, ANIM_WALK);
    setPosition(P, ACTOR_TRAINING_GYM_WEIGHTLIFTER_B, 39.0, 15.0);
    face(P, ACTOR_TRAINING_GYM_WEIGHTLIFTER_B, FACE_RIGHT);
  } else if (tier === STORYTIER_ISLAND_OPEN) {
    placeJumpingJacks(P);
    P.bus.w8((actorState(P, ACTOR_TRAINING_GYM_JUMPING_JACKS_B_1) + ACTOR_RECORD_BYTE_18) & 0xFFFF, 0x01);
  } else if (tier === STORYTIER_COMPLETE) {
    placeJumpingJacks(P);
    setAnim(P, ACTOR_TRAINING_GYM_JUMPING_JACKS_B_1, ANIM_BOUNCE);
  }
}

export const HOOKS = [
  [BANK, 0x4681, hook(P => { setupGymActorsForProgress(P); })],
];
