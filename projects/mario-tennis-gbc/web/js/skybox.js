// SKY (3D / VOX court, render only): a sky behind every court in place of the empty dark background, at the hour of the match.
// Drawn first, behind everything (no depth), as one full-screen pass: each pixel's view ray gives a direction (azimuth from the far
// end, elevation). The horizon is set where the ground far beyond the far end is seen from the camera, and elevations above it are
// stretched a little (STRETCH), so the band of sky the court camera sees over the far stand shows the low sky, the clouds and the
// country around the court rather than a sliver of pale haze. Procedural in the shader: the gradient of the hour (SKY keyframes),
// the sun with its glow, the moon and twinkling stars at night. From a picture drawn here per court and hour (a 4096 x 1024
// panorama, redrawn when either changes): the clouds and the horizon round the court (THEMES by court map):
//   campus     rolling hills, a tree line and the school's buildings (the class courts, the Training Center)
//   castle     snowy mountains far off, green hills and a far tower (the castle courts)
//   city       a skyline of towers, lit windows at night (the stadium courts, the Star Cup)
//   tropics    the sea to the horizon, the sun's path on it, islands with palms (the fruit court, the Island Open, the harbour)
//   pipes      round striped hills and green pipes (the pipe court)
//   volcano    dark peaks and a smoking volcano, lava glowing, the sky reddened (Bowser's court)
//   airfield   flat fields, hangars, a control tower and a windsock (the hangar court)
//   jungle     jagged green peaks, mist and a canopy (the jungle court)
// The hour is the lighting's (lighting.js hourFor("court"): matches by class, random, day, night, or the clock; the title show's
// and the venue tour's own hour). Without LIGHT the afternoon. Nothing in the game is read but the court and match.
import { invert } from "./lighting.js";
import { THEME_BY_MAP } from "./venues.js";

const STRETCH = 3.5, TEX_TOP = 1.05, TEX_BOT = -0.35, TW = 4096, TH = 1024;   // the panorama covers elevations TEX_BOT..TEX_TOP (radians)
const SUN_LOW = 0.45, MOON = [-0.5, 0.13];                                     // the sun drawn lower than it is (a sunset sits in the view), the moon's place
const HORIZON_AT = [0, 380, -2450];                                            // the horizon is drawn through this point: about the far stand's top (world)
// the sky through the day: zenith, horizon (0..255), how much night (stars, moon), the sun's colour
const SKY = [
  { h: 0,    top: [5, 9, 28],     hor: [26, 38, 80],    night: 1,   sun: [255, 200, 150] },
  { h: 5,    top: [8, 14, 40],    hor: [40, 50, 95],    night: 1,   sun: [255, 170, 120] },
  { h: 6.2,  top: [48, 72, 140],  hor: [245, 160, 120], night: 0.3, sun: [255, 170, 110] },
  { h: 7.5,  top: [60, 120, 210], hor: [250, 214, 180], night: 0,   sun: [255, 225, 170] },
  { h: 10,   top: [44, 112, 222], hor: [180, 216, 250], night: 0,   sun: [255, 250, 225] },
  { h: 14,   top: [40, 104, 214], hor: [172, 212, 248], night: 0,   sun: [255, 252, 232] },
  { h: 16.5, top: [52, 110, 200], hor: [214, 224, 236], night: 0,   sun: [255, 238, 200] },
  { h: 18.2, top: [64, 74, 156],  hor: [255, 172, 98],  night: 0,   sun: [255, 168, 80] },
  { h: 19.4, top: [30, 32, 92],   hor: [214, 98, 112],  night: 0.35, sun: [255, 120, 70] },
  { h: 20.5, top: [10, 16, 48],   hor: [44, 52, 110],   night: 0.9, sun: [255, 120, 70] },
  { h: 24,   top: [5, 9, 28],     hor: [26, 38, 80],    night: 1,   sun: [255, 200, 150] },
];
const mixA = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
export function skyColours(hour) {
  const h = ((hour % 24) + 24) % 24; let i = 0; while (i < SKY.length - 2 && h >= SKY[i + 1].h) i++;
  const a = SKY[i], b = SKY[i + 1], t0 = Math.min(1, Math.max(0, (h - a.h) / (b.h - a.h))), t = t0 * t0 * (3 - 2 * t0);
  const top = mixA(a.top, b.top, t), hor = mixA(a.hor, b.hor, t); const night = a.night + (b.night - a.night) * t, sunC = mixA(a.sun, b.sun, t);
  // the sun: up at 6, down at 19.8, highest (62 degrees) between; from the left of the far end in the morning to its right in the evening
  const k = (h - 6) / 13.8, sunEl = k > 0 && k < 1 ? 62 * Math.sin(Math.PI * k) * Math.PI / 180 : -0.3, sunAz = (-50 + 90 * Math.min(1, Math.max(0, k))) * Math.PI / 180;
  return { h, top, hor, night, sunC, sunEl, sunAz };
}
const dirOf = (az, el) => [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];

