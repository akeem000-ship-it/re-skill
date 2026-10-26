// Tournament (game mode 1): the field of 27 rival golfers whose scores are made up as the round goes (bank 3C:
// SimulateRivalScores), the standings built from them and the player's score (bank 0E: BuildStandings into WRAM6
// $D800, 4 bytes an entry: score to par, name / id, -, rank (bit 7: tied); $96 ends), the player's rank wPlayerRank
// $C875, and the course statistics kept in the save (bank 08: drives, fairways, putts, greens in regulation, par or
// better, sand saves, rounds and the best score; wProfileCourseStats $C980, 25 bytes a course, with a working copy
// $C96E-$C97D during the round).
import { rb } from "./rom.js";
import * as D from "./render/display.js";
import { holeParAndYards } from "./scorecard.js";
import { copyTextShortToDE } from "./text.js";
import { compare16 } from "./ai.js";
import { testCourseHoleBit, setCourseHoleBit } from "./scorecard.js";
import { mulHLByA } from "./math.js";
import { showCaptionAndWait } from "./captions.js";

const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
const wbank = w => w.high[0x196];
const r16 = (w, a) => rd(w, a) | rd(w, (a + 1) & 0xFFFF) << 8;
const w16 = (w, a, v) => { wr(w, a, v & 0xFF); wr(w, (a + 1) & 0xFFFF, (v >> 8) & 0xFF); };
const B3C = 0x3C;
const RIVALS = 0x65E4;                           // 3C:65E4 RivalTable: 27 x (skill, profile row, flags, profile offset)
const PROFILES = 0x6650;                         // 3C:6650 RivalProfileTable: 3 rows of 18 per-hole drifts
const COURSE_OFFSET = 0x67DD;                    // 3C:67DD RivalCourseOffsetTable: by course - 1
const curPlayerField = (w, f) => 0xC880 + (w.wram[0][0x835] ? 0x40 : 0) + f;   // 3C:4256 CpuPlayerField

// ---- bank 3C: the rivals ----
// 3C:6598 RivalRandom: wRivalRng $D596 = seed x 13 + (seed & $FF) x $200 + $3039; a = its high byte
function rivalRandom(w) {
  const s = r16(w, 0xD596);
  let hl = ((s << 3) + ((s & 0xFF) << 8)) & 0xFFFF;
  hl = (((hl << 1) & 0xFFFF) - ((3 * s) & 0xFFFF) + 0x3039) & 0xFFFF;
  w16(w, 0xD596, hl);
  return hl >> 8;
}
// 3C:65C8 RivalRandomBelow: a random byte shifted right until it fits the bits of n - 1, until below n (1: 0)
function rivalRandomBelow(w, n) {
  if (n === 1) { rivalRandom(w); return 0; }
  for (;;) {
    let c = rivalRandom(w);
    for (let a = (n - 1) & 0xFF; !(a & 0x80); a = (a << 1) & 0xFF) c >>= 1;
    if (c <= n - 1) return c;
  }
}
const courseOffset = w => rb(B3C, COURSE_OFFSET + ((rd(w, 0xC836) - 1) & 0xFF));
// 3C:67E2 RivalBaseScore: skill + the course's offset + (two RivalRandomBelow 5) / 2 - 2; rival 26 has no spread
function rivalBaseScore(w, a) {
  const c = (rb(B3C, RIVALS + 4 * a) + courseOffset(w)) & 0xFF;
  if (a === 0x1A) return c;
  const d = rivalRandomBelow(w, 5);
  return ((((rivalRandomBelow(w, 5) + d) & 0xFF) >> 1) - 2 + c) & 0xFF;
}
// 3C:6A04 RivalScoreToWord: a byte score, $91 and up negative
const scoreWord = a => (a >= 0x91 ? 0xFF00 | a : a);
// 3C:67B1 RivalHoleProfile: the rival's profile row (byte 1) at hole e (1-18) + byte 3
const rivalHoleProfile = (w, a, e) =>
  (rb(B3C, (PROFILES + 0x12 * rb(B3C, RIVALS + 4 * a + 1) + ((e - 1) & 0xFF)) & 0xFFFF) + rb(B3C, RIVALS + 4 * a + 3)) & 0xFF;
