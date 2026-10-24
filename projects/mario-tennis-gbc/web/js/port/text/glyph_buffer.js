// The glyph tile buffer: plotting font rows into it, clearing it, uploading it to VRAM, and the glyph stream that
// walks a window's text (bank $05, src/engine/text/glyph_buffer_05.asm). Port of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses are its own.
//
// Text is rasterised at run time into wGlyphTileBuffer ($D300, 2048 bytes = 128 tiles, WRAM bank 7) and uploaded to
// the tiles at $8800 (ids $80-$FF). The pen, wGlyphPenX, counts $80 per 8-pixel cell; its low 3 bits are the pixel
// within a byte. A window's glyph rows hold consecutive tile ids, so the pen's cell is also the tile id - $80.
// Covered by out/port/story1.mtrec (dialogue) and web/tests/port/routines_text.mjs.
import {
  FLAG, WRAM_TEXT, WRAM_SOUND, vTiles1, mapped, hook, setFlag, clearFlag, testFlag, advanceFrame, lcdOn,
  queueVRAMCopy, copyMemoryFast, callHome, HOME, pushWramBank, Z,
} from "./common.js";
import { getWindowStructPtr } from "./window_alloc.js";
import { drawGlyph, FontGlyphs, wGlyphTileBuffer } from "./rows.js";

// a character column as a pen position: column * $80 (the ROM's ld d, c / ld e, 0 / sra d / rr e)
export const columnToPen = col => ((col << 24 >> 24) * 0x80) & 0xFFFF;
// the column of a pen position: its high byte after one shift left (sla e / rl d)
export const penToColumn = pen => (pen >> 7) & 0xFF;

// PlotGlyphRow (05:737A): OR one font byte (one bitplane row) into the buffer at byte pen >> 3, shifted right by
// the pen's pixel (pen & 7): the left part into this tile, the rest into the same byte of the next tile (+16).
// Returns the a and flags it leaves (the second byte written).
export function plotGlyphRow(P, font, pen) {
  const { bus } = P, shift = pen & 7;
  const right = font >> shift, keepLeft = (0xFF << (8 - shift)) & 0xFF;
  const spill = (font << (8 - shift)) & 0xFF, keepRight = 0xFF >> shift;
  const p = (wGlyphTileBuffer + ((pen << 16 >> 16) >> 3)) & 0xFFFF;
  bus.w8(p, (bus.u8(p) & keepLeft) | right);
  const q = (p + 16) & 0xFFFF, a = (bus.u8(q) & keepRight) | spill;
  bus.w8(q, a);
  return { a, f: a ? 0 : Z };
}

// ClearGlyphBuffer (05:73CB): all 128 tiles of the buffer (mapped WRAM bank, 7) to the font's first glyph (space)
export function clearGlyphBuffer(P) {
  let de = wGlyphTileBuffer;
  for (let n = 0; n < 0x80; n++) de = copyMemoryFast(P, FontGlyphs, de, 1).de;
}

// ClearWindowGlyphTiles (05:73E4): blank the glyph tiles the glyph window's text rows use, from tile
// wGlyphRowStartCol on: (width - 2) * ((height - 2) / 2 + 1) tiles (the count kept to 8 bits). Leaves WRAM bank 7.
export function clearWindowGlyphTiles(P) {
  const { bus } = P, R = mapped(P);
  P.wramBank(WRAM_TEXT);
  const s = getWindowStructPtr(R.glyphWindowId);
  const perRow = (bus.u8(s + 2) - 2) & 0xFF;
  const rows = ((((bus.u8(s + 3) - 2) << 24 >> 24) >> 1) + 1) & 0xFF;
  const tiles = callHome(P, HOME.MulHLByA, { h: 0, l: rows, a: perRow }).l;       // MulHLByA (home)
  let de = (wGlyphTileBuffer + R.glyphRowStartCol * 16) & 0xFFFF;
  P.wramBank(WRAM_SOUND);
  for (let n = tiles || 256; n > 0; n--) de = copyMemoryFast(P, FontGlyphs, de, 1).de;
}

// UploadGlyphBufferFull (05:742C): the first 80 tiles of the buffer to $8800 (VRAM bank 1 when wWindowTileAttr
// selects it), 16 at a time, a frame between pages while the LCD is on (the last page 7 tiles under
// FLAG_DEBUG_SHORT_GLYPH_UPLOAD). FLAG_VRAM_UPDATE_BUSY is held throughout.
export function* uploadGlyphBufferFull(P) {
  const R = mapped(P), oldBank = P.V.wramBank;
  setFlag(P, FLAG.VRAM_UPDATE_BUSY);
  if (lcdOn(P)) yield* advanceFrame(P);
  P.wramBank(WRAM_TEXT);
  const base = R.windowTileAttr & 0x08 ? vTiles1 + 0x40 * 16 + 0x2000 : vTiles1 + 0x40 * 16;
  P.wramBank(WRAM_SOUND);
  for (let page = 0; page < 5; page++) {
    const blocks = page < 4 ? 16 : testFlag(P, FLAG.DEBUG_SHORT_GLYPH_UPLOAD) ? 7 : 16;
    queueVRAMCopy(P, wGlyphTileBuffer + page * 0x100, base - 0x400 + page * 0x100, blocks);
    if (lcdOn(P)) yield* advanceFrame(P);
  }
  clearFlag(P, FLAG.VRAM_UPDATE_BUSY);
  P.wramBank(oldBank);
}

