// "PHYSICS: Enhanced": a Tennis-Elbow-style ball for the match engine. The game's ball already has gravity, drag, a weak spin and a per-court
// bounce damping (ball.js stepBallPhysics); this replaces the flight and the bounce with a physical model while everything around the step
// (the order of the routine, the fences, the net, the event bytes, the AI, the shot solver, the scoring) stays the game's:
//   flight   gravity (the game's, about 9.8 m/s^2 at 105 units per metre), quadratic air drag, Magnus force from the spin (topspin dips,
//            backspin floats, sidespin curves), the spin decaying slowly instead of 1.2% per frame,
//   bounce   restitution from the court's own table (courtSurfaceBounce), a friction coefficient from the court's friction byte (clay
//            grips, grass skids), Coulomb friction at the contact point with the ball's spin (hollow ball): topspin kicks on, backspin
//            skids low and slows, and the spin after the bounce is updated,
//   launch   when a shot is launched the game's solver has set speed, elevation, aim, spin and the landing point wBallTarget; the model
//            keeps the speed, re-solves the elevation and a small heading offset with a forward simulation of its own step so that the
//            FIRST BOUNCE lands on the same point as the game's solution (in / out / net calls stay the solver's), and keeps the
//            game's launch if that fails or the net would be clipped. Spin is scaled by the shot family and the swing's timing.
// Deterministic: only + - * / sqrt and comparisons (IEEE-exact on every device), no Math.random / sin / cos / pow / exp / atan2, a fixed one-frame
// step in two sub-steps, results written back as truncated 8.16 integers. State is only the game's RAM plus one counter (the rally length
// the last launch was solved for). Classic is the code in ball.js; this runs only when E.physics is set.
import { bounceBallOffCourtFences, handleBallNetCrossing, updateBallAnglesAndSpeed, applyCourtBounceDamping, getBallHeightSign, stepBallPhysicsClassic } from "./ball.js";
import { MatchEngine } from "./engine.js";

// units: 1 unit = 1/105 m, 1 frame = 1/60 s. Spin scalars (the game's wBallTopspin / wBallSidespin, 3700 = a very heavy topspin ~ 4600 rpm)
export const PHYS = {
  G: 0x4A00 / 65536,          // gravity, units / frame^2 (the game's constant)
  KD: 1.8e-4,                 // quadratic drag: a = -KD |v| v
  KL: 3.4e-4,                 // lift: a = GAIN * KL * CL(S) * |v|^2 along unit(W x v), W = (topspin * (up x heading), 0) + (0, 0, sidespin)
  GAIN: 2.2,                  // more than a regulation ball: spin should read in play
  CLMAX: 0.35, S0: 0.2,       // lift coefficient CL = CLMAX * S / (S + S0), S = spin * RW / |v| (saturates like a real ball)
  TMAX: 3700,                 // spin scalars are clamped to this in the model (the game's heaviest rows go to 8000)
  DECAY: 1 / 512,             // spin lost per frame in the air (the game: 3/256)
  RW: 0.0075,                 // ball radius * angular velocity, units / frame, per topspin unit (radius 3.5 units)
  MU0: 0.2, MU1: 1.8,         // friction coefficient = MU0 + MU1 * (1 - courtSurfaceFriction / 256)
  REST: 2.3,                  // rest below this upward speed after a bounce (the game's $0250 / 256)
  SIDE_BOUNCE: 0.8,           // sidespin kept through a bounce
  NET_CLEAR: 5,               // minimum height above the tape at the net for a re-solved launch
  // spin scale by shot family (wShotType): flat / smash little, slices and lobs more, drop shots heavy
  TYPE: [1.15, 1.1, 1.1, 1.0, 0.4, 0.7, 1.0, 1.0, 0.5, 0.3, 1.2, 1.4, 1.1, 1.1, 0.4],
  CHARGE: [0.85, 0.35],       // timing: spin * (0.85 + 0.35 * charge / 63)
};

const S24 = v => Math.trunc(v * 65536);

