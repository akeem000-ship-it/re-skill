// The pieces the bank-$3B menu screens share (the main menu, match format, saved data, erase, N64 record type and
// N64 transfer item menus are built the same way; the ROM repeats the code in each, with its own tables):
//   - the panels sliding in and out, one layout step a frame (RestoreMenuBgAndDrawPanel + FlushWram3MapRows);
//   - a grid of cells whose attributes are plain ($0D) or highlighted ($0C), the chosen cell's palette as BG 4;
//   - the caption line (row 15: a frame; row 16: the text);
//   - a frame task with the scrolling banner sprites and a bobbing frame of sprites around the chosen cell;
//   - a story file's caption: name, level, play time.
// Port of the common shape of src/engine/menus/main_menu/{main_menu,saveslots,saved,erase,n64transfer}_3b.asm of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm).
import { queueSpriteTemplate } from "../../home/fade.js";
import {
  farGen, advanceFrame, callFar, wDecompBuffer, TILE_SIZE, vTiles0, vTiles1, vTiles2, WRAM_STAGING, withRomBank, pushWramBank, popWramBank, wramBank, queueCopy, loadPalettes, cell,
  WRAM_SCREEN, TILEMAP_WIDTH, VRAM_BANK1, vBGMap0, wShadowTilemap, wShadowAttrmap, OAM_BANK1,
} from "../common/defs.js";
import { BANK_MENU_LIB, restoreMenuBgAndDrawPanel, flushWram3MapRows, fillTilemapRect } from "../common/tilemaps.js";
import { tickMenuBgScroll, applySpriteBobOffset } from "../common/menu_lib.js";
import { decompressDataFromBank } from "../../home/decompress.js";
import { BANK_CURSORBOX, loadIndexedPalette18 } from "../common/cursorbox.js";
import { TILEBLOCK, farLoadTileBlock, loadIndexedPalette } from "../common/menu_lib.js";
import { drawNameWithDiacritics } from "./n64.js";
import { printNumberRightAligned } from "./main_menu.js";

export const BANK_MAIN_MENU = 0x3B;
export const RenderTextToBuffer64 = [0x05, 0x5F52];
export const ATTR_HIGHLIGHT = 0x0C, ATTR_PLAIN = 0x0D;
export const CAPTION_ROW = 15, CAPTION = cell(wShadowTilemap, 1, 16);
// hl = table + i with the carry into h, as `ld hl, table / add l / ld l, a / jr nc / inc h`
export const ix = (table, i) => (table & 0xFF00) + (((table & 0xFF) + (i & 0xFF)) & 0x1FF);

// ---- sliding panels ----
// One slide: a frame, then the panel's layout at the step and the rows it covers queued (layout `rows` of
// FlushWram3MapRows), for each step from `from` to `to`.
export function* slidePanel(P, panel, from, to, rows) {
  const dir = from <= to ? 1 : -1;
  for (let step = from; ; step += dir) {
    yield* advanceFrame(P);
    withRomBank(P, BANK_MENU_LIB, () => restoreMenuBgAndDrawPanel(P, panel, step));
    yield* farGen(P, BANK_MENU_LIB, flushWram3MapRows(P, rows));
    if (step === to) return;
  }
}
// A menu's slide in (b != 0: forward, its "in" panel steps 0..n-1; else back, its "out" panel steps m..0) and out
// (forward: the "out" panel 0..k-1; back: the "in" panel j..1). s = { inPanel, inSteps, backFrom, outPanel, outSteps,
// backOutFrom, rows }.
export function* slideIn(P, forward, s) {
  if (forward) yield* slidePanel(P, s.inPanel, 0, s.inSteps - 1, s.rows);
  else yield* slidePanel(P, s.outPanel, s.backFrom, 0, s.rows);
}
export function* slideOut(P, forward, s) {
  if (forward) yield* slidePanel(P, s.outPanel, 0, s.outSteps - 1, s.rows);
  else yield* slidePanel(P, s.inPanel, s.backOutFrom, 1, s.rows);
}

