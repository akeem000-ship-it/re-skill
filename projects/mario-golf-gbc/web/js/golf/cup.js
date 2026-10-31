// The cup and the pin (ShotMainLoop 10:6E99's helpers; tools/cup_sim.py) on the ball state s = WRAM6
// $D400-$D4FF. Each function follows its ROM routine step by step, with its 16-bit wraps, its saturations ($3FFF
// after an overflowing division, $FFFF / $FF:FFFF after an overflowing product) and the order of its sign
// fixes. Offsets in s: $99/$9B ball - cup (8.8), $9D/$9F the path's closest point to the cup, $A1/$A3 the
// contact point, $A5 distance to the cup, $A7 ball speed, $A9-$B0 the reflection, $B8 rim flags, $B9 pin
// flags, $D5 (nonzero: skips the pin and the early drop). Sounds go to fx as ["sound", id].
import * as g from "./math.js";
import { rd16, wr16 } from "./memory.js";
import { addVelToPos, dist } from "./ball.js";

const neg16 = g.neg16, abs = g.abs16;
const sgn = v => (v >> 15) & 1;
const sra16 = (v, n) => { for (let k = 0; k < n; k++) v = (v >> 1) | (v & 0x8000); return v; };
const ahl = p => (p >= 0x1000000 ? [0xFF, 0xFFFF] : [(p >>> 16) & 0xFF, p & 0xFFFF]);   // $FFAA:$FFA9:$FFA8
const div = (a, hl, de) => { const [q1, q] = g.divAHLByDE(a, hl, de); return q1 ? 0x3FFF : q; };

function offset(s, oInt, oFrac, oCup) {          // 8.8: (|integer difference| low byte, fraction), signed
  const d = (rd16(s, oInt) - rd16(s, oCup)) & 0xFFFF;
  const v = (abs(d) & 0xFF) << 8 | s[oFrac];
  return d & 0x8000 ? neg16(v) : v;
}

export function nearCup(s) {                     // 10:7122 NearCup: both integer offsets below $20
  for (const [o, c] of [[0x04, 0x3F], [0x01, 0x3D]]) {
    const d = abs((rd16(s, o) - rd16(s, c)) & 0xFFFF);
    if (!((d - 0x20) & 0x8000)) return 0;
  }
  return 1;
}

export function cupOffsets(s) {                  // 10:73CA: $D499 / $D49B, $D4A5 = Dist16
  const y = ((rd16(s, 0x04) - rd16(s, 0x3F)) & 0xFF) << 8 | s[0x03];
  wr16(s, 0x9B, y);
  const x = ((rd16(s, 0x01) - rd16(s, 0x3D)) & 0xFF) << 8 | s[0x00];
  wr16(s, 0x99, x);
  const r = dist(x, y);
  wr16(s, 0xA5, r);
  return r;
}

export function pathOffset(s) {                  // 10:741D PathOffset: $D49B - $D499 * vy / vx (velocities / 16)
  const vy = rd16(s, 0x0B), vx = rd16(s, 0x09), ox = rd16(s, 0x99);
  const p = abs(ox) * sra16(abs(vy), 4);
  let q = div(...ahl(p), sra16(abs(vx), 4));
  if ((sgn(vx) + sgn(ox) + sgn(vy)) & 1) q = neg16(q);
  return (rd16(s, 0x9B) - q) & 0xFFFF;
}

export function pathNearest(s) {                 // 10:74A1 PathNearest: the path's closest point -> $D49D / $D49F
  const t = pathOffset(s);
  const ang = g.angleFromVector16(abs(rd16(s, 0x0B)), abs(rd16(s, 0x09)));
  let [hl, de] = g.mulSinCos(abs(t), ang);
  [hl, de] = g.mulSinCos(hl, (0x4000 - ang) & 0xFFFF);
  if (!(((s[0x0A] >> 7) + (s[0x0C] >> 7)) & 1)) hl = neg16(hl);
  if (t & 0x8000) { hl = neg16(hl); de = neg16(de); }
  wr16(s, 0x9D, hl); wr16(s, 0x9F, de);
}

