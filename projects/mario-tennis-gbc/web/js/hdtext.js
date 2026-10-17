// HD text: the game's proportional font (bank $05: 8x8 2bpp glyphs at $7920, pixel widths at $7F80) redrawn in a
// high-resolution font. Each frame the text on screen is read back from VRAM: every visible row of background or
// window tiles is matched, glyph by glyph, against the ROM's font the way the game rasterised it (DrawGlyph writes
// the glyph's 8 columns at the pen, then moves the pen on by the glyph's width). Lines that read as text are
// painted over in their box colour and written again in the chosen font, on a canvas 4x the screen's size that the
// page lays over the picture (2D), or that the 3D view draws over its copies of the screen (web/js/voxel.js).
// Fonts (web/fonts, SIL Open Font License): Itim (Cadson Demak), Kode Mono (The Kode Mono Project Authors).
export const FONTS = {
  game: { label: "Game" },
  itim: { label: "Itim", family: "MT Itim", file: "fonts/Itim-Regular.ttf", em: 12, base: 7.25 },
  kode: { label: "Kode Mono", family: "MT Kode Mono", file: "fonts/KodeMono.ttf", em: 9.25, base: 7 },
};
export const FONT_ORDER = ["game", "itim", "kode"];
import { HD, Screen, runPainters, runUnder, watchKey, onPainterChange, loadMenuModules, fillTextTight, tightWidth } from "./hdui.js";
import "./hdui_frames.js"; import "./hdui_cursors.js";                        // the built-in art (boxes, cursors)
export { HD };                                       // canvas pixels per screen pixel

const FONT = 0x7920, WIDTHS = 0x7F80, GLYPHS = 0x66;   // glyphs $20-$85 (the width table ends at $FF entries)
const SPACE = 0;                                     // glyph index of " "

const BUSY_MS = 6;                                   // a repaint that takes longer than this, again and again, waits for the screen to settle
const OTHER = 0xFFFC;                                // a column of a tile that is not in the font (a colour-0 pixel in row 0: no glyph column has one)
const romAt = (rom, addr) => rom[5 * 0x4000 + addr - 0x4000];

export class HDText {
  constructor(gb) {
    this.gb = gb; this.font = "game"; this.loaded = {};
    // the font as columns: per glyph, 8 columns of 16 bits (row r's two bit planes at bits 2r, 2r + 1)
    const rom = gb.mem.rom; this.cols = []; this.width = []; this.ink = [];
    for (let g = 0; g < GLYPHS; g++) {
      const c = new Uint16Array(8); let ink = 0;
      for (let r = 0; r < 8; r++) {
        const lo = romAt(rom, FONT + g * 16 + r * 2), hi = romAt(rom, FONT + g * 16 + r * 2 + 1);
        for (let x = 0; x < 8; x++) { const ci = ((lo >> (7 - x)) & 1) | (((hi >> (7 - x)) & 1) << 1); c[x] |= ci << (2 * r); if (ci === 3) ink++; }
      }
      const w = romAt(rom, WIDTHS + g);
      this.cols.push(c); this.width.push(w > 0 && w <= 8 ? w : 0); this.ink.push(ink);
    }
    // the font never uses colour index 0: a tile with a 0 pixel is no text (checked on 8 bytes, so most of the picture is skipped at once)
    this.noZero = true; for (let g = 0; g < GLYPHS && this.noZero; g++) for (let r = 0; r < 8; r++) if ((romAt(rom, FONT + g * 16 + r * 2) | romAt(rom, FONT + g * 16 + r * 2 + 1)) !== 255) { this.noZero = false; break; }
    this.order = [...Array(GLYPHS).keys()].filter(g => g !== SPACE && this.width[g] && this.ink[g]).sort((a, b) => this.ink[b] - this.ink[a]);
    this.canvas = { bg: makeCanvas(), win: makeCanvas(), spr: makeCanvas(), under: makeCanvas() };    // spr: HD art for sprites (2D draws it over the sprites)
    this.lines = []; this.key = ""; this.frame = -1; this.dirty = true; this.version = 0; this.sprVersion = 0; this.underVersion = 0; this.has = { bg: false, win: false, spr: false, under: false };
    this.ui = false; this.hideSprites = true; this.hiddenOam = new Set(); this.hiddenPx = new Uint8Array(160 * 144); this.through = []; this.okey = ""; this.screen = new Screen(gb); this.painted = false;     // HD UI (web/js/hdui.js): frames, cursors, icons
    this.offPainters = onPainterChange(() => { this.key = ""; this.dirty = true; });
    loadMenuModules();
  }
  // whether the view can leave out sprites that painters replaced (2D can; the 3D view not yet)
  setSpriteHide(on) { if (this.hideSprites !== !!on) { this.hideSprites = !!on; this.key = ""; this.dirty = true; } }
  // whether the page shows the 3D view (menus lie on layers / cards there: the art must not hide them)
  setView3d(on) { if (this.in3d !== !!on) { this.in3d = !!on; this.key = ""; this.dirty = true; } }
  setUI(on) { this.ui = !!on; this.key = ""; this.dirty = true; }
  setFont(name) {
    this.font = FONTS[name] ? name : "game"; this.key = ""; this.dirty = true;
    const f = FONTS[this.font];
    if (f.file && !this.loaded[this.font] && typeof FontFace !== "undefined") {
      this.loaded[this.font] = "loading";
      const ff = new FontFace(f.family, `url(${new URL("../" + f.file, import.meta.url)})`);
      const name = this.font;
      ff.load().then(x => { document.fonts.add(x); this.loaded[name] = true; this.key = ""; this.dirty = true; if (this.onload) this.onload(); }).catch(e => console.warn("font", e));
    }
  }
  get active() { return this.font !== "game" || this.ui; }         // something is drawn over the picture
  get textOn() { return this.font !== "game" && this.loaded[this.font] === true; }

