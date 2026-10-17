// The ROM's fixed-point arithmetic (bank 0 helpers and the bank $08 wrappers the match code calls), ported
// to plain integer JS with the same results bit for bit, including the scratch bytes some callers read
// back (hMathSign $FFA7, hMulResult $FFA8-$FFAB, hDivDividendHi/QuotientMid/QuotientHi $FFAC-$FFAE).
// Every function is checked against the ROM routine on random inputs by web/tests/engine_math.mjs.
// Names follow the gerbiljames disassembly (README "Credits"); addresses are the ROM routines'.
//
// Conventions: 16-bit register pairs are unsigned 0..$FFFF in and out unless a name says Signed; a 24-bit
// value (A:E:D style "ADE" triples, Mem24 fields) is 0..$FFFFFF.

const U16 = v => v & 0xFFFF, NEG16 = v => (-v) & 0xFFFF, NEG24 = v => (-v) & 0xFFFFFF;
const isNeg16 = v => (v & 0x8000) !== 0;

export class RomMath {
  constructor(rom, mem) {
    this.mem = mem;                                                     // MatchMemory (HRAM scratch bytes)
    const word = (bank, addr, i) => rom.u16(bank, addr + i * 2);
    this.sine = Uint16Array.from({ length: 2048 }, (_, i) => word(0x2D, 0x4000, i));       // SineTable: half turn, $8000 = 1.0
    this.cosecant = Uint16Array.from({ length: 2048 }, (_, i) => word(0x2D, 0x5000, i));   // CosecantTable
    this.tangent = Uint16Array.from({ length: 257 }, (_, i) => word(0, 0x1565, i));         // TangentTable
    this.quarterSine = Uint8Array.from({ length: 65 }, (_, i) => rom.u8(0, 0x0B5C + i));   // QuarterSineTable
    this.arcTan = Uint8Array.from({ length: 17 }, (_, i) => rom.u8(0, 0x0AB4 + i));        // ArcTanTable
    this.viewA = Uint16Array.from({ length: 0x1000 }, (_, i) => word(0x2F, 0x4000, i));    // ViewScaleTableA (cos of the tilt)
    this.viewB = Uint16Array.from({ length: 0x1000 }, (_, i) => word(0x2F, 0x6000, i));    // ViewScaleTableB (sin of the tilt)
    this.perspective = Uint8Array.from({ length: 0x4000 }, (_, i) => rom.u8(0x2E, 0x4000 + i));   // PerspectiveScaleTable
  }
  set mathSign(v) { this.mem.w8(0xFFA7, v); }
  get mathSign() { return this.mem.u8(0xFFA7); }
  setMulResult(p) { for (let i = 0; i < 4; i++) this.mem.w8(0xFFA8 + i, p >>> (8 * i)); }

