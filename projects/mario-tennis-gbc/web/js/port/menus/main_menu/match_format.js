// The exhibition's match-format menu (bank $3B): three rows of options over the stadium: singles / doubles, the
// number of games (two choices) and of sets (1, 3, 5). Up / down pick the row (the bobbing frame of
// MatchFormatCursorSpriteTask follows the row's chosen option), left / right change its option (the row's
// attributes are queued, then redrawn: the cell of the chosen option highlighted); the caption line shows the
// option's text.
// States of RunMatchFormatSelect: load (16 frames), slide in, choose; A: slide out forward, returns the row index
// (a = wMenuCursorY); B: slide out back, returns $FF. The options stay in wMatchFormatDoubles/Games/Sets.
// Port of the match-format part of src/engine/menus/main_menu/saveslots_3b.asm (RunMatchFormatSelect ..
// RenderMatchFormatOptionText, with the twins MatchFormatSlideOut and FlushMatchFormatRowToVram) of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm). Tables are read from the ROM.
// Tests: lockstep on out/engine/exh1.mtrec (an exhibition: this menu); web/tests/port/routines_menus_main.mjs.
import { decompressDataFromBank } from "../../home/decompress.js";
import { registerFrameTask } from "../../home/colorfade.js";
import { queueSpriteTemplate } from "../../home/fade.js";
import {
  addFlags, hook, hookGen, callGen, farGen, callHome, callFar, advanceFrame, sound, withRomBank, wramBank, pushWramBank,
  popWramBank, withWramBank, queueCopy, loadPalettes, cell, HOME, WRAM_STAGING, WRAM_SCREEN, TILE_SIZE, TILEMAP_WIDTH,
  VRAM_BANK1, vTiles0, vBGMap0, wDecompBuffer, wShadowTilemap, wShadowAttrmap, OAM_BANK1, PADF_A, PADF_B, PADF_LEFT,
  PADF_RIGHT, rIE, IE_TIMER, MENUSLIDE_BACK, MENUSLIDE_FORWARD, BGM_MENU, SFX_MENU_MOVE, SFX_MENU_SELECT, SFX_MENU_CANCEL,
} from "../common/defs.js";
import { moveMenuCursorGrid, getMenuCursorIndex, setMenuCursorFromIndex } from "../common/cursors.js";
import { BANK_MENU_LIB, restoreMenuBgAndDrawPanel, flushWram3MapRows, fillTilemapRect } from "../common/tilemaps.js";
import { TILEBLOCK, farLoadTileBlock, loadIndexedPalette, initMenuBgScroll, loadMenuSpritePalettePair, tickMenuBgScroll, applySpriteBobOffset } from "../common/menu_lib.js";

export const BANK_MAIN_MENU = 0x3B;
const MatchFormatOptionsPalettes0 = 0x5DD4, MatchFormatOptionsPalettes1 = 0x5DDC, MatchFormatOptionsPalettes2 = 0x5DE4;
const MatchFormatTable0 = 0x5EBD, MatchFormatTable1 = 0x5ECB;
const FillMatchFormatOptionCellTable = 0x6085, MatchFormatOptionCellTable = 0x6093;
const MatchFormatCursorSpriteTask = 0x60D0, MatchFormatCursorSpriteTask_SpriteTemplate0 = 0x6125;
const MatchFormatCursorSpriteTask_SpriteTemplate1 = 0x6146, MatchFormatCursorSpriteTaskTable0 = 0x614F;
const MatchFormatCursorSpriteTaskTable1 = 0x615D;
const RenderTextToBuffer64 = [0x05, 0x5F52];
const Text_30_135 = 0x0087, Text_30_137 = 0x0089, Text_30_139 = 0x008B;   // singles/doubles, games, sets texts
const ROWS = 3, ROW_MODE = 0, ROW_GAMES = 1, SET_CHOICES = 3;
// the options' cells: 0-1 the mode, 2-3 the games, 4-6 the sets
const FIRST_GAMES_CELL = 2, FIRST_SETS_CELL = 4;
const CAPTION_ROW = 15, CAPTION = cell(wShadowTilemap, 1, 16);
const ATTR_PLAIN = 0x0D;

const ix = (table, i) => (table & 0xFF00) + (((table & 0xFF) + (i & 0xFF)) & 0x1FF);
// the chosen option's cell of the cursor's row
function chosenCell(P) {
  const { V } = P, row = getMenuCursorIndex(P, 1).a;
  if (row === ROW_MODE) return V.matchFormatDoubles;
  if (row === ROW_GAMES) return (V.matchFormatGames + FIRST_GAMES_CELL) & 0xFF;
  return (V.matchFormatSets + FIRST_SETS_CELL) & 0xFF;
}

