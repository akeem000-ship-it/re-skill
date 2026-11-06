// LIGHT (3D hole view, render only; adapted from Mario Tennis's lighting.js): the hour of the round and what it does to the picture.
// The hour: AUTO gives each course its own (the Marion Club in the morning, the Palm Club in the afternoon, the Dune Club at midday,
// the Links Club towards evening, Peach's Castle at dusk; holes later in the round a little later), or a fixed hour, or the clock.
// From it (skybox.js skyColours): the sun's direction and colour, the sky's light (the ambient), the fog's colour (the horizon's);
// sun SHADOWS from a shadow map (an orthographic depth picture from the sun round the camera's focus: trees, the golfer, the pin,
// the ball, the hills); at NIGHT floodlights on masts at the tee and by the green and a lamp at the pin (point lights), the moon's
// cold light. Off: a fixed afternoon without shadows or lamps. Nothing in the game is read but the course, the hole and the ball.
import { m4, norm, lerp, clamp, program } from "./gl.js";
import { skyColours } from "./skybox.js";

const COURSE_HOUR = [10, 10, 15.5, 12.5, 17.6, 18.8, 11, 11];   // (Peach's Castle: the sunset, deepening to dusk over the round)
// the light through the day (hand-tuned for a readable picture at every hour): the sun's light (the moon's at night) and the sky's
// (the ambient: cool blue in the shade at dawn, dusk and night, so the low warm sun has contrast and the greens stay green)
const LIGHT = [
  { h: 0,    sun: [0.27, 0.33, 0.54], amb: [0.26, 0.30, 0.45] },
  { h: 5,    sun: [0.27, 0.33, 0.54], amb: [0.26, 0.30, 0.45] },
  { h: 6.2,  sun: [0.98, 0.66, 0.48], amb: [0.44, 0.45, 0.60] },
  { h: 7.5,  sun: [0.72, 0.64, 0.52], amb: [0.47, 0.48, 0.54] },
  { h: 10,   sun: [0.62, 0.61, 0.55], amb: [0.49, 0.50, 0.52] },
  { h: 14,   sun: [0.62, 0.61, 0.56], amb: [0.49, 0.50, 0.52] },
  { h: 16.5, sun: [0.66, 0.62, 0.52], amb: [0.48, 0.49, 0.53] },
  { h: 18.2, sun: [0.98, 0.76, 0.50], amb: [0.45, 0.47, 0.60] },
  { h: 19.4, sun: [1.05, 0.62, 0.42], amb: [0.44, 0.45, 0.64] },
  { h: 20.5, sun: [0.29, 0.35, 0.56], amb: [0.28, 0.32, 0.47] },
  { h: 24,   sun: [0.27, 0.33, 0.54], amb: [0.26, 0.30, 0.45] },
];
function lightAt(hour) {
  const h = ((hour % 24) + 24) % 24; let i = 0; while (i < LIGHT.length - 2 && h >= LIGHT[i + 1].h) i++;
  const a = LIGHT[i], b = LIGHT[i + 1], t0 = clamp((h - a.h) / (b.h - a.h), 0, 1), t = t0 * t0 * (3 - 2 * t0);
  return { sun: a.sun.map((v, j) => v + (b.sun[j] - v) * t), amb: a.amb.map((v, j) => v + (b.amb[j] - v) * t) };
}
const lum = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
export const HOURS = { auto: "Auto (by course)", clock: "Clock", 7: "Morning", 12: "Noon", 16: "Afternoon", 18.6: "Sunset", 21: "Night" };

export class Lighting {
  constructor(scene) {
    this.scene = scene; this.hour = 14; this.night = 0; this.lights = new Float32Array(16); this.lightCols = new Float32Array(12);
    this.sunDir = [0.3, 0.8, 0.4]; this.sunCol = [0.6, 0.6, 0.58]; this.amb = [0.5, 0.5, 0.52]; this.fogCol = [0.7, 0.8, 0.9];
    this.fogNear = 300; this.fogFar = 2600; this.shadows = false; this.groundK = 1; this.heroK = 1;
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
    // (the light's sun never lower than ~24 degrees: a sun on the horizon would leave the ground in the dark and every shadow endless;
    // the sky still draws it low)
    const el = Math.max(S.sunEl, 0.42), az = S.sunAz + 0.6;   // (turned so the morning sun crosses the holes)
    if (S.night > 0.5 && on) this.sunDir = norm([Math.sin(-0.5) * 0.8, 0.6, -Math.cos(-0.5) * 0.8]);   // the moon's
    else this.sunDir = norm([Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)]);
    const hor = c3(S.hor), top = c3(S.top), LT = lightAt(this.hour);
    this.sunCol = on ? LT.sun : [0.62, 0.62, 0.6];
    this.amb = on ? LT.amb : [0.5, 0.5, 0.52];
    // the haze: the horizon's colour, at dusk and night pulled toward the sky above it (a pink or deep-blue fog muddies the far course)
    this.fogCol = on ? hor.map((v, i) => lerp(v, top[i], 0.25 * S.night + 0.15 * (S.glow ? S.glow[0] / 255 : 0))) : [0.72, 0.82, 0.92];
    this.skyCol = on ? hor.map((v, i) => lerp(v, top[i], 0.5)) : [0.6, 0.75, 0.95];
    this.groundK = on ? clamp(lum(this.amb) + 0.9 * lum(this.sunCol), 0.45, 1.06) : 1;
    // the golfer, the pin and the marks stay readable at any hour: lit at least as a day's (scene.js drawBodies)
    this.heroK = on ? clamp(1.0 / (lum(this.amb) + 0.78 * lum(this.sunCol)), 1, 1.45) : 1;
    this.fogNear = sc.lite ? 220 : 320; this.fogFar = sc.lite ? 1600 : 2800;
    // NIGHT: the lamps
    this.lights.fill(0); this.lightCols.fill(0);
    if (on && sc.layers.night !== false && S.night > 0.2 && sc.s && sc.hole) {
      const H = sc.hole.H, n = clamp((S.night - 0.2) / 0.5, 0, 1), L = this.masts();
      let i = 0;
      for (const m of L) { if (i >= 3) break; this.lights.set([m[0], H(m[0], m[1]) + 30, m[1], 200], i * 4); this.lightCols.set([0.72 * n, 0.72 * n, 0.66 * n], i * 3); i++; }
      const [cx, cz] = sc.s.cup; this.lights.set([cx, H(cx, cz) + 6, cz, 20], 12); this.lightCols.set([0.6 * n, 0.5 * n, 0.32 * n], 9);
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
    const sc = this.scene, gl = sc.gl, N = sc.lite ? 512 : 1024;
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
