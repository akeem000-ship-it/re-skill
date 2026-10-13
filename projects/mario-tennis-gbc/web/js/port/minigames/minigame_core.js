// Minigames, the shared part (bank $0D): starting a minigame from its config, the score and its targets, the score
// popup, the grid of target cells (Perfect Shot, Banana Bunch, Fruit Fantasy), the minigame actors (the moving
// targets), the point's end and result; the ball launcher of the tennis-machine games and the wall games' helpers.
// Port of minigame_config_0d.asm, minigame_actors_0d.asm, tennis_0d.asm, the shared routines of wall_0d.asm and
// minigame_targets_0d.asm, and the twins start_drill_from_definition / snap_camera_to of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm), whose names these are.
//
// Two kinds of minigame:
//  - the tennis machine ("The Machine" 1-4, Machine Master, and the Mario minigames that use it: Target Shot,
//    Shooting Star, Treasure Box, Medallion Match): the opponent's place holds a ball launcher (character 1). Each
//    point it fires a ball (LaunchBall) from one of nine slots (MinigameCharCoordsTable, 3 x 3: the level picks how
//    many) at a speed that rises with the balls fired; the player scores by returning it (or by hitting a target).
//    A return the machine "returns" (rally 4 bouncing once) counts as a winner.
//  - the wall (The Wall 1-4, Wall Master, Banana Bunch, Perfect Shot, Fruit Fantasy): the player alone hits the ball
//    against a wall that sends it back (the RallyTick hook reflects it), scoring per return or per target hit.
// A practice level ends when the score reaches its target (POINTOUTCOME_MINIGAME_CLEARED); a "high score" mode
// (Master levels, level 3 of the Mario minigames) plays until the first miss and wins on beating the record.
//
// Covered by web/tests/port/routines_minigames.mjs (the routines that do not wait) and the lockstep on
// out/engine/rec2.mtrec (frames 5765-9814: The Machine, id $12) and out/port/minigame_*.mtrec.
import {
  BANK_MINIGAMES, ROM, far, farWait, sound, pushWramBank, rb, rw, at, put, hook, hookGen, keepRegs, FLAG_Z, FLAG_C,
  POINTOUTCOME, WINLOSE_WIN, WINLOSE_LOSE, MATCHABORT_MATCH, CHARSTATE_STANDBY, CHARSTATE_WALK, CHARSTATE_RALLY,
  CHARANIM_FOREHAND, WRAM_ACTORS, WRAM_TEXT, WRAM_SOUND, WRAM_CHAR1, CHAR, CHAR_UNUSED_15, BGM_NONE, BGM_WIN, BGM_LOSE,
  SFX_COUNTDOWN, SFX_COUNTDOWN_GO, SFX_BALL_LAUNCH, MINIGAME_TENNIS_MACHINE_1, MINIGAME_TENNIS_MACHINE_HIGH_SCORE,
  MINIGAME_BOO_BLAST, FARPTR_EXECUTE_SHOT,
} from "./common.js";
import { startDrillFromDefinition } from "./drills.js";
import { clearMemory16, copyMemoryFast, copyMemoryBC, queueVRAMCopy } from "../home/memory.js";
import { copyTextRect, tickTimer } from "../home/ui.js";
import { queueSprite } from "../home/fade.js";
import { divAHLByE, divHLByDE } from "../home/math.js";

const B = BANK_MINIGAMES;
// ROM tables of this bank
const MinigameConfigTable = 0x4090;            // minigame id - $12 -> its config (a drill definition)
const MinigameRecordSlotIds = 0x4116;          // high-score minigame (id - $1A) -> its record slot
const MinigamePracticeTargetScores = 0x414A;   // by id - $12 (words; read past its end for the later ids, as the ROM does)
const MinigameTargetScores = 0x415E;           // Mario minigames: by (id - $1C) * 4 + level
const MinigameDefaultRecordValuePointers = 0x41B5;
const MinigameGridCellTiles = 0x427F, MinigameGridCellAttrs = 0x429F;      // 2x2 tiles / attributes by cell type
const MinigameGridCellTilemapOffsets = 0x4373; // cell 0-23 -> its offset in the court planes
const EndMinigamePoint_PointOutcomeTable = 0x4547;   // by serve speed * 4: the tempo row (one byte; the ROM reads on)
const LaunchBallTable = 0x4548;                // by serve speed * 4: the shot speed index + 1
const MinigameShotDifficultyRamp = 0x4546;     // by serve speed * 4: which aim pool (one byte; the ROM reads on)
const MinigameShotIntervalByTempo = 0x45AE;    // frames to wait after a returned ball
const MinigameShotAimPools = 0x45B3;           // 16-byte pools of shot buttons (button 1 << 4 | button 2)
const MinigameShotSpinPool = 0x4643;           // the launcher's aim offset
const MinigameCharCoordsTable = 0x464B;        // the launcher's nine slots [x, depth]
const MinigameBallLaunchHeights = 0x466F, MinigameBallLaunchSpeeds = 0x4675;   // by slot row (serve group)
const TargetShotZoneOverlayTiles = 0x4F06, TargetShotZoneOverlayAttrs = 0x5000, TargetShotZoneOverlayOffsets = 0x513A;
const MinigameTargetZoneBounds = 0x515C;       // target zone rectangles (8 bytes: x1, depth1, x2, depth2)
const MinigameTargetSpriteOamAttrByHitStreak = 0x53C6, MinigameHitBurstParticleOffsets = 0x542C;
// RAM in the actors' bank (WRAM 4)
export const ACTORS = 0xDC00, ACTOR_SIZE = 0x10, ACTOR_COUNT = 7, SCENE_ACTOR = 0xDC70;
// a minigame actor: +0 flags (bit 0 active), +1 kind, +2 state, +3 timer, +6 world x, +8 world depth, +10/+12 the
// projected screen position (ProjectWorldToScreen's hl, bc), +14 its handler
export const ACT = { flags: 0, kind: 1, state: 2, timer: 3, x: 6, depth: 8, screen: 10, screenY: 12, handler: 14 };
const BALL_HISTORY = 0xDD00, BALL_TRAIL_SLOTS = 0xDE0C;
const LANDING_SPOT = BALL_HISTORY + 30;        // wBallHistory + 30: the ball's last landing spot [x, depth]
// court planes (WRAM 2)
const COURT_TILEMAP = 0xD000, COURT_ATTRMAP = 0xD400, COURT_TILEMAP_SAVED = 0xD800, COURT_ATTRMAP_SAVED = 0xDC00;
const HUD_ROW = 9 * 32, VBGMAP0 = 0x9800, VRAM_BANK1 = 0x2000;
const MAX_SCORE = 9999;                        // $270F (the score's cap; `add $d8f1` tests for it)
const SCORE_POPUP_FRAMES = 0x10;
const CHAR_CENTRE_DEPTH = 0x0480;              // the player's spot facing the machine (x 0)

