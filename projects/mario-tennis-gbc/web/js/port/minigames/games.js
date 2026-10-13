// The minigames of bank $0D, game by game: their inits, their eight mode hooks, and their targets.
// Port of tennis_0d.asm, wall_0d.asm, minigame_targets_0d.asm, booblast_0d.asm, treasure_0d.asm, medallion_0d.asm
// and the per-game parts of minigame_actors_0d.asm, with the twins tennis_machine4_hook__point_start,
// is_ball_in_medallion_match_hit_zone and project_medallion_match_world_position, of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm), whose names these are.
// The shared machinery (the machine, the wall, the score, the actors) is in minigame_core.js; how a minigame runs
// is described there and in common.js. The hook ids below: PerFrame, PointStart, PointEnd, MinigameStart, BallHit,
// Bounce, RallyTick, Draw (RetStub entries are the ROM's `ret` at 00:03AE and not hooked here).
//
// The games (minigame id, the opponent / court, the rules):
//   $12-$15 The Machine 1-4: return the machine's balls; a point per return, a target score per level; level n
//           fires from 1, 3, 6 or 9 slots.          $1A Machine Master: the same, until a miss, for the record.
//   $16-$19 The Wall 1-4: rally against the wall (formations of targets on it, InitMinigameTargets in bank $0A);
//           a point per return.                      $1B Wall Master: until a miss.
//   $1C Boo Blast: hit the moving Boo (the controller actor); each hit doubles the next one's points.
//   $1D Shooting Star: hit the star target that hops about over the machine's court; smashes score more.
//   $1E Perfect Shot: hit the wall's 21 tiles to light them all; each full grid raises a tile's worth.
//   $1F Target Shot: the machine's ball must be returned into the zone shown, with the shot it asks for.
//   $20 Fruit Fantasy / $21 Banana Bunch: wall targets (fruit) that score by kind; grid cells deflect the ball.
//   $22 Treasure Box: hit the treasure boxes that appear in the zone; rarer boxes are worth more.
//   $23 Medallion Match: six medallions over the court; each hit in a row is worth more.
// Level 2 (the third) of each Mario minigame is its high-score mode.
import {
  BANK_MINIGAMES, ROM, far, sound, pushWramBank, rb, rw, at, auto, FLAG_Z,
  POINTOUTCOME, SHOTTYPE_SMASH, WRAM_COURT_PLANES, WRAM_ACTORS, WRAM_CHAR0, WRAM_TEXT, CHAR,
  SFX_CHIME, SFX_THUD, SFX_BALL_CONTACT, SFX_GRID_CLEAR,
} from "./common.js";
import {
  ACTORS, ACTOR_SIZE, SCENE_ACTOR, ACT, scene, setScene, advanceActorState, jumpTable,
  initMinigameScore, startMinigameMatch, drawMinigameScoreHud, drawMinigameScore, launchMinigameServe,
  awardMinigamePointAndEnd, endMinigamePoint, keepMinigameCameraFixed, checkMinigameStartBannerTrigger,
  freezeMinigameOpponentOnReturn, updateMinigameHudAndBallTrail, startMinigameSoloPoint, handleMinigamePointEnd,
  awardMinigamePointAndReflectBall, reflectBallVelocity, stubNop, hideLandingMarkerAndExtendSoloCourt,
  addToMinigameScore, isMinigameTargetReached, startScorePopup, updateScorePopup, incrementCappedCounter,
  getMinigameGridCellIndex, drawMinigameGrid, drawMinigameGridCell, queueMinigameHudVRAMCopy,
  showPointOutcomeBanner, determineMinigamePointResult, showMinigamePointResult, clearMinigameActors,
  setMinigameActorHandler, setMinigameActorPosition, setMinigameActorWorldPos, updateMinigameActors,
  loadMatchUiCourtTilemap, loadTargetZoneConfig, projectMinigameWorldPosition, projectSceneActor,
  queueMinigameHitBurst, queueMinigameHitBurstFirstFour, queueMinigameHitBurstFirstTwo,
} from "./minigame_core.js";
import { copyMemoryBC } from "../home/memory.js";
import { queueSprite16 } from "../home/fade.js";
import { mulHLByA } from "../home/math.js";

const B = BANK_MINIGAMES;
const u16 = (P, name) => P.bus.u16(P.A[name]);
const w16 = (P, name, v) => P.bus.w16(P.A[name], v);
const RETSTUB = 0x03AE;                        // RetStub: the jump tables' "do nothing" entry
const GRID = 0xC7C0, GRID_SIZE = 0x18;         // wMinigameTargetGrid (WRAM0): 24 cells, 8 x 3
const GRID_LIT = 0x01;                         // Perfect Shot: a tile already hit
const HIGH_SCORE_LEVEL = 2;                    // the Mario minigames' third level: play for the record
const TARGET_DEPTH = 0xFDC0;                   // Shooting Star's star: the depth it hops along
const RETICLE_TILE = 0x30, BURST_TILE = 0x3C;  // the target sprites' tiles (24x32 / burst particles)

// the minigame's level-2 rule of the Mario minigames
function highScoreAtLevel2(P) { if (P.V.minigameLevel === HIGH_SCORE_LEVEL) P.V.minigameHighScoreMode = 1; }
// the next launcher slot: the current one plus 1 to n (random), wrapping at `slots`
function stepServeSlot(P, mask, slots) {
  const v = ((far(P, ROM.AdvanceMatchRng).a & mask) + 1 + P.V.minigameServeSlot) & 0xFF;
  P.V.minigameServeSlot = v >= slots ? (v - slots) & 0xFF : v;
}
// a random x for a hopping target: AdvanceMatchRng * 2 - $100 (-$100..$FE)
const randomTargetX = P => ((far(P, ROM.AdvanceMatchRng).a * 2) + 0xFF00) & 0xFFFF;
// |v| of a 16-bit difference (`xor a / sub l / ld l, a / sbc a / sub h`)
const abs16 = v => (v & 0x8000 ? (-v) & 0xFFFF : v & 0xFFFF);
// the ball near the scene actor: |dx| < xr, |d depth| < dr, |height| < hr
function ballNearSceneActor(P, xr, dr, hr) {
  if (abs16(u16(P, "ballX") - P.bus.u16(SCENE_ACTOR + ACT.x)) >= xr) return 0;
  if (abs16(u16(P, "ballDepth") - P.bus.u16(SCENE_ACTOR + ACT.depth)) >= dr) return 0;
  if (abs16(u16(P, "ballHeight")) >= hr) return 0;
  return 1;
}

// ---- The Machine 1-4 and Machine Master ----
// InitMinigame_TennisMachine1-4 (0D:450A, 4969, 49C6, 4A23) / _TennisMachineHighScore (0D:4CE9)
function initTennisMachine(level, highScore) {
  return P => {
    P.V.minigameUsesTennisMachine = 1;
    if (highScore) P.V.minigameHighScoreMode = 1;
    P.V.minigameLevel = level;
  };
}
// TennisMachine1Hook_PointStart (0D:4532): the next ball from the one slot
// TennisMachine2/3Hook_PointStart (0D:4991, 49EE), TennisMachine4Hook_PointStart / ..HighScoreHook_PointStart
// (0D:4A4B, 4D16): the machine moves on 1-2 slots of 3, 1-4 of 6, 1-8 of 9 first
const machinePointStart = (mask, slots) => function* (P) {
  if (mask) stepServeSlot(P, mask, slots);
  yield* launchMinigameServe(P);
};
const startAtSlot = (slot, extra) => function* (P) {
  P.V.minigameServeSlot = slot;
  yield* startMinigameMatch(P);
  if (extra) extra(P);
};

