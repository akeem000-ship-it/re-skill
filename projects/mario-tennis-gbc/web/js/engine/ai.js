// The CPU player (bank $08: CharInputHandler1_08 and the AI routines after it; ai_rally_08 / ai_serve_08 /
// the end of char_input_08 in the gerbiljames disassembly, docs/match_engine.md "The AI").
//
// The AI is a fake controller: once per frame it writes wCharInputBits (d-pad in the high nibble, buttons in
// the low nibble) and the character's ordinary state machine consumes it like a pad. ReadCharInput (chars.js)
// clears the bits and calls charInputHandler1 with the CPU character's WRAM bank mapped (E.C).
//
// Shape: a reaction timer (wAiActionTimer) that keeps the AI inert while it runs, then a handler per character
// state (rally 1, recovery 2, serve 3) for singles, the doubles net player (wCharServeRole & 2) or the doubles
// baseliner; each handler is a jump table on wAiPhase, which SetCharState zeroes, so every stroke restarts it.
// Randomness is AdvanceMatchRng (ball.js), a pure function of the ball state.
import { advanceMatchRng, offsetFromBallLanding, SHOTTYPE_LOB } from "./ball.js";
import { setCharTarget, checkCharNearTarget } from "./chars.js";
import { learnHome, learnLobRoll, learnAim } from "./learn.js";   // PLAY+ SCOUTING: the CPU leans on how you play

export const SHOTTYPE_DROP = 0x0B;
export const CHARANIM_SERVE_READY = 0x10;
// wAiShotButtons codes: first button in the high nibble, second in the low (1 = A, 2 = B, 3 = A+B)
export const AISHOT = { TOPSPIN: 0x10, POWER_TOPSPIN: 0x11, LOB: 0x12, SLICE: 0x20, DROP: 0x21, POWER_SLICE: 0x22, NEUTRAL: 0x30 };
// wCharBallReachFlags bits the AI reads
const REACH_SWING = 0x01, REACH_CONTACT = 0x02, REACH_NEAR_NET = 0x10;

// ROM tables (read from the ROM, never copied)
const ANGLE_TO_DPAD = 0x7296;            // 08:7296 AngleToDpadTable_08: 16 d-pad nibbles by coarse angle sector
const SERVE_WALK_SPOT = 0x7A3D;          // 08:7A3D ServeWalkToSpotTable: 8 words, baseline X offsets
const SERVE_PRESS_TOSS_PTRS = 0x7A9D;    // 08:7A9D ServePressTossPtrs: 16 pointers by serve style to 8-byte rows
const SERVE_AIM = 0x7B0B;                // 08:7B0B AiApplyServeAimTable: 8 d-pad bytes (left/right)
const SERVE_BUTTONS = 0x7B73;            // 08:7B73 AiPickServeButtons_AiShotButtonsTable: 8 AISHOT codes
const CHAR_GROUP_TABLE = 0x5E23;         // 02:5E23 CharGroupTable_02: 16 AISHOT codes per serve-style row

const U16 = v => v & 0xFFFF, S16 = v => (v << 16) >> 16, NEG16 = v => (-v) & 0xFFFF;
const ABS16 = v => (v & 0x8000 ? NEG16(v) : v & 0xFFFF);          // 0x8000 stays 0x8000, as on the CPU

// rst $00 on a jump table: the AI's tables are only ever indexed in range
function dispatch(E, table, i, what) {
  const fn = table[i];
  if (!fn) throw new Error(`ai: ${what} index ${i} outside its jump table`);
  return fn(E);
}

// ---- small bank-08 helpers used outside the AI too ----
// 08:7C30 CharIndexToWramBank
export function charIndexToWramBank(index) { return (index + 4) & 0xFF; }
// 08:7C33 MirrorDepthForFarSide: a depth on the near side, negated for a character on the far side (court pos bit 1)
export function mirrorDepthForFarSide(E, depth) { return E.C.courtPos & 2 ? NEG16(depth) : U16(depth); }
// 08:7C40 GetCharRoleByIndex: wCharServeRole of character `index` (its bank mapped for the read)
export function getCharRoleByIndex(E, index) {
  const saved = E.mem.u8(0xFF96);
  E.setBank(charIndexToWramBank(index));
  const role = E.C.serveRole;
  E.setBank(saved);
  return role;
}
// 08:7C70 SetCharTargetMirrored: SetCharTarget with the depth mirrored for the far side
export function setCharTargetMirrored(E, x, depth) {
  const C = E.C; C.walkTargetX = x; C.walkTargetDepth = mirrorDepthForFarSide(E, depth); C.walkTargetFlag = 0;
}
// 08:7C86 PredictBallXAtDepth: the ball's X when it reaches `depth` along the shot's aim angle (the solver's
// intent, not the live heading): (depth - wBallDepth) * tan(wShotAimAngle) + wBallX
export function predictBallXAtDepth(E, depth) {
  const S = E.S;
  return U16(S.ballX + E.M.mulHLByTangent(U16(depth - S.ballDepth), S.shotAimAngle));
}

