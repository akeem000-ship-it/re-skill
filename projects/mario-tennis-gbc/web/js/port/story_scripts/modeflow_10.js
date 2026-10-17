// Bank $10's main-menu flows ($5216-$56E8): the minigame mode (a minigame, its level, its rules, the drill, again
// while a level is won), the link match, the saved data (a slot's character data, progress, trophies and
// equipment; the saved results; the N64 transfer records), the tennis dictionary, the erase menu (a slot, the
// exhibition block, all of the save RAM) and the match a slot left off at (its location's return entry after).
// Each flow ends back at the main menu's loop (RunTitleAndMainMenuLoop.menuLoop, devmap_10.js). The erase
// menu's handler table is data (read from the ROM).
// Port of src/story/modeflow_10.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/engine/rec1.mtrec, rec2.mtrec (the main menu), out/port/ss2_talk_matchselect*.mtrec,
// ss2_matchsel_*.mtrec (scripted: the match-select map's handlers).
import {
  FLAG_DOUBLES, clearFlag, disableLCDSafely, enableLCD, fadeIn, fadeOutAndWait, goToLocation, hookGen, requestExit,
  saveReturnPoint, scene, testFlag, waitFadeEnd,
} from "./common.js";
import { getRegs, setRegs } from "../home/cpu.js";
import { initSerialLink } from "../home/link.js";
import { runTitleAndMainMenuLoop } from "./devmap_10.js";
import { runTrainingDrill } from "./coach_walks_15.js";
import { getMinigameDrillId, confirmDiscardSuspendedExhibMatch } from "./restaurant_10.js";

const BANK = 0x10;
const MENU_BACK = 0xFF, FADE_SPEED = 16;
const MENUSLIDE_BACK = 0x00, MENUSLIDE_FORWARD = 0x01;
const STORYSLOT_NONE = 0x03, NUM_STORY_SLOTS = 3, SOURCE_SAVED_DATA = 0x03;
const WINLOSE_WIN = 0x01, GAMEMODE_EXHIBITION = 0x04;
const FLAG_DEBUG_SKIP_LOCATION_EXIT = 0x15, FLAG_ISLAND_SKY_SCENE_ACTIVE = 0x4F;
const STORYLOC_MAIN_MENU = 0x00, STORYLOC_COURTYARD = 0x07, STORYLOC_JUNIOR_CLASS_COURT_SINGLES = 0x0B;
const STORYLOC_JUNIOR_CLASS_COURT_DOUBLES = 0x0C, STORYLOC_SENIOR_CLASS_COURT = 0x10, STORYLOC_TOURNAMENT = 0x19;
const STORYLOC_SPECIAL_COURT = 0x1C;
const DICTIONARY_FROM_MENU = 0x06;
const ERASE_CONFIRM_ALL = 0x00, ERASE_CONFIRM_EXHIB_BLOCK = 0x01;
// data of this bank (read from the ROM)
const EraseSavedDataFlowHandlers_10 = 0x54EC;
const EraseSavedDataFlowHandler0_10 = 0x54F6, EraseSavedDataFlowHandler3_10 = 0x5539;
const EraseSavedDataFlowHandler4_10 = 0x5565;
// routines of other banks (run as the ROM's, or the JS another part hooked there)
const RunMinigameSelect = [0x3B, 0x61F0], RunMinigameLevelSelect = [0x1B, 0x6B9C], ShowRulesScreen = [0x17, 0x6F1B];
const LoadMenuFontGfx = [0x01, 0x50E2], ResetScreenAndTextWindows = [0x39, 0x4BF3];
const InitStoryModeState = [0x02, 0x421C], InitDefaultMatchSettings = [0x08, 0x4070];
const RunLinkMatchSequence = [0x38, 0x7408];
const RunSavedDataSourceSelect = [0x3B, 0x67A1], CheckStorySlot = [0x03, 0x4D64];
const RunN64TransferItemSelect = [0x3B, 0x74BF], ShowCharDataScreen = [0x1D, 0x4016];
const ShowGameProgressScreen = [0x1E, 0x7263], RunTrophiesScreen = [0x3B, 0x4963];
const RunRacketShoesChoiceMenu = [0x3E, 0x4EA0], RunRacketSelectScreen = [0x3E, 0x54BD];
const RunShoesSelectScreen = [0x3E, 0x5645], ShowEquipmentStatusScreen = [0x3E, 0x5388], SaveStorySlot = [0x03, 0x4D08];
const RunSavedDataTypeSelect = [0x1B, 0x715D], RunMarioCastExhibResults = [0x3B, 0x79F9];
const ShowMinigameDataScreen = [0x1B, 0x73DD], RunN64RecordTypeSelect = [0x3B, 0x71B0];
const RunN64TnmtData = [0x3B, 0x4CFA], RunN64ExhibData = [0x3B, 0x44AA], RunN64RingShotData = [0x3B, 0x5148];
const TennisDictionaryScreen = [0x3F, 0x407A];
const RunEraseSavedDataSelect = [0x3B, 0x6C7F], RunCharDataConfirmScreen = [0x1A, 0x7945];
const EraseStorySlotSaveData = [0x03, 0x4E13], RunEraseDataConfirmMenu = [0x3E, 0x4C12];
const ClearSaveBlock11 = [0x03, 0x4FFE], ReinitSaveRamPreservingBlock6 = [0x03, 0x4F7D];
const RunMatch = [0x08, 0x4190], SaveStorySlotWithTimer = [0x03, 0x4D10];

