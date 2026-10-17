// Bank $10's shared walks and story-stage helpers ($7AC8-$7E34): the scene tilemap read (this bank's copy), the
// exit and arrival walks by entry point, the doubles progress stage, the dialogue stage by the story's progress
// (wMapSceneStage), unused map-script stubs and the bank's unused copy of the story-rank tier. The actor scripts
// (ActorScript_10_1..4) are data.
// Port of src/story/walks_10.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/engine/rec1.mtrec, rec2.mtrec (bank $10's locations: the academy and its wing); tests:
// web/tests/port/routines_story_scripts2.mjs.
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FACE_UP, FACE_DOWN, FACE_LEFT, FACE_RIGHT, FLAG_DOUBLES, STORYENTRY_NONE, FZ, FH, FC,
  WRAM_COURT_PLANES, testFlag, testFlagF, setSpeed, moveAngle, waitMove, hook, scene,
} from "./common.js";
import { computeStoryRankTier } from "./twins.js";
import { mapScriptStubs } from "./shared2.js";

const BANK = 0x10;
const FLAG_WON_JUNIOR_DOUBLES_RANK_1 = 0x42, FLAG_WON_SENIOR_DOUBLES_RANK_1 = 0x46, FLAG_WON_VARSITY_DOUBLES_RANK_2 = 0x48;
const FLAG_WON_JUNIOR_SINGLES_RANK_1 = 0x53, FLAG_WON_SENIOR_SINGLES_RANK_1 = 0x57;
const FLAG_REACHED_ISLAND_OPEN_SINGLES = 0xAE, FLAG_REACHED_ISLAND_OPEN_DOUBLES = 0xAF;
const FLAG_STORY_COMPLETE_SINGLES = 0xB0, FLAG_STORY_COMPLETE_DOUBLES = 0xB1;
// the dialogue stages (STORYRANK_*: twice the tier, + 1 in doubles)
const STORYRANK_SINGLES_ACADEMY = 0x00, STORYRANK_DOUBLES_ACADEMY = 0x01;
const WALK_SPEED = 0.5;
// the headings of the curving walks' middle legs (between FACE_UP and the side)
const HEADING_UP_RIGHT = 0xE0, HEADING_UP_LEFT = 0xA0;

