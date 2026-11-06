// TREES: Courtyard (the default) for the 3D hole view (render only): the course's trees in the design of Mario Tennis's courtyard and
// restaurant plaza (its stadium3d.js egg(): an egg-shaped crown rising to a point, its waist low, pale yellow-green with white glints up
// the lit side, deep green below the waist and round the back, a dark rim, on a trunk with an orange-soil base), made of small leaf
// boxes. Each tree tile of the hole (bit 7 of the tile byte, cut out by terrain3d.js extractTrees) stays where it is and as big as its
// picture, and takes the shape that fits the course: egg crowns for broadleaf trees, cypress cones for tall narrow ones, low mounds for
// bushes, palms on the Palm club (a ringed, bending trunk with drooping fronds), cacti on the Dune club (ribbed, rounded columns with
// arms). Colours come from the hole's own tree pictures (and its bunkers' sand for the soil), tuned toward the courtyard's look. The
// meshes are built here at run time (nothing from the ROM is stored); a handful of variants per hole, shared by its trees. TREES:
// Original keeps the old bodies (the tile pictures stood up, voxround.js).
// Lite: bigger leaf boxes (about a third as many faces).
// Each mesh comes in two: the faces the camera can see (the tree faces the camera) for the picture, all of them for the shadow map (in boxes 2.4x Full's).

export const TREE_STYLES = { courtyard: "Courtyard", original: "Original" };

// ---- the hole's tree colours, from its tree pictures ----
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const lum = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const isGreen = c => c[1] > c[0] * 0.95 && c[1] > c[2] * 1.05 && c[1] > 40;
const isBrown = c => c[0] > c[1] * 1.08 && c[1] > c[2] * 1.05 && c[0] > 50;
// the courtyard look the hole's own colours are pulled toward (hand-picked: a pale yellow-green, a deep green, white, a dark rim, orange soil)
const CY = { leaf: [150, 200, 30], lo: [20, 130, 30], glint: [250, 250, 240], rim: [50, 20, 40], soil: [230, 140, 20], trunk: [104, 72, 44] };

export function treePalette(trees, sand) {
  const greens = new Map(), browns = new Map();
  for (const t of trees) for (let i = 0; i < t.rgba.length; i += 4) {
    if (t.rgba[i + 3] < 128) continue;
    const c = [t.rgba[i], t.rgba[i + 1], t.rgba[i + 2]], k = c.join(",");
    if (isGreen(c)) greens.set(k, (greens.get(k) || 0) + 1); else if (isBrown(c)) browns.set(k, (browns.get(k) || 0) + 1);
  }
  const g = [...greens.keys()].map(k => k.split(",").map(Number)).sort((a, b) => lum(a) - lum(b));
  const light = g.length ? g[g.length - 1] : CY.leaf, dark = g.length ? g[0] : CY.lo, mid = g.length ? g[g.length >> 1] : mix(CY.leaf, CY.lo, 0.5);
  const br = [...browns.entries()].sort((a, b) => b[1] - a[1]);
  const trunk = br.length ? mix(br[0][0].split(",").map(Number), CY.trunk, 0.5) : CY.trunk;
  const soil = sand && lum(sand) > 40 ? mix(sand, CY.soil, 0.55) : CY.soil;
  const leaf = mix(mix(light, mid, 0.2), CY.leaf, 0.6);
  return {
    leaf: mix(leaf, [236, 250, 150], 0.22), lo: mix(mix(dark, mid, 0.35), CY.lo, 0.45), glint: mix(mix(light, [255, 255, 255], 0.7), CY.glint, 0.5),
    rim: mix(mul(dark, 0.55), CY.rim, 0.35), soil, trunk,
  };
}

// ---- the trees of the hole, one per tree tile, with the shape that fits ----
// course: the club ($C836: 1 Marion, 2 Palm, 3 Dune, 4 Links, 5 Peach's, 9 Pitch and Putt...)
export function courtyardTrees(trees, course) {
  const out = [];
  for (const t of trees) {
    for (let b = 0; b * 8 < t.h; b++) {                      // each 8-row block of the picture: one tree tile
      let x0 = 99, x1 = -1, y0 = 99, y1 = -1, n = 0;
      for (let y = b * 8; y < Math.min(t.h, b * 8 + 8); y++) for (let x = 0; x < t.w; x++) if (t.rgba[(y * t.w + x) * 4 + 3] >= 128) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      if (!n) continue;
      const W = x1 - x0 + 1, D = y1 - y0 + 1, x = t.x0 + (x0 + x1 + 1) / 2, z = t.y0 + (y0 + y1 + 1) / 2;
      const r = hash(x, z, 1), tall = D >= 6 && W <= 4;
      let kind = course === 2 ? "palm" : course === 3 ? "cactus" : n < 18 || (W <= 4 && D <= 4) ? "bush" : tall ? "cypress" : "egg";
      if (kind === "egg" && r < 0.12) kind = "cypress";        // (a cypress here and there among the broadleaf trees)
      if (kind === "palm" && r < 0.1) kind = "bush";
      out.push({ x, z, kind, size: Math.max(W, D) / 8, variant: Math.floor(hash(x, z, 2) * 3), k: 0.88 + hash(x, z, 3) * 0.24, phase: hash(x, z, 4) * 6.28 });
    }
  }
  return out;
}
const hash = (x, z, k) => { const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453; return s - Math.floor(s); };

