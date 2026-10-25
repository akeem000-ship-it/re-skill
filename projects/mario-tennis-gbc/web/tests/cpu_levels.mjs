// The CPU's difficulty levels under each PHYSICS model, measured: CPU against CPU on the engine (EngineMatch, no page), P1 the
// game's default CPU and P2 at the level, over three matchups and a set of seeds. Prints for each level and model the shots
// per point, how many points P1 won, and the level's miss rate: the points P2 lost per ball sent to it (the hitter of each
// shot: the character nearer the ball in depth when the rally count goes up). Classic is the game's own; the 120 Hz model
// should give each level the same miss rate (0.35.78: 6.3 / 2.1 / 0.6 / 0.5% Classic, 6.4 / 2.0 / 0.8 / 0.4% 120 Hz on 8 seeds).
// Slow (minutes a level): a measurement, not a gate.
// usage: node web/tests/cpu_levels.mjs [LEVEL] [--seeds 11,97,5] [--frames 20000] [--models classic,120,enh]
import { EngineMatch } from "../js/engine/session.js";
import { romObject } from "./engine/corpus.mjs";
import { EnhancedPhysics } from "../js/engine/enhanced.js";
import { Physics120 } from "../js/engine/physics120.js";

const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const level = +a.find(x => /^\d$/.test(x)) || 0;
const SEEDS = opt("--seeds", "11,97,5").split(",").map(Number), FRAMES = +opt("--frames", 20000);
const MODELS = opt("--models", "classic,120").split(",");
const MATCHUPS = [[0, 23, 25], [1, 1, 2], [2, 5, 9]];   // [court, P1, P2]
const rom = romObject();
const physics = m => (m === "120" ? new Physics120() : m === "enh" ? new EnhancedPhysics() : null);

function measure(model, lvl) {
  let points = 0, hits = 0, toP2 = 0, p2lost = 0, p1won = 0;
  for (const seed of SEEDS) for (const [court, p1, p2] of MATCHUPS) {
    const m = new EngineMatch(rom, { p1, p2, court, games: 6, sets: 3, difficulty: lvl - 1, seed }), E = m.E, S = E.S;
    E.physics = physics(model);
    let rally = 0, outcome = 0;
    for (let f = 0; f < FRAMES && !m.over; f++) {
      S.chars[0].inputSource = 1; S.chars[1].inputSource = 1;
      m.update(0);
      if (S.rallyLength > rally) {
        hits++;
        if (Math.abs(S.chars[0].posDepthInt - S.ballDepth) < Math.abs(S.chars[1].posDepthInt - S.ballDepth)) toP2++;
      }
      if (S.pointOutcome && !outcome) { points++; if (S.pointWinLoseFlag === 1) { p1won++; p2lost++; } }
      rally = S.rallyLength; outcome = S.pointOutcome;
    }
  }
  return { rally: hits / points, p1: p1won / points, miss: p2lost / toP2 };
}
const pct = x => (x * 100).toFixed(1) + "%";
for (const lvl of level ? [level] : [1, 2, 3, 4]) {
  const row = MODELS.map(md => { const r = measure(md, lvl); return `${md}: ${r.rally.toFixed(2)} shots/pt, P1 ${pct(r.p1)}, misses ${pct(r.miss)}`; });
  console.log(`CPU level ${lvl} | ${row.join(" | ")}`);
}
