// PHYSICS: Classic / Enhanced (web/js/engine/enhanced.js) / 120 Hz (web/js/engine/physics120.js). A scripted bot plays an exhibition match from power-on on the port
// (menus, then a simple P1 bot), so the match is a function of the code only:
//  - Classic (E.physics unset) must stay the game's exact ball: the frame hash after N frames equals the golden one recorded with the
//    code before Enhanced existed (a change of this hash means Classic changed: update it only on purpose),
//  - Enhanced must be deterministic (two runs give the same hash), must replay from its recording (frame hashes every 60 frames),
//    re-solve launches (solves > 0, no failures) and land them where the game's own physics would (checked in the solver itself: the
//    error of every solve is below 25 units) and play on (balls bounce, points are scored),
//  - 120 Hz the same, and its half-step positions (mid) lie on the ball's path between two game frames.
// usage: node web/tests/physics.mjs [--frames N]
import fs from "fs";
import { GamePort } from "../js/port/port.js";
import { entry } from "../js/port/entry.js";
import { HOOKS as MATCH } from "../js/port/match/index.js";
import { Recorder, stateOf } from "../js/recorder.js";
import { EnhancedPhysics } from "../js/engine/enhanced.js";
import { Physics120 } from "../js/engine/physics120.js";
const MODEL = { enhanced: EnhancedPhysics, 120: Physics120 };
const a = process.argv.slice(2), N = a.includes("--frames") ? +a[a.indexOf("--frames") + 1] : 7000;
const GOLDEN_CLASSIC_7000 = "13ffc4b0";                                   // the port's Classic ball, bot match, 7000 frames (HEAD before Enhanced)
const rom = new Uint8Array(fs.readFileSync("rom/mario_tennis.gbc"));
function play(mode) {
  const port = new GamePort(rom, { ...entry, hooks: MATCH }, { audio: false }), gb = port.gb;
  let mids = 0, midOff = 0;
  if (MODEL[mode]) { port.physics = new MODEL[mode](); const o = port.physics.launch.bind(port.physics); port.physics.errs = []; port.physics.launch = E => { o(E); const l = port.physics.last; if (l && l.solved) port.physics.errs.push(l.err); }; }
  const rec = new Recorder(); rec.start(gb, { engine: "port", port: "match/index", physics: MODEL[mode] ? mode : undefined, from: 0 });
  const keys = { 332: 8, 632: 8, 1300: 32, 1360: 1 }; for (let k = 700; k < 1300; k += 60) keys[k] = 1; for (let k = 1420; k < 1600; k += 60) keys[k] = 1;
  const B = { pressAt: -99, lastSwing: -99, serveAt: -99, lastBz: 0 }, w = () => gb.mem.wram[0], w4 = () => gb.mem.wram[4];
  const s16 = (b, o) => (b[o] | (b[o + 1] << 8)) << 16 >> 16, r32 = o => ((w()[o] | (w()[o + 1] << 8) | (w()[o + 2] << 16) | (w()[o + 3] << 24)) / 65536);
  let bounces = 0, hits = 0, lastHc = 0;
  for (let f = 0; f < N; f++) {
    let mask = 0; for (const [kf, b] of Object.entries(keys)) if (f >= +kf && f < +kf + 6) mask |= b;
    if (f > 1600) {
      const ww = w(), px = s16(w4(), 0xF01), py = s16(w4(), 0xF04), bx = r32(0x400), by = r32(0x404), bz = r32(0x408);
      const speed = (ww[0x42C] | (ww[0x42D] << 8)) / 256, vy = (ww[0x424] << 24 >> 24), inCourt = ww[0x32E] <= 15, near = py > 0, toward = speed > 0 && (near ? vy > 0 : vy < 0);
      if (inCourt && speed > 0 && toward) {
        const lx = s16(ww, 0x450), ly = s16(ww, 0x452), tx = Math.abs(ly) < 2600 ? lx : bx, ty = Math.abs(ly) < 2600 ? ly : by;
        if (tx > px + 24) mask |= 16; else if (tx < px - 24) mask |= 32;
        const goalY = Math.max(700, Math.min(1300, Math.abs(ty) + 80)) * (near ? 1 : -1);
        if (goalY > py + 40) mask |= 128; else if (goalY < py - 40) mask |= 64;
        if (Math.abs(by - py) < 120 + speed * 10 && Math.abs(bx - px) < 140 && f - B.lastSwing > 40) { B.lastSwing = f; B.pressAt = f; }
      }
      if (inCourt && speed > 0 && !toward && Math.abs(bx - px) < 16 && Math.abs(by - py) < 16 && bz > B.lastBz && bz >= -300 && f - B.lastSwing > 40) { B.lastSwing = f; B.pressAt = f; }
      B.lastBz = bz;
      if (inCourt && speed === 0) { if (f - B.serveAt > 50) { B.serveAt = f; B.pressAt = f; } } else if (!inCourt && f - B.serveAt > 90) { B.serveAt = f; B.pressAt = f; }
      if (f - B.pressAt < 3) mask |= 1;
    }
    const b0 = [r32(0x400), r32(0x404), r32(0x408)];
    gb.setInput(stateOf(mask)); port.frame(); rec.frame(gb, mask);
    const md = port.physics && port.physics.mid;
    if (md && md.seq !== B.midSeq) { B.midSeq = md.seq; const b1 = [r32(0x400), r32(0x404), r32(0x408)], d = Math.hypot(b1[0] - b0[0], b1[1] - b0[1], b1[2] - b0[2]);
      const turned = w()[0x4B3] !== 0 || w()[0x4B6] !== lastHc;     // a bounce or a hit in the frame: the path turns there
      if (d > 1 && d < 200 && !turned) { mids++; const e = Math.hypot(md.X - (b0[0] + b1[0]) / 2, md.Y - (b0[1] + b1[1]) / 2, md.Z - (b0[2] + b1[2]) / 2); if (e > d * 0.6) midOff++; } }
    const ww = w(); if (ww[0x4B3] === 1) bounces++; if (ww[0x4B6] !== lastHc && ww[0x4B6] > 0) hits++; lastHc = ww[0x4B6];
  }
  const snap = rec.snapshot(gb, ""); snap.meta = rec.meta;
  return { hash: gb.frameHash(), port, snap, bounces, hits, mids, midOff, score: `${w()[0x8E4]}-${w()[0x8E5]}` };
}
function replay(snap) {
  const port = new GamePort(rom, { ...entry, hooks: MATCH }, { audio: false }), gb = port.gb;
  if (MODEL[snap.meta.physics]) port.physics = new MODEL[snap.meta.physics]();
  const inputs = Uint8Array.from(Buffer.from(snap.inputs, "base64")), hashes = new Map(snap.hashes); let bad = null;
  for (let f = 0; f < snap.frames; f++) { gb.setInput(stateOf(inputs[f])); port.frame(); const h = hashes.get(f + 1); if (h && h !== gb.frameHash() && !bad) bad = f + 1; }
  return { bad, end: gb.frameHash() };
}
let bad = 0; const check = (name, ok, info = "") => { console.log(ok ? "ok  " : "FAIL", name, info); if (!ok) bad++; };
const C = play("classic"), E1 = play("enhanced"), E2 = play("enhanced");
if (N === 7000) check("Classic is the game's exact ball (golden frame hash)", C.hash === GOLDEN_CLASSIC_7000, `${C.hash} vs ${GOLDEN_CLASSIC_7000}`);
check("Classic play: balls bounce and are hit", C.bounces > 10 && C.hits > 10, `${C.hits} hits, ${C.bounces} bounces`);
check("Enhanced is deterministic (two runs, same hash)", E1.hash === E2.hash, `${E1.hash} / ${E2.hash}`);
check("Enhanced differs from Classic (the ball really moves differently)", E1.hash !== C.hash);
const ph = E1.port.physics;
check("Enhanced re-solves launches onto the game's own landing points", ph.solves > 10 && ph.fallbacks <= Math.ceil(ph.solves * 0.1) && Math.max(...ph.errs) < 25, `${ph.solves} solves, ${ph.fallbacks} fallbacks, worst error ${Math.max(...ph.errs).toFixed(1)} units`);
check("Enhanced plays on (hits, bounces)", E1.hits > 10 && E1.bounces > 10, `${E1.hits} hits, ${E1.bounces} bounces, games ${E1.score}`);
const R = replay(E1.snap);
check("Enhanced recording replays exactly", !R.bad && R.end === E1.hash, `first mismatch ${R.bad}`);
const RC = replay(C.snap);
check("Classic recording replays exactly", !RC.bad && RC.end === C.hash, `first mismatch ${RC.bad}`);
const H1 = play("120"), H2 = play("120"), h = H1.port.physics;
check("120 Hz is deterministic (two runs, same hash)", H1.hash === H2.hash, `${H1.hash} / ${H2.hash}`);
check("120 Hz differs from Enhanced (the ball moves in half-steps)", H1.hash !== E1.hash);
check("120 Hz re-solves launches onto the game's own landing points", h.solves > 10 && h.fallbacks <= Math.ceil(h.solves * 0.1) && Math.max(...h.errs) < 25, `${h.solves} solves, ${h.fallbacks} fallbacks, worst error ${Math.max(...h.errs).toFixed(1)} units`);
check("120 Hz plays on (hits, bounces)", H1.hits > 10 && H1.bounces > 10, `${H1.hits} hits, ${H1.bounces} bounces, games ${H1.score}`);
check("120 Hz half-steps lie on the ball's path", H1.mids > 500 && H1.midOff === 0, `${H1.mids} frames in flight, ${H1.midOff} half-steps off the path`);
const RH = replay(H1.snap);
check("120 Hz recording replays exactly", !RH.bad && RH.end === H1.hash, `first mismatch ${RH.bad}`);
process.exit(bad ? 1 : 0);
