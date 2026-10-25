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
import { lieTerrain, ballInGreenArea } from "./shot.js";

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

export function aimAtCup(w) {                    // 10:61FA: the angle from the ball to the cup
  const r6 = w.wram[6];
  const dx = (rd16(r6, 0x43D) - rd16(r6, 0x401)) & 0xFFFF;
  const dy = (rd16(r6, 0x43F) - rd16(r6, 0x404)) & 0xFFFF;
  return g.angleFromVector16(dy, dx);
}

export function aimMarker(w) {                   // 10:6145: the aim arrow's end ($D481-$D484), across the aim
  const r6 = w.wram[6];
  const turn = r6[0x333] & 1 ? 0x4000 : 0xC000;
  const hl = r6[0x443] ? 0x20 : 0x80;
  const [c, s] = g.mulSinCos(hl, (rd16(r6, 0x418) + turn) & 0xFFFF);
  wr16(r6, 0x481, (rd16(r6, 0x401) + c) & 0xFFFF);
  wr16(r6, 0x483, (rd16(r6, 0x404) + s) & 0xFFFF);
}

export function shotSetup(w, hole) {             // 10:4798 ShotSetup up to the address step, the menu answered with A
  const r6 = w.wram[6], w0 = w.wram[0], s = ball(w);
  r6[0x48E] = 0;
  r6[0x445] = w0[pf(w, 0x29)] ? 0 : 1;           // the tee shot
  r6[0x446] = w0[pf(w, 0x3F)];
  w0[pf(w, 0x3F)] = 0;
  r6[0x4CD] = lieTerrain(hole, s);
  r6[0x4D5] = r6[0x4CD] === 6 ? 1 : 0;
  r6[0x332] = w0[pf(w, 0x10)];
  r6[0x333] = w0[pf(w, 0x11)];
  pickClub(w);
  L.clubParams(w);
  r6[0x485] = 0x25;
  wr16(r6, 0x418, aimAtCup(w));
  if (r6[0x443] === 2) r6[0x443] = 1;
  r6[0x438] = 1;
  aimMarker(w);
  S.meterReset(w);
  r6[0x485] = 0x2D;
  r6.copyWithin(0x5F8, 0x400, 0x406);            // 02:4679
  r6[0x51C] = w0[pf(w, 0x28)];
  r6[0x485] = 0x3F;
  r6.copyWithin(0x514, 0x400, 0x406);            // 10:550B
  aimMenuA(w, hole);
  if (r6[0x443] <= 1) S.drawSortedBallObjects(w);   // the display task's last frame in the menu (11:4361 / 11:4970)
  // the aiming menu (AimMenu 10:5BA6) answered with A: the swing
  if (r6[0x332] < 0x0B && r6[0x329] !== 0x0D && w0[pf(w, 0x13)] !== 3 && !(w0[0x818] & 2)) {
    r6[0x337] = 0;                               // ShotViewLeave
    wr16(r6, 0x456, rd16(r6, 0x401));            // 11:476E: the camera behind the ball
    wr16(r6, 0x458, rd16(r6, 0x404));
    wr16(r6, 0x45A, (0xC000 - rd16(r6, 0x418)) & 0xFFFF);
    r6[0x438] = 0;
    loadView4(w, hole);
  }
  r6[0x438] = 1;
  if (r6[0x443] !== 4) {                         // 10:5632
    const c = ballInGreenArea(s);
    if (r6[0x443] !== c) { r6[0x444] = 0; r6[0x443] = c; }
    aimMarker(w);
  }
}

function loadView4(w) {                          // 13:432B LoadShotView with a = 4: the view behind the golfer
  const r6 = w.wram[6];
  r6[0x444] = 0;
  w.wram[0][0xA80] = w.wram[0][0xA81] = 0;
  S.animStart(w, 0);                             // 11:6D69 (and the animation task registered)
  if (w.tasks) w.tasks.animOn = true;
  r6[0x443] = 4;
  r6[0x480] = 0;
  r6[0x328] = 0;
}

export function smartAim(w, hole) {              // 10:6406 SmartAim: at the cup, or a direction whose landing
  const r6 = w.wram[6], s = ball(w);             // is fairway or green (else one club less)
  if ((C.pinDist(s) - L.baseDistance(w)) & 0x8000) return aimAtCup(w);
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

export function aimMenuA(w, hole) {              // AimMenu 10:5BA6 with a = 0, answered at once with A
  const r6 = w.wram[6], s = ball(w);
  r6[0x426] = s[0x01]; r6[0x427] = s[0x02]; r6[0x428] = s[0x04]; r6[0x429] = s[0x05];
  if (r6[0x4E7]) {                               // settings kept from before (a retry)
    r6[0x329] = r6[0x4E8];
    r6[0x418] = r6[0x4E9]; r6[0x419] = r6[0x4EA];
    r6[0x32A] = r6[0x4EB]; r6[0x32B] = r6[0x4EC];
    r6[0x4E7] = 0;
  } else {
    wr16(r6, 0x418, smartAim(w, hole));
    r6[0x32A] = r6[0x32B] = 0;
    const d = C.pinDist(s);                      // the putter's range from the distance
    r6[0x32B] = !((d - 0x42B) & 0x8000) ? 2 : !((d - 0x140) & 0x8000) ? 1 : 0;
  }
  if (r6[0x329] === 0x0D) r6[0x32A] = 0;
  r6[0x480] = r6[0x382] = 0;
  r6[0x513] = 0;
  if (r6[0x4D7]) throw new Error("the computer's aiming (~10:5943-~10:5978) is not ported");
  r6[0x44D] = 0xF0;
  r6[0x438] = r6[0x443] ? 4 : 2;
  r6[0x4D4] = 1;
  r6[0x321] = S.missTable(w);
  L.clubParams(w);
  r6[0x480] = 0;
  r6.copyWithin(0x42A, 0x426, 0x42A);
  const [dx, dy] = g.mulSinCos(L.baseDistance(w), rd16(r6, 0x418));   // 10:5EE2
  const tx = (rd16(r6, 0x401) + dx) & 0xFFFF, ty = (rd16(r6, 0x404) + dy) & 0xFFFF;
  for (const b of [1, 2, 3, 4]) {                // the marker slides out in quarters
    for (const [o, t] of [[0x426, tx], [0x428, ty]]) {
      const old = rd16(r6, o + 4);
      let v = g.mulSignedFull((t - old) & 0xFFFF, b);
      v = ((v >> 2) | (v & 0x8000 ? 0xC000 : 0)) & 0xFFFF;
      wr16(r6, o, (v + old) & 0xFFFF);
    }
  }
  aimMarker(w);
  r6[0x4D4] = 0;
  S.previewRestart(w);                           // the landing preview restarted at least once in the menu
  B.speedAndDir(s);                              // and stepped (10:5355 starts with BallSpeedAndDir)
}
