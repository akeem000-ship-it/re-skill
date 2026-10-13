// Match flow: the per-frame update, scoring, court positions, points/games/sets and the camera (bank $08:
// match_08, project_08, court_08, match_loop_08, point_08, changeover_08 in the disassembly).
import * as ball from "./ball.js";
import { POINTOUTCOME } from "./ball.js";
import * as chars from "./chars.js";

export const SHOTTYPE_SMASH = 0x09, SHOTTYPE_LOB = 0x0A, SHOTTYPE_DROP = 0x0B;
export const POINTWINNER = { SERVICE_ACE: 1, RETURN_ACE: 2, SMASH_ACE: 3, LOB: 4, DROP_SHOT: 5 };
const u8 = v => v & 0xFF;

// ---- scoring (08:5AD7-5C9F, 08:5CC3-5DC3) ----
// 08:5AD7 ScorePoint: fault rule, ace flags, the winner from the last hitter's view, stats, then the score
export function scorePoint(E) {
  handleServeFault(E);
  flagServiceReturnAce(E);
  E.S.pointWinLoseFlag = resolvePointWinner(E);
  updatePointStats(E);
  applyPointToScore(E);
}
// 08:5AE6 ApplyPointToScore: point, deuce compression, game, set (tiebreak entry), match
export function applyPointToScore(E) {
  const S = E.S, tb = S.tiebreakerIndicator !== 0;
  awardPoint(E);
  resetAdvantageToDeuce(E, tb ? 7 : 4);
  S.gameWinLoseFlag = tb ? checkTiebreakGameWon(E) : checkGameWon(E);
  awardGame(E);
  S.setWinLoseFlag = checkSetWon(E);
  awardSet(E);
  S.matchWinLoseFlag = checkMatchWon(E);
}
// 08:5B2E EvaluatePointSituation: dry-run the next point for the leader -> game/set/match point flags
export function evaluatePointSituation(E) {
  const S = E.S, m = E.mem, diff = u8(S.player1PointsWon - S.player2PointsWon);
  if (diff === 0) { S.gamePointFlag = 0; S.setPointFlag = 0; S.matchPointFlag = 0; return; }
  const saved = Array.from({ length: 16 }, (_, i) => m.u8(0xC8E0 + i));
  S.pointWinLoseFlag = diff & 0x80 ? -1 : 1;
  applyPointToScore(E);
  const g = S.gameWinLoseFlag, s = S.setWinLoseFlag, mt = S.matchWinLoseFlag;
  saved.forEach((v, i) => m.w8(0xC8E0 + i, v));                       // restore the 16 score bytes
  S.gamePointFlag = g; S.setPointFlag = s; S.matchPointFlag = mt;
}
// 08:5B7F HandleServeFault: a served ball that lost the point (net/out) is a fault, the second one a double fault
export function handleServeFault(E) {
  const S = E.S;
  if (S.rallyLength !== 1 || S.pointOutcomeSide !== -1) return;
  if (!S.serveFaultFlag) { S.serveFaultFlag = 1; S.pointOutcome = POINTOUTCOME.FAULT; }
  else { S.serveFaultFlag = 0; S.pointOutcome = POINTOUTCOME.DOUBLE_FAULT; }
}
// 08:5BA7 FlagServiceReturnAce: a winner on the serve or on the return
export function flagServiceReturnAce(E) {
  const S = E.S;
  if (S.pointOutcome !== POINTOUTCOME.WINNER) return;
  if (S.rallyLength === 1) S.serviceAceFlag = 1;
  if (S.rallyLength === 2) S.returnAceFlag = 1;
}
// 08:5BC6 ResetAdvantageToDeuce: both counters at b (advantage-advantage) go back to b - 1
export function resetAdvantageToDeuce(E, b) {
  const S = E.S;
  if (S.player1PointsWon === b && S.player2PointsWon === b) { S.player1PointsWon = b - 1; S.player2PointsWon = b - 1; }
}
// 08:5BDB AwardSet / 08:5BF4 AwardGame / 08:5C14 AwardPoint: $01 = player 1's side, $FF = player 2's, 0 = none
const side = flag => (flag & 0x7F) === 0 ? 0 : flag & 0x80 ? 2 : 1;    // `add a / ret z / jr nc` ($80 also counts as none)
export function awardSet(E) {
  const S = E.S, w = side(S.setWinLoseFlag & 0xFF); if (!w) return;
  if (w === 1) S.player1SetsWon++; else S.player2SetsWon++;
  S.player1GamesWon = 0; S.player2GamesWon = 0; S.tiebreakerIndicator = 0;
}
export function awardGame(E) {
  const S = E.S, w = side(S.gameWinLoseFlag & 0xFF); if (!w) return;
  if (w === 1) S.player1GamesWon++; else S.player2GamesWon++;
  S.player1PointsWon = 0; S.player2PointsWon = 0; S.totalPointsScoredInCurrentGame = 0; S.deuceIndicator = 0;
  S.totalGamesWonInMatch++;
}
export function awardPoint(E) {
  const S = E.S, w = side(S.pointWinLoseFlag & 0xFF); if (!w) return;
  if (w === 1) S.player1PointsWon++; else S.player2PointsWon++;
  S.serveFaultFlag = 0; S.totalPointsScoredInCurrentGame++;
}
// 08:5C2B UpdatePointStats: faults always; on a winner the last applicable shot type wins
// (drop < lob < smash ace < return ace < service ace), each a per-character counter saturating at 99
export function updatePointStats(E) {
  const S = E.S, o = S.pointOutcome;
  const bump = base => { const a = base + u8(S.lastShotCharIndex * 8); const v = E.mem.u8(a); if (v < 0x63) E.mem.w8(a, v + 1); };
  if (o === POINTOUTCOME.FAULT) bump(0xC8C5);
  if (o === POINTOUTCOME.DOUBLE_FAULT) bump(0xC8C6);
  if (o !== POINTOUTCOME.WINNER) return;
  const t = S.currentShotType;
  if (t === SHOTTYPE_DROP) { S.pointWinnerShotType = POINTWINNER.DROP_SHOT; bump(0xC8C4); }
  if (t === SHOTTYPE_LOB) { S.pointWinnerShotType = POINTWINNER.LOB; bump(0xC8C3); }
  if (t === SHOTTYPE_SMASH) { S.pointWinnerShotType = POINTWINNER.SMASH_ACE; bump(0xC8C2); }
  if (S.returnAceFlag) { S.pointWinnerShotType = POINTWINNER.RETURN_ACE; bump(0xC8C1); }
  if (S.serviceAceFlag) { S.pointWinnerShotType = POINTWINNER.SERVICE_ACE; bump(0xC8C0); }
}
// 08:5D71 EvalWinByTwo: level b (equal counts there -> $80), minimum c
export function evalWinByTwo(d, e, b, c) {
  const diff = u8(d - e);
  if (diff === 0) return e === b ? 0x80 : 0;
  if (diff & 0x80) return u8(-diff) >= 2 && e >= c ? 0xFF : 0;
  return diff >= 2 && d >= c ? 0x01 : 0;
}
// 08:5CC3 CheckMatchWon: (sets + 1) / 2 sets
export function checkMatchWon(E) {
  const S = E.S, need = u8(S.matchTypeNumberOfSets + 1) >> 1, diff = u8(S.player1SetsWon - S.player2SetsWon);
  if (diff === 0) return 0;
  if (diff & 0x80) return S.player2SetsWon >= need ? 0xFF : 0;
  return S.player1SetsWon >= need ? 0x01 : 0;
}
// 08:5CE9 CheckSetWon: 6 games (2 in a short set), 2 clear; level -> tiebreak; 7-6 (3-2) counts as 8-6 (4-2)
export function checkSetWon(E) {
  const S = E.S, short = S.matchTypeNumberOfGames === 2, cap = short ? 3 : 7, n = short ? 2 : 6;
  let d = S.player1GamesWon, e = S.player2GamesWon;
  if (d === cap) d++;
  if (e === cap) e++;
  const r = evalWinByTwo(d, e, n, n);
  if (r !== 0x80) return r;
  S.tiebreakerIndicator = 1; return 0;
}
// 08:5D37 CheckGameWon / 08:5D54 CheckTiebreakGameWon: 4 (7) points, 2 clear; level at 3 (6) = deuce
export function checkGameWon(E) { return gameWon(E, 3, 4); }
export function checkTiebreakGameWon(E) { return gameWon(E, 6, 7); }
function gameWon(E, b, c) {
  const S = E.S; S.deuceIndicator = 0;
  const r = evalWinByTwo(S.player1PointsWon, S.player2PointsWon, b, c);
  if (r !== 0x80) return r;
  S.deuceIndicator = 1; return 0;
}
// 08:5D9A ResolvePointWinner: the outcome side is relative to the last hitter; even character indexes are
// player 1's side. A body hit loses the point for the touched character's side.
export function resolvePointWinner(E) {
  const S = E.S, o = S.pointOutcome;
  if (o === POINTOUTCOME.FAULT || o === POINTOUTCOME.LET) return 0;
  if (o === POINTOUTCOME.BALL_HIT_PLAYER) return S.ballTouchCharIndex & 1 ? 1 : -1;
  return S.lastShotCharIndex & 1 ? -S.pointOutcomeSide : S.pointOutcomeSide;
}

