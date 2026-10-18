// HD-2D style lighting for the 3D / VOX views ("LIGHT: Off / Day / Auto"). A render-time layer: it only changes how the
// finished 3D scene is shown, never the game (frame hashes, replays and emulation timing are untouched).
//
// How it works (voxel.js has four small hooks, all marked "LIGHT"):
//   begin()   the scene is drawn into an off-screen target (colour + depth) instead of the canvas,
//   camera()  the view-projection of the scene (for world positions and sun rays),
//   post()    right before the HUD / dialogue overlays: the scene is resolved and the passes below run, ending on the canvas,
//   finish()  the same, if the scene ended without reaching the overlays.
// Passes (all but the last at reduced resolution):
//   sun shadows  screen-space: each ground pixel marches towards the sun through the depth buffer (buildings, trees, bodies,
//                the net, a thin card or a voxel alike), then a small blur makes the edge soft,
//   blur chain   quarter-resolution blur of the picture: tilt-shift depth of field and the local average that finds lamps
//                and windows (bright spots on a darker surround) which glow at dusk and night,
//   glow         the bright spots and highlights, blurred twice as wide: bloom, and light spilling onto what is round them,
//   composite    full resolution: depth of field, sun / shade tint (warm light, cool shade), point lights (fountains, the
//                court's floodlights), glow, split-tone colour grade, vignette, dither.
// Time of day: Auto follows the device clock (morning, noon, sunset, night), Day is a fixed bright afternoon.
// Quality tiers: 2 = shadows + depth of field + glow + 4x multisampling (desktop default), 1 = the same without multisampling and with cheaper
// shadows (touch devices start here), 0 = grade + glow + vignette only;
// the tier drops by itself when the GPU timer (where the browser has one) shows the passes taking too long.
const KEY = "mt-light";
export const LIGHT_MODES = ["off", "day", "auto"];
// the LIGHT settings (web/js/lightpanel.js is the panel), remembered in localStorage mt-lightcfg:
//   world: the overworld's time: off | day | clock (the phone's clock) | custom (customHour), matches: same (as the overworld) | day | night | random
//   (each match rolls morning, noon, sunset or night once, seeded by the frame the match scene starts at, so a replay rolls the same),
//   fx: shadows, bloom, tilt-shift, vignette, night lights; quality: auto | low | medium | high (tier 0 / 1 / 2)
const CFG_KEY = "mt-lightcfg";
export const MATCH_HOURS = [8, 12, 18.4, 22], MATCH_NAMES = ["morning", "noon", "sunset", "night"];
const defaultCfg = () => ({ world: null, customHour: 18.5, matches: "same", fx: { shadows: true, bloom: true, tilt: true, vignette: true, night: true, floors: true }, quality: "auto" });
export const hourName = h => h < 5 ? "night" : h < 7 ? "dawn" : h < 10 ? "morning" : h < 15 ? "noon" : h < 17.5 ? "afternoon" : h < 19.5 ? "sunset" : h < 21 ? "dusk" : "night";
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// the court's floodlight towers (x, z; the lamps hang 820 above the ground), behind the corners of the stands so they light the court,
// the stands and the crowd from above and behind: stadium3d.js builds its towers here
export const FLOODS = [[-1980, -2580], [1980, -2580], [-2080, 2050], [2080, 2050]];
export const FLOOD_HEIGHT = 820;
// ---- time of day ----
// az: where the sun is, degrees from "behind the scene" (+ = to the right of the view); el: its height; sun / amb: light colour on lit
// surfaces / in shadow (1 = the game's own colours); exp, sat, con: grade; lamps: how much lamps, windows and fountains shine (0..1);
// bloom: highlight glow; vig: vignette; tone: warm/cool split tone of the grade (r, g, b multipliers for highlights)
const KF = [
  { h: 0,    az: -50, el: 38, sun: [0.16, 0.25, 0.46], amb: [0.02, 0.08, 0.40], exp: 1.1, sat: 0.9, con: 1.06, lamps: 1.00, bloom: 0.8, vig: 0.62, tone: [0.42, 0.95, 1.2], thr: 0.96 },
  { h: 5,    az: -50, el: 38, sun: [0.16, 0.25, 0.46], amb: [0.02, 0.08, 0.40], exp: 1.1, sat: 0.9, con: 1.06, lamps: 1.00, bloom: 0.8, vig: 0.62, tone: [0.42, 0.95, 1.2], thr: 0.96 },
  { h: 6.2,  az: 80,  el: 8,  sun: [1.05, 0.62, 0.52], amb: [0.40, 0.44, 0.70], exp: 1.12, sat: 1.00, con: 1.08, lamps: 0.55, bloom: 0.9, vig: 0.58, tone: [1.10, 0.94, 0.88] },
  { h: 7.8,  az: 68,  el: 26, sun: [1.16, 0.98, 0.76], amb: [0.60, 0.68, 0.92], exp: 1.03, sat: 1.10, con: 1.08, lamps: 0.00, bloom: 0.7, vig: 0.48, tone: [1.08, 1.00, 0.92] },
  { h: 12,   az: -28, el: 50, sun: [1.10, 1.04, 0.95], amb: [0.64, 0.73, 0.98], exp: 1.03, sat: 1.16, con: 1.09, lamps: 0.00, bloom: 0.6, vig: 0.42, tone: [1.04, 1.02, 0.97] },
  { h: 16.3, az: -48, el: 38, sun: [1.17, 1.01, 0.79], amb: [0.64, 0.70, 0.94], exp: 1.03, sat: 1.12, con: 1.08, lamps: 0.00, bloom: 0.7, vig: 0.46, tone: [1.08, 1.00, 0.92] },
  { h: 18.4, az: -76, el: 13, sun: [1.38, 0.84, 0.50], amb: [0.50, 0.50, 0.80], exp: 1.00, sat: 1.10, con: 1.10, lamps: 0.28, bloom: 0.9, vig: 0.54, tone: [1.14, 0.96, 0.84], thr: 0.80 },
  { h: 19.6, az: -82, el: 4,  sun: [0.95, 0.50, 0.48], amb: [0.34, 0.38, 0.68], exp: 1.06, sat: 1.0, con: 1.08, lamps: 0.78, bloom: 0.9, vig: 0.58, tone: [1.06, 0.94, 0.96], thr: 0.88 },
  { h: 21,   az: -50, el: 38, sun: [0.16, 0.25, 0.46], amb: [0.02, 0.08, 0.40], exp: 1.1, sat: 0.9, con: 1.06, lamps: 1.00, bloom: 0.8, vig: 0.62, tone: [0.42, 0.95, 1.2], thr: 0.96 },
  { h: 24,   az: -50, el: 38, sun: [0.16, 0.25, 0.46], amb: [0.02, 0.08, 0.40], exp: 1.1, sat: 0.9, con: 1.06, lamps: 1.00, bloom: 0.8, vig: 0.62, tone: [0.42, 0.95, 1.2], thr: 0.96 },
];
for (const k of KF) k.thr ??= 0.74;                  // the bloom threshold: raised at night so only floodlights and genuinely bright pixels glow
// RPG maps indoors (dorm, cafe, hall, centre ...): lit by lamps whatever the hour, so they keep one warm look
export const INDOOR_MAPS = new Set([17, 18, 25, 33, 34, 35]);
const INDOOR = { thr: 0.74, h: 12, az: -30, el: 70, sun: [1.06, 1.0, 0.90], amb: [0.80, 0.79, 0.90], exp: 1.02, sat: 1.08, con: 1.06, lamps: 0.16, bloom: 0.6, vig: 0.50, tone: [1.06, 1.0, 0.94], shade: 0.55 };
const mixArr = (a, b, t) => Array.isArray(a) ? a.map((v, i) => lerp(v, b[i], t)) : lerp(a, b, t);
export function skyAt(hour) {                       // interpolated parameters for an hour of the day (0..24)
  const h = ((hour % 24) + 24) % 24; let i = 0; while (i < KF.length - 2 && h >= KF[i + 1].h) i++;
  const a = KF[i], b = KF[i + 1], t = clamp((h - a.h) / (b.h - a.h)), s = t * t * (3 - 2 * t), o = {};
  for (const k of Object.keys(a)) o[k] = k === "h" ? h : mixArr(a[k], b[k], s);
  return o;
}
export const hourNow = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; };

