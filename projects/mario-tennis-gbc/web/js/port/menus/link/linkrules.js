// Bank $3e: the link match rules menu's rows, cursor and caption (rules.js has the menu), and the link status
// screens: the "linking" message screen (ShowLinkMessageScreen; ShowLinkStatusMessage writes its message: waiting,
// linked, or failed) with its pulsing palette, and the link error screen (ShowLinkErrorScreen: two lines of text and
// a flashing frame until a button).
// Port of src/engine/menus/link/linkrules_3e.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own; tables, palettes and templates are read
// from the ROM.
// Tests: lockstep on out/port/menus_erase1.mtrec, menus_tour1.mtrec, story_walk1.mtrec and out/engine/rec3.mtrec
// (the link message screen when a link is tried with no partner) and out/port/lk_error.mtrec (the error screen,
// scripted); web/tests/port/routines_menus_misc.mjs. The rules rows and cursor run only in the link rules menu
// (unverified in the lockstep: see rules.js) and are checked by the routine tests.
import {
  FZ, FAR, HOME, rom, romWait, home, wram, rd, u8, w8, idx, ixF, addFlags, advanceFrame, clearFrameTasks,
  queueSpriteTemplate, loadPaletteShadow, enableLCD, fadeIn, fillTilemapRect, loadCompressedTileBlock,
  loadScreenAssetRecord, queueWram3MapToVRAM, prepareGlyphBuffer, uploadGlyphBuffer, renderProportionalTextAt,
  disableLCDSafely, queueCopy, hook, hookGen, WRAM_SCREEN, WRAM_TEXT, TILEMAP_WIDTH, vTiles2, vBGMap0,
  wShadowTilemap, OAM_BANK1,
} from "../equipment/defs.js";
import { copyMemoryBC } from "../../home/memory.js";
import { clearBothSpriteBuffers } from "../../home/fade.js";
import { initSerialLink } from "../../home/link.js";
import { getMenuCursorIndex } from "../common/cursors.js";
import { drawTextWindow } from "../equipment/racket_choice.js";

export const BANK = 0x3E;
export const MatchRulesCursorSpriteTask = 0x48F1;
const rb = (P, a) => P.rom.u8(BANK, a & 0xFFFF), rw = (P, a) => P.rom.u16(BANK, a & 0xFFFF);
const MatchRuleOptionAttrAddrs_3e = 0x48A6, MatchRuleOptionAttrWidths_3e = 0x48B4;
const MatchRulesCursorSpriteTask_SpriteTemplate0 = 0x4943, MatchRulesCursorSpriteTask_SpriteTemplate1 = 0x4964;
const MatchRulesCursorPositions_3e = 0x496D, MatchRulesCursorTiles_3e = 0x497B, MatchRulesCaptionDests_3e = 0x49E0;
const AnimateLinkStatusPalettePtrs = 0x4A77, LinkErrorPalette_3e = 0x4B83, LinkErrorFlashColors_3e = 0x4B8B;
const RenderMatchFormatOptionText = [0x3B, 0x619B];
const SCREENASSET_LinkingScreen = 0x11, SCREENASSET_LinkError = 0x22;
const TILEBLOCK_SharedMenuGfx17Alias17 = 0x11, SharedMenuGfx17_BLOCKS = 0x10;
const Text_30_132 = 0x0084, Text_30_296 = 0x0128, Text_30_297 = 0x0129, Text_30_298 = 0x012A;
const Text_30_299 = 0x012B, Text_30_300 = 0x012C;
const OPTION_PLAIN = 0x0D, FIRST_GAMES_OPTION = 2, FIRST_SETS_OPTION = 4;
const CURSOR_LABEL_OFFSET = 0x17F8, CURSOR_LABEL_TILE = 0x70;
const FRAME_TOP = 0x03, FRAME_LEFT_CORNER = 0x02, FRAME_RIGHT_CORNER = 0x04, BLANK = 0x20, TEXT_WIDTH = 0x12;
const BG_PALETTE_3 = 3, BG_PALETTE_5 = 5, ERROR_FLASH_STEPS = 12;
const LINK_STATUS_WAITING = 0, LINK_STATUS_LINKED = 1;

