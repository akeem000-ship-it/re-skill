// Bank $01: the game's top level (InitAndRunGame), the menu font and palettes, the screen a plain Game Boy shows,
// and bank $01's debug menu and sound test (unused).
//
// The top level. SoftReset (00:2582) ends in `farcall InitAndRunGame`, which never returns:
//   1. clear WRAM banks 1-6 and the sprite buffers, load the menu font, check and repair the save (ValidateSaveRam,
//      RepairAllSaveSlots, the N64-record unlocks), reset the story state and the match settings, LCD on, fade in;
//   2. run the story engine at location STORYLOC_MAIN_MENU, entry point $0A (RunStoryModeOverworld, bank $0A).
//      That "location" is the front end: its script (RunTitleAndMainMenuLoop, bank $10) plays the intro and the
//      title screen, then RunMainMenu, and dispatches the chosen item (a story file into the story overworld, the
//      exhibition and its match, minigames, link play, saved data, N64 transfer, erase), coming back to the main
//      menu or the title after each; a story file leaves for the story's own locations, all inside the same
//      RunStoryModeOverworld. The game's mode is wGameMode (GAMEMODE_*), its place wStoryModeCurrentLocation.
//   3. only if that ever returned (it does not in the game): bank $01's debug menu: the build stamp, the debug overlay
//      on, and A (which sets SAVEFLAG_DEBUG_TEST_MENU) or START runs the main menu location again.
// Port of src/engine/menus/main_menu/boot_01.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm). Graphics and palettes are read from the ROM.
// Tests: the lockstep from power-on (out/engine/exh1.mtrec, out/port/save1.mtrec, gfx_poweron, story1) runs
// InitAndRunGame; web/tests/port/routines_menus_main.mjs the loaders that do not wait. The debug flows
// (Unused_01_*) and ShowDmgLockoutScreen (a plain Game Boy only) are not reached by any recording.
import { clearMemory16, copyMemoryFast } from "../../home/memory.js";
import { decompressData } from "../../home/decompress.js";
import { beginFadeIn } from "../../home/colorfade.js";
import { validateSaveRam } from "../../save/signature.js";
import { repairAllSaveSlots, applyN64RecordsUnlockFlags, updateUnlockablesSaveBlock } from "../../save/repair.js";
import { setSaveFlag, clearSaveFlag } from "../../save/storyslots.js";
import {
  hook, hookGen, push, pop, callHome, callFar, waitFarCall, advanceFrame, sound, withRomBank, wramBank, queueCopy,
  loadPalettes, HOME, FAR, PADF_A, PADF_START, rLCDC, rBGP, rIF, rIE, TILE_SIZE, vTiles1, vTiles2, vBGMap0,
  wDecompBuffer, wTextTileBuffer,
} from "../common/defs.js";