// jp RunTitleAndMainMenuLoop.menuLoop: the main menu again
const menuLoop = P => runTitleAndMainMenuLoop(P, "menuLoop");
// the menu screen back after a screen of its own: the menu font and the text windows (LCD off), faded in
function* redrawMenu(P) {
  disableLCDSafely(P);
  yield* P.runRom(...LoadMenuFontGfx);
  yield* P.runRom(...ResetScreenAndTextWindows);
  enableLCD(P);
  fadeIn(P, FADE_SPEED);
}
// the same, the menus then sliding back
function* redrawMenuBack(P) {
  yield* redrawMenu(P);
  P.V.menuSlideDirection = MENUSLIDE_BACK;
}
const fadeOut = P => fadeOutAndWait(P, FADE_SPEED);

// RunMinigameModeFlow (10:5216): the minigame menu (B: the main menu); its level menu (no story slot; B: the
// minigame menu); the rules screen (minigame * 3 + level; B: the level menu again); the minigame's drill, then the
// level menu again when a new level opened or the drill was won, else the main menu
export function* runMinigameModeFlow(P) {
  const { V } = P;
  for (;;) {
    V.keepMatchStatsFlag = 0;
    if ((yield* P.runRom(...RunMinigameSelect)).a === MENU_BACK) {
      V.menuSlideDirection = MENUSLIDE_BACK;
      return yield* menuLoop(P);
    }
    for (;;) {                                            // .levelMenu
      V.currentStorySlot = STORYSLOT_NONE;
      const level = (yield* P.runRom(...RunMinigameLevelSelect, { a: V.selectedMinigame, c: V.selectedMinigame })).a;
      if (level === MENU_BACK) { V.menuSlideDirection = MENUSLIDE_BACK; break; }
      V.minigameLevel = level;                            // .startMinigame
      const sel = V.selectedMinigame, c = (sel * 3) & 0xFF;
      if ((yield* P.runRom(...ShowRulesScreen, { a: (V.minigameLevel + c) & 0xFF, b: sel, c })).a === MENU_BACK) {
        yield* redrawMenuBack(P);
        continue;
      }
      const drill = getMinigameDrillId(P, V.selectedMinigame);   // .done
      yield* runTrainingDrill(P, drill.a);
      V.menuSlideDirection = MENUSLIDE_FORWARD;
      yield* redrawMenu(P);
      yield* waitFadeEnd(P);
      if (V.matchSelectNewLevelRequest || V.pointWinLoseFlag === WINLOSE_WIN) continue;
      return yield* menuLoop(P);
    }
  }
}
// MatchSelectHandlersBHandler5 (10:52A0): the link match: no story slot, the story state and match settings reset,
// the link sequence; the serial link reset after it; then the main menu (redrawn unless backed out of)
export function* matchSelectLinkMatch(P) {
  P.V.currentStorySlot = STORYSLOT_NONE;
  yield* P.runRom(...InitStoryModeState);
  yield* P.runRom(...InitDefaultMatchSettings);
  const r = yield* P.runRom(...RunLinkMatchSequence);
  initSerialLink(P);
  if (r.a !== MENU_BACK) {
    P.V.menuSlideDirection = MENUSLIDE_FORWARD;
    yield* redrawMenu(P);
  }
  return yield* menuLoop(P);
}
// RunSavedDataMenuFlow (10:52D1): the saved data's source (B: the main menu): a story slot (its data: the
// character data, the game's progress, the trophies, the racket / shoes with the equipment status and the slot
// saved), the saved results (the Mario-cast exhibition results, the minigame data), or the N64 transfer records
// (tournament, exhibition, ring shot); each screen faded out to and the menu redrawn after
export function* runSavedDataMenuFlow(P) {
  const { V } = P;
  let at = "source", source = 0;
  for (;;) {
    switch (at) {
      case "source": {
        source = (yield* P.runRom(...RunSavedDataSourceSelect)).a;
        if (source === MENU_BACK) return yield* menuLoop(P);
        if (source >= NUM_STORY_SLOTS) { at = "checkSavedData"; continue; }
        V.currentStorySlot = source;
        yield* P.runRom(...CheckStorySlot);
        at = "transferMenu";
        continue;
      }
      case "transferMenu": {
        const item = (yield* P.runRom(...RunN64TransferItemSelect)).a;
        if (item === MENU_BACK) { at = "source"; continue; }
        if (item === 0x00) {
          yield* fadeOut(P);
          yield* P.runRom(...ShowCharDataScreen, { a: 0x00 });
        } else if (item === 0x01) {                       // .transferOption1
          yield* fadeOut(P);
          yield* P.runRom(...ShowGameProgressScreen);
          yield* fadeOut(P);
        } else if (item === 0x02) {                       // .transferOption2
          yield* fadeOut(P);
          yield* P.runRom(...RunTrophiesScreen);
        } else { at = "equipmentMenu"; continue; }
        yield* redrawMenuBack(P);
        continue;
      }
      case "equipmentMenu": {
        const choice = (yield* P.runRom(...RunRacketShoesChoiceMenu)).a;
        if (choice !== 0x00 && choice !== 0x01) { V.menuSlideDirection = MENUSLIDE_BACK; at = "transferMenu"; continue; }
        yield* fadeOut(P);                                // .racketSelect / .shoesSelect
        yield* P.runRom(...(choice === 0x00 ? RunRacketSelectScreen : RunShoesSelectScreen));
        yield* P.runRom(...ShowEquipmentStatusScreen);
        yield* P.runRom(...SaveStorySlot);
        yield* redrawMenuBack(P);
        continue;
      }
      case "checkSavedData":
        at = source === SOURCE_SAVED_DATA ? "savedDataMenu" : "n64RecordMenu";
        continue;
      case "savedDataMenu": {
        const kind = (yield* P.runRom(...RunSavedDataTypeSelect)).a;
        if (kind === MENU_BACK) { at = "source"; continue; }
        yield* fadeOut(P);                                // .savedDataOption / .minigameData
        yield* P.runRom(...(kind === 0x00 ? RunMarioCastExhibResults : ShowMinigameDataScreen));
        yield* fadeOut(P);
        yield* redrawMenuBack(P);
        continue;
      }
      case "n64RecordMenu": {
        const kind = (yield* P.runRom(...RunN64RecordTypeSelect)).a;
        if (kind === MENU_BACK) { at = "source"; continue; }
        if (kind === 0x00) {
          yield* fadeOut(P);
          yield* P.runRom(...RunN64TnmtData);
        } else if (kind === 0x01) {                       // .n64RecordOption1
          yield* fadeOut(P);
          yield* P.runRom(...RunN64ExhibData);
        } else yield* P.runRom(...RunN64RingShotData);   // .done (no fade out)
        yield* redrawMenuBack(P);
        source = MENUSLIDE_BACK;                          // (jp .checkSavedData with a = MENUSLIDE_BACK: the N64 menu)
        at = "checkSavedData";
        continue;
      }
    }
  }
}
// MatchSelectHandlersBHandler7 (10:54B0): the tennis dictionary (from the menu), then the main menu
export function* matchSelectDictionary(P) {
  yield* fadeOut(P);
  yield* P.runRom(...TennisDictionaryScreen, { a: DICTIONARY_FROM_MENU });
  yield* redrawMenuBack(P);
  return yield* menuLoop(P);
}
// RunEraseSavedDataFlow (10:54D6): the erase menu (B: the main menu); its choice's handler
// (EraseSavedDataFlowHandlers_10: a slot, the exhibition block, all), then the menu again
export function* runEraseSavedDataFlow(P) {
  for (;;) {
    const r = yield* P.runRom(...RunEraseSavedDataSelect);
    if (r.a === MENU_BACK) return yield* menuLoop(P);
    const at = P.rom.u16(BANK, (EraseSavedDataFlowHandlers_10 + ((r.a * 2) & 0xFF)) & 0xFFFF);
    if (at === EraseSavedDataFlowHandler0_10) yield* eraseStorySlot(P, r.a);
    else if (at === EraseSavedDataFlowHandler3_10) yield* eraseExhibitionBlock(P);
    else if (at === EraseSavedDataFlowHandler4_10) yield* eraseAllSaveData(P);
    else return yield* P.runRom(BANK, at, { ...r, b: r.a });
  }
}
// EraseSavedDataFlowHandler0_10 (10:54F6): story slot b: its character data's confirm screen; confirmed, and no
// exhibition match it plays in kept: the slot erased and the menu cursor back to the top
function* eraseStorySlot(P, b) {
  P.V.currentStorySlot = b;
  const chk = yield* P.runRom(...CheckStorySlot, { b });
  yield* fadeOut(P);
  if (!(yield* P.runRom(...RunCharDataConfirmScreen)).a) {
    setRegs(P.cpu, { bc: chk.bc });                       // (pop bc)
    const keep = yield* confirmDiscardSuspendedExhibMatch(P, getRegs(P.cpu));
    if (!keep.a) {
      P.V.currentStorySlot = keep.b;
      yield* P.runRom(...EraseStorySlotSaveData, { a: 0x00 });
      P.V.mainMenuCursor = 0;
    }
  }
  yield* redrawMenuBack(P);                               // .redrawAfterErase
}
// EraseSavedDataFlowHandler3_10 (10:5539): the exhibition block's confirm menu (b = 1); confirmed: cleared
function* eraseExhibitionBlock(P) {
  yield* fadeOut(P);
  if ((yield* P.runRom(...RunEraseDataConfirmMenu, { b: ERASE_CONFIRM_EXHIB_BLOCK })).a) yield* P.runRom(...ClearSaveBlock11);
  yield* redrawMenuBack(P);                               // .redrawAfterBlockErase
}
// EraseSavedDataFlowHandler4_10 (10:5565): all the data's confirm menu (b = 0); confirmed: the save RAM
// initialized again (block 6 kept) and the minigame choice reset; the menu cursor back to the top
function* eraseAllSaveData(P) {
  yield* fadeOut(P);
  const erase = (yield* P.runRom(...RunEraseDataConfirmMenu, { b: ERASE_CONFIRM_ALL })).a !== 0;
  if (erase) yield* P.runRom(...ReinitSaveRamPreservingBlock6);   // .reinitSram
  yield* redrawMenuBack(P);
  P.V.mainMenuCursor = 0;
  if (erase) P.V.selectedMinigame = 0;
}
// MatchSelectRunMatch (10:55B6): the match; quit with save: the slot saved, back to the main menu (entry 1).
// Exhibition: the sky scene's flag cleared, the return point the main menu (entry 1), the slot saved, exit 2 (3 with
// FLAG_DEBUG_SKIP_LOCATION_EXIT). A story match: back to its place's result entry by the match
// (wCurrentMinigameStoryMatch + 1): the special court ($14 on), the tournament ($0F on; doubles entry $0B), the
// courtyard ($0A on), the senior court (5: entry 9, else $0F), the junior court (singles or doubles; 0: entry 9)
export function* matchSelectRunMatch(P) {
  const { V } = P;
  yield* P.runRom(...RunMatch);
  if (V.saveAndQuitRequest) {
    yield* P.runRom(...SaveStorySlotWithTimer);
    goToLocation(P, STORYLOC_MAIN_MENU, 0x01);
    return;
  }
  if (V.gameMode === GAMEMODE_EXHIBITION) {               // .matchFinished
    clearFlag(P, FLAG_ISLAND_SKY_SCENE_ACTIVE);
    V.keepMatchStatsFlag = 0;
    saveReturnPoint(P, STORYLOC_MAIN_MENU, 0x01);
    yield* P.runRom(...SaveStorySlotWithTimer);
    requestExit(P, testFlag(P, FLAG_DEBUG_SKIP_LOCATION_EXIT) ? 0x03 : 0x02);
    return;
  }
  const match = P.bus.u8(P.A.currentMinigameStoryMatch + 1);   // .chooseReturn
  if (match >= 0x14) goToLocation(P, STORYLOC_SPECIAL_COURT, 0x0A);
  else if (match >= 0x0F) goToLocation(P, STORYLOC_TOURNAMENT, testFlag(P, FLAG_DOUBLES) ? 0x0B : 0x0A);
  else if (match >= 0x0A) goToLocation(P, STORYLOC_COURTYARD, 0x0D);
  else if (match >= 0x05) goToLocation(P, STORYLOC_SENIOR_CLASS_COURT, match === 0x05 ? 0x09 : 0x0F);
  else {
    const court = testFlag(P, FLAG_DOUBLES) ? STORYLOC_JUNIOR_CLASS_COURT_DOUBLES : STORYLOC_JUNIOR_CLASS_COURT_SINGLES;
    goToLocation(P, court, match === 0x00 ? 0x09 : 0x0F);
  }
}

export const HOOKS = [
  scene(BANK, 0x5216, runMinigameModeFlow),
  scene(BANK, 0x52A0, matchSelectLinkMatch),
  scene(BANK, 0x52D1, runSavedDataMenuFlow),
  scene(BANK, 0x54B0, matchSelectDictionary),
  scene(BANK, 0x54D6, runEraseSavedDataFlow),
  [BANK, 0x54F6, hookGen((P, c) => eraseHandler(P, eraseStorySlot, c.b))],
  [BANK, 0x5539, hookGen(P => eraseHandler(P, eraseExhibitionBlock))],
  [BANK, 0x5565, hookGen(P => eraseHandler(P, eraseAllSaveData))],
  scene(BANK, 0x55B6, matchSelectRunMatch),
];
// an erase handler reached at its address (jp hl from the ROM's menu): the handler, then the erase menu again
function* eraseHandler(P, handler, ...args) {
  yield* handler(P, ...args);
  yield* runEraseSavedDataFlow(P);
}
