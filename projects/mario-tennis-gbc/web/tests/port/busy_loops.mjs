// The home routines that spend CPU time (web/js/port/home/busy.js) against the ROM's loops, cycle for cycle: from
// identical machines (states from recordings, interrupts as the state has them, IME on), the routine run as the
// ROM's code on one port and through its hook on another (both with every other hook, so the interrupt handlers
// take the same time), then the whole machine, the registers, the CPU's cycle count and the frame boundaries
// passed compared. Each call starts at another point of the frame (the hardware run on first, IME off). The vector and entry jumps are covered by the lockstep (every interrupt goes through them).
// usage: node web/tests/port/busy_loops.mjs [--rec a.mtrec,b.mtrec] [--every K] [--max N]
import { loadRom } from "../engine/corpus.mjs";
import { portCorpus } from "./corpus.mjs";
import { applyMachine, diffMachines } from "./machine.mjs";
import { GamePort, hookKey } from "../../js/port/port.js";
import { program } from "../../js/port/program.js";

const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const recs = opt("--rec", "out/engine/rec1.mtrec,out/engine/exh1.mtrec,out/port/story1.mtrec").split(",");
const states = await portCorpus(recs, +opt("--every", 23), +opt("--max", 1e9));
const BUSY = [0x0346, 0x2821, 0x282E];
const rom = loadRom();
const withHooks = new GamePort(rom, program);
const romSide = new GamePort(rom, program);
for (const k of BUSY) romSide.hooks.delete(hookKey(0, k));
const H = (s, k) => { let h = Math.imul(s.f + 1, 0x9E3779B1) ^ Math.imul(k + 1, 0x85EBCA77); h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12; return h >>> 0; };
const CASES = [
  { name: "DisableLCDSafely", addr: 0x0346, n: states.length, prep: () => {} },
  { name: "ShortDelay", addr: 0x2821, n: states.length, prep: () => {} },
  // the serial wait: received at once, after some tries (a byte noted by a timer-driven poke is not possible
  // without a peer: hLinkTransferDone set before), or timed out (about 50 frames: fewer states)
  { name: "WaitSerialTransfer", addr: 0x282E, n: 24, prep: (m, s) => { m.hram[0x57] = H(s, 3) % 3 ? 1 : 0; } },
];
let bad = 0;
for (const C of CASES) {
  let tested = 0, fails = 0, shown = 0, waited = 0;
  for (const s of states.slice(0, C.n)) {
    const regs = { a: H(s, 1) & 0xFF, f: H(s, 2) & 0xF0, bc: H(s, 4) & 0xFFFF, de: H(s, 5) & 0xFFFF, hl: H(s, 6) & 0xFFFF };
    const run = P => {
      applyMachine(P.gb, s.m); P.cpu.halted = false; P.cpu.sp = 0xCFF0; P.cpuHandlers.length = 0; P.inHandler = 0;
      C.prep(P.gb.mem, s);
      for (let n = H(s, 7) % 70224 & ~3; n > 0; n -= 4) P.gb.sync(4);   // (from anywhere in the frame: the hardware run on first)
      P.ime = true;                                                 // (as the game calls them: interrupts on)
      const c0 = P.gb.cycles, v0 = P.vblanks;
      let out, err = null;
      try { out = P.callRom(0, C.addr, regs); } catch (e) { err = e.message; }
      return { out, err, cycles: P.gb.cycles - c0, vblanks: P.vblanks - v0 };
    };
    const r = run(romSide), p = run(withHooks);
    tested++; waited += r.cycles;
    const diffs = diffMachines(romSide.gb, withHooks.gb, { ignore: (b, ad) => b === 0 && ad >= 0xCF00 && ad < 0xD000 });
    if (r.err || p.err) diffs.push(["error", 0, 0, r.err, p.err]);
    else {
      for (const k of ["a", "f", "bc", "de", "hl"]) if (r.out[k] !== p.out[k]) diffs.push(["reg " + k, 0, 0, r.out[k], p.out[k]]);
      if (r.cycles !== p.cycles) diffs.push(["cycles", 0, 0, r.cycles, p.cycles]);
      if (r.vblanks !== p.vblanks) diffs.push(["frame boundaries", 0, 0, r.vblanks, p.vblanks]);
      if (romSide.cpu.ime !== withHooks.cpu.ime) diffs.push(["ime", 0, 0, romSide.cpu.ime, withHooks.cpu.ime]);
    }
    if (diffs.length) { fails++; if (shown++ < 3) console.log(`  ${C.name} ${s.rec}@${s.f}:`, diffs.slice(0, 6).map(d => d.join(" ")).join("; ")); }
  }
  if (fails) bad++;
  console.log(`${fails ? "FAIL" : "ok  "} ${C.name.padEnd(20)} ${fails}/${tested} (${(waited / Math.max(1, tested)) | 0} cycles a call on average)`);
}
process.exit(bad ? 1 : 0);
