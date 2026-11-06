// Bank 0 arithmetic: multiplication, division, sine/cosine products, angles of vectors (00:090D-00:1564).
// Port of mul_00.asm, sine_00.asm, div_00.asm and trig_00.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm), whose routine names these are; AdvanceRandomSeed (00:0A3A) is in joypad.js.
// The values come from the match engine's exact ports (P.M, web/js/engine/math.js) where it has them.
//
// Every routine returns the registers the ROM routine leaves changed, by register name ({ hl, a, f, ... }): the
// hooks at the end write them all back, results and clobbered scratch registers alike, because unported callers
// may read them. Flags: Z and C are the ROM's (N and H are left clear: no caller can see them, the game has no
// daa). Many routines save af or bc around their work and leave those as they were; their hooks leave them alone.
// Covered by web/tests/port/routines_home_math.mjs (random and edge inputs on recorded states, every routine)
// and by the lockstep on out/engine/exh1.mtrec and rec1.mtrec, which reach 25 of the 39 entry points.

const Z = 0x80, C = 0x10;
const flags = (z, c) => (z ? Z : 0) | (c ? C : 0);
const NEG16 = v => (-v) & 0xFFFF, NEG24 = v => (-v) & 0xFFFFFF;
const isNeg16 = v => (v & 0x8000) !== 0;
const abs16 = v => (isNeg16(v) ? NEG16(v) : v);

const rROMB0 = 0x2000;                       // MBC5: ROM bank number (low 8 bits)
const QUARTER_SINE_TABLE = 0x0B5C;           // 65 bytes: sin of 0..90 degrees in 64 steps, $80 = 1.0
const TRIG_BANK = 0x2D;                      // BANK(SineTable) = BANK(CosecantTable)
const SINE_TABLE = 0x4000, COSECANT_TABLE = 0x5000;   // words, 2048 per half turn

// The ROM's negation of hl: `xor a / sub l / ld l, a / sbc a / sub h / ld h, a`. Leaves a = the new h and the
// flags of the last `sub h`: Z when the new h is 0, C when the high byte borrowed (l = 0 and h > 0).
function negateHL(hl) {
  const l = hl & 0xFF, h = hl >> 8, lowBorrow = l !== 0;
  const hi = ((lowBorrow ? 0xFF : 0) - h) & 0xFF;
  return { hl: hi << 8 | ((-l) & 0xFF), a: hi, f: flags(hi === 0, !lowBorrow && h > 0) };
}
// MulSinUnsigned and DivBySinUnsigned map the trig bank to read their table, then map hRomBank's bank back: the
// MBC is left on hRomBank's bank, and a = b = hRomBank
function restoreRomBank(P) {
  const bank = P.V.romBank;
  P.bus.w8(rROMB0, bank);
  return bank;
}

// ---- sign extension (00:090D-00:0921): `bit 7` then `dec` the high byte for a negative value ----
// Each leaves Z set for a positive byte, clear for a negative one, and C as it was.
const signExtend = (v, f) => ({ hi: v & 0x80 ? 0xFF : 0x00, f: flags(!(v & 0x80), f & C) });
// SignExtendLToHL (00:090D): h = the sign of l
export function signExtendLToHL(l, f) { const r = signExtend(l, f); return { h: r.hi, f: r.f }; }
// Unused_00_SignExtendEToDE (00:0914): d = the sign of e
export function unusedSignExtendEToDE(e, f) { const r = signExtend(e, f); return { d: r.hi, f: r.f }; }
// SignExtendCToBC (00:091B): b = the sign of c
export function signExtendCToBC(c, f) { const r = signExtend(c, f); return { b: r.hi, f: r.f }; }

