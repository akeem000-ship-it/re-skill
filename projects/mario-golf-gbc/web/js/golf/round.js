// The round and the hole set-up (GolfRound 10:4451): the round start, then per hole the wind, the hole's data
// from the ROM (HoleIdFromCourse, LoadHoleInfo), the players at the tee, the intro fly-over's state changes,
// the first player picked and ShotSetup up to the address step (hole.js). Display work (HUD, sprites, VRAM,
// palettes, sound, the camera's position) is left out; the course and green maps come from Hole (ball.js).
import { rb, rw } from "./rom.js";
import * as g from "./math.js";
import { Hole } from "./ball.js";
import { ball, rd16, wr16, playerField as pf } from "./memory.js";
import { pinDist } from "./cup.js";
import { loadShotView, shotViewUpdate } from "./view.js";
import * as H from "./hole.js";
import * as Cam from "./camera.js";
import * as Scr from "./screen.js";
import { clearFrameTasks } from "./tasks.js";
import * as D from "./render/hooks.js";

export function advanceRandomSeed(w) {           // 00:0A61 AdvanceRandomSeed: seed ($FFFC) = seed x 5 + $3573
  const seed = w.high[0x1FC] | w.high[0x1FD] << 8;
  const v = (seed * 5 + 0x3573) & 0xFFFF;
  w.high[0x1FC] = v & 0xFF; w.high[0x1FD] = v >> 8;
  return v;
}

const mode = w => w.wram[0][0x834];             // wGameMode
function notPorted(what) { throw new Error(`${what} is not ported`); }

// ---- the round start: 10:4451-10:44B1 ----
export function* golfRoundStart(sh, roundId) {    // 10:4451 GolfRound up to the per-hole loop
  const w = sh.w, w0 = w.wram[0], r6 = w.wram[6];
  r6[0x4F0] = roundId;
  if (roundId !== 0xFF) {
    w0[0x839] = roundId;                         // wHolesLeft
    w0[0x833] = roundId;                         // wRoundId
    w0[0x96D] = 1;                               // wReplayActive
    w0[0x814] = 0;
    roundHookRoundStart(w, id => sh.sound(id));  // 08:4722
    w0[0x83C] = w0[0x83D] = 0;                   // 02:540A ClearPoints
    if (w0[0x890] === w0[0x8D0]) w0[0x8D9] |= 0x10;
  } else {                                       // continuing a saved round
    w0[0x8A8] = w0[0x896];
    w0[0x8E8] = w0[0x8D6];
    w0[0x873] = w0[0x874];
    w0[0x8BE] = w0[0x876];
    w0[0x8FE] = w0[0x877];
  }
  yield* initWindowSystem(sh);                          // 05:407A
  resetPlayersForHole(w);                        // 10:405C
  w0[0x835] = 0;                                 // wCurPlayer
  w0[0x2A6] = 0;
}

function* initWindowSystem(sh) {                  // 05:407A InitWindowSystem: clears WRAM5 over 4 frames, frees the windows
  const w = sh.w, r5 = w.wram[5];
  for (let k = 0; k < 4; k++) { r5.fill(0, 0x400 * k, 0x400 * k + 0x400); yield* sh.advance(); }
  for (let k = 0; k < 6; k++) r5[0x802 + 4 * k] = 3;   // wWindowSlots
  r5[0x83E] = 0xFF;                              // wMenuStackDepth
  r5[0x824] = 0xFF;                              // wMessageWindow
  r5[0x84D] = 0x80;                              // wWindowAttr
  w.wram[0].fill(0, 0x3F9, 0x3FD);               // 41:707C ClearMenuState
}

function roundHookRoundStart(w, sound) {         // 08:4722 RoundHookRoundStart (DispatchByGameMode 08:470D)
  const w0 = w.wram[0];
  switch (mode(w)) {
    case 1: notPorted("the tournament round start (~08:475F)"); break;
    case 2:                                      // 08:478C RoundStartMode2Match
      w0[0x83A] = w0[0x83B] = 0;
      w0.fill(0, 0x96E, 0x96E + 0x12);
      clearContestWins(w);
      w0[0x96C] = 0;
      break;
    case 3:                                      // 08:47A6 RoundStartMode3Stroke
      sound(0x38);
      w0[0x83B] = 0;                             // 08:4617 ClearHonour
      if (w0[0x8D0] !== 0xFF) clearContestWins(w);
      break;
    default: break;
  }
}

