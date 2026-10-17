// The shot solver: ExecuteShot and everything it runs at the contact frame (bank $07: shot_power_07,
// execute_07, placement_07, char_07 in the disassembly), and the ball-path banks that turn the requested
// speed into a launch — the stroke banks $20-$23, the lob/drop/neutral/smash/reach/fallback bank $24, the
// serve banks $29-$2B and the stretch-reach bank $2C (src/data/shots and the shared prologue in src/twins).
//
// The game does not integrate a launch velocity of its own choosing: each family owns precomputed rows
// [speed, elevation, aim delta] indexed by distance / 64, and the shot's speed budget picks the farthest
// row it pays for within the legal landing window ComputeShotTrajectory works out. All tables are read
// from the ROM at run time. Every routine runs with the hitter's WRAM bank mapped (E.C is the hitter).
//
// Register conventions of the ROM are kept as plain values: a routine that leaves its result in bc / de
// returns it as an unsigned 16-bit number.
import { advanceMatchRng, setBallVelocityPolar } from "./ball.js";
import { predictBallXAtDepth } from "./ai.js";                         // 08:7C86, farcalled by the serve banks

export const SHOTTYPE = {
  TOPSPIN: 0x00, POWER_TOPSPIN: 0x01, SLICE: 0x02, POWER_SLICE: 0x03, NEUTRAL: 0x04, REACH: 0x05,
  REACH_POWER_TOPSPIN: 0x06, REACH_POWER_SLICE: 0x07, REACH_BASIC: 0x08, SMASH: 0x09, LOB: 0x0A, DROP: 0x0B,
  SERVE_TOPSPIN: 0x0C, SERVE_SLICE: 0x0D, SERVE_FLAT: 0x0E,
};
const CHARB_RECOIL = 0x01, CHARB_DIVING = 0x02, CHARB_CHARGING = 0x20;
const CHARANIM_BACKHAND = 0x06, CHARANIM_OVERHEAD = 0x07, CHARANIM_SMASH = 0x08, CHARANIM_BACKHAND_QUICK = 0x0A;
const MINIGAME_USES_WALL = 0xC7B9, SHOT_AIM_ROW = 0xC472;                 // wMinigameUsesWall; wShotAimRow (a byte write)
const PALETTE_BUFFER_A = 0xC100, PALETTE_BUFFER_B = 0xC200, PALETTE_DIRTY_FLAGS = 0xFF9D;   // hPaletteDirtyFlags

const U16 = v => v & 0xFFFF, S16 = v => (v << 16) >> 16, NEG16 = v => (-v) & 0xFFFF;
const ABS16 = v => (v & 0x8000 ? NEG16(v) : v & 0xFFFF);
const SRA16 = (v, n) => (S16(v) >> n) & 0xFFFF;                         // n x (sra h / rr l)
const neg = v => (v & 0x8000) !== 0;                                     // bit 7, h

// ---- ROM / memory reads at a CPU address with `bank` mapped at $4000 (table pointers can run past a table)
function rd8(E, bank, addr) {
  addr &= 0xFFFF;
  if (addr < 0x8000) return E.rom.u8(bank, addr);
  if (addr >= 0xC000 && addr < 0xE000) return E.mem.u8(addr);
  throw new Error(`shot: read of $${addr.toString(16)} (bank $${bank.toString(16)}) outside ROM and WRAM`);
}
const rd16 = (E, bank, addr) => rd8(E, bank, addr) | rd8(E, bank, addr + 1) << 8;
const indexed = (base, a) => (base + (a & 0xFF)) & 0xFFFF;               // ld_hl_indexed / add l with carry into h

// =====================================================================================================
// ExecuteShot and its recoil task (shot_power_07)
// =====================================================================================================

// 07:53B0 ExecuteShot: farcalled by the character state machine at the contact frame (08:6BD1 serve,
// 08:6C91 rally) with the hitter's WRAM bank mapped. A second hit in the same frame is ignored.
export function executeShot(E) {
  const S = E.S, C = E.C;
  if (S.ballHitEvent) return;
  S.ballHitEvent = 1;
  // snapshot the hitter, so the rest of the frame does not depend on who swung
  S.lastShotCharIndex = C.index;
  S.lastShotServeRole = C.serveRole;
  S.lastShotAimOffset = C.aimOffset;
  S.currentShotType = C.shotType;
  const b1 = C.shotButton1;
  S.lastShotButtons = ((b1 << 4) | (b1 >> 4) | C.shotButton2) & 0xFF;   // swap a / or [wCharShotButton2]
  S.ballQuadrantAtHit = S.ballCourtQuadrant;
  S.specialShotFlag = 0; S.lastShotWasPowerShot = 0; S.fallbackTrajectoryFlag = 0;
  // wShotAimMirror: the low bit of a count of four conditions; odd negates every lateral offset later on
  let n = 0;
  if (C.swingAnim === CHARANIM_BACKHAND) n++;
  if (C.swingAnim === CHARANIM_BACKHAND_QUICK) n++;
  if (C.mirrorAttrMask) n++;
  if (S.rallyLength === 0) n++;
  S.shotAimMirror = n & 1;
  S.shotChargeLevel = Math.min(C.swingFrames, 0x3F);
  S.shotWasQuickSwing = C.quickSwing;
  S.shotRecoilVelocityX = S.ballVelocityX;                               // the incoming ball velocity, for the recoil
  S.shotRecoilVelocityDepth = S.ballVelocityDepth;
  // rst Rst00 on wCurrentShotType; ShotRecoilFrameTask was pushed as the handler's return address
  const handler = EXECUTE_SHOT_HANDLERS[S.currentShotType];
  if (!handler) throw new Error(`ExecuteShot: shot type $${S.currentShotType.toString(16)} past the jump table`);
  handler(E);
  shotRecoilFrameTask(E);
}

