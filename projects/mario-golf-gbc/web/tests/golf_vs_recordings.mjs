// The JavaScript golf engine (web/js/golf) against recordings of the real game: the same checks as
// tools/shot_run.py (one shot: every recorded event F / T / L / P / A / S from the snapshot to the outcome) and
// tools/hole_run.py (a whole hole: every shot frame by frame, the state at each address step, the round and
// player records at the end). No emulator: the engine runs on the recording's RAM snapshot and the ROM.
// Recordings: out/suite_*.json (tools/shot_suite.py) and out/hole_*.json (tools/hole_suite.py).
// usage: node web/tests/golf_vs_recordings.mjs [name filter]
import fs from "fs";
import path from "path";
import { useRom } from "../js/golf/rom.js";
import { GolfMemory, ball } from "../js/golf/memory.js";
import { Hole } from "../js/golf/ball.js";
import { Shot } from "../js/golf/shot.js";
import * as H from "../js/golf/hole.js";
import * as R from "../js/golf/round.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
useRom(new Uint8Array(fs.readFileSync(path.join(root, "rom/mario_golf.gbc"))));
const filter = process.argv[2] || "";

// the game's outcome for each shot case (tools/shot_suite.py) and the events tools/shot_run.py matches
const SHOTS = {
  bunker_land: [0x02, 284], chipfall: [0x06, 565], cupview: [0x80, 79], h1_bunker: [0x00, 729],
  h1_inbunker: [0x00, 690], h1_rolling: [0x09, 208], h1_shot2: [0x00, 726], h1_shot3: [0x00, 577],
  h1_shot4: [0x06, 866], h1_tee: [0x00, 806], h2_flight: [0x00, 484], h2_rolling: [0x00, 421],
  h2_tee: [0x01, 1065], out_of_bounds: [0x07, 241], overwater: [0x03, 67], plug_0000: [0x02, 4],
  plug_0200: [0x02, 4], putt_17_109: [0x80, 263], putt_23_107: [0x80, 413], putt_26_109: [0x80, 432],
  putt_miss: [0x06, 715], rollbunker: [0x02, 247], sand_semi: [0x09, 595], sand_to_sand: [0x02, 1078],
  tree_canopy: [0x01, 388], tree_trunk: [0x01, 274], water_stop: [0x03, 67],
};
// whole holes (tools/hole_suite.py) and rounds (round_*.json): the shots' outcomes, strokes / putts / points
// of each hole and the events matched
const HOLES = {
  hole_hole1: [[0x00, 0x06, 0x06, 0x80], [[4, 2, 0]], 5678],
  hole_hole1_ob: [[0x07, 0x00, 0x06, 0x06, 0x80], [[6, 2, 0]], 5847],
  hole_hole2: [[0x01, 0x01, 0x01, 0x09, 0x06, 0x80], [[6, 1, 0]], 6624],
  hole_hole2_water: [[0x03, 0x03, 0x01, 0x09, 0x06, 0x80], [[9, 1, 0x0A]], 6043],
  round_r3: [[0x00, 0x06, 0x06, 0x80, 0x01, 0x09, 0x06, 0x80, 0x06, 0x80], [[4, 2, 0], [4, 1, 0], [2, 1, 6]], 14289],
};

// bytes other frame tasks own (camera, HUD, captions; tools/shot_sim.py SKIP*)
const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
const SKIP = new Set([...range(0x2E, 0x38), ...range(0x5C, 0x60), ...range(0x65, 0x68), ...range(0x6B, 0x80), 0x54, 0x55]);
const SKIP_D3 = new Set([0x22, 0x26, 0x27, 0x6B, 0x6C, ...range(0x35, 0x46), ...range(0x46, 0x50)]);   // + the story picture ($D346-$D34F)
const hexBytes = s => Uint8Array.from({ length: s.length / 2 }, (_, i) => parseInt(s.substr(2 * i, 2), 16));
const h2 = v => v.toString(16).padStart(2, "0"), h4 = v => v.toString(16).padStart(4, "0");

