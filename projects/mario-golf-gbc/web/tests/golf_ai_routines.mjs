// The computer golfer's routines (web/js/golf/ai.js) against the ROM's (bank 3C) on the emulator core's
// interpreter: random states built from the hole set-up references (out/holesetup_*.json: holes of every
// course) with the ball, lie, club, golfer, course, wind and random seed changed; registers, WRAM6 and the seed
// compared after each call.
// usage: node web/tests/golf_ai_routines.mjs [N per routine] [name filter]
import fs from "fs";
import path from "path";
import { useRom } from "../js/golf/rom.js";
import { GolfMemory } from "../js/golf/memory.js";
import { Hole } from "../js/golf/ball.js";
import * as AI from "../js/golf/ai.js";
import { newCore, loadCore, romCall, romBytes } from "./golf/romcall.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
useRom(romBytes());
const N = +(process.argv[2] || 300), filter = process.argv[3] || "";
const bases = fs.readdirSync(path.join(root, "out")).filter(n => /^holesetup_.*\.json$/.test(n)).sort()
  .map(f => new GolfMemory().loadSnapshot(JSON.parse(fs.readFileSync(path.join(root, "out", f))).points.find(p => p.kind === "address").snapshot))
  .filter(w => w.wram[6][0x320] < 0x64);          // the five courses (the route table of later ids runs into code and VRAM)
const holes = new Map();
const holeOf = id => { if (!holes.has(id)) holes.set(id, new Hole(id)); return holes.get(id); };

let seed = 0x2468ace1;
const rnd = n => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
const pick = a => a[rnd(a.length)];

function randomState() {
  const base = pick(bases), w = new GolfMemory();
  for (let i = 0; i < 8; i++) w.wram[i].set(base.wram[i]);
  w.high.set(base.high);
  const r6 = w.wram[6], w0 = w.wram[0];
  const hole = holeOf(r6[0x320]);
  // the ball: near the tee, the cup or anywhere on the map
  const mode = rnd(3);
  const near = mode === 0 ? [r6[0x439] | r6[0x43A] << 8, r6[0x43B] | r6[0x43C] << 8] : [r6[0x43D] | r6[0x43E] << 8, r6[0x43F] | r6[0x440] << 8];
  let x = mode === 2 ? 0x0400 + rnd(0x3800) : (near[0] + rnd(0x1000) - 0x800) & 0x3FFF;
  let y = mode === 2 ? 0x0400 + rnd(0x3800) : (near[1] + rnd(0x1000) - 0x800) & 0x3FFF;
  r6[0x400] = rnd(256); r6[0x401] = x & 0xFF; r6[0x402] = x >> 8; r6[0x403] = rnd(256); r6[0x404] = y & 0xFF; r6[0x405] = y >> 8;
  r6[0x443] = pick([0, 0, 4, 4, 1]);
  if (r6[0x443] === 1) {                          // the green view only with the ball in the green's area
    x = (r6[0x441] << 8) + rnd(0x500); y = (r6[0x442] << 8) + rnd(0x400);
    r6[0x401] = x & 0xFF; r6[0x402] = (x >> 8) & 0xFF; r6[0x404] = y & 0xFF; r6[0x405] = (y >> 8) & 0xFF;
  }
  r6[0x4CD] = pick([0, 1, 2, 3, 4, 6, 9, 0x0A, 0x0C, 0x0D, 0x0E]);
  r6[0x329] = rnd(14); r6[0x32A] = pick([0, 0, 0, 1, 2, 3]); r6[0x32B] = rnd(3);
  r6[0x445] = rnd(2); r6[0x446] = rnd(3);
  const p = rnd(2) ? 0x8C0 : 0x880;
  w0[0x835] = p === 0x8C0 ? 1 : 0;
  w0[p + 0x10] = rnd(20);                         // golfer id
  w0[p + 0x20] = rnd(8);                          // strokes
  w0[0x837] = 1 + rnd(18);                        // hole number
  w0[0x836] = rnd(8);
  w0[0x815] = rnd(20); w0[0x816] = rnd(256);
  w.high[0x1FC] = rnd(256); w.high[0x1FD] = rnd(256);
  hole.use(r6[0x443] >= 1 && r6[0x443] <= 3);
  return { w, hole };
}

