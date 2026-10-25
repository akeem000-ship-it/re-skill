// "PLAY+" (full.js: E.plus, through the port): match rules on top of the game's, all off unless the page turns them on (recordings
// made without PLAY+ replay without it). Each hook is called from the routine it changes:
//   momentum   three points in a row in your favour and your shots leave the racket about 6% faster until you lose a point
//              (flow.js scorePoint counts the run, shot.js finalizeShotSpeed applies it)
//   stamina    each swing tires the player who makes it, the charged ones most: a point's effort counts 2 for a quick swing,
//              up to 5 for one charged in full and one more for a power shot (plusSwing, shot.js executeShot), back to 0 at every
//              point. Past 10 + e of effort a player runs up to 12% slower and past 12 + e hits up to 8% softer (chars.js
//              clampCharXSpeed / clampCharDepthSpeed, shot.js finalizeShotSpeed): a rally of quick swings tires as the rally's
//              length used to (each player's swings are half its shots). e is the player's endurance from their STAMINA s (plusStamina, as each is loaded): e = 16 s / (s + 16), the slope easing by 30 / (30 + s).
//              s is the character's speed skills (SPEED, DASH, REACTION, STOP: their mean, 0-9) plus: 2 in an exhibition (both
//              sides alike: an average character keeps the 14 / 16 shots of before); 2 a STAMINA level for the tour's player and
//              partner (record +$3F, given at a level-up: port/menus/char_data/screen.js); for the tour's opponents a curve by
//              the match's place in the tour (as `tour`: 0 at the first junior matches up to 14 at the finals; 2 otherwise)
//   serve      the serve hit at the top of the toss (the ball nearly still) is up to 7% faster (shot.js shotPlacement, the serve rows)
//   courts     PHYSICS: Enhanced only: the courts' own bounce and grip bytes pushed apart: clay grips more and sits up, grass skids
//              low (enhanced.js bounce)
//   netcord    a ball that clips the top of the net dribbles over from within 12 units of the tape (the game: 6) (ball.js)
//   fatigue    TOUR+ (tour.js): a player low on the tour's energy tires sooner: their side's stamina thresholds come down by up
//              to 6 shots (plus.fatigue 0..1, fixed for the match; stamina must be on; the tour's player and partner only)
//   tour       the tour's opponents react two frames slower at the first junior matches, two faster at the finals (chars.js
//              loadCharacterAttributes, the CPU side of a tour match)
// Every hook only scales or offsets numbers the game already computes; integers stay integers.
const TOUR = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0x0A, 0x0B, 0x0C, 0x0D, 0x10, 0x11, 0x12, 0x13, 0x16, 0x17, 0x18];
const U16 = v => v & 0xFFFF;
const STAMINA_LEVEL = 0x3F, STORY_RECORDS = [0xC900, 0xC940];       // the story records' unused last byte: the STAMINA level
const storyMatch = mode => mode === 1 || mode === 2 || mode === 3 || mode === 10;
// the match's place in the tour (wGameMode, the match list and its entry) as 0..1, or -1 when it is not one of the tour's matches
function tourStage(m) {
  const mode = m.u8(0xC8A6), list = m.u8(0xC8F6), idx = m.u8(0xC8F7);
  if (mode === 2 || mode === 10) return 1;
  if (!((mode === 1 || mode === 3) && list <= 1)) return -1;
  let k = 0; for (let i = 0; i < TOUR.length; i++) if (TOUR[i] <= idx) k = i;
  return k / (TOUR.length - 1);
}

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
  const r = P.stamina ? effortOf(E) : 0, t = 12 + endurance(E); if (P.stamina && r > t) k -= Math.min(0.08, (r - t) * 0.004 * slope(E));
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
  const r = effortOf(E), t = 10 + endurance(E); if (r <= t) return s;
  return U16(Math.round((s & 0xFFFF) * (1 - Math.min(0.12, (r - t) * 0.006 * slope(E)))));
}
// STAMINA (chars.js loadCharacterAttributes): the character's stamina s as it is loaded (r8: its record), kept in E.stamina by index
export function plusStamina(E, r8) {
  const P = E.plus, C = E.C, m = E.mem; if (!P || !P.stamina) return;
  const base = Math.round((r8(0x27) + r8(0x28) + r8(0x29) + r8(0x2A)) / 4), story = storyMatch(m.u8(0xC8A6));
  let s = base + 2;
  if (story && !(C.index & 1)) s = base + 2 * Math.min(50, m.u8(STORY_RECORDS[C.index >> 1] + STAMINA_LEVEL));
  else if (story) { const k = tourStage(m); if (k >= 0) s = base + Math.round(14 * k); }
  (E.stamina || (E.stamina = [6, 6, 6, 6]))[C.index] = s;
}
const staminaOf = E => (E.stamina ? E.stamina[E.C.index & 3] : 6);
// the hitter's / runner's endurance in shots, less up to 6 for a tired tour player's side (TOUR+)
function endurance(E) {
  const s = staminaOf(E), tired = !(E.C.index & 1) && storyMatch(E.mem.u8(0xC8A6)) ? E.plus.fatigue || 0 : 0;
  return Math.round(16 * s / (s + 16) - 6 * tired);
}
const slope = E => 30 / (30 + staminaOf(E));
// a point's effort so far, by character (E.effort), cleared when the rally count starts again (a new point or serve)
function effort(E) {
  const r = E.S.rallyLength;
  if (!E.effort || r < E.effortRally) E.effort = [0, 0, 0, 0];
  E.effortRally = r;
  return E.effort;
}
// STAMINA (shot.js executeShot, the shot's handler done): the swing's effort to the hitter: 2, + up to 3 by the charge
// (wShotChargeLevel, the swing's windup frames: a quick swing has under 8, a full charge 63), + 1 for a power shot
export function plusSwing(E) {
  const P = E.plus; if (!P || !P.stamina) return;
  const S = E.S, c = Math.min(S.shotChargeLevel, 63), power = S.lastShotWasPowerShot || S.specialShotFlag ? 1 : 0;
  effort(E)[E.C.index & 3] += 2 + 3 * Math.max(0, c - 8) / 55 + power;
}
const effortOf = E => effort(E)[E.C.index & 3];
// the court's friction and bounce bytes (enhanced.js): [friction, bounce]
export function plusSurface(E, fB, eB) {
  const P = E.plus; if (!P || !P.courts) return [fB, eB];
  const c = E.S.currentlyUsedCourt;
  let f = fB, e = eB;
  if (c === 1) { f *= 0.82; e *= 1.07; }                                // clay: more grip, a higher bounce
  else if (c === 2) { f = f + (256 - f) * 0.3; e *= 0.86; }            // grass: skids, stays low
  return [Math.max(0, Math.min(255, Math.round(f))), Math.max(0, Math.min(255, Math.round(e)))];
}
// the net cord's band below the tape (ball.js handleBallNetCrossing): the game's 6, PLAY+ 12
export const plusNetCordBand = E => (E.plus && E.plus.netcord ? 12 : 6);
// the CPU side of a tour match (chars.js loadCharacterAttributes): reaction delays by the match's place in the tour
export function plusTourDifficulty(E) {
  const P = E.plus, C = E.C, m = E.mem; if (!P || !P.tour || !(C.index & 1)) return;
  const k = tourStage(m); if (k < 0) return;
  const d = Math.round(2 - 4 * k);
  C.aiReactionDelayNear = Math.max(1, Math.min(40, C.aiReactionDelayNear + d));
  C.aiReactionDelayFar = Math.max(1, Math.min(40, C.aiReactionDelayFar + d));
}
