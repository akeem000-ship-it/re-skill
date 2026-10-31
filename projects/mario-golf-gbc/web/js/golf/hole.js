// A hole between two shots (tools/hole_py.py): after a shot (PostShot 10:4A82) the putt count, the outcome
// rules (3B:7260: penalties, the water drop, bonus and points, the "on the green" flag) and the spot kept in
// the player's record; the shot loop (10:45E7: stroke limit, holed bookkeeping and the scorecard, the next
// player); then ShotSetup 10:4798 up to the address step (lie, the club the game picks, the aim at the cup,
// the views and the camera). Captions, menus and other display work are left out.
import { callGolfEventHook } from "./golfhooks.js";
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
import { showCaptionAndWait, startCaptionAnim } from "./captions.js";
import * as P from "./pictures.js";
import * as M from "./match.js";
import * as Sv from "./save.js";
import { playRoundMusic, loadHoleInfo, golfViewInit } from "./round.js";
import * as Scr from "./screen.js";

// 08:4880 RoundHookPlayerUp: before each shot, by wGameMode (PlayerUpModeTable 08:489D)
function* roundHookPlayerUp(sh) {
  const w0 = sh.w.wram[0];
  switch (w0[0x834]) {
    case 1: case 3: case 0x0A: yield* showPuttForCaption(sh); break;   // 08:48FD PlayerUpMode1Tournament
    case 2: yield* M.playerUpMode2(sh, showPuttForCaption); break;   // 08:48BD PlayerUpMode2Match
    case 4: yield* showPuttForCaption(sh); w0[0x8A8] = 0x0F; break;     // 08:48EB PlayerUpMode4Training
    case 6: case 7: case 0x0C: playRoundMusic(sh); w0[0x8A8] = 0x0F; break;   // 08:48F4 PlayerUpMode6Practice
    default: break;
  }
}

// 08:4F30 ShowPuttForCaption: on the green, the putt for par / birdie / eagle / albatross (strokes + 1 - par = 0 / -1 /
// -2 / -3): song $0D (par) or $0E and caption $15 / $17 / $14 / $16; other putts song $23; off the green PlayRoundMusic
function* showPuttForCaption(sh) {
  const w = sh.w;
  if (w.wram[6][0x4CD] !== 6) return playRoundMusic(sh);
  const d = (w.wram[0][pf(w, 0x20)] + 1 - w.wram[6][0x325]) & 0xFF;   // 08:4028 GetCurPlayerField
  const cap = { 0x00: 0x15, 0xFF: 0x17, 0xFE: 0x14, 0xFD: 0x16 }[d];
  if (cap === undefined) return sh.sound(0x23);
  sh.sound(d ? 0x0E : 0x0D);
  yield* showCaptionAndWait(sh, cap);            // 3B:76F8
}

function notPorted(what) { throw new Error(`${what} is not ported`); }

