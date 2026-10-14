// The story pause menu (bank 6): START on the overworld (RunStoryModeMenu). A caption window at the bottom of the
// screen and a row of item labels drawn into the story's text-window maps (WRAM 5, wActiveTilemap through the
// scroll); the cursor and the chosen item's label are sprites. Menus (StoryMenuDefs, wPauseMenuId):
//   0 STATUS / CLEAR STATUS / OPTIONS / SAVE     1 CHAR. DATA / ITEMS     2 MESSAGES / MUSIC
//   3 SLOW / NORMAL / FAST                       4 ON / OFF               5 SAVE / TO MAIN MENU / CANCEL
// STATUS opens the character data or the equipment screen, CLEAR STATUS the game progress screen (both leave the
// menu, the player put back where he stood); OPTIONS sets the message speed or the music; SAVE saves the story and
// returns to the main menu, or returns without saving. Left / right move the cursor, A picks, B or START cancel.
// Also here: the cursor and mode-title sprites of the match pause menu (QueueMatchMenuCursorSprite,
// DrawScoreboardModeTitle) and an unused debug editor of eight stats over a match (Unused_06_RunDebugStatsEditor).
// Port of src/engine/menus/pause/story_menu_06.asm and story_options_06.asm of the gerbiljames/mario-tennis-gbc-disasm
// (MIT, third_party/mario-tennis-gbc-disasm): names and addresses are its own; tables are read from the ROM.
// Tests: lockstep on out/port/story_pause*.mtrec (story1's start with the menu used); routines_menus_pause.mjs.
import {
  FAR, HOME, rom, romWait, home, wram, rd, wr, rd16, wr16, u8, w8, u16, sound, advanceFrame, stepMatchFrame,
  readMatchInputPressed, readMatchInputRepeat, prepareGlyphBuffer, uploadGlyphBuffer, renderProportionalTextAt,
  queueVRAMCopy, copyMemoryFast, copyMemoryBC, decompressData, queueSprite, queueSpriteTemplate, waitFrames, hook,
  hookGen, setFlag, clearFlag, FZ, WRAM_STAGING, WRAM_COURT_PLANES, WRAM_TEXT, WRAM_CHAR0, TILE_SIZE, vTiles0,
  wDecompBuffer, wCharPosX, OAM_BANK1, PADF_A, PADF_B, PADF_SELECT, PADF_START, PADF_LEFT, PADF_RIGHT, SFX_MENU_MOVE,
  SFX_MENU_SELECT, SFX_MENU_CANCEL, SFX_PAUSE_MENU, MATCHMENUSEL_CANCELLED, MATCHABORT_ALL, STORYLOC_MAIN_MENU,
  STORYENTRY_NONE, TILEATTR_PAL1, TILEATTR_PRIORITY, FLAG_HIDE_OVERWORLD_ACTORS,
} from "./defs.js";
import { copyTextRect, drawWindowFrame, moveCursorHorizontal } from "../../home/ui.js";
import { getShadowTilemapAddr, getShadowAttrmapAddr, adjustSpriteCoordsForScroll, flushTilemapToVram,
  unusedFlushTilemapToVramIfDirty, restoreBgTilemap } from "./match_pause.js";
import { drawMatchMenuItem, ScoreboardModeGfxTail, SCOREBOARD_TAIL_BLOCKS } from "./scoreboard.js";

const BANK = 0x06;
const rb = (P, a) => P.rom.u8(BANK, a), rw = (P, a) => P.rom.u16(BANK, a);
const Unused_06_DrawMusicMenuRowTextRect = 0x695B, MenuItemAttrRect3x2 = 0x6955, TextRectAttrs_06 = 0x6973;
const QueueMatchMenuCursorSprite_SpriteTemplate = 0x69E7, DrawScoreboardModeTitle_SpriteTemplate = 0x6A10;
const DebugStatNamePointers = 0x6A39, StoryMenuDefs = 0x6CE0, StoryMenuItemPosPointers = 0x6DC1;
const StoryMenuCursorPosPointers = 0x6DFB, StoryPauseMenuCursorPositions = 0x6F3A;
const StoryTwoOptionCursorPositions = 0x7176, StoryThreeOptionCursorPositions = 0x7231;
const StoryMenuItemGfxPointers = 0x72AE, QueueStoryMenuCursorSprite_SpriteTemplate = 0x72DF;
const StoryMenuItemRectPointers = 0x77CB, StoryMenuItemRowTextRect = 0x784B;
export const DrawScoreboardModeTitle = 0x69C8;
const Text_30_354 = 0x0162, Text_30_370 = 0x0172;                // the story menu captions (+ item id); "save?"
const MENU_DEF_SIZE = 8, MENU_DEF_COUNT = 4;
// the story menus (wPauseMenuId) and their items (STORYMENUITEM_*)
const MENU_STORY = 0, MENU_PLAYER_DATA = 1, MENU_OPTIONS = 2, MENU_SAVE_QUIT = 5;
const ITEM_MESSAGES = 0x04, ITEM_MSG_SLOW = 0x06, ITEM_MUSIC_ON = 0x09, ITEM_SAVE_GAME = 0x0B, ITEM_CHAR_DATA = 0x0E;
const SAVE_QUIT_SAVE = 0, SAVE_QUIT_TO_MAIN_MENU = 1, SAVE_QUIT_CANCEL = 2;
const MSG_SPEED_LEVELS = 2;                                      // wMessageSpeed 0-2 (shown as 2 - speed)
const MESSAGE_SPEED_INSTANT = 0x80;                              // wMessageSpeed bit 7
const ITEM_LABEL_BLOCKS = 16;
const RETURN_POINT_NONE = 0xFFFF;
const DEBUG_STATS = 15, DEBUG_STAT_ROWS = 0x0B, DEBUG_STAT_BACKUP_BLOCKS = 8;
const DEBUG_SCORE_ON_START = 0x270B;

