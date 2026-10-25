// The swing's frame tasks and helpers (tools/swing_py.py): what runs between the golfer addressing the ball
// (AddressBall 10:56B0) and ShotLaunch. The main-thread parts are in shot.js (Shot.address / swing /
// afterSwing). Frame tasks, in their slot order (RunFrameTasks 00:247D, each AdvanceFrame after VBlank read the
// joypad):
//   11:6E3E  the golfer's swing animation: (sprite frame, duration) pairs; $FE marks the club meeting the
//            ball ($D464 = 1), $FF ends it
//   11:4113  the ball display (sprites not modelled) and, with $D485 bit 4 in views 0, 1, 4-6, the landing
//            preview (11:4E5E): a ghost ball flown from the shot's perfect-swing launch
//   10:55AC  during the swing: the d-pad held -> impact side and height ($D44B / $D44C, table 10:55CE)
import { rb, rw } from "./rom.js";
import * as g from "./math.js";
import * as B from "./ball.js";
import * as L from "./launch.js";
import { rd16, wr16, playerField } from "./memory.js";

const treeAngle = e => rb(0x08, 0x5326 + e);    // 08:5326: angle to the trunk by the ball's spot in the tile
const treeDist = e => rb(0x08, 0x5426 + e);     // 08:5426: distance to the trunk
export { treeAngle, treeDist };

// -- 11:6D8F / 11:6E3E: the swing animation --
export function animStart(w, kind) {             // 11:6D8F: 0 address pose, 1 backswing, 2 downswing, 3 back
  const r6 = w.wram[6];
  const c = rb(0x11, 0x6DEE + r6[0x329]);        // per club
  const a = (rb(0x11, 0x6DFE + (kind & 3) * 2 + (r6[0x32A] === 2 ? 1 : 0)) + c) & 0xFF;
  const t = rw(0x11, 0x6ECD + r6[0x332] * 2);    // per golfer sprite set
  wr16(r6, 0x462, rw(0x11, (t + ((a * 2) & 0xFF)) & 0xFFFF));
  r6[0x464] = r6[0x467] = 0;
  r6[0x466] = 1;
  r6[0x465] = 0xFF;
}

export function animTask(w) {                    // 11:6E3E
  const r6 = w.wram[6];
  r6[0x466] = (r6[0x466] - 1) & 0xFF;
  if (r6[0x466]) return;
  for (;;) {
    r6[0x465] = (r6[0x465] + 1) & 0xFF;
    const p = (rd16(r6, 0x462) + 2 * r6[0x465]) & 0xFFFF;
    const a = rb(0x11, p);
    if (a === 0xFE) { r6[0x464] = 1; continue; }  // contact
    if (a === 0xFF) {                             // end: hold the last frame
      r6[0x464] = 1;
      r6[0x466] = 0xFF;
      r6[0x465] = (r6[0x465] - 1) & 0xFF;
      return;
    }
    r6[0x467] = a;
    r6[0x466] = rb(0x11, p + 1);
    return;
  }
}

// -- 11:4E5E: the landing preview --
export function previewRestart(w) {              // 10:543C PreviewRestart: a perfect full swing, current aim
  const r6 = w.wram[6];
  r6.copyWithin(0x373, 0x514, 0x51A);            // 10:5518: from the ball's address spot
  r6.fill(0, 0x379, 0x382);
  r6[0x51A] = r6[0x418]; r6[0x51B] = r6[0x419];
  L.clubParams(w);
  wr16(r6, 0x418, (rd16(r6, 0x418) + rd16(r6, 0x41C)) & 0xFFFF);
  const power = r6[0x450], cursor = r6[0x44F];
  r6[0x450] = 0x3C; r6[0x44F] = 0;
  const hl = L.shotSpeed(w);
  r6[0x48E] = 0;
  r6[0x44F] = cursor; r6[0x450] = power;
  wr16(r6, 0x416, L.scaleSpeed(rd16(r6, 0x416), hl));
  let side = (-r6[0x44B]) & 0xFF;
  if (side & 0x80) side |= 0xFF00;
  wr16(r6, 0x40F, (rd16(r6, 0x40F) + ((side << 5) & 0xFFFF)) & 0xFFFF);
  let [h2, de] = g.mulSinCos(rd16(r6, 0x416), rd16(r6, 0x41A));
  wr16(r6, 0x380, de);
  [h2, de] = g.mulSinCos(h2, rd16(r6, 0x418));
  wr16(r6, 0x37C, h2);
  wr16(r6, 0x37E, de);
  r6[0x418] = r6[0x51A]; r6[0x419] = r6[0x51B];
}

