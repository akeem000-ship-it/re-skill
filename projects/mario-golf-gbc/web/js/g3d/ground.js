// GROUND (3D overworld, render only; adapted from Mario Tennis's ground.js): the overworld's ground in its own colours, with life in
// it: on grass-coloured pixels (green above red and blue) short blades in a fine pattern that lean with a travelling wind, on
// dirt-coloured ones (red above green above blue) a grain of pebbles. Only the map's picture is read (field3d.js); a shader part.
export const GROUND_GLSL = `
float gHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec3 groundDetail(vec3 c, vec2 p, float t, vec2 wind) {
  if (c.g > c.r + 0.06 && c.g > c.b + 0.04) {
    vec2 q = p * vec2(3.0, 1.5) + vec2(sin(t * 1.7 + p.y * 0.15 + p.x * 0.05) * 0.6, 0.0);
    float b = gHash(floor(q)); return c * (0.9 + 0.18 * b);
  }
  if (c.r > c.g && c.g > c.b + 0.05) return c * (0.94 + 0.1 * gHash(floor(p * 2.0)));
  return c;
}`;
