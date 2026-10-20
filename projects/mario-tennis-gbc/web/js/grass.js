// "GRASS: Pixel / Blades" (3D overworld): the lawns grow real grass. The lawn in the floor picture (green with little blue: the
// lawns' greens, not the courts' teals or the hedges' and walls' solid squares) gets tufts of blades, each tuft a few blades from
// one root fanning out, coloured from the lawn round it without the game's dither (dark at the root, lighter at the tip), in
// patches taller or shorter, greener or drier, swaying in the
// same travelling wind as the trees and hedges (voxel.js VSP) and bending away from you as you walk through it.
// One instanced draw per map; the blades are made when the floor picture is (voxel.js buildField).
const KEY = "mt-grass";
const VS = `#version 300 es
in vec2 aCorner; in vec4 aBlade; in vec4 aCol; in vec2 aLean;
uniform mat4 uMVP; uniform float uTime; uniform vec3 uPush;
out vec3 vCol; out float vH;
void main() {
  float h = aBlade.z, yaw = aBlade.w, ph = aCol.w;
  vec3 side = vec3(cos(yaw), 0.0, sin(yaw));
  float s = sin(uTime * 1.9 + ph) * 0.75 + sin(uTime * 3.3 + ph * 1.7) * 0.25, t = aCorner.y * aCorner.y;
  vec2 rel = aBlade.xy - uPush.xy; float d = length(rel), push = uPush.z * max(0.0, 1.0 - d / 14.0);
  vec2 away = d > 0.01 ? rel / d : vec2(0.0);
  vec3 p = vec3(aBlade.x, 0.0, aBlade.y) + side * (aCorner.x * (1.0 - aCorner.y)) * 1.7 + vec3(0.0, aCorner.y * h * (1.0 - 0.35 * push), 0.0);
  p += t * (vec3(aLean.x, 0.0, aLean.y) + vec3(s * 1.3, 0.0, s * 0.45) + vec3(away.x, 0.0, away.y) * push * h * 0.8);
  vCol = aCol.rgb; vH = aCorner.y; gl_Position = uMVP * vec4(p, 1.0);
}`;
const FS = `#version 300 es
precision mediump float; in vec3 vCol; in float vH; out vec4 o;
void main() { o = vec4(vCol * mix(0.42, 1.18, vH) + vec3(0.07, 0.08, 0.0) * vH * vH, 1.0); }`;

