// The court select screens (bank $3e): the exhibition's court choice. Four court types (RunCourtSelect4Menu, a 2x2
// grid: hard, clay, grass, composition) or, once a bonus court is unlocked, nine courts (RunCourtSelect9Menu, 3x3:
// the four types and the five bonus courts, locked ones refused with SFX_MENU_LOCKED). Each slides in as a menu panel
// over the menu background (the menu library's panels $12-$15), the chosen court's tab highlighted (attributes $0C,
// the others $0D) with its palette (BG 4) and its name in the title row, and a bobbing cursor and label sprite
// (CourtSelect*CursorSpriteTask). A picks (the court's music into wMatchBGM; returns the court id), B backs out
// ($FF; the four-court menu also fades out and resets the screen). The link versions read the pad from the link
// (RunLinkInputFrame / hLinkInput) and end with SyncLinkFrame.
// The courts' unlock bits (from the save's flags, ComputeUnlockedCourtFlags; or'ed with a link partner's) are kept
// one a byte in WRAM 2 (StoreCourtUnlockBits) for IsCourtUnlocked; LoadCourtSelectGraphics loads the court
// thumbnails (a locked court's: the "?" one) and the panels' tiles.
// Port of src/engine/menus/court_select/four_courts_3e.asm and nine_courts_3e.asm of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses are its own;
// tables and graphics are read from the ROM. (slots_3e.asm is the bank's slot table: data.)
// Tests: lockstep on out/engine/exh1.mtrec and out/port/court_*.mtrec (four and nine courts, each pick and back);
// routines_menus_pause.mjs.
import {
  FAR, HOME, rom, romWait, home, wram, rd, wr, u8, w8, sound, advanceFrame, registerFrameTask, clearFrameTasks,
  queueVRAMCopy, decompressData, loadPaletteShadow, queueSpriteTemplate, disableLCDSafely, fadeOut, fillTilemapRect,
  loadCompressedTileBlock, hook, hookGen, FZ, WRAM_STAGING, WRAM_COURT_PLANES, WRAM_SCREEN, TILE_SIZE, VRAM_BANK1,
  vTiles1, vTiles2, vBGMap0, wDecompBuffer, wScreenAttrmap, wShadowTilemap, wShadowAttrmap, OAM_BANK1, PADF_A, PADF_B,
  rIE, IE_TIMER, BGM_MENU, SFX_MENU_MOVE, SFX_MENU_DECIDE, SFX_MENU_LOCKED, SFX_MENU_CANCEL, MENUSLIDE_BACK,
  MENUSLIDE_FORWARD,
} from "../pause/defs.js";

export const BANK_COURT_SELECT = 0x3E;
const rb = (P, a) => P.rom.u8(BANK_COURT_SELECT, a), rw = (P, a) => P.rom.u16(BANK_COURT_SELECT, a);
const CourtSelectCourtIds_3e = 0x5D08, CourtSelectGraphicsTable = 0x5DF1, CourtSelectTable = 0x5E05;
export const CourtSelect4CursorSpriteTask = 0x5E93, CourtSelect9CursorSpriteTask = 0x6714;
const CourtSelect4CursorSpriteTaskPtrs = 0x5EEA, CourtSelect4CursorSpriteTask_SpriteTemplate = 0x5F38;
const CourtSelect4CursorPositions_3e = 0x5F41, CourtSelect4CursorTiles_3e = 0x5F49, CourtSelect4LabelYOffsets_3e = 0x5F4D;
const CourtSelect4TabAttrAddrs_3e = 0x5FD6, CourtSelect4PalettePtrs = 0x5FF1;
const CourtSelectBgmIds_3e = 0x60EB, CourtSelectBgmIdsLink_3e = 0x6102;
const CourtSelectTitleTiles = 0x61D4, CourtSelectTitleTiles2Gfx = 0x6273, CourtSelectPanelTiles = 0x62C6;
const CourtNameLeftIndices_3e = 0x64C6, CourtNameRightIndices_3e = 0x64EF;
const CourtSelect9CursorTemplatePtrs_3e = 0x677B, CourtSelect9CursorSpriteTask_SpriteTemplate = 0x67D3;
const CourtSelect9CursorPositions_3e = 0x67DC, CourtSelect9CursorTiles_3e = 0x67EE, CourtSelect9CursorAttrs_3e = 0x67F8;
const CourtSelect9LabelYOffsets_3e = 0x6802, CourtSelect9TabAttrAddrs_3e = 0x68B4, CourtSelect9PalettePtrs = 0x68D9;
const CourtUnlockFlagIds_3e = 0x69CA;
const COURT_STAR = 0x04, BONUS_COURTS = 5, COURTS = 9;
const LOCKED_THUMBNAIL = 0x3F14;                                 // (bank $3f, slot $14): the locked court's picture
const NAME_LOCKED_LEFT = 0xAC, NAME_LOCKED_RIGHT = 0xB1, NAME_TILES = 0x80, NO_NAME = 0xFF;
const TAB_ACTIVE = 0x0C, TAB_INACTIVE = 0x0D, COURT_BG_PALETTE = 4;
const PANEL_4_OPEN = 0x12, PANEL_4_CLOSE = 0x13, PANEL_9_OPEN = 0x14, PANEL_9_CLOSE = 0x15;
const FLUSH_LAYOUT_4 = 2, FLUSH_LAYOUT_9 = 0;
const LABEL_TILE = 0x72, LOCKED_TILE_OFFSET = 0x40, LABEL_X_OFFSET = 0xF8;
const TITLE_ROW = 16, TITLE_BLANK = 0x20;
const THUMBNAIL_BLOCKS = 16, TITLE_TILE_BLOCKS = 0x0C, TITLE_TILES2_BLOCKS = 5, PANEL_TILE_BLOCKS = 55;
// LoadCourtSelectGraphics's tile blocks (the menu library's TileBlockPtrs_39): block, 16-byte blocks, destination
const COURT_SELECT_TILE_BLOCKS = [
  [0x65, 0x12, 0xA000], [0x66, 0x12, 0xA100], [0x67, 0x12, 0xA200], [0x68, 0x14, 0xA300], [0x6A, 0x12, 0xA420],
  [0x6B, 0x12, 0xA520], [0x6C, 0x12, 0xA620], [0x6D, 0x12, 0x8200], [0x6E, 0x12, 0x8300], [0x6F, 0x12, 0x8400],
  [0x1B, 0x04, 0xA720], [0x40, 0x14, 0x8000],
];

