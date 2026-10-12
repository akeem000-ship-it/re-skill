// 3D "diorama" renderer for the running game (task: VoxelMod-style view). While a court map is loaded
// the court tilemap is un-projected through the game's own fixed projection (ProjectPoint, camera.js)
// onto a flat ground plane, every OAM sprite becomes an upright billboard standing at the world point
// its feet un-project to, the ball is lifted to its true height from RAM (wC400/04/08) with a shadow at
// its ground point, the net is a procedural mesh, and a free perspective camera does the foreshortening.
// HUD sprites (outside the court) are drawn in screen space. Other scenes fall back to the 2D frame.
import { project } from "./camera.js";
import { courtTilemaps } from "./assets.js";

const VS = `#version 300 es
in vec2 aPos; in vec2 aUV; uniform mat4 uMVP; uniform mat4 uModel; uniform vec4 uUVRect; out vec2 vUV;
void main() { vUV = uUVRect.xy + aUV * uUVRect.zw; gl_Position = uMVP * uModel * vec4(aPos, 0.0, 1.0); }`;
const FS = `#version 300 es
precision mediump float; in vec2 vUV; uniform sampler2D uTex; uniform vec4 uTint; uniform float uAlphaTest; out vec4 o;
void main() { vec4 c = texture(uTex, vUV) * uTint; if (c.a < uAlphaTest) discard; o = c; }`;

const VS3 = `#version 300 es
in vec3 aPos3; in vec2 aUV3; uniform mat4 uMVP; out vec2 vUV;
void main() { vUV = aUV3; gl_Position = uMVP * vec4(aPos3, 1.0); }`;

