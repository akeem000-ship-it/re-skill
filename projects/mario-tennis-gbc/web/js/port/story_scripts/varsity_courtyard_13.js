// The courtyard and the varsity courts (bank $13, $5B8B-$62BD): the roommate's reply texts by the dorm's story stage
// (academy_13's prompts call them), the emote balloon's position by an actor and the roommate placed at the
// player's target (dorm_13's scenes call them), Kevin's question, the varsity courts' students (the practice
// matches' offers, lines by progress), the bracket board, the init script and the courts' actors, NPC scripts and
// behavior cells by progress. The map tables, actor lists and NPC script lists are data.
// Port of src/story/varsity_courtyard_13.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/engine/rec1.mtrec, rec2.mtrec (the courtyard), out/port/ss1_dorm*.mtrec (part 1's dorm scenes: the
// reply texts, the balloon), out/port/ss2_varsity*.mtrec (scripted: the courts at each stage, singles and doubles).
import {
  ACTORF_X, ACTORF_Y, ACTOR_PLAYER, ANIM_WALK, BANK_STORY, BEHAVIOR_ACTION, FACE_RIGHT, FLAG_DOUBLES,
  FLAG_TEMP_SCENE_VARIANT_A, advanceText, askYesNo, face, farcall, hook, nullScript, respawnActors, returnHereAfter,
  scene, setActorScript, setAnim, setNpcScripts, setPosition, setText, speak, testFlag, writeBehaviorCell,
} from "./common.js";
import { getActorStateAddr, scriptSetActorPosition } from "../story/script.js";
import { addHLFlags } from "../story/common.js";
import { getDormRoomStoryStage } from "./academy_13.js";
import { farcallAt } from "./shared2.js";
import { setupStoryMinigameMatch0, setupVarsityCourtDoublesMatch, varsityCourtTourCutscene,
  courtyardEntryWalkIn } from "./varsity_tour_13.js";
import { showStoryTournamentBracket, runTravelingTeamBracketIfWon, runTravelingTeamVictoryCutscene } from "./team_bracket_13.js";

const BANK = 0x13;
const ACTOR_COURTYARD_KEVIN = 0x03, ACTOR_COURTYARD_FAY = 0x05, ACTOR_COURTYARD_CURT = 0x06;
const ACTOR_VARSITY_COURT_A_FAY = 0x05, ACTOR_VARSITY_COURT_B_BOB = 0x04, ACTOR_VARSITY_COURT_B_FAY = 0x05;
const ACTOR_VARSITY_COURT_B_CURT = 0x06, ACTOR_VARSITY_COURT_B_BETH = 0x07, ACTOR_VARSITY_COURT_B_MARK = 0x09;
const ACTOR_VARSITY_COURT_C_BOB = 0x03, ACTOR_VARSITY_COURT_C_FAY = 0x04, ACTOR_VARSITY_COURT_C_STUDENT = 0x05;
const ACTOR_EMOTE_BALLOON = 0x05, ACTOR_ROOMMATE = 0x03;    // the dorm room's slots (dorm_13's scenes)
const ActorScript_13_20 = 0x7A40, ActorScript_13_28 = 0x7B2F, ActorScript_13_30 = 0x7CF5;
const FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_2 = 0x3E, FLAG_WON_SENIOR_DOUBLES_RANK_1 = 0x46;
const FLAG_WON_SENIOR_SINGLES_RANK_1 = 0x57, FLAG_REACHED_ISLAND_OPEN_SINGLES = 0xAE;
const FLAG_REACHED_ISLAND_OPEN_DOUBLES = 0xAF, FLAG_STORY_COMPLETE_SINGLES = 0xB0, FLAG_STORY_COMPLETE_DOUBLES = 0xB1;
const DORM_STAGE_ISLAND_OPEN = 0x01;
const BRACKET_CELL = BEHAVIOR_ACTION | 1 << 4;          // the bracket board's action cells (facing script 1)
const Text_30_527 = 0x020F, Text_30_529 = 0x0211, Text_30_531 = 0x0213, Text_30_539 = 0x021B;
const Text_31_3 = 0x0403, Text_31_7 = 0x0407, Text_31_34 = 0x0422, Text_31_35 = 0x0423, Text_31_36 = 0x0424;
const Text_31_40 = 0x0428, Text_31_45 = 0x042D, Text_31_270 = 0x050E, Text_31_271 = 0x050F, Text_31_272 = 0x0510;
const Text_31_275 = 0x0513, Text_31_276 = 0x0514, Text_31_277 = 0x0515;
// data of this bank (read from the ROM)
const VarsityCourtActorsA_13 = 0x5CE4, VarsityCourtActorsB_13 = 0x5D50, VarsityCourtActorsC_13 = 0x5DCA;
const VarsityCourtActorsD_13 = 0x5DFE, VarsityCourtNpcScriptsA_13 = 0x5F70, VarsityCourtNpcScriptsB_13 = 0x6020;
const VarsityCourtNpcScriptsC_13 = 0x609F, VarsityCourtNpcScriptsD_13 = 0x60EF, VarsityCourtNpcScriptsE_13 = 0x613B;

