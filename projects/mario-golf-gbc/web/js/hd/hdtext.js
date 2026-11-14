// HD text: the game's proportional text (Font 03:50F0, FontWidths 03:5750) redrawn in a high-resolution font, on a canvas 4x the
// screen's size that the play page lays over the picture (web/js/hd/view.js). Copied from the Mario Tennis project (web/js/hdtext.js)
// and adapted to the native game: Tennis has to read its text back from VRAM glyph by glyph; here the text engine is the game's own
// code in JS (web/js/golf/text.js), so its glyph renderer DrawGlyph 03:4B45 tells this module every glyph it draws (setGlyphHook:
// before and after, reading only). Each glyph tile of the buffer (WRAM7 $D000) is followed by its content: the 16 bytes a tile holds
// after the glyphs drawn into it are remembered with the glyphs and their pixel columns. On screen, every visible map cell whose
// tile shows exactly such content holds those glyphs (whatever VRAM tile, bank or screen place the game copied it to): a window that
// closed, a tile not uploaded yet, a row scrolled away or a tile drawn over shows other bytes and so no text. Lines are joined from
// the glyphs of a tile row by their pixel positions. The fixed-width menu font (FontTiles 01:42A0, one tile per ASCII character) is
// matched by tile content the same way.
// Fonts (web/fonts, SIL Open Font License): Itim (Cadson Demak), Kode Mono (The Kode Mono Project Authors).
export const FONTS = {
  game: { label: "Game" },
  itim: { label: "Itim", family: "MG Itim", file: "fonts/Itim-Regular.ttf", em: 12, base: 7.25 },
  kode: { label: "Kode Mono", family: "MG Kode Mono", file: "fonts/KodeMono.ttf", em: 9.25, base: 7 },
};
export const FONT_ORDER = ["game", "itim", "kode"];
import { HD, Screen, runPainters, runUnder, watchKey, onPainterChange, loadMenuModules, fillTextTight, tightWidth } from "./hdui.js";
import "./hdui_frames.js"; import "./hdui_cursors.js";                        // the built-in art (boxes, cursors)
import { setGlyphHook } from "../golf/text.js";
import { rb as romByte } from "../golf/rom.js";
export { HD };                                       // canvas pixels per screen pixel

const FONT = 0x50F0, WIDTHS = 0x5750, GLYPHS = 0x66; // bank 03: glyphs $20-$85
const BOLD = 0x42A0, BOLD_FROM = 0x20, BOLD_TO = 0x80; // bank 01 FontTiles: tile n = ASCII n (letters $20-$7F)
const BUSY_MS = 6;                                   // a repaint that takes longer than this, again and again, waits for the screen to settle
const rb = (rom, bank, addr) => rom[bank * 0x4000 + addr - 0x4000];
const keyOf = (b, o) => { let k = ""; for (let i = 0; i < 16; i++) k += String.fromCharCode(b[o + i]); return k; };

// ---- the glyph tracker: what the game's glyph renderer drew into each glyph tile ----
// content: tile bytes (16, as a string) -> [[glyph, x], ...] (x: the glyph's left column in that tile, -7..7). One map for every
// machine on the page (the content says what a tile holds, whichever machine drew it).
const content = new Map();
let blankKey = null, widths = null, pending = [];
function bufAt(w, de) {                              // the glyph tile under pen de: [bytes, offset of tile t, of tile t + 1] or null
  if (de & 0x8078) return null;                      // (a pen inside a row, or before the buffer: not text the reader follows)
  const off = de >> 3; if (off + 32 > 0x1000) return null;
  const b = w.wram[(w.high[0x196] & 7) || 1];
  return [b, off, off + 16];
}
function initFont(byte) {                           // the blank glyph tile (the buffer cleared) and the widths, from the ROM
  let k = ""; for (let i = 0; i < 16; i++) k += String.fromCharCode(byte(3, FONT + i));
  blankKey = k; content.set(blankKey, []);
  widths = [...Array(GLYPHS).keys()].map(g => byte(3, WIDTHS + g));
}
const glyphHook = {
  pre(w, a, de) {
    const at = bufAt(w, de); pending = [];
    if (!blankKey) initFont(romByte);
    if (!at) return;
    const [b, o0, o1] = at, k0 = keyOf(b, o0), k1 = keyOf(b, o1);
    pending = [content.has(k0) ? content.get(k0) : null, content.has(k1) ? content.get(k1) : null, k0, k1];
  },
  post(w, a, de) {
    const at = bufAt(w, de), g = (a - 0x20) & 0xFF;
    if (!at || !pending.length || g >= GLYPHS) return;   // (a space adds no glyph, the gaps give the words, but its colour-1 columns change the tile)
    const [b, o0, o1] = at, px = de & 7;
    const put = (o, pre, preKey, x) => {
      const k = keyOf(b, o); if (k === preKey || k === blankKey || pre === null) return;
      if (content.size > 30000) content.clear(), content.set(blankKey, []);
      content.set(k, g ? [...pre, [g, x]] : pre);
    };
    put(o0, pending[0], pending[2], px);
    if (px) put(o1, pending[1], pending[3], px - 8);
  },
};