// ---- a voxel builder: cells of size cs, only the faces between a cell and an empty one are drawn ----
class Vox {
  constructor(cs) { this.cs = cs; this.m = new Map(); }
  static key(i, j, k) { return ((i + 256) * 512 + (j + 256)) * 512 + (k + 256); }
  set(i, j, k, c) { this.m.set(Vox.key(i, j, k), c); }
  at(x, y, z, c) { this.set(Math.floor(x / this.cs), Math.floor(y / this.cs), Math.floor(z / this.cs), c); }
  has(i, j, k) { return this.m.has(Vox.key(i, j, k)); }
  // the colour mesh holds only the faces the camera can see: a tree is turned so the camera lies on its +z axis (scene.js bodies), so
  // the faces turned away (-z, and the sides facing out from the axis) are never seen; the depth mesh (the sun's shadow) has them all
  mesh() {
    const pos = [], col = [], dpos = [], s = this.cs;
    // faces: [di, dj, dk, shade, 4 corners (unit cube)]; the light from the upper left front
    const F = [[0, 1, 0, 1.0, [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]]], [0, -1, 0, 0.5, [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]]],
      [1, 0, 0, 0.7, [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]]], [-1, 0, 0, 0.86, [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]]],
      [0, 0, 1, 0.92, [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1]]], [0, 0, -1, 0.62, [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]]];
    for (const [key, c] of this.m) {
      const k = key % 512 - 256, j = Math.floor(key / 512) % 512 - 256, i = Math.floor(key / 262144) - 256;
      for (const [di, dj, dk, sh, q] of F) {
        if (this.has(i + di, j + dj, k + dk)) continue;
        const seen = dk === 1 || dj !== 0 || (di === 1 && i + 1 <= 0) || (di === -1 && i >= 0);
        for (const v of [0, 1, 2, 0, 2, 3]) {
          const p = q[v], x = (i + p[0]) * s, y = (j + p[1]) * s, z = (k + p[2]) * s; dpos.push(x, y, z);
          if (seen) { pos.push(x, y, z); col.push(c[0] / 255 * sh, c[1] / 255 * sh, c[2] / 255 * sh); }
        }
      }
    }
    return { pos: new Float32Array(pos), col: new Float32Array(col), dpos: new Float32Array(dpos) };
  }
}
// the light in the tree's own space: from the upper left front (the tree's front is turned to the camera, as the courtyard's face
// the Tennis camera, so its lit side shows)
const LL = (() => { const l = [-0.42, 0.62, 0.66], n = Math.hypot(...l); return l.map(v => v / n); })();

