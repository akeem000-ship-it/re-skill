// ShotLaunch 10:5F94 (tools/launch_py.py): the swing result -> the ball's launch speed, elevation, direction,
// spin and curve, and its starting velocity. On the game's RAM (w: GolfMemory); every table is read from the
// ROM where the code reads it.
// RAM read: wClub $D329, wShotMode $D32A, $D32B (putter range), $D321 (miss table), $D333 bit 0 (mirrored),
// the swing $D44B-$D450, the lie $D446 / $D445, the lie terrain $D4CD, golfer stats $D4C6 (driver distance),
// $D4C8 (trajectory class), $D4CA, $D4CB (control), $D4CC (equipment bits), the computer's $D4BF / $D4D8 /
// $D4D9, the aim $D418.
import { rb, rw } from "./rom.js";
import * as g from "./math.js";
import { rd16, wr16 } from "./memory.js";

export const ptr = (base, off) => (base + (off & 0xFF)) & 0xFFFF;   // "add a,l / ld l,a / adc a,h / sub l / ld h,a"

const mulRound = (hl, de) => { const p = hl * de; return (Math.floor(p / 65536) + (Math.floor(p / 32768) & 1)) & 0xFFFF; };

export function clubDistance(club, hl, b) {      // 02:511A ClubDistance
  if (club) return mulRound(hl, rw(0x02, 0x5171 + 2 * club));   // ClubDistanceTable 02:5171
  if (b & 2) {                                   // equipment: +10%, at most 400
    hl = (hl + g.mulHLByDE(hl, 0x1999)) & 0xFFFF;
    return (hl - 0x190) & 0x8000 ? hl : 0x190;
  }
  if (b & 4) return mulRound(hl, 0xF333);        // -5%
  return hl;
}

export function elevation(club, l) {             // 02:518B ClubElevation: per club and trajectory class l
  if (club === 0x0D) return 0;
  const de = rw(0x02, 0x51DC + 2 * club);
  return (rw(0x02, ptr(0x51BC, ((l + 8) & 0x0F) * 2)) + de) & 0xFFFF;
}

export function driverShape(a, club, e) {               // 02:534B: the driver's shot shape with equipment bits e
  let h = a;
  if (club) return h;
  if (e & 2) {
    if (!(e & 1)) {
      if (h === 4) return 4;
      h = (h + 1) & 0xFF;
      return h === 4 ? h : (h + 1) & 0xFF;
    }
    if (h === 0xFC) return 0xFC;
    h = (h - 1) & 0xFF;
    return h === 0xFC ? h : (h - 1) & 0xFF;
  }
  return e & 4 ? 0 : h;
}

export function shape(w) {                       // 10:6B03 ShotShape (signed), mirrored with $D333 bit 0
  const s = w.wram[6];
  const a = driverShape(s[0x4CA], s[0x329], s[0x4CC]);
  return s[0x333] & 1 ? (-a) & 0xFF : a;
}

function shapeDirection(hl, a) {                 // 08:607C ShapeDirection
  const t = rw(0x08, ptr(0x609C, ((a + 8) & 0x0F) * 2));
  return g.mulHLByAFracSigned((t * 2) & 0xFFFF, (hl >> 1) & 0xFF);
}

export function clubParams(w) {                  // 10:5EEF ShotClubParams
  const r6 = w.wram[6];
  const club = r6[0x329];
  const p = rw(0x10, 0x61A6 + 2 * club);         // ClubParamTable 10:61A6
  r6[0x411] = rb(0x10, p); r6[0x412] = rb(0x10, p + 1); r6[0x416] = rb(0x10, p + 2); r6[0x417] = rb(0x10, p + 3);
  if (club === 0x0D) {
    for (const o of [0x41C, 0x41D, 0x41A, 0x41B, 0x40F, 0x410]) r6[o] = 0;
    return;
  }
  wr16(r6, 0x41A, elevation(club, r6[0x4C8]));
  const hl = clubDistance(club, rd16(r6, 0x4C6), r6[0x4CC]);
  wr16(r6, 0x41C, shapeDirection(hl, shape(w)));
  wr16(r6, 0x40F, (rw(0x10, ptr(0x5F74, ((shape(w) + 8) & 0x0F) * 2)) * 2) & 0xFFFF);   // CurveStartTable 10:5F74
}

export function missIndex(w) {                   // 10:6B1F MissIndex: the impact cursor through table $D321
  const r6 = w.wram[6];
  let a = r6[0x44F];
  if (r6[0x333] & 1) a = (-a) & 0xFF;
  if (a & 0x80) a = a >= 0xF2 ? a : 0xF2;
  else if (a >= 0x0E) a = 0x0E;
  const t = rw(0x10, ptr(0x6B5B, (r6[0x321] & 7) * 2));
  return rb(0x10, (t + (((a + 0x0E) & 0xFF) >> 1)) & 0xFFFF);
}

