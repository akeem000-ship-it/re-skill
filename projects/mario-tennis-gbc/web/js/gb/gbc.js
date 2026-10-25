// The machine: CPU + memory + PPU + APU + timer + joypad, stepped instruction by instruction with
// the hardware kept in sync (the PPU and APU run on the 4.19 MHz base clock, the CPU and timer at
// the CPU clock which doubles in CGB double-speed mode).
import { Memory, Timer, Joypad } from "./mem.js";
import { CPU } from "./cpu.js";
import { Registers } from "./registers.js";
import { PPU } from "./ppu.js";
import { APU } from "./apu.js";
import { Synth } from "./synth.js";
import { Display } from "./display.js";
import { Exec } from "./exec.js";

export class GBC {
  // cpu: false builds the machine without the instruction set (gb/registers.js): the JS port's hardware (port.js noCpu);
  // synth: the sound as gb/synth.js's synthesiser in place of apu.js's clocked channels; display: the picture drawn by
  // gb/display.js's renderer in place of ppu.js's
  constructor(romBytes, { sampleRate = 44100, audio = true, cpu = true, synth = false, display = false } = {}) {
    this.mem = new Memory(romBytes);
    this.cpu = cpu ? new CPU(this.mem) : new Registers(this.mem);
    this.ppu = display ? new Display(this.mem) : new PPU(this.mem); this.apu = synth ? new Synth(sampleRate) : new APU(sampleRate); this.timer = new Timer(this.mem); this.joypad = new Joypad(this.mem);
    this.mem.ppu = this.ppu; this.mem.apu = this.apu; this.mem.timer = this.timer; this.mem.joypad = this.joypad;
    this.mem.machine = this; this.exec = null;       // installRecomp(table) switches to the recompiled blocks
    this.audioOn = audio;
    this.reset();
  }
  reset() {
    this.cpu.reset();
    const m = this.mem; m.romBank = 1; m.updateRom(); m.ie = 0; m.iflag = 0xE1; m.doubleSpeed = false;
    // post-boot I/O state of the CGB boot ROM
    this.timer.div = 0x1E00 << 0; this.timer.tima = 0; this.timer.tma = 0; this.timer.setTac(0xF8);
    this.ppu.lcdc = 0x91; this.ppu.stat = 0x85; this.ppu.bgp = 0xFC;
    this.apu.write(0x26, 0x80); this.apu.write(0x25, 0xF3); this.apu.write(0x24, 0x77);
    this.apu.write(0x11, 0x80); this.apu.write(0x12, 0xF3); this.apu.write(0x14, 0xBF);
    this.frames = 0; this.cycles = 0;
  }
  setInput(state) { this.joypad.set(state); }
  installRecomp(table) { this.exec = new Exec(this, table); }
  // run one instruction and sync the hardware
  stepInstruction() {
    if (this.exec) { this.exec.step(); return; }
    if (!this.cpu.step) throw new Error("this machine has no CPU (built with cpu: false)");
    const cpuCycles = this.cpu.step();
    this.sync(cpuCycles);
  }
  sync(cpuCycles) {
    const m = this.mem, dots = m.doubleSpeed ? cpuCycles >> 1 : cpuCycles;
    this.timer.step(cpuCycles);
    const extra = this.ppu.step(dots);
    if (this.audioOn) this.apu.step(dots);
    if (extra) { this.timer.step(extra); this.ppu.step(m.doubleSpeed ? extra >> 1 : extra); }
    this.cycles += cpuCycles;
    if (m.serialPending) { m.serialPending = false; m.io[1] = 0xFF; m.io[2] &= 0x7F; m.requestInterrupt(8); }
  }
  // run until the next frame is complete (VBlank start)
  runFrame() {
    const ppu = this.ppu; ppu.frameDone = false;
    let guard = 0;
    while (!ppu.frameDone && guard++ < 2000000) {
      if (!(ppu.lcdc & 0x80)) {           // LCD off: no frames come; count 70224 dots as a frame
        let d = 0; while (d < 70224 && !(ppu.lcdc & 0x80)) { const c0 = this.cycles; this.stepInstruction(); const c = this.cycles - c0; d += this.mem.doubleSpeed ? c >> 1 : c; }
        if (!(ppu.lcdc & 0x80)) break;
        continue;
      }
      this.stepInstruction();
    }
    this.frames++;
  }
  frameHash() {                               // FNV-1a over the 5-bit RGB framebuffer
    const b = this.ppu.rgb5; let h = 0x811c9dc5;
    for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, "0");
  }
}