// RunMatchFormatSelect (3B:5CF3): see the header.
export function* runMatchFormatSelect(P) {
  const { V, bus } = P;
  bus.w8(rIE, bus.u8(rIE) & ~IE_TIMER);
  sound(P, BGM_MENU);
  yield* callGen(P, loadMatchFormatGfx(P));
  wramBank(P, WRAM_SCREEN);
  yield* callGen(P, matchFormatSlideIn(P, V.menuSlideDirection));
  withRomBank(P, BANK_MENU_LIB, () => { initMenuBgScroll(P); loadMenuSpritePalettePair(P, 1, 1); });
  initMatchFormatOptions(P);
  registerFrameTask(P, 1, MatchFormatCursorSpriteTask, P.cpu.sp - 2);
  drawMatchFormatCaption(P);
  wramBank(P, WRAM_SCREEN);
  for (;;) {
    yield* advanceFrame(P);
    V.menuInputPressed = V.inputPressed;
    handleMatchFormatInput(P);
    if (moveMenuCursorGrid(P, 1, ROWS).a) { sound(P, SFX_MENU_MOVE); drawMatchFormatCaption(P); }
    const input = V.menuInputPressed;
    if (input & PADF_A) {
      sound(P, SFX_MENU_SELECT);
      bus.w8(rIE, bus.u8(rIE) | IE_TIMER);
      callHome(P, HOME.ClearFrameTasks);
      yield* callGen(P, matchFormatSlideOut(P, 1));
      V.menuSlideDirection = MENUSLIDE_FORWARD;
      return getMenuCursorIndex(P, ROWS);
    }
    if (input & PADF_B) {
      sound(P, SFX_MENU_CANCEL);
      bus.w8(rIE, bus.u8(rIE) | IE_TIMER);
      callHome(P, HOME.ClearFrameTasks);
      yield* callGen(P, matchFormatSlideOut(P, 0));
      V.menuSlideDirection = MENUSLIDE_BACK;
      return { a: 0xFF };
    }
  }
}

// InitMatchFormatOptions (3B:5D80): the cursor on the first row; each row's chosen option highlighted and queued;
// the rows' palettes (BG 4, 6, 7).
export function initMatchFormatOptions(P) {
  const { V } = P;
  setMenuCursorFromIndex(P, 1, 0);
  fillMatchFormatOptionCell(P, V.matchFormatDoubles, 1);
  flushMatchFormatRowToVram(P, 0);
  fillMatchFormatOptionCell(P, (V.matchFormatGames + FIRST_GAMES_CELL) & 0xFF, 1);
  flushMatchFormatRowToVram(P, 1);
  fillMatchFormatOptionCell(P, (V.matchFormatSets + FIRST_SETS_CELL) & 0xFF, 1);
  flushMatchFormatRowToVram(P, 2);
  loadPalettes(P, MatchFormatOptionsPalettes0, 4, 1);
  loadPalettes(P, MatchFormatOptionsPalettes1, 6, 1);
  return loadPalettes(P, MatchFormatOptionsPalettes2, 7, 1);
}

// LoadMatchFormatGfx (3B:5DEC), over 17 frames: the seven option label sets (MatchFormatTable0 to the VRAM places of
// MatchFormatTable1), the panel tile blocks into VRAM bank 1 $8000-$87FF, the frame tiles to $8000, the cursor
// palette. The WRAM bank is kept.
const LABEL_SETS = 7, LABEL_BLOCKS = 16;
const PANEL_BLOCKS = [[TILEBLOCK.SharedMenuGfx35, 0x00], [TILEBLOCK.SharedMenuGfx36, 0x10], [TILEBLOCK.SharedMenuGfx37, 0x20],
  [TILEBLOCK.SharedMenuGfx38, 0x30], [TILEBLOCK.SharedMenuGfx39, 0x40], [TILEBLOCK.SharedMenuGfx40, 0x50],
  [TILEBLOCK.SharedMenuGfx41, 0x60], [TILEBLOCK.SharedMenuGfx27, 0x70]];
export function* loadMatchFormatGfx(P) {
  const { bus } = P;
  pushWramBank(P, WRAM_STAGING);
  for (let i = 0; i < LABEL_SETS; i++) {
    const slot = bus.u16(MatchFormatTable0 + 2 * i);
    decompressDataFromBank(P, slot >> 8, slot & 0xFF, wDecompBuffer);
    queueCopy(P, wDecompBuffer, bus.u16(MatchFormatTable1 + 2 * i), LABEL_BLOCKS);
    yield* advanceFrame(P);
  }
  for (const [block, tile] of PANEL_BLOCKS) {
    farLoadTileBlock(P, block, vTiles0 + tile * TILE_SIZE + VRAM_BANK1);
    yield* advanceFrame(P);
  }
  farLoadTileBlock(P, TILEBLOCK.SharedMenuGfx63, vTiles0);
  yield* advanceFrame(P);
  withRomBank(P, BANK_MENU_LIB, () => loadIndexedPalette(P, 0x08, 0x10));
  popWramBank(P);
}

