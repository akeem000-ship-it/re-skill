// The match loop in the port: the engine's coroutines (web/js/engine/flow.js, setup.js: StepMatchFrame and
// everything that waits on it, up to RunMatchPlayLoop and the court intro) hooked at their ROM addresses. Each hook
// returns the engine's generator; the engine reaches the frame barrier through E.ext.advanceFrame, which here is
// the game's AdvanceFrame (00:2631), so the ROM's interrupts, lag and the lockstep's alignment all happen there.
// Also the per-frame and point-setup routines around them (UpdateMatchFrame, ResetPointState, ...).
// Names and addresses from the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm).
// Covered by out/engine/exh1.mtrec and rec1.mtrec (port_lockstep.mjs).
import * as flow from "../../engine/flow.js";
import * as setup from "../../engine/setup.js";
import * as ball from "../../engine/ball.js";
import * as chars from "../../engine/chars.js";
import { setBallTrailColor } from "../../engine/shot.js";
import { engine } from "./engine_port.js";

const REGS = ["a", "f", "b", "c", "d", "e", "h", "l"];
const save = c => REGS.map(r => c[r]);
const restore = (c, v) => REGS.forEach((r, i) => { c[r] = v[i]; });
const DEBUG_MATCH_FLAGS = 0xC4EE;                                        // wDebugMatchFlags (bit 0: skippable waits never end)

// a hook for a routine that waits: the engine's generator, with the registers it keeps (push ... pop) restored
const waits = fn => (P, c) => (function* () {
  const regs = save(c);
  yield* fn(engine(P), c);
  restore(c, regs);
})();

// 08:4428 StepMatchFrames (a frames): leaves b = the frames left (0), a = wMatchFramesAbort as last read
export function* stepMatchFrames(E, c) {
  let b = c.a;
  for (;;) {
    const abort = E.S.matchFramesAbort;
    if (abort) { c.a = abort; break; }
    yield* flow.stepMatchFrame(E);
    b = (b - 1) & 0xFF;
    if (!b) { c.a = 0; break; }
  }
  c.b = b;
}
// 08:4436 StepMatchFramesSkippable (a frames, A or B ends the wait): leaves b, and a = the abort flag, the
// buttons that ended it, or wDebugMatchFlags
export function* stepMatchFramesSkippable(E, c) {
  let b = c.a;
  for (;;) {
    const abort = E.S.matchFramesAbort;
    if (abort) { c.a = abort; break; }
    yield* flow.stepMatchFrame(E);
    const held = flow.inputHeld(E) & 0x03;
    if (held) { c.a = held; break; }
    const debug = E.mem.u8(DEBUG_MATCH_FLAGS);
    if (debug & 1) continue;
    b = (b - 1) & 0xFF;
    if (!b) { c.a = debug; break; }
  }
  c.b = b;
}
// 08:4452 RunMatchFramesUntilInput: leaves a = the abort flag or the buttons held (SELECT/START ignored)
export function* runMatchFramesUntilInput(E, c) {
  for (;;) {
    const abort = E.S.matchFramesAbort;
    if (abort) { c.a = abort; return; }
    yield* flow.stepMatchFrame(E);
    const held = flow.inputHeld(E) & 0xF3;
    if (held) { c.a = held; return; }
  }
}
// these leave their counters in a and b, the other registers kept
const counted = fn => (P, c) => (function* () {
  const regs = save(c);
  yield* fn(engine(P), c);
  const a = c.a, b = c.b;
  restore(c, regs); c.a = a; c.b = b;
})();

// the routines that do not wait
const now = fn => (P, c) => { fn(engine(P), c); };