// ---- multiplication by a byte ----
// MulHLByA (00:0926): hl = hl * a, low 16 bits. a is kept; the flags are those of its first `or a` (Z for
// a = 0, which returns 0 at once; C clear).
export function mulHLByA(P, hl, a) {
  return { hl: P.M.mulHLByA(hl, a), f: flags(a === 0, false) };
}
// MulHLByASignedFull (00:0B9D): the same 16 bits for a signed hl (it multiplies the magnitude and negates,
// keeping a and MulHLByA's flags around the negations)
export function mulHLByASignedFull(P, hl, a) {
  return { hl: P.M.mulHLByASignedFull(hl, a), f: flags(a === 0, false) };
}
// MulPosHLByA (00:0E13): the 24-bit product hl * a; hl = its bits 8-23 and a = its bits 16-23. The last
// shift-and-add leaves Z when a = 0 and C clear.
export function mulPosHLByA(P, hl, a) {
  const whole = P.M.mulPosHLByA(hl, a), top = whole >> 8;
  return { hl: whole, a: top, f: flags(top === 0, false) };
}
// MulNegHLByA (00:0E08): MulPosHLByA of -hl
export function mulNegHLByA(P, hl, a) { return mulPosHLByA(P, NEG16(hl), a); }
// MulHLByASigned (00:0DFA): signed hl: (hl * a) >> 8 by magnitude and sign; a negative hl leaves the negation's
// a and flags
export function mulHLByASigned(P, hl, a) {
  if (!isNeg16(hl)) return mulPosHLByA(P, hl, a);
  return negateHL(mulNegHLByA(P, hl, a).hl);
}
// MulHLByAFrac (00:0BD4): hl * a / 256 as hl (whole) and a (fraction byte). The multiplier is shifted out of a
// as the product's low bits shift in: the last `rra` leaves Z clear and C = a's bit 7 for a = $80 (one shift
// fewer), clear otherwise. a = 0 returns through `or a`.
export function mulHLByAFrac(P, hl, a) {
  const r = P.M.mulHLByAFrac(hl, a);
  return { hl: r.hl, a: r.a, f: a === 0 ? Z : flags(false, a === 0x80) };
}
// MulHLByAFracSigned (00:0BB6): the same for a signed hl: the whole part is negated, the fraction is not
export function mulHLByAFracSigned(P, hl, a) {
  if (!isNeg16(hl)) return mulHLByAFrac(P, hl, a);
  const r = mulHLByAFrac(P, NEG16(hl), a), n = negateHL(r.hl);
  return { hl: n.hl, a: r.a, f: n.f };
}

// ---- multiplication by a word ----
// MulHLByDE (00:0C8F): unsigned 16 x 16 -> 32 bits into hMulResult (low byte first); hl = the high word,
// a = the top byte (Z when it is 0, C clear)
export function mulHLByDE(P, hl, de) {
  const high = P.M.mulHLByDE(hl, de), top = high >> 8;
  return { hl: high, a: top, f: flags(top === 0, false) };
}
// MulHLByDESigned (00:0C48): hl signed: MulHLByDE of the magnitude, the high word negated (hMulResult, a and
// the flags stay MulHLByDE's)
export function mulHLByDESigned(P, hl, de) {
  if (!isNeg16(hl)) return mulHLByDE(P, hl, de);
  const r = mulHLByDE(P, NEG16(hl), de);
  return { ...r, hl: NEG16(r.hl) };
}
// Unused_00_MulHLByDEBothSigned (00:0C68): both signed: hMathSign = h ^ d, MulHLByDE of the magnitudes (de is
// left as its magnitude), the high word negated when the signs differ; otherwise a = hMathSign
export function unusedMulHLByDEBothSigned(P, hl, de) {
  const sign = (hl ^ de) >> 8, absDE = abs16(de);
  P.V.mathSign = sign;
  const r = mulHLByDE(P, abs16(hl), absDE);
  if (sign & 0x80) return { ...negateHL(r.hl), de: absDE };
  return { hl: r.hl, de: absDE, a: sign, f: flags(true, false) };
}
// MulHLByDE32 (00:0D4B): unsigned 16 x 16 -> hl = high word, de = low word, a = the top byte; no scratch bytes
export function mulHLByDE32(P, hl, de) {
  const r = P.M.mulHLByDE32(hl, de), top = r.hl >> 8;
  return { hl: r.hl, de: r.de, a: top, f: flags(top === 0, false) };
}

