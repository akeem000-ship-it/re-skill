// The round and hole set-up in JavaScript (web/js/golf/round.js) against the game, frame by frame: from the RAM
// at GolfRound's entry (10:4451) the engine plays the round start, the hole's set-up from the ROM's hole data,
// the intro fly-over, ShotSetup and the aiming menu to the first address step (10:56B0), with the joypad the game
// read each frame. At every AdvanceFrame the RAM is compared with the game's (the round and player records
// $C800-$C8FF, WRAM6 $D300-$D5FF except the bytes display tasks own, as in tools/shot_sim.py), the steps
// (M events) must come at the same frames, and at the address step the course or green maps the ball code reads
// (WRAM2/3 $D000, WRAM6 $D700 / $D800, WRAM1 $D800) are compared too.
// With --minimal the start is not the game's RAM but zeroes plus only the inputs the set-up reads (the RAM is then
// compared at the address step only).
// Reference: out/holesetup_*.json from tools/hole_setup_suite.py (tools/emu_hole_setup.py).
// usage: node web/tests/golf_hole_setup.mjs [--minimal] [name filter]
import fs from "fs";
import path from "path";
import { useRom } from "../js/golf/rom.js";
import { GolfMemory } from "../js/golf/memory.js";
import { Shot } from "../js/golf/shot.js";
import * as R from "../js/golf/round.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
useRom(new Uint8Array(fs.readFileSync(path.join(root, "rom/mario_golf.gbc"))));
const minimal = process.argv.includes("--minimal");
const filter = process.argv.slice(2).find(a => !a.startsWith("--")) || "";

const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
// bytes the display tasks own: the camera $D42E-$D437, HUD flags $D454/$D455, the view-4 projection
// $D45C-$D45F, the swing animation's frame $D465-$D467, the sprite list $D46B-$D47F; the HUD's wind indicator
// $D322 $D326 $D327, the marker blink $D36B/$D36C, captions and the camera scroll $D335-$D345, the story
// picture $D346-$D34F
const SKIP_D4 = new Set([...range(0x2E, 0x38), ...range(0x5C, 0x60), ...range(0x65, 0x68), ...range(0x6B, 0x80), 0x54, 0x55]);
const SKIP_D3 = new Set([0x22, 0x26, 0x27, 0x6B, 0x6C, ...range(0x35, 0x50)]);
const hexBytes = s => Uint8Array.from({ length: s.length / 2 }, (_, i) => parseInt(s.substr(2 * i, 2), 16));
const h2 = v => v.toString(16).padStart(2, "0"), h4 = v => v.toString(16).padStart(4, "0");

// what the set-up reads from the RAM at GolfRound's entry (everything else starts at zero with --minimal):
// the round and player records, the random seed and the event overrides $D4DE-$D4EF
const INPUTS = [["wram0", 0x800, 0x900], ["high", 0x1FC, 0x1FE], ["wram6", 0x4DE, 0x4F0]];

function diff(name, got, exp, base, skip = new Set()) {
  const d = [];
  for (let k = 0; k < Math.min(exp.length, got.length); k++) if (got[k] !== exp[k] && !skip.has(k & 0xFF)) d.push(k);
  return d.length ? `${name}: ${d.length} bytes differ: ` + d.slice(0, 10).map(k => `$${h4(base + k)} js ${h2(got[k])} game ${h2(exp[k])}`).join(", ") : null;
}

class Mismatch extends Error {}

