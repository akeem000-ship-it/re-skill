// Whole-game lockstep: play a recording (.mtrec) on the core (the ROM on the CPU, web/tests/port/core_runner.mjs)
// and on the port (web/js/port: ported JS where there is some, the ROM's code elsewhere) from the recording's start,
// and compare the whole machine (WRAM, VRAM, OAM, HRAM, SRAM, palettes, LCD registers, banking) at every one of the
// game's frames — its AdvanceFrame calls — and every finished picture.
//
// Lining up. The k-th AdvanceFrame of the port is compared with the k-th of the ROM. Between AdvanceFrame k-1 and
// k ("window k") the ROM passes some frame boundaries (VBlanks, or LCD-off periods): normally one, more when its
// code overran a frame (lag). Ported code takes no time, so the port is given the same number of boundaries in
// its window k: the missing ones as lag frames at AdvanceFrame k (the interrupts run, the game's code waits). The
// port's j-th boundary of window k gets the pad the ROM had at its j-th boundary of window k, so the game's code
// sees the same input in the same game frame on both sides. The ROM runs one window ahead (its state at
// AdvanceFrame k is kept for the comparison) so its pads for the next window are known in time.
//
// Where the ROM's VBlank came in the middle of its frame's work, the port runs its VBlank handler at the same point
// of its work: before the access the ROM's code made first after it that the handler's order matters for, a read
// of something the handler writes or a write of something it reads (the r-th read or write of that address in the
// window, web/tests/port/core_runner.mjs). The hardware frame passes at AdvanceFrame
// as above, without running the handler again. So the work sees the new pad or random seed where the ROM's did.
// When such a VBlank came in AdvanceFrame's own work (its frame tasks), the ROM's wait can then take one frame more
// than the port's (its HALT sleeps to the next interrupt, which the port, at another time in the frame, may get
// earlier): the port is given the missing frames inside that wait (P.onFrameWaitEnd), before the code after
// AdvanceFrame looks at what the VBlank handler did.
//
// Timing. Where a VBlank came while the code was at work (lag, or inside AdvanceFrame before its wait), or the
// LCD was switched on or off (the timer runs the sound engine during loads, as often as the load takes time),
// the two can differ for a frame or two without anything being wrong: such differences are counted apart and
// the ROM's state is copied into the port to go on — as long as they are in what timing explains (the bytes an
// interrupt handler writes, the sprite pages and OAM, the palettes); other bytes that differ there count as
// differences. Differences only in the sound engine's state (WRAM 7 $D000-$D2FF) are counted apart and resynced
// too: it reads the APU's channel-on bits, which depend on the exact time it runs. If a timing event
// changes the course of the game (differences keep coming back after the resync), the comparison stops there
// and says so. If the port stops reaching AdvanceFrame where the ROM did (it passes many more frames in a window
// than the ROM: it went another way and runs on without coming back), the test stops and says so (FAIL).
// usage: node web/tests/port_lockstep.mjs [a.mtrec] [--frames N] [--show K] [--stop] [--resync]
//   --resync: after any difference, copy the ROM's state into the port and go on
//   --nocpu: the port on a machine without the CPU's instruction set (GamePort noCpu): any instruction it would run
//   fails the test, named;
//   --nocpu-count: run them on the core, and list them at the end (a survey)
//   --events: the hardware run from event to event (port.js nextEvent); --native: both, as the page plays
//   env HOOKS=home/joypad,audio/index: only these modules' hooks (web/js/port/<m>.js); NOHOOKS=1: none
import { readRecording, newCore, loadRom } from "./engine/corpus.mjs";
import { diffMachines } from "./port/machine.mjs";
import { CoreRunner, VRAM_KEY, WRAMX_KEY, KEYS, noteHandlerWrite } from "./port/core_runner.mjs";
import { loadState } from "../js/gb/state.js";
import { stateOf } from "../js/recorder.js";
import { GamePort } from "../js/port/port.js";
import { entry } from "../js/port/entry.js";

