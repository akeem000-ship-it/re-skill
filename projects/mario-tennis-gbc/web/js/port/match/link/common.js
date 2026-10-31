// What the link modules share: the serial port, the link messages, the stack and the interrupt windows.
//
// Time. Link play is two Game Boys talking over a cable, and what each one sees depends on when the other did what:
// the waits (polling LY or the serial port, ShortDelay, WaitSerialTransfer, the `ei / nop / nop / di` loops that
// let the serial interrupt in) run instruction by instruction with the CPU's cycles (P.instr, web/js/port/port.js),
// as the ROM's do; the code between them takes no time, as the rest of the port. An `ei` makes interrupts possible
// after the instruction that follows it, as on the CPU: where that matters the port marks the point (intr).
// The stack is kept as the ROM keeps it (pushes, return addresses), so an interrupt or a far call finds it there.
// Port of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses.
import { push, pop } from "../../home/cpu.js";
import { linkErrorReset } from "../../home/link.js";

export const rSB = 0xFF01, rSC = 0xFF02, rIF = 0xFF0F, rLY = 0xFF44, rIE = 0xFFFF;
export const SC_START = 0x80, SC_FAST = 0x02, SC_INTERNAL = 0x01, SC_EXTERNAL = 0x00;
export const IF_SERIAL = 0x08;
export const LINKSTATE_MASTER = 0x01, LINKSTATE_SLAVE = 0x02;
export const LINKMSG_NONE = 0xC0, LINKMSG_PROBE = 0xC1, LINKMSG_PROBE_REPLY = 0xC2, LINKMSG_SYNC_MASTER = 0xC3,
  LINKMSG_SYNC_SLAVE = 0xC4, LINKMSG_BLOCK_END = 0xC5, LINKMSG_BLOCK_END_ACK = 0xC6, LINKMSG_CHECKSUM_BAD = 0xCB,
  LINKMSG_CHECKSUM = 0xCC, LINKMSG_BLOCK_OK = 0xCD;
export const TAG_MASTER = 0x40, TAG_SLAVE = 0x80, TAG_BITS = 0xC0;   // a nibble's sender, in bits 6-7 of its byte
export const LY_EXCHANGE = 0x8C;                                    // the master clocks a frame's byte at this line
export const hLinkBlockChecksum = 0xFFE5;                           // (a word: the sum of the nibbles sent)
export const wCharInputSource = 0xDF1E;                             // (in each character's WRAM bank 4-7)
export const WRAM_CHAR0 = 4, WRAM_CHAR1 = 5;
export const INPUT_LINK_MASTER = 0x05, INPUT_LINK_SLAVE = 0x06;    // wCharInputSource: the pad of this / the other end
export { push, pop };

// ldh [rSB], a / ld a, SC_FAST | clock / ldh [rSC], a / ld a, SC_START | SC_FAST | clock / ldh [rSC], a: the byte to
// send, then a transfer on this end's clock (internal: this end shifts it now) or the peer's (external: when it does)
export function startTransfer(P, byte, clock) {
  const { bus } = P;
  bus.w8(rSB, byte);
  bus.w8(rSC, SC_FAST | clock);
  bus.w8(rSC, SC_START | SC_FAST | clock);
}
// di / ldh a, [rIF] / and ~IF_SERIAL / ldh [rIF], a: a serial interrupt not yet taken is dropped
export function dropSerialRequest(P) { P.bus.w8(rIF, P.bus.u8(rIF) & ~IF_SERIAL); }
// `ei` at its place: interrupts on after the next instruction (as the CPU's ei). With next (the address of the
// instruction after the ei) that instruction is marked, and with check the one after it, where an interrupt due is
// then taken. Without them the next P.instr (a wait's first instruction, a call into one) is that instruction.
export function ei(P, next, check) {
  P.cpu.eiPending = true;
  if (next !== undefined) P.instr(next, 0);
  if (check !== undefined) P.instr(check, 0);
}
// an interrupt due is taken here, before the instruction at pc (the CPU checks before every instruction)
export function intr(P, pc) { P.instr(pc, 0); }
// `ei / nop / nop / di` at pc (or `ei / nop / di`: nops = 1): the window in which the CPU takes an interrupt
export function window(P, pc, nops = 2) {
  P.instr(pc, 4, () => { P.cpu.eiPending = true; });
  for (let i = 1; i <= nops; i++) P.instr(pc + i, 4);
  P.instr(pc + nops + 1, 4, () => { P.di(); });
}
// call LinkErrorReset at pc (the link error screen, then a soft reset: it does not return)
export function* linkError(P, pc) {
  push(P, pc + 3);
  yield* linkErrorReset(P);
}
// a routine of another bank by its far call, at pc (rst $18 / db slot, bank: 3 bytes): FarCall's frame on the stack
// as the ROM has it, the callee (its hook) with the registers FarCall gives it: a kept, F from CallVectorEntryA's
// `ld hl, sp+5` (the stack pointer's low byte + 5: H and C) and hl kept. Returns the registers the callee leaves
// (FarCall's tail keeps af and hl from it).
export function* farcall(P, pc, bank, target, regs = {}) {
  const { cpu } = P, sp = cpu.sp, a = regs.a ?? cpu.a;
  const vecSp = (sp - 10) & 0xFFFF;                                 // where `ld hl, sp+5` runs: 5 words pushed by then
  const f = (((vecSp & 0x0F) + 5) > 0x0F ? 0x20 : 0) | (((vecSp & 0xFF) + 5) > 0xFF ? 0x10 : 0);
  push(P, pc + 3);                                                  // rst $18 (its two operand bytes skipped)
  push(P, ((regs.h ?? cpu.h) << 8) | (regs.l ?? cpu.l));            // push hl
  push(P, (a << 8) | P.V.romBank);                                  // push af, F replaced by the caller's bank
  const r = yield* P.runRom(bank, target, { ...regs, a, f });       // (its return address where FarCall's tail's is)
  cpu.sp = sp;
  return r;
}
// the same for a callee that never waits (P.callRom)
export function farcallNow(P, pc, bank, target, regs = {}) {
  const it = farcall(P, pc, bank, target, regs), r = it.next();
  if (!r.done) throw new Error(`far call ${bank.toString(16)}:${target.toString(16)} waited`);
  return r.value;
}
