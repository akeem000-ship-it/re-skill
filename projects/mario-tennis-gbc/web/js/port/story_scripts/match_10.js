// Bank $10's match-select debug map ($40B0-$4593): its handlers (the character select, the epilogue scene, the
// ending credits), its init script, the singles / doubles / drill match lists (a story match or drill picked from
// a menu, then played from here), the 37 match loaders the lists jump to, the character-data screen (unused) and
// the lesson menu (the service and net lessons; the stroke lessons and the ranking boards are lessonmenu_10's).
// The map tables and the lists' jump tables are data (read from the ROM).
// Port of src/story/match_10.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss2_talk_matchselect*.mtrec, ss2_talk_run*.mtrec, ss2_matchsel_*.mtrec (scripted: the
// match-select map's handlers and menus).
import {
  MATCHLIST_DOUBLES, MATCHLIST_SINGLES, SPEAKER_NONE, beginCutscene, clearFlag, clearFrameTasks, disableLCDSafely,
  enableLCD, endCutscene, fadeIn, fadeOutAndWait, hook, initMatchSettings, pagedTextMenu, registerFrameTask,
  restoreAfterMatch, returnHereAfter, runMatch, scene, setFlag, setText, sound, speak, unregisterFrameTask,
  waitFadeEnd, withWram,
} from "./common.js";
import { waitFrames } from "../home/frame.js";
import { rom } from "../menus/equipment/defs.js";
import { loadExhibitionMatchSettings as loadMatch } from "./match_setup_0e.js";
import { runTrainingDrill } from "./coach_walks_15.js";
import { runStrokeLessonMenu, showRankingBoardSamples } from "./lessonmenu_10.js";

const BANK = 0x10;
const BGM_COURT_WAREHOUSE = 0x14;
const FLAG_CHAR_DATA_START_EXITS = 0x1C, FLAG_DRILL_FROM_MENU = 0x1E;
const WRAM_SOUND = 0x07;
const MENU_CANCELLED = 0xFF, FADE_SPEED = 16;
const MINIGAME_SERVICE_PRACTICE_1 = 0x03, MINIGAME_NET_GAME_PRACTICE_1 = 0x09;
const Text_31_132 = 0x0484, Text_31_137 = 0x0489, Text_31_141 = 0x048D, Text_25_164 = 0x28A4;
const Text_37_12 = 0x1C0C, Text_37_13 = 0x1C0D, Text_37_14 = 0x1C0E;
// data of this bank (read from the ROM)
const RunSinglesMatchListMenuTable = 0x4220, RunDoublesMatchListMenuTable = 0x4246;
const SceneAnimationFrameTask_10 = 0x4141;
// routines of other banks (run as the ROM's, or the JS another part hooked there)
const RunCharacterSelectScreen = [0x38, 0x47C7], LoadStoryObjPalettes = [0x0A, 0x5337];
const LoadMenuFontGfx = [0x01, 0x50E2], RunScrollingTextScreen = [0x03, 0x59C5];
const SetupSceneAnimationPalettes = [0x03, 0x5B28], UpdateSceneAnimation = [0x03, 0x5B4D];
const RunEndingCreditsSequence = [0x0A, 0x6E74], CheckStorySlot = [0x03, 0x4D64];
const SaveStorySlotWithTimer = [0x03, 0x4D10], CharDataScreen_Show = [0x1C, 0x401A];
const UpdateMinigameRecord = [0x03, 0x5072], ShowRankingBoard = [0x1B, 0x4E81];
const ShowDrillBriefingScreen = [0x17, 0x4487];

