// Training drills, the shared part (bank $0B): starting a drill or minigame (RunTrainingDrillByID), the drill
// definitions, the per-point result bits and counters, the drill messages, the gate markers, the end-of-point
// sequence and the two-on-one doubles drill; plus the judging framework the eighteen drills share.
// Port of drill_scoring_0b.asm, drill_messages_0b.asm, the head of service_matches_0b.asm (RunTrainingDrillByID,
// ClearBGForDrillResult), RunDoublesDrillMatch (stroke_practice_0b.asm) and the twins start_drill_from_definition
// and net_game_match1_award_point_to_side of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm), whose names these are.
//
// The drills ("lessons" of the Training Court). Ids $00-$11: Service Match/Practice, Net Game Match/Practice,
// Stroke Match/Practice, three levels each. A drill is a short match against a coach (a "match" drill: points
// alternate sides, the coach's side mirrors the player's) or a lesson of four points ("practice": wDrillIsPracticeLesson,
// the player always the one judged). Each point is judged by the drill's JudgePoint on four events — the point's
// end (0), a ball hit (1), a bounce (2), a rally tick (3) — by the rally length so far: the first judgement that is
// not 0 sticks for the point (wDrillPointJudgement: +1 the player succeeded, -1 failed). A judgement often also
// ends the rally at once (wMatchAbortFlag = MATCHABORT_POINT) and queues the message the coach says about it.
//
// Covered by web/tests/port/routines_minigames.mjs (the routines that do not wait) and the lockstep (out/port/
// drill_*.mtrec, made by web/tests/port/make_minigame_rec.mjs).
import {
  BANK_DRILLS, BANK_MINIGAMES, ROM, far, farWait, farcallAt, callAt, sound, pushWramBank, inBankWait, rb, rw, at, jumpTable,
  rlaBit, shiftedOutBit, popcount8, hook, hookGen, flagsOfA, FLAG_Z, FLAG_N, FLAG_C,
  POINTOUTCOME, WINLOSE_LOSE, MATCHABORT_POINT, MATCHABORT_MATCH, CHARSTATE_INERT, WRAM_TEXT, WRAM_CHAR1, WRAM_COURT_PLANES, WRAM_SCREEN,
  CHAR, CHAR_NONE, MATCHLIST_TRAINING, MINIGAME_TENNIS_MACHINE_1, MINIGAME_TWO_ON_ONE, MINIGAME_SERVICE_MATCH_2,
  DRILLMSG_HIDE, DRILLMSG_NO_MESSAGE_FOR_THIS_CASE,
} from "./common.js";
import { startMinigameByID } from "./minigame_core.js";
import { clearMemory16 } from "../home/memory.js";
import { queueVRAMCopy } from "../home/memory.js";
import { beginFadeIn, beginFadeOut } from "../home/colorfade.js";

const B = BANK_DRILLS;
// ROM tables of this bank
const DrillPointResultBitsTable = 0x40BC;      // two words: wDrillShotResultBits, wDrillShotResultBits + 1
export const SignedTable_0b_00 = 0x46F1;      // by point outcome: the +1/-1 judgement of the server's side
export const SignedTable_0b_01 = 0x46FB;      // the same for the receiver's side
const DrillDefinitionPtrs = 0x47B4;            // drill id $00-$11 -> its definition
const DrillMessageTextIds_0b = 0x45C4;         // message id -> text id
const DrillSpriteTemplate_0b = 0x46E8;         // a gate pole's sprites
const DoublesDrillMatchPtrs = 0x72E0;          // level -> [games, sets, CPU AI params x4, difficulty]
export const SyncPointWinLoseFlagTask_ADDR = 0x446E;
const Text_30_351 = 0x015F;                    // "drill result" lines: +0 lost/none, +1 won
const FLAG_DRILL_FROM_MENU = 30 << 5;          // the drill was started from the main menu's lesson list (as `de`: byte << 8 | bit << 5)
const VBGMAP0 = 0x9800, VRAM_BANK1 = 0x2000, BGMAP_ROWS_BLOCKS = 18 * 32 / 16;
const OAM_BANK1 = 0x08, GATE_POLE_TILE = 0x30;
const CHAR_BOWSER = 0x1D, CHAR_WALUIGI = 0x1B, CHAR_WARIO = 0x1E;
const GAMEMODE_MARIO_MINIGAME = 0x08, BGM_TWO_ON_ONE = 0x15, COURT_TWO_ON_ONE = 0x17;
// drill definition (drill_def) fields
const DEF_OPPONENT = 0, DEF_COURT = 1, DEF_CHARS = 2, DEF_MODE = 3, DEF_MATCH = 4, DEF_BGM = 5, DEF_PLAYER = 7;
const DEF_HOOKS = 8, DEF_POINT_TABLE = 0x0A, DEF_INIT = 0x0C;

const u16 = (P, name) => P.bus.u16(P.A[name]);
const w16 = (P, name, v) => P.bus.w16(P.A[name], v);