// --- small matrix helpers (column-major Float32Array(16)) ---
const m4 = {
  identity: () => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]),
  mul(a, b) { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; },
  perspective(fov, aspect, n, f) { const t = 1 / Math.tan(fov / 2); const o = new Float32Array(16); o[0] = t / aspect; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o; },
  ortho(l, r, b, t, n, f) { const o = new Float32Array(16); o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n); o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1; return o; },
  lookAt(eye, at, up) {
    const z = norm(sub(eye, at)), x = norm(cross(up, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  },
  // translate + scale + optional rotation about X (tilt) and Y (yaw)
  trs(tx, ty, tz, sx, sy, tiltX = 0, yawY = 0) {
    const cx = Math.cos(tiltX), sxn = Math.sin(tiltX), cy = Math.cos(yawY), syn = Math.sin(yawY);
    // columns: X axis, Y axis, Z axis, translation
    return new Float32Array([sx * cy, 0, -sx * syn, 0,  sy * syn * sxn, sy * cx, sy * cy * sxn, 0,  0, 0, 1, 0,  tx, ty, tz, 1]);
  },
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

const COURT_IDS = new Set([0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
const WORLD = { x0: -1024, x1: 1024, y0: -2048, y1: 2048, texel: 4 };   // ground texture coverage (world units)

export class Voxel3D {
  constructor(canvas, gb, rom = null) {
    this.cv = canvas; this.gb = gb; this.courtMaps = rom ? courtTilemaps(rom) : null; this.courtId = -1; this.detectAt = 0;
    const gl = this.gl = canvas.getContext("webgl2", { alpha: false, antialias: true });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.prog = this.link(VS, FS);
    this.u = {}; for (const n of ["uMVP", "uModel", "uUVRect", "uTex", "uTint", "uAlphaTest"]) this.u[n] = gl.getUniformLocation(this.prog, n);
    this.prog3 = this.link(VS3, FS, ["aPos3", "aUV3"]);
    this.u3 = {}; for (const n of ["uMVP", "uTex", "uTint", "uAlphaTest"]) this.u3[n] = gl.getUniformLocation(this.prog3, n);
    this.field = { mapId: -1, floorTex: null, walls: null, wallCount: 0, palHash: 0 };
    const quad = new Float32Array([-0.5, 0, 0, 1,  0.5, 0, 1, 1,  -0.5, 1, 0, 0,  0.5, 1, 1, 0]);   // x, y(0..1 up), u, v
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    this.spriteTex = new Map(); this.groundTex = null; this.groundHash = -1; this.frameTex = null;
    this.shadowTex = this.solidTexture([0, 0, 0, 110]); this.netTex = this.makeNetTexture();
    this.cam = { yaw: 0, pitch: 0.9, dist: 3100, targetY: 250 };
    this.mode = "none";
    this.bindCameraControls();
  }
  link(vs, fs, attrs = ["aPos", "aUV"]) {
    const gl = this.gl, mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, attrs[0]); gl.bindAttribLocation(p, 1, attrs[1]); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  texture(w, h, data, linear = false) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    const f = linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  solidTexture(rgba) { return this.texture(1, 1, new Uint8Array(rgba)); }
  makeNetTexture() {
    const w = 64, h = 16, d = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4, mesh = (x % 4 === 0) || (y % 4 === 0), tape = y < 2; d[o] = tape ? 240 : 40; d[o + 1] = tape ? 240 : 40; d[o + 2] = tape ? 240 : 60; d[o + 3] = tape ? 255 : mesh ? 200 : 40; }
    return this.texture(w, h, d);
  }

  // ---- game state helpers ----
  col5(pal, p, i) { const o = p * 8 + i * 2, c = pal[o] | (pal[o + 1] << 8); return [(c & 31) * 8, ((c >> 5) & 31) * 8, ((c >> 10) & 31) * 8]; }
  // a court is loaded when the BG tilemap in VRAM is one of the court maps (checked every 20 frames)
  mapId() { return this.gb.mem.wram[0][0x32E]; }                       // wCurMapID: 0-15 courts, 17-36 RPG areas
  isField() { const id = this.mapId(); return id >= 17 && id <= 36 && !(this.gb.ppu.lcdc & 0x08) === false || (id >= 17 && id <= 36); }
  isCourt() {
    if (!this.courtMaps || this.mapId() > 15) return false;
    const fr = this.gb.ppu.frames; if (fr < this.detectAt) return this.courtId >= 0;
    this.detectAt = fr + 20;
    const v0 = this.gb.mem.vram[0], base = this.gb.ppu.lcdc & 0x08 ? 0x1C00 : 0x1800;
    this.courtId = -1;
    for (const [id, m] of Object.entries(this.courtMaps)) {
      let same = 0; for (let i = 0; i < 1024; i += 3) if (v0[base + i] === m[i]) same++;
      if (same > 300) { this.courtId = +id; break; }
    }
    return this.courtId >= 0;
  }
  // sprite tile (8 rows) as RGBA, colour 0 transparent
  spriteTexture(tile, bank, pal, flipX, flipY) {
    const key = tile | (bank << 9) | (pal << 10) | (flipX << 13) | (flipY << 14);
    let t = this.spriteTex.get(key); if (t) return t;
    const v = this.gb.mem.vram[bank], d = new Uint8Array(8 * 8 * 4), op = this.gb.ppu.objPal;
    for (let y = 0; y < 8; y++) {
      const row = flipY ? 7 - y : y, lo = v[tile * 16 + row * 2], hi = v[tile * 16 + row * 2 + 1];
      for (let x = 0; x < 8; x++) { const bit = flipX ? x : 7 - x, ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1), o = (y * 8 + x) * 4; if (!ci) continue; const c = this.col5(op, pal, ci); d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255; }
    }
    t = this.texture(8, 8, d); this.spriteTex.set(key, t);
    if (this.spriteTex.size > 4000) { for (const tx of this.spriteTex.values()) this.gl.deleteTexture(tx); this.spriteTex.clear(); }
    return t;
  }
  // the BG tilemap (256x256) as RGBA, CGB attributes applied
  composeBG() {
    const m = this.gb.mem, p = this.gb.ppu, v0 = m.vram[0], v1 = m.vram[1], lcdc = p.lcdc;
    const mapBase = lcdc & 0x08 ? 0x1C00 : 0x1800, img = new Uint8Array(256 * 256 * 4);
    for (let ty = 0; ty < 32; ty++) for (let tx = 0; tx < 32; tx++) {
      const i = mapBase + ty * 32 + tx, tile = v0[i], attr = v1[i], bank = attr & 8 ? v1 : v0;
      const addr = lcdc & 0x10 ? tile << 4 : 0x1000 + ((tile << 24 >> 24) << 4);
      for (let y = 0; y < 8; y++) {
        const row = attr & 0x40 ? 7 - y : y, lo = bank[addr + row * 2], hi = bank[addr + row * 2 + 1];
        for (let x = 0; x < 8; x++) {
          const bit = attr & 0x20 ? x : 7 - x, ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1), c = this.col5(p.bgPal, attr & 7, ci);
          const o = ((ty * 8 + y) * 256 + tx * 8 + x) * 4; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; img[o + 3] = 255;
        }
      }
    }
    return img;
  }
  bgHash() { const m = this.gb.mem, v0 = m.vram[0], v1 = m.vram[1]; let h = 0; for (let i = 0x1800; i < 0x1C00; i += 3) h = (h * 31 + v0[i] + v1[i] * 7) | 0; for (let i = 0; i < 64; i += 5) h = (h * 31 + this.gb.ppu.bgPal[i]) | 0; return h; }
  // un-project the court tilemap onto the ground plane: ground texel (X, Y) <- BG pixel ((0x1010 + xp) / 32, (0x1010 + pp) / 32)
  // (the camera scroll cancels out: the BG pixel of a world point does not depend on SCX/SCY)
  buildGround() {
    const bg = this.composeBG(), W = (WORLD.x1 - WORLD.x0) / WORLD.texel, H = (WORLD.y1 - WORLD.y0) / WORLD.texel, d = new Uint8Array(W * H * 4);
    for (let j = 0; j < H; j++) {
      const Y = WORLD.y0 + j * WORLD.texel;
      for (let i = 0; i < W; i++) {
        const X = WORLD.x0 + i * WORLD.texel, Ys = Math.abs(Y) < 40 ? (Y < 0 ? -44 : 44) : Y, p = project(X, Ys, 0);
        const bx = Math.floor((0x1010 + p.xp) / 32) & 255, by = Math.floor((0x1010 + p.pp) / 32) & 255;
        const s = (by * 256 + bx) * 4, o = (j * W + i) * 4;
        d[o] = bg[s]; d[o + 1] = bg[s + 1]; d[o + 2] = bg[s + 2]; d[o + 3] = 255;
      }
    }
    if (this.groundTex) this.gl.deleteTexture(this.groundTex);
    this.groundTex = this.texture(W, H, d, true);
  }
  // inverse projection of a screen point on the ground (Z = 0): Y by bisection on the monotonic pp(Y), then X
  unproject(sx, sy) {
    const p = this.gb.ppu, offX = 0x1010 - (p.scx << 5), offY = 0x1010 - (p.scy << 5);
    const pp = sy * 32 - offY, xp = sx * 32 - offX;
    let lo = -2600, hi = 2600;
    for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (project(0, mid, 0).pp < pp) lo = mid; else hi = mid; }
    const Y = (lo + hi) / 2, s = project(0, Y, 0).s || 1;
    const X = ((xp - 16) / 8) * 256 / s;
    return { X, Y, s };
  }
  ballWorld() {
    const w = this.gb.mem.wram[0], r32 = a => { const v = w[a] | (w[a + 1] << 8) | (w[a + 2] << 16) | (w[a + 3] << 24); return v / 65536; };
    return { X: r32(0x400), Y: r32(0x404), Z: r32(0x408) };
  }

  // ---- drawing ----
  draw(tex, model, mvp, uv = [0, 0, 1, 1], tint = [1, 1, 1, 1], alphaTest = 0.5) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniformMatrix4fv(this.u.uModel, false, model); gl.uniformMatrix4fv(this.u.uMVP, false, mvp);
    gl.uniform4fv(this.u.uUVRect, uv); gl.uniform4fv(this.u.uTint, tint); gl.uniform1f(this.u.uAlphaTest, alphaTest);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  // world: x = X, y = height (-Z), z = Y (near side positive, towards the default camera)
  render(frame2d) {
    const gl = this.gl, cv = this.cv;
    if (cv.width !== cv.clientWidth || cv.height !== cv.clientHeight) { cv.width = cv.clientWidth || 160; cv.height = cv.clientHeight || 144; }
    gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0.05, 0.08, 0.12, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog); gl.bindVertexArray(this.vao); gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (this.isField()) { this.renderField(frame2d); return; }
    if (!this.isCourt()) { this.mode = "2d"; this.drawFlatFrame(frame2d); return; }
    if (this.mode !== "3d") { this.cam.dist = 3100; this.cam.targetY = 250; this.cam.minDist = 600; }
    this.mode = "3d"; if (this.debug) this.debug.length = 0;
    const h = this.bgHash(); if (h !== this.groundHash) { this.groundHash = h; this.buildGround(); }
    const c = this.cam, aspect = cv.width / cv.height;
    const eye = [c.dist * Math.sin(c.yaw) * Math.cos(c.pitch), c.dist * Math.sin(c.pitch), c.dist * Math.cos(c.yaw) * Math.cos(c.pitch)];
    const view = m4.lookAt([eye[0], eye[1], eye[2] + c.targetY], [0, 0, c.targetY], [0, 1, 0]);
    const mvp = m4.mul(m4.perspective(0.9, aspect, 20, 12000), view);
    // ground plane (lying flat: tilt -90deg around X so the quad's up axis becomes -Z, i.e. +Y world towards the camera)
    const gw = WORLD.x1 - WORLD.x0, gh = WORLD.y1 - WORLD.y0;
    this.draw(this.groundTex, m4.trs(0, -0.5, WORLD.y1, gw, gh, -Math.PI / 2), mvp, [0, 1, 1, -1], [1, 1, 1, 1], 0);
    // net
    this.draw(this.netTex, m4.trs(0, 0, 0, 1180, 96, 0), mvp, [0, 0, 10, 1], [1, 1, 1, 1], 0.1);
    // sprites: OAM entries grouped into objects (touching boxes), each object stands at the ground point of
    // its bottom edge; the object around the ball's projected position is lifted to the ball's true height
    const m = this.gb.mem, p = this.gb.ppu, oam = m.oam, tall = p.lcdc & 4, ball = this.ballWorld();
    const bp = project(ball.X, ball.Y, ball.Z), bg = project(ball.X, ball.Y, 0);
    const offX = 0x1010 - (p.scx << 5), offY = 0x1010 - (p.scy << 5);
    const ballSx = (offX + bp.xp) / 32, ballSy = (offY + bp.pp) / 32, shadowSx = (offX + bg.xp) / 32, shadowSy = (offY + bg.pp) / 32;
    const sprs = [];
    for (let i = 0; i < 40; i++) {
      const sy = oam[i * 4] - 16, sx = oam[i * 4 + 1] - 8; if (sy <= -16 || sy >= 144 || sx <= -8 || sx >= 160) continue;
      let tile = oam[i * 4 + 2]; const attr = oam[i * 4 + 3], hgt = tall ? 16 : 8; if (tall) tile &= 0xFE;
      sprs.push({ sx, sy, h: hgt, tile, attr, g: sprs.length });
    }
    const find = i => { while (sprs[i].g !== i) i = sprs[i].g = sprs[sprs[i].g].g; return i; };
    for (let i = 0; i < sprs.length; i++) for (let j = i + 1; j < sprs.length; j++) {
      const a = sprs[i], b = sprs[j];
      if (a.sx < b.sx + 10 && b.sx < a.sx + 10 && a.sy < b.sy + b.h + 2 && b.sy < a.sy + a.h + 2) sprs[find(j)].g = find(i);
    }
    const groups = new Map();
    for (const sp of sprs) { const r = find(sp.g); let g = groups.get(r); if (!g) groups.set(r, g = { list: [], x0: 999, x1: -999, y0: 999, y1: -999 }); g.list.push(sp); g.x0 = Math.min(g.x0, sp.sx); g.x1 = Math.max(g.x1, sp.sx + 8); g.y0 = Math.min(g.y0, sp.sy); g.y1 = Math.max(g.y1, sp.sy + sp.h); }
    let ballGroup = null, shadowGroup = null, dBest = 20, dShadow = 10;
    for (const g of groups.values()) for (const sp of g.list) {          // the group holding the sprite nearest the ball's projection
      const db = Math.hypot(sp.sx + 4 - ballSx, sp.sy + sp.h / 2 - ballSy); if (db < dBest) { dBest = db; ballGroup = g; }
    }
    for (const g of groups.values()) {
      if (g === ballGroup || ball.Z > -4) continue;
      const cx = (g.x0 + g.x1) / 2, cy = (g.y0 + g.y1) / 2, ds = Math.hypot(cx - shadowSx, cy - shadowSy); if (ds < dShadow && g.list.length <= 2) { dShadow = ds; shadowGroup = g; }
    }
    const SCALE = 7.5, hud = [], TILT = 0.3, COS_T = Math.cos(TILT), SIN_T = Math.sin(TILT);
    const blit = (sp, X, Yw, baseY, cx) => {           // one OAM sprite as 8x8 quads standing at (X, Yw), feet at screen row baseY
      for (let half = 0; half < sp.h / 8; half++) {
        const t = this.spriteTexture(sp.tile + (sp.attr & 0x40 ? (sp.h / 8 - 1 - half) : half), (sp.attr >> 3) & 1, sp.attr & 7, (sp.attr >> 5) & 1, (sp.attr >> 6) & 1);
        const dx = (sp.sx + 4 - cx) * SCALE, bottom = (baseY - (sp.sy + (half + 1) * 8)) * SCALE;
        this.draw(t, m4.trs(X + dx, bottom * COS_T, Yw - bottom * SIN_T, 8 * SCALE, 8 * SCALE, -TILT, 0), mvp);   // leaning back as one card
      }
    };
    for (const g of groups.values()) {
      if (g === shadowGroup) continue;
      const cx = (g.x0 + g.x1) / 2, cy = g.y1;
      if (g === ballGroup) {
        const lift = -ball.Z * 1.0;
        for (const sp of g.list) { for (let half = 0; half < sp.h / 8; half++) {
          const t = this.spriteTexture(sp.tile + (sp.attr & 0x40 ? (sp.h / 8 - 1 - half) : half), (sp.attr >> 3) & 1, sp.attr & 7, (sp.attr >> 5) & 1, (sp.attr >> 6) & 1);
          const dx = (sp.sx + 4 - cx) * SCALE, dy = (cy - (sp.sy + (half + 1) * 8)) * SCALE;
          this.draw(t, m4.trs(ball.X + dx, lift + dy * COS_T, ball.Y - dy * SIN_T, 8 * SCALE, 8 * SCALE, -TILT, 0), mvp);
        } }
        this.draw(this.shadowTex, m4.trs(ball.X, 0.5, ball.Y, 50, 32, -Math.PI / 2), mvp, [0, 0, 1, 1], [1, 1, 1, 1], 0);
        continue;
      }
      const w = this.unproject(cx, cy);
      const isHud = Math.abs(w.X) > 1150 || Math.abs(w.Y) > 2300 || cy < 10;
      if (this.debug) this.debug.push({ cx, cy, n: g.list.length, X: Math.round(w.X), Y: Math.round(w.Y), hud: isHud });
      if (isHud) { hud.push(...g.list); continue; }
      const width = (g.x1 - g.x0) * SCALE;
      this.draw(this.shadowTex, m4.trs(w.X, 0.6, w.Y + 4, width * 1.1, width * 0.55, -Math.PI / 2), mvp, [0, 0, 1, 1], [1, 1, 1, 0.75], 0);
      for (const sp of g.list) blit(sp, w.X, w.Y, cy, cx);
    }
    // HUD sprites in screen space (orthographic, 160x144)
    gl.disable(gl.DEPTH_TEST);
    const ortho = m4.ortho(0, 160, 144, 0, -1, 1);
    for (const s of hud) for (let half = 0; half < s.h / 8; half++) {
      const t = this.spriteTexture(s.tile + (s.attr & 0x40 ? (s.h / 8 - 1 - half) : half), (s.attr >> 3) & 1, s.attr & 7, (s.attr >> 5) & 1, (s.attr >> 6) & 1);
      this.draw(t, m4.trs(s.sx + 4, s.sy + (half + 1) * 8, 0, 8, -8, 0), ortho);
    }
  }
  // ---- RPG areas: the whole 64x64 map as a floor, solid metatiles (collision grid) as extruded boxes ----
  fieldScroll() { const w = this.gb.mem.wram[0]; return { x: w[0x321] * 8 + (w[0x320] >> 5), y: w[0x323] * 8 + (w[0x322] >> 5) }; }
  composeMap() {                                      // WRAM3 tilemap + WRAM2 attributes (stride 64) -> 512x512 RGBA
    const m = this.gb.mem, p = this.gb.ppu, tm = m.wram[3], at = m.wram[2], v0 = m.vram[0], v1 = m.vram[1], lcdc = p.lcdc;
    const img = new Uint8Array(512 * 512 * 4);
    for (let ty = 0; ty < 64; ty++) for (let tx = 0; tx < 64; tx++) {
      const i = ty * 64 + tx, tile = tm[i], attr = at[i], bank = attr & 8 ? v1 : v0;
      const addr = lcdc & 0x10 ? tile << 4 : 0x1000 + ((tile << 24 >> 24) << 4);
      for (let y = 0; y < 8; y++) {
        const row = attr & 0x40 ? 7 - y : y, lo = bank[addr + row * 2], hi = bank[addr + row * 2 + 1];
        for (let x = 0; x < 8; x++) {
          const bit = attr & 0x20 ? x : 7 - x, ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1), c = this.col5(p.bgPal, attr & 7, ci);
          const o = ((ty * 8 + y) * 512 + tx * 8 + x) * 4; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; img[o + 3] = 255;
        }
      }
    }
    return img;
  }
  buildField() {
    const gl = this.gl, f = this.field, coll = this.gb.mem.wram[6];
    if (f.floorTex) gl.deleteTexture(f.floorTex);
    f.floorTex = this.texture(512, 512, this.composeMap());
    // walls: one box (top + 4 sides) per solid 16x16 metatile, uv = the metatile's own texels; sides share them
    const H = 14, pos = [], uv = [];
    const quad = (a, b, c, d, u) => { for (const [v, t] of [[a, u[0]], [b, u[1]], [c, u[2]], [a, u[0]], [c, u[2]], [d, u[3]]]) { pos.push(...v); uv.push(...t); } };
    let n = 0;
    for (let my = 0; my < 32; my++) for (let mx = 0; mx < 32; mx++) {
      if (coll[my * 32 + mx] !== 0x0F) continue;
      const x0 = mx * 16, x1 = x0 + 16, z0 = my * 16, z1 = z0 + 16, u0 = x0 / 512, u1 = x1 / 512, v0 = z0 / 512, v1 = z1 / 512;
      const top = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], side = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
      quad([x0, H, z0], [x1, H, z0], [x1, H, z1], [x0, H, z1], top);
      const solid = (x, y) => x >= 0 && y >= 0 && x < 32 && y < 32 && coll[y * 32 + x] === 0x0F;
      if (!solid(mx, my + 1)) quad([x0, 0, z1], [x1, 0, z1], [x1, H, z1], [x0, H, z1], side);
      if (!solid(mx, my - 1)) quad([x1, 0, z0], [x0, 0, z0], [x0, H, z0], [x1, H, z0], side);
      if (!solid(mx - 1, my)) quad([x0, 0, z0], [x0, 0, z1], [x0, H, z1], [x0, H, z0], side);
      if (!solid(mx + 1, my)) quad([x1, 0, z1], [x1, 0, z0], [x1, H, z0], [x1, H, z1], side);
      n++;
    }
    if (f.walls) { gl.deleteBuffer(f.walls.pb); gl.deleteBuffer(f.walls.ub); gl.deleteVertexArray(f.walls.vao); }
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const ub = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ub); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.STATIC_DRAW); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    f.walls = { vao, pb, ub, count: pos.length / 3 }; f.wallCount = n;
    gl.bindVertexArray(this.vao);
  }
  renderField(frame2d) {
    const gl = this.gl, cv = this.cv, m = this.gb.mem, p = this.gb.ppu, f = this.field, id = this.mapId();
    if (this.mode !== "field") { this.cam.dist = 300; this.cam.targetY = 0; this.cam.pitch = 0.95; this.cam.minDist = 120; }
    this.mode = "field";
    let ph = 0; for (let i = 0; i < 64; i += 3) ph = (ph * 31 + p.bgPal[i]) | 0;
    if (f.mapId !== id || f.palHash !== ph) { f.mapId = id; f.palHash = ph; this.buildField(); }
    const sc = this.fieldScroll(), cx = sc.x + 80, cz = sc.y + 72, c = this.cam, aspect = cv.width / cv.height;
    const eye = [cx + c.dist * Math.sin(c.yaw) * Math.cos(c.pitch), c.dist * Math.sin(c.pitch), cz + c.dist * Math.cos(c.yaw) * Math.cos(c.pitch)];
    const mvp = m4.mul(m4.perspective(0.8, aspect, 4, 3000), m4.lookAt(eye, [cx, 0, cz], [0, 1, 0]));
    // floor (512x512 map px; +z = down the map)
    gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
    this.draw(f.floorTex, m4.trs(256, -0.2, 512, 512, 512, -Math.PI / 2), mvp, [0, 1, 1, -1], [1, 1, 1, 1], 0);
    // walls
    if (f.walls && f.walls.count) {
      gl.useProgram(this.prog3); gl.bindVertexArray(f.walls.vao); gl.bindTexture(gl.TEXTURE_2D, f.floorTex);
      gl.uniformMatrix4fv(this.u3.uMVP, false, mvp); gl.uniform4fv(this.u3.uTint, [0.85, 0.85, 0.85, 1]); gl.uniform1f(this.u3.uAlphaTest, 0);
      gl.drawArrays(gl.TRIANGLES, 0, f.walls.count);
      gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
    }
    // actors: OAM sprites grouped into objects at map px (screen + scroll), 1 px = 1 unit, leaning back
    const oam = m.oam, tall = p.lcdc & 4, sprs = [];
    for (let i = 0; i < 40; i++) {
      const sy = oam[i * 4] - 16, sx = oam[i * 4 + 1] - 8; if (sy <= -16 || sy >= 144 || sx <= -8 || sx >= 160) continue;
      let tile = oam[i * 4 + 2]; const attr = oam[i * 4 + 3], h = tall ? 16 : 8; if (tall) tile &= 0xFE;
      sprs.push({ sx, sy, h, tile, attr, g: sprs.length });
    }
    const find = i => { while (sprs[i].g !== i) i = sprs[i].g = sprs[sprs[i].g].g; return i; };
    for (let i = 0; i < sprs.length; i++) for (let j = i + 1; j < sprs.length; j++) { const a = sprs[i], b = sprs[j]; if (a.sx < b.sx + 10 && b.sx < a.sx + 10 && a.sy < b.sy + b.h + 2 && b.sy < a.sy + a.h + 2) sprs[find(j)].g = find(i); }
    const groups = new Map();
    for (const sp of sprs) { const r = find(sp.g); let g = groups.get(r); if (!g) groups.set(r, g = { list: [], x0: 999, x1: -999, y1: -999 }); g.list.push(sp); g.x0 = Math.min(g.x0, sp.sx); g.x1 = Math.max(g.x1, sp.sx + 8); g.y1 = Math.max(g.y1, sp.sy + sp.h); }
    const TILT = 0.3, COS_T = Math.cos(TILT), SIN_T = Math.sin(TILT);
    for (const g of groups.values()) {
      const cx2 = (g.x0 + g.x1) / 2, X = cx2 + sc.x, Z = g.y1 + sc.y;
      this.draw(this.shadowTex, m4.trs(X, 0.3, Z + 1, (g.x1 - g.x0) * 1.1, 7, -Math.PI / 2), mvp, [0, 0, 1, 1], [1, 1, 1, 0.7], 0);
      for (const sp of g.list) for (let half = 0; half < sp.h / 8; half++) {
        const t = this.spriteTexture(sp.tile + (sp.attr & 0x40 ? (sp.h / 8 - 1 - half) : half), (sp.attr >> 3) & 1, sp.attr & 7, (sp.attr >> 5) & 1, (sp.attr >> 6) & 1);
        const dx = sp.sx + 4 - cx2, bottom = g.y1 - (sp.sy + (half + 1) * 8);
        this.draw(t, m4.trs(X + dx, bottom * COS_T, Z - bottom * SIN_T, 8, 8, -TILT, 0), mvp);
      }
    }
    // the window layer (dialogue boxes, menus) as a screen-space overlay from the 2D frame
    if ((p.lcdc & 0x20) && p.wy < 144) {
      if (!this.frameTex) this.frameTex = this.texture(160, 144, null);
      gl.bindTexture(gl.TEXTURE_2D, this.frameTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 160, 144, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(frame2d.buffer));
      gl.disable(gl.DEPTH_TEST);
      const ortho = m4.ortho(0, 160, 144, 0, -1, 1), wy = p.wy, wx = Math.max(0, p.wx - 7);
      this.draw(this.frameTex, m4.trs(wx + (160 - wx) / 2, 144, 0, 160 - wx, -(144 - wy), 0), ortho, [wx / 160, wy / 144, (160 - wx) / 160, (144 - wy) / 144], [1, 1, 1, 1], 0);
    }
  }
  drawFlatFrame(frame) {                            // non-court scenes: the 2D frame as a textured quad filling the canvas
    const gl = this.gl;
    if (!this.frameTex) this.frameTex = this.texture(160, 144, null);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 160, 144, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(frame.buffer));
    gl.disable(gl.DEPTH_TEST);
    this.draw(this.frameTex, m4.trs(0, -1, 0, 2, 2, 0), m4.identity(), [0, 1, 1, -1], [1, 1, 1, 1], 0);
  }
  bindCameraControls() {                           // one finger / mouse: orbit; two fingers: pinch zoom; wheel: zoom
    const cv = this.cv, c = this.cam, pts = new Map(); let drag = null, pinch = null;
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    cv.addEventListener("pointerdown", e => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); cv.setPointerCapture(e.pointerId);
      if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, yaw: c.yaw, pitch: c.pitch };
      else if (pts.size === 2) { drag = null; pinch = { d: dist(), dist: c.dist }; }
    });
    cv.addEventListener("pointermove", e => {
      if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size === 2) { c.dist = Math.max(c.minDist || 120, Math.min(8000, pinch.dist * pinch.d / Math.max(10, dist()))); return; }
      if (!drag) return; c.yaw = drag.yaw + (e.clientX - drag.x) * 0.006; c.pitch = Math.max(0.15, Math.min(1.5, drag.pitch + (e.clientY - drag.y) * 0.006));
    });
    const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (pts.size === 0) drag = null; };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", e => { e.preventDefault(); c.dist = Math.max(c.minDist || 120, Math.min(8000, c.dist * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: false });
  }
}
