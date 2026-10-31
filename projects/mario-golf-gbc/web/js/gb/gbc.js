// The machine: CPU + memory + PPU + APU + timer + joypad, stepped instruction by instruction with
// the hardware kept in sync (the PPU and APU run on the 4.19 MHz base clock, the CPU and timer at
// the CPU clock which doubles in CGB double-speed mode).
import { Memory, Timer, Joypad } from "./mem.js";
import { CPU } from "./cpu.js";
import { PPU } from "./ppu.js";
import { APU } from "./apu.js";
import { Exec } from "./exec.js";

export class GBC {
  constructor(romBytes, { sampleRate = 44100, audio = true } = {}) {
    this.mem = new Memory(romBytes);
    this.cpu = new CPU(this.mem);
    this.ppu = new PPU(this.mem); this.apu = new APU(sampleRate); this.timer = new Timer(this.mem); this.joypad = new Joypad(this.mem);
    this.mem.ppu = this.ppu; this.mem.apu = this.apu; this.mem.timer = this.timer; this.mem.joypad = this.joypad;
    this.mem.machine = this; this.exec = null;       // installRecomp(table) switches to the recompiled blocks
    this.audioOn = audio;
    this.reset();
  }
  reset() {
    this.cpu.reset();
    const m = this.mem, c = this.cpu, p = this.ppu; m.romBank = 1; m.updateRom(); m.ie = 0; m.iflag = 0xE1; m.doubleSpeed = false;
    // the state PyBoy's CGB boot ROM hands over at $0100 (tools: read from a PyBoy state there), so a power-on run
    // matches PyBoy frame for frame: registers, the divider, and the LCD on line 145 (VBlank), 172 dots in
    c.a = 0x11; c.f = 0x80; c.b = 0x00; c.c = 0x00; c.d = 0x00; c.e = 0x08; c.h = 0x00; c.l = 0x7C;
    this.timer.div = 0xC71C;
    this.timer.tima = 0; this.timer.tma = 0; this.timer.tac = 0; this.timer.setTac(0xF8);
    p.lcdc = 0x91; p.bgp = 0xFC; p.ly = 145; p.dots = 172; p.mode = 1; p.stat = 0x81; p.windowLine = 0;
    m.hram[0x7C] = 0xB0;                                      // $FFFC, left by the boot ROM
    this.apu.write(0x26, 0x80); this.apu.write(0x25, 0xF3); this.apu.write(0x24, 0x77);
    this.apu.write(0x11, 0x80); this.apu.write(0x12, 0xF3); this.apu.write(0x14, 0xBF);
    this.frames = 0; this.cycles = 0; this.caught = 0;
    this.dots = 0; this.serialDue = 0;           // (the base-clock count and a linked transfer's end: link.js)
  }
  setInput(state) { this.joypad.set(state); }
  installRecomp(table) { this.exec = new Exec(this, table); }
  // run one instruction and sync the hardware
  stepInstruction() {
    if (this.exec) { this.exec.step(); return; }
    const cpuCycles = this.cpu.step();
    this.sync(cpuCycles);
  }
  sync(cpuCycles) {
    const n = cpuCycles - this.caught; this.caught = 0;   // part of the instruction may already be synced (catchUp)
    if (n > 0) this.advance(n);
    this.cycles += cpuCycles;
    const m = this.mem;
    if (m.serialPending) { m.serialPending = false; m.io[1] = 0xFF; m.io[2] &= 0x7F; m.requestInterrupt(8); }
    if (this.link) this.link.tick(this);
  }
  // a transfer started on the internal clock with a cable (link.js): it ends 8 bit times later in base clocks (the
  // CGB fast clock, SC bit 1: 16 per bit, else 512; halved in double speed)
  startSerial(v) {
    const bit = v & 2 ? 16 : 512;
    this.serialDue = this.dots + ((8 * bit) >> (this.mem.doubleSpeed ? 1 : 0));
  }
  // advance the timer, PPU and APU to `pre` cycles into the current instruction (before it accesses their registers)
  catchUp(pre) {
    const n = pre - this.caught;
    if (n > 0) { this.advance(n); this.caught = pre; }
  }
  // CPU cycles until the next PPU transition (mode / line / LCD-off frame) or timer tick, at least 4: how far a
  // halted CPU sleeps in one step, so it wakes exactly when an interrupt can be raised
  cyclesToEvent() {
    const p = this.ppu, t = this.timer, shift = this.mem.doubleSpeed ? 1 : 0;
    let d;
    if (!(p.lcdc & 0x80)) d = 70224 - p.offDots;
    else if (p.ly < 144) d = (p.mode === 2 ? 80 : p.mode === 3 ? 252 : 456) - p.dots;
    else d = (p.ly === 153 && p.firstFrame ? 464 : 456) - p.dots;
    let c = d << shift;
    if (this.link) {                             // (linked: wake for this side's or the partner's transfer end)
      const due = this.link.wakeAt(this);
      if (due) c = Math.min(c, Math.max(1, due - this.dots) << shift);
    }
    if (t.reload) c = Math.min(c, t.reload);
    else if (t.tac & 4) c = Math.min(c, t.period - (t.div % t.period));
    return Math.max(4, c);
  }
  advance(cpuCycles) {
    const m = this.mem, dots = m.doubleSpeed ? cpuCycles >> 1 : cpuCycles;
    this.dots += dots;
    this.timer.step(cpuCycles);
    const extra = this.ppu.step(dots);
    if (this.audioOn) this.apu.step(dots);
    if (extra) { this.timer.step(extra); this.ppu.step(m.doubleSpeed ? extra >> 1 : extra); this.dots += m.doubleSpeed ? extra >> 1 : extra; }
  }
  // run one frame: until the PPU marks the next frame start (line 153 -> 0, the LCD switched on, or 70224 dots
  // with the LCD off: PyBoy's frame boundaries, so per-frame inputs and screens line up with it)
  runFrame() {
    const ppu = this.ppu; ppu.frameDone = false; ppu.frameStart = false;
    let guard = 0;
    while (!ppu.frameStart && guard++ < 4000000) this.stepInstruction();
    this.frames++;
  }
  frameHash() {                               // FNV-1a over the 5-bit RGB framebuffer
    const b = this.ppu.rgb5; let h = 0x811c9dc5;
    for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, "0");
  }
}