const u16 = (P, name) => P.bus.u16(P.A[name]);
const w16 = (P, name, v) => P.bus.w16(P.A[name], v);
const hl = v => ({ h: (v >> 8) & 0xFF, l: v & 0xFF });
const de = v => ({ d: (v >> 8) & 0xFF, e: v & 0xFF });
const bc = v => ({ b: (v >> 8) & 0xFF, c: v & 0xFF });

// ---- starting a minigame (minigame_config_0d) ----
// StartMinigameByID (0D:407F, export $4000), a = minigame id $12-$23: InitMinigameFromConfig with its config
export function* startMinigameByID(P, id) {
  const entry = (MinigameConfigTable + ((id - MINIGAME_TENNIS_MACHINE_1) & 0xFF) * 2) & 0xFFFF;
  yield* startDrillFromDefinition(P, rw(P, entry));            // InitMinigameFromConfig (0D:4006): the same code
}
// InitMinigameScore (0D:40CF): score and balls fired 0, the target score for the minigame and level; for the
// high-score minigames ($1A on) the record to beat (wMinigameHighScore) from the save's records.
export function initMinigameScore(P) {
  const { V } = P;
  w16(P, "minigamesCurrentScore", 0);
  w16(P, "minigameServeCount", 0);
  const id = P.bus.u8(P.A.currentMinigameStoryMatch + 1);
  w16(P, "minigamesTargetScore", getMinigameTargetScore(P, id, V.minigameLevel).de);
  if (id < MINIGAME_TENNIS_MACHINE_HIGH_SCORE) return;
  const slot = rb(P, at(MinigameRecordSlotIds, id - MINIGAME_TENNIS_MACHINE_HIGH_SCORE));
  far(P, ROM.ReadMinigameRecord, { a: slot });
  const old = pushWramBank(P, WRAM_SOUND);
  P.bus.w8(P.A.minigameHighScore, P.bus.u8(P.A.minigameRecordValue));
  P.bus.w8(P.A.minigameHighScore + 1, P.bus.u8(P.A.minigameRecordValue + 1));
  P.wramBank(old);
}
// GetMinigameTargetScore (0D:4121), a = minigame id, b = level: de = the score that clears it (0 below $12)
export function getMinigameTargetScore(P, id, level) {
  if (id < MINIGAME_TENNIS_MACHINE_1) return { de: 0, a: id, f: FLAG_C };
  let entry;
  if (id < MINIGAME_BOO_BLAST) entry = at(MinigamePracticeTargetScores, (id - MINIGAME_TENNIS_MACHINE_1) * 2);
  else entry = at(MinigameTargetScores, ((((id - MINIGAME_BOO_BLAST) * 4) & 0xFF) + level) * 2);
  const v = rw(P, entry);
  return { de: v, a: v & 0xFF, hl: (entry + 1) & 0xFFFF };
}
// GetDefaultMinigameRecordValue (0D:41A6, export $4002), a = record slot: de = its default (a fresh save's record)
export function getDefaultMinigameRecordValue(P, slot) {
  const ptr = rw(P, at(MinigameDefaultRecordValuePointers, slot * 2));
  const v = rw(P, ptr);
  return { de: v, a: v & 0xFF, hl: (ptr + 1) & 0xFFFF };
}
// IncrementCappedCounter (0D:41CB), b = the cap: wMinigameHitStreak + 1 up to b
export function incrementCappedCounter(P, cap) {
  if (P.V.minigameHitStreak < cap) P.V.minigameHitStreak = (P.V.minigameHitStreak + 1) & 0xFF;
}
// IsMinigameTargetReached (0D:41D3): 1 when the score has reached the target score (signed compare)
export function isMinigameTargetReached(P) {
  const d = (u16(P, "minigamesCurrentScore") - u16(P, "minigamesTargetScore")) & 0xFFFF;
  return d & 0x8000 ? 0 : 1;
}
// IsMinigameScoreLimitReached (0D:41EE): 1 when the score is at its cap (9999) or above the record
export function isMinigameScoreLimitReached(P) {
  const score = u16(P, "minigamesCurrentScore");
  if (score === MAX_SCORE) return 1;
  return (u16(P, "minigameHighScore") - score) & 0x8000 ? 1 : 0;
}
// StartScorePopup (0D:4211): the points just scored rise from the ball's landing spot for 16 frames
export function startScorePopup(P) {
  const old = pushWramBank(P, WRAM_ACTORS);
  for (let i = 0; i < 4; i++) P.bus.w8(P.A.scorePopupSource + i, P.bus.u8(LANDING_SPOT + i));
  P.wramBank(old);
  P.V.scorePopupTimer = SCORE_POPUP_FRAMES;
}
// UpdateScorePopup (0D:4237), every frame: while the popup runs, its number (wScorePopupValue) in sprites over
// the spot, rising as the timer runs down
export function updateScorePopup(P) {
  if (!P.V.scorePopupTimer) return;
  tickTimer(P, P.A.scorePopupTimer);
  const src = P.A.scorePopupSource;
  const r = far(P, ROM.ApplyCameraProjection, { ...hl(P.bus.u16(src)), ...bc(P.bus.u16(src + 2)) });
  const y = (P.V.scorePopupTimer + r.e + 0xE8) & 0xFF;
  far(P, ROM.DrawNumberWithSprites, { ...hl(P.bus.u16(P.A.scorePopupValue)), b: 1, a: 1, e: y });
}
// AddToMinigameScore (0D:4266), de = points: the score + de, capped at 9999. Returns de, the new score.
export function addToMinigameScore(P, points) {
  let v = (u16(P, "minigamesCurrentScore") + points) & 0xFFFF;
  if (v >= MAX_SCORE) v = MAX_SCORE;
  w16(P, "minigamesCurrentScore", v);
  return v;
}
// GetMinigameGridCellIndex (0D:42BF): the grid cell (8 x 3, 0-23) under the ball's landing spot, $FF if none
export function getMinigameGridCellIndex(P) {
  const old = pushWramBank(P, WRAM_ACTORS);
  const xHi = P.bus.u8(LANDING_SPOT + 1), depthHi = P.bus.u8(LANDING_SPOT + 3);
  P.wramBank(old);
  const col = ((((xHi + 0x0F) & 0xFF) | 1) - 9 & 0xFF) >> 1;
  if (col >= 7) return 0xFF;
  const row = ((((depthHi + 0x10) & 0xFE) - 8) & 0xFF) >> 1;
  if (row >= 3) return 0xFF;
  return (row * 8 + col) & 0xFF;
}
// DrawMinigameGrid (0D:4302): draw every non-empty cell of wMinigameTargetGrid (24 cells, the type in each)
export function drawMinigameGrid(P) {
  for (let cell = 0; cell < 0x18; cell++) {
    const type = P.bus.u8(P.A.minigameTargetGrid + cell);
    if (type) drawMinigameGridCell(P, cell, type);
  }
}
// DrawMinigameGridCell (0D:431B), a = cell, b = type: its 2x2 tiles and attributes into the court planes and their
// saved copies (WRAM 2, mapped by the caller)
export function drawMinigameGridCell(P, cell, type) {
  const off = rw(P, at(MinigameGridCellTilemapOffsets, cell * 2));
  const tiles = at(MinigameGridCellTiles, type * 4), attrs = at(MinigameGridCellAttrs, type * 4);
  const plane = base => ((((off >> 8) + (base >> 8)) & 0xFF) << 8) | (off & 0xFF);
  copyTextRect(P, tiles, plane(COURT_TILEMAP_SAVED), 2, 2);
  copyTextRect(P, tiles, plane(COURT_TILEMAP), 2, 2);
  copyTextRect(P, attrs, plane(COURT_ATTRMAP_SAVED), 2, 2);
  copyTextRect(P, attrs, plane(COURT_ATTRMAP), 2, 2);
}
// QueueMinigameHudVRAMCopy (0D:43A3): the court planes' rows 9-13 (the target overlay) to BG map 0
export function queueMinigameHudVRAMCopy(P) {
  queueVRAMCopy(P, COURT_TILEMAP + HUD_ROW, VBGMAP0 + HUD_ROW, 5 * 32 / 16);
  queueVRAMCopy(P, COURT_ATTRMAP + HUD_ROW, VBGMAP0 + HUD_ROW + VRAM_BANK1, 5 * 32 / 16);
}

