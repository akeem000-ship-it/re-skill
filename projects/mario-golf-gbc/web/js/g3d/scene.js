// The 3D hole view (render only): a WebGL picture of the hole the game is playing, drawn over the play page's screen. The hole's
// course map (hole3d.js, from the ROM) is the ground; the golfer, the pin, the trees and the ball stand on it, the ball at its true
// height over its ground point with a shadow under it; the camera follows the game's views (the course view, the view behind the
// golfer, the flight, the green, the cup close-up; camera.js). The game's HUD (the window layer and the sprites the HUD's code
// queues) is laid over it as the game draws it. Effects plug in as layers (layers.js) with frame() and draw() steps.
// Nothing here writes the game's memory: every value is read (GolfMemory w, its display model) or built from the ROM.
import { m4, program, vao, texture, updateTexture, clamp, lerp, gbc } from "./gl.js";
import { HoleArt, T, PX, CELLS } from "./hole3d.js";
import { extractTrees, terrainColours, buildHeights, heightSampler } from "./terrain3d.js";
import { roundedMeshData } from "./voxround.js";
import { golferFrame, picKey } from "./sprites3d.js";
import { SkyBox } from "./skybox.js";
import { HudLayer, tagsOf } from "./hud3d.js";
import { CameraRig } from "./camera3d.js";
import { Lighting } from "./light3d.js";
import { GROUND_VS, GROUND_FS } from "./groundshader.js";

// ---- shaders: voxel bodies (per-vertex colour, lit and shadowed), points (particles), flat decals, textured billboards, the HUD ----
const LIGHT_GLSL = `
uniform vec3 uSunDir, uSunCol, uAmb, uFogCol; uniform float uFogNear, uFogFar, uNight; uniform vec3 uEye;
uniform vec4 uLights[4]; uniform vec3 uLightCol[4]; uniform vec4 uFade;
vec3 pointLights(vec3 p, vec3 n) { vec3 s = vec3(0.0); for (int i = 0; i < 4; i++) { vec3 d = uLights[i].xyz - p; float r = uLights[i].w; if (r <= 0.0) continue;
  float l = length(d); s += uLightCol[i] * max(0.0, 1.0 - l / r) * (0.35 + 0.65 * max(0.0, dot(n, d / max(l, 0.001)))); } return s; }
vec3 finish(vec3 c, vec3 p) { float f = clamp((distance(p, uEye) - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0); c = mix(c, uFogCol, f * f); return mix(c, uFade.rgb, uFade.a); }`;
const OBJ_VS = `#version 300 es
in vec3 aPos; in vec3 aCol; uniform mat4 uMVP; uniform mat4 uModel; uniform mat4 uShadowMVP; out vec3 vCol; out vec3 vW; out vec4 vSh;
void main() { vec4 w = uModel * vec4(aPos, 1.0); vW = w.xyz; vCol = aCol; vSh = uShadowMVP * w; gl_Position = uMVP * w; }`;
const OBJ_FS = `#version 300 es
precision highp float; precision highp sampler2DShadow; in vec3 vCol; in vec3 vW; in vec4 vSh; uniform vec4 uTint; uniform sampler2DShadow uShadow; uniform float uShadowOn; out vec4 o;
${LIGHT_GLSL}
void main() {
  float sh = 1.0;
  if (uShadowOn > 0.5) { vec3 q = vSh.xyz / vSh.w * 0.5 + 0.5; if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) sh = texture(uShadow, vec3(q.xy, q.z - 0.004)); }
  vec3 l = uAmb + uSunCol * 0.78 * (0.35 + 0.65 * sh) + pointLights(vW, vec3(0.0, 1.0, 0.0));
  o = vec4(finish(vCol * uTint.rgb * l, vW), uTint.a);
}`;
const DEPTH_VS = `#version 300 es
in vec3 aPos; uniform mat4 uMVP; uniform mat4 uModel; void main() { gl_Position = uMVP * uModel * vec4(aPos, 1.0); }`;
const DEPTH_FS = `#version 300 es
precision mediump float; out vec4 o; void main() { o = vec4(1.0); }`;
const PT_VS = `#version 300 es
in vec3 aPos; in vec4 aCol; in float aSize; uniform mat4 uMVP; uniform float uScale; out vec4 vCol; out vec3 vW;
void main() { vec4 p = uMVP * vec4(aPos, 1.0); gl_Position = p; gl_PointSize = clamp(aSize * uScale / p.w, 1.0, uScale * 0.03); vCol = aCol; vW = aPos; }`;
const PT_FS = `#version 300 es
precision highp float; in vec4 vCol; in vec3 vW; out vec4 o;
${LIGHT_GLSL}
void main() { if (vCol.a < 0.01) discard; o = vec4(finish(vCol.rgb, vW), vCol.a); }`;
const DEC_VS = `#version 300 es
in vec2 aCorner; in vec4 aInst; in vec4 aInst2; in vec4 aCol; uniform mat4 uMVP; out vec4 vCol; out vec3 vW; out vec2 vQ; out float vKind;
void main() { float c = cos(aInst2.x), s = sin(aInst2.x); vec2 q = aCorner * vec2(aInst.w, aInst.w * aInst2.y);
  vec3 p = vec3(aInst.x + q.x * c - q.y * s, aInst.y + 0.05, aInst.z + q.x * s + q.y * c); vW = p; vQ = aCorner; vCol = aCol; vKind = aInst2.z; gl_Position = uMVP * vec4(p, 1.0); }`;
const DEC_FS = `#version 300 es
precision highp float; in vec4 vCol; in vec3 vW; in vec2 vQ; in float vKind; uniform float uLightK; out vec4 o;
${LIGHT_GLSL}
void main() { float d = length(vQ * 2.0); if (d > 1.0) discard; float a = vCol.a * (1.0 - d * d * 0.3);
  if (vKind > 0.5 && vKind < 1.5) a *= smoothstep(0.6, 0.85, d);            // a ring
  else if (vKind > 1.5) a = vCol.a * (1.0 - smoothstep(0.2, 1.0, d));        // a soft spot
  else if (vKind < -0.5) { vec2 q = abs(vQ * 2.0); if (max(q.x, q.y) > 1.0) discard; a = vCol.a; }   // a square (a divot's turf)
  o = vec4(finish(vCol.rgb * uLightK, vW), a); }`;