// ---- small matrix helpers (column-major, like voxel.js) ----
const mul = (a, b) => { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; };
const apply = (m, v) => { const o = [0, 0, 0, 0]; for (let i = 0; i < 4; i++) o[i] = m[i] * v[0] + m[4 + i] * v[1] + m[8 + i] * v[2] + m[12 + i] * v[3]; return o; };
function invert(a) {                                  // general 4x4 inverse
  const o = new Float32Array(16);
  // Gauss-Jordan on a 4x8 augmented matrix: short, and plenty fast for one call per frame
  const r = []; for (let i = 0; i < 4; i++) { r.push([a[i], a[4 + i], a[8 + i], a[12 + i], i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0, i === 3 ? 1 : 0]); }
  for (let c = 0; c < 4; c++) {
    let p = c; for (let i = c + 1; i < 4; i++) if (Math.abs(r[i][c]) > Math.abs(r[p][c])) p = i;
    [r[c], r[p]] = [r[p], r[c]]; const d = r[c][c] || 1e-12; for (let j = 0; j < 8; j++) r[c][j] /= d;
    for (let i = 0; i < 4; i++) if (i !== c) { const f = r[i][c]; if (f) for (let j = 0; j < 8; j++) r[i][j] -= f * r[c][j]; }
  }
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) o[j * 4 + i] = r[i][4 + j];
  return o;
}