// ---- starting a drill or minigame ----
// RunTrainingDrillByID (0B:4705, the bank's export $4000), a = the drill/minigame id: set the match up from its
// definition (drills here, minigames $12+ in bank $0D, $24 the two-on-one doubles match), play it (RunMinigameMatch),
// then — started from the main menu's lesson list — show the result line on a blank screen; hand out the rewards.
// A retry request (the pause menu's "retry") plays the same id again.
export function* runTrainingDrillByID(P, id) {
  for (;;) {
    yield* farWait(P, ROM.InitMinigameMatchSettings, { a: id });
    if (id === MINIGAME_TWO_ON_ONE) yield* callAt(P, 0x47AE, runDoublesDrillMatch(P));
    else {
      if (id >= MINIGAME_TENNIS_MACHINE_1) yield* inBankWait(P, BANK_MINIGAMES, startMinigameByID(P, id));
      else yield* startDrillFromDefinition(P, rw(P, DrillDefinitionPtrs + id * 2));
      clearMemory16(P, P.A.drillAbortCountdown, 2);             // the drill's work bytes ($20 from wDrillAbortCountdown)
      resetAiServeOverrides(P);
      yield* farcallAt(P, 0x473C, ROM.RunMinigameMatch);
    }
    P.V.scrollX = 0; P.V.scrollY = 0;                           // .afterMatch
    resetAiServeOverrides(P);
    if (!P.V.matchRetryRequest) break;
    id = P.bus.u8(P.A.currentMinigameStoryMatch + 1);
  }
  if (P.V.matchExitRequest) P.V.pointWinLoseFlag = WINLOSE_LOSE;   // quit: counts as lost
  if (!(far(P, ROM.TestGameFlag, { d: FLAG_DRILL_FROM_MENU >> 8, e: FLAG_DRILL_FROM_MENU & 0xFF }).f & FLAG_Z)) {   // test_flag
    far(P, ROM.DisableLCDSafely);
    yield* farWait(P, ROM.ResetTextWindowState);
    clearBGForDrillResult(P);
    yield* farWait(P, ROM.LoadMenuFontGfx);
    far(P, ROM.EnableLCD);
    beginFadeIn(P, 8);
    yield* farWait(P, ROM.WaitFadeEnd, { c: 8 });
    yield* farWait(P, ROM.PushTextArgNumber, { a: P.V.drillLessonResult, h: 0, l: P.V.drillLessonResult });
    const won = ((P.V.pointWinLoseFlag + 1) & 0xFF) >> 1;      // +1 -> 1, -1 or 0 -> 0
    const text = at(Text_30_351, won);
    yield* farcallAt(P, 0x479C, ROM.ShowSpeakerDialogue, { a: 0x80, h: text >> 8, l: text & 0xFF });
    beginFadeOut(P, 16);
    yield* farWait(P, ROM.WaitFadeEnd, { c: 16 });
  }
  far(P, ROM.ClearGameFlag, { d: FLAG_DRILL_FROM_MENU >> 8, e: FLAG_DRILL_FROM_MENU & 0xFF });   // clear_flag
  yield* farcallAt(P, 0x47AA, ROM.ProcessMatchRewards);
}
// the CPU server's overrides off: no fixed aim ($FF), no fixed walk X, the toss gap rolled
function resetAiServeOverrides(P) {
  P.V.aiServeAimOverride = 0xFF;
  w16(P, "aiServeTargetX", 0);
  P.V.aiServeSkipToss = 0;
}

// StartDrillFromDefinition (0B:4002) / InitMinigameFromConfig (0D:4006, the same code): the match setup from a
// definition at `def` (in the bank mapped): opponent, court, character count, game mode, the minigame id, music,
// the player's and opponent's records, the mode hook table (in this bank), the point layout table, then the
// definition's own init routine (an indirect call: the port's hook or the ROM's code at that address).
export function* startDrillFromDefinition(P, def) {
  const { V, bus } = P;
  V.matchOpponentChar = rb(P, def + DEF_OPPONENT);
  V.currentlyUsedCourt = rb(P, def + DEF_COURT);
  V.onCourtCharCount = rb(P, def + DEF_CHARS);
  V.gameMode = rb(P, def + DEF_MODE);
  bus.w8(P.A.currentMinigameStoryMatch, MATCHLIST_TRAINING);
  bus.w8(P.A.currentMinigameStoryMatch + 1, rb(P, def + DEF_MATCH));
  V.matchBGM = rb(P, def + DEF_BGM);
  const playerAt = (def + DEF_PLAYER) & 0xFFFF;
  yield* farWait(P, ROM.InitCa00RecordFromCharId, { a: V.matchBGM, b: rb(P, playerAt), c: 0, h: playerAt >> 8, l: playerAt & 0xFF });
  V.matchPlayerChar = V.storyModeMainCharacterOverworldSprite;
  const opponent = V.matchOpponentChar;
  if (opponent !== CHAR_NONE) yield* farWait(P, ROM.InitCa00RecordFromCharId, { a: opponent, b: opponent, c: 2 });
  const hooks = rw(P, def + DEF_HOOKS);
  far(P, ROM.SetModeHookTable, { a: V.romBank, d: hooks >> 8, e: hooks & 0xFF, b: def >> 8, c: def & 0xFF });
  const points = rw(P, def + DEF_POINT_TABLE);
  far(P, ROM.SetMinigamePointTable, { d: points >> 8, e: points & 0xFF });
  const init = rw(P, def + DEF_INIT);
  if (init) yield* farWait(P, [V.romBank, init], { a: (init >> 8) | (init & 0xFF), h: init >> 8, l: init & 0xFF, b: def >> 8, c: def & 0xFF });
}

// ClearBGForDrillResult (0B:47D8): a blank screen for the result line: the attribute plane 0 and the tile plane
// spaces ($20), both copied to BG map 0 (VRAM banks 1 and 0), with the LCD off meanwhile.
export function clearBGForDrillResult(P) {
  far(P, ROM.DisableLCDSafely);
  P.wramBank(WRAM_COURT_PLANES);
  fillMemoryBC_0b(P, 0x00, P.A.screenAttrmap, 0x500);
  P.wramBank(WRAM_SCREEN);
  fillMemoryBC_0b(P, 0x20, P.A.shadowTilemap, 0x500);
  P.wramBank(WRAM_SCREEN);
  queueVRAMCopy(P, P.A.shadowTilemap, VBGMAP0, BGMAP_ROWS_BLOCKS);
  P.wramBank(WRAM_COURT_PLANES);
  queueVRAMCopy(P, P.A.screenAttrmap, VBGMAP0 + VRAM_BANK1, BGMAP_ROWS_BLOCKS);
  far(P, ROM.EnableLCD);
}
// FillMemoryBC_0b (0B:4823): bc bytes at hl = a (bc = 0: 65536). Returns hl after, a = 0 (b | c), e = the value.
export function fillMemoryBC_0b(P, value, hl, bc) {
  let n = bc || 0x10000;
  for (; n > 0; n--) { P.bus.w8(hl, value); hl = (hl + 1) & 0xFFFF; }
  return { hl, bc: 0, a: 0, e: value, f: FLAG_Z };
}