const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const vals = new Set(["--frames", "--show"]), pos = a.filter((x, i) => !x.startsWith("--") && !vals.has(a[i - 1]));
const recPath = pos[0] || "out/engine/exh1.mtrec", show = +opt("--show", 8), stop = a.includes("--stop"), resyncAll = a.includes("--resync");
const rec = readRecording(recPath), inputs = Buffer.from(rec.inputs, "base64");
const frames = Math.min(+opt("--frames", rec.frames), rec.frames);
if (rec.events.some(([, e]) => e === "reset")) console.log("note: the recording has resets (not replayed)");
const pad = n => stateOf(inputs[Math.min(n, rec.frames - 1)]);
// a picture as one hash per scanline (160 pixels a row in rgb5)
const rows = b => { const r = new Uint32Array(144); for (let y = 0; y < 144; y++) { let h = 0x811c9dc5; for (let i = y * 160; i < y * 160 + 160; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); } r[y] = h >>> 0; } return r; };
const rowsDiffer = (a, b) => { let n = 0; for (let y = 0; y < 144; y++) if (a[y] !== b[y]) n++; return n; };
let shown = 0;
const log = (...x) => { if (shown++ < show) console.log(...x); };

// ---- the reference: the ROM on the interpreter ----
const cg = await newCore({ recomp: false });
loadState(cg, rec.start);
const corePics = new Map();                  // ROM boundary n -> {rows: scanline hashes, raster: the STAT interrupt was on}
const timingFrames = new Set();              // ROM boundaries whose picture may differ by timing
let coreLcd = cg.ppu.lcdc >> 7;
const core = new CoreRunner(cg, pad, (n, on) => {
  if (+on !== coreLcd) { coreLcd = +on; for (let i = n - 2; i <= n + 3; i++) timingFrames.add(i); }
  if (on) corePics.set(n, { rows: rows(cg.ppu.rgb5), raster: !!(cg.mem.ie & 2) });
});
// what diffMachines compares, kept from the ROM at each AdvanceFrame
const snap = () => {
  const m = cg.mem, p = cg.ppu, c = cg.cpu;
  return {
    mem: { wram: m.wram.map(b => b.slice()), vram: m.vram.map(b => b.slice()), oam: m.oam.slice(), hram: m.hram.slice(), sram: m.sram.slice(),
      romBank: m.romBank, ramBank: m.ramBank, ramEnable: m.ramEnable, vbk: m.vbk, svbk: m.svbk, ie: m.ie },
    ppu: { bgPal: p.bgPal.slice(), objPal: p.objPal.slice(), lcdc: p.lcdc, scx: p.scx, scy: p.scy, wx: p.wx, wy: p.wy, bcps: p.bcps, ocps: p.ocps, lyc: p.lyc, bgp: p.bgp, obp0: p.obp0, obp1: p.obp1 },
    cpu: { a: c.a, f: c.f, b: c.b, c: c.c, d: c.d, e: c.e, h: c.h, l: c.l, sp: c.sp },
  };
};
// window k: the ROM's boundaries between its AdvanceFrame k-1 and k, its state at AdvanceFrame k, timing events
const win = new Map();
let coreAt = 0, coreEnded = false, lastLcd = cg.ppu.lcdc >> 7;
function coreTo(k) {                         // run the ROM to its k-th AdvanceFrame
  while (coreAt < k && !coreEnded) {
    const v0 = core.vblanks;
    if (!core.runToAdvance(coreAt + 1, frames)) { coreEnded = true; break; }
    coreAt++;
    const lcd = cg.ppu.lcdc >> 7, timing = core.offBeat >= coreAt - 1 || lcd !== lastLcd;
    lastLcd = lcd;
    const bounds = []; for (let n = v0 + 1; n <= core.vblanks; n++) bounds.push(n);
    const waitEnd = core.waitEndVBlanks >= v0 ? core.waitEndVBlanks - v0 : -1;   // boundaries before AdvanceFrame k-1's wait ended
    win.set(coreAt, { bounds, s: snap(), timing, vblanks: core.vblanks, waitEnd, workVBlanks: core.newWindow() });
    if (timing) for (let n = v0 - 1; n <= core.vblanks + 1; n++) timingFrames.add(n);
    if (cg.mem.hram[0x1E]) for (let n = v0; n <= core.vblanks + 1; n++) timingFrames.add(n);   // the debug overlay shows CPU time
  }
}

