// Bank $10's lesson and drill menus and the Test 2 debug map ($4594-$4BD7): the stroke-lesson menu (its briefing
// screen), the ranking boards' samples, the minigame menu (a minigame and its level, run from the menu), the
// Test 2 map's NPCs (each runs a drill: the template's sixteen copies, nine never pointed at), its facing and tile
// scripts, its init script (the clear-status menu) and an unused water-sprite minigame. The map tables, actor
// scripts and the minigame table are data.
// Port of src/story/lessonmenu_10.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss2_test2*.mtrec (scripted: the Test 2 map's NPCs and init); the menus are reached from the
// match-select map (match_10.js's recordings).
import {
  ACTOR_PLAYER, SPEAKER_NONE, setFlag, setText, speak, pagedTextMenu, pushTextNumber, beginCutscene,
  endCutscene, fadeIn, fadeOutAndWait, clearFrameTasks, returnHereAfter, requestExit, scene,
} from "./common.js";
import { runTrainingDrill } from "./coach_walks_15.js";

const BANK = 0x10;
const FLAG_DRILL_FROM_MENU = 0x1E;
const MINIGAME_STROKE_PRACTICE_1 = 0x0F;
const COURT_GRASS = 0x02, CHAR_MARIO = 0x1A, CHAR_ALLIE = 0x04;
const MENU_CANCELLED = 0xFF;
const Text_37_15 = 0x1C0F, Text_31_150 = 0x0496, Text_31_153 = 0x0499, Text_30_353 = 0x0161;
const Text_31_128 = 0x0480, Text_31_131 = 0x0483;
// data of this bank (read from the ROM)
const MinigameSelectMenuTable = 0x4684;               // the menu's 9 minigames
const WaterSpriteModeHooks_10 = 0x4BD8, Test2InitScriptMinigamePointTable_10 = 0x4C13;
// routines of other banks (run as the ROM's, or the JS another part hooked there)
const ShowDrillBriefingScreen = [0x17, 0x4487], ShowRankingBoard = [0x1B, 0x4E81];
const ClearStatusSetupMenuEntry = [0x0A, 0x4EF8];
const InitMinigameMatchSettings = [0x08, 0x6544], SetModeHookTable = [0x08, 0x671A];
const SetMinigamePointTable = [0x08, 0x6728], RunN64ExhibData = [0x3B, 0x44AA], RunMinigameMatch = [0x08, 0x6557];
const FADE_SPEED = 16;
// the ranking boards shown in turn (ShowRankingBoard's c), b = 0, d = 0
const RANKING_BOARD_SAMPLES = [0x01, 0x02, 0x03];