export function pinContact(s) {                  // 10:750B PinContact: speed $D4A7, contact point $D4A1 / $D4A3
  const vx = rd16(s, 0x09), vy = rd16(s, 0x0B);
  wr16(s, 0xA7, dist(vx, vy));
  const [a, hl] = ahl(dist(rd16(s, 0x9D), rd16(s, 0x9F)) * 0x40);
  const d = s[0xB8] & 2 && !s[0xD5] ? 2 : 6;
  const q = div(a, hl, d << 8);
  const c = abs(g.mulSinCos(rd16(s, 0xA5), (q & 0xFF) << 8)[0]);
  for (const [v, oBase, oOut] of [[vx, 0x9D, 0xA1], [vy, 0x9F, 0xA3]]) {
    let r = div(...ahl(abs(v) * c), rd16(s, 0xA7));
    if (v & 0x8000) r = neg16(r);
    wr16(s, oOut, (r + rd16(s, oBase)) & 0xFFFF);
  }
}

function reflectLine(s) {                        // 10:76BA: vy - vx * $D4A3 / $D4A1
  const a3 = rd16(s, 0xA3), a1 = rd16(s, 0xA1), vx = rd16(s, 0x09);
  let q = div(...ahl(abs(vx) * abs(a3)), abs(a1));
  if ((sgn(a1) + sgn(vx) + sgn(a3)) & 1) q = neg16(q);
  return (rd16(s, 0x0B) - q) & 0xFFFF;
}

export function reflect(s) {                     // 10:771E Reflect: the velocity reflected -> $D4A9-$D4B0
  const r = reflectLine(s);
  const n1 = (~s[0xA2] >> 7) & 1;
  let b = n1 << 1 | s[0xA4] >> 7;
  if ((n1 + sgn(r)) & 1) b ^= 3;
  s[0xBA] = b;
  const ang = g.angleFromVector16(abs(rd16(s, 0xA3)), abs(rd16(s, 0xA1)));
  let [hl, de] = g.mulSinCos(abs(r), ang);
  [hl, de] = g.mulSinCos(hl, (0x4000 - ang) & 0xFFFF);
  if (b & 1) hl = neg16(hl);
  wr16(s, 0xA9, hl);
  if (b & 2) de = neg16(de);
  wr16(s, 0xAB, de);
  wr16(s, 0xAF, (de - rd16(s, 0x0B)) & 0xFFFF);
  wr16(s, 0xAD, (hl - rd16(s, 0x09)) & 0xFFFF);
}

export function cupWall(s) {                     // 10:7A63 CupWall: low in the cup, part of the speed into vz
  s[0xBA] = 0;
  const d = dist(rd16(s, 0xAD), rd16(s, 0xAF));
  wr16(s, 0xB3, d);
  const q0 = div(...ahl(abs(rd16(s, 0x06)) * 0x80), 0x400);
  const [hl, de] = g.mulSinCos(d, (q0 & 0xFF) << 8);
  wr16(s, 0x0D, (rd16(s, 0x0D) + ((de << 1) & 0xFFFF)) & 0xFFFF);
  let c = hl;
  s[0xBA] = (s[0xBA] << 1 | sgn(c)) & 0xFF;
  c = abs(c);
  const dv = rd16(s, 0xB3) || 1;
  const ad = rd16(s, 0xAD);
  s[0xBA] = (s[0xBA] << 1 | sgn(ad)) & 0xFF;
  let q = div(...ahl(abs(ad) * c), dv);
  if (!(((s[0xBA] & 1) + (s[0xBA] >> 1 & 1)) & 1)) q = neg16(q);
  wr16(s, 0xAD, q);
  const af = rd16(s, 0xAF);
  s[0xBA] = (s[0xBA] & 0xFE) | sgn(af);
  q = div(...ahl(abs(af) * c), dv);
  if (!(((s[0xBA] & 1) + (s[0xBA] >> 1 & 1)) & 1)) q = neg16(q);
  wr16(s, 0xAF, q);
}

export function cupDeflect(s) {                  // 10:760E CupDeflect: off the rim (and the wall when low)
  reflect(s);
  if ((abs(rd16(s, 0x06)) - 0x400) & 0x8000) cupWall(s);
  const vx = (rd16(s, 0xA9) + rd16(s, 0xAD)) & 0xFFFF;
  wr16(s, 0x09, vx);
  const vy = (rd16(s, 0xAB) + rd16(s, 0xAF)) & 0xFFFF;
  wr16(s, 0x0B, vy);
  return dist(vx, vy);
}