// the point where the ball met the ground this frame (the game's step has just reflected the penetration): the previous position and the
// current one, interpolated to height 0
export function landingOf(E) {
  const S = E.S, zp = -S.ballPrevHeightFull / 65536, pen = -S.ballHeightFull / 65536;     // after the reflection the height is +penetration
  const t = zp / (zp + pen || 1), x0 = S.ballPrevXFull / 65536, y0 = S.ballPrevDepthFull / 65536, x1 = S.ballXFull / 65536, y1 = S.ballDepthFull / 65536;
  return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, frames: 0 };
}

export class EnhancedPhysics {
  constructor(k = {}) { this.k = { ...PHYS, ...k }; this.rally = 0; this.solves = 0; this.fallbacks = 0; this.last = null; }

  // one frame, in the order of the game's StepBallPhysics
  step(E) {
    const S = E.S, m = E.mem, M = E.M, k = this.k;
    const launch = this.launchFrame(S);
    if (launch) this.launch(E);
    S.ballBounceEvent = 0;
    for (let i = 0; i < 12; i++) m.w8(0xC410 + i, m.u8(0xC400 + i));        // wBallPrev* = the position block
    M.addVel24ToPos32(0xC400, 0xC420); M.addVel24ToPos32(0xC404, 0xC423); M.addVel24ToPos32(0xC408, 0xC426);
    bounceBallOffCourtFences(E);
    handleBallNetCrossing(E);
    S.ballCourtQuadrant = (S.ballDepth < 0 ? 2 : 0) | (S.ballX < 0 ? 1 : 0);
    updateBallAnglesAndSpeed(E);
    const sign = getBallHeightSign(E);
    const vx = m.s24(0xC420) / 65536, vy = m.s24(0xC423) / 65536, vzd = m.s24(0xC426) / 65536;
    let tau = S.ballTopspin, sig = S.ballSideSpin;
    if (sign === 0xFF) {                                                   // airborne
      const v = this.fly(vx, vy, -vzd, tau, sig, k);
      m.w24(0xC420, S24(v[0])); m.w24(0xC423, S24(v[1])); m.w24(0xC426, S24(-v[2]));
      S.ballTopspin = Math.trunc(tau - tau * k.DECAY); S.ballSideSpin = Math.trunc(sig - sig * k.DECAY);
      return;
    }
    // at or through the ground
    if (sign === 0) { applyCourtBounceDamping(E); S.ballHeightFull = -S.ballHeightFull | 0; return; }     // resting on it: the game's rolling damping
    S.ballHeightFull = -S.ballHeightFull | 0;                                // reflect the penetration
    S.ballBounceEvent = 1;
    const r = this.bounce(vx, vy, Math.max(vzd, 0), tau, sig, S.courtSurfaceFriction, S.courtSurfaceBounce, k);
    m.w24(0xC420, S24(r.vx)); m.w24(0xC423, S24(r.vy)); S.ballTopspin = Math.trunc(r.tau); S.ballSideSpin = Math.trunc(sig * k.SIDE_BOUNCE);
    if (r.up < k.REST) { S.ballHeightFull = 0; m.w24(0xC426, 0); } else m.w24(0xC426, S24(-r.up));
  }

  // two half-steps of gravity, drag and Magnus on (vx, vy, vz up); returns the new velocity
  fly(vx, vy, vz, tau, sig, k) {
    tau = Math.max(-k.TMAX, Math.min(k.TMAX, tau)); sig = Math.max(-k.TMAX, Math.min(k.TMAX, sig));
    const wm = Math.sqrt(tau * tau + sig * sig);
    for (let i = 0; i < 2; i++) {
      const vh = Math.sqrt(vx * vx + vy * vy), hx = vh > 1e-6 ? vx / vh : 0, hy = vh > 1e-6 ? vy / vh : 1;
      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
      let mx = 0, my = 0, mz = 0;
      if (wm > 1 && sp > 1) {
        const Wx = -tau * hy, Wy = tau * hx, Wz = sig;                        // W = tau * (up x heading) + sig * up
        const cx = Wy * vz - Wz * vy, cy = Wz * vx - Wx * vz, cz = Wx * vy - Wy * vx, cl = Math.sqrt(cx * cx + cy * cy + cz * cz);
        if (cl > 1e-9) { const S = wm * k.RW / sp, a = k.GAIN * k.KL * k.CLMAX * S / (S + k.S0) * sp * sp / cl; mx = cx * a; my = cy * a; mz = cz * a; }
      }
      vx += (-k.KD * sp * vx + mx) * 0.5; vy += (-k.KD * sp * vy + my) * 0.5; vz += (-k.G - k.KD * sp * vz + mz) * 0.5;
    }
    return [vx, vy, vz];
  }

