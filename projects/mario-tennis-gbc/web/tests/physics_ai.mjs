// The CPU with PHYSICS: Enhanced (web/js/engine/enhanced.js), on the standalone engine, CPU against CPU (no input, deterministic):
//  - hit rate: of the balls in play, the share the CPU returned (returns / (returns + points lost to a second bounce)), Classic vs Enhanced
//    (Enhanced must stay within 3 points of Classic),
//  - prediction: where the AI's "behind the landing point" target is against where an undisturbed ball really goes, the game's straight line
//    along the aim vs the model's own forward simulation (the AI is fed the latter in Enhanced); the model must be close (median < 10 units)
//    and better than the line.
// usage: node web/tests/physics_ai.mjs [--frames N]
import { EngineMatch } from "../js/engine/session.js";
import { romObject } from "./engine/corpus.mjs";
import * as setup from "../js/engine/setup.js";
import * as ball from "../js/engine/ball.js";
import { EnhancedPhysics } from "../js/engine/enhanced.js";
const a = process.argv.slice(2), FR = a.includes("--frames") ? +a[a.indexOf("--frames") + 1] : 30000;
const rom = romObject(), MATCHUPS = [[0, 23, 25], [1, 1, 2], [2, 5, 9]];
const sx = v => (v << 16) >> 16;
function run(enhanced) {
  let points = 0, hits = 0, winners = 0; const rows = [];
  for (const [court, p1, p2] of MATCHUPS) {
    const m = new EngineMatch(rom, { p1, p2, court, games: 6, sets: 3, difficulty: 2 }); setup.applyCpuDifficulty(m.E, 0, 3);
    const E = m.E, S = E.S; const ph = enhanced ? (E.physics = new EnhancedPhysics()) : null; let prevRl = 0, prevOut = 0, pend = null;
    for (let f = 0; f < FR && !m.over; f++) {
      S.chars[0].inputSource = 1; S.chars[1].inputSource = 1; m.update(0);
      const rl = S.rallyLength; if (rl > prevRl) hits++; const po = S.pointOutcome; if (po && !prevOut) { points++; if (po === 6) winners++; } prevOut = po;
      if (enhanced && pend) {
        if (S.ballBounceEvent === 1 && !pend.land) pend.land = [S.ballXFull / 65536, S.ballDepthFull / 65536];
        else if (pend.land) { pend.last = [S.ballXFull / 65536, S.ballDepthFull / 65536]; if (Math.hypot(pend.last[0] - pend.land[0], pend.last[1] - pend.land[1]) >= 192 || S.ballBounceEvent === 1 || rl !== pend.rl) pend.done = true; }
        if (pend.done || rl !== pend.rl || f - pend.f > 200) {
          if (pend.done && pend.last && Math.hypot(pend.last[0] - pend.land[0], pend.last[1] - pend.land[1]) >= 190) rows.push([Math.hypot(pend.c[0] - pend.last[0], pend.c[1] - pend.last[1]), Math.hypot(pend.a[0] - pend.last[0], pend.a[1] - pend.last[1])]);
          pend = null;
        }
      }
      if (enhanced && rl > prevRl && S.ballSpeed3D / 256 > 8) {
        ph.aiAware = false; const c = ball.offsetFromBallLanding(E, 0xC0); ph.aiAware = true; const q = ball.offsetFromBallLanding(E, 0xC0);
        pend = { f, rl, c: [sx(c.x), sx(c.depth)], a: [sx(q.x), sx(q.depth)] };
      }
      prevRl = rl;
    }
  }
  const returns = hits - points; return { hitRate: returns / (returns + winners), points, hits, rows };
}
let bad = 0; const check = (name, ok, info = "") => { console.log(ok ? "ok  " : "FAIL", name, info); if (!ok) bad++; };
const C = run(false), E = run(true);
check("Enhanced: the CPU returns as many balls as in Classic (within 3 points)", E.hitRate >= C.hitRate - 0.03, `Classic ${(C.hitRate * 100).toFixed(1)}% (${C.hits} hits, ${C.points} points), Enhanced ${(E.hitRate * 100).toFixed(1)}% (${E.hits} hits, ${E.points} points)`);
const med = v => v.slice().sort((x, y) => x - y)[Math.floor(v.length / 2)], mean = v => v.reduce((x, y) => x + y, 0) / v.length;
const line = E.rows.map(r => r[0]), model = E.rows.map(r => r[1]);
check("the model's path predicts where the ball goes after the bounce (median < 10 units)", E.rows.length > 20 && med(model) < 10, `${E.rows.length} shots: model median ${med(model).toFixed(1)} mean ${mean(model).toFixed(1)}, game's straight line median ${med(line).toFixed(1)} mean ${mean(line).toFixed(1)}`);
check("... and it is better than the game's straight line", mean(model) < mean(line));
process.exit(bad ? 1 : 0);
