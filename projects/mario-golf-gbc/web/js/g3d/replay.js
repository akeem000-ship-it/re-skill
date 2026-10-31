// REPLAY (3D hole view, render only; adapted from Mario Tennis's replay.js): the big shots again, from a camera that follows the ball.
// A copy of the game's memory is taken in the frame the shot is launched (ShotLaunch 10:5F94 has set the ball's velocity, the ball has
// not moved yet: the main thread waits in AdvanceFrame) and kept. When the shot turns out big (holed from off the green: a chip-in,
// a long putt holed, a hole in one, an eagle), the native engine's own shot code (js/golf/shot.js Shot: the frame, BallTask, the
// flight camera's loop, ShotMainLoop and the cup) is run again on that copy, frame by frame, with its own Hole maps, to the shot's
// outcome; the ball's path it gives is the replay's (it is checked against the path the live game took). The live game is never
// touched: the copy is a separate GolfMemory with no sound, no page and no link cable, and nothing it does reaches the game.
// The replay is shown after the moment (moments.js) with "REPLAY" in the corner, slower near the end; a button on the game's joypad
// ends it. Reads the game's memory; writes only its own copy.
import { GolfMemory } from "../golf/memory.js";
import { Shot } from "../golf/shot.js";
import { Hole } from "../golf/ball.js";
import { drawLabel } from "./labels.js";
import { T } from "./hole3d.js";

export function cloneMemory(w) {
  const c = new GolfMemory();
  for (let i = 0; i < 8; i++) c.wram[i].set(w.wram[i]);
  c.high.set(w.high); c.sram.set(w.sram); c.sramEnable = w.sramEnable; c.sramBank = w.sramBank;
  if (w.vram) { c.vram = [w.vram[0].slice(), w.vram[1].slice()]; c.oam = w.oam.slice(); c.bgPal = w.bgPal.slice(); c.objPal = w.objPal.slice(); c.lcd = { ...w.lcd }; }
  return c;
}
// run the shot from the launch copy: the ball's path (world px: x, height, z, in the air) per frame, and the outcome
export function* rerunShot(copy) {
  const w = cloneMemory(copy), r6 = w.wram[6], view = r6[0x443];
  const sh = new Shot(w, new Hole(r6[0x320]));
  const g = (function* () {
    const a = sh.advance(1); a.next(); a.next();                 // the frame the game was waiting in, then the rest of the shot
    if (view === 4) { sh.ev("P"); return yield* sh.flightCam(0x5A); }
    return yield* sh.mainLoop();
  })();
  const u16 = a => r6[a] | r6[a + 1] << 8, path = [];
  for (let n = 0; n < 1500; n++) {
    const r = g.next();
    path.push([(u16(0x401) + r6[0x400] / 256) / 32, ((u16(0x407) << 16 >> 16) + r6[0x406] / 256) / 32, (u16(0x404) + r6[0x403] / 256) / 32, r6[0x415]]);
    if (r.done) return { path, outcome: r.value };
    if (n % 120 === 119) yield;                                  // (a slice per display frame)
  }
  return { path, outcome: null };
}