let pass = 0, fail = 0;
for (const f of fs.readdirSync(path.join(root, "out")).filter(n => /^holesetup_.*\.json$/.test(n) && n.includes(filter)).sort()) {
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
  const ev = rec.events;
  let pos = 0, frames = 0;
  const check = (kind, name) => {
    while (pos < ev.length && ev[pos][0] === "M" && kind === "F") {   // a step the engine passed without marking
      throw new Mismatch(`at frame ${frames}: the game reached ${ev[pos][2]}, JS went on to the next frame`);
    }
    const e = ev[pos];
    if (!e) throw new Mismatch(`JS went past the end of the recording (${kind} ${name || ""})`);
    if (kind === "M") {
      if (e[0] !== "M" || e[2] !== name) throw new Mismatch(`at frame ${frames}: JS reached ${name}, the game had ${e[0] === "M" ? e[2] : "a frame"}`);
      pos++;
      return;
    }
    if (e[0] !== "F") throw new Mismatch(`at frame ${frames}: JS reached a frame, the game had ${e[2]}`);
    const d = [diff("records", w.wram[0].subarray(0x800, 0x900), hexBytes(e[3]), 0xC800),
               diff("D3", w.wram[6].subarray(0x300, 0x400), hexBytes(e[2]).subarray(0, 0x100), 0xD300, SKIP_D3),
               diff("D4", w.wram[6].subarray(0x400, 0x500), hexBytes(e[2]).subarray(0x100, 0x200), 0xD400, SKIP_D4),
               diff("D5", w.wram[6].subarray(0x500, 0x600), hexBytes(e[2]).subarray(0x200, 0x300), 0xD500)].filter(Boolean);
    if (d.length && !minimal) throw new Mismatch(`frame ${frames} (game frame ${e[1]}): ` + d.join("; "));
    if (e[4]) w.high.set(e[4], 0x190);           // this frame's joypad as VBlank read it
    pos++; frames++;
  };
  const sh = new Shot(w, null, check);
  const out = [];
  let hole = null;
  try {
    R.golfRoundStart(sh, start.a);
    hole = R.holeStart(sh);
    check("M", "address");
  } catch (e) {
    if (e instanceof Mismatch) out.push(e.message);
    else out.push("error: " + e.stack.split("\n").slice(0, 3).join(" | "));
  }
  const W = new GolfMemory().loadSnapshot(want.snapshot);
  if (!out.length) {
    for (const d of [diff("records", w.wram[0].subarray(0x800, 0x900), W.wram[0].subarray(0x800, 0x900), 0xC800),
                     diff("D3", w.wram[6].subarray(0x300, 0x400), W.wram[6].subarray(0x300, 0x400), 0xD300, SKIP_D3),
                     diff("D4", w.wram[6].subarray(0x400, 0x500), W.wram[6].subarray(0x400, 0x500), 0xD400, SKIP_D4),
                     diff("D5", w.wram[6].subarray(0x500, 0x600), W.wram[6].subarray(0x500, 0x600), 0xD500),
                     diff("seed", w.high.subarray(0x1FC, 0x1FE), W.high.subarray(0x1FC, 0x1FE), 0xFFFC)]) if (d) out.push("at the address step: " + d);
  }
  if (hole) {
    const v = W.wram[6][0x443], green = v >= 1 && v <= 3;   // the maps of the view at the address step
    hole.use(green);
    for (const d of [diff("attributes", hole.attrs, W.wram[2], 0xD000), diff("tilemap", hole.tmap, W.wram[3], 0xD000),
                     diff("tile bytes", hole.slope, W.wram[6].subarray(0x700, 0x800), 0xD700),
                     diff("terrain", hole.terrain, W.wram[6].subarray(0x800, 0x1000), 0xD800),
                     green ? null : diff("slopes", hole.slopes, W.wram[1].subarray(0x800, 0x1000), 0xD800)]) if (d) out.push(d);
  }
  const ok = !out.length;
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${f}${minimal ? " (minimal start)" : ""}: ${frames} frames, hole id $${h2(w.wram[6][0x320])}, par ${w.wram[6][0x325]}, ` +
    `wind ${w.wram[0][0x815]} mph angle $${h2(w.wram[0][0x816])}, club ${w.wram[6][0x329]}, aim $${h4(w.wram[6][0x418] | w.wram[6][0x419] << 8)}`);
  for (const l of out) console.log("     " + l);
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