// MatchSelectRunCharacterSelect (10:40B0): faded out, the character select (b = 0) and back: the story palettes and
// the menu font again (LCD off); come back here
export function* matchSelectRunCharacterSelect(P) {
  beginCutscene(P);
  yield* fadeOutAndWait(P, FADE_SPEED);
  yield* P.runRom(...RunCharacterSelectScreen, { b: 0x00 });
  yield* fadeOutAndWait(P, FADE_SPEED);
  yield* P.runRom(...LoadStoryObjPalettes);
  disableLCDSafely(P);
  yield* P.runRom(...LoadMenuFontGfx);
  enableLCD(P);
  returnHereAfter(P);
  endCutscene(P);
}
// MatchSelectPlayEpilogueScene (10:40EF): the scrolling text, then the animated scene (its frame task) for
// 120 + 6 * 255 frames
export function* matchSelectPlayEpilogueScene(P) {
  beginCutscene(P);
  yield* P.runRom(...RunScrollingTextScreen);
  yield* waitFrames(P, 60);
  enableLCD(P);
  yield* P.runRom(...SetupSceneAnimationPalettes);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  sound(P, BGM_COURT_WAREHOUSE);
  registerFrameTask(P, 0x01, SceneAnimationFrameTask_10);
  yield* waitFrames(P, 120);
  for (let i = 0; i < 6; i++) yield* waitFrames(P, 255);
  unregisterFrameTask(P, SceneAnimationFrameTask_10);
  endCutscene(P);
}
// MatchSelectRunEndingCredits (10:4137)
export function* matchSelectRunEndingCredits(P) {
  beginCutscene(P);
  yield* P.runRom(...RunEndingCreditsSequence);
  endCutscene(P);
}
// SceneAnimationFrameTask_10 (10:4141), a frame task: farcall UpdateSceneAnimation (bank $03)
export const sceneAnimationFrameTask = P => rom(P, UpdateSceneAnimation);
// MatchSelectInitScript_10 (10:4190): no location name shown
export function matchSelectInitScript(P) {
  P.V.storyModeShowLocationName = 0;
  return { a: 0, f: 0x80 };                             // xor a
}

// the match loaders the lists jump to: [address, list, match] (LoadMatchSinglesDreamHard .. LoadMatchDoublesVarsity
// Practice); LoadMatchSinglesJunior3Alias loads junior 3 again (the disassembly's FIXES build: varsity 4)
const S = MATCHLIST_SINGLES, D = MATCHLIST_DOUBLES;
const MATCH_LOADERS = [
  [0x4266, S, 0x18], [0x4274, S, 0x17], [0x4282, S, 0x16], [0x4290, D, 0x18], [0x429E, D, 0x17], [0x42AC, D, 0x16],
  [0x42BA, S, 0x10], [0x42C8, S, 0x11], [0x42D6, S, 0x12], [0x42E4, S, 0x13], [0x42F2, D, 0x11], [0x4300, D, 0x12],
  [0x430E, D, 0x13], [0x431C, S, 0x00], [0x432A, S, 0x04], [0x4338, S, 0x03], [0x4346, S, 0x02], [0x4354, S, 0x01],
  [0x4362, S, 0x09], [0x4370, S, 0x08], [0x437E, S, 0x07], [0x438C, S, 0x06], [0x439A, S, 0x05], [0x43A8, S, 0x02],
  [0x43B6, S, 0x0A], [0x43C4, D, 0x00], [0x43D2, D, 0x02], [0x43E0, D, 0x03], [0x43EE, D, 0x04], [0x43FC, D, 0x05],
  [0x440A, D, 0x07], [0x4418, D, 0x08], [0x4426, D, 0x09], [0x4434, D, 0x0D], [0x4442, D, 0x0A],
];
const LOADER_AT = new Map(MATCH_LOADERS.map(([addr, list, match]) => [addr, [list, match]]));
// call JumpToHL to the list's entry: its loader (another address: run as the ROM's)
function loadListedMatch(P, table, i) {
  const at = P.rom.u16(BANK, (table + ((i * 2) & 0xFF)) & 0xFFFF), m = LOADER_AT.get(at);
  return m ? loadMatch(P, ...m) : P.callRom(BANK, at);
}
// RunSinglesMatchListMenu (10:4195) / RunDoublesMatchListMenu (10:41DA): the list (5 / 4 pages); a match chosen
// (kept in wMapSceneStage): come back here after; the story match's settings, the match's loader, the match
function* runMatchListMenu(P, text, pages, table) {
  const choice = yield* pagedTextMenu(P, text, pages);
  if (choice === MENU_CANCELLED) return;
  P.V.mapSceneStage = choice;
  returnHereAfter(P);
  initMatchSettings(P);
  loadListedMatch(P, table, P.V.mapSceneStage);
  yield* runMatch(P);
  yield* restoreAfterMatch(P);
}
export const runSinglesMatchListMenu = P => runMatchListMenu(P, Text_31_132, 0x05, RunSinglesMatchListMenuTable);
export const runDoublesMatchListMenu = P => runMatchListMenu(P, Text_31_137, 0x04, RunDoublesMatchListMenuTable);

