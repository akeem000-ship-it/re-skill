// The exhibition and link character grid (bank $38): "Select a Character" for singles and doubles, against the CPU
// or over the link cable. A 3 x 2 window onto the grid of characters (pages 0-1: the Mario cast and the created
// characters, 3 and up: the roster); A picks a character for the slot being chosen (1P, partner, opponents), B
// takes the last one back (or leaves), START flips a Mario-cast character's handedness. A Mario-cast character
// picked for a CPU slot opens the CPU difficulty panel (grid_panels.js).
// Port of src/engine/menus/char_select/grid_screen_38.asm (from RunExhibitionCharSelectScreen on), the link screen of
// cpu_submenu_38.asm (RunLinkCharSelectScreen, ProcessLinkSelectCommand) and the link-grid half of name_38.asm
// (MoveLinkCursor*, ..., WaitLinkSelectStartupFrames) of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm); names and addresses are its own. Tables are read from the ROM.
//
// The screen's state (WRAM 3): wCharSelectMode (CHARSELECTMODE_*), wCharSelectSlot (the slot being chosen; 4 when
// all of this player's are done), wCharSelectExitCode (1 all chosen, 2 left with B), wCpuDifficultyPrompt (the panel
// is up), wCharGridPage and the cursor (wMenuCursorX/Y), wCharGridHandedness (0 right, 1 left, 2 not chosen).
// Covered by the lockstep on out/port/cs_singles.mtrec, cs_doubles.mtrec, cs_saved.mtrec, out/engine/exh1.mtrec;
// the link screen is not reachable without a second Game Boy.
import {
  FZ, rd, wr, u8, w8, idx, rom, home, FAR, HOME, WRAM_STAGING, WRAM_SCREEN, WRAM_TEXT, TILEMAP_WIDTH, VRAM_BANK1,
  vTiles0, vTiles1, vTiles2, vBGMap0, wShadowTilemap, wDecompBuffer, PADF_A, PADF_B, PADF_START, PADF_RIGHT,
  PADF_LEFT, PADF_UP, PADF_DOWN, OAM_BANK1, BGM_MENU, SFX_MENU_MOVE, SFX_MENU_SELECT, SFX_MENU_CANCEL, LINKSTATE_MASTER,
  CHARSELECTMODE_LINK_SINGLES_P1, CHARSELECTMODE_LINK_SINGLES_P2, CHARSELECTMODE_LINK_DOUBLES_P1,
  CHARSELECTMODE_LINK_DOUBLES_P2, TILEBLOCK_SharedMenuGfx17Alias17, SharedMenuGfx17_BLOCKS, TILEBLOCK_StatLabelTiles,
  StatLabelTiles_BLOCKS, TILEBLOCK_CharGridGfx1, CharGridGfx1_BLOCKS, TILEBLOCK_CharGridGfx2, CharGridGfx2_BLOCKS,
  TILEBLOCK_DigitFontTiles, DigitFontTiles_BLOCKS, SCREENASSET_ExhibitionSetup, wCharGridEntries_SIZE, sound,
  advanceFrame, fadeIn, fadeOut, beginFadeIn, registerFrameTask, withWram, queueVRAMCopy, queueMapRows, queueSprite,
  loadIndexedPalette, loadCompressedTileBlock, loadScreenAssetRecord, queueWram3MapToVRAM, getMenuCursorIndex,
  setMenuCursorFromIndex, drawSelectedOptionBox, disableLCDSafely, drawTextWindow, romWait, timerInterruptOff,
  timerInterruptOn, resetScrollAndCamera, hook, hookGen,
} from "./defs.js";
import {
  BANK, getGridSlotFromCursor, buildVisiblePageSpriteList, testAndSetGridEntryTaken, advanceToNextPlayerSlot,
  retreatToPreviousPlayerSlot, isMarioCastCharacter, needsCpuDifficultyPrompt, buildCharUnlockFlags,
  buildCreatedCharRecords, resolveSelectedCharIds, initMatchCharsFromSelection, applyHandednessToCharRecords,
  applyCpuDifficultyToCharRecords,
} from "./grid_data.js";
import {
  refreshCharInfoPanel, drawCharGridSlotPrompt, drawCharGridSlotIcons, initCharGridState, drawPlayerSlotPortrait,
  clearPlayerSlotPortrait, loadAllCharPortraitTiles, runCpuDifficultySubmenu,
} from "./grid_panels.js";
import { TickMenuBgScrollTask_38 } from "./character.js";
import { FN, decFlags, cpFlags } from "../equipment/defs.js";
import { SoftResetSignal } from "../../port.js";
import { enableLCD, clearBytes } from "../../home/system.js";
import { clearFrameTasks, printDecimalByte } from "../../home/debugtext.js";
import { decompressData } from "../../home/decompress.js";
import { loadPalettesMasterOnly } from "../../home/palettes.js";
import { queueSpriteTemplate } from "../../home/fade.js";

