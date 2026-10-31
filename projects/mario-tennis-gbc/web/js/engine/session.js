// EngineMatch: an exhibition match on the exact engine, for the web port (main.js). It builds the records the
// menus would (roster characters, CPU difficulty), runs RunMatch as a coroutine one frame per update(pad), and
// exposes what a renderer needs: positions, sprite frames, ball, camera scroll, score, banners and sounds.
import { MatchEngine } from "./engine.js";
import * as setup from "./setup.js";

// pad bits as the ROM keeps them (hPlayerInputFlags): A, B, Select, Start, Right, Left, Up, Down
export const PAD = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128 };
const FACING_TILE_ROW = 0x7643, OCTANT_FLIP = 0x76FC;                   // 08: the frame row and X flip per octant

export class EngineMatch {
  // cfg: { p1, p2 (roster ids), court, games (2 or 6), sets (1/3/5), difficulty (0 easy .. 3 intense) }
  constructor(rom, cfg) {
    const E = this.E = new MatchEngine(rom);
    this.rom = rom; this.cfg = cfg; this.prev = 0; this.over = false; this.paused = false; this.message = null;
    setup.initRosterRecord(E, 0, cfg.p1);
    setup.initRosterRecord(E, 2, cfg.p2);
    setup.applyCpuDifficulty(E, 2, (cfg.difficulty ?? 1) + 1);
    setup.setMatchSettings(E, { court: cfg.court ?? 2, sets: cfg.sets || 1, games: cfg.games || 2, bgm: 0x06, gameMode: 0x04 });   // exhibition: match music $06, wGameMode 4
    E.mem.w8(0xCA0B, cfg.p1); E.mem.w8(0xCA8B, cfg.p2);                   // wPlayer1/2CurrentMainCharacter
    // UI the page draws itself: the pause menu waits for START again; message windows wait for A
    E.pauseMenu = function* () { this.paused = true; do yield "frame"; while (!(E.mem.u8(0xFF94) & PAD.START)); this.paused = false; }.bind(this);
    E.messageWindow = function* (_, text) { this.message = text; do yield "frame"; while (!(E.mem.u8(0xFF94) & (PAD.A | PAD.B))); this.message = null; }.bind(this);
    this.G = setup.runMatch(E, { vblankCounter: cfg.seed ?? ((Math.random() * 256) | 0) });   // (seed: a fixed start for tests)
    this.G.next();                                                        // up to the first frame
  }
  // one Game Boy frame with the pad held this frame; returns the events of the frame
  update(pad) {
    const E = this.E;
    E.mem.w8(0xFF90, pad); E.mem.w8(0xFF94, pad & ~this.prev); E.mem.w8(0xFF91, pad & ~this.prev); this.prev = pad;
    // drawing-side bookkeeping the game's VBlank code does (WaitFrame): a fresh shadow OAM page each frame
    E.S.spriteBufferPage = 0xC0; E.S.spriteQueueIndex = 0;
    E.events.length = 0;
    if (!this.over) { const r = this.G.next(); if (r.done) this.over = true; }
    return E.events;
  }
  get S() { return this.E.S; }
  // the court picture's scroll in pixels (hScrollX/Y)
  get scroll() { return { x: this.E.mem.u8(0xFF8B), y: this.E.mem.u8(0xFF8A) }; }
  // screen position (pixels) of a world point, through the game's projection and camera (ApplyCameraProjection)
  screen(x, depth, height = 0) {
    const S = this.E.S, p = this.E.M.projectWorldToScreen(x & 0xFFFF, depth & 0xFFFF, height & 0xFFFF);
    const sx = ((S.cameraOffsetX + p.hl) << 16 >> 16) / 32, sy = ((S.cameraOffsetY + p.bc) << 16 >> 16) / 32;
    return [sx, sy];
  }
  // the characters on court: position, sprite frame number (animation frame * 5 + facing row) and X flip
  get players() {
    const S = this.E.S, n = S.onCourtCharCount, out = [];
    for (let k = 0; k < n; k++) {
      const C = S.chars[k];
      let attr = (C.spriteAttr | 0x08) ^ this.rom.u8(8, OCTANT_FLIP + (C.facingOctant & 7));
      if ((C.facingOctant & 7) === 2 || (C.facingOctant & 7) === 6) attr ^= C.mirrorAttrMask;
      out.push({ index: k, x: C.posXInt, depth: C.posDepthInt, height: C.posHeightInt, state: C.state,
                 frame: C.animFrame === 0xFF ? 0 : C.animFrame * 5 + this.rom.u8(8, FACING_TILE_ROW + (C.facingOctant & 7)),
                 flip: (attr & 0x20) !== 0, anim: C.animId, result: C.pointResult });
    }
    return out;
  }
  get ball() { const S = this.E.S; return { x: S.ballX, depth: S.ballDepth, height: S.ballHeight, visible: !!S.ballSpriteEnabled, shadow: !!S.ballShadowEnabled }; }
  // score: points 0-3 = 0/15/30/40, 4 = advantage (tiebreak: plain counts), games, sets
  get score() {
    const S = this.E.S;
    return { points: [S.player1PointsWon, S.player2PointsWon], games: [S.player1GamesWon, S.player2GamesWon], sets: [S.player1SetsWon, S.player2SetsWon],
             tiebreak: !!S.tiebreakerIndicator, deuce: !!S.deuceIndicator, server: S.currentServingPlayer, winner: S.matchWinLoseFlag };
  }
}
// banner ids (ShowCourtBanner) as text for a page without the banner graphics
export const BANNER_TEXT = { 0x00: "CHANGE ENDS", 0x01: "FAULT", 0x02: "DOUBLE FAULT", 0x03: "LET", 0x04: "NET", 0x05: "OUT",
  0x07: "GAME POINT", 0x08: "BREAK POINT", 0x09: "SET POINT", 0x0A: "MATCH POINT", 0x0B: "GAME", 0x0C: "SET", 0x0D: "GAME SET",
  0x0E: "POWER SERVE", 0x0F: "TIEBREAK", 0x18: "SERVICE ACE", 0x19: "RETURN ACE", 0x1A: "SMASH ACE", 0x1B: "LOB WINNER", 0x1C: "DROP SHOT" };
