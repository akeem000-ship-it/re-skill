// The aiming menu (AimMenu 10:5BA6): what the player does before addressing the ball. Up / Down change the
// club, Left / Right turn the aim (faster while held), B switches the shot mode (power shot $D32A; the putter's
// range $D32B), Select looks at the pin (camera to the cup, then the green view) and back, A goes on to the
// swing. The target marker ($D426-$D429) slides out to the club's distance along the aim and stays inside the
// map or the green (40:640E); $D36B keeps which edges stopped it.
import { rb, rw } from "./rom.js";
import * as g from "./math.js";
import * as L from "./launch.js";
import * as S from "./swing.js";
import * as C from "./camera.js";
import { pinDist } from "./cup.js";
import { ball, rd16, wr16, playerField as pf } from "./memory.js";
import { loadShotView, aimMarker } from "./view.js";
import { planShot } from "./ai.js";
import * as D from "./render/hooks.js";

function notPorted(what) { throw new Error(`${what} is not ported`); }

export function aimOffset(w) {                   // 40:62BC AimOffset: the club's distance along the aim: [dx, dy]
  return g.mulSinCos(L.baseDistance(w), rd16(w.wram[6], 0x418));
}

const sub = (a, b) => (a - b) & 0xFFFF;

function limits(w) {                             // the marker's box: the map ($C329-$C32C) or the green's 5 x 4 tiles
  const w0 = w.wram[0], r6 = w.wram[6];
  if (r6[0x443] === 1 || r6[0x443] === 2)
    return [(r6[0x441] << 8) + 0x20, sub(((r6[0x441] + 5) & 0xFF) << 8, 0x20),
            (r6[0x442] << 8) + 0x20, sub(((r6[0x442] + 4) & 0xFF) << 8, 0x20), true];
  return [(w0[0x329] << 8) + 0x80, sub(w0[0x32B] << 8, 0x80), (w0[0x32A] << 8) + 0x80, sub(w0[0x32C] << 8, 0x280), false];
}

// 40:62D0 (the tail of 40:62C9): marker = ball + (dx, dy), each axis clamped to the box (edge bits in $D36B)
function setMarker(w, dx, dy) {
  const r6 = w.wram[6];
  const ty = (rd16(r6, 0x404) + dy) & 0xFFFF, tx = (rd16(r6, 0x401) + dx) & 0xFFFF;
  const [left, right, top, bottom] = limits(w);
  let x = tx;
  if (!(sub(left, tx) & 0x8000)) { r6[0x36B] |= 2; x = left; }
  else if (sub(right, tx) & 0x8000) { r6[0x36B] |= 1; x = right; }
  wr16(r6, 0x426, x);
  let y = ty;
  if (!(sub(top, ty) & 0x8000)) { r6[0x36B] |= 8; y = top; }
  else if (sub(bottom, ty) & 0x8000) { r6[0x36B] |= 4; y = bottom; }
  wr16(r6, 0x428, y);
}

export function setMarkerAtClub(w) {             // 40:62C9: the marker at the club's distance, clamped
  w.wram[6][0x36B] = 0;
  const [dx, dy] = aimOffset(w);
  setMarker(w, dx, dy);
}

function ratioOrMax(hl, de) {                    // 40:6297 RatioOrMax: |hl| * 256 / |de| (24 bits); $FF:$FFFF for like signs
  if (!((hl ^ de) & 0x8000)) return 0xFFFFFF;
  const [a, q] = g.divAHLByDE(g.abs16(hl) >> 8, (g.abs16(hl) & 0xFF) << 8, g.abs16(de));
  return a << 16 | q;
}

function ratio(hl, de) {                         // 40:6491 ClampRatioX / 40:64FF ClampRatioY (course): hl * 256 / |de|
  const [a, q] = g.divAHLByDE(hl >> 8, (hl & 0xFF) << 8, g.abs16(de));
  return a << 16 | q;
}

