// Live preview for the creator: a hero's real frames (overworld facings, court poses, portrait) labelled,
// restyled and coloured exactly as the game will show them, straight from the user's (unpatched) ROM.
import { lzDecompress } from "./lz.js";
import { decodeColMajor, decodeRowMajor } from "./gfx.js";
import { REG, labelSprite, labelPortrait, applyStyle, applyTouchups } from "./label.js";
import { TOUCHUPS } from "./touchups.js";
import { HEROES, hilite } from "./build.js";
import { hairTones, drawFace } from "./portrait.js";
import { faceColours } from "./faces.js";
import { detail3x } from "./detail.js";
import { faceInfoOf } from "./faceinfo.js";
import { faceCanvas, cleanFace } from "./detailface.js";
import { groupMood } from "./build.js";

const off = (bank, addr) => addr < 0x4000 ? addr : bank * 0x4000 + (addr - 0x4000);
const u16 = (rom, bank, addr) => { const o = off(bank, addr); return rom[o] | rom[o + 1] << 8; };
const HERO_PAL = { alex: 3, nina: 2 };                     // the palette each hero is created with (CharPaletteIndexTable)
export const POSES = [[2, 4, "ready"], [2, 0, "from behind"], [0, 2, "run"], [6, 2, "forehand"], [0x0D, 0, "serve"], [0x1A, 4, "point won"]];

function rgbOf(c) { return [(c & 31) * 255 / 31 | 0, ((c >> 5) & 31) * 255 / 31 | 0, ((c >> 10) & 31) * 255 / 31 | 0]; }
export function basePalette(rom, name) {
  const o = off(0x0A, 0x5341 + HERO_PAL[name] * 8), p = [];
  for (let i = 0; i < 4; i++) p.push(rom[o + 2 * i] | rom[o + 2 * i + 1] << 8);
  return p;
}
function shade(c) { const r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31; return ((r * 3) >> 2) | (((g * 3) >> 2) << 5) | (((b * 3) >> 2) << 10); }
export function regionColours(look) {
  const c = (look && look.colours) || {}, m = new Map();
  m.set(REG.OUT, 0); if (c.skin !== undefined) { m.set(REG.SKIN, c.skin); m.set(REG.SHADE, shade(c.skin)); m.set(REG.HILITE, hilite(c.skin)); }
  if (c.hair !== undefined) { const t = hairTones(c.hair); m.set(REG.HAIR2, t.k); m.set(REG.HAIR3, t.g); }
  for (const [r, k] of [[REG.HAIR, "hair"], [REG.HAT, "hat"], [REG.TOP, "top"], [REG.BOTTOM, "bottom"], [REG.RACKET, "racket"]]) if (c[k] !== undefined) m.set(r, c[k]);
  m.set(REG.SHOES, c.shoes !== undefined ? c.shoes : c.bottom);
  return m;
}
// st (labelled) -> { w, h, data: RGBA }; transparent: colour 0 is see-through (sprites)
export function paint(st, pal, cols, transparent) {
  const { w, h } = st, data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const idx = st.idx[i]; if (!idx && transparent && !st.reg[i]) continue;
    const r = st.reg[i], c = cols && cols.has(r) && cols.get(r) !== undefined ? cols.get(r) : pal[idx];
    const [R, G, B] = rgbOf(c); data.set([R, G, B, 255], i * 4);
  }
  return { w, h, data };
}
function prep(st, name, look, key) {
  if (look) {
    const style = look.style || (name === "alex" ? "cap" : "pigtails"), T = TOUCHUPS[name] || {};
    applyStyle(st, style); applyTouchups(st, (T[key] || {})["*"]); applyTouchups(st, (T[key] || {})[style]);
  }
  return st;
}
// the portrait kit's drawing as an RGBA image (transparent where the kit draws nothing)
export function faceImage(spec) {
  const f = drawFace(spec), data = new Uint8ClampedArray(f.w * f.h * 4);
  for (let i = 0; i < f.w * f.h; i++) { const c = f.px[i]; if (c < 0) continue; data.set([(c & 31) * 255 / 31, ((c >> 5) & 31) * 255 / 31, ((c >> 10) & 31) * 255 / 31, 255], i * 4); }
  return { w: f.w, h: f.h, data };
}
// look: one hero's look ({ style, colours }) or null for the game's own; -> { walk: [4], poses: [n], portrait }
export function heroPreview(rom, name, look, walkFrame = 0, redrawn = false) {
  const h = HEROES[name], pal = basePalette(rom, name), cols = look ? regionColours(look) : null;
  const walk = [];
  for (let fc = 0; fc < 4; fc++) {
    const o = off(h.walk[0], h.walk[1]) + walkFrame * 256 + fc * 64;
    walk.push(paint(prep(labelSprite(decodeColMajor(rom, o, 2, 2), name, "walk"), name, look, `walk:${walkFrame}:${fc}`), pal, cols, true));
  }
  const poses = POSES.map(([g, v]) => {
    const slot = g * 5 + v, a = u16(rom, h.match, 0x400E + 2 * slot), cols4 = rom[off(h.match, 0x7CE0 + 4 * slot + 2)] ? 4 : 3;
    return paint(prep(labelSprite(decodeColMajor(rom, off(h.match, a), cols4, 4), name, "match"), name, look, `match:${a.toString(16)}`), pal, cols, true);
  });
  let portrait, faces, heads;
  if (look && redrawn) {                               // the redrawn faces (portrait.js), as the game will show them (Portraits: Redrawn)
    const hero = name === "alex" ? "boy" : "girl", kit = (size, mood) => faceImage({ hero, style: look.style || undefined, face: look.face, colours: faceColours(hero, look.colours), size, mood });
    portrait = kit(24, "neutral"); faces = [kit(32, "win"), kit(32, "lose")]; heads = [kit(16, "neutral"), kit(16, "neutral")];
  } else {                                             // the game's own portraits and heads, recoloured by the look
    const [pb, pa] = h.portraits[0], { data } = lzDecompress(rom, off(pb, pa));
    portrait = paint(prep(labelPortrait(decodeRowMajor(data, 0, 3, 3), name), name, look, "portrait"), pal, cols, false);
    faces = h.winlose.map(([b, a], k) => paint(prep(labelPortrait(decodeRowMajor(lzDecompress(rom, off(b, a)).data, 0, 4, 4), name), name, look, k ? "lose" : "win"), pal, cols, false));
    heads = h.heads.map(a => paint(prep(labelSprite(decodeColMajor(rom, off(0x18, a), 2, 2), name, "head"), name, look, `head:${a.toString(16)}`), pal, cols, true));
  }
  return { walk, poses, portrait, faces, heads };
}
// draw an image scaled k x onto a 2D context (mirror: flip horizontally, as a left-handed player)
export function blit(ctx, im, x, y, k, mirror = false) {
  const c = document.createElement("canvas"); c.width = im.w; c.height = im.h;
  c.getContext("2d").putImageData(new ImageData(im.data, im.w, im.h), 0, 0);
  ctx.imageSmoothingEnabled = false;
  if (mirror) { ctx.save(); ctx.translate(x + im.w * k, y); ctx.scale(-1, 1); ctx.drawImage(c, 0, 0, im.w * k, im.h * k); ctx.restore(); }
  else ctx.drawImage(c, x, y, im.w * k, im.h * k);
}

