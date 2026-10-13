// The ROM on the core's interpreter, stepped instruction by instruction with the same frame boundaries as the
// port (GamePort.tick: a VBlank start, or 70224 dots with the LCD off), the pad changing at boundaries as a
// recording plays, and its AdvanceFrame (00:2631) calls counted — the reference side of web/tests/port_lockstep.mjs.
export class CoreRunner {
  // pad(n): the pad state for the frame after boundary n; onBoundary(n, lcdOn) is called at each boundary
  constructor(gb, pad, onBoundary = null) {
    this.gb = gb; this.pad = pad; this.onBoundary = onBoundary;
    this.vblanks = 0; this.offDots = 0; this.advances = 0; this.counted = false;
    gb.setInput(pad(0));
  }
  step() {
    const gb = this.gb, c0 = gb.cycles;
    gb.stepInstruction();
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
}
