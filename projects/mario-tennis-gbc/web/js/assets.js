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

// CharRecords 02:52CE (29 B, roster order); stats = bytes 18..28; type table 38:58FB
export function characterData(rom, roster) {
  const base = 0x52CE + roster * 29, st = {};
  STATS.forEach((n, i) => st[n] = rom.u8(0x02, base + 18 + i));
  return { roster, name: ROSTER[roster], type: TYPES[rom.u8(0x38, 0x58FB + roster)] || "?", stats: st,
    // stat -> parameter formulas verified in WRAM4/5 (REVERSE.md "Player struct")
    run256: 2560 + 128 * st.Speed, dash: 48 + 12 * st.Dash, brake: (64 + 32 * st.Stop) / 256,
    runSpeed: 10.5 + st.Speed / 2,
    reaction: 6 + st.Reaction, aimError: 12 - st.Placement };
}

// shot tables in bank 07 (8-byte rows: topspin, sidespin, speed 8.8)
export function shotRow(rom, table, row) {
  const a = table + Math.max(0, Math.min(9, row)) * 8;
  return { top: rom.s16(0x07, a), side: rom.s16(0x07, a + 2), speed: rom.u16(0x07, a + 4) / 256 };
}
export const SHOT = { serveTop: 0x5071, serveSlice: 0x50C1, serveFlat: 0x5111, strokeTop: 0x4F61, strokeSlice: 0x4FB1, strokeFlat: 0x4F11 };