// ---- the point's end and result (minigame_actors_0d) ----
// ShowPointOutcomeBanner (0D:43BA): the outcome's court banner for a moment ("OUT", "NET", ...), except after a
// winner, a ball that hit a player, or the minigame cleared
export function* showPointOutcomeBanner(P) {
  const o = P.V.pointOutcome;
  if (o === POINTOUTCOME.WINNER || o === POINTOUTCOME.BALL_HIT_PLAYER || o === POINTOUTCOME.MINIGAME_CLEARED) return;
  yield* farWait(P, ROM.ShowCourtBanner, { a: o });
  yield* farWait(P, ROM.StepMatchFrames, { a: 30 });
  yield* farWait(P, ROM.HideCourtBanner);
  yield* farWait(P, ROM.StepMatchFrames, { a: 10 });
}
// DetermineMinigamePointResult (0D:43DF): won or lost, and the result banner (d): the level's "clear" banner
// ($12 + level) when the target score was reached, "new record" ($16) when a high-score run beat the record,
// "try again" ($17) otherwise
export function determineMinigamePointResult(P) {
  const { V } = P;
  let won, banner;
  if (V.minigameHighScoreMode) { won = isMinigameScoreLimitReached(P); banner = won ? 0x16 : 0x17; }
  else if (V.pointOutcome === POINTOUTCOME.MINIGAME_CLEARED) { won = 1; banner = (V.minigameLevel + 0x12) & 0xFF; }
  else { won = 0; banner = 0x17; }
  V.pointWinLoseFlag = won ? WINLOSE_WIN : WINLOSE_LOSE;
  return { d: banner, a: won && !V.minigameHighScoreMode ? banner : won ? WINLOSE_WIN : WINLOSE_LOSE };
}
// ShowMinigamePointResult (0D:4412, export $4004; also the match engine's for a Mario minigame), d = the banner:
// the win or lose jingle, the banner until a button (after 55 frames), then the match ends
export function* showMinigamePointResult(P, banner) {
  sound(P, P.V.pointWinLoseFlag & 0x80 ? BGM_LOSE : BGM_WIN);
  yield* farWait(P, ROM.StepMatchFrame);
  yield* farWait(P, ROM.ShowCourtBanner, { a: banner, d: banner });
  yield* farWait(P, ROM.StepMatchFrames, { a: 10 });
  yield* farWait(P, ROM.StepMatchFramesSkippable, { a: 0x2D });
  yield* farWait(P, ROM.RunMatchFramesUntilInput);
  yield* farWait(P, ROM.HideCourtBanner);
  yield* farWait(P, ROM.StepMatchFrames, { a: 15 });
  P.V.matchAbortFlag = MATCHABORT_MATCH;
}