// ---- the match pause menu's sprites ----
// QueueMatchMenuCursorSprite (06:69B7): the match menu's cursor and label sprites at (d - 4, e)
export function queueMatchMenuCursorSprite(P, x, y) {
  const at = adjustSpriteCoordsForScroll(P, (x - 4) & 0xFF, y);
  return queueSpriteTemplate(P, QueueMatchMenuCursorSprite_SpriteTemplate, at.d, at.e, 0, 0);
}
// DrawScoreboardModeTitle (06:69C8), a frame task: the mode title over the scoreboard (column 5, its row; bobbing)
export function drawScoreboardModeTitle(P) {
  const pos = ((((0x05 << 8) | rd(P, "scoreboardOrigin")) * 8) + 0xFCF0) & 0xFFFF;
  const { e } = rom(P, FAR.AddBobbingOffsetYLarge, { d: pos >> 8, e: pos & 0xFF });
  const at = adjustSpriteCoordsForScroll(P, pos >> 8, e);
  return queueSpriteTemplate(P, DrawScoreboardModeTitle_SpriteTemplate, at.d, at.e, 0, 0);
}
// Unused_06_DrawMusicMenuRow (06:698B): an old music menu row in the court's maps (and the MUSIC label when the
// camera is locked). Nothing calls it.
export function unusedDrawMusicMenuRow(P) {
  copyTextRect(P, Unused_06_DrawMusicMenuRowTextRect, getShadowTilemapAddr(P, 0x03, 0x0A), 0x0C, 0x02);
  copyTextRect(P, TextRectAttrs_06, getShadowAttrmapAddr(P, 0x03, 0x0A), 0x0C, 0x02);
  if (!rd(P, "courtViewLocked")) return;
  drawMatchMenuItem(P, 0x05, 0x09, 0x0A);
}

// ---- the unused stats editor over a match (slot $4002) ----
// Unused_06_DrawDebugStatsLabels (06:6ABA): a frame over the screen and the 15 stat names
export function unusedDrawDebugStatsLabels(P) {
  P.V.windowFrameAttr = 0;
  drawWindowFrame(P, getShadowTilemapAddr(P, 0, 0), getShadowAttrmapAddr(P, 0, 0), 0x0F, 0x11);
  for (let i = 0; i < DEBUG_STATS; i++) home(P, HOME.Unused_00_CopyTextString, { hl: rw(P, DebugStatNamePointers + 2 * i), de: getShadowTilemapAddr(P, 1, 1 + i), c: i });
}
// Unused_06_DrawDebugStatsValues (06:6AF3): the values in hex, a row each: three words, eight bytes, four words
export function unusedDrawDebugStatsValues(P) {
  let de = getShadowTilemapAddr(P, 0x0A, 0x01);
  const word = v => { home(P, HOME.Unused_00_DrawHexWord, { hl: v, de }); de = (de + 0x20) & 0xFFFF; };
  word(rd16(P, "debugStatWords")); word(rd16(P, "debugStatWords", 4)); word(rd16(P, "debugStatWords", 6));
  for (let i = 0; i < 8; i++) word(rd(P, "debugStatBytes", i));                 // Unused_06_DrawDebugStatByte
  for (let i = 0; i < 8; i += 2) word(rd16(P, "debugStatWords2", i));
}
// Unused_06_RunDebugStatsEditor (06:6B84): the editor until A, SELECT or START (START also sets the minigame
// score to 9995); character 0's first 128 bytes are kept meanwhile in wDebugMenuWindowId
export function* unusedRunDebugStatsEditor(P) {
  const bank = P.V.wramBank, entryF = P.cpu.f;
  yield* stepMatchFrame(P);
  rom(P, FAR.Unused_01_LoadMenuTilesBChunk2);
  wram(P, WRAM_CHAR0);
  copyMemoryFast(P, wCharPosX, P.A.debugMenuWindowId, DEBUG_STAT_BACKUP_BLOCKS);
  wram(P, WRAM_COURT_PLANES);
  yield* stepMatchFrame(P);
  wr(P, "matchMenuSelection", 0);
  unusedDrawDebugStatsLabels(P);
  unusedDrawDebugStatsValues(P);
  flushTilemapToVram(P);
  yield* stepMatchFrame(P);
  let keys;
  while (!(keys = readMatchInputPressed(P) & (PADF_A | PADF_SELECT | PADF_START))) {
    unusedHandleDebugStatsInput(P);
    unusedFlushTilemapToVramIfDirty(P);
    yield* stepMatchFrame(P);
  }
  if (keys & PADF_START) wr16(P, "minigamesCurrentScore", DEBUG_SCORE_ON_START);
  restoreBgTilemap(P);
  flushTilemapToVram(P);
  yield* stepMatchFrame(P);
  wram(P, WRAM_CHAR0);
  copyMemoryFast(P, P.A.debugMenuWindowId, wCharPosX, DEBUG_STAT_BACKUP_BLOCKS);
  wram(P, bank);
  return { a: bank, f: entryF };
}
// Unused_06_HandleDebugStatsInput (06:6BF6): up / down pick a row, left / right change it; redraw
export function unusedHandleDebugStatsInput(P) {
  const { a } = home(P, HOME.Unused_00_MoveCursorVertical, { a: rd(P, "matchMenuSelection"), b: P.V.inputPressed, c: DEBUG_STAT_ROWS });
  wr(P, "matchMenuSelection", a);
  unusedAdjustSelectedDebugStat(P);
  unusedQueueDebugStatsCursorSprites(P);
  unusedDrawDebugStatsValues(P);
  wr(P, "tilemapDirtyFlag", 1);
}
// Unused_06_QueueDebugStatsCursorSprites (06:6C13): two arrows beside the chosen row
export function unusedQueueDebugStatsCursorSprites(P) {
  const at = adjustSpriteCoordsForScroll(P, 0x0C, 0x0C), y = (at.e + rd(P, "matchMenuSelection") * 8) & 0xFF;
  queueSprite(P, OAM_BANK1 | 1, 0x42, at.d, y);
  return queueSprite(P, OAM_BANK1 | 1, 0x42, (at.d + 0x40) & 0xFF, y);
}
// Unused_06_AdjustSelectedDebugStat (06:6C32): the chosen row's change: words by $10, bytes by 2 / 8 / 2, digits
export function unusedAdjustSelectedDebugStat(P) {
  const row = rd(P, "matchMenuSelection"), A = P.A;
  const words = [A.debugStatWords, A.debugStatWords + 4, A.debugStatWords + 6], bytes = [2, 8, 2];
  if (row < 3) return unusedAdjustDebugStatWord(P, words[row], 0x0010);
  if (row < 6) return unusedAdjustDebugStatByte(P, A.debugStatBytes + row - 3, bytes[row - 3]);
  if (row < 11) return unusedAdjustDebugStatDigit(P, A.debugStatBytes + row - 3);
  throw new Error(`Unused_06_AdjustSelectedDebugStat: row ${row} jumps off its table`);
}
// Unused_06_AdjustDebugStatDigit (06:6C9D): a digit 0-9 at hl, left / right wrapping
export function unusedAdjustDebugStatDigit(P, at) { w8(P, at, moveCursorHorizontal(u8(P, at), P.V.inputPressed, 0x0A, 0).a); }
// Unused_06_AdjustDebugStatByte (06:6CA8): the byte at hl - / + b on left / right
export function unusedAdjustDebugStatByte(P, at, step) {
  const pad = P.V.inputPressed;
  if (pad & PADF_LEFT) w8(P, at, u8(P, at) - step);
  else if (pad & PADF_RIGHT) w8(P, at, u8(P, at) + step);
}
// Unused_06_AdjustDebugStatWord (06:6CBB): the word at hl - / + bc on left / right
export function unusedAdjustDebugStatWord(P, at, step) {
  const pad = P.V.inputPressed;
  if (pad & PADF_LEFT) P.bus.w16(at, (u16(P, at) - step) & 0xFFFF);
  else if (pad & PADF_RIGHT) P.bus.w16(at, (u16(P, at) + step) & 0xFFFF);
}

