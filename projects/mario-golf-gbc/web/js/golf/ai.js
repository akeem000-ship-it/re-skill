// The computer golfer (bank 3C): CpuPlanShotMain 3C:426A chooses the club, shot mode, aim, swing power and
// impact and the d-pad hold for a computer-controlled player, from the hole, the lie, the wind, the golfer's
// AI record and the random seed. Work bytes in WRAM6: $D525-$D536 scratch, $D545/$D547 the target, $D549 the
// stroke bias, $D54A-$D551 the plan, $D552-$D55E putt reading, $D592, $D598-$D59C, $D608.
// The maps come from the Hole (bank 3C keeps its own copies of the terrain and slope routines: 3C:4006-3C:4256).
import { rb, rw } from "./rom.js";
import * as g from "./math.js";
import * as L from "./launch.js";
import { advanceRandomSeed } from "./round.js";
import { rd16, wr16, playerField, ball, busRead } from "./memory.js";
import { pinDist } from "./cup.js";
import * as S from "./swing.js";
import * as A from "./aim.js";
import { lieTerrain } from "./shot.js";

const pinDistOf = w => pinDist(ball(w));         // 10:62AD PinDist

const sub = (a, b) => (a - b) & 0xFFFF;

// ---- the golfer's AI record (3C:4360) ----
export function aiRecord(w) {                    // 3C:4360 GolferAiRecord: PlayerField $10 (>= $10: 0) -> 8 bytes
  let a = w.wram[0][playerField(w, 0x10)];
  if (!((a - 0x10) & 0x80)) a = 0;
  return rw(0x3C, 0x4324 + 2 * a);
}
const recByte = (w, k) => rb(0x3C, aiRecord(w) + k);
export const aiBits01 = w => recByte(w, 0) & 3;                 // 3C:4381
export const aiBits23 = w => (recByte(w, 0) >> 2) & 3;          // 3C:438A
export const aiBits45 = w => (recByte(w, 0) >> 4) & 3;          // 3C:4397
export const aiBits67 = w => (recByte(w, 0) >> 6) & 3;          // 3C:43A8
export const aiPowerShotBits = w => recByte(w, 1) & 3;          // 3C:43BD
export const aiWindLimit = w => (recByte(w, 1) >> 2) & 7;       // 3C:43C7
export const aiTargetStrokes = w => recByte(w, 2);              // 3C:43D5
export function aiCourseBonus(w) {              // 3C:43DE GolferAiCourseBonus: courses 1-5
  const c = w.wram[0][0x836];
  if (!c || !((c - 6) & 0x80)) return 0;
  return rb(0x3C, aiRecord(w) + 3 + c - 1);
}

export function compare16(bc, de) {              // 3C:4404 CpuCompare16: 0 equal, 1 bc > de, 2 bc < de (signed)
  const hl = sub(bc, de);
  return hl & 0x8000 ? 2 : hl ? 1 : 0;
}

// 3C:4483: the distance of (hl, de) (16-bit signed offsets) in steps that keep the squares in range
function scaledDist(hl, de) {
  const habs = v => ((v >> 8) & 0x80 ? (-(v >> 8)) & 0xFF : v >> 8);
  let a = habs(de);
  if (a < habs(hl)) a = habs(hl);
  const b = a >= 0x20 ? 1 : a >= 0x10 ? 2 : a >= 8 ? 3 : a >= 4 ? 4 : a >= 2 ? 5 : 6;
  for (let k = 0; k < b; k++) { de = (de << 1) & 0xFFFF; hl = (hl << 1) & 0xFFFF; }
  const t = (g.mulHLByDEBothSigned(hl, hl) + g.mulHLByDEBothSigned(de, de)) & 0xFFFF;
  return (g.isqrtHL(t) << 8) >> b;
}
export const distToTarget = (w, bc, de) => scaledDist(sub(bc, rd16(w.wram[6], 0x545)), sub(de, rd16(w.wram[6], 0x547)));   // 3C:4428
export const distToCup = (w, bc, de) => scaledDist(sub(bc, rd16(w.wram[6], 0x43D)), sub(de, rd16(w.wram[6], 0x43F)));      // 3C:4447 CpuDistToCup
export const distFromBall = (w, bc, de) => scaledDist(sub(bc, rd16(w.wram[6], 0x401)), sub(de, rd16(w.wram[6], 0x404)));   // 3C:4466 CpuDistFromBall

export function angleTargetToPoint(w, bc, de) {  // 3C:44DE CpuAngleTargetToPoint
  const r6 = w.wram[6];
  return g.angleFromVector16(sub(de, rd16(r6, 0x547)), sub(bc, rd16(r6, 0x545)));
}
export function aimAtTarget(w) {                 // 3C:44FC CpuAimAtTarget: the angle from the ball to the target
  const r6 = w.wram[6];
  return g.angleFromVector16(sub(rd16(r6, 0x547), rd16(r6, 0x404)), sub(rd16(r6, 0x545), rd16(r6, 0x401)));
}

export function clubDistanceForLie(w, club) {    // 3C:453F CpuClubDistanceForLie (the lie factor of wClub's row)
  const hl = L.baseDistance(w, club);            // 10:68B4
  const p = (rw(0x3C, (0x4189 + ((w.wram[6][0x329] * 2) & 0xFF)) & 0xFFFF) + L.lieClass(w, 0x4246, 0x3C) * 2) & 0xFFFF;
  const sum = (rb(0x3C, p) + rb(0x3C, p + 1)) & 0xFF;   // 3C:416A CpuLieFactor
  if (sum === 0xC6) return hl;
  return g.mulHLByAFrac(hl, ((g.mulHLByA(0x148, sum) + 0x80) & 0xFFFF) >> 8);
}
export function clubDistanceAtPower(w, club, power) {   // 3C:4528 CpuClubDistanceAtPower: / 60 x power
  return g.mulHLByA(g.divHLByDE(clubDistanceForLie(w, club), 0x3C), power);
}