// ---- The Wall 1-4 and Wall Master ----
// InitMinigame_WallPractice1-4 (0D:4A80, 4C08, 4C53, 4C9E) / _WallPracticeHighScore (0D:4D4B): the wall's
// target formation for the level
function initWall(level, highScore) {
  return function* (P) {
    if (highScore) P.V.minigameHighScoreMode = 1;
    P.V.minigameUsesWall = 1;
    P.V.minigameLevel = level;
    yield* farWaitInit(P, ROM.InitMinigameTargets);
    yield* farWaitInit(P, ROM.SpawnMinigameTargetFormation, { a: level });
  };
}
function* farWaitInit(P, routine, regs) { yield* P.runRom(routine[0], routine[1], regs); }

// ---- Target Shot ($1F) ----
const TargetShotZonePoolsByLevel = 0x4E5A, TargetShotScoreRules = 0x4EC1;
// InitMinigame_TargetShot (0D:4D9B)
function initTargetShot(P) { P.V.minigameUsesTennisMachine = 1; highScoreAtLevel2(P); }
// TargetShotHook_Bounce (0D:4DF2): the player's return bouncing in the zone (and a winner) scores the points the
// zone and shot are worth, with a popup and a chime; outside the zone it is out
function targetShotBounce(P) {
  if (P.V.pointOutcome) return;
  checkMinigameStartBannerTrigger(P);
  checkBallLandedOut(P);
  if (P.V.pointOutcome !== POINTOUTCOME.WINNER) return;
  const points = lookupMinigameShotResult(P);
  w16(P, "scorePopupValue", points);
  addToMinigameScore(P, points);
  startScorePopup(P);
  sound(P, SFX_CHIME);
}
// SelectRandomMinigameShot (0D:4E20), Target Shot's PointStart: a random zone from the level's pool (wMinigameShotRoll),
// its rectangle, and its markings drawn on the court
function selectRandomMinigameShot(P) {
  const old = pushWramBank(P, WRAM_COURT_PLANES);
  const pool = rw(P, at(TargetShotZonePoolsByLevel, P.V.minigameLevel * 2));
  P.V.minigameShotRoll = rb(P, at(pool, far(P, ROM.AdvanceMatchRng).a & 0x0F));
  loadTargetZoneConfig(P, P.V.minigameShotRoll);
  loadMatchUiCourtTilemap(P, P.V.minigameShotRoll);
  queueMinigameHudVRAMCopy(P);
  P.wramBank(old);
}
// CheckBallLandedOut (0D:4E80): the player's ball (even character) landing outside the target zone is out
function checkBallLandedOut(P) {
  if (P.V.lastShotCharIndex & 1) return;
  if (far(P, ROM.IsBallInTargetZone).a) return;
  P.V.pointOutcome = POINTOUTCOME.OUT;
  P.V.pointOutcomeSide = 0xFF;
}
// LookupMinigameShotResult (0D:4E96): the points of the first rule [zone, buttons, shot type or $FF any, points]
// matching the zone, the shot's buttons and its type; 1 when none does
function lookupMinigameShotResult(P) {
  for (let r = TargetShotScoreRules; ; r += 4) {
    const zone = rb(P, r);
    if (zone === 0xFF) return 1;
    if (P.V.minigameShotRoll !== zone) continue;
    if (P.V.lastShotButtons !== rb(P, r + 1)) continue;
    const shot = rb(P, r + 2);
    if (shot !== 0xFF && P.V.currentShotType !== shot) continue;
    return rb(P, r + 3);
  }
}

// ---- Shooting Star ($1D) ----
const ShootingStarTargetActorHandler = 0x5231, ShootingStarStates = 0x5235;
const MinigameHitStreakSounds = 0x534F, MinigameHitStreakMultipliers = 0x5357, TargetReticleAnimFrames = 0x537E;
function initShootingStar(P) { P.V.minigameUsesTennisMachine = 1; highScoreAtLevel2(P); }
// InitBallTargetActor (0D:5205): the star (actor 0) over the far court
function initBallTargetActor(P) {
  clearMinigameActors(P);
  setMinigameActorHandler(P, ACTORS, ShootingStarTargetActorHandler);
  setMinigameActorPosition(P, ACTORS, 0x0000, TARGET_DEPTH);
}
// ResetTargetHitState (0D:521E), each point: a point with no hit breaks the streak; the target shows again
function resetTargetHitState(P) {
  if (!P.V.minigameHitScored) P.V.minigameHitStreak = 0;
  P.V.minigameHitScored = 0;
  P.bus.w8(ACTORS + ACT.state, 0);
}
// ShootingStarTargetActorHandler (0D:5231): 0 hop somewhere (after a hit), 1 wait for the ball, 2 the hit's burst,
// then hop, 3 shown (the point is over)
function shootingStarTargetActorHandler(P) {
  jumpTable(P, B, ShootingStarStates, scene(P, ACT.state), [
    () => shootingStarTargetState0(P), () => shootingStarTargetState1(P), () => shootingStarTargetState2(P),
    () => shootingStarTargetState3(P), () => {},
  ]);
}
// ShootingStarTargetState0 (0D:5244): a new spot if the timer is set; on to state 1 (and its work now)
function shootingStarTargetState0(P) {
  if (scene(P, ACT.timer)) setMinigameActorWorldPos(P, randomTargetX(P), TARGET_DEPTH);
  setScene(P, ACT.timer, 0);
  advanceActorState(P);
  shootingStarTargetState1(P);
}
// ShootingStarTargetState1 (0D:5262): the star; a ball through it scores
function shootingStarTargetState1(P) {
  drawTargetReticleSprite(P);
  if (!isBallInHitZone(P)) return;
  awardHitScore(P);
  advanceActorState(P);
}
// ShootingStarTargetState2 (0D:5270): the burst for the timer's frames, then a new spot
function shootingStarTargetState2(P) {
  drawTargetHitCountdown(P);
  const t = (scene(P, ACT.timer) - 1) & 0xFF;
  setScene(P, ACT.timer, t);
  if (t) return;
  setMinigameActorWorldPos(P, randomTargetX(P), TARGET_DEPTH);
  advanceActorState(P);
}
// ShootingStarTargetState3 (0D:528E)
function shootingStarTargetState3(P) { drawTargetReticleSprite(P); }
// IsBallInHitZone (0D:5292): the player's ball within $80 across, $100 in depth and $C0 in height of the star
function isBallInHitZone(P) {
  if (P.V.lastShotCharIndex & 1) return 0;
  return ballNearSceneActor(P, 0x80, 0x100, 0xC0);
}
// AwardHitScore (0D:52F9): 1 point (a smash: 7, and a longer burst), times the streak's multiplier (1, 2, 4 ... 128)
// with the streak's sound; the streak grows (to 7); the point is a winner
function awardHitScore(P) {
  setScene(P, ACT.timer, 0x10);
  let points = 1;
  if (P.V.currentShotType === SHOTTYPE_SMASH) { setScene(P, ACT.timer, 0x20); points = 7; }
  P.V.minigameHitScored = 1;
  sound(P, rb(P, at(MinigameHitStreakSounds, P.V.minigameHitStreak)));
  points = mulHLByA(P, points, rb(P, at(MinigameHitStreakMultipliers, P.V.minigameHitStreak))).hl;
  w16(P, "scorePopupValue", points);
  addToMinigameScore(P, points);
  startScorePopup(P);
  incrementCappedCounter(P, 7);
  P.V.pointOutcome = POINTOUTCOME.WINNER;
  P.V.pointOutcomeSide = 1;
}
// DrawTargetReticleSprite (0D:535F): the star (24x32), its tiles animated every 8 frames
function drawTargetReticleSprite(P) {
  const p = projectMinigameWorldPosition(P);
  far(P, ROM.QueueSprite24x32, { b: p.b, c: RETICLE_TILE, d: p.d, e: p.e, h: 0xFC, l: 0xF1 });
  const frame = rb(P, at(TargetReticleAnimFrames, P.V.vBlankCounter & 0x1F));
  if (frame === 0xFF) return;
  far(P, ROM.QueueMatchSpriteFrameA, { a: frame });
}
// DrawTargetHitCountdown (0D:539E): the hit's burst
function drawTargetHitCountdown(P) {
  const p = projectMinigameWorldPosition(P);
  queueMinigameHitBurst(P, scene(P, ACT.timer), p.b, BURST_TILE, p.d, p.e);
}

