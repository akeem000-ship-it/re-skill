// OVERWORLD BUILDINGS (3D overworld, render only; with the STORY tab's Overworld trees): the buildings the game paints into the story
// maps' tiles (field_objects.js houses: the Field's four club houses and the log cabin in the woods) stand up as little 3D buildings
// built from their own pixels, in the manner of Mario Tennis's overworld buildings (voxel.js blocks with a pitch: a roof folded along a
// ridge, eaves overhanging the walls). Each building's picture (the map's live pixels in its rectangle, the lawn's green pixels filled
// from their row's building pixels) is copied into a small atlas, and the parts take the rows the 2D art gives them:
//   * "hip" (the club houses): a hipped roof (four slopes, a short ridge, 45-degree hips in plan) over the art's roof rows (ridge ..
//     eave: the shingle stripes and the outline columns on the front slope, the same rows on the hips and the back), a dark fascia and
//     soffit under the eaves, a little spire at the ridge's middle from the art's peak rows, the facade (rows eave .. y1: the columns,
//     windows and door) on the front wall, the side and back walls in each facade row's own wall colour, a step at the door;
//   * "gable" (the cabin): log walls (the art's log rows on the front, the logs' middle columns round the sides and back), a gable end
//     facing the camera with the art's top rows on it (its peak and window), a pitched roof running back with shingles in the gable's
//     colours, barge boards in its outline colour.
// The ground under them is painted lawn (field3d.js: their rectangles cut like the lifted trees), they cast a soft baked shadow with
// the trees (fieldtrees.js shadows: boxes), the people's depth pass puts them back (a person behind one shows the silhouette), and
// one between the camera and the player is dithered see-through as the trees are. Rebuilt with the trees when the palettes change.
import { vao, program, texture, updateTexture, clamp } from "./gl.js";

const VS = `#version 300 es
in vec3 aPos; in vec2 aUV; in float aShade; uniform mat4 uMVP; out vec2 vUV; out float vShade;
void main() { vUV = aUV; vShade = aShade; gl_Position = uMVP * vec4(aPos, 1.0); }`;
const FS = `#version 300 es
precision mediump float; in vec2 vUV; in float vShade; uniform sampler2D uAtlas; uniform float uLightK, uSee; uniform vec4 uFade; out vec4 o;
float bayer4(vec2 f) { ivec2 q = ivec2(mod(f, 4.0)); int i = q.y * 4 + q.x;
  int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5); return (float(b[i]) + 0.5) / 16.0; }
void main() { if (uSee > 0.0 && bayer4(gl_FragCoord.xy) < uSee) discard;
  o = vec4(mix(texture(uAtlas, vUV).rgb * vShade * uLightK, uFade.rgb, uFade.a), 1.0); }`;

const AW = 128, AH = 64, SLOT = 24;   // the atlas: a 24 px wide slot per building (its picture 16 wide, the wall colours, plain texels), shingles below
const green = (r, g, b) => g > r + 15 && g > b + 15;
const lum = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const smooth01 = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

