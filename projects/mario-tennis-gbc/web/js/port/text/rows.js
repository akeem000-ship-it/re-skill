// Dirty tilemap rows and their flush to VRAM, window redraw and close, the menu window's text, the glyph buffer
// reset and the glyph rasteriser (bank $05, src/engine/text/rows_05.asm). Port of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses are its own.
//
// Window -> VRAM: a redraw marks the rows a window covers in wTilemapRowDirty ($DC40, one flag per map row; a
// replace, not an accumulate), folds them into (first row, count) runs of at most 7 rows in wTilemapRowRuns
// ($DC60, $FF-terminated) and copies each run, tiles then attributes, from the shadow map (wShadowTilemapPtr in WRAM
// bank wShadowTilemapBank) to $9800 — one run per frame while the LCD is on (FlushDirtyRowsPerFrame), or all at once
// and one frame after (FlushDirtyRowsNow).
// Covered by out/port/story1.mtrec, out/port/debug1.mtrec, out/engine/rec2.mtrec and web/tests/port/routines_text.mjs.
import {
  FLAG, WRAM_TEXT, WRAM_SOUND, vBGMap0, VRAM_BANK1, mapped, hook, setFlag, clearFlag, advanceFrame, lcdOn, queueVRAMCopy, pushWramBank, addFlags, Z, N, lo,
} from "./common.js";
import { getWindowStructPtr, drawTextWindowFrame, freeWindow } from "./window_alloc.js";
import { restoreTilemapUnderWindow } from "./shadow.js";
import { resetWindowState } from "./window_create.js";
import { renderProportionalTextAt } from "./proportional.js";
import { clearGlyphBuffer, plotGlyphRow } from "./glyph_buffer.js";
import { uploadGlyphBuffer } from "./glyph_font.js";

const wTilemapRowDirty = 0xDC40, wTilemapRowRuns = 0xDC60;
export const FontGlyphs = 0x7920, GlyphWidths_05 = 0x7F80, wGlyphTileBuffer = 0xD300;

// MarkTilemapRowsDirty (05:7086): rows d (mod 32) .. d + e - 1 dirty, all others clean
export function markTilemapRowsDirty(P, first, count) { setRowDirtyFlags(P, first & 0x1F, count); }
// MarkWindowRowsDirty (05:7096): the rows window `id` covers
export function markWindowRowsDirty(P, id) { const s = getWindowStructPtr(id); setRowDirtyFlags(P, P.bus.u8(s + 1), P.bus.u8(s + 3)); }
// SetRowDirtyFlags (05:70AA): clear the 32 flags, then mark `count` rows from `first`, wrapping at 32 (0 marks 256).
// Returns the registers it leaves.
export function setRowDirtyFlags(P, first, count) {
  const { bus } = P;
  for (let i = 0; i < 32; i++) bus.w8(wTilemapRowDirty + i, 0);
  let row = first & 0x1F, hl = wTilemapRowDirty + row;
  for (let n = count & 0xFF || 256; n > 0; n--) {
    bus.w8(hl++, 1);
    if (++row & 0x20) { row &= ~0x20; hl = wTilemapRowDirty; }
  }
  return { a: 1, f: Z | N, c: 0, d: row & 0xFF, e: 0, hl };
}
// MarkWindowRowsDirtyMin7 (05:70D1): as MarkWindowRowsDirty, but a window shorter than 7 rows marks the 7 rows
// centred on it (the speech bubble grows into them)
export function markWindowRowsDirtyMin7(P, id) {
  const s = getWindowStructPtr(id);
  let row = P.bus.u8(s + 1), count = P.bus.u8(s + 3);
  if (count < 7) { row = (row - ((7 - count) >> 1)) & 0x1F; count = 7; }
  setRowDirtyFlags(P, row, count);
}