// ---- the rules rows ----
// DrawSinglesDoublesRow (3E:4817) / DrawGameCountRow (3E:482F) / DrawSetCountRow (3E:4849): the row's options plain,
// the chosen one highlighted. Leave a = b = the chosen option, c = 1.
function drawRow(P, options, chosen, f) {
  for (const o of options) setMatchRuleOptionAttrRect(P, o, 0);
  setMatchRuleOptionAttrRect(P, chosen, 1);
  return { a: chosen, b: chosen, c: 1, f };
}
export const drawSinglesDoublesRow = (P, entryF = P.cpu.f) => drawRow(P, [0, 1], P.V.matchFormatDoubles, entryF);
export function drawGameCountRow(P) {
  const games = P.V.matchFormatGames;
  return drawRow(P, [2, 3], (games + FIRST_GAMES_OPTION) & 0xFF, addFlags(games, FIRST_GAMES_OPTION));
}
export function drawSetCountRow(P) {
  const sets = P.V.matchFormatSets;
  return drawRow(P, [4, 5, 6], (sets + FIRST_SETS_OPTION) & 0xFF, addFlags(sets, FIRST_SETS_OPTION));
}
// SetMatchRuleOptionAttrRect (3E:486A): option b's 5 x 3 attributes in WRAM 3: highlighted (c != 0: its palette,
// MatchRuleOptionAttrWidths_3e) or plain ($0D). Registers kept.
export function setMatchRuleOptionAttrRect(P, option, highlighted) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  const at = rw(P, idx(MatchRuleOptionAttrAddrs_3e, option * 2));
  fillTilemapRect(P, at, 0x05, 0x03, highlighted ? rb(P, idx(MatchRuleOptionAttrWidths_3e, option)) : OPTION_PLAIN);
  wram(P, bank);
}
// MatchRulesCursorSpriteTask (3E:48F1), a frame task: the cursor over the chosen option of its row (the option's
// tile and place, bobbing) and its label sprite
export function matchRulesCursorSpriteTask(P) {
  const { V } = P, row = getMenuCursorIndex(P, 1).a;
  const option = row === 0 ? V.matchFormatDoubles : row === 1 ? (V.matchFormatGames + FIRST_GAMES_OPTION) & 0xFF
    : (V.matchFormatSets + FIRST_SETS_OPTION) & 0xFF;
  const tile = rb(P, idx(MatchRulesCursorTiles_3e, option)), pos = rw(P, idx(MatchRulesCursorPositions_3e, option * 2));
  const { d, e } = rom(P, FAR.ApplySpriteBobOffset, { c: tile, d: pos >> 8, e: pos & 0xFF });
  queueSpriteTemplate(P, MatchRulesCursorSpriteTask_SpriteTemplate0, d, e, tile, OAM_BANK1);
  const de = ((d << 8 | e) + CURSOR_LABEL_OFFSET) & 0xFFFF;
  return queueSpriteTemplate(P, MatchRulesCursorSpriteTask_SpriteTemplate1, de >> 8, de & 0xFF, CURSOR_LABEL_TILE, OAM_BANK1);
}
// DrawMatchRulesCaption (3E:4982): the caption row's frame cleared and the cursor's row's caption written (bank $3b's
// RenderMatchFormatOptionText), the rows queued
export function drawMatchRulesCaption(P) {
  wram(P, WRAM_SCREEN);
  fillTilemapRect(P, wShadowTilemap + 15 * TILEMAP_WIDTH, 0x14, 0x01, FRAME_TOP);
  w8(P, wShadowTilemap + 15 * TILEMAP_WIDTH, FRAME_LEFT_CORNER);
  w8(P, wShadowTilemap + 15 * TILEMAP_WIDTH + 19, FRAME_RIGHT_CORNER);
  fillTilemapRect(P, wShadowTilemap + 16 * TILEMAP_WIDTH + 1, 0x12, 0x01, BLANK);
  rom(P, RenderMatchFormatOptionText);
  return queueCopy(P, wShadowTilemap + 15 * TILEMAP_WIDTH, vBGMap0 + 15 * TILEMAP_WIDTH, 2 * TILEMAP_WIDTH / 16);
}
// Unused_3e_DrawMatchRulesCaptionText (3E:49B9): the cursor's row's caption (Text_30_132 + row) at its place.
// Nothing calls it.
export function unusedDrawMatchRulesCaptionText(P) {
  wram(P, WRAM_SCREEN);
  const row = getMenuCursorIndex(P, 1).a;
  const de = rw(P, idx(MatchRulesCaptionDests_3e, row * 2));
  return { ...rom(P, FAR.RenderTextToBuffer64, { hl: idx(Text_30_132, row), de, c: 0x20 }), b: row };
}

