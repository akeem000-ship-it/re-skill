// The Island Open's rounds (bank $0F, $6F18-$78F5): the officials' lines, the round's call (the officials call the
// player to the court, the opponents walk on, the ranking board, the match), the round's board parameters, the
// round's name, the victory's way out to the Island Sky, the match returns (singles and doubles: the friends'
// congratulations and the break before the next round) and the round lists' NPCs.
// The tables (the rounds' actor and NPC record lists, their text-id tables, ActorScript_0f_03..06) are data.
// Port of src/story/island_rounds_0f.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are; the two Npc04 handlers are
// src/twins/island_open_round_doubles_npc04.asm.
// Recordings: out/port/ss1_island*.mtrec (scripted: the rounds, the match returns).
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FACE_DOWN, FACE_UP, FACE_LEFT, FACE_RIGHT, ANIM_BOUNCE, ANIM_NOD, WRAM_ACTORS,
  MATCHLIST_SINGLES, MATCHLIST_DOUBLES, FLAG_DOUBLES, testFlag, testFlagF, setFlag, clearFlag, setText, advanceText,
  speak, question, askYesNo, setAnim, waitIdle, wait, face, faceToward, facePair, setPosition, moveTarget, waitMove,
  moveAngle, movePlayer, waitPlayerMove, setSpeed, jumpVelocity, waitJump, nullScript, setActorScript, actorState,
  followPlayer, beginCutscene, respawnActors, setNpcScripts, fadeIn, waitFadeEnd, fadeOutAndWait, clearFrameTasks,
  sound, goToLocation, initMatchSettings, loadMatchSettings, runMatch, restoreAfterMatch, farcallGen, hook, scene,
} from "./common.js";
import { incFlags, decFlags, cpFlags } from "../story/common.js";
import { queueShortText, islandOpenBreakCutscene, setPlayerAndPartnerObjectDefs } from "./actor_0f.js";
import { loadIslandOpenRoundNpcs, computeIslandOpenRound } from "./island_open_0f.js";
import { showRankingBoard } from "../menus/ranking/board.js";

