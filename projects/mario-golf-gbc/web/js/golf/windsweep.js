// Bank 3C's debug wind sweep (unreferenced: export $04 has no caller; REVERSE.md "Debug leftover"): every club, 16
// wind angles and wind speeds 1-9, a perfect full-power shot straight up the screen, its angle and carry logged to the
// save RAM through the cartridge RAM window (render/display.js rd / wr: RAMG / RAMB as the code sets them).
// Checked frame by frame against the ROM's in web/tests/golf_wind_sweep.mjs.
import * as D from "./render/display.js";
import { rb, rw } from "./rom.js";
import { mulHLByA } from "./math.js";
import { Hole, hramTrace } from "./ball.js";
import { ball } from "./memory.js";
import { ballTask, restWatch, lieTerrain } from "./shot.js";
import { shotLaunch, baseDistance, clubDistance } from "./launch.js";
import { newGame, setupPlayerGolfer, setCourseHole } from "./start.js";
import { holeIdFromCourse, loadHoleInfo, resetPlayersForHole, placeBallsAtTee } from "./round.js";
import { golfSceneStart } from "./hole.js";
import { distFromBall } from "./ai.js";
import { printString, printHexByte, printDecimalByte } from "./match.js";
import { printHexWord, mulHLByDEFull } from "./home.js";
import { angleFromUp, debugShotAngle } from "./unreached.js";

const rd = D.rd, wr = D.wr;
const rd16 = (w, a) => rd(w, a) | rd(w, a + 1) << 8;
const romString = (bank, a) => { const s = []; for (let v; (v = rb(bank, a++)); ) s.push(v); return s; };

// 3C:6A23 DebugWindCarryTest: the build stamp (00:0153) printed at (5, 1); the RAM window opened (RAMG $0A), RAM bank 1
// (hSRAMBank and RAMB); the sweep with bc = $0400; "COMPLETE" (3C:6A4C) at (0, $0A); a frame; then
// an endless `jr` to itself (3C:6A4A), where the native routine returns
export function* debugWindCarryTest(sh) {
  const w = sh.w;
  printString(w, romString(0, 0x0153), 5, 1);    // 00:20B1 PrintString
  wr(w, 0x0000, 0x0A);
  w.high[0x197] = 1;
  wr(w, 0x4000, 1);
  yield* debugWindCarrySweep(sh, 0x04, 0x00);
  printString(w, romString(0x3C, 0x6A4C), 0, 0x0A);
  yield* sh.advance();                           // 3C:6A47
  // 3C:6A4A: `jr` to itself: the code ends here (only the interrupts run on); the native routine returns
}