  // read the screen (once per game frame): the text on it (HD font) and the tiles (HD UI); repaint the canvases when
  // that changed; returns true then
  update() {
    const textOn = this.textOn, uiOn = this.ui;
    if (!textOn && !uiOn) { if (this.lines.length || this.dirty || this.painted) { this.lines = []; this.paint(); this.dirty = false; return true; } return false; }
    const p = this.gb.ppu;
    if (p.frames === this.frame && !this.dirty) {
      if (this.pending) { this.pending = false; this.lines = textOn && this.readLines ? this.readLines : []; this.timedPaint(); return true; }   // no new frame (paused): the screen is still, draw the art
      return false;
    }
    this.frame = p.frames; this.dirty = false;
    const skey = this.screen.scan();
    let lines = [];
    if (textOn) { if (skey === this.readKey && this.readLines) lines = this.readLines; else { lines = this.read(); this.readKey = skey; this.readLines = lines; } }
    const key = this.font + "|" + uiOn + "|" + (uiOn ? skey + ":" + watchKey(this.screen) : "") + "|" + lines.map(l => `${l.x},${l.y},${l.win},${l.text},${l.c.join(",")}`).join("|");
    const okey = uiOn ? this.screen.oamKey(true) : "";
    if (key === this.key) {
      this.streak = 0;
      if (this.pending) { this.pending = false; this.lines = lines; this.timedPaint(); this.okey = okey; return true; }   // the screen settled: the HD art now
      if (okey === this.okey) return false;
      this.okey = okey; this.paintSprites(); return true;                                                           // only sprites moved
    }
    // a costly repaint on a screen that changes frame after frame (a page sliding in): show the game's own picture until it
    // settles instead of dropping frames
    this.streak = (this.streak || 0) + 1;
    if (this.streak >= 3 && (this.paintMs > BUSY_MS || this.struggling)) {
      this.key = key; this.okey = okey; this.pending = true;
      if (this.painted) { this.lines = []; this.clearAll(); return true; }
      return false;
    }
    this.key = key; this.okey = okey; this.pending = false; this.lines = lines; this.timedPaint(); return true;
  }
  timedPaint() { const t = performance.now(); this.paint(); this.paintMs = (this.paintMs || 0) * 0.6 + (performance.now() - t) * 0.4; }
  // nothing drawn over the picture (the overlay canvases emptied)
  clearAll() {
    for (const k of ["bg", "win", "spr", "under"]) { const cv = this.canvas[k]; if (cv) cv.getContext("2d").clearRect(0, 0, cv.width, cv.height); }
    this.version++; this.sprVersion++; this.underVersion++; this.has.bg = this.has.win = this.has.spr = this.has.under = false; this.painted = false; this.screen.underFresh = true;
    this.hiddenOam = new Set(); this.hiddenPx.fill(0); this.through = [];
  }

