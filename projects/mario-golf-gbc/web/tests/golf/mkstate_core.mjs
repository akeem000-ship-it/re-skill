// A core machine state at a routine's entry, reached by the core alone from the round's start (out/
// round_entry_snap.json, CoreRun): A on alternate frames until the first `--via` point (bank:addr), then `--wait`
// frames, then the buttons `--press` (hex, held) until `--at`; the state is saved for web/tests/golf/screenstep.mjs.
// usage: node web/tests/golf/mkstate_core.mjs --via 10:5BA6 --wait 30 --press 08 --at 08:4666 --out out/state_pause.json
//        [--poke C834=02 ...] (WRAM0 bytes at the start)
import fs from "fs";
import path from "path";
import { CoreRun } from "./corerun.mjs";
import { saveState } from "../../js/gb/state.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const ba = s => s.split(":").map(v => parseInt(v, 16));
const core = new CoreRun();
for (let i = 0; i < process.argv.length; i++) if (process.argv[i] === "--poke") {
  const [a, v] = process.argv[i + 1].split("="); core.wram(0)[parseInt(a, 16) - 0xC000] = parseInt(v, 16);
}
let t = 0;
core.onFrame = () => core.setHeld((t ^= 1) ? 1 : 0);
if (arg("--via")) core.runTo([ba(arg("--via"))], 2_000_000_000);
let n = +arg("--wait", 0);
const bits = parseInt(arg("--press", "0"), 16);
core.onFrame = () => { if (n > 0) { n--; core.setHeld(0); } else core.setHeld(bits); };
const [bank, addr] = ba(arg("--at"));
core.runTo([[bank, addr]], 2_000_000_000);
core.onFrame = null;
fs.writeFileSync(path.join(root, arg("--out")), JSON.stringify({ at: [bank, addr], state: saveState(core.gb) }));
console.log(`saved the core at ${arg("--at")} (frame ${core.frames}) to ${arg("--out")}`);