// ---- the dorm's helpers ----
// SetRoommate*ReplyText_13 (13:5B8B / 5BA7 / 5BC3 / 5BDF): at the Island Open stage, the roommate's reply (a boy
// partner-to-be's, variant A, or a girl's)
function* roommateReply(P, textA, textB) {
  if (getDormRoomStoryStage(P).a !== DORM_STAGE_ISLAND_OPEN) return;
  yield* setText(P, testFlag(P, FLAG_TEMP_SCENE_VARIANT_A) ? textA : textB);
}
export const setRoommateDoublesNoReplyText = P => roommateReply(P, Text_31_275, Text_31_270);
export const setRoommateSinglesNoReplyText = P => roommateReply(P, Text_31_276, Text_31_271);
export const setRoommateSinglesYesReplyText = P => roommateReply(P, Text_31_276, Text_31_271);
export const setRoommateDoublesYesReplyText = P => roommateReply(P, Text_31_277, Text_31_272);
// ComputeEmoteActorPosition_13 (13:5BFB): actor a's position + (1.5, -1.5) tiles into wMapScratch + 6 / + 8 (the
// balloon's place over it). Returns the registers it leaves (bc = the actor's record, de = y, hl past the y).
export function computeEmoteActorPosition(P, actor) {
  const st = farcall(P, BANK_STORY, () => getActorStateAddr(P, actor)), bc = st.hl;
  const x0 = P.bus.u16((bc + ACTORF_X) & 0xFFFF), f1 = addHLFlags(x0, 0x0180, st.f), x = (x0 + 0x0180) & 0xFFFF;
  const at = P.A.mapScratch;
  P.bus.w16((at + 6) & 0xFFFF, x);
  const y0 = P.bus.u16((bc + ACTORF_Y) & 0xFFFF), f = addHLFlags(y0, 0xFE80, f1), y = (y0 + 0xFE80) & 0xFFFF;
  P.bus.w16((at + 8) & 0xFFFF, y);
  return { a: y & 0xFF, f, bc, de: y, hl: (at + 9) & 0xFFFF };
}
// actor a placed at (bc, de) by `farcall ScriptSetActorPosition` at rst (FarCall's frame under it: the point
// buffer the routine keeps on the stack sits where the ROM's does). Returns its registers (de as given).
function placeActorAt(P, rst, actor, x, y, hl) {
  return { de: y, ...farcallAt(P, rst, BANK_STORY, () => scriptSetActorPosition(P, actor, x, y), { a: actor, hl }) };
}
// PlaceEmoteActorAtComputedPosition_13 (13:5C27): the balloon (actor 5) at the point in wMapScratch + 6 / + 8
export function placeEmoteActorAtComputedPosition(P) {
  const at = P.A.mapScratch;
  return placeActorAt(P, 0x5C35, ACTOR_EMOTE_BALLOON, P.bus.u16((at + 6) & 0xFFFF), P.bus.u16((at + 8) & 0xFFFF),
    (at + 9) & 0xFFFF);
}
// PlaceRoommateAtPlayerTarget_13 (13:5C39): the roommate (actor 3) at the player's position (kept in wMapScratch
// + 6 / + 8 too)
export function placeRoommateAtPlayerTarget(P) {
  const bc = farcall(P, BANK_STORY, () => getActorStateAddr(P, ACTOR_PLAYER)).hl, at = P.A.mapScratch;
  const x = P.bus.u16((bc + ACTORF_X) & 0xFFFF), y = P.bus.u16((bc + ACTORF_Y) & 0xFFFF);
  P.bus.w16((at + 6) & 0xFFFF, x);
  P.bus.w16((at + 8) & 0xFFFF, y);
  return placeActorAt(P, 0x5C74, ACTOR_ROOMMATE, x, y, (at + 9) & 0xFFFF);
}

