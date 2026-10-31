// Routines no test screen reaches (the other banks' copies of ported code, unreferenced or debug-only code) against
// the ROM's on the emulator core's interpreter (web/tests/golf/romcall.mjs): the same pseudo-random RAM (WRAM 0-7 and
// HRAM) and registers in; the registers named, all WRAM (but the stack page $CF00-$CFFF) and HRAM compared after.
// usage: node web/tests/golf_fuzz_routines.mjs [name filter] [N per case]
import { useRom, rb } from "../js/golf/rom.js";
import { GolfMemory } from "../js/golf/memory.js";
import { newCore, romCall, romBytes, loadCore } from "./golf/romcall.mjs";
import { mapTileAnimStart, mapTileAnimTask, mapTileAnimStep, mapTileAnimStop } from "../js/golf/mapgfx.js";
import { holeTileAnimStep } from "../js/golf/render/holeview.js";
import { speedTable, powerScaleLookup } from "../js/golf/launch.js";
import * as M from "../js/golf/math.js";
import * as U from "../js/golf/unreached.js";
import * as H from "../js/golf/home.js";
import * as R0C from "../js/golf/records0c.js";
import * as S3E from "../js/golf/standings.js";
import * as SC from "../js/golf/scorecard.js";
import { loadText } from "../js/golf/text.js";
import * as SER from "../js/golf/serial.js";
import * as B34 from "../js/golf/maps/bank34.js";
import * as AIM from "../js/golf/aim.js";
import * as MB from "../js/golf/msgbox.js";
import * as RD from "../js/golf/round.js";
import * as CS from "../js/golf/charsel.js";
import * as EXP from "../js/golf/exp.js";

useRom(romBytes());
const filter = process.argv.slice(2).find(a => !/^\d+$/.test(a)) || "";
const N = +(process.argv.slice(2).find(a => /^\d+$/.test(a)) || 300);
let seed = 0x13579bdf;
const rnd = n => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
const gb = newCore();
const cpuStep = gb.cpu.step.bind(gb.cpu);

// the copies of the map tile animation (28:7D0B MapTileAnimStart, +$A7 Stop, +$B6 Task, +$FD Step)
const ANIM = { 0x28: 0x7D0B, 0x29: 0x7927, 0x2A: 0x76BF, 0x2B: 0x73ED, 0x2C: 0x7AD1, 0x2D: 0x739D, 0x2E: 0x79D5,
  0x2F: 0x7D20, 0x72: 0x76BD, 0x73: 0x76C7, 0x74: 0x79AE };
// a track state as MapTileAnimStart leaves it (the JS one, itself checked above) for an animation of the bank
// that has one, its timers random 1-3 and some frames advanced
const ANIMATED = {};
for (const b of Object.keys(ANIM)) ANIMATED[b] = [];
const SLOTS = [0x28, 0x29, 0x2A, 0x2B, 0x2C, 0x2D, 0x2E, 0x2F, 0x72, 0x73];   // (mapgfx.js ANIM_BANKS; else $74)
for (let id = 0; id < 0x50; id++) {             // the graphics ids of MapGfxAnimTable 0B:42C0: (sub id, bank slot)
  const sub = rb(0x0B, 0x42C0 + 2 * id), bank = SLOTS[rb(0x0B, 0x42C1 + 2 * id)] ?? 0x74;
  const t = { 0x28: 0x405E, 0x2C: 0x405E, 0x2A: 0x4028, 0x2D: 0x4028 }[bank] || 0x403A;
  const q = rb(bank, t + 2 * sub) | rb(bank, t + 2 * sub + 1) << 8;
  if (q < 0x4000 || q >= 0x7F00) continue;      // (ids past the table: junk)
  let end = false;
  for (let k = 0; k < 0x100 && !end; k++) end = rb(bank, q + k) === 0xFE;
  if (end && rb(bank, q) !== 0xFE && !ANIMATED[bank].includes(sub)) ANIMATED[bank].push(sub);
}
// the sub ids MapTileAnimStart is given: the animated ones and those with no animation ($FE first) among 0-7
const STARTS = {};
for (const b of Object.keys(ANIM)) {
  const t = { 0x28: 0x405E, 0x2C: 0x405E, 0x2A: 0x4028, 0x2D: 0x4028 }[b] || 0x403A;
  STARTS[b] = [...ANIMATED[b]];
  for (let a = 0; a < 8; a++) { const q = rb(+b, t + 2 * a) | rb(+b, t + 2 * a + 1) << 8; if (q >= 0x4000 && q < 0x8000 && rb(+b, q) === 0xFE) STARTS[b].push(a); }
}
const animTracks = (w, bank) => {
  const list = ANIMATED[bank];
  if (!list.length) return false;
  w.high[0x195] = bank;
  mapTileAnimStart(w, bank, list[rnd(list.length)]);
  w.wram[0].fill(0, 0x1C0, 0x200);
  for (let n = rnd(6); n; n--) { const k = rnd(4); if (w.wram[0][0x338 + k] !== 0xFF) try { mapTileAnimStep(w, bank, k); } catch (e) { break; } }
  w.wram[0].fill(0, 0x0A0, 0x0F0);
  for (let k = 0; k < 4; k++) w.wram[0][0x331 + 2 * k] = 1 + rnd(3);
  return true;
};
const CASES = [];
for (const [b, s] of Object.entries(ANIM)) {
  const bank = +b, h = bank.toString(16);
  CASES.push({ name: `MapTileAnimStart_${h}`, bank, addr: s, regs: () => ({ a: STARTS[bank][rnd(STARTS[bank].length)] }), js: (w, r) => mapTileAnimStart(w, bank, r.a) });
  CASES.push({ name: `MapTileAnimStop_${h}`, bank, addr: s + 0xA7, init: w => { if (rnd(2)) { const t = w.wram[0]; t[0x1C0] = 1; t[0x1C1] = (s + 0xB6) & 0xFF; t[0x1C2] = (s + 0xB6) >> 8; t[0x1C3] = bank; } }, js: w => mapTileAnimStop(w, bank) });
  if (!ANIMATED[bank].length) {                // (a bank without animations: its Task runs with no tracks; its Step never)
    CASES.push({ name: `MapTileAnimTask_${h}`, bank, addr: s + 0xB6, init: w => w.wram[0].fill(0xFF, 0x338, 0x33C), js: w => mapTileAnimTask(w, bank) });
    continue;
  }
  CASES.push({ name: `MapTileAnimTask_${h}`, bank, addr: s + 0xB6, init: w => animTracks(w, bank), js: w => mapTileAnimTask(w, bank) });
  CASES.push({ name: `MapTileAnimStep_${h}`, bank, addr: s + 0xFD, init: w => animTracks(w, bank),
    regs: w => { let k; do k = rnd(4); while (w.wram[0][0x338 + k] === 0xFF); return { a: k }; }, js: (w, r) => mapTileAnimStep(w, bank, r.a) });
}
// the distance -> launch speed stubs of bank 10 (10:6D8A-10:6DAA) and their routines in banks 38-3A
[0x6D8A, 0x6D8A, 0x6D8A, 0x6D8A, 0x6D8A, 0x6D8E, 0x6D92, 0x6D96, 0x6D9A, 0x6D9E, 0x6DA2, 0x6DA6, 0x6DAA, 0x6DAA, 0x6DAA, 0x6DAA].forEach((addr, k) => {
  CASES.push({ name: `LaunchSpeedClass_${k - 8}`, bank: 0x10, addr, init: w => { w.wram[6][0x4C8] = (k - 8) & 0xFF; w.wram[6][0x32A] = rnd(4); },
    regs: () => ({ c: rnd(15), d: 0, e: rnd(0x80) }), out: ["h", "l"],   // (de < $80: within the tables)
    js: (w, r) => { const hl = speedTable(w, r.c, r.d << 8 | r.e); return { h: hl >> 8, l: hl & 0xFF }; } });
});
// bank 40's unreferenced copies of the multiply and divide
CASES.push({ name: "MulHLByDE_40", bank: 0x40, addr: 0x5AA9, regs: () => ({ h: rnd(256), l: rnd(256), d: rnd(256), e: rnd(256) }), out: ["h", "l"],
  js: (w, r) => { const v = U.mulHLByDE40(w, r.h << 8 | r.l, r.d << 8 | r.e); return { h: v >> 8, l: v & 0xFF }; } });