// the AI's prediction of the ball's X at a depth: the game's straight line along the aim, or (Enhanced physics) the model's forward simulation of the live ball
function aiPredictX(E, depth) {
  if (E.physics && E.physics.aiAware) { const x = E.physics.xAtDepth(E, depth); if (x !== null) return x; }
  return predictBallXAtDepth(E, depth);
}

// ---- the controller ----
// 08:7963 AiAdvancePhase (falls into 08:796C AiPhaseNoop, a ret)
function aiAdvancePhase(E) { E.C.aiPhase = (E.C.aiPhase + 1) & 0xFF; }
function aiPhaseNoop() { }

// 08:7908 AiSteerTowardTarget: hold the d-pad direction (one of 16 sectors) towards the walk target
export function aiSteerTowardTarget(E) {
  const C = E.C;
  const dx = U16(C.walkTargetX - C.posXInt), dd = U16(C.walkTargetDepth - C.posDepthInt);
  steer(E, dd, dx);
}
// 08:7944 AiSteerTowardBall: the same towards the ball (wBallRelChar*)
export function aiSteerTowardBall(E) { steer(E, U16(E.S.ballRelCharDepth), U16(E.S.ballRelCharX)); }
function steer(E, hl, de) {
  const sector = E.M.angleFromVectorCoarse(hl, de) >> 4;
  E.C.inputBits = (E.C.inputBits & 0x0F) | E.rom.u8(8, ANGLE_TO_DPAD + sector);
}

// 08:7863 CharInputHandler1_08: the CPU player's input for this frame
export function charInputHandler1(E) {
  const C = E.C, S = E.S;
  if (C.aiActionTimer) { C.aiActionTimer--; return; }               // reaction delay: fully inert
  if (C.aiSecondButtonDelay) C.aiSecondButtonDelay--;
  let table;
  if (!S.matchIsDoubles) table = SINGLES;
  else if (E.partnerCmd && C.index === 2) table = E.partnerCmd === "back" ? BASELINER : NET_PLAYER;   // PARTNER (modes.js): your partner's role as told
  else table = C.serveRole & 2 ? NET_PLAYER : BASELINER;
  return dispatch(E, table, C.state, "wCharState");
}

// ---- target helpers (each ends in AiAdvancePhase) ----
// 08:796D AiRushToBallLanding: $160 short of the landing point along the aim, |depth| floored at $100
function aiRushToBallLanding(E) {
  const { x, depth } = offsetFromBallLanding(E, 0xFEA0);
  let d = ABS16(depth);
  if (U16(d + 0xFF00) & 0x8000) d = 0x0100;
  setCharTargetMirrored(E, x, d);
  aiAdvancePhase(E);
}
// 08:7992 AiMoveBehindBallLanding: $C0 beyond the landing point
function aiMoveBehindBallLanding(E) {
  const { x, depth } = offsetFromBallLanding(E, 0x00C0);
  setCharTarget(E, x, depth);
  aiAdvancePhase(E);
}
// meet the ball's line at a fixed depth on my side (08:799E AiInterceptAtMidCourt $200, 08:79B0 AiInterceptNearNet
// $100; also the bodies of AiTrackBallPhase, AiNetPlayerPredictLanding, AiBaselinerDone)
function targetBallLineAtDepth(E, depth) {
  setCharTargetMirrored(E, aiPredictX(E, mirrorDepthForFarSide(E, depth)), depth);
}
function aiInterceptAtMidCourt(E) { targetBallLineAtDepth(E, 0x0200); aiAdvancePhase(E); }   // 08:799E
function aiInterceptNearNet(E) { targetBallLineAtDepth(E, 0x0100); aiAdvancePhase(E); }      // 08:79B0
// 08:79C2 AiMoveLaterallyToBallLine: hold my depth, X where the ball will cross it
function aiMoveLaterallyToBallLine(E) {
  const depth = U16(E.C.posDepthInt);
  setCharTarget(E, aiPredictX(E, depth), depth);
  aiAdvancePhase(E);
}
// 08:79D3 AiSetMirroredTarget
function aiSetMirroredTarget(E, x, depth) { setCharTargetMirrored(E, x, depth); aiAdvancePhase(E); }
// 08:79D9 AiIsIncomingDropOrLobShot / 08:79E0 AiIsIncomingLobShot (a fallback trajectory counts as a lob)
function aiIsIncomingDropOrLobShot(E) { return E.S.currentShotType === SHOTTYPE_DROP || aiIsIncomingLobShot(E); }
function aiIsIncomingLobShot(E) { return E.S.currentShotType === SHOTTYPE_LOB || E.S.fallbackTrajectoryFlag !== 0; }