// 3C:66EF RivalScoreThroughHole: rival a with total d after e holes (the holes played, + its flags' low nibble,
// at most 18): d x e / 18 (by its size, the sign kept) + the profile; 0 / 0 before any. Rival 26 on hole 18, when
// the player's score ($3E) equals the course offset, is put a stroke behind the player when level with it.
function rivalScoreThroughHole(w, a, d) {
  const holes = rd(w, 0xC4BD) ? rd(w, 0xC837) : (rd(w, 0xC837) - 1) & 0xFF;
  let e = (holes + (rb(B3C, RIVALS + 4 * a + 2) & 0x0F)) & 0xFF;
  if (!e) return [0, 0];
  if (!((e - 0x13) & 0x80)) e = 0x12;
  let l = d & 0x80 ? (-d) & 0xFF : d;
  let hl = Math.floor(mulHLByA(l, e) / 0x12) & 0xFFFF;   // 00:08B9 MulHLByA, 00:09AE DivHLByDE
  if (d & 0x80) hl = (-hl) & 0xFFFF;
  let dd = (hl + rivalHoleProfile(w, a, e)) & 0xFF;
  if (a === 0x1A && rd(w, 0xC837) === 0x12) {
    const player = scoreWord(rd(w, curPlayerField(w, 0x3E)));
    if (compare16(player, scoreWord(courseOffset(w))) === 0 && compare16(player, scoreWord(dd)) === 0) dd = (dd + 1) & 0xFF;
  }
  return [e, dd];
}
// 3C:6921 SortScoresWithIndex: a selection sort of n bytes at hl (ascending, the first of the smallest kept),
// the bytes at de swapped alike ($D54A, $D54E-$D551 hold the arguments)
function sortScoresWithIndex(w, n, hl, de) {
  wr(w, 0xD54A, n); w16(w, 0xD54E, de); w16(w, 0xD550, hl);
  for (let b = 0; ; b++) {
    const r = (n - 1 - b) & 0xFF;
    if (!r || r & 0x80) return;
    let c = b;
    for (let d = b + 1; ; d++) {
      const t = (n - d) & 0xFF;
      if (!t || t & 0x80) break;
      const a = (rd(w, hl + c) - rd(w, hl + d)) & 0xFF;
      if (a && !(a & 0x80)) c = d;
    }
    for (const p of [hl, de]) { const v = rd(w, p + c); wr(w, p + c, rd(w, p + b)); wr(w, p + b, v); }
  }
}
// 3C:6821 RankRivals: totals under the course's offset folded back ((|d|) + offset); the 27 totals to $D554 with
// their indices at $D572, sorted; a tie for first (and for second, third: each tested on the sorted totals) puts
// every rival after it a stroke back
function rankRivals(w, hl) {
  w16(w, 0xD552, hl);
  const b = courseOffset(w);
  for (let k = 0; k < 0x1B; k++) {
    const p = hl + 2 * k + 1, c = rd(w, p);
    if ((c - b) & 0x80) wr(w, p, ((c & 0x80 ? (-c) & 0xFF : c) + b) & 0xFF);
  }
  for (let k = 0; k < 0x1B; k++) { wr(w, 0xD554 + k, rd(w, hl + 2 * k + 1)); wr(w, 0xD572 + k, k); }
  sortScoresWithIndex(w, 0x1B, 0xD554, 0xD572);
  for (let t = 0; t < 3; t++) {
    if (rd(w, 0xD554 + t) !== rd(w, 0xD555 + t)) continue;
    for (let a = t + 1; a < 0x1B; a++) {
      const p = (r16(w, 0xD552) + 2 * rd(w, 0xD572 + a) + 1) & 0xFFFF;
      wr(w, p, (rd(w, p) + 1) & 0xFF);
    }
  }
}
// 3C:69D7 KeepRivalsBehindLeader: rivals 0-25 at or under rival 26's total get its total + 1
function keepRivalsBehindLeader(w, hl) {
  const b = rd(w, hl + 0x35);
  for (let k = 0; k < 0x1A; k++) {
    const p = hl + 2 * k + 1, a = (rd(w, p) - b) & 0xFF;
    if (!a || a & 0x80) wr(w, p, (b + 1) & 0xFF);
  }
}
// 3C:6686 SimulateRivalScores: the generator seeded from wRoundSeed $C9FE; each rival's round total (2 bytes at
// hl: the table offset's low byte, the total), the leader rule, the ranking, then each one's score after the holes
// played (holes, score); the 28th entry: the holes played and the player's score (field $3E)
export function simulateRivalScores(w, hl) {
  setW(w, 6);
  wr(w, 0xD596, rd(w, 0xC9FE)); wr(w, 0xD597, rd(w, 0xC9FF));
  for (let a = 0; a < 0x1B; a++) { wr(w, hl + 2 * a, (4 * a) & 0xFF); wr(w, hl + 2 * a + 1, rivalBaseScore(w, a)); }
  keepRivalsBehindLeader(w, hl);
  rankRivals(w, hl);
  for (let a = 0; a < 0x1B; a++) {
    const [e, d] = rivalScoreThroughHole(w, a, rd(w, hl + 2 * a + 1));
    wr(w, hl + 2 * a, e); wr(w, hl + 2 * a + 1, d);
  }
  const p = hl + 0x36;
  wr(w, p, rd(w, 0xC4BD) ? rd(w, 0xC837) : (rd(w, 0xC837) - 1) & 0xFF);
  wr(w, p + 1, rd(w, curPlayerField(w, 0x3E)));
}