const CharGridCursorBoxTable = 0x4F63, CharGridScreenTable0 = 0x507F, CharGridScreenGfx1 = 0x50A7;
const CharGridScreenGfx2 = 0x50F1, CharGridScreenGfx3 = 0x50F9, DrawCharGridWaitBanner_SpriteTemplate = 0x54AB;
const CharGridCharSprites = 0x557D;
const CharGridScreenGfx1_BLOCKS = 0x08, CharGridScreenGfx3_BLOCKS = 0x10;
const SLOT_DONE = 4, EXIT_ALL_CHOSEN = 1, EXIT_LEFT = 2;
const HANDEDNESS_LEFT = 1, HANDEDNESS_UNSET = 2;
const GRID_COLUMNS = 3, GRID_ROWS = 2;
const FIRST_ROSTER_PAGE = 3;                             // pages 0-1: Mario cast and created characters; 2: unused
const LINK_SOFT_RESET_INPUT = 0x0F;                      // A+B+SELECT+START from the other side
const LINK_CMD_RESET = 0x20, LINK_CMD_PICK = 0x21, LINK_CMD_NO_CHAR = 0x22, LINK_CMD_CANCEL = 0x23;
const LINK_CMD_DIFFICULTY = 0x24, LINK_CMD_PICK_LEFT_HANDED = 0x28, LINK_CMD_IDLE = 0x29;   // $24-$27: difficulty 1-4
const LINK_STARTUP_FRAMES = 3;
const cell = (base, x, y) => (base + y * TILEMAP_WIDTH + x) & 0xFFFF;
const entryAddr = (P, n) => (P.A.charGridEntries + ((n * 4) & 0xFF)) & 0xFFFF;
const isSecondLinkPlayer = mode => mode === CHARSELECTMODE_LINK_SINGLES_P2 || mode === CHARSELECTMODE_LINK_DOUBLES_P2;

// RunExhibitionCharSelectScreen (38:4E65): the screen for exhibition mode b (singles 0, doubles 1). Returns a = 0
// when all characters are chosen (the match records then set up) or $FF (left with B).
export function* runExhibitionCharSelectScreen(P, mode) {
  sound(P, BGM_MENU);
  P.wramBank(WRAM_SCREEN);
  wr(P, "charSelectMode", mode);
  wr(P, "charGridHandedness", HANDEDNESS_UNSET);
  disableLCDSafely(P);
  rom(P, FAR.LoadMenuFontGfx);
  wr(P, "charSelectRemoteSlot", 0);
  clearBytes(P, P.A.charGridEntries, wCharGridEntries_SIZE);
  buildCharUnlockFlags(P);
  setupCharGridScreen(P);
  enableLCD(P);
  yield* fadeIn(P, 16);
  timerInterruptOff(P);
  registerFrameTask(P, 1, TickMenuBgScrollTask_38);
  refreshCharInfoPanel(P);
  for (;;) {
    yield* advanceFrame(P);
    wr(P, "menuInputPressed", P.V.inputPressed);
    P.wramBank(WRAM_SCREEN);
    printDecimalByte(P, 3, 1, rd(P, "charGridScrollCount"));   // (a debug readout of the right presses)
    const bank = P.V.wramBank;
    if (rd(P, "cpuDifficultyPrompt")) {
      drawCharGridCharSprites(P);
      runCpuDifficultySubmenu(P);
    } else {
      handleCharGridDpad(P);
      handleCharGridButtons(P);
      wr(P, "menuInputPressed", 0);
      P.V.inputPressed = 0;
      P.wramBank(WRAM_SCREEN);
      drawGridSprites(P);
    }
    const exit = rd(P, "charSelectExitCode");
    P.wramBank(bank);
    if (exit === EXIT_ALL_CHOSEN) {
      yield* fadeOut(P, 8);
      resolveSelectedCharIds(P);
      initMatchCharsFromSelection(P);
      applyHandednessToCharRecords(P);
      applyCpuDifficultyToCharRecords(P);
      rom(P, FAR.InitDefaultMatchSettings);
      clearFrameTasks(P);
      timerInterruptOn(P);
      return { a: 0, f: FZ };
    }
    if (exit === EXIT_LEFT) {
      sound(P, SFX_MENU_CANCEL);
      yield* fadeOut(P, 16);
      clearFrameTasks(P);
      timerInterruptOn(P);
      return { a: 0xFF };
    }
  }
}
// the grid's sprites for a frame: the "waiting" banner once this player is done, else the cursor box, the
// characters and the scroll arrows
function drawGridSprites(P) {
  if (rd(P, "charSelectSlot") === SLOT_DONE) { drawCharGridWaitBanner(P); return; }
  drawCharGridCursorBox(P);
  drawCharGridCharSprites(P);
  drawCharGridScrollArrows(P);
}

