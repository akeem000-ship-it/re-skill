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
  return { S: c, h: shift(c, 2, -0.04, 0.07 + 0.06 * (1 - l)), s: shift(c, -4, 0.05, -0.1), d: shift(c, -8, 0.1, -0.2) };
}
export function hairTones(c) {
  const l = lightness(c);
  return { H: c, g: shift(c, 4, -0.05, 0.12 + 0.1 * (1 - l)), k: shift(c, -4, 0.04, -0.13 - 0.04 * l) };
}
function clothTones(c, p, q, r) { const l = lightness(c); return { [p]: c, [q]: shift(c, -4, 0.04, -0.15), [r]: shift(c, 3, -0.06, 0.15 * (1 - l) + 0.08) }; }
function cardTones(c, mood) {
  const l = lightness(c);
  let B = l > 0.74 ? shift(c, 0, -0.02, -0.26) : shift(c, 0, -0.03, 0.12);
  if (mood === "lose") B = shift(B, 6, -0.25, -0.12);
  return { B, a: shift(B, 0, 0, 0.1), b: shift(B, -3, 0.03, -0.1) };
}

// token -> colour for one drawing
function palette(c, mood) {
  const sk = skinTones(c.skin), hr = hairTones(c.hair), ht = clothTones(c.hat, "C", "c", "e"), tp = clothTones(c.top, "T", "t", "u");
  const skinL = lightness(c.skin);
  return {
    O: c.outline !== undefined ? c.outline : 0, F: rgb(248, 240, 216), ...cardTones(c.top, mood),
    ...sk, ...hr, ...ht, ...tp,
    r: shift(c.skin, -14, 0.12, -0.03 - 0.03 * skinL),                // blush
    q: shift(c.skin, -6, 0.1, -0.14),                                  // freckles
    W: rgb(248, 248, 248), I: rgb(72, 44, 24), M: rgb(128, 24, 40), L: rgb(224, 96, 112),
    G: rgb(40, 40, 56), l: rgb(200, 226, 248), z: rgb(104, 192, 255),
  };
}

// ---------------------------------------------------------------------------------------------- the grid
class Grid {
  constructor(w, h) { this.w = w; this.h = h; this.t = new Array(w * h).fill("."); this.lay = new Array(w * h).fill(""); }
  get(x, y) { return x < 0 || y < 0 || x >= this.w || y >= this.h ? null : this.t[y * this.w + x]; }
  put(x, y, ch, lay = "") { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= this.w || y >= this.h || ch === "." || ch === " ") return; this.t[y * this.w + x] = ch; this.lay[y * this.w + x] = lay; }
  // paint every pixel where pred(x, y) holds (ch: a token, or a function (x, y, current token) -> token)
  fill(pred, ch, lay = "", only = null) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
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
    bright: [".OO.", "OIWO", "OIIO", "OWIO", ".OO."],
    sharp: ["O...", "OOOO", "WIWO", ".OO."],
    sleepy: ["....", "OOOO", "OIIO", ".OO."],
    determined: ["OOOO", "OIWO", "OIIO", ".OO."],
    happy: [".OO.", "O..O"],
  },
  32: {
    round: [".OOO.", "OIIIO", "OIWIO", "OIIIO", ".OOO."],
    bright: [".OOO.", "OIIWO", "OIIIO", "OIWIO", "OWIIO", ".OOO."],
    sharp: ["O....", "OOOOO", "WIIWO", "OIIIO", ".OOO."],
    sleepy: [".....", "OOOOO", "OIIWO", "OIIIO", ".OOO."],
    determined: ["OOOOO", "OIIWO", "OIIIO", ".OOO."],
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
    neutral: { smile: ["O..O", ".OO."], grin: ["OOOOOO", "OWWWWO", ".OOOO."], serious: ["OOOO"], smirk: ["...OO", "OOOO."] },
    win: { smile: ["OOOO", "OMMO", ".OO."], grin: ["OOOOOO", "OWWWWO", "OLMMLO", ".OOOO."], serious: ["OOOO", "OMMO", ".OO."], smirk: ["..OOO", "OOMMO", ".OOO."] },
    lose: { smile: [".OO.", "O..O"], grin: ["OOOO", "OMMO", "OOOO"], serious: ["O.OO"], smirk: ["OOOO.", "...OO"] },
  },
  32: {
    neutral: { smile: ["O....O", ".OOOO."], grin: ["OOOOOOOO", "OWWWWWWO", ".OOOOOO."], serious: ["OOOOOO"], smirk: ["....OOO", "OOOOO.."] },
    win: { smile: ["OOOOOO", "OMMMMO", ".OLLO.", "..OO.."], grin: ["OOOOOOOO", "OWWWWWWO", "OMMMMMMO", ".OLLLLO.", "..OOOO.."], serious: ["OOOOOO", "OMMMMO", ".OOOO."], smirk: ["...OOOO", "OOOMMMO", ".OOOOO."] },
    lose: { smile: [".OOOO.", "O....O"], grin: ["OOOOOO", "OMMMMO", "OMMMMO", "OOOOOO"], serious: ["O.OOOO"], smirk: ["OOOOO..", "....OOO"] },
  },
  16: {
    neutral: { smile: ["O..O", ".OO."], grin: ["OOOO", "OWWO"], serious: ["OOO"], smirk: ["..OO", "OOO."] },
    win: { smile: ["OOOO", "OMMO"], grin: ["OOOO", "OWWO", "OMMO"], serious: ["OOO", "OMO"], smirk: ["..OO", "OMMO"] },
    lose: { smile: [".OO.", "O..O"], grin: ["OOOO", "OMMO"], serious: ["O.OO"], smirk: ["OOO.", "..OO"] },
  },
};