export const BANK_BOOT = 0x01;
const BANK_SAVE = 0x03;
const SAVEFLAG_DEBUG_TEST_MENU = 0x07E0;
const STORYLOC_MAIN_MENU = 0x00, STORYLOC_TEST = 0x03, MAIN_MENU_ENTRY_POINT = 0x0A;
const WRAMX_BASE = 0xD000, WRAMX_BLOCKS = 0;                // ClearMemory16's c = 0: 256 blocks, all 4 KB
const SHADOW_OAM = 0xC000, SHADOW_OAM_BLOCKS = 160 / 16;
const BuildStamp = 0x0153, BUILD_STAMP_CELL = 0x0511;       // printed at (5, 17)
const DEBUG_OVERLAY_ON = 0x03;
// graphics of bank $01
const MenuWindowTiles_01 = 0x4210, MenuFontTiles_01 = 0x4410, MenuTilesBStagedTiles0 = 0x4610;
const MenuTilesBStagedTiles1 = 0x4810, MenuFontFillTiles_01 = 0x4A10, MenuFontPalettes_01 = 0x5010;
const DebugMenuPalettes_01 = 0x50F6, DmgLockoutTilesLZ_01 = 0x607C, DmgLockoutTilemapLZ_01 = 0x6903;
const PALETTES_IN_VRAM = 0x8000 + 0x7C * TILE_SIZE + 8;     // (the "palettes" LoadMenuObjPalettes3To7 copies: tile data)
// routines of other banks the debug flows call
const RunStoryModeOverworld = FAR.RunStoryModeOverworld;
const DEBUG = {
  RunSoundTest: [0x01, 0x6A5B], RunDebugTestMatch: [0x07, 0x5DF9], StubNop: [0x3B, 0x44A9], RunMatch: [0x08, 0x4190],
  CheckStorySlot: [0x03, 0x4D64], ShowTournamentBracket: [0x3B, 0x775D], RunMatchWinLoseScreen: [0x16, 0x4477],
  ShowEquipmentStatusScreen: [0x3E, 0x5388], RunMatchStatsScreen: [0x16, 0x5C35], ShowLinkErrorScreen: [0x3E, 0x4AA7],
  ShowLinkMessageScreen: [0x3E, 0x49E6], RunShoesSelectScreen: [0x3E, 0x5645], RunRacketSelectScreen: [0x3E, 0x54BD],
  RunDebugCharViewer: [0x1A, 0x67D4], RunIntroCutscene: [0x6B, 0x402A], RunTitleScreen: [0x6B, 0x75AF],
};

// ---- the top level ----
// InitAndRunGame (01:4018): see the header. Never returns.
export function* initAndRunGame(P) {
  callHome(P, HOME.InitSerialLink);
  push(P, 0);                                                // push de
  withRomBank(P, BANK_SAVE, () => clearSaveFlag(P, SAVEFLAG_DEBUG_TEST_MENU));
  pop(P);
  callHome(P, HOME.DisableLCDSafely);
  for (let bank = 1; bank <= 6; bank++) {                    // WRAM banks 1-6, all 4 KB of each
    wramBank(P, bank);
    clearMemory16(P, WRAMX_BASE, WRAMX_BLOCKS);
  }
  clearMemory16(P, SHADOW_OAM, SHADOW_OAM_BLOCKS);
  callHome(P, HOME.ClearDebugTextBuffer);
  loadMenuFontGfx(P);
  loadMenuObjPalettes3To7(P);
  withRomBank(P, BANK_SAVE, () => {
    validateSaveRam(P);
    repairAllSaveSlots(P);
    applyN64RecordsUnlockFlags(P);
    updateUnlockablesSaveBlock(P);
  });
  callFar(P, FAR.InitStoryModeState);
  callFar(P, FAR.InitDefaultMatchSettings);
  callHome(P, HOME.EnableLCD);
  beginFadeIn(P, 127);
  yield* runFrontEnd(P);
}
// InitAndRunGame.loop (01:40A5): the main-menu location of the story engine, then (should it return) the debug menu
function* runFrontEnd(P) {
  const { V } = P;
  V.storyModeCurrentLocation = STORYLOC_MAIN_MENU;
  V.storyModeEntryPoint = MAIN_MENU_ENTRY_POINT;
  yield* waitFarCall(P, RunStoryModeOverworld);
  for (;;) {                                                 // .loopB: bank $01's debug menu
    callHome(P, HOME.PrintString, { hl: BuildStamp, de: BUILD_STAMP_CELL });
    V.debugStepMode = DEBUG_OVERLAY_ON;
    for (;;) {
      const input = V.inputPressed;
      if (input & PADF_A) {
        push(P, 0);
        withRomBank(P, BANK_SAVE, () => setSaveFlag(P, SAVEFLAG_DEBUG_TEST_MENU));
        pop(P);
        break;
      }
      if (input & PADF_START) break;
      yield* advanceFrame(P);
    }
    V.debugStepMode = 0;
    V.storyModeCurrentLocation = STORYLOC_MAIN_MENU;
    V.storyModeEntryPoint = MAIN_MENU_ENTRY_POINT;
    yield* waitFarCall(P, RunStoryModeOverworld);
  }
}

