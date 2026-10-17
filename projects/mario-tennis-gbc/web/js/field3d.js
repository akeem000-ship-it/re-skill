// Overworld (RPG map) 3D helpers that need no WebGL, used by voxel.js to stand the annotated objects of
// field_objects.js up from the map picture: cut-out masks, pixel-exact sprite matching, extruded low solids
// (planters, fountain basins), swaying flowers, the fountain jet, and the floor fill under cut-outs.
// The map picture ("art") is 512x512 RGBA, map pixel (x, y) at ((y * 512) + x) * 4.
export const ART = 512;
export const WALL_SCALE = 1.25;                 // a wall drawn h rows tall in the 3/4 view stands h * 1.25 high
const lum = (r, g, b) => r * 0.3 + g * 0.59 + b * 0.11;
export const packAt = (art, x, y) => { if (x < 0 || y < 0 || x >= ART || y >= ART) return -1; const o = (y * ART + x) * 4; return art[o] << 16 | art[o + 1] << 8 | art[o + 2]; };

// colours of the ground around a rectangle: those making up >= 5% of a 3 px ring outside it
export function groundKeys(art, x0, y0, w, h, counts = false) {
  const hist = new Map(); let n = 0;
  for (let k = 1; k <= 3; k++) {
    for (let x = x0 - 3; x < x0 + w + 3; x++) for (const y of [y0 - k, y0 + h - 1 + k]) { const c = packAt(art, x, y); if (c >= 0) { hist.set(c, (hist.get(c) || 0) + 1); n++; } }
    for (let y = y0; y < y0 + h; y++) for (const x of [x0 - k, x0 + w - 1 + k]) { const c = packAt(art, x, y); if (c >= 0) { hist.set(c, (hist.get(c) || 0) + 1); n++; } }
  }
  if (counts) return hist;
  return new Set([...hist].filter(([, v]) => v >= n * 0.05).map(([c]) => c));
}
// the darkest colour inside a rectangle (the outline colour of this art)
export function darkest(art, x0, y0, w, h) {
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
// seal: sides ("t", "b", "l", "r") not flooded from (an object cut by the map's edge there)
function floodKey(art, d, x0, y0, w, h, pass, seal = "") {
  const out = new Uint8Array(w * h), st = [];
  const push = (x, y) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const i = y * w + x; if (out[i] || !pass.has(packAt(art, x0 + x, y0 + y))) return; out[i] = 1; st.push(i); };
  for (let x = 0; x < w; x++) { if (!seal.includes("t")) push(x, 0); if (!seal.includes("b")) push(x, h - 1); } for (let y = 0; y < h; y++) { if (!seal.includes("l")) push(0, y); if (!seal.includes("r")) push(w - 1, y); }
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
    // a big piece is the object even with only ground colours inside its outline (a bush on grass of the same greens)
    if ((!own && comp.length < w * h * 0.15) || comp.length < min) for (const j of comp) d[j * 4 + 3] = 0;
  }
}
// Cut-out of a map rectangle as RGBA (w x h). opt.cut:
//  "key" (default)  the original keyed rule
//  "outline"        keyed, but the outline (darkest) colour never keys, so an object whose inside has the ground's
//                   colour (canopies on grass) keeps it; pieces with no colour of their own are dropped
//  "enclosed"       what the outline colour encloses, with the outline (thin props over paths of their own colours)
//  "hull"           between outline pixels on each row, below the outline in each column (planters)
//  "dome"           per column, everything from the first outline pixel down (bushes: an arc open at the bottom)
//  "rect"           the whole rectangle
//  "ellipse"        the ellipse inscribed in the rectangle
// opt.only: [[x0, y0, x1, y1], ...] absolute map rectangles outside which everything is transparent; opt.drop: the opposite;
// opt.seal: sides of the rectangle the outline cut does not flood from ("t": a tree cut by the map's top edge);
// opt.add: rectangles always opaque (a sign's post); opt.bg: [[x, y], ...] map points whose colours are the ground (instead of the colours around the rectangle)
export function cutOut(art, x0, y0, w, h, opt = {}) {
  const mode = opt.cut || "key";
  if (mode === "key" && !opt.only && !opt.drop && !opt.see && !opt.furn) return keyedCut(art, x0, y0, w, h);
  const d = copyRect(art, x0, y0, w, h);
  if (mode === "key" && (opt.see || opt.furn)) { /* see-through: no keying, the colours named by `see` are removed below */ }
  else if (mode === "key") floodKey(art, d, x0, y0, w, h, groundKeys(art, x0, y0, w, h));
  else if (mode === "outline") {
    const ground = opt.bg ? new Set(opt.bg.map(([x, y]) => packAt(art, x, y))) : groundKeys(art, x0, y0, w, h), dark = darkest(art, x0, y0, w, h), pass = new Set(ground); pass.delete(dark);
    floodKey(art, d, x0, y0, w, h, pass, opt.seal); dropStrays(art, d, x0, y0, w, h, ground, dark, opt.min || 4);
  } else if (mode === "enclosed") {
    // what the outline encloses: flood from the border through every colour but the outline's; the outline pixels
    // that touch an enclosed pixel stay (thin outlined props standing on paths of their own colours: signs)
    const dark = darkest(art, x0, y0, w, h), out = new Uint8Array(w * h), st = [];
    const push = (x, y) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const i = y * w + x; if (out[i] || packAt(art, x0 + x, y0 + y) === dark) return; out[i] = 1; st.push(i); };
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); } for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    while (st.length) { const i = st.pop(), x = i % w, y = (i / w) | 0; push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (out[i]) { d[i * 4 + 3] = 0; continue; }
      if (packAt(art, x0 + x, y0 + y) !== dark) continue;
      let near = false; for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && !out[Y * w + X] && packAt(art, x0 + X, y0 + Y) !== dark) { near = true; break; } }
      if (!near) d[i * 4 + 3] = 0;
    }
    // ground-coloured bits caught between outline and border (grass beside a post): peeled off from the outside
    const ground = new Set((opt.bg || []).map(([x, y]) => packAt(art, x, y)));   // only colours named as ground (opt.bg)
    for (let pass = 0, changed = ground.size > 0; pass < 4 && changed; pass++) {
      changed = false; const drop = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x; if (!d[i * 4 + 3] || !ground.has(packAt(art, x0 + x, y0 + y))) continue;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const X = x + dx, Y = y + dy; return X < 0 || Y < 0 || X >= w || Y >= h || !d[(Y * w + X) * 4 + 3]; })) drop.push(i);
      }
      for (const i of drop) { d[i * 4 + 3] = 0; changed = true; }
    }
    if (ground.size) dropStrays(art, d, x0, y0, w, h, ground, dark, opt.min || 4);
  } else if (mode === "hull") {
    // between outline pixels: on its row an outline pixel at or left of it and one at or right of it, and one at or
    // above it in its column (convex outlined things whose inside shares the ground's colours: planters)
    const dark = darkest(art, x0, y0, w, h), isD = (x, y) => packAt(art, x0 + x, y0 + y) === dark, top = new Int16Array(w).fill(h);
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) if (isD(x, y)) { top[x] = y; break; }
    for (let y = 0; y < h; y++) {
      let l = w, r = -1; for (let x = 0; x < w; x++) if (isD(x, y)) { l = Math.min(l, x); r = x; }
      for (let x = 0; x < w; x++) if (x < l || x > r || y < top[x]) d[(y * w + x) * 4 + 3] = 0;
    }
  } else if (mode === "dome") {
    const dark = opt.dark ?? darkest(art, x0, y0, w, h);
    for (let x = 0; x < w; x++) { let on = false; for (let y = 0; y < h; y++) { if (!on && packAt(art, x0 + x, y0 + y) === dark) on = true; if (!on) d[(y * w + x) * 4 + 3] = 0; } }
  } else if (mode === "ellipse") {
    const cx = w / 2, cy = h / 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const u = (x + 0.5 - cx) / cx, v = (y + 0.5 - cy) / cy; if (u * u + v * v > 1) d[(y * w + x) * 4 + 3] = 0; }
  }
  // opt.see: the colours that are see-through ("green": the grass and lattice greens; or [[x, y], ...] map points whose colours): a chain-link or
  // iron fence keeps its wires and rails, the ground between them shows
  if (opt.see) {
    const pts = Array.isArray(opt.see) ? new Set(opt.see.map(([x, y]) => packAt(art, x, y))) : null;
    for (let i = 0; i < w * h; i++) { const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]; if (pts ? pts.has(r << 16 | g << 8 | b) : (g > r + 40 && g > b + 40)) d[i * 4 + 3] = 0; }
  }
  // opt.furn: furniture painted over a coloured background (the blue glass panels of map 17): the colours of opt.furn.bg ([[x, y], ...] map points)
  // connected to the rectangle's edge are background and become transparent; the dark outline pixels touching what is left stay; opt.furn.map
  // ([[[r, g, b], [r, g, b]], ...]) recolours the rest (blue glass tint -> the furniture's own wood and cream)
  if (opt.furn) {
    const bgc = new Set(opt.furn.bg.map(([x, y]) => packAt(art, x, y))), out = new Uint8Array(w * h), st = [], P = (x, y) => packAt(art, x0 + x, y0 + y);
    const push = (x, y) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const i = y * w + x; if (out[i] || !bgc.has(P(x, y))) return; out[i] = 1; st.push(i); };
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); } for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    while (st.length) { const i = st.pop(), x = i % w, y = (i / w) | 0; push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }
    const dark = packAt(art, opt.furn.bg[0][0], opt.furn.bg[0][1]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!out[i]) continue;
      let keep = false; if (P(x, y) === dark) for (let dy = -1; dy <= 1 && !keep; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && !out[Y * w + X]) { keep = true; break; } }
      if (!keep) d[i * 4 + 3] = 0;
    }
    const map = new Map((opt.furn.map || []).map(([f, t]) => [f[0] << 16 | f[1] << 8 | f[2], t]));
    for (let i = 0; i < w * h; i++) { const t = map.get(d[i * 4] << 16 | d[i * 4 + 1] << 8 | d[i * 4 + 2]); if (t) { d[i * 4] = t[0]; d[i * 4 + 1] = t[1]; d[i * 4 + 2] = t[2]; } }
  }
  const inR = (x, y, r) => x >= r[0] && x < r[2] && y >= r[1] && y < r[3];
  if (opt.only || opt.drop || opt.add) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = x0 + x, Y = y0 + y;
    if ((opt.only && !opt.only.some(r => inR(X, Y, r))) || (opt.drop && opt.drop.some(r => inR(X, Y, r)))) d[(y * w + x) * 4 + 3] = 0;
    if (opt.add && opt.add.some(r => inR(X, Y, r))) d[(y * w + x) * 4 + 3] = 255;
  }
  return d;
}
// the picture as one packed colour per pixel (cached per picture array)
const packCache = new WeakMap();
function packed(art) { let P = packCache.get(art); if (P) return P; P = new Int32Array(ART * ART); for (let i = 0; i < ART * ART; i++) P[i] = art[i * 4] << 16 | art[i * 4 + 1] << 8 | art[i * 4 + 2]; packCache.set(art, P); return P; }
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
  const P = packed(art), probe = pts.filter((_, i) => i % Math.max(1, Math.floor(pts.length / 32)) === 0), probeMiss = Math.floor(probe.length * (1 - need)) + 1;
  const po = Int32Array.from(probe, p => p[1] * ART + p[0]), pc = Int32Array.from(probe, p => p[2]), ao = Int32Array.from(pts, p => p[1] * ART + p[0]), ac = Int32Array.from(pts, p => p[2]);
  for (let Y = 0; Y + h <= MH; Y++) for (let X = 0; X + w <= MW; X++) {
    const b0 = Y * ART + X; let bad = 0;
    for (let k = 0; k < po.length; k++) if (P[b0 + po[k]] !== pc[k] && ++bad > probeMiss) break;   // quick reject on a spread sample
    if (bad > probeMiss) continue;
    bad = 0;
    for (let k = 0; k < ao.length; k++) if (P[b0 + ao[k]] !== ac[k] && ++bad > miss) break;
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
// src (optional): per floor pixel the index of the map picture pixel it shows, kept up to date (recolouring in fades)
export function fillRows(floor, hole, x0 = 0, x1 = ART, y0 = 0, y1 = ART, src = null) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (!hole[y * ART + x]) continue;
    for (let k = 8; k < ART; k += 8) {
      let s = -1;
      for (const X of [x - k, x + k]) if (X >= x0 && X < x1 && !hole[y * ART + X]) { s = X; break; }
      if (s < 0) continue;
      const o = (y * ART + x) * 4, so = (y * ART + s) * 4; floor[o] = floor[so]; floor[o + 1] = floor[so + 1]; floor[o + 2] = floor[so + 2]; if (src) src[y * ART + x] = src[y * ART + s]; break;
    }
  }
}