// ---- bank 0E: the standings ----
// 0E:6EDB SumScoreToPar: l holes of the strokes at de (low nibbles) less their pars (13:7044)
export function sumScoreToPar(w, l, de) {
  let b = 0;
  for (let k = 1; k <= l; k++) b = ((rd(w, de + k - 1) & 0x0F) - holeParAndYards(rd(w, 0xC836), k)[0] + b) & 0xFF;
  return b;
}
// 0E:790A CopyStandingsScores: the 28 two-byte entries at src backwards into 4-byte entries at a list (score, -, id):
// the first (the 28th: the player) gets SumScoreToPar of the holes done ($C4BE) of $C8AC and id 0; the next (the
// 27th: rival 26) id course + 3; the others $80; $96 ends
function copyStandingsScores(w, src, list) {
  let hl = src + 0x37, o = 0;
  for (let c = 0x1C; c; c--) {
    list[o] = rd(w, hl--); list[o + 1] = rd(w, hl--);
    if (c === 0x1C) { list[o] = sumScoreToPar(w, rd(w, 0xC4BE), 0xC8AC); list[o + 2] = 0; }
    else if (c === 0x1B) list[o + 2] = (rd(w, 0xC836) + 3) & 0xFF;
    else list[o + 2] = 0x80;
    o += 4;
  }
  list[o] = 0x96;
}
// 0E:7950 AssignStandingsNames: each $80 entry gets $80 + its name's index in the course's golfer list (0E:4633),
// one more past the player's character's own name (text $43 + wCharId, compared through WRAM5 $DF00 / $DF10)
function assignStandingsNames(w, list) {
  const old = wbank(w);
  setW(w, 5);
  copyTextShortToDE(w, (0x43 + rd(w, 0xC810)) & 0xFFFF, 0xDF00);
  let b = 0, c = 0;
  for (let o = 0; list[o] !== 0x96; o += 4) {
    if (list[o + 2] !== 0x80) continue;
    const t = rb(0x0E, (0x4633 + ((2 * rd(w, 0xC836)) & 0xFF)) & 0xFFFF) | rb(0x0E, (0x4634 + ((2 * rd(w, 0xC836)) & 0xFF)) & 0xFFFF) << 8;
    copyTextShortToDE(w, (t + b) & 0xFFFF, 0xDF10);
    let hl = 0xDF00, de = 0xDF10;
    for (;;) {
      const a = rd(w, de);
      if (a !== rd(w, hl)) break;
      hl++; de++;
      if (!a) { c++; break; }
    }
    list[o + 2] = (c | 0x80) & 0xFF;
    c++; b++;
  }
  setW(w, old);
}
// 0E:79BD SortStandings: each entry of the list inserted into $D800 by score (+ $36: low first), then by its id byte
// (+2) on equal scores; an entry that makes way is carried on to its own place (the list's entry swapped with it)
function sortStandings(w, list, dst) {
  wr(w, dst, 0x96);
  for (let s = 0; list[s] !== 0x96; s += 4) {
    let hl = dst;
    for (;;) {
      if (rd(w, hl) === 0x96) {
        for (let k = 0; k < 3; k++) wr(w, hl + k, list[s + k]);
        wr(w, hl + 4, 0x96);
        break;
      }
      const b = (rd(w, hl) + 0x36) & 0xFF, a = (list[s] + 0x36) & 0xFF;
      let before = a < b;
      if (a === b) before = list[s + 2] < rd(w, hl + 2);
      if (before) {
        for (let k = 0; k < 3; k++) { const v = rd(w, hl + k); wr(w, hl + k, list[s + k]); list[s + k] = v; }
      }
      hl += 4;
    }
  }
}
// 0E:7A1C RankStandings: each entry's byte 3 = the index of the first entry with its score
function rankStandings(w, hl) {
  let d = 0, e = 0x9D;
  for (let c = 0; rd(w, hl) !== 0x96; c++, hl += 4) {
    if (rd(w, hl) !== e) { d = c; e = rd(w, hl); }
    wr(w, hl + 3, d);
  }
}
// 0E:7A36 MarkStandingsTies: bit 7 on both ranks of neighbours with the same rank
function markStandingsTies(w, hl) {
  let de = hl;
  hl += 4;
  for (;;) {
    const a = rd(w, hl); hl++;
    if (a === 0x96) return;
    de += 3;
    const b = rd(w, de) & 0x7F;
    hl += 2;
    const v = rd(w, hl) & 0x7F;
    if (v === b) { wr(w, de, v | 0x80); wr(w, hl, v | 0x80); }
    hl++; de++;
  }
}
// 0E:78B4 BuildStandings: wHolesDone $C4BE = the hole number (less one unless wStandingsPhase $C4BD); the rivals'
// scores (3C:6686) at WRAM6 $D800, then the list (on the stack), the names, the sorted standings at $D800, ranks,
// ties
export function buildStandings(w) {
  const old = wbank(w);
  let b = rd(w, 0xC837);
  if (b && !rd(w, 0xC4BD)) b = (b - 1) & 0xFF;
  wr(w, 0xC4BE, b);
  setW(w, 6);
  simulateRivalScores(w, 0xD800);
  setW(w, 6);
  const list = new Array(0x74).fill(0);
  copyStandingsScores(w, 0xD800, list);
  assignStandingsNames(w, list);
  sortStandings(w, list, 0xD800);
  rankStandings(w, 0xD800);
  markStandingsTies(w, 0xD800);
  setW(w, old);
}
// 0E:7887 GetPlayerRank / 0E:788D GetPlayerRankRaw: the rank byte of the player's entry (id 0) at WRAM6 $D800 (the
// last entry read when there is none), without the tie bit
export function getPlayerRank(w) {
  const old = wbank(w);
  setW(w, 6);
  let hl = 0xD800, c = 0;
  for (;;) {
    const a = rd(w, hl); hl++;
    if (a === 0x96) break;
    hl++;
    const id = rd(w, hl); hl++;
    c = rd(w, hl); hl++;
    if (!id) break;
  }
  setW(w, old);
  return c & 0x7F;
}

