// Bank 30's map scripts (REVERSE.md "Banks 30 and 31"): the approach ranges, map $0D (the Marion Club's; maps $10,
// $13, $16 share the practice): the lessons are maps/lessons.js with each one's constants; the putting greens, maps
// $0E $11 $14 $17 (one header 30:642A): the pro's putting challenge and the practice.
import * as D from "../render/display.js";
import * as Scr from "../screen.js";
import * as S from "../script.js";
import * as T from "../msgbox.js";
import * as M from "../mapengine.js";
import * as St from "../start.js";
import { golfViewExit } from "../round.js";
import { pushTextNumberArg, setTextCourseIndex } from "../text.js";
import { saveGame } from "../save.js";
import * as Ls from "./lessons.js";
import { golfSessionEnd } from "../boot.js";

const rd = D.rd, wr = D.wr;
const B = 0x30;
const { testFlag, setFlag, clearFlag } = Ls;
function notPorted(what) { throw new Error(`${what} is not ported`); }

const LESSONS = {
  // 30:4119 Map0DTalk03RunningApproachLesson (coach 1, actor 3): the running approach
  running: { bank: B, map: 0x0D, coach: 0x03, flag: 101, seen: 160, ask: 0x0C9F, retry: 0x0D11, after: 0x0CA5,
    no: 0x0CAB, talkScript: 0x7D99, walkBack: 0x7DFF, walkFacing: 0xC0, afterFade: 0x04,
    demo: { entrance: 2, mode: 0x0C, strokes: 0x432E, golfer: 0x4F, hole: 0x08, tee: [0x1D60, 0x1F80], wind: 0xC000,
      hooks: 0x433E, offTee: true },
    try: { entrance: 4, mode: 0x0C, hole: 0x08, tee: [0x1D60, 0x1F80], shot: [0x06, 0x8000], wind: 0xC000,
      hooks: 0x43AF, offTee: true } },
  // 30:41A2 Map0DTalk04ChipApproachLesson (coach 2, actor 4): the chip shot
  chip: { bank: B, map: 0x0D, coach: 0x04, flag: 102, seen: 161, ask: 0x0CAD, retry: 0x0D12, after: 0x0CB3,
    no: 0x0CB9, talkScript: 0x7D99, walkBack: 0x7E08, walkFacing: 0x80, afterFade: 0x04,
    demo: { entrance: 3, mode: 0x0C, strokes: 0x459A, golfer: 0x4E, hole: 0x08, tee: [0x1E60, 0x1D60], wind: 0xC000,
      hooks: 0x45AA, offTee: true },
    try: { entrance: 5, mode: 0x0C, hole: 0x08, tee: [0x1E60, 0x1D60], shot: [0x0B, 0x6780], wind: 0xC000,
      hooks: 0x4627, offTee: true } },
};
// 30:4448 Map0DRunningApproachLessonResult (entrance 4): wEventResult 0 (within $60 of the pin): the cheer, $0CAA
// ($0CAC when the putter, club $0D, was used: wEventShotClub $C969), passed; else $0CA9
function* runningResult(sh) {
  const w = sh.w, L = LESSONS.running;
  yield* Ls.lessonResultBegin(sh, L);
  if (!rd(w, 0xC968)) {
    yield* Ls.lessonCheer(sh, L);
    yield* Ls.coachSays(sh, L, rd(w, 0xC969) === 0x0D ? 0x0CAC : 0x0CAA);
    Ls.lessonPassed(w, L);
  } else { yield* S.scriptWaitFrames(sh, 0x1E); yield* Ls.coachSays(sh, L, 0x0CA9); }
  yield* Ls.lessonResultEnd(sh, L);
}
// 30:46A1 Map0DChipApproachLessonResult (entrance 5): 0: the cheer, $0CB8, passed; else $0CB7
function* chipResult(sh) {
  const w = sh.w, L = LESSONS.chip;
  yield* Ls.lessonResultBegin(sh, L);
  if (!rd(w, 0xC968)) { yield* Ls.lessonCheer(sh, L); yield* Ls.coachSays(sh, L, 0x0CB8); Ls.lessonPassed(w, L); }
  else { yield* S.scriptWaitFrames(sh, 0x1E); yield* Ls.coachSays(sh, L, 0x0CB7); }
  yield* Ls.lessonResultEnd(sh, L);
}
// 30:429A Map0DEnter: not entrance 1: no name banner; 2 / 3 after a demo; 4 / 5 a lesson's result and a first success
// (#160 / #161: 20 EXP, warp 6 / 7); $FA: flag #100 cleared
function* map0DEnter(sh) {
  const w = sh.w;
  const e = rd(w, 0xC46A);
  if (e !== 1) { wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0); }
  if (e === 2) yield* Ls.lessonAfterDemo(sh, LESSONS.running);
  else if (e === 3) yield* Ls.lessonAfterDemo(sh, LESSONS.chip);
  else if (e === 4) { yield* runningResult(sh); yield* Ls.lessonFirstSuccess(sh, LESSONS.running, 0x0014, 6, saveGame); }
  else if (e === 5) { yield* chipResult(sh); yield* Ls.lessonFirstSuccess(sh, LESSONS.chip, 0x0014, 7, saveGame); }
  else if (e === 0xFA && testFlag(w, 100)) clearFlag(w, 100);
}
// 30:480D ApproachRangeStartPractice: the hole (30:4855: 8 / $0B / $0E for maps $0D / $10 / $13, else $11), game mode
// $0C, the hooks 30:48BC
function* approachRangeStartPractice(sh) {
  const m = rd(sh.w, 0xC450);
  yield* Ls.startPractice(sh, B, m === 0x0D ? 0x08 : m === 0x10 ? 0x0B : m === 0x13 ? 0x0E : 0x11, 0x0C, 0x48BC);
}
const within60 = sh => Ls.ballWithinPinDist(sh.w, 0x60);   // 30:7E2E with $60
// ---- the Palm approach range: map $10 ----
const LESSONS_10 = {
  // 30:4A26 Map10Talk03BunkerShotLesson (coach 1, actor 3): the bunker shot
  bunker: { bank: B, map: 0x10, coach: 0x03, flag: 101, seen: 164, ask: 0x0CBA, retry: 0x0D11, after: 0x0CC1,
    no: 0x0CC7, talkScript: 0x7D99, walkBack: 0x7DFF, walkFacing: 0xC0, afterFade: 0x04, music: 0x0A,
    resultWalk: [0x7DFF, 0x00],
    demo: { entrance: 2, mode: 0x0C, strokes: 0x4BF7, golfer: 0x4F, hole: 0x0B, tee: [0x2000, 0x2080], wind: 0xC000,
      hooks: 0x4C07, offTee: true },
    try: { entrance: 4, mode: 0x0C, hole: 0x0B, tee: [0x2000, 0x2080], shot: [0x0C, 0xC000], wind: 0xC000,
      hooks: 0x4C83, offTee: true } },
  // 30:4AAF Map10Talk04SlopedGreenApproachLesson (coach 2, actor 4): the running approach on a sloped green
  sloped: { bank: B, map: 0x10, coach: 0x04, flag: 102, seen: 165, ask: 0x0CC8, retry: 0x0D12, after: 0x0CCF,
    no: 0x0CD5, talkScript: 0x7D99, walkBack: 0x7E08, walkFacing: 0x80, afterFade: 0x04, music: 0x0A,
    resultWalk: [0x7DFF, 0x40], resultNoEnd: true,
    demo: { entrance: 3, mode: 0x0C, strokes: 0x4E37, golfer: 0x4E, hole: 0x0B, tee: [0x1CA0, 0x1FA0], wind: 0xC000,
      hooks: 0x4E47, offTee: true },
    try: { entrance: 5, mode: 0x0C, hole: 0x0B, tee: [0x1CA0, 0x1FA0], shot: [0x0D, 0xEED0], wind: 0xC000,
      hooks: 0x4EAD, offTee: true } },
};
// 30:4CF9 Map10BunkerShotLessonResult (entrance 4): 0 (within $60): the cheer, $0CC6, passed; else $0CC5 (no wait
// first, unlike the others); the coach walks back with his script facing up ($00, his No answer: $C0)
function* bunkerResult(sh) {
  const w = sh.w, L = LESSONS_10.bunker;
  yield* Ls.lessonResultBegin(sh, L);
  if (!rd(w, 0xC968)) { yield* Ls.lessonCheer(sh, L); yield* Ls.coachSays(sh, L, 0x0CC6); Ls.lessonPassed(w, L); }
  else yield* Ls.coachSays(sh, L, 0x0CC5);
  yield* Ls.lessonResultEnd(sh, L);
}
// 30:4F23 Map10SlopedGreenApproachLessonResult (entrance 5): 0: the cheer, $0CD4, passed; else $0CD3; quirks: the coach
// walks back with coach 1's script 30:7DFF facing $40, and the script is not ended (no ScriptEnd)
function* slopedResult(sh) {
  const w = sh.w, L = LESSONS_10.sloped;
  yield* Ls.lessonResultBegin(sh, L);
  if (!rd(w, 0xC968)) { yield* Ls.lessonCheer(sh, L); yield* Ls.coachSays(sh, L, 0x0CD4); Ls.lessonPassed(w, L); }
  else { yield* S.scriptWaitFrames(sh, 0x1E); yield* Ls.coachSays(sh, L, 0x0CD3); }
  yield* Ls.lessonResultEnd(sh, L);
}
// 30:4B62 Map10Enter: not entrance 1: no name banner; 2 / 3 after a demo; 4 / 5 a lesson's result and a first success
// (#164 / #165: 25 EXP, warp 6 / 7); $FA: flag #100 cleared
function* map10Enter(sh) {
  const w = sh.w, e = rd(w, 0xC46A);
  if (e !== 1) { wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0); }
  if (e === 2) yield* Ls.lessonAfterDemo(sh, LESSONS_10.bunker);
  else if (e === 3) yield* Ls.lessonAfterDemo(sh, LESSONS_10.sloped);
  else if (e === 4) { yield* bunkerResult(sh); yield* Ls.lessonFirstSuccess(sh, LESSONS_10.bunker, 0x0019, 6, saveGame); }
  else if (e === 5) { yield* slopedResult(sh); yield* Ls.lessonFirstSuccess(sh, LESSONS_10.sloped, 0x0019, 7, saveGame); }
  else if (e === 0xFA && testFlag(w, 100)) clearFlag(w, 100);
}
// ---- the Dune approach range: map $13 ----
const LESSONS_13 = {
  // 30:51A7 Map13Talk03BackspinLesson (coach 1, actor 3): the backspin approach over a bunker
  backspin: { bank: B, map: 0x13, coach: 0x03, flag: 101, seen: 168, ask: 0x0CD6, retry: 0x0D11, after: 0x0CDD,
    no: 0x0CE4, talkScript: 0x7D99, walkBack: 0x7DFF, walkFacing: 0x00, afterFade: 0x04, music: 0x09,
    resultWalk: [0x7E11, 0x00],
    demo: { entrance: 2, mode: 0x0C, strokes: 0x535F, golfer: 0x4F, hole: 0x0E, tee: [0x2360, 0x1E80], wind: 0xC000,
      hooks: 0x536F, offTee: true },
    try: { entrance: 4, mode: 0x0C, hole: 0x0E, tee: [0x2360, 0x1E80], shot: [0x0C, 0xA5C0], wind: 0xC000,
      hooks: 0x53D5, offTee: true } },
  // 30:5230 Map13Talk04UphillGreenLesson (coach 2, actor 4): the approach to a green up a steep climb
  uphill: { bank: B, map: 0x13, coach: 0x04, flag: 102, seen: 169, ask: 0x0CE5, retry: 0x0D12, after: 0x0CEC,
    no: 0x0CF2, talkScript: 0x7D99, walkBack: 0x7E08, walkFacing: 0x00, afterFade: 0x04, music: 0x09,
    resultWalk: [0x7DFF, 0x00], resultNoEnd: true,
    demo: { entrance: 3, mode: 0x0C, strokes: 0x55B1, golfer: 0x4E, hole: 0x0E, tee: [0x1F60, 0x1E40], wind: 0xC000,
      hooks: 0x55C1, offTee: true },
    try: { entrance: 5, mode: 0x0C, hole: 0x0E, tee: [0x1F60, 0x1E40], shot: [0x08, 0xDEC0], wind: 0xC000,
      hooks: 0x5627, offTee: true } },
};
// 30:545F Map13BackspinLessonResult (entrance 4): 0 (within $60): the cheer, $0CE3, passed; else (no wait first) $0CE1
// when the stroke record's +$0C ($C969) has bit 7 set, else $0CE2; quirk: the coach walks back with the contest
// coach's script 30:7E11
function* backspinResult(sh) {
  const w = sh.w, L = LESSONS_13.backspin;
  yield* Ls.lessonResultBegin(sh, L);
  if (!rd(w, 0xC968)) { yield* Ls.lessonCheer(sh, L); yield* Ls.coachSays(sh, L, 0x0CE3); Ls.lessonPassed(w, L); }
  else yield* Ls.coachSays(sh, L, rd(w, 0xC969) & 0x80 ? 0x0CE1 : 0x0CE2);
  yield* Ls.lessonResultEnd(sh, L);
}
// 30:56AE Map13UphillGreenLessonResult (entrance 5): 0: the cheer, $0CF1 ($0CF3 when the putter, club $0D), passed;
// else $0CF0; quirks: coach 2 walks back with coach 1's script 30:7DFF and the script is not ended
function* uphillResult(sh) {
  const w = sh.w, L = LESSONS_13.uphill;
  yield* Ls.lessonResultBegin(sh, L);
  if (!rd(w, 0xC968)) {
    yield* Ls.lessonCheer(sh, L);
    yield* Ls.coachSays(sh, L, rd(w, 0xC969) === 0x0D ? 0x0CF3 : 0x0CF1);
    Ls.lessonPassed(w, L);
  } else { yield* S.scriptWaitFrames(sh, 0x1E); yield* Ls.coachSays(sh, L, 0x0CF0); }
  yield* Ls.lessonResultEnd(sh, L);
}
// 30:52CB Map13Enter: as 30:429A (a first success #168 / #169: 45 EXP, warp 6 / 7)
function* map13Enter(sh) {
  const w = sh.w, e = rd(w, 0xC46A);
  if (e !== 1) { wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0); }
  if (e === 2) yield* Ls.lessonAfterDemo(sh, LESSONS_13.backspin);
  else if (e === 3) yield* Ls.lessonAfterDemo(sh, LESSONS_13.uphill);
  else if (e === 4) { yield* backspinResult(sh); yield* Ls.lessonFirstSuccess(sh, LESSONS_13.backspin, 0x002D, 6, saveGame); }
  else if (e === 5) { yield* uphillResult(sh); yield* Ls.lessonFirstSuccess(sh, LESSONS_13.uphill, 0x002D, 7, saveGame); }
  else if (e === 0xFA && testFlag(w, 100)) clearFlag(w, 100);
}
// ---- the putting greens: maps $0E $11 $14 $17 ----
// 30:6E49 PuttingGreenIndex: 0-3 for maps $0E $11 $14 $17 (anything else: the map id itself, a quirk of the fall-through)
function greenIndex(w) {
  const m = rd(w, 0xC450);
  return m === 0x0E ? 0 : m === 0x11 ? 1 : m === 0x14 ? 2 : m === 0x17 ? 3 : m;
}
// 30:6E74 / 6E89 / 6E9E / 6EB3: the cleared (#194 + green) and tried (#190 + green) flags
const clearedFlag = w => (194 + greenIndex(w)) & 0xFFFF, triedFlag = w => (190 + greenIndex(w)) & 0xFFFF;
// 30:69B9 PuttingGreenEnter: a return ($FA) clears the name banner; Links ($17): the golfers 30:657F, the talk list
// 30:68C7 (#139: 30:6919, #115: 30:68F0), the warps 30:662C; Dune ($14): 30:650A, 30:6886, 30:6613; Palm ($11): 30:64AD,
// 30:67E9, 30:660A, Azalea (actor 8) away until #142; back from a round ($FA): the practice ($14) or the challenge ($0A:
// 30:6CF2) over (wStoryRoundKind 0)
function* puttingGreenEnter(sh) {
  const w = sh.w;
  if (rd(w, 0xC46A) === 0xFA) { wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0); }
  const m = rd(w, 0xC450);
  if (m === 0x17) {
    M.scriptRespawnActors(w, B, 0x657F);
    M.scriptSetMapField(w, 0x68C7, 0x000C);
    M.scriptSetMapField(w, 0x662C, 0x0008);
    if (testFlag(w, 139)) M.scriptSetMapField(w, 0x6919, 0x000C);
    else if (testFlag(w, 115)) M.scriptSetMapField(w, 0x68F0, 0x000C);
  }
  const m2 = rd(w, 0xC450);
  if (m2 === 0x14) {
    M.scriptRespawnActors(w, B, 0x650A);
    M.scriptSetMapField(w, 0x6886, 0x000C);
    M.scriptSetMapField(w, 0x6613, 0x0008);
  } else if (m2 === 0x11) {
    M.scriptRespawnActors(w, B, 0x64AD);
    M.scriptSetMapField(w, 0x67E9, 0x000C);
    M.scriptSetMapField(w, 0x660A, 0x0008);
    if (!testFlag(w, 142)) S.actorSetPos(w, 0x08, 0x3F00, 0x3F00);
  }
  if (rd(w, 0xC46A) !== 0xFA) return;
  const k = rd(w, 0xC967);
  if (k === 0x14) { wr(w, 0xC967, 0x00); return; }
  if (k !== 0x0A) return;
  yield* puttingChallengeResult(sh);
  wr(w, 0xC967, 0x00);
}
// 30:6666 Map0ETalk08PuttingChallenge (the Marion pro, talk 8, speaker 8): "Try again?" ($10DB) once tried, else
// $10CE; cleared (#194): $10D9; else the question (30:6739) on that text: quirk: Marion's pro never makes the offer of
// 30:6701 the other greens' pros make (talk 6, speaker 6: 30:668B / 66B3 / 66DA: tried and not cleared: the question
// on $10DB; else $10CE, cleared: $10D9, not: the offer)
function* map0ETalkChallenge(sh) {
  const w = sh.w;
  T.scriptSetText(w, testFlag(w, triedFlag(w)) ? 0x10DB : 0x10CE);
  if (!testFlag(w, 194)) { yield* challengeAsk(sh); return; }
  T.scriptSetText(w, 0x10D9);
  yield* T.scriptShowText(sh, 0x08);
}
function* otherGreenTalkChallenge(sh, cleared) {
  const w = sh.w;
  if (testFlag(w, triedFlag(w))) {
    T.scriptSetText(w, 0x10DB);
    if (!testFlag(w, cleared)) { yield* challengeAsk(sh); return; }
  }
  T.scriptSetText(w, 0x10CE);
  if (!testFlag(w, cleared)) { yield* challengeOffer(sh); return; }
  T.scriptSetText(w, 0x10D9);
  yield* T.scriptShowText(sh, 0x06);
}
// 30:6701: the offer (30:6DF6: $10CF the furthest club won, else $10D0, with its name) asked: No: $10D1; Yes: $10D2 and
// the question (with 5 frames more than the No's)
function* challengeOffer(sh) {
  const w = sh.w;
  challengeOfferText(w);
  yield* T.scriptShowTextKeepOpen(sh, 0x06);
  yield* S.scriptWaitFrames(sh, 0x05);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* S.scriptWaitFrames(sh, 0x05);
  yield* S.scriptWaitFrames(sh, 0x05);
  if (a) { T.scriptSetText(w, 0x10D1); yield* T.scriptShowText(sh, 0x06); return; }
  T.scriptSetText(w, 0x10D2);
  yield* challengeAsk(sh);
}
// 30:6DF6 PuttingChallengeSetOfferText: the furthest club placed in (#115 / #114 / #113, else Marion): won (#139 /
// #138 / #137 / #136) $10CF, else $10D0; its name for code $0B (30:6E41 SetTextCourseIndex; $C3EA)
function challengeOfferText(w) {
  let e, won;
  if (testFlag(w, 115)) { e = 4; won = testFlag(w, 139); }
  else if (testFlag(w, 114)) { e = 3; won = testFlag(w, 138); }
  else if (testFlag(w, 113)) { e = 2; won = testFlag(w, 137); }
  else { e = 1; won = testFlag(w, 136); }
  T.scriptSetText(w, won ? 0x10CF : 0x10D0);
  D.inBank(w, 0x05, () => setTextCourseIndex(w, e));
  wr(w, 0xC3EA, e);
}
// 30:6739: the current text asked (speaker 6): No: $10D3; Yes: $10D4, wStoryRoundKind $0A, the counts $C3E0 / $C3E1
// cleared, GolfSessionInit, player 1 off the tee, game mode 5, the golfers, the green's challenge hole (30:6B90: course
// $0A holes $0C / 7 / 2 for maps $17 / $14 / $11, else course 8 hole $0E), the wind direction 0, the wind $C000, the
// hooks 30:6C0F, five holes
function* challengeAsk(sh) {
  const w = sh.w;
  yield* T.scriptShowTextKeepOpen(sh, 0x06);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* S.scriptWaitFrames(sh, 0x05);
  if (a) { T.scriptSetText(w, 0x10D3); yield* T.scriptShowText(sh, 0x06); return; }
  T.scriptSetText(w, 0x10D4);
  wr(w, 0xC967, 0x0A);
  yield* T.scriptShowText(sh, 0x06);
  wr(w, 0xC3E0, 0); wr(w, 0xC3E1, 0);
  St.golfSessionInit(w);
  Ls.setP1OffTee(w);
  wr(w, 0xC834, 0x05);
  St.setupPlayerGolfer(w, 0x80, 0x00);
  St.setupPlayerGolfer(w, 0xFF, 0x01);
  const m = rd(w, 0xC450);
  if (m === 0x17) St.setCourseHole(w, 0x0A, 0x0A, 0x0C);
  else if (m === 0x14) St.setCourseHole(w, 0x0A, 0x0A, 0x07);
  else if (m === 0x11) St.setCourseHole(w, 0x0A, 0x0A, 0x02);
  else St.setCourseHole(w, 0x08, 0x08, 0x0E);
  Ls.setForcedWindDir(w, 0x00);
  Ls.setForcedWind(w, 0xC000);
  Ls.setGolfEventHook(w, B, 0x6C0F);
  if (!sh.playGolfRound) notPorted("the putting challenge outside the game loop");
  yield* sh.playGolfRound(0x05);
  yield* Ls.inBankGen(w, 0x10, golfSessionEnd(sh));
}
// 30:6C2F PuttingChallengeShotSetup: once (flag #224): WRAM6, GolfViewExit, the rules $10D5 at (3, $0A) (speaker
// $80), GolfAdvanceFrame; the WRAM bank kept
function* challengeShotSetup(sh) {
  const w = sh.w;
  if (testFlag(w, 224)) return;
  setFlag(w, 224);
  const old = w.high[0x196];
  D.setWramBank(w, 6);
  yield* Ls.inBankGen(w, 0x10, golfViewExit(sh));
  yield* Ls.inBankGen(w, 0x05, T.showMessageAt(sh, 0x10D5, 0x80, 0x0A, 0x03));
  yield* Ls.golfAdvanceFrame(sh);
  D.setWramBank(w, old);
}
// 30:6CDF PuttingChallengePushCounts: the putts taken ($C3E0) and made ($C3E1)
function pushCounts(w) { pushTextNumberArg(w, rd(w, 0xC3E0)); pushTextNumberArg(w, rd(w, 0xC3E1)); }
// 30:6C58 PuttingChallengeAfterShot: a putt more; GolfViewExit; quit (mode 0): wStoryRoundKind 0, over ($82); within
// $34 of the pin: one made, $10D6, else (GolfViewExit again) $10D7 (the counts with them, at (3, $0A)); the 10th putt:
// over ($82); an odd putt: the same spot again (1); an even one: player 1 holed out and the next hole's start strokes
// (10:4C62 SetP1StartStrokes = the putts so far); GolfAdvanceFrame; the WRAM bank kept
function* challengeAfterShot(sh) {
  const w = sh.w;
  wr(w, 0xC3E0, (rd(w, 0xC3E0) + 1) & 0xFF);
  const old = w.high[0x196];
  yield* Ls.inBankGen(w, 0x10, golfViewExit(sh));
  let flag;
  if (!rd(w, 0xC834)) { wr(w, 0xC967, 0x00); flag = 0x82; }
  else {
    if (!Ls.ballWithinPinDist(w, 0x34)) {
      wr(w, 0xC3E1, (rd(w, 0xC3E1) + 1) & 0xFF);
      pushCounts(w);
      yield* Ls.inBankGen(w, 0x05, T.showMessageAt(sh, 0x10D6, 0x80, 0x0A, 0x03));
    } else {
      yield* Ls.inBankGen(w, 0x10, golfViewExit(sh));
      pushCounts(w);
      yield* Ls.inBankGen(w, 0x05, T.showMessageAt(sh, 0x10D7, 0x80, 0x0A, 0x03));
    }
    const n = rd(w, 0xC3E0);
    if (n === 0x0A) flag = 0x82;
    else if (n & 1) flag = 0x01;
    else {
      wr(w, 0xC8AA, 0x01);
      D.setWramBank(w, 6);
      w.wram[6][0x4EF] = n;                      // 10:4C62 SetP1StartStrokes
      yield* Ls.golfAdvanceFrame(sh);
      D.setWramBank(w, old);
      return;
    }
  }
  Ls.setGolfEventFlag(w, flag);
  yield* Ls.golfAdvanceFrame(sh);
  D.setWramBank(w, old);
}
// 30:6CF2 PuttingChallengeResult: ScriptBegin, the player faces the pro (actor 6), fade in (4); not cleared yet: 7 or
// more made: $10D8, the cleared flag, the EXP (30:6EC8), else $10DA and the tried flag; the pro faces down
function* puttingChallengeResult(sh) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  S.actorFaceActor(w, 0x06, 0x00);
  Scr.beginFadeIn(w, 0x04);
  yield* Scr.waitFade(sh);
  if (testFlag(w, clearedFlag(w))) return;
  if (rd(w, 0xC3E1) < 0x07) {
    T.scriptSetText(w, 0x10DA);
    setFlag(w, triedFlag(w));
    yield* T.scriptShowText(sh, 0x06);
    S.actorSetFacing(w, 0x06, 0x80);
    return;
  }
  T.scriptSetText(w, 0x10D8);
  yield* T.scriptShowText(sh, 0x06);
  setFlag(w, clearedFlag(w));
  yield* awardPuttingChallengeExp(sh);
  S.actorSetFacing(w, 0x06, 0x80);
}
// 30:6EC8 AwardPuttingChallengeExp: 50 / 45 / 25 EXP on maps $17 / $14 / $11, else 20, a quarter more for 10 made;
// AddExp, $011B (sound $38), WaitJingleEnd, the level-up screen, the return point here ($FA), SaveGame, the map again
// at the saved position (warp $FA)
function* awardPuttingChallengeExp(sh) {
  const w = sh.w, m = rd(w, 0xC450);
  let de = m === 0x17 ? 0x32 : m === 0x14 ? 0x2D : m === 0x11 ? 0x19 : 0x14;
  if (rd(w, 0xC3E1) === 0x0A) de = (de + (((de << 16 >> 16) >> 2) & 0xFFFF)) & 0xFFFF;
  yield* Ls.awardExpPlain(sh, de);
  Ls.saveReturnPoint(w, 0x00, 0xFA);
  saveGame(w);
  wr(w, 0xC441, 0xFA); wr(w, 0xC46A, 0xFA);
  for (let k = 0; k < 4; k++) wr(w, 0xC466 + k, rd(w, 0xC2A0 + k));
  wr(w, 0xC465, rd(w, 0xC2A4));
}
// 30:6A8C Map0ETalk09PuttDemo (talk 9): $10B8 (speaker 9); the ball (actor $0A) at ($2100, $2400), speed 8, 5 frames,
// the golfer's animation 4, 60 frames, sound $48, the ball rolls to ($2000, $1F00), sound $5A, the ball away
function* map0ETalk09PuttDemo(sh) {
  const w = sh.w;
  T.scriptSetText(w, 0x10B8);
  yield* T.scriptShowText(sh, 0x09);
  S.actorSetPos(w, 0x0A, 0x2100, 0x2400);
  S.actorSetSpeed(w, 0x0A, 0x0008);
  yield* S.scriptWaitFrames(sh, 0x05);
  S.actorPlayAnim(w, 0x09, 0x04);
  yield* S.scriptWaitFrames(sh, 0x3C);
  sh.sound(0x48);
  S.actorMoveTo(w, 0x0A, 0x2000, 0x1F00);
  yield* S.waitActorMoveDone(sh, 0x0A);
  sh.sound(0x5A);
  S.actorSetPos(w, 0x0A, 0x3F00, 0x3F00);
}
// 30:6B13 PuttingGreenStartPractice: wStoryRoundKind $14, GolfSessionInit, player 1 off the tee, game mode 7, the
// golfers, the green's hole and music (30:6B51: hole $12 / $0F / $0C / 9, music $0B / 9 / $0A / 8 for maps $17 / $14 /
// $11 / else), the wind direction 0, the tee near the player (30:6D40), the wind $C000, the hooks 30:6BDB, one hole
function* puttingGreenStartPractice(sh) {
  const w = sh.w;
  wr(w, 0xC967, 0x14);
  St.golfSessionInit(w);
  Ls.setP1OffTee(w);
  wr(w, 0xC834, 0x07);
  St.setupPlayerGolfer(w, 0x80, 0x00);
  St.setupPlayerGolfer(w, 0xFF, 0x01);
  const m = rd(w, 0xC450);
  const [hole, music] = m === 0x17 ? [0x12, 0x0B] : m === 0x14 ? [0x0F, 0x09] : m === 0x11 ? [0x0C, 0x0A] : [0x09, 0x08];
  St.setCourseHole(w, 0x07, 0x07, hole);
  wr(w, 0xC82C, music);
  Ls.setForcedWindDir(w, 0x00);
  // 30:6D40 PuttingSetTeeNearPlayer: the green's base (30:6D89, $C3E2 / $C3E4) + (the saved position - the base) / 4
  const [bx, by] = m === 0x17 ? [0x2780, 0x1DC0] : m === 0x14 ? [0x28C0, 0x20E0] : m === 0x11 ? [0x1F40, 0x2040] : [0x21E0, 0x1EC0];
  wr(w, 0xC3E2, bx & 0xFF); wr(w, 0xC3E3, bx >> 8); wr(w, 0xC3E4, by & 0xFF); wr(w, 0xC3E5, by >> 8);
  const q = v => (((v << 16 >> 16) >> 2) & 0xFFFF);
  const de = (q(((rd(w, 0xC2A2) | rd(w, 0xC2A3) << 8) - by) & 0xFFFF) + by) & 0xFFFF;
  const hl = (q(((rd(w, 0xC2A0) | rd(w, 0xC2A1) << 8) - bx) & 0xFFFF) + bx) & 0xFFFF;
  Ls.setForcedTee(w, hl, de);
  Ls.setForcedWind(w, 0xC000);
  Ls.setGolfEventHook(w, B, 0x6BDB);
  yield* Ls.lessonRound(sh);
}
// 30:6BFC PuttingGreenPracticeAfterShot: still game mode 7: the same spot again (1); else (quit) over ($80)
function* puttingPracticeAfterShot(sh) {
  Ls.setGolfEventFlag(sh.w, rd(sh.w, 0xC834) === 0x07 ? 0x01 : 0x80);
}

