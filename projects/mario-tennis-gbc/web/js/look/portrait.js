// Portrait kit: the player's face drawn from parts, in the style of the game's own portraits (a dark outline, three
// or four tones of shading, a big head on a card in the outfit colour). Hand-made pixel art written for this project;
// nothing here is taken from the ROM. Used for the 24x24 portrait (create / status / name entry / EXP), the 32x32
// win and lose faces, and the 16x16 HUD heads; the creator's live preview draws the same functions.
//
//   drawFace({ size: 24 | 32 | 16, mood: "neutral" | "win" | "lose", hero: "boy" | "girl", style, face, colours })
//     -> { w, h, px: Int32Array }  one 15-bit (BGR555) colour per pixel, -1 where nothing is drawn (the 16x16 head)
//   face    { shape, eyes, brows, mouth, extras: [] }     (FACE lists the choices; normalizeFace fills the defaults)
//   colours { skin, hair, hat, top, outline? }            15-bit colours; the shades are derived from them
//
// The function is general: nothing in it is specific to the two heroes except the defaults, so other characters
// (opponent mods) can be composed from the same parts and colours.
export const FACE = {
  shapes: ["round", "oval", "square"],
  eyes: ["round", "bright", "sharp", "sleepy", "determined", "happy"],
  brows: ["straight", "arched", "angled"],
  mouths: ["smile", "grin", "serious", "smirk"],
  extras: ["freckles", "glasses", "blush"],
};
export const FACE_LABEL = {
  round: "Round", oval: "Oval", square: "Square",
  bright: "Bright", sharp: "Sharp", sleepy: "Sleepy", determined: "Determined", happy: "Cheerful",
  straight: "Straight", arched: "Arched", angled: "Angled",
  smile: "Smile", grin: "Grin", serious: "Serious", smirk: "Cocky",
  freckles: "Freckles", glasses: "Glasses", blush: "Blush",
};
export const DEFAULT_FACE = {
  boy: { shape: "round", eyes: "round", brows: "straight", mouth: "grin", extras: [] },
  girl: { shape: "oval", eyes: "bright", brows: "arched", mouth: "smile", extras: [] },
};
export function normalizeFace(f, hero = "boy") {
  const d = DEFAULT_FACE[hero] || DEFAULT_FACE.boy, o = f && typeof f === "object" ? f : {};
  const pick = (k, list) => list.includes(o[k]) ? o[k] : d[k];
  const extras = Array.isArray(o.extras) ? FACE.extras.filter(e => o.extras.includes(e)) : [];
  return { shape: pick("shape", FACE.shapes), eyes: pick("eyes", FACE.eyes), brows: pick("brows", FACE.brows), mouth: pick("mouth", FACE.mouths), extras };
}