// ---- serve (state 3, all variants) ----
// 08:79F2 AiServeState
function aiServeState(E) {
  return dispatch(E, [aiServeWalkToSpot, aiServeSteerToSpot, aiServePressToss, aiServeStrike, aiServeApplyAim, aiPhaseNoop],
    E.C.aiPhase, "AiServeState phase");
}
// 08:7A02 AiServeWalkToSpot: once in the serve stance, pick a baseline X (mirrored on the left court)
function aiServeWalkToSpot(E) {
  const C = E.C, S = E.S;
  if (C.animId !== CHARANIM_SERVE_READY) return;
  let x = U16(S.aiServeTargetX);
  if (!x) x = E.rom.u16(8, SERVE_WALK_SPOT + 2 * (advanceMatchRng(E) & 7));
  if (C.courtPos & 1) x = NEG16(x);
  setCharTarget(E, x, U16(C.posDepthInt));
  aiAdvancePhase(E);
}
// 08:7A4D AiServeSteerToSpot: walk there, then wait 25 frames
function aiServeSteerToSpot(E) {
  aiSteerTowardTarget(E);
  if (!checkCharNearTarget(E)) return;
  E.C.aiActionTimer = 0x19;
  aiAdvancePhase(E);
}
// 08:7A5F AiServePressToss: press A to toss; the gap to the strike is 35 or 50 frames by the style's row
function aiServePressToss(E) {
  const C = E.C, S = E.S;
  C.inputBits |= 0x01;
  let wait = 0x32;
  if (!S.aiServeSkipToss && !S.serveFaultFlag) {
    const row = E.rom.u16(8, SERVE_PRESS_TOSS_PTRS + 2 * (C.aiServeStyle & 0x0F));
    if (E.rom.u8(8, U16(row + (advanceMatchRng(E) & 7)))) wait = 0x23;
  }
  C.aiActionTimer = wait;
  aiAdvancePhase(E);
}
// 08:7ADD AiServeStrike: choose and press the serve button, then aim (falls into AiServeApplyAim)
function aiServeStrike(E) {
  aiPickServeButtons(E);
  aiPressFirstShotButton(E);
  E.C.aiPhase = (E.C.aiPhase + 1) & 0xFF;
  aiServeApplyAim(E);
}
// 08:7AE7 AiServeApplyAim
function aiServeApplyAim(E) { aiApplyServeAim(E); }
// 08:7AEB AiApplyServeAim: wAiServeAimOverride ($FF = 50/50 left or right)
function aiApplyServeAim(E) {
  const o = E.S.aiServeAimOverride;
  const b = o !== 0xFF ? o : E.rom.u8(8, SERVE_AIM + (advanceMatchRng(E) & 7));
  E.C.inputBits = (E.C.inputBits & 0x0F) | b;
}

