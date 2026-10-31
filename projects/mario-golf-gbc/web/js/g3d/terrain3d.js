// The ground of the 3D hole view (render only), from the hole's own maps (hole3d.js HoleArt):
//  * the trees: the map tiles the game marks as trees (bit 7 of the tile's $D700 byte, TreeCheck 08:51D2) are cut out of the course
//    picture (their pixels take the ground colour round them) and stood up as bodies (scene.js), each from its own tiles;
//  * HILLS (cosmetic, draw-only): heights from the slope data. Off the green each 4 x 4 cell's slope (SlopeCellAt 10:674E: a push
//    direction) is a downhill direction; on the green the slope byte's strength and direction (GreenSlopeAt 10:64D1). The heights
//    are the surface whose gradient best matches those directions (a Poisson solve), plus mounds rising in the out-of-bounds woods,
//    hollow bunkers and a lowered water line. The game keeps its flat values: the ball's drawn height is its height over this surface.
import { T, MAP, CELLS, PX, dirVec } from "./hole3d.js";

// ---- the trees: connected groups of tree tiles, each a picture (RGBA, the ground colour transparent) and its foot on the map ----
export function extractTrees(art, ground) {
  const seen = new Uint8Array(MAP * MAP), trees = [];
  const { idx } = art.indexMap();
  for (let i = 0; i < MAP * MAP; i++) {
    if (!art.treeTile[i] || seen[i]) continue;
    const stack = [i], tiles = []; seen[i] = 1;
    while (stack.length) {
      const j = stack.pop(); tiles.push(j); const x = j % MAP, y = (j / MAP) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy, k = Y * MAP + X;
        if (X >= 0 && Y >= 0 && X < MAP && Y < MAP && art.treeTile[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
      }
    }
    let x0 = 99, y0 = 99, x1 = -1, y1 = -1;
    for (const j of tiles) { const x = j % MAP, y = (j / MAP) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    // big groups (a wood drawn as tree tiles) are split into tile pairs so no tree is too wide
    for (let ty = y0; ty <= y1; ty += 2) for (let tx = x0; tx <= x1; tx++) {
      const part = tiles.filter(j => { const x = j % MAP, y = (j / MAP) | 0; return x === tx && (y === ty || y === ty + 1); });
      if (part.length) trees.push(treePicture(art, ground, idx, part));
    }
  }
  return trees.filter(Boolean);
}
function treePicture(art, ground, idx, tiles) {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (const j of tiles) { const x = (j % MAP) * 8, y = ((j / MAP) | 0) * 8; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 8); y1 = Math.max(y1, y + 8); }
  const w = x1 - x0, h = y1 - y0, n = w * h;
  // the background: the commonest colour round the picture's border; flood-filled from the border through that colour
  const at = (x, y) => (y0 + y) * PX + x0 + x, count = new Map();
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { const c = colourKey(ground, at(x, y)); count.set(c, (count.get(c) || 0) + 1); }
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { const c = colourKey(ground, at(x, y)); count.set(c, (count.get(c) || 0) + 1); }
  const bg = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const out = new Uint8Array(n * 4), clear = new Uint8Array(n), st = [];
  for (let x = 0; x < w; x++) { st.push([x, 0], [x, h - 1]); } for (let y = 0; y < h; y++) { st.push([0, y], [w - 1, y]); }
  while (st.length) {
    const [x, y] = st.pop(); if (x < 0 || y < 0 || x >= w || y >= h || clear[y * w + x]) continue;
    if (colourKey(ground, at(x, y)) !== bg) continue;
    clear[y * w + x] = 1; st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  let bottom = -1, sumX = 0, cnt = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, q = at(x, y) * 4;
    if (clear[i]) continue;
    out.set(ground.subarray(q, q + 3), i * 4); out[i * 4 + 3] = 255;
    if (y > bottom) { bottom = y; sumX = 0; cnt = 0; } if (y === bottom) { sumX += x; cnt++; }
  }
  if (bottom < 0) return null;
  // the ground under it: the background colour (the picture on the ground loses the tree)
  const bgRGB = [bg >> 16 & 255, bg >> 8 & 255, bg & 255];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!clear[y * w + x]) { const q = at(x, y) * 4; ground[q] = bgRGB[0]; ground[q + 1] = bgRGB[1]; ground[q + 2] = bgRGB[2]; }
  return { rgba: out.subarray(0, w * (bottom + 1) * 4), w, h: bottom + 1, x0, y0, footX: x0 + sumX / cnt + 0.5, footZ: y0 + bottom + 1, key: [...out.subarray(0, w * (bottom + 1) * 4)].join(",").length + ":" + tiles.map(j => art.tmap[j] + "/" + art.attrs[j]).join(",") };
}
const colourKey = (img, p) => img[p * 4] << 16 | img[p * 4 + 1] << 8 | img[p * 4 + 2];

