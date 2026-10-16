// The development map and the main menu's location (bank $10, $4BD8-$5172): the debug map's scenes (respawns, a
// chest, a facing and a tile trigger), the water-sprite mini-game's unused point hooks, and the main menu: its
// init script runs RunTitleAndMainMenuLoop, the intro, the title screen and the main menu, with the menu's handlers
// for a story slot (MatchSelectHandlersBHandler0) and for exhibition matches (MatchSelectHandlersBHandler3, with
// ApplyMatchTypeSettings). The location tables (DevelopmentMapScripts_10, MainMenuMapScripts_10 ...), the
// handler table MatchSelectHandlersB_10 and the match-type tables are data, read from the ROM.
// Port of src/story/devmap_10.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// The menus, the intro and the save code this calls are other parts' (run as the ROM's, or their JS where hooked):
// called at their addresses with P.runRom, which carries the registers as the ROM does. The menu's other handlers
// (RunMinigameModeFlow, RunSavedDataMenuFlow ..., src/story/modeflow_10.asm) are ROM code that jumps back to
// RunTitleAndMainMenuLoop.menuLoop: that entry is hooked too, so they run the rest of the loop as JS, and when one
// returns, the loop has returned.
// Recordings: out/engine/rec1.mtrec, rec2.mtrec and the out/port/ power-on recordings (title, main menu, a story
// slot, exhibition), out/port/ss1_dev*.mtrec (scripted: the development map).
import {
  ACTOR_PLAYER, FLAG_DOUBLES, testFlag, setFlag, clearFlag, setText, speak, setPosition, moveTarget, waitMove,
  beginCutscene, endCutscene, respawnActors, fadeIn, fadeInAndWait, fadeOutAndWait, sound,
  clearFrameTasks, enableLCD, resumeBGM, setMusicMuted, disableLCDSafely, returnHereAfter, requestExit,
  saveReturnPoint, restoreReturnPoint, jumpTableTarget, WRAM_ACTORS, BANK_SAVE, BANK_STORY_02, FZ, FH, FC, hook,
  hookGen, scene,
} from "./common.js";
import { restoreGameTimer, resetGameTimer } from "../home/flags.js";
import { initSerialLink } from "../home/link.js";

const BANK = 0x10;
// banks of the routines called
const BANK_MENU_FONT = 0x01, BANK_MATCH = 0x08, BANK_NEW_GAME = 0x1B, BANK_EXP = 0x1E, BANK_EXHIB_CHARS = 0x38;
const BANK_SCREEN = 0x39, BANK_MAIN_MENU = 0x3B, BANK_COURT_SELECT = 0x3E, BANK_INTRO = 0x6B;
// their addresses
const ShowIntroLogoScreen = 0x51AE, ScrollOutIntroLogo = 0x51E7, RunIntroCutscene = 0x402A, RunTitleScreen = 0x75AF;
const InitDefaultMatchSettings = 0x4070, RunMatch = 0x4190, LoadMenuFontGfx = 0x50E2;
const ResetScreenAndTextWindows = 0x4BF3, RunMainMenu = 0x55D1, RunMatchFormatSelect = 0x5CF3;
const CheckStorySlot = 0x4D64, SaveStorySlotWithTimer = 0x4D10, ReadExhibitionSaveBlock = 0x4FEA;
const WriteExhibitionSaveBlock = 0x4FAE, TestStorySlotFlagA = 0x4D10;
const GenerateUniqueStorySaveSignature = 0x4364, InitStoryModeState = 0x421C;
const ApplyPendingExpAwards = 0x6AFD, ShowMatchResultsScreen = 0x400E, RunNewGameSetup = 0x61BA;
const RunExhibitionCharSelectScreen = 0x4E65;
const RunPlayAlonePartnerMenu = 0x5192, ComputeUnlockedCourtFlags = 0x69A0, LoadCourtSelectGraphics = 0x5D11;
const StubNop_3e = 0x69D4, RunCourtSelect9Menu = 0x6518, RunCourtSelect4Menu = 0x5B99;
// this bank's routines of src/story/modeflow_10.asm (not ported here)
const MatchSelectRunMatch = 0x55B6, GetStoryContinueDestination = 0x5752, CopyExhibitionCharSlotIds = 0x56FC;
// data of this bank
const DevelopmentActors_10 = 0x4CD9, DevelopmentRespawnActorList_10 = 0x4CE3;
const MatchTypeSettingsTable0 = 0x4F08, MatchTypeSettingsTable1 = 0x4F0B, MatchSelectHandlersB_10 = 0x4FC6;
const MatchSelectHandlersBHandler0 = 0x4FD8, MatchSelectHandlersBHandler3 = 0x50FE;
// constants
const BGM_NONE = 0x00;
const MATCHABORT_POINT = 0x01, MATCHABORT_MATCH = 0x80;
const MENUSLIDE_BACK = 0x00, MENUSLIDE_FORWARD = 0x01;
const GAMEMODE_NONE = 0x00, GAMEMODE_EXHIBITION = 0x04;
const STORYSLOT_NONE = 0x03, STORYLOC_DORM_ROOM = 0x0A;
const FLAG_DEBUG_SKIP_LOCATION_EXIT = 21, FLAG_ISLAND_SKY_SCENE_ACTIVE = 79;
const Text_30_1 = 0x0001, Text_31_128 = 0x0480, Text_31_131 = 0x0483;
const MENU_BACK = 0xFF;                                 // what the menus return for B
const FADE_SPEED = 16;

