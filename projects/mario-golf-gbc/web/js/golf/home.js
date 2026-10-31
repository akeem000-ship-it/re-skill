// Small helpers of the home bank (and their copies) that the rewrite otherwise does inline, written out as routines
// and checked against the ROM's on random registers and RAM (web/tests/golf_fuzz_routines.mjs). The flags they leave
// are not modelled (no caller of these reads them but where noted).
import * as M from "./math.js";
import { rd, wr } from "./render/display.js";
import { formatDecimalNumber } from "./render/text.js";
import { printString } from "./match.js";

const neg = v => (-v) & 0xFFFF;
export const negDE = de => neg(de);              // 00:0C67 NegDE
export const negateHL = hl => neg(hl);           // 00:21E0 NegateHL
export const negateBC = bc => neg(bc);           // 00:21E8 NegateBC
// 00:1B52 SubHLBC: hl - bc (bc = 0: hl as it is)
export const subHLBC = (hl, bc) => (bc ? (hl + neg(bc)) & 0xFFFF : hl);
// 00:0CB5 MulHLByDE with its HRAM: the 32-bit product at $FFA8-$FFAB (low byte first); returns the high 16 bits
export function mulHLByDEFull(w, hl, de) {
  const p = BigInt(hl) * BigInt(de);
  for (let k = 0; k < 4; k++) w.high[0x1A8 + k] = Number((p >> BigInt(8 * k)) & 0xFFn);
  return M.mulHLByDE(hl, de);
}
// 00:0C6E MulHLByDESigned: hl signed (negated around MulHLByDE when negative), de unsigned
export function mulHLByDESigned(w, hl, de) {
  if (!(hl & 0x8000)) return mulHLByDEFull(w, hl, de);
  return neg(mulHLByDEFull(w, neg(hl), de));
}
// 00:0B23 VectorFromSignedLengthAndAngle: a negative length turns half a turn; [hl x sin(a + $40) -> hl, x sin(a) ->
// de] (00:0B31)
export function vectorFromSignedLengthAndAngle(hl, a) {
  if (hl & 0x8000) { hl = neg(hl); a = (a + 0x80) & 0xFF; }
  return M.vectorFromLengthAndAngleRaw(hl, a);
}
// 00:21CF DecimalDigitBySubtract: [d = hl / bc by repeated subtraction while hl stays positive, hl = the rest]
export function decimalDigitBySubtract(hl, bc) {
  let d = 0;
  const nb = neg(bc);
  do { d = (d + 1) & 0xFF; hl = (hl + nb) & 0xFFFF; } while (!(hl & 0x8000));
  hl = (hl + bc) & 0xFFFF;
  return [(d - 1) & 0xFF, hl];
}
// 00:23AF ExtractDecimalDigitUnsigned: bc = -(the place value): [a = how many times it goes into hl, hl less them
// and one more]
export function extractDecimalDigitUnsigned(hl, bc) {
  let a = 0, c;
  do { a = (a + 1) & 0xFF; const s = hl + bc; c = s > 0xFFFF; hl = s & 0xFFFF; } while (c);
  return [(a - 1) & 0xFF, hl];
}
// 00:23C6 Compare3Bytes: 0 when the three bytes at de and hl are the same, else 1
export const compare3Bytes = (w, de, hl) => (rd(w, de) === rd(w, hl) && rd(w, de + 1) === rd(w, hl + 1) && rd(w, de + 2) === rd(w, hl + 2) ? 0 : 1);
// 00:23E1 Check3BytesZero: the three bytes at hl or'ed
export const check3BytesZero = (w, hl) => rd(w, hl) | rd(w, hl + 1) | rd(w, hl + 2);
// 00:252E / 00:253A / 00:254A AdjustColorRed / Green / Blue: bc = a 15-bit colour; the component plus d (signed;
// below 0: 0, from $1F: $1F) (00:24EB SplitColorComponents, 00:2521 AddClampColorComponent, 00:2504
// CombineColorComponents)
export function adjustColor(bc, d, k) {
  const comp = [bc & 0x1F, (bc >> 5) & 0x1F, (bc >> 10) & 0x1F];
  let a = (comp[k] + d) & 0xFF;
  a = a & 0x80 ? 0 : a >= 0x1F ? 0x1F : a;
  comp[k] = a;
  return comp[0] | comp[1] << 5 | comp[2] << 10;   // (bit 15 cleared)
}
// 00:211D FormatSignedDecimalPadded (unreferenced): hl signed in decimal at de, right-aligned to a places (spaces, the
// sign counted; none when a is 0 or the number is wider), '-' when negative, the units always; a NUL after it (de is
// left on the NUL)
export function formatSignedDecimalPadded(w, hl, a, de) {
  let negF = false;
  if (hl & 0x8000) { hl = neg(hl); negF = true; }
  const dig = [];
  for (const p of [10000, 1000, 100, 10, 1]) { const [d, r] = decimalDigitBySubtract(hl, p); dig.push(d); hl = r; }
  if (a) {
    let b = 5;
    for (let k = 0; k < 4 && !dig[k]; k++) b--;
    let pad = (a - b) & 0xFF;
    if (a > b) {
      if (negF) pad = (pad - 1) & 0xFF;
      for (; pad; pad = (pad - 1) & 0xFF) wr(w, de++, 0x20);
    }
  }
  if (negF) wr(w, de++, 0x2D);
  let started = false;
  dig.forEach((d, k) => { if (started || d || k === 4) { wr(w, de++, (d & 0xBF) + 0x30); started = true; } });
  wr(w, de, 0);
  return de & 0xFFFF;
}
// 00:22BC PrintHexWord: hl as four hex digits printed at (d, e) (the debug text, 00:2319)
export function printHexWord(w, hl, de) {
  const h = v => (v < 10 ? 0x30 + v : 0x37 + v);
  printString(w, [h(hl >> 12), h((hl >> 8) & 15), h((hl >> 4) & 15), h(hl & 15), 0], de >> 8, de & 0xFF);
}
// 00:22E9 PrintDecimalByteSigned: a sign-extended (00:08A5), in decimal 4 wide (00:21F0), printed at (d, e)
export function printDecimalByteSigned(w, a, de) {
  printString(w, formatDecimalNumber(a & 0x80 ? 0xFF00 | a : a, 4), de >> 8, de & 0xFF);
}
// 3E:6637 MatchCompare16 (the same code as CpuCompare16): bc - de: 2 negative, 0 zero, else 1
export function matchCompare16(bc, de) {
  const d = (bc - de) & 0xFFFF;
  return d & 0x8000 ? 2 : d ? 1 : 0;
}
