// The ground's shader (3D hole view). The course map's own pixels (uMap, from the ROM) with, under TERRAIN (adapted from Mario
// Tennis's courtfloor.js: floors from the court's own colours), a surface per terrain type (uTerr: TerrainAt 10:6536 per 4 x 4 cell)
// in the hole's own colours (uTypeCol: each type's mean colour on this hole):
//   fairway / tee   mown stripes across the hole, a fine grain
//   semi-rough      a coarser grain
//   rough           blades: dark and light streaks, bent by the wind (the game's wind, uWind)
//   green           a fine mowing check
//   bunker          sand ripples and grains
//   water           moving ripples, the sky's colour at a glance, a glint of the sun
//   woods (OB)      a dappled canopy
// Lit by the sun (light3d.js) with its shadow map, the night's lamps, fogged to the horizon. Render only.
export const GROUND_VS = `#version 300 es
in vec3 aPos; in vec3 aNrm; uniform mat4 uMVP; uniform mat4 uShadowMVP; out vec3 vW; out vec3 vN; out vec4 vSh;
void main() { vW = aPos; vN = aNrm; vSh = uShadowMVP * vec4(aPos, 1.0); gl_Position = uMVP * vec4(aPos, 1.0); }`;

export const GROUND_FS = `#version 300 es
precision highp float; precision highp sampler2DShadow;
in vec3 vW; in vec3 vN; in vec4 vSh;
uniform sampler2D uMap, uTerr; uniform sampler2DShadow uShadow; uniform float uShadowOn, uDetail, uTime, uLite, uSkirt;
uniform vec3 uTypeCol[16]; uniform vec2 uWind; uniform vec3 uSkyCol;
uniform vec3 uSunDir, uSunCol, uAmb, uFogCol; uniform float uFogNear, uFogFar, uNight; uniform vec3 uEye;
uniform vec4 uLights[4]; uniform vec3 uLightCol[4]; uniform vec4 uFade;
out vec4 o;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
vec3 pointLights(vec3 p, vec3 n) { vec3 s = vec3(0.0); for (int i = 0; i < 4; i++) { vec3 d = uLights[i].xyz - p; float r = uLights[i].w; if (r <= 0.0) continue;
  float l = length(d); s += uLightCol[i] * max(0.0, 1.0 - l / r) * (0.35 + 0.65 * max(0.0, dot(n, d / max(l, 0.001)))); } return s; }
void main() {
  vec2 uv = clamp(vW.xz, 0.0, 511.9) / 512.0;
  vec3 tex = texture(uMap, uv).rgb;
  float t = floor(texture(uTerr, uv).r * 255.0 + 0.5);
  if (uSkirt > 0.5) { t = 7.0; tex = uTypeCol[7]; }
  vec3 c = tex; vec3 n = normalize(vN); float spec = 0.0;
  if (uDetail > 0.5) {
    vec3 base = uTypeCol[int(t)];
    vec2 p = vW.xz;
    float g1 = hash(floor(p * 4.0)), nz = vnoise(p * 0.35);
    if (t == 0.0 || t == 14.0) {                  // fairway, tee: mown stripes
      c = mix(tex, base, 0.55);
      float stripe = step(0.5, fract(p.y / 12.0));
      c *= 0.95 + 0.08 * stripe + 0.04 * (g1 - 0.5);
    } else if (t == 9.0) {                        // semi-rough
      c = mix(tex, base, 0.5) * (0.93 + 0.1 * g1 + 0.06 * (nz - 0.5));
    } else if (t == 1.0) {                        // rough: blades bent by the wind
      vec2 q = p * vec2(5.0, 2.0) + uWind * sin(uTime * 2.0 + p.x * 0.3 + p.y * 0.2) * 0.6;
      float blade = hash(floor(q)); c = mix(tex, base, 0.45) * (0.85 + 0.22 * blade + 0.1 * (nz - 0.5));
    } else if (t == 6.0) {                        // green: a fine mowing check
      c = mix(tex, base, 0.6);
      float ck = mod(floor(p.x / 3.0) + floor(p.y / 3.0), 2.0); c *= 0.97 + 0.05 * ck + 0.02 * (g1 - 0.5);
    } else if (t == 2.0 || t == 13.0) {           // bunker: ripples, grains
      c = mix(tex, base, 0.6);
      float rip = sin((p.x * 0.8 + p.y * 1.4) * 2.2 + nz * 4.0); c *= 0.95 + 0.06 * rip + 0.08 * (hash(floor(p * 8.0)) - 0.5);
    } else if (t == 3.0) {                        // water: ripples, the sky, a glint
      c = mix(tex, base, 0.5);
      float w1 = sin(p.x * 0.9 + uTime * 1.3 + sin(p.y * 0.4 + uTime * 0.7) * 2.0), w2 = sin(p.y * 1.3 - uTime * 1.1 + p.x * 0.3);
      n = normalize(n + vec3(w1 * 0.08, 0.0, w2 * 0.08));
      vec3 v = normalize(uEye - vW); float fr = pow(1.0 - max(dot(v, n), 0.0), 3.0);
      c = mix(c, uSkyCol, 0.25 + 0.5 * fr); c += vec3(0.08) * step(0.92, w1 * w2);
      spec = pow(max(dot(reflect(-uSunDir, n), v), 0.0), 60.0);
    } else if (t == 7.0) {                        // woods: a dappled canopy
      c = tex * (0.88 + 0.2 * nz + 0.08 * (g1 - 0.5));
    }
  }
  float sh = 1.0;
  if (uShadowOn > 0.5) {
    vec3 q = vSh.xyz / vSh.w * 0.5 + 0.5;
    if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) {
      float b = 0.0015, s = 0.0; vec2 k = vec2(1.0 / 2048.0);
      if (uLite > 0.5) s = texture(uShadow, vec3(q.xy, q.z - b));
      else { for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) s += texture(uShadow, vec3(q.xy + vec2(i, j) * k * 1.5, q.z - b)); s /= 9.0; }
      sh = s;
    }
  }
  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 l = uAmb + uSunCol * ndl * sh + pointLights(vW, n);
  c = c * l + uSunCol * spec * sh * 0.8;
  float f = clamp((distance(vW, uEye) - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  c = mix(c, uFogCol, f * f);
  o = vec4(mix(c, uFade.rgb, uFade.a), 1.0);
}`;
