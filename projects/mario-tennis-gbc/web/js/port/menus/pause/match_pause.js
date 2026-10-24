// The match pause menu (bank 6): START in a match (RunMatchPauseMenu), the minigame-end menu (RunMinigameEndMenu),
// the message window of a match (ShowMessageWindow) and the scoreboard screen after a won minigame
// (ShowMatchScoreboardScreen). The match stays on screen, frozen; each menu frame is a StepMatchFrame (bank 8).
//   - The pause menu: the scoreboard (scoreboard.js) over the court, a row of item labels (3x2 tiles each, drawn in
//     the court's map buffers in WRAM 2, wCourtTilemap / wCourtAttrmap, saved first in ...Saved) and a cursor
//     sprite; the caption window under it names the chosen item. Menus (MatchMenuDefs, wPauseMenuId):
//       0 RULES / CONTROLS / OPTIONS / SAVE (1 with MUSIC for OPTIONS, when the camera is locked)
//       2 CAMERA MODE / MUSIC; 3 NORMAL / PLAYER; 4 ON / OFF
//       5-13 the save/quit menus, by game mode (SaveQuitMenuIdByGameMode); 14 the minigame-end menu
//     Left / right move the cursor (RunMatchMenu), A picks, B or START cancel (wMatchMenuSelection = $FF).
//   - RULES: the rules pages (a caption window and a page window; A or B turns the page), by mode.
//   - CONTROLS: the controls page until A or B (UP with the debug stepper on swaps character 0's pad source).
//   - SAVE: SAVE GAME / QUIT / RETRY / SELECT NEW LEVEL set the match's exit requests and wMatchAbortFlag.
// Port of src/engine/menus/pause/pause_menu_06.asm and match_menu_06.asm of the gerbiljames/mario-tennis-gbc-disasm
// (MIT, third_party/mario-tennis-gbc-disasm): names and addresses are its own; tables are read from the ROM.
// Tests: lockstep on out/engine/rec1.mtrec (a ranking match paused) and out/port/pause_*.mtrec (each item);
// web/tests/port/routines_menus_pause.mjs.
import {
  FAR, HOME, rom, romWait, home, homeWait, far, wram, rd, wr, rd16, wr16, u8, w8, sound, advanceFrame, stepMatchFrame,
  readMatchInputPressed, readMatchInputRepeat, prepareGlyphBuffer, uploadGlyphBuffer, renderProportionalTextAt,
  registerFrameTask, unregisterFrameTask, queueVRAMCopy, copyMemoryFast, queueSprite16, hook, hookGen, orFlags, cpFlags,
  FZ, WRAM_COURT_PLANES, WRAM_CHAR0, TILE_SIZE, TILEMAP_WIDTH, VRAM_BANK1, vTiles0, vBGMap0, OAM_BANK1,
  wCourtTilemap, wCourtAttrmap, wCourtTilemapSaved, wCourtAttrmapSaved, wActiveTilemap, wActiveAttrmap, wCharInputSource,
  PADF_A, PADF_B, PADF_START, PADF_UP, PADF_LEFT, PADF_RIGHT, SFX_MENU_MOVE, SFX_MENU_SELECT, SFX_MENU_CANCEL,
  SFX_PAUSE_MENU, GAMEMODE_MARIO_MINIGAME, GAMEMODE_LINK_MATCH, MATCHCONTEXT_MINIGAME, MINIGAME_BOO_BLAST,
  MATCHMENUSEL_CANCELLED, MATCHABORT_ALL,
} from "./defs.js";
import { drawWindowFrame, copyTextRect, moveCursorHorizontal } from "../../home/ui.js";
import { prepareScoreboardGfx, loadScoreboardModeGfx, drawScoreboard, loadMatchMenuItemGfx, drawMatchMenuItem,
  DrawScoreboardSprites, ScoreboardModeGfxTail, SCOREBOARD_TAIL_BLOCKS } from "./scoreboard.js";
import { queueMatchMenuCursorSprite, DrawScoreboardModeTitle } from "./story_pause.js";

export const BANK_PAUSE = 0x06;
const rb = (P, a) => P.rom.u8(BANK_PAUSE, a), rw = (P, a) => P.rom.u16(BANK_PAUSE, a);
// tables (bank 6)
const MatchRulesPageLists = 0x4165, TrainingRulesPageLists = 0x41A9, MinigameRulesTextIdBases = 0x4262;
const MinigameRulesPageLists = 0x4274, SaveQuitMenuIdByGameMode = 0x44F3, MatchMenuDefs = 0x466F;
const MatchMenuItemPosPointers = 0x4857, MatchMenuCursorPosPointers = 0x4891;
export const DrawRulesNextPageArrow_06 = 0x4373;
const MENU_DEF_SIZE = 8, MENU_DEF_COUNT = 4;                // {item ids x4, count, 0 x3}
const RULES_PAGES_END = 0xFF;
// text ids (include/text_ids.inc)
const Text_26_37 = 0x2C25, Text_26_43 = 0x2C2B, Text_26_71 = 0x2C47, Text_26_98 = 0x2C62, Text_26_106 = 0x2C6A;
const Text_30_343 = 0x0157, Text_30_344 = 0x0158, Text_30_345 = 0x0159, Text_30_346 = 0x015A, Text_30_347 = 0x015B;
const Text_30_348 = 0x015C, Text_30_349 = 0x015D, Text_30_350 = 0x015E;
const MATCH_MENU_CAPTIONS = 0x013F;                        // + the item id: the caption text of each menu item
// MENU: Wheel: short names for the item labels (drawn as tiles by the game) and the menus' titles, from their captions
const MENU_ITEM_LABELS = ["RULES", "CONTROLS", "OPTIONS", "SAVE", "CAMERA", "MUSIC", "NORMAL", "PLAYER", "ON", "OFF", "RETURN", "SAVE",
  "QUIT", "NEW LEVEL", "RETRY", "RETRY", "RETRY", "RETRY", "RETRY", "QUIT", "QUIT", "QUIT", "QUIT", "QUIT"];
