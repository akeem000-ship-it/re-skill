// Executor for the statically recompiled blocks (tools/recomp.py -> web/gen/game.js). A block runs
// when the PC is a known block start of the current ROM bank; otherwise one instruction is
// interpreted. Both paths keep the hardware in lockstep with the interpreter.
export class Exec {
  constructor(gb, table) { this.gb = gb; this.c = gb.cpu; this.m = gb.mem; this.T = table; this.blocks = 0; this.interp = 0; }
  step() {
    const c = this.c, m = this.m, gb = this.gb;
    // same prologue as CPU.step()
    const pending = m.iflag & m.ie & 0x1F;
    if (pending) {
      c.halted = false;
      if (c.ime) {
        c.ime = false; c.eiPending = false;
        for (let i = 0; i < 5; i++) if (pending & (1 << i)) { m.iflag &= ~(1 << i); c.push(c.pc); c.pc = 0x40 + 8 * i; gb.sync(20); return; }
      }
    }
    if (c.halted) { gb.sync(4); return; }
    if (c.eiPending) { c.eiPending = false; c.ime = true; }
    const pc = c.pc;
    const fn = pc < 0x4000 ? this.T[pc] : pc < 0x8000 ? this.T[(m.romBank << 16) | pc] : undefined;
    if (fn) { this.blocks++; fn(c, m); if (c.cyc) { const n = c.cyc; c.cyc = 0; gb.sync(n); } return; }
    this.interp++;
    const op = c.fetch(); gb.sync(c.exec(op));
  }
}
