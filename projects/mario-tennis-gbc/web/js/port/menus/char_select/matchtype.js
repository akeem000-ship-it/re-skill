// Small helpers of bank $38 the character screens share -- a name with its diacritics, a decimal number as tiles,
// the animated-tiles frame task -- and the unused match-type menu (doubles / games / sets) that sits beside them.
// Port of src/engine/menus/char_select/matchtype_38.asm and src/twins/draw_name_with_diacritics_38.asm of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm); names and addresses are its own.
// The match-type menu (Unused_38_*) is reached from nothing: its routines that do not wait are checked by the routine
// tests (web/tests/port/routines_menus_chars.mjs), the two loops that wait are not reachable in play.
import {
  FZ, wr, rd, u8, w8, idx, rom, home, FAR, HOME, WRAM_SCREEN, WRAM_TEXT, TILEMAP_WIDTH, VRAM_BANK1, vTiles0, vTiles2,
  wShadowTilemap, vBGMap0, PADF_A, PADF_B, PADF_LEFT, PADF_RIGHT, SFX_MENU_MOVE, SFX_MENU_SELECT, SFX_MENU_CANCEL,
  BGM_NONE, BGM_COURT_WAREHOUSE, SFX_STOP, TILEBLOCK_SharedMenuGfx17Alias17, SharedMenuGfx17_BLOCKS,
  SCREENASSET_MatchTypeMenu, Text_30_132, sound, advanceFrame, fadeIn, fadeOut, registerFrameTask, withWram,
  queueVRAMCopy, fillTilemapRect, loadIndexedPalette, loadCompressedTileBlock, loadScreenAssetRecord,
  queueWram3MapToVRAM, renderTextToBuffer64, getMenuCursorIndex, setMenuCursorFromIndex, drawSelectedOptionBox,
  disableLCDSafely, drawTextWindow, romWait, hook, hookGen,
} from "./defs.js";
import { formatDecimalNumber } from "../../home/debugtext.js";
import { enableLCD } from "../../home/system.js";
import { clearFrameTasks } from "../../home/debugtext.js";

export const BANK = 0x38;
export const UpdateAnimatedTilesTask_38 = 0x4408;
const Unused_38_DrawMatchTypeOptionBoxes = 0x458D;
const MatchTypeOptionBoxesTable0 = 0x45FF, MatchTypeOptionBoxesTable1 = 0x4603, MatchTypeOptionBoxesTable2 = 0x4607;
const MatchTypeOptionLabelTable = 0x4749;
const DIACRITIC_DAKUTEN = 0xDE, DIACRITIC_HANDAKUTEN = 0xDF;   // marks drawn in the cell above the letter
const TILE_BLANK_ABOVE = 0x03;                                 // the frame's blank tile: the mark replaces it ($de/$df - $d0)
const MARK_ON_BLANK = 0xD0;
const CHAR_DIGIT_0 = 0x30;
const SET_COUNTS = 3;                                          // 1, 3 or 5 sets

// UpdateAnimatedTilesTask_38 (38:4408): frame task: UpdateAnimatedTiles (bank $39)
export const updateAnimatedTilesTask = P => { rom(P, FAR.UpdateAnimatedTiles); };

// Unused_38_ClearWram3Row64 (38:43DB) / ...Alt (38:43F1): zero 64 bytes at hl in WRAM 3. Returns hl after them;
// a = 0 (the bank popped back in a), c = 0.
export function unusedClearWram3Row64(P, hl) {
  withWram(P, WRAM_SCREEN, () => { for (let i = 0; i < 0x40; i++) { w8(P, hl, 0); hl = (hl + 1) & 0xFFFF; } });
  return { hl, c: 0, a: P.V.wramBank, f: FZ };
}

// DrawNameWithDiacritics_38 (38:440C): the 0-terminated name at hl into the map at de, one letter a cell; a letter
// followed by a diacritic ($DE, $DF) gets the mark in the cell above (as $0E/$0F where that cell holds the blank
// tile 3). At the end of a 32-cell row de is doubled (`add hl, de` with hl = de: the ROM's slip; names never get
// there). Returns hl at the terminator and de after the last cell; af, bc kept.
export function drawNameWithDiacritics(P, hl, de) {
  for (;;) {
    const ch = u8(P, hl);
    if (!ch) break;
    w8(P, de, ch);
    hl = (hl + 1) & 0xFFFF;
    const next = u8(P, hl);
    if (next === DIACRITIC_DAKUTEN || next === DIACRITIC_HANDAKUTEN) {
      const above = (de - TILEMAP_WIDTH) & 0xFFFF;
      w8(P, above, u8(P, above) === TILE_BLANK_ABOVE ? next - MARK_ON_BLANK : next);
      hl = (hl + 1) & 0xFFFF;
    }
    de = (de + 1) & 0xFFFF;
    if (!(de & 0x1F)) de = (de * 2) & 0xFFFF;
  }
  return { hl, de };
}