function coreFor(gb, w, hole) {                  // the core's RAM, with the maps of the current view
  loadCore(gb, w);
  gb.mem.wram[2].set(hole.attrs.subarray(0, 0x1000)); gb.mem.wram[3].set(hole.tmap.subarray(0, 0x1000));
  gb.mem.wram[6].set(hole.slope.subarray(0, 0x100), 0x700); gb.mem.wram[6].set(hole.terrain.subarray(0, 0x800), 0x800);
}

const gb = newCore();
const h4 = v => "$" + v.toString(16).padStart(4, "0");
// [name, addr, inputs(state) -> regs, js(state, regs) -> {reg: value}]
const T = [
  ["CpuCompare16", 0x4404, () => ({ bc: rnd(0x10000), de: rnd(0x10000) }), (s, r) => ({ a: AI.compare16(r.bc, r.de) })],
  ["CpuDistToCup", 0x4447, () => ({ bc: rnd(0x4000), de: rnd(0x4000) }), (s, r) => ({ hl: AI.distToCup(s.w, r.bc, r.de) })],
  ["CpuDistFromBall", 0x4466, () => ({ bc: rnd(0x4000), de: rnd(0x4000) }), (s, r) => ({ hl: AI.distFromBall(s.w, r.bc, r.de) })],
  ["CpuAngleTargetToPoint", 0x44DE, () => ({ bc: rnd(0x4000), de: rnd(0x4000) }), (s, r) => ({ bc: AI.angleTargetToPoint(s.w, r.bc, r.de) })],
  ["CpuAimAtTarget", 0x44FC, () => ({}), s => ({ bc: AI.aimAtTarget(s.w) })],
  ["CpuClubDistanceAtPower", 0x4528, () => ({ a: rnd(14), h: rnd(0x3D) }), (s, r) => ({ hl: AI.clubDistanceAtPower(s.w, r.a, r.h) })],
  ["CpuClubDistanceForLie", 0x453F, () => ({ a: rnd(14) }), (s, r) => ({ hl: AI.clubDistanceForLie(s.w, r.a) })],
  ["CpuTerrainAtPoint", 0x4564, () => ({ hl: rnd(0x10000), de: rnd(0x10000), bc: rnd(0x10000) }), (s, r) => { const [t, c, b] = AI.terrainAtPoint(s.w, s.hole, r.hl, r.de, r.bc & 0xFF); return { a: t, c, b }; }],
  ["RandomUpTo", 0x4599, () => ({ a: rnd(256) }), (s, r) => ({ a: AI.randomUpTo(s.w, r.a) })],
  ["CpuClubBanned", 0x465F, () => ({ a: rnd(14) }), (s, r) => ({ a: AI.clubBanned(s.w, r.a) })],
  ["CpuNineSplit", 0x51F6, () => ({}), s => { const [b, c] = AI.nineSplit(s.w); return { b, c }; }],
  ["CpuHoleStrokeBias", 0x50D3, () => ({}), s => ({ a: AI.holeStrokeBias(s.w) })],
  ["CpuRandomOffset", 0x6396, () => ({ a: rnd(17) }), (s, r) => ({ a: AI.randomOffset(s.w, r.a) })],
  ["CpuRandomOffsetNonZero", 0x63C7, () => ({ a: rnd(16) + 1 }), (s, r) => ({ a: AI.randomOffset(s.w, r.a, true) })],
  ["CpuPlanPutt", 0x5DCD, s => { s.w.wram[6][0x549] = rnd(5) - 2 & 0xFF; return {}; }, s => planRegs(AI.planPutt(s.w, s.hole))],
  ["CpuChooseSpin", 0x63F8, s => { const r6 = s.w.wram[6]; if (rnd(2)) r6.copyWithin(0x545, 0x43D, 0x441); return { bc: rnd(0x10000), de: rnd(0x10000) }; },
    (s, r) => ({ e: AI.chooseSpin(s.w, r.bc, r.de >> 8), d: r.de >> 8 })],
  ["CpuDecidePowerShot", 0x6530, () => ({}), s => ({ d: AI.decidePowerShot(s.w) })],
  ["CpuPowerJitter", 0x6213, s => { s.w.wram[6][0x549] = rnd(5) - 2 & 0xFF; return { hl: rnd(0x10000) }; }, (s, r) => ({ h: AI.powerJitter(s.w, r.hl >> 8) })],
  ["CpuImpactError", 0x62CA, s => { s.w.wram[6][0x549] = rnd(5) - 2 & 0xFF; return { a: rnd(14), de: rnd(4) << 8, hl: rnd(0x10000) }; },
    (s, r) => { const v = AI.impactError(s.w, r.a, r.de >> 8, r.hl >> 8); return { l: v === null ? r.hl & 0xFF : v, h: r.hl >> 8 }; }],
  ["CpuScanPathToCup", 0x5C22, () => ({}), s => ({ a: AI.scanPathToCup(s.w, s.hole) })],
  ["CpuChooseApproachClub", 0x5CE4, () => ({}), s => ({ a: AI.chooseApproachClub(s.w, s.hole) })],
  ["CpuPlanApproach", 0x59DC, s => { s.w.wram[6][0x549] = rnd(5) - 2 & 0xFF; return {}; }, s => planRegs(AI.planApproach(s.w, s.hole))],
  ["CpuPowerForDistance", 0x5021, () => ({ bc: rnd(0x2000), de: rnd(0x2000) }), (s, r) => ({ a: AI.powerForDistance(r.bc, r.de) })],
  ["CpuPickTeeClub", 0x525C, s => { s.w.wram[6][0x549] = rnd(5) - 2 & 0xFF; return {}; }, s => ({ a: AI.pickTeeClub(s.w) })],
  ["CpuGoForGreenClub", 0x5307, s => { s.w.wram[6][0x549] = rnd(9) - 6 & 0xFF; return { a: rnd(14) }; }, (s, r) => ({ a: AI.goForGreenClub(s.w, r.a) })],
  ["CpuChooseTarget", 0x4693, s => { s.w.wram[6][0x549] = rnd(5) - 2 & 0xFF; return { bc: 0x400 + rnd(0x1C00) }; }, (s, r) => { AI.chooseTarget(s.w, s.hole, r.bc); return {}; }],
  ["CpuFindLandingSpot", 0x48D5, () => ({ bc: 0x400 + rnd(0x1C00) }), (s, r) => { AI.findLandingSpot(s.w, s.hole, r.bc); return {}; }],
  ["CpuFindFairwaySpot", 0x4A51, () => ({ bc: 0x400 + rnd(0x1C00) }), (s, r) => { AI.findFairwaySpot(s.w, s.hole, r.bc); return {}; }],
  ["CpuHazardNear", 0x4E74, () => ({ hl: rnd(0x4000), de: rnd(0x4000) }), (s, r) => ({ a: AI.hazardNear(s.w, s.hole, r.hl, r.de) })],
  ["CpuShotNearHazard", 0x4F30, () => ({ a: rnd(13), hl: (1 + rnd(0x3C)) << 8, bc: rnd(0x10000) }), (s, r) => ({ a: AI.shotNearHazard(s.w, s.hole, r.a, r.hl >> 8, r.bc) })],
  ["CpuLandingUnsafe", 0x4BD1, () => ({ bc: rnd(0x4000), de: rnd(0x4000) }), (s, r) => ({ a: AI.landingUnsafe(s.w, s.hole, r.bc, r.de) })],
  ["CpuLandingPoint", 0x4CDA, () => ({ a: rnd(13), hl: (1 + rnd(0x3C)) << 8, bc: rnd(0x10000) }), (s, r) => { const [x, y] = AI.landingPoint(s.w, r.a, r.hl >> 8, r.bc); return { bc: x, de: y }; }],
  ["CpuPreviewHitsTree", 0x4F97, () => ({ a: rnd(13), bc: rnd(0x10000) }), (s, r) => ({ a: AI.previewHitsTree(s.w, s.hole, r.a, r.bc) })],
  ["CpuFindClearAim", 0x4C54, () => ({ a: rnd(13), hl: (1 + rnd(0x3C)) << 8, de: rnd(0x10000), bc: rnd(0x10000) }), (s, r) => { const v = AI.findClearAim(s.w, s.hole, r.a, r.hl >> 8, r.de, r.bc); return v === null ? { a: 1 } : { a: 0, de: v }; }],
  ["CpuShortenToGoodLie", 0x4D0A, () => ({ a: rnd(13), hl: (1 + rnd(0x3C)) << 8, bc: rnd(0x10000) }), (s, r) => ({ h: AI.shortenToGoodLie(s.w, s.hole, r.a, r.hl >> 8, r.bc) })],
  ["CpuWindAimCorrection", 0x555D, () => ({ a: rnd(14), bc: rnd(0x10000) }), (s, r) => ({ bc: AI.windAimCorrection(s.w, r.a, r.bc) })],
  ["CpuWindAdjustClubPower", 0x56CA, () => ({ a: rnd(13), bc: rnd(0x10000), de: rnd(0x10000), hl: rnd(0x10000) }),
    (s, r) => planRegs(AI.windAdjustClubPower(s.w, { club: r.a, aim: r.bc, mode: r.de >> 8, pad: r.de & 0xFF, power: r.hl >> 8, impact: r.hl & 0xFF }))],
  ["CpuPlanLongShot", 0x5751, s => { s.w.wram[6][0x549] = rnd(5) - 2 & 0xFF; return {}; }, s => planRegs(AI.planLongShot(s.w, s.hole))],
  ["CpuPlanShotMain", 0x426A, () => ({}), s => planRegs(AI.planShot(s.w, s.hole))],
  ["CpuPickClubForDistance", 0x45F9, () => ({ bc: rnd(0x2400) }), (s, r) => ({ a: AI.pickClubForDistance(s.w, r.bc) })],
];