// the cursor routines of this bank (cursor_3e.asm, the shared menu code)
const moveMenuCursorGrid = (P, cols, rows) => rom(P, FAR.MoveMenuCursorGrid_3e, { b: cols, c: rows }).a;
const getMenuCursorIndex = (P, cols) => rom(P, FAR.GetMenuCursorIndex_3e, { c: cols }).a;
const setMenuCursorFromIndex = (P, cols, index) => rom(P, FAR.SetMenuCursorFromIndex_3e, { b: cols, c: index });
const timerInterruptOff = P => P.bus.w8(rIE, P.bus.u8(rIE) & ~IE_TIMER);
const timerInterruptOn = P => P.bus.w8(rIE, P.bus.u8(rIE) | IE_TIMER);
// the menu library's panels: the screen back from its clean copy with panel `panel` at slide step c, then queued
const drawPanel = (P, panel, step) => rom(P, FAR.RestoreMenuBgAndDrawPanel, { b: panel, c: step });
const flushPanel = (P, layout) => romWait(P, FAR.FlushWram3MapRows, { b: layout });
// the link's frame (RunLinkInputFrame: the pads exchanged, a frame)
const linkInputFrame = P => romWait(P, FAR.RunLinkInputFrame);
function endLinkSession(P) { P.V.linkExchangeActive = 0; home(P, HOME.ResetSerialState); }