// ---- the story menus ----
// GetStoryMenuItemId (06:6D74) / GetStoryMenuItemCount (06:6D8A): as the match menu's, from StoryMenuDefs
export function getStoryMenuItemId(P, pos) { return rb(P, (StoryMenuDefs + ((rd(P, "pauseMenuId") * MENU_DEF_SIZE) & 0xFF) + pos) & 0xFFFF); }
export function getStoryMenuItemCount(P) { return rb(P, (StoryMenuDefs + ((rd(P, "pauseMenuId") * MENU_DEF_SIZE) & 0xFF) + MENU_DEF_COUNT) & 0xFFFF); }
// DrawStoryMenuItems (06:6D99): each item's label at its place for this count
export function drawStoryMenuItems(P) {
  const count = rd(P, "pauseMenuItemCount"), places = rw(P, StoryMenuItemPosPointers + 2 * count);
  for (let i = 0; i < count; i++) drawStoryMenuItem(P, getStoryMenuItemId(P, i), rb(P, places + 2 * i), rb(P, places + 2 * i + 1));
}
// DrawStoryMenuCursor (06:6DDD): the cursor over the chosen item
export function drawStoryMenuCursor(P) {
  const places = rw(P, StoryMenuCursorPosPointers + 2 * rd(P, "pauseMenuItemCount"));
  const at = (places + 2 * rd(P, "matchMenuSelection")) & 0xFFFF;
  return queueStoryMenuCursorSprite(P, rb(P, at + 1), rb(P, at));
}
// the caption of item `id` (Text_30_354 + id) in the caption window
const captionOf = id => (Text_30_354 + (id & 0xFF)) & 0xFFFF;
// RunStoryMenu (06:6D10): menu wPauseMenuId with the cursor at wMatchMenuSelection until A or B / START (as the
// match's RunMatchMenu, a frame each)
export function* runStoryMenu(P) {
  wr(P, "pauseMenuItemCount", getStoryMenuItemCount(P));
  drawStoryMenuItems(P);
  let redraw = true;
  for (;;) {
    if (redraw) {
      const id = getStoryMenuItemId(P, rd(P, "matchMenuSelection"));
      loadStoryMenuItemGfx(P, id);
      yield* drawStoryMenuCaption(P, captionOf(id), 0x00, 0x0E);
      redrawStoryTilemapRows(P);
    }
    drawStoryMenuCursor(P);
    yield* advanceFrame(P);
    redraw = false;
    if (readMatchInputPressed(P) & (PADF_B | PADF_START)) {
      sound(P, SFX_MENU_CANCEL);
      wr(P, "matchMenuSelection", MATCHMENUSEL_CANCELLED);
      break;
    }
    if (readMatchInputPressed(P) & PADF_A) { sound(P, SFX_MENU_SELECT); break; }
    const pad = readMatchInputRepeat(P) & (PADF_LEFT | PADF_RIGHT);
    if (pad) {
      wr(P, "matchMenuSelection", moveCursorHorizontal(rd(P, "matchMenuSelection"), pad, rd(P, "pauseMenuItemCount"), 0).a);
      sound(P, SFX_MENU_MOVE);
      redraw = true;
    }
  }
  yield* advanceFrame(P);
}

