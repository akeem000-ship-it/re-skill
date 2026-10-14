// The match engine's routines (web/js/engine: banks $07 and $08, the ball-path banks) hooked into the port at
// their ROM addresses: ROM code that calls one runs the engine's JS on the machine's RAM (P.E over P.bus) and
// gets back the registers the ROM routine leaves for its callers. The routines that wait for frames (the match
// loop, from StepMatchFrame up) are hooked in match_loop.js.
// Names and addresses from the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm).
import * as ball from "../../engine/ball.js";
import * as chars from "../../engine/chars.js";
import * as ai from "../../engine/ai.js";
import * as shot from "../../engine/shot.js";
import * as flow from "../../engine/flow.js";
import { engine } from "./engine_port.js";
import { add8, addHL, bitFlags, hlIndexed, negHL, FC } from "./leftovers.js";

const CHAR_SPRITE_DIRTY = 0xDF30, FACING_TILE_ROW = 0x7643;    // wCharSpriteDirty; ReloadCharFacingTilesTable (bank 8)
const H_MATH_SIGN = 0xFFA7, H_MUL_RESULT = 0xFFA8, SHOT_AIM_ANGLE = 0xC43A, BALL_X = 0xC402, BALL_DEPTH = 0xC406;

// [bank, addr, fn(E, cpu)]: fn runs the engine routine with the CPU's registers as arguments and writes back
// its result registers
const hook = (bank, addr, fn) => [bank, addr, (P, c) => { fn(engine(P), c); }];
const A = (c, v) => { c.a = v & 0xFF; };

// 08:7621 ReloadCharFacingTiles: when the sprite is dirty (bit 6), the frame's tiles for facing d: it ends with a jump
// to QueueCharFrameTiles (00:2E6B), made here with the registers of that jump, so the CPU is left as the ROM leaves it
function reloadCharFacingTiles(P, c) {
  const C = engine(P).C, dirty = C.spriteDirty;
  if (!(dirty & 0x40)) { c.hl = CHAR_SPRITE_DIRTY; c.f = bitFlags(dirty, 6, c.f); return; }
  C.spriteDirty = dirty & ~0x40;
  const row = P.rom.u8(8, hlIndexed(FACING_TILE_ROW, c.d).hl), frame = C.animFrame;
  const x4 = add8(add8(frame, frame).r, add8(frame, frame).r), sum = add8(add8(x4.r, frame).r, row);   // frame * 5 + row
  const de = addHL(sum.r, sum.r, sum.f);
  P.callRom(0, 0x2E6B, { a: sum.r, f: de.f, de: de.r, hl: de.r });          // QueueCharFrameTiles; b, c the caller's
  c.passCpu();
}
// 08:69C2 ReloadCharFrameGfx / 08:69D5 LoadCharChargeFlashGfx: the character's palette (its gfx bank's, 8 further on
// for the charge flash) into OBJ slot (attr & 7) + 8, through the far-call vector to 01:519A LoadDebugMenuPalette
// (01:4010 FarPtr_LoadDebugMenuPalette), as the ROM does: FarCallVector (00:07C5) leaves a = the ROM bank, f as
// it was called with, the rest as the palette routine leaves them
function loadCharPaletteThroughVector(P, c, bankOffset) {
  const C = engine(P).C, slot = add8(C.spriteAttr & 7, 8), b = (C.gfxBank + bankOffset) & 0xFF;
  P.callRom(0, 0x07C5, { a: b, f: bankOffset ? add8(C.gfxBank, bankOffset).f : slot.f, b, d: slot.r, hl: 0x0110 });
  c.passCpu();
}

