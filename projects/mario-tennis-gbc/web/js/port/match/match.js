// Starting and ending a match, the court picture's scoreboard, and the minigame match (bank $08): ports of the
// setup half of match_08, match_frames_08, court_08 and minigame_08, and the drill helpers of char_update_08, in the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm), whose names and addresses these
// are. The match itself runs on the engine (web/js/engine, hooked in match_loop.js); routines of other parts of the
// game (fades, the LCD, menus, the court loader, rewards) are called as the ROM's.
// Covered by out/engine/exh1.mtrec (an exhibition match from power-on) and rec1.mtrec (a ranking match).
import * as flow from "../../engine/flow.js";
import * as ball from "../../engine/ball.js";
import * as chars from "../../engine/chars.js";
import * as setup from "../../engine/setup.js";
import { setBallTrailColor } from "../../engine/shot.js";
import { engine, playSoundManaged } from "./engine_port.js";
import * as draw from "./draw.js";
import * as obj from "./obj.js";
import { loadMatchGraphics } from "./variants.js";

const COURT_HARD = 0x00, BGM_COURT_STAR = 0x11, MATCHCONTEXT_MINIGAME = 2, GAMEMODE_ISLAND_OPEN = 0x02, GAMEMODE_MARIO_MINIGAME = 0x08;
const GAMEMODE_LINK_MATCH = 0x09, MATCHABORT_POINT = 0x01, MATCHABORT_MATCH = 0x80, POINTOUTCOME_BALL_HIT_PLAYER = 9;
const WRAM_COURT_PLANES = 2, WRAM_ACTORS = 4, INIT_SERIAL_LINK = 0x28B9;
// RAM the setup touches outside the engine's fields
const W = {
  matchMenuSelection: 0xC4E0, keepMatchStatsFlag: 0xC8A7, modeScratch: 0xC780, aiServeAimOverride: 0xC7B5,
  shadowTilemapBank: 0xC3B3, windowTileAttr: 0xC3B6, scoreDisplayIsTiebreak: 0xC7BD, matchExitRequest: 0xC4C7,
  minigamePointTable: 0xC7B0, modeHookTable: 0xC7B2, modeHookBank: 0xC7B4, drillGate1: 0xC798, drillGate2: 0xC79C,
  targetZoneX1: 0xC790, targetZoneDepth1: 0xC792, targetZoneX2: 0xC794, targetZoneDepth2: 0xC796,
  courtTilemap: 0xD000, courtAttrmap: 0xD400, courtTilemapSaved: 0xD800, courtAttrmapSaved: 0xDC00,   // WRAM bank 2
  scoreboardColumnTiles: 0xDE80, scoreboardColumnAttrs: 0xDEA8, textBuffer: 0xC600,                   // bank 4 / WRAM0
};
const u8 = v => v & 0xFF, u16 = v => v & 0xFFFF, S16 = v => (v << 16) >> 16;
const clearMemory16 = (P, hl, c) => { for (let i = 0; i < c * 16; i++) P.bus.w8(hl + i, 0); };   // ClearMemory16 (00:03AF)
const copyMemoryFast = (P, hl, de, c) => { for (let i = 0; i < c * 16; i++) P.bus.w8(de + i, P.bus.u8(hl + i)); };   // CopyMemoryFast (00:03F3)
const advanceFrame = P => P.runRom(0, 0x2631);                           // AdvanceFrame
function* fadeOut(P) { P.callRom(0, 0x1D20, { c: 32 }); yield* P.runRom(0, 0x1DA4); }   // BeginFadeOut 32, WaitFadeEnd