// 08:5062 PlayRoundMusic: only in a round (wReplayActive $C96D); the round's song $C82C, else by mode (8: 5, 4: 7),
// the decisive hole ($2A), the opponent's song (08:50D6 by $C8D0, not in link play) or the course's (08:50C6)
export function playRoundMusic(sh) {
  const w0 = sh.w.wram[0];
  if (!w0[0x96D]) return;
  if (w0[0x82C]) return sh.sound(w0[0x82C]);    // 00:2C19 PlaySoundManaged
  const m = w0[0x834];
  if (m === 8) return sh.sound(0x05);
  if (m === 4) return sh.sound(0x07);
  if (w0[0x832]) return sh.sound(0x2A);
  if (!w0[0x33F] && w0[0x8D0] !== 0xFF) {
    const s = rb(0x08, 0x50D6 + (w0[0x8D0] & 0x0F));
    if (s) return sh.sound(s);
  }
  sh.sound(rb(0x08, 0x50C6 + (w0[0x836] & 0x0F)));
}

function clearContestWins(w) {                   // 08:4203 ClearContestWins
  const w0 = w.wram[0];
  w0[0x897] = w0[0x898] = w0[0x8D7] = w0[0x8D8] = 0;
}

export function resetPlayersForHole(w) {         // 10:405C ResetPlayersForHole
  const w0 = w.wram[0], r6 = w.wram[6];
  for (const a of [0x8E0, 0x8A1, 0x8E1, 0x8AA, 0x8EA, 0x8AB, 0x8EB, 0x895, 0x8D5]) w0[a] = 0;
  w0[0x8A0] = r6[0x4EF];                         // wP1StartStrokes
  w0[0x8A9] = r6[0x4E3] & 1;                     // wP1OffTee
  w0[0x8BF] = (r6[0x4E3] >> 4) & 3;
  w0[0x8E9] = w0[0x8FF] = 0;
  if (w0[0x8D0] === 0xFF) w0[0x8EA] = w0[0x8EB] = 1;   // no player 2: holed out
}

export function placeBallsAtTee(w) {             // 10:40AC PlaceBallsAtTee: both players' balls and the ball
  const w0 = w.wram[0], r6 = w.wram[6];
  for (const o of [0x8A2, 0x8E2]) {
    w0[o] = 0; w0[o + 1] = r6[0x439]; w0[o + 2] = r6[0x43A];
    w0[o + 3] = 0; w0[o + 4] = r6[0x43B]; w0[o + 5] = r6[0x43C];
  }
  r6[0x400] = 0; r6[0x401] = r6[0x439]; r6[0x402] = r6[0x43A];
  r6[0x403] = 0; r6[0x404] = r6[0x43B]; r6[0x405] = r6[0x43C];
}

export function holeIdFromCourse(w) {            // 10:4246 HoleIdFromCourse: CourseHoleIdTable 10:4265
  const w0 = w.wram[0];
  const list = rw(0x10, (0x4265 + ((w0[0x836] * 2) & 0xFF)) & 0xFFFF);
  w.wram[6][0x320] = rb(0x10, (list + ((w0[0x837] - 1) & 0xFF)) & 0xFFFF);
}