// ---- bank $01's debug menu (unused) ----
// Unused_01_MenuRedraw (01:40EC): the build stamp and the debug overlay; then each frame the pad picks a test:
// START the main menu, SELECT the sound test, A the debug test match, B matches for ever, UP a run of match results
// with a set line-up, LEFT the debug character viewer (via the screens of Unused_01_MatchSetup), DOWN the intro and
// title for ever, RIGHT the test map; nothing: next frame.
const PADB = { A: 0x01, B: 0x02, SELECT: 0x04, START: 0x08, RIGHT: 0x10, LEFT: 0x20, UP: 0x40, DOWN: 0x80 };
export function* unusedMenuRedraw(P) {
  callHome(P, HOME.PrintString, { hl: BuildStamp, de: BUILD_STAMP_CELL });
  P.V.debugStepMode = DEBUG_OVERLAY_ON;
  yield* debugMenuLoop(P);
}
function* debugMenuLoop(P) {
  const { V } = P;
  for (;;) {                                                 // .loop (01:40F9)
    const input = V.inputPressed;
    if (input & PADB.START) {
      V.debugStepMode = 1;
      V.storyModeCurrentLocation = STORYLOC_MAIN_MENU;
      V.storyModeEntryPoint = MAIN_MENU_ENTRY_POINT;
      yield* waitFarCall(P, RunStoryModeOverworld);
      return yield* runFrontEnd(P);                          // jp InitAndRunGame.loop
    }
    if (input & PADB.SELECT) yield* waitFarCall(P, DEBUG.RunSoundTest, { a: input });   // (never returns)
    if (input & PADB.A) {
      V.debugStepMode = 1;
      for (;;) yield* waitFarCall(P, DEBUG.RunDebugTestMatch);
    }
    if (input & PADB.B) {
      V.debugStepMode = 1;
      for (;;) { yield* waitFarCall(P, DEBUG.StubNop); yield* waitFarCall(P, DEBUG.RunMatch); }
    }
    if (input & PADB.UP) return yield* debugMatchResults(P);
    if (yield* debugRest(P, input)) continue;
  }
}
// .bit6Clear (01:41C2) on: DOWN the intro and title for ever, else RIGHT the test map (and its returned a), then
// LEFT the character viewer and AdvanceFrame for ever, or nothing: a frame and the menu loop again (returns true).
function* debugRest(P, a) {
  const { V } = P;
  if (a & PADB.DOWN) {
    V.debugStepMode = 1;
    V.debugStepMode = 0;
    for (;;) { yield* waitFarCall(P, DEBUG.RunIntroCutscene); yield* waitFarCall(P, DEBUG.RunTitleScreen); }
  }
  if (a & PADB.RIGHT) {                                      // .positive
    V.debugStepMode = 1;
    V.storyModeCurrentLocation = STORYLOC_TEST;
    V.storyModeEntryPoint = MAIN_MENU_ENTRY_POINT;
    V.storyModeMainCharacterOverworldSprite = 0;
    a = (yield* waitFarCall(P, RunStoryModeOverworld)).a;
  }
  if (a & PADB.LEFT) {
    V.debugStepMode = 1;
    yield* waitFarCall(P, DEBUG.RunDebugCharViewer);
    V.debugStepMode = 0;
    for (;;) yield* advanceFrame(P);
  }
  yield* advanceFrame(P);
  return true;
}
// .bit1Clear's UP (01:413D): file 0's results run for ever: two tournament brackets, then match results with
// Luigi and DK against Baby Mario and Mario in doubles, the round counter going up each time.
function* debugMatchResults(P) {
  const { V, bus, A } = P;
  V.debugStepMode = 1;
  V.currentStorySlot = 0;
  yield* waitFarCall(P, DEBUG.CheckStorySlot);
  yield* waitFarCall(P, DEBUG.ShowTournamentBracket, { b: 0, c: 4 });
  yield* waitFarCall(P, DEBUG.ShowTournamentBracket, { b: 1, c: 2 });
  bus.w8(A.currentMinigameStoryMatch, 0x01);                 // MINIGAME_SERVICE_MATCH_2
  bus.w8(A.currentMinigameStoryMatch + 1, 0x11);
  V.matchWinLoseFlag = 1;                                    // WINLOSE_WIN
  V.currentStorySlot = 0;
  yield* waitFarCall(P, DEBUG.CheckStorySlot);
  V.player1CurrentMainCharacter = 0x17; V.player1CurrentPartnerCharacter = 0x18;    // Luigi, DK
  V.player2CurrentMainCharacter = 0x19; V.player2CurrentPartnerCharacter = 0x1A;    // Baby Mario, Mario
  V.animatedTilePeriod = 3;
  callHome(P, HOME.SetGameFlagByNumber, { de: 47 });          // FLAG_DOUBLES
  bus.w8(A.currentMinigameStoryMatch + 1, 0);
  for (;;) {
    yield* waitFarCall(P, DEBUG.RunMatchWinLoseScreen);
    bus.w8(A.currentMinigameStoryMatch + 1, bus.u8(A.currentMinigameStoryMatch + 1) + 1);
  }
}
// Unused_01_MatchSetup (01:419E): a run of screens (equipment status, match stats, link error, link message,
// shoes and racket select, the character viewer) in exhibition mode, then on as .bit6Clear with the viewer's a.
export function* unusedMatchSetup(P) {
  yield* waitFarCall(P, DEBUG.ShowEquipmentStatusScreen);
  callHome(P, HOME.ClearGameFlagByNumber, { de: 47 });
  P.V.gameMode = 0x04;                                       // GAMEMODE_EXHIBITION
  for (const s of ["RunMatchStatsScreen", "ShowLinkErrorScreen", "ShowLinkMessageScreen", "RunShoesSelectScreen", "RunRacketSelectScreen"])
    yield* waitFarCall(P, DEBUG[s]);
  P.V.debugStepMode = 1;
  const r = yield* waitFarCall(P, DEBUG.RunDebugCharViewer);
  if (yield* debugRest(P, r.a)) yield* debugMenuLoop(P);
}
// Unused_01 (01:41D6): jp InitAndRunGame.loop
export function* unused01(P) { yield* runFrontEnd(P); }

