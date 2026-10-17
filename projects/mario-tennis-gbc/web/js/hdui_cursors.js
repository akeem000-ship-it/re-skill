// HD UI, built-in art: menu cursors and arrows. They are sprites, so they are found by the SHAPE of their pixels (which
// pixels are opaque, in any flip) and redrawn from their own colours with the pixel art smoothed (the diagonal steps
// of Scale2x, twice = 4x: exactly the overlay's resolution). The original sprite is not shown (2D; the 3D view cannot
// leave a sprite out yet, so there the cursors stay as the game draws them).
import { registerHDPainter, HD } from "./hdui.js";

// which pixels of the 8x8 tile are opaque, rows as strings; compared in all four flips
const SHAPES = {
  bracket: ["11111110", "11111110", "11111110", "11111110", "11110000", "11110000", "11110000", "00000000"],
  arrowA: ["00001110", "00011111", "00111111", "01111111", "01111111", "00111111", "00011111", "00001111"],
  arrowB: ["01111000", "01111100", "01111110", "01111111", "01111111", "01111110", "01111100", "00111000"],
};
const flipXm = m => m.map(r => [...r].reverse().join("")), flipYm = m => [...m].reverse();
const VARIANTS = []; for (const k in SHAPES) { const m = SHAPES[k]; for (const v of [m, flipXm(m), flipYm(m), flipYm(flipXm(m))]) VARIANTS.push({ kind: k, key: v.join("") }); }
const ZERO = "0,0,0,0,0,0,0,0,";
const BYTEKEYS = new Set(); for (const v of VARIANTS) for (const m of [v.key]) { let k = ""; for (let r = 0; r < 8; r++) k += parseInt(m.slice(r * 8, r * 8 + 8), 2) + ","; BYTEKEYS.add(k); const rev = []; for (let r = 0; r < 8; r++) rev.push(parseInt([...m.slice(r * 8, r * 8 + 8)].reverse().join(""), 2)); BYTEKEYS.add(rev.join(",") + ","); }
const maskKey = ci => { let s = ""; for (let i = 0; i < 64; i++) s += ci[i] ? "1" : "0"; return s; };

// Scale2x on a grid of colour values (0 = transparent); returns the 2x grid
function scale2x(a, w, h) {
  const o = new Uint32Array(w * 2 * h * 2), W = w * 2, at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : a[y * w + x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const E = a[y * w + x], B = at(x, y - 1), D = at(x - 1, y), F = at(x + 1, y), H = at(x, y + 1);
    let e0 = E, e1 = E, e2 = E, e3 = E;
    if (B !== H && D !== F) { if (D === B) e0 = D; if (B === F) e1 = F; if (D === H) e2 = D; if (H === F) e3 = F; }
    o[2 * y * W + 2 * x] = e0; o[2 * y * W + 2 * x + 1] = e1; o[(2 * y + 1) * W + 2 * x] = e2; o[(2 * y + 1) * W + 2 * x + 1] = e3;
  }
  return o;
}
// the smoothed picture of a grid of packed colours (0xAABBGGRR, 0 = none) drawn with its top-left at (x, y) screen pixels
const tmp = typeof document !== "undefined" ? document.createElement("canvas") : null;
function drawSmooth(g, grid, w, h, x, y) {
  const big = scale2x(scale2x(grid, w, h), w * 2, h * 2), W = w * 4, H = h * 4;
  if (tmp.width !== W || tmp.height !== H) { tmp.width = W; tmp.height = H; }
  const tg = tmp.getContext("2d"), im = tg.createImageData(W, H); new Uint32Array(im.data.buffer).set(big); tg.putImageData(im, 0, 0);
  g.save(); g.imageSmoothingEnabled = false; g.drawImage(tmp, x, y, w, h); g.restore();
}

function paintCursors(g, scr, layer) {
  if (!scr.canHide) return;
  const picked = [], vram = scr.gb.mem.vram;
  for (const s of scr.oam) {
    // quick test on the raw tile bytes (any flip is among the variants): a one-tile sprite, its tile in the top or bottom half
    const bank = s.attr & 8 ? vram[1] : vram[0], base = s.tile << 4; let half = -1, k0 = "", k1 = "";
    for (let r = 0; r < 8; r++) k0 += (bank[base + r * 2] | bank[base + r * 2 + 1]) + ",";
    if (s.h === 16) { for (let r = 0; r < 8; r++) k1 += (bank[base + 16 + r * 2] | bank[base + 17 + r * 2]) + ","; const e0 = k0 === ZERO, e1 = k1 === ZERO; if (e0 === e1) continue; half = e0 ? 1 : 0; } else half = 0;
    if (!BYTEKEYS.has(half ? k1 : k0)) continue;
    const ci = s.ci, oy = s.h === 16 && !ci.subarray(0, 64).some(v => v) ? 8 : 0, sub = ci.subarray(oy * 8, oy * 8 + 64);   // where it shows (upside down: the bottom half)
    if (VARIANTS.some(v => v.key === maskKey(sub))) picked.push({ s, oy, sub });
  }
  if (!picked.length) return;
  // sprites that touch are one picture (the two halves of an arrow), so their seam is smoothed too
  const groups = [];
  for (const s of picked) {
    const near = groups.filter(gr => gr.some(o => Math.abs(o.s.x - s.s.x) <= 8 && Math.abs(o.s.y + o.oy - s.s.y - s.oy) <= 8));
    const merged = [s]; for (const gr of near) { merged.push(...gr); groups.splice(groups.indexOf(gr), 1); } groups.push(merged);
  }
  const pal = c => (0xFF000000 | c.b << 16 | c.g << 8 | c.r) >>> 0;
  if (!scr.hide(picked.map(p => p.s))) return;                          // the originals out, the picture back
  for (const gr of groups) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const { s, oy } of gr) { x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y + oy); x1 = Math.max(x1, s.x + 8); y1 = Math.max(y1, s.y + oy + 8); }
    const w = x1 - x0, h = y1 - y0, grid = new Uint32Array(w * h);
    for (const { s, oy, sub } of [...gr].sort((a, b) => b.s.i - a.s.i)) {          // lower OAM index on top
      const cols = s.colors;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const c = sub[y * 8 + x]; if (c) grid[(s.y + oy + y - y0) * w + s.x + x - x0] = pal(cols[c]); }
    }
    // drawn on the sprite canvas (over the sprites)
    drawSmooth(g, grid, w, h, x0, y0);
  }
}
registerHDPainter("cursors", paintCursors, { order: 10, sprites: true });
void HD;