// DrawCharGridCursorBox (38:4F4B): the selected-option box at the cursor's cell (CharGridCursorBoxTable)
export function drawCharGridCursorBox(P) {
  const at = idx(CharGridCursorBoxTable, getMenuCursorIndex(P, GRID_COLUMNS) * 2);
  drawSelectedOptionBox(P, P.bus.u8(at + 1) << 8 | P.bus.u8(at), 0x1008);
}
// SetupCharGridScreen (38:4F6F): the screen with the LCD off: the created characters, the grid's graphics and
// palettes, the screen asset with two text windows (prompt, info panel), every character's portrait tiles (both VRAM
// banks), the grid state, the slot prompt and icons, the scrolling background
export function setupCharGridScreen(P) {
  resetScrollAndCamera(P);
  buildCreatedCharRecords(P);
  setMenuCursorFromIndex(P, GRID_COLUMNS, 0);
  P.wramBank(WRAM_STAGING);
  decompressData(P, CharGridScreenGfx1, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles0 + 0x10 * 16 + VRAM_BANK1, CharGridScreenGfx1_BLOCKS);
  loadPalettesMasterOnly(P, CharGridScreenGfx2, 8 + 1, 1);
  P.wramBank(WRAM_STAGING);
  decompressData(P, CharGridScreenGfx3, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles0 + 0x20 * 16 + VRAM_BANK1, CharGridScreenGfx3_BLOCKS);
  loadScreenAssetRecord(P, SCREENASSET_ExhibitionSetup);
  rom(P, FAR.ResetTextWindowState);
  P.wramBank(WRAM_TEXT);
  wr(P, "shadowTilemapBank", WRAM_SCREEN);
  wr(P, "windowTileAttr", 0);
  drawTextWindow(P, 0x00, 0x02, 0x14, 0x03);
  drawTextWindow(P, 0x00, 0x0C, 0x14, 0x06);
  loadCompressedTileBlock(P, TILEBLOCK_SharedMenuGfx17Alias17, vTiles2, SharedMenuGfx17_BLOCKS);
  loadCompressedTileBlock(P, TILEBLOCK_StatLabelTiles, vTiles2 + 0x10 * 16, StatLabelTiles_BLOCKS);
  loadCompressedTileBlock(P, TILEBLOCK_CharGridGfx2, vTiles0 + 0x50 * 16 + VRAM_BANK1, CharGridGfx2_BLOCKS);
  loadCompressedTileBlock(P, TILEBLOCK_DigitFontTiles, vTiles0 + 0x64 * 16 + VRAM_BANK1, DigitFontTiles_BLOCKS);
  loadAllCharPortraitTiles(P, vTiles0);
  loadAllCharPortraitTiles(P, vTiles1 + VRAM_BANK1);
  initCharGridState(P);
  drawCharGridSlotPrompt(P);
  drawCharGridSlotIcons(P);
  queueWram3MapToVRAM(P);
  rom(P, FAR.LoadFixedTileBlockAndPalette, { de: vTiles0 + VRAM_BANK1 });
  loadPalettesMasterOnly(P, CharGridScreenTable0, 8 + 3, 5);
  loadIndexedPalette(P, 0x0A, 0x0B);
  rom(P, FAR.InitMenuBgScroll);
  rom(P, FAR.LoadMenuSpritePalettePair, { b: 1, c: 1 });
  wr(P, "menuBgScrollTile", 0x30); wr(P, "menuBgScrollTile", 0x30, 1);
  wr(P, "menuBgScrollAttr", 0x09); wr(P, "menuBgScrollAttr", 0x09, 1);
  loadCompressedTileBlock(P, TILEBLOCK_CharGridGfx1, vTiles0 + 0x30 * 16 + VRAM_BANK1, CharGridGfx1_BLOCKS);
  rom(P, FAR.InitDefaultMatchSettings);
}

