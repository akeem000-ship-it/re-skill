// Routines the story banks carry in several identical copies (src/twins/ of the gerbiljames/mario-tennis-gbc-disasm,
// MIT: one body assembled into each bank under that bank's name). One JavaScript body each; every bank's module
// hooks its own copy at its own address with these.
// Covered with the modules that hook them (see each module's header for its recordings).
import {
  ACTOR_PLAYER, ACTOR_PARTNER, ANIM_WALK, FACE_RIGHT, FACE_DOWN, FACE_LEFT, FACE_UP, FLAG_DOUBLES, STORYENTRY_NONE,
  BANK_ACTORS, WRAM_COURT_PLANES, testFlag, testFlagF, setSpeed, moveAngle, waitMove, face, setAnim, actorState,
  farcall,
} from "./common.js";
import { loadActorObjectDef } from "../story/actor_objdefs.js";

const FLAG_WON_JUNIOR_SINGLES_RANK_1 = 0x53, FLAG_WON_SENIOR_SINGLES_RANK_1 = 0x57;
const FLAG_WON_JUNIOR_DOUBLES_RANK_1 = 0x42, FLAG_WON_SENIOR_DOUBLES_RANK_1 = 0x46;
const FLAG_REACHED_ISLAND_OPEN_SINGLES = 0xAE, FLAG_REACHED_ISLAND_OPEN_DOUBLES = 0xAF;
const FLAG_STORY_COMPLETE_SINGLES = 0xB0, FLAG_STORY_COMPLETE_DOUBLES = 0xB1;
const OBJ_ALEX_B = 0x56, OBJ_HARRY_B = 0x58;
const PARTNER_CATCH_UP_SPEED = 7.96875, WALK_SPEED = 0.5;

// academy_main_bldg_arrival01 / academy_main_bldg_arrival02 / restaurant_plaza_arrival06: the arrival walk of an
// entry point (none with no entry point): in doubles the partner steps 2 tiles out of the door at full speed and
// turns back; then the player walks 2 tiles in at walking speed (not waited for).
function* arrivalWalk(P, partnerAngle, partnerFacing, playerAngle) {
  if (P.V.storyModeEntryPoint === STORYENTRY_NONE) return;
  if (testFlag(P, FLAG_DOUBLES)) {
    setSpeed(P, ACTOR_PARTNER, PARTNER_CATCH_UP_SPEED);
    moveAngle(P, ACTOR_PARTNER, partnerAngle, 2.0);
    yield* waitMove(P, ACTOR_PARTNER);
    face(P, ACTOR_PARTNER, partnerFacing);
    setSpeed(P, ACTOR_PARTNER, WALK_SPEED);
  }
  setSpeed(P, ACTOR_PLAYER, WALK_SPEED);                              // .walkOff
  moveAngle(P, ACTOR_PLAYER, playerAngle, 2.0);
}
// (src/twins/academy_main_bldg_arrival01.asm): the player walks up
export const arrivalWalkUp = P => arrivalWalk(P, FACE_DOWN, FACE_UP, FACE_UP);
// (src/twins/academy_main_bldg_arrival02.asm): the player walks down
export const arrivalWalkDown = P => arrivalWalk(P, FACE_UP, FACE_DOWN, FACE_DOWN);
// (src/twins/restaurant_plaza_arrival06.asm): the player walks left
export const arrivalWalkLeft = P => arrivalWalk(P, FACE_RIGHT, FACE_LEFT, FACE_LEFT);

// compute_ranking_progress_index (_13): the story rank (STORYRANK_*: twice the tier, + 1 in doubles) into
// wMapSceneStage: academy, junior champion, senior champion, at the Island Open, complete. Returns a = the rank and
// F of the last flag test.
export function computeRankingProgressIndex(P) {
  const doubles = testFlag(P, FLAG_DOUBLES);
  const steps = doubles
    ? [FLAG_WON_JUNIOR_DOUBLES_RANK_1, FLAG_WON_SENIOR_DOUBLES_RANK_1, FLAG_REACHED_ISLAND_OPEN_DOUBLES, FLAG_STORY_COMPLETE_DOUBLES]
    : [FLAG_WON_JUNIOR_SINGLES_RANK_1, FLAG_WON_SENIOR_SINGLES_RANK_1, FLAG_REACHED_ISLAND_OPEN_SINGLES, FLAG_STORY_COMPLETE_SINGLES];
  let rank = doubles ? 1 : 0, set = true;
  for (const flag of steps) {
    if (!(set = testFlag(P, flag))) break;
    rank += 2;
  }
  P.V.mapSceneStage = rank;
  return { a: rank, f: testFlagF(set) };
}
// compute_story_rank_tier: the story tier (STORYTIER_*: 0 academy .. 4 complete) into wMapSceneStage; the junior
// and senior singles titles count in doubles too. Returns a and F: the last flag test's, or of the `inc a` after
// it when that flag was set.
export function computeStoryRankTier(P) {
  let tier = 0, set;
  const step = flag => { set = testFlag(P, flag); if (set) tier++; return set; };
  if (step(FLAG_WON_JUNIOR_SINGLES_RANK_1) && step(FLAG_WON_SENIOR_SINGLES_RANK_1)) {
    if (!testFlag(P, FLAG_DOUBLES)) { if (step(FLAG_REACHED_ISLAND_OPEN_SINGLES)) step(FLAG_STORY_COMPLETE_SINGLES); }
    else if (step(FLAG_REACHED_ISLAND_OPEN_DOUBLES)) step(FLAG_STORY_COMPLETE_DOUBLES);
  }
  P.V.mapSceneStage = tier;
  return { a: tier, f: set ? 0 : testFlagF(false) };
}

// load_court_player_partner_obj_defs: the court sprites of the player (OBJ_ALEX_B + gender) and in doubles the
// partner (OBJ_HARRY_B + gender), back on their walk animation
export function loadCourtPlayerPartnerObjDefs(P) {
  const { V } = P;
  if (testFlag(P, FLAG_DOUBLES)) loadObjdef(P, ACTOR_PARTNER, (V.storyModeGenderOfPartnerCharacter + OBJ_HARRY_B) & 0xFF);
  loadObjdef(P, ACTOR_PLAYER, (V.storyModeGenderOfMainCharacter + OBJ_ALEX_B) & 0xFF);
}
// script_get_actor_state actor / ld c, l / ld b, h / farcall LoadActorObjectDefIfValid / script_set_anim actor, ANIM_WALK
function loadObjdef(P, actor, objdef) {
  const bc = actorState(P, actor);
  if (bc >> 8) farcall(P, BANK_ACTORS, () => loadActorObjectDef(P, bc, objdef));
  setAnim(P, actor, ANIM_WALK);
}

// read_scene_tilemap_tile: the byte at bc + row * 64 + col (e, d) in WRAM 2 (the scene tilemap is 64 wide), which
// stays mapped. Returns a, de = the offset and hl = the address (bc kept).
export function readSceneTilemapTile(P, bc, col, row) {
  P.wramBank(WRAM_COURT_PLANES);
  const rowOff = (row << 6) & 0xFFFF, l = (rowOff & 0xFF) + col;
  const de = ((rowOff >> 8) + (l > 0xFF ? 1 : 0)) << 8 | (l & 0xFF);
  const hl = (bc + de) & 0xFFFF;
  return { a: P.bus.u8(hl), de, hl };
}
