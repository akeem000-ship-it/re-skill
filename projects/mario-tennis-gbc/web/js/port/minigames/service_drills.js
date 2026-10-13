// Training drills: Service Match 1-3 (ids $00-$02) and Service Practice 1-3 ($03-$05), bank $0B.
// Port of service_matches_0b.asm, service_practice_0b.asm and service_coach_0b.asm of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm), whose names these are.
// The drill framework (judging, messages, the end of a point) is in drills.js.
//
// Service Match: player and coach take turns serving (two points each, eight in all); a serve that wins outright
// is a success, a serve the receiver gets back (rally 2) a failure ("I returned it, so you failed") — except a
// serve returned before it bounced, which counts for the server. Each side's successes (wDrillCounters + 1/2, from
// the result bits) are its points; after each pair of points a side ahead wins (Match 3: by two points).
// Service Match 2 also asks the serve to pass between two poles (the gate, drawn by the Draw hook).
// Service Practice: four serves into a target area (1), with topspin or slice to make it bounce out (2), with
// "nice timing" (a special shot) through the poles (3); the lesson's grade (wDrillLessonResult) says what went wrong.
import {
  ROM, far, farWait, sound, POINTOUTCOME, SFX_BEEP, SFX_MENU_SELECT, DRILLMSG_HIDE, WINLOSE_WIN, WINLOSE_LOSE,
  MATCHABORT_MATCH, hook, auto,
} from "./common.js";
import {
  BANK_0B as B, SignedTable_0b_00, SignedTable_0b_01, judgePoint, byOutcome, ZERO, abortPoint, judgeOn, judgeHooks,
  queueDrillResultMessage, queueDrillOutcomeMessage, showQueuedDrillMessage, showDrillMessageByIndex,
  updateDrillAbortCountdown, setDrillTargetZoneForPoint, indexDrillTableByPoint, recordDrillTargetZoneHitIfInPlay,
  checkDrillTargetZoneMissed, countDrillResultBitsSet, countDrillResultBitsSetAlt, countDrillResultBitsThisGame,
  recordGateCrossOnServe, resetActiveCharState, queueDrillMarker, recordDrillPointResultBits, countBothSides,
  matchJudgedPoint, awardPointToSide, showPointsAndEndPoint, drillPointStartCommon, decideByTwoPointLead,
  counter, setCounter, incCounter, DISABLED,
} from "./drills.js";

// drill messages
const MSG_POLES_FAILED = 0x03, MSG_I_RETURNED_IT = 0x04, MSG_NICE_SERVE = 0x0D, MSG_DOUBLE_FAULT = 0x0E;
const MSG_THROUGH_POLES = 0x0F, MSG_TARGET_AREA = 0x10, MSG_TOPSPIN_OUT = 0x11, MSG_NICE_TIMING = 0x13;
const OTHER_SIDE = 0x06;                     // the coach's wording of a Service Match message: + 6
const q = queueDrillResultMessage;

