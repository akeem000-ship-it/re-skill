// The 3D layers' REPLAY (web/js/g3d/replay.js) re-runs a shot with the native engine on a copy of the game's memory taken in the
// launch frame. This test plays two holes of a Stroke round natively (no browser: js/golf/game.js, a bot's buttons), and at every
// launch takes the copy and re-runs the shot to its end as the replay does. It checks that (1) the re-run's ball path equals the live
// game's frame for frame and its outcome is the game's, and (2) the live game's memory is unchanged by the re-run (a hash of the WRAM
// banks and HRAM before and after).
// usage: node web/tests/g3d_replay_rerun.mjs [holes=2]
import fs from "fs";
import path from "path";
import { useRom } from "../js/golf/rom.js";
import { GolfMemory } from "../js/golf/memory.js";
import { playRoundFrames } from "../js/golf/game.js";
import { strokeRoundSetup } from "../js/golf/start.js";
import { initDisplay } from "../js/golf/render/display.js";
import { cloneMemory, rerunShot } from "../js/g3d/replay.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
useRom(new Uint8Array(fs.readFileSync(path.join(root, "rom/mario_golf.gbc"))));
const holesWanted = +(process.argv[2] || 2);
const w = new GolfMemory();
const holes = strokeRoundSetup(w, { golfer: 8, course: 1, seed: 4321 });
initDisplay(w); w.onSound = () => {}; w.onMusicOption = () => {}; w.jingleActive = () => 0; w.onEndJingle = () => {};
let f = 0;
const r6 = w.wram[6], u16 = a => r6[a] | r6[a + 1] << 8;
const input = () => { const m = r6[0x44E]; if (m) return r6[0x329] === 0x0D ? (m === 0x14 || m === 0x15 ? 1 : 0) : (m === 0x38 || m === 0x39 || m === 0x76 || m === 0x77 ? 1 : 0); return f % 20 === 0 ? 1 : 0; };
const shots = [];
const g = playRoundFrames(w, holes, input, { maxHoles: holesWanted, onShot: s => shots.push(s.outcome) });
const pos = () => [u16(0x401) + r6[0x400] / 256, u16(0x404) + r6[0x403] / 256];
const hash = m => { let h = 2166136261; for (const b of m.wram) for (const x of b) h = Math.imul(h ^ x, 16777619); for (const x of m.high) h = Math.imul(h ^ x, 16777619); return h >>> 0; };
let prev = null, prev438 = 0, rec = null, seen = 0, ok = 0;
const fails = [];
for (; f < 40000; f++) {
  if (g.next().done) break;
  const p = pos();
  if (r6[0x438] === 0x11 && prev438 !== 0x11 && r6[0x4D3] === 0 && prev && prev[0] === p[0] && prev[1] === p[1]) {   // the launch frame
    const before = hash(w), it = rerunShot(cloneMemory(w)); let r; while (!(r = it.next()).done);
    if (hash(w) !== before) fails.push(`frame ${f}: the live memory changed during the re-run`);
    rec = { path: r.value.path, outcome: r.value.outcome, live: [] };
  } else if (rec) rec.live.push(p);
  if (shots.length !== seen) {
    seen = shots.length;
    if (rec) {
      const n = Math.min(rec.path.length, rec.live.length);
      let bad = -1; for (let i = 0; i < n; i++) if (rec.path[i][0] * 32 !== rec.live[i][0] || rec.path[i][2] * 32 !== rec.live[i][1]) { bad = i; break; }
      if (bad >= 0 || rec.outcome !== shots[seen - 1] || n < rec.path.length - 1) fails.push(`shot ${seen}: ${bad >= 0 ? "the path differs at frame " + bad : "outcome / length"} (rerun $${(rec.outcome ?? -1).toString(16)}, game $${shots[seen - 1].toString(16)})`);
      else ok++;
    } else fails.push(`shot ${seen}: no launch frame seen`);
    rec = null;
  }
  prev = p; prev438 = r6[0x438];
}
for (const x of fails) console.log("     " + x);
console.log(`${fails.length || !ok ? "FAIL" : "ok  "} replay re-run: ${ok} of ${seen} shots re-run on a copy came out as the game played them (paths frame by frame, outcomes), the live memory untouched`);
process.exit(fails.length || !ok ? 1 : 0);