// ---- the shapes (world units: 1 = a course pixel; the foot at the origin, y up). size: the tile's picture across (1 = 8 px) ----
// returns { pos, col } (the faces the camera sees), dpos (every face, for the shadow map: in boxes 2.4x Full's) and, in Full,
// far: { pos, col } in bigger boxes (Full: Lite's; Lite: 2.8x Full's) for the trees far from the camera
export function treeMeshData(kind, pal, size, variant, lite) {
  const d = shape(kind, pal, size, variant, lite ? 1.8 : 1);
  const c = shape(kind, pal, size, variant, lite ? 2.8 : 1.8); d.far = { pos: c.pos, col: c.col };   // (far: the trees far off, in bigger boxes)
  d.dpos = shape(kind, pal, size, variant, 2.4).dpos;                  // (the shadow: coarser still)
  return d;
}
function shape(kind, pal, size, variant, coarse) {
  const cs = (kind === "cactus" ? 0.42 : kind === "palm" ? 0.7 : 0.8) * coarse, V = new Vox(cs), lite = coarse > 1, R = (k) => hash(variant * 17.3 + 1, kind.length * 3.1, k);
  const each = (x0, x1, y0, y1, z0, z1, f) => {           // every cell centre in a box
    for (let i = Math.floor(x0 / cs); i * cs <= x1; i++) for (let j = Math.max(0, Math.floor(y0 / cs)); j * cs <= y1; j++) for (let k = Math.floor(z0 / cs); k * cs <= z1; k++) {
      const c = f((i + 0.5) * cs, (j + 0.5) * cs, (k + 0.5) * cs, i, j, k); if (c) V.set(i, j, k, c);
    }
  };
  const lump = (nx, ny, nz, s) => 1 + 0.13 * Math.sin(nx * 5.1 + s) * Math.sin(ny * 4.3 + s * 1.7) + 0.08 * Math.sin(nz * 7.7 + ny * 3.1 + s * 2.3);   // leaf clumps
  const soil = (r) => each(-r, r, 0, 0.6, -r, r, (x, y, z) => x * x + z * z <= r * r ? (hash(x, z, 9) < 0.25 ? mul(pal.soil, 0.88) : pal.soil) : null);
  const trunk = (h, r, bend = 0) => each(-r - Math.abs(bend) - 2, r + Math.abs(bend) + 2, 0, h, -r - 2, r + 2, (x, y, z) => {   // (a thin trunk keeps one column of boxes)
    const cx = bend * (y / h) * (y / h), d = Math.hypot(x - cx - cs / 2, z - cs / 2);
    return d <= Math.max(r * (1 - 0.25 * y / h), cs * 0.5) ? (Math.floor(y / 1.1) % 2 && bend ? mul(pal.trunk, 0.78) : x - cx < 0 ? pal.trunk : mul(pal.trunk, 0.8)) : null;
  });
  const glint = (lit, t, x, y, z) => lit > 0.45 && t > 0.4 && hash(x + z * 1.73, y * 1.31 - z * 0.67, 11) < 0.11;
  const s = size * 8;                                            // the tile picture's width in px (world units)
  if (kind === "egg" || kind === "cypress") {
    const cyp = kind === "cypress";
    const Ht = (cyp ? 26 : 21) * (0.9 + 0.2 * R(1)), rx = cyp ? s * 0.42 : s * 0.7, base = Ht * (cyp ? 0.12 : 0.24), hy = Ht - base, waist = cyp ? 0.22 : 0.32;
    soil(rx * (cyp ? 0.85 : 0.48)); trunk(base + 1, cyp ? 0.55 : 0.75);
    const lo = cyp ? mix(pal.lo, [20, 70, 60], 0.3) : pal.lo, leaf = cyp ? mix(pal.leaf, pal.lo, 0.3) : pal.leaf;
    each(-rx * 1.2, rx * 1.2, base, Ht, -rx * 1.2, rx * 1.2, (x, y, z) => {
      const t = (y - base) / hy; if (t >= 1) return null;
      const u = t < waist ? (waist - t) / waist : (t - waist) / (1 - waist);
      const k = cyp ? Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, waist - t) / waist, 2))) * (t < waist ? 1 : Math.pow(1 - u, 0.85))
        : Math.sqrt(Math.max(0, 1 - u * u)) * (t < waist ? 1 : 1 - 0.3 * u);
      const ax = rx * k + 0.01, d = Math.hypot(x, z) / ax;
      const nx = x / rx, nz = z / rx, ny = (t - waist) * 1.6, nl = Math.hypot(nx, ny, nz) || 1;
      if (d > lump(nx, ny, nz, variant * 2.3) * (cyp ? 1.05 : 1)) return null;
      const lit = (nx * LL[0] + ny * LL[1] + nz * LL[2]) / nl, rim = d > 0.82 && lit < -0.15;
      if (rim) return t < waist ? mix(pal.rim, lo, 0.4) : mul(lo, 0.8);
      if (t < waist) return lit > 0.25 ? mix(lo, leaf, 0.35) : lo;
      if (glint(lit, t, x, y, z)) return pal.glint;
      return lit > 0.22 ? (hash(x + 3, y, z) < 0.2 ? mix(leaf, pal.glint, 0.18) : leaf) : lit > -0.12 ? mix(leaf, lo, 0.5) : lo;
    });
  } else if (kind === "bush") {
    const rx = s * 0.62 * (0.9 + 0.2 * R(1)), hy = rx * 1.05;
    soil(rx * 0.95);
    each(-rx * 1.2, rx * 1.2, 0.3, hy + 1, -rx * 1.2, rx * 1.2, (x, y, z) => {
      const nx = x / rx, ny = (y - 0.3) / hy, nz = z / rx, d = Math.hypot(nx, ny, nz);
      if (d > lump(nx, ny, nz, variant * 3.1 + 1)) return null;
      const lit = (nx * LL[0] + ny * LL[1] + nz * LL[2]) / (d || 1);
      if (glint(lit, ny, x, y, z)) return pal.glint;
      return lit > 0.3 ? pal.leaf : lit > -0.1 ? mix(pal.leaf, pal.lo, 0.55) : pal.lo;
    });
  } else if (kind === "palm") {
    const Ht = 20 * (0.85 + 0.3 * R(1)), bend = (R(2) < 0.5 ? -1 : 1) * (1.5 + 2.5 * R(3)), top = [bend, Ht];
    soil(2.4); trunk(Ht, 1.05, bend);
    // the fronds: arcs from the top, out and drooping, a leaf a cell thick with a darker rib, lit on top
    const n = lite ? 6 : 8, L = s * 1.15 * (0.9 + 0.2 * R(4));
    for (let f = 0; f < n; f++) {
      const a = f / n * 6.2832 + R(10 + f) * 0.5, dx = Math.cos(a), dz = Math.sin(a), rise = 0.9 + R(20 + f) * 0.6;
      for (let st = 0; st <= L; st += cs * 0.5) {
        const u = st / L, w = 1.7 * Math.sin(Math.PI * Math.min(1, u * 1.15)) + 0.3, px = top[0] + dx * st, pz = dz * st, py = top[1] + rise * st * 0.6 - 0.55 * st * st / L * 1.6;
        const lit = (dx * LL[0] + dz * LL[2]) * 0.6 + 0.5;
        for (let q = -w; q <= w; q += cs * 0.6) {
          const aq = Math.abs(q), rib = aq < cs * 0.6;
          if (!rib && Math.floor((st + aq * 0.8) / (cs * 1.1)) % 3 === 2) continue;   // the leaflets: slanting gaps along the frond
          const qx = px - dz * q, qz = pz + dx * q, qy = py - aq * 0.5;
          const c = rib ? mix(pal.lo, pal.trunk, 0.3) : glint(lit, u + 0.3, qx, qy, qz) && u > 0.3 ? pal.glint : lit > 0.45 ? pal.leaf : lit > 0.15 ? mix(pal.leaf, pal.lo, 0.5) : pal.lo;
          V.at(qx, qy, qz, c);
        }
      }
    }
    for (let i = 0; i < 3; i++) { const a = i * 2.1 + R(30); V.at(top[0] + Math.cos(a) * 0.9, top[1] - 0.8, Math.sin(a) * 0.9, [120, 84, 40]); }   // coconuts
    each(top[0] - 1.2, top[0] + 1.2, top[1] - 0.5, top[1] + 1.2, -1.2, 1.2, (x, y, z) => Math.hypot(x - top[0], y - top[1], z) < 1.3 ? mix(pal.leaf, pal.lo, 0.4) : null);   // the heart of the crown
  } else if (kind === "cactus") {
    const Ht = 13 * (0.8 + 0.4 * R(1)), r = 1.9, arms = [];
    soil(2.6);
    if (R(2) < 0.85) arms.push([R(3) < 0.5 ? -1 : 1, Ht * (0.35 + 0.15 * R(4)), 2.4 + R(5), Ht * (0.25 + 0.15 * R(6))]);
    if (R(7) < 0.55) arms.push([-arms[0]?.[0] || 1, Ht * (0.5 + 0.12 * R(8)), 2.2 + R(9), Ht * (0.18 + 0.12 * R(10))]);
    const skin = (nx, nz, y, x, z, ang) => {                        // ribs round the column; lit and dark sides; white spines
      const lit = nx * LL[0] + nz * LL[2] + 0.25, rib = Math.cos(ang * 10) > -0.2;
      if (lit > 0.3 && hash(x, y, z) < 0.05) return pal.glint;
      const c = lit > 0.3 ? pal.leaf : lit > -0.1 ? mix(pal.leaf, pal.lo, 0.5) : pal.lo;
      return rib ? c : mul(c, 0.82);
    };
    const column = (cx, y0, y1, rr) => each(cx - rr - 1, cx + rr + 1, y0, y1 + rr, -rr - 1, rr + 1, (x, y, z) => {
      const dx = x - cx, top = Math.max(0, y - (y1 - rr * 0.2)), d = Math.hypot(dx, z, top);
      if (d > rr) return null; const ang = Math.atan2(z, dx); return skin(dx / rr, z / rr, y, x, z, ang);
    });
    column(0, 0, Ht, r);
    for (const [side, y, out, up] of arms) {
      const ar = r * 0.72, ex = side * (r + out);
      each(Math.min(0, ex) - ar, Math.max(0, ex) + ar, y - ar, y + ar, -ar, ar, (x, yy, z) => {   // the elbow out, rounded
        if (side * x < 0 || side * x > Math.abs(ex)) return null;
        const d = Math.hypot(yy - y, z); return d <= ar ? skin(0, z / ar, yy, x, z, Math.atan2(z, yy - y)) : null;
      });
      column(ex, y, y + up, ar);
    }
  }
  return V.mesh();
}
// the crown's height (world units) for the sway and the shadow spot
export const treeHeight = kind => kind === "cypress" ? 26 : kind === "palm" ? 21 : kind === "cactus" ? 13 : kind === "bush" ? 6 : 21;