const MENU_TITLES = ["PAUSE", "PAUSE", "OPTIONS", "CAMERA", "MUSIC", "PAUSE", "PAUSE", "PAUSE", "PAUSE", "PAUSE", "PAUSE", "PAUSE", "PAUSE", "PAUSE", "MINI-GAME"];
// the pause menus (wPauseMenuId)
const MENU_PAUSE = 0, MENU_PAUSE_LOCKED_VIEW = 1, MENU_OPTIONS = 2, MENU_CAMERA = 3, MENU_MUSIC = 4;
const MENU_PRACTICE_LESSON = 8, MENU_MINIGAME_END = 0x0E;
const ITEM_FIRST_QUIT = 0x0A;                              // MATCHMENUITEM_CANCEL: the quit menus' items from here
const SCOREBOARD_TASK_PRIORITY = 0x0A;
const MESSAGE_HOLD_FRAMES = 30;
const MENU_ROW = 0x0C, ATTR_PRIORITY_CLEARED = 0x40;       // RunMatchMenu: the attribute priority cleared, 2 rows
const QUIT_REGION_ROW = 0x0A, QUIT_REGION_ROWS = 7;        // RestoreBgTilemapRegion: rows $0A-$10 of the screen
const FLUSH_ROWS = 17;
const TEXT_PEN_START = 0x2000, TEXT_ROW_COLUMN = 0x40;

// ---- the court's map buffers through the scroll (WRAM 2 / 5 mapped by the caller) ----
// GetScrolledTilemapRowOffset (06:464B): the map offset of screen row e: ((hScrollY + 7) / 8 + e) mod 32, times 32
export function getScrolledTilemapRowOffset(P, row) {
  return ((((P.V.scrollY + 7) & 0xFF) >> 3) + row & 0x1F) * TILEMAP_WIDTH;
}
// GetScrolledTilemapOffset (06:4638): the map offset of screen cell (d, e) (the column through hScrollX too)
export function getScrolledTilemapOffset(P, x, y) {
  const col = ((((P.V.scrollX + 7) & 0xFF) >> 3) + x) & 0x1F;
  return { hl: getScrolledTilemapRowOffset(P, y) + col, a: col };
}
// GetShadowTilemapAddr (06:4624) / GetShadowAttrmapAddr (06:462E): screen cell (d, e) in wActiveTilemap /
// wActiveAttrmap. Leave de = hl = the address.
export function getShadowTilemapAddr(P, x, y) { return (wActiveTilemap + getScrolledTilemapOffset(P, x, y).hl) & 0xFFFF; }
export function getShadowAttrmapAddr(P, x, y) { return (wActiveAttrmap + getScrolledTilemapOffset(P, x, y).hl) & 0xFFFF; }
// AdjustSpriteCoordsForScroll (06:465E): a sprite position (d, e) moved by the fine scroll ((-hScrollX) & 7, ...)
export function adjustSpriteCoordsForScroll(P, x, y) {
  return { d: (((-P.V.scrollX) & 7) + x) & 0xFF, e: (((-P.V.scrollY) & 7) + y) & 0xFF };
}

