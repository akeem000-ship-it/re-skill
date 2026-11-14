// OVERWORLD TREES (3D overworld, render only; the panel's STORY > Overworld trees, on by default): the trees the game paints into the
// story maps' tiles are lifted off the ground, as Mario Tennis's overworld stands its plants up (voxel.js: cut out of the map's picture
// and stood up). The trees are tiles, so they are found in the map's own picture (field3d.js, the live tiles and palettes): the pixels
// of the map's plant palettes (field_objects.js trees.pal: the Field's woods are all in one BG palette) that are not its plain grass
// (the commonest colour of the plain tiles in those palettes) and not a plain tile, joined into 8-connected clumps (found once the
// map's palettes are its own, not in a fade). A clump of a few
// pixels (a tuft in the lawn) stays painted. A small clump is one plant at its own place and size: narrow and tall a cypress, small a
// bush, else a broadleaf; a big clump (the woods) is one broadleaf per 16 x 16 cell it fills (the game's trees are 16 x 16 pictures
// on that grid), at the centre of its pixels there. field_objects.js trees.kinds names the shape over a rectangle (palms by the Palm
// Club, cacti by the Dune Club). Every pixel of a lifted plant is painted over with the lawn's colour (field3d.js paint: the plain
// grass's palette entry, so it follows the palettes), so the ground under the trees is lawn and the trees stand on it as the hole
// view's Courtyard trees (trees3d.js: egg crowns, cypress cones, bushes, palms, cacti; their colours from the clumps' own pixels),
// turned to the camera, swaying in a light wind, casting the sun's shadows (light3d.js). The people's depth pass (field3d.js) puts
// them back so a person behind a tree is hidden by it (the silhouette shows), and the trees between the camera and the player are
// dithered see-through as in the hole view. Nothing of the game is written.
import { m4, vao, clamp, gbc, texture, updateTexture } from "./gl.js";
import { treePalette, treeMeshData, treeHeight } from "./trees3d.js";