// 10:5355 PreviewStep: BallFlightStep's rules on the ghost ball ($D373-$D381), with the real ball's speed,
// direction, curve and spin (and its height for the wind)
export function previewStep(w) {
  const r6 = w.wram[6];
  const s = r6.subarray(0x400, 0x500);
  B.speedAndDir(s);
  const mph = w.wram[0][0x815], wdir = w.wram[0][0x816];
  let hl = g.mulHLByAFracSigned(rd16(s, 0x0F), s[0x13]);
  hl = g.mulHLByAFracSigned(hl, 0x1C);
  const [c, sn] = g.mulSinCosSigned(hl, ((s[0x14] + 0x40) & 0xFF) << 8);
  wr16(r6, 0x37E, (rd16(r6, 0x37E) + sn) & 0xFFFF);
  wr16(r6, 0x37C, (rd16(r6, 0x37C) + c) & 0xFFFF);
  let [ws, wb] = B.wind(s, mph, wdir);
  hl = g.mulSinCos(ws, (((s[0x14] - (wb >> 8)) + 0x80) & 0xFF) << 8)[0];
  const air = (hl + (s[0x13] << 8)) & 0xFFFF;
  hl = g.mulHLByAFracSigned(g.mulHLByDEBothSigned(rd16(s, 0x11), air), 0x1C);
  wr16(r6, 0x380, (hl + rd16(r6, 0x380) - 0x20) & 0xFFFF);
  [ws, wb] = B.wind(s, mph, wdir);
  const [wc, wsn] = g.mulSinCos(ws, wb);
  for (const [oV, oP, target] of [[0x37C, 0x373, wc], [0x37E, 0x376, wsn]]) {
    let v = rd16(r6, oV);
    v = (v + B.toward256(target, v)) & 0xFFFF;
    wr16(r6, oV, v);
    B.addVelToPos(r6, oP, v);
  }
  let v = rd16(r6, 0x380);
  v = (v - B.toward256(v, 0)) & 0xFFFF;
  wr16(r6, 0x380, v);
  B.addVelToPos(r6, 0x379, v);
}

export function previewTree(w, hole) {           // 08:5109: does the ghost ball hit a tree? (not in view 1)
  const r6 = w.wram[6];
  if (r6[0x443] === 1) return 0;
  if (r6[0x519] === r6[0x378] && r6[0x516] === r6[0x375]) return 0;
  hole.use(r6[0x443] >= 1 && r6[0x443] <= 3);
  if (!(hole.slope[hole.tmap[(r6[0x378] & 0x3F) << 6 | (r6[0x375] & 0x3F)]] & 0x80)) return 0;
  const a = (((r6[0x37A] | r6[0x37B] << 8) << 3) & 0xFFFF) >> 8;
  if (a >= 0x18) return 0;
  const c = r6[0x4F3 + (a & 0x1F)];
  if (!c) return 0;
  const e = (r6[0x377] & 0xF0) | (r6[0x374] >> 4);
  const b = g.angleFromVector16(rd16(r6, 0x37E), rd16(r6, 0x37C)) >> 8;
  const de = g.vectorFromLengthAndAngleRaw(treeDist(e), (treeAngle(e) - b) & 0xFF)[1];
  return (g.abs16(de) & 0xFF) < (c & 0xFE) ? 1 : 0;
}

export function previewFrame(w, hole, fx) {      // 11:4E5E, once per frame while the preview is on
  const r6 = w.wram[6];
  if (!(r6[0x480] & 0x1F)) previewRestart(w);    // every 32 frames: start again
  else if (r6[0x382]) r6[0x382] = 0;
  if (!r6[0x513]) previewStep(w);
  const a = previewTree(w, hole);
  const old = r6[0x513];
  r6[0x513] = a;
  if (a && !old) fx.push(["sound", 0x56]);      // the ghost ball hits a tree
  r6[0x480] = (r6[0x480] + 1) & 0xFF;
}

export function previewOn(w) {                   // 11:4113's views 0, 1 and 4-6 call 11:4E5E with $D485 bit 4
  const r6 = w.wram[6];
  return (r6[0x485] & 0x10) !== 0 && [0, 1, 4, 5, 6].includes(r6[0x443] & 7);
}