export function* countStroke(sh) {               // 10:477C CountStroke: falls into 10:4786 HudRedrawCurPlayer
  const w = sh.w, f = pf(w, 0x20);
  if (w.wram[0][f] >= 0x14) return;
  w.wram[0][f]++;
  D.hud(w, w.wram[0][0x835] ? "hudDrawPlayer2" : "hudDrawPlayer1");   // 12:4B8A / 12:4C18
  yield* sh.advance();
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

// 3B:7260 OutcomeRules (3B:72C3 after its table): a = the shot's outcome: penalties, the water drop, bonus and points, the "on the green" flag,
// with the captions, the caption pictures (4F:619C) and the player's picture (3B:7717); returns 0, or $FF (out of
// bounds: the old spot is kept).
export function* outcomeRules(sh, a) {
  const w = sh.w, r6 = w.wram[6], w0 = w.wram[0];
  yield* sh.viewLeave();                         // 3B:431F ShotViewLeave
  const m = w0[0x834];
  if (m === 5 || m === 0x0B) return 0;           // 3B:75CC
  if (m === 7 || m === 0x0C) {                   // 3B:76A8 / 3B:76C0
    if (a !== 0x80) return 0;
    sh.sound(0x1D);
    yield* P.showPlayerPicture(sh, 4);
    yield* showCaptionAndWait(sh, m === 7 ? 0x18 : 0x21);
    yield* P.waitPictureTimeout(sh);
    return 0;
  }
  if (m === 6) {                                 // 3B:75CE OutcomeMode6 (3B:7602 after its table)
    if (a === 0x80) {
      if (w0[pf(w, 0x20)] === 1) return yield* holeInOne(sh);
      sh.sound(0x1D);
      yield* P.showPlayerPicture(sh, 4);
      yield* showCaptionAndWait(sh, 0x18);
      yield* P.waitPictureTimeout(sh);
      return 0;
    }
    return yield* byTerrain(sh, rw(0x3B, 0x75E2 + (a & 0x0F) * 2));   // OutcomeMode6ByTerrainTable
  }
  if (r6[0x48E] & 1) addBonus(w, 0x0A);          // skipped on water
  if (a === 0x80) return yield* holed(sh);
  return yield* byTerrain(sh, rw(0x3B, 0x72A3 + (a & 0x0F) * 2));      // OutcomeByTerrainTable
}

// 02:4714 RecordShot: b = 0 birdie / 1 eagle / 2 albatross / 3 hole in one (modes 1-3, a human player, $C878 = 0):
// save block 4 + b (five $80-byte records, the newest first) loaded to WRAM1 $D080 (cleared when it does not load),
// the new record built in $C600 (the player's record, the course, hole, wind, the strokes, the player's stroke records
// $D680) and copied to $D000 before them; the block stored again (no header) and verified
function recordShot(w, b) {
  const w0 = w.wram[0];
  if (![1, 2, 3].includes(w0[0x834]) || w0[pf(w, 0x13)] || w0[0x878]) return;
  w.high[0x196] = 1;
  b = (b + 4) & 0xFF;
  if (Sv.saveBlockLoad(w, b, 0xD080)) w.wram[1].fill(0, 0x080, 0x300);
  w.high[0x196] = 6;
  w0.fill(0, 0x600, 0x680);
  const strokes = w0[pf(w, 0x20)];
  w0.copyWithin(0x600, pf(w, 0), pf(w, 0) + 0x20);
  w0[0x620] = w0[0x836]; w0[0x621] = w0[0x837];
  w0[0x622] = w0[0x815]; w0[0x623] = w0[0x816]; w0[0x624] = w0[0x838];
  w0[0x625] = strokes;
  const slot = 0x680 + (w0[0x835] ? 0x40 : 0);   // 02:4602 ShotRecordSlot
  w0.set(w.wram[6].subarray(slot, slot + 0x40), 0x640);
  w.high[0x196] = 1;
  w.wram[1].set(w0.subarray(0x600, 0x680), 0x000);
  Sv.saveBlockStore(w, b, 0xD000, 0);
  Sv.saveBlockVerify(w, b, 0xD000);
  w.high[0x196] = 6;
}

function* holeInOne(sh) {                        // 3B:733D / 3B:760E
  recordShot(sh.w, 3);
  sh.sound(0x1B);
  yield* P.showPlayerPicture(sh, 0);
  markHoleCleared(sh.w);
  addPoints(sh.w, 0x14);
  yield* P.waitPictureTimeout(sh);
  return 0;
}

function markHoleCleared(w) {                    // 02:5C50 MarkHoleCleared: tournament (mode 1, course 1-5, human)
  const w0 = w.wram[0];
  if (!(w0[0x836] >= 1 && w0[0x836] <= 5 && w0[0x834] === 1 && w0[pf(w, 0x13)] === 0)) return;   // 02:5BEC
  const p = 0x996 + 25 * (w0[0x836] - 1) + (w0[0x837] >> 3);   // 02:5CD3 SetBitN
  w0[p] |= 0x80 >> (w0[0x837] & 7);             // (mask table 02:5CEA: bit 0 is $80)
}

function* holed(sh) {                            // 3B:72C3: the hole's bonus, how it went in, the score against par
  const w = sh.w, r6 = w.wram[6], w0 = w.wram[0];
  addPoints(w, rd16(r6, 0x4F1));
  const start = r6.subarray(0x5F8, 0x5FE);
  if (r6[0x48E] & 4) {                           // off the flagstick
    yield* showCaptionAndWait(sh, 0x28);
    addPoints(w, 0x0A);
  } else if (r6[0x4CD] !== 6) {
    if (w0[pf(w, 0x20)] !== 1) {                 // holed from off the green: 8 from $780 or more, else 6
      yield* showCaptionAndWait(sh, 0x21);
      const far = !((C.shotLength(ball(w), start) - 0x780) & 0x8000);
      addPoints(w, far ? 8 : 6);
    }
  } else if (r6[0x329] === 0x0D) {               // a putt from $280 or more
    if (!((C.shotLength(ball(w), start) - 0x280) & 0x8000)) addPoints(w, 4);
  }
  const strokes = w0[pf(w, 0x20)];
  if (strokes === 1) return yield* holeInOne(sh);
  const d = (strokes - r6[0x325]) & 0xFF;
  const good = { 0x00: [0x1D, 4, 1, 0], 0xFF: [0x1C, 3, 2, 6], 0xFE: [0x1B, 2, 0, 0x0A], 0xFD: [0x1B, 1, 7, 0x10] }[d];
  if (good) {                                    // par (no points), birdie, eagle, albatross
    const [song, pic, cap, pts] = good;
    if (d) recordShot(w, (-d - 1) & 3);          // (birdie 0, eagle 1, albatross 2)
    sh.sound(song);
    yield* P.showPlayerPicture(sh, pic);
    yield* showCaptionAndWait(sh, cap);
    if (d) { markHoleCleared(w); addPoints(w, pts); }
    yield* P.waitPictureTimeout(sh);
    return 0;
  }
  sh.sound(0x1E);                                // 3B:73D4: over par
  if (d === 1) {
    yield* P.showPlayerPicture(sh, 5);
    yield* showCaptionAndWait(sh, 4);
  } else {
    sh.sound(0x1F);
    yield* P.showPlayerPicture(sh, 5);
    yield* showCaptionAndWait(sh, d === 2 ? 6 : (d + 0x29) & 0xFF);
  }
  yield* P.waitPictureTimeout(sh);
  return 0;
}

// the outcome by the terrain the ball stopped on (3B:7411-3B:75CB): the caption picture and the caption
function* byTerrain(sh, addr) {
  const w = sh.w, r6 = w.wram[6];
  const anim = (a, cap) => { startCaptionAnim(sh, a, 0x10, 0x50, 0x34); return showCaptionAndWait(sh, cap); };   // 4F:619C
  switch (addr) {
    case 0x7411:                                 // OutcomeOutOfBounds: a penalty stroke, stroke and distance
      yield* anim(0, 5);
      yield* countStroke(sh);
      return 0xFF;
    case 0x7426:                                 // OutcomeWater: a penalty stroke, back to the last safe spot
      r6[0x485] &= 0xFB;
      yield* sh.advance(0x1E);
      r6[0x485] &= 0xF7;
      yield* anim(1, 0x0C);
      yield* countStroke(sh);
      r6.copyWithin(0x400, 0x51D, 0x523);        // 10:6472 DropAtSafeSpot
      return 0;
    case 0x7447: return yield* green(sh, false);
    case 0x7639: return yield* green(sh, true);  // OutcomeMode6Green
    case 0x7529:                                 // 3B:7529 OutcomeBunker
      yield* sh.advance(0x1E);
      yield* anim((r6[0x446] + 2) & 0xFF, 0x0D);
      return 0;
    case 0x7541: yield* anim((r6[0x446] + 5) & 0xFF, 0x0E); return 0;   // 3B:7541 OutcomeFairway
    case 0x7555: r6[0x485] &= 0xF7; yield* anim(5, 0x0F); return 0;     // OutcomeTerrainA
    case 0x756B: yield* anim((r6[0x446] + 8) & 0xFF, 0x10); return 0;   // 3B:756B OutcomeRough
    case 0x757F: yield* anim(6, 0x12); return 0;                        // 3B:757F OutcomeSemiRough
    case 0x7590: yield* anim(0x0A, 0x11); return 0;                     // OutcomeTerrain5
    case 0x75A1: yield* anim(0x0A, 0x2B); return 0;                     // 3B:75A1 OutcomeTerrainC
    case 0x75B2:                                                        // 3B:75B2 OutcomeTerrainD
      yield* sh.advance(0x1E);
      yield* anim((r6[0x446] + 0x0B) & 0xFF, 0x25);
      return 0;
    case 0x75CA: return 0;                       // OutcomeNoCaption
    default: notPorted(`the outcome 3B:${addr.toString(16)}`);
  }
}

function* green(sh, mode6) {                     // 3B:7447 OutcomeGreen / 3B:7639 OutcomeMode6Green
  const w = sh.w, r6 = w.wram[6], w0 = w.wram[0], s = ball(w);
  const f = pf(w, 0x2B);
  const near = lim => (C.pinDist(s) - lim) & 0x8000;
  const approach = () => r6[0x329] === 0x0D || r6[0x32A] >= 2;
  if (w0[f]) {                                   // a later shot on the green: a long putt near the pin
    if (!((C.shotLength(s, r6.subarray(0x5F8, 0x5FE)) - 0x140) & 0x8000) && near(0x21)) yield* showCaptionAndWait(sh, 9);
    else { if (!mode6) r6[0x485] &= 0xF7; yield* showCaptionAndWait(sh, 0x24); }
    return 0;
  }
  w0[f] = 1;
  if (r6[0x48E] & 2) {                           // off the pin
    yield* showCaptionAndWait(sh, 0x1B);
    if (!mode6) addBonus(w, 4);
    return 0;
  }
  if (mode6) {
    yield* showCaptionAndWait(sh, approach() && near(0x35) ? 0x0B : 0x0A);
    return 0;
  }
  const d = (r6[0x325] - w0[pf(w, 0x20)]) & 0xFF;
  if (d & 0x80 || d === 0) { r6[0x485] &= 0xF7; yield* showCaptionAndWait(sh, 0x24); return 0; }
  if (d >= 3) { yield* showCaptionAndWait(sh, 0x1F); addBonus(w, 2); return 0; }
  if (d === 2 && near(0x21)) { yield* showCaptionAndWait(sh, 0x13); addBonus(w, 2); return 0; }
  yield* showCaptionAndWait(sh, approach() && near(0x35) ? 0x0B : 0x0A);
  return 0;
}

export function* postShot(sh, a) {                // 10:4A82-10:4AEE PostShot (B held for a retry not modelled)
  const w = sh.w, r6 = w.wram[6], w0 = w.wram[0];
  if (w.tasks) w.tasks.taskOn = false;           // 10:4A26: BallTask off
  D.hud(w, "hudDistance");                       // 12:4CA6
  yield* sh.advance();
  if (r6[0x4CD] === 6) w0[pf(w, 0x21)]++;        // a putt
  r6[0x438] &= 0x0F;
  r6[0x4DC] = a;
  w0[pf(w, 0x14)] = a;
  S.meterReset(w);
  if ((yield* outcomeRules(sh, a)) === 0) {      // $FF (out of bounds): the old spot is kept
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
export function* shotSetup(sh) {
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
  if (r6[0x443] === 2) { D.cupViewLeave(w); r6[0x443] = 1; yield* sh.advance(); }   // 13:4528 CupViewLeave
  yield* Cam.snapToGoal(sh);                            // 13:4276
  r6[0x438] = 1;
  V.aimMarker(w);
  yield* sh.advance();
  D.hud(w, "hudDrawLieIcon");                    // 12:45F4
  yield* sh.advance();
  D.hud(w, "hudDistance");                       // 12:4CA6
  yield* sh.advance(2);
  S.meterReset(w);                               // 10:55FF
  yield* sh.advance();
  r6[0x485] = 0x2D;
  r6.copyWithin(0x5F8, 0x400, 0x406);            // 02:4679 KeepShotStart
  r6[0x51C] = w0[pf(w, 0x28)];
  yield* callGolfEventHook(sh, 0);               // 10:484C
  yield* roundHookPlayerUp(sh);                  // 08:4880
  for (let c = 0x1E; c; c--) {
    yield* sh.advance();
    if (w.high[0x194]) break;
  }
  r6[0x485] = 0x3F;
  r6.copyWithin(0x514, 0x400, 0x406);            // 10:550B SaveAddressSpot
  return yield* toAddress(sh, yield* aimMenuLoop(sh, 0));
}

// 10:4868 AimMenu and 10:489D: $FF (the pause menu's Camera Mode, Course Map or Scorecard) loads the hole's info
// and starts the scene again (13:55F6 LoadHoleInfo, 10:4226 GolfSceneStart), then aims again (a = 1)
function* aimMenuLoop(sh, a) {
  const w = sh.w;
  a = yield* A.aimMenu(sh, a);
  while (a === 0xFF) {
    loadHoleInfo(w);
    yield* golfSceneStart(sh);
    yield* sh.advance();
    yield* V.shotViewUpdate(sh);                 // 10:5632
    a = yield* A.aimMenu(sh, 1);
  }
  return a;
}

// 10:4226 GolfSceneStart: GolfViewInit, ShotViewUpdate, wHudBusy off, the fade in (00:258D, c = $7F), golf event 4
export function* golfSceneStart(sh) {
  const w = sh.w;
  golfViewInit(sh);                              // 10:420E
  yield* V.shotViewUpdate(sh);                   // 10:5632
  w.wram[6][0x328] = 0;
  Scr.forceFadeIn(w, 0x7F);
  yield* callGolfEventHook(sh, 4);               // 10:4237
}

// 10:486B-10:48FB: what the aiming menu ended with, up to the address step (true there). The pause menu's Quit
// ($80; $82 the same) ends the round after this hole: wGameMode 0, one hole left, both players holed out, ShotSetup
// returns $81; Give Up ($81) sets the strokes to 3 x par and returns that number (StrokeLimit then picks the ball
// up). ShotSetup's result is the shot's outcome for GolfShotLoop 10:45E7: kept in sh.menuOutcome (false returned).
function* toAddress(sh, a) {
  const w = sh.w, r6 = w.wram[6], w0 = w.wram[0];
  if (a === 0x8F) { sh.menuOutcome = 0x8F; return false; }   // 10:486D: the shot clock ran out: ShotSetup returns $8F
  if (a === 0x82 || a === 0x80) {
    w0[0x834] = 0; w0[0x839] = 1; w0[0x8AA] = 1; w0[0x8EA] = 1;
    sh.menuOutcome = 0x81;
    return false;
  }
  if (a === 0x81) {
    const v = (r6[0x325] * 3) & 0xFF;
    w0[pf(w, 0x20)] = v;
    sh.menuOutcome = v;
    return false;
  }
  if (r6[0x332] < 0x0B && r6[0x329] !== 0x0D && w0[pf(w, 0x13)] !== 3 && !(w0[0x818] & 2)) {
    yield* V.viewLeave(sh);                             // 3B:431F
    D.golferActorTaskStop(w);                    // 04:5801
    initBallCamera(w);                           // 11:476E
    r6[0x438] = 0;
    // (w.reloadViewMaps: a test's patch of 10:48E1's far call to export $10, 13:42A8 ReloadHoleViewMaps)
    yield* (w.reloadViewMaps ? Cam.reloadHoleViewMaps(sh) : V.loadShotView(sh, 4));
  } else {
    r6[0x438] = 1;
    yield* Cam.snapToGoal(sh);
  }
  r6[0x438] = 1;
  if (r6[0x443] !== 4) yield* V.shotViewUpdate(sh);
  return true;
}

// a whole shot as the player plays it: ShotSetup, then AddressBall and the swing (B there goes back to the
// menu: 10:4902-10:491E), the launch and the flight: the outcome (10:4A25)
export function* playShot(sh) {
  yield* shotSetup(sh);
  return yield* addressLoop(sh);
}

export function* addressLoop(sh) {                // from the address step (after ShotSetup) to the outcome
  const r6 = sh.w.wram[6];
  for (;;) {
    sh.mark("address");
    const r = yield* sh.address();
    if (r === 0) return yield* sh.afterSwing();
    if (r6[0x443] === 4) {                       // B: back to the overhead view
      D.behindViewTaskStop(sh.w);                // 15:47B1
      D.golferActorShow(sh);                     // 04:57BA
      D.mapScrollTaskStart(sh.w);                // 04:4062
      yield* V.shotViewUpdate(sh);
      V.hudDrawWind(sh.w);                       // 12:4A81
    }
    yield* sh.advance(5);                               // WaitFramesCmd 5
    if (!(yield* toAddress(sh, yield* aimMenuLoop(sh, 1)))) return sh.menuOutcome;
  }
}