CASES.push({ name: "DivAHLByDE_40", bank: 0x40, addr: 0x599C, regs: () => ({ a: rnd(256), h: rnd(256), l: rnd(256), d: rnd(4) ? rnd(256) : 0, e: rnd(256) }), out: ["a", "h", "l"],
  js: (w, r) => U.divAHLByDE40(w, r.a, r.h << 8 | r.l, r.d << 8 | r.e) });
// the home bank's helpers (home.js)
const r16 = () => rnd(0x10000), hl8 = v => ({ h: v >> 8, l: v & 0xFF });
const HOME = [
  ["NegDE", 0, 0x0C67, () => ({ d: rnd(256), e: rnd(256) }), (w, r) => { const v = H.negDE(r.d << 8 | r.e); return { d: v >> 8, e: v & 0xFF }; }, ["d", "e"]],
  ["NegateHL", 0, 0x21E0, () => ({ h: rnd(256), l: rnd(256) }), (w, r) => hl8(H.negateHL(r.h << 8 | r.l)), ["h", "l"]],
  ["NegateBC", 0, 0x21E8, () => ({ b: rnd(256), c: rnd(256) }), (w, r) => { const v = H.negateBC(r.b << 8 | r.c); return { b: v >> 8, c: v & 0xFF }; }, ["b", "c"]],
  ["SubHLBC", 0, 0x1B52, () => ({ h: rnd(256), l: rnd(256), b: rnd(4) ? rnd(256) : 0, c: rnd(4) ? rnd(256) : 0 }), (w, r) => hl8(H.subHLBC(r.h << 8 | r.l, r.b << 8 | r.c)), ["h", "l"]],
  ["MulHLByDESigned", 0, 0x0C6E, () => ({ h: rnd(256), l: rnd(256), d: rnd(256), e: rnd(256) }), (w, r) => hl8(H.mulHLByDESigned(w, r.h << 8 | r.l, r.d << 8 | r.e)), ["h", "l"]],
  ["VectorFromSignedLengthAndAngle", 0, 0x0B23, () => ({ h: rnd(256), l: rnd(256), a: rnd(256) }), (w, r) => { const [x, y] = H.vectorFromSignedLengthAndAngle(r.h << 8 | r.l, r.a); return { h: x >> 8, l: x & 0xFF, d: y >> 8, e: y & 0xFF }; }, ["h", "l", "d", "e"]],
  ["DecimalDigitBySubtract", 0, 0x21CF, () => { const v = rnd(0x8000), p = [10000, 1000, 100, 10, 1][rnd(5)]; return { h: v >> 8, l: v & 0xFF, b: p >> 8, c: p & 0xFF }; }, (w, r) => { const [d, hl] = H.decimalDigitBySubtract(r.h << 8 | r.l, r.b << 8 | r.c); return { d, ...hl8(hl), b: r.b, c: r.c }; }, ["d", "h", "l", "b", "c"]],
  ["ExtractDecimalDigitUnsigned", 0, 0x23AF, () => { const v = rnd(0x10000), p = (-[10000, 1000, 100, 10][rnd(4)]) & 0xFFFF; return { h: v >> 8, l: v & 0xFF, b: p >> 8, c: p & 0xFF }; }, (w, r) => { const [a, hl] = H.extractDecimalDigitUnsigned(r.h << 8 | r.l, r.b << 8 | r.c); return { a, ...hl8(hl) }; }, ["a", "h", "l"]],
  ["Compare3Bytes", 0, 0x23C6, w => { const de = 0xC400 + rnd(0x100), hl = 0xC600 + rnd(0x100); if (rnd(2)) for (let k = 0; k < 3; k++) w.wram[0][hl - 0xC000 + k] = w.wram[0][de - 0xC000 + k] ^ (rnd(3) === k ? 1 : 0); return { d: de >> 8, e: de & 0xFF, h: hl >> 8, l: hl & 0xFF }; }, (w, r) => ({ a: H.compare3Bytes(w, r.d << 8 | r.e, r.h << 8 | r.l) }), ["a"]],
  ["Check3BytesZero", 0, 0x23E1, w => { const hl = 0xC400 + rnd(0x100); if (rnd(2)) for (let k = 0; k < 3; k++) w.wram[0][hl - 0xC000 + k] = rnd(3) === k ? rnd(256) : 0; return { h: hl >> 8, l: hl & 0xFF }; }, (w, r) => ({ a: H.check3BytesZero(w, r.h << 8 | r.l) }), ["a"]],
  ...[["Red", 0x252E, 0], ["Green", 0x253A, 1], ["Blue", 0x254A, 2]].map(([n, addr, k]) => [`AdjustColor${n}`, 0, addr, () => ({ a: rnd(256), b: rnd(256), c: rnd(256), d: rnd(256), e: rnd(256) }),
    (w, r) => { const v = H.adjustColor(r.b << 8 | r.c, r.d, k); return { a: r.a, b: v >> 8, c: v & 0xFF, d: r.d, e: r.e }; }, ["a", "b", "c", "d", "e"]]),
  ["FormatSignedDecimalPadded", 0, 0x211D, () => { const de = 0xC400 + rnd(0x100), v = rnd(3) ? rnd(0x10000) : rnd(200) - 100; return { a: rnd(3) ? rnd(8) : rnd(256), ...hl8(v & 0xFFFF), d: de >> 8, e: de & 0xFF, b: rnd(256), c: rnd(256) }; },
    (w, r) => { const de = H.formatSignedDecimalPadded(w, r.h << 8 | r.l, r.a, r.d << 8 | r.e); return { a: 0, b: r.b, c: r.c, d: de >> 8, e: de & 0xFF }; }, ["a", "b", "c", "d", "e"]],
  ["PrintHexWord", 0, 0x22BC, () => ({ h: rnd(256), l: rnd(256), d: rnd(32), e: rnd(0x18), a: rnd(256) }), (w, r) => { H.printHexWord(w, r.h << 8 | r.l, r.d << 8 | r.e); return { a: r.a, h: r.h, l: r.l, d: r.d, e: r.e }; }, ["a", "h", "l", "d", "e"]],
  ["PrintDecimalByteSigned", 0, 0x22E9, () => ({ a: rnd(256), d: rnd(32), e: rnd(0x18), h: rnd(256), l: rnd(256) }), (w, r) => { H.printDecimalByteSigned(w, r.a, r.d << 8 | r.e); return { a: r.a, h: r.h, l: r.l, d: r.d, e: r.e }; }, ["a", "h", "l", "d", "e"]],
  ["MatchCompare16", 0x3E, 0x6637, () => ({ b: rnd(256), c: rnd(256), d: rnd(256), e: rnd(256) }), (w, r) => ({ a: H.matchCompare16(r.b << 8 | r.c, r.d << 8 | r.e) }), ["a"]],
];
for (const [name, bank, addr, regs, js, out] of HOME) CASES.push({ name, bank, addr, regs, js, out });
// bank 02 / 0B / 10 / 3E / 48 helpers (unreached.js)
const MORE = [
  ["GetCharRecord", 0x02, 0x4E39, () => ({}), () => ({ b: 0xC8, c: 0x00 }), ["b", "c"]],
  ["TestBitN", 0x02, 0x5D11, () => { const hl = 0xC400 + rnd(0x100); return { a: rnd(24), h: hl >> 8, l: hl & 0xFF }; }, (w, r) => ({ a: U.testBitN(w, r.h << 8 | r.l, r.a) }), ["a"]],
  ["AddPointsSigned", 0x02, 0x544E, () => ({ d: rnd(256), e: rnd(256) }), (w, r) => { const hl = U.addPointsSigned(w, r.d << 8 | r.e); return { h: hl >> 8, l: hl & 0xFF }; }, ["h", "l"]],
  ["TargetCupDist", 0x10, 0x621E, w => { for (const a of [0x426, 0x428, 0x43D, 0x43F]) w.wram[6][a + 1] = rnd(0x40); return {}; }, w => { const hl = U.targetCupDist(w); return { h: hl >> 8, l: hl & 0xFF }; }, ["h", "l"]],
  ["SignOfDiff", 0x48, 0x497E, () => ({ b: rnd(256), c: rnd(256), d: rnd(256), e: rnd(256) }), (w, r) => ({ a: U.signOfDiff(r.b << 8 | r.c, r.d << 8 | r.e) }), ["a"]],
  ["HoleStrokesPlusPutts", 0x0B, 0x65DE, () => ({ a: rnd(3), b: rnd(256), c: rnd(0x13) }), (w, r) => ({ a: U.holeStrokesPlusPutts(w, r.a, r.c) }), ["a"]],
  ["SumPlayerHoleCounts", 0x0B, 0x656F, () => ({ a: rnd(2) }), (w, r) => ({ a: r.a, d: U.sumPlayerHoleCounts(w, r.a) }), ["a", "d"]],
  ["CountHolesWon", 0x0B, 0x6585, () => ({}), w => { const [a, d, e] = U.countHolesWon(w); return { a, d, e }; }, ["a", "d", "e"]],
  ["DivATen", 0x3E, 0x630C, () => ({ a: rnd(256) }), (w, r) => ({ a: U.divATen(r.a) }), ["a"]],
  ["ModATen", 0x3E, 0x631E, () => ({ a: rnd(256) }), (w, r) => ({ a: U.modATen(r.a) }), ["a"]],
  ["MatchScoreToWord", 0x3E, 0x6342, () => ({ a: rnd(256) }), (w, r) => { const hl = U.matchScoreToWord(r.a); return { h: hl >> 8, l: hl & 0xFF }; }, ["h", "l"]],
];
for (const [name, bank, addr, regs, js, out] of MORE) CASES.push({ name, bank, addr, regs, js, out });
// bank 0C's dead routines (records0c.js)
const sync = g => { for (let r = g.next(); !r.done; r = g.next()) throw new Error("it runs frames"); };
const statsState = w => { w.wram[6][0x214] = rnd(7); w.wram[6][0x215] = rnd(2) ? 0x14 : 0; w.wram[6][0x23B] = rnd(2); };
CASES.push({ name: "ClearStatsColumn", bank: 0x0C, addr: 0x5725, init: statsState, js: w => R0C.clearStatsColumn(w) });
CASES.push({ name: "CopyTextIdToBuffer", bank: 0x0C, addr: 0x5772, regs: () => { const id = 0x1105 + rnd(0x20), de = 0xC400 + rnd(0x100); return { h: id >> 8, l: id & 0xFF, c: 1 + rnd(7), d: de >> 8, e: de & 0xFF }; }, js: (w, r) => R0C.copyTextIdToBuffer(w, r.h << 8 | r.l, r.c, r.d << 8 | r.e) });
CASES.push({ name: "TestProfileHoleBit", bank: 0x0C, addr: 0x57E7, regs: () => ({ b: rnd(5), c: rnd(0x18) }), out: ["a", "b", "c"], js: (w, r) => ({ a: R0C.testProfileHoleBit(w, r.b, r.c), b: r.b, c: r.c }) });
CASES.push({ name: "FillBytes2", bank: 0x0C, addr: 0x6794, regs: () => { const hl = 0xC400 + rnd(0x100); return { a: rnd(256), c: rnd(256), h: hl >> 8, l: hl & 0xFF }; }, out: ["h", "l", "c"], js: (w, r) => { const hl = R0C.fillBytes2(w, r.h << 8 | r.l, r.c, r.a); return { h: hl >> 8, l: hl & 0xFF, c: 0 }; } });
CASES.push({ name: "RedrawStatsFrame", bank: 0x0C, addr: 0x55B7, init: w => { statsState(w); w.wram[0].fill(0, 0x36A, 0x372); },   // (a fresh glyph pen)
   js: w => sync(R0C.redrawStatsFrame({ w, advance: function* () { yield; }, sound: () => {} })) });