// ---- the four-court menu ----
// RunCourtSelect4Menu (3E:5B99), slot $4018: see the header. Returns a = the court id, or $FF.
export function* runCourtSelect4Menu(P) {
  sound(P, BGM_MENU);
  clearFrameTasks(P);
  timerInterruptOff(P);
  yield* openCourtSelectMenu(P, 2, () => openCourtSelect4Panel(P, rd(P, "menuSlideDirection")), CourtSelect4CursorSpriteTask, redrawCourtSelect4Menu);
  for (;;) {
    yield* advanceFrame(P);
    wr(P, "menuInputPressed", P.V.inputPressed);
    if (moveMenuCursorGrid(P, 2, 2)) { sound(P, SFX_MENU_MOVE); redrawCourtSelect4Menu(P); }
    const input = rd(P, "menuInputPressed");
    if (input & PADF_A) {
      sound(P, SFX_MENU_DECIDE);
      clearFrameTasks(P);
      timerInterruptOn(P);
      yield* closeCourtSelect4Panel(P, 1);
      wr(P, "menuSlideDirection", MENUSLIDE_FORWARD);
      return pickCourt(P, 2, CourtSelectBgmIds_3e);
    }
    if (input & PADF_B) {
      sound(P, SFX_MENU_CANCEL);
      clearFrameTasks(P);
      timerInterruptOn(P);
      yield* closeCourtSelect4Panel(P, 0);
      wr(P, "menuSlideDirection", MENUSLIDE_BACK);
      yield* fadeOutAndResetMenuScreen(P);
      return 0xFF;
    }
  }
}
// the menus' common start: the menu background's scroll and palettes, the title row, the panel sliding in, the
// cursor on wSubMenuCursor (the nine-court menu: on the first court), its sprite task, the first redraw
function* openCourtSelectMenu(P, cols, open, cursorTask, redraw, cursor = rd(P, "subMenuCursor")) {
  rom(P, FAR.InitMenuBgScroll);
  rom(P, FAR.LoadMenuSpritePalettePair, { b: 1, c: 1 });
  yield* loadCourtSelectHeader(P);
  wram(P, WRAM_SCREEN);
  yield* open();
  setMenuCursorFromIndex(P, cols, typeof cursor === "function" ? cursor() : cursor);
  registerFrameTask(P, 1, cursorTask);
  redraw(P);
}
// the chosen court: its music (by the table) into wMatchBGM; returns its id
function pickCourt(P, cols, bgmTable) {
  const index = getMenuCursorIndex(P, cols);
  wr(P, "matchBGM", rb(P, (bgmTable + index) & 0xFFFF));                    // SetCourtSelectBGM / ...Link
  return courtSelectIndexToCourtId(P, index);
}
// RunLinkCourtSelect4Menu (3E:5C38), slot $401A: the four-court menu over the link (the master's choice)
export function* runLinkCourtSelect4Menu(P) {
  endLinkSession(P);
  clearFrameTasks(P);
  home(P, HOME.EnableTimerInterrupt);
  sound(P, BGM_MENU);
  yield* openCourtSelectMenu(P, 2, () => openCourtSelect4Panel(P, rd(P, "menuSlideDirection")), CourtSelect4CursorSpriteTask, redrawCourtSelect4Menu);
  yield* romWait(P, FAR.ResyncLinkSessionWithTimer);
  for (let i = 0; i < 3; i++) yield* linkInputFrame(P);
  wram(P, WRAM_SCREEN);
  for (;;) {
    yield* linkInputFrame(P);
    wr(P, "menuInputPressed", P.V.linkInput);
    if (moveMenuCursorGrid(P, 2, 2)) { sound(P, SFX_MENU_MOVE); redrawCourtSelect4Menu(P); }
    const input = rd(P, "menuInputPressed");
    if (input & PADF_A) {
      sound(P, SFX_MENU_DECIDE);
      yield* romWait(P, FAR.SyncLinkFrame);
      clearFrameTasks(P);
      endLinkSession(P);
      home(P, HOME.EnableTimerInterrupt);
      wr(P, "menuSlideDirection", MENUSLIDE_FORWARD);
      return pickCourt(P, 2, CourtSelectBgmIdsLink_3e);
    }
    if (input & PADF_B) {
      sound(P, SFX_MENU_CANCEL);
      yield* romWait(P, FAR.SyncLinkFrame);
      endLinkSession(P);
      clearFrameTasks(P);
      yield* closeCourtSelect4Panel(P, 0);
      wr(P, "menuSlideDirection", MENUSLIDE_BACK);
      yield* fadeOut(P, 16);
      return 0xFF;
    }
  }
}
// CourtSelectIndexToCourtId (3E:5CFE): the court id of grid cell a (CourtSelectCourtIds_3e)
export const courtSelectIndexToCourtId = (P, index) => rb(P, (CourtSelectCourtIds_3e + index) & 0xFFFF);

// LoadCourtSelectGraphics (3E:5D11), slot $4020: the unlock bits (ours or'ed with a link partner's) stored; each
// court's thumbnail (a locked court's "?") into its VRAM place; the panels' tiles; the cursor palette
export function loadCourtSelectGraphics(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  storeCourtUnlockBits(P, rd(P, "unlockedCourtMask") | rd(P, "linkPartnerCourtMask"));
  wram(P, WRAM_STAGING);
  for (let court = 0; court < COURTS; court++) {
    const slot = getCourtThumbnailPtr(P, court, rw(P, CourtSelectGraphicsTable + 2 * court));
    home(P, 0x0234, { h: slot >> 8, l: slot & 0xFF, de: wDecompBuffer });   // DecompressDataFromBank
    queueVRAMCopy(P, wDecompBuffer, rw(P, CourtSelectTable + 2 * court), THUMBNAIL_BLOCKS);
  }
  for (const [block, blocks, dest] of COURT_SELECT_TILE_BLOCKS) loadCompressedTileBlock(P, block, dest, blocks);
  const r = rom(P, FAR.LoadIndexedPalette, { b: 0x08, c: 0x10 });
  wram(P, bank);
  return { ...r, a: bank, f: entryF };                            // (pop_wram_bank: the bank and the flags at the call)
}
// GetCourtThumbnailPtr (3E:5E17): the thumbnail's (bank, slot) hl, or the locked one's when court c is locked
export function getCourtThumbnailPtr(P, court, slot) { return isCourtUnlocked(P, court) ? slot : LOCKED_THUMBNAIL; }