// MatchFormatSlideIn (3B:5ED9) / MatchFormatSlideOut (3B:5F0B): in forward (b != 0) panel layout 2 steps 0-13,
// back layout 3 steps 10-0; out forward layout 3 steps 0-10, back layout 2 steps 13-1.
function* slide(P, panel, from, to) {
  const dir = from <= to ? 1 : -1;
  for (let step = from; ; step += dir) {
    yield* advanceFrame(P);
    withRomBank(P, BANK_MENU_LIB, () => restoreMenuBgAndDrawPanel(P, panel, step));
    yield* farGen(P, BANK_MENU_LIB, flushWram3MapRows(P, 0));
    if (step === to) return;
  }
}
export function* matchFormatSlideIn(P, forward) { if (forward) yield* slide(P, 2, 0, 0x0D); else yield* slide(P, 3, 0x0A, 0); }
export function* matchFormatSlideOut(P, forward) { if (forward) yield* slide(P, 3, 0, 0x0A); else yield* slide(P, 2, 0x0D, 1); }

// HandleMatchFormatInput (3B:5F3C): left / right change the cursor's row's option (mode and games toggle, sets
// wrap over 3); the row is queued as it was, redrawn, and the caption redrawn.
export function handleMatchFormatInput(P) {
  const { V } = P, input = V.menuInputPressed;
  if (!(input & (PADF_LEFT | PADF_RIGHT))) return;
  sound(P, SFX_MENU_MOVE);
  const row = getMenuCursorIndex(P, 1).a;
  if (row === ROW_MODE) {
    V.matchFormatDoubles ^= 1;
    flushMatchFormatRowToVram(P, 0);
    redrawMatchFormatModeRow(P);
  } else if (row === ROW_GAMES) {
    V.matchFormatGames ^= 1;
    flushMatchFormatRowToVram(P, 1);
    redrawMatchFormatGamesRow(P);
  } else {
    const v = (V.matchFormatSets + (input & PADF_LEFT ? -1 : 1)) & 0xFF;
    V.matchFormatSets = v & 0x80 ? SET_CHOICES - 1 : v < SET_CHOICES ? v : 0;
    flushMatchFormatRowToVram(P, 2);
    redrawMatchFormatSetsRow(P);
  }
  drawMatchFormatCaption(P);
}
// RedrawMatchFormatModeRow (3B:5FF6) / GamesRow (3B:600E) / SetsRow (3B:6028): the row's cells plain, its chosen
// option highlighted
// (leaving a = b = the chosen cell, c = 1, the flags of its `add`)
export function redrawMatchFormatModeRow(P, f = 0) { return redrawRow(P, [0, 1], P.V.matchFormatDoubles, 0, f); }
export function redrawMatchFormatGamesRow(P) { return redrawRow(P, [2, 3], P.V.matchFormatGames, FIRST_GAMES_CELL); }
export function redrawMatchFormatSetsRow(P) { return redrawRow(P, [4, 5, 6], P.V.matchFormatSets, FIRST_SETS_CELL); }
function redrawRow(P, cells, option, first, f) {
  for (const c of cells) fillMatchFormatOptionCell(P, c, 0);
  const chosen = (option + first) & 0xFF;
  fillMatchFormatOptionCell(P, chosen, 1);
  return { a: chosen, b: chosen, c: 1, f: first ? addFlags(option, first) : f };
}
// FillMatchFormatOptionCell (3B:6049): the attributes (5 x 3, WRAM 3) of option cell b: highlighted (c != 0, the
// cell's palette from MatchFormatOptionCellTable) or plain ($0D). Registers and the WRAM bank kept.
export function fillMatchFormatOptionCell(P, index, highlighted) {
  withWramBank(P, WRAM_SCREEN, () => {
    const dest = P.bus.u16(ix(FillMatchFormatOptionCellTable, index * 2));
    const attr = highlighted ? P.bus.u8(ix(MatchFormatOptionCellTable, index)) : ATTR_PLAIN;
    withRomBank(P, BANK_MENU_LIB, () => fillTilemapRect(P, dest, 5, 3, attr));
  });
}
// FlushMatchFormatRowToVram (3B:609A): the attributes of option row b (rows 3, 7 or 11, three map rows each) queued
// to VRAM. Registers kept.
export function flushMatchFormatRowToVram(P, row) {
  const mapRow = row === 0 ? 3 : row === 1 ? 7 : 11;
  queueCopy(P, cell(wShadowAttrmap, 0, mapRow), vBGMap0 + mapRow * TILEMAP_WIDTH + VRAM_BANK1, 3 * TILEMAP_WIDTH / 16);
}
// MatchFormatCursorSpriteTask (3B:60D0), a frame task: the banner sprites, and the bobbing frame around the chosen
// option of the cursor's row with its corner piece.
export function matchFormatCursorSpriteTask(P, sp = P.cpu.sp - 2) {
  const { bus } = P;
  withRomBank(P, BANK_MENU_LIB, () => tickMenuBgScroll(P, sp));
  const chosen = chosenCell(P);
  const tile = bus.u8(ix(MatchFormatCursorSpriteTaskTable1, chosen));
  const at = bus.u16(ix(MatchFormatCursorSpriteTaskTable0, chosen * 2));
  const x = at >> 8, y = withRomBank(P, BANK_MENU_LIB, () => applySpriteBobOffset(P, at & 0xFF)).e;
  queueSpriteTemplate(P, MatchFormatCursorSpriteTask_SpriteTemplate0, x, y, tile, OAM_BANK1, sp);
  const de = ((x << 8 | y) + 0x17F8) & 0xFFFF;
  return queueSpriteTemplate(P, MatchFormatCursorSpriteTask_SpriteTemplate1, de >> 8, de & 0xFF, 0x70, OAM_BANK1, sp);
}
// DrawMatchFormatCaption (3B:6164): the caption line (rows 15-16: frame and text) redrawn and queued. Leaves WRAM 3.
export function drawMatchFormatCaption(P) {
  wramBank(P, WRAM_SCREEN);
  withRomBank(P, BANK_MENU_LIB, () => fillTilemapRect(P, cell(wShadowTilemap, 0, CAPTION_ROW), 0x14, 1, 0x03));
  P.bus.w8(cell(wShadowTilemap, 0, CAPTION_ROW), 0x02);
  P.bus.w8(cell(wShadowTilemap, 19, CAPTION_ROW), 0x04);
  withRomBank(P, BANK_MENU_LIB, () => fillTilemapRect(P, CAPTION, 0x12, 1, 0x20));
  renderMatchFormatOptionText(P);
  return queueCopy(P, cell(wShadowTilemap, 0, CAPTION_ROW), vBGMap0 + CAPTION_ROW * TILEMAP_WIDTH, 2 * TILEMAP_WIDTH / 16);
}
// RenderMatchFormatOptionText (3B:619B): the text of the cursor's row's option on the caption line. Leaves WRAM 3.
export function renderMatchFormatOptionText(P) {
  const { V } = P;
  wramBank(P, WRAM_SCREEN);
  const row = getMenuCursorIndex(P, 1).a;
  const [text, option] = row === ROW_MODE ? [Text_30_135, V.matchFormatDoubles] : row === ROW_GAMES ? [Text_30_137, V.matchFormatGames] : [Text_30_139, V.matchFormatSets];
  return callFar(P, RenderTextToBuffer64, { hl: ix(text, option), de: CAPTION, c: 0x20 });
}