// ---- division ----
// DivHLByDE (00:0987): hl = hl / de, unsigned (de = 0: $FFFF). Only hl changes (af and bc are saved).
export function divHLByDE(P, hl, de) { return P.M.divHLByDE(hl, de); }
// DivAHLByE (00:0FBC): the 24-bit a:hl over e, one bit at a time: hl = the quotient's low word, a = its high
// byte. The remainder is kept in a (8 bits), so a divisor of $80 or more can lose its top bit, as on the ROM;
// e = 0 gives $FFFFFF. The flags are those of the last compare of the remainder with e. bc is saved.
export function divAHLByE(P, a, hl, e) {
  const dividend = (a << 16 | hl) >>> 0;
  let quotient = 0, rem = 0, last = 0;
  for (let bit = 23; bit >= 0; bit--) {
    rem = (rem << 1 | (dividend >>> bit & 1)) & 0xFF;
    last = rem;
    quotient <<= 1;
    if (rem >= e) { rem -= e; quotient |= 1; }
  }
  return { a: quotient >> 16, hl: quotient & 0xFFFF, f: flags(last === e, last < e) };
}
// DivAHLByDE (00:0EA6): the 24-bit a:hl over de -> a:hl. A divisor below $80 goes to DivAHLByE; a wider one
// to the ROM's three-phase shift-subtract (P.M.divAHLByDE, with its scratch bytes hDivDividendHi,
// hDivQuotientHi, hDivQuotientMid). Its last step leaves C set and Z from the last subtraction: when the last
// quotient bit is 1, Z = the shifted remainder's high byte was 0, else Z = the quotient's low byte is 0.
export function divAHLByDE(P, a, hl, de) {
  if (de < 0x80) return divAHLByE(P, a, hl, de);
  const q = P.M.divAHLByDE(a, hl, de), low = q.hl & 0xFF;
  const z = low & 1 ? ((q.rem + de) >> 8 & 0xFF) === 0 : low === 0;
  return { a: q.a, hl: q.hl, f: flags(z, true) };
}
// DivAHLByDESigned (00:0E6C): sign-magnitude: hMathSign = a ^ d, |a:hl| / |de| (de is left as its magnitude,
// b as the quotient's unsigned high byte), the quotient negated when the signs differ
export function divAHLByDESigned(P, a, hl, de) {
  const sign = a ^ (de >> 8), divisor = abs16(de);
  P.V.mathSign = sign;
  let dividend = (a << 16 | hl) >>> 0;
  if (a & 0x80) dividend = NEG24(dividend);
  const q = divAHLByDE(P, dividend >> 16, dividend & 0xFFFF, divisor);
  if (!(sign & 0x80)) return { a: q.a, b: q.a, hl: q.hl, de: divisor, f: flags(true, q.f & C) };   // `bit 7, a`
  const v = NEG24(q.a << 16 | q.hl);                                    // cpl / add 1 / adc 0: C only for 0
  return { a: v >> 16, b: q.a, hl: v & 0xFFFF, de: divisor, f: flags(v >> 16 === 0, v === 0) };
}

// ---- products with the QuarterSineTable (angle byte: $100 = full turn) ----
// MulHLBySinHalf (00:0B13): hl * sin(a) for an angle byte in the first half turn: the second quarter folded
// onto the first (a with bit 6 set: $80 - a), the table byte (index $40 = 1.0, $80 in the table) times hl,
// rounded: hl = sign:(((hl * s + $40) * 2) >> 8). Leaves a = h, C = the sign bit, Z = its opposite. An angle
// of $80 or more (never passed by MulHLBySin) indexes past the table into the code after it, as on the ROM.
function quarterSineIndex(a) { return a & 0x40 ? (~a + 0x81) & 0xFF : a; }
export function mulHLBySinHalf(P, hl, a) {
  const s = P.rom.u8(0, QUARTER_SINE_TABLE + quarterSineIndex(a));
  const r = P.M.quarterSineMul(hl, s), hi = r >> 8;
  return { hl: r, a: hi, f: flags(hi === 0, hi !== 0) };
}
// MulHLBySin (00:0B03): any angle byte: the second half turn negates
export function mulHLBySin(P, hl, a) {
  if (!(a & 0x80)) return mulHLBySinHalf(P, hl, a);
  return negateHL(mulHLBySinHalf(P, hl, a & 0x7F).hl);
}
// MulHLByCos (00:0B01): MulHLBySin a quarter turn on
export function mulHLByCos(P, hl, a) { return mulHLBySin(P, hl, (a + 0x40) & 0xFF); }
// MulHLBySinSignedHalf (00:0B42): signed hl: (MulHLByASigned(hl, s) + $40) * 2, 16 bits; a and Z stay
// MulHLByASigned's, C is the doubling's carry
export function mulHLBySinSignedHalf(P, hl, a) {
  const s = P.rom.u8(0, QUARTER_SINE_TABLE + quarterSineIndex(a));
  const m = mulHLByASigned(P, hl, s), rounded = (m.hl + 0x40) & 0xFFFF;
  return { hl: (rounded << 1) & 0xFFFF, a: m.a, f: flags(m.f & Z, isNeg16(rounded)) };
}
// MulHLBySinSigned (00:0B32) / MulHLByCosSigned (00:0B30)
export function mulHLBySinSigned(P, hl, a) {
  if (!(a & 0x80)) return mulHLBySinSignedHalf(P, hl, a);
  return negateHL(mulHLBySinSignedHalf(P, hl, a & 0x7F).hl);
}
export function mulHLByCosSigned(P, hl, a) { return mulHLBySinSigned(P, hl, (a + 0x40) & 0xFF); }