export class FieldHouses {
  // specs: field_objects.js houses; M: the field's map (raw: the live picture before the cut); sun: light3d.js sunDir (toward the sun)
  constructor(sc, specs, M, sun) {
    const gl = sc.gl;
    this.P = sc.housesP || (sc.housesP = program(gl, VS, FS));
    const atlas = new Uint8Array(AW * AH * 4), pos = [], uv = [], sh = [];
    this.houses = [];
    specs.forEach((s, i) => {
      const sx = i * SLOT, info = this.paintSlot(atlas, M.raw, s, sx);
      const h = { ...s, see: 0, first: pos.length / 3 };
      const g = new Geo(pos, uv, sh, sun, [(s.x0 + s.x1) / 2, 4, s.y1 - 6]);
      (s.roof === "gable" ? cabin : clubHouse)(g, s, sx, info);
      h.n = pos.length / 3 - h.first; h.top = g.top; h.zb = g.zb; h.zt = g.zt;
      this.houses.push(h);
    });
    this.tex = texture(gl, AW, AH, atlas);
    this.mesh = { ...vao(gl, this.P, { aPos: [new Float32Array(pos), 3], aUV: [new Float32Array(uv), 2], aShade: [new Float32Array(sh), 1] }), n: pos.length / 3 };
  }
  // the building's picture into its slot: the lawn's pixels filled from the nearest building pixel in their row (the roof's corners,
  // the grass dots among the columns), each facade row's wall colour (its commonest colour that is not the outline), the outline
  // (the darkest colour), and for a gable roof its shingles
  paintSlot(A, raw, s, sx) {
    const w = s.x1 - s.x0, h = s.y1 - s.y0, put = (x, y, c) => A.set([c[0], c[1], c[2], 255], (y * AW + x) * 4);
    const px = (x, y) => { const q = ((s.y0 + y) * 512 + s.x0 + x) * 4; return [raw[q], raw[q + 1], raw[q + 2]]; };
    let top = h, outline = null;
    for (let y = 0; y < h; y++) {
      const row = Array.from({ length: w }, (_, x) => px(x, y)), keep = row.map(c => !green(...c));
      if (keep.some(k => k)) top = Math.min(top, y);
      for (let x = 0; x < w; x++) {
        let c = row[x];
        if (!keep[x]) { let best = null, bd = 99; for (let k = 0; k < w; k++) if (keep[k]) { const d = Math.abs(k - x) + (Math.abs(k - w / 2 + 0.5) < Math.abs(x - w / 2 + 0.5) ? -0.25 : 0); if (d < bd) { bd = d; best = row[k]; } } c = best || c; }
        put(sx + x, y, c);
        if (keep[x] && (!outline || lum(c) < lum(outline))) outline = c;
      }
    }
    const wall = [];                                     // (each facade row's wall colour: the side walls)
    for (let y = s.eave - s.y0; y < h; y++) {
      const cnt = new Map();
      for (let x = 0; x < w; x++) { const c = px(x, y); if (!green(...c)) { const k = c.join(","); cnt.set(k, (cnt.get(k) || 0) + 1); } }
      const ranked = [...cnt].sort((a, b) => b[1] - a[1]).map(([k]) => k.split(",").map(Number));
      const c = ranked.find(c => outline && c.join(",") !== outline.join(",")) || ranked[0] || outline || [200, 200, 200];
      wall.push(c); put(sx + 16, y, c); put(sx + 17, y, c);
    }
    outline = outline || [40, 20, 60];
    const light = wall.reduce((a, c) => lum(c) > lum(a) ? c : a, wall[0] || [220, 220, 220]);
    put(sx + 19, 0, outline); put(sx + 19, 1, light.map(v => v * 0.86)); put(sx + 19, 2, outline.map(v => v * 0.55));
    if (s.roof === "gable") {                            // the shingles: the gable's colours (light, middle, dark), courses of 4 rows
      const cs = new Map();
      for (let y = 0; y < s.eave - s.y0; y++) for (let x = 0; x < w; x++) { const c = px(x, y); if (!green(...c)) { const k = c.join(","); cs.set(k, (cs.get(k) || 0) + 1); } }
      const byL = [...cs].filter(([, n]) => n > 3).map(([k]) => k.split(",").map(Number)).sort((a, b) => lum(a) - lum(b));
      const dark = byL[0] || outline, lt = byL[byL.length - 1] || light, mid = byL[Math.max(0, byL.length - 2)] || lt;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const r = y & 3, seam = (x + (y >> 2) * 2) % 5 === 0;
        const deep = mid.map((v, i) => v * 0.72 + dark[i] * 0.28);   // (a deeper tone than the log walls' light orange: the roof reads apart from them)
        put(sx + x, 32 + y, r === 3 ? dark : seam && r > 0 ? dark.map((v, i) => (v + mid[i]) / 2) : r === 0 ? mid.map((v, i) => (v + lt[i]) / 2) : deep);
      }
    }
    return { top, outline, light };
  }
  // the buildings between the camera and the player (the person nearest the view's centre) see-through, eased as the trees
  seeThrough(eye, player, dt) {
    const k = 1 - Math.exp(-12 * Math.min(dt || 0.016, 0.1));
    for (const h of this.houses) {
      let see = 0;
      if (player) {
        // (the camera looks down at ~48 degrees: a point at height y over pz shows where the ground at pz - 0.9 y does, so the building
        // hides him up to (pz - zt) / 0.9, zt the ground its top shows over; behind the front wall, across its width)
        const [px, pz, ph] = player, dx = Math.max(h.x0 - 3 - px, px - h.x1 - 3, 0), hid = Math.min(ph, (pz - h.zt) / 0.9);
        if (pz < h.y1 + 1 && dx < 4) see = 0.82 * (1 - smooth01(dx / 4)) * smooth01((hid - 3) / 6);
      }
      h.see += (see - h.see) * k; if (h.see < 0.01) h.see = 0;
    }
  }
  draw(sc, mvp, lk, fade) {
    const gl = sc.gl, P = this.P; gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uMVP, false, mvp); gl.uniform1f(P.u.uLightK, lk); gl.uniform4fv(P.u.uFade, fade);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(P.u.uAtlas, 0);
    gl.bindVertexArray(this.mesh.vao);
    for (const h of this.houses) { gl.uniform1f(P.u.uSee, h.see); gl.drawArrays(gl.TRIANGLES, h.first, h.n); }
    gl.uniform1f(P.u.uSee, 0); gl.bindVertexArray(null);
  }
  // depth only (the people's depth pass): the see-through ones left out, so the player shows through them
  drawDepth(sc, mvp) {
    const gl = sc.gl, P = this.P; gl.useProgram(P.p); gl.uniformMatrix4fv(P.u.uMVP, false, mvp); gl.uniform1f(P.u.uSee, 0);
    gl.bindVertexArray(this.mesh.vao);
    for (const h of this.houses) if (h.see < 0.3) gl.drawArrays(gl.TRIANGLES, h.first, h.n);
    gl.bindVertexArray(null);
  }
  // their boxes for the baked shadows (fieldtrees.js shadows)
  boxes() { return this.houses.map(h => ({ x0: h.x0 + 0.5, z0: h.zb, x1: h.x1 - 0.5, z1: h.y1, h: h.top })); }
  free(gl) { this.mesh.free(); gl.deleteTexture(this.tex); }
}

