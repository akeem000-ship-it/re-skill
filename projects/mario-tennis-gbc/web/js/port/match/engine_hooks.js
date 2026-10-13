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

// [bank, addr, fn(E, cpu)]: fn runs the engine routine with the CPU's registers as arguments and writes back
// its result registers
const hook = (bank, addr, fn) => [bank, addr, (P, c) => { fn(engine(P), c); }];
const A = (c, v) => { c.a = v & 0xFF; };

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
  hook(8, 0x7621, (E, c) => chars.reloadCharFacingTiles(E, c.d)),                             // ReloadCharFacingTiles
  hook(8, 0x7791, E => chars.stepCharAnimation(E)),                                           // StepCharAnimation
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
  hook(8, 0x7C86, (E, c) => { c.hl = ai.predictBallXAtDepth(E, c.de); }),                    // PredictBallXAtDepth
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

export const HOOKS = [...BALL, ...FLOW, ...CHARS, ...AI, ...SHOT];
