// GamePort: the readable port of the whole game. The game's code is JavaScript (web/js/port/*, web/js/engine/*);
// the Game Boy Color around it — memory map, PPU, APU, timer, DMA — is the emulator's hardware model
// (web/js/gb), driven without its CPU. So the port draws and plays through the same hardware the ROM uses, and a
// running port can be compared with the ROM byte for byte (web/tests/port_lockstep.mjs).
//
// Frames. The ROM's only frame barrier is AdvanceFrame (00:2631): it halts until the VBlank handler has run. Here
// every routine that (transitively) waits is a generator and the halt is `yield "halt"`. One frame():
//   1. dispatches the pending interrupts (at VBlank start: the VBlank handler) as the CPU would,
//   2. resumes the game's coroutine until it halts again (its whole frame of work runs at once),
//   3. runs the hardware to the next VBlank start, dispatching the raster (STAT) and timer handlers on time.
// The ROM's code takes CPU time and can overrun a frame ("lag"); ported code takes none. ROM code that halts the
// CPU (yield "cpuhalt") wakes on any interrupt, as on hardware: the frame goes on with it after each one.
//
// Not yet ported code. While the port is being written, a routine that has no JS yet runs as the ROM's own code
// on the emulator's CPU: `yield* P.runRom(bank, addr, regs)` (it may wait for frames: each halt is yielded) or
// `P.callRom(bank, addr, regs)` (must not wait). The other way round, ROM code reaching an address that has a JS
// port (P.hooks, filled from program.hooks) runs the JS instead and returns as if by `ret`. So the game runs
// whole at every stage of the port, and each part replaced is checked in place against the ROM.
import { GBC } from "../gb/gbc.js";
import { Rom } from "../rom.js";
import { Bus } from "./bus.js";
import { makeVars } from "./vars.js";
import { RomMath } from "../engine/math.js";
import { MatchEngine } from "../engine/engine.js";

export class SoftResetSignal extends Error { constructor() { super("SoftReset"); } }

const SENTINEL = 0xFFF0;                     // return address of a ROM call made by the port (an HRAM address no code runs)
const VECTORS = { 0x40: "vblank", 0x48: "lcdStat", 0x50: "timer", 0x58: "serial", 0x60: "joypad" };
const RETS = new Set([0xC9, 0xD9, 0xC0, 0xC8, 0xD0, 0xD8]);              // ret, reti, ret nz/z/nc/c
export const hookKey = (bank, addr) => (addr < 0x4000 ? addr : (bank << 16) | addr);

