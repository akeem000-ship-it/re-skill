// Bank $3e: the link match rules menu (singles or doubles, the games, the sets: three rows of options over a menu
// panel, the cursor on the chosen option of each row, chosen over the link: both players' pads come through
// hLinkInput), bank $3e's copies of the small shared helpers (cursor cells, a WRAM 3 row cleared, the animated tiles
// task, a name with diacritics, numbers as ASCII digits) and the menu screen restored after a link screen.
// Port of src/engine/menus/link/rules_3e.asm (with its twins, src/twins/*: one routine assembled in several banks;
// the ports of the other banks' copies are used) of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own; tables and graphics are read from the ROM.
// Tests: web/tests/port/routines_menus_misc.mjs; UpdateAnimatedTiles_3e in the lockstep on out/port/save1.mtrec
// (the erase warning's frame task); the rules menu's start (its screen, until the link times out into the error
// screen) in out/port/lk_rules.mtrec (scripted, wLinkMatchRole forced). The menu proper runs over the link only,
// which the emulator cannot play: its input loop, OpenMatchRulesPanel and CloseMatchRulesPanel are unverified.
import {
  FZ, FN, FAR, HOME, rom, romWait, home, wram, sound, advanceFrame, registerFrameTask, clearFrameTasks, enableLCD,
  beginFadeIn, loadPaletteShadow, disableLCDSafely, hook, hookGen, regs8, WRAM_SCREEN, TILE_SIZE, VRAM_BANK1, vTiles0,
  PADF_A, PADF_B, PADF_LEFT, PADF_RIGHT, rIE, IE_TIMER, BGM_MENU, SFX_MENU_MOVE, SFX_MENU_SELECT, SFX_MENU_CANCEL,
  MENUSLIDE_BACK, MENUSLIDE_FORWARD,
} from "../equipment/defs.js";
import { moveMenuCursorGrid, getMenuCursorIndex, getMenuCursorIndexFromPtr, setMenuCursorFromIndex } from "../common/cursors.js";
import {
  unusedClearWram3Row64, drawNameWithDiacritics, unusedDrawDecimalNumber, unusedDrawAsciiDigitString,
  unusedDrawAsciiDigitChar,
} from "../main_menu/n64.js";
import { matchFormatSlideOut, flushMatchFormatRowToVram } from "../main_menu/match_format.js";
import { resetSerialState } from "../../home/link.js";
import { loadChoiceTabGraphics } from "../equipment/racket_choice.js";
import {
  MatchRulesCursorSpriteTask, setMatchRuleOptionAttrRect, drawSinglesDoublesRow, drawGameCountRow, drawSetCountRow,
  drawMatchRulesCaption,
} from "./linkrules.js";

export const BANK = 0x3E;
const MatchRulesInitialStatePalettes0 = 0x45EF, MatchRulesInitialStatePalettes1 = 0x45F7;
const MatchRulesInitialStatePalettes2 = 0x45FF, MatchRulesMenuGraphicsTable = 0x46D8, MatchRulesMenuTable = 0x46E6;
const RULE_LABELS = 7, RULE_ROWS = 3, ROW_MODE = 0, ROW_GAMES = 1, SET_CHOICES = 3;
const FIRST_GAMES_OPTION = 2, FIRST_SETS_OPTION = 4;
const PANEL_RULES_IN = 0x02, PANEL_RULES_OUT = 0x03, FLUSH_LAYOUT_RULES = 0;
const TILEBLOCK_SharedMenuGfx35 = 0x23, TILEBLOCK_SharedMenuGfx27 = 0x1B, TILEBLOCK_SharedMenuGfx63 = 0x3F;
const ResyncLinkSessionWithTimer = [0x07, 0x4AA9];

const timerInterruptOff = P => P.bus.w8(rIE, P.bus.u8(rIE) & ~IE_TIMER);
const timerInterruptOn = P => P.bus.w8(rIE, P.bus.u8(rIE) | IE_TIMER);
function endLinkExchange(P) { P.V.linkExchangeActive = 0; resetSerialState(P); }

