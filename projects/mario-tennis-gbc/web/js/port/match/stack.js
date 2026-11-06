// The ROM's stack around the match's coroutines. The lockstep test (web/tests/port_lockstep.mjs) lines the port up
// with the ROM at each AdvanceFrame and copies the ROM's state in only where the two stand at the same stack depth,
// so the ported routines that wait keep the words the ROM has there: the return address of each `call` into a
// routine, what a routine pushes, and a far call's frame. (The values are the ROM's where known; the lockstep
// compares the depth only, and copies the ROM's stack page in where they agree.)
// Names and addresses from the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm).
import { pushWord, dropWords } from "../home/memory.js";

const FAR_CALL_RETURN = 0x01D5;          // FarCall's `call CallVectorEntryA` returns here (00:01D5)

// `call X` into the JS coroutine gen, returning to ret
export function* call(P, ret, gen) {
  pushWord(P, ret);
  const r = yield* gen;
  dropWords(P, 1);
  return r;
}
// words pushed (push af / bc / de / hl: "af" ... "hl" for the CPU's registers, "bank" for push_wram_bank's
// hWramBank and f, or a value) and dropped
export function push(P, ...words) {
  const c = P.cpu;
  const value = { af: () => c.a << 8 | c.f, bc: () => c.b << 8 | c.c, de: () => c.d << 8 | c.e, hl: () => c.h << 8 | c.l,
    bank: () => P.bus.u8(0xFF96) << 8 | c.f };
  for (const w of words) pushWord(P, typeof w === "string" ? value[w]() : w & 0xFFFF);
}
export const pop = (P, n) => dropWords(P, n);
// `farcall X` (rst $18 at rst, its slot and bank after it): FarCall (00:01B6) leaves under its callee the return
// past the inline bytes, the caller's hl, and a with the caller's ROM bank, then calls CallVectorEntryA
function farFrame(P, rst, regs) {
  const c = P.cpu, h = regs.h ?? (regs.hl !== undefined ? regs.hl >> 8 : c.h), l = regs.l ?? (regs.hl !== undefined ? regs.hl & 0xFF : c.l);
  pushWord(P, (rst + 3) & 0xFFFF);
  pushWord(P, (h << 8 | l) & 0xFFFF);
  pushWord(P, ((regs.a ?? c.a) << 8 | P.bus.u8(0xFF95)) & 0xFFFF);
}
// a far call into ROM code (or a routine hooked there): P.runRom's return word stands for CallVectorEntryA's
export function* farcallRom(P, rst, bank, addr, regs = {}) {
  farFrame(P, rst, regs);
  const r = yield* P.runRom(bank, addr, regs);
  dropWords(P, 3);
  return r;
}
// a far call into a JS coroutine
export function* farcallJs(P, rst, gen, regs = {}) {
  farFrame(P, rst, regs);
  pushWord(P, FAR_CALL_RETURN);
  const r = yield* gen;
  dropWords(P, 4);
  return r;
}