// 3C:4564 CpuTerrainAtPoint: [terrain, slope byte (c; off the map c is left as cIn), direction byte] at (hl, de),
// green-relative in views 1-3
export function terrainAtPoint(w, hole, hl, de, cIn = 0) {
  const r6 = w.wram[6];
  if (r6[0x443] && r6[0x443] !== 4) {
    de = ((((de >> 8) - r6[0x442]) & 0xFF) << 8 | (de & 0xFF)) << 2 & 0xFFFF;
    hl = ((((hl >> 8) - r6[0x441]) & 0xFF) << 8 | (hl & 0xFF)) << 2 & 0xFFFF;
  }
  const [v, b] = safeSlopeAt(hole, hl, de);
  const c = (hl & 0x8000) || (de & 0x8000) ? cIn : outside(hl, de) ? 0 : v;   // (the range test loads bc = $4000)
  return [safeTerrainAt(hole, hl, de), c, b];
}
const outside = (hl, de) => (hl & 0x8000) || (de & 0x8000) || compare16(0x4000, hl) === 2 || compare16(0x4000, de) === 2;
export function safeSlopeAt(hole, hl, de) {      // 3C:45AF CpuSafeSlopeAt: [$80, 0] off the map
  if (outside(hl, de)) return [0x80, 0];
  return hole.slopeAt(hl, de);                   // 3C:404C CpuGreenSlopeAt
}
export function safeTerrainAt(hole, hl, de) {    // 3C:45D5 CpuSafeTerrainAt: 7 (out of bounds) off the map
  if (outside(hl, de)) return 7;
  return hole.terrainAt(hl, de);                 // 3C:40B1 CpuTerrainAt
}

export function randomUpTo(w, n) {               // 3C:4599 RandomUpTo: a random low byte l with (l - n) & $80 or l = n
  for (;;) {
    const l = advanceRandomSeed(w) & 0xFF;
    const a = (l - n) & 0xFF;
    if (!a || a & 0x80) return l;
  }
}

export function clubBanned(w, club) {            // 3C:465F CpuClubBanned
  const lie = w.wram[6][0x4CD];
  if (club <= 2) return lie === 0 || lie === 0x0E ? 0 : 1;
  if (club === 0x0B || club === 0x0C) return 0;
  return lie === 4 ? 1 : 0;
}

export function pickClubForDistance(w, bc) {     // 3C:45F9 CpuPickClubForDistance: the shortest club that reaches bc
  const lie = w.wram[6][0x4CD];
  let a;
  if (lie === 6 || lie === 0x0A) a = 0x0D;
  else {
    a = 0;
    for (;;) {
      if (a === 0x0D) break;
      if (clubBanned(w, a)) { a++; continue; }
      if (compare16(bc, clubDistanceForLie(w, a)) === 1) break;   // this one falls short
      a++;
    }
    if (a) {
      a--;
      if (clubBanned(w, a)) a++;
    }
  }
  if (((a - 3) & 0x80) && lie !== 0 && lie !== 0x0E) a = 3;   // woods only from the tee or the fairway
  return a;
}

// ---- the stroke schedule ----
export function nineSplit(w) {                   // 3C:51F6 CpuNineSplit: [front nine, back nine] shares of the bias
  const d = aiBits01(w);
  const e = (aiTargetStrokes(w) + aiCourseBonus(w)) & 0xFF;
  let b = 0, c = 0, a = e & 0x80 ? (-e) & 0xFF : e;
  if (a & 1) { a--; if (d === 2) c++; else b++; }
  a >>= 1;
  b = (b + a) & 0xFF; c = (c + a) & 0xFF;
  if (d === 2) { b = (b + 2) & 0xFF; c = (c - 2) & 0xFF; }
  else if (d) { b = (b - 2) & 0xFF; c = (c + 2) & 0xFF; }
  if (aiTargetStrokes(w) & 0x80) { b = (-b) & 0xFF; c = (-c) & 0xFF; }
  return [b, c];
}

// 3C:50D3 CpuHoleStrokeBias: the golfer's target strokes over par (record byte 2 + course bonus) spread over the
// 18 holes ($D527-$D538, front and back nine by CpuNineSplit, the rest from this hole on): this hole's share
export function holeStrokeBias(w) {
  const r6 = w.wram[6], w0 = w.wram[0];
  const at = k => 0x527 + k;                     // $D527 + k (WRAM6)
  r6[0x526] = 0;                                 // (3C:50E3 stores PlayerField $3E first: overwritten)
  r6[0x539] = aiBits01(w);
  const [front, back] = nineSplit(w);
  r6[0x53A] = front; r6[0x53B] = back;
  r6[0x525] = (aiTargetStrokes(w) + aiCourseBonus(w)) & 0xFF;
  const total = (r6[0x525] - r6[0x526]) & 0xFF;
  if (!total) return 0;
  r6[0x526] = total;
  for (let k = 0; k < 0x12; k++) r6[at(k)] = 0;
  const spread = (b, hl, c, end) => {            // +-1 per hole while b lasts
    while (c !== end && b) {
      if (!(b & 0x80)) { r6[hl] = (r6[hl] + 1) & 0xFF; b = (b - 1) & 0xFF; }
      else { r6[hl] = (r6[hl] - 1) & 0xFF; b = (b + 1) & 0xFF; }
      hl++; c = (c + 1) & 0xFF;
    }
    return c;
  };
  let c = spread(r6[0x53A], at(0), 0, 9);
  spread(r6[0x53B], at(9), c, 0x12);             // (c goes on from the front nine)
  const h = (w0[0x837] - 1) & 0xFF;
  let b = 0;
  for (let a = h, hl = at(h); a !== 0x12; a = (a + 1) & 0xFF, hl++) b = (b + r6[hl & 0xFFF]) & 0xFF;
  b = (r6[0x526] - b) & 0xFF;
  r6[0x526] = b;
  while (b) {                                    // what is left, again from this hole on
    let hl = at(h), cc = h;
    while (b && cc !== 0x12) {
      if (!(b & 0x80)) { r6[hl & 0xFFF] = (r6[hl & 0xFFF] + 1) & 0xFF; b = (b - 1) & 0xFF; }
      else { r6[hl & 0xFFF] = (r6[hl & 0xFFF] - 1) & 0xFF; b = (b + 1) & 0xFF; }
      hl++; cc = (cc + 1) & 0xFF;
    }
  }
  return r6[at(h) & 0xFFF];
}

// ---- random offsets ----
export function randomOffset(w, range, nonZero = false) {   // 3C:6396 CpuRandomOffset / 3C:63C7 CpuRandomOffsetNonZero
  if (!range) return 0;
  let l, h;
  for (;;) {
    const v = advanceRandomSeed(w);
    l = v & 0x0F; h = v >> 8;
    if (!l) { if (nonZero) continue; break; }
    const a = (l - range) & 0xFF;
    if (!a || a & 0x80) break;
  }
  return h & 1 && l ? (-l) & 0xFF : l;
}

// the plan as CpuPlanShotMain returns it: club (a), shot mode (d), aim (bc), d-pad hold (e), power (h), impact (l)
const plan = (club, mode, aim, pad, power, impact) => ({ club, mode, aim, pad, power, impact });

function aheadOfSchedule(w) {                    // par + bias - (strokes + 1) > 0
  const r6 = w.wram[6];
  const a = (r6[0x549] + r6[0x325] - (w.wram[0][playerField(w, 0x20)] + 1)) & 0xFF;
  return !(a & 0x80) && a !== 0;
}