// ---- the cursor ----
// HandleCharGridDpad (38:5195): the pad moves the cursor (right counts wCharGridScrollCount); any move makes the
// handedness "not chosen" again. Nothing once this player is done.
export function handleCharGridDpad(P) {
  withWram(P, WRAM_SCREEN, () => {
    if (rd(P, "charSelectSlot") === SLOT_DONE) return;
    const input = P.V.inputPressed;
    if (input & PADF_RIGHT) {
      wr(P, "charGridScrollCount", rd(P, "charGridScrollCount") + 1);
      wr(P, "charGridHandedness", HANDEDNESS_UNSET);
      moveCharGridCursorRight(P);
      wr(P, "menuInputPressed", 0);
    } else if (input & PADF_LEFT) { wr(P, "charGridHandedness", HANDEDNESS_UNSET); moveCharGridCursorLeft(P); }
    else if (input & PADF_UP) { wr(P, "charGridHandedness", HANDEDNESS_UNSET); moveCharGridCursorUp(P); }
    else if (input & PADF_DOWN) { wr(P, "charGridHandedness", HANDEDNESS_UNSET); moveCharGridCursorDown(P); }
  });
}
// MoveCharGridCursorUp (38:51F4): a row up; from the top row, the page before (page 3 for 2; none before 0)
export function moveCharGridCursorUp(P) {
  const y = rd(P, "menuCursorY");
  if (y) { wr(P, "menuCursorY", y - 1); sound(P, SFX_MENU_MOVE); refreshCharInfoPanel(P); return; }
  let page = rd(P, "charGridPage");
  if (!page) return;
  page = (page - 1) & 0xFF;
  if (page === 2) page = FIRST_ROSTER_PAGE; else sound(P, SFX_MENU_MOVE);
  wr(P, "charGridPage", page);
  buildVisiblePageSpriteList(P);
  refreshCharInfoPanel(P);
}
// MoveCharGridCursorDown (38:521C): a row down; from the bottom row, the next page: page 1 only from 0 with 7 or
// more Mario-cast/created characters, none after 1, the roster pages up to the last but one
export function moveCharGridCursorDown(P) {
  const y = (rd(P, "menuCursorY") + 1) & 0xFF;
  if (y !== GRID_ROWS) { wr(P, "menuCursorY", y); sound(P, SFX_MENU_MOVE); refreshCharInfoPanel(P); return; }
  let page = rd(P, "charGridPage"), beep = true;
  if (page < 2) {
    if (page === 1) return;
    if (rd(P, "charGridCreatedCount") < 7) { refreshCharInfoPanel(P); return; }
    page = 1;
    wr(P, "charGridPage", page);
  } else {
    page = (page + 1) & 0xFF;
    const last = (rd(P, "charGridPageCount") - 1) & 0xFF;
    if (page === last) { page = (last - 1) & 0xFF; beep = false; }
  }
  if (beep) sound(P, SFX_MENU_MOVE);
  wr(P, "charGridPage", page);
  buildVisiblePageSpriteList(P);
  refreshCharInfoPanel(P);
}
// MoveCharGridCursorRight (38:525E): a column right; past the last, the first column of the other kind of page
// (from the Mario cast to the first roster page; from the roster back to page 0, remembering the page)
export function moveCharGridCursorRight(P) {
  let x = (rd(P, "menuCursorX") + 1) & 0xFF;
  if (x === GRID_COLUMNS) { switchPageKind(P); x = 0; }
  wr(P, "menuCursorX", x);
  buildVisiblePageSpriteList(P);
  refreshCharInfoPanel(P);
  sound(P, SFX_MENU_MOVE);
}
// MoveCharGridCursorLeft (38:528B): a column left; before the first, the last column of the other kind of page
export function moveCharGridCursorLeft(P) {
  let x = (rd(P, "menuCursorX") - 1) & 0xFF;
  if (x === 0xFF) { switchPageKind(P); buildVisiblePageSpriteList(P); x = 2; }
  wr(P, "menuCursorX", x);
  refreshCharInfoPanel(P);
  sound(P, SFX_MENU_MOVE);
}
function switchPageKind(P) {
  const page = rd(P, "charGridPage");
  if (page < 2) { wr(P, "charGridPage", FIRST_ROSTER_PAGE); return; }
  wr(P, "charGridPrevPage", page);
  wr(P, "charGridPage", 0);
}