setGlyphHook(glyphHook);                             // (from the start: the text on screen is known when the option is switched on)

// the glyphs the tracker knows for 16 tile bytes at b[o] (undefined: not a glyph tile it followed), for tests
export const glyphsOfTile = (b, o) => content.get(keyOf(b, o));

export class HDText {
  constructor(gb) {
    this.gb = gb; this.font = "game"; this.loaded = {};
    const rom = gb.mem.rom;
    if (!blankKey) initFont((b, a) => rb(rom, b, a));
    this.width = widths;
    this.bold = new Map();
    for (let g = BOLD_FROM; g < BOLD_TO; g++) {           // (glyphs without ink, the space aside, are fillers: no letters)
      const o = 1 * 0x4000 + BOLD - 0x4000 + g * 16; let ink = false; for (let i = 1; i < 16; i += 2) if (rom[o + i] & rom[o + i - 1]) ink = true;
      const k = keyOf(rom, o); if ((ink || g === BOLD_FROM) && !this.bold.has(k)) this.bold.set(k, String.fromCharCode(g));
    }
    this.canvas = { bg: makeCanvas(), win: makeCanvas(), spr: makeCanvas(), under: makeCanvas() };    // spr: HD art for sprites (2D draws it over the sprites)
    this.lines = []; this.key = ""; this.frame = -1; this.dirty = true; this.version = 0; this.sprVersion = 0; this.underVersion = 0; this.has = { bg: false, win: false, spr: false, under: false };
    this.ui = false; this.hideSprites = true; this.hiddenOam = new Set(); this.hiddenPx = new Uint8Array(160 * 144); this.through = []; this.okey = ""; this.screen = new Screen(gb); this.painted = false;     // HD UI (hdui.js): frames, cursors, icons
    this.offPainters = onPainterChange(() => { this.key = ""; this.dirty = true; });
    loadMenuModules();

  }
  setSpriteHide(on) { if (this.hideSprites !== !!on) { this.hideSprites = !!on; this.key = ""; this.dirty = true; } }
  setView3d(on) { if (this.in3d !== !!on) { this.in3d = !!on; this.key = ""; this.dirty = true; } }
  setUI(on) { this.ui = !!on; this.key = ""; this.dirty = true; }
  setFont(name) {
    this.font = FONTS[name] ? name : "game"; this.key = ""; this.dirty = true;
    const f = FONTS[this.font];
    if (f.file && !this.loaded[this.font] && typeof FontFace !== "undefined") {
      this.loaded[this.font] = "loading";
      const ff = new FontFace(f.family, `url(${new URL("../../" + f.file, import.meta.url)})`);
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
      if (this.pending) { this.pending = false; this.lines = textOn && this.readLines ? this.readLines : []; this.timedPaint(); return true; }
      return false;
    }
    this.frame = p.frames; this.dirty = false;
    const skey = this.screen.scan();
    let lines = [];
    // (read again when the tiles, the tracker or the palettes changed: a line's colours, and whether it shows at all, are the palette's)
    const pk = textOn ? String.fromCharCode.apply(null, p.bgPal) : "";
    if (textOn) { if (skey === this.readKey && this.readLines && this.readSize === content.size && pk === this.readPal) lines = this.readLines; else { lines = this.read(); this.readKey = skey; this.readLines = lines; this.readSize = content.size; this.readPal = pk; } }
    const key = this.font + "|" + uiOn + "|" + (uiOn ? skey + ":" + watchKey(this.screen) : "") + "|" + lines.map(l => `${l.x},${l.y},${l.win},${l.text},${l.c.join(",")}`).join("|");
    const okey = uiOn ? this.screen.oamKey(true) : "";
    if (key === this.key) {
      this.streak = 0;
      if (this.pending) { this.pending = false; this.lines = lines; this.timedPaint(); this.okey = okey; return true; }
      if (okey === this.okey) return false;
      this.okey = okey; this.paintSprites(); return true;
    }
    this.streak = (this.streak || 0) + 1;
    if (this.streak >= 3 && (this.paintMs > BUSY_MS || this.struggling)) {
      this.key = key; this.okey = okey; this.pending = true;
      if (this.painted) { this.lines = []; this.clearAll(); return true; }
      return false;
    }
    this.key = key; this.okey = okey; this.pending = false; this.lines = lines; this.timedPaint(); return true;
  }
  timedPaint() { const t = performance.now(); this.paint(); this.paintMs = (this.paintMs || 0) * 0.6 + (performance.now() - t) * 0.4; }
  clearAll() {
    for (const k of ["bg", "win", "spr", "under"]) { const cv = this.canvas[k]; if (cv) cv.getContext("2d").clearRect(0, 0, cv.width, cv.height); }
    this.version++; this.sprVersion++; this.underVersion++; this.has.bg = this.has.win = this.has.spr = this.has.under = false; this.painted = false; this.screen.underFresh = true;
    this.hiddenOam = new Set(); this.hiddenPx.fill(0); this.through = [];
  }