// OpenCourtSelect4Panel (3E:5E2A): the panel sliding in (forward: panel $12 steps 0-12; back: panel $13 steps 10-0),
// a frame after
export function* openCourtSelect4Panel(P, forward) {
  if (forward) for (let c = 0; c < 0x0D; c++) { yield* advanceFrame(P); drawPanel(P, PANEL_4_OPEN, c); yield* flushPanel(P, FLUSH_LAYOUT_4); }
  else for (let c = 0x0A; c !== 0xFF; c = (c - 1) & 0xFF) { yield* advanceFrame(P); drawPanel(P, PANEL_4_CLOSE, c); yield* flushPanel(P, FLUSH_LAYOUT_4); }
  yield* advanceFrame(P);
}
// CloseCourtSelect4Panel (3E:5E62): the panel sliding out (forward: panel $13 steps 0-10; back: panel $12 steps 12-1)
export function* closeCourtSelect4Panel(P, forward) {
  if (forward) for (let c = 0; c < 0x0B; c++) { yield* advanceFrame(P); drawPanel(P, PANEL_4_CLOSE, c); yield* flushPanel(P, FLUSH_LAYOUT_4); }
  else for (let c = 0x0C; c; c--) { yield* advanceFrame(P); drawPanel(P, PANEL_4_OPEN, c); yield* flushPanel(P, FLUSH_LAYOUT_4); }
}
// the cursor's label sprite: under the cursor, by the cell's label row
function queueCursorLabel(P, cols, yOffsets, template, d, e) {
  const de = ((d << 8 | e) + (rb(P, (yOffsets + getMenuCursorIndex(P, cols)) & 0xFFFF) << 8 | LABEL_X_OFFSET)) & 0xFFFF;
  return queueSpriteTemplate(P, template, de >> 8, de & 0xFF, LABEL_TILE, OAM_BANK1);
}
// CourtSelect4CursorSpriteTask (3E:5E93), a frame task: the menu background's scroll, the cursor (its template and
// first tile by cell, bobbing) and the label
export function courtSelect4CursorSpriteTask(P) {
  rom(P, FAR.TickMenuBgScroll);
  const cell = getMenuCursorIndex(P, 2), tile = rb(P, (CourtSelect4CursorTiles_3e + cell) & 0xFFFF);
  const pos = rw(P, (CourtSelect4CursorPositions_3e + ((cell * 2) & 0xFF)) & 0xFFFF);
  const { d, e } = rom(P, FAR.ApplySpriteBobOffset, { c: tile, d: pos >> 8, e: pos & 0xFF });
  queueSpriteTemplate(P, rw(P, (CourtSelect4CursorSpriteTaskPtrs + ((cell * 2) & 0xFF)) & 0xFFFF), d, e, tile, OAM_BANK1);
  return queueCursorLabel(P, 2, CourtSelect4LabelYOffsets_3e, CourtSelect4CursorSpriteTask_SpriteTemplate, d, e);
}
// RedrawCourtSelect4Menu (3E:5F51): the tabs (the chosen one active), its palette and name; the tab rows and the
// title row to VRAM. Leaves WRAM 3 mapped.
export function redrawCourtSelect4Menu(P) {
  wram(P, WRAM_SCREEN);
  for (let tab = 0; tab < 4; tab++) setCourtTabAttrRect(P, CourtSelect4TabAttrAddrs_3e, tab, 0);
  setCourtTabAttrRect(P, CourtSelect4TabAttrAddrs_3e, getMenuCursorIndex(P, 2), 1);
  setCourtPalette(P, CourtSelect4PalettePtrs, getMenuCursorIndex(P, 2));
  const court = getMenuCursorIndex(P, 2);
  drawCourtNameTiles(P, isCourtUnlocked(P, court) ? court : NO_NAME);
  queueVRAMCopy(P, wShadowAttrmap + 4 * 32, vBGMap0 + 4 * 32 + VRAM_BANK1, 3 * 32 / 16);
  queueVRAMCopy(P, wShadowAttrmap + 9 * 32, vBGMap0 + 9 * 32 + VRAM_BANK1, 3 * 32 / 16);
  return queueVRAMCopy(P, wShadowTilemap + TITLE_ROW * 32, vBGMap0 + TITLE_ROW * 32, 32 / 16);
}
// SetCourtSelect4TabAttrRect (3E:5FAD) / SetCourtSelect9TabAttrRect (3E:688B): tab b's 5x3 attributes, active
// (c != 0: $0C) or not ($0D). Registers kept.
export function setCourtTabAttrRect(P, table, tab, active) {
  fillTilemapRect(P, rw(P, (table + ((tab * 2) & 0xFF)) & 0xFFFF), 0x05, 0x03, active ? TAB_ACTIVE : TAB_INACTIVE);
}
// SetCourtSelect4Palette (3E:5FDE) / SetCourtSelect9Palette (3E:68C6): court a's palette into BG palette 4
export function setCourtPalette(P, table, court) {
  return loadPaletteShadow(P, rw(P, (table + ((court * 2) & 0xFF)) & 0xFFFF), COURT_BG_PALETTE, 1);
}
// SetCourtSelectBGM (3E:60DD) / SetCourtSelectBGMLink (3E:60F4): court c's music into wMatchBGM
export function setCourtSelectBGM(P, court, link = false) {
  wr(P, "matchBGM", rb(P, ((link ? CourtSelectBgmIdsLink_3e : CourtSelectBgmIds_3e) + court) & 0xFFFF));
}