// ---- the buttons ----
// HandleCharGridButtons (38:52B9): A picks, B takes back, START flips a Mario-cast character's handedness
export function handleCharGridButtons(P) {
  const input = rd(P, "menuInputPressed");
  if (input & PADF_A) { confirmCharGridSelection(P); return; }
  if (input & 0x02) { cancelCharGridSelection(P); return; }
  if (!(input & PADF_START)) return;
  const id = u8(P, entryAddr(P, getGridSlotFromCursor(P).a));
  if (!isMarioCastCharacter(id).a) return;
  sound(P, SFX_MENU_MOVE);
  const handedness = rd(P, "charGridHandedness");
  wr(P, "charGridHandedness", handedness === HANDEDNESS_UNSET ? HANDEDNESS_LEFT : handedness ^ 1);
  refreshCharInfoPanel(P);
}
// ConfirmCharGridSelection (38:5302): the entry under the cursor for the slot (if free and not empty: the taken
// flag is set either way), left-handed if so chosen, its portrait; then the difficulty panel for a Mario-cast CPU,
// else the next slot (exit code 1 after the last)
export function confirmCharGridSelection(P) {
  withWram(P, WRAM_SCREEN, () => {
    const taken = testAndSetGridEntryTaken(P, rd(P, "charGridPage"), rd(P, "menuCursorX"), rd(P, "menuCursorY"));
    let entry = getGridSlotFromCursor(P).a;
    const id = u8(P, entryAddr(P, entry));
    if (taken || id === 0xFF) { sound(P, SFX_MENU_CANCEL); return; }
    const slot = rd(P, "charSelectSlot");
    w8(P, idx(P.A.charSelectSlotChars, slot), entry);
    if (isMarioCastCharacter(id).a && rd(P, "charGridHandedness") === HANDEDNESS_LEFT) w8(P, idx(P.A.charSelectSlotLeftHanded, slot), 1);
    drawPlayerSlotPortrait(P, getGridSlotFromCursor(P).a);
    sound(P, SFX_MENU_SELECT);
    buildVisiblePageSpriteList(P);
    entry = getGridSlotFromCursor(P).a;
    if (needsCpuDifficultyPrompt(P, u8(P, entryAddr(P, entry))).a) wr(P, "cpuDifficultyPrompt", 1);
    else if (advanceToNextPlayerSlot(P).a === 0xFF) wr(P, "charSelectExitCode", EXIT_ALL_CHOSEN);
    drawCharGridSlotPrompt(P);
    queueMapRows(P, wShadowTilemap, vBGMap0, 2, 2);
  });
}
// CancelCharGridSelection (38:53B0): back to the previous slot, its character, difficulty and handedness cleared
// (exit code 2 before the first slot)
export function cancelCharGridSelection(P) {
  withWram(P, WRAM_SCREEN, () => {
    if (retreatToPreviousPlayerSlot(P).a === 0xFF) { wr(P, "charSelectExitCode", EXIT_LEFT); return; }
    sound(P, SFX_MENU_CANCEL);
    const slot = rd(P, "charSelectSlot"), chars = idx(P.A.charSelectSlotChars, slot), entry = u8(P, chars);
    w8(P, chars, 0);
    w8(P, entryAddr(P, entry) + 2, 0);
    P.wramBank(WRAM_SCREEN);
    w8(P, idx(P.A.charSelectSlotDifficulty, rd(P, "charSelectSlot")), 0);
    w8(P, idx(P.A.charSelectSlotLeftHanded, rd(P, "charSelectSlot")), 0);
    clearPlayerSlotPortrait(P);
    buildVisiblePageSpriteList(P);
    drawCharGridSlotPrompt(P);
    queueMapRows(P, wShadowTilemap, vBGMap0, 2, 2);
  });
}

// ---- the sprites ----
// DrawCharGridWaitBanner (38:549A): the "waiting" banner, waving (ApplySpriteWaveOffset)
export function drawCharGridWaitBanner(P) {
  const r = rom(P, FAR.ApplySpriteWaveOffset, { b: 0x0F, c: 0x20, de: 0x0840 });
  queueSpriteTemplate(P, DrawCharGridWaitBanner_SpriteTemplate, r.d, r.e, r.c, r.b, (P.cpu.sp - 2) & 0xFFFF);
}
// DrawCharGridScrollArrows (38:54CC): the bobbing arrows: left and right always, up on pages 1 and up but 3,
// down where a next page exists (page 0 with 7+ characters, a roster page before the last but one)
export function drawCharGridScrollArrows(P) {
  withWram(P, WRAM_SCREEN, () => {
    if (rd(P, "charSelectSlot") === SLOT_DONE) return;
    const arrow = (routine, de, c, tile) => { const r = rom(P, routine, { de, c }); queueSprite(P, OAM_BANK1 | 7, tile, r.d, r.e); };
    arrow(FAR.ApplySpriteBobOffsetX, 0x0245, 1, 0x10);
    arrow(FAR.ApplySpriteBobOffsetX, 0x5045, 0, 0x12);
    const page = rd(P, "charGridPage");
    if (page !== 0 && page !== FIRST_ROSTER_PAGE) arrow(FAR.ApplySpriteBobOffsetY, 0x2A25, 1, 0x14);
    if (page === 1) return;
    if (page === 0 && rd(P, "charGridCreatedCount") < 7) return;
    if (page === ((rd(P, "charGridPageCount") - 2) & 0xFF)) return;
    arrow(FAR.ApplySpriteBobOffsetY, 0x2A63, 0, 0x16);
  });
}
// DrawCharGridCharSprites (38:5545): the page's 6 characters (wScreenScratch, BuildVisiblePageSpriteList's list)
// at their cells (CharGridCharSprites)
export function drawCharGridCharSprites(P) {
  withWram(P, WRAM_SCREEN, () => {
    for (let c = 0; c < 6; c++) {
      const at = idx(CharGridCharSprites, c * 2), e = P.bus.u8(at), d = P.bus.u8(at + 1);
      const id = u8(P, P.A.screenScratch + 2 * c), palette = u8(P, P.A.screenScratch + 2 * c + 1);
      if (id !== 0xFF) queueCharGridCharSprite(P, id, palette, d << 8 | e);
    }
  });
}
// QueueCharGridCharSprite (38:5589): character b's 16x16 face (tiles 4b, 4b + 2) at de, palette c + 2. All
// registers kept.
export function queueCharGridCharSprite(P, id, palette, de) {
  const attr = (palette + 2) & 0xFF, tile = (id * 4) & 0xFF;
  queueSprite(P, attr, tile, de >> 8, de & 0xFF);
  queueSprite(P, attr, (tile + 2) & 0xFF, ((de >> 8) + 8) & 0xFF, de & 0xFF);
}

