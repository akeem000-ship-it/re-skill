// "PLAY+" (full.js: E.plus, through the port): match rules on top of the game's, all off unless the page turns them on (recordings
// made without PLAY+ replay without it). Each hook is called from the routine it changes:
//   momentum   three points in a row in your favour and your shots leave the racket about 6% faster until you lose a point
//              (flow.js scorePoint counts the run, shot.js finalizeShotSpeed applies it)
//   stamina    a long rally tires both players: past 14 shots they run up to 12% slower and past 16 hit up to 8% softer
//              (chars.js clampCharXSpeed / clampCharDepthSpeed, shot.js finalizeShotSpeed)
//   serve      the serve hit at the top of the toss (the ball nearly still) is up to 7% faster (shot.js shotPlacement, the serve rows)
//   courts     PHYSICS: Enhanced only: the courts' own bounce and grip bytes pushed apart: clay grips more and sits up, grass skids
//              low, a wet court (WEATHER: Rain / Wet, plus.wet) is slower and lower (enhanced.js bounce)
//   netcord    a ball that clips the top of the net dribbles over from within 12 units of the tape (the game: 6) (ball.js)
//   tour       the tour's opponents react two frames slower at the first junior matches, two faster at the finals (chars.js
//              loadCharacterAttributes, the CPU side of a tour match)
// Every hook only scales or offsets numbers the game already computes; integers stay integers.
const TOUR = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0x0A, 0x0B, 0x0C, 0x0D, 0x10, 0x11, 0x12, 0x13, 0x16, 0x17, 0x18];
const U16 = v => v & 0xFFFF;

// after each point (flow.js scorePoint): the current run of points won by each side
export function plusPoint(E) {
  const w = E.S.pointWinLoseFlag, m = E.mom || (E.mom = [0, 0]);
  if (w === 1) { m[0]++; m[1] = 0; } else if (w === -1 || w === 0xFF) { m[1]++; m[0] = 0; }
}
// the shot's final speed (shot.js finalizeShotSpeed): momentum and fatigue for the hitter
export function plusShotSpeed(E, bc) {
  const P = E.plus; if (!P) return bc;
  let k = 1;
  const side = E.C.index & 1, m = E.mom;
  if (P.momentum && m && m[side] >= 3) k += 0.06;
  const r = E.S.rallyLength; if (P.stamina && r > 16) k -= Math.min(0.08, (r - 16) * 0.004);
  return k === 1 ? bc : U16(Math.round((bc & 0xFFFF) * k));
}
// a serve's speed (shot.js shotPlacement, serve rows): timing against the top of the toss
export function plusServeSpeed(E, bc) {
  const P = E.plus; if (!P || !P.serve) return bc;
  const vz = Math.abs(E.S.ballVelocityHeight << 16 >> 16), k = 1 + 0.07 * Math.max(0, 1 - Math.max(0, vz - 0x60) / 0x300);
  return U16(Math.round((bc & 0xFFFF) * k));
}
// running speed (chars.js): fatigue in long rallies
export function plusRunSpeed(E, s) {
  const P = E.plus; if (!P || !P.stamina) return s;
  const r = E.S.rallyLength; if (r <= 14) return s;
  return U16(Math.round((s & 0xFFFF) * (1 - Math.min(0.12, (r - 14) * 0.006))));
}
// the court's friction and bounce bytes (enhanced.js): [friction, bounce]
export function plusSurface(E, fB, eB) {
  const P = E.plus; if (!P || !P.courts) return [fB, eB];
  const c = E.S.currentlyUsedCourt;
  let f = fB, e = eB;
  if (c === 1) { f *= 0.82; e *= 1.07; }                                // clay: more grip, a higher bounce
  else if (c === 2) { f = f + (256 - f) * 0.3; e *= 0.86; }            // grass: skids, stays low
  if (P.wet) { f = f + (256 - f) * 0.15; e *= 0.92; }                   // wet: skiddy and dead
  return [Math.max(0, Math.min(255, Math.round(f))), Math.max(0, Math.min(255, Math.round(e)))];
}
// the net cord's band below the tape (ball.js handleBallNetCrossing): the game's 6, PLAY+ 12
export const plusNetCordBand = E => (E.plus && E.plus.netcord ? 12 : 6);
// the CPU side of a tour match (chars.js loadCharacterAttributes): reaction delays by the match's place in the tour
export function plusTourDifficulty(E) {
  const P = E.plus, C = E.C, m = E.mem; if (!P || !P.tour || !(C.index & 1)) return;
  const mode = m.u8(0xC8A6), list = m.u8(0xC8F6), idx = m.u8(0xC8F7);
  if (!((mode === 1 || mode === 3) && list <= 1) && mode !== 2 && mode !== 10) return;
  let k = 0; for (let i = 0; i < TOUR.length; i++) if (TOUR[i] <= idx) k = i;
  const d = Math.round(2 - 4 * (mode === 2 || mode === 10 ? 1 : k / (TOUR.length - 1)));
  C.aiReactionDelayNear = Math.max(1, Math.min(40, C.aiReactionDelayNear + d));
  C.aiReactionDelayFar = Math.max(1, Math.min(40, C.aiReactionDelayFar + d));
}
