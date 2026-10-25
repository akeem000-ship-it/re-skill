// Bank 11: the sprites of the ball display task (BallDisplayTask 11:4113) by view: the course view (11:4361) and
// the green view (11:4970) draw the objects DrawSortedBallObjects (11:4D79) picks, from the lowest on screen up
// (1 pin, 2 target marker, 3 ball, 4 aim arrow, 5 preview spot, 6 other ball), plus the look cursor; the cup
// close-up (11:4CBB); the ball behind the golfer (11:4795) and its landing preview (11:48AB).
// Map positions are 8.8 tiles; the course view takes them relative to the scroll ($C320 / $C322, the low byte
// rounded down to 1/8 tile), the green view relative to the green's corner ($D441 / $D442) at 4x.
import * as D from "./display.js";
import { rd, queueSprite, queueSprite16 } from "./display.js";
import { testGameFlag } from "./actors.js";
import { blinkTargetMarker } from "./hud.js";
import * as g from "../math.js";

const W16 = (r, a) => r[a] | r[a + 1] << 8;
const shl3 = v => ((v << 3) >> 8) & 0xFF;            // sla l / rla x3: the screen pixel of an 8.8 tile offset
const shr3 = v => (v >> 3) & 0xFF;                   // srl h / rra x3 (green view)

function scroll(w, o) { const w0 = w.wram[0]; return (w0[o + 1] << 8 | w0[o]) & 0xFFE0; }
const sub = (hl, de) => (hl - de) & 0xFFFF;          // 11:4961 SubDEFromHLNonZero (the same as hl - de)

// course view: y offset (h below $10) and x offset ((h + 1) below lim), or null
function cy(w, v, add = 0) { const hl = (sub(v, scroll(w, 0x322)) + add) & 0xFFFF; return hl >> 8 >= 0x10 ? null : hl; }
function cx(w, v, add = 0, lim = 0x16) { const hl = (sub(v, scroll(w, 0x320)) + add) & 0xFFFF; return (((hl >> 8) + 1) & 0xFF) >= lim ? null : hl; }

function underTree(w, yHi, yLo, xLo, c) {        // the ball's tile has the tree bit (WRAM6 $D700 by tile) -> c, else 0
  const ty = (yHi & 0x80) ? (yLo + 1) & 0x3F : yLo & 0x3F;
  const tile = w.wram[3][(ty << 6) + (xLo & 0x3F)];
  return w.wram[6][0x700 + tile] & 0x80 ? c : 0;
}
function canopy(a) { return a & 0x80 ? ((a >> 4) & 7) + 8 : (a >> 4) & 7; }   // swap a / and 7 (+8 below 0)

function ballTile(r) {                           // $78 + 2 x the height step (0-3) while the ball is above ground
  const h = r[0x408];
  return h & 0x80 ? 0x78 : 0x78 + 2 * Math.min(h, 3);
}

// ---- the course view (11:4385 - 11:4767) ----
function courseBall(w) {                         // 11:4385 CourseViewDrawBall
  const r = w.wram[6];
  let c = 0;
  if (w.high[0x18C] & 2) c = underTree(w, r[0x404], r[0x405], r[0x402], canopy(r[0x404]));
  const x = cx(w, W16(r, 0x401), 0, 0x15);
  if (x === null) return;
  const b = shl3(x);
  const hgt = W16(r, 0x407);
  if (((hgt << 16 >> 16) >> 4 & 0xFF) >= c) {
    let hl = sub(W16(r, 0x404), scroll(w, 0x322)) & 0xFFE0;
    hl = sub(hl, ((hgt & 0xFFE0) << 16 >> 16 >> 1) & 0xFFFF);
    if (hl >> 8 < 0x10) queueSprite(w, shl3(hl), b, ballTile(r), 0x08);
  }
  if (!hgt) return;
  if (c) return;
  const y = cy(w, W16(r, 0x404));
  if (y !== null) queueSprite(w, shl3(y), b, 0x4E, 0x08);   // the shadow
}