const BANK = 0x0F;
// the round lists' actors
const ACTOR_ISLAND_OPEN_FINAL_DOUBLES_WALK_6F_07_1 = 0x03, ACTOR_ISLAND_OPEN_FINAL_DOUBLES_WALK_6F_07_2 = 0x04;
const ACTOR_ISLAND_OPEN_FINAL_DOUBLES_WALK_6F_07_3 = 0x05, ACTOR_ISLAND_OPEN_ROUND1_DOUBLES_WALK_6F_07_2 = 0x04;
const ACTOR_ISLAND_OPEN_ROUND_SINGLES_WALK_74_08 = 0x03, ACTOR_ISLAND_OPEN_ROUND_SINGLES_WALK_74_06 = 0x04;
const ACTOR_ISLAND_OPEN_ROUND_SINGLES_WALK_74_07 = 0x05, ACTOR_ISLAND_OPEN_ROUND_SINGLES_BALLOON_EXCLAIM = 0x08;
const ACTOR_ISLAND_OPEN_ROUND_DOUBLES_WALK_74_08 = 0x03, ACTOR_ISLAND_OPEN_ROUND_DOUBLES_WALK_74_06 = 0x04;
const ACTOR_ISLAND_OPEN_ROUND_DOUBLES_BALLOON_EXCLAIM = 0x08;
// the slots of the opponents across the rounds' lists (include/actor_roles.inc)
const ACTOR_ROLE_ISLAND_OPEN_OPPONENT = 0x0A, ACTOR_ROLE_ISLAND_OPEN_OPPONENT_PARTNER = 0x0B;
const ACTOR_ROLE_ISLAND_OPEN_ROUND_B_COZ = 0x04;
const ACTOR_SLOT_0B = 0x0B, ACTOR_SLOT_0C = 0x0C, ACTOR_SLOT_0D = 0x0D;
const ACTORF_OAM_ATTR = 0x37, OAM_XFLIP = 0x20;
const SFX_CHIME = 0x97;
const STORYLOC_TOURNAMENT = 0x19, STORYLOC_ISLAND_SKY = 0x1B;
const ISLANDOPENROUND_FINAL = 0x03;
const STORYMATCH_ISLAND_OPEN_ROUND_1 = 0x10, STORYMATCH_ISLAND_OPEN_ROUND_2 = 0x11;
const STORYMATCH_ISLAND_OPEN_SEMIFINAL = 0x12, STORYMATCH_ISLAND_OPEN_FINAL = 0x13;
const WINLOSE_WIN = 0x01, MATCH_EXIT_REQUESTED = 0x01;
const FLAG_WON_ISLAND_OPEN_DOUBLES_FINAL = 0x35, FLAG_WON_ISLAND_OPEN_DOUBLES_SEMIFINAL = 0x36;
const FLAG_WON_ISLAND_OPEN_DOUBLES_ROUND_1 = 0x37, FLAG_WON_ISLAND_OPEN_SINGLES_FINAL = 0x3C;
const FLAG_WON_ISLAND_OPEN_SINGLES_SEMIFINAL = 0x3D, FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_2 = 0x3E;
const FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_1 = 0x3F, FLAG_TOURNAMENT_NPC05_TALKED_SINGLES = 0x76;
const FLAG_TOURNAMENT_NPC05_TALKED_DOUBLES = 0x77, FLAG_COURT2_SPECTATORS_TALKED_SINGLES = 0x78;
const FLAG_COURT2_SPECTATORS_TALKED_DOUBLES = 0x79, FLAG_ISLAND_OPEN_IN_PROGRESS = 0xB9;
const Text_1f_163 = 0x24A3, Text_1f_172 = 0x24AC, Text_1f_174 = 0x24AE, Text_1f_178 = 0x24B2;
const Text_25_73 = 0x2849, Text_25_94 = 0x285E, Text_25_97 = 0x2861, Text_25_98 = 0x2862;
// data of this bank (read from the ROM)
const ActorScript_0f_03 = 0x73BE, ActorScript_0f_04 = 0x73D1, ActorScript_0f_05 = 0x73E4, ActorScript_0f_06 = 0x73FD;
const IslandOpenRoundActorsSingles_0f = 0x75B7, IslandOpenRoundNpcScriptsSingles_0f = 0x7615;
const IslandOpenRoundSinglesNpc05_0fTable = 0x7691, IslandOpenSinglesStageTextPtrs_0f = 0x7699;
const IslandOpenRoundSinglesNpc05TextIds = 0x783A, IslandOpenRoundActorsDoubles_0f = 0x7842;
const IslandOpenRoundNpcScriptsDoubles_0f = 0x78A0, IslandOpenRoundDoublesNpc03TextIds = 0x78E4;
const BANK_RANKING = 0x1B;
const YES = 0;

// a word of a table of this bank, entry i (`add a / ld_hl_indexed table`)
const tableWord = (P, table, i) => P.rom.u16(BANK, (table + ((i * 2) & 0xFF)) & 0xFFFF);
// `ld hl, base / ld a, [wMapSceneStage] (/ dec a) / add l / ld l, a / jr nc / inc h`: base + the round
const roundText = (P, base, minus) => (base + ((P.V.mapSceneStage - minus) & 0xFF)) & 0xFFFF;
// script_set_anim actor, anim / script_wait_idle actor
function* animIdle(P, actor, anim) {
  setAnim(P, actor, anim);
  yield* waitIdle(P, actor);
}