  // ---- multiplication ----
  mulHLByA(hl, a) { return Math.imul(hl, a) & 0xFFFF; }                                // 00:0926 low 16 bits
  mulHLByASignedFull(hl, a) { return Math.imul(hl, a) & 0xFFFF; }                      // 00:0B9D (same bits)
  mulPosHLByA(hl, a) { return (hl * a >>> 8) & 0xFFFF; }                                // 00:0E13 bits 8-23
  mulNegHLByA(hl, a) { return this.mulPosHLByA(NEG16(hl), a); }                         // 00:0E08
  mulHLByASigned(hl, a) { return isNeg16(hl) ? NEG16(this.mulNegHLByA(hl, a)) : this.mulPosHLByA(hl, a); }   // 00:0DFA
  // 00:0BD4 MulHLByAFrac: hl * a / 256 -> { hl: whole part, a: fraction byte }
  mulHLByAFrac(hl, a) { const p = hl * a; return { hl: (p >>> 8) & 0xFFFF, a: p & 0xFF }; }
  // 00:0BB6 sign-magnitude: the whole part is negated, the fraction byte is not
  mulHLByAFracSigned(hl, a) {
    if (!isNeg16(hl)) return this.mulHLByAFrac(hl, a);
    const r = this.mulHLByAFrac(NEG16(hl), a); return { hl: NEG16(r.hl), a: r.a };
  }
  // 00:0C8F MulHLByDE: unsigned 16x16 -> 32; hMulResult = the product, returns its high word
  mulHLByDE(hl, de) { const p = hl * de; this.setMulResult(p); return Math.floor(p / 65536) & 0xFFFF; }
  // 00:0D4B MulHLByDE32: unsigned 16x16 -> { hl: high word, de: low word }, no scratch bytes
  mulHLByDE32(hl, de) { const p = hl * de; return { hl: Math.floor(p / 65536) & 0xFFFF, de: p & 0xFFFF }; }
  // 00:0C48 MulHLByDESigned: hl signed (sign-magnitude), de unsigned; the high word is negated, hMulResult is not
  mulHLByDESigned(hl, de) { return isNeg16(hl) ? NEG16(this.mulHLByDE(NEG16(hl), de)) : this.mulHLByDE(hl, de); }
  // 08:5A1D MulHLByDEAbs: hMathSign = h ^ d, then |hl| * |de| (callers read the sign and hMulResult)
  mulHLByDEAbs(hl, de) {
    this.mathSign = (hl ^ de) >> 8;
    return this.mulHLByDE(isNeg16(hl) ? NEG16(hl) : hl, isNeg16(de) ? NEG16(de) : de);
  }
  // 08:59FB MulHLByDESigned32: signed 16x16; a negative product is negated in hMulResult+0/+1 and the
  // returned high word (NegateMulResultLow 08:59E2), hMulResult+2/+3 keep the magnitude
  mulHLByDESigned32(hl, de) {
    let h = this.mulHLByDEAbs(hl, de);
    if (this.mathSign & 0x80) {
      const lo = this.mem.u8(0xFFA8) | this.mem.u8(0xFFA9) << 8, p = (NEG16(lo) + 0) & 0xFFFF;
      const borrow = lo === 0 ? 1 : 0;                                  // carry out of the low word's negation
      this.mem.w8(0xFFA8, p); this.mem.w8(0xFFA9, p >> 8);
      h = (U16(~h) + borrow) & 0xFFFF;
    }
    return h;
  }
  // 08:5A39 MulSignedHLByAFrac: hl * a / 256, sign-magnitude, result as the 24-bit (hl:a) triple negated as a whole
  mulSignedHLByAFrac(hl, a) {
    if (!isNeg16(hl)) return this.mulHLByAFrac(hl, a);
    const r = this.mulHLByAFrac(NEG16(hl), a), v = NEG24(r.hl << 8 | r.a);
    return { hl: v >> 8, a: v & 0xFF };
  }