// 08:41F7 UpdateMatchFrame: one simulation frame (bank 4 mapped). The drawing steps (sprite slots, HUD objects,
// actors by depth, markers and shadows) are left to the renderer.
export function updateMatchFrame(E) {
  const S = E.S;
  E.setBank(4);
  if (S.matchSimFrozen) return;
  updateMatchCamera(E);
  chars.updateAllChars(E);
  ball.handleBallHitEvent(E);
  ball.handleBallTouchCharEvent(E);
  ball.updateBallVisuals(E);
  ball.tickRallyTimers(E);
  ball.handleBallBounceEvent(E);
  ball.callModeHook(E, 0);
  if (E.minigameTargets) E.minigameTargets(E);                          // 0A:65C3 UpdateMinigameTargets (drills)
}

// ---- camera (changeover_08) ----
// 08:61DC UpdateMatchCamera: 64 units per frame towards the target (16 directions, AngleFromVectorCoarse),
// snapping on overshoot; while wCameraFollowBall the target is the ball's ground projection. The scroll is the
// camera position / 2 (x) and * 3/8 (y) plus a base, in 1/32 px, rounded down to whole pixels.
export function updateMatchCamera(E) {
  const S = E.S, m = E.mem, M = E.M;
  if (S.cameraFollowBall) { S.matchCameraTargetX = S.ballGroundProjX; S.matchCameraTargetY = S.ballGroundProjY; }
  const dx = (S.matchCameraTargetX - S.matchCameraX) & 0xFFFF, dy = (S.matchCameraTargetY - S.matchCameraY) & 0xFFFF;
  const v = M.vectorFromLengthAndAngleRaw(0x40, M.angleFromVectorCoarse(dy, dx));
  S.matchCameraX += v.hl; S.matchCameraY += v.de;
  if (((((S.matchCameraTargetX - S.matchCameraX) & 0xFFFF) >> 8) ^ (dx >> 8)) & 0x80) S.matchCameraX = S.matchCameraTargetX;   // overshot: snap
  if (((((S.matchCameraTargetY - S.matchCameraY) & 0xFFFF) >> 8) ^ (dy >> 8)) & 0x80) S.matchCameraY = S.matchCameraTargetY;
  // x: (camera >> 1) + $620, clamped to 0..$C00 (with the ROM's quirk: a high byte of $80-$8B also gives $C00)
  let x = ((S.matchCameraX >> 1) + 0x0620) & 0xFFFF; const hx = x >> 8;
  if (hx & 0x80) x = 0;
  if (((hx - 0x0C) & 0x80) === 0) x = 0x0C00;
  x &= 0xFFE0;
  m.w8(0xFF8B, (x << 3) >> 8);                                          // hScrollX
  S.cameraOffsetX = (0x1010 - x) & 0xFFFF;
  const q = S.matchCameraY >> 2;
  let y = (q + (q >> 1) + 0x0720) & 0xFFE0;
  m.w8(0xFF8A, (y << 3) >> 8);                                          // hScrollY
  S.cameraOffsetY = (0x1010 - y) & 0xFFFF;
}
// 08:61AA SnapCameraTo (x = hl, y = de) / 08:61C9 SetCameraTarget / 08:6199 GetServeCameraTarget / 08:6192 ResetCameraForServe
export function snapCameraTo(E, x, y) {
  const S = E.S; S.matchCameraX = x; S.matchCameraTargetX = x; S.matchCameraY = y; S.matchCameraTargetY = y; S.cameraFollowBall = 0;
}
export function setCameraTarget(E, x, y) { const S = E.S; S.matchCameraTargetX = x; S.matchCameraTargetY = y; S.cameraFollowBall = 0; }
export function getServeCameraTarget(E) { return { x: 0, y: E.S.servingCharCourtPos & 2 ? 0xF880 : 0xFE80 }; }
export function resetCameraForServe(E) { const t = getServeCameraTarget(E); snapCameraTo(E, t.x, t.y); }

