// A hole between two shots (tools/hole_py.py): after a shot (PostShot 10:4A82) the putt count, the outcome
// rules (3B:7260: penalties, the water drop, bonus and points, the "on the green" flag) and the spot kept in
// the player's record; the shot loop (10:45E7: stroke limit, holed bookkeeping and the scorecard, the next
// player); then ShotSetup 10:4798 up to the address step (lie, the club the game picks, the aim at the cup,
// the views and the camera). Captions, menus and other display work are left out.
import { rb, rw } from "./rom.js";
import * as g from "./math.js";
import * as B from "./ball.js";
import * as C from "./cup.js";
import * as L from "./launch.js";
import * as S from "./swing.js";
import { ball, rd16, wr16, playerField as pf } from "./memory.js";
import { lieTerrain, initBallCamera } from "./shot.js";
import * as A from "./aim.js";
import * as V from "./view.js";
import * as Cam from "./camera.js";
import * as D from "./render/hooks.js";

function notPorted(what) { throw new Error(`${what} is not ported`); }

export function countStroke(w) {                // 10:477C CountStroke (its frame is not counted here)
  const f = pf(w, 0x20);
  if (w.wram[0][f] < 0x14) w.wram[0][f]++;
}

function pointsAllowed(w) {                      // 02:5C19: modes 1, 2, 3, 5, $0A, $0B, for a human player
  const w0 = w.wram[0];
  if (![1, 2, 3, 5, 0x0A, 0x0B].includes(w0[0x834])) return false;
  return w0[0x880 + ((w0[0x835] & 1) << 6) + 0x13] === 0;
}

function addBonus(w, de) {                       // 02:53F5: $D4F1 += de
  if (pointsAllowed(w)) wr16(w.wram[6], 0x4F1, (rd16(w.wram[6], 0x4F1) + de) & 0xFFFF);
}

function addPoints(w, de) {                      // 02:5411: $C83C += de x course factor (02:543E) / 2
  if (!pointsAllowed(w)) return;
  const w0 = w.wram[0];
  const f = rb(0x02, 0x543E + (w0[0x836] & 0x0F));
  wr16(w0, 0x83C, (rd16(w0, 0x83C) + (g.mulHLByA(de, f) >> 1)) & 0xFFFF);
}

export function outcomeRules(w, a) {             // 3B:7260 OutcomeRules (the gameplay effects; captions left out)
  const r6 = w.wram[6], w0 = w.wram[0];
  if ([5, 6, 7, 0x0B, 0x0C].includes(w0[0x834])) throw new Error(`play mode $${w0[0x834].toString(16)} (~3B:75CC-~3B:76C0) is not ported`);
  if (r6[0x48E] & 1) addBonus(w, 0x0A);          // skipped on water
  if (a === 0x80) return holedRules(w);
  const i = a & 0x0F;
  if (i === 3) {                                 // 3B:7426 water: a penalty stroke, back to the last safe spot
    r6[0x485] &= 0xFB;
    countStroke(w);
    r6.copyWithin(0x400, 0x51D, 0x523);
    return 0;
  }
  if (i === 7) { countStroke(w); return 0xFF; }  // 3B:7411 out of bounds: a penalty stroke
  if (i === 6) {                                 // 3B:7447 on the green
    const f = pf(w, 0x2B);
    if (!w0[f]) {
      w0[f] = 1;
      if (r6[0x48E] & 2) addBonus(w, 4);         // off the pin
      else {
        const d = (r6[0x325] - w0[pf(w, 0x20)]) & 0xFF;
        if (!(d & 0x80) && d >= 3) addBonus(w, 2);
        else if (!(d & 0x80) && d >= 2 && (C.pinDist(ball(w)) - 0x21) & 0x8000) addBonus(w, 2);
      }
    }
    return 0;
  }
  if (i === 0x0A) r6[0x485] &= 0xF7;             // 3B:7555
  return 0;
}