// ---- vectors from a length and an angle byte ----
// VectorFromLengthAndAngleRaw (00:0AF8): de = hl * sin(a), hl = hl * cos(a) (a and flags: MulHLByCos's)
export function vectorFromLengthAndAngleRaw(P, hl, a) {
  const de = mulHLBySin(P, hl, a).hl;
  return { ...mulHLByCos(P, hl, a), de };
}
// Unused_00_VectorFromSignedLengthAndAngle (00:0AEA): a negative length turns the angle by a half turn
export function unusedVectorFromSignedLengthAndAngle(P, hl, a) {
  if (!isNeg16(hl)) return vectorFromLengthAndAngleRaw(P, hl, a);
  return vectorFromLengthAndAngleRaw(P, NEG16(hl), (a + 0x80) & 0xFF);
}
// VectorFromLengthAndAngle (00:0AC5): the same at 1/16 precision, for lengths beyond 8 bits: the length
// shifted right 4 (arithmetic), each product shifted back left 4. Z stays MulHLByCos's, C is the last shift's.
export function vectorFromLengthAndAngle(P, hl, a) {
  const length = ((hl << 16) >> 20) & 0xFFFF;
  const de = (mulHLBySin(P, length, a).hl << 4) & 0xFFFF;
  const cos = mulHLByCos(P, length, a);
  return { hl: (cos.hl << 4) & 0xFFFF, de, a: cos.a, f: flags(cos.f & Z, cos.hl & 0x1000) };
}
// AngleFromVectorCoarse (00:0A54): the angle byte of the vector (x = hl, y = de) from ArcTanTable (P.M). Its
// sign fixes leave C set for a negative y, and Z set for a positive x (`bit 7, h`) or a zero angle.
export function angleFromVectorCoarse(P, hl, de) {
  const angle = P.M.angleFromVectorCoarse(hl, de);
  return { a: angle, f: flags(!isNeg16(hl) || angle === 0, isNeg16(de)) };
}

// ---- squares ----
// GetSquareOfByte (00:106E): hl = a * a, from SquaresTable (which holds exactly that); af is saved
export function getSquareOfByte(a) { return (a * a) & 0xFFFF; }
// Unused_00_AngleFromVector (00:108A): despite its name, a square root of hl by the digit-by-digit method, with
// the ROM's 8- and 16-bit truncations: bits 7-5 of the result come from trial subtractions on the complement's
// high byte, bits 4-1 on the whole word, and the last step rounds. hl = 0 returns a = 0 (Z set, C clear).
// Only a and the flags change (bc, de, hl are saved).
const ROOT_BYTE_STEPS = [[0x80, 0x60, 0xE0], [0x40, 0x18, 0xF8], [0x20, 0x06, 0xFE]];             // [bit, next trial if it fits, if not]
const ROOT_WORD_STEPS = [[0x10, 0x0180, 0xFF80], [0x08, 0x0060, 0xFFE0], [0x04, 0x0018, 0xFFF8], [0x02, 0x0006, 0xFFFE]];
export function unusedAngleFromVector(hl) {
  if (hl === 0) return { a: 0, f: Z };
  let rest = ~hl & 0xFFFF;                    // bc: the complement, from which the trial values are subtracted (by adding)
  let trial = 0x40, root = 0;
  for (const [bit, fits, nofit] of ROOT_BYTE_STEPS) {                   // on b alone: `add b` against the trial d
    const sum = trial + (rest >> 8);
    let next;
    if (sum > 0xFF) next = nofit;
    else { rest = (sum << 8 | (rest & 0xFF)) & 0xFFFF; root |= bit; next = fits; }
    trial = ((next + trial) & 0xFF) >> 1;                               // add d / srl a (the add's carry is lost)
  }
  let trialWord = trial << 8;                                           // de = d:e, e = 0
  for (const [bit, fits, nofit] of ROOT_WORD_STEPS) {
    const sum = trialWord + rest;
    let next;
    if (sum > 0xFFFF) next = nofit;
    else { rest = sum; root |= bit; next = fits; }
    trialWord = ((next + trialWord) & 0xFFFF) >> 1;                     // add hl, de / srl h / rr l
  }
  const carry = trialWord + rest > 0xFFFF ? 1 : 0;                      // add hl, bc / sbc $ff
  const result = (root + 1 - carry) & 0xFF;
  return { a: result, f: flags(result === 0, !(root === 0xFF && carry === 0)) };
}