// the story slot 0 checked before a menu's screen and saved (with the play timer) after
function* checkSlot0(P) {
  P.V.currentStorySlot = 0x00;
  yield* P.runRom(...CheckStorySlot);
}
function* saveSlot0(P) {
  P.V.currentStorySlot = 0x00;
  yield* P.runRom(...SaveStorySlotWithTimer);
}
// RunDrillMatchListMenu (10:4450): the drill list (9 pages); a drill chosen: come back here after, slot 0
// checked, the drill run from the menu (FLAG_DRILL_FROM_MENU), slot 0 saved
export function* runDrillMatchListMenu(P) {
  const choice = yield* pagedTextMenu(P, Text_31_141, 0x09);
  if (choice === MENU_CANCELLED) return;
  returnHereAfter(P);
  yield* checkSlot0(P);
  setFlag(P, FLAG_DRILL_FROM_MENU);
  yield* runTrainingDrill(P, choice);
  yield* saveSlot0(P);
}
// MatchSelectCharDataOptionDisabled (10:448D): a message, no speaker
export function* matchSelectCharDataOptionDisabled(P) {
  yield* setText(P, Text_25_164);
  yield* speak(P, SPEAKER_NONE);
}
// Unused_10_RunCharDataScreen (10:4499): come back here after; slot 0 checked, the character-data screen (c = 0)
// with START leaving it, slot 0 saved
export function* unusedRunCharDataScreen(P) {
  returnHereAfter(P);
  yield* checkSlot0(P);
  setFlag(P, FLAG_CHAR_DATA_START_EXITS);
  yield* P.runRom(...CharDataScreen_Show, { c: 0x00 });
  clearFlag(P, FLAG_CHAR_DATA_START_EXITS);
  yield* saveSlot0(P);
}
// RunLessonSelectMenu (10:44CC): the frame tasks cleared; ranking boards 2 of both lists (b = 0, 1; d = 3); the
// minigame records 1 and 0 updated with wMinigameRecordValue (WRAM 7; the difference it then works out is dropped);
// the lesson menu: the service, net or stroke lessons, or the ranking boards' samples
export function* runLessonSelectMenu(P) {
  clearFrameTasks(P);
  yield* P.runRom(...ShowRankingBoard, { b: 0x00, c: 0x02, d: 0x03 });
  yield* P.runRom(...ShowRankingBoard, { b: 0x01, c: 0x02, d: 0x03 });
  withWram(P, WRAM_SOUND, () => {
    const at = P.A.minigameRecordValue;
    P.callRom(...UpdateMinigameRecord, { a: 0x01, de: P.bus.u16(at), hl: (at + 1) & 0xFFFF });
    P.callRom(...UpdateMinigameRecord, { a: 0x00 });
  });
  const choice = yield* pagedTextMenu(P, Text_37_12, 0x01);
  if (choice === MENU_CANCELLED) return;
  yield* [runServiceLessonMenu, runNetLessonMenu, runStrokeLessonMenu, showRankingBoardSamples][choice](P);
}
// RunServiceLessonMenu (10:4524) / RunNetLessonMenu (10:455C): the lessons' menu; a lesson chosen
// (wCurrentMinigameStoryMatch + 1 = the first one's minigame + choice): come back here after, faded out, its
// briefing screen (bank $17)
function* runLessonMenu(P, text, first) {
  const choice = yield* pagedTextMenu(P, text, 0x01);
  if (choice === MENU_CANCELLED) return;
  P.bus.w8(P.A.currentMinigameStoryMatch + 1, (choice + first) & 0xFF);
  returnHereAfter(P);
  yield* fadeOutAndWait(P, FADE_SPEED);
  yield* P.runRom(...ShowDrillBriefingScreen);
}
export const runServiceLessonMenu = P => runLessonMenu(P, Text_37_13, MINIGAME_SERVICE_PRACTICE_1);
export const runNetLessonMenu = P => runLessonMenu(P, Text_37_14, MINIGAME_NET_GAME_PRACTICE_1);

export const HOOKS = [
  scene(BANK, 0x40B0, matchSelectRunCharacterSelect),
  scene(BANK, 0x40EF, matchSelectPlayEpilogueScene),
  scene(BANK, 0x4137, matchSelectRunEndingCredits),
  [BANK, 0x4141, hook(sceneAnimationFrameTask)],
  [BANK, 0x4190, hook(matchSelectInitScript)],
  scene(BANK, 0x4195, runSinglesMatchListMenu),
  scene(BANK, 0x41DA, runDoublesMatchListMenu),
  ...MATCH_LOADERS.map(([addr, list, match]) => [BANK, addr, hook(P => loadMatch(P, list, match))]),
  scene(BANK, 0x4450, runDrillMatchListMenu),
  scene(BANK, 0x448D, matchSelectCharDataOptionDisabled),
  scene(BANK, 0x4499, unusedRunCharDataScreen),
  scene(BANK, 0x44CC, runLessonSelectMenu),
  scene(BANK, 0x4524, runServiceLessonMenu),
  scene(BANK, 0x455C, runNetLessonMenu),
];