export const HOOKS = [
  // ---- the frame ----
  [8, 0x4465, waits(E => flow.stepMatchFrame(E))],                                         // StepMatchFrame
  [8, 0x4428, counted(stepMatchFrames)],                                                   // StepMatchFrames
  [8, 0x4436, counted(stepMatchFramesSkippable)],                                          // StepMatchFramesSkippable
  [8, 0x4452, counted(runMatchFramesUntilInput)],                                          // RunMatchFramesUntilInput
  [8, 0x4496, waits(E => flow.handlePauseMenu(E))],                                        // HandlePauseMenu
  [8, 0x44BD, waits(E => flow.reinitPointAfterPause(E))],                                  // ReinitPointAfterPause
  [8, 0x41F7, now(E => flow.updateMatchFrame(E))],                                         // UpdateMatchFrame
  [8, 0x5153, now(E => ball.updateBallVisuals(E))],                                        // UpdateBallVisuals
  [8, 0x440D, (P, c) => { c.a = flow.inputHeld(engine(P)); }],                             // ReadMatchInputHeld
  [8, 0x4415, (P, c) => { c.a = flow.inputPressed(engine(P)); }],                          // ReadMatchInputPressed
  // ---- sets, games, points (match_loop_08, point_08) ----
  [8, 0x4714, waits(E => flow.runMatchPlayLoop(E))],                                       // RunMatchPlayLoop
  [8, 0x4737, waits(E => flow.playSet(E))],                                                // PlaySet
  [8, 0x4D0F, waits(E => flow.playPoint(E))],                                              // PlayPoint
  [8, 0x4D8C, waits(E => flow.announcePointSituation(E))],                                 // AnnouncePointSituation
  [8, 0x4DF4, waits(E => flow.resolvePointOutcome(E))],                                    // ResolvePointOutcome
  [8, 0x4EA3, waits(E => flow.showPointScoreSequence(E))],                                 // ShowPointScoreSequence
  [8, 0x4ED1, waits(E => flow.showMatchEndSequence(E))],                                   // ShowMatchEndSequence
  [8, 0x4F0F, waits(E => flow.showGameEndSequence(E, 0x0C))],                              // ShowSetEndSequence
  [8, 0x4F23, waits(E => flow.showGameEndSequence(E, 0x0B))],                              // ShowGameEndSequence
  [8, 0x4FB8, waits(E => flow.startPointEndReactions(E))],                                 // StartPointEndReactions
  [8, 0x40AB, now(E => flow.resetMatchState(E, E.mem.u8(0xFF8C)))],                        // ResetMatchState (seeded by hVBlankCounter)
  [8, 0x454B, now(E => flow.selectScoreboardLayout(E))],                                   // SelectScoreboardLayout
  [8, 0x4CB9, now(E => flow.resetPointState(E))],                                          // ResetPointState
  [8, 0x4F6F, now(E => flow.resetCharForPoint(E))],                                        // ResetCharForPoint
  [8, 0x4FA4, now(E => flow.endPointBallEffects(E))],                                      // EndPointBallEffects
  [8, 0x4FC7, now(E => flow.charPointEndReaction(E))],                                     // CharPointEndReaction
  [8, 0x4CB2, now(E => flow.moveCharToBaseCourtPosition(E))],                              // MoveCharToBaseCourtPosition
  [8, 0x46E7, now((E, c) => { c.b = flow.findServerCharBank(E); })],                       // FindServerCharBank
  [8, 0x4C7A, now(E => flow.identifyServingPlayer(E))],                                    // IdentifyServingPlayer
  [8, 0x4C19, now(E => flow.checkServerEndChanged(E))],                                    // CheckServerEndChanged
  [8, 0x4C33, now(E => flow.updateViewFlipState(E))],                                      // UpdateViewFlipState
  [8, 0x4C4E, now(E => flow.flipAllCharPositions(E))],                                     // FlipAllCharPositions
  [8, 0x4C99, now(E => flow.setCharFacingFromCourtPos(E))],                                // SetCharFacingFromCourtPos
  [8, 0x506E, now((E, c) => { const r = flow.computePairSpread(c.de, c.hl); c.de = r.de; c.bc = r.bc; })],   // ComputePairSpread
  // ---- changeovers and the court intro (court_08, changeover_08) ----
  [8, 0x5F43, waits(E => flow.refreshCourtAfterEndChange(E))],                             // RefreshCourtAfterEndChange
  [8, 0x5F8C, waits(E => flow.runChangeoverSequence(E))],                                  // RunChangeoverSequence
  [8, 0x5FBC, waits(E => flow.walkCharsToNewEnds(E))],                                     // WalkCharsToNewEnds
  [8, 0x6010, waits(E => flow.walkCharsOffCourt(E))],                                      // WalkCharsOffCourt
  [8, 0x5FE5, now(E => flow.startCharChangeoverWalk(E))],                                  // StartCharChangeoverWalk
  [8, 0x6003, now(E => flow.placeCharAtBasePosition(E))],                                  // PlaceCharAtBasePosition
  [8, 0x6063, now((E, c) => { c.a = flow.checkAllCharsPhaseDone(E); c.f = c.a ? 0x20 : 0xA0; })],   // CheckAllCharsPhaseDone (and b: Z, H)
  [8, 0x6117, waits(E => setup.playCourtIntro(E))],                                        // PlayCourtIntro
  [8, 0x6199, now((E, c) => { const t = flow.getServeCameraTarget(E); c.hl = t.x; c.de = t.y; })],   // GetServeCameraTarget
  [8, 0x61AA, now((E, c) => flow.snapCameraTo(E, c.hl, c.de))],                            // SnapCameraTo
  [8, 0x61C9, now((E, c) => flow.setCameraTarget(E, c.hl, c.de))],                         // SetCameraTarget
  // ---- the ball's state ----
  [8, 0x511C, now(E => ball.resetBallState(E, a => setBallTrailColor(E, a)))],             // ResetBallState
  [8, 0x5189, now((E, c) => setBallTrailColor(E, c.a))],                                   // SetBallTrailColor
  [8, 0x458B, now((E, c) => ball.setBallPosition(E, c.hl, c.de, c.bc))],                   // SetBallPosition
  [8, 0x430F, now(E => ball.setCharStateOnBallHit(E))],                                    // SetCharStateOnBallHit
  [8, 0x4326, now(E => ball.detectServeAceOutcome(E))],                                    // DetectServeAceOutcome
  [8, 0x547C, now(E => ball.startBallTouchCharEffect(E))],                                 // StartBallTouchCharEffect
  [8, 0x6A3A, (P, c) => {                                                                  // ForEachCharBank: the routine at hl
    const E = engine(P), hl = c.hl;                                                        // in banks 7, 6, 5, 4 (a = the bank)
    chars.forEachCharBank(E, () => P.callRom(8, hl, { h: hl >> 8, l: hl & 0xFF, a: E.mem.u8(0xFF96) }));
  }],
];
