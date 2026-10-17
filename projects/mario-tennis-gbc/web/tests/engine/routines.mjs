// The routines checked by web/tests/engine_routines.mjs: ROM address, WRAM bank to map, input registers,
// the engine port to run, and the output registers to compare.
import * as ball from "../../js/engine/ball.js";

const hl = r => ({ h: r >> 8, l: r & 0xFF });
export const ROUTINES = [
  { name: "AdvanceMatchRng", bank: 8, addr: 0x43F6, js: E => ball.advanceMatchRng(E), out: a => ({ a }) },
  { name: "StepBallPhysics", bank: 8, addr: 0x5767, wram: 4, js: E => ball.stepBallPhysics(E) },
  { name: "UpdateBallAnglesAndSpeed", bank: 8, addr: 0x45E5, wram: 4, js: E => ball.updateBallAnglesAndSpeed(E) },
  { name: "ApplyBallAirDrag", bank: 8, addr: 0x55B4, wram: 4, js: E => ball.applyBallAirDrag(E) },
  { name: "ApplyBallSpin", bank: 8, addr: 0x5613, wram: 4, js: E => ball.applyBallSpin(E) },
  { name: "HandleBallNetCrossing", bank: 8, addr: 0x5814, wram: 4, js: E => ball.handleBallNetCrossing(E) },
  { name: "BounceBallOffCourtFences", bank: 8, addr: 0x5949, wram: 4, js: E => ball.bounceBallOffCourtFences(E) },
  { name: "ApplyCourtBounceDamping", bank: 8, addr: 0x46B0, wram: 4, js: E => ball.applyCourtBounceDamping(E) },
  { name: "CheckBallOutOfBounds", bank: 8, addr: 0x463A, wram: 4, js: E => ball.checkBallOutOfBounds(E), out: a => ({ a }) },
  { name: "StartBounceEffect", bank: 8, addr: 0x5383, wram: 4, js: E => ball.startBounceEffect(E) },
  { name: "StartLandingMarker", bank: 8, addr: 0x52DA, wram: 4, js: E => ball.startLandingMarker(E) },
  { name: "TickRallyTimers", bank: 8, addr: 0x4242, wram: 4, js: E => ball.tickRallyTimers(E) },
  { name: "HandleBallHitEvent", bank: 8, addr: 0x427A, wram: 4, js: E => ball.handleBallHitEvent(E) },
  { name: "HandleBallBounceEvent", bank: 8, addr: 0x4352, wram: 4, js: E => ball.handleBallBounceEvent(E) },
  { name: "HandleBallHitEvent/forced", bank: 8, addr: 0x427A, wram: 4, prep: (m, s) => { m.wram[0][0x4B7] = 1; if (s.f % 3 === 0) m.wram[0][0x4B6] = s.f % 2; }, js: E => ball.handleBallHitEvent(E) },
  { name: "HandleBallBounceEvent/forced", bank: 8, addr: 0x4352, wram: 4, prep: (m, s) => { m.wram[0][0x4B3] = 1 + (s.f & 1); m.wram[0][0x4B2] = s.f % 3; }, js: E => ball.handleBallBounceEvent(E) },
  { name: "HandleBallTouchCharEvent/forced", bank: 8, addr: 0x43D3, wram: 4, prep: (m, s) => { m.wram[0][0x4AE] = 1; if (s.f & 1) m.wram[0][0x4D8] = 0; }, js: E => ball.handleBallTouchCharEvent(E) },
  { name: "TickRallyTimers/forced", bank: 8, addr: 0x4242, wram: 4, prep: (m, s) => { m.wram[0][0x4B4] = 1; m.wram[0][0x4B6] = s.f % 3; m.wram[0][0x4BF] = s.f & 1; m.wram[0][0x4D8] = s.f & 4 ? 0 : m.wram[0][0x4D8]; }, js: E => ball.tickRallyTimers(E) },
  { name: "EvaluateBounceOutcome/forced", bank: 8, addr: 0x4379, wram: 4, prep: (m, s) => { m.wram[0][0x4D8] = 0; m.wram[0][0x4B6] = 1 + (s.f % 3 === 0); m.wram[0][0x4B2] = 1 + (s.f % 7 === 0); m.wram[0][0x4BE] = s.f & 3; m.wram[0][0x4BF] = (s.f >> 2) & 1; }, js: E => ball.evaluateBounceOutcome(E) },
  { name: "StartLandingMarker/forced", bank: 8, addr: 0x52DA, wram: 4, prep: (m, s) => { m.wram[0][0x4A0] = 0x0A; }, js: E => ball.startLandingMarker(E) },
  { name: "StartHitEffect", bank: 8, addr: 0x53D0, wram: 4, prep: (m, s) => { m.wram[0][0x4A5] = s.f % 5 === 0 ? 1 : 0; m.wram[0][0x4A2] = s.f % 7 === 0 ? 0x3F : 0; }, js: E => ball.startHitEffect(E) },
  { name: "EvaluateBounceOutcome", bank: 8, addr: 0x4379, wram: 4, js: E => ball.evaluateBounceOutcome(E) },
  { name: "SetBallVelocityPolar", bank: 8, addr: 0x45A9, wram: 4, regs: s => ({ ...hl(0x0300 + (s.f * 37 & 0x7FF)), d: s.f * 13 & 0xFF, e: s.f * 7 & 0xFF, b: s.f * 5 & 0xFF, c: s.f * 3 & 0xFF }),
    js: (E, r) => ball.setBallVelocityPolar(E, r.h << 8 | r.l, r.b << 8 | r.c, r.d << 8 | r.e) },
];
