// The ball step of BallTask 10:4D45 (tools/ball_sim.py): the air step, the bounce with water and bunkers,
// the landing test and the roll, on the ball state s = WRAM6 $D400-$D4FF (offsets from $D400):
//   00-02 x (8.16)  03-05 y  06-08 height  09 vx  0B vy  0D vz (8.8 signed)  0F curve  11 spin
//   13 speed (byte)  14 direction (byte)  15 in the air
// The maps come from a Hole: the course maps, or the green maps in views 1-3.
import { rb, rw, asset, holeRow } from "./rom.js";
import * as g from "./math.js";
import { rd16, wr16 } from "./memory.js";

const neg16 = g.neg16;
const windSpeed = mph => rw(0x10, 0x5315 + 2 * (mph & 0x1F));          // WindSpeedTable 10:5315
const terrainProps = t => [0, 1, 2, 3].map(k => rb(0x10, 0x6825 + 4 * t + k));   // TerrainPropTable 10:6825
const slopeDir = i => rb(0x10, 0x6516 + i);                              // SlopeDirTable 10:6516
const greenSlope = i => rw(0x10, 0x6738 + 2 * i);                        // 10:6738

// The maps the ball code reads for hole id hid (HoleAssetTable 13:4A16; HoleLoadMaps 13:4014; the putting
// view's maps 13:4077):
//   course: attributes (ref 1 entry 0, WRAM2 $D000), tilemap (ref 1 entry 1, WRAM3 $D000, 64 x 64), slope /
//   tree byte per tile (ref 1 entry 2, WRAM6 $D700), terrain (ref 0 entry 3, WRAM6 $D800, 8 bytes per tile),
//   slope nibbles (ref 0 entry 4, WRAM1 $D800)
//   green: ref 3 entries 1-3 and ref 2 entry 2 in place of the first four
export class Hole {
  constructor(hid) {
    const r = holeRow(hid);
    this.id = hid;
    this.attrs = asset(r[1], 0);
    this.tmap = asset(r[1], 1);
    this.slope = asset(r[1], 2);
    this.terrain = asset(r[0], 3);
    this.slopes = asset(r[0], 4);
    this.course = [this.attrs, this.tmap, this.slope, this.terrain];
    this.green = [asset(r[3], 1), asset(r[3], 2), asset(r[3], 3), asset(r[2], 2)];
  }
  use(green, w) { [this.attrs, this.tmap, this.slope, this.terrain] = green ? this.green : this.course; if (w) this.w = w; }
  // the map byte the ROM reads for cell (row, col): $D000 + row * 64 + col in WRAM2 (attributes) or WRAM3 (tilemap),
  // 16-bit and not masked (TerrainAt 10:6536, GreenSlopeAt 10:64D1, SlopeCellAt 10:674E). Off the map (a ball outside
  // the green while the green view's maps are in use: a frame as it rolls off) that is the echo RAM, the OAM / HRAM,
  // or ROM bank 0 past the $FFFF wrap
  mapByte(map, bank, row, col) {
    const a = (row * 64 + col + 0xD000) & 0xFFFF;
    if (a >= 0xD000 && a < 0xE000) return map[a - 0xD000];
    const w = this.w;
    if (!w) return map[(a - 0xD000) & 0xFFF];
    if (a < 0x4000) return rb(0, a);
    if (a < 0xF000) return w.wram[0][a - 0xE000];
    if (a < 0xFE00) return w.wram[bank][a - 0xF000];
    if (a < 0xFEA0) return w.oam[a - 0xFE00];
    if (a >= 0xFF80) return w.high[a - 0xFE00];
    throw new Error(`~10:6536: a hole map read at $${a.toString(16)}`);
  }
  // a byte of a per-tile table: the asset as loaded, then (a garbage tile number past its end) what follows it in
  // WRAM: the slope bytes WRAM6 $D700, the terrain nibbles WRAM6 $D800, the slope nibbles WRAM1 $D800
  tableByte(table, i) {
    if (i < table.length || !this.w) return table[i];
    const [bank, base] = table === this.slopes ? [1, 0x800] : table === this.slope ? [6, 0x700] : [6, 0x800];
    return this.w.wram[bank][base + i];
  }
  cell(table, hl, de) {
    const row = de >> 8, col = hl >> 8;
    let c = (hl & 0xFF) >> 6, e = (de & 0xFF) >> 6;
    const a = this.mapByte(this.attrs, 2, row, col);
    if (a & 0x20) c = 3 - c;
    if (a & 0x40) e = 3 - e;
    const b = this.tableByte(table, this.mapByte(this.tmap, 3, row, col) * 8 + e * 2 + (c >> 1));
    return [c & 1 ? b & 0x0F : b >> 4, a];
  }
  slopeCell(hl, de) {                 // 10:674E SlopeCellAt (off the green): [nonzero, direction byte]
    const [n, a] = this.cell(this.slopes, hl, de);
    if (!(n & 8)) return [0, 0];
    const flip = (((a >> 2) | (a << 6)) & 0xFF) & 0x18;
    return [0xFF, slopeDir((n & 7) + flip)];
  }
  terrainAt(hl, de) { return this.cell(this.terrain, hl, de)[0]; }   // 10:6536 TerrainAt: x, y integer parts
  slopeAt(hl, de) {                   // 10:64D1 GreenSlopeAt: [slope byte, direction byte]
    const row = de >> 8, col = hl >> 8, at = this.mapByte(this.attrs, 2, row, col);
    const flip = (((at >> 2) | (at << 6)) & 0xFF) & 0x18;
    const v = this.tableByte(this.slope, this.mapByte(this.tmap, 3, row, col));
    return [v, slopeDir((v & 7) + flip)];
  }
}