// 07:5463 ShotRecoilFrameTask: runs when the shot handler returns
export function shotRecoilFrameTask(E) {
  applyShotRecoil(E);
  E.C.swingFrames = 0;
}

// 07:546B ApplyShotRecoil: the hitter keeps a quarter of the depth velocity (and of X unless diving), plus
// a push from the incoming ball scaled by ShotRecoilTable_07 (07:54D4) at the speed index the preset's
// recoil variant names (ShotRecoilVarPtrs_07 07:54CA, pointers into the character struct; unchecked index)
export function applyShotRecoil(E) {
  const S = E.S, C = E.C, M = E.M;
  C.flags = (C.flags | CHARB_RECOIL) & ~CHARB_CHARGING;
  const ptr = rd16(E, 7, indexed(0x54CA, S.shotRecoilVariant << 1));
  const k = rd8(E, 7, indexed(0x54D4, rd8(E, 7, ptr)));
  const push = M.mulHLByAFracSigned(U16(S.shotRecoilVelocityDepth), k).hl;
  C.velDepth = SRA16(C.velDepth, 2) + push;
  if (!(C.flags & CHARB_DIVING)) C.velX = SRA16(C.velX, 2);
}

// 07:54DE WeakenShotByCharge: bc - charge * 4
export function weakenShotByCharge(E, bc) { return U16(bc - E.S.shotChargeLevel * 4); }
// 07:54ED BoostShotByCharge: bc + charge * 12 (the lob)
export function boostShotByCharge(E, bc) { return U16(bc + E.S.shotChargeLevel * 12); }
// 07:54FE NudgeShotByPlayerMomentum: bc + depth velocity / 16, toward the far side
export function nudgeShotByPlayerMomentum(E, bc) {
  let hl = SRA16(E.C.velDepth, 4);
  if (!(E.C.courtPos & 2)) hl = NEG16(hl);
  return U16(hl + bc);
}

// 07:5525 CheckBallInSmashRange: a cone test over the ball's depth and height. Returns the flags the ROM
// leaves (Z set = "not smashable"): { z, f } with f the full F register (bit 7, h: N clear, H set, C kept).
export function checkBallInSmashRange(E) {
  const S = E.S, M = E.M;
  let hl = ABS16(S.ballDepth);
  const de = U16(hl + SRA16(hl, 1)), y = SRA16(de, 1);                  // 3/4 |depth|
  const h0 = U16(S.ballHeight) + 0x70;
  let carry = h0 > 0xFFFF ? 1 : 0;
  hl = U16(h0);
  if (!neg(hl)) return flagsZ(true, carry);                             // below -$70: too low to smash
  const a1 = M.angleFromVector16(hl, y);
  const a2 = M.angleFromVector16(NEG16(S.ballHeight), U16(ABS16(S.ballDepth) + 0x04E0));
  const sum = a1 + a2;
  carry = sum > 0xFFFF ? 1 : 0;
  return flagsZ(!neg(U16(sum)), carry);
}
const flagsZ = (z, c) => ({ z, f: (z ? 0x80 : 0) | 0x20 | (c ? 0x10 : 0) });

// 07:557E ApplyShotTypePresets: ShotTypePresets_07 (07:559E), 5 bytes per type: [sound, recoil variant,
// trail colour, target depth] -> the target depth (bc)
export function applyShotTypePresets(E) {
  const row = indexed(0x559E, E.S.currentShotType * 5);
  E.sfx(rd8(E, 7, row));                                                 // PlaySoundManaged (the SFX_HIT_* ids)
  E.S.shotRecoilVariant = rd8(E, 7, row + 1);
  setBallTrailColor(E, rd8(E, 7, row + 2));
  return rd16(E, 7, row + 3);
}

// 08:5189 SetBallTrailColor: wBallTrailColor, and object palette 0 from BallTrailPalettes (08:50DC) into both
// palette buffers through LoadPalettesImmediate (00:05B5, de = $0801: one OBJ palette -> hPaletteDirtyFlags bit 1)
export function setBallTrailColor(E, a) {
  const m = E.mem;
  E.S.ballTrailColor = a;
  const src = indexed(0x50DC, a << 3);
  for (let i = 0; i < 8; i++) { const v = rd8(E, 8, src + i); m.w8(PALETTE_BUFFER_A + 0x40 + i, v); m.w8(PALETTE_BUFFER_B + 0x40 + i, v); }
  m.w8(PALETTE_DIRTY_FLAGS, m.u8(PALETTE_DIRTY_FLAGS) | 0x02);
}

