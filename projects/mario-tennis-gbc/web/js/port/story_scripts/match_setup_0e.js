// The exhibition match at the special court (bank $0E, $7B7F-$7ED1): the match set up and played (the dream match
// by the choice in wMapScratch + 2: hard, intense, max; singles or doubles), its result (lost: Peach's castle;
// won the first time: the clear scene and back to the main menu), the bank's map-script stubs and its copies of the
// story-rank routines. The actor scripts (ActorScript_0e_16..28) and the match table are data.
// Port of src/story/match_setup_0e.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss2_special*.mtrec (scripted: the exhibition played, won and lost); tests:
// web/tests/port/routines_story_scripts2.mjs.
import {
  FLAG_DOUBLES, BANK_STORY, MATCHLIST_SINGLES, MATCHLIST_DOUBLES, testFlag, goToLocation, initMatchSettings, runMatch,
  restoreAfterMatch, farcall, hook, scene,
} from "./common.js";
import { loadMatchSettingsFromTable } from "../story/match.js";
import { computeRankingProgressIndex, computeStoryRankTier } from "./twins.js";
import { mapScriptStubs } from "./shared2.js";

const BANK = 0x0E;
const STORYLOC_MAIN_MENU = 0x00, STORYLOC_SPECIAL_COURT = 0x1C, STORYLOC_PEACHS_CASTLE = 0x1D;
const STORYMATCH_DREAM_MAX = 0x16, STORYMATCH_DREAM_INTENSE = 0x17, STORYMATCH_DREAM_HARD = 0x18;
const FLAG_WON_DREAM_MATCH_DOUBLES = 0x34, FLAG_WON_DREAM_MATCH_SINGLES = 0x3B;
const WINLOSE_WIN = 0x01;
const ENTRY_RESULT = 0x0A, ENTRY_CASTLE_RETURN = 0x0E, ENTRY_MAIN_MENU = 0x0A;
const SCENE_MODE_CLEAR = 0x02;
const RunStorySceneByMode = [0x18, 0x7617];
// the six match loaders (LoadExhibitionMatchSettings0-5, by PrepareStoryMatchTable): [address, list, match]
const EXHIBITION_MATCHES = [[0x7BB8, MATCHLIST_SINGLES, STORYMATCH_DREAM_HARD],
  [0x7BC6, MATCHLIST_SINGLES, STORYMATCH_DREAM_INTENSE], [0x7BD4, MATCHLIST_SINGLES, STORYMATCH_DREAM_MAX],
  [0x7BE2, MATCHLIST_DOUBLES, STORYMATCH_DREAM_HARD], [0x7BF0, MATCHLIST_DOUBLES, STORYMATCH_DREAM_INTENSE],
  [0x7BFE, MATCHLIST_DOUBLES, STORYMATCH_DREAM_MAX]];

// LoadExhibitionMatchSettings0-5 (0E:7BB8 ..): load_match_settings list, match: wCurrentMinigameStoryMatch, then
// LoadMatchSettingsFromTable (its registers)
export function loadExhibitionMatchSettings(P, list, match) {
  P.bus.w8(P.A.currentMinigameStoryMatch, list);
  P.bus.w8(P.A.currentMinigameStoryMatch + 1, match);
  return farcall(P, BANK_STORY, () => loadMatchSettingsFromTable(P));
}
// PrepareStoryMatch (0E:7B7F): back to the special court's result entry ($0A) after; the story match's settings, the
// exhibition chosen (wMapScratch + 2), the match and the overworld restored
export function* prepareStoryMatch(P) {
  goToLocation(P, STORYLOC_SPECIAL_COURT, ENTRY_RESULT);
  initMatchSettings(P);
  const [, list, match] = EXHIBITION_MATCHES[P.bus.u8(P.A.mapScratch + 2)];
  loadExhibitionMatchSettings(P, list, match);
  yield* runMatch(P);
  yield* restoreAfterMatch(P);
}
// HandleExhibitionMatchResult (0E:7C0C): lost, or won again: to Peach's castle (entry $0E). Won the first time
// (the dream match flag already set by the match): the clear scene (bank $18's RunStorySceneByMode, mode 2: singles
// 4 + gender, doubles the pair's genders), then the main menu (entry $0A)
export function* handleExhibitionMatchResult(P) {
  const doubles = testFlag(P, FLAG_DOUBLES);
  const won = P.V.matchWinLoseFlag === WINLOSE_WIN && testFlag(P, doubles ? FLAG_WON_DREAM_MATCH_DOUBLES : FLAG_WON_DREAM_MATCH_SINGLES);
  if (!won) { goToLocation(P, STORYLOC_PEACHS_CASTLE, ENTRY_CASTLE_RETURN); return; }
  const main = P.V.storyModeGenderOfMainCharacter;
  const c = doubles ? ((main << 1) | (P.V.storyModeGenderOfPartnerCharacter ^ main)) & 0xFF : (main + 4) & 0xFF;
  yield* P.runRom(...RunStorySceneByMode, { b: SCENE_MODE_CLEAR, c });
  goToLocation(P, STORYLOC_MAIN_MENU, ENTRY_MAIN_MENU);
}

export const HOOKS = [
  scene(BANK, 0x7B7F, prepareStoryMatch),
  ...EXHIBITION_MATCHES.map(([addr, list, match]) => [BANK, addr, hook(P => loadExhibitionMatchSettings(P, list, match))]),
  scene(BANK, 0x7C0C, handleExhibitionMatchResult),
  ...mapScriptStubs(BANK, 0x7C96, 0x7C97, 0x7C9C, 0x7C9F),
  [BANK, 0x7E5A, hook(P => computeRankingProgressIndex(P))],        // ComputeRankingProgressIndex_0e
  [BANK, 0x7EA1, hook(P => computeStoryRankTier(P))],               // Unused_0e_ComputeStoryRankTier
];