// ---- the link screen ----
// RunLinkCharSelectScreen (38:63BD): the grid over the link: each player chooses his own slots (the master 1P's,
// the other 2P's), the other side's choices arrive as commands (ProcessLinkSelectCommand). Returns a = 0 or $FF.
export function* runLinkCharSelectScreen(P) {
  P.V.linkExchangeActive = 0; P.V.unusedLinkSelectByte = 0;
  wr(P, "menuCursor2X", 0); wr(P, "menuCursor2Y", 0); P.V.linkCursorPage = 0;
  home(P, HOME.ResetSerialState);
  home(P, HOME.EnableTimerInterrupt);
  sound(P, BGM_MENU);
  P.wramBank(WRAM_SCREEN);
  wr(P, "charGridHandedness", HANDEDNESS_UNSET);
  const master = P.V.linkState === LINKSTATE_MASTER;
  wr(P, "charSelectMode", rd(P, "matchIsDoubles") ? (master ? CHARSELECTMODE_LINK_DOUBLES_P1 : CHARSELECTMODE_LINK_DOUBLES_P2)
    : (master ? CHARSELECTMODE_LINK_SINGLES_P1 : CHARSELECTMODE_LINK_SINGLES_P2));
  disableLCDSafely(P);
  rom(P, FAR.LoadMenuFontGfx);
  wr(P, "charSelectRemoteSlot", 0);
  wr(P, "linkSelectSlotState", 0xFF);
  const doubles = rd(P, "matchIsDoubles"), sets = rd(P, "matchTypeNumberOfSets"), games = rd(P, "matchTypeNumberOfGames");
  setupCharGridScreen(P);                                  // (its InitDefaultMatchSettings resets the format: kept)
  wr(P, "matchTypeNumberOfGames", games); wr(P, "matchIsDoubles", doubles); wr(P, "matchTypeNumberOfSets", sets);
  enableLCD(P);
  rom(P, FAR.ResyncLinkSession);
  beginFadeIn(P, 16);
  yield* romWait(P, FAR.RunLinkCommandFrame);
  yield* romWait(P, FAR.RunLinkCommandFrame);
  P.V.linkPlayerCount = 0;
  initCharGridState(P);
  P.V.unusedLinkSelectByte = 0;
  wr(P, "menuCursor2X", 0); wr(P, "menuCursor2Y", 0); P.V.linkCursorPage = 0;
  P.V.linkRemoteInputBuf = 0; P.V.linkRemoteInput = 0;
  wr(P, "linkSelectCmdResult", 0); wr(P, "linkSelectStartupFrames", 0);
  registerFrameTask(P, 1, TickMenuBgScrollTask_38);
  P.wramBank(WRAM_SCREEN);
  refreshCharInfoPanel(P);
  for (;;) {
    yield* romWait(P, FAR.RunLinkCommandFrame);
    wr(P, "menuInputPressed", P.V.linkRemoteInputBuf);
    if ((rd(P, "menuInputPressed") ^ LINK_SOFT_RESET_INPUT) === 0) throw new SoftResetSignal();   // JumpSoftReset
    if (!waitLinkSelectStartupFrames(P).a) continue;
    handleCharGridDpad(P);
    rom(P, FAR.HandleLinkGridButtons, { b: 3, c: 2 });
    processLinkSelectCommand(P);
    const exit = withWram(P, WRAM_SCREEN, () => {
      rom(P, FAR.CheckLinkSelectionComplete);
      drawGridSprites(P);
      return rd(P, "charSelectExitCode");
    });
    if (exit === EXIT_ALL_CHOSEN) {
      clearFrameTasks(P);
      processLinkSelectCommand(P);
      sound(P, SFX_MENU_SELECT);
      yield* romWait(P, FAR.SyncLinkFrame);
      P.V.linkExchangeActive = 0;
      home(P, HOME.ResetSerialState);
      home(P, HOME.EnableTimerInterrupt);
      resolveSelectedCharIds(P);
      rom(P, FAR.InitLinkMatchCharsFromSelection);
      applyHandednessToCharRecords(P);
      applyCpuDifficultyToCharRecords(P);
      if (P.V.linkState === LINKSTATE_MASTER) yield* P.runRom(0, HOME.WaitVBlank);
      yield* fadeOut(P, 8);
      timerInterruptOn(P);
      return { a: 0, f: FZ };
    }
    if (exit === EXIT_LEFT) {
      clearFrameTasks(P);
      sound(P, SFX_MENU_CANCEL);
      yield* romWait(P, FAR.SyncLinkFrame);
      P.V.linkExchangeActive = 0;
      home(P, HOME.ResetSerialState);
      yield* fadeOut(P, 16);
      clearFrameTasks(P);
      timerInterruptOn(P);
      return { a: 0xFF };
    }
  }
}
// ProcessLinkSelectCommand (38:6528): the other side's command (hLinkRemoteInput): reset; a pick (also left-
// handed: the mark in the remote player's slot); a cancel; a CPU difficulty 1-4 for its CPU slot; anything else
// is the character id of the next pick
export function processLinkSelectCommand(P) {
  const cmd = P.V.linkRemoteInput;
  if (cmd === LINK_CMD_RESET) throw new SoftResetSignal();
  if (cmd === LINK_CMD_PICK || cmd === LINK_CMD_PICK_LEFT_HANDED) {
    if (rd(P, "charSelectRemoteSlot") === 2) return;
    const char = rd(P, "linkSelectCmdChar");
    if (char === LINK_CMD_NO_CHAR) return;
    if (cmd === LINK_CMD_PICK_LEFT_HANDED && isMarioCastCharacter(char).a) {
      const base = isSecondLinkPlayer(rd(P, "charSelectMode")) ? P.A.charSelectSlotLeftHanded : P.A.charSelectSlotLeftHanded + 2;
      w8(P, idx(base, rd(P, "charSelectRemoteSlot")), 1);
    }
    rom(P, FAR.ApplyRemoteCharSelection, { c: rd(P, "linkSelectCmdChar") });
    return;
  }
  if (cmd === LINK_CMD_CANCEL) { rom(P, FAR.ApplyRemoteCharCancel); return; }
  if (cmd === LINK_CMD_IDLE) return;
  if (cmd >= LINK_CMD_DIFFICULTY && cmd < LINK_CMD_DIFFICULTY + 4) {
    rom(P, FAR.StoreRemoteCpuDifficulty, { c: cmd - LINK_CMD_DIFFICULTY + 1 });
    rom(P, FAR.DrawRemoteSlotPortrait, { c: rd(P, "charSelectRemoteChars", 1) });
    wr(P, "linkSelectCmdResult", 0);
    return;
  }
  wr(P, "linkSelectCmdChar", cmd);
}

