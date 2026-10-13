// Training drills: Net Game Match 1-3 (ids $06-$08) and Net Game Practice 1-3 ($09-$0B), bank $0B.
// Port of net_matches_0b.asm, net_practice_0b.asm and the head of net_stroke_0b.asm, with the twin
// net_game_practice1_handle_point_end, of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm), whose names these are. The framework is in drills.js.
//
// Net Game Match: points where the server must come to the net: the serve (rally 1) judged by its outcome, then
// rally 3 — the server's first volley — must be hit from in front of the service line (TestCharStateBit4) and as
// a volley (Match 1: wShotRecoilVariant 1) or a smash (Match 2: 2; Match 2's receiver must lob first); rally 5
// hitting the ball is "you didn't score". The coach serves every other point (a "serving" coach character).
// Match 1 is won by being ahead after a pair of points, Match 2 and 3 by two points (all square after eight: none).
// Net Game Practice: four points at the net: volleys into a target area (1), a long serve then a lob answered
// with a smash (2), a long serve then a drop shot at the net (3); graded after the fourth.
import { ROM, farWait, POINTOUTCOME, SHOTTYPE_LOB, SHOTTYPE_SMASH, SHOTTYPE_DROP, DRILLMSG_HIDE, WINLOSE_WIN, WINLOSE_LOSE, MATCHABORT_MATCH, hook, auto, at, rb } from "./common.js";
import {
  BANK_0B as B, SignedTable_0b_00, SignedTable_0b_01, judgePoint, byOutcome, ZERO, abortPoint, judgeOn, judgeHooks,
  queueDrillResultMessage, showQueuedDrillMessage, updateDrillAbortCountdown, setDrillTargetZoneForPoint,
  recordDrillTargetZoneHit, checkDrillTargetZoneMissed, countDrillResultBitsSet, resetActiveCharState, testCharStateBit4,
  loadDrillOpponentChar, loadDrillOpponentBySide, matchJudgedPoint, awardPointToSide, showPointsAndEndPoint,
  drillPointStartCommon, decideByTwoPointLead, practiceHandlePointEnd, counter, setCounter, incCounter, DISABLED,
} from "./drills.js";

const q = queueDrillResultMessage;
const COACH_SIDE = 0x0D;                     // the coach's wording of a Net Game message: + $0D
// drill messages
const MSG_NO_NET = 0x1B, MSG_NO_SMASH = 0x1C, MSG_NO_SCORE = 0x1D, MSG_NO_VOLLEY = 0x1F, MSG_I_DIDNT_LOB = 0x18;
const MSG_NO_NET_2 = 0x35, MSG_NO_SMASH_2 = 0x36, MSG_NO_DROP = 0x39, MSG_NO_VOLLEY_2 = 0x3A, MSG_LONG_SERVE = 0x3B;
const MSG_NICE_VOLLEY = 0x2E, MSG_TARGET_AREA_2 = 0x38, MSG_I_DIDNT_LOB_2 = 0x32;
const VOLLEY = 1, SMASH_RECOIL = 2;          // wShotRecoilVariant: how the last ball was struck
const CHAR_DRILL_NET_GAME_PRACTICE_1 = 0x40, CHAR_DRILL_NET_GAME_PRACTICE_2 = 0x41, CHAR_DRILL_NET_GAME_PRACTICE_3 = 0x42;
const serverFront = P => testCharStateBit4(P, P.V.totalPointsScoredInCurrentGame & 1, 0).a;   // the server at the net
const playerFront = P => testCharStateBit4(P, 0, 0).a;
// rally 5: hitting the ball again means the volley did not win the point
const noScore = (P, b) => { q(P, MSG_NO_SCORE, b); return abortPoint(P, WINLOSE_LOSE); };