// RunStoryModeMenu (06:6E17), slot $4008: the story pause menu (see the header). The scene's tile animations stop
// and the overworld's actors hide meanwhile; hLinkPayloadKind is 2.
export function* runStoryModeMenu(P) {
  const { V } = P, bank = V.wramBank, entryF = P.cpu.f;
  rom(P, FAR.StopSceneTileAnimations);
  const payload = V.linkPayloadKind;
  yield* advanceFrame(P);
  sound(P, SFX_PAUSE_MENU);
  wr(P, "matchMenuSelection", 0);
  V.linkPayloadKind = 2;
  rom(P, FAR.InitTextWindows);
  wr(P, "windowTileAttr", TILEATTR_PRIORITY | TILEATTR_PAL1);
  setFlag(P, FLAG_HIDE_OVERWORLD_ACTORS);
  rom(P, FAR.LoadMatchStoryGfx);
  restoreStoryTilemapNoPriority(P);
  rom(P, FAR.CreateWindowFromScreenRect, { d: 0x00, e: 0x0E, b: 0x13, c: 0x03 });
  yield* advanceFrame(P);
  wram(P, WRAM_TEXT);
  let result;                                                        // the item's result (b at StoryPauseMenu_AfterItem)
  for (;;) {
    queueVRAMCopy(P, ScoreboardModeGfxTail, vTiles0 + 0x64 * TILE_SIZE, SCOREBOARD_TAIL_BLOCKS);
    wr(P, "pauseMenuId", MENU_STORY);
    yield* runStoryMenu(P);
    const sel = rd(P, "matchMenuSelection");
    if (sel === MATCHMENUSEL_CANCELLED) { result = null; break; }
    if (sel === 0) result = yield* storyPauseMenuPlayerData(P);
    else if (sel === 1) result = yield* storyPauseMenuGameProgress(P);
    else if (sel === 2) result = yield* storyPauseMenuOptions(P);
    else if (sel === 3) result = yield* storyPauseMenuSaveQuit(P);
    else throw new Error(`RunStoryModeMenu: item ${sel} jumps off its table`);
    wr(P, "matchMenuSelection", sel);                                  // StoryPauseMenu_AfterItem
    // STATUS / CLEAR STATUS, and SAVE when it saved or quit: leave the menu at once (a result of $FF: the submenu
    // was cancelled, back to the menu); OPTIONS and a cancelled SAVE: back to the menu unless the match aborts
    if (sel < 2 || (sel === 3 && result)) {
      if (result === 0xFF) continue;
      V.linkPayloadKind = payload;
      clearFlag(P, FLAG_HIDE_OVERWORLD_ACTORS);
      rom(P, FAR.InitSceneTileAnimations);
      wram(P, bank);
      return { a: bank, f: entryF };
    }
    if (rd(P, "matchAbortFlag")) break;
  }
  restoreStoryShadowTilemap(P);
  redrawStoryTilemapRows(P);
  yield* advanceFrame(P);
  clearFlag(P, FLAG_HIDE_OVERWORLD_ACTORS);
  rom(P, FAR.LoadMenuFontGfxStaged);
  V.linkPayloadKind = payload;
  rom(P, FAR.InitTextWindows);
  rom(P, FAR.InitSceneTileAnimations);
  wram(P, bank);
  return { a: bank, f: entryF };
}
// UnusedStoryMenuRedrawReentry (06:6EC7): an older four-item story menu loop (the label row drawn whole, the
// cursor from StoryPauseMenuCursorPositions; B, SELECT or START cancel). Nothing calls it.
export function* unusedStoryMenuRedrawReentry(P) {
  unusedDrawStoryMenuItemRow(P);
  queueVRAMCopy(P, ScoreboardModeGfxTail, vTiles0 + 0x64 * TILE_SIZE, SCOREBOARD_TAIL_BLOCKS);
  let redraw = true;
  for (;;) {
    if (redraw) {
      loadStoryMenuItemGfx(P, rd(P, "matchMenuSelection"));
      yield* drawStoryMenuCaption(P, captionOf(rd(P, "matchMenuSelection")), 0x00, 0x0E);
      redrawStoryTilemapRows(P);
    }
    const at = StoryPauseMenuCursorPositions + 2 * rd(P, "matchMenuSelection");
    queueStoryMenuCursorSprite(P, rb(P, at + 1), rb(P, at));
    yield* advanceFrame(P);
    redraw = false;
    if (readMatchInputPressed(P) & (PADF_B | PADF_SELECT | PADF_START)) {
      sound(P, SFX_MENU_CANCEL);
      wr(P, "matchMenuSelection", MATCHMENUSEL_CANCELLED);
      break;
    }
    if (readMatchInputPressed(P) & PADF_A) { sound(P, SFX_MENU_SELECT); break; }
    const pad = readMatchInputRepeat(P) & (PADF_LEFT | PADF_RIGHT);
    if (pad) {
      wr(P, "matchMenuSelection", moveCursorHorizontal(rd(P, "matchMenuSelection"), pad, 4, 0).a);
      sound(P, SFX_MENU_MOVE);
      redraw = true;
    }
  }
  yield* advanceFrame(P);
}