// ---- court positions and the server (match_loop_08) ----
// each character's wCharCourtPos (bit 1 = far end, bit 0 = left half) and wCharServeRole (0 server,
// 1 receiver, 2/3 partners) come from 8-byte records [4 court codes, 4 roles] in bank 8
const flipCode = (E, b) => { E.C.courtPos ^= b; };                     // 08:69FE FlipCharPositionCode
const toggleRow = E => { E.C.serveRole ^= 2; };                         // 08:4971 ToggleCharCourtRow
function loadPositionRecord(E, table, index, mirror) {                  // 08:48ED LoadPositionRecord (.doubles: mirror)
  const rec = table + ((index * 8) & 0xFF) + (index * 8 > 0xFF ? 0x100 : 0);
  for (let k = 0; k < 4; k++) { E.setBank(4 + k); E.C.courtPos = E.rom.u8(8, rec + k) ^ (mirror ? 3 : 0); }
  for (let k = 0; k < 4; k++) { E.setBank(4 + k); E.C.serveRole = E.rom.u8(8, rec + 4 + k); }
}
// 08:47E2 AssignCourtPositions: the record for this game (by wTotalGamesWonInMatch & 3) with the service box
// flipped on odd points, or the tiebreak record (by the point counter); then FinalizeServeSideOrientation
export function assignCourtPositions(E) {
  const S = E.S, n = S.onCourtCharCountMinus1;
  if (S.tiebreakerIndicator) {
    const table = E.rom.u16(8, 0x48E5 + n * 2);                         // TiebreakPositionPtrs
    loadPositionRecord(E, table, S.totalPointsScoredInCurrentGame, (S.totalGamesWonInMatch & 2) !== 0);
  } else {
    loadPositionRecord(E, E.rom.u16(8, 0x483F + n * 2), S.totalGamesWonInMatch & 3, false);   // GamePositionPtrs
    if (S.totalPointsScoredInCurrentGame & 1) {
      // near side: FlipNearCharPosition for 2-3 characters, FlipBothCharPositions for 4
      if (n < 3) { E.setBank(4); flipCode(E, 1); }
      else { E.setBank(4); if (E.C.serveRole & 1) { toggleRow(E); E.setBank(6); toggleRow(E); } else { E.setBank(4); flipCode(E, 1); E.setBank(6); flipCode(E, 1); } }
      // far side: FlipFarCharPosition for 2-3 characters, FlipFarBothCharPositions for 4 (and 3)
      if (n < 2) { E.setBank(5); flipCode(E, 1); }
      else { E.setBank(4); if (!(E.C.serveRole & 1)) { E.setBank(5); toggleRow(E); E.setBank(7); toggleRow(E); } else { E.setBank(5); flipCode(E, 1); E.setBank(7); flipCode(E, 1); } }
    }
  }
  finalizeServeSideOrientation(E);
}
// 08:47F1 FinalizeServeSideOrientation
function finalizeServeSideOrientation(E) {
  checkServerEndChanged(E);
  updateViewFlipState(E);
  flipAllCharPositions(E);
  identifyServingPlayer(E);
  for (const k of [3, 2, 1, 0]) { E.setBank(4 + k); setCharFacingFromCourtPos(E); }   // ForEachCharBank
  E.setBank(4);
}
// 08:4C19 CheckServerEndChanged: character 0 changed ends -> wChangeEndsPending
export function checkServerEndChanged(E) {
  const S = E.S; E.setBank(4);
  const now = E.C.courtPos, prev = S.prevCourtPos; S.prevCourtPos = now;
  if ((prev ^ now) & 2) S.changeEndsPending = 1;
}
// 08:4C33 UpdateViewFlipState: keep the human's end nearest the camera when the view option asks for it
export function updateViewFlipState(E) {
  const S = E.S, c = S.courtViewOption && (S.prevCourtPos & 2) ? 1 : 0, old = S.courtViewFlipped;
  S.courtViewFlipped = c; S.courtViewFlipChanged = (old - c) & 0xFF;
}
// 08:4C4E FlipAllCharPositions: a flipped view mirrors every court code
export function flipAllCharPositions(E) {
  if (!E.S.courtViewFlipped) return;
  for (const b of [7, 6, 5, 4]) { E.setBank(b); flipCode(E, 3); }
}
// 08:46E7 FindServerCharBank: the first bank (4-6, else 7) whose role is 0
export function findServerCharBank(E) {
  let b = 4;
  for (; b < 7; b++) { E.setBank(b); if (E.C.serveRole === 0) break; }
  E.setBank(4); return b;
}
// 08:4C7A IdentifyServingPlayer
export function identifyServingPlayer(E) {
  const S = E.S, b = findServerCharBank(E);
  E.setBank(b);
  S.servingCharWramBank = b; S.currentServingPlayer = E.C.index; S.servingCharCourtPos = E.C.courtPos;
  E.setBank(4);
}
// 08:4C99 SetCharFacingFromCourtPos: face the net (CourtPosFacingTable_08: $C0 near end, $40 far end)
export function setCharFacingFromCourtPos(E) {
  const C = E.C, f = E.rom.u8(8, 0x4CAE + C.courtPos);
  C.baseFacing = f; C.facingDesired = f; C.facingShown = f;
}
// 08:47CD InitTiebreakPointCounter: the counter's phase (multiples of 6) from the game count
export function initTiebreakPointCounter(E) { E.S.totalPointsScoredInCurrentGame = E.rom.u8(8, 0x47DE + (E.S.totalGamesWonInMatch & 3)); }