// ---- the other player's cursor over the link (name_38.asm) ----
// MoveLinkCursorUp / Down / Right / Left (38:6D0B / 6D25 / 6D58 / 6D77): the remote cursor (wMenuCursor2X/Y,
// hLinkCursorPage) as the local one moves, without sounds or redraws
// Each returns the registers it leaves (a and the flags of its last step; Down's next-page step also b and e).
export function moveLinkCursorUp(P) {
  const y = rd(P, "menuCursor2Y");
  if (y) { wr(P, "menuCursor2Y", y - 1); return { a: y - 1, f: decFlags(y) }; }   // (`or a` cleared the carry)
  let page = P.V.linkCursorPage;
  if (!page) return { a: 0, f: FZ };
  page = (page - 1) & 0xFF;
  const f = cpFlags(page, 2);
  P.V.linkCursorPage = page === 2 ? FIRST_ROSTER_PAGE : page;
  return { a: P.V.linkCursorPage, f };
}
export function moveLinkCursorDown(P) {
  const y = (rd(P, "menuCursor2Y") + 1) & 0xFF;
  if (y !== GRID_ROWS) { wr(P, "menuCursor2Y", y); return { a: y, f: cpFlags(y, GRID_ROWS) }; }
  let page = P.V.linkCursorPage;
  if (page < 2) {
    if (page === 1) return { a: 1, f: FZ | FN };
    const created = rd(P, "charGridCreatedCount");
    if (created < 7) return { a: created, f: cpFlags(created, 7) };
    P.V.linkCursorPage = 1;
    return { a: 1, f: cpFlags(created, 7) };
  }
  const next = (page + 1) & 0xFF, last = (rd(P, "charGridPageCount") - 1) & 0xFF;
  const out = next === last ? { a: (last - 1) & 0xFF, f: decFlags(last) } : { a: next, f: cpFlags(next, last) };
  P.V.linkCursorPage = out.a;
  return { ...out, b: last, e: next };
}
export function moveLinkCursorRight(P) {
  const x = (rd(P, "menuCursor2X") + 1) & 0xFF;
  if (x !== GRID_COLUMNS) { wr(P, "menuCursor2X", x); return { a: x, f: cpFlags(x, GRID_COLUMNS) }; }
  linkSwitchPageKind(P);
  wr(P, "menuCursor2X", 0);
  return { a: 0, f: FZ };
}
export function moveLinkCursorLeft(P) {
  const x = (rd(P, "menuCursor2X") - 1) & 0xFF;
  if (x !== 0xFF) { wr(P, "menuCursor2X", x); return { a: x, f: cpFlags(x, 0xFF) }; }
  const f = P.V.linkCursorPage === 1 ? FZ | FN : FZ;               // (`cp $01` found 1; else `or a` or `xor a`)
  linkSwitchPageKind(P);
  wr(P, "menuCursor2X", 2);
  return { a: 2, f };
}
// (the link cursor's page switch: pages 0 and 1 go to the first roster page, the others to 0)
function linkSwitchPageKind(P) { P.V.linkCursorPage = P.V.linkCursorPage < 2 ? FIRST_ROSTER_PAGE : 0; }
// Unused_38_RetreatLinkGridSelection (38:6D97): CancelCharGridSelection's slot clearing for the link (state 2)
export function unusedRetreatLinkGridSelection(P) {
  if (retreatToPreviousPlayerSlot(P).a === 0xFF) return { a: 0xFF };
  sound(P, SFX_MENU_CANCEL);
  const chars = idx(P.A.charSelectSlotChars, rd(P, "charSelectSlot")), entry = u8(P, chars);
  w8(P, chars, 0);
  w8(P, entryAddr(P, entry) + 2, 0);
  wr(P, "linkSelectSlotState", 2);
  return { a: 2 };
}
// Unused_38_ConfirmRemoteGridSelection (38:6DC4): ConfirmCharGridSelection's pick at the remote cursor. Returns
// a = 1 when picked (state 1), else 0.
export function unusedConfirmRemoteGridSelection(P) {
  if (testAndSetGridEntryTaken(P, rd(P, "charGridPage"), rd(P, "menuCursor2X"), rd(P, "menuCursor2Y"))) return { a: 0, f: FZ };
  const entry = getGridSlotFromCursor(P).a;
  if (u8(P, entryAddr(P, entry)) === 0xFF) return { a: 0, f: FZ };
  w8(P, idx(P.A.charSelectSlotChars, rd(P, "charSelectSlot")), entry);
  wr(P, "linkSelectSlotState", 1);
  return { a: 1 };
}
// WaitLinkSelectStartupFrames (38:6E04): a = 0 for the first 3 frames of the link screen (counted in
// wLinkSelectStartupFrames), then 1
export function waitLinkSelectStartupFrames(P) {
  const n = rd(P, "linkSelectStartupFrames");
  if (n === LINK_STARTUP_FRAMES) return { a: 1, f: FZ };
  wr(P, "linkSelectStartupFrames", n + 1);
  return { a: 0, f: FZ };
}