function missSpeed(w) {                          // 10:6BC7 MissSpeed: speed factor for the miss ($C9FD = index)
  const a = missIndex(w);
  w.wram[0][0x9FD] = a;
  return rb(0x10, 0x6BDC + ((a + 9) & 0xFF));
}

function control(w, hl) {                        // 10:6BEF Control: by the golfer's control $D4CB, then x 2
  const f = rb(0x10, 0x6C08 + ((w.wram[6][0x4CB] + 4) & 0x0F));
  if (f) hl = g.mulHLByAFracSigned(hl, f);
  return (hl * 2) & 0xFFFF;
}

const wordAt = (base, b) => rw(0x10, ((base & 0xFF00) + (((((b + 9) & 0xFF) * 2) & 0xFF) + (base & 0xFF))) & 0xFFFF);

const missElevation = (w, b) => control(w, wordAt(0x6C2E, b));      // 10:6C18 MissElevation
function missDirection(w, b) {                   // 10:6C54 MissDirection (x 1.5 from lie terrain $0C)
  let hl = control(w, wordAt(0x6C79, b));
  if (w.wram[6][0x4CD] === 0x0C) hl = (hl + g.mulHLByAFracSigned(hl, 0x80)) & 0xFFFF;
  return hl;
}
const missCurve = (w, b) => control(w, wordAt(0x6CB5, b));          // 10:6C9F MissCurve

export function lieClass(w, table = 0x66CB, bank = 0x10) {   // 10:6672 LieClass (3C:41ED is a copy, table 3C:4246)
  const r6 = w.wram[6];
  if (r6[0x445]) return 0;
  const t = r6[0x4CD], q = r6[0x446];
  if (t === 0x0D || t === 0x02) { if (q) return q === 1 ? 5 : 6; }
  else if (t === 0x00 || t === 0x0E) { if (q) return q === 1 ? 9 : 0x0A; }
  else if (t === 1) { if (q) return 0x0B; }
  return rb(bank, ptr(table, t));
}

function lieFactor(w) {                          // 10:65EF LieFactor: [d, e] of the club's row
  const p = (rw(0x10, ptr(0x660E, w.wram[6][0x329] * 2)) + lieClass(w) * 2) & 0xFFFF;
  return [rb(0x10, p + 1), rb(0x10, p)];
}

export const scaleByPower = (hl, a) => (a >= 0x3C ? hl : g.mulHLByAFrac(hl, rb(0x10, 0x6875 + a)));   // 10:6865

export function baseDistance(w, club = w.wram[6][0x329]) {   // 10:68B1 ClubBaseDistance (10:68B4 for a given club)
  const r6 = w.wram[6];
  if (club === 0x0D) return r6[0x32B] === 0 ? 0x140 : r6[0x32B] === 1 ? 0x42A : 0x855;
  if (r6[0x32A] === 2) return 0x780;
  if (r6[0x32A] === 3) return 0x3C0;
  let hl = g.mulHLByA(clubDistance(club, rd16(r6, 0x4C6), r6[0x4CC]), 0x20);
  if (r6[0x32A]) hl = (hl + g.mulHLByDE(hl, 0x199A)) & 0xFFFF;
  return hl;
}

// 10:6D6A: the distance -> launch speed routine by trajectory class $D4C8 (banks 38-3A: the same code, each
// with its own two tables, whose addresses are the operands at +$11 and +$36)
const TABLE_ROUTINES = [...Array(5).fill([0x39, 0x6A48]), [0x39, 0x5525], [0x39, 0x4006], [0x38, 0x6A02], [0x38, 0x4006],
  [0x38, 0x550B], [0x3A, 0x4006], [0x3A, 0x54EB], ...Array(4).fill([0x3A, 0x69BC])];

function speedTable(w, club, de) {
  const [bank, addr] = TABLE_ROUTINES[(w.wram[6][0x4C8] + 8) & 0x0F];
  const t1 = rw(bank, addr + 0x11), t2 = rw(bank, addr + 0x36);
  if (club >= 0x0D) return 0x40;
  if (w.wram[6][0x32A] === 2) return rb(bank, (rw(bank, t2 + 2 * club) + (de & 0xFFFE)) & 0xFFFF);
  const p = (rw(bank, t1 + 2 * club) + (de & 0xFFFE)) & 0xFFFF;
  if (!(de & 1)) return rw(bank, p);
  return ((rw(bank, p) + rw(bank, p + 2)) & 0xFFFF) >> 1;
}

function shapeSpeed(hl, a) {                     // 08:60BC ShapeSpeed
  const f = rb(0x08, ptr(0x60D6, (a + 8) & 0x0F));
  return f ? (hl + g.mulHLByAFrac(hl, f)) & 0xFFFF : hl;
}