export function loadHoleInfo(w) {                // 13:55F6 LoadHoleInfo: HoleInfoTable 13:5884, 32 bytes per hole id
  const r6 = w.wram[6], w0 = w.wram[0];
  let p = (0x5884 + r6[0x320] * 32) & 0xFFFF;
  const next = () => rb(0x13, p++);
  r6[0x325] = next();                            // wHolePar
  p += 3;
  r6[0x323] = next(); r6[0x324] = next();        // wHoleYards
  for (let k = 0; k < 4; k++) w0[0x329 + k] = next();   // wMapBounds
  r6[0x441] = next(); r6[0x442] = next();        // wGreenCornerX / Y
  for (let k = 0; k < 4; k++) r6[0x439 + k] = next();   // wTeeSpot
  p += 4 * w0[0x838];                            // the pin position by wWindDir
  for (let k = 0; k < 4; k++) r6[0x43D + k] = next();   // wCupX / wCupY
  if (r6[0x4DE]) r6.copyWithin(0x439, 0x4DF, 0x4E3);    // wForcedTee
  const t = (0x5684 + (w0[0x836] & 0x0F) * 32) & 0xFFFF;   // CourseTreeWidthTable 13:5684 -> wTreeWidth
  for (let k = 0; k < 32; k++) r6[0x4F3 + k] = rb(0x13, t + k);
}

export function selectPlayer(w, p) {             // 10:46D9 SelectPlayer1 / 10:46EE SelectPlayer2
  const w0 = w.wram[0], r6 = w.wram[6];
  const rec = p ? 0x8C0 : 0x880;
  const ownBall = p ? 0x8E2 : 0x8A2;
  const otherTeed = p ? w0[0x8A9] : w0[0x8E9];
  const other = p ? 0x8A3 : 0x8E3;
  const src = k => (otherTeed ? w0[other + k] : rb(0x10, 0x4771 + k));   // NoOtherBallPosData 10:4771
  w0[0x835] = p;
  r6.set(w0.subarray(ownBall, ownBall + 6), 0x400);
  r6[0x406] = r6[0x407] = r6[0x408] = 0;
  r6[0x41E] = src(0); r6[0x41F] = src(1); r6[0x420] = src(3); r6[0x421] = src(4);
  r6.fill(src(4), 0x409, 0x40F);
  wr16(r6, 0x4C6, rd16(w0, rec + 0x1A));         // wDriverDistance
  r6[0x4CA] = w0[rec + 0x1D];
  r6[0x4C8] = w0[rec + 0x1C];
  r6[0x4C9] = w0[rec + 0x1E];
  r6[0x4CB] = w0[rec + 0x1F];
  r6[0x4CC] = w0[rec + 0x19];
  r6[0x4D7] = w0[rec + 0x13];
}

function awayBias(w, hl) {                       // 10:46B5 AwayBiasField2B and 10:46C7 AwayBiasOnTee
  if (!w.wram[0][pf(w, 0x2B)]) hl = (hl + 0x0C80) & 0xFFFF;
  if (!w.wram[0][pf(w, 0x29)]) hl = (hl + 0x3200) & 0xFFFF;
  return hl;
}

export function pickNextPlayer(w) {              // 10:4674 PickNextPlayer: the farther from the pin plays
  const w0 = w.wram[0];
  if (w0[0x8EA]) return selectPlayer(w, 0);
  if (w0[0x8AA]) return selectPlayer(w, 1);
  const b = w0[0x835];
  selectPlayer(w, 0);
  const d1 = awayBias(w, pinDist(ball(w)));
  selectPlayer(w, 1);
  const d2 = awayBias(w, pinDist(ball(w)));
  const hl = (d2 - d1) & 0xFFFF;
  if (hl === 0) { if ((b ^ 1) === 0) selectPlayer(w, 0); }   // a tie: the other one than before
  else if (hl & 0x8000) selectPlayer(w, 0);
}

// the wind for the hole (10:4516-10:455D): direction rand & 3 (or $D4EE), speed rand x 20 / 65536 mph, angle the
// top nibble of the next random byte; none on course 0; $D4E4 forces it
export function holeWind(w) {
  const w0 = w.wram[0], r6 = w.wram[6];
  const a = r6[0x4F0];
  r6[0x4F0] = 0;
  if (a === 0xFF) return;
  w0[0x838] = advanceRandomSeed(w) >> 8 & 3;     // wWindDir
  if (r6[0x4ED]) w0[0x838] = r6[0x4EE];          // wForcedWindDir
  const d = g.mulHLByAFrac(advanceRandomSeed(w), 0x14) >> 8;
  let hl = ((advanceRandomSeed(w) >> 8) & 0xF0) << 8 | d;
  if (!w0[0x836]) hl = 0x4000;
  if (r6[0x4E4]) { hl = rd16(r6, 0x4E5); hl = (hl & 0xFF00) | ((hl << 1) & 0xFF); }   // wForcedWind (sla l)
  w0[0x815] = hl & 0xFF; w0[0x816] = hl >> 8;    // 10:40F8 SetWind
}

