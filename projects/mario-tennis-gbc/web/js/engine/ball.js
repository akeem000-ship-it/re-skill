// The ball: physics step, angles and speed, court damping, the net, the fences, and the per-frame ball
// events that end points (bank $08; ball_effects_08 / match_frames_08 / match_08 in the disassembly).
// Positions are 16.16 (ballXFull...), velocities 24-bit aligned with the position's low three bytes
// (ballVelocityXFull...), so a raw velocity v moves v / 65536 units per frame.
import { setCharState, forEachCharBank } from "./chars.js";

export const SFX_NET_CORD = 0x5A, SFX_BALL_BOUNCE = 0x5B, SFX_BALL_CONTACT = 0x77, SFX_LANDING_MARKER = 0x6D, SFX_SPECIAL_HIT = 0x55;
export const SHOTTYPE_LOB = 0x0A;
export const POINTOUTCOME = { FAULT: 1, DOUBLE_FAULT: 2, LET: 3, NET: 4, OUT: 5, WINNER: 6, SERVE_VOLLEYED: 7, WRONG_RECEIVER: 8, BALL_HIT_PLAYER: 9 };
const MINIGAME_USES_WALL = 0xC7B9, MODE_HOOK_BANK = 0xC7B4;
const S16 = v => (v << 16) >> 16, NEG16 = v => (-v) & 0xFFFF, ABS16 = v => (S16(v) < 0 ? NEG16(v) : v & 0xFFFF);

// 08:43F6 AdvanceMatchRng: a byte sum of the state and the ball's fraction bytes, so it is a pure function
// of the state and the ball (the reason link play needs no RNG sync)
export function advanceMatchRng(E) {
  const m = E.mem, a = (m.u8(0xC8DF) + 0x73 + m.u8(0xC409) + m.u8(0xC401) + m.u8(0xC405)) & 0xFF;
  m.w8(0xC8DF, a); return a;
}
// 08:66F1 CallModeHook: minigames and drills hook the frame here (wModeHookBank 0 = a normal match)
export function callModeHook(E, id) { if (E.mem.u8(MODE_HOOK_BANK) && E.modeHook) E.modeHook(id); }

// 08:5767 StepBallPhysics
export function stepBallPhysics(E) {
  const S = E.S, m = E.mem, M = E.M;
  S.ballBounceEvent = 0;
  for (let i = 0; i < 12; i++) m.w8(0xC410 + i, m.u8(0xC400 + i));      // wBallPrev* = the position block
  M.addVel24ToPos32(0xC400, 0xC420); M.addVel24ToPos32(0xC404, 0xC423); M.addVel24ToPos32(0xC408, 0xC426);
  bounceBallOffCourtFences(E);
  handleBallNetCrossing(E);
  S.ballCourtQuadrant = (S.ballDepth < 0 ? 2 : 0) | (S.ballX < 0 ? 1 : 0);   // bit 1 = far side, bit 0 = left half
  updateBallAnglesAndSpeed(E);
  applyBallAirDrag(E);
  applyBallSpin(E);
  if (getBallHeightSign(E) === 0xFF) { M.addDEToMem24(0xC426, 0x4A00); return; }   // airborne: gravity
  // at or through the ground: damp, reflect the penetration, bounce
  applyCourtBounceDamping(E);
  S.ballHeightFull = -S.ballHeightFull | 0;
  if (getBallHeightSign(E) === 0) return;
  S.ballBounceEvent = 1;
  S.ballVelocityHeightFull = ~S.ballVelocityHeightFull;                 // one's complement
  if (((S.ballVelocityHeight + 0x0250) & 0x8000) === 0) { S.ballHeightFull = 0; S.ballVelocityHeightFull = 0; }   // too slow: at rest
}