// ---- the port, from the same start (a mid-game save state: the CPU carries on from where it is) ----
let prog;
if (process.env.NOHOOKS) prog = { ...entry, hooks: [] };
else if (process.env.HOOKS) {
  const hooks = [];
  for (const m of process.env.HOOKS.split(",")) hooks.push(...(await import(`../js/port/${m}.js`)).HOOKS);
  prog = { ...entry, hooks };
} else prog = (await import("../js/port/program.js")).program;
const powerOn = rec.start.cpu.pc === 0x100;
const P = new GamePort(loadRom(), powerOn ? prog : { ...prog, *main(P) { yield* P.continueCpu(); } }, { noCpu: a.includes("--nocpu") || a.includes("--native"), events: a.includes("--events") || a.includes("--native") });
loadState(P.gb, rec.start);
if (a.includes("--nocpu-count")) P.trap = "count";
let portWin = 1, portIdx = 0;                // the port's window and the boundaries it has passed in it
const STALL_FRAMES = 300;                    // frames the port may pass in a window beyond the ROM's
const portPics = [];                         // [ROM boundary, scanline hashes]
P.setInput(pad(0));
class Stalled extends Error {}
P.onVBlank = () => {
  portIdx++;
  coreTo(portWin);
  const w = win.get(portWin);
  // the port no longer reaches its AdvanceFrames where the ROM did (it went another way): say so, don't run on
  if (w && portIdx > w.bounds.length + STALL_FRAMES)
    throw new Stalled(`the port passed ${portIdx} frames without reaching AdvanceFrame ${portWin} (the ROM ${w.bounds.length}); pc ${P.cpu.pc.toString(16)} sp ${P.cpu.sp.toString(16)}`);
  if (!w || !w.bounds.length) return;
  const n = w.bounds[Math.min(portIdx - 1, w.bounds.length - 1)];
  P.setInput(pad(n));
  if (P.ppu.lcdc & 0x80) portPics.push([n, rows(P.ppu.rgb5)]);
};

// the ROM's mid-work VBlanks of the port's current window: run the port's VBlank handler before its r-th read (or
// write, w) of a
let watch = [], watchAt = 0, watchReads = new Map(), watchWrites = new Map(), workAtStart = 0;
const watchAccess = (addr, w) => {
  if (watchAt >= watch.length || P.inHandler) return;
  const counts = w ? watchWrites : watchReads;
  if (!watch.some(x => x.a === addr && x.w === w)) return;
  const r = (counts.get(addr) || 0) + 1;
  counts.set(addr, r);
  const v = watch[watchAt];
  if (addr !== v.a || w !== v.w || r !== v.r) return;
  if (P.workVBlanks - workAtStart > watchAt) { watchAt++; return; }   // the port's own ROM code already took this VBlank
  const win_ = win.get(portWin);
  // the pad of the frame that VBlank began: its boundary's (v.n). Not simply the window's next boundary: a VBlank
  // taken in the previous AdvanceFrame's frame tasks is the window's first boundary, and its wait then ends
  // without another one (out/port/ss1_end7_1.mtrec, AdvanceFrame 724: a button pressed on that frame only)
  P.setInput(pad(v.n ?? win_.bounds[Math.min(watchAt + 1, win_.bounds.length - 1)]));
  watchAt++; injected++; injectedIn = portWin;
  P.injectVBlank();
};
const portRead = P.gb.mem.read.bind(P.gb.mem), portWrite = P.gb.mem.write.bind(P.gb.mem);
P.gb.mem.read = addr => { watchAccess(addr, false); return portRead(addr); };
const portHandlerWrites = new Uint8Array(KEYS);                     // bytes the port's interrupt handlers have written
P.gb.mem.write = (addr, v) => {
  if (P.inHandler) noteHandlerWrite(portHandlerWrites, P.mem, addr, v);
  watchAccess(addr, true);
  return portWrite(addr, v);
};
const startWatch = k => { const w = win.get(k); watch = w ? w.workVBlanks.filter(v => v.a >= 0) : []; watchAt = 0; watchReads = new Map(); watchWrites = new Map(); workAtStart = P.workVBlanks; };

// not compared: the stack page; the debug peak-LY readout and hPeakLY (CPU timing), and the readout's copy on the
// debug overlay ($9D08-$9D0B in VRAM bank 0) while the overlay is on (hDebugStepMode)
let debugOverlay = false;
const ignore = (bank, addr) => (bank === 0 && addr >= 0xCF00 && addr < 0xD000) || (bank === 0 && addr >= 0xC0FB && addr < 0xC100)
  || (bank === -2 && (addr === 0xFFA0 || addr === 0xFFA1)) || (debugOverlay && bank === 0x10 && addr >= 0x9D08 && addr < 0x9D0C);