// ---- shaders ----
const VS = `#version 300 es
out vec2 vUV;
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUV = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
const HEAD = `#version 300 es
precision highp float; precision highp sampler2D; in vec2 vUV; out vec4 o;
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;
// sun shadows: march from the pixel's surface towards the sun, entirely in clip space (a straight line there), and compare the
// ray's depth with the depth buffer. A hit within the thickness window (thin cards and voxels alike) shadows the pixel.
const FS_SHADOW = HEAD + `
uniform sampler2D uDepth; uniform vec2 uNF; uniform vec4 uDClip; uniform vec2 uThick; uniform int uSteps;
float lin(float d) { return 2.0 * uNF.x * uNF.y / ((uNF.y + uNF.x) - (d * 2.0 - 1.0) * (uNF.y - uNF.x)); }
void main() {
  float d = texture(uDepth, vUV).r;
  if (d >= 0.99999) { o = vec4(1.0); return; }
  float w = lin(d); vec4 cp = vec4((vUV * 2.0 - 1.0) * w, (d * 2.0 - 1.0) * w, w);
  float j = ign(gl_FragCoord.xy), lit = 1.0, run = 0.0;
  for (int i = 0; i < 40; i++) {
    if (i >= uSteps) break;
    float t = (float(i) + j) / float(uSteps); t = t * t * 0.85 + t * 0.15;
    vec4 c = cp + uDClip * t; if (c.w < uNF.x) break;
    vec2 uv = c.xy / c.w * 0.5 + 0.5; if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) break;
    float diff = c.w - lin(texture(uDepth, uv).r);
    if (diff > uThick.x * (0.4 + t) && diff < uThick.y) { run += 1.0; if (run >= 1.0) { lit = 0.0; break; } }
  }
  o = vec4(lit, lit, lit, 1.0);
}`;
const FS_BLUR = HEAD + `
uniform sampler2D uTex; uniform vec2 uDir; uniform sampler2D uDepth; uniform float uUseDepth; uniform vec2 uNF;
float lin(float d) { return 2.0 * uNF.x * uNF.y / ((uNF.y + uNF.x) - (d * 2.0 - 1.0) * (uNF.y - uNF.x)); }
void main() {
  vec4 c = texture(uTex, vUV) * 0.227027;
  float w0 = 0.227027;
  float d0 = uUseDepth > 0.5 ? lin(texture(uDepth, vUV).r) : 0.0;
  for (int i = 1; i <= 2; i++) {
    float off = i == 1 ? 1.3846154 : 3.2307692, wt = i == 1 ? 0.3162162 : 0.0702703;
    for (int s = -1; s <= 1; s += 2) {
      vec2 uv = vUV + uDir * off * float(s); float k = wt;
      if (uUseDepth > 0.5) k *= 1.0 - smoothstep(4.0, 30.0, abs(lin(texture(uDepth, uv).r) - d0) * 0.05 * uNF.x);
      c += texture(uTex, uv) * k; w0 += k;
    }
  }
  o = c / w0;
}`;
const FS_DOWN = HEAD + `
uniform sampler2D uTex; uniform vec2 uTexel;
void main() { vec3 c = texture(uTex, vUV + uTexel * vec2(-1.0, -1.0)).rgb + texture(uTex, vUV + uTexel * vec2(1.0, -1.0)).rgb + texture(uTex, vUV + uTexel * vec2(-1.0, 1.0)).rgb + texture(uTex, vUV + uTexel * vec2(1.0, 1.0)).rgb; o = vec4(c * 0.25, 1.0); }`;
// glow source: highlights (bloom) and lamps / windows (bright spots on a darker surround) when it is dusk or night
// glassy(): light blue panes, and warm yellow lamps; a blob (survives a 3x3 erosion) that is brighter than its surround
const GLASS = `
float glassy(vec3 c) { float blue = smoothstep(0.10, 0.30, c.b - c.r) * smoothstep(0.30, 0.45, c.g) * smoothstep(0.55, 0.75, c.b); float warm = smoothstep(0.75, 0.9, c.r) * smoothstep(0.65, 0.85, c.g) * (1.0 - smoothstep(0.35, 0.6, c.b)); return max(blue, warm); }
`;
const FS_EXTRACT = HEAD + GLASS + `
uniform sampler2D uQ, uB, uS, uD; uniform mat4 uInvVP; uniform vec2 uTexel; uniform float uHi, uEm, uThr, uLL, uGlass; uniform vec3 uLit;
vec3 wpos(vec2 uv) { vec4 p = uInvVP * vec4(uv * 2.0 - 1.0, texture(uD, uv).r * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
void main() {
  vec3 c = texture(uQ, vUV).rgb * uLL, b = texture(uB, vUV).rgb;
  // the surface's slope from the depth on both sides: at the edge of a figure standing on the ground one side crosses onto the figure,
  // the other stays on the ground, and only a surface that is upright on both sides counts as a wall (no glow rim around people)
  vec3 P0 = wpos(vUV), dx = vec3(uTexel.x, 0.0, 0.0), dy = vec3(0.0, uTexel.y, 0.0);
  vec3 n1 = normalize(cross(wpos(vUV + dx.xy) - P0, wpos(vUV + dy.xy) - P0)), n2 = normalize(cross(P0 - wpos(vUV - dx.xy), P0 - wpos(vUV - dy.xy)));
  float wall = (1.0 - smoothstep(0.35, 0.85, abs(n1.y))) * (1.0 - smoothstep(0.35, 0.85, abs(n2.y)));
  float dens = 0.0;                                              // how much of the area is lamp / window glass (taps on the full-resolution picture)
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) dens += glassy(texture(uS, vUV + vec2(float(x), float(y)) * uTexel * 0.8).rgb);
  float self = glassy(texture(uS, vUV).rgb);                     // the pixel itself glass, not only beside some (a blue court around a figure)
  float em = smoothstep(0.10, 0.45, dens / 9.0) * smoothstep(0.2, 0.6, self) * wall * uGlass;   // uGlass 0: a side-view map, whose sky would be taken for glass
  vec3 hi = max(c - uThr, 0.0) * uHi;
  o = vec4(hi + uLit * em * uEm, em);
}`;
const FS_COMP = HEAD + GLASS + `
uniform sampler2D uScene, uDepth, uShadow, uBlur, uGlow, uE;
uniform mat4 uInvVP; uniform mat4 uVP; uniform vec2 uNF; uniform vec2 uRes;
uniform vec3 uL; uniform vec3 uSun, uAmb; uniform float uShade, uWall;
uniform float uExp, uSat, uCon, uBloom, uGlowK, uSpill, uLamps, uVig, uDof; uniform vec3 uTone, uWarm;
uniform float uDbg; uniform vec4 uFocus;                    // y of the sharp band: centre, half height (0..1 of the screen), blur rise top, rise bottom
uniform int uNP; uniform vec4 uPP[6]; uniform vec3 uPC[6]; uniform vec4 uPool; uniform vec3 uPoolC;
uniform int uNF2; uniform vec4 uFl[4]; uniform vec3 uFC[4];
float lin(float d) { return 2.0 * uNF.x * uNF.y / ((uNF.y + uNF.x) - (d * 2.0 - 1.0) * (uNF.y - uNF.x)); }
void main() {
  vec3 c0 = texture(uScene, vUV).rgb; float d = texture(uDepth, vUV).r;
  vec3 b = texture(uBlur, vUV).rgb;
  // tilt-shift: sharp in a band across the middle, blurred towards the top and bottom edges
  float y = vUV.y, coc = y > uFocus.x ? smoothstep(uFocus.y, uFocus.y + uFocus.w, y - uFocus.x) : smoothstep(uFocus.y, uFocus.y + uFocus.z, uFocus.x - y);
  vec3 c = mix(c0, b, clamp(coc * uDof, 0.0, 1.0));
  // surface orientation from the depth: ground and roofs take the sun's shadows, walls are shaded by their angle to the sun
  vec4 wp = uInvVP * vec4(vUV * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); vec3 P = wp.xyz / wp.w;
  vec3 n = normalize(cross(dFdx(P), dFdy(P))); if (n.y < 0.0) n = -n;
  float up = smoothstep(0.35, 0.85, n.y);
  float sh = mix(1.0, texture(uShadow, vUV).r, uShade);
  float wall = clamp(dot(n, uL) * 0.5 + 0.55, 0.0, 1.0);
  float lit = mix(mix(0.55, 1.0, wall) * uWall + (1.0 - uWall), sh, up);
  if (d >= 0.99999) lit = 1.0;
  vec3 light = mix(uAmb, uSun, lit);
  // point lights
  vec3 add = vec3(0.0);
  for (int i = 0; i < 6; i++) { if (i >= uNP) break; vec3 dv = uPP[i].xyz - P; float r = length(dv) / uPP[i].w; float a = clamp(1.0 - r, 0.0, 1.0); a *= a; add += uPC[i] * a * (0.55 + 0.45 * clamp(dot(n, normalize(dv)), 0.0, 1.0)); }
  float poolW = 0.0;
  if (uPool.z > 0.0) { vec2 q = (P.xz - uPool.xy) / uPool.zw; poolW = 1.0 - smoothstep(0.62, 1.22, length(q)); add += uPoolC * poolW * mix(0.5, 1.0, mix(1.0, sh, up)); }
  vec4 g4 = texture(uGlow, vUV); vec3 gl = g4.rgb;
  // lamps / windows keep their own light and shine
  float em = smoothstep(0.1, 0.5, texture(uE, vUV).a) * smoothstep(0.2, 0.6, glassy(c0)) * (1.0 - up);   // lit panes and lamps (on walls)
  c = mix(c, vec3(lum(c)), 0.85 * poolW * up * uLamps);                          // the court does not glow in its own colour under the warm floodlights
  c = c * (light + add + gl * uSpill);
  c = mix(c, uWarm * (0.75 + 0.9 * lum(c0)), em * uLamps);
  c += gl * uGlowK;
  // floodlight glare
  for (int i = 0; i < 4; i++) {
    if (i >= uNF2) break;
    vec2 q = (vUV - uFl[i].xy) * vec2(uRes.x / uRes.y, 1.0); float r = length(q) / uFl[i].z;
    float vis = uFl[i].w; vec2 sc = uFl[i].xy; if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0) vis = 0.0;
    float glare = 1.0 / (1.0 + r * r * 14.0) + 0.5 * exp(-abs(q.y) / (uFl[i].z * 0.07)) * exp(-abs(q.x) / (uFl[i].z * 2.2));
    c += uFC[i] * glare * vis;
  }
  // grade: exposure, split-tone (warm / cool), saturation, soft contrast, vignette
  c *= uExp;
  float l = lum(c); c *= mix(vec3(1.0), uTone, smoothstep(0.1, 0.8, l));
  l = lum(c); c = mix(vec3(l), c, uSat);
  c = (c - 0.5) * uCon + 0.5; c = max(c, 0.0);
  c = c / (1.0 + max(c - 0.85, 0.0) * 0.6);                    // roll the highlights off softly
  vec2 v = (vUV - 0.5) * vec2(1.0, 0.85); c *= 1.0 - uVig * smoothstep(0.28, 0.78, length(v));
  c += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
  if (uDbg > 0.5) { if (uDbg < 1.5) o = vec4(vec3(texture(uShadow, vUV).r), 1.0); else if (uDbg < 2.5) o = vec4(gl.rgb, 1.0); else if (uDbg < 3.5) o = vec4(n * 0.5 + 0.5, 1.0); else o = vec4(vec3(em), 1.0); }
}`;