// ---- the grid of cells ----
// A cell's attributes (width x 3 at its place in `table`, WRAM 3): highlighted or plain. Registers kept.
export function fillPickerCell(P, table, index, highlighted, width) {
  const dest = P.bus.u16(ix(table, index * 2));
  withRomBank(P, BANK_MENU_LIB, () => fillTilemapRect(P, dest, width, 3, highlighted ? ATTR_HIGHLIGHT : ATTR_PLAIN));
}
// the cell's palette (entry a of `ptrs`) as BG palette 4
export function loadPickerCellPalette(P, ptrs, index) { return loadPalettes(P, P.bus.u16(ix(ptrs, index * 2)), 4, 1); }
// the caption line's frame (row 15) and its blank text row (16)
export function drawCaptionFrame(P) {
  wramBank(P, WRAM_SCREEN);
  withRomBank(P, BANK_MENU_LIB, () => fillTilemapRect(P, cell(wShadowTilemap, 0, CAPTION_ROW), 0x14, 1, 0x03));
  P.bus.w8(cell(wShadowTilemap, 0, CAPTION_ROW), 0x02);
  P.bus.w8(cell(wShadowTilemap, 19, CAPTION_ROW), 0x04);
  withRomBank(P, BANK_MENU_LIB, () => fillTilemapRect(P, CAPTION, 0x12, 1, 0x20));
}
// the rows of cells' attributes (3 map rows from each row given) and the caption line queued to VRAM
export function queuePickerRows(P, rows) {
  for (const row of rows) queueCopy(P, cell(wShadowAttrmap, 0, row), vBGMap0 + row * TILEMAP_WIDTH + VRAM_BANK1, 3 * TILEMAP_WIDTH / 16);
  return queueCopy(P, cell(wShadowTilemap, 0, CAPTION_ROW), vBGMap0 + CAPTION_ROW * TILEMAP_WIDTH, 2 * TILEMAP_WIDTH / 16);
}
// a caption text (RenderTextToBuffer64) on the caption line; a, b: the registers the ROM has there (the callee
// gets them). Returns its registers.
export const captionText = (P, text, a, b) => callFar(P, RenderTextToBuffer64, { a, b, hl: text, de: CAPTION, c: 0x20 });
// a menu's caption text, with WRAM 3 pushed around it: the text's registers, then a = the bank, f = the flags of the
// call (pop_wram_bank)
export function bankedCaptionText(P, text, a, b, f) {
  const old = P.V.wramBank;
  pushWramBank(P, WRAM_SCREEN);
  const r = captionText(P, text, a, b);
  popWramBank(P);
  return { ...r, a: old, f };
}

// ---- the story files ----
// the 16-byte summaries BuildSaveSlotSummaries makes (WRAM 3, below the screen)
export const wSaveSlotSummaries = cell(wShadowTilemap, 0, 24), SUMMARY_SIZE = 0x10, NO_FILE = 0x3F;
export const summaryOf = file => ix(wSaveSlotSummaries, file * SUMMARY_SIZE);
const SUMMARY_LEVEL = 2, SUMMARY_NAME = 3, SUMMARY_HOURS = 0x0E, SUMMARY_MINUTES = 0x0F;
const wNumberScratch = cell(wShadowTilemap, 16, 25);
// A story file's caption: its name, "Lv" and level, hours ":" minutes; an empty file: the text noFileText. The
// WRAM bank is kept (push_wram_bank around); colonAfter: the ":" is written after the bank is restored (the main
// menu's copy), else before. Returns the registers it leaves (f: the flags of the call).
export function drawFileCaption(P, file, noFileText, colonAfter, f = 0) {
  const { bus } = P, bc = summaryOf(file), old = P.V.wramBank;
  pushWramBank(P, WRAM_SCREEN);
  if (bus.u8(bc) === NO_FILE) {
    const r = captionText(P, noFileText, NO_FILE, bc >> 8);
    popWramBank(P);
    return { ...r, a: old, f };
  }
  withRomBank(P, BANK_MAIN_MENU, () => drawNameWithDiacritics(P, (bc + SUMMARY_NAME) & 0xFFFF, CAPTION));
  bus.w8(cell(wShadowTilemap, 9, 16), 0x4C);                   // "Lv"
  bus.w8(cell(wShadowTilemap, 10, 16), 0x56);
  printNumberRightAligned(P, bus.u8(bc + SUMMARY_LEVEL), cell(wShadowTilemap, 12, 16), wNumberScratch, 0);
  printNumberRightAligned(P, bus.u8(bc + SUMMARY_MINUTES), cell(wShadowTilemap, 15, 16), wNumberScratch, 2);
  const r = printNumberRightAligned(P, bus.u8(bc + SUMMARY_HOURS), cell(wShadowTilemap, 18, 16), wNumberScratch, 2);
  if (!colonAfter) bus.w8(cell(wShadowTilemap, 16, 16), COLON);
  popWramBank(P);
  if (colonAfter) bus.w8(cell(wShadowTilemap, 16, 16), COLON);
  return { ...r, a: colonAfter ? COLON : old, f, bc: wNumberScratch };
}
const COLON = 0x3A;
// a story file's character palette as BG palette 4 (LoadIndexedPalette_18 of its color)
export function loadFilePalette(P, file) {
  const color = P.bus.u8(summaryOf(file) + 1);
  withRomBank(P, BANK_CURSORBOX, () => loadIndexedPalette18(P, color, 4));
}