// Floor fill under a plant on a top-down map: each opaque pixel of its mask d (at x0, y0) takes a pixel under no cut-out
// (`hole`) 8, 16, ... px away left, right, up or down: preferably the direction whose pixels are most like the ground
// around the plant (`keys`: colour -> how often it is there), pixel by pixel a much commoner ground colour, so the
// ground's tile pattern runs on without bringing in the wall, fence or dark band next to it
export function fillNearest(floor, hole, d, x0, y0, w, h, keys, W, H, src = null, patched = null, dark = -1) {
  const ok = (X, Y) => X >= 0 && Y >= 0 && X < W && Y < H && !hole[Y * ART + X];
  const at = q => floor[q * 4] << 16 | floor[q * 4 + 1] << 8 | floor[q * 4 + 2];
  const fq = q => { const l = floor[q * 4] + floor[q * 4 + 1] + floor[q * 4 + 2]; return l < 60 || l > 690 || at(q) === dark ? 0 : (keys.get(at(q)) || 0); };   // (black bands, white rims, outlines are not ground)
  const from = (x, y, dx, dy) => { for (let k = 8; k <= 160; k += 8) { const X = x + dx * k, Y = y + dy * k; if (ok(X, Y)) return Y * ART + X; } return -1; };
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]], score = dirs.map(() => 0);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (d[(yy * w + xx) * 4 + 3]) dirs.forEach(([dx, dy], k) => { const q = from(x0 + xx, y0 + yy, dx, dy); score[k] += q < 0 ? -1 : fq(q); });
  const order = dirs.map((v, k) => [v, score[k] * (k < 2 ? 1.5 : 1)]).sort((a, b) => b[1] - a[1]).map(e => e[0]);   // rows preferred
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const x = x0 + xx, y = y0 + yy, i = y * ART + x; if (!d[(yy * w + xx) * 4 + 3] || x >= W || y >= H) continue;
    // the commonest ground colour among the four candidates; on a tie (or none of them ground) the best direction
    let s = -1, best = 0; for (const [dx, dy] of order) { const q = from(x, y, dx, dy); if (q < 0) continue; const f = fq(q); if (s < 0 || f > best * 2.5 + 2) { s = q; best = f; } }
    if (s < 0) continue;
    const o = i * 4, so = s * 4; floor[o] = floor[so]; floor[o + 1] = floor[so + 1]; floor[o + 2] = floor[so + 2];
    if (src) src[i] = src[s]; if (patched) patched[i] = 1;
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
  // front walls: one per column at its ground line, showing the art of its bottom wallRows rows
  for (let x = 0; x < w; x++) {
    if (bot[x] < 0) continue;
    const X = x0 + x, b = y0 + bot[x] + 1, Z = b + stack, r0 = b - wallRows;
    quad(out.front, [X, lift, Z], [X + 1, lift, Z], [X + 1, lift + H, Z], [X, lift + H, Z], [X, b], [X + 1, b], [X + 1, r0], [X, r0]);
  }
  // sides and back: where a top pixel has no top pixel beside / behind it, a wall down to the lift, textured with the
  // front wall's art of that column (the steps between columns of different depth are such sides too)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!isTop(x, y)) continue;
    const X = x0 + x, Y = y0 + y, Z0 = Y + sh, Z1 = Z0 + 1, b = y0 + bot[x] + 1, r0 = b - wallRows;
    // a side wall shows the front wall's art a little inside the outline (the outline column itself is all dark)
    const inner = dx => { let c = x; for (let k = 0; k < 3 && c + dx >= 0 && c + dx < w && bot[c + dx] >= 0; k++) c += dx; const cb = y0 + bot[c] + 1; return [x0 + c, cb, cb - wallRows]; };
    if (!isTop(x - 1, y)) { const [u, vb, vt] = inner(1); quad(out.side, [X, lift, Z0], [X, lift, Z1], [X, lift + H, Z1], [X, lift + H, Z0], [u, vb], [u + 1, vb], [u + 1, vt], [u, vt]); }
    if (!isTop(x + 1, y)) { const [u, vb, vt] = inner(-1); quad(out.side, [X + 1, lift, Z1], [X + 1, lift, Z0], [X + 1, lift + H, Z0], [X + 1, lift + H, Z1], [u, vb], [u + 1, vb], [u + 1, vt], [u, vt]); }
    if (!isTop(x, y - 1)) quad(out.side, [X + 1, lift, Z0], [X, lift, Z0], [X, lift + H, Z0], [X + 1, lift + H, Z0], [X, b], [X + 1, b], [X + 1, r0], [X, r0]);
  }
  return { lift, H, shift: sh };
}

