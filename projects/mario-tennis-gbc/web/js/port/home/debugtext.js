// The debug text console: a 32x18 text buffer (wDebugTextBuffer) shown on the $9C00 BG map while the debug
// single-stepper runs, the hex/decimal formatters (also used by the game's own number displays), and the VRAM DMA
// starter (debugtext_00.asm).
// Port of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses.
// Covered by the routine tests (web/tests/port/routines_home_system.mjs) and the lockstep on out/engine/*.mtrec.
// Not ported: Unused_00_WaitStartVRAMDMAFromHL and Unused_00_PrintDecimalByteSigned (nothing calls them).
// Also ClearFrameTasks, at the end of this ROM file (the rest of the frame-task code is in colorfade.js).
import { FLAG_Z, FLAG_N, FLAG_H, FLAG_C, setRegs, spAddFlags } from "./cpu.js";

const rVBK = 0xFF4F, rVDMA_SRC_HIGH = 0xFF51, rVDMA_LEN = 0xFF55;
const TEXT_COLUMNS = 32;                                          // a buffer row (and a BG map row)
const DEBUG_TEXT_ROWS = 18, DEBUG_TEXT_VRAM = 0x1D00;             // shown on the $9C00 map from row 8 ($9D00)
const PEAK_LY_VRAM = 0x9D08, PEAK_LY_CHARS = 4;                   // the peak-LY readout: row 8, column 8 of $9C00
const STEP_MODE_CONSOLE = 3, STEP_MODE_BLINK_OFF = 1;
const CHAR_SPACE = 0x20, CHAR_MINUS = 0x2D, CHAR_0 = 0x30, CHAR_A_MINUS_10 = 0x41 - 10;
// routines other parts of the port own, still run as the ROM's code (they become direct calls once ported)
const ClearMemory16 = 0x03AF;
const FRAME_TASK_BYTES = 64;                                       // 16 entries of 4

// ClearDebugTextBuffer (00:188B): blank the console (ClearMemory16; leaves its registers)
export function clearDebugTextBuffer(P) {
  const buf = P.A.debugTextBuffer;
  P.callRom(0, ClearMemory16, { h: buf >> 8, l: buf & 0xFF, c: DEBUG_TEXT_ROWS * TEXT_COLUMNS / 16 });
}

// StartVRAMDMATransfer (00:18D7): a general VRAM DMA of `len + 1` 16-byte blocks from src to dest (dest $0000-
// $1FFF in the VRAM bank mapped), done at once. Leaves hl = rVDMA_LEN and the flags of its last `inc l` (all clear
// but C, kept).
export function startVRAMDMATransfer(P, src, dest, len) {
  const { bus } = P;
  bus.w8(rVDMA_SRC_HIGH, src >> 8);
  bus.w8(rVDMA_SRC_HIGH + 1, src & 0xFF);
  bus.w8(rVDMA_SRC_HIGH + 2, dest >> 8);
  bus.w8(rVDMA_SRC_HIGH + 3, dest & 0xFF);
  bus.w8(rVDMA_LEN, len);
}

// UpdateDebugOverlay (00:1893), from the VBlank handler in debug step mode: the peak-LY readout, whether the
// console is shown this frame (mode 3: always; mode 1: never; else every other frame), and the console text when
// it changed. Returns the registers it leaves.
export function updateDebugOverlay(P) {
  const { V, A, bus } = P;
  bus.w8(rVBK, 0);
  for (let i = 0; i < PEAK_LY_CHARS; i++) bus.w8(PEAK_LY_VRAM + i, bus.u8(A.debugPeakLYText + i));
  const mode = V.debugStepMode;
  V.showDebugConsole = mode === STEP_MODE_CONSOLE ? 1 : mode === STEP_MODE_BLINK_OFF ? 0 : V.vBlankCounter & 1 ? 0 : 1;
  if (!V.debugTextDirty) return { a: 0, f: FLAG_Z, hl: A.debugPeakLYText + PEAK_LY_CHARS, de: PEAK_LY_VRAM + PEAK_LY_CHARS };
  V.debugTextDirty = 0;
  bus.w8(rVBK, 0);
  const len = DEBUG_TEXT_ROWS * TEXT_COLUMNS / 16 - 1;
  startVRAMDMATransfer(P, A.debugTextBuffer, DEBUG_TEXT_VRAM, len);
  return { a: len, f: 0, bc: A.debugTextBuffer, de: DEBUG_TEXT_VRAM, hl: rVDMA_LEN };   // F: StartVRAMDMATransfer's
}

