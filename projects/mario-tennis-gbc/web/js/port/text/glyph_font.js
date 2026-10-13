// Inline glyphs, the glyph stream's start at a cell, the row flush and the glyph uploads (bank $05,
// src/engine/text/glyph_font_05.asm; the font and its widths are data at $7920 / $7F80). Port of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses are its own.
// Covered by out/port/story1.mtrec, out/port/menus1.mtrec and web/tests/port/routines_text.mjs.
import {
  FLAG, WRAM_TEXT, WRAM_SOUND, vTiles1, rVBK, mapped, hook, setFlag, clearFlag, testFlag, advanceFrame, lcdOn,
  queueVRAMCopy, callHome, farcallWaiting, HOME, pushWramBank,
} from "./common.js";
import { drawGlyph, wGlyphTileBuffer } from "./rows.js";
import { clearGlyphBuffer, columnToPen } from "./glyph_buffer.js";

// DrawInlineGlyph (05:7681): rasterise the character at hl at the pen (an argument string's, a name's); a newline
// ($01) starts the next text row; $02/$03 draw nothing
export function drawInlineGlyph(P, text) {
  const R = mapped(P), oldBank = P.V.wramBank;
  const width = R.textRowWidth, col = R.textRowColumn;
  let pen = R.glyphPenX;
  const ch = P.bus.u8(text);
  if (ch === 0x01) {
    pen = columnToPen(col);
    R.textRowColumn = (col + width) & 0xFF;
    R.glyphRowStartCol = (col + width) & 0xFF;
  } else if (ch !== 0x02 && ch !== 0x03) {
    P.wramBank(WRAM_SOUND);
    pen = drawGlyph(P, ch, pen);
  }
  R.glyphPenX = pen;
  P.wramBank(oldBank);
}

// Unused_05_ResetGlyphPen_1 (05:76D1) / Unused_05_ResetGlyphPen_2 (05:76F5): the pen and row state ($C3B7-$C3BC)
// to 0 and the glyph buffer cleared. Nothing calls them.
export function resetGlyphPen(P) {
  const oldBank = P.V.wramBank;
  for (let a = 0xC3B7; a <= 0xC3BC; a++) P.bus.w8(a, 0);
  P.wramBank(WRAM_SOUND);
  clearGlyphBuffer(P);
  P.wramBank(oldBank);
}

// InitGlyphStreamAt (05:771B): start a glyph stream for proportional text `rowWidth` (c) cells wide at column
// wTextRowColumn — one cell further in, and one wider, for the menu window (unless FLAG_TEMP_WIDE_GLYPH_STREAM).
// The pen, the upload state and wTextRowNextTile are reset; wTextRowColumn moves on by the width.
export function initGlyphStreamAt(P, rowWidth) {
  const { bus } = P, R = mapped(P), oldBank = pushWramBank(P, WRAM_TEXT);
  for (const a of [0xC3B7, 0xC3B8, 0xC3B9, 0xC3BD, 0xC3BE, 0xC3BF]) bus.w8(a, 0);   // pen, row width, upload state
  R.textRowNextTile = 0;
  let col = R.textRowColumn, width = rowWidth, advance = rowWidth;
  if (R.windowId === R.menuWindowId && !testFlag(P, FLAG.TEMP_WIDE_GLYPH_STREAM)) {
    col = (col + 1) & 0xFF;
    advance = (rowWidth + 1) & 0xFF;
  }
  R.glyphRowStartCol = col;
  R.glyphFlushedCol = col;
  R.glyphPenX = columnToPen(col);
  R.textRowWidth = width;
  R.textRowColumn = (R.textRowColumn + advance) & 0xFF;
  P.wramBank(oldBank);
}

// SaveGlyphPenColumns (05:7774): outside the menu window, note the tiles drawn since the last flush for an upload
// (wGlyphUploadFirstTile, wGlyphUploadCount) and mark them flushed
export function saveGlyphPenColumns(P) {
  const R = mapped(P);
  if (R.menuWindowId === R.windowId) return;
  const start = R.glyphRowStartCol, flushed = R.glyphFlushedCol;
  R.glyphUploadCount = (start - flushed) & 0xFF;
  R.glyphUploadFirstTile = flushed;
  R.glyphFlushedCol = start;
}

// UploadGlyphBuffer (05:7792): the glyph tiles drawn so far to VRAM: queued over frames with the LCD on, by DMA now
// with it off
export function* uploadGlyphBuffer(P) {
  if (lcdOn(P)) yield* uploadGlyphBufferQueued(P);
  else uploadGlyphBufferDMA(P);
}

// FlushGlyphRow (05:77A3): the end of a text row or of the text: upload the glyph tiles (not for the dialogue
// window at NORMAL/SLOW speed: UploadLastGlyphTiles has kept up), then the next row starts at wTextRowColumn.
// Leaves hl = wTextRowColumn.
export function* flushGlyphRow(P) {
  const R = mapped(P);
  const speed = R.messageSpeed;
  const typedLive = R.dialogueWindowId === R.glyphWindowId && !(speed & 0x80) && (speed & 0x7F);
  if (!typedLive) {
    if (lcdOn(P)) yield* uploadGlyphBufferQueued(P);
    else uploadGlyphBufferDMA(P);
  }
  const width = R.textRowWidth, col = R.textRowColumn;
  R.glyphFlushedCol = R.glyphRowStartCol;
  R.textRowColumn = (col + width) & 0xFF;
  R.glyphRowStartCol = (col + width) & 0xFF;
  return { hl: 0xC3BA };
}