// ---------------------------------------------------------------------------------------------- colours
const rgbOf = c => [(c & 31) * 255 / 31, ((c >> 5) & 31) * 255 / 31, ((c >> 10) & 31) * 255 / 31];
const to15 = ([r, g, b]) => { const q = v => Math.max(0, Math.min(31, Math.round(v / 255 * 31))); return q(r) | (q(g) << 5) | (q(b) << 10); };
function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
  if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
  return [h, s, l];
}
function fromHsl([h, s, l]) {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
const shift = (c, dh, ds, dl) => { const [h, s, l] = hsl(rgbOf(c)); return to15(fromHsl([h + dh, s + ds, l + dl])); };
const mix = (a, b, t) => { const A = rgbOf(a), B = rgbOf(b); return to15(A.map((v, i) => v + (B[i] - v) * t)); };
const lightness = c => hsl(rgbOf(c))[2];
const rgb = (r, g, b) => to15([r, g, b]);
export function skinTones(c) {
  const l = lightness(c);
  return { S: c, h: shift(c, 2, -0.04, 0.07 + 0.09 * (1 - l)), s: shift(c, -3, 0.02, -Math.min(0.09, l * 0.5)), d: shift(c, -6, 0.03, -Math.min(0.17, l * 0.8)) };
}
export function hairTones(c) {
  const l = lightness(c);
  return { H: c, g: shift(c, 4, -0.05, 0.12 + 0.1 * (1 - l)), k: shift(c, -4, 0.04, -0.13 - 0.04 * l) };
}
function clothTones(c, p, q, r) { const l = lightness(c); return { [p]: c, [q]: shift(c, -4, 0.04, -0.15), [r]: shift(c, 3, -0.06, 0.15 * (1 - l) + 0.08) }; }
function cardTones(c, mood) {
  const [, , l] = hsl(rgbOf(c)), ch = (Math.max(...rgbOf(c)) - Math.min(...rgbOf(c))) / 255;
  let B = ch < 0.14 ? (l > 0.5 ? rgb(112, 144, 184) : rgb(120, 136, 168))              // a white, grey or black top: a soft blue card
    : l > 0.74 ? shift(c, 0, -0.02, -0.26) : shift(c, 0, -0.03, 0.12);
  if (mood === "lose") B = mix(B, rgb(88, 96, 128), 0.5);
  return { B, a: shift(B, 0, 0, 0.1), b: shift(B, -3, 0.03, -0.1) };
}

// token -> colour for one drawing
export function palette(c, mood) {
  const sk = skinTones(c.skin), hr = hairTones(c.hair), ht = clothTones(c.hat, "C", "c", "e"), tp = clothTones(c.top, "T", "t", "u");
  const skinL = lightness(c.skin);
  return {
    O: c.outline !== undefined ? c.outline : 0, F: rgb(248, 240, 216), ...cardTones(c.top, mood),
    ...sk, ...hr, ...ht, ...tp,
    r: shift(c.skin, -14, 0.12, -0.03 - 0.03 * skinL),                // blush
    q: shift(c.skin, -6, 0.1, -0.14),                                  // freckles
    W: rgb(248, 248, 248), I: rgb(84, 48, 28), i: rgb(166, 102, 54), M: rgb(128, 24, 40), L: rgb(224, 96, 112),
    G: rgb(96, 104, 144), l: rgb(200, 226, 248), z: rgb(104, 192, 255),
  };
}

// ---------------------------------------------------------------------------------------------- the grid
class Grid {
  constructor(w, h, lo = 0) { this.w = w; this.h = h; this.lo = lo; this.t = new Array(w * h).fill("."); this.lay = new Array(w * h).fill(""); }
  get(x, y) { return x < 0 || y < 0 || x >= this.w || y >= this.h ? null : this.t[y * this.w + x]; }
  put(x, y, ch, lay = "") { x |= 0; y |= 0; if (x < this.lo || y < this.lo || x >= this.w - this.lo || y >= this.h - this.lo || ch === "." || ch === " ") return; this.t[y * this.w + x] = ch; this.lay[y * this.w + x] = lay; }
  // paint every pixel where pred(x, y) holds (ch: a token, or a function (x, y, current token) -> token)
  fill(pred, ch, lay = "", only = null) {
    for (let y = this.lo; y < this.h - this.lo; y++) for (let x = this.lo; x < this.w - this.lo; x++) {
      if (!pred(x, y)) continue;
      if (only && !only(this.t[y * this.w + x], this.lay[y * this.w + x])) continue;
      const v = typeof ch === "function" ? ch(x, y, this.t[y * this.w + x]) : ch;
      if (v && v !== ".") { this.t[y * this.w + x] = v; this.lay[y * this.w + x] = lay; }
    }
  }
  stamp(rows, x0, y0, lay = "", mirror = false) {
    rows.forEach((r, j) => { const s = mirror ? [...r].reverse().join("") : r; for (let i = 0; i < s.length; i++) this.put(x0 + i, y0 + j, s[i], lay); });
  }
}
const flipRows = rows => rows.map(r => [...r].reverse().join(""));

// ---------------------------------------------------------------------------------------------- metrics per size
// c: the centre column boundary, ft: the first row of the face, fh / fw: its height and width, then where the
// features sit. Hair and clothes are written in "24-space" (the 24x24 portrait's coordinates: centre 12, face top 4)
// and scaled by s to the other sizes.
const METRICS = {
  24: { w: 24, h: 24, c: 12, ft: 4, fh: 15, fw: 14, s: 1, eyeY: 10, brow: 8, nose: 14, mouth: 16, gap: 2, shirtY: 19, frame: true },
  32: { w: 32, h: 32, c: 16, ft: 4, fh: 21, fw: 20, s: 1.42, eyeY: 13, brow: 11, nose: 19, mouth: 21, gap: 4, shirtY: 26, frame: true },
  16: { w: 16, h: 16, c: 8, ft: 3, fh: 11, fw: 10, s: 0.72, eyeY: 7, brow: 5, nose: 9, mouth: 10, gap: 2, shirtY: 99, frame: false },
};
// face outline: widths (relative to the face width) down the face, sampled linearly
const PROFILE = {
  round: [[0, .5], [.1, .86], [.2, 1], [.66, 1], [.8, .92], [.92, .72], [1, .4]],
  oval: [[0, .5], [.12, .82], [.3, .92], [.62, .92], [.82, .78], [1, .34]],
  square: [[0, .5], [.1, .86], [.2, 1], [.72, 1], [.9, .94], [1, .66]],
};
function faceWidth(shape, t, fw) {
  const P = PROFILE[shape];
  for (let i = 1; i < P.length; i++) if (t <= P[i][0]) { const [t0, w0] = P[i - 1], [t1, w1] = P[i]; return (w0 + (w1 - w0) * (t - t0) / (t1 - t0)) * fw; }
  return P[P.length - 1][1] * fw;
}

// ---------------------------------------------------------------------------------------------- feature stamps
// tokens: O outline, I iris, W white / sparkle, k brow, M mouth, L tongue.  "." leaves the skin.
const EYES = {
  24: {
    round: [".OO.", "OIWO", "OIIO", ".OO."],
    bright: [".OO.", "OIWO", "OIIO", "OiiO", ".OO."],
    sharp: ["O...", "OOOO", "OIWO", ".OO."],
    sleepy: ["....", "OOOO", "OIWO", ".OO."],
    determined: ["OOOO", "OIWO", "OIIO", ".OO."],
    happy: [".OO.", "O..O"],
  },
  32: {
    round: [".OOO.", "OIIWO", "OIIIO", "OiiiO", ".OOO."],
    bright: [".OOO.", "OIIWO", "OIIIO", "OIIIO", "OiiiO", ".OOO."],
    sharp: ["O....", "OOOOO", "OIIWO", "OiiiO", ".OOO."],
    sleepy: [".....", "OOOOO", "OIIWO", "OiiiO", ".OOO."],
    determined: ["OOOOO", "OIIWO", "OIIIO", "OiiiO", ".OOO."],
    happy: [".OOO.", "O...O"],
  },
  16: {
    round: ["O", "O"], bright: ["O", "I"], sharp: ["O", "O"], sleepy: ["O"], determined: ["O", "O"], happy: ["O"],
  },
};
const BROWS = {
  24: { straight: ["kkkk"], arched: [".kkk", "kk.."], angled: ["kk..", ".kkk"] },
  32: { straight: ["kkkkk"], arched: [".kkkk", "kk..."], angled: ["kkk..", "..kkk"] },
  16: { straight: [], arched: [], angled: [] },
};
// mouths by mood: [rows, y offset (relative to the mouth row)]
const MOUTHS = {
  24: {
    neutral: { smile: ["O..O", ".OO."], grin: ["O....O", "OWWWWO", ".OOOO."], serious: ["OOOO"], smirk: ["....O", ".OOO."] },
    win: { smile: ["OOOO", "OMMO", ".OO."], grin: ["OWWWWO", "OMLLMO", ".OOOO."], serious: ["OOOO", "OMMO", ".OO."], smirk: ["..OOO", "OOMMO", ".OOO."] },
    lose: { smile: [".OO.", "O..O"], grin: ["OOOO", "OMMO", "OOOO"], serious: ["O.OO"], smirk: ["OOOO.", "...OO"] },
  },
  32: {
    neutral: { smile: ["O....O", ".OOOO."], grin: ["O......O", "OWWWWWWO", ".OOOOOO."], serious: ["OOOOOO"], smirk: ["......O", ".OOOOO."] },
    win: { smile: ["OOOOOO", "OMMMMO", ".OLLO.", "..OO.."], grin: ["OWWWWWWO", "OMMMMMMO", "OMLLLLMO", ".OOOOOO."], serious: ["OOOOOO", "OMMMMO", ".OOOO."], smirk: ["...OOOO", "OOOMMMO", ".OOOOO."] },
    lose: { smile: [".OOOO.", "O....O"], grin: ["OOOOOO", "OMMMMO", "OMMMMO", "OOOOOO"], serious: ["O.OOOO"], smirk: ["OOOOO..", "....OOO"] },
  },
  16: {
    neutral: { smile: ["O..O", ".OO."], grin: ["OOOO", "OWWO"], serious: ["OOO"], smirk: ["..OO", "OOO."] },
    win: { smile: ["OOOO", "OMMO"], grin: ["OOOO", "OWWO", "OMMO"], serious: ["OOO", "OMO"], smirk: ["..OO", "OMMO"] },
    lose: { smile: [".OO.", "O..O"], grin: ["OOOO", "OMMO"], serious: ["O.OO"], smirk: ["OOO.", "..OO"] },
  },
};

// ---------------------------------------------------------------------------------------------- hair and hats
// Shapes are written in 24-space (the 24x24 portrait: centre column 12, the face spans rows 4..18, width 14) as
// predicates on a pixel's centre (u, v) and scaled to the other sizes. Each style: back (behind everything), mid (over
// the shoulders, behind the face) and front (over the face), a token for the base colour and a texture.
const ELL = (cx, cy, rx, ry) => (u, v) => ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1;
const RECT = (u0, v0, u1, v1) => (u, v) => u >= u0 && u < u1 && v >= v0 && v < v1;
const OR = (...p) => (u, v) => p.some(f => f(u, v));
const AND = (...p) => (u, v) => p.every(f => f(u, v));
const NOT = f => (u, v) => !f(u, v);
const mirrorU = f => (u, v) => f(24 - u, v);
const both = f => OR(f, mirrorU(f));
const dx = u => Math.abs(u - 12);
// the front hairline: hair covers rows above `top` over the forehead and down to `side` beside the face
const hairline = (top, side, edge = 5.6, peak = 0.9) => (u, v) => v <= (dx(u) >= edge ? side : top + peak * (1 - Math.min(1, dx(u) / edge)));
const skull = (rx = 8.4, ry = 6.2, cy = 8.2) => ELL(12, cy, rx, ry);

// textures: (x, y, token) on pixels of the style's base colour; coordinates are in pixels of the drawing
const TEX = {
  smooth: null,
  coil: (x, y, p) => {
    if (!p) return (x + 2 * y) % 5 === 0 ? "g" : null;
    const bx = (x + (((y / p) | 0) & 1) * (p >> 1)) % p, by = y % p;
    return (bx === 0 && by === 0) ? "g" : (by === p - 1 && bx !== 0) ? "k" : (bx === p - 1 && by === 1) ? "k" : null;
  },
  rope: (x, y) => { const k = (x + y) % 3; return k === 0 ? "k" : (k === 1 && (x & 1)) ? "g" : null; },
  chevron: (x, y) => ((y & 1) ? (x & 1) : !(x & 1)) ? "k" : null,
};

function curvedLines(ctx, lines, tok, over) {                  // cornrows: lines from the hairline over the scalp, following the skull
  const { g, M } = ctx, hit = [];
  for (let y = 0; y < M.h; y++) for (let x = 0; x < M.w; x++) {
    const [u, v] = ctx.to24(x, y); if (!over(u, v)) continue;
    const hw = Math.max(1, Math.sqrt(Math.max(0, 1 - ((v - 8.6) / 6.6) ** 2)) * 8.4);
    for (const t of lines) if (Math.abs((u - 12) - t * hw) < 0.5 / ctx.S + 0.12) { if (g.t[y * M.w + x] === "H") { g.t[y * M.w + x] = tok; hit.push([x, y]); } }
  }
  if (ctx.style.tex === "rows") for (const [x, y] of hit) { const i = y * M.w + x + 1; if (g.t[i] === "H" && g.lay[i].startsWith("hair") && (y & 1) === 0) g.t[i] = "g"; }
}

const STYLE = {
  // ---- the boy
  cap: { hat: true,
    back: c => c.hair(OR(AND(ELL(12, 9.4, 8.7, 6.6), (u, v) => v <= 11.5), ELL(12, 9.6, 8.5, 6)), "H"),
    front: c => {
      c.tok(AND(ELL(12, 7.9, 8.1, 5.9), (u, v) => v <= 7.1), "C", "hat");
      c.tok(AND(ELL(12, 7.9, 8.1, 5.9), (u, v) => v <= 7.1 && u < 11 && v > 2.4 && v < 4.4 && u > 5.5), "e", "hat");
      c.tok((u, v) => v > 2.4 && v <= 5.6 && Math.abs(u - 12) < 0.55 && ELL(12, 7.9, 8.1, 5.9)(u, v), "c", "hat");
      c.tok(RECT(3.6, 7.1, 20.4, 8.1), "C", "hat"); c.tok(AND(RECT(4.4, 8.1, 19.6, 9.1), (u, v) => dx(u) <= 7.6 - (v - 8.1) * 2), "c", "hat");
    } },
  headband: { band: true,
    back: c => c.hair(OR(AND(ELL(12, 8.4, 8.7, 6.9), (u, v) => v <= 11.2), c.spikes([6.4, 9.6, 12, 14.4, 17.6])), "H"),
    front: c => c.band(RECT(3.4, 6.3, 20.6, 8.2), RECT(19.4, 8.2, 22, 9.6)) },
  ponytail: { tex: "smooth",
    back: c => c.hair(OR(AND(skull(8.7, 6.9, 8.4), hairline(8.4, 11.5)), ELL(18.6, 4.6, 2.6, 2.4), ELL(20.4, 7.8, 2.3, 3.2), ELL(20.7, 11.6, 2, 3.2), ELL(19.8, 15.2, 1.3, 2.2)), "H"),
    front: c => { c.hair(AND(skull(8.4, 6.2), hairline(7.7, 10.6)), "H"); c.band(RECT(16.8, 3.2, 19.4, 6.2)); } },
  short: { tex: "smooth",
    back: c => c.hair(AND(skull(8.6, 6.8, 8.3), hairline(8.4, 11.2)), "H"),
    front: c => { c.hair(AND(skull(8.4, 6.2), hairline(7.6, 10.6)), "H"); } },
  // ---- the girl
  pigtails: { tex: "smooth",
    back: c => {},
    mid: c => { c.hair(both(OR(ELL(3.5, 10.6, 2.3, 4.8), ELL(2.9, 15.2, 2.4, 3.3), ELL(2.3, 18.6, 1.4, 1.6), ELL(4.2, 7, 1.8, 1.8))), "H"); c.band(both(RECT(2.4, 5.6, 6, 7.8))); },
    front: c => c.hair(AND(skull(8.5, 6.4), hairline(7.7, 10.4)), "H") },
  bob: { tex: "smooth",
    back: c => c.hair(AND(ELL(12, 10.6, 9.3, 7.9), (u, v) => v <= 17.2), "H"),
    mid: c => {},
    front: c => { c.hair(OR(AND(skull(8.5, 6.4), hairline(7.7, 8)), both(RECT(3.2, 7, 6.2, 15.6))), "H"); } },
  // ---- both
  afro: { tex: "coil",
    back: c => c.hair(ELL(12, 9.6, 10.3, 7.1), "H"),
    front: c => c.hair(AND(ELL(12, 9.6, 10.3, 7.1), hairline(7.2, 10.4, 5.9)), "H") },
  puffs: { tex: "coil",
    back: c => { c.hair(both(ELL(4.9, 5.6, 4.1, 3.9)), "H"); c.band(both(RECT(7.4, 7.5, 9, 9.1))); },
    front: c => c.hair(AND(skull(8.2, 5.1, 9), hairline(7.4, 10.2)), "H") },
  locs: { tex: "strand", lines: [-0.8, -0.4, 0, 0.4, 0.8],
    back: c => c.hair(AND(skull(8.9, 7, 8.4), hairline(8.4, 11.2)), "H"),
    mid: c => c.strands([[2.6, 2.7, 7.2, 20.8], [5.1, 2.5, 7.2, 18.6]], "rope", null),
    front: c => { c.hair(AND(skull(8.5, 6.4), hairline(7.4, 10.4)), "H"); } },
  cornrows: { tex: "rows", lines: [-0.86, -0.6, -0.3, 0, 0.3, 0.6, 0.86],
    back: c => c.hair(AND(skull(8.5, 6.6, 8.3), hairline(8.2, 11)), "H"),
    front: c => c.hair(AND(skull(8.3, 6.1), hairline(7.4, 10.4)), "H") },
  fade: { tex: "smooth", post: "fade",
    back: c => c.hair(AND(skull(8.3, 6.4, 8.2), hairline(8, 10.8)), "H"),
    front: c => c.hair(AND(skull(8.3, 6.4, 8.4), (u, v) => v >= 2.9, hairline(7.0, 10.6, 5.4, 0.5)), "H") },
  twists: { tex: "coil",
    back: c => c.hair(ELL(12, 9.4, 9.6, 6.9), "H"),
    front: c => c.hair(AND(ELL(12, 9.4, 9.6, 6.9), hairline(7.3, 10.4, 5.8)), "H") },
  long: { tex: "smooth",
    back: c => c.hair(OR(AND(ELL(12, 10.6, 9.6, 8.2), (u, v) => v <= 23.5), both(RECT(2.2, 8, 6, 23.5))), "H"),
    mid: c => {},
    front: c => { c.hair(OR(AND(skull(8.5, 6.4), hairline(7.7, 8)), both(RECT(3.2, 7, 6, 23.5))), "H"); } },
  braids: { tex: "strand", lines: [-0.65, 0, 0.65],
    back: c => c.hair(AND(skull(8.7, 6.8, 8.4), hairline(8.4, 11.2)), "H"),
    mid: c => c.strands([[2.6, 2.2, 7.4, 21.4], [4.8, 2.2, 7.4, 19.2], [6.6, 2, 7.4, 16]], "chevron", "C"),
    front: c => c.hair(AND(skull(8.4, 6.2), hairline(7.5, 10.5)), "H") },
};
export const STYLE_NAMES = Object.keys(STYLE);

// ---------------------------------------------------------------------------------------------- compose
export function drawFace(opts) {
  const size = opts.size || 24, mood = opts.mood || "neutral", hero = opts.hero || "boy", M = METRICS[size];
  const face = normalizeFace(opts.face, hero), col = { skin: 0x2E5F, hair: 0x0C63, hat: 0x2D5, top: 0x1F, ...(opts.colours || {}) };
  const style = STYLE[opts.style] ? opts.style : (hero === "boy" ? "cap" : "pigtails"), ST = STYLE[style];
  const P = palette(col, mood), g = new Grid(M.w, M.h, M.frame ? 1 : 0), S = M.s;
  const to24 = (x, y) => [(x + 0.5 - M.c) / S + 12, (y + 0.5 - M.ft) / S + 4];
  const ctx = { g, M, S, to24, style: ST };
  const area = (pred, tok, lay, only) => g.fill((x, y) => { const [u, v] = to24(x, y); return pred(u, v); }, tok, lay, only);
  ctx.hair = (pred, tok = "H", lay) => area(pred, tok, lay || ctx.curLay);
  ctx.tok = (pred, tok, lay) => area(pred, tok, lay);
  ctx.hat = (...preds) => { const pr = OR(...preds); area(pr, "C", "hat"); area(AND(pr, (u, v) => false), "c", "hat"); };
  ctx.band = (...preds) => area(OR(...preds), "C", "hat");
  ctx.strands = (list, kind, bead) => {
    for (const [uc0, w, v0, v1] of list) for (const uc of [uc0, 24 - uc0]) {
      const pred = (u, v) => Math.abs(u - uc) <= w / 2 && v >= v0 && (v <= v1 - w / 2 || (u - uc) ** 2 + (v - (v1 - w / 2)) ** 2 <= (w / 2) ** 2);
      const pts = []; for (let y = g.lo; y < M.h - g.lo; y++) for (let x = g.lo; x < M.w - g.lo; x++) { const [u, v] = to24(x, y); if (pred(u, v)) pts.push([x, y]); }
      if (!pts.length) continue;
      const x0 = Math.min(...pts.map(p => p[0])), y1 = Math.max(...pts.map(p => p[1])), x1 = Math.max(...pts.map(p => p[0]));
      for (const [x, y] of pts) {
        let t = "H";
        if (kind === "rope") { const k = (x - x0 + y) % 3; t = k === 0 ? "k" : k === 2 ? "g" : "H"; if (x === x1 && x1 > x0) t = "k"; }
        else { t = (((x - x0) + y) & 1) ? "k" : "H"; if (x === x1 && x1 > x0 + 1) t = "k"; }
        if (bead && y >= y1 - (S > 1.2 ? 2 : 1)) t = y === y1 ? "c" : "C";
        g.put(x, y, t, "hairM");
      }
    }
  };
  ctx.spikes = xs => (u, v) => xs.some(su => v >= 1.7 && v < 5.2 && Math.abs(u - su) <= 0.9 + 1.5 * (v - 1.7) / 3.5);
  // card and frame
  if (M.frame) {
    g.fill((x, y) => x > 0 && y > 0 && x < M.w - 1 && y < M.h - 1, "B", "card");
    g.fill((x, y) => x + y < M.w * 0.42, "a", "card", t => t === "B");
    g.fill((x, y) => x + y > M.w * 1.62, "b", "card", t => t === "B");
  }
  // hair behind, shirt, hair over the shirt, face, hair in front
  ctx.curLay = "hairB"; if (ST.back) ST.back(ctx);
  if (M.frame) drawShirt(ctx, to24);
  ctx.curLay = "hairM"; if (ST.mid) ST.mid(ctx);
  const rows = drawFaceShape(ctx, face.shape);
  drawFeatures(ctx, face, mood, rows, col);
  ctx.curLay = "hairF"; ST.front(ctx);
  // hair texture on the base-coloured pixels of the style
  const tex = style && ST.tex;
  if (tex && TEX[tex]) for (let y = 0; y < M.h; y++) for (let x = 0; x < M.w; x++) {
    const i = y * M.w + x; if (g.t[i] !== "H" || !g.lay[i].startsWith("hair")) continue;
    const t = TEX[tex](x, y, M.w === 16 ? 0 : 3); if (t) g.t[i] = t;
  }
  if (ST.lines) curvedLines(ctx, ST.lines, "k", (u, v) => v < 11);
  if (ST.post === "fade") {                                                 // the faded sides: a dither of the darker tone, and the line above it
    for (let y = 0; y < M.h; y++) for (let x = 0; x < M.w; x++) {
      const i = y * M.w + x; if (!g.lay[i].startsWith("hair") || g.t[i] === "." ) continue;
      const [u, v] = to24(x, y); if (dx(u) > 5.2 && v > 6.2) g.t[i] = ((x + y) & 1) ? "k" : "H";
      else if (dx(u) > 4.2 && v > 4.8 && v < 7.4 && dx(u) < 5.4) g.t[i] = "k";
    }
  }
  glossHair(ctx);
  if (M.frame) for (let y = 0; y < M.h; y++) for (let x = 0; x < M.w; x++) if (x === 0 || y === 0 || x === M.w - 1 || y === M.h - 1) { g.t[y * M.w + x] = "F"; g.lay[y * M.w + x] = "frame"; }
  // outlines: a dark edge between hair / hat and skin, and around the whole figure
  edges(ctx);
  outline(g, M);
  // resolve
  const px = new Int32Array(M.w * M.h).fill(-1);
  for (let i = 0; i < px.length; i++) { const t = g.t[i]; if (t !== ".") px[i] = P[t] === undefined ? 0 : P[t]; }
  if (mood === "win" && M.frame) sparkles(px, M, P);
  return { w: M.w, h: M.h, px, tokens: g.t.join(""), palette: P };
}

function drawShirt(ctx, to24) {
  const { g, M } = ctx;
  const inside = (x, y) => x > 0 && y > 0 && x < M.w - 1 && y < M.h - 1;
  g.fill((x, y) => { const [u, v] = to24(x, y); return inside(x, y) && v >= 19 && dx(u) <= Math.min(12, 7.2 + (v - 19) * 1.7); }, "T", "shirt");
  const ring = (u, v, a, b) => ((u - 12) / a) ** 2 + ((v - 18.7) / b) ** 2;
  g.fill((x, y) => { const [u, v] = to24(x, y); return inside(x, y) && v >= 18.7 && ring(u, v, 4.6, 2.9) <= 1; }, "u", "shirt");
  g.fill((x, y) => { const [u, v] = to24(x, y); return inside(x, y) && v >= 18.5 && ring(u, v, 3.5, 2.1) <= 1; }, "s", "neck");
  g.fill((x, y) => { const [u, v] = to24(x, y); return inside(x, y) && v >= 18.5 && v < 19.7 && ring(u, v, 3.5, 2.1) <= 1; }, "d", "neck");
}
function drawFaceShape(ctx, shape) {
  const { g, M } = ctx, rows = [];
  for (let j = 0; j < M.fh; j++) {
    const y = M.ft + j, w = 2 * Math.round(faceWidth(shape, j / (M.fh - 1), M.fw) / 2), x0 = M.c - w / 2, x1 = M.c + w / 2 - 1;
    rows[y] = { x0, x1 };
    for (let x = x0; x <= x1; x++) g.put(x, y, "S", "face");
  }
  // ears
  const ey = M.eyeY + (M.fh > 18 ? 2 : 1), eh = M.fh > 18 ? 3 : (M.fh > 13 ? 2 : 1);
  for (let y = ey; y < ey + eh; y++) { const r = rows[y]; g.put(r.x0 - 1, y, "s", "face"); g.put(r.x1 + 1, y, "s", "face"); }
  // shading: the right side, under the chin, a highlight on the cheek
  for (let y = M.ft; y < M.ft + M.fh; y++) {
    const r = rows[y]; if (!r) continue;
    if (y >= M.eyeY - 1) { g.put(r.x1, y, "s", "face"); if (M.fw > 12 && y >= M.eyeY + 1) g.put(r.x1 - 1, y, "s", "face"); }
  }
  const last = rows[M.ft + M.fh - 1], prev = rows[M.ft + M.fh - 2];
  for (let x = last.x0; x <= last.x1; x++) g.put(x, M.ft + M.fh - 1, "s", "face");
  for (let x = prev.x0 + 1; x <= prev.x1; x++) if (M.fw > 12) g.put(x, M.ft + M.fh - 2, "s", "face");
  const hy = M.nose - 1, r = rows[hy];
  g.put(r.x0 + 1, hy, "h", "face"); if (M.fw > 12) { g.put(r.x0 + 1, hy - 1, "h", "face"); g.put(r.x0 + 2, hy - 1, "h", "face"); }
  return rows;
}
function drawFeatures(ctx, face, mood, rows, col) {
  const { g, M } = ctx, sz = M.w === 16 ? 16 : M.w, E = EYES[sz][face.eyes], eh = E.length, ew = Math.max(...E.map(r => r.length));
  const eb = M.eyeY + (sz === 24 ? 3 : sz === 32 ? 4 : 1), ex = M.c - M.gap / 2 - ew, ex2 = M.c + M.gap / 2, ey = eb - eh + 1;
  // blush and freckles under the eyes
  const yy = eb + 1, rr = rows[yy] || rows[eb];
  if (face.extras.includes("blush") && M.w > 16) { const n = M.w === 32 ? 3 : 2; for (let k = 0; k < n; k++) { g.put(rr.x0 + 1 + k, yy + 1, "r", "feat"); g.put(rr.x1 - 1 - k, yy + 1, "r", "feat"); if (M.w === 32) { g.put(rr.x0 + 2 + k, yy + 2, "r", "feat"); g.put(rr.x1 - 2 - k, yy + 2, "r", "feat"); } } }
  if (face.extras.includes("blush") && M.w === 16) { g.put(rr.x0 + 1, yy + 1, "r", "feat"); g.put(rr.x1 - 1, yy + 1, "r", "feat"); }
  if (face.extras.includes("freckles")) {
    const pts = M.w === 32 ? [[1, 1], [3, 0], [2, 3], [5, 2]] : M.w === 24 ? [[1, 1], [3, 0], [2, 2]] : [[1, 0], [3, 1]];
    for (const [a, b] of pts) { g.put(ex + a, eb + 1 + b, "q", "feat"); g.put(ex2 + ew - 1 - a, eb + 1 + b, "q", "feat"); }
  }
  // brows
  const bk = mood === "lose" ? "sad" : face.brows, B = bk === "sad" ? (sz === 32 ? ["...kk", "kkk.."] : ["..kk", "kk.."]) : BROWS[sz][face.brows];
  const by = M.brow - (mood === "win" ? 1 : 0) + (mood === "lose" ? 1 : 0);
  if (B && B.length) { g.stamp(B, ex, by, "feat"); g.stamp(flipRows(B), ex2, by, "feat"); }
  // eyes (the sparkle stays on the same side in both)
  const hl = (rows, x0, y0, flip) => rows.map(r => r);
  g.stamp(E, ex, ey, "feat");
  g.stamp(flipRows(E).map((r, j) => keepSparkle(E[j], r)), ex2, ey, "feat");
  // tear on a sad face
  if (mood === "lose" && M.w > 16) { const tx = ex + (sz === 32 ? 1 : 1); g.put(tx, eb + 1, "z", "feat"); g.put(tx, eb + 2, "z", "feat"); if (sz === 32) g.put(tx, eb + 3, "z", "feat"); }
  // nose
  if (M.w === 24) { g.put(M.c, M.nose, "s", "feat"); }
  else if (M.w === 32) { g.put(M.c - 1, M.nose, "s", "feat"); g.put(M.c, M.nose, "s", "feat"); }
  // mouth
  const Mo = MOUTHS[sz][mood === "win" ? "win" : mood === "lose" ? "lose" : "neutral"][face.mouth], mw = Math.max(...Mo.map(r => r.length));
  g.stamp(Mo, M.c - Math.floor(mw / 2) - (mw === 5 || mw === 7 ? 0 : 0), M.mouth + 1 - (Mo.length - 1), "feat");
  // glasses: a dark rim round each eye with rounded corners, a bridge between them and arms to the ears
  if (face.extras.includes("glasses") && M.w > 16) {
    const gy0 = ey - 1, gy1 = eb + 1;
    for (const [a, b] of [[ex - 1, ex + ew], [ex2 - 1 + 0, ex2 + ew]]) {
      for (let x = a + 1; x < b; x++) { g.put(x, gy0, "G", "glass"); g.put(x, gy1, "G", "glass"); }
      for (let y = gy0 + 1; y < gy1; y++) { g.put(a, y, "G", "glass"); g.put(b, y, "G", "glass"); }
    }
    for (let x = ex + ew + 1; x < ex2 - 1; x++) g.put(x, ey + 1, "G", "glass");
    g.put(ex - 2, ey + 1, "G", "glass"); g.put(ex2 + ew + 1, ey + 1, "G", "glass");
  }
}
// mirror of an eye row with the sparkle kept in its original column
function keepSparkle(orig, mir) {
  const n = orig.length, o = [...mir];
  for (let i = 0; i < n; i++) if (orig[i] === "W" && o[i] !== "W") { const j = o.indexOf("W"); if (j >= 0) { o[j] = mir[i]; } o[i] = "W"; }
  return o.join("");
}
// hair gloss: one row below the top edge of the hair, on the lit (left) side
function glossHair(ctx) {
  const { g, M } = ctx, first = new Array(M.w).fill(-1);
  for (let x = 0; x < M.w; x++) for (let y = 1; y < M.h - 1; y++) { const i = y * M.w + x; if (g.lay[i].startsWith("hair") && g.t[i] === "H") { first[x] = y; break; } }
  const t = ctx.style.tex;
  if (t === "coil" || t === "strand" || t === "rows") return;
  for (let x = 2; x < M.c; x++) { const y = first[x]; if (y < 0) continue; const i = (y + 1) * M.w + x; if (g.t[i] === "H" && g.lay[i].startsWith("hair") && (x + (y & 1)) % 3 !== 0) g.t[i] = "g"; }
}
function edges(ctx) {
  const { g, M } = ctx, w = M.w, h = M.h, N = [[1, 0], [-1, 0], [0, 1], [0, -1]], isSkin = t => "ShsdrqW".includes(t) && t !== ".";
  const set = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, l = g.lay[i];
    if (!(l.startsWith("hair") || l === "hat")) continue;
    for (const [a, b] of N) { const j = (y + b) * w + x + a; if (x + a < 0 || y + b < 0 || x + a >= w || y + b >= h) continue; if (g.lay[j] === "face" && isSkin(g.t[j])) { set.push([i, l === "hat" ? "c" : "k"]); if (l.startsWith("hair") && b === 1 && g.lay[j] === "face") set.push([j, "s"]); break; } }
  }
  for (const [i, t] of set) g.t[i] = t;
}
function outline(g, M) {
  const w = M.w, h = M.h, add = [], lo = M.frame ? 1 : 0, hi = M.frame ? 1 : 0;
  for (let y = lo; y < h - hi; y++) for (let x = lo; x < w - hi; x++) {
    const i = y * w + x; if (g.t[i] !== "." && g.lay[i] !== "card") continue;
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + a, Y = y + b; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const l = g.lay[Y * w + X]; if (g.t[Y * w + X] !== "." && l !== "card" && l !== "frame" && l !== "outline") { add.push(i); break; } }
  }
  for (const i of add) { g.t[i] = "O"; g.lay[i] = "outline"; }
}
function sparkles(px, M, P) {
  const plus = (x, y) => { for (const [a, b] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + a, Y = y + b; if (px[Y * M.w + X] === P.B || px[Y * M.w + X] === P.a || px[Y * M.w + X] === P.b) px[Y * M.w + X] = P.W; } };
  plus(3, 5); plus(M.w - 4, 3);
}