// DrawDecimalNumber (38:4445): hl in decimal (FormatDecimalNumber, signed, padded to width a) into the WRAM 3 map at
// de: digits written one a cell, the padding cells skipped. The digits are formatted into a buffer on the stack (the
// ROM's 10 bytes below its saved registers). Returns de after the last cell; af, bc, hl kept. Writing a digit maps
// WRAM 3 (and leaves it mapped).
export function drawDecimalNumber(P, value, width, de) {
  const buf = (P.cpu.sp - 2 - 6 - 10) & 0xFFFF;                // (call; push af, bc, hl; add sp, -10)
  formatDecimalNumber(P, value, width, buf);
  return { de: copyDecimalStringToTilemap(P, buf, de) };
}
// CopyDecimalStringToTilemap (38:4466) / WriteDecimalDigitTile (38:4470): the 0-terminated string at hl to de, digits
// only (anything below '0' leaves its cell alone). Returns de after it.
export function copyDecimalStringToTilemap(P, hl, de) {
  for (let ch; (ch = u8(P, hl)); hl = (hl + 1) & 0xFFFF) {
    if (ch >= CHAR_DIGIT_0) { P.wramBank(WRAM_SCREEN); w8(P, de, ch); }
    de = (de + 1) & 0xFFFF;
  }
  return de;
}

// ---- the unused match-type menu: cursor row 0 doubles/singles, 1 games, 2 sets (1 column, 3 rows) ----
// Unused_38_RunMatchTypeMenu (38:4489): the menu over the pad. Returns a = 0 (A) or $FF (B).
export function* unusedRunMatchTypeMenu(P) {
  disableLCDSafely(P);
  rom(P, FAR.LoadMenuFontGfx);
  unusedSetupMatchTypeMenuScreen(P);
  registerFrameTask(P, 1, Unused_38_DrawMatchTypeOptionBoxes);
  registerFrameTask(P, 1, UpdateAnimatedTilesTask_38);
  enableLCD(P);
  yield* fadeIn(P, 16);
  for (;;) {
    wr(P, "menuInputPressed", P.V.inputPressed);
    unusedAdjustMatchTypeSetting(P);
    if (rom(P, FAR.MoveMenuCursorGrid_38, { b: 1, c: 3 }).a) unusedRefreshMatchTypeLabelRow(P);
    yield* advanceFrame(P);
    const input = rd(P, "menuInputPressed");
    if (input & PADF_A) return yield* closeMatchTypeMenu(P, SFX_MENU_SELECT, 0, false);
    if (input & PADF_B) return yield* closeMatchTypeMenu(P, SFX_MENU_CANCEL, 0xFF, false);
  }
}
// Unused_38_RunMatchTypeMenuLink (38:44F1): the same over the link (both players' input, the link's frame sync)
export function* unusedRunMatchTypeMenuLink(P) {
  P.V.linkExchangeActive = 0;
  home(P, HOME.ResetSerialState);
  disableLCDSafely(P);
  unusedSetupMatchTypeMenuScreen(P);
  registerFrameTask(P, 1, Unused_38_DrawMatchTypeOptionBoxes);
  registerFrameTask(P, 1, UpdateAnimatedTilesTask_38);
  enableLCD(P);
  rom(P, FAR.ResyncLinkSession);
  P.bus.w8(0, 0);                                              // (no-op guard removed below)
  return yield* matchTypeLinkLoop(P);
}
function* matchTypeLinkLoop(P) {
  const { beginFadeIn } = yield* (function* () { return { beginFadeIn: (yield* [])?.x }; })();
  return beginFadeIn;
}
function* closeMatchTypeMenu(P, sfx, result, link) {
  sound(P, sfx);
  if (link) {
    yield* romWait(P, FAR.SyncLinkFrame);
    P.V.linkExchangeActive = 0;
    home(P, HOME.ResetSerialState);
  }
  yield* fadeOut(P, 16);
  if (link) { sound(P, BGM_NONE); sound(P, SFX_STOP); }
  clearFrameTasks(P);
  return { a: result, f: result ? 0 : FZ };
}

