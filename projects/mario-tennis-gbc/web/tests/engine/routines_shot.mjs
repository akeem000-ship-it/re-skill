// Shot-solver routines (web/js/engine/shot.js) for web/tests/engine_routines.mjs. ExecuteShot runs from every
// recorded state for each of the 15 shot types, with the hitter's struct and the ball scrambled per state
// (prep) so serve and rally, both court sides, the mirror, diving, the smash cone, the wall minigame, the
// sideline cut and the fallback trajectory are all reached; the pieces are also checked one by one.
import * as shot from "../../js/engine/shot.js";

const hash = (s, k) => ((s.f * 2654435761 + k * 40503 + k * k * 977) >>> 7) & 0xFFFF;
const w16 = (arr, off, v) => { arr[off] = v & 0xFF; arr[off + 1] = (v >> 8) & 0xFF; };
const pick = (list, r) => list[r % list.length];

// scramble the hitter (WRAM bank `bank`) and the shot globals; mode "keep" leaves the recorded values
function scramble(m, s, bank, { type = null, serve = null } = {}) {
  const w = m.wram[0], c = m.wram[bank], r = k => hash(s, k);
  w[0x4B7] = 0;                                                          // wBallHitEvent clear: the shot runs
  if (type !== null) c[0xF14] = type;                                    // wCharShotType
  w[0x4B6] = serve === null ? pick([0, 1, 2, 7], r(1)) : serve ? 0 : 1 + (r(1) % 5);   // wRallyLength
  c[0xF0F] = (c[0xF0F] & ~0x02) | (r(2) % 3 === 0 ? 0x02 : 0);           // diving
  c[0xF15] = pick([5, 6, 7, 8, 9, 0x0A, 0x0B, c[0xF15]], r(3));          // swing animation
  c[0xF94] = r(4) & 1 ? 0x20 : 0;                                        // left-handed
  c[0xF4A] = pick([0xFE, 0xFF, 0, 1, 2, 3, 4, 5, 0xFF, 1], r(5));         // aim offset (4, 5: the spare 'straight' slots)
  c[0xF4B] = r(6) % 0x50;                                                // swing frames -> charge
  c[0xF0A] = r(7) & 3;                                                   // court position
  w[0x7B9] = r(8) % 8 === 0 ? 1 : 0;                                     // wMinigameUsesWall
  if (r(9) % 4 === 0) for (const a of [0xF6B, 0xF6C, 0xF6D, 0xF6E, 0xF6F, 0xF92, 0xF93]) c[a] = r(a) % 10;
  if (r(10) % 2) w16(w, 0x40A, -(r(11) % 0x1C0) + 0x20);                 // ball height, through the smash cone
  if (r(12) % 3 === 0) w16(w, 0x406, (r(13) % 0xC00) - 0x600);           // ball depth
  if (r(14) % 3 === 0) w16(w, 0x402, (r(15) % 0x500) - 0x280);           // ball X
  if (r(16) % 3 === 0) w16(w, 0x424, (r(17) % 0x1000) - 0x800);          // incoming depth velocity (pace term)
  if (r(18) % 4 === 0) w16(c, 0xF42, (r(19) % 0x600) - 0x300);           // hitter's depth velocity
  if (r(20) % 5 === 0) { w16(w, 0x484, -[0x1B0, 0x240, 0x100][r(21) % 3]); }   // court limit X
  c[0xF6A] = r(22) % 3 === 0 ? r(23) & 0x3F : c[0xF6A];                  // jitter scale
}