// ReadSceneTilemapTile_10 (10:7AC8, src/twins/read_scene_tilemap_tile.asm): the scene tilemap's byte at bc + row e
// * 64 + column d (WRAM 2, left mapped). Returns a, de = the offset, hl = its address and the flags of `add hl, de`.
export function readSceneTilemapTile(P, bc, row, col) {
  P.wramBank(WRAM_COURT_PLANES);
  const rowOff = (row << 6) & 0xFFFF, l = (rowOff & 0xFF) + col;
  const carry = l > 0xFF, h = ((rowOff >> 8) + (carry ? 1 : 0)) & 0xFF, de = h << 8 | (l & 0xFF);
  const zero = carry ? h === 0 : (l & 0xFF) === 0;                 // (the Z of `add l`, or of the `inc h` after it)
  const hl = (bc + de) & 0xFFFF;
  const f = (zero ? FZ : 0) | ((bc & 0xFFF) + (de & 0xFFF) > 0xFFF ? FH : 0) | (bc + de > 0xFFFF ? FC : 0);
  return { a: P.bus.u8(hl), de, hl, f };
}
// MapExitWalkCurveRight_10 (10:7AE6): the player (and partner, both at walking speed) walks up a tile, up-right
// half a tile, then right (not waited for)
export function* mapExitWalkCurveRight(P) {
  setSpeed(P, ACTOR_PLAYER, WALK_SPEED);
  setSpeed(P, ACTOR_PARTNER, WALK_SPEED);
  moveAngle(P, ACTOR_PLAYER, FACE_UP, 1.0);
  yield* waitMove(P, ACTOR_PLAYER);
  moveAngle(P, ACTOR_PLAYER, HEADING_UP_RIGHT, 0.5);
  yield* waitMove(P, ACTOR_PLAYER);
  moveAngle(P, ACTOR_PLAYER, FACE_RIGHT, 0.75);
}
// MapExitWalkCurveLeft_10 (10:7B1F): with an entry point, the walk curving up and left
export function* mapExitWalkCurveLeft(P) {
  if (P.V.storyModeEntryPoint === STORYENTRY_NONE) return;
  setSpeed(P, ACTOR_PARTNER, WALK_SPEED);
  setSpeed(P, ACTOR_PLAYER, WALK_SPEED);
  moveAngle(P, ACTOR_PLAYER, FACE_UP, 0.75);
  yield* waitMove(P, ACTOR_PLAYER);
  moveAngle(P, ACTOR_PLAYER, HEADING_UP_LEFT, 0.5);
  yield* waitMove(P, ACTOR_PLAYER);
  moveAngle(P, ACTOR_PLAYER, FACE_LEFT, 0.5);
}
// MapArrivalWalkPair_10 (10:7B5F): with an entry point, the player walks 2.5 tiles down and the partner 2 (not waited
// for)
export function* mapArrivalWalkPair(P) {
  if (P.V.storyModeEntryPoint === STORYENTRY_NONE) return;
  setSpeed(P, ACTOR_PLAYER, WALK_SPEED);
  setSpeed(P, ACTOR_PARTNER, WALK_SPEED);
  moveAngle(P, ACTOR_PLAYER, FACE_DOWN, 2.5);
  moveAngle(P, ACTOR_PARTNER, FACE_DOWN, 2.0);
}
// GetDoublesProgressStage_10 (10:7BB6): a = the doubles titles in order (junior, senior, varsity rank 2, the story
// complete) won so far, 0-4. F: the last flag test's, or of the `inc a` after it when that flag was set.
export function getDoublesProgressStage(P) {
  let a = 0;
  for (const flag of [FLAG_WON_JUNIOR_DOUBLES_RANK_1, FLAG_WON_SENIOR_DOUBLES_RANK_1, FLAG_WON_VARSITY_DOUBLES_RANK_2,
    FLAG_STORY_COMPLETE_DOUBLES]) {
    if (!testFlag(P, flag)) return { a, f: testFlagF(false) };
    a++;
  }
  return { a, f: 0 };                                              // (`inc a` to 4: the carry of the `and` clear)
}
// SetStoryDialogueStage_10 (10:7DBD): wMapSceneStage = the story rank (STORYRANK_*): singles academy 0, junior
// champion 2, senior 4, at the Island Open 6, complete 8; doubles one more. Returns a and the last flag test's F.
export function setStoryDialogueStage(P) {
  const doubles = testFlag(P, FLAG_DOUBLES);
  const steps = doubles
    ? [FLAG_WON_JUNIOR_DOUBLES_RANK_1, FLAG_WON_SENIOR_DOUBLES_RANK_1, FLAG_REACHED_ISLAND_OPEN_DOUBLES, FLAG_STORY_COMPLETE_DOUBLES]
    : [FLAG_WON_JUNIOR_SINGLES_RANK_1, FLAG_WON_SENIOR_SINGLES_RANK_1, FLAG_REACHED_ISLAND_OPEN_SINGLES, FLAG_STORY_COMPLETE_SINGLES];
  let a = doubles ? STORYRANK_DOUBLES_ACADEMY : STORYRANK_SINGLES_ACADEMY, set = true;
  for (const flag of steps) {
    if (!(set = testFlag(P, flag))) break;
    a += 2;
  }
  P.V.mapSceneStage = a;
  return { a, f: testFlagF(set) };
}

export const HOOKS = [
  [BANK, 0x7AC8, hook((P, c) => readSceneTilemapTile(P, c.bc, c.e, c.d))],
  scene(BANK, 0x7AE6, mapExitWalkCurveRight),
  scene(BANK, 0x7B1F, mapExitWalkCurveLeft),
  scene(BANK, 0x7B5F, mapArrivalWalkPair),
  [BANK, 0x7BB6, hook(P => getDoublesProgressStage(P))],
  ...mapScriptStubs(BANK, 0x7BF9, 0x7BFA, 0x7BFF, 0x7C02),
  [BANK, 0x7DBD, hook(P => setStoryDialogueStage(P))],
  [BANK, 0x7E04, hook(P => computeStoryRankTier(P))],               // Unused_10_ComputeStoryRankTier
];