// UnusedTournamentNpc0A_0f (0F:6F18): TournamentNpc0A_0f a second time (slot $0B). Nothing points at it.
export const unusedTournamentNpc0A = P => question(P, Text_1f_163, ACTOR_SLOT_0B);
// TournamentNpc03_0f (0F:6F3C): an official's question: no: the line of the round
export function* tournamentNpc03(P) {
  const NPC = ACTOR_ISLAND_OPEN_FINAL_DOUBLES_WALK_6F_07_1;
  yield* setText(P, Text_1f_172);
  if ((yield* askYesNo(P, NPC)) !== YES) yield* setText(P, roundText(P, Text_1f_174, 0));   // .altLine
  yield* speak(P, NPC);
}
// TournamentNpc04_0f (0F:6F71): the other official: the line of the round
export function* tournamentNpc04(P) {
  yield* setText(P, roundText(P, Text_1f_178, 0));
  yield* speak(P, ACTOR_ISLAND_OPEN_FINAL_DOUBLES_WALK_6F_07_2);
}
// MovePartnerForRoundCall_0f (0F:6F85): in doubles before the final the partner's stand-in (slot $0D) walks to the
// court side; it and slot $0C face down
export function* movePartnerForRoundCall(P) {
  if (!testFlag(P, FLAG_DOUBLES) || testFlag(P, FLAG_WON_ISLAND_OPEN_DOUBLES_SEMIFINAL)) return;
  nullScript(P, ACTOR_SLOT_0D);
  moveTarget(P, ACTOR_SLOT_0D, 25.0, 17.0);
  yield* waitMove(P, ACTOR_SLOT_0D);
  moveTarget(P, ACTOR_SLOT_0D, 25.0, 19.0);
  yield* waitMove(P, ACTOR_SLOT_0D);
  face(P, ACTOR_SLOT_0C, FACE_DOWN);
  face(P, ACTOR_SLOT_0D, FACE_DOWN);
}

