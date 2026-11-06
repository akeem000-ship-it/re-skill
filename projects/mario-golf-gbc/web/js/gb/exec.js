// Executor for the statically recompiled blocks (tools/recomp.py -> web/gen/game.js). A block runs
// when the PC is a known block start of the current ROM bank; otherwise one instruction is
// interpreted. Both paths keep the hardware in lockstep with the interpreter.
export class Exec {
  constructor(gb, table) {
    this.gb = gb; this.c = gb.cpu; this.m = gb.mem; this.blocks = 0; this.interp = 0; this.interpOn = 0;
    // per-bank dense arrays: bank 0 covers $0000-$3FFF, bank n covers $4000-$7FFF (indexed by pc)
    this.banks = [];
    for (const k of Object.keys(table)) {
      const key = +k, bank = key >> 16, pc = key & 0xFFFF;
      if (!this.banks[bank]) this.banks[bank] = new Array(bank === 0xFF ? 0x10000 : 0x8000).fill(undefined);
      this.banks[bank][pc] = table[k];
    }
    this.bank0 = this.banks[0] || new Array(0x8000).fill(undefined);
    this.hram = this.banks[0xFF] || null; this.hramSig = null;   // setHramSig(bytes): the routine the game copies to $FF80
  }
  setHramSig(sig) { this.hramSig = sig; }
  hramMatches() {
    const h = this.m.hram, s = this.hramSig; if (!s) return false;
    for (let i = 0; i < s.length; i++) if (h[i] !== s[i]) return false;
    return true;
  }
  step() {
    const c = this.c, m = this.m, gb = this.gb;
    const pending = m.iflag & m.ie & 0x1F;          // same prologue as CPU.step()
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
    let fn;
    if (pc < 0x4000) fn = this.bank0[pc];
    else if (pc < 0x8000) { const t = this.banks[m.romBank]; fn = t && t[pc]; }
    else if (pc >= 0xFF80 && this.hram && this.hramMatches()) fn = this.hram[pc];
    if (fn !== undefined) { this.blocks++; fn(c, m); if (c.cyc) { const n = c.cyc; c.cyc = 0; gb.sync(n); } return; }
    this.interp++; if (m.ppu.lcdc & 0x80) this.interpOn++;
    gb.sync(c.exec(c.fetch()));
  }
}