// ---- minigame actors ----
// ClearMinigameActors (0D:4440): all seven actors free (leaves WRAM 4 mapped)
export function clearMinigameActors(P) {
  P.wramBank(WRAM_ACTORS);
  clearMemory16(P, ACTORS, ACTOR_COUNT * ACTOR_SIZE / 16);
}
// SetMinigameActorHandler (0D:444F), bc = actor, de = handler: active with that handler (leaves WRAM 4 mapped)
export function setMinigameActorHandler(P, actor, handler) {
  P.wramBank(WRAM_ACTORS);
  P.bus.w16(actor + ACT.handler, handler);
  P.bus.w8(actor, P.bus.u8(actor) | 3);
}
// SetMinigameActorPosition (0D:4465), bc = actor, hl = x, de = depth: its world position and its projection
// (leaves WRAM 4 mapped)
export function setMinigameActorPosition(P, actor, x, depth) {
  P.wramBank(WRAM_ACTORS);
  P.bus.w16(actor + ACT.depth, depth);
  P.bus.w16(actor + ACT.x, x);
  const r = far(P, ROM.ProjectWorldToScreen_08, { ...hl(x), ...de(depth), b: 0, c: 0 });
  P.bus.w16(actor + ACT.screenY, r.bc);
  P.bus.w16(actor + ACT.screen, r.hl);
  return { bc: actor, de: r.hl, hl: (actor + ACT.screen + 1) & 0xFFFF };
}
// SetMinigameActorWorldPos (0D:449A), hl = x, de = depth: the same for the actor being updated (wMinigameSceneActor)
export function setMinigameActorWorldPos(P, x, depth) {
  P.bus.w16(SCENE_ACTOR + ACT.x, x);
  P.bus.w16(SCENE_ACTOR + ACT.depth, depth);
  const r = far(P, ROM.ProjectWorldToScreen_08, { ...hl(x), ...de(depth), b: 0, c: 0 });
  P.bus.w16(SCENE_ACTOR + ACT.screen, r.hl);
  P.bus.w16(SCENE_ACTOR + ACT.screenY, r.bc);
}
// UpdateMinigameActors (0D:44BD), the Draw hook: each active actor runs its handler (WRAM 4 left mapped)
export function updateMinigameActors(P) {
  P.wramBank(WRAM_ACTORS);
  for (let i = 0; i < ACTOR_COUNT; i++) updateMinigameActor(P, ACTORS + i * ACTOR_SIZE);
}
// UpdateMinigameActor (0D:44D3), hl = actor: copied to wMinigameSceneActor, its handler run on the copy (an
// indirect call: the port's hook or the ROM's code there), copied back. All registers kept.
export function updateMinigameActor(P, actor) {
  if (!(P.bus.u8(actor) & 1)) return;
  copyMemoryFast(P, actor, SCENE_ACTOR, 1);
  const handler = P.bus.u16(SCENE_ACTOR + ACT.handler);
  far(P, [P.V.romBank, handler], { a: handler & 0xFF, ...hl(handler) });
  copyMemoryFast(P, SCENE_ACTOR, actor, 1);
}
// The scene actor's fields (the actor being updated)
export const scene = (P, field) => P.bus.u8(SCENE_ACTOR + field);
export const setScene = (P, field, v) => P.bus.w8(SCENE_ACTOR + field, v);
// AdvanceTargetActorState (0D:523F) and its copies for each game: the scene actor's next state
export function advanceActorState(P) { setScene(P, ACT.state, (scene(P, ACT.state) + 1) & 0xFF); }
// an actor's rst $00 on its state (the table after it); states past the cases run as the ROM does
export { jumpTable } from "./common.js";

