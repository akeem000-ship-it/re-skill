// Fuzz the engine's math helpers (web/js/engine/math.js) against the ROM routines on the JS core's
// interpreter: random inputs, registers and the HRAM scratch bytes compared.
// usage: node web/tests/engine_math.mjs [N per routine] [name filter]
import { newCore, romObject } from "./engine/corpus.mjs";
import { romCall } from "./engine/romcall.mjs";
import { MatchMemory } from "../js/engine/memory.js";
import { RomMath } from "../js/engine/math.js";

const N = +(process.argv[2] || 3000), filter = process.argv[3] || "";
const gb = await newCore({ recomp: false }); gb.cpu.sp = 0xDE00;
const rom = romObject(), mem = new MatchMemory(), M = new RomMath(rom, mem);
let seed = 12345; const rnd = n => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
const r16 = () => [0, 1, 0x7FFF, 0x8000, 0xFFFF, 0x80, 0x100][rnd(40)] ?? rnd(0x10000), r8 = () => [0, 1, 0x7F, 0x80, 0xFF][rnd(30)] ?? rnd(256);
const hram = () => [0xA7, 0xA8, 0xA9, 0xAA, 0xAB].map(i => gb.mem.hram[i - 0x80]);
const syncHram = () => { mem.hram.set(gb.mem.hram); };
const hex = v => typeof v === "number" ? "$" + v.toString(16) : JSON.stringify(v);
// [name, bank, addr, regs(inputs) -> core regs, js(inputs) -> expected {reg: value}, compare hram bytes?]
const T = [
  ["MulHLByA", 0, 0x0926, () => ({ hl: r16(), a: r8() }), i => ({ hl: M.mulHLByA(i.hl, i.a) })],
  ["MulHLByASignedFull", 0, 0x0B9D, () => ({ hl: r16(), a: r8() }), i => ({ hl: M.mulHLByASignedFull(i.hl, i.a) })],
  ["MulPosHLByA", 0, 0x0E13, () => ({ hl: r16(), a: r8() }), i => ({ hl: M.mulPosHLByA(i.hl, i.a) })],
  ["MulHLByASigned", 0, 0x0DFA, () => ({ hl: r16(), a: r8() }), i => ({ hl: M.mulHLByASigned(i.hl, i.a) })],
  ["MulHLByAFrac", 0, 0x0BD4, () => ({ hl: r16(), a: r8() }), i => { const r = M.mulHLByAFrac(i.hl, i.a); return { hl: r.hl, a: r.a }; }],
  ["MulHLByAFracSigned", 0, 0x0BB6, () => ({ hl: r16(), a: r8() }), i => { const r = M.mulHLByAFracSigned(i.hl, i.a); return { hl: r.hl, a: r.a }; }],
  ["MulHLByDE", 0, 0x0C8F, () => ({ hl: r16(), de: r16() }), i => ({ hl: M.mulHLByDE(i.hl, i.de) }), true],
  ["MulHLByDE32", 0, 0x0D4B, () => ({ hl: r16(), de: r16() }), i => M.mulHLByDE32(i.hl, i.de)],
  ["MulHLByDESigned", 0, 0x0C48, () => ({ hl: r16(), de: r16() }), i => ({ hl: M.mulHLByDESigned(i.hl, i.de) }), true],
  ["MulHLByDEAbs", 8, 0x5A1D, () => ({ hl: r16(), de: r16() }), i => ({ hl: M.mulHLByDEAbs(i.hl, i.de) }), true],
  ["MulHLByDESigned32", 8, 0x59FB, () => ({ hl: r16(), de: r16() }), i => ({ hl: M.mulHLByDESigned32(i.hl, i.de) }), true],
  ["MulSignedHLByAFrac", 8, 0x5A39, () => ({ hl: r16(), a: r8() }), i => { const r = M.mulSignedHLByAFrac(i.hl, i.a); return { hl: r.hl, a: r.a }; }],
  ["MulSin", 0, 0x1351, () => ({ hl: r16(), bc: r16() }), i => ({ hl: M.mulSin(i.hl, i.bc) })],
  ["MulSinCos", 0, 0x1340, () => ({ hl: r16(), bc: r16() }), i => { const r = M.mulSinCos(i.hl, i.bc); return { hl: r.hl, de: r.de }; }],
  ["MulSinCosSigned", 0, 0x1332, () => ({ hl: r16(), bc: r16() }), i => { const r = M.mulSinCosSigned(i.hl, i.bc); return { hl: r.hl, de: r.de }; }],
  ["DivBySin", 0, 0x13CE, () => ({ hl: r16(), bc: r16() }), i => ({ hl: M.divBySin(i.hl, i.bc) })],
  ["DivByCos", 0, 0x13CA, () => ({ hl: r16(), bc: r16() }), i => ({ hl: M.divByCos(i.hl, i.bc) })],
  ["VectorLengthFromAngle", 0, 0x138F, () => ({ hl: r16(), de: r16(), bc: r16() }), i => ({ hl: M.vectorLengthFromAngle(i.hl, i.de, i.bc) })],
  ["GetTangent", 0, 0x1767, () => ({ hl: r16() }), i => ({ hl: M.getTangent(i.hl) })],
  ["AngleFromVector16", 0, 0x1416, () => ({ hl: r16(), de: r16() }), i => ({ bc: M.angleFromVector16(i.hl, i.de) })],
  ["MulHLBySin", 0, 0x0B03, () => ({ hl: r16(), a: r8() }), i => ({ hl: M.mulHLBySin(i.hl, i.a) })],
  ["MulHLByCos", 0, 0x0B01, () => ({ hl: r16(), a: r8() }), i => ({ hl: M.mulHLByCos(i.hl, i.a) })],
  ["MulHLBySinSigned", 0, 0x0B32, () => ({ hl: r16(), a: r8() }), i => ({ hl: M.mulHLBySinSigned(i.hl, i.a) })],
  ["MulHLByCosSigned", 0, 0x0B30, () => ({ hl: r16(), a: r8() }), i => ({ hl: M.mulHLByCosSigned(i.hl, i.a) })],
  ["VectorFromLengthAndAngleRaw", 0, 0x0AF8, () => ({ hl: r16(), a: r8() }), i => M.vectorFromLengthAndAngleRaw(i.hl, i.a)],
  ["VectorFromLengthAndAngle", 0, 0x0AC5, () => ({ hl: r16(), a: r8() }), i => M.vectorFromLengthAndAngle(i.hl, i.a)],
  ["AngleFromVectorCoarse", 0, 0x0A54, () => ({ hl: r16(), de: r16() }), i => ({ a: M.angleFromVectorCoarse(i.hl, i.de) })],
  ["DivAHLByDE", 0, 0x0EA6, () => ({ a: r8(), hl: r16(), de: r16() }), i => { const r = M.divAHLByDE(i.a, i.hl, i.de); return { a: r.a, hl: r.hl }; }],
  ["DivAHLByDE/small", 0, 0x0EA6, () => ({ a: r8(), hl: r16(), de: 1 + rnd(0x7F) }), i => { const r = M.divAHLByDE(i.a, i.hl, i.de); return { a: r.a, hl: r.hl }; }],
  ["DivAHLByDESigned", 0, 0x0E6C, () => ({ a: r8(), hl: r16(), de: r16() }), i => { const r = M.divAHLByDESigned(i.a, i.hl, i.de); return { a: r.a, hl: r.hl }; }],
  ["ProjectWorldToScreen", 0, 0x2D8C, () => ({ hl: r16(), de: r16(), bc: r16() }), i => M.projectWorldToScreen(i.hl, i.de, i.bc)],
  ["DivHLByDE", 0, 0x0987, () => ({ hl: r16(), de: r16() }), i => ({ hl: M.divHLByDE(i.hl, i.de) })],
  ["MulHLByTangent", 8, 0x5A51, () => ({ hl: r16(), bc: r16() }), i => ({ de: M.mulHLByTangent(i.hl, i.bc) }), true],
];
let bad = 0;
for (const [name, bank, addr, gen, js, cmpHram] of T) {
  if (filter && !name.includes(filter)) continue;
  let fails = 0, first = null;
  for (let k = 0; k < N; k++) {
    const i = gen(), regs = { a: i.a ?? 0, h: (i.hl ?? 0) >> 8, l: (i.hl ?? 0) & 0xFF, d: (i.de ?? 0) >> 8, e: (i.de ?? 0) & 0xFF, b: (i.bc ?? 0) >> 8, c: (i.bc ?? 0) & 0xFF };
    for (const x of [0xA7, 0xA8, 0xA9, 0xAA, 0xAB, 0xAC, 0xAD, 0xAE]) gb.mem.hram[x - 0x80] = rnd(256);
    syncHram(); gb.cpu.sp = 0xDE00;
    const out = romCall(gb, bank, addr, regs), want = js(i);
    const diff = Object.keys(want).filter(r => (want[r] & (r.length === 1 ? 0xFF : 0xFFFF)) !== out[r]);
    if (cmpHram) { const h = hram(); [0xA7, 0xA8, 0xA9, 0xAA, 0xAB].forEach((x, j) => { if (mem.hram[x - 0x80] !== h[j]) diff.push(`ram${x.toString(16)}`); }); }
    if (diff.length) { fails++; if (!first) first = { in: Object.fromEntries(Object.entries(i).map(([k, v]) => [k, hex(v)])), diff, rom: Object.fromEntries(diff.map(r => [r, r.startsWith("ram") ? hex(gb.mem.hram[parseInt(r.slice(3), 16) - 0x80]) : hex(out[r])])), js: Object.fromEntries(diff.map(r => [r, r.startsWith("ram") ? hex(mem.hram[parseInt(r.slice(3), 16) - 0x80]) : hex(want[r])])) }; }
  }
  if (fails) bad++;
  console.log(`${fails ? "FAIL" : "ok  "} ${name.padEnd(28)} ${fails}/${N}` + (first ? "  " + JSON.stringify(first) : ""));
}
process.exit(bad ? 1 : 0);
