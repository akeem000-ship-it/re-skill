// The home routines that wait by spending CPU time: switching the LCD off at the start of VBlank (a loop polling
// rLY), the link code's short delay (a count down) and the wait for a serial byte with its timeout (vectors_00.asm,
// vblank_00.asm). What they wait for depends on how long each instruction takes, so the port runs them
// instruction by instruction with the CPU's cycles (P.instr, web/js/port/port.js): the hardware runs on as it does
// under the ROM's loop, and an interrupt is taken between two instructions as the CPU takes it. Cycle for cycle
// the ROM's: checked by web/tests/port/busy_loops.mjs (machine, cycle count and frame boundaries, interrupts on).
// Also here: the interrupt vectors', two rst vectors' and the entry point's jumps (one `jp` each, with its time).
// Port of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses.
import { FLAG_Z, FLAG_C, setRegs } from "./cpu.js";
import { clearVRAMCopyQueue } from "./memory.js";

const rIF = 0xFF0F, rLCDC = 0xFF40, rLY = 0xFF44, rIE = 0xFFFF;
const hSavedIE = 0xFF9F, hBGRowBlitPending = 0xFFB8, hLinkTransferDone = 0xFFD7;
const LY_VBLANK = 0x91, LCDC_ON = 0x80, IE_VBLANK = 0x01;
const SHORT_DELAY_COUNT = 0x007D, SERIAL_TIMEOUT = 0xC350;
// the SM83's cycles (single speed, T-cycles) of the instructions these routines use
export const LDH = 12, ALU = 4, ALU_N = 8, CB = 8, JR = 12, JR_NOT = 8, PUSH = 16, POP = 12, CALL = 24, RET = 16,
  LD_RR_NN = 12, LD_HLI = 8, INC_DEC_RR = 8, JP = 16;

const push = (P, v) => { const { cpu, bus } = P; cpu.sp = (cpu.sp - 2) & 0xFFFF; bus.w16(cpu.sp, v); };
const pop = P => { const { cpu, bus } = P; const v = bus.u16(cpu.sp); cpu.sp = (cpu.sp + 2) & 0xFFFF; return v; };

// DisableLCDSafely (00:0346): with the LCD on, keep the VBlank interrupt off (IE bit 0, the rest kept in hSavedIE),
// wait for LY to reach $91 (VBlank), switch the LCD off, clear IF and put IE back. Then (LCD on or off) clear the
// VRAM copy queue and the three hBGRowBlitPending bytes. Keeps bc, de, hl; returns a = 0, F = Z.
export function disableLCDSafely(P) {
  const { bus } = P, I = (pc, n, fn) => P.instr(pc, n, fn);
  let a = I(0x0346, LDH, () => bus.u8(rLCDC));
  I(0x0348, CB);                                                  // bit 7, a
  if (a & LCDC_ON) {
    I(0x034A, JR_NOT);
    a = I(0x034C, LDH, () => bus.u8(rIE));
    I(0x034E, LDH, () => bus.w8(hSavedIE, a));
    a &= ~IE_VBLANK; I(0x0350, CB);
    I(0x0352, LDH, () => bus.w8(rIE, a));
    for (;;) {                                                    // .waitVBlank
      a = I(0x0354, LDH, () => bus.u8(rLY));
      I(0x0356, ALU_N);
      if (a === LY_VBLANK) { I(0x0358, JR_NOT); break; }
      I(0x0358, JR);
    }
    a = I(0x035A, LDH, () => bus.u8(rLCDC));
    a &= ~LCDC_ON & 0xFF; I(0x035C, ALU_N);
    I(0x035E, LDH, () => bus.w8(rLCDC, a));
    I(0x0360, ALU);
    I(0x0361, LDH, () => bus.w8(rIF, 0));
    a = I(0x0363, LDH, () => bus.u8(hSavedIE));
    I(0x0365, LDH, () => bus.w8(rIE, a));
  } else I(0x034A, JR);
  const { cpu } = P;                                              // .clearQueues
  I(0x0367, PUSH, () => push(P, cpu.hl));
  I(0x0368, PUSH, () => push(P, cpu.bc));
  I(0x0369, CALL, () => push(P, 0x036C));
  P.instr(0x0465, 0);                                             // (an interrupt due is taken as ClearVRAMCopyQueue starts)
  clearVRAMCopyQueue(P);                                          // (ported: no time; its return pops the address)
  pop(P);
  I(0x036C, ALU);
  I(0x036D, LD_RR_NN);
  for (let i = 0; i < 3; i++) I(0x0370 + i, LD_HLI, () => bus.w8(hBGRowBlitPending + i, 0));
  I(0x0373, POP, () => pop(P));
  I(0x0374, POP, () => pop(P));
  P.instr(0x0375, RET);                                           // (the hook's return pops the caller's address)
  return { a: 0, f: FLAG_Z };
}