// ---- the Service Match judges ----
// Cases2 of the three: the serve came back (rally 2, ball hit): a failure — unless it was volleyed (the receiver's
// fault)
function serveReturned(P) {
  if (P.V.pointOutcome === POINTOUTCOME.SERVE_VOLLEYED) return 0;
  q(P, MSG_I_RETURNED_IT, OTHER_SIDE);
  return abortPoint(P, WINLOSE_LOSE);
}
// ServiceMatch1JudgePoint (0B:4922) / ServiceMatch3JudgePoint (0B:4D3D): the serve judged by its outcome at the
// point's end; the return (rally 2) by the outcome, or as a failure when it is hit
const serviceMatchJudge = (table, serveMsgs, returnMsgs) => (P, event) => judgePoint(P, event, table, [
  [byOutcome(serveMsgs, q, OTHER_SIDE, SignedTable_0b_00), ZERO, ZERO, ZERO],
  [byOutcome(returnMsgs, q, OTHER_SIDE, SignedTable_0b_01), serveReturned, ZERO, ZERO],
]);
const serviceMatch1JudgePoint = serviceMatchJudge(0x492E, 0x495C, 0x4996);
const serviceMatch3JudgePoint = serviceMatchJudge(0x4D49, 0x4D77, 0x4DB1);
// ServiceMatch2JudgePoint (0B:4B53): the same, and on the serve's rally ticks, until it first bounces: through the
// gate poles, or a failure ("you didn't hit it through the poles")
function serviceMatch2JudgePoint(P, event) {
  return judgePoint(P, event, 0x4B5F, [
    [byOutcome(0x4B8D, q, OTHER_SIDE, SignedTable_0b_00), ZERO, ZERO, serveThroughPoles],
    [byOutcome(0x4BE2, q, OTHER_SIDE, SignedTable_0b_01), serveReturned, ZERO, ZERO],
  ]);
}
function serveThroughPoles(P) {
  if (P.V.ballHasBouncedFlag) return 0;
  q(P, MSG_POLES_FAILED, OTHER_SIDE);
  if (far(P, ROM.DidBallCrossGate).f & 0x80) return abortPoint(P, WINLOSE_LOSE);
  P.V.drillGateActive = 0;
  return 0;
}

// ---- the Service Match hooks ----
// ServiceMatch1/3Hook_PointStart (0B:4851, 4C37): a fresh point, no message, no judgement
function serviceMatchPointStart(P) { drillPointStartCommon(P); P.V.drillMessageId = 0; P.V.drillPointJudgement = 0; }
// ServiceMatch2Hook_PointStart (0B:49F2): also the gate up at the point's poles, the CPU's serve aimed by the pair
// of points
function serviceMatch2PointStart(P) {
  drillPointStartCommon(P);
  P.V.unusedDrillPointStartByte = 0;
  P.V.drillAbortCountdown = 0x0A;
  P.V.drillGateActive = 1;
  indexDrillTableByPoint(P, 0x4A6A);                         // ServiceMatch2PointStartDrillPositions
  P.V.aiServeAimOverride = P.bus.u8((0x4A23 + (P.V.totalPointsScoredInCurrentGame >> 1)) & 0xFFFF);
  P.V.drillMessageId = 0;
  P.V.drillPointJudgement = 0;
}
// ServiceMatch1HandlePointEnd (0B:48A6) / ServiceMatch3 (0B:4C98): the result, both sides' successes counted
// (the points: Match 1 through AwardPoint, Match 3 through the side award), the message
function* serviceMatch1HandlePointEnd(P) {
  yield* matchJudgedPoint(P);
  countBothSides(P, 1);
  yield* showQueuedDrillMessage(P);
  yield* farWait(P, ROM.UpdatePointStats);
  yield* farWait(P, ROM.AwardPoint);
  setPointsFromCounts(P);
  yield* showPointsAndEndPoint(P, false);
}
function* serviceMatch3HandlePointEnd(P) {
  yield* matchJudgedPoint(P);
  countBothSides(P, 1);
  yield* showQueuedDrillMessage(P);
  yield* farWait(P, ROM.UpdatePointStats);
  awardPointToSide(P);
  setPointsFromCounts(P);
  yield* showPointsAndEndPoint(P, false);
}
// ServiceMatch2HandlePointEnd (0B:4AAC): the stats only count a serve that reached its target (wDrillServeTargetResult)
function* serviceMatch2HandlePointEnd(P) {
  yield* matchJudgedPoint(P);
  countBothSides(P, 1);
  yield* showQueuedDrillMessage(P);
  if (P.bus.u8((P.A.drillServeTargetResult + P.V.currentServingPlayer) & 0xFFFF)) yield* farWait(P, ROM.UpdatePointStats);
  awardPointToSide(P);
  yield* showPointsAndEndPoint(P, false);
}
function setPointsFromCounts(P) { P.V.player1PointsWon = counter(P, 1); P.V.player2PointsWon = counter(P, 2); }
// ServiceMatch1/2Hook_PointEnd (0B:4863, 4A27): after each pair of serves the side with more successes wins;
// after all eight, the result (a tie: none)
const serviceMatchPointEnd = (judge, handle) => function* (P) {
  judgeOn(P, judge, 0);
  yield* handle(P);
  const n = P.V.totalPointsScoredInCurrentGame;
  if (n & 1) return;
  if (n === 8) {
    const d = (counter(P, 2) - counter(P, 1)) & 0xFF;
    P.V.pointWinLoseFlag = d === 0 ? 0 : counter(P, 2) >= counter(P, 1) ? WINLOSE_LOSE : WINLOSE_WIN;
    return;
  }
  if (counter(P, 1) === counter(P, 2)) return;
  P.V.matchAbortFlag = MATCHABORT_MATCH;
};
// ServiceMatch3Hook_PointEnd (0B:4C49): a decided point; after each pair, a two-point lead wins; after eight, none
function* serviceMatch3PointEnd(P) {
  judgeOn(P, serviceMatch3JudgePoint, 0);
  yield* serviceMatch3HandlePointEnd(P);
  if (!P.V.pointWinLoseFlag) return;
  if (P.V.totalPointsScoredInCurrentGame & 1) return;
  if (decideByTwoPointLead(P)) return;
  if (P.V.totalPointsScoredInCurrentGame < 8) return;
  P.V.pointWinLoseFlag = 0;
}

