// Training drills: Stroke Match 1-3 (ids $0C-$0E) and Stroke Practice 1-3 ($0F-$11), bank $0B.
// Port of the tail of net_stroke_0b.asm, stroke_matches_0b.asm and stroke_practice_0b.asm, with the twins
// stroke_practice1_evaluate_result, stroke_practice1_handle_point_end and stroke_practice1_cases2, of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm), whose names these are.
// The framework is in drills.js.
//
// Stroke Match 1: a baseline rally: every ball must land past the service line (TestBallBounceDepth), and the
// hitter must stay behind it (TestCharStateBit4); the first to break a rule loses the point; two points ahead (or
// all square after eight) ends it. Stroke Match 2/3: the receiver must return the serve with a lob (2) or
// keep the server from the net (3).
// Stroke Practice: four returns of the coach's ball into a target area that switches on 90 frames into the point
// (a frame task): plain returns (1, 3) or lobs (2); graded after the fourth.
import { ROM, far, farWait, POINTOUTCOME, SHOTTYPE_LOB, WINLOSE_WIN, WINLOSE_LOSE, MATCHABORT_MATCH, FLAG_Z, hook, auto, at, rb } from "./common.js";
import {
  BANK_0B as B, SignedTable_0b_00, SignedTable_0b_01, judgePoint, byOutcome, ZERO, abortPoint, judgeOn, judgeHooks,
  queueDrillResultMessage, setDrillMessageByServer, setDrillMessageByRallyParity, showQueuedDrillMessage,
  updateDrillAbortCountdown, setDrillTargetZoneForPoint, recordDrillTargetZoneHit, checkDrillTargetZoneMissed,
  resetActiveCharState, testCharStateBit4, loadDrillOpponentBySide, matchJudgedPoint, awardPointToSide,
  showPointsAndEndPoint, drillPointStartCommon, decideByTwoPointLead, practiceHandlePointEnd, counter, setCounter,
  incCounter, DISABLED,
} from "./drills.js";
import { jumpTable } from "./common.js";

const q = queueDrillResultMessage, byServer = setDrillMessageByServer, byParity = setDrillMessageByRallyParity;
const COACH_SIDE = 0x0D, RALLY_OTHER = 0x07;
const MSG_MOVED_PAST_LINE = 0x62, MSG_DIDNT_LAND_PAST_LINE = 0x61, MSG_NO_LOB = 0x40, MSG_NOT_FROM_LINE = 0x46;
const MSG_I_PLAYED_NET = 0x43, MSG_NICE_RETURN = 0x57, MSG_NICE_LOB = 0x58, MSG_TARGET_AREA_3 = 0x5A, MSG_NO_LOB_2 = 0x5B;
const SERVICE_LINE_DEPTH = 0x02A0;           // |depth| of the service lines
const TARGET_ZONE_DELAY = 0x5A;              // frames before a Stroke Practice target area switches on

