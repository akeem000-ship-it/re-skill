// MatchEngine: a readable, exact port of Mario Tennis (GBC)'s match engine (bank $08 and the shot solver in
// $07 and the ball-path banks), running on its own copy of the game's RAM layout (memory.js). Each routine
// keeps its ROM name and address; web/tests/engine_*.mjs check them against the real code — per routine on
// states from recorded play, and frame by frame over whole recorded matches.
//
// Structure (one module per part of the ROM):
//   memory.js  RAM image and named fields      math.js   bank-0 fixed-point and trig helpers
//   ball.js    ball physics and ball events    shot.js   ExecuteShot and the trajectory tables
//   chars.js   the on-court characters         ai.js     the CPU player
//   flow.js    points, games, sets, scoring, court positions, camera
// Routines take the engine (E) first; E.S is the field view, E.M the math helpers, E.rom the ROM.
// Things the engine does not draw or play are reported through E.sfx(id) and E.banner(id), and the ROM routines
// outside the engine that the match code calls go through E.ext (below).
import { MatchMemory, matchState } from "./memory.js";
import { RomMath } from "./math.js";
import { queueCharFrameTiles } from "./chars.js";
import { drawBallAndEffects } from "./ball.js";

// The ROM routines outside the engine that the match code calls, by ROM name: the frame barrier, music, the pause
// menu and message windows, and the drawing (sprite slots and shadow OAM, the HUD objects and banners of bank $09,
// VRAM uploads). On its own the engine keeps of these only what the game reads back (the ball's ground projection,
// the effect timers, a character's sprite descriptor) and reports banners and music through E.events; the
// whole-game port replaces E.ext with the ROM's own routines (web/js/port/match/engine_port.js). Each takes E first.
const event = (...e) => E => { E.events.push(e); };
export const STANDALONE = {
  *advanceFrame() { yield "frame"; },                                    // AdvanceFrame (00:2631): one frame
  playMusic(E, id) { E.events.push(["bgm", id]); },                      // PlaySoundManaged (00:3024) with a music id
  *runMatchPauseMenu(E) {                                                // 06:4074, a menu loop of its own
    if (!E.pauseMenu) throw new Error("pause menu: no E.pauseMenu handler");
    yield* E.pauseMenu(E);
  },
  *showMessageWindow(E, text) {                                          // 06:44FE (text id hl; de, bc: the box)
    if (!E.messageWindow) throw new Error("message window: no E.messageWindow handler");
    yield* E.messageWindow(E, text);
  },
  *runLinkMatchFrame() { throw new Error("link play is not ported"); },  // 07:4762 RunLinkMatchFrame
  // the HUD objects and banners (bank $09)
  loadServeGfx: event("serveGfx"),                                       // 09:6C40
  updateScorePanelDisplay: event("scorePanel"),                          // 09:4098
  updatePointDigitsDisplay: event("pointDigits"),                        // 09:4036
  showCourtBanner(E, id) { E.banner(id); },                              // 09:4367
  hideCourtBanner(E) { E.banner(-1); },                                  // 09:437B
  setObjPosition(E, slot, de) { E.events.push(["objPos", slot, de]); }, // 09:45C4
  spawnGameScoreDisplayObjs: event("scoreDisplay", 1),                   // 09:412A
  dismissGameScoreDisplayObjs: event("scoreDisplay", 0),                 // 09:4190
  spawnWinLoseResultObj(E, a) { E.events.push(["winLose", a]); },       // 09:42D8
  dismissWinLoseResultObj: event("winLose", 0),                          // 09:42F6
  spawnGameResultObj: event("gameResult", 1),                            // 09:422C
  dismissGameResultObj: event("gameResult", 0),                          // 09:4238
  loadPlayer1ScoreDigitGfx(E, a, b) { E.events.push(["scoreDigits", 1, a, b]); },   // 09:612A
  loadPlayer2ScoreDigitGfx(E, a, b) { E.events.push(["scoreDigits", 2, a, b]); },   // 09:6139
  showMinigamePointResult(E, d) { E.events.push(["minigameResult", d]); },          // 0D:4412
  spawnServeIndicatorObjs() {},                                          // 09:4242
  dismissServeIndicatorObjs() {},                                        // 09:4282
  loadOnCourtCharacterGfx() {},                                          // 09:40B5
  updateAllObjSprites() {},                                              // 09:4695
  // the court picture (court_08): the scoreboard columns after a change of ends, and their upload
  refreshCourtScoreboard() {},                                           // 08:5E93
  uploadCourtScoreboardRows: event("courtRedraw"),                       // 08:5F61 (in RefreshCourtAfterEndChange)
  // the frame's drawing (bank $08)
  clearSpriteSlots() {},                                                 // 08:630E
  buildBallSlot() {},                                                    // 08:519D
  buildBallTrailSlots() {},                                              // 08:51FD
  buildBallShadowSlot(E) {                                               // 08:5253: the ground projection (the camera's target)
    const S = E.S, p = E.M.projectWorldToScreen(S.ballX & 0xFFFF, S.ballDepth & 0xFFFF, 0);
    S.ballGroundProjX = p.hl; S.ballGroundProjY = p.bc;
  },
  buildNetBallSlot() {},                                                 // 08:528C
  drawBallTouchCharEffect(E) { if (E.S.ballTouchCharTimer) E.S.ballTouchCharTimer--; },   // 08:5482: its timer
  shiftBallHistory() {},                                                 // 08:5170 (in UpdateBallVisuals)
  drawActorsByDepth(E) { drawBallAndEffects(E); },                       // 08:6429: the special-hit timer, mode hook 7
  updateMinigameTargets(E) { if (E.minigameTargets) E.minigameTargets(E); },   // 0A:65C3 (drills)
  drawMarkersAndShadows() {},                                            // 08:6481
  queueCharFrameTiles(E, de) { queueCharFrameTiles(E, de); },            // 00:2E6B: the sprite descriptor only
};

export class MatchEngine {
  // mem: the engine's own RAM image (default), or the whole-game port's bus over the hardware (web/js/port/bus.js)
  constructor(rom, mem = new MatchMemory()) {
    this.rom = rom;
    this.mem = mem;
    this.S = matchState(this.mem);
    this.M = new RomMath(rom, this.mem);
    this.events = [];
    this.ext = STANDALONE;
  }
  sfx(id) { this.events.push(["sfx", id]); }               // rst $08 ; db id
  banner(id) { this.events.push(["banner", id]); }         // ShowCourtBanner (bank $09)
  // the character struct of the WRAM bank currently mapped (hWramBank), as the ROM's code sees "wChar*"
  get C() { return this.S.chars[this.mem.bank - 4]; }
  // run fn with WRAM bank 4 + k mapped (wram_bank WRAM_CHARk)
  inChar(k, fn) { return this.mem.withBank(4 + k, fn); }
  setBank(bank) { this.mem.bank = bank; this.mem.w8(0xFF96, bank); }
  // push_wram_bank b ... pop_wram_bank around fn: the mapping hWramBank had is restored to both
  withWramBank(bank, fn) { const old = this.mem.u8(0xFF96); this.setBank(bank); try { return fn(); } finally { this.setBank(old); } }
}
