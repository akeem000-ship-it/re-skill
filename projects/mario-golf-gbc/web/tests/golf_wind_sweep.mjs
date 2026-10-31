// Bank 3C's debug wind sweep (windsweep.js: 3C:6A23 DebugWindCarryTest, 3C:6A55 DebugWindCarrySweep, 3C:6BCA
// DebugTestShot, 3C:6B59 DebugLogShot) against the ROM's, frame by frame (web/tests/golf/screenstep.mjs). Nothing calls
// export $04, so each case patches the core's ROM at its state's entry into `rst $18 ; db $04, $3C` (the far call) and
// runs the native DebugWindCarryTest: all 1,872 shots (13 clubs x 16 wind angles x 9 speeds, a frame each), "COMPLETE"
// and a frame, to the `jr` to itself at 3C:6A4A (the code ends there; the harness's spinAt). Frame by frame the
// display; at the end all WRAM, HRAM and the save RAM (the shots' log at $A000-$BD3F and the pointer
// $BFF0), and the RAM window (RAMG / RAMB) as the MBC has it.
// usage: node web/tests/golf_wind_sweep.mjs [name filter] [--verbose]
import fs from "fs";
import path from "path";
import { runScreen } from "./golf/screenstep.mjs";
import { debugWindCarryTest } from "../js/golf/windsweep.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const filter = process.argv.slice(2).find(a => !a.startsWith("--")) || "";
const verbose = process.argv.includes("--verbose");
const SHOTS = +(process.env.SWEEP_SHOTS || 13 * 16 * 9);   // (SWEEP_SHOTS: debugging, a shorter run)

// the native routine in bank 3C (SWEEP_SHOTS: stopped after that many shots, the core compared there too)
const inBank3C = sh => (function* () {
  sh.w.high[0x195] = 0x3C;
  const g = debugWindCarryTest(sh);
  let frames = 0;
  for (let r = g.next(); !r.done; r = g.next()) {
    if (process.env.SWEEP_SHOTS && frames++ >= SHOTS) return;
    yield r.value;
  }
})();

// states: a hole in a round (ShotSetup 10:4798 at the first tee) and the front end (GameModeSelect 0D:4AA7)
const CASES = [
  { name: "sweep_shotsetup", state: "shotsetup_r18", at: "10:4798" },
  { name: "sweep_modeselect", state: "boot_modeselect", at: "0D:4AA7" },
];

let bad = 0;
for (const c of CASES) {
  if (filter && !c.name.includes(filter)) continue;
  const stateFile = `out/state_${c.state}.json`;
  if (!fs.existsSync(path.join(root, stateFile))) { console.log(`skip ${c.name}: no ${stateFile}`); continue; }
  let window = null, logEnd = 0;
  const r = runScreen({ stateFile, verbose, spinAt: [0x3C, 0x6A4A], open: !!process.env.SWEEP_SHOTS, romPatch: { [c.at]: [0xDF, 0x04, 0x3C] },
    run: inBank3C, policy: () => 0,
    hook: (f, w, core) => { window = [w.sramEnable, w.sramBank & 0x0F, core.gb.mem.ramEnable, core.gb.mem.ramBank]; logEnd = w.sram[0x1FF0] | w.sram[0x1FF1] << 8; } });
  const sounds = r.sounds.core.filter(x => +x.split(":")[0] < r.frames).join(" ") === r.sounds.native.join(" ");
  const winOk = window && window[0] === window[2] && window[1] === window[3];
  const logOk = process.env.SWEEP_SHOTS || logEnd === 0xA000 + 4 * SHOTS;   // (the log pointer past all the shots)
  // (the frames: a shot each, one in GolfSceneStart, one after COMPLETE)
  const ok = !r.bad.length && !r.end.length && sounds && winOk && r.frames === SHOTS + 2 && logOk;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${c.name}: ${r.frames} frames, ${r.pixelExact} pixel-exact, ${r.modelExact} with the display state equal, ` +
    `${r.lag} differing after lag frames, ${r.bad.length} other; ${r.sounds.native.length} sounds ${sounds ? "the same" : "differ"}; ` +
    `the RAM window ${winOk ? "the same" : `differs: js ${window} game`}; the log to \$${logEnd.toString(16)}`);
  for (const b of r.bad.slice(0, 5)) console.log(`    frame ${b.frame}: ${b.px} px; ${b.out.join("; ")}`);
  for (const e of r.end) console.log(`    at the end: ${e}`);
}
process.exit(bad ? 1 : 0);
