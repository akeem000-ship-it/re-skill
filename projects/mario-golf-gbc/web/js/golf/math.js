// Bank-0 arithmetic of Mario Golf, each function named after its ROM routine and returning the result
// registers its callers use (tools/golfmath.py; tools/test_math.py checks those against the ROM). Values are
// unsigned 16-bit unless the name says signed. Tables are read from the ROM.
import { rb, rw } from "./rom.js";

export const neg16 = v => (-v) & 0xFFFF;
export const s16 = v => (v & 0x8000 ? v - 0x10000 : v);
export const abs16 = v => (v & 0x8000 ? neg16(v) : v);

const sine = i => rw(0, 0x1201 + 2 * i);          // SineTable 00:1201 ($401 words, a quarter turn)
const tangent = i => rw(0, 0x1B68 + 2 * i);       // TangentTable 00:1B68 (257 words)
const sine8 = i => rb(0, 0x0B69 + i);             // 00:0B69: sine bytes for 8-bit angles 0..$40

export const subHLDE = (hl, de) => (hl - de) & 0xFFFF;                    // 00:08AC SubDEFromHL
export const mulHLByA = (hl, a) => (hl * a) & 0xFFFF;                      // 00:08B9 MulHLByA: low 16 bits
export const mulHLByAFrac = (hl, a) => (hl * a) >>> 8;                     // 00:0BEC MulHLByAFrac
export function mulHLByAFracSigned(hl, a) {                               // 00:0BCE: sign-magnitude
  return hl & 0x8000 ? neg16(mulHLByAFrac(neg16(hl), a)) : mulHLByAFrac(hl, a);
}
export const mulHLByDE = (hl, de) => (hl * de) >>> 16;                     // 00:0CB5 MulHLByDE: high 16 bits
export function mulHLByDEBothSigned(hl, de) {                             // 00:0C8E
  const neg = (hl ^ de) & 0x8000;
  const r = mulHLByDE(abs16(hl), abs16(de));
  return neg ? neg16(r) : r;
}
export function mulSignedFull(hl, a) {                                    // 00:0BB5 MulHLByASignedFull
  return hl & 0x8000 ? neg16(mulHLByA(neg16(hl), a)) : mulHLByA(hl, a);
}

function mulSinUnsigned(hl, bc) {                                         // 00:11DB: hl * sin(bc), bc < $8000
  if (bc & 0x4000) bc = (0x8000 - bc) & 0xFFFF;
  return mulHLByDE(sine((bc >> 4) & 0x7FF), (hl * 2) & 0xFFFF);
}
export function mulSin(hl, bc) {                                          // 00:11CB MulSin
  return bc & 0x8000 ? neg16(mulSinUnsigned(hl, bc & 0x7FFF)) : mulSinUnsigned(hl, bc);
}
export function mulSinCos(hl, bc) {                                       // 00:11BA: [hl*cos, hl*sin], c's low nibble dropped
  bc &= 0xFFF0;
  const de = mulSin(hl, bc);
  return [mulSin(hl, (bc + 0x4000) & 0xFFFF), de];
}
export function mulSinCosSigned(hl, bc) {                                 // 00:11AC: a negative length turns half a turn
  if (hl & 0x8000) { hl = neg16(hl); bc = (bc + 0x8000) & 0xFFFF; }
  return mulSinCos(hl, bc);
}

// 00:0DDB DivAHLByDE: a:hl / de -> [a, hl], bit for bit: restoring division in three 8-bit phases; phase 1
// shifts only l into the remainder, the remainder's high byte is cleared before phase 2, the carry out of h is
// dropped (so large divisors lose remainder bits). de = 0: [$FF, $FFFF].
export function divAHLByDE(a, hl, de) {
  if (de === 0) return [0xFF, 0xFFFF];
  const nde = (-de) & 0xFFFF;
  let rem = 0;
  const phase = (x, shiftH) => {
    let carry = 1;
    for (let k = 0; k < 8; k++) {
      let v = (x << 1) | carry;
      let c = v >> 8;
      x = v & 0xFF;
      let h = rem >> 8, l = rem & 0xFF;
      v = (l << 1) | c;
      l = v & 0xFF; c = v >> 8;
      if (shiftH) h = ((h << 1) | c) & 0xFF;
      let s = ((h << 8) | l) + nde;
      carry = s >> 16; rem = s & 0xFFFF;
      if (!carry) {
        x = (x - 1) & 0xFF;
        s = rem + de;
        carry = s >> 16; rem = s & 0xFFFF;
      }
    }
    return x;
  };
  const qa = phase(a, false);
  rem &= 0x00FF;
  const qh = phase(hl >> 8, true);
  const ql = phase(hl & 0xFF, true);
  return [qa, (qh << 8) | ql];
}

export const divHLByDE = (hl, de) => (de === 0 ? 0xFFFF : Math.floor(hl / de));   // 00:09AE DivHLByDE

export function isqrt(v) {                       // floor(sqrt(v)) for v < 2^32
  let r = Math.floor(Math.sqrt(v));
  while (r * r > v) r--;
  while ((r + 1) * (r + 1) <= v) r++;
  return r;
}
export const isqrtHL = hl => isqrt(hl);           // 00:0F04 IsqrtHL: a = floor(sqrt(hl))
export const isqrt24 = (hl, a) => isqrt(hl * 256 + a);   // 00:1D6A Isqrt24: floor(sqrt(hl * 256 + a))

// 00:1A03 AngleFromVector16: bc = angle of (x = hl, y = de) from +y toward +x
export function angleFromVector16(hl, de) {
  const x = hl, y = de;
  let bc;
  if (x === 0) bc = 0;
  else if (y === 0) bc = 0x4000;
  else {
    const ax = abs16(x), ay = abs16(y);
    const [a, q] = divAHLByDE(ax >> 8, (ax & 0xFF) << 8, ay);
    if (a) bc = 0x3FC0;
    else {
      let k = 127, b = 0;
      for (const [bit, step] of [[7, 64], [6, 32], [5, 16], [4, 8], [3, 4], [2, 2], [1, 1]]) {
        if (tangent(k) < q) { k += step; b |= 1 << bit; } else k -= step;
      }
      if (tangent(k) < q) b += 1;
      if (b === 0xFF && tangent(k + 1) < q) bc = 0x4000;
      else bc = (b << 6) & 0xFFFF;
    }
  }
  if (y & 0x8000) bc = (0x8000 - bc) & 0xFFFF;
  if (x & 0x8000) bc = neg16(bc);
  return bc;
}

function mulHLBySinHalf(hl, a) {                  // 00:0B4C MulHLBySinHalf: a in 0..$7F
  if (a & 0x40) a = (0x80 - a) & 0xFF;
  let v = (((hl * sine8(a)) & 0xFFFF) + 0x40) & 0xFFFF;
  v <<= 1;
  return ((v >> 8) & 0xFF) | (v & 0x10000 ? 0xFF00 : 0);
}
export function mulHLBySin(hl, a) {               // 00:0B3C MulHLBySin: 8-bit angle
  return a & 0x80 ? neg16(mulHLBySinHalf(hl, a & 0x7F)) : mulHLBySinHalf(hl, a);
}
export function vectorFromLengthAndAngleRaw(hl, a) {   // 00:0B31: [hl*sin(a+$40), hl*sin(a)]
  return [mulHLBySin(hl, (a + 0x40) & 0xFF), mulHLBySin(hl, a)];
}