// ---- bank 08: the course statistics ----
// 08:43C5 CheckStatsCourse: courses 1-5 keep statistics
const statsCourse = w => { const c = rd(w, 0xC836); return c !== 0 && c < 6; };
// 08:43D4 GetCourseStatsAddr: $C980 + 25 x (course - 1)
const courseStatsAddr = w => (0xC980 + 25 * ((rd(w, 0xC836) - 1) & 0xFF)) & 0xFFFF;
// 08:43EE LoadCourseStatsWork: the course record's +6.. (16 bytes) to $C96E
export function loadCourseStatsWork(w) {
  if (!statsCourse(w)) return;
  D.copyMemoryFast(w, courseStatsAddr(w) + 6, 0xC96E, 1);
}
// 08:475F RoundStartMode1Tournament: sound $38; course 5 sets flag #127; the statistics' working copy; the honour
// cleared (08:4617); the standings (phase 0) and the player's rank to wPlayerRank $C875; wRoundResult 0
export function roundStartMode1(w, sound) {
  sound(0x38);
  if (rd(w, 0xC836) === 5) w.wram[0][0x840 + (127 >> 3)] |= 0x80 >> (127 & 7);
  loadCourseStatsWork(w);
  wr(w, 0xC83B, 0);
  wr(w, 0xC4BD, 0);
  buildStandings(w);                             // 0E:78B4
  setW(w, 6);
  wr(w, 0xC875, getPlayerRank(w));               // 0E:7887
  wr(w, 0xC96C, 0);
}

