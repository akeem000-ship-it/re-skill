// HD painters for agent D: character data / EXP screens, court select, minigame menus, icons, and the menu (UI) font.
// Use the API in web/js/hdui.js (usage note at its top): registerHDPainter(name, (g, scr, layer) => {...}, { order }).
import { registerHDPainter as register, drawText, shade, roundRect, panelFrame, markOpaque, HD } from "../hdui.js";
// (painters are timed into globalThis.__dTimes: milliseconds per painter, for tests)
const registerHDPainter = (name, fn, o) => register(name, (...a) => { const t = performance.now(); try { return fn(...a); } finally { const T = globalThis.__dTimes || (globalThis.__dTimes = {}); T[name] = (T[name] || 0) + performance.now() - t; } }, o);

// ---- the menu font -----------------------------------------------------------------------------------------------------
// Every menu bar and box is lettered in the game's 8x8 fixed-width UI font (bank $01 at $4410, glyphs $20-$7F, one tile per
// character; colour 1 = background, 3 = ink, 2 = shadow). It is read off the screen by TILE CONTENT: a tile whose pixels are
// exactly a glyph is that character (the glyph table is read from the ROM at run time, nothing is stored here).
const UI_FONT = 0x4410, UI_GLYPHS = 96;
let glyphMap = null, glyphRom = null;
function glyphs(rom) {
  if (glyphMap && glyphRom === rom) return glyphMap;
  glyphRom = rom; glyphMap = new Map();
  for (let g = 0; g < UI_GLYPHS; g++) {
    let sig = "";
    for (let r = 0; r < 8; r++) {
      const lo = rom[UI_FONT + g * 16 + r * 2], hi = rom[UI_FONT + g * 16 + r * 2 + 1];
      for (let x = 0; x < 8; x++) sig += ((lo >> (7 - x)) & 1) | (((hi >> (7 - x)) & 1) << 1);
    }
    const ch = String.fromCharCode(0x20 + g);
    if (g && !glyphMap.has(sig) && !"~^`|{}\\".includes(ch)) glyphMap.set(sig, ch);      // (the rest of the table is frame bits, not letters)
  }
  return glyphMap;
}
const BLANK = "1".repeat(64);
// lines of UI-font text in one layer: [{x, y, w, layer, text, cells, c: [bg, shadow, ink] css colours}]
export function readUIText(scr, layer) {
  const map = glyphs(scr.gb.mem.rom), by = new Map(), out = [];
  for (const cl of scr.cells[layer]) {
    if (cl.flipX || cl.flipY) continue;
    const ch = cl.sig === BLANK ? " " : map.get(cl.sig); if (!ch) continue;
    (by.get(cl.y) || by.set(cl.y, []).get(cl.y)).push({ cl, ch });
  }
  for (const [y, list] of by) {
    list.sort((a, b) => a.cl.x - b.cl.x);
    let run = [];
    const flush = () => {
      while (run.length && run[0].ch === " ") run.shift();
      while (run.length && run[run.length - 1].ch === " ") run.pop();
      if (run.length && run.some(r => /[A-Za-z0-9]/.test(r.ch))) {
        const ink = run.find(r => r.ch !== " ").cl, cc = ink.colors;
        out.push({ x: run[0].cl.x, y, w: run.length * 8, layer, text: run.map(r => r.ch).join(""), cells: run.map(r => r.cl), c: [cc[1].css, cc[2].css, cc[3].css], rgb: [cc[1], cc[2], cc[3]] });
      }
      run = [];
    };
    for (let i = 0; i < list.length; i++) {
      if (run.length && list[i].cl.x !== run[run.length - 1].cl.x + 8) flush();
      run.push(list[i]);
    }
    flush();
  }
  return out;
}

