// LIGHT (3D hole view, render only; adapted from Mario Tennis's lighting.js): the hour of the round and what it does to the picture.
// The hour: AUTO gives each course its own (the Marion Club in the morning, the Palm Club in the afternoon, the Dune Club at midday,
// the Links Club towards evening, Peach's Castle at dusk; holes later in the round a little later), or a fixed hour, or the clock.
// From it (skybox.js skyColours): the sun's direction and colour, the sky's light (the ambient), the fog's colour (the horizon's);
// sun SHADOWS from a shadow map (an orthographic depth picture from the sun round the camera's focus: trees, the golfer, the pin,
// the ball, the hills); at NIGHT floodlights on masts at the tee and by the green and a lamp at the pin (point lights), the moon's
// cold light. Off: a fixed afternoon without shadows or lamps. Nothing in the game is read but the course, the hole and the ball.
import { m4, norm, lerp, clamp, program } from "./gl.js";
import { skyColours } from "./skybox.js";

const COURSE_HOUR = [10, 10, 15.5, 12.5, 17.6, 19.6, 11, 11];
export const HOURS = { auto: "Auto (by course)", clock: "Clock", 7: "Morning", 12: "Noon", 16: "Afternoon", 18.6: "Sunset", 21: "Night" };

export class Lighting {
  constructor(scene) {
    this.scene = scene; this.hour = 14; this.night = 0; this.lights = new Float32Array(16); this.lightCols = new Float32Array(12);
    this.sunDir = [0.3, 0.8, 0.4]; this.sunCol = [0.6, 0.6, 0.58]; this.amb = [0.5, 0.5, 0.52]; this.fogCol = [0.7, 0.8, 0.9];
    this.fogNear = 300; this.fogFar = 2600; this.shadows = false; this.groundK = 1;
  }
  hourNow(s) {
    const sc = this.scene, setting = sc.layers.hour;
    if (sc.hourOverride != null) return sc.hourOverride;
    if (!sc.on("light")) return 14;
    if (setting === "clock") { const d = new Date(); return d.getHours() + d.getMinutes() / 60; }
    if (setting !== "auto" && setting != null) return +setting;
    return COURSE_HOUR[(s && s.course) & 7] + ((s && s.hole) ? (s.hole - 1) * 0.06 : 0);
  }
  update(s, dt) {
    const sc = this.scene, on = sc.on("light");
    this.hour = this.hourNow(s);
    const S = skyColours(this.hour), c3 = a => a.map(x => x / 255);
    this.night = S.night;
    const el = Math.max(S.sunEl, 0.05), az = S.sunAz + 0.6;   // (turned so the morning sun crosses the holes)
    const day = clamp(S.sunEl / 0.35, 0, 1);
    if (S.night > 0.5 && on) this.sunDir = norm([Math.sin(-0.5) * 0.8, 0.6, -Math.cos(-0.5) * 0.8]);   // the moon's
    else this.sunDir = norm([Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)]);
    const sun = c3(S.sunC), hor = c3(S.hor), top = c3(S.top);
    const k = on ? 1 : 0;
    this.sunCol = on ? sun.map((v, i) => v * (0.62 * day + 0.1 * (1 - day)) * (1 - 0.55 * S.night) + [0.02, 0.03, 0.08][i] * S.night) : [0.62, 0.62, 0.6];
    this.amb = on ? hor.map((v, i) => lerp(0.42 + 0.1 * v, top[i] * 0.45 + 0.08, S.night) * (1 - 0.15 * (1 - day) * (1 - S.night))) : [0.5, 0.5, 0.52];
    this.fogCol = on ? hor : [0.72, 0.82, 0.92];
    this.skyCol = on ? hor.map((v, i) => lerp(v, top[i], 0.5)) : [0.6, 0.75, 0.95];
    this.groundK = on ? clamp((this.amb[0] + this.amb[1] + this.amb[2]) / 3 + 0.55 * day, 0.25, 1.1) : 1;
    this.fogNear = sc.lite ? 220 : 320; this.fogFar = sc.lite ? 1600 : 2800;
    // NIGHT: the lamps
    this.lights.fill(0); this.lightCols.fill(0);
    if (on && sc.layers.night !== false && S.night > 0.2 && sc.s && sc.hole) {
      const H = sc.hole.H, n = clamp((S.night - 0.2) / 0.5, 0, 1), L = this.masts();
      let i = 0;
      for (const m of L) { if (i >= 3) break; this.lights.set([m[0], H(m[0], m[1]) + 26, m[1], 150], i * 4); this.lightCols.set([1.0 * n, 0.92 * n, 0.75 * n], i * 3); i++; }
      const [cx, cz] = sc.s.cup; this.lights.set([cx, H(cx, cz) + 5, cz, 14], 12); this.lightCols.set([0.9 * n, 0.7 * n, 0.4 * n], 9);
    }
    this.shadows = on && sc.layers.shadows !== false && S.night < 0.6 && S.sunEl > 0.04;
  }
  // the floodlight masts: by the tee (where the hole's first shot was) and beside the green
  masts() {
    const sc = this.scene, h = sc.hole; if (!h) return [];
    if (h.masts) return h.masts;
    const [cx, cz] = sc.s.cup, tee = sc.teeAt || (sc.golferAt ? sc.golferAt.slice() : [cx, cz + 200]);
    const d = norm([cx - tee[0], 0, cz - tee[1]]), side = [-d[2], d[0]];
    h.masts = [[tee[0] + side[0] * 22 - d[0] * 10, tee[1] + side[1] * 22 - d[2] * 10], [cx - side[0] * 26 + d[0] * 8, cz - side[1] * 26 + d[2] * 8],
      [(tee[0] + cx) / 2 + side[0] * 40, (tee[1] + cz) / 2 + side[1] * 40]];
    return h.masts;
  }
  // ---- the shadow map ----
  beginShadow(focus) {
    const sc = this.scene, gl = sc.gl, N = sc.lite ? 1024 : 2048;
    if (!this.fbo || this.fboN !== N) {
      if (this.fbo) { gl.deleteFramebuffer(this.fbo); gl.deleteTexture(this.depthTex); }
      this.fboN = N; this.depthTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, N, N, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
        [gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE], [gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
      this.fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTex, 0);
      gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { this.broken = true; gl.bindFramebuffer(gl.FRAMEBUFFER, null); return false; }
    }
    if (this.broken) return false;
    const R = sc.lite ? 90 : 120, f = focus, d = this.sunDir;
    const eye = [f[0] + d[0] * 300, f[1] + d[1] * 300, f[2] + d[2] * 300];
    const view = m4.lookAt(eye, f, Math.abs(d[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0]);
    this.shadowMVP = m4.mul(m4.ortho(-R, R, -R, R, 1, 700), view);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo); gl.viewport(0, 0, N, N);
    gl.clear(gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2, 4);
    return true;
  }
  endShadow() { const gl = this.scene.gl; gl.disable(gl.POLYGON_OFFSET_FILL); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
  dummyDepth(gl) {
    if (this._dummy) return this._dummy;
    const t = this._dummy = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, 1, 1, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, new Uint32Array([0xFFFFFFFF]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  }
}