function courseOtherBall(w) {                    // 11:44A1 CourseViewDrawOtherBall
  const r = w.wram[6];
  if (!(w.high[0x18C] & 2) && underTree(w, r[0x420], r[0x421], r[0x41F], 1)) return;
  const x = cx(w, W16(r, 0x41E), 0, 0x14);
  if (x === null) return;
  const y = cy(w, W16(r, 0x420));
  if (y !== null) queueSprite(w, shl3(y), shl3(x), 0x78, 0x08);
}

function courseTargetMarker(w) {                 // 11:453B CourseViewDrawTargetMarker
  const r = w.wram[6];
  if (!W16(r, 0x428)) return;
  const y = cy(w, W16(r, 0x428));
  if (y === null) return;
  const x = cx(w, W16(r, 0x426), 0x20);
  if (x === null) return;
  queueSprite(w, shl3((y + 0xFEA0) & 0xFFFF), shl3(x), 0x3A, 0x08);
  D.inBank(w, 0x12, () => blinkTargetMarker(w));   // 12:502C
}

function coursePin(w) {                          // 11:4599 CourseViewDrawPin
  const r = w.wram[6];
  if (!W16(r, 0x43F)) return;
  const y = cy(w, W16(r, 0x43F));
  if (y === null) return;
  if (r[0x4D5]) {                                // wNoPin: the hole only
    const x = cx(w, W16(r, 0x43D));
    if (x !== null) queueSprite(w, shl3(y), shl3(x), 0x4E, 0x08);
    return;
  }
  const x = cx(w, W16(r, 0x43D), 0x40);
  if (x !== null) queueSprite(w, shl3((y + 0xFEC0) & 0xFFFF), shl3(x), 0x4C, 0x08);
}

function arrowAttr(w) { return 0x04 | (w.wram[0][0x835] & 1) | (w.wram[6][0x333] ? 0x20 : 0); }

function courseAimArrow(w) {                     // 11:464C CourseViewDrawAimArrow
  const r = w.wram[6];
  if (r[0x4D4] || !W16(r, 0x483)) return;
  const y = cy(w, W16(r, 0x483));
  if (y === null) return;
  const x = cx(w, W16(r, 0x481));
  if (x !== null) queueSprite16(w, shl3(y), shl3(x), 0x00, arrowAttr(w));
}

function coursePreviewSpot(w) {                  // 11:46B2 CourseViewDrawPreviewSpot
  const r = w.wram[6];
  if (!W16(r, 0x377)) return;
  const y = cy(w, W16(r, 0x377));
  if (y === null) return;
  const x = cx(w, W16(r, 0x374));
  if (x !== null) queueSprite(w, shl3(y), shl3(x), 0x3E, 0x08);
}

function lookCursorSprite(w, e, d) {             // 11:4755 / 11:4C50
  if (testGameFlag(w, 75)) {
    queueSprite(w, e, d, 0x2C, 0x08);
    D.inBank(w, 0x12, () => animateCursorIcon(w));   // 12:6FDD
    return;
  }
  e = (e + rd(w, 0x4C7B + (w.high[0x18C] & 0x3F))) & 0xFF;   // 11:4C69 LookCursorBob
  queueSprite16(w, e, d, 0x2C, 0x0B);
}

function courseLookCursor(w) {                   // 11:4704 CourseViewDrawLookCursor
  const r = w.wram[6];
  if (r[0x438] !== 3 || !W16(r, 0x424)) return;
  const y = cy(w, W16(r, 0x424));
  if (y === null) return;
  const x = cx(w, W16(r, 0x422));
  if (x !== null) lookCursorSprite(w, shl3(y), shl3(x));
}

export function animateCursorIcon(w) {           // 12:6FDD AnimateCursorIcon
  const v = w.high[0x18C];
  if (v & 0x0F) return;
  const src = testGameFlag(w, 75) ? 0x72C0 + ((v & 0x10) << 1) : 0x7040 + ((v & 0x10) << 2);
  D.queueVRAMCopy(w, src, 0xA2C0, 4);
}

// ---- the green view (11:4994 - 11:4C5E): 4 x the course scale from the green's corner ----
function gy(w, v, add = 0, check = true) {
  const hl = (sub(v, w.wram[6][0x442] << 8) + add) & 0xFFFF;
  return check && hl >> 8 >= 4 ? null : hl;
}
function gx(w, v, add = 0, check = true) {
  const hl = (sub(v, w.wram[6][0x441] << 8) + add) & 0xFFFF;
  return check && (((hl >> 8) + 1) & 0xFF) >= 6 ? null : hl;
}

