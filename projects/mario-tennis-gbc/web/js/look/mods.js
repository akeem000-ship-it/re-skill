// Opponent mods: restyle (or replace) the game's other characters the way the creator restyles the heroes.
//
// A mod is a JSON object (see normalizeMod) with one entry per character id:
//   { v: 1, id, title, chars: [ { char, name, body, style, colours, touchups, portrait, head } ] }
//   char      the game's character id (0-31, the roster order: CharSpriteSetTable, the portrait table, the name table)
//   name      the new name (text bank $30, the name table; patched in place when it fits, else appended in the bank's
//             free tail and the table word repointed - data only, no code or timing path is touched)
//   body      "alex" | "nina": the hero whose overworld and match frames replace the character's own (same-size, in-place
//             data rewrites of the character's own frame blocks; the frame, placement and animation tables stay as
//             they are, so every pose lands on the pose with the same number). Omitted: the character's frames stay.
//   style     the hero hairstyle / hat (label.js STYLES) applied to the frames
//   extras    ['glasses'] drawn over the styled frames
//   colours   region colours { skin, hair, hat, top, bottom, shoes, racket, outline } ("#rrggbb" or a 15-bit number)
//   touchups  { "walk:<frame>:<facing>" | "match:<frame address hex>": [{ x, y, r: "hair" ... }] } pixel overrides
//   portrait  { pal: ["#rrggbb", ...], rows: [24 strings of 24 chars] } the 24x24 face (result screens...), drawn
//             in the render layer over the game's own portrait tiles; "." keeps the game's pixel
//   head      the same for the 16x16 head of the character-select / score displays
// Everything is computed from the user's own ROM at load; nothing here is derived from it, and the mod file holds
// only the user's art and choices. With no mod nothing is patched or hooked.
import { lzDecompress } from "./lz.js";
import { decodeColMajor, encodeColMajor, cellOf, img } from "./gfx.js";
import { REG, labelSprite, applyStyle, applyExtras, applyTouchups, STYLES, EXTRAS } from "./label.js";
import { TOUCHUPS } from "./touchups.js";
import { HEROES, off, u16, addContent, shade } from "./build.js";
import { hairTones } from "./portrait.js";

const CHAR_OBJECT_TABLE = [0x04, 0x4C29], SPRITE_SET_TABLE = [0x07, 0x5A50], OBJECT_LIST = [0x04, 0x4F75];
const PORTRAIT_TABLE = [0x16, 0x6968], HEAD_BASES = [0x5AF0, 0x62F0];       // 18:5AF0 + 64 * char, 18:62F0 + 64 * char
const NAME_BANK = 0x30, NAME_TABLE = 0x4004, NAME_COUNT = 560, NAME_FIRST = 27;       // text id $1b + char; the pool follows the offset table
const NAME_FREE = [0x7DCD, 0x8000];                                                    // the 0xFF tail of the text bank
const MAX_NAME = 9;                                                                    // the 11-byte name field of a character record, minus the terminator and a spare
const REGION_NAMES = { outline: REG.OUT, skin: REG.SKIN, hair: REG.HAIR, hat: REG.HAT, top: REG.TOP, bottom: REG.BOTTOM, shoes: REG.SHOES, racket: REG.RACKET, shade: REG.SHADE, keep: REG.KEEP, none: REG.NONE };
const PAL_CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