// 07:55E9 GetShotAimOffsetForSide: the serve's lateral target: a 4-entry table per service box (or the
// wall minigame's), indexed by aim offset + 1, minus the server's X / 16 -> de
export function getShotAimOffsetForSide(E) {
  const C = E.C;
  const table = E.mem.u8(MINIGAME_USES_WALL) ? 0x563E : indexed(0x562E, (C.courtPos & 1) << 3);
  const de = rd16(E, 7, indexed(table, (C.aimOffset + 1) << 1));
  return U16(SRA16(NEG16(C.posXInt), 4) + de);
}

// 07:5646 ComputeShotTargetX: the lateral aim point -> de. The serve uses the service-box table; a rally
// shot goes full / half to either side or straight, by (wCharAimOffset + 2) & 7.
export function computeShotTargetX(E) {
  const S = E.S;
  if (S.rallyLength === 0) return getShotAimOffsetForSide(E);
  let de = computeAimBaseOffset(E);
  const way = (E.C.aimOffset + 2) & 7;
  if (way === 1) de = SRA16(de, 1);                                      // .halveShort
  if (way === 0 || way === 1) {                                          // .fromBallX: to the hitter's left
    de = clampShotTargetX(E, U16(NEG16(S.ballX) + de));
    return NEG16(de);
  }
  if (way === 3) de = SRA16(de, 1);                                      // .halveLong
  if (way === 3 || way === 4) return clampShotTargetX(E, U16(S.ballX + de));   // .fromBallXLong
  // .straight: a quarter of the ball's X, jittered both ways (only the jitter's high byte)
  de = SRA16(S.ballX, 2);
  de = U16(de - (getRandomAimJitter(E) >> 8));
  return U16(de + (getRandomAimJitter(E) >> 8));
}

// 07:56B7 ComputeAimBaseOffset: (wAimSpreadBase + |charDepth| / 8) * wCharAimOffsetScale / 256 -> de
export function computeAimBaseOffset(E) {
  const hl = U16(SRA16(ABS16(E.C.posDepthInt), 3) + E.S.aimSpreadBase);
  return E.M.mulHLByAFrac(hl, E.C.aimOffsetScale).hl;
}

// 07:56E3 ClampShotTargetX: de capped at -(wCourtLimitX + $20) (the upper side only), then minus a jitter
export function clampShotTargetX(E, de) {
  const bc = NEG16(U16(E.S.courtLimitX) + 0x20);
  if (!neg(U16(de - bc))) de = bc;
  return U16(de - (getRandomAimJitter(E) >> 8));
}

// 07:570D GetRandomAimJitter: rng * wCharAimJitterScale * 16 -> hl (callers use the high byte)
export function getRandomAimJitter(E) {
  const r = advanceMatchRng(E);
  return U16(E.M.mulHLByA(r, E.C.aimJitterScale) << 4);
}

// =====================================================================================================
// Where the ball is aimed (execute_07)
// =====================================================================================================

// 07:571E ComputeShotTrajectory: bc = the target depth past the net. Sets the aim point and angle, the
// legal distance window [wShotDistMin, wShotDistMax] along the aim line and its rows (distance / 64),
// shortened where the line leaves the court sideways; copies the aim point to wBallTarget*.
export function computeShotTrajectory(E, bc) {
  const S = E.S, M = E.M, C = E.C;
  if (!(C.courtPos & 2)) bc = NEG16(bc);                                 // toward the far side
  S.shotAimTargetDepth = bc;
  S.shotAimDeltaDepth = U16(bc - S.ballDepth);
  const tx = computeShotTargetX(E);
  S.shotAimTargetX = tx;
  S.shotAimDeltaX = U16(tx - S.ballX);
  const angle = M.angleFromVector16(U16(S.shotAimDeltaDepth), U16(S.shotAimDeltaX));
  S.shotAimAngle = angle;
  // shallowest ($140 past the net) and deepest ($480) landing depths, as lengths along the aim line
  let hl = ABS16(M.divBySin(U16(ABS16(S.ballDepth) + 0x0140), angle));
  S.shotTrajRowMin = (hl << 2) >> 8 & 0xFF; S.shotDistMin = hl;
  hl = ABS16(M.divBySin(U16(ABS16(S.ballDepth) + 0x0480), angle));
  S.shotTrajRowMax = (hl << 2) >> 8 & 0xFF; S.shotDistMax = hl;
  const dmax = hl;
  // sideways run of the deepest landing; past the sideline (wCourtLimitX + $20) it is scaled back
  const side = ABS16(M.mulSinCos(dmax, angle).hl);
  if (side >= 0x20) {
    let lim = U16(S.courtLimitX + 0x20);
    if (((angle >> 8) + 0x40) & 0x80) lim = NEG16(lim);
    const room = ABS16(U16(S.ballX + lim));
    if (neg(U16(room - side))) {
      const q = M.divAHLByDESigned(dmax >> 8, (dmax & 0xFF) << 8, side);   // distMax * 256 / side
      const hi = M.mulHLByDE(q.hl, room);
      const d = ((hi & 0xFF) << 8 | E.mem.u8(0xFFA9)) & 0xFFFF;           // ld h, l / ld l, [hMulResult + 1]
      S.shotTrajRowMax = (d << 2) >> 8 & 0xFF; S.shotDistMax = d;
    }
  }
  S.shotSolverNegHeight = NEG16(S.ballHeight);
  S.ballTargetX = S.shotAimTargetX; S.ballTargetDepth = S.shotAimTargetDepth;
}