// ---- the mean colour of each terrain type over the hole (the courtfloor's base colours: the hole's own) ----
export function terrainColours(art, ground) {
  const sum = new Map();
  for (let z = 0; z < PX; z++) for (let x = 0; x < PX; x++) {
    const t = art.terrain[(z >> 1) * CELLS + (x >> 1)], q = (z * PX + x) * 4;
    let s = sum.get(t); if (!s) sum.set(t, s = [0, 0, 0, 0]);
    s[0] += ground[q]; s[1] += ground[q + 1]; s[2] += ground[q + 2]; s[3]++;
  }
  const out = new Float32Array(16 * 3);
  for (const [t, s] of sum) for (let k = 0; k < 3; k++) out[t * 3 + k] = s[k] / s[3] / 255;
  return out;
}

// ---- HILLS: heights at the cell corners ((CELLS + 1)^2, 2 px apart) ----
// sand: "fine" (SAND: Fine: rounded bunker hollows with a raised grass lip, type 2 only; the desert's low soft dunes) or "pixel"
// (the look before: hollows under both bunker types); desert: the Dune course (its out-of-bounds sand)
export function buildHeights(art, { iterations = 160, greenCorner = null, sand: sandStyle = "pixel", desert = false } = {}) {
  const N = CELLS, H = new Float32Array(N * N);
  const gx = new Float32Array(N * N), gz = new Float32Array(N * N);
  const K = 0.22, KG = 0.05;                      // the rise per pixel along a slope cell / per green slope step
  for (let i = 0; i < N * N; i++) {
    const d = art.slopeDir[i];
    if (d >= 0) { const [vx, vz] = dirVec(d); gx[i] = -vx * K * 2; gz[i] = -vz * K * 2; }   // (per cell = 2 px)
  }
  // the green's slope bytes (the course map's tile bytes on green tiles: strength bits 4-5, the direction)
  for (let ty = 0; ty < MAP; ty++) for (let tx = 0; tx < MAP; tx++) {
    const [v, b] = art.hole.slopeAt(tx << 8 | 0x80, ty << 8 | 0x80), s = (v >> 4) & 3;
    if (!s || v & 0x80) continue;
    const [vx, vz] = dirVec(b);
    for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) {
      const i = (ty * 4 + cy) * N + tx * 4 + cx; if (art.terrain[i] !== T.GREEN) continue;
      gx[i] = -vx * KG * s * 2; gz[i] = -vz * KG * s * 2;
    }
  }
  // Poisson: the divergence of (gx, gz), then SOR sweeps (Neumann edges)
  const div = new Float32Array(N * N);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const i = z * N + x;
    div[i] = (x < N - 1 ? (gx[i] + gx[i + 1]) / 2 : gx[i]) - (x > 0 ? (gx[i] + gx[i - 1]) / 2 : gx[i])
           + (z < N - 1 ? (gz[i] + gz[i + N]) / 2 : gz[i]) - (z > 0 ? (gz[i] + gz[i - N]) / 2 : gz[i]);
  }
  let any = false; for (let i = 0; i < N * N; i++) if (div[i]) { any = true; break; }
  if (any) {
    // a coarse solve first (8 x 8 cells) for the long hills, then the fine sweeps
    const C = N / 8, hc = new Float32Array(C * C), dc = new Float32Array(C * C);
    for (let i = 0; i < N * N; i++) dc[((i / N | 0) >> 3) * C + ((i % N) >> 3)] += div[i] / 8;
    for (let it = 0; it < 400; it++) for (let z = 0; z < C; z++) for (let x = 0; x < C; x++) {
      const i = z * C + x; let s = 0, n = 0;
      if (x > 0) { s += hc[i - 1]; n++; } if (x < C - 1) { s += hc[i + 1]; n++; } if (z > 0) { s += hc[i - C]; n++; } if (z < C - 1) { s += hc[i + C]; n++; }
      hc[i] += 1.9 * ((s - dc[i]) / n - hc[i]);
    }
    for (let i = 0; i < N * N; i++) H[i] = hc[((i / N | 0) >> 3) * C + ((i % N) >> 3)] * 8 / 8;
    for (let it = 0; it < iterations; it++) for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const i = z * N + x; let s = 0, n = 0;
      if (x > 0) { s += H[i - 1]; n++; } if (x < N - 1) { s += H[i + 1]; n++; } if (z > 0) { s += H[i - N]; n++; } if (z < N - 1) { s += H[i + N]; n++; }
      H[i] += 1.85 * ((s - div[i]) / n - H[i]);
    }
    // the playing area's mean at 0
    let m = 0, c = 0; for (let i = 0; i < N * N; i++) if (art.terrain[i] !== T.OB) { m += H[i]; c++; }
    if (c) for (let i = 0; i < N * N; i++) H[i] -= m / c;
    for (let i = 0; i < N * N; i++) H[i] = Math.max(-6, Math.min(6, H[i]));
  }
  // distance (cells) into the woods (out of bounds), into bunkers and water
  const dist = (pred) => {
    const d = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) d[i] = pred(art.terrain[i]) ? 1e9 : 0;
    const relax = (i, j, w) => { if (d[j] + w < d[i]) d[i] = d[j] + w; };
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) { const i = z * N + x; if (x) relax(i, i - 1, 1); if (z) { relax(i, i - N, 1); if (x) relax(i, i - N - 1, 1.41); if (x < N - 1) relax(i, i - N + 1, 1.41); } }
    for (let z = N - 1; z >= 0; z--) for (let x = N - 1; x >= 0; x--) { const i = z * N + x; if (x < N - 1) relax(i, i + 1, 1); if (z < N - 1) { relax(i, i + N, 1); if (x < N - 1) relax(i, i + N + 1, 1.41); if (x) relax(i, i + N - 1, 1.41); } }
    for (let i = 0; i < N * N; i++) if (d[i] > 1e8) d[i] = 60;
    return d;
  };
  // (SAND: Fine: only type 2 is a hollow bunker; type $0D, which the game also plays as a bunker (10:5068, the same TerrainPropTable
  // row), is the Dune course's sandy waste round the holes and stays level with the ground round it)
  const fine = sandStyle === "fine", isB = fine ? t => t === T.BUNKER : t => t === T.BUNKER || t === T.BUNKER2;
  const ob = dist(t => t === T.OB), sand = dist(isB), water = dist(t => t === T.WATER), lip = fine ? dist(t => !isB(t)) : null;
  const noise = (x, z) => Math.sin(x * 0.11 + Math.sin(z * 0.07) * 2) * Math.cos(z * 0.09 + Math.sin(x * 0.05)) + 0.5 * Math.sin(x * 0.27 + z * 0.19);
  const ss = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const i = z * N + x;
    if (ob[i] > 0) {
      if (fine && desert) H[i] += 9 * (1 - Math.exp(-ob[i] / 16)) * (1 + 0.3 * noise(x * 0.8, z * 0.8)) + 1.2 * Math.min(1, ob[i] / 4) * noise(x * 1.3, z * 1.2);
      else H[i] += 14 * (1 - Math.exp(-ob[i] / 14)) * (1 + 0.35 * noise(x, z)) + 2.5 * Math.min(1, ob[i] / 4) * noise(x * 2.3, z * 2.1);
    }
    if (sand[i] > 0) H[i] -= fine ? 1.2 * ss(0, 3, sand[i]) : 1.4 * Math.min(1, sand[i] / 2.5);
    else if (fine && lip[i] > 0 && lip[i] < 3) H[i] += 0.35 * (1 - lip[i] / 3);   // the raised grass lip
    if (water[i] > 0) H[i] -= 1.2 * Math.min(1, water[i] / 1.5);
  }
  // to the corners
  const V = N + 1, out = new Float32Array(V * V);
  for (let z = 0; z <= N; z++) for (let x = 0; x <= N; x++) {
    let s = 0, n = 0;
    for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) { const X = x + dx, Z = z + dz; if (X >= 0 && Z >= 0 && X < N && Z < N) { s += H[Z * N + X]; n++; } }
    out[z * V + x] = s / n;
  }
  return out;
}