// RunDoublesDrillMatch (0B:7258): the two-on-one match (id $24): Bowser against Waluigi and Wario, a doubles match
// of the length and CPU strength the level picks (DoublesDrillMatchPtrs: games, sets, then the four AI parameters
// and the difficulty, given to both opponents), played as a normal match (RunMatch).
export function* runDoublesDrillMatch(P) {
  const { V, bus } = P;
  V.matchContext = 0;
  V.gameMode = GAMEMODE_MARIO_MINIGAME;
  bus.w8(P.A.currentMinigameStoryMatch, MATCHLIST_TRAINING);
  bus.w8(P.A.currentMinigameStoryMatch + 1, MINIGAME_TWO_ON_ONE);
  V.matchBGM = BGM_TWO_ON_ONE;
  V.matchIsDoubles = 1;
  V.onCourtCharCount = 3;
  V.currentlyUsedCourt = COURT_TWO_ON_ONE;
  V.matchPlayerChar = CHAR_BOWSER;
  yield* farWait(P, ROM.InitCa00RecordFromCharId, { a: CHAR_BOWSER, b: CHAR_BOWSER, c: 0 });
  V.matchOpponentChar = CHAR_WALUIGI;
  yield* farWait(P, ROM.InitCa00RecordFromCharId, { a: CHAR_WALUIGI, b: CHAR_WALUIGI, c: 2 });
  yield* farWait(P, ROM.InitCa00RecordFromCharId, { b: CHAR_WARIO, c: 3 });
  const row = rw(P, at(DoublesDrillMatchPtrs, V.minigameLevel * 2));
  V.matchTypeNumberOfGames = rb(P, row);
  V.matchTypeNumberOfSets = rb(P, row + 1);
  const params = row + 2;                                       // the same five bytes for both opponents
  for (let i = 0; i < 4; i++) bus.w8(P.A.player2MainAiParams + i, rb(P, params + i));
  V.exhibitionModeCPUMainCharacterDifficulty = rb(P, params + 4);
  for (let i = 0; i < 4; i++) bus.w8(P.A.player2PartnerAiParams + i, rb(P, params + i));
  V.exhibitionModeCPUPartnerCharacterDifficulty = rb(P, params + 4);
  const end = params + 5;
  yield* farcallAt(P, 0x72DC, ROM.RunMatch, { a: rb(P, end - 1), h: end >> 8, l: end & 0xFF });
}