// ---- the tennis machine (minigame_actors_0d / tennis_0d) ----
// StartMinigameMatch (0D:4678), the MinigameStart hook of the machine games: score set up, camera fixed on the
// court, the court's limits, the player at the centre spot, the machine walking to its first slot (a machine with
// no character, CHAR_UNUSED_15, launches at once: wMinigameServeState 1), then the countdown.
export function* startMinigameMatch(P) {
  initMinigameScore(P);
  snapCameraTo(P, 0x0000, 0xFE00);
  w16(P, "courtLimitDepth", 0xFB20);
  w16(P, "courtLimitX", 0xFE50);
  P.wramBank(WRAM_ACTORS);
  far(P, ROM.SetCharPosAndTarget, { ...hl(0), ...de(CHAR_CENTRE_DEPTH) });
  far(P, ROM.SetCharState, { a: CHARSTATE_STANDBY });
  P.wramBank(WRAM_CHAR1);
  const slot = getMinigameCharCoordsEntry(P, P.V.minigameServeSlot);
  far(P, ROM.SetCharPosAndTarget, { ...hl(slot.hl), ...de(slot.de), ...bc(slot.hl), a: slot.de >> 8 });
  far(P, ROM.SetCharState, { a: CHARSTATE_WALK });
  P.bus.w8(CHAR.aimJitterScale, 4);
  P.V.minigameServeState = P.bus.u8(CHAR.id) === CHAR_UNUSED_15 ? 1 : 0;
  yield* playMinigameCountdown(P);
}
// DrawMinigameScoreHud (0D:46D7), the PerFrame hook of the machine games: the score at the top; with a ball
// launcher, the machine's sprite slot shown in front (bit 5 of its attribute off)
export function drawMinigameScoreHud(P) {
  drawMinigameScore(P, 0x84, 0x03);
  if (!P.V.minigameServeState) return;
  const old = pushWramBank(P, WRAM_CHAR1);
  P.bus.w8(CHAR.spriteSlot + 1, P.bus.u8(CHAR.spriteSlot + 1) & ~0x20);
  P.wramBank(old);
}
// DrawMinigameScore (0D:4BEA), de = position: the score in sprite digits (4 of them)
export function drawMinigameScore(P, x, y) {
  far(P, ROM.DrawNumberWithSprites, { ...hl(u16(P, "minigamesCurrentScore")), b: 1, a: 4, d: x, e: y });
}
// LaunchMinigameServe (0D:46F7), the PointStart hook's work: the speed for this ball (balls fired / 10, 25 from
// 256 balls on), the machine's swing (with a launcher, a 15-frame wind-up), the ball fired, the serve group (the
// slot's row) and the machine's walk to its slot.
export function* launchMinigameServe(P) {
  const { V } = P;
  const count = u16(P, "minigameServeCount");
  const speed = count >> 8 ? 0x19 : divAHLByE(P, 0, count & 0xFF, 10).hl & 0xFF;
  V.minigameServeSpeed = speed;
  let old = pushWramBank(P, WRAM_TEXT);
  far(P, ROM.SetCharAnimation, { d: CHARANIM_FOREHAND, b: speed });
  P.wramBank(old);
  if (V.minigameServeState) yield* farWait(P, ROM.StepMatchFrames, { a: 15 });
  w16(P, "minigameServeCount", (u16(P, "minigameServeCount") + 1) & 0xFFFF);
  launchBall(P);
  V.minigameServeGroup = divHLByDE(P, V.minigameServeSlot, 3) & 0xFF;
  applyMinigameCharTargetFromTable(P);
}
// AwardMinigamePointAndEnd (0D:4751), the PointEnd hook of The Machine: a point for a ball the player won, then
// EndMinigamePoint
export function* awardMinigamePointAndEnd(P) {
  if (!(far(P, ROM.ResolvePointWinner).a & 0x80)) addToMinigameScore(P, 1);
  yield* endMinigamePoint(P);
}
// EndMinigamePoint (0D:475D): the player stands; the outcome banner; a ball the player won leads to the next one
// after the tempo's pause unless the target score is reached; a lost ball (or the target reached) ends the
// minigame: the result, both characters' reactions, the result banner.
export function* endMinigamePoint(P) {
  const { V } = P;
  let old = pushWramBank(P, WRAM_ACTORS);
  far(P, ROM.SetCharState, { a: CHARSTATE_STANDBY });
  P.wramBank(old);
  yield* showPointOutcomeBanner(P);
  if (!(far(P, ROM.ResolvePointWinner).a & 0x80)) {
    const tempo = rb(P, at(EndMinigamePoint_PointOutcomeTable, V.minigameServeSpeed * 4));
    yield* farWait(P, ROM.StepMatchFrames, { a: rb(P, at(MinigameShotIntervalByTempo, tempo)) });
    if (!isMinigameTargetReached(P)) return;
    V.pointOutcome = POINTOUTCOME.MINIGAME_CLEARED;
  }
  const r = determineMinigamePointResult(P);
  old = pushWramBank(P, WRAM_ACTORS);
  yield* farWait(P, ROM.CharPointEndReaction);
  P.wramBank(WRAM_TEXT);
  yield* farWait(P, ROM.CharPointEndReaction);
  P.wramBank(old);
  yield* showMinigamePointResult(P, r.d);
}
// KeepMinigameCameraFixed (0D:47BE), the RallyTick hook: the camera does not follow the ball
export function keepMinigameCameraFixed(P) { P.V.cameraFollowBall = 0; }
// CheckMinigameStartBannerTrigger (0D:47C3), the Bounce hook: the player's return bouncing on the machine's side
// (rally 4, first bounce) is a winner for the player
export function checkMinigameStartBannerTrigger(P) {
  const { V } = P;
  if (V.pointOutcome || V.rallyLength !== 4 || V.ballBounceCount !== 1) return;
  V.pointOutcome = POINTOUTCOME.WINNER;
  V.pointOutcomeSide = 1;
}
// FreezeMinigameOpponentOnReturn (0D:47E2), the BallHit hook: when the player returns the ball (rally 3), the
// machine stays put for 40 frames
export function freezeMinigameOpponentOnReturn(P) {
  if (P.V.rallyLength !== 3) return;
  const old = pushWramBank(P, WRAM_CHAR1);
  P.bus.w8(CHAR.freezeTimer, 0x28);
  P.wramBank(old);
}
// LaunchBall (0D:47FD): the machine (character 1) fires: ball, shadow and trail on, the rally at 2 (the "serve" is
// the machine's return), its shot speed and placement from the speed, its shot buttons drawn from the aim pool,
// the shot type they make, the launch height and power by the serve group, the ball at the machine, a random spin,
// then the shot itself (ExecuteShot through FarCallVector) and the launch sound.
export function launchBall(P) {
  const { V, bus } = P;
  V.ballSpriteEnabled = 1; V.ballShadowEnabled = 1; V.ballTrailEnabled = 1;
  V.rallyLength = 2;
  V.ballCourtQuadrant = 2;
  const old = pushWramBank(P, WRAM_TEXT);
  bus.w8(CHAR.swingFrames, 0x20);
  const speed4 = (V.minigameServeSpeed * 4) & 0xFF;
  const shotSpeed = (rb(P, at(LaunchBallTable, speed4)) - 1) & 0xFF;
  bus.w8(CHAR.groundStrokeSpeedIndex, shotSpeed);
  bus.w8(CHAR.reachSpeedIndex, shotSpeed);
  bus.w8(CHAR.slicePlacementIndex, shotSpeed);
  bus.w8(CHAR.topspinPlacementIndex, shotSpeed);
  const pool = at(MinigameShotAimPools, (rb(P, at(MinigameShotDifficultyRamp, speed4)) * 16) & 0xFF);
  const buttons = rb(P, at(pool, far(P, ROM.AdvanceMatchRng).a & 0x0F));
  bus.w8(CHAR.shotButton1, buttons >> 4);
  bus.w8(CHAR.shotButton2, buttons & 0x0F);
  far(P, ROM.SelectRallyShotType);
  const group = V.minigameServeGroup;
  bus.w8(CHAR.aimOffsetScale, rb(P, at(MinigameBallLaunchSpeeds, group)));
  const height = rw(P, at(MinigameBallLaunchHeights, group * 2));
  far(P, ROM.SetBallPosition, { ...hl(bus.u16(CHAR.posX + 1)), ...de(bus.u16(CHAR.posDepth + 1)), ...bc(height) });
  bus.w8(CHAR.aimOffset, rb(P, at(MinigameShotSpinPool, far(P, ROM.AdvanceMatchRng).a & 0x07)));
  far(P, ROM.FarCallVector, hl(FARPTR_EXECUTE_SHOT));
  sound(P, SFX_BALL_LAUNCH);
  P.wramBank(old);
}
// ApplyMinigameCharTargetFromTable (0D:48B6): the machine walks to its slot
export function applyMinigameCharTargetFromTable(P) {
  const old = pushWramBank(P, WRAM_TEXT);
  const slot = getMinigameCharCoordsEntry(P, P.V.minigameServeSlot);
  far(P, ROM.SetCharTarget, { ...hl(slot.hl), ...de(slot.de), ...bc(slot.hl), a: slot.de >> 8 });
  P.wramBank(old);
}
// PlayMinigameCountdown (0D:48CE): the music stops; "3", "2", "1" (each with its beep, 40 frames), "GO!", then
// the music again (all silent when the frames are being skipped). Leaves WRAM 4 mapped.
export function* playMinigameCountdown(P) {
  const { V } = P;
  P.wramBank(WRAM_ACTORS);
  V.pauseDisabled = 0;
  const bgm = V.currentBGM;
  sound(P, BGM_NONE);
  yield* farWait(P, ROM.StepMatchFrames, { a: 20 });
  for (let digit = 3; digit > 0; digit--) {
    yield* farWait(P, ROM.LoadScoreDigitGfx, { a: digit, b: 1, d: 0x82, e: 0x00 });   // into vTiles0 tile $20
    if (!V.matchFramesAbort) sound(P, SFX_COUNTDOWN);
    yield* farWait(P, ROM.SpawnCourtBannerObj, { a: 0x11 });
    yield* farWait(P, ROM.StepMatchFrames, { a: 40 });
  }
  if (!V.matchFramesAbort) sound(P, SFX_COUNTDOWN_GO);
  yield* farWait(P, ROM.ShowCourtBanner, { a: 0x10 });
  yield* farWait(P, ROM.StepMatchFrames, { a: 40 });
  yield* farWait(P, ROM.HideCourtBanner);
  if (!V.matchFramesAbort) sound(P, bgm);
}
// GetMinigameCharCoordsEntry (0D:4926), a = slot: hl = its x, de = its depth
export function getMinigameCharCoordsEntry(P, slot) {
  const rec = at(MinigameCharCoordsTable, slot * 4);
  return { hl: rw(P, rec), de: rw(P, rec + 2) };
}
// SnapCameraTo_0d (0D:493A), hl = x, de = y: the camera there now (and its target), not following the ball
export function snapCameraTo(P, x, y) {
  w16(P, "matchCameraX", x); w16(P, "matchCameraTargetX", x);
  w16(P, "matchCameraY", y); w16(P, "matchCameraTargetY", y);
  P.V.cameraFollowBall = 0;
}

