// The shot preview (web/js/hd/shotpreview.js) against real play, natively in Node (no browser): Stroke rounds on the four courses
// with different holes, golfers and random seeds (so different winds), a bot that turns the aim (straight and well off the line, so
// the golfer's own curve and the wind bend the flight), changes the club and the shot mode, and swings a PERFECT FULL-POWER swing
// (A at wSwingCount $3C, A at $78: the cursor exactly 0; the putter: one press at $3C). The preview is computed twice for each shot,
// in the aiming menu and at the address (as the page computes it), on a copy of the memory; the ball's real rest spot (where
// ShotMainLoop 10:6E99 ended the shot) must be the preview's to the last fraction, the outcome too. The shots go from the tee, the
// fairway, the rough, bunkers and the green. A few swings that are not perfect (less power, a late impact) are played as well:
// those must come out elsewhere (the preview is a perfect swing's).
// usage: node web/tests/shot_preview.mjs [--verbose]
import fs from "fs";
import path from "path";
import { useRom } from "../js/golf/rom.js";
import { GolfMemory } from "../js/golf/memory.js";
import { playRoundFrames } from "../js/golf/game.js";
import { strokeRoundSetup, setCourseHole } from "../js/golf/start.js";
import { initDisplay } from "../js/golf/render/display.js";
import { runPreview } from "../js/hd/shotpreview.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
useRom(new Uint8Array(fs.readFileSync(path.join(root, "rom/mario_golf.gbc"))));
const verbose = process.argv.includes("--verbose");
const LIE = { 0: "fairway", 1: "rough", 2: "bunker", 6: "green", 9: "fringe", 10: "green", 12: "rough", 13: "bunker" };

// [course, hole, golfer (preset 02:4B1D: 8 Mario, 9 Luigi, 4 Putts), seed, shots: { aim: frames of Left (-) / Right (+), club: Up (-) /
// Down (+) presses, mode: B presses (the shot type), power / impact: the counts pressed at when not perfect }]
const CASES = [
  [1, 1, 8, 1234, [{}, {}, {}, {}]],
  [2, 1, 8, 777, [{ aim: 12 }, { aim: -20, club: 1 }, { club: -1, mode: 1 }, {}, {}, {}]],
  [3, 5, 9, 4242, [{ aim: 12 }, { aim: -20, club: 1 }, { club: -1, mode: 1 }, {}, {}, {}]],
  [4, 3, 4, 99, [{ aim: 12 }, { aim: -20, club: 1 }, { club: -1, mode: 1 }, {}, {}, {}]],
  [1, 3, 8, 5, [{ aim: 12 }, { aim: -20, club: 1 }, { club: -1, mode: 1 }, {}, {}, {}]],
  [2, 7, 9, 31337, [{ aim: 12 }, { aim: -20, club: 1 }, { club: -1, mode: 1 }, {}, {}, {}]],
  [3, 12, 8, 2024, [{ aim: 30 }, { aim: -24 }, {}, {}, {}]],
  [4, 16, 4, 7, [{ aim: -40 }, { aim: 18, club: 2 }, {}, {}, {}, {}]],
  [1, 9, 9, 4321, [{ mode: 1 }, { mode: 2 }, {}, {}, {}]],
  [2, 9, 8, 5, [{ power: 0x30 }, { impact: 0x76 }, { power: 0x2A, impact: 0x79 }, {}]],   // (not perfect: they differ)
];