// IslandOpenRoundCallCutscene (0F:6FC3): the round is called: the caller names the round, the officials lead the
// player (and partner) and the opponents to the court, the ranking board, and the round's match (back at the site's
// entry $0A singles / $0B doubles).
export function* islandOpenRoundCallCutscene(P) {
  const LEAD = ACTOR_ISLAND_OPEN_FINAL_DOUBLES_WALK_6F_07_2, CALLER = ACTOR_ISLAND_OPEN_FINAL_DOUBLES_WALK_6F_07_3;
  const OPPONENT = ACTOR_ROLE_ISLAND_OPEN_OPPONENT;
  yield* setText(P, Text_25_94);
  yield* movePlayer(P, 17.0, 15.0);
  yield* waitPlayerMove(P);
  moveTarget(P, CALLER, 14.0, 12.0);
  yield* waitMove(P, CALLER);
  moveTarget(P, CALLER, 19.0, 12.0);
  yield* waitMove(P, CALLER);
  face(P, CALLER, FACE_DOWN);
  yield* animIdle(P, CALLER, ANIM_BOUNCE);
  queueUpcomingRoundNameText(P);
  yield* speak(P, CALLER);
  yield* movePartnerForRoundCall(P);
  face(P, LEAD, FACE_UP);
  yield* animIdle(P, LEAD, ANIM_NOD);
  face(P, LEAD, FACE_DOWN);
  moveTarget(P, LEAD, 19.0, 23.0);
  moveTarget(P, CALLER, 19.0, 23.0);
  yield* movePlayer(P, 17.0, 19.0);
  yield* waitMove(P, LEAD);
  moveTarget(P, LEAD, 21.0, 23.0);
  yield* waitMove(P, LEAD);
  face(P, LEAD, FACE_UP);
  yield* waitMove(P, CALLER);
  face(P, CALLER, FACE_UP);
  queueUpcomingRoundNameText(P);
  yield* speak(P, LEAD);
  facePair(P, CALLER, LEAD);
  yield* animIdle(P, LEAD, ANIM_NOD);
  moveTarget(P, CALLER, 16.0, 23.0);
  if (P.V.mapSceneStage !== ISLANDOPENROUND_FINAL) {
    moveTarget(P, ACTOR_ISLAND_OPEN_ROUND1_DOUBLES_WALK_6F_07_2, 24.0, 23.0);
    yield* waitMove(P, ACTOR_ISLAND_OPEN_ROUND1_DOUBLES_WALK_6F_07_2);
    face(P, ACTOR_ISLAND_OPEN_ROUND1_DOUBLES_WALK_6F_07_2, FACE_UP);
  }
  yield* waitMove(P, CALLER);                                         // .partnerReady
  face(P, CALLER, FACE_UP);
  yield* speak(P, LEAD);
  if (testFlag(P, FLAG_DOUBLES)) return yield* doublesToTheCourt(P);  // .afterMatch
  setSpeed(P, ACTOR_PLAYER, 1.0);
  facePair(P, OPPONENT, ACTOR_PLAYER);
  yield* wait(P, 30);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  face(P, OPPONENT, FACE_DOWN);
  setAnim(P, OPPONENT, ANIM_NOD);
  yield* animIdle(P, ACTOR_PLAYER, ANIM_NOD);
  // the final is played on the other court (ActorScript_0f_05), the other rounds on this one (_03)
  const final = testFlag(P, FLAG_WON_ISLAND_OPEN_SINGLES_SEMIFINAL);
  const walk = final ? ActorScript_0f_05 : ActorScript_0f_03;
  moveTarget(P, CALLER, 19.0, 23.0);
  yield* waitMove(P, CALLER);
  setActorScript(P, CALLER, walk);
  yield* wait(P, 20);
  setActorScript(P, OPPONENT, walk);
  yield* wait(P, 20);
  setActorScript(P, ACTOR_PLAYER, walk);
  if (final) yield* wait(P, 20);
  yield* movePlayer(P, 17.0, 13.0);
  yield* waitPlayerMove(P);
  yield* wait(P, final ? 30 : 60);
  yield* fadeOutAndWait(P, 16);                                       // .startMatch
  yield* showTournamentRankingBoard(P);
  goToLocation(P, STORYLOC_TOURNAMENT, 0x0A);
  initMatchSettings(P);
  let match = STORYMATCH_ISLAND_OPEN_ROUND_1;
  if (testFlag(P, FLAG_WON_ISLAND_OPEN_SINGLES_SEMIFINAL)) match = STORYMATCH_ISLAND_OPEN_FINAL;
  else if (testFlag(P, FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_2)) match = STORYMATCH_ISLAND_OPEN_SEMIFINAL;   // .checkRound2
  else if (testFlag(P, FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_1)) match = STORYMATCH_ISLAND_OPEN_ROUND_2;     // .checkRound1
  loadMatchSettings(P, MATCHLIST_SINGLES, match);
  yield* runMatch(P);                                                 // .runMatch
  yield* restoreAfterMatch(P);
}
// IslandOpenRoundCallCutscene.afterMatch: the doubles pair and their opponents to the court (the final on the
// other one), the board and the round's match
function* doublesToTheCourt(P) {
  const CALLER = ACTOR_ISLAND_OPEN_FINAL_DOUBLES_WALK_6F_07_3;
  facePair(P, ACTOR_PARTNER, ACTOR_PLAYER);
  setSpeed(P, ACTOR_PLAYER, 1.0);
  setSpeed(P, ACTOR_PARTNER, 1.0);
  yield* wait(P, 20);
  setAnim(P, ACTOR_PARTNER, ANIM_NOD);
  yield* animIdle(P, ACTOR_PLAYER, ANIM_NOD);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  face(P, ACTOR_PARTNER, FACE_DOWN);
  const final = testFlag(P, FLAG_WON_ISLAND_OPEN_DOUBLES_SEMIFINAL);
  const walk = final ? ActorScript_0f_05 : ActorScript_0f_03, opponents = final ? ActorScript_0f_06 : ActorScript_0f_04;
  moveTarget(P, CALLER, 19.0, 23.0);
  yield* waitMove(P, CALLER);
  setActorScript(P, CALLER, walk);
  yield* wait(P, 20);
  setActorScript(P, ACTOR_PLAYER, walk);
  yield* wait(P, 20);
  setActorScript(P, ACTOR_PARTNER, walk);
  yield* wait(P, 60);
  setActorScript(P, ACTOR_ROLE_ISLAND_OPEN_OPPONENT_PARTNER, opponents);
  yield* wait(P, 20);
  setActorScript(P, ACTOR_ROLE_ISLAND_OPEN_OPPONENT, opponents);
  yield* movePlayer(P, 17.0, 13.0);
  yield* waitPlayerMove(P);
  if (!final) yield* wait(P, 60);
  yield* fadeOutAndWait(P, 16);                                       // .walkOff
  yield* showTournamentRankingBoard(P);
  goToLocation(P, STORYLOC_TOURNAMENT, 0x0B);
  initMatchSettings(P);
  let match = STORYMATCH_ISLAND_OPEN_ROUND_2;                         // (doubles' first round: list entry $11)
  if (testFlag(P, FLAG_WON_ISLAND_OPEN_DOUBLES_SEMIFINAL)) match = STORYMATCH_ISLAND_OPEN_FINAL;
  else if (testFlag(P, FLAG_WON_ISLAND_OPEN_DOUBLES_ROUND_1)) match = STORYMATCH_ISLAND_OPEN_SEMIFINAL;   // .walkOffDoubles
  loadMatchSettings(P, MATCHLIST_DOUBLES, match);
  yield* runMatch(P);                                                 // .done
  yield* restoreAfterMatch(P);
}