// ---- the menu font and palettes ----
// LoadMenuFontPalette (01:5050): BG palette 0. Registers kept.
export function loadMenuFontPalette(P) { loadPalettes(P, MenuFontPalettes_01, 0, 1); }
// LoadMenuTilesA (01:5062): the window frame tiles to $9000. Registers kept.
export function loadMenuTilesA(P) { queueCopy(P, MenuWindowTiles_01, vTiles2, 16); }
// LoadMenuTilesB (01:5076): the font to $9200 and its fill tiles to $8800 (96 tiles each). Registers kept.
export function loadMenuTilesB(P) {
  queueCopy(P, MenuFontTiles_01, vTiles2 + 0x20 * TILE_SIZE, 96);
  queueCopy(P, MenuFontFillTiles_01, vTiles1, 96);
}
// LoadMenuTilesBStaged (01:5095): the font a third at a time, a frame each, then (as tiles: $8E00) the font
// palettes. Registers kept.
export function* loadMenuTilesBStaged(P) {
  for (let i = 0; i < 4; i++) push(P, 0);                    // push af / bc / de / hl
  queueCopy(P, MenuFontTiles_01, vTiles2 + 0x20 * TILE_SIZE, (MenuTilesBStagedTiles0 - MenuFontTiles_01) / 16);
  yield* advanceFrame(P);
  queueCopy(P, MenuTilesBStagedTiles0, vTiles2 + 0x40 * TILE_SIZE, (MenuTilesBStagedTiles1 - MenuTilesBStagedTiles0) / 16);
  yield* advanceFrame(P);
  queueCopy(P, MenuTilesBStagedTiles1, vTiles2 + 0x60 * TILE_SIZE, (MenuFontFillTiles_01 - MenuTilesBStagedTiles1) / 16);
  yield* advanceFrame(P);
  queueCopy(P, MenuFontPalettes_01, vTiles1 + 0x60 * TILE_SIZE, 32);
  yield* advanceFrame(P);
  for (let i = 0; i < 4; i++) pop(P);
}
// Unused_01_LoadMenuTilesBChunk2 (01:50D6): the font's second third. Returns QueueVRAMCopy's registers.
export const unusedLoadMenuTilesBChunk2 = P => queueCopy(P, MenuTilesBStagedTiles0, vTiles2 + 0x40 * TILE_SIZE, (MenuTilesBStagedTiles1 - MenuTilesBStagedTiles0) / 16);
// LoadMenuFontGfx (01:50E2) / LoadMenuFontGfxStaged (01:50EC): palette, window tiles and font
export function loadMenuFontGfx(P) { loadMenuFontPalette(P); loadMenuTilesA(P); loadMenuTilesB(P); }
export function* loadMenuFontGfxStaged(P) {
  loadMenuFontPalette(P); loadMenuTilesA(P);
  push(P, 0); yield* loadMenuTilesBStaged(P); pop(P);
}
// Unused_01_LoadMenuBgPalettes3To7 (01:5176) / LoadMenuObjPalettes3To7 (01:5188): BG / OBJ palettes 3-7 from VRAM
// $87C8 (tile data, as the bank mapped there reads: the ROM points into VRAM). Registers kept.
export function unusedLoadMenuBgPalettes3To7(P) { loadPalettes(P, PALETTES_IN_VRAM, 3, 5); }
export function loadMenuObjPalettes3To7(P) { loadPalettes(P, PALETTES_IN_VRAM, 8 + 3, 5); }
// LoadDebugMenuPalette (01:519A): palette b of DebugMenuPalettes_01 as palette d
export function loadDebugMenuPalette(P, index, slot) {
  const l = (DebugMenuPalettes_01 & 0xFF) + ((index * 8) & 0xFF);
  return loadPalettes(P, ((DebugMenuPalettes_01 >> 8) + (l >> 8)) << 8 | (l & 0xFF), slot, 1);
}