// the drawing's colours as css strings (token -> "rgb(r,g,b)"): the HD portrait (hdface.js) shades from the same tones
export function paletteCss(colours, mood = "neutral") {
  const P = palette({ skin: 0x2E5F, hair: 0x0C63, hat: 0x2D5, top: 0x1F, ...colours }, mood), o = {};
  for (const k in P) { const [r, g, b] = rgbOf(P[k]); o[k] = `rgb(${r | 0},${g | 0},${b | 0})`; }
  return o;
}

// a drawing as the art format of an opponent mod file ({ pal: ["#rrggbb", ...], rows: [w strings] }, "." = nothing drawn):
//   toModArt(drawFace({ size: 24, ... })) -> a mod's `portrait`; with size 16 -> its `head`
export function toModArt(im) {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", idx = new Map(), pal = [];
  const rows = [];
  for (let y = 0; y < im.h; y++) {
    let r = "";
    for (let x = 0; x < im.w; x++) {
      const c = im.px[y * im.w + x]; if (c < 0) { r += "."; continue; }
      let k = idx.get(c); if (k === undefined) { k = pal.length; if (k >= chars.length) { r += "."; continue; } idx.set(c, k); const [R, G, B] = rgbOf(c); pal.push("#" + [R, G, B].map(v => Math.round(v).toString(16).padStart(2, "0")).join("")); }
      r += chars[k];
    }
    rows.push(r);
  }
  return { pal, rows };
}