// FlushDirtyRowsPerFrame (05:711A): copy the dirty runs to VRAM, one frame per run while the LCD is on.
// FLAG_VRAM_UPDATE_BUSY is held throughout.
export function* flushDirtyRowsPerFrame(P) {
  buildDirtyRowRuns(P);
  setFlag(P, FLAG.VRAM_UPDATE_BUSY);
  for (let p = wTilemapRowRuns; P.bus.u8(p) !== 0xFF; p += 2) {
    copyDirtyRowSpanToVRAM(P, P.bus.u8(p), P.bus.u8(p + 1));
    if (lcdOn(P)) yield* advanceFrame(P);
  }
  clearFlag(P, FLAG.VRAM_UPDATE_BUSY);
}
// FlushDirtyRowsNow (05:7148): all the runs at once, then one frame while the LCD is on
export function* flushDirtyRowsNow(P) {
  buildDirtyRowRuns(P);
  setFlag(P, FLAG.VRAM_UPDATE_BUSY);
  for (let p = wTilemapRowRuns; P.bus.u8(p) !== 0xFF; p += 2) copyDirtyRowSpanToVRAM(P, P.bus.u8(p), P.bus.u8(p + 1));
  clearFlag(P, FLAG.VRAM_UPDATE_BUSY);
  if (lcdOn(P)) yield* advanceFrame(P);
}
// CopyDirtyRowSpanToVRAM (05:7176): `count` map rows from `first`: tiles to $9800, attributes (+$400) to $9800 in
// VRAM bank 1, read in WRAM bank wShadowTilemapBank (put back after)
export function copyDirtyRowSpanToVRAM(P, first, count) {
  const R = mapped(P), offset = first * 32;
  const src = (R.shadowTilemapPtr + offset) & 0xFFFF, dest = vBGMap0 + offset, blocks = (count * 2) & 0xFF;
  const old = pushWramBank(P, R.shadowTilemapBank);
  queueVRAMCopy(P, src, dest, blocks);
  queueVRAMCopy(P, (src + 0x400) & 0xFFFF, (dest + VRAM_BANK1) & 0xFFFF, blocks);
  P.wramBank(old);
}
// BuildDirtyRowRuns (05:71C4): wTilemapRowDirty -> (first, count) pairs of at most 7 rows, then $FF. Returns the
// registers it leaves.
export function buildDirtyRowRuns(P, entryB = 0) {
  const { bus } = P;
  let row = 0, out = wTilemapRowRuns, b = entryB;
  while (row < 32) {
    if (!bus.u8(wTilemapRowDirty + row)) { row++; continue; }
    bus.w8(out++, row);
    b = 0;
    while (row < 32 && bus.u8(wTilemapRowDirty + row)) { row++; b++; if (b >= 7) break; }
    bus.w8(out++, b);
  }
  bus.w8(out, 0xFF);
  return { a: 0x20, f: Z | N, b, c: 0x20, de: out, hl: out };
}

// RedrawWindowRows (05:7205): mark the window's rows and flush them, a run per frame
export function* redrawWindowRows(P, id) { markWindowRowsDirty(P, id); yield* flushDirtyRowsPerFrame(P); }
// RedrawWindowRowsPadded (05:7214): at least 7 rows round the window, flushed at once
export function* redrawWindowRowsPadded(P, id) { markWindowRowsDirtyMin7(P, id); yield* flushDirtyRowsNow(P); }
// RedrawTilemapRowRange (05:7223): map rows first .. first + count - 1
export function* redrawTilemapRowRange(P, first, count) { markTilemapRowsDirty(P, first, count); yield* flushDirtyRowsPerFrame(P); }
// RedrawAllTilemapRows (05:72D2): all 32 rows
export function* redrawAllTilemapRows(P) { yield* redrawTilemapRowRange(P, 0, 0x20); }

// RenderMenuWindowText (05:7232): draw the menu window (wMenuWindowId) with its glyph rows, render its text id
// proportionally from cell (column + 2, row + 1), upload the glyph tiles and redraw the window. A menu window with
// id 0 first prepares the glyph buffer.
export function* renderMenuWindowText(P) {
  const R = mapped(P);
  if (R.menuWindowId === 0) prepareGlyphBuffer(P);
  setFlag(P, FLAG.TEXT_RENDER_ACTIVE);
  drawTextWindowFrame(P, R.menuWindowId);
  clearFlag(P, FLAG.TEXT_RENDER_ACTIVE);
  const s = getWindowStructPtr(R.menuWindowId);
  const col = (P.bus.u8(s) + 2) & 0x1F, row = (P.bus.u8(s + 1) + 1) & 0x1F;
  const textId = P.bus.u16(s + 6);
  const cell = (R.shadowTilemapPtr + row * 32 + col) & 0xFFFF;
  const old = pushWramBank(P, WRAM_TEXT);
  const menuId = R.menuWindowId;
  P.wramBank(R.shadowTilemapBank);
  const textWidth = (P.bus.u8(getWindowStructPtr(menuId) + 2) - 2) & 0xFF;
  yield* renderProportionalTextAt(P, textId, cell, textWidth);
  yield* uploadGlyphBuffer(P);
  P.wramBank(old);
  yield* redrawWindowRows(P, R.menuWindowId);
}

// CloseWindow (05:72BD): put the scenery back under the window, redraw its rows, mark it not drawn and free it
export function* closeWindow(P, id) {
  restoreTilemapUnderWindow(P, id);
  yield* redrawWindowRows(P, id);
  resetWindowState(P, id);
  freeWindow(P, id);
}