// ---- the per-point result bits (drill_scoring_0b) ----
// RecordDrillPointResultBits (0B:407B): note the point's result as a 2-bit code ($01 won, $03 lost) in
// wDrillShotResultBits. A practice lesson writes point n to bits 2n+2.. of the first byte (rotated: the code sits
// in bits 7-6 before the rotation); a match drill alternates the two bytes (one per server) and writes the pair's
// half n/2, the receiver's points with the code's high bit flipped.
export function recordDrillPointResultBits(P) {
  const flag = P.V.pointWinLoseFlag;
  if (!flag) return { a: 0, f: FLAG_Z };
  let code = flag & 3;
  code = ((code >> 2) | (code << 6)) & 0xFF;                   // rrc a twice
  const points = P.V.totalPointsScoredInCurrentGame;
  let b = points, entry = DrillPointResultBitsTable;
  if (!P.V.drillIsPracticeLesson) {
    entry = at(entry, (points & 1) * 2);
    b = points >> 1;
    if (points & 1) code ^= 0x80;
  }
  const slot = rw(P, entry);
  const n = ((b + 1) << 1) & 0xFF;                              // inc b / sla b passes of rlc a (0: 256)
  const r = (n || 256) % 8;
  const bits = ((code << r) | (code >> (8 - r))) & 0xFF;
  const a = bits | P.bus.u8(slot);
  P.bus.w8(slot, a);
  return { a, b: 0, c: code, hl: slot, f: a ? 0 : FLAG_Z };
}
// CountDrillShotSuccesses (0B:40C0), a = which byte of wDrillShotResultBits: how many of its four 2-bit codes are
// $01 (won). bc and hl kept.
export function countDrillShotSuccesses(P, which) {
  const v = P.bus.u8(at(P.A.drillShotResultBits, which));
  let n = 0;
  for (let i = 0; i < 8; i += 2) if (((v >> i) & 3) === 1) n++;
  return n;
}
// Unused_0b_CheckTwoPointLead (0B:40FD): 1 when player 1 leads by 2 or more, 2 when player 2 does, else 0
export function unusedCheckTwoPointLead(P) {
  const p2 = P.V.player2PointsWon, d = (P.V.player1PointsWon - p2) & 0xFF;
  let r;
  if (d & 0x80) r = ((-d) & 0xFF) < 2 ? 0 : 2;
  else r = d < 2 ? 0 : 1;
  return { a: r, b: p2, f: r ? 0 : FLAG_Z | FLAG_N };
}
// Unused_0b_GetBallXAndDepth (0B:4122): hl = wBallX, de = wBallDepth
export function unusedGetBallXAndDepth(P) {
  return { hl: u16(P, "ballX"), de: u16(P, "ballDepth"), a: P.bus.u8(P.A.ballX) };
}
// UnusedGetObjectXAndDepth (0B:412F): the actor a ($80-byte records from $D000): hl = its X (+1), de = its depth (+4)
export function unusedGetObjectXAndDepth(P, a) {
  const bc = (0xD000 + a * 0x80) & 0xFFFF;
  return { bc, de: P.bus.u16(bc + 4), hl: P.bus.u16(bc + 1), a: P.bus.u8(bc + 1) };
}
// ResetActiveCharState (0B:414B): the coach (character 1) stops: CHARSTATE_INERT
export function resetActiveCharState(P) {
  const old = pushWramBank(P, WRAM_TEXT);
  far(P, ROM.SetCharState, { a: CHARSTATE_INERT });
  P.wramBank(old);
}
// IndexDrillTableByPoint (0B:415F), hl = a table of 8-byte gate records [x1, depth1, x2, depth2] by point: the
// point's two gate poles (SetBallGatePoint1/2)
export function indexDrillTableByPoint(P, table) {
  const rec = at(table, P.V.totalPointsScoredInCurrentGame * 8);
  setPoints(P, ROM.SetBallGatePoint1, rec, rec);
  setPoints(P, ROM.SetBallGatePoint2, rec, rec + 4);
}
// SetDrillTargetZoneForPoint (0B:4191): the same for the target zone's corners (SetTargetZoneCorner1/2)
export function setDrillTargetZoneForPoint(P, table) {
  const rec = at(table, P.V.totalPointsScoredInCurrentGame * 8);
  setPoints(P, ROM.SetTargetZoneCorner1, rec, rec);
  setPoints(P, ROM.SetTargetZoneCorner2, rec, rec + 4);
}
function setPoints(P, routine, bc, rec) {
  const x = rw(P, rec), depth = rw(P, rec + 2);
  far(P, routine, { a: x & 0xFF, h: x >> 8, l: x & 0xFF, d: depth >> 8, e: depth & 0xFF, b: bc >> 8, c: bc & 0xFF });
}
// UpdateDrillAbortCountdown (0B:41C3), every frame of a drill: once armed (the coach returned the ball), count
// wDrillAbortCountdown down while the point is undecided; at 0 the rally ends.
export function updateDrillAbortCountdown(P) {
  const { V } = P;
  if (!V.drillAbortCountdownActive) return;
  if (V.pointOutcome) return;
  const n = (V.drillAbortCountdown - 1) & 0xFF;
  V.drillAbortCountdown = n;
  if (n) return;
  V.matchAbortFlag = MATCHABORT_POINT;
}
// RecordDrillTargetZoneHitIfInPlay (0B:41DA): RecordDrillTargetZoneHit unless the ball went into the net, or the
// serve was a fault or a let
export function recordDrillTargetZoneHitIfInPlay(P) {
  const o = P.V.pointOutcome;
  if (o === POINTOUTCOME.NET || o === POINTOUTCOME.FAULT || o === POINTOUTCOME.LET) return;
  recordDrillTargetZoneHit(P);
}
// RecordDrillTargetZoneHit (0B:41E6): at the ball's first bounce (IsBallInTargetZone: a = 1, NZ inside): inside the
// zone, the zone goes off for this point (wTargetZoneEnabled = 0, its hit shown); outside, the point's bit is set in
// wDrillTargetZoneHitBits — despite the names, the bits record the misses.
export function recordDrillTargetZoneHit(P) {
  if (P.V.ballBounceCount >= 2) return;
  const r = far(P, ROM.IsBallInTargetZone);
  if (!(r.f & FLAG_Z)) { P.V.targetZoneEnabled = 0; return; }
  P.V.drillTargetZoneHitBits |= rlaBit(P.V.totalPointsScoredInCurrentGame + 1);
}
// CountDrillResultBitsSet (0B:420B): the points whose ball missed the target zone (bits of wDrillTargetZoneHitBits).
// bc kept.
export function countDrillResultBitsSet(P) {
  return { a: popcount8(P.V.drillTargetZoneHitBits), f: FLAG_Z | FLAG_N };
}
// CheckDrillTargetZoneMissed (0B:421C): 1 when this point's ball landed in the target zone (no miss bit), else 0 —
// the name says the opposite of what it returns.
// cin: the carry flag the caller leaves (the shift loop brings it in; it decides point 8). bc kept.
export function checkDrillTargetZoneMissed(P, cin) {
  const bit = shiftedOutBit(P.V.drillTargetZoneHitBits, P.V.totalPointsScoredInCurrentGame + 1, cin);
  const a = bit ^ 1;
  return { a, f: a ? 0 : FLAG_Z };
}
// RecordGateCrossOnServe (0B:4233), every frame of Service Practice 3 during the serve: once the ball passes
// between the gate poles, set the point's bit in wDrillGateCrossBits (the gate is then done for the point).
export function recordGateCrossOnServe(P) {
  if (P.V.rallyLength !== 1) return;
  if (!P.V.drillGateActive) return;
  const r = far(P, ROM.DidBallCrossGate);
  if (r.f & FLAG_Z) return;
  P.V.drillGateActive = 0;
  P.V.drillGateCrossBits |= rlaBit(P.V.totalPointsScoredInCurrentGame + 1);
}
// CountDrillResultBitsSetAlt (0B:4257): the points whose serve passed the gate (bits of wDrillGateCrossBits)
export function countDrillResultBitsSetAlt(P) {
  return { a: popcount8(P.V.drillGateCrossBits), f: FLAG_Z | FLAG_N };
}
// CountDrillResultBitsThisGame (0B:4268): whether this point's serve passed the gate (its bit of wDrillGateCrossBits),
// with Z for no. cin: the caller's carry, as in CheckDrillTargetZoneMissed. bc kept.
export function countDrillResultBitsThisGame(P, cin) {
  const a = shiftedOutBit(P.V.drillGateCrossBits, P.V.totalPointsScoredInCurrentGame + 1, cin);
  return { a, f: a ? 0 : FLAG_Z };
}