// ---- aim ----
// 08:7B13 AiRollAimAwayFromChar: with probability wAiAimAwayChance / 256 aim away from character `index`,
// otherwise release the d-pad (down the middle)
function aiRollAimAwayFromChar(E, index) {
  if (advanceMatchRng(E) >= E.C.aiAimAwayChance) { applyAim(E, 0x00); return; }
  aiAimAwayFromChar(E, index);
}
// 08:7B1F AiAimAwayFromChar: from the other character's X position and X velocity: 1 in 4 away from where he
// is, 1 in 4 at him, 2 in 4 away from where he is moving (where he is if standing still)
export function aiAimAwayFromChar(E, index) {
  const saved = E.mem.u8(0xFF96);
  E.setBank(charIndexToWramBank(index));
  const vel = U16(E.C.velX), pos = U16(E.C.posXInt);
  E.setBank(saved);
  let h = pos >> 8;
  const r = advanceMatchRng(E) & 3;
  const weak = E.plus ? learnAim(E, r) : 0; if (weak) { applyAim(E, weak); return; }   // PLAY+ SCOUTING: your weak side
  if (r === 1) h = ~h & 0xFF;
  else if (r !== 0 && vel) h = vel >> 8;
  applyAim(E, h & 0x80 ? 0x10 : 0x20);                               // right / left on the d-pad
}
function applyAim(E, b) { E.C.inputBits = (E.C.inputBits & 0x0F) | b; }

// ---- shot buttons ----
// 08:7B62 AiPickServeButtons: topspin 3/8, slice 2/8, flat (A+B) 3/8
function aiPickServeButtons(E) { E.C.aiShotButtons = E.rom.u8(8, SERVE_BUTTONS + (advanceMatchRng(E) & 7)); }
// 02:5EB3 GetCharGroupEntry: row `style` of CharGroupTable_02, entry i & $0F (the row offset is style * 16 in 8 bits)
function getCharGroupEntry(E, style, i) { return E.rom.u8(2, U16(CHAR_GROUP_TABLE + ((style << 4) & 0xFF) + (i & 0x0F))); }
// 02:5EE2 DoesCharGroupRowContain: does row `style` hold the code b anywhere
function doesCharGroupRowContain(E, style, b) {
  const base = U16(CHAR_GROUP_TABLE + ((style << 4) & 0xFF));
  for (let i = 0; i < 16; i++) if (E.rom.u8(2, U16(base + i)) === b) return 1;
  return 0;
}
// 08:7B7B AiPickShotButtons: smash a lob if the habit row has A+B; half the time lob a player at the net (from
// $140 away, singles: the opponent within depth $1E0, doubles: a 1-in-4 roll); else the style row's distribution
function aiPickShotButtons(E) {
  const C = E.C, S = E.S;
  if (S.landingMarkerActive && doesCharGroupRowContain(E, C.aiServeStyle, AISHOT.NEUTRAL)) { C.aiShotButtons = AISHOT.NEUTRAL; return; }
  if ((E.plus ? learnLobRoll(E, advanceMatchRng(E)) : !(advanceMatchRng(E) & 1)) && !(U16(ABS16(S.ballRelCharDepth) + 0xFEC0) & 0x8000) && doesCharGroupRowContain(E, C.aiServeStyle, AISHOT.LOB)) {
    let lob;
    if (S.matchIsDoubles) lob = !(advanceMatchRng(E) & 3);
    else {
      const saved = E.mem.u8(0xFF96);
      E.setBank(charIndexToWramBank((C.index + 1) & 1));
      const oppDepth = U16(E.C.posDepthInt);
      E.setBank(saved);
      lob = (U16(ABS16(oppDepth) + 0xFE20) & 0x8000) !== 0;           // the opponent within $1E0 of the net
    }
    if (lob) { C.aiShotButtons = AISHOT.LOB; return; }
  }
  C.aiShotButtons = getCharGroupEntry(E, C.aiServeStyle, advanceMatchRng(E) & 0x0F);
}
// 08:7C10 AiPressFirstShotButton / 08:7C21 AiPressSecondShotButton
function aiPressFirstShotButton(E) { E.C.inputBits = (E.C.inputBits & 0xF0) | (E.C.aiShotButtons >> 4); }
function aiPressSecondShotButton(E) { E.C.inputBits = (E.C.inputBits & 0xF0) | (E.C.aiShotButtons & 0x0F); }

