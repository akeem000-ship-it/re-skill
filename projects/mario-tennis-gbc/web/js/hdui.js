// HD UI: the game's menus and windows redrawn as clean 4x art on the same overlay canvases the HD text uses
// (web/js/hdtext.js owns them: one for the background layer, one for the window layer, each 640x576, drawn over the
// picture by full.js in 2D and by web/js/voxel.js in 3D/VOX, so everything painted here shows in all views).
//
// ===================================================================================================================
// USAGE NOTE for painters (title screen, pause menus, results, char data, ... each in its own file, see HDMENU_MODULES)
//
//   import { registerHDPainter, panelFrame, roundRect, drawText, punchInk, shade, mix } from "../hdui.js";
//   registerHDPainter("pause", (g, scr, layer) => { ... }, { order: 50, watch: scr => "extra repaint key" });
//
//  * A painter is called whenever what is on screen changed (never every frame): once per layer ("bg" then "win"),
//    AFTER the built-in frame/box art, in `order` (default 100, ascending). `g` is the 2D context of that layer's 4x
//    canvas, ALREADY SCALED so you draw in Game Boy SCREEN PIXELS (0..160, 0..144; fractions are fine, so 1 unit = 4
//    canvas pixels). The canvas is transparent: whatever you leave alone shows the original picture; whatever you
//    paint covers it. Do not draw outside your own business, and do not keep state between calls (the canvas was
//    cleared). Exceptions in a painter are caught and logged once; the others still run.
//  * `scr` is a snapshot of the screen (see class Screen): scr.cells[layer] (every visible tile with its screen
//    position, tile id, attribute, palette, colour-index rows and palette colours), scr.at(layer,x,y), scr.find(...),
//    scr.px(x,y) (BG-only pixel colour), scr.lines (text lines read off the screen, when an HD font is on), scr.regs
//    (lcdc, scx, scy, wx, wy), scr.oam (sprites: {i, x, y, tile, attr, h, ci, rows, colors}; scr.hide(sprites, g, layer) replaces them), scr.font ({family, em, base} of the chosen HD font, or null when
//    the game's own font is selected: then leave text alone).
//  * Identify things by TILE CONTENT, not tile numbers: cell.rows is 8 strings of colour indices ("0".."3"), e.g.
//    cell.match(["22222222","22333333", ...]) or cell.sig; cell.colors[i] is the palette colour of index i as
//    {r,g,b,css}. Derive shapes at runtime; never copy ROM graphics into the repo.
//  * scr.claim(x, y, w, h) (from a painter with order < 0) keeps the built-in art out of a region (scr.claim(0,0,160,144): the whole screen).
//  * Helpers: panelFrame / panelShadow (rounded bevel panel in the shared look), roundRect, drawText (HD text with the game's soft
//    shadow, in the chosen font), punchInk (cut the original's non-fill pixels back out of what you painted so
//    icons / digits / portraits inside your panel stay), shade / mix / rgbCss (colours), markOpaque (say which pixels your fill covers, and with what colour).
//  * Whether the setting is on is not your business: painters only run when "UI: HD" is on. Sprites (cursors, balls)
//    are not on these canvases; in 2D they are redrawn over the HD art, in 3D they are cards in front of it. To replace
//    sprites with art of your own register with { sprites: true } (see registerHDPainter and hdui_cursors.js).
//  * Be cheap: everything repaints when any tile / palette / position on screen changes (every frame while the court
//    scrolls), so return at once when it is not your screen. painterStats() tells the ms spent per painter.
//  * To test: full.html?ui=hd&font=itim (or game); node web/tests/page_smoke.mjs; see the shot scripts in the
//    session scratchpad (hdui/shot.mjs: REC.mtrec frames outprefix, env UI FONT MODE VW VH DSF TOUCH).
// ===================================================================================================================
export const HD = 4;                                  // canvas pixels per screen pixel
export const HDMENU_MODULES = ["./hdmenus/title.js", "./hdmenus/pause.js", "./hdmenus/data.js"];   // agents B, C, D

