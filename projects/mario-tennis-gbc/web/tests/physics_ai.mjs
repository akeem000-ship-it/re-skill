// The CPU with PHYSICS: Enhanced (web/js/engine/enhanced.js) and 120 Hz (physics120.js: the same model in half-steps, the AI reading the
// half-step path), on the standalone engine, CPU against CPU (no input; fixed seeds, so the models play the same matches):
//  - hit rate: of the balls in play, the share the CPU returned (returns / (returns + points lost to a second bounce)), Classic vs Enhanced
//    (Enhanced and 120 Hz must stay within 3 points of Classic),
//  - prediction: where the AI's "behind the landing point" target is against where an undisturbed ball really goes, the game's straight line
//    along the aim vs the model's own forward simulation (the AI is fed the latter in Enhanced); the model must be close (median < 10 units)
//    and better than the line,
//  - positioning: every "X where the ball reaches this depth" the AI asks the model during play (xAtDepth: where the CPU walks to) against
//    where the real ball crosses that depth (its samples per frame, or per half-step at 120 Hz), and the game's straight line asked the same.
// usage: node web/tests/physics_ai.mjs [--frames N]
import { EngineMatch } from "../js/engine/session.js";
import { romObject } from "./engine/corpus.mjs";
import * as setup from "../js/engine/setup.js";
import * as ball from "../js/engine/ball.js";
import { predictBallXAtDepth } from "../js/engine/ai.js";
import { EnhancedPhysics } from "../js/engine/enhanced.js";
import { Physics120 } from "../js/engine/physics120.js";
const a = process.argv.slice(2), FR = a.includes("--frames") ? +a[a.indexOf("--frames") + 1] : 30000;
const rom = romObject(), MATCHUPS = [[0, 23, 25], [1, 1, 2], [2, 5, 9]], SEEDS = [11, 97];   // (each model plays the same matches: paired, repeatable)
const sx = v => (v << 16) >> 16;
function run(model, level = -1) {
  const enhanced = !!model;
  let points = 0, hits = 0, winners = 0; const rows = [], xq = [];
  for (const seed of SEEDS) for (const [court, p1, p2] of MATCHUPS) {
    const m = new EngineMatch(rom, { p1, p2, court, games: 6, sets: 3, difficulty: 2, seed }); setup.applyCpuDifficulty(m.E, 0, level < 0 ? 3 : level); if (level >= 0) setup.applyCpuDifficulty(m.E, 1, level);
    const E = m.E, S = E.S; const ph = enhanced ? (E.physics = model === 120 ? new Physics120() : new EnhancedPhysics()) : null; let prevRl = 0, prevOut = 0, pend = null;
    let track = [], asks = [], trackRl = -1;                             // the real ball's path this shot, and the AI's questions about it
    const settle = () => {                                               // a shot over: each question against where the ball really crossed
      for (const q of asks) for (let i = 1; i < track.length; i++) {
        const a = track[i - 1], b = track[i]; if ((a[1] - q.d) * (b[1] - q.d) > 0 || a[1] === b[1]) continue;
        const x = a[0] + (b[0] - a[0]) * (q.d - a[1]) / (b[1] - a[1]); xq.push([Math.abs(sx(q.x) - x), Math.abs(sx(q.line) - x)]); break;
      }
      track = []; asks = [];
    };
    if (ph) { const ask = ph.xAtDepth.bind(ph); ph.xAtDepth = (E2, depth) => { const x = ask(E2, depth); if (x !== null && S.ballSpeed3D / 256 > 8) asks.push({ d: sx(depth), x, line: predictBallXAtDepth(E2, depth) }); return x; }; }
    for (let f = 0; f < FR && !m.over; f++) {
      S.chars[0].inputSource = 1; S.chars[1].inputSource = 1; m.update(0);
      const rl = S.rallyLength; if (rl > prevRl) hits++;
      if (ph) {
        if (rl !== trackRl) { settle(); trackRl = rl; }
        if (model === 120 && ph.mid) track.push([ph.mid.X, ph.mid.Y]);
        track.push([S.ballXFull / 65536, S.ballDepthFull / 65536]);
      } const po = S.pointOutcome; if (po && !prevOut) { points++; if (po === 6) winners++; } prevOut = po;
      if (enhanced && pend) {
        // the real ball, sampled as the model moves it: per frame, or (120 Hz) per half-step (the first half's position is ph.mid); its
        // landing the sample of the step that bounced
        const end = [S.ballXFull / 65536, S.ballDepthFull / 65536], half = model === 120 && ph.mid ? [ph.mid.X, ph.mid.Y] : null;
        const samples = half ? [[half, ph.bounceHalf === 0], [end, ph.bounceHalf === 1]] : [[end, S.ballBounceEvent === 1]];
        for (const [p, bounced] of samples) {
          if (pend.done) break;
          if (bounced && !pend.land) pend.land = p;
          else if (pend.land) { pend.last = p; if (Math.hypot(p[0] - pend.land[0], p[1] - pend.land[1]) >= 192 || bounced || rl !== pend.rl) pend.done = true; }
        }
        if (pend.done || rl !== pend.rl || f - pend.f > 200) {
          if (pend.done && pend.last && Math.hypot(pend.last[0] - pend.land[0], pend.last[1] - pend.land[1]) >= 190) rows.push([Math.hypot(pend.c[0] - pend.last[0], pend.c[1] - pend.last[1]), Math.hypot(pend.a[0] - pend.last[0], pend.a[1] - pend.last[1])]);
          pend = null;
        }
      }
      if (enhanced && rl > prevRl && S.ballSpeed3D / 256 > 8) {
        ph.aiAware = false; const c = ball.offsetFromBallLanding(E, 0xC0); ph.aiAware = true; const q = ph.beyondLanding(E, 0xC0) || c;   // (the model's own path: the CPU mixes it with the line by its skill, ai.js aiReadWeight)
        pend = { f, rl, c: [sx(c.x), sx(c.depth)], a: [sx(q.x), sx(q.depth)] };
      }
      prevRl = rl;
    }
  }
  const returns = hits - points; return { hitRate: returns / (returns + winners), points, hits, rows, xq };
}
let bad = 0; const check = (name, ok, info = "") => { console.log(ok ? "ok  " : "FAIL", name, info); if (!ok) bad++; };
const C = run(null), med = v => v.slice().sort((x, y) => x - y)[Math.floor(v.length / 2)], mean = v => v.reduce((x, y) => x + y, 0) / v.length;
for (const [name, M] of [["Enhanced", "enhanced"], ["120 Hz", 120]]) {
  const E = run(M);
  check(`${name}: the CPU returns as many balls as in Classic (within 3 points)`, E.hitRate >= C.hitRate - 0.03, `Classic ${(C.hitRate * 100).toFixed(1)}% (${C.hits} hits, ${C.points} points), ${name} ${(E.hitRate * 100).toFixed(1)}% (${E.hits} hits, ${E.points} points)`);
  const line = E.rows.map(r => r[0]), model = E.rows.map(r => r[1]);
  check(`${name}: the model's path predicts where the ball goes after the bounce (median < 10 units)`, E.rows.length > 20 && med(model) < 10, `${E.rows.length} shots: model median ${med(model).toFixed(1)} mean ${mean(model).toFixed(1)}, game's straight line median ${med(line).toFixed(1)} mean ${mean(line).toFixed(1)}`);
  check(`${name}: ... and it is better than the game's straight line`, mean(model) < mean(line));
  const xm = E.xq.map(r => r[0]), xl = E.xq.map(r => r[1]);
  check(`${name}: where the CPU walks to: the model's X at its depth is where the ball crosses (median < 4 units; the questions about a depth the ball reaches before it is hit)`, E.xq.length > 20 && med(xm) < 4, `${E.xq.length} questions: model median ${med(xm).toFixed(1)} mean ${mean(xm).toFixed(1)}, game's straight line median ${med(xl).toFixed(1)} mean ${mean(xl).toFixed(1)}`);
}
// each level's rallies: a slow CPU (far reaction delay 30, near 26: the tour's first opponents) and a middling one (20 / 16) on both
// sides, hits per point on 120 Hz against Classic's (ai.js slowRead / aiReadWeight: the modelled ball gave a slow CPU time it never had)
function rallies(model, delay) {
  let pts = 0, hits = 0;
  for (const seed of SEEDS) for (const [court, p1, p2] of MATCHUPS) {
    const m = new EngineMatch(rom, { p1, p2, court, games: 6, sets: 3, difficulty: 2, seed }), S = m.E.S; if (model) m.E.physics = new Physics120();
    for (const c of S.chars) { c.aiReactionDelayFar = delay; c.aiReactionDelayNear = delay - 4; }
    let prl = 0, po = 0;
    for (let f = 0; f < 12000 && !m.over; f++) { S.chars[0].inputSource = 1; S.chars[1].inputSource = 1; m.update(0); if (S.rallyLength > prl) hits++; prl = S.rallyLength; if (S.pointOutcome && !po) pts++; po = S.pointOutcome; }
  }
  return hits / pts;
}
for (const d of [30, 20]) { const c = rallies(null, d), h = rallies(120, d); check(`120 Hz: a CPU of reaction delay ${d} keeps Classic's rally length (within 25%)`, Math.abs(h / c - 1) < 0.25, `hits per point: Classic ${c.toFixed(2)}, 120 Hz ${h.toFixed(2)}`); }
process.exit(bad ? 1 : 0);
