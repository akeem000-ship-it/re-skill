// The ball in the 3D hole view (render only): a golf ball. A white sphere at a golf ball's size next to the golfer and the cup (the
// golfer is drawn 4.2 tall, so a 1.68 inch ball is about 0.052 across in world units, the cup 0.26), never smaller on screen than
// a few pixels so it can be followed far off. Full: dimples (a cube map of ~330 dimples made here, its normals tilting into each
// dent and a little darker inside), soft wrapped light and a specular highlight from the scene's sun (light3d.js), its shadow map,
// a brighter rim, and a printed line and mark that turn with the ball. Lite: no dimple map, fewer triangles. A thin dark outline
// (the sphere's back faces, a pixel or so wider) while the ball is small on screen, so it stays readable against the sky and white
// sand. The ball turns as it moves: on the ground it rolls (its turn from the distance it covered), in the air it spins on the
// game's spin (WRAM6 $D411: the lift, positive = backspin) about the axis across its flight and on its curve ($D40F) about the
// vertical. Nothing of the game is written.
import { program, vao, m4 } from "./gl.js";

export const BALL_R = 0.052, CUP_D = 0.26;
const VS = `#version 300 es
in vec3 aPos; uniform mat4 uMVP; uniform mat4 uModel; uniform mat4 uShadowMVP; uniform mat3 uRot; uniform float uGrow;
out vec3 vN; out vec3 vO; out vec3 vW; out vec4 vSh;
void main() { vec4 w = uModel * vec4(aPos * uGrow, 1.0); vW = w.xyz; vN = aPos; vO = transpose(uRot) * aPos; vSh = uShadowMVP * w; gl_Position = uMVP * w; }`;
const FS = `#version 300 es
precision highp float; precision highp sampler2DShadow;
in vec3 vN; in vec3 vO; in vec3 vW; in vec4 vSh;
uniform samplerCube uDimples; uniform sampler2DShadow uShadow; uniform float uShadowOn, uLite, uOutline, uRpx; uniform mat3 uRot;
uniform vec3 uSunDir, uSunCol, uAmb, uFogCol, uSkyCol; uniform float uFogNear, uFogFar, uNight; uniform vec3 uEye; uniform vec4 uFade;
uniform vec4 uLights[4]; uniform vec3 uLightCol[4];
out vec4 o;
void main() {
  if (uOutline > 0.0) { o = vec4(mix(vec3(0.08, 0.09, 0.1), uFade.rgb, uFade.a), uOutline); return; }
  vec3 n = normalize(vN), ob = normalize(vO);              // (world normal, the ball's own: turned with it)
  float cav = 0.0;
  if (uLite < 0.5) {                                        // the dimples: the normal tilts into each dent (in the ball's own frame)
    vec4 d = texture(uDimples, ob); vec3 tilt = d.rgb * 2.0 - 1.0;
    float k = clamp(uRpx / 14.0, 0.0, 1.0);                 // (no dimples while the ball is a few pixels)
    vec3 on = normalize(ob + tilt * 0.55 * k); cav = d.a * k;
    n = normalize(uRot * on);
  }
  // the print: an alignment line round the ball and a short mark across it (dark blue), from the ball's own frame
  float ln = 1.0 - smoothstep(0.018, 0.03, abs(ob.z)), mk = (1.0 - smoothstep(0.1, 0.14, abs(ob.y))) * (1.0 - smoothstep(0.012, 0.024, abs(ob.x))) * step(0.0, ob.z + 0.5);
  float pr = max(ln * step(0.0, ob.x) * (1.0 - smoothstep(0.55, 0.6, abs(ob.y))), mk * step(ob.z, 0.0)) * clamp(uRpx / 6.0, 0.0, 1.0);
  vec3 alb = mix(vec3(0.95, 0.95, 0.94), vec3(0.12, 0.2, 0.55), pr * 0.85);
  float sh = 1.0;
  if (uShadowOn > 0.5) { vec3 q = vSh.xyz / vSh.w * 0.5 + 0.5; if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) sh = texture(uShadow, vec3(q.xy, q.z - 0.003)); }
  vec3 v = normalize(uEye - vW);
  float ndl = dot(n, uSunDir), wrap = max(0.0, (ndl + 0.35) / 1.35);                     // soft, wrapped light
  vec3 pl = vec3(0.0); for (int i = 0; i < 4; i++) { vec3 dd = uLights[i].xyz - vW; float r = uLights[i].w; if (r <= 0.0) continue; float l = length(dd); pl += uLightCol[i] * max(0.0, 1.0 - l / r) * (0.35 + 0.65 * max(0.0, dot(n, dd / max(l, 0.001)))); }
  vec3 c = alb * (uAmb * (0.75 + 0.25 * n.y) + uSunCol * wrap * (0.3 + 0.7 * sh) + pl) * (1.0 - 0.28 * cav);
  vec3 h = normalize(uSunDir + v);
  c += uSunCol * pow(max(dot(n, h), 0.0), 70.0) * 0.9 * sh * step(0.0, ndl) * (1.0 - pr * 0.5);   // the sun's highlight
  float rim = pow(1.0 - max(dot(normalize(vN), v), 0.0), 3.0);
  c += mix(uSkyCol, vec3(1.0), 0.5) * rim * 0.35;                                          // a brighter rim
  float f = clamp((distance(vW, uEye) - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  c = mix(c, uFogCol, f * f);
  o = vec4(mix(c, uFade.rgb, uFade.a), 1.0);
}`;