// ---- settings and setup (match_08, match_frames_08) ----
// 08:4070 InitDefaultMatchSettings: a 1-set, 2-game singles exhibition on the hard court, the Court Star theme
export function initDefaultMatchSettings(P) {
  const E = engine(P), S = E.S, bus = P.bus;
  bus.w8(W.keepMatchStatsFlag, 0);
  clearMemory16(P, W.matchMenuSelection, 2);
  clearMemory16(P, 0xC8F0, 1);                                           // wMatchTypeNumberOfSets..
  clearMemory16(P, W.modeScratch, 8);
  S.currentlyUsedCourt = COURT_HARD; S.matchTypeNumberOfSets = 1; S.matchTypeNumberOfGames = 2;
  S.matchIsDoubles = 0; S.onCourtCharCount = 2; S.matchBGM = BGM_COURT_STAR;
}
// 08:6544 InitMinigameMatchSettings
export function initMinigameMatchSettings(P) {
  initDefaultMatchSettings(P);
  const bus = P.bus;
  engine(P).S.matchContext = MATCHCONTEXT_MINIGAME;
  bus.w8(W.scoreDisplayIsTiebreak, 1);
  bus.w8(W.aiServeAimOverride, 0xFF);
}
// 08:450E InitViewFlipPreference: link play and minigames keep the view fixed; otherwise the save's option
// (02:4CD4 TestStorySlotFlagB) decides whether the view follows the player's end
export function initViewFlipPreference(P) {
  const S = engine(P).S;
  if (S.gameMode === GAMEMODE_LINK_MATCH || S.matchContext === MATCHCONTEXT_MINIGAME || S.gameMode === GAMEMODE_MARIO_MINIGAME) {
    S.courtViewOption = 0; S.courtViewLocked = 1; return;
  }
  S.courtViewOption = P.callRom(2, 0x4CD4).a;
  S.courtViewLocked = 0;
}
// 08:4539 ApplyMatchBgmPreference: the save's music option (02:4D10 TestStorySlotFlagA -> 00:2F86 SetMusicMuted);
// link play always resumes the music (00:2F32 ResumeBGM)
export function applyMatchBgmPreference(P) {
  if (engine(P).S.gameMode === GAMEMODE_LINK_MATCH) { P.callRom(0, 0x2F32); return; }
  P.callRom(0, 0x2F86, { a: P.callRom(2, 0x4D10).a });
}
// 08:5E28 LoadCourtSceneData: scroll 0, the court's damping bytes (CourtSceneDataTable 08:5DC4), its graphics
// (0A:62F8 LoadCourtSceneGraphics), then the live court maps from the saved ones; hWramBank kept
export function loadCourtSceneData(P) {
  const S = engine(P).S, bank = P.V.wramBank;
  P.V.scrollX = 0; P.V.scrollY = 0;
  const row = u16(0x5DC4 + u8(S.currentlyUsedCourt * 4));
  S.courtSurfaceFriction = P.rom.u8(8, row);
  S.courtSurfaceBounce = P.rom.u8(8, row + 1);
  P.callRom(0x0A, 0x62F8, { a: P.rom.u8(8, row + 2) });
  snapshotCourtTilemaps(P);
  P.wramBank(bank);
}
// 08:4145 InitMatchScene: everything a match needs before the LCD comes on (the engine's state, the objects, the
// court map with its scoreboard, the match graphics of bank $28)
export function initMatchScene(P) {
  const E = engine(P), bus = P.bus;
  P.callRom(0, 0x1B38);                                                  // ClearFrameTasks
  P.callRom(5, 0x6E09);                                                  // ResetTextWindowState
  bus.w8(W.shadowTilemapBank, 2); bus.w8(W.windowTileAttr, 0);
  flow.resetMatchState(E, P.V.vBlankCounter);
  initViewFlipPreference(P);
  applyMatchBgmPreference(P);
  loadCourtSceneData(P);
  P.wramBank(WRAM_ACTORS);
  ball.resetBallState(E, a => setBallTrailColor(E, a));
  chars.initAllChars(E);
  obj.initAllObjSlots(P);
  draw.clearSpriteSlots(P);
  flow.assignCourtPositions(E);
  E.S.changeEndsPending = 0;
  obj.updatePointDigitsDisplay(P);
  refreshCourtScoreboard(P);
  uploadCourtTilemap(P);
  uploadCourtAttrmap(P);
  loadMatchGraphics(P);
  P.wramBank(WRAM_ACTORS);
}
// 08:4190 RunMatch: fade out, build the scene with the LCD off, the match music, fade in, the court intro and the
// match; then the minigame result screens, the win/lose screen and the rewards
export function* runMatch(P) {
  const E = engine(P), S = E.S;
  yield* fadeOut(P);
  yield* advanceFrame(P);
  yield* P.runRom(0, 0x0346);                                            // DisableLCDSafely
  initMatchScene(P);
  P.callRom(0, 0x0376);                                                  // EnableLCD
  yield* P.runRom(7, 0x4846);                                            // UpdateLinkSession (link play: waits)
  playSoundManaged(P, S.matchBGM);
  clearMemory16(P, W.modeScratch, 8);
  P.bus.w8(W.aiServeAimOverride, 0xFF);
  P.callRom(0, 0x1D2E, { c: 32 });                                       // BeginFadeIn 32
  P.wramBank(WRAM_ACTORS);
  yield* setup.playCourtIntro(E);
  S.matchSimFrozen = 0;
  yield* flow.runMatchPlayLoop(E);
  S.matchEndLinkState = S.linkState;
  endLinkSession(P);
  if (S.gameMode === GAMEMODE_MARIO_MINIGAME) yield* showMatchResultScreens(P);
  yield* fadeOut(P);
  yield* advanceFrame(P);
  yield* P.runRom(0x16, 0x4477);                                         // RunMatchWinLoseScreen
  P.callRom(1, 0x50E2);                                                  // LoadMenuFontGfx
  yield* advanceFrame(P);
  yield* P.runRom(0x1E, 0x6534);                                         // ProcessMatchRewards
}