// a random distance window and aim for the row search: wShotDistMin, its row, a row maximum up to $C0 rows on
function trajWindow(m, s) {
  const w = m.wram[0], r = k => hash(s, k), dmin = r(60) % 0x2000, rmin = (dmin << 2 >> 8) & 0xFF;
  w16(w, 0x48A, dmin); w[0x48E] = rmin; w[0x48F] = Math.min(0xFF, rmin + r(61) % 0xC0);
  w16(w, 0x48C, dmin + r(62) % 0x3000); w16(w, 0x43A, r(63)); w[0x4A7] = r(64) & 1;
  w16(w, 0x434, (r(65) % 0x1000) - 0x800); w16(w, 0x436, (r(66) % 0x1000) - 0x800);
}
const E4 = { wram: 4 };
const T = shot.SHOTTYPE;
const NAMES = Object.fromEntries(Object.entries(T).map(([k, v]) => [v, k]));
const bc = r => ({ b: (r >> 8) & 0xFF, c: r & 0xFF }), de = r => ({ d: (r >> 8) & 0xFF, e: r & 0xFF }), hl = r => ({ h: (r >> 8) & 0xFF, l: r & 0xFF });
const regBC = s => ({ b: hash(s, 31) >> 8 & 0x07, c: hash(s, 32) & 0xFF });   // a target depth / speed request
const SC = (extra = {}) => (m, s) => scramble(m, s, 4, extra);

