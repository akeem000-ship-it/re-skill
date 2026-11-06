// What of the ROM's code still runs under the whole-game port: play recordings on the port alone (web/js/port,
// program.js with every ported part) and count every instruction it runs on the CPU (not in a hook), by bank and
// address (code run from RAM counted too). The addresses are named by the routine that holds them (the vendored disassembly's symbols,
// third_party/mario-tennis-gbc-disasm/build/mariotennis.sym) and listed with the instructions run there.
// The port runs on its own (no reference ROM beside it), each recorded pad from its frame boundary on:
// where ported code takes less time than the ROM's a recording can go another way late on, so this is a survey of
// what is reached, not a test (port_lockstep.mjs is the test). A recording that starts from a saved state starts
// inside the ROM's code (the routines on its call stack run on as the ROM's until they return): that is counted
// apart, as left running by the saved state; what the port itself runs as ROM code (through a hook's call into the
// ROM, or anything in a recording from power on) is the list.
// usage: node web/tests/port_rom_trace.mjs [a.mtrec ...] [--dir out/port] [--frames N] [--out trace.json] [--top N]
//   with no recordings: every .mtrec in out/port and out/engine. --out keeps the counts (merged into the file
//   if it exists), so a long survey can be run in parts.
import fs from "fs";
import path from "path";
import { readRecording, loadRom } from "./engine/corpus.mjs";
import { loadState } from "../js/gb/state.js";
import { stateOf } from "../js/recorder.js";
import { GamePort } from "../js/port/port.js";
import { program } from "../js/port/program.js";

const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const vals = new Set(["--dir", "--frames", "--out", "--top"]);
let recs = a.filter((x, i) => !x.startsWith("--") && !vals.has(a[i - 1]));
if (!recs.length) for (const d of a.includes("--dir") ? [opt("--dir")] : ["out/port", "out/engine"])
  for (const f of fs.readdirSync(d).sort()) if (f.endsWith(".mtrec")) recs.push(path.join(d, f));
const maxFrames = +opt("--frames", 1e9), outPath = opt("--out", null), top = +opt("--top", 60);

// bank * 0x10000 + pc -> instructions run; and per routine the recordings that reached it
const counts = new Map(), carried = new Map(), seenIn = new Map();
if (outPath && fs.existsSync(outPath)) {
  const old = JSON.parse(fs.readFileSync(outPath, "utf8"));
  for (const [k, n] of old.counts) counts.set(k, n);
  for (const [k, n] of old.carried || []) carried.set(k, n);
  for (const [k, r] of old.seenIn) seenIn.set(k, new Set(r));
}
const sym = new Map();                                  // bank -> [[addr, name]] sorted, global labels only
for (const l of fs.readFileSync("third_party/mario-tennis-gbc-disasm/build/mariotennis.sym", "utf8").split("\n")) {
  const m = /^([0-9a-f]{2}):([0-9a-f]{4}) (\S+)/i.exec(l); if (!m || m[3].includes(".")) continue;
  const b = parseInt(m[1], 16), ad = parseInt(m[2], 16); if (ad >= 0x8000) continue;
  if (!sym.has(b)) sym.set(b, []); sym.get(b).push([ad, m[3]]);
}
for (const v of sym.values()) v.sort((x, y) => x[0] - y[0]);
const RAM = 0xFF;                                       // code run from RAM (bank RAM: VRAM, WRAM, HRAM)
const routineOf = k => {
  const b = k >> 16, pc = k & 0xFFFF, list = sym.get(b) || [];
  if (b === RAM) return `RAM ${pc >= 0xFF80 ? "HRAM" : pc >= 0xC000 ? "WRAM" : pc >= 0xA000 ? "SRAM" : "VRAM"}`;
  let lo = 0, hi = list.length - 1, best = null;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid][0] <= pc) { best = list[mid]; lo = mid + 1; } else hi = mid - 1; }
  return best ? `${b.toString(16).padStart(2, "0")}:${best[0].toString(16).padStart(4, "0")} ${best[1]}` : `${b.toString(16).padStart(2, "0")}:???? (no symbol)`;
};