// The multiplications behind the CPU player's aim prediction, with the bank-0 routines they are built on (GetTangent
// 00:1767, MulHLByDE 00:0C8F) called as the ROM calls them, so their registers flow through as in the ROM. (The
// engine's JS calls E.M directly; these are for ROM callers.)
// 08:59FB MulHLByDESigned32: hl * de signed, 32 bits into hMulResult and hl: hMathSign = h ^ d, MulHLByDE of the
// magnitudes, then NegateMulResultLow (08:5A0F: the low word in hMulResult and the high word in hl, negated) when
// the signs differ
function mulHLByDESigned32(P, c) {
  const sign = c.h ^ c.d;
  P.bus.w8(H_MATH_SIGN, sign);
  const hl = c.h & 0x80 ? negHL(c.hl).hl : c.hl, de = c.d & 0x80 ? negHL(c.de).hl : c.de;
  P.callRom(0, 0x0C8F, { hl, de });                                         // MulHLByDE (loads a and f itself)
  c.passCpu();
  if (!(sign & 0x80)) { c.a = sign; c.f = bitFlags(sign, 7, c.f); return; }
  const lo = add8(~P.bus.u8(H_MUL_RESULT) & 0xFF, 1), mid = add8(~P.bus.u8(H_MUL_RESULT + 1) & 0xFF, 0, lo.f & FC ? 1 : 0);
  const l = add8(~c.l & 0xFF, 0, mid.f & FC ? 1 : 0), h = add8(~c.h & 0xFF, 0, l.f & FC ? 1 : 0);
  P.bus.w8(H_MUL_RESULT, lo.r); P.bus.w8(H_MUL_RESULT + 1, mid.r);
  c.l = l.r; c.h = h.r; c.a = h.r; c.f = h.f;
}
// 08:5A51 MulHLByTangent: hl * tan(bc), de = the product's middle word (/ 256)
function mulHLByTangent(P, c) {
  const x = c.hl;
  P.callRom(0, 0x1767, { hl: c.bc });                                       // GetTangent
  P.callRom(8, 0x59FB, { de: x });                                          // MulHLByDESigned32 (above)
  c.passCpu();
  const mid = P.bus.u8(H_MUL_RESULT + 1);
  c.d = c.l; c.e = mid; c.a = mid;
}
// 08:7C86 PredictBallXAtDepth: where the ball crosses depth de on its course (wShotAimAngle): ballX + (de - ballDepth)
// * tan(angle), in hl
function predictBallXAtDepth(P, c) {
  const angle = P.bus.u16(SHOT_AIM_ANGLE), back = negHL(P.bus.u16(BALL_DEPTH)), dist = addHL(back.hl, c.de, back.f);
  P.callRom(8, 0x5A51, { a: back.a, f: dist.f, hl: dist.r, bc: angle });   // MulHLByTangent (above)
  c.passCpu();
  const ballX = P.bus.u16(BALL_X), x = addHL(ballX, c.de, c.f);
  c.hl = x.r; c.f = x.f; c.a = ballX & 0xFF;
}

// ---- the ball (ball_effects_08, match_08, match_frames_08) ----
const BALL = [
  hook(8, 0x43F6, (E, c) => A(c, ball.advanceMatchRng(E))),                                   // AdvanceMatchRng
  hook(8, 0x5767, E => ball.stepBallPhysics(E)),                                              // StepBallPhysics
  hook(8, 0x45E5, E => ball.updateBallAnglesAndSpeed(E)),                                     // UpdateBallAnglesAndSpeed
  hook(8, 0x55B4, E => ball.applyBallAirDrag(E)),                                             // ApplyBallAirDrag
  hook(8, 0x5613, E => ball.applyBallSpin(E)),                                                // ApplyBallSpin
  hook(8, 0x5814, E => ball.handleBallNetCrossing(E)),                                        // HandleBallNetCrossing
  hook(8, 0x5949, E => ball.bounceBallOffCourtFences(E)),                                     // BounceBallOffCourtFences
  hook(8, 0x46B0, E => ball.applyCourtBounceDamping(E)),                                      // ApplyCourtBounceDamping
  hook(8, 0x463A, (E, c) => A(c, ball.checkBallOutOfBounds(E))),                              // CheckBallOutOfBounds
  hook(8, 0x5383, E => ball.startBounceEffect(E)),                                            // StartBounceEffect
  hook(8, 0x52DA, E => ball.startLandingMarker(E)),                                           // StartLandingMarker
  hook(8, 0x53D0, E => ball.startHitEffect(E)),                                               // StartHitEffect
  hook(8, 0x4242, E => ball.tickRallyTimers(E)),                                              // TickRallyTimers
  hook(8, 0x427A, E => ball.handleBallHitEvent(E)),                                           // HandleBallHitEvent
  hook(8, 0x4352, E => ball.handleBallBounceEvent(E)),                                        // HandleBallBounceEvent
  hook(8, 0x43D3, E => ball.handleBallTouchCharEvent(E)),                                     // HandleBallTouchCharEvent
  hook(8, 0x4379, E => ball.evaluateBounceOutcome(E)),                                        // EvaluateBounceOutcome
  hook(8, 0x45A9, (E, c) => ball.setBallVelocityPolar(E, c.hl, c.bc, c.de)),                  // SetBallVelocityPolar
  hook(8, 0x45D8, (E, c) => { E.S.ballSideSpin = c.de; E.S.ballTopspin = c.bc; }),   // Unused_08_SetBallSpinComponents (leftovers.js: hl, a)
];