function greenBall(w) {                          // 11:4994 GreenViewDrawBall
  const r = w.wram[6];
  const x = gx(w, W16(r, 0x401));
  if (x === null) return;
  const b = shr3(x);
  const hgt = W16(r, 0x407);
  let hl = sub(W16(r, 0x404), r[0x442] << 8) & 0xFFF8;
  hl = sub(hl, hgt & 0xFFF8);
  if (hl >> 8 < 4) queueSprite(w, shr3(hl), b, ballTile(r), 0x08);
  if (!hgt) return;
  const y = gy(w, W16(r, 0x404));
  if (y !== null) queueSprite(w, shr3(y), b, 0x4E, 0x08);
}

function greenOtherBall(w) {                     // 11:4A35 GreenViewDrawOtherBall
  const r = w.wram[6];
  const x = gx(w, W16(r, 0x41E));
  if (x === null) return;
  const y = gy(w, W16(r, 0x420));
  if (y !== null) queueSprite(w, shr3(y), shr3(x), 0x78, 0x08);
}

function greenTargetMarker(w) {                  // 11:4A7E GreenViewDrawTargetMarker
  const r = w.wram[6];
  if (!W16(r, 0x428)) return;
  const y = gy(w, W16(r, 0x428));
  if (y === null) return;
  const x = gx(w, W16(r, 0x426));
  if (x === null) return;
  queueSprite(w, shr3((y + 0xFFA8) & 0xFFFF), shr3(x), 0x3A, 0x08);
  D.inBank(w, 0x12, () => blinkTargetMarker(w));
}

function greenPin(w) {                           // 11:4AD0 GreenViewDrawPin (no range checks)
  const r = w.wram[6];
  if (!W16(r, 0x43F)) return;
  if (r[0x4D5]) {
    queueSprite(w, shr3(gy(w, W16(r, 0x43F), 0, false)), shr3(gx(w, W16(r, 0x43D), 0, false)), 0xDE, 0x08);
    return;
  }
  const e = shr3(gy(w, W16(r, 0x43F), 0xFF30, false)), d = shr3(gx(w, W16(r, 0x43D), 0x08, false));
  queueSprite(w, e, d, 0xEE, 0x08);
  queueSprite(w, (e + 0x10) & 0xFF, d, 0xFE, 0x08);
}

function greenAimArrow(w) {                      // 11:4B68 GreenViewDrawAimArrow
  const r = w.wram[6];
  if (r[0x4D4] || !W16(r, 0x483)) return;
  const y = gy(w, W16(r, 0x483));
  if (y === null) return;
  const x = gx(w, W16(r, 0x481));
  if (x !== null) queueSprite16(w, shr3(y), shr3(x), 0x00, arrowAttr(w));
}

function greenPreviewSpot(w) {                   // 11:4BC7 GreenViewDrawPreviewSpot
  const r = w.wram[6];
  if (!W16(r, 0x377)) return;
  const y = gy(w, W16(r, 0x377));
  if (y === null) return;
  const x = gx(w, W16(r, 0x374));
  if (x !== null) queueSprite(w, shr3(y), shr3(x), 0x3E, 0x08);
}

function greenLookCursor(w) {                    // 11:4C12 GreenViewDrawLookCursor (no range checks)
  const r = w.wram[6];
  if (r[0x438] !== 3 || !W16(r, 0x424)) return;
  lookCursorSprite(w, shr3(gy(w, W16(r, 0x424), 0, false)), shr3(gx(w, W16(r, 0x422), 0, false)));
}

// the handlers by object id (CourseViewObjectHandlerTable 11:4375 / GreenViewObjectHandlerTable 11:4984)
const COURSE = [null, coursePin, courseTargetMarker, courseBall, courseAimArrow, coursePreviewSpot, courseOtherBall];
const GREEN = [null, greenPin, greenTargetMarker, greenBall, greenAimArrow, greenPreviewSpot, greenOtherBall];
export function drawBallObject(w, id) {          // 11:4E50 CallBallObjectHandler
  const t = W16(w.wram[6], 0x47E) === 0x4984 ? GREEN : COURSE;
  const f = t[id];
  if (f) f(w);
}
export function lookCursor(w) {                  // drawn before the sorted objects (11:436C / 11:497B)
  if ((w.wram[6][0x443] & 7) === 1) greenLookCursor(w); else courseLookCursor(w);
}

