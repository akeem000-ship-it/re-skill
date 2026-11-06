// SCOUTING (PLAY+ learn, engine/plus.js; CPU LEARNS in the button bar): the CPU learns how you play. A profile of your habits is
// kept as you play (E.learnProfile: the port's P.learnProfile, saved by full.js between sessions, so it carries on from match to
// match), and the CPU opponents lean on it more the more of your shots they have seen:
//   aim        where your rally shots land, side to side (the shot solver's target X, a running average): the CPU waits shaded towards
//              that side between shots (ai.js aiChooseHomePosition: half the average, on top of the game's quarter of its own landing)
//   net        how often you are within $1E0 of the net when the CPU hits: a net rusher gets lobbed more (ai.js aiPickShotButtons:
//              the game's 1-in-2 roll for a lob becomes up to 3-in-4)
//   weak side  on the points you lose to a CPU shot, which side of you the ball was (its X against yours when the point ends):
//              the CPU aims there more (ai.js aiAimAwayFromChar: its "at you" quarter, then its "away from where you are" quarter,
//              go to that side instead)
//   touch      how many of your rally shots are drops and lobs: the CPU's baseline home comes up the court (from $460 towards $300)
// How much: confidence = your shots seen / 50 (at most 1), times 0.5 at the tour's first junior matches rising to 1 at its finals
// (as the rest of PLAY+'s tour curve), 1 elsewhere. Averages move by 1 / (n + 1) at first, then by 1/40 a sample (the last few
// dozen count most), so a change in how you play is noticed. Only the CPU on the other side of the net reads it (not your doubles
// partner), only in matches (no drills or mini-games), and only through rolls and targets the game already makes: randomness is
// the game's own AdvanceMatchRng, no new draws, so a recording replays exactly from the profile it started with (meta.learn).
const SHOTTYPE_LOB = 0x0A, SHOTTYPE_DROP = 0x0B, NET_DEPTH = 0x01E0;
const S16 = v => (v << 16) >> 16;
export const freshProfile = () => ({ v: 1, shots: 0, aimX: 0, touch: 0, cpuShots: 0, net: 0, lost: 0, weak: 0 });
const ema = (avg, x, n) => avg + (x - avg) * Math.max(1 / 40, 1 / (n + 1));
// the profile when learning is on and this is a match (wGameMode: not a drill, the ball machine, wall practice or a mini-game)
function profile(E) {
  const P = E.plus; if (!P || !P.learn || !E.learnProfile) return null;
  const mode = E.mem.u8(0xC8A6); if (mode === 5 || mode === 6 || mode === 7 || mode === 8) return null;
  return E.learnProfile;
}
// f(the character of `index`) with its WRAM bank mapped (ai.js charIndexToWramBank: 4 + index), the caller's bank back after
function withChar(E, index, f) { const saved = E.mem.u8(0xFF96); E.setBank((index + 4) & 0xFF); try { return f(E.C); } finally { E.setBank(saved); } }
const human = C => C.inputSource !== 1 && !(C.index & 1);                // your side, not the CPU (inputSource 1)

// shot.js executeShot, after the shot's handler (E.C the hitter): your rally shots (where they go, how many drops and lobs), and on
// a CPU shot whether you are up at the net
export function learnShot(E) {
  const L = profile(E); if (!L) return;
  const C = E.C, S = E.S;
  if (human(C)) {
    if (!S.rallyLength) return;                                          // (not the serve)
    L.aimX = ema(L.aimX, S16(S.ballTargetX), L.shots);
    L.touch = ema(L.touch, S.currentShotType === SHOTTYPE_DROP || S.currentShotType === SHOTTYPE_LOB ? 1 : 0, L.shots);
    L.shots++;
  } else if (C.inputSource === 1 && (C.index & 1)) {
    const d = withChar(E, 0, c => Math.abs(S16(c.posDepthInt)));
    L.net = ema(L.net, d < NET_DEPTH ? 1 : 0, L.cpuShots); L.cpuShots++;
  }
}
// flow.js scorePoint: a point you lost to a CPU shot (it got past you): which side of you the ball was
export function learnPoint(E) {
  const L = profile(E); if (!L) return;
  const S = E.S, w = S.pointWinLoseFlag;
  if (!(w === -1 || w === 0xFF) || !(S.lastShotCharIndex & 1)) return;
  const x = withChar(E, 0, c => S16(c.posXInt)), d = S16(S.ballX) - x;
  if (Math.abs(d) < 0x10) return;                                        // (right at you: no side)
  L.weak = ema(L.weak, Math.sign(d), L.lost); L.lost++;
}
// how much the CPU leans on the profile now: 0..1
export function learnConfidence(E) {
  const L = profile(E); if (!L) return 0;
  const m = E.mem, mode = m.u8(0xC8A6), list = m.u8(0xC8F6), idx = m.u8(0xC8F7);
  let k = 1;
  if ((mode === 1 || mode === 3) && list <= 1) k = 0.5 + 0.5 * Math.min(1, idx / 0x18);   // the tour's matches: half at the juniors, all at the finals
  return Math.min(1, L.shots / 50) * k;
}
const forCpu = E => !!(E.C.index & 1) && E.C.inputSource === 1;        // the CPU across the net (not your doubles partner)

// ai.js aiChooseHomePosition: [X shaded towards where you usually hit, the baseline depth brought up against drops and lobs]
export function learnHome(E, x, depth) {
  const c = forCpu(E) ? learnConfidence(E) : 0; if (!c) return [x, depth];
  const L = E.learnProfile, nx = (x + Math.round(L.aimX * 0.5 * c)) & 0xFFFF;
  return [nx, depth === 0x0460 ? Math.round(0x0460 - (0x0460 - 0x0300) * Math.min(1, L.touch * 2.5) * c) : depth];
}
// ai.js aiPickShotButtons: the lob roll's value r (the game lobs when r & 1 is 0): true for a lob
export function learnLobRoll(E, r) {
  const c = forCpu(E) ? learnConfidence(E) : 0;
  if (!c) return !(r & 1);
  return (r & 3) < 2 + Math.round(E.learnProfile.net * c * 1.4);          // 2 in 4 (the game's), up to 3 in 4 against a net rusher
}
// ai.js aiAimAwayFromChar: the roll r (0 away from where you are, 1 at you, 2-3 away from where you move); the d-pad bits to press
// for your weak side instead, or 0 to keep the game's choice
export function learnAim(E, r) {
  const c = forCpu(E) ? learnConfidence(E) : 0; if (!c) return 0;
  const w = E.learnProfile.weak * c; if (Math.abs(w) < 0.25) return 0;
  if (r === 1 || (r === 0 && Math.abs(w) > 0.5)) return w > 0 ? 0x10 : 0x20;   // (+X: right on the d-pad, as aiAimAwayFromChar's)
  return 0;
}
// the changeover panel's line (matchfx.js): what the CPU has noticed, or "" while it has not seen enough
export function learnNote(L) {
  if (!L || L.shots < 15) return "";
  const out = [];
  if (Math.abs(L.aimX) > 0x30) out.push(`you aim ${L.aimX < 0 ? "left" : "right"}`);
  if (L.cpuShots >= 10 && L.net > 0.3) out.push("you rush the net");
  if (L.lost >= 6 && Math.abs(L.weak) > 0.3) out.push(`your ${L.weak > 0 ? "right" : "left"} side is open`);
  if (L.touch > 0.2) out.push("you like drops and lobs");
  return out.length ? "SCOUTED: " + out.join(" · ") : "";
}
