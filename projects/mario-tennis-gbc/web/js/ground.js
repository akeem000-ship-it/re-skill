// "GROUND: Pixel / Detail" (3D overworld): the ground in more detail, made from the map's own picture (nothing new is drawn:
// every colour comes from the floor and the plants the game paints):
//   grass     the lawns (green with little blue: not the courts' teals, not solid squares) grow tufts of 5-9 blades from one
//             root, coloured from the lawn round them without the game's dither (dark at the root, lighter at the tip), in
//             patches taller or shorter, greener or drier; also on the plain ground the view adds round a map when it is lawn
//   trees     the trees, bushes and palms (voxel.js plants) get full crowns: rounded puffs of small leaves over the green of
//             their picture, two or three deep, lit from above (light yellow-green on top, dark below and inside)
//   edging    the light bricks and their dark outline lining the dirt paths stand up as a low kerb, a brick per 2 x 2 px
//   paths     the dirt is strewn with fine grit (its own colour, some grey) and the odd small stone
//   apron     field_objects lawnApron: the plain ground beside a side-view map (the cafe road's west end) mown as its lawns, with
//             field_objects terrace: a paved patio there with tables under parasols, chairs and flower planters (our own, in fixed
//             colours: boxes as the kerb bricks)
// The grass is a carpet (0.35.81: the only choice; the tufts above, Pixel and Gemini are kept in the code): a dense, short, flat turf of
// fine strands over every lawn (shells: the lawn drawn in thin layers one above another, each keeping only the strands
// that reach it, thinning to their tips), with a few taller tufts standing out of it. On the school grounds (KEPT: the
// courts, the plaza and school entrance, the dorm) the lawns inside the map are mown: short and even, in light and dark
// stripes; the ground beyond stays rough.
// Grass and leaves sway in the same travelling wind as the trees and hedges (voxel.js VSP); grass parts round you as you
// walk. Three instanced draws per map (blades, boxes, leaves), made when the floor picture is (voxel.js buildField).
import { INDOOR_MAPS } from "./lighting.js";
const TREES = ["original", "round", "leaves"], TREE_LABEL = { original: "Original", round: "Round", leaves: "Leaves" };
const KEY = "mt-ground";
const KEPT = new Set([19, 20, 22, 23, 24, 26, 27, 28, 29, 30, 31, 36]);   // maps whose lawns are mown (wCurMapID; 19, the road, as the courtyard it joins)
const WIND = `float wind(float t, float ph) { return sin(t * 1.9 + ph) * 0.75 + sin(t * 3.3 + ph * 1.7) * 0.25; }`;
const VS_BLADE = `#version 300 es
in vec2 aCorner; in vec4 aBlade; in vec4 aCol; in vec2 aLean;
uniform mat4 uMVP; uniform float uTime; uniform vec3 uPush;
out vec3 vCol; out float vH;
${WIND}
void main() {
  float h = aBlade.z, yaw = aBlade.w, s = wind(uTime, aCol.w), t = aCorner.y * aCorner.y;
  vec3 side = vec3(cos(yaw), 0.0, sin(yaw));
  vec2 rel = aBlade.xy - uPush.xy; float d = length(rel), push = uPush.z * max(0.0, 1.0 - d / 16.0);
  vec2 away = d > 0.01 ? rel / d : vec2(0.0);
  vec3 p = vec3(aBlade.x, 0.0, aBlade.y) + side * (aCorner.x * (1.0 - aCorner.y)) * 1.7 + vec3(0.0, aCorner.y * h * (1.0 - 0.4 * push), 0.0);
  p += t * (vec3(aLean.x, 0.0, aLean.y) + vec3(s * 1.3, 0.0, s * 0.45) + vec3(away.x, 0.0, away.y) * push * h * 0.8);
  vCol = aCol.rgb; vH = aCorner.y; gl_Position = uMVP * vec4(p, 1.0);
}`;
const FS_BLADE = `#version 300 es
precision mediump float; in vec3 vCol; in float vH; out vec4 o;
void main() { o = vec4(vCol * mix(0.42, 1.18, vH) + vec3(0.07, 0.08, 0.0) * vH * vH, 1.0); }`;
// carpet: layer gl_InstanceID of N over the grass's area; a strand per 1/D px, its height from the strand and the lawn's
// (mask alpha), bent by the wind and by you at the top; the mask holds the lawn's colour without the dither
const VS_SHELL = `#version 300 es
in vec2 aCorner; uniform mat4 uMVP; uniform vec4 uRect; uniform float uN, uHmax;
out vec2 vXZ; out float vL;
void main() {
  vL = float(gl_InstanceID) / uN; vXZ = uRect.xy + aCorner * uRect.zw;
  gl_Position = uMVP * vec4(vXZ.x, 0.05 + vL * uHmax, vXZ.y, 1.0);
}`;
const FS_SHELL = `#version 300 es
precision highp float; in vec2 vXZ; in float vL; out vec4 o;
uniform sampler2D uMask; uniform vec4 uRect, uKept; uniform float uTime, uFlat; uniform vec3 uPush;
${WIND}
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
void main() {
  float L = vL, s = wind(uTime, vXZ.x * 0.11 + vXZ.y * 0.07);
  vec2 rel = vXZ - uPush.xy; float d = length(rel), push = uPush.z * max(0.0, 1.0 - d / 14.0);
  bool kept = vXZ.x >= uKept.x && vXZ.y >= uKept.y && vXZ.x < uKept.z && vXZ.y < uKept.w;
  float st = mod(floor(vXZ.y / 12.0), 2.0), cr = mod(floor(vXZ.x / 12.0), 2.0);   // mown: the stripes (and a fainter cross cut)
  vec2 q = vXZ - (vec2(s * 0.7, s * 0.25) * (kept ? 0.3 : 1.0) + (kept ? vec2(0.0, st * 2.0 - 1.0) * 0.6 : vec2(0.0)) + (d > 0.01 ? rel / d : vec2(0.0)) * push * 2.2) * L * L;
  vec4 m = texture(uMask, (q - uRect.xy) / uRect.zw);
  if (m.a < 0.03) discard;
  if (uFlat > 0.0) {                                                            // a path's surface: the dirt mottled, its worn middle lighter
    float mo = vn(vXZ / 5.0) * 0.6 + vn(vXZ / 1.6) * 0.4, wear = m.a;
    vec3 c = m.rgb * (0.8 + 0.3 * mo) * (0.9 + 0.22 * wear) + vec3(0.05, 0.035, 0.0) * wear;
    o = vec4(mix(c, vec3(dot(c, vec3(0.3, 0.59, 0.11))) * vec3(1.18, 1.0, 0.78), 0.3), 1.0); return;   // (towards a sandy tan)
  }
  if (L == 0.0) { o = vec4(m.rgb * mix(1.0, 0.36, smoothstep(0.05, 0.4, m.a)), 1.0); return; }   // the soil between the strands (the plain ground's colour where it thins out)
  vec2 c = q * 1.25, id = floor(c), f = fract(c) - 0.5;
  float r = h21(id), hgt = (kept ? 0.32 + 0.06 * r : (0.3 + 0.7 * r) * m.a) * (1.0 - 0.6 * push);
  if (L > hgt) discard;
  vec2 j = vec2(h21(id + 3.1), h21(id + 7.7)) - 0.5;
  if (length(f - j * 0.35) > 0.62 * (1.0 - L / hgt) + 0.12) discard;
  float k = h21(id + 11.3), pa = vn(q / 22.0) * 0.65 + vn(q / 7.0) * 0.35;     // patches: lighter and darker, some olive
  vec3 col;
  if (kept) col = m.rgb * (0.86 + 0.2 * k) * (0.93 + 0.1 * pa) * (0.84 + 0.26 * st) * (0.96 + 0.06 * cr);
  else {
    col = m.rgb * (0.68 + 0.5 * k) * (0.78 + 0.42 * pa);
    col = mix(col, col * vec3(1.25, 1.0, 0.5) + vec3(0.07, 0.05, 0.0), smoothstep(0.55, 0.15, pa) * 0.45);
    col = mix(col, col * vec3(1.35, 1.12, 0.5) + vec3(0.06, 0.04, 0.0), step(0.84, k) * 0.75);   // straw-coloured strands
  }
  o = vec4(col * mix(0.45, 1.22, L / max(hgt, 0.01) * 0.6 + L * 0.4) + vec3(0.06, 0.07, 0.0) * L * L, 1.0);
}`;
// boxes (kerb bricks, pebbles): a unit cube (corner, face shade) scaled and placed per instance
const VS_BOX = `#version 300 es
in vec4 aCube; in vec4 aAt; in vec4 aSize; in vec3 aCol;
uniform mat4 uMVP; out vec3 vCol;
void main() {
  float c = cos(aAt.w), s = sin(aAt.w); vec3 q = aCube.xyz * aSize.xyz;
  vec3 p = vec3(aAt.x + q.x * c - q.z * s, aAt.y + q.y, aAt.z + q.x * s + q.z * c);
  vCol = aCol * aCube.w; gl_Position = uMVP * vec4(p, 1.0);
}`;
const FS_BOX = `#version 300 es
precision mediump float; in vec3 vCol; out vec4 o; void main() { o = vec4(vCol, 1.0); }`;
// leaves: a leaf-shaped card per instance (a pointed ellipse), turned and tipped, swaying with the plant's height
const VS_LEAF = `#version 300 es
in vec2 aCorner; in vec4 aLeaf; in vec4 aTurn; in vec3 aCol;
uniform mat4 uMVP; uniform float uTime; out vec3 vCol; out vec2 vUV;
${WIND}
void main() {
  float sz = aLeaf.w, cy = cos(aTurn.x), sy = sin(aTurn.x), cp = cos(aTurn.y), sp = sin(aTurn.y);
  vec3 ax = vec3(cy, 0.0, sy), ay = vec3(-sy * sp, cp, cy * sp);
  float s = wind(uTime, aTurn.z) * aTurn.w;
  vec3 p = aLeaf.xyz + (ax * aCorner.x * 0.55 + ay * aCorner.y) * sz + vec3(s, 0.0, s * 0.35);
  vCol = aCol * (0.82 + 0.25 * aCorner.y); vUV = aCorner; gl_Position = uMVP * vec4(p, 1.0);
}`;
const FS_LEAF = `#version 300 es
precision mediump float; in vec3 vCol; in vec2 vUV; out vec4 o;
uniform float uSpike;   // 1: TREES: Round's spiky leaves (narrow, widest near the base, pointed at the tip, which is aCorner.y = 1)
void main() {
  vec2 q = vUV; float t = (q.y + 1.0) * 0.5;
  float w = uSpike > 0.5 ? 0.62 * min(t * 3.0, 1.0 - t) : 1.0 - q.y * q.y; if (abs(q.x) > w) discard;
  float k = uSpike > 0.5 ? 0.78 + 0.34 * t - 0.2 * abs(q.x) / max(w, 0.01) : 1.0 - 0.25 * abs(q.x) / max(w, 0.01);
  o = vec4(vCol * k, 1.0);
}`;
// TREES: Round: a crown of overlapping leaf clumps (the trees and shrubs of an HD-2D diorama). A clump is a unit sphere
// per instance, made lumpy by noise, with a chunky leaf texture of world-space cells about a pixel wide: each cell tips
// the light a little, and the light is cut into five shades from the crown's own green (dark and cool below, yellow-green
// on top); the crown sways in the plant's wind. aC: centre, radius; aS: x / y scale, seed, wind phase; aW: wind amount
const NOISE3 = `float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float n3(vec3 p) { vec3 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), u.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), u.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), u.x), u.y), u.z); }`;
const VS_CLUMP = `#version 300 es
in vec3 aPos; in vec4 aC; in vec4 aS; in vec4 aW; in vec3 aCol;
uniform mat4 uMVP; uniform float uTime; out vec3 vN; out vec3 vW; out vec3 vCol; out float vSeed;
${WIND}
${NOISE3}
void main() {
  float bump = 1.0 + 0.3 * (n3(aPos * 2.4 + aS.z) - 0.5) + 0.14 * (n3(aPos * 6.0 + aS.z * 1.7) - 0.5);
  vec3 p = aC.xyz + aPos * aC.w * vec3(aS.x, aS.y, aS.x) * bump;
  float s = wind(uTime, aS.w) * aW.x; p += vec3(s, 0.0, s * 0.35);
  vN = aPos; vW = p; vCol = aCol; vSeed = aS.z; gl_Position = uMVP * vec4(p, 1.0);
}`;
const FS_CLUMP = `#version 300 es
precision highp float; in vec3 vN; in vec3 vW; in vec3 vCol; in float vSeed; out vec4 o;
${NOISE3}
void main() {
  vec3 q = floor(vW * 1.25);                                                      // leaf cells under a pixel wide
  vec3 n = normalize(normalize(vN) + (vec3(h3(q + 1.3), h3(q + 2.7), h3(q + 4.1)) - 0.5) * 1.3);
  vec3 L = normalize(vec3(-0.35, 0.85, 0.4));
  float lit = clamp(dot(n, L) * 0.55 + 0.45, 0.0, 1.0) * mix(0.55, 1.0, smoothstep(-0.7, 0.35, vN.y));
  lit += (n3(vW * 0.35 + vSeed) - 0.5) * 0.25;                                     // leafy masses, lighter and darker
  float k = clamp(floor(lit * 4.6), 0.0, 4.0);
  vec3 c = vCol * vec3(0.78, 0.8, 0.62);                                           // the crown's green, a little deeper and less lime
  vec3 r = k < 0.5 ? c * vec3(0.32, 0.42, 0.55) : k < 1.5 ? c * vec3(0.55, 0.66, 0.7) : k < 2.5 ? c * 0.84 :
           k < 3.5 ? c * 1.04 + vec3(0.06, 0.06, 0.0) : c * 1.16 + vec3(0.17, 0.15, 0.02);
  o = vec4(min(r, vec3(1.0)), 1.0);
}`;
// a unit sphere (an icosahedron split twice), as triangles
function sphere() {
  const t = (1 + Math.sqrt(5)) / 2; let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const norm = p => { const l = Math.hypot(...p); return p.map(c => c / l); };
  V = V.map(norm);
  for (let r = 0; r < 2; r++) {
    const mid = new Map(), m = (a, b) => { const k = a < b ? a + "," + b : b + "," + a; if (!mid.has(k)) { mid.set(k, V.length); V.push(norm(V[a].map((c, i) => (c + V[b][i]) / 2))); } return mid.get(k); };
    F = F.flatMap(([a, b, c]) => { const ab = m(a, b), bc = m(b, c), ca = m(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; });
  }
  return new Float32Array(F.flatMap(f => f.flatMap(i => V[i])));
}
// a unit cube on the ground (y 0..1, x / z -0.5..0.5), each face's shade in w
function cube() {
  const v = [], f = (a, b, c, d, k) => { for (const p of [a, b, c, a, c, d]) v.push(...p, k); };
  const P = (x, y, z) => [x - 0.5, y, z - 0.5];
  f(P(0, 1, 0), P(1, 1, 0), P(1, 1, 1), P(0, 1, 1), 1.0);                    // top
  f(P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1), 0.82);                   // front (towards the camera)
  f(P(1, 0, 0), P(0, 0, 0), P(0, 1, 0), P(1, 1, 0), 0.6);                    // back
  f(P(0, 0, 0), P(0, 0, 1), P(0, 1, 1), P(0, 1, 0), 0.7);                    // left
  f(P(1, 0, 1), P(1, 0, 0), P(1, 1, 0), P(1, 1, 1), 0.74);                   // right
  return new Float32Array(v);
}
const hash = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
const noise = (x, y) => { const i = Math.floor(x), j = Math.floor(y), u = x - i, w = y - j, a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), e = hash(i + 1, j + 1), su = u * u * (3 - 2 * u), sw = w * w * (3 - 2 * w); return a + (b - a) * su + (c - a) * sw + (a - b - c + e) * su * sw; };
const rnd = (x, y, k) => { const s = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453; return s - Math.floor(s); };