// Flowers on a surface (a planter's top, a patch of grass): petal pixels (strong colours that are not green) and the
// light centres between petals are lifted out of the picture as little upright sprites; the picture keeps the soil.
// Returns [{x, y, w, h, px: [[dx, dy, r, g, b], ...]}] in map px (x, y = top-left of the flower in the picture)
// and repaints those pixels in `art` with the surrounding soil.
const isPetal = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx - mn >= 96 && !(g >= r && g >= b) && mx >= 160; };
export function liftFlowers(art, region, keepMask = null, src = null) {   // src: as in fillRows, for the picture
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
  const hist = new Map(), where = new Map();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x, y) && !pet[y * w + x]) { const c = packAt(art, x0 + x, y0 + y); hist.set(c, (hist.get(c) || 0) + 1); where.set(c, (y0 + y) * ART + x0 + x); }
  const flowers = [], seen = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!pet[i] || seen[i]) continue;
    const st = [i], comp = []; seen[i] = 1;
    while (st.length) { const j = st.pop(), x = j % w, y = (j / w) | 0; comp.push(j); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const k = Y * w + X; if (pet[k] && !seen[k]) { seen[k] = 1; st.push(k); } } }
    if (comp.length < 2) continue;
    let fx0 = 1e9, fy0 = 1e9, fx1 = -1, fy1 = -1;
    for (const j of comp) { const x = j % w, y = (j / w) | 0; fx0 = Math.min(fx0, x); fy0 = Math.min(fy0, y); fx1 = Math.max(fx1, x); fy1 = Math.max(fy1, y); }
    flowers.push({ x: x0 + fx0, y: y0 + fy0, w: fx1 - fx0 + 1, h: fy1 - fy0 + 1, px: comp.map(j => { const x = j % w, y = (j / w) | 0; return [x - fx0, y - fy0, ...rgb(x, y), (y0 + y) * ART + x0 + x]; }) });
  }
  // repaint: each lifted pixel takes the nearest non-flower pixel of its row (else the soil colour)
  const soil = [...hist].sort((a, b) => b[1] - a[1])[0]; const sc = soil ? soil[0] : 0, si = soil ? where.get(sc) : -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!pet[y * w + x]) continue;
    let c = sc, ci = si;
    for (let k = 1; k < 6; k++) {
      if (x - k >= 0 && !pet[y * w + x - k] && inside(x - k, y)) { ci = (y0 + y) * ART + x0 + x - k; break; }
      if (x + k < w && !pet[y * w + x + k] && inside(x + k, y)) { ci = (y0 + y) * ART + x0 + x + k; break; }
    }
    if (ci >= 0) c = packAt(art, ci % ART, (ci / ART) | 0);
    const i = (y0 + y) * ART + x0 + x, o = i * 4; art[o] = c >> 16 & 255; art[o + 1] = c >> 8 & 255; art[o + 2] = c & 255;
    if (src && ci >= 0) src[i] = src[ci];
  }
  return flowers;
}