// ---- the end of a drill point (drill_messages_0b) ----
// PlayDrillPointEndSequence (0B:43A6): the camera stays where it is; a fault or a let shows its court banner, any
// other outcome but a winner or a volleyed serve just waits; then the game score pops up and goes away.
export function* playDrillPointEndSequence(P) {
  const y = u16(P, "matchCameraY"), x = u16(P, "matchCameraX");
  yield* farWait(P, ROM.SetCameraTarget, { h: x >> 8, l: x & 0xFF, d: y >> 8, e: y & 0xFF, a: x & 0xFF });
  const outcome = P.V.pointOutcome;
  if (outcome !== POINTOUTCOME.WINNER && outcome !== POINTOUTCOME.SERVE_VOLLEYED) {
    if (outcome === POINTOUTCOME.FAULT || outcome === POINTOUTCOME.LET) yield* farWait(P, ROM.ShowCourtBanner, { a: outcome });
    yield* farcallAt(P, 0x43D1, ROM.StepMatchFrames, { a: 30 });
    yield* farWait(P, ROM.HideCourtBanner);
    yield* farcallAt(P, 0x43D9, ROM.StepMatchFrames, { a: 15 });
  }
  yield* farWait(P, ROM.SpawnGameScoreDisplayObjs);
  yield* farcallAt(P, 0x43E1, ROM.StepMatchFrames, { a: 10 });
  yield* farcallAt(P, 0x43E6, ROM.StepMatchFramesSkippable, { a: 10 });
  yield* farWait(P, ROM.UpdateScorePanelDisplay);
  yield* farcallAt(P, 0x43EE, ROM.StepMatchFrames, { a: 10 });
  yield* farcallAt(P, 0x43F3, ROM.StepMatchFramesSkippable, { a: 30 });
  yield* farWait(P, ROM.DismissGameScoreDisplayObjs);
  yield* farcallAt(P, 0x43FB, ROM.StepMatchFramesSkippable, { a: 70 });
  yield* farcallAt(P, 0x4400, ROM.StepMatchFrames, { a: 8 });
}

// LoadDrillOpponentChar (0B:4404), a = a roster id: the coach (character slot 2's record, character 1's struct)
// becomes that character — the drills swap in a "serving" variant of the coach for the coach's serves
export function* loadDrillOpponentChar(P, charId) {
  yield* farWait(P, ROM.InitCa00RecordFromCharId, { a: charId, b: charId, c: 2 });
  const old = pushWramBank(P, WRAM_TEXT);
  yield* farWait(P, ROM.LoadCharacterAttributes);
  P.wramBank(old);
}
// LoadDrillOpponentBySide (0B:441C), hl = two roster ids: the first when player 1 serves, else the second
export function* loadDrillOpponentBySide(P, pair) {
  yield* loadDrillOpponentChar(P, rb(P, at(pair, P.V.currentServingPlayer & 1)));
}
// Unused_0b_WriteCharStructByte (0B:442B): character 1's struct byte hl = a
export function unusedWriteCharStructByte(P, a, hl) {
  const old = pushWramBank(P, WRAM_CHAR1);
  P.bus.w8(CHAR.posX + hl, a);
  P.wramBank(old);
  return { a: old, b: a, de: CHAR.posX, hl: (CHAR.posX + hl) & 0xFFFF };
}
// UnusedSetAiReactionDelayFar (0B:4440): character 1's AI reaction delay ($DF7A) = a
export function unusedSetAiReactionDelayFar(P, a) { return unusedWriteCharStructByte(P, a, 0x7A); }
// TestCharStateBit4 (0B:4447), a = a character index: 1 when its state flags ($DF50) have bit 4 set (the character
// stands in front of the service line), else 0. The flags it leaves: for 1, the ones it was called with (they are
// popped back with the WRAM bank: callers that test Z after it without `or a` see those); for 0, Z.
export function testCharStateBit4(P, index, fIn) {
  const old = pushWramBank(P, (4 + index) & 0xFF);
  const set = (P.bus.u8(CHAR.stateFlags) & 0x10) !== 0;
  P.wramBank(old);
  return set ? { a: 1, b: index, f: fIn } : { a: 0, b: index, f: FLAG_Z };
}
// SyncPointWinLoseFlagTask (0B:446E), a frame task while the point-end reactions play: character 1's point result
// follows wPointWinLoseFlag (so the coach of a practice lesson reacts to the player's result as his own)
export function syncPointWinLoseFlagTask(P) {
  const old = pushWramBank(P, WRAM_CHAR1);
  P.bus.w8(CHAR.pointResult, P.V.pointWinLoseFlag);
  P.wramBank(old);
}

