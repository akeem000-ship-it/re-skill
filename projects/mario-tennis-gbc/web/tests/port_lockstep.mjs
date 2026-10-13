// Whole-game lockstep: play a recording (.mtrec) on the core (the ROM on the CPU, web/tests/port/core_runner.mjs)
// and on the port (web/js/port: ported JS where there is some, the ROM's code elsewhere) from the recording's
// start, the pad changing at the same frame boundaries.
// The two are lined up on the game's own frames, its AdvanceFrame calls: before its k-th AdvanceFrame the port is
// given the frames the ROM's code overran by then (lag frames: the port's code takes no time), then the whole
// machine is compared (WRAM, VRAM, OAM, HRAM, SRAM, palettes, LCD registers, banking). Each finished picture is
// compared too (frame boundary n on both sides).
// usage: node web/tests/port_lockstep.mjs [a.mtrec] [--frames N] [--show K] [--stop] [--resync]
//   --resync: after a difference, copy the ROM's RAM into the port and go on (to see later, unrelated differences)
import { readRecording, newCore, loadRom } from "./engine/corpus.mjs";
import { diffMachines } from "./port/machine.mjs";
import { CoreRunner } from "./port/core_runner.mjs";
import { loadState } from "../js/gb/state.js";
import { stateOf } from "../js/recorder.js";
import { GamePort } from "../js/port/port.js";
import { program } from "../js/port/program.js";

const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const vals = new Set(["--frames", "--show"]), pos = a.filter((x, i) => !x.startsWith("--") && !vals.has(a[i - 1]));
const recPath = pos[0] || "out/engine/exh1.mtrec", show = +opt("--show", 8), stop = a.includes("--stop"), resync = a.includes("--resync");
const rec = readRecording(recPath), inputs = Buffer.from(rec.inputs, "base64");
const frames = Math.min(+opt("--frames", rec.frames), rec.frames);
if (rec.events.some(([, e]) => e === "reset")) console.log("note: the recording has resets (not replayed)");
const pad = n => stateOf(inputs[Math.min(n, rec.frames - 1)]);
const fnv = b => { let h = 0x811c9dc5; for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); } return h >>> 0; };

// the reference: the ROM on the interpreter
const cg = await newCore({ recomp: false });
loadState(cg, rec.start);
const corePics = new Map(), portPics = new Map();
let picBad = 0, picLag = 0, picCompared = 0;
const lagFrames = new Set();                                           // frames whose picture may differ by timing
const picMismatch = [];                                                // decided at the end, when every timing event is known
const pic = (mine, other, n) => {
  if (!other.has(n)) return;
  picCompared++;
  if (other.get(n) !== mine.get(n)) picMismatch.push(n);
  other.delete(n); mine.delete(n);
};
let coreLcd = 1;
const core = new CoreRunner(cg, pad, (n, on) => {
  if (+on !== coreLcd) { coreLcd = +on; for (let i = n - 2; i <= n + 3; i++) lagFrames.add(i); }   // the LCD switched: its first picture depends on timing
  if (on) { corePics.set(n, fnv(cg.ppu.rgb5)); pic(corePics, portPics, n); }
});

// the port, from the same start (a mid-game save state: the CPU carries on from where it is)
const powerOn = rec.start.cpu.pc === 0x100;
const prog = process.env.NOHOOKS ? { ...program, hooks: [] } : program;
const P = new GamePort(loadRom(), powerOn ? prog : { ...prog, *main(P) { yield* P.continueCpu(); } });
loadState(P.gb, rec.start);
P.setInput(pad(0));
// skew: frames the port has run more than the ROM (when ROM code run by the port overran a frame where the ROM did
// not); the port's frame n is the ROM's frame n - skew
let skew = 0;
P.onVBlank = n => { P.setInput(pad(n - skew)); if (P.ppu.lcdc & 0x80) { portPics.set(n - skew, fnv(P.ppu.rgb5)); pic(portPics, corePics, n - skew); } };

// not compared: the stack page (the port calls into the ROM through a sentinel return address); the debug
// peak-LY readout and hPeakLY (CPU timing)
const ignore = (bank, addr) => (bank === 0 && addr >= 0xCF00 && addr < 0xD000) || (bank === 0 && addr >= 0xC0FB && addr < 0xC100)
  || (bank === -2 && (addr === 0xFFA0 || addr === 0xFFA1));