function eventDiff(w, e) {                       // tools/shot_sim.py event_diff
  const out = [];
  const cmp = (want, got, base, skip) => { for (let k = 0; k < 0x100; k++) if (got[k] !== want[k] && !skip.has(k)) out.push([base + k, got[k], want[k]]); };
  cmp(hexBytes(e[2]), w.wram[6].subarray(0x400, 0x500), 0xD400, SKIP);
  if (e.length > 5) cmp(hexBytes(e[5]), w.wram[0].subarray(0x800, 0x900), 0xC800, new Set());
  if (e.length > 6) {
    cmp(hexBytes(e[6]), w.wram[6].subarray(0x300, 0x400), 0xD300, SKIP_D3);
    cmp(hexBytes(e[7]), w.wram[6].subarray(0x500, 0x600), 0xD500, new Set());
  }
  return out;
}

class Mismatch extends Error {}
class Finished extends Error {}

function checker(w, ev, joy, pos) {
  return kind => {
    if (pos.i >= ev.length) throw new Finished();
    const e = ev[pos.i];
    if (e[0] !== kind) throw new Mismatch(`event ${pos.i}: game had ${e[0]} (frame ${e[1]}), JS reached ${kind}`);
    const d = eventDiff(w, e);
    if (kind === "F" && joy[pos.i]) w.high.set(joy[pos.i], 0x190);
    if (d.length) throw new Mismatch(`event ${pos.i} (${kind}, frame ${e[1]}): differs at ` +
      d.slice(0, 8).map(([a, p, g]) => `$${h4(a)} js ${h2(p)} game ${h2(g)}`).join(", "));
    pos.i++;
  };
}

function runShot(rec) {                          // tools/shot_run.py
  const ev = rec.events, joy = rec.joy || {};
  const w = new GolfMemory().loadSnapshot(rec.snapshot);
  const hole = new Hole(w.wram[6][0x320]);
  const pos = { i: 0 };
  const check = checker(w, ev, joy, pos);
  const shot = new Shot(w, hole, check);
  let outcome = null, note = "";
  try {
    const e = ev[0];
    check(e[0]);
    if (e[0] === "L") outcome = shot.mainLoop(true);
    else if (e[0] === "A" || e[0] === "a") outcome = shot.fromAddress(e[0] === "a");
    else if (e[0] === "S") outcome = shot.launch();
    else if (e[0] === "P") outcome = shot.flightCam(e[4][3]);
    else throw new Mismatch(`recording starts with ${e[0]}`);
  } catch (x) {
    if (x instanceof Finished) note = " (end of recording)";
    else if (x instanceof Mismatch) note = " " + x.message;
    else throw x;
  }
  return { outcome, events: pos.i, note };
}

// at an address step the display state that depends on how long the menus took is taken from the recording
// (tools/hole_run.py DISPLAY): rebuilt before it is read
const DISPLAY = [[0x462, 0x468], [0x373, 0x383], [0x480, 0x481], [0x513, 0x514], [0x426, 0x42A]];