const hash = (x, z, k) => { const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453; return s - Math.floor(s); };
// the trees at about the game's size (its 16 x 16 tree pictures: a crown ~16 px across), the boxes a little bigger than the hole's
// (the overworld's camera is farther off; fewer faces)
const SCALE = 0.74, BOX = 2, BOX_LITE = 2, VARIANTS = 4;
// each tree's colour (a tint of its mesh's, from its place): plain, darker, yellower, blue-green, a deep purple-green shade, a little
// lighter; the darker ones toward the map's own deep greens and the purple shade of its 2D trees
const TINTS = [[1, 1, 1], [0.72, 0.8, 0.74], [1.12, 1.05, 0.6], [0.66, 0.86, 1.12], [0.8, 0.7, 0.9], [1.05, 1.08, 0.9]];
const tintOf = t => { const c = TINTS[Math.floor(hash(t.x, t.z, 6) * TINTS.length)], v = 0.9 + hash(t.x, t.z, 7) * 0.14; return [c[0] * v, c[1] * v, c[2] * v, 1]; };
// the field crowns' outline and shading (trees3d.js fieldShade): the overworld camera looks down at ~48 degrees on the tree's +z side
const FIELD_LOOK = { view: [0, 0.74, 0.67], cut: 0.35, soft: 0.5, edge: 0.85, ao: 0.5 };
const smooth01 = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// the map's plants: { trees: [{x, z, kind, size, ...}], cut: Uint8Array(512 * 512) (1: painted over with the lawn), ground: [pal, ci] }
// M: the field's map (tmap, amap, raw: the live picture before the cut); spec: field_objects.js trees; plain(tx, ty): a one-colour tile
export function findPlants(M, spec, plain) {
  const pals = new Set(spec.pal || []), img = M.raw, ci = M.ci, keyAt = (x, y) => { const c = (y >> 3) * 64 + (x >> 3); return M.tmap[c] | ((M.amap[c] & 0x6F) << 8); };
  // the lawn: the commonest colour of the plain tiles in the plant palettes (and a palette entry that holds it, for the paint)
  const cnt = new Map(), rgb = q => img[q * 4] << 16 | img[q * 4 + 1] << 8 | img[q * 4 + 2];
  for (let ty = 0; ty < 64; ty++) for (let tx = 0; tx < 64; tx++) {
    const a = M.amap[ty * 64 + tx]; if (!pals.has(a & 7) || !plain(tx, ty)) continue;
    const q = ty * 8 * 512 + tx * 8, k = rgb(q), e = cnt.get(k) || [0, (a & 7), ci[q]]; e[0]++; cnt.set(k, e);
  }
  if (!cnt.size) return null;
  const [gcol, [, gp, gci]] = [...cnt].sort((a, b) => b[1][0] - a[1][0])[0], ground = [gp, gci];
  // the tiles' roles (field_objects.js trees: broad, the broadleaf tiles; narrow, each narrow kind's top and foot tiles)
  const broad = new Set(spec.broad || []), role = new Map();
  for (const n of spec.narrow || []) { role.set(n.top, n); role.set(n.foot, n); }
  // the plant pixels: in those tiles, not the lawn's colour (the colours, not the palette entries: a tree tile's grass may be another
  // entry of the same green)
  const mask = new Uint8Array(512 * 512);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const k = keyAt(x, y); if ((broad.has(k) || role.has(k)) && rgb(y * 512 + x) !== gcol) mask[y * 512 + x] = 1;
  }
  const cut = new Uint8Array(512 * 512), trees = [];
  // (each tree its own size and height, a little, from its place: the canopy has depth; variant: one of VARIANTS shapes)
  const tree = (x, z, kind, size, n) => { const k = SCALE * (0.84 + hash(x, z, 3) * 0.32);
    trees.push({ x, z, kind, size, variant: Math.floor(hash(x, z, 2) * VARIANTS), k, ky: k * (0.86 + hash(x, z, 5) * 0.3), phase: hash(x, z, 4) * 6.28, px: n }); };
  // the narrow plants (palms, cacti, poplars: an 8 x 16 picture, a top tile over a foot tile): one on each foot tile, at its
  // pixels' middle, the foot at the tile's bottom
  for (let ty = 0; ty < 64; ty++) for (let tx = 0; tx < 64; tx++) {
    const n = role.get(M.tmap[ty * 64 + tx] | ((M.amap[ty * 64 + tx] & 0x6F) << 8)); if (!n) continue;
    let c = 0, sx = 0;
    for (let y = ty * 8; y < ty * 8 + 8; y++) for (let x = tx * 8; x < tx * 8 + 8; x++) if (mask[y * 512 + x]) { cut[y * 512 + x] = 1; c++; sx += x; }
    if ((M.tmap[ty * 64 + tx] | ((M.amap[ty * 64 + tx] & 0x6F) << 8)) === n.foot && c) tree(sx / c + 0.5, ty * 8 + 8, n.kind, n.size || 1.25, c);
  }
  // the broadleaf trees: a trunk (the brown pixels: red above green above blue, joined across a row of shade) under each, the tree's
  // foot under it; a crown whose trunk the tree in front hides: one per 16 x 16 cell its pixels fill
  const isBrown = q => img[q * 4] > 50 && img[q * 4] > img[q * 4 + 1] * 1.3 && img[q * 4 + 1] > img[q * 4 + 2] * 1.05;
  const seen = new Uint8Array(512 * 512), owner = new Int32Array(512 * 512).fill(-1), own = new Float32Array(512 * 512).fill(1e9), anchors = [];
  const isBroad = q => mask[q] && broad.has(keyAt(q & 511, q >> 9));
  for (let p0 = 0; p0 < 512 * 512; p0++) {
    if (!isBroad(p0) || seen[p0] || !isBrown(p0)) continue;
    const st = [p0], pts = []; seen[p0] = 1;
    while (st.length) { const p = st.pop(); pts.push(p); const x = p & 511, y = p >> 9;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X > 511 || Y > 511) continue;
        const q = Y * 512 + X; if (isBroad(q) && !seen[q] && isBrown(q)) { seen[q] = 1; st.push(q); } } }
    let y1 = -1, sx = 0; for (const p of pts) { y1 = Math.max(y1, p >> 9); sx += p & 511; }
    anchors.push({ x: sx / pts.length + 0.5, y: y1 + 1 });
  }
  anchors.forEach((A, i) => {
    for (let y = Math.max(0, A.y - 16); y <= Math.min(511, A.y + 2); y++) for (let x = Math.max(0, Math.floor(A.x - 9)); x <= Math.min(511, Math.ceil(A.x + 9)); x++) {
      const q = y * 512 + x; if (!isBroad(q)) continue;
      const d = Math.abs(x - A.x) + Math.abs(y - (A.y - 7)) * 0.7; if (d < own[q]) { own[q] = d; owner[q] = i; }
    }
  });
  const count = new Int32Array(anchors.length);
  for (let q = 0; q < 512 * 512; q++) if (owner[q] >= 0) { count[owner[q]]++; cut[q] = 1; }
  anchors.forEach((A, i) => tree(A.x, A.y, "egg", 2, count[i]));
  const cells = new Map();
  for (let q = 0; q < 512 * 512; q++) if (isBroad(q) && owner[q] < 0) { const c = ((q >> 9) >> 4) * 32 + ((q & 511) >> 4); (cells.get(c) || cells.set(c, []).get(c)).push(q); }
  for (const pts of cells.values()) {
    for (const q of pts) cut[q] = 1;
    if (pts.length < 90) continue;                               // (the edge of a crown: lawn under the tree beside it)
    let sx = 0, sy = 0; for (const q of pts) { sx += q & 511; sy += q >> 9; }
    tree(sx / pts.length, sy / pts.length + 6, "egg", 2, pts.length);
  }
  // the grass tufts left in the woods (a plant palette's tile that is no tree's, among the tree tiles: 3 or more of its 8 neighbours)
  // painted with the lawn too: under the 3D crowns they read as dark holes in the canopy's floor
  const treeTile = (tx, ty) => tx >= 0 && ty >= 0 && tx < 64 && ty < 64 && (broad.has(M.tmap[ty * 64 + tx] | ((M.amap[ty * 64 + tx] & 0x6F) << 8)));
  for (let ty = 0; ty < 64; ty++) for (let tx = 0; tx < 64; tx++) {
    if (treeTile(tx, ty) || role.has(keyAt(tx * 8, ty * 8)) || !pals.has(M.amap[ty * 64 + tx] & 7) || plain(tx, ty)) continue;
    let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && treeTile(tx + dx, ty + dy)) n++;
    if (n < 3) continue;
    for (let y = ty * 8; y < ty * 8 + 8; y++) for (let x = tx * 8; x < tx * 8 + 8; x++) { const q = y * 512 + x, r = img[q * 4], g = img[q * 4 + 1], b = img[q * 4 + 2];
      if (rgb(q) !== gcol && g > r && g >= b * 0.9) cut[q] = 1; }
  }
  return { trees, cut, ground };
}