// ---- the match as a coroutine (match_08, match_loop_08, point_08, court_08, changeover_08) ----
// The ROM's match code blocks on frames: every wait spins StepMatchFrame. Here each routine is a generator and
// StepMatchFrame yields once, at the VBlank wait (AdvanceFrame), before it runs the simulation frame. The driver
// writes the pad bytes for that frame (hPlayerInputFlags $FF90, hInputPressed $FF91, hInputRisingEdge $FF94)
// and resumes; so the engine's yields line up with the frames of the real game.
export const CHARSTATE = { INERT: 0, RALLY: 1, RECOVER: 2, SERVE: 3, AWAIT_SERVE: 4, STANDBY: 5, WALK: 6, POINT_END: 7 };
const CHARANIM_IDLE = 0x01, MATCHABORT_POINT = 0x01, MATCHABORT_MATCH = 0x80, GAMEMODE_ISLAND_OPEN = 0x02, GAMEMODE_LINK_MATCH = 0x09;
const inputHeld = E => E.mem.u8(0xFF90), inputPressed = E => E.mem.u8(0xFF94);     // ReadMatchInputHeld / Pressed (local play)

// 08:4465 StepMatchFrame
export function* stepMatchFrame(E) {
  const S = E.S, bank = E.mem.u8(0xFF96);
  if (S.linkExchangeActive) throw new Error("link play is not ported");
  yield "frame";                                                         // AdvanceFrame
  updateMatchFrame(E);
  S.matchFrameCounter = (S.matchFrameCounter + 1) & 0xFF;
  if (!S.matchSimFrozen) yield* handlePauseMenu(E);
  E.setBank(bank);
}
// 08:4428 StepMatchFrames / 08:4436 StepMatchFramesSkippable (A or B ends the wait)
export function* stepMatchFrames(E, n) { do { if (E.S.matchFramesAbort) return; yield* stepMatchFrame(E); } while (--n & 0xFF); }
export function* stepMatchFramesSkippable(E, n) {
  for (;;) {
    if (E.S.matchFramesAbort) return;
    yield* stepMatchFrame(E);
    if (inputHeld(E) & 0x03) return;
    if (E.mem.u8(0xC4EE) & 1) continue;                                  // wDebugMatchFlags bit 0: wait forever
    if (!(--n & 0xFF)) return;
  }
}
// 08:4496 HandlePauseMenu: START opens the pause menu (06:4074, a menu loop of its own: E.pauseMenu drives it)
function* handlePauseMenu(E) {
  const S = E.S;
  if (!(inputPressed(E) & 0x08) || S.pauseDisabled || S.matchWinLoseFlag) return;
  S.matchSimFrozen = 0xFF; S.matchDrawFrozen = 0xFF;
  if (!E.pauseMenu) throw new Error("pause menu: no E.pauseMenu handler");
  yield* E.pauseMenu(E);
  yield* reinitPointAfterPause(E);
  S.matchDrawFrozen = 0; S.matchSimFrozen = 0;
}
// 08:44BD ReinitPointAfterPause: the view option may have changed
function* reinitPointAfterPause(E) {
  const S = E.S;
  if (S.courtViewLocked) return;
  assignCourtPositions(E);
  if (!S.courtViewFlipChanged) return;
  yield* refreshCourtAfterEndChange(E);
  resetCameraForServe(E); updateMatchCamera(E);
  chars.forEachCharBank(E, () => moveCharToBaseCourtPosition(E));
  E.events.push(["serveGfx"]);
  E.setBank(S.servingCharWramBank); chars.setCharState(E, CHARSTATE.SERVE); E.setBank(4);
}