// leaving the menu for another screen: the player's position is the spawn point when the overworld comes back
function keepPlayerPosition(P) {
  copyMemoryBC(P, P.A.storyModePlayersXPosition, P.A.storyModeSpawnPosition, 5);
  wr(P, "storyModeEntryPoint", STORYENTRY_NONE);
  wr(P, "unusedExitTriggerIdMirror", STORYENTRY_NONE);
  wr(P, "storyModeExitTriggerRequest", STORYENTRY_NONE);
}
// StoryPauseMenu_PlayerData (06:6F42): CHAR. DATA / ITEMS. Returns a = 0 after the screen, $FF if cancelled.
export function* storyPauseMenuPlayerData(P) {
  restoreStoryTilemapNoPriority(P);
  wr(P, "matchMenuSelection", 0);
  wr(P, "pauseMenuId", MENU_PLAYER_DATA);
  yield* runStoryMenu(P);
  const sel = rd(P, "matchMenuSelection");
  if (sel === MATCHMENUSEL_CANCELLED) { restoreStoryTilemapNoPriority(P); return 0xFF; }
  if (sel === 0) return yield* storyPauseMenuCharPartnerData(P);
  if (sel === 1) return yield* storyPauseMenuEquipment(P);
  throw new Error(`StoryPauseMenu_PlayerData: item ${sel} jumps off its table`);
}
// StoryPauseMenu_CharPartnerData (06:6F66) / _Equipment (06:6F84) / _GameProgress (06:6FA0): the screen; a = 0
export function* storyPauseMenuCharPartnerData(P) {
  keepPlayerPosition(P);
  yield* romWait(P, FAR.ShowCharDataScreen, { a: 1 });
  return 0;
}
export function* storyPauseMenuEquipment(P) {
  keepPlayerPosition(P);
  yield* romWait(P, FAR.ShowEquipmentStatusScreen);
  return 0;
}
export function* storyPauseMenuGameProgress(P) {
  keepPlayerPosition(P);
  yield* romWait(P, FAR.ShowGameProgressScreen);
  return 0;
}
// StoryPauseMenu_Options (06:6FBC): MESSAGES / MUSIC until cancelled; returns a = $FF
export function* storyPauseMenuOptions(P) {
  restoreStoryTilemapNoPriority(P);
  wr(P, "matchMenuSelection", 0);
  for (;;) {
    wr(P, "pauseMenuId", MENU_OPTIONS);
    yield* runStoryMenu(P);
    const sel = rd(P, "matchMenuSelection");
    if (sel === MATCHMENUSEL_CANCELLED) return sel;
    if (sel === 0) yield* storyPauseMenuMessageSpeed(P);
    else if (sel === 1) yield* storyPauseMenuMusicToggle(P);
    else throw new Error(`StoryPauseMenu_Options: item ${sel} jumps off its table`);
    wr(P, "matchMenuSelection", sel);                                  // StoryOptionsMenu_AfterItem
  }
}
// UnusedRunStoryPlayerDataMenu (06:6FEA): menu 1 from CHAR. DATA. Nothing calls it.
export function* unusedRunStoryPlayerDataMenu(P) {
  wr(P, "storyMenuFirstItem", ITEM_CHAR_DATA);
  wr(P, "pauseMenuId", MENU_PLAYER_DATA);
  yield* runStoryMenu(P);
}
// StoryPauseMenu_MessageSpeed (06:6FF7): SLOW / NORMAL / FAST into wMessageSpeed (shown as 2 - speed)
export function* storyPauseMenuMessageSpeed(P) {
  wr(P, "matchMenuSelection", MSG_SPEED_LEVELS - rd(P, "messageSpeed"));
  yield* runMessageSpeedMenu(P);
  const sel = rd(P, "matchMenuSelection");
  if (sel !== MATCHMENUSEL_CANCELLED) wr(P, "messageSpeed", MSG_SPEED_LEVELS - sel);
}
// StoryPauseMenu_MusicToggle (06:7013): ON / OFF: the music, and the save's flag A
export function* storyPauseMenuMusicToggle(P) {
  wr(P, "matchMenuSelection", P.V.music & 1);
  yield* runMusicOnOffMenu(P);
  const sel = rd(P, "matchMenuSelection");
  if (sel === MATCHMENUSEL_CANCELLED) return;
  home(P, HOME.SetMusicMuted, { a: sel });
  rom(P, FAR.SetStorySlotFlagA, { a: P.V.music & 1 });
}
// StoryPauseMenu_SaveQuit (06:702F): SAVE / TO MAIN MENU / CANCEL ("save?" in the caption, the cursor on CANCEL).
// SAVE: the story saved (with its return point), then the main menu. Returns a = 1 when it leaves for the main
// menu, 0 if cancelled.
export function* storyPauseMenuSaveQuit(P) {
  restoreStoryTilemapNoPriority(P);
  yield* drawStoryMenuCaption(P, Text_30_370, 0x00, 0x0E);
  wr(P, "matchMenuSelection", SAVE_QUIT_CANCEL);
  wr(P, "pauseMenuId", MENU_SAVE_QUIT);
  yield* runStoryMenu(P);
  const sel = rd(P, "matchMenuSelection");
  if (sel === MATCHMENUSEL_CANCELLED || sel === SAVE_QUIT_CANCEL) return 0;
  if (sel === SAVE_QUIT_TO_MAIN_MENU) return yield* storyPauseMenuReturnToMainMenu(P);
  wr(P, "saveAndQuitRequest", 1);
  wr(P, "messageSpeed", rd(P, "messageSpeed") & ~MESSAGE_SPEED_INSTANT);
  rom(P, FAR.SaveStoryReturnPoint, { bc: RETURN_POINT_NONE });
  rom(P, FAR.SaveStorySlotWithTimer);
  toMainMenu(P);
  return 1;
}
function toMainMenu(P) {
  wr(P, "storyModeCurrentLocation", STORYLOC_MAIN_MENU);
  wr(P, "storyModeEntryPoint", 1);
  wr(P, "unusedExitTriggerIdMirror", 0xFF);
  wr(P, "storyModeExitTriggerRequest", 0xFF);
}
// StoryPauseMenu_ReturnToMainMenu (06:7086): after 8 frames, the main menu without saving (the match aborts too)
export function* storyPauseMenuReturnToMainMenu(P) {
  yield* waitFrames(P, 8);
  wr(P, "matchExitRequest", 1);
  wr(P, "matchAbortFlag", MATCHABORT_ALL);
  toMainMenu(P);
  return 1;
}

