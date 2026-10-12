// SM83 (Game Boy CPU) interpreter over gb/mem.js. step() executes one instruction (or services an
// interrupt) and returns the T-cycles it took. Flags: Z $80, N $40, H $20, C $10.
const Z = 0x80, N = 0x40, H = 0x20, C = 0x10;

export class CPU {
  constructor(mem) {
    this.m = mem;
    this.a = 0; this.f = 0; this.b = 0; this.c = 0; this.d = 0; this.e = 0; this.h = 0; this.l = 0;
    this.sp = 0; this.pc = 0; this.ime = false; this.eiPending = false; this.halted = false; this.haltBug = false;
    this.stopped = false;
    this.cyc = 0;                       // cycles accumulated by recompiled code since the last hardware sync
  }
  // Prologue of every instruction inside recompiled code (same order as step()): service a pending
  // interrupt (returns true: the block must stop, pc points at the handler), wake from halt, apply
  // the delayed EI. pc = address of the instruction about to run.
  irq(pc) {
    const m = this.m;
    // the frame completed, or the LCD is off (frames are then counted in cycles, one instruction at a
    // time): stop before anything else, exactly where runFrame() would stop the interpreter
    if (m.ppu.frameDone || !(m.ppu.lcdc & 0x80)) { this.pc = pc; return true; }
    const pending = m.iflag & m.ie & 0x1F;
    if (pending) {
      this.halted = false;
      if (this.ime) {
        this.ime = false; this.eiPending = false;
        for (let i = 0; i < 5; i++) if (pending & (1 << i)) { m.iflag &= ~(1 << i); this.push(pc); this.pc = 0x40 + 8 * i; this.cyc += 20; m.tick(this); return true; }
      }
    }
    if (this.halted) { this.pc = pc; return true; }
    if (this.eiPending) { this.eiPending = false; this.ime = true; }
    return false;
  }
  // CB-prefixed rotate/shift/res/set on a value (BIT is emitted inline): returns the new value
  cbval(op, v) {
    const bit = (op >> 3) & 7;
    if (op < 0x40) {
      const c = this.f & C ? 1 : 0; let res;
      switch (bit) {
        case 0: res = ((v << 1) | (v >> 7)) & 0xFF; this.f = (res === 0 ? Z : 0) | (v & 0x80 ? C : 0); break;
        case 1: res = (v >> 1) | ((v & 1) << 7); this.f = (res === 0 ? Z : 0) | (v & 1 ? C : 0); break;
        case 2: res = ((v << 1) | c) & 0xFF; this.f = (res === 0 ? Z : 0) | (v & 0x80 ? C : 0); break;
        case 3: res = (v >> 1) | (c << 7); this.f = (res === 0 ? Z : 0) | (v & 1 ? C : 0); break;
        case 4: res = (v << 1) & 0xFF; this.f = (res === 0 ? Z : 0) | (v & 0x80 ? C : 0); break;
        case 5: res = (v >> 1) | (v & 0x80); this.f = (res === 0 ? Z : 0) | (v & 1 ? C : 0); break;
        case 6: res = ((v << 4) | (v >> 4)) & 0xFF; this.f = res === 0 ? Z : 0; break;
        default: res = v >> 1; this.f = (res === 0 ? Z : 0) | (v & 1 ? C : 0); break;
      }
      return res;
    }
    return op < 0xC0 ? v & ~(1 << bit) : v | (1 << bit);
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
  fetch() { const v = this.m.read(this.pc); this.pc = (this.pc + 1) & 0xFFFF; return v; }
  fetch16() { const lo = this.fetch(); return lo | (this.fetch() << 8); }
  push(v) { this.sp = (this.sp - 2) & 0xFFFF; this.wr(this.sp, v & 0xFF); this.wr(this.sp + 1, v >> 8); }
  pop() { const v = this.rd(this.sp) | (this.rd(this.sp + 1) << 8); this.sp = (this.sp + 2) & 0xFFFF; return v; }

  step() {
    const m = this.m;
    // interrupts
    const pending = m.iflag & m.ie & 0x1F;
    if (pending) {
      this.halted = false;
      if (this.ime) {
        this.ime = false; this.eiPending = false;
        for (let i = 0; i < 5; i++) if (pending & (1 << i)) {
          m.iflag &= ~(1 << i);
          this.push(this.pc); this.pc = 0x40 + 8 * i;
          return 20;
        }
      }
    }
    if (this.halted) return 4;
    if (this.eiPending) { this.eiPending = false; this.ime = true; }
    const op = this.fetch();
    return this.exec(op);
  }

  // --- ALU helpers ---
  inc8(v) { const r = (v + 1) & 0xFF; this.f = (this.f & C) | (r === 0 ? Z : 0) | ((v & 0xF) === 0xF ? H : 0); return r; }
  dec8(v) { const r = (v - 1) & 0xFF; this.f = (this.f & C) | N | (r === 0 ? Z : 0) | ((v & 0xF) === 0 ? H : 0); return r; }
  add(v, carry = 0) { const a = this.a, r = a + v + carry; this.f = ((r & 0xFF) === 0 ? Z : 0) | (((a & 0xF) + (v & 0xF) + carry) > 0xF ? H : 0) | (r > 0xFF ? C : 0); this.a = r & 0xFF; }
  sub(v, carry = 0) { const a = this.a, r = a - v - carry; this.f = N | ((r & 0xFF) === 0 ? Z : 0) | (((a & 0xF) - (v & 0xF) - carry) < 0 ? H : 0) | (r < 0 ? C : 0); this.a = r & 0xFF; }
  cp(v) { const a = this.a, r = a - v; this.f = N | ((r & 0xFF) === 0 ? Z : 0) | (((a & 0xF) - (v & 0xF)) < 0 ? H : 0) | (r < 0 ? C : 0); }
  and(v) { this.a &= v; this.f = (this.a === 0 ? Z : 0) | H; }
  or(v) { this.a |= v; this.f = this.a === 0 ? Z : 0; }
  xor(v) { this.a ^= v; this.f = this.a === 0 ? Z : 0; }
  addHL(v) { const hl = this.hl, r = hl + v; this.f = (this.f & Z) | (((hl & 0xFFF) + (v & 0xFFF)) > 0xFFF ? H : 0) | (r > 0xFFFF ? C : 0); this.hl = r & 0xFFFF; }
  addSP(d) { const sp = this.sp, r = (sp + d) & 0xFFFF; this.f = (((sp & 0xF) + (d & 0xF)) > 0xF ? H : 0) | (((sp & 0xFF) + (d & 0xFF)) > 0xFF ? C : 0); return r; }
  jr(cond) { const d = this.fetch(); if (cond) { this.pc = (this.pc + (d << 24 >> 24)) & 0xFFFF; return 12; } return 8; }
  jp(cond) { const a = this.fetch16(); if (cond) { this.pc = a; return 16; } return 12; }
  call(cond) { const a = this.fetch16(); if (cond) { this.push(this.pc); this.pc = a; return 24; } return 12; }
  ret(cond) { if (cond) { this.pc = this.pop(); return 20; } return 8; }
  getR(i) { switch (i) { case 0: return this.b; case 1: return this.c; case 2: return this.d; case 3: return this.e; case 4: return this.h; case 5: return this.l; case 6: return this.rd(this.hl); default: return this.a; } }
  setR(i, v) { switch (i) { case 0: this.b = v; break; case 1: this.c = v; break; case 2: this.d = v; break; case 3: this.e = v; break; case 4: this.h = v; break; case 5: this.l = v; break; case 6: this.wr(this.hl, v); break; default: this.a = v; } }

  exec(op) {
    switch (op) {
      case 0x00: return 4;
      case 0x01: this.bc = this.fetch16(); return 12;
      case 0x02: this.wr(this.bc, this.a); return 8;
      case 0x03: this.bc = (this.bc + 1) & 0xFFFF; return 8;
      case 0x04: this.b = this.inc8(this.b); return 4;
      case 0x05: this.b = this.dec8(this.b); return 4;
      case 0x06: this.b = this.fetch(); return 8;
      case 0x07: { const c = this.a >> 7; this.a = ((this.a << 1) | c) & 0xFF; this.f = c ? C : 0; return 4; }
      case 0x08: { const a = this.fetch16(); this.wr(a, this.sp & 0xFF); this.wr(a + 1, this.sp >> 8); return 20; }
      case 0x09: this.addHL(this.bc); return 8;
      case 0x0A: this.a = this.rd(this.bc); return 8;
      case 0x0B: this.bc = (this.bc - 1) & 0xFFFF; return 8;
      case 0x0C: this.c = this.inc8(this.c); return 4;
      case 0x0D: this.c = this.dec8(this.c); return 4;
      case 0x0E: this.c = this.fetch(); return 8;
      case 0x0F: { const c = this.a & 1; this.a = (this.a >> 1) | (c << 7); this.f = c ? C : 0; return 4; }
      case 0x10: this.fetch(); this.m.switchSpeed(); return 4;      // STOP: only used for the speed switch
      case 0x11: this.de = this.fetch16(); return 12;
      case 0x12: this.wr(this.de, this.a); return 8;
      case 0x13: this.de = (this.de + 1) & 0xFFFF; return 8;
      case 0x14: this.d = this.inc8(this.d); return 4;
      case 0x15: this.d = this.dec8(this.d); return 4;
      case 0x16: this.d = this.fetch(); return 8;
      case 0x17: { const c = this.a >> 7; this.a = ((this.a << 1) | (this.f & C ? 1 : 0)) & 0xFF; this.f = c ? C : 0; return 4; }
      case 0x18: return this.jr(true);
      case 0x19: this.addHL(this.de); return 8;
      case 0x1A: this.a = this.rd(this.de); return 8;
      case 0x1B: this.de = (this.de - 1) & 0xFFFF; return 8;
      case 0x1C: this.e = this.inc8(this.e); return 4;
      case 0x1D: this.e = this.dec8(this.e); return 4;
      case 0x1E: this.e = this.fetch(); return 8;
      case 0x1F: { const c = this.a & 1; this.a = (this.a >> 1) | (this.f & C ? 0x80 : 0); this.f = c ? C : 0; return 4; }
      case 0x20: return this.jr(!(this.f & Z));
      case 0x21: this.hl = this.fetch16(); return 12;
      case 0x22: this.wr(this.hl, this.a); this.hl = (this.hl + 1) & 0xFFFF; return 8;
      case 0x23: this.hl = (this.hl + 1) & 0xFFFF; return 8;
      case 0x24: this.h = this.inc8(this.h); return 4;
      case 0x25: this.h = this.dec8(this.h); return 4;
      case 0x26: this.h = this.fetch(); return 8;
      case 0x27: {                                                  // DAA
        let a = this.a, adj = 0, c = this.f & C;
        if (this.f & H || (!(this.f & N) && (a & 0xF) > 9)) adj |= 6;
        if (c || (!(this.f & N) && a > 0x99)) { adj |= 0x60; c = C; }
        a = this.f & N ? a - adj : a + adj; a &= 0xFF;
        this.f = (this.f & N) | (a === 0 ? Z : 0) | c; this.a = a; return 4;
      }
      case 0x28: return this.jr(!!(this.f & Z));
      case 0x29: this.addHL(this.hl); return 8;
      case 0x2A: this.a = this.rd(this.hl); this.hl = (this.hl + 1) & 0xFFFF; return 8;
      case 0x2B: this.hl = (this.hl - 1) & 0xFFFF; return 8;
      case 0x2C: this.l = this.inc8(this.l); return 4;
      case 0x2D: this.l = this.dec8(this.l); return 4;
      case 0x2E: this.l = this.fetch(); return 8;
      case 0x2F: this.a ^= 0xFF; this.f |= N | H; return 4;
      case 0x30: return this.jr(!(this.f & C));
      case 0x31: this.sp = this.fetch16(); return 12;
      case 0x32: this.wr(this.hl, this.a); this.hl = (this.hl - 1) & 0xFFFF; return 8;
      case 0x33: this.sp = (this.sp + 1) & 0xFFFF; return 8;
      case 0x34: this.wr(this.hl, this.inc8(this.rd(this.hl))); return 12;
      case 0x35: this.wr(this.hl, this.dec8(this.rd(this.hl))); return 12;
      case 0x36: this.wr(this.hl, this.fetch()); return 12;
      case 0x37: this.f = (this.f & Z) | C; return 4;
      case 0x38: return this.jr(!!(this.f & C));
      case 0x39: this.addHL(this.sp); return 8;
      case 0x3A: this.a = this.rd(this.hl); this.hl = (this.hl - 1) & 0xFFFF; return 8;
      case 0x3B: this.sp = (this.sp - 1) & 0xFFFF; return 8;
      case 0x3C: this.a = this.inc8(this.a); return 4;
      case 0x3D: this.a = this.dec8(this.a); return 4;
      case 0x3E: this.a = this.fetch(); return 8;
      case 0x3F: this.f = (this.f & Z) | ((this.f & C) ^ C); return 4;
      case 0x76: this.halted = true; return 4;
      case 0xC0: return this.ret(!(this.f & Z));
      case 0xC1: this.bc = this.pop(); return 12;
      case 0xC2: return this.jp(!(this.f & Z));
      case 0xC3: this.pc = this.fetch16(); return 16;
      case 0xC4: return this.call(!(this.f & Z));
      case 0xC5: this.push(this.bc); return 16;
      case 0xC6: this.add(this.fetch()); return 8;
      case 0xC8: return this.ret(!!(this.f & Z));
      case 0xC9: this.pc = this.pop(); return 16;
      case 0xCA: return this.jp(!!(this.f & Z));
      case 0xCB: return this.execCB(this.fetch());
      case 0xCC: return this.call(!!(this.f & Z));
      case 0xCD: return this.call(true);
      case 0xCE: this.add(this.fetch(), this.f & C ? 1 : 0); return 8;
      case 0xD0: return this.ret(!(this.f & C));
      case 0xD1: this.de = this.pop(); return 12;
      case 0xD2: return this.jp(!(this.f & C));
      case 0xD4: return this.call(!(this.f & C));
      case 0xD5: this.push(this.de); return 16;
      case 0xD6: this.sub(this.fetch()); return 8;
      case 0xD8: return this.ret(!!(this.f & C));
      case 0xD9: this.pc = this.pop(); this.ime = true; return 16;
      case 0xDA: return this.jp(!!(this.f & C));
      case 0xDC: return this.call(!!(this.f & C));
      case 0xDE: this.sub(this.fetch(), this.f & C ? 1 : 0); return 8;
      case 0xE0: this.wr(0xFF00 | this.fetch(), this.a); return 12;
      case 0xE1: this.hl = this.pop(); return 12;
      case 0xE2: this.wr(0xFF00 | this.c, this.a); return 8;
      case 0xE5: this.push(this.hl); return 16;
      case 0xE6: this.and(this.fetch()); return 8;
      case 0xE8: this.sp = this.addSP(this.fetch() << 24 >> 24); return 16;
      case 0xE9: this.pc = this.hl; return 4;
      case 0xEA: this.wr(this.fetch16(), this.a); return 16;
      case 0xEE: this.xor(this.fetch()); return 8;
      case 0xF0: this.a = this.rd(0xFF00 | this.fetch()); return 12;
      case 0xF1: this.af = this.pop(); return 12;
      case 0xF2: this.a = this.rd(0xFF00 | this.c); return 8;
      case 0xF3: this.ime = false; this.eiPending = false; return 4;
      case 0xF5: this.push(this.af); return 16;
      case 0xF6: this.or(this.fetch()); return 8;
      case 0xF8: this.hl = this.addSP(this.fetch() << 24 >> 24); return 12;
      case 0xF9: this.sp = this.hl; return 8;
      case 0xFA: this.a = this.rd(this.fetch16()); return 16;
      case 0xFB: this.eiPending = true; return 4;
      case 0xFE: this.cp(this.fetch()); return 8;
    }
    if (op >= 0x40 && op < 0x80) {                                  // LD r,r'
      const dst = (op >> 3) & 7, src = op & 7;
      this.setR(dst, this.getR(src)); return (src === 6 || dst === 6) ? 8 : 4;
    }
    if (op >= 0x80 && op < 0xC0) {                                  // ALU A,r
      const src = op & 7, v = this.getR(src), cy = this.f & C ? 1 : 0;
      switch ((op >> 3) & 7) {
        case 0: this.add(v); break; case 1: this.add(v, cy); break; case 2: this.sub(v); break; case 3: this.sub(v, cy); break;
        case 4: this.and(v); break; case 5: this.xor(v); break; case 6: this.or(v); break; case 7: this.cp(v); break;
      }
      return src === 6 ? 8 : 4;
    }
    if ((op & 0xC7) === 0xC7) { this.push(this.pc); this.pc = op & 0x38; return 16; }   // RST
    throw new Error("illegal opcode " + op.toString(16) + " at " + (this.pc - 1).toString(16));
  }

  execCB(op) {
    const r = op & 7, bit = (op >> 3) & 7;
    let v = this.getR(r), res;
    if (op < 0x40) {
      const c = this.f & C ? 1 : 0;
      switch (bit) {
        case 0: res = ((v << 1) | (v >> 7)) & 0xFF; this.f = (res === 0 ? Z : 0) | (v & 0x80 ? C : 0); break;     // RLC
        case 1: res = (v >> 1) | ((v & 1) << 7); this.f = (res === 0 ? Z : 0) | (v & 1 ? C : 0); break;          // RRC
        case 2: res = ((v << 1) | c) & 0xFF; this.f = (res === 0 ? Z : 0) | (v & 0x80 ? C : 0); break;            // RL
        case 3: res = (v >> 1) | (c << 7); this.f = (res === 0 ? Z : 0) | (v & 1 ? C : 0); break;                 // RR
        case 4: res = (v << 1) & 0xFF; this.f = (res === 0 ? Z : 0) | (v & 0x80 ? C : 0); break;                  // SLA
        case 5: res = (v >> 1) | (v & 0x80); this.f = (res === 0 ? Z : 0) | (v & 1 ? C : 0); break;               // SRA
        case 6: res = ((v << 4) | (v >> 4)) & 0xFF; this.f = res === 0 ? Z : 0; break;                            // SWAP
        default: res = v >> 1; this.f = (res === 0 ? Z : 0) | (v & 1 ? C : 0); break;                             // SRL
      }
      this.setR(r, res); return r === 6 ? 16 : 8;
    }
    if (op < 0x80) { this.f = (this.f & C) | H | (v & (1 << bit) ? 0 : Z); return r === 6 ? 12 : 8; }   // BIT
    if (op < 0xC0) { this.setR(r, v & ~(1 << bit)); return r === 6 ? 16 : 8; }                          // RES
    this.setR(r, v | (1 << bit)); return r === 6 ? 16 : 8;                                               // SET
  }
}