export class Ground {
  constructor(voxel) {
    this.v = voxel; this.built = null;
    this.mode = "carpet"; this.apply(); this.density = 1;              // carpet, the only choice (with mown campus lawns)
    let t = null; try { t = new URLSearchParams(location.search).get("trees") || localStorage.getItem(KEY + "-trees"); } catch (e) { /* no storage */ }
    this.trees = TREES.includes(t) ? t : "original";                      // TREES: Original (the default), Round or Leaves
    this.round = this.trees === "round";
  }
  // the map's own crowns are left out of the plant meshes (voxel.js) when Round draws them: changing that builds the map again
  get hidesCrowns() { return this.on && this.round; }
  get roundsGame() { return this.on && this.trees === "original"; }    // the game's own trees, made round (field3d.js plantMesh)
  rebuildIf(was) {
    if ((was.g !== this.gemini || was.h !== this.hidesCrowns || was.o !== this.roundsGame) && this.v.field) {
      this.v.field.needBuild = true;
      if (was.o !== this.roundsGame && this.v.neighbours) this.v.neighbours.clear();   // the neighbouring maps' trees are built again too
    }
  }
  setTrees(t) {
    const was = { g: this.gemini, h: this.hidesCrowns, o: this.roundsGame }; this.trees = t; this.round = t === "round";
    try { localStorage.setItem(KEY + "-trees", t); } catch (e) { /* private mode */ }
    this.built = null; this.rebuildIf(was);
  }
  // pixel: the game's ground; detail: tufts; carpet: shells, mown on campus; gemini: Gemini's voxel tufts, lobed crowns and
  // tinted greens (voxel.js / field3d.js, built with the map: switching to or from it builds the map again)
  apply() { this.on = this.mode === "detail" || this.mode === "carpet"; this.carpet = this.mode === "carpet"; this.gemini = this.mode === "gemini"; }
  setMode(m) {
    const was = { g: this.gemini, h: this.hidesCrowns, o: this.roundsGame }; this.mode = m; this.apply();
    try { localStorage.setItem(KEY, m); } catch (e) { /* private mode */ }
    this.rebuildIf(was);
  }
  init() {
    const v = this.v, gl = v.gl, uni = (p, names) => Object.fromEntries(names.map(n => [n, gl.getUniformLocation(p, n)]));
    this.pB = v.link(VS_BLADE, FS_BLADE, ["aCorner", "aBlade", "aCol", "aLean"]); this.uB = uni(this.pB, ["uMVP", "uTime", "uPush"]);
    this.pX = v.link(VS_BOX, FS_BOX, ["aCube", "aAt", "aSize", "aCol"]); this.uX = uni(this.pX, ["uMVP"]);
    this.pS = v.link(VS_SHELL, FS_SHELL, ["aCorner"]); this.uS = uni(this.pS, ["uMVP", "uRect", "uKept", "uN", "uHmax", "uMask", "uTime", "uPush", "uFlat"]);
    this.pL = v.link(VS_LEAF, FS_LEAF, ["aCorner", "aLeaf", "aTurn", "aCol"]); this.uL = uni(this.pL, ["uMVP", "uTime", "uSpike"]);
    this.pC = v.link(VS_CLUMP, FS_CLUMP, ["aPos", "aC", "aS", "aW", "aCol"]); this.uC = uni(this.pC, ["uMVP", "uTime"]);
    const buf = a => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, a, gl.STATIC_DRAW); return b; };
    this.tri = buf(new Float32Array([-0.5, 0, 0.5, 0, 0, 1])); this.cube = buf(cube()); const sp = sphere(); this.sphere = buf(sp); this.sphereN = sp.length / 3;
    this.quad = buf(new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]));
    this.unit = buf(new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]));
    this.unitVao = gl.createVertexArray(); gl.bindVertexArray(this.unitVao); gl.bindBuffer(gl.ARRAY_BUFFER, this.unit);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null);
  }
  // an instanced vertex array: the per-vertex buffer (size n0 at location 0), then per-instance float arrays with their sizes
  vao(base, n0, inst) {
    const gl = this.v.gl, vao = gl.createVertexArray(), bufs = []; gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, base); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, n0, gl.FLOAT, false, 0, 0);
    inst.forEach(([data, n], i) => {
      const b = gl.createBuffer(); bufs.push(b); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(i + 1); gl.vertexAttribPointer(i + 1, n, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(i + 1, 1);
    });
    gl.bindVertexArray(null);
    return { vao, bufs, n: inst.length ? inst[0][0].length / inst[0][1] : 0 };
  }
  free() {
    const gl = this.v.gl, B = this.built; if (!B) return;
    for (const k of ["blades", "boxes", "leaves", "clumps", "spikes"]) if (B[k]) { for (const b of B[k].bufs) gl.deleteBuffer(b); gl.deleteVertexArray(B[k].vao); }
    if (B.carpet) gl.deleteTexture(B.carpet.tex);
    if (B.paths) gl.deleteTexture(B.paths.tex);
    this.built = null;
  }
  build(f) {
    const v = this.v, d = f.floorData, w0 = v.gb.mem.wram[0], coll = v.gb.mem.wram[6];
    const MW = Math.min(32, (w0[0x32B] || 64) >> 1), MH = Math.min(32, (w0[0x32C] || 64) >> 1), H = f.mapH || 512;
    const MX = MW * 16, MY = Math.min(H, MH * 16);                         // the map's own area (wMapWidth / Height)
    const px = (x, y) => (y * 512 + x) * 4, inMap = (x, y) => x >= 0 && y >= 0 && x < 512 && y < H, inArea = (x, y) => x >= 0 && y >= 0 && x < MX && y < MY;
    const indoor = INDOOR_MAPS.has(v.mapId());                             // (an office's green floor tiles are not a lawn)
    // lawnAll (field_objects): grass, kerbs and grit wherever the picture has lawn or dirt, not only on walkable squares (the road by the
    // cafe: a side-view picture whose collision grid does not line up with its lawns and paths; mown and kerbed as the courtyard)
    const def = (v.fieldDef && v.fieldDef(v.mapId())) || {}, lawnAll = !!def.lawnAll;
    const apron = def.lawnApron || [], inApron = (x, y) => apron.some(r => x >= r[0] && y >= r[1] && x < r[2] && y < r[3]);
    const lawn = o => { const r = d[o], g = d[o + 1], b = d[o + 2]; return !indoor && g > 70 && g >= r && b < g * 0.45; };
    // where things may grow: a walkable 16 x 16 square not under an annotated object, or any square that is all lawn
    // (the lawns beyond the fences you cannot walk on, and lawn inside an object's box; a wall or a hedge has other colours)
    const allLawn = new Uint8Array(32 * 32);
    for (let my = 0; my < MH; my++) for (let mx = 0; mx < MW; mx++) {
      let n = 0;
      for (let y = 1; y < 16; y += 2) for (let x = 1; x < 16; x += 2) if (lawn(((my * 16 + y) * 512 + mx * 16 + x) * 4)) n++;
      allLawn[my * 32 + mx] = n >= 58 ? 1 : 0;                                  // 58 of the 64 samples
    }
    const open = (x, y) => { const mx = x >> 4, my = y >> 4, i = my * 32 + mx; return mx < MW && my < MH && (lawnAll || allLawn[i] || (coll[i] !== 0x0F && !(f.covered && f.covered[i]))); };
    // the dirt's surface and grit also run on under and round an annotated object (a bench, an umpire chair): only the map's own walls
    // are left bare, so no flat rectangle of the plain map colour shows round a prop on a path or a clay court
    const openDirt = (x, y) => { const mx = x >> 4, my = y >> 4, i = my * 32 + mx; return mx < MW && my < MH && (lawnAll || coll[i] !== 0x0F || !!(f.covered && f.covered[i])); };
    const dirt = o => { const r = d[o], g = d[o + 1], b = d[o + 2]; return r > 120 && r > g * 1.25 && b < r * 0.45; };
    const kerb = o => { const r = d[o], g = d[o + 1], b = d[o + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b); return (mx - mn < 40 && mx > 90) || (r < 80 && g < 30 && b < 60); };
    const kept = this.carpet && KEPT.has(v.mapId());

    // ---- grass: tufts ----
    const blades = [], cols = [], leans = [];
    const tuft = (x, y, c, r, g, b) => {
      const tall = noise(x / 38, y / 38), dry = noise(x / 55 + 17, y / 55 + 5), dr = Math.max(0, dry - 0.55) * 1.6;   // dry patches: yellower
      const cx = x - c / 2 + rnd(x, y, 1) * c, cz = y - c / 2 + rnd(x, y, 2) * c, m = 5 + Math.floor(rnd(x, y, 3) * 5);   // 5-9 blades
      for (let i = 0; i < m; i++) {
        const a = rnd(x, y, 10 + i) * 6.2832, out = 0.4 + rnd(x, y, 20 + i) * 0.8, k = 0.8 + 0.3 * noise(x / 9, y / 9) + rnd(x, y, 30 + i) * 0.16;
        const h = (3.5 + rnd(x, y, 40 + i) * 4.5) * (0.55 + 0.9 * tall), X = cx + Math.cos(a) * out * 0.6, Z = cz + Math.sin(a) * out * 0.6;
        blades.push(X, Z, h, a + 1.5708 + (rnd(x, y, 50 + i) - 0.5) * 0.8);
        cols.push(Math.min(1, (r / 255 + dr * 0.25) * k + 0.02), Math.min(1, g / 255 * k * (1 + dr * 0.08)), Math.min(1, b / 255 * k), X * 0.11 + Z * 0.07 + rnd(x, y, 6) * 0.8);
        leans.push(Math.cos(a) * out * h * 0.35, Math.sin(a) * out * h * 0.35);
      }
    };
    const mean = (x, y, R, test) => {                  // the colour of the pixels passing test round (x, y), without the dither
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -R; dy <= R; dy += 2) for (let dx = -R; dx <= R; dx += 2) { const xx = x + dx, yy = y + dy; if (!inMap(xx, yy)) continue; const o = px(xx, yy); if (!test(o)) continue; r += d[o]; g += d[o + 1]; b += d[o + 2]; n++; }
      return n ? [r / n, g / n, b / n] : null;
    };
    for (let y = 2; y < MY; y += 4) for (let x = 2; x < MX; x += 4) {
      if (kept || !open(x, y) || !lawn(px(x, y)) || rnd(x, y, 0) > (this.carpet ? 0.1 : 0.9) * this.density) continue;
      const c = mean(x, y, 3, lawn); if (c) tuft(x, y, 4, ...c);
    }
    // the plain ground round the map's area (its own, or the neighbouring map's reaching past it), when it is lawn: a band 160 px wide
    const sf = f.skirt ? f : f.neighbour && f.neighbour.f.skirt ? f.neighbour.f : null, sd = sf && sf.floorData, sk = sf && sf.skirtSrc >= 0 ? sf.skirtSrc * 4 : -1;
    const sLawn = o => { const r = sd[o], g = sd[o + 1], b = sd[o + 2]; return g > 70 && g >= r && b < g * 0.45; };
    let band = null;
    if (sd && !f.noGlass && (sf.grassSrc || (sk >= 0 && sLawn(sk)))) {    // (not round a side-view map: the road's foreground is its own picture)
      let r = 0, g = 0, b = 0, n = 0;
      for (let o = 0; o < 512 * H * 4; o += 4 * 7) if (lawn(o)) { r += d[o]; g += d[o + 1]; b += d[o + 2]; n++; }
      if (!n && sk >= 0) { r = sd[sk]; g = sd[sk + 1]; b = sd[sk + 2]; n = 1; }
      const B = 160; band = [r / n, g / n, b / n];
      for (let y = 3 - B; y < MY + B; y += 6) for (let x = 3 - B; x < MX + B; x += 6) {
        if (inArea(x, y) || (y < 0 && f.neighbour) || rnd(x, y, 0) > (this.carpet ? 0.08 : 0.8) * this.density) continue;
        tuft(x, y, 6, r / n, g / n, b / n);
      }
    }
    // ---- TREES: Round: the shadows of the trees and shrubs, baked into the lawn and the paths below (darker in three
    // steps towards the middle), thrown out to the front right of each crown ----
    const shadows = this.trees !== "leaves" ? ((f.fx && f.fx.plants) || []).map(p => this.shadowOf(p)).filter(Boolean) : [];
    // the shade (1 = none) of every pixel of a w x h area whose top left is the map's (ox, oy)
    const shadeMap = (w, h, ox, oy) => {
      if (!shadows.length) return null;
      const a = new Float32Array(w * h).fill(1);
      for (const [X, Z, rx, rz] of shadows) {
        for (let y = Math.max(0, Math.floor(Z - rz - oy)); y < Math.min(h, Math.ceil(Z + rz - oy)); y++) for (let x = Math.max(0, Math.floor(X - rx - ox)); x < Math.min(w, Math.ceil(X + rx - ox)); x++) {
          const dx = (x + ox - X) / rx, dz = (y + oy - Z) / rz, q = dx * dx + dz * dz; if (q >= 1) continue;
          const k = 1 - Math.floor((1 - Math.max(0, (Math.sqrt(q) - 0.35) / 0.65)) * 3 + 0.5) / 3 * 0.55, i = y * w + x;
          if (k < a[i]) a[i] = k;
        }
      }
      return a;
    };
    // the map's lawn colour (its mean), for the apron
    let lawnC = null;
    const lawnMean = () => { if (lawnC) return lawnC; let r = 0, g = 0, b = 0, n = 0; for (let o = 0; o < 512 * MY * 4; o += 4 * 7) if (lawn(o)) { r += d[o]; g += d[o + 1]; b += d[o + 2]; n++; } return (lawnC = n ? [r / n, g / n, b / n] : [60, 150, 40]); };
    // a lawn pixel, or one of the lawn's dither (a darker green between lawn pixels: lawn on 3 of its 4 sides), so the carpet covers the
    // lawn evenly instead of leaving the game's checkerboard showing through it
    const lawnAt = (x, y) => (inMap(x, y) && lawn(px(x, y)) ? 1 : 0);
    const lawnish = (x, y) => lawnAt(x, y) === 1 || lawnAt(x - 1, y) + lawnAt(x + 1, y) + lawnAt(x, y - 1) + lawnAt(x, y + 1) >= 3;
    // ---- the carpet's mask: the lawn's colour without the dither (dry patches yellower), alpha its height (taller patches) ----
    let carpet = null;
    if (this.carpet) {
      const B = band || apron.length ? 240 : 0, W = MX + 2 * B, Hc = MY + 2 * B, t = new Uint8Array(W * Hc * 4), sh = shadeMap(W, Hc, -B, -B);
      for (let j = 0; j < Hc; j++) for (let i = 0; i < W; i++) {
        const x = i - B, y = j - B; let c = null;
        if (inArea(x, y)) { if (open(x, y) && lawnish(x, y)) c = mean(x, y, 3, lawn); }
        else if (band && !(y < 0 && f.neighbour)) c = band;
        else if (inApron(x, y)) c = lawnMean();
        if (!c) continue;
        const mown = kept && (inArea(x, y) || inApron(x, y)), tall = mown ? 0.8 : noise(x / 38, y / 38), dr = mown ? 0 : Math.max(0, noise(x / 55 + 17, y / 55 + 5) - 0.5) * 1.8, o = (j * W + i) * 4;
        let edge = Math.min(1, Math.min(i, j, W - 1 - i, Hc - 1 - j) / 120 + (B ? 0 : 1));     // the band thins out over its outer 120 px
        if (!inArea(x, y) && f.neighbour) edge = Math.min(edge, Math.max(0, y) / 60);          // and towards the neighbouring map's edge
        const k = sh ? sh[j * W + i] : 1;
        t[o] = Math.min(255, c[0] + dr * 70 + 4) * k; t[o + 1] = Math.min(255, c[1] * (1 + dr * 0.06)) * k; t[o + 2] = c[2] * k; t[o + 3] = Math.round(255 * (0.45 + 0.55 * tall) * edge);
      }
      const kr = apron.reduce((k, r) => [Math.min(k[0], r[0]), Math.min(k[1], r[1]), Math.max(k[2], r[2]), Math.max(k[3], r[3])], [0, 0, MX, MY]);
      carpet = { tex: v.texture(W, Hc, t, true), rect: [-B, -B, W, Hc], kept: kept ? kr : [0, 0, 0, 0] };
    }
    // ---- the paths' surface: the dirt's colour without the dither, alpha how far into the path (its worn, lighter middle) ----
    let paths = null;
    {
      const t = new Uint8Array(512 * H * 4), D = (x, y) => inMap(x, y) && dirt(px(x, y)), sh = shadeMap(512, H, 0, 0); let n = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < 512; x++) {
        if (!D(x, y) || !openDirt(x, y)) continue;
        let r = 1; for (; r <= 7; r++) if (!D(x + r, y) || !D(x - r, y) || !D(x, y + r) || !D(x, y - r) || !D(x + r, y + r) || !D(x - r, y - r) || !D(x + r, y - r) || !D(x - r, y + r)) break;
        const c = mean(x, y, 3, dirt); if (!c) continue; const o = (y * 512 + x) * 4;
        const k = sh ? sh[y * 512 + x] : 1;
        t[o] = c[0] * k; t[o + 1] = c[1] * k; t[o + 2] = c[2] * k; t[o + 3] = 20 + Math.round(235 * Math.min(1, (r - 1) / 6)); n++;
      }
      if (n) paths = { tex: v.texture(512, H, t, true), rect: [0, 0, 512, H] };
    }
    // ---- the path edging (a brick per 2 x 2 px: kerb colours within 4 px of dirt) and the pebbles on the dirt ----
    const at = [], size = [], bcol = [];
    const nearDirt = (x, y) => { for (const [dx, dy] of [[4, 0], [-4, 0], [0, 4], [0, -4], [2, 0], [-2, 0], [0, 2], [0, -2]]) if (inMap(x + dx, y + dy) && dirt(px(x + dx, y + dy))) return true; return false; };
    for (let y = 1; y < H; y += 2) for (let x = 1; x < 512; x += 2) {
      const op = open(x, y); if (!op && !openDirt(x, y)) continue;
      const o = px(x, y);
      if (op && kerb(o) && nearDirt(x, y)) {
        const dark = d[o] < 80, course = Math.floor((x + y * 0.5) / 6) & 1;   // brick courses a shade apart
        const hh = (dark ? 1.9 : 2.6) + course * 0.25 + rnd(x, y, 7) * 0.15, k = 0.92 + course * 0.08;
        at.push(x, 0, y, 0); size.push(2.05, hh, 2.05, 0); bcol.push(d[o] / 255 * k, d[o + 1] / 255 * k, d[o + 2] / 255 * k);
      } else if (dirt(o) && (x & 3) === 1 && (y & 3) === 1) {
        for (let i = 0; i < 5; i++) {                                         // fine grit, mostly the dirt's own colour, the odd stone
          if (rnd(x, y, 60 + i) > 0.7) continue;
          const stone = rnd(x, y, 70 + i) < 0.06, grey = rnd(x, y, 75 + i) < 0.12, s = stone ? 1.1 + rnd(x, y, 80 + i) * 0.9 : 0.35 + rnd(x, y, 80 + i) * 0.55, k = 0.72 + rnd(x, y, 90 + i) * 0.5;
          const c = grey ? [0.66 * k, 0.62 * k, 0.55 * k] : [Math.min(1, d[o] / 255 * k * 1.05), d[o + 1] / 255 * k, d[o + 2] / 255 * k * 0.9];
          at.push(x - 1 + rnd(x, y, 100 + i) * 4, 0.04, y - 1 + rnd(x, y, 110 + i) * 4, rnd(x, y, 120 + i) * 3.14);
          size.push(s, s * (0.25 + rnd(x, y, 130 + i) * 0.3), s * (0.7 + rnd(x, y, 140 + i) * 0.5), 0); bcol.push(...c);
        }
      }
    }
    // ---- TERRACE (field_objects terrace: {rect, tables: [[x, z, colour 0/1]...], planters: [[x, z]...]}): a patio of light stone
    // slabs (8 x 8 px, two shades), round tables (a white top on a leg) each under a parasol in stripes of its colour and white (a
    // domed canopy on a pole), two to four chairs round it, flower planters along its edge ----
    if (def.terrace) {
      const T = def.terrace, [x0, z0, x1, z1] = T.rect, box = (x, y, z, w, h, dd, c, a = 0) => { at.push(x, y, z, a); size.push(w, h, dd, 0); bcol.push(c[0] / 255, c[1] / 255, c[2] / 255); };
      for (let z = z0; z < z1; z += 8) for (let x = x0; x < x1; x += 8) { const k = ((x - x0) / 8 + (z - z0) / 8) & 1, j = 0.96 + rnd(x, z, 9) * 0.06; box(x + 4, 0, z + 4, 7.6, 0.7, 7.6, [222 * j - k * 14, 214 * j - k * 14, 196 * j - k * 12]); }
      const CANOPY = [[216, 58, 44], [40, 110, 200]], WHITE = [246, 244, 236], WOOD = [150, 96, 52], GREY = [120, 120, 128];
      for (const [x, z, ci] of T.tables || []) {
        const col = CANOPY[ci || 0], a = rnd(x, z, 1) * 0.8;
        box(x, 0.7, z, 1.6, 6, 1.6, GREY); box(x, 6.7, z, 10, 0.9, 10, WHITE, a);                  // the leg, the top
        box(x, 7.6, z, 0.8, 15, 0.8, GREY);                                                           // the parasol's pole
        box(x, 19, z, 17.5, 0.8, 17.5, WHITE, a); box(x, 19, z, 17.5, 0.8, 17.5, WHITE, a + 0.785);   // its canopy: a white rim, then
        [17, 14, 10.5, 6.5, 3].forEach((w, i) => { const k = 0.9 + i * 0.05, c = col.map(u => Math.min(255, u * k));   // a dome of
          box(x, 19.8 + i * 1.1, z, w, 1.1, w, c, a); box(x, 19.8 + i * 1.1, z, w, 1.1, w, c, a + 0.785); });             // octagons
        box(x, 25.3, z, 1.4, 1.6, 1.4, WHITE);
        const n = 2 + Math.floor(rnd(x, z, 2) * 3);
        for (let i = 0; i < n; i++) {                                                                  // the chairs round it, facing in
          const t = a + i * 6.2832 / n + 0.4, cx = x + Math.cos(t) * 9, cz = z + Math.sin(t) * 9, back = [x + Math.cos(t) * 11, z + Math.sin(t) * 11];
          box(cx, 0.7, cz, 4, 3.6, 4, WOOD, -t); box(back[0], 0.7, back[1], 0.9, 8, 4, WOOD, -t);
        }
      }
      const FL = [[230, 60, 80], [250, 210, 60], [255, 255, 255], [190, 90, 220]];
      for (const [x, z] of T.planters || []) {
        box(x, 0, z, 12, 3.5, 6, [170, 110, 70]); box(x, 3.5, z, 11, 1.2, 5, [70, 140, 50]);
        for (let i = 0; i < 6; i++) box(x - 4.5 + i * 1.8 + rnd(x, z, 30 + i), 4.7, z - 1.5 + rnd(x, z, 40 + i) * 3, 1.4, 1.4 + rnd(x, z, 50 + i), 1.4, FL[(i + (Math.floor(x) & 3)) % FL.length]);
      }
    }
    // ---- the trees, bushes and palms: rounded puffs of foliage over the green of the plant's picture (a puff centre every
    // 5 px of crown, two or three deep, so the crown is round), each a ball of small leaves lit from above: light yellow-green
    // on top, dark below and inside; placed with the plant's own model (its lean back) ----
    const leaf = [], turn = [], lcol = [], Ld = [-0.35, 0.85, 0.4], Ll = Math.hypot(...Ld), L = Ld.map(c => c / Ll);
    const cC = [], cS = [], cW = [], cCol = [], sp = { leaf: [], turn: [], col: [] };
    for (const p of (f.fx && f.fx.plants) || []) {
      const img = p.shape.img; if (!img || img.kind === "pot" || img.kind === "statue") continue;
      if (this.trees === "original" && img.kind !== "palm") continue;   // the game's own crown, rounded
      if (this.round && img.kind !== "palm") { this.crown(p, cC, cS, cW, cCol, at, size, bcol, sp, L); continue; }
      const { d: pd, w, h } = img, m = p.model, crown = img.kind === "bush" ? 0.3 : 0.38, green = o => pd[o + 3] >= 128 && pd[o + 1] >= pd[o] * 0.85 && pd[o + 1] > pd[o + 2];
      let mr = 0, mg = 0, mb = 0, mn = 0, top = h;                                // the crown's mean colour, and its top row
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; if (!green(o)) continue; mr += pd[o]; mg += pd[o + 1]; mb += pd[o + 2]; mn++; top = Math.min(top, y); }
      if (!mn) continue; mr /= mn * 255; mg /= mn * 255; mb /= mn * 255;
      const seed = m[12] * 3.1 + m[14] * 1.7;
      for (let y = 1; y < h; y += 5) for (let x = 1; x < w; x += 5) {
        if (!green((y * w + x) * 4)) continue;
        const across = Math.sqrt(Math.max(0, 1 - Math.pow((x - w / 2) / (w / 2 + 1), 2))), deep = across * w * crown;
        const layers = deep > 4 ? 3 : 2;
        for (let j = 0; j < layers; j++) {
          const cz = (layers === 3 ? [-0.7, 0, 0.7][j] : [-0.45, 0.45][j]) * deep + (rnd(x, y + seed, 60 + j) - 0.5) * 2;
          const cx = x - w / 2 + (rnd(x + seed, y, 61 + j) - 0.5) * 2, cy = h - y + (rnd(x, y, 62 + j) - 0.5) * 2;
          const R = (3.9 + rnd(x, y + seed, 63 + j) * 2.4) * (img.kind === "bush" ? 0.85 : 1), up = 1 - (y - top) / Math.max(1, h - top);   // (higher puffs lighter)
          const hue = (rnd(x + seed, y, 64 + j) - 0.5) * 0.16;                      // each clump a little yellower or bluer
          for (let i = 0; i < 64; i++) {
            const u = rnd(x + j * 7, y + seed, 100 + i) * 2 - 1, a = rnd(x + seed, y + j * 5, 200 + i) * 6.2832, sq = Math.sqrt(1 - u * u);
            const n = [sq * Math.cos(a), u, sq * Math.sin(a)], rr = R * (0.62 + 0.38 * Math.sqrt(rnd(x, y, 300 + i + j * 31)));
            const lx = cx + n[0] * rr, ly = cy + n[1] * rr * 0.85, lz = cz + n[2] * rr;
            const X = m[0] * lx + m[4] * ly + m[8] * lz + m[12], Y = m[1] * lx + m[5] * ly + m[9] * lz + m[13], Z = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
            const lit = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]), ao = 0.55 + 0.45 * rr / R;    // inner leaves in the crown's shade
            const k = (0.3 + 0.82 * Math.pow(lit, 1.3) + 0.16 * up) * ao + (rnd(x, y, 400 + i) - 0.5) * 0.18;
            const warm = lit * lit * 0.2 + hue;                                      // sunlit tips: yellow-green
            leaf.push(X, Y, Z, 1.05 + rnd(x, y, 500 + i) * 0.85);
            turn.push(Math.atan2(n[2], n[0]) + 1.5708 + (rnd(x, y, 600 + i) - 0.5) * 0.9, (rnd(x, y, 700 + i) - 0.5) * 1.8, p.phase + (X + Z) * 0.02, p.amp * Math.min(1, ly / h) * 1.2);
            lcol.push(Math.min(1, (mr * 0.85 + warm) * k + 0.02), Math.min(1, (mg * 1.05 + warm * 0.8) * k), Math.min(1, mb * 0.8 * k));
          }
        }
      }
    }
    this.free();
    this.built = {
      floor: d, fx: f.fx, carpetOn: this.carpet, round: this.trees, carpet, paths, size: this.mapSize(), map: v.mapId(), ver: f.floorVer || 0, growth: this.growth(d),
      blades: this.vao(this.tri, 2, [[blades, 4], [cols, 4], [leans, 2]]),
      boxes: this.vao(this.cube, 4, [[at, 4], [size, 4], [bcol, 3]]),
      leaves: this.vao(this.quad, 2, [[leaf, 4], [turn, 4], [lcol, 3]]),
      clumps: this.vao(this.sphere, 3, [[cC, 4], [cS, 4], [cW, 4], [cCol, 3]]),
      spikes: this.vao(this.quad, 2, [[sp.leaf, 4], [sp.turn, 4], [sp.col, 3]]),
    };
    this.stats = { blades: this.built.blades.n, boxes: this.built.boxes.n, leaves: this.built.leaves.n, clumps: this.built.clumps.n, spikes: this.built.spikes.n, shadows: shadows.length };
  }
  // TREES: Round: one plant's crown as clumps (local plant space: x across, y up from its foot, z towards the camera; placed
  // with the plant's model), shaped by the green of its picture: a round tree (a top clump, a ring of five round it and
  // three below), a tall narrow one as a cypress (a column of clumps narrowing to a point), a bush as a low mound; one bush
  // in three flowers (pink or white)
  // the shadow a tree or shrub's crown throws on the ground: [x, z, radius across, radius deep] in map px, or null
  shadowOf(p) {
    const img = p.shape.img; if (!img || img.kind === "pot" || img.kind === "statue" || img.kind === "palm") return null;
    const { d: pd, w, h } = img, m = p.model; let x0 = w, x1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; if (pd[o + 3] >= 128 && pd[o + 1] >= pd[o] * 0.85 && pd[o + 1] > pd[o + 2]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); } }
    if (x1 < 0) return null;
    const W = x1 - x0 + 1, cx = (x0 + x1 + 1) / 2 - w / 2, X = m[0] * cx + m[12], Z = m[2] * cx + m[14];
    return [X + W * 0.42, Z + W * 0.22, W * 0.9, W * 0.55];
  }
  crown(p, cC, cS, cW, cCol, at, size, bcol, sp, L) {
    const { d: pd, w, h, kind } = p.shape.img, m = p.model, green = o => pd[o + 3] >= 128 && pd[o + 1] >= pd[o] * 0.85 && pd[o + 1] > pd[o + 2];
    let mr = 0, mg = 0, mb = 0, n = 0, x0 = w, x1 = -1, y0 = h, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; if (!green(o)) continue; mr += pd[o]; mg += pd[o + 1]; mb += pd[o + 2]; n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (!n) return;
    mr /= n * 255; mg /= n * 255; mb /= n * 255;
    const W = x1 - x0 + 1, Hc = y1 - y0 + 1, cx = (x0 + x1 + 1) / 2 - w / 2, cy = h - (y0 + y1 + 1) / 2, seed = m[12] * 0.37 + m[14] * 0.53;
    const R = (k) => rnd(m[12], m[14], k), list = [];
    // a dark core with rounded lobes all over its upper part (points spread evenly over a sphere, the lowest left out):
    // every lobe catches the light on its own top, with shadowy gaps between them, so the crown's edge is scalloped
    const lobed = (X0, Y0, Z0, core, n, lobe, sy) => {
      list.push([X0, Y0, Z0, core, 1, sy, 0.62, 1]);
      for (let i = 0, made = 0; made < n && i < n * 2; i++) {
        const u = 1 - 2 * (i + 0.5) / (n * 1.35), a = i * 2.39996 + R(400 + i), sq = Math.sqrt(Math.max(0, 1 - u * u));
        if (u < -0.45) continue; made++;
        list.push([X0 + Math.cos(a) * sq * core * 0.86, Y0 + u * core * 0.86 * sy, Z0 + Math.sin(a) * sq * core * 0.86, lobe * (0.82 + 0.3 * R(450 + i)), 1, 0.92, 1, 0]);
      }
    };
    let tint = [1, 1, 1];
    if (kind === "bush") {                                                  // a mound: a low core with lobes
      const core = Math.min(W * 0.42, Hc * 0.62);
      lobed(cx, Math.max(core * 0.75, cy - Hc * 0.05), 0, core, 10, core * 0.5, 0.85);
      tint = [0.95 + 0.1 * R(5), 1, 0.95];
    } else if (Hc > W * 1.5) {                                              // a cypress: a dense cone of small clumps
      const k = Math.max(6, Math.round(Hc / 3.2));
      for (let i = 0; i < k; i++) {
        const u = i / (k - 1), rr = W * 0.5 * (1 - u * 0.8), a = R(i) * 6.2832, off = rr * 0.35;
        list.push([cx + Math.cos(a) * off, cy - Hc / 2 + (0.08 + u * 0.86) * Hc, Math.sin(a) * off, rr * (0.75 + 0.2 * R(40 + i)), 1, 1.15, 1, 0]);
        if (rr > 3 && i % 2 === 0) list.push([cx - Math.cos(a) * off, cy - Hc / 2 + (0.1 + u * 0.86) * Hc, -Math.sin(a) * off, rr * 0.7, 1, 1.1, 1, 0]);
      }
      tint = [0.62, 0.86, 0.95];                                          // cypresses: a deeper, cooler green
    } else {                                                                // a round tree: a big lobed ball
      const core = Math.min(W * 0.42, Hc * 0.5);
      lobed(cx, cy + Hc * 0.04, 0, core, 18, core * 0.46, 0.95);
      if (R(6) < 0.3) tint = [1.3, 1.16, 0.6];                              // some trees a sunny yellow-green
    }
    mr = Math.min(1, mr * tint[0]); mg = Math.min(1, mg * tint[1]); mb = Math.min(1, mb * tint[2]);
    const tw = (x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
    // the leaf ramp of the clump shader, for the spikes (lit 0-1 -> five shades of the crown's green)
    const base = [mr * 0.78, mg * 0.8, mb * 0.62], ramp = lit => {
      const k = Math.max(0, Math.min(4, Math.floor(lit * 4.6))), m = [[0.32, 0.42, 0.55], [0.55, 0.66, 0.7], [0.84, 0.84, 0.84], [1.04, 1.04, 1.04], [1.16, 1.16, 1.16]][k], a = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0.06, 0.06, 0], [0.17, 0.15, 0.02]][k];
      return base.map((c, j) => Math.min(1, c * m[j] + a[j]));
    };
    list.forEach(([x, y, z, r, sx, sy, shade = 1, inner = 0], i) => {
      const [X, Y, Z] = tw(x, y, z), hue = (R(90 + i) - 0.5) * 0.1, wind = p.amp * Math.min(1, y / h) * 1.1, ph = p.phase + (X + Z) * 0.02;
      cC.push(X, Y, Z, r * 0.86); cS.push(sx, sy, seed + i * 3.7, ph); cW.push(wind, 0, 0, 0);
      cCol.push(Math.min(1, (mr * (1 + hue) + 0.02) * shade), Math.min(1, mg * 1.04 * shade), Math.min(1, mb * (1 - hue) * shade));
      if (inner) return;                                                  // (the dark core: no leaves of its own)
      // spiky leaves standing out of the clump all over its upper and outer surface: they make the crown's jagged outline
      const nLeaves = Math.max(10, Math.min(110, Math.round(r * r * 2.4)));
      for (let k = 0; k < nLeaves; k++) {
        const u = -0.45 + 1.45 * R(300 + i * 97 + k), a = R(500 + i * 89 + k) * 6.2832, sq = Math.sqrt(Math.max(0, 1 - u * u));
        const s0 = [sq * Math.cos(a), u, sq * Math.sin(a)], len = 0.8 + R(700 + i * 71 + k) * 1.1;
        const j = [R(1500 + i * 13 + k) - 0.5, R(1700 + i * 17 + k) - 0.5, R(1900 + i * 19 + k) - 0.5], nl = Math.hypot(s0[0] + j[0] * 0.9, s0[1] + j[1] * 0.9, s0[2] + j[2] * 0.9);
        const n = [(s0[0] + j[0] * 0.9) / nl, (s0[1] + j[1] * 0.9) / nl, (s0[2] + j[2] * 0.9) / nl];   // (leaves tilted every way, not straight out)
        const rr = r * 0.86 * (0.9 + 0.1 * R(900 + i * 61 + k));
        const P = [X + s0[0] * rr * sx + n[0] * len * 0.7, Y + s0[1] * rr * sy + n[1] * len * 0.7, Z + s0[2] * rr * sx + n[2] * len * 0.7];
        const lit = Math.max(0, Math.min(1, (s0[0] * L[0] + s0[1] * L[1] + s0[2] * L[2]) * 0.55 + 0.45)) * (0.55 + 0.45 * Math.min(1, Math.max(0, (s0[1] + 0.7) / 1.05))) + (R(1100 + i * 53 + k) - 0.5) * 0.35;
        sp.leaf.push(...P, len); sp.turn.push(Math.atan2(-n[0], n[2]) + (R(1300 + k) - 0.5) * 0.5, Math.acos(Math.max(-1, Math.min(1, n[1]))), ph, wind);
        sp.col.push(...ramp(lit));
      }
    });
    if (kind === "bush" && R(99) < 0.34) {                                  // flowers on the mound's top and sides
      const pink = R(98) < 0.6, fc = pink ? [1, 0.62, 0.78] : [1, 0.98, 0.9];
      for (let i = 0; i < 14; i++) {
        const c = list[Math.floor(R(200 + i) * list.length)], a = R(220 + i) * 6.2832, u = 0.25 + R(240 + i) * 0.75, sq = Math.sqrt(1 - u * u);
        const [X, Y, Z] = tw(c[0] + Math.cos(a) * sq * c[3], c[1] + u * c[3] * c[5], c[2] + Math.sin(a) * sq * c[3] + c[3] * 0.25);
        at.push(X, Y, Z, a); size.push(1.1, 0.8, 1.1, 0); bcol.push(fc[0], fc[1] * (0.9 + 0.1 * R(260 + i)), fc[2]);
      }
    }
  }
  // voxel.js drawFieldScene, after the floor and walls: the map's own detail (not a neighbouring map's), you pushing the grass aside
  // the map's size (wMapWidth, wMapHeight): a new map's floor can be built while they still hold the last map's, so a change of them
  // (or of the map) builds the ground again (else the grass keeps the last map's area: the road by the cafe was never mown)
  // the neighbouring map drawn beyond this one's edge (voxel.js drawFieldScene, with v.gb its ROM copy of that map: its size, collision and
  // id): its own ground, built and kept apart from this map's, so the mown lawn, kerbs and grit run on across the seam
  drawPart(f, mvp, T) { const own = this.built; this.built = this.builtPart || null; this.inPart = true; try { this.draw(f, mvp, T); } finally { this.inPart = false; this.builtPart = this.built; this.built = own; } }
  mapSize() { const w0 = this.v.gb.mem.wram[0]; return w0[0x32B] << 8 | w0[0x32C]; }
  // the floor's colours were repainted (voxel.js recolourField: a fade, a palette change) and have been still for 0.4 s: what grows where
  // is read from those colours, so a ground first built during a fade-in (all dark: no lawn, no dirt) is built again in the real ones
  // (only when the share of lawn and dirt in them changed: a palette that keeps cycling, water, builds nothing again)
  stale(f) {
    const B = this.built; if ((f.floorVer || 0) === B.ver || performance.now() - (f.floorAt || 0) <= 400) return false;
    const g = this.growth(f.floorData); B.ver = f.floorVer || 0; return Math.abs(g - B.growth) > 0.2 * Math.max(B.growth, 50);
  }
  growth(d) {                                    // lawn and dirt among a sample of the floor's pixels
    let n = 0; for (let o = 0; o < d.length; o += 4 * 61) { const r = d[o], g = d[o + 1], b = d[o + 2]; if ((g > 70 && g >= r && b < g * 0.45) || (r > 120 && r > g * 1.25 && b < r * 0.45)) n++; }
    return n;
  }
  draw(f, mvp, T) {
    if (!this.on || !f.floorData) return;      // (side-view maps too: the road by the cafe, mown and kerbed as the courtyard it joins)
    const v = this.v, gl = v.gl;
    try { if (!this.pB) this.init(); if (!this.built || this.built.floor !== f.floorData || this.built.fx !== f.fx || this.built.carpetOn !== this.carpet || this.built.round !== this.trees || this.built.size !== this.mapSize() || this.built.map !== v.mapId() || this.stale(f)) this.build(f); } catch (e) { console.warn("ground", e); this.on = false; return; }
    const B = this.built, me = !this.inPart && v.fi && v.fi.act && v.fi.act.get(0);   // (you part only your own map's grass)
    if (B.blades.n) {
      gl.useProgram(this.pB); gl.uniformMatrix4fv(this.uB.uMVP, false, mvp); gl.uniform1f(this.uB.uTime, T); gl.uniform3fv(this.uB.uPush, me ? [me.x, me.y + 4, 1] : [0, 0, 0]);
      gl.bindVertexArray(B.blades.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, B.blades.n);
    }
    if (B.paths || B.carpet) { gl.useProgram(this.pS); gl.uniformMatrix4fv(this.uS.uMVP, false, mvp); gl.uniform1f(this.uS.uTime, T); gl.uniform4fv(this.uS.uKept, [0, 0, 0, 0]); gl.activeTexture(gl.TEXTURE0); gl.uniform1i(this.uS.uMask, 0); }
    if (B.paths) {
      gl.uniform4fv(this.uS.uRect, B.paths.rect); gl.uniform1f(this.uS.uN, 1); gl.uniform1f(this.uS.uHmax, 0); gl.uniform1f(this.uS.uFlat, 1);
      gl.uniform3fv(this.uS.uPush, [0, 0, 0]); gl.bindTexture(gl.TEXTURE_2D, B.paths.tex); gl.bindVertexArray(this.unitVao); gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.uniform1f(this.uS.uFlat, 0);
    }
    if (B.carpet) {
      const N = 14;
      gl.useProgram(this.pS); gl.uniformMatrix4fv(this.uS.uMVP, false, mvp); gl.uniform4fv(this.uS.uRect, B.carpet.rect); gl.uniform4fv(this.uS.uKept, B.carpet.kept); gl.uniform1f(this.uS.uN, N);
      gl.uniform1f(this.uS.uHmax, 3.4); gl.uniform1f(this.uS.uTime, T); gl.uniform3fv(this.uS.uPush, me ? [me.x, me.y + 4, 1] : [0, 0, 0]);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, B.carpet.tex); gl.uniform1i(this.uS.uMask, 0);
      gl.bindVertexArray(this.unitVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, N);
    }
    if (B.boxes.n) { gl.useProgram(this.pX); gl.uniformMatrix4fv(this.uX.uMVP, false, mvp); gl.bindVertexArray(B.boxes.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 30, B.boxes.n); }
    if (B.clumps.n) {
      gl.useProgram(this.pC); gl.uniformMatrix4fv(this.uC.uMVP, false, mvp); gl.uniform1f(this.uC.uTime, T);
      gl.bindVertexArray(B.clumps.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, this.sphereN, B.clumps.n);
    }
    if (B.spikes.n) {
      gl.useProgram(this.pL); gl.uniformMatrix4fv(this.uL.uMVP, false, mvp); gl.uniform1f(this.uL.uTime, T); gl.uniform1f(this.uL.uSpike, 1);
      gl.bindVertexArray(B.spikes.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, B.spikes.n); gl.uniform1f(this.uL.uSpike, 0);
    }
    if (B.leaves.n) {
      gl.useProgram(this.pL); gl.uniformMatrix4fv(this.uL.uMVP, false, mvp); gl.uniform1f(this.uL.uTime, T);
      gl.bindVertexArray(B.leaves.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, B.leaves.n);
    }
    gl.bindVertexArray(v.vao); gl.useProgram(v.prog);
  }
}
export function attachGround(voxel, hud) {
  const g = voxel.groundFx = new Ground(voxel);
  if (hud) {
    const t = document.createElement("span"); t.className = "k"; t.id = "treesbtn"; t.title = "3D overworld: the game's own trees made round (Original), trees and shrubs as clumps of leaves (Round), or the game's crowns covered in small leaves (Leaves)";
    const showT = () => { t.textContent = "TREES: " + TREE_LABEL[g.trees]; };
    t.addEventListener("pointerdown", () => { g.setTrees(TREES[(TREES.indexOf(g.trees) + 1) % TREES.length]); showT(); });
    hud.appendChild(document.createTextNode(" ")); hud.appendChild(t); showT();
  }
  return g;
}