// ---- singles ----
// 08:7CA4 AiRecoverStateSingles
function aiRecoverStateSingles(E) {
  return dispatch(E, [aiChooseHomePosition, aiReturnToPositionPhase, aiPhaseNoop], E.C.aiPhase, "AiRecoverStateSingles phase");
}
// 08:7CAE AiChooseHomePosition: between shots, by wAiPositionStrategy: baseline ($460), net (hold |depth|) or
// mid-court ($180), X a quarter of the landing X
function aiChooseHomePosition(E) {
  const C = E.C;
  const baseline = () => 0x0460, mid = () => 0x0180, net = () => ABS16(C.posDepthInt);
  const depth = dispatch(E, [baseline, net, mid, mid, mid, baseline, mid, mid], C.aiPositionStrategy, "wAiPositionStrategy");
  const [x, d] = E.plus ? learnHome(E, U16(E.S.ballTargetX >> 2), depth) : [U16(E.S.ballTargetX >> 2), depth];   // PLAY+ SCOUTING
  aiSetMirroredTarget(E, x, d);
}
// 08:7CED AiReturnToPositionPhase
function aiReturnToPositionPhase(E) {
  aiSteerTowardTarget(E);
  if (checkCharNearTarget(E)) aiAdvancePhase(E);
}
// 08:7CFA AiRallyStateSingles
function aiRallyStateSingles(E) {
  return dispatch(E, [aiSetReactionDelay, aiChoosePositionByStrategy, aiTrackBallPhase, aiWaitThenPickShot, aiSwingControlSingles, aiPhaseNoop],
    E.C.aiPhase, "AiRallyStateSingles phase");
}
// 08:7D0A AiSetReactionDelay: near (at the net) or far delay + 0-3
function aiSetReactionDelay(E) {
  const C = E.C, delay = C.ballReachFlags & REACH_NEAR_NET ? C.aiReactionDelayNear : C.aiReactionDelayFar;
  C.aiActionTimer = (advanceMatchRng(E) & 3) + delay;
  aiAdvancePhase(E);
}
// 08:7D23 AiChoosePositionByStrategy: where to meet the incoming ball, by wAiPositionStrategy
function aiChoosePositionByStrategy(E) {
  const rushIf = test => fallback => (test(E) ? aiRushToBallLanding(E) : fallback(E));
  const strategies = [
    aiMoveBehindBallLanding,                                                     // 0
    E => (E.C.ballReachFlags & REACH_NEAR_NET                                    // 1 adaptive
      ? rushIf(aiIsIncomingDropOrLobShot)(aiInterceptAtMidCourt)
      : rushIf(aiIsIncomingLobShot)(aiMoveBehindBallLanding)),
    E => rushIf(aiIsIncomingDropOrLobShot)(aiMoveLaterallyToBallLine),           // 2
    E => rushIf(aiIsIncomingDropOrLobShot)(aiInterceptAtMidCourt),               // 3
    aiMoveLaterallyToBallLine, aiMoveLaterallyToBallLine,                        // 4, 5
    aiInterceptNearNet,                                                          // 6
    aiMoveBehindBallLanding,                                                     // 7
  ];
  return dispatch(E, strategies, E.C.aiPositionStrategy, "wAiPositionStrategy");
}
// 08:7D73 AiTrackBallPhase: once the ball has crossed and bounced, retarget its line at depth $200 every frame;
// before that, walk to the target and move on when there (or the ball is in swing range)
function aiTrackBallPhase(E) {
  const C = E.C, S = E.S;
  if (S.ballHasBouncedFlag & S.ballCrossedNetFlag) { targetBallLineAtDepth(E, 0x0200); return; }
  if (!C.rallyReady) return;
  aiSteerTowardTarget(E);
  if (!checkCharNearTarget(E) && !(C.ballReachFlags & REACH_SWING)) return;
  C.aiTrackingCountdown = C.aiTrackingParam;
  C.aiPhase = (C.aiPhase + 1) & 0xFF;
  aiWaitThenPickShot(E);
}
// 08:7DAD AiWaitThenPickShot: at once if the ball is in swing range, else after wAiTrackingCountdown; the
// second button follows 5 frames later (the gap BufferShotButtonPress reads as A-then-B rather than A+B)
function aiWaitThenPickShot(E) {
  const C = E.C;
  if (!(C.ballReachFlags & REACH_SWING) && C.aiTrackingCountdown) { C.aiTrackingCountdown--; return; }
  aiPickShotButtons(E);
  aiPressFirstShotButton(E);
  C.aiSecondButtonDelay = 5;
  aiAdvancePhase(E);
}
// 08:7DCB AiSwingControlSingles: the second button when due; home on the ball until contact, then aim
function aiSwingControlSingles(E) {
  const C = E.C;
  if (!C.aiSecondButtonDelay && !C.shotButton2) aiPressSecondShotButton(E);
  if (!(C.ballReachFlags & REACH_CONTACT)) { aiSteerTowardBall(E); return; }
  aiRollAimAwayFromChar(E, (C.index + 1) & 1);
  aiAdvancePhase(E);
}