const VS = `#version 300 es
out vec2 vUV;
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUV = p; gl_Position = vec4(p * 2.0 - 1.0, 1.0, 1.0); }`;
const FS = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform mat4 uInv; uniform float uE0, uK, uNight, uT, uSunOn; uniform vec3 uTop, uHor, uSunV, uSunC, uMoonV; uniform vec2 uTexE; uniform sampler2D uTex;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec2 n = vUV * 2.0 - 1.0;
  vec4 a = uInv * vec4(n, -1.0, 1.0), b = uInv * vec4(n, 1.0, 1.0);
  vec3 d = normalize(b.xyz / b.w - a.xyz / a.w);
  float az = atan(d.x, -d.z), el = asin(clamp(d.y, -1.0, 1.0));
  float e = clamp((el - uE0) * uK, -1.5, 1.5);
  vec3 r = vec3(sin(az) * cos(e), sin(e), -cos(az) * cos(e));
  vec3 c = mix(uHor, uTop, pow(clamp(e / 0.9, 0.0, 1.0), 0.6));
  // the sun: a wide glow, a tight one, the disc
  float sd = max(dot(r, uSunV), 0.0);
  c += uSunC * (pow(sd, 6.0) * 0.22 + pow(sd, 90.0) * 0.55) * uSunOn;
  c = mix(c, mix(uSunC, vec3(1.0), 0.6), smoothstep(0.99955, 0.99975, sd) * uSunOn);
  // the moon (night), a faint halo round it
  float md = max(dot(r, uMoonV), 0.0), moon = smoothstep(0.99975, 0.99985, md) * uNight;
  c += vec3(0.5, 0.6, 0.9) * pow(md, 400.0) * 0.25 * uNight;
  vec2 mq = (r.xy - uMoonV.xy) * 3000.0; float spots = 0.88 + 0.12 * sin(mq.x * 0.7) * sin(mq.y * 0.9);
  c = mix(c, vec3(0.96, 0.95, 0.86) * spots, moon);
  // stars (night): a few per cell of a grid on the sky, twinkling
  if (uNight > 0.01) {
    vec2 g = vec2(az, e) * 160.0, id = floor(g); float h = hash(id);
    if (h > 0.975) { vec2 f = fract(g) - 0.5 - (vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5) * 0.6; float s = smoothstep(0.16, 0.0, length(f)) * (h - 0.975) * 40.0;
      c += vec3(0.9, 0.93, 1.0) * s * uNight * smoothstep(0.02, 0.3, e) * (0.75 + 0.25 * sin(uT * 3.0 + h * 90.0)); }
  }
  // the clouds and the land round the court (the panorama)
  vec4 p = texture(uTex, vec2(az / 6.28318 + 0.5, clamp((uTexE.x - e) / (uTexE.x - uTexE.y), 0.0, 1.0)));
  c = mix(c, p.rgb, p.a);
  o = vec4(c, 1.0);
}`;

export class SkyBox {
  constructor(v) { this.v = v; this.gl = null; this.prog = null; this.tex = null; this.key = ""; this.broken = false; }
  theme() {
    const v = this.v, lk = v.courtLook && v.courtLook();
    if (lk && lk.name === "final") return lk.title === "ISLAND OPEN" ? "tropics" : "city";
    return THEME_BY_MAP[v.mapId()] || "campus";
  }
  hour() { const L = this.v.light; return L && !L.broken && L.active ? L.hourFor("court") : 15; }
  init(gl) {
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.gl = gl; this.prog = p; this.vao = gl.createVertexArray(); this.u = {};
    for (const k of ["uInv", "uE0", "uK", "uNight", "uT", "uSunOn", "uTop", "uHor", "uSunV", "uSunC", "uMoonV", "uTexE", "uTex"]) this.u[k] = gl.getUniformLocation(p, k);
  }
  // draw the sky into the bound target for this court view (mvp: the scene's view-projection); the caller restores its program
  draw(gl, mvp) {
    if (this.broken) return false;
    try {
      if (!this.prog) this.init(gl);
      const S = skyColours(this.hour()), theme = this.theme();
      const key = theme + ":" + (Math.round(S.h * 4) / 4);
      if (key !== this.key) { this.key = key; this.upload(gl, panorama(theme, S)); }
      const inv = invert(mvp), un = q => { const w = inv[3] * q[0] + inv[7] * q[1] + inv[11] * q[2] + inv[15]; return [0, 1, 2].map(i => (inv[i] * q[0] + inv[4 + i] * q[1] + inv[8 + i] * q[2] + inv[12 + i]) / w); };
      const st = this.v.stadium, hy = st && st.active && st.built && st.built.skyY != null ? st.built.skyY : HORIZON_AT[1];   // (the far stand's height: VENUES rows)
      const eye = un([0, 0, -1]), dx = HORIZON_AT[0] - eye[0], dz = HORIZON_AT[2] - eye[2], e0 = Math.atan2(hy - eye[1], Math.hypot(dx, dz));
      const U = this.u, c3 = a => a.map(x => x / 255);
      gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(U.uTex, 0);
      gl.uniformMatrix4fv(U.uInv, false, inv); gl.uniform1f(U.uE0, e0); gl.uniform1f(U.uK, STRETCH);
      gl.uniform1f(U.uNight, S.night); gl.uniform1f(U.uT, performance.now() / 1000); gl.uniform1f(U.uSunOn, S.sunEl > -0.05 ? 1 : 0);
      gl.uniform3fv(U.uTop, c3(S.top)); gl.uniform3fv(U.uHor, c3(S.hor)); gl.uniform3fv(U.uSunC, c3(S.sunC));
      gl.uniform3fv(U.uSunV, dirOf(S.sunAz, Math.max(S.sunEl * SUN_LOW, -0.2))); gl.uniform3fv(U.uMoonV, dirOf(MOON[0], MOON[1])); gl.uniform2f(U.uTexE, TEX_TOP, TEX_BOT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.enable(gl.BLEND);
      if (this.v.light) this.v.light.skyDrawn = true;
      return true;
    } catch (e) { console.warn("sky", e); this.broken = true; gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.enable(gl.BLEND); return false; }
  }
  upload(gl, cv) {
    if (!this.tex) this.tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
}

// ---- the panorama: x = azimuth (-pi at 0, the far end in the middle), y = elevation TEX_TOP (row 0) .. TEX_BOT (the last row) ----
const Y = el => (TEX_TOP - el) / (TEX_TOP - TEX_BOT) * TH, HY = Y(0), DEG = Math.PI / 180;
const X = az => (az / (2 * Math.PI) + 0.5) * TW;
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
// a ridge: heights (radians) along x from a sum of waves; drawn filled down to the bottom, wrapping round
function ridge(g, f, fill, step = 4) {
  g.fillStyle = fill; g.beginPath(); g.moveTo(0, TH);
  for (let x = 0; x <= TW; x += step) g.lineTo(x, Y(f(x)));
  g.lineTo(TW, TH); g.closePath(); g.fill();
}
const waves = (r, n, amp, base) => { const w = []; for (let i = 0; i < n; i++) w.push([1 + Math.floor(r() * (6 + i * 8)), r() * 6.28, amp / (1 + i * 0.9)]); return x => base + w.reduce((s, [k, ph, a]) => s + a * Math.sin(x / TW * 6.2832 * k + ph), 0); };
export function panorama(theme, S) {
  const cv = document.createElement("canvas"); cv.width = TW; cv.height = TH; const g = cv.getContext("2d"), r = rng(theme.length * 977 + 13);
  const night = S.night, dim = 1 - 0.82 * night, sunset = S.sunEl > -0.05 && S.sunEl < 12 * DEG ? 1 - S.sunEl / (12 * DEG) : 0;
  // haze: far shapes take the horizon's colour; a shape's own colour dimmed at night
  const tone = (c, haze) => mixA(c.map(v => v * dim), S.hor, haze);
  const sunX = X(S.sunAz);
  // ---- clouds: soft puffs in loose clusters, lit from the sun's side ----
  const cloudLit = mixA(mixA([255, 255, 255], S.sunC, 0.35 + sunset * 0.5), S.top, night * 0.85), cloudShade = mixA(mixA(S.hor, [120, 130, 150], 0.5), S.top, 0.3 + night * 0.5);
  const puffs = (n, elLo, elHi, alpha) => {
    for (let i = 0; i < n; i++) {
      const cx = r() * TW, el = elLo + r() * (elHi - elLo), cy = Y(el), w = 80 + r() * 260, k = 0.7 + r() * 0.6;
      for (let j = 0; j < 9; j++) {
        const px = cx + (r() - 0.5) * w * 1.6, py = cy + (r() - 0.6) * w * 0.25, pr = w * (0.25 + r() * 0.3) * k;
        const gr = g.createRadialGradient(px, py - pr * 0.35, pr * 0.1, px, py, pr);
        gr.addColorStop(0, rgb(cloudLit, alpha)); gr.addColorStop(0.6, rgb(mixA(cloudLit, cloudShade, 0.5), alpha * 0.85)); gr.addColorStop(1, rgb(cloudShade, 0));
        g.fillStyle = gr; g.beginPath(); g.ellipse(px, py, pr * 1.5, pr * 0.62, 0, 0, 7); g.fill();
      }
    }
  };
  const n = { tropics: 26, volcano: 10, city: 22 }[theme] ?? 34;
  puffs(n, 3 * DEG, 14 * DEG, 0.85 - night * 0.45); puffs(Math.round(n * 0.6), 14 * DEG, 40 * DEG, 0.7 - night * 0.4);
  // ---- the land round the court (themes) ----
  const land = (near, far) => { const gr = g.createLinearGradient(0, HY, 0, TH); gr.addColorStop(0, rgb(tone(far, 0.55))); gr.addColorStop(1, rgb(tone(near, 0.1))); g.fillStyle = gr; g.fillRect(0, HY, TW, TH - HY); };
  const hills = (c, base, amp, haze, n = 5) => ridge(g, waves(r, n, amp, base), rgb(tone(c, haze)));
  const trees = (c, base, haze, size = 0.6 * DEG) => {
    g.fillStyle = rgb(tone(c, haze)); const f = waves(r, 4, 0.6 * DEG, base);
    for (let x = 0; x < TW; x += 6 + r() * 10) { const y = Y(f(x)), s = (size + r() * size) / (TEX_TOP - TEX_BOT) * TH; g.beginPath(); g.ellipse(x, y - s * 0.6, s * 0.9, s, 0, 0, 7); g.fill(); }
    ridge(g, x => f(x) - 0.15 * DEG, rgb(tone(c, haze)));
  };
  const lit = (x, y, w, h, p) => { if (night < 0.3) return; g.fillStyle = `rgba(255,214,130,${0.85 * night})`; for (let yy = y + 3; yy < y + h - 3; yy += 7) for (let xx = x + 3; xx < x + w - 3; xx += 6) if (r() < p) g.fillRect(xx, yy, 3, 4); };
  const block = (x, w, h, c, haze, p = 0.3) => { const y = Y(h); g.fillStyle = rgb(tone(c, haze)); g.fillRect(x, y, w, HY - y + 2); lit(x, y, w, HY - y, p); };
  if (theme === "tropics") {
    // the sea to the horizon, the sun's (or moon's) path on it
    const gr = g.createLinearGradient(0, HY, 0, TH); gr.addColorStop(0, rgb(mixA(S.hor, [40, 120, 170], 0.35 + 0.3 * dim))); gr.addColorStop(1, rgb(mixA([10, 60, 110], S.top, 0.3).map(v => v * (0.4 + 0.6 * dim))));
    g.fillStyle = gr; g.fillRect(0, HY, TW, TH - HY);
    const glitter = (x0, c, a) => { for (let i = 0; i < 700; i++) { const y = HY + Math.pow(r(), 1.7) * (TH - HY), sp = 8 + (y - HY) * 0.35, x = x0 + (r() - 0.5) * sp * 2; g.fillStyle = rgb(c, a * (1 - (y - HY) / (TH - HY))); g.fillRect(x, y, 6 + r() * 14, 1.5); } };
    if (S.sunEl > -0.05) glitter(sunX, mixA(S.sunC, [255, 255, 255], 0.4), 0.8); else if (night > 0.5) glitter(X(MOON[0]), [220, 225, 255], 0.45);
    for (let i = 0; i < 6; i++) {                                               // islands, a palm or two on each
      const cx = r() * TW, w = 60 + r() * 160, h = (0.5 + r() * 1.5) * DEG, c = tone([40, 110, 60], 0.45);
      g.fillStyle = rgb(c); g.beginPath(); g.ellipse(cx, HY, w, (HY - Y(h)), 0, Math.PI, 0); g.fill();
      for (let k = 0; k < 1 + (r() * 3 | 0); k++) {
        const px = cx + (r() - 0.5) * w, top = HY - (HY - Y(h)) - 18 - r() * 22;
        g.strokeStyle = rgb(tone([70, 50, 30], 0.4)); g.lineWidth = 3; g.beginPath(); g.moveTo(px, HY - (HY - Y(h)) * 0.6); g.quadraticCurveTo(px + 6, (top + HY) / 2, px + 3, top); g.stroke();
        g.strokeStyle = rgb(c); g.lineWidth = 4; for (let f = 0; f < 6; f++) { const a = -Math.PI / 2 + (f - 2.5) * 0.55; g.beginPath(); g.moveTo(px + 3, top); g.quadraticCurveTo(px + 3 + Math.cos(a) * 14, top + Math.sin(a) * 10 - 4, px + 3 + Math.cos(a) * 24, top + 8 + Math.abs(Math.cos(a)) * 6); g.stroke(); }
      }
    }
  } else if (theme === "volcano") {
    land([40, 20, 20], [90, 50, 50]);
    // a red pall on the low sky
    const gr = g.createLinearGradient(0, Y(25 * DEG), 0, HY); gr.addColorStop(0, "rgba(120,20,10,0)"); gr.addColorStop(1, `rgba(200,60,20,${0.35 + 0.3 * night})`); g.fillStyle = gr; g.fillRect(0, Y(25 * DEG), TW, HY - Y(25 * DEG));
    hills([70, 40, 50], 2.5 * DEG, 2.5 * DEG, 0.55, 7);
    for (const [ax, hh, w] of [[0.43, 8.5, 330], [0.6, 6, 260], [0.3, 5, 220]]) {     // volcanoes: a cone, lava in its crater and down its side, smoke
      const cx = ax * TW, top = Y(hh * DEG), lip = w * 0.12;
      g.fillStyle = rgb(mixA(tone([90, 56, 60], 0.3), [70, 24, 20], night * 0.6)); g.beginPath(); g.moveTo(cx - w, HY + 2); g.lineTo(cx - lip, top); g.lineTo(cx + lip, top); g.lineTo(cx + w, HY + 2); g.closePath(); g.fill();
      for (const [dx, len] of [[-0.35, 0.45], [0.2, 0.3], [0.6, 0.22]]) {      // lava down its flanks: narrow glowing wedges from the lip
        const x0 = cx + dx * lip, y1 = top + (HY - top) * len, x1 = x0 + dx * w * len * 0.9, lv = g.createLinearGradient(0, top, 0, y1);
        lv.addColorStop(0, "rgba(255,200,80,0.95)"); lv.addColorStop(1, "rgba(255,70,20,0)"); g.fillStyle = lv;
        g.beginPath(); g.moveTo(x0 - 5, top); g.lineTo(x0 + 5, top); g.lineTo(x1 + 2, y1); g.lineTo(x1 - 2, y1); g.closePath(); g.fill();
      }
      g.fillStyle = "rgba(255,150,40,0.9)"; g.fillRect(cx - lip, top - 2, lip * 2, 4);
      for (let i = 0; i < 26; i++) { const t = i / 26, sx = cx + Math.sin(t * 5) * 30 * t + t * 160, sy = top - t * (top - Y((hh + 18) * DEG)), sr = 20 + t * 80; const sg = g.createRadialGradient(sx, sy, 0, sx, sy, sr); sg.addColorStop(0, `rgba(${60 + 80 * (1 - t)},${40 + 20 * (1 - t)},40,${0.5 * (1 - t)})`); sg.addColorStop(1, "rgba(40,30,30,0)"); g.fillStyle = sg; g.fillRect(sx - sr, sy - sr, sr * 2, sr * 2); }
      const glow = g.createRadialGradient(cx, top, 0, cx, top, 220); glow.addColorStop(0, `rgba(255,120,40,${0.4 + 0.4 * night})`); glow.addColorStop(1, "rgba(255,80,20,0)"); g.fillStyle = glow; g.fillRect(cx - 220, top - 220, 440, 440);
    }
    hills([50, 26, 30], 1 * DEG, 1.2 * DEG, 0.2, 9);
  } else if (theme === "city") {
    land([40, 60, 50], [90, 110, 110]);
    for (let x = 0; x < TW;) { const w = 30 + r() * 70, h = (1.5 + r() * r() * 9) * DEG; block(x, w, h, [70 + r() * 30, 80 + r() * 30, 100 + r() * 30], 0.55, 0.35); x += w + r() * 6; }
    for (let x = 0; x < TW;) { const w = 40 + r() * 90, h = (0.8 + r() * 3.5) * DEG; block(x, w, h, [50, 60, 75], 0.3, 0.45); x += w + 2 + r() * 20; }
    if (night > 0.3) for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,60,60,${night})`; g.fillRect(r() * TW, Y((3 + r() * 6) * DEG), 3, 3); }
  } else if (theme === "airfield") {
    land([70, 110, 60], [140, 160, 120]);
    hills([110, 130, 120], 0.6 * DEG, 0.8 * DEG, 0.65, 4);
    for (let i = 0; i < 7; i++) {                                               // hangars: an arched roof over a dark door
      const cx = r() * TW, w = 90 + r() * 120, h = (1.2 + r() * 1.2) * DEG, c = tone([130, 120, 110], 0.4);
      g.fillStyle = rgb(c); g.beginPath(); g.moveTo(cx - w / 2, HY + 2); g.lineTo(cx - w / 2, Y(h * 0.55)); g.quadraticCurveTo(cx, Y(h * 1.35), cx + w / 2, Y(h * 0.55)); g.lineTo(cx + w / 2, HY + 2); g.fill();
      g.fillStyle = rgb(tone([40, 40, 46], 0.3)); g.fillRect(cx - w * 0.3, Y(h * 0.5), w * 0.6, HY - Y(h * 0.5) + 2); lit(cx - w * 0.3, Y(h * 0.5), w * 0.6, HY - Y(h * 0.5), 0.2);
    }
    const tx = 0.535 * TW; block(tx, 24, 8 * DEG, [150, 150, 150], 0.4, 0); g.fillStyle = rgb(tone([60, 90, 110], 0.3)); g.fillRect(tx - 12, Y(10 * DEG), 48, Y(8 * DEG) - Y(10 * DEG)); lit(tx - 12, Y(10 * DEG), 48, Y(8 * DEG) - Y(10 * DEG), 0.9);   // the control tower
    g.strokeStyle = rgb(tone([90, 90, 90], 0.4)); g.lineWidth = 2; const wx = 0.47 * TW; g.beginPath(); g.moveTo(wx, HY); g.lineTo(wx, Y(2.2 * DEG)); g.stroke(); g.fillStyle = "rgba(255,120,40,0.9)"; g.beginPath(); g.moveTo(wx, Y(2.2 * DEG)); g.lineTo(wx + 26, Y(2.0 * DEG)); g.lineTo(wx, Y(1.8 * DEG)); g.fill();
  } else if (theme === "jungle") {
    land([20, 60, 30], [70, 110, 80]);
    ridge(g, x => { const f = waves(r, 1, 0, 0); return 5 * DEG + 4 * DEG * Math.abs(Math.sin(x / TW * 6.28 * 5 + 1)) + 2 * DEG * Math.sin(x / TW * 6.28 * 13) + f(x); }, rgb(tone([40, 90, 60], 0.65)), 3);
    const mist = g.createLinearGradient(0, Y(4 * DEG), 0, HY); mist.addColorStop(0, rgb(S.hor, 0)); mist.addColorStop(1, rgb(S.hor, 0.7)); g.fillStyle = mist; g.fillRect(0, Y(4 * DEG), TW, HY - Y(4 * DEG));
    hills([30, 80, 40], 2 * DEG, 1.5 * DEG, 0.4, 6); trees([20, 70, 30], 1 * DEG, 0.15, 0.9 * DEG);
  } else if (theme === "pipes") {
    land([60, 150, 60], [120, 190, 120]);
    for (let i = 0; i < 14; i++) {                                              // round hills, striped, with two little eyes
      const cx = r() * TW, w = 80 + r() * 180, h = (2 + r() * 5) * DEG, c = tone(r() < 0.5 ? [80, 190, 80] : [120, 200, 90], 0.35), top = Y(h);
      g.fillStyle = rgb(c); g.beginPath(); g.moveTo(cx - w / 2, HY + 2); g.lineTo(cx - w / 2, top + w / 2); g.arc(cx, top + w / 2, w / 2, Math.PI, 0); g.lineTo(cx + w / 2, HY + 2); g.fill();
      g.strokeStyle = rgb(tone([30, 80, 30], 0.3)); g.lineWidth = 3; g.stroke();
      g.fillStyle = rgb(tone([30, 80, 30], 0.3)); g.fillRect(cx - w * 0.14, top + w * 0.3, 5, 14); g.fillRect(cx + w * 0.1, top + w * 0.3, 5, 14);
    }
    for (let i = 0; i < 6; i++) { const cx = r() * TW, w = 34, h = (1 + r() * 2) * DEG, c = tone([40, 170, 60], 0.25); g.fillStyle = rgb(c); g.fillRect(cx - w / 2, Y(h), w, HY - Y(h) + 2); g.fillRect(cx - w * 0.65, Y(h) - 10, w * 1.3, 14); g.strokeStyle = rgb(tone([10, 60, 20], 0.2)); g.lineWidth = 2; g.strokeRect(cx - w * 0.65, Y(h) - 10, w * 1.3, 14); }
  } else if (theme === "castle") {
    land([60, 120, 60], [120, 160, 130]);
    const peaks = x => 3 * DEG + 5 * DEG * Math.pow(Math.abs(Math.sin(x / TW * 6.2832 * 4 + 0.6)), 3) + 1.5 * DEG * Math.abs(Math.sin(x / TW * 6.2832 * 11));
    ridge(g, peaks, rgb(tone([110, 120, 150], 0.7)), 3);
    g.fillStyle = rgb(tone([240, 245, 255], 0.5)); for (let x = 0; x < TW; x += 3) { const h = peaks(x); if (h > 6 * DEG) g.fillRect(x, Y(h), 3, Y(h - 1.2 * DEG) - Y(h)); }   // snow on the high peaks
    hills([80, 150, 80], 1.6 * DEG, 1.4 * DEG, 0.45, 5);
    for (const [ax, th] of [[0.43, 10], [0.452, 13], [0.474, 9]]) { const tx = ax * TW; block(tx, 30, th * DEG, [220, 210, 220], 0.45, 0.25); g.fillStyle = rgb(tone([230, 90, 140], 0.4)); g.beginPath(); g.moveTo(tx - 6, Y(th * DEG)); g.lineTo(tx + 15, Y((th + 4) * DEG)); g.lineTo(tx + 36, Y(th * DEG)); g.fill(); }   // a far castle's towers
    trees([40, 110, 50], 0.7 * DEG, 0.25);
  } else {                                                                       // campus
    land([60, 130, 60], [120, 170, 120]);
    hills([90, 140, 110], 2 * DEG, 1.8 * DEG, 0.62, 5);
    hills([70, 140, 70], 1 * DEG, 1.2 * DEG, 0.4, 6);
    for (let i = 0; i < 9; i++) { const x = r() * TW, w = 40 + r() * 70; block(x, w, (1.2 + r() * 2) * DEG, [200, 190, 175], 0.45, 0.4); g.fillStyle = rgb(tone([170, 70, 60], 0.45)); g.fillRect(x - 3, Y((1.2 + 0.1) * DEG) - 5, w + 6, 5); }
    const cx = 0.5 * TW + 230; block(cx, 26, 9 * DEG, [210, 200, 190], 0.4, 0.2); g.fillStyle = rgb(tone([170, 70, 60], 0.4)); g.beginPath(); g.moveTo(cx - 4, Y(9 * DEG)); g.lineTo(cx + 13, Y(11.5 * DEG)); g.lineTo(cx + 30, Y(9 * DEG)); g.fill(); g.fillStyle = rgb(tone([240, 240, 230], 0.3)); g.beginPath(); g.arc(cx + 13, Y(8 * DEG), 8, 0, 7); g.fill();   // the clock tower
    trees([40, 110, 50], 0.6 * DEG, 0.2);
  }
  return cv;
}