// ---- the link message screen ----
// ShowLinkMessageScreen (3E:49E6), slot $4004: the "linking" screen loaded with the LCD off, its animated tiles
// started (set 0, every 3 frames), faded in. Registers and the WRAM bank kept.
export function* showLinkMessageScreen(P) {
  const bank = P.V.wramBank;
  disableLCDSafely(P);
  clearFrameTasks(P);
  loadLinkMessageScreen(P);
  P.V.animatedTileSet = 0;
  P.V.animatedTilePeriod = 3;
  enableLCD(P);
  yield* fadeIn(P, 8);
  wram(P, bank);
}
// LoadLinkMessageScreen (3E:4A14): the linking screen asset, the font, its 20 x 7 message window from row 11
export function loadLinkMessageScreen(P) {
  loadScreenAssetRecord(P, SCREENASSET_LinkingScreen);
  rom(P, FAR.ResetTextWindowState);
  loadCompressedTileBlock(P, TILEBLOCK_SharedMenuGfx17Alias17, vTiles2, SharedMenuGfx17_BLOCKS);
  wram(P, WRAM_TEXT);
  P.V.shadowTilemapBank = WRAM_SCREEN;
  P.V.windowTileAttr = 0;
  drawTextWindow(P, 0x00, 0x0B, 0x14, 0x07);
  wram(P, WRAM_SCREEN);
  prepareGlyphBuffer(P);
  return queueWram3MapToVRAM(P);
}
// AnimateLinkStatusPalette (3E:4A54): BG palette 5 stepping through the eight LinkStatusPalette entries every 4
// frames. Registers kept.
export function animateLinkStatusPalette(P) {
  const step = (P.V.vBlankCounter & 0x1C) >> 2;
  loadPaletteShadow(P, rw(P, AnimateLinkStatusPalettePtrs + step * 2), BG_PALETTE_5, 1);
}

