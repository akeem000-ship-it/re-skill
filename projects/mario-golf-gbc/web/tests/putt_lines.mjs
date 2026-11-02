// The putting view's break lines (web/js/hd/aimpower.js drawPuttView: shotpreview.js runPreview with the putter's press count) against
// real putts, natively in Node (no browser). Stroke rounds reach a putt on the green with a scripted player (the approach shots'
// power presses below, the impact at $78; on the green the putter); there the four lines are computed as the page computes them, in
// the aiming menu and again at the address (on a copy of the memory), and then the real putt is struck: the putter's one press at
// count $3C, $2E, $1E or $10 (100 / 77 / 50 / 27 %: the even counts a press can strike at, shotpreview.js PUTT_POWERS). The ball's real rest spot (where ShotMainLoop 10:6E99 ended the putt) must be the
// line's end to the last fraction, the outcome and the roll (a holed putt: "in" on both) (ShotLength 10:6276, feet as the HUD's 12:4CB1) too. Each putt is played
// from power-on of the round again (the same seed reaches the same putt), once per press count.
// usage: node web/tests/putt_lines.mjs [--verbose]
import fs from "fs";
import path from "path";
import { useRom } from "../js/golf/rom.js";
import { GolfMemory } from "../js/golf/memory.js";
import { playRoundFrames } from "../js/golf/game.js";
import { strokeRoundSetup, setCourseHole } from "../js/golf/start.js";
import { initDisplay } from "../js/golf/render/display.js";
import { pinDist, shotLength } from "../js/golf/cup.js";
import { runPreview, feetText, PUTT_POWERS } from "../js/hd/shotpreview.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
useRom(new Uint8Array(fs.readFileSync(path.join(root, "rom/mario_golf.gbc"))));
const verbose = process.argv.includes("--verbose");

// the putts: [name, course, hole, seed, the approach shots' power presses]
const PUTTS = [
  ["Marion 1", 1, 1, 4321, [60, 48]],
  ["Palm 18", 2, 18, 4321, [60, 56]],
  ["Dune 2", 3, 2, 4321, [52]],
  ["Links 18", 4, 18, 4321, [60]],
  ["Marion 3 (fringe)", 1, 3, 4321, [60, 48]],
  ["Palm 1", 2, 1, 4321, [60, 60]],
  ["Dune 5", 3, 5, 4321, [60, 52]],
  ["Links 3", 4, 3, 4321, [60, 56]],
];

function play([name, course, hole, seed, powers], press) {
  const w = new GolfMemory();
  const holes = strokeRoundSetup(w, { golfer: 8, course: 1, seed });
  setCourseHole(w, course, course, hole);
  initDisplay(w);
  const r6 = w.wram[6], u16 = a => r6[a] | r6[a + 1] << 8;
  let mark = "", since = 0, frame = 0, shotI = 0, prevM = -1, putting = false, lastL = null, done = null;
  let pvAim = null, pvAddr = null, feet = null, start = null;
  const input = () => {
    frame++;
    const m = r6[0x44E];
    if (mark === "aimmenu") {
      if (r6[0x443] === 1) {                         // the green: the putter, then the lines, then A
        if (r6[0x329] !== 0x0D) return since >= 12 && since % 8 < 2 ? 0x80 : 0;
        putting = true;
        if (since === 40) { pvAim = PUTT_POWERS.map(power => runPreview(w, { power })); feet = feetText(pinDist(r6.subarray(0x400, 0x500))); }
        return since >= 50 && since < 52 ? 1 : 0;
      }
      return since >= 30 && since < 32 ? 1 : 0;
    }
    if (mark === "address") {
      if (putting && !m && since === 25) pvAddr = PUTT_POWERS.map(power => runPreview(w, { power }));
      let b = 0;
      if (!m && since >= 30 && since < 32) b = 1;
      const pw = putting ? press : powers[shotI] ?? 60;
      if (m && m !== prevM && (m === pw || (r6[0x329] !== 0x0D && m === 0x78))) b = 1;
      prevM = m;
      return b;
    }
    return frame % 20 < 2 ? 1 : 0;
  };
  const ev = (kind, nm) => {
    if (kind === "M") { if (nm !== mark) { mark = nm; since = 0; } return; }
    if (kind === "F") since++;
    if (kind === "L") lastL = [u16(0x401) + r6[0x400] / 256, u16(0x404) + r6[0x403] / 256];   // (ShotMainLoop's top: the ball there)
  };
  const onShot = s => {
    if (putting && !done) done = { outcome: s.outcome, real: lastL, len: shotLength(r6.subarray(0x400, 0x500), r6.subarray(0x5F8, 0x5FE)) };
    shotI++;
  };
  const g = playRoundFrames(w, holes, input, { ev, maxHoles: 1, onShot });
  let n = 0;
  for (const _ of g) { if (done || ++n > 60000) break; }
  if (!done) return null;
  return { name, feet, hid: r6[0x320], done, pvAim, pvAddr };
}

let ok = true, n = 0, same = 0;
const out = [];
for (const P of PUTTS) {
  const row = [];
  for (const [i, press] of PUTT_POWERS.entries()) {
    const r = play(P, press);
    if (!r) { console.log(`${P[0]}: no putt reached`); ok = false; break; }
    const want = [r.pvAim[i], r.pvAddr[i]];
    const real = r.done.real, holed = r.done.outcome === 0x80;   // (holed: the line ends in the cup; the outcome must be "in")
    const eq = want.every(p => p && p.outcome === r.done.outcome && (holed || (p.end[0] * 32 === real[0] && p.end[2] * 32 === real[1] && p.len === r.done.len)));
    n++; if (eq) same++; else ok = false;
    const pv = want[1];
    row.push(`${Math.round(press / 0.6)}%: line ${pv.outcome === 0x80 ? "in" : feetText(pv.len) + " ft"} to (${pv.end[0].toFixed(3)}, ${pv.end[2].toFixed(3)}), real ${r.done.outcome === 0x80 ? "in" : feetText(r.done.len) + " ft"} (${(real[0] / 32).toFixed(3)}, ${(real[1] / 32).toFixed(3)}) ${eq ? "SAME" : "DIFFERS"}`);
    if (i === 0) row.unshift(`${P[0]} (hole $${r.hid.toString(16)}): a ${r.feet} ft putt`);
  }
  console.log(row.join("\n  "));
}
console.log(`${ok ? "ok  " : "FAIL"} putt lines: ${same} of ${n} putts (struck at 100 / 77 / 50 / 27 %) came to rest exactly where their line ends (computed in the aiming menu and at the address)`);
process.exit(ok ? 0 : 1);