// ---- doubles ----
// 08:7DF2 AiRecoverStateNetPlayer / 08:7DFC AiRecoverStateBaseliner
function aiRecoverStateNetPlayer(E) {
  return dispatch(E, [aiTrackBallTargetX, aiReturnToPositionPhase, aiPhaseNoop], E.C.aiPhase, "AiRecoverStateNetPlayer phase");
}
function aiRecoverStateBaseliner(E) {
  return dispatch(E, [aiAdvancePhase, aiBaselinerShadowPartner, aiReturnToPositionPhase, aiPhaseNoop], E.C.aiPhase, "AiRecoverStateBaseliner phase");
}
// 08:7E08 AiTrackBallTargetX: the net player covers 3/4 of the landing X at depth $180
function aiTrackBallTargetX(E) {
  const x = E.S.ballTargetX;
  setCharTargetMirrored(E, U16((x >> 1) + (x >> 2)), 0x0180);
  aiAdvancePhase(E);
}
// 08:7E22 AiBaselinerShadowPartner: the baseliner parks at -+$C0, opposite the sign of the teammate's walk
// target X, at depth $460
function aiBaselinerShadowPartner(E) {
  const saved = E.mem.u8(0xFF96);
  E.setBank(charIndexToWramBank((E.C.index + 2) & 3));
  const x = E.C.walkTargetX & 0x8000 ? 0x00C0 : 0xFF40;
  E.setBank(saved);
  setCharTargetMirrored(E, x, 0x0460);
  aiAdvancePhase(E);
}
// 08:7E52 AiRallyStateNetPlayer / 08:7E68 AiRallyStateBaseliner (phase 8: the poach check)
function aiRallyStateNetPlayer(E) {
  return dispatch(E, [aiNetPlayerCheckRally, aiNetPlayerPredictLanding, aiDoublesTrackBallPhase, aiWaitThenPickShot,
    aiSwingControlDoubles, aiPhaseNoop, aiPhaseNoop, aiPhaseNoop, aiNetPlayerPoachCheck], E.C.aiPhase, "AiRallyStateNetPlayer phase");
}
function aiRallyStateBaseliner(E) {
  return dispatch(E, [aiBaselinerSetTarget, aiBaselinerDone, aiDoublesTrackBallPhase, aiWaitThenPickShot,
    aiSwingControlDoubles, aiPhaseNoop, aiPhaseNoop, aiPhaseNoop, aiNetPlayerPoachCheck], E.C.aiPhase, "AiRallyStateBaseliner phase");
}
// 08:7E7E AiNetPlayerCheckRally: from the second stroke on, the near reaction delay
function aiNetPlayerCheckRally(E) {
  const C = E.C;
  if (E.S.rallyLength < 2) return;
  C.aiActionTimer = (advanceMatchRng(E) & 3) + C.aiReactionDelayNear;
  C.aiTrackingCountdown = C.aiTrackingParam;
  aiAdvancePhase(E);
}
// 08:7E99 AiNetPlayerPredictLanding: the ball's line at depth $180
function aiNetPlayerPredictLanding(E) {
  targetBallLineAtDepth(E, 0x0180);
  E.C.aiTrackingCountdown = E.C.aiTrackingParam;
  aiAdvancePhase(E);
}
// 08:7EB1 AiBaselinerSetTarget: the far reaction delay
function aiBaselinerSetTarget(E) {
  const C = E.C;
  C.aiActionTimer = (advanceMatchRng(E) & 3) + C.aiReactionDelayFar;
  aiAdvancePhase(E);
}
// 08:7EC0 AiBaselinerDone: the ball's line at depth $460
function aiBaselinerDone(E) { targetBallLineAtDepth(E, 0x0460); aiAdvancePhase(E); }
// 08:7ED2 AiDoublesTrackBallPhase: walk to the target; if the teammate starts a swing first, check for a poach
function aiDoublesTrackBallPhase(E) {
  const C = E.C;
  if (!C.rallyReady) return;
  aiSteerTowardTarget(E);
  if (checkCharNearTarget(E) || C.ballReachFlags & REACH_SWING) { aiAdvancePhase(E); return; }
  const saved = E.mem.u8(0xFF96);
  E.setBank(charIndexToWramBank((C.index + 2) & 3));
  const mateButton = E.C.shotButton1;
  E.setBank(saved);
  if (!mateButton) return;
  E.C.aiPhase = 8;
  aiNetPlayerPoachCheck(E);
}
// 08:7F11 AiNetPlayerPoachCheck: ball in my swing range -> take it; else if the ball is more than 32 deeper
// than my teammate, slide to its line at my depth and go back to tracking
function aiNetPlayerPoachCheck(E) {
  const C = E.C;
  if (C.ballReachFlags & REACH_SWING) { C.aiPhase = 3; aiWaitThenPickShot(E); return; }
  const saved = E.mem.u8(0xFF96);
  E.setBank(charIndexToWramBank((C.index + 2) & 3));
  const ball = ABS16(E.S.ballDepth), mate = ABS16(E.C.posDepthInt);
  E.setBank(saved);
  if (!(U16(mate + (E.partnerCmd === "poach" && C.index === 2 ? -0x60 : 0x20) - ball) & 0x8000)) return;   // (PARTNER: poach: also for balls up to 96 short of the teammate)
  const depth = U16(E.C.posDepthInt);
  setCharTarget(E, aiPredictX(E, depth), depth);
  E.C.aiPhase = 2;
}
// 08:7F8A AiSwingControlDoubles: as singles, but always aims, away from the opponent playing the forward role
function aiSwingControlDoubles(E) {
  const C = E.C;
  if (!C.aiSecondButtonDelay && !C.shotButton2) aiPressSecondShotButton(E);
  if (!(C.ballReachFlags & REACH_CONTACT)) { aiSteerTowardBall(E); return; }
  let target = (C.index + 1) & 3;
  if (!(getCharRoleByIndex(E, target) & 2)) target = (E.C.index + 3) & 3;
  aiAimAwayFromChar(E, target);
  aiAdvancePhase(E);
}