// ---- the shared helpers (twins) ----
// Unused_3e_GetCellIndexFromCursorPtr (3E:43DB): a = the cell of the cursor whose y is at hl, x at hl - 1, on a
// grid c wide (hl - 1 left; bc kept). Nothing calls it.
export const unusedGetCellIndexFromCursorPtr = (P, cols, hl) => getMenuCursorIndexFromPtr(P, cols, hl);
// SetMenuCursorFromIndex_3e (3E:43EB): the cursor of cell c on a grid b wide (wMenuCursorX, wMenuCursorY)
// Unused_3e_SetMenuCursorFromIndexToPtr (3E:43FD): the same into the two bytes at hl. Nothing calls it.
// Unused_3e_ClearWram3Row64 (3E:440B) / ...Alt (3E:4421): 64 zero bytes at hl in WRAM 3. Nothing calls them.
// UpdateAnimatedTiles_3e (3E:4438), a frame task: the menu library's animated tiles
export const updateAnimatedTiles3e = P => rom(P, FAR.UpdateAnimatedTiles);
// Unused_3e_DrawNameWithDiacritics (3E:443C), Unused_3e_DrawDecimalNumber (3E:4475), Unused_3e_DrawAsciiDigitString
// (3E:4496) and Unused_3e_DrawAsciiDigitChar (3E:44A0): a name, a decimal number and ASCII digits into the WRAM 3
// map (the copies of bank $3b's, main_menu/n64.js). Nothing calls them.

// RestoreMenuScreenAndFadeIn (3E:44B9): the menu font and the menu screen with its text window back, the LCD on and a
// fade in started
export function* restoreMenuScreenAndFadeIn(P) {
  disableLCDSafely(P);
  const r = rom(P, FAR.LoadMenuFontGfx);
  yield* romWait(P, FAR.ResetScreenAndTextWindows, regs8(r));
  enableLCD(P);
  beginFadeIn(P, 16);
  return { c: 16 };
}