export function pinBounce(s, fx) {               // 10:765F PinBounce: velocity = half the reflected difference
  s[0x8E] |= 2;
  fx.push(["sound", 0x58]);
  reflect(s);
  for (const [oOut, oA, oB] of [[0x09, 0xAD, 0xA9], [0x0B, 0xAF, 0xAB]]) {
    const v = (rd16(s, oA) - rd16(s, oB)) & 0xFFFF;
    const t = sra16(abs(v), 1);
    wr16(s, oOut, v & 0x8000 ? neg16(t) : t);
  }
}

export function dist24(x, y) {                   // 10:62DA: the length of a 24-bit (8.8 + 8) vector
  if (x & 0x800000) x = (-x) & 0xFFFFFF;
  if (y & 0x800000) y = (-y) & 0xFFFFFF;
  const m = (y >> 16) | (x >> 16);
  let a = ((m << 1) | 1) & 0xFF, n = 0;
  if (!(m & 0x80)) {
    for (;;) {
      const c = a >> 7; a = (a << 1) & 0xFF;
      if (c) break;
      x = (x << 1) & 0xFFFFFF; y = (y << 1) & 0xFFFFFF; n++;
    }
  }
  const py = (y >> 8) * (y >> 8), px = (x >> 8) * (x >> 8);
  let hl = ((px >>> 16) + (py >>> 16)) & 0xFFFF;
  const lo = ((px >>> 8) & 0xFF) + ((py >>> 8) & 0xFF);
  if (lo > 0xFF) hl = (hl + 1) & 0xFFFF;
  const r = (g.isqrt24(hl, lo & 0xFF) << 4) & 0xFFFF;
  return r >> n;
}

export function pinDist(s) {                     // 10:62AD PinDist: |ball - cup| with the fractions
  return dist24((((rd16(s, 0x01) - rd16(s, 0x3D)) & 0xFFFF) << 8 | s[0x00]) & 0xFFFFFF,
                (((rd16(s, 0x04) - rd16(s, 0x3F)) & 0xFFFF) << 8 | s[0x03]) & 0xFFFFFF);
}

export function shotLength(s, start) {           // 10:6276: |start - ball| (start = $D5F8-$D5FD, from 02:4679)
  const p24 = (b, o) => b[o] | b[o + 1] << 8 | b[o + 2] << 16;
  return dist24((p24(start, 0) - p24(s, 0)) & 0xFFFFFF, (p24(start, 3) - p24(s, 3)) & 0xFFFFFF);
}

const pinFar = (s, hl) => ((hl - pinDist(s)) & 0x8000 ? 1 : 0);   // 10:735A: 1 when PinDist is above hl

export function pinCheck(s, fx) {                // 10:72E7 PinCheck
  if (s[0xD5] || s[0xB9] & 1 || s[0x08]) return;
  if (s[0x07] >= 0xE8) return;
  const high = s[0x07] >= 0xC0;
  if (pinFar(s, 2)) return;
  s[0xB9] |= 1;
  if (high) {                                    // hits the flagstick: drops
    s[0x8E] |= 4;
    fx.push(["sound", 0x59]);
    s[0xB9] |= 2;
    for (let o = 0x09; o < 0x0F; o++) s[o] = 0;
  } else {
    pathNearest(s);
    pinContact(s);
    pinBounce(s, fx);
  }
}

export function cupClose(s) {                    // the squared-offset distance of 10:6F61 and 10:72A9
  const dy = ((rd16(s, 0x04) - rd16(s, 0x3F)) & 0xFF) << 8;
  const dx = ((rd16(s, 0x01) - rd16(s, 0x3D)) & 0xFF) << 8;
  const t = g.mulHLByDEBothSigned(dx, dx) + g.mulHLByDEBothSigned(dy, dy);
  return g.isqrtHL(t & 0xFFFF);
}

export function flyIn(s) {                       // 10:7263 CupFlyIn: next height below 0 within 6 of the cup
  if (!s[0x15]) return 0;
  const vz = rd16(s, 0x0D);
  if (!(vz & 0x8000)) return 0;
  s[0xB3] = s[0x06]; s[0xB4] = s[0x07]; s[0xB5] = s[0x08];
  addVelToPos(s, 0xB3, (vz - 0x38) & 0xFFFF);
  if (!(s[0xB5] & 0x80)) return 0;
  if (cupClose(s) >= 6) return 0;
  s[0x15] = 0;
  return 1;
}