// the courtyard palette (trees3d.js) pulled back toward the map's own greens (the courtyard's pale yellow-green reads washed out on
// the Field's saturated lawn): the crown's lit green the map's lightest tree green brightened, its shade the map's darkest green
const mix3 = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k), lum3 = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
function fieldPalette(rgba) {
  const pal = treePalette([{ rgba }], null), g = new Map();
  for (let i = 0; i < rgba.length; i += 4) { const c = [rgba[i], rgba[i + 1], rgba[i + 2]]; if (c[1] > c[0] * 1.1 && c[1] > c[2] * 1.1 && c[1] > 50) { const k = c.join(","); g.set(k, (g.get(k) || 0) + 1); } }
  const greens = [...g.keys()].map(k => k.split(",").map(Number)).sort((a, b) => lum3(a) - lum3(b));
  if (!greens.length) return pal;
  const light = greens[greens.length - 1], dark = greens[0];
  const sat = (c, k) => { const m = lum3(c); return c.map(v => clamp(m + (v - m) * k, 0, 255)); };   // (the GBC's saturated greens, not an olive)
  return { ...pal, leaf: sat(mix3(pal.leaf, mix3(light, [170, 235, 40], 0.3), 0.6), 1.35), lo: sat(mix3(pal.lo, dark, 0.6), 1.2), rim: mix3(dark, [60, 8, 96], 0.8),
    glint: mix3(pal.glint, [210, 250, 140], 0.5), glintP: 0.04, field: FIELD_LOOK };
}

// a voxel mesh's faces (trees3d.js: two triangles per face, corners 0 1 2 0 2 3) as 4 corners and 6 indices: a third fewer vertices
const quads = arrs => {
  const n = arrs[0].length / 18, a = arrs.map(() => null).map((_, j) => new Float32Array(n * 12)), idx = new Uint32Array(n * 6);
  for (let f = 0; f < n; f++) {
    arrs.forEach((src, j) => { for (const [o, v] of [[0, 0], [1, 1], [2, 2], [3, 5]]) for (let c = 0; c < 3; c++) a[j][(f * 4 + o) * 3 + c] = src[(f * 6 + v) * 3 + c]; });
    idx.set([f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3], f * 6);
  }
  return { a, idx };
};

