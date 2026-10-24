// Game Boy Color memory map and MBC5 banking, with the I/O registers that are not owned by the
// PPU / APU / timer (those are dispatched to their modules). Used by the interpreter and by the
// statically recompiled code alike.
export class Memory {
  constructor(romBytes) {
    this.rom = romBytes;
    this.romBanks = Math.max(2, romBytes.length >> 14);
    const ramSizes = { 0: 0, 1: 0x800, 2: 0x2000, 3: 0x8000, 4: 0x20000, 5: 0x10000 };
    this.sram = new Uint8Array(ramSizes[romBytes[0x149]] || 0x8000);
    this.vram = [new Uint8Array(0x2000), new Uint8Array(0x2000)];
    this.wram = []; for (let i = 0; i < 8; i++) this.wram.push(new Uint8Array(0x1000));
    this.oam = new Uint8Array(0xA0);
    this.hram = new Uint8Array(0x7F);
    this.io = new Uint8Array(0x80);
    this.romBank = 1; this.ramBank = 0; this.ramEnable = false;
    this.vbk = 0; this.svbk = 1;
    this.ie = 0; this.iflag = 0xE1;
    this.key1 = 0; this.doubleSpeed = false;
    this.hdma = { src: 0, dst: 0, len: 0, active: false };
    this.ppu = null; this.apu = null; this.timer = null; this.joypad = null;
    this.romOffset = 0x4000;
    this.sramDirty = false;
    this.preR = 0; this.preW = 0;               // set per instruction by CPU.setAccessTiming
    this.machine = null;                // set by GBC: tick() syncs the hardware for the cycles in cpu.cyc
  }
  tick(c) { if (c.cyc) { const n = c.cyc; c.cyc = 0; this.machine.sync(n); } }
  // --- reads ---
  read(a) {
    if (a < 0x4000) return this.rom[a];
    if (a < 0x8000) return this.rom[this.romOffset + (a & 0x3FFF)];
    if (a < 0xA000) return this.vram[this.vbk][a & 0x1FFF];
    if (a < 0xC000) return this.ramEnable ? this.sram[((this.ramBank << 13) | (a & 0x1FFF)) % this.sram.length] : 0xFF;
    if (a < 0xD000) return this.wram[0][a & 0xFFF];
    if (a < 0xE000) return this.wram[this.svbk][a & 0xFFF];
    if (a < 0xFE00) return a < 0xF000 ? this.wram[0][a & 0xFFF] : this.wram[this.svbk][a & 0xFFF];
    if (a < 0xFEA0) return this.oam[a - 0xFE00];
    if (a < 0xFF00) return 0xFF;
    if (a < 0xFF80) return this.readIO(a & 0x7F);
    if (a < 0xFFFF) return this.hram[a - 0xFF80];
    return this.ie;
  }
  readIO(r) {
    if ((r >= 0x04 && r <= 0x07) || (r >= 0x10 && r <= 0x4B)) this.machine.catchUp(this.preR);
    if (r === 0x00) return this.joypad.read();
    if (r === 0x04) return this.timer.div >> 8;
    if (r === 0x05) return this.timer.tima;
    if (r === 0x06) return this.timer.tma;
    if (r === 0x07) return this.timer.tac | 0xF8;
    if (r === 0x0F) return this.iflag | 0xE0;
    if (r >= 0x10 && r <= 0x3F) return this.apu.read(r);
    if (r >= 0x40 && r <= 0x4B) return this.ppu.read(r);
    if (r === 0x4D) return (this.doubleSpeed ? 0x80 : 0) | (this.key1 & 1) | 0x7E;
    if (r === 0x4F) return this.vbk | 0xFE;
    if (r >= 0x51 && r <= 0x54) return 0xFF;
    if (r === 0x55) return (this.hdma.active ? 0 : 0x80) | ((this.hdma.len >> 4) - 1 & 0x7F);
    if (r >= 0x68 && r <= 0x6B) return this.ppu.read(r);
    if (r === 0x70) return this.svbk | 0xF8;
    return this.io[r] | 0;
  }
  // --- writes ---
  write(a, v) {
    v &= 0xFF;
    if (a < 0x8000) { this.writeMBC(a, v); return; }
    if (a < 0xA000) { this.vram[this.vbk][a & 0x1FFF] = v; return; }
    if (a < 0xC000) { if (this.ramEnable) { this.sram[((this.ramBank << 13) | (a & 0x1FFF)) % this.sram.length] = v; this.sramDirty = true; } return; }
    if (a < 0xD000) { this.wram[0][a & 0xFFF] = v; return; }
    if (a < 0xE000) { this.wram[this.svbk][a & 0xFFF] = v; return; }
    if (a < 0xFE00) { if (a < 0xF000) this.wram[0][a & 0xFFF] = v; else this.wram[this.svbk][a & 0xFFF] = v; return; }
    if (a < 0xFEA0) { this.oam[a - 0xFE00] = v; return; }
    if (a < 0xFF00) return;
    if (a < 0xFF80) { this.writeIO(a & 0x7F, v); return; }
    if (a < 0xFFFF) { this.hram[a - 0xFF80] = v; return; }
    this.ie = v;
  }
  writeMBC(a, v) {
    if (a < 0x2000) this.ramEnable = (v & 0x0F) === 0x0A;
    else if (a < 0x3000) { this.romBank = (this.romBank & 0x100) | v; this.updateRom(); }
    else if (a < 0x4000) { this.romBank = (this.romBank & 0xFF) | ((v & 1) << 8); this.updateRom(); }
    else if (a < 0x6000) this.ramBank = v & 0x0F;
  }
  updateRom() { this.romOffset = (this.romBank % this.romBanks) << 14; }
  writeIO(r, v) {
    if ((r >= 0x04 && r <= 0x07) || (r >= 0x10 && r <= 0x4B)) this.machine.catchUp(this.preW);
    switch (r) {
      case 0x00: this.joypad.write(v); return;
      case 0x01: this.io[1] = v; return;
      case 0x02: this.io[2] = v & 0x83; if (v & 0x80 && v & 1) { this.serialPending = true; } return;   // internal clock: transfer completes later
      case 0x04: this.timer.writeDiv(); return;
      case 0x05: this.timer.tima = v; return;
      case 0x06: this.timer.tma = v; return;
      case 0x07: this.timer.setTac(v); return;
      case 0x0F: this.iflag = v & 0x1F; return;
      case 0x46: this.oamDma(v); this.io[0x46] = v; return;
      case 0x4D: this.key1 = v & 1; return;
      case 0x4F: this.vbk = v & 1; return;
      case 0x51: this.hdma.src = (this.hdma.src & 0xFF) | (v << 8); return;
      case 0x52: this.hdma.src = (this.hdma.src & 0xFF00) | (v & 0xF0); return;
      case 0x53: this.hdma.dst = (this.hdma.dst & 0xFF) | ((v & 0x1F) << 8); return;
      case 0x54: this.hdma.dst = (this.hdma.dst & 0xFF00) | (v & 0xF0); return;
      case 0x55: this.startHdma(v); return;
      case 0x70: this.svbk = (v & 7) || 1; return;
    }
    if (r >= 0x10 && r <= 0x3F) { this.apu.write(r, v); return; }
    if ((r >= 0x40 && r <= 0x4B) || (r >= 0x68 && r <= 0x6B)) { this.ppu.write(r, v); return; }
    this.io[r] = v;
  }
  oamDma(page) {
    const base = page << 8;
    for (let i = 0; i < 0xA0; i++) this.oam[i] = this.read(base + i);
  }
  startHdma(v) {
    const len = ((v & 0x7F) + 1) << 4;
    if (!(v & 0x80)) {                      // general-purpose DMA: all at once
      if (this.hdma.active) { this.hdma.active = false; return; }   // writing without bit 7 stops an HBlank DMA
      this.hdmaCopy(len); this.hdma.len = 0; this.hdma.active = false;
    } else {
      this.hdma.len = len; this.hdma.active = true;
      // started inside an HBlank (or with the LCD off): the first block goes at once, as in PyBoy
      const p = this.ppu;
      if (!(p.lcdc & 0x80) || (p.mode === 0 && p.ly < 144)) this.hblankDma();
    }
  }
  hdmaCopy(n) {
    const vram = this.vram[this.vbk];
    for (let i = 0; i < n; i++) { vram[(this.hdma.dst + i) & 0x1FFF] = this.read(this.hdma.src + i); }
    this.hdma.src = (this.hdma.src + n) & 0xFFFF; this.hdma.dst = (this.hdma.dst + n) & 0x1FFF;
  }
  hblankDma() {                             // one 16-byte block per HBlank while active
    if (!this.hdma.active) return 0;
    this.hdmaCopy(16); this.hdma.len -= 16;
    if (this.hdma.len <= 0) { this.hdma.active = false; this.hdma.len = 0; }
    return 8;
  }
  requestInterrupt(bit) { this.iflag |= bit; }
  switchSpeed() { if (this.key1 & 1) { this.doubleSpeed = !this.doubleSpeed; this.key1 = 0; } }
}

