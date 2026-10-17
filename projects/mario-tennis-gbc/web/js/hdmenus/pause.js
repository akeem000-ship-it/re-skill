// HD painters for agent C: the pause menus, rules / briefing panels, results and ranking screens.
// The game frames its boxes with a one-pixel black outline and a one-pixel white inner border round a flat fill. This
// painter finds those boxes from the BG-only picture at runtime (nothing of the ROM's graphics is copied: a box is a
// flat-coloured region whose rim is a white line over a dark line) and redraws each as the shared HD panel: rounded
// corners, a darker rim, a white inner border, a soft drop shadow and a sheen on the top half. The text on it is
// drawn by web/js/hdtext.js; icons, digits and portraits on the fill are given back from the original pixels.
import { registerHDPainter, panelFrame, punchInk, markOpaque, shade, mix, rgbCss, HD } from "../hdui.js";

const luma = c => ((c & 255) * 77 + (c >> 8 & 255) * 151 + (c >> 16 & 255) * 28) >> 8;       // 0xAABBGGRR
const rgbOf = c => [c & 255, c >> 8 & 255, c >> 16 & 255];
const cssOf = c => rgbCss(c & 255, c >> 8 & 255, c >> 16 & 255);

// ---- finding the boxes ------------------------------------------------------------------------------------------------
// flat regions (4-connected pixels of one colour) at least MIN_W x MIN_H, rimmed on all four sides by a light line
// directly outside them and a dark line (darker than the fill) outside that
const MIN_W = 5, MIN_H = 3, MIN_AREA = 24;
export function findPanels(px) {
  const W = 160, H = 144, label = new Int16Array(W * H).fill(-1), stack = new Int32Array(W * H), out = [];
  for (let s = 0; s < W * H; s++) {
    if (label[s] >= 0) continue;
    const col = px[s]; let sp = 0, area = 0, x0 = 159, x1 = 0, y0 = 143, y1 = 0; stack[sp++] = s; label[s] = 0;
    while (sp) {
      const i = stack[--sp], x = i % W, y = (i / W) | 0; area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && label[i - 1] < 0 && px[i - 1] === col) { label[i - 1] = 0; stack[sp++] = i - 1; }
      if (x < W - 1 && label[i + 1] < 0 && px[i + 1] === col) { label[i + 1] = 0; stack[sp++] = i + 1; }
      if (y > 0 && label[i - W] < 0 && px[i - W] === col) { label[i - W] = 0; stack[sp++] = i - W; }
      if (y < H - 1 && label[i + W] < 0 && px[i + W] === col) { label[i + W] = 0; stack[sp++] = i + W; }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (area < MIN_AREA || w < MIN_W || h < MIN_H || area < w * h * 0.3) continue;
    const rim = rimOf(px, col, x0, y0, x1, y1);
    if (rim) out.push({ x0, y0, x1, y1, fill: col, light: rim.light, dark: rim.dark });
  }
  return out;
}
// the colours of the light and dark lines round a box, or null when the box has no such rim
function rimOf(px, fill, x0, y0, x1, y1) {
  const W = 160, H = 144; if (x0 < 2 || y0 < 2 || x1 > W - 3 || y1 > H - 3) return null;   // the rim is on screen
  const lf = luma(fill), tally = new Map();
  const side = (get, n) => {                                  // get(k, d) -> pixel at position k along the side, d = 1 (light line) or 2 (dark line)
    let ok = 0, total = 0; const lc = new Map(), dc = new Map();
    for (let k = 2; k < n - 2; k++) {
      total++; const a = get(k, 1), b = get(k, 2), la = luma(a), lb = luma(b);
      if (la - lb >= 90 && la >= lf + 12 && la >= 100 && lb <= lf) { ok++; lc.set(a, (lc.get(a) || 0) + 1); dc.set(b, (dc.get(b) || 0) + 1); }
    }
    if (total < 1 || ok < total * 0.75) return false;
    for (const [m, into] of [[lc, "l"], [dc, "d"]]) { let best = 0, bc = 0; for (const [c, n] of m) if (n > best) { best = n; bc = c; } tally.set(into, (tally.get(into) || []).concat(bc)); }
    return true;
  };
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (!side((k, d) => px[(y0 + k) * W + x0 - d], h)) return null;
  if (!side((k, d) => px[(y0 + k) * W + x1 + d], h)) return null;
  if (!side((k, d) => px[(y0 - d) * W + x0 + k], w)) return null;
  if (!side((k, d) => px[(y1 + d) * W + x0 + k], w)) return null;
  return { light: tally.get("l")[0], dark: tally.get("d")[0] };
}