export class Lighting {
  constructor(voxel) {
    this.v = voxel; this.gl = voxel.gl;
    const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
    let m = q.get("light"); if (m === null) { try { m = localStorage.getItem(KEY); } catch (e) { m = null; } }
    this.mode = LIGHT_MODES.includes(m) ? m : "off";
    this.hourOverride = q.has("hour") ? parseFloat(q.get("hour")) : null;
    this.cfg = this.loadCfg(q.has("light") || q.has("hour"));
    this.dbg = q.has("lightdbg") ? +q.get("lightdbg") : 0; this.tierWant = q.has("lightq") ? +q.get("lightq") : (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? 1 : 2); this.tier = this.tierWant;   // phones start without multisampling
    this.on = false; this.begun = false; this.posted = false; this.cam = null; this.sky = skyAt(15);
    this.progs = {}; this.size = null; this.stats = { ms: 0, passes: 0, gpuMs: null, tier: this.tier }; this.slow = 0;
    this.empty = this.gl.createVertexArray(); this.q = null;
    this.timer = this.gl.getExtension("EXT_disjoint_timer_query_webgl2"); this.queries = []; this.auto = !q.has("lightq"); this.lastT = 0; this.dtMin = 1e9; this.dtEma = 0; this.over = 0;
    if (!q.has("lightq") && this.cfg.quality !== "auto") { this.tierWant = { low: 0, medium: 1, high: 2 }[this.cfg.quality]; this.tier = this.tierWant; this.stats.tier = this.tier; this.auto = false; }
  }
  // ---- settings ----
  loadCfg(urlOverride) {
    const c = defaultCfg(); let o = null; try { o = JSON.parse(localStorage.getItem(CFG_KEY) || "null"); } catch (e) { /* none */ }
    if (o) { for (const k of ["customHour", "matches", "quality", "world"]) if (o[k] !== undefined) c[k] = o[k]; Object.assign(c.fx, o.fx || {}); }
    if (!["off", "day", "clock", "custom", null].includes(c.world)) c.world = null;
    if (!["same", "day", "night", "random"].includes(c.matches)) c.matches = "same";
    if (!["auto", "low", "medium", "high"].includes(c.quality)) c.quality = "auto";
    if (!urlOverride && c.world) { this.mode = c.world === "off" ? "off" : c.world === "day" ? "day" : "auto"; this.hourOverride = c.world === "custom" ? c.customHour : null; }   // the choice made in the panel (else the older LIGHT button's)
    if (c.world === null) c.world = this.mode === "off" ? "off" : this.mode === "day" ? "day" : "clock";
    return c;
  }
  saveCfg() { try { localStorage.setItem(CFG_KEY, JSON.stringify(this.cfg)); } catch (e) { /* private mode */ } if (this.onMode) this.onMode(this.mode); }
  setWorld(w) {                                      // off | day | clock | custom
    this.cfg.world = w; this.mode = w === "off" ? "off" : w === "day" ? "day" : "auto"; this.hourOverride = w === "custom" ? this.cfg.customHour : null;
    try { localStorage.setItem(KEY, this.mode); } catch (e) { /* private mode */ }
    this.skyKey = null; this.saveCfg();
  }
  setCustomHour(h) { this.cfg.customHour = h; if (this.cfg.world === "custom") { this.hourOverride = h; this.skyKey = null; } this.saveCfg(); }
  setMatches(m) { this.cfg.matches = m; this.matchAt = -1; this.skyKey = null; this.saveCfg(); }
  setFx(k, on) { this.cfg.fx[k] = !!on; if (k === "floors") this.v.groundHash = -1; this.saveCfg(); }
  setQuality(qv) {
    this.cfg.quality = qv; const want = { low: 0, medium: 1, high: 2 }[qv];
    if (want === undefined) { this.auto = true; this.tierWant = this.defaultTier(); this.setTier(this.tierWant); }
    else { this.auto = false; this.tierWant = want; this.setTier(want); }
    this.saveCfg();
  }
  defaultTier() { return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? 1 : 2; }
  // is the lighting on for this scene ("field" | "court")? A court scene is where a new match is noticed: the roll of a random match time
  activeFor(kind) {
    if (this.broken) return false;
    const m = this.cfg.matches;
    if (kind !== "court" || m === "same") return this.mode !== "off";
    const fr = this.v.gb.ppu.frames;
    if (this.matchAt < 0 || fr < this.matchAt || fr - this.matchAt > 600) {         // a new match: seeded by the frame it starts at (replays roll alike)
      let x = (fr * 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; this.matchHour = MATCH_HOURS[x & 3]; this.skyKey = null;
    }
    this.matchAt = fr; return true;
  }
  get active() { return !this.broken && (this.mode !== "off" || this.cfg.matches !== "same"); }
  hourFor(kind) {
    const m = this.cfg.matches;
    if (kind === "court" && this.weatherHour != null) return this.weatherHour;   // WEATHER: Sunset
    if (kind === "court" && m !== "same") return m === "day" ? 15 : m === "night" ? 22 : (this.matchHour ?? 12);
    return this.hour();
  }
  skyFor(kind) {
    const h = this.hourFor(kind), clock = this.hourOverride == null && this.mode === "auto" && !(kind === "court" && (this.cfg.matches !== "same" || this.weatherHour != null));
    const rain = kind === "court" && !!this.weatherRain, k = kind + ":" + (clock ? Math.floor(performance.now() / 1000) : h) + (rain ? "r" : "");
    if (this.skyKey !== k) {
      this.skyKey = k; let P = skyAt(h);
      if (rain) P = { ...P, sun: P.sun.map(x => x * 0.5), amb: P.amb.map(x => x * 0.9), sat: P.sat * 0.78, shade: (P.shade ?? 1) * 0.35, bloom: P.bloom * 0.6 };   // WEATHER: Rain: overcast
      this.skyVal = P;
    }
    return this.skyVal;
  }
  setMode(m) {
    this.mode = LIGHT_MODES.includes(m) ? m : "off";
    try { localStorage.setItem(KEY, this.mode); } catch (e) { /* private mode */ }
    this.over = 0; if (this.auto && this.tier < this.tierWant) this.setTier(this.tierWant);       // a fresh try at full quality
    if (this.onMode) this.onMode(this.mode);
  }
  skyNow() {                                         // the sky for the current time (recomputed once a second)
    const k = this.hourOverride ?? Math.floor(performance.now() / 1000) + this.mode;
    if (this.skyKey !== k) { this.skyKey = k; this.skyVal = skyAt(this.hour()); }
    return this.skyVal;
  }
  hour() { return this.hourOverride ?? (this.mode === "day" ? 15 : hourNow()); }

  // ---- GL objects ----
  prog(name, fs) {
    if (this.progs[name]) return this.progs[name];
    const samplers = { shadow: ["uDepth"], blur: ["uTex", "uDepth"], down: ["uTex"], extract: ["uQ", "uB", "uS", "uD"], comp: ["uScene", "uDepth", "uShadow", "uBlur", "uGlow", "uE"] }[name];
    const gl = this.gl, mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(name + ": " + gl.getShaderInfoLog(sh)); return sh; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(name + ": " + gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i), nm = info.name.replace(/\[0\]$/, ""); u[nm] = gl.getUniformLocation(p, info.name); }
    return this.progs[name] = { p, u, samplers };
  }
  tex(w, h, linear = true, depth = false, half = false) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    if (depth) gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    else if (half) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const f = linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  target(w, h, linear = true, half = this.half) {
    const gl = this.gl, t = this.tex(w, h, linear, false, half), f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    if (half && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { gl.deleteTexture(t); gl.deleteFramebuffer(f); this.half = false; return this.target(w, h, linear, false); }   // no float targets: 8 bits
    return { t, f, w, h };
  }
  free() {
    const gl = this.gl, q = this.q; if (!q) return;
    for (const k of Object.keys(q)) { const o = q[k]; if (!o) continue; if (o.t) gl.deleteTexture(o.t); if (o.f) gl.deleteFramebuffer(o.f); if (o.depthTex) gl.deleteTexture(o.depthTex); if (o.ms) { gl.deleteRenderbuffer(o.rc); gl.deleteRenderbuffer(o.rd); gl.deleteFramebuffer(o.f); } }
    this.q = null;
  }
  ensure(W, H) {
    const key = W + "x" + H + ":" + (this.tier >= 2);
    if (this.q && this.size === key) return;
    this.free(); const gl = this.gl; this.size = key; const q = this.q = {}; this.chain = null;
    if (this.half === undefined) this.half = !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
    // scene (single-sample, sampled by the passes); with multisampling the picture is drawn into a multisampled buffer and resolved into it
    const st = this.tex(W, H, false), dt = this.tex(W, H, false, true), f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, st, 0); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, dt, 0);
    q.scene = { t: st, depthTex: dt, f, w: W, h: H }; this.msaa = false;
    if (this.tier >= 2 && !this.noMsaa && gl.getParameter(gl.MAX_SAMPLES) >= 4) {
      const rc = gl.createRenderbuffer(), rd = gl.createRenderbuffer(), fm = gl.createFramebuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rc); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, gl.RGBA8, W, H);
      gl.bindRenderbuffer(gl.RENDERBUFFER, rd); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, gl.DEPTH_COMPONENT24, W, H);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fm); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rc); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rd);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) { q.ms = { f: fm, rc, rd, ms: true }; this.msaa = true; }
      else { gl.deleteRenderbuffer(rc); gl.deleteRenderbuffer(rd); gl.deleteFramebuffer(fm); }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  // the low-resolution targets: the shadow mask and the blur / glow chain. The chain has one texel per game pixel (so what the
  // passes see does not depend on the screen's size or density), the shadows a fixed share of the screen
  ensureChain(W, H, qw, qh) {
    const q = this.q, sc = this.tier >= 2 ? 0.5 : 0.34, sw = Math.max(8, Math.round(W * sc)), sh = Math.max(8, Math.round(H * sc));
    const key = [sw, sh, qw, qh, this.tier >= 1].join();
    if (this.chain === key) return; this.chain = key; const gl = this.gl;
    for (const k of ["sh0", "sh1", "q0", "b0", "b1", "e0", "g0", "g1"]) if (q[k]) { gl.deleteTexture(q[k].t); gl.deleteFramebuffer(q[k].f); }
    q.sh0 = this.target(sw, sh, true, false); q.sh1 = this.target(sw, sh, true, false);
    q.q0 = this.target(qw, qh); q.b0 = this.target(qw, qh); q.b1 = this.target(qw, qh);
    q.e0 = this.target(qw, qh); q.g0 = this.target(qw, qh); q.g1 = this.target(qw, qh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ---- hooks called by voxel.js ----
  begin(W, H) {
    const gl = this.gl; this.begun = false; this.posted = false;
    try { this.ensure(W, H); } catch (e) { console.warn("light", e); this.broken = true; gl.bindFramebuffer(gl.FRAMEBUFFER, null); return false; }
    this.W = W; this.H = H; this.begun = true; this.t0 = performance.now(); this.watchFrames();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaa ? this.q.ms.f : this.q.scene.f);
    return true;
  }
  camera(mvp, near, far, unit, kind, at, mapId = -1) { this.cam = { mvp, near, far, unit, kind, at, indoor: kind === "field" && INDOOR_MAPS.has(mapId) }; }   // unit: world units per game pixel; at: a ground point in the middle of the view
  finish() { if (this.begun && !this.posted) this.post(); this.begun = false; }
  // everything the passes need to know about the scene, set by voxel.js through camera() and read from its state here
  lights(P, unit, kind) {
    const out = [], fl = [], v = this.v, night = P.lamps; let pool = null;
    if (kind === "field") {
      const fx = v.field && v.field.fx;
      if (night > 0.02) {
        // fountains (cool) and street lamps (warm, field_objects lamps), the six nearest the middle of the view
        const all = [], sc = v.fieldScroll ? v.fieldScroll() : { x: 0, y: 0 }, cx = sc.x + 80, cz = sc.y + 72;
        for (const fo of (fx && fx.fountains) || []) all.push({ p: [fo.origin[0], fo.origin[1] + 8, fo.origin[2]], r: 100, c: [0.34 * night, 0.80 * night, 1.20 * night] });
        for (const l of (v.field && v.field.lamps) || []) all.push({ p: [l.x, l.h, l.y], r: l.r || 110, c: [1.5 * night * (l.k || 1), 1.15 * night * (l.k || 1), 0.62 * night * (l.k || 1)] });
        all.sort((a, b) => Math.hypot(a.p[0] - cx, a.p[2] - cz) - Math.hypot(b.p[0] - cx, b.p[2] - cz)); out.push(...all.slice(0, 6));
      }
    } else if (kind === "court" && night > 0.02) {
      pool = { v: [0, -80, 1000, 1850], c: [0.58 * night, 0.62 * night, 0.56 * night] };
      for (const [x, z] of FLOODS) { out.push({ p: [x, FLOOD_HEIGHT, z], r: 4800, c: [0.10 * night, 0.09 * night, 0.07 * night] }); fl.push({ p: [x, FLOOD_HEIGHT, z], c: [0.42 * night, 0.38 * night, 0.28 * night], size: 0.10 }); }
    }
    if (kind === "court" && v.ballfx && v.ballfx.on) for (const l of v.ballfx.lights()) if (out.length < 6) out.push(l);      // impact lights of the ball effects (ballfx.js), day and night
    return { out, fl, pool };
  }
  post() {
    if (!this.begun || this.posted) return;
    this.posted = true; const gl = this.gl, q = this.q, v = this.v, W = this.W, H = this.H, cam = this.cam, t0 = performance.now();
    if (!cam) { this.blitPlain(); return; }
    let P = this.sky = cam.indoor ? INDOOR : this.skyFor(cam.kind);
    // a side-view map at night (the road): soft cool moonlight over it, so the road stays readable under the stars
    if (cam.kind === "field" && v.field && v.field.noGlass && P.lamps > 0.02) P = { ...P, amb: P.amb.map((a, i) => a + [0.13, 0.16, 0.22][i] * P.lamps) };
    try { this.run(P, cam, q, W, H); } catch (e) { console.warn("light", e); this.broken = true; try { this.timerEnd(); } catch (e2) { /* none running */ } this.blitPlain(); }
    // the overlays that follow use the voxel renderer's own state
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); gl.useProgram(v.prog); gl.bindVertexArray(v.vao); gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0); gl.depthMask(true);
    this.stats.ms = this.stats.ms * 0.9 + (performance.now() - t0) * 0.1; this.cam = null;
  }
  blitPlain() {                                     // no camera was reported: just show the scene
    const gl = this.gl, q = this.q; this.resolve(q);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, q.scene.f); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, this.W, this.H, 0, 0, this.W, this.H, gl.COLOR_BUFFER_BIT, gl.NEAREST); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  resolve(q) {
    const gl = this.gl; if (!this.msaa) return;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, q.ms.f); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, q.scene.f);
    gl.blitFramebuffer(0, 0, this.W, this.H, 0, 0, this.W, this.H, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    if (!this.resolveOk) { this.resolveOk = true; if (gl.getError()) { this.noMsaa = true; this.size = null; } }      // a GPU that cannot resolve depth: no multisampling
  }
  pass(pg, tgt, uni, texs) {                        // one full-screen pass: program, target (null = canvas), uniforms, textures by unit
    const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, tgt ? tgt.f : null); gl.viewport(0, 0, tgt ? tgt.w : this.W, tgt ? tgt.h : this.H);
    gl.useProgram(pg.p);
    texs.forEach((t, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); const l = pg.u[pg.samplers[i]]; if (l) gl.uniform1i(l, i); });
    for (const k of Object.keys(uni)) { const loc = pg.u[k]; if (loc === undefined || loc === null) continue; const val = uni[k]; if (k === "uSteps") gl.uniform1i(loc, val); else if (typeof val === "number") gl.uniform1f(loc, val); else if (val.length === 2) gl.uniform2fv(loc, val); else if (val.length === 3) gl.uniform3fv(loc, val); else if (val.length === 4) gl.uniform4fv(loc, val); else if (val.length === 16) gl.uniformMatrix4fv(loc, false, val); else gl.uniform4fv(loc, val); }
    gl.drawArrays(gl.TRIANGLES, 0, 3); this.stats.passes++;
  }
  run(P, cam, q, W, H) {
    const gl = this.gl, T = this.tier, unit = cam.unit, S = q.scene;
    this.stats.passes = 0; this.timerBegin(); this.resolve(q);
    // device pixels per game pixel in the middle of the view -> the chain's size
    const c0 = apply(cam.mvp, [cam.at[0], cam.at[1], cam.at[2], 1]), c1 = apply(cam.mvp, [cam.at[0] + unit, cam.at[1], cam.at[2], 1]);
    const dpp = Math.abs(c1[0] / c1[3] - c0[0] / c0[3]) * W / 2 || 4, qw = clamp(Math.round(W / Math.max(1, dpp) / 8) * 8, 64, W >> 1), qh = clamp(Math.round(H / Math.max(1, dpp) / 8) * 8, 64, H >> 1);
    this.ensureChain(W, H, qw, qh);
    gl.bindVertexArray(this.empty); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(false);
    // the sun (or moon): direction towards it in world space (x right, y up, -z away from the viewer)
    const az = P.az * Math.PI / 180, el = Math.max(P.el, 11) * Math.PI / 180, L = [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
    const fx = this.cfg.fx, night = P.lamps * (fx.night ? 1 : 0), shade = T >= 1 && fx.shadows ? (P.shade ?? 1) : 0, dofK = T >= 1 && fx.tilt ? 1 : 0;
    const progS = this.prog("shadow", FS_SHADOW), progB = this.prog("blur", FS_BLUR), progD = this.prog("down", FS_DOWN), progE = this.prog("extract", FS_EXTRACT), progC = this.prog("comp", FS_COMP);
    const NF = [cam.near, cam.far], vp = cam.mvp, invVP = invert(vp);
    // 1. shadows
    if (shade > 0) {
      const reach = (cam.kind === "court" ? 520 : 70) * (P.el < 20 ? 1.2 : 1), thick = [0.5 * unit, (cam.kind === "court" ? 190 : 26)];
      const dclip = apply(vp, [L[0] * reach, L[1] * reach, L[2] * reach, 0]);
      this.pass(progS, q.sh0, { uNF: NF, uDClip: dclip, uThick: thick, uSteps: T >= 2 ? 28 : 16 }, [S.depthTex]);
      const px = 1 / q.sh0.w, py = 1 / q.sh0.h;
      this.pass(progB, q.sh1, { uDir: [px * 1.2, 0], uUseDepth: 1, uNF: NF }, [q.sh0.t, S.depthTex]);
      this.pass(progB, q.sh0, { uDir: [0, py * 1.2], uUseDepth: 1, uNF: NF }, [q.sh1.t, S.depthTex]);
    }
    // 2. blur chain + glow
    const needB = dofK || night > 0.02;
    this.pass(progD, q.q0, { uTexel: [1 / W, 1 / H] }, [S.t]);
    if (needB) {
      this.pass(progB, q.b1, { uDir: [1 / q.q0.w * 1.3, 0], uUseDepth: 0 }, [q.q0.t, S.depthTex]);
      this.pass(progB, q.b0, { uDir: [0, 1 / q.q0.h * 1.3], uUseDepth: 0 }, [q.b1.t, S.depthTex]);
    }
    this.pass(progE, q.e0, { uGlass: cam.kind === "field" && this.v.field && (this.v.field.noGlass || this.v.field.noGlow) ? 0 : 1, uInvVP: invVP, uTexel: [1 / q.q0.w, 1 / q.q0.h], uHi: fx.bloom ? 1.5 * P.bloom : 0, uEm: 2.2 * night * (cam.kind === "field" ? 1 : 0), uThr: P.thr, uLL: Math.min(1.4, (0.299 * (P.amb[0] + (P.sun[0] - P.amb[0]) * 0.85) + 0.587 * (P.amb[1] + (P.sun[1] - P.amb[1]) * 0.85) + 0.114 * (P.amb[2] + (P.sun[2] - P.amb[2]) * 0.85)) * P.exp), uLit: [1.0, 0.72, 0.34] }, [q.q0.t, (needB ? q.b0 : q.q0).t, S.t, S.depthTex]);
    this.pass(progB, q.g1, { uDir: [1 / q.e0.w * 2.2, 0], uUseDepth: 0 }, [q.e0.t, S.depthTex]);
    this.pass(progB, q.g0, { uDir: [0, 1 / q.e0.h * 2.2], uUseDepth: 0 }, [q.g1.t, S.depthTex]);
    this.pass(progB, q.g1, { uDir: [1 / q.e0.w * 5, 0], uUseDepth: 0 }, [q.g0.t, S.depthTex]);
    this.pass(progB, q.g0, { uDir: [0, 1 / q.e0.h * 5], uUseDepth: 0 }, [q.g1.t, S.depthTex]);
    // 3. point lights, floodlight glare
    const li = this.lights(night === P.lamps ? P : { ...P, lamps: 0 }, unit, cam.kind), pp = new Float32Array(24), pc = new Float32Array(18), fl = new Float32Array(16), fc = new Float32Array(12);
    li.out.forEach((l, i) => { pp.set([l.p[0], l.p[1], l.p[2], l.r], i * 4); pc.set(l.c, i * 3); });
    let nf = 0;
    for (const f of li.fl) {
      const c = apply(vp, [f.p[0], f.p[1], f.p[2], 1]); if (c[3] <= 0) continue;
      const u = c[0] / c[3] * 0.5 + 0.5, w = c[1] / c[3] * 0.5 + 0.5; fl.set([u, w, f.size, 1], nf * 4); fc.set(f.c, nf * 3); nf++;
    }
    // 4. composite to the canvas
    const wallK = cam.kind === "field" ? 1 : 0.6;
    gl.useProgram(progC.p);
    gl.uniform4fv(progC.u.uPP, pp); gl.uniform3fv(progC.u.uPC, pc); gl.uniform4fv(progC.u.uFl, fl); gl.uniform3fv(progC.u.uFC, fc);
    gl.useProgram(progC.p); gl.uniform4fv(progC.u.uPool, li.pool ? li.pool.v : [0, 0, 0, 0]); gl.uniform3fv(progC.u.uPoolC, li.pool ? li.pool.c : [0, 0, 0]);
    gl.uniform1i(progC.u.uNP, li.out.length); gl.uniform1i(progC.u.uNF2, nf);
    this.pass(progC, null, {
      uInvVP: invVP, uVP: vp, uNF: NF, uRes: [W, H], uL: L, uSun: P.sun, uAmb: P.amb, uShade: shade, uWall: wallK,
      uExp: P.exp, uSat: P.sat, uCon: P.con, uBloom: P.bloom, uGlowK: 0.62 * (0.6 + 0.4 * P.bloom), uSpill: 0.5 + 0.18 * night, uLamps: cam.kind === "field" ? night : 0, uVig: fx.vignette ? P.vig : 0, uDof: dofK * 0.8, uTone: P.tone,
      uDbg: this.dbg, uWarm: [1.15, 0.82, 0.42], uFocus: cam.kind === "court" ? [0.5, 0.36, 0.22, 0.26] : [0.5, 0.17, 0.30, 0.36],   // (a court: the players at both baselines stay sharp)
    }, [S.t, S.depthTex, q.sh0.t, (needB ? q.b0 : q.q0).t, q.g0.t, q.e0.t]);
    this.timerEnd();
  }
  // GPU time of the passes (where the browser has a timer): read back a few frames later; the tier drops when they cost too much for
  // 120 fps smoothing (budget per frame: 3 ms with shadows and multisampling, 2.2 ms without). Without a timer the frame interval is watched:
  // a display refreshing at 120 Hz whose frames keep coming much slower than its fastest ones.
  timerBegin() {
    const gl = this.gl, ext = this.timer; if (!ext) return;
    while (this.queries.length) {
      const e = this.queries[0], ok = gl.getQueryParameter(e, gl.QUERY_RESULT_AVAILABLE), dis = gl.getParameter(ext.GPU_DISJOINT_EXT);
      if (!ok && !dis) break; this.queries.shift();
      if (ok && !dis) { const ms = gl.getQueryParameter(e, gl.QUERY_RESULT) / 1e6; this.stats.gpuMs = this.stats.gpuMs == null ? ms : this.stats.gpuMs * 0.92 + ms * 0.08; this.judge(this.stats.gpuMs); }
      gl.deleteQuery(e);
    }
    if (this.queries.length < 4) { const e = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, e); this.cur = e; }
  }
  timerEnd() { const gl = this.gl, ext = this.timer; if (ext && this.cur) { gl.endQuery(ext.TIME_ELAPSED_EXT); this.queries.push(this.cur); this.cur = null; } }
  judge(ms) {
    if (!this.auto || this.tier <= 0) return;
    if (ms > (this.tier >= 2 ? 3.0 : 2.2)) { if (++this.over > 90) { this.over = 0; this.setTier(this.tier - 1); } } else this.over = Math.max(0, this.over - 2);
  }
  setTier(t) { this.tier = Math.max(0, t); this.stats.tier = this.tier; this.stats.gpuMs = null; if (this.onTier) this.onTier(this.tier); }
  watchFrames() {                                   // no GPU timer: judge by the frame interval
    const now = performance.now(), dt = now - this.lastT; this.lastT = now;
    if (this.timer || !this.auto || dt > 100 || dt < 2) return;
    this.dtMin = Math.min(this.dtMin * 1.0005, dt); this.dtEma = this.dtEma ? this.dtEma * 0.97 + dt * 0.03 : dt;
    if (this.tier > 0 && this.dtMin < 10.5 && this.dtEma > this.dtMin * 1.6) { if (++this.over > 240) { this.over = 0; this.dtEma = 0; this.dtMin = 1e9; this.setTier(this.tier - 1); } } else this.over = Math.max(0, this.over - 1);
  }
}

