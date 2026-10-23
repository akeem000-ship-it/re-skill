// "GROUND: Pixel / Detail" (3D overworld): the ground in more detail, made from the map's own picture (nothing new is drawn:
// every colour comes from the floor and the plants the game paints):
//   grass     the lawns (green with little blue: not the courts' teals, not solid squares) grow tufts of 5-9 blades from one
//             root, coloured from the lawn round them without the game's dither (dark at the root, lighter at the tip), in
//             patches taller or shorter, greener or drier; also on the plain ground the view adds round a map when it is lawn
//   trees     the trees, bushes and palms (voxel.js plants) get full crowns: rounded puffs of small leaves over the green of
//             their picture, two or three deep, lit from above (light yellow-green on top, dark below and inside)
//   edging    the light bricks and their dark outline lining the dirt paths stand up as a low kerb, a brick per 2 x 2 px
//   paths     the dirt is strewn with fine grit (its own colour, some grey) and the odd small stone
// Two kinds of grass (the GROUND button: Pixel / Tufts / Carpet): tufts as above, or a carpet: a dense, short, flat turf of
// fine strands over every lawn (shells: the lawn drawn in thin layers one above another, each keeping only the strands
// that reach it, thinning to their tips), with a few taller tufts standing out of it. On the school grounds (KEPT: the
// courts, the plaza and school entrance, the dorm) the lawns inside the map are mown: short and even, in light and dark
// stripes; the ground beyond stays rough.
// Grass and leaves sway in the same travelling wind as the trees and hedges (voxel.js VSP); grass parts round you as you
// walk. Three instanced draws per map (blades, boxes, leaves), made when the floor picture is (voxel.js buildField).
const KEY = "mt-ground";
const KEPT = new Set([20, 22, 23, 24, 26, 27, 28, 29, 30, 31, 36]);   // maps whose lawns are mown (wCurMapID; 19, the road, stays rough)
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
void main() { vec2 q = vUV; float w = 1.0 - q.y * q.y; if (abs(q.x) > w) discard; o = vec4(vCol * (1.0 - 0.25 * abs(q.x) / max(w, 0.01)), 1.0); }`;
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
    let m = null; try { m = new URLSearchParams(location.search).get("ground"); } catch (e) { /* no location */ }
    if (m === null) { try { m = localStorage.getItem(KEY); } catch (e) { m = null; } }
    if (m === null) m = "carpet";                                      // the default: carpet (with mown campus lawns)
    this.on = m === "detail" || m === "on" || m === "carpet"; this.carpet = m === "carpet"; this.density = 1;
  }
  setOn(on, carpet = false) { this.on = !!on; this.carpet = this.on && carpet; try { localStorage.setItem(KEY, this.carpet ? "carpet" : this.on ? "detail" : "pixel"); } catch (e) { /* private mode */ } }
  init() {
    const v = this.v, gl = v.gl, uni = (p, names) => Object.fromEntries(names.map(n => [n, gl.getUniformLocation(p, n)]));
    this.pB = v.link(VS_BLADE, FS_BLADE, ["aCorner", "aBlade", "aCol", "aLean"]); this.uB = uni(this.pB, ["uMVP", "uTime", "uPush"]);
    this.pX = v.link(VS_BOX, FS_BOX, ["aCube", "aAt", "aSize", "aCol"]); this.uX = uni(this.pX, ["uMVP"]);
    this.pS = v.link(VS_SHELL, FS_SHELL, ["aCorner"]); this.uS = uni(this.pS, ["uMVP", "uRect", "uKept", "uN", "uHmax", "uMask", "uTime", "uPush", "uFlat"]);
    this.pL = v.link(VS_LEAF, FS_LEAF, ["aCorner", "aLeaf", "aTurn", "aCol"]); this.uL = uni(this.pL, ["uMVP", "uTime"]);
    const buf = a => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, a, gl.STATIC_DRAW); return b; };
    this.tri = buf(new Float32Array([-0.5, 0, 0.5, 0, 0, 1])); this.cube = buf(cube());
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
    for (const k of ["blades", "boxes", "leaves"]) if (B[k]) { for (const b of B[k].bufs) gl.deleteBuffer(b); gl.deleteVertexArray(B[k].vao); }
    if (B.carpet) gl.deleteTexture(B.carpet.tex);
    if (B.paths) gl.deleteTexture(B.paths.tex);
    this.built = null;
  }
  build(f) {
    const v = this.v, d = f.floorData, w0 = v.gb.mem.wram[0], coll = v.gb.mem.wram[6];
    const MW = Math.min(32, (w0[0x32B] || 64) >> 1), MH = Math.min(32, (w0[0x32C] || 64) >> 1), H = f.mapH || 512;
    const MX = MW * 16, MY = Math.min(H, MH * 16);                         // the map's own area (wMapWidth / Height)
    const px = (x, y) => (y * 512 + x) * 4, inMap = (x, y) => x >= 0 && y >= 0 && x < 512 && y < H, inArea = (x, y) => x >= 0 && y >= 0 && x < MX && y < MY;
    const lawn = o => { const r = d[o], g = d[o + 1], b = d[o + 2]; return g > 70 && g >= r && b < g * 0.45; };
    // where things may grow: a walkable 16 x 16 square not under an annotated object, or any square that is all lawn
    // (the lawns beyond the fences you cannot walk on, and lawn inside an object's box; a wall or a hedge has other colours)
    const allLawn = new Uint8Array(32 * 32);
    for (let my = 0; my < MH; my++) for (let mx = 0; mx < MW; mx++) {
      let n = 0;
      for (let y = 1; y < 16; y += 2) for (let x = 1; x < 16; x += 2) if (lawn(((my * 16 + y) * 512 + mx * 16 + x) * 4)) n++;
      allLawn[my * 32 + mx] = n >= 58 ? 1 : 0;                                  // 58 of the 64 samples
    }
    const open = (x, y) => { const mx = x >> 4, my = y >> 4, i = my * 32 + mx; return mx < MW && my < MH && (allLawn[i] || (coll[i] !== 0x0F && !(f.covered && f.covered[i]))); };
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
    if (sd && (sf.grassSrc || (sk >= 0 && sLawn(sk)))) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let o = 0; o < 512 * H * 4; o += 4 * 7) if (lawn(o)) { r += d[o]; g += d[o + 1]; b += d[o + 2]; n++; }
      if (!n && sk >= 0) { r = sd[sk]; g = sd[sk + 1]; b = sd[sk + 2]; n = 1; }
      const B = 160; band = [r / n, g / n, b / n];
      for (let y = 3 - B; y < MY + B; y += 6) for (let x = 3 - B; x < MX + B; x += 6) {
        if (inArea(x, y) || (y < 0 && f.neighbour) || rnd(x, y, 0) > (this.carpet ? 0.08 : 0.8) * this.density) continue;
        tuft(x, y, 6, r / n, g / n, b / n);
      }
    }
    // ---- the carpet's mask: the lawn's colour without the dither (dry patches yellower), alpha its height (taller patches) ----
    let carpet = null;
    if (this.carpet) {
      const B = band ? 240 : 0, W = MX + 2 * B, Hc = MY + 2 * B, t = new Uint8Array(W * Hc * 4);
      for (let j = 0; j < Hc; j++) for (let i = 0; i < W; i++) {
        const x = i - B, y = j - B; let c = null;
        if (inArea(x, y)) { if (open(x, y) && lawn(px(x, y))) c = mean(x, y, 3, lawn); }
        else if (band && !(y < 0 && f.neighbour)) c = band;
        if (!c) continue;
        const mown = kept && inArea(x, y), tall = mown ? 0.8 : noise(x / 38, y / 38), dr = mown ? 0 : Math.max(0, noise(x / 55 + 17, y / 55 + 5) - 0.5) * 1.8, o = (j * W + i) * 4;
        let edge = Math.min(1, Math.min(i, j, W - 1 - i, Hc - 1 - j) / 120 + (B ? 0 : 1));     // the band thins out over its outer 120 px
        if (!inArea(x, y) && f.neighbour) edge = Math.min(edge, Math.max(0, y) / 60);          // and towards the neighbouring map's edge
        t[o] = Math.min(255, c[0] + dr * 70 + 4); t[o + 1] = Math.min(255, c[1] * (1 + dr * 0.06)); t[o + 2] = c[2]; t[o + 3] = Math.round(255 * (0.45 + 0.55 * tall) * edge);
      }
      carpet = { tex: v.texture(W, Hc, t, true), rect: [-B, -B, W, Hc], kept: kept ? [0, 0, MX, MY] : [0, 0, 0, 0] };
    }
    // ---- the paths' surface: the dirt's colour without the dither, alpha how far into the path (its worn, lighter middle) ----
    let paths = null;
    {
      const t = new Uint8Array(512 * H * 4), D = (x, y) => inMap(x, y) && dirt(px(x, y)); let n = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < 512; x++) {
        if (!D(x, y) || !open(x, y)) continue;
        let r = 1; for (; r <= 7; r++) if (!D(x + r, y) || !D(x - r, y) || !D(x, y + r) || !D(x, y - r) || !D(x + r, y + r) || !D(x - r, y - r) || !D(x + r, y - r) || !D(x - r, y + r)) break;
        const c = mean(x, y, 3, dirt); if (!c) continue; const o = (y * 512 + x) * 4;
        t[o] = c[0]; t[o + 1] = c[1]; t[o + 2] = c[2]; t[o + 3] = 20 + Math.round(235 * Math.min(1, (r - 1) / 6)); n++;
      }
      if (n) paths = { tex: v.texture(512, H, t, true), rect: [0, 0, 512, H] };
    }
    // ---- the path edging (a brick per 2 x 2 px: kerb colours within 4 px of dirt) and the pebbles on the dirt ----
    const at = [], size = [], bcol = [];
    const nearDirt = (x, y) => { for (const [dx, dy] of [[4, 0], [-4, 0], [0, 4], [0, -4], [2, 0], [-2, 0], [0, 2], [0, -2]]) if (inMap(x + dx, y + dy) && dirt(px(x + dx, y + dy))) return true; return false; };
    for (let y = 1; y < H; y += 2) for (let x = 1; x < 512; x += 2) {
      if (!open(x, y)) continue;
      const o = px(x, y);
      if (kerb(o) && nearDirt(x, y)) {
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
    // ---- the trees, bushes and palms: rounded puffs of foliage over the green of the plant's picture (a puff centre every
    // 5 px of crown, two or three deep, so the crown is round), each a ball of small leaves lit from above: light yellow-green
    // on top, dark below and inside; placed with the plant's own model (its lean back) ----
    const leaf = [], turn = [], lcol = [], Ld = [-0.35, 0.85, 0.4], Ll = Math.hypot(...Ld), L = Ld.map(c => c / Ll);
    for (const p of (f.fx && f.fx.plants) || []) {
      const img = p.shape.img; if (!img || img.kind === "pot" || img.kind === "statue") continue;
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
      floor: d, fx: f.fx, carpetOn: this.carpet, carpet, paths,
      blades: this.vao(this.tri, 2, [[blades, 4], [cols, 4], [leans, 2]]),
      boxes: this.vao(this.cube, 4, [[at, 4], [size, 4], [bcol, 3]]),
      leaves: this.vao(this.quad, 2, [[leaf, 4], [turn, 4], [lcol, 3]]),
    };
    this.stats = { blades: this.built.blades.n, boxes: this.built.boxes.n, leaves: this.built.leaves.n };
  }
  // voxel.js drawFieldScene, after the floor and walls: the map's own detail (not a neighbouring map's), you pushing the grass aside
  draw(f, mvp, T) {
    if (!this.on || !f.floorData || f.noGlass) return;
    const v = this.v, gl = v.gl;
    try { if (!this.pB) this.init(); if (!this.built || this.built.floor !== f.floorData || this.built.fx !== f.fx || this.built.carpetOn !== this.carpet) this.build(f); } catch (e) { console.warn("ground", e); this.on = false; return; }
    const B = this.built, me = v.fi && v.fi.act && v.fi.act.get(0);
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
    const b = document.createElement("span"); b.className = "k"; b.id = "groundbtn"; b.title = "3D overworld: the ground as the game's pixels, or in detail: grass that sways and parts as you walk, leafy trees, raised path edging and pebbles on the paths";
    const show = () => { b.textContent = "GROUND: " + (g.carpet ? "Carpet" : g.on ? "Tufts" : "Pixel"); b.classList.toggle("on", g.on); };
    b.addEventListener("pointerdown", () => { if (!g.on) g.setOn(true); else if (!g.carpet) g.setOn(true, true); else g.setOn(false); show(); });
    hud.appendChild(document.createTextNode(" ")); hud.appendChild(b); show();
  }
  return g;
}