// ---- scoring, court positions, camera (project_08, court_08, match_loop_08, point_08, changeover_08) ----
const FLOW = [
  hook(8, 0x5AD7, E => flow.scorePoint(E)),                                                   // ScorePoint
  hook(8, 0x5AE6, E => flow.applyPointToScore(E)),                                            // ApplyPointToScore
  hook(8, 0x5B2E, E => flow.evaluatePointSituation(E)),                                       // EvaluatePointSituation
  hook(8, 0x5B7F, E => flow.handleServeFault(E)),                                             // HandleServeFault
  hook(8, 0x5BA7, E => flow.flagServiceReturnAce(E)),                                         // FlagServiceReturnAce
  hook(8, 0x5C2B, E => flow.updatePointStats(E)),                                             // UpdatePointStats
  hook(8, 0x5CC3, (E, c) => A(c, flow.checkMatchWon(E))),                                     // CheckMatchWon
  hook(8, 0x5CE9, (E, c) => A(c, flow.checkSetWon(E))),                                       // CheckSetWon
  hook(8, 0x5D37, (E, c) => A(c, flow.checkGameWon(E))),                                      // CheckGameWon
  hook(8, 0x5D54, (E, c) => A(c, flow.checkTiebreakGameWon(E))),                              // CheckTiebreakGameWon
  hook(8, 0x5D9A, (E, c) => A(c, flow.resolvePointWinner(E))),                                // ResolvePointWinner
  hook(8, 0x61DC, E => flow.updateMatchCamera(E)),                                            // UpdateMatchCamera
  hook(8, 0x6192, E => flow.resetCameraForServe(E)),                                          // ResetCameraForServe
  hook(8, 0x47E2, E => flow.assignCourtPositions(E)),                                         // AssignCourtPositions
  hook(8, 0x47CD, E => flow.initTiebreakPointCounter(E)),                                     // InitTiebreakPointCounter
  hook(8, 0x4FF5, E => flow.spreadTeammateTargets(E)),                                        // SpreadTeammateTargets
  hook(8, 0x6098, (E, c) => { const p = flow.getCharBaseCourtPosition(E); c.hl = p.x; c.de = p.depth; }),     // GetCharBaseCourtPosition
  hook(8, 0x60D8, (E, c) => { const p = flow.getCharChangeoverPosition(E); c.hl = p.x; c.de = p.depth; }),    // GetCharChangeoverPosition
];

// ---- the characters (char_update_08, char_states_08, shot_select_08, char_movement_08, char_input_08, char_07) ----
const CHARS = [
  hook(8, 0x692C, E => chars.updateAllChars(E)),                                              // UpdateAllChars
  hook(8, 0x6958, E => chars.updateChar(E)),                                                  // UpdateChar
  hook(8, 0x6A62, E => chars.updateCharStateMachine(E)),                                      // UpdateCharStateMachine
  hook(8, 0x6E64, E => chars.updateCharBallGeometry(E)),                                      // UpdateCharBallGeometry
  hook(8, 0x6EC5, E => chars.checkCharBallContact(E)),                                        // CheckCharBallContact
  hook(8, 0x6FA7, E => chars.checkBallContactWindow(E)),                                      // CheckBallContactWindow
  hook(8, 0x702A, E => chars.checkBallInSwingRange(E)),                                       // CheckBallInSwingRange
  hook(8, 0x70F5, (E, c) => { c.hl = chars.predictBallLateralOffset(E); }),                   // PredictBallLateralOffset
  hook(8, 0x6D5A, E => chars.startCharSwing(E)),                                              // StartCharSwing
  hook(8, 0x6E44, E => chars.selectForehandBackhand(E)),                                      // SelectForehandBackhand
  hook(8, 0x706B, E => chars.selectServeShotType(E)),                                         // SelectServeShotType
  hook(8, 0x707E, E => chars.selectRallyShotType(E)),                                         // SelectRallyShotType
  hook(8, 0x7112, (E, c) => A(c, chars.bufferShotButtonPress(E))),                            // BufferShotButtonPress
  hook(8, 0x7151, E => chars.captureServeAim(E)),                                             // CaptureServeAim
  hook(8, 0x7167, E => chars.captureShotAim(E)),                                              // CaptureShotAim
  hook(8, 0x719A, E => chars.applyCharMovementInput(E)),                                      // ApplyCharMovementInput
  hook(8, 0x71DD, E => chars.handleServePositioning(E)),                                      // HandleServePositioning
  hook(8, 0x7267, (E, c) => A(c, chars.checkSwingRelease(E))),                                // CheckSwingRelease
  hook(8, 0x72A6, E => chars.stepCharJumpPhysics(E)),                                         // StepCharJumpPhysics
  hook(8, 0x72DE, E => chars.stepCharMovement(E)),                                            // StepCharMovement
  hook(8, 0x73CA, E => chars.updateCharVelocityFromInput(E)),                                 // UpdateCharVelocityFromInput
  hook(8, 0x7541, (E, c) => A(c, chars.moveCharTowardTarget(E))),                             // MoveCharTowardTarget
  hook(8, 0x78BE, (E, c) => A(c, chars.checkCharNearTarget(E))),                              // CheckCharNearTarget
  hook(8, 0x75C0, E => chars.easeCharFacing(E)),                                              // EaseCharFacing
  hook(8, 0x75E8, (E, c) => { c.d = chars.updateCharFacingOctant(E); }),                      // UpdateCharFacingOctant
  [8, 0x7621, reloadCharFacingTiles],                                                          // ReloadCharFacingTiles
  hook(8, 0x7791, (E, c) => { const w = chars.stepCharAnimation(E); if (w !== null) { c.bc = w; c.d = w >> 8; } }),   // StepCharAnimation (bc, d: the last script word read)
  hook(8, 0x69EA, (E, c) => chars.setCharAnimation(E, c.d)),                                  // SetCharAnimation
  hook(8, 0x764B, E => chars.updateChargeFlash(E)),                                           // UpdateChargeFlash
  hook(8, 0x7666, E => chars.endChargeFlash(E)),                                              // EndChargeFlash
  hook(8, 0x7672, E => chars.buildCharSpriteSlots(E)),                                        // BuildCharSpriteSlots
  hook(8, 0x7745, E => chars.buildAirborneShadowSlot(E)),                                     // BuildAirborneShadowSlot
  hook(8, 0x780C, E => chars.readCharInput(E)),                                               // ReadCharInput
  hook(8, 0x6988, (E, c) => chars.setCharPosAndTarget(E, c.hl, c.de)),                        // SetCharPosAndTarget
  hook(8, 0x69AE, (E, c) => chars.setCharTarget(E, c.hl, c.de)),                              // SetCharTarget
  hook(8, 0x6A2C, (E, c) => chars.setCharFacing(E, c.a)),                                     // SetCharFacing
  hook(8, 0x6A33, (E, c) => chars.flipCharPositionCode(E, c.b)),                              // FlipCharPositionCode
  hook(8, 0x6A1C, (E, c) => chars.setCharState(E, c.a)),                                      // SetCharState
  hook(7, 0x5AB3, E => chars.loadCharacterAttributes(E)),                                     // LoadCharacterAttributes
  hook(8, 0x684A, (E, c) => chars.initChar(E, c.a, c.d, c.e)),                                // InitChar
  hook(8, 0x687F, E => chars.initAllChars(E)),                                                // InitAllChars
];