export function addVelToPos(s, o, de) {          // 10:52DA: 24-bit position += sign-extended 8.8 velocity
  let v = s[o] | s[o + 1] << 8 | s[o + 2] << 16;
  v = (v + g.s16(de & 0xFFFF)) & 0xFFFFFF;
  s[o] = v & 0xFF; s[o + 1] = (v >> 8) & 0xFF; s[o + 2] = v >> 16;
}

export function speedAndDir(s) {                 // 10:4CDE BallSpeedAndDir
  const vx = rd16(s, 0x09), vy = rd16(s, 0x0B);
  s[0x14] = g.angleFromVector16(vy, vx) >> 8;    // measured from the +x axis toward +y
  const xx = g.mulHLByDEBothSigned(vx, vx), yy = g.mulHLByDEBothSigned(vy, vy);
  s[0x13] = g.isqrtHL((xx + yy) & 0xFFFF);
}

export function wind(s, mph, wdir) {             // 10:52EE: [speed, direction << 8]; none on the ground
  if (!(s[0x06] | s[0x07] | s[0x08])) return [0, 0];
  return [windSpeed(mph), wdir << 8];
}

export function toward256(target, v) {           // 10:5268: (target - v) / 256 rounded toward zero
  let hl = (target - v) & 0xFFFF;
  if (hl & 0x8000) {
    hl = (hl + 0xFF) & 0xFFFF;
    return hl >> 8 ? 0xFF00 | (hl >> 8) : 0;
  }
  return hl >> 8;
}

export function spinDecay(spin) {                // 10:4F5A-4F81: spin += -spin/128, rounded away from zero
  const n = (-spin) & 0xFFFF;
  const sign = n & 0x8000 ? 0xFF : 0;
  const v = ((sign << 16) | n) * 2;
  let bc = (v >> 8) & 0xFFFF;
  if ((v & 0xFF) && !sign) bc = (bc + 1) & 0xFFFF;   // 10:4F73
  return (spin + bc) & 0xFFFF;
}

export function flightStep(s, mph, wdir) {       // 10:4EE0 BallFlightStep up to the bounce branch
  speedAndDir(s);
  let hl = g.mulHLByAFracSigned(rd16(s, 0x0F), s[0x13]);
  hl = g.mulHLByAFracSigned(hl, 0x1C);
  const [cos, sin] = g.mulSinCosSigned(hl, ((s[0x14] + 0x40) & 0xFF) << 8);
  wr16(s, 0x0B, rd16(s, 0x0B) + sin);
  wr16(s, 0x09, rd16(s, 0x09) + cos);
  let [ws, wb] = wind(s, mph, wdir);
  const b = ((s[0x14] - (wb >> 8)) + 0x80) & 0xFF;
  hl = g.mulSinCos(ws, b << 8)[0];
  const air = (hl + (s[0x13] << 8)) & 0xFFFF;
  hl = g.mulHLByDEBothSigned(rd16(s, 0x11), air);
  hl = g.mulHLByAFracSigned(hl, 0x1C);
  wr16(s, 0x0D, (hl + rd16(s, 0x0D) - 0x20) & 0xFFFF);
  wr16(s, 0x11, spinDecay(rd16(s, 0x11)));
  [ws, wb] = wind(s, mph, wdir);
  const [wc, wsn] = g.mulSinCos(ws, wb);
  let vx = rd16(s, 0x09);
  vx = (vx + toward256(wc, vx)) & 0xFFFF;
  wr16(s, 0x09, vx); addVelToPos(s, 0x00, vx);
  let vy = rd16(s, 0x0B);
  vy = (vy + toward256(wsn, vy)) & 0xFFFF;
  wr16(s, 0x0B, vy); addVelToPos(s, 0x03, vy);
  let vz = rd16(s, 0x0D);
  vz = (vz - toward256(vz, 0)) & 0xFFFF;
  wr16(s, 0x0D, vz); addVelToPos(s, 0x06, vz);
  return (s[0x08] & 0x80) !== 0;                 // below the ground: the bounce
}

