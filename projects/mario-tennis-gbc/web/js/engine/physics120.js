// "PHYSICS: 120 Hz": the match ball simulated at 120 ticks a second, the game's own logic around it at its 60. It is the Enhanced
// model (enhanced.js: gravity, drag, Magnus, the court's bounce and grip, each shot re-solved to land on the game's own target) with
// its position moved in two half-steps per game frame instead of one step:
//   * the fences, the net and the ground are tested at each half-step (a fast ball's crossing and its bounce placed twice as
//     finely; wBallPrev* is the half-step before, so the game's own landing point and line calls interpolate over half the path),
//   * the velocity is updated after each half-step with half a step of the forces,
//   * the position after the first half-step is kept (mid): the 3D view draws it on the display frame between two game frames,
//     so at 120 Hz every picture shows where the ball really is, on its curve (not a straight line between two game frames).
// The launch solver and the AI's prediction (enhanced.js ballPath / flyToLanding) run the same half-steps, so shots still land
// where the game aimed them and the computer reads the real flight. The players, the swing, the AI's decisions, scoring and
// everything else stay the game's, once per frame. Deterministic as Enhanced (+ - * / sqrt only, 8.16 integers written back).
import { EnhancedPhysics } from "./enhanced.js";
import { bounceBallOffCourtFences, handleBallNetCrossing, updateBallAnglesAndSpeed, applyCourtBounceDamping, getBallHeightSign } from "./ball.js";
import { plusSurface } from "./plus.js";

const S24 = v => Math.trunc(v * 65536);
const POS = [[0xC400, 0xC420], [0xC404, 0xC423], [0xC408, 0xC426]];

export class Physics120 extends EnhancedPhysics {
  constructor(k = {}) { super(k); this.hz = 120; this.mid = null; this.seq = 0; }