// more helpers (unreached.js, launch.js)
CASES.push({ name: "PowerScaleLookup", bank: 0x10, addr: 0x6DAE, out: ["h", "l"], js: w => { const hl = powerScaleLookup(w); return { h: hl >> 8, l: hl & 0xFF }; } });
CASES.push({ name: "SetForcedShotD", bank: 0x10, addr: 0x4C4C, regs: () => ({ b: rnd(256), c: rnd(256), d: rnd(256), e: rnd(256) }), js: (w, r) => U.setForcedShotD(w, r.b << 8 | r.c, r.d, r.e) });
CASES.push({ name: "MapCount", bank: 0x0A, addr: 0x531F, out: ["a"], js: () => ({ a: U.mapCount() }) });
CASES.push({ name: "MapIdAt", bank: 0x0A, addr: 0x5336, regs: () => ({ a: rnd(0x40) }), out: ["a"], js: (w, r) => ({ a: U.mapIdAt(r.a) }) });
CASES.push({ name: "PalOffset", bank: 0x0A, addr: 0x5675, regs: () => ({ b: rnd(16), h: rnd(256), l: rnd(256) }), out: ["h", "l"], js: (w, r) => { const hl = U.palOffset(r.h << 8 | r.l, r.b); return { h: hl >> 8, l: hl & 0xFF }; } });
CASES.push({ name: "CopyTextToWram1D800", bank: 0x48, addr: 0x4D4C, regs: w => { let id; for (;;) { id = 0x1105 + rnd(0x40); const t = new GolfMemory(); t.wram[0].fill(1); try { loadText(t, id); } catch (e) { continue; } if (t.wram[0].subarray(0x600, 0x800).includes(0)) break; } return { h: id >> 8, l: id & 0xFF }; },   // (a text that ends in the buffer)
  js: (w, r) => U.copyTextToWram1D800(w, r.h << 8 | r.l) });