const painters = [];
// fn(g, scr, layer): see the usage note. `order`: lower runs first (the built-in frame art is at 0).
// watch(scr) -> string (optional): anything else your art depends on (a sprite's frame, a counter in RAM): it is added to the
// repaint key, so the painters run again when that string changes.
// under: true makes it the UNDER painter (one at most): fn(g, scr, "under") is called once per full repaint, after the others, with the
// context of the picture canvas that lies UNDER the bg / win art (in canvas pixels, NOT scaled: 640x576) and that is NOT cleared
// between repaints: keep its content up to date yourself (scr.underFresh is true when it was just emptied, so draw everything).
// Return true if there is something to show (false empties it), and set scr.underChanged = true when you changed it (the 3D view
// uploads its texture only then). The holes the frame art cuts in its fills show this picture.
// sprites: true makes it a SPRITE painter: called as fn(g, scr, "spr") where g is the sprite canvas (drawn over the sprites in 2D),
// and again whenever any sprite moved or changed (cheaply: nothing else is repainted), so keep it quick; it replaces sprites
// with scr.hide(sprs) and draws its own art on g (HD units).
export function registerHDPainter(name, fn, { order = 100, watch = null, sprites = false, under = false } = {}) {
  const at = painters.findIndex(p => p.name === name);
  const p = { name, fn, order, watch, sprites, under, failed: false };
  if (at >= 0) painters[at] = p; else painters.push(p);
  painters.sort((a, b) => a.order - b.order);
  for (const l of listeners) l();
}
const listeners = new Set();
export const onPainterChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