// ---- Net Game Match judges ----
// NetGameMatch1Cases3 (0B:55B7): the server's volley from in front of the service line
function nm1Volley(P) {
  q(P, MSG_NO_NET, COACH_SIDE);
  if (!serverFront(P)) return abortPoint(P, WINLOSE_LOSE);
  q(P, MSG_NO_VOLLEY, COACH_SIDE);
  if (P.V.shotRecoilVariant !== VOLLEY) return abortPoint(P, WINLOSE_LOSE);
  return 0;
}
// NetGameMatch2Cases2 (0B:57F7): the receiver's return must be a lob (else the point is the server's)
function nm2Lob(P) {
  if (!P.V.ballBounceCount) return 0;
  q(P, MSG_I_DIDNT_LOB, COACH_SIDE);
  if (P.V.currentShotType !== SHOTTYPE_LOB) return abortPoint(P, WINLOSE_WIN);
  return 0;
}
// NetGameMatch2Cases3 (0B:5845): answered with a smash
function nm2Smash(P) {
  q(P, MSG_NO_SMASH, COACH_SIDE);
  if (P.V.shotRecoilVariant !== SMASH_RECOIL) return abortPoint(P, WINLOSE_LOSE);
  return 0;
}
// NetGameMatch3Cases3 (0B:5B5C): from in front of the line
function nm3Net(P) {
  q(P, MSG_NO_NET, COACH_SIDE);
  if (!serverFront(P)) return abortPoint(P, WINLOSE_LOSE);
  return 0;
}
// NetGameMatch1-3JudgePoint (0B:54F9, 5773, 5A9E): by rally: 1 the serve, 2-4 by outcome (and the drill's case on
// the ball hit at rally 2 or 3), 5 hitting again fails
const netMatchJudge = (table, msgs, case2, case3) => (P, event) => judgePoint(P, event, table, [
  [byOutcome(msgs[0], q, COACH_SIDE, SignedTable_0b_00), ZERO, ZERO, ZERO],
  [byOutcome(msgs[1], q, COACH_SIDE, SignedTable_0b_01), case2, ZERO, ZERO],
  [byOutcome(msgs[2], q, COACH_SIDE, SignedTable_0b_00), case3, ZERO, ZERO],
  [byOutcome(msgs[3], q, COACH_SIDE, SignedTable_0b_01), ZERO, ZERO, ZERO],
  [ZERO, P => noScore(P, COACH_SIDE), ZERO, ZERO],
]);
const netGameMatch1JudgePoint = netMatchJudge(0x5505, [0x5539, 0x5573, 0x55AD, 0x5609], ZERO, nm1Volley);
const netGameMatch2JudgePoint = netMatchJudge(0x577F, [0x57B3, 0x57ED, 0x583B, 0x5884], nm2Lob, nm2Smash);
const netGameMatch3JudgePoint = netMatchJudge(0x5AAA, [0x5ADE, 0x5B18, 0x5B52, 0x5B9F], ZERO, nm3Net);