// the HUD button: "LIGHT: ..." opens the settings panel (lightpanel.js; without it the button cycles Off / Day / Auto as before)
export function addLightButton(hud, light) {
  if (!hud || !light) return null;
  const b = document.createElement("span"); b.className = "k"; b.id = "lightbtn"; b.title = "3D / VOX lighting settings: time of day for the overworld and for matches, shadows, glow, tilt-shift, vignette, night lights, quality, crowd size";
  const fmt = h => { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return String(hh % 24).padStart(2, "0") + ":" + String(mm === 60 ? 0 : mm).padStart(2, "0"); };
  const show = () => { const w = light.cfg.world; const t = w === "off" ? "Off" : w === "day" ? "Day" : w === "custom" ? fmt(light.cfg.customHour) : "Auto"; b.textContent = "LIGHT: " + t; b.classList.toggle("on", light.active); };
  b.addEventListener("pointerdown", () => { if (light.openPanel) light.openPanel(); else { light.setMode(LIGHT_MODES[(LIGHT_MODES.indexOf(light.mode) + 1) % LIGHT_MODES.length]); light.cfg.world = light.mode === "auto" ? "clock" : light.mode; show(); } });
  hud.appendChild(document.createTextNode(" ")); hud.appendChild(b); show();
  light.onMode = show;
  return b;
}
export function attachLighting(voxel, hud) { const l = voxel.light = new Lighting(voxel); addLightButton(hud, l); return l; }