// ---- the option menus (story_options_06) ----
// UnusedRunMessagesMusicMenu (06:70AC) / RunMessageSpeedMenu (06:70B4) / RunMusicOnOffMenu (06:70BC) /
// UnusedRunSaveQuitMenu (06:70C4): a two- or three-option row from item wStoryMenuFirstItem
export function* unusedRunMessagesMusicMenu(P) { wr(P, "storyMenuFirstItem", ITEM_MESSAGES); yield* runStoryTwoOptionMenu(P); }
export function* runMessageSpeedMenu(P) { wr(P, "storyMenuFirstItem", ITEM_MSG_SLOW); yield* runStoryThreeOptionMenu(P); }
export function* runMusicOnOffMenu(P) { wr(P, "storyMenuFirstItem", ITEM_MUSIC_ON); yield* runStoryTwoOptionMenu(P); }
export function* unusedRunSaveQuitMenu(P) { wr(P, "storyMenuFirstItem", ITEM_SAVE_GAME); yield* runStoryTwoOptionMenu(P); }
// the chosen option's item: wStoryMenuFirstItem + wMatchMenuSelection
const chosenItem = P => (rd(P, "storyMenuFirstItem") + rd(P, "matchMenuSelection")) & 0xFF;
// RunStoryTwoOptionMenu (06:70CC): two labels at columns 5 and $0B; the caption follows the cursor (but for the
// save menu); B cancels ($FF), A picks
export function* runStoryTwoOptionMenu(P) {
  const first = rd(P, "storyMenuFirstItem");
  drawStoryMenuItem(P, first, 0x05, 0x0A);
  drawStoryMenuItem(P, (first + 1) & 0xFF, 0x0B, 0x0A);
  if (first !== ITEM_SAVE_GAME) yield* drawStoryMenuCaption(P, captionOf(chosenItem(P)), 0x00, 0x0E);
  redrawStoryTilemapRows(P);
  loadStoryMenuItemGfx(P, chosenItem(P));
  for (;;) {
    if (readMatchInputPressed(P) & PADF_B) {
      sound(P, SFX_MENU_CANCEL);
      wr(P, "matchMenuSelection", MATCHMENUSEL_CANCELLED);
      break;
    }
    if (readMatchInputPressed(P) & PADF_A) { sound(P, SFX_MENU_SELECT); break; }
    const pad = readMatchInputRepeat(P) & (PADF_LEFT | PADF_RIGHT);
    if (pad) {
      wr(P, "matchMenuSelection", moveCursorHorizontal(rd(P, "matchMenuSelection"), pad, 2, 0).a);
      sound(P, SFX_MENU_MOVE);
      if (rd(P, "storyMenuFirstItem") !== ITEM_SAVE_GAME) {
        yield* drawStoryMenuCaption(P, captionOf(chosenItem(P)), 0x00, 0x0E);
        redrawStoryTilemapRows(P);
      }
      loadStoryMenuItemGfx(P, chosenItem(P));
    }
    const at = StoryTwoOptionCursorPositions + 2 * rd(P, "matchMenuSelection");
    queueStoryMenuCursorSprite(P, rb(P, at + 1), rb(P, at));
    yield* advanceFrame(P);
  }
  yield* advanceFrame(P);
}
// RunStoryThreeOptionMenu (06:717A): three labels at columns 3, 8 and $0D, the caption following the cursor; B
// cancels, A picks; the screen's maps restored after
export function* runStoryThreeOptionMenu(P) {
  restoreStoryTilemapNoPriority(P);
  const first = rd(P, "storyMenuFirstItem");
  drawStoryMenuItem(P, first, 0x03, 0x0A);
  drawStoryMenuItem(P, (first + 1) & 0xFF, 0x08, 0x0A);
  drawStoryMenuItem(P, (first + 2) & 0xFF, 0x0D, 0x0A);
  yield* drawStoryMenuCaption(P, captionOf(chosenItem(P)), 0x00, 0x0E);
  redrawStoryTilemapRows(P);
  loadStoryMenuItemGfx(P, chosenItem(P));
  for (;;) {
    if (readMatchInputPressed(P) & PADF_B) {
      sound(P, SFX_MENU_CANCEL);
      wr(P, "matchMenuSelection", MATCHMENUSEL_CANCELLED);
      break;
    }
    if (readMatchInputPressed(P) & PADF_A) { sound(P, SFX_MENU_SELECT); break; }
    const pad = readMatchInputRepeat(P) & (PADF_LEFT | PADF_RIGHT);
    if (pad) {
      wr(P, "matchMenuSelection", moveCursorHorizontal(rd(P, "matchMenuSelection"), pad, 3, 0).a);
      sound(P, SFX_MENU_MOVE);
      yield* drawStoryMenuCaption(P, captionOf(chosenItem(P)), 0x00, 0x0E);
      redrawStoryTilemapRows(P);
      loadStoryMenuItemGfx(P, chosenItem(P));
    }
    const at = StoryThreeOptionCursorPositions + 2 * rd(P, "matchMenuSelection");
    queueStoryMenuCursorSprite(P, rb(P, at + 1), rb(P, at));
    yield* advanceFrame(P);
  }
  restoreStoryTilemapNoPriority(P);
  yield* advanceFrame(P);
}
// RedrawStoryTilemapRows (06:7237): the text windows' maps redrawn (WRAM 5 left mapped)
export function redrawStoryTilemapRows(P) {
  wram(P, WRAM_TEXT);
  return rom(P, FAR.RedrawAllTilemapRows);
}
// RestoreStoryShadowTilemap (06:7241): the screen's maps back under the text windows
export function restoreStoryShadowTilemap(P) { return rom(P, FAR.RestoreShadowTilemap); }
// RestoreStoryTilemapNoPriority (06:7245): the same, with the attributes' priority bits cleared, redrawn
export function restoreStoryTilemapNoPriority(P) {
  rom(P, FAR.RestoreShadowTilemap);
  clearStoryAttrPriorityBits(P);
  return rom(P, FAR.RedrawAllTilemapRows);
}
// DrawStoryMenuCaption (06:724F): the caption window (a text window frame at screen cell (d, e)) with text hl
export function* drawStoryMenuCaption(P, text, x, y) {
  const de = (x << 8 | y) & 0xFFFF;
  prepareGlyphBuffer(P);
  rom(P, FAR.DrawTextWindowFrame, { a: 0, de, hl: text });
  const inner = (de + 0x0101) & 0xFFFF;
  yield* renderProportionalTextAt(P, text, getShadowTilemapAddr(P, inner >> 8, inner & 0xFF), 0x11);
  yield* uploadGlyphBuffer(P);
}
// ClearStoryAttrPriorityBits (06:726A): bit 7 of the 1024 attribute bytes after wShadowTilemapPtr's map cleared
// (WRAM 5 left mapped)
export function clearStoryAttrPriorityBits(P) {
  wram(P, WRAM_TEXT);
  let at = (rd16(P, "shadowTilemapPtr") + 0x400) & 0xFFFF;
  for (let n = 0x400; n > 0; n--, at = (at + 1) & 0xFFFF) w8(P, at, u8(P, at) & 0x7F);
  return { a: 0, bc: 0, hl: at, f: FZ };
}
// LoadStoryMenuItemGfx (06:7283): item a's label tiles (StoryMenuItemGfxPointers) to sprite tiles $70-$7F
export function loadStoryMenuItemGfx(P, item) {
  const src = rw(P, (StoryMenuItemGfxPointers + ((item * 2) & 0xFF)) & 0xFFFF);
  const bank = P.V.wramBank;
  wram(P, WRAM_STAGING);
  decompressData(P, src, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles0 + 0x70 * TILE_SIZE, ITEM_LABEL_BLOCKS);
  wram(P, bank);
}
// QueueStoryMenuCursorSprite (06:72CE): the story menu's cursor and label sprites at (d - 4, e)
export function queueStoryMenuCursorSprite(P, x, y) {
  const at = adjustSpriteCoordsForScroll(P, (x - 4) & 0xFF, y);
  return queueSpriteTemplate(P, QueueStoryMenuCursorSprite_SpriteTemplate, at.d, at.e, 0, 0);
}
// DrawStoryMenuItem (06:77A6): item a's 3x2 label at screen cell (d, e) of the text maps (attributes all 0)
export function drawStoryMenuItem(P, item, x, y) {
  copyTileRectToShadowTilemap(P, rw(P, (StoryMenuItemRectPointers + ((item * 2) & 0xFF)) & 0xFFFF), getShadowTilemapAddr(P, x, y), 3, 2);
  return copyTileRectToShadowAttrmap(P, MenuItemAttrRect3x2, getShadowAttrmapAddr(P, x, y), 3, 2);
}
// Unused_06_DrawStoryMenuItemRow (06:7863): an old 12x2 label row at (3, $0A). Only the unused menu loop draws it.
export function unusedDrawStoryMenuItemRow(P) {
  copyTileRectToShadowTilemap(P, StoryMenuItemRowTextRect, getShadowTilemapAddr(P, 0x03, 0x0A), 0x0C, 0x02);
  return copyTileRectToShadowAttrmap(P, TextRectAttrs_06, getShadowAttrmapAddr(P, 0x03, 0x0A), 0x0C, 0x02);
}
// CopyTileRectToShadowTilemap (06:7882) / CopyTileRectToShadowAttrmap (06:78AB): a b x c rectangle from hl into a
// 32x32 map at de, wrapping at its right edge and bottom (the tile map at $D000-$D3FF: `and $F3`; the attribute
// map at $D400-$D7FF: back to $D4xx past $D7FF)
function copyTileRect(P, src, dest, w, h, wrapRows) {
  let a = 0;
  for (let row = h || 0x100; row > 0; row--) {
    let at = dest;
    for (let n = w || 0x100; n > 0; n--) {
      a = u8(P, src); src = (src + 1) & 0xFFFF;
      w8(P, at, a); at = (at + 1) & 0xFFFF;
      if (!(at & 0x1F)) at = (at - 0x20) & 0xFFFF;
    }
    dest = wrapRows((dest + 0x20) & 0xFFFF);
  }
  return { a, hl: src, de: dest };
}
export const copyTileRectToShadowTilemap = (P, src, dest, w, h) =>
  copyTileRect(P, src, dest, w, h, de => (de & 0xF3FF));