// a running count / total pair: below $FF the count + 1 and the total + v; at $FF (full) the total + v less its
// own high byte (a running average)
function countAdd(w, cnt, tot, v, word) {
  if (rd(w, cnt) !== 0xFF) {
    wr(w, cnt, rd(w, cnt) + 1);
    if (word) w16(w, tot, (r16(w, tot) + v) & 0xFFFF);
    else wr(w, tot, (rd(w, tot) + v) & 0xFF);
    return;
  }
  const hl = ((word ? r16(w, tot) : rd(w, tot)) + v) & 0xFFFF;
  const r = (hl - (hl >> 8)) & 0xFFFF;   // 00:08AC SubDEFromHL
  if (word) w16(w, tot, r); else wr(w, tot, r & 0xFF);
}
// 08:4405 IsGoodLie: the fairway, the green, $0A or $0E
const isGoodLie = t => (t === 0 || t === 0x0E || t === 6 || t === 0x0A ? 1 : 0);
// 08:441A UpdateTeeShotStats (mode 1, after a tee shot): fairways hit ($C973 count, $C974 hits); with the driver
// the drives' count and total of ShotLength / 32 ($C970, $C971: at $80 drives a running average); a drive of at
// least $18FF past the longest ($C96E) is the new longest: caption $1D
export function* updateTeeShotStats(sh, lie, len) {
  const w = sh.w;
  if (!statsCourse(w) || !rd(w, 0xD445)) return;
  const b = isGoodLie(lie());                    // 10:648B BallLieTerrain
  countAdd(w, 0xC973, 0xC974, b, false);
  if (!b) return;
  if (!rd(w, 0xD329)) {                          // the driver
    const v = len() >> 5;                        // 10:6276 ShotLength
    if (rd(w, 0xC970) !== 0x80) {
      wr(w, 0xC970, rd(w, 0xC970) + 1);
      w16(w, 0xC971, (v + r16(w, 0xC971)) & 0xFFFF);
    } else {
      const hl = (v + r16(w, 0xC971)) & 0xFFFF;
      w16(w, 0xC971, (hl - (hl >> 8)) & 0xFFFF);
    }
  }
  const hl = len();
  if ((hl + 0xE701) & 0x8000) return;
  if (((hl - ((r16(w, 0xC96E) + 1) & 0xFFFF)) & 0xFFFF) & 0x8000) return;
  w16(w, 0xC96E, hl);
  yield* showCaptionAndWait(sh, 0x1D);           // 3B:76F8
}
// 08:44D8 UpdateHoleEndStats (mode 1): putts (word total), greens in regulation (strokes - putts below par - 1),
// par or better (strokes below par + 1) and, after a bunker shot (player 1's +$15 bit 0), sand saves (the same)
export function updateHoleEndStats(w) {
  countAdd(w, 0xC975, 0xC976, rd(w, 0xC8A1), true);
  const par = rd(w, 0xD325);
  const gir = ((rd(w, 0xC8A0) - rd(w, 0xC8A1)) & 0xFF) < ((par - 1) & 0xFF) ? 1 : 0;
  countAdd(w, 0xC97A, 0xC97B, gir, false);
  const b = rd(w, 0xC8A0) < ((par + 1) & 0xFF) ? 1 : 0;
  countAdd(w, 0xC978, 0xC979, b, false);
  if (!(rd(w, 0xC895) & 1)) return;
  countAdd(w, 0xC97C, 0xC97D, b, false);
}
// 08:459E SaveCourseStats: the working copy back to the course record (+6); rounds + 1 (at most 9999: 08:4607
// ClampTo9999); the best score ($36 + to par, 0 counting as none); the scores' count and total (+3 / +4)
export function saveCourseStats(w) {
  if (!statsCourse(w)) return;
  const bc = courseStatsAddr(w);
  D.copyMemoryFast(w, 0xC96E, bc + 6, 1);
  let hl = (r16(w, bc) + 1) & 0xFFFF;
  if (!(((hl + 0xD8F0) & 0xFFFF) & 0x8000)) hl = 0x270F;
  w16(w, bc, hl);
  const e = (rd(w, 0xC8BE) + 0x36) & 0xFF;
  let a = rd(w, bc + 2);
  if (!a) a = 0xFF;
  if (a >= e) wr(w, bc + 2, e);
  countAdd(w, bc + 3, bc + 4, e, true);
}
// 08:4B3F HoleEndMode1Tournament: the standings (phase 0) and wPlayerRank; UpdateHoleEndStats; the scorecard
// (phase 1: 0E:43D6); the halfway picture (08:4F75)
export function* holeEndMode1(sh, showScorecard, showHalfwayPicture) {
  const w = sh.w;
  wr(w, 0xC4BD, 0);
  buildStandings(w);                             // 0E:78B4
  setW(w, 6);
  wr(w, 0xC875, getPlayerRank(w));               // 0E:7887
  updateHoleEndStats(w);
  wr(w, 0xC4BD, 1);
  yield* showScorecard(sh);                      // 0E:43D6
  yield* showHalfwayPicture(sh);                 // 08:4F75
}
// 08:4D18 SetRankExpBonus: places 1-3: wExpBonusKind $CAAD = the place, the bonus $CAAE from 08:4D3D (8 bytes a
// course & 7, a word a place)
function setRankExpBonus(w) {
  const r = rd(w, 0xC96C);
  if (r >= 4) return;
  wr(w, 0xCAAD, r);
  const p = (0x4D3D + ((((rd(w, 0xC836) & 7) << 3) + 2 * r) & 0xFF)) & 0xFFFF;
  wr(w, 0xCAAE, rb(0x08, p)); wr(w, 0xCAAF, rb(0x08, p + 1));
}
// 08:4BF9 RoundEndMode1Tournament: SaveCourseStats; the final standings (hole 18, phase 2) and the place to
// wRoundResult $C96C (rank + 1); the placing screen (0B:59DE with a = 1); for places 1-3: the course record's
// place bit ($14 + place; the first time also the EXP bonus), the return map and entrance (08:4C6E, unless one is
// set; story kind $32) and the course's played / won flags (#112-#116, #136-#139, #117); 10 points; the EXP
export function* roundEndMode1(sh, resultScreen, addPointsRaw, endFadeAndExp) {
  const w = sh.w;
  saveCourseStats(w);
  wr(w, 0xC837, 0x12);
  wr(w, 0xC4BD, 2);
  buildStandings(w);                             // 0E:78B4
  setW(w, 6);
  wr(w, 0xC96C, (getPlayerRank(w) + 1) & 0xFF);  // 0E:7887
  yield* resultScreen(1);                        // 0B:59DE
  const r = rd(w, 0xC96C);
  if (r < 4) {
    const course = rd(w, 0xC836);
    if (!testCourseHoleBit(w, course, (0x14 + r) & 0xFF)) {   // 02:5C77
      setCourseHoleBit(w, course, (0x14 + r) & 0xFF);         // 02:5CA5
      setRankExpBonus(w);
    }
    if (!rd(w, 0xC960)) {
      const t = (0x4C6E + (((course & 0x0F) << 2) & 0xFF)) & 0xFFFF;
      const m = rb(0x08, t);
      if (m) {
        wr(w, 0xC960, m);
        wr(w, 0xC961, rb(0x08, (t + r) & 0xFFFF));
        wr(w, 0xC967, 0x32);
      }
    }
    const setF = n => { w.wram[0][0x840 + (n >> 3)] |= 0x80 >> (n & 7); };
    const flags = { 1: [112, 136], 2: [113, 137], 3: [114, 138], 4: [115, 139], 5: [116, 117] }[course];
    if (flags) { setF(flags[0]); if (r === 1) setF(flags[1]); }
  }
  addPointsRaw(w, 0x0A);                         // 02:5415
  yield* endFadeAndExp(sh);                      // 08:4F03
}