// ---- the link match rules menu ----
// RunLinkMatchRulesMenu (3E:44CB), slot $4000: the rules reset to singles, the first games and sets choice; the
// panel slides in; then each link frame the partners' pads (hLinkInput) change the cursor's row's option (left /
// right) or move the cursor; A returns the cursor's row (0-2), B returns $FF (both after a link sync).
export function* runLinkMatchRulesMenu(P) {
  home(P, HOME.EnableTimerInterrupt);
  sound(P, BGM_MENU);
  P.V.matchFormatDoubles = 0;
  P.V.matchFormatGames = 0;
  P.V.matchFormatSets = 0;
  endLinkExchange(P);
  yield* loadMatchRulesMenuGraphics(P);
  wram(P, WRAM_SCREEN);
  yield* openMatchRulesPanel(P, P.V.menuSlideDirection);
  rom(P, FAR.InitMenuBgScroll);
  rom(P, FAR.LoadMenuSpritePalettePair, { b: 1, c: 1 });
  drawMatchRulesInitialState(P);
  registerFrameTask(P, 1, MatchRulesCursorSpriteTask);
  drawMatchRulesCaption(P);
  yield* romWait(P, ResyncLinkSessionWithTimer);
  for (let i = 0; i < 3; i++) yield* romWait(P, FAR.RunLinkInputFrame);
  timerInterruptOff(P);
  wram(P, WRAM_SCREEN);
  for (;;) {
    rom(P, FAR.TickMenuBgScroll);
    P.V.menuInputPressed = P.V.linkInput;
    handleMatchRulesToggleInput(P);
    if (moveMenuCursorGrid(P, 1, RULE_ROWS).a) { sound(P, SFX_MENU_MOVE); drawMatchRulesCaption(P); }
    if (P.menuWheel && P.menuWheel.on) P.menuWheel.skin = { id: "format", at: P.frames, title: "LINK MATCH", row: P.V.menuCursorY, doubles: P.V.matchFormatDoubles, games: P.V.matchFormatGames, sets: P.V.matchFormatSets };   // MENU: Wheel (menuskins.js), read only
    yield* romWait(P, FAR.RunLinkInputFrame);
    const input = P.V.menuInputPressed;
    if (input & PADF_A) {
      sound(P, SFX_MENU_SELECT);
      yield* romWait(P, FAR.SyncLinkFrame);
      endLinkExchange(P);
      home(P, HOME.EnableTimerInterrupt);
      clearFrameTasks(P);
      yield* closeMatchRulesPanel(P, 1);
      P.V.menuSlideDirection = MENUSLIDE_FORWARD;
      const r = getMenuCursorIndex(P, RULE_ROWS);
      timerInterruptOn(P);
      return r;
    }
    if (input & PADF_B) {
      sound(P, SFX_MENU_CANCEL);
      yield* romWait(P, FAR.SyncLinkFrame);
      endLinkExchange(P);
      clearFrameTasks(P);
      yield* closeMatchRulesPanel(P, 0);
      P.V.menuSlideDirection = MENUSLIDE_BACK;
      timerInterruptOn(P);
      return { a: 0xFF };
    }
  }
}
// DrawMatchRulesInitialState (3E:459B): the cursor on the first row; each row's chosen option highlighted and its
// attributes queued; the options' palettes (BG 4, 6, 7)
export function drawMatchRulesInitialState(P) {
  setMenuCursorFromIndex(P, 1, 0);
  setMatchRuleOptionAttrRect(P, P.V.matchFormatDoubles, 1);
  flushMatchRuleRowAttrs(P, 0);
  setMatchRuleOptionAttrRect(P, (P.V.matchFormatGames + FIRST_GAMES_OPTION) & 0xFF, 1);
  flushMatchRuleRowAttrs(P, 1);
  setMatchRuleOptionAttrRect(P, (P.V.matchFormatSets + FIRST_SETS_OPTION) & 0xFF, 1);
  flushMatchRuleRowAttrs(P, 2);
  loadPaletteShadow(P, MatchRulesInitialStatePalettes0, 4, 1);
  loadPaletteShadow(P, MatchRulesInitialStatePalettes1, 6, 1);
  return { b: 2, c: 1, ...loadPaletteShadow(P, MatchRulesInitialStatePalettes2, 7, 1) };
}
// LoadMatchRulesMenuGraphics (3E:4607): the seven option labels, the panel's tiles (SharedMenuGfx35-41, 27, 63: a
// frame each) and the cursor's palette
export function* loadMatchRulesMenuGraphics(P, entryF = P.cpu.f) {
  const blocks = [];
  for (let i = 0; i < 7; i++) blocks.push([TILEBLOCK_SharedMenuGfx35 + i, 0x10, vTiles0 + i * 0x10 * TILE_SIZE + VRAM_BANK1, 1]);
  blocks.push([TILEBLOCK_SharedMenuGfx27, 0x04, vTiles0 + 0x70 * TILE_SIZE + VRAM_BANK1, 1], [TILEBLOCK_SharedMenuGfx63, 0x14, vTiles0, 1]);
  return yield* loadChoiceTabGraphics(P, MatchRulesMenuGraphicsTable, MatchRulesMenuTable, blocks, entryF, RULE_LABELS);
}
// OpenMatchRulesPanel (3E:46F4): the panel sliding in, forward (b != 0: panel 2 steps 0-13) or back (panel 3 steps
// 10-0), a frame after
export function* openMatchRulesPanel(P, forward) {
  let c, r;
  const step = function* (panel, s) {
    yield* advanceFrame(P);
    rom(P, FAR.RestoreMenuBgAndDrawPanel, { b: panel, c: s });
    return yield* romWait(P, FAR.FlushWram3MapRows, { b: FLUSH_LAYOUT_RULES });
  };
  if (forward) for (c = 0; c !== 0x0E; c++) r = yield* step(PANEL_RULES_IN, c);
  else for (c = 0x0A; c !== 0xFF; c = (c - 1) & 0xFF) r = yield* step(PANEL_RULES_OUT, c);
  yield* advanceFrame(P);
  return { ...regs8(r), a: c, c, f: FZ | FN };
}
// CloseMatchRulesPanel (3E:472C): the panel sliding out (bank $3b's MatchFormatSlideOut, the same body)
export const closeMatchRulesPanel = (P, forward) => matchFormatSlideOut(P, forward);
// HandleMatchRulesToggleInput (3E:475D): left / right change the cursor's row's option (singles / doubles and the
// games toggle; the sets step over three, wrapping); the row redrawn, the caption, the row's attributes queued
export function handleMatchRulesToggleInput(P, entryF = P.cpu.f) {
  const { V } = P, input = V.menuInputPressed;
  if (!(input & (PADF_LEFT | PADF_RIGHT))) return { a: input, f: FZ | 0x20 | (entryF & 0x10) };   // (its `bit 4, a`)
  sound(P, SFX_MENU_MOVE);
  const row = getMenuCursorIndex(P, 1).a;
  if (row === ROW_MODE) { V.matchFormatDoubles ^= 1; drawSinglesDoublesRow(P); }
  else if (row === ROW_GAMES) { V.matchFormatGames ^= 1; drawGameCountRow(P); }
  else {
    // (the ROM's `add a / jr nc` test: a step below 0 goes to the last choice, one past it to 0)
    const v = (V.matchFormatSets + (input & PADF_LEFT ? -1 : 1)) & 0xFF;
    V.matchFormatSets = v & 0x80 ? SET_CHOICES - 1 : v < SET_CHOICES ? v : 0;
    drawSetCountRow(P);
  }
  const r = drawMatchRulesCaption(P), b = row === ROW_MODE ? 0 : row === ROW_GAMES ? 1 : 2;
  flushMatchRuleRowAttrs(P, b);
  return { ...r, b };
}
// FlushMatchRuleRowAttrs (3E:48BB, linkrules_3e.asm): option row b's attributes queued (bank $3b's
// FlushMatchFormatRowToVram, the same body). Registers kept.
export function flushMatchRuleRowAttrs(P, row) { flushMatchFormatRowToVram(P, row); }