// the shapes' meshes (shared by the trees of one kind, variant and size) and the drawing
export class FieldTrees {
  constructor(sc, found, M, bgPal) {
    const gl = sc.gl; this.trees = found.trees; this.meshes = new Map();
    // the colours: from the lifted pixels (trees3d.js treePalette), the soil from the paths (the map's commonest orange)
    const rgba = [];
    for (let p = 0; p < 512 * 512; p += 3) if (found.cut[p]) rgba.push(...gbc(bgPal, M.amap[((p >> 12) << 6) + ((p & 511) >> 3)] & 7, M.ci[p]), 255);   // (their own colours: the picture has the lawn there)
    const pal = fieldPalette(rgba), cactusPal = { ...pal, leaf: mix3(pal.lo, pal.leaf, 0.5), lo: mix3(pal.lo, pal.rim, 0.25) };   // (the cacti a deeper green: the pale leaf reads as glass on them)
    if (pal.field) pal.field = { ...FIELD_LOOK, edge: sc.lite ? 0.6 : FIELD_LOOK.edge };   // (Lite's big boxes: a lighter outline)
    for (const t of this.trees) {
      const sz = Math.round(t.size * 4) / 4, key = t.kind + ":" + t.variant + ":" + sz;
      if (!this.meshes.has(key)) {
        const d = treeMeshData(t.kind, t.kind === "cactus" ? cactusPal : pal, sz, t.variant, sc.lite, sc.lite ? BOX_LITE : BOX, false);
        const c = quads([d.pos, d.col]), z = quads([d.dpos]);
        this.meshes.set(key, d.pos.length ? { ...vao(gl, sc.P.obj, { aPos: [c.a[0], 3], aCol: [c.a[1], 3] }, c.idx), n: c.idx.length,
          dvao: vao(gl, sc.P.depth, { aPos: [z.a[0], 3] }, z.idx), dn: z.idx.length } : null);
      }
      t.mesh = this.meshes.get(key); t.h = treeHeight(t.kind) * t.ky; t.tint = t.kind === "cactus" ? [1, 1, 1, 1] : tintOf(t); t.r = (t.kind === "bush" ? 0.62 : t.kind === "cypress" ? 0.42 : t.kind === "palm" ? 1.1 : t.kind === "cactus" ? 0.4 : 0.7) * sz * 8 * t.k;
      t.sway = [t.kind === "cactus" ? 0 : t.kind === "palm" ? 1.4 : t.kind === "bush" ? 0.5 : 1, t.phase, treeHeight(t.kind), 0];
      t.see = 0;
    }
  }
  free(gl) { for (const m of this.meshes.values()) if (m) { m.free(); m.dvao.free(); } this.meshes.clear(); if (this.shTex) { gl.deleteTexture(this.shTex); this.shTex = null; } }
  // the trees in the picture (each one's bounding sphere against the view's frustum)
  inView(mvp) {
    const M = mvp, out = [];
    for (const t of this.trees) {
      if (!t.mesh) continue;
      const y = t.h * 0.5, R = Math.max(t.r, y) + 2, X = M[0] * t.x + M[4] * y + M[8] * t.z + M[12], Y = M[1] * t.x + M[5] * y + M[9] * t.z + M[13], W = M[3] * t.x + M[7] * y + M[11] * t.z + M[15];
      const k = R * 2.2;                                 // (the sphere's size in clip units, generously: the projection's scale is under 2.2)
      if (W > 0 && X > -W - k && X < W + k && Y > -W - k && Y < W + k) out.push(t);
    }
    return out.sort((a, b) => b.z - a.z);              // (nearest first: the depth test skips the hidden crowns behind)
  }
  // the shadows on the ground, baked into a 512 x 512 picture of the map (a soft blot per tree, cast away from the sun; redone when
  // the sun moves): the ground's shader darkens the lawn and paths by it. (A shadow map's depth pass over the woods cost more than
  // the trees themselves on a phone or a CPU renderer.)
  shadows(sc, sun) {
    const gl = sc.gl;
    if (this.shTex && this.sun && Math.abs(this.sun[0] - sun[0]) + Math.abs(this.sun[2] - sun[2]) < 0.03) return this.shTex;
    this.sun = sun.slice();
    const a = new Float32Array(512 * 512), up = Math.max(0.35, sun[1]), dx = -sun[0] / up, dz = -sun[2] / up;
    for (const t of this.trees) {
      const tall = t.kind === "bush" ? 0.35 : 0.5, cx = t.x + dx * t.h * tall, cz = t.z + dz * t.h * tall, rx = t.r * 1.05 + Math.abs(dx) * t.h * 0.22, rz = t.r * 0.8 + Math.abs(dz) * t.h * 0.22;
      for (let z = Math.max(0, Math.floor(cz - rz - 2)); z <= Math.min(511, Math.ceil(cz + rz + 2)); z++) for (let x = Math.max(0, Math.floor(cx - rx - 2)); x <= Math.min(511, Math.ceil(cx + rx + 2)); x++) {
        const d = Math.hypot((x + 0.5 - cx) / rx, (z + 0.5 - cz) / rz), v = clamp((1.15 - d) / 0.35, 0, 1);
        const f = Math.hypot((x + 0.5 - t.x) / (t.r * 0.45 + 1), (z + 0.5 - t.z) / (t.r * 0.3 + 1)), foot = clamp(1 - f, 0, 1) * 0.6;   // (and a dark contact spot at the foot)
        const q = z * 512 + x; a[q] = Math.max(a[q], v * 0.85, foot);
      }
    }
    const b = new Uint8Array(512 * 512); for (let i = 0; i < b.length; i++) b[i] = Math.round(a[i] * 255);
    if (!this.shTex) this.shTex = texture(gl, 512, 512, b, { linear: true, format: "r" }); else updateTexture(gl, this.shTex, 512, 512, b, "r");
    return this.shTex;
  }
  // the trees between the camera and the player (the person nearest the view's centre) dithered see-through, eased over ~0.2 s
  seeThrough(list, eye, player, dt) {
    const k = 1 - Math.exp(-12 * Math.min(dt || 0.016, 0.1));
    for (const t of list) {
      let see = 0;
      if (player) {
        const [px, pz, ph] = player, dz = t.z - pz, dx = Math.abs(t.x - px);
        // in front of the player (nearer the camera) and tall enough on the screen to cover him: the camera looks down at ~45 degrees,
        // so a crown of height h at dz in front covers what stands up to ~h - dz behind it
        if (dz > -2 && dz < t.h + 2 && dx < t.r + 5) see = 0.82 * (1 - smooth01((dx - t.r * 0.6) / 6)) * (1 - smooth01((dz - t.h * 0.75) / 8)) * smooth01((ph + t.h - dz) / 6);
      }
      t.see += (see - t.see) * k; if (t.see < 0.01) t.see = 0;
    }
  }
  model(sc, t) { return m4.tsy(t.x, -0.1, t.z, t.k, t.ky, t.k, sc.cam.yawToEye(t.x, t.z)); }
  // the picture (the scene's lit, shadowed body program)
  draw(sc, list, mvp, wind) {
    const gl = sc.gl, p = sc.P.obj; gl.useProgram(p.p); sc.setLight(p); sc.bindShadow(p, 2);
    gl.uniformMatrix4fv(p.u.uMVP, false, mvp); gl.uniform3f(p.u.uWindT, wind[0], wind[1], sc.time); gl.uniform4fv(p.u.uTint, [1, 1, 1, 1]);
    for (const t of list) {
      gl.uniformMatrix4fv(p.u.uModel, false, t.m); gl.uniform4fv(p.u.uSway, t.sway); gl.uniform1f(p.u.uSee, t.see); gl.uniform4fv(p.u.uTint, t.tint);
      gl.bindVertexArray(t.mesh.vao); gl.drawElements(gl.TRIANGLES, t.mesh.n, gl.UNSIGNED_INT, 0);
    }
    gl.uniform4fv(p.u.uSway, [0, 0, 1, 0]); gl.uniform1f(p.u.uSee, 0); gl.uniform4fv(p.u.uTint, [1, 1, 1, 1]); gl.bindVertexArray(null);
  }
  // depth only (the sun's shadow map; the people's depth pass: the see-through trees left out there, so the player shows through them)
  // near: the people's [x, z] (only the trees that can stand in front of one of them)
  drawDepth(sc, list, mvp, wind, near = null) {
    const gl = sc.gl, p = sc.P.depth; gl.useProgram(p.p); gl.uniformMatrix4fv(p.u.uMVP, false, mvp); gl.uniform3f(p.u.uWindT, wind[0], wind[1], sc.time);
    for (const t of list) {
      if (near && (t.see > 0.3 || !near.some(([x, z]) => Math.abs(t.x - x) < t.r + 12 && t.z > z - 4 && t.z < z + t.h + 8))) continue;
      gl.uniformMatrix4fv(p.u.uModel, false, t.m); gl.uniform4fv(p.u.uSway, t.sway);
      gl.bindVertexArray(t.mesh.dvao.vao); gl.drawElements(gl.TRIANGLES, t.mesh.dn, gl.UNSIGNED_INT, 0);
    }
    gl.uniform4fv(p.u.uSway, [0, 0, 1, 0]); gl.bindVertexArray(null);
  }
}