// ---- the title row ----
// LoadCourtSelectHeader (3E:610B): the title's tiles, the title row drawn and queued; a frame
export function* loadCourtSelectHeader(P) {
  loadCourtSelectTitleGfx(P);
  drawCourtSelectTitleRow(P);
  flushCourtSelectTitleRow(P);
  yield* advanceFrame(P);
}
function inBank(P, bank, fn) {
  const old = P.V.wramBank;
  wram(P, bank);
  const r = fn();
  wram(P, old);
  return r;
}
// DrawCourtSelectTitleRow (3E:6118): row 16 blank (18 cells from column 1), the "COURT SELECT" title's two parts
export const drawCourtSelectTitleRow = P => inBank(P, WRAM_SCREEN, () => {
  for (let i = 0; i < 0x12; i++) w8(P, wShadowTilemap + TITLE_ROW * 32 + 1 + i, TITLE_BLANK);
  drawCourtSelectTitleLeft(P);
  drawCourtSelectTitleRight(P);
});
const fillIncrementingBytes = (P, hl, first, count) => rom(P, FAR.FillIncrementingBytes, { hl, b: first, c: count });
// DrawCourtSelectTitleLeft (3E:6139): tiles $30-$3B, 4 a row, in rows 15-17 from column 0
export function drawCourtSelectTitleLeft(P) {
  let { b } = fillIncrementingBytes(P, wShadowTilemap + 15 * 32, 0x30, 4);
  b = fillIncrementingBytes(P, wShadowTilemap + 16 * 32, b, 4).b;
  return fillIncrementingBytes(P, wShadowTilemap + 17 * 32, b, 4);
}
// DrawCourtSelectTitleRight (3E:6154): tiles $40-$44 in row 16 from column 9
export const drawCourtSelectTitleRight = P => fillIncrementingBytes(P, wShadowTilemap + TITLE_ROW * 32 + 9, 0x40, 5);
// FlushCourtSelectTitleRow (3E:615F): rows 15-17 to VRAM
export const flushCourtSelectTitleRow = P => inBank(P, WRAM_SCREEN, () =>
  queueVRAMCopy(P, wShadowTilemap + 15 * 32, vBGMap0 + 15 * 32, 3 * 32 / 16));
// LoadCourtSelectTitleGfx (3E:617A): the title's tiles, through WRAM 1
export const loadCourtSelectTitleGfx = P => inBank(P, WRAM_STAGING, () => {
  loadCourtSelectTitleTiles(P);
  loadCourtSelectTitleTiles2(P);
  loadCourtSelectPanelTiles(P);
});
// LoadCourtSelectTitleTiles (3E:6192) / ...Tiles2 (3E:61A8) / LoadCourtSelectPanelTiles (3E:61BE)
export function loadCourtSelectTitleTiles(P) {
  decompressData(P, CourtSelectTitleTiles, wDecompBuffer);
  return queueVRAMCopy(P, wDecompBuffer, vTiles2 + 0x30 * TILE_SIZE, TITLE_TILE_BLOCKS);
}
export function loadCourtSelectTitleTiles2(P) {
  decompressData(P, CourtSelectTitleTiles2Gfx, wDecompBuffer + 16 * TILE_SIZE);
  return queueVRAMCopy(P, wDecompBuffer + 16 * TILE_SIZE, vTiles2 + 0x40 * TILE_SIZE, TITLE_TILES2_BLOCKS);
}
export function loadCourtSelectPanelTiles(P) {
  decompressData(P, CourtSelectPanelTiles, wDecompBuffer + 32 * TILE_SIZE);
  return queueVRAMCopy(P, wDecompBuffer + 32 * TILE_SIZE, vTiles1, PANEL_TILE_BLOCKS);
}
// DrawCourtNameTiles (3E:648F): court b's name in the title row (b = $FF: the locked court's "?")
export const drawCourtNameTiles = (P, court) => inBank(P, WRAM_SCREEN, () => {
  drawCourtNameLeft(P, court);
  drawCourtNameRight(P, court);
});
// DrawCourtNameLeft (3E:64A6) / DrawCourtNameRight (3E:64CF): the name's two parts (5 tiles from column 4, 6 from
// column 14), their first tile from CourtNameLeft/RightIndices_3e + $80
export function drawCourtNameLeft(P, court) {
  const first = court === NO_NAME ? NAME_LOCKED_LEFT : (rb(P, (CourtNameLeftIndices_3e + court) & 0xFFFF) + NAME_TILES) & 0xFF;
  return fillIncrementingBytes(P, wShadowTilemap + TITLE_ROW * 32 + 4, first, 5);
}
export function drawCourtNameRight(P, court) {
  const first = court === NO_NAME ? NAME_LOCKED_RIGHT : (rb(P, (CourtNameRightIndices_3e + court) & 0xFFFF) + NAME_TILES) & 0xFF;
  return fillIncrementingBytes(P, wShadowTilemap + TITLE_ROW * 32 + 14, first, 6);
}