// GetDebugTextBufferAddr (00:18F1): the buffer address of column d, row e (wDebugTextBuffer + d + 32 * e)
export function getDebugTextBufferAddr(P, column, row) {
  return (P.A.debugTextBuffer + column + TEXT_COLUMNS * row) & 0xFFFF;
}
// write characters at column x, row y of the console, wrapping to the start of the row at its end, and mark the
// console dirty. next() gives each character in turn (0: the end), read only once the one before is written, as
// the ROM does (a source inside the buffer reads what was just printed). Returns the buffer address after the text.
function printChars(P, x, y, next) {
  let at = getDebugTextBufferAddr(P, x, y);
  for (let ch; (ch = next()) !== 0;) {
    P.bus.w8(at, ch);
    at = (at + 1) & 0xFFFF;
    if ((at & (TEXT_COLUMNS - 1)) === 0) at = (at - TEXT_COLUMNS) & 0xFFFF;
  }
  P.V.debugTextDirty = 1;
  return at;
}
const fromList = chars => { let i = 0; return () => (i < chars.length ? chars[i++] : 0); };
// PrintString (00:1906): print the 0-terminated string at src at column d, row e. Returns hl = its terminator
// and de = the buffer address after the text; a and f kept.
export function printString(P, x, y, src) {
  let hl = src;
  const de = printChars(P, x, y, () => { const ch = P.bus.u8(hl); if (ch) hl = (hl + 1) & 0xFFFF; return ch; });
  return { hl, de };
}

// ---- number formatting ----
// the 4 hex digits of a word (0-9, A-F)
function hexChars(value) {
  const out = [];
  for (let shift = 12; shift >= 0; shift -= 4) {
    const n = (value >> shift) & 0xF;
    out.push(n < 10 ? CHAR_0 + n : CHAR_A_MINUS_10 + n);
  }
  return out;
}
// write chars and a terminating 0 at dest; returns the terminator's address (where the ROM leaves de)
function writeText(P, dest, chars) {
  chars.forEach((ch, i) => P.bus.w8(dest + i, ch));
  const end = (dest + chars.length) & 0xFFFF;
  P.bus.w8(end, 0);
  return end;
}
// FormatHexWord (00:1935): the 4 hex digits of hl and a 0 at de. Returns de = the terminator; af, bc, hl kept.
export function formatHexWord(P, value, dest) { return writeText(P, dest, hexChars(value)); }

// The decimal digits of a word: 5 digits, each found by subtracting the power of ten while that does not borrow
// (ExtractDecimalDigit). With a width, padded on the left with spaces to it (counting the '-'); a negative number
// (signed only) gets a '-'; leading zeros dropped (0 is "0").
function decimalChars(value, width, signed) {
  const negative = signed && (value & 0x8000) !== 0;
  if (negative) value = -value & 0xFFFF;
  const digits = [10000, 1000, 100, 10, 1].map(p => { const d = Math.floor(value / p); value %= p; return d; });
  let first = digits.findIndex(d => d !== 0);                     // the first digit shown (the last one for 0)
  if (first < 0) first = 4;
  const out = [];
  let pad = width - (5 - first);
  if (width && pad > 0) {
    if (negative) pad--;
    for (; pad > 0; pad--) out.push(CHAR_SPACE);
  }
  if (negative) out.push(CHAR_MINUS);
  for (let i = first; i < 5; i++) out.push(CHAR_0 + digits[i]);
  return out;
}
// FormatDecimalNumber (00:1972, signed) / FormatDecimalNumberUnsigned (00:1A27): hl in decimal at de, a 0 after
// it, padded to width a (0: no padding). Returns de = the terminator. The ROM builds the digits in 6 bytes of
// stack: it leaves hl = its entry sp (just past them), a = 0, the flags of its final `add sp, 6`; bc kept.
export function formatDecimalNumber(P, value, width, dest) { return writeText(P, dest, decimalChars(value, width, true)); }
export function formatDecimalNumberUnsigned(P, value, width, dest) { return writeText(P, dest, decimalChars(value, width, false)); }
const formatDecimalHook = fn => (P, c) => {
  const sp = c.sp;
  setRegs(c, { de: fn(P, c.hl, c.a, c.de), hl: sp, a: 0, f: spAddFlags((sp - 6) & 0xFFFF, 6) });
};
// ExtractDecimalDigit (00:1A20) / ExtractDecimalDigitUnsigned (00:1AB0): with bc = -(power of ten), count how often
// hl + bc carries (hl >= the power); hl ends one subtraction too far. Returns a, hl and the flags of `dec a`.
export function extractDecimalDigit(hl, bc) {
  let a = 0, carry;
  do {
    a = (a + 1) & 0xFF;
    const sum = hl + bc;
    carry = sum > 0xFFFF;
    hl = sum & 0xFFFF;
  } while (carry);
  const count = (a - 1) & 0xFF;
  return { a: count, hl, f: (count === 0 ? FLAG_Z : 0) | FLAG_N | ((a & 0xF) === 0 ? FLAG_H : 0) };
}