// ---- the dialogue font with a shadow -----------------------------------------------------------------------------------
// The character data / EXP pages print the dialogue font (bank $05: glyphs at $7920, widths at $7F80) with a shadow of
// shifting rules, so a strip of tiles is matched on the INK alone (colour 3: the glyph's columns as 8-bit masks), glyph by
// glyph, the pen moving on by each glyph's width. A strip with a colour-0 pixel is a picture, not text.
const PF = 0x7920 + 5 * 0x4000 - 0x4000, PW = 0x7F80 + 5 * 0x4000 - 0x4000, PG = 0x66;
let pfRom = null, pfFont = null;
function propFont(rom) {
  if (pfFont && pfRom === rom) return pfFont;
  pfRom = rom; const list = [];
  for (let g = 1; g < PG; g++) {
    const w = rom[PW + g]; if (!(w > 0 && w <= 8)) continue;
    const cols = new Uint8Array(8); let ink = 0;
    for (let r = 0; r < 8; r++) {
      const lo = rom[PF + g * 16 + r * 2], hi = rom[PF + g * 16 + r * 2 + 1], b = lo & hi;
      for (let x = 0; x < 8; x++) if ((b >> (7 - x)) & 1) { cols[x] |= 1 << r; if (x < w) ink++; }
    }
    if (ink) list.push({ ch: String.fromCharCode(0x20 + g), w, ink, cols });
  }
  list.sort((a, b) => b.ink - a.ink);
  return pfFont = { list, space: rom[PW] || 5 };
}
// strips of tile columns in one layer: per column the mask of ink rows; strips with a colour-0 pixel are skipped
function strips(scr, layer) {
  const bands = new Map(), out = [];
  for (const cl of scr.cells[layer]) { if (cl.flipX || cl.flipY) continue; (bands.get(cl.y) || bands.set(cl.y, []).get(cl.y)).push(cl); }
  for (const [y, list] of bands) {
    list.sort((a, b) => a.x - b.x); let s = 0;
    for (let i = 1; i <= list.length; i++) {
      if (i < list.length && list[i].x === list[i - 1].x + 8) continue;
      const cells = list.slice(s, i); s = i;
      if (cells.some(cl => cl.ci.includes(0))) {                           // split at the picture tiles
        let a = 0; for (let k = 0; k <= cells.length; k++) if (k === cells.length || cells[k].ci.includes(0)) { if (k > a) addStrip(out, y, cells.slice(a, k)); a = k + 1; }
      } else addStrip(out, y, cells);
    }
  }
  return out;
}
function addStrip(out, y, cells) {
  let bg = 0; for (const cl of cells) for (const v of cl.ci) if (v === 1) bg++;
  if (bg < cells.length * 64 * 0.3) return;                // text sits on a plain (colour 1) ground
  const cols = new Uint8Array(cells.length * 8);
  cells.forEach((cl, k) => { const ci = cl.ci; for (let x = 0; x < 8; x++) { let m = 0; for (let r = 0; r < 8; r++) if (ci[r * 8 + x] === 3) m |= 1 << r; cols[k * 8 + x] = m; } });
  if (cols.some(m => m)) out.push({ y, cells, cols, x: cells[0].x });
}
// trimmed ink patterns of the glyphs (each glyph's ink columns without the blank ones at either end)
function patterns(font) {
  if (font.pat) return font.pat;
  const list = [];
  for (const g of font.list) {
    let a = 0, b = g.w - 1; while (a <= b && !g.cols[a]) a++; while (b >= a && !g.cols[b]) b--;
    if (a > b) continue;
    const cols = Array.from(g.cols.slice(a, b + 1));
    list.push({ ch: g.ch, ink: g.ink, cols, cond: false });
    // the narrow cut of the font (long labels such as PLACEMENT): a glyph with one inner column left out
    if (cols.length >= 4) for (let k = 1; k < cols.length - 1; k++) list.push({ ch: g.ch, ink: g.ink - pop(cols[k]), cols: cols.filter((_, i) => i !== k), cond: true });
  }
  return font.pat = list;
}
const FUZZY = false;                                       // nearest-glyph reading of the artists' variants: off (too loose)
function pop(v) { let n = 0; for (; v; v &= v - 1) n++; return n; }
// how many ink pixels of the glyph pattern are missing from the columns [a, a + n) (-1: it does not fit). Wide glyphs
// (4+ columns) may be short of ink in the last column, or lack it: the game's shadowed print eats into it (E loses the
// ends of its bars)
function fits(g, cols, a, n) {
  const L = g.cols.length;
  if (n === L) { for (let k = 0; k < L - 1; k++) if (cols[a + k] !== g.cols[k]) return -1; const c = cols[a + L - 1], d = g.cols[L - 1]; return c === d ? 0 : (c & d) === c && L > 3 ? pop(d) - pop(c) : -1; }
  if (n === L - 1 && L > 3) { for (let k = 0; k < n; k++) if (cols[a + k] !== g.cols[k]) return -1; return pop(g.cols[L - 1]); }
  return -1;
}
function bestGlyph(P, cols, a, b, fuzzy) {
  let best = null, bm = 99;
  for (const g of P) { const m = fits(g, cols, a, b - a) + (g.cond ? 0.5 : 0); if (m >= 0.5 || fits(g, cols, a, b - a) >= 0) { if (fits(g, cols, a, b - a) < 0) continue; if (m < bm || (m === bm && g.ink > best.ink)) { best = g; bm = m; } } }
  if (best || !fuzzy) return best && { ch: best.ch, ink: best.ink, exact: true };
  // the artists' variants of the font: the nearest glyph of the same width by ink pixels differing
  const n = b - a; let bd = 99, bg = null, ink = 0;
  for (let k = 0; k < n; k++) ink += pop(cols[a + k]);
  for (const g of P) {
    if (Math.abs(g.cols.length - n) > 0) continue;
    let d = 0; for (let k = 0; k < n; k++) d += pop(cols[a + k] ^ g.cols[k]);
    if (d < bd || (d === bd && g.ink > bg.ink)) { bd = d; bg = g; }
  }
  return bg && bd <= Math.max(1, Math.floor(ink * 0.16)) && ink >= 5 ? { ch: bg.ch, ink: bg.ink, exact: false } : null;
}
// the same, remembered by the run's ink (the screens hold the same words for long; most runs are one glyph)
const runCache = new Map();
function splitCached(P, cols, a, b) {
  const key = Array.prototype.join.call(cols.subarray(a, b), ",");
  let r = runCache.get(key);
  if (r === undefined) {
    r = b - a <= 26 ? splitRun(P, cols, a, b) : null;
    if (r) r = r.map(g => ({ ...g, a: g.a - a, b: g.b - a }));
    if (runCache.size > 4000) runCache.clear();
    runCache.set(key, r);
  }
  return r && r.map(g => ({ ...g, a: g.a + a, b: g.b + a }));
}
// the glyphs (characters) that make the columns [a, b): the whole run as one glyph, else cut into glyphs that touch;
// returns [{ch, a, b}] or null
function splitRun(P, cols, a, b, out = [], fuzzy = false) {
  const whole = bestGlyph(P, cols, a, b, fuzzy);
  if (whole) { out.push({ ch: whole.ch, a, b, exact: whole.exact }); return out; }
  for (let k = b - 1; k > a + 1; k--) {                      // a glyph at the left, the rest cut again
    const left = bestGlyph(P, cols, a, k, fuzzy); if (!left) continue;
    const mark = out.length; out.push({ ch: left.ch, a, b: k, exact: left.exact });
    if (splitRun(P, cols, k, b, out, fuzzy)) return out;
    out.length = mark;
  }
  return fuzzy || !FUZZY ? null : splitRun(P, cols, a, b, out, true);
}
function fnvCols(cols, a, b) { let h = 2166136261; for (let x = a; x < b; x++) h = Math.imul(h ^ cols[x], 16777619); return (h >>> 0).toString(16); }
const NARROW_WORDS = { "3a75a57c": "PLACEMENT", "f13c035": "LOB SHOTS", "f0cc8cee": "DROP SHOTS", "5d8a2e7c": "DOUBLE FAULTS" };                                  // hash of a word's ink columns -> the word (long labels in the narrow cut)
// lines of dialogue-font text in one layer: the ink columns of a strip fall into runs separated by blank columns; each
// run is a glyph (or touching glyphs), the gaps decide word breaks and line ends
export function readShadowText(scr, layer) {
  const font = propFont(scr.gb.mem.rom), P = patterns(font), out = [], ws = font.space;
  for (const st of strips(scr, layer)) {
    const { cols, cells } = st, n = cols.length, runs = [];
    for (let x = 0; x < n;) { if (!cols[x]) { x++; continue; } let e = x; while (e < n && cols[e]) e++; runs.push([x, e]); x = e; }
    // a frame's edge (full-height columns of ink) is no letter: runs of it end the phrase before it and start one after it
    for (let k = runs.length - 1; k >= 0; k--) { let edge = true; for (let x = runs[k][0]; x < runs[k][1]; x++) if (cols[x] !== 255) { edge = false; break; } if (edge) runs[k] = null; }
    // phrases: runs less than 9 blank columns apart; a phrase with one run that is no glyph is left as it is (pixel text)
    for (let i = 0; i < runs.length;) {
      if (!runs[i]) { i++; continue; }
      let j = i + 1; while (j < runs.length && runs[j] && runs[j][0] - runs[j - 1][1] < 9) j++;
      const items = []; let ok = true, exact = false;
      for (let k = i; k < j && ok; k++) {
        const [a, b] = runs[k], gl = splitCached(P, cols, a, b);
        if (!gl) { ok = false; _dbg.unmatched.push({ x: cells[0].x + a, y: st.y, cols: Array.from(cols.slice(a, b)) }); break; }
        for (const g of gl) {
          const prev = items.length ? items[items.length - 1] : null;
          const gap = prev ? g.a - prev.b : 0;
          if (prev && prev.ch !== " " && prev.ch !== "'" && (gap >= 4 || (gap === 3 && /[a-z]/.test(prev.ch + g.ch)) || (gap === 2 && prev.ch === "t" && g.ch === "l"))) items.push({ ch: " ", a: prev.b, b: g.a });
          items.push(g); if (g.exact) exact = true;
        }
      }
      if (!ok) {                                           // a whole word in the narrow cut: known by the hash of its ink
        const a = runs[i][0], b = runs[j - 1][1], h = fnvCols(cols, a, b), word = NARROW_WORDS[h];
        if (_dbg.hashes) _dbg.hashes.push([h, cells[0].x + a, st.y]);
        if (word) { const c0 = cells[a >> 3], cc = c0.colors; out.push({ x: c0.x + (a & 7), y: st.y, w: b - a, layer, text: word, cells, c: [cc[1].css, cc[2].css, cc[3].css], rgb: [cc[1], cc[2], cc[3]], shadowFont: true }); }
      }
      if (ok && exact && items.length && !(items.length > 1 && items.every(it => it.ch === items[0].ch))) {
        let text = "";
        for (let k = 0; k < items.length; k++) {
          let ch = items[k].ch;
          if (ch === "0") { const pv = k ? items[k - 1].ch : "", nx = k + 1 < items.length ? items[k + 1].ch : ""; if (/[A-Z]/.test(pv) || /[A-Z]/.test(nx)) ch = "O"; }
          text += ch;
        }
        const a = items[0].a, b = items[items.length - 1].b, c0 = cells[a >> 3], cc = c0.colors;
        out.push({ x: c0.x + (a & 7), y: st.y, w: b - a, layer, text, cells, c: [cc[1].css, cc[2].css, cc[3].css], rgb: [cc[1], cc[2], cc[3]], shadowFont: true });
      }
      i = j;
    }
  }
  return out;
}
export const _dbg = { propFont, strips, unmatched: [], hashes: null };