// ---- the courtyard and the courts ----
// CourtyardNpc03_13 (13:5EAA): Kevin's question (another in doubles); a yes, his other answer
export function* courtyardNpc03(P) {
  yield* setText(P, Text_30_527);
  if (testFlag(P, FLAG_DOUBLES)) yield* setText(P, Text_30_529);
  if ((yield* askYesNo(P, ACTOR_COURTYARD_KEVIN)) === 0) yield* setText(P, Text_30_531);
  yield* speak(P, ACTOR_COURTYARD_KEVIN);                 // .speak
}
// Fay's practice match offer (court A singles, B doubles): a yes, the match from here (coming back here); a no,
// her line and her walk back
function* fayOffer(P, fay, text, match) {
  nullScript(P, fay);
  setAnim(P, fay, ANIM_WALK);
  yield* setText(P, text);
  if ((yield* askYesNo(P, fay)) !== 0) {
    yield* speak(P, fay);
    setActorScript(P, fay, ActorScript_13_20);
    return;
  }
  advanceText(P);                                         // .advanceText
  yield* speak(P, fay);
  returnHereAfter(P);
  yield* match(P);
}
// VarsityCourtANpc05_13 (13:5F15) / VarsityCourtBNpc05_13 (13:5FC5)
export const varsityCourtANpc05 = P => fayOffer(P, ACTOR_VARSITY_COURT_A_FAY, Text_30_539, setupStoryMinigameMatch0);
export const varsityCourtBNpc05 = P => fayOffer(P, ACTOR_VARSITY_COURT_B_FAY, Text_31_7, setupVarsityCourtDoublesMatch);
// VarsityCourtBNpc09_13 (13:5FA1): Mark's question (a no: the other answer)
export function* varsityCourtBNpc09(P) {
  yield* setText(P, Text_31_3);
  if ((yield* askYesNo(P, ACTOR_VARSITY_COURT_B_MARK)) !== 0) advanceText(P);
  yield* speak(P, ACTOR_VARSITY_COURT_B_MARK);
}
// a student's line, then the walk back (stopped, walking, ActorScript_13_20 after); stop: the script stopped
function* studentLine(P, stop, actor, text) {
  nullScript(P, stop);
  setAnim(P, actor, ANIM_WALK);
  yield* setText(P, text);
  yield* speak(P, actor);
  setActorScript(P, actor, ActorScript_13_20);
}
// VarsityCourtCNpc03_13 (13:6059) / VarsityCourtCNpc04_13 (13:607C; it stops Bob's script, not Fay's) /
// VarsityCourtDNpc05_13 (13:60CC) / VarsityCourtENpc05_13 (13:6118)
export const varsityCourtCNpc03 = P => studentLine(P, ACTOR_VARSITY_COURT_C_BOB, ACTOR_VARSITY_COURT_C_BOB, Text_31_34);
export const varsityCourtCNpc04 = P => studentLine(P, ACTOR_VARSITY_COURT_C_BOB, ACTOR_VARSITY_COURT_C_FAY, Text_31_35);
export const varsityCourtDNpc05 = P => studentLine(P, ACTOR_COURTYARD_FAY, ACTOR_COURTYARD_FAY, Text_31_40);
export const varsityCourtENpc05 = P => studentLine(P, ACTOR_VARSITY_COURT_B_FAY, ACTOR_VARSITY_COURT_B_FAY, Text_31_45);
// VarsityCourtCNpc05_13 (13:60B8): a line (once the Island Open's second round is won, the next)
export function* varsityCourtCNpc05(P) {
  yield* setText(P, Text_31_36);
  if (testFlag(P, FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_2)) advanceText(P);
  yield* speak(P, ACTOR_VARSITY_COURT_C_STUDENT);
}
// CourtyardFacing01_13 (13:616D): the bracket board: the bracket, then back here
export function* courtyardFacing01(P) {
  yield* showStoryTournamentBracket(P);
  returnHereAfter(P);
}
// CourtyardInitScript_13 (13:6189): the courts by progress; entry $0F the tour, $0D the bracket after a won match,
// $0E the team's victory; else the walk in
export function* courtyardInitScript(P) {
  setupVarsityCourtSceneVariant(P);
  const entry = P.V.storyModeEntryPoint;
  if (entry === 0x0F) return yield* varsityCourtTourCutscene(P);
  if (entry === 0x0D) return yield* runTravelingTeamBracketIfWon(P);
  if (entry === 0x0E) return yield* runTravelingTeamVictoryCutscene(P);
  yield* courtyardEntryWalkIn(P);                         // .walkIn
}
// the bracket board's two action cells, (8, 16) and (6, 16)
function bracketCells(P) {
  writeBehaviorCell(P, 8, 16, BRACKET_CELL);
  writeBehaviorCell(P, 6, 16, BRACKET_CELL);
}
// SetupVarsityCourtSceneVariant (13:61A9): the courts' actors (a list respawned), NPC scripts and the bracket's
// cells by progress. Singles: complete (list D's scripts, Curt at (5, 21)), at the Island Open (C), senior champion
// (A). Doubles: complete (B, scripts E: Mark gone, Curt's and Beth's scripts), at the Island Open (D, scripts C),
// senior champion (B).
export function setupVarsityCourtSceneVariant(P) {
  if (!testFlag(P, FLAG_DOUBLES)) {
    if (testFlag(P, FLAG_STORY_COMPLETE_SINGLES)) {
      setNpcScripts(P, VarsityCourtNpcScriptsD_13);
      bracketCells(P);
      setPosition(P, ACTOR_COURTYARD_CURT, 5.0, 21.0);
      face(P, ACTOR_COURTYARD_CURT, FACE_RIGHT);
    } else if (testFlag(P, FLAG_REACHED_ISLAND_OPEN_SINGLES)) {   // .stage1
      respawnActors(P, VarsityCourtActorsC_13);
      setNpcScripts(P, VarsityCourtNpcScriptsC_13);
      bracketCells(P);
    } else if (testFlag(P, FLAG_WON_SENIOR_SINGLES_RANK_1)) {     // .stage2
      respawnActors(P, VarsityCourtActorsA_13);
      setNpcScripts(P, VarsityCourtNpcScriptsA_13);
    }
    return;
  }
  if (testFlag(P, FLAG_STORY_COMPLETE_DOUBLES)) {         // .stage3
    respawnActors(P, VarsityCourtActorsB_13);
    setNpcScripts(P, VarsityCourtNpcScriptsE_13);
    setPosition(P, ACTOR_VARSITY_COURT_B_MARK, 63.0, 63.0);
    face(P, ACTOR_VARSITY_COURT_B_BOB, FACE_RIGHT);
    setActorScript(P, ACTOR_VARSITY_COURT_B_CURT, ActorScript_13_30);
    bracketCells(P);
    setPosition(P, ACTOR_VARSITY_COURT_B_BETH, 15.0, 23.0);
    setActorScript(P, ACTOR_VARSITY_COURT_B_BETH, ActorScript_13_28);
  } else if (testFlag(P, FLAG_REACHED_ISLAND_OPEN_DOUBLES)) {     // .stage4
    respawnActors(P, VarsityCourtActorsD_13);
    setNpcScripts(P, VarsityCourtNpcScriptsC_13);
    bracketCells(P);
  } else if (testFlag(P, FLAG_WON_SENIOR_DOUBLES_RANK_1)) {       // .stage5
    respawnActors(P, VarsityCourtActorsB_13);
    setNpcScripts(P, VarsityCourtNpcScriptsB_13);
  }
}