// 08:55B4 ApplyBallAirDrag: each axis loses (v / 2) * k / 256 with k = |speed3D high byte| / 16 + 1
export function applyBallAirDrag(E) {
  const S = E.S, M = E.M;
  let hi = (S.ballSpeed3D >> 8) & 0xFF; if (hi & 0x80) hi = (-hi) & 0xFF;
  const k = (hi >> 4) + 1;
  for (const [word, full] of [[0xC421, 0xC420], [0xC424, 0xC423], [0xC427, 0xC426]]) {
    const half = (E.mem.s16(word) >> 1) & 0xFFFF, r = M.mulSignedHLByAFrac(half, k);
    M.add24ToMem24(full, M.negateADE(r.hl << 8 | r.a));
  }
}
// spin term: |s| * |v| as a 32-bit product shifted right by `shift` and taken as a 24-bit value, signed by hMathSign
function spinTerm(E, s, v, shift) {
  const M = E.M, hl = M.mulHLByDEAbs(s & 0xFFFF, v & 0xFFFF), p = (hl * 0x10000 + (E.mem.u8(0xFFA9) << 8)) / 256;   // d:e:a = hl : hMulResult+1
  const t = Math.floor(p / (1 << shift)) & 0xFFFFFF;                     // sra on d is safe: hl >> shift keeps the sign bit clear for these sizes
  return { t, neg: (M.mathSign & 0x80) !== 0 };
}
// 08:5613 ApplyBallSpin: sidespin curves the ball in the horizontal plane, topspin turns the (horizontal,
// vertical) velocity pair; both coefficients decay by 3/256 per frame
export function applyBallSpin(E) {
  const S = E.S, M = E.M, m = E.mem;
  const sra24 = (hl, a, n) => { let v = ((hl << 16) >> 8) | a; v >>= n; return v & 0xFFFFFF; };   // sra d / rr e / rra on d:e:a
  if (S.ballSideSpin !== 0) {
    let hl = M.mulHLByDEAbs(S.ballSideSpin & 0xFFFF, S.ballVelocityDepth & 0xFFFF);
    let dX = sra24(hl, m.u8(0xFFA9), 4); if (!(M.mathSign & 0x80)) dX = M.negateADE(dX);      // velX += -k * velDepth
    hl = M.mulHLByDEAbs(S.ballSideSpin & 0xFFFF, S.ballVelocityX & 0xFFFF);
    let dD = sra24(hl, m.u8(0xFFA9), 4); if (M.mathSign & 0x80) dD = M.negateADE(dD);         // velDepth += k * velX
    M.add24ToMem24(0xC423, dD);
    M.add24ToMem24(0xC420, dX);
    S.ballSideSpin = decay(S.ballSideSpin);
  }
  if (S.ballTopspin !== 0) {
    // height velocity * topspin -> a 16-bit term pushed along the heading
    let hl = M.mulHLByDEAbs(S.ballTopspin & 0xFFFF, S.ballVelocityHeight & 0xFFFF);
    let v = sra24(hl, m.u8(0xFFA9), 5);
    let term = v & 0xFFFF;                                                // ld d, e / ld e, a: the low 16 bits
    if (!(M.mathSign & 0x80)) term = NEG16(term);
    // horizontal speed * topspin into the height velocity
    hl = M.mulHLByDEAbs(S.ballTopspin & 0xFFFF, S.ballSpeedHorizontal & 0xFFFF);
    let dH = sra24(hl, m.u8(0xFFA9), 4); if (M.mathSign & 0x80) dH = M.negateADE(dH);
    M.add24ToMem24(0xC426, dH);
    const r = M.mulSinCosSigned(term, S.ballHeadingAngle);             // de = term*sin -> depth, hl = term*cos -> X
    const widen = w => { const x = (w << 1) & 0x1FFFF; const hi = x >> 8 & 0xFF, sign = x & 0x10000 ? 0xFF : 0; return sign << 16 | hi << 8 | (x & 0xFF); };
    M.add24ToMem24(0xC423, widen(r.de));                               // add hl,hl / sbc a: sign-extended 2*term in 8.16
    M.add24ToMem24(0xC420, widen(r.hl));
    S.ballTopspin = decay(S.ballTopspin);
  }
}
// spin -= 3 * (spin >> 8) (sign-extended high byte)
const decay = s => (s - 3 * ((s & 0xFFFF) << 16 >> 24)) & 0xFFFF;

