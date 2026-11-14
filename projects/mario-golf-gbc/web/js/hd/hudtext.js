// The golf HUD's labels and numbers as text: the HUD (bank 12, render/hud.js) draws its digits and labels into WRAM buffers of
// 8 x 16 tile columns with RenderGlyphToTiles 00:2962 and copies them to VRAM (sprite tiles, and the window's shot panel). That
// routine tells this tracker every glyph it draws (setHudGlyphHook, reading only): which glyph, at which pixel of which buffer. Each
// 8 x 8 tile of the buffer is followed by its content (16 bytes) as with the text font (hdtext.js): a sprite or window cell whose tile
// shows exactly such content holds those glyphs, so what the art draws is what the screen shows, whatever the HUD blinks or hides.
// The glyphs are named here by their place in the ROM (bank 12's label glyphs, read from the screen as words; the digits through
// the table NumberFontGlyphPtrs 00:28DA, read at run time): names only, no picture of them.
import { setHudGlyphHook } from "../golf/render/text.js";
import { rd } from "../golf/render/display.js";

// bank 12's label glyphs (their ROM address -> the word they show); "~meter" is the power meter's scale
const LABELS = { 0x687A: "H", 0x6859: "Y", 0x6885: "PAR", 0x68CA: "MPH", 0x68A3: "REST", 0x6872: ".", 0x6864: "FT", 0x6997: "W",
  0x6951: "I", 0x696B: "P", 0x6979: "S", 0x6987: "T", 0x695D: "N", 0x6943: "A", 0x69B5: "M", 0x69A7: "L", 0x66B8: "~meter" };
const content = new Map();
const BLANK = "\0".repeat(16);
content.set(BLANK, []);
let digits = null, pending = null;
const keyAt = (w, a) => { let k = ""; for (let i = 0; i < 16; i++) k += String.fromCharCode(rd(w, (a + i) & 0xFFFF)); return k; };
function nameOf(w, hl) {
  if (!digits) { digits = new Map(); for (let ch = 0x30; ch <= 0x39; ch++) { const p = 0x28DA + ((ch - 0x30) << 1); digits.set(rd(w, p) | rd(w, p + 1) << 8, String.fromCharCode(ch)); } }
  if (hl < 0x4000) return digits.get(hl) ?? null;
  return w.high[0x195] === 0x12 ? LABELS[hl] ?? null : null;
}
// the 8 x 8 tiles a glyph box covers: [{a: buffer address of the tile, x0, y0: the tile's place in the buffer's pixels}]
function tilesOf(de, b, c, gw, gh) {
  const out = [];
  for (let k = b >> 3; k <= (b + gw - 1) >> 3; k++) for (let hh = c >> 3; hh <= (c + gh - 1) >> 3 && hh < 2; hh++)
    out.push({ a: (de + k * 32 + hh * 16) & 0xFFFF, x0: k * 8, y0: hh * 8 });
  return out;
}
const hook = {
  pre(w, hl, de, b, c, read) {
    const gw = read(hl), gh = read((hl + 1) & 0xFFFF);
    pending = { gw, gh, tiles: tilesOf(de, b & 0xFF, c & 0xFF, gw, gh) };
    for (const t of pending.tiles) { t.k = keyAt(w, t.a); t.pre = content.has(t.k) ? content.get(t.k) : null; }
  },
  post(w, hl, de, b, c) {
    if (!pending) return;
    const { gw, gh, tiles } = pending, name = nameOf(w, hl); pending = null;
    for (const t of tiles) {
      const k = keyAt(w, t.a); if (k === t.k || k === BLANK) continue;
      if (t.pre === null || name === null) { content.delete(k); continue; }
      const x = b - t.x0, y = c - t.y0;       // the glyph's box in the tile's pixels
      const keep = t.pre.filter(([, ix, iy, iw, ih]) => ix + iw <= x || ix >= x + gw || iy + ih <= y || iy >= y + gh);
      if (content.size > 20000) { content.clear(); content.set(BLANK, []); }
      content.set(k, [...keep, [name, x, y, gw, gh]]);
    }
  },
};
setHudGlyphHook(hook);
// the glyphs ([name, x, y, w, h] in the tile's pixels) the tile of 16 bytes at bytes[o] holds; undefined: not a HUD tile followed
export function hudGlyphs(bytes, o) { let k = ""; for (let i = 0; i < 16; i++) k += String.fromCharCode(bytes[o + i]); return content.get(k); }