// 07:5876 NormalizeBallHeightForShot: a contact point lower than $60 is raised halfway toward -$60
export function normalizeBallHeightForShot(E) {
  const S = E.S, de = U16(S.ballHeight), hl = U16(de + 0x60);
  if (neg(hl)) return;
  S.ballHeight = de - SRA16(hl, 1);
}
// 07:5899 RaiseBallHeightForLob: the contact point goes to -$60, or 32 lower if already above $80
export function raiseBallHeightForLob(E) {
  const S = E.S, de = U16(S.ballHeight);
  S.ballHeight = neg(U16(de + 0x80)) ? de + 0x20 : 0xFFA0;
}

// 07:5A01 SetSpecialShotFlagFromBallHeight: SpecialShotFlagTable_07 (07:5A23) by 16-unit height band;
// a serve struck high enough is a power serve
export function setSpecialShotFlagFromBallHeight(E) {
  const band = (U16(NEG16(E.S.ballHeight) << 4) >> 8) & 0x1F;
  const a = rd8(E, 7, 0x5A23 + band);
  E.S.specialShotFlag = a; E.S.lastShotWasPowerShot = a;
}

// ---- the 15 ExecuteShot<Type> handlers (07:58BE-59EB) ----
// 07:58BE
export function executeShotTopspin(E) {
  E.S.currentShotType = SHOTTYPE.TOPSPIN;
  normalizeBallHeightForShot(E);
  computeShotTrajectory(E, weakenShotByCharge(E, applyShotTypePresets(E)));
  shotBallPathStroke(E, 0x22);                                           // ShotBallPathTopspin
}
// 07:58D3 (diving: the base stroke)
export function executeShotPowerTopspin(E) {
  if (E.C.flags & CHARB_DIVING) return executeShotTopspin(E);
  E.S.lastShotWasPowerShot = 1;
  normalizeBallHeightForShot(E);
  computeShotTrajectory(E, applyShotTypePresets(E));
  shotBallPathStroke(E, 0x23);                                           // ShotBallPathPowerTopspin
}
// 07:58EC
export function executeShotSlice(E) {
  E.S.currentShotType = SHOTTYPE.SLICE;
  normalizeBallHeightForShot(E);
  computeShotTrajectory(E, weakenShotByCharge(E, applyShotTypePresets(E)));
  shotBallPathStroke(E, 0x20);                                           // ShotBallPathSlice
}
// 07:5901
export function executeShotPowerSlice(E) {
  if (E.C.flags & CHARB_DIVING) return executeShotSlice(E);
  E.S.lastShotWasPowerShot = 1;
  normalizeBallHeightForShot(E);
  computeShotTrajectory(E, applyShotTypePresets(E));
  shotBallPathStroke(E, 0x21);                                           // ShotBallPathPowerSlice
}
// 07:591A
export function executeShotLob(E) {
  raiseBallHeightForLob(E);
  const bc = nudgeShotByPlayerMomentum(E, boostShotByCharge(E, applyShotTypePresets(E)));
  computeShotTrajectory(E, bc);
  shotBallPathLob(E);
}
// 07:592D
export function executeShotDrop(E) {
  raiseBallHeightForLob(E);
  computeShotTrajectory(E, weakenShotByCharge(E, applyShotTypePresets(E)));
  shotBallPathDrop(E);
}
// 07:593D / 07:5952 / 07:5967: the stretch shots near the net; outside the smash cone they fall back to
// the plain reach shot
function executeShotReachVariant(E, path) {
  if (checkBallInSmashRange(E).z) return executeShotReach(E);
  normalizeBallHeightForShot(E);
  computeShotTrajectory(E, weakenShotByCharge(E, applyShotTypePresets(E)));
  projectShotPlacement(E, path);
}
export const executeShotReachBasic = E => executeShotReachVariant(E, 0);         // 07:593D
export const executeShotReachPowerTopspin = E => executeShotReachVariant(E, 1);  // 07:5952
export const executeShotReachPowerSlice = E => executeShotReachVariant(E, 2);    // 07:5967
// 07:597C
export function executeShotReach(E) {
  E.S.currentShotType = SHOTTYPE.REACH;
  normalizeBallHeightForShot(E);
  computeShotTrajectory(E, weakenShotByCharge(E, applyShotTypePresets(E)));
  shotBallPathReach(E);
}
// 07:5991
export function executeShotSmash(E) {
  E.S.currentShotType = SHOTTYPE.SMASH;
  E.S.lastShotWasPowerShot = 1;
  normalizeBallHeightForShot(E);
  computeShotTrajectory(E, applyShotTypePresets(E));
  shotBallPathSmash(E);
}
// 07:59A8: in the smash cone with an overhead or smash swing it becomes a smash
export function executeShotNeutral(E) {
  if (!checkBallInSmashRange(E).z && (E.C.swingAnim === CHARANIM_OVERHEAD || E.C.swingAnim === CHARANIM_SMASH)) return executeShotSmash(E);
  normalizeBallHeightForShot(E);
  computeShotTrajectory(E, applyShotTypePresets(E));
  shotBallPathNeutral(E);
}
// 07:59C5 / 07:59D2 / 07:59DF
function executeShotServe(E, bank) {
  computeShotTrajectory(E, applyShotTypePresets(E));
  shotBallPathServe(E, bank);
  setSpecialShotFlagFromBallHeight(E);
}
export const executeShotServeTopspin = E => executeShotServe(E, 0x29);
export const executeShotServeSlice = E => executeShotServe(E, 0x2A);
export const executeShotServeFlat = E => executeShotServe(E, 0x2B);

