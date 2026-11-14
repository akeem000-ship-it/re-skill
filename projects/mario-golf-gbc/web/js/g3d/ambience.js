// AMBIENCE (3D hole view, render only; adapted from Mario Tennis's ambience.js): the air over the hole, moved by the game's own wind
// (wWindSpeed $C815 in mph, wWindAngle $C816):
//   leaves     leaves and bits of grass blowing across the view, faster and more of them as the wind gets up, in the colours of the
//              hole's own trees and rough
//   mist       soft white mist lying over the hole's water, drifting downwind (more of it early and late in the day)
//   sand       puffs blown off the bunkers' lips when the wind is strong
//   motes      pollen and midges in the low sun; fireflies over the rough at night
// Nothing in the game is read but the wind, the hole's terrain and its colours.
import { T, CELLS } from "./hole3d.js";
import { mulberry32 } from "./gl.js";

export class Ambience {
  key = "ambience";
  holeBuilt(sc, hole) {
    // the hole's water and bunker cells, for the mist and the sand
    const w = [], b = [], tr = hole.art.terrain;
    for (let i = 0; i < tr.length; i++) { if (tr[i] === T.WATER && (i % 7 === 0)) w.push(i); if ((tr[i] === T.BUNKER || tr[i] === T.BUNKER2) && i % 5 === 0) b.push(i); }
    this.water = w; this.sand = b; this.rnd = mulberry32(hole.id * 7919 + 1); this.acc = 0;
  }
  update(sc, game, s, dt) {
    if (!this.rnd) this.holeBuilt(sc, sc.hole);
    const r = this.rnd, H = sc.hole.H, f = sc.cam.at, wv = sc.windVec || [0, 0], mph = s.wind[0], tc = sc.hole.typeCol, L = sc.light;
    const k = sc.lite ? 0.4 : 1;
    this.acc += dt;
    const rate = (6 + mph * 2.2) * k;                    // leaves a second
    while (this.acc > 1 / rate) {
      this.acc -= 1 / rate;
      const a = r() * 6.283, d = 10 + r() * 70, x = f[0] + Math.cos(a) * d - wv[0] * 2, z = f[2] + Math.sin(a) * d - wv[1] * 2;
      const leaf = r() < 0.6, c = leaf ? [tc[21] * (0.8 + r() * 0.5), tc[22] * (0.8 + r() * 0.5), tc[23] * (0.6 + r() * 0.4)] : [tc[3] * 1.2, tc[4] * 1.2, tc[5]];
      if (leaf && r() < 0.25) c[0] = Math.min(1, c[0] + 0.35);  // an autumn one
      sc.spawn({ x, y: H(x, z) + 2 + r() * 10, z, vx: wv[0], vy: -0.5 - r(), vz: wv[1], t: 0, life: 4 + r() * 4, g: 1.2, drag: 0.9, wind: 1.2, c, size: leaf ? 0.32 : 0.22, stick: 1.2 });
    }
    // mist over the water (near the camera's focus)
    const mistK = L.night > 0.3 || L.hour < 8.5 || L.hour > 17.5 ? 1 : 0.45;
    if (this.water.length && r() < 0.5 * k * mistK) {
      const i = this.water[(r() * this.water.length) | 0], x = (i % CELLS) * 2 + 1, z = ((i / CELLS) | 0) * 2 + 1;
      if (Math.hypot(x - f[0], z - f[2]) < 160) sc.spawn({ x, y: H(x, z) + 0.6 + r(), z, vx: wv[0] * 0.3, vy: 0.1, vz: wv[1] * 0.3, t: 0, life: 6, g: 0, drag: 0.2, wind: 0.25, c: [0.92, 0.95, 1], a: 0.16, size: 4 + r() * 3, grow: 0.3 });
    }
    // sand off the bunkers in a strong wind
    if (mph >= 8 && this.sand.length && r() < 0.03 * mph * k) {
      const i = this.sand[(r() * this.sand.length) | 0], x = (i % CELLS) * 2 + 1, z = ((i / CELLS) | 0) * 2 + 1;
      if (Math.hypot(x - f[0], z - f[2]) < 140) for (let n = 0; n < 4; n++) sc.spawn({ x, y: H(x, z) + 0.2, z, vx: wv[0] * 0.5, vy: 1 + r(), vz: wv[1] * 0.5, t: 0, life: 1.5, g: 2, drag: 0.6, wind: 0.8, c: [tc[6] * 1.1, tc[7] * 1.08, tc[8] * 1.02], a: 0.4, size: 0.9, grow: 1 });
    }
    // motes in the low sun, fireflies at night
    if (r() < (L.night > 0.5 ? 0.5 : L.hour < 9 || L.hour > 17 ? 0.25 : 0.05) * k) {
      const a = r() * 6.283, d = 5 + r() * 40, x = f[0] + Math.cos(a) * d, z = f[2] + Math.sin(a) * d, ff = L.night > 0.5;
      sc.spawn({ x, y: H(x, z) + 1 + r() * 4, z, vx: (r() - 0.5) * 2, vy: (r() - 0.5) * 0.6, vz: (r() - 0.5) * 2, t: 0, life: 3 + r() * 3, g: 0, drag: 0.5, wind: 0.2,
        c: ff ? [0.85, 1, 0.45] : [1, 0.96, 0.8], a: ff ? 0.95 : 0.5, size: ff ? 0.35 : 0.18 });
    }
  }
}
