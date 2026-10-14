// Overworld (RPG map) 3D helpers that need no WebGL, used by voxel.js to stand the annotated objects of
// field_objects.js up from the map picture: cut-out masks, pixel-exact sprite matching, extruded low solids
// (planters, fountain basins), swaying flowers, the fountain jet, and the floor fill under cut-outs.
// The map picture ("art") is 512x512 RGBA, map pixel (x, y) at ((y * 512) + x) * 4.
export const ART = 512;
export const WALL_SCALE = 1.25;                 // a wall drawn h rows tall in the 3/4 view stands h * 1.25 high
const lum = (r, g, b) => r * 0.3 + g * 0.59 + b * 0.11;
export const packAt = (art, x, y) => { if (x < 0 || y < 0 || x >= ART || y >= ART) return -1; const o = (y * ART + x) * 4; return art[o] << 16 | art[o + 1] << 8 | art[o + 2]; };

// colours of the ground around a rectangle: those making up >= 5% of a 3 px ring outside it
function groundKeys(art, x0, y0, w, h) {
  const hist = new Map(); let n = 0;
  for (let k = 1; k <= 3; k++) {
    for (let x = x0 - 3; x < x0 + w + 3; x++) for (const y of [y0 - k, y0 + h - 1 + k]) { const c = packAt(art, x, y); if (c >= 0) { hist.set(c, (hist.get(c) || 0) + 1); n++; } }
    for (let y = y0; y < y0 + h; y++) for (const x of [x0 - k, x0 + w - 1 + k]) { const c = packAt(art, x, y); if (c >= 0) { hist.set(c, (hist.get(c) || 0) + 1); n++; } }
  }
  return new Set([...hist].filter(([, v]) => v >= n * 0.05).map(([c]) => c));
}
// the darkest colour inside a rectangle (the outline colour of this art)
function darkest(art, x0, y0, w, h) {
  let best = -1, bl = 1e9;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const o = (y * ART + x) * 4, l = lum(art[o], art[o + 1], art[o + 2]); if (l < bl) { bl = l; best = packAt(art, x, y); } }
  return best;
}
function copyRect(art, x0, y0, w, h) {
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4, s = ((y0 + y) * ART + x0 + x) * 4; d[o] = art[s]; d[o + 1] = art[s + 1]; d[o + 2] = art[s + 2]; d[o + 3] = 255; }
  return d;
}
// flood from the rectangle's border through `pass` colours: those pixels become transparent
function floodKey(art, d, x0, y0, w, h, pass) {
  const out = new Uint8Array(w * h), st = [];
  const push = (x, y) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const i = y * w + x; if (out[i] || !pass.has(packAt(art, x0 + x, y0 + y))) return; out[i] = 1; st.push(i); };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); } for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (st.length) { const i = st.pop(), x = i % w, y = (i / w) | 0; d[i * 4 + 3] = 0; push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }
}
// keyed cut-out (the original rule): ground colours connected to the edge become transparent
export function keyedCut(art, x0, y0, w, h) {
  const d = copyRect(art, x0, y0, w, h); floodKey(art, d, x0, y0, w, h, groundKeys(art, x0, y0, w, h)); return d;
}
// drops opaque 8-connected pieces that hold no colour of the object itself (only ground and outline colours:
// grass speckles, stray outline bits) or fewer than `min` pixels
function dropStrays(art, d, x0, y0, w, h, ground, dark, min = 4) {
  const seen = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || !d[i * 4 + 3]) continue;
    const st = [i], comp = []; seen[i] = 1; let own = false;
    while (st.length) {
      const j = st.pop(), x = j % w, y = (j / w) | 0; comp.push(j);
      const c = packAt(art, x0 + x, y0 + y); if (c !== dark && !ground.has(c)) own = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const k = ny * w + nx; if (!seen[k] && d[k * 4 + 3]) { seen[k] = 1; st.push(k); } }
    }
    if (!own || comp.length < min) for (const j of comp) d[j * 4 + 3] = 0;
  }
}
// Cut-out of a map rectangle as RGBA (w x h). opt.cut:
//  "key" (default)  the original keyed rule
//  "outline"        keyed, but the outline (darkest) colour never keys, so an object whose inside has the ground's
//                   colour (canopies on grass) keeps it; pieces with no colour of their own are dropped
//  "dome"           per column, everything from the first outline pixel down (bushes: an arc open at the bottom)
//  "rect"           the whole rectangle
//  "ellipse"        the ellipse inscribed in the rectangle
// opt.only: [[x0, y0, x1, y1], ...] absolute map rectangles outside which everything is transparent; opt.drop: the opposite
export function cutOut(art, x0, y0, w, h, opt = {}) {
  const mode = opt.cut || "key";
  if (mode === "key" && !opt.only && !opt.drop) return keyedCut(art, x0, y0, w, h);
  const d = copyRect(art, x0, y0, w, h);
  if (mode === "key") floodKey(art, d, x0, y0, w, h, groundKeys(art, x0, y0, w, h));
  else if (mode === "outline") {
    const ground = groundKeys(art, x0, y0, w, h), dark = darkest(art, x0, y0, w, h), pass = new Set(ground); pass.delete(dark);
    floodKey(art, d, x0, y0, w, h, pass); dropStrays(art, d, x0, y0, w, h, ground, dark, opt.min || 4);
  } else if (mode === "dome") {
    const dark = opt.dark ?? darkest(art, x0, y0, w, h);
    for (let x = 0; x < w; x++) { let on = false; for (let y = 0; y < h; y++) { if (!on && packAt(art, x0 + x, y0 + y) === dark) on = true; if (!on) d[(y * w + x) * 4 + 3] = 0; } }
  } else if (mode === "ellipse") {
    const cx = w / 2, cy = h / 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const u = (x + 0.5 - cx) / cx, v = (y + 0.5 - cy) / cy; if (u * u + v * v > 1) d[(y * w + x) * 4 + 3] = 0; }
  }
  const inR = (x, y, r) => x >= r[0] && x < r[2] && y >= r[1] && y < r[3];
  if (opt.only || opt.drop) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = x0 + x, Y = y0 + y;
    if ((opt.only && !opt.only.some(r => inR(X, Y, r))) || (opt.drop && opt.drop.some(r => inR(X, Y, r)))) d[(y * w + x) * 4 + 3] = 0;
  }
  return d;
}
// every place in the map (x < MW, y < MH px) where the opaque pixels of `d` (cut from (sx, sy)) are the same colours,
// at least `need` of them (0..1); returns [{x, y, d}] with the mask narrowed to the matching pixels, best first,
// overlapping matches dropped
export function matchSprite(art, d, sx, sy, w, h, MW, MH, need = 1) {
  const pts = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3]) pts.push([x, y, packAt(art, sx + x, sy + y)]);
  if (!pts.length) return [];
  const miss = Math.floor(pts.length * (1 - need)), hits = [];
  // test the rarest-looking pixels first (those not of the most common colour of the sprite) for an early exit
  const freq = new Map(); for (const p of pts) freq.set(p[2], (freq.get(p[2]) || 0) + 1);
  pts.sort((a, b) => freq.get(a[2]) - freq.get(b[2]));
  for (let Y = 0; Y + h <= MH; Y++) for (let X = 0; X + w <= MW; X++) {
    let bad = 0;
    for (const p of pts) if (packAt(art, X + p[0], Y + p[1]) !== p[2] && ++bad > miss) break;
    if (bad <= miss) hits.push({ x: X, y: Y, score: pts.length - bad });
  }
  hits.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const hh of hits) if (!kept.some(k => Math.abs(k.x - hh.x) < w * 0.6 && Math.abs(k.y - hh.y) < h * 0.6)) kept.push(hh);
  return kept.map(k => {
    const m = new Uint8Array(d);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; if (!m[o + 3]) continue; const s = ((k.y + y) * ART + k.x + x) * 4; if (packAt(art, k.x + x, k.y + y) !== packAt(art, sx + x, sy + y)) m[o + 3] = 0; else { m[o] = art[s]; m[o + 1] = art[s + 1]; m[o + 2] = art[s + 2]; } }
    return { x: k.x, y: k.y, d: m };
  });
}