// ---- the wall (tennis_0d / wall_0d) ----
// UpdateMinigameHudAndBallTrail (0D:4ABB), the PerFrame hook of the wall games: the score (until the result is
// decided), and the ball trail's sprites hidden where the ball is behind the wall (depth past -$1A0)
export function updateMinigameHudAndBallTrail(P) {
  if (!P.V.pointWinLoseFlag) drawMinigameScore(P, 0x84, 0x84);
  const old = pushWramBank(P, WRAM_ACTORS);
  markMinigameObjectOffscreen(P, BALL_HISTORY + 12, BALL_TRAIL_SLOTS + 8);
  markMinigameObjectOffscreen(P, BALL_HISTORY + 6, BALL_TRAIL_SLOTS + 12);
  markMinigameObjectOffscreen(P, BALL_HISTORY, BALL_TRAIL_SLOTS + 16);
  P.wramBank(old);
}
// MarkMinigameObjectOffscreen (0D:4AF1), hl = a ball-history record, de = its trail sprite: hidden ($FF) when
// the record's depth is past the wall
export function markMinigameObjectOffscreen(P, rec, sprite) {
  const depth = P.bus.u16(rec + 2);
  if (((depth + 0xFE60) & 0xFFFF) & 0x8000) P.bus.w8(sprite, 0xFF);
}
// StartMinigameSoloPoint (0D:4B01), the PointStart hook of the wall games: score set up, no standing shadows, no
// net, the player at its spot
export function startMinigameSoloPoint(P) {
  initMinigameScore(P);
  P.V.standingShadowsEnabled = 0;
  w16(P, "netHeight", 0);
  const old = pushWramBank(P, WRAM_ACTORS);
  far(P, ROM.SetCharPosAndTarget, { ...hl(0), ...de(0x04E0) });
  P.wramBank(old);
}
// HandleMinigamePointEnd (0D:4B29), the PointEnd hook of the wall games: the miss ends the minigame: banner,
// result, the player's reaction, the result banner
export function* handleMinigamePointEnd(P) {
  let old = pushWramBank(P, WRAM_ACTORS);
  far(P, ROM.SetCharState, { a: CHARSTATE_STANDBY });
  P.wramBank(old);
  yield* showPointOutcomeBanner(P);
  const r = determineMinigamePointResult(P);
  old = pushWramBank(P, WRAM_ACTORS);
  yield* farWait(P, ROM.CharPointEndReaction);
  P.wramBank(old);
  yield* showMinigamePointResult(P, r.d);
}
// AwardMinigamePointAndReflectBall (0D:4B59), the RallyTick hook of The Wall: the ball reached the wall: a point
// (the target score reached clears the minigame), then ReflectBallVelocity
export function awardMinigamePointAndReflectBall(P) {
  if (!P.V.pointOutcome) {
    addToMinigameScore(P, 1);
    if (isMinigameTargetReached(P)) P.V.pointOutcome = POINTOUTCOME.MINIGAME_CLEARED;
  }
  reflectBallVelocity(P);
}
// ReflectBallVelocity (0D:4B70): the wall sends the ball back: the camera follows it, a bounce effect, no bounces
// yet, the other half of the court, depth and depth velocity negated (one's complement), the velocity slowed to
// $E6/256; while the point goes on the player is in rally state again.
export function reflectBallVelocity(P) {
  const { V, bus } = P;
  V.cameraFollowBall = 1;
  far(P, ROM.StartBounceEffect);
  V.ballBounceCount = 0;
  V.ballQuadrantAtHit ^= 2;
  for (let i = 0; i < 4; i++) bus.w8(P.A.ballDepthFrac + i, ~bus.u8(P.A.ballDepthFrac + i));
  const vel = P.A.ballVelocityDepthFrac;
  for (let i = 0; i < 3; i++) bus.w8(vel + i, ~bus.u8(vel + i));
  const r = far(P, ROM.MulMem24ByFrac, { ...hl(vel), b: 0xE6 });
  bus.w8(vel, r.a); bus.w8(vel + 1, r.e); bus.w8(vel + 2, r.d);
  if (V.pointOutcome) return;
  const old = pushWramBank(P, WRAM_ACTORS);
  far(P, ROM.SetCharState, { a: CHARSTATE_RALLY });
  P.wramBank(old);
}
// StubNop_0d_0 (0D:4BC7): the wall games' Bounce hook
export function stubNop() {}
// HideLandingMarkerAndExtendSoloCourt (0D:4BC8), the BallHit hook of the wall games: no landing marker; at the
// player's first hit the court's far limits open up and the rally counts on from 2
export function hideLandingMarkerAndExtendSoloCourt(P) {
  P.V.landingMarkerActive = 0;
  if (P.V.rallyLength !== 1) return;
  w16(P, "courtLimitDepth", 0xFB20);
  w16(P, "courtLimitX", 0xFE50);
  P.V.rallyLength = 2;
}

