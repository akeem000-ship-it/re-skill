// The ground's shader (3D hole view). The course map's own pixels (uMap, from the ROM) with, under TERRAIN (adapted from Mario
// Tennis's courtfloor.js: floors from the court's own colours), a surface per terrain type (uTerr: TerrainAt 10:6536 per 4 x 4 cell)
// in the hole's own colours (uTypeCol: each type's mean colour on this hole). GRASS: Pixel (uGrass 0, the look before):
//   fairway / tee   mown stripes across the hole, a fine grain
//   semi-rough      a coarser grain
//   rough           blades: dark and light streaks, bent by the wind (the game's wind, uWind)
//   green           a fine mowing check
// GRASS: Carpet (uGrass 1; Mario Tennis's carpet turf, its ground.js VS_SHELL / FS_SHELL): the ground mesh drawn again as shells
// near the eye (scene.js: uShellN copies, instanced, shell i at (i / N)^2 * uHmax over the soil); a shell keeps only the strands that
// reach it, thinning to their tips. The colour is the lawn's own without the game's dither (uClean: terrain3d.js cleanMap; alpha:
// near the green = the fringe):
//   fairway / tee   mown carpet, light / dark stripes along the hole (the strands lean with / against the mowing: the shade turns
//                   with the view), short and even
//   fringe          (fairway / semi-rough within 3 px of the green) a short collar
//   semi-rough      a little longer, uneven
//   rough, woods    longer uneven carpet in patches, olive and straw strands, taller tufts
//   green           very short and fine, the game's own green picture under it (its slope chevrons kept), and THE GRAIN: the
//                   strands lean downhill along the slope the ball rolls on (uSlope: hole3d.js greenSlopes, GreenSlopeAt 10:64D1
//                   per green tile), more the steeper the tile, combed streaks along it, a sheen that turns with the view and a
//                   slow bright band travelling downhill; a flat tile stands upright and still
// Off the green the strands sway in the game's wind (uWind: its direction and mph, as the HUD shows them): a bigger, faster sway
// and gusts running across the grass in the wind's direction the harder it blows; on the green only a light sway over the lean
// (the game's ball ignores the wind on the ground: 10:52EE). Only where the colour is green (the desert's brown stays as it is);
// far away (a strand under a pixel) the strands shrink into the base colour.
//   bunker          sand ripples and grains; SAND: Fine (uSand 1): pale fine sand (type 2, TerrainAt), soft wind ripples, raked
//                   lines along the hole, footprints, a rounded outline (uSandM: terrain3d.js sandMasks) with a crisp jagged grass
//                   lip and a shaded edge; on the Dune course its brown sand (out of bounds, rough, the waste type $0D) as pale
//                   wind-rippled sand
//   water           moving ripples, the sky's colour at a glance, a glint of the sun
//   woods (OB)      a dappled canopy
// Lit by the sun (light3d.js) with its shadow map, the night's lamps, fogged to the horizon. Render only.
// The program is built per choice (groundProgram: #defines CARPET, SAND, SHELL), so Pixel / Pixel is the old shader exactly and costs
// what it did; the shells have their own small program.
const GROUND_VS = `
layout(location = 0) in vec3 aPos; layout(location = 1) in vec3 aNrm; uniform mat4 uMVP; uniform mat4 uShadowMVP; uniform float uShellN, uHmax, uShellBase;
out vec3 vW; out vec3 vN; out vec4 vSh; out vec2 vXZ; out float vL;
void main() {
#if SHELL
  float L = (float(gl_InstanceID) + uShellBase) / uShellN; vL = L;
  vec3 p = aPos + vec3(0.0, L * L * uHmax, 0.0);
#else
  float L = 0.0; vL = 0.0; vec3 p = aPos;
#endif
  vW = p; vXZ = aPos.xz; vN = aNrm; vSh = uShadowMVP * vec4(p, 1.0); gl_Position = uMVP * vec4(p, 1.0); }`;