// 3C:6A55 DebugWindCarrySweep: NewGame; player 0 golfer b (preset), no player 2; player 0's control 1, player 2's 0;
// WRAM6; course 0 hole 1 (SetCourseHole's wind direction a: the 6 just written to hWRAMBank); $D334 = 1, $D4BF = 0;
// hDebugMode 3; the hole set up (10:4246, 13:55F6, 10:405C, 10:40AC, the scene 10:4226); the swing target and meter
// a perfect full power (impact 0, power $3C); the golfer's distance / shape bytes from player 0's record
// ($C89A-$C89F); the log pointer $BFF0 = $A000. Then for each club 0-$0C (printed at (2, 2)): normal shot, not a tee shot, the lie (3C:4006
// CpuBallLieTerrain, the same code as 10:648B) also the impact side and height; each wind angle $C0, $D0, ... $B0 (at
// (2, 3)) and speed 1-9 (at (2, 4)): DebugTestShot, a frame, DebugLogShot
export function* debugWindCarrySweep(sh, b, c) {
  const w = sh.w;
  newGame(w);                                    // 02:4E3D
  setupPlayerGolfer(w, b, c);                    // 02:4A28
  setupPlayerGolfer(w, 0xFF, 0x01);
  wr(w, 0xC893, 1); wr(w, 0xC8D3, 0);
  w.high[0x196] = 6;
  setCourseHole(w, 6, 0x00, 0x01);               // 10:423B (a: the 6 just written to hWRAMBank)
  wr(w, 0xD334, 1); wr(w, 0xD4BF, 0);
  w.high[0x19E] = 3;                             // hDebugMode
  holeIdFromCourse(w);                           // 10:4246
  loadHoleInfo(w);                               // 13:55F6
  resetPlayersForHole(w);                        // 10:405C
  placeBallsAtTee(w);                            // 10:40AC
  sh.hole = new Hole(w.wram[6][0x320]);
  yield* golfSceneStart(sh);                     // 10:4226
  wr(w, 0xD4D9, 0); wr(w, 0xD4D8, 0x3C); wr(w, 0xD44F, 0); wr(w, 0xD450, 0x3C);
  for (const [to, from] of [[0xD4C6, 0xC89A], [0xD4C7, 0xC89B], [0xD4C9, 0xC89E], [0xD4CA, 0xC89D], [0xD4C8, 0xC89C], [0xD4CB, 0xC89F]]) wr(w, to, rd(w, from));
  wr(w, 0xBFF0, 0x00); wr(w, 0xBFF1, 0xA0);
  for (let club = 0; club < 0x0D; club++) {
    wr(w, 0xD329, club);
    printDecimalByte(w, club, 0x0202);
    wr(w, 0xD32A, 0); wr(w, 0xD32B, 0);
    wr(w, 0xD445, 0);
    const lie = lieTerrain(sh.hole, ball(w));     // 3C:4006
    wr(w, 0xD4CD, lie); wr(w, 0xD44B, lie); wr(w, 0xD44C, lie);
    let angle = 0xC0;
    do {
      wr(w, 0xC816, angle);
      printHexByte(w, angle, 0x0203);
      for (let speed = 1; speed < 0x0A; speed++) {
        wr(w, 0xC815, speed);
        printDecimalByte(w, speed, 0x0204);
        debugTestShot(sh);
        yield* sh.advance();                     // 00:2E3B
        debugLogShot(w);
      }
      angle = (angle + 0x10) & 0xFF;
    } while (angle !== 0xC0);
  }
}

// 3C:6BCA DebugTestShot: the stop spot $D4CF-$D4D4 cleared; 10:405C, 10:40AC; the aim wLaunchDir = $C000 (straight up);
// $D4D6 = 4; ShotLaunch 10:5F94; then BallTask 10:4D45 and RestWatch 10:7077 while RestWatch leaves the zero flag set
// (a quirk: the test is the wrong way round, so the loop ends after one step unless the ball's spot is the stop spot's)
export function debugTestShot(sh) {
  const w = sh.w;
  for (let k = 0; k < 6; k++) wr(w, 0xD4CF + k, 0);
  resetPlayersForHole(w);
  placeBallsAtTee(w);
  wr(w, 0xD418, 0x00); wr(w, 0xD419, 0xC0);
  wr(w, 0xD4D6, 4);
  shotLaunch(w, sh.fx);
  for (;;) {
    hramTrace.w = w;                             // (BallSpeedAndDir's HRAM: the sweep ends on a ball step)
    try { ballTask(w, sh.hole, sh.fx); } finally { hramTrace.w = null; }   // (its own RestWatch included)
    if (!restWatchZ(ball(w))) break;
  }
}
// 10:7077 RestWatch as a routine: its zero flag. At the same spot the count's `inc [hl]` (zero when it wraps to 0);
// else the spot taken again: from a spot byte that differs (nonzero) or from the height test's `cp $02` (zero when
// the height's low byte + 1 is 2)
function restWatchZ(s) {
  const same = s[0x01] === s[0xCF] && s[0x02] === s[0xD0] && s[0x04] === s[0xD1] && s[0x05] === s[0xD2];
  const hz = ((s[0x07] + 1) & 0xFF) === 2;
  restWatch(s);
  if (same && ((s[0x07] + 1) & 0xFF) < 2) return s[0xD3] === 0;
  return same ? hz : false;
}