// RunStrokeLessonMenu (10:4594): the stroke lessons' menu; a lesson (wCurrentMinigameStoryMatch + 1 = stroke practice
// 1 + choice) chosen: come back here after, fade out, its briefing screen (bank $17)
export function* runStrokeLessonMenu(P) {
  const choice = yield* pagedTextMenu(P, Text_37_15, 1);
  if (choice === MENU_CANCELLED) return;
  P.bus.w8(P.A.currentMinigameStoryMatch + 1, (choice + MINIGAME_STROKE_PRACTICE_1) & 0xFF);
  returnHereAfter(P);
  yield* fadeOutAndWait(P, FADE_SPEED);
  yield* P.runRom(...ShowDrillBriefingScreen);
}
// the scroll and camera back to 0 and the frame tasks cleared before each board
function resetScreenForBoard(P) {
  P.V.bGColumnBlitPending = 0; P.V.bGRowBlitPending = 0; P.V.scrollY = 0; P.V.scrollX = 0;
  P.bus.w8(P.A.cameraX + 1, 0); P.bus.w8(P.A.cameraY + 1, 0);
  clearFrameTasks(P);
}
// ShowRankingBoardSamples (10:45CC): come back here after; fade out, then the three sample ranking boards (bank $1B)
export function* showRankingBoardSamples(P) {
  returnHereAfter(P);
  yield* fadeOutAndWait(P, FADE_SPEED);
  clearFrameTasks(P);
  for (const c of RANKING_BOARD_SAMPLES) {
    resetScreenForBoard(P);
    yield* P.runRom(...ShowRankingBoard, { b: 0, c, d: 0 });
  }
}
// RunMinigameSelectMenu (10:4640): the minigame menu (3 pages), then its level menu (cancel: back to the first);
// the minigame (MinigameSelectMenuTable) run from the menu (FLAG_DRILL_FROM_MENU) at wMinigameLevel; come back here
export function* runMinigameSelectMenu(P) {
  for (;;) {
    const choice = yield* pagedTextMenu(P, Text_31_150, 3);
    if (choice === MENU_CANCELLED) return;
    const level = yield* pagedTextMenu(P, Text_31_153, 1);
    if (level === MENU_CANCELLED) continue;
    P.V.minigameLevel = level;
    setFlag(P, FLAG_DRILL_FROM_MENU);
    yield* runTrainingDrill(P, P.rom.u8(BANK, (MinigameSelectMenuTable + choice) & 0xFFFF));
    returnHereAfter(P);
    return;
  }
}
// the Test 2 map's NPC template (Test2Npc0B_10 and its copies): come back here after, the drill from the menu, the
// message "No. n" (Text_30_353 with the number), the drill
function* test2Npc(P, n, drill) {
  returnHereAfter(P);
  setFlag(P, FLAG_DRILL_FROM_MENU);
  pushTextNumber(P, n);
  yield* setText(P, Text_30_353);
  yield* speak(P, SPEAKER_NONE);
  yield* runTrainingDrill(P, drill);
}
// the template's copies: [address, number, drill] (Unused_10_Test2Npc03 .. Test2Npc12_10; 03-0A unreferenced)
const TEST2_NPCS = [
  [0x47CF, 0x01, 0x01], [0x4800, 0x02, 0x02], [0x4831, 0x03, 0x03], [0x4862, 0x04, 0x04], [0x4893, 0x05, 0x05],
  [0x48C4, 0x06, 0x06], [0x48F5, 0x07, 0x07], [0x4926, 0x08, 0x08], [0x4957, 0x09, 0x09], [0x4988, 0x0A, 0x0A],
  [0x49B9, 0x0B, 0x0B], [0x49EA, 0x0C, 0x0C], [0x4A1B, 0x0D, 0x0D], [0x4A4C, 0x0E, 0x0E], [0x4A7D, 0x0F, 0x0F],
  [0x4AAE, 0x10, 0x10],
];
// Test2Facing01_10 (10:4B69): a message of the player (faded in)
export function* test2Facing01(P) {
  beginCutscene(P);
  fadeIn(P, FADE_SPEED);
  yield* setText(P, Text_31_131);
  yield* speak(P, ACTOR_PLAYER);
  endCutscene(P);
}
// Test2Tile01_10 (10:4B89): a message of the player
export function* test2Tile01(P) {
  beginCutscene(P);
  yield* setText(P, Text_31_128);
  yield* speak(P, ACTOR_PLAYER);
  endCutscene(P);
}
// Test2InitScript_10 (10:4B9B): unless entered at entry $0F, the clear-status setup menu (bank $0A); its result
// (a) taken as the exit to request
export function* test2InitScript(P) {
  if (P.V.storyModeEntryPoint === 0x0F) return;
  const r = yield* P.runRom(...ClearStatusSetupMenuEntry);
  requestExit(P, r.a);
}
// Unused_10_RunWaterSpriteMinigame (10:4BAC): a minigame match on grass, two on court, with this bank's mode hooks
// (the water sprite's) and point table, Mario against Allie; the N64 exhibition data first. Nothing calls it.
export function* unusedRunWaterSpriteMinigame(P) {
  P.callRom(...InitMinigameMatchSettings);
  P.V.currentlyUsedCourt = COURT_GRASS;
  P.V.onCourtCharCount = 2;
  P.callRom(...SetModeHookTable, { a: P.V.romBank, de: WaterSpriteModeHooks_10 });
  P.callRom(...SetMinigamePointTable, { de: Test2InitScriptMinigamePointTable_10 });
  P.V.matchPlayerChar = CHAR_MARIO;
  P.V.matchOpponentChar = CHAR_ALLIE;
  yield* P.runRom(...RunN64ExhibData);
  yield* P.runRom(...RunMinigameMatch);
}

export const HOOKS = [
  scene(BANK, 0x4594, runStrokeLessonMenu),
  scene(BANK, 0x45CC, showRankingBoardSamples),
  scene(BANK, 0x4640, runMinigameSelectMenu),
  ...TEST2_NPCS.map(([addr, n, drill]) => scene(BANK, addr, P => test2Npc(P, n, drill))),
  scene(BANK, 0x4B69, test2Facing01),
  scene(BANK, 0x4B89, test2Tile01),
  scene(BANK, 0x4B9B, test2InitScript),
  scene(BANK, 0x4BAC, unusedRunWaterSpriteMinigame),
];
