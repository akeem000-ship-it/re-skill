// The ROM on the core's interpreter, stepped instruction by instruction with the same frame boundaries as the
// port (GamePort.tick: a VBlank start, or 70224 dots with the LCD off), the pad changing at boundaries as a
// recording plays, and its AdvanceFrame (00:2631) calls counted — the reference side of web/tests/port_lockstep.mjs.
//
// It also watches where VBlanks come. One taken while the game's code is at work (not waiting in AdvanceFrame)
// changes what that code sees from that point: the pad, the random seed, counters — what the VBlank handler
// writes. Such a VBlank is placed by the first read after it of something a VBlank handler writes: "before the
// r-th read of address a in this window" (window: from one AdvanceFrame to the next). The port can then run its
// VBlank handler at the same point of its own work (web/tests/port_lockstep.mjs).
const VECTORS = new Set([0x40, 0x48, 0x50, 0x58, 0x60]);
const inAdvanceFrame = pc => pc >= 0x2631 && pc <= 0x2724;

export class CoreRunner {
  // pad(n): the pad state for the frame after boundary n; onBoundary(n, lcdOn) is called at each boundary
  constructor(gb, pad, onBoundary = null) {
    this.gb = gb; this.pad = pad; this.onBoundary = onBoundary;
    this.vblanks = 0; this.offDots = 0; this.advances = 0; this.counted = false;
    this.offBeat = -9;                       // the AdvanceFrame count at the last VBlank not taken in AdvanceFrame's wait
    this.handlers = [];                      // interrupt handlers running: {vector, ret, sp}
    this.vblankWrites = new Uint8Array(0x10000);   // addresses any VBlank handler has written
    this.window = 1; this.stamp = new Int32Array(0x10000); this.reads = new Int32Array(0x10000);
    this.workVBlanks = [];                   // this window's VBlanks taken mid-work: {a, r} (a = -1: no such read followed)
    this.pending = null;                     // a mid-work VBlank waiting for the next read to place it
    gb.setInput(pad(0));
    const m = gb.mem, read = m.read.bind(m), write = m.write.bind(m);
    m.read = a => {
      if (!this.handlers.length) {
        if (this.stamp[a] !== this.window) { this.stamp[a] = this.window; this.reads[a] = 0; }
        this.reads[a]++;
        // (not by the bank registers hRomBank/hWramBank: ported code reads them differently from the ROM)
        if (this.pending && this.vblankWrites[a] && a !== 0xFF95 && a !== 0xFF96) { this.pending.a = a; this.pending.r = this.reads[a]; this.pending = null; }
      }
      return read(a);
    };
    m.write = (a, v) => {
      const h = this.handlers[this.handlers.length - 1];
      if (h && h.vector === 0x40 && a >= 0xC000 && (a < 0xCF00 || a >= 0xD000) && a < 0xFFFF) this.vblankWrites[a] = 1;
      return write(a, v);
    };
  }
  step() {
    const gb = this.gb, cpu = gb.cpu, c0 = gb.cycles, pc0 = cpu.pc;
    const top = this.handlers[this.handlers.length - 1];
    if (top && pc0 === top.ret && cpu.sp === top.sp) this.handlers.pop();
    gb.stepInstruction();
    if (VECTORS.has(cpu.pc) && cpu.pc !== pc0) {                        // an interrupt taken
      const ret = gb.mem.read(cpu.sp) | gb.mem.read((cpu.sp + 1) & 0xFFFF) << 8;
      this.handlers.push({ vector: cpu.pc, ret, sp: (cpu.sp + 2) & 0xFFFF });
      if (cpu.pc === 0x40 && (ret < 0x2700 || ret > 0x2711)) {
        this.offBeat = this.advances;
        if (!inAdvanceFrame(ret) && this.handlers.length === 1) { const v = { a: -1, r: 0 }; this.workVBlanks.push(v); this.pending = v; }
      }
    }
    const ppu = gb.ppu, c = gb.cycles - c0;
    if (ppu.frameDone) ppu.frameDone = false;
    else if (ppu.lcdc & 0x80 || (this.offDots += gb.mem.doubleSpeed ? c >> 1 : c) < 70224) return;
    this.offDots = 0; this.vblanks++;
    gb.setInput(this.pad(this.vblanks));
    if (this.onBoundary) this.onBoundary(this.vblanks, !!(ppu.lcdc & 0x80));
  }
  // run until the ROM is about to run its k-th AdvanceFrame (false if maxBoundary boundaries pass first)
  runToAdvance(k, maxBoundary = Infinity) {
    const cpu = this.gb.cpu, m = this.gb.mem;
    for (;;) {
      if (this.advances >= k) return true;
      const willRun = cpu.pc === 0x2631 && !cpu.halted && !(cpu.ime && (m.iflag & m.ie & 0x1F));
      if (willRun && !this.counted) { this.counted = true; if (++this.advances >= k) return true; }
      if (this.vblanks >= maxBoundary) return false;
      this.step();
      if (willRun) this.counted = false;
    }
  }
  // start a new window (the harness, at each AdvanceFrame); returns the finished window's mid-work VBlanks
  newWindow() { const w = this.workVBlanks; this.workVBlanks = []; this.pending = null; this.window++; return w; }
}