// the triangles of one building: position, atlas uv (in atlas px), shade from the face's normal and the sun
class Geo {
  constructor(pos, uv, sh, sun, centre) { Object.assign(this, { pos, uv, sh, sun, centre }); this.top = 0; this.zb = 0; this.zt = 0; }
  tri(a, b, c, ta, tb, tc, k = 1) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...n) || 1; n = n.map(x => x / l);
    const m = [(a[0] + b[0] + c[0]) / 3 - this.centre[0], (a[1] + b[1] + c[1]) / 3 - this.centre[1], (a[2] + b[2] + c[2]) / 3 - this.centre[2]];
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) n = n.map(x => -x);     // (outward)
    const L = this.sun, d = n[0] * L[0] + n[1] * L[1] + n[2] * L[2];
    const s = clamp((0.7 + 0.32 * Math.max(0, d) + 0.1 * n[2] + 0.06 * n[1]) * k, 0.4, 0.985);
    for (const [p, t] of [[a, ta], [b, tb], [c, tc]]) { this.pos.push(...p); this.uv.push(t[0] / AW, t[1] / AH); this.sh.push(s); this.top = Math.max(this.top, p[1]); }
  }
  quad(a, b, c, d, ta, tb, tc, td, k) { this.tri(a, b, c, ta, tb, tc, k); this.tri(a, c, d, ta, tc, td, k); }
  // a plain-coloured box (an atlas texel)
  box(x0, y0, z0, x1, y1, z1, t, k = 1) {
    const T = [t, t, t, t], c0 = this.centre; this.centre = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], ...T, k);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], ...T, k);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], ...T, k);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], ...T, k);
    this.centre = c0;
  }
}