function puttPower(hl) {                         // 3C:5E97-3C:5F0F / 3C:6155-3C:61C5: [power, shot mode] for a distance
  if (!(((hl + 0xFEE0) & 0xFFFF) & 0x8000)) {    // $120 or more: the long range
    let l = (((hl * 2) & 0xFFFF) >> 5) & 0xFF;
    l = ((l + 1) & 0xFF) & 0xFE;
    if (!l) l = 4;
    return [l, 1];
  }
  let de = hl;
  let v = (hl * 2 + de) & 0xFFFF;
  v = (v * 2) & 0xFFFF;
  de >>= 1; v = (v + de) & 0xFFFF;
  de >>= 2; v = (v + de) & 0xFFFF;
  let l = (v >> 5) & 0xFF;
  l = ((l + 1) & 0xFF) & 0xFE;
  if (!l) l = 4;
  if ((l - 8) & 0x80) l = 8;
  if (!((l - 0x3D) & 0x80)) l = 0x3C;
  return [l, 0];
}

// 3C:5DCD CpuPlanPutt: at the cup (a random offset of +-16 x 1-2 when ahead of schedule), the putter, the power
// from the distance, then CpuReadPutt
export function planPutt(w, hole) {
  const r6 = w.wram[6];
  r6.copyWithin(0x545, 0x43D, 0x441);
  const d = pinDistOf(w);
  if (compare16(0x40, d) !== 1 && aheadOfSchedule(w)) {   // (3C:5DFD's "golfer 7" test never matches)
    for (const o of [0x545, 0x547]) {
      const off = randomOffset(w, 2, true);
      const v = g.mulHLByA(off & 0x80 ? 0xFF00 | off : off, 0x10);
      wr16(r6, o, rd16(r6, o) + v);
    }
  }
  const aim = aimAtTarget(w);
  const hl = distFromBall(w, rd16(r6, 0x545), rd16(r6, 0x547));
  let power, mode;
  if (!(((hl + 0xFC40) & 0xFFFF) & 0x8000)) [power, mode] = [0x3C, 1];
  else [power, mode] = puttPower(hl);
  return readPutt(w, hole, plan(0x0D, mode, aim, 0xFF, power, 0));
}

// 3C:5F1C CpuReadPutt: walks the line in $20 steps reading the green's slope; the strongest slope on the second
// half bends the aim (PuttBreakTable 3C:5D9D by direction and strength, x $B6). The sideways sum and its power
// change are dead: 3C:601B tests a ROM byte ($000C) instead of the toggle $D55E.
function readPutt(w, hole, p) {
  const r6 = w.wram[6];
  r6[0x54A] = p.club; r6[0x54C] = p.aim >> 8; r6[0x54D] = p.aim & 0xFF;
  r6[0x54E] = p.mode; r6[0x54F] = p.pad; r6[0x550] = p.power; r6[0x551] = p.impact;
  const len = g.mulHLByA(g.divHLByDE(r6[0x54E] ? 0x3C0 : 0x140, 0x3C), r6[0x550]);
  wr16(r6, 0x552, len);
  r6[0x558] = r6[0x559] = r6[0x55E] = 0;
  wr16(r6, 0x55A, sub(len, len >> 1));
  wr16(r6, 0x55C, 0);
  wr16(r6, 0x554, 0);
  if (!(rb(0, 0x000C) & 1)) throw new Error("the putt's sideways reading (~3C:6022) is not ported");
  while (compare16(rd16(r6, 0x552), rd16(r6, 0x554)) === 1) {
    const aim = r6[0x54C] << 8 | r6[0x54D];
    const [dx, dy] = g.mulSinCos(rd16(r6, 0x554), aim);
    const x = (rd16(r6, 0x401) + dx) & 0xFFFF, y = (rd16(r6, 0x404) + dy) & 0xFFFF;
    const [, slope, dir] = terrainAtPoint(w, hole, x, y, x & 0xFF);
    const strength = (slope >> 4) & 3;
    if (strength) {
      let rel = sub(dir << 8, aim);
      wr16(r6, 0x556, rel);
      if (compare16(rd16(r6, 0x55A), rd16(r6, 0x554)) !== 1 && ((r6[0x559] - strength) & 0x80)) {
        r6[0x559] = strength;                    // the strongest slope on the second half
        r6.copyWithin(0x55C, 0x556, 0x558);
      }
    }
    wr16(r6, 0x554, rd16(r6, 0x554) + 0x20);
    r6[0x55E] = (r6[0x55E] + 1) & 1;
  }
  if (r6[0x559]) {
    const h = r6[0x55D];
    let b = h >> 4;
    if (!(((h & 0x0F) - 8) & 0x80)) b = (b + 1) & 0x0F;
    const bend = rb(0x3C, 0x5D9D + 3 * b + ((r6[0x559] - 1) & 0xFF));
    const de = g.mulHLByA(0xB6, bend & 0x80 ? (-bend) & 0xFF : bend);
    let aim = r6[0x54C] << 8 | r6[0x54D];
    aim = bend & 0x80 ? sub(aim, de) : (aim + de) & 0xFFFF;
    r6[0x54C] = aim >> 8; r6[0x54D] = aim & 0xFF;
  }
  // (3C:6106: PinDist, and with $D558 = 0 nothing more)
  return plan(r6[0x54A], r6[0x54E], r6[0x54C] << 8 | r6[0x54D], r6[0x54F], r6[0x550], r6[0x551]);
}

const inList = (w, addr) => {                    // 3C:4A11 IsHoleInList41 (list 3C:4A0F) / 3C:4A33 IsHoleInList17 (3C:4A2F)
  for (let p = addr; rb(0x3C, p) !== 0xFF; p++) if (rb(0x3C, p) === w.wram[6][0x320]) return 1;
  return 0;
};
export const holeInList41 = w => inList(w, 0x4A0F);
export const holeInList17 = w => inList(w, 0x4A2F);
const golferId = w => w.wram[0][playerField(w, 0x10)];
const strokes = w => w.wram[0][playerField(w, 0x20)];

export function windAngleToAim(aim, windAngle) { // 3C:569A WindAngleToAim: wind angle - aim (rounded to 1/16 turn)
  let d = aim >> 8;
  d = (d & 0x0F) >= 8 ? ((d & 0xF0) + 0x10) & 0xFF : d & 0xF0;
  return ((windAngle << 8) - (d << 8)) & 0xFFFF;
}