// ---- the CPU player (ai_rally_08, ai_serve_08) ----
const AI = [
  hook(8, 0x7863, E => ai.charInputHandler1(E)),                                              // CharInputHandler1_08
  hook(8, 0x7908, E => ai.aiSteerTowardTarget(E)),                                            // AiSteerTowardTarget
  hook(8, 0x7944, E => ai.aiSteerTowardBall(E)),                                              // AiSteerTowardBall
  hook(8, 0x7968, E => ai.aiAdvancePhase(E)),                                                 // AiAdvancePhase
  [8, 0x7C86, predictBallXAtDepth],                                                           // PredictBallXAtDepth
  hook(8, 0x7C33, (E, c) => { c.de = ai.mirrorDepthForFarSide(E, c.de); }),                  // MirrorDepthForFarSide
  hook(8, 0x7C40, (E, c) => { c.b = ai.getCharRoleByIndex(E, c.a); }),                       // GetCharRoleByIndex
  hook(8, 0x7C70, (E, c) => ai.setCharTargetMirrored(E, c.hl, c.de)),                        // SetCharTargetMirrored
  hook(8, 0x7B13, (E, c) => ai.aiRollAimAwayFromChar(E, c.a)),                                // AiRollAimAwayFromChar
  hook(8, 0x7B1F, (E, c) => ai.aiAimAwayFromChar(E, c.c)),                                    // AiAimAwayFromChar
  hook(8, 0x7B7B, E => ai.aiPickShotButtons(E)),                                              // AiPickShotButtons
  hook(8, 0x7B62, E => ai.aiPickServeButtons(E)),                                             // AiPickServeButtons
  hook(8, 0x7AEB, E => ai.aiApplyServeAim(E)),                                                // AiApplyServeAim
];