// ---- Net Game Match hooks ----
// NetGameMatch1/2Hook_PointStart (0B:5401, 5668): the coach character for the server; a new pair clears the
// counters (Match 1: 1-4, Match 2: 1-6)
const netMatchPointStart = (opponents, counters) => function* (P) {
  drillPointStartCommon(P);
  yield* loadDrillOpponentBySide(P, opponents);
  P.V.drillMessageId = 0;
  P.V.drillPointJudgement = 0;
  if (P.V.totalPointsScoredInCurrentGame & 1) return;
  for (const n of counters) setCounter(P, n, 0);
};
// NetGameMatch3Hook_PointStart (0B:58E3): every other pair clears counters 1, 2, 5, 6
function netGameMatch3PointStart(P) {
  drillPointStartCommon(P);
  P.V.drillMessageId = 0;
  P.V.drillPointJudgement = 0;
  if (P.V.totalPointsScoredInCurrentGame & 2) return;
  for (const n of [1, 2, 5, 6]) setCounter(P, n, 0);
}
// NetGameMatch1-3HandlePointEnd (0B:5457, 56EA, 595A): the judged result, the message, the score by sides
function* netMatchHandlePointEnd(P) {
  yield* matchJudgedPoint(P);
  yield* showQueuedDrillMessage(P);
  yield* farWait(P, ROM.UpdatePointStats);
  awardPointToSide(P);
  yield* showPointsAndEndPoint(P, false);
}
// NetGameMatch1Hook_PointEnd (0B:542E): after a pair, any lead wins
function* netGameMatch1PointEnd(P) {
  judgeOn(P, netGameMatch1JudgePoint, 0);
  yield* netMatchHandlePointEnd(P);
  if (P.V.totalPointsScoredInCurrentGame & 1) return;
  netGameMatch1DecideWinner(P);
  if (P.V.player2PointsWon === P.V.player1PointsWon) return;
  P.V.matchAbortFlag = MATCHABORT_MATCH;
}
// NetGameMatch1DecideWinner (0B:54BA): the leader's result (a tie: none)
function netGameMatch1DecideWinner(P) {
  const p1 = P.V.player1PointsWon, p2 = P.V.player2PointsWon;
  P.V.pointWinLoseFlag = p2 < p1 ? WINLOSE_WIN : p2 === p1 ? 0 : WINLOSE_LOSE;
}
// NetGameMatch2Hook_PointEnd (0B:569B): a two-point lead wins; after eight points, a draw
function* netGameMatch2PointEnd(P) {
  judgeOn(P, netGameMatch2JudgePoint, 0);
  yield* netMatchHandlePointEnd(P);
  if (P.V.totalPointsScoredInCurrentGame & 1) return;
  if (decideByTwoPointLead(P)) return;
  if (P.V.totalPointsScoredInCurrentGame !== 8) return;
  P.V.pointWinLoseFlag = 0;
  P.V.matchAbortFlag = MATCHABORT_MATCH;
}
// NetGameMatch3Hook_PointEnd (0B:5908): the coach for the next point; a two-point lead wins; after eight, none
function* netGameMatch3PointEnd(P) {
  judgeOn(P, netGameMatch3JudgePoint, 0);
  yield* netMatchHandlePointEnd(P);
  yield* loadDrillOpponentBySide(P, 0x594C);                  // NetGameMatch3DrillOpponent
  if (P.V.totalPointsScoredInCurrentGame & 1) return;
  if (decideByTwoPointLead(P)) return;
  if (P.V.totalPointsScoredInCurrentGame < 8) return;
  P.V.pointWinLoseFlag = 0;
}
// UnusedNetGameMatch3JudgePoint (0B:5994): an older judge by rally length (unused): the message, and +1/-1 for the
// server or the receiver
function unusedNetGameMatch3JudgePoint(P) {
  const { V } = P;
  const o = V.pointOutcome;
  if (o === POINTOUTCOME.FAULT || o === POINTOUTCOME.LET) { V.drillMessageId = DRILLMSG_HIDE; return 0; }
  const n = V.totalPointsScoredInCurrentGame;
  const forServer = () => (((((n & 1) ^ 1) * 2) - 1) & 0xFF);
  const forReceiver = () => ((((n & 1) * 2) - 1) & 0xFF);
  switch ((V.rallyLength - 1) & 3) {
    case 0:
      q(P, 0x17, COACH_SIDE);
      if (V.pointOutcome === POINTOUTCOME.WINNER) return forServer();
      q(P, 0x19, COACH_SIDE);
      return forReceiver();
    case 2:
      q(P, MSG_NO_NET, COACH_SIDE);
      if (!P.bus.u8(at(P.A.drillCounters + 5, n & 1))) return forReceiver();
      q(P, 0x16, COACH_SIDE);
      return V.pointOutcome === POINTOUTCOME.WINNER ? forServer() : forReceiver();
    case 1: {
      q(P, MSG_NO_SCORE, COACH_SIDE);
      const out = V.pointOutcome;
      if (out === POINTOUTCOME.WINNER) return forReceiver();
      q(P, 0x1E, COACH_SIDE);
      if (out === POINTOUTCOME.SERVE_VOLLEYED) return forServer();
      q(P, 0x17, COACH_SIDE);
      return forServer();
    }
    default:
      q(P, 0x17, COACH_SIDE);
      if (V.pointOutcome) return forServer();
      q(P, MSG_NO_SCORE, COACH_SIDE);
      return forReceiver();
  }
}

