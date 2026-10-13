// The match engine's memory: a mirror of the Game Boy RAM the ROM's match code works on — WRAM0
// ($C000-$CFFF), the switchable WRAM bank ($D000-$DFFF; banks 4-7 hold one on-court character each) and
// HRAM ($FF80-$FFFE) — with named, typed fields. The engine keeps the ROM's exact data layout so every
// fixed-point quirk (24-bit velocities aligned with 32-bit positions, frac bytes, wrap-around) behaves the
// same, and so a state can be copied in from, or compared with, the running game byte for byte.
//
// Field names follow the gerbiljames/mario-tennis-gbc-disasm symbols (MIT, see README "Credits") without
// their w/h prefix: wBallX -> ballX. Where the ROM reads a 32-bit 16.16 position or a 24-bit velocity as a
// whole, the field has a "Full" twin: ballX is the integer word at $C402, ballXFull the 16.16 value at $C400.

const S8 = v => (v << 24) >> 24, S16 = v => (v << 16) >> 16, S24 = v => (v << 8) >> 8;

export class MatchMemory {
  constructor() {
    this.w0 = new Uint8Array(0x1000);                                    // $C000-$CFFF
    this.wx = Array.from({ length: 8 }, () => new Uint8Array(0x1000));  // $D000-$DFFF per bank (0 aliases 1)
    this.hram = new Uint8Array(0x80);                                    // $FF80-$FFFF
    this.bank = 4;                                                       // hWramBank: the current character
  }
  // ---- raw access at a Game Boy address (the switchable bank is this.bank) ----
  u8(a) {
    if (a >= 0xC000 && a < 0xD000) return this.w0[a - 0xC000];
    if (a >= 0xD000 && a < 0xE000) return this.wx[this.bank || 1][a - 0xD000];
    if (a >= 0xFF80) return this.hram[a - 0xFF80];
    throw new Error(`engine memory: read outside RAM at $${a.toString(16)}`);
  }
  w8(a, v) {
    v &= 0xFF;
    if (a >= 0xC000 && a < 0xD000) this.w0[a - 0xC000] = v;
    else if (a >= 0xD000 && a < 0xE000) this.wx[this.bank || 1][a - 0xD000] = v;
    else if (a >= 0xFF80) this.hram[a - 0xFF80] = v;
    else throw new Error(`engine memory: write outside RAM at $${a.toString(16)}`);
  }
  s8(a) { return S8(this.u8(a)); }
  u16(a) { return this.u8(a) | this.u8(a + 1) << 8; }
  s16(a) { return S16(this.u16(a)); }
  w16(a, v) { this.w8(a, v); this.w8(a + 1, v >> 8); }
  u24(a) { return this.u8(a) | this.u8(a + 1) << 8 | this.u8(a + 2) << 16; }
  s24(a) { return S24(this.u24(a)); }
  w24(a, v) { this.w8(a, v); this.w8(a + 1, v >> 8); this.w8(a + 2, v >> 16); }
  s32(a) { return this.u24(a) | this.u8(a + 3) << 24; }
  w32(a, v) { this.w24(a, v); this.w8(a + 3, v >> 24); }
  // ---- whole-state transfer with the emulator core (web/js/gb) ----
  loadFromCore(gb) {
    const m = gb.mem; this.w0.set(m.wram[0]); for (let b = 1; b < 8; b++) this.wx[b].set(m.wram[b]); this.hram.set(m.hram);
    this.bank = m.hram[0x16] & 7 || 1;                                   // hWramBank $FF96
  }
  // character k (0-3) lives in WRAM bank 4 + k: run fn with that bank mapped, like ForEachCharBank
  withBank(bank, fn) { const old = this.bank; this.bank = bank; try { return fn(); } finally { this.bank = old; } }
}