function runHole(rec) {                          // tools/hole_run.py, on through the next holes of a round
  const ev = rec.events, joy = rec.joy || {};
  const w = new GolfMemory().loadSnapshot(rec.snapshot);
  let hole = new Hole(w.wram[6][0x320]);
  const pos = { i: 0 };
  const check = checker(w, ev, joy, pos);
  const outs = [], holes = [];
  let note = "", records = null, addresses = 0;
  // between the shots the frames are not compared (captions and screens are not ported): the menus are
  // answered with A as soon as they read it, and the display state is taken from the game at the address step
  let toggle = 0;
  const quiet = new Shot(w, hole, () => {}, () => (toggle ^= 1) ? 1 : 0);
  const sync = () => {                           // to the next address step in the recording
    let nxt = -1;
    for (let i = pos.i; i < ev.length; i++) if (ev[i][0] === "A") { nxt = i; break; }
    if (nxt < 0) return false;
    const e = ev[nxt];
    const pages = { 0x300: hexBytes(e[6]), 0x400: hexBytes(e[2]), 0x500: hexBytes(e[7]) };
    for (const [lo, hi] of DISPLAY) w.wram[6].set(pages[lo & 0xF00].subarray(lo & 0xFF, (lo & 0xFF) + hi - lo), lo);
    pos.i = nxt;
    check("A");
    addresses++;
    return true;
  };
  try {
    check(ev[0][0]);
    for (;;) {
      const shot = new Shot(w, hole, check);
      const first = ev[pos.i - 1][0];
      let a;
      if (first === "A" || first === "a") a = shot.fromAddress(first === "a");
      else if (first === "L") a = shot.mainLoop(true);
      else a = shot.flightCam(ev[pos.i - 1][4][3]);
      outs.push(H.postShot(w, a));
      if (R.afterShot(quiet, a)) {               // the hole is over
        const w0 = w.wram[0], f = o => w0[0x880 + o + (w0[0x835] ? 0x40 : 0)];
        holes.push([f(0x20), f(0x21), w0[0x83C] | w0[0x83D] << 8]);
        if (!ev.slice(pos.i).some(e => e[0] === "A")) {    // the recording ends in this hole's end
          const want = hexBytes(ev[ev.length - 1][5]);
          const d = range(0, 0x100).filter(k => want[k] !== w0[0x800 + k]);
          records = d.length ? "differ at " + d.map(k => `$${h4(0xC800 + k)} js ${h2(w0[0x800 + k])} game ${h2(want[k])}`).join(" ") : "match";
          break;
        }
        if (!R.holeEnd(w)) { note = " the round ended before the recording"; break; }
        hole = R.holeStart(quiet);
      } else R.nextShot(quiet);
      if (!sync()) { note = ` recording ends before shot ${outs.length + 1}`; break; }
    }
  } catch (x) {
    if (x instanceof Mismatch) note = " " + x.message;
    else throw x;
  }
  return { outs, holes, records, events: pos.i, addresses, note };
}

let pass = 0, fail = 0;
const report = (ok, line) => { ok ? pass++ : fail++; console.log(`${ok ? "ok  " : "FAIL"} ${line}`); };
for (const [name, [want, wantEvents]] of Object.entries(SHOTS)) {
  if (!name.includes(filter)) continue;
  const file = path.join(root, `out/suite_${name}.json`);
  if (!fs.existsSync(file)) { report(false, `${name}: no recording (run tools/shot_suite.py)`); continue; }
  const r = runShot(JSON.parse(fs.readFileSync(file)));
  const ok = r.outcome === want && r.events === wantEvents && !r.note;
  report(ok, `shot ${name}: ${r.events} events matched, outcome ${r.outcome === null ? "none" : "$" + h2(r.outcome)}` +
    (ok ? "" : ` (want $${h2(want)} after ${wantEvents} events)`) + r.note);
}
for (const [name, [outs, holes, wantEvents]] of Object.entries(HOLES)) {
  if (!name.includes(filter)) continue;
  const file = path.join(root, `out/${name}.json`);
  if (!fs.existsSync(file)) { report(false, `${name}: no recording (run tools/hole_suite.py)`); continue; }
  const r = runHole(JSON.parse(fs.readFileSync(file)));
  const ok = !r.note && r.records === "match" && JSON.stringify(r.outs) === JSON.stringify(outs) &&
    (!wantEvents || r.events === wantEvents) && JSON.stringify(r.holes) === JSON.stringify(holes);
  report(ok, `${name}: shots ${r.outs.map(h2).join(" ")}, ${r.addresses} address steps match, ` +
    r.holes.map(([s, p, pts]) => `${s} strokes ${p} putts`).join(" / ") + (r.holes.length ? `, points $${h4(r.holes[r.holes.length - 1][2])}` : "") +
    `, records ${r.records}, ${r.events} events` + r.note);
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