// ---------------------------------------------------------------------------------------------- the definition
const c15 = v => {
  if (typeof v === "string") { const m = /^#?([0-9a-f]{6})$/i.exec(v.trim()); if (!m) return undefined; const n = parseInt(m[1], 16); return ((n >> 19) & 31) | ((((n >> 11) & 31)) << 5) | (((n >> 3) & 31) << 10); }
  return Number.isInteger(v) ? v & 0x7FFF : undefined;
};
function artOf(a, w, h) {
  if (!a || !Array.isArray(a.rows) || a.rows.length !== h || !Array.isArray(a.pal)) return null;
  const pal = a.pal.map(c15); if (pal.some(v => v === undefined) || pal.length > PAL_CHARS.length) return null;
  const rows = a.rows.map(r => typeof r === "string" && r.length === w ? r : null); if (rows.some(r => !r)) return null;
  for (const r of rows) for (const ch of r) if (ch !== "." && !(PAL_CHARS.indexOf(ch) >= 0 && PAL_CHARS.indexOf(ch) < pal.length)) return null;
  return { pal, rows };
}
// -> the clean definition (colours as 15-bit numbers) or null
export function normalizeMod(m) {
  if (!m || typeof m !== "object" || !Array.isArray(m.chars)) return null;
  const chars = [];
  for (const c of m.chars) {
    if (!c || !Number.isInteger(c.char) || c.char < 0 || c.char > 31) continue;
    const o = { char: c.char };
    if (typeof c.name === "string" && /^[ -~]{1,9}$/.test(c.name)) o.name = c.name;
    if (c.body === "alex" || c.body === "nina") o.body = c.body;
    if (typeof c.style === "string" && o.body && STYLES[o.body].includes(c.style)) o.style = c.style;
    if (Array.isArray(c.extras)) { const e = c.extras.filter(x => EXTRAS.includes(x)); if (e.length) o.extras = e; }
    if (c.colours && typeof c.colours === "object") { o.colours = {}; for (const k of ["skin", "hair", "hat", "top", "bottom", "shoes", "racket", "outline", "shade"]) { const v = c15(c.colours[k]); if (v !== undefined) o.colours[k] = v; } }
    if (c.touchups && typeof c.touchups === "object") {
      o.touchups = {};
      for (const [k, list] of Object.entries(c.touchups)) if (Array.isArray(list)) o.touchups[k] = list.filter(t => t && Number.isInteger(t.x) && Number.isInteger(t.y) && t.r in REGION_NAMES).map(t => ({ x: t.x, y: t.y, r: t.r }));
    }
    const p = artOf(c.portrait, 24, 24); if (p) o.portrait = p;
    const h = artOf(c.head, 16, 16); if (h) o.head = h;
    chars.push(o);
  }
  return chars.length ? { v: 1, id: typeof m.id === "string" ? m.id.slice(0, 40) : "mod", title: typeof m.title === "string" ? m.title.slice(0, 60) : "", chars } : null;
}

// ---------------------------------------------------------------------------------------------- the game's tables
// one character's graphics: the walking sprite's frame blocks and the match sprite's, found through the object tables
function objHeader(rom, obj) {
  const w = u16(rom, OBJECT_LIST[0], OBJECT_LIST[1] + 2 * obj), bank = w >> 8, hdr = u16(rom, bank, 0x4000 + (w & 0xFF));
  return { bank, hdr, frames: u16(rom, bank, hdr + 4), info: u16(rom, bank, hdr + 10) };
}
export function charGfx(rom, c) {
  const wobj = rom[off(CHAR_OBJECT_TABLE[0], CHAR_OBJECT_TABLE[1]) + c], mobj = rom[off(SPRITE_SET_TABLE[0], SPRITE_SET_TABLE[1]) + c];
  const W = objHeader(rom, wobj), M = objHeader(rom, mobj);
  const walk = []; for (let i = 0; i < 16; i++) { const p = u16(rom, W.bank, W.frames + 2 * i); if (p < 0x4000 || p >= 0x8000) break; walk.push(p); }
  const match = []; for (let s = 0; s < 145; s++) match.push(u16(rom, M.bank, M.frames + 2 * s));
  return { walkBank: W.bank, walk, matchBank: M.bank, match, matchInfo: M.info };
}

// ---------------------------------------------------------------------------------------------- colours
// region slots: a block of 16 per modded character (the labelled regions), then a pool for the drawn art
class Slots {
  constructor(res, nchars) { this.res = res; this.pool = 32 + 16 * nchars; this.next = this.pool; this.byColour = new Map(); res.poolStart = this.pool; }
  colour(c) { let s = this.byColour.get(c); if (s === undefined) { if (this.next >= (this.res.poolTop === undefined ? 256 : this.res.poolTop)) return 0; s = this.next++; this.byColour.set(c, s); this.res.colours[s] = c; } return s; }
}
const lum = c => { const r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31; return (r * 0.3 + g * 0.59 + b * 0.11) / 31; };

// ---------------------------------------------------------------------------------------------- one character
function bodyFrames(rom, ch, G, res, base) {
  const hero = ch.body, H = HEROES[hero], style = ch.style || (hero === "alex" ? "cap" : "pigtails");
  const T = TOUCHUPS[hero] || {}, mine = ch.touchups || {};
  const touch = (st, key) => {
    applyTouchups(st, (T[key] || {})["*"]); applyTouchups(st, (T[key] || {})[style]);
    applyTouchups(st, (mine[key] || []).map(t => ({ x: t.x, y: t.y, r: REGION_NAMES[t.r] })));
  };
  const finish = (st, key) => { applyStyle(st, style); applyExtras(st, ch.extras); touch(st, key); return st; };
  const tag = plane => { const p = new Uint8Array(64); for (let i = 0; i < 64; i++) p[i] = plane[i] ? base + plane[i] : 0; return p; };
  // overworld frames: each distinct frame block of the character takes the hero's frame of the highest number among
  // the frames that share it (the characters' own blocks are shared by frames they never differ in)
  const groups = new Map(); G.walk.forEach((p, i) => groups.set(p, Math.max(groups.get(p) ?? -1, i)));
  for (const [p, i] of groups) {
    const src = off(H.walk[0], H.walk[1]) + 256 * Math.min(i, H.walk[2] - 1), dst = off(G.walkBank, p);
    const bytes = new Uint8Array(256), regions = new Map();
    for (let fc = 0; fc < 4; fc++) {
      const im = decodeColMajor(rom, src + fc * 64, 2, 2);
      const st = finish(labelSprite(im, hero, "walk"), `walk:${G.walk.indexOf(p)}:${fc}`);
      encodeColMajor({ w: 16, h: 16, px: st.idx }, 2, 2, bytes, fc * 64);
      for (let cx = 0; cx < 2; cx++) for (let cy = 0; cy < 2; cy++) regions.set(dst + fc * 64 + (cx * 2 + cy) * 16, cellOf(st.reg, 16, cx, cy));
    }
    res.patches.push({ off: dst, bytes });
    for (const [o, plane] of regions) res.tileRegions.set(o, tag(plane));       // by ROM offset only: the tiles are copies of the hero's, so a content match would colour the hero's own
  }
  // match frames: the same slots, the hero's frame data (24x32 or 32x32 plus the standing-shadow tiles)
  const Hm = charGfxOf(rom, hero), seen = new Set();
  for (let s = 0; s < 145; s++) {
    const a = G.match[s]; if (seen.has(a)) continue; seen.add(a);
    const cols = rom[off(G.matchBank, G.matchInfo + 4 * s + 2)] ? 4 : 3, srcBase = off(Hm.matchBank, Hm.match[s]), dst = off(G.matchBank, a), size = cols * 64 + cols * 16;
    const bytes = rom.slice(srcBase, srcBase + size), regions = new Map();
    const body = decodeColMajor(bytes, 0, cols, 4);
    const st = finish(labelSprite(body, hero, "match"), `match:${a.toString(16)}`);
    encodeColMajor({ w: cols * 8, h: 32, px: st.idx }, cols, 4, bytes, 0);
    for (let cx = 0; cx < cols; cx++) for (let cy = 0; cy < 4; cy++) regions.set(dst + (cx * 4 + cy) * 16, cellOf(st.reg, cols * 8, cx, cy));
    // the standing-shadow tiles replace each column's bottom tile: label a copy with them in place
    const alt = { w: body.w, h: body.h, px: Uint8Array.from(body.px) }, sh = decodeColMajor(bytes.subarray(cols * 64), 0, cols, 1);
    for (let c = 0; c < cols; c++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) alt.px[(24 + y) * alt.w + c * 8 + x] = sh.px[y * sh.w + c * 8 + x];
    const st2 = finish(labelSprite(alt, hero, "match"), `match:${a.toString(16)}`);
    encodeColMajor({ w: cols * 8, h: 8, px: st2.idx.subarray(24 * cols * 8) }, cols, 1, bytes, cols * 64);
    for (let c = 0; c < cols; c++) regions.set(dst + cols * 64 + c * 16, cellOf(st2.reg, cols * 8, c, 3));
    res.patches.push({ off: dst, bytes });
    for (const [o, plane] of regions) res.tileRegions.set(o, tag(plane));       // by ROM offset only: the tiles are copies of the hero's, so a content match would colour the hero's own
  }
}
// the hero's own match frame table (the character tables read through the same object tables)
function charGfxOf(rom, hero) { return charGfx(rom, HEROES[hero].id); }

// the 24x24 face: the game's own tiles (recognised by content) painted from the drawn art
function portraitArt(rom, ch, res, slots) {
  const a = ch.portrait, ptr = u16(rom, PORTRAIT_TABLE[0], PORTRAIT_TABLE[1] + 2 * ch.char);
  const { data } = lzDecompress(rom, off(PORTRAIT_TABLE[0], ptr));
  if (data.length < 144) return;
  for (let t = 0; t < 9; t++) {
    const plane = new Uint8Array(64);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const chr = a.rows[(t / 3 | 0) * 8 + y][(t % 3) * 8 + x]; plane[y * 8 + x] = chr === "." ? 0 : slots.colour(a.pal[PAL_CHARS.indexOf(chr)]); }
    addContent(res, data.subarray(t * 16, t * 16 + 16), plane);
  }
}
// the 16x16 heads (raw 2bpp, two 8x16 objects: column-major): new pixels written in place, drawn in the render layer
function headArt(rom, ch, res, slots) {
  const a = ch.head;
  for (const hb of HEAD_BASES) {
    const dst = off(0x18, hb + 64 * ch.char), bytes = new Uint8Array(64), im = img(16, 16), plane = new Uint8Array(256);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const chr = a.rows[y][x]; if (chr === ".") continue;
      const c = a.pal[PAL_CHARS.indexOf(chr)], l = lum(c);
      im.px[y * 16 + x] = l < 0.22 ? 3 : l < 0.62 ? 2 : 1; plane[y * 16 + x] = slots.colour(c);
    }
    encodeColMajor(im, 2, 2, bytes, 0);
    res.patches.push({ off: dst, bytes });
    for (let cx = 0; cx < 2; cx++) for (let cy = 0; cy < 2; cy++) { const r = cellOf(plane, 16, cx, cy); res.tileRegions.set(dst + (cx * 2 + cy) * 16, r); addContent(res, bytes.subarray((cx * 2 + cy) * 16, (cx * 2 + cy) * 16 + 16), r); }
  }
}