const isSound = x => x[0] === "wram7" && x[2] < 0xD300;
// What a timing event explains: the bytes an interrupt handler writes (the ROM's or the port's, as far as the run
// has seen: a handler run at another time, or once more or less, leaves other values there), and in WRAM 0 and HRAM
// those the VBlank handler reads (queues it empties: the work had queued more or less when it ran), the sprite
// pages and OAM (the page shown flips at every AdvanceFrame), the palettes (written from the VBlank handler). Anything else that
// differs after a timing event is reported apart ("unexplained"): it is what the game's own code did differently.
const IO_OF = { lcdc: 0xFF40, scy: 0xFF42, scx: 0xFF43, lyc: 0xFF45, bgp: 0xFF47, obp0: 0xFF48, obp1: 0xFF49, wy: 0xFF4A, wx: 0xFF4B,
  bcps: 0xFF68, ocps: 0xFF6A, vbk: 0xFF4F, svbk: 0xFF70, ie: 0xFFFF };
const explained = x => {
  const [name, , addr] = x, hw = k => core.handlerWrites[k] || portHandlerWrites[k];
  if (name === "oam") return true;
  if (name === "wram0") return (addr >= 0xC000 && addr < 0xC0A0) || (addr >= 0xC500 && addr < 0xC5A0) || !!hw(addr) || !!core.vblankReads[addr];
  if (name.startsWith("wram")) return !!hw(WRAMX_KEY + +name[4] * 0x1000 + (addr - 0xD000));
  if (name.startsWith("vram")) return !!hw(VRAM_KEY + +name[4] * 0x2000 + (addr - 0x8000));
  if (name === "hram") return !!hw(addr) || !!core.vblankReads[addr];
  if (name === "bgPal") return !!hw(0xFF69);
  if (name === "objPal") return !!hw(0xFF6B);
  const r = name.split(".")[1];
  return r in IO_OF && !!hw(IO_OF[r]);
};
class Done extends Error {}
// The saved game timer: SaveGameTimer (00:2452) copies wGameTimer, which the VBlank handler counts (explained above),
// to wSavedGameTimer, and a story save then writes that into the slot's SRAM block (bank 0, mirrored in bank 1) with
// the block's checksum in the save header. After a timing event (the port behind or ahead on frames) the copy holds
// another count, and its SRAM image and the header's checksum bytes follow from it. Taken as timing only in a frame
// where wSavedGameTimer itself differs, and only SRAM bytes that are either a byte of each machine's own
// wSavedGameTimer (its image in the block) or in the save header (the first $800 bytes of banks 0 and 1).
const wSavedGameTimer = 0xC88E, SAVED_TIMER_SIZE = 4, SRAM_BANK_SIZE = 0x2000, SAVE_HEADER_END = 0x800;
function savedTimerUnexplained(unexplained, rom, port) {
  const isTimer = x => x[0] === "wram0" && x[2] >= wSavedGameTimer && x[2] < wSavedGameTimer + SAVED_TIMER_SIZE;
  if (!unexplained.some(isTimer)) return unexplained;
  const timerOf = m => m.mem.wram[0].slice(wSavedGameTimer - 0xC000, wSavedGameTimer - 0xC000 + SAVED_TIMER_SIZE);
  const rt = timerOf(rom), pt = timerOf(port);
  const image = x => { for (let j = 0; j < SAVED_TIMER_SIZE; j++) if (rt[j] !== pt[j] && x[3] === rt[j] && x[4] === pt[j]) return true; return false; };
  const sramOk = x => {
    const off = x[2] - 0xA000, bank = Math.floor(off / SRAM_BANK_SIZE), inBank = off % SRAM_BANK_SIZE;
    return image(x) || (bank <= 1 && inBank < SAVE_HEADER_END);
  };
  return unexplained.filter(x => !(isTimer(x) || (x[0] === "sram" && sramOk(x))));
}
let timingUnexplained = 0, courseChanged = null, lastResync = -99, lastResyncFrame = 0, suspect = [], suspectBad = 0, compared = 0, bad = 0, timingDiffs = 0, soundDiffs = 0, lags = 0, injected = 0, injectedIn = -9, portLate = 0, lastTiming = -9;
// The end of AdvanceFrame's wait (P.atFrameWaitEnd): the ROM's wait ended after more of the window's boundaries than
// the port's (a VBlank in the frame's work before the wait: the ROM's HALT then slept on to the next one, while the
// port's was woken by an interrupt that came, for the ROM, while it was still at work). Those frames pass inside
// the wait, as for the ROM: given at the next AdvanceFrame instead, they would come after the code that tests
// what the VBlank handler did (WaitFadeEnd's loop on hFadeState, say), and the game would go another way.
let waitLags = 0;
P.onFrameWaitEnd = () => {
  const w = win.get(portWin);
  const n = w && w.waitEnd > portIdx ? w.waitEnd - portIdx : 0;
  if (n) { waitLags += n; lags += n; lastTiming = portWin; if (process.env.LAGLOG) console.log(`advance ${portWin - 1}: its wait took ${w.waitEnd} frames in the ROM, ${portIdx} in the port`); }
  return n;
};
P.onAdvance = k => {
  coreTo(k + 1);                             // the ROM one window ahead: its pads for the port's next window
  const w = win.get(k);
  if (!w) throw new Done();
  const lag = w.bounds.length - portIdx;
  if (lag > 0) lags += lag; else if (lag < 0) portLate++;
  if (lag || w.timing || P.offBeat >= k - 1 || injectedIn === k) {
    lastTiming = k;
    for (let n = w.bounds[0] - 1; n <= w.bounds[w.bounds.length - 1] + 1; n++) timingFrames.add(n);
  }
  if (process.env.LAGLOG && lag) console.log(`advance ${k}: the ROM passed ${w.bounds.length} frames in the window, the port ${portIdx}`);
  return Math.max(0, lag);
};
const copyIn = s => {                        // the ROM's state at its AdvanceFrame k into the port
  const n = P.mem, sameStack = s.cpu.sp === P.cpu.sp, stack = n.wram[0].slice(0xF00, 0x1000);
  s.mem.wram.forEach((b, i) => n.wram[i].set(b)); n.vram.forEach((b, i) => b.set(s.mem.vram[i])); n.oam.set(s.mem.oam); n.hram.set(s.mem.hram); n.sram.set(s.mem.sram);
  if (sameStack) for (const r of ["a", "f", "b", "c", "d", "e", "h", "l"]) P.cpu[r] = s.cpu[r];   // the callers' state: stack and registers
  else n.wram[0].set(stack, 0xF00);
  P.ppu.bgPal.set(s.ppu.bgPal); P.ppu.objPal.set(s.ppu.objPal);
  for (const r of ["scx", "scy", "wx", "wy", "bcps", "ocps", "lyc", "bgp", "obp0", "obp1"]) P.ppu[r] = s.ppu[r];
  for (const r of ["ramBank", "ramEnable", "vbk", "svbk", "ie"]) n[r] = s.mem[r];
};
P.afterAdvance = k => {
  const w = win.get(k);
  portWin = k + 1; portIdx = 0; P.suppressVBlanks = 0;
  coreTo(k + 1); startWatch(k + 1);
  compared++;
  debugOverlay = w.s.mem.hram[0x1E] !== 0;                             // hDebugStepMode ($FF9E)
  const all = diffMachines(w.s, P.gb, { ignore, limit: 1 << 20 });
  win.delete(k - 2);
  if (!all.length) return;
  // while the raster split is on (the STAT interrupt), SCX at AdvanceFrame depends on where in the frame the code
  // got there: hScrollX before the band, wRasterScrollX inside it; the port's code takes no time
  const raster = !!(w.s.mem.ie & 2);
  const d = all.filter(x => !isSound(x) && !(raster && x[0] === "ppu.scx")), timing = k - lastTiming <= 2;
  // After a timing event, the differences a timing event explains (above) are timing; any others are what the
  // game's own code did differently, and count as differences (so a wrong write right after a lag frame doesn't
  // go unseen under the resync). Unless the game's course changed there (below): then they are part of it.
  const unexplained = timing ? savedTimerUnexplained(d.filter(x => !explained(x)), w.s, P.gb) : [];
  if (!d.length) soundDiffs++; else if (timing && !unexplained.length) timingDiffs++; else bad++;
  if (unexplained.length) {
    timingUnexplained++;
    log(`advance ${k} (ROM frame ${w.vblanks}, map ${w.s.mem.wram[0][0x32E]}) [timing, but ${unexplained.length} bytes timing doesn't explain]` +
      (w.s.cpu.sp !== P.cpu.sp ? ` [called from elsewhere: sp rom ${w.s.cpu.sp.toString(16)} port ${P.cpu.sp.toString(16)}]` : "") + ": " +
      unexplained.slice(0, 8).map(x => `${x[0]}${x[2] ? " $" + x[2].toString(16) : ""} rom=${x[3]} port=${x[4]}`).join(", "));
  }
  // the two at the same call depth (the same AdvanceFrame call site, as far as the stack tells): the ROM's state
  // can be copied in. At different depths the port is on another path; copying would only corrupt it.
  // The ROM's RAM is copied in after a timing event at any call depth (ported code that waits need not keep the
  // ROM's stack); the stack page and registers only at the same depth (copyIn). If the two went different ways,
  // differences come back after the resync (below), or the port fails soon after it (the main loop).
  if (d.length && timing) { lastResync = k; lastResyncFrame = w.vblanks; suspect = []; suspectBad = unexplained.length ? 1 : 0; }
  // The game went another way after a timing event (a button press seen a frame apart, say): copying the ROM's
  // RAM in doesn't bring the two back together, because their code is in different places. Seen as differences
  // that keep coming back, resynced each time, at 5 or more AdvanceFrames out of the 10 after the resync. The rest of the
  // recording can't be compared; stop there.
  if (d.length && !timing && k - lastResync <= 10) {
    suspect.push(k); suspectBad++;
    if (suspect.length >= 5) {
      bad -= suspectBad;
      courseChanged = `the game's course changed by timing after ROM frame ${lastResyncFrame} (AdvanceFrame ${lastResync}); compared up to there`;
      throw new Done();
    }
  }
  if (d.length && (!timing || process.env.LAGLOG))
    log(`advance ${k} (ROM frame ${w.vblanks}, map ${w.s.mem.wram[0][0x32E]})${timing ? " [timing]" : ""}` +
      (w.s.cpu.sp !== P.cpu.sp ? ` [called from elsewhere: sp rom ${w.s.cpu.sp.toString(16)} port ${P.cpu.sp.toString(16)}]` : "") + ": " + d.slice(0, 8).map(x => `${x[0]}${x[2] ? " $" + x[2].toString(16) : ""} rom=${x[3]} port=${x[4]}`).join(", "));
  if (stop && d.length && (!timing || unexplained.length)) throw new Done();
  if (!d.length || timing || resyncAll || suspect.includes(k)) copyIn(w.s);   // (suspects too: does it come back?)
};