export function landCheck(s, fx) {               // 10:4D09 BallLandCheck (fx: its sound)
  if (rd16(s, 0x07)) return;
  const vz = g.abs16(rd16(s, 0x0D));
  if (vz >> 8 || (vz & 0xFF) >= 0x20) return;
  s[0x15] = 0;
  s[0x06] = s[0x07] = s[0x08] = 0;
  s[0x0D] = s[0x0E] = 0;
  if (s[0x89] && fx) fx.push(["sound", 0x40]);   // 10:4D42: landed without a bounce
  s[0x89] = 0;
}

export const ballXY = s => [rd16(s, 0x01), rd16(s, 0x04)];

export function greenXY(s) {                     // 10:66F1 / 10:67FA: relative to the green corner ($D441/$D442), x4
  let [x, y] = ballXY(s);
  x = ((((((x >> 8) - s[0x41]) & 0xFF) << 8) | (x & 0xFF)) << 2) & 0xFFFF;
  y = ((((((y >> 8) - s[0x42]) & 0xFF) << 8) | (y & 0xFF)) << 2) & 0xFFFF;
  return [x, y];
}

export function slope(s, hole) {                 // 10:66DB (and 10:6740 after its table): [magnitude, direction byte, nonzero]
  if (!s[0x43] || s[0x43] === 4) {               // off the green: 10:674E
    const [nz, b] = hole.slopeCell(...ballXY(s));
    return nz ? [0x20, b, nz] : [0, 0, 0];
  }
  const [x, y] = greenXY(s);                     // on the green: 10:66F1, GreenSlopeAt 10:64D1
  const [v, b] = hole.slopeAt(x, y);
  const strength = (v >> 4) & 3;
  if (!strength) return [0, 0, 0];
  if (hole.terrainAt(x, y) === 6) return [greenSlope(strength), b, 0xFF];
  return [0x20, b, 0xFF];
}

export function terrainPropsAt(s, hole) {        // 10:67E4: [type, props]
  const xy = s[0x43] && s[0x43] < 4 ? greenXY(s) : ballXY(s);
  const t = hole.terrainAt(...xy);
  return [t, terrainProps(t)];
}

export function ballStop(s) {                    // 10:521C BallStop (the caller sets $D331 = 1)
  for (let o = 0x09; o < 0x0F; o++) s[o] = 0;
  s[0x06] = s[0x07] = s[0x08] = 0;
  s[0xCF] = s[0x01]; s[0xD0] = s[0x02]; s[0xD1] = s[0x04]; s[0xD2] = s[0x05];
  s[0xD3] = 0xC8;
}

const landingAngle = s => g.angleFromVector16(s[0x13] << 8, neg16(rd16(s, 0x0D))) >> 8;   // small = steep