// ---- drill messages ----
// UnusedQueueDrillOutcomeMessage (0B:4484): an older message picker by outcome (unused): 1 ace/winner-like,
// 2 double fault, 3 the poles missed (Service Match 2), 4 nothing decided, 5/6 other outcomes; +6 when player 2
// served; faults and lets show nothing.
export function unusedQueueDrillOutcomeMessage(P) {
  const { V } = P;
  const o = V.pointOutcome;
  if (o === POINTOUTCOME.FAULT || o === POINTOUTCOME.LET) { V.drillMessageId = DRILLMSG_HIDE; return; }
  let m;
  if (o === POINTOUTCOME.BALL_HIT_PLAYER) m = 1;
  else if (P.bus.u8(P.A.currentMinigameStoryMatch + 1) === MINIGAME_SERVICE_MATCH_2
           && !P.bus.u8(at(P.A.drillServeTargetResult, V.currentServingPlayer))) m = 3;
  else if (V.rallyLength === 1) m = V.serviceAceFlag ? 1 : 2;
  else if (!V.pointOutcome) m = 4;
  else m = V.pointOutcome === 7 ? 6 : V.pointOutcome === 9 ? 1 : 5;
  V.drillMessageId = (m + (V.currentServingPlayer ? 6 : 0)) & 0xFF;
}
// QueueDrillOutcomeMessage (0B:44F2), Service Practice 2 when no message was queued: "you didn't hit the target
// area" ($10) for a miss, else for the serve "service ace" ($0D) or "double fault" ($0E); a later rally: $10.
// Faults and lets show nothing.
export function queueDrillOutcomeMessage(P) {
  const { V } = P;
  const o = V.pointOutcome;
  let m;
  if (o === POINTOUTCOME.FAULT || o === POINTOUTCOME.LET) m = DRILLMSG_HIDE;
  else if (!checkDrillTargetZoneMissed(P, o < POINTOUTCOME.LET).a) m = 0x10;   // (cp LET's carry)
  else if (V.rallyLength === 1) m = V.serviceAceFlag ? 0x0D : 0x0E;
  else m = 0x10;
  V.drillMessageId = m;
}
// QueueDrillResultMessage (0B:4534): queue message a, plus b when player 2 serves (the other side's wording);
// $FF (hide) as it is
export function queueDrillResultMessage(P, msg, b) {
  P.V.drillMessageId = msg === DRILLMSG_HIDE ? msg : (msg + (P.V.currentServingPlayer ? b : 0)) & 0xFF;
}
// SetDrillMessageByServer (0B:4545): the same, plus b when player 1 serves
export function setDrillMessageByServer(P, msg, b) {
  P.V.drillMessageId = msg === DRILLMSG_HIDE ? msg : (msg + (P.V.currentServingPlayer ^ 1 ? b : 0)) & 0xFF;
}
// SetDrillMessageByRallyParity (0B:4558): plus b when the point number and the rally length have the same parity
// (the coach hit the last ball, in Stroke Match 1)
export function setDrillMessageByRallyParity(P, msg, b) {
  if (msg === 0xFF) { P.V.drillMessageId = msg; return; }
  const odd = ((P.V.totalPointsScoredInCurrentGame ^ 1) + (P.V.rallyLength ^ 1)) & 1;
  P.V.drillMessageId = (msg + (odd ? b : 0)) & 0xFF;
}
// ShowQueuedDrillMessage (0B:4574): show the queued message (none queued: "there is no message for this case")
export function* showQueuedDrillMessage(P) {
  if (!P.V.drillMessageId) P.V.drillMessageId = DRILLMSG_NO_MESSAGE_FOR_THIS_CASE;
  yield* callAt(P, 0x457F, showDrillMessageByIndex(P, P.V.drillMessageId));
}
// ShowDrillMessageByIndex (0B:4583): the message's text in a window over the court, as wide as the text's widest
// line plus the frame and as tall as its lines, centred, at row 6 (ShowMessageWindow waits for a button)
export function* showDrillMessageByIndex(P, msg) {
  if (msg === DRILLMSG_HIDE) return;
  const id = rw(P, (DrillMessageTextIds_0b + msg * 2) & 0xFFFF);
  const t = yield* farWait(P, ROM.AddTextIdOffset, { a: 0, h: id >> 8, l: id & 0xFF, b: id >> 8, c: id & 0xFF });
  const m = yield* farWait(P, ROM.MeasureDialogueWidthTiles, { b: t.h, c: t.l });
  const width = (m.a + 2) & 0xFF;
  const old = pushWramBank(P, WRAM_TEXT);
  const lines = P.V.fitTextLineCount;
  P.wramBank(old);
  const x = ((0x14 - width) & 0xFF) >> 1;
  yield* farcallAt(P, 0x45C0, ROM.ShowMessageWindow, { a: x, b: width, c: (lines * 2 + 1) & 0xFF, d: x, e: 6, h: m.b, l: m.c });
}

// QueueDrillMarker1_0b (0B:46A0) / QueueDrillMarker2_0b (0B:46C4), the Draw hook of the gate drills: while the
// gate is up, a pole sprite at gate point 1 / 2 (projected, then moved by the camera)
export function queueDrillMarker(P, gate) {
  if (!P.V.drillGateActive) return;
  const x = P.bus.u16(gate), depth = P.bus.u16(gate + 2);
  far(P, ROM.ProjectWorldToScreen_08, { b: 0, c: 0, h: x >> 8, l: x & 0xFF, d: depth >> 8, e: depth & 0xFF });
  far(P, ROM.ApplyCameraProjection);
  far(P, [0, 0x1E9D], { h: DrillSpriteTemplate_0b >> 8, l: DrillSpriteTemplate_0b & 0xFF, b: OAM_BANK1 | 1, c: GATE_POLE_TILE });
}

// ---- judging (each drill's JudgePoint) ----
// <Drill>JudgePoint, event 0-3: the judgement so far if there is one; else the case for the rally length (the
// table at `table` of the ROM, by wRallyLength - 1) and the event. rallies[n][event] are the cases.
export function judgePoint(P, event, table, rallies) {
  const j = P.V.drillPointJudgement;
  if (j) return j;
  const index = (P.V.rallyLength - 1) & 0xFF;
  return jumpTable(P, B, table, index, rallies.map(cases => () => cases[event](P)), { b: event });
}
// a case that judges by the point's outcome: the message from msgTable (queued by `queue` with the other side's
// offset b) and the judgement from resultTable, both indexed by wPointOutcome
export const byOutcome = (msgTable, queue, b, resultTable) => P => {
  const o = P.V.pointOutcome;
  queue(P, rb(P, at(msgTable, o)), b);
  return rb(P, at(resultTable, o));
};
export const ZERO = () => 0;                   // `xor a / ret`: no judgement yet
// the rally ends now with judgement j (+1 or -1): `ld a, MATCHABORT_POINT / ld [wMatchAbortFlag], a / ld a, j`
export function abortPoint(P, j) { P.V.matchAbortFlag = MATCHABORT_POINT; return j; }
// The four judge hooks: wDrillPointJudgement = JudgePoint(event) (a disabled one starts with `ret`)
export function judgeOn(P, judge, event) { P.V.drillPointJudgement = judge(P, event); }
// The judgement as the point's result: the coach's points are judged from his side (negated on odd points)
export function judgementAsResult(P) {
  const j = P.V.drillPointJudgement;
  return P.V.totalPointsScoredInCurrentGame & 1 ? (-j) & 0xFF : j;
}