export class Replay {
  key = "replay";
  holeBuilt() { this.copy = null; this.job = null; this.play = null; }
  frame(sc, game, s) {
    const w = game.w;
    if (this.play && this.play.t > 0.5 && (w.high[0x190] & 0x0F) && !this.play.held0) this.play.stop = true;   // a button: enough
    if (this.play) this.play.held0 = !!(w.high[0x190] & 0x0F);
    if (!s) return;
    // the launch frame: ShotLaunch has set the camera mode $D438 to $11 and cleared the rest counter $D4D3; the ball has not moved
    const r6 = w.wram[6];
    if (r6[0x438] === 0x11 && this.prev438 !== 0x11 && r6[0x4D3] === 0 && this.lastPos && this.lastPos[0] === s.ball[0] && this.lastPos[2] === s.ball[2]) {
      this.copy = { w: cloneMemory(w), from: s.ball.slice(), terr: sc.hole.art.terrainAtPx(s.ball[0], s.ball[2]), cup: s.cup.slice(), club: s.club };
    }
    this.prev438 = r6[0x438]; this.lastPos = s.ball.slice();
    for (const [k, d] of sc.events || []) {
      if (k !== "stop" || d.outcome !== 0x80 || !this.copy) continue;
      const c = this.copy, dist = Math.hypot(c.from[0] - d.cup[0], c.from[2] - d.cup[1]);
      const strokes = s.stroke, par = w.wram[6][0x325];
      const why = strokes === 1 ? "HOLE IN ONE" : strokes <= par - 2 ? "EAGLE" : c.terr !== T.GREEN ? "CHIP-IN" : dist > 14 ? "LONG PUTT" : null;
      if (!why) continue;
      this.job = { gen: rerunShot(c.w), why, live: d.flight ? d.flight.path : null, cup: d.cup.slice(), at: sc.time };
    }
  }
  holdsScene(sc) { return !!this.play; }
  update(sc, game, s, dt) {
    if (this.job) {                                  // the engine's run, a slice per display frame
      let r; try { r = this.job.gen.next(); } catch (e) { console.warn("replay: the engine's run stopped", e); r = { done: true, value: null }; }
      if (r.done) {
        const res = r.value, live = this.job.live;
        let path = res && res.path, same = false;
        if (path && live) { same = true; const n = Math.min(path.length, live.length); for (let i = 0; i < n; i++) if (Math.abs(path[i][0] - live[i][0]) > 1e-6 || Math.abs(path[i][2] - live[i][2]) > 1e-6) { same = false; break; } }
        if (!path || path.length < 5) path = live;
        this.check = { same, frames: path ? path.length : 0, outcome: res && res.outcome };
        if (path) this.queue = { path, why: this.job.why, cup: this.job.cup, wait: sc.time + 1.2 };
        this.job = null;
      }
    }
    const busy = sc.layers.fx.some(f => f !== this && f.holdsScene && f.holdsScene(sc, game));
    if (this.queue && !this.play && !busy && sc.time >= this.queue.wait) { this.play = { ...this.queue, t: 0, i: 0 }; this.queue = null; }
    const P = this.play; if (!P) { if (sc.camOverride === this.cam) sc.camOverride = null; sc.replaying = false; return; }
    const n = P.path.length, slow = P.i > n - 45 ? 0.45 : 1;
    P.t += dt; P.i = Math.min(n - 1, P.i + dt * 60 * slow);
    if (P.stop || P.i >= n - 1 && (P.end = (P.end || 0) + dt) > 1.5) { this.play = null; sc.camOverride = null; sc.replaying = false; sc.ballOverride = null; return; }
    const i = Math.floor(P.i), k = P.i - i, a = P.path[i], b = P.path[Math.min(n - 1, i + 1)];
    const x = a[0] + (b[0] - a[0]) * k, h = a[1] + (b[1] - a[1]) * k, z = a[2] + (b[2] - a[2]) * k;
    sc.ballOverride = [x, h, z]; sc.replaying = true;
    const j = Math.max(0, i - 8), c = P.path[j]; let dx = x - c[0], dz = z - c[2]; const l = Math.hypot(dx, dz);
    if (l > 0.05) { dx /= l; dz /= l; P.dir = [dx, dz]; } else [dx, dz] = P.dir || [0, 1];
    const H = sc.hole.H, gy = H(x, z), up = Math.max(0, h);
    this.cam = this.cam || (() => { const q = this.play; return q && q.goal; });
    P.goal = { eye: [x - dx * (10 + up * 0.3), gy + up + 3 + up * 0.25, z - dz * (10 + up * 0.3)], at: [x + dx * 4, gy + up * 0.8, z + dz * 4], fov: 48, rate: P.t < 0.1 ? 100 : 6, snap: P.t < 0.05 };
    sc.camOverride = this.cam;
    this.trail = P.path.slice(Math.max(0, i - 120), i + 1);
  }
  draw(sc) {
    if (!this.play || !this.trail) return;
    const H = sc.hole.H, n = this.trail.length;
    for (let i = 0; i < n; i++) { const p = this.trail[i], k = i / n; sc.point(p[0], H(p[0], p[2]) + Math.max(0, p[1]) + 0.25, p[2], 1, 0.95, 0.6, 0.7 * k, 0.28); }
  }
  drawOverlay(sc) {
    if (!this.play) return;
    const blink = (sc.time * 2) % 2 < 1.4 ? 1 : 0.35;
    drawLabel(sc, "REPLAY", 0.16, 0.08, 0.07, { size: 36, fg: "#fff", bg: "rgba(200,30,30,0.85)", stroke: null }, blink);
    drawLabel(sc, this.play.why, 0.5, 0.9, 0.07, { size: 36, fg: "#ffe24a", bg: "rgba(0,0,0,0.5)", stroke: null }, 1);
  }
}