export const HOOKS = [
  [BANK, 0x4E65, hookGen((P, c) => runExhibitionCharSelectScreen(P, c.b))],
  [BANK, 0x4F4B, hook(P => drawCharGridCursorBox(P))],
  [BANK, 0x4F6F, hook(P => setupCharGridScreen(P))],
  [BANK, 0x5195, hook(P => handleCharGridDpad(P))],
  [BANK, 0x51F4, hook(P => moveCharGridCursorUp(P))],
  [BANK, 0x521C, hook(P => moveCharGridCursorDown(P))],
  [BANK, 0x525E, hook(P => moveCharGridCursorRight(P))],
  [BANK, 0x528B, hook(P => moveCharGridCursorLeft(P))],
  [BANK, 0x52B9, hook(P => handleCharGridButtons(P))],
  [BANK, 0x5302, hook(P => confirmCharGridSelection(P))],
  [BANK, 0x53B0, hook(P => cancelCharGridSelection(P))],
  [BANK, 0x549A, hook(P => drawCharGridWaitBanner(P))],
  [BANK, 0x54CC, hook(P => drawCharGridScrollArrows(P))],
  [BANK, 0x5545, hook(P => drawCharGridCharSprites(P))],
  [BANK, 0x5589, hook((P, c) => queueCharGridCharSprite(P, c.b, c.c, c.de))],
  [BANK, 0x63BD, hookGen(P => runLinkCharSelectScreen(P))],
  [BANK, 0x6528, hook(P => processLinkSelectCommand(P))],
  [BANK, 0x6D0B, hook(P => moveLinkCursorUp(P))],
  [BANK, 0x6D25, hook(P => moveLinkCursorDown(P))],
  [BANK, 0x6D58, hook(P => moveLinkCursorRight(P))],
  [BANK, 0x6D77, hook(P => moveLinkCursorLeft(P))],
  [BANK, 0x6D97, hook(P => unusedRetreatLinkGridSelection(P))],
  [BANK, 0x6DC4, hook(P => unusedConfirmRemoteGridSelection(P))],
  [BANK, 0x6E04, hook(P => waitLinkSelectStartupFrames(P))],
];