// the hero's court frames as the detailed sprites draw them (3x, outlined and shaded, with the face's expression): stand, swing, point won, point lost
export const DETAIL_POSES = [[0, 4], [6, 3], [23, 4], [26, 4]];
export function detailPoses(rom, name, look) {
  const h = HEROES[name], pal = basePalette(rom, name), cols = look ? regionColours(look) : null, out = [];
  for (const [g, v] of DETAIL_POSES) {
    const slot = g * 5 + v, a = u16(rom, h.match, 0x400E + 2 * slot), cols4 = rom[off(h.match, 0x7CE0 + 4 * slot + 2)] ? 4 : 3;
    const st = prep(labelSprite(decodeColMajor(rom, off(h.match, a), cols4, 4), name, "match"), name, look, `match:${a.toString(16)}`), im = paint(st, pal, cols, true);
    const src = new Uint32Array(st.w * st.h); for (let i = 0; i < src.length; i++) if (im.data[i * 4 + 3]) src[i] = (0xFF000000 | (im.data[i * 4 + 2] << 16) | (im.data[i * 4 + 1] << 8) | im.data[i * 4]) >>> 0;
    const info = faceInfoOf(st);
    if (info) { const cnt = new Map(); let skin = 0, bn = 0; for (const p of info.skinIdx) { const c = src[p]; if (!c) continue; const k = (cnt.get(c) || 0) + 1; cnt.set(c, k); if (k > bn) { bn = k; skin = c; } } cleanFace(src, info, (x, y) => src[y * st.w + x] ? y * st.w + x : -1, skin); }
    const d = detail3x(src, st.w, st.h);
    if (info) { const f = faceCanvas(info, groupMood(g), {}); for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) { const c = f.px[y * f.w + x]; if (c) d.data[(info.y0 * 3 + y) * d.w + info.x0 * 3 + x] = c; } }
    out.push({ w: d.w, h: d.h, data: new Uint8ClampedArray(d.data.buffer.slice(0)) });
  }
  return out;
}