const EXECUTE_SHOT_HANDLERS = [
  executeShotTopspin, executeShotPowerTopspin, executeShotSlice, executeShotPowerSlice, executeShotNeutral,
  executeShotReach, executeShotReachPowerTopspin, executeShotReachPowerSlice, executeShotReachBasic,
  executeShotSmash, executeShotLob, executeShotDrop, executeShotServeTopspin, executeShotServeSlice, executeShotServeFlat,
];

// =====================================================================================================
// The speed budget (placement_07)
// =====================================================================================================

// 07:5161 ComputeShotPlacement: per shot type, the spin pair and the requested speed -> bc.
// [placement data (8-byte rows), spin row index, speed row index, pace term, charge term, finalize]
const PLACEMENT = [
  [0x4D31, "topspinPlacementIndex", "groundStrokeSpeedIndex", addBallSpeedQuarter, addChargeSpeedBonus, true],      // 07:5183 Topspin
  [0x4D81, "topspinPlacementIndex", "groundStrokeSpeedIndex", addBallSpeedQuarter, addChargeSpeedBonus, true],      // 07:519B PowerTopspin
  [0x4DD1, "slicePlacementIndex", "groundStrokeSpeedIndex", addBallSpeedEighth, addChargeSpeedBonusHalf, true],     // 07:51B3 Slice
  [0x4E21, "slicePlacementIndex", "groundStrokeSpeedIndex", addBallSpeedEighth, addChargeSpeedBonusHalf, true],     // 07:51CB PowerSlice
  [0x4E71, null, "groundStrokeSpeedIndex", addBallSpeedQuarter, addChargeSpeedBonus, true],                          // 07:51E3 Neutral
  [0x5001, null, "reachSpeedIndex", addBallSpeed3Sixteenths, null, true],                                           // 07:5248 Reach
  [0x4F61, null, "reachSpeedIndex", addBallSpeedQuarter, null, true],                                               // 07:5222 ReachPowerTopspin
  [0x4FB1, null, "reachSpeedIndex", addBallSpeedEighth, null, true],                                                // 07:5235 ReachPowerSlice
  [0x4F11, null, "reachSpeedIndex", addBallSpeed3Sixteenths, null, true],                                           // 07:520F ReachBasic
  [0x4EC1, null, "smashServeSpeedIndex", addBallSpeed3Sixteenths, addChargeSpeedBonus, true],                        // 07:51F9 Smash
  [0x5051, "lobPlacementIndex", null, null, null, false],                                                           // 07:525B Lob
  [0x5061, "dropPlacementIndex", null, null, null, false],                                                          // 07:5268 Drop
  [0x5071, "topspinPlacementIndex", "smashServeSpeedIndex", null, null, false],                                     // 07:5275 ServeTopspin
  [0x50C1, "slicePlacementIndex", "smashServeSpeedIndex", null, null, false],                                       // 07:5284 ServeSlice
  [0x5111, null, "smashServeSpeedIndex", null, null, false],                                                        // 07:5293 ServeFlat
];
export function computeShotPlacement(E) {
  if (!PLACEMENT[E.S.currentShotType]) throw new Error(`ComputeShotPlacement: shot type $${E.S.currentShotType.toString(16)} past the jump table`);
  return shotPlacement(E, E.S.currentShotType);
}
// the jump table's routine for shot type t (07:5183 ShotPlacementTopspin ... 07:5293 ShotPlacementServeFlat)
export function shotPlacement(E, t) {
  const [data, spinIdx, speedIdx, pace, charge, finalize] = PLACEMENT[t], C = E.C;
  let bc = loadShotPlacementEntry(E, data, spinIdx ? C[spinIdx] : 0, speedIdx ? C[speedIdx] : 0);
  if (pace) bc = pace(E, bc);
  if (charge) bc = charge(E, bc);
  if (finalize) bc = finalizeShotSpeed(E, bc);
  return bc;
}

