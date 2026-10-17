// HD painters for agent D: character data / EXP screens, court select, minigame menus, icons, and the menu (UI) font.
// Use the API in web/js/hdui.js (usage note at its top): registerHDPainter(name, (g, scr, layer) => {...}, { order }).
import { registerHDPainter, drawText, shade } from "../hdui.js";

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
  if (bg < cells.length * 64 * 0.5) return;                // text sits on a plain (colour 1) ground
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
        const [a, b] = runs[k], gl = splitRun(P, cols, a, b);
        if (!gl) { ok = false; _dbg.unmatched.push({ x: cells[0].x + a, y: st.y, cols: Array.from(cols.slice(a, b)) }); break; }
        for (const g of gl) {
          const prev = items.length ? items[items.length - 1] : null;
          if (prev && prev.ch !== " " && g.a - prev.b >= ws - 1) items.push({ ch: " ", a: prev.b, b: g.a });
          items.push(g); if (g.exact) exact = true;
        }
      }
      if (ok && exact && items.length) {
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
export const _dbg = { propFont, strips, unmatched: [] };

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
    // lines of an 8 px list sit close: a smaller size
    let gap = 16; for (const o of lines) if (o !== l && o.x < l.x + l.w && l.x < o.x + o.w && o.y !== l.y) gap = Math.min(gap, Math.abs(o.y - l.y));
    const size = f.em * Math.min(1, Math.max(0.7, gap / 14));
    let covered = true; for (let y = Math.max(0, l.y); y < Math.min(144, l.y + 8) && covered; y++) for (let x = Math.max(0, l.x); x < Math.min(160, l.x + l.w + 1); x++) if (!scr.opaque[y * 160 + x]) { covered = false; break; }
    if (!covered) { g.fillStyle = l.c[0]; g.fillRect(l.x, l.y, l.w + 1, 8); }
    const digits = /^[0-9 ]+$/.test(l.text);
    drawText(g, scr, l.text, digits ? l.x + l.w : l.x, l.y + f.base, { size, color: l.c[2], shadow: shade(l.c[1], 1), maxW: l.w + 2.5, align: digits ? "right" : "left" });
  }
}, { order: 60 });

// ---- smoothing --------------------------------------------------------------------------------------------------------
// Scale2x (EPX) twice: the picture's own pixels at 4x with the stair-steps of diagonals and corners rounded off
function scale2x(src, w, h) {
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
// the rectangle (x, y, w, h) of the 160x144 picture (0xAABBGGRR) smoothed 4x as a canvas
export function smooth4(px, x, y, w, h) {
  const a = new Uint32Array(w * h);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) a[yy * w + xx] = px[(y + yy) * 160 + x + xx];
  const b = scale2x(scale2x(a, w, h), w * 2, h * 2), c = document.createElement("canvas"); c.width = w * 4; c.height = h * 4;
  const g = c.getContext("2d"), id = g.createImageData(w * 4, h * 4); new Uint32Array(id.data.buffer).set(b); g.putImageData(id, 0, 0);
  return c;
}
// The smoothed picture goes UNDER everything the other painters drew: the frames painter cuts the original's ink
// (portraits, icons, bars) out of its fills so "the picture shows through", and what shows through is then the smoothed
// picture, not the plain 4x one. Only on screens that have HD panels (menus), never in a match. (Done with plain
// source-over drawing on a copy: "destination-over" on the page's accelerated canvas left old pixels behind.)
const SMOOTH_ALL = true;
let under = null;
registerHDPainter("d_smooth", (g, scr, layer) => {
  if (!SMOOTH_ALL || layer !== "bg" || !(scr.panels && scr.panels.length)) return;
  const cv = g.canvas; if (!under || under.width !== cv.width || under.height !== cv.height) { under = document.createElement("canvas"); under.width = cv.width; under.height = cv.height; }
  const u = under.getContext("2d"); u.setTransform(1, 0, 0, 1, 0, 0); u.clearRect(0, 0, under.width, under.height);
  u.drawImage(smooth4(scr.px32, 0, 0, 160, 144), 0, 0, under.width, under.height);   // the smoothed picture...
  u.drawImage(cv, 0, 0);                                                              // ...with what the painters drew on it
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); g.drawImage(under, 0, 0); g.restore();
}, { order: 1000 });