  // ---- trigonometry (angles: 16-bit, $10000 = full turn) ----
  // 00:1361 MulSinUnsigned: (2hl mod $10000) * SineTable[(bc & $7FFF) >> 4] >> 16, for bc in the first half turn
  mulSinUnsigned(hl, bc) { return this.mulHLByDE32(this.sine[(bc & 0x7FFF) >> 4], (hl << 1) & 0xFFFF).hl; }
  mulSin(hl, bc) { return bc & 0x8000 ? NEG16(this.mulSinUnsigned(hl, bc & 0x7FFF)) : this.mulSinUnsigned(hl, bc); }   // 00:1351
  // 00:1340 MulSinCos: c's low nibble is dropped; { hl: hl*cos, de: hl*sin }
  mulSinCos(hl, bc) {
    bc &= 0xFFF0;
    const de = this.mulSin(hl, bc), cos = (bc + 0x4000) & 0xFFFF;
    return { hl: this.mulSin(hl, cos), de, bc: cos };
  }
  // 00:1332 MulSinCosSigned: a negative length turns the angle by a half turn
  mulSinCosSigned(hl, bc) { return isNeg16(hl) ? this.mulSinCos(NEG16(hl), (bc + 0x8000) & 0xFFFF) : this.mulSinCos(hl, bc); }
  // 00:13DE DivBySinUnsigned: hl * CosecantTable[...] >> 14
  divBySinUnsigned(hl, bc) { const r = this.mulHLByDE32(this.cosecant[(bc & 0x7FFF) >> 4], hl); return ((r.hl << 2) | (r.de >> 14)) & 0xFFFF; }
  divBySin(hl, bc) { return bc & 0x8000 ? NEG16(this.divBySinUnsigned(hl, bc & 0x7FFF)) : this.divBySinUnsigned(hl, bc); }    // 00:13CE
  divByCos(hl, bc) { return this.divBySin(hl, (bc + 0x4000) & 0xFFFF); }                                                   // 00:13CA
  // 00:138F VectorLengthFromAngle: length from the leg that is better conditioned for the angle in bc
  vectorLengthFromAngle(hl, de, bc) {
    const a = (((bc >> 8) & 0x7F) - 0x20) & 0xFF;
    const abs = v => isNeg16(v) ? NEG16(v) : v, sgn = v => isNeg16(v) ? NEG16(v) : v;
    if (a < 0x40) return sgn(this.divBySin(abs(de), bc));
    return sgn(this.divByCos(abs(hl), bc));
  }
  // 00:1767 GetTangent: tan of the angle in hl (TangentTable, saturating at $7FFF / $8001)
  getTangent(hl) {
    const x = (hl << 2) & 0xFFFF, carry = (hl << 2) & 0x10000;
    if (!carry) {
      const i = ((~x >> 8) & 0xFF) + 1, v = this.tangent[i];             // table word i (TangentTable + 2 + 2*(~h))
      return v & 0x8000 ? 0x7FFF : v;
    }
    const h = x >> 8; if (h === 0) return 0;
    const v = NEG16(this.tangent[h]);
    return v & 0x8000 ? v : 0x8001;
  }
  // 00:1416 AngleFromVector16: the angle of the vector (x = hl, y = de) measured from the +y axis towards +x
  // ($4000 = along +x): |x|/|y| as 8.8 looked up in TangentTable by a 7-step binary search, then mirrored by the signs
  angleFromVector16(hl, de) {
    let bc;
    if (hl === 0) bc = 0;
    else if (de === 0) bc = 0x4000;
    else {
      const ax = isNeg16(hl) ? NEG16(hl) : hl, ay = isNeg16(de) ? NEG16(de) : de;
      const q = this.divAHLByDE(ax >> 8, (ax & 0xFF) << 8, ay);        // |x| * 256 / |y|
      if (q.a) bc = 0x3FC0;
      else {
        const ratio = q.hl, T = this.tangent;
        let i = 127, b = 0;
        for (let k = 7; k >= 1; k--) {                                    // T[i] < ratio -> go up 2^(k-1), set bit k
          const step = 1 << (k - 1);
          if (T[i] < ratio) { i += step; b |= 1 << k; } else i -= step;
        }
        if (T[i] < ratio) b++;
        if (b === 0xFF && T[i + 1] < ratio) bc = 0x4000;
        else bc = (b << 6) & 0xFFFF;
      }
    }
    if (isNeg16(de)) bc = (0x8000 - bc) & 0xFFFF;
    if (isNeg16(hl)) bc = NEG16(bc);
    return bc;
  }
  // 00:0B03 MulHLBySin (character-scale): QuarterSineTable, angle byte a ($100 = full turn)
  mulHLBySinHalf(hl, a) {
    if (a & 0x40) a = (~a + 0x81) & 0xFF;
    return this.quarterSineMul(hl, this.quarterSine[a & 0x7F]);
  }
  quarterSineMul(hl, s) {                                                 // (hl * s + $40) * 2 >> 8 as the asm does
    const p = (this.mulHLByA(hl, s) + 0x40) & 0xFFFF, x = (p << 1) & 0x1FFFF;
    const hi = (x >> 8) & 0xFF, carry = x >> 16;
    return ((carry ? 0xFF : 0) << 8 | hi) & 0xFFFF;
  }
  mulHLBySin(hl, a) { return a & 0x80 ? NEG16(this.mulHLBySinHalf(hl, a & 0x7F)) : this.mulHLBySinHalf(hl, a); }
  mulHLByCos(hl, a) { return this.mulHLBySin(hl, (a + 0x40) & 0xFF); }
  // 00:0B32 MulHLBySinSigned / 00:0B30 MulHLByCosSigned: hl signed; (MulHLByASigned(hl, s) + $40) * 2, 16 bits
  mulHLBySinSigned(hl, a) {
    a &= 0xFF;
    const half = x => { if (x & 0x40) x = (~x + 0x81) & 0xFF; return ((this.mulHLByASigned(hl, this.quarterSine[x]) + 0x40) << 1) & 0xFFFF; };
    return a & 0x80 ? NEG16(half(a & 0x7F)) : half(a);
  }
  mulHLByCosSigned(hl, a) { return this.mulHLBySinSigned(hl, (a + 0x40) & 0xFF); }
  // 00:0AF8 VectorFromLengthAndAngleRaw: { de: hl*sin(a), hl: hl*cos(a) }
  vectorFromLengthAndAngleRaw(hl, a) { return { de: this.mulHLBySin(hl, a), hl: this.mulHLByCos(hl, a) }; }
  // 00:0AC5 VectorFromLengthAndAngle: the same at 1/16 precision for lengths beyond 8 bits: (hl >> 4) * sin/cos << 4
  vectorFromLengthAndAngle(hl, a) {
    const l = ((hl << 16) >> 20) & 0xFFFF;
    return { de: (this.mulHLBySin(l, a) << 4) & 0xFFFF, hl: (this.mulHLByCos(l, a) << 4) & 0xFFFF };
  }
  // 00:0A54 AngleFromVectorCoarse: the angle byte (64 = +x) of (x = hl, y = de) from ArcTanTable, 16 sectors per quadrant
  angleFromVectorCoarse(hl, de) {
    let c = 0;
    if (hl !== 0) {
      c = 0x10;
      if (de !== 0) {
        let ay = isNeg16(de) ? NEG16(de) : de, ax = isNeg16(hl) ? NEG16(hl) : hl;
        if ((ax >> 8) >= 0x10) { ay = ((ay << 16) >> 18) & 0xFFFF; ax = (ax << 2) & 0xFFFF; } else ax = (ax << 4) & 0xFFFF;
        const q = this.divHLByDE(ax, ay);
        c = 0x0F;
        if ((q >> 8) === 0) { const b = q & 0xFF; c = -1; let i = 0; do { c++; } while (this.arcTan[i++] < b); }
      }
    }
    let a = (c << 2) & 0xFF;
    if (isNeg16(de)) a = (~a + 0x81) & 0xFF;
    if (isNeg16(hl)) a = (-a) & 0xFF;
    return a;
  }

