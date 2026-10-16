// The Mario minigame select (bank $3b): a grid of the Mario-cast characters' minigames, 2x3 at first (the main menu's
// saved_3b.asm code: MinigameSelectSlideIn6, DrawMinigameSelectGrid6, MoveMinigameGridCursor) or 3x3 once the grid
// is expanded; each cell a character portrait, a locked one (CHAR_UNUSED_15) refused with SFX_MENU_LOCKED and shown
// greyed; the minigame's name in the caption row, the cursor cell's character palette, a bobbing cursor sprite.
// A returns the cell (kept in wSelectedMinigame), B returns $FF.
// Port of src/engine/menus/minigame_select/minigame_3b.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own; tables, templates and graphics are read
// from the ROM.
// Tests: lockstep on out/engine/exh1.mtrec, out/port/mg_*.mtrec and minigame_*.mtrec (the 2x3 grid; each minigame
// picked) and out/port/ms_grid9.mtrec (the 3x3 grid, scripted with every character unlocked);
// web/tests/port/routines_menus_misc.mjs.
import {
  FZ, FN, FAR, cpFlags, rom, romWait, near, nearWait, wram, rd, u8, w8, idx, ixF, sound, advanceFrame, registerFrameTask,
  clearFrameTasks, queueVRAMCopy, queueSpriteTemplate, fillTilemapRect, loadCompressedTileBlock, queueCopy, hook,
  hookGen, regs8, WRAM_STAGING, WRAM_SCREEN, TILEMAP_WIDTH, TILE_SIZE, VRAM_BANK1, vTiles0, vBGMap0, wDecompBuffer,
  wShadowTilemap, wShadowAttrmap, OAM_BANK1, PADF_A, PADF_B, rIE, IE_TIMER, SFX_MENU_MOVE, SFX_MENU_SELECT,
  SFX_MENU_LOCKED, SFX_MENU_CANCEL, MENUSLIDE_BACK, MENUSLIDE_FORWARD,
} from "../equipment/defs.js";
import { decompressDataFromBank } from "../../home/decompress.js";
import { moveMenuCursorGrid, getMenuCursorIndex, setMenuCursorFromIndex } from "../common/cursors.js";

export const BANK = 0x3B;
export const MinigameSelectCursorSpriteTask = 0x646D;
const rb = (P, a) => P.rom.u8(BANK, a & 0xFFFF), rw = (P, a) => P.rom.u16(BANK, a & 0xFFFF);
const MinigameSelectTable = 0x63F6, MinigameSelectCursorSpriteTask_SpriteTemplate0 = 0x64CA;
const MinigameSelectCursorSpriteTask_SpriteTemplate1 = 0x64EB, MinigameSelectCursorSpriteTaskTable0 = 0x64F4;
const MinigameCursorPosTable0 = 0x64FD, MinigameCursorPosTable1 = 0x650F, MinigameSelectCursorSpriteTaskTable1 = 0x651B;
const RenderMinigameNameTextTable = 0x65DA, FillMinigameSelectCellTable = 0x6660;
const Text_30_178 = 0x00B2, LOCKED_MINIGAME_NAME = 0x00BB;
export const CHAR_UNUSED_15 = 0x15;                         // a locked grid cell's character
const GRID_COLUMNS = 3, GRID_CELLS = 9, PORTRAIT_BLOCKS = 9;
const BGM_MARIO_MINIGAME = 0x08;
const CELL_ACTIVE = 0x0C, CELL_INACTIVE = 0x0D, LOCKED_CURSOR_TILE = 0x50, LOCKED_CURSOR_ATTR = 0x00;
const CURSOR_LABEL_OFFSET = 0x17F8, CURSOR_LABEL_TILE = 0x70, CHAR_PALETTE_SLOT = 4;
const PANEL_GRID9_IN = 0x04, PANEL_GRID9_OUT = 0x05, FLUSH_LAYOUT_GRID9 = 0;
const FRAME_TOP = 0x03, FRAME_LEFT_CORNER = 0x02, FRAME_RIGHT_CORNER = 0x04, BLANK = 0x20;
// the select screen's graphics: tile block, 16-byte blocks, destination (each followed by a frame)
const MINIGAME_SELECT_TILES = [
  [0x33, 0x10, vTiles0 + VRAM_BANK1], [0x34, 0x10, vTiles0 + 0x10 * TILE_SIZE + VRAM_BANK1],
  [0x35, 0x10, vTiles0 + 0x20 * TILE_SIZE + VRAM_BANK1], [0x36, 0x10, vTiles0 + 0x30 * TILE_SIZE + VRAM_BANK1],
  [0x37, 0x10, vTiles0 + 0x40 * TILE_SIZE + VRAM_BANK1], [0x38, 0x10, vTiles0 + 0x50 * TILE_SIZE + VRAM_BANK1],
];
const TILEBLOCK_SharedMenuGfx111 = 0x6F, SHARED_MENU_GFX111_BLOCKS = 18;   // (18 blocks of its 16: the ROM's operand)
const TILEBLOCK_MinigameSelectGfx6 = 0x47, TILEBLOCK_SharedMenuGfx27 = 0x1B;
// the three minigame icon pictures (bank $6d's slots $7e, $80, $82) and their VRAM places
const MINIGAME_ICONS = [[0x6D7E, wDecompBuffer, vTiles0 + 0x20 * TILE_SIZE],
  [0x6D80, wDecompBuffer + 64 * TILE_SIZE, vTiles0 + 0x30 * TILE_SIZE], [0x6D82, wDecompBuffer, vTiles0 + 0x40 * TILE_SIZE]];