const STEPS = { CpuFindFairwaySpot: 30_000_000 };   // a search the ROM can loop in for ever

function planRegs(p) {
  return { a: p.club, d: p.mode, bc: p.aim, e: p.pad, h: p.power, l: p.impact };
}

let bad = 0;
for (const [name, addr, gen, js] of T) {
  if (filter && !name.includes(filter)) continue;
  let fails = 0, first = null, hung = 0;
  for (let k = 0; k < N; k++) {
    const s = randomState();
    const r = gen(s);
    const regs = { a: r.a ?? 0, b: (r.bc ?? 0) >> 8, c: (r.bc ?? 0) & 0xFF, d: (r.de ?? 0) >> 8, e: (r.de ?? 0) & 0xFF,
                   h: r.hl !== undefined ? r.hl >> 8 : r.h ?? 0, l: (r.hl ?? 0) & 0xFF };
    coreFor(gb, s.w, s.hole);
    const snap = process.env.DEBUG ? { w: s.w.wram.map(b => b.slice()), h: s.w.high.slice() } : null;
    let out;
    try { out = romCall(gb, 0x3C, addr, regs, STEPS[name] ?? 400_000_000); }
    catch (err) {                                   // the ROM never returns from this state (a search that loops
      if (!/did not return/.test(err.message)) throw err;   // for ever): the JS port throws there too
      let threw = false;
      try { js(s, { ...r, ...regs, bc: regs.b << 8 | regs.c, de: regs.d << 8 | regs.e, hl: regs.h << 8 | regs.l }); } catch { threw = true; }
      if (threw) hung++; else { fails++; first ??= `${JSON.stringify(r)}: ROM hangs, JS returns`; }
      continue;
    }
    const want = js(s, { ...r, ...regs, bc: regs.b << 8 | regs.c, de: regs.d << 8 | regs.e, hl: regs.h << 8 | regs.l });
    const diffs = Object.entries(want).filter(([k2, v]) => out[k2] !== v).map(([k2, v]) => `${k2} js ${h4(v)} rom ${h4(out[k2])}`);
    for (let i = 0x300; i < 0x600; i++) if (gb.mem.wram[6][i] !== s.w.wram[6][i]) { diffs.push(`$${(0xD000 + i).toString(16)} js ${s.w.wram[6][i]} rom ${gb.mem.wram[6][i]}`); break; }
    if (gb.mem.hram[0x7C] !== s.w.high[0x1FC] || gb.mem.hram[0x7D] !== s.w.high[0x1FD]) diffs.push("seed");
    if (diffs.length) {
      fails++;
      if (!first) first = `${JSON.stringify(r)}: ${diffs.join(", ")}`;
      if (process.env.DEBUG) {
        const w = s.w, g6 = gb.mem.wram[6];
        console.log(`  hole $${w.wram[6][0x320].toString(16)} golfer ${w.wram[0][0x880 + (w.wram[0][0x835] ? 0x40 : 0) + 0x10]} strokes ${w.wram[0][0x880 + (w.wram[0][0x835] ? 0x40 : 0) + 0x20]} ` +
          `D525-D52E js ${Array.from(w.wram[6].subarray(0x525, 0x52F), v => v.toString(16)).join(" ")} rom ${Array.from(g6.subarray(0x525, 0x52F), v => v.toString(16)).join(" ")} ` +
          `target js ${Array.from(w.wram[6].subarray(0x545, 0x549), v => v.toString(16))} rom ${Array.from(g6.subarray(0x545, 0x549), v => v.toString(16))}`);
        const tx = w.wram[6][0x545] | w.wram[6][0x546] << 8, ty = w.wram[6][0x547] | w.wram[6][0x548] << 8;
        const rh = romCall(gb, 0x3C, 0x4E74, { h: tx >> 8, l: tx & 0xFF, d: ty >> 8, e: ty & 0xFF });
        const rt = romCall(gb, 0x3C, 0x45D5, { h: tx >> 8, l: tx & 0xFF, d: ty >> 8, e: ty & 0xFF });
        if (process.env.TRACE) {                     // the ROM's candidate points: hl / de at 3C:4A87
          const w2 = new GolfMemory(); snap.w.forEach((b, i) => w2.wram[i].set(b)); w2.high.set(snap.h);
          coreFor(gb, w2, s.hole);
          const cpu = gb.cpu, m = gb.mem; m.romBank = 0x3C; m.updateRom(); m.hram[0x15] = 0x3C;
          cpu.a = regs.a; cpu.b = regs.b; cpu.c = regs.c; cpu.d = regs.d; cpu.e = regs.e; cpu.h = regs.h; cpu.l = regs.l;
          cpu.sp = 0xCFEE; m.write(0xCFEE, 0xF0); m.write(0xCFEF, 0xFF); cpu.pc = addr;
          const pts = [];
          for (let n = 0; n < 5e6 && cpu.pc !== 0xFFF0; n++) { if (cpu.pc === +process.env.TRACE && m.romBank === 0x3C) pts.push(`${(cpu.h << 8 | cpu.l).toString(16)},${(cpu.d << 8 | cpu.e).toString(16)}`); cpu.step(); }
          console.log("  rom points: " + pts.slice(0, 20).join(" "));
        }
        console.log(`  at the JS target: hazard js ${AI.hazardNear(w, s.hole, tx, ty)} rom ${rh.a}; terrain js ${AI.safeTerrainAt(s.hole, tx, ty)} rom ${rt.a}`);
      }
    }
  }
  bad += fails > 0;
  console.log(`${fails ? "FAIL" : "ok  "} ${name}: ${N - fails}/${N}${hung ? ` (${hung} hang in both)` : ""}${first ? "  first: " + first : ""}`);
}
process.exit(bad ? 1 : 0);
