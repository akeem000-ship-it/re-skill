// Ported screens against the ROM's, each from a core state at the routine's entry (web/tests/golf/screenstep.mjs):
// frame by frame the display, at the end all RAM. The states are made once with web/tests/golf/mkstate.mjs (the
// command is printed when one is missing).
// usage: node web/tests/golf_screens_vs_core.mjs [name filter] [--verbose]
import fs from "fs";
import path from "path";
import { runScreen } from "./golf/screenstep.mjs";
import { matchStandingsScreen } from "../js/golf/standings.js";
import { showScorecard } from "../js/golf/scorecard.js";
import { roundResultScreen } from "../js/golf/result.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const filter = process.argv.slice(2).find(a => !a.startsWith("--")) || "";
const verbose = process.argv.includes("--verbose");
const inBank = (sh, bank, g) => (function* () {
  const old = sh.w.high[0x195]; sh.w.high[0x195] = bank;
  try { return yield* g; } finally { sh.w.high[0x195] = old; }
})();

// name, the state (round, routine), the native routine, buttons
const CASES = [
  { name: "standings_match18", round: "match18", at: "3E:403F", run: sh => inBank(sh, 0x3E, matchStandingsScreen(sh)) },
  // the scorecard in match play (0E:43D6): Right on the standings page turns to the hole-by-hole card (0E:762F),
  // Left there back, A leaves
  { name: "scorecard_match18", round: "match18", at: "0E:43D6", run: sh => inBank(sh, 0x0E, showScorecard(sh)), noRet: true,
    policy: f => (f === 30 ? 0x10 : f === 70 ? 0x20 : f === 110 ? 0x10 : f > 150 && f & 1 ? 1 : 0) },
  { name: "result_match18", round: "match18", at: "0B:59DE", run: (sh, r) => inBank(sh, 0x0B, roundResultScreen(sh, r.a)),
    policy: f => (f > 120 && f & 1 ? 1 : 0) },
];

let bad = 0;
for (const c of CASES) {
  if (filter && !c.name.includes(filter)) continue;
  const stateFile = `out/state_${c.state || c.name}.json`;
  if (!fs.existsSync(path.join(root, stateFile))) {
    console.log(`skip ${c.name}: no ${stateFile} (node web/tests/golf/mkstate.mjs --name ${c.round} --at ${c.at} --out ${stateFile})`);
    continue;
  }
  let r;
  try { r = runScreen({ stateFile, run: c.run, policy: c.policy, verbose, trace: process.argv.includes("--trace") }); }
  catch (e) { console.log(`FAIL ${c.name}: ${e.stack}`); bad++; continue; }
  const sounds = r.sounds.core.join(" ") === r.sounds.native.join(" ");
  const ok = !r.bad.length && !r.end.length && sounds && (c.noRet || r.native === r.coreA);
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${c.name}: ${r.frames} frames, ${r.pixelExact} pixel-exact, ${r.modelExact} with the display state equal, ` +
    `${r.lag} differing after lag frames, ${r.bad.length} other; returned ${r.native} (game ${r.coreA}); sounds ${sounds ? "the same" : `differ: game ${r.sounds.core.join(" ")} / js ${r.sounds.native.join(" ")}`}`);
  for (const b of r.bad.slice(0, 5)) console.log(`    frame ${b.frame}: ${b.px} px; ${b.out.join("; ")}`);
  for (const e of r.end) console.log(`    at the end: ${e}`);
}
process.exit(bad ? 1 : 0);
