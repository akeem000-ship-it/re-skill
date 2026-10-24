// "FIELD LIFE: on / off": a little life over the overworld's outdoor maps in the 3D view, drawn with the scenery (so the lighting and the
// time of day apply):
//   birds          now and then a small flock crosses the sky over the map, wings beating (by day)
//   cloud shadows  soft dark patches drifting slowly across the ground with the wind (by day)
//   fountains      glints twinkling on the water by day; at night the water is lit from below (a cool glow at the basin)
//   fireflies      at night, small green-gold lights drifting low over the ground round you, each blinking on and off
//   walkers        on the outdoor maps a few people walk the paths: the map's own kinds of people (copied from the actor table as they
//                  are seen), on the open squares of its collision grid, turning at the junctions and now and then stopping; their frames
//                  are the game's own for each facing (read from the ROM as voxel.js does for people off the Game Boy screen)
//   puddles        after a rainy match (WEATHER: Rain / Wet, weather.js) the ground keeps puddles for a while: dark wet patches with the
//                  sky's sheen on them (at night the lamps' glow), fixed in place on the map
import { INDOOR_MAPS } from "./lighting.js";
const KEY = "mt-fieldlife";
const hash = (a, b) => { let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export class FieldLife {
  constructor(voxel) {
    this.v = voxel; this.on = (() => { try { return localStorage.getItem(KEY) !== "off"; } catch (e) { return true; } })();
    this.flock = null; this.nextFlock = 8; this.tex = null;
  }
  setOn(on) { this.on = !!on; try { localStorage.setItem(KEY, this.on ? "on" : "off"); } catch (e) { /* private mode */ } }
  // voxel.js renderField, after the scenery: mvp of the view, T seconds, centre of the view (map px)
  draw(mvp, m4, T, cx, cz) {
    const v = this.v, f = v.field, id = v.mapId(); if (!this.on || INDOOR_MAPS.has(id) || f.mapId !== id) return;
    const gl = v.gl, night = v.nightLevel(), day = 1 - Math.min(1, night * 1.4);
    if (!this.tex) { this.tex = v.solidTexture([255, 255, 255, 255]); this.bird = v.texture(8, 4, birdPixels()); this.glow = v.texture(32, 32, glowPixels(32), true); }
    gl.useProgram(v.prog); gl.bindVertexArray(v.vao);
    // cloud shadows: a few big soft blobs on the ground drifting with the wind, wrapping round the view (not on side-view maps: no sky above)
    if (day > 0.05 && !f.noGlass) {
      gl.depthMask(false);
      for (let k = 0; k < 4; k++) {
        const span = 900, x = cx - span / 2 + ((k * 263 + T * 9) % span + span) % span, z = cz - span / 2 + ((k * 401 + T * 4) % span + span) % span;
        v.draw(v.shadowTex, m4.trs(x, 0.4, z, 260 + 60 * (k % 2), 170 + 40 * (k % 3), -Math.PI / 2), mvp, [0, 0, 1, 1], [1, 1, 1, 0.16 * day], 0);
      }
      gl.depthMask(true);
    }
    // birds: a flock of 5-7 crossing the view high up, wings flapping (a two-frame V), about every 25-50 s
    if (day > 0.3) {
      if (!this.flock && T > this.nextFlock) {
        const dir = Math.random() < 0.5 ? 1 : -1, n = 5 + Math.floor(Math.random() * 3);
        this.flock = { t0: T, dir, z: cz - 120 + Math.random() * 100, birds: Array.from({ length: n }, (_, i) => ({ dx: -i * 14 - Math.random() * 8, dz: (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 9 + Math.random() * 4, ph: Math.random() * 6.28 })) };
      }
      const F = this.flock;
      if (F) {
        const s = (T - F.t0) * 70;
        if (s > 700) { this.flock = null; this.nextFlock = T + 25 + Math.random() * 25; }
        else for (const b of F.birds) {
          const x = cx + F.dir * (s - 350 + b.dx), flap = Math.sin(T * 14 + b.ph) > 0;
          v.draw(this.bird, m4.trs(x, 150 + Math.sin(T * 1.3 + b.ph) * 4, F.z + b.dz, F.dir * 9, flap ? 5 : 3, -1.0), mvp, [0, flap ? 0 : 0.5, 1, 0.5], [0.15, 0.14, 0.18, day], 0.3);
        }
      }
    }
    // puddles after a rainy match: in a fixed grid of 96-px cells about the view, one cell in four holds one (jittered, sized by its hash)
    const W = v.weather, left = W && W.wetUntil ? W.wetUntil - performance.now() / 1000 : 0, wet = Math.max(0, Math.min(1, left / 60));   // (the last minute: drying up)
    if (wet > 0 && !f.noGlass) {
      gl.depthMask(false); const C = 96, i0 = Math.floor((cx - 260) / C), i1 = Math.floor((cx + 260) / C), j0 = Math.floor((cz - 220) / C), j1 = Math.floor((cz + 220) / C);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const h = hash(i + id * 131, j); if (h > 0.25) continue;
        const x = (i + 0.2 + hash(i, j + 7) * 0.6) * C, z = (j + 0.2 + hash(i + 3, j) * 0.6) * C, rx = 18 + 30 * hash(j, i), rz = rx * (0.45 + 0.25 * hash(i + 9, j));
        v.draw(v.shadowTex, m4.trs(x, 0.3, z, rx * 2, rz * 2, -Math.PI / 2), mvp, [0, 0, 1, 1], [1, 1, 1, 0.3 * wet], 0);                     // the wet patch
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        v.draw(this.glow, m4.trs(x - rx * 0.15, 0.5, z - rz * 0.1, rx * 1.3, rz * 1.1, -Math.PI / 2), mvp, [0, 0, 1, 1], night > 0.3 ? [1, 0.85, 0.55, 0.18 * wet * night] : [0.7, 0.8, 0.95, 0.22 * wet * day], 0);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }
      gl.depthMask(true);
    }
    // fireflies at night: 22 lights wandering low round the view's centre, each blinking on its own slow beat
    if (night > 0.3 && !f.noGlass) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthMask(false);
      for (let k = 0; k < 22; k++) {
        const a = hash(k, 1) * 6.28, r = 40 + 170 * hash(k, 2), sp = 0.05 + 0.08 * hash(k, 3);
        const x = cx + Math.cos(a + T * sp) * r + 14 * Math.sin(T * 0.9 + k), z = cz + Math.sin(a + T * sp) * r * 0.7 + 10 * Math.cos(T * 0.7 + k * 2), y = 8 + 26 * hash(k, 4) + 6 * Math.sin(T * 1.3 + k);
        const blink = Math.pow(Math.max(0, Math.sin(T * (0.8 + hash(k, 5)) + k * 2.1)), 3) * night;
        if (blink < 0.03) continue;
        v.draw(this.glow, m4.trs(x, y, z, 20, 20, -0.3), mvp, [0, 0, 1, 1], [0.75, 1, 0.35, 0.55 * blink], 0);                                // the glow
        v.draw(this.tex, m4.trs(x, y, z, 3, 3, -0.3), mvp, [0, 0, 1, 1], [1, 1, 0.7, blink], 0);                                           // the light
      }
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(true);
    }
    // fountains: glints on the water by day, a cool glow from below at night
    const fx = f.fx;
    for (const fo of (fx && fx.fountains) || []) {
      const [ox, oy, oz] = fo.origin;
      if (night > 0.2) {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthMask(false);
        v.draw(this.glow, m4.trs(ox, oy + 1.5, oz, 70, 46, -Math.PI / 2), mvp, [0, 0, 1, 1], [0.35, 0.75, 1.0, 0.45 * night], 0);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(true);
      } else {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        for (let k = 0; k < 10; k++) {
          const a = k * 2.4 + 0.3, r = 8 + (k * 7) % 18, tw = Math.pow(Math.max(0, Math.sin(T * (3 + k % 4) + k * 1.7)), 12);
          if (tw < 0.05) continue;
          v.draw(this.tex, m4.trs(ox + Math.cos(a) * r, oy + 1 + (k % 3), oz + Math.sin(a) * r * 0.7, 2.5 * tw + 0.5, 2.5 * tw + 0.5, -0.3, 0.785), mvp, [0, 0, 1, 1], [1, 1, 1, 0.9 * tw * day], 0);
        }
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }
    }
    // ponds (voxel.js f.water: the solid metatiles of water left flat): sun glints twinkling across the water by day, a soft cool sheen
    // over it at night, each tile on its own phase
    const pond = f.water;
    if (pond && pond.some(x => x)) {
      const surf = this.pondSurface(f);                                   // the water itself: smooth, deeper blue away from the shore
      if (surf && !f.fading) v.draw(surf, m4.trs(256, 0.35, 512, 512, 512, -Math.PI / 2), mvp, [0, 0, 1, 1], [1, 1, 1, 1], 0.5);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthMask(false);
      for (let i = 0; i < 1024; i++) {
        if (!pond[i]) continue;
        const x0 = (i & 31) * 16, z0 = (i >> 5) * 16;
        if (night > 0.2) { v.draw(this.glow, m4.trs(x0 + 8, 1, z0 + 8, 30, 30, -Math.PI / 2), mvp, [0, 0, 1, 1], [0.3, 0.55, 0.9, 0.12 * night], 0); continue; }
        for (let k = 0; k < 2; k++) {
          const h1 = hash(i * 2 + k, 7), h2 = hash(i * 2 + k, 8), tw = Math.pow(Math.max(0, Math.sin(T * (1.3 + 2 * h1) + h2 * 40)), 14);
          if (tw < 0.05) continue;
          const s = 2.4 * tw + 0.6;
          v.draw(this.tex, m4.trs(x0 + 2 + 12 * h1, 1 + k * 0.1, z0 + 2 + 12 * h2, s, s, -Math.PI / 2, 0.785), mvp, [0, 0, 1, 1], [1, 1, 1, 0.85 * tw * day], 0);
        }
      }
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(true);
    }
  }
}
// the pond's water as one smooth surface over the map's dithered water tiles: the water pixels of the water metatiles (blue, and the
// white sparkle dots among them) in the water's own average blue, lighter at the shore and darker towards the middle, with faint
// broad ripples; everything else clear. Made once per map picture (f.floorData).
FieldLife.prototype.pondSurface = function (f) {
  if (this.pond && this.pond.floor === f.floorData) return this.pond.tex;
  const fl = f.floorData, W = f.water, N = 512, isBlue = o => fl[o + 2] > 120 && fl[o + 2] > fl[o] + 50 && fl[o + 2] >= fl[o + 1];
  const wet = new Uint8Array(N * N); let sr = 0, sg = 0, sb = 0, n = 0;
  for (let i = 0; i < 1024; i++) if (W[i]) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const px = (i & 31) * 16 + x, py = (i >> 5) * 16 + y, o = (py * N + px) * 4;
    if (isBlue(o)) { wet[py * N + px] = 1; sr += fl[o]; sg += fl[o + 1]; sb += fl[o + 2]; n++; }
  }
  if (!n) { this.pond = { floor: fl, tex: null }; return null; }
  // the white dots: a light pixel with blue water on three sides two pixels away is water too
  const add = [];
  for (let i = 0; i < 1024; i++) if (W[i]) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const px = (i & 31) * 16 + x, py = (i >> 5) * 16 + y; if (wet[py * N + px]) continue;
    const o = (py * N + px) * 4; if (fl[o] + fl[o + 1] + fl[o + 2] < 560) continue;
    let k = 0, shore = 0;                                                 // blue water round it in a 7 x 7 window, and no shore (orange, brown, green)
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const qx = px + dx, qy = py + dy; if (qx < 0 || qy < 0 || qx >= N || qy >= N) continue;
      const q = (qy * N + qx) * 4; if (wet[qy * N + qx]) k++; else if (fl[q] > fl[q + 2] + 40 || fl[q + 1] > fl[q + 2] + 30) shore++;
    }
    if (k >= 8 && !shore) add.push(py * N + px);
  }
  for (const i of add) wet[i] = 1;
  // distance to the shore (chamfer, capped)
  const D = new Float32Array(N * N).fill(0);
  for (let i = 0; i < N * N; i++) D[i] = wet[i] ? 99 : 0;
  for (let y = 1; y < N; y++) for (let x = 1; x < N - 1; x++) { const i = y * N + x; if (D[i]) D[i] = Math.min(D[i], D[i - 1] + 1, D[i - N] + 1, D[i - N - 1] + 1.4, D[i - N + 1] + 1.4); }
  for (let y = N - 2; y >= 0; y--) for (let x = N - 2; x > 0; x--) { const i = y * N + x; if (D[i]) D[i] = Math.min(D[i], D[i + 1] + 1, D[i + N] + 1, D[i + N + 1] + 1.4, D[i + N - 1] + 1.4); }
  const r0 = sr / n, g0 = sg / n, b0 = sb / n, d = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    if (!wet[i]) continue;
    const x = i % N, y = (i / N) | 0, t = Math.min(1, D[i] / 22), rip = 0.035 * Math.sin(x * 0.11 + y * 0.23) * Math.sin(x * 0.05 - y * 0.07);
    const k = 1.12 - 0.3 * t + rip, w = Math.max(0, 1 - D[i] / 2.5) * 0.25;          // lighter in the shallows, a pale lip at the edge
    d.set([Math.min(255, r0 * k + 255 * w), Math.min(255, g0 * k + 255 * w), Math.min(255, b0 * k + 40 * w), 255], i * 4);
  }
  const tex = this.v.texture(N, N, d, true); this.pond = { floor: fl, tex }; return tex;
};
const DIRS = [[1, 0, 0x00], [0, 1, 0x40], [-1, 0, 0x80], [0, -1, 0xC0]];   // right, towards the viewer, left, away (DirectionToFacing 04:56B3)
const WALK = 26;                                                             // px a second
FieldLife.prototype.drawWalkers = function (mvp, TILT) {
  const v = this.v, f = v.field, id = v.mapId(), T = performance.now() / 1000;
  if (!this.on || INDOOR_MAPS.has(id) || !f || f.noGlass || f.mapId !== id || v.seam) return;
  const w0 = v.gb.mem.wram[0], w4 = v.gb.mem.wram[4], coll = v.gb.mem.wram[6], MW = Math.min(32, (w0[0x32B] || 64) >> 1), MH = Math.min(32, (w0[0x32C] || 64) >> 1);
  if (!this.wk || this.wk.id !== id || this.wk.floor !== f.floorData) this.wk = { id, kinds: [], walkers: [], t: T, floor: f.floorData, path: pathSquares(f.floorData) };
  const K = this.wk, dt = Math.min(0.1, T - K.t); K.t = T;
  const open = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH && K.path[y * 32 + x] && coll[y * 32 + x] !== 0x0F && !(f.covered && f.covered[y * 32 + x]);
  // the kinds of people: actor slots 1+ (0 is you) with frames for every facing, up to four kinds per map
  for (let i = 1; i < 24 && K.kinds.length < 4; i++) {
    const b = i * 0x40, obj = w4[b + 0x21]; if (!w4[b + 1] || !obj || w4[b + 0x35] === 1 || K.kinds.some(k => k.obj === obj)) continue;
    const snap = w4.slice(b, b + 0x40); if (DIRS.some(d => v.actorRomFrame(0, d[2], snap) < 0)) continue;
    K.kinds.push({ obj, snap });
  }
  if (!K.kinds.length) return;
  const want = v.nightLevel() > 0.5 ? 2 : 5, me = v.fieldActors()[0], cx = me ? me.x / 16 : MW / 2, cy = me ? me.y / 16 : MH / 2;
  for (let tries = 0; K.walkers.length < want && tries < 40; tries++) {                // (somewhere within ten squares of you)
    const mx = Math.floor(cx + (Math.random() * 2 - 1) * 10), my = Math.floor(cy + (Math.random() * 2 - 1) * 10); if (!open(mx, my)) continue;
    K.walkers.push({ mx, my, d: Math.floor(Math.random() * 4), u: 0, wait: Math.random() * 2, kind: K.walkers.length % K.kinds.length, walked: 0 });
  }
  for (const w of K.walkers) {
    if (w.wait > 0) w.wait -= dt;
    else {
      const D = DIRS[w.d]; if (!open(w.mx + D[0], w.my + D[1])) w.u = 1;           // (a blocked way: choose again at once)
      else { w.u += dt * WALK / 16; w.walked += dt * WALK; }
      if (w.u >= 1) {
        if (open(w.mx + D[0], w.my + D[1])) { w.mx += D[0]; w.my += D[1]; }
        w.u = 0;
        const ways = [0, 1, 2, 3].filter(k => open(w.mx + DIRS[k][0], w.my + DIRS[k][1])), fwd = ways.filter(k => k !== (w.d + 2) % 4);
        if (Math.random() < 0.06) { w.wait = 1 + Math.random() * 2.5; w.d = 1; }    // a stop, turned towards the viewer
        else if (fwd.length) w.d = fwd.includes(w.d) && Math.random() < 0.7 ? w.d : fwd[Math.floor(Math.random() * fwd.length)];
        else if (ways.length) w.d = ways[0];
      }
    }
    // the body: the facing's frame (two 8x16 parts), mirrored every other step when walking up or down the screen
    const E = DIRS[w.d], k = K.kinds[w.kind], t = v.actorRomFrame(0, E[2], k.snap); if (t < 0) continue;
    const attr = k.snap[0x37] & 0xDF, step = w.wait <= 0 && (w.d & 1) && Math.floor(w.walked / 8) % 2, X = (w.mx + E[0] * w.u) * 16 + 8, Y = (w.my + E[1] * w.u) * 16 + 12;
    const list = step ? [{ sx: 72, sy: 64, h: 16, tile: (t + 2) & 0xFE, attr: attr | 0x20, vb: 2, owner: null }, { sx: 80, sy: 64, h: 16, tile: t & 0xFE, attr: attr | 0x20, vb: 2, owner: null }]
                      : [{ sx: 72, sy: 64, h: 16, tile: t & 0xFE, attr, vb: 2, owner: null }, { sx: 80, sy: 64, h: 16, tile: (t + 2) & 0xFE, attr, vb: 2, owner: null }];
    v.drawBody(v.bodyOf(list, 80, 80), X, Y + 4, w.wait <= 0 ? Math.abs(Math.sin(w.walked / 8 * Math.PI)) * 0.8 : 0, 1, TILT, mvp);
  }
};
// the map's path squares (16 x 16 px): mostly not green in the floor picture (the paths' orange, brown and grey paving; not grass,
// hedges or the courts' greens and teals), so the walkers keep to the paths
function pathSquares(floor) {
  const out = new Uint8Array(32 * 32); if (!floor) return out;
  for (let my = 0; my < 32; my++) for (let mx = 0; mx < 32; mx++) {
    let n = 0;
    for (let y = 1; y < 16; y += 2) for (let x = 1; x < 16; x += 2) { const o = ((my * 16 + y) * 512 + mx * 16 + x) * 4; if (!(floor[o + 1] > floor[o] + 12)) n++; }
    out[my * 32 + mx] = n >= 52 ? 1 : 0;                                       // 52 of the 64 samples
  }
  return out;
}
// a white disc fading out to the edge (the glows: added to the scene, tinted when drawn)
function glowPixels(n) {
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const r = Math.hypot((x + 0.5) / n * 2 - 1, (y + 0.5) / n * 2 - 1); d.set([255, 255, 255, r >= 1 ? 0 : Math.round(255 * (1 - r) ** 1.6)], (y * n + x) * 4); }
  return d;
}
// a bird, 8 x 2 in two frames (wings up, wings level), white: tinted dark when drawn
function birdPixels() {
  const rows = ["1000000100000000", "0110011000000000", "0000000000000000", "1111111100000000"], d = new Uint8Array(8 * 4 * 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) if (rows[y][x] === "1") d.set([255, 255, 255, 255], (y * 8 + x) * 4);
  return d;
}

export function addFieldLifeButton(hud, life) {
  if (!hud || !life) return null;
  const b = document.createElement("span"); b.className = "k"; b.id = "fieldlifebtn"; b.title = "Overworld (3D): birds crossing the sky, cloud shadows drifting over the ground, sparkling fountains lit at night, fireflies at night, puddles after a rainy match, people walking about";
  const show = () => { b.textContent = "FIELD LIFE: " + (life.on ? "on" : "off"); b.classList.toggle("on", life.on); };
  b.addEventListener("pointerdown", () => { life.setOn(!life.on); show(); });
  hud.appendChild(document.createTextNode(" ")); hud.appendChild(b); show(); return b;
}
export function attachFieldLife(voxel, hud) { const l = voxel.life = new FieldLife(voxel); addFieldLifeButton(hud, l); return l; }
