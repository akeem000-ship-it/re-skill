// Routine-level check of the whole-game port: for whole-machine states taken from recordings (web/tests/port/
// corpus.mjs), call a routine at its ROM address on the core's interpreter (the ROM's code) and on a GamePort
// (where the address is hooked to the routine's JS port: program.hooks), from identical machines; then compare
// WRAM (all banks), VRAM (both banks), OAM, HRAM, SRAM, palettes, LCD registers, banking and the result registers.
// Routines that wait for frames are checked by web/tests/port_lockstep.mjs instead.
// usage: node web/tests/port_routines.mjs [routine filter] [--rec a.mtrec,b.mtrec] [--every K] [--max N] [--show M]
// A routine entry (web/tests/port/routines_*.mjs exporting ROUTINES):
//   { name, bank, addr, wram (WRAM bank to map; default the state's), regs(state) -> {a,b,c,d,e,h,l,f},
//     prep(mem, state) to force branches (run on both machines), when(state) to pick states,
//     out: registers to compare (e.g. ["a", "hl"]; "f" compares the Z and C flags), ignore(bank, addr) bytes to skip,
//     js(P, regs) optional: run the port some other way than through the hook at bank:addr }
import fs from "fs";
import { newCore, romObject, loadRom } from "./engine/corpus.mjs";
import { romCall } from "./engine/romcall.mjs";
import { portCorpus } from "./port/corpus.mjs";
import { applyMachine, diffMachines } from "./port/machine.mjs";
import { GamePort, hookKey } from "../js/port/port.js";
import { program } from "../js/port/program.js";

const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const vals = new Set(["--rec", "--every", "--max", "--show"]), pos = a.filter((x, i) => !x.startsWith("--") && !vals.has(a[i - 1]));
const filter = pos[0] || "", show = +opt("--show", 3);
const recs = opt("--rec", "out/engine/rec1.mtrec,out/engine/exh1.mtrec").split(",");
const states = await portCorpus(recs, +opt("--every", 23), +opt("--max", 1e9));
console.log(`${states.length} states`);
const ROUTINES = [];
for (const f of fs.readdirSync(new URL("./port/", import.meta.url)).filter(f => /^routines.*\.mjs$/.test(f)).sort())
  ROUTINES.push(...(await import(`./port/${f}`)).ROUTINES);

const core = await newCore({ recomp: false }), P = new GamePort(loadRom(), program);
// never compared: the stack page; which ROM bank is mapped (the port reads the ROM directly) and hRomBank
const baseIgnore = (bank, addr) => (bank === 0 && addr >= 0xCF00 && addr < 0xD000) || (bank === -2 && addr === 0xFF95);
let anyFail = false;
for (const R of ROUTINES) {
  if (filter && !R.name.includes(filter)) continue;
  let fails = 0, tested = 0; const shown = [], hits = new Map();
  for (const s of states) {
    if (R.when && !R.when(s)) continue;
    tested++;
    applyMachine(core, s.m); applyMachine(P.gb, s.m);
    const bank = R.wram ?? (s.m.mem.svbk || 1);
    core.mem.svbk = bank; P.gb.mem.svbk = bank;
    const regs = R.regs ? R.regs(s) : {};
    if (R.prep) { R.prep(core.mem, s); R.prep(P.gb.mem, s); }
    P.ime = core.cpu.ime; core.cpu.sp = 0xCFF0;
    let ret, err = null;
    if (!R.js && !P.hooks.has(hookKey(R.bank, R.addr))) { console.log(`FAIL ${R.name}: no port hooked at ${R.bank.toString(16)}:${R.addr.toString(16)}`); anyFail = true; break; }
    P.cpu.sp = 0xCFF0; P.cpu.halted = false;                         // (the states are taken in AdvanceFrame's halt; romCall clears it too)
    try { ret = R.js ? R.js(P, regs) : P.callRom(R.bank, R.addr, regs); } catch (e) { err = e; }
    const out = romCall(core, R.bank, R.addr, regs, { wramBank: bank });
    core.mem.romBank = P.gb.mem.romBank; core.mem.updateRom();
    const diffs = err ? [["exception", 0, 0, 0, String(err.message).slice(0, 300)]] : diffMachines(core, P.gb, { ignore: (b, ad) => baseIgnore(b, ad) || (R.ignore && R.ignore(b, ad)) });
    if (!err) for (const r of R.out || []) {
      const x = r === "f" ? out.f & 0x90 : out[r], y = r === "f" ? ret.f & 0x90 : ret[r];
      if (x !== y) diffs.push(["reg " + r, 0, 0, x, y]);
    }
    if (diffs.length) {
      fails++;
      for (const d of diffs) hits.set(d[0] + (d[2] ? ":" + d[2].toString(16) : ""), (hits.get(d[0] + (d[2] ? ":" + d[2].toString(16) : "")) || 0) + 1);
      if (shown.length < show) shown.push(`  ${s.rec}@${s.f}: ` + diffs.slice(0, 6).map(d => `${d[0]}${d[2] ? " $" + d[2].toString(16) : ""} rom=${d[3]} js=${d[4]}`).join(", "));
    }
  }
  if (fails) anyFail = true;
  console.log(`${fails ? "FAIL" : "ok  "} ${R.name.padEnd(34)} ${fails}/${tested}` + (fails ? "  " + [...hits].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => `${k}×${v}`).join(" ") : ""));
  for (const l of shown) console.log(l);
}
process.exit(anyFail ? 1 : 0);
