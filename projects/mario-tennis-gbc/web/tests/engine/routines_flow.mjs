// Match-flow routines (web/js/engine/flow.js) for web/tests/engine_routines.mjs. Scores, outcomes and rally
// state are scrambled per state (prep) so every branch of the scoring code runs.
import * as flow from "../../js/engine/flow.js";

// a pseudo-random but reproducible score/outcome per state
function scramble(m, s, { outcome = true } = {}) {
  const w = m.wram[0], r = k => ((s.f * 2654435761 + k * 40503) >>> 13) & 0xFF;
  w[0x8E0] = r(1) % 3; w[0x8E1] = r(2) % 3;                            // sets
  w[0x8E2] = r(3) % 8; w[0x8E3] = r(4) % 8;                            // games
  w[0x8E4] = r(5) % 8; w[0x8E5] = r(6) % 8;                            // points
  w[0x8E7] = r(7) % 4 === 0 ? 1 : 0;                                    // tiebreak
  w[0x8F0] = [1, 3, 5][r(8) % 3]; w[0x8F1] = r(9) & 1 ? 2 : 6;          // sets / games per set
  w[0x8EB] = [0, 1, 0xFF, 0x80][r(10) % 4];                             // point win/lose flag
  if (outcome) { w[0x4D8] = r(11) % 10; w[0x4D9] = [0, 1, 0xFF][r(12) % 3]; w[0x4B6] = r(13) % 4; w[0x8EE] = r(14) & 1; w[0x4A0] = r(15) % 15; w[0x4B8] = r(16) & 3; w[0x4AF] = r(17) & 3; w[0x4D0] = r(18) & 1; w[0x4D1] = r(19) & 1; }
}
const R = (name, addr, js, out) => ({ name, bank: 8, addr, wram: 4, prep: (m, s) => scramble(m, s), js, out });
export const ROUTINES = [
  R("ScorePoint", 0x5AD7, E => flow.scorePoint(E)),
  R("ApplyPointToScore", 0x5AE6, E => flow.applyPointToScore(E)),
  R("EvaluatePointSituation", 0x5B2E, E => flow.evaluatePointSituation(E)),
  R("HandleServeFault", 0x5B7F, E => flow.handleServeFault(E)),
  R("FlagServiceReturnAce", 0x5BA7, E => flow.flagServiceReturnAce(E)),
  R("UpdatePointStats", 0x5C2B, E => flow.updatePointStats(E)),
  R("CheckMatchWon", 0x5CC3, E => flow.checkMatchWon(E), a => ({ a })),
  R("CheckSetWon", 0x5CE9, E => flow.checkSetWon(E), a => ({ a })),
  R("CheckGameWon", 0x5D37, E => flow.checkGameWon(E), a => ({ a })),
  R("CheckTiebreakGameWon", 0x5D54, E => flow.checkTiebreakGameWon(E), a => ({ a })),
  R("ResolvePointWinner", 0x5D9A, E => flow.resolvePointWinner(E), a => ({ a: a & 0xFF })),
  { name: "UpdateMatchCamera", bank: 8, addr: 0x61DC, wram: 4, js: E => flow.updateMatchCamera(E) },
  { name: "UpdateMatchCamera/forced", bank: 8, addr: 0x61DC, wram: 4, prep: (m, s) => { const w = m.wram[0], r = k => ((s.f * 2654435761 + k * 40503) >>> 9) & 0xFFFF; for (const [a, k] of [[0x440, 1], [0x442, 2], [0x444, 3], [0x446, 4], [0x46C, 5], [0x46E, 6]]) { const v = s.f & 1 ? r(k) : (r(k) & 0x1FFF) - 0x1000; w[a] = v & 0xFF; w[a + 1] = (v >> 8) & 0xFF; } w[0x4C9] = s.f & 2 ? 1 : 0; }, js: E => flow.updateMatchCamera(E) },
  { name: "ResetCameraForServe", bank: 8, addr: 0x6192, wram: 4, js: E => flow.resetCameraForServe(E) },
];
// court positions: game/point counters, tiebreak and character counts scrambled
const posPrep = (m, s) => { const w = m.wram[0], r = k => ((s.f * 2654435761 + k * 40503) >>> 11) & 0xFF;
  w[0x8EC] = r(1) % 13; w[0x8ED] = r(2) % 24; w[0x8E7] = r(3) % 3 === 0 ? 1 : 0; w[0x4CF] = r(4) % 4; w[0x4DD] = r(5) & 1; w[0x8CF] = r(6) & 3; w[0x4CB] = r(7) & 1;
  for (let k = 4; k < 8; k++) m.wram[k][0xF0A] = r(8 + k) & 3; };
ROUTINES.push(
  { name: "AssignCourtPositions", bank: 8, addr: 0x47E2, wram: 4, prep: posPrep, js: E => flow.assignCourtPositions(E) },
  { name: "InitTiebreakPointCounter", bank: 8, addr: 0x47CD, wram: 4, prep: posPrep, js: E => flow.initTiebreakPointCounter(E) },
);
import * as flowMod from "../../js/engine/flow.js";
const spreadPrep = (m, s) => { const r = k => ((s.f * 2654435761 + k * 40503) >>> 9) & 0xFFFF; m.wram[0][0x4CF] = 2 + (s.f & 1);
  for (let k = 4; k < 8; k++) { const v = (s.f % 3 === 0) ? (r(k) & 0x7FF) - 0x400 : r(k); m.wram[k][0xF04] = v & 0xFF; m.wram[k][0xF05] = v >> 8; } };
ROUTINES.push(
  { name: "SpreadTeammateTargets", bank: 8, addr: 0x4FF5, wram: 4, prep: spreadPrep, js: E => flowMod.spreadTeammateTargets(E) },
  { name: "GetCharBaseCourtPosition", bank: 8, addr: 0x6098, wram: 5, prep: posPrep, js: E => flowMod.getCharBaseCourtPosition(E), out: p => ({ hl: p.x, de: p.depth }) },
  { name: "GetCharChangeoverPosition", bank: 8, addr: 0x60D8, wram: 5, prep: posPrep, js: E => flowMod.getCharChangeoverPosition(E), out: p => ({ hl: p.x, de: p.depth }) },
);