// the state tables (08:78AA singles, 08:7886 doubles net player, 08:789A doubles baseliner): rally, recovery, serve
const SINGLES = [aiPhaseNoop, aiRallyStateSingles, aiRecoverStateSingles, aiServeState, aiPhaseNoop, aiPhaseNoop, aiPhaseNoop, aiPhaseNoop];
const NET_PLAYER = [aiPhaseNoop, aiRallyStateNetPlayer, aiRecoverStateNetPlayer, aiServeState, aiPhaseNoop, aiPhaseNoop, aiPhaseNoop, aiPhaseNoop];
const BASELINER = [aiPhaseNoop, aiRallyStateBaseliner, aiRecoverStateBaseliner, aiServeState, aiPhaseNoop, aiPhaseNoop, aiPhaseNoop, aiPhaseNoop];

// exported for the routine tests and for callers in other modules
export {
  aiAdvancePhase, aiRushToBallLanding, aiMoveBehindBallLanding, aiInterceptAtMidCourt, aiInterceptNearNet, aiMoveLaterallyToBallLine,
  aiIsIncomingDropOrLobShot, aiIsIncomingLobShot, aiServeState, aiApplyServeAim, aiRollAimAwayFromChar, aiPickServeButtons,
  aiPickShotButtons, aiPressFirstShotButton, aiPressSecondShotButton, aiRecoverStateSingles, aiChooseHomePosition,
  aiReturnToPositionPhase, aiRallyStateSingles, aiChoosePositionByStrategy, aiTrackBallPhase, aiWaitThenPickShot,
  aiSwingControlSingles, aiRecoverStateNetPlayer, aiRecoverStateBaseliner, aiRallyStateNetPlayer, aiRallyStateBaseliner,
  aiDoublesTrackBallPhase, aiNetPlayerPoachCheck, aiSwingControlDoubles, getCharGroupEntry, doesCharGroupRowContain,
  setCharTarget, checkCharNearTarget, aiPhaseNoop, aiSetMirroredTarget, aiServeWalkToSpot, aiServeSteerToSpot, aiServePressToss,
  aiServeStrike, aiServeApplyAim, aiSetReactionDelay, aiTrackBallTargetX, aiBaselinerShadowPartner, aiNetPlayerCheckRally,
  aiNetPlayerPredictLanding, aiBaselinerSetTarget, aiBaselinerDone,
};