// ShowDmgLockoutScreen (01:6030), on a plain Game Boy: the "Game Boy Color only" screen, for ever.
export function* showDmgLockoutScreen(P) {
  const { bus } = P;
  bus.w8(rLCDC, 0);
  decompressData(P, DmgLockoutTilesLZ_01, wDecompBuffer);
  copyMemoryFast(P, wDecompBuffer, vTiles2, 128);
  copyMemoryFast(P, wTextTileBuffer, vTiles1, 0x800 / 16);
  decompressData(P, DmgLockoutTilemapLZ_01, wDecompBuffer);
  copyMemoryFast(P, wDecompBuffer, vBGMap0, 0x400 / 16);
  bus.w8(rBGP, 0xE4);
  bus.w8(rIF, 0);
  bus.w8(rIE, 0);
  bus.w8(rLCDC, 0xC1);
  P.ei();
  for (;;) yield* advanceFrame(P);
}

// Unused_01_RunSoundTest (01:6A5B): a sound test on the debug overlay, for ever: up / down switch between songs (d,
// 0-$3E, from wPlayer1MainName) and effects (e, 0-$71); left / right step, wrapping; A plays the entry of the
// song or effect table. The "> " cursor marks the line in use.
const SoundTestStrings_01 = 0x6B64, SoundTestString0 = 0x6B6A, SoundTestString1 = 0x6B71, SoundTestString2 = 0x6B73;
const SoundTestSoundsA_01 = 0x6B75, SoundTestSoundsB_01 = 0x6BB4, SONGS_LAST = 0x3E, EFFECTS_LAST = 0x71;
export function* unusedRunSoundTest(P) {
  const { V, bus, A } = P;
  for (let i = 0; i < 4; i++) push(P, 0);
  let d = bus.u8(A.player1MainName), e = bus.u8(A.player1MainName + 1), b = 0;
  push(P, V.debugStepMode << 8);
  V.debugStepMode = DEBUG_OVERLAY_ON;
  callHome(P, HOME.PrintString, { hl: SoundTestStrings_01, de: 0x0D09 });
  callHome(P, HOME.PrintString, { hl: SoundTestString0, de: 0x0D0B });
  const step = (v, last, dir) => { v = (v + dir) & 0xFF; return v === 0xFF ? last : v > last ? 0 : v; };
  for (;;) {
    yield* advanceFrame(P);
    let input = V.inputPressed;
    if (input & 0xC0) b ^= 1;
    if (!b) { if (input & 0x10) d = step(d, SONGS_LAST, 1); else if (input & 0x20) d = step(d, SONGS_LAST, -1); }
    else if (input & 0x10) e = step(e, EFFECTS_LAST, 1); else if (input & 0x20) e = step(e, EFFECTS_LAST, -1);
    callHome(P, HOME.PrintString, { hl: SoundTestString1, de: b ? 0x0C0B : 0x0C09 });
    callHome(P, HOME.PrintString, { hl: SoundTestString2, de: b ? 0x0C09 : 0x0C0B });
    callHome(P, HOME.PrintDecimalByte, { a: d, de: 0x0E0A });
    callHome(P, HOME.PrintDecimalByte, { a: e, de: 0x0E0C });
    input = V.inputPressed;
    if (input & PADF_A) {
      const [table, index] = b & 1 ? [SoundTestSoundsB_01, e] : [SoundTestSoundsA_01, d];
      const l = (table & 0xFF) + index;
      sound(P, bus.u8(((table >> 8) + (l >> 8)) << 8 | (l & 0xFF)));
    }
  }
}