const GROUND_FS = `
precision highp float; precision highp sampler2DShadow;
in vec3 vW; in vec3 vN; in vec4 vSh; in vec2 vXZ; in float vL;
uniform sampler2D uMap, uTerr, uGreen, uClean, uSandM, uSlope; uniform vec4 uGreenRect, uSlopeRect; uniform sampler2DShadow uShadow;
uniform float uShadowOn, uDetail, uTime, uLite, uSkirt, uDesert, uHmax;
uniform vec3 uTypeCol[16]; uniform vec2 uWind; uniform vec3 uSkyCol; uniform vec2 uAlong; uniform vec3 uPush, uLipCol;
uniform vec3 uSunDir, uSunCol, uAmb, uFogCol; uniform float uFogNear, uFogFar, uNight; uniform vec3 uEye;
uniform vec4 uLights[4]; uniform vec3 uLightCol[4]; uniform vec4 uFade;
out vec4 o;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 pointLights(vec3 p, vec3 n) { vec3 s = vec3(0.0); for (int i = 0; i < 4; i++) { vec3 d = uLights[i].xyz - p; float r = uLights[i].w; if (r <= 0.0) continue;
  float l = length(d); s += uLightCol[i] * max(0.0, 1.0 - l / r) * (0.35 + 0.65 * max(0.0, dot(n, d / max(l, 0.001)))); } return s; }
float shadowAt(bool one) {
  if (uShadowOn < 0.5) return 1.0;
  vec3 q = vSh.xyz / vSh.w * 0.5 + 0.5;
  if (q.x <= 0.0 || q.x >= 1.0 || q.y <= 0.0 || q.y >= 1.0) return 1.0;
  float b = 0.002, s = 0.0; vec2 k = vec2(1.0 / 1024.0);
  if (one || uLite > 0.5) return texture(uShadow, vec3(q.xy, q.z - b));
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) s += texture(uShadow, vec3(q.xy + vec2(i, j) * k * 1.5, q.z - b));
  return s / 9.0;
}
vec4 finish(vec3 c, vec3 n, float sh, float spec) {
  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 l = uAmb + uSunCol * ndl * sh + pointLights(vW, n);
  c = c * l + uSunCol * spec * sh * 0.8;
  float f = clamp((distance(vW, uEye) - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  c = mix(c, uFogCol, f * f);
  return vec4(mix(c, uFade.rgb, uFade.a), 1.0);
}
// SAND: Fine: footprints now and then (a line of alternate oval dents)
float foot(vec2 p) {
  vec2 cell = floor(p / 7.0); float h = h21(cell); if (h > 0.5) return 0.0;
  float a = h21(cell + 1.7) * 6.283; vec2 d = vec2(cos(a), sin(a)), nn = vec2(-d.y, d.x), q = p - (cell + 0.5) * 7.0;
  float u = dot(q, d), v = dot(q, nn); if (abs(u) > 2.6 + 1.5 * h) return 0.0;
  float k = floor(u / 0.62 + 0.5), side = mod(k, 2.0) * 2.0 - 1.0; vec2 f = vec2(u - k * 0.62, v - side * 0.17);
  return 1.0 - smoothstep(0.65, 1.0, length(f / vec2(0.21, 0.09)));
}
// the green's picture (the putting view's, 4x finer, with the game's slope chevrons) where it has been painted
vec3 greenPic(vec2 p, vec3 tex) {
  if (uGreenRect.z > 0.0) { vec2 g = (p - uGreenRect.xy) / uGreenRect.zw; if (g.x >= 0.0 && g.y >= 0.0 && g.x < 1.0 && g.y < 1.0) return texture(uGreen, g * vec2(160.0, 128.0) / 512.0).rgb; }
  return tex;
}
// GRASS: Carpet: the green's slope at p (per green tile, 2 course px): (push direction, strength 0..1); 0 off the green's rect
vec3 grainAt(vec2 p) {
  if (uSlopeRect.z <= 0.0) return vec3(0.0);
  vec2 g = (p - uSlopeRect.xy) * 0.5;
  if (g.x < 0.0 || g.y < 0.0 || g.x >= uSlopeRect.z || g.y >= uSlopeRect.w) return vec3(0.0);
  vec4 q = texelFetch(uSlope, ivec2(g), 0);
  return q.b > 0.1 ? vec3(normalize(q.rg * 2.0 - 1.0), q.b) : vec3(0.0);
}
// the wind's sway: -1..1, a gust running across the grass along the wind's direction, faster the harder it blows
float sway(vec2 p, vec2 wd, float wk) {
  float ph = -dot(p, wd) * 0.21 + sin(p.x * 0.031 + sin(p.y * 0.043) * 1.5) * 1.2, t = uTime * (0.9 + 1.6 * wk);
  return sin(t * 1.9 + ph) * 0.75 + sin(t * 3.3 + ph * 1.7) * 0.25;
}
void main() {
  vec2 uv = clamp(vXZ, 0.0, 511.9) / 512.0;
  float t = floor(texture(uTerr, uv).r * 255.0 + 0.5), sandNear = 0.0;
#if SAND || CARPET
  sandNear = step(31.5, t); t -= 32.0 * sandNear;            // (SAND: Fine: bit 5 of the terrain texture: near sand, scene.js)
#endif
  if (uSkirt > 0.5) t = 7.0;
  vec3 V = normalize(uEye - vW);
  // ---- GRASS: Carpet: which grass, its strand size and height ----
  vec4 cl = vec4(0.0); bool grass = false; float fringe = 0.0, D = 5.0, base = 0.12, var = 0.15, tuft = 0.0, pix = 9.0, near = 0.0, stripe = 0.0, ck = 0.0;
  vec2 perp = vec2(-uAlong.y, uAlong.x), vxz = normalize(V.xz + 1e-4), Q = vXZ;
  float wk = clamp(length(uWind) / 9.0, 0.0, 1.8);                    // (uWind = mph * 0.6 along the wind: 15 mph -> 1)
  vec2 wd = length(uWind) > 0.01 ? normalize(uWind) : vec2(1.0, 0.0);
  vec3 gr = vec3(0.0);
#if CARPET
  {
    cl = uSkirt > 0.5 ? vec4(uTypeCol[7], 0.0) : texture(uClean, uv);
    bool grassT = t == 0.0 || t == 1.0 || t == 6.0 || t == 9.0 || t == 14.0 || t == 7.0;
    grass = grassT && cl.g > cl.r + 0.015 && cl.g > cl.b + 0.015;
    fringe = (t == 0.0 || t == 9.0 || t == 1.0) ? cl.a : 0.0;
    if (t == 6.0) { D = 36.0; base = 0.045; var = 0.25; tuft = 0.0; }
    else if (t == 0.0 || t == 14.0) { D = 5.0; base = 0.12; var = 0.15; tuft = 0.0; }
    else if (t == 9.0) { D = 4.5; base = 0.22; var = 0.45; tuft = 0.02; }
    else { D = 3.5; base = 0.42; var = 0.8; tuft = 0.07; }
    if (fringe > 0.0) { D = mix(D, 9.0, fringe); base = mix(base, 0.07, fringe); var = mix(var, 0.2, fringe); tuft *= 1.0 - fringe; }
    Q = vXZ * D;
    pix = fwidth(Q.x) + fwidth(Q.y); near = 1.0 - smoothstep(0.7, 1.7, pix);   // (a strand under a pixel: none)
    stripe = mod(floor(dot(vXZ, perp) / 9.0), 2.0) * 2.0 - 1.0;              // the mowing: bands along the hole
    ck = mod(floor(dot(vXZ, uAlong) / 2.5) + floor(dot(vXZ, perp) / 2.5), 2.0); // the green's mown check
    if (t == 6.0 && grass) gr = grainAt(vXZ);
  }
#endif
#if SHELL
  {                                                           // ---- a shell above the soil: the strands that reach it ----
    float H = vL * vL * uHmax;
    if (!grass || near <= 0.0 || H > base * (1.0 + var * 0.5) * (tuft > 0.0 ? 2.1 : 1.0) * near) discard;   // (above every strand here)
    vec2 rel = vXZ - uPush.xy; float d = length(rel), push = uPush.z * max(0.0, 1.0 - d / 2.6);
    bool mown = t == 0.0 || t == 14.0 || t == 6.0 || fringe > 0.5;
    float k2 = H / max(base * (1.0 + var), 0.01), s = sway(vXZ, wd, wk);
    vec2 bend;
    if (t == 6.0) {                                           // the green: the lean downhill, a slow wave along it, a light wind
      float wave = 0.8 + 0.2 * sin(dot(vXZ, gr.xy) * 1.4 - uTime * (1.0 + 1.5 * gr.z));
      bend = gr.xy * gr.z * 0.07 * wave + wd * (0.35 + 0.65 * s) * wk * 0.006;
    } else bend = wd * (0.3 + 0.7 * s) * wk * (mown ? 0.09 : 0.36) + (mown ? uAlong * stripe * 0.04 : vec2(0.0));
    bend += (d > 0.01 ? rel / d : vec2(0.0)) * push * 0.6;
    vec2 q = (vXZ - bend * k2 * k2) * D, id = floor(q), f = fract(q) - 0.5;
    float r = h21(id), pa = mown ? vnoise(vXZ / 6.0) : vnoise(vXZ / 9.0) * 0.65 + vnoise(vXZ / 3.0) * 0.35;   // (the patches)
    float hgt = base * (1.0 - var * 0.5 + var * r) * (mown ? 1.0 : 0.55 + 0.9 * pa);
    if (tuft > 0.0 && h21(id + 5.3) < tuft) hgt *= 2.1;       // a taller tuft
    hgt *= near * (1.0 - 0.7 * push);
    if (H > hgt) discard;
    vec2 j = vec2(r, h21(id + 7.7)) - 0.5;
    if (length(f - j * 0.35) > (t == 6.0 ? 0.4 * (1.0 - H / hgt) + 0.08 : 0.62 * (1.0 - H / hgt) + 0.12)) discard;   // (the green's finer)
    float kk = h21(id + 11.3), up = H / max(hgt, 0.001);
    vec3 col = cl.rgb;
    if (t == 6.0) {                                           // (the green's own picture under the strands: the chevrons show through)
      col = mix(cl.rgb, greenPic(vXZ, cl.rgb), 0.85) * (0.96 + 0.07 * ck);
      col *= 1.0 + 0.16 * gr.z * -dot(gr.xy, vxz);            // the sheen: lighter looking down the grain
    }
    if (mown) col *= (0.88 + 0.2 * kk) * (0.94 + 0.12 * pa) * (1.0 + 0.14 * stripe * dot(vxz, uAlong) * (t == 6.0 ? 0.0 : 1.0));
    else {
      col *= (0.72 + 0.45 * kk) * (0.82 + 0.36 * pa);
      col = mix(col, col * vec3(1.25, 1.0, 0.5) + vec3(0.07, 0.05, 0.0), smoothstep(0.55, 0.15, pa) * 0.4);
      col = mix(col, col * vec3(1.35, 1.12, 0.5) + vec3(0.06, 0.04, 0.0), step(0.86, kk) * 0.7);   // straw strands
    }
    col *= t == 6.0 ? mix(0.88, 1.08, up) : mix(0.55, 1.18, up * 0.7 + vL * 0.3); col += vec3(0.04, 0.05, 0.0) * up * up;
    o = finish(col, normalize(vN), shadowAt(true), 0.0);
  }
#else
  // ---- the soil / the surface ----
  vec3 tex = texture(uMap, uv).rgb;
  tex = greenPic(vXZ, tex);
  if (uSkirt > 0.5) tex = uTypeCol[7];
  vec3 c = tex; vec3 n = normalize(vN); float spec = 0.0;
#if CARPET
  if (grass) {                                                // GRASS: Carpet: the lawn's colour, darker under tall grass nearby
    vec2 p = vXZ; float pa = vnoise(p / 5.0), s = sway(p, wd, wk);
    c = cl.rgb;
    if (t == 6.0) {
      c = mix(cl.rgb, tex, 0.85) * (0.96 + 0.07 * ck);        // (the game's green picture: its slope chevrons)
      if (gr.z > 0.0) {                                       // THE GRAIN: blades combed downhill, the sheen, a band travelling downhill
        float a = dot(p, gr.xy), b = dot(p, vec2(-gr.y, gr.x)), row = floor(b * 4.0);
        // the combed blades: short streaks along the slope, each dark at its uphill root and light at its downhill tip (so a still
        // picture shows which way is down), in rows across it with their own offsets
        float f = fract(a * 1.4 + hash(vec2(row, 7.0))), blade = f * f;
        float gk = (0.4 + 0.6 * gr.z) * smoothstep(0.2, 0.9, pix);   // (a gentle slope shows, a steep one more; close up the strands show it)
        c *= 1.0 + (blade - 0.4) * 0.8 * gk * (0.7 + 0.3 * hash(vec2(row, floor(a * 1.4 + hash(vec2(row, 7.0))))));
        c += vec3(0.025, 0.035, 0.0) * blade * gk;              // (the tips catch the light)
        c *= 1.0 + 0.22 * gk * -dot(gr.xy, vxz);              // the sheen: lighter looking down the grain
        float w = fract(a * 0.25 - uTime * (0.2 + 0.25 * gr.z));
        c *= 1.0 + 0.3 * gk * smoothstep(0.0, 0.15, w) * smoothstep(0.5, 0.15, w);
      }
      c *= 1.0 + 0.012 * wk * s;
    }
    else if (t == 0.0 || t == 14.0 || fringe > 0.5) c *= (1.0 + 0.14 * stripe * dot(vxz, uAlong) * (1.0 - fringe)) * (0.95 + 0.1 * pa) * (1.0 + 0.05 * wk * s);
    else c *= (0.84 + 0.3 * pa) * (1.0 + 0.09 * wk * s);      // (the gusts: a shade running across the long grass with the wind)
    c *= mix(1.0, mix(1.0, 0.45, smoothstep(0.05, 0.4, base)), near);
    c *= 1.0 + (vnoise(Q * 0.3) - 0.5) * 0.12 * (1.0 - near) * clamp(2.5 - pix * 0.25, 0.0, 1.0);   // (far: the strands' grain as a fine mottle)
  } else
#endif
  if (uDetail > 0.5) {
    vec3 base = uTypeCol[int(t)];
    vec2 p = vW.xz;
    float g1 = hash(floor(p * 4.0)), nz = vnoise(p * 0.35);
#if CARPET
    if (t == 0.0 || t == 14.0 || t == 9.0 || t == 1.0 || t == 6.0) {   // (Carpet: a grass type in a colour that is not green)
      c = mix(tex, base, 0.5) * (0.93 + 0.1 * g1);
    } else
#endif
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
      float fr = pow(1.0 - max(dot(V, n), 0.0), 3.0);
      c = mix(c, uSkyCol, 0.25 + 0.5 * fr); c += vec3(0.08) * step(0.92, w1 * w2);
      spec = pow(max(dot(reflect(-uSunDir, n), V), 0.0), 60.0);
    } else if (t == 7.0) {                        // woods: a dappled canopy
      c = tex * (0.88 + 0.2 * nz + 0.08 * (g1 - 0.5));
    }
  }
  // ---- SAND: Fine: the bunkers (type 2) on every course; the Dune course's sand ----
#if SAND
  if (uDetail > 0.5 && (sandNear > 0.5 || uSkirt > 0.5)) {   // (only near sand: the rest pays nothing)
    vec2 p = vXZ, swd = length(uWind) > 0.01 ? normalize(uWind) : vec2(0.8, 0.6);
    vec4 sm = uSkirt > 0.5 ? vec4(0.0, 1.0, 0.0, 0.0) : texture(uSandM, uv);
    if (sm.r > 0.02 || sm.g > 0.3 || t == 2.0 || uSkirt > 0.5) {
      float dx = 1.0 / 512.0, gx = texture(uSandM, uv + vec2(dx, 0.0)).r - texture(uSandM, uv - vec2(dx, 0.0)).r, gz = texture(uSandM, uv + vec2(0.0, dx)).r - texture(uSandM, uv - vec2(0.0, dx)).r;
      float g1 = hash(floor(p * 9.0)), nz = vnoise(p * 0.6);
      bool bunkT = t == 2.0;
      float e = sm.r + (hash(floor(p * vec2(7.0, 5.0))) - 0.5) * 0.07 + (nz - 0.5) * 0.08;   // a crisp, jagged grass edge
      bool inS = e > 0.5, desert = uDesert > 0.5 && sm.g > 0.45 && !inS;
      float far = 1.0 - smoothstep(140.0, 340.0, distance(vW, uEye));                      // (fine detail fades out far away)
      if (inS) {                                   // ---- in a bunker: pale fine sand, raked lines, soft ripples, footprints, the lip's shade
        float inner = smoothstep(0.5, 0.8, e);
        vec3 face = normalize(vec3(gx * 5.0, 1.0, gz * 5.0));
        c = mix(uTypeCol[2], vec3(0.96, 0.91, 0.79), 0.5) * (0.96 + 0.07 * (g1 - 0.5) + 0.04 * (hash(floor(p * 23.0)) - 0.5));
        float rk = sin(dot(p, perp) * 6.283 / 0.45 + sin(dot(p, uAlong) * 0.35) * 0.8), rip = sin(dot(p, swd) * 2.4 + nz * 5.0);
        n = normalize(face + vec3(perp.x, 0.0, perp.y) * rk * 0.3 * inner * far + vec3(swd.x, 0.0, swd.y) * rip * 0.05);
        float fp = foot(p) * smoothstep(0.55, 0.75, e) * far; c *= 1.0 - 0.2 * fp; n = normalize(n + vec3(0.0, -0.4 * fp, 0.0));
        c *= 0.7 + 0.3 * smoothstep(0.5, 0.62, e);                                             // the lip's shaded edge
        spec = 0.0;
      } else if (desert) {                         // ---- the Dune course's sand: pale, soft wind ripples
        vec3 dc = uSkirt > 0.5 ? uTypeCol[7] : texture(uClean, uv).rgb;
        c = mix(dc, vec3(0.93, 0.84, 0.66), 0.5) * (0.96 + 0.06 * (g1 - 0.5));
        float ph = dot(p, vec2(-swd.y, swd.x)) / 1.5 + vnoise(p * 0.07) * 5.0, fr = fract(ph);
        n = normalize(n + vec3(-swd.y, 0.0, swd.x) * (fr < 0.75 ? 0.1 : -0.3) * far); c *= 0.97 + 0.05 * sin(ph * 6.283) * far;
      } else if (bunkT || (e > 0.3 && t != 3.0 && t != 6.0)) {   // ---- the grass round a bunker: its lip, a crisp sunlit edge
        float lb = smoothstep(0.25, 0.48, e);
        vec3 lc = uLipCol * (0.88 + 0.22 * hash(floor(p * vec2(8.0, 3.0))));
        if (bunkT) c = lc; else c = mix(c, lc * 0.92, lb * 0.7);
        c += vec3(0.05, 0.07, 0.02) * smoothstep(0.42, 0.5, e);
      }
    }
  }
#endif
  o = finish(c, n, shadowAt(false), spec);
#endif
}`;

// the ground's program for a choice: carpet (GRASS: Carpet, with TERRAIN on), sand (SAND: Fine), shell (the carpet's shells)
export function groundSources({ carpet = false, sand = false, shell = false } = {}) {
  const head = `#version 300 es\n#define CARPET ${carpet || shell ? 1 : 0}\n#define SAND ${sand && !shell ? 1 : 0}\n#define SHELL ${shell ? 1 : 0}\n`;
  return [head + GROUND_VS, head + GROUND_FS];
}