// 07:52A0 LoadShotPlacementEntry: row d -> wBallTopspin / wBallSideSpin (negated under wShotAimMirror),
// row e -> the requested speed at +4 (bc). 8-byte rows, both indexes unchecked.
export function loadShotPlacementEntry(E, table, d, e) {
  const S = E.S;
  const p = indexed(table, d << 3);
  S.ballTopspin = rd16(E, 7, p);
  let side = rd16(E, 7, p + 2);
  if (S.shotAimMirror) side = NEG16(side);
  S.ballSideSpin = side;
  return rd16(E, 7, indexed(table, (e << 3) + 4));
}

// 07:52D7 FinalizeShotSpeed: + the hitter's momentum, - $0C00 while diving, floor $0100 -> wShotSpeedFinal
export function finalizeShotSpeed(E, bc) {
  bc = addPlayerMomentumToShot(E, bc);
  bc = applyCharFlagShotSpeedPenalty(E, bc);
  if (neg(U16(bc + 0xFF00))) bc = 0x0100;
  E.S.shotSpeedFinal = bc;
  return bc;
}
// 07:53A2 ApplyCharFlagShotSpeedPenalty
export function applyCharFlagShotSpeedPenalty(E, bc) { return E.C.flags & CHARB_DIVING ? U16(bc + 0xF400) : bc; }

// 07:52F1 / 07:5301 / 07:531D the incoming-pace term: a fraction of wBallVelocityDepth, forced negative
// (07:532F), stored in wShotSpeedBallTerm and added to bc
function addBallSpeedTerm(E, bc, hl) {
  if (!neg(hl)) hl = NEG16(hl);
  E.S.shotSpeedBallTerm = hl;
  return U16(hl + bc);
}
export function addBallSpeedQuarter(E, bc) { return addBallSpeedTerm(E, bc, SRA16(E.S.ballVelocityDepth, 2)); }
export function addBallSpeed3Sixteenths(E, bc) { const s = SRA16(E.S.ballVelocityDepth, 4); return addBallSpeedTerm(E, bc, U16(s * 3)); }
export function addBallSpeedEighth(E, bc) { return addBallSpeedTerm(E, bc, SRA16(E.S.ballVelocityDepth, 3)); }

// 07:5345 / 07:535C the charge term: (charge - $20) * $80 ($40 below $20); the half version * $40 / $20
function addChargeTerm(E, bc, full) {
  const hl = U16(E.S.shotChargeLevel - 0x20);
  const hlv = E.M.mulHLByASignedFull(hl, neg(hl) ? full >> 1 : full);
  E.S.shotSpeedChargeTerm = hlv;
  return U16(hlv + bc);
}
export function addChargeSpeedBonus(E, bc) { return addChargeTerm(E, bc, 0x80); }
export function addChargeSpeedBonusHalf(E, bc) { return addChargeTerm(E, bc, 0x40); }

// 07:537F AddPlayerMomentumToShot: wCharVelDepth / 2 toward the far side -> wShotSpeedMomentumTerm
export function addPlayerMomentumToShot(E, bc) {
  let hl = SRA16(E.C.velDepth, 1);
  if (!(E.C.courtPos & 2)) hl = NEG16(hl);
  E.S.shotSpeedMomentumTerm = hl;
  return U16(hl + bc);
}

// =====================================================================================================
// The ball-path banks: the shared prologue (one copy per bank, src/twins) and the ShotBallPath handlers
// =====================================================================================================

// LookupBallPosByHeight_<bank> ($20-$23 $29-$2B: $424C, $24: $4258, $2C: $4250): data + offsets[32 height
// bands of 16 units of -wBallHeight]
export function lookupBallPosByHeight(E, bank, data, offsets) {
  const band = (U16(NEG16(E.S.ballHeight) << 4) >> 8) & 0x1F;
  return U16(rd16(E, bank, indexed(offsets, band << 1)) + data);
}
// LookupBallPosByShotIndex_<bank> ($426E, $24: $427A): data + offsets[a] (unchecked)
export function lookupBallPosByShotIndex(E, bank, data, offsets, a) {
  return U16(rd16(E, bank, indexed(offsets, a << 1)) + data);
}
// 24:422D LookupBallPosByAim_24: data + offsets[the ball's distance from the court origin along the aim
// line / 128, 5 bits]; the band is kept in wShotAimRow
export function lookupBallPosByAim(E, bank, data, offsets) {
  const S = E.S, len = E.M.vectorLengthFromAngle(U16(S.ballX), U16(S.ballDepth), S.shotAimAngle);
  const a = (U16(len << 1) >> 8) & 0x1F;
  E.mem.w8(SHOT_AIM_ROW, a);
  return U16(rd16(E, bank, indexed(offsets, a << 1)) + data);
}
// BallTrajEntryPtr6_<bank> / BallTrajEntryPtr4_<bank>: block + (distance >> 6) * row size
export const ballTrajEntryPtr = (block, dist, size) => U16(block + ((dist << 2) >> 8 & 0xFF) * size);

