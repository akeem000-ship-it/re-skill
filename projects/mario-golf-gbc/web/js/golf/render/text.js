// Numbers and glyphs drawn into tile buffers (bank 0): the buffers are columns of 8x16 sprite tiles (32 bytes per
// 8-pixel column, 2 bytes per pixel row), as the HUD's sprites show them.
import { rd, wr } from "./display.js";

// 00:21F0 FormatDecimalNumber: hl (signed) as text, right-aligned in a field of `width` (0: no padding), 0-ended;
// returns the bytes (the game writes them to a stack buffer)
export function formatDecimalNumber(hl, width) {
  let neg = 0;
  hl &= 0xFFFF;
  if (hl & 0x8000) { hl = (-hl) & 0xFFFF; neg = 1; }
  const dig = [];
  for (const p of [10000, 1000, 100, 10]) {      // 00:229E ExtractDecimalDigit (unsigned: the value is below $8000
    dig.push(Math.floor(hl / p)); hl %= p;       // after the negation, except $8000 itself)
  }
  dig.push(hl);
  const out = [];
  if (width) {
    let b = 5, i = 0;
    while (i < 5 && !dig[i]) { b--; i++; }
    if (!b) b = 1;
    let pad = width - b;
    if (pad > 0) {
      if (neg) pad--;
      for (; pad > 0; pad--) out.push(0x20);
    }
  }
  if (neg) out.push(0x2D);
  let i = 0;
  while (i < 4 && !dig[i]) i++;
  for (; i < 5; i++) out.push(0x30 + dig[i]);
  out.push(0);
  return out;
}

// 00:2962 RenderGlyphToTiles: hl = glyph (width, rows, then 2-bit pixels packed MSB first), into the tile buffer de
// from pixel column b, row c (each pixel set or cleared in both planes); temps wGlyphBlit $C280-$C283
export function renderGlyphToTiles(w, hl, de, b, c, read = a => rd(w, a)) {
  const w0 = w.wram[0];
  let mask = 0x80 >> (b & 7);
  w0[0x283] = mask;
  let dst = (de + ((b & 0xF8) << 2) + ((c << 1) & 0xFFFF)) & 0xFFFF;
  let src = hl;
  const width = read(src++);
  w0[0x282] = width;
  let rows = read(src++);
  w0[0x281] = rows;
  let bit = 0x80;
  for (;;) {
    let p = dst;
    mask = w0[0x283];
    w0[0x280] = width;
    for (;;) {
      const g = read(src);
      wr(w, p, g & bit ? rd(w, p) | mask : rd(w, p) & ~mask);
      bit = bit >> 1 | (bit & 1) << 7;
      const g2 = read(src);
      wr(w, p + 1, g2 & bit ? rd(w, p + 1) | mask : rd(w, p + 1) & ~mask);
      const carry = bit & 1;
      bit = bit >> 1 | (bit & 1) << 7;
      if (carry) src++;
      const mc = mask & 1;
      mask = mask >> 1 | mc << 7;
      if (mc) p = (p + 0x20) & 0xFFFF;
      w0[0x280] = (w0[0x280] - 1) & 0xFF;
      if (!w0[0x280]) break;
    }
    dst = (dst + 2) & 0xFFFF;
    rows = w0[0x281] = (w0[0x281] - 1) & 0xFF;
    if (!rows) break;
  }
}

const glyphPtr = ch => {                         // NumberFontGlyphPtrs 00:28DA
  const p = 0x28DA + (((ch - 0x30) & 0x1F) << 1);
  return rd(null, p) | rd(null, p + 1) << 8;
};

export function renderCharToTiles(w, ch, de, b, c) {   // 00:2917 RenderCharToTiles
  renderGlyphToTiles(w, glyphPtr(ch), de, b, c);
}

export function renderTextToTiles(w, text, de, b, c) {  // 00:2933 RenderTextToTiles: chars below '0' are 6 px
  for (const ch of text) {
    if (!ch) break;
    if (ch < 0x30) { b = (b + 6) & 0xFF; continue; }
    const g = glyphPtr(ch);
    renderGlyphToTiles(w, g, de, b, c);
    b = (b + rd(w, g)) & 0xFF;
  }
}

export function renderNumberToTiles(w, hl, width, de, b, c) {   // 00:28FA RenderNumberToTiles
  renderTextToTiles(w, formatDecimalNumber(hl, width), de, b, c);
}