// 08:40AB ResetMatchState
export function resetMatchState(E, vblankCounter = 0) {
  const S = E.S, m = E.mem;
  E.setBank(4);
  for (let i = 0; i < 0xE0; i++) m.w8(0xC400 + i, 0);
  if (!m.u8(0xC8A7)) for (let i = 0; i < 0x30; i++) m.w8(0xC8C0 + i, 0);   // wKeepMatchStatsFlag: per-character stats and the score block
  m.w8(0xC8A7, 0);
  S.matchSimFrozen = 0xFF; S.pauseDisabled = 1;
  S.player1PointsWon = 0; S.player2PointsWon = 0; S.totalPointsScoredInCurrentGame = 0; S.serveFaultFlag = 0; S.deuceIndicator = 0;
  S.courtLimitX = -0x1B0; S.courtLimitDepth = -0x4E0; S.netHeight = 0x60;
  S.aimSpreadBase = S.matchIsDoubles ? 0x0320 : 0x0220;
  S.onCourtCharCountMinus1 = (S.onCourtCharCount - 1) & 3;
  m.w8(0xC4DB, S.matchTypeNumberOfSets >> 1);                           // wRulesSetsIndex
  m.w8(0xC4DC, (S.matchTypeNumberOfGames >> 2) & 1);                    // wRulesGamesIndex (rrca twice)
  selectScoreboardLayout(E);
  S.matchRngState = S.gameMode === GAMEMODE_LINK_MATCH ? 0 : vblankCounter;
  S.matchFrameCounter = 0; m.w8(0xFFDD, 0);
}
// 08:454B SelectScoreboardLayout
function selectScoreboardLayout(E) {
  const S = E.S, m = E.mem;
  if (S.matchContext !== 2) { m.w8(0xC494, (S.onCourtCharCount - 2) & 3); return; }
  let b = 3;
  if (!m.u8(0xC7BB)) { b = 7; if (!m.u8(0xC7BA)) { b = 6; if (!m.u8(0xC7B9) && !m.u8(0xC7B8) && !m.u8(0xC7BC)) b = 4; } }
  m.w8(0xC494, b);
}

// 08:4714 RunMatchPlayLoop: sets until the match is decided (or quit)
export function* runMatchPlayLoop(E) {
  const S = E.S;
  if (S.gameMode === GAMEMODE_ISLAND_OPEN || !S.matchContext) S.changeoverSkipBanner = 1;
  do {
    yield* playSet(E);
    if (S.matchAbortFlag & MATCHABORT_MATCH) return;
  } while (!S.matchWinLoseFlag);
}
// 08:4737 PlaySet / CheckSetComplete: games (or the tiebreak) until the set is decided
export function* playSet(E) {
  const S = E.S;
  for (;;) {
    if (S.tiebreakerIndicator) yield* playTiebreak(E); else yield* playGame(E);
    if (S.matchAbortFlag & MATCHABORT_MATCH) return;
    if (S.setWinLoseFlag) { S.changeoverSkipBanner = 1; return; }
  }
}
// CheckSetComplete.playGame 08:4758
function* playGame(E) {
  const S = E.S;
  E.mem.w8(0xC7BD, 0);                                                   // wScoreDisplayIsTiebreak
  assignCourtPositions(E);
  yield* refreshCourtAfterEndChange(E);
  yield* runChangeoverSequence(E);
  do {
    assignCourtPositions(E);
    yield* playPoint(E);
    if (S.matchAbortFlag & MATCHABORT_MATCH) return;
  } while (!S.gameWinLoseFlag);
  if (S.tiebreakerIndicator) yield* walkCharsOffCourt(E);
}
// CheckSetComplete.tiebreak 08:4782
function* playTiebreak(E) {
  const S = E.S;
  E.mem.w8(0xC7BD, 1);
  initTiebreakPointCounter(E);
  S.changeoverSkipBanner = 1;
  E.sfx(0x0E);                                                            // BGM_TIEBREAK
  E.banner(0x0F); yield* stepMatchFrames(E, 80); E.banner(-1); yield* stepMatchFrames(E, 15);
  do {
    assignCourtPositions(E);
    yield* refreshCourtAfterEndChange(E);
    yield* runChangeoverSequence(E);
    yield* playPoint(E);
    if (S.matchAbortFlag & MATCHABORT_MATCH) break;
    if (S.totalPointsScoredInCurrentGame >= 0x18) S.totalPointsScoredInCurrentGame = 0;
  } while (!S.gameWinLoseFlag);
  E.events.push(["bgm", S.matchBGM]);
}