// bank 3E's unreferenced cell writers and the two-player score screen's figure helpers (standings.js)
const tileString = w => { const n = rnd(12); for (let k = 0; k < n; k++) w.wram[0][0x400 + k] = 1 + rnd(255); w.wram[0][0x400 + n] = 0; };
const cell = () => ({ b: rnd(0x20), c: rnd(0x1F) });
CASES.push({ name: "PutTileStringAttr0", bank: 0x3E, addr: 0x60C3, init: tileString, regs: () => ({ h: 0xC4, l: 0, ...cell() }), js: (w, r) => S3E.putTileStringAttr0(w, 0xC400, r.b, r.c) });
CASES.push({ name: "PutTileStringNoAttr", bank: 0x3E, addr: 0x618D, init: tileString, regs: () => ({ h: 0xC4, l: 0, ...cell() }), js: (w, r) => S3E.putTileStringNoAttr(w, 0xC400, r.b, r.c) });
const atString = w => { const n = rnd(12); const t = w.wram[0]; t[0x400] = rnd(0x14); t[0x401] = rnd(0x18); for (let k = 0; k < n; k++) t[0x402 + k] = 1 + rnd(255); t[0x402 + n] = 0; };
CASES.push({ name: "DrawTileStringAttr0At", bank: 0x3E, addr: 0x626D, init: atString, regs: () => ({ h: 0xC4, l: 0, d: rnd(8) }), js: (w, r) => S3E.drawTileStringAttr0At(w, 0xC400, r.d) });
CASES.push({ name: "DrawTileStringNoAttrAt", bank: 0x3E, addr: 0x6280, init: atString, regs: () => ({ h: 0xC4, l: 0, d: rnd(8) }), js: (w, r) => S3E.drawTileStringNoAttrAt(w, 0xC400, r.d) });
CASES.push({ name: "DrawScoreLabelB", bank: 0x3E, addr: 0x65E3, regs: cell, js: (w, r) => S3E.drawScoreLabelBC(w, 0xCA, r.b, r.c) });
CASES.push({ name: "DrawScoreLabelC", bank: 0x3E, addr: 0x660D, regs: cell, js: (w, r) => S3E.drawScoreLabelBC(w, 0xCD, r.b, r.c) });
CASES.push({ name: "PutTileAttr0", bank: 0x3E, addr: 0x61E3, regs: () => ({ a: rnd(256), ...cell() }), out: ["a", "b", "c"], js: (w, r) => { S3E.putTileAttr0(w, r.a, r.b, r.c); return r; } });
CASES.push({ name: "ScoreTensDigit", bank: 0x3E, addr: 0x62A6, regs: () => ({ a: rnd(256) }), out: ["a"], js: (w, r) => ({ a: S3E.scoreTensOnes(r.a)[0] }) });
CASES.push({ name: "ScoreOnesDigit", bank: 0x3E, addr: 0x62D3, regs: () => ({ a: rnd(256) }), out: ["a"], js: (w, r) => ({ a: S3E.scoreTensOnes(r.a)[1] }) });
CASES.push({ name: "DrawScoreVsPar", bank: 0x3E, addr: 0x6525, regs: () => ({ a: rnd(256), ...cell() }), js: (w, r) => S3E.drawScoreVsPar(w, r.a, r.b, r.c) });
// bank 0E's unreferenced card writers (scorecard.js)
CASES.push({ name: "ScorecardPutStringRight", bank: 0x0E, addr: 0x44E2, init: w => { const n = rnd(7); for (let k = 0; k < n; k++) w.wram[0][0x400 + k] = 1 + rnd(255); w.wram[0][0x400 + n] = 0; },
  regs: () => { const de = 0xD000 + rnd(0xF00); return { h: 0xC4, l: 0, d: de >> 8, e: de & 0xFF }; }, js: (w, r) => SC.scorecardPutStringRight(w, 0xC400, r.d << 8 | r.e) });
CASES.push({ name: "ScorecardFillBlank", bank: 0x0E, addr: 0x45CD, regs: () => { const hl = 0xD000 + rnd(0xE00); return { h: hl >> 8, l: hl & 0xFF, b: rnd(256) }; }, js: (w, r) => SC.scorecardFillBlank(w, r.h << 8 | r.l, r.b) });
const holesDone = w => { w.wram[0][0x4BE] = rnd(19); w.wram[0][0x836] = rnd(11); };
CASES.push({ name: "DrawP1ScoreToPar", bank: 0x0E, addr: 0x6E50, init: holesDone, js: w => SC.drawScoreToParUnused(w, false) });
CASES.push({ name: "DrawTwoPlayerToPar", bank: 0x0E, addr: 0x7356, init: holesDone, js: w => SC.drawScoreToParUnused(w, true) });
// bank 12's map readers (unreached.js)
const in64 = () => ({ h: rnd(0x40), l: rnd(256), d: rnd(0x40), e: rnd(256) });
CASES.push({ name: "GreenSlopeDirAt", bank: 0x12, addr: 0x4098, regs: in64, out: ["a", "b", "c", "d", "e", "h", "l"], js: (w, r) => U.greenSlopeDirAt(w, r.h, r.d) });
CASES.push({ name: "TerrainAtPos", bank: 0x12, addr: 0x40FD, regs: in64, out: ["a", "b", "c", "d", "e", "h", "l"], js: (w, r) => U.terrainAtPos(w, r.h, r.l, r.d, r.e) });
CASES.push({ name: "CellInfoAt", bank: 0x12, addr: 0x405E, init: w => { const r6 = w.wram[6]; r6[0x443] = [0, 1, 2, 4, 5][rnd(5)]; r6[0x441] = rnd(0x30); r6[0x442] = rnd(0x30); },
  regs: w => ({ h: (w.wram[6][0x441] + rnd(0x10)) & 0x3F, l: rnd(256), d: (w.wram[6][0x442] + rnd(0x10)) & 0x3F, e: rnd(256) }),   // (within the 64 x 64 map)
  out: ["a", "b", "c", "d", "e", "h", "l"], js: (w, r) => U.cellInfoAt(w, r.h, r.l, r.d, r.e) });
