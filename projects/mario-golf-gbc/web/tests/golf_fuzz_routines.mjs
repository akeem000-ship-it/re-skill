// Routines no test screen reaches (the other banks' copies of ported code, unreferenced or debug-only code) against
// the ROM's on the emulator core's interpreter (web/tests/golf/romcall.mjs): the same pseudo-random RAM (WRAM 0-7 and
// HRAM) and registers in; the registers named, all WRAM (but the stack page $CF00-$CFFF) and HRAM compared after.
// usage: node web/tests/golf_fuzz_routines.mjs [name filter] [N per case]
import { useRom, rb } from "../js/golf/rom.js";
import { GolfMemory } from "../js/golf/memory.js";
import { newCore, romCall, romBytes, loadCore } from "./golf/romcall.mjs";
import { mapTileAnimStart, mapTileAnimTask, mapTileAnimStep, mapTileAnimStop } from "../js/golf/mapgfx.js";
import { holeTileAnimStep } from "../js/golf/render/holeview.js";
import { speedTable } from "../js/golf/launch.js";
import * as M from "../js/golf/math.js";
import * as U from "../js/golf/unreached.js";
import * as H from "../js/golf/home.js";

useRom(romBytes());
const filter = process.argv.slice(2).find(a => !/^\d+$/.test(a)) || "";
const N = +(process.argv.slice(2).find(a => /^\d+$/.test(a)) || 300);
let seed = 0x13579bdf;
const rnd = n => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
const gb = newCore();

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
for (const c of U.FUZZ || []) CASES.push(c(rnd));

const hx = v => v.toString(16).padStart(2, "0");
let bad = 0;
for (const c of CASES) {
  if (filter && !c.name.includes(filter)) continue;
  let ok = 0, first = null, skipped = 0, hangs = 0;
  for (let i = 0; i < N; i++) {
    const w = new GolfMemory();
    for (let b = 0; b < 8; b++) for (let k = 0; k < 0x1000; k++) w.wram[b][k] = rnd(256);
    for (let k = 0x180; k < 0x1FF; k++) w.high[k] = rnd(256);
    w.wram[0].fill(0, 0x1C0, 0x200);             // the frame tasks: none
    w.wram[0].fill(0, 0x0A0, 0x0F0);             // the VRAM copy queue: empty
    if (c.init) c.init(w);
    const regs = c.regs ? c.regs(w) : {};
    w.high[0x196] = 6; w.high[0x195] = c.bank;
    loadCore(gb, w);
    let got;
    // (a call that reaches PlaySoundCmd 00:2BBB, QueueVRAMCopy's error sounds for more than $80 blocks, is not
    // compared: the sound driver's RAM is not modelled there; counted apart)
    let sound = false;
    const step = gb.cpu.step.bind(gb.cpu);
    gb.cpu.step = () => { if (gb.cpu.pc === 0x2BBB) sound = true; return step(); };
    try { got = romCall(gb, c.bank, c.addr, regs, 300000); } catch (e) { got = null; }
    gb.cpu.step = step;
    if (sound) { skipped++; continue; }
    if (!got) { let thrown = false; try { c.js(w, regs); } catch (e) { thrown = true; } if (thrown) { hangs++; ok++; } else if (!first) first = `rom does not return, js does (${JSON.stringify(regs)})`; continue; }
    let want;
    try { want = c.js(w, regs) || {}; } catch (e) { if (!first) first = `js: ${e.message} (${JSON.stringify(regs)})`; continue; }
    const diffs = [];
    for (const k of c.out || []) if (want[k] !== got[k]) diffs.push(`${k} rom ${hx(got[k])} js ${hx(want[k])}`);
    for (let b = 0; b < 8 && diffs.length < 4; b++) {
      const m = gb.mem.wram[b];
      for (let k = 0; k < 0x1000; k++) {
        if (b === 0 && k >= 0xF00) break;
        if (m[k] !== w.wram[b][k]) { diffs.push(`wram${b} $${((b ? 0xD000 : 0xC000) + k).toString(16)} rom ${hx(m[k])} js ${hx(w.wram[b][k])}`); if (diffs.length >= 4) break; }
      }
    }
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