// 08:4CB9 ResetPointState
export function resetPointState(E) {
  const S = E.S, m = E.mem;
  S.rallyNetFrames = 0; S.ballBounceCount = 0; S.rallyLength = 0; S.ballHitEvent = 0; S.ballTouchCharFlag = 0; S.ballHasBouncedFlag = 0;
  S.serviceAceFlag = 0; S.returnAceFlag = 0; S.landingMarkerActive = 0; S.pointWinnerShotType = 0; S.matchAbortFlag = 0;
  S.pointOutcomeSide = 0; S.pointOutcome = 0; m.w8(0xFFDD, 0); S.pauseDisabled = 0;
  S.offscreenArrowsEnabled = 1;
  ball.resetBallState(E, c => { S.ballTrailColor = c; });
  if (m.u8(0xC7B8)) return;                                              // wMinigameUsesTennisMachine
  resetCameraForServe(E);
  S.courtLimitX = -0x1B0; S.courtLimitDepth = -0x2A0;                   // the serve is judged against the service box
  chars.forEachCharBank(E, () => resetCharForPoint(E));
}
// 08:4D0F PlayPoint
export function* playPoint(E) {
  const S = E.S;
  resetPointState(E);
  S.courtViewLocked &= ~2;
  E.events.push(["serveGfx"]);
  yield* stepMatchFrame(E);
  yield* announcePointSituation(E);
  chars.forEachCharBank(E, () => chars.setCharState(E, E.rom.u8(8, 0x4FA0 + E.C.serveRole)));   // ServeRoleCharStateTable_08: 3 5 4 5
  do {
    yield* stepMatchFrame(E);
    if (S.matchAbortFlag & MATCHABORT_POINT) { S.matchAbortFlag &= 0xFE; return; }
  } while (!S.pointOutcome);
  if (S.pointOutcome === POINTOUTCOME.BALL_HIT_PLAYER) yield* stepMatchFrames(E, 40);
  endPointBallEffects(E);
  E.events.push(["scorePanel"]);
  scorePoint(E);
  yield* stepMatchFrame(E);
  E.events.push(["pointDigits"]);
  yield* stepMatchFrame(E);
  yield* startPointEndReactions(E);
  yield* resolvePointOutcome(E);
}
// 08:4D8C AnnouncePointSituation: BGM and the match/set/game point banner
function* announcePointSituation(E) {
  const S = E.S;
  evaluatePointSituation(E);
  E.events.push(["bgm", S.matchPointFlag || S.setPointFlag ? 0x0F : S.gamePointFlag ? 0x10 : S.tiebreakerIndicator ? 0x0E : S.matchBGM]);
  let d;
  if (S.matchPointFlag) d = 0x0A;
  else if (S.setPointFlag) d = 0x09;
  else if (!S.gamePointFlag) return;
  else d = (S.currentServingPlayer ^ (((S.gamePointFlag + 1) & 0xFF) >> 1)) & 1 ? 0x08 : 0x07;
  E.banner(d);
  E.setBank(4);
  yield* stepMatchFrames(E, 10);
  yield* stepMatchFramesSkippable(E, 0x1E);
  E.banner(-1);
  yield* stepMatchFrames(E, 10);
}
// 08:4DF4 ResolvePointOutcome: centre the camera, the outcome's banner or message, then the score sequence
function* resolvePointOutcome(E) {
  const S = E.S;
  setCameraTarget(E, S.matchCameraX, S.matchCameraY);
  yield* stepMatchFrame(E);
  const o = S.pointOutcome;
  if (o >= 1 && o <= 5) { E.banner(o); yield* stepMatchFrames(E, 30); E.banner(-1); yield* stepMatchFrames(E, 10); }
  else if (o === 6) {
    if (S.pointWinnerShotType) { E.banner(S.pointWinnerShotType + 0x17); yield* stepMatchFrames(E, 10); yield* stepMatchFramesSkippable(E, 0x1E); E.banner(-1); yield* stepMatchFrames(E, 10); }
  } else if (o === 7 || o === 8) {
    if (!E.messageWindow) throw new Error("message window: no E.messageWindow handler");
    yield* E.messageWindow(E, o === 7 ? 0x0174 : 0x0175);                // ShowMessageWindow (text 30:372 / 30:373)
    yield* stepMatchFrames(E, 10);
  }
  // ResolvePointResultSequence
  if (S.matchWinLoseFlag) yield* showMatchEndSequence(E);
  else if (S.setWinLoseFlag) yield* showGameEndSequence(E, 0x0C);
  else if (S.gameWinLoseFlag) yield* showGameEndSequence(E, 0x0B);
  else yield* showPointScoreSequence(E);
  // DelayAfterPointResolution
  yield* stepMatchFramesSkippable(E, 0x46);
  yield* stepMatchFrames(E, 10);
}
function* showPointScoreSequence(E) {
  const S = E.S;
  if (!S.pointWinLoseFlag) return;
  E.events.push(["scoreDisplay", 1]);
  yield* stepMatchFrames(E, 10);
  yield* stepMatchFramesSkippable(E, 0x0A);
  if (S.deuceIndicator) { E.sfx(0x69); yield* stepMatchFrame(E); }      // SFX_DEUCE
  E.events.push(["scorePanel"]);
  yield* stepMatchFrames(E, 10);
  yield* stepMatchFramesSkippable(E, 0x1E);
  E.events.push(["scoreDisplay", 0]);
}
function* showMatchEndSequence(E) {
  const S = E.S;
  if (S.gameMode === 0x08) { E.events.push(["minigameResult", S.matchWinLoseFlag]); return; }   // GAMEMODE_MARIO_MINIGAME
  E.banner(0x0D);
  yield* stepMatchFrames(E, 10);
  E.events.push(["winLose", S.gameWinLoseFlag]);
  yield* stepMatchFrames(E, 10);
  yield* stepMatchFramesSkippable(E, 0x2D);
  E.events.push(["winLose", 0]); E.banner(-1);
}
// ShowSetEndSequence / 08:4F23 ShowGameEndSequence
function* showGameEndSequence(E, banner) {
  const S = E.S;
  E.events.push(["scoreDigits"]);
  yield* stepMatchFrame(E);
  E.banner(banner);
  yield* stepMatchFrames(E, 10);
  E.events.push(["winLose", S.gameWinLoseFlag]);
  yield* stepMatchFrames(E, 10);
  yield* stepMatchFramesSkippable(E, 0x28);
  E.events.push(["winLose", 0]);
  yield* stepMatchFrames(E, 10);
  E.events.push(["gameResult", 1]);
  yield* stepMatchFrames(E, 10);
  yield* stepMatchFramesSkippable(E, 0x28);
  E.events.push(["gameResult", 0]); E.banner(-1);
}
// 08:4F6F ResetCharForPoint
export function resetCharForPoint(E) {
  const C = E.C;
  chars.setCharState(E, CHARSTATE.INERT);
  const p = getCharBaseCourtPosition(E);
  chars.setCharPosAndTarget(E, p.x, p.depth);
  chars.setCharAnimation(E, CHARANIM_IDLE);
  C.flags &= ~3;                                                         // CHARB_RECOIL, CHARB_DIVING
  C.velX = 0; C.velDepth = 0; C.velHeight = 0;
}
// 08:4FA4 EndPointBallEffects
function endPointBallEffects(E) {
  const S = E.S;
  S.ballTrailEnabled = 0; S.ballTrailColor = 0; S.landingMarkerActive = 0; S.matchAbortFlag &= 0xFE;
}
// 08:4FB8 StartPointEndReactions: everyone stops where they are and reacts; teammates spread
function* startPointEndReactions(E) {
  chars.forEachCharBank(E, () => charPointEndReaction(E));
  spreadTeammateTargets(E);
  yield* stepMatchFrames(E, 10);
}
function charPointEndReaction(E) {
  const C = E.C, f = E.S.pointWinLoseFlag;
  C.pointResult = C.index & 1 ? -f : f;
  chars.setCharState(E, CHARSTATE.POINT_END);
  chars.setCharTarget(E, C.posXInt & 0xFFFF, C.posDepthInt & 0xFFFF);
  C.velX = 0; C.velDepth = 0; C.velHeight = 0;
}
// 08:4FF5 SpreadTeammateTargets (3 and 4 characters)
export function spreadTeammateTargets(E) {
  const n = E.S.onCourtCharCountMinus1;
  if (n < 2) return;
  const pair = (a, b) => {
    E.setBank(a); const d1 = E.C.posDepthInt & 0xFFFF; E.setBank(b); const d2 = E.C.posDepthInt & 0xFFFF;
    const r = computePairSpread(d1, d2);
    E.setBank(a); E.C.walkTargetDepth = r.de; E.setBank(b); E.C.walkTargetDepth = r.bc;
  };
  if (n === 3) pair(4, 6);
  pair(5, 7);
  E.setBank(4);
}
// 08:506E ComputePairSpread (de = first depth, hl = second): within $200 of each other they are moved exactly
// $200 apart around their midpoint, never closer than $100 to the net -> { de: first, bc: second }
export function computePairSpread(de, hl) {
  const S16 = v => (v << 16) >> 16, neg = v => (-v) & 0xFFFF;
  let diff = (hl - de) & 0xFFFF; if (diff & 0x8000) diff = neg(diff);
  if (diff >= 0x200) return { de, bc: hl };
  let h = hl, e = de;
  if (h & 0x8000) { h = neg(h); e = neg(e); }
  let mid = ((S16((h + e) & 0xFFFF) >> 1) - 0x100) & 0xFFFF;             // the midpoint less $100
  if (((mid - 0x100) & 0xFFFF) & 0x8000) mid = 0x0100;
  let first, second;
  if (h < e) { second = mid; first = (mid + 0x200) & 0xFFFF; }        // sub e / sbc d: carry when h < e
  else { first = mid; second = (mid + 0x200) & 0xFFFF; }
  if (hl & 0x8000) { first = neg(first); second = neg(second); }
  return { de: first, bc: second };
}