  // the visible tile rows as strips of tile columns, then the text read from each
  read() {
    const p = this.gb.ppu, m = this.gb.mem, v0 = m.vram[0], v1 = m.vram[1], lcdc = p.lcdc, rows = new Map();
    // every visible map cell once, at its tile's top-left screen position (the screen snapshot's scan)
    const vis = this.screen.vis; for (let k = 0; k < vis.length; k += 4) rows.set(vis[k], { x: vis[k + 1], y: vis[k + 2] });
    // group by screen tile row: cells of one map row at one y, side by side
    const bands = new Map();
    for (const [c, pos] of rows) {
      const k = `${c & 0x8000 ? "w" : "b"}${pos.y}`; let b = bands.get(k);
      if (!b) bands.set(k, b = { win: !!(c & 0x8000), y: pos.y, cells: [] });
      b.cells.push({ c: c & 0x7FFF, x: pos.x });
    }
    const out = [];
    for (const b of bands.values()) {
      if (b.y <= -8 || b.y >= 144) continue;
      b.cells.sort((a, c) => a.x - c.x);
      // runs of cells exactly 8 px apart make strips
      let start = 0;
      for (let i = 1; i <= b.cells.length; i++) {
        if (i < b.cells.length && b.cells[i].x === b.cells[i - 1].x + 8) continue;
        this.readStrip(b, b.cells.slice(start, i), v0, v1, lcdc, out); start = i;
      }
    }
    return out;
  }
  readStrip(band, cells, v0, v1, lcdc, out) {
    const n = cells.length * 8, s = this.strip && this.strip.length >= n ? this.strip : (this.strip = new Uint16Array(Math.max(n, 256)));
    const BLANK = this.cols[SPACE][0];
    let any = false;
    const noZero = this.noZero; let foreign = false, mine = false;
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k].c, tile = v0[i], attr = v1[i], bank = attr & 8 ? v1 : v0;
      const addr = lcdc & 0x10 ? tile << 4 : 0x1000 + ((tile << 24 >> 24) << 4), flip = attr & 0x60;
      if (noZero) { let z = false; for (let r = 0; r < 16; r += 2) if ((bank[addr + r] | bank[addr + r + 1]) !== 255) { z = true; break; } if (z) { for (let x = 0; x < 8; x++) s[k * 8 + x] = OTHER; foreign = true; continue; } }
      for (let x = 0; x < 8; x++) {
        let col = 0;
        if (!flip) for (let r = 0; r < 8; r++) { const lo = bank[addr + r * 2], hi = bank[addr + r * 2 + 1]; col |= ((((lo >> (7 - x)) & 1) | (((hi >> (7 - x)) & 1) << 1)) << (2 * r)); }
        s[k * 8 + x] = col; if (col !== BLANK && col) { any = true; mine = true; }
      }
    }
    if (!any || (foreign && !mine)) return;
    const ws = this.width[SPACE] || 5, found = [];
    let x = 0;
    while (x < n) {
      if (s[x] === BLANK || !s[x] || s[x] === OTHER) { x++; continue; }
      // a line: glyphs one after another from here, each pen moved on by the glyph's width, spaces between words
      let pen = x, text = "", letters = 0, end = x;
      for (;;) {
        const g = this.matchAt(s, pen, n);
        if (g >= 0) { text += String.fromCharCode(0x20 + g); letters++; pen += this.width[g]; end = pen; continue; }
        if (!letters) break;
        let next = pen; while (next < n && s[next] === BLANK) next++;
        if (next >= pen + ws && next < n && next - pen < ws * 3 && this.matchAt(s, pen + ws * Math.round((next - pen) / ws), n) >= 0) {
          const k = Math.round((next - pen) / ws); text += " ".repeat(k); pen += ws * k; continue;
        }
        break;
      }
      const inked = text.replace(/[ .,'`"\-]/g, "").length;
      // a real line starts and ends at blank columns; ink right before or after it means a piece of something longer (other font)
      const edgeOk = (x === 0 || s[x - 1] === BLANK || !s[x - 1]) && (end >= n || s[end] === BLANK || !s[end]);
      if (letters >= 2 && inked >= 1 && edgeOk) {
        found.push({ x, end, text });
        x = Math.max(end, x + 1);
      } else x++;
    }
    // a line with unread ink close beside it (a word of the same phrase in another font) is left as it is
    const ink = c => c >= 0 && c < n && s[c] !== BLANK && s[c];
    for (const f of found) {
      let r = f.end; while (r < n && r < f.end + 9 && !ink(r)) r++;
      let l = f.x - 1; while (l >= 0 && l > f.x - 10 && !ink(l)) l--;
      const inLine = c => found.some(o => c >= o.x && c < o.end);
      if ((ink(r) && !inLine(r)) || (ink(l) && !inLine(l))) continue;
      const c0 = cells[f.x >> 3], pal = v1[c0.c] & 7, ppu = this.gb.ppu;
      out.push({ x: c0.x + (f.x & 7), y: band.y, w: f.end - f.x, win: band.win, text: f.text, c: [1, 2, 3].map(ci => col5(ppu.bgPal, pal, ci)) });
    }
  }
  // the glyph drawn at `pen`: DrawGlyph overwrites the 8 columns from the pen, and the next glyph overwrites all past
  // this one's width, so its columns within its width are exactly what the strip shows; the inkiest such glyph
  matchAt(s, pen, n) {
    for (const g of this.order) {
      const c = this.cols[g], w = this.width[g]; if (pen + w > n) continue;
      let k = 0; while (k < w && c[k] === s[pen + k]) k++;
      if (k === w) return g;
    }
    return -1;
  }

  // the canvases: the HD UI art (frames, cursors, icons: web/js/hdui.js), then each text line's box colour over the old
  // glyphs (unless the UI art already covers the place) and the line in the HD font with the game's shadow
  paint() {
    const scr = this.screen, ui = this.ui, ctx = {}, drew = { bg: false, win: false, spr: false };
    for (const k of ["bg", "win", "spr"]) { const cv = this.canvas[k]; if (cv) { ctx[k] = cv.getContext("2d"); if (this.painted || this.everPainted) ctx[k].clearRect(0, 0, cv.width, cv.height); } }
    this.version++; this.sprVersion++;
    const f = FONTS[this.font], textOn = !!f.family && this.loaded[this.font] === true;
    // what the painters may need: the text lines read, the HD font, and masks of the pixels they cover
    scr.lines = this.lines; scr.font = textOn ? { family: f.family, em: f.em, base: f.base } : null;
    scr.textMask.fill(0); scr.opaque.fill(0); scr.claims = []; scr.hiddenStatic = new Set(); scr.canHide = this.hideSprites; scr.in3d = !!this.in3d;
    for (const l of this.lines) for (let y = Math.max(0, l.y); y < Math.min(144, l.y + 8); y++) scr.textMask.fill(1, y * 160 + Math.max(0, l.x), y * 160 + Math.min(160, l.x + l.w + 1));
    if (ui && ctx.bg) {
      scr.grabPixels(); scr.readOam();
      const layers = {};
      for (const k of ["bg", "win", "spr"]) layers[k] = watch(ctx[k], () => { drew[k] = true; });
      for (const k of ["bg", "win", "spr"]) { ctx[k].save(); ctx[k].setTransform(HD, 0, 0, HD, 0, 0); }
      try { runPainters(layers, scr, "all"); } finally { for (const k of ["bg", "win", "spr"]) ctx[k].restore(); }
      this.afterSprites();
      // the picture under the art (the smoothed screen): kept between repaints by its painter
      const ug = this.canvas.under.getContext("2d"); scr.underChanged = false;
      const show = runUnder(ug, scr);
      if (show) { if (scr.underChanged || !this.has.under) this.underVersion++; scr.underFresh = false; }
      else if (this.has.under) { ug.clearRect(0, 0, this.canvas.under.width, this.canvas.under.height); this.underVersion++; scr.underFresh = true; }
      this.has.under = show;
    } else {
      this.hiddenOam = new Set(); this.hiddenPx.fill(0); this.through = [];
      if (this.has.under) { const cv = this.canvas.under; cv.getContext("2d").clearRect(0, 0, cv.width, cv.height); this.underVersion++; this.has.under = false; scr.underFresh = true; }
    }
    this.has.bg = drew.bg || this.lines.some(l => !l.win); this.has.win = drew.win || this.lines.some(l => l.win);
    this.has.spr = drew.spr; this.painted = this.has.bg || this.has.win || this.has.spr || this.has.under; if (ui) this.everPainted = true;   // painters may draw through contexts of their own: with the UI on the canvases are always cleared
    if (!textOn) return;
    for (const l of this.lines) {
      const cv = this.canvas[l.win ? "win" : "bg"]; if (!cv) continue;
      const g = cv.getContext("2d"), [bg, sh, ink] = l.c.map(css);
      // rows of text closer than 16 px (lists) get a smaller size
      let gap = 16; for (const o of this.lines) if (o !== l && o.win === l.win && o.x < l.x + l.w && l.x < o.x + o.w && o.y !== l.y) gap = Math.min(gap, Math.abs(o.y - l.y));
      const em = f.em * Math.min(1, Math.max(0.7, gap / 14));
      if (!(ui && this.covered(l))) { g.fillStyle = bg; g.fillRect(l.x * HD, l.y * HD, (l.w + 1) * HD, 8 * HD); }
      g.font = `${em * HD}px "${f.family}"`; g.textBaseline = "alphabetic";
      const w = tightWidth(g, l.text), room = (l.w - 1.5) * HD, sx = w > room ? room / w : 1;
      g.save(); g.translate(l.x * HD, (l.y + f.base) * HD); g.scale(sx, 1);
      const o = HD * 0.75; g.fillStyle = sh; fillTextTight(g, l.text, o, o); g.fillStyle = ink; fillTextTight(g, l.text, 0, 0);
      g.restore();
    }
  }
  // only the sprites changed (a cursor moved): the sprite canvas again, nothing else (the 3D view's textures stay)
  paintSprites() {
    const scr = this.screen, cv = this.canvas.spr, g = cv.getContext("2d"); let drew = false;
    if (this.has.spr) g.clearRect(0, 0, cv.width, cv.height);
    scr.readOam(); scr.canHide = this.hideSprites;
    const top = watch(g, () => { drew = true; }); g.save(); g.setTransform(HD, 0, 0, HD, 0, 0);
    try { runPainters({ spr: top }, scr, "spr"); } finally { g.restore(); }
    this.afterSprites(); this.has.spr = drew; this.painted = this.painted || drew; this.sprVersion++;
  }
  // which sprites the art replaced: their opaque pixels (left out in 2D), and what shows through where another sprite lies below
  afterSprites() {
    const scr = this.screen; this.hiddenOam = scr.hidden || new Set(); this.hiddenPx.fill(0); this.through = [];
    if (!this.hiddenOam.size) return;
    const below = scr.oam.filter(o => !this.hiddenOam.has(o.i));
    for (const sp of scr.oam) if (this.hiddenOam.has(sp.i)) {
      const ci = sp.ci;
      for (let y = 0; y < sp.h; y++) for (let x = 0; x < 8; x++) {
        const X = sp.x + x, Y = sp.y + y; if (!ci[y * 8 + x] || X < 0 || X >= 160 || Y < 0 || Y >= 144) continue;
        this.hiddenPx[Y * 160 + X] = 1;
        for (const o of below) { if (X < o.x || X >= o.x + 8 || Y < o.y || Y >= o.y + o.h) continue; const v = o.ci[(Y - o.y) * 8 + X - o.x]; if (v) { const k = o.colors[v]; this.through.push(Y * 160 + X, (0xFF000000 | k.b << 16 | k.g << 8 | k.r) >>> 0); break; } }
      }
    }
  }
  // is the line's box already opaque HD fill (painted by the UI art), so the old glyphs are hidden without a patch?
  covered(l) {
    const m = this.screen.opaque;
    for (let y = Math.max(0, l.y); y < Math.min(144, l.y + 8); y++) for (let x = Math.max(0, l.x); x < Math.min(160, l.x + l.w + 1); x++) if (!m[y * 160 + x]) return false;
    return true;
  }
}

// a context whose drawing calls tell `onDraw` that something was painted (so empty layers cost nothing later)
const DRAWS = new Set(["fill", "stroke", "fillRect", "strokeRect", "fillText", "strokeText", "drawImage", "putImageData"]);
function watch(g, onDraw) {
  return new Proxy(g, {
    get(t, k) { const v = t[k]; return typeof v === "function" ? (...a) => { if (DRAWS.has(k)) onDraw(); return v.apply(t, a); } : v; },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function makeCanvas() {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas"); c.width = 160 * HD; c.height = 144 * HD; return c;
}
const col5 = (pal, p, i) => { const o = p * 8 + i * 2; return pal[o] | (pal[o + 1] << 8); };
const css = c => `rgb(${(c & 31) * 8},${(c >> 5 & 31) * 8},${(c >> 10 & 31) * 8})`;