// ---- the shot solver (shot_power_07, execute_07, placement_07) and the ball-path banks ----
const BC = (c, v) => { c.bc = v; }, DE = (c, v) => { c.de = v; };
const SHOT = [
  hook(7, 0x53B0, E => shot.executeShot(E)),                                                  // ExecuteShot
  hook(7, 0x546B, E => shot.applyShotRecoil(E)),                                              // ApplyShotRecoil
  hook(7, 0x5463, E => shot.shotRecoilFrameTask(E)),                                          // ShotRecoilFrameTask
  hook(7, 0x54DE, (E, c) => BC(c, shot.weakenShotByCharge(E, c.bc))),                         // WeakenShotByCharge
  hook(7, 0x54ED, (E, c) => BC(c, shot.boostShotByCharge(E, c.bc))),                          // BoostShotByCharge
  hook(7, 0x54FE, (E, c) => BC(c, shot.nudgeShotByPlayerMomentum(E, c.bc))),                  // NudgeShotByPlayerMomentum
  hook(7, 0x5525, (E, c) => { c.f = shot.checkBallInSmashRange(E).f; }),                      // CheckBallInSmashRange
  hook(7, 0x557E, (E, c) => BC(c, shot.applyShotTypePresets(E))),                             // ApplyShotTypePresets
  hook(7, 0x55E9, (E, c) => DE(c, shot.getShotAimOffsetForSide(E))),                          // GetShotAimOffsetForSide
  hook(7, 0x5646, (E, c) => DE(c, shot.computeShotTargetX(E))),                               // ComputeShotTargetX
  hook(7, 0x56B7, (E, c) => DE(c, shot.computeAimBaseOffset(E))),                             // ComputeAimBaseOffset
  hook(7, 0x56E3, (E, c) => DE(c, shot.clampShotTargetX(E, c.de))),                           // ClampShotTargetX
  hook(7, 0x570D, (E, c) => { c.hl = shot.getRandomAimJitter(E); }),                          // GetRandomAimJitter
  hook(7, 0x571E, (E, c) => shot.computeShotTrajectory(E, c.bc)),                             // ComputeShotTrajectory
  hook(7, 0x5876, E => shot.normalizeBallHeightForShot(E)),                                   // NormalizeBallHeightForShot
  hook(7, 0x5899, E => shot.raiseBallHeightForLob(E)),                                        // RaiseBallHeightForLob
  hook(7, 0x5A01, E => shot.setSpecialShotFlagFromBallHeight(E)),                             // SetSpecialShotFlagFromBallHeight
  hook(7, 0x5161, (E, c) => BC(c, shot.computeShotPlacement(E))),                             // ComputeShotPlacement
  hook(7, 0x52D7, (E, c) => BC(c, shot.finalizeShotSpeed(E, c.bc))),                          // FinalizeShotSpeed
  hook(0x24, 0x57FD, (E, c) => shot.applyFallbackBallTrajectory(E, c.d)),                     // ApplyFallbackBallTrajectory_24
  hook(0x20, 0x4102, (E, c) => shot.applyBallTrajectory(E, 0x20, c.hl, c.bc, 6, true)),       // ApplyBallTrajectory6Capped_20
  hook(0x24, 0x41A2, (E, c) => shot.applyBallTrajectory(E, 0x24, c.hl, c.bc, 4, true)),       // ApplyBallTrajectory4Capped_24
  hook(0x2C, 0x4139, (E, c) => shot.applyBallTrajectory(E, 0x2C, c.hl, c.bc, 6, false)),      // ApplyBallTrajectory6_2c
  hook(0x2C, 0x41CD, (E, c) => shot.applyBallTrajectory(E, 0x2C, c.hl, c.bc, 4, false)),      // ApplyBallTrajectory4_2c
  hook(0x24, 0x4169, (E, c) => shot.applyBallTrajectoryCapped24(E, c.hl)),                    // ApplyBallTrajectoryCapped_24
  ...[0x29, 0x2A, 0x2B].map(b => hook(b, 0x4098, (E, c) => shot.setBallTargetByPrediction(E, b, c.hl))),   // SetBallTargetByPrediction
  hook(0x20, 0x41F5, (E, c) => shot.setBallTargetFromAim(E, c.hl)),                           // SetBallTargetFromAim_20
];