// ---- the nine-court menu ----
// FadeOutAndResetMenuScreen (3E:64F8): a fade out (16), the LCD off, the menu font and screen reset
export function* fadeOutAndResetMenuScreen(P) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  yield* fadeOut(P, 16);
  disableLCDSafely(P);
  const { a } = rom(P, FAR.LoadMenuFontGfx);
  yield* romWait(P, FAR.ResetScreenAndTextWindows, { a });                  // (the scroll set to the a it leaves)
  wram(P, bank);
}
// RunCourtSelect9Menu (3E:6518), slot $401C: see the header. Returns a = the court id, or $FF.
export function* runCourtSelect9Menu(P) {
  storeCourtUnlockBits(P, rd(P, "unlockedCourtMask"));
  sound(P, BGM_MENU);
  clearFrameTasks(P);
  timerInterruptOff(P);
  yield* openCourtSelectMenu(P, 3, () => openCourtSelect9Panel(P, rd(P, "menuSlideDirection")), CourtSelect9CursorSpriteTask, redrawCourtSelect9Menu, 0);
  for (;;) {
    yield* advanceFrame(P);
    wr(P, "menuInputPressed", P.V.inputPressed);
    if (moveMenuCursorGrid(P, 3, 3)) { sound(P, SFX_MENU_MOVE); redrawCourtSelect9Menu(P); }
    const input = rd(P, "menuInputPressed");
    if (input & PADF_A) {
      if (!isCourtUnlocked(P, getMenuCursorIndex(P, 3))) { sound(P, SFX_MENU_LOCKED); continue; }
      sound(P, SFX_MENU_DECIDE);
      clearFrameTasks(P);
      timerInterruptOn(P);
      yield* closeCourtSelect9Panel(P, 1);
      wr(P, "menuSlideDirection", MENUSLIDE_FORWARD);
      return pickCourt(P, 3, CourtSelectBgmIds_3e);
    }
    if (input & PADF_B) {
      sound(P, SFX_MENU_CANCEL);
      clearFrameTasks(P);
      timerInterruptOn(P);
      yield* closeCourtSelect9Panel(P, 0);
      wr(P, "menuSlideDirection", MENUSLIDE_BACK);
      return 0xFF;
    }
  }
}
// RunLinkCourtSelect9Menu (3E:65C9), slot $401E: the nine-court menu over the link (both players' unlocked courts)
export function* runLinkCourtSelect9Menu(P) {
  endLinkSession(P);
  clearFrameTasks(P);
  home(P, HOME.EnableTimerInterrupt);
  sound(P, BGM_MENU);
  storeCourtUnlockBits(P, rd(P, "unlockedCourtMask") | rd(P, "linkPartnerCourtMask"));
  yield* openCourtSelectMenu(P, 3, () => openCourtSelect9Panel(P, rd(P, "menuSlideDirection")), CourtSelect9CursorSpriteTask, redrawCourtSelect9Menu);
  yield* romWait(P, FAR.ResyncLinkSessionWithTimer);
  for (let i = 0; i < 3; i++) yield* linkInputFrame(P);
  wram(P, WRAM_SCREEN);
  for (;;) {
    wr(P, "menuInputPressed", P.V.linkInput);
    yield* linkInputFrame(P);
    if (moveMenuCursorGrid(P, 3, 3)) { sound(P, SFX_MENU_MOVE); redrawCourtSelect9Menu(P); }
    const input = rd(P, "menuInputPressed");
    if (input & PADF_A) {
      if (!isCourtUnlocked(P, getMenuCursorIndex(P, 3))) { sound(P, SFX_MENU_LOCKED); continue; }
      sound(P, SFX_MENU_DECIDE);
      yield* romWait(P, FAR.SyncLinkFrame);
      clearFrameTasks(P);
      endLinkSession(P);
      home(P, HOME.EnableTimerInterrupt);
      wr(P, "menuSlideDirection", MENUSLIDE_FORWARD);
      return pickCourt(P, 3, CourtSelectBgmIdsLink_3e);
    }
    if (input & PADF_B) {
      sound(P, SFX_MENU_CANCEL);
      yield* romWait(P, FAR.SyncLinkFrame);
      endLinkSession(P);
      clearFrameTasks(P);
      yield* closeCourtSelect9Panel(P, 0);
      wr(P, "menuSlideDirection", MENUSLIDE_BACK);
      yield* fadeOut(P, 16);
      return 0xFF;
    }
  }
}
// OpenCourtSelect9Panel (3E:66AB): forward panel $14 steps 0-14, back panel $15 steps 9-0; a frame after
export function* openCourtSelect9Panel(P, forward) {
  if (forward) for (let c = 0; c < 0x0F; c++) { yield* advanceFrame(P); drawPanel(P, PANEL_9_OPEN, c); yield* flushPanel(P, FLUSH_LAYOUT_9); }
  else for (let c = 0x09; c !== 0xFF; c = (c - 1) & 0xFF) { yield* advanceFrame(P); drawPanel(P, PANEL_9_CLOSE, c); yield* flushPanel(P, FLUSH_LAYOUT_9); }
  yield* advanceFrame(P);
}
// CloseCourtSelect9Panel (3E:66E3): forward panel $15 steps 0-10, back panel $14 steps 14-1
export function* closeCourtSelect9Panel(P, forward) {
  if (forward) for (let c = 0; c < 0x0B; c++) { yield* advanceFrame(P); drawPanel(P, PANEL_9_CLOSE, c); yield* flushPanel(P, FLUSH_LAYOUT_9); }
  else for (let c = 0x0E; c; c--) { yield* advanceFrame(P); drawPanel(P, PANEL_9_OPEN, c); yield* flushPanel(P, FLUSH_LAYOUT_9); }
}
// CourtSelect9CursorSpriteTask (3E:6714), a frame task: the scroll, the cursor (a locked court's: plain, tiles
// + $40) and the label
export function courtSelect9CursorSpriteTask(P) {
  rom(P, FAR.TickMenuBgScroll);
  const cell = getMenuCursorIndex(P, 3);
  let tile = rb(P, (CourtSelect9CursorTiles_3e + cell) & 0xFFFF);
  const pos = rw(P, (CourtSelect9CursorPositions_3e + ((cell * 2) & 0xFF)) & 0xFFFF);
  const { d, e } = rom(P, FAR.ApplySpriteBobOffset, { c: tile, d: pos >> 8, e: pos & 0xFF });
  let attr = rb(P, (CourtSelect9CursorAttrs_3e + getMenuCursorIndex(P, 3)) & 0xFFFF);
  ({ b: attr, c: tile } = adjustCursorForLockedCourt(P, attr, tile));
  queueSpriteTemplate(P, rw(P, (CourtSelect9CursorTemplatePtrs_3e + ((cell * 2) & 0xFF)) & 0xFFFF), d, e, tile, attr);
  return queueCursorLabel(P, 3, CourtSelect9LabelYOffsets_3e, CourtSelect9CursorSpriteTask_SpriteTemplate, d, e);
}
// AdjustCursorForLockedCourt (3E:680C): on a locked court the cursor's attribute 0 and tile $40 (bc kept else;
// on a locked court the ROM pops the saved bc into af)
export function adjustCursorForLockedCourt(P, attr, tile) {
  if (isCourtUnlocked(P, getMenuCursorIndex(P, 3))) return { b: attr, c: tile };
  return { b: 0, c: LOCKED_TILE_OFFSET, a: attr, f: tile & 0xF0 };
}
// RedrawCourtSelect9Menu (3E:6824): as RedrawCourtSelect4Menu, nine tabs; their rows and the title row to VRAM
export function redrawCourtSelect9Menu(P) {
  wram(P, WRAM_SCREEN);
  for (let tab = 0; tab < COURTS; tab++) setCourtTabAttrRect(P, CourtSelect9TabAttrAddrs_3e, tab, 0);
  setCourtTabAttrRect(P, CourtSelect9TabAttrAddrs_3e, getMenuCursorIndex(P, 3), 1);
  setCourtPalette(P, CourtSelect9PalettePtrs, getMenuCursorIndex(P, 3));
  const court = getMenuCursorIndex(P, 3);
  drawCourtNameTiles(P, isCourtUnlocked(P, court) ? court : NO_NAME);
  for (const row of [3, 7, 11]) queueVRAMCopy(P, wShadowAttrmap + row * 32, vBGMap0 + row * 32 + VRAM_BANK1, 3 * 32 / 16);
  return queueVRAMCopy(P, wShadowTilemap + TITLE_ROW * 32, vBGMap0 + TITLE_ROW * 32, 32 / 16);
}

