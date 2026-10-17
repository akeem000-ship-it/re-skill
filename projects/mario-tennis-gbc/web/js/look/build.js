// Look generator: from the user's ROM bytes and a look, the edits to the in-memory ROM copy (restyled frames and
// HUD heads; the LZ portrait streams are never rewritten) and the region planes the renderer colours the hero with
// (the redrawn portraits and faces come from faces.js). Runs at ROM load; nothing
// derived from the ROM is stored in the repository. Addresses: REVERSE.md and the creator research
// (walk sprites banks $70/$74, match sprites banks $40/$41, portraits $16/$1B, HUD heads $18).
import { decodeColMajor, encodeColMajor, cellOf, clone } from "./gfx.js";
import { REG, labelSprite, applyStyle, applyTouchups } from "./label.js";
import { TOUCHUPS } from "./touchups.js";
import { buildMods } from "./mods.js";
import { faceAssets } from "./faces.js";
import { hairTones } from "./portrait.js";

export const off = (bank, addr) => addr < 0x4000 ? addr : bank * 0x4000 + (addr - 0x4000);
export const u16 = (rom, bank, addr) => { const o = off(bank, addr); return rom[o] | rom[o + 1] << 8; };

export const HEROES = {
  alex: { id: 0, walk: [0x70, 0x4040, 12], walkB: [0x74, 0x4E20, 6], match: 0x40,
          portraits: [[0x16, 0x69A8, 0x6968, 2], [0x1B, 0x44B1, 0x4CEC, 4]], winlose: [[0x16, 0x6101], [0x16, 0x6214]], heads: [0x5AF0, 0x62F0] },
  nina: { id: 1, walk: [0x70, 0x4CE0, 12], walkB: [0x74, 0x5490, 6], match: 0x41,
          portraits: [[0x16, 0x6A46, 0x6968, 2], [0x1B, 0x454F, 0x4CEC, 4]], winlose: [[0x16, 0x6315], [0x16, 0x6422]], heads: [0x5B30, 0x6330] },
};
const WINLOSE_TABLE = [0x16, 0x60F1];                       // WinLosePortraitVariantTable_16: 8 words