// Floor fill under cut-outs on a side-view map: each hidden pixel takes the nearest visible pixel of its row a whole
// number of tiles (8 px) away, so horizontal paths, edges and grass patterns run on behind trees and posts
export function fillRows(floor, hole, x0 = 0, x1 = ART, y0 = 0, y1 = ART) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (!hole[y * ART + x]) continue;
    for (let k = 8; k < ART; k += 8) {
      let s = -1;
      for (const X of [x - k, x + k]) if (X >= x0 && X < x1 && !hole[y * ART + X]) { s = X; break; }
      if (s < 0) continue;
      const o = (y * ART + x) * 4, so = (y * ART + s) * 4; floor[o] = floor[so]; floor[o + 1] = floor[so + 1]; floor[o + 2] = floor[so + 2]; break;
    }
  }
}

// Extruded solid: a low object drawn in the 3/4 view (planter, fountain basin) as a prism with its exact outline.
// mask: the cut-out of rect (x0, y0, w, h); h rows at the bottom of each column are its front wall, the rows above
// are its top. A column's ground line is its lowest opaque pixel, so octagons and ellipses get slanted front walls.
// stack: rows of the solid it stands on (lift and shift). Pushes quads into top/front/side ({pos, uv}, uv in art px).
export function solidMesh(mask, x0, y0, w, h, wallRows, stack, out) {
  const S = WALL_SCALE, H = wallRows * S, lift = stack * S, sh = wallRows + stack;
  const quad = (o, a, b, c, d, ua, ub, uc, ud) => { for (const [v, t] of [[a, ua], [b, ub], [c, uc], [a, ua], [c, uc], [d, ud]]) { o.pos.push(...v); o.uv.push(t[0] / ART, t[1] / ART); } };
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[(y * w + x) * 4 + 3] > 0;
  const bot = new Int16Array(w).fill(-1);
  for (let x = 0; x < w; x++) for (let y = h - 1; y >= 0; y--) if (on(x, y)) { bot[x] = y; break; }
  const isTop = (x, y) => on(x, y) && bot[x] >= 0 && y <= bot[x] - wallRows;
  // top face: runs of top pixels per row, at height lift + H, shifted back by the wall rows
  for (let y = 0; y < h; y++) for (let x = 0; x < w;) {
    if (!isTop(x, y)) { x++; continue; }
    let e = x; while (e < w && isTop(e, y)) e++;
    const X0 = x0 + x, X1 = x0 + e, Y = y0 + y, Z0 = Y + sh, Z1 = Z0 + 1;
    quad(out.top, [X0, lift + H, Z0], [X1, lift + H, Z0], [X1, lift + H, Z1], [X0, lift + H, Z1], [X0, Y], [X1, Y], [X1, Y + 1], [X0, Y + 1]);
    x = e;
  }
  // front walls: one per column at its ground line, the art of its bottom wallRows rows; steps between columns
  for (let x = 0; x < w; x++) {
    if (bot[x] < 0) continue;
    const X = x0 + x, b = y0 + bot[x] + 1, Z = b + stack, r0 = b - wallRows;
    quad(out.front, [X, lift, Z], [X + 1, lift, Z], [X + 1, lift + H, Z], [X, lift + H, Z], [X, b], [X + 1, b], [X + 1, r0], [X, r0]);
    for (const [nx, edge] of [[x - 1, X], [x + 1, X + 1]]) {        // the side of this column's wall a neighbour does not hide
      const nb = nx >= 0 && nx < w ? bot[nx] : -1, Zn = nb < 0 ? -1e9 : y0 + nb + 1 + stack;
      if (Zn >= Z) continue;
      const Zb = Math.max(Zn, Z - 1);                                  // a wall is a pixel deep where nothing is behind it
      const a = [edge, lift, Zb], c = [edge, lift + H, Z];
      quad(out.side, a, [edge, lift, Z], c, [edge, lift + H, Zb], [X, b], [X + 1, b], [X + 1, r0], [X, r0]);
    }
  }
  // sides and back of the top: where a top pixel has no top pixel beside / behind it, a wall down to the lift
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!isTop(x, y)) continue;
    const X = x0 + x, Y = y0 + y, Z0 = Y + sh, Z1 = Z0 + 1, wr = bot[x] >= 0 ? y0 + bot[x] - Math.floor(wallRows / 2) : Y;
    if (!isTop(x - 1, y) && !(on(x - 1, y) && bot[x - 1] >= 0)) quad(out.side, [X, lift, Z0], [X, lift, Z1], [X, lift + H, Z1], [X, lift + H, Z0], [X, wr], [X + 1, wr], [X + 1, wr + 1], [X, wr + 1]);
    if (!isTop(x + 1, y) && !(on(x + 1, y) && bot[x + 1] >= 0)) quad(out.side, [X + 1, lift, Z1], [X + 1, lift, Z0], [X + 1, lift + H, Z0], [X + 1, lift + H, Z1], [X, wr], [X + 1, wr], [X + 1, wr + 1], [X, wr + 1]);
    if (!isTop(x, y - 1)) quad(out.side, [X + 1, lift, Z0], [X, lift, Z0], [X, lift + H, Z0], [X + 1, lift + H, Z0], [X, wr], [X + 1, wr], [X + 1, wr + 1], [X, wr + 1]);
  }
  return { lift, H, shift: sh };
}