// 08:6432 HoleIntroFlyover (modes 1-3): the green view for 180 frames (or until a button), then the course view
// and the camera's pan from the pin to the ball (until it gets there, or a button)
function* holeIntroFlyover(sh) {
  const w = sh.w, r6 = w.wram[6];
  if (![1, 2, 3].includes(mode(w))) notPorted("the hole start of other modes (~08:64B1)");
  r6[0x445] = 1;                                 // wTeeShot
  r6[0x4D5] = 0; r6[0x454] = 0; r6[0x44F] = 0; r6[0x450] = 0x80;
  golfViewInit(sh);                              // 10:420E
  yield* loadShotView(sh, 1);
  Scr.forceFadeIn(w, 0x7F);
  r6[0x328] = 0;
  for (let c = 0xB4; c; c--) {
    yield* sh.advance();
    if (w.high[0x194]) { sh.sound(0x5C); break; }   // a button: on at once (08:6480)
  }
  r6[0x438] = 4;
  yield* loadShotView(sh, 0);
  r6[0x438] = 1;
  yield* sh.advance(10);                                // WaitFramesCmd 10
  for (;;) {
    yield* sh.advance();
    if (w.high[0x194]) { sh.sound(0x5C); yield* Cam.snapToGoal(sh); return; }   // 08:64AB; 13:4276 SnapCameraToGoal
    if (Cam.atGoal(w)) return;                   // 11:41F7 CameraAtGoal
  }
}

function golfViewInit(sh) {                      // 10:420E GolfViewInit
  const w = sh.w, r6 = w.wram[6];
  clearFrameTasks(w);                            // 00:23B6 ClearFrameTasks
  D.resetSprites(w);                             // 00:2683 ResetSprites
  D.hudInit(sh);                                 // 12:442C HudInit (registers the HUD task 12:449F)
  r6[0x44D] = 0xF0;
  r6[0x328] = 1;                                 // wHudBusy
  D.mapScrollTaskStart(w);                       // 04:4062 MapScrollTaskStart
  sh.t.displayOn = true;                         // 11:4103 BallDisplayStart
  D.golferActorShow(sh);                         // 04:57BA GolferActorShow
  r6[0x443] = 0xFF;                              // no view yet
}

function* strongWindIntro(sh) {                   // 12:6F8D StrongWindIntro: wind of 12 mph or more, a gust sprite
  if (sh.w.wram[0][0x815] < 0x0C) return;
  yield* sh.advance();
  sh.sound(0x9C);                                // 12:6FAA
  yield* sh.advance(0x3D);                              // (the sprite crosses the screen; display)
}

function roundHookHoleStart(w) {                 // 08:47FD RoundHookHoleStart
  const w0 = w.wram[0];
  switch (mode(w)) {
    case 2: notPorted("the match-play hole start (~08:4847)"); break;
    case 3:                                      // 08:483B HoleStartMode3Stroke
      setTeeOrderByHonour(w);
      if (w0[0x8D0] !== 0xFF) initHoleContest(w);
      break;
    default: break;
  }
}

function setTeeOrderByHonour(w) {                // 08:461C SetTeeOrderByHonour
  const w0 = w.wram[0];
  if (w0[0x8D0] === 0xFF) { w0[0x835] = 0; return; }
  if (w0[0x837] === 1) { w0[0x835] = 1; return; }   // hole 1: player 2 tees off first
  const h = (w0[0x837] - 2) & 0xFF;
  const d = w0[(0x8AC + h) & 0xFFF] & 0x0F, e = w0[(0x8EC + h) & 0xFFF] & 0x0F;
  if (e !== d) w0[0x83B] = e < d ? 1 : 0;
  w0[0x835] = w0[0x83B] ^ 1;
}

