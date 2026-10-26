// The game from power-on (empty SRAM) through the title and the menus with a button script (as
// tools/emu_script.py: each press held 6 frames; default STROKE_HOLE1: Start, A, Right x4, A, A, A) to a stop
// point (default GolfRound 10:4451): every executed ROM address into a JSON file for tools/trace_routines.py, and
// optionally the core's state at the stop (for web/tests/golf/screenstep.mjs) or at the first time it reaches a
// routine (--save-at BB:AAAA --state out/state_X.json).
// usage: node web/tests/golf/boottrace.mjs out/trace_boot.json [--press F:BITS ...] [--stop BB:AAAA]
//        [--save-at BB:AAAA --state out/state_X.json] [--frames N] [--callers N] (the return addresses on the stack
//        at AdvanceFrame 00:2E3B every N frames)
import fs from "fs";
import path from "path";
import { GBC } from "../../js/gb/gbc.js";
import { saveState } from "../../js/gb/state.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const out = process.argv[2];
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const ba = s => s.split(":").map(v => parseInt(v, 16));
const NAMES = ["a", "b", "select", "start", "right", "left", "up", "down"];
let presses = { 3000: 8, 3300: 1, 3400: 0x10, 3430: 0x10, 3460: 0x10, 3490: 0x10, 3550: 1, 3800: 1, 4100: 1 };
const own = {};
for (let i = 0; i < process.argv.length; i++) if (process.argv[i] === "--press") { const [f, b] = process.argv[i + 1].split(":"); own[+f] = parseInt(b, 16); }
if (Object.keys(own).length) presses = own;
const [sb, sa] = ba(arg("--stop", "10:4451"));
const saveAt = arg("--save-at") ? ba(arg("--save-at")) : null;
const maxFrames = +arg("--frames", 20000);

const gb = new GBC(new Uint8Array(fs.readFileSync(path.join(root, "rom/mario_golf.gbc"))), { audio: false });
const cpu = gb.cpu, m = gb.mem, ppu = gb.ppu;
const seen = new Set();
let frame = 0;
const heldAt = f => { for (let k = 0; k < 6; k++) if (f - k in presses) return presses[f - k]; return 0; };
const at = (b, a) => cpu.pc === a && (a < 0x4000 || m.romBank === b);
let saved = false;
const every = +arg("--callers", 0);
let lastShown = -1;
for (;;) {
  const pc = cpu.pc;
  if (every && pc === 0x2E3B && frame % every === 0 && frame !== lastShown) {
    lastShown = frame;
    const st = [];
    for (let sp = cpu.sp, k = 0; k < 12 && sp < 0xE000; k++, sp += 2) st.push((m.read(sp) | m.read(sp + 1) << 8).toString(16));
    console.log(`frame ${frame} bank ${m.romBank.toString(16)}: ${st.join(" ")}`);
  }
  if (pc < 0x8000) seen.add((pc < 0x4000 ? 0 : m.romBank) * 0x10000 + pc);
  if (saveAt && !saved && at(...saveAt)) {
    fs.writeFileSync(path.join(root, arg("--state")), JSON.stringify({ at: saveAt, frame, state: saveState(gb) }));
    console.log(`saved the core at ${arg("--save-at")} (frame ${frame}) to ${arg("--state")}`);
    saved = true;
  }
  if (at(sb, sa)) break;
  ppu.frameDone = false;
  gb.stepInstruction();
  if (ppu.frameDone) {
    frame++;
    const b = heldAt(frame), st = {};
    NAMES.forEach((n, i) => { if (b >> i & 1) st[n] = true; });
    gb.setInput(st);
    if (frame > maxFrames) { console.log("stopped after", maxFrames, "frames"); break; }
  }
}
fs.writeFileSync(path.join(root, out), JSON.stringify([...seen].map(k => [k >> 16, k & 0xFFFF])));
console.log(`${seen.size} addresses in ${frame} frames -> ${out}`);