// Flowers on a surface (a planter's top, a patch of grass): petal pixels (strong colours that are not green) and the
// light centres between petals are lifted out of the picture as little upright sprites; the picture keeps the soil.
// Returns [{x, y, w, h, px: [[dx, dy, r, g, b], ...]}] in map px (x, y = top-left of the flower in the picture)
// and repaints those pixels in `art` with the surrounding soil.
const isPetal = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx - mn >= 96 && !(g >= r && g >= b) && mx >= 160; };
export function liftFlowers(art, region, keepMask = null) {
  const [x0, y0, x1, y1] = region, w = x1 - x0, h = y1 - y0, pet = new Uint8Array(w * h);
  const rgb = (x, y) => { const o = ((y0 + y) * ART + x0 + x) * 4; return [art[o], art[o + 1], art[o + 2]]; };
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && (!keepMask || keepMask(x0 + x, y0 + y));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x, y) && isPetal(...rgb(x, y))) pet[y * w + x] = 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {             // light centres held by petals on two sides
    if (pet[y * w + x] || !inside(x, y)) continue; const c = rgb(x, y); if (lum(...c) < 200) continue;
    let n = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && pet[Y * w + X] === 1) n++; }
    if (n >= 2) pet[y * w + x] = 2;
  }
  // soil: the commonest non-flower colour of the region
  const hist = new Map(); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x, y) && !pet[y * w + x]) { const c = packAt(art, x0 + x, y0 + y); hist.set(c, (hist.get(c) || 0) + 1); }
  const flowers = [], seen = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!pet[i] || seen[i]) continue;
    const st = [i], comp = []; seen[i] = 1;
    while (st.length) { const j = st.pop(), x = j % w, y = (j / w) | 0; comp.push(j); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const k = Y * w + X; if (pet[k] && !seen[k]) { seen[k] = 1; st.push(k); } } }
    if (comp.length < 2) continue;
    let fx0 = 1e9, fy0 = 1e9, fx1 = -1, fy1 = -1;
    for (const j of comp) { const x = j % w, y = (j / w) | 0; fx0 = Math.min(fx0, x); fy0 = Math.min(fy0, y); fx1 = Math.max(fx1, x); fy1 = Math.max(fy1, y); }
    flowers.push({ x: x0 + fx0, y: y0 + fy0, w: fx1 - fx0 + 1, h: fy1 - fy0 + 1, px: comp.map(j => { const x = j % w, y = (j / w) | 0; return [x - fx0, y - fy0, ...rgb(x, y)]; }) });
  }
  // repaint: each lifted pixel takes the nearest non-flower pixel of its row (else the soil colour)
  const soil = [...hist].sort((a, b) => b[1] - a[1])[0]; const sc = soil ? soil[0] : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!pet[y * w + x]) continue;
    let c = sc; for (let k = 1; k < 6; k++) { if (x - k >= 0 && !pet[y * w + x - k] && inside(x - k, y)) { c = packAt(art, x0 + x - k, y0 + y); break; } if (x + k < w && !pet[y * w + x + k] && inside(x + k, y)) { c = packAt(art, x0 + x + k, y0 + y); break; } }
    const o = ((y0 + y) * ART + x0 + x) * 4; art[o] = c >> 16 & 255; art[o + 1] = c >> 8 & 255; art[o + 2] = c & 255;
  }
  return flowers;
}