  // ---- projection (00:2D8C ProjectWorldToScreen) ----
  // MulViewScaleA/B 00:2DE9/2E39: sign * table[|v| & $1FFE] (the table holds |v| * cos/sin of the camera tilt)
  viewScale(table, v, negate = false) {
    const neg = isNeg16(v), m = neg ? NEG16(v) : v, r = table[(m & 0x1FFE) >> 1];
    return neg !== negate ? NEG16(r) : r;
  }
  // world (x = hl, depth = de, height = bc) -> { hl: screen x, bc: screen y (1/32 px, before the camera),
  // de: the rotated depth }; the perspective byte comes from PerspectiveScaleTable by the depth's high byte
  projectWorldToScreen(x, depth, height) {
    const P = (this.viewScale(this.viewA, depth) + this.viewScale(this.viewB, height)) & 0xFFFF;
    const Q = (this.viewScale(this.viewB, depth) + this.viewScale(this.viewA, height, true)) & 0xFFFF;
    const k = this.perspective[(((Q >> 8) + 0x20) & 0x3F) << 8 | (Q & 0xFF)];
    const scr = v => (((this.mulHLByASigned(v, k) << 1) + 4) << 2) & 0xFFFF;
    return { hl: scr(x), bc: scr(P), de: Q };
  }