// ---- target zones and sprite bursts (minigame_targets_0d) ----
// LoadMatchUiCourtTilemap (0D:50FA), a = target zone: its 10x5 overlay (Target Shot's zone markings) into the
// court planes and their saved copies (WRAM 2 mapped)
export function loadMatchUiCourtTilemap(P, zone) {
  const off = rw(P, at(TargetShotZoneOverlayOffsets, zone * 2));
  const attrs = (TargetShotZoneOverlayAttrs + off) & 0xFFFF, tiles = (TargetShotZoneOverlayTiles + off) & 0xFFFF;
  const spot = HUD_ROW + 11;
  copyTextRect(P, tiles, COURT_TILEMAP_SAVED + spot, 10, 5);
  copyTextRect(P, tiles, COURT_TILEMAP + spot, 10, 5);
  copyTextRect(P, attrs, COURT_ATTRMAP_SAVED + spot, 10, 5);
  copyTextRect(P, attrs, COURT_ATTRMAP + spot, 10, 5);
}
// LoadTargetZoneConfig (0D:5148), a = target zone: its rectangle into wTargetZoneX1..
export function loadTargetZoneConfig(P, zone) {
  copyMemoryBC(P, at(MinigameTargetZoneBounds, zone * 8), P.A.targetZoneX1, 8);
}
// ProjectMinigameWorldPosition (0D:53AA): the scene actor's screen position (d, e) and the sprite attribute for
// the hit streak (b)
export function projectMinigameWorldPosition(P) {
  const r = projectSceneActor(P);
  return { ...r, b: rb(P, at(MinigameTargetSpriteOamAttrByHitStreak, P.V.minigameHitStreak)) };
}
// the camera projection of the scene actor's projected position (ApplyCameraProjection: d = x, e = y)
export function projectSceneActor(P) {
  const x = P.bus.u16(SCENE_ACTOR + ACT.screen), y = P.bus.u16(SCENE_ACTOR + ACT.screenY);
  const r = far(P, ROM.ApplyCameraProjection, { ...hl(x), ...bc(y), a: y >> 8 });
  return { d: r.d, e: r.e, h: r.h, l: r.l, a: r.a };
}
// QueueMinigameHitBurst (0D:53CE), a = the burst's timer, b/c = attribute/tile, d/e = position: six particles
// flying out (the first four, then two more down the offset table)
export function queueMinigameHitBurst(P, t, attr, tile, x, y) {
  const s = queueMinigameHitBurstFirstFour(P, t, attr, tile, x, y);
  for (let i = 0; i < 2; i++) queueMinigameHitBurstParticle(P, s, attr, tile, x);
}
// QueueMinigameHitBurstFirstFour (0D:53D8): four particles, from 8 pixels up
export function queueMinigameHitBurstFirstFour(P, t, attr, tile, x, y) {
  const s = { hl: at(MinigameHitBurstParticleOffsets, 0x0F - (t & 0x0F)), e: (y + 0xF8) & 0xFF };
  for (let i = 0; i < 4; i++) queueMinigameHitBurstParticle(P, s, attr, tile, x);
  return s;
}
// QueueMinigameHitBurstFirstTwo (0D:53F6): two particles (Medallion Match)
export function queueMinigameHitBurstFirstTwo(P, t, attr, tile, x, y) {
  const s = { hl: at(MinigameHitBurstParticleOffsets, 0x0F - (t & 0x0F)), e: y };
  for (let i = 0; i < 2; i++) queueMinigameHitBurstParticle(P, s, attr, tile, x);
  return s;
}
// QueueMinigameHitBurstParticle (0D:540A), s = { hl: offset entry, e: y }: one 8x8 sprite at x + 2 dx, y + 2 dy
// (dx at hl, dy 16 bytes on), then the next particle 4 pixels up and 32 bytes on
export function queueMinigameHitBurstParticle(P, s, attr, tile, x) {
  const px = (rb(P, s.hl) * 2 + x) & 0xFF;
  s.hl = (s.hl + 0x10) & 0xFFFF;
  const py = (rb(P, s.hl) * 2 + s.e) & 0xFF;
  s.hl = (s.hl + 0x10) & 0xFFFF;
  queueSprite(P, attr, tile, px, py);
  s.e = (s.e - 4) & 0xFF;
}

