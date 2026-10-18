// Random fans for the 3D stadium's crowd, in the style of the game's own characters. Each fan is the front-facing standing frame (and, for
// the ones that hop, the cheering frame) of one of the 30 match characters, read from the ROM at runtime (nothing derived from it is stored),
// recoloured at random: the head's cream becomes a skin tone and the character's main colour its hair, the body's main colour a shirt;
// the black outline stays. Fans are flipped at random. The result is one RGBA atlas (two cells per fan: calm, cheering) for stadium3d.js.
import { decodeColMajor } from "./look/gfx.js";

const OBJECT_LIST = [0x04, 0x4F75], SCHEMES = [0x18, 0x4300], CALM = 4, CHEER = 9;
const off = (bank, addr) => addr < 0x4000 ? addr : bank * 0x4000 + (addr - 0x4000);
const u16 = (rom, bank, addr) => { const o = off(bank, addr); return rom[o] | rom[o + 1] << 8; };
const rgb = c => [(c & 31) * 255 / 31 | 0, ((c >> 5) & 31) * 255 / 31 | 0, ((c >> 10) & 31) * 255 / 31 | 0];
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export const SKIN = [[255, 228, 196], [248, 204, 164], [226, 172, 124], [196, 134, 86], [156, 100, 60], [118, 72, 44], [84, 52, 34]];
export const HAIR = [[24, 20, 24], [64, 40, 24], [120, 72, 32], [216, 168, 72], [200, 64, 40], [240, 120, 40], [64, 88, 208], [48, 152, 80], [208, 88, 168], [208, 208, 220]];
export const SHIRT = [[224, 48, 48], [240, 136, 40], [248, 208, 56], [56, 168, 80], [48, 112, 224], [128, 72, 200], [240, 240, 240], [48, 48, 64], [232, 104, 160], [40, 176, 184]];

// the match frame k of character sprite set c as it is in the ROM: { im: {w, h, px}, base } (column-major 8x8 tiles, 4 rows: the tile of
// pixel (x, y) is at base + ((x >> 3) * 4 + (y >> 3)) * 16), or null (intro.js: the VS screen, coloured like the match)
export function matchFrameRaw(rom, c, k) {
  const w = u16(rom, OBJECT_LIST[0], OBJECT_LIST[1] + 2 * c), bank = w >> 8, hdr = u16(rom, bank, 0x4000 + (w & 0xFF));
  const frames = u16(rom, bank, hdr + 4), info = u16(rom, bank, hdr + 10);
  const ptr = u16(rom, bank, frames + 2 * k); if (ptr < 0x4000 || ptr >= 0x8000) return null;
  const ntiles = info ? rom[off(bank, info + 4 * k + 3)] : 12, cols = Math.max(1, Math.min(4, ((ntiles || 12) + 3) >> 2));
  return { im: decodeColMajor(rom, off(bank, ptr), cols, 4), base: off(bank, ptr) };
}
// the match frame k of character sprite set c as { w, h, px (indices 0-3), pal (4 x rgb) } trimmed to its pixels
function matchFrame(rom, c, k) {
  const w = u16(rom, OBJECT_LIST[0], OBJECT_LIST[1] + 2 * c), bank = w >> 8, hdr = u16(rom, bank, 0x4000 + (w & 0xFF));
  const frames = u16(rom, bank, hdr + 4), info = u16(rom, bank, hdr + 10), slot = rom[off(bank, hdr)];
  const ptr = u16(rom, bank, frames + 2 * k); if (ptr < 0x4000 || ptr >= 0x8000) return null;
  const ntiles = info ? rom[off(bank, info + 4 * k + 3)] : 12, cols = Math.max(1, Math.min(4, ((ntiles || 12) + 3) >> 2));
  const im = decodeColMajor(rom, off(bank, ptr), cols, 4);
  let pal; if (slot >= 3 && slot <= 7) { const o = off(SCHEMES[0], SCHEMES[1]) + (slot - 3) * 8; pal = [0, 1, 2, 3].map(i => rgb(rom[o + 2 * i] | rom[o + 2 * i + 1] << 8)); } else pal = [[255, 255, 255], [248, 248, 220], [140, 140, 140], [0, 0, 0]];
  let x0 = im.w, x1 = -1, y0 = im.h, y1 = -1;
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) if (im.px[y * im.w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) return null;
  const W = x1 - x0 + 1, H = y1 - y0 + 1, px = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px[y * W + x] = im.px[(y0 + y) * im.w + x0 + x];
  return { w: W, h: H, px, pal };
}

export const CELL = 32, ATLAS_COLS = 16;
// n random fans (two cells each: calm, cheering); returns { w, h, data: Uint8Array RGBA, n, cols, rows, hops: Uint8Array(n) }
export function buildFanAtlas(rom, seed = 1, n = 96) {
  const R = mulberry32(seed), sets = [];
  for (let c = 0; c < 30; c++) { try { const a = matchFrame(rom, c, CALM), b = matchFrame(rom, c, CHEER); if (a) sets.push([a, b || a]); } catch (e) { /* no such set */ } }
  if (!sets.length) return null;
  const cells = n * 2, cols = ATLAS_COLS, rows = Math.ceil(cells / cols), W = cols * CELL, H = rows * CELL, data = new Uint8Array(W * H * 4), hops = new Uint8Array(n);
  const pick = a => a[Math.floor(R() * a.length)];
  for (let i = 0; i < n; i++) {
    const [calm, cheer] = pick(sets), skin = pick(SKIN), hair = pick(HAIR), shirt = pick(SHIRT), flip = R() < 0.5; hops[i] = R() < 0.34 ? 1 : 0;
    for (let s = 0; s < 2; s++) {
      const f = s ? cheer : calm, cell = i * 2 + s, ox = (cell % cols) * CELL + ((CELL - f.w) >> 1), oy = ((cell / cols) | 0) * CELL, split = Math.round(f.h * 0.45);
      for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
        const v = f.px[y * f.w + x]; if (!v) continue;
        let c = v === 3 ? [24, 16, 24] : v === 1 ? (y < split ? skin : [255, 255, 230]) : (y < split ? hair : shirt);
        const X = ox + (flip ? f.w - 1 - x : x), o = ((oy + y) * W + X) * 4; data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
      }
    }
  }
  return { w: W, h: H, data, n, cols, rows, hops };
}