export const copyTileRectToShadowAttrmap = (P, src, dest, w, h) =>
  copyTileRect(P, src, dest, w, h, de => ((de >> 8) >= 0xD8 ? 0xD400 | (de & 0xFF) : de));

const B = BANK;
export const HOOKS = [
  [B, 0x698B, hook(P => { unusedDrawMusicMenuRow(P); })],
  [B, 0x69B7, hook((P, c) => { queueMatchMenuCursorSprite(P, c.d, c.e); })],
  [B, DrawScoreboardModeTitle, hook(P => { drawScoreboardModeTitle(P); })],
  [B, 0x6ABA, hook(P => { unusedDrawDebugStatsLabels(P); })],
  [B, 0x6AF3, hook(P => { unusedDrawDebugStatsValues(P); })],
  [B, 0x6B84, hookGen(P => unusedRunDebugStatsEditor(P))],
  [B, 0x6BF6, hook(P => { unusedHandleDebugStatsInput(P); })],
  [B, 0x6C13, hook(P => { unusedQueueDebugStatsCursorSprites(P); })],
  [B, 0x6C32, hook(P => { unusedAdjustSelectedDebugStat(P); })],
  [B, 0x6C9D, hook((P, c) => { unusedAdjustDebugStatDigit(P, c.hl); })],
  [B, 0x6CA8, hook((P, c) => { unusedAdjustDebugStatByte(P, c.hl, c.b); })],
  [B, 0x6CBB, hook((P, c) => { unusedAdjustDebugStatWord(P, c.hl, c.bc); })],
  [B, 0x6D10, hookGen(P => runStoryMenu(P))],
  [B, 0x6D74, hook((P, c) => ({ a: getStoryMenuItemId(P, c.a), b: c.a }))],
  [B, 0x6D8A, hook(P => ({ a: getStoryMenuItemCount(P) }))],
  [B, 0x6D99, hook(P => { drawStoryMenuItems(P); })],
  [B, 0x6DDD, hook(P => { drawStoryMenuCursor(P); })],
  [B, 0x6E17, hookGen(P => runStoryModeMenu(P))],
  [B, 0x6EC7, hookGen(P => unusedStoryMenuRedrawReentry(P))],
  [B, 0x6F42, hookGen(function* (P) { return { a: yield* storyPauseMenuPlayerData(P) }; })],
  [B, 0x6F66, hookGen(function* (P) { return { a: yield* storyPauseMenuCharPartnerData(P) }; })],
  [B, 0x6F84, hookGen(function* (P) { return { a: yield* storyPauseMenuEquipment(P) }; })],
  [B, 0x6FA0, hookGen(function* (P) { return { a: yield* storyPauseMenuGameProgress(P) }; })],
  [B, 0x6FBC, hookGen(function* (P) { return { a: yield* storyPauseMenuOptions(P) }; })],
  [B, 0x6FEA, hookGen(P => unusedRunStoryPlayerDataMenu(P))],
  [B, 0x6FF7, hookGen(P => storyPauseMenuMessageSpeed(P))],
  [B, 0x7013, hookGen(P => storyPauseMenuMusicToggle(P))],
  [B, 0x702F, hookGen(function* (P) { return { a: yield* storyPauseMenuSaveQuit(P) }; })],
  [B, 0x7086, hookGen(function* (P) { return { a: yield* storyPauseMenuReturnToMainMenu(P) }; })],
  [B, 0x70AC, hookGen(P => unusedRunMessagesMusicMenu(P))],
  [B, 0x70B4, hookGen(P => runMessageSpeedMenu(P))],
  [B, 0x70BC, hookGen(P => runMusicOnOffMenu(P))],
  [B, 0x70C4, hookGen(P => unusedRunSaveQuitMenu(P))],
  [B, 0x70CC, hookGen(P => runStoryTwoOptionMenu(P))],
  [B, 0x717A, hookGen(P => runStoryThreeOptionMenu(P))],
  [B, 0x7237, hook(P => { redrawStoryTilemapRows(P); })],
  [B, 0x7241, hook(P => { restoreStoryShadowTilemap(P); })],
  [B, 0x7245, hook(P => { restoreStoryTilemapNoPriority(P); })],
  [B, 0x724F, hookGen((P, c) => drawStoryMenuCaption(P, c.hl, c.d, c.e))],
  [B, 0x726A, hook(P => clearStoryAttrPriorityBits(P))],
  [B, 0x7283, hook((P, c) => { loadStoryMenuItemGfx(P, c.a); })],
  [B, 0x72CE, hook((P, c) => { queueStoryMenuCursorSprite(P, c.d, c.e); })],
  [B, 0x77A6, hook((P, c) => { drawStoryMenuItem(P, c.a, c.d, c.e); })],
  [B, 0x7863, hook(P => { unusedDrawStoryMenuItemRow(P); })],
  [B, 0x7882, hook((P, c) => copyTileRectToShadowTilemap(P, c.hl, c.de, c.b, c.c))],
  [B, 0x78AB, hook((P, c) => copyTileRectToShadowAttrmap(P, c.hl, c.de, c.b, c.c))],
];