// ---- colours ----------------------------------------------------------------------------------------------------
export const rgbCss = (r, g, b, a = 1) => a >= 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a})`;
const toRGB = c => Array.isArray(c) ? c : c && c.r !== undefined ? [c.r, c.g, c.b] : (m => m ? [+m[1], +m[2], +m[3]] : [128, 128, 128])(/(\d+)\D+(\d+)\D+(\d+)/.exec(c));
// a colour (css string, [r,g,b] or {r,g,b}) darker (k < 1) or lighter (k > 1; mixed towards white), as css
export function shade(c, k, a = 1) {
  const [r, g, b] = toRGB(c);
  return k <= 1 ? rgbCss(r * k, g * k, b * k, a) : rgbCss(r + (255 - r) * (k - 1), g + (255 - g) * (k - 1), b + (255 - b) * (k - 1), a);
}
export function mix(c1, c2, t, a = 1) { const A = toRGB(c1), B = toRGB(c2); return rgbCss(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t, a); }
const col15 = c => ({ r: (c & 31) * 8, g: (c >> 5 & 31) * 8, b: (c >> 10 & 31) * 8, c15: c, css: `rgb(${(c & 31) * 8},${(c >> 5 & 31) * 8},${(c >> 10 & 31) * 8})` });

// ---- drawing helpers (g in screen pixels) ---------------------------------------------------------------------------
export function roundRect(g, x, y, w, h, r) {            // path (does not fill); r: one radius or [tl, tr, br, bl]
  const m = Math.min(w, h) / 2, R = (Array.isArray(r) ? r : [r, r, r, r]).map(v => Math.max(0, Math.min(v, m)));
  g.moveTo(x + R[0], y); g.lineTo(x + w - R[1], y); if (R[1]) g.arcTo(x + w, y, x + w, y + R[1], R[1]); else g.lineTo(x + w, y);
  g.lineTo(x + w, y + h - R[2]); if (R[2]) g.arcTo(x + w, y + h, x + w - R[2], y + h, R[2]); else g.lineTo(x + w, y + h);
  g.lineTo(x + R[3], y + h); if (R[3]) g.arcTo(x, y + h, x, y + h - R[3], R[3]); else g.lineTo(x, y + h);
  g.lineTo(x, y + R[0]); if (R[0]) g.arcTo(x, y, x + R[0], y, R[0]); else g.lineTo(x, y);
  g.closePath();
}
const inner = (r, d) => Array.isArray(r) ? r.map(v => Math.max(0, v - d)) : Math.max(0, r - d);
// the soft drop shadow of a panel (only the halo outside the panel stays; call before painting the panel). radius as roundRect
const shadowCache = new Map();
export function panelShadow(g, x, y, w, h, radius = 2.2, o = {}) {
  // a blurred shadow is costly to rasterise on a phone: built once per size / look and then only blitted
  const blur = o.blur ?? 2.4, dx = o.dx ?? 0.9, dy = o.dy ?? 1.5, color = o.color || "rgba(0,0,0,0.42)";
  const key = `${w}|${h}|${Array.isArray(radius) ? radius.join(",") : radius}|${blur}|${dx}|${dy}|${color}`;
  const M = Math.ceil((blur + Math.max(Math.abs(dx), Math.abs(dy))) * 1.2) + 2;
  let cv = shadowCache.get(key);
  if (!cv) {
    cv = document.createElement("canvas"); cv.width = Math.ceil((w + 2 * M) * HD); cv.height = Math.ceil((h + 2 * M) * HD);
    const c = cv.getContext("2d"); c.setTransform(HD, 0, 0, HD, 0, 0);
    c.save(); c.shadowColor = color; c.shadowBlur = blur * HD; c.shadowOffsetX = dx * HD; c.shadowOffsetY = dy * HD;   // shadow offsets are in canvas pixels, not scaled
    c.fillStyle = "#000"; c.beginPath(); roundRect(c, M, M, w, h, radius); c.fill(); c.restore();
    c.save(); c.globalCompositeOperation = "destination-out"; c.beginPath(); roundRect(c, M, M, w, h, radius); c.fill(); c.restore();   // the halo only
    if (shadowCache.size > 80) shadowCache.clear();
    shadowCache.set(key, cv);
  }
  g.drawImage(cv, x - M, y - M, w + 2 * M, h + 2 * M);
}
// The shared panel look (the reference mock-up): a darker rim, a white inner border, the fill with a soft sheen on its
// top half, and a soft drop shadow. (x, y, w, h) is the OUTER rectangle in screen pixels. Options:
//   fill (css, required)  rim (default: fill darkened)  border (white-ish)  radius (screen px, default 2.4; or [tl,tr,br,bl])
//   rimW / borderW (screen px: 1 / 1)  shadow (true: soft shadow; false: none -> see panelShadow)  sheen (0..1, default 0.22)
//   inset: false paints only the rim+border ring and leaves the inside transparent (the picture / text shows through)
// Returns the inner rectangle {x, y, w, h, r}.
export function panelFrame(g, x, y, w, h, o = {}) {
  const fill = o.fill || "rgb(248,80,0)", rad = o.radius ?? 2.4, rimW = o.rimW ?? 1, bw = o.borderW ?? 1, rim = o.rim || shade(fill, 0.5), border = o.border || "rgb(252,252,244)";
  if (o.shadow !== false) panelShadow(g, x, y, w, h, rad);
  g.save();
  g.fillStyle = rim; g.beginPath(); roundRect(g, x, y, w, h, rad); g.fill();
  g.fillStyle = border; g.beginPath(); roundRect(g, x + rimW, y + rimW, w - 2 * rimW, h - 2 * rimW, inner(rad, rimW * 0.6)); g.fill();
  const ix = x + rimW + bw, iy = y + rimW + bw, iw = w - 2 * (rimW + bw), ih = h - 2 * (rimW + bw), ir = inner(rad, (rimW + bw) * 0.7);
  if (o.inset === false) { g.globalCompositeOperation = "destination-out"; g.beginPath(); roundRect(g, ix, iy, iw, ih, ir); g.fill(); g.restore(); return { x: ix, y: iy, w: iw, h: ih, r: ir }; }
  g.fillStyle = fill; g.beginPath(); roundRect(g, ix, iy, iw, ih, ir); g.fill();
  const sheen = o.sheen ?? 0.22;
  if (sheen > 0 && ih > 4) {
    g.save(); g.beginPath(); roundRect(g, ix, iy, iw, ih, ir); g.clip();
    const gr = g.createLinearGradient(0, iy, 0, iy + ih * 0.55); gr.addColorStop(0, `rgba(255,255,255,${sheen})`); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(ix, iy, iw, ih * 0.55); g.restore();
  }
  g.restore();
  return { x: ix, y: iy, w: iw, h: ih, r: ir };
}
// Text with the apostrophe pulled in to hug its neighbours (a font's apostrophe carries side bearings that open a gap in
// "that's"; the game's own is a narrow cell of its own). Works on the context's current font, fill style and transform.
const APOS = /(['\u2019])/;
function aposLayout(g, text) {
  const parts = text.split(APOS).filter(p => p !== ""), out = []; let x = 0;
  const em = parseFloat(g.font) || 10;
  for (const part of parts) {
    if (part === "'" || part === "\u2019") {
      const m = g.measureText(part), left = -m.actualBoundingBoxLeft, right = m.actualBoundingBoxRight, gap = 0.04 * em;
      out.push({ s: part, x: x - left + gap }); x += right - left + 2 * gap + 0.01 * em;
    } else { out.push({ s: part, x }); x += g.measureText(part).width; }
  }
  return { parts: out, width: x };
}
export const tightWidth = (g, text) => text.includes("'") || text.includes("\u2019") ? aposLayout(g, text).width : g.measureText(text).width;
export function fillTextTight(g, text, x, y) {
  if (!text.includes("'") && !text.includes("\u2019")) { g.fillText(text, x, y); return; }
  for (const p of aposLayout(g, text).parts) g.fillText(p.s, x + p.x, y);
}
// HD text in the chosen HD font with the game's soft shadow. o: size (screen px em; default the font's), color, shadow
// (css or null), align "left" | "center" | "right", maxW (squeeze to fit). (x, y) is the baseline start (like the game's
// text rows: y of the 8-pixel row + font.base). Returns false (draws nothing) when no HD font is selected.
export function drawText(g, scr, text, x, y, o = {}) {
  const f = scr.font; if (!f) return false;
  const em = o.size ?? f.em; g.save(); g.font = `${em}px "${f.family}"`; g.textBaseline = "alphabetic";
  const w = tightWidth(g, text), sx = o.maxW && w > o.maxW ? o.maxW / w : 1, ax = o.align === "center" ? -w * sx / 2 : o.align === "right" ? -w * sx : 0;
  g.translate(x + ax, y); g.scale(sx, 1);
  if (o.shadow !== null) { g.fillStyle = o.shadow || "rgba(0,0,0,0.5)"; fillTextTight(g, text, 0.75, 0.75); }
  g.fillStyle = o.color || "#fff"; fillTextTight(g, text, 0, 0); g.restore(); return true;
}
// After painting a panel's fill over a region, give back the original's non-fill pixels (text, icons, portraits, digits)
// so they show through: every pixel of the region whose BG colour differs from `fillRGB` ([r,g,b] or css) gets a hole in
// what was painted. Pixels of text lines the HD font replaced are not given back (they are redrawn as HD text).
let maskCv = null, maskG = null, maskImg = null, mask32 = null;
export function punchInk(g, scr, x, y, w, h, fillRGB, tol = 12, exclude = null) {   // exclude: [[x, y, w, h], ...] pixels never given back
  const f = toRGB(fillRGB), px = scr.px32, tm = scr.textMask, fp = (0xFF000000 | f[2] << 16 | f[1] << 8 | f[0]) >>> 0;
  const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0), x1 = Math.min(160, Math.ceil(x + w)), y1 = Math.min(144, Math.ceil(y + h)), W = x1 - x0, H = y1 - y0;
  if (W <= 0 || H <= 0) return;
  if (!maskCv) { maskCv = document.createElement("canvas"); maskCv.width = 160; maskCv.height = 144; maskG = maskCv.getContext("2d"); maskImg = maskG.createImageData(160, 144); mask32 = new Uint32Array(maskImg.data.buffer); }
  const ex = (xx, yy) => { for (const e of exclude) if (xx >= e[0] && xx < e[0] + e[2] && yy >= e[1] && yy < e[1] + e[3]) return true; return false; };
  let any = false;
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
    const i = yy * 160 + xx, c = px[i]; let ink = false;
    if (c !== fp && !tm[i] && (Math.abs((c & 255) - f[0]) > tol || Math.abs((c >> 8 & 255) - f[1]) > tol || Math.abs((c >> 16 & 255) - f[2]) > tol)) ink = !(exclude && ex(xx, yy));
    mask32[i] = ink ? 0xFF000000 : 0; if (ink) any = true;
  }
  if (!any) return;
  // one image of the ink pixels, taken out of what was painted (nearest-neighbour: every pixel exactly)
  maskG.putImageData(maskImg, 0, 0, x0, y0, W, H);
  g.save(); g.globalCompositeOperation = "destination-out"; g.imageSmoothingEnabled = false; g.drawImage(maskCv, x0, y0, W, H, x0, y0, W, H); g.restore();
}

// A hash of the BG-only pixels (and the text mask) of a screen rectangle: equal key, equal picture there. For caching art.
export function regionKey(scr, x, y, w, h) {
  const px = scr.px32, tm = scr.textMask; let k = 2166136261 >>> 0;
  const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0), x1 = Math.min(160, Math.ceil(x + w)), y1 = Math.min(144, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = yy * 160 + xx; k = Math.imul(k ^ px[i] ^ (tm[i] << 30), 16777619) >>> 0; }
  return (k >>> 0).toString(36);
}
// Paint a rectangle of art through a cache: draw(ctx) is only called when `key` (plus the rectangle's pixels, see regionKey)
// differs from the last call with this `id`; otherwise the saved bitmap is blitted. ctx is scaled like g (screen pixels) with
// the origin at (x, y) of the screen. Use for art that is costly to build and rarely changes (a panel, a smoothed block).
const artCache = new Map();
export function paintCached(g, scr, id, x, y, w, h, key, draw) {
  const full = key + "|" + regionKey(scr, x, y, w, h); let e = artCache.get(id);
  if (!e || e.key !== full || e.w !== w || e.h !== h) {
    if (!e) { e = { cv: document.createElement("canvas") }; artCache.set(id, e); }
    e.cv.width = Math.ceil(w * HD); e.cv.height = Math.ceil(h * HD);
    const c = e.cv.getContext("2d"); c.setTransform(HD, 0, 0, HD, -x * HD, -y * HD); draw(c); e.key = full; e.w = w; e.h = h;
    if (artCache.size > 400) for (const k of artCache.keys()) { artCache.delete(k); break; }
  }
  g.drawImage(e.cv, x, y, w, h);
}

// Tell the text layer that screen pixels (x, y, w, h) are now covered by opaque HD fill, so it need not patch the old
// glyphs there with a flat box colour (it would show against shading). panelFrame's caller does this for the inside.
export function markOpaque(scr, x, y, w, h, fillRGB = null) {
  const x0 = Math.max(0, Math.ceil(x)), x1 = Math.min(160, Math.floor(x + w)), y0 = Math.max(0, Math.ceil(y)), y1 = Math.min(144, Math.floor(y + h));
  const f = fillRGB && toRGB(fillRGB), c = f ? (0xFF000000 | f[2] << 16 | f[1] << 8 | f[0]) >>> 0 : 0;
  for (let yy = y0; yy < y1; yy++) if (x1 > x0) { scr.opaque.fill(1, yy * 160 + x0, yy * 160 + x1); scr.fillPx.fill(c, yy * 160 + x0, yy * 160 + x1); }
}

// ---- the screen snapshot ------------------------------------------------------------------------------------------------
export class Cell {
  constructor(scr, id, x, y, dh = 0) {
    this.dh = dh;                                   // hash of the tile's pixel data (+ bank): equal tiles, equal shape
    this.scr = scr; this.id = id & 0x7FFF; this.layer = id & 0x8000 ? "win" : "bg"; this.x = x; this.y = y;
    const m = scr.gb.mem; this.tile = m.vram[0][this.id]; this.attr = m.vram[1][this.id]; this.pal = this.attr & 7;
    this.cx = this.id & 31; this.cy = (this.id >> 5) & 31;
    this._ci = null; this._rows = null; this._colors = null;
  }
  get flipX() { return !!(this.attr & 0x20); } get flipY() { return !!(this.attr & 0x40); }
  get prio() { return !!(this.attr & 0x80); }
  // colour indices (0..3) of the 64 pixels, row-major, flips applied: what is on screen
  get ci() {
    if (this._ci) return this._ci;
    const p = this.scr.gb.ppu, m = this.scr.gb.mem, bank = this.attr & 8 ? m.vram[1] : m.vram[0], a = this.attr;
    const addr = p.lcdc & 0x10 ? this.tile << 4 : 0x1000 + ((this.tile << 24 >> 24) << 4), o = new Uint8Array(64);
    for (let y = 0; y < 8; y++) { const yy = a & 0x40 ? 7 - y : y, lo = bank[addr + yy * 2], hi = bank[addr + yy * 2 + 1]; for (let x = 0; x < 8; x++) { const b = a & 0x20 ? x : 7 - x; o[y * 8 + x] = ((lo >> b) & 1) | (((hi >> b) & 1) << 1); } }
    return this._ci = o;
  }
  get rows() { if (!this._rows) { const c = this.ci, r = []; for (let y = 0; y < 8; y++) { let s = ""; for (let x = 0; x < 8; x++) s += c[y * 8 + x]; r.push(s); } this._rows = r; } return this._rows; }
  get sig() { return this.rows.join(""); }
  // palette colours of indices 0..3 as {r,g,b,css,c15}
  get colors() { return this._colors || (this._colors = [0, 1, 2, 3].map(i => this.scr.color(this.pal, i))); }
  // the tile's rows against a pattern of 8 strings: "0".."3" must equal, anything else (".", "?", " ") matches any
  match(pattern) { const r = this.rows; for (let y = 0; y < 8; y++) { const p = pattern[y]; for (let x = 0; x < 8; x++) { const c = p[x]; if (c >= "0" && c <= "3" && c !== r[y][x]) return false; } } return true; }
  get blank() { const c = this.ci; for (let i = 1; i < 64; i++) if (c[i] !== c[0]) return false; return true; }   // one colour throughout
}
export class Screen {
  constructor(gb) {
    this.gb = gb; this._cells = { bg: [], win: [] }; this._byId = new Map(); this._vis = []; this._nb = 0; this._nw = 0; this.key = ""; this.lines = []; this.font = null;
    this.regs = {}; this.oam = []; this.hidden = new Set(); this.hiddenStatic = new Set(); this.curSprites = false; this.canHide = true; this.claims = []; this.px32 = new Uint32Array(160 * 144); this.textMask = new Uint8Array(160 * 144); this.opaque = new Uint8Array(160 * 144); this.fillPx = new Uint32Array(160 * 144); this.panels = []; this.underFresh = true; this.underChanged = false;
  }
  color(pal, i) { const o = pal * 8 + i * 2, p = this.gb.ppu.bgPal; return col15(p[o] | (p[o + 1] << 8)); }
  // read the visible map cells (each once, at its tile's top-left screen position); returns a key that changes when
  // anything visible changed (cell positions, tile and attribute numbers, tile pixels, palettes)
  scan() {
    const gb = this.gb, p = gb.ppu, m = gb.mem, v0 = m.vram[0], v1 = m.vram[1], cell = p.pixCell, sub = p.pixSub, seen = this._seen || (this._seen = new Map());
    seen.clear();
    for (let y = 0; y < 144; y++) for (let x = 0; x < 160;) {
      const i = y * 160 + x, c = cell[i], s = sub[i];
      if (!seen.has(c)) seen.set(c, (x - (s & 7)) << 16 | ((y - (s >> 3)) & 0xFFFF));
      x += 8 - (s & 7);
    }
    let h = 2166136261 >>> 0; const mixh = v => { h = Math.imul(h ^ v, 16777619) >>> 0; };
    const lcdc = p.lcdc, vis = this._vis; vis.length = 0; let nb = 0, nw = 0;
    mixh(lcdc & 0x10);
    for (const [c, xy] of seen) {              // (Map order = the order the screen was scanned in: equal screens hash equally)
      const x = xy >> 16, y = (xy << 16) >> 16; if (y <= -8 || y >= 144 || x <= -8 || x >= 160) continue;
      const id = c & 0x7FFF, tile = v0[id], attr = v1[id];
      mixh(c); mixh((x & 255) | (y & 255) << 8); mixh(tile | attr << 8);
      const bank = attr & 8 ? v1 : v0, addr = lcdc & 0x10 ? tile << 4 : 0x1000 + ((tile << 24 >> 24) << 4);
      let d = attr & 8 ? 7 : 3;
      for (let k = 0; k < 16; k += 4) { const w = bank[addr + k] | bank[addr + k + 1] << 8 | bank[addr + k + 2] << 16 | bank[addr + k + 3] << 24; mixh(w); d = Math.imul(d ^ w, 16777619); }
      vis.push(c, x, y, d >>> 0); if (c & 0x8000) nw++; else nb++;
    }
    const bp = p.bgPal; for (let k = 0; k < 64; k += 4) mixh(bp[k] | bp[k + 1] << 8 | bp[k + 2] << 16 | bp[k + 3] << 24);
    this.regs = { lcdc, scx: p.scx, scy: p.scy, wx: p.wx, wy: p.wy };
    this._cells = null; this._byId = null; this._nb = nb; this._nw = nw;       // the Cell objects are made when something asks (a repaint)
    return this.key = h.toString(36) + ":" + nb + ":" + nw;
  }
  // visible cells as flat [id, x, y, dataHash] quadruples (cheap: what the text reader needs)
  get vis() { return this._vis; }
  get cells() { if (!this._cells) this._build(); return this._cells; }
  set cells(v) { this._cells = v; }
  get byId() { if (!this._byId) this._build(); return this._byId; }
  set byId(v) { this._byId = v; }
  _build() {
    const cells = { bg: [], win: [] }, byId = new Map(), v = this._vis;
    for (let k = 0; k < v.length; k += 4) { const cl = new Cell(this, v[k], v[k + 1], v[k + 2], v[k + 3]); byId.set(v[k], cl); cells[cl.layer].push(cl); }
    this._cells = cells; this._byId = byId;
  }
  // a key of the visible sprites: which (index, tile, attributes) are on screen, and where for the `watch` indices (the
  // sprites painters replaced: they must follow them)
  oamKey(watch) {
    const o = this.gb.mem.oam, h = this.gb.ppu.lcdc & 4 ? 16 : 8; let k = 2166136261 >>> 0;
    for (let i = 0; i < 40; i++) {
      const sy = o[i * 4] - 16, sx = o[i * 4 + 1] - 8; if (sy <= -h || sy >= 144 || sx <= -8 || sx >= 160) continue;
      k = Math.imul(k ^ (i | o[i * 4 + 2] << 8 | o[i * 4 + 3] << 16), 16777619) >>> 0;
      if (watch === true || (watch && watch.has(i))) k = Math.imul(k ^ (sx & 255 | (sy & 255) << 8), 16777619) >>> 0;
    }
    return k.toString(36);
  }
  // BG-only picture (no sprites): 0xAABBGGRR per pixel, as the 2D frame holds it
  grabPixels() { this.px32.set(this.gb.ppu.bgFrame); this._pk = null; return this.px32; }
  // a hash of the BG-only picture (cheap: for memoising what is found in it)
  get pixKey() { if (this._pk) return this._pk; const px = this.px32; let h = 2166136261 >>> 0; for (let i = 0; i < px.length; i++) h = Math.imul(h ^ px[i], 16777619); return this._pk = (h >>> 0).toString(36); }
  // the visible sprites: [{i (OAM index), x, y, tile, attr, h (8 or 16), pal, flipX, flipY, ci (Uint8Array 8*h colour
  // indices, flips applied), colors (4 palette colours), rows (h strings)}]
  readOam() {
    const gb = this.gb, m = gb.mem, o = m.oam, h = gb.ppu.lcdc & 4 ? 16 : 8, out = [], scr = this;
    for (let i = 0; i < 40; i++) {
      const sy = o[i * 4] - 16, sx = o[i * 4 + 1] - 8; if (sy <= -h || sy >= 144 || sx <= -8 || sx >= 160) continue;
      const tile = h === 16 ? o[i * 4 + 2] & 0xFE : o[i * 4 + 2], attr = o[i * 4 + 3];
      out.push({ i, x: sx, y: sy, tile, attr, h, pal: attr & 7, flipX: !!(attr & 0x20), flipY: !!(attr & 0x40),
        get ci() { if (this._ci) return this._ci; const bank = this.attr & 8 ? m.vram[1] : m.vram[0], c = new Uint8Array(8 * this.h);
          for (let y = 0; y < this.h; y++) { const yy = this.flipY ? this.h - 1 - y : y, lo = bank[(this.tile << 4) + yy * 2], hi = bank[(this.tile << 4) + yy * 2 + 1]; for (let x = 0; x < 8; x++) { const b = this.flipX ? x : 7 - x; c[y * 8 + x] = ((lo >> b) & 1) | (((hi >> b) & 1) << 1); } }
          return this._ci = c; },
        get rows() { const c = this.ci, r = []; for (let y = 0; y < this.h; y++) { let t = ""; for (let x = 0; x < 8; x++) t += c[y * 8 + x]; r.push(t); } return r; },
        get colors() { const p = gb.ppu.objPal, b = this.pal * 8; return [0, 1, 2, 3].map(k => col15(p[b + k * 2] | (p[b + k * 2 + 1] << 8))); } });
    }
    this.hidden = new Set(this.hiddenStatic); return this.oam = out;
  }
  // Replace sprites by your own art (sprite painters only): hide(sprites) marks them as not to be shown by the view (2D
  // draws its own picture without them and what lay below them), then draw your art on g. Returns false (leave the
  // sprites alone) when the view cannot leave them out (scr.canHide false: the 3D view for now).
  hide(sprs) {
    if (!this.canHide) return false;
    for (const s of Array.isArray(sprs) ? sprs : [sprs]) { this.hidden.add(s.i); if (!this.curSprites) this.hiddenStatic.add(s.i); }   // hides by ordinary painters last until the next full repaint
    return true;
  }
  // Take over a screen region: the built-in art (panel frames, cursors; order >= 0) leaves what lies inside alone. Call it from a
  // painter that runs BEFORE them (order < 0); claims last until the next full repaint. claim(0, 0, 160, 144) = the whole screen.
  claim(x, y, w, h) { this.claims.push([x, y, w, h]); }
  claimed(x, y, w = 1, h = 1) { const cx = x + w / 2, cy = y + h / 2; for (const c of this.claims) if (cx >= c[0] && cx < c[0] + c[2] && cy >= c[1] && cy < c[1] + c[3]) return true; return false; }
  at(layer, x, y) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= 160 || y >= 144) return null; const c = this.byId.get(this.gb.ppu.pixCell[y * 160 + x]); return c && (!layer || c.layer === layer) ? c : null; }
  px(x, y) { return this.px32[(y | 0) * 160 + (x | 0)]; }            // 0xAABBGGRR (BG layers only)
  find(layer, fn) { return this.cells[layer].filter(fn); }
  // rectangles of cells matching `fn(cell)` laid out on the 8-pixel grid: [{x, y, w, h, cells}] in screen pixels (one
  // rectangle per maximal run of equally-aligned cells; 2D regions are the caller's to merge)
  runs(layer, fn) {
    const out = [], by = new Map();
    for (const c of this.cells[layer]) if (fn(c)) { const k = c.y + ":" + (c.x & 7); (by.get(k) || by.set(k, []).get(k)).push(c); }
    for (const list of by.values()) {
      list.sort((a, b) => a.x - b.x); let s = 0;
      for (let i = 1; i <= list.length; i++) if (i === list.length || list[i].x !== list[i - 1].x + 8) { out.push({ x: list[s].x, y: list[s].y, w: (i - s) * 8, h: 8, cells: list.slice(s, i) }); s = i; }
    }
    return out;
  }
}

// ---- running the painters ---------------------------------------------------------------------------------------------
// Called by HDText.paint(): `layers` = { bg: ctx, win: ctx } (already scaled to screen pixels); returns nothing
// mode: "all" (every painter) or "spr" (only the sprite painters: a cursor moved)
export function runPainters(layers, scr, mode = "all") {
  for (const p of painters) {
    if (p.failed) continue;
    const t0 = performance.now();
    scr.curSprites = !!p.sprites;
    if (p.under) continue;                                   // run by runUnder, after the rest
    if (p.sprites) {
      const g = layers.spr; g.save();
      try { p.fn(g, scr, "spr"); } catch (e) { p.failed = true; console.warn("HD painter", p.name, e); }
      g.restore();
    } else if (mode === "all") {
      for (const layer of ["bg", "win"]) {
        if (!scr.cells[layer].length) continue;
        const g = layers[layer]; g.save();
        try { p.fn(g, scr, layer); } catch (e) { p.failed = true; console.warn("HD painter", p.name, e); }
        g.restore();
      }
    }
    p.ms = (p.ms || 0) + performance.now() - t0;
  }
  scr.curSprites = false;
}
// the painters' watch strings joined (HDText adds them to its repaint key)
export function watchKey(scr) { let k = ""; for (const p of painters) if (p.watch && !p.failed) { try { k += p.watch(scr) + ";"; } catch (e) { p.failed = true; console.warn("HD painter watch", p.name, e); } } return k; }
// time spent in each painter since the last call (ms), for profiling
export function painterStats(reset = true) { const o = painters.map(p => [p.name, +(p.ms || 0).toFixed(2)]); if (reset) for (const p of painters) p.ms = 0; return o; }
// the under painter (see registerHDPainter): its canvas context g (unscaled); returns whether there is a picture to show
export function runUnder(g, scr) {
  for (const p of painters) if (p.under && !p.failed) {
    const t0 = performance.now(); let show = false;
    try { show = !!p.fn(g, scr, "under"); } catch (e) { p.failed = true; console.warn("HD painter", p.name, e); }
    p.ms = (p.ms || 0) + performance.now() - t0; return show;
  }
  return false;
}
export const painterNames = () => painters.map(p => p.name);

// the other agents' painters (empty stubs until they write theirs); a missing file is not an error
export async function loadMenuModules() {
  for (const m of HDMENU_MODULES) { try { await import(m); } catch (e) { console.warn("hd menus: " + m, e && e.message); } }
}