// SeekBallTrajEntry6/4_<bank>: from row wShotTrajRowMin, step until the row's speed covers the request
// (bc = -request) or row wShotTrajRowMax is reached -> { ptr, row }
export function seekBallTrajEntry(E, bank, ptr, bc, size) {
  let d = E.S.shotTrajRowMin; const e = E.S.shotTrajRowMax;
  for (;;) {
    if (rd16(E, bank, ptr) + bc > 0xFFFF) break;
    if (d >= e) break;
    d++; ptr = U16(ptr + size);
  }
  return { ptr, row: d };
}
// SetBallVelocityFromEntry6_<bank>: [speed, elevation, aim delta (negated under wShotAimMirror)]
export function setBallVelocityFromEntry6(E, bank, ptr) {
  let delta = rd16(E, bank, ptr + 4);
  if (E.S.shotAimMirror) delta = NEG16(delta);
  setBallVelocityPolar(E, rd16(E, bank, ptr), rd16(E, bank, ptr + 2), U16(E.S.shotAimAngle + delta));
}
// SetBallVelocityFromEntry4_<bank>: [speed, elevation] along the aim angle
export function setBallVelocityFromEntry4(E, bank, ptr) {
  setBallVelocityPolar(E, rd16(E, bank, ptr), rd16(E, bank, ptr + 2), E.S.shotAimAngle);
}
// SetBallTargetFromAim_<bank>: the landing prediction hl along the aim line from the ball
export function setBallTargetFromAim(E, hl) {
  const S = E.S, v = E.M.mulSinCos(hl, S.shotAimAngle);
  S.ballTargetX = U16(S.ballX + v.hl);
  S.ballTargetDepth = U16(S.ballDepth + v.de);
}
// the row's distance as the ROM forms it: (row << 8) sra 2
const rowDistance = row => SRA16(row << 8, 2);

// ApplyBallTrajectory6/4_<bank> (uncapped; used in $2C) and ApplyBallTrajectory6/4Capped_<bank>: the capped
// form gives up on the table when even the shortest legal row is beyond the budget (the fallback, $24)
export function applyBallTrajectory(E, bank, block, request, size, capped) {
  const bc = NEG16(request);
  let ptr = ballTrajEntryPtr(block, E.S.shotDistMin, size);
  if (capped) {
    const t = rd16(E, bank, ptr) + bc;
    if (t > 0xFFFF) return applyFallbackBallTrajectory(E, (t >> 8) & 0xFF);
  }
  const r = seekBallTrajEntry(E, bank, ptr, bc, size);
  if (size === 6) setBallVelocityFromEntry6(E, bank, r.ptr); else setBallVelocityFromEntry4(E, bank, r.ptr);
  setBallTargetFromAim(E, rowDistance(r.row));
}

// 24:4169 ApplyBallTrajectoryCapped_24: no search: the row at the aim distance, capped at wShotDistMax
export function applyBallTrajectoryCapped24(E, ptr) {
  const S = E.S;
  let de = E.M.vectorLengthFromAngle(U16(S.shotAimDeltaX), U16(S.shotAimDeltaDepth), S.shotAimAngle);
  if (U16(S.shotDistMax) < de) de = U16(S.shotDistMax);
  setBallVelocityFromEntry6(E, 0x24, ballTrajEntryPtr(ptr, de, 6));
  setBallTargetFromAim(E, de);
}

// 24:57FD ApplyFallbackBallTrajectory_24: d = high byte of (shortest row's speed - request). No spin, no
// trail, one of three short target depths (the aim is solved again, so the RNG advances again) and a row
// of BallPosDataFallback_24 (24:51FD) by BallPosFallbackOffsets_24 (24:583C)
export function applyFallbackBallTrajectory(E, d) {
  const S = E.S;
  S.fallbackTrajectoryFlag = 1;
  S.ballTrailColor = 0;
  S.ballTopspin = 0; S.ballSideSpin = 0;
  let a = d >> 1, bc = 0x0280;
  if (a === 4) { a = 3; bc = 0x0140; } else if (a > 4) { a = 0; bc = 0x00E0; }
  computeShotTrajectory(E, bc);
  const off = rd16(E, 0x24, indexed(0x583C, a << 1));
  applyBallTrajectoryCapped24(E, U16(0x51FD + off));
}