coreTo(1); startWatch(1);
const t0 = Date.now();
let stalled = null;
try { while (P.vblanks < frames * 2 + 600 && !coreEnded) P.frame(); }
catch (e) {
  if (e instanceof Done) { /* the end, or stopped */ }
  else if (compared - lastResync <= 10 && lastResync > 0) {          // the port failed right after a resync: another path
    courseChanged = `the game's course changed by timing after ROM frame ${lastResyncFrame} (AdvanceFrame ${lastResync}): the port failed after the resync (${String(e.message).slice(0, 120)}); compared up to there`;
    bad -= suspectBad;
  } else if (e instanceof Stalled) { stalled = `FAIL: ${e.message}, after AdvanceFrame ${compared}`; bad++; }
  else throw e;
}
let picCompared = 0, picBad = 0, picTiming = 0;
for (const [n, h] of portPics) {
  if (!corePics.has(n)) continue;
  picCompared++;
  const c = corePics.get(n), lines = rowsDiffer(c.rows, h);
  if (!lines) continue;
  // scanlines off while the raster interrupt (STAT) splits the screen: its scroll writes land at other times,
  // because the code before them in the frame takes no time in the port
  // (the whole band can be a frame apart: the code that moves it ran before the band in the port, inside it in the
  // ROM; the RAM, compared at every AdvanceFrame, still catches a wrong band position)
  if (timingFrames.has(n) || c.raster) picTiming++;
  else { picBad++; log(`picture of ROM frame ${n} differs (${lines} scanlines)`); }
}
if (courseChanged) console.log(courseChanged);
if (P.trap) console.log(`NO CPU: ${P.trapped ? [...P.trapped].map(([k, n]) => `${(k >>> 16).toString(16)}:${(k & 0xFFFF).toString(16)} ×${n}`).join(", ") : "no instruction run on the CPU"}`);
if (stalled) console.log(stalled);
console.log(`${recPath}: ${core.vblanks} frames, ${compared} AdvanceFrames compared, ${bad} with RAM/state differences` +
  ` (${timingUnexplained} of them after a timing event; +${timingDiffs} timing, +${soundDiffs} sound timing only); ${picCompared} pictures compared, ${picBad} differ (+${picTiming} timing);` +
  ` ${lags} lag frames given to the port (${waitLags} in AdvanceFrame's wait, ${injected} VBlanks placed in its work)` + (portLate ? `, port late ${portLate}×` : "") + ` (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(bad || picBad ? 1 : 0);