// ---- the cup close-up (view 2) ----
export function cupView(w) {                     // 11:4CBB BallDisplayCupView
  const r = w.wram[6];
  if (r[0x444] === 0xFF) return;
  if (r[0x444]) {                                // holed: the frame around the cup
    queueSprite(w, 0x44, 0x4C, 0xCE, 0x0A);
    queueSprite(w, 0x44, 0x54, 0xCE, 0x2A);
    queueSprite(w, 0x44, 0x44, 0xE4, 0x0A);
    queueSprite(w, 0x44, 0x5C, 0xE4, 0x2A);
  }
  const dy = sub(W16(r, 0x404), W16(r, 0x43F));
  if (dy & 0x8000) cupViewPin(w);
  const b = (sub(W16(r, 0x401), W16(r, 0x43D)) + 0x50) & 0xFF;
  const y = sub(W16(r, 0x404), (W16(r, 0x43F) + 7) & 0xFFFF);
  const z = sub(y, W16(r, 0x407));
  queueSprite(w, (((z << 16 >> 16) >> 1) + 0x40) & 0xFF, b, 0xC6, 0x08);
  if (!(r[0x408] & 0x80)) queueSprite(w, (((y << 16 >> 16) >> 1) + 0x40) & 0xFF, b, 0xD6, 0x08);
  if (!(dy & 0x8000)) cupViewPin(w);
}
function cupViewPin(w) {                         // 11:4D61 CupViewDrawPin
  if (w.wram[6][0x4D5]) return;
  queueSprite(w, 0x25, 0x50, 0xE6, 0x08);
  queueSprite(w, 0x35, 0x50, 0xF6, 0x08);
}

// ---- behind the golfer (view 4): the ball sprite from 11:4795's projection (swing.js ballViewCut) ----
export function view4Ball(w, p) {                // 11:4879: tile $30 + the size step by distance (11:48A3)
  if (!p) return;
  let a = (-w.high[0x1B6]) & 0xFF;
  if (a >= 0x1F) a = 0x1F;
  queueSprite(w, p.e, p.d, (0x30 + rd(w, 0x48A3 + (a >> 2))) & 0xFF, 0x08);
}

// 11:48AB PreviewMarkerView4: the landing preview ($D374 / $D377, height $D37A) seen from the view-4 camera
// ($D456 / $D458, angle $D45A): rotated (-> $D45C-$D45F), divided by the depth, drawn as tile $3E
export function previewMarkerView4(w) {
  const r6 = w.wram[6], W = a => r6[a] | r6[a + 1] << 8;
  const ang = W(0x45A);
  const dy = (W(0x377) - W(0x458)) & 0xFFFF, dx = (W(0x374) - W(0x456)) & 0xFFFF;
  const [xc, xs] = g.mulSinCosSigned(dx, ang);
  r6[0x45C] = xc & 0xFF; r6[0x45D] = xc >> 8; r6[0x45E] = xs & 0xFF; r6[0x45F] = xs >> 8;
  const [yc, ys] = g.mulSinCosSigned(dy, (ang + 0x4000) & 0xFFFF);
  const x = (yc + xc) & 0xFFFF;
  const z = g.neg16((xs + ys) & 0xFFFF);
  if (!(z >> 8) && (z & 0xFF) < 0x10) { queueSprite(w, 0x7C, 0x50, 0x3E, 0x08); return; }
  const b = g.divHLByDE(0x5000, ((z + 0x280) & 0xFFFF) >> 3) & 0xFF;
  const sx = ((((g.mulHLByAFracSigned(x, b) + 1) & 0xFFFF) << 16 >> 16) >> 1) & 0xFF;
  const h = (0x80 - W(0x37A)) & 0xFFFF;
  const sy = ((((g.mulHLByAFracSigned(h, b) + 1) & 0xFFFF) << 16 >> 16) >> 1) & 0xFF;
  queueSprite(w, (sy + 0x3C) & 0xFF, (sx + 0x50) & 0xFF, 0x3E, 0x08);
}