// 08:5814 HandleBallNetCrossing
export function handleBallNetCrossing(E) {
  const S = E.S, m = E.mem;
  S.ballCrossedNetFlag = 0;
  if (((m.u8(0xC407) ^ m.u8(0xC417)) & 0x80) === 0) return;            // the depth's sign did not change
  S.ballCrossedNetFlag = 1;
  if (m.u8(MINIGAME_USES_WALL)) return;
  if ((S.ballHeight + S.netHeight) & 0x8000) return;                    // above the net
  E.sfx(SFX_NET_CORD);
  startBounceEffect(E);
  S.ballHasBouncedFlag = 1;                                             // "touched the net since the last strike"
  for (let i = 0; i < 4; i++) m.w8(0xC404 + i, ~m.u8(0xC404 + i));      // reflect the depth (one's complement)
  S.ballVelocityX = S16(S.ballVelocityX) >> 2;                           // quarter the X speed (8.8 word)
  const h = S.ballHeight & 0xFFFF;
  const popUp = () => {                                                 // kick up by |velDepth| / 8 + rand * 4
    let d = S16(S.ballVelocityDepth) >> 3; if (d < 0) d = -d;
    S.ballVelocityHeight = NEG16(advanceMatchRng(E) * 4 + d);
  };
  if (((h + 0x5A) & 0x8000) !== 0) {                                    // within 6 of the tape: the net cord
    S.ballHeightFull = 0; S.ballHeight = 0xFFA0;
    popUp();
    S.ballVelocityDepth = S16(S.ballVelocityDepth) >> 2;               // dribbles on at a quarter of the speed
    return;
  }
  if (((h + 0x58) & 0x8000) !== 0) {                                    // just below the tape: pops back
    popUp();
    S.ballVelocityDepth = S16(NEG16(S.ballVelocityDepth)) >> 3;
    return;
  }
  S.ballVelocityDepth = S16(NEG16(S.ballVelocityDepth)) >> 3;           // into the net: drops back at 1/8
}

// 08:5949 BounceBallOffCourtFences: depth beyond $6E0 / -$700 or |X| beyond $3A0: reverse, re-step, damp twice
export function bounceBallOffCourtFences(E) {
  const S = E.S, M = E.M, d = S.ballDepth;
  if (d >= 0 ? d >= 0x6E0 : d < -0x700) {
    S.ballVelocityDepthFull = ~S.ballVelocityDepthFull;
    M.addVel24ToPos32(0xC404, 0xC423);
    applyCourtBounceDamping(E); applyCourtBounceDamping(E);
    S.ballBounceEvent = 2;
  }
  if (ABS16(S.ballX) >= 0x3A0) {
    S.ballVelocityXFull = ~S.ballVelocityXFull;
    M.addVel24ToPos32(0xC400, 0xC420);
    applyCourtBounceDamping(E); applyCourtBounceDamping(E);
    S.ballBounceEvent = 2;
  }
}

// 08:45E5 UpdateBallAnglesAndSpeed: heading = atan2(vX, vDepth), horizontal speed, pitch, 3-D speed
export function updateBallAnglesAndSpeed(E) {
  const S = E.S, M = E.M;
  const vx = S.ballVelocityX & 0xFFFF, vd = S.ballVelocityDepth & 0xFFFF, vh = S.ballVelocityHeight & 0xFFFF;
  S.ballHeadingAngle = M.angleFromVector16(vd, vx);
  const horiz = M.vectorLengthFromAngle(vx, vd, S.ballHeadingAngle);
  S.ballSpeedHorizontalFull = horiz << 8;
  S.ballPitchAngle = M.angleFromVector16(vh, horiz);
  S.ballSpeed3D = M.vectorLengthFromAngle(horiz, vh, S.ballPitchAngle);
}
// 08:4677 GetBallHeightSign: 0 on the ground, 1 below it, $FF in the air
export function getBallHeightSign(E) {
  const h = E.S.ballHeightFull; return h === 0 ? 0 : h < 0 ? 0xFF : 1;
}
// 08:468B MulMem24ByFrac: the 24-bit value at addr times b/256, the fraction byte dropped (sign-magnitude)
export function mulMem24ByFrac(E, addr, b) {
  const M = E.M, v = E.mem.u24(addr);
  if (!(v & 0x800000)) return M.mulHLByAFracSigned(v >> 8, b).hl << 8;
  const r = M.mulHLByAFracSigned(M.negateADE(v) >> 8, b).hl;
  return M.negateADE(r << 8);
}
// 08:46B0 ApplyCourtBounceDamping: horizontal velocity * friction, height velocity * restitution (per court)
export function applyCourtBounceDamping(E) {
  const S = E.S, m = E.mem;
  m.w24(0xC420, mulMem24ByFrac(E, 0xC420, S.courtSurfaceFriction));
  m.w24(0xC423, mulMem24ByFrac(E, 0xC423, S.courtSurfaceFriction));
  m.w24(0xC426, mulMem24ByFrac(E, 0xC426, S.courtSurfaceBounce));
}
// 08:463A CheckBallOutOfBounds: bit 0 = beyond the lateral limit, bit 1 = beyond the depth limit (limits stored negated)
export function checkBallOutOfBounds(E) {
  const S = E.S;
  let d = 0;
  if (ABS16(S.ballX) + (S.courtLimitX & 0xFFFF) > 0xFFFF) d |= 1;
  if (ABS16(S.ballDepth) + (S.courtLimitDepth & 0xFFFF) > 0xFFFF) d |= 2;
  S.ballOutOfBoundsBits = d; return d;
}
// 08:458B SetBallPosition (whole units, fractions cleared)
export function setBallPosition(E, x, depth, height) {
  const S = E.S; S.ballHeightFull = height << 16; S.ballDepthFull = depth << 16; S.ballXFull = x << 16;
}
// 08:45A9 SetBallVelocityPolar: magnitude hl, elevation bc, heading de -> the three velocity triples
export function setBallVelocityPolar(E, hl, elevation, heading) {
  const S = E.S, M = E.M;
  S.ballVelocityPolarLength = hl;
  const v = M.mulSinCosSigned(hl, elevation);                           // hl*cos = horizontal, hl*sin = height
  S.ballVelocityHeightFull = v.de << 8;
  const h = M.mulSinCosSigned(v.hl, heading);
  S.ballVelocityXFull = h.hl << 8;
  S.ballVelocityDepthFull = h.de << 8;
}
// 08:511C ResetBallState
export function resetBallState(E, setTrailColor) {
  const S = E.S, m = E.mem;
  S.ballSpriteEnabled = 0; S.ballShadowEnabled = 0; S.ballTrailEnabled = 0; S.bounceEffectTimer = 0;
  setBallPosition(E, 0x0380, 0, 0);
  for (let i = 0; i < 9; i++) m.w8(0xC420 + i, 0);
  for (let i = 0; i < 4; i++) m.w8(0xC41C + i, 0);
  m.w16(0xC430, 0);
  setTrailColor(0);
}