// ---------------------------------------------------------------------------------------------- names
function nameTable(rom) {
  const pool = NAME_TABLE + 2 * NAME_COUNT, base = off(NAME_BANK, 0x4000);
  const at = i => rom[base + (NAME_TABLE - 0x4000) + 2 * i] | rom[base + (NAME_TABLE - 0x4000) + 2 * i + 1] << 8;
  const str = i => { let o = base + (pool - 0x4000) + at(i), s = ""; while (rom[o] && s.length < 20) s += String.fromCharCode(rom[o++]); return s; };
  return { pool, base, at, str, tableAddr: i => base + (NAME_TABLE - 0x4000) + 2 * i };
}
function patchNames(rom, chars, res) {
  const T = nameTable(rom);
  if (T.str(NAME_FIRST) !== "Alex" || T.str(NAME_FIRST + 1) !== "Nina") { res.notes.push("names: unexpected text bank, names not changed"); return; }
  let free = NAME_FREE[0];
  for (let a = NAME_FREE[0]; a < NAME_FREE[1]; a++) if (rom[off(NAME_BANK, a)] !== 0xFF) { free = NAME_FREE[1]; res.notes.push("names: the text bank's tail is not free"); break; }
  for (const ch of chars) {
    if (!ch.name || ch.name.length > MAX_NAME) continue;
    const idx = NAME_FIRST + ch.char, old = T.str(idx), bytes = Uint8Array.from([...ch.name].map(c => c.charCodeAt(0)).concat(0));
    if (ch.name.length <= old.length) { res.patches.push({ off: T.base + (T.pool - 0x4000) + T.at(idx), bytes }); continue; }      // fits: in place
    if (free + bytes.length > NAME_FREE[1]) { res.notes.push("names: no room for " + ch.name); continue; }
    res.patches.push({ off: off(NAME_BANK, free), bytes });
    res.patches.push({ off: T.tableAddr(idx), bytes: Uint8Array.from([(free - T.pool) & 255, (free - T.pool) >> 8]) });
    free += bytes.length;
  }
}

