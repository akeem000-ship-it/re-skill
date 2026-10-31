// The game's event flags (wGameFlags: bits set, cleared and tested by number, or by the rst $20/$28/$30 commands
// with an inline operand) and the play-time clock run from the VBlank handler (flags_00.asm).
// Port of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses.
// Covered by the routine tests (web/tests/port/routines_home_system.mjs) and the lockstep on out/engine/*.mtrec.
// Not ported: the Unused_00_* scroll-buffer blits and the secondary timer's countdown (nothing calls them).
import { FLAG_Z, FLAG_N, FLAG_H, FLAG_C, preserving, spAddFlags, takeInlineBytes, setRegs } from "./cpu.js";

// ---- event flags ----
// A flag operand is a word: bits 15-8 the byte of wGameFlags, bits 7-5 the bit (0 = $80 ... 7 = $01), as
// `flag number << 5`. The ROM turns the low byte into the mask by rotating it left 3 times and indexing
// FlagMaskTable ($80 $40 ... $01) with it: for a well-formed operand that is $80 >> bit.
const FlagMaskTable = 0x2497;
function flagMask(P, operand) {
  const e = operand & 0xFF, index = ((e << 3) | (e >> 5)) & 0xFF;
  return P.rom.u8(0, FlagMaskTable + index);
}
const flagByte = (P, operand) => (P.A.gameFlags + (operand >> 8)) & 0xFFFF;

// TestGameFlag (00:249F): whether the flag `operand` (de) is set. Returns the result as the ROM's flags
// (Z when clear, H set by `and`); a, bc, hl kept, de left as (0, the byte index).
export function testGameFlag(P, operand) {
  return (P.bus.u8(flagByte(P, operand)) & flagMask(P, operand)) !== 0;
}
// SetGameFlag (00:24BA) / ClearGameFlag (00:24D4): set or clear the flag; af, bc, hl kept, de = (0, byte index)
export function setGameFlag(P, operand) {
  const at = flagByte(P, operand);
  P.bus.w8(at, P.bus.u8(at) | flagMask(P, operand));
}
export function clearGameFlag(P, operand) {
  const at = flagByte(P, operand);
  P.bus.w8(at, P.bus.u8(at) & ~flagMask(P, operand));
}
const testFlags = set => (set ? 0 : FLAG_Z) | FLAG_H;

// *GameFlagByNumber (00:24EF / 2509 / 2523): the same with the flag's number in de (byte * 8 + bit): de << 5 in
// 16 bits (`sla e / rl d`, five times), de kept. The Set/Clear ones leave the flags of the last `rl d`.
export const flagOperand = number => (number << 5) & 0xFFFF;
function shiftFlags(number) {
  const d4 = (number << 4) >> 8 & 0xFF, out = (number << 5) >> 8 & 0xFF;    // d before and after the last `rl d`
  return (out === 0 ? FLAG_Z : 0) | (d4 & 0x80 ? FLAG_C : 0);
}

// TestGameFlagCmd (00:2551, rst $30) / SetGameFlagCmd (00:255E, rst $20) / ClearGameFlagCmd (00:256B, rst $28):
// the flag operand is the word after the rst. Registers kept except F: the test's result, or the flags of the
// handler's `ld hl, sp+4`. FetchInlineWordOperand (00:253D) reads the word through the return address and moves
// it past: for these, the return address sits above the two registers the handler pushed.
function flagCmdHook(fn) {
  return (P, c) => {
    const [lo, hi] = takeInlineBytes(P, 2);
    const result = fn(P, lo | hi << 8);
    c.f = fn === testGameFlag ? testFlags(result) : spAddFlags((c.sp - 4) & 0xFFFF, 4);
  };
}
// FetchInlineWordOperand (00:253D): de = the word at the address stored at hl, and that address moved past it.
// Leaves hl + 1 (it walks the stored address's two bytes); bc kept.
function fetchInlineWordOperandHook(P, c) {
  const { bus } = P, slot = c.hl, at = bus.u16(slot);
  bus.w16(slot, at + 2);
  setRegs(c, { de: bus.u16(at), hl: slot + 1 });
}