// the minigame grid helpers of this bank (main_menu/saved_3b.asm, ported in menus/main_menu), by address
const BuildMarioCastUnlockMask = 0x667F, GetUnlockedMarioCastCharAtGridSlot = 0x66B5;
const GetMarioCastCharAtGridSlot = 0x66DE, CheckMinigameGridExpanded = 0x66F2, MinigameSelectSlideIn6 = 0x6700;
const MinigameSelectSlideOut6 = 0x6732, DrawMinigameSelectGrid6 = 0x6763;
const MoveMinigameGridCursor = [0x39, 0x6DF9], DecompressCharacterPortrait = [0x16, 0x6955];
const GetCharPaletteIndex = [0x02, 0x4173], LoadIndexedPalette_18 = [0x18, 0x4339];

const timerInterruptOff = P => P.bus.w8(rIE, P.bus.u8(rIE) & ~IE_TIMER);
const timerInterruptOn = P => P.bus.w8(rIE, P.bus.u8(rIE) | IE_TIMER);
const gridExpanded = P => near(P, CheckMinigameGridExpanded).a !== 0;
const charAtSlot = (P, slot) => near(P, GetUnlockedMarioCastCharAtGridSlot, { c: slot }).a;
const cursorCell = P => getMenuCursorIndex(P, GRID_COLUMNS).a;