CASES.push({ name: "TerrainAtTileUnused", bank: 0x12, addr: 0x416B, regs: () => ({ d: rnd(256), e: rnd(256) }), out: ["a", "b", "c", "d", "e", "h", "l"], js: (w, r) => U.terrainAtTileUnused(w, r.d, r.e) });
CASES.push({ name: "SlopeAtBallUnused", bank: 0x12, addr: 0x42A2, init: w => { const r6 = w.wram[6]; r6[0x443] = [0, 1, 2, 4, 5][rnd(5)]; r6[0x441] = rnd(0x30); r6[0x442] = rnd(0x30);
  const green = r6[0x443] && r6[0x443] !== 4; r6[0x402] = green ? r6[0x441] + rnd(0x10) : rnd(0x40); r6[0x405] = green ? r6[0x442] + rnd(0x10) : rnd(0x40); },
  out: ["a", "b", "c", "d", "e", "h", "l"], js: w => U.slopeAtBallUnused(w) });
// bank 04's unreferenced actor helpers (unreached.js)
const actorHL = () => { const k = rnd(25); const hl = k === 24 ? 0 : 0xD000 + 0x40 * k; return { h: hl >> 8, l: hl & 0xFF }; };
CASES.push({ name: "ActorsClearKeepTasks", bank: 0x04, addr: 0x40E9, init: w => { for (let k = 0; k < rnd(8); k++) { const p = 0x1C0 + 4 * rnd(16); w.wram[0][p] = 1 + rnd(255); w.wram[0][p + 1] = rnd(256); w.wram[0][p + 2] = 0x40 + rnd(0x40); w.wram[0][p + 3] = rnd(0x80); } },
  js: w => U.actorsClearKeepTasks(w) });
CASES.push({ name: "ActorIsWalking", bank: 0x04, addr: 0x4588, init: w => { if (rnd(2)) for (let k = 0; k < 24; k++) w.wram[4].copyWithin(k * 64 + 0x0A, k * 64 + 4, k * 64 + 4 + rnd(5)); },
  regs: actorHL, out: ["a", "h", "l"], js: (w, r) => ({ a: U.actorIsWalking(w, r.h << 8 | r.l), h: r.h, l: r.l }) });
CASES.push({ name: "ActorSetAnimSpeed", bank: 0x04, addr: 0x4EE0, regs: () => ({ a: rnd(256), ...actorHL() }), js: (w, r) => U.actorSetAnimSpeedField(w, r.h << 8 | r.l, 0x35, r.a) });
CASES.push({ name: "ActorSetMoveAnimSpeed", bank: 0x04, addr: 0x4EF5, regs: () => ({ a: rnd(256), ...actorHL() }), js: (w, r) => U.actorSetAnimSpeedField(w, r.h << 8 | r.l, 0x36, r.a) });
CASES.push({ name: "CountCharacterHeaders", bank: 0x04, addr: 0x4F0A, out: ["a"], js: () => ({ a: U.countCharacterHeaders() }) });
// small unreferenced routines (unreached.js)
CASES.push({ name: "QueueD000To8E00", bank: 0x12, addr: 0x4956, js: w => U.queueD000To8E00(w) });
CASES.push({ name: "CountdownResume", bank: 0x12, addr: 0x4F67, js: w => U.countdownSet(w, 1) });
CASES.push({ name: "CountdownStop", bank: 0x12, addr: 0x4F7F, js: w => U.countdownSet(w, 0) });
CASES.push({ name: "ReturnStub", bank: 0x12, addr: 0x4DE8, js: () => U.returnStub() });
CASES.push({ name: "CharAnimStub1", bank: 0x42, addr: 0x4008, js: () => U.returnStub() });
CASES.push({ name: "CharAnimStub0", bank: 0x42, addr: 0x400A, js: () => U.returnStub() });
CASES.push({ name: "DictScrollStepUnused", bank: 0x3F, addr: 0x41DC, regs: () => ({ h: rnd(0x40), l: rnd(256), d: rnd(4), e: rnd(256), b: rnd(0x40) }),
  out: ["a"], js: (w, r) => U.dictScrollStepUnused(w, r.h << 8 | r.l, r.d << 8 | r.e, r.b) });
// bank 0B's unreferenced map cell writers (unreached.js; tiles within the 64 x 64 map)
CASES.push({ name: "MapSetTerrainAt", bank: 0x0B, addr: 0x45E3, regs: () => ({ a: rnd(256), d: rnd(0x40), e: rnd(0x40) }), js: (w, r) => U.mapSetCellAt(w, 0xD000, r.d, r.e, r.a) });
CASES.push({ name: "ReflectScaleUnused", bank: 0x10, addr: 0x77CC, init: w => { for (const a of [0x409, 0x40A, 0x40B, 0x40C, 0x4A1, 0x4A2, 0x4A3, 0x4A4, 0x4A9, 0x4AA, 0x4AB, 0x4AC]) if (rnd(2)) w.wram[6][a] = rnd(2) ? 0 : 0xFF; },
  js: w => U.reflectScaleUnused(w) });
CASES.push({ name: "Map27SetTeeForBallPile", bank: 0x34, addr: 0x5BC7, init: w => { w.wram[0][0x3E0] = rnd(12); }, js: w => B34.map27SetTeeForBallPile(w) });
CASES.push({ name: "ClearSaveFlag", bank: 0x02, addr: 0x4550, sram: true, regs: () => ({ d: rnd(0x10), e: rnd(8) }), js: (w, r) => U.clearSaveFlag(w, r.d, r.e) });
CASES.push({ name: "GetPlayerActorPos", bank: 0x30, addr: 0x7E46, init: w => { w.wram[0][0x290] = rnd(256); w.wram[0][0x291] = 0xD0 + rnd(0x0F); }, out: ["h", "l", "d", "e"],
  js: w => { const [x, y] = U.getPlayerActorPos(w); return { h: x >> 8, l: x & 0xFF, d: y >> 8, e: y & 0xFF }; } });
CASES.push({ name: "RosterWord10", bank: 0x06, addr: 0x69E7, init: w => { w.wram[6][0x216] = rnd(256); w.wram[6][0x217] = 0xD0 + rnd(8); }, regs: () => ({ c: rnd(0x20) }),
  out: ["a", "h", "l", "d", "e"], js: (w, r) => { const v = U.rosterWord10(w, r.c); return { a: v, h: 0, l: v, d: 0, e: 0x10 }; } });
CASES.push({ name: "GetLongestDriveRecord", bank: 0x08, addr: 0x43B8, init: w => { if (rnd(2)) { w.wram[0][0x96E] = 0; w.wram[0][0x96F] = 0; } }, out: ["h", "l"],
  js: w => { const v = U.getLongestDriveRecord(w); return { h: v >> 8, l: v & 0xFF }; } });