// NetGameMatch1AwardPointToSide (0B:5491; the same code at ServiceMatch2 0B:4B05, ServiceMatch3 0B:4CEE,
// NetGameMatch2 0B:5724, NetGameMatch3 0B:5A4F, StrokeMatch2 0B:67C2, StrokeMatch3 0B:6A0D): a decided point goes to
// the player who earned it — the result is from the server's view, and the drill's sides alternate with the points
// (a point on the coach's serve counted for his opponent) — then the point count goes up and the fault is forgotten.
export function awardPointToSide(P) {
  const { V } = P;
  const flag = V.pointWinLoseFlag;
  if (!flag) return;
  const won = ((flag + 1) & 0xFF) >> 1;
  const a = (((V.totalPointsScoredInCurrentGame & 1) ^ 1) + won) & 0xFF;
  if (!(a & 1)) {
    if (a & 2) V.player1PointsWon = (V.player1PointsWon + 1) & 0xFF;
    else V.player2PointsWon = (V.player2PointsWon + 1) & 0xFF;
  }
  V.serveFaultFlag = 0;
  V.totalPointsScoredInCurrentGame = (V.totalPointsScoredInCurrentGame + 1) & 0xFF;
}

// The end of a judged point's display, shared by the drills' HandlePointEnd: both point counters' digits, a frame,
// the characters' reactions (optionally with the coach mirroring the player's result: a practice lesson), the
// end-of-point sequence. at: where the drill's code makes the waiting calls ({ frame: farcall StepMatchFrame,
// reactions: farcall StartPointEndReactions, end: call PlayDrillPointEndSequence }), for the ROM's stack.
export function* showPointsAndEndPoint(P, syncCoach, at) {
  yield* farWait(P, ROM.LoadPlayer1PointsDigitGfx, { a: P.V.player1PointsWon, b: 1 });
  yield* farWait(P, ROM.LoadPlayer2PointsDigitGfx, { a: P.V.player2PointsWon, b: 1 });
  yield* farcallAt(P, at.frame, ROM.StepMatchFrame);
  const task = { a: 1, h: SyncPointWinLoseFlagTask_ADDR >> 8, l: SyncPointWinLoseFlagTask_ADDR & 0xFF };
  if (syncCoach) far(P, ROM.RegisterFrameTask, task);
  yield* farcallAt(P, at.reactions, ROM.StartPointEndReactions);
  if (syncCoach) far(P, ROM.UnregisterFrameTask, task);
  yield* callAt(P, at.end, playDrillPointEndSequence(P));
}

// ---- hooks ----
export const HOOKS = [
  [B, 0x4705, hookGen((P, c) => runTrainingDrillByID(P, c.a))],                       // RunTrainingDrillByID
  [B, 0x4002, hookGen((P, c) => startDrillFromDefinition(P, c.bc))],                  // StartDrillFromDefinition
  [B, 0x407B, hook(P => recordDrillPointResultBits(P))],                              // RecordDrillPointResultBits
  [B, 0x40C0, hook((P, c) => { const a = countDrillShotSuccesses(P, c.a); return { a, f: a ? FLAG_N : FLAG_Z | FLAG_N }; })],   // CountDrillShotSuccesses
  [B, 0x40FD, hook(P => unusedCheckTwoPointLead(P))],                                 // Unused_0b_CheckTwoPointLead
  [B, 0x4122, hook(P => unusedGetBallXAndDepth(P))],                                  // Unused_0b_GetBallXAndDepth
  [B, 0x412F, hook((P, c) => unusedGetObjectXAndDepth(P, c.a))],                      // UnusedGetObjectXAndDepth
  [B, 0x414B, hook(P => resetActiveCharState(P))],                                    // ResetActiveCharState
  [B, 0x415F, hook((P, c) => indexDrillTableByPoint(P, c.hl))],                       // IndexDrillTableByPoint
  [B, 0x4191, hook((P, c) => setDrillTargetZoneForPoint(P, c.hl))],                   // SetDrillTargetZoneForPoint
  [B, 0x41C3, hook(P => updateDrillAbortCountdown(P))],                               // UpdateDrillAbortCountdown
  [B, 0x41DA, hook(P => recordDrillTargetZoneHitIfInPlay(P))],                        // RecordDrillTargetZoneHitIfInPlay
  [B, 0x41E6, hook(P => recordDrillTargetZoneHit(P))],                                // RecordDrillTargetZoneHit
  [B, 0x420B, hook(P => countDrillResultBitsSet(P))],                                 // CountDrillResultBitsSet
  [B, 0x421C, hook((P, c) => checkDrillTargetZoneMissed(P, c.f & FLAG_C))],           // CheckDrillTargetZoneMissed
  [B, 0x4233, hook(P => recordGateCrossOnServe(P))],                                  // RecordGateCrossOnServe
  [B, 0x4257, hook(P => countDrillResultBitsSetAlt(P))],                              // CountDrillResultBitsSetAlt
  [B, 0x4268, hook((P, c) => countDrillResultBitsThisGame(P, c.f & FLAG_C))],         // CountDrillResultBitsThisGame
  [B, 0x43A6, hookGen(P => playDrillPointEndSequence(P))],                            // PlayDrillPointEndSequence
  [B, 0x4404, hookGen((P, c) => loadDrillOpponentChar(P, c.a))],                      // LoadDrillOpponentChar
  [B, 0x441C, hookGen((P, c) => loadDrillOpponentBySide(P, c.hl))],                   // LoadDrillOpponentBySide
  [B, 0x442B, hook((P, c) => unusedWriteCharStructByte(P, c.a, c.hl))],               // Unused_0b_WriteCharStructByte
  [B, 0x4440, hook((P, c) => unusedSetAiReactionDelayFar(P, c.a))],                   // UnusedSetAiReactionDelayFar
  [B, 0x4447, hook((P, c) => testCharStateBit4(P, c.a, c.f))],                        // TestCharStateBit4
  [B, 0x446E, hook(P => syncPointWinLoseFlagTask(P))],                                // SyncPointWinLoseFlagTask
  [B, 0x4484, hook(P => unusedQueueDrillOutcomeMessage(P))],                          // UnusedQueueDrillOutcomeMessage
  [B, 0x44F2, hook(P => queueDrillOutcomeMessage(P))],                                // QueueDrillOutcomeMessage
  [B, 0x4534, hook((P, c) => queueDrillResultMessage(P, c.a, c.b))],                  // QueueDrillResultMessage
  [B, 0x4545, hook((P, c) => setDrillMessageByServer(P, c.a, c.b))],                  // SetDrillMessageByServer
  [B, 0x4558, hook((P, c) => setDrillMessageByRallyParity(P, c.a, c.b))],             // SetDrillMessageByRallyParity
  [B, 0x4574, hookGen(P => showQueuedDrillMessage(P))],                               // ShowQueuedDrillMessage
  [B, 0x4583, hookGen((P, c) => showDrillMessageByIndex(P, c.a))],                    // ShowDrillMessageByIndex
  [B, 0x46A0, hook(P => queueDrillMarker(P, P.A.drillGate1))],                        // QueueDrillMarker1_0b
  [B, 0x46C4, hook(P => queueDrillMarker(P, P.A.drillGate2))],                        // QueueDrillMarker2_0b
  [B, 0x47D8, hook(P => clearBGForDrillResult(P))],                                   // ClearBGForDrillResult
  [B, 0x4823, hook((P, c) => fillMemoryBC_0b(P, c.a, c.hl, c.bc))],                   // FillMemoryBC_0b
  [B, 0x7258, hookGen(P => runDoublesDrillMatch(P))],                                 // RunDoublesDrillMatch
  ...[0x4B05, 0x4CEE, 0x5491, 0x5724, 0x5A4F, 0x67C2, 0x6A0D].map(a => [B, a, hook(P => awardPointToSide(P))]),   // *AwardPointToSide
];