// ---- the water-sprite mini-game's point hooks (WaterSpriteModeHooks_10, unused) ----
// Unused_10_WaterSpriteHook_BallHit (10:4BEB): from the second hit of a rally, give up the point and count it
export function unusedWaterSpriteHookBallHit(P) {
  if (P.V.rallyLength < 2) return;
  P.V.matchAbortFlag = MATCHABORT_POINT;
  P.V.totalPointsScoredInCurrentGame = (P.V.totalPointsScoredInCurrentGame + 1) & 0xFF;
}
// Unused_10_WaterSpriteHook_PointEnd (10:4BFD): after an even point count, end the match if the two characters'
// service-ace counts differ
export function unusedWaterSpriteHookPointEnd(P) {
  if (P.V.totalPointsScoredInCurrentGame & 1) return;
  if (P.V.character1ServiceAces !== P.V.character2ServiceAces) P.V.matchAbortFlag = MATCHABORT_MATCH;
}

// ---- the development map ----
// DevelopmentRespawnActors_10 (10:4CFF) / DevelopmentRespawnActorsAlt_10 (10:4D70): a fade out, the actors of a
// list placed again, a fade in
function* fadeRespawn(P, list) {
  yield* fadeOutAndWait(P, FADE_SPEED);
  respawnActors(P, list);
  yield* fadeInAndWait(P, FADE_SPEED);
}
export const developmentRespawnActors = P => fadeRespawn(P, DevelopmentRespawnActorList_10);
export const developmentRespawnActorsAlt = P => fadeRespawn(P, DevelopmentActors_10);
// Unused_10_DevelopmentMoveActorsAndExit (10:4D18): actors 3, 7, 11 and 16 walk in turn to (1, 1); then back here
export function* unusedDevelopmentMoveActorsAndExit(P) {
  for (const actor of [0x03, 0x07, 0x0B, 0x10]) {
    moveTarget(P, actor, 1.0, 1.0);
    yield* waitMove(P, actor);
  }
  returnHereAfter(P);
}
// a line said by the player in cutscene mode (Unused_10_SpeakCheckedChest 10:4D89, DevelopmentTile01_10 10:4E59;
// DevelopmentFacing01_10 10:4E39 fades in first, without waiting)
function* playerLine(P, text, fade) {
  beginCutscene(P);
  if (fade) fadeIn(P, FADE_SPEED);
  yield* setText(P, text);
  yield* speak(P, ACTOR_PLAYER);
  endCutscene(P);
}
export const unusedSpeakCheckedChest = P => playerLine(P, Text_30_1, false);
export const developmentFacing01 = P => playerLine(P, Text_31_131, true);
export const developmentTile01 = P => playerLine(P, Text_31_128, false);

// ---- the main menu ----
// MainMenuInitScript_10 (10:4EB9): the player out of sight, the title and menu loop; then the music muted or not
// by the story slot's flag A (TestStorySlotFlagA, 02:4D10)
export function* mainMenuInitScript(P) {
  setPosition(P, ACTOR_PLAYER, 63.0, 63.0);
  yield* runTitleAndMainMenuLoop(P);
  setMusicMuted(P, (yield* P.runRom(BANK_STORY_02, TestStorySlotFlagA)).a);
}