// ---- Banana Bunch ($21) and Fruit Fantasy ($20): wall targets and grid cells ----
const BananaBunchGridLayoutsByLevel = 0x5548, FruitFantasyGridLayoutsByLevel = 0x5F8E, MinigameTargetTypeScores = 0x55F9;
// InitMinigame_BananaBunch (0D:54FC, formation 5) / InitMinigame_FruitFantasy (0D:5F42, formation 6)
const initFruitWall = formation => function* (P) {
  yield* farWaitInit(P, ROM.InitMinigameTargets);
  yield* farWaitInit(P, ROM.SpawnMinigameTargetFormation, { a: formation });
  P.V.minigameTargetsAltMode = 1;
  P.V.minigameUsesWall = 1;
  highScoreAtLevel2(P);
};
// BananaBunchHook_PointStart (0D:5533) / FruitFantasyHook_PointStart (0D:5F79): the level's grid of cells
const fruitPointStart = layouts => P => {
  startMinigameSoloPoint(P);
  copyMinigameTilemapBlock(P, rw(P, at(layouts, P.V.minigameLevel * 2)));
};
// BananaBunchReflectBallAndRecordCell (0D:55AA) / FruitFantasyReflectBallAndRecordCell (0D:5FF0), the RallyTick
// hook: the wall returns the ball; note the grid cell it struck
function reflectBallAndRecordCell(P) {
  reflectBallVelocity(P);
  P.V.minigameLastHitCell = getMinigameGridCellIndex(P);
}
// CopyMinigameTilemapBlock (0D:55B4), hl = a 24-cell layout: into wMinigameTargetGrid, drawn (leaves WRAM 2 mapped)
function* copyMinigameTilemapBlockWait(P, layout) { copyMinigameTilemapBlock(P, layout); }
function copyMinigameTilemapBlock(P, layout) {
  P.wramBank(WRAM_COURT_PLANES);
  copyMemoryBC(P, layout, GRID, GRID_SIZE);
  drawMinigameGrid(P);
  far(P, ROM.FlushTilemapToVram);
}
// ScoreMinigameTargetHitOrDeflectBall (0D:55CA), every frame (UpdateBananaBunchTargetHits 0D:55A6,
// UpdateFruitFantasyTargetHits 0D:5FEC): a target the ball hit (bank $0A's target code sets wMinigameHitPending)
// scores its kind's points (1, 3, 5, 3; the target score clears the minigame); a grid cell struck instead
// (wMinigameHitTargetType $FF) deflects the ball by the cell's kind
function scoreMinigameTargetHitOrDeflectBall(P) {
  const { V } = P;
  if (!V.minigameHitPending) return;
  V.minigameHitPending = 0;
  if (V.minigameHitTargetType !== 0xFF) {
    addToMinigameScore(P, rb(P, at(MinigameTargetTypeScores, V.minigameHitTargetType)));
    V.minigameHitTargetType = 0xFF;
    if (isMinigameTargetReached(P)) V.pointOutcome = POINTOUTCOME.MINIGAME_CLEARED;
    return;
  }
  const cell = V.minigameLastHitCell;
  if (cell === 0xFF) return;
  const kind = P.bus.u8(at(GRID, cell));
  if (!kind) return;
  far(P, ROM.DeflectBallOffMinigameTarget, { a: (kind - 4) & 0xFF });
  sound(P, SFX_BALL_CONTACT);
}

// ---- Boo Blast ($1C) ----
const BooBlastInitParams = 0x5652, BooBlastControllerActorHandler = 0x5719, BooBlastStates = 0x571D;
const UnusedBitMaskTable_0d = 0x57F5, BooBlastTargetAnimFrames = 0x581C, MinigameHitStreakValueTable_0d = 0x5866;
const BOO_ATTR = 0x0E;
// InitMinigame_BooBlast (0D:5625): Luigi on the far side, with the CPU parameters Boo Blast gives him
function initBooBlast(P) {
  const { V, bus } = P;
  V.minigameIsBooBlast = 1;
  highScoreAtLevel2(P);
  for (let i = 0; i < 4; i++) bus.w8(P.A.player2MainAiParams + i, rb(P, BooBlastInitParams + i));
  V.exhibitionModeCPUMainCharacterDifficulty = rb(P, BooBlastInitParams + 4);
  V.player2MainInitByte = rb(P, BooBlastInitParams + 5);
}
// InitMinigameControllerActor (0D:5691): the Boo (actor 0) at the court's centre
function initMinigameControllerActor(P) {
  clearMinigameActors(P);
  setMinigameActorHandler(P, ACTORS, BooBlastControllerActorHandler);
  setMinigameActorPosition(P, ACTORS, 0x0000, 0x0000);
}
// DisableMinigameControllerActor (0D:56AA): the Boo off (WRAM bank as mapped)
function disableMinigameControllerActor(P) { P.bus.w8(ACTORS, P.bus.u8(ACTORS) & ~1); }
// DisableOffscreenArrows (0D:56BB), Boo Blast's PointStart
function disableOffscreenArrows(P) { P.V.offscreenArrowsEnabled = 0; }
// ResolveAndShowMinigamePoint (0D:56C0), Boo Blast's PointEnd: banner, result; both players react, Luigi keeping
// Mario's point result (he cheers with him)
function* resolveAndShowMinigamePoint(P) {
  yield* showPointOutcomeBanner(P);
  const r = determineMinigamePointResult(P);
  const old = pushWramBank(P, WRAM_CHAR0);
  yield* P.runRom(...ROM.CharPointEndReaction);
  const result = P.bus.u8(CHAR.pointResult);
  P.wramBank(WRAM_TEXT);
  yield* P.runRom(...ROM.CharPointEndReaction);
  P.bus.w8(CHAR.pointResult, result);
  P.wramBank(old);
  yield* showMinigamePointResult(P, r.d);
}
// UpdateBooBlastHitStreak (0D:56F0), Boo Blast's BallHit: a rally exchange with a hit grows the streak (to 7);
// Luigi's shot after one with no hit breaks it; the Boo shows again
function updateBooBlastHitStreak(P) {
  const { V } = P;
  if (V.minigameHitScored) incrementCappedCounter(P, 7);
  else if (V.lastShotCharIndex & 1) V.minigameHitStreak = 0;
  V.minigameHitScored = 0;
  P.bus.w8(ACTORS + ACT.state, 0);
}
// BooBlastControllerActorHandler (0D:5719): 0 start, 1 wait for the ball, 2 the hit's burst then move, 3 shown
function booBlastControllerActorHandler(P) {
  jumpTable(P, B, BooBlastStates, scene(P, ACT.state), [
    () => { advanceActorState(P); booBlastControllerState1(P); }, () => booBlastControllerState1(P),
    () => booBlastControllerState2(P), () => drawBooBlastTargetSprite(P), () => {},
  ]);
}
// BooBlastControllerState1 (0D:572F): the Boo; any ball through it scores
function booBlastControllerState1(P) {
  drawBooBlastTargetSprite(P);
  if (!isBallWithinTargetZone(P)) return;
  scoreBallHit(P);
  advanceActorState(P);
}
// BooBlastControllerState2 (0D:573D): the burst, then a new spot across the net line
function booBlastControllerState2(P) {
  drawBooBlastHitBurst(P);
  const t = (scene(P, ACT.timer) - 1) & 0xFF;
  setScene(P, ACT.timer, t);
  if (t) return;
  setMinigameActorWorldPos(P, randomTargetX(P), 0x0000);
  advanceActorState(P);
}
// IsBallWithinTargetZone (0D:575F): the ball within $80 across, $140 in depth, $100 in height of the Boo
function isBallWithinTargetZone(P) { return ballNearSceneActor(P, 0x80, 0x140, 0x100); }
// ScoreBallHit (0D:57BE): 2^streak points with a thud; the target score clears the minigame
function scoreBallHit(P) {
  setScene(P, ACT.timer, 0x10);
  P.V.minigameHitScored = 1;
  sound(P, SFX_THUD);
  const points = mulHLByA(P, 1, rb(P, at(UnusedBitMaskTable_0d, P.V.minigameHitStreak))).hl;
  w16(P, "scorePopupValue", points);
  addToMinigameScore(P, points);
  startScorePopup(P);
  if (isMinigameTargetReached(P)) P.V.pointOutcome = POINTOUTCOME.MINIGAME_CLEARED;
}
// DrawBooBlastTargetSprite (0D:57FD): the Boo (24x32), animated
function drawBooBlastTargetSprite(P) {
  const p = projectBallSprite(P);
  far(P, ROM.QueueSprite24x32, { b: p.b, c: RETICLE_TILE, d: p.d, e: p.e, h: 0xFC, l: 0xF1 });
  const frame = rb(P, at(BooBlastTargetAnimFrames, P.V.vBlankCounter & 0x1F));
  if (frame === 0xFF) return;
  far(P, ROM.QueueMatchSpriteFrameB, { a: frame });
}
// DrawBooBlastHitBurst (0D:583C)
function drawBooBlastHitBurst(P) {
  const p = projectBallSprite(P);
  queueMinigameHitBurst(P, scene(P, ACT.timer), p.b, BURST_TILE, p.d, p.e);
}
// ProjectBallSprite (0D:5848): the Boo's screen position; its attribute is always $0E (the streak's table entry
// is read and dropped)
function projectBallSprite(P) {
  const r = projectSceneActor(P);
  const entry = at(MinigameHitStreakValueTable_0d, P.V.minigameHitStreak);
  return { ...r, b: BOO_ATTR, hl: entry };
}