CASES.push({ name: "LoadShotStart", bank: 0x02, addr: 0x461F, js: w => { AIM.loadShotRecord(w, 0x5F8); return {}; } });
CASES.push({ name: "MapSetEventAt", bank: 0x0B, addr: 0x4637, regs: () => ({ a: rnd(256), d: rnd(0x40), e: rnd(0x40) }), js: (w, r) => U.mapSetCellAt(w, 0xD400, r.d, r.e, r.a) });
// the link cable's protocol (serial.js; no partner: rSB / rSC are w.high[$101] / [$102], the core's io; romCall runs
// the CPU without the hardware, so a transfer started stays started on both sides: w.noSerialHW)
const serialState = w => {
  const h = w.high;
  h[0x1C2] = [0, 1, 2, rnd(256)][rnd(4)];
  h[0x1C4] = rnd(4) ? rnd(3) : rnd(256);
  h[0x1C5] = rnd(3) ? 1 + rnd(4) : rnd(256);
  h[0x101] = [0x70, 0x71, 0x00, 0xFF, 0x40 + rnd(0x20), rnd(256)][rnd(6)];
  h[0x102] = rnd(256) & 0x83;
  w.noSerialHW = true;
};
const sjs = fn => (w, r) => { fn(w, r); return {}; };
for (const [name, addr, fn, out] of [["SerialHandler", 0x2F93, w => SER.serialHandler(w)], ["SerialLoadSendByte", 0x2FF8, w => SER.serialLoadSendByte(w)],
  ["SerialHandleRecvByte", 0x3021, w => SER.serialHandleRecvByte(w)], ["SerialVBlankTick", 0x3038, w => SER.serialVBlankTick(w)],
  ["InitSerialLink", 0x304D, w => SER.initSerialLink(w)], ["SetLinkActive", 0x30F8, w => SER.setLinkActive(w)],
  ["ClearLinkActive", 0x30FD, w => SER.clearLinkActive(w)]]) {
  CASES.push({ name, bank: 0, addr, init: serialState, io: true, js: sjs(fn) });
}
CASES.push({ name: "SerialNextSendNibble", bank: 0, addr: 0x30AD, init: serialState, io: true, out: ["a", "b"],
  js: w => { const a = SER.serialNextSendNibble(w); return { a, b: a }; } });
CASES.push({ name: "SerialStoreNibble", bank: 0, addr: 0x30C9, init: serialState, io: true, regs: () => ({ a: 0x50 + rnd(0x10) }),
  js: (w, r) => { SER.serialStoreNibble(w, r.a); return {}; } });
CASES.push({ name: "SerialWaitSendDone", bank: 0, addr: 0x30EB, init: w => { serialState(w); w.high[0x1C4] = 0; }, io: true,
  js: w => { const x = SER.serialWaitSendDone({ w, advance: function* () { yield; } }).next(); if (!x.done) throw new Error("it runs frames"); return {}; } });
// the link round's shot exchange (02:47BE-02:4993) with its frames stubbed and a script of received bytes
const runGen = g => { let r; while (!(r = g.next()).done); return r.value; };
// (random bytes, then a $1x, $20 or $21 and more, then $2F for good: the waits end; a $2E early gives up)
const recvScript = () => {
  const out = [], any = () => [0x10 + rnd(16), 0x20, 0x21, 0x2E, rnd(256)][rnd(rnd(8) ? 5 : 4) === 3 && rnd(3) ? 4 : rnd(5)];
  for (let n = rnd(5); n; n--) out.push(any());
  out.push([0x10 + rnd(16), 0x20, 0x21][rnd(3)], 0x10 + rnd(16), 0x21);
  for (let n = rnd(5); n; n--) out.push(any());
  out.push(0x2F);
  return out;
};
CASES.push({ name: "JoyPressedIndex", bank: 0x02, addr: 0x47BE, init: w => { w.high[0x194] = rnd(4) ? 1 << rnd(8) | (rnd(2) ? rnd(256) : 0) : 0; }, script: () => [0],
  out: ["a"], js: w => ({ a: SER.joyPressedIndex(w.sh) }) });
CASES.push({ name: "LinkPartnerCallTick", bank: 0x02, addr: 0x4812, init: w => { w.wram[0][0x33F] = rnd(3) ? rnd(3) : 0; w.high[0x1C0] = rnd(2) ? 0x10 + rnd(16) : rnd(256); },
  script: () => [0], js: w => { SER.linkPartnerCallTick(w.sh); return {}; } });
CASES.push({ name: "LinkReceiveShot", bank: 0x02, addr: 0x483A, init: w => { w.high[0x194] = rnd(2) ? 1 << rnd(8) : 0; },
  script: recvScript, js: w => { runGen(SER.linkReceiveShot(w.sh)); return {}; } });
for (const [name, addr, b] of [["LinkSendShot", 0x48B8, false], ["LinkSendShotResult", 0x4924, true]]) {
  CASES.push({ name, bank: 0x02, addr, init: w => { serialState(w); w.high[0x1C4] = 0; if (rnd(4)) w.high[0x1C2] = 0; w.wram[0][0x835] = rnd(2); if (rnd(4)) w.wram[0][0x880 + (w.wram[0][0x835] ? 0 : 0x40) + 0x13] = 3; },
    io: true, regs: () => ({ a: rnd(256) }), script: recvScript, js: (w, r) => { runGen(SER.linkSendShot(w.sh, b ? r.a : null)); return {}; } });
}
CASES.push({ name: "SerialSendBlock", bank: 0, addr: 0x3081, init: w => { serialState(w); w.high[0x1C4] = 0; }, io: true,
  regs: () => ({ a: rnd(0x40) }), out: ["a"], js: (w, r) => { const g = SER.serialSendBlock({ w, advance: function* () { yield; } }, r.a); const x = g.next(); if (!x.done) throw new Error("it runs frames"); return { a: x.value }; } });
for (const c of U.FUZZ || []) CASES.push(c(rnd));
// the card's accent fragments (0E:44AE / 0E:44C8), entered from a stub at $C800 that pushes af and hl (as ScorecardPutString
// 0E:4492 has them on the stack at its loop) and jumps in, bank 0E mapped; a string at hl in WRAM0, de in WRAM 1-7
for (const [name, addr, base] of [["ScorecardPutStringAccentA", 0x44AE, 0x30], ["ScorecardPutStringAccentB", 0x44C8, 0x2B]]) {
  CASES.push({ name, bank: 0x0E, addr: 0xC800,   // (romCall maps the case's bank for an address past $4000)
    init: w => { const m = w.wram[0]; m.set([0xF5, 0xE5, 0xC3, addr & 0xFF, addr >> 8], 0x800); const n = rnd(10); for (let k = 0; k < n; k++) m[0x402 + k] = 1 + rnd(255); m[0x402 + n] = 0; },
    regs: () => { const de = 0xD001 + rnd(0xE00); return { h: 0xC4, l: 0x02, d: de >> 8, e: de & 0xFF, a: rnd(256) }; }, out: ["a", "h", "l", "d", "e"],
    js: (w, r) => { const de = SC.scorecardPutStringAccent(w, 0xC402, r.d << 8 | r.e, base); return { a: r.a, h: 0xC4, l: 0x02, d: de >> 8, e: de & 0xFF }; } });
}
// 08:50E6 PlayGreenMusic (round.js), its sounds recorded (a script case): on the green or not, music on or off, strokes
// and par
CASES.push({ name: "PlayGreenMusic", bank: 0x08, addr: 0x50E6, script: () => [0],
  init: w => { w.wram[6][0x4CD] = rnd(2) ? 6 : rnd(16); w.wram[0][0x818] = rnd(256); w.wram[0][0x96D] = rnd(3) ? 1 : 0; w.wram[0][0x82C] = rnd(2) ? 0 : rnd(0x30); w.wram[0][0x835] = rnd(2); w.wram[6][0x325] = 3 + rnd(3); w.wram[0][0x8A0] = rnd(8); w.wram[0][0x8E0] = rnd(8); },
  regs: () => ({ a: rnd(256), h: rnd(256), l: rnd(256) }), out: ["a", "h", "l"],
  js: (w, r) => { const [a, hl] = RD.playGreenMusic(w.sh); return hl === null ? { ...r, a } : { a, h: hl >> 8, l: hl & 0xFF }; } });