// ApplyMatchTypeSettings (10:4ECE): the exhibition's chosen format (wMatchFormatSets/Games/Doubles) as the match's
// settings: sets and games from the two tables, singles or doubles (on-court characters, FLAG_DOUBLES)
export function applyMatchTypeSettings(P) {
  const { V } = P;
  V.matchTypeNumberOfSets = P.rom.u8(BANK, (MatchTypeSettingsTable0 + V.matchFormatSets) & 0xFFFF);
  V.matchTypeNumberOfGames = P.rom.u8(BANK, (MatchTypeSettingsTable1 + V.matchFormatGames) & 0xFFFF);
  V.matchIsDoubles = V.matchFormatDoubles;
  if (V.matchFormatDoubles) {
    V.onCourtCharCount = 4;
    setFlag(P, FLAG_DOUBLES);
  } else {
    V.onCourtCharCount = 2;
    clearFlag(P, FLAG_DOUBLES);
  }
}

// the farcalls to the other parts' screens: (bank, address, registers) -> the registers they return
function* rom(P, bank, addr, regs) { return yield* P.runRom(bank, addr, regs); }
// DisableLCDSafely / LoadMenuFontGfx / ResetScreenAndTextWindows / EnableLCD: the menu screen set up again
function* resetMenuScreen(P, font) {
  disableLCDSafely(P);
  if (font) yield* rom(P, BANK_MENU_FONT, LoadMenuFontGfx);
  yield* rom(P, BANK_SCREEN, ResetScreenAndTextWindows);
  enableLCD(P);
}
// the flags of `add l` reading the handler table (its low byte $C6; the `inc h` after a carry)
function tableFlags(index) {
  const lo = (index * 2) & 0xFF, sum = lo + (MatchSelectHandlersB_10 & 0xFF);
  if (sum > 0xFF) return FH | FC;                       // inc h ($4F -> $50): half carry, carry kept
  return ((sum & 0xFF) ? 0 : FZ) | (((lo & 0xF) + (MatchSelectHandlersB_10 & 0xF)) > 0xF ? FH : 0);
}

// RunTitleAndMainMenuLoop (10:4F0D): music off; when coming from power-on (entry point $0A), the intro logo and
// cutscene, then the title screen (again from the intro when it times out); the match settings reset, the main
// menu (back to the title on B); its choice runs a handler of MatchSelectHandlersB_10 (10:4FC6), which comes back
// to one of the loop's points or leaves it (the location exit it requested). from: the label to start at
// ("menuLoop" for RunTitleAndMainMenuLoop.menuLoop, 10:4F7C).
export function* runTitleAndMainMenuLoop(P, from = "start") {
  const { V } = P;
  let at = from;
  for (;;) {
    switch (at) {
      case "start":
        clearFrameTasks(P);
        sound(P, BGM_NONE);
        resumeBGM(P);
        if (V.storyModeEntryPoint !== 0x0A) { at = "newGame"; continue; }
        clearFrameTasks(P);
        sound(P, BGM_NONE);
        resumeBGM(P);
        V.cheatUnlockTriggered = 0;
        // falls through
      case "intro":                                     // .intro (10:4F28)
        yield* rom(P, BANK_INTRO, ShowIntroLogoScreen);
        yield* rom(P, BANK_INTRO, ScrollOutIntroLogo);
        yield* rom(P, BANK_INTRO, RunIntroCutscene);
        // falls through
      case "titleScreen": {                             // .titleScreen (10:4F31)
        const a = (yield* rom(P, BANK_INTRO, RunTitleScreen)).a;
        if (a === 0xFF || a === 0x01) { at = "intro"; continue; }
      }
        // falls through
      case "newGame":                                   // .newGame (10:4F3C)
        yield* rom(P, BANK_MATCH, InitDefaultMatchSettings);
        V.mainMenuCursor = 0; V.savedDataMenuCursor = 0; V.n64TransferMenuCursor = 0; V.subMenuCursor = 0;
        V.matchFormatDoubles = 0; V.matchFormatGames = 0; V.matchFormatSets = 0;
        enableLCD(P);
        yield* fadeOutAndWait(P, 127);
        disableLCDSafely(P);
        V.menuSlideDirection = MENUSLIDE_FORWARD;
        // falls through
      case "redrawMenu":                                // .redrawMenu (10:4F65)
        yield* resetMenuScreen(P, true);
        yield* fadeInAndWait(P, FADE_SPEED);
        // falls through
      case "menuLoop": {                                // .menuLoop (10:4F7C)
        V.unusedMenuCursor = 0; V.savedDataMenuCursor = 0; V.n64TransferMenuCursor = 0; V.subMenuCursor = 0;
        V.matchFormatDoubles = 0; V.matchFormatGames = 0; V.matchFormatSets = 0; V.animatedTileSet = 0;
        V.scrollX = 0; V.scrollY = 0; V.cameraX = 0; V.cameraY = 0;
        V.animatedTilePeriod = 3;
        resumeBGM(P);
        initSerialLink(P);
        const menu = yield* rom(P, BANK_MAIN_MENU, RunMainMenu);
        const choice = menu.a;
        if (choice === MENU_BACK) { at = "titleScreen"; continue; }
        const handler = jumpTableTarget(P, BANK, MatchSelectHandlersB_10, choice);   // jp hl
        if (handler === MatchSelectHandlersBHandler0) at = yield* matchSelectStorySlot(P, choice);
        else if (handler === MatchSelectHandlersBHandler3) at = yield* matchSelectExhibition(P);
        else {                                          // modeflow_10's handlers (the ROM's): they end the loop
          yield* rom(P, BANK, handler, { ...menu, a: handler & 0xFF, f: tableFlags(choice), e: choice, hl: handler });
          return;
        }
        if (!at) return;
        continue;
      }
      default: throw new Error(`RunTitleAndMainMenuLoop: no label ${at}`);
    }
  }
}

