// BIG MOMENTS (3D hole view, render only; adapted from Mario Tennis's matchfx.js and bigmoments.js): a hole in one, an albatross or an
// eagle (the ball holed, $80, with the strokes $C8A0 / $C8E0 against the hole's par $D325) sets off fireworks over the green while
// the camera circles it, with the moment's name; a birdie gets a smaller burst. A tournament won (game mode 1 $C834, the result
// screen's confetti task 0B:5DE1 running) gets fireworks over the game's own result screen. Reads those bytes; writes nothing.
import { drawLabel } from "./labels.js";
import { m4 } from "./gl.js";
import { Golf3D } from "./scene.js";

const NAMES = { 1: "HOLE IN ONE!", [-3]: "ALBATROSS!", [-2]: "EAGLE!", [-1]: "BIRDIE" };
export class Moments {
  key = "moments";
  holeBuilt() { this.m = null; }
  frame(sc, game, s) {
    const w = game.w;
    // the tournament's result screen with its confetti: a win
    const win = w.wram[0][0x834] === 1 && Golf3D.taskOn(w, 0x0B, 0x5DE1);
    if (win && !this.win) this.win = { t: 0, rockets: [] };
    if (!win && this.win && this.win.t > 8) this.win = null;
    if (!s) return;
    for (const [k, d] of sc.events || []) {
      if (k !== "stop" || d.outcome !== 0x80) continue;
      const strokes = s.stroke, par = w.wram[6][0x325], diff = strokes === 1 ? 1 : strokes - par;
      const name = NAMES[diff]; if (!name) continue;
      const big = diff !== -1;
      this.m = { name, t: 0, big, cup: d.cup.slice(), dur: big ? 7 : 2.5, rockets: [], next: 0 };
    }
  }
  holdsScene(sc) { return !!(this.m && this.m.big && this.m.t < this.m.dur); }
  update(sc, game, s, dt) {
    const m = this.m; if (!m) { sc.camOverride = sc.camOverride === this.cam ? null : sc.camOverride; return; }
    m.t += dt;
    if (m.t > m.dur) { this.m = null; if (sc.camOverride === this.cam) sc.camOverride = null; return; }
    const [cx, cz] = m.cup, cy = sc.hole.H(cx, cz);
    if (m.big) {
      this.cam = this.cam || ((s2, dt2) => { const q = this.m; if (!q) return null; const a = q.t * 0.55 + 0.4, r = 26 - Math.min(8, q.t * 2);
        return { eye: [q.cup[0] + Math.cos(a) * r, sc.hole.H(q.cup[0], q.cup[1]) + 9 + Math.sin(q.t * 0.7) * 2, q.cup[1] + Math.sin(a) * r], at: [q.cup[0], sc.hole.H(q.cup[0], q.cup[1]) + 6, q.cup[1]], fov: 55, rate: 2.5 }; });
      sc.camOverride = this.cam;
    }
    // rockets: up from round the green, bursting into a sphere of sparks
    m.next -= dt;
    if (m.next <= 0 && m.t < m.dur - 1.5) { m.next = m.big ? 0.35 : 0.8; this.rocket(sc, cx + (Math.random() - 0.5) * 30, cy, cz + (Math.random() - 0.5) * 30, m.big ? 22 : 14); }
  }
  rocket(sc, x, y, z, h) {
    const col = [[1, 0.3, 0.3], [0.4, 0.8, 1], [1, 0.9, 0.3], [0.5, 1, 0.5], [1, 0.5, 1], [1, 1, 1]][(Math.random() * 6) | 0];
    const vy = Math.sqrt(2 * 25 * h);
    sc.spawn({ x, y, z, vx: 0, vy, vz: 0, t: 0, life: vy / 25, g: 25, drag: 0, c: [1, 0.9, 0.6], size: 0.5, fade: false,
      onEnd: true, burst: col });
    this.pending = this.pending || []; this.pending.push({ x, z, at: performance.now() / 1000 + vy / 25, y: y + h * 0.95, col });
  }
  draw(sc, dt) {
    const now = performance.now() / 1000, P = this.pending || [];
    for (let i = P.length - 1; i >= 0; i--) if (now >= P[i].at) {
      const p = P[i]; P.splice(i, 1);
      const n = sc.lite ? 40 : 90;
      for (let k = 0; k < n; k++) {
        const u = Math.random() * 2 - 1, a = Math.random() * 6.283, r = Math.sqrt(1 - u * u), sp = 9 + Math.random() * 3;
        sc.spawn({ x: p.x, y: p.y, z: p.z, vx: r * Math.cos(a) * sp, vy: u * sp, vz: r * Math.sin(a) * sp, t: 0, life: 1.4 + Math.random() * 0.6, g: 6, drag: 1.1, c: k % 7 ? p.col : [1, 1, 1], size: 0.55, floor: -100 });
      }
    }
  }
  drawOverlay(sc) {
    const m = this.m; if (!m || m.t > m.dur) return;
    const a = Math.min(1, m.t * 3, (m.dur - m.t) * 2);
    drawLabel(sc, m.name, 0.5, 0.3, m.big ? 0.13 : 0.08, { size: 48, fg: m.big ? "#ffe24a" : "#fff", bg: null, stroke: "#402000" }, a);
  }
  // the tournament's result screen: fireworks over the game's own picture (the 3D canvas clear, the sparks in screen space)
  drawOther(sc, game, frame2d, dt) {
    const W = this.win; if (!W) return false;
    W.t += dt; W.next = (W.next || 0) - dt;
    const k = Math.min(1, W.t);
    if (W.next <= 0) { W.next = 0.45; const col = [[1, 0.3, 0.3], [0.4, 0.8, 1], [1, 0.9, 0.3], [0.5, 1, 0.5], [1, 0.5, 1]][(Math.random() * 5) | 0], x = 20 + Math.random() * 120, y = 20 + Math.random() * 60;
      for (let i = 0; i < 70; i++) { const a = Math.random() * 6.283, sp = 20 + Math.random() * 25; W.rockets.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: 1.2 + Math.random() * 0.5, col }); } }
    const gl = sc.gl; sc.mvp = m4.ortho(0, 160, 144, 0, -10, 10); sc.eye = [80, 72, 0]; sc.fade = [0, 0, 0, 0];
    const L = sc.light, keep = [L.fogNear, L.fogFar]; L.fogNear = 1e6; L.fogFar = 2e6;
    let j = 0;
    for (const p of W.rockets) { p.t += dt; if (p.t > p.life) continue; p.vy += 30 * dt; p.vx *= 1 - dt; p.vy *= 1 - dt; p.x += p.vx * dt; p.y += p.vy * dt;
      sc.point(p.x, p.y, 0, p.col[0], p.col[1], p.col[2], (1 - p.t / p.life) * k, 2.2 / 129.6); W.rockets[j++] = p; }
    W.rockets.length = j;
    sc.flushPoints(); L.fogNear = keep[0]; L.fogFar = keep[1];
    return W.t < 30;
  }
}