  // the text on screen: per band (a tile row of the BG or the window at one screen y), the glyphs of its visible cells (the tracker's
  // content of each cell's tile), joined into lines; the fixed-width font's words as lines of their own
  read() {
    const p = this.gb.ppu, m = this.gb.mem, v0 = m.vram[0], v1 = m.vram[1], lcdc = p.lcdc, bands = new Map(), vis = this.screen.vis;
    for (let k = 0; k < vis.length; k += 4) {
      const c = vis[k], x = vis[k + 1], y = vis[k + 2]; if (y <= -8 || y >= 144) continue;
      const bk = `${c & 0x8000 ? "w" : "b"}${y}`; let b = bands.get(bk);
      if (!b) bands.set(bk, b = { win: !!(c & 0x8000), y, cells: [] });
      b.cells.push({ c: c & 0x7FFF, x });
    }
    const out = [];
    for (const b of bands.values()) {
      b.cells.sort((a, c) => a.x - c.x);
      const glyphs = new Map();                         // absolute x -> [glyph, cell]
      const strips = []; let start = 0;
      for (let i = 0; i < b.cells.length; i++) {
        const cell = b.cells[i], attr = v1[cell.c], tile = v0[cell.c], bank = attr & 8 ? v1 : v0;
        const addr = lcdc & 0x10 ? tile << 4 : 0x1000 + ((tile << 24 >> 24) << 4);
        cell.key = attr & 0x60 ? null : keyOf(bank, addr);
        const list = cell.key !== null ? content.get(cell.key) : undefined;
        if (list) for (const [g, gx] of list) { const ax = cell.x + gx; if (!glyphs.has(ax)) glyphs.set(ax, [g, cell]); }
        if (i + 1 === b.cells.length || b.cells[i + 1].x !== cell.x + 8) { strips.push(b.cells.slice(start, i + 1)); start = i + 1; }
      }
      for (const s of strips) this.readBold(b, s, v1, out);
      if (!glyphs.size) continue;
      const xs = [...glyphs.keys()].sort((a, c) => a - c), ws = this.width[0] || 4;
      let line = null;
      const flush = () => {
        if (!line) return;
        const pal = v1[line.cell.c] & 7, c = [1, 2, 3].map(ci => col5(p.bgPal, pal, ci));
        if (!unseen(c)) out.push({ x: line.x, y: b.y, w: line.end - line.x, win: b.win, text: line.text, c });
        line = null;
      };
      for (const ax of xs) {
        const [g, cell] = glyphs.get(ax), gw = this.width[g] || 1, ch = String.fromCharCode(0x20 + g);
        if (line && ax >= line.end && ax - line.end <= ws * 3) { const n = Math.round((ax - line.end) / ws); line.text += " ".repeat(n) + ch; line.end = ax + gw; continue; }
        if (line && ax < line.end) { line.end = Math.max(line.end, ax + gw); continue; }   // (two glyphs on one place: kept as the first)
        flush(); line = { x: ax, end: ax + gw, text: ch, cell };
      }
      flush();
    }
    return out;
  }
  // the fixed-width font's words in a strip of cells (runs of its tiles, single spaces inside): lines of their own
  readBold(band, cells, v1, out) {
    const ch = cells.map(cell => cell.key === null ? null : this.bold.get(cell.key) ?? null);
    for (let k = 0; k < cells.length;) {
      if (ch[k] === null || ch[k] === " ") { k++; continue; }
      let e = k; while (e < cells.length && ch[e] !== null && !(ch[e] === " " && (e + 1 >= cells.length || ch[e + 1] === " " || ch[e + 1] === null))) e++;
      const text = ch.slice(k, e).join("");
      const c0 = cells[k], pal = v1[c0.c] & 7, c = [1, 2, 3].map(ci => col5(this.gb.ppu.bgPal, pal, ci));
      if (/[A-Za-z0-9]/.test(text) && !unseen(c)) out.push({ x: c0.x, y: band.y, w: (e - k) * 8, win: band.win, text, c, bold: true });
      k = e;
    }
  }