export class GamePort {
  // program: { main(P) -> generator (from EntryPoint), softReset(P) -> generator, vblank(P), lcdStat(P), timer(P),
  //            serial(P), hooks: [[bank, addr, fn(P, cpu) (may return a generator)], ...] }
  constructor(romBytes, program, { audio = false, sampleRate = 44100 } = {}) {
    this.gb = new GBC(romBytes, { audio, sampleRate });
    this.rom = new Rom(romBytes);
    this.bus = new Bus(this.gb);
    const { A, V, B } = makeVars(this.bus);
    this.A = A; this.V = V; this.B = B;                                   // RAM addresses, values, banks by name
    this.M = new RomMath(this.rom, this.bus);                             // the bank-0 math helpers (exact)
    this.E = new MatchEngine(this.rom, this.bus);                         // the match engine on this machine's RAM
    this.program = program;
    this.frames = 0;                                                     // frame() calls
    this.vblanks = 0;                                                    // frame boundaries passed (see tick)
    this.offDots = 0;
    this.advances = 0;                                                   // AdvanceFrame calls (atAdvanceFrame)
    this.offBeat = -9;                                                   // the AdvanceFrame count at the last VBlank taken mid-work
    this.lastRet = false;
    this.inHandler = 0;                                                  // interrupt handlers running (> 0: in a handler)
    this.cpuHandlers = [];                                               // handlers the CPU took: {vector, ret, sp} to see them return
    this.suppressVBlanks = 0;                                            // VBlanks whose handler injectVBlank already ran
    this.workVBlanks = 0;                                                // VBlanks the CPU took while ROM code was at work
    this.co = null;                                                      // the game's coroutine
    this.events = [];                                                    // optional notes for a page (sound ids etc.)
    this.hooks = new Map();
    for (const [bank, addr, fn] of program.hooks || []) this.hooks.set(hookKey(bank, addr), fn);
  }
  get mem() { return this.gb.mem; }
  get ppu() { return this.gb.ppu; }
  get cpu() { return this.gb.cpu; }
  get ime() { return this.gb.cpu.ime; }                                  // one interrupt master enable, shared with ROM code
  set ime(v) { this.gb.cpu.ime = v; this.gb.cpu.eiPending = false; }
  // the ROM's wram_bank macro: hWramBank and rSVBK; withWramBank is push_wram_bank ... pop_wram_bank around fn
  wramBank(b) { this.mem.write(0xFF96, b); this.mem.write(0xFF70, b); }
  withWramBank(b, fn) {
    const old = this.mem.read(0xFF96);
    this.wramBank(b);
    try { return fn(); } finally { this.wramBank(old); }
  }
  di() { this.ime = false; }
  ei() { this.ime = true; }
  setInput(state) { this.gb.setInput(state); }
  // ---- interrupts: the program's handlers, in the hardware's priority order ----
  dispatch() {
    const m = this.mem;
    for (let guard = 0; guard < 8; guard++) {
      const pending = m.iflag & m.ie & 0x1F;
      if (!pending || !this.ime) return;
      const bit = pending & -pending;
      m.iflag &= ~bit; this.ime = false;                                  // as on hardware: IF bit cleared, IME off during the handler
      this.cpu.halted = false;
      const vector = { 1: 0x40, 2: 0x48, 4: 0x50, 8: 0x58, 16: 0x60 }[bit];
      if (vector === 0x40 && this.suppressVBlanks > 0) { this.suppressVBlanks--; this.ime = true; continue; }   // already run (injectVBlank)
      if (!this.program[VECTORS[vector]]) { this.gb.sync(20); this.tick(20); }   // ROM handler: the CPU's 20-cycle entry
      this.inHandler++;
      try { this.handler(vector); } finally { this.inHandler--; }
      this.ime = true;                                                   // reti
    }
  }
  // The VBlank handler, now, as if its interrupt came (a test driver placing a frame the ROM's code overran at the
  // point of the work where the ROM took it); the hardware VBlank of that frame, when it comes, does not run it again.
  injectVBlank() {
    this.ime = false; this.inHandler++;
    try { this.handler(0x40); } finally { this.inHandler--; }
    this.ime = true; this.suppressVBlanks++;                             // (reti)
  }
  // run the handler of an interrupt vector: the program's JS, or the ROM's own handler
  handler(vector) {
    const h = this.program[VECTORS[vector]];
    if (h) h(this); else this.callRom(0, vector);
  }
  // ---- hardware time ----
  // Frame boundaries, as the core's runFrame() draws them: a VBlank start, or with the LCD off 70224 dots since
  // the last boundary. Called after every advance of the hardware; at a boundary a driver can change the pad
  // (onVBlank(n), as a recording plays). Returns true at a boundary.
  tick(cpuCycles) {
    const ppu = this.ppu;
    if (ppu.frameDone) ppu.frameDone = false;
    else if (ppu.lcdc & 0x80 || (this.offDots += this.mem.doubleSpeed ? cpuCycles >> 1 : cpuCycles) < 70224) return false;
    this.offDots = 0; this.vblanks++;
    if (this.onVBlank) this.onVBlank(this.vblanks);
    return true;
  }
  // run the hardware to the next frame boundary, dispatching interrupts as they are raised. wake: stop early,
  // after the first interrupt (the halted CPU wakes on it); returns true at the boundary
  runHardware(wake = false) {
    const gb = this.gb, m = this.mem, v0 = this.vblanks;
    for (;;) {
      gb.sync(4);
      this.tick(4);
      if (this.vblanks !== v0) break;
      if (m.iflag & m.ie & 0x1F) {
        if (m.iflag & m.ie & 0x1E) this.dispatch();                      // STAT / timer / serial / joypad mid-frame
        if (this.vblanks !== v0) break;                                  // (a ROM handler ran into the boundary)
        if (wake) return false;
      }
    }
    gb.frames++; this.frames++;
    return true;
  }
  // ---- ROM code that has no port yet ----
  // Run bank:addr on the CPU until it returns. Yields "halt" each time the CPU halts (waits for an interrupt): the
  // caller's frame loop then runs the hardware and the interrupt, and resuming wakes the CPU. Interrupts that come
  // while the CPU runs are taken by the CPU, through hooks to the program's handlers.
  *runRom(bank, addr, regs = {}) {
    const cpu = this.cpu, m = this.mem;
    const saved = this.enter(bank, addr, regs);
    for (;;) {
      if (cpu.sp === saved.sp && (cpu.pc === SENTINEL || this.lastRet)) break;   // returned (see returnedTo)
      if (cpu.halted && !(m.iflag & m.ie & 0x1F)) { yield "cpuhalt"; cpu.halted = false; continue; }
      const it = this.step();
      if (it) yield* it;
    }
    return this.leave(saved);
  }
  // the CPU from wherever it is, for ever (a port started from a saved state of the ROM)
  *continueCpu() {
    for (;;) {
      if (this.cpu.halted && !(this.mem.iflag & this.mem.ie & 0x1F)) { yield "cpuhalt"; this.cpu.halted = false; continue; }
      const it = this.step();
      if (it) yield* it;
    }
  }
  // the same for code that does not wait (throws if it halts)
  callRom(bank, addr, regs = {}) {
    const cpu = this.cpu;
    const saved = this.enter(bank, addr, regs);
    this.callDepth = (this.callDepth || 0) + 1;
    try { return this.callRomLoop(bank, addr, saved); } finally { this.callDepth--; }
  }
  callRomLoop(bank, addr, saved) {
    const cpu = this.cpu;
    for (let n = 0; ; n++) {
      if (cpu.sp === saved.sp && (cpu.pc === SENTINEL || this.lastRet)) break;
      if (cpu.halted && !(this.mem.iflag & this.mem.ie & 0x1F)) throw new Error(`callRom ${bank.toString(16)}:${addr.toString(16)} halted at ${cpu.pc.toString(16)}`);
      const it = this.step();
      if (it) { const r = it.next(); if (!r.done) throw new Error(`callRom ${bank.toString(16)}:${addr.toString(16)}: hook waited`); }
      if (n > 50_000_000) throw new Error(`callRom ${bank.toString(16)}:${addr.toString(16)} did not return`);
    }
    return this.leave(saved);
  }
  enter(bank, addr, regs) {
    const cpu = this.cpu, m = this.mem;
    const saved = { romBank: m.romBank, hRomBank: m.hram[0x15], sp: cpu.sp, pc: cpu.pc };   // pc: ROM code this call interrupted
    saved.banked = addr >= 0x4000 && addr < 0x8000;
    if (saved.banked) { m.romBank = bank; m.updateRom(); m.hram[0x15] = bank; }   // as FarCall: MBC and hRomBank (not for code in RAM)
    for (const [r, hi, lo] of [["bc", "b", "c"], ["de", "d", "e"], ["hl", "h", "l"]]) if (r in regs) { cpu[hi] = regs[r] >> 8 & 0xFF; cpu[lo] = regs[r] & 0xFF; }
    for (const r of ["a", "b", "c", "d", "e", "h", "l"]) if (r in regs) cpu[r] = regs[r] & 0xFF;
    if ("f" in regs) cpu.f = regs.f & 0xF0;
    if (!cpu.sp) cpu.sp = 0xCFFF;
    cpu.sp = (cpu.sp - 2) & 0xFFFF; m.write(cpu.sp, SENTINEL & 0xFF); m.write(cpu.sp + 1, SENTINEL >> 8);
    cpu.pc = addr;
    return saved;
  }
  leave(saved) {
    const cpu = this.cpu, m = this.mem;
    if (saved.banked) {                                                  // as FarCall's return: the caller's bank back
      if (saved.romBank !== m.romBank) { m.romBank = saved.romBank; m.updateRom(); }
      m.hram[0x15] = saved.hRomBank;
    }
    const out = { a: cpu.a, f: cpu.f, b: cpu.b, c: cpu.c, d: cpu.d, e: cpu.e, h: cpu.h, l: cpu.l, bc: cpu.bc, de: cpu.de, hl: cpu.hl };
    cpu.pc = saved.pc;
    return out;
  }
  // AdvanceFrame (00:2631), at its entry: where a driver that keeps the port in step with the ROM (the lockstep
  // test) lines the two up. onAdvance(k) returns how many frames the ROM's code overran before its k-th
  // AdvanceFrame; the port lets that many frames pass ("lag": the interrupts run, the game's code waits), then
  // calls afterAdvance(k). The ported AdvanceFrame starts with `yield* P.atAdvanceFrame()`.
  *atAdvanceFrame() {
    const k = ++this.advances;
    const lag = this.onAdvance ? this.onAdvance(k) : 0;
    for (let i = 0; i < lag; i++) yield "lag";
    if (this.afterAdvance) this.afterAdvance(k);
  }
  // one CPU step; at a hooked address run the JS instead (returns its generator if it waits)
  // lastRet: the step just returned from a routine (a ret/reti, or a hook's return). A ROM call made by the port
  // ends when a return brings sp back to where it was called from, whatever address that return popped: a test
  // driver may have copied the ROM's own stack over the port's sentinel (port_lockstep's resync).
  step() {
    const cpu = this.cpu, m = this.mem, pc = cpu.pc;
    this.lastRet = false;
    // ROM code run by callRom (which cannot wait) jumping to SoftReset (00:2582): the reset, as from a JS handler
    if (pc === 0x2582 && this.callDepth > 0) throw new SoftResetSignal();
    const top = this.cpuHandlers[this.cpuHandlers.length - 1];
    if (top && pc === top.ret && cpu.sp === top.sp) { this.cpuHandlers.pop(); this.inHandler--; }   // an interrupt handler the CPU took returned
    // the ROM's AdvanceFrame: the probe, once per call (when its first instruction is about to run, not an interrupt)
    const atAdvance = pc === 0x2631 && (this.onAdvance || this.afterAdvance) && !this.hooks.has(0x2631) && !(cpu.ime && (m.iflag & m.ie & 0x1F));
    if (atAdvance && !this.probed) { this.probed = true; return this.atAdvanceFrame(); }
    if (pc < 0x8000 && !(cpu.ime && (m.iflag & m.ie & 0x1F))) {          // (an interrupt due now comes first, as on the CPU)
      const fn = pc < 0x100 && VECTORS[pc] ? (this.program[VECTORS[pc]] ? "vector" : null) : this.hooks.get(hookKey(m.romBank, pc));
      if (fn === "vector") {                                             // the CPU took an interrupt: the program's handler, then reti
        if (this.cpuHandlers.length && this.cpuHandlers[this.cpuHandlers.length - 1].vector === pc) { this.cpuHandlers.pop(); this.inHandler--; }
        this.inHandler++;
        try { this.program[VECTORS[pc]](this); } finally { this.inHandler--; }
        this.ret(); this.ime = true; this.lastRet = true; return null;
      }
      if (fn) {
        const r = fn(this, cpu);
        if (r && typeof r.next === "function") return (function* (P) { yield* r; P.ret(); P.lastRet = true; })(this);
        this.ret(); this.lastRet = true; return null;
      }
    }
    const op = m.read(pc), c0 = this.gb.cycles;
    this.gb.stepInstruction();
    this.lastRet = RETS.has(op) && cpu.pc !== pc + 1;                    // (a conditional ret not taken goes on to pc + 1)
    if (atAdvance) this.probed = false;
    if (VECTORS[cpu.pc] && cpu.pc !== pc && cpu.pc < 0x68) {             // the CPU took an interrupt
      const ret = m.read(cpu.sp) | m.read((cpu.sp + 1) & 0xFFFF) << 8;
      if (cpu.pc === 0x40 && this.suppressVBlanks > 0) {                 // its handler already ran (injectVBlank): reti
        this.suppressVBlanks--; this.ret(); this.ime = true;
      } else {
        this.cpuHandlers.push({ vector: cpu.pc, ret, sp: (cpu.sp + 2) & 0xFFFF }); this.inHandler++;
        if (cpu.pc === 0x40 && (ret < 0x2700 || ret > 0x2711)) {        // a VBlank not in AdvanceFrame's wait: ROM code mid-work
          this.offBeat = this.advances;
          if (ret < 0x2631 || ret > 0x2724) this.workVBlanks++;
        }
      }
    }
    this.tick(this.gb.cycles - c0);
    return null;
  }
  ret() { const cpu = this.cpu, m = this.mem; cpu.pc = m.read(cpu.sp) | (m.read((cpu.sp + 1) & 0xFFFF) << 8); cpu.sp = (cpu.sp + 2) & 0xFFFF; }
  // ---- the game's coroutine ----
  start() { this.co = this.program.main(this); }
  resume() {
    if (!this.co) this.start();
    for (;;) {
      try {
        const r = this.co.next();
        if (r.done) throw new Error("the game's main program returned");
        return r.value;
      } catch (e) {
        if (!(e instanceof SoftResetSignal)) throw e;
        this.softReset();
      }
    }
  }
  softReset() { this.co = this.program.softReset ? this.program.softReset(this) : this.program.main(this); }
  // one frame of play: interrupts due now (the VBlank handler), the game's frame of work, the hardware's frame
  frame() {
    try { this.dispatch(); } catch (e) { if (!(e instanceof SoftResetSignal)) throw e; this.softReset(); }
    const hw = wake => { try { return this.runHardware(wake); } catch (e) { if (!(e instanceof SoftResetSignal)) throw e; this.softReset(); return true; } };
    for (;;) {
      const why = this.resume();
      if (why !== "cpuhalt") { hw(false); return; }
      if (hw(true)) return;                                              // the ROM's halted CPU: until it wakes
    }
  }
}