// 3C:63F8 CpuChooseSpin: the d-pad held through the swing: $40 (up), $80 (down) or $FF (none)
export function chooseSpin(w, aim, d) {         // (d is kept in $D527)
  const r6 = w.wram[6], w0 = w.wram[0];
  r6[0x525] = aim & 0xFF; r6[0x526] = aim >> 8; r6[0x527] = d;
  if ([2, 0x0B, 6, 0x0A, 5, 0x0C].includes(r6[0x4CD])) return 0xFF;
  const windWeak = () => ((w0[0x815] - ((aiWindLimit(w) + 5) & 0xFF)) & 0x80) !== 0;
  if (compare16(rd16(r6, 0x545), rd16(r6, 0x43D)) === 0 && compare16(rd16(r6, 0x547), rd16(r6, 0x43F)) === 0) {
    if (windWeak()) return 0xFF;                 // at the cup
    const s = aiBits67(w);
    if (s === 0) return advanceRandomSeed(w) & 1 ? 0x40 : 0xFF;
    if (s === 1) return (advanceRandomSeed(w) & 3) === 0 ? 0x40 : 0xFF;
    return 0xFF;
  }
  if (strokes(w) || windWeak()) return 0xFF;
  let de = windAngleToAim(aim, w0[0x816]);
  if (de & 0x8000) de = (-de) & 0xFFFF;
  const s = aiBits67(w);
  if (compare16(0x2000, de) !== 2) return s === 0 || s === 1 ? 0x40 : 0xFF;   // the wind from behind
  if (compare16(0x6000, de) === 1) return 0xFF;
  return s === 2 || s === 1 ? 0x80 : 0xFF;      // against the wind
}

export function decidePowerShot(w) {             // 3C:6530 CpuDecidePowerShot: 1 to use a power shot
  const r6 = w.wram[6];
  if (strokes(w) || r6[0x325] === 3 || !w.wram[0][playerField(w, 0x28)] || holeInList41(w)) return 0;
  const b = aiPowerShotBits(w);
  if (b === 0) return randomUpTo(w, 0x0E) === 7 ? 1 : 0;
  if (b === 1) return randomUpTo(w, 0x08) === 4 ? 1 : 0;
  if (r6[0x325] === 5) return 1;
  return randomUpTo(w, 0x05) === 3 ? 1 : 0;
}

export function powerJitter(w, h) {              // 3C:6213 CpuPowerJitter: power h +- a random error when ahead
  if (!aheadOfSchedule(w)) return h;
  const lie = w.wram[6][0x4CD], gid = golferId(w);
  let c;
  if (gid !== 0x0B && gid !== 0x0D && ![1, 2, 4, 3, 8, 0x0B, 0x0C].includes(lie)) c = (advanceRandomSeed(w) & 3) - 1;
  else {
    const s = aiBits23(w);
    if (s === 0) c = (advanceRandomSeed(w) & 0x0F) - 7;
    else if (s === 1) c = (advanceRandomSeed(w) & 7) - 4;
    else c = (advanceRandomSeed(w) & 3) - 1;
  }
  const d = (h + c) & 0xFF;
  if ((d - 3) & 0x80) return 3;
  if (!((d - 0x3C) & 0x80)) return 0x3C;
  return d;
}

// 3C:62CA CpuImpactError: wClub / wShotMode set from the plan; when ahead of schedule a random impact error
// (CpuRandomOffset of the miss table's range); returns the impact (l), or null when it leaves hl as it was
export function impactError(w, club, mode, h) {
  const r6 = w.wram[6], lie = r6[0x4CD], gid = golferId(w);
  r6[0x329] = club; r6[0x32A] = mode;
  if (!S.missTable(w)) return null;              // (the "golfer 7" test can match here: the byte is read)
  if (gid === 7 || !aheadOfSchedule(w)) return null;
  if (gid !== 0x0B && gid !== 0x0D && ![1, 2, 4, 3, 8, 0x0B, 0x0C].includes(lie)) {
    if ((h - 0x38) & 0x80) return null;
    const m = S.missTable(w);
    return m ? randomOffset(w, m) : 0;
  }
  const s = aiBits23(w), m = S.missTable(w);
  if (s === 0) return m ? randomOffset(w, (m + 4) & 0xFF) : 0;
  if (s === 1) return m ? randomOffset(w, m >> 1) : 0;
  return randomOffset(w, m >> 1);
}

// 3C:5C22 CpuScanPathToCup: from the ball toward the cup in $10 steps: the first green / semi-rough point ->
// $D592 / $D594; 1 when the path crosses anything but fairway, green and semi-rough
export function scanPathToCup(w, hole) {
  const r6 = w.wram[6];
  r6.fill(0xFF, 0x592, 0x596);
  wr16(r6, 0x525, A.aimAtCup(w));
  wr16(r6, 0x527, pinDistOf(w));
  wr16(r6, 0x529, 0);
  for (;;) {
    if (!(sub(rd16(r6, 0x529), rd16(r6, 0x527)) & 0x8000)) return 0;
    const [dx, dy] = g.mulSinCos(rd16(r6, 0x529), rd16(r6, 0x525));
    const x = (dx + rd16(r6, 0x401)) & 0xFFFF, y = (rd16(r6, 0x404) + dy) & 0xFFFF;
    const [t] = terrainAtPoint(w, hole, x, y, r6[0x401]);
    if (t !== 0) {
      if (t !== 6 && t !== 0x0A && t !== 9) return 1;
      if (r6[0x593] === 0xFF && r6[0x592] === 0xFF) { wr16(r6, 0x592, x); wr16(r6, 0x594, y); }
    }
    wr16(r6, 0x529, rd16(r6, 0x529) + 0x10);
  }
}

export function approachClubByDistance(w, style, hl) {   // 3C:5D60 CpuApproachClubByDistance
  const row = 0x4344 + 8 * style;
  for (let i = 0; i < 4; i++) if (compare16(hl, rw(0x3C, row + 2 * i)) === 2) return rb(0x3C, 0x435C + i);
  return 0x0B;
}

export function chooseApproachClub(w, hole) {    // 3C:5CE4 CpuChooseApproachClub
  const r6 = w.wram[6];
  const lie = lieTerrain(hole, ball(w));          // 10:648B
  if (lie === 2) return 0x0C;
  if (lie !== 0 && lie !== 0x0A) return 0x0B;
  if (scanPathToCup(w, hole)) return 0x0B;
  const hl = sub(distFromBall(w, rd16(r6, 0x592), rd16(r6, 0x594)), 0x20);
  if (hl & 0x8000 || !hl) return 0x0D;            // the green starts within $20: putt
  const d = g.divHLByDE(distFromBall(w, rd16(r6, 0x43D), rd16(r6, 0x43F)), 0x20);
  return approachClubByDistance(w, aiBits23(w), d);
}

