// The SM83's registers, interrupt state and stack, without its instruction set: what the JS port needs of a CPU
// (port.js, GamePort with noCpu: its calls pass registers and return addresses as the game's code did; no
// instruction is ever run). cpu.js's interpreter builds on it.
export class Registers {
  constructor(mem) {
    this.m = mem;
    this.a = 0; this.f = 0; this.b = 0; this.c = 0; this.d = 0; this.e = 0; this.h = 0; this.l = 0;
    this.sp = 0; this.pc = 0; this.ime = false; this.eiPending = false; this.halted = false; this.haltBug = false;
    this.stopped = false;
  }
  // post-boot register state of a CGB running a CGB-aware cartridge
  reset() {
    this.a = 0x11; this.f = 0x80; this.b = 0x00; this.c = 0x00; this.d = 0xFF; this.e = 0x56; this.h = 0x00; this.l = 0x0D;
    this.sp = 0xFFFE; this.pc = 0x0100; this.ime = false; this.eiPending = false; this.halted = false; this.stopped = false;
  }
  get hl() { return (this.h << 8) | this.l; } set hl(v) { this.h = (v >> 8) & 0xFF; this.l = v & 0xFF; }
  get bc() { return (this.b << 8) | this.c; } set bc(v) { this.b = (v >> 8) & 0xFF; this.c = v & 0xFF; }
  get de() { return (this.d << 8) | this.e; } set de(v) { this.d = (v >> 8) & 0xFF; this.e = v & 0xFF; }
  get af() { return (this.a << 8) | this.f; } set af(v) { this.a = (v >> 8) & 0xFF; this.f = v & 0xF0; }
  rd(a) { return this.m.read(a & 0xFFFF); }
  wr(a, v) { this.m.write(a & 0xFFFF, v); }
  push(v) { this.sp = (this.sp - 2) & 0xFFFF; this.wr(this.sp, v & 0xFF); this.wr(this.sp + 1, v >> 8); }
  pop() { const v = this.rd(this.sp) | (this.rd(this.sp + 1) << 8); this.sp = (this.sp + 2) & 0xFFFF; return v; }
}