// 10:4FF2-5212: the ball went below the ground in the air step. Returns "bounce", "water" (stopped in it) or
// "plugged". fx collects what the ROM does outside $D400-$D4FF: ["splash", x, y] (12:6A9C / 12:6A7F), ["bunker",
// depth] (PlayerField $15 bit 0 and, with a depth, PlayerField $3F), and the sounds ["sound", id].
export function bounce(s, hole, fx = []) {
  if (s[0x89]) {                                 // the first landing: remember where ($D48A-$D48D)
    s[0x89] = 0;
    s[0x8A] = s[0x01]; s[0x8B] = s[0x02]; s[0x8C] = s[0x04]; s[0x8D] = s[0x05];
  }
  const [t, props] = terrainPropsAt(s, hole);
  s[0x48] = props[0]; s[0x49] = props[2];
  fx.push(["sound", 0x49]);                     // 10:501F
  if (t === 3) {                                 // 10:5021 water: a fast, flat ball skips
    fx.push(["sound", 0x51]);                   // 10:5025
    fx.push(["splash", rd16(s, 0x01), rd16(s, 0x04)]);   // 12:6A9C WaterSplashAt, 12:6A7F WaterSplashGfx
    if (s[0x13] >= 5 && landingAngle(s) >= 0x28) s[0x8E] |= 1;
    else { s[0x8E] &= 0xFE; ballStop(s); return "water"; }
  } else if (t === 2 || t === 0x0D) {            // 10:5068 bunker: a steep landing plugs
    const b = landingAngle(s);
    if (b < 0x14) {
      const depth = b >= 0x0E ? 1 : 2;
      s[0x46] = depth;
      fx.push(["bunker", depth]);
      fx.push(["sound", 0x4B]);                 // 10:50A0
      ballStop(s);
      return "plugged";
    }
    fx.push(["bunker", 0]);
  }
  const h = g.mulHLByAFracSigned(rd16(s, 0x06), s[0x48]);
  wr16(s, 0x06, neg16(h));
  s[0x08] = 0;
  wr16(s, 0x0D, neg16(g.mulHLByAFracSigned(rd16(s, 0x0D), s[0x48])));
  speedAndDir(s);
  if (!s[0x43]) {
    const [, b, nz] = slope(s, hole);
    if (nz) {
      s[0x4A] = b & 0xF0;
      const [shl, sde] = g.vectorFromLengthAndAngleRaw(0xFFE0, s[0x4A]);
      const vz = rd16(s, 0x0D);
      wr16(s, 0x0D, g.mulHLByAFracSigned(vz, 0x80));
      const hl = g.mulHLByAFracSigned(vz, 0xDD);
      const [chl, cde] = g.mulSinCos(hl, s[0x4A] << 8);
      wr16(s, 0x09, rd16(s, 0x09) + chl + shl);
      wr16(s, 0x0B, rd16(s, 0x0B) + cde + sde);
    }
  }
  const vx = rd16(s, 0x09), vy = rd16(s, 0x0B);
  let hl = g.mulHLByAFracSigned(rd16(s, 0x0F), s[0x13]);
  hl = g.mulHLByAFracSigned(hl, 0x40);
  const [cHL, cDE] = g.mulSinCosSigned(hl, ((s[0x14] + 0x40) & 0xFF) << 8);
  hl = g.mulHLByAFrac(rd16(s, 0x11), 0x40);
  const [sHL, sDE] = g.mulSinCos(hl, ((s[0x14] + 0x80) & 0xFF) << 8);
  wr16(s, 0x09, g.mulHLByAFracSigned((sHL + cHL + vx) & 0xFFFF, s[0x49]));
  wr16(s, 0x0B, g.mulHLByAFracSigned((sDE + cDE + vy) & 0xFFFF, s[0x49]));
  wr16(s, 0x11, g.mulHLByAFracSigned(rd16(s, 0x11), s[0x48]));
  wr16(s, 0x0F, g.mulHLByAFracSigned(rd16(s, 0x0F), s[0x48]));
  return "bounce";
}

export function greenScale(s, hl, de) {          // 10:4E98: on the green the slope push scales with the speed
  const vx = rd16(s, 0x09), vy = rd16(s, 0x0B);
  const ay = g.abs16(vy);
  if (ay >> 8) return [hl, de];
  const ax = g.abs16(vx);
  if (ax >> 8) return [hl, de];
  const b = g.isqrtHL((g.mulHLByA(ax, ax & 0xFF) + g.mulHLByA(ay, ay & 0xFF)) & 0xFFFF);
  return [g.mulHLByAFracSigned(hl, b), g.mulHLByAFracSigned(de, b)];
}