// ---- effects whose state the game keeps (positions are screen-projected, used only for drawing) ----
// 08:5383 StartBounceEffect / 08:53D0 StartHitEffect
export function startBounceEffect(E) {
  const S = E.S, p = E.M.projectWorldToScreen(S.ballX & 0xFFFF, S.ballDepth & 0xFFFF, S.ballHeight & 0xFFFF);
  S.bounceEffectX = p.hl; S.bounceEffectY = p.bc; S.bounceEffectTimer = 0x14;
}
export function startHitEffect(E) {
  const S = E.S, p = E.M.projectWorldToScreen(S.ballX & 0xFFFF, S.ballDepth & 0xFFFF, S.ballHeight & 0xFFFF);
  S.hitEffectX = p.hl; S.hitEffectY = p.bc;
  if (S.specialShotFlag || S.shotChargeLevel === 0x3F) { S.specialHitTimer = 0x10; E.sfx(SFX_SPECIAL_HIT); }
  else S.hitSparkTimer = 0x10;
}
export function startBallTouchCharEffect(E) { E.S.ballTouchCharTimer = 0x28; }   // 08:547C
// 08:7C57 OffsetFromBallLanding: the landing point moved hl along the aim angle -> { x, depth }
export function offsetFromBallLanding(E, hl) {
  const S = E.S, v = E.M.vectorFromLengthAndAngle(hl, S.shotAimAngle >> 8);
  return { x: (S.ballTargetX + v.hl) & 0xFFFF, depth: (S.ballTargetDepth + v.de) & 0xFFFF };
}
// 08:52DA StartLandingMarker: for a lob or a fallback trajectory, 320 short of the predicted landing point,
// unless that is within 128 of the net; within 256 it is pushed out to depth +-256
export function startLandingMarker(E) {
  const S = E.S;
  if (S.currentShotType !== SHOTTYPE_LOB && !S.fallbackTrajectoryFlag) return;
  let { x, depth } = offsetFromBallLanding(E, 0xFEC0);
  if (ABS16(depth) < 0x80) return;
  if (ABS16(depth) < 0x100) depth = S.ballTargetDepth >= 0 ? 0x0100 : 0xFF00;
  const p = E.M.projectWorldToScreen(x, depth, 0);
  S.landingMarkerX = p.hl; S.landingMarkerY = p.bc;
  S.landingMarkerActive = 1;
  E.sfx(SFX_LANDING_MARKER);
}

// 08:5153 UpdateBallVisuals: the physics step, then the drawing side (sprite slots and the history ring are
// not kept by the engine) and the two effect timers
export function updateBallVisuals(E) {
  stepBallPhysics(E);
  const S = E.S;
  if (S.bounceEffectTimer) S.bounceEffectTimer--;
  if (S.hitSparkTimer) S.hitSparkTimer--;
}