// ---- the cursor's frame task ----
// The banner sprites, then the frame around the chosen cell: template0 at its place (table0[2i] = y, x; y bobbing)
// with tiles from table1[i], and template1 (tile $70) at the corner $17F8 from it.
export function pickerCursorTask(P, sp, index, table0, table1, template0, template1) {
  const { bus } = P;
  withRomBank(P, BANK_MENU_LIB, () => tickMenuBgScroll(P, sp));
  const tile = bus.u8(ix(table1, index));
  const at = bus.u16(ix(table0, index * 2));
  const x = at >> 8, y = withRomBank(P, BANK_MENU_LIB, () => applySpriteBobOffset(P, at & 0xFF)).e;
  queueSpriteTemplate(P, template0, x, y, tile, OAM_BANK1, sp);
  const de = ((x << 8 | y) + 0x17F8) & 0xFFFF;
  return queueSpriteTemplate(P, template1, de >> 8, de & 0xFF, 0x70, OAM_BANK1, sp);
}

// ---- loading a menu's graphics, a frame a step ----
const LoadCharMugshotToBuffer = [0x1B, 0x4E37], CopyMugshotBufferToVram = [0x1B, 0x4E46];
// label tile sets: entry i of the slot table `slots` decompressed into wDecompBuffer and queued (16 blocks) to the
// VRAM address of entry i of `dests`; a frame each
export function* loadLabelSets(P, slots, dests, count) {
  const { bus } = P;
  for (let i = 0; i < count; i++) {
    const slot = bus.u16(slots + 2 * i);
    decompressDataFromBank(P, slot >> 8, slot & 0xFF, wDecompBuffer);
    queueCopy(P, wDecompBuffer, bus.u16(dests + 2 * i), 16);
    yield* advanceFrame(P);
  }
}
// one label set from a slot ([bank, slot]) to dest, then a frame
export function* loadLabelSet(P, [bank, slot], dest) {
  decompressDataFromBank(P, bank, slot, wDecompBuffer);
  queueCopy(P, wDecompBuffer, dest, 16);
  yield* advanceFrame(P);
}
// the three story files' mugshots (characters from their summaries) to VRAM bank 1 $9680, $9710, $8F00; a frame each
const MUGSHOTS = [[0, cell(wShadowTilemap, 0, 24), vTiles2 + 0x68 * TILE_SIZE], [1, cell(wShadowTilemap, 16, 24), vTiles2 + 0x71 * TILE_SIZE],
  [2, cell(wShadowTilemap, 0, 25), vTiles1 + 0x70 * TILE_SIZE]];
export function* loadFileMugshots(P) {
  for (const [file, summary, dest] of MUGSHOTS) {
    wramBank(P, WRAM_SCREEN);
    P.V.currentStorySlot = file;
    callFar(P, LoadCharMugshotToBuffer, { a: P.bus.u8(summary) });
    callFar(P, CopyMugshotBufferToVram, { de: dest + VRAM_BANK1 });
    yield* advanceFrame(P);
  }
}
// tile blocks [block, tile] into VRAM bank 1 $8000 + tile * 16, a frame each; then the frame tiles (block `frame`)
// to $8000 (bank 0) and its frame, and the cursor palette (IndexedPalettes $10 as OBJ palette 0)
export function* loadPanelBlocks(P, blocks, frame) {
  for (const [block, tile] of blocks) {
    farLoadTileBlock(P, block, vTiles0 + tile * TILE_SIZE + VRAM_BANK1);
    yield* advanceFrame(P);
  }
  farLoadTileBlock(P, frame, vTiles0);
  yield* advanceFrame(P);
  withRomBank(P, BANK_MENU_LIB, () => loadIndexedPalette(P, 0x08, 0x10));
}
