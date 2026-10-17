// Shared helpers of the "B" HD painters (title screen, main menu, Create / Pick a Character, name entry): smoothing
// upscale of on-screen pixel art, tile-signature hashes (a screen is recognised by the CONTENT of a few of its tiles,
// compared as 32-bit hashes, so no ROM graphics are stored here), fonts of our own.
import { HD } from "../hdui.js";

// FNV-1a of a string -> hex (a tile's `sig` is its 64 colour indices; only the hash is kept in the code)
export function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(16); }

// how many of `sigs` ([x, y, hash]) are found at the screen positions x, y of layer `layer`
export function sigHits(scr, layer, sigs) {
  let n = 0;
  for (const [x, y, h] of sigs) { const c = scr.at(layer, x, y); if (c && fnv(c.sig) === h) n++; }
  return n;
}

// Scale2x (EPX) on 32-bit pixels: each pixel becomes 2x2; corners are rounded off where two neighbours agree
export function scale2x(src, w, h) {
  const o = new Uint32Array(w * h * 4), w2 = w * 2;
  for (let y = 0; y < h; y++) {
    const ym = y > 0 ? y - 1 : 0, yp = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0, xp = x < w - 1 ? x + 1 : w - 1;
      const E = src[y * w + x], B = src[ym * w + x], Hh = src[yp * w + x], D = src[y * w + xm], F = src[y * w + xp];
      let e0 = E, e1 = E, e2 = E, e3 = E;
      if (B !== Hh && D !== F) { if (D === B) e0 = D; if (B === F) e1 = F; if (D === Hh) e2 = D; if (Hh === F) e3 = F; }
      const i = y * 2 * w2 + x * 2; o[i] = e0; o[i + 1] = e1; o[i + w2] = e2; o[i + w2 + 1] = e3;
    }
  }
  return o;
}
export function makeCanvas(w, h) { const c = document.createElement("canvas"); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; }
// the rectangle (x, y, w, h) of 160x144 BG pixels (0xAABBGGRR) smoothed up 4x (Scale2x twice) as a canvas of w*4 x h*4.
// `skip(i)` (optional, i = index in the 160x144 picture) makes those pixels transparent (so ink can be laid on a fill)
export function smooth4(px, x, y, w, h, skip = null) {
  const a = new Uint32Array(w * h);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const i = (y + yy) * 160 + x + xx; a[yy * w + xx] = skip && skip(i) ? 0 : px[i]; }
  const b = scale2x(scale2x(a, w, h), w * 2, h * 2), c = makeCanvas(w * 4, h * 4), g = c.getContext("2d"), id = g.createImageData(w * 4, h * 4);
  new Uint32Array(id.data.buffer).set(b); g.putImageData(id, 0, 0);
  return c;
}

// our own fonts (web/fonts): loaded once; `onload` runs when ready (the painter registers itself again to repaint)
const fonts = {};
export function useFont(family, file, onload) {
  const f = fonts[family] || (fonts[family] = { ready: false, loading: false });
  if (f.ready) return true;
  if (!f.loading && typeof FontFace !== "undefined") {
    f.loading = true;
    new FontFace(family, `url(${new URL("../../fonts/" + file, import.meta.url)})`).load().then(x => { document.fonts.add(x); f.ready = true; if (onload) onload(); }).catch(e => console.warn("font", family, e));
  }
  return false;
}

// a four-point sparkle centred at (x, y), radius r
export function sparkle(g, x, y, r, fill = "#fff", glow = "rgba(255,240,150,0.9)") {
  g.save(); g.shadowColor = glow; g.shadowBlur = r * HD * 0.9; g.fillStyle = fill; g.beginPath();
  g.moveTo(x, y - r); g.quadraticCurveTo(x + r * 0.12, y - r * 0.12, x + r, y); g.quadraticCurveTo(x + r * 0.12, y + r * 0.12, x, y + r);
  g.quadraticCurveTo(x - r * 0.12, y + r * 0.12, x - r, y); g.quadraticCurveTo(x - r * 0.12, y - r * 0.12, x, y - r); g.fill(); g.restore();
}

// ---- sprites ------------------------------------------------------------------------------------------------------------
// A strip of sprites standing side by side in one row (same y, same height, 8 px apart): [[sprite, ...], ...], at least `min` each.
export function spriteStrips(oam, min = 5, ok = null) {
  const by = new Map(), out = [];
  for (const s of oam) { if (ok && !ok(s)) continue; const k = s.y + ":" + s.h; (by.get(k) || by.set(k, []).get(k)).push(s); }
  for (const list of by.values()) {
    list.sort((a, b) => a.x - b.x); let run = [list[0]];
    for (let i = 1; i <= list.length; i++) {
      if (i < list.length && list[i].x === run[run.length - 1].x + 8) { run.push(list[i]); continue; }
      if (run.length >= min) out.push(run);
      run = i < list.length ? [list[i]] : [];
    }
  }
  return out;
}
// the strip's sprites as one smoothed picture (Scale2x twice) with a soft drop shadow, drawn at its place; the sprites
// overlap by OAM order (the lower index on top). Returns nothing; `g` is in screen pixels.
export function drawSmoothSprites(g, sprs, shadow = true) {
  const x0 = Math.min(...sprs.map(s => s.x)), y0 = Math.min(...sprs.map(s => s.y)), x1 = Math.max(...sprs.map(s => s.x + 8)), y1 = Math.max(...sprs.map(s => s.y + s.h));
  const w = x1 - x0, h = y1 - y0, a = new Uint32Array(w * h);
  for (const s of [...sprs].sort((p, q) => q.i - p.i)) {
    const ci = s.ci, col = s.colors;
    for (let y = 0; y < s.h; y++) for (let x = 0; x < 8; x++) { const v = ci[y * 8 + x]; if (!v) continue; const k = col[v]; a[(s.y - y0 + y) * w + s.x - x0 + x] = (0xFF000000 | k.b << 16 | k.g << 8 | k.r) >>> 0; }
  }
  const b = scale2x(scale2x(a, w, h), w * 2, h * 2), c = makeCanvas(w * 4, h * 4), cg = c.getContext("2d"), id = cg.createImageData(w * 4, h * 4);
  new Uint32Array(id.data.buffer).set(b); cg.putImageData(id, 0, 0);
  if (shadow) { g.save(); g.shadowColor = "rgba(0,0,0,0.5)"; g.shadowBlur = 1.6 * HD; g.shadowOffsetX = 0.7 * HD; g.shadowOffsetY = 1.0 * HD; g.drawImage(c, x0, y0, w, h); g.restore(); }
  g.drawImage(c, x0, y0, w, h);
}