// ---- the painter ---------------------------------------------------------------------------------------------------------
// the boxes of the current screen, computed once per snapshot (the bg and window layers are painted one after the other)
function panelsOf(scr) {
  if (scr._pausePanels && scr._pauseKey === scr.key && scr._pausePx === scr.px32) return scr._pausePanels;
  const list = findPanels(scr.px32);
  for (const p of list) {
    const cx = (p.x0 + p.x1) >> 1, cy = (p.y0 + p.y1) >> 1;
    p.layer = scr.gb.ppu.pixCell[cy * 160 + cx] & 0x8000 ? "win" : "bg";
    p.depth = list.filter(q => q !== p && q.x0 <= p.x0 && q.y0 <= p.y0 && q.x1 >= p.x1 && q.y1 >= p.y1).length;
  }
  list.sort((a, b) => a.depth - b.depth || a.y0 - b.y0 || a.x0 - b.x0);
  scr._pauseKey = scr.key; scr._pausePx = scr.px32; return scr._pausePanels = list;
}

function paintPanel(g, scr, p) {
  const x = p.x0 - 2, y = p.y0 - 2, w = p.x1 - p.x0 + 5, h = p.y1 - p.y0 + 5;
  const fill = cssOf(p.fill), small = Math.min(w, h) < 14;
  // the rounded corners leave the old square corners of the outline showing: cover them with the picture just outside
  const r = small ? 1.8 : 2.4, cover = (cx, cy, sx, sy) => {
    const ox = Math.min(159, Math.max(0, cx + sx)), oy = Math.min(143, Math.max(0, cy + sy));
    g.fillStyle = cssOf(scr.px32[oy * 160 + ox]); g.fillRect(sx < 0 ? cx : cx - r, sy < 0 ? cy : cy - r, r, r);
  };
  cover(x, y, -1, -1); cover(x + w, y, 1, -1); cover(x, y + h, -1, 1); cover(x + w, y + h, 1, 1);
  const border = luma(p.light) > 235 ? "rgb(252,252,244)" : cssOf(p.light), rim = mix(cssOf(p.dark), shade(fill, 0.55), 0.9);
  const inner = panelFrame(g, x, y, w, h, { fill, rim, border, radius: r, rimW: 1.1, borderW: 0.9, sheen: small ? 0.12 : 0.2, shadow: !small || w > 12 });
  // icons, digits, portraits on the fill stay as the game drew them (the text lines are redrawn by the HD text, whose
  // old glyphs the fill covers, so the text layer needs no patch of its own)
  const ix = p.x0, iy = p.y0, iw = p.x1 - p.x0 + 1, ih = p.y1 - p.y0 + 1;
  punchInk(g, scr, ix, iy, iw, ih, rgbOf(p.fill), 6);
  markOpaque(scr, ix, iy, iw, ih);
  return inner;
}

// Painted last and UNDER whatever the other painters (title, main menu, character data ...) already put on the layer
// (destination-over), so a box they drew themselves stays theirs and anything they drew inside one of ours stays on
// top; a box they marked opaque (markOpaque) is skipped. The boxes are drawn on a scratch canvas first.
const scratch = typeof document !== "undefined" ? Object.assign(document.createElement("canvas"), { width: 640, height: 576 }) : null;
const claimed = (pre, p) => {
  let n = 0, tot = 0;
  for (let y = p.y0; y <= p.y1; y++) for (let x = p.x0; x <= p.x1; x++) { tot++; if (pre[y * 160 + x]) n++; }
  return n > tot * 0.5;
};
registerHDPainter("pause-panels", (g, scr, layer) => {
  if (!scratch || /[?&]nopause\b/.test(location.search)) return;
  const pre = layer === "bg" || !scr._pausePre ? (scr._pausePre = scr.opaque.slice()) : scr._pausePre;
  const list = panelsOf(scr).filter(p => p.layer === layer && !claimed(pre, p)); if (!list.length) return;
  const o = scratch.getContext("2d"); o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, 640, 576); o.save(); o.setTransform(HD, 0, 0, HD, 0, 0);
  for (const p of list) paintPanel(o, scr, p);
  o.restore();
  g.globalCompositeOperation = "destination-over"; g.drawImage(scratch, 0, 0, 160, 144);
}, { order: 200 });
