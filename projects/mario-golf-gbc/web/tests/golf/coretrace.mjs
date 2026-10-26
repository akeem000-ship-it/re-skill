// The ROM code a screen runs, from a core state at its entry (web/tests/golf/mkstate.mjs) to its return: every
// executed address as [bank, addr] (bank 0 for the home bank) into a JSON file for tools/trace_routines.py, which
// lists the routines with their sizes and whether the rewrite has them.
// usage: node web/tests/golf/coretrace.mjs out/state_X.json out/trace_X.json [--frames N] [--press F:BITS ...]
import fs from "fs";
import path from "path";
import { CoreRun } from "./corerun.mjs";
import { loadState } from "../../js/gb/state.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const [stateFile, outFile] = process.argv.slice(2);
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const maxFrames = +arg("--frames", 100000);
const presses = {};
for (let i = 0; i < process.argv.length; i++) if (process.argv[i] === "--press") { const [f, b] = process.argv[i + 1].split(":"); presses[+f] = parseInt(b, 16); }
const saved = JSON.parse(fs.readFileSync(path.join(root, stateFile)));
const core = new CoreRun();
loadState(core.gb, saved.state);
const gb = core.gb, cpu = gb.cpu, m = gb.mem;
const sp0 = cpu.sp, ret = m.read(sp0) | m.read(sp0 + 1) << 8, retBank = m.romBank;
const seen = new Set();
let frame = 0;
core.onFrame = () => { frame++; core.setHeld(frame in presses ? presses[frame] : Object.keys(presses).length ? 0 : (frame & 1)); };
for (;;) {
  const pc = cpu.pc;
  seen.add((pc < 0x4000 ? 0 : m.romBank) * 0x10000 + pc);
  core.step();
  if (cpu.pc === ret && cpu.sp === ((sp0 + 2) & 0xFFFF) && m.romBank === retBank) break;
  if (frame > maxFrames) { console.log("stopped after", maxFrames, "frames"); break; }
}
fs.writeFileSync(path.join(root, outFile), JSON.stringify([...seen].map(k => [k >> 16, k & 0xFFFF])));
console.log(`${seen.size} addresses in ${frame} frames -> ${outFile}`);
