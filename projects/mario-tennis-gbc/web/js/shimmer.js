// Window shimmer for the 3D / VOX overworld ("a view effect": it works with LIGHT off and changes nothing in the game). Windows are found in the
// building pictures by their light-blue glass colour; every window gets a soft diagonal highlight that sweeps across it every few seconds
// (each window a little out of step with the next) and a sparse sparkle. The glass walls of the first building (field object `glass: true`)
// are drawn here too: thin vertical panes with a slim frame, a faint tint and the same sweep. At dusk and night the effect gives way
// (lighting.js lights the windows then): its strength is 1 - the sky's lamp level.
// Hooks in voxel.js (marked SHIMMER): the two programs, the block faces drawn with FS_SHIM, the glass panes drawn after the actors.
const KEY = "mt-shimmer";
export const FS_SHIM = `#version 300 es
precision highp float; in vec2 vUV; uniform sampler2D uTex; uniform vec4 uTint; uniform float uAlphaTest, uTime, uShim; out vec4 o;
float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec4 t = texture(uTex, vUV), c = t * uTint; if (c.a < uAlphaTest) discard;
  if (uShim > 0.0) {
    float glass = step(0.2, t.b - t.r) * step(0.55, t.b) * step(0.3, t.g);                    // light-blue window glass
    if (glass > 0.0) {
      vec2 px = vUV * 512.0; float ph = h21(floor(px / 20.0));
      float x = fract((px.x * 0.7 + px.y * 1.1) * 0.012 - uTime * 0.17 + ph);                // a diagonal band, one pass every ~6 s
      float band = smoothstep(0.0, 0.05, x) * (1.0 - smoothstep(0.05, 0.14, x));
      float spark = step(0.9965, h21(floor(px) + floor(uTime * 4.0 + ph * 9.0) * 7.13));
      c.rgb += glass * uShim * (band * 0.34 + spark * 0.45) * vec3(1.0, 1.0, 0.94);
    }
  }
  o = c;
}`;
export const VS_GLASS = `#version 300 es
in vec3 aPos3; in vec2 aUV3; uniform mat4 uMVP; out vec2 vUV; out vec3 vW;
void main() { vUV = aUV3; vW = aPos3; gl_Position = uMVP * vec4(aPos3, 1.0); }`;
export const FS_GLASS = `#version 300 es
precision highp float; in vec2 vUV; in vec3 vW; uniform float uTime, uShim, uK; out vec4 o;   // uK: how strongly the glass shows (1 = faint, the first building)
float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  float frame = max(step(vUV.x, 0.05) + step(0.95, vUV.x), step(vUV.y, 0.035) + step(0.965, vUV.y));
  vec3 col = mix(mix(vec3(0.70, 0.86, 1.0), vec3(0.52, 0.74, 0.98), clamp(uK - 1.0, 0.0, 1.0)), vec3(0.88, 0.96, 1.0), clamp(frame, 0.0, 1.0));
  float a = (0.07 + 0.05 * vUV.y) * uK + 0.5 * min(1.6, uK) * clamp(frame, 0.0, 1.0);
  a += 0.10 * (uK - 1.0) * smoothstep(0.55, 1.0, vUV.y);   // a brighter top edge on the stronger glass
  float ph = h21(floor(vec2(vW.x, vW.z) / 32.0));
  float x = fract((vW.x + vW.z) * 0.02 + vUV.y * 0.35 - uTime * 0.17 + ph);
  float band = smoothstep(0.0, 0.05, x) * (1.0 - smoothstep(0.05, 0.15, x));
  a += uShim * band * 0.16 * uK; col = mix(col, vec3(1.0), uShim * band * 0.6);
  o = vec4(col, a);
}`;

export class WindowShimmer {
  constructor(voxel) {
    this.v = voxel; const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
    let m = q.get("shimmer"); if (m === null) { try { m = localStorage.getItem(KEY); } catch (e) { m = null; } }
    this.on = m !== "off"; this.onChange = null;
  }
  setOn(on) { this.on = !!on; try { localStorage.setItem(KEY, this.on ? "on" : "off"); } catch (e) { /* private mode */ } if (this.onChange) this.onChange(this.on); }
  // 0..1: full in daylight, fading with the lamp level of lighting.js (dusk / night), 0 when switched off
  level() { if (!this.on) return 0; const L = this.v.light, lamps = L && L.active && L.sky ? L.sky.lamps || 0 : 0; return Math.max(0, 1 - lamps * 1.6); }
}