// GetIslandOpenRoundParams (0F:7416): the ranking board's parameters for the round: b = doubles, c = the board's
// round (wMapSceneStage + 1; doubles, without a second round, at most 2), d = 0. Returns a, b, c, d and F (of its
// `inc a`, or in doubles of its `cp $03` / `dec a`).
export function getIslandOpenRoundParams(P) {
  const doubles = testFlag(P, FLAG_DOUBLES), stage = P.V.mapSceneStage, round = (stage + 1) & 0xFF;
  if (!doubles) return { a: round, b: 0, c: round, d: 0, f: incFlags(stage, 0) };
  if (round < 3) return { a: round, b: 1, c: round, d: 0, f: cpFlags(round, 3) };
  const c = (round - 1) & 0xFF;
  return { a: c, b: 1, c, d: 0, f: decFlags(round, 0) };
}
// ShowTournamentRankingBoard_0f (0F:7434): the scroll, camera and frame tasks reset, the Island Open's ranking
// board of the round (d = 0: its plain form)
export function* showTournamentRankingBoard(P) {
  const { V } = P;
  V.bGColumnBlitPending = 0;
  V.bGRowBlitPending = 0;
  V.scrollY = 0;
  V.scrollX = 0;
  P.bus.w8(P.A.cameraX + 1, 0);
  P.bus.w8(P.A.cameraY + 1, 0);
  clearFrameTasks(P);
  const r = getIslandOpenRoundParams(P);
  yield* farcallGen(P, BANK_RANKING, showRankingBoard(P, r.b, r.c, r.d));
}
// QueueUpcomingRoundNameText (0F:744D): the name of the round to play (wMapSceneStage) as the next argument
export function queueUpcomingRoundNameText(P) { queueShortText(P, roundText(P, Text_25_97, 0)); }
// CheckIslandOpenVictoryTransition (0F:745C): once the final of the format played is won, on to the Island Sky
// (entry 8): a = 1; else a = 0. F: the flag test's.
export function checkIslandOpenVictoryTransition(P) {
  const won = testFlag(P, testFlag(P, FLAG_DOUBLES) ? FLAG_WON_ISLAND_OPEN_DOUBLES_FINAL : FLAG_WON_ISLAND_OPEN_SINGLES_FINAL);
  if (won) goToLocation(P, STORYLOC_ISLAND_SKY, 0x08);                // .transition
  return { a: won ? 1 : 0, f: testFlagF(won) };
}
// a won match, not given up: wMatchExitRequest (WRAM 4 mapped) not 1, wMatchWinLoseFlag the win
function wonMatch(P) {
  P.wramBank(WRAM_ACTORS);
  return P.bus.u8(P.A.matchExitRequest) !== MATCH_EXIT_REQUESTED && P.bus.u8(P.A.matchWinLoseFlag) === WINLOSE_WIN;
}
// the friends' "!" balloon of a round list mirrored (its OAM attribute's x flip toggled)
function flipBalloon(P, actor) {
  const at = (actorState(P, actor) + ACTORF_OAM_ATTR) & 0xFFFF;
  P.bus.w8(at, P.bus.u8(at) ^ OAM_XFLIP);
}