// a height field's sampler (world px): bilinear over the corners, 0 off the map's edge (the skirt beyond is at the edge's height)
export function heightSampler(Hc) {
  const V = CELLS + 1;
  if (!Hc) return () => 0;
  return (x, z) => {
    const fx = Math.max(0, Math.min(CELLS - 1e-3, x / 2)), fz = Math.max(0, Math.min(CELLS - 1e-3, z / 2));
    const ix = fx | 0, iz = fz | 0, ax = fx - ix, az = fz - iz, i = iz * V + ix;
    return (Hc[i] * (1 - ax) + Hc[i + 1] * ax) * (1 - az) + (Hc[i + V] * (1 - ax) + Hc[i + V + 1] * ax) * az;
  };
}

// ---- GRASS: Carpet: the lawn's colour without the game's dither (RGBA PX x PX): rgb the mean of the 5 x 5 pixels round each pixel
// that have its terrain type; alpha near the green (the fringe: 255 next to it, fading out over 3 px) on the grass round it ----
export function cleanMap(art, ground) {
  const out = new Uint8Array(PX * PX * 4), tt = new Uint8Array(PX * PX);
  for (let z = 0; z < PX; z++) for (let x = 0; x < PX; x++) tt[z * PX + x] = art.terrain[(z >> 1) * CELLS + (x >> 1)];
  for (let z = 0; z < PX; z++) for (let x = 0; x < PX; x++) {
    const i = z * PX + x, t = tt[i]; let r = 0, g = 0, b = 0, n = 0, dg = 9;
    for (let dz = -3; dz <= 3; dz++) {
      const Z = z + dz; if (Z < 0 || Z >= PX) continue;
      for (let dx = -3; dx <= 3; dx++) {
        const X = x + dx; if (X < 0 || X >= PX) continue;
        const j = Z * PX + X, tj = tt[j];
        if (tj === T.GREEN && t !== T.GREEN) dg = Math.min(dg, Math.max(Math.abs(dx), Math.abs(dz)));
        if (tj !== t || dx < -2 || dx > 2 || dz < -2 || dz > 2) continue;
        r += ground[j * 4]; g += ground[j * 4 + 1]; b += ground[j * 4 + 2]; n++;
      }
    }
    out[i * 4] = r / n; out[i * 4 + 1] = g / n; out[i * 4 + 2] = b / n; out[i * 4 + 3] = dg > 3 ? 0 : Math.round(255 * Math.min(1, (4 - dg) / 3));
  }
  return out;
}