  // the canvases: the HD UI art (frames, cursors, icons: web/js/hd/hdui.js), then each text line's box colour over the old
  // glyphs (unless the UI art already covers the place) and the line in the HD font with the game's shadow
  paint() {
    const scr = this.screen, ui = this.ui, ctx = {}, drew = { bg: false, win: false, spr: false };
    for (const k of ["bg", "win", "spr"]) { const cv = this.canvas[k]; if (cv) { ctx[k] = cv.getContext("2d"); if (this.painted || this.everPainted) ctx[k].clearRect(0, 0, cv.width, cv.height); } }
    this.version++; this.sprVersion++;
    const f = FONTS[this.font], textOn = !!f.family && this.loaded[this.font] === true;
    // what the painters may need: the text lines read, the HD font, and masks of the pixels they cover
    scr.lines = this.lines; scr.font = textOn ? { family: f.family, em: f.em, base: f.base } : null;
    scr.textMask.fill(0); scr.opaque.fill(0); scr.claims = []; scr.hiddenStatic = new Set(); scr.canHide = this.hideSprites; scr.in3d = !!this.in3d; scr.actorOam = this.in3d ? this.actorOam || null : null;
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
      // a grid of bold rows stacked 8 px apart (the name-entry keyboard): each letter centred in its own 8 px cell, smaller,
      // so the rows have room between them and the letters stay under the cursor
      if (l.bold && this.lines.some(o => o !== l && o.bold && o.win === l.win && Math.abs(o.y - l.y) === 8 && o.x < l.x + l.w && l.x < o.x + o.w)) {
        const ge = f.em * 0.6, k = ge / f.em, o = HD * 0.6;
        g.font = `${ge * HD}px "${f.family}"`; g.textBaseline = "alphabetic"; g.textAlign = "center";
        for (let i = 0; i < l.text.length; i++) {
          const ch = l.text[i]; if (ch === " ") continue;
          const cw = g.measureText(ch).width, s = cw > 7.2 * HD ? 7.2 * HD / cw : 1;
          g.save(); g.translate((l.x + i * 8 + 4) * HD, (l.y + 4 + (f.base - 4) * k) * HD); g.scale(s, 1);
          g.fillStyle = sh; g.fillText(ch, o, o); g.fillStyle = ink; g.fillText(ch, 0, 0);
          g.restore();
        }
        g.textAlign = "start"; continue;
      }
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
    scr.readOam(); scr.canHide = this.hideSprites; scr.actorOam = this.in3d ? this.actorOam || null : null;   // (3D field: the OAM entries of the people in the scene)
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
        for (const o of below) { if (X < o.x || X >= o.x + 8 || Y < o.y || Y >= o.y + o.h) continue; const v = o.rgba[(Y - o.y) * 8 + X - o.x]; if (v) { this.through.push(Y * 160 + X, v); break; } }
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
// a line whose palette draws its ink and its shadow in (nearly) its box's colour shows (next to) nothing on the game's screen (a fade
// to white or black: the new character's room, map $1E, comes in with the stars' map already pointing at the character select's font
// tiles, which read as "FGFGFGFGF45GFG..." in ink 3 steps of blue off the box's white): not read, so the HD font draws nothing there
const near = (a, b) => Math.abs((a & 31) - (b & 31)) <= 4 && Math.abs((a >> 5 & 31) - (b >> 5 & 31)) <= 4 && Math.abs((a >> 10 & 31) - (b >> 10 & 31)) <= 4;
const unseen = c => near(c[0], c[1]) && near(c[0], c[2]);
const col5 = (pal, p, i) => { const o = p * 8 + i * 2; return pal[o] | (pal[o + 1] << 8); };
const css = c => `rgb(${(c & 31) * 8},${(c >> 5 & 31) * 8},${(c >> 10 & 31) * 8})`;