  // ---- division ----
  // 00:0EA6 DivAHLByDE: the 24-bit a:hl over de -> 24-bit quotient { a, hl } (de = 0: $FFFFFF). Divisors
  // below $80 take the exact byte-divisor path (00:0FBC); wider ones run a non-restoring shift-subtract in three
  // 8-bit phases whose first phase shifts only the low remainder byte and whose second clears the high one, so
  // large divisors give the ROM's own (not always exact) quotients. Simulated step by step.
  divAHLByDE(a, hl, de) {
    if (de < 0x80) return de === 0 ? { a: 0xFF, hl: 0xFFFF } : this.divAHLByE(a, hl, de);
    const bc = NEG16(de);
    let rh = 0, rl = 0, acc = 0, carry = 0;
    const phase = (byte, wide) => {                                       // scf, then 8 x (adc a / rl l [/ rl h] / add hl,bc)
      acc = byte; carry = 1;
      for (let k = 0; k < 8; k++) {
        let r = acc * 2 + carry; carry = r >> 8; acc = r & 0xFF;
        r = rl * 2 + carry; carry = r >> 8; rl = r & 0xFF;
        if (wide) { r = rh * 2 + carry; carry = r >> 8; rh = r & 0xFF; }
        r = (rh << 8 | rl) + bc; carry = r >> 16; r &= 0xFFFF;             // trial subtract: carry = it fit
        if (!carry) { acc = (acc - 1) & 0xFF; r += de; carry = r >> 16; r &= 0xFFFF; }   // dec a, restore
        rh = r >> 8; rl = r & 0xFF;
      }
      return acc;
    };
    this.mem.w8(0xFFAC, a);                                               // hDivDividendHi
    const qHi = phase(a, false); this.mem.w8(0xFFAE, qHi);                // hDivQuotientHi
    rh = 0; const qMid = phase(hl >> 8, true); this.mem.w8(0xFFAD, qMid); // ld h, $00 then hDivQuotientMid
    const qLo = phase(hl & 0xFF, true);
    return { a: qHi, hl: qMid << 8 | qLo, rem: rh << 8 | rl };            // rem: the remainder left in hl (the flags depend on it)
  }
  // 00:0FBC DivAHLByE: byte divisor (< $80), exact
  divAHLByE(a, hl, e) { const q = Math.floor(((a << 16 | hl) >>> 0) / e); return { a: (q >> 16) & 0xFF, hl: q & 0xFFFF }; }
  // 00:0E6C DivAHLByDESigned: sign-magnitude on the 24-bit dividend and 16-bit divisor; hMathSign = a ^ d
  divAHLByDESigned(a, hl, de) {
    this.mathSign = a ^ (de >> 8);
    if (isNeg16(de)) de = NEG16(de);
    let n = (a << 16 | hl) >>> 0; if (a & 0x80) n = NEG24(n);
    const r = this.divAHLByDE(n >> 16, n & 0xFFFF, de);
    if (!(this.mathSign & 0x80)) return r;
    const v = NEG24(r.a << 16 | r.hl); return { a: v >> 16, hl: v & 0xFFFF };
  }
  // 00:0987 DivHLByDE: 16/16 unsigned (de = 0 -> $FFFF)
  divHLByDE(hl, de) { return de === 0 ? 0xFFFF : Math.floor(hl / de) & 0xFFFF; }

  // ---- 24/32-bit memory arithmetic (08:5A63-5AD6) ----
  negateADE(v) { return NEG24(v); }                                       // 08:5A63 on the 24-bit d:e:a
  addVel24ToPos32(posAddr, velAddr) {                                     // 08:5A87: sign-extended 24 into 32
    const m = this.mem; m.w32(posAddr, (m.s32(posAddr) + m.s24(velAddr)) | 0);
  }
  add24ToMem24(addr, v) { const m = this.mem; m.w24(addr, (m.u24(addr) + v) & 0xFFFFFF); }                  // 08:5A9E
  addDEToMem24(addr, de) { const m = this.mem; m.w24(addr, (m.u24(addr) + ((de << 16) >> 16)) & 0xFFFFFF); } // 08:5AA7 (also BC: 08:5AB7)
  addDEToMem24IntoBC(addr, de) { return ((this.mem.u24(addr) + ((de << 16) >> 16)) >> 8) & 0xFFFF; }          // 08:5AC7 integer part, no write
  // 08:5A51 MulHLByTangent: hl * tan(bc) as 8.8 -> de = bits 8-23 of the signed product (the high word's low
  // byte over hMulResult+1, which MulHLByDESigned32 left negated for a negative product)
  mulHLByTangent(hl, bc) {
    const h = this.mulHLByDESigned32(this.getTangent(bc), hl);
    return ((h & 0xFF) << 8 | this.mem.u8(0xFFA9)) & 0xFFFF;
  }
}