// 07:48F6 EndLinkSession: the link session over, the serial port reset (00:28B9 InitSerialLink)
export function endLinkSession(P) { engine(P).S.linkSessionActive = 0; P.callRom(0, INIT_SERIAL_LINK); }

// ---- the court picture (court_08) ----
// 08:5E52 SnapshotCourtTilemaps: the court's tile and attribute maps restored from their saved copies (WRAM bank 2,
// left mapped)
export function snapshotCourtTilemaps(P) {
  P.wramBank(WRAM_COURT_PLANES);
  copyMemoryFast(P, W.courtTilemapSaved, W.courtTilemap, 0x40);
  copyMemoryFast(P, W.courtAttrmapSaved, W.courtAttrmap, 0x40);
}
// 08:5E6F UploadCourtTilemap / 08:5E81 UploadCourtAttrmap: the whole map queued for VRAM (bank 2 left mapped)
export function uploadCourtTilemap(P) { P.wramBank(WRAM_COURT_PLANES); P.callRom(0, 0x0480, { h: 0xD0, l: 0x00, d: 0x98, e: 0x00, c: 0x40 }); }
export function uploadCourtAttrmap(P) { P.wramBank(WRAM_COURT_PLANES); P.callRom(0, 0x0480, { h: 0xD4, l: 0x00, d: 0xB8, e: 0x00, c: 0x40 }); }
// 08:5E93 RefreshCourtScoreboard: the scoreboard's two columns (2 x 5 tiles at row 12, columns 26 and 4) into the
// saved court maps, from the column sets in bank 4 by the view's flip; unless the view is locked
export function refreshCourtScoreboard(P) {
  const S = engine(P).S, ROW12 = 12 * 32;
  if (S.courtViewLocked & 1) return;
  const [right, left] = S.courtViewFlipped ? [30, 0] : [20, 10];       // 08:5EC7 RefreshCourtScoreboardFlipped
  const cols = S.courtViewFlipped ? [[left, 4], [right, 26]] : [[right, 26], [left, 4]];
  for (const [src, col] of cols) {
    copyScoreboardTileColumn(P, W.scoreboardColumnTiles + src, W.courtTilemapSaved + ROW12 + col);
    copyScoreboardTileColumn(P, W.scoreboardColumnAttrs + src, W.courtAttrmapSaved + ROW12 + col);
  }
  snapshotCourtTilemaps(P);
}
// 08:5EEF CopyScoreboardTileColumn: a 2 x 5 tile block (hl, bank 4, through wTextBuffer) to the map at de (bank 2)
export function copyScoreboardTileColumn(P, hl, de) {
  P.wramBank(WRAM_ACTORS);
  copyMemoryFast(P, hl, W.textBuffer, 2);
  P.wramBank(WRAM_COURT_PLANES);
  for (let row = 0; row < 5; row++) {
    P.bus.w8(de, P.bus.u8(W.textBuffer + row * 2)); P.bus.w8(de + 1, P.bus.u8(W.textBuffer + row * 2 + 1));
    de = u16(de + 32);
  }
}