// ---- per-frame ball events (UpdateMatchFrame steps 4-8) ----
// 08:4242 TickRallyTimers
export function tickRallyTimers(E) {
  const S = E.S;
  if (!S.ballCrossedNetFlag) return;
  if (S.rallyNetFrames < 0x64) S.rallyNetFrames++;
  if (S.rallyLength === 1) {
    if (!S.pointOutcome) S.cameraFollowBall = 1;
    if (S.ballHasBouncedFlag) forEachCharBank(E, () => setCharState(E, 5));   // a served let: everyone to standby
  }
  callModeHook(E, 6);
}
// 08:427A HandleBallHitEvent
export function handleBallHitEvent(E) {
  const S = E.S;
  if (!S.ballHitEvent) return;
  if (S.rallyLength < 0x64) S.rallyLength++;
  S.ballHitEvent = 0; S.ballHasBouncedFlag = 0; S.landingMarkerActive = 0;
  startLandingMarker(E);
  startHitEffect(E);
  for (const k of [3, 2, 1, 0]) { E.setBank(4 + k); setCharStateOnBallHit(E); }
  detectServeAceOutcome(E);
  callModeHook(E, 4);
  S.ballBounceCount = 0;
  if (S.rallyLength === 1) {
    if (S.specialShotFlag) { E.banner(0x0E); E.events.push(["bannerPos", S.servingCharCourtPos & 2 ? 0xF000 : 0xF0D8]); }   // power serve
  } else if (S.rallyLength === 2) {                                     // the serve was returned: full court limits
    S.courtLimitDepth = -0x4E0;
    S.courtLimitX = S.matchIsDoubles ? -0x240 : -0x1B0;
  }
}
// 08:430F SetCharStateOnBallHit: SetCharStateOnBallHitTable 08:431E = 0 2 1 2 2 1 6 7 — whoever hit recovers,
// everyone else gets rally-ready. Indexed unchecked: an unused slot's leftover state reads past the table.
export function setCharStateOnBallHit(E) { setCharState(E, E.rom.u8(8, 0x431E + E.C.state)); }
// 08:4326 DetectServeAceOutcome: the second hit of a point must be the receiver's, after the bounce
export function detectServeAceOutcome(E) {
  const S = E.S;
  if (S.rallyLength !== 2 || S.pointOutcome) return;
  if (S.lastShotServeRole !== 1) { S.pointOutcome = POINTOUTCOME.WRONG_RECEIVER; S.pointOutcomeSide = -1; return; }
  if (S.ballBounceCount === 0) { S.pointOutcome = POINTOUTCOME.SERVE_VOLLEYED; S.pointOutcomeSide = -1; }
}
// 08:4352 HandleBallBounceEvent
export function handleBallBounceEvent(E) {
  const S = E.S;
  if (!S.ballBounceEvent) return;
  if (S.ballBounceCount < 2) E.sfx(SFX_BALL_BOUNCE);
  if (S.ballBounceCount < 0x0A) S.ballBounceCount++;
  S.landingMarkerActive = 0;
  startBounceEffect(E);
  evaluateBounceOutcome(E);
  callModeHook(E, 5);
}
// 08:4379 EvaluateBounceOutcome: the first writer of wPointOutcome wins; the side is relative to the last hitter
export function evaluateBounceOutcome(E) {
  const S = E.S;
  if (!S.rallyLength || S.pointOutcome) return;
  const set = (o, side) => { S.pointOutcome = o; S.pointOutcomeSide = side; };
  if (S.ballBounceCount !== 1) return set(POINTOUTCOME.WINNER, 1);                       // second bounce
  if (((S.ballCourtQuadrant ^ S.ballQuadrantAtHit) & 2) === 0) return set(POINTOUTCOME.NET, -1);   // own side
  if (checkBallOutOfBounds(E)) return set(POINTOUTCOME.OUT, -1);
  if (S.rallyLength !== 1) return;
  if (((S.ballCourtQuadrant ^ S.ballQuadrantAtHit) & 1) === 0) return set(POINTOUTCOME.OUT, -1);   // serve: wrong box
  if (S.ballHasBouncedFlag) set(POINTOUTCOME.LET, 0);
}
// 08:43D3 HandleBallTouchCharEvent / 08:43E5 ApplyBallTouchOutcome
export function handleBallTouchCharEvent(E) {
  const S = E.S;
  if (!S.ballTouchCharFlag) return;
  S.ballTouchCharFlag = 0;
  E.sfx(SFX_BALL_CONTACT);
  startBallTouchCharEffect(E);
  if (!S.pointOutcome) { S.pointOutcome = POINTOUTCOME.BALL_HIT_PLAYER; S.pointOutcomeSide = 1; }
}