export class Timer {
  // TIMA counts falling edges of a bit of the 16-bit divider (bit 9 / 3 / 5 / 7 for TAC 0-3), as on the hardware
  // and in PyBoy: a DIV write or a TAC change can make an extra tick (the edge glitch). On overflow TIMA reads 0
  // for 4 cycles, then is reloaded from TMA and the interrupt is raised (the hardware's one M-cycle delay).
  constructor(mem) { this.mem = mem; this.div = 0; this.tima = 0; this.tma = 0; this.tac = 0; this.period = 1024; this.reload = 0; }
  setTac(v) {
    const was = this.tac & 4 && this.div & (this.period >> 1);
    this.tac = v & 7; this.period = [1024, 16, 64, 256][v & 3];
    if (was && !(this.tac & 4 && this.div & (this.period >> 1))) this.tick(0);
  }
  writeDiv() { if (this.tac & 4 && this.div & (this.period >> 1)) this.tick(0); this.div = 0; }
  reloadNow() { this.reload = 0; this.tima = this.tma; this.mem.requestInterrupt(4); }
  tick(after) {                              // one TIMA increment; after = cycles already elapsed past the edge
    if (this.tima !== 0xFF) { this.tima++; return; }
    this.tima = 0;
    if (after >= 4) this.reloadNow(); else this.reload = 4 - after;
  }
  step(cycles) {                             // cycles at the CPU clock (4 MHz, or 8 MHz in double speed: both scale the same)
    const old = this.div, end = old + cycles;
    this.div = end & 0xFFFF;
    if (this.reload) { if (cycles >= this.reload) this.reloadNow(); else this.reload -= cycles; }
    if (!(this.tac & 4)) return;
    const p = this.period;
    for (let edge = (Math.floor(old / p) + 1) * p; edge <= end; edge += p) this.tick(end - edge);
  }
}

export class Joypad {
  constructor(mem) { this.mem = mem; this.select = 0x30; this.buttons = 0; this.dpad = 0; }   // bits: 1 = pressed
  set(state) {                              // state: {a,b,select,start,right,left,up,down}
    const b = (state.a ? 1 : 0) | (state.b ? 2 : 0) | (state.select ? 4 : 0) | (state.start ? 8 : 0);
    const d = (state.right ? 1 : 0) | (state.left ? 2 : 0) | (state.up ? 4 : 0) | (state.down ? 8 : 0);
    if ((b & ~this.buttons) || (d & ~this.dpad)) this.mem.requestInterrupt(16);
    this.buttons = b; this.dpad = d;
  }
  write(v) { this.select = v & 0x30; }
  read() {
    let low = 0x0F;
    if (!(this.select & 0x10)) low &= ~this.dpad;
    if (!(this.select & 0x20)) low &= ~this.buttons;
    return 0xC0 | this.select | (low & 0x0F);
  }
}