// ---- Perfect Shot ($1E) ----
const PerfectShotLevelHasTargets = 0x58A3, PerfectShotTargetGridLayout = 0x5941;
// InitMinigame_PerfectShot (0D:587E): the wall, and from level 1 a formation of targets
function* initPerfectShot(P) {
  P.V.minigameUsesWall = 1;
  highScoreAtLevel2(P);
  yield* farWaitInit(P, ROM.InitMinigameTargets);
  const formation = rb(P, at(PerfectShotLevelHasTargets, P.V.minigameLevel));
  if (!formation) return;
  yield* farWaitInit(P, ROM.SpawnMinigameTargetFormation, { a: formation });
}
// PerfectShotHook_PointStart (0D:58BA)
function perfectShotPointStart(P) { startMinigameSoloPoint(P); resetTargetGrid(P); }
// ProcessTargetTileHit (0D:58D1), Perfect Shot's RallyTick: the wall returns the ball; a tile struck for the first
// time lights up and scores (wTargetTileHit + 1, rising with each full grid, to 10); the target score clears the
// minigame; a fully lit grid flashes clear (the match frozen meanwhile) and starts again
function* processTargetTileHit(P) {
  const { V } = P;
  reflectBallVelocity(P);
  const cell = getMinigameGridCellIndex(P);
  if (cell === 0xFF) return;
  const at_ = at(GRID, cell);
  if (P.bus.u8(at_) === GRID_LIT) return;
  let old = pushWramBank(P, WRAM_COURT_PLANES);
  P.bus.w8(at_, GRID_LIT);
  drawMinigameGridCell(P, cell, GRID_LIT);
  far(P, ROM.FlushTilemapToVram);
  P.wramBank(old);
  sound(P, SFX_CHIME);
  addToMinigameScore(P, (V.targetTileHit + 1) & 0xFF);
  if (isMinigameTargetReached(P)) { V.pointOutcome = POINTOUTCOME.MINIGAME_CLEARED; return; }
  if (!areAllTargetsHit(P)) return;
  if (V.targetTileHit < 9) V.targetTileHit = V.targetTileHit + 1;
  old = pushWramBank(P, WRAM_COURT_PLANES);
  V.matchSimFrozen = 1;
  yield* animateTargetGridClear(P);
  V.matchSimFrozen = 0;
  P.wramBank(old);
}
// ResetTargetGrid (0D:5979): the unlit grid (the last column, cells 7, 15, 23, counted as lit: it has no tiles)
function resetTargetGrid(P) {
  copyMinigameTilemapBlock(P, PerfectShotTargetGridLayout);
  for (const cell of [7, 15, 23]) P.bus.w8(GRID + cell, GRID_LIT);
}
// AnimateTargetGridClear (0D:598B): the tiles go back to unlit one by one, 8 frames apart, with a sound each
function* animateTargetGridClear(P) {
  yield* P.runRom(...ROM.StepMatchFrames, { a: 2 });
  for (let cell = 0; cell < GRID_SIZE; cell++) {
    const type = rb(P, PerfectShotTargetGridLayout + cell);
    if (!type) continue;
    drawMinigameGridCell(P, cell, type);
    far(P, ROM.FlushTilemapToVram);
    sound(P, SFX_GRID_CLEAR);
    yield* P.runRom(...ROM.StepMatchFrames, { a: 8 });
  }
  resetTargetGrid(P);
}
// AreAllTargetsHit (0D:59B7): 1 when all 24 cells are lit
function areAllTargetsHit(P) {
  for (let cell = 0; cell < GRID_SIZE; cell++) if (P.bus.u8(GRID + cell) !== GRID_LIT) return 0;
  return 1;
}