// ---- the unlocked courts ----
// StoreCourtUnlockBits (3E:695A): the five bonus courts' bits of b, one a byte, at wScreenAttrmap (WRAM 2)
export const storeCourtUnlockBits = (P, bits) => inBank(P, WRAM_COURT_PLANES, () => {
  for (let i = 0; i < BONUS_COURTS; i++, bits >>= 1) w8(P, wScreenAttrmap + i, bits & 1);
});
// IsCourtUnlocked (3E:697B): court b's unlock byte (the four court types: always 1)
export function isCourtUnlocked(P, court) {
  if (court < COURT_STAR) return 1;
  return inBank(P, WRAM_COURT_PLANES, () => u8(P, (wScreenAttrmap + ((court - COURT_STAR) & 0xFF)) & 0xFFFF));
}
// ComputeUnlockedCourtFlags (3E:69A0), slot $4022: the save flags of the five bonus courts into wUnlockedCourtMask
// (the first court in bit 4)
export function computeUnlockedCourtFlags(P) {
  let mask = 0;
  for (let i = 0; i < BONUS_COURTS; i++) {
    if (!(rom(P, FAR.TestSaveFlag, { de: rw(P, CourtUnlockFlagIds_3e + 2 * i) }).f & FZ)) mask |= 1;
    if (i < BONUS_COURTS - 1) mask = (mask << 1) & 0xFF;
  }
  wr(P, "unlockedCourtMask", mask);
  // the registers it leaves: the mask, c = 5 (the flags of `cp 5`), de = the last flag id, hl after it
  const last = CourtUnlockFlagIds_3e + 2 * (BONUS_COURTS - 1);
  return { a: mask, b: mask, c: BONUS_COURTS, de: rw(P, last), hl: last + 1, f: FZ | 0x40 };
}