// MatchSelectHandlersBHandler0 (10:4FD8): a story slot chosen (e: the menu's choice, the slot in bits 0-6). A new slot: the new
// game's setup (.backToTitle); a saved one: the experience awards it has pending, the results of a match quit with
// save, then the slot's story continues (the location exit for it), unless B in the partner menu. Returns the loop's
// label to go on at, or null when the loop ends.
function* matchSelectStorySlot(P, e) {
  const { V } = P;
  if (e === 0xFF) return yield* storySlotBackToTitle(P, e);
  V.currentStorySlot = e & 0x7F;
  const slot = yield* rom(P, BANK_SAVE, CheckStorySlot);
  if (slot.a === 0xFE) return yield* storySlotBackToTitle(P, slot.e);
  if ((yield* rom(P, BANK_EXP, ApplyPendingExpAwards)).a) {
    yield* resetMenuScreen(P, false);
    if (!V.saveAndQuitRequest) yield* fadeInAndWait(P, FADE_SPEED);
  }
  if (V.saveAndQuitRequest) {                           // .checkMatchResult: the match quit with save
    const result = (yield* rom(P, BANK_EXP, ShowMatchResultsScreen, { c: 0x00 })).a;
    restoreGameTimer(P);
    if (result === MENU_BACK) return "redrawMenu";
    if (result) {
      V.saveAndQuitRequest = 0;
      yield* rom(P, BANK_SAVE, SaveStorySlotWithTimer);
      if (V.keepMatchStatsFlag) {                       // jp MatchSelectRunMatch: the match again
        yield* rom(P, BANK, MatchSelectRunMatch);
        return null;
      }
      restoreReturnPoint(P);                            // .restoreReturnPoint
      saveReturnPoint(P, STORYLOC_DORM_ROOM, 0x01);
      yield* rom(P, BANK_SAVE, SaveStorySlotWithTimer);
      endCutscene(P);
      return null;
    }
    yield* resetMenuScreen(P, false);                   // .resetScreen
    yield* fadeInAndWait(P, FADE_SPEED);
  }
  V.saveAndQuitRequest = 0;                             // .clearMatchState
  V.keepMatchStatsFlag = 0;
  restoreGameTimer(P);
  yield* rom(P, BANK_SAVE, SaveStorySlotWithTimer);
  V.matchSelectSubState = (yield* rom(P, BANK, GetStoryContinueDestination)).a;
  if (V.matchSelectSubState !== 0x04 && (yield* rom(P, BANK_COURT_SELECT, RunPlayAlonePartnerMenu)).a === MENU_BACK) {
    V.menuSlideDirection = MENUSLIDE_BACK;
    return "menuLoop";
  }
  V.matchSelectSubState = (yield* rom(P, BANK, GetStoryContinueDestination)).a;   // .continueStory
  restoreGameTimer(P);
  V.gameMode = GAMEMODE_NONE;
  clearFlag(P, FLAG_ISLAND_SKY_SCENE_ACTIVE);
  saveReturnPoint(P, STORYLOC_DORM_ROOM, 0x01);
  yield* rom(P, BANK_SAVE, SaveStorySlotWithTimer);
  requestExit(P, testFlag(P, FLAG_DEBUG_SKIP_LOCATION_EXIT) ? 0x03 : V.matchSelectSubState);   // (.loadSlot: 3)
  return null;
}
// MatchSelectHandlersBHandler0.backToTitle (10:504A): the new game's setup for slot e (its name entry ...); B there
// goes back to the menu, else the timer reset, the slot saved with a new signature and exit 1 (3 with the debug flag)
function* storySlotBackToTitle(P, e) {
  const { V } = P;
  V.animatedTilePeriod = 3;
  yield* fadeOutAndWait(P, FADE_SPEED);
  V.currentStorySlot = e;
  if ((yield* rom(P, BANK_NEW_GAME, RunNewGameSetup)).a === MENU_BACK) {
    V.menuSlideDirection = MENUSLIDE_BACK;
    yield* resetMenuScreen(P, true);
    fadeIn(P, FADE_SPEED);
    return "menuLoop";
  }
  resetGameTimer(P);                                    // .newStorySlot
  yield* rom(P, BANK_STORY_02, GenerateUniqueStorySaveSignature);
  yield* rom(P, BANK_SAVE, SaveStorySlotWithTimer);
  requestExit(P, testFlag(P, FLAG_DEBUG_SKIP_LOCATION_EXIT) ? 0x03 : 0x01);       // (.exitToLocation3: 3)
  return null;
}