// ---- drawing into the court's maps ----
// DrawWindowFrameAt (06:4564): a window frame (no priority) at screen cell (x, y), w x h
export function drawWindowFrameAt(P, x, y, w, h) {
  P.V.windowFrameAttr = 0;
  drawWindowFrame(P, getShadowTilemapAddr(P, x, y), getShadowAttrmapAddr(P, x, y), w, h);
}
// DrawMenuTextLine (06:4574): text `text` at screen cell (x, y) in the menu style (RenderProportionalMenuText).
// Leaves de = (x, y + 2) and hl = text + 1: the next line's.
export function* drawMenuTextLine(P, text, x, y) {
  yield* homeWait(P, 0x2A9E, { hl: text, de: getShadowTilemapAddr(P, x, y) });
  return { de: (x << 8 | (y + 2) & 0xFF) & 0xFFFF, hl: (text + 1) & 0xFFFF };
}
// DrawMenuCaptionWindow (06:4584): a caption window ($13 x 3, attribute 1) at screen cell (x, y), the text inside
export function* drawMenuCaptionWindow(P, text, x, y) {
  const attrs = getShadowAttrmapAddr(P, x, y), tiles = getShadowTilemapAddr(P, x, y);
  P.V.windowFrameAttr = 1;
  drawWindowFrame(P, tiles, attrs, 0x13, 0x03);
  yield* homeWait(P, 0x2A9E, { hl: text, de: getShadowTilemapAddr(P, (x + 1) & 0xFF, (y + 1) & 0xFF) });
}
// RestoreBgTilemap (06:45AA): the court's maps back from their saved copies (WRAM 2)
export function restoreBgTilemap(P) {
  copyMemoryFast(P, wCourtTilemapSaved, wCourtTilemap, 0x400 / 16);
  copyMemoryFast(P, wCourtAttrmapSaved, wCourtAttrmap, 0x400 / 16);
}
// RestoreBgTilemapRegion (06:45C1): the same for the 7 screen rows from row $0A (the menu row and its caption)
export function restoreBgTilemapRegion(P) {
  const off = getScrolledTilemapRowOffset(P, QUIT_REGION_ROW), blocks = QUIT_REGION_ROWS * TILEMAP_WIDTH / 16;
  copyMemoryFast(P, wCourtTilemapSaved + off, wCourtTilemap + off, blocks);
  copyMemoryFast(P, wCourtAttrmapSaved + off, wCourtAttrmap + off, blocks);
}
// ClearAttrPriorityRegion (06:45E9): clear the BG-priority bit of bc attribute bytes from hl
export function clearAttrPriorityRegion(P, at, count) {
  do { w8(P, at, u8(P, at) & 0x7F); at = (at + 1) & 0xFFFF; count = (count - 1) & 0xFFFF; } while (count);
  return { hl: at };
}
// FlushTilemapToVram (06:45F8), also slot $400A; Unused_06_FlushTilemapToVramIfDirty (06:45F3) does it only when
// wTilemapDirtyFlag is set: the 17 screen rows of the court's maps (from the scrolled top row) queued to $9800 in
// both VRAM banks; wTilemapDirtyFlag cleared
export function flushTilemapToVram(P) {
  wr(P, "tilemapDirtyFlag", 0);
  const off = getScrolledTilemapRowOffset(P, 0), blocks = FLUSH_ROWS * TILEMAP_WIDTH / 16;
  queueVRAMCopy(P, wCourtTilemap + off, vBGMap0 + off, blocks);
  // (the last copy through the ROM's address: it returns every register as QueueVRAMCopy leaves them; b is still the
  // offset's high byte)
  return home(P, 0x0480, { hl: wCourtAttrmap + off, de: vBGMap0 + off + VRAM_BANK1, b: off >> 8, c: blocks });
}
export function unusedFlushTilemapToVramIfDirty(P) {
  if (!rd(P, "tilemapDirtyFlag")) return { a: 0, f: FZ };
  return flushTilemapToVram(P);
}