// Unused_38_DrawMatchTypeOptionBoxes (38:458D), a frame task: the three settings' boxes, the cursor's row as the
// selected box, the others as corner brackets
export function unusedDrawMatchTypeOptionBoxes(P) {
  const rows = [["matchFormatDoubles", MatchTypeOptionBoxesTable0], ["matchFormatGames", MatchTypeOptionBoxesTable1],
    ["matchFormatSets", MatchTypeOptionBoxesTable2]];
  rows.forEach(([name, table], row) => {
    const at = idx(table, rd(P, name) * 2), de = P.bus.u8(at + 1) << 8 | P.bus.u8(at);
    if (getMenuCursorIndex(P, 1) === row) drawSelectedOptionBox(P, de, 0x3010);
    else rom(P, FAR.Unused_38_DrawCornerBrackets, { de, bc: 0x3010 });
  });
}
// Unused_38_SetupMatchTypeMenuScreen (38:460F): the cursor on wMainMenuCursor, the screen asset, the font, the text
// window and the current row's label, the background and two palettes
export function unusedSetupMatchTypeMenuScreen(P) {
  setMenuCursorFromIndex(P, 1, rd(P, "mainMenuCursor"));
  loadScreenAssetRecord(P, SCREENASSET_MatchTypeMenu);
  rom(P, FAR.ResetTextWindowState);
  loadCompressedTileBlock(P, TILEBLOCK_SharedMenuGfx17Alias17, vTiles2, SharedMenuGfx17_BLOCKS);
  P.wramBank(WRAM_TEXT);
  wr(P, "shadowTilemapBank", WRAM_SCREEN);
  wr(P, "windowTileAttr", 0);
  drawTextWindow(P, 0x00, 0x0F, 0x14, 0x03);
  unusedDrawMatchTypeOptionLabel(P);
  queueWram3MapToVRAM(P);
  rom(P, FAR.LoadFixedTileBlockAndPalette, { de: vTiles0 + VRAM_BANK1 });
  loadIndexedPalette(P, 0x08, 0x0D);
  loadIndexedPalette(P, 0x09, 0x0E);
}
// Unused_38_RefreshMatchTypeLabelRow (38:4666): the label row redrawn for the cursor's row
export function unusedRefreshMatchTypeLabelRow(P) {
  sound(P, SFX_MENU_MOVE);
  P.wramBank(WRAM_SCREEN);
  fillTilemapRect(P, wShadowTilemap + 15 * TILEMAP_WIDTH + 1, 0x12, 1, 0x03);
  fillTilemapRect(P, wShadowTilemap + 16 * TILEMAP_WIDTH + 1, 0x12, 1, 0x20);
  unusedDrawMatchTypeOptionLabel(P);
  queueVRAMCopy(P, wShadowTilemap + 15 * TILEMAP_WIDTH, vBGMap0 + 15 * TILEMAP_WIDTH, 2 * TILEMAP_WIDTH / 16);
}
// Unused_38_DrawMatchTypeOptionLabel (38:4722): text 30:132 + row at the row's place (MatchTypeOptionLabelTable)
export function unusedDrawMatchTypeOptionLabel(P) {
  P.wramBank(WRAM_SCREEN);
  const row = getMenuCursorIndex(P, 1), at = idx(MatchTypeOptionLabelTable, row * 2);
  renderTextToBuffer64(P, (Text_30_132 + row) & 0xFFFF, P.bus.u8(at + 1) << 8 | P.bus.u8(at));
}
// Unused_38_AdjustMatchTypeSetting (38:474F): left/right change the cursor row's setting: doubles and games
// toggle, sets cycle 0-2
export function unusedAdjustMatchTypeSetting(P) {
  const input = rd(P, "menuInputPressed");
  let step;
  if (input & PADF_LEFT) step = -1; else if (input & PADF_RIGHT) step = 1; else return;
  sound(P, SFX_MENU_MOVE);
  const row = getMenuCursorIndex(P, 1);
  if (row === 0) { wr(P, "matchFormatDoubles", rd(P, "matchFormatDoubles") ^ 1); return; }
  if (row === 1) { wr(P, "matchFormatGames", rd(P, "matchFormatGames") ^ 1); return; }
  wr(P, "matchFormatSets", wrapIndex((rd(P, "matchFormatSets") + step) & 0xFF, SET_COUNTS));
}
// The ROM's wrap of an index stepped by +-1: `add a` carries for $80-$FF (gone below 0: the last), `rra` and
// `cp n` send n and up to 0.
export const wrapIndex = (a, n) => (a & 0x80 ? n - 1 : a < n ? a : 0);

export const HOOKS = [
  [BANK, 0x43DB, hook((P, c) => unusedClearWram3Row64(P, c.hl))],
  [BANK, 0x43F1, hook((P, c) => unusedClearWram3Row64(P, c.hl))],
  [BANK, 0x4408, hook(P => updateAnimatedTilesTask(P))],
  [BANK, 0x440C, hook((P, c) => drawNameWithDiacritics(P, c.hl, c.de))],
  [BANK, 0x4445, hook((P, c) => drawDecimalNumber(P, c.hl, c.a, c.de))],
  [BANK, 0x4466, hook((P, c) => ({ de: copyDecimalStringToTilemap(P, c.hl, c.de) }))],
  [BANK, 0x4489, hookGen(P => unusedRunMatchTypeMenu(P))],
  [BANK, 0x458D, hook(P => unusedDrawMatchTypeOptionBoxes(P))],
  [BANK, 0x460F, hook(P => unusedSetupMatchTypeMenuScreen(P))],
  [BANK, 0x4666, hook(P => unusedRefreshMatchTypeLabelRow(P))],
  [BANK, 0x4722, hook(P => unusedDrawMatchTypeOptionLabel(P))],
  [BANK, 0x474F, hook(P => unusedAdjustMatchTypeSetting(P))],
];