// Voxel geometry for swaying things: one box per pixel (front, back, sides, top), with a sway weight (0 at the
// base, 1 at the top: the box moves with the wind by that much) and a phase. Appends to {pos, col, sway, src}
// (src: per vertex the picture pixel it is coloured from and the face shade, for recolouring).
// px: [[dx, dy, r, g, b, srcIndex], ...]; stem: {h, c: [r, g, b], src}
export function swayVoxels(out, px, w, h, X, Y, Z, depth, phase, stem = null) {
  const has = new Set(px.map(([dx, dy]) => dx + "," + dy));
  // sides: [left, right, top] shown unless a pixel of the flower is there (inner faces are never seen)
  const add = (x0, y0, z0, x1, y1, z1, c, wgt, sides, si) => {
    const face = (a, b, cc, d, k) => { for (const v of [a, b, cc, a, cc, d]) { out.pos.push(...v); out.col.push(c[0] / 255 * k, c[1] / 255 * k, c[2] / 255 * k); out.sway.push(wgt, phase); out.src.push(si, k); } };
    face([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 1.0);
    face([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0.6);
    if (sides[2]) face([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 0.9);
    if (sides[0]) face([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], 0.75);
    if (sides[1]) face([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 0.75);
  };
  const top = h + (stem ? stem.h : 0);
  for (const [dx, dy, r, g, b, si] of px) {                              // picture row dy: 0 = top of the flower
    const up = (stem ? stem.h : 0) + (h - 1 - dy), x = X - w / 2 + dx;
    add(x, Y + up, Z - depth / 2, x + 1, Y + up + 1, Z + depth / 2, [r, g, b], (up + 0.5) / top, [!has.has(dx - 1 + "," + dy), !has.has(dx + 1 + "," + dy), !has.has(dx + "," + (dy - 1))], si);
  }
  if (stem) for (let k = 0; k < stem.h; k++) { const x = X - 0.5; add(x, Y + k, Z - 0.4, x + 1, Y + k + 1, Z + 0.4, stem.c, (k + 0.5) / top, [true, true, k === stem.h - 1 && !has.has(Math.floor(w / 2) + "," + (h - 1))], stem.src); }
}

// Fountain jet as droplets: one small box per droplet; each carries (phase, angle, speed, kind) for the shader,
// which flies it along its arc (see voxel.js VSJ). kind 0: the rising column, 1: the falling crown, 2: splashes.
export function jetDroplets(n = 150) {
  const pos = [], seed = [];
  let s = 12345; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const cube = [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 0, 1], [1, 1, 1], [0, 1, 1],                 // front, top, left, right
    [0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 1], [1, 1, 0], [0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 0, 0], [0, 1, 1], [0, 1, 0],
    [1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 0, 1], [1, 1, 0], [1, 1, 1]];
  const shade = [1, 1, 1, 1, 1, 1, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.75, 0.75, 0.75, 0.75, 0.75, 0.75, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8];
  for (let i = 0; i < n; i++) {
    const kind = i < n * 0.35 ? 0 : i < n * 0.82 ? 1 : 2, ph = rnd(), ang = rnd() * Math.PI * 2, sp = rnd();
    for (let k = 0; k < cube.length; k++) { pos.push(cube[k][0] - 0.5, cube[k][1] - 0.5, cube[k][2] - 0.5, shade[k]); seed.push(ph, ang, sp, kind); }
  }
  return { pos: new Float32Array(pos), seed: new Float32Array(seed), count: pos.length / 4 };
}

// Plant body (tree, bush, potted plant) as a voxel mesh with volume: each opaque pixel is a column whose half-depth
// grows with its distance from the silhouette (a quarter circle of radius R px, up to T px, in whole pixels), so a
// canopy is round and a trunk thin. The colours come from the map picture (a texture), so faces of one depth merge
// into rectangles whatever the dithering: few vertices per plant. Local units: 1 = one pixel, origin at the
// bottom-centre. Returns {pos, uv, sway}: uv in image pixels (the caller offsets them into the map texture),
// sway = (weight, shade, phase): the weight grows with the height (the foot stays put), shade darkens the back and
// sides, phase is added to the instance's place in the wind (0 here).
export function plantMesh(rgba, w, h, R = 5, T = 4) {
  const n = w * h, op = i => rgba[i * 4 + 3] >= 128, dist = new Float32Array(n).fill(1e9);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (!op(i)) { dist[i] = 0; continue; } if (x === 0 || y === 0 || x === w - 1 || y === h - 1) dist[i] = 1; }
  const relax = (i, j, d) => { if (dist[j] + d < dist[i]) dist[i] = dist[j] + d; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (x > 0) relax(i, i - 1, 1); if (y > 0) { relax(i, i - w, 1); if (x > 0) relax(i, i - w - 1, 1.4); if (x < w - 1) relax(i, i - w + 1, 1.4); } }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; if (x < w - 1) relax(i, i + 1, 1); if (y < h - 1) { relax(i, i + w, 1); if (x < w - 1) relax(i, i + w + 1, 1.4); if (x > 0) relax(i, i + w - 1, 1.4); } }
  const dep = new Float32Array(n);
  for (let i = 0; i < n; i++) if (op(i)) { const u = Math.min(dist[i], R) / R; dep[i] = Math.max(1, Math.round(T * Math.sqrt(1 - (1 - u) * (1 - u)))); }
  const D = (x, y) => (x >= 0 && y >= 0 && x < w && y < h) ? dep[y * w + x] : 0;
  const out = { pos: [], uv: [], sway: [] };
  // quad: 4 corners [x, y(local up), z] with their texture pixel coordinates [u, v]
  const quad = (q, t, k) => { for (const j of [0, 1, 2, 0, 2, 3]) { const [p, uv] = q[j]; out.pos.push(p[0] - w / 2, p[1], p[2]); out.uv.push(uv[0], uv[1]); out.sway.push(Math.pow(Math.max(0, Math.min(1, p[1] / h)), 1.5), k, 0); } };
  const Y = y => h - y;                            // image row y -> local height of its top edge
  // front and back: greedy rectangles of one depth
  const used = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!op(i) || used[i]) continue;
    const t = dep[i]; let e = x + 1; while (e < w && !used[y * w + e] && op(y * w + e) && dep[y * w + e] === t) e++;
    let b = y + 1; for (; b < h; b++) { let ok = true; for (let k = x; k < e; k++) { const j = b * w + k; if (used[j] || !op(j) || dep[j] !== t) { ok = false; break; } } if (!ok) break; }
    for (let yy = y; yy < b; yy++) for (let k = x; k < e; k++) used[yy * w + k] = 1;
    const y0 = Y(b), y1 = Y(y);
    quad([[[x, y0, t], [x, b]], [[e, y0, t], [e, b]], [[e, y1, t], [e, y]], [[x, y1, t], [x, y]]], t, 1.0);
    quad([[[e, y0, -t], [e, b]], [[x, y0, -t], [x, b]], [[x, y1, -t], [x, y]], [[e, y1, -t], [e, y]]], t, 0.6);
  }
  // top and bottom: the part of a column's depth its upper / lower neighbour does not cover, runs along rows; the
  // face shows that row's pixels (stretched over the depth)
  for (const [dy, k, top] of [[-1, 0.9, true], [1, 0.55, false]]) for (let y = 0; y < h; y++) for (let x = 0; x < w;) {
    const i = y * w + x, t = dep[i], tn = D(x, y + dy); if (!op(i) || tn >= t) { x++; continue; }
    let e = x + 1; while (e < w && op(y * w + e) && dep[y * w + e] === t && D(e, y + dy) === tn) e++;
    const yy = top ? Y(y) : Y(y + 1), iy = Math.max(0, Math.min(h - 1, op((y - dy) * w + x) ? y - dy : y)), v0 = iy, v1 = iy + 1;   // the row inside the outline
    if (!tn) {                                     // nothing beside: one face through the whole depth
      if (top) quad([[[x, yy, t], [x, v1]], [[e, yy, t], [e, v1]], [[e, yy, -t], [e, v0]], [[x, yy, -t], [x, v0]]], t, k);
      else quad([[[x, yy, -t], [x, v0]], [[e, yy, -t], [e, v0]], [[e, yy, t], [e, v1]], [[x, yy, t], [x, v1]]], t, k);
    } else if (top) { quad([[[x, yy, t], [x, v1]], [[e, yy, t], [e, v1]], [[e, yy, tn], [e, v0]], [[x, yy, tn], [x, v0]]], t, k); quad([[[x, yy, -tn], [x, v0]], [[e, yy, -tn], [e, v0]], [[e, yy, -t], [e, v1]], [[x, yy, -t], [x, v1]]], t, k); }
    else { quad([[[x, yy, tn], [x, v0]], [[e, yy, tn], [e, v0]], [[e, yy, t], [e, v1]], [[x, yy, t], [x, v1]]], t, k); quad([[[x, yy, -t], [x, v1]], [[e, yy, -t], [e, v1]], [[e, yy, -tn], [e, v0]], [[x, yy, -tn], [x, v0]]], t, k); }
    x = e;
  }
  // left and right: runs along columns, showing that column's pixels
  for (const dx of [-1, 1]) for (let x = 0; x < w; x++) for (let y = 0; y < h;) {
    const i = y * w + x, t = dep[i], tn = D(x + dx, y); if (!op(i) || tn >= t) { y++; continue; }
    let e = y + 1; while (e < h && op(e * w + x) && dep[e * w + x] === t && D(x + dx, e) === tn) e++;
    const ix = x - dx >= 0 && x - dx < w && op(y * w + x - dx) ? x - dx : x, xx = dx < 0 ? x : x + 1, y0 = Y(e), y1 = Y(y), u0 = ix, u1 = ix + 1;   // the column inside
    if (!tn) quad([[[xx, y0, -t], [u0, e]], [[xx, y0, t], [u1, e]], [[xx, y1, t], [u1, y]], [[xx, y1, -t], [u0, y]]], t, 0.75);
    else {
      quad([[[xx, y0, tn], [u0, e]], [[xx, y0, t], [u1, e]], [[xx, y1, t], [u1, y]], [[xx, y1, tn], [u0, y]]], t, 0.75);
      quad([[[xx, y0, -t], [u1, e]], [[xx, y0, -tn], [u0, e]], [[xx, y1, -tn], [u0, y]], [[xx, y1, -t], [u1, y]]], t, 0.75);
    }
    y = e;
  }
  return out;
}