function initHoleContest(w) {                    // 08:420F InitHoleContest (captions left out)
  const r6 = w.wram[6];
  r6.fill(0, 0x494, 0x498);
  r6[0x498] = 0;
  const contest = r6[0x325] === 3 ? 0x1900 : r6[0x325] === 5 ? 0 : null;
  if (contest !== null) {                        // 08:4244 SetContestLeader
    r6[0x491] = 0xFF;
    wr16(r6, 0x48F, contest);
  }
}

// ---- one hole up to the first address step: 10:44B4-10:45E4 and ShotSetup ----
export function* holeStart(sh) {
  const w = sh.w, w0 = w.wram[0], r6 = w.wram[6];
  sh.mark("hole");
  r6[0x485] = 1;                                 // wBallObjectFlags
  r6[0x4F1] = r6[0x4F2] = 0;                     // wHoleBonus
  w0[0x896] = w0[0x8A8];
  w0[0x8D6] = w0[0x8E8];
  w0[0x874] = w0[0x873];
  w0[0x876] = w0[0x8BE];
  w0[0x877] = w0[0x8FE];
  if (w0[0x893] === 3) notPorted("link play (~10:44EA)");
  holeWind(w);
  if (w0[0x8D3] === 3) notPorted("link play (~10:4567)");
  playRoundMusic(sh);                            // 08:5062
  holeIdFromCourse(w);                           // 10:4246
  loadHoleInfo(w);                               // 13:55F6
  resetPlayersForHole(w);
  placeBallsAtTee(w);
  selectPlayer(w, 0);
  r6[0x329] = r6[0x32A] = r6[0x32B] = 0;         // wClub, wShotMode
  r6[0x445] = 1;                                 // wTeeShot
  r6[0x321] = rb(0x10, 0x6907);                  // (a code byte: the first of MissTable 10:6907)
  // ~08:47B4 RoundHookSaveAtHole: modes 1-3 save the game mid-round (SRAM; not modelled)
  if (w0[0x870]) notPorted("golf event hooks (~10:4CC3)");
  sh.hole = new Hole(r6[0x320]);
  sh.mark("flyover");
  yield* holeIntroFlyover(sh);
  sh.mark("windintro");
  yield* strongWindIntro(sh);
  roundHookHoleStart(w);
  yield* nextShot(sh);
  return sh.hole;
}

// ---- between shots and holes: GolfShotLoop 10:45E7-10:4673 ----
export function* strokeLimit(sh, a) {             // 10:4134 StrokeLimit: 3 x par strokes picks the ball up
  const w = sh.w;
  if (a === 0x80) return a;
  const m = mode(w);
  if (m === 0 || m === 4) return a;
  const r6 = w.wram[6], w0 = w.wram[0];
  const d = (r6[0x325] * 3) & 0xFF;
  const f = pf(w, 0x20);
  if (w0[f] < d) return a;
  w0[f] = d;
  yield* sh.advance();                                  // 10:4786 HudRedrawCurPlayer
  r6[0x485] &= 0xEF;
  r6[0x48E] |= 0x80;
  if (!r6[0x443]) yield* loadShotView(sh, 1);           // 3B:76D8 StrokeLimitPickUp
  r6[0x443] = 0xFF;
  sh.sound(0x1F);                                // 3B:76E8 (its picture and caption waits are not modelled)
  return 0x81;
}

// 10:45E7-10:4632 after a shot's PostShot: true when every player has holed out
export function* afterShot(sh, a) {
  const w = sh.w, w0 = w.wram[0], r6 = w.wram[6];
  r6[0x438] = 0;
  a = yield* strokeLimit(sh, a);
  if (a & 0x80) {                                // holed, picked up or out of bounds ($FF)
    w0[pf(w, 0x2A)] = w0[pf(w, 0x2B)] = 1;
    w0.fill(0, pf(w, 0x22), pf(w, 0x28));
    H.scorecard(w);                              // 10:4101
  }
  roundHookAfterShot(w);                         // 08:4901
  if (w0[0x870]) notPorted("golf event hooks (~10:4CC3)");
  yield* sh.advance();                                  // (after ~4A:629C PictureCycleStop: display)
  if (r6[0x4DD]) notPorted("the golf event flag $D4DD (~08:4AA3 RetryShotRestore, ~10:464A)");
  // ~12:4F1D ShotLengthTaskStop (display)
  return !!(w0[0x8AA] && w0[0x8EA]);
}