// sanity: the ROM is the one these addresses belong to (pointer tables point at the streams we patch)
export function checkRom(rom) {
  if (rom.length < 0x200000) return false;
  for (const h of Object.values(HEROES)) {
    if (u16(rom, 0x70, 0x4000 + 2 * h.id) !== (h.id ? 0x4CB1 : 0x400E)) return false;         // walk headers
    if (u16(rom, h.match, 0x4006) !== 0x400E) return false;
    const [b, a, t, s] = h.portraits[0]; if (u16(rom, b, t + s * h.id) !== a) return false;
    const [b1, a1, t1, s1] = h.portraits[1]; if (u16(rom, b1, t1 + s1 * h.id) !== a1) return false;
    for (let k = 0; k < 2; k++) if (u16(rom, WINLOSE_TABLE[0], WINLOSE_TABLE[1] + 2 * (h.id * 2 + k)) !== h.winlose[k][1]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------- one hero
function heroAssets(rom, name, style) {
  const h = HEROES[name], out = { raw: [] };     // raw: { off, bytes, regions: Map(tileOff -> plane) }
  const T = TOUCHUPS[name] || {};
  const touch = (st, key) => { applyTouchups(st, (T[key] || {})["*"]); applyTouchups(st, (T[key] || {})[style]); };
  const finish = (st, key) => { applyStyle(st, style); touch(st, key); return st; };
  // overworld walk frames: 4 facings of 16x16 (two 8x16 objects) per 256-byte frame
  for (const [bank, addr, n] of [h.walk, h.walkB]) {
    const base = off(bank, addr), bytes = rom.slice(base, base + n * 256), regions = new Map();
    for (let f = 0; f < n; f++) for (let fc = 0; fc < 4; fc++) {
      const o = f * 256 + fc * 64, im = decodeColMajor(bytes, o, 2, 2);
      const st = finish(labelSprite(im, name, "walk"), `walk${bank === h.walk[0] && addr === h.walk[1] ? "" : "B"}:${f}:${fc}`);
      encodeColMajor({ w: 16, h: 16, px: st.idx }, 2, 2, bytes, o);
      for (let cx = 0; cx < 2; cx++) for (let cy = 0; cy < 2; cy++) regions.set(base + o + (cx * 2 + cy) * 16, cellOf(st.reg, 16, cx, cy));
    }
    out.raw.push({ off: base, bytes, regions });
  }
  // match frames: the unique frames of the 145 (group, view) slots; 24x32 (or 32x32) body + shadow tiles
  const B = h.match, seen = new Set();
  for (let slot = 0; slot < 145; slot++) {
    const a = u16(rom, B, 0x400E + 2 * slot); if (seen.has(a)) continue; seen.add(a);
    const cols = rom[off(B, 0x7CE0 + 4 * slot + 2)] ? 4 : 3, base = off(B, a), size = cols * 64 + cols * 16;
    const bytes = rom.slice(base, base + size), regions = new Map();
    const body = decodeColMajor(bytes, 0, cols, 4);
    const st = finish(labelSprite(body, name, "match"), `match:${a.toString(16)}`);
    encodeColMajor({ w: cols * 8, h: 32, px: st.idx }, cols, 4, bytes, 0);
    for (let cx = 0; cx < cols; cx++) for (let cy = 0; cy < 4; cy++) regions.set(base + (cx * 4 + cy) * 16, cellOf(st.reg, cols * 8, cx, cy));
    // the standing-shadow tiles replace each column's bottom tile: label a copy with them in place
    const alt = clone(body), sh = decodeColMajor(bytes.subarray(cols * 64), 0, cols, 1);
    for (let c = 0; c < cols; c++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) alt.px[(24 + y) * alt.w + c * 8 + x] = sh.px[y * sh.w + c * 8 + x];
    const st2 = finish(labelSprite(alt, name, "match"), `match:${a.toString(16)}`);
    const shOut = { w: cols * 8, h: 8, px: st2.idx.subarray(24 * cols * 8) };
    encodeColMajor(shOut, cols, 1, bytes, cols * 64);
    for (let c = 0; c < cols; c++) regions.set(base + cols * 64 + c * 16, cellOf(st2.reg, cols * 8, c, 3));
    out.raw.push({ off: base, bytes, regions });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- the look
// look: { boy: { style, colours: { skin, hair, hat, top, bottom, shoes, racket } } | null, girl: ... }, colours as BGR555 ints
// -> { patches: [{ off, bytes }], tileRegions: Map(romOffset -> Uint8Array(64)), contentRegions: Map(hash -> [{bytes, plane}]),
//      colours: Uint16Array(32) indexed by hero * 16 + region (0xFFFF: keep the game's colour), basePalettes }
export function buildLook(rom, look) {
  const res = { patches: [], tileRegions: new Map(), contentRegions: new Map(), colours: new Uint16Array(256).fill(0xFFFF), poolStart: 32, basePalettes: [], notes: [] };
  if (!look || !checkRom(rom)) { if (look) res.notes.push("unexpected ROM: look not applied"); return res; }
  // the five shared hero palettes (StoryObjPalettes 0a:5341 = 01:50F6 entries 3-7 = 18:4300): the renderer only
  // recolours tiles shown with one of them, so other palettes (the charge flash, menus) stay the game's
  for (let p = 0; p < 5; p++) { const o = off(0x0A, 0x5341 + p * 8), pal = []; for (let i = 0; i < 4; i++) pal.push(rom[o + 2 * i] | rom[o + 2 * i + 1] << 8); res.basePalettes.push(pal); }
  for (const [key, name] of [["boy", "alex"], ["girl", "nina"]]) {
    const L = look[key]; if (!L) continue;
    const hid = HEROES[name].id, c = L.colours || {};
    const set = (r, v) => { if (v !== undefined && v !== null) res.colours[hid * 16 + r] = v & 0x7FFF; };
    set(REG.OUT, c.outline ?? 0x0000); set(REG.SKIN, c.skin); set(REG.SHADE, c.skin !== undefined ? shade(c.skin) : undefined);
    set(REG.HAIR, c.hair); if (c.hair !== undefined) { const t = hairTones(c.hair); set(REG.HAIR2, t.k); set(REG.HAIR3, t.g); } set(REG.HAT, c.hat); set(REG.TOP, c.top); set(REG.BOTTOM, c.bottom); set(REG.SHOES, c.shoes ?? c.bottom); set(REG.RACKET, c.racket);
    const A = heroAssets(rom, name, L.style || (name === "alex" ? "cap" : "pigtails"));
    const tag = plane => { const p = new Uint8Array(64); for (let i = 0; i < 64; i++) p[i] = plane[i] ? hid * 16 + plane[i] : 0; return p; };
    for (const r of A.raw) {
      res.patches.push({ off: r.off, bytes: r.bytes });
      for (const [o, plane] of r.regions) { res.tileRegions.set(o, tag(plane)); addContent(res, r.bytes.subarray(o - r.off, o - r.off + 16), tag(plane)); }
    }
    // the redrawn faces (portrait.js): portraits, win / lose faces and HUD heads, through the render layer
    faceAssets(rom, key, L, HEROES[name], res, { off, addContent, tileHash });
  }
  if (look.mods && look.mods.length) buildMods(rom, look.mods, res);       // opponent mods (mods.js)
  return res;
}
export const key16 = (b, o = 0) => { let s = ""; for (let i = 0; i < 16; i++) s += String.fromCharCode(b[o + i]); return s; };
export function tileHash(b, o = 0) { let h = 0x811c9dc5; for (let i = 0; i < 16; i++) { h ^= b[o + i]; h = Math.imul(h, 0x01000193); } return h >>> 0; }
export function addContent(res, bytes16, plane) {
  let nz = false; for (let i = 0; i < 16; i++) if (bytes16[i]) { nz = true; break; } if (!nz) return;
  const h = tileHash(bytes16), list = res.contentRegions.get(h) || [];
  if (!list.some(e => e.bytes.every((v, i) => v === bytes16[i]))) list.push({ bytes: Uint8Array.from(bytes16), plane });
  res.contentRegions.set(h, list);
}
// skin shading for the portraits: three quarters of the skin colour
export function shade(c) { const r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31; return ((r * 3) >> 2) | (((g * 3) >> 2) << 5) | (((b * 3) >> 2) << 10); }

// write the patches into the ROM copy; returns the undo list
export function applyPatches(rom, patches) {
  const undo = [];
  for (const p of patches) { undo.push({ off: p.off, bytes: rom.slice(p.off, p.off + p.bytes.length) }); rom.set(p.bytes, p.off); }
  return undo;
}