function holedRules(w) {                         // 3B:72C3: the hole's bonus, how it went in, the score vs par
  const r6 = w.wram[6], w0 = w.wram[0];          // (the memorable-shot records ~02:4714 / ~02:5C50 left out)
  addPoints(w, rd16(r6, 0x4F1));
  const start = r6.subarray(0x5F8, 0x5FE);
  if (r6[0x48E] & 4) addPoints(w, 0x0A);         // off the flagstick
  else if (r6[0x4CD] !== 6) {
    if (w0[pf(w, 0x20)] !== 1) {                 // holed from off the green: 8 from $780 or more, else 6
      const far = !((C.shotLength(ball(w), start) - 0x780) & 0x8000);
      addPoints(w, far ? 8 : 6);
    }
  } else if (r6[0x329] === 0x0D) {               // a putt from $280 or more
    if (!((C.shotLength(ball(w), start) - 0x280) & 0x8000)) addPoints(w, 4);
  }
  const strokes = w0[pf(w, 0x20)];
  if (strokes === 1) { addPoints(w, 0x14); return 0; }   // hole in one
  const d = (strokes - r6[0x325]) & 0xFF;
  addPoints(w, { 0xFF: 6, 0xFE: 0x0A, 0xFD: 0x10 }[d] || 0);   // birdie, eagle, albatross
  return 0;
}

export function postShot(w, a) {                 // 10:4A82-10:4AEE PostShot (B held for a retry not modelled)
  const r6 = w.wram[6], w0 = w.wram[0];
  if (w.tasks) w.tasks.taskOn = false;           // 10:4A26: BallTask off
  if (r6[0x4CD] === 6) w0[pf(w, 0x21)]++;        // a putt
  r6[0x438] &= 0x0F;
  r6[0x4DC] = a;
  w0[pf(w, 0x14)] = a;
  S.meterReset(w);
  if (outcomeRules(w, a) === 0) {                // $FF (out of bounds): the old spot is kept
    w0[pf(w, 0x29)] = 1;
    w0.set(r6.subarray(0x400, 0x406), pf(w, 0x22));
  }
  return a;
}

export function scorecard(w) {                   // 10:4101 Scorecard: strokes and putts, the score against par
  const w0 = w.wram[0], r6 = w.wram[6];
  const strokes = w0[pf(w, 0x20)], putts = w0[pf(w, 0x21)];
  const h = w0[0x837] - 1;
  if (h < 0x12) w0[pf(w, 0x2C) + h] = strokes | ((putts << 4) & 0xFF);
  w0[pf(w, 0x3E)] = (strokes + w0[pf(w, 0x3E)] - r6[0x325]) & 0xFF;
}

export function pickClub(w) {                    // 10:6341 PickClub: the most lofted club that reaches the pin
  const r6 = w.wram[6];
  let ffb0 = 0x0C;
  r6[0x32A] = 0;
  if (r6[0x4CD] === 6 || r6[0x4CD] === 0x0A) { r6[0x329] = 0x0D; return; }   // the putter on the green
  const pin = C.pinDist(ball(w));
  let c = rb(0x10, 0x639A + (L.lieClass(w) & 0x0F));
  let b = 0x0C;
  for (;;) {
    r6[0x329] = b;
    if (S.missTable(w)) {
      ffb0 = b;
      if ((pin - L.baseDistance(w)) & 0x8000) break;
    }
    b = (b - 1) & 0xFF;
    c = (c - 1) & 0xFF;
    if (!c) break;
  }
  r6[0x329] = ffb0;
}

