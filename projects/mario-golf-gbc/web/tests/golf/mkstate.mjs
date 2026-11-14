// A core machine state at the entry of a routine, for web/tests/golf/screenstep.mjs: the recorded round is played in
// the lockstep (the native round beside the core) until the native round stops (or ends); the core then runs on
// alone (A on alternate frames) to the routine's entry, and its state is saved (out/ is not committed).
// usage: node web/tests/golf/mkstate.mjs --name match18 --at 0B:59DE --out out/state_result_match18.json [--holes N]
import fs from "fs";
import path from "path";
import { runLockstep } from "./lockstep.mjs";
import { initDisplay, displayFromCore } from "../../js/golf/render/display.js";
import { saveState } from "../../js/gb/state.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const name = arg("--name", "match18"), out = arg("--out"), holes = +arg("--holes", 18);
const [bank, addr] = arg("--at").split(":").map(v => parseInt(v, 16));
let core = null, saved = false;
const save = () => {
  fs.writeFileSync(path.join(root, out), JSON.stringify({ at: [bank, addr], state: saveState(core.gb) }));
  console.log(`saved the core at ${bank.toString(16)}:${addr.toString(16)} (frame ${core.frames}) to ${out}`);
  saved = true;
};
try {
  runLockstep({ name, holes,
    setup(w, c) {
      core = c; initDisplay(w); displayFromCore(w, c.gb);
      const orig = c.step.bind(c);
      c.step = () => { if (!saved && c.at(bank, addr)) { save(); throw new Error("saved"); } orig(); };
    } });
} catch (e) { if (!saved) console.log(`the lockstep stopped: ${e.message}`); }
if (!saved) {
  let t = 0;
  core.onFrame = () => core.setHeld((t ^= 1) ? 1 : 0);
  core.step = Object.getPrototypeOf(core).step.bind(core);
  core.runTo([[bank, addr]], 2_000_000_000);
  save();
}