// ---- pieces the drills share ----
export const counter = (P, n) => P.bus.u8(P.A.drillCounters + n);
export const setCounter = (P, n, v) => P.bus.w8(P.A.drillCounters + n, v & 0xFF);
export const incCounter = (P, n) => setCounter(P, n, counter(P, n) + 1);
// <Drill>Hook_PointStart's common start: the abort countdown disarmed and reset to 10 frames
export function drillPointStartCommon(P) { P.V.drillAbortCountdownActive = 0; P.V.drillAbortCountdown = 0x0A; }
// a match drill decided by a two-point lead (the drills' PointEnd, after an even number of points): the leader
// wins the match (player 1 when player 2 is behind); returns whether it was decided
export function decideByTwoPointLead(P) {
  const d = (P.V.player2PointsWon - P.V.player1PointsWon) & 0xFF;
  const lead = d & 0x80 ? (-d) & 0xFF : d;
  if (lead < 2) return false;
  P.V.pointWinLoseFlag = d & 0x80 ? 0x01 : WINLOSE_LOSE;
  P.V.matchAbortFlag = MATCHABORT_MATCH;
  return true;
}
// NetGamePractice1HandlePointEnd (0B:5CF9; the same code at NetGamePractice2 0B:5FB3, NetGamePractice3 0B:6272)
// and StrokePractice1HandlePointEnd (0B:6C81; StrokePractice3 0B:712B), StrokePractice2HandlePointEnd (0B:6EC9):
// a practice lesson's point: the judgement is the result; a success counts in wDrillCounters + n, shown as
// player 1's points (player 2's: 0); the coach mirrors the result while the characters react. base: the copy's
// address (its waiting calls at the same offsets in every copy)
export const practicePointEndSites = base => ({ msg: base + 0x14, frame: base + 0x37, reactions: base + 0x42, end: base + 0x4B });
export function* practiceHandlePointEnd(P, n, base) {
  const at = practicePointEndSites(base);
  yield* farWait(P, ROM.UpdateScorePanelDisplay);
  P.V.pointWinLoseFlag = P.V.drillPointJudgement;
  if (P.V.drillPointJudgement === 1) incCounter(P, n);
  recordDrillPointResultBits(P);
  yield* callAt(P, at.msg, showQueuedDrillMessage(P));
  yield* farWait(P, ROM.UpdatePointStats);
  yield* farWait(P, ROM.AwardPoint);
  P.V.player1PointsWon = counter(P, n);
  P.V.player2PointsWon = 0;
  yield* showPointsAndEndPoint(P, true, at);
}
// a match drill's point shown from the judgement: (with counts: both sides' successes recounted into
// wDrillCounters + 1/2), the message, the stats, then the score kept by awardPoint
export function* matchJudgedPoint(P) {
  yield* farWait(P, ROM.UpdateScorePanelDisplay);
  P.V.pointWinLoseFlag = judgementAsResult(P);
  recordDrillPointResultBits(P);
}
export function countBothSides(P, first) {
  setCounter(P, first, countDrillShotSuccesses(P, 0));
  setCounter(P, first + 1, countDrillShotSuccesses(P, 1));
}
// a judge hook disabled by a leading `ret` (docs/bugs.md): does nothing
export const DISABLED = () => {};
// the four judge hooks of a drill as [address, event] -> the hook entries (disabled ones do nothing)
export function judgeHooks(judge, addrs, disabled = []) {
  return addrs.map((addr, event) => [B, addr, hook(P => { if (!disabled.includes(event)) judgeOn(P, judge, event); })]);
}
export { B as BANK_0B };