// ---- drawing the menu text ----------------------------------------------------------------------------------------------
// Pass 1 (before the frames): read the lines and mask their pixels, so the panels' fill hides the old glyphs; pass 2 (after
// the frames and the other art): the lines in the HD font.
const textLines = layer => scr => scr._dText && scr._dText[layer] || [];
function readLines(scr, layer) {
  const lines = readUIText(scr, layer), mine = readShadowText(scr, layer), theirs = (scr.lines || []).filter(l => (l.win ? "win" : "bg") === layer);
  const hit = (a, b) => a.x < b.x + b.w + 1 && b.x < a.x + a.w + 1 && a.y < b.y + 8 && b.y < a.y + 8;
  for (const m of mine) if (!lines.some(u => hit(u, m)) && !theirs.some(t => hit(t, m))) lines.push(m);
  return lines.filter(u => !theirs.some(t => hit(t, u)));
}
registerHDPainter("d_text_read", (g, scr, layer) => {
  if (!scr._dText || scr._dText.stamp !== scr.key) scr._dText = { stamp: scr.key };
  const lines = scr._dText[layer] = scr.font ? readLines(scr, layer) : [];
  for (const l of lines) for (let y = Math.max(0, l.y); y < Math.min(144, l.y + 8); y++) scr.textMask.fill(1, y * 160 + Math.max(0, l.x), y * 160 + Math.min(160, l.x + l.w + 1));
}, { order: -5 });
registerHDPainter("d_text", (g, scr, layer) => {
  const lines = scr._dText && scr._dText[layer]; if (!lines || !lines.length) return;
  const f = scr.font; if (!f) return;
  for (const l of lines) {
    // lines of a list (the same left edge, or overlapping) that sit close get one smaller size
    let gap = 16;
    for (const o of lines) if (o !== l && o.y !== l.y && (Math.abs(o.x - l.x) <= 3 || (o.x < l.x + l.w && l.x < o.x + o.w))) gap = Math.min(gap, Math.abs(o.y - l.y));
    const size = f.em * Math.min(1, Math.max(0.7, gap / 14));
    let covered = true; for (let y = Math.max(0, l.y); y < Math.min(144, l.y + 8) && covered; y++) for (let x = Math.max(0, l.x); x < Math.min(160, l.x + l.w + 1); x++) if (!scr.opaque[y * 160 + x]) { covered = false; break; }
    if (!covered) { g.fillStyle = l.c[0]; g.fillRect(l.x, l.y, l.w + 1, 8); }
    if (/^\S{1,5}( \S{1,5}){2,}$/.test(l.text.trim()) && l.cells.length === l.text.length && l.text.trim().length >= 12) {   // a letter grid (name entry): one centred character per cell
      for (let k = 0; k < l.text.length; k++) { const ch = l.text[k]; if (ch !== " ") drawText(g, scr, ch, l.x + k * 8 + 4, l.y + 7.6, { size: 10.5, color: l.c[2], shadow: shade(l.c[1], 1), align: "center" }); }
      continue;
    }
    const digits = /^[0-9 ]+$/.test(l.text);
    drawText(g, scr, l.text, digits ? l.x + l.w : l.x, l.y + f.base, { size, color: l.c[2], shadow: shade(l.c[1], 1), maxW: l.w + 2.5, align: digits ? "right" : "left" });
  }
}, { order: 60 });