// 40:640E PlaceTargetMarker: when the club's distance along the aim leaves the box, the offset is shortened by
// the larger overshoot ratio (x 1 - ratio, if below 1) before the clamp
export function placeTargetMarker(w) {
  const r6 = w.wram[6];
  r6[0x36B] = 0;
  const [dx, dy] = aimOffset(w);
  const ty = (rd16(r6, 0x404) + dy) & 0xFFFF, tx = (rd16(r6, 0x401) + dx) & 0xFFFF;
  const [left, right, top, bottom, green] = limits(w);
  const rx = green ? ratioOrMax : ratio;
  let fx, fy;                                    // 24-bit ratios (the stack frame's bytes 4-6 and 7-9)
  let o = sub(left, tx);
  if (!(o & 0x8000)) { fx = rx(o, dx); r6[0x36B] |= 2; }
  else {
    o = sub(right, tx);
    if (o & 0x8000) { fx = rx(green ? o : (-o) & 0xFFFF, dx); r6[0x36B] |= 1; } else fx = 0;
  }
  o = sub(top, ty);
  if (!(o & 0x8000)) { fy = rx(o, dy); r6[0x36B] |= 8; }
  else {
    o = sub(bottom, ty);
    if (o & 0x8000) { fy = rx(green ? o : (-o) & 0xFFFF, dy); r6[0x36B] |= 4; } else fy = 0;
  }
  let use;
  if (fx < fy) { r6[0x36B] &= 0xFC; use = fy; }  // 40:6576: the y ratio
  else if (fx > fy) { r6[0x36B] &= 0xF3; use = fx; }   // 40:654B: the x ratio
  else if (!fx) return setMarker(w, dx, dy);     // 40:6582: no overshoot
  else use = fx;
  if (use >> 8) return setMarker(w, dx, dy);     // a ratio of 1 or more: unscaled
  const b = (-use) & 0xFF;
  const ndy = g.mulHLByAFracSigned(dy, b), ndx = g.mulHLByAFracSigned(dx, b);
  setMarker(w, ndx, ndy);
}

export function aimAtCup(w) {                    // 10:61FA AimAtCup: the angle from the ball to the cup
  const r6 = w.wram[6];
  const dx = (rd16(r6, 0x43D) - rd16(r6, 0x401)) & 0xFFFF;
  const dy = (rd16(r6, 0x43F) - rd16(r6, 0x404)) & 0xFFFF;
  return g.angleFromVector16(dy, dx);
}

export function smartAim(w, hole) {              // 10:6406 SmartAim: at the cup, or a direction whose landing
  const r6 = w.wram[6], s = ball(w);             // is fairway or green (else one club less)
  if ((pinDist(s) - L.baseDistance(w)) & 0x8000) return aimAtCup(w);
  for (;;) {
    let bc = aimAtCup(w);
    for (let d = 0; d < 0x24; d++) {
      const [hl, de] = g.mulSinCos(L.baseDistance(w), bc);
      const x = (rd16(r6, 0x401) + hl) & 0xFFFF, y = (rd16(r6, 0x404) + de) & 0xFFFF;
      if (!((x >> 8) & 0xC0) && !((y >> 8) & 0xC0)) {
        hole.use(r6[0x443] >= 1 && r6[0x443] <= 3);
        if ([0, 6, 0x0A, 0x0E].includes(hole.terrainAt(x, y))) return bc;
      }
      bc = (bc + rw(0x10, 0x63BE + 2 * d)) & 0xFFFF;   // 10:63AA
    }
    if (r6[0x329] >= 0x0C) return aimAtCup(w);
    r6[0x329]++;
  }
}

// 10:5978: the computer golfer's turn of the menu: CpuPlanShotMain 3C:426A picks the club, shot mode, aim and
// the swing it will make (wSwingTargetPower $D4D8, wSwingTargetImpact $D4D9, the d-pad wSwingTargetPad $D4DA);
// the marker slides out, then a second's pause. Returns 0 (as A's swing).
function* cpuAim(sh) {
  const w = sh.w, r6 = w.wram[6];
  const p = planShot(w, sh.hole);
  r6[0x329] = p.club;
  r6[0x32A] = r6[0x32B] = p.mode;
  wr16(r6, 0x418, p.aim);
  r6[0x4D9] = p.impact; r6[0x4D8] = p.power; r6[0x4DA] = p.pad;
  r6[0x44D] = 0xF0;
  r6[0x438] = 2;                                 // wCameraMode
  yield* sh.advance();
  r6[0x321] = S.missTable(w);                    // 10:6907
  L.clubParams(w);                               // 10:5EEF
  r6.copyWithin(0x42A, 0x426, 0x42A);
  yield* slideOut(sh);
  aimMarker(w);                                  // 10:6145
  placeTargetMarker(w);                          // 40:640E (10:5A2E stores its hl, the y it left, again)
  yield* sh.advance(0x3C);                              // WaitFramesCmd 60
  return 0;
}