const B = BANK_COURT_SELECT;
const ret = (fn) => hookGen(function* (P, c) { return { a: yield* fn(P, c) }; });
export const HOOKS = [
  [B, 0x5B99, ret(P => runCourtSelect4Menu(P))],
  [B, 0x5C38, ret(P => runLinkCourtSelect4Menu(P))],
  [B, 0x5CFE, hook((P, c) => ({ a: courtSelectIndexToCourtId(P, c.a) }))],
  [B, 0x5D11, hook(P => loadCourtSelectGraphics(P))],
  [B, 0x5E17, hook((P, c) => ({ hl: getCourtThumbnailPtr(P, c.c, c.hl) }))],
  [B, 0x5E2A, hookGen((P, c) => openCourtSelect4Panel(P, c.b))],
  [B, 0x5E62, hookGen((P, c) => closeCourtSelect4Panel(P, c.b))],
  [B, CourtSelect4CursorSpriteTask, hook(P => { courtSelect4CursorSpriteTask(P); })],
  [B, 0x5F51, hook(P => { redrawCourtSelect4Menu(P); })],
  [B, 0x5FAD, hook((P, c) => { setCourtTabAttrRect(P, CourtSelect4TabAttrAddrs_3e, c.b, c.c); })],
  [B, 0x5FDE, hook((P, c) => { setCourtPalette(P, CourtSelect4PalettePtrs, c.a); })],
  [B, 0x60DD, hook((P, c) => { setCourtSelectBGM(P, c.c); })],
  [B, 0x60F4, hook((P, c) => { setCourtSelectBGM(P, c.c, true); })],
  [B, 0x610B, hookGen(P => loadCourtSelectHeader(P))],
  [B, 0x6118, hook(P => { drawCourtSelectTitleRow(P); })],
  [B, 0x6139, hook(P => { drawCourtSelectTitleLeft(P); })],
  [B, 0x6154, hook(P => { drawCourtSelectTitleRight(P); })],
  [B, 0x615F, hook(P => { flushCourtSelectTitleRow(P); })],
  [B, 0x617A, hook(P => { loadCourtSelectTitleGfx(P); })],
  [B, 0x6192, hook(P => { loadCourtSelectTitleTiles(P); })],
  [B, 0x61A8, hook(P => { loadCourtSelectTitleTiles2(P); })],
  [B, 0x61BE, hook(P => { loadCourtSelectPanelTiles(P); })],
  [B, 0x648F, hook((P, c) => { drawCourtNameTiles(P, c.b); })],
  [B, 0x64A6, hook((P, c) => { drawCourtNameLeft(P, c.b); })],
  [B, 0x64CF, hook((P, c) => { drawCourtNameRight(P, c.b); })],
  [B, 0x64F8, hookGen(P => fadeOutAndResetMenuScreen(P))],
  [B, 0x6518, ret(P => runCourtSelect9Menu(P))],
  [B, 0x65C9, ret(P => runLinkCourtSelect9Menu(P))],
  [B, 0x66AB, hookGen((P, c) => openCourtSelect9Panel(P, c.b))],
  [B, 0x66E3, hookGen((P, c) => closeCourtSelect9Panel(P, c.b))],
  [B, CourtSelect9CursorSpriteTask, hook(P => { courtSelect9CursorSpriteTask(P); })],
  [B, 0x680C, hook((P, c) => adjustCursorForLockedCourt(P, c.b, c.c))],
  [B, 0x6824, hook(P => { redrawCourtSelect9Menu(P); })],
  [B, 0x688B, hook((P, c) => { setCourtTabAttrRect(P, CourtSelect9TabAttrAddrs_3e, c.b, c.c); })],
  [B, 0x68C6, hook((P, c) => { setCourtPalette(P, CourtSelect9PalettePtrs, c.a); })],
  [B, 0x695A, hook((P, c) => { storeCourtUnlockBits(P, c.b); })],
  [B, 0x697B, hook((P, c) => { const a = isCourtUnlocked(P, c.b); return { a, b: a }; })],
  [B, 0x69A0, hook(P => computeUnlockedCourtFlags(P))],
  [B, 0x69D4, hook(() => {})],
];
