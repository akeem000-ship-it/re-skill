// Asset extraction (runs in the browser on the user's ROM). Mirrors tools/render_map.py,
// tools/render_sprites.py, tools/dump_char_stats.py, tools/dump_shot_tables.py.
import { palettes, tilePixel } from "./rom.js";

export const ROSTER = ["Alex", "Nina", "Harry", "Kate", "Allie", "Joy", "Brian", "Pam", "Bob", "Beth", "Fay",
  "Curt", "Mark", "Sean", "Sammi", "Elden", "Spike", "Emily", "B. Coz", "A. Coz", "Kevin",
  "(unused)", "(unused)", "Luigi", "DK", "Baby Mario", "Mario", "Waluigi", "Yoshi", "Bowser", "Wario", "Peach"];
export const PLAYABLE = [26, 23, 31, 28, 25, 24, 27, 30, 29];   // Mushroom Kingdom cast
export const COURTS = [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15];
export const TYPES = ["Power", "Technique", "All-Around", "Tricky", "Speed", "???"];
export const STATS = ["Top", "Slice", "Serve", "Stroke", "Volley", "Angle", "Placement", "Speed", "Dash", "Reaction", "Stop"];

// LoadMap 0A:585D, descriptor table 0A:59D9 (8 x (idx, bank) refs per map)
// the court tilemaps (first 32 columns of each row, 32 rows) for scene detection against VRAM
export function courtTilemaps(rom) {
  const out = {};
  for (const id of COURTS) {
    const base = 0x59D9 + id * 16, mi = rom.u8(0x0A, base + 4), mb = rom.u8(0x0A, base + 5);
    try {
      const tmap = rom.lzRef(mi, mb), S = tmap.length >= 4096 ? 64 : 32, m = new Uint8Array(1024);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) m[y * 32 + x] = tmap[y * S + x];
      out[id] = m;
    } catch (e) { /* skip undecodable */ }
  }
  return out;
}
// the court's 256x256 BG picture as palette indices from the ROM (tiles, tilemap, attributes): one byte per pixel,
// (palette << 2 | colour) + 1, so a renderer can colour it with the live palettes (fades) while text boxes and
// captions written into the VRAM map never reach it
export function courtIndexMap(rom, id) {
  const base = 0x59D9 + id * 16, ref = i => [rom.u8(0x0A, base + i * 2), rom.u8(0x0A, base + i * 2 + 1)];
  const [mi, mb] = ref(2), [ai, ab] = ref(3), [ti, tb] = ref(7);
  const tmap = rom.lzRef(mi, mb), attr = rom.lzRef(ai, ab), tiles = rom.lzRef(ti, tb), S = tmap.length >= 4096 ? 64 : 32;
  const vram = new Uint8Array(0x1800);
  vram.set(tiles.subarray(0, 0x800), 0x1000); vram.set(tiles.subarray(0x800, 0x1000), 0x800);
  const out = new Uint8Array(256 * 256);
  for (let ty = 0; ty < 32; ty++) for (let tx = 0; tx < 32; tx++) {
    const i = ty * S + tx, t = tmap[i], at = attr[i], off = 0x1000 + (t < 128 ? t : t - 256) * 16;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const sx = at & 0x20 ? 7 - x : x, sy = at & 0x40 ? 7 - y : y;
      out[(ty * 8 + y) * 256 + tx * 8 + x] = ((at & 7) << 2 | tilePixel(vram, off, sx, sy)) + 1;
    }
  }
  return out;
}
export function courtImage(rom, id) {
  const base = 0x59D9 + id * 16, ref = i => [rom.u8(0x0A, base + i * 2), rom.u8(0x0A, base + i * 2 + 1)];
  const [pi, pb] = ref(1), [mi, mb] = ref(2), [ai, ab] = ref(3), [ti, tb] = ref(7);
  const pal = palettes(rom.rawRef(pi, pb, 64));
  const tmap = rom.lzRef(mi, mb), attr = rom.lzRef(ai, ab), tiles = rom.lzRef(ti, tb);
  const S = tmap.length >= 4096 ? 64 : 32;
  const vram = new Uint8Array(0x1800);            // VRAM1 $8000-$97FF
  vram.set(tiles.subarray(0, 0x800), 0x1000);     // first 2 KB -> $9000
  vram.set(tiles.subarray(0x800, 0x1000), 0x800); // next -> $8800 (signed indexing)
  const c = document.createElement("canvas"); c.width = c.height = S * 8;
  const g = c.getContext("2d"), img = g.createImageData(S * 8, S * 8);
  for (let ty = 0; ty < S; ty++) for (let tx = 0; tx < S; tx++) {
    const i = ty * S + tx, t = tmap[i], at = attr[i];
    const off = 0x1000 + (t < 128 ? t : t - 256) * 16, p = pal[at & 7];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const sx = at & 0x20 ? 7 - x : x, sy = at & 0x40 ? 7 - y : y;
      const col = p[tilePixel(vram, off, sx, sy)], o = ((ty * 8 + y) * S * 8 + tx * 8 + x) * 4;
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// Full screens: LoadScreen 39:407E, table 39:40F5, 8 bytes per screen = 4 (idx, bank) refs:
// tiles (LZ, signed indexing like the courts), 32x32 tilemap (LZ), attributes (LZ), 64-byte palette.
// Returns the visible 20x18-tile window (160x144) at scroll 0.
export function screenImage(rom, id) {
  const base = 0x40F5 + id * 8, ref = i => [rom.u8(0x39, base + i * 2), rom.u8(0x39, base + i * 2 + 1)];
  const [ti, tb] = ref(0), [mi, mb] = ref(1), [ai, ab] = ref(2), [pi, pb] = ref(3);
  const tiles = rom.lzRef(ti, tb), tmap = rom.lzRef(mi, mb), attr = rom.lzRef(ai, ab);
  const pal = palettes(rom.rawRef(pi, pb, 64));
  const vram = new Uint8Array(0x1800);
  vram.set(tiles.subarray(0, 0x800), 0x1000);
  vram.set(tiles.subarray(0x800, 0x1000), 0x800);
  const c = document.createElement("canvas"); c.width = 160; c.height = 144;
  const g = c.getContext("2d"), img = g.createImageData(160, 144);
  for (let ty = 0; ty < 18; ty++) for (let tx = 0; tx < 20; tx++) {
    const i = ty * 32 + tx, t = tmap[i], at = attr[i];
    const off = 0x1000 + (t < 128 ? t : t - 256) * 16, p = pal[at & 7];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const sx = at & 0x20 ? 7 - x : x, sy = at & 0x40 ? 7 - y : y;
      const col = p[tilePixel(vram, off, sx, sy)], o = ((ty * 8 + y) * 160 + tx * 8 + x) * 4;
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// Character sprites: RosterToSprite 07:5A50, CharSpriteTable 04:4F75, header +0 = colour scheme
// (18:4300), +4 frame pointer list; frames = 12 tiles drawn as 8x16 OBJs column-major (24x32).
export function characterSprites(rom, roster) {
  const sid = rom.u8(0x07, 0x5A50 + roster);
  const idx = rom.u8(0x04, 0x4F75 + sid * 2), bank = rom.u8(0x04, 0x4F76 + sid * 2);
  const hdr = rom.tableEntry(bank, idx);
  const scheme = rom.u8(bank, hdr), framePtrs = rom.u16(bank, hdr + 4), info = rom.u16(bank, hdr + 10);
  const pal = palettes(rom.slice(0x18, 0x4300 + (Math.min(7, Math.max(3, scheme)) - 3) * 8, 8), 1)[0];
  const cache = new Map();
  const frame = (n, flip = false) => {
    const key = n * 2 + (flip ? 1 : 0);
    if (cache.has(key)) return cache.get(key);
    const ptr = rom.u16(bank, framePtrs + n * 2), ntiles = rom.u8(bank, info + n * 4 + 3) || 12;
    const data = rom.slice(bank, ptr, ntiles * 16), cols = Math.ceil(ntiles / 4);
    const c = document.createElement("canvas"); c.width = cols * 8; c.height = 32;
    const g = c.getContext("2d"), img = g.createImageData(c.width, 32);
    for (let t = 0; t < ntiles; t++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const v = tilePixel(data, t * 16, x, y); if (!v) continue;
      const px = (t >> 2) * 8 + x, dx = flip ? c.width - 1 - px : px, o = (((t & 3) * 8 + y) * c.width + dx) * 4;
      img.data[o] = pal[v][0]; img.data[o + 1] = pal[v][1]; img.data[o + 2] = pal[v][2]; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    cache.set(key, c);
    return c;
  };
  // animation table (header +6): word per animation id; scripts read by AnimTick 08:7791
  const animTable = rom.u16(bank, hdr + 6);
  const anim = id => rom.u16(bank, animTable + id * 2);
  const entry = a => [rom.u8(bank, a), rom.u8(bank, a + 1)];
  return { sid, bank, frame, anim, entry };
}

// Animation player with the ROM's rules (08:69EA SetAnimation, 08:7791 AnimTick): entries
// [group, duration]; [$FF, n] restart at start + n; [$FE, id] switch animation; [$FB, m] toggle
// horizontal flip; any other $Fx holds. Frame number = group * 5 + view (08:7621).
export class Animator {
  constructor(sprites) { this.s = sprites; this.id = -1; this.group = 0; this.flip = false; this.timer = 0; }
  set(id) {
    if (id === this.id) return;
    this.id = id; this.start = this.ptr = this.s.anim(id); this.timer = 0; this.flip = false; this.hold = false;
  }
  tick() {
    if (this.hold || --this.timer > 0) return;
    for (let guard = 0; guard < 32; guard++) {
      const [f, d] = this.s.entry(this.ptr);
      if (f < 0xF0) { this.group = f; this.timer = d; this.ptr += 2; return; }
      if (f === 0xFF) this.ptr = this.start + d;
      else if (f === 0xFE) { this.id = -1; this.set(d); }
      else if (f === 0xFB) { this.flip = !!(d & 0x20); this.ptr += 2; }
      else { this.hold = true; return; }
    }
  }
}

// Dialogue font (REVERSE.md "Font and printer"): 91 glyphs $20-$7A, 8x8 2bpp at 05:7920, widths 05:7F80.
// Returns { width(str), draw(ctx, str, x, y, ink, shade) }; colour 2 (cell background) is transparent.
export function gameFont(rom) {
  const cache = new Map();
  const glyph = (ch, ink, shade) => {
    const key = ch + ink + shade; if (cache.has(key)) return cache.get(key);
    const i = Math.max(0, Math.min(90, ch.charCodeAt(0) - 0x20)), data = rom.slice(0x05, 0x7920 + i * 16, 16);
    const c = document.createElement("canvas"); c.width = 8; c.height = 8;
    const g = c.getContext("2d"), img = g.createImageData(8, 8);
    const rgb = { 1: shade, 3: ink };
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const v = (data[y * 2] >> (7 - x) & 1) | (data[y * 2 + 1] >> (7 - x) & 1) << 1, col = rgb[v];
      if (!col) continue;
      const o = (y * 8 + x) * 4; img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0); cache.set(key, c); return c;
  };
  const w = ch => rom.u8(0x05, 0x7F80 + Math.max(0, Math.min(90, ch.charCodeAt(0) - 0x20)));
  return {
    width: str => [...str].reduce((a, ch) => a + w(ch), 0),
    draw(ctx, str, x, y, ink = [248, 248, 248], shade = [40, 40, 72]) {
      for (const ch of str) { ctx.drawImage(glyph(ch, ink, shade), x, y); x += w(ch); }
    },
  };
}

// ---- menu building blocks (REVERSE.md "Menus") -------------------------------------------------
const canvasCache = new Map();
export function newCanvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }

// Draw 8x8 2bpp tiles `indices` (laid out `cols` wide) from `tiles` into a new canvas. pal = 4 [r,g,b];
// transparent: colour 0 is left clear (sprites). flipX/flipY apply per tile (OAM-style).
export function tilesCanvas(tiles, indices, cols, pal, { transparent = false, flipX = false, flipY = false } = {}) {
  const rows = Math.ceil(indices.length / cols), c = newCanvas(cols * 8, rows * 8), g = c.getContext("2d");
  const img = g.createImageData(c.width, c.height);
  indices.forEach((t, k) => {
    const ox = (k % cols) * 8, oy = Math.floor(k / cols) * 8;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const v = tilePixel(tiles, t * 16, flipX ? 7 - x : x, flipY ? 7 - y : y);
      if (transparent && !v) continue;
      const o = ((oy + y) * c.width + ox + x) * 4, col = pal[v];
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
    }
  });
  g.putImageData(img, 0, 0);
  return c;
}
export function cached(key, make) { if (!canvasCache.has(key)) canvasCache.set(key, make()); return canvasCache.get(key); }
export const palKey = pal => pal.map(c => c.join(".")).join("/");

// 8x8 fixed-width UI font: raw 2bpp glyphs $20-$7F at 01:4410 (colour 1 = background, 3 = ink, 2 = shadow).
export function uiFont(rom) {
  const glyphs = rom.slice(0x01, 0x4410, 96 * 16);
  return {
    draw(ctx, str, x, y, pal) {
      for (const ch of str) {
        const i = Math.max(0, Math.min(95, ch.charCodeAt(0) - 0x20));
        ctx.drawImage(cached("ui" + i + palKey(pal), () => tilesCanvas(glyphs, [i], 1, pal)), x, y); x += 8;
      }
    },
  };
}

// LoadIconTiles 39:468B: icon id -> (idx, bank) ref table 39:46B7 -> LZ block of 8x8 tiles.
export function iconTiles(rom, id) {
  return rom.lzRef(rom.u8(0x39, 0x46B7 + id * 2), rom.u8(0x39, 0x46B8 + id * 2));
}

// Character OBJ palette: sprite header +0 = colour scheme 3..7 -> 18:4300 + (scheme-3)*8.
export function charPalette(rom, roster) {
  const sid = rom.u8(0x07, 0x5A50 + roster);
  const idx = rom.u8(0x04, 0x4F75 + sid * 2), bank = rom.u8(0x04, 0x4F76 + sid * 2);
  const scheme = rom.u8(bank, rom.tableEntry(bank, idx));
  return palettes(rom.slice(0x18, 0x4300 + (Math.min(7, Math.max(3, scheme)) - 3) * 8, 8), 1)[0];
}
export const greyPalette = pal => pal.map(([r, g, b]) => { const l = Math.round(0.3 * r + 0.59 * g + 0.11 * b); return [l, l, l]; });

// Portrait (16x16 face) from the raw sheet 18:5AF0 + roster*64: tiles 0,1 = left column, 2,3 = right.
export function facePortrait(rom, roster, pal) {
  return cached("face" + roster + palKey(pal), () => {
    const t = rom.slice(0x18, 0x5AF0 + roster * 64, 64);
    const c = newCanvas(16, 16), g = c.getContext("2d");
    g.drawImage(tilesCanvas(t, [0, 1], 1, pal, { transparent: true }), 0, 0);
    g.drawImage(tilesCanvas(t, [2, 3], 1, pal, { transparent: true }), 8, 0);
    return c;
  });
}

// Text banks: $4000 stub -> ld hl,$4004 table; offsets relative to TEXT_BASE (tools/dump_text.py).
const textInfo = new Map();
export function getText(rom, bank, idx) {
  if (!textInfo.has(bank)) {
    const stub = rom.u16(bank, 0x4000), call = rom.u16(bank, stub + 4);
    const seq = rom.slice(bank, call, 0x20);
    let i = 0; while (!(seq[i] === 0x56 && seq[i + 1] === 0x21)) i++;
    const base = seq[i + 2] | seq[i + 3] << 8;
    let j = 0; while (seq[j] !== 0x21) j++;
    textInfo.set(bank, { tab: seq[j + 1] | seq[j + 2] << 8, base });
  }
  const { tab, base } = textInfo.get(bank);
  let a = base + rom.u16(bank, tab + idx * 2), s = "";
  for (let n = 0; n < 200; n++) {
    const c = rom.u8(bank, a++);
    if (c === 0 || c === 3) break;
    s += c === 1 || c === 2 ? " " : c >= 0x20 && c < 0x7F ? String.fromCharCode(c) : "";
  }
  return s;
}

// Palette set of a LoadScreen entry (ref 3 of 39:40F5).
export function screenPalettes(rom, id) {
  const base = 0x40F5 + id * 8;
  return palettes(rom.rawRef(rom.u8(0x39, base + 6), rom.u8(0x39, base + 7), 64));
}

// CharRecords 02:52CE (29 B, roster order); stats = bytes 18..28; type table 38:58FB
export function characterData(rom, roster) {
  const base = 0x52CE + roster * 29, st = {};
  STATS.forEach((n, i) => st[n] = rom.u8(0x02, base + 18 + i));
  return { roster, name: ROSTER[roster], type: TYPES[rom.u8(0x38, 0x58FB + roster)] || "?", stats: st,
    // stat -> parameter formulas verified in WRAM4/5 (REVERSE.md "Player struct")
    run256: 2560 + 128 * st.Speed, dash: 48 + 12 * st.Dash, brake: (64 + 32 * st.Stop) / 256,
    runSpeed: 10.5 + st.Speed / 2,
    reaction: 6 + st.Reaction, aimError: 12 - st.Placement,
    // record bytes +2/+3 and +4/+5 (REVERSE.md "Record bytes +0..+17"): height reach (word - 16) and side reach
    heightReach: rom.u16(0x02, base + 2) - 16, sideReach: rom.u16(0x02, base + 4),
    // byte +1 -> wDF7F: CPU plan mode (0 Yoshi/Bowser, 1 most, 2 Waluigi), see REVERSE.md "CPU AI"
    cpuMode: rom.u8(0x02, base + 1),
    jump: rom.u16(0x02, base + 6) + 0x200,              // wDF74: vertical speed of the jump for a high ball (08:6DD5)
    lungeSpeed: rom.u16(0x02, base + 8) & 0xFF };       // wDF76: lunge dash speed, px/frame (08:6E0F)
}

// shot tables in bank 07 (8-byte rows: topspin, sidespin, speed 8.8)

// Point-score glyphs (REVERSE.md "Score display between points"): raw 8x16 glyph columns in bank 09
// ($6000+, 32 bytes each). The left glyph of the "15 . 40" strip carries the separator dot on its right
// edge (row 4 cells), the right glyph is the dot-less set (rows 0-1).
// Point-score glyph strips (bank 09 font, raw 8x16 columns, 32 bytes each). Three sets exist in the
// font: a dot-less set at $6180-$62A0 (unused here), a "left of the dot" set at $6540-$6660 and a
// "right of the dot" set at $6880-$69A0. The live strip for "0 . 40" uses $6540/$6560 + $6940/$6960.
const SCORE_GLYPH_BASE = { left: 0x6540, right: 0x6880 };
const SCORE_GLYPH_ORDER = ["0", "15", "30", "40", "AD"];
const SCORE_GLYPHS = {};
for (const side of ["left", "right"]) {
  SCORE_GLYPHS[side] = {};
  SCORE_GLYPH_ORDER.forEach((t, i) => { const a = SCORE_GLYPH_BASE[side] + i * 0x40; SCORE_GLYPHS[side][t] = [a, a + 0x20]; });
}
export function scoreGlyph(rom, text, side, pal) {
  const set = SCORE_GLYPHS[side];
  if (!set) throw new Error(`scoreGlyph: bad side ${side}`);
  const cols = set[text];
  if (!cols) throw new Error(`scoreGlyph: no glyph for ${text}`);
  return cached(`scoreglyph:${side}:${text}:${palKey(pal)}`, () => {
    const tiles = new Uint8Array(cols.length * 32);
    cols.forEach((a, i) => tiles.set(rom.slice(0x09, a, 32), i * 32));
    const idx = []; for (let r = 0; r < 2; r++) for (let k = 0; k < cols.length; k++) idx.push(2 * k + r);   // column k = tiles 2k (top), 2k+1 (bottom)
    return tilesCanvas(tiles, idx, cols.length, pal, { transparent: true });
  });
}