// 3C:59DC CpuPlanApproach: within $780 of the pin
export function planApproach(w, hole) {
  const r6 = w.wram[6];
  r6.copyWithin(0x545, 0x43D, 0x441);
  const dx = sub(rd16(r6, 0x545), rd16(r6, 0x401)) >> 8;   // (d as CpuAimAtTarget leaves it)
  const pad = chooseSpin(w, aimAtTarget(w), dx); // (3C:59FB's "golfer 7" test never matches)
  if (!(((r6[0x549] + r6[0x325] - 2) - (strokes(w) + 1)) & 0x80)) {
    for (const o of [0x545, 0x547]) {            // not behind schedule: off the cup by +-$20 x 1-2
      const off = randomOffset(w, 2, true);
      wr16(r6, o, rd16(r6, o) + g.mulHLByA(off & 0x80 ? 0xFF00 | off : off, 0x20));
    }
  }
  let aim = aimAtTarget(w);
  const hl = distFromBall(w, rd16(r6, 0x545), rd16(r6, 0x547));
  if (!(((r6[0x549] + r6[0x325] - 2) - (strokes(w) + 1)) & 0x80)) aim &= 0xFF00;   // (ld c, 0: the aim's low byte)
  const club = chooseApproachClub(w, hole);
  r6[0x54A] = club;
  let e = pad, d, h, l = 0;
  const far = !(((hl + 0xFC40) & 0xFFFF) & 0x8000);
  if (club === 0x0D) {
    e = 0xFF;
    if (far) { h = 0x3C; d = 2; e = pad; }       // (a = $0B there is not kept: $D54A stays the putter)
    else if (!(((hl + 0xFEC0) & 0xFFFF) & 0x8000)) {
      let v = ((((hl * 2) & 0xFFFF) >> 5) + 1) & 0xFE; v &= 0xFF;
      if (!v) v = 4;
      h = v; d = 1;
    } else {
      let v = ((((hl * 2 + hl) & 0xFFFF) * 2) & 0xFFFF) >> 5;
      v = ((v + 1) & 0xFF) & 0xFE;
      if (!v) v = 4;
      if ((v - 8) & 0x80) v = 8;
      h = v; d = 0;
    }
  } else if (far) { h = ((((hl >> 5) & 0xFF) + 1) & 0xFE) & 0xFF; d = 2; }
  else { h = ((((((hl * 2) & 0xFFFF) >> 5) & 0xFF) + 1) & 0xFE) & 0xFF; d = 3; }
  r6[0x54C] = aim & 0xFF; r6[0x54D] = aim >> 8; r6[0x54E] = e; r6[0x54F] = d; r6[0x550] = l; r6[0x551] = h;
  if ([2, 0x0C, 1, 5, 9].includes(r6[0x4CD])) {  // a bad lie: 25% more power, at most $3C
    let a = (((h << 24) >> 26) + h) & 0xFF;
    h = (a - 0x3D) & 0x80 ? a : 0x3C;
    r6[0x550] = l; r6[0x551] = h;
  }
  r6[0x551] = powerJitter(w, h);
  const imp = impactError(w, r6[0x54A], r6[0x54F], r6[0x551]);
  if (imp !== null) r6[0x550] = imp;
  return plan(r6[0x54A], r6[0x54F], r6[0x54D] << 8 | r6[0x54C], r6[0x54E], r6[0x551], r6[0x550]);
}

// ---- the long shot ----
export function powerForDistance(bc, de) {       // 3C:5021 CpuPowerForDistance: power to carry de with a club reaching bc
  if (compare16(bc, de) !== 1) return 0x3C;
  const q = g.divAHLByDE(0, bc, 0x3C)[1];
  const l = g.divAHLByDE(0, (de + 0x60) & 0xFFFF, q)[1] & 0xFF;
  return (l - 0x3D) & 0x80 ? l : 0x3C;
}

export function pickTeeClub(w) {                 // 3C:525C CpuPickTeeClub
  const r6 = w.wram[6];
  const b = aiBits45(w), par = r6[0x325], d = strokes(w);
  const byDistance = () => pickClubForDistance(w, pinDistOf(w));
  if (par === 3) return byDistance();
  if (par === 5 && d === 0) return 0;
  const inList = holeInList41(w);
  if (!inList && (r6[0x549] & 0x80)) return byDistance();
  const c = (par - 2) & 0xFF;
  if ((((inList ? 1 : r6[0x549]) + c - d) & 0x80)) return byDistance();
  let e;
  if (b === 0) {
    if (d === 0) e = 1;
    else if (d === 1 && c === 3) e = clubBanned(w, 2) ? 3 : 2;
    else return byDistance();
  } else {
    if (d === 0) e = 0;
    else if (d === 1 && c === 3) e = clubBanned(w, 1) ? 3 : 1;
    else return byDistance();
  }
  return clubBanned(w, e) ? byDistance() : e;
}

export function goForGreenClub(w, e) {           // 3C:5307 CpuGoForGreenClub (its test can only pass with a negative schedule)
  const r6 = w.wram[6];
  if (r6[0x4CD] === 2) return e;
  const a = (r6[0x325] - 2 + r6[0x549]) & 0xFF;
  if (!(a & 0x80) || a !== ((strokes(w) + 1) & 0xFF)) return e;
  const bc = pinDistOf(w);
  return compare16(bc, clubDistanceForLie(w, a)) === 1 ? pickClubForDistance(w, bc) : a;
}

export function routeWaypoint(w, c, golfer) {           // 3D:431A HoleRouteWaypoint: [x, y] (x 32) or [$FFE0, $FFE0]
  let b = 0;
  if (golfer !== 0xFF && !((golfer - 4) & 0x80) && (((golfer - 3) - 8) & 0x80)) b = (golfer - 3) & 0xFF;
  const rd = a => busRead(w, 0x3D, a) | busRead(w, 0x3D, a + 1) << 8;   // (ids past the table read on into code)
  const list = rd(rd(0x4252 + 2 * w.wram[6][0x320]) + 2 * b);
  if (!((c - 3) & 0x80)) return [0xFFE0, 0xFFE0];
  const p = list + 4 * c;
  return [(rd(p) << 5) & 0xFFFF, (rd(p + 2) << 5) & 0xFFFF];
}

function setTarget(w, x, y) { wr16(w.wram[6], 0x545, x); wr16(w.wram[6], 0x547, y); }