function aimStep(w) {                            // 08:60E6 AimStepForDistance and 10:5EB9 AimStepAccel
  const r6 = w.wram[6];
  const hl = L.baseDistance(w);
  let bc = rw(0x08, (0x6110 + ((hl >> 4) & 0xFFFE)) & 0xFFFF);   // AimStepTable 08:6110
  if (r6[0x443] === 1) bc >>= 2;                 // a quarter in the green view
  let v;
  if (r6[0x486] >= 0x40) v = (bc * 3) & 0xFFFF;  // x 1.5 at full speed (after the / 2)
  else v = ((g.mulHLByAFrac(bc, (r6[0x486] * 4) & 0xFF) * 2) + bc) & 0xFFFF;
  v >>= 1;
  if (r6[0x486] < 0x40) r6[0x486]++;             // wLookSpeed
  return v;
}

function* slideMarker(sh) {                       // 10:5C87-10:5D0A: club set-up, the marker slides out over 3 frames
  const w = sh.w, r6 = w.wram[6];
  r6[0x321] = S.missTable(w);                    // 10:6907
  L.clubParams(w);                               // 10:5EEF
  r6[0x480] = 0;
  r6.copyWithin(0x42A, 0x426, 0x42A);
  yield* slideOut(sh);
}

function hudRedrawPart(w, c) {                   // 10:5B81 HudRedrawPart: c = 1 the shot panel, 2 the pin distance, 3 the lie
  if (c === 1) { D.hud(w, "hudDrawShotPanel"); D.hud(w, "hudDrawClubIcon"); D.hud(w, "hudSetMeterSpritesY"); }
  else if (c === 2) D.hud(w, "hudDrawPinDistance");
  else D.hud(w, "hudDrawLieIcon");
}

function* slideOut(sh) {                          // the marker from $D42A/$D42C to the club's distance in 3 frames
  const w = sh.w, r6 = w.wram[6];
  const [dx, dy] = g.mulSinCos(L.baseDistance(w), rd16(r6, 0x418));   // 10:5EE2 TargetMarker
  for (let b = 1; b <= 3; b++) {
    for (const [o, base, d] of [[0x426, 0x401, dx], [0x428, 0x404, dy]]) {
      const old = rd16(r6, o + 4);
      let v = g.mulSignedFull(((rd16(r6, base) + d) - old) & 0xFFFF, b);
      v = ((v >> 2) | (v & 0x8000 ? 0xC000 : 0)) & 0xFFFF;
      wr16(r6, o, (v + old) & 0xFFFF);
    }
    hudRedrawPart(w, 4 - b);                     // 10:5B81 HudRedrawPart
    yield* sh.advance();
  }
}

