// HD court floors for the 3D / VOX court: the ground texture (voxel.js paintGround: the ROM's court picture, one texel = 6 world units) gets a
// surface of its own, generated at run time from the court's own palette colours (nothing from the ROM is stored here):
//   hard   fine grain, a soft sheen across the court and a few specks,
//   clay   a rough warm grain, sweep arcs, scuffed baselines and ball marks,
//   grass  mowing stripes along the court, a fine blade grain and worn patches at the baselines and the service area,
//   other  (the special courts) a glossy checker pattern and a diagonal sheen in the court's own colours.
// The court LINES are exact: a texel of the line colour is copied as it is, and the floor beside it gets a soft shadow of the line. The result
// stays vivid (a little saturation is added to the surface, nothing is greyed). The detail (a per-texel brightness and wear, from fixed integer hashes:
// the same every run) is built once per court; every palette change (fades) only recolours.
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const hash = (x, y, s = 0) => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s, 2246822519)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const smooth = t => t * t * (3 - 2 * t);
const vnoise = (x, y, s) => { const xi = Math.floor(x), yi = Math.floor(y), fx = smooth(x - xi), fy = smooth(y - yi); const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s); return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; };

// kind of surface by the game's map id (wCurMapID): 4 clay, 2 grass, 5 hard (and 1 / 3 / 7: other grass, clay, hard variants as the courts' names say)
export function surfaceKind(mapId) { return mapId === 4 ? "clay" : mapId === 2 ? "grass" : mapId === 5 ? "hard" : "special"; }

// per-texel detail for a W x H ground whose texel (i, j) is at world (x0 + 6 i, y0 + 6 j): dl: brightness (1/256 units), dw: wear / warmth (0..127)
export function buildDetail(kind, W, H, x0, y0, texel) {
  const dl = new Int8Array(W * H), dw = new Int8Array(W * H), arcs = [];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const X = x0 + i * texel, Y = y0 + j * texel, o = j * W + i, g = hash(i, j, 1) - 0.5, g2 = hash(i >> 1, j >> 1, 2) - 0.5;
    const ay = Math.abs(Y), baseline = Math.abs(ay - 1248) < 150 ? 1 - Math.abs(ay - 1248) / 150 : 0, inCourt = Math.abs(X) < 560 && ay < 1400;
    let l = 0, w = 0;
    if (kind === "hard") {
      l = g * 40 + g2 * 16 + 14 * Math.sin(X / 340 + Y / 520) + 10 * Math.max(0, 1 - Math.hypot(X + 300, Y + 500) / 900) + (hash(i, j, 3) > 0.9985 ? 60 : 0);                       // grain, a broad sheen, specks
    } else if (kind === "clay") {
      const n = vnoise(X / 22, Y / 22, 4) - 0.5, r = Math.hypot(X - 0, Y + 1500) / 70, arc = Math.abs(r - Math.round(r)) < 0.06 && inCourt ? 1 : 0;   // sweep arcs (concentric about the far end)
      const scuff = baseline * (vnoise(X / 38, Y / 16, 5) > 0.5 ? 1 : 0.35), mark = hash(Math.floor(X / 90), Math.floor(Y / 90), 6) > 0.985 && inCourt && Math.hypot(((X % 90) + 90) % 90 - 45, ((Y % 90) + 90) % 90 - 45) < 5 ? 1 : 0;
      l = g * 38 + g2 * 14 + n * 26 - arc * 14 - mark * 34 - scuff * 18; w = clamp(Math.round(scuff * 60 + mark * 50), 0, 127);
    } else if (kind === "grass") {
      const stripe = Math.floor(Y / 150) & 1 ? 1 : -1, blade = hash(i, j, 7) - 0.5, patch = baseline * (vnoise(X / 40, Y / 20, 8) > 0.45 ? 1 : 0.25) + (Math.abs(ay - 640) < 90 ? 0.4 * (vnoise(X / 30, Y / 30, 9) > 0.55 ? 1 : 0) : 0);
      l = stripe * 17 + blade * 36 + g2 * 10 - patch * 18; w = clamp(Math.round(patch * 85), 0, 127);
    } else {
      const cx = Math.floor(X / 110), cy = Math.floor(Y / 110), chk = ((cx + cy) & 1) ? 1 : -1;
      l = chk * 22 + g * 8 + 16 * Math.sin((X + Y) / 260) + (((cx + cy) & 1) && hash(i, j, 10) > 0.996 ? 30 : 0);       // glossy checker, a diagonal sheen
    }
    dl[o] = clamp(Math.round(l), -127, 127); dw[o] = w;
  }
  return { dl, dw, kind };
}

// colours (lut: 4 bytes per palette index + 1) that are lines: the lightest of the colours the court is mostly made of
export function lineColours(idx, lut) {
  const cnt = new Uint32Array(33); for (let i = 0; i < idx.length; i++) cnt[idx[i]]++;
  const lum = k => 0.299 * lut[k * 4] + 0.587 * lut[k * 4 + 1] + 0.114 * lut[k * 4 + 2];
  let best = 0; for (let k = 1; k <= 32; k++) if (cnt[k] > 150 && lum(k) > best) best = lum(k);
  const L = new Uint8Array(33); if (best < 60) return L;                                   // a dark / faded screen: no lines (nothing to protect)
  for (let k = 1; k <= 32; k++) if (cnt[k] > 150 && lum(k) >= best * 0.86 && cnt[k] < idx.length * 0.2) L[k] = 1;
  return L;
}

// recolours the ground: rgba (W x H x 4), src (texel -> map pixel), idx (map pixel -> palette index + 1), lut (colours), detail from buildDetail
export function paintFloor(rgba, src, idx, lut, W, H, detail) {
  const L = lineColours(idx, lut), { dl, dw, kind } = detail, N = W * H;
  const tint = kind === "clay" ? [0.62, 0.42, 0.22] : kind === "grass" ? [0.84, 0.70, 0.35] : [1, 1, 1];     // what a worn patch turns towards (of the texel's own colour)
  const sat = kind === "special" ? 1.18 : 1.2, gloss = kind === "special" || kind === "hard" ? 1 : 0;
  for (let i = 0; i < N; i++) {
    const k = idx[src[i]], o = i * 4; let r = lut[k * 4], g = lut[k * 4 + 1], b = lut[k * 4 + 2];
    if (L[k]) { rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255; continue; }                  // the lines: exact
    let m = 1 + dl[i] / 256;
    const x = i % W, y = (i / W) | 0;
    if (x > 2 && y > 2 && L[idx[src[i - 2 * W - 2]]]) m *= 0.84; else if (x > 1 && y > 1 && L[idx[src[i - W - 1]]]) m *= 0.92;   // the soft shadow of a line (light from the upper left)
    const w = dw[i] / 127;
    if (w > 0) { r = r + (r * tint[0] + 14 - r) * w; g = g + (g * tint[1] + 6 - g) * w; b = b + (b * tint[2] - b) * w; }
    r *= m; g *= m; b *= m;
    const l = 0.299 * r + 0.587 * g + 0.114 * b; r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
    if (gloss && dl[i] > 30) { r += 10; g += 10; b += 10; }                                                      // a glint
    rgba[o] = r < 0 ? 0 : r > 255 ? 255 : r; rgba[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g; rgba[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b; rgba[o + 3] = 255;
  }
}
