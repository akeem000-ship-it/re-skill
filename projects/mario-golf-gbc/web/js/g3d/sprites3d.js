// The sprites the 3D view stands up as bodies, read from the user's ROM at run time: the golfer's big frames (the view behind the
// golfer: the per-golfer tile list 11:6EEF, 16 tiles a frame, and the frame's sprite template 11:6F0F, as js/golf/render/golfer.js
// draws them), in the palette the game shows them in (the live OBJ palette RAM, read only). Nothing is written to the game.
import { rb, lzDecompress, offset } from "../golf/rom.js";

const B = 0x11;
const r16 = (b, a) => rb(b, a) | rb(b, (a + 1) & 0xFFFF) << 8;
const listEntry = (bank, idx, n) => { const list = r16(bank, 0x4000 + idx); return r16(bank, (list + 2 * n) & 0xFFFF); };

// the 16 tiles (256 bytes) of frame f of golfer g (raw, as 00:06F1 copies them)
function frameTiles(g, f) {
  const hl = r16(B, 0x6EEF + 2 * g), bank = hl >> 8, src = listEntry(bank, hl & 0xFF, f);
  const out = new Uint8Array(256);
  for (let i = 0; i < 256; i++) out[i] = rb(bank, (src + i) & 0xFFFF);
  return out;
}
// the frame's sprite template: [dy, dx, tile, attr] ... until dy = $80
function frameTemplate(g, f) {
  const t = r16(B, (r16(B, 0x6F0F + 2 * g) + 2 * f) & 0xFFFF), out = [];
  for (let p = t, n = 0; n < 40; n++, p += 4) {
    const dy = rb(B, p); if (dy === 0x80) break;
    out.push([dy << 24 >> 24, rb(B, p + 1) << 24 >> 24, rb(B, p + 2), rb(B, p + 3)]);
  }
  return out;
}

// the golfer's frame as an RGBA picture: { rgba, w, h, x0, y0 } where (x0, y0) is the picture's top-left on the game's screen
// (the template is placed at OAM (x $50, y $7C), so screen x = $48 + dx, y = $6C + dy); 8x16 sprites; pal = OBJ palette RAM,
// palette n = (attr | $0C) & 7 (player 2: | 1); flipped for a left-handed golfer
export function golferFrame(g, f, pal, player = 0, lefty = false) {
  const tiles = frameTiles(g, f), tmpl = frameTemplate(g, f);
  if (!tmpl.length) return null;
  let xa = 1e9, ya = 1e9, xb = -1e9, yb = -1e9;
  const spr = tmpl.map(([dy, dx, t, a]) => {
    let x = lefty ? ((~dx + 9) << 24 >> 24) : dx;
    const y = dy, attr = a | 0x0C | (player & 1) | (lefty ? 0x20 : 0);
    xa = Math.min(xa, x); ya = Math.min(ya, y); xb = Math.max(xb, x + 8); yb = Math.max(yb, y + 16);
    return [x, y, t & 0xFE, attr];
  });
  const w = xb - xa, h = yb - ya, rgba = new Uint8Array(w * h * 4);
  for (const [x, y, t, a] of spr) for (let r = 0; r < 16; r++) {
    const row = a & 0x40 ? 15 - r : r, o = ((t + (row >> 3)) & 0x0F) * 16 + (row & 7) * 2;
    const lo = tiles[o], hi = tiles[o + 1];
    for (let px = 0; px < 8; px++) {
      const bit = a & 0x20 ? px : 7 - px, ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
      if (!ci) continue;
      const X = x - xa + px, Y = y - ya + r, q = (Y * w + X) * 4, po = (a & 7) * 8 + ci * 2, c = pal[po] | pal[po + 1] << 8;
      if (rgba[q + 3]) continue;                   // (a lower OAM index is in front)
      rgba[q] = (c & 31) << 3; rgba[q + 1] = ((c >> 5) & 31) << 3; rgba[q + 2] = ((c >> 10) & 31) << 3; rgba[q + 3] = 255;
    }
  }
  return { rgba, w, h, x0: 0x48 + xa, y0: 0x6C + ya };
}

// a picture's bytes as a short key (meshes are cached by it)
export function picKey(p) { let h = 2166136261; const d = p.rgba; for (let i = 0; i < d.length; i += 3) h = Math.imul(h ^ d[i], 16777619); return `${p.w}x${p.h}:${h >>> 0}`; }
export { lzDecompress, offset };