const BB_VS = `#version 300 es
in vec2 aCorner; in vec4 aInst; in vec4 aUV; in vec4 aInst2; uniform mat4 uMVP; uniform vec3 uRight; uniform float uTime; out vec2 vUV; out vec3 vW;
void main() { float hop = max(0.0, sin(uTime * 9.0 + aInst2.x * 6.28)) * aInst2.y;
  vec3 p = vec3(aInst.x, aInst.y + hop, aInst.z) + uRight * (aCorner.x - 0.5) * aInst.w * aInst2.z + vec3(0.0, aCorner.y * aInst.w, 0.0);
  vUV = aUV.xy + vec2(aCorner.x, 1.0 - aCorner.y) * aUV.zw; vW = p; gl_Position = uMVP * vec4(p, 1.0); }`;
const BB_FS = `#version 300 es
precision highp float; in vec2 vUV; in vec3 vW; uniform sampler2D uTex; uniform float uLightK; out vec4 o;
${LIGHT_GLSL}
void main() { vec4 c = texture(uTex, vUV); if (c.a < 0.5) discard; o = vec4(finish(c.rgb * uLightK, vW), 1.0); }`;
const HUD_VS = `#version 300 es
out vec2 vUV; void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUV = vec2(p.x, 1.0 - p.y); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
const HUD_FS = `#version 300 es
precision mediump float; in vec2 vUV; uniform sampler2D uTex; uniform vec4 uRect; uniform float uAlpha; out vec4 o;
void main() { vec2 q = (vUV - uRect.xy) / uRect.zw; if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) discard; vec4 c = texture(uTex, q); if (c.a < 0.01) discard; o = vec4(c.rgb, c.a * uAlpha); }`;

const TREE_SCALE = 1.5, GOLFER_H = 4.2, PIN_H = 4.0;   // world sizes: the trees are 24 yards tall (TreeCheck's levels), a golfer ~4

export class Golf3D {
  constructor(canvas, layers) {
    this.canvas = canvas; this.layers = layers;
    const aa = layers.quality !== "lite" && !/[?&]g3daa=0/.test(location.search);   // (Lite: no multisampling)
    const gl = this.gl = canvas.getContext("webgl2", { antialias: aa, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error("no WebGL2");
    this.P = {
      ground: program(gl, GROUND_VS, GROUND_FS), obj: program(gl, OBJ_VS, OBJ_FS), depth: program(gl, DEPTH_VS, DEPTH_FS),
      pt: program(gl, PT_VS, PT_FS), dec: program(gl, DEC_VS, DEC_FS), bb: program(gl, BB_VS, BB_FS), hud: program(gl, HUD_VS, HUD_FS),
    };
    this.meshes = new Map(); this.hole = null; this.time = 0; this.frames = 0;
    this.sky = new SkyBox({ theme: () => this.theme(), hour: () => this.light.hour, horizon: () => [this.horizonY || 0, 2600] });
    this.hud = new HudLayer(gl);
    this.cam = new CameraRig(this);
    this.light = new Lighting(this);
    this.emptyVao = gl.createVertexArray();
    // dynamic buffers: points and decals
    this.ptBuf = { pos: new Float32Array(4096 * 3), col: new Float32Array(4096 * 4), size: new Float32Array(4096), n: 0 };
    this.ptVao = this.dynVao(this.P.pt, { aPos: 3, aCol: 4, aSize: 1 }, 4096);
    this.decals = [];                               // { x, y, z, size, angle, aspect, col[4] } (wear.js)
    this.decVao = this.instVao(this.P.dec, { aInst: 4, aInst2: 4, aCol: 4 }, 2048);
    this.bbVao = this.instVao(this.P.bb, { aInst: 4, aUV: 4, aInst2: 4 }, 2048);
    this.ballMesh = this.sphereMesh();
    this.status = "";
  }
  tagsOf(w) { return tagsOf(w); }
  get lite() { return this.layers.quality === "lite"; }
  on(k) { return this.layers.on(k); }

  // ---- buffers ----
  dynVao(prog, attrs, cap) {
    const gl = this.gl, v = gl.createVertexArray(); gl.bindVertexArray(v); const bufs = {};
    for (const [name, size] of Object.entries(attrs)) {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, cap * size * 4, gl.DYNAMIC_DRAW);
      const loc = prog.a[name]; if (loc !== undefined && loc >= 0) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); }
      bufs[name] = b;
    }
    gl.bindVertexArray(null); return { vao: v, bufs };
  }
  instVao(prog, attrs, cap) {
    const gl = this.gl, d = this.dynVao(prog, attrs, cap);
    gl.bindVertexArray(d.vao);
    for (const name of Object.keys(attrs)) { const loc = prog.a[name]; if (loc !== undefined && loc >= 0) gl.vertexAttribDivisor(loc, 1); }
    const cb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5].map((v, i) => prog === this.P.bb ? v + 0.5 : v)), gl.STATIC_DRAW);
    const loc = prog.a.aCorner; if (loc >= 0) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0); }
    gl.bindVertexArray(null); return d;
  }
  meshFrom(key, make) {                           // a cached body mesh {vao, n}
    let m = this.meshes.get(key);
    if (m) { this.meshes.delete(key); this.meshes.set(key, m); }   // (the least recently used goes first)
    if (!m) {
      const d = make(); if (!d || !d.pos.length) return null;
      m = { ...vao(this.gl, this.P.obj, { aPos: [d.pos, 3], aCol: [d.col, 3] }), n: d.pos.length / 3, dvao: vao(this.gl, this.P.depth, { aPos: [d.pos, 3] }) };
      this.meshes.set(key, m);
      if (this.meshes.size > 400) { const k0 = this.meshes.keys().next().value; const m0 = this.meshes.get(k0); m0.free(); m0.dvao.free(); this.meshes.delete(k0); }
    }
    return m;
  }
  meshOwn(d) { return d && d.pos.length ? { ...vao(this.gl, this.P.obj, { aPos: [d.pos, 3], aCol: [d.col, 3] }), n: d.pos.length / 3, dvao: vao(this.gl, this.P.depth, { aPos: [d.pos, 3] }) } : null; }
  bodyMesh(pic, R = 4, T = 3.6) {                // a sprite picture as a rounded body (voxround.js)
    return this.meshFrom("body:" + picKey(pic) + ":" + R + ":" + T, () => roundedMeshData(pic.rgba, pic.w, pic.h, R, T));
  }
  sphereMesh() {                                   // the ball: a small lit sphere (baked shade), radius 1
    const pos = [], col = [], N = 8;
    const P = (a, b) => [Math.cos(a) * Math.sin(b), Math.cos(b), Math.sin(a) * Math.sin(b)];
    for (let i = 0; i < N * 2; i++) for (let j = 0; j < N; j++) {
      const a0 = i / (N * 2) * 6.283, a1 = (i + 1) / (N * 2) * 6.283, b0 = j / N * 3.1416, b1 = (j + 1) / N * 3.1416;
      for (const p of [P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b0), P(a1, b1), P(a0, b1)]) {
        pos.push(...p); const k = 0.78 + 0.3 * (p[1] * 0.7 + p[0] * -0.3 + p[2] * 0.4); col.push(k, k, k * 1.02);
      }
    }
    const d = { pos: new Float32Array(pos), col: new Float32Array(col) };
    return { ...vao(this.gl, this.P.obj, { aPos: [d.pos, 3], aCol: [d.col, 3] }), n: d.pos.length / 3, dvao: vao(this.gl, this.P.depth, { aPos: [d.pos, 3] }) };
  }

  // ---- the hole: built when the game's hole id changes ----
  theme() {
    const c = this.course ?? 0;
    return ["campus", "campus", "tropics", "desert", "coast", "castle", "campus", "campus"][c] || "campus";
  }
  buildHole(hid, w) {
    const gl = this.gl, t0 = performance.now();
    if (this.hole) this.freeHole();
    const art = new HoleArt(hid); this.decals.length = 0; this.parts = [];
    const pal = art.palette(this.livePal(w));
    const ground = art.paint(pal);
    const trees = extractTrees(art, ground);
    const typeCol = terrainColours(art, ground);
    const hills = this.on("hills");
    const Hc = hills ? buildHeights(art, { iterations: this.lite ? 40 : 160 }) : null;
    const H = heightSampler(Hc);
    const hole = this.hole = { id: hid, art, pal, ground, trees, typeCol, Hc, H, hills };
    hole.mapTex = texture(gl, PX, PX, ground, { mip: false });
    const terr = new Uint8Array(CELLS * CELLS); terr.set(art.terrain);
    hole.terrTex = texture(gl, CELLS, CELLS, terr, { format: "r" });
    // the ground mesh: a grid over the map (4 px apart, 8 on Lite), with a skirt out to the horizon at the edge's height
    const S = this.lite ? 8 : 4, N = PX / S + 1, pos = new Float32Array(N * N * 3), nrm = new Float32Array(N * N * 3);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = i * S, z = j * S, k = (j * N + i) * 3, y = H(x, z);
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      const dx = H(x + 1, z) - H(x - 1, z), dz = H(x, z + 1) - H(x, z - 1), l = Math.hypot(dx, 2, dz);
      nrm[k] = -dx / l; nrm[k + 1] = 2 / l; nrm[k + 2] = -dz / l;
    }
    const idx = new Uint32Array((N - 1) * (N - 1) * 6); let q = 0;
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const a = j * N + i; idx.set([a, a + N, a + 1, a + 1, a + N, a + N + 1], q); q += 6; }
    hole.groundMesh = { ...vao(gl, this.P.ground, { aPos: [pos, 3], aNrm: [nrm, 3] }, idx), n: idx.length, dvao: vao(gl, this.P.depth, { aPos: [pos, 3] }, idx) };
    // the skirt: a ring of quads from the map's edge out (the woods' colour, at the edge's mean height)
    let edgeH = 0; for (let i = 0; i <= 512; i += 8) edgeH += H(i, 0) + H(i, 512) + H(0, i) + H(512, i); edgeH /= 4 * 65;
    this.horizonY = edgeH + 30;
    const F = 6000, sk = [], skn = [];
    const ring = [[0, 0], [512, 0], [512, 512], [0, 512]], far = [[-F, -F], [512 + F, -F], [512 + F, 512 + F], [-F, 512 + F]];
    for (let k = 0; k < 4; k++) {
      const a = ring[k], b = ring[(k + 1) % 4], c = far[(k + 1) % 4], d = far[k];
      for (const p of [a, b, c, a, c, d]) { const ye = p[0] >= 0 && p[0] <= 512 && p[1] >= 0 && p[1] <= 512 ? H(clamp(p[0], 0, 511.9), clamp(p[1], 0, 511.9)) - 0.05 : edgeH; sk.push(p[0], ye, p[1]); skn.push(0, 1, 0); }
    }
    hole.skirt = { ...vao(gl, this.P.ground, { aPos: [new Float32Array(sk), 3], aNrm: [new Float32Array(skn), 3] }), n: sk.length / 3 };
    // the tree bodies
    for (const t of trees) {
      t.mesh = this.meshOwn(roundedMeshData(t.rgba, t.w, t.h, 3, 3.2));   // (owned by the hole, not the cache)
      t.y = H(t.footX, t.footZ);
    }
    this.status = `hole $${hid.toString(16)}: ${trees.length} trees, ${Math.round(performance.now() - t0)} ms`;
    for (const fx of this.layers.fx) if (fx.holeBuilt) fx.holeBuilt(this, hole);
  }
  freeHole() {
    const gl = this.gl, h = this.hole; if (!h) return;
    gl.deleteTexture(h.mapTex); gl.deleteTexture(h.terrTex); if (h.greenTex) gl.deleteTexture(h.greenTex); h.groundMesh.free(); h.groundMesh.dvao.free(); h.skirt.free();
    for (const t of h.trees) if (t.mesh) { t.mesh.free(); t.mesh.dvao.free(); }
    this.hole = null;
  }
  livePal(w) { return w.bgPal; }

  // ---- what the game shows: a hole view, or something else (null: the 2D picture stays) ----
  static taskOn(w, bank, addr) {
    const t = w.wram[0];
    for (let p = 0x1C0; p < 0x200; p += 4) if (t[p] && t[p + 3] === bank && (t[p + 1] | t[p + 2] << 8) === addr) return true;
    return false;
  }
  sceneOf(game) {
    const w = game.w; if (!w.vram || !(w.lcd.lcdc & 0x80)) return null;
    const r6 = w.wram[6], view = r6[0x443];
    if (game.mark === "menus") return null;
    const ballTask = Golf3D.taskOn(w, 0x11, 0x4113), behind = Golf3D.taskOn(w, 0x15, 0x47AD);
    if (view === 4 && behind) return "hole";
    if ((view === 0 || view === 1 || view === 2) && ballTask) return "hole";
    return null;
  }

  // ---- the game's state, read ----
  read(game) {
    const w = game.w, r6 = w.wram[6], w0 = w.wram[0];
    const u16 = (r, a) => r[a] | r[a + 1] << 8, s16 = v => v << 16 >> 16;
    const bx = u16(r6, 0x401) + r6[0x400] / 256, bz = u16(r6, 0x404) + r6[0x403] / 256;
    const bh = s16(u16(r6, 0x407)) + r6[0x406] / 256;
    return {
      view: r6[0x443], hid: r6[0x320], air: r6[0x415], course: w0[0x836],
      ball: [bx / 32, bh / 32, bz / 32],        // world px; y = the height over the ground
      vel: [s16(u16(r6, 0x409)) / 256 / 32, s16(u16(r6, 0x40D)) / 256 / 32, s16(u16(r6, 0x40B)) / 256 / 32],
      cup: [u16(r6, 0x43D) / 32, u16(r6, 0x43F) / 32],
      aim: u16(r6, 0x418) / 65536 * Math.PI * 2,   // from +x toward +z (the map's y)
      scroll: [(u16(w0, 0x320) & 0xFFE0) / 32, (u16(w0, 0x322) & 0xFFE0) / 32],
      green: [r6[0x441] * 8, r6[0x442] * 8],
      golfer: r6[0x332], lefty: !!r6[0x333], player: w0[0x835] & 1, club: r6[0x329], frame: r6[0x467],
      wind: [w0[0x815], w0[0x816] / 256 * Math.PI * 2], mark: game.mark, swing: r6[0x44E],
      hole: w0[0x837], par: 0, stroke: w0[0x8A0 + (w0[0x835] ? 0x40 : 0)],
    };
  }

  // ---- once per game frame (after the game's frame): the effects that follow the play ----
  frame(game) {
    this.frames++;
    const kind = this.sceneOf(game);
    this.kind = kind;
    if (kind !== "hole") { for (const fx of this.layers.fx) if (fx.frame) fx.frame(this, game, null); return; }
    const s = this.read(game); this.s = s;
    if (!this.hole || this.hole.id !== s.hid || this.hole.hills !== this.on("hills")) { this.course = s.course; this.buildHole(s.hid, game.w); }
    this.windVec = [Math.cos(s.wind[1]) * s.wind[0] * 0.6, Math.sin(s.wind[1]) * s.wind[0] * 0.6];
    this.track(game, s);
    // the green's own picture (the putting view's maps, 4x finer): painted in the colours the game shows it in, once it has
    if (s.view === 1 && !this.hole.greenTex && !game.w.high[0x1A2] && !game.w.high[0x1BC] && this.hole.art.green.tiles.length) {
      const img = this.hole.art.paintGreen(game.w.bgPal);
      this.hole.greenTex = texture(this.gl, PX, PX, img); this.hole.greenAt = [s.green[0], s.green[1]];
    }
    for (const fx of this.layers.fx) if (fx.frame) fx.frame(this, game, s);
  }
  // the golfer's spot: at the ball until a swing sends it off; kept there through the flight and the roll
  track(game, s) {
    const H = this.hole.H, w = game.w;
    if (s.mark !== this.lastMark && (s.mark === "pick" || s.mark === "shotsetup" || s.mark === "aimmenu" || s.mark === "hole")) this.inShot = false;
    if (s.swing) this.inShot = true;              // the swing meter runs: the golfer stays where he swings from
    if (!this.inShot) { this.golferAt = [s.ball[0], s.ball[2]]; this.golferAim = s.aim; }
    if (s.mark === "hole" || !this.teeAt) this.teeAt = [s.ball[0], s.ball[2]];
    this.lastMark = s.mark;
    // the golfer's picture: the big frame of the swing in view 4, the address pose otherwise
    if (s.view === 4) { this.golferFrameNo = s.frame; this.golferPal = w.objPal.slice(); }
    else if (!this.golferPal) this.golferPal = w.objPal;
    if (s.mark === "aimmenu" || s.mark === "pick") this.golferFrameNo = 0;
    this.ballGround = H(s.ball[0], s.ball[2]);
    this.watch(game, s);
  }

  // the shot's events this frame (this.events: [kind, data]) from what the game's state did: launch (the ball left its spot after
  // a swing), land (the first touch-down: the terrain under it), bounce, roll, stop (the shot's outcome, from the page's shot list:
  // 0 fairway, 1 rough, 2 bunker, 3 water, 6 green, 7 out of bounds, 9 semi-rough, $80 holed), hole (a new hole)
  watch(game, s) {
    const ev = this.events = [], W = this.wst || (this.wst = { air: 0, rest: true, shots: game.shots ? game.shots.length : 0, hid: -1, prev: null, flight: null });
    const terr = this.hole.art.terrainAtPx(s.ball[0], s.ball[2]);
    if (W.hid !== s.hid) { W.hid = s.hid; ev.push(["hole", { hid: s.hid }]); W.prev = null; W.flight = null; }
    const p = s.ball, moved = W.prev && Math.hypot(p[0] - W.prev[0], p[2] - W.prev[2]) > 0.001;
    if (W.rest && moved && this.inShot) { W.rest = false; W.flight = { from: W.prev.slice(), club: s.club, mode: game.w.wram[6][0x32A], terr: this.hole.art.terrainAtPx(W.prev[0], W.prev[2]), maxH: 0, frames: 0, path: [] };
      ev.push(["launch", { at: W.prev.slice(), club: s.club, aim: s.aim, terr: W.flight.terr, mode: W.flight.mode, air: s.air }]); }
    if (W.flight) { W.flight.frames++; W.flight.maxH = Math.max(W.flight.maxH, p[1]); if (W.flight.frames < 2400) W.flight.path.push([p[0], p[1], p[2], s.air, s.view]); }
    if (W.air && !s.air) ev.push([W.landed ? "bounce" : "land", { at: p.slice(), terr, vel: s.vel.slice() }]), W.landed = true;
    if (!W.air && s.air && W.landed) { /* back in the air: a bounce */ }
    if (game.shots && game.shots.length !== W.shots) {
      W.shots = game.shots.length; const out = game.shots[W.shots - 1];
      ev.push(["stop", { at: p.slice(), outcome: out, flight: W.flight, cup: s.cup.slice() }]);
      W.rest = true; W.landed = false; W.lastFlight = W.flight; W.flight = null;
    }
    W.air = s.air; W.prev = p.slice();
    this.lastEvents = ev.length ? ev : this.lastEvents;
  }
  // ---- particles: a shared pool the effects fill (spawn) and the scene moves (gravity, drag, the wind) and draws as points ----
  spawn(p) { const P = this.parts || (this.parts = []); if (P.length < (this.lite ? 900 : 3000)) P.push(p); }
  moveParticles(dt) {
    const P = this.parts; if (!P || !P.length) return;
    const H = this.hole.H, wv = this.windVec || [0, 0];
    let j = 0;
    for (let i = 0; i < P.length; i++) {
      const q = P[i]; q.t += dt; if (q.t >= q.life) continue;
      const k = q.drag ?? 0.5, wk = q.wind ?? 0;
      q.vx += (wv[0] * wk - q.vx * k) * dt; q.vz += (wv[1] * wk - q.vz * k) * dt; q.vy -= (q.g ?? 30) * dt; q.vy -= q.vy * k * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      const gy = H(q.x, q.z) + (q.floor ?? 0.05); if (q.y < gy) { q.y = gy; q.vy = q.bounce ? -q.vy * q.bounce : 0; q.vx *= 0.6; q.vz *= 0.6; if (q.stick) q.life = Math.min(q.life, q.t + q.stick); }
      const a = (q.a ?? 1) * (q.fade === false ? 1 : Math.min(1, (q.life - q.t) / Math.min(0.4, q.life * 0.5)));
      const c = q.c; this.point(q.x, q.y, q.z, c[0], c[1], c[2], a, q.size * (q.grow ? 1 + q.grow * q.t : 1));
      P[j++] = q;
    }
    P.length = j;
  }
  // ---- once per display frame ----
  render(game, frame2d) {
    const gl = this.gl, c = this.canvas;
    const now = performance.now() / 1000, dt = Math.min(0.1, this.lastT ? now - this.lastT : 0.016); this.lastT = now; this.time += dt;
    this.dt = dt; this.game = game; this.frame2d = frame2d;
    const held = this.hole && this.s && this.layers.fx.some(f => f.holdsScene && f.holdsScene(this, game));
    this.held = held && this.kind !== "hole";
    if ((this.kind !== "hole" && !held) || !this.hole || !this.s) {
      this.lastT2 = now;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, c.width, c.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      for (const fx of this.layers.fx) if (fx.drawOther && fx.drawOther(this, game, frame2d, dt)) return true;
      return false;
    }
    const W = c.width, H = c.height; gl.viewport(0, 0, W, H);
    const s = this.s, hole = this.hole;
    this.light.update(s, dt);
    const cam = this.cam.update(s, dt, W / H);
    this.view = cam.view; this.proj = cam.proj; this.mvp = m4.mul(cam.proj, cam.view); this.eye = cam.eye;
    this.fade = fadeOf(game.w, this);
    for (const fx of this.layers.fx) if (fx.update) fx.update(this, game, s, dt);
    // the shadow map (sun shadows)
    const shadowOn = this.light.shadows && this.light.beginShadow(cam.focus);
    if (shadowOn) { this.drawCasters(this.light.shadowMVP); this.light.endShadow(); gl.viewport(0, 0, W, H); }
    this.shadowOn = shadowOn;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.drawWorld();
    for (const fx of this.layers.fx) if (fx.draw) fx.draw(this, dt);
    this.moveParticles(dt);
    this.flushPoints();
    for (const fx of this.layers.fx) if (fx.drawOverlay) fx.drawOverlay(this);
    // the game's HUD over the picture (not while an effect holds the hole on screen after the game has left it)
    if (!this.held && !this.replaying && !globalThis.__golfAttractPlay) this.hud.draw(this, game, frame2d);   // (MTenn3D's game picker: no HUD, play.js ATTRACT)
    for (const fx of this.layers.fx) if (fx.drawInset) fx.drawInset(this);
    return true;
  }
  drawWorld() {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (this.on("sky")) this.sky.draw(gl, this.mvp);
    else { gl.clearColor(...this.light.fogCol, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
    this.drawGround();
    for (const fx of this.layers.fx) if (fx.drawGround) fx.drawGround(this);
    this.drawDecals();
    this.drawBodies();
  }
  // a second picture of the hole in a corner of the view (rect: x, y, w, h as parts of the canvas, from the bottom left), from its own
  // camera; the main picture's camera is put back after
  renderInset(rect, eye, at, fov, before = null) {
    const gl = this.gl, c = this.canvas, W = c.width, H = c.height;
    const x = Math.round(rect[0] * W), y = Math.round(rect[1] * H), w = Math.round(rect[2] * W), h = Math.round(rect[3] * H);
    const keep = { view: this.view, proj: this.proj, mvp: this.mvp, eye: this.eye, camEye: this.cam.eye, decNow: this.decNow };
    this.view = m4.lookAt(eye, at, [0, 1, 0]); this.proj = m4.perspective(fov, w / h, 0.2, 9000); this.mvp = m4.mul(this.proj, this.view); this.eye = eye; this.cam.eye = eye;
    gl.enable(gl.SCISSOR_TEST); gl.scissor(x, y, w, h); gl.viewport(x, y, w, h);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (before) before();
    this.decNow = []; this.drawWorld(); this.flushPoints();
    gl.disable(gl.SCISSOR_TEST); gl.viewport(0, 0, W, H);
    Object.assign(this, { view: keep.view, proj: keep.proj, mvp: keep.mvp, eye: keep.eye, decNow: keep.decNow }); this.cam.eye = keep.camEye;
  }

  // ---- light uniforms shared by the programs ----
  setLight(p) {
    const gl = this.gl, L = this.light, u = p.u;
    gl.uniform3fv(u.uSunDir, L.sunDir); gl.uniform3fv(u.uSunCol, L.sunCol); gl.uniform3fv(u.uAmb, L.amb);
    gl.uniform3fv(u.uFogCol, L.fogCol); gl.uniform1f(u.uFogNear, L.fogNear); gl.uniform1f(u.uFogFar, L.fogFar); gl.uniform1f(u.uNight, L.night);
    gl.uniform3fv(u.uEye, this.eye); gl.uniform4fv(u.uLights, L.lights); gl.uniform3fv(u.uLightCol, L.lightCols);
    gl.uniform4fv(u.uFade, this.fade);
  }
  bindShadow(p, unit) {
    const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.light.depthTex || this.light.dummyDepth(gl)); gl.uniform1i(p.u.uShadow, unit);
    gl.uniform1f(p.u.uShadowOn, this.shadowOn ? 1 : 0); gl.uniformMatrix4fv(p.u.uShadowMVP, false, this.light.shadowMVP || m4.identity());
  }
  drawGround() {
    const gl = this.gl, p = this.P.ground, h = this.hole; gl.useProgram(p.p); this.setLight(p);
    gl.uniformMatrix4fv(p.u.uMVP, false, this.mvp);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, h.mapTex); gl.uniform1i(p.u.uMap, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, h.terrTex); gl.uniform1i(p.u.uTerr, 1);
    this.bindShadow(p, 2);
    gl.uniform3fv(p.u.uTypeCol, h.typeCol); gl.uniform1f(p.u.uDetail, this.on("terrain") ? 1 : 0); gl.uniform1f(p.u.uTime, this.time);
    gl.uniform2fv(p.u.uWind, this.windVec || [0, 0]); gl.uniform3fv(p.u.uSkyCol, this.light.skyCol || [0.6, 0.75, 0.95]);
    gl.uniform1f(p.u.uLite, this.lite ? 1 : 0); gl.uniform1f(p.u.uSkirt, 0);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, h.greenTex || h.mapTex); gl.uniform1i(p.u.uGreen, 3);
    gl.uniform4fv(p.u.uGreenRect, h.greenTex ? [h.greenAt[0], h.greenAt[1], 40, 32] : [0, 0, 0, 0]);
    gl.bindVertexArray(h.groundMesh.vao); gl.drawElements(gl.TRIANGLES, h.groundMesh.n, gl.UNSIGNED_INT, 0);
    gl.uniform1f(p.u.uSkirt, 1);
    gl.bindVertexArray(h.skirt.vao); gl.drawArrays(gl.TRIANGLES, 0, h.skirt.n);
    gl.bindVertexArray(null);
  }
  // the bodies standing on the hole, each [mesh, model matrix, tint]
  bodies() {
    const s = this.s, h = this.hole, out = [], H = h.H, cam = this.cam;
    const face = cam.yawToEye;                       // a body turns to face the camera (about the vertical)
    for (const t of h.trees) if (t.mesh) out.push([t.mesh, m4.tsy(t.footX, t.y, t.footZ, TREE_SCALE, TREE_SCALE, TREE_SCALE * 0.9, face(t.footX, t.footZ)), null, "tree"]);
    // the golfer
    if (this.golferAt && this.golferPal) {
      const g = this.golferAt, sh = this.golferShown || (this.golferShown = g.slice()), dd = Math.hypot(g[0] - sh[0], g[1] - sh[1]), step = 40 * (this.dt || 0.016);
      if (dd > 160 || dd <= step) { sh[0] = g[0]; sh[1] = g[1]; } else { sh[0] += (g[0] - sh[0]) / dd * step; sh[1] += (g[1] - sh[1]) / dd * step; }
      const walking = dd > step;
      const pic = golferFrame(s.golfer, this.golferFrameNo || 0, this.golferPal, s.player, s.lefty);
      if (pic) {
        const m = this.bodyMesh(pic, 4, 3.6), k = GOLFER_H / pic.h;
        // the picture's ball spot (x $4F.5 on the game's screen) sits at the ball: the body is shifted across the aim by the rest
        const [gx, gz] = this.golferShown, a = walking ? Math.atan2(g[1] - sh[1], g[0] - sh[0]) : this.golferAim, off = (pic.x0 + pic.w / 2 - 0x50) * k;
        const rx = -Math.sin(a), rz = Math.cos(a);   // across the aim (the picture's right, seen from behind)
        const x = gx + rx * off - Math.cos(a) * 0.6, z = gz + rz * off - Math.sin(a) * 0.6;
        const yaw = Math.atan2(-Math.cos(a), -Math.sin(a));   // the picture faces back along the aim
        if (m) out.push([m, m4.tsy(x, H(x, z), z, k, k, k, cam.golferYaw(yaw, x, z)), null, "golfer"]);
      }
    }
    this.worldMarks(out);
    // the pin and its flag
    const [cx, cz] = s.cup, cy = H(cx, cz);
    const wv = this.windVec || [0, 0], flagYaw = Math.hypot(wv[0], wv[1]) > 0.1 ? Math.atan2(-wv[1], wv[0]) + 0.15 * Math.sin(this.time * 7) : face(cx, cz) - Math.PI / 2;
    out.push([this.pinMesh(), m4.tsy(cx, cy, cz, 1, 1, 1, flagYaw), null, "pin"]);
    // the ball (kept at least ~2 screen pixels wide)
    const b = this.ballWorld(), d = Math.hypot(b[0] - this.eye[0], b[1] - this.eye[1], b[2] - this.eye[2]);
    const r = Math.max(0.2, d * 0.0042 * (this.cam.fovK || 1));
    if (!this.hideBall) out.push([this.ballMesh, m4.tsy(b[0], b[1] + r * 0.7, b[2], r, r, r), [1, 1, 1, 1], "ball"]);
    for (const fx of this.layers.fx) if (fx.bodies) fx.bodies(this, out);
    return out;
  }
  // the marks the game draws on the course as sprites (bank 11, the ball display task 11:4113), stood up in 3D from their own tiles in
  // VRAM: the target marker ($D426 / $D428, tile $3A), the landing preview's spot ($D374 / $D377, $3E), the other player's ball
  // ($D41E / $D420, $78), the look cursor ($D422 / $D424, $2C); only while the game shows them
  worldMarks(out) {
    const w = this.game && this.game.w; if (!w) return;
    const r6 = w.wram[6], t = this.tagsOf(w), H = this.hole.H, u16 = a => r6[a] | r6[a + 1] << 8, seen = new Map();
    for (let i = 0; i < 40; i++) if (t[i] === 0x11 && w.oam[i * 4]) seen.set(w.oam[i * 4 + 2], w.oam[i * 4 + 3]);
    const stand = (tile, ax, az, h, bob = 0) => {
      const pic = this.spritePic(w, tile, seen.get(tile)); if (!pic) return;
      const x = u16(ax) / 32, z = u16(az) / 32, m = this.bodyMesh(pic, 2, 1.5), k = h / pic.h;
      if (m) out.push([m, m4.tsy(x, H(x, z) + bob, z, k, k, k, this.cam.yawToEye(x, z)), null, "mark"]);
    };
    const mk = this.s.view === 0 ? 1 : 0.35;
    if (seen.has(0x3A)) stand(0x3A, 0x426, 0x428, 5 * mk, 0.3 + 0.3 * Math.sin(this.time * 5));
    if (seen.has(0x2C)) stand(0x2C, 0x422, 0x424, 4 * mk, 1 + 0.5 * Math.sin(this.time * 6));
    if (seen.has(0x3E)) { const x = u16(0x374) / 32, z = u16(0x377) / 32; this.decal(x, H(x, z), z, 1.6 + 0.3 * Math.sin(this.time * 8), 0, 1, [1, 1, 1, 0.55], true); }
    if (seen.has(0x78)) { const x = u16(0x41E) / 32, z = u16(0x420) / 32, r = 0.3; out.push([this.ballMesh, m4.tsy(x, H(x, z) + r * 0.7, z, r, r, r), [1, 0.95, 0.8, 1], "ball2"]); }
  }
  // an 8 x 16 sprite from the game's VRAM (tile, OAM attribute: bank bit 3, OBJ palette), as a picture
  spritePic(w, tile, attr, full = false) {
    const bank = w.vram[attr & 8 ? 1 : 0], pal = w.objPal, rgba = new Uint8Array(8 * 16 * 4); let any = false, key = (attr & 15) + ":";
    for (let y = 0; y < 16; y++) {
      const o = ((tile & 0xFE) << 4) + y * 2, lo = bank[o], hi = bank[o + 1]; key += lo + "," + hi + ";";
      for (let x = 0; x < 8; x++) { const ci = ((lo >> (7 - x)) & 1) | (((hi >> (7 - x)) & 1) << 1); if (!ci) continue; any = true;
        const p = (attr & 7) * 8 + ci * 2, c = pal[p] | pal[p + 1] << 8, q = (y * 8 + x) * 4; rgba[q] = (c & 31) << 3; rgba[q + 1] = ((c >> 5) & 31) << 3; rgba[q + 2] = ((c >> 10) & 31) << 3; rgba[q + 3] = 255; }
    }
    if (!any) return null;
    let top = 0, bot = 15; const row = y => { for (let x = 0; x < 8; x++) if (rgba[(y * 8 + x) * 4 + 3]) return true; return false; };
    while (!row(bot)) bot--; while (!row(top)) top++;
    return { rgba: rgba.slice(top * 32, (bot + 1) * 32), w: 8, h: bot - top + 1, full: rgba };
  }
  ballWorld() { const b = this.ballOverride || this.s.ball; return [b[0], this.hole.H(b[0], b[2]) + Math.max(-0.6, b[1]), b[2]]; }
  drawBodies() {
    const gl = this.gl, p = this.P.obj; gl.useProgram(p.p); this.setLight(p); this.bindShadow(p, 2);
    gl.uniformMatrix4fv(p.u.uMVP, false, this.mvp);
    const list = this.bodies(); this.lastBodies = list;
    for (const [m, model, tint] of list) {
      gl.uniformMatrix4fv(p.u.uModel, false, model); gl.uniform4fv(p.u.uTint, tint || [1, 1, 1, 1]);
      gl.bindVertexArray(m.vao); gl.drawArrays(gl.TRIANGLES, 0, m.n);
    }
    // the ball's shadow on the ground under it (a dark spot; the sun's shadow too when LIGHT is on)
    const b = this.ballWorld(), gy = this.hole.H(b[0], b[2]), up = Math.max(0, b[1] - gy);
    this.decal(b[0], gy, b[2], 0.9 + up * 0.04, 0, 1, [0, 0, 0, Math.max(0.15, 0.6 - up * 0.02)], true, 2);
    gl.bindVertexArray(null);
  }
  drawCasters(mvp) {
    const gl = this.gl, p = this.P.depth; gl.useProgram(p.p); gl.uniformMatrix4fv(p.u.uMVP, false, mvp);
    gl.uniformMatrix4fv(p.u.uModel, false, m4.identity());
    if (this.hole.Hc) { gl.bindVertexArray(this.hole.groundMesh.dvao.vao); gl.drawElements(gl.TRIANGLES, this.hole.groundMesh.n, gl.UNSIGNED_INT, 0); }
    for (const [m, model] of this.bodies()) { if (!m.dvao) continue; gl.uniformMatrix4fv(p.u.uModel, false, model); gl.bindVertexArray(m.dvao.vao); gl.drawArrays(gl.TRIANGLES, 0, m.n); }
    gl.bindVertexArray(null);
  }
  // the pin: a white pole and the flag (the flag's colour: the game's pin sprite, read from VRAM in the course view when it can)
  pinMesh() {
    return this.meshFrom("pin:" + (this.flagCol || "r"), () => {
      const w = 6, h = 32, rgba = new Uint8Array(w * h * 4), fc = this.flagCol || [232, 40, 40];
      const px = (x, y, c) => { const o = (y * w + x) * 4; rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255; };
      for (let y = 0; y < h; y++) px(0, y, y % 8 < 4 ? [250, 250, 250] : [210, 210, 214]);
      for (let y = 0; y < 8; y++) for (let x = 1; x < w; x++) if (x - 1 < 5 - Math.abs(y - 3.5) * 0.4) px(x, y, y < 4 ? fc : fc.map(v => v * 0.8));
      const d = roundedMeshData(rgba, w, h, 1, 0.6), k = PIN_H / h;
      for (let i = 0; i < d.pos.length; i += 3) { d.pos[i] = (d.pos[i] + w / 2 - 0.5) * k; d.pos[i + 1] *= k; d.pos[i + 2] *= k * 0.5; }
      return d;
    });
  }
  // ---- particles (layers push points each display frame) ----
  point(x, y, z, r, g, b, a, size) {
    const P = this.ptBuf; if (P.n >= 4096) return; const i = P.n++;
    P.pos[i * 3] = x; P.pos[i * 3 + 1] = y; P.pos[i * 3 + 2] = z; P.col[i * 4] = r; P.col[i * 4 + 1] = g; P.col[i * 4 + 2] = b; P.col[i * 4 + 3] = a; P.size[i] = size;
  }
  flushPoints() {
    const gl = this.gl, P = this.ptBuf; if (!P.n) return;
    const p = this.P.pt; gl.useProgram(p.p); this.setLight(p);
    gl.uniformMatrix4fv(p.u.uMVP, false, this.mvp); gl.uniform1f(p.u.uScale, this.canvas.height * 0.9);
    gl.bindVertexArray(this.ptVao.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ptVao.bufs.aPos); gl.bufferSubData(gl.ARRAY_BUFFER, 0, P.pos.subarray(0, P.n * 3));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ptVao.bufs.aCol); gl.bufferSubData(gl.ARRAY_BUFFER, 0, P.col.subarray(0, P.n * 4));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ptVao.bufs.aSize); gl.bufferSubData(gl.ARRAY_BUFFER, 0, P.size.subarray(0, P.n));
    gl.depthMask(false); gl.drawArrays(gl.POINTS, 0, P.n); gl.depthMask(true);
    gl.bindVertexArray(null); P.n = 0;
  }
  // ---- decals on the ground (wear, shadows): this frame's list plus the kept ones ----
  decal(x, y, z, size, angle, aspect, col, now = false, kind = 0) { (now ? (this.decNow || (this.decNow = [])) : this.decals).push({ x, y, z, size, angle, aspect, col, kind }); }
  drawDecals() {
    const list = (this.on("wear") ? this.decals : []).concat(this.decNow || []); this.decNow = [];
    if (!list.length) return;
    const gl = this.gl, p = this.P.dec, n = Math.min(list.length, 2048);
    const a = new Float32Array(n * 4), b = new Float32Array(n * 4), c = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { const d = list[list.length - n + i]; a.set([d.x, d.y, d.z, d.size], i * 4); b.set([d.angle, d.aspect, d.kind || 0, 0], i * 4); c.set(d.col, i * 4); }
    gl.useProgram(p.p); this.setLight(p); gl.uniformMatrix4fv(p.u.uMVP, false, this.mvp); gl.uniform1f(p.u.uLightK, this.light.groundK || 1);
    gl.bindVertexArray(this.decVao.vao);
    for (const [k, arr] of [["aInst", a], ["aInst2", b], ["aCol", c]]) { gl.bindBuffer(gl.ARRAY_BUFFER, this.decVao.bufs[k]); gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr); }
    gl.depthMask(false); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -2);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    gl.disable(gl.POLYGON_OFFSET_FILL); gl.depthMask(true); gl.bindVertexArray(null);
  }
  // ---- billboards (the gallery): inst = [x, y, z, height], uv = [u, v, du, dv], inst2 = [phase, hop, aspect, 0] ----
  drawBillboards(tex, inst, uv, inst2, n) {
    if (!n) return;
    const gl = this.gl, p = this.P.bb; gl.useProgram(p.p); this.setLight(p);
    gl.uniformMatrix4fv(p.u.uMVP, false, this.mvp); gl.uniform1f(p.u.uTime, this.time); gl.uniform1f(p.u.uLightK, this.light.groundK || 1);
    const v = this.view; gl.uniform3fv(p.u.uRight, [v[0], v[4], v[8]]);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(p.u.uTex, 0);
    gl.bindVertexArray(this.bbVao.vao);
    for (const [k, arr] of [["aInst", inst], ["aUV", uv], ["aInst2", inst2]]) { gl.bindBuffer(gl.ARRAY_BUFFER, this.bbVao.bufs[k]); gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr.subarray(0, n * 4)); }
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n); gl.bindVertexArray(null);
  }
  drawMeshAt(m, model, tint = [1, 1, 1, 1]) {
    const gl = this.gl, p = this.P.obj; gl.useProgram(p.p); this.setLight(p); this.bindShadow(p, 2);
    gl.uniformMatrix4fv(p.u.uMVP, false, this.mvp); gl.uniformMatrix4fv(p.u.uModel, false, model); gl.uniform4fv(p.u.uTint, tint);
    gl.bindVertexArray(m.vao); gl.drawArrays(gl.TRIANGLES, 0, m.n); gl.bindVertexArray(null);
  }
  // the screen pixel (0..160, 0..144 of the game's screen) of a world point, or null behind the camera
  toScreen(p) { const q = m4.apply(this.mvp, [p[0], p[1], p[2], 1]); if (q[3] <= 0) return null; return [(q[0] / q[3] * 0.5 + 0.5) * 160, (0.5 - q[1] / q[3] * 0.5) * 144, q[3]]; }
}

// the screen's fade (hFadeState $FFA2, the level $FFA4, hScreenFadedOut $FFBC): [r, g, b, amount] for the 3D picture
export function fadeOf(w, keep) {
  const h = w.high, st = h[0x1A2], lv = h[0x1A4];
  if (st & 0x80) keep.fadeWhite = true; else if (st) keep.fadeWhite = false;
  let k = 0;
  if (st & 1) k = 1 - lv / 0x7C; else if (st & 2) k = lv / 0x7C; else if (h[0x1BC]) k = 1;
  const c = keep.fadeWhite ? 1 : 0;
  return [c, c, c, clamp(k, 0, 1)];
}
export { lerp, gbc, T };