// UploadGlyphBufferQueued (05:77DD): the tiles up to wGlyphRowStartCol (at most $80, $60 while wKeepMatchStatsFlag)
// to $8800 (bank 1 when wWindowTileAttr selects it) in 18-tile pieces, one per frame — a match frame
// (StepMatchFrame, bank 8) instead of a plain one during a link session. FLAG_VRAM_UPDATE_BUSY is held throughout.
export function* uploadGlyphBufferQueued(P) {
  const R = mapped(P), oldBank = P.V.wramBank;
  setFlag(P, FLAG.VRAM_UPDATE_BUSY);
  P.wramBank(WRAM_SOUND);
  const limit = R.keepMatchStatsFlag ? 0x60 : 0x80;
  let tiles = (R.glyphRowStartCol + 1) & 0xFF;
  if (tiles >= limit) tiles = limit;
  let pieces = 0;
  do { pieces++; tiles -= 0x12; } while (tiles >= 0);
  let dest = vTiles1;
  const b5 = pushWramBank(P, WRAM_TEXT);
  if (R.windowTileAttr & 0x08) dest += 0x2000;
  P.wramBank(b5);
  let src = wGlyphTileBuffer;
  for (; pieces > 0; pieces--) {
    queueVRAMCopy(P, src, dest, 0x12);
    src = (src + 0x120) & 0xFFFF; dest = (dest + 0x120) & 0xFFFF;
    if (R.linkSessionActive) yield* farcallWaiting(P, 0x08, 0x3E);        // farcall StepMatchFrame (08:4465)
    else yield* advanceFrame(P);
  }
  clearFlag(P, FLAG.VRAM_UPDATE_BUSY);
  P.wramBank(oldBank);
}

// UploadGlyphBufferDMA (05:7866): with the LCD off, the tiles up to wGlyphRowStartCol to $8800 (VRAM bank 0) by
// DMA, 32 tiles at a time
export function uploadGlyphBufferDMA(P) {
  const R = mapped(P), oldBank = P.V.wramBank;
  let tiles = (R.glyphRowStartCol + 1) & 0xFF;
  P.wramBank(WRAM_SOUND);
  let pieces = 0;
  do { pieces++; tiles -= 0x20; } while (tiles > 0);
  let src = wGlyphTileBuffer, dest = vTiles1;
  for (; pieces > 0; pieces--) {
    P.bus.w8(rVBK, 0);
    callHome(P, HOME.StartVRAMDMAFromHL, { h: src >> 8, l: src & 0xFF, d: dest >> 8, e: dest & 0xFF, c: 0x20 });
    src = (src + 0x200) & 0xFFFF; dest = (dest + 0x200) & 0xFFFF;
  }
  P.wramBank(oldBank);
}

// Unused_05_UploadGlyphTileRange (05:78AD): wGlyphUploadCount tiles (at most 32) from wGlyphUploadFirstTile to
// VRAM (bank 1 when wGlyphUploadVramBank). Returns the a QueueVRAMCopy leaves. Nothing calls it.
export function uploadGlyphTileRange(P) {
  const R = mapped(P), oldBank = pushWramBank(P, WRAM_SOUND);
  const offset = (R.glyphUploadFirstTile * 16) & 0xFFFF;
  let dest = (vTiles1 + offset) & 0xFFFF;
  if (R.glyphUploadVramBank) dest = (dest + 0x2000) & 0xFFFF;
  const count = Math.min(R.glyphUploadCount, 0x20);
  const a = queueVRAMCopy(P, (wGlyphTileBuffer + offset) & 0xFFFF, dest, count, { b: offset >> 8 }).a;
  P.wramBank(oldBank);
  return a;
}

// Unused_05_DrawGlyphString (05:78F3): rasterise the $00-terminated string at hl from pen ((d & $0F) << 8 | e) << 3.
// Nothing calls it.
export function drawGlyphString(P, text, cell) {
  let pen = ((cell & 0x0FFF) << 3) & 0xFFFF, p = text;
  for (let ch; (ch = P.bus.u8(p)) !== 0; p = (p + 1) & 0xFFFF) pen = drawGlyph(P, ch, pen);
}

export const HOOKS = [
  hook(5, 0x7681, (P, r) => { drawInlineGlyph(P, r.hl); }),
  hook(5, 0x76D1, P => { resetGlyphPen(P); }),
  hook(5, 0x76F5, P => { resetGlyphPen(P); }),
  hook(5, 0x771B, (P, r) => { initGlyphStreamAt(P, r.c); }),
  hook(5, 0x7774, P => { saveGlyphPenColumns(P); }),
  hook(5, 0x7792, P => uploadGlyphBuffer(P)),
  hook(5, 0x77A3, P => flushGlyphRow(P)),
  hook(5, 0x77DD, P => uploadGlyphBufferQueued(P)),
  hook(5, 0x7866, P => { uploadGlyphBufferDMA(P); }),
  hook(5, 0x78AD, P => ({ a: uploadGlyphTileRange(P) })),
  hook(5, 0x78F3, (P, r) => { drawGlyphString(P, r.hl, r.de); }),
];