// 10:5BA6 AimMenu: a = 0 sets the shot up (aim, shot mode, the putter's range), a = 1 comes back to it.
// Returns the buttons newly pressed when it ends (A: the swing; Start's pause menu is not ported).
export function* aimMenu(sh, a) {
  const w = sh.w, r6 = w.wram[6], w0 = w.wram[0], s = ball(w);
  sh.mark("aimmenu");
  if (!a) {
    r6[0x426] = s[0x01]; r6[0x427] = s[0x02]; r6[0x428] = s[0x04]; r6[0x429] = s[0x05];
    r6[0x36C] = 0;
    if (r6[0x4E7]) {                             // wForcedShot: settings kept from before
      r6[0x329] = r6[0x4E8];
      r6[0x418] = r6[0x4E9]; r6[0x419] = r6[0x4EA];
      r6[0x32A] = r6[0x4EB]; r6[0x32B] = r6[0x4EC];
      r6[0x4E7] = 0;
    } else {
      wr16(r6, 0x418, smartAim(w, sh.hole));
      r6[0x32A] = r6[0x32B] = 0;
      const d = pinDist(s);                      // the putter's range from the distance
      r6[0x32B] = !((d - 0x42B) & 0x8000) ? 2 : !((d - 0x140) & 0x8000) ? 1 : 0;
    }
    sh.sound(0x60);                              // 10:5C1D
  }
  if (r6[0x329] === 0x0D) r6[0x32A] = 0;
  r6[0x480] = r6[0x382] = 0;
  D.hud(w, "hudDrawDigit", w0[pf(w, 0x28)]);     // 12:4AF6: the power shots left
  yield* sh.advance();
  D.hud(w, "hudDrawShotPanel");                  // 12:46A6
  yield* sh.advance();
  D.hud(w, "hudDrawClubIcon");                   // 12:465C
  D.hud(w, "hudSetMeterSpritesY");               // 12:4968
  yield* sh.advance();
  D.hud(w, "hudDistance");                       // 12:4CA6
  yield* sh.advance();
  r6[0x513] = 0;
  if (r6[0x4D7] === 1) return yield* cpuAim(sh);
  if (r6[0x4D7] === 2) notPorted("the replayed stroke (~10:5973)");
  if (r6[0x4D7] === 3) notPorted("link play (~10:5943)");
  w.high[0x1C1] = 0x21;                          // 02:482C SerialIdleSet21
  r6[0x44D] = 0xF0;
  r6[0x438] = r6[0x443] ? 4 : 2;                 // the camera on the target marker (the cup on the green)
  r6[0x4D4] = 1;
  yield* sh.advance();
  let at = "5C87";
  for (;;) {
    if (at === "5C87") { yield* slideMarker(sh); at = "5D0D"; }
    if (at === "5D0D") {
      aimMarker(w);                              // 10:6145
      placeTargetMarker(w);                      // 40:640E
    }
    at = "5D16";
    yield* sh.advance();
    if (w0[0x0F4]) notPorted("the shot clock (~10:5D1C)");
    if (r6[0x438] === 1 && !(w.high[0x190] & 4)) { r6[0x438] = 2; sh.sound(0x60); }   // 10:5D44
    const p = w.high[0x194];
    if (p & 1) { w.high[0x1C1] = 0x20; r6[0x4D4] = 0; return p; }   // A (10:5EAF; 02:4833 SerialIdleSet20)
    if (p & 4) { yield* lookAtPin(sh); at = "5D0D"; continue; }
    if (p & 8) notPorted("the pause menu (~08:4666)");
    if (p & 2) { shotModeButton(w, id => sh.sound(id)); at = "5C87"; continue; }
    const rep = w.high[0x191];
    if (rep & 0x40) {                            // Up: a longer club (not on the green)
      if (r6[0x4CD] !== 6 && r6[0x329]) { r6[0x329]--; sh.sound(0x8C); at = "5C87"; }   // 10:5E3F
      continue;
    }
    if (rep & 0x80) {                            // Down: a shorter club
      if (r6[0x4CD] !== 6 && r6[0x329] !== 0x0D) { r6[0x329]++; sh.sound(0x8C); at = "5C87"; }   // 10:5E5C
      continue;
    }
    const held = w.high[0x190];
    if (held & 0x30) {                           // Left / Right: turn the aim
      const bc = aimStep(w);
      wr16(r6, 0x418, (rd16(r6, 0x418) + (held & 0x20 ? (~(bc - 1)) & 0xFFFF : bc)) & 0xFFFF);
      at = "5D0D";
      continue;
    }
    r6[0x486] = 0;
  }
}

function shotModeButton(w, sound) {              // 10:5DB7: B in the menu
  const r6 = w.wram[6];
  if (r6[0x329] === 0x0D) {                      // the putter: the range 0 -> 1 -> 2 -> 0 (table 10:5E22)
    r6[0x32B] = rb(0x10, 0x5E22 + r6[0x32B]);
    sound(0x8D);                                 // 10:5E1D
    return;
  }
  if (!((pinDist(ball(w)) + 0xF860) & 0x8000)) {   // $7A0 or farther: the power shot on / off
    if (r6[0x32A]) { r6[0x32A] = 0; sound(0x8D); return; }   // 10:5DD7
    if (!w.wram[0][pf(w, 0x28)]) { sound(0x54); return; }   // none left (10:5DE5)
    r6[0x32A] ^= 1;
    sound(0x8D);                                 // 10:5DF1
    return;
  }
  r6[0x32A] = rb(0x10, 0x5E0A + r6[0x32A]);      // near the pin: the approach shots 0 -> 3 -> 2 -> 0 (table 10:5E0A)
  sound(0x8D);                                   // 10:5E05
}

function* lookAtPin(sh) {                         // 10:5D51: Select looks at the pin and back
  const w = sh.w, r6 = w.wram[6];
  if (r6[0x438] === 2) {
    sh.sound(0x60);                              // 10:5D58
    r6[0x438] = 4;                               // the camera pans to the cup
    for (;;) {
      yield* sh.advance();
      if (w.high[0x194]) break;
      if (C.atGoal(w)) {
        do { yield* sh.advance(); } while (w.high[0x190] & 4);   // until Select is let go
        break;
      }
    }
    yield* loadShotView(sh, 1);
    sh.sound(0x61);                              // 10:5D7B
  } else if (r6[0x438] === 4) {
    r6[0x438] = 1;
    yield* loadShotView(sh, 0);
    sh.sound(0x61);                              // 10:5D8C
  }
}