function roundHookAfterShot(w) {                 // 08:4901 RoundHookAfterShot
  switch (mode(w)) {
    case 1: notPorted("the tournament's shot statistics (~08:441A)"); break;
    case 2: notPorted("the match-play hole result (~08:494B)"); break;
    case 3: if (w.wram[0][0x8D0] !== 0xFF) notPorted("the two-player contest (~08:4250)"); break;   // 08:4942
    case 4: notPorted("the training retry menu (~08:4A39)"); break;
    default: break;
  }
}

// 10:45D9-10:45E4: the next player, the view, ShotSetup up to the address step
export function* nextShot(sh) {
  const w = sh.w;
  sh.mark("pick");
  pickNextPlayer(w);
  w.wram[6][0x438] = 1;
  yield* shotViewUpdate(sh);
  sh.mark("shotsetup");
  yield* H.shotSetup(sh);
}

// 10:4635-10:4647 the hole is over: true when another hole follows (then holeStart)
export function holeEnd(w) {
  const w0 = w.wram[0];
  roundHookHoleEnd(w);                           // 08:4B02
  w0[0x837] = (w0[0x837] + 1) & 0xFF;            // wHoleNumber, 18 -> 1
  if (w0[0x837] >= 0x13) w0[0x837] = 1;
  w0[0x839] = (w0[0x839] - 1) & 0xFF;            // wHolesLeft
  return w0[0x839] !== 0;
}

function roundHookHoleEnd(w) {                   // 08:4B02 RoundHookHoleEnd
  const w0 = w.wram[0];
  switch (mode(w)) {
    case 1: notPorted("the tournament's hole end (~08:4B3F)"); break;
    case 2: notPorted("the match-play hole end (~08:4B64)"); break;
    case 3:                                      // 08:4B93 HoleEndMode3Stroke
      if (w0[0x8D0] !== 0xFF) notPorted("the two-player contest totals (~08:432F)");
      w0[0x4BD] = 1;                             // wStandingsPhase (~0E:43D6 ShowScorecard: display)
      // ~08:4F75 ShowHalfwayPicture: display
      if (w0[0x837] >= 0x11 && w0[0x8D0] !== 0xFF) w0[0x832] = 1;   // 08:4BAA SetDecisiveHoleOnLast
      break;
    default: break;
  }
}

// 10:464A-10:4673 the round is over
export function roundEnd(w) {
  const w0 = w.wram[0], r6 = w.wram[6];
  r6[0x328] = 1;                                 // wHudBusy
  w0[0x96D] = 0;                                 // wReplayActive
  if (w0[0x33F]) notPorted("link play (~10:4659)");
  switch (mode(w)) {                             // 08:4BBC RoundHookRoundEnd
    case 3:                                      // 08:4EBF RoundEndMode3Stroke
      if (w0[0x8D0] !== 0xFF) {
        const b = (w0[0x8BE] + 0x36) & 0xFF, c = (w0[0x8FE] + 0x36) & 0xFF;
        w0[0x96C] = c === b ? 3 : c < b ? 2 : 1;   // wRoundResult (~0B:59DE RoundResultScreen: display)
      }
      addPointsRaw(w, 0x0A);
      notPorted("the EXP award after the round (~08:4F03 RoundEndFadeAndExp)");
      break;
    case 4: case 5: case 0x0A: case 0x0B: break;   // 08:4EF2 / 08:4EF3
    default: notPorted(`the round end of mode ${mode(w)} (~08:4BBC)`);
  }
}

function addPointsRaw(w, de) {                   // 02:5415 AddPointsRaw: $C83C += de x course factor (02:543E) / 2
  const w0 = w.wram[0];
  const f = rb(0x02, 0x543E + (w0[0x836] & 0x0F));
  wr16(w0, 0x83C, (rd16(w0, 0x83C) + (g.mulHLByA(de, f) >> 1)) & 0xFFFF);
}