export class Grass {
  constructor(voxel) {
    this.v = voxel; this.built = null;
    let m = null; try { m = new URLSearchParams(location.search).get("grass"); } catch (e) { /* no location */ }
    if (m === null) { try { m = localStorage.getItem(KEY); } catch (e) { m = null; } }
    this.on = m === "blades" || m === "on"; this.density = 1;
  }
  setOn(on) { this.on = !!on; try { localStorage.setItem(KEY, this.on ? "blades" : "pixel"); } catch (e) { /* private mode */ } }
  init() {
    const v = this.v, gl = v.gl;
    this.prog = v.link(VS, FS, ["aCorner", "aBlade", "aCol", "aLean"]);
    const u = n => gl.getUniformLocation(this.prog, n); this.u = { uMVP: u("uMVP"), uTime: u("uTime"), uPush: u("uPush") };
    this.corner = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.corner);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, 0, 0.5, 0, 0, 1]), gl.STATIC_DRAW);
  }
  // the blades of field f: a tuft of 4-7 blades per 4 x 4 px cell of lawn (by chance, with the density), each blade its own
  // height, turn, lean away from the tuft's root and colour
  build(f) {
    const v = this.v, gl = v.gl, d = f.floorData, w0 = v.gb.mem.wram[0], coll = v.gb.mem.wram[6];
    const MW = Math.min(32, (w0[0x32B] || 64) >> 1), MH = Math.min(32, (w0[0x32C] || 64) >> 1), H = f.mapH || 512;
    const blades = [], cols = [], leans = [], rnd = (x, y, k) => { const s = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453; return s - Math.floor(s); };
    // the lawn's colour without the game's dither (the mean of its lawn pixels round the blade), and patches of the lawn
    // (value noise, about 40 px across) taller or shorter, greener or drier
    const lawn = o => { const r = d[o], g = d[o + 1], b = d[o + 2]; return g > 70 && g >= r && b < g * 0.45; };
    const hash = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
    const noise = (x, y) => { const i = Math.floor(x), j = Math.floor(y), u = x - i, w = y - j, a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), e = hash(i + 1, j + 1), su = u * u * (3 - 2 * u), sw = w * w * (3 - 2 * w); return a + (b - a) * su + (c - a) * sw + (a - b - c + e) * su * sw; };
    // a tuft of 4-7 blades round a cell of size c at (x, y), from the lawn colour (r, g, b)
    const tuft = (x, y, c, r, g, b) => {
      const tall = noise(x / 38, y / 38), dry = noise(x / 55 + 17, y / 55 + 5), dr = Math.max(0, dry - 0.55) * 1.6;   // dry patches: yellower
      const cx = x - c / 2 + rnd(x, y, 1) * c, cz = y - c / 2 + rnd(x, y, 2) * c, m = 4 + Math.floor(rnd(x, y, 3) * 4);
      for (let i = 0; i < m; i++) {
        const a = rnd(x, y, 10 + i) * 6.2832, out = 0.4 + rnd(x, y, 20 + i) * 0.8, k = 0.8 + 0.3 * noise(x / 9, y / 9) + rnd(x, y, 30 + i) * 0.16;
        const h = (3.5 + rnd(x, y, 40 + i) * 4.5) * (0.55 + 0.9 * tall), X = cx + Math.cos(a) * out * 0.6, Z = cz + Math.sin(a) * out * 0.6;
        blades.push(X, Z, h, a + 1.5708 + (rnd(x, y, 50 + i) - 0.5) * 0.8);
        cols.push(Math.min(1, (r / 255 + dr * 0.25) * k + 0.02), Math.min(1, g / 255 * k * (1 + dr * 0.08)), Math.min(1, b / 255 * k), X * 0.11 + Z * 0.07 + rnd(x, y, 6) * 0.8);
        leans.push(Math.cos(a) * out * h * 0.35, Math.sin(a) * out * h * 0.35);
      }
    };
    for (let y = 2; y < H; y += 4) for (let x = 2; x < 512; x += 4) {
      const mx = x >> 4, my = y >> 4; if (mx >= MW || my >= MH || coll[my * 32 + mx] === 0x0F || (f.covered && f.covered[my * 32 + mx])) continue;
      if (!lawn((y * 512 + x) * 4)) continue;                                  // a lawn green (not a court's teal)
      if (rnd(x, y, 0) > 0.9 * this.density) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -3; dy <= 3; dy += 2) for (let dx = -3; dx <= 3; dx += 2) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= 512 || yy >= H) continue;
        const o = (yy * 512 + xx) * 4; if (!lawn(o)) continue; r += d[o]; g += d[o + 1]; b += d[o + 2]; n++;
      }
      r /= n; g /= n; b /= n;
      tuft(x, y, 4, r, g, b);
    }
    // the plain ground the view adds round the map (voxel.js f.skirt) when it is lawn: a band of tufts 160 px wide, sparser,
    // in the lawn's mean colour (above the map's top edge only when no neighbouring map is drawn there)
    const sk = f.skirtSrc >= 0 ? f.skirtSrc * 4 : -1;
    if (f.skirt && (f.grassSrc || (sk >= 0 && lawn(sk)))) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let o = 0; o < 512 * H * 4; o += 4 * 7) if (lawn(o)) { r += d[o]; g += d[o + 1]; b += d[o + 2]; n++; }
      if (!n && sk >= 0) { r = d[sk]; g = d[sk + 1]; b = d[sk + 2]; n = 1; }
      r /= n; g /= n; b /= n; const B = 160;
      for (let y = 3 - B; y < H + B; y += 6) for (let x = 3 - B; x < 512 + B; x += 6) {
        if ((x >= 0 && x < 512 && y >= 0 && y < H) || (y < 0 && f.neighbour) || rnd(x, y, 0) > 0.8 * this.density) continue;
        tuft(x, y, 6, r, g, b);
      }
    }
    if (this.built) { for (const k of ["bb", "cb", "lb"]) gl.deleteBuffer(this.built[k]); gl.deleteVertexArray(this.built.vao); }
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.corner); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const bb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(blades), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(1, 1);
    const cb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(cols), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(2, 1);
    const lb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, lb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(leans), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);
    this.built = { floor: d, vao, bb, cb, lb, n: blades.length / 4 };
  }
  // voxel.js drawFieldScene, after the floor and walls: the map's own blades (not a neighbouring map's), you pushing them aside
  draw(f, mvp, T) {
    if (!this.on || !f.floorData || f.noGlass) return;
    const v = this.v, gl = v.gl;
    try { if (!this.prog) this.init(); if (!this.built || this.built.floor !== f.floorData) this.build(f); } catch (e) { console.warn("grass", e); this.on = false; return; }
    if (!this.built.n) return;
    const me = v.fi && v.fi.act && v.fi.act.get(0), push = me ? [me.x, me.y + 4, 1] : [0, 0, 0];
    gl.useProgram(this.prog); gl.uniformMatrix4fv(this.u.uMVP, false, mvp); gl.uniform1f(this.u.uTime, T); gl.uniform3fv(this.u.uPush, push);
    gl.bindVertexArray(this.built.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, this.built.n);
    gl.bindVertexArray(v.vao); gl.useProgram(v.prog);
  }
}
export function attachGrass(voxel, hud) {
  const g = voxel.grass = new Grass(voxel);
  if (hud) {
    const b = document.createElement("span"); b.className = "k"; b.id = "grassbtn"; b.title = "3D overworld: the lawns as the game's pixels, or grown with blades of grass that sway and part as you walk";
    const show = () => { b.textContent = "GRASS: " + (g.on ? "Blades" : "Pixel"); b.classList.toggle("on", g.on); };
    b.addEventListener("pointerdown", () => { g.setOn(!g.on); show(); });
    hud.appendChild(document.createTextNode(" ")); hud.appendChild(b); show();
  }
  return g;
}