// ---- the minigame match (minigame_08) ----
// a byte at addr with ROM bank `bank` mapped at $4000 (FarReadByte, FarCopyBytes): RAM past $8000
const farByte = (P, bank, addr) => (u16(addr) < 0x8000 ? P.rom.u8(bank, u16(addr)) : P.bus.u8(addr));
// 08:66F1 CallModeHook: entry d of the minigame's hook table (wModeHookTable in bank wModeHookBank), if one is set.
// Returns the call's registers' parts the ROM sets up: the hook runs with a = its bank, bc = hl = its address.
function modeHookCall(P, d) {
  const bus = P.bus, bank = bus.u8(W.modeHookBank);
  if (!bank) return null;
  const ptr = u16(bus.u16(W.modeHookTable) + u8(d * 2));
  const hook = farByte(P, bank, ptr) | farByte(P, bank, ptr + 1) << 8;   // FarReadWord
  return { bank, hook, regs: { a: bank, b: hook >> 8, c: hook & 0xFF, h: hook >> 8, l: hook & 0xFF, d } };
}
export function callModeHook(P, d) {
  const call = modeHookCall(P, d);
  if (call) P.callRom(call.bank, call.hook, call.regs);                  // CallHLInBankA
}
// the same for the hooks that run frames (point start and end, the match start)
export function* callModeHookWaiting(P, d) {
  const call = modeHookCall(P, d);
  if (call) yield* P.runRom(call.bank, call.hook, call.regs);
}
// 08:671A SetModeHookTable: a = the bank, de = the table
export function setModeHookTable(P, a, de) { P.bus.w8(W.modeHookBank, a); P.bus.w16(W.modeHookTable, de); }
// 08:6557 RunMinigameMatch: as RunMatch, with the minigame's point loop and no intro
export function* runMinigameMatch(P) {
  const E = engine(P), S = E.S;
  yield* fadeOut(P);
  yield* advanceFrame(P);
  yield* P.runRom(0, 0x0346);                                            // DisableLCDSafely
  initMatchScene(P);
  P.callRom(0, 0x0376);                                                  // EnableLCD
  playSoundManaged(P, S.matchBGM);
  P.callRom(0, 0x1D2E, { c: 32 });                                       // BeginFadeIn 32
  S.matchSimFrozen = 0;
  yield* runMinigamePointLoop(P);
  yield* showMatchResultScreens(P);
  yield* fadeOut(P);
  yield* advanceFrame(P);
  P.callRom(1, 0x50E2);                                                  // LoadMenuFontGfx
  yield* advanceFrame(P);
}
// 08:6592 ShowMatchResultScreens: unless the player quit, the minigame's end menu (a lost Mario minigame,
// 06:400E RunMinigameEndMenu) or the scoreboard screen (06:48AD ShowMatchScoreboardScreen), the match frozen
export function* showMatchResultScreens(P) {
  const S = engine(P).S;
  if (S.matchExitRequest) return;
  S.matchSimFrozen = 0xFF; S.matchDrawFrozen = 0xFF;
  if (S.gameMode === GAMEMODE_MARIO_MINIGAME && (S.pointWinLoseFlag & 0xFF) !== 0x01) yield* P.runRom(6, 0x400E);
  else yield* P.runRom(6, 0x48AD);
  S.matchDrawFrozen = 0; S.matchSimFrozen = 0;
}
// 08:65BE RunMinigamePointLoop: the CPU made a sitting duck (strategy 0, no delays, never aims away), the
// minigame's start hook (3); then point after point from the minigame's point table (8-byte layouts, until an
// $FF), each with the point-start (1) and point-end (2) hooks
export function* runMinigamePointLoop(P) {
  const E = engine(P), S = E.S;
  P.wramBank(4);
  const C = E.C;
  C.aiPositionStrategy = 0; C.aiReactionDelayNear = 0; C.aiReactionDelayFar = 0; C.aiAimAwayChance = 0;
  yield* callModeHookWaiting(P, 3);
  if (S.matchAbortFlag & MATCHABORT_MATCH) return;
  for (;;) {
    loadMinigamePointLayout(P);
    flow.resetPointState(E);
    yield* callModeHookWaiting(P, 1);
    if (S.matchAbortFlag & MATCHABORT_MATCH) return;
    if (!S.minigameUsesTennisMachine) chars.forEachCharBank(E, () => chars.setCharState(E, P.rom.u8(8, 0x4FA0 + E.C.serveRole)));   // SetCharStateFromServeRole
    yield* playMinigamePoint(P);
    if (S.matchAbortFlag & MATCHABORT_MATCH) return;
    yield* callModeHookWaiting(P, 2);
    if (S.matchAbortFlag & MATCHABORT_MATCH) return;
    const next = u16(P.bus.u16(W.minigamePointTable) + u8(S.totalPointsScoredInCurrentGame * 8));
    if (farByte(P, P.bus.u8(W.modeHookBank), next) === 0xFF) return;     // FarReadByte
  }
}
// 08:6631 PlayMinigamePoint: the serve graphic, the rally until the point ends (or is aborted), the fault and
// ace bookkeeping (the score is the minigame's)
export function* playMinigamePoint(P) {
  const E = engine(P), S = E.S;
  E.ext.loadServeGfx(E);
  yield* flow.stepMatchFrame(E);
  S.unusedMinigamePointFlag = 1;
  do {
    yield* flow.stepMatchFrame(E);
    if (S.matchAbortFlag & MATCHABORT_POINT) break;
  } while (!S.pointOutcome);
  if (S.pointOutcome === POINTOUTCOME_BALL_HIT_PLAYER) yield* flow.stepMatchFrames(E, 40);
  flow.endPointBallEffects(E);
  flow.handleServeFault(E);
  flow.flagServiceReturnAce(E);
}
// 08:6662 LoadMinigamePointLayout: this point's 8-byte layout from the minigame's table (FarCopyBytes into a stack
// buffer): four court positions and four serve roles (2 bits each), then the server and facings
export function loadMinigamePointLayout(P) {
  const E = engine(P), S = E.S, bus = P.bus, bank = bus.u8(W.modeHookBank);
  if (!bank) return;
  const src = u16(bus.u16(W.minigamePointTable) + u8(S.totalPointsScoredInCurrentGame * 8));
  const layout = Array.from({ length: 8 }, (_, i) => farByte(P, bank, src + i));   // FarCopyBytes
  // (the ROM copies it to 8 bytes of stack below the return address: the stack page is not compared)
  for (let k = 0; k < 4; k++) { P.wramBank(4 + k); E.C.courtPos = layout[k] & 3; }
  for (let k = 0; k < 4; k++) { P.wramBank(4 + k); E.C.serveRole = layout[4 + k] & 3; }
  P.wramBank(WRAM_ACTORS);
  flow.identifyServingPlayer(E);
  chars.forEachCharBank(E, () => flow.setCharFacingFromCourtPos(E));
}