// ---- Net Game Practice judges ----
// NetGamePractice1Cases3 (0B:5E31): the volley from in front of the line (one fewer owed)
function np1Volley(P) {
  q(P, MSG_NO_NET_2, 0);
  if (!playerFront(P)) return abortPoint(P, WINLOSE_LOSE);
  q(P, MSG_NO_VOLLEY_2, 0);
  if (P.V.shotRecoilVariant !== VOLLEY) return abortPoint(P, WINLOSE_LOSE);
  setCounter(P, 5, counter(P, 5) - 1);
  return 0;
}
// NetGamePractice1Cases3.checkBallBounceCount (0B:5E55): the volley's first bounce inside the target area
function np1VolleyLanded(P) {
  if (P.V.ballBounceCount !== 1) return 0;
  if (P.V.pointOutcome !== POINTOUTCOME.NET) {
    q(P, MSG_NICE_VOLLEY, 0);
    recordDrillTargetZoneHit(P);
    if (checkDrillTargetZoneMissed(P, false).a) return abortPoint(P, WINLOSE_WIN);
  }
  q(P, MSG_TARGET_AREA_2, 0);
  incCounter(P, 3);
  return abortPoint(P, WINLOSE_LOSE);
}
// NetGamePractice2/3Cases1.checkBallBounceCount (0B:606F, 632E): the serve's first bounce deep in the target area
const longServe = checkDoubleFault => P => {
  const { V } = P;
  if (V.ballBounceCount !== 1) return 0;
  if (V.ballHasBouncedFlag) return 0;
  if (V.pointOutcome === POINTOUTCOME.OUT) return 0;
  if (checkDoubleFault && V.pointOutcome === POINTOUTCOME.DOUBLE_FAULT) return 0;
  q(P, MSG_LONG_SERVE, 0);
  recordDrillTargetZoneHit(P);
  if (!checkDrillTargetZoneMissed(P, false).a) return abortPoint(P, WINLOSE_LOSE);
  return 0;
};
// NetGamePractice2Cases2 (0B:60D7): the coach's lob (else a success)
function np2Lob(P) {
  if (!P.V.ballBounceCount) return 0;
  q(P, MSG_I_DIDNT_LOB_2, 0);
  if (P.V.currentShotType !== SHOTTYPE_LOB) return abortPoint(P, WINLOSE_WIN);
  return 0;
}
// NetGamePractice2Cases3 (0B:6125): answered with a smash (one fewer owed)
function np2Smash(P) {
  q(P, MSG_NO_SMASH_2, 0);
  if (P.V.currentShotType !== SHOTTYPE_SMASH) return abortPoint(P, WINLOSE_LOSE);
  setCounter(P, 5, counter(P, 5) - 1);
  return 0;
}
// NetGamePractice3Cases3 (0B:63C8): a drop shot from in front of the line (one fewer owed)
function np3Drop(P) {
  q(P, MSG_NO_NET_2, 0);
  if (!playerFront(P)) return abortPoint(P, WINLOSE_LOSE);
  q(P, MSG_NO_DROP, 0);
  if (P.V.currentShotType !== SHOTTYPE_DROP) return abortPoint(P, WINLOSE_LOSE);
  setCounter(P, 5, counter(P, 5) - 1);
  return 0;
}
// NetGamePractice1-3JudgePoint (0B:5D6D, 6027, 62E6)
function netGamePractice1JudgePoint(P, event) {
  return judgePoint(P, event, 0x5D79, [
    [byOutcome(0x5DA9, q, 0, SignedTable_0b_00), ZERO, ZERO, ZERO],
    [byOutcome(0x5DE3, q, 0, SignedTable_0b_01), ZERO, ZERO, ZERO],
    [byOutcome(0x5E27, q, 0, 0x5E1D), np1Volley, np1VolleyLanded, ZERO],
  ]);
}
function netGamePractice2JudgePoint(P, event) {
  return judgePoint(P, event, 0x6033, [
    [byOutcome(0x6063, q, 0, SignedTable_0b_00), ZERO, longServe(true), ZERO],
    [byOutcome(0x60CD, q, 0, SignedTable_0b_01), np2Lob, ZERO, ZERO],
    [byOutcome(0x611B, q, 0, SignedTable_0b_00), np2Smash, ZERO, ZERO],
  ]);
}
function netGamePractice3JudgePoint(P, event) {
  return judgePoint(P, event, 0x62F2, [
    [byOutcome(0x6322, q, 0, SignedTable_0b_00), ZERO, longServe(false), ZERO],
    [byOutcome(0x6384, q, 0, SignedTable_0b_01), ZERO, ZERO, ZERO],
    [byOutcome(0x63BE, q, 0, SignedTable_0b_00), np3Drop, ZERO, ZERO],
  ]);
}