// a club house: walls, a hipped roof with eaves, a spire, a step
function clubHouse(g, s, sx, info) {
  const fr = s.y1 - s.eave, rr = s.eave - s.ridge, y0 = s.y0;
  const Hw = fr * 1.45, wx0 = s.x0 + 0.8, wx1 = s.x1 - 0.8, zf = s.y1 - 0.4, e = 1.25;
  const run = rr * 0.78, D = Math.max(7, 2 * (run - e)), zb = zf - D;   // (the roof's slopes at ~42 degrees: its front slope shows about as tall as the art's roof rows)
  const he = Hw - 0.3, ex0 = wx0 - e, ex1 = wx1 + e, ez0 = zb - e, ez1 = zf + e, hd = (ez1 - ez0) / 2, zm = (ez0 + ez1) / 2, hr = he + hd * 0.9;
  const rx0 = ex0 + hd, rx1 = Math.max(ex1 - hd, rx0 + 0.01), cx = (s.x0 + s.x1) / 2;
  const U = x => [sx + clamp((x - ex0) / (ex1 - ex0), 0, 1) * 16, 0], V = hh => (s.eave - y0) - (hh - he) / (hr - he) * (s.eave - s.ridge);
  const ut = (x, hh) => [U(x)[0], V(hh)], uz = (z, hh) => [sx + 3 + (ez1 - z) / (ez1 - ez0) * 10, V(hh)];
  const wallU = x => sx + (x - wx0) / (wx1 - wx0) * 16, wallV = hh => s.y1 - y0 - hh / Hw * fr, side = hh => [sx + 16.5, wallV(hh)];
  const O = [sx + 19.5, 0.5], SOF = [sx + 19.5, 2.5], STEP = [sx + 19.5, 1.5];
  // walls
  g.quad([wx0, 0, zf], [wx1, 0, zf], [wx1, Hw, zf], [wx0, Hw, zf], [wallU(wx0), wallV(0)], [wallU(wx1), wallV(0)], [wallU(wx1), wallV(Hw)], [wallU(wx0), wallV(Hw)], 1.04);
  for (const [x, a, b] of [[wx0, zb, zf], [wx1, zf, zb]]) g.quad([x, 0, a], [x, 0, b], [x, Hw, b], [x, Hw, a], side(0), side(0), side(Hw), side(Hw), 0.82);
  g.quad([wx1, 0, zb], [wx0, 0, zb], [wx0, Hw, zb], [wx1, Hw, zb], side(0), side(0), side(Hw), side(Hw), 0.9);
  // the eaves' soffit and fascia (the outline colour)
  const f = 0.55;
  g.quad([ex0, he - f, ez1], [ex1, he - f, ez1], [wx1, he - f, zf], [wx0, he - f, zf], SOF, SOF, SOF, SOF, 1);
  g.quad([ex0, he - f, ez0], [ex1, he - f, ez0], [wx1, he - f, zb], [wx0, he - f, zb], SOF, SOF, SOF, SOF, 1);
  g.quad([ex0, he - f, ez0], [ex0, he - f, ez1], [wx0, he - f, zf], [wx0, he - f, zb], SOF, SOF, SOF, SOF, 1);
  g.quad([ex1, he - f, ez0], [ex1, he - f, ez1], [wx1, he - f, zf], [wx1, he - f, zb], SOF, SOF, SOF, SOF, 1);
  g.quad([ex0, he - f, ez1], [ex1, he - f, ez1], [ex1, he, ez1], [ex0, he, ez1], O, O, O, O, 1.1);
  g.quad([ex0, he - f, ez0], [ex0, he - f, ez1], [ex0, he, ez1], [ex0, he, ez0], O, O, O, O, 1.1);
  g.quad([ex1, he - f, ez1], [ex1, he - f, ez0], [ex1, he, ez0], [ex1, he, ez1], O, O, O, O, 1.1);
  g.quad([ex1, he - f, ez0], [ex0, he - f, ez0], [ex0, he, ez0], [ex1, he, ez0], O, O, O, O, 1.1);
  // the roof: front and back slopes (the art's roof rows), the hips (the same rows, the middle columns)
  const A = [ex0, he, ez1], B = [ex1, he, ez1], C = [rx1, hr, zm], Dd = [rx0, hr, zm], E = [ex0, he, ez0], F = [ex1, he, ez0];
  g.quad(A, B, C, Dd, ut(ex0, he), ut(ex1, he), ut(rx1, hr), ut(rx0, hr), 1.06);
  g.quad(F, E, Dd, C, ut(ex0, he), ut(ex1, he), ut(rx1, hr), ut(rx0, hr), 0.9);
  g.tri(E, A, Dd, uz(ez0, he), uz(ez1, he), uz(zm, hr), 0.86);
  g.tri(B, F, C, uz(ez1, he), uz(ez0, he), uz(zm, hr), 0.86);
  // the ridge and hips capped in the outline colour (thin): the roof's shape reads at the game's size
  const cap = (p, q, w = 0.32) => { const k = [0, w, 0]; g.quad(p, q, q.map((v, i) => v + k[i]), p.map((v, i) => v + k[i]), O, O, O, O, 1); };
  cap(Dd, C); cap(A, Dd); cap(B, C); cap(E, Dd); cap(F, C);
  // the spire: the art's peak rows (above the ridge row) on a slim pyramid at the ridge's middle
  if (s.spire && s.ridge > s.y0 + info.top) {
    const top = info.top, sh = (s.ridge - y0 - top) * 1.6, b = 1.5, hb = hr - 0.4, ap = [cx, hr + sh, zm];
    const su = x => sx + 8 + (x - cx) * 2.2, sv = hh => (s.ridge - y0) - (hh - hb) / (hr + sh - hb) * (s.ridge - y0 - top);
    const P0 = [cx - b, hb, zm + b], P1 = [cx + b, hb, zm + b], P2 = [cx + b, hb, zm - b], P3 = [cx - b, hb, zm - b];
    g.tri(P0, P1, ap, [su(cx - b), sv(hb)], [su(cx + b), sv(hb)], [su(cx), sv(ap[1])], 1.06);
    g.tri(P1, P2, ap, [su(cx - b), sv(hb)], [su(cx + b), sv(hb)], [su(cx), sv(ap[1])], 0.9);
    g.tri(P2, P3, ap, [su(cx - b), sv(hb)], [su(cx + b), sv(hb)], [su(cx), sv(ap[1])], 0.85);
    g.tri(P3, P0, ap, [su(cx - b), sv(hb)], [su(cx + b), sv(hb)], [su(cx), sv(ap[1])], 0.9);
  }
  // a step at the door
  g.box(cx - 2.6, 0, zf, cx + 2.6, 0.8, zf + 1.5, STEP, 1);
  g.zb = zb; g.zt = zm - 0.9 * (s.spire ? hr + 1 : hr);
}