// 10:4798 ShotSetup up to the address step (10:56B0): lie and club, the camera, the HUD frames, a 30-frame pause
// (or a button), the aiming menu, then the view behind the golfer
export function shotSetup(sh) {
  const w = sh.w, r6 = w.wram[6], w0 = w.wram[0], s = ball(w);
  if (w0[0x0F4]) w0[0x0F4] = 1;                  // the shot clock
  w.high[0x1C1] = 0x20;                          // hSerialIdleByte
  r6[0x48E] = 0;
  r6[0x445] = w0[pf(w, 0x29)] ? 0 : 1;           // the tee shot
  r6[0x446] = w0[pf(w, 0x3F)];
  w0[pf(w, 0x3F)] = 0;
  r6[0x454] = 1;                                 // 12:4B19 HudFlags: wHudBlink
  r6[0x4CD] = lieTerrain(sh.hole, s);            // 10:648B
  r6[0x4D5] = r6[0x4CD] === 6 ? 1 : 0;
  r6[0x332] = w0[pf(w, 0x10)];
  r6[0x333] = w0[pf(w, 0x11)];
  pickClub(w);
  L.clubParams(w);
  r6[0x485] = 0x25;
  D.golferActorShow(sh);                         // 04:57BA GolferActorShow
  wr16(r6, 0x418, A.aimAtCup(w));
  if (r6[0x443] === 2) { D.cupViewLeave(w); r6[0x443] = 1; sh.advance(); }   // 13:4528 CupViewLeave
  Cam.snapToGoal(sh);                            // 13:4276
  r6[0x438] = 1;
  V.aimMarker(w);
  sh.advance();
  D.hud(w, "hudDrawLieIcon");                    // 12:45F4
  sh.advance();
  D.hud(w, "hudDistance");                       // 12:4CA6
  sh.advance(2);
  S.meterReset(w);                               // 10:55FF
  sh.advance();
  r6[0x485] = 0x2D;
  r6.copyWithin(0x5F8, 0x400, 0x406);            // 02:4679 KeepShotStart
  r6[0x51C] = w0[pf(w, 0x28)];
  if (w0[0x870]) notPorted("golf event hooks (~10:4CC3)");
  if (w0[0x834] === 2) notPorted("the match-play captions (~08:48BD)");   // 08:4880 RoundHookPlayerUp (captions)
  for (let c = 0x1E; c; c--) {
    sh.advance();
    if (w.high[0x194]) break;
  }
  r6[0x485] = 0x3F;
  r6.copyWithin(0x514, 0x400, 0x406);            // 10:550B SaveAddressSpot
  return toAddress(sh, A.aimMenu(sh, 0));
}

// 10:486B-10:48FB: what the aiming menu ended with, up to the address step (true there)
function toAddress(sh, a) {
  const w = sh.w, r6 = w.wram[6], w0 = w.wram[0];
  if ([0x8F, 0x82, 0x80, 0x81, 0xFF].includes(a)) notPorted(`the menu's result $${a.toString(16)} (~10:486B)`);
  if (r6[0x332] < 0x0B && r6[0x329] !== 0x0D && w0[pf(w, 0x13)] !== 3 && !(w0[0x818] & 2)) {
    V.viewLeave(sh);                             // 3B:431F
    D.golferActorTaskStop(w);                    // 04:5801
    initBallCamera(w);                           // 11:476E
    r6[0x438] = 0;
    V.loadShotView(sh, 4);
  } else {
    r6[0x438] = 1;
    Cam.snapToGoal(sh);
  }
  r6[0x438] = 1;
  if (r6[0x443] !== 4) V.shotViewUpdate(sh);
  return true;
}

// a whole shot as the player plays it: ShotSetup, then AddressBall and the swing (B there goes back to the
// menu: 10:4902-10:491E), the launch and the flight: the outcome (10:4A25)
export function playShot(sh) {
  shotSetup(sh);
  return addressLoop(sh);
}

export function addressLoop(sh) {                // from the address step (after ShotSetup) to the outcome
  const r6 = sh.w.wram[6];
  for (;;) {
    sh.mark("address");
    const r = sh.address();
    if (r === 0) return sh.afterSwing();
    if (r6[0x443] === 4) {                       // ~15:47B1 BehindViewTaskStop, ~04:57BA, ~04:4062 (display)
      V.shotViewUpdate(sh);
    }
    sh.advance(5);                               // WaitFramesCmd 5
    toAddress(sh, A.aimMenu(sh, 1));
  }
}