// ---- smoothing --------------------------------------------------------------------------------------------------------
// Scale2x (EPX) twice: the picture's own pixels at 4x with the stair-steps of diagonals and corners rounded off. The smoothed
// copy of the screen is kept between repaints (buffers + canvas) and only the 8x8 tiles whose pixels changed are done again
// (with a 1 px margin: EPX looks at the neighbours), then the changed rectangle alone goes to the canvas.
function scale2xRegion(src, w, h, o, x0, y0, x1, y1) {
  const w2 = w * 2; x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w, x1); y1 = Math.min(h, y1);
  for (let y = y0; y < y1; y++) {
    const ym = y > 0 ? y - 1 : 0, yp = y < h - 1 ? y + 1 : h - 1;
    for (let x = x0; x < x1; x++) {
      const xm = x > 0 ? x - 1 : 0, xp = x < w - 1 ? x + 1 : w - 1;
      const E = src[y * w + x], B = src[ym * w + x], Hh = src[yp * w + x], D = src[y * w + xm], F = src[y * w + xp];
      let e0 = E, e1 = E, e2 = E, e3 = E;
      if (B !== Hh && D !== F) { if (D === B) e0 = D; if (B === F) e1 = F; if (D === Hh) e2 = D; if (Hh === F) e3 = F; }
      const i = y * 2 * w2 + x * 2; o[i] = e0; o[i + 1] = e1; o[i + w2] = e2; o[i + w2 + 1] = e3;
    }
  }
}
const scale2xInto = (src, w, h, o) => scale2xRegion(src, w, h, o, 0, 0, w, h);
// the picture's smoothed 4x copy as a canvas (buffers kept between calls), whole-picture version (the stat tabs)
function makeSmoother() {
  const a = new Uint32Array(160 * 144), b = new Uint32Array(320 * 288), c = new Uint32Array(640 * 576); let cv = null, id = null;
  return px => {
    a.set(px); scale2xInto(a, 160, 144, b); scale2xInto(b, 320, 288, c);
    if (!cv) { cv = document.createElement("canvas"); cv.width = 640; cv.height = 576; id = cv.getContext("2d").createImageData(640, 576); }
    new Uint32Array(id.data.buffer).set(c); cv.getContext("2d").putImageData(id, 0, 0); return cv;
  };
}
let SM = null;                                        // the incremental smoother of the screen picture
function smoothScreen(px, fresh) {
  if (!SM) { const cv = document.createElement("canvas"); cv.width = 640; cv.height = 576; const id = cv.getContext("2d").createImageData(640, 576); SM = { a: new Uint32Array(160 * 144), b: new Uint32Array(320 * 288), c: new Uint32Array(id.data.buffer), cv, id, valid: false }; }
  const { a, b, c } = SM, dirty = [];
  for (let ty = 0; ty < 18; ty++) for (let tx = 0; tx < 20; tx++) {
    let d = fresh || !SM.valid;
    for (let y = 0; y < 8 && !d; y++) { const o = (ty * 8 + y) * 160 + tx * 8; for (let x = 0; x < 8; x++) if (px[o + x] !== a[o + x]) { d = true; break; } }
    if (d) dirty.push(tx, ty);
  }
  if (!dirty.length) return null;
  a.set(px);
  let X0 = 640, Y0 = 576, X1 = 0, Y1 = 0;
  for (let k = 0; k < dirty.length; k += 2) { const x = dirty[k] * 8, y = dirty[k + 1] * 8; scale2xRegion(a, 160, 144, b, x - 1, y - 1, x + 9, y + 9); }
  for (let k = 0; k < dirty.length; k += 2) {
    const x = dirty[k] * 16, y = dirty[k + 1] * 16; scale2xRegion(b, 320, 288, c, x - 3, y - 3, x + 19, y + 19);
    X0 = Math.min(X0, x * 2 - 6); Y0 = Math.min(Y0, y * 2 - 6); X1 = Math.max(X1, x * 2 + 38); Y1 = Math.max(Y1, y * 2 + 38);
  }
  X0 = Math.max(0, X0); Y0 = Math.max(0, Y0); X1 = Math.min(640, X1); Y1 = Math.min(576, Y1);
  SM.cv.getContext("2d").putImageData(SM.id, 0, 0, X0, Y0, X1 - X0, Y1 - Y0); SM.valid = true;
  return { x: X0, y: Y0, w: X1 - X0, h: Y1 - Y0 };
}
// the smoothed copy of a small picture (sprites): only the box the sprites lie in, +2 px of margin (edges of the screen clamp, as the whole-screen version did)
function smoothBox(buf, bx0, by0, bx1, by1) {
  const x0 = Math.max(0, bx0 - 2), y0 = Math.max(0, by0 - 2), x1 = Math.min(160, bx1 + 2), y1 = Math.min(144, by1 + 2), w = x1 - x0, h = y1 - y0;
  const a = new Uint32Array(w * h), b = new Uint32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = buf[(y0 + y) * 160 + x0 + x];
  const m = new Uint32Array(w * 2 * h * 2), o = new Uint32Array(w * 4 * h * 4);
  scale2xInto(a, w, h, m); scale2xInto(m, w * 2, h * 2, o);
  if (!SB) SB = document.createElement("canvas"); SB.width = w * 4; SB.height = h * 4;
  const id = SB.getContext("2d").createImageData(w * 4, h * 4); new Uint32Array(id.data.buffer).set(o); SB.getContext("2d").putImageData(id, 0, 0);
  void b; return { cv: SB, x: x0, y: y0, w, h };
}
let SB = null;
// The smoothed picture goes UNDER everything the other painters draw (the "under" canvas, below the bg / win art): the frames
// painter cuts the original's ink (portraits, icons, bars) out of its fills so "the picture shows through", and what shows
// through is then the smoothed picture, not the plain 4x one. Only on screens that have HD panels (menus), never in a match.
const onCourt = scr => scr.gb.mem.wram[0][0x32E] <= 15;       // wCurMapID: a court (the match, the courts' maps)
const SMOOTH_ALL = true;
let underPart = null;                                         // the clip the canvas was last drawn with ("" = whole screen)
registerHDPainter("d_smooth", (g, scr) => {
  if (!SMOOTH_ALL || !(scr.panels && scr.panels.length)) { if (SM) SM.valid = false; underPart = null; return false; }
  // a full-screen picture only where the view is a plain 2D menu or the 3D menu layers; over a court or in the other 3D views (where
  // the overlay lies on the 3D scene) just the panels' own rectangles, so the court / cards behind stay
  const part = !scr.canHide || onCourt(scr);
  const clip = part ? scr.panels.filter(p => p.layer === "bg").map(p => `${Math.max(0, p.x)},${Math.max(0, p.y)},${p.w},${p.h}`).join(";") : "";
  const fresh = scr.underFresh || underPart !== clip, ch = smoothScreen(scr.px32, fresh);
  if (!ch && !fresh) return true;
  scr.underChanged = true;
  if (!part) {                                                // the whole picture: only the part that changed is copied over
    const r = ch || { x: 0, y: 0, w: 640, h: 576 };
    g.drawImage(SM.cv, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
  } else {
    g.clearRect(0, 0, 640, 576); g.save(); g.beginPath(); for (const p of scr.panels) if (p.layer === "bg") g.rect(Math.max(0, p.x) * HD, Math.max(0, p.y) * HD, p.w * HD, p.h * HD); g.clip();
    g.drawImage(SM.cv, 0, 0); g.restore();
  }
  underPart = clip; return true;
}, { order: 1000, under: true });

// ---- stat gauges --------------------------------------------------------------------------------------------------------
// The skill page's gauges are rows of ten 3x4 pixel segments 4 px apart: black when empty, red / white when filled (the
// filled ones come first). They are found in the picture by that shape and redrawn as glossy HD segments.
const BLACK = 0xFF000000, RED = 0xFF0000F8, WHITE = 0xFFF8F8F8;
export function findGauges(scr) {
  const pk = scr.pixKey; if (scr._gk === pk && scr._gout) return scr._gout;        // the same picture: the same gauges
  const res = findGaugesIn(scr); scr._gk = pk; return scr._gout = res;
}
function findGaugesIn(scr) {
  const px = scr.px32, out = [], used = new Set();
  const blk = (x, y) => x >= 0 && y >= 0 && x < 160 && y < 144 && px[y * 160 + x] === BLACK;
  const block = (x, y) => {
    for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) if (!blk(x + i, y + j)) return false;
    for (let i = 0; i < 3; i++) if (blk(x + i, y - 1) || blk(x + i, y + 4)) return false;
    return !blk(x - 1, y) && !blk(x + 3, y) && !blk(x - 1, y + 3) && !blk(x + 3, y + 3);
  };
  const filled = (x, y) => {
    if (x < 0 || x + 3 > 160 || y < 1 || y + 4 > 144) return false;
    let n = 0; for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) { const c = px[(y + j) * 160 + x + i]; if (c === RED || c === WHITE) n++; }
    if (n < 2 || block(x, y)) return false;
    for (let i = 0; i < 3; i++) for (const yy of [y - 1, y + 4]) { const c = px[yy * 160 + x + i]; if (c === RED || c === WHITE || c === BLACK) return false; }   // exactly 4 rows tall
    for (const xx of [x - 1, x + 3]) for (let j = 0; j < 4; j++) { const c = px[(y + j) * 160 + xx]; if (c === RED || c === WHITE) return false; }       // with a gap each side
    return true;
  };
  for (let y = 1; y < 140; y++) for (let x = 0; x < 158; x++) {
    if (px[y * 160 + x] !== BLACK || px[y * 160 + x + 2] !== BLACK || px[(y + 3) * 160 + x] !== BLACK) continue;
    if (!block(x, y) || used.has(y * 160 + x)) continue;
    let x1 = x; while (block(x1 + 4, y)) x1 += 4;
    let x0 = x; while (filled(x0 - 4, y) && (x1 - x0) / 4 < 9) x0 -= 4;
    for (let k = x0; k <= x1; k += 4) used.add(y * 160 + k);
    const n = (x1 - x0) / 4 + 1; if (n < 4) continue;
    out.push({ x: x0, y, n, on: (x - x0) / 4 });      // `on` filled segments first, then the empty ones
  }
  for (let y = 1; y < 140; y++) for (let x = 0; x < 158; x++) {       // a gauge with every segment filled
    const c0 = px[y * 160 + x]; if (c0 !== RED && c0 !== WHITE && c0 !== BLACK) continue;
    if (used.has(y * 160 + x) || !filled(x, y)) continue;
    let k = 1; while (filled(x + 4 * k, y)) k++;
    if (k >= 8) { out.push({ x, y, n: k, on: k }); for (let m = 0; m < k; m++) used.add(y * 160 + x + 4 * m); x += 4 * k - 1; }
  }
  return out;
}
registerHDPainter("d_gauges", (g, scr, layer) => {
  if (layer !== "bg") return;
  for (const G of findGauges(scr)) {
    const w = G.n * 4 - 1, track = new Path2D();
    // the track: a dark slot the segments sit in
    g.save(); g.beginPath(); roundRect(g, G.x - 0.6, G.y - 0.55, w + 1.2, 5.1, 1.5); g.fillStyle = "rgba(40,10,0,0.55)"; g.fill(); g.restore();
    for (let k = 0; k < G.n; k++) {
      const x = G.x + k * 4, y = G.y, on = k < G.on;
      g.save(); g.beginPath(); roundRect(g, x - 0.05, y - 0.05, 3.1, 4.1, 0.9);
      const gr = g.createLinearGradient(0, y, 0, y + 4);
      if (on) { gr.addColorStop(0, "#ff7a60"); gr.addColorStop(0.45, "#f01800"); gr.addColorStop(1, "#a00000"); } else { gr.addColorStop(0, "#3a3a3e"); gr.addColorStop(1, "#08080a"); }
      g.fillStyle = gr; g.fill(); g.lineWidth = 0.3; g.strokeStyle = on ? "rgba(70,0,0,.9)" : "rgba(0,0,0,.9)"; g.stroke();
      g.clip(); g.fillStyle = on ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.16)"; g.fillRect(x, y + 0.2, 3, 1.1);
      g.restore();
    }
  }
}, { order: 55 });