export const HOOKS = {
  "30:6c2f": challengeShotSetup,
  "30:6c58": challengeAfterShot,
  "30:6bfb": function* () {},                     // 30:6BFB PuttingGreenPracticeShotSetup: ret
  "30:6bfc": puttingPracticeAfterShot,
  "30:435e": sh => Ls.hookShotSetup(sh, 0x03, [0x0CA2, 0x0CA3, 0x0CA4]),          // 30:435E
  "30:439b": sh => Ls.hookDemoAfterShot(sh),                                      // 30:439B
  "30:43cf": sh => Ls.hookShotSetup(sh, 0x03, [0x0CA6, 0x0CA7, 0x0CA8], { wait: "frames" }),   // 30:43CF
  "30:4409": sh => Ls.hookTryAfterShot(sh, 0x06, within60, { club: true }),       // 30:4409
  "30:45ca": sh => Ls.hookShotSetup(sh, 0x04, [0x0CB0, 0x0CB1, 0x0CB2]),          // 30:45CA
  "30:4607": sh => Ls.hookDemoAfterShot(sh, { holed: true }),                     // 30:4607 (flag #99: a quirk)
  "30:4647": sh => Ls.hookShotSetup(sh, 0x04, [0x0CB4, 0x0CB5, 0x0CB6], { push: false, wait: "frames" }),   // 30:4647
  "30:4673": sh => Ls.hookTryAfterShot(sh, 0x07, within60),                       // 30:4673
  "30:4c27": sh => Ls.hookShotSetup(sh, 0x03, [0x0CBD, 0x0CBE, 0x0CBF, 0x0CC0]),   // 30:4C27 Map10BunkerShotDemoShotSetup
  "30:4c6f": sh => Ls.hookDemoAfterShot(sh),                                      // 30:4C6F
  "30:4ca3": sh => Ls.hookShotSetup(sh, 0x03, [0x0CA6, 0x0CA7, 0x0CA8], { push: false, wait: "none" }),   // 30:4CA3 (the Marion texts)
  "30:4ccb": sh => Ls.hookTryAfterShot(sh, 0x06, within60),                       // 30:4CCB
  "30:4e67": sh => Ls.hookShotSetup(sh, 0x04, [0x0CCB, 0x0CCC, 0x0CCD, 0x0CCE], { push: false }),   // 30:4E67
  "30:4ea1": sh => Ls.hookDemoAfterShot(sh, { push: false }),                     // 30:4EA1
  "30:4ecd": sh => Ls.hookShotSetup(sh, 0x04, [0x0CD0, 0x0CD1, 0x0CD2], { push: false, wait: "none" }),   // 30:4ECD
  "30:4ef5": sh => Ls.hookTryAfterShot(sh, 0x07, within60),                       // 30:4EF5
  "30:538f": sh => Ls.hookShotSetup(sh, 0x03, [0x0CD9, 0x0CDA, 0x0CDB, 0x0CDC], { push: false }),   // 30:538F Map13BackspinDemoShotSetup
  "30:53c9": sh => Ls.hookDemoAfterShot(sh, { push: false }),                     // 30:53C9
  "30:53f5": sh => Ls.hookShotSetup(sh, 0x03, [0x0CDE, 0x0CDF, 0x0CE0], { push: false, wait: "none" }),   // 30:53F5
  "30:541d": sh => Ls.hookTryAfterShot(sh, 0x06, within60, { club: 0x68C }),      // 30:541D (+$0C of the record)
  "30:55e1": sh => Ls.hookShotSetup(sh, 0x04, [0x0CE8, 0x0CE9, 0x0CEA, 0x0CEB], { push: false }),   // 30:55E1
  "30:561b": sh => Ls.hookDemoAfterShot(sh, { push: false }),                     // 30:561B
  "30:5647": sh => Ls.hookShotSetup(sh, 0x04, [0x0CED, 0x0CEE, 0x0CEF], { push: false, wait: "none" }),   // 30:5647
  "30:566f": sh => Ls.hookTryAfterShot(sh, 0x07, within60, { club: true }),       // 30:566F
  "30:48dc": function* () {},                     // 30:48DC ApproachRangePracticeShotSetup: ret
  "30:48dd": Ls.hookPracticeAfterShot,            // 30:48DD ApproachRangePracticeAfterShot
};
export const SCRIPTS = {
  "30:69b9": puttingGreenEnter,
  "30:6635": sh => Ls.tipTalk(sh, 0x10B1, 0x02),  // 30:6635 PuttingGreenTalk02PuttingTip
  "30:6666": map0ETalkChallenge,
  "30:668b": sh => otherGreenTalkChallenge(sh, 195),   // 30:668B Map11Talk06PuttingChallenge
  "30:66b3": sh => otherGreenTalkChallenge(sh, 196),   // 30:66B3 Map14Talk06PuttingChallenge
  "30:66da": sh => otherGreenTalkChallenge(sh, 197),   // 30:66DA Map17Talk06PuttingChallenge
  "30:6a8c": map0ETalk09PuttDemo,
  "30:6ae0": function* (sh) { T.scriptSetText(sh.w, 0x10B8); yield* T.scriptShowText(sh, 0x09); },   // 30:6AE0
  "30:6aec": sh => Ls.triggerPractice(sh, puttingGreenStartPractice),   // 30:6AEC PuttingGreenTriggerPractice
  "30:6942": function* (sh) { if (rd(sh.w, 0xC810) !== 0x02) notPorted("meeting Azalea (~30:6949)"); },   // 30:6942
  "30:429a": map0DEnter,
  "30:40ee": sh => Ls.tipTalk(sh, 0x0C63, 0x02, false),   // 30:40EE Map0DTalk02ApproachTip
  "30:4119": sh => Ls.lessonTalk(sh, LESSONS.running),
  "30:41a2": sh => Ls.lessonTalk(sh, LESSONS.chip),
  "30:422b": sh => Ls.tipTalk(sh, 0x0C66, 0x06, false),   // 30:422B Map0DTalk05PitchAndPuttTip
  "30:4b62": map10Enter,
  "30:49d0": sh => Ls.tipTalk(sh, 0x0C6A, 0x02, false),   // 30:49D0 Map10Talk02ApproachClubTip
  "30:49fb": sh => Ls.tipTalk(sh, 0x0C6D, 0x06, false),   // 30:49FB Map10Talk05SpinTip (speaker 6)
  "30:4a26": sh => Ls.lessonTalk(sh, LESSONS_10.bunker),
  "30:4aaf": sh => Ls.lessonTalk(sh, LESSONS_10.sloped),
  "30:52cb": map13Enter,
  "30:515d": sh => Ls.chainedTip(sh, 0x0C72, 0x06, false),   // 30:515D Map13Talk05SpinTip
  "30:51a7": sh => Ls.lessonTalk(sh, LESSONS_13.backspin),
  "30:5230": sh => Ls.lessonTalk(sh, LESSONS_13.uphill),
  "30:4277": Ls.triggerLingoSign,                // 30:4277 Map0DTriggerGolfLingoSign
  "30:47e6": sh => Ls.triggerPractice(sh, approachRangeStartPractice),   // 30:47E6 ApproachRangeTriggerPractice
  "30:7df3": function* () {},                    // 30:7DF3 MapScriptNop_30 (object 1)
};
export const TASKS = () => ({});