// ---- SAND: Fine: the sand's masks per cell (RGBA CELLS x CELLS): R the bunkers (type 2), blurred (their edge at 0.5: rounded
// outlines); G the desert's sand (on the Dune course: the brown out-of-bounds and rough, and type $0D, the sandy waste round the
// holes), blurred; A the bunker, hard ----
export function sandMasks(art, ground, desert) {
  const N = CELLS, b = new Float32Array(N * N), d = new Float32Array(N * N), out = new Uint8Array(N * N * 4);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const i = z * N + x, t = art.terrain[i];
    b[i] = t === T.BUNKER ? 1 : 0;
    if (desert && t === T.BUNKER2) d[i] = 1;
    else if (desert && (t === T.OB || t === T.ROUGH)) { const q = (z * 2 * PX + x * 2) * 4; d[i] = ground[q] > ground[q + 1] + 8 ? 1 : 0; }
  }
  const blur = (a, r) => { const t = new Float32Array(N * N), o = new Float32Array(N * N);
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const X = x + k; if (X >= 0 && X < N) { s += a[z * N + X]; n++; } } t[z * N + x] = s / n; }
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const Z = z + k; if (Z >= 0 && Z < N) { s += t[Z * N + x]; n++; } } o[z * N + x] = s / n; }
    return o; };
  const bb = blur(blur(b, 1), 1), db = blur(blur(d, 2), 1);
  for (let i = 0; i < N * N; i++) { out[i * 4] = Math.round(bb[i] * 255); out[i * 4 + 1] = Math.round(db[i] * 255); out[i * 4 + 3] = b[i] * 255; }
  return out;
}
