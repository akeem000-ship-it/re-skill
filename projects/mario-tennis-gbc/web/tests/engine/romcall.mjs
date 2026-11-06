// Run one ROM routine on the JS core's interpreter: map its bank, set registers, push a sentinel return address
// and step until it returns. Used to check engine ports routine by routine against the real code.
// romCall(gb, bank, addr, regs = {a,b,c,d,e,h,l,f}, { wramBank, maxSteps }) -> { cpu registers after }
const SENTINEL = 0xFFF0;                     // an HRAM address no routine returns to on its own
export function romCall(gb, bank, addr, regs = {}, { wramBank = null, maxSteps = 2_000_000 } = {}) {
  const cpu = gb.cpu, m = gb.mem;
  if (addr >= 0x4000) { m.romBank = bank; m.updateRom(); m.hram[0x15] = bank; }   // MBC + hRomBank (FarCall returns to it)
  if (wramBank !== null) { m.svbk = wramBank || 1; m.hram[0x16] = wramBank; }   // rSVBK + hWramBank
  for (const r of ["a", "b", "c", "d", "e", "h", "l"]) if (r in regs) cpu[r] = regs[r] & 0xFF;
  if ("f" in regs) cpu.f = regs.f & 0xF0;
  cpu.ime = false; cpu.eiPending = false; cpu.halted = false;
  if (!cpu.sp || cpu.sp < 0xC100) cpu.sp = 0xDE00;
  cpu.sp = (cpu.sp - 2) & 0xFFFF; m.write(cpu.sp, SENTINEL & 0xFF); m.write(cpu.sp + 1, SENTINEL >> 8);
  cpu.pc = addr;
  let n = 0;
  while (cpu.pc !== SENTINEL) { cpu.step(); if (++n > maxSteps) throw new Error(`romCall ${bank.toString(16)}:${addr.toString(16)} did not return`); }
  return { a: cpu.a, f: cpu.f, b: cpu.b, c: cpu.c, d: cpu.d, e: cpu.e, h: cpu.h, l: cpu.l, bc: cpu.bc, de: cpu.de, hl: cpu.hl, steps: n };
}
// copy of the RAM a match routine can touch, to restore between calls
export function ramSnapshot(gb) {
  const m = gb.mem; return { wram: m.wram.map(b => b.slice()), hram: m.hram.slice(), romBank: m.romBank, svbk: m.svbk, sp: gb.cpu.sp };
}
export function ramRestore(gb, s) {
  const m = gb.mem; s.wram.forEach((b, i) => m.wram[i].set(b)); m.hram.set(s.hram); m.romBank = s.romBank; m.updateRom(); m.svbk = s.svbk; gb.cpu.sp = s.sp;
}