// ---- Stroke Match 1 ----
// SelectStrokeTargetTableByPoint (0B:668F) / ..Alt (0B:66A2): meant to pick the judgement table by the point's
// parity, but `ld a, $00` before the test makes it always take the first branch: SignedTable_0b_01 (Alt: _00)
const selectStrokeTargetTableByPoint = () => SignedTable_0b_01;
const selectStrokeTargetTableByPointAlt = () => SignedTable_0b_00;
// an outcome case of Stroke Match 1: the message by rally parity, the judgement from the selected table
const strokeOutcome = (msgs, table) => P => {
  const o = P.V.pointOutcome;
  byParity(P, rb(P, at(msgs, o)), RALLY_OTHER);
  return rb(P, at(table(), o));
};
// the hitter stayed behind the service line: TestCharStateBit4 on the last hitter, tested through the flags it
// leaves (with the bit set, those of the message's `add`: never Z, the message being $62 or $69)
function hitterMovedUp(P) {
  byParity(P, MSG_MOVED_PAST_LINE, RALLY_OTHER);
  const fIn = P.V.drillMessageId ? 0 : FLAG_Z;
  return !(testCharStateBit4(P, P.V.lastShotCharIndex, fIn).f & FLAG_Z);
}
// the ball landed past the service line (a ball that hit a player: no judgement)
function ballLandedShort(P) {
  byParity(P, MSG_DIDNT_LAND_PAST_LINE, RALLY_OTHER);
  return !testBallBounceDepth(P);
}
// StrokeMatch1JudgePoint (0B:6505): by rally: 1 the serve's outcome; 2 the return (its first bounce: the hitter's
// spot, its bounce: its depth); then the rally alternates the two sides' cases
function strokeMatch1JudgePoint(P, event) {
  const j = P.V.drillPointJudgement;
  if (j) return j;
  const index = (P.V.rallyLength - 1) & 0xFF;
  const cases = (table, list) => jumpTable(P, B, table, event, list.map(fn => () => fn(P)));
  if (index === 0) return cases(0x6522, [strokeOutcome(0x6549, selectStrokeTargetTableByPoint), ZERO, ZERO, ZERO]);
  if (index === 1) return cases(0x655C, [
    strokeOutcome(0x6583, selectStrokeTargetTableByPointAlt),
    P => { if (P.V.ballBounceCount !== 1) return P.V.ballBounceCount; return hitterMovedUp(P) ? abortPoint(P, WINLOSE_LOSE) : 0; },
    P => { if (P.V.pointOutcome === POINTOUTCOME.BALL_HIT_PLAYER) return 0; return ballLandedShort(P) ? abortPoint(P, WINLOSE_LOSE) : 0; },
    ZERO]);
  if (!(index & 1)) return cases(0x65C2, [
    strokeOutcome(0x65E9, selectStrokeTargetTableByPoint),
    P => (hitterMovedUp(P) ? abortPoint(P, WINLOSE_WIN) : 0),
    P => { if (P.V.pointOutcome === POINTOUTCOME.BALL_HIT_PLAYER) return 0; return ballLandedShort(P) ? abortPoint(P, WINLOSE_WIN) : 0; },
    ZERO]);
  return cases(0x6622, [
    strokeOutcome(0x6649, selectStrokeTargetTableByPointAlt),
    P => (hitterMovedUp(P) ? abortPoint(P, WINLOSE_LOSE) : 0),
    P => { if (P.V.pointOutcome === POINTOUTCOME.BALL_HIT_PLAYER) return 0; return ballLandedShort(P) ? abortPoint(P, WINLOSE_LOSE) : 0; },
    ZERO]);
}
// TestBallBounceDepth (0B:66B5): at the ball's first bounce, 1 when it landed past a service line (|depth| >=
// $2A0), else 0; other bounces: the bounce count
function testBallBounceDepth(P) {
  const n = P.V.ballBounceCount;
  if (n !== 1) return n;
  const depth = P.bus.u16(P.A.ballDepth);
  const abs = depth & 0x8000 ? (-depth) & 0xFFFF : depth;
  return ((abs - SERVICE_LINE_DEPTH) & 0x8000) ? 0 : 1;
}
// StrokeMatch1HandlePointEnd (0B:6489)
function* strokeMatch1HandlePointEnd(P) {
  yield* matchJudgedPoint(P);
  yield* showQueuedDrillMessage(P);
  yield* farWait(P, ROM.UpdatePointStats);
  strokeMatch1AwardPointToSide(P);
  yield* showPointsAndEndPoint(P, false);
}
// StrokeMatch1AwardPointToSide (0B:64C3): the point to the side of the result (no swapping: both serve alike)
function strokeMatch1AwardPointToSide(P) {
  const { V } = P;
  const flag = V.pointWinLoseFlag;
  if (!flag) return;
  if ((((flag + 1) & 0xFF) >> 1)) V.player1PointsWon = (V.player1PointsWon + 1) & 0xFF;
  else V.player2PointsWon = (V.player2PointsWon + 1) & 0xFF;
  V.serveFaultFlag = 0;
  V.totalPointsScoredInCurrentGame = (V.totalPointsScoredInCurrentGame + 1) & 0xFF;
}
// StrokeMatch1Hook_PointEnd (0B:6441): a two-point lead wins (checked every point); after eight, a draw
function* strokeMatch1PointEnd(P) {
  judgeOn(P, strokeMatch1JudgePoint, 0);
  yield* strokeMatch1HandlePointEnd(P);
  if (decideByTwoPointLead(P)) return;
  if (P.V.totalPointsScoredInCurrentGame !== 8) return;
  P.V.pointWinLoseFlag = 0;
  P.V.matchAbortFlag = MATCHABORT_MATCH;
}
// StrokeMatch1Hook_PointStart (0B:642A): the CPU serves without a toss pause
function strokeMatch1PointStart(P) {
  drillPointStartCommon(P);
  P.V.drillMessageId = 0;
  P.V.drillPointJudgement = 0;
  P.V.aiServeSkipToss = 1;
}