// ---- Treasure Box ($22) ----
const TreasureBoxTargetActorHandler = 0x5ACC, TreasureBoxStates = 0x5AD0, TreasureBoxZonePoolsByLevel = 0x5AA5;
const TreasureBoxTypePoolLate = 0x5B4B, TreasureBoxTypePoolEarly = 0x5B5B, TreasureBoxSpawnPointsByZone = 0x5B6B;
const TreasureBoxValuesByType = 0x5C7D, TreasureBoxHitStreakSounds = 0x5C81, TreasureBoxHitStreakMultipliers = 0x5C85;
const TreasureBoxSpriteAnimFrames = 0x5CAB;
const EARLY_BALLS = 11;                        // the first 11 balls draw from the poorer pool of box kinds
const PROJECTED_ATTR = 0x0F;
function initTreasureBox(P) { P.V.minigameUsesTennisMachine = 1; highScoreAtLevel2(P); }
// TreasureBoxHook_MinigameStart (0D:59FD): the box actor (actor 0), the machine, the target zone on
function* treasureBoxMinigameStart(P) {
  clearMinigameActors(P);
  P.V.minigameServeSlot = 1;
  yield* startMinigameMatch(P);
  P.V.targetZoneEnabled = 1;
  setMinigameActorHandler(P, ACTORS, TreasureBoxTargetActorHandler);
}
// TreasureBoxHook_Bounce (0D:5A45): a return landing in the zone (a winner) is worth 1
function treasureBoxBounce(P) {
  if (P.V.pointOutcome) return;
  checkMinigameStartBannerTrigger(P);
  checkBallLandedOut(P);
  if (P.V.pointOutcome !== POINTOUTCOME.WINNER) return;
  w16(P, "scorePopupValue", 1);
  addToMinigameScore(P, 1);
  startScorePopup(P);
  sound(P, SFX_CHIME);
}
// SelectRandomTreasureBoxTargetZone (0D:5A70), Treasure Box's PointStart: a random zone from the level's pool; a
// point with no box hit breaks the streak; the box appears anew
function selectRandomTreasureBoxTargetZone(P) {
  const { V } = P;
  const pool = rw(P, at(TreasureBoxZonePoolsByLevel, V.minigameLevel * 2));
  V.minigameShotRoll = rb(P, at(pool, far(P, ROM.AdvanceMatchRng).a & 0x0F));
  loadTargetZoneConfig(P, V.minigameShotRoll);
  if (!V.minigameHitScored) V.minigameHitStreak = 0;
  V.minigameHitScored = 0;
  P.bus.w8(ACTORS + ACT.state, 0);
}
// TreasureBoxTargetActorHandler (0D:5ACC): 0 a box of a random kind at one of the zone's four spots, 1 wait for
// the ball, 2 the burst, 3 gone
function treasureBoxTargetActorHandler(P) {
  jumpTable(P, B, TreasureBoxStates, scene(P, ACT.state), [
    () => treasureBoxTargetState0(P), () => treasureBoxTargetState1(P), () => treasureBoxTargetState2(P),
    () => {}, () => {},
  ]);
}
function treasureBoxTargetState0(P) {
  P.V.treasureBoxState = 0;
  const early = (u16(P, "minigameServeCount") - EARLY_BALLS) & 0x8000;
  const kinds = early ? TreasureBoxTypePoolEarly : TreasureBoxTypePoolLate;
  setScene(P, ACT.kind, rb(P, at(kinds, far(P, ROM.AdvanceMatchRng).a & 0x0F)));
  const spots = rw(P, at(TreasureBoxSpawnPointsByZone, P.V.minigameShotRoll * 2));
  const spot = at(spots, (far(P, ROM.AdvanceMatchRng).a & 0x03) * 4);
  setMinigameActorWorldPos(P, rw(P, spot), rw(P, spot + 2));
  advanceActorState(P);
  treasureBoxTargetState1(P);
}
function treasureBoxTargetState1(P) {
  drawTreasureBoxSprite(P);
  if (!isBallInSmallHitZone(P)) return;
  awardTreasureBoxHitScore(P);
  advanceActorState(P);
}
function treasureBoxTargetState2(P) {
  drawTreasureBoxHitCountdown(P);
  const t = (scene(P, ACT.timer) - 1) & 0xFF;
  setScene(P, ACT.timer, t);
  if (t) return;
  advanceActorState(P);
}
// IsBallInTreasureBoxHitZone (0D:5BC5) / IsBallInMedallionMatchHitZone (0D:5E37): the player's ball within $60
// across, $80 in depth, $C0 in height
function isBallInSmallHitZone(P) {
  if (P.V.lastShotCharIndex & 1) return 0;
  return ballNearSceneActor(P, 0x60, 0x80, 0xC0);
}
// AwardTreasureBoxHitScore (0D:5C2C): the box kind's value (5, 10, 50, 100) times the streak (1, 2, 4, 8; to 3)
function awardTreasureBoxHitScore(P) {
  const { V } = P;
  setScene(P, ACT.timer, 0x10);
  V.minigameHitScored = 1;
  sound(P, rb(P, at(TreasureBoxHitStreakSounds, V.minigameHitStreak)));
  const value = rb(P, at(TreasureBoxValuesByType, scene(P, ACT.kind)));
  const points = mulHLByA(P, value, rb(P, at(TreasureBoxHitStreakMultipliers, V.minigameHitStreak))).hl;
  w16(P, "scorePopupValue", points);
  addToMinigameScore(P, points);
  startScorePopup(P);
  incrementCappedCounter(P, 3);
  V.pointOutcome = POINTOUTCOME.WINNER;
  V.pointOutcomeSide = 1;
}
// DrawTreasureBoxSprite (0D:5C89): the box (16x16) and its kind's sparkle frames (tiles loaded as it animates)
function drawTreasureBoxSprite(P) {
  const p = projectFixedAttr(P);
  queueSprite16(P, p.b, RETICLE_TILE, p.d, p.e);
  const kind = scene(P, ACT.kind);
  const t = P.V.treasureBoxState;
  P.V.treasureBoxState = (t + 1) & 0xFF;
  const frame = rb(P, at(TreasureBoxSpriteAnimFrames, t & 0x1F));
  if (frame === 0xFF) return;
  far(P, ROM.LoadEffectFrameTiles_28, { a: frame, b: kind });
}
function drawTreasureBoxHitCountdown(P) {
  const p = projectFixedAttr(P);
  queueMinigameHitBurstFirstFour(P, scene(P, ACT.timer), p.b, BURST_TILE, p.d, p.e);
}
// ProjectTreasureBoxWorldPosition (0D:5CD7) / ProjectMedallionMatchWorldPosition (0D:5F1F): the scene actor's
// screen position, attribute $0F
function projectFixedAttr(P) { return { ...projectSceneActor(P), b: PROJECTED_ATTR }; }