// Voxel geometry for swaying things: one box per pixel (front, back, sides, top), with a sway weight (0 at the
// base, 1 at the top: the box moves with the wind by that much) and a phase. Appends to {pos, col, sway}.
export function swayVoxels(out, px, w, h, X, Y, Z, depth, phase, stem = null) {
  const add = (x0, y0, z0, x1, y1, z1, c, wgt) => {
    const face = (a, b, cc, d, k) => { for (const v of [a, b, cc, a, cc, d]) { out.pos.push(...v); out.col.push(c[0] / 255 * k, c[1] / 255 * k, c[2] / 255 * k); out.sway.push(wgt, phase); } };
    face([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 1.0);
    face([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0.6);
    face([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 0.9);
    face([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], 0.75);
    face([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 0.75);
  };
  const top = h + (stem ? stem.h : 0);
  for (const [dx, dy, r, g, b] of px) {                                  // picture row dy: 0 = top of the flower
    const up = (stem ? stem.h : 0) + (h - 1 - dy), x = X - w / 2 + dx;
    add(x, Y + up, Z - depth / 2, x + 1, Y + up + 1, Z + depth / 2, [r, g, b], (up + 0.5) / top);
  }
  if (stem) for (let k = 0; k < stem.h; k++) { const x = X - 0.5; add(x, Y + k, Z - 0.4, x + 1, Y + k + 1, Z + 0.4, stem.c, (k + 0.5) / top); }
}

// Fountain jet as droplets: one small box per droplet; each carries (phase, angle, speed, kind) for the shader,
// which flies it along its arc (see voxel.js VSJ). kind 0: the rising column, 1: the falling crown, 2: splashes.
export function jetDroplets(n = 150) {
  const pos = [], seed = [];
  let s = 12345; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const cube = [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 0, 1], [1, 1, 1], [0, 1, 1], [1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 1], [1, 1, 0], [0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 0, 0], [0, 1, 1], [0, 1, 0],
    [1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 0, 1], [1, 1, 0], [1, 1, 1]];
  const shade = [1, 1, 1, 1, 1, 1, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.75, 0.75, 0.75, 0.75, 0.75, 0.75, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8];
  for (let i = 0; i < n; i++) {
    const kind = i < n * 0.3 ? 0 : i < n * 0.8 ? 1 : 2, ph = rnd(), ang = rnd() * Math.PI * 2, sp = rnd();
    for (let k = 0; k < cube.length; k++) { pos.push(cube[k][0] - 0.5, cube[k][1] - 0.5, cube[k][2] - 0.5, shade[k]); seed.push(ph, ang, sp, kind); }
  }
  return { pos: new Float32Array(pos), seed: new Float32Array(seed), count: pos.length / 4 };
}