  // the contact: normal restitution, Coulomb friction against the slip of the contact point (spin included), returns the new horizontal
  // velocity, the upward speed and the spin
  bounce(vx, vy, w, tau, sig, fByte, eByte, k) {
    tau = Math.max(-k.TMAX, Math.min(k.TMAX, tau));
    const e = eByte / 256, mu = k.MU0 + k.MU1 * (1 - fByte / 256), vh = Math.sqrt(vx * vx + vy * vy);
    const rw = tau * k.RW, s = vh - rw, N = (1 + e) * w, jmax = mu * N;
    const J = Math.abs(s) <= 2.5 * jmax ? s / 2.5 : (s > 0 ? jmax : -jmax);       // sticks (rolls) when the slip dies inside the friction cone
    const vh2 = vh - J, f = vh > 1e-9 ? vh2 / vh : 0;
    return { vx: vx * f, vy: vy * f, up: e * w, tau: (rw + 1.5 * J) / k.RW };
  }

  // ---- the launch ----
  launchFrame(S) {
    const rl = S.rallyLength, was = this.rally; this.rally = rl;
    return rl > 0 && rl !== was && (S.hitSparkTimer === 0x10 || S.specialHitTimer >= 0x0F);
  }
  launch(E) {
    const S = E.S, m = E.mem, k = this.k;
    // spin by the family and the timing of the swing
    const tm = (k.TYPE[S.currentShotType] ?? 1) * (k.CHARGE[0] + k.CHARGE[1] * Math.min(S.shotChargeLevel, 63) / 63);
    S.ballTopspin = Math.trunc(S.ballTopspin * tm); S.ballSideSpin = Math.trunc(S.ballSideSpin * tm);
    const tau = S.ballTopspin, sig = S.ballSideSpin;
    const x = m.s32(0xC400) / 65536, y = m.s32(0xC404) / 65536, z = -m.s32(0xC408) / 65536;
    const v0 = [m.s24(0xC420) / 65536, m.s24(0xC423) / 65536, -m.s24(0xC426) / 65536];
    const spd = Math.sqrt(v0[0] * v0[0] + v0[1] * v0[1] + v0[2] * v0[2]), vh0 = Math.sqrt(v0[0] * v0[0] + v0[1] * v0[1]);
    this.last = { solved: false, spd };
    if (spd < 4 || vh0 < 1) return;                                          // a toss or a dribble: nothing to aim
    const C = this.classicLanding(E); this.last.classic = C;
    if (!C) return;                                                          // the game's ball meets the net or a fence first: nothing to match
    const T = [C.x, C.y], fB = S.courtSurfaceFriction, eB = S.courtSurfaceBounce, netH = S.netHeight;
    const h0 = [v0[0] / vh0, v0[1] / vh0];
    const land = v => this.flyToLanding(x, y, z, v, tau, sig, fB, eB, netH);
    let best = null;
    for (const scale of [1, 0.96, 0.92, 0.88, 0.84]) {                       // a slower ball with a higher arc clears the net when the first try does not
      const sp2 = spd * scale, vel = (lift, d) => {                       // velocity from (lift, heading offset): the vertical speed moved by lift at the speed sp2, the heading turned by d (small angle)
        const vz = v0[2] * scale + lift, vh = Math.sqrt(Math.max(sp2 * sp2 - vz * vz, 1)), c = 1 - d * d / 2 + d * d * d * d / 24, sn = d - d * d * d / 6;
        return [(h0[0] * c - h0[1] * sn) * vh, (h0[0] * sn + h0[1] * c) * vh, vz];
      };
      let lift = 0, d = 0, cur = null;
      for (let it = 0; it < 7; it++) {
        const L = land(vel(lift, d)); if (!L) { if (this.trace) this.trace.push([scale, it, "no landing"]); break; }
        const rx = L.x - T[0], ry = L.y - T[1], err = Math.hypot(rx, ry); if (this.trace) this.trace.push([scale, it, +lift.toFixed(2), +d.toFixed(3), +err.toFixed(1), L.netOk, +L.x.toFixed(0), +L.y.toFixed(0)]);
        if (!cur || err < cur.err) cur = { lift, d, err, L, vel };
        if (err < 3) break;
        const eps1 = 0.15, eps2 = 0.01, L1 = land(vel(lift + eps1, d)), L2 = land(vel(lift, d + eps2)); if (!L1 || !L2) break;
        const a = (L1.x - L.x) / eps1, b = (L2.x - L.x) / eps2, c = (L1.y - L.y) / eps1, e = (L2.y - L.y) / eps2, det = a * e - b * c;
        if (Math.abs(det) < 1e-9) break;
        lift -= (e * rx - b * ry) / det; d -= (-c * rx + a * ry) / det;
        lift = Math.max(-9, Math.min(9, lift)); d = Math.max(-0.3, Math.min(0.3, d));
      }
      if (cur && cur.err <= 25 && cur.L.netOk) { best = cur; break; }
    }
    if (!best) { this.fallbacks++; return; }                                 // keep the game's launch (the flight is still Enhanced)
    const v = best.vel(best.lift, best.d);
    m.w24(0xC420, S24(v[0])); m.w24(0xC423, S24(v[1])); m.w24(0xC426, S24(-v[2]));
    this.solves++; this.last = { solved: true, spd, lift: best.lift, d: best.d, err: best.err, classic: C, target: T };
  }
  // where the GAME's own physics would land this launch: its step run on a scratch copy of the match RAM (the real state is not touched, no
  // sound or effect is started). null when the classic ball meets the net or a fence first, or does not land.
  classicLanding(E) {
    const sc = this.scratch || (this.scratch = new MatchEngine(E.rom)), sm = sc.mem, m = E.mem;
    for (let a = 0xC000; a < 0xD000; a++) sm.w0[a - 0xC000] = m.u8(a);
    for (let a = 0xFF80; a < 0xFFFF; a++) sm.hram[a - 0xFF80] = m.u8(a);
    sc.physics = null; sc.events.length = 0; const S = sc.S; S.ballHasBouncedFlag = 0;
    for (let f = 0; f < 200; f++) {
      stepBallPhysicsClassic(sc); sc.events.length = 0;
      if (S.ballHasBouncedFlag || S.ballBounceEvent === 2) return null;
      if (S.ballBounceEvent === 1) { const L = landingOf(sc); L.frames = f; return L; }
    }
    return null;
  }
  // the model's flight from a launch to its first ground contact (no fences or net): the landing point and whether it cleared the net
  flyToLanding(x, y, z, v, tau, sig, fByte, eByte, netH) {
    const k = this.k; let vx = v[0], vy = v[1], vz = v[2], netOk = true, crossed = false;
    for (let f = 0; f < 200; f++) {
      const px = x, py = y, pz = z;
      x += vx; y += vy; z += vz;
      if ((py < 0) !== (y < 0)) { crossed = true; if (z < netH + k.NET_CLEAR) netOk = false; }     // the game tests the height of the frame that crosses the net
      if (z <= 0) { const t = pz / (pz - z || 1); return { x: px + (x - px) * t, y: py + (y - py) * t, netOk, crossed, frames: f }; }
      const n = this.fly(vx, vy, vz, tau, sig, k); vx = n[0]; vy = n[1]; vz = n[2]; tau -= tau * k.DECAY; sig -= sig * k.DECAY;
    }
    return null;
  }
}