// ---- Net Game Practice hooks ----
const practiceInit = P => { P.V.drillIsPracticeLesson = 1; };
// NetGamePractice1/2/3Hook_MinigameStart (0B:5C00, 5EBB, 6174): four shots owed (wDrillCounters + 5)
const practiceStart = cleared => P => {
  for (const n of cleared) setCounter(P, n, 0);
  setCounter(P, 5, 4);
  P.V.drillIsPracticeLesson = 1;
};
// NetGamePractice1Hook_PointStart (0B:5C19): the target area, the coach, the coach's serve aimed by the point
function* netGamePractice1PointStart(P) {
  drillPointStartCommon(P);
  setCounter(P, 6, 0);
  P.V.targetZoneEnabled = 1;
  setDrillTargetZoneForPoint(P, 0x5CD7);                     // NetGamePractice1Table
  yield* loadDrillOpponentChar(P, CHAR_DRILL_NET_GAME_PRACTICE_1);
  P.V.drillMessageId = 0;
  P.V.drillPointJudgement = 0;
  P.V.aiServeAimOverride = rb(P, at(0x5C4E, P.V.totalPointsScoredInCurrentGame));   // NetGamePractice1PointStartTable
}
// NetGamePractice2/3Hook_PointStart (0B:5ED1, 618A)
const netGamePracticePointStart = (clear, zones, coach) => function* (P) {
  drillPointStartCommon(P);
  for (const n of clear) setCounter(P, n, 0);
  P.V.targetZoneEnabled = 1;
  setDrillTargetZoneForPoint(P, zones);
  yield* loadDrillOpponentChar(P, coach);
  P.V.drillMessageId = 0;
  P.V.drillPointJudgement = 0;
};
// NetGamePractice1-3Hook_PointEnd (0B:5C52, 5EFA, 61AC): a ball into the net or out counts (wDrillCounters + n);
// after the fourth point, the grade
const netGamePracticePointEnd = (judge, faults, evaluate) => function* (P) {
  judgeOn(P, judge, 0);
  const o = P.V.pointOutcome;
  if (o === POINTOUTCOME.NET || o === POINTOUTCOME.OUT) incCounter(P, faults);
  yield* practiceHandlePointEnd(P, 4);
  if (P.V.totalPointsScoredInCurrentGame < 4) return;
  P.V.pointWinLoseFlag = evaluate(P);
};
const grade = (P, r) => { P.V.drillLessonResult = r; return WINLOSE_LOSE; };
const pass = P => { P.V.drillLessonResult = 0; return WINLOSE_WIN; };
// NetGamePractice1EvaluateResult (0B:5C76): all four: passed; 1 every point a double fault, 2 a double fault,
// 5 three of four, 4 no volley owed... (wDrillCounters + 5 = 0), 3 otherwise
function netGamePractice1EvaluateResult(P) {
  if (counter(P, 4) === 4) return pass(P);
  const df = P.V.character1DoubleFaults;
  if (df === 4) return grade(P, 1);
  if (df) return grade(P, 2);
  if (counter(P, 4) === 3) return grade(P, 5);
  if (!counter(P, 5)) return grade(P, 4);
  return grade(P, 3);
}
// NetGamePractice2EvaluateResult (0B:5F1E)
function netGamePractice2EvaluateResult(P) {
  if (counter(P, 4) === 4) return pass(P);
  const df = P.V.character1DoubleFaults;
  if (df === 4) return grade(P, 1);
  if (df) return grade(P, 2);
  if (counter(P, 4) === 3) return grade(P, 6);
  if (!counter(P, 5)) return grade(P, 5);
  const c4 = counter(P, 4);
  return grade(P, c4 >= 1 && c4 < 3 ? 4 : 3);
}
// NetGamePractice3EvaluateResult (0B:61D0)
function netGamePractice3EvaluateResult(P) {
  if (counter(P, 4) === 4) return pass(P);
  const df = P.V.character1DoubleFaults;
  if (df === 4) return grade(P, 1);
  if (df) return grade(P, 2);
  if (counter(P, 4) === 3) return grade(P, 7);
  if (countDrillResultBitsSet(P).a) return grade(P, 3);
  if (!counter(P, 5)) return grade(P, 6);
  const c4 = counter(P, 4);
  return grade(P, c4 >= 1 && c4 < 3 ? 5 : 4);
}
// NetGamePractice1-3Hook_BallHit (0B:5CC9, 5F83, 6242): judged; the coach stops after his shot
const practiceBallHit = judge => P => {
  judgeOn(P, judge, 1);
  if (P.V.lastShotCharIndex === 1) resetActiveCharState(P);
};