  step(E) {
    const S = E.S, m = E.mem, k = this.k;
    if (this.launchFrame(S)) this.launch(E);
    S.ballBounceEvent = 0;
    const from = { X: m.s32(0xC400) / 65536, Y: m.s32(0xC404) / 65536, Z: m.s32(0xC408) / 65536 };
    let damped = false;
    for (let h = 0; h < 2; h++) {
      for (let i = 0; i < 12; i++) m.w8(0xC410 + i, m.u8(0xC400 + i));    // wBallPrev* = the position half a step ago
      for (const [p, v] of POS) m.w32(p, (m.s32(p) + Math.trunc(m.s24(v) / 2)) | 0);
      bounceBallOffCourtFences(E);
      handleBallNetCrossing(E);
      const sign = getBallHeightSign(E);
      const vx = m.s24(0xC420) / 65536, vy = m.s24(0xC423) / 65536, vzd = m.s24(0xC426) / 65536;
      let tau = S.ballTopspin, sig = S.ballSideSpin;
      if (sign === 0xFF) {                                                 // airborne: half a step of the forces
        const nv = this.flyHalf(vx, vy, -vzd, tau, sig, k);
        m.w24(0xC420, S24(nv[0])); m.w24(0xC423, S24(nv[1])); m.w24(0xC426, S24(-nv[2]));
        S.ballTopspin = Math.trunc(tau - tau * k.DECAY / 2); S.ballSideSpin = Math.trunc(sig - sig * k.DECAY / 2);
      } else if (sign === 0) {                                             // resting: the game's rolling damping, once a frame
        if (!damped) { applyCourtBounceDamping(E); damped = true; }
        S.ballHeightFull = -S.ballHeightFull | 0;
      } else {                                                             // through the ground: reflected, the model's bounce
        S.ballHeightFull = -S.ballHeightFull | 0;
        S.ballBounceEvent = 1;
        const r = this.bounce(vx, vy, Math.max(vzd, 0), tau, sig, ...plusSurface(E, S.courtSurfaceFriction, S.courtSurfaceBounce), k);
        m.w24(0xC420, S24(r.vx)); m.w24(0xC423, S24(r.vy)); S.ballTopspin = Math.trunc(r.tau); S.ballSideSpin = Math.trunc(sig * k.SIDE_BOUNCE);
        if (r.up < k.REST) { S.ballHeightFull = 0; m.w24(0xC426, 0); } else m.w24(0xC426, S24(-r.up));
      }
      if (h === 0) this.mid = { X: m.s32(0xC400) / 65536, Y: m.s32(0xC404) / 65536, Z: m.s32(0xC408) / 65536, from, seq: ++this.seq };
    }
    S.ballCourtQuadrant = (S.ballDepth < 0 ? 2 : 0) | (S.ballX < 0 ? 1 : 0);
    updateBallAnglesAndSpeed(E);
  }
  // half a game frame of gravity, drag and Magnus (enhanced.js fly's sub-step) on (vx, vy, vz up)
  flyHalf(vx, vy, vz, tau, sig, k) {
    tau = Math.max(-k.TMAX, Math.min(k.TMAX, tau)); sig = Math.max(-k.TMAX, Math.min(k.TMAX, sig));
    const wm = Math.sqrt(tau * tau + sig * sig), vh = Math.sqrt(vx * vx + vy * vy), hx = vh > 1e-6 ? vx / vh : 0, hy = vh > 1e-6 ? vy / vh : 1;
    const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
    let mx = 0, my = 0, mz = 0;
    if (wm > 1 && sp > 1) {
      const Wx = -tau * hy, Wy = tau * hx, Wz = sig;
      const cx = Wy * vz - Wz * vy, cy = Wz * vx - Wx * vz, cz = Wx * vy - Wy * vx, cl = Math.sqrt(cx * cx + cy * cy + cz * cz);
      if (cl > 1e-9) { const s = wm * k.RW / sp, a = k.GAIN * k.KL * k.CLMAX * s / (s + k.S0) * sp * sp / cl; mx = cx * a; my = cy * a; mz = cz * a; }
    }
    return [vx + (-k.KD * sp * vx + mx) * 0.5, vy + (-k.KD * sp * vy + my) * 0.5, vz + (-k.G - k.KD * sp * vz + mz) * 0.5];
  }
  // the launch solver's flight (enhanced.js launch): the same half-steps as step()
  flyToLanding(x, y, z, v, tau, sig, fByte, eByte, netH) {
    const k = this.k; let vx = v[0], vy = v[1], vz = v[2], netOk = true, crossed = false;
    for (let f = 0; f < 400; f++) {
      const px = x, py = y, pz = z;
      x += vx / 2; y += vy / 2; z += vz / 2;
      if ((py < 0) !== (y < 0)) { crossed = true; if (z < netH + k.NET_CLEAR) netOk = false; }
      if (z <= 0) { const t = pz / (pz - z || 1); return { x: px + (x - px) * t, y: py + (y - py) * t, netOk, crossed, frames: f / 2 }; }
      const n = this.flyHalf(vx, vy, vz, tau, sig, k); vx = n[0]; vy = n[1]; vz = n[2]; tau -= tau * k.DECAY / 2; sig -= sig * k.DECAY / 2;
    }
    return null;
  }
  // the AI's view of the live ball (enhanced.js xAtDepth / beyondLanding): its path in half-steps, a point per half-step
  ballPath(E) {
    const m = E.mem, k = this.k, key = [m.u24(0xC400), m.u24(0xC404), m.u24(0xC408), m.u24(0xC420), m.u24(0xC423), m.u24(0xC426), m.u8(0xC41C), m.u8(0xC41D), m.u8(0xC41E), m.u8(0xC41F)].join();
    if (this.pathKey === key && this.path) return this.path;
    const S = E.S; let x = m.s32(0xC400) / 65536, y = m.s32(0xC404) / 65536, z = -m.s32(0xC408) / 65536;
    let vx = m.s24(0xC420) / 65536, vy = m.s24(0xC423) / 65536, vz = -m.s24(0xC426) / 65536, tau = S.ballTopspin, sig = S.ballSideSpin;
    const pts = [[x, y, z]]; let bounce = -1;
    for (let f = 0; f < 440; f++) {
      x += vx / 2; y += vy / 2; z += vz / 2;
      if (z < 0) {
        z = -z;
        const r = this.bounce(vx, vy, Math.max(-vz, 0), tau, sig, ...plusSurface(E, S.courtSurfaceFriction, S.courtSurfaceBounce), k);
        vx = r.vx; vy = r.vy; tau = r.tau; sig *= k.SIDE_BOUNCE; pts.push([x, y, 0]);
        if (bounce >= 0 || r.up < k.REST) { this.pathKey = key; return this.path = { pts, bounce: bounce >= 0 ? bounce : pts.length - 1 }; }
        vz = r.up; bounce = pts.length - 1; continue;
      }
      pts.push([x, y, z]);
      const n = this.flyHalf(vx, vy, vz, tau, sig, k); vx = n[0]; vy = n[1]; vz = n[2]; tau -= tau * k.DECAY / 2; sig -= sig * k.DECAY / 2;
    }
    this.pathKey = key; return this.path = { pts, bounce };
  }
}