// ---- sprites on menus ---------------------------------------------------------------------------------------------------
// Menu sprites (name tags, arrows, cursors, digits, icons) are drawn smoothed like the rest: all of them are composed into
// one picture (lower OAM index on top, sprites behind the background left out), smoothed with Scale2x twice and laid on
// the sprite canvas; the original sprites are hidden (2D only: the 3D view cannot leave sprites out). Not in a match.
const SMOOTH_SPRITES = true;
registerHDPainter("d_sprites", (g, scr, layer) => {
  if (!SMOOTH_SPRITES || layer !== "spr" || !scr.canHide || !(scr.panels && scr.panels.length) || onCourt(scr)) return;
  const sprs = scr.oam.filter(s => !(s.attr & 0x80) && !scr.hidden.has(s.i)); if (!sprs.length) return;
  const buf = new Uint32Array(160 * 144); let bx0 = 160, by0 = 144, bx1 = 0, by1 = 0;
  for (const s of [...sprs].reverse()) {
    const ci = s.ci, col = s.colors;
    for (let y = 0; y < s.h; y++) for (let x = 0; x < 8; x++) {
      const v = ci[y * 8 + x], X = s.x + x, Y = s.y + y; if (!v || X < 0 || X >= 160 || Y < 0 || Y >= 144) continue;
      const c = col[v]; buf[Y * 160 + X] = (0xFF000000 | c.b << 16 | c.g << 8 | c.r) >>> 0;
      if (X < bx0) bx0 = X; if (X + 1 > bx1) bx1 = X + 1; if (Y < by0) by0 = Y; if (Y + 1 > by1) by1 = Y + 1;
    }
  }
  if (bx1 <= bx0 || !scr.hide(sprs)) return;
  const r = smoothBox(buf, bx0, by0, bx1, by1);
  g.drawImage(r.cv, 0, 0, r.w * 4, r.h * 4, r.x, r.y, r.w, r.h);
}, { order: 50, sprites: true });

// ---- arrow buttons (MORE / BACK) ----------------------------------------------------------------------------------------
// The character data pages' MORE and BACK arrows are rows of 4-5 sprites (an arrow head, then a black label). They are
// found by the pixels of their sprites (hashes: a sprite's 64 colour indices are only kept as a hash) and redrawn as vector
// buttons: a red arrow head and a black label in HD text.
function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(16); }
const ARROWS = [
  { label: "MORE", dir: -1, hashes: ["6b1e32bf", "47f8f77", "e71adc60", "7ce14f5f", "97dd7b4d"] },
  { label: "MORE", dir: 1, hashes: ["b065f343", "45d0ff2", "b53785d7", "1518a3c9", "a69a1477"] },
  { label: "BACK", dir: -1, hashes: ["fe705bbe", "aa0f53f1", "d37ce998", "f9d058b9"] },
  { label: "BACK", dir: 1, hashes: ["2d048002", "a901c623", "42038994", "41b7ef93"] },
];
function findArrows(scr) {
  const out = [], hs = new Map(); for (const s of scr.oam) hs.set(s, s._h || (s._h = fnv(s.ci.join(""))));
  for (const def of ARROWS) for (const s0 of scr.oam) {
    if (hs.get(s0) !== def.hashes[0]) continue;
    const run = [s0]; let ok = true;
    for (let k = 1; k < def.hashes.length && ok; k++) { const n = scr.oam.find(s => s.y === s0.y && s.x === s0.x + 8 * k && hs.get(s) === def.hashes[k]); if (n) run.push(n); else ok = false; }
    if (ok) out.push({ ...def, sprites: run });
  }
  return out;
}
function arrowButton(g, scr, a) {
  let x0 = 999, y0 = 999, x1 = -1, y1 = -1;
  for (const s of a.sprites) for (let y = 0; y < s.h; y++) for (let x = 0; x < 8; x++) if (s.ci[y * 8 + x]) { x0 = Math.min(x0, s.x + x); x1 = Math.max(x1, s.x + x + 1); y0 = Math.min(y0, s.y + y); y1 = Math.max(y1, s.y + y + 1); }
  const w = x1 - x0, h = y1 - y0, ym = (y0 + y1) / 2, L = a.dir < 0, headW = 8, tipX = L ? x0 : x1, baseX = L ? x0 + headW : x1 - headW;
  const bx0 = L ? x0 + headW - 1 : x0, bx1 = L ? x1 : x1 - headW + 1, by0 = y0 + 2.3, by1 = y1 - 2.2;
  g.save();
  g.shadowColor = "rgba(0,0,0,0.45)"; g.shadowBlur = 2 * HD; g.shadowOffsetY = 1 * HD; g.fillStyle = "#000";
  g.beginPath(); g.moveTo(tipX, ym); g.lineTo(baseX, y0 + 0.3); g.lineTo(baseX, y1 - 0.3); g.closePath(); g.fill();
  g.beginPath(); roundRect(g, bx0, by0, bx1 - bx0, by1 - by0, 1.6); g.fill(); g.restore();
  // the arrow head: dark rim, white line, red body with a gloss
  const head = (inset, fill) => { g.beginPath(); const t = inset * 1.3; g.moveTo(tipX + (L ? t : -t), ym); g.lineTo(baseX + (L ? 0.3 : -0.3), y0 + 0.3 + inset); g.lineTo(baseX + (L ? 0.3 : -0.3), y1 - 0.3 - inset); g.closePath(); g.fillStyle = fill; g.fill(); };
  g.lineJoin = "round"; head(0, "#300"); head(0.7, "#fff");
  const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, "#ff5a40"); gr.addColorStop(0.5, "#f00000"); gr.addColorStop(1, "#a00000"); head(1.5, gr);
  // the label
  g.beginPath(); roundRect(g, bx0, by0, bx1 - bx0, by1 - by0, 1.6); g.fillStyle = "#fff"; g.fill();
  const lg = g.createLinearGradient(0, by0, 0, by1); lg.addColorStop(0, "#2c2c34"); lg.addColorStop(1, "#000");
  g.beginPath(); roundRect(g, bx0 + 0.6, by0 + 0.6, bx1 - bx0 - 1.2, by1 - by0 - 1.2, 1.1); g.fillStyle = lg; g.fill();
  const cx = (bx0 + bx1) / 2 + (L ? 0.6 : -0.6);
  if (!drawText(g, scr, a.label, cx, ym + 2.8, { size: 8.6, color: "#fff", shadow: "rgba(0,0,0,0.6)", align: "center", maxW: bx1 - bx0 - 3 })) {
    g.save(); g.font = "bold 7.4px sans-serif"; g.textAlign = "center"; g.fillStyle = "#fff"; g.fillText(a.label, cx, ym + 2.6); g.restore();
  }
}
registerHDPainter("d_arrows", (g, scr, layer) => {
  if (layer !== "spr" || !scr.canHide || !(scr.panels && scr.panels.length) || onCourt(scr)) return;
  for (const a of findArrows(scr)) if (scr.hide(a.sprites)) arrowButton(g, scr, a);
}, { order: 40, sprites: true });