// PrintHexByte (00:1AB7): a as 4 hex digits ("00" first: the ROM steps hl, not its string, past them),
// PrintHexWord (00:1ACE): hl as 4 hex digits, PrintDecimalByte (00:1AE4): a in decimal padded to 4,
// Unused_00_PrintDecimalWord (00:1B15): hl (signed) padded to 6; at column d, row e. All registers kept (the ROM
// formats into a stack buffer, then PrintString).
export const printHexByte = (P, x, y, a) => printChars(P, x, y, fromList(hexChars(a)));
export const printHexWord = (P, x, y, hl) => printChars(P, x, y, fromList(hexChars(hl)));
export const printDecimalByte = (P, x, y, a) => printChars(P, x, y, fromList(decimalChars(a, 4, true)));
export const printDecimalWord = (P, x, y, hl) => printChars(P, x, y, fromList(decimalChars(hl, 6, true)));

// ClearFrameTasks (00:1B38): empty the frame-task table (ClearMemory16; leaves its registers, and a = 1), with
// hFrameTasksReady clear meanwhile so AdvanceFrame does not run it half-cleared
export function clearFrameTasks(P) {
  P.V.frameTasksReady = 0;
  const tasks = P.A.frameTasks;
  P.callRom(0, ClearMemory16, { h: tasks >> 8, l: tasks & 0xFF, c: FRAME_TASK_BYTES / 16 });
  P.V.frameTasksReady = 1;
}

export const HOOKS = [
  [0, 0x188B, P => clearDebugTextBuffer(P)],
  [0, 0x1893, (P, c) => setRegs(c, updateDebugOverlay(P))],
  [0, 0x18D7, (P, c) => { startVRAMDMATransfer(P, c.bc, c.de, c.a); setRegs(c, { hl: rVDMA_LEN, f: c.f & FLAG_C }); }],
  [0, 0x18EB, (P, c) => {                                          // StartVRAMDMAFromHL: hl, de, c blocks
    const len = (c.c - 1) & 0xFF;
    startVRAMDMATransfer(P, c.hl, c.de, len);
    setRegs(c, { a: len, bc: c.hl, hl: rVDMA_LEN, f: c.f & FLAG_C });
  }],
  [0, 0x18F1, (P, c) => { c.de = getDebugTextBufferAddr(P, c.d, c.e); }],
  [0, 0x1906, (P, c) => setRegs(c, printString(P, c.d, c.e, c.hl))],
  [0, 0x1935, (P, c) => { c.de = formatHexWord(P, c.hl, c.de); }],
  [0, 0x1972, formatDecimalHook(formatDecimalNumber)],
  [0, 0x1A27, formatDecimalHook(formatDecimalNumberUnsigned)],
  [0, 0x1A20, (P, c) => setRegs(c, extractDecimalDigit(c.hl, c.bc))],
  [0, 0x1AB0, (P, c) => setRegs(c, extractDecimalDigit(c.hl, c.bc))],
  [0, 0x1AB7, (P, c) => { printHexByte(P, c.d, c.e, c.a); }],
  [0, 0x1ACE, (P, c) => { printHexWord(P, c.d, c.e, c.hl); }],
  [0, 0x1AE4, (P, c) => { printDecimalByte(P, c.d, c.e, c.a); }],
  [0, 0x1B15, (P, c) => { printDecimalWord(P, c.d, c.e, c.hl); }],
  [0, 0x1B38, (P, c) => { clearFrameTasks(P); c.a = 1; }],
];