// ---- Service Practice ----
const ServicePractice1PointStartDrillPositions = 0x4EA0, ServicePractice2PointStartDrillPositions = 0x5060;
const ServicePractice3TargetZones = 0x5302, ServicePractice3PointStartDrillPositions = 0x52E0;
const Table_0b_2 = 0x5130, ServicePractice2SetupShotTargetTable = 0x5135, ServicePractice2QueueOutcomeMessageDrillShotTable = 0x51C8;
// ServicePractice1/2/3DrillInit (0B:4DF2, 4F79, 51DD)
function practiceInit(P) { P.V.drillIsPracticeLesson = 1; }
// ServicePractice1Hook_PointStart (0B:4E0C) and 2 (0B:4F9C): the target area for this serve
const servicePracticePointStart = zones => P => {
  drillPointStartCommon(P);
  P.V.targetZoneEnabled = 1;
  setDrillTargetZoneForPoint(P, zones);
  P.V.drillMessageId = 0;
};
function servicePractice1PointStart(P) {
  drillPointStartCommon(P);
  P.V.drillMessageId = 0;
  P.V.targetZoneEnabled = 1;
  setDrillTargetZoneForPoint(P, ServicePractice1PointStartDrillPositions);
}
// ServicePractice3Hook_PointStart (0B:5213): the target area and the gate's poles
function servicePractice3PointStart(P) {
  drillPointStartCommon(P);
  P.V.targetZoneEnabled = 1;
  setDrillTargetZoneForPoint(P, ServicePractice3TargetZones);
  P.V.drillGateActive = 1;
  indexDrillTableByPoint(P, ServicePractice3PointStartDrillPositions);
  P.V.drillMessageId = 0;
}
// Service Practice 1-3 Hook_PointEnd (0B:4E25, 4FB5, 5237): after the fourth serve the lesson is graded
const servicePracticePointEnd = (handle, evaluate) => function* (P) {
  yield* handle(P);
  if (P.V.totalPointsScoredInCurrentGame < 4) return;
  if (!P.V.pointWinLoseFlag) return;
  P.V.pointWinLoseFlag = evaluate(P);
  P.V.matchAbortFlag = MATCHABORT_MATCH;
};
// ServicePractice1EvaluateResult (0B:4E3F): 1 no good serve, 2 a double fault, 3 not all four good; else passed
function servicePractice1EvaluateResult(P) {
  const missed = (4 - counter(P, 0)) & 0xFF;
  if (missed === 4) return grade(P, 1);
  if (P.V.character1DoubleFaults) return grade(P, 2);
  if (missed) return grade(P, 3);
  return pass(P);
}
const grade = (P, r) => { P.V.drillLessonResult = r; return WINLOSE_LOSE; };
const pass = P => { P.V.drillLessonResult = 0; return WINLOSE_WIN; };
// ServicePractice2EvaluateResult (0B:4FCF): 1 no points, 2 a double fault, 3 a ball outside the area, 4 neither
// shot, 5/6 one of them missing (the wording by the player's hand); else passed
function servicePractice2EvaluateResult(P) {
  const { V } = P;
  if (!V.player1PointsWon) return grade(P, 1);
  if (V.character1DoubleFaults) return grade(P, 2);
  if (countDrillResultBitsSet(P).a) return grade(P, 3);
  if (counter(P, 2)) {
    if (counter(P, 1)) return grade(P, 4);
    return grade(P, (6 - V.storyModeMainCharacterLeftHanded) & 0xFF);
  }
  if (counter(P, 1)) return grade(P, (5 + V.storyModeMainCharacterLeftHanded) & 0xFF);
  return pass(P);
}
// ServicePractice3EvaluateResult (0B:5251): 1 no points, 2 a double fault, 3 outside the area, 4 timing missed,
// 5 a serve outside the poles; else passed
function servicePractice3EvaluateResult(P) {
  countDrillResultBitsSet(P); countDrillResultBitsSetAlt(P);
  if (!counter(P, 0)) return grade(P, 1);
  if (P.V.character1DoubleFaults) return grade(P, 2);
  if (countDrillResultBitsSet(P).a) return grade(P, 3);
  if (counter(P, 1)) return grade(P, 4);
  if (countDrillResultBitsSetAlt(P).a !== 4) return grade(P, 5);
  return pass(P);
}
// ServicePractice1Hook_Bounce (0B:4E75) / 3 (0B:52A6): the serve's bounces mark the target area
function servicePracticeBounce(P) { if (P.V.rallyLength === 1) recordDrillTargetZoneHitIfInPlay(P); }
// ServicePractice2Hook_Bounce (0B:5032): only its first bounce
function servicePractice2Bounce(P) {
  if (P.V.ballHasBouncedFlag) return;
  if (P.V.rallyLength !== 1) return;
  recordDrillTargetZoneHitIfInPlay(P);
}
// UnusedServeSecondBounceSound_1/2 (0B:4E7F, 5041): a beep at the serve's second bounce (unused)
function unusedServeSecondBounceSound(P) {
  if (P.V.ballBounceCount !== 2) return;
  if (P.V.rallyLength !== 1) return;
  sound(P, SFX_BEEP);
}
// ServicePractice1Hook_BallHit (0B:4E8E): the coach returning the serve ends the point after the countdown (and stops)
function servicePractice1BallHit(P) {
  if (P.V.rallyLength < 2) return;
  P.V.drillAbortCountdownActive = 1;
  resetActiveCharState(P);
  sound(P, SFX_MENU_SELECT);
}
function servicePractice2BallHit(P) {
  if (P.V.rallyLength < 2) return;
  P.V.drillAbortCountdownActive = 1;
  resetActiveCharState(P);
}
// ServicePractice3Hook_BallHit (0B:52B0)
function servicePractice3BallHit(P) { servicePractice3SetupShotTarget(P); servicePractice2BallHit(P); }