// ---- icons ------------------------------------------------------------------------------------------------------------------
// The pictograms of the menu buttons (24x16 dark-green buttons with a white rim and black corner dots) redrawn as vectors in
// the game's style: black outline, white fill. Each draws around (0, 0) in a box of about 20 x 12 screen px; `bg` is the
// button's fill (for cut-outs).
function ink(g, path, fill = "#fff", lw = 1.5) {
  g.save(); g.beginPath(); path(g); g.lineJoin = "round"; g.lineCap = "round"; g.lineWidth = lw; g.strokeStyle = "#000"; g.stroke(); g.fillStyle = fill; g.fill(); g.restore();
}
const poly = pts => g => { g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); };
const circ = (x, y, r) => g => { g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2); };
const rrect = (x, y, w, h, r) => g => roundRect(g, x, y, w, h, r);
function line(g, pts, w = 1, col = "#000") { g.save(); g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.lineWidth = w; g.strokeStyle = col; g.lineCap = "round"; g.lineJoin = "round"; g.stroke(); g.restore(); }
function star5(g, cx, cy, R, r) { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, d = i % 2 ? r : R; g[i ? "lineTo" : "moveTo"](cx + Math.cos(a) * d, cy + Math.sin(a) * d); } g.closePath(); }
const dot = (g, x, y, r, col = "#000") => { g.save(); g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.restore(); };
const bar = (g, x, y, w, h, col = "#000") => { g.save(); g.fillStyle = col; g.fillRect(x, y, w, h); g.restore(); };
function ellipse(x, y, rx, ry, rot = 0) { return g => { g.moveTo(x + rx, y); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); }; }
function book(g, bg) {
  ink(g, poly([[-9, -4.2], [-0.4, -3], [-0.4, 4.6], [-9, 3.4]]), "#fff", 1.3); ink(g, poly([[0.4, -3], [9, -4.2], [9, 3.4], [0.4, 4.6]]), "#fff", 1.3);
  for (let k = 0; k < 3; k++) { line(g, [[1.8, -1.6 + k * 1.9], [7.2, -2.3 + k * 1.9]], 0.7); line(g, [[-7, -1.8 + k * 1.9], [-2.2, -1.2 + k * 1.9]], 0.7); }
  line(g, [[-6.4, 3.8], [-8.6, 5.8]], 1.7); ink(g, circ(-5.2, 1.6, 2.3), bg, 1.1); dot(g, -5.9, 0.9, 0.45, "#fff");
}
const ICONS = {
  wrench(g, bg) {
    ink(g, rrect(-5.5, -1.6, 11, 3.2, 1.5)); ink(g, circ(6.6, 0, 3.5)); ink(g, circ(-6.6, 0, 3.5));
    g.save(); g.fillStyle = bg; g.beginPath(); g.moveTo(-10.4, -1.3); g.lineTo(-6.7, -1.3); g.lineTo(-6.7, 1.3); g.lineTo(-10.4, 1.3); g.closePath(); g.fill(); g.restore();
    line(g, [[-10, -1.4], [-6.7, -1.4], [-6.7, 1.4], [-10, 1.4]], 0.9); ink(g, circ(6.6, 0, 1.3), bg, 0.9);
  },
  door(g, bg) {
    ink(g, poly([[-7, -5.5], [3.5, -5.5], [3.5, 4.8], [-7, 4.8]]), bg, 1.2);
    ink(g, poly([[-6.4, -5], [-1.4, -3.6], [-1.4, 5.6], [-6.4, 4.8]]), "#000", 0.6); dot(g, -2.6, 0.5, 0.45, "#fff");
    ink(g, poly([[1.6, 4.8], [9.5, 4.8], [10, 6], [0.4, 6]]), "#fff", 0.9); line(g, [[-9.5, 5.4], [9.8, 5.4]], 1.3);
  },
  bulbOn(g, bg) {
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + Math.PI / 8, ca = Math.cos(a), sa = Math.sin(a); line(g, [[ca * 5.8, sa * 4.9 - 1], [ca * 8.8, sa * 6.4 - 1]], 0.9, "#fff"); }
    ink(g, circ(0, -1.2, 3.9), "#fff", 1.4); ink(g, rrect(-1.9, 2.5, 3.8, 3, 0.8), "#fff", 1.2); line(g, [[-1.9, 4], [1.9, 4]], 0.6);
  },
  bulbOff(g, bg) {
    ink(g, circ(0, -1.2, 3.9), bg, 1.4); line(g, [[-1.6, -2.6], [-0.4, -3.4]], 0.8, "#fff");
    ink(g, rrect(-1.9, 2.5, 3.8, 3, 0.8), "#fff", 1.2); line(g, [[-1.9, 4], [1.9, 4]], 0.6);
  },
  grid(g, bg) {
    ink(g, rrect(-8.5, -5.5, 17, 11, 0.8), "#fff", 1.5);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) bar(g, -7 + c * 4.9, -4.3 + r * 2.4, 4, 1.4);
    for (let c = 0; c < 2; c++) bar(g, -7 + c * 8.5, 3, 7.3, 0.9);
  },
  hand(g, bg) {
    const fing = (x, y1) => ink(g, rrect(x, y1, 2.2, 1 - y1, 1.1), "#fff", 1.3);
    fing(-5.5, -4.5); fing(-3, -6); fing(-0.5, -6.3); fing(2, -5.5);
    ink(g, poly([[-6, 0], [-6, 3], [-3.5, 6], [3, 6], [4, 2], [7.5, -1], [6, -2.5], [3, 0], [3, -3], [-6, -3]]), "#fff", 1.4);
    for (const x of [-3.2, -0.7, 1.8]) line(g, [[x + 1.1, -3], [x + 1.1, 0.5]], 0.5);
  },
  clip(g, bg) {
    ink(g, rrect(-6.5, -5, 13, 10.5, 1), "#fff", 1.5); ink(g, rrect(-2.8, -6.2, 5.6, 2.8, 1), "#fff", 1.2);
    for (let i = 0; i < 3; i++) bar(g, -4.5, -1.3 + i * 2.3, 9, 1.1);
  },
  star(g, bg) { ink(g, g2 => star5(g2, 0, 0.3, 7.4, 3.1), "#fff", 1.5); bar(g, -1.8, -0.6, 0.9, 1.5); bar(g, 0.9, -0.6, 0.9, 1.5); },
  finger(g, bg) {
    ink(g, rrect(-1.3, -6.3, 2.6, 8, 1.3), "#fff", 1.4);
    ink(g, rrect(-5, 0.2, 10, 6, 2.4), "#fff", 1.4); ink(g, rrect(-6.2, 1.2, 3, 2.6, 1.3), "#fff", 1.2);
    line(g, [[-1.6, 2.6], [1.6, 2.6]], 0.5); line(g, [[-1.6, 4.2], [1.6, 4.2]], 0.5);
  },
  flag(g, bg) {
    line(g, [[-6.5, 5.5], [-3.5, -5.5]], 1.9, "#000"); line(g, [[-6.5, 5.5], [-3.5, -5.5]], 0.7, "#fff");
    ink(g, g2 => { g2.moveTo(-3.3, -5.2); g2.quadraticCurveTo(0, -3.6, 2.5, -5.2); g2.quadraticCurveTo(4.5, -6, 6.8, -4.6); g2.lineTo(5.6, 0.2); g2.quadraticCurveTo(3, -1.2, 0.5, 0.4); g2.quadraticCurveTo(-1.6, 1.4, -2.4, -0.4); g2.closePath(); }, "#fff", 1.3);
    dot(g, 1.6, -2.6, 1.1, bg);
  },
  book(g, bg) { book(g, bg); },
  book2(g, bg) { g.scale(-1, 1); book(g, bg); },
  gamepad(g, bg) {
    ink(g, rrect(-5, -5.6, 10, 2.6, 0.8), "#000", 0.6);
    ink(g, rrect(-8.6, -3.2, 17.2, 9, 3.6), "#fff", 1.4); ink(g, rrect(-4.6, -2, 9.2, 5.2, 1), bg, 0.8);
    bar(g, -7, 0.6, 3.6, 1.2); bar(g, -5.8, -0.6, 1.2, 3.6); dot(g, 5.4, 0.2, 0.9); dot(g, 3.4, 2.2, 0.9);
    for (let k = 0; k < 3; k++) for (let m = 0; m < 3; m++) if ((k + m) % 2 === 0) bar(g, -2 + m * 1.2, -1 + k * 1.2, 1, 1, "#fff");
  },
  camera(g, bg) {
    line(g, [[-1, 2], [-4.5, 5.6]], 1.4); line(g, [[1, 2], [4.5, 5.6]], 1.4); line(g, [[0, 2], [0, 5.6]], 1.4);
    ink(g, circ(-5.2, -4.2, 1.9), "#fff", 1.1); ink(g, circ(-1.2, -4.8, 1.5), "#fff", 1.1);
    ink(g, rrect(-8, -3.2, 10, 5.8, 1), "#fff", 1.4); ink(g, poly([[2, -1.2], [6.5, -3.4], [6.5, 1.6], [2, 0.4]]), "#fff", 1.3); ink(g, rrect(-6, -2, 6, 3.4, 0.6), bg, 0.8);
  },
  note(g, bg) {
    for (let k = 0; k < 4; k++) line(g, [[-9, -4.4 + k * 2.9], [9, -4.4 + k * 2.9]], 0.7, "#fff");
    ink(g, ellipse(-4.2, 3.2, 2.5, 1.9, -0.4), "#fff", 1.2); ink(g, ellipse(3, 1.6, 2.5, 1.9, -0.4), "#fff", 1.2);
    line(g, [[-2.1, 2.7], [-2.1, -4.8], [5, -6]], 1.3); line(g, [[-2.1, 2.7], [-2.1, -4.8], [5, -6], [5, 1]], 0.7, "#fff");
    ink(g, poly([[-2.1, -4.8], [5.1, -6.2], [5.1, -3.6], [-2.1, -2.2]]), "#000", 0.5);
  },
  figureCard(g, bg) {
    ink(g, circ(-5, -3.8, 1.9), "#fff", 1.2);
    ink(g, poly([[-7.4, -1.6], [-2.6, -1.6], [-2, 1.2], [-3.2, 1.4], [-3.3, 5.6], [-4.7, 5.6], [-5, 2.4], [-5.3, 5.6], [-6.7, 5.6], [-6.8, 1.4], [-8, 1.2]]), "#fff", 1.2);
    ink(g, rrect(1, -5.2, 7.5, 10.4, 1.2), "#fff", 1.3); for (let r = 0; r < 4; r++) { bar(g, 2.4, -3.6 + r * 2.2, 2, 1.2); bar(g, 5.2, -3.6 + r * 2.2, 2, 1.2); }
  },
  racketShoe(g, bg) {
    line(g, [[-5.6, 3], [-5.6, 5.8]], 1.8); ink(g, ellipse(-5.6, -1.4, 3.3, 4.2), "#fff", 1.3); line(g, [[-8, -1.4], [-3.2, -1.4]], 0.5); line(g, [[-5.6, -4.4], [-5.6, 1.6]], 0.5);
    ink(g, poly([[0, -1], [4, -1], [4.8, 1.6], [9.2, 2.8], [9.2, 5], [0, 5]]), "#fff", 1.3); line(g, [[1, 3], [8, 3]], 0.7);
  },
  cardFace(g, bg) {
    ink(g, rrect(-8.5, -5.2, 7.5, 10.4, 1.2), "#fff", 1.3); for (let r = 0; r < 4; r++) { bar(g, -7.1, -3.6 + r * 2.2, 2, 1.2); bar(g, -4.3, -3.6 + r * 2.2, 2, 1.2); }
    ink(g, circ(4.8, -0.4, 3.6), "#fff", 1.3); ink(g, rrect(2, 3.2, 5.6, 2.4, 1), "#fff", 1.2); dot(g, 3.6, -1.2, 0.55); dot(g, 6, -1.2, 0.55); line(g, [[3.6, 1.2], [6, 1.2]], 0.6);
  },
  turtle(g, bg) {
    ink(g, g2 => { g2.moveTo(-5, 3); g2.bezierCurveTo(-5, -5, 6, -5, 6, 3); g2.closePath(); }, "#fff", 1.4);
    ink(g, ellipse(-7.4, 1.6, 2, 1.4), "#000", 0.6); line(g, [[-5, 3.6], [-6.4, 5.4]], 1.4); line(g, [[5.5, 3.6], [6.8, 5.4]], 1.4); line(g, [[6.2, 2.6], [9, 3.8]], 1.3);
    line(g, [[-2.4, 2], [-1.6, -1.2], [2, -1.4], [3.2, 2]], 0.6); line(g, [[0, -3.2], [0, 2.8]], 0.5);
  },
  rabbit(g, bg) {
    ink(g, ellipse(-1.8, -4.4, 1.1, 3.3, -0.15), "#fff", 1.1); ink(g, ellipse(0.8, -4.2, 1.1, 3.1, 0.15), "#fff", 1.1);
    ink(g, ellipse(1.4, 3.2, 5.2, 3.2), "#fff", 1.3); ink(g, circ(-0.6, -0.4, 2.7), "#fff", 1.3); ink(g, circ(6.8, 3.4, 1.4), "#fff", 1.1); dot(g, -1.4, -0.8, 0.5);
  },
  cheetah(g, bg) {
    ink(g, ellipse(0, -0.5, 5.8, 2.2), "#fff", 1.3); ink(g, circ(-6.6, -2, 2), "#fff", 1.2);
    line(g, [[-3, 1], [-7, 5], [-9.2, 4.6]], 1.7); line(g, [[-2, 1.2], [-4.4, 5.4]], 1.7); line(g, [[3.6, 1], [7.4, 4.6], [9.8, 4]], 1.7); line(g, [[4.5, 0.4], [9, 0.6]], 1.4);
    line(g, [[5.4, -1.6], [8.5, -4.2]], 1.4); dot(g, -2, -1.4, 0.45); dot(g, 1.4, 0.4, 0.45);
  },
  runner(g, bg) {
    for (let k = 0; k < 3; k++) line(g, [[4 + k * 0.6, -4 + k * 3.4], [9.2, -4 + k * 3.4]], 0.9, "#fff");
    g.save(); g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#000"; g.fillStyle = "#000"; g.lineWidth = 1.9;
    g.beginPath(); g.moveTo(0.5, -2.4); g.lineTo(-1.4, 1.2); g.lineTo(-4, 2.8); g.lineTo(-6.6, 1.8); g.moveTo(-1.4, 1.2); g.lineTo(0.8, 3.4); g.lineTo(1.2, 5.6);
    g.moveTo(0.4, -2.2); g.lineTo(3.4, -0.6); g.lineTo(5, -2.4); g.moveTo(0.2, -2); g.lineTo(-3.4, -1); g.lineTo(-4.4, 0.6); g.stroke();
    g.beginPath(); g.arc(2.2, -4.4, 1.6, 0, 7); g.fill(); g.restore();
    g.save(); g.lineCap = "round"; g.strokeStyle = "#fff"; g.lineWidth = 0.5; g.beginPath(); g.moveTo(0.5, -2.4); g.lineTo(-1.4, 1.2); g.stroke(); g.restore();
  },
};
export const ICON_NAMES = Object.keys(ICONS);
export function drawIcon(g, name, cx, cy, bg = "rgb(0,144,56)") {
  const f = ICONS[name]; if (!f) return false;
  g.save(); g.translate(cx, cy); g.scale(0.9, 0.9); f(g, bg); g.restore(); return true;
}