// MatchSelectHandlersBHandler3 (10:50FE): exhibition. The results of a match quit with save first (or that match
// again); then the format, the characters and the court menus (B in each goes back one), the match; the menu after.
// Returns the loop's label to go on at.
function* matchSelectExhibition(P) {
  const { V } = P;
  V.currentStorySlot = STORYSLOT_NONE;
  let at = "noSlot";
  if (!((yield* rom(P, BANK_SAVE, ReadExhibitionSaveBlock)).a & 0x80) && V.saveAndQuitRequest) {
    const result = (yield* rom(P, BANK_EXP, ShowMatchResultsScreen, { c: 0x00 })).a;
    if (result === MENU_BACK) return "redrawMenu";
    if (result && V.keepMatchStatsFlag) at = "optionsFlow";
    else {                                              // .startStory
      yield* resetMenuScreen(P, false);
      yield* fadeInAndWait(P, FADE_SPEED);
    }
  }
  for (;;) {
    switch (at) {
      case "noSlot":                                    // .noSlot (10:5136): a fresh exhibition block
        V.victoryScoreTableAlt = 0;
        V.currentStorySlot = STORYSLOT_NONE;
        yield* rom(P, BANK_STORY_02, InitStoryModeState);
        yield* rom(P, BANK_MATCH, InitDefaultMatchSettings);
        yield* rom(P, BANK_SAVE, WriteExhibitionSaveBlock);
        // falls through
      case "eraseFlow":                                 // .eraseFlow (10:5146): the format
        if ((yield* rom(P, BANK_MAIN_MENU, RunMatchFormatSelect)).a === MENU_BACK) return "menuLoop";
        yield* fadeOutAndWait(P, FADE_SPEED);
        // falls through
      case "savedDataFlow": {                           // .savedDataFlow (10:5154): the characters, then a court
        yield* rom(P, BANK_EXHIB_CHARS, RunExhibitionCharSelectScreen, { b: V.matchFormatDoubles });
        const chars = (yield* rom(P, BANK, CopyExhibitionCharSlotIds)).a;
        clearFrameTasks(P);
        disableLCDSafely(P);
        yield* rom(P, BANK_MENU_FONT, LoadMenuFontGfx);
        yield* rom(P, BANK_SCREEN, ResetScreenAndTextWindows);
        V.linkPartnerCourtMask = 0;
        V.unlockedCourtMask = 0;
        yield* rom(P, BANK_COURT_SELECT, ComputeUnlockedCourtFlags);
        yield* rom(P, BANK_COURT_SELECT, LoadCourtSelectGraphics);
        if (chars === MENU_BACK) {
          enableLCD(P);
          fadeIn(P, FADE_SPEED);
          V.menuSlideDirection = MENUSLIDE_BACK;
          at = "eraseFlow";
          continue;
        }
        V.menuSlideDirection = MENUSLIDE_FORWARD;       // .minigameFlow
        yield* rom(P, BANK_COURT_SELECT, StubNop_3e);
        enableLCD(P);                                   // (.exhibitionFlow without the unlocked courts)
        fadeIn(P, FADE_SPEED);
        const menu = V.unlockedCourtMask ? RunCourtSelect9Menu : RunCourtSelect4Menu;
        const court = (yield* rom(P, BANK_COURT_SELECT, menu)).a;
        if (court === MENU_BACK) {
          V.menuSlideDirection = MENUSLIDE_BACK;
          at = "savedDataFlow";
          continue;
        }
        P.wramBank(WRAM_ACTORS);                        // .linkFlow (wram_bank WRAM_ACTORS, left mapped)
        V.currentlyUsedCourt = court;
        applyMatchTypeSettings(P);
      }
        // falls through
      case "optionsFlow":                               // .optionsFlow (10:51D9): the match
        V.currentStorySlot = STORYSLOT_NONE;
        V.saveAndQuitRequest = 0;
        yield* rom(P, BANK_SAVE, WriteExhibitionSaveBlock);
        V.gameMode = GAMEMODE_EXHIBITION;
        yield* rom(P, BANK_MATCH, RunMatch);
        if (V.saveAndQuitRequest) {
          V.victoryScoreTableAlt = 1;
          yield* rom(P, BANK_SAVE, WriteExhibitionSaveBlock);
        }
        V.menuSlideDirection = MENUSLIDE_FORWARD;       // .done
        yield* resetMenuScreen(P, true);
        fadeIn(P, FADE_SPEED);
        return "menuLoop";
      default: throw new Error(`MatchSelectHandlersBHandler3: no label ${at}`);
    }
  }
}