// the dimples as a cube map: per texel the tilt of the normal (toward the centre of the dimple it is in) and the dent's depth
function dimpleCube(gl, S = 64, N = 332) {
  const pts = []; const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) { const y = 1 - (i + 0.5) / N * 2, r = Math.sqrt(1 - y * y), a = i * ga; pts.push([Math.cos(a) * r, y, Math.sin(a) * r]); }
  const R = 0.088;                                         // a dimple's angular radius (their spacing is about 0.195)
  // a coarse grid of the points by direction for the search
  const faces = [[[0, 0, -1], [0, -1, 0], [1, 0, 0]], [[0, 0, 1], [0, -1, 0], [-1, 0, 0]], [[1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[1, 0, 0], [0, 0, -1], [0, -1, 0]], [[1, 0, 0], [0, -1, 0], [0, 0, 1]], [[-1, 0, 0], [0, -1, 0], [0, 0, -1]]];   // (u, v, out) per face +x -x +y -y +z -z
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_CUBE_MAP, t);
  for (let f = 0; f < 6; f++) {
    const [U, Vv, O] = faces[f], img = new Uint8Array(S * S * 4);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const u = (i + 0.5) / S * 2 - 1, v = (j + 0.5) / S * 2 - 1;
      let d = [O[0] + U[0] * u + Vv[0] * v, O[1] + U[1] * u + Vv[1] * v, O[2] + U[2] * u + Vv[2] * v]; const l = Math.hypot(...d); d = d.map(x => x / l);
      let best = -2, c = null; for (const p of pts) { const dt = p[0] * d[0] + p[1] * d[1] + p[2] * d[2]; if (dt > best) { best = dt; c = p; } }
      const ang = Math.acos(Math.min(1, best)), q = (j * S + i) * 4; let tilt = [0, 0, 0], dep = 0;
      if (ang < R) {                                       // inside: a spherical dent; the normal tilts toward the dimple's centre
        const k = ang / R, s = Math.sin(ang) || 1, tow = [c[0] - d[0] * best, c[1] - d[1] * best, c[2] - d[2] * best].map(x => x / s);
        const m = k * 0.9; tilt = tow.map(x => x * m); dep = (1 - k * k) * 0.8 + 0.2;
      } else if (ang < R * 1.12) dep = 0.0;
      img[q] = Math.round(tilt[0] * 127.5 + 127.5); img[q + 1] = Math.round(tilt[1] * 127.5 + 127.5); img[q + 2] = Math.round(tilt[2] * 127.5 + 127.5); img[q + 3] = Math.round(dep * 255);
    }
    gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, gl.RGBA8, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, img);
  }
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
function sphere(seg, rings) {
  const pos = [], P = (a, b) => [Math.cos(a) * Math.sin(b), Math.cos(b), Math.sin(a) * Math.sin(b)];
  for (let i = 0; i < seg; i++) for (let j = 0; j < rings; j++) {
    const a0 = i / seg * 6.2832, a1 = (i + 1) / seg * 6.2832, b0 = j / rings * 3.1416, b1 = (j + 1) / rings * 3.1416;
    for (const p of [P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b0), P(a1, b1), P(a0, b1)]) pos.push(...p);
  }
  return new Float32Array(pos);
}
// a rotation (3 x 3, column-major) about a unit axis by angle a, applied after m
function turn(m, ax, a) {
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c, [x, y, z] = ax;
  const r = [t * x * x + c, t * x * y + s * z, t * x * z - s * y, t * x * y - s * z, t * y * y + c, t * y * z + s * x, t * x * z + s * y, t * y * z - s * x, t * z * z + c];
  const o = new Array(9);
  for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) o[col * 3 + row] = r[row] * m[col * 3] + r[3 + row] * m[col * 3 + 1] + r[6 + row] * m[col * 3 + 2];
  // (re-orthonormalise now and then: the columns)
  const n0 = Math.hypot(o[0], o[1], o[2]); for (let k = 0; k < 3; k++) o[k] /= n0;
  const d = o[0] * o[3] + o[1] * o[4] + o[2] * o[5]; for (let k = 0; k < 3; k++) o[3 + k] -= d * o[k];
  const n1 = Math.hypot(o[3], o[4], o[5]); for (let k = 0; k < 3; k++) o[3 + k] /= n1;
  o[6] = o[1] * o[5] - o[2] * o[4]; o[7] = o[2] * o[3] - o[0] * o[5]; o[8] = o[0] * o[4] - o[1] * o[3];
  return o;
}

