// Match flow: the per-frame update, scoring, court positions, points/games/sets and the camera (bank $08:
// match_08, project_08, court_08, match_loop_08, point_08, changeover_08 in the disassembly).
import * as ball from "./ball.js";
import { POINTOUTCOME } from "./ball.js";
import * as chars from "./chars.js";
import { setBallTrailColor } from "./shot.js";

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
  recordFaultStat(E);
  recordDoubleFaultStat(E);
  if (E.S.pointOutcome !== POINTOUTCOME.WINNER) return;
  recordDropShotWinnerStat(E); recordLobWinnerStat(E); recordSmashAceStat(E); recordReturnAceStat(E); recordServiceAceStat(E);
}
// RecordDropShotWinnerStat.bumpStat 08:5CB2: the hitter's counter (8 bytes per character from base), up to 99
function bumpStat(E, base) { const a = base + u8(E.S.lastShotCharIndex * 8), v = E.mem.u8(a); if (v < 0x63) E.mem.w8(a, v + 1); }
const winnerStat = (E, kind, base) => { E.S.pointWinnerShotType = kind; bumpStat(E, base); };
// 08:5C47 RecordFaultStat / 08:5C53 RecordDoubleFaultStat / 08:5C5F RecordServiceAceStat / 08:5C6F RecordReturnAceStat /
// 08:5C7F RecordSmashAceStat / 08:5C90 RecordLobWinnerStat / 08:5CA1 RecordDropShotWinnerStat
export function recordFaultStat(E) { if (E.S.pointOutcome === POINTOUTCOME.FAULT) bumpStat(E, 0xC8C5); }
export function recordDoubleFaultStat(E) { if (E.S.pointOutcome === POINTOUTCOME.DOUBLE_FAULT) bumpStat(E, 0xC8C6); }
export function recordServiceAceStat(E) { if (E.S.serviceAceFlag) winnerStat(E, POINTWINNER.SERVICE_ACE, 0xC8C0); }
export function recordReturnAceStat(E) { if (E.S.returnAceFlag) winnerStat(E, POINTWINNER.RETURN_ACE, 0xC8C1); }
export function recordSmashAceStat(E) { if (E.S.currentShotType === SHOTTYPE_SMASH) winnerStat(E, POINTWINNER.SMASH_ACE, 0xC8C2); }
export function recordLobWinnerStat(E) { if (E.S.currentShotType === SHOTTYPE_LOB) winnerStat(E, POINTWINNER.LOB, 0xC8C3); }
export function recordDropShotWinnerStat(E) { if (E.S.currentShotType === SHOTTYPE_DROP) winnerStat(E, POINTWINNER.DROP_SHOT, 0xC8C4); }
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
// actors by depth, markers and shadows) are E.ext's.
export function updateMatchFrame(E) {
  const S = E.S;
  E.setBank(4);
  if (!S.matchSimFrozen) {
    E.ext.clearSpriteSlots(E);
    updateMatchCamera(E);
    chars.updateAllChars(E);
    ball.handleBallHitEvent(E);
    ball.handleBallTouchCharEvent(E);
    ball.updateBallVisuals(E);
    ball.tickRallyTimers(E);
    ball.handleBallBounceEvent(E);
    ball.callModeHook(E, 0);
    E.ext.updateAllObjSprites(E);                                        // 09:4695 (through FarCallVector)
  }
  if (!S.matchDrawFrozen) E.ext.drawActorsByDepth(E);
  if (!S.matchSimFrozen) E.ext.updateMinigameTargets(E);                 // 0A:65C3 UpdateMinigameTargets (drills)
  if (!S.matchDrawFrozen) E.ext.drawMarkersAndShadows(E);
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
export function loadPositionRecord(E, table, index, mirror) {                  // 08:48ED LoadPositionRecord (.doubles: mirror)
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
export function finalizeServeSideOrientation(E) {
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
// `call X` into the coroutine gen, returning to 08:ret (the host keeps the ROM's stack depth: E.ext.call)
export const call = (E, ret, gen) => E.ext.call(E, ret, gen);

// 08:440D ReadMatchInputHeld / 08:4415 ReadMatchInputPressed: the pad (hPlayerInputFlags / hInputRisingEdge), or in
// a link exchange the frame's link input (08:4425 ReadScriptedMatchInput, hLinkInput)
export const inputHeld = E => (E.S.linkExchangeActive ? E.S.linkInput : E.mem.u8(0xFF90));
export const inputPressed = E => (E.S.linkExchangeActive ? E.S.linkInput : E.mem.u8(0xFF94));

// 08:4465 StepMatchFrame (registers and the WRAM bank kept)
export function* stepMatchFrame(E) {
  const S = E.S, bank = E.mem.u8(0xFF96);
  E.ext.push(E, "af", "bc", "de", "hl", "bank");                        // push af ... hl, push_wram_bank
  if (S.linkExchangeActive) yield* E.ext.runLinkMatchFrame(E);           // (farcall at 08:4471)
  else {
    yield* call(E, 0x4479, E.ext.advanceFrame(E));
    updateMatchFrame(E);
    S.matchFrameCounter = (S.matchFrameCounter + 1) & 0xFF;
  }
  if (!S.matchSimFrozen) yield* call(E, 0x4489, handlePauseMenu(E));     // (then CheckDebugStatsEditorHotkey: a bare ret)
  E.setBank(bank);
  E.ext.pop(E, 5);
}
// 08:4428 StepMatchFrames / 08:4436 StepMatchFramesSkippable (A or B ends the wait)
export function* stepMatchFrames(E, n) { do { if (E.S.matchFramesAbort) return; yield* call(E, 0x4432, stepMatchFrame(E)); } while (--n & 0xFF); }
export function* stepMatchFramesSkippable(E, n) {
  for (;;) {
    if (E.S.matchFramesAbort) return;
    yield* call(E, 0x4440, stepMatchFrame(E));
    if (inputHeld(E) & 0x03) return;
    if (E.mem.u8(0xC4EE) & 1) continue;                                  // wDebugMatchFlags bit 0: wait forever
    if (!(--n & 0xFF)) return;
  }
}
// 08:4452 RunMatchFramesUntilInput: until anything but SELECT/START is held
export function* runMatchFramesUntilInput(E) {
  while (!E.S.matchFramesAbort) {
    yield* call(E, 0x445B, stepMatchFrame(E));
    if (inputHeld(E) & 0xF3) return;
  }
}
// 08:4496 HandlePauseMenu: START opens the pause menu (RunMatchPauseMenu 06:4074, a menu loop of its own)
export function* handlePauseMenu(E) {
  const S = E.S;
  if (!(inputPressed(E) & 0x08) || S.pauseDisabled || S.matchWinLoseFlag) return;
  S.matchSimFrozen = 0xFF; S.matchDrawFrozen = 0xFF;
  yield* E.ext.runMatchPauseMenu(E);                                     // (farcall at 08:44AE)
  yield* call(E, 0x44B4, reinitPointAfterPause(E));
  S.matchDrawFrozen = 0; S.matchSimFrozen = 0;
}
// 08:44BD ReinitPointAfterPause: the view option may have changed
export function* reinitPointAfterPause(E) {
  const S = E.S;
  if (S.courtViewLocked) return;
  assignCourtPositions(E);
  if (!S.courtViewFlipChanged) return;
  yield* call(E, 0x44CD, refreshCourtAfterEndChange(E));
  resetCameraForServe(E); updateMatchCamera(E);
  chars.forEachCharBank(E, () => moveCharToBaseCourtPosition(E));
  E.ext.loadServeGfx(E);
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
export function selectScoreboardLayout(E) {
  const S = E.S, m = E.mem;
  if (S.matchContext !== 2) { m.w8(0xC494, (S.onCourtCharCount - 2) & 3); return; }
  // wDrillIsPracticeLesson 3, wMinigameHighScoreMode 7, the wall / tennis machine / Boo Blast minigames 6, else 4
  let b = 3;
  if (!m.u8(0xC7BB)) { b = 7; if (!m.u8(0xC7BC)) { b = 6; if (!m.u8(0xC7B9) && !m.u8(0xC7B8) && !m.u8(0xC7BA)) b = 4; } }
  m.w8(0xC494, b);
}

// 08:4714 RunMatchPlayLoop: sets until the match is decided (or quit)
export function* runMatchPlayLoop(E) {
  const S = E.S;
  if (S.gameMode === GAMEMODE_ISLAND_OPEN || !S.matchContext) S.changeoverSkipBanner = 1;
  do {
    yield* call(E, 0x4729, playSet(E));
    if (S.matchAbortFlag & MATCHABORT_MATCH) return;
  } while (!S.matchWinLoseFlag);
}
// 08:4737 PlaySet / CheckSetComplete: games (or the tiebreak) until the set is decided (PlaySet pushes
// CheckSetComplete, 08:4745, as the game's return address and jumps to it)
export function* playSet(E) {
  const S = E.S;
  for (;;) {
    yield* call(E, 0x4745, S.tiebreakerIndicator ? playTiebreak(E) : playGame(E));
    if (S.matchAbortFlag & MATCHABORT_MATCH) return;
    if (S.setWinLoseFlag) { S.changeoverSkipBanner = 1; return; }
  }
}
// CheckSetComplete.playGame 08:4758
export function* playGame(E) {
  const S = E.S;
  E.mem.w8(0xC7BD, 0);                                                   // wScoreDisplayIsTiebreak
  assignCourtPositions(E);
  yield* call(E, 0x4762, refreshCourtAfterEndChange(E));
  yield* call(E, 0x4765, runChangeoverSequence(E));
  do {
    assignCourtPositions(E);
    yield* call(E, 0x476B, playPoint(E));
    if (S.matchAbortFlag & MATCHABORT_MATCH) return;
  } while (!S.gameWinLoseFlag);
  if (S.tiebreakerIndicator) yield* call(E, 0x4781, walkCharsOffCourt(E));
}
// CheckSetComplete.tiebreak 08:4782
export function* playTiebreak(E) {
  const S = E.S;
  E.mem.w8(0xC7BD, 1);
  initTiebreakPointCounter(E);
  S.changeoverSkipBanner = 1;
  E.ext.playMusic(E, 0x0E);                                               // sound BGM_TIEBREAK
  E.ext.showCourtBanner(E, 0x0F); yield* call(E, 0x479B, stepMatchFrames(E, 80));
  E.ext.hideCourtBanner(E); yield* call(E, 0x47A3, stepMatchFrames(E, 15));
  do {
    assignCourtPositions(E);
    yield* call(E, 0x47A9, refreshCourtAfterEndChange(E));
    yield* call(E, 0x47AC, runChangeoverSequence(E));
    yield* call(E, 0x47AF, playPoint(E));
    if (S.matchAbortFlag & MATCHABORT_MATCH) break;
    if (S.totalPointsScoredInCurrentGame >= 0x18) S.totalPointsScoredInCurrentGame = 0;
  } while (!S.gameWinLoseFlag);
  E.ext.playMusic(E, S.matchBGM);
}

// 08:4CB9 ResetPointState
export function resetPointState(E) {
  const S = E.S, m = E.mem;
  S.rallyNetFrames = 0; S.ballBounceCount = 0; S.rallyLength = 0; S.ballHitEvent = 0; S.ballTouchCharFlag = 0; S.ballHasBouncedFlag = 0;
  S.serviceAceFlag = 0; S.returnAceFlag = 0; S.landingMarkerActive = 0; S.pointWinnerShotType = 0; S.matchAbortFlag = 0;
  S.pointOutcomeSide = 0; S.pointOutcome = 0; m.w8(0xFFDD, 0); S.pauseDisabled = 0;
  S.offscreenArrowsEnabled = 1;
  ball.resetBallState(E, c => setBallTrailColor(E, c));
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
  E.ext.loadServeGfx(E);
  yield* call(E, 0x4D1D, stepMatchFrame(E));
  yield* call(E, 0x4D20, announcePointSituation(E));
  chars.forEachCharBank(E, () => chars.setCharState(E, E.rom.u8(8, 0x4FA0 + E.C.serveRole)));   // ServeRoleCharStateTable_08: 3 5 4 5
  do {
    yield* call(E, 0x4D29, stepMatchFrame(E));
    if (S.matchAbortFlag & MATCHABORT_POINT) { S.matchAbortFlag &= 0xFE; return; }
  } while (!S.pointOutcome);
  if (S.pointOutcome === POINTOUTCOME.BALL_HIT_PLAYER) yield* call(E, 0x4D42, stepMatchFrames(E, 40));
  endPointBallEffects(E);
  E.ext.updateScorePanelDisplay(E);
  scorePoint(E);
  yield* call(E, 0x4D4E, stepMatchFrame(E));
  E.ext.updatePointDigitsDisplay(E);
  yield* call(E, 0x4D54, stepMatchFrame(E));
  yield* call(E, 0x4D57, startPointEndReactions(E));
  yield* call(E, 0x4D5A, resolvePointOutcome(E));
}
// 08:4D8C AnnouncePointSituation: BGM (08:4D63 SetPointSituationBgm) and the match/set/game point banner, placed by
// which end the side with the game point plays from
export function setPointSituationBgm(E) {                                // 08:4D63 SetPointSituationBgm
  const S = E.S;
  E.ext.playMusic(E, S.matchPointFlag || S.setPointFlag ? 0x0F : S.gamePointFlag ? 0x10 : S.tiebreakerIndicator ? 0x0E : S.matchBGM);
}
export function* announcePointSituation(E) {
  const S = E.S;
  evaluatePointSituation(E);
  setPointSituationBgm(E);
  let d;
  if (S.matchPointFlag) d = 0x0A;
  else if (S.setPointFlag) d = 0x09;
  else if (!S.gamePointFlag) return;
  else d = (S.currentServingPlayer ^ (((S.gamePointFlag + 1) & 0xFF) >> 1)) & 1 ? 0x08 : 0x07;   // break point / game point
  E.ext.showCourtBanner(E, d);
  const b = ((S.gamePointFlag + 1) & 0xFF) >> 1;
  E.setBank(4);
  const c = E.C.courtPos, rrca = (c >> 1) | ((c & 1) << 7);
  E.ext.setObjPosition(E, ball.OBJSLOT3, (rrca ^ b) & 1 ? 0x3460 : 0x3420);
  yield* call(E, 0x4DE6, stepMatchFrames(E, 10));
  yield* call(E, 0x4DEB, stepMatchFramesSkippable(E, 0x1E));
  E.ext.hideCourtBanner(E);
  yield* call(E, 0x4DF3, stepMatchFrames(E, 10));
}
// 08:4DF4 ResolvePointOutcome: centre the camera, the outcome's banner or message, then the score sequence (it
// pushes ResolvePointResultSequence, 08:4E22, as the outcome routine's return address and jumps to it)
export function* resolvePointOutcome(E) {
  const S = E.S;
  setCameraTarget(E, S.matchCameraX, S.matchCameraY);
  yield* call(E, 0x4E06, stepMatchFrame(E));
  const o = S.pointOutcome, outcome = o >= 1 && o <= 5 ? resolveCalledPoint : o === 6 ? resolveWinnerPoint
    : o === 7 ? resolveServeVolleyedPoint : o === 8 ? resolveWrongReceiverPoint : null;   // (0 and 9: RetStub)
  if (outcome) yield* call(E, 0x4E22, outcome(E));
  yield* resolvePointResultSequence(E);
}
// 08:4E8D ResolveCalledPoint: the call's banner (FAULT, OUT, ...)
export function* resolveCalledPoint(E) {
  E.ext.showCourtBanner(E, E.S.pointOutcome); yield* call(E, 0x4E9A, stepMatchFrames(E, 30));
  E.ext.hideCourtBanner(E); yield* call(E, 0x4EA2, stepMatchFrames(E, 10));
}
// 08:4E6D ResolveWinnerPoint: the winning shot's banner (SERVICE ACE, ...), if it was a special one
export function* resolveWinnerPoint(E) {
  const S = E.S;
  if (!S.pointWinnerShotType) return;
  E.ext.showCourtBanner(E, (S.pointWinnerShotType + 0x17) & 0xFF);
  yield* call(E, 0x4E7F, stepMatchFrames(E, 10)); yield* call(E, 0x4E84, stepMatchFramesSkippable(E, 0x1E));
  E.ext.hideCourtBanner(E); yield* call(E, 0x4E8C, stepMatchFrames(E, 10));
}
// 08:4E49 ResolveServeVolleyedPoint (text $174, a box at cell 5,4, 10 x 7) / 08:4E5B ResolveWrongReceiverPoint
// (text $175, at cell 2,4, 15 x 7)
// (the message windows: farcalls at 08:4E52 and 08:4E64)
export function* resolveServeVolleyedPoint(E) { yield* E.ext.showMessageWindow(E, 0x0174, 0x0504, 0x0A07, 0x4E52); yield* call(E, 0x4E5A, stepMatchFrames(E, 10)); }
export function* resolveWrongReceiverPoint(E) { yield* E.ext.showMessageWindow(E, 0x0175, 0x0204, 0x0F07, 0x4E64); yield* call(E, 0x4E6C, stepMatchFrames(E, 10)); }
// 08:4E22 ResolvePointResultSequence: the match, set, game or point result, then 08:4E3E DelayAfterPointResolution
// (pushed as the result routine's return address)
export function* resolvePointResultSequence(E) {
  const S = E.S;
  const result = S.matchWinLoseFlag ? showMatchEndSequence(E) : S.setWinLoseFlag ? showGameEndSequence(E, 0x0C)
    : S.gameWinLoseFlag ? showGameEndSequence(E, 0x0B) : showPointScoreSequence(E);
  yield* call(E, 0x4E3E, result);
  yield* delayAfterPointResolution(E);
}
export function* delayAfterPointResolution(E) {
  yield* call(E, 0x4E43, stepMatchFramesSkippable(E, 0x46));
  yield* call(E, 0x4E48, stepMatchFrames(E, 10));
}
// 08:4EA3 ShowPointScoreSequence
export function* showPointScoreSequence(E) {
  const S = E.S;
  if (!S.pointWinLoseFlag) return;
  E.ext.spawnGameScoreDisplayObjs(E);
  yield* call(E, 0x4EB0, stepMatchFrames(E, 10));
  yield* call(E, 0x4EB5, stepMatchFramesSkippable(E, 0x0A));
  if (S.deuceIndicator) { E.sfx(0x69); yield* call(E, 0x4EC0, stepMatchFrame(E)); }   // sound SFX_DEUCE
  E.ext.updateScorePanelDisplay(E);
  yield* call(E, 0x4EC8, stepMatchFrames(E, 10));
  yield* call(E, 0x4ECD, stepMatchFramesSkippable(E, 0x1E));
  E.ext.dismissGameScoreDisplayObjs(E);
}
// 08:4ED1 ShowMatchEndSequence (a Mario minigame: the minigame's own result, d = $17 lost / level + $12 won)
export function* showMatchEndSequence(E) {
  const S = E.S;
  if (S.gameMode === 0x08) {                                             // GAMEMODE_MARIO_MINIGAME
    const lost = S.matchWinLoseFlag & 0x80;                              // (farcalls at 08:4EE0 / 08:4EEA)
    yield* E.ext.showMinigamePointResult(E, lost ? 0x17 : (E.mem.u8(0xC376) + 0x12) & 0xFF, lost ? 0x4EE0 : 0x4EEA);   // wMinigameLevel
    return;
  }
  E.ext.showCourtBanner(E, 0x0D);
  yield* call(E, 0x4EF8, stepMatchFrames(E, 10));
  E.ext.spawnWinLoseResultObj(E, S.gameWinLoseFlag & 0xFF);
  yield* call(E, 0x4F03, stepMatchFrames(E, 10));
  yield* call(E, 0x4F08, stepMatchFramesSkippable(E, 0x2D));
  E.ext.dismissWinLoseResultObj(E); E.ext.hideCourtBanner(E);
}
// 08:4F0F ShowSetEndSequence (the sets won, banner $0C) / 08:4F23 ShowGameEndSequence (the games won, banner $0B):
// the score digits, the banner, the winner's icon, then the game result
export function* showGameEndSequence(E, banner) {
  const S = E.S, sets = banner === 0x0C;
  E.ext.loadPlayer1ScoreDigitGfx(E, sets ? S.player1SetsWon : S.player1GamesWon, 1);
  E.ext.loadPlayer2ScoreDigitGfx(E, sets ? S.player2SetsWon : S.player2GamesWon, 1);
  yield* call(E, 0x4F3A, stepMatchFrame(E));
  E.ext.showCourtBanner(E, banner);
  yield* call(E, 0x4F43, stepMatchFrames(E, 10));
  E.ext.spawnWinLoseResultObj(E, S.gameWinLoseFlag & 0xFF);
  yield* call(E, 0x4F4E, stepMatchFrames(E, 10));
  yield* call(E, 0x4F53, stepMatchFramesSkippable(E, 0x28));
  E.ext.dismissWinLoseResultObj(E);
  yield* call(E, 0x4F5B, stepMatchFrames(E, 10));
  E.ext.spawnGameResultObj(E);
  yield* call(E, 0x4F63, stepMatchFrames(E, 10));
  yield* call(E, 0x4F68, stepMatchFramesSkippable(E, 0x28));
  E.ext.dismissGameResultObj(E); E.ext.hideCourtBanner(E);
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
export function endPointBallEffects(E) {
  const S = E.S;
  S.ballTrailEnabled = 0; setBallTrailColor(E, 0); S.landingMarkerActive = 0; S.matchAbortFlag &= 0xFE;
}
// 08:4FB8 StartPointEndReactions: everyone stops where they are and reacts; teammates spread
export function* startPointEndReactions(E) {
  chars.forEachCharBank(E, () => charPointEndReaction(E));
  spreadTeammateTargets(E);
  yield* call(E, 0x4FC6, stepMatchFrames(E, 10));
}
export function charPointEndReaction(E) {
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
  if (n === 3) spreadBothTeamPairs(E); else spreadFarTeamPair(E);
}
// a team's two walk-target depths spread apart (characters in banks a and b)
function spreadPair(E, a, b) {
  E.setBank(a); const d1 = E.C.posDepthInt & 0xFFFF; E.setBank(b); const d2 = E.C.posDepthInt & 0xFFFF;
  const r = computePairSpread(d1, d2);
  E.setBank(a); E.C.walkTargetDepth = r.de; E.setBank(b); E.C.walkTargetDepth = r.bc;
}
// 08:5001 SpreadBothTeamPairs (falls into 08:5034 SpreadFarTeamPair; bank 4 mapped after)
export function spreadBothTeamPairs(E) { spreadPair(E, 4, 6); spreadFarTeamPair(E); }
export function spreadFarTeamPair(E) { spreadPair(E, 5, 7); E.setBank(4); }
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
export function moveCharToBaseCourtPosition(E) { const p = getCharBaseCourtPosition(E); chars.setCharPosAndTarget(E, p.x, p.depth); }   // 08:4CB2
// 08:5F43 RefreshCourtAfterEndChange: two frozen frames while the court's scoreboard is redrawn mirrored
export function* refreshCourtAfterEndChange(E) {
  const S = E.S;
  if (!S.courtViewFlipChanged) return;
  const sim = S.matchSimFrozen, draw = S.matchDrawFrozen;
  E.ext.push(E, sim << 8, draw << 8);                                    // push af (x2: the two flags)
  S.matchSimFrozen = 0xFF; S.matchDrawFrozen = 0xFF;
  yield* call(E, 0x5F5B, stepMatchFrame(E));
  E.ext.refreshCourtScoreboard(E);
  yield* call(E, 0x5F61, stepMatchFrame(E));
  E.ext.uploadCourtScoreboardRows(E);
  E.ext.pop(E, 2);
  S.matchDrawFrozen = draw; S.matchSimFrozen = sim;
  E.setBank(4);
}
// 08:5F8C RunChangeoverSequence: the CHANGE ENDS banner and the walk to the new ends
export function* runChangeoverSequence(E) {
  const S = E.S;
  S.pauseDisabled = 1;
  let walk = true;
  if (!S.changeoverSkipBanner) {
    if (!S.changeEndsPending) walk = false;
    else { yield* call(E, 0x5FA0, stepMatchFrame(E)); E.ext.showCourtBanner(E, 0x00); yield* call(E, 0x5FA8, stepMatchFrame(E)); }
  }
  if (walk) {
    yield* call(E, 0x5FAB, stepMatchFrame(E)); yield* call(E, 0x5FAE, walkCharsToNewEnds(E));
    E.ext.hideCourtBanner(E); yield* call(E, 0x5FB4, stepMatchFrame(E));
  }
  S.changeoverSkipBanner = 0; S.changeEndsPending = 0;
}
// 08:5FBC WalkCharsToNewEnds
export function* walkCharsToNewEnds(E) {
  const S = E.S;
  S.offscreenArrowsEnabled = 0;
  ball.resetBallState(E, c => setBallTrailColor(E, c));
  const t = getServeCameraTarget(E); snapCameraTo(E, t.x, t.y);
  chars.forEachCharBank(E, () => startCharChangeoverWalk(E));
  do {
    yield* call(E, 0x5FD2, stepMatchFrame(E));
    if (inputPressed(E) & 0x0B) break;
  } while (!checkAllCharsPhaseDone(E));
  chars.forEachCharBank(E, () => placeCharAtBasePosition(E));
}
// 08:5FE5 StartCharChangeoverWalk, 08:6003 PlaceCharAtBasePosition, 08:6010 WalkCharsOffCourt
export function startCharChangeoverWalk(E) {
  chars.setCharState(E, CHARSTATE.WALK);
  chars.setCharFacing(E, 0x80);
  const p = getCharChangeoverPosition(E); chars.setCharPosAndTarget(E, p.x, p.depth);
  const b = getCharBaseCourtPosition(E); chars.setCharTarget(E, b.x, b.depth);
  E.C.flags &= ~3;
}
export function placeCharAtBasePosition(E) {
  const p = getCharBaseCourtPosition(E); chars.setCharPosAndTarget(E, p.x, p.depth);
  chars.setCharFacing(E, E.C.baseFacing);
}
export function* walkCharsOffCourt(E) {
  const S = E.S;
  S.pauseDisabled = 1; S.offscreenArrowsEnabled = 0;
  const t = getServeCameraTarget(E); setCameraTarget(E, t.x, t.y);
  chars.forEachCharBank(E, () => startCharWalkOffCourt(E));
  do {
    yield* call(E, 0x6028, stepMatchFrame(E));
    if (inputPressed(E) & 0x0B) break;
  } while (!checkAllCharsPhaseDone(E));
  yield* call(E, 0x6039, stepMatchFrames(E, 20));
  const t2 = getServeCameraTarget(E); snapCameraTo(E, t2.x, t2.y);
  chars.forEachCharBank(E, () => parkCharOffCourt(E));
}
// 08:6046 StartCharWalkOffCourt: walk to the changeover point / 08:6059 ParkCharOffCourt: off the court ($FE0, $FE0)
export function startCharWalkOffCourt(E) {
  chars.setCharState(E, CHARSTATE.WALK);
  const p = getCharChangeoverPosition(E); chars.setCharTarget(E, p.x, p.depth);
  E.C.flags &= ~3;
}
export function parkCharOffCourt(E) { chars.setCharPosAndTarget(E, 0x0FE0, 0x0FE0); }
// 08:6063 CheckAllCharsPhaseDone: the AND of every on-court character's wCharStatePhase (nonzero = all done)
export function checkAllCharsPhaseDone(E) {
  const n = E.S.onCourtCharCountMinus1, order = [[4], [5, 4], [7, 5, 4], [6, 7, 5, 4]][n];
  let b = 0xFF;
  for (const k of order) { E.setBank(k); b &= E.C.statePhase; }
  return b;
}