// ServicePractice1HandlePointEnd (0B:4EC2) / 3 (0B:5324): the serve's result and message; successes in
// wDrillCounters + 1 / + 5 as player 1's points; the coach mirrors the result
const servicePracticeHandlePointEnd = (queueOutcome, first) => function* (P) {
  yield* farWait(P, ROM.UpdateScorePanelDisplay);
  P.V.pointWinLoseFlag = queueOutcome(P);
  recordDrillPointResultBits(P);
  countBothSides(P, first);
  yield* showQueuedDrillMessage(P);
  yield* farWait(P, ROM.UpdatePointStats);
  yield* farWait(P, ROM.AwardPoint);
  P.V.player1PointsWon = counter(P, first);
  P.V.player2PointsWon = 0;
  yield* showPointsAndEndPoint(P, true);
};
// ServicePractice2HandlePointEnd (0B:5082): the same with the shot check first, and the outcome message when none
// was queued
function* servicePractice2HandlePointEnd(P) {
  servicePractice2SetupShotTarget(P);
  yield* farWait(P, ROM.UpdateScorePanelDisplay);
  P.V.pointWinLoseFlag = servicePractice2QueueOutcomeMessage(P);
  recordDrillPointResultBits(P);
  countBothSides(P, 5);
  if (!P.V.drillMessageId) queueDrillOutcomeMessage(P);
  yield* showDrillMessageByIndex(P, P.V.drillMessageId);
  yield* farWait(P, ROM.UpdatePointStats);
  yield* farWait(P, ROM.AwardPoint);
  P.V.player1PointsWon = counter(P, 5);
  P.V.player2PointsWon = 0;
  yield* showPointsAndEndPoint(P, true);
}
// UnusedStoreDrillServeTargetResult (0B:4F19): wDrillServeTargetResult = +1 / -1 by the target area (unused)
function unusedStoreDrillServeTargetResult(P, cin) {
  P.bus.w8(P.A.drillServeTargetResult, checkDrillTargetZoneMissed(P, cin).a * 2 - 1);
}
// ServicePractice1QueueOutcomeMessage (0B:4F22): fault/let: nothing yet (0); a double fault or a serve outside
// the area: failed (-1); inside: "nice serve" and a success (+1)
function servicePractice1QueueOutcomeMessage(P) {
  const o = P.V.pointOutcome;
  if (o === POINTOUTCOME.FAULT || o === POINTOUTCOME.LET) { P.V.drillMessageId = DRILLMSG_HIDE; return 0; }
  if (o === POINTOUTCOME.DOUBLE_FAULT) { q(P, MSG_DOUBLE_FAULT, 0); return WINLOSE_LOSE; }
  q(P, MSG_TARGET_AREA, 0);
  if (!checkDrillTargetZoneMissed(P, false).a) return WINLOSE_LOSE;   // (the queue's `add` left no carry)
  q(P, MSG_NICE_SERVE, 0);
  incCounter(P, 0);
  return WINLOSE_WIN;
}
// ServicePractice2SetupShotTarget (0B:50E5), at the serve's end: the serve type asked for this point (topspin or
// slice by the point and the player's hand, Table_0b_2) used: one fewer of that kind owed; else "you didn't use
// topspin/slice"
function servicePractice2SetupShotTarget(P) {
  const { V } = P;
  if (V.rallyLength !== 1) return;
  const n = V.totalPointsScoredInCurrentGame;
  if (n >= 4) return;
  const lh = V.storyModeMainCharacterLeftHanded;
  const wanted = P.bus.u8(((Table_0b_2 + n) & 0xFFFF) + lh & 0xFFFF);
  setCounter(P, 3, V.currentShotType);
  if (V.currentShotType === wanted) {
    const entry = (((ServicePractice2SetupShotTargetTable + n * 2) & 0xFFFF) + lh * 2) & 0xFFFF;
    const owed = P.bus.u16(entry);
    P.bus.w8(owed, P.bus.u8(owed) - 1);
    return;
  }
  V.drillMessageId = ((n & 1) + MSG_TOPSPIN_OUT) & 0xFF;
}
// ServicePractice2QueueOutcomeMessage (0B:513F): the serve must be the type asked for, land in the area and win
function servicePractice2QueueOutcomeMessage(P) {
  const { V } = P;
  const o = V.pointOutcome;
  if (o === POINTOUTCOME.FAULT || o === POINTOUTCOME.LET) { V.drillMessageId = DRILLMSG_HIDE; return 0; }
  if (o === POINTOUTCOME.DOUBLE_FAULT) { q(P, MSG_DOUBLE_FAULT, 0); return WINLOSE_LOSE; }
  q(P, MSG_TOPSPIN_OUT, 0);
  const lh = V.storyModeMainCharacterLeftHanded, n = V.totalPointsScoredInCurrentGame;
  V.drillMessageId = (V.drillMessageId + ((((lh & 1) + n) & 1) ^ 1)) & 0xFF;   // topspin or slice wording
  const wanted = P.bus.u8((((ServicePractice2QueueOutcomeMessageDrillShotTable + lh) & 0xFFFF) + n) & 0xFFFF);
  if (counter(P, 3) !== wanted) return WINLOSE_LOSE;
  q(P, MSG_TARGET_AREA, 0);
  if (!checkDrillTargetZoneMissed(P, false).a) return WINLOSE_LOSE;
  q(P, MSG_NICE_SERVE, 0);
  if (V.pointOutcome === POINTOUTCOME.WINNER) { incCounter(P, 0); return WINLOSE_WIN; }
  q(P, MSG_DOUBLE_FAULT, 0);
  return WINLOSE_LOSE;
}
// ServicePractice3SetupShotTarget (0B:52C3), at the serve's hit: a "nice timing" serve (wSpecialShotFlag) is one
// fewer owed; else the timing message
function servicePractice3SetupShotTarget(P) {
  if (P.V.rallyLength !== 1) return;
  if (P.V.totalPointsScoredInCurrentGame >= 4) return;
  if (!P.V.specialShotFlag) { P.V.drillMessageId = MSG_NICE_TIMING; return; }
  setCounter(P, 1, counter(P, 1) - 1);
}
// ServicePractice3QueueOutcomeMessage (0B:537B): timing, the poles, the area and a winner, in that order
function servicePractice3QueueOutcomeMessage(P) {
  const { V } = P;
  const o = V.pointOutcome;
  if (o === POINTOUTCOME.FAULT || o === POINTOUTCOME.LET) { V.drillMessageId = DRILLMSG_HIDE; return 0; }
  if (o !== POINTOUTCOME.DOUBLE_FAULT) {
    q(P, MSG_NICE_TIMING, 0);
    if (!V.specialShotFlag) return WINLOSE_LOSE;
    q(P, MSG_THROUGH_POLES, 0);
    if (!countDrillResultBitsThisGame(P, false).a) return WINLOSE_LOSE;
    q(P, MSG_TARGET_AREA, 0);
    if (!checkDrillTargetZoneMissed(P, false).a) return WINLOSE_LOSE;
    q(P, MSG_NICE_SERVE, 0);
    if (V.pointOutcome === POINTOUTCOME.WINNER) { incCounter(P, 0); return WINLOSE_WIN; }
  }
  q(P, MSG_DOUBLE_FAULT, 0);
  return WINLOSE_LOSE;
}