// the log cabin: log walls, a gable end with the art's top rows facing the camera, a pitched roof running back
function cabin(g, s, sx, info) {
  const lr = s.y1 - s.eave, gr = s.eave - s.y0, y0 = s.y0;
  const Hw = lr * 0.8, Ra = gr * 0.52, wx0 = s.x0 + 0.8, wx1 = s.x1 - 0.8, zf = s.y1 - 0.4, D = 13, zb = zf - D, cx = (s.x0 + s.x1) / 2;
  const es = 1.5, ef = 1.3, half = (wx1 - wx0) / 2, slope = Ra / half, he = Hw - es * slope;   // (the eaves' height, the slopes run on past the walls)
  const wallU = x => sx + (x - wx0) / (wx1 - wx0) * 16, logV = hh => s.y1 - y0 - hh / Hw * lr, gabV = hh => gr - (hh - Hw) / Ra * gr;
  const sideU = z => sx + 4 + ((z - zb) / D) * 8;
  const O = [sx + 19.5, 0.5], SOF = [sx + 19.5, 2.5];
  // the log walls
  g.quad([wx0, 0, zf], [wx1, 0, zf], [wx1, Hw, zf], [wx0, Hw, zf], [wallU(wx0), logV(0)], [wallU(wx1), logV(0)], [wallU(wx1), logV(Hw)], [wallU(wx0), logV(Hw)], 1.04);
  g.quad([wx0, 0, zb], [wx0, 0, zf], [wx0, Hw, zf], [wx0, Hw, zb], [sideU(zb), logV(0)], [sideU(zf), logV(0)], [sideU(zf), logV(Hw)], [sideU(zb), logV(Hw)], 0.88);
  g.quad([wx1, 0, zf], [wx1, 0, zb], [wx1, Hw, zb], [wx1, Hw, zf], [sideU(zf), logV(0)], [sideU(zb), logV(0)], [sideU(zb), logV(Hw)], [sideU(zf), logV(Hw)], 0.88);
  g.quad([wx1, 0, zb], [wx0, 0, zb], [wx0, Hw, zb], [wx1, Hw, zb], [wallU(wx1), logV(0)], [wallU(wx0), logV(0)], [wallU(wx0), logV(Hw)], [wallU(wx1), logV(Hw)], 0.85);
  // the corner posts (the logs' crossed ends): the outline colour, a little proud of the walls
  for (const x of [wx0, wx1]) for (const z of [zf, zb]) g.box(x - 0.6, 0, z - 0.6, x + 0.6, Hw + 0.2, z + 0.6, O, 1.25);
  // the gable ends (the art's top rows: the peak and the window)
  const ap = Hw + Ra;
  g.tri([wx0, Hw, zf], [wx1, Hw, zf], [cx, ap, zf], [wallU(wx0), gabV(Hw)], [wallU(wx1), gabV(Hw)], [wallU(cx), gabV(ap)], 1.04);
  g.tri([wx1, Hw, zb], [wx0, Hw, zb], [cx, ap, zb], [wallU(wx1), gabV(Hw)], [wallU(wx0), gabV(Hw)], [wallU(cx), gabV(ap)], 0.85);
  // the roof: two slopes of shingles, overhanging the sides and both ends, with a thickness and barge boards
  const zF = zf + ef, zB = zb - ef, th = 0.6, R = ap + 0.35;
  const shU = z => sx + (zF - z) / (zF - zB) * 16, shV = t => 32 + t * 16;   // (t: 0 at the ridge, 1 at the eave)
  for (const sgn of [-1, 1]) {
    const xe = cx + sgn * (half + es), ridge = [cx, R], eave = [xe, he + 0.35];
    g.quad([eave[0], eave[1], zF], [ridge[0], ridge[1], zF], [ridge[0], ridge[1], zB], [eave[0], eave[1], zB], [shU(zF), shV(1)], [shU(zF), shV(0)], [shU(zB), shV(0)], [shU(zB), shV(1)], sgn < 0 ? 1.02 : 0.96);
    // the barge boards (the roof's front and back edges) and the eave's edge, in the outline colour
    for (const z of [zF, zB]) g.quad([eave[0], eave[1] - th, z], [ridge[0], ridge[1] - th, z], [ridge[0], ridge[1], z], [eave[0], eave[1], z], O, O, O, O, 1.15);
    g.quad([eave[0], eave[1] - th, zF], [eave[0], eave[1] - th, zB], [eave[0], eave[1], zB], [eave[0], eave[1], zF], O, O, O, O, 1.1);
    // the underside (seen in front of the gable)
    g.quad([eave[0], eave[1] - th, zF], [ridge[0], ridge[1] - th, zF], [ridge[0], ridge[1] - th, zB], [eave[0], eave[1] - th, zB], SOF, SOF, SOF, SOF, 1);
  }
  g.box(cx - 0.45, R - 0.2, zB, cx + 0.45, R + 0.45, zF, O, 1.1);   // (the ridge beam)
  g.zb = zb; g.zt = zB - 0.9 * R;
}