// ---- the pause menus ----
// GetMatchMenuItemId (06:480A): the item id at position a of menu wPauseMenuId
export function getMatchMenuItemId(P, pos) { return rb(P, (MatchMenuDefs + rd(P, "pauseMenuId") * MENU_DEF_SIZE + pos) & 0xFFFF); }
// GetMatchMenuItemCount (06:4820): menu wPauseMenuId's item count
export function getMatchMenuItemCount(P) { return rb(P, (MatchMenuDefs + ((rd(P, "pauseMenuId") * MENU_DEF_SIZE) & 0xFF) + MENU_DEF_COUNT) & 0xFFFF); }
// DrawMatchMenuItems (06:482F): each item's label at its place for this item count (MatchMenuItemPosPointers)
export function drawMatchMenuItems(P) {
  const count = rd(P, "pauseMenuItemCount");
  const places = rw(P, MatchMenuItemPosPointers + 2 * count);
  for (let i = 0; i < count; i++) drawMatchMenuItem(P, getMatchMenuItemId(P, i), rb(P, places + 2 * i + 1), rb(P, places + 2 * i));   // (e = row, then d = column)
}
// DrawMatchMenuCursor (06:4873): the cursor sprite over the chosen item (MatchMenuCursorPosPointers)
export function drawMatchMenuCursor(P) {
  const places = rw(P, MatchMenuCursorPosPointers + 2 * rd(P, "pauseMenuItemCount"));
  const at = (places + 2 * rd(P, "matchMenuSelection")) & 0xFFFF;
  queueMatchMenuCursorSprite(P, rb(P, at + 1), rb(P, at));
}
// RunMatchMenu (06:46E7): the menu wPauseMenuId with the cursor at wMatchMenuSelection, until A (the item
// chosen stays in wMatchMenuSelection) or B / START (MATCHMENUSEL_CANCELLED). Each move redraws the caption
// (the item's label tiles, its caption text, the scoreboard caption).
export function* runMatchMenu(P) {
  const count = getMatchMenuItemCount(P);
  wr(P, "pauseMenuItemCount", count);
  if (P.menuWheel) P.menuWheel.pauseMore = false;           // (OPTIONS: MORE not chosen)
  drawMatchMenuItems(P);
  clearAttrPriorityRegion(P, (getScrolledTilemapRowOffset(P, MENU_ROW) + wCourtAttrmap) & 0xFFFF, ATTR_PRIORITY_CLEARED);
  let redraw = true;
  for (;;) {
    if (redraw) {
      prepareGlyphBuffer(P);
      wr16(P, "glyphPenX", TEXT_PEN_START);
      for (let i = 0; i < 3; i++) wr(P, "textRowColumn", TEXT_ROW_COLUMN, i);
      const id = getMatchMenuItemId(P, rd(P, "matchMenuSelection"));
      loadMatchMenuItemGfx(P, id);
      yield* drawMenuCaptionWindow(P, (MATCH_MENU_CAPTIONS + id) & 0xFFFF, 0x00, 0x0E);
      yield* drawScoreboardCaption(P);
      yield* uploadGlyphBuffer(P);
      yield* stepMatchFrame(P);
      flushTilemapToVram(P);
      yield* stepMatchFrame(P);
    }
    drawMatchMenuCursor(P);
    const wheel = P.menuWheel && P.menuWheel.on, more = wheel && rd(P, "pauseMenuId") <= MENU_OPTIONS;   // MENU: Wheel; OPTIONS: a "MORE" item after the game's (pause menus, OPTIONS)
    if (wheel) {                                             // MENU: Wheel (menuskins.js): the items and their captions, read only
      const ids = Array.from({ length: rd(P, "pauseMenuItemCount") }, (_, i) => getMatchMenuItemId(P, i)), menu = rd(P, "pauseMenuId");
      const labels = ids.map(i => MENU_ITEM_LABELS[i] || ""), captions = ids.map(i => (MATCH_MENU_CAPTIONS + i) & 0xFFFF);
      if (more) { labels.push("MORE"); captions.push("Picture, stadium, menus and play"); }
      P.menuWheel.skin = { id: "tabs", at: P.frames, icon: "pause", title: MENU_TITLES[menu] || "PAUSE", labels, captions, sel: more && P.menuWheel.pauseMore ? ids.length : rd(P, "matchMenuSelection") };
    }
    yield* stepMatchFrame(P);
    redraw = false;
    if (more && P.menuWheel.pauseMore) {                     // OPTIONS: on MORE (not an item of the game's: its cursor stays on the last one)
      const input = readMatchInputPressed(P);
      if (input & PADF_A) {                                  // the options panel (menuwheel.js) until B; the match stays frozen
        sound(P, SFX_MENU_SELECT); P.menuWheel.openOptions();
        while (P.menuWheel.optionsOpen) {
          yield* stepMatchFrame(P);
          const s = P.menuWheel.optionsInput(readMatchInputPressed(P));
          if (s) sound(P, s === "move" ? SFX_MENU_MOVE : s === "select" ? SFX_MENU_SELECT : SFX_MENU_CANCEL);
        }
        continue;
      }
      if (readMatchInputRepeat(P) & PADF_LEFT) { P.menuWheel.pauseMore = false; sound(P, SFX_MENU_MOVE); continue; }
      if (!(input & (PADF_B | PADF_START))) continue;
    } else if (more && (readMatchInputRepeat(P) & PADF_RIGHT) && rd(P, "matchMenuSelection") === rd(P, "pauseMenuItemCount") - 1) {
      P.menuWheel.pauseMore = true; sound(P, SFX_MENU_MOVE); continue;
    }
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
  yield* stepMatchFrame(P);
}

// DrawScoreboardCaption (06:477A): the scoreboard's caption, by wScoreboardLayout (0-2 "SET / GAME / POINT",
// 3-5 "TOTAL", 6 the score and its target, 7 the score and the high score), placed from wScoreboardOrigin
export function* drawScoreboardCaption(P) {
  const layout = rd(P, "scoreboardLayout"), origin = rd16(P, "scoreboardOrigin");
  const at = (offset, text) => drawMenuTextLine(P, text, ((origin + offset) >> 8) & 0xFF, (origin + offset) & 0xFF);
  if (layout <= 2) return yield* at(0x0701, Text_30_346);                    // ScoreboardCaption_SetGamePoint
  if (layout <= 5) return yield* at(0x0E01, Text_30_347);                    // ScoreboardCaption_Total
  if (layout === 6) {                                                         // ScoreboardCaption_ScoreTarget
    yield* at(0x0502, Text_30_348);
    yield* at(0x0304, Text_30_349);
    return yield* at(0x0505, Text_30_348);
  }
  if (layout === 7) {                                                         // ScoreboardCaption_ScoreHigh
    yield* at(0x0502, Text_30_348);
    yield* at(0x0404, Text_30_350);
    return yield* at(0x0505, Text_30_348);
  }
  throw new Error(`DrawScoreboardCaption: layout ${layout} jumps off its table`);
}

// RunMatchPauseMenu (06:4074), slot $4000: the pause menu (see the header). hLinkPayloadKind is 2 meanwhile.
export function* runMatchPauseMenu(P) {
  const { V } = P;
  const bank = V.wramBank, entryF = P.cpu.f, payload = V.linkPayloadKind;
  yield* stepMatchFrame(P);
  yield* stepMatchFrame(P);
  sound(P, SFX_PAUSE_MENU);
  wr(P, "matchMenuSelection", 0);
  V.linkPayloadKind = 2;
  yield* prepareScoreboardGfx(P);
  yield* stepMatchFrame(P);
  loadScoreboardModeGfx(P);
  queueVRAMCopy(P, ScoreboardModeGfxTail, vTiles0 + 0x64 * TILE_SIZE, SCOREBOARD_TAIL_BLOCKS);
  yield* stepMatchFrame(P);
  wram(P, WRAM_COURT_PLANES);
  for (;;) {
    drawScoreboard(P, 0);
    registerFrameTask(P, SCOREBOARD_TASK_PRIORITY, DrawScoreboardSprites);
    registerFrameTask(P, SCOREBOARD_TASK_PRIORITY, DrawScoreboardModeTitle);
    wr(P, "pauseMenuId", rd(P, "courtViewLocked") ? MENU_PAUSE_LOCKED_VIEW : MENU_PAUSE);
    yield* runMatchMenu(P);
    const sel = rd(P, "matchMenuSelection");
    if (sel === MATCHMENUSEL_CANCELLED) break;
    if (sel === 0) yield* matchPauseMenuCheckRules(P);
    else if (sel === 1) yield* matchPauseMenuReviewControls(P);
    else if (sel === 2) yield* matchPauseMenuChangeOptions(P);
    else if (sel === 3) yield* matchPauseMenuSaveQuit(P);
    else throw new Error(`RunMatchPauseMenu: item ${sel} jumps off its table`);
    wr(P, "matchMenuSelection", sel);                                          // MatchPauseMenu_AfterItem
    if (rd(P, "matchAbortFlag")) break;
  }
  unregisterFrameTask(P, DrawScoreboardSprites);
  unregisterFrameTask(P, DrawScoreboardModeTitle);
  restoreBgTilemap(P);
  flushTilemapToVram(P);
  yield* stepMatchFrame(P);
  yield* stepMatchFrame(P);
  V.linkPayloadKind = payload;
  wram(P, bank);
  return { a: bank, f: entryF };
}

// RunMinigameEndMenu (06:400E), slot $400C: after a lost minigame, the scoreboard and menu 14 (RETRY / LEVEL
// SELECT / MAIN MENU) until an item is chosen (B is ignored)
export function* runMinigameEndMenu(P) {
  const bank = P.V.wramBank, entryF = P.cpu.f;
  yield* stepMatchFrame(P);
  yield* prepareScoreboardGfx(P);
  yield* stepMatchFrame(P);
  loadScoreboardModeGfx(P);
  queueVRAMCopy(P, ScoreboardModeGfxTail, vTiles0 + 0x64 * TILE_SIZE, SCOREBOARD_TAIL_BLOCKS);
  yield* stepMatchFrame(P);
  wram(P, WRAM_COURT_PLANES);
  drawScoreboard(P, 0);
  registerFrameTask(P, SCOREBOARD_TASK_PRIORITY, DrawScoreboardSprites);
  registerFrameTask(P, SCOREBOARD_TASK_PRIORITY, DrawScoreboardModeTitle);
  do {
    wr(P, "matchMenuSelection", 0);
    wr(P, "pauseMenuId", MENU_MINIGAME_END);
    yield* runMatchQuitMenu(P);
  } while (rd(P, "matchMenuSelection") === MATCHMENUSEL_CANCELLED);
  unregisterFrameTask(P, DrawScoreboardSprites);
  unregisterFrameTask(P, DrawScoreboardModeTitle);
  restoreBgTilemap(P);
  flushTilemapToVram(P);
  yield* stepMatchFrame(P);
  wram(P, bank);
  return { a: bank, f: entryF };
}

// ---- RULES ----
// MatchPauseMenu_CheckRules (06:4110): the rules pages for this mode, over the court
export function* matchPauseMenuCheckRules(P) {
  unregisterFrameTask(P, DrawScoreboardSprites);
  restoreBgTilemap(P);
  if (rd(P, "gameMode") === GAMEMODE_MARIO_MINIGAME) yield* showMinigameRulesPages(P);
  else if (rd(P, "matchContext") === MATCHCONTEXT_MINIGAME) yield* showTrainingRulesPages(P);
  else yield* showMatchRulesPages(P);
  restoreBgTilemap(P);                                                        // MatchPauseMenu_AfterRules
}
// ShowMatchRulesPages (06:4133): a match's rules by its format (list games + 2 * sets)
export function* showMatchRulesPages(P) {
  const list = (rd(P, "rulesGamesIndex") + 2 * rd(P, "rulesSetsIndex")) & 0xFF;
  wr(P, "rulesPageListIndex", list);
  wr16(P, "rulesTitleTextId", Text_26_37 + list);
  wr16(P, "rulesFirstPageTextId", Text_26_98);
  yield* showRulesPageSequence(P, (MatchRulesPageLists + ((list * 4) & 0xFF)) & 0xFFFF);
}
// ShowTrainingRulesPages (06:417D): a training drill's rules (list = the drill)
export function* showTrainingRulesPages(P) {
  const list = rd(P, "currentMinigameStoryMatch", 1);
  wr(P, "rulesPageListIndex", list);
  wr16(P, "rulesTitleTextId", Text_26_43 + list);
  wr16(P, "rulesFirstPageTextId", Text_26_106);
  yield* showRulesPageSequence(P, (TrainingRulesPageLists + ((list * 4) & 0xFF)) & 0xFFFF);
}
// ShowMinigameRulesPages (06:421D): a Mario minigame's rules (list = 3 * minigame + level)
export function* showMinigameRulesPages(P) {
  const game = (rd(P, "currentMinigameStoryMatch", 1) - MINIGAME_BOO_BLAST) & 0xFF;
  const list = (game * 3 + rd(P, "minigameLevel")) & 0xFF;
  wr(P, "rulesPageListIndex", list);
  wr16(P, "rulesTitleTextId", Text_26_71 + list);
  wr16(P, "rulesFirstPageTextId", rw(P, (MinigameRulesTextIdBases + ((game * 2) & 0xFF)) & 0xFFFF));
  yield* showRulesPageSequence(P, (MinigameRulesPageLists + ((list * 6) & 0xFF)) & 0xFFFF);
}
// ShowRulesPageSequence (06:4316): each page of the list at hl ($FF-ended: page numbers from wRulesFirstPageTextId)
// under the title wRulesTitleTextId, the next-page arrow while more follow; A or B turns the page
export function* showRulesPageSequence(P, list) {
  for (;;) {
    const page = rb(P, list);
    list = (list + 1) & 0xFFFF;
    if (page === RULES_PAGES_END) return;
    if (rb(P, list) !== RULES_PAGES_END) registerFrameTask(P, 1, DrawRulesNextPageArrow_06);
    prepareGlyphBuffer(P);
    yield* drawMenuCaptionWindow(P, rd16(P, "rulesTitleTextId"), 0x00, 0x02);
    drawWindowFrameAt(P, 0x00, 0x05, 0x13, 0x0B);
    yield* drawMenuTextLine(P, (rd16(P, "rulesFirstPageTextId") + page) & 0xFFFF, 0x01, 0x06);
    yield* stepMatchFrame(P);
    yield* uploadGlyphBuffer(P);
    flushTilemapToVram(P);
    do yield* stepMatchFrame(P); while (!(readMatchInputPressed(P) & (PADF_A | PADF_B)));
    sound(P, SFX_MENU_SELECT);
    unregisterFrameTask(P, DrawRulesNextPageArrow_06);
  }
}
// DrawRulesNextPageArrow_06 (06:4373), a frame task: the bobbing next-page arrow at ($90, $80)
export function drawRulesNextPageArrow06(P) {
  const { e } = rom(P, FAR.AddBobbingOffsetY, { d: 0x90, e: 0x80 });
  return queueSprite16(P, OAM_BANK1 | 2, 0x70, 0x90, e);
}

// ---- CONTROLS ----
// MatchPauseMenu_ReviewControls (06:4380): the controls page until A or B; with the debug stepper on, UP swaps
// character 0's pad source (wCharInputSource bit 0, WRAM 4) and closes it
export function* matchPauseMenuReviewControls(P) {
  unregisterFrameTask(P, DrawScoreboardSprites);
  restoreBgTilemap(P);
  drawWindowFrameAt(P, 0x00, 0x02, 0x13, 0x0E);
  prepareGlyphBuffer(P);
  yield* drawMenuTextLine(P, Text_30_343, 0x01, 0x03);
  yield* drawMenuTextLine(P, Text_30_344, 0x06, 0x0A);
  yield* drawMenuTextLine(P, Text_30_345, 0x01, 0x0C);
  yield* uploadGlyphBuffer(P);
  flushTilemapToVram(P);
  yield* stepMatchFrame(P);
  for (;;) {
    if (readMatchInputPressed(P) & (PADF_A | PADF_B)) break;
    if (readMatchInputPressed(P) & PADF_UP && P.V.debugStepMode) {
      const bank = P.V.wramBank;
      wram(P, WRAM_CHAR0);
      w8(P, wCharInputSource, u8(P, wCharInputSource) ^ 1);
      wram(P, bank);
      break;
    }
    yield* stepMatchFrame(P);
  }
  restoreBgTilemap(P);
  sound(P, SFX_MENU_CANCEL);
}

// ---- OPTIONS ----
// MatchPauseMenu_ChangeOptions (06:43EE): CAMERA MODE / MUSIC (only MUSIC when the camera is locked)
export function* matchPauseMenuChangeOptions(P) {
  restoreBgTilemapRegion(P);
  if (rd(P, "courtViewLocked")) return yield* matchPauseMenuMusicToggle(P);
  wr(P, "matchMenuSelection", 0);
  for (;;) {
    wr(P, "pauseMenuId", MENU_OPTIONS);
    yield* runMatchMenu(P);
    const sel = rd(P, "matchMenuSelection");
    if (sel === MATCHMENUSEL_CANCELLED) return;
    if (sel === 0) yield* matchPauseMenuCameraSelect(P);
    else if (sel === 1) yield* matchPauseMenuMusicToggle(P);
    else throw new Error(`MatchPauseMenu_ChangeOptions: item ${sel} jumps off its table`);
    wr(P, "matchMenuSelection", sel);                                          // MatchOptionsMenu_AfterItem
  }
}
// MatchPauseMenu_CameraSelect (06:441E): NORMAL / PLAYER into wCourtViewOption (and the save's flag B)
export function* matchPauseMenuCameraSelect(P) {
  wr(P, "matchMenuSelection", rd(P, "courtViewOption"));
  wr(P, "pauseMenuId", MENU_CAMERA);
  yield* runMatchMenu(P);
  const sel = rd(P, "matchMenuSelection");
  if (sel === MATCHMENUSEL_CANCELLED) return;
  wr(P, "courtViewOption", sel);
  rom(P, FAR.SetStorySlotFlagB, { a: sel });
}
// MatchPauseMenu_MusicToggle (06:443A): ON / OFF: the music muted or not (and the save's flag A, but in a link match)
export function* matchPauseMenuMusicToggle(P) {
  wr(P, "matchMenuSelection", P.V.music & 1);
  wr(P, "pauseMenuId", MENU_MUSIC);
  yield* runMatchMenu(P);
  const sel = rd(P, "matchMenuSelection");
  if (sel === MATCHMENUSEL_CANCELLED) return;
  home(P, HOME.SetMusicMuted, { a: sel });
  if (rd(P, "gameMode") === GAMEMODE_LINK_MATCH) return;
  rom(P, FAR.SetStorySlotFlagA, { a: P.V.music & 1 });
}

// ---- SAVE / QUIT ----
// MatchPauseMenu_SaveQuit (06:4462): this mode's save/quit menu (the practice lesson's own), the cursor on its last
// item (CANCEL), then RunMatchQuitMenu
export function* matchPauseMenuSaveQuit(P) {
  restoreBgTilemapRegion(P);
  wr(P, "pauseMenuId", rb(P, (SaveQuitMenuIdByGameMode + rd(P, "gameMode")) & 0xFFFF));
  if (rd(P, "drillIsPracticeLesson")) wr(P, "pauseMenuId", MENU_PRACTICE_LESSON);
  wr(P, "matchMenuSelection", (getMatchMenuItemCount(P) - 1) & 0xFF);
  yield* runMatchQuitMenu(P);
}
// RunMatchQuitMenu (06:4485): the quit menu wPauseMenuId; the chosen item's action (MatchQuitMenu_*)
export function* runMatchQuitMenu(P) {
  yield* runMatchMenu(P);
  const sel = rd(P, "matchMenuSelection");
  if (sel === MATCHMENUSEL_CANCELLED) return;
  const action = (getMatchMenuItemId(P, sel) - ITEM_FIRST_QUIT) & 0xFF;
  if (action === 0) return;                                                    // MatchQuitMenu_ReturnToGame
  if (action === 1) return matchQuitMenuSaveAndQuit(P);
  if (action === 2 || (action >= 9 && action <= 13)) return matchQuitMenuQuit(P);
  if (action === 3) return matchQuitMenuSelectNewLevel(P);
  if (action >= 4 && action <= 8) return matchQuitMenuRetry(P);
  throw new Error(`RunMatchQuitMenu: action ${action} jumps off its table`);
}
const abortMatch = P => { wr(P, "matchAbortFlag", MATCHABORT_ALL); wr(P, "matchFramesAbort", MATCHABORT_ALL); return { a: MATCHABORT_ALL }; };
// MatchQuitMenu_SaveAndQuit (06:44B2) / _Retry (06:44C3) / _SelectNewLevel (06:44D4) / _Quit (06:44E5)
export function matchQuitMenuSaveAndQuit(P) { wr(P, "keepMatchStatsFlag", 1); wr(P, "saveAndQuitRequest", 1); return abortMatch(P); }
export function matchQuitMenuRetry(P) { wr(P, "matchRetryRequest", 1); wr(P, "matchExitRequest", 1); return abortMatch(P); }
export function matchQuitMenuSelectNewLevel(P) { wr(P, "matchSelectNewLevelRequest", 1); wr(P, "matchExitRequest", 1); return abortMatch(P); }
export function matchQuitMenuQuit(P) { wr(P, "matchExitRequest", 1); return abortMatch(P); }

// ---- ShowMessageWindow, ShowMatchScoreboardScreen ----
// ShowMessageWindow (06:44FE), slot $4004: a framed message (text hl) at screen cell (d, e), b x c, over the frozen
// match; held 30 frames, then until any button. Every register kept.
export function* showMessageWindow(P, text, x, y, w, h) {
  const bank = P.V.wramBank;
  wram(P, WRAM_COURT_PLANES);
  wr(P, "matchSimFrozen", 1);
  yield* stepMatchFrame(P);
  P.V.windowFrameAttr = 0x80;
  drawWindowFrame(P, getShadowTilemapAddr(P, x, y), getShadowAttrmapAddr(P, x, y), w, h);
  prepareGlyphBuffer(P);
  yield* renderProportionalTextAt(P, text, getShadowTilemapAddr(P, (x + 1) & 0xFF, (y + 1) & 0xFF), (w - 2) & 0xFF);
  yield* uploadGlyphBuffer(P);
  flushTilemapToVram(P);
  yield* romWait(P, FAR.StepMatchFrames, { a: MESSAGE_HOLD_FRAMES });
  do yield* stepMatchFrame(P); while (!(readMatchInputPressed(P) & 0x0F));
  restoreBgTilemap(P);
  flushTilemapToVram(P);
  yield* stepMatchFrame(P);
  wr(P, "matchSimFrozen", 0);
  wram(P, bank);
}
// ShowMatchScoreboardScreen (06:48AD), slot $4006: after a won minigame, the scoreboard (with its caption) until
// any button
export function* showMatchScoreboardScreen(P) {
  const bank = P.V.wramBank, entryF = P.cpu.f;
  yield* stepMatchFrame(P);
  yield* prepareScoreboardGfx(P);
  yield* stepMatchFrame(P);
  wr(P, "scoreboardOrigin", 0x05);
  loadScoreboardModeGfx(P);
  drawScoreboard(P, 1);
  prepareGlyphBuffer(P);
  yield* drawScoreboardCaption(P);
  yield* uploadGlyphBuffer(P);
  registerFrameTask(P, SCOREBOARD_TASK_PRIORITY, DrawScoreboardSprites);
  registerFrameTask(P, SCOREBOARD_TASK_PRIORITY, DrawScoreboardModeTitle);
  yield* stepMatchFrame(P);
  flushTilemapToVram(P);
  yield* stepMatchFrame(P);
  wram(P, WRAM_COURT_PLANES);
  while (!(readMatchInputPressed(P) & 0x0F)) yield* stepMatchFrame(P);
  unregisterFrameTask(P, DrawScoreboardSprites);
  unregisterFrameTask(P, DrawScoreboardModeTitle);
  restoreBgTilemap(P);
  flushTilemapToVram(P);
  yield* stepMatchFrame(P);
  wram(P, bank);
  return { a: bank, f: entryF };
}

const B = BANK_PAUSE;
export const HOOKS = [
  [B, 0x400E, hookGen(P => runMinigameEndMenu(P))],
  [B, 0x4074, hookGen(P => runMatchPauseMenu(P))],
  [B, 0x4110, hookGen(P => matchPauseMenuCheckRules(P))],
  [B, 0x4133, hookGen(P => showMatchRulesPages(P))],
  [B, 0x417D, hookGen(P => showTrainingRulesPages(P))],
  [B, 0x421D, hookGen(P => showMinigameRulesPages(P))],
  [B, 0x4316, hookGen((P, c) => showRulesPageSequence(P, c.hl))],
  [B, DrawRulesNextPageArrow_06, hook(P => drawRulesNextPageArrow06(P))],
  [B, 0x4380, hookGen(P => matchPauseMenuReviewControls(P))],
  [B, 0x43EE, hookGen(P => matchPauseMenuChangeOptions(P))],
  [B, 0x441E, hookGen(P => matchPauseMenuCameraSelect(P))],
  [B, 0x443A, hookGen(P => matchPauseMenuMusicToggle(P))],
  [B, 0x4462, hookGen(P => matchPauseMenuSaveQuit(P))],
  [B, 0x4485, hookGen(P => runMatchQuitMenu(P))],
  [B, 0x44B1, hook(() => {})],
  [B, 0x44B2, hook(P => matchQuitMenuSaveAndQuit(P))],
  [B, 0x44C3, hook(P => matchQuitMenuRetry(P))],
  [B, 0x44D4, hook(P => matchQuitMenuSelectNewLevel(P))],
  [B, 0x44E5, hook(P => matchQuitMenuQuit(P))],
  [B, 0x44FE, hookGen((P, c) => showMessageWindow(P, c.hl, c.d, c.e, c.b, c.c))],
  [B, 0x4564, hook((P, c) => { drawWindowFrameAt(P, c.d, c.e, c.b, c.c); })],
  [B, 0x4574, hookGen((P, c) => drawMenuTextLine(P, c.hl, c.d, c.e))],
  [B, 0x4584, hookGen((P, c) => drawMenuCaptionWindow(P, c.hl, c.d, c.e))],
  [B, 0x45AA, hook(P => { restoreBgTilemap(P); })],
  [B, 0x45C1, hook(P => { restoreBgTilemapRegion(P); })],
  [B, 0x45E9, hook((P, c) => ({ ...clearAttrPriorityRegion(P, c.hl, c.bc), a: 0, bc: 0, f: FZ }))],
  [B, 0x45F3, hook(P => unusedFlushTilemapToVramIfDirty(P))],
  [B, 0x45F8, hook(P => flushTilemapToVram(P))],
  [B, 0x4624, hook((P, c) => { const a = getShadowTilemapAddr(P, c.d, c.e); return { de: a, hl: a }; })],
  [B, 0x462E, hook((P, c) => { const a = getShadowAttrmapAddr(P, c.d, c.e); return { de: a, hl: a }; })],
  [B, 0x4638, hook((P, c) => getScrolledTilemapOffset(P, c.d, c.e))],
  [B, 0x464B, hook((P, c) => ({ hl: getScrolledTilemapRowOffset(P, c.e) }))],
  [B, 0x465E, hook((P, c) => adjustSpriteCoordsForScroll(P, c.d, c.e))],
  [B, 0x46E7, hookGen(P => runMatchMenu(P))],
  [B, 0x477A, hookGen(P => drawScoreboardCaption(P))],
  [B, 0x480A, hook((P, c) => ({ a: getMatchMenuItemId(P, c.a), b: c.a }))],
  [B, 0x4820, hook(P => ({ a: getMatchMenuItemCount(P) }))],
  [B, 0x482F, hook(P => { drawMatchMenuItems(P); })],
  [B, 0x4873, hook(P => { drawMatchMenuCursor(P); })],
  [B, 0x48AD, hookGen(P => showMatchScoreboardScreen(P))],
];
