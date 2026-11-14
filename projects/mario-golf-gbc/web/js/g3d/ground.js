// GROUND (3D overworld, render only; adapted from Mario Tennis's ground.js): the overworld's ground in its own colours, with life in
// it. Only the map's picture is read (field3d.js); a shader part (uMap: the map's picture, uv its coordinates):
//   lawn   grass-coloured pixels (green above red and blue) are a short carpet turf: fine strands a third of a pixel across, lighter
//          and darker, swaying with a travelling wind, in soft patches; inside field_objects.js mown rectangles (round the club
//          houses, uMown) mown in light and dark stripes 8 px wide;
//   paths  dirt-coloured pixels (red above green above blue) strewn with fine grit (its own colour, a little grey) and the odd pale
//          stone;
//   kerb   the light band lining the paths (bright, not blue: the pale yellow and the light green) is a soft raised edge: its slopes
//          lit on the side facing the sun (north, behind the scene) and shaded on the side facing the camera, from the picture's
//          neighbours.
export const GROUND_GLSL = `
uniform vec4 uMown[4]; uniform float uGLite;   // (uGLite: Lite, no kerb and fewer noises)
float gHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float gNoise(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f); return mix(mix(gHash(i), gHash(i + vec2(1, 0)), u.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), u.x), u.y); }
float gKerb(vec2 uv) { vec3 k = texture(uMap, uv).rgb; float l = dot(k, vec3(0.3, 0.59, 0.11)); return smoothstep(0.64, 0.7, l) * step(k.b, 0.3) * step(0.45, max(k.r, k.g)); }
vec3 groundDetail(vec3 c, vec2 p, vec2 uv, float t, vec2 wind) {
  float bevel = 1.0;
  if (uGLite < 0.5) { float d = 1.0 / 512.0, kx = gKerb(uv + vec2(d, 0.0)) - gKerb(uv - vec2(d, 0.0)), kz = gKerb(uv + vec2(0.0, d)) - gKerb(uv - vec2(0.0, d));
    bevel = 1.0 + 0.16 * kz - 0.06 * kx; }                      // (the kerb's slopes: lit facing north, shaded facing the camera)
  if (c.g > c.r + 0.06 && c.g > c.b + 0.04) {
    bool mown = false; for (int i = 0; i < 4; i++) { vec4 r = uMown[i]; if (p.x >= r.x && p.y >= r.y && p.x < r.z && p.y < r.w) mown = true; }
    float s = sin(t * 1.7 + p.y * 0.15 + p.x * 0.05);
    vec2 q = p * 3.0 + vec2(s * (mown ? 0.4 : 1.2), 0.0);
    float strand = gHash(floor(q)), pa = uGLite > 0.5 ? 0.5 : gNoise(p / 18.0) * 0.6 + gNoise(p / 6.0) * 0.4;
    vec3 g = c * (0.86 + 0.24 * strand) * (0.92 + 0.14 * pa);
    if (mown) g = c * (0.92 + 0.12 * strand) * (0.9 + 0.16 * mod(floor(p.y / 8.0), 2.0));
    return g * bevel;
  }
  if (c.r > c.g && c.g > c.b + 0.05) {
    float grit = gHash(floor(p * 2.0)), mo = uGLite > 0.5 ? 0.5 : gNoise(p / 5.0);
    vec3 g = c * (0.95 + 0.12 * grit) * (0.96 + 0.08 * mo);
    g = mix(g, vec3(dot(g, vec3(0.33))), 0.12 * step(0.8, grit));    // (a grey grain here and there)
    float st = gHash(floor(p * 0.6) + 7.0); if (st > 0.94 && length(fract(p * 0.6) - 0.5) < 0.22) g = mix(g, vec3(0.95, 0.88, 0.72), 0.55);   // (a pale stone)
    return g * bevel;
  }
  return c * bevel;
}`;