// Hedge / foliage bank: the footprint (mask over the map rectangle x0, y0, w, h) rises as a rounded cushion, height
// growing with the distance from its edge (a quarter circle of radius R px, up to Hmax), in whole pixels. The top is
// the map picture itself (uv = map px), the steps between heights show the pixel next to them. Rectangles are at most
// 8 px so the wind (sway = weight, shade, phase by place) bends the top a little at a time.
export function hedgeMesh(mask, x0, y0, w, h, Hmax = 12, R = 6) {
  const n = w * h, on = i => mask[i] > 0, dist = new Float32Array(n).fill(1e9);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (!on(i)) { dist[i] = 0; continue; } if (x === 0 || y === 0 || x === w - 1 || y === h - 1) dist[i] = 1; }
  const relax = (i, j, d) => { if (dist[j] + d < dist[i]) dist[i] = dist[j] + d; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (x > 0) relax(i, i - 1, 1); if (y > 0) { relax(i, i - w, 1); if (x > 0) relax(i, i - w - 1, 1.4); if (x < w - 1) relax(i, i - w + 1, 1.4); } }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; if (x < w - 1) relax(i, i + 1, 1); if (y < h - 1) { relax(i, i + w, 1); if (x < w - 1) relax(i, i + w + 1, 1.4); if (x > 0) relax(i, i + w - 1, 1.4); } }
  const ht = new Float32Array(n);
  for (let i = 0; i < n; i++) if (on(i)) { const u = Math.min(dist[i], R) / R; ht[i] = Math.max(2, Math.round(Hmax * Math.sqrt(1 - (1 - u) * (1 - u)))); }
  const H = (x, y) => (x >= 0 && y >= 0 && x < w && y < h) ? ht[y * w + x] : 0;
  const out = { pos: [], uv: [], sway: [] };
  const quad = (q, k) => { for (const j of [0, 1, 2, 0, 2, 3]) { const [p, uv] = q[j]; out.pos.push(p[0], p[1], p[2]); out.uv.push(uv[0], uv[1]); out.sway.push(p[1] / Hmax * 0.6, k, p[0] * 0.11 + p[2] * 0.07); } };
  const used = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {                 // tops: rectangles of one height, at most 8 px
    const i = y * w + x; if (!on(i) || used[i]) continue;
    const t = ht[i]; let e = x + 1; while (e < w && e - x < 8 && !used[y * w + e] && on(y * w + e) && ht[y * w + e] === t) e++;
    let b = y + 1; for (; b < h && b - y < 8; b++) { let ok = true; for (let k = x; k < e; k++) { const j = b * w + k; if (used[j] || !on(j) || ht[j] !== t) { ok = false; break; } } if (!ok) break; }
    for (let yy = y; yy < b; yy++) for (let k = x; k < e; k++) used[yy * w + k] = 1;
    const X0 = x0 + x, X1 = x0 + e, Z0 = y0 + y, Z1 = y0 + b;
    quad([[[X0, t, Z0], [X0, Z0]], [[X1, t, Z0], [X1, Z0]], [[X1, t, Z1], [X1, Z1]], [[X0, t, Z1], [X0, Z1]]], 1.0);
  }
  // steps: where a neighbour is lower, a wall from its height up, runs along the edge, showing the pixel inside
  for (const [dx, dy, k] of [[0, 1, 0.8], [0, -1, 0.7], [-1, 0, 0.75], [1, 0, 0.75]]) {
    if (dy) for (let y = 0; y < h; y++) for (let x = 0; x < w;) {
      const i = y * w + x, t = ht[i], tn = H(x, y + dy); if (!on(i) || tn >= t) { x++; continue; }
      let e = x + 1; while (e < w && e - x < 8 && on(y * w + e) && ht[y * w + e] === t && H(e, y + dy) === tn) e++;
      const Z = y0 + (dy > 0 ? y + 1 : y), X0 = x0 + x, X1 = x0 + e, v = y0 + y;
      quad([[[X0, tn, Z], [X0, v + 1]], [[X1, tn, Z], [X1, v + 1]], [[X1, t, Z], [X1, v]], [[X0, t, Z], [X0, v]]], k);
      x = e;
    } else for (let x = 0; x < w; x++) for (let y = 0; y < h;) {
      const i = y * w + x, t = ht[i], tn = H(x + dx, y); if (!on(i) || tn >= t) { y++; continue; }
      let e = y + 1; while (e < h && e - y < 8 && on(e * w + x) && ht[e * w + x] === t && H(x + dx, e) === tn) e++;
      const X = x0 + (dx > 0 ? x + 1 : x), Z0 = y0 + y, Z1 = y0 + e, u = x0 + x;
      quad([[[X, tn, Z0], [u, Z0]], [[X, tn, Z1], [u + 1, Z1]], [[X, t, Z1], [u + 1, Z1]], [[X, t, Z0], [u, Z0]]], k);
      y = e;
    }
  }
  return out;
}