// ---- hooks ----
const H = (addr, fn) => [B, addr, auto(fn)];
const sp1Handle = servicePracticeHandlePointEnd(servicePractice1QueueOutcomeMessage, 1);
const sp3Handle = servicePracticeHandlePointEnd(servicePractice3QueueOutcomeMessage, 5);
const sm1PointEnd = serviceMatchPointEnd(serviceMatch1JudgePoint, serviceMatch1HandlePointEnd);
const sm2PointEnd = serviceMatchPointEnd(serviceMatch2JudgePoint, serviceMatch2HandlePointEnd);
export const HOOKS = [
  // Service Match 1
  H(0x484C, () => {}),                                                            // ServiceMatch1Hook_MinigameStart
  H(0x484D, updateDrillAbortCountdown),                                           // ServiceMatch1Hook_PerFrame
  H(0x4851, serviceMatchPointStart),                                              // ServiceMatch1Hook_PointStart
  H(0x4863, sm1PointEnd),                                                         // ServiceMatch1Hook_PointEnd
  H(0x489A, DISABLED), H(0x489E, DISABLED),                                       // ServiceMatch1Hook_RallyTick / _Bounce
  H(0x48A2, P => judgeOn(P, serviceMatch1JudgePoint, 1)),                         // ServiceMatch1Hook_BallHit
  H(0x48A6, serviceMatch1HandlePointEnd),                                         // ServiceMatch1HandlePointEnd
  ...judgeHooks(serviceMatch1JudgePoint, [0x48FC, 0x4905, 0x490E, 0x4918], [2, 3]),   // ServiceMatch1JudgeOn*
  [B, 0x4922, hook((P, c) => serviceMatch1JudgePoint(P, c.a))],                   // ServiceMatch1JudgePoint
  // Service Match 2
  H(0x49E7, updateDrillAbortCountdown),                                           // ServiceMatch2Hook_PerFrame
  H(0x49EB, P => { queueDrillMarker(P, P.A.drillGate1); queueDrillMarker(P, P.A.drillGate2); }),   // ServiceMatch2Hook_Draw
  H(0x49F2, serviceMatch2PointStart),                                             // ServiceMatch2Hook_PointStart
  H(0x4A27, sm2PointEnd),                                                         // ServiceMatch2Hook_PointEnd
  H(0x4A5E, P => judgeOn(P, serviceMatch2JudgePoint, 3)),                         // ServiceMatch2Hook_RallyTick
  H(0x4A62, DISABLED),                                                            // ServiceMatch2Hook_Bounce
  H(0x4A66, P => judgeOn(P, serviceMatch2JudgePoint, 1)),                         // ServiceMatch2Hook_BallHit
  H(0x4AAC, serviceMatch2HandlePointEnd),                                         // ServiceMatch2HandlePointEnd
  ...judgeHooks(serviceMatch2JudgePoint, [0x4B2E, 0x4B37, 0x4B40, 0x4B4A], [2]),   // ServiceMatch2JudgeOn*
  [B, 0x4B53, hook((P, c) => serviceMatch2JudgePoint(P, c.a))],                   // ServiceMatch2JudgePoint
  // Service Match 3
  H(0x4C33, updateDrillAbortCountdown),                                           // ServiceMatch3Hook_PerFrame
  H(0x4C37, serviceMatchPointStart),                                              // ServiceMatch3Hook_PointStart
  H(0x4C49, serviceMatch3PointEnd),                                               // ServiceMatch3Hook_PointEnd
  H(0x4C8C, DISABLED), H(0x4C90, DISABLED),                                       // ServiceMatch3Hook_RallyTick / _Bounce
  H(0x4C94, P => judgeOn(P, serviceMatch3JudgePoint, 1)),                         // ServiceMatch3Hook_BallHit
  H(0x4C98, serviceMatch3HandlePointEnd),                                         // ServiceMatch3HandlePointEnd
  ...judgeHooks(serviceMatch3JudgePoint, [0x4D17, 0x4D20, 0x4D29, 0x4D33], [2, 3]),   // ServiceMatch3JudgeOn*
  [B, 0x4D3D, hook((P, c) => serviceMatch3JudgePoint(P, c.a))],                   // ServiceMatch3JudgePoint
  // Service Practice 1
  H(0x4DF2, practiceInit),                                                        // ServicePractice1DrillInit
  H(0x4E08, updateDrillAbortCountdown),                                           // ServicePractice1Hook_PerFrame
  H(0x4E0C, servicePractice1PointStart),                                          // ServicePractice1Hook_PointStart
  H(0x4E25, servicePracticePointEnd(sp1Handle, servicePractice1EvaluateResult)),  // ServicePractice1Hook_PointEnd
  H(0x4E3F, servicePractice1EvaluateResult),                                      // ServicePractice1EvaluateResult
  H(0x4E74, () => {}),                                                            // ServicePractice1Hook_RallyTick
  H(0x4E75, servicePracticeBounce),                                               // ServicePractice1Hook_Bounce
  H(0x4E7F, unusedServeSecondBounceSound),                                        // UnusedServeSecondBounceSound_1
  H(0x4E8E, servicePractice1BallHit),                                             // ServicePractice1Hook_BallHit
  H(0x4EC2, sp1Handle),                                                           // ServicePractice1HandlePointEnd
  [B, 0x4F19, hook((P, c) => unusedStoreDrillServeTargetResult(P, c.f & 0x10))],  // UnusedStoreDrillServeTargetResult
  H(0x4F22, servicePractice1QueueOutcomeMessage),                                 // ServicePractice1QueueOutcomeMessage
  // Service Practice 2
  H(0x4F79, practiceInit),                                                        // ServicePractice2DrillInit
  H(0x4F8F, P => { setCounter(P, 1, 2); setCounter(P, 2, 2); }),                  // ServicePractice2Hook_MinigameStart
  H(0x4F98, updateDrillAbortCountdown),                                           // ServicePractice2Hook_PerFrame
  H(0x4F9C, servicePracticePointStart(ServicePractice2PointStartDrillPositions)), // ServicePractice2Hook_PointStart
  H(0x4FB5, servicePracticePointEnd(servicePractice2HandlePointEnd, servicePractice2EvaluateResult)),   // ServicePractice2Hook_PointEnd
  H(0x4FCF, servicePractice2EvaluateResult),                                      // ServicePractice2EvaluateResult
  H(0x5031, () => {}),                                                            // ServicePractice2Hook_RallyTick
  H(0x5032, servicePractice2Bounce),                                              // ServicePractice2Hook_Bounce
  H(0x5041, unusedServeSecondBounceSound),                                        // UnusedServeSecondBounceSound_2
  H(0x5050, servicePractice2BallHit),                                             // ServicePractice2Hook_BallHit
  H(0x5082, servicePractice2HandlePointEnd),                                      // ServicePractice2HandlePointEnd
  H(0x50E5, servicePractice2SetupShotTarget),                                     // ServicePractice2SetupShotTarget
  H(0x513F, servicePractice2QueueOutcomeMessage),                                 // ServicePractice2QueueOutcomeMessage
  // Service Practice 3
  H(0x51DD, practiceInit),                                                        // ServicePractice3DrillInit
  H(0x51F3, P => { setCounter(P, 1, 4); P.V.drillIsPracticeLesson = 1; }),        // ServicePractice3Hook_MinigameStart
  H(0x51FE, P => { updateDrillAbortCountdown(P); if (P.V.rallyLength === 1) recordGateCrossOnServe(P); }),   // ServicePractice3Hook_PerFrame
  H(0x520C, P => { queueDrillMarker(P, P.A.drillGate1); queueDrillMarker(P, P.A.drillGate2); }),   // ServicePractice3Hook_Draw
  H(0x5213, servicePractice3PointStart),                                          // ServicePractice3Hook_PointStart
  H(0x5237, servicePracticePointEnd(sp3Handle, servicePractice3EvaluateResult)),  // ServicePractice3Hook_PointEnd
  H(0x5251, servicePractice3EvaluateResult),                                      // ServicePractice3EvaluateResult
  H(0x52A5, () => {}),                                                            // ServicePractice3Hook_RallyTick
  H(0x52A6, servicePracticeBounce),                                               // ServicePractice3Hook_Bounce
  H(0x52B0, servicePractice3BallHit),                                             // ServicePractice3Hook_BallHit
  H(0x52C3, servicePractice3SetupShotTarget),                                     // ServicePractice3SetupShotTarget
  H(0x5324, sp3Handle),                                                           // ServicePractice3HandlePointEnd
  H(0x537B, servicePractice3QueueOutcomeMessage),                                 // ServicePractice3QueueOutcomeMessage
];