// ---- the drills' gates and target zones (char_update_08) ----
// 08:6728 SetMinigamePointTable (de) / 08:6731 SetBallGatePoint1 / 08:6740 SetBallGatePoint2 (x = hl, depth = de) /
// 08:674F SetTargetZoneCorner1 / 08:675E SetTargetZoneCorner2
export function setMinigamePointTable(P, de) { P.bus.w16(W.minigamePointTable, de); }
export function setBallGatePoint1(P, hl, de) { P.bus.w16(W.drillGate1 + 2, de); P.bus.w16(W.drillGate1, hl); }
export function setBallGatePoint2(P, hl, de) { P.bus.w16(W.drillGate2 + 2, de); P.bus.w16(W.drillGate2, hl); }
export function setTargetZoneCorner1(P, hl, de) { P.bus.w16(W.targetZoneDepth1, de); P.bus.w16(W.targetZoneX1, hl); }
export function setTargetZoneCorner2(P, hl, de) { P.bus.w16(W.targetZoneDepth2, de); P.bus.w16(W.targetZoneX2, hl); }
// 08:676D DidBallCrossGate: the ball passed the gate's depth this frame (its previous and current depth on either
// side) between the X of gate point 1 and gate point 2 -> 1, else 0
export function didBallCrossGate(P) {
  const S = engine(P).S, bus = P.bus, gateDepth = bus.u16(W.drillGate1 + 2);
  const before = u16(S.ballPrevDepth - gateDepth), now = u16(S.ballDepth - gateDepth);
  if (!((before ^ now) & 0x8000)) return 0;
  if (u16(S.ballX - bus.u16(W.drillGate1)) & 0x8000) return 0;
  if (!(u16(S.ballX - bus.u16(W.drillGate2)) & 0x8000)) return 0;
  return 1;
}
// 08:67C2 IsBallInTargetZone: X1 - 16 <= ballX < X2 + 16 and depth1 - 16 <= ballDepth < depth2 + 16 (16-bit
// differences, sign bit) -> 1, else 0; WRAM bank 4 mapped meanwhile (push_wram_bank)
export function isBallInTargetZone(P) {
  const S = engine(P).S, bus = P.bus, old = P.V.wramBank;
  P.wramBank(WRAM_ACTORS);
  const neg = v => (u16(v) & 0x8000) !== 0;
  const inside = !neg(S.ballX - u16(bus.u16(W.targetZoneX1) + 0xFFF0)) && neg(S.ballX - u16(bus.u16(W.targetZoneX2) + 0x0010))
    && !neg(S.ballDepth - u16(bus.u16(W.targetZoneDepth1) + 0xFFF0)) && neg(S.ballDepth - u16(bus.u16(W.targetZoneDepth2) + 0x0010));
  P.wramBank(old);
  return inside ? 1 : 0;
}