// a handler entered from the ROM: the handler, then the loop from where it goes on
function* handlerThenLoop(P, handler, ...args) {
  const next = yield* handler(P, ...args);
  if (next) yield* runTitleAndMainMenuLoop(P, next);
}

const nop = hook(() => {});
export const HOOKS = [
  [BANK, 0x4BE8, nop],                                                  // Unused_10_WaterSpriteHook_Frame
  [BANK, 0x4BE9, nop],                                                  // Unused_10_WaterSpriteHook_RallyTick
  [BANK, 0x4BEA, nop],                                                  // Unused_10_WaterSpriteHook_Bounce
  [BANK, 0x4BEB, hook(P => { unusedWaterSpriteHookBallHit(P); })],
  [BANK, 0x4BFC, nop],                                                  // Unused_10_WaterSpriteHook_PointStart
  [BANK, 0x4BFD, hook(P => { unusedWaterSpriteHookPointEnd(P); })],
  scene(BANK, 0x4CFF, developmentRespawnActors),
  scene(BANK, 0x4D18, unusedDevelopmentMoveActorsAndExit),
  scene(BANK, 0x4D70, developmentRespawnActorsAlt),
  scene(BANK, 0x4D89, unusedSpeakCheckedChest),
  ...Array.from({ length: 11 }, (_, i) => [BANK, 0x4D9B + i, nop]),     // Unused_10_StubNop0 .. StubNop10
  [BANK, 0x4DA6, hook(P => { requestExit(P, 0x0E); })],                 // Unused_10_RequestExitTrigger0e
  scene(BANK, 0x4E39, developmentFacing01),
  scene(BANK, 0x4E59, developmentTile01),
  [BANK, 0x4E6B, nop],                                                  // DevelopmentInitScript_10
  scene(BANK, 0x4EB9, mainMenuInitScript),
  [BANK, 0x4ECE, hook(P => { applyMatchTypeSettings(P); })],
  [BANK, 0x4F0D, hookGen(P => runTitleAndMainMenuLoop(P))],
  [BANK, 0x4F7C, hookGen(P => runTitleAndMainMenuLoop(P, "menuLoop"))],  // RunTitleAndMainMenuLoop.menuLoop
  [BANK, MatchSelectHandlersBHandler0, hookGen((P, cpu) => handlerThenLoop(P, matchSelectStorySlot, cpu.e))],
  [BANK, MatchSelectHandlersBHandler3, hookGen(P => handlerThenLoop(P, matchSelectExhibition))],
];