export const HOOKS = [
  [BANK, 0x43DB, hook((P, c) => unusedGetCellIndexFromCursorPtr(P, c.c, c.hl))],
  [BANK, 0x43EB, hook((P, c) => setMenuCursorFromIndex(P, c.b, c.c))],
  [BANK, 0x43FD, hook((P, c) => setMenuCursorFromIndex(P, c.b, c.c, c.hl))],
  [BANK, 0x440B, hook((P, c) => unusedClearWram3Row64(P, c.hl, c.f))],
  [BANK, 0x4421, hook((P, c) => unusedClearWram3Row64(P, c.hl, c.f))],
  [BANK, 0x4438, hook(P => updateAnimatedTiles3e(P))],
  [BANK, 0x443C, hook((P, c) => drawNameWithDiacritics(P, c.hl, c.de))],
  [BANK, 0x4475, hook((P, c) => unusedDrawDecimalNumber(P, c))],
  [BANK, 0x4496, hook((P, c) => unusedDrawAsciiDigitString(P, c.hl, c.de))],
  [BANK, 0x44A0, hook((P, c) => unusedDrawAsciiDigitChar(P, c.a, c.de))],
  [BANK, 0x44B9, hookGen(P => restoreMenuScreenAndFadeIn(P))],
  [BANK, 0x44CB, hookGen(P => runLinkMatchRulesMenu(P))],
  [BANK, 0x459B, hook(P => drawMatchRulesInitialState(P))],
  [BANK, 0x4607, hookGen((P, c) => loadMatchRulesMenuGraphics(P, c.f))],
  [BANK, 0x46F4, hookGen((P, c) => openMatchRulesPanel(P, c.b))],
  [BANK, 0x472C, hookGen((P, c) => closeMatchRulesPanel(P, c.b))],
  [BANK, 0x475D, hook((P, c) => handleMatchRulesToggleInput(P, c.f))],
  [BANK, 0x48BB, hook((P, c) => { flushMatchRuleRowAttrs(P, c.b); })],
];