const REGS = ["a", "f", "b", "c", "d", "e", "h", "l"];
const keeping = gen => (P, c) => (function* () { const r = REGS.map(k => c[k]); yield* gen(P, c); REGS.forEach((k, i) => { c[k] = r[i]; }); })();
// a = 1 or 0 with the flags of `xor a / inc a` (Z clear) or `xor a` (Z set)
const yesNo = (c, v) => { c.a = v; c.f = v ? 0x00 : 0x80; };
export const HOOKS = [
  [7, 0x48F6, P => endLinkSession(P)],
  [8, 0x4070, P => initDefaultMatchSettings(P)],
  [8, 0x6544, P => initMinigameMatchSettings(P)],
  [8, 0x450E, P => initViewFlipPreference(P)],
  [8, 0x4539, P => applyMatchBgmPreference(P)],
  [8, 0x5E28, P => loadCourtSceneData(P)],
  [8, 0x4145, P => initMatchScene(P)],
  [8, 0x4190, keeping(runMatch)],
  [8, 0x5E52, P => snapshotCourtTilemaps(P)],
  [8, 0x5E6F, P => uploadCourtTilemap(P)],
  [8, 0x5E81, P => uploadCourtAttrmap(P)],
  [8, 0x5E93, P => refreshCourtScoreboard(P)],
  [8, 0x5EEF, (P, c) => copyScoreboardTileColumn(P, c.hl, c.de)],
  [8, 0x66F1, keeping((P, c) => callModeHookWaiting(P, c.d))],          // (registers kept: push ... pop)
  [8, 0x671A, (P, c) => setModeHookTable(P, c.a, c.de)],
  [8, 0x6557, keeping(runMinigameMatch)],
  [8, 0x6592, keeping(showMatchResultScreens)],
  [8, 0x65BE, keeping(runMinigamePointLoop)],
  [8, 0x6631, keeping(playMinigamePoint)],
  [8, 0x6662, P => loadMinigamePointLayout(P)],
  [8, 0x6728, (P, c) => setMinigamePointTable(P, c.de)],
  [8, 0x6731, (P, c) => { setBallGatePoint1(P, c.hl, c.de); c.bc = c.hl; }],
  [8, 0x6740, (P, c) => { setBallGatePoint2(P, c.hl, c.de); c.bc = c.hl; }],
  [8, 0x674F, (P, c) => { setTargetZoneCorner1(P, c.hl, c.de); c.bc = c.hl; }],
  [8, 0x675E, (P, c) => { setTargetZoneCorner2(P, c.hl, c.de); c.bc = c.hl; }],
  [8, 0x676D, (P, c) => yesNo(c, didBallCrossGate(P))],
  [8, 0x67C2, (P, c) => yesNo(c, isBallInTargetZone(P))],
];