// ---- the smaller pieces: the routines the ones above call (the ROM's callers are mostly JS now, but the
// routines are hooked all the same, so any ROM code reaching them runs the port) ----
const F = (c, v) => { c.a = v ? 1 : 0; };
// d:e:a as one 24-bit value (NegateADE, Add24ToMem24)
const ade = c => c.d << 16 | c.e << 8 | c.a, setADE = (c, v) => { c.d = (v >> 16) & 0xFF; c.e = (v >> 8) & 0xFF; c.a = v & 0xFF; };
// a character-state dispatcher (rst $00 on wCharStatePhase): the engine's phase table for state n
const charState = n => E => { const fn = chars.STATES[n][E.C.statePhase]; if (fn) fn(E); };
const MORE = [
  // ball (match_08, match_frames_08)
  hook(8, 0x4274, E => chars.setCharState(E, flow.CHARSTATE.STANDBY)),                         // SetCharStateForRallyTick
  hook(8, 0x43E5, E => { const S = E.S; if (!S.pointOutcome) { S.pointOutcome = ball.POINTOUTCOME.BALL_HIT_PLAYER; S.pointOutcomeSide = 1; } }),   // ApplyBallTouchOutcome
  hook(8, 0x4677, (E, c) => A(c, ball.getBallHeightSign(E))),                                  // GetBallHeightSign
  hook(8, 0x468B, (E, c) => { const v = ball.mulMem24ByFrac(E, c.hl, c.b); c.a = v & 0xFF; c.e = (v >> 8) & 0xFF; c.d = (v >> 16) & 0xFF; }),   // MulMem24ByFrac
  hook(8, 0x7C57, (E, c) => { const p = ball.offsetFromBallLanding(E, c.hl); c.hl = p.x; c.de = p.depth; }),   // OffsetFromBallLanding
  // scoring and stats (project_08, court_08)
  hook(8, 0x5BC6, (E, c) => flow.resetAdvantageToDeuce(E, c.b)),                               // ResetAdvantageToDeuce
  hook(8, 0x5BDB, E => flow.awardSet(E)),                                                      // AwardSet
  hook(8, 0x5BF4, E => flow.awardGame(E)),                                                     // AwardGame
  hook(8, 0x5C14, E => flow.awardPoint(E)),                                                    // AwardPoint
  hook(8, 0x5D71, (E, c) => A(c, flow.evalWinByTwo(c.d, c.e, c.b, c.c))),                      // EvalWinByTwo
  hook(8, 0x5C47, E => flow.recordFaultStat(E)),                                               // RecordFaultStat
  hook(8, 0x5C53, E => flow.recordDoubleFaultStat(E)),                                         // RecordDoubleFaultStat
  hook(8, 0x5C5F, E => flow.recordServiceAceStat(E)),                                          // RecordServiceAceStat
  hook(8, 0x5C6F, E => flow.recordReturnAceStat(E)),                                           // RecordReturnAceStat
  hook(8, 0x5C7F, E => flow.recordSmashAceStat(E)),                                            // RecordSmashAceStat
  hook(8, 0x5C90, E => flow.recordLobWinnerStat(E)),                                           // RecordLobWinnerStat
  hook(8, 0x5CA1, E => flow.recordDropShotWinnerStat(E)),                                      // RecordDropShotWinnerStat
  // court positions (match_loop_08)
  hook(8, 0x47EF, E => flow.finalizeServeSideOrientation(E)),                                  // FinalizeServeSideOrientation
  hook(8, 0x48ED, (E, c) => flow.loadPositionRecord(E, c.hl, c.a, false)),                     // LoadPositionRecord
  hook(8, 0x491A, (E, c) => flow.loadPositionRecord(E, c.hl, c.a, true)),                      // LoadPositionRecord.doubles
  hook(8, 0x4971, E => { E.C.serveRole ^= 2; }),                                               // ToggleCharCourtRow
  hook(8, 0x5001, E => flow.spreadBothTeamPairs(E)),                                           // SpreadBothTeamPairs
  hook(8, 0x5034, E => flow.spreadFarTeamPair(E)),                                             // SpreadFarTeamPair
  hook(8, 0x4F91, E => chars.setCharState(E, E.rom.u8(8, 0x4FA0 + E.C.serveRole))),            // SetCharStateFromServeRole
  hook(8, 0x6046, E => flow.startCharWalkOffCourt(E)),                                         // StartCharWalkOffCourt
  hook(8, 0x6059, E => flow.parkCharOffCourt(E)),                                              // ParkCharOffCourt
  hook(8, 0x4D63, E => flow.setPointSituationBgm(E)),                                          // SetPointSituationBgm
  // the character's states and phases (char_update_08, char_states_08)
  hook(8, 0x6A8B, E => chars.advancePhase(E)),                                                 // AdvanceCharStatePhase
  hook(8, 0x6A90, E => chars.charRallyEndState(E)),                                            // CharRallyEndState
  hook(8, 0x6AE2, charState(3)), hook(8, 0x6BD9, charState(2)), hook(8, 0x6BEA, charState(1)),  // CharServeState / CharRecoverState / CharRallyState
  hook(8, 0x6CBE, charState(5)), hook(8, 0x6CC8, charState(4)), hook(8, 0x6D0E, charState(6)), hook(8, 0x6D16, charState(7)),   // Standby / AwaitServe / Walk / PointEnd
  hook(8, 0x6AF2, E => chars.charServeInitPhase(E)),                                           // CharServeInitPhase
  hook(8, 0x6B33, E => chars.charServeWaitAnimPhase(E)),                                       // CharServeWaitAnimPhase
  hook(8, 0x6B3F, E => chars.charServeTossPhase(E)),                                           // CharServeTossPhase
  hook(8, 0x6B8D, E => chars.charServeSwingWindowPhase(E)),                                    // CharServeSwingWindowPhase
  hook(8, 0x6BC2, E => chars.charServeStrikePhase(E)),                                         // CharServeStrikePhase
  hook(8, 0x6BE3, E => chars.charRecoverMovementPhase(E)),                                     // CharRecoverMovementPhase
  hook(8, 0x6BF8, E => chars.charRallyReadyPhase(E)),                                          // CharRallyReadyPhase
  hook(8, 0x6C2F, E => chars.charSwingWindupPhase(E)),                                         // CharSwingWindupPhase
  hook(8, 0x6C7A, E => chars.charSwingContactPhase(E)),                                        // CharSwingContactPhase
  hook(8, 0x6C99, E => chars.resetSwingAnimation(E)),                                          // ResetSwingAnimation
  hook(8, 0x6CD4, E => chars.charAwaitServeMove(E)),                                           // CharAwaitServeState.checkInput
  hook(8, 0x6CDB, E => chars.charAwaitServeStart(E)),                                          // CharAwaitServeState.startServe
  hook(8, 0x6D27, E => chars.charPointReactionPhase(E)),                                       // CharPointReactionPhase
  hook(8, 0x6D3E, E => chars.charWalkToTargetPhase(E)),                                        // CharWalkToTargetPhase
  hook(8, 0x6D4B, E => chars.updateCharRunAnimation(E)),                                       // UpdateCharRunAnimation
  [8, 0x69C2, (P, c) => loadCharPaletteThroughVector(P, c, 0)],                                // ReloadCharFrameGfx
  [8, 0x69D5, (P, c) => loadCharPaletteThroughVector(P, c, 8)],                                // LoadCharChargeFlashGfx
  // movement, input, drawing (char_movement_08, char_input_08)
  hook(8, 0x7441, E => chars.accelerateCharDepth(E)), hook(8, 0x745B, E => chars.accelerateCharX(E)),   // AccelerateCharDepth / X
  hook(8, 0x7475, E => chars.decelerateCharDepth(E)), hook(8, 0x74A1, E => chars.decelerateCharX(E)),   // DecelerateCharDepth / X
  hook(8, 0x74D7, E => chars.clampCharDepthSpeed(E)), hook(8, 0x750C, E => chars.clampCharXSpeed(E)),   // ClampCharDepthSpeed / X
  hook(8, 0x7704, (E, c) => chars.drawOffscreenCharArrow(E, c.d, c.e)),                        // DrawOffscreenCharArrow
  hook(8, 0x782D, E => { E.C.inputBits = E.S.linkInput; }),                                    // CharInputHandler4_08
  hook(8, 0x7855, E => chars.readCharPadInput(E)),                                             // ReadCharPadInput
  // CharInputHandler5_08 / 6_08: a link seat's input (the other machine's, live or buffered, by which end of the link
  // this is; LINKSTATE_MASTER 1, LINKSTATE_SLAVE 2), else the pad
  ...[[0x7833, "linkRemoteInput", "linkRemoteInputBuf"], [0x783F, "linkRemoteInputBuf", "linkRemoteInput"]].map(([addr, slave, master]) => hook(8, addr, E => {
    const S = E.S;
    if (S.linkState === 2) E.C.inputBits = S[slave]; else if (S.linkState === 1) E.C.inputBits = S[master]; else chars.readCharPadInput(E);
  })),
  // character setup (char_07)
  hook(7, 0x5A43, (E, c) => A(c, chars.lookupCharSpriteSet(E, c.a))),                          // LookupCharSpriteSet
  hook(7, 0x5A70, (E, c) => chars.setupCharacterSprite(E, c.d, c.e)),                          // SetupCharacterSprite
  hook(7, 0x5CF4, E => chars.overrideCharStatsForDebug(E)),                                    // OverrideCharStatsForDebug
  // the CPU player (ai_serve_08, ai_rally_08)
  ...[[0x796D, ai.aiRushToBallLanding], [0x7992, ai.aiMoveBehindBallLanding], [0x799E, ai.aiInterceptAtMidCourt], [0x79B0, ai.aiInterceptNearNet],
    [0x79C2, ai.aiMoveLaterallyToBallLine], [0x79F2, ai.aiServeState], [0x7A02, ai.aiServeWalkToSpot], [0x7A4D, ai.aiServeSteerToSpot],
    [0x7A5F, ai.aiServePressToss], [0x7ADD, ai.aiServeStrike], [0x7AE7, ai.aiServeApplyAim], [0x7C10, ai.aiPressFirstShotButton],
    [0x7C21, ai.aiPressSecondShotButton], [0x7CA4, ai.aiRecoverStateSingles], [0x7CAE, ai.aiChooseHomePosition], [0x7CED, ai.aiReturnToPositionPhase],
    [0x7CFA, ai.aiRallyStateSingles], [0x7D0A, ai.aiSetReactionDelay], [0x7D23, ai.aiChoosePositionByStrategy], [0x7D73, ai.aiTrackBallPhase],
    [0x7DAD, ai.aiWaitThenPickShot], [0x7DCB, ai.aiSwingControlSingles], [0x7DF2, ai.aiRecoverStateNetPlayer], [0x7DFC, ai.aiRecoverStateBaseliner],
    [0x7E08, ai.aiTrackBallTargetX], [0x7E22, ai.aiBaselinerShadowPartner], [0x7E52, ai.aiRallyStateNetPlayer], [0x7E68, ai.aiRallyStateBaseliner],
    [0x7E7E, ai.aiNetPlayerCheckRally], [0x7E99, ai.aiNetPlayerPredictLanding], [0x7EB1, ai.aiBaselinerSetTarget], [0x7EC0, ai.aiBaselinerDone],
    [0x7ED2, ai.aiDoublesTrackBallPhase], [0x7F11, ai.aiNetPlayerPoachCheck], [0x7F8A, ai.aiSwingControlDoubles]].map(([addr, fn]) => hook(8, addr, E => fn(E))),
  hook(8, 0x796C, () => {}),                                                                   // AiPhaseNoop
  hook(8, 0x79D3, (E, c) => ai.aiSetMirroredTarget(E, c.hl, c.de)),                            // AiSetMirroredTarget
  hook(8, 0x79D9, (E, c) => F(c, ai.aiIsIncomingDropOrLobShot(E))),                            // AiIsIncomingDropOrLobShot
  hook(8, 0x79E0, (E, c) => F(c, ai.aiIsIncomingLobShot(E))),                                  // AiIsIncomingLobShot
  hook(8, 0x79EF, (E, c) => { c.a = 1; }),                                                     // ReturnOne_08
  hook(8, 0x7C30, (E, c) => A(c, ai.charIndexToWramBank(c.a))),                                // CharIndexToWramBank
  // the shot handlers and the speed budget (execute_07, placement_07, shot_power_07)
  ...[[0x58BE, shot.executeShotTopspin], [0x58D3, shot.executeShotPowerTopspin], [0x58EC, shot.executeShotSlice], [0x5901, shot.executeShotPowerSlice],
    [0x591A, shot.executeShotLob], [0x592D, shot.executeShotDrop], [0x593D, shot.executeShotReachBasic], [0x5952, shot.executeShotReachPowerTopspin],
    [0x5967, shot.executeShotReachPowerSlice], [0x597C, shot.executeShotReach], [0x5991, shot.executeShotSmash], [0x59A8, shot.executeShotNeutral],
    [0x59C5, shot.executeShotServeTopspin], [0x59D2, shot.executeShotServeSlice], [0x59DF, shot.executeShotServeFlat]].map(([addr, fn]) => hook(7, addr, E => fn(E))),
  ...[0x5183, 0x519B, 0x51B3, 0x51CB, 0x51E3, 0x5248, 0x5222, 0x5235, 0x520F, 0x51F9, 0x525B, 0x5268, 0x5275, 0x5284, 0x5293]
    .map((addr, t) => hook(7, addr, (E, c) => BC(c, shot.shotPlacement(E, t)))),               // ShotPlacementTopspin ... ShotPlacementServeFlat
  hook(7, 0x52A0, (E, c) => BC(c, shot.loadShotPlacementEntry(E, c.hl, c.d, c.e))),            // LoadShotPlacementEntry
  hook(7, 0x52F1, (E, c) => BC(c, shot.addBallSpeedQuarter(E, c.bc))),                         // AddBallSpeedQuarter
  hook(7, 0x5301, (E, c) => BC(c, shot.addBallSpeed3Sixteenths(E, c.bc))),                     // AddBallSpeed3Sixteenths
  hook(7, 0x531D, (E, c) => BC(c, shot.addBallSpeedEighth(E, c.bc))),                          // AddBallSpeedEighth
  hook(7, 0x5345, (E, c) => BC(c, shot.addChargeSpeedBonus(E, c.bc))),                         // AddChargeSpeedBonus
  hook(7, 0x535C, (E, c) => BC(c, shot.addChargeSpeedBonusHalf(E, c.bc))),                     // AddChargeSpeedBonusHalf
  hook(7, 0x537F, (E, c) => BC(c, shot.addPlayerMomentumToShot(E, c.bc))),                     // AddPlayerMomentumToShot
  hook(7, 0x53A2, (E, c) => BC(c, shot.applyCharFlagShotSpeedPenalty(E, c.bc))),               // ApplyCharFlagShotSpeedPenalty
  // bank 8's own arithmetic helpers (project_08): results in the registers the ROM leaves them in
  [8, 0x59FB, mulHLByDESigned32],                                                             // MulHLByDESigned32
  hook(8, 0x5A1D, (E, c) => { c.hl = E.M.mulHLByDEAbs(c.hl, c.de); }),                        // MulHLByDEAbs
  hook(8, 0x5A39, (E, c) => { const r = E.M.mulSignedHLByAFrac(c.hl, c.a); c.hl = r.hl; c.a = r.a; }),   // MulSignedHLByAFrac
  [8, 0x5A51, mulHLByTangent],                                                                // MulHLByTangent
  hook(8, 0x5A63, (E, c) => setADE(c, E.M.negateADE(ade(c)))),                                // NegateADE
  hook(8, 0x5A60, (E, c) => { if (c.d & 0x80) setADE(c, E.M.negateADE(ade(c))); }),           // UnusedAbsADE
  hook(8, 0x5A87, (E, c) => { E.M.addVel24ToPos32(c.hl, c.de); c.a = E.mem.u8(c.hl + 2); c.hl = c.hl + 3; c.de = c.de + 2; }),   // AddVel24ToPos32
  hook(8, 0x5A9E, (E, c) => { E.M.add24ToMem24(c.hl, ade(c)); c.a = E.mem.u8(c.hl + 2); c.hl = c.hl + 3; }),    // Add24ToMem24
  ...[0x5AA7, 0x5A77].map(addr => hook(8, addr, (E, c) => { E.M.addDEToMem24(c.hl, c.de); c.a = E.mem.u8(c.hl + 1); c.hl = c.hl + 2; })),   // AddDEToMem24, Unused_08_AddSignedDEToMem24
  hook(8, 0x5AB7, (E, c) => { E.M.addDEToMem24(c.hl, c.bc); c.a = E.mem.u8(c.hl + 1); c.hl = c.hl + 2; }),     // AddBCToMem24
  hook(8, 0x5AC7, (E, c) => { c.bc = E.M.addDEToMem24IntoBC(c.hl, c.de); c.a = c.c; c.hl = c.hl + 2; }),      // AddDEToMem24IntoBC
];

export const HOOKS = [...BALL, ...FLOW, ...CHARS, ...AI, ...SHOT, ...MORE];
