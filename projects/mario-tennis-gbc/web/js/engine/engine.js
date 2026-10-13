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
// Things the engine does not draw or play are reported through E.sfx(id) and E.banner(id).
import { MatchMemory, matchState } from "./memory.js";
import { RomMath } from "./math.js";

export class MatchEngine {
  constructor(rom) {
    this.rom = rom;
    this.mem = new MatchMemory();
    this.S = matchState(this.mem);
    this.M = new RomMath(rom, this.mem);
    this.events = [];
  }
  sfx(id) { this.events.push(["sfx", id]); }               // rst $08 ; db id
  banner(id) { this.events.push(["banner", id]); }         // ShowCourtBanner (bank $09)
  // the character struct of the WRAM bank currently mapped (hWramBank), as the ROM's code sees "wChar*"
  get C() { return this.S.chars[this.mem.bank - 4]; }
  // run fn with WRAM bank 4 + k mapped (wram_bank WRAM_CHARk)
  inChar(k, fn) { return this.mem.withBank(4 + k, fn); }
  setBank(bank) { this.mem.bank = bank; this.mem.w8(0xFF96, bank); }
}