// ---- changeovers and walks (court_08, changeover_08) ----
// 08:6098 GetCharBaseCourtPosition: GetCharBaseCourtPositionTable (08:60C8) by role, mirrored by end and lateral half -> { x, depth }
export function getCharBaseCourtPosition(E) {
  const C = E.C, rec = 0x60C8 + C.serveRole * 4;
  let x = E.rom.u16(8, rec), depth = E.rom.u16(8, rec + 2);
  if (C.courtPos & 2) depth = (-depth) & 0xFFFF;
  if (C.courtPos & 1) x = (-x) & 0xFFFF;
  return { x, depth };
}
// 08:60D8 GetCharChangeoverPosition: the walk's side point, mirrored by end and by a flipped view
export function getCharChangeoverPosition(E) {
  const C = E.C, rec = 0x6107 + C.serveRole * 4;
  let x = E.rom.u16(8, rec), depth = E.rom.u16(8, rec + 2);
  if (C.courtPos & 2) depth = (-depth) & 0xFFFF;
  if (E.S.courtViewFlipped) x = (-x) & 0xFFFF;
  return { x, depth };
}
function moveCharToBaseCourtPosition(E) { const p = getCharBaseCourtPosition(E); chars.setCharPosAndTarget(E, p.x, p.depth); }   // 08:4CB2
// 08:5F43 RefreshCourtAfterEndChange: two frozen frames while the court is redrawn mirrored
function* refreshCourtAfterEndChange(E) {
  const S = E.S;
  if (!S.courtViewFlipChanged) return;
  const sim = S.matchSimFrozen, draw = S.matchDrawFrozen;
  S.matchSimFrozen = 0xFF; S.matchDrawFrozen = 0xFF;
  yield* stepMatchFrame(E);
  E.events.push(["courtRedraw"]);
  yield* stepMatchFrame(E);
  S.matchDrawFrozen = draw; S.matchSimFrozen = sim;
  E.setBank(4);
}
// 08:5F8C RunChangeoverSequence: the CHANGE ENDS banner and the walk to the new ends
function* runChangeoverSequence(E) {
  const S = E.S;
  S.pauseDisabled = 1;
  let walk = true;
  if (!S.changeoverSkipBanner) {
    if (!S.changeEndsPending) walk = false;
    else { yield* stepMatchFrame(E); E.banner(0x00); yield* stepMatchFrame(E); }
  }
  if (walk) { yield* stepMatchFrame(E); yield* walkCharsToNewEnds(E); E.banner(-1); yield* stepMatchFrame(E); }
  S.changeoverSkipBanner = 0; S.changeEndsPending = 0;
}
// 08:5FBC WalkCharsToNewEnds
function* walkCharsToNewEnds(E) {
  const S = E.S;
  S.offscreenArrowsEnabled = 0;
  ball.resetBallState(E, c => { S.ballTrailColor = c; });
  const t = getServeCameraTarget(E); snapCameraTo(E, t.x, t.y);
  chars.forEachCharBank(E, () => startCharChangeoverWalk(E));
  do {
    yield* stepMatchFrame(E);
    if (inputPressed(E) & 0x0B) break;
  } while (!checkAllCharsPhaseDone(E));
  chars.forEachCharBank(E, () => placeCharAtBasePosition(E));
}
// 08:5FE5 StartCharChangeoverWalk, 08:6003 PlaceCharAtBasePosition, 08:6010 WalkCharsOffCourt
function startCharChangeoverWalk(E) {
  chars.setCharState(E, CHARSTATE.WALK);
  chars.setCharFacing(E, 0x80);
  const p = getCharChangeoverPosition(E); chars.setCharPosAndTarget(E, p.x, p.depth);
  const b = getCharBaseCourtPosition(E); chars.setCharTarget(E, b.x, b.depth);
  E.C.flags &= ~3;
}
function placeCharAtBasePosition(E) {
  const p = getCharBaseCourtPosition(E); chars.setCharPosAndTarget(E, p.x, p.depth);
  chars.setCharFacing(E, E.C.baseFacing);
}
function* walkCharsOffCourt(E) {
  const S = E.S;
  S.pauseDisabled = 1; S.offscreenArrowsEnabled = 0;
  const t = getServeCameraTarget(E); setCameraTarget(E, t.x, t.y);
  chars.forEachCharBank(E, () => { chars.setCharState(E, CHARSTATE.WALK); const p = getCharChangeoverPosition(E); chars.setCharTarget(E, p.x, p.depth); E.C.flags &= ~3; });
  do {
    yield* stepMatchFrame(E);
    if (inputPressed(E) & 0x0B) break;
  } while (!checkAllCharsPhaseDone(E));
  yield* stepMatchFrames(E, 20);
  const t2 = getServeCameraTarget(E); snapCameraTo(E, t2.x, t2.y);
  chars.forEachCharBank(E, () => chars.setCharPosAndTarget(E, 0x0FE0, 0x0FE0));
}
// 08:6063 CheckAllCharsPhaseDone: the AND of every on-court character's wCharStatePhase (nonzero = all done)
function checkAllCharsPhaseDone(E) {
  const n = E.S.onCourtCharCountMinus1, order = [[4], [5, 4], [7, 5, 4], [6, 7, 5, 4]][n];
  let b = 0xFF;
  for (const k of order) { E.setBank(k); b &= E.C.statePhase; }
  return b !== 0;
}
