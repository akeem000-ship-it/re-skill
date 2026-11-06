// The traveling team's matches in the courtyard (bank $13, $7988-$7D88): the team's victory cutscene (singles or
// doubles), the return after a won match (the team's actors, the walk to the board, the tournament bracket), the
// bracket screen by the Island Open's final, the bank's map-script stubs and its copies of the story-rank
// routines. The actor scripts are data.
// Port of src/story/team_bracket_13.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are; Unused_13_ComputeRankingProgressIndex and
// ComputeStoryRankTier_13 are src/twins/compute_ranking_progress_index_13.asm and compute_story_rank_tier.asm
// (twins.js).
// Recordings: out/port/ss2_team*.mtrec (scripted: the traveling team's matches won, singles and doubles).
import {
  ACTOR_PARTNER, ACTOR_PLAYER, ACTOR_PLAYER_SHADOW, FACE_UP, FLAG_DOUBLES, WRAM_ACTORS, beginCutscene,
  clearFrameTasks, face, fadeIn, fadeOutAndWait, goToLocation, hook, movePlayer, nullScript, playerSpeed,
  respawnActors, scene, setPosition, testFlag, waitFadeEnd, waitPlayerMove,
} from "./common.js";
import { computeRankingProgressIndex, computeStoryRankTier } from "./twins.js";
import { mapScriptStubs } from "./shared2.js";
import { singlesTravelingTeamVictoryCutscene, doublesTravelingTeamVictoryCutscene } from "./varsity_team_13.js";
import { applyPartnerCharacterVariant } from "./varsity_tour_13.js";

const BANK = 0x13;
const WINLOSE_WIN = 0x01, STORYLOC_COURTYARD = 0x07, ENTRY_BRACKET = 0x0E;
const FLAG_WON_ISLAND_OPEN_DOUBLES_FINAL = 0x35, FLAG_WON_ISLAND_OPEN_SINGLES_FINAL = 0x3C;
// data of this bank (read from the ROM)
const SinglesTravelingTeamActors_13 = 0x739C, DoublesTravelingTeamActors_13 = 0x78D7;
// routines of other banks (run as the ROM's, or the JS another part hooked there)
const ShowTournamentBracket = [0x3B, 0x775D];

// RunTravelingTeamVictoryCutscene_13 (13:7988): the team's victory cutscene, doubles or singles
export function* runTravelingTeamVictoryCutscene(P) {
  if (testFlag(P, FLAG_DOUBLES)) yield* doublesTravelingTeamVictoryCutscene(P);
  else yield* singlesTravelingTeamVictoryCutscene(P);
}
// RunTravelingTeamBracketIfWon_13 (13:7995): (WRAM 4 mapped) after a won match: back to the courtyard's entry
// $0E after; the team's actors, faded in, the player walks to (9, 19) (doubles: the pair placed at (11, 29) and
// (13, 35) first, the partner's sprite by gender), then the bracket
export function* runTravelingTeamBracketIfWon(P) {
  P.wramBank(WRAM_ACTORS);
  if (P.V.matchWinLoseFlag !== WINLOSE_WIN) return;
  goToLocation(P, STORYLOC_COURTYARD, ENTRY_BRACKET);
  if (!testFlag(P, FLAG_DOUBLES)) {
    respawnActors(P, SinglesTravelingTeamActors_13);
    beginCutscene(P);
    fadeIn(P, 4);
    yield* waitFadeEnd(P);
    playerSpeed(P, 0.75);
  } else {                                                // .isDoubles
    respawnActors(P, DoublesTravelingTeamActors_13);
    beginCutscene(P);
    applyPartnerCharacterVariant(P);
    nullScript(P, ACTOR_PARTNER);
    nullScript(P, ACTOR_PLAYER_SHADOW);
    playerSpeed(P, 2.0);
    setPosition(P, ACTOR_PLAYER, 11.0, 29.0);
    setPosition(P, ACTOR_PARTNER, 13.0, 35.0);
    face(P, ACTOR_PLAYER, FACE_UP);
    face(P, ACTOR_PARTNER, FACE_UP);
    fadeIn(P, 4);
    yield* waitFadeEnd(P);
  }
  yield* movePlayer(P, 9.0, 19.0);
  yield* waitPlayerMove(P);
  yield* showStoryTournamentBracket(P);
}
// ShowStoryTournamentBracket_13 (13:7AE0): faded out, the scroll and camera back to 0, the frame tasks cleared;
// the bracket (b singles 0 / doubles 1; c: before the Island Open final is won 4 singles / 2 doubles, after it 1)
export function* showStoryTournamentBracket(P) {
  yield* fadeOutAndWait(P, 8);
  P.V.bGColumnBlitPending = 0; P.V.bGRowBlitPending = 0; P.V.scrollY = 0; P.V.scrollX = 0;
  P.bus.w8(P.A.cameraX + 1, 0); P.bus.w8(P.A.cameraY + 1, 0);
  clearFrameTasks(P);
  const doubles = testFlag(P, FLAG_DOUBLES);
  const won = testFlag(P, doubles ? FLAG_WON_ISLAND_OPEN_DOUBLES_FINAL : FLAG_WON_ISLAND_OPEN_SINGLES_FINAL);
  yield* P.runRom(...ShowTournamentBracket, { b: doubles ? 0x01 : 0x00, c: won ? 0x01 : doubles ? 0x02 : 0x04 });
}

export const HOOKS = [
  scene(BANK, 0x7988, runTravelingTeamVictoryCutscene),
  scene(BANK, 0x7995, runTravelingTeamBracketIfWon),
  scene(BANK, 0x7AE0, showStoryTournamentBracket),
  ...mapScriptStubs(BANK, 0x7B4D, 0x7B4E, 0x7B53, 0x7B56),
  [BANK, 0x7D11, hook(P => computeRankingProgressIndex(P))],        // Unused_13_ComputeRankingProgressIndex
  [BANK, 0x7D58, hook(P => computeStoryRankTier(P))],               // ComputeStoryRankTier_13
];