// ---- products with the SineTable (angle word: $10000 = full turn) ----
// MulSinUnsigned (00:1361): hl = (2hl mod $10000) * SineTable[bc >> 4] >> 16; the table word comes from the
// trig bank (bc of $8000 or more, never passed by MulSin, reads on into the CosecantTable as the ROM does).
// Leaves a = b = hRomBank, Z when the product's top byte is 0, C clear; de is saved.
export function mulSinUnsigned(P, hl, bc) {
  const sine = P.rom.u16(TRIG_BANK, SINE_TABLE + ((bc >> 3) & 0x1FFE));
  const r = mulHLByDE32(P, sine, (hl << 1) & 0xFFFF), bank = restoreRomBank(P);
  return { hl: r.hl, a: bank, b: bank, f: r.f };
}
// MulSin (00:1351): any angle: the second half turn negates
export function mulSin(P, hl, bc) {
  if (!isNeg16(bc)) return mulSinUnsigned(P, hl, bc);
  const r = mulSinUnsigned(P, hl, bc & 0x7FFF);
  return { ...negateHL(r.hl), b: r.b };
}
// MulSinCos (00:1340): c's low nibble is dropped; de = hl * sin, hl = hl * cos (a, b, flags: the cos MulSin's)
export function mulSinCos(P, hl, bc) {
  bc &= 0xFFF0;
  const de = mulSin(P, hl, bc).hl;
  return { ...mulSin(P, hl, (bc + 0x4000) & 0xFFFF), de, c: bc & 0xFF };
}
// MulSinCosSigned (00:1332): a negative length turns the angle by a half turn
export function mulSinCosSigned(P, hl, bc) {
  if (!isNeg16(hl)) return mulSinCos(P, hl, bc);
  return mulSinCos(P, NEG16(hl), (bc + 0x8000) & 0xFFFF);
}
// DivBySinUnsigned (00:13DE): hl = hl * CosecantTable[bc >> 4] >> 14 (the trig bank, as MulSinUnsigned).
// Leaves a = b = hRomBank, Z when the result's high byte is 0, C = bit 14 of the product's high word.
export function divBySinUnsigned(P, hl, bc) {
  const cosecant = P.rom.u16(TRIG_BANK, COSECANT_TABLE + ((bc >> 3) & 0x1FFE));
  const r = P.M.mulHLByDE32(cosecant, hl), bank = restoreRomBank(P);
  const quotient = ((r.hl << 2) | (r.de >> 14)) & 0xFFFF;
  return { hl: quotient, a: bank, b: bank, f: flags(quotient >> 8 === 0, r.hl & 0x4000) };
}
// DivBySin (00:13CE): any angle: the second half turn negates
export function divBySin(P, hl, bc) {
  if (!isNeg16(bc)) return divBySinUnsigned(P, hl, bc);
  const r = divBySinUnsigned(P, hl, bc & 0x7FFF);
  return { ...negateHL(r.hl), b: r.b };
}
// DivByCos (00:13CA): DivBySin a quarter turn on
export function divByCos(P, hl, bc) { return divBySin(P, hl, (bc + 0x4000) & 0xFFFF); }
// VectorLengthFromAngle (00:138F): the length of the vector (x = hl, y = de) whose angle is bc, from the leg
// that is better conditioned: |y| / sin within 45 degrees of the x axis, |x| / cos otherwise; made positive
// (a positive result leaves the divide's a and C, with Z set by `bit 7, h`).
export function vectorLengthFromAngle(P, hl, de, bc) {
  const nearXAxis = (((bc >> 8) & 0x7F) - 0x20 & 0xFF) < 0x40;
  const r = nearXAxis ? divBySin(P, abs16(de), bc) : divByCos(P, abs16(hl), bc);
  if (isNeg16(r.hl)) return { ...negateHL(r.hl), b: r.b };
  return { hl: r.hl, a: r.a, b: r.b, f: flags(true, r.f & C) };
}