// ---- Medallion Match ($23) ----
const MedallionMatchTargetActorHandler = 0x5DEE, MedallionMatchStates = 0x5DF2;
const MedallionMatchHitStreakSounds = 0x5EE4, MedallionMatchHitStreakMultipliers = 0x5EEC;
const MedallionMatchSpriteAnimFrames = 0x5F0F;
// the six medallions: [x, depth] (two rows of three either side of the centre; the ROM writes the x of the last as
// `ld hl, rLCDC`, $FF40)
const MEDALLIONS = [[0x0040, 0xFF00], [0x0080, 0xFE40], [0x00C0, 0xFD80], [0xFFC0, 0xFF00], [0xFF80, 0xFE40], [0xFF40, 0xFD80]];
function initMedallionMatch(P) { P.V.minigameUsesTennisMachine = 1; highScoreAtLevel2(P); }
function* medallionMatchMinigameStart(P) {
  spawnMedallionMatchTargets(P);
  P.V.minigameServeSlot = 1;
  yield* startMinigameMatch(P);
  P.V.standingShadowsEnabled = 0;
}
// MedallionMatchHook_PointStart (0D:5D3D)
function* medallionMatchPointStart(P) {
  stepServeSlot(P, 1, 3);
  yield* launchMinigameServe(P);
  resetMedallionMatchHitState(P);
}
// SpawnMedallionMatchTargets (0D:5D65)
function spawnMedallionMatchTargets(P) {
  clearMinigameActors(P);
  MEDALLIONS.forEach(([x, depth], i) => initMedallionMatchTargetActor(P, ACTORS + i * ACTOR_SIZE, x, depth, i));
}
// InitMedallionMatchTargetActor (0D:5DBD), bc = actor, hl/de = x/depth, a = its number
function initMedallionMatchTargetActor(P, actor, x, depth, n) {
  setMinigameActorHandler(P, actor, MedallionMatchTargetActorHandler);
  P.bus.w8(actor + ACT.kind, n);
  setMinigameActorPosition(P, actor, x, depth);
}
// ResetMedallionMatchHitState (0D:5DD6), each point: the streak starts over, every medallion shows again
function resetMedallionMatchHitState(P) {
  P.V.minigameHitStreak = 0;
  for (let i = 0; i < 6; i++) P.bus.w8(ACTORS + i * ACTOR_SIZE + ACT.state, 0);
}
// MedallionMatchTargetActorHandler (0D:5DEE): 0 start, 1 wait for the ball, 2 burst then move along its row, 3 shown
function medallionMatchTargetActorHandler(P) {
  jumpTable(P, B, MedallionMatchStates, scene(P, ACT.state), [
    () => { advanceActorState(P); medallionMatchTargetState1(P); }, () => medallionMatchTargetState1(P),
    () => medallionMatchTargetState2(P), () => drawMedallionMatchSprite(P), () => {},
  ]);
}
function medallionMatchTargetState1(P) {
  drawMedallionMatchSprite(P);
  if (!isBallInSmallHitZone(P)) return;
  awardMedallionMatchHitScore(P);
  advanceActorState(P);
}
function medallionMatchTargetState2(P) {
  drawMedallionMatchHitCountdown(P);
  const t = (scene(P, ACT.timer) - 1) & 0xFF;
  setScene(P, ACT.timer, t);
  if (t) return;
  const depth = P.bus.u16(SCENE_ACTOR + ACT.depth);
  setMinigameActorWorldPos(P, randomTargetX(P), depth);
  advanceActorState(P);
}
// AwardMedallionMatchHitScore (0D:5E9E): 1 point (a smash 2) times the streak's multiplier (1, 5, 30, 70, 150,
// 250); the streak grows without a cap (the table is read on past its end, as the ROM does)
function awardMedallionMatchHitScore(P) {
  const { V } = P;
  setScene(P, ACT.timer, 0x10);
  let points = 1;
  if (V.currentShotType === SHOTTYPE_SMASH) { setScene(P, ACT.timer, 0x20); points = 2; }
  sound(P, rb(P, at(MedallionMatchHitStreakSounds, V.minigameHitStreak)));
  points = mulHLByA(P, points, rb(P, at(MedallionMatchHitStreakMultipliers, V.minigameHitStreak))).hl;
  w16(P, "scorePopupValue", points);
  addToMinigameScore(P, points);
  startScorePopup(P);
  V.minigameHitStreak = (V.minigameHitStreak + 1) & 0xFF;
}
// DrawMedallionMatchSprite (0D:5EF2): the medallion (16x16), spinning (each one a phase apart by its x on screen)
function drawMedallionMatchSprite(P) {
  const p = projectFixedAttr(P);
  const phase = (((P.V.vBlankCounter + P.bus.u8(SCENE_ACTOR + ACT.screen)) & 0xFF) >> 3) & 3;
  queueSprite16(P, p.b, rb(P, at(MedallionMatchSpriteAnimFrames, phase)), p.d, p.e);
}
function drawMedallionMatchHitCountdown(P) {
  const p = projectFixedAttr(P);
  queueMinigameHitBurstFirstTwo(P, scene(P, ACT.timer), p.b, BURST_TILE, p.d, p.e);
}

// ---- the hook tables ----
// a game's mode hooks: [addr, fn] by id (PerFrame, PointStart, PointEnd, MinigameStart, BallHit, Bounce, RallyTick,
// Draw), the ones that are RetStub left out
const MACHINE = { pointEnd: awardMinigamePointAndEnd, rallyTick: keepMinigameCameraFixed, bounce: checkMinigameStartBannerTrigger, ballHit: freezeMinigameOpponentOnReturn };
const WALL = { perFrame: updateMinigameHudAndBallTrail, pointStart: startMinigameSoloPoint, pointEnd: handleMinigamePointEnd, rallyTick: awardMinigamePointAndReflectBall, bounce: stubNop, ballHit: hideLandingMarkerAndExtendSoloCourt };
const ORDER = ["perFrame", "pointStart", "pointEnd", "minigameStart", "ballHit", "bounce", "rallyTick", "draw"];
function game(addrs, fns) {
  // addrs: { init, perFrame, ... }: each hook entry's address (a `call X / ret` or the hook's own code)
  return Object.entries(addrs).map(([k, addr]) => [B, addr, auto(P => fns[k](P))]);
}
const machineGame = (init, start, perFrame, pointStart, slotAddrs) => game(slotAddrs, {
  init, minigameStart: start, perFrame, pointStart, ...MACHINE,
});