// ---- Stroke Match 2 and 3 ----
// StrokeMatch2Cases2 (0B:6892): the serve returned with a lob
function sm2Lob(P) {
  if (!P.V.ballBounceCount) return 0;
  byServer(P, MSG_NO_LOB, COACH_SIDE);
  if (P.V.currentShotType !== SHOTTYPE_LOB) return abortPoint(P, WINLOSE_LOSE);
  return 0;
}
// StrokeMatch2/3Cases3 (0B:68E0, 6B17): the server came in front of the service line: the receiver wins
function smServerAtNet(P) {
  byServer(P, MSG_NOT_FROM_LINE, COACH_SIDE);
  if (!testCharStateBit4(P, (P.V.totalPointsScoredInCurrentGame & 1) ^ 1, 0).a) return abortPoint(P, WINLOSE_WIN);
  return 0;
}
// StrokeMatch2/3JudgePoint (0B:6810, 6A5B)
const strokeMatchJudge = (table, msgs, case2) => (P, event) => judgePoint(P, event, table, [
  [byOutcome(msgs[0], byServer, COACH_SIDE, SignedTable_0b_01), ZERO, ZERO, ZERO],
  [byOutcome(msgs[1], byServer, COACH_SIDE, SignedTable_0b_00), case2, ZERO, ZERO],
  [byOutcome(msgs[2], byServer, COACH_SIDE, SignedTable_0b_01), smServerAtNet, ZERO, ZERO],
  [ZERO, P => { byServer(P, MSG_I_PLAYED_NET, COACH_SIDE); return abortPoint(P, WINLOSE_LOSE); }, ZERO, ZERO],
]);
const strokeMatch2JudgePoint = strokeMatchJudge(0x681C, [0x684E, 0x6888, 0x68D6], sm2Lob);
const strokeMatch3JudgePoint = strokeMatchJudge(0x6A67, [0x6A99, 0x6AD3, 0x6B0D], ZERO);
// StrokeMatch2/3Hook_PointStart (0B:6700, 694B): the coach for the side; a new pair clears counters 1-8
const strokeMatchPointStart = opponents => function* (P) {
  drillPointStartCommon(P);
  yield* loadDrillOpponentBySide(P, opponents);
  P.V.drillMessageId = 0;
  P.V.drillPointJudgement = 0;
  if (P.V.totalPointsScoredInCurrentGame & 1) return;
  for (let n = 1; n <= 8; n++) setCounter(P, n, 0);
};
// StrokeMatch2/3HandlePointEnd (0B:6788, 69D3)
function* strokeMatchHandlePointEnd(P) {
  yield* matchJudgedPoint(P);
  yield* showQueuedDrillMessage(P);
  yield* farWait(P, ROM.UpdatePointStats);
  awardPointToSide(P);
  yield* showPointsAndEndPoint(P, false);
}
// StrokeMatch2/3Hook_PointEnd (0B:6739, 6984): after a pair, a two-point lead wins; after eight, a draw
const strokeMatchPointEnd = judge => function* (P) {
  judgeOn(P, judge, 0);
  yield* strokeMatchHandlePointEnd(P);
  if (P.V.totalPointsScoredInCurrentGame & 1) return;
  if (decideByTwoPointLead(P)) return;
  if (P.V.totalPointsScoredInCurrentGame !== 8) return;
  P.V.pointWinLoseFlag = 0;
  P.V.matchAbortFlag = MATCHABORT_MATCH;
};