// AngleFromVector16 (00:1416): the angle word of the vector (x = hl, y = de), from the +y axis towards +x
// ($4000 = along +x). |x| * 256 / |y| (DivAHLByDE) is looked up in TangentTable (P.M.tangent, 257 words) by a
// 7-step binary search that sets bits 7-1 of the angle byte, then rounded by the next entry; a quotient beyond
// 16 bits is $3FC0, and the last entry decides between $3FC0 and a quarter turn. The signs of y and x then
// mirror it. Returns bc, with a and the flags as the ROM leaves them (hl and de are saved).
export function angleFromVector16(P, hl, de) {
  let bc, a, f;
  if (hl === 0) { bc = 0x0000; a = 0; f = Z; }                          // `or l`
  else if (de === 0) { bc = 0x4000; a = 0; f = Z; }                     // `or e`
  else {
    const x = abs16(hl), q = divAHLByDE(P, x >> 8, (x & 0xFF) << 8, abs16(de));
    if (q.a) { bc = 0x3FC0; a = q.a; f = 0; }                            // `or a`: past the table
    else {
      const ratio = q.hl, T = P.M.tangent;
      let i = 127, b = 0;
      for (let k = 7; k >= 1; k--) {                                    // T[i] < ratio: up 2^(k-1) entries and bit k
        const step = 1 << (k - 1);
        if (T[i] < ratio) { i += step; b |= 1 << k; } else i -= step;
      }
      if (T[i] < ratio) b++;                                            // round up
      const next = T[i + 1];
      if (b === 0xFF && next < ratio) {                                 // a quarter turn: a is the byte the compare stopped on
        bc = 0x4000; a = next >> 8 < ratio >> 8 ? next >> 8 : next & 0xFF; f = C;
      } else {                                                          // pack the angle byte: bc = b << 6
        bc = b << 6; a = b >> 2; f = flags(a === 0, false);
      }
    }
  }
  if (isNeg16(de)) {                                                    // c = -c, b = $80 - b - borrow
    const borrow = (bc & 0xFF) !== 0 ? 1 : 0, hi = 0x80 - (bc >> 8) - borrow;
    bc = (hi & 0xFF) << 8 | ((-bc) & 0xFF); a = hi & 0xFF; f = flags(a === 0, hi < 0);
  }
  if (isNeg16(hl)) { const n = negateHL(bc); bc = n.hl; a = n.a; f = n.f; }
  else f = flags(true, f & C);                                          // `bit 7, h`
  return { bc, a, f };
}