// IslandOpenSinglesMatchReturn (0F:7487): back from a singles round: lost or quit, the site between rounds; won
// the final, on to the Island Sky; else the friends' congratulations, the break (IslandOpenBreakCutscene) and the
// next round's call (FLAG_ISLAND_OPEN_IN_PROGRESS).
export function* islandOpenSinglesMatchReturn(P) {
  const FRIEND = ACTOR_ISLAND_OPEN_ROUND_SINGLES_WALK_74_08, SECOND = ACTOR_ISLAND_OPEN_ROUND_SINGLES_WALK_74_07;
  const OFFICIAL = ACTOR_ISLAND_OPEN_ROUND_SINGLES_WALK_74_06, BALLOON = ACTOR_ISLAND_OPEN_ROUND_SINGLES_BALLOON_EXCLAIM;
  if (!wonMatch(P)) {                                                 // .quitOrLost
    loadIslandOpenRoundNpcs(P);
    setPlayerAndPartnerObjectDefs(P);
    return;
  }
  clearFlag(P, FLAG_TOURNAMENT_NPC05_TALKED_SINGLES);                 // .wonRound
  clearFlag(P, FLAG_COURT2_SPECTATORS_TALKED_SINGLES);
  if (checkIslandOpenVictoryTransition(P).a) return;
  respawnActors(P, IslandOpenRoundActorsSingles_0f);                  // .returnToSite
  setNpcScripts(P, IslandOpenRoundNpcScriptsSingles_0f);
  computeIslandOpenRound(P);
  beginCutscene(P);
  setPlayerAndPartnerObjectDefs(P);
  flipBalloon(P, BALLOON);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  yield* setText(P, tableWord(P, IslandOpenSinglesStageTextPtrs_0f, P.V.mapSceneStage));
  setPosition(P, BALLOON, 34.0, 15.5);
  sound(P, SFX_CHIME);
  yield* wait(P, 45);
  yield* animIdle(P, FRIEND, ANIM_BOUNCE);
  faceToward(P, FRIEND, ACTOR_PLAYER);
  setPosition(P, BALLOON, 63.0, 63.0);
  yield* speak(P, FRIEND);
  yield* animIdle(P, SECOND, ANIM_BOUNCE);
  faceToward(P, SECOND, ACTOR_PLAYER);
  yield* speak(P, SECOND);
  yield* animIdle(P, OFFICIAL, ANIM_NOD);
  faceToward(P, OFFICIAL, ACTOR_PLAYER);
  yield* speak(P, OFFICIAL);
  yield* islandOpenBreakCutscene(P);
  yield* setText(P, Text_25_73);
  queueShortText(P, roundText(P, Text_25_98, 1));                     // .done
  face(P, OFFICIAL, FACE_UP);
  face(P, FRIEND, FACE_RIGHT);
  faceToward(P, OFFICIAL, ACTOR_PLAYER);
  yield* speak(P, OFFICIAL);
  moveAngle(P, OFFICIAL, FACE_RIGHT, 2.0);
  yield* waitMove(P, OFFICIAL);
  yield* wait(P, 10);
  yield* wait(P, 10);
  face(P, OFFICIAL, FACE_LEFT);
  setFlag(P, FLAG_ISLAND_OPEN_IN_PROGRESS);
}

