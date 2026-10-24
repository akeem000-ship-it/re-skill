// The hero's redrawn faces, applied through the render layer (see render.js): the portrait kit (portrait.js) draws
// the 24x24 portrait, the 32x32 win / lose faces and the 16x16 HUD heads from the look; here they become region
// planes keyed by the game's own tile content (the LZ streams are NOT rewritten: a different stream would take a
// different number of cycles to decompress) and, for the heads (raw 2bpp sprites), same-size in-place data rewrites.
// Every pixel of a portrait tile gets its exact colour from the colour pool (renderer slots above the regions).
import { drawFace, normalizeFace } from "./portrait.js";
import { lzDecompress } from "./lz.js";
import { encodeColMajor, img, cellOf } from "./gfx.js";

// the colours a portrait is drawn with when the look leaves one unset (the same as the first preset of each hero)
const H = s => { const n = parseInt(s.slice(1), 16); return ((n >> 19) & 31) | (((n >> 11) & 31) << 5) | (((n >> 3) & 31) << 10); };
export const DEFAULT_COLOURS = {
  boy: { skin: H("#f8c8a0"), hair: H("#402010"), hat: H("#e02828"), top: H("#f8f8f0") },
  girl: { skin: H("#ffe0c8"), hair: H("#a85820"), hat: H("#f060a8"), top: H("#f060a8") },
};
export const faceColours = (hero, c) => {
  c = c || {};
  const d = DEFAULT_COLOURS[hero], o = {};
  for (const k of ["skin", "hair", "hat", "top"]) o[k] = Number.isInteger(c[k]) ? c[k] & 0x7FFF : d[k];
  if (Number.isInteger(c.outline)) o.outline = c.outline & 0x7FFF;
  return o;
};

// a slot of the renderer's colour table for this exact colour (taken from the top down: the opponent mods' pool grows up)
export function poolSlot(res, c) {
  if (res.poolTop === undefined) res.poolTop = res.colours.length;
  const m = res.slotOf || (res.slotOf = new Map());
  let s = m.get(c); if (s !== undefined) return s;
  if (res.poolTop - 1 <= (res.poolStart || 32)) return 0;
  s = --res.poolTop; res.colours[s] = c; m.set(c, s); return s;
}
const lum = c => ((c & 31) * 0.3 + ((c >> 5) & 31) * 0.59 + ((c >> 10) & 31) * 0.11) / 31;

// look: one hero's look; heroDef: build.js HEROES entry; adds to res (patches, tileRegions, contentRegions)
export function faceAssets(rom, hero, L, heroDef, res, deps) {
  const { off, addContent, tileHash } = deps;
  const spec = { hero, style: L.style, face: normalizeFace(L.face, hero), colours: faceColours(hero, L.colours) };
  const plane = (im, cx, cy, n) => { const p = new Uint16Array(64); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const c = im.px[(cy * 8 + y) * im.w + cx * 8 + x]; p[y * 8 + x] = c < 0 ? 0 : poolSlot(res, c); } return p; };
  res.faces = res.faces || {}; res.faces[hero] = { hero, style: L.style || undefined, face: spec.face, colours: spec.colours };
  res.faceTiles = res.faceTiles || new Map();
  const stream = (bank, addr, im, cols, kind) => {          // the HD UI finds the portraits on screen by these tiles (renderer.faceTile)
    const { data } = lzDecompress(rom, off(bank, addr));
    for (let t = 0; t < cols * cols; t++) {
      const bytes = data.subarray(t * 16, t * 16 + 16);
      addContent(res, bytes, plane(im, t % cols, (t / cols) | 0));
      const h = tileHash(bytes), list = res.faceTiles.get(h) || [];
      if (!list.some(e => e.hero === hero && e.kind === kind && e.t === t)) list.push({ bytes: Uint8Array.from(bytes), hero, kind, t, cols });
      res.faceTiles.set(h, list);
    }
  };
  const p24 = drawFace({ ...spec, size: 24, mood: "neutral" });
  for (const [bank, addr] of heroDef.portraits) stream(bank, addr, p24, 3, "p24");
  heroDef.winlose.forEach(([bank, addr], k) => stream(bank, addr, drawFace({ ...spec, size: 32, mood: k ? "lose" : "win" }), 4, k ? "lose" : "win"));
  // HUD heads: 16x16 as two 8x16 sprite objects; the 2bpp pixels (non-zero where drawn) are rewritten in place
  const head = drawFace({ ...spec, size: 16, mood: "neutral" });
  for (const a of heroDef.heads) {
    const base = off(0x18, a), bytes = new Uint8Array(64), im = img(16, 16);
    for (let i = 0; i < 256; i++) { const c = head.px[i]; im.px[i] = c < 0 ? 0 : lum(c) < 0.2 ? 3 : lum(c) < 0.6 ? 2 : 1; }
    encodeColMajor(im, 2, 2, bytes, 0);
    res.patches.push({ off: base, bytes });
    for (let cx = 0; cx < 2; cx++) for (let cy = 0; cy < 2; cy++) {
      const pl = plane(head, cx, cy), o = (cx * 2 + cy) * 16;
      res.tileRegions.set(base + o, pl); addContent(res, bytes.subarray(o, o + 16), pl);
    }
  }
}
