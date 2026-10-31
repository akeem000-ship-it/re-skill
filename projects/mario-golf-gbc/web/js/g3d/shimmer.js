// SHIMMER (3D overworld, render only; adapted from Mario Tennis's shimmer.js, its window shimmer): water and glass glint. On the
// map's blue pixels (blue well above red), a diagonal band of light sweeps across now and then and small sparkles twinkle, so ponds,
// fountains and the windows of the club houses catch the light. Only the map's picture is read; a shader part.
export const SHIMMER_GLSL = `
float sHash(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
vec3 shimmer(vec3 c, vec3 w, float t) {
  if (!(c.b > c.r + 0.15 && c.b >= c.g - 0.05)) return c;
  float band = smoothstep(0.92, 1.0, sin((w.x + w.z) * 0.08 - t * 1.6));
  vec2 cell = floor(w.xz * 0.5); float h = sHash(cell), tw = step(0.985, h) * (0.5 + 0.5 * sin(t * 4.0 + h * 50.0));
  return c + vec3(0.35) * band + vec3(0.6) * tw;
}`;