// ---- the play-time clock ----
// wGameTimer: frames, seconds, minutes (each 0-59), hours; it stops at 99:59 (the minutes stay at 59 and the
// hours at 99 while the seconds go on). wSecondaryTimer (frames, seconds, minutes, up to 9:59) counts too while
// wSecondaryTimerMode is 1.
const FRAMES_PER_SECOND = 60, SECONDS_PER_MINUTE = 60, MINUTES_PER_HOUR = 60, HOURS_MAX = 99, SECONDARY_MINUTES_MAX = 9;
const SECONDARY_TIMER_COUNTING = 1;
const cpFlags = (a, v) => FLAG_N | (a === v ? FLAG_Z : 0) | ((a & 0xF) < (v & 0xF) ? FLAG_H : 0) | (a < v ? FLAG_C : 0);
// count one frame in a clock of fields [frames, seconds, minutes, last] (each 0-limits[i]-1) at addr; at the top
// the last field steps back and the one below it stays at 59. Returns the registers the ROM leaves: a = the last
// field it compared, hl = its address, f the flags of that compare (or of the `dec` at the top).
function tickClock(P, addr, limits) {
  const { bus } = P;
  for (let i = 0; ; i++) {
    const at = addr + i, v = (bus.u8(at) + 1) & 0xFF;
    bus.w8(at, v);
    if (v < limits[i]) return { a: v, hl: at, f: cpFlags(v, limits[i]) };
    if (i === limits.length - 1) {                               // the top: back to the last value, minutes at 59
      bus.w8(at, v - 1);
      bus.w8(at - 1, SECONDS_PER_MINUTE - 1);
      return { a: v, hl: at - 1, f: FLAG_N | ((v - 1) & 0xFF ? 0 : FLAG_Z) | ((v & 0xF) === 0 ? FLAG_H : 0) };
    }
    bus.w8(at, 0);
  }
}
// Unused_00_TickSecondaryTimer (00:2435): one frame of the secondary clock (UpdateGameTimer runs it in mode 1)
export function tickSecondaryTimer(P) {
  return tickClock(P, P.A.secondaryTimer, [FRAMES_PER_SECOND, SECONDS_PER_MINUTE, SECONDARY_MINUTES_MAX + 1]);
}
// UpdateGameTimer (00:23DD): one frame of play time
export function updateGameTimer(P) {
  if (P.V.secondaryTimerMode === SECONDARY_TIMER_COUNTING) tickSecondaryTimer(P);
  return tickClock(P, P.A.gameTimer, [FRAMES_PER_SECOND, SECONDS_PER_MINUTE, MINUTES_PER_HOUR, HOURS_MAX + 1]);
}
// SaveGameTimer (00:2452) / RestoreGameTimer (00:246D) / ResetGameTimer (00:2488): copy the clock to
// wSavedGameTimer, back, or zero it, with interrupts off (the VBlank handler counts it); all registers kept, and
// interrupts on afterwards.
const CLOCK_BYTES = 4;
function copyClock(P, from, to) {
  P.di();
  for (let i = 0; i < CLOCK_BYTES; i++) P.bus.w8(to + i, P.bus.u8(from + i));
  P.ei();
}
export const saveGameTimer = P => copyClock(P, P.A.gameTimer, P.A.savedGameTimer);
export const restoreGameTimer = P => copyClock(P, P.A.savedGameTimer, P.A.gameTimer);
export function resetGameTimer(P) {
  P.di();
  for (let i = 0; i < CLOCK_BYTES; i++) P.bus.w8(P.A.gameTimer + i, 0);
  P.ei();
}

export const HOOKS = [
  [0, 0x249F, (P, c) => setRegs(c, { f: testFlags(testGameFlag(P, c.de)), d: 0, e: c.d })],
  [0, 0x24BA, (P, c) => { setGameFlag(P, c.de); setRegs(c, { d: 0, e: c.d }); }],
  [0, 0x24D4, (P, c) => { clearGameFlag(P, c.de); setRegs(c, { d: 0, e: c.d }); }],
  [0, 0x24EF, (P, c) => { c.f = testFlags(testGameFlag(P, flagOperand(c.de))); }],
  [0, 0x2509, (P, c) => { setGameFlag(P, flagOperand(c.de)); c.f = shiftFlags(c.de); }],
  [0, 0x2523, (P, c) => { clearGameFlag(P, flagOperand(c.de)); c.f = shiftFlags(c.de); }],
  [0, 0x253D, fetchInlineWordOperandHook],
  [0, 0x0030, flagCmdHook(testGameFlag)],                       // rst $30
  [0, 0x2551, flagCmdHook(testGameFlag)],
  [0, 0x0020, flagCmdHook(setGameFlag)],                        // rst $20
  [0, 0x255E, flagCmdHook(setGameFlag)],
  [0, 0x0028, flagCmdHook(clearGameFlag)],                      // rst $28
  [0, 0x256B, flagCmdHook(clearGameFlag)],
  [0, 0x23DD, (P, c) => setRegs(c, updateGameTimer(P))],
  [0, 0x2435, (P, c) => setRegs(c, tickSecondaryTimer(P))],
  [0, 0x2452, P => saveGameTimer(P)],
  [0, 0x246D, P => restoreGameTimer(P)],
  [0, 0x2488, P => resetGameTimer(P)],
];