export function shotSpeed(w) {                   // 10:6CDB ShotSpeed
  const r6 = w.wram[6];
  const club = r6[0x329];
  if (club === 0x0D) {                           // the putter: by range $D32B and power (10:6DCD)
    const t = rw(0x10, ptr(0x6DCD, (r6[0x32B] & 3) * 2));
    return rw(0x10, (t + (r6[0x450] & 0xFE)) & 0xFFFF);
  }
  let hl = baseDistance(w);
  const [d, e] = lieFactor(w);
  const total = (d + e) & 0xFF;
  if (total >= 0xA0 && r6[0x32A] < 2 && r6[0x450] === 0x3C && r6[0x44F] === 0) r6[0x48E] |= 8;   // the cue
  if (total !== 0xC6) hl = g.mulHLByAFrac(hl, ((0x148 * total + 0x80) & 0xFFFF) >> 8);
  const f = missSpeed(w);
  if (f) hl = g.mulHLByAFrac(hl, f);
  hl = scaleByPower(hl, r6[0x450]);
  hl = ((hl + 0x10) & 0xFFFF) >> 5;
  hl = shapeSpeed(hl, shape(w));
  return speedTable(w, club, hl);
}

export function scaleSpeed(hl, de) {             // 10:6134 ScaleSpeed: hl x e/256, or hl x (1 + e/256) with d
  const f = g.mulHLByAFrac(hl, de & 0xFF);
  return de >> 8 ? (hl + f) & 0xFFFF : f;
}

export function shotLaunch(w, fx) {              // 10:5F94 ShotLaunch
  const r6 = w.wram[6];
  r6.copyWithin(0x51D, 0x400, 0x406);            // 10:52C2
  clubParams(w);
  wr16(r6, 0x418, (rd16(r6, 0x418) + rd16(r6, 0x41C)) & 0xFFFF);
  let hl;
  if (r6[0x4BF]) {                               // the computer: its targets go into the meter
    hl = rd16(r6, 0x4C6);
    r6[0x44F] = r6[0x4D9]; r6[0x450] = r6[0x4D8];
    r6[0x44B] = r6[0x44C] = 0;
  } else hl = shotSpeed(w);
  hl = scaleSpeed(rd16(r6, 0x416), hl);
  let imp = r6[0x44C];
  if (imp) hl = imp & 0x80 ? (hl + g.mulHLByAFrac(hl, 7)) & 0xFFFF : g.mulHLByAFrac(hl, 0xF9);
  wr16(r6, 0x416, hl);
  const club = r6[0x329];
  if (club !== 0x0D) {
    const b = missIndex(w);
    const e = (rd16(r6, 0x41A) + missElevation(w, b)) & 0xFFFF;
    wr16(r6, 0x41A, (e >> 8) >= 0x40 ? 0x3F00 : e);
    wr16(r6, 0x418, (rd16(r6, 0x418) + missDirection(w, b)) & 0xFFFF);
    wr16(r6, 0x40F, (rd16(r6, 0x40F) + missCurve(w, b)) & 0xFFFF);
    imp = r6[0x44C];
    const spin = scaleSpeed(rd16(r6, 0x411), (imp & 0x80 ? 0 : 0x100) | imp);
    wr16(r6, 0x411, scaleByPower(spin, r6[0x450]));
    let side = (-r6[0x44B]) & 0xFF;
    if (side & 0x80) side |= 0xFF00;
    wr16(r6, 0x40F, (rd16(r6, 0x40F) + ((side << 5) & 0xFFFF)) & 0xFFFF);
  }
  let [h2, de] = g.mulSinCos(rd16(r6, 0x416), rd16(r6, 0x41A));
  wr16(r6, 0x40D, de);
  [h2, de] = g.mulSinCos(h2, rd16(r6, 0x418));
  wr16(r6, 0x409, h2);
  wr16(r6, 0x40B, de);
  r6[0x415] = r6[0x489] = club === 0x0D ? 0 : 1;
  r6[0x48A] = r6[0x401]; r6[0x48B] = r6[0x402]; r6[0x48C] = r6[0x404]; r6[0x48D] = r6[0x405];
  if (fx) fx.push(["sound", launchSound(w, club)]);
}

function launchSound(w, club) {                  // 10:60E9-10:6133: the sound of the hit
  const r6 = w.wram[6];
  if (club === 0x0D) return 0x48;                // the putter
  if (club >= 7) {                               // by the lie: bunker $47, rough $46, else $45
    const t = r6[0x4CD];
    return t === 2 || t === 0x0D ? 0x47 : t === 1 || t === 0x0C ? 0x46 : 0x45;
  }
  if (club) return 0x43;
  return r6[0x32A] === 1 && r6[0x44F] === 0 && r6[0x450] === 0x3C ? 0x42 : 0x41;   // the driver: a perfect power shot
}