// ---- Stroke Practice ----
// StrokePractice1/2/3DrillInit (0B:6B6D, 6DBE, 701E)
const practiceInit = P => { P.V.drillIsPracticeLesson = 1; };
// StrokePractice1-3Hook_PointStart (0B:6B94, 6DE0, 7045): the target area (off until the frame task turns it on),
// the coach's ball aimed by the point
const strokePracticePointStart = (zones, task, aims) => P => {
  drillPointStartCommon(P);
  P.V.targetZoneEnabled = 0;
  setDrillTargetZoneForPoint(P, zones);
  P.V.drillMessageId = 0;
  P.V.drillPointJudgement = 0;
  setCounter(P, 8, TARGET_ZONE_DELAY);
  far(P, ROM.RegisterFrameTask, { a: 1, h: task >> 8, l: task & 0xFF });
  P.V.aiServeAimOverride = rb(P, at(aims, P.V.totalPointsScoredInCurrentGame));
};
// EnableTargetZoneAfterDelayTask (0B:6BD0) / StrokePractice2/3TargetZoneDelayTask (0B:6E1C, 7081): a frame task:
// after the delay, the target area on and the task gone
const targetZoneDelayTask = task => P => {
  const n = (counter(P, 8) - 1) & 0xFF;
  setCounter(P, 8, n);
  if (n) return;
  P.V.targetZoneEnabled = 1;
  far(P, ROM.UnregisterFrameTask, { h: task >> 8, l: task & 0xFF });
};
// StrokePractice1EvaluateResult (0B:6C01; StrokePractice3 0B:70A5): four good returns pass; 1 four or more balls
// out, 2 two or more, 3 none in, 5 three in, 4 otherwise
function strokePractice1EvaluateResult(P) {
  if (counter(P, 2) === 4) { P.V.drillLessonResult = 0; return WINLOSE_WIN; }
  const out = counter(P, 1);
  let r;
  if (out >= 4) r = 1;
  else if (out >= 2) r = 2;
  else if (!counter(P, 2)) r = 3;
  else if (counter(P, 2) === 3) r = 5;
  else r = 4;
  P.V.drillLessonResult = r;
  return WINLOSE_LOSE;
}
// StrokePractice2EvaluateResult (0B:6E40): four lobs pass; 5 three, 1 fewer than four lobs hit at all, then by the
// last rally: 2 a volley, 3 a smash, 4 otherwise
function strokePractice2EvaluateResult(P) {
  const good = counter(P, 7);
  if (good === 4) { P.V.drillLessonResult = 0; return WINLOSE_WIN; }
  let r;
  if (good >= 3) r = 5;
  else if (counter(P, 2) < 4) r = 1;
  else if (P.V.rallyLength < 3 && P.V.shotRecoilVariant === 1) r = 2;
  else if (P.V.rallyLength < 3 && P.V.shotRecoilVariant === 2) r = 3;
  else r = 4;
  P.V.drillLessonResult = r;
  return WINLOSE_LOSE;
}
// StrokePractice1Cases2.checkBallBounceCount (0B:6D73 twin; StrokePractice3 0B:721D) and StrokePractice2's (0B:6FD5):
// the return's first bounce inside the target area
const returnLanded = msg => P => {
  if (P.V.ballBounceCount !== 1) return 0;
  q(P, msg, 0);
  recordDrillTargetZoneHit(P);
  if (checkDrillTargetZoneMissed(P, false).a) return abortPoint(P, WINLOSE_WIN);
  q(P, MSG_TARGET_AREA_3, 0);
  incCounter(P, 3);
  return abortPoint(P, WINLOSE_LOSE);
};
// StrokePractice2Cases2 (0B:6FBB): the return is a lob (counted in wDrillCounters + 2)
function sp2Lob(P) {
  if (!P.V.ballBounceCount) return 0;
  q(P, MSG_NO_LOB_2, 0);
  if (P.V.currentShotType !== SHOTTYPE_LOB) return abortPoint(P, WINLOSE_LOSE);
  incCounter(P, 2);
  return 0;
}
// StrokePractice1-3JudgePoint (0B:6CF5, 6F3D, 719F)
const strokePracticeJudge = (table, msgs, case2, landed) => (P, event) => judgePoint(P, event, table, [
  [byOutcome(msgs[0], q, 0, SignedTable_0b_01), ZERO, ZERO, ZERO],
  [byOutcome(msgs[1], q, 0, SignedTable_0b_00), case2, landed, ZERO],
]);
const strokePractice1JudgePoint = strokePracticeJudge(0x6D01, [0x6D2F, 0x6D69], ZERO, returnLanded(MSG_NICE_RETURN));
const strokePractice2JudgePoint = strokePracticeJudge(0x6F49, [0x6F77, 0x6FB1], sp2Lob, returnLanded(MSG_NICE_LOB));
const strokePractice3JudgePoint = strokePracticeJudge(0x71AB, [0x71D9, 0x7213], ZERO, returnLanded(MSG_NICE_RETURN));
// StrokePractice1Hook_PointEnd (0B:6BE1): a ball out counts (wDrillCounters + 1); graded after four
function* strokePractice1PointEnd(P) {
  judgeOn(P, strokePractice1JudgePoint, 0);
  if (P.V.pointOutcome === POINTOUTCOME.OUT) incCounter(P, 1);
  yield* practiceHandlePointEnd(P, 2);
  if (P.V.totalPointsScoredInCurrentGame < 4) return;
  P.V.pointWinLoseFlag = strokePractice1EvaluateResult(P);
}
// StrokePractice2/3Hook_PointEnd (0B:6E2D, 7092)
const strokePracticePointEnd = (judge, n, evaluate) => function* (P) {
  judgeOn(P, judge, 0);
  yield* practiceHandlePointEnd(P, n);
  if (P.V.totalPointsScoredInCurrentGame < 4) return;
  P.V.pointWinLoseFlag = evaluate(P);
};
// StrokePractice2/3Hook_RallyTick (0B:6E92, 70EE): the coach stops once the player has returned the ball
const practiceRallyTick = P => { if (P.V.rallyLength === 2) resetActiveCharState(P); };