// 3C:4693 CpuChooseTarget: bc = the club's reach. The cup when in reach (but somewhere safe short of it when
// ahead of schedule, not on par 3); else the hole's route (3D:431A): the farthest waypoint in reach (and past half
// of it) that is nearer the cup than the ball, carried on toward the next waypoint by the reach left
export function chooseTarget(w, hole, bc) {
  const r6 = w.wram[6];
  wr16(r6, 0x526, bc);
  const pd = pinDistOf(w);
  wr16(r6, 0x528, pd);
  const cupX = rd16(r6, 0x43D), cupY = rd16(r6, 0x43F);
  const routeFirst = compare16(0x0C80, pd) === 2 && holeInList17(w);
  if (!routeFirst && compare16(bc, pd) !== 2) {
    setTarget(w, cupX, cupY);
    const a = ((r6[0x549] + r6[0x325] - 2) - (strokes(w) + 1)) & 0xFF;
    if (r6[0x325] !== 3 && !(a & 0x80) && a) findLandingSpot(w, hole, rd16(r6, 0x526));
    return;
  }
  r6[0x525] = 2; r6[0x52E] = 0xFF;
  while (r6[0x525] !== 0xFF) {
    const [x, y] = routeWaypoint(w, r6[0x525], golferId(w));
    const reach = rd16(r6, 0x526);
    if (compare16(x, 0xFFE0) !== 0 && compare16(reach, distFromBall(w, x, y)) !== 2 &&
        compare16(((reach >> 1) | (reach & 0x8000)) & 0xFFFF, distFromBall(w, x, y)) !== 1) {
      if (compare16(rd16(r6, 0x528), distToCup(w, x, y)) === 2) break;
      r6[0x52E] = r6[0x525];
    }
    r6[0x525] = (r6[0x525] - 1) & 0xFF;
  }
  if (!strokes(w)) r6[0x52E] = 0;
  if (r6[0x52E] === 0xFF) { findLandingSpot(w, hole, rd16(r6, 0x526)); return; }
  let [x, y] = routeWaypoint(w, r6[0x52E], golferId(w));
  if (x === 0xFFE0) { x = cupX; y = cupY; }
  setTarget(w, x, y);
  wr16(r6, 0x52A, x); wr16(r6, 0x52C, y);
  if (holeInList41(w)) return;
  let [nx, ny] = routeWaypoint(w, (r6[0x52E] + 1) & 0xFF, golferId(w));
  if (nx === 0xFFE0) {
    if (holeInList17(w)) return;
    nx = cupX; ny = cupY;
  }
  const ang = angleTargetToPoint(w, nx, ny);     // on toward the next waypoint by the reach left
  const left = sub(rd16(r6, 0x526), distFromBall(w, rd16(r6, 0x545), rd16(r6, 0x547)));
  if (left & 0x8000) return;
  const [dx, dy] = g.mulSinCos(left, ang);
  wr16(r6, 0x545, rd16(r6, 0x545) + dx);
  wr16(r6, 0x547, rd16(r6, 0x547) + dy);
}

// 3C:48D5 CpuFindLandingSpot / 3C:4A51 CpuFindFairwaySpot: around AimAtCup (16 offsets, accumulating: 3C:49B3 /
// 3C:49EB), a landing at the distance on good ground ($00 $06 $0A $0E / fairway $00 $0E away from hazards);
// shortened to 3/4 up to 2 / 4 times; else the cup. In the fairway search a spot rejected for a nearby hazard
// goes on with the loop's index and count replaced by the spot's y (de is reused at 3C:4AB4)
function searchSpot(w, hole, dist, table, tries, ground, hazards) {
  const r6 = w.wram[6];
  r6[0x527] = 0;
  wr16(r6, 0x525, dist);
  let guard = 0;
  for (;;) {
    let bc = A.aimAtCup(w), d = 0, e = 0x10;
    do {
      // the hazard path reloads d and e from the point's y, so the ROM can circle here for ever (the game hangs)
      if (++guard > 1 << 20) throw new Error("3C:4A51 the spot search never ends (the ROM hangs here too)");
      const [dx, dy] = g.mulSinCos(rd16(r6, 0x525), bc);
      const y = (rd16(r6, 0x404) + dy) & 0xFFFF, x = (rd16(r6, 0x401) + dx) & 0xFFFF;
      if (ground.includes(safeTerrainAt(hole, x, y))) {
        if (!hazards || !hazardNear(w, hole, x, y)) { setTarget(w, x, y); return; }
        d = y >> 8; e = y & 0xFF;                 // (the point's y is left in de)
        bc = g.mulSinCosLeftBC(bc);              // (and 00:11BA's scratch in bc: the aim is lost)
      }
      bc = (bc + rw(0x3C, table + (2 * d & 0xFF))) & 0xFFFF;   // 3C:499F NextAimOffset / 3C:49D7 NextAimOffsetFine (an 8-bit index)
      d = (d + 1) & 0xFF;
      e = (e - 1) & 0xFF;
    } while (e);
    if (r6[0x527] === tries) { r6.copyWithin(0x545, 0x43D, 0x441); return; }
    r6[0x527]++;
    const q = g.s16(rd16(r6, 0x525)) >> 2 & 0xFFFF;
    wr16(r6, 0x525, (q * 3) & 0xFFFF);
  }
}
export function findLandingSpot(w, hole, dist) { // 3C:48D5 CpuFindLandingSpot
  searchSpot(w, hole, dist, 0x49B3, 2, [0, 6, 0x0A, 0x0E], false);
}
export function findFairwaySpot(w, hole, dist) { // 3C:4A51 CpuFindFairwaySpot
  searchSpot(w, hole, dist, 0x49EB, 4, [0, 0x0E], true);
}

// 3C:4E74 CpuHazardNear: water, out of bounds or $0C along the row $A0 above the point, from $A0 left to $A0
// right in $20 steps (the x scan is not restarted for the next rows, so only the first is read)
export function hazardNear(w, hole, x, y) {
  const r6 = w.wram[6];
  wr16(r6, 0x52F, (x + 0xFF60) & 0xFFFF);
  wr16(r6, 0x531, (y + 0xFF60) & 0xFFFF);
  wr16(r6, 0x533, (rd16(r6, 0x52F) + 0x140) & 0xFFFF);
  wr16(r6, 0x535, (rd16(r6, 0x531) + 0x140) & 0xFFFF);
  while (compare16(rd16(r6, 0x535), rd16(r6, 0x531)) === 1) {
    while (compare16(rd16(r6, 0x533), rd16(r6, 0x52F)) === 1) {
      const t = safeTerrainAt(hole, rd16(r6, 0x52F), rd16(r6, 0x531));
      if (t === 3 || t === 7 || t === 0x0C) return 1;
      wr16(r6, 0x52F, (rd16(r6, 0x52F) + 0x20) & 0xFFFF);
    }
    wr16(r6, 0x531, (rd16(r6, 0x531) + 0x20) & 0xFFFF);
  }
  return 0;
}