// 06:6471 LoadSelectedCharPaletteUnused (charsel.js): the roster list in WRAM0, the cursor's record's character 0-$0B or $FF
CASES.push({ name: "LoadSelectedCharPaletteUnused", bank: 0x06, addr: 0x6471,
  init: w => { const r6 = w.wram[6]; r6[0x214] = rnd(8); r6[0x216] = 0x00; r6[0x217] = 0xC4; w.wram[0][0x400 + 32 * r6[0x214]] = [rnd(12), 0xFF, rnd(256)][rnd(3)]; },
  regs: () => ({ a: rnd(256), b: rnd(256), c: rnd(256), d: rnd(256), e: rnd(256), h: rnd(256), l: rnd(256) }), out: ["a", "b", "c", "d", "e", "h", "l"],
  js: (w, r) => { CS.loadSelectedCharPaletteUnused(w); return r; } });
// 48:4A27 YesNoCursorInput (exp.js): frames stubbed, buttons by a list (nothing, Up / Down / Select, then A or B)
CASES.push({ name: "YesNoCursorInput", bank: 0x48, addr: 0x4A27, script: () => [0],
  joy: () => { const j = []; for (let n = rnd(5); n; n--) j.push(0, [0x40, 0x80, 4, 0x10][rnd(4)]); j.push(0, [1, 2][rnd(2)]); return j; },
  regs: () => ({ b: rnd(256), c: rnd(256), d: rnd(256), e: rnd(256), h: rnd(256), l: rnd(256) }), out: ["a", "b", "c", "d", "e", "h", "l"],
  js: (w, r) => ({ ...r, a: runGen(EXP.yesNoCursorInput(w.sh)) }) });
// 0C:6E80 LoadBannerGfxUnused (records0c.js), its frame stubbed: a within its 6-entry table
CASES.push({ name: "LoadBannerGfxUnused", bank: 0x0C, addr: 0x6E80, script: () => [0],
  init: w => { if (rnd(2)) for (let k = 0; k < rnd(9); k++) w.wram[0][0x0A0 + 8 * rnd(10)] = 1; },
  regs: () => ({ a: rnd(6), b: rnd(256), c: rnd(256), d: 0x80 + rnd(0x18), e: rnd(256), h: rnd(256), l: rnd(256) }), out: ["a", "b", "c", "d", "e", "h", "l"],
  js: (w, r) => { runGen(R0C.loadBannerGfxUnused(w.sh, r.a, r.d << 8 | r.e)); return r; } });
// 00:02C7 SwitchCPUSpeedSingle: the core's CPU speed and KEY1, P1's select bits, IF and IE against the native model's
CASES.push({ name: "SwitchCPUSpeedSingle", bank: 0, addr: 0x02C7,
  coreInit: (gb, w) => { w.doubleSpeed = !!rnd(2); w.key1 = rnd(2); w.high[0x1FF] = rnd(256) & 0x1F; gb.mem.doubleSpeed = w.doubleSpeed; gb.mem.key1 = w.key1; gb.mem.ie = w.high[0x1FF];
    w.high[0x10F] = gb.mem.iflag = rnd(32); w.high[0x100] = rnd(4) << 4; gb.mem.joypad.write(w.high[0x100]); },
  out: ["a"], js: w => ({ a: U.switchCPUSpeedSingle(w) }),
  check: (gb, w) => {
    const d = [];
    if (gb.mem.doubleSpeed !== w.doubleSpeed) d.push(`speed rom ${gb.mem.doubleSpeed} js ${w.doubleSpeed}`);
    if (gb.mem.ie !== w.high[0x1FF]) d.push(`IE rom ${hx(gb.mem.ie)} js ${hx(w.high[0x1FF])}`);
    if (w.doubleSpeed === false && (gb.mem.iflag & 0x1F) !== (w.high[0x10F] & 0x1F)) d.push(`IF rom ${hx(gb.mem.iflag)} js ${hx(w.high[0x10F])}`);
    if ((gb.mem.joypad.select & 0x30) !== (w.high[0x100] & 0x30)) d.push(`P1 rom ${hx(gb.mem.joypad.select)} js ${hx(w.high[0x100])}`);
    return d;
  } });
// the message box's unreferenced close (05:60FF) and its shrink loop (05:6108, the jr over it patched out), the frames
// stubbed: the window slots' priorities 0 (UpdateWindows draws none), the record [$D856] in WRAM5 with a sane size
const msgClose = w => {
  const r = w.wram[5];
  for (let s = 0; s < 6; s++) r[0x802 + 4 * s] &= 0x1F;
  const rec = 0xD900 + rnd(0x200); r[0x856] = rec & 0xFF; r[0x857] = rec >> 8;
  r[rec - 0xD000 + 3] = 3 + rnd(18); r[rec - 0xD000 + 4] = 3 + rnd(16);
  r[0x86C] = rnd(2);
};
CASES.push({ name: "CloseMessageBoxAnimated", bank: 0x05, addr: 0x60FF, init: msgClose, script: () => [0], regs: () => ({ a: rnd(256), b: rnd(256), c: rnd(256), d: rnd(256), e: rnd(256), h: rnd(256), l: rnd(256) }),
  out: ["a", "b", "c", "d", "e", "h", "l"], js: (w, r) => { runGen(MB.closeMessageBoxAnimated(w.sh)); return r; } });
CASES.push({ name: "CloseMessageBoxShrinkLoop", bank: 0x05, addr: 0x60FF, patch: { "05:6106": [0, 0] }, init: msgClose, script: () => [0], steps: 5000000,
  regs: () => ({ a: rnd(256), b: rnd(256), c: rnd(256), d: rnd(256), e: rnd(256), h: rnd(256), l: rnd(256) }),
  out: ["a", "b", "c", "d", "e", "h", "l"], js: (w, r) => { runGen(MB.closeMessageBoxAnimated(w.sh, true)); return r; } });