// RunMinigameSelect (3B:61F0), slot $4012: see the header
export function* runMinigameSelect(P) {
  timerInterruptOff(P);
  sound(P, BGM_MARIO_MINIGAME);
  P.V.minigameSelectUnused = 0;
  near(P, BuildMarioCastUnlockMask);
  yield* loadMinigameSelectGfx(P);
  wram(P, WRAM_SCREEN);
  if (gridExpanded(P)) yield* minigameSelectSlideIn9(P, P.V.menuSlideDirection);
  else yield* nearWait(P, MinigameSelectSlideIn6, { b: P.V.menuSlideDirection });
  rom(P, FAR.InitMenuBgScroll);
  rom(P, FAR.LoadMenuSpritePalettePair, { b: 1, c: 1 });
  setMenuCursorFromIndex(P, GRID_COLUMNS, P.V.selectedMinigame);
  registerFrameTask(P, 1, MinigameSelectCursorSpriteTask);
  drawMinigameSelectCaption(P);
  const drawGrid = () => (gridExpanded(P) ? drawMinigameSelectGrid9(P) : near(P, DrawMinigameSelectGrid6));
  drawGrid();
  wram(P, WRAM_SCREEN);
  for (;;) {
    P.V.menuInputPressed = P.V.inputPressed;
    const moved = gridExpanded(P) ? moveMenuCursorGrid(P, GRID_COLUMNS, GRID_COLUMNS).a : rom(P, MoveMinigameGridCursor).a;
    if (moved) { sound(P, SFX_MENU_MOVE); drawMinigameSelectCaption(P); drawGrid(); }
    yield* advanceFrame(P);
    const input = P.V.menuInputPressed;
    if (input & PADF_A) {
      if (charAtSlot(P, cursorCell(P)) === CHAR_UNUSED_15) { sound(P, SFX_MENU_LOCKED); continue; }
      sound(P, SFX_MENU_SELECT);
      yield* leaveMinigameSelect(P, 1);
      P.V.menuSlideDirection = MENUSLIDE_FORWARD;
      P.V.minigameSelectUnused = 0;
      const r = getMenuCursorIndex(P, GRID_COLUMNS);
      P.V.selectedMinigame = r.a;
      return r;
    }
    if (input & PADF_B) {
      sound(P, SFX_MENU_CANCEL);
      yield* leaveMinigameSelect(P, 0);
      P.V.menuSlideDirection = MENUSLIDE_BACK;
      return { a: 0xFF };
    }
  }
}
// the frame tasks off, the timer interrupt back, the grid sliding out (forward or back)
function* leaveMinigameSelect(P, forward) {
  clearFrameTasks(P);
  timerInterruptOn(P);
  if (gridExpanded(P)) yield* minigameSelectSlideOut9(P, forward);
  else yield* nearWait(P, MinigameSelectSlideOut6, { b: forward });
}
// LoadMinigameSelectGfx (3B:62EF): each grid cell's character portrait (a frame each), the grid's tiles, the three
// minigame icons, the panel and cursor tiles, the cursor palette
export function* loadMinigameSelectGfx(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_STAGING);
  for (let cell = 0; cell < GRID_CELLS; cell++) {
    rom(P, DecompressCharacterPortrait, { b: charAtSlot(P, cell), de: wDecompBuffer });
    queueVRAMCopy(P, wDecompBuffer, rw(P, MinigameSelectTable + 2 * cell), PORTRAIT_BLOCKS);
    yield* advanceFrame(P);
  }
  for (const [block, n, dest] of MINIGAME_SELECT_TILES) { loadCompressedTileBlock(P, block, dest, n); yield* advanceFrame(P); }
  // the icons: the first two in one frame, the third in the next
  for (const [i, [slot, buffer, dest]] of MINIGAME_ICONS.entries()) {
    decompressDataFromBank(P, slot >> 8, slot & 0xFF, buffer);
    queueVRAMCopy(P, buffer, dest, 16);
    if (i) yield* advanceFrame(P);
  }
  loadCompressedTileBlock(P, TILEBLOCK_SharedMenuGfx111, vTiles0 + 0x50 * TILE_SIZE, SHARED_MENU_GFX111_BLOCKS);
  yield* advanceFrame(P);
  loadCompressedTileBlock(P, TILEBLOCK_MinigameSelectGfx6, vTiles0, 0x14);
  yield* advanceFrame(P);
  loadCompressedTileBlock(P, TILEBLOCK_SharedMenuGfx27, vTiles0 + 0x70 * TILE_SIZE + VRAM_BANK1, 0x04);
  const r = rom(P, FAR.LoadIndexedPalette, { b: 0x08, c: 0x10 });
  wram(P, bank);
  return { ...r, a: bank, f: entryF };
}
// a step of the 3x3 grid's panel: the menu background with panel `panel` at step c, the rows flushed
function* gridPanelStep(P, panel, step) {
  yield* advanceFrame(P);
  rom(P, FAR.RestoreMenuBgAndDrawPanel, { b: panel, c: step });
  return yield* romWait(P, FAR.FlushWram3MapRows, { b: FLUSH_LAYOUT_GRID9 });
}
// MinigameSelectSlideIn9 (3B:640A): the 3x3 grid's panel sliding in, forward (panel 4 steps 0-13) or back (panel 5
// steps 12-0)
export function* minigameSelectSlideIn9(P, forward) {
  let c, r;
  if (forward) for (c = 0; c !== 0x0E; c++) r = yield* gridPanelStep(P, PANEL_GRID9_IN, c);
  else for (c = 0x0C; c !== 0xFF; c = (c - 1) & 0xFF) r = yield* gridPanelStep(P, PANEL_GRID9_OUT, c);
  return { ...regs8(r), a: c, c, f: FZ | FN };
}
// MinigameSelectSlideOut9 (3B:643C): sliding out, forward (panel 5 steps 0-10) or back (panel 4 steps 13-1)
export function* minigameSelectSlideOut9(P, forward) {
  let c, r;
  if (forward) { for (c = 0; c !== 0x0B; c++) r = yield* gridPanelStep(P, PANEL_GRID9_OUT, c); return { ...regs8(r), a: c, c, f: FZ | FN }; }
  for (c = 0x0D; c; c--) r = yield* gridPanelStep(P, PANEL_GRID9_IN, c);
  return { ...regs8(r), a: 0, c: 0, f: FZ };
}
// MinigameSelectCursorSpriteTask (3B:646D), a frame task: the menu background's scroll; the cursor over its cell
// (the cell's tile, attribute and place in the grid's position table, bobbing; a locked cell's cursor greyed) and its
// label sprite
export function minigameSelectCursorSpriteTask(P) {
  rom(P, FAR.TickMenuBgScroll);
  const cell = cursorCell(P);
  let tile = rb(P, idx(MinigameSelectCursorSpriteTaskTable1, cell));
  const pos = rw(P, idx(getMinigameCursorPosTable(P).hl, cell * 2));
  const { d, e } = rom(P, FAR.ApplySpriteBobOffset, { c: tile, d: pos >> 8, e: pos & 0xFF });
  let attr = rb(P, idx(MinigameSelectCursorSpriteTaskTable0, cell));
  const lock = overrideMinigameCursorIfLocked(P, attr, tile);
  if (lock.b !== undefined) { attr = lock.b; tile = lock.c; }
  queueSpriteTemplate(P, MinigameSelectCursorSpriteTask_SpriteTemplate0, d, e, tile, attr);
  const de = ((d << 8 | e) + CURSOR_LABEL_OFFSET) & 0xFFFF;
  return queueSpriteTemplate(P, MinigameSelectCursorSpriteTask_SpriteTemplate1, de >> 8, de & 0xFF, CURSOR_LABEL_TILE, OAM_BANK1);
}
// GetMinigameCursorPosTable (3B:64B6): hl = the cursor positions of the grid shown (3x3 or 2x3); af, bc, de kept
export function getMinigameCursorPosTable(P) {
  return { hl: near(P, CheckMinigameGridExpanded).f & FZ ? MinigameCursorPosTable1 : MinigameCursorPosTable0 };
}
// OverrideMinigameCursorIfLocked (3B:654D): over a locked cell, the cursor's tile and attribute become $50 / 0 (bc).
// (That path pops the caller's bc into af: a = the attribute b, f = the tile c's high bits.)
export function overrideMinigameCursorIfLocked(P, attr, tile) {
  const ch = charAtSlot(P, cursorCell(P));
  if (ch !== CHAR_UNUSED_15) return { a: ch, f: cpFlags(ch, CHAR_UNUSED_15) };                  // (bc, de, hl kept)
  return { a: attr, f: tile & 0xF0, b: LOCKED_CURSOR_ATTR, c: LOCKED_CURSOR_TILE };
}
// DrawMinigameSelectCaption (3B:6569): the caption row's frame cleared, the minigame's name, the rows queued
export function drawMinigameSelectCaption(P) {
  wram(P, WRAM_SCREEN);
  fillTilemapRect(P, wShadowTilemap + 15 * TILEMAP_WIDTH, 0x14, 0x01, FRAME_TOP);
  w8(P, wShadowTilemap + 15 * TILEMAP_WIDTH, FRAME_LEFT_CORNER);
  w8(P, wShadowTilemap + 15 * TILEMAP_WIDTH + 19, FRAME_RIGHT_CORNER);
  fillTilemapRect(P, wShadowTilemap + 16 * TILEMAP_WIDTH + 1, 0x12, 0x01, BLANK);
  renderMinigameNameText(P);
  return queueCopy(P, wShadowTilemap + 15 * TILEMAP_WIDTH, vBGMap0 + 15 * TILEMAP_WIDTH, 2 * TILEMAP_WIDTH / 16);
}
// RenderMinigameNameText (3B:65A0): the cursor cell's minigame name (Text_30_178 + cell) at its place, or the locked
// cell's text
export function renderMinigameNameText(P) {
  wram(P, WRAM_SCREEN);
  const cell = cursorCell(P);
  if (charAtSlot(P, cell) === CHAR_UNUSED_15)
    return rom(P, FAR.RenderTextToBuffer64, { hl: LOCKED_MINIGAME_NAME, de: wShadowTilemap + 16 * TILEMAP_WIDTH + 1, c: 0x20 });
  const de = rw(P, idx(RenderMinigameNameTextTable, cell * 2));
  return { ...rom(P, FAR.RenderTextToBuffer64, { hl: idx(Text_30_178, cell), de, c: 0x20 }), b: cell };
}
// DrawMinigameSelectGrid9 (3B:65EC): the nine cells' attributes plain, the cursor's active, its character's palette;
// the grid's rows queued
export function drawMinigameSelectGrid9(P) {
  wram(P, WRAM_SCREEN);
  for (let cell = 0; cell < GRID_CELLS; cell++) fillMinigameSelectCell(P, cell, 0);
  fillMinigameSelectCell(P, cursorCell(P), 1);
  loadMinigameCharPalette(P, cursorCell(P));
  let r;
  for (const row of [3, 7, 11]) r = queueCopy(P, wShadowAttrmap + row * TILEMAP_WIDTH, vBGMap0 + row * TILEMAP_WIDTH + VRAM_BANK1, 3 * TILEMAP_WIDTH / 16);
  return r;
}
// FillMinigameSelectCell (3B:6635): cell b's 3 x 3 attributes, active (c != 0: $0C) or not ($0D). Registers kept.
export function fillMinigameSelectCell(P, cell, active) {
  fillTilemapRect(P, rw(P, idx(FillMinigameSelectCellTable, cell * 2)), 0x03, 0x03, active ? CELL_ACTIVE : CELL_INACTIVE);
}
// LoadMinigameCharPalette (3B:6672): the palette of cell a's character into BG palette 4
export function loadMinigameCharPalette(P, cell) {
  const ch = near(P, GetMarioCastCharAtGridSlot, { c: cell });
  const pal = rom(P, GetCharPaletteIndex, regs8(ch));
  return rom(P, LoadIndexedPalette_18, { ...regs8(pal), d: CHAR_PALETTE_SLOT });
}