// the buttons are found in the picture (a white outline with black corner dots, 24 x 16) and told apart by the shape of their
// content (black / white / other, hashed): the pictogram is drawn as a vector on a rebuilt HD button
const ICON_HASH = { "5845648f": "book", "978f7826": "wrench", cf4e98d2: "door", a98f4d4d: "camera", "9d4469a": "note", f2f835f1: "bulbOn", f14c7b15: "bulbOff",
  "2e93b86b": "book2", "698e7111": "grid", "89f7e76d": "hand", "9670bfd0": "clip", ee117f66: "star", "98efb280": "figureCard", "1b8e4fba": "racketShoe",
  "6a632fb4": "cardFace", be0d4315: "turtle", ba036169: "rabbit", db11b6c: "cheetah", "9bf8355a": "finger", fd438963: "flag", "2e9260f1": "runner", d1b5607d: "gamepad" };
const BLK = 0xFF000000, WHT = 0xFFF8F8F8;
export function findButtons(scr) {
  const px = scr.px32, res = [];
  for (let y = 0; y < 140; y++) for (let x = 0; x < 150; x++) {
    if (px[y * 160 + x] !== BLK || px[y * 160 + x + 1] !== WHT || px[(y + 1) * 160 + x] !== WHT) continue;
    let w = 1; while (x + w < 160 && px[y * 160 + x + w] === WHT) w++; if (x + w >= 160 || px[y * 160 + x + w] !== BLK) continue;
    let h = 1; while (y + h < 144 && px[(y + h) * 160 + x] === WHT) h++; if (y + h >= 144 || px[(y + h) * 160 + x] !== BLK) continue;
    if (w !== 23 || h !== 15) continue;
    let bad = 0; for (let i = 1; i < w; i++) if (px[(y + h) * 160 + x + i] !== WHT) bad++; for (let j = 1; j < h; j++) if (px[(y + j) * 160 + x + w] !== WHT) bad++;
    if (bad > 16) continue;
    let sgn = "", fill = 0; const hist = new Map();
    for (let yy = y + 1; yy < y + h; yy++) for (let xx = x + 1; xx < x + w; xx++) { const c = px[yy * 160 + xx]; sgn += c === BLK ? "k" : c === WHT ? "w" : "."; if (c !== BLK && c !== WHT) hist.set(c, (hist.get(c) || 0) + 1); }
    let best = 0; for (const [c, n] of hist) if (n > best) { best = n; fill = c; }
    const name = ICON_HASH[fnv(24 + "x" + 16 + sgn)];
    res.push({ x, y, w: w + 1, h: h + 1, name, fill, hash: fnv(24 + "x" + 16 + sgn) });
  }
  return res;
}
registerHDPainter("d_buttons", (g, scr, layer) => {
  if (layer !== "bg") return;
  for (const b of findButtons(scr)) {
    if (!b.name) continue;
    const c = { r: b.fill & 255, g: b.fill >> 8 & 255, b: b.fill >> 16 & 255 }, css = `rgb(${c.r},${c.g},${c.b})`;
    panelFrame(g, b.x, b.y, b.w, b.h, { fill: css, rim: "#000", border: "#fff", radius: 2.2, shadow: false, sheen: 0.18 });
    markOpaque(scr, b.x + 2, b.y + 2, b.w - 4, b.h - 4, css);
    drawIcon(g, b.name, b.x + b.w / 2, b.y + b.h / 2, css);
  }
}, { order: 30 });