// 3C:6B59 DebugLogShot: at the log pointer [$BFF0]: the shot's angle from straight up (3C:6BFE DebugShotAngle, printed
// at (2, $0A); 3C:6B3F AngleFromUp, printed at (2, 6)) and its distance from the tee (3C:4466 CpuDistFromBall of the
// tee spot $D439 / $D43B, printed at (2, $0B)) minus the club's base distance (10:68B4), printed at (2, 7); the pointer
// moved on 4 bytes
export function debugLogShot(w) {
  let hl = rd16(w, 0xBFF0);
  const bc = debugShotAngle(w);
  printHexWord(w, bc, 0x020A);
  let de = angleFromUp(bc);
  wr(w, hl, de & 0xFF); wr(w, hl + 1, de >> 8); hl = (hl + 2) & 0xFFFF;
  printHexWord(w, de, 0x0206);
  const d = distFromBall(w, rd16(w, 0xD439), rd16(w, 0xD43B));
  distHram(w, rd16(w, 0xD439), rd16(w, 0xD43B));
  printHexWord(w, d, 0x020B);
  const club = rd(w, 0xD329);
  de = (d - baseDistance(w, club)) & 0xFFFF;
  baseDistanceHram(w, club);
  wr(w, hl, de & 0xFF); wr(w, hl + 1, de >> 8); hl = (hl + 2) & 0xFFFF;
  printHexWord(w, de, 0x0207);
  wr(w, 0xBFF0, hl & 0xFF); wr(w, 0xBFF1, hl >> 8);
}
// the HRAM the two distances leave (ai.js and launch.js compute them without it): 3C:4483's squares are 00:0C8E
// MulHLByDEBothSigned of a value by itself ($FFA7 = the sign of h xor h, 0), the second one's (the y offset's, shifted
// as 3C:4483 shifts it) product at $FFA8-$FFAB (00:0CB5)
function distHram(w, bc, de) {
  const habs = v => ((v >> 8) & 0x80 ? (-(v >> 8)) & 0xFF : v >> 8);
  const r6 = w.wram[6], hl = (bc - (r6[0x401] | r6[0x402] << 8)) & 0xFFFF;
  de = (de - (r6[0x404] | r6[0x405] << 8)) & 0xFFFF;
  const a = Math.max(habs(de), habs(hl));
  const n = a >= 0x20 ? 1 : a >= 0x10 ? 2 : a >= 8 ? 3 : a >= 4 ? 4 : a >= 2 ? 5 : 6;
  de = (de << n) & 0xFFFF;
  w.high[0x1A7] = 0;
  const v = de & 0x8000 ? (-de) & 0xFFFF : de;
  mulHLByDEFull(w, v, v);
}
// 10:68B4's multiplies (00:0CB5, the product at $FFA8-$FFAB): 02:511A ClubDistance's (the driver distance $D4C6 x
// 02:5171[club]; club 0 with equipment bit 1: x $1999; bit 2: x $F333) and, with a shot mode, x $199A
function baseDistanceHram(w, club) {
  const r6 = w.wram[6];
  if (club === 0x0D || r6[0x32A] === 2 || r6[0x32A] === 3) return;
  const drv = r6[0x4C6] | r6[0x4C7] << 8, b = r6[0x4CC];
  if (club) mulHLByDEFull(w, drv, rw(0x02, 0x5171 + 2 * club));
  else if (b & 2) mulHLByDEFull(w, drv, 0x1999);
  else if (b & 4) mulHLByDEFull(w, drv, 0xF333);
  if (r6[0x32A]) mulHLByDEFull(w, mulHLByA(clubDistance(club, drv, b), 0x20), 0x199A);
}