// ---- hooks: the registers in, every changed register back ----
const put = (c, r) => {
  for (const k in r) {
    if (k === "hl" || k === "de" || k === "bc") c[k] = r[k] & 0xFFFF;
    else if (k === "f") c.f = r.f & 0xF0;
    else c[k] = r[k] & 0xFF;
  }
};
export const HOOKS = [
  [0, 0x090D, (P, c) => put(c, signExtendLToHL(c.l, c.f))],                       // SignExtendLToHL
  [0, 0x0914, (P, c) => put(c, unusedSignExtendEToDE(c.e, c.f))],                 // Unused_00_SignExtendEToDE
  [0, 0x091B, (P, c) => put(c, signExtendCToBC(c.c, c.f))],                       // SignExtendCToBC
  [0, 0x0926, (P, c) => put(c, mulHLByA(P, c.hl, c.a))],                     // MulHLByA
  [0, 0x0987, (P, c) => { c.hl = divHLByDE(P, c.hl, c.de); }],                     // DivHLByDE
  [0, 0x0A54, (P, c) => put(c, angleFromVectorCoarse(P, c.hl, c.de))],            // AngleFromVectorCoarse
  [0, 0x0AC5, (P, c) => put(c, vectorFromLengthAndAngle(P, c.hl, c.a))],          // VectorFromLengthAndAngle
  [0, 0x0AEA, (P, c) => put(c, unusedVectorFromSignedLengthAndAngle(P, c.hl, c.a))],   // Unused_00_VectorFromSignedLengthAndAngle
  [0, 0x0AF8, (P, c) => put(c, vectorFromLengthAndAngleRaw(P, c.hl, c.a))],       // VectorFromLengthAndAngleRaw
  [0, 0x0B01, (P, c) => put(c, mulHLByCos(P, c.hl, c.a))],                        // MulHLByCos
  [0, 0x0B03, (P, c) => put(c, mulHLBySin(P, c.hl, c.a))],                        // MulHLBySin
  [0, 0x0B13, (P, c) => put(c, mulHLBySinHalf(P, c.hl, c.a))],                    // MulHLBySinHalf
  [0, 0x0B30, (P, c) => put(c, mulHLByCosSigned(P, c.hl, c.a))],                  // MulHLByCosSigned
  [0, 0x0B32, (P, c) => put(c, mulHLBySinSigned(P, c.hl, c.a))],                  // MulHLBySinSigned
  [0, 0x0B42, (P, c) => put(c, mulHLBySinSignedHalf(P, c.hl, c.a))],              // MulHLBySinSignedHalf
  [0, 0x0B9D, (P, c) => put(c, mulHLByASignedFull(P, c.hl, c.a))],           // MulHLByASignedFull
  [0, 0x0BB6, (P, c) => put(c, mulHLByAFracSigned(P, c.hl, c.a))],               // MulHLByAFracSigned
  [0, 0x0BD4, (P, c) => put(c, mulHLByAFrac(P, c.hl, c.a))],                      // MulHLByAFrac
  [0, 0x0C48, (P, c) => put(c, mulHLByDESigned(P, c.hl, c.de))],                  // MulHLByDESigned
  [0, 0x0C68, (P, c) => put(c, unusedMulHLByDEBothSigned(P, c.hl, c.de))],        // Unused_00_MulHLByDEBothSigned
  [0, 0x0C8F, (P, c) => put(c, mulHLByDE(P, c.hl, c.de))],                        // MulHLByDE
  [0, 0x0D4B, (P, c) => put(c, mulHLByDE32(P, c.hl, c.de))],                      // MulHLByDE32
  [0, 0x0DFA, (P, c) => put(c, mulHLByASigned(P, c.hl, c.a))],                    // MulHLByASigned
  [0, 0x0E08, (P, c) => put(c, mulNegHLByA(P, c.hl, c.a))],                       // MulNegHLByA
  [0, 0x0E13, (P, c) => put(c, mulPosHLByA(P, c.hl, c.a))],                       // MulPosHLByA
  [0, 0x0E6C, (P, c) => put(c, divAHLByDESigned(P, c.a, c.hl, c.de))],            // DivAHLByDESigned
  [0, 0x0EA6, (P, c) => put(c, divAHLByDE(P, c.a, c.hl, c.de))],                  // DivAHLByDE
  [0, 0x0FBC, (P, c) => put(c, divAHLByE(P, c.a, c.hl, c.e))],                    // DivAHLByE
  [0, 0x106E, (P, c) => { c.hl = getSquareOfByte(c.a); }],                         // GetSquareOfByte
  [0, 0x108A, (P, c) => put(c, unusedAngleFromVector(c.hl))],                      // Unused_00_AngleFromVector
  [0, 0x1332, (P, c) => put(c, mulSinCosSigned(P, c.hl, c.bc))],                  // MulSinCosSigned
  [0, 0x1340, (P, c) => put(c, mulSinCos(P, c.hl, c.bc))],                        // MulSinCos
  [0, 0x1351, (P, c) => put(c, mulSin(P, c.hl, c.bc))],                           // MulSin
  [0, 0x1361, (P, c) => put(c, mulSinUnsigned(P, c.hl, c.bc))],                   // MulSinUnsigned
  [0, 0x138F, (P, c) => put(c, vectorLengthFromAngle(P, c.hl, c.de, c.bc))],      // VectorLengthFromAngle
  [0, 0x13CA, (P, c) => put(c, divByCos(P, c.hl, c.bc))],                         // DivByCos
  [0, 0x13CE, (P, c) => put(c, divBySin(P, c.hl, c.bc))],                         // DivBySin
  [0, 0x13DE, (P, c) => put(c, divBySinUnsigned(P, c.hl, c.bc))],                 // DivBySinUnsigned
  [0, 0x1416, (P, c) => put(c, angleFromVector16(P, c.hl, c.de))],                // AngleFromVector16
];