export class Ball3D {
  constructor(sc) {
    const gl = this.gl = sc.gl; this.sc = sc;
    this.P = program(gl, VS, FS);
    this.meshes = {}; this.cube = null; this.rot = [1, 0, 0, 0, 1, 0, 0, 0, 1]; this.prev = null;
  }
  // the ball's size on screen: at least ~0.35% of the picture's height (in pixels) across its radius
  radius(b) {
    const sc = this.sc, e = sc.eye, d = Math.hypot(b[0] - e[0], b[1] - e[1], b[2] - e[2]), H = sc.canvas.height;
    const ppu = H / (2 * Math.max(0.5, d) * Math.tan(25 * Math.PI / 180) * (sc.cam.fovK || 1));   // pixels per world unit there
    const r = Math.max(BALL_R, H * 0.0035 / ppu);
    return { r, rpx: r * ppu };
  }
  // once per drawn frame: turn the ball by what it did since the last one
  spin(b, s, dt) {
    const p = this.prev; this.prev = b.slice();
    if (!p || !s) return;
    const dx = b[0] - p[0], dz = b[2] - p[2], dh = Math.hypot(dx, dz);
    if (dh > 3) return;                                     // (a jump: a new hole, a replay's cut)
    const r = this.r || BALL_R;
    if (!s.air) {                                           // rolling: the turn the distance gives, about the axis across the way
      if (dh > 1e-4) this.rot = turn(this.rot, [dz / dh, 0, -dx / dh], Math.min(dh / r, 1.1));
    } else {                                                // in the air: the game's spin (positive: backspin) and curve
      const v = s.vel, vh = Math.hypot(v[0], v[2]); if (vh < 1e-4) return;
      const back = Math.sign(s.spin) * Math.min(22, 4 + Math.abs(s.spin) * 0.3), side = Math.max(-10, Math.min(10, s.curve * 0.25));
      this.rot = turn(this.rot, [v[2] / vh, 0, -v[0] / vh], -back * dt);
      if (side) this.rot = turn(this.rot, [0, 1, 0], side * dt);
    }
  }
  draw(b, s, dt) {
    const sc = this.sc, gl = this.gl, p = this.P, { r, rpx } = this.radius(b); this.r = r; sc.ballR = r;
    const lite = sc.lite, mesh = this.meshes[lite] || (this.meshes[lite] = (d => ({ ...vao(gl, p, { aPos: [d, 3] }), n: d.length / 3 }))(sphere(lite ? 14 : 32, lite ? 8 : 18)));
    if (!lite && !this.cube) this.cube = dimpleCube(gl);
    if (this.spunAt !== sc.time) { this.spunAt = sc.time; this.spin(b, s, dt); }   // (once a picture: not again in an inset)
    let y = b[1] + r * 0.85 + sc.ballLift(b);
    const gy = sc.hole.H(b[0], b[2]);
    if (s && Math.hypot(b[0] - s.cup[0], b[2] - s.cup[1]) < CUP_D * 0.6 && b[1] < gy - 0.01) y = gy - r * 0.4;   // in the cup: its top showing
    const model = m4.tsy(b[0], y, b[2], r, r, r);
    gl.useProgram(p.p); sc.setLight(p); sc.bindShadow(p, 2);
    gl.uniform3fv(p.u.uSkyCol, sc.light.skyCol || [0.6, 0.75, 0.95]);
    gl.uniformMatrix4fv(p.u.uMVP, false, sc.mvp); gl.uniformMatrix4fv(p.u.uModel, false, model);
    gl.uniformMatrix3fv(p.u.uRot, false, this.rot); gl.uniform1f(p.u.uLite, lite ? 1 : 0); gl.uniform1f(p.u.uRpx, rpx);
    if (!lite) { gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.cube); gl.uniform1i(p.u.uDimples, 5); }
    gl.bindVertexArray(mesh.vao);
    const oa = 0.55 * (1 - Math.min(1, Math.max(0, (rpx - 5) / 8)));   // the outline while the ball is small on screen: a wider sphere
    if (oa > 0.01) {                                                     // drawn first without depth, the ball over it
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);                    // (one side of it: either, the ball covers the middle)
      gl.uniform1f(p.u.uOutline, oa); gl.uniform1f(p.u.uGrow, 1 + 1.1 / Math.max(1, rpx));
      gl.depthMask(false); gl.drawArrays(gl.TRIANGLES, 0, mesh.n); gl.depthMask(true);
      gl.disable(gl.CULL_FACE);
    }
    gl.uniform1f(p.u.uOutline, 0); gl.uniform1f(p.u.uGrow, 1);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.n);
    gl.bindVertexArray(null);
    return { r, y, gy };
  }
  free() { for (const m of Object.values(this.meshes)) m.free(); if (this.cube) this.gl.deleteTexture(this.cube); this.gl.deleteProgram(this.P.p); }
}
