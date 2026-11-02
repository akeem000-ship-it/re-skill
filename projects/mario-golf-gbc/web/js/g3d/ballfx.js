// BALL FX (3D hole view, render only; adapted from Mario Tennis's ballfx.js): what the ball does, made visible. It reads the game's
// ball (WRAM6 $D400: position, height, velocity, curve $D40F, spin $D411), the club ($D329), the shot mode ($D32A) and the shot's
// outcome; it writes nothing of the game.
//   trail     dots behind the ball in flight and along a long roll, coloured by the shot: a full swing white, a power shot (shot mode 1)
//             orange and hotter, an approach shot (mode 2) sky blue, a putt a faint line on the green; a curving ball's trail bends
//   spin      a seam turning round the ball in flight at a rate from the spin byte (backspin one way, topspin the other), at the
//             ball's drawn size (ball3d.js: the ball itself turns with the spin too)
//   landing   at the first touch-down a burst coloured by what is under the ball: grass bits off the fairway and rough, sand out of a
//             bunker, a spray on the green
//   splash    in the water a column of drops, a ring of spray and rings spreading on the surface
//   holed     a sparkle out of the cup
import { T } from "./hole3d.js";

const TRAIL = { 0: [1, 1, 1], 1: [1, 0.62, 0.2], 2: [0.55, 0.85, 1] };
export class BallFx {
  key = "ballfx";
  holeBuilt() { this.trail = []; this.rings = []; }
  frame(sc, game, s) {
    if (!s) return;
    this.trail = this.trail || []; this.rings = this.rings || [];
    for (const [k, d] of sc.events || []) {
      if (k === "launch") { this.trail = []; this.shot = { club: d.club, mode: d.mode }; if (d.terr === T.BUNKER || d.terr === T.BUNKER2) this.burst(sc, d.at, "sand", 1.3); }
      else if (k === "land") this.landing(sc, d);
      else if (k === "stop") { if (d.outcome === 3) this.splash(sc, d.at); if (d.outcome === 0x80) this.sparkle(sc, d.cup); }
    }
    // the trail: the ball's points while it flies or rolls fast
    const v = s.vel, sp = Math.hypot(v[0], v[2]);
    if (sc.inShot && (s.air || sp > 0.02)) { this.trail.push([s.ball[0], s.ball[1], s.ball[2], s.air]); if (this.trail.length > (s.air ? 70 : 240)) this.trail.shift(); }
    this.spin = game.w.wram[6][0x411] << 24 >> 24; this.air = s.air;
  }
  landing(sc, d) {
    const t = d.terr;
    if (t === T.WATER) return this.splash(sc, d.at);
    this.burst(sc, d.at, t === T.BUNKER || t === T.BUNKER2 ? "sand" : t === T.GREEN ? "green" : t === T.ROUGH || t === T.OB ? "rough" : "grass", Math.min(1.6, 0.6 + Math.hypot(d.vel[0], d.vel[2]) * 2));
  }
  burst(sc, at, kind, k = 1) {
    const H = sc.hole.H, y = H(at[0], at[2]), tc = sc.hole.typeCol;
    const col = kind === "sand" ? [tc[2 * 3], tc[2 * 3 + 1], tc[2 * 3 + 2]] : kind === "green" ? [tc[18], tc[19], tc[20]] : kind === "rough" ? [tc[3], tc[4], tc[5]] : [tc[0], tc[1], tc[2]];
    const n = Math.round((kind === "sand" ? 40 : 22) * k * (sc.lite ? 0.5 : 1));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = (kind === "sand" ? 6 : 4) * k * (0.4 + Math.random()), up = (kind === "sand" ? 9 : 7) * k * (0.5 + Math.random());
      const sh = 0.75 + Math.random() * 0.45;
      sc.spawn({ x: at[0], y: y + 0.1, z: at[2], vx: Math.cos(a) * s, vy: up, vz: Math.sin(a) * s, t: 0, life: 0.7 + Math.random() * 0.6, g: 28, drag: 0.8,
        c: col.map(v => Math.min(1, v * sh)), size: kind === "sand" ? 0.35 : 0.28, bounce: 0.2 });
    }
    if (kind === "sand") for (let i = 0; i < 6 * k; i++) sc.spawn({ x: at[0], y: y + 0.4, z: at[2], vx: (Math.random() - 0.5) * 3, vy: 1.5 + Math.random(), vz: (Math.random() - 0.5) * 3, t: 0, life: 1.6, g: 0, drag: 1.2, wind: 0.15, c: col.map(v => Math.min(1, v * 1.15)), a: 0.45, size: 1.4, grow: 1.2 });
    this.rings.push({ x: at[0], y, z: at[2], t: 0, life: 0.5, col: [...col.map(v => v * 0.6), 0.5], r: 2.2 * k });
  }
  splash(sc, at) {
    const H = sc.hole.H, y = H(at[0], at[2]);
    const n = sc.lite ? 40 : 90;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = Math.random() * 3, col = i % 3 ? [0.85, 0.93, 1] : [1, 1, 1];
      sc.spawn({ x: at[0], y: y + 0.1, z: at[2], vx: Math.cos(a) * s, vy: 8 + Math.random() * 10, vz: Math.sin(a) * s, t: 0, life: 1.2, g: 30, drag: 0.3, c: col, size: 0.32 });
    }
    for (let i = 0; i < 3; i++) this.rings.push({ x: at[0], y, z: at[2], t: -i * 0.25, life: 1.4, col: [0.9, 0.96, 1, 0.55], r: 5 });
  }
  sparkle(sc, cup) {
    const H = sc.hole.H, y = H(cup[0], cup[1]);
    for (let i = 0; i < (sc.lite ? 30 : 70); i++) {
      const a = Math.random() * 6.283, s = 1 + Math.random() * 3;
      sc.spawn({ x: cup[0], y: y + 0.3, z: cup[1], vx: Math.cos(a) * s, vy: 6 + Math.random() * 8, vz: Math.sin(a) * s, t: 0, life: 1.4, g: 8, drag: 0.6,
        c: [[1, 0.95, 0.4], [1, 1, 1], [0.6, 1, 0.7]][i % 3], size: 0.35 });
    }
  }
  draw(sc, dt) {
    const tr = this.trail || [];
    if (tr.length > 1 && !sc.puttView) {   // (off in the putting view: its own lines show the putt)
      const putt = this.shot && this.shot.club === 0x0D, base = putt ? [1, 1, 1] : TRAIL[(this.shot && this.shot.mode) || 0] || TRAIL[0];
      const H = sc.hole.H, n = tr.length;
      for (let i = 1; i < n; i++) {
        const a = tr[i - 1], b = tr[i], k = i / n;
        for (let j = 0; j < 3; j++) {                   // three dots between two frames' points
          const t = j / 3, x = a[0] + (b[0] - a[0]) * t, h = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
          const y = H(x, z) + Math.max(0, h) + 0.25;
          sc.point(x, y, z, base[0], base[1], base[2], (putt ? 0.35 : 0.75) * k * k, (putt ? 0.18 : 0.3) * (0.5 + k));
        }
      }
    }
    // the spin's seam: two dots turning round the ball in the air
    if (this.air) {
      const br = sc.ballR || 0.2, b = sc.ballWorld(), r = Math.max(0.15, br * 2.2), ph = sc.time * (6 + Math.abs(this.spin || 0) * 0.4) * Math.sign(this.spin || 1);
      for (let k = 0; k < 2; k++) { const a = ph + k * Math.PI; sc.point(b[0] + Math.cos(a) * r, b[1] + br * 0.85 + Math.sin(a) * r, b[2], 0.95, 0.2, 0.2, 0.9, Math.max(0.08, br * 0.9)); }
    }
    // rings spreading on the ground or the water
    const R = this.rings || []; let j = 0;
    for (const q of R) {
      q.t += dt; if (q.t > q.life) continue; R[j++] = q; if (q.t < 0) continue;
      const k = q.t / q.life;
      sc.decal(q.x, q.y, q.z, q.r * (0.4 + k * 1.6), 0, 1, [q.col[0], q.col[1], q.col[2], q.col[3] * (1 - k)], true, 1);
    }
    R.length = j;
  }
}