// ---- hooks ----
const ret = (P, c, r) => put(c, r);
export const HOOKS = [
  [B, 0x4006, hookGen((P, c) => startDrillFromDefinition(P, c.bc))],               // InitMinigameFromConfig
  [B, 0x407F, hookGen((P, c) => startMinigameByID(P, c.a))],                       // StartMinigameByID
  [B, 0x40CF, hook(P => initMinigameScore(P))],                                    // InitMinigameScore
  [B, 0x4121, hook((P, c) => getMinigameTargetScore(P, c.a, c.b))],                // GetMinigameTargetScore
  [B, 0x41A6, hook((P, c) => getDefaultMinigameRecordValue(P, c.a))],              // GetDefaultMinigameRecordValue
  [B, 0x41CB, hook((P, c) => incrementCappedCounter(P, c.b))],                     // IncrementCappedCounter
  [B, 0x41D3, hook(P => isMinigameTargetReached(P))],                              // IsMinigameTargetReached
  [B, 0x41EE, hook(P => isMinigameScoreLimitReached(P))],                          // IsMinigameScoreLimitReached
  [B, 0x4211, hook(P => startScorePopup(P))],                                      // StartScorePopup
  [B, 0x4237, hook(P => updateScorePopup(P))],                                     // UpdateScorePopup
  [B, 0x4266, hook((P, c) => ({ de: addToMinigameScore(P, c.de) }))],             // AddToMinigameScore
  [B, 0x42BF, hook(P => getMinigameGridCellIndex(P))],                             // GetMinigameGridCellIndex
  [B, 0x4302, hook(P => drawMinigameGrid(P))],                                     // DrawMinigameGrid
  [B, 0x431B, hook((P, c) => drawMinigameGridCell(P, c.a, c.b))],                  // DrawMinigameGridCell
  [B, 0x43A3, hook(P => queueMinigameHudVRAMCopy(P))],                             // QueueMinigameHudVRAMCopy
  [B, 0x43BA, hookGen(P => showPointOutcomeBanner(P))],                            // ShowPointOutcomeBanner
  [B, 0x43DF, hook(P => determineMinigamePointResult(P))],                         // DetermineMinigamePointResult
  [B, 0x4412, hookGen((P, c) => showMinigamePointResult(P, c.d))],                 // ShowMinigamePointResult
  [B, 0x4440, hook(P => clearMinigameActors(P))],                                  // ClearMinigameActors
  [B, 0x444F, hook((P, c) => setMinigameActorHandler(P, c.bc, c.de))],             // SetMinigameActorHandler
  [B, 0x4465, hook((P, c) => setMinigameActorPosition(P, c.bc, c.hl, c.de))],      // SetMinigameActorPosition
  [B, 0x449A, hook((P, c) => setMinigameActorWorldPos(P, c.hl, c.de))],            // SetMinigameActorWorldPos
  [B, 0x44BD, hook(P => updateMinigameActors(P))],                                 // UpdateMinigameActors
  [B, 0x44D3, keepRegs((P, c) => updateMinigameActor(P, c.hl))],                           // UpdateMinigameActor
  [B, 0x4678, hookGen(P => startMinigameMatch(P))],                                // StartMinigameMatch
  [B, 0x46D7, hook(P => drawMinigameScoreHud(P))],                                 // DrawMinigameScoreHud
  [B, 0x46F7, hookGen(P => launchMinigameServe(P))],                               // LaunchMinigameServe
  [B, 0x4751, hookGen(P => awardMinigamePointAndEnd(P))],                          // AwardMinigamePointAndEnd
  [B, 0x475D, hookGen(P => endMinigamePoint(P))],                                  // EndMinigamePoint
  [B, 0x47BE, hook(P => keepMinigameCameraFixed(P))],                              // KeepMinigameCameraFixed
  [B, 0x47C3, hook(P => checkMinigameStartBannerTrigger(P))],                      // CheckMinigameStartBannerTrigger
  [B, 0x47E2, hook(P => freezeMinigameOpponentOnReturn(P))],                       // FreezeMinigameOpponentOnReturn
  [B, 0x47FD, hook(P => launchBall(P))],                                           // LaunchBall
  [B, 0x48B6, hook(P => applyMinigameCharTargetFromTable(P))],                     // ApplyMinigameCharTargetFromTable
  [B, 0x48CE, hookGen(P => playMinigameCountdown(P))],                             // PlayMinigameCountdown
  [B, 0x4926, hook((P, c) => getMinigameCharCoordsEntry(P, c.a))],                 // GetMinigameCharCoordsEntry
  [B, 0x493A, hook((P, c) => snapCameraTo(P, c.hl, c.de))],                        // SnapCameraTo_0d
  [B, 0x4ABB, hook(P => updateMinigameHudAndBallTrail(P))],                        // UpdateMinigameHudAndBallTrail
  [B, 0x4AF1, hook((P, c) => markMinigameObjectOffscreen(P, c.hl, c.de))],         // MarkMinigameObjectOffscreen
  [B, 0x4B01, hook(P => startMinigameSoloPoint(P))],                               // StartMinigameSoloPoint
  [B, 0x4B29, hookGen(P => handleMinigamePointEnd(P))],                            // HandleMinigamePointEnd
  [B, 0x4B59, hook(P => awardMinigamePointAndReflectBall(P))],                     // AwardMinigamePointAndReflectBall
  [B, 0x4B70, hook(P => reflectBallVelocity(P))],                                  // ReflectBallVelocity
  [B, 0x4BC7, hook(stubNop)],                                                      // StubNop_0d_0
  [B, 0x4BC8, hook(P => hideLandingMarkerAndExtendSoloCourt(P))],                  // HideLandingMarkerAndExtendSoloCourt
  [B, 0x4BEA, hook((P, c) => drawMinigameScore(P, c.d, c.e))],                     // DrawMinigameScore
  [B, 0x50FA, hook((P, c) => loadMatchUiCourtTilemap(P, c.a))],                    // LoadMatchUiCourtTilemap
  [B, 0x5148, hook((P, c) => loadTargetZoneConfig(P, c.a))],                       // LoadTargetZoneConfig
  [B, 0x53AA, hook(P => projectMinigameWorldPosition(P))],                         // ProjectMinigameWorldPosition
  [B, 0x53CE, hook((P, c) => queueMinigameHitBurst(P, c.a, c.b, c.c, c.d, c.e))],  // QueueMinigameHitBurst
  [B, 0x53D8, hook((P, c) => { const s = queueMinigameHitBurstFirstFour(P, c.a, c.b, c.c, c.d, c.e); return { hl: s.hl, e: s.e }; })],
  [B, 0x53F6, hook((P, c) => { const s = queueMinigameHitBurstFirstTwo(P, c.a, c.b, c.c, c.d, c.e); return { hl: s.hl, e: s.e }; })],
  [B, 0x540A, hook((P, c) => { const s = { hl: c.hl, e: c.e }; queueMinigameHitBurstParticle(P, s, c.b, c.c, c.d); return s; })],
];
void ret;
