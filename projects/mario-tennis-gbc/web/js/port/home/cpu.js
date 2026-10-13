// What the CPU itself does around the ported bank-0 routines: registers and flags for the hooks, the inline
// operands of the rst commands (read through the return address on the stack), jumps out of a hook, and HALT.
// Names and addresses from the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm).

export const FLAG_Z = 0x80, FLAG_N = 0x40, FLAG_H = 0x20, FLAG_C = 0x10;

// all eight registers, to restore around ROM calls (P.callRom leaves the CPU's registers as the callee left them)
export function getRegs(cpu) {
  return { a: cpu.a, f: cpu.f, b: cpu.b, c: cpu.c, d: cpu.d, e: cpu.e, h: cpu.h, l: cpu.l };
}
// write registers back: any of a f b c d e h l, and the pairs bc de hl
export function setRegs(cpu, regs) {
  for (const [r, v] of Object.entries(regs)) {
    if (r === "bc" || r === "de" || r === "hl") cpu[r] = v & 0xFFFF;
    else if (r === "f") cpu.f = v & 0xF0;
    else cpu[r] = v & 0xFF;
  }
}
// a hook for a routine that saves and restores the registers it does not return (push ... pop): fn(P, cpu, regs)
// may call into the ROM, which changes the CPU's registers; afterwards they are put back, then fn's results set
export function preserving(fn) {
  return (P, cpu) => {
    const saved = getRegs(cpu);
    const out = fn(P, cpu, saved);
    setRegs(cpu, saved);
    if (out) setRegs(cpu, out);
  };
}
// the same for a routine that waits (fn is a generator function)
export function preservingGen(fn) {
  return function* (P, cpu) {
    const saved = getRegs(cpu);
    const out = yield* fn(P, cpu, saved);
    setRegs(cpu, saved);
    if (out) setRegs(cpu, out);
  };
}

// the flags `ld hl, sp+e` / `add sp, e` leave: Z and N clear, H and C from adding e to sp's low byte
export function spAddFlags(sp, e) {
  return (((sp & 0x0F) + (e & 0x0F)) > 0x0F ? FLAG_H : 0) | (((sp & 0xFF) + (e & 0xFF)) > 0xFF ? FLAG_C : 0);
}
// the flags of `add a, x` (8-bit) and of `dec r` (C unchanged: pass the old flags)
export function addFlags(a, x) {
  const r = a + x;
  return ((r & 0xFF) === 0 ? FLAG_Z : 0) | (((a & 0xF) + (x & 0xF)) > 0xF ? FLAG_H : 0) | (r > 0xFF ? FLAG_C : 0);
}
export function decFlags(v, oldF) {
  const r = (v - 1) & 0xFF;
  return (oldF & FLAG_C) | FLAG_N | (r === 0 ? FLAG_Z : 0) | ((v & 0xF) === 0 ? FLAG_H : 0);
}

// The inline operand bytes after an rst (or call) whose return address is at sp+offset: returns them and moves
// the return address past them, so the caller goes on after its operands, as the ROM's handlers do.
export function takeInlineBytes(P, count, offset = 0) {
  const { bus, cpu } = P, slot = (cpu.sp + offset) & 0xFFFF, at = bus.u16(slot);
  const bytes = [];
  for (let i = 0; i < count; i++) bytes.push(bus.u8(at + i));   // through the bank mapped now: the caller's code
  bus.w16(slot, at + count);
  return bytes;
}

// push / pop on the CPU's stack, where the ROM keeps a value across a wait (the lockstep test may replace the
// stack page with the ROM's, so what is kept there is what the ROM has)
export function push(P, value) {
  P.cpu.sp = (P.cpu.sp - 2) & 0xFFFF;
  P.bus.w16(P.cpu.sp, value);
}
export function pop(P) {
  const value = P.bus.u16(P.cpu.sp);
  P.cpu.sp = (P.cpu.sp + 2) & 0xFFFF;
  return value;
}

// A hook always ends with `ret`. For a routine that ends in a jump instead (`jp hl`), put the target where that ret
// pops it from: the stack slot just below sp (free stack, as the ROM leaves it after its own pushes and pops).
export function jumpTo(P, addr) {
  const { bus, cpu } = P;
  cpu.sp = (cpu.sp - 2) & 0xFFFF;
  bus.w16(cpu.sp, addr);
}

// HALT: sleep until an interrupt is pending, and take it if IME is set. One pending already does not sleep (taken
// at once if IME is set). Else the hardware runs on until one comes ("cpuhalt": the port's frame loop runs the
// handler, mid-frame or at the next frame boundary for VBlank, and resumes the caller after it).
export function* halt(P) {
  const m = P.mem;
  if (m.iflag & m.ie & 0x1F) { P.dispatch(); return; }
  yield "cpuhalt";
}

// The ROM's `ei / nop / di / test` loop: interrupts are taken while it spins, and only they can change what it
// waits for, so between the tests it sleeps until one comes. Returns (interrupts off) once done() holds.
export function* spinUntil(P, done) {
  for (;;) {
    P.ei();
    P.dispatch();                                                // ei / nop: a pending interrupt is taken here
    P.di();
    if (done()) return;
    P.ei();
    yield* halt(P);
  }
}