// ---- field tables: [name, address, type] ----
// WRAM0 match globals ($C400-$C4FF, the ball block is cleared by ResetMatchState), score and setup ($C8xx)
export const GLOBALS = [
  ["ballXFull", 0xC400, "s32"], ["ballX", 0xC402, "s16"],
  ["ballDepthFull", 0xC404, "s32"], ["ballDepth", 0xC406, "s16"],
  ["ballHeightFull", 0xC408, "s32"], ["ballHeight", 0xC40A, "s16"],
  ["ballPitchAngle", 0xC40C, "u16"], ["ballHeadingAngle", 0xC40E, "u16"],
  ["ballPrevXFull", 0xC410, "s32"], ["ballPrevX", 0xC412, "s16"],
  ["ballPrevDepthFull", 0xC414, "s32"], ["ballPrevDepth", 0xC416, "s16"],
  ["ballPrevHeightFull", 0xC418, "s32"], ["ballPrevHeight", 0xC41A, "s16"],
  ["ballTopspin", 0xC41C, "s16"], ["ballSideSpin", 0xC41E, "s16"],
  ["ballVelocityXFull", 0xC420, "s24"], ["ballVelocityX", 0xC421, "s16"],
  ["ballVelocityDepthFull", 0xC423, "s24"], ["ballVelocityDepth", 0xC424, "s16"],
  ["ballVelocityHeightFull", 0xC426, "s24"], ["ballVelocityHeight", 0xC427, "s16"],
  ["ballSpeedHorizontalFull", 0xC429, "u24"], ["ballSpeedHorizontal", 0xC42A, "u16"], ["ballSpeed3D", 0xC42C, "u16"],
  ["shotAimTargetX", 0xC430, "s16"], ["shotAimTargetDepth", 0xC432, "s16"],
  ["shotAimDeltaX", 0xC434, "s16"], ["shotAimDeltaDepth", 0xC436, "s16"], ["shotAimAngle", 0xC43A, "u16"],
  ["aimSpreadBase", 0xC43E, "u16"],
  ["matchCameraX", 0xC440, "s16"], ["matchCameraY", 0xC442, "s16"], ["matchCameraTargetX", 0xC444, "s16"], ["matchCameraTargetY", 0xC446, "s16"],
  ["ballRelCharX", 0xC448, "s16"], ["ballRelCharDepth", 0xC44A, "s16"], ["ballRelCharHeight", 0xC44C, "s16"],
  ["ballTargetX", 0xC450, "s16"], ["ballTargetDepth", 0xC452, "s16"],
  ["shotRecoilVelocityX", 0xC454, "s16"], ["shotRecoilVelocityDepth", 0xC456, "s16"],
  ["shotSpeedFinal", 0xC458, "s16"], ["shotSpeedBallTerm", 0xC45A, "s16"], ["shotSpeedMomentumTerm", 0xC45C, "s16"], ["shotSpeedChargeTerm", 0xC45E, "s16"],
  ["bounceEffectX", 0xC460, "s16"], ["bounceEffectY", 0xC462, "s16"], ["hitEffectX", 0xC464, "s16"], ["hitEffectY", 0xC466, "s16"],
  ["ballGroundProjX", 0xC46C, "s16"], ["ballGroundProjY", 0xC46E, "s16"],
  ["shotSolverNegHeight", 0xC470, "s16"], ["shotAimRow", 0xC472, "u16"], ["ballVelocityPolarLength", 0xC474, "u16"], ["shotPredictionEntry", 0xC476, "u16"],
  ["cameraOffsetX", 0xC478, "s16"], ["cameraOffsetY", 0xC47A, "s16"],
  ["minigamesCurrentScore", 0xC47C, "u16"], ["minigamesTargetScore", 0xC47E, "u16"],
  ["landingMarkerX", 0xC480, "s16"], ["landingMarkerY", 0xC482, "s16"],
  ["courtLimitX", 0xC484, "s16"], ["courtLimitDepth", 0xC486, "s16"], ["netHeight", 0xC488, "s16"],
  ["shotDistMin", 0xC48A, "u16"], ["shotDistMax", 0xC48C, "u16"], ["shotTrajRowMin", 0xC48E, "u8"], ["shotTrajRowMax", 0xC48F, "u8"],
  ["lastShotButtons", 0xC490, "u8"], ["pointWinnerShotType", 0xC491, "u8"], ["matchFramesAbort", 0xC492, "u8"], ["matchEndLinkState", 0xC493, "u8"],
  ["currentShotType", 0xC4A0, "u8"], ["shotRecoilVariant", 0xC4A1, "u8"], ["shotChargeLevel", 0xC4A2, "u8"], ["shotWasQuickSwing", 0xC4A3, "u8"],
  ["lastShotAimOffset", 0xC4A4, "s8"], ["specialShotFlag", 0xC4A5, "u8"], ["lastShotWasPowerShot", 0xC4A6, "u8"], ["shotAimMirror", 0xC4A7, "u8"],
  ["bounceEffectTimer", 0xC4A8, "u8"], ["hitSparkTimer", 0xC4A9, "u8"], ["specialHitTimer", 0xC4AA, "u8"], ["ballTouchCharTimer", 0xC4AB, "u8"],
  ["courtSurfaceFriction", 0xC4AC, "u8"], ["courtSurfaceBounce", 0xC4AD, "u8"],
  ["ballTouchCharFlag", 0xC4AE, "u8"], ["ballTouchCharIndex", 0xC4AF, "u8"],
  ["ballCourtQuadrant", 0xC4B0, "u8"], ["ballOutOfBoundsBits", 0xC4B1, "u8"], ["ballBounceCount", 0xC4B2, "u8"], ["ballBounceEvent", 0xC4B3, "u8"],
  ["ballCrossedNetFlag", 0xC4B4, "u8"], ["rallyNetFrames", 0xC4B5, "u8"], ["rallyLength", 0xC4B6, "u8"], ["ballHitEvent", 0xC4B7, "u8"],
  ["lastShotCharIndex", 0xC4B8, "u8"], ["lastShotServeRole", 0xC4B9, "u8"],
  ["ballSpriteEnabled", 0xC4BA, "u8"], ["ballShadowEnabled", 0xC4BB, "u8"], ["ballTrailEnabled", 0xC4BC, "u8"], ["ballTrailColor", 0xC4BD, "u8"],
  ["ballQuadrantAtHit", 0xC4BE, "u8"], ["ballHasBouncedFlag", 0xC4BF, "u8"],
  ["matchSimFrozen", 0xC4C0, "u8"], ["matchDrawFrozen", 0xC4C1, "u8"], ["pauseDisabled", 0xC4C2, "u8"], ["matchAbortFlag", 0xC4C3, "u8"],
  ["offscreenArrowsEnabled", 0xC4C4, "u8"], ["unusedMinigamePointFlag", 0xC4C5, "u8"], ["fallbackTrajectoryFlag", 0xC4C6, "u8"], ["matchExitRequest", 0xC4C7, "u8"],
  ["courtViewLocked", 0xC4C8, "u8"], ["cameraFollowBall", 0xC4C9, "u8"], ["standingShadowsEnabled", 0xC4CA, "u8"], ["courtViewFlipped", 0xC4CB, "u8"],
  ["changeoverSkipBanner", 0xC4CC, "u8"], ["changeEndsPending", 0xC4CD, "u8"], ["courtViewFlipChanged", 0xC4CE, "u8"], ["onCourtCharCountMinus1", 0xC4CF, "u8"],
  ["serviceAceFlag", 0xC4D0, "u8"], ["returnAceFlag", 0xC4D1, "u8"],
  ["servingCharWramBank", 0xC4D2, "u8"], ["currentServingPlayer", 0xC4D3, "u8"], ["servingCharCourtPos", 0xC4D4, "u8"],
  ["matchPointFlag", 0xC4D5, "s8"], ["setPointFlag", 0xC4D6, "s8"], ["gamePointFlag", 0xC4D7, "s8"],
  ["pointOutcome", 0xC4D8, "u8"], ["pointOutcomeSide", 0xC4D9, "s8"], ["landingMarkerActive", 0xC4DA, "u8"],
  ["courtViewOption", 0xC4DD, "u8"],
  ["gameMode", 0xC8A6, "u8"],
  ["prevCourtPos", 0xC8CF, "u8"], ["matchRngState", 0xC8DF, "u8"],
  ["player1SetsWon", 0xC8E0, "u8"], ["player2SetsWon", 0xC8E1, "u8"], ["player1GamesWon", 0xC8E2, "u8"], ["player2GamesWon", 0xC8E3, "u8"],
  ["player1PointsWon", 0xC8E4, "u8"], ["player2PointsWon", 0xC8E5, "u8"], ["deuceIndicator", 0xC8E6, "u8"], ["tiebreakerIndicator", 0xC8E7, "u8"],
  ["matchWinLoseFlag", 0xC8E8, "s8"], ["setWinLoseFlag", 0xC8E9, "s8"], ["gameWinLoseFlag", 0xC8EA, "s8"], ["pointWinLoseFlag", 0xC8EB, "s8"],
  ["totalGamesWonInMatch", 0xC8EC, "u8"], ["totalPointsScoredInCurrentGame", 0xC8ED, "u8"], ["serveFaultFlag", 0xC8EE, "u8"],
  ["matchTypeNumberOfSets", 0xC8F0, "u8"], ["matchTypeNumberOfGames", 0xC8F1, "u8"], ["matchIsDoubles", 0xC8F2, "u8"], ["onCourtCharCount", 0xC8F3, "u8"],
  ["currentlyUsedCourt", 0xC8F4, "u8"], ["matchContext", 0xC8F5, "u8"], ["matchBGM", 0xC8F8, "u8"],
  // HRAM
  ["playerInputFlags", 0xFF90, "u8"], ["inputRisingEdge", 0xFF94, "u8"], ["wramBank", 0xFF96, "u8"],
  ["linkState", 0xFFC2, "u8"], ["linkInput", 0xFFD3, "u8"], ["linkRemoteInput", 0xFFD4, "u8"], ["linkRemoteInputBuf", 0xFFD5, "u8"],
  ["linkExchangeActive", 0xFFD8, "u8"], ["matchFrameCounter", 0xFFE9, "u8"],
];
// the per-character struct at $DF00 in WRAM bank 4 + wCharIndex (include/ram_mirrored.inc in the disassembly)
export const CHAR = [
  ["posX", 0xDF00, "s24"], ["posXInt", 0xDF01, "s16"], ["posDepth", 0xDF03, "s24"], ["posDepthInt", 0xDF04, "s16"],
  ["posHeight", 0xDF06, "s24"], ["posHeightInt", 0xDF07, "s16"],
  ["serveRole", 0xDF09, "u8"], ["courtPos", 0xDF0A, "u8"], ["index", 0xDF0B, "u8"],
  ["baseFacing", 0xDF0C, "u8"], ["facingDesired", 0xDF0D, "u8"], ["facingShown", 0xDF0E, "u8"], ["flags", 0xDF0F, "u8"],
  ["freezeTimer", 0xDF10, "u8"], ["shotComboTimer", 0xDF11, "u8"], ["aiActionTimer", 0xDF12, "u8"], ["aiSecondButtonDelay", 0xDF13, "u8"],
  ["shotType", 0xDF14, "u8"], ["swingAnim", 0xDF15, "u8"], ["shotButton1", 0xDF16, "u8"], ["shotButton2", 0xDF17, "u8"],
  ["state", 0xDF18, "u8"], ["statePhase", 0xDF19, "u8"], ["aiPhase", 0xDF1A, "u8"], ["spriteFrame", 0xDF1B, "u8"],
  ["inputSource", 0xDF1E, "u8"], ["inputBits", 0xDF1F, "u8"], ["objectDefId", 0xDF21, "u8"], ["objectBank", 0xDF22, "u8"],
  ["frameTablePtr", 0xDF24, "u16"], ["frameVramDest", 0xDF26, "u16"], ["animTablePtr", 0xDF28, "u16"], ["animScriptBase", 0xDF2A, "u16"],
  ["animScriptPtr", 0xDF2C, "u16"], ["animId", 0xDF2E, "u8"], ["animDelay", 0xDF2F, "u8"], ["spriteDirty", 0xDF30, "u8"],
  ["facingOctant", 0xDF32, "u8"], ["animFrame", 0xDF33, "u8"], ["tileBase", 0xDF36, "u8"], ["spriteAttr", 0xDF37, "u8"],
  ["shadowTablePtr", 0xDF38, "u16"], ["gfxBank", 0xDF3A, "u8"],
  ["velX", 0xDF40, "s16"], ["velDepth", 0xDF42, "s16"], ["velHeight", 0xDF44, "s16"],
  ["walkTargetX", 0xDF46, "s16"], ["walkTargetDepth", 0xDF48, "s16"],
  ["aimOffset", 0xDF4A, "s8"], ["swingFrames", 0xDF4B, "u8"], ["quickSwing", 0xDF4C, "u8"], ["swingHoldButton", 0xDF4D, "u8"],
  ["swingHoldFrames", 0xDF4E, "u8"], ["lastShotButton", 0xDF4F, "u8"], ["ballReachFlags", 0xDF50, "u8"],
  ["chargeFlashOn", 0xDF51, "u8"], ["chargeFlashGfxLoaded", 0xDF52, "u8"], ["screenX", 0xDF53, "u8"], ["screenY", 0xDF54, "u8"],
  ["walkTargetFlag", 0xDF55, "u8"], ["scriptedMove", 0xDF56, "u8"], ["pointResult", 0xDF57, "s8"],
  ["aiShotButtons", 0xDF58, "u8"], ["aiTrackingCountdown", 0xDF59, "u8"], ["rallyReady", 0xDF5A, "u8"],
  ["maxSpeedX", 0xDF60, "s16"], ["maxSpeedDepth", 0xDF62, "s16"], ["acceleration", 0xDF64, "s16"], ["deceleration", 0xDF66, "s16"],
  ["facingEaseRate", 0xDF68, "u8"], ["aimOffsetScale", 0xDF69, "u8"], ["aimJitterScale", 0xDF6A, "u8"],
  ["groundStrokeSpeedIndex", 0xDF6B, "u8"], ["smashServeSpeedIndex", 0xDF6C, "u8"], ["reachSpeedIndex", 0xDF6D, "u8"],
  ["topspinPlacementIndex", 0xDF6E, "u8"], ["slicePlacementIndex", 0xDF6F, "u8"],
  ["reachHeight", 0xDF70, "s16"], ["reachX", 0xDF72, "s16"], ["smashJumpSpeed", 0xDF74, "s16"], ["diveSpeed", 0xDF76, "s16"],
  ["id", 0xDF78, "u8"], ["aiReactionDelayNear", 0xDF79, "u8"], ["aiReactionDelayFar", 0xDF7A, "u8"], ["aiTrackingParam", 0xDF7B, "u8"],
  ["aiAimAwayChance", 0xDF7C, "u8"], ["aiServeStyle", 0xDF7D, "u8"], ["spriteSetId", 0xDF7E, "u8"], ["aiPositionStrategy", 0xDF7F, "u8"],
  ["swingAttrWord", 0xDF90, "u16"], ["lobPlacementIndex", 0xDF92, "u8"], ["dropPlacementIndex", 0xDF93, "u8"],
  ["mirrorAttrMask", 0xDF94, "u8"], ["expTier", 0xDF95, "u8"], ["depthKey", 0xDF96, "u8"],
];