// ShortDelay (00:2821): count bc down from $7D (about 2000 cycles). Keeps every register.
export function shortDelay(P) {
  const { cpu } = P, I = (pc, n, fn) => P.instr(pc, n, fn);
  I(0x2821, PUSH, () => push(P, cpu.a << 8 | cpu.f));
  I(0x2822, PUSH, () => push(P, cpu.bc));
  I(0x2823, LD_RR_NN);
  for (let bc = SHORT_DELAY_COUNT; ;) {
    bc = (bc - 1) & 0xFFFF; I(0x2826, INC_DEC_RR);
    I(0x2827, ALU); I(0x2828, ALU);
    if (!bc) { I(0x2829, JR_NOT); break; }
    I(0x2829, JR);
  }
  I(0x282B, POP, () => pop(P));
  I(0x282C, POP, () => pop(P));
  I(0x282D, RET);
}

// WaitSerialTransfer (00:282E): wait for the serial handler to note a finished transfer (hLinkTransferDone), up to
// $C350 tries, interrupts on between the tries. Received: clear the note, carry clear (a = 0). Timed out: carry set
// (a = 0). Interrupts on at the end. Keeps bc.
export function waitSerialTransfer(P) {
  const { cpu, bus } = P, I = (pc, n, fn) => P.instr(pc, n, fn);
  I(0x282E, PUSH, () => push(P, cpu.bc));
  I(0x282F, LD_RR_NN);
  let bc = SERIAL_TIMEOUT, got = false;
  for (;;) {                                                      // .waitLoop
    I(0x2832, ALU, () => { cpu.eiPending = true; });              // ei (on after the next instruction starts)
    I(0x2833, ALU);                                               // nop
    I(0x2834, ALU, () => { cpu.ime = false; cpu.eiPending = false; });   // di (an interrupt due is taken before it)
    const a = I(0x2835, LDH, () => bus.u8(hLinkTransferDone));
    I(0x2837, ALU);
    if (a) { I(0x2838, JR); got = true; break; }
    I(0x2838, JR_NOT);
    bc = (bc - 1) & 0xFFFF; I(0x283A, INC_DEC_RR);
    I(0x283B, ALU); I(0x283C, ALU);
    if (!bc) { I(0x283D, JR_NOT); break; }
    I(0x283D, JR);
  }
  let f;
  if (got) {                                                      // .received
    I(0x2843, ALU);
    I(0x2844, LDH, () => bus.w8(hLinkTransferDone, 0));
    I(0x2846, ALU); I(0x2847, ALU);
    f = FLAG_Z;
  } else {
    I(0x283F, ALU, () => { cpu.eiPending = true; });
    I(0x2840, ALU);
    I(0x2841, JR);
    f = FLAG_Z | FLAG_C;                                          // (scf after `or c` = 0: Z kept)
  }
  I(0x2848, ALU, () => { cpu.eiPending = true; });                // .done: ei
  I(0x2849, POP, () => pop(P));
  I(0x284A, RET);
  return { a: 0, f };
}

// the vectors' and the entry point's jumps: the jump's time, then on to the target
const jump = (pc, cycles, to) => [0, pc, P => { P.instr(pc, cycles); P.jump(to); }];

export const HOOKS = [
  [0, 0x0346, (P, c) => setRegs(c, disableLCDSafely(P))],
  [0, 0x2821, P => { shortDelay(P); }],
  [0, 0x282E, (P, c) => setRegs(c, waitSerialTransfer(P))],
  jump(0x0000, JP, 0x06C4),                                       // Rst00: jp JumpTableDispatch
  jump(0x0008, JP, 0x2FB3),                                       // Rst08: jp PlaySoundCmd
  jump(0x0040, JP, 0x2749),                                       // VBlankInterrupt: jp VBlankHandler
  jump(0x0048, JP, 0x27F5),                                       // LCDStatInterrupt: jp LCDStatHandler
  jump(0x0050, JP, 0x27D7),                                       // TimerInterrupt: jp TimerHandler
  jump(0x0058, JP, 0x2861),                                       // SerialInterrupt: jp SerialHandler
  [0, 0x0100, P => { P.instr(0x0100, ALU); P.instr(0x0101, JP); P.instr(0x0150, JP); P.jump(0x2578); }],   // EntryPoint: nop / jp / jp Start
  jump(0x0150, JP, 0x2578),
];

// `call ShortDelay` / `call WaitSerialTransfer` at pc in ported code that waits as the ROM does (the link code): the
// call's time and its return address on the stack, the routine, its return; an interrupt that came during its last
// instruction is taken at the instruction after the call, as the CPU takes it
export function callShortDelay(P, pc) {
  P.instr(pc, CALL, () => push(P, pc + 3));
  shortDelay(P);
  pop(P);
  P.instr(pc + 3, 0);
}
export function callWaitSerialTransfer(P, pc) {
  P.instr(pc, CALL, () => push(P, pc + 3));
  const r = waitSerialTransfer(P);
  pop(P);
  P.instr(pc + 3, 0);
  return r;
}
