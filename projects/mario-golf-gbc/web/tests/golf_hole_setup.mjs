// The round and hole set-up in JavaScript (web/js/golf/round.js) against the game: from the RAM at GolfRound's
// entry (10:4451) the engine plays the round start, the hole's set-up from the ROM's hole data and ShotSetup up
// to the first address step (10:56B0), and the result is compared with the game's RAM there: the round and
// player records $C800-$C8FF, WRAM6 $D300-$D5FF (except bytes the display tasks own, as in
// tools/shot_sim.py, and the display state that depends on how long the menus took, as in tools/hole_run.py)
// and the course maps the ball code reads (WRAM2/3 $D000, WRAM6 $D700 / $D800, WRAM1 $D800).
// With --minimal the start is not the game's RAM but zeroes plus only the inputs the set-up reads.
// Reference: out/holesetup_*.json from tools/emu_hole_setup.py.
// usage: node web/tests/golf_hole_setup.mjs [--minimal]
import fs from "fs";
import path from "path";
import { useRom } from "../js/golf/rom.js";
import { GolfMemory } from "../js/golf/memory.js";
import * as R from "../js/golf/round.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
useRom(new Uint8Array(fs.readFileSync(path.join(root, "rom/mario_golf.gbc"))));
const minimal = process.argv.includes("--minimal");

const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
const SKIP_D4 = new Set([...range(0x2E, 0x38), ...range(0x5C, 0x60), ...range(0x65, 0x68), ...range(0x6B, 0x80), 0x54, 0x55]);
const SKIP_D3 = new Set([0x22, 0x26, 0x27, 0x6B, 0x6C, ...range(0x35, 0x46), ...range(0x46, 0x50)]);   // + the story picture ($D346-$D34F)
const DISPLAY = [[0x462, 0x468], [0x373, 0x383], [0x480, 0x481], [0x513, 0x514], [0x426, 0x42A]];
const hexBytes = s => Uint8Array.from({ length: s.length / 2 }, (_, i) => parseInt(s.substr(2 * i, 2), 16));
const h2 = v => v.toString(16).padStart(2, "0"), h4 = v => v.toString(16).padStart(4, "0");

// what the set-up reads from the RAM at GolfRound's entry (everything else starts at zero with --minimal):
// the round and player records, the frame task table, the random seed and the event overrides $D4DE-$D4EF
const INPUTS = [["wram0", 0x800, 0x900], ["high", 0x1FC, 0x1FE], ["wram6", 0x4DE, 0x4F0]];

let pass = 0, fail = 0;
for (const f of fs.readdirSync(path.join(root, "out")).filter(n => /^holesetup_.*\.json$/.test(n)).sort()) {
  const rec = JSON.parse(fs.readFileSync(path.join(root, "out", f)));
  const start = rec.points.find(p => p.kind === "round");
  const want = rec.points.find(p => p.kind === "address");
  let w = new GolfMemory().loadSnapshot(start.snapshot);
  if (minimal) {
    const full = w;
    w = new GolfMemory();
    for (const [k, lo, hi] of INPUTS) {
      const src = k === "high" ? full.high : full.wram[+k.slice(4)], dst = k === "high" ? w.high : w.wram[+k.slice(4)];
      dst.set(src.subarray(lo, hi), lo);
    }
  }
  const out = [];
  let hole;
  try {
    R.golfRoundStart(w, start.a);
    hole = R.holeStart(w);
  } catch (e) { out.push("error: " + e.message); }
  const W = new GolfMemory().loadSnapshot(want.snapshot);
  for (const [lo, hi] of DISPLAY) w.wram[6].set(W.wram[6].subarray(lo, hi), lo);   // display timing: from the game
  const cmp = (name, got, exp, base, skip = new Set()) => {
    const d = [];
    for (let k = 0; k < Math.min(exp.length, got.length); k++) if (got[k] !== exp[k] && !skip.has(k & 0xFF)) d.push(k);
    if (d.length) out.push(`${name}: ${d.length} bytes differ: ` + d.slice(0, 12).map(k => `$${h4(base + k)} js ${h2(got[k])} game ${h2(exp[k])}`).join(", "));
  };
  cmp("records", w.wram[0].subarray(0x800, 0x900), W.wram[0].subarray(0x800, 0x900), 0xC800);
  cmp("D3", w.wram[6].subarray(0x300, 0x400), W.wram[6].subarray(0x300, 0x400), 0xD300, SKIP_D3);
  cmp("D4", w.wram[6].subarray(0x400, 0x500), W.wram[6].subarray(0x400, 0x500), 0xD400, SKIP_D4);
  cmp("D5", w.wram[6].subarray(0x500, 0x600), W.wram[6].subarray(0x500, 0x600), 0xD500);
  cmp("seed", w.high.subarray(0x1FC, 0x1FE), W.high.subarray(0x1FC, 0x1FE), 0xFFFC);
  if (hole) {
    const v = W.wram[6][0x443]; hole.use(v >= 1 && v <= 3);       // the maps of the view at the address step
    cmp("attributes", hole.attrs, W.wram[2], 0xD000);
    cmp("tilemap", hole.tmap, W.wram[3], 0xD000);
    cmp("tile bytes", hole.slope, W.wram[6].subarray(0x700, 0x800), 0xD700);
    cmp("terrain", hole.terrain, W.wram[6].subarray(0x800, 0x1000), 0xD800);
    if (!(v >= 1 && v <= 3)) cmp("slopes", hole.slopes, W.wram[1].subarray(0x800, 0x1000), 0xD800);
  }
  const ok = !out.length;
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${f}${minimal ? " (minimal start)" : ""}: hole id $${h2(w.wram[6][0x320])}, par ${w.wram[6][0x325]}, ` +
    `wind ${w.wram[0][0x815]} mph angle $${h2(w.wram[0][0x816])}, club ${w.wram[6][0x329]}, aim $${h4(w.wram[6][0x418] | w.wram[6][0x419] << 8)}`);
  for (const l of out) console.log("     " + l);
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