const READ = { u8: "u8", s8: "s8", u16: "u16", s16: "s16", u24: "u24", s24: "s24", s32: "s32" };
const WRITE = { u8: "w8", s8: "w8", u16: "w16", s16: "w16", u24: "w24", s24: "w24", s32: "w32" };
function define(target, table, mem, bank = null) {
  for (const [name, addr, type] of table) {
    const r = READ[type], w = WRITE[type];
    Object.defineProperty(target, name, bank === null
      ? { get: () => mem[r](addr), set: v => mem[w](addr, v), enumerable: true }
      : { get: () => mem.withBank(bank, () => mem[r](addr)), set: v => mem.withBank(bank, () => mem[w](addr, v)), enumerable: true });
  }
  return target;
}
// the engine's view: S.ballX, S.rallyLength ... and S.chars[k].posX for the character in bank 4 + k
export function matchState(mem) {
  const S = define({ mem }, GLOBALS, mem);
  S.chars = [0, 1, 2, 3].map(k => define({ k, bank: 4 + k }, CHAR, mem, 4 + k));
  return S;
}
// address -> field name, for reports
export function fieldAt(addr, bank = 0) {
  const t = addr >= 0xD000 && addr < 0xE000 ? CHAR : GLOBALS;
  let best = null;
  for (const [n, a, ty] of t) { const sz = { u8: 1, s8: 1, u16: 2, s16: 2, u24: 3, s24: 3, s32: 4 }[ty]; if (addr >= a && addr < a + sz && (!best || sz < best[1])) best = [n, sz, a]; }
  return best ? (t === CHAR ? `char${bank - 4}.` : "") + best[0] + (addr !== best[2] ? `+${addr - best[2]}` : "") : `$${addr.toString(16)}`;
}