// ---------------------------------------------------------------------------------------------- the mods
export function buildMods(rom, mods, res) {
  const chars = []; for (const m of mods) for (const c of m.chars) chars.push(c);
  const slots = new Slots(res, chars.length);
  chars.forEach((ch, k) => {
    const base = 32 + 16 * k, c = ch.colours || {};
    const set = (r, v) => { if (v !== undefined) res.colours[base + r] = v & 0x7FFF; };
    set(REG.OUT, c.outline ?? 0x0000); set(REG.SKIN, c.skin); set(REG.SHADE, c.shade ?? (c.skin !== undefined ? shade(c.skin) : undefined));
    set(REG.HAIR, c.hair); if (c.hair !== undefined) { const t = hairTones(c.hair); set(REG.HAIR2, t.k); set(REG.HAIR3, t.g); } set(REG.HAT, c.hat); set(REG.TOP, c.top); set(REG.BOTTOM, c.bottom); set(REG.SHOES, c.shoes ?? c.bottom); set(REG.RACKET, c.racket);
    if (ch.body) bodyFrames(rom, ch, charGfx(rom, ch.char), res, base);
    if (ch.portrait) portraitArt(rom, ch, res, slots);
    if (ch.head) headArt(rom, ch, res, slots);
  });
  patchNames(rom, chars, res);
}