const LIST = [
  // ---- ExecuteShot: as recorded, then every shot type forced (rally and serve), on both main banks ----
  { name: "ExecuteShot", bank: 7, addr: 0x53B0, ...E4, js: E => shot.executeShot(E) },
  ...Object.values(T).flatMap(t => [4, 5].flatMap(bank => [false, true].map(serve => ({
    name: `ExecuteShot/${NAMES[t]}/${serve ? "serve" : "rally"}/w${bank}`, bank: 7, addr: 0x53B0, wram: bank,
    prep: (m, s) => scramble(m, s, bank, { type: t, serve }), js: E => shot.executeShot(E),
  })))),
  // ---- the pieces ----
  { name: "ApplyShotRecoil", bank: 7, addr: 0x546B, ...E4, prep: (m, s) => { SC()(m, s); m.wram[0][0x4A1] = hash(s, 40) % 5; }, js: E => shot.applyShotRecoil(E) },
  { name: "ShotRecoilFrameTask", bank: 7, addr: 0x5463, ...E4, prep: (m, s) => { SC()(m, s); m.wram[0][0x4A1] = hash(s, 40) % 5; }, js: E => shot.shotRecoilFrameTask(E) },
  { name: "WeakenShotByCharge", bank: 7, addr: 0x54DE, ...E4, regs: regBC, prep: SC(), js: (E, r) => shot.weakenShotByCharge(E, r.b << 8 | r.c), out: bc },
  { name: "BoostShotByCharge", bank: 7, addr: 0x54ED, ...E4, regs: regBC, prep: SC(), js: (E, r) => shot.boostShotByCharge(E, r.b << 8 | r.c), out: bc },
  { name: "NudgeShotByPlayerMomentum", bank: 7, addr: 0x54FE, ...E4, regs: regBC, prep: SC(), js: (E, r) => shot.nudgeShotByPlayerMomentum(E, r.b << 8 | r.c), out: bc },
  { name: "CheckBallInSmashRange", bank: 7, addr: 0x5525, ...E4, prep: SC(), js: E => shot.checkBallInSmashRange(E).f, out: f => ({ f }) },
  { name: "ApplyShotTypePresets", bank: 7, addr: 0x557E, ...E4, prep: (m, s) => { SC()(m, s); m.wram[0][0x4A0] = hash(s, 41) % 15; }, js: E => shot.applyShotTypePresets(E), out: bc },
  { name: "GetShotAimOffsetForSide", bank: 7, addr: 0x55E9, ...E4, prep: SC(), js: E => shot.getShotAimOffsetForSide(E), out: de },
  { name: "ComputeShotTargetX", bank: 7, addr: 0x5646, ...E4, prep: SC(), js: E => shot.computeShotTargetX(E), out: de },
  { name: "ComputeAimBaseOffset", bank: 7, addr: 0x56B7, ...E4, prep: SC(), js: E => shot.computeAimBaseOffset(E), out: de },
  { name: "ClampShotTargetX", bank: 7, addr: 0x56E3, ...E4, regs: s => de(hash(s, 33) - 0x8000 >> 4), prep: SC(), js: (E, r) => shot.clampShotTargetX(E, r.d << 8 | r.e), out: de },
  { name: "GetRandomAimJitter", bank: 7, addr: 0x570D, ...E4, prep: SC(), js: E => shot.getRandomAimJitter(E), out: hl },
  { name: "ComputeShotTrajectory", bank: 7, addr: 0x571E, ...E4, regs: regBC, prep: SC(), js: (E, r) => shot.computeShotTrajectory(E, r.b << 8 | r.c) },
  { name: "NormalizeBallHeightForShot", bank: 7, addr: 0x5876, ...E4, prep: SC(), js: E => shot.normalizeBallHeightForShot(E) },
  { name: "RaiseBallHeightForLob", bank: 7, addr: 0x5899, ...E4, prep: SC(), js: E => shot.raiseBallHeightForLob(E) },
  { name: "SetSpecialShotFlagFromBallHeight", bank: 7, addr: 0x5A01, ...E4, prep: SC(), js: E => shot.setSpecialShotFlagFromBallHeight(E) },
  ...Object.values(T).map(t => ({ name: `ComputeShotPlacement/${NAMES[t]}`, bank: 7, addr: 0x5161, ...E4,
    prep: (m, s) => { SC()(m, s); m.wram[0][0x4A0] = t; m.wram[0][0x4A7] = hash(s, 42) & 1; }, js: E => shot.computeShotPlacement(E), out: bc })),
  { name: "FinalizeShotSpeed", bank: 7, addr: 0x52D7, ...E4, regs: regBC, prep: SC(), js: (E, r) => shot.finalizeShotSpeed(E, r.b << 8 | r.c), out: bc },
  { name: "ApplyFallbackBallTrajectory_24", bank: 0x24, addr: 0x57FD, ...E4, regs: s => ({ d: hash(s, 34) & 0x0F }), prep: SC(), js: (E, r) => shot.applyFallbackBallTrajectory(E, r.d) },
  // the row search on its own, with a forced window (rows past $80 give a negative distance: (row << 8) sra 2)
  ...[["ApplyBallTrajectory6Capped_20", 0x20, 0x4102, 0x427D, 6, true], ["ApplyBallTrajectory4Capped_24", 0x24, 0x41A2, 0x5844, 4, true],
    ["ApplyBallTrajectory6_2c", 0x2C, 0x4139, 0x4E81, 6, false], ["ApplyBallTrajectory4_2c", 0x2C, 0x41CD, 0x4281, 4, false]].map(([name, bank, addr, data, size, capped]) => ({
    name, bank, addr, ...E4, regs: s => ({ ...hl(data + (hash(s, 50) % 0x1000)), ...bc(hash(s, 51) % 0x3000) }),
    prep: (m, s) => { SC()(m, s); trajWindow(m, s); },
    js: (E, r) => shot.applyBallTrajectory(E, bank, r.h << 8 | r.l, r.b << 8 | r.c, size, capped) })),
  { name: "ApplyBallTrajectoryCapped_24", bank: 0x24, addr: 0x4169, ...E4, regs: s => hl(0x4289 + (hash(s, 52) % 0x1000)), prep: (m, s) => { SC()(m, s); trajWindow(m, s); },
    js: (E, r) => shot.applyBallTrajectoryCapped24(E, r.h << 8 | r.l) },
  ...[0x29, 0x2A, 0x2B].map(bank => ({ name: `SetBallTargetByPrediction_${bank.toString(16)}`, bank, addr: 0x4098, ...E4, regs: s => hl(0x427D + 6 * (hash(s, 53) % 1200)),
    prep: (m, s) => { SC()(m, s); m.wram[0][0x4A7] = hash(s, 54) & 1; }, js: (E, r) => shot.setBallTargetByPrediction(E, bank, r.h << 8 | r.l) })),
  { name: "SetBallTargetFromAim_20", bank: 0x20, addr: 0x41F5, ...E4, regs: s => hl(hash(s, 35) & 0x3FFF), js: (E, r) => shot.setBallTargetFromAim(E, r.h << 8 | r.l) },
];

// romCall maps the routine's ROM bank but leaves hROMBank ($FF95) at the recorded value, and FarCall returns to
// the bank in hROMBank: set it to the routine's bank, or the first farcall out of bank $07 returns into the wrong bank
export const ROUTINES = LIST.map(R => ({ ...R, prep: (m, s) => { m.hram[0x15] = R.bank; if (R.prep) R.prep(m, s); } }));