class Done extends Error {}
// Lag. The ROM's code can overrun a frame; then a VBlank handler (pad, RNG, sound, fades, VRAM queues) runs in
// the middle of its work, where the port (given the lag frame at AdvanceFrame instead) runs it before the next
// AdvanceFrame. What that reorders can differ for a frame or two: differences within two AdvanceFrames of a lag
// (on either side), or of the LCD being switched on or off, are counted apart, and the ROM's state is copied into the port to go on.
const isSound = x => x[0] === "wram7" && x[2] < 0xD300;
let soundDiffs = 0, compared = 0, bad = 0, shown = 0, lagDiffs = 0, lags = 0, lastLag = -9, lastLcd = 1;
P.onAdvance = k => {
  if (!core.runToAdvance(k, frames)) throw new Done();
  let lag = core.vblanks - (P.vblanks - skew);
  if (lag < 0) { skew -= lag; P.setInput(pad(P.vblanks - skew)); }
  // an LCD-off stretch (a load) also counts: while the LCD is off the timer interrupt runs the sound engine, as
  // many times as the code takes time
  const lcd = cg.ppu.lcdc >> 7;
  if (lcd !== lastLcd) { lastLcd = lcd; lastLag = k; for (let n = core.vblanks - 3; n <= core.vblanks + 3; n++) lagFrames.add(n); }
  if (lag) { lastLag = k; for (let n = Math.min(core.vblanks, P.vblanks) - 1; n <= Math.max(core.vblanks, P.vblanks) + 3; n++) lagFrames.add(n); }
  if (lag > 0) lags += lag;
  if (lag && process.env.LAGLOG) console.log(`advance ${k}: rom at frame ${core.vblanks}, port at ${P.vblanks}`);
  return Math.max(0, lag);
};
const copyRam = () => {
  const m = cg.mem, n = P.mem;
  const stack = n.wram[0].slice(0xF00, 0x1000);                         // the port's own stack page stays
  m.wram.forEach((b, i) => n.wram[i].set(b)); n.wram[0].set(stack, 0xF00); n.vram.forEach((b, i) => b.set(m.vram[i])); n.oam.set(m.oam); n.hram.set(m.hram); n.sram.set(m.sram);
  P.ppu.bgPal.set(cg.ppu.bgPal); P.ppu.objPal.set(cg.ppu.objPal);
  for (const r of ["scx", "scy", "wx", "wy", "bcps", "ocps", "lyc", "bgp", "obp0", "obp1"]) P.ppu[r] = cg.ppu[r];
  for (const r of ["ramBank", "ramEnable", "vbk", "svbk", "ie"]) n[r] = m[r];
};
P.afterAdvance = k => {
  compared++;
  const all = diffMachines(cg, P.gb, { ignore, limit: 400 });
  if (!all.length) return;
  // the sound engine's state (WRAM 7 $D000-$D2FF) on its own: the engine reads the APU's channel-on bits, which
  // depend on the exact time it runs, and ported code takes no time. The audio port is checked by its routine tests.
  const d = all.filter(x => !isSound(x));
  if (!d.length) { soundDiffs++; copyRam(); return; }
  const explained = k - lastLag <= 2;
  if (explained) lagDiffs++; else bad++;
  if (shown < show && !explained || process.env.LAGLOG) { shown++; console.log(`advance ${k} (frame ${core.vblanks}, map ${cg.mem.wram[0][0x32E]})${explained ? " [after lag]" : ""}: ` + d.slice(0, 8).map(x => `${x[0]}${x[2] ? " $" + x[2].toString(16) : ""} rom=${x[3]} port=${x[4]}`).join(", ")); }
  if (stop && !explained) throw new Done();
  if (explained || resync) copyRam();
};
const t0 = Date.now();
try { for (;;) P.frame(); } catch (e) { if (!(e instanceof Done)) throw e; }
for (const n of picMismatch) { if (lagFrames.has(n)) picLag++; else { picBad++; if (shown < show) { shown++; console.log(`picture ${n} differs`); } } }
console.log(`${recPath}: ${core.vblanks} frames, ${compared} AdvanceFrames compared, ${bad} with RAM/state differences` +
  ` (+${lagDiffs} after lag, +${soundDiffs} in sound timing only); ${picCompared} pictures compared, ${picBad} differ (+${picLag} after lag); ${lags} lag frames given to the port` +
  ` (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(bad || picBad ? 1 : 0);