export function shotNearHazard(w, hole, club, power, aim) {   // 3C:4F30 CpuShotNearHazard
  const r6 = w.wram[6];
  r6[0x52D] = club; r6[0x52E] = power;
  wr16(r6, 0x525, aim);
  const len = g.mulHLByA(g.divHLByDE(clubDistanceForLie(w, club), 0x3C), power);
  wr16(r6, 0x527, len);
  const [dx, dy] = g.mulSinCos(len, aim);
  return hazardNear(w, hole, (rd16(r6, 0x401) + dx) & 0xFFFF, (rd16(r6, 0x404) + dy) & 0xFFFF);
}

export function landingUnsafe(w, hole, x, y) {   // 3C:4BD1 CpuLandingUnsafe
  const t = safeTerrainAt(hole, x, y);
  return t === 3 || t === 5 || t === 7 ? 1 : hazardNear(w, hole, x, y);
}

export function landingPoint(w, club, power, aim) {   // 3C:4CDA CpuLandingPoint: [x, y]
  const len = g.mulHLByA(g.divHLByDE(clubDistanceForLie(w, club), 0x3C), power);
  const [dx, dy] = g.mulSinCos(len, aim);
  return [(rd16(w.wram[6], 0x401) + dx) & 0xFFFF, (rd16(w.wram[6], 0x404) + dy) & 0xFFFF];
}

// 3C:4F97 CpuPreviewHitsTree: the landing preview of this club and aim (up to 249 steps while the ghost is lower
// than $200) against the trees (08:5109); the aim, $D41C and the club are put back
export function previewHitsTree(w, hole, club, aim) {
  const r6 = w.wram[6];
  r6[0x598] = r6[0x418]; r6[0x599] = r6[0x419];
  r6[0x59A] = r6[0x41C]; r6[0x59B] = r6[0x41D];
  r6[0x59C] = r6[0x329];
  r6.copyWithin(0x514, 0x400, 0x406);            // 10:550B SaveAddressSpot
  r6[0x329] = club;
  wr16(r6, 0x418, aim);
  r6[0x41C] = 0;
  S.previewRestart(w);                           // 10:543C
  let hit = 0;
  for (let a = 0xF9; a; a--) {
    S.previewStep(w);                            // 10:5355
    if (!(sub(rd16(r6, 0x37A), 0x200) & 0x8000)) break;
    if (S.previewTree(w, hole)) { hit = 1; break; }   // 08:5109
  }
  S.previewResetBall(w);                         // 10:5518
  r6[0x329] = r6[0x59C];
  r6[0x41C] = r6[0x59A]; r6[0x41D] = r6[0x59B];
  r6[0x418] = r6[0x598]; r6[0x419] = r6[0x599];
  return hit;
}

// 3C:4C54 CpuFindClearAim: 48 accumulating aim offsets (3C:4BF4) until the preview misses the trees and the
// landing is safe: the aim, or null
export function findClearAim(w, hole, club, power, aim, bc = 0) {   // (bc, the caller's leftover, is kept in D553)
  const r6 = w.wram[6];
  r6[0x552] = club; r6[0x558] = power;
  wr16(r6, 0x553, bc);
  wr16(r6, 0x556, aim);
  for (let i = 0; i < 0x30; i++) {
    wr16(r6, 0x556, (rd16(r6, 0x556) + rw(0x3C, 0x4BF4 + 2 * i)) & 0xFFFF);
    const a = rd16(r6, 0x556);
    if (previewHitsTree(w, hole, r6[0x552], a)) continue;
    const [x, y] = landingPoint(w, r6[0x552], r6[0x558], a);
    if (!landingUnsafe(w, hole, x, y)) return rd16(r6, 0x556);
  }
  return null;
}

// 3C:4D0A CpuShortenToGoodLie: the carry walked back $20 at a time to a playable landing ($00 $02 $06 $09 $0A $0E):
// the power for it, or $FF
export function shortenToGoodLie(w, hole, club, power, aim) {
  const r6 = w.wram[6];
  r6[0x52D] = club; r6[0x52E] = power;
  wr16(r6, 0x525, aim);
  const len = g.mulHLByA(g.divHLByDE(clubDistanceForLie(w, club), 0x3C), power);
  wr16(r6, 0x527, len); wr16(r6, 0x529, len);
  for (;;) {
    const c = compare16(rd16(r6, 0x529), 0);
    if (c === 0 || c === 2) return 0xFF;
    const [dx, dy] = g.mulSinCos(rd16(r6, 0x529), rd16(r6, 0x525));
    const t = safeTerrainAt(hole, (rd16(r6, 0x401) + dx) & 0xFFFF, (rd16(r6, 0x404) + dy) & 0xFFFF);
    if ([0, 2, 6, 9, 0x0A, 0x0E].includes(t)) return powerForDistance(clubDistanceForLie(w, r6[0x52D]), rd16(r6, 0x529));
    wr16(r6, 0x529, sub(rd16(r6, 0x529), 0x20));
  }
}

// ---- the wind ----
const windRow = speed => (speed < 0x0A ? 0 : speed === 0x0E ? 2 : 1);   // (rows 3 are never picked)
const windGroup = club => (club < 3 ? 0 : club < 7 ? 1 : club < 0x0B ? 2 : 3);
export const windSide = (club, speed, d) => rb(0x3C, 0x535D + 0x40 * windGroup(club) + 0x10 * windRow(speed) + (d >> 4));    // 3C:561C WindSideLookup
export const windCarry = (club, speed, d) => rb(0x3C, 0x545D + 0x40 * windGroup(club) + 0x10 * windRow(speed) + (d >> 4));   // 3C:55BA WindCarryLookup

export function windAimCorrection(w, club, aim) {   // 3C:555D CpuWindAimCorrection: the crosswind's aim correction
  const r6 = w.wram[6], w0 = w.wram[0];
  r6[0x525] = club;
  if ((w0[0x815] - 2) & 0x80) return aim;
  const de = windAngleToAim(aim, w0[0x816]);
  const step = windSide(r6[0x525], w0[0x815], de >> 8);
  const hl = (g.mulHLByA(0x1C7, step & 0x80 ? (-step) & 0xFF : step) * 2) & 0xFFFF;
  const q = g.divHLByDE(hl, rb(0x3C, (0x534D + golferId(w)) & 0xFFFF));   // GolferWindFactorTable 3C:534D
  return step & 0x80 ? sub(aim, q) : (aim + q) & 0xFFFF;
}