// ---- the corner tabs of the skill page ----------------------------------------------------------------------------------
// Each skill panel has a red tab in its top-left corner (a band with the name, and a triangle below it with the big
// digit), drawn over the panel's white inner line with stair-stepped diagonals. The diagonals are redrawn as straight
// edges (through the outer corners of the steps); the name and the digit stay, smoothed, on top.
registerHDPainter("d_tabs", (g, scr, layer) => {
  if (layer !== "bg") return;
  const px = scr.px32, tm = scr.textMask;
  for (const p of scr.panels || []) {
    if (p.layer !== "bg" || p.h < 30) continue;
    const x0 = p.x + 1, y0 = p.y + 1, xmax = Math.min(159, p.x + p.w - 3), ext = [];
    const f = p.fill, isFill = c => Math.abs((c & 255) - f.r) <= 12 && Math.abs((c >> 8 & 255) - f.g) <= 12 && Math.abs((c >> 16 & 255) - f.b) <= 12;
    for (let r = 0; r < Math.min(34, p.h - 4); r++) {
      let last = -1, gap = 0;
      for (let x = x0; x <= xmax; x++) { const c = px[(y0 + r) * 160 + x]; if (c === RED) { last = x; gap = 0; } else if (isFill(c)) { if (++gap >= 3) break; } }
      if (last < x0) break; ext.push(last);
    }
    if (ext.length < 8 || ext[0] < x0 + 8 || px[(y0 + 1) * 160 + x0] !== RED) continue;
    const runs = []; let s = 0;
    for (let r = 1; r <= ext.length; r++) if (r === ext.length || ext[r] - ext[r - 1] < -3) { runs.push([s, r - 1]); s = r; }
    const pts = [[x0, y0]];
    for (const [a, b] of runs) { pts.push([ext[a] + 1, y0 + a]); pts.push([ext[b], y0 + b + 1]); }
    pts.push([x0, y0 + ext.length]);
    g.save();
    g.beginPath(); roundRect(g, p.x + 1, p.y + 1, p.w - 2, p.h - 2, 1.8); g.clip();
    const gr = g.createLinearGradient(x0, y0, x0, y0 + ext.length); gr.addColorStop(0, "#ff4a30"); gr.addColorStop(0.5, "#f80000"); gr.addColorStop(1, "#c80000");
    g.beginPath(); pts.forEach((q, i) => g[i ? "lineTo" : "moveTo"](q[0], q[1])); g.closePath(); g.fillStyle = gr; g.fill();
    // the name and the digit: the picture's pixels that are neither red nor panel fill nor text, smoothed
    const bx1 = Math.max(...pts.map(q => q[0])) | 0, w = Math.min(160, bx1 + 2) - x0, h = ext.length;
    const buf = new Uint32Array(160 * 144); let any = false;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const c = px[y * 160 + x]; if (c === RED || isFill(c) || tm[y * 160 + x]) continue; if (x > ext[y - y0] + 1) continue; buf[y * 160 + x] = c; any = true; }
    if (any) g.drawImage(smoothTabs(buf), 0, 0, 160, 144);
    g.restore();
  }
}, { order: 31 });
const smoothTabs = makeSmoother();