export const HOOKS = [
  [BANK_MAIN_MENU, 0x5CF3, hookGen(P => runMatchFormatSelect(P))],
  [BANK_MAIN_MENU, 0x5D80, hook(P => initMatchFormatOptions(P))],
  [BANK_MAIN_MENU, 0x5DEC, hookGen(P => loadMatchFormatGfx(P))],
  [BANK_MAIN_MENU, 0x5ED9, hookGen((P, c) => matchFormatSlideIn(P, c.b))],
  [BANK_MAIN_MENU, 0x5F0B, hookGen((P, c) => matchFormatSlideOut(P, c.b))],
  [BANK_MAIN_MENU, 0x5F3C, hook(P => { handleMatchFormatInput(P); })],
  [BANK_MAIN_MENU, 0x5FF6, hook((P, c) => redrawMatchFormatModeRow(P, c.f))],
  [BANK_MAIN_MENU, 0x600E, hook(P => redrawMatchFormatGamesRow(P))],
  [BANK_MAIN_MENU, 0x6028, hook(P => redrawMatchFormatSetsRow(P))],
  [BANK_MAIN_MENU, 0x6049, hook((P, c) => { fillMatchFormatOptionCell(P, c.b, c.c); })],
  [BANK_MAIN_MENU, 0x609A, hook((P, c) => { flushMatchFormatRowToVram(P, c.b); })],
  [BANK_MAIN_MENU, 0x60D0, hook((P, c) => matchFormatCursorSpriteTask(P, c.sp - 2))],
  [BANK_MAIN_MENU, 0x6164, hook(P => drawMatchFormatCaption(P))],
  [BANK_MAIN_MENU, 0x619B, hook(P => renderMatchFormatOptionText(P))],
];