// 3C:56CA CpuWindAdjustClubPower: head or tail wind changes the carry ($20 a step): the club and power for it
export function windAdjustClubPower(w, p) {
  const r6 = w.wram[6], w0 = w.wram[0];
  r6[0x525] = p.club; r6[0x526] = p.aim >> 8; r6[0x527] = p.aim & 0xFF; r6[0x528] = p.mode; r6[0x529] = p.pad;
  r6[0x52A] = p.power; r6[0x52B] = p.impact;
  if (w0[0x815]) {
    const de = windAngleToAim(p.aim, w0[0x816]);
    const b = windCarry(r6[0x525], w0[0x815], de >> 8);
    if (b) {
      const step = g.mulHLByA(0x20, b & 0x80 ? (-b) & 0xFF : b);
      let hl = clubDistanceAtPower(w, r6[0x525], r6[0x52A]);
      hl = b & 0x80 ? sub(hl, step) : (hl + step) & 0xFFFF;
      r6[0x525] = pickClubForDistance(w, hl);
      r6[0x52A] = powerForDistance(clubDistanceForLie(w, r6[0x525]), hl);
    }
  }
  return plan(r6[0x525], r6[0x528], r6[0x526] << 8 | r6[0x527], r6[0x529], r6[0x52A], r6[0x52B]);
}

const savePlan = (r6, p) => {                    // $D54A club, $D54C/$D54D aim (low, high), $D54E pad, $D54F mode, $D550 impact, $D551 power
  r6[0x54A] = p.club; r6[0x54C] = p.aim & 0xFF; r6[0x54D] = p.aim >> 8; r6[0x54E] = p.pad; r6[0x54F] = p.mode;
  r6[0x550] = p.impact; r6[0x551] = p.power;
};
const loadPlan = r6 => plan(r6[0x54A], r6[0x54F], r6[0x54D] << 8 | r6[0x54C], r6[0x54E], r6[0x551], r6[0x550]);

// 3C:5751 CpuPlanLongShot: $780 or more from the pin
export function planLongShot(w, hole) {
  const r6 = w.wram[6], w0 = w.wram[0];
  const lastOut = w0[playerField(w, 0x14)];
  let club, reach, d;
  if (lastOut === 7) {                           // after out of bounds: club $0B to a safe fairway spot
    d = 0; club = 0x0B;
    reach = clubDistanceForLie(w, club);
    findFairwaySpot(w, hole, reach);
    r6[0x549] = 0xEE;
  } else {
    d = decidePowerShot(w);
    if (d) {                                     // a power shot: the driver at +10%
      club = 0;
      const hl = clubDistanceForLie(w, 0);
      reach = (g.mulHLByDE(hl, 0x199A) + hl) & 0xFFFF;
    } else {
      r6[0x608] = pickTeeClub(w);                // wCpuTeeClub
      club = goForGreenClub(w, r6[0x608]);
      reach = clubDistanceForLie(w, club);
    }
    chooseTarget(w, hole, reach);
  }
  const power = powerForDistance(reach, distFromBall(w, rd16(r6, 0x545), rd16(r6, 0x547)));
  savePlan(r6, plan(club, d, aimAtTarget(w), r6[0x54E], power, 0));
  r6[0x54E] = chooseSpin(w, r6[0x54D] << 8 | r6[0x54C], d);
  r6[0x54F] = d;
  if (d) r6[0x551] = 0x3C;
  const aim = windAimCorrection(w, r6[0x54A], r6[0x54D] << 8 | r6[0x54C]);
  r6[0x54C] = aim & 0xFF; r6[0x54D] = aim >> 8;
  savePlan(r6, windAdjustClubPower(w, loadPlan(r6)));
  const aimNow = () => r6[0x54D] << 8 | r6[0x54C];
  let clear = !previewHitsTree(w, hole, r6[0x54A], aimNow()) &&
    (r6[0x320] === 0x17 || !shotNearHazard(w, hole, r6[0x54A], r6[0x551], aimNow()));
  if (!clear) {                                  // a tree or a hazard: other aims, then longer clubs
    r6[0x54B] = r6[0x54A];
    let bc = aimNow();                           // (only for the copy CpuFindClearAim keeps in D553)
    for (;;) {
      const a = findClearAim(w, hole, r6[0x54A], r6[0x551], aimNow(), bc);
      if (a !== null) {
        bc = a;
        if (!strokes(w)) { r6[0x54C] = a & 0xFF; r6[0x54D] = a >> 8; break; }
        const h = shortenToGoodLie(w, hole, r6[0x54A], r6[0x551], a);
        if (h !== 0xFF && !((h - 0x0A) & 0x80)) {
          r6[0x551] = (h - 0x0A) & 0xFF;
          r6[0x54C] = a & 0xFF; r6[0x54D] = a >> 8;
          break;
        }
      }
      const next = (r6[0x54A] + 1) & 0xFF;       // 3C:5885
      if (next === 0x0D) { r6[0x54A] = r6[0x54B]; break; }
      r6[0x54A] = next;
      bc = r6[0x54B] << 8 | bc & 0xFF;           // (b holds the first club for the compare)
      if (((next - r6[0x54B]) & 0xFF) === 3) r6[0x54A] = 0x0C;
    }
  }
  if (!strokes(w) && [0, 1, 2].includes(r6[0x608]) && r6[0x4CD] === 0) {   // the tee club's power for that carry
    const dist = clubDistanceAtPower(w, r6[0x54A], r6[0x551]);
    r6[0x551] = powerForDistance(clubDistanceForLie(w, r6[0x608]), dist);
    r6[0x54A] = r6[0x608];
  }
  if (w0[playerField(w, 0x14)] !== 7) {
    const h = powerJitter(w, r6[0x551]);
    let l = r6[0x550];
    if (![0, 1, 2].includes(r6[0x54A])) { const v = impactError(w, r6[0x54A], r6[0x54F], h); if (v !== null) l = v; }
    r6[0x550] = l; r6[0x551] = h;
  }
  if ((r6[0x551] - 0x0A) & 0x80) r6[0x551] = 6;
  return loadPlan(r6);
}

// 3C:426A CpuPlanShotMain: the computer's shot: [club, shot mode, aim, d-pad, power, impact] (power and impact even)
export function planShot(w, hole) {
  const r6 = w.wram[6];
  r6[0x549] = holeStrokeBias(w);
  let p;
  if (r6[0x4CD] === 6 || r6[0x4CD] === 0x0A) p = planPutt(w, hole);
  else if (!(((pinDistOf(w) + 0xF880) & 0xFFFF) & 0x8000)) p = planLongShot(w, hole);
  else p = planApproach(w, hole);
  p.power &= 0xFE; p.impact &= 0xFE;
  return p;
}