const prog = program;
let totalFrames = 0, failed = 0;
for (const rp of recs) {
  let rec; try { rec = readRecording(rp); } catch (e) { console.log(`${rp}: cannot read (${e.message})`); continue; }
  const inputs = Buffer.from(rec.inputs, "base64"), frames = Math.min(rec.frames, maxFrames);
  const powerOn = rec.start.cpu.pc === 0x100;
  const P = new GamePort(loadRom(), powerOn ? prog : { ...prog, *main(Q) { yield* Q.continueCpu(); } });
  loadState(P.gb, rec.start);
  const gb = P.gb, cpu = P.cpu, mem = P.mem, step = gb.stepInstruction.bind(gb), name = path.basename(rp), here = new Set();
  // ROM code the port runs (a hook's call into the ROM: P.enter ... P.leave) or, before the first of those returns
  // to it, what the saved state was running when the recording began (its call stack: it runs on as the ROM's)
  let depth = 0;
  const enter = P.enter.bind(P), leave = P.leave.bind(P);
  P.enter = (...x) => { depth++; return enter(...x); };
  P.leave = (...x) => { depth--; return leave(...x); };
  gb.stepInstruction = () => {
    const pc = cpu.pc;
    // (not where the CPU takes an interrupt instead of the instruction)
    if (!cpu.halted && !(cpu.ime && (mem.iflag & mem.ie & 0x1F))) {
      const k = (pc < 0x4000 ? 0 : pc < 0x8000 ? mem.romBank : RAM) * 0x10000 + pc, into = depth || powerOn ? counts : carried;
      into.set(k, (into.get(k) || 0) + 1);
      if (into === counts) here.add(k);
    }
    return step();
  };
  // the pad by hardware frame (ROM code can run on through several frame boundaries in one P.frame())
  P.onVBlank = n => P.setInput(stateOf(inputs[Math.min(n, frames - 1)]));
  P.setInput(stateOf(inputs[0]));
  let f = 0;
  try { while (P.vblanks < frames) P.frame(); f = frames; }
  catch (e) { f = P.vblanks; failed++; console.log(`${name}: stopped at frame ${f}: ${e.message}`); }
  totalFrames += f;
  const rs = new Set([...here].map(routineOf));
  for (const r of rs) { if (!seenIn.has(r)) seenIn.set(r, new Set()); seenIn.get(r).add(name); }
  if (recs.length > 1) process.stdout.write(`${name} ${f} frames, ${rs.size} ROM routines\n`);
}
if (outPath) fs.writeFileSync(outPath, JSON.stringify({ counts: [...counts], carried: [...carried], seenIn: [...seenIn].map(([k, s]) => [k, [...s]]) }));

// the report: routines by instructions run
const byRoutine = new Map();
for (const [k, n] of counts) { const r = routineOf(k); const e = byRoutine.get(r) || { n: 0, pcs: 0, at: [] }; e.n += n; e.pcs++; e.at.push(k & 0xFFFF); byRoutine.set(r, e); }
const list = [...byRoutine].sort((x, y) => y[1].n - x[1].n);
console.log(`\n${recs.length} recordings, ${totalFrames} frames${failed ? `, ${failed} stopped early` : ""}: ${list.length} ROM routines still run, ${counts.size} addresses`);
for (const [r, e] of list.slice(0, top)) console.log(`${String(e.n).padStart(12)}  ${String(e.pcs).padStart(5)} addr  ${String((seenIn.get(r) || new Set()).size).padStart(4)} recs  ${r}${e.pcs <= 6 ? "  at " + e.at.sort((x, y) => x - y).map(x => x.toString(16)).join(" ") : ""}`);
if (list.length > top) console.log(`... and ${list.length - top} more (--top N)`);

// what the saved states were running when their recordings began (not the port's doing): by routine
const byCarried = new Map();
for (const [k, n] of carried) { const r = routineOf(k); byCarried.set(r, (byCarried.get(r) || 0) + n); }
if (byCarried.size) console.log(`\nleft running by the saved states (not called by the port): ${[...byCarried].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([r, n]) => `${r.split(" ")[1]} ${n}`).join(", ")}${byCarried.size > 12 ? ` and ${byCarried.size - 12} more` : ""}`);