export const HOOKS = [
  [BANK_BOOT, 0x4018, hookGen(P => initAndRunGame(P))],
  [BANK_BOOT, 0x40EC, hookGen(P => unusedMenuRedraw(P))],
  [BANK_BOOT, 0x419E, hookGen(P => unusedMatchSetup(P))],
  [BANK_BOOT, 0x41D6, hookGen(P => unused01(P))],
  [BANK_BOOT, 0x5050, hook(P => { loadMenuFontPalette(P); })],
  [BANK_BOOT, 0x5062, hook(P => { loadMenuTilesA(P); })],
  [BANK_BOOT, 0x5076, hook(P => { loadMenuTilesB(P); })],
  [BANK_BOOT, 0x5095, hookGen(P => loadMenuTilesBStaged(P))],
  [BANK_BOOT, 0x50D6, hook(P => unusedLoadMenuTilesBChunk2(P))],
  [BANK_BOOT, 0x50E2, hook(P => { loadMenuFontGfx(P); })],
  [BANK_BOOT, 0x50EC, hookGen(P => loadMenuFontGfxStaged(P))],
  [BANK_BOOT, 0x5176, hook(P => { unusedLoadMenuBgPalettes3To7(P); })],
  [BANK_BOOT, 0x5188, hook(P => { loadMenuObjPalettes3To7(P); })],
  [BANK_BOOT, 0x519A, hook((P, c) => loadDebugMenuPalette(P, c.b, c.d))],
  [BANK_BOOT, 0x6030, hookGen(P => showDmgLockoutScreen(P))],
  [BANK_BOOT, 0x6A5B, hookGen(P => unusedRunSoundTest(P))],
];