// Umbrella / parasol from its picture in the rectangle (x0, y0, x1, y1): the canopy (the rows where at least half the
// width is canopy colours: light, or strongly coloured, not green) becomes an eight-sided cone over its pole, the
// picture laid on it apex to rim (the drawn ribs become the cone's ribs) with a band for the rim's edge; a pole stands
// in the middle and one at each side, as drawn. Returns {mesh: {pos, uv, sway}, top, rim, ground} (uv in map px).
export function umbrellaMesh(art, x0, y0, x1, y1, groundMax = 512) {
  const isCanopy = (x, y) => { const o = (y * ART + x) * 4, r = art[o], g = art[o + 1], b = art[o + 2], l = r + g + b; if (g > r && g > b && l < 600) return false; return l > 500 || Math.max(r, g, b) - Math.min(r, g, b) > 120; };
  const w = x1 - x0; let top = -1, rim = -1;
  for (let y = y0; y < y1; y++) { let n = 0; for (let x = x0; x < x1; x++) if (isCanopy(x, y)) n++; if (top < 0 && n >= 3) top = y; if (n >= w * 0.5) rim = y; }
  if (top < 0 || rim < 0) return null;
  const cx = (x0 + x1) / 2, r = w / 2 - 0.5, ground = Math.min(groundMax, Math.max(y1, rim + 12)), cz = ground - 2;
  const S = WALL_SCALE, Hr = Math.max((ground - rim) * S, 24), Ha = Hr + r * 0.4;   // (a person stands under it)
  const out = { pos: [], uv: [], sway: [] };
  const tri = (a, b, c, k) => { for (const [p, uv] of [a, b, c]) { out.pos.push(...p); out.uv.push(...uv); out.sway.push(0, k, 0); } };
  const N = 8, rings = [0, 0.34, 0.67, 1];
  // the picture's canopy half-width on each row: a point of the cone takes the pixel at the same fraction across its row
  const half = y => {                                      // (the run through the middle, gaps of 2 px bridged: posts beside it do not count)
    const yy = Math.max(top, Math.min(rim, Math.round(y))), c = Math.floor(cx); let l = c, r2 = c;
    while (l - 1 >= x0 && (isCanopy(l - 1, yy) || (l - 2 >= x0 && isCanopy(l - 2, yy)))) l--;
    while (r2 + 1 < x1 && (isCanopy(r2 + 1, yy) || (r2 + 2 < x1 && isCanopy(r2 + 2, yy)))) r2++;
    return Math.max(1, Math.min(c - l, r2 - c) + 0.5);
  };
  const P = (t, rho) => { const a = (t / N) * Math.PI * 2 + Math.PI / 8, c = Math.cos(a), s = Math.sin(a), v = top + rho * (rim - top); return [[cx + rho * r * c, Ha - rho * (Ha - Hr), cz + rho * r * 0.8 * s], [cx + c * half(v) * (rho > 0 ? 1 : 0), v]]; };
  for (let t = 0; t < N; t++) for (let k = 0; k < rings.length - 1; k++) {
    const a0 = P(t, rings[k]), a1 = P(t + 1, rings[k]), b0 = P(t, rings[k + 1]), b1 = P(t + 1, rings[k + 1]), sh = 0.8 + 0.2 * Math.sin((t + 0.5) / N * Math.PI * 2 + Math.PI / 8);
    if (k > 0) tri(a0, a1, b1, sh); tri(a0, b1, b0, sh);
  }
  for (let t = 0; t < N; t++) {                            // the rim's edge: a band 3 px deep, the picture's last canopy rows
    const p0 = P(t, 1), p1 = P(t + 1, 1), d = 3 * S;
    const q = [[[p0[0][0], Hr - d, p0[0][2]], [p0[1][0], rim + 1]], [[p1[0][0], Hr - d, p1[0][2]], [p1[1][0], rim + 1]], [[p1[0][0], Hr, p1[0][2]], [p1[1][0], rim - 2]], [[p0[0][0], Hr, p0[0][2]], [p0[1][0], rim - 2]]];
    tri(q[0], q[1], q[2], 0.85); tri(q[0], q[2], q[3], 0.85);
  }
  const pole = (px, pz, h, u) => {                          // a 1.5 px square post, the picture's post column for colour
    const e = 0.75, v0 = Math.min(ground - 1, rim + 2), v1 = ground - 1;
    for (const [ax, az, bx, bz, k] of [[-e, e, e, e, 1], [e, e, e, -e, 0.75], [e, -e, -e, -e, 0.6], [-e, -e, -e, e, 0.75]]) {
      const q = [[[px + ax, 0, pz + az], [u, v1]], [[px + bx, 0, pz + bz], [u + 1, v1]], [[px + bx, h, pz + bz], [u + 1, v0]], [[px + ax, h, pz + az], [u, v0]]];
      tri(q[0], q[1], q[2], k); tri(q[0], q[2], q[3], k);
    }
  };
  pole(cx, cz, Ha, Math.floor(cx)); pole(x0 + 1.5, cz, Hr, x0 + 1); pole(x1 - 1.5, cz, Hr, x1 - 2);
  return { mesh: out, top, rim, ground };
}