// island_open_round_doubles_npc04 (IslandOpenRoundSinglesNpc04_0f 0F:762E, IslandOpenRoundDoublesNpc04_0f 0F:78B1):
// B Coz: the next round's name (wMapSceneStage - 1 from Text_25_98) in his line
export function* islandOpenRoundNpc04(P) {
  yield* setText(P, Text_25_73);
  queueShortText(P, roundText(P, Text_25_98, 1));                     // .queue
  yield* speak(P, ACTOR_ROLE_ISLAND_OPEN_ROUND_B_COZ);
}
// IslandOpenRoundSinglesNpc03_0f (0F:7649): the friend nods: the line of the round
export function* islandOpenRoundSinglesNpc03(P) {
  yield* setText(P, tableWord(P, IslandOpenSinglesStageTextPtrs_0f, P.V.mapSceneStage));
  yield* animIdle(P, ACTOR_ISLAND_OPEN_ROUND_SINGLES_WALK_74_08, ANIM_NOD);
  yield* speak(P, ACTOR_ISLAND_OPEN_ROUND_SINGLES_WALK_74_08);
}
// IslandOpenRoundSinglesNpc05_0f (0F:766C): the second friend jumps: the line of the round
export function* islandOpenRoundSinglesNpc05(P) {
  yield* setText(P, tableWord(P, IslandOpenRoundSinglesNpc05_0fTable, (P.V.mapSceneStage - 1) & 0xFF));
  jumpVelocity(P, ACTOR_ISLAND_OPEN_ROUND_SINGLES_WALK_74_07, -2.0);
  yield* waitJump(P, ACTOR_ISLAND_OPEN_ROUND_SINGLES_WALK_74_07);
  yield* speak(P, ACTOR_ISLAND_OPEN_ROUND_SINGLES_WALK_74_07);
}