export const HOOKS = [
  // (script-macro routines: the registers they leave are read by no caller, and put back as at the call)
  scene(BANK, 0x5B8B, setRoommateDoublesNoReplyText),
  scene(BANK, 0x5BA7, setRoommateSinglesNoReplyText),
  scene(BANK, 0x5BC3, setRoommateSinglesYesReplyText),
  scene(BANK, 0x5BDF, setRoommateDoublesYesReplyText),
  [BANK, 0x5BFB, hook((P, c) => computeEmoteActorPosition(P, c.a))],
  [BANK, 0x5C27, hook(placeEmoteActorAtComputedPosition)],
  [BANK, 0x5C39, hook(placeRoommateAtPlayerTarget)],
  scene(BANK, 0x5EAA, courtyardNpc03),
  scene(BANK, 0x5F15, varsityCourtANpc05),
  scene(BANK, 0x5FA1, varsityCourtBNpc09),
  scene(BANK, 0x5FC5, varsityCourtBNpc05),
  scene(BANK, 0x6059, varsityCourtCNpc03),
  scene(BANK, 0x607C, varsityCourtCNpc04),
  scene(BANK, 0x60B8, varsityCourtCNpc05),
  scene(BANK, 0x60CC, varsityCourtDNpc05),
  scene(BANK, 0x6118, varsityCourtENpc05),
  scene(BANK, 0x616D, courtyardFacing01),
  scene(BANK, 0x6189, courtyardInitScript),
  scene(BANK, 0x61A9, function* (P) { setupVarsityCourtSceneVariant(P); }),
];