export const HOOKS = [
  [BANK, 0x61E9, () => {}],                                       // Unused_3b_StubNop4
  [BANK, 0x61F0, hookGen(P => runMinigameSelect(P))],
  [BANK, 0x62EF, hookGen((P, c) => loadMinigameSelectGfx(P, c.f))],
  [BANK, 0x640A, hookGen((P, c) => minigameSelectSlideIn9(P, c.b))],
  [BANK, 0x643C, hookGen((P, c) => minigameSelectSlideOut9(P, c.b))],
  [BANK, 0x646D, hook(P => minigameSelectCursorSpriteTask(P))],
  [BANK, 0x64B6, hook(P => getMinigameCursorPosTable(P))],
  [BANK, 0x654D, hook((P, c) => overrideMinigameCursorIfLocked(P, c.b, c.c))],
  [BANK, 0x6569, hook(P => drawMinigameSelectCaption(P))],
  [BANK, 0x65A0, hook(P => renderMinigameNameText(P))],
  [BANK, 0x65EC, hook(P => drawMinigameSelectGrid9(P))],
  [BANK, 0x6635, hook((P, c) => { fillMinigameSelectCell(P, c.b, c.c); })],
  [BANK, 0x6672, hook((P, c) => loadMinigameCharPalette(P, c.a))],
];