export function rollIn(s) {                      // 10:716B CupRollIn: $D4B1 = 1 when the ball drops
  s[0xBB] = s[0x99]; s[0xBC] = s[0x9A]; s[0xBD] = s[0x9B]; s[0xBE] = s[0x9C];
  wr16(s, 0x99, offset(s, 0x01, 0x00, 0x3D));
  wr16(s, 0x9B, offset(s, 0x04, 0x03, 0x3F));
  if (!s[0xD5] && cupOffsets(s) >> 8 < 2) { s[0xB1] = 1; return; }
  pathNearest(s);
  const dx = abs((rd16(s, 0x99) - rd16(s, 0x9D)) & 0xFFFF);
  const dy = abs((rd16(s, 0x9B) - rd16(s, 0x9F)) & 0xFFFF);
  const c = g.mulSinCos(0x40, g.angleFromVector16(dy, dx))[0];
  let v = dx << 8;
  v = (dx & 0x8000 ? v - 0x1000000 : v) >> 2;
  let q = div((v >> 16) & 0xFF, v & 0xFFFF, c);
  q = (q * 2) & 0xFFFF;
  const sp = dist(rd16(s, 0x09), rd16(s, 0x0B));
  s[0xB1] = (((sp * 3) & 0xFFFF) - q) & 0x8000 ? 1 : 0;
}

export function rimClamp(s) {                    // 10:78AD RimClamp: inside the cup, within 6 of its centre
  s[0xBB] = s[0x99]; s[0xBC] = s[0x9A]; s[0xBD] = s[0x9B]; s[0xBE] = s[0x9C];
  s[0xB8] = 0;
  const d = cupOffsets(s);
  if (d >> 8 < 2) s[0xB8] |= 2;
  if (d >> 8 < 6) return;
  s[0xB8] |= 1;
  for (const [oOff, oPos, oCup] of [[0x99, 0x00, 0x3D], [0x9B, 0x03, 0x3F]]) {
    const v = rd16(s, oOff);
    let q = div(...ahl(abs(v) * 0x600), d);
    if (v & 0x8000) q = neg16(q);
    wr16(s, oOff, q);
    s[oPos] = 0;
    s[oPos + 1] = s[oCup]; s[oPos + 2] = s[oCup + 1];
    addVelToPos(s, oPos, q);
  }
  wr16(s, 0xA5, dist(rd16(s, 0x99), rd16(s, 0x9B)));
}

export function cupSink(s) {                     // 10:7860 CupSink: vz -= $38; 1 at the bottom (height -$14)
  const vz = (rd16(s, 0x0D) - 0x38) & 0xFFFF;
  wr16(s, 0x0D, vz);
  if ((s[0x07] - 0xEC) & 0x80) return 1;
  addVelToPos(s, 0x06, vz);
  return 0;
}

// 10:79AF CupDrop: BallTask is off; one AdvanceFrame (frame(1)) per pass. 1 = the ball reached the bottom,
// 2 = it bounced out (back in the air).
export function* cupDrop(s, frame, fx) {
  s[0x15] = 0;
  s[0xB8] = 0;
  fx.push(["task", "off"]);
  let a;
  for (;;) {
    if (s[0xB8]) {
      if (!(s[0x08] & 0x80)) { s[0x44] = 0; s[0x15] = 1; a = 2; break; }
      pathNearest(s);
      pinContact(s);
      if (s[0xB8] & 2) { if (!s[0xD5] && !s[0xB9]) s[0xB9] = 1; }
      else if (s[0xB8] & 1) cupDeflect(s);
    }
    addVelToPos(s, 0x00, rd16(s, 0x09));
    addVelToPos(s, 0x03, rd16(s, 0x0B));
    rimClamp(s);
    a = cupSink(s);
    yield* frame(1);
    if (a) break;
  }
  fx.push(["task", "on"]);
  return a;
}

export function* holeOutPlace(s, frame) {         // 10:7888 HoleOutPlace: the ball on the cup, 30 frames
  for (let o = 0x09; o < 0x0D; o++) s[o] = 0;
  s[0x00] = 0; s[0x01] = s[0x3D]; s[0x02] = s[0x3E];
  s[0x03] = 0; s[0x04] = s[0x3F]; s[0x05] = s[0x40];
  yield* frame(30);
}