export function meterTask(w) {                   // 10:55AC: the d-pad held during the swing
  const r6 = w.wram[6], held = w.high[0x190];
  r6[0x44D] = held;
  const i = (((held >> 3) | (held << 5)) & 0xFF) & 0x1E;
  r6[0x44B] = rb(0x10, 0x55CE + i); r6[0x44C] = rb(0x10, 0x55CF + i);
}

// -- main-thread helpers --
export function meterReset(w) {                  // 10:55FF
  const r6 = w.wram[6];
  r6[0x44E] = r6[0x44F] = r6[0x451] = r6[0x452] = 0;
  r6[0x450] = 0x80;
  r6[0x44D] = 0xF0;
}

export function missTable(w) {                   // 10:6907: $D321 by club, lie class and $D4C9
  const r6 = w.wram[6];
  const e = ((L.lieClass(w) & 0x0F) << 4) | r6[0x329];
  const base = r6[0x32A] >= 2 ? 0x6A43 : 0x6983;
  const l = rb(0x10, base + e);
  const v = ((((r6[0x4C9] + 4) & 0xFF) * 8) + l) & 0xFF;
  return (rb(0x10, 0x693B + v) - 1) & 0xFF;
}

export function marker(w) {                      // 10:56EF / 10:5EE2: the target marker at the club's distance
  const r6 = w.wram[6];
  const [hl, de] = g.mulSinCos(L.baseDistance(w), rd16(r6, 0x418));
  wr16(r6, 0x426, (rd16(r6, 0x401) + hl) & 0xFFFF);
  wr16(r6, 0x428, (rd16(r6, 0x404) + de) & 0xFFFF);
}

export function shotRecord(w) {                  // 02:46B0 ShotRecord: 13 bytes -> $D5F8, and for the first four
  const r6 = w.wram[6], w0 = w.wram[0];          // strokes of a human player -> $D680 (+$40 player 2) + stroke x 16
  const rec = [...r6.subarray(0x400, 0x406), r6[0x418], r6[0x419], r6[0x329], r6[0x32A], r6[0x450], r6[0x44F], r6[0x44D]];
  r6.set(rec, 0x5F8);
  if (w0[0x878] || w0[playerField(w, 0x13)] || w0[playerField(w, 0x20)] >= 4) return;
  const base = 0x680 + (w0[0x835] ? 0x40 : 0) + ((w0[playerField(w, 0x20)] & 3) << 4);
  r6.set(rec, base);
}

// 11:4795 BallView4 (11:47A2-489A): project the ball for the view behind the golfer; $D331 = 1 once it leaves
// the picture (behind the camera, off the sides, off the top or bottom)
export function ballViewCut(w) {
  const r6 = w.wram[6];
  const ang = rd16(r6, 0x45A);
  const dy = (rd16(r6, 0x404) - rd16(r6, 0x458)) & 0xFFFF;
  const dx = (rd16(r6, 0x401) - rd16(r6, 0x456)) & 0xFFFF;
  const [xc, xs] = g.mulSinCosSigned(dx, ang);
  wr16(r6, 0x45C, xc);
  wr16(r6, 0x45E, xs);
  const [yc, ys] = g.mulSinCosSigned(dy, (ang + 0x4000) & 0xFFFF);
  const x = (yc + xc) & 0xFFFF;
  const z = (rd16(r6, 0x45E) + ys) & 0xFFFF;
  w.high[0x1B6] = z >> 8;
  const nz = g.neg16(z);
  if (nz & 0x8000) { r6[0x331] = 1; return; }
  if (!(nz >> 8) && (nz & 0xFF) < 8) return;     // right at the camera: drawn at a fixed spot
  const scale = g.divHLByDE(0x5000, ((nz + 0x280) & 0xFFFF) >> 3) & 0xFF;
  const sx = ((g.mulHLByAFracSigned(x, scale) + 1) & 0xFFFF) >> 1;
  const c = ((sx & 0xFF) + 0x50) & 0xFF;
  if (c >= 0xA0) { r6[0x331] = 1; return; }
  const h = (0x80 - (r6[0x407] | r6[0x408] << 8)) & 0xFFFF;
  let sy = (g.mulHLByAFracSigned(h, scale) + 1) & 0xFFFF;
  sy = ((sy >> 1) | (sy & 0x8000)) & 0xFFFF;
  sy = (sy + 0x3C) & 0xFFFF;
  if (sy & 0x80) r6[0x331] = 1;
}