// IslandOpenDoublesMatchReturn (0F:76A3): back from a doubles round: lost or quit, the site between rounds (the
// pair by the board); won the final, on to the Island Sky; else the partner's joy (its lines by gender), the
// friends' congratulations, the break and the next round's call.
export function* islandOpenDoublesMatchReturn(P) {
  const FRIEND = ACTOR_ISLAND_OPEN_ROUND_DOUBLES_WALK_74_08, OFFICIAL = ACTOR_ISLAND_OPEN_ROUND_DOUBLES_WALK_74_06;
  const BALLOON = ACTOR_ISLAND_OPEN_ROUND_DOUBLES_BALLOON_EXCLAIM;
  if (!wonMatch(P)) {                                                 // .quitOrLost
    loadIslandOpenRoundNpcs(P);
    setPlayerAndPartnerObjectDefs(P);
    setPosition(P, ACTOR_PLAYER, 37.0, 17.0);
    yield* movePlayer(P, 37.0, 17.0);
    setPosition(P, ACTOR_PARTNER, 37.0, 19.0);
    face(P, ACTOR_PARTNER, FACE_UP);
    yield* waitPlayerMove(P);
    return;
  }
  clearFlag(P, FLAG_TOURNAMENT_NPC05_TALKED_DOUBLES);                 // .wonRound
  clearFlag(P, FLAG_COURT2_SPECTATORS_TALKED_DOUBLES);
  if (checkIslandOpenVictoryTransition(P).a) return;
  respawnActors(P, IslandOpenRoundActorsDoubles_0f);                  // .accepted
  beginCutscene(P);
  setNpcScripts(P, IslandOpenRoundNpcScriptsDoubles_0f);
  setPlayerAndPartnerObjectDefs(P);
  nullScript(P, ACTOR_PARTNER);
  setPosition(P, ACTOR_PARTNER, 37.0, 17.0);
  face(P, ACTOR_PARTNER, FACE_UP);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  computeIslandOpenRound(P);
  beginCutscene(P);
  faceToward(P, ACTOR_PLAYER, ACTOR_PARTNER);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  yield* setText(P, tableWord(P, IslandOpenRoundSinglesNpc05TextIds, (P.V.mapSceneStage - 1) & 0xFF));
  if (!P.V.storyModeGenderOfPartnerCharacter) { advanceText(P); advanceText(P); advanceText(P); }
  flipBalloon(P, BALLOON);                                            // .declined
  faceToward(P, ACTOR_PLAYER, ACTOR_PARTNER);
  jumpVelocity(P, ACTOR_PARTNER, -2.0);
  yield* waitJump(P, ACTOR_PARTNER);
  faceToward(P, ACTOR_PARTNER, ACTOR_PLAYER);
  yield* speak(P, ACTOR_PARTNER);
  setPosition(P, BALLOON, 32.0, 15.5);
  sound(P, SFX_CHIME);
  yield* wait(P, 45);
  yield* animIdle(P, FRIEND, ANIM_BOUNCE);
  setPosition(P, BALLOON, 63.0, 63.0);
  faceToward(P, FRIEND, ACTOR_PLAYER);
  yield* speak(P, FRIEND);
  yield* animIdle(P, OFFICIAL, ANIM_NOD);
  faceToward(P, OFFICIAL, ACTOR_PLAYER);
  faceToward(P, OFFICIAL, ACTOR_PARTNER);
  yield* speak(P, OFFICIAL);
  yield* islandOpenBreakCutscene(P);
  faceToward(P, ACTOR_PLAYER, OFFICIAL);
  face(P, FRIEND, FACE_RIGHT);
  yield* setText(P, Text_25_73);
  queueShortText(P, roundText(P, Text_25_98, 1));                     // .done
  faceToward(P, OFFICIAL, ACTOR_PLAYER);
  faceToward(P, OFFICIAL, ACTOR_PARTNER);
  yield* speak(P, FRIEND);
  setFlag(P, FLAG_ISLAND_OPEN_IN_PROGRESS);
  followPlayer(P, ACTOR_PARTNER);
}
// IslandOpenRoundDoublesNpc03_0f (0F:78CC): the friend: the line of the round
export function* islandOpenRoundDoublesNpc03(P) {
  yield* setText(P, tableWord(P, IslandOpenRoundDoublesNpc03TextIds, (P.V.mapSceneStage - 1) & 0xFF));
  yield* speak(P, ACTOR_ISLAND_OPEN_ROUND_DOUBLES_WALK_74_08);
}

export const HOOKS = [
  scene(BANK, 0x6F18, unusedTournamentNpc0A),
  scene(BANK, 0x6F3C, tournamentNpc03),
  scene(BANK, 0x6F71, tournamentNpc04),
  scene(BANK, 0x6F85, movePartnerForRoundCall),
  scene(BANK, 0x6FC3, islandOpenRoundCallCutscene),
  [BANK, 0x7416, hook(P => getIslandOpenRoundParams(P))],
  scene(BANK, 0x7434, showTournamentRankingBoard),
  [BANK, 0x744D, hook(P => { queueUpcomingRoundNameText(P); })],
  [BANK, 0x745C, hook(P => checkIslandOpenVictoryTransition(P))],
  scene(BANK, 0x7487, islandOpenSinglesMatchReturn),
  scene(BANK, 0x762E, islandOpenRoundNpc04),                         // IslandOpenRoundSinglesNpc04_0f
  scene(BANK, 0x7649, islandOpenRoundSinglesNpc03),
  scene(BANK, 0x766C, islandOpenRoundSinglesNpc05),
  scene(BANK, 0x76A3, islandOpenDoublesMatchReturn),
  scene(BANK, 0x78B1, islandOpenRoundNpc04),                         // IslandOpenRoundDoublesNpc04_0f
  scene(BANK, 0x78CC, islandOpenRoundDoublesNpc03),
];