export function rollStep(s, hole, fx) {          // 10:4D86 BallRollStep (fx as in bounce)
  speedAndDir(s);
  let hl = g.mulHLByAFracSigned(rd16(s, 0x0F), s[0x13]);
  hl = g.mulHLByAFracSigned(hl, 0x40);
  const [cHL, cDE] = g.mulSinCosSigned(hl, ((s[0x14] + 0x40) & 0xFF) << 8);
  wr16(s, 0x0B, rd16(s, 0x0B) + cDE);
  wr16(s, 0x09, rd16(s, 0x09) + cHL);
  wr16(s, 0x0F, g.mulHLByAFracSigned(rd16(s, 0x0F), 0xFC));
  hl = g.mulHLByAFrac(rd16(s, 0x11), s[0x13]);
  hl = g.mulHLByAFracSigned(hl, 0x40);
  const [sHL, sDE] = g.mulSinCos(hl, s[0x14] << 8);
  wr16(s, 0x0B, rd16(s, 0x0B) + sDE);
  wr16(s, 0x09, rd16(s, 0x09) + sHL);
  wr16(s, 0x11, g.mulHLByAFracSigned(rd16(s, 0x11), 0xFC));
  const [mag, b, nz] = slope(s, hole);
  let [pHL, pDE] = nz ? g.mulSinCos(mag, b << 8) : [0, 0];
  const [t, props] = terrainPropsAt(s, hole);
  if (t === 3) {                                 // 10:4E3F rolled into the water: splash and stop
    if (fx) fx.push(["sound", 0x51], ["splash", rd16(s, 0x01), rd16(s, 0x04)]);   // 10:4E43, 10:4E51
    ballStop(s);
    return "water";
  }
  if (t === 6) [pHL, pDE] = greenScale(s, pHL, pDE);
  const vx = g.mulHLByAFracSigned((pHL + rd16(s, 0x09)) & 0xFFFF, props[1]);
  wr16(s, 0x09, vx); addVelToPos(s, 0x00, vx);
  const vy = g.mulHLByAFracSigned((pDE + rd16(s, 0x0B)) & 0xFFFF, props[1]);
  wr16(s, 0x0B, vy); addVelToPos(s, 0x03, vy);
  return "roll";
}

export function dist(hl, de) {                   // 10:7372: about sqrt(hl^2 + de^2) in steps of 16 (saturating)
  const sq = v => { const p = g.abs16(v) * g.abs16(v); return p >= 0x1000000 ? 0xFFFF : (p >>> 8) & 0xFFFF; };
  const t = sq(hl) + sq(de);
  if (t > 0xFFFF) return 0x0FFF;
  return (g.isqrtHL(t) << 4) & 0xFFFF;
}

export function cupPull(s) {                     // 10:7CAB CupPull: near the cup, pull the ball toward it
  if (s[0xB9] & 2) return 0;
  if (dist(rd16(s, 0x09), rd16(s, 0x0B)) >> 8 >= 3) return 0;
  const cx = rd16(s, 0x3D), cy = rd16(s, 0x3F);
  if (dist((rd16(s, 0x01) - cx) & 0xFFFF, (rd16(s, 0x04) - cy) & 0xFFFF)) return 0;
  const ax = g.abs16((rd16(s, 0x00) - ((cx & 0xFF) << 8)) & 0xFFFF);
  wr16(s, 0xB3, ax);
  if (!((ax - 0x0B00) & 0x8000)) return 0;
  const ay = g.abs16((rd16(s, 0x03) - ((cy & 0xFF) << 8)) & 0xFFFF);
  if (!((ay - 0x0D00) & 0x8000)) return 0;
  let k = g.abs16((dist(ax, ay) - 0x1000) & 0xFFFF);
  k = g.s16(k) >> 2;
  s[0xA5] = (k >> 8) & 0xFF; s[0xA6] = 0;
  const rel = (c, o) => {                        // (cup << 8) - position, with the ROM's sign handling
    let de = g.abs16(c);
    de = (de & 0xFF) << 8;
    if (c & 0x8000) de = neg16(de);
    return (de - rd16(s, o)) & 0xFFFF;
  };
  const dx = rel(cx, 0x00), dy = rel(cy, 0x03);
  wr16(s, 0x99, dx); wr16(s, 0x9B, dy);
  const r = dist(dx, dy);
  for (const [d, o] of [[dx, 0x09], [dy, 0x0B]]) {
    const p = ((rd16(s, 0xA5) + 4) & 0xFFFF) * g.abs16(d);
    let [a, hl] = p >= 0x1000000 ? [0xFF, 0xFFFF] : [(p >>> 16) & 0xFF, p & 0xFFFF];
    let q;
    [a, q] = g.divAHLByDE(a, hl, r);
    if (a) q = 0x3FFF;
    if (d & 0x8000) q = neg16(q);
    wr16(s, o, rd16(s, o) + q);
  }
  return 1;
}