// Unused_05_DrawWindowGlyphRun (05:74DE): rasterise the string at hl into a cleared buffer, a line ($01) per
// glyph-window text row, up to $02 or $03 (a $00 is drawn on). Nothing calls it.
export function drawWindowGlyphRun(P, text) {
  const { bus } = P, R = mapped(P), oldBank = P.V.wramBank;
  P.wramBank(WRAM_TEXT);
  const width = (bus.u8(getWindowStructPtr(R.glyphWindowId) + 2) - 2) & 0xFF;
  P.wramBank(WRAM_SOUND);
  clearGlyphBuffer(P);
  let pen = 0, col = width, p = text;
  for (;;) {
    const ch = bus.u8(p); p = (p + 1) & 0xFFFF;
    if (ch === 0x02 || ch === 0x03) break;
    if (ch === 0x01) { pen = columnToPen(col); col = (col + width) & 0xFF; continue; }
    pen = drawGlyph(P, ch, pen);
  }
  P.wramBank(oldBank);
}

// InitGlyphStreamForWindow (05:752D): start the glyph stream on the glyph window (wGlyphWindowId): the pen at
// column wGlyphRowStartCol (0 for window 0), wTextRowWidth = the window's width - 2, wTextRowColumn = the column of
// the next row; then blank the window's glyph tiles
export function initGlyphStreamForWindow(P) {
  const R = mapped(P), oldBank = pushWramBank(P, WRAM_TEXT);
  R.glyphPenX = R.glyphWindowId ? columnToPen(R.glyphRowStartCol) : 0;
  const width = (P.bus.u8(getWindowStructPtr(R.glyphWindowId) + 2) - 2) & 0xFF;
  R.textRowWidth = width;
  R.textRowColumn = R.glyphWindowId ? (R.glyphRowStartCol + width) & 0xFF : width;
  clearWindowGlyphTiles(P);
  P.wramBank(oldBank);
}

// DrawStreamGlyph (05:757E): rasterise the stream's current character (at wTextStreamPtr) at the pen; a newline
// ($01) moves the pen to the next text row's column; $02/$03 draw nothing. wGlyphRowStartCol follows the pen.
export function drawStreamGlyph(P) {
  const R = mapped(P), oldBank = pushWramBank(P, WRAM_TEXT);
  const width = R.textRowWidth, col = R.textRowColumn;
  let pen = R.glyphPenX;
  const ch = P.bus.u8(R.textStreamPtr);
  if (ch === 0x01) {
    pen = columnToPen(col);
    R.textRowColumn = (col + width) & 0xFF;
  } else if (ch !== 0x02 && ch !== 0x03) {
    P.wramBank(WRAM_SOUND);
    pen = drawGlyph(P, ch, pen);
  }
  R.glyphPenX = pen;
  R.glyphRowStartCol = penToColumn(pen);
  P.wramBank(oldBank);
}

// StartGlyphStreamRow (05:75DB): the pen to the next text row (wTextRowColumn), which advances by a row width
export function startGlyphStreamRow(P) {
  const R = mapped(P), width = R.textRowWidth, col = R.textRowColumn;
  const pen = columnToPen(col);
  R.textRowColumn = (col + width) & 0xFF;
  R.glyphPenX = pen;
  R.glyphRowStartCol = penToColumn(pen);
  R.glyphFlushedCol = penToColumn(pen);
}

// UploadLastGlyphTiles (05:7607): as the dialogue window types, upload the 2 tiles at the pen (from the one before
// the pen's cell) — only for the dialogue window's own stream and at NORMAL/SLOW message speed (FAST and the
// "instant" bit 7 leave it to the row flush), and below tile $7F ($5F while wKeepMatchStatsFlag)
export function uploadLastGlyphTiles(P) {
  const R = mapped(P);
  if (R.windowId !== R.glyphWindowId || R.dialogueWindowId !== R.windowId) return;
  const speed = R.messageSpeed;
  if (speed & 0x80 || !(speed & 0x7F)) return;
  const oldBank = pushWramBank(P, WRAM_SOUND);
  const limit = R.keepMatchStatsFlag ? 0x5F : 0x7F;
  if (R.glyphRowStartCol < limit) {
    let tile = (R.glyphPenX >> 7) & 0x1FF;
    if (tile) tile--;
    const offset = (tile * 16) & 0xFFFF;
    queueVRAMCopy(P, (wGlyphTileBuffer + offset) & 0xFFFF, (vTiles1 + offset) & 0xFFFF, 2);
  }
  P.wramBank(oldBank);
}

export const HOOKS = [
  hook(5, 0x737A, (P, r) => plotGlyphRow(P, r.a, r.de)),
  hook(5, 0x73CB, P => { clearGlyphBuffer(P); }),
  hook(5, 0x73E4, P => { clearWindowGlyphTiles(P); }),
  hook(5, 0x742C, P => uploadGlyphBufferFull(P)),
  hook(5, 0x74DE, (P, r) => { drawWindowGlyphRun(P, r.hl); }),
  hook(5, 0x752D, P => { initGlyphStreamForWindow(P); }),
  hook(5, 0x757E, P => { drawStreamGlyph(P); }),
  hook(5, 0x75DB, P => { startGlyphStreamRow(P); }),
  hook(5, 0x7607, P => { uploadLastGlyphTiles(P); }),
];