function play([course, hole, golfer, seed, plan]) {
  const w = new GolfMemory();
  const holes = strokeRoundSetup(w, { golfer, course, seed });
  setCourseHole(w, course, course, hole);
  initDisplay(w);
  const r6 = w.wram[6], u16 = a => r6[a] | r6[a + 1] << 8;
  let mark = "", since = 0, frame = 0, shotI = 0, lastL = null, pvA = null, pvB = null, prevM = -1;
  const rows = [];
  const input = () => {
    const sp = plan[Math.min(shotI, plan.length - 1)];
    let b = 0;
    const m = r6[0x44E];
    if (mark === "aimmenu") {
      const L = sp.aim || 0, C = sp.club || 0, B = sp.mode || 0;
      if (since >= 20 && since < 20 + Math.abs(L)) b = L < 0 ? 0x20 : 0x10;
      const t2 = since - 25 - Math.abs(L);
      if (t2 >= 0 && t2 < Math.abs(C) * 6 && t2 % 6 < 2) b = C < 0 ? 0x40 : 0x80;
      const t3 = t2 - Math.abs(C) * 6 - 5;
      if (t3 >= 0 && t3 < B * 8 && t3 % 8 < 2) b = 2;
      const tA = t3 - B * 8 - 10;
      if (tA === 0) pvA = runPreview(w);
      if (tA >= 2 && tA < 4) b = 1;
    } else if (mark === "address") {
      if (!m && since === 25) { pvB = runPreview(w); pvB.club = r6[0x329]; pvB.lie = r6[0x4CD]; }
      if (!m && since >= 30 && since < 32) b = 1;
      const pw = sp.power ?? 0x3C, imp = sp.impact ?? 0x78;
      if (m && m !== prevM && (m === pw || (r6[0x329] !== 0x0D && m === imp))) b = 1;
      prevM = m;
    } else b = frame % 20 < 2 ? 1 : 0;
    frame++;
    return b;
  };
  const ev = (kind, name) => {
    if (kind === "M") { if (name !== mark) { mark = name; since = 0; } return; }
    if (kind === "F") since++;
    if (kind === "L") lastL = [u16(0x401) + r6[0x400] / 256, u16(0x404) + r6[0x403] / 256];   // (ShotMainLoop's top: the ball there)
  };
  const onShot = s => {
    const sp = plan[Math.min(shotI, plan.length - 1)], perfect = sp.power === undefined && sp.impact === undefined;
    const pv = [pvA, pvB].map(p => p && [p.end[0] * 32, p.end[2] * 32, p.outcome, p.carry, p.rest, p.ms]);
    rows.push({ course, hole, golfer, shot: shotI + 1, club: pvB ? pvB.club : r6[0x329], lie: pvB ? pvB.lie : -1, wind: [w.wram[0][0x815], w.wram[0][0x816]], perfect,
      real: lastL, outcome: s.outcome, aim: pv[0], addr: pv[1],
      same: pv.every(p => p && p[0] === lastL[0] && p[1] === lastL[1] && p[2] === s.outcome) });
    shotI++; pvA = pvB = null;
  };
  const g = playRoundFrames(w, holes, input, { ev, maxHoles: 1, onShot });
  let n = 0;
  for (const _ of g) {
    if (++n > 80000 || shotI >= plan.length) break;
  }
  return rows;
}

let ok = true, nPerfect = 0, nSame = 0, nOther = 0, nOtherSame = 0;
const ms = [];
for (const c of CASES) {
  for (const r of play(c)) {
    for (const p of [r.aim, r.addr]) if (p) ms.push(p[5]);
    const line = `course ${r.course} hole ${r.hole} golfer ${r.golfer} shot ${r.shot}: club ${r.club} from the ${LIE[r.lie] || "lie " + r.lie}, wind ${r.wind[0]} mph dir $${r.wind[1].toString(16)}, ` +
      `${r.perfect ? "perfect full" : "NOT perfect"}: preview ${r.addr ? `(${(r.addr[0] / 32).toFixed(3)}, ${(r.addr[1] / 32).toFixed(3)}) carry ${r.addr[3]} y, ${r.addr[4]} y` : "-"}; ` +
      `real (${(r.real[0] / 32).toFixed(3)}, ${(r.real[1] / 32).toFixed(3)}) outcome $${r.outcome.toString(16)} -> ${r.same ? "SAME" : "differs"}`;
    if (verbose || (r.perfect && !r.same) || (!r.perfect && r.same)) console.log(line);
    if (r.perfect) { nPerfect++; if (r.same) nSame++; else ok = false; }
    else { nOther++; if (r.same) { nOtherSame++; } }
  }
}
ms.sort((a, b) => a - b);
console.log(`preview runs: ${ms.length}, median ${ms[ms.length >> 1].toFixed(1)} ms, max ${ms[ms.length - 1].toFixed(1)} ms (Node)`);
console.log(`not perfect swings: ${nOther}, ${nOther - nOtherSame} came to rest elsewhere (expected)`);
console.log(`${ok && nPerfect >= 30 ? "ok  " : "FAIL"} shot preview: ${nSame} of ${nPerfect} perfect full swings came to rest exactly at the preview's spot (both previews: aiming and address)`);
process.exit(ok && nPerfect >= 30 ? 0 : 1);