const hx = v => (v === undefined ? "undefined" : v.toString(16).padStart(2, "0"));
let bad = 0;
for (const c of CASES) {
  if (filter && !c.name.includes(filter)) continue;
  let ok = 0, first = null, skipped = 0, hangs = 0;
  if (process.env.FUZZ_SEED) seed = +process.env.FUZZ_SEED;   // (debugging: a case's run from a logged seed)
  for (let i = 0; i < N; i++) {
    if (process.env.FUZZ_LOG && c.name === process.env.FUZZ_LOG) console.error("ITER", i, seed);
    const w = new GolfMemory();
    for (let b = 0; b < 8; b++) for (let k = 0; k < 0x1000; k++) w.wram[b][k] = rnd(256);
    for (let k = 0x180; k < 0x1FF; k++) w.high[k] = rnd(256);
    w.wram[0].fill(0, 0x1C0, 0x200);             // the frame tasks: none
    w.wram[0].fill(0, 0x0A0, 0x0F0);             // the VRAM copy queue: empty
    if (c.init) c.init(w);
    const regs = c.regs ? c.regs(w) : {};
    w.high[0x196] = 6; w.high[0x195] = c.bank;
    loadCore(gb, w);
    if (c.io) { gb.mem.io[1] = w.high[0x101]; gb.mem.io[2] = w.high[0x102]; }   // (rSB / rSC)
    if (c.coreInit) c.coreInit(gb, w);           // (a case's hardware state on both sides, e.g. the CPU speed)
    if (c.sram) { for (let k = 0; k < 0x2000; k++) w.sram[k] = rnd(256); gb.mem.sram.set(w.sram, 0); gb.mem.ramBank = 0; }   // (the save RAM's bank 0 compared too)
    let got;
    // (a call that reaches PlaySoundCmd 00:2BBB, QueueVRAMCopy's error sounds for more than $80 blocks, is not
    // compared: the sound driver's RAM is not modelled there; counted apart)
    let sound = false;
    const step = cpuStep;                       // (the CPU's own step: binding the last wrapper again nested them)
    // (c.script: the routine's frames stubbed: AdvanceFrame 00:2E3B returns at once with hSerialRecv set to the
    // script's next byte (its last one after the end), on both sides; PlaySoundManaged 00:2C19 returns at once with
    // its sound id recorded, compared as "sounds")
    const script = c.script ? c.script(w) : null, coreSounds = [];
    const joy = c.joy ? c.joy() : null;          // (c.joy: hJoyPressed per stubbed frame, the list repeated, on both sides)
    let kc = 0;
    const ret = () => { const cpu = gb.cpu, m = gb.mem; cpu.pc = m.read(cpu.sp) | m.read((cpu.sp + 1) & 0xFFFF) << 8; cpu.sp = (cpu.sp + 2) & 0xFFFF; return 16; };
    gb.cpu.step = () => {
      if (script && gb.cpu.pc === 0x2E3B) { if (joy) gb.mem.hram[0x14] = joy[kc % joy.length]; gb.mem.hram[0x40] = script[Math.min(kc++, script.length - 1)]; return ret(); }
      if (script && gb.cpu.pc === 0x2C19) { coreSounds.push(gb.cpu.a); return ret(); }
      // (rst $08 PlaySoundCmd 00:2BBB in a script case: its id recorded at 00:2BCA, the driver not run: 00:2C14's tail)
      if (script && gb.cpu.pc === 0x2BCA) { coreSounds.push(gb.cpu.a); gb.cpu.pc = 0x2C14; return 4; }
      if (gb.cpu.pc === 0x2BBB && !script) sound = true;
      return step();
    };
    if (script) {
      let kj = 0;
      w.jsSounds = [];
      w.sh = { w, sound: id => w.jsSounds.push(id), advance: function* () {
        if (kj > 2000) throw new Error("frames run out");
        if (joy) w.high[0x194] = joy[kj % joy.length];
        w.high[0x1C0] = script[Math.min(kj++, script.length - 1)]; } };
    }
    // (c.patch: {"BB:AAAA": [bytes]}: the core's ROM patched for the call, e.g. a jump over dead code taken out; restored)
    const saved = [];
    for (const [k, bytes] of Object.entries(c.patch || {})) {
      const [pb, pa] = k.split(":").map(x => parseInt(x, 16)), o = (pa < 0x4000 ? 0 : pb * 0x4000) + (pa & 0x3FFF);
      bytes.forEach((v, i) => { saved.push([o + i, gb.mem.rom[o + i]]); gb.mem.rom[o + i] = v; });
    }
    try { got = romCall(gb, c.bank, c.addr, regs, c.steps || 300000); } catch (e) { got = null; }
    for (const [o, v] of saved) gb.mem.rom[o] = v;
    if (process.env.FUZZ_LOG && c.name === process.env.FUZZ_LOG) console.error("ROM", got ? "returned" : "no return");
    gb.cpu.step = step;
    if (sound) { skipped++; continue; }
    if (!got) { let thrown = false; try { c.js(w, regs); } catch (e) { thrown = true; } if (thrown) { hangs++; ok++; } else if (!first) first = `rom does not return, js does (${JSON.stringify(regs)})`; continue; }
    let want;
    try { want = c.js(w, regs) || {}; } catch (e) { if (!first) first = `js: ${e.message} (${JSON.stringify(regs)})`; continue; }
    const diffs = [];
    for (const k of c.out || []) if (want[k] !== got[k]) diffs.push(`${k} rom ${hx(got[k])} js ${hx(want[k])}`);
    if (c.sram) for (let k = 0; k < 0x2000 && diffs.length < 4; k++) if (gb.mem.sram[k] !== w.sram[k]) diffs.push(`sram $${(0xA000 + k).toString(16)} rom ${hx(gb.mem.sram[k])} js ${hx(w.sram[k])}`);
    if (script && coreSounds.join() !== w.jsSounds.join()) diffs.push(`sounds rom ${coreSounds.join()} js ${w.jsSounds.join()}`);
    for (let b = 0; b < 8 && diffs.length < 4; b++) {
      const m = gb.mem.wram[b];
      for (let k = 0; k < 0x1000; k++) {
        if (b === 0 && k >= 0xF00) break;
        if (m[k] !== w.wram[b][k]) { diffs.push(`wram${b} $${((b ? 0xD000 : 0xC000) + k).toString(16)} rom ${hx(m[k])} js ${hx(w.wram[b][k])}`); if (diffs.length >= 4) break; }
      }
    }
    if (c.io) for (const r of [1, 2]) if (gb.mem.io[r] !== w.high[0x100 + r]) diffs.push(`io $ff0${r} rom ${hx(gb.mem.io[r])} js ${hx(w.high[0x100 + r])}`);
    if (c.check) diffs.push(...c.check(gb, w));   // (a case's own hardware comparison)
    for (let k = 0; k < 0x7F; k++) {
      if (w.high[0x180 + k] !== gb.mem.hram[k]) diffs.push(`hram $ff${hx(0x80 + k)} rom ${hx(gb.mem.hram[k])} js ${hx(w.high[0x180 + k])}`);
    }
    if (!diffs.length) ok++;
    else if (!first) first = `${JSON.stringify(regs)}: ${diffs.slice(0, 4).join("; ")}`;
  }
  if (ok + skipped !== N) bad++;
  console.log(`${ok + skipped === N ? "ok  " : "FAIL"} ${c.name}: ${ok}/${N}${hangs ? ` (${hangs} hang in both)` : ""}${skipped ? ` (${skipped} with the error sound, not compared)` : ""}${first ? `; first: ${first}` : ""}`);
}
process.exit(bad ? 1 : 0);