// ---- the link error screen ----
// ShowLinkErrorScreen (3E:4AA7), slot $4002 (and LinkErrorReset's): the serial link reset, the error screen loaded
// with the LCD off (sprites cleared, the scroll at 0, its animated tiles every 5 frames), faded in; its frame flashes
// until a button is pressed
export function* showLinkErrorScreen(P) {
  initSerialLink(P);
  disableLCDSafely(P);
  clearFrameTasks(P);
  clearBothSpriteBuffers(P);
  P.V.scrollX = 0;
  P.V.scrollY = 0;
  yield* loadLinkErrorScreen(P);
  P.V.animatedTileSet = 0;
  P.V.animatedTilePeriod = 5;
  enableLCD(P);
  yield* fadeIn(P, 8);
  do {
    yield* advanceFrame(P);
    animateLinkErrorPalette(P);
  } while (!P.V.inputRisingEdge);
  return clearFrameTasks(P);
}
// LoadLinkErrorScreen (3E:4ADE): the error screen asset, the font, a 20 x 5 window from row 13 with the two lines of
// the message
export function* loadLinkErrorScreen(P) {
  loadScreenAssetRecord(P, SCREENASSET_LinkError);
  rom(P, FAR.ResetTextWindowState);
  loadCompressedTileBlock(P, TILEBLOCK_SharedMenuGfx17Alias17, vTiles2, SharedMenuGfx17_BLOCKS);
  wram(P, WRAM_TEXT);
  P.V.shadowTilemapBank = WRAM_SCREEN;
  P.V.windowTileAttr = 0;
  drawTextWindow(P, 0x00, 0x0D, 0x14, 0x05);
  prepareGlyphBuffer(P);
  wram(P, WRAM_SCREEN);
  yield* renderProportionalTextAt(P, Text_30_299, wShadowTilemap + 14 * TILEMAP_WIDTH + 1, TEXT_WIDTH);
  yield* renderProportionalTextAt(P, Text_30_300, wShadowTilemap + 16 * TILEMAP_WIDTH + 1, TEXT_WIDTH);
  yield* uploadGlyphBuffer(P);
  return queueWram3MapToVRAM(P);
}
// AnimateLinkErrorPalette (3E:4B37): BG palette 3 from LinkErrorPalette_3e with its second color stepping through
// LinkErrorFlashColors_3e every 4 frames (12 steps; the ROM's `add a / jr nc` never carries: steps 12-15 show 0)
export function animateLinkErrorPalette(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  const pal = P.A.linkErrorPalette;
  copyMemoryBC(P, LinkErrorPalette_3e, pal, 8);
  let step = (P.V.vBlankCounter & 0x3C) >> 2;
  if (step >= ERROR_FLASH_STEPS) step = 0;
  P.bus.w16(pal + 2, rw(P, LinkErrorFlashColors_3e + 2 * step));
  const r = loadPaletteShadow(P, pal, BG_PALETTE_3, 1);
  wram(P, bank);
  return { ...r, a: bank, f: entryF };
}
// ShowLinkStatusMessage (3E:4BA3), slot $4024: the message window's text: c = 0 "waiting", 1 "linked", else
// "failed"; the window's rows queued
export function* showLinkStatusMessage(P, status) {
  wram(P, WRAM_SCREEN);
  clearLinkMessageWindow(P);
  prepareGlyphBuffer(P);
  wram(P, WRAM_SCREEN);
  const text = status === LINK_STATUS_WAITING ? Text_30_297 : status === LINK_STATUS_LINKED ? Text_30_298 : Text_30_296;
  yield* renderProportionalTextAt(P, text, wShadowTilemap + 12 * TILEMAP_WIDTH + 1, TEXT_WIDTH);
  yield* uploadGlyphBuffer(P);
  return flushLinkMessageRows(P);
}
// ClearLinkMessageWindow (3E:4BED): the window's top edge and its 18 x 5 inside blank
export function clearLinkMessageWindow(P) {
  fillTilemapRect(P, wShadowTilemap + 11 * TILEMAP_WIDTH + 1, 0x12, 0x01, FRAME_TOP);
  return fillTilemapRect(P, wShadowTilemap + 12 * TILEMAP_WIDTH + 1, 0x12, 0x05, BLANK);
}
// FlushLinkMessageRows (3E:4C06): map rows 11-16 queued
export const flushLinkMessageRows = P => queueCopy(P, wShadowTilemap + 11 * TILEMAP_WIDTH, vBGMap0 + 11 * TILEMAP_WIDTH, 6 * TILEMAP_WIDTH / 16);

export const HOOKS = [
  [BANK, 0x4817, hook((P, c) => drawSinglesDoublesRow(P, c.f))],
  [BANK, 0x482F, hook(P => drawGameCountRow(P))],
  [BANK, 0x4849, hook(P => drawSetCountRow(P))],
  [BANK, 0x486A, hook((P, c) => { setMatchRuleOptionAttrRect(P, c.b, c.c); })],
  [BANK, 0x48F1, hook(P => matchRulesCursorSpriteTask(P))],
  [BANK, 0x4982, hook(P => drawMatchRulesCaption(P))],
  [BANK, 0x49B9, hook(P => unusedDrawMatchRulesCaptionText(P))],
  [BANK, 0x49E6, hookGen(P => showLinkMessageScreen(P))],
  [BANK, 0x4A14, hook(P => loadLinkMessageScreen(P))],
  [BANK, 0x4A54, hook(P => { animateLinkStatusPalette(P); })],
  [BANK, 0x4AA7, hookGen(P => showLinkErrorScreen(P))],
  [BANK, 0x4ADE, hookGen(P => loadLinkErrorScreen(P))],
  [BANK, 0x4B37, hook((P, c) => animateLinkErrorPalette(P, c.f))],
  [BANK, 0x4BA3, hookGen((P, c) => showLinkStatusMessage(P, c.c))],
  [BANK, 0x4BED, hook(P => clearLinkMessageWindow(P))],
  [BANK, 0x4C06, hook(P => flushLinkMessageRows(P))],
];