// ---- hooks ----
const H = (addr, fn) => [B, addr, auto(fn)];
export const HOOKS = [
  // Net Game Match 1
  H(0x53FD, updateDrillAbortCountdown),                                           // NetGameMatch1Hook_PerFrame
  H(0x5401, netMatchPointStart(0x542C, [1, 2, 3, 4])),                            // NetGameMatch1Hook_PointStart
  H(0x542E, netGameMatch1PointEnd),                                               // NetGameMatch1Hook_PointEnd
  H(0x544B, DISABLED), H(0x544F, DISABLED),                                       // NetGameMatch1Hook_RallyTick / _Bounce
  H(0x5453, P => judgeOn(P, netGameMatch1JudgePoint, 1)),                         // NetGameMatch1Hook_BallHit
  H(0x5457, netMatchHandlePointEnd),                                              // NetGameMatch1HandlePointEnd
  H(0x54BA, netGameMatch1DecideWinner),                                           // NetGameMatch1DecideWinner
  ...judgeHooks(netGameMatch1JudgePoint, [0x54D3, 0x54DC, 0x54E5, 0x54EF], [2, 3]),   // NetGameMatch1JudgeOn*
  [B, 0x54F9, hook((P, c) => netGameMatch1JudgePoint(P, c.a))],                   // NetGameMatch1JudgePoint
  // Net Game Match 2
  H(0x5664, updateDrillAbortCountdown),                                           // NetGameMatch2Hook_PerFrame
  H(0x5668, netMatchPointStart(0x5699, [1, 2, 3, 4, 5, 6])),                      // NetGameMatch2Hook_PointStart
  H(0x569B, netGameMatch2PointEnd),                                               // NetGameMatch2Hook_PointEnd
  H(0x56DE, DISABLED), H(0x56E2, DISABLED),                                       // NetGameMatch2Hook_RallyTick / _Bounce
  H(0x56E6, P => judgeOn(P, netGameMatch2JudgePoint, 1)),                         // NetGameMatch2Hook_BallHit
  H(0x56EA, netMatchHandlePointEnd),                                              // NetGameMatch2HandlePointEnd
  ...judgeHooks(netGameMatch2JudgePoint, [0x574D, 0x5756, 0x575F, 0x5769], [2, 3]),   // NetGameMatch2JudgeOn*
  [B, 0x5773, hook((P, c) => netGameMatch2JudgePoint(P, c.a))],                   // NetGameMatch2JudgePoint
  // Net Game Match 3
  H(0x58DF, updateDrillAbortCountdown),                                           // NetGameMatch3Hook_PerFrame
  H(0x58E3, netGameMatch3PointStart),                                             // NetGameMatch3Hook_PointStart
  H(0x5908, netGameMatch3PointEnd),                                               // NetGameMatch3Hook_PointEnd
  H(0x594E, DISABLED), H(0x5952, DISABLED),                                       // NetGameMatch3Hook_RallyTick / _Bounce
  H(0x5956, P => judgeOn(P, netGameMatch3JudgePoint, 1)),                         // NetGameMatch3Hook_BallHit
  H(0x595A, netMatchHandlePointEnd),                                              // NetGameMatch3HandlePointEnd
  H(0x5994, unusedNetGameMatch3JudgePoint),                                       // UnusedNetGameMatch3JudgePoint
  ...judgeHooks(netGameMatch3JudgePoint, [0x5A78, 0x5A81, 0x5A8A, 0x5A94], [2, 3]),   // NetGameMatch3JudgeOn*
  [B, 0x5A9E, hook((P, c) => netGameMatch3JudgePoint(P, c.a))],                   // NetGameMatch3JudgePoint
  // Net Game Practice 1
  H(0x5BEA, practiceInit),                                                        // NetGamePractice1DrillInit
  H(0x5C00, practiceStart([2, 3, 4])),                                            // NetGamePractice1Hook_MinigameStart
  H(0x5C15, updateDrillAbortCountdown),                                           // NetGamePractice1Hook_PerFrame
  H(0x5C19, netGamePractice1PointStart),                                          // NetGamePractice1Hook_PointStart
  H(0x5C52, netGamePracticePointEnd(netGamePractice1JudgePoint, 2, netGamePractice1EvaluateResult)),   // NetGamePractice1Hook_PointEnd
  H(0x5C76, netGamePractice1EvaluateResult),                                      // NetGamePractice1EvaluateResult
  H(0x5CC1, DISABLED),                                                            // NetGamePractice1Hook_RallyTick
  H(0x5CC5, P => judgeOn(P, netGamePractice1JudgePoint, 2)),                      // NetGamePractice1Hook_Bounce
  H(0x5CC9, practiceBallHit(netGamePractice1JudgePoint)),                         // NetGamePractice1Hook_BallHit
  H(0x5CF9, P => practiceHandlePointEnd(P, 4)),                                   // NetGamePractice1HandlePointEnd
  ...judgeHooks(netGamePractice1JudgePoint, [0x5D48, 0x5D51, 0x5D5A, 0x5D63], [3]),   // NetGamePractice1JudgeOn*
  [B, 0x5D6D, hook((P, c) => netGamePractice1JudgePoint(P, c.a))],                // NetGamePractice1JudgePoint
  // Net Game Practice 2
  H(0x5EA5, practiceInit),                                                        // NetGamePractice2DrillInit
  H(0x5EBB, practiceStart([3, 4])),                                               // NetGamePractice2Hook_MinigameStart
  H(0x5ECD, updateDrillAbortCountdown),                                           // NetGamePractice2Hook_PerFrame
  H(0x5ED1, netGamePracticePointStart([1, 6], 0x5F91, CHAR_DRILL_NET_GAME_PRACTICE_2)),   // NetGamePractice2Hook_PointStart
  H(0x5EFA, netGamePracticePointEnd(netGamePractice2JudgePoint, 3, netGamePractice2EvaluateResult)),   // NetGamePractice2Hook_PointEnd
  H(0x5F1E, netGamePractice2EvaluateResult),                                      // NetGamePractice2EvaluateResult
  H(0x5F7B, DISABLED),                                                            // NetGamePractice2Hook_RallyTick
  H(0x5F7F, P => judgeOn(P, netGamePractice2JudgePoint, 2)),                      // NetGamePractice2Hook_Bounce
  H(0x5F83, practiceBallHit(netGamePractice2JudgePoint)),                         // NetGamePractice2Hook_BallHit
  H(0x5FB3, P => practiceHandlePointEnd(P, 4)),                                   // NetGamePractice2HandlePointEnd
  ...judgeHooks(netGamePractice2JudgePoint, [0x6002, 0x600B, 0x6014, 0x601D], [3]),   // NetGamePractice2JudgeOn*
  [B, 0x6027, hook((P, c) => netGamePractice2JudgePoint(P, c.a))],                // NetGamePractice2JudgePoint
  // Net Game Practice 3
  H(0x615E, practiceInit),                                                        // NetGamePractice3DrillInit
  H(0x6174, practiceStart([3, 4])),                                               // NetGamePractice3Hook_MinigameStart
  H(0x6186, updateDrillAbortCountdown),                                           // NetGamePractice3Hook_PerFrame
  H(0x618A, netGamePracticePointStart([], 0x6250, CHAR_DRILL_NET_GAME_PRACTICE_3)),   // NetGamePractice3Hook_PointStart
  H(0x61AC, netGamePracticePointEnd(netGamePractice3JudgePoint, 3, netGamePractice3EvaluateResult)),   // NetGamePractice3Hook_PointEnd
  H(0x61D0, netGamePractice3EvaluateResult),                                      // NetGamePractice3EvaluateResult
  H(0x623A, DISABLED),                                                            // NetGamePractice3Hook_RallyTick
  H(0x623E, P => judgeOn(P, netGamePractice3JudgePoint, 2)),                      // NetGamePractice3Hook_Bounce
  H(0x6242, practiceBallHit(netGamePractice3JudgePoint)),                         // NetGamePractice3Hook_BallHit
  H(0x6272, P => practiceHandlePointEnd(P, 4)),                                   // NetGamePractice3HandlePointEnd
  ...judgeHooks(netGamePractice3JudgePoint, [0x62C1, 0x62CA, 0x62D3, 0x62DC], [3]),   // NetGamePractice3JudgeOn*
  [B, 0x62E6, hook((P, c) => netGamePractice3JudgePoint(P, c.a))],                // NetGamePractice3JudgePoint
];