export const HOOKS = [
  // The Machine 1-4, Machine Master
  ...machineGame(initTennisMachine(0), startAtSlot(1), drawMinigameScoreHud, machinePointStart(0, 0),
    { init: 0x450A, minigameStart: 0x4525, perFrame: 0x452E, pointStart: 0x4532, pointEnd: 0x4536, rallyTick: 0x453A, bounce: 0x453E, ballHit: 0x4542 }),
  ...machineGame(initTennisMachine(1), startAtSlot(1), drawMinigameScoreHud, machinePointStart(1, 3),
    { init: 0x4969, minigameStart: 0x4984, perFrame: 0x498D, pointStart: 0x4991, pointEnd: 0x49A6, rallyTick: 0x49AA, bounce: 0x49AE, ballHit: 0x49B2 }),
  ...machineGame(initTennisMachine(2), startAtSlot(4), drawMinigameScoreHud, machinePointStart(3, 6),
    { init: 0x49C6, minigameStart: 0x49E1, perFrame: 0x49EA, pointStart: 0x49EE, pointEnd: 0x4A03, rallyTick: 0x4A07, bounce: 0x4A0B, ballHit: 0x4A0F }),
  ...machineGame(initTennisMachine(3), startAtSlot(4), drawMinigameScoreHud, machinePointStart(7, 9),
    { init: 0x4A23, minigameStart: 0x4A3E, perFrame: 0x4A47, pointStart: 0x4A4B, pointEnd: 0x4A60, rallyTick: 0x4A64, bounce: 0x4A68, ballHit: 0x4A6C }),
  ...machineGame(initTennisMachine(4, true), startAtSlot(4), drawMinigameScoreHud, machinePointStart(7, 9),
    { init: 0x4CE9, minigameStart: 0x4D09, perFrame: 0x4D12, pointStart: 0x4D16, pointEnd: 0x4D2B, rallyTick: 0x4D2F, bounce: 0x4D33, ballHit: 0x4D37 }),
  // The Wall 1-4, Wall Master
  ...game({ init: 0x4A80, perFrame: 0x4AA3, pointStart: 0x4AA7, pointEnd: 0x4AAB, rallyTick: 0x4AAF, bounce: 0x4AB3, ballHit: 0x4AB7 }, { init: initWall(0), ...WALL }),
  ...game({ init: 0x4C08, perFrame: 0x4C2B, pointStart: 0x4C2F, pointEnd: 0x4C33, rallyTick: 0x4C37, bounce: 0x4C3B, ballHit: 0x4C3F }, { init: initWall(1), ...WALL }),
  ...game({ init: 0x4C53, perFrame: 0x4C76, pointStart: 0x4C7A, pointEnd: 0x4C7E, rallyTick: 0x4C82, bounce: 0x4C86, ballHit: 0x4C8A }, { init: initWall(2), ...WALL }),
  ...game({ init: 0x4C9E, perFrame: 0x4CC1, pointStart: 0x4CC5, pointEnd: 0x4CC9, rallyTick: 0x4CCD, bounce: 0x4CD1, ballHit: 0x4CD5 }, { init: initWall(3), ...WALL }),
  ...game({ init: 0x4D4B, perFrame: 0x4D73, pointStart: 0x4D77, pointEnd: 0x4D7B, rallyTick: 0x4D7F, bounce: 0x4D83, ballHit: 0x4D87 }, { init: initWall(4, true), ...WALL }),
  // Target Shot
  ...game({ init: 0x4D9B, minigameStart: 0x4DBD, perFrame: 0x4DCB, pointStart: 0x4DD2, pointEnd: 0x4DEA, rallyTick: 0x4DEE, bounce: 0x4DF2, ballHit: 0x4E18 }, {
    init: initTargetShot, minigameStart: startAtSlot(1, P => { P.V.targetZoneEnabled = 1; }),
    perFrame: P => { drawMinigameScoreHud(P); updateScorePopup(P); },
    pointStart: function* (P) { selectRandomMinigameShot(P); stepServeSlot(P, 1, 3); yield* launchMinigameServe(P); },
    pointEnd: endMinigamePoint, rallyTick: keepMinigameCameraFixed, bounce: targetShotBounce, ballHit: freezeMinigameOpponentOnReturn,
  }),
  [B, 0x4E1C, auto(P => updateScorePopup(P))],                                     // UpdateTargetShotScorePopup
  [B, 0x4E20, auto(P => selectRandomMinigameShot(P))],                             // SelectRandomMinigameShot
  [B, 0x4E80, auto(P => checkBallLandedOut(P))],                                   // CheckBallLandedOut
  [B, 0x4E96, auto(P => lookupMinigameShotResult(P))],                             // LookupMinigameShotResult
  // Shooting Star
  ...game({ init: 0x51A4, minigameStart: 0x51C6, perFrame: 0x51D2, draw: 0x51D9, pointStart: 0x51DD, pointEnd: 0x51F5, rallyTick: 0x51F9, bounce: 0x51FD, ballHit: 0x5201 }, {
    init: initShootingStar, minigameStart: function* (P) { initBallTargetActor(P); yield* startAtSlot(1)(P); },
    perFrame: P => { drawMinigameScoreHud(P); updateScorePopup(P); }, draw: updateMinigameActors,
    pointStart: function* (P) { resetTargetHitState(P); stepServeSlot(P, 1, 3); yield* launchMinigameServe(P); },
    pointEnd: endMinigamePoint, rallyTick: keepMinigameCameraFixed, bounce: checkMinigameStartBannerTrigger, ballHit: freezeMinigameOpponentOnReturn,
  }),
  [B, 0x5205, auto(P => initBallTargetActor(P))],                                  // InitBallTargetActor
  [B, 0x521E, auto(P => resetTargetHitState(P))],                                  // ResetTargetHitState
  [B, 0x5231, auto(P => shootingStarTargetActorHandler(P))],                       // ShootingStarTargetActorHandler
  [B, 0x523F, auto(P => advanceActorState(P))],                                    // AdvanceTargetActorState
  [B, 0x5244, auto(P => shootingStarTargetState0(P))],                             // ShootingStarTargetState0
  [B, 0x5262, auto(P => shootingStarTargetState1(P))],                             // ShootingStarTargetState1
  [B, 0x5270, auto(P => shootingStarTargetState2(P))],                             // ShootingStarTargetState2
  [B, 0x528E, auto(P => shootingStarTargetState3(P))],                             // ShootingStarTargetState3
  [B, 0x5292, auto(P => isBallInHitZone(P))],                                      // IsBallInHitZone
  [B, 0x52F9, auto(P => awardHitScore(P))],                                        // AwardHitScore
  [B, 0x535F, auto(P => drawTargetReticleSprite(P))],                              // DrawTargetReticleSprite
  [B, 0x539E, auto(P => drawTargetHitCountdown(P))],                               // DrawTargetHitCountdown
  // Banana Bunch
  ...game({ init: 0x54FC, minigameStart: 0x552B, perFrame: 0x552C, pointStart: 0x5533, pointEnd: 0x5596, rallyTick: 0x559A, bounce: 0x559E, ballHit: 0x55A2 }, {
    init: initFruitWall(5), minigameStart: () => {},
    perFrame: P => { updateMinigameHudAndBallTrail(P); scoreMinigameTargetHitOrDeflectBall(P); },
    pointStart: fruitPointStart(BananaBunchGridLayoutsByLevel), pointEnd: handleMinigamePointEnd,
    rallyTick: reflectBallAndRecordCell, bounce: stubNop, ballHit: hideLandingMarkerAndExtendSoloCourt,
  }),
  [B, 0x55A6, auto(P => scoreMinigameTargetHitOrDeflectBall(P))],                  // UpdateBananaBunchTargetHits
  [B, 0x55AA, auto(P => reflectBallAndRecordCell(P))],                             // BananaBunchReflectBallAndRecordCell
  [B, 0x55B4, auto((P, c) => copyMinigameTilemapBlock(P, c.hl))],                  // CopyMinigameTilemapBlock
  [B, 0x55CA, auto(P => scoreMinigameTargetHitOrDeflectBall(P))],                  // ScoreMinigameTargetHitOrDeflectBall
  // Boo Blast
  ...game({ init: 0x5625, minigameStart: 0x5668, perFrame: 0x566F, draw: 0x5676, pointStart: 0x567A, pointEnd: 0x567E, rallyTick: 0x5685, bounce: 0x5689, ballHit: 0x568D }, {
    init: initBooBlast, minigameStart: P => { initMinigameControllerActor(P); initMinigameScore(P); },
    perFrame: P => { drawMinigameScore(P, 0x84, 0x03); updateScorePopup(P); }, draw: updateMinigameActors,
    pointStart: disableOffscreenArrows,
    pointEnd: function* (P) { disableMinigameControllerActor(P); yield* resolveAndShowMinigamePoint(P); },
    rallyTick: stubNop, bounce: stubNop, ballHit: updateBooBlastHitStreak,
  }),
  [B, 0x5691, auto(P => initMinigameControllerActor(P))],                          // InitMinigameControllerActor
  [B, 0x56AA, auto(P => disableMinigameControllerActor(P))],                       // DisableMinigameControllerActor
  [B, 0x56B0, auto(P => initMinigameScore(P))],                                    // InitBooBlastScore
  [B, 0x56B4, auto(P => drawMinigameScore(P, 0x84, 0x03))],                        // DrawMinigameScoreAtDefaultPos
  [B, 0x56BB, auto(P => disableOffscreenArrows(P))],                               // DisableOffscreenArrows
  [B, 0x56C0, auto(P => resolveAndShowMinigamePoint(P))],                          // ResolveAndShowMinigamePoint
  [B, 0x56EE, auto(stubNop)], [B, 0x56EF, auto(stubNop)],                          // StubNop_0d_1, StubNop_0d_2
  [B, 0x56F0, auto(P => updateBooBlastHitStreak(P))],                              // UpdateBooBlastHitStreak
  [B, 0x5719, auto(P => booBlastControllerActorHandler(P))],                       // BooBlastControllerActorHandler
  [B, 0x5727, auto(P => advanceActorState(P))],                                    // AdvanceMinigameScriptState
  [B, 0x572C, auto(P => { advanceActorState(P); booBlastControllerState1(P); })],  // BooBlastControllerState0
  [B, 0x572F, auto(P => booBlastControllerState1(P))],                             // BooBlastControllerState1
  [B, 0x573D, auto(P => booBlastControllerState2(P))],                             // BooBlastControllerState2
  [B, 0x575B, auto(P => drawBooBlastTargetSprite(P))],                             // BooBlastControllerState3
  [B, 0x575F, auto(P => isBallWithinTargetZone(P))],                               // IsBallWithinTargetZone
  [B, 0x57BE, auto(P => scoreBallHit(P))],                                         // ScoreBallHit
  [B, 0x57FD, auto(P => drawBooBlastTargetSprite(P))],                             // DrawBooBlastTargetSprite
  [B, 0x583C, auto(P => drawBooBlastHitBurst(P))],                                 // DrawBooBlastHitBurst
  [B, 0x5848, auto(P => projectBallSprite(P))],                                    // ProjectBallSprite
  // Perfect Shot
  ...game({ init: 0x587E, perFrame: 0x58B6, pointStart: 0x58BA, pointEnd: 0x58C1, rallyTick: 0x58C5, bounce: 0x58C9, ballHit: 0x58CD }, {
    init: initPerfectShot, perFrame: updateMinigameHudAndBallTrail, pointStart: perfectShotPointStart,
    pointEnd: handleMinigamePointEnd, rallyTick: processTargetTileHit, bounce: stubNop, ballHit: hideLandingMarkerAndExtendSoloCourt,
  }),
  [B, 0x58D1, auto(P => processTargetTileHit(P))],                                 // ProcessTargetTileHit
  [B, 0x5979, auto(P => resetTargetGrid(P))],                                      // ResetTargetGrid
  [B, 0x598B, auto(P => animateTargetGridClear(P))],                               // AnimateTargetGridClear
  [B, 0x59B7, auto(P => areAllTargetsHit(P))],                                     // AreAllTargetsHit
  // Treasure Box
  ...game({ init: 0x59DB, minigameStart: 0x59FD, perFrame: 0x5A17, draw: 0x5A1E, pointStart: 0x5A22, pointEnd: 0x5A3A, rallyTick: 0x5A41, bounce: 0x5A45, ballHit: 0x5A68 }, {
    init: initTreasureBox, minigameStart: treasureBoxMinigameStart,
    perFrame: P => { drawMinigameScoreHud(P); updateScorePopup(P); }, draw: updateMinigameActors,
    pointStart: function* (P) { selectRandomTreasureBoxTargetZone(P); stepServeSlot(P, 1, 3); yield* launchMinigameServe(P); },
    pointEnd: endMinigamePoint,                                                    // (after StubNop_0d_3)
    rallyTick: keepMinigameCameraFixed, bounce: treasureBoxBounce, ballHit: freezeMinigameOpponentOnReturn,
  }),
  [B, 0x5A6C, auto(P => updateScorePopup(P))],                                     // UpdateTreasureBoxScorePopup
  [B, 0x5A70, auto(P => selectRandomTreasureBoxTargetZone(P))],                    // SelectRandomTreasureBoxTargetZone
  [B, 0x5ACB, auto(stubNop)],                                                      // StubNop_0d_3
  [B, 0x5ACC, auto(P => treasureBoxTargetActorHandler(P))],                        // TreasureBoxTargetActorHandler
  [B, 0x5ADA, auto(P => advanceActorState(P))],                                    // AdvanceTreasureBoxActorState
  [B, 0x5ADF, auto(P => treasureBoxTargetState0(P))],                              // TreasureBoxTargetState0
  [B, 0x5B2F, auto(P => treasureBoxTargetState1(P))],                              // TreasureBoxTargetState1
  [B, 0x5B3D, auto(P => treasureBoxTargetState2(P))],                              // TreasureBoxTargetState2
  [B, 0x5B4A, auto(stubNop)],                                                      // TreasureBoxTargetState3
  [B, 0x5BC5, auto(P => isBallInSmallHitZone(P))],                                 // IsBallInTreasureBoxHitZone
  [B, 0x5C2C, auto(P => awardTreasureBoxHitScore(P))],                             // AwardTreasureBoxHitScore
  [B, 0x5C89, auto(P => drawTreasureBoxSprite(P))],                                // DrawTreasureBoxSprite
  [B, 0x5CCB, auto(P => drawTreasureBoxHitCountdown(P))],                          // DrawTreasureBoxHitCountdown
  [B, 0x5CD7, auto(P => projectFixedAttr(P))],                                     // ProjectTreasureBoxWorldPosition
  // Medallion Match
  ...game({ init: 0x5CFA, minigameStart: 0x5D1C, perFrame: 0x5D32, draw: 0x5D39, pointStart: 0x5D3D, pointEnd: 0x5D55, rallyTick: 0x5D59, bounce: 0x5D5D, ballHit: 0x5D61 }, {
    init: initMedallionMatch, minigameStart: medallionMatchMinigameStart,
    perFrame: P => { drawMinigameScoreHud(P); updateScorePopup(P); }, draw: updateMinigameActors,
    pointStart: medallionMatchPointStart, pointEnd: endMinigamePoint, rallyTick: keepMinigameCameraFixed,
    bounce: checkMinigameStartBannerTrigger, ballHit: freezeMinigameOpponentOnReturn,
  }),
  [B, 0x5D65, auto(P => spawnMedallionMatchTargets(P))],                           // SpawnMedallionMatchTargets
  [B, 0x5DBD, auto((P, c) => initMedallionMatchTargetActor(P, c.bc, c.hl, c.de, c.a))],   // InitMedallionMatchTargetActor
  [B, 0x5DD6, auto(P => resetMedallionMatchHitState(P))],                          // ResetMedallionMatchHitState
  [B, 0x5DEE, auto(P => medallionMatchTargetActorHandler(P))],                     // MedallionMatchTargetActorHandler
  [B, 0x5DFC, auto(P => advanceActorState(P))],                                    // AdvanceMedallionMatchActorState
  [B, 0x5E01, auto(P => { advanceActorState(P); medallionMatchTargetState1(P); })],   // MedallionMatchTargetState0
  [B, 0x5E04, auto(P => medallionMatchTargetState1(P))],                           // MedallionMatchTargetState1
  [B, 0x5E12, auto(P => medallionMatchTargetState2(P))],                           // MedallionMatchTargetState2
  [B, 0x5E33, auto(P => drawMedallionMatchSprite(P))],                             // MedallionMatchTargetState3
  [B, 0x5E37, auto(P => isBallInSmallHitZone(P))],                                 // IsBallInMedallionMatchHitZone
  [B, 0x5E9E, auto(P => awardMedallionMatchHitScore(P))],                          // AwardMedallionMatchHitScore
  [B, 0x5EF2, auto(P => drawMedallionMatchSprite(P))],                             // DrawMedallionMatchSprite
  [B, 0x5F13, auto(P => drawMedallionMatchHitCountdown(P))],                       // DrawMedallionMatchHitCountdown
  [B, 0x5F1F, auto(P => projectFixedAttr(P))],                                     // ProjectMedallionMatchWorldPosition
  // Fruit Fantasy
  ...game({ init: 0x5F42, minigameStart: 0x5F71, perFrame: 0x5F72, pointStart: 0x5F79, pointEnd: 0x5FDC, rallyTick: 0x5FE0, bounce: 0x5FE4, ballHit: 0x5FE8 }, {
    init: initFruitWall(6), minigameStart: () => {},
    perFrame: P => { updateMinigameHudAndBallTrail(P); scoreMinigameTargetHitOrDeflectBall(P); },
    pointStart: fruitPointStart(FruitFantasyGridLayoutsByLevel), pointEnd: handleMinigamePointEnd,
    rallyTick: reflectBallAndRecordCell, bounce: stubNop, ballHit: hideLandingMarkerAndExtendSoloCourt,
  }),
  [B, 0x5FEC, auto(P => scoreMinigameTargetHitOrDeflectBall(P))],                  // UpdateFruitFantasyTargetHits
  [B, 0x5FF0, auto(P => reflectBallAndRecordCell(P))],                             // FruitFantasyReflectBallAndRecordCell
];
void ORDER; void copyMinigameTilemapBlockWait; void FLAG_Z; void WRAM_ACTORS; void RETSTUB;