// SetBallTargetByPrediction_<bank> ($29-$2B: $4098): a serve row [base speed, elevation, aim delta]; the
// speed grows with |wShotAimDeltaX|, the landing depth is the service line and X is predicted along the aim
export function setBallTargetByPrediction(E, bank, ptr) {
  const S = E.S, base = rd16(E, bank, ptr);
  S.shotPredictionEntry = base;
  let hl = U16(ABS16(S.shotAimDeltaX) << 1);
  hl = U16((E.M.mulHLByAFrac(hl, base >> 8).hl << 2) + base);
  let delta = rd16(E, bank, ptr + 4);
  if (S.shotAimMirror) delta = NEG16(delta);
  setBallVelocityPolar(E, hl, rd16(E, bank, ptr + 2), U16(S.shotAimAngle + delta));
  const depth = E.C.courtPos & 2 ? 0x02C0 : 0xFD40;
  S.ballTargetDepth = depth;
  S.ballTargetX = predictBallXAtDepth(E, depth);
}

// ---- the ShotBallPath handlers ----
// $20:7E7D ShotBallPathSlice, $21:7E7D ShotBallPathPowerSlice, $22:7E7D ShotBallPathTopspin,
// $23:7E7D ShotBallPathPowerTopspin: BallPosData_<bank> ($427D) [placement][height band][row], 6-byte rows
export function shotBallPathStroke(E, bank) {
  const bc = computeShotPlacement(E);
  let hl = lookupBallPosByHeight(E, bank, 0x427D, 0x7E98);
  const idx = bank === 0x20 || bank === 0x21 ? E.C.slicePlacementIndex : E.C.topspinPlacementIndex;
  hl = lookupBallPosByShotIndex(E, bank, hl, 0x7ED8, idx);
  applyBallTrajectory(E, bank, hl, bc, 6, true);                         // ApplyBallTrajectory6Capped_<bank>
}
// 24:4589 ShotBallPathLob
export function shotBallPathLob(E) {
  computeShotPlacement(E);
  applyBallTrajectoryCapped24(E, lookupBallPosByShotIndex(E, 0x24, 0x4289, 0x459C, E.C.lobPlacementIndex));
}
// 24:51A0 ShotBallPathDrop
export function shotBallPathDrop(E) {
  computeShotPlacement(E);
  const hl = lookupBallPosByAim(E, 0x24, 0x45A0, 0x51B9);
  applyBallTrajectoryCapped24(E, lookupBallPosByShotIndex(E, 0x24, hl, 0x51F9, E.C.dropPlacementIndex));
}
// 24:6644 ShotBallPathNeutral (4-byte rows)
export function shotBallPathNeutral(E) {
  const bc = computeShotPlacement(E);
  applyBallTrajectory(E, 0x24, lookupBallPosByHeight(E, 0x24, 0x5844, 0x6656), bc, 4, true);
}
// 24:7707 ShotBallPathReach (4-byte rows)
export function shotBallPathReach(E) {
  const bc = computeShotPlacement(E);
  applyBallTrajectory(E, 0x24, lookupBallPosByHeight(E, 0x24, 0x6707, 0x7719), bc, 4, true);
}
// 24:6696 ShotBallPathSmash: no table: the requested speed, aimed down at the far end of the window
// (elevation = angle to the landing point + SmashElevationBySpeed_24 24:66F2 by wSmashServeSpeedIndex)
export function shotBallPathSmash(E) {
  const S = E.S, speed = computeShotPlacement(E);
  const run = U16(ABS16(S.ballDepth) + S.shotDistMax);
  const h = NEG16(S.ballHeight), drop = U16(h + SRA16(h, 1));
  const angle = E.M.angleFromVector16(drop, run);
  const elevation = U16(rd16(E, 0x24, indexed(0x66F2, E.C.smashServeSpeedIndex << 1)) + angle);
  setBallVelocityPolar(E, speed, elevation, S.shotAimAngle);
  setBallTargetFromAim(E, U16(S.shotDistMax + 0xFF00));
}
// $2C:7281 / 72D3 / 7325 ProjectShotPlacement0-2: the stretch shots near the net (uncapped)
const PROJECT = [[0x4281, 0x7293, 4], [0x4E81, 0x72E5, 6], [0x6081, 0x7337, 6]];
export function projectShotPlacement(E, n) {
  const [data, offsets, size] = PROJECT[n], bc = computeShotPlacement(E);
  applyBallTrajectory(E, 0x2C, lookupBallPosByHeight(E, 0x2C, data, offsets), bc, size, false);
}
// $29/$2A/$2B:5E9D ShotBallPathServeTopspin / ServeSlice / ServeFlat: BallPosData_<bank> ($427D)
// [placement][speed index][height band], then SetBallTargetByPrediction
export function shotBallPathServe(E, bank) {
  computeShotPlacement(E);
  const C = E.C, flat = bank === 0x2B, t = flat ? 0x5EBD : 0x5EBF;
  const placement = bank === 0x29 ? C.topspinPlacementIndex : bank === 0x2A ? C.slicePlacementIndex : 0;
  let hl = lookupBallPosByShotIndex(E, bank, 0x427D, t, placement);
  hl = lookupBallPosByShotIndex(E, bank, hl, t + 0x14, C.smashServeSpeedIndex);
  hl = lookupBallPosByHeight(E, bank, hl, t + 0x28);
  setBallTargetByPrediction(E, bank, hl);
}