// PrepareGlyphBuffer (05:72DC): unless the buffer is held (wGlyphBufferHoldCount), clear the glyph tiles
// (WRAM bank 7) and the pen; when held, the next row starts where the last one ended
export function prepareGlyphBuffer(P) {
  const old = pushWramBank(P, WRAM_TEXT), R = mapped(P);
  if (R.glyphBufferHoldCount === 0) {
    P.wramBank(WRAM_SOUND);
    clearGlyphBuffer(P);
    resetGlyphStream(P);
  } else {
    R.glyphFlushedCol = R.glyphRowStartCol;
  }
  P.wramBank(old);
}
// ResetGlyphStream (05:730D): the pen and row state ($C3B7-$C3BF) and wTextRowNextTile to 0
export function resetGlyphStream(P) {
  for (let a = 0xC3B7; a <= 0xC3BF; a++) P.bus.w8(a, 0);
  mapped(P).textRowNextTile = 0;
}

// DrawGlyph (05:7322): rasterise character `ch` at pen position `pen` (wGlyphPenX units: $80 per 8-pixel cell,
// the low 3 bits the pixel within the byte) into wGlyphTileBuffer (mapped WRAM bank, 7 in practice), each of its
// 16 font bytes shifted into two neighbouring tiles; returns the pen advanced by the glyph's width
export function drawGlyph(P, ch, pen) {
  const index = (ch - 0x20) & 0xFF;
  let src = FontGlyphs + index * 16, de = pen;
  for (let row = 0; row < 16; row++) {
    plotGlyphRow(P, P.bus.u8(src++), de);
    de = (de + 8) & 0xFFFF;
  }
  const width = getGlyphWidthByIndex(P, index).c;
  const x = (pen & 7) + width;
  let out = pen;
  if (x & 8) out = (out + 0x80) & 0xFFFF;                     // crossed into the next cell
  return (out & 0xFFF8) | (x & 7);
}
// GetGlyphWidth (05:7366): the width in pixels of character `ch` (c)
export function getGlyphWidth(P, ch) { return getGlyphWidthByIndex(P, (ch - 0x20) & 0xFF).c; }
// GetGlyphWidthByIndex (05:7370): c = GlyphWidths_05[index] (read as mapped: indexes past the table read on).
// Returns the registers it leaves.
export function getGlyphWidthByIndex(P, index) {
  const hl = GlyphWidths_05 + index, l = hl & 0xFF;
  const f = addFlags(index, lo(GlyphWidths_05));
  return { c: P.bus.u8(hl), hl, a: l, f: f & 0x10 ? 0x10 | 0x20 : f };   // a carry goes through inc h (Z clear, H set)
}

export const HOOKS = [
  hook(5, 0x7086, (P, r) => { markTilemapRowsDirty(P, r.d, r.e); }),
  hook(5, 0x7096, (P, r) => { markWindowRowsDirty(P, r.a); }),
  hook(5, 0x70AA, (P, r) => setRowDirtyFlags(P, r.d, r.e)),
  hook(5, 0x70D1, (P, r) => { markWindowRowsDirtyMin7(P, r.a); }),
  hook(5, 0x711A, P => flushDirtyRowsPerFrame(P)),
  hook(5, 0x7148, P => flushDirtyRowsNow(P)),
  hook(5, 0x7176, (P, r) => { copyDirtyRowSpanToVRAM(P, r.c, r.b); }),
  hook(5, 0x71C4, (P, r) => buildDirtyRowRuns(P, r.b)),
  hook(5, 0x7205, (P, r) => redrawWindowRows(P, r.a)),
  hook(5, 0x7214, (P, r) => redrawWindowRowsPadded(P, r.a)),
  hook(5, 0x7223, (P, r) => redrawTilemapRowRange(P, r.d, r.e)),
  hook(5, 0x7232, P => renderMenuWindowText(P)),
  hook(5, 0x72BD, (P, r) => closeWindow(P, r.a)),
  hook(5, 0x72D2, P => redrawAllTilemapRows(P)),
  hook(5, 0x72DC, P => { prepareGlyphBuffer(P); }),
  hook(5, 0x730D, P => { resetGlyphStream(P); }),
  hook(5, 0x7322, (P, r) => ({ de: drawGlyph(P, r.a, r.de) })),
  hook(5, 0x7366, (P, r) => ({ c: getGlyphWidth(P, r.a) })),
  hook(5, 0x7370, (P, r) => getGlyphWidthByIndex(P, r.a)),
];