// ---- hooks ----
const H = (addr, fn) => [B, addr, auto(fn)];
export const HOOKS = [
  // Stroke Match 1
  H(0x6420, P => { P.V.scoreboardLayout = 5; }),                                  // StrokeMatch1Hook_MinigameStart
  H(0x6426, updateDrillAbortCountdown),                                           // StrokeMatch1Hook_PerFrame
  H(0x642A, strokeMatch1PointStart),                                              // StrokeMatch1Hook_PointStart
  H(0x6441, strokeMatch1PointEnd),                                                // StrokeMatch1Hook_PointEnd
  H(0x647D, DISABLED),                                                            // StrokeMatch1Hook_RallyTick
  H(0x6481, P => judgeOn(P, strokeMatch1JudgePoint, 2)),                          // StrokeMatch1Hook_Bounce
  H(0x6485, P => judgeOn(P, strokeMatch1JudgePoint, 1)),                          // StrokeMatch1Hook_BallHit
  H(0x6489, strokeMatch1HandlePointEnd),                                          // StrokeMatch1HandlePointEnd
  H(0x64C3, strokeMatch1AwardPointToSide),                                        // StrokeMatch1AwardPointToSide
  ...judgeHooks(strokeMatch1JudgePoint, [0x64E0, 0x64E9, 0x64F2, 0x64FB], [3]),   // StrokeMatch1JudgeOn*
  [B, 0x6505, hook((P, c) => strokeMatch1JudgePoint(P, c.a))],                    // StrokeMatch1JudgePoint
  [B, 0x668F, hook(() => { const t = selectStrokeTargetTableByPoint(); return { hl: t, a: 0, f: FLAG_Z }; })],      // SelectStrokeTargetTableByPoint
  [B, 0x66A2, hook(() => { const t = selectStrokeTargetTableByPointAlt(); return { hl: t, a: 0, f: FLAG_Z }; })],   // SelectStrokeTargetTableByPointAlt
  H(0x66B5, testBallBounceDepth),                                                 // TestBallBounceDepth
  // Stroke Match 2
  H(0x66FB, () => {}),                                                            // StrokeMatch2Hook_MinigameStart
  H(0x66FC, updateDrillAbortCountdown),                                           // StrokeMatch2Hook_PerFrame
  H(0x6700, strokeMatchPointStart(0x6737)),                                       // StrokeMatch2Hook_PointStart
  H(0x6739, strokeMatchPointEnd(strokeMatch2JudgePoint)),                         // StrokeMatch2Hook_PointEnd
  H(0x677C, DISABLED),                                                            // StrokeMatch2Hook_RallyTick
  H(0x6780, P => judgeOn(P, strokeMatch2JudgePoint, 2)),                          // StrokeMatch2Hook_Bounce
  H(0x6784, P => judgeOn(P, strokeMatch2JudgePoint, 1)),                          // StrokeMatch2Hook_BallHit
  H(0x6788, strokeMatchHandlePointEnd),                                           // StrokeMatch2HandlePointEnd
  ...judgeHooks(strokeMatch2JudgePoint, [0x67EB, 0x67F4, 0x67FD, 0x6806], [3]),   // StrokeMatch2JudgeOn*
  [B, 0x6810, hook((P, c) => strokeMatch2JudgePoint(P, c.a))],                    // StrokeMatch2JudgePoint
  // Stroke Match 3
  H(0x6946, () => {}),                                                            // StrokeMatch3Hook_MinigameStart
  H(0x6947, updateDrillAbortCountdown),                                           // StrokeMatch3Hook_PerFrame
  H(0x694B, strokeMatchPointStart(0x6982)),                                       // StrokeMatch3Hook_PointStart
  H(0x6984, strokeMatchPointEnd(strokeMatch3JudgePoint)),                         // StrokeMatch3Hook_PointEnd
  H(0x69C7, DISABLED),                                                            // StrokeMatch3Hook_RallyTick
  H(0x69CB, P => judgeOn(P, strokeMatch3JudgePoint, 2)),                          // StrokeMatch3Hook_Bounce
  H(0x69CF, P => judgeOn(P, strokeMatch3JudgePoint, 1)),                          // StrokeMatch3Hook_BallHit
  H(0x69D3, strokeMatchHandlePointEnd),                                           // StrokeMatch3HandlePointEnd
  ...judgeHooks(strokeMatch3JudgePoint, [0x6A36, 0x6A3F, 0x6A48, 0x6A51], [3]),   // StrokeMatch3JudgeOn*
  [B, 0x6A5B, hook((P, c) => strokeMatch3JudgePoint(P, c.a))],                    // StrokeMatch3JudgePoint
  // Stroke Practice 1
  H(0x6B6D, practiceInit),                                                        // StrokePractice1DrillInit
  H(0x6B83, P => { P.V.drillIsPracticeLesson = 1; setCounter(P, 2, 0); setCounter(P, 1, 0); }),   // StrokePractice1Hook_MinigameStart
  H(0x6B90, updateDrillAbortCountdown),                                           // StrokePractice1Hook_PerFrame
  H(0x6B94, strokePracticePointStart(0x6C5F, 0x6BD0, 0x6BCC)),                    // StrokePractice1Hook_PointStart
  H(0x6BD0, targetZoneDelayTask(0x6BD0)),                                         // EnableTargetZoneAfterDelayTask
  H(0x6BE1, strokePractice1PointEnd),                                             // StrokePractice1Hook_PointEnd
  H(0x6C01, strokePractice1EvaluateResult),                                       // StrokePractice1EvaluateResult
  H(0x6C4A, DISABLED),                                                            // StrokePractice1Hook_RallyTick
  H(0x6C4E, P => judgeOn(P, strokePractice1JudgePoint, 2)),                       // StrokePractice1Hook_Bounce
  H(0x6C52, P => { judgeOn(P, strokePractice1JudgePoint, 1); if (P.V.rallyLength === 1) resetActiveCharState(P); }),   // StrokePractice1Hook_BallHit
  H(0x6C81, P => practiceHandlePointEnd(P, 2)),                                   // StrokePractice1HandlePointEnd
  ...judgeHooks(strokePractice1JudgePoint, [0x6CD0, 0x6CD9, 0x6CE2, 0x6CEB], [3]),   // StrokePractice1JudgeOn*
  [B, 0x6CF5, hook((P, c) => strokePractice1JudgePoint(P, c.a))],                 // StrokePractice1JudgePoint
  // Stroke Practice 2
  H(0x6DBE, practiceInit),                                                        // StrokePractice2DrillInit
  H(0x6DD4, P => { setCounter(P, 2, 0); setCounter(P, 7, 0); }),                  // StrokePractice2Hook_MinigameStart
  H(0x6DDC, updateDrillAbortCountdown),                                           // StrokePractice2Hook_PerFrame
  H(0x6DE0, strokePracticePointStart(0x6EA7, 0x6E1C, 0x6E18)),                    // StrokePractice2Hook_PointStart
  H(0x6E1C, targetZoneDelayTask(0x6E1C)),                                         // StrokePractice2TargetZoneDelayTask
  H(0x6E2D, strokePracticePointEnd(strokePractice2JudgePoint, 7, strokePractice2EvaluateResult)),   // StrokePractice2Hook_PointEnd
  H(0x6E40, strokePractice2EvaluateResult),                                       // StrokePractice2EvaluateResult
  H(0x6E92, practiceRallyTick),                                                   // StrokePractice2Hook_RallyTick
  H(0x6E9F, P => judgeOn(P, strokePractice2JudgePoint, 2)),                       // StrokePractice2Hook_Bounce
  H(0x6EA3, P => judgeOn(P, strokePractice2JudgePoint, 1)),                       // StrokePractice2Hook_BallHit
  H(0x6EC9, P => practiceHandlePointEnd(P, 7)),                                   // StrokePractice2HandlePointEnd
  ...judgeHooks(strokePractice2JudgePoint, [0x6F18, 0x6F21, 0x6F2A, 0x6F33], [3]),   // StrokePractice2JudgeOn*
  [B, 0x6F3D, hook((P, c) => strokePractice2JudgePoint(P, c.a))],                 // StrokePractice2JudgePoint
  // Stroke Practice 3
  H(0x701E, practiceInit),                                                        // StrokePractice3DrillInit
  H(0x7034, P => { P.V.drillIsPracticeLesson = 1; setCounter(P, 2, 0); setCounter(P, 1, 0); }),   // StrokePractice3Hook_MinigameStart
  H(0x7041, updateDrillAbortCountdown),                                           // StrokePractice3Hook_PerFrame
  H(0x7045, strokePracticePointStart(0x7109, 0x7081, 0x707D)),                    // StrokePractice3Hook_PointStart
  H(0x7081, targetZoneDelayTask(0x7081)),                                         // StrokePractice3TargetZoneDelayTask
  H(0x7092, strokePracticePointEnd(strokePractice3JudgePoint, 2, strokePractice1EvaluateResult)),   // StrokePractice3Hook_PointEnd
  H(0x70A5, strokePractice1EvaluateResult),                                       // StrokePractice3EvaluateResult
  H(0x70EE, practiceRallyTick),                                                   // StrokePractice3Hook_RallyTick
  H(0x70FB, P => judgeOn(P, strokePractice3JudgePoint, 2)),                       // StrokePractice3Hook_Bounce
  H(0x70FF, P => judgeOn(P, strokePractice3JudgePoint, 1)),                       // StrokePractice3Hook_BallHit
  H(0x712B, P => practiceHandlePointEnd(P, 2)),                                   // StrokePractice3HandlePointEnd
  ...judgeHooks(strokePractice3JudgePoint, [0x717A, 0x7183, 0x718C, 0x7195], [3]),   // StrokePractice3JudgeOn*
  [B, 0x719F, hook((P, c) => strokePractice3JudgePoint(P, c.a))],                 // StrokePractice3JudgePoint
];
void q;
