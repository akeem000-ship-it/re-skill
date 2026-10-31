// Routine tests for web/js/port/home/math.js (run by web/tests/port_routines.mjs): every bank-0 math routine,
// with registers drawn from the state (deterministically: a hash of the recording and frame), edge values
// (0, 1, $7F, $80, $7FFF, $8000, $FFFF, ...) mixed in, and extra entries that force the rare branches (zero
// and wide divisors, steep vectors, angles past the tables). All registers and Z/C are compared.
const ALL = ["a", "f", "b", "c", "d", "e", "h", "l"];

function rng(s, salt) {
  let x = 2166136261 ^ salt;
  for (const ch of `${s.rec}@${s.f}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
  x = (x >>> 0) || 1;
  return n => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x % n; };
}
const E16 = [0, 1, 2, 0x7F, 0x80, 0xFF, 0x100, 0x3FFF, 0x4000, 0x7FFF, 0x8000, 0x8001, 0xC000, 0xFF00, 0xFF80, 0xFFFF];
const E8 = [0, 1, 2, 0x3F, 0x40, 0x41, 0x7F, 0x80, 0x81, 0xBF, 0xC0, 0xC1, 0xFF];
const v16 = r => (r(3) ? r(0x10000) : E16[r(E16.length)]);
const v8 = r => (r(3) ? r(256) : E8[r(E8.length)]);
// gen(r) -> { a, hl, de, bc } (any left out are random too); the flags in are random
const regsOf = (salt, gen) => s => {
  const r = rng(s, salt), g = { a: v8(r), hl: v16(r), de: v16(r), bc: v16(r), ...gen(r) };
  return { a: g.a, f: r(16) << 4, b: g.bc >> 8, c: g.bc & 0xFF, d: g.de >> 8, e: g.de & 0xFF, h: g.hl >> 8, l: g.hl & 0xFF };
};
let salt = 0;
const T = (name, addr, gen = () => ({})) => ({ name, bank: 0, addr, out: ALL, regs: regsOf(++salt * 7919, gen) });

export const ROUTINES = [
  T("SignExtendLToHL", 0x090D),
  T("Unused_00_SignExtendEToDE", 0x0914),
  T("SignExtendCToBC", 0x091B),
  T("MulHLByA", 0x0926),
  T("MulHLByA a=0/$80", 0x0926, r => ({ a: r(2) ? 0 : 0x80 })),
  T("DivHLByDE", 0x0987),
  T("DivHLByDE small de", 0x0987, r => ({ de: r(0x100) })),
  T("DivHLByDE wide de", 0x0987, r => ({ de: 0x8000 | r(0x8000) })),
  T("AngleFromVectorCoarse", 0x0A54),
  T("AngleFromVectorCoarse small", 0x0A54, r => ({ hl: (r(0x200) - 0x100) & 0xFFFF, de: (r(0x40) - 0x20) & 0xFFFF })),
  T("AngleFromVectorCoarse x>=$1000", 0x0A54, r => ({ hl: (0x1000 + r(0x7000)) ^ (r(2) ? 0xFFFF : 0), de: (r(8) - 4) & 0xFFFF })),
  T("VectorFromLengthAndAngle", 0x0AC5),
  T("Unused_00_VectorFromSignedLengthAndAngle", 0x0AEA),
  T("VectorFromLengthAndAngleRaw", 0x0AF8),
  T("MulHLByCos", 0x0B01),
  T("MulHLBySin", 0x0B03),
  T("MulHLBySinHalf", 0x0B13),
  T("MulHLByCosSigned", 0x0B30),
  T("MulHLBySinSigned", 0x0B32),
  T("MulHLBySinSignedHalf", 0x0B42),
  T("MulHLByASignedFull", 0x0B9D),
  T("MulHLByASignedFull a=0", 0x0B9D, () => ({ a: 0 })),
  T("MulHLByAFracSigned", 0x0BB6),
  T("MulHLByAFrac", 0x0BD4),
  T("MulHLByAFrac one bit", 0x0BD4, r => ({ a: r(2) ? 1 << r(8) : 0 })),
  T("MulHLByDESigned", 0x0C48),
  T("Unused_00_MulHLByDEBothSigned", 0x0C68),
  T("MulHLByDE", 0x0C8F),
  T("MulHLByDE one bit", 0x0C8F, r => ({ de: r(4) ? 1 << r(16) : 0 })),
  T("MulHLByDE32", 0x0D4B),
  T("MulHLByDE32 one bit", 0x0D4B, r => ({ de: r(4) ? 1 << r(16) : 0 })),
  T("MulHLByASigned", 0x0DFA),
  T("MulNegHLByA", 0x0E08),
  T("MulPosHLByA", 0x0E13),
  T("MulPosHLByA one bit", 0x0E13, r => ({ a: r(4) ? 1 << r(8) : 0 })),
  T("DivAHLByDESigned", 0x0E6C),
  T("DivAHLByDESigned small de", 0x0E6C, r => ({ de: (r(0x100) - 0x80) & 0xFFFF })),
  T("DivAHLByDE", 0x0EA6),
  T("DivAHLByDE de<$80", 0x0EA6, r => ({ de: r(0x80) })),
  T("DivAHLByDE de>$8000", 0x0EA6, r => ({ de: 0x8000 | r(0x8000), a: r(2) ? 0xFF : r(256) })),
  T("DivAHLByDE de $80-$1FF", 0x0EA6, r => ({ de: 0x80 + r(0x180) })),
  T("DivAHLByE", 0x0FBC),
  T("DivAHLByE e<$80", 0x0FBC, r => ({ de: r(0x80) })),
  T("GetSquareOfByte", 0x106E),
  T("Unused_00_AngleFromVector", 0x108A),
  T("Unused_00_AngleFromVector small", 0x108A, r => ({ hl: r(2) ? r(0x400) : 0xFC00 + r(0x400) })),
  T("MulSinCosSigned", 0x1332),
  T("MulSinCos", 0x1340),
  T("MulSin", 0x1351),
  T("MulSinUnsigned", 0x1361),
  T("VectorLengthFromAngle", 0x138F),
  T("DivByCos", 0x13CA),
  T("DivBySin", 0x13CE),
  T("DivBySinUnsigned", 0x13DE),
  T("AngleFromVector16", 0x1416),
  // steep vectors: the search's top entries, the quarter-turn check and quotients beyond 16 bits
  T("AngleFromVector16 steep", 0x1416, r => ({ de: ((1 + r(0x100)) ^ (r(2) ? 0xFFFF : 0)) & 0xFFFF })),
  T("AngleFromVector16 near 90", 0x1416, r => { const y = 1 + r(0x80), x = Math.min(0x7FFF, y * (0x20 + r(0xE0)) + r(y)); return { hl: r(2) ? x : -x & 0xFFFF, de: r(2) ? y : -y & 0xFFFF }; }),
];
