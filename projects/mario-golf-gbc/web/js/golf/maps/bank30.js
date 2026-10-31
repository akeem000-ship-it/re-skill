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
import { pushTextNumberArg, setTextCourseIndex, copyTextShortToDE } from "../text.js";
import { mapBufCopyRectRedraw } from "../mapgfx.js";
import { rb } from "../rom.js";
import { saveGame } from "../save.js";
import * as Ls from "./lessons.js";
import * as Rh from "../render/hooks.js";
import { golfSessionEnd } from "../boot.js";
import { awardFoundAllRivalsExp } from "./bank34.js";

const rd = D.rd, wr = D.wr;
const B = 0x30;
const { testFlag, setFlag, clearFlag } = Ls;
function notPorted(what) { throw new Error(`${what} is not ported`); }

const LESSONS = {
  // 30:4119 Map0DTalk03RunningApproachLesson (coach 1, actor 3): the running approach
  // (its copies of the engine: the retry 30:44D0, the after-demo question 30:44DA, the question 30:4506)
  running: { bank: B, map: 0x0D, coach: 0x03, flag: 101, seen: 160, ask: 0x0C9F, retry: 0x0D11, after: 0x0CA5,
    no: 0x0CAB, talkScript: 0x7D99, walkBack: 0x7DFF, walkFacing: 0xC0, afterFade: 0x04,
    demo: { entrance: 2, mode: 0x0C, strokes: 0x432E, golfer: 0x4F, hole: 0x08, tee: [0x1D60, 0x1F80], wind: 0xC000,
      hooks: 0x433E, offTee: true },
    try: { entrance: 4, mode: 0x0C, hole: 0x08, tee: [0x1D60, 0x1F80], shot: [0x06, 0x8000], wind: 0xC000,
      hooks: 0x43AF, offTee: true } },
  // 30:41A2 Map0DTalk04ChipApproachLesson (coach 2, actor 4): the chip shot
  // (the retry 30:471C, the after-demo question 30:4726, the question 30:4752; boot_kid_story_lesson_chip)
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
// 30:480D ApproachRangeStartPractice: the hole (30:4855 / 30:486C: 8 / $0B / $0E for maps $0D / $10 / $13, else $11), game mode
// $0C, the hooks 30:48BC
function* approachRangeStartPractice(sh) {
  const m = rd(sh.w, 0xC450);
  yield* Ls.startPractice(sh, B, m === 0x0D ? 0x08 : m === 0x10 ? 0x0B : m === 0x13 ? 0x0E : 0x11, 0x0C, 0x48BC);
}
// 30:4888 ApproachRangeKeepPracticingUnused (unreferenced): ScriptBegin; fade in (8); "Keep practicing?" ($0C61) kept open
// (speaker $80); Yes / No; closed; 5 frames; Yes: ApproachRangeStartPractice (30:480D); No (or B): the text shown
// ($80); ScriptEnd
function* approachRangeKeepPracticing(sh) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  T.scriptSetText(w, 0x0C61);
  yield* T.scriptShowTextKeepOpen(sh, 0x80);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* S.scriptWaitFrames(sh, 0x05);
  if (a) yield* T.scriptShowText(sh, 0x80);
  else yield* approachRangeStartPractice(sh);
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}
const within60 = sh => Ls.ballWithinPinDist(sh.w, 0x60);   // 30:7E2E with $60
// ---- the Palm approach range: map $10 ----
const LESSONS_10 = {
  // 30:4A26 Map10Talk03BunkerShotLesson (coach 1, actor 3): the bunker shot
  // (the retry 30:4D6D, the after-demo question 30:4D77, the question 30:4DA3)
  bunker: { bank: B, map: 0x10, coach: 0x03, flag: 101, seen: 164, ask: 0x0CBA, retry: 0x0D11, after: 0x0CC1,
    no: 0x0CC7, talkScript: 0x7D99, walkBack: 0x7DFF, walkFacing: 0xC0, afterFade: 0x04, music: 0x0A,
    resultWalk: [0x7DFF, 0x00],
    demo: { entrance: 2, mode: 0x0C, strokes: 0x4BF7, golfer: 0x4F, hole: 0x0B, tee: [0x2000, 0x2080], wind: 0xC000,
      hooks: 0x4C07, offTee: true },
    try: { entrance: 4, mode: 0x0C, hole: 0x0B, tee: [0x2000, 0x2080], shot: [0x0C, 0xC000], wind: 0xC000,
      hooks: 0x4C83, offTee: true } },
  // 30:4AAF Map10Talk04SlopedGreenApproachLesson (coach 2, actor 4): the running approach on a sloped green
  // (the retry 30:4F9B, the after-demo question 30:4FA5, the question 30:4FD1)
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
  // (the retry 30:54E7, the after-demo question 30:54F1, the question 30:551D)
  backspin: { bank: B, map: 0x13, coach: 0x03, flag: 101, seen: 168, ask: 0x0CD6, retry: 0x0D11, after: 0x0CDD,
    no: 0x0CE4, talkScript: 0x7D99, walkBack: 0x7DFF, walkFacing: 0x00, afterFade: 0x04, music: 0x09,
    resultWalk: [0x7E11, 0x00],
    demo: { entrance: 2, mode: 0x0C, strokes: 0x535F, golfer: 0x4F, hole: 0x0E, tee: [0x2360, 0x1E80], wind: 0xC000,
      hooks: 0x536F, offTee: true },
    try: { entrance: 4, mode: 0x0C, hole: 0x0E, tee: [0x2360, 0x1E80], shot: [0x0C, 0xA5C0], wind: 0xC000,
      hooks: 0x53D5, offTee: true } },
  // 30:5230 Map13Talk04UphillGreenLesson (coach 2, actor 4): the approach to a green up a steep climb
  // (the retry 30:5733, the after-demo question 30:573D, the question 30:5769)
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
// ---- the Links approach range: map $16 (its lessons; after the Links tournament won, its contests) ----
const LESSONS_16 = {
  // 30:5A94 Map16Talk03MoundApproachLesson (coach 1, actor 3): over a mound to a downhill pin (quirk: the try has no
  // forced shot)
  // (the retry 30:5D4A, the after-demo question 30:5D54)
  mound: { bank: B, map: 0x16, coach: 0x03, flag: 101, seen: 172, ask: 0x0CF4, retry: 0x0D11, after: 0x0CFB,
    no: 0x0D02, talkScript: 0x7D99, walkBack: 0x7DFF, walkFacing: 0x80, afterFade: 0x04, music: 0x0B,
    resultWalk: [0x7E11, 0x80],
    demo: { entrance: 2, mode: 0x0C, music: 0x07, strokes: 0x5BC2, golfer: 0x4F, hole: 0x11, tee: [0x1EC0, 0x2060],
      wind: 0xC000, hooks: 0x5BD2, offTee: true },
    try: { entrance: 4, mode: 0x0C, hole: 0x11, tee: [0x1EC0, 0x2060], shot: null, wind: 0xC000, hooks: 0x5C38,
      offTee: true } },
  // 30:5B2B Map16Talk04SlopeApproachLesson (coach 2, actor 4): across a steep slope (no forced shot either)
  // (the retry 30:5F70, the after-demo question 30:5F7A, the question 30:5FA6)
  slope: { bank: B, map: 0x16, coach: 0x04, flag: 102, seen: 173, ask: 0x0D03, retry: 0x0D12, after: 0x0D0A,
    no: 0x0D10, talkScript: 0x7D99, walkBack: 0x7E08, walkFacing: 0x40, afterFade: 0x04, music: 0x0B,
    resultWalk: [0x7DFF, 0x40], resultNoEnd: true,
    demo: { entrance: 3, mode: 0x0C, music: 0x07, strokes: 0x5E0C, golfer: 0x4E, hole: 0x11, tee: [0x1D60, 0x2380],
      wind: 0xC000, hooks: 0x5E1C, offTee: true },
    try: { entrance: 5, mode: 0x0C, hole: 0x11, tee: [0x1D60, 0x2380], shot: null, wind: 0xC000, hooks: 0x5E82,
      offTee: true } },
};
// 30:6414 Map16UnlockContests: after the Links win (#139): #224 once the mound lesson is passed (#172), #225 once the
// slope's (#173); quirk: the same contest flags as the driving range's (31:7051 sets them for #174 / #175)
function unlockContests16(w) {
  if (!testFlag(w, 139)) return;
  if (testFlag(w, 172)) setFlag(w, 224);
  if (testFlag(w, 173)) setFlag(w, 225);
}
// 30:5CC2 Map16MoundApproachLessonResult (entrance 4): 0 (within $60): the cheer, $0D01, passed; else (no wait first)
// $0CFF when the stroke record's +$0C ($C969) has bit 7 set, else $0D00; the coach walks back with the contest coach's
// script 30:7E11 facing $80
function* moundResult(sh) {
  const w = sh.w, L = LESSONS_16.mound;
  yield* Ls.lessonResultBegin(sh, L);
  if (!rd(w, 0xC968)) { yield* Ls.lessonCheer(sh, L); yield* Ls.coachSays(sh, L, 0x0D01); Ls.lessonPassed(w, L); }
  else yield* Ls.coachSays(sh, L, rd(w, 0xC969) & 0x80 ? 0x0CFF : 0x0D00);
  yield* Ls.lessonResultEnd(sh, L);
}
// 30:5EF8 Map16SlopeApproachLessonResult (entrance 5): 0: the cheer, $0D0F, passed; else $0D0E; coach 2 walks back with
// coach 1's script facing $40 and the script is not ended (quirks, as on maps $10 / $13)
function* slopeResult(sh) {
  const w = sh.w, L = LESSONS_16.slope;
  yield* Ls.lessonResultBegin(sh, L);
  if (!rd(w, 0xC968)) { yield* Ls.lessonCheer(sh, L); yield* Ls.coachSays(sh, L, 0x0D0F); Ls.lessonPassed(w, L); }
  else { yield* S.scriptWaitFrames(sh, 0x1E); yield* Ls.coachSays(sh, L, 0x0D0E); }
  yield* Ls.lessonResultEnd(sh, L);
}
// the contests (30:6159 / 30:634A): ScriptBegin, the coach's talking script facing the player, fade in (4), the
// challenge $0C82 / $0C8A asked (30:6185 / 30:6376): No: $0C96 / $0C8B, the coach walks back (coach 1's script 30:7DFF
// facing $80 for both: a quirk for coach 2); Yes: #101 / #102, the next text, the counts ($C968 made, $C969 tries)
// cleared, GolfSessionInit, music $0B until won (#220 / #221), player 1 off the tee, the return point (entrance 4 / 5),
// game mode 5, the player's golfer, course 7 hole $11, the wind direction 0, the tee ($1E60, $20A0) / ($1D60, $22C0),
// the wind $C000, the hooks 30:6032 / 30:6223, one hole; ScriptEnd
const CONTESTS_16 = {
  mound: { coach: 0x03, flag: 101, won: 220, offer: 0x0C82, no: 0x0C96, entrance: 4, tee: [0x1E60, 0x20A0], hooks: 0x6032 },
  slope: { coach: 0x04, flag: 102, won: 221, offer: 0x0C8A, no: 0x0C8B, entrance: 5, tee: [0x1D60, 0x22C0], hooks: 0x6223 },
};
function* contestOffer16(sh, C) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  S.actorSetScript(w, C.coach, 0x7D99, B);
  S.actorFaceActor(w, C.coach, rd(w, 0xC296));
  Scr.beginFadeIn(w, 0x04);
  yield* Scr.waitFade(sh);
  T.scriptSetText(w, C.offer);
  yield* T.scriptShowTextKeepOpen(sh, C.coach);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* S.scriptWaitFrames(sh, 0x05);
  if (a) {
    T.scriptSetText(w, C.no);
    yield* T.scriptShowText(sh, C.coach);
    S.actorSetScript(w, C.coach, 0x7DFF, B);
    S.actorSetFacing(w, C.coach, 0x80);
  } else {
    setFlag(w, C.flag);
    T.scriptSkipText(w);
    yield* T.scriptShowText(sh, C.coach);
    wr(w, 0xC968, 0); wr(w, 0xC969, 0);
    St.golfSessionInit(w);
    if (!testFlag(w, C.won)) wr(w, 0xC82C, 0x0B);
    Ls.setP1OffTee(w);
    Ls.saveReturnPoint(w, 0x16, C.entrance);
    wr(w, 0xC834, 0x05);
    St.setupPlayerGolfer(w, 0x80, 0x00);
    St.setupPlayerGolfer(w, 0xFF, 0x01);
    St.setCourseHole(w, 0x07, 0x07, 0x11);
    Ls.setForcedWindDir(w, 0x00);
    Ls.setForcedTee(w, C.tee[0], C.tee[1]);
    Ls.setForcedWind(w, 0xC000);
    Ls.setGolfEventHook(w, B, C.hooks);
    yield* Ls.lessonRound(sh);
  }
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}
// 30:60DA / 30:62CB the contests' results (entrances 4 / 5 with #224 / #225): ScriptBegin, the coach's talking script
// facing the player, fade in (8), 30 frames; 7 or more made: flag #99 for all ten, the cheer, $0C87 / $0C8F, #98, #101
// cleared (quirk: #101 for the slope's contest too); else $0C89 / $0C91; the contest coach's script 30:7E11 facing
// $80, ScriptEnd
function* contestResult16(sh, coach, win, loss) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  S.actorSetScript(w, coach, 0x7D99, B);
  S.actorFaceActor(w, coach, rd(w, 0xC296));
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  yield* S.scriptWaitFrames(sh, 0x1E);
  const made = rd(w, 0xC968);
  if (made >= 0x07) {
    clearFlag(w, 99);
    if (made === 0x0A) setFlag(w, 99);
    S.actorPlayAnim(w, coach, 0x07);
    yield* S.waitActorAnimDone(sh, coach);
    yield* S.scriptWaitFrames(sh, 0x1E);
    T.scriptSetText(w, win);
    yield* T.scriptShowText(sh, coach);
    setFlag(w, 98); clearFlag(w, 101);
  } else {
    T.scriptSetText(w, loss);
    yield* T.scriptShowText(sh, coach);
  }
  S.actorSetScript(w, coach, 0x7E11, B);
  S.actorSetFacing(w, coach, 0x80);
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}
// a first success or win: (30 frames: wait), the flag, 50 EXP (30:7E7F, a quarter more with #99), the return point
// (map 0, $FA), SaveGame, the warp
function* firstSuccess16(sh, seen, warp, wait) {
  const w = sh.w;
  if (!testFlag(w, 98)) return;
  clearFlag(w, 98);
  if (testFlag(w, seen)) return;
  if (wait) yield* sh.advance(0x1E);
  setFlag(w, seen);
  yield* Ls.awardExpWithBonus(sh, 0x0032);
  Ls.saveReturnPoint(w, 0x00, 0xFA);
  saveGame(w);
  wr(w, 0xC441, warp);
}
// 30:597C Map16Enter: Map16UnlockContests; the talk list 30:5941 once the Links is won (#139), else 30:5918 after the
// Links tournament (#115); not entrance 1: no name banner; 2 / 3 after a demo; 4 / 5 the contest's (#224 / #225) or
// the lesson's result and a first win or success (#220 / #172 with 30 frames first, #221 / #173 without; 50 EXP;
// warps 6 / 7); $FA: #100 cleared
function* map16Enter(sh) {
  const w = sh.w;
  unlockContests16(w);
  if (testFlag(w, 139)) M.scriptSetMapField(w, 0x5941, 0x000C);
  else if (testFlag(w, 115)) M.scriptSetMapField(w, 0x5918, 0x000C);
  const e = rd(w, 0xC46A);
  if (e !== 1) { wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0); }
  if (e === 2) yield* Ls.lessonAfterDemo(sh, LESSONS_16.mound);
  else if (e === 3) yield* Ls.lessonAfterDemo(sh, LESSONS_16.slope);
  else if (e === 4) {
    if (testFlag(w, 224)) { yield* contestResult16(sh, 0x03, 0x0C87, 0x0C89); yield* firstSuccess16(sh, 220, 0x06, true); }
    else { yield* moundResult(sh); yield* firstSuccess16(sh, 172, 0x06, true); }
  } else if (e === 5) {
    if (testFlag(w, 225)) { yield* contestResult16(sh, 0x04, 0x0C8F, 0x0C91); yield* firstSuccess16(sh, 221, 0x07, false); }
    else { yield* slopeResult(sh); yield* firstSuccess16(sh, 173, 0x07, false); }
  } else if (e === 0xFA && testFlag(w, 100)) clearFlag(w, 100);
}
// 30:6052 / 30:6243 the contests' shot set-ups: the tries so far ($C969) as player 1's strokes, HudDrawPlayer1 12:4B8A
function* contestShotSetup16(sh) {
  const w = sh.w;
  wr(w, 0xC8A0, rd(w, 0xC969));
  Rh.hud(w, "hudDrawPlayer1");
}
// 30:605C / 30:624D the contests' after-shots: GolfViewExit; quit: the return entrance 6 / 7, the round over; within
// $60 of the pin one more made ($0C85 / $0C8D), else $0C86 / $0C8E (the tries, then the made, as the numbers); a try
// more; the tenth: 7 or more made sets #98, the round over; else the same spot again (1)
function* contestAfterShot16(sh, quitEntrance, coach, madeText, missText) {
  const w = sh.w;
  yield* Ls.inBankGen(w, 0x10, golfViewExit(sh));
  if (!rd(w, 0xC834)) {
    wr(w, 0xC961, quitEntrance);
    Ls.setGolfEventFlag(w, 0x82);
    yield* Ls.golfAdvanceFrame(sh);
    return;
  }
  const inside = !within60(sh);
  if (inside) wr(w, 0xC968, (rd(w, 0xC968) + 1) & 0xFF);
  const made = rd(w, 0xC968);
  wr(w, 0xC969, (rd(w, 0xC969) + 1) & 0xFF);
  const tries = rd(w, 0xC969);
  pushTextNumberArg(w, tries);
  pushTextNumberArg(w, made);
  yield* Ls.inBankGen(w, 0x05, T.showMessageAt(sh, inside ? madeText : missText, coach, 0x0A, 0x03));
  if (tries !== 0x0A) { Ls.setGolfEventFlag(w, 0x01); yield* Ls.golfAdvanceFrame(sh); return; }
  if (rd(w, 0xC968) >= 0x07) setFlag(w, 98);
  Ls.setGolfEventFlag(w, 0x82);
  yield* Ls.golfAdvanceFrame(sh);
}
const HOOKS16 = {
  "30:5bf2": sh => Ls.hookShotSetup(sh, 0x03, [0x0CF7, 0x0CF8, 0x0CF9, 0x0CFA], { push: false }),   // 30:5BF2
  "30:5c2c": sh => Ls.hookDemoAfterShot(sh, { push: false }),                     // 30:5C2C
  "30:5c58": sh => Ls.hookShotSetup(sh, 0x03, [0x0CFC, 0x0CFD, 0x0CFE], { push: false, wait: "none" }),   // 30:5C58
  "30:5c80": sh => Ls.hookTryAfterShot(sh, 0x06, within60, { club: 0x68C }),      // 30:5C80 (+$0C of the record)
  "30:5e3c": sh => Ls.hookShotSetup(sh, 0x04, [0x0D06, 0x0D07, 0x0D08, 0x0D09], { push: false }),   // 30:5E3C
  "30:5e76": sh => Ls.hookDemoAfterShot(sh, { push: false }),                     // 30:5E76
  "30:5ea2": sh => Ls.hookShotSetup(sh, 0x04, [0x0D0B, 0x0D0C, 0x0D0D], { push: false, wait: "none" }),   // 30:5EA2
  "30:5eca": sh => Ls.hookTryAfterShot(sh, 0x07, within60),                       // 30:5ECA
  "30:6052": contestShotSetup16,
  "30:605c": sh => contestAfterShot16(sh, 0x06, 0x03, 0x0C85, 0x0C86),
  "30:6243": contestShotSetup16,
  "30:624d": sh => contestAfterShot16(sh, 0x07, 0x04, 0x0C8D, 0x0C8E),
};
const SCRIPTS16 = {
  "30:597c": map16Enter,
  "30:58d5": sh => Ls.chainedTip(sh, 0x0C79, 0x06, false, true),   // 30:58D5 Map16Talk05HillTip (the second answer swapped)
  "30:5a94": sh => testFlag(sh.w, 224) ? contestOffer16(sh, CONTESTS_16.mound) : Ls.lessonTalk(sh, LESSONS_16.mound),
  "30:5b2b": sh => testFlag(sh.w, 225) ? contestOffer16(sh, CONTESTS_16.slope) : Ls.lessonTalk(sh, LESSONS_16.slope),
};
// ---- the putting greens: maps $0E $11 $14 $17 ----
// 30:6E49 PuttingGreenIndex: 0-3 for maps $0E $11 $14 $17 (anything else: the map id itself, a quirk of the fall-through)
function greenIndex(w) {
  const m = rd(w, 0xC450);
  return m === 0x0E ? 0 : m === 0x11 ? 1 : m === 0x14 ? 2 : m === 0x17 ? 3 : m;
}
// 30:6E74 / 30:6E89 / 30:6E9E / 30:6EB3 (PuttingTestClearedFlag, PuttingSetTriedFlag, PuttingTestTriedFlag): the cleared (#194 + green) and tried (#190 + green) flags
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

// 30:6942 PuttingGreenObject0FMeetAzalea (object $0F; actor 8 is on the Palm green): not when the player is Azalea
// (wCharId 2); #142, $0C59 (speaker $80), Azalea at ($3300, $1C00), the player hops $0200 down with the facing locked
// (sound $8A), Azalea steps $0200 down, $0C5D (speaker 8), 30:7EAD HiddenFriendsBonus_30 (the code of 34:7E12)
function* meetAzalea(sh) {
  const w = sh.w;
  if (rd(w, 0xC810) === 0x02) return;
  setFlag(w, 142);
  T.scriptSetText(w, 0x0C59);
  yield* T.scriptShowText(sh, 0x80);
  S.actorSetPos(w, 0x08, 0x3300, 0x1C00);
  S.actorLockSpriteFacing(w, 0x00, 0x01);
  sh.sound(0x8A);
  S.actorJump(w, 0x00, 0xFF80);
  S.actorMoveDir(w, 0x00, 0x80, 0x0200);
  yield* S.waitActorMoveDone(sh, 0x00);
  S.actorLockSpriteFacing(w, 0x00, 0x00);
  S.actorMoveDir(w, 0x08, 0x80, 0x0200);
  yield* S.waitActorMoveDone(sh, 0x08);
  T.scriptSetText(w, 0x0C5D);
  yield* T.scriptShowText(sh, 0x08);
  yield* awardFoundAllRivalsExp(sh);                              // 30:7EAD
}

// ---- the Alternate Game: the Dune green's golfers (map $14 talks 8-$0A), map $2A (the rules) and map $2B (the event) ----
const wait = (sh, n) => S.scriptWaitFrames(sh, n);
const inBankGen = Ls.inBankGen;
function* animWait(sh, b, a) { S.actorPlayAnim(sh.w, b, a); yield* S.waitActorAnimDone(sh, b); }
// a question (speaker s) 10 frames after the player turned to s: true for No
function* altAsk(sh, s) {
  yield* T.scriptShowTextKeepOpen(sh, s);
  S.actorFaceActor(sh.w, 0x00, s);
  yield* wait(sh, 0x0A);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* wait(sh, 0x05);
  return a;
}
// the rules menu (30:6FF8 / 30:711C): "Which rules?" ($1808, speaker 8), 20 frames, the menu $1809 at (1, 1) (0A:42BF;
// B asks again); Stroke (1): #155 and $180B, else $180A; the golfers' animations 5; warp e (first: show the question)
function* altRules(sh, e, first) {
  const w = sh.w;
  let m;
  for (let show = first; ; show = true) {
    if (show) { T.scriptSetText(w, 0x1808); yield* T.scriptShowText(sh, 0x08); }
    yield* wait(sh, 0x14);
    m = yield* S.scriptRunMenu(sh, 0x1809, 0x01, 0x01);
    if (m !== 0xFF) break;
  }
  if (m === 0x01) { setFlag(w, 155); T.scriptSetText(w, 0x180B); }
  else T.scriptSetText(w, 0x180A);
  yield* T.scriptShowText(sh, 0x08);
  yield* animWait(sh, 0x0A, 0x05);
  S.actorSetFacing(w, 0x08, 0xC0);
  S.actorPlayAnim(w, 0x08, 0x05);
  yield* animWait(sh, 0x09, 0x05);
  wr(w, 0xC441, e);
}
// the three golfers face the player, the first's animation 7
function* altGolfersTurn(sh) {
  const w = sh.w;
  S.actorFaceActor(w, 0x08, 0x00);
  yield* animWait(sh, 0x08, 0x07);
  S.actorFaceActor(w, 0x09, 0x00);
  S.actorFaceActor(w, 0x0A, 0x00);
}
// 30:6F42 AltGameInvite: $152C asked (No: 30:7060 the next text, back to their places, his animation 6); the next
// asked (No: 30:7088); the next, a hop (sound $8A), the others' lines ($0A animation 7, 9 animation 5), #155 cleared,
// the rules (30:6FF8), warp 2
function* altGameInvite(sh) {
  const w = sh.w;
  yield* altGolfersTurn(sh);
  T.scriptSetText(w, 0x152C);
  if (yield* altAsk(sh, 0x08)) {
    yield* T.scriptShowText(sh, 0x08);                           // 30:7060
    S.actorSetFacing(w, 0x08, 0xC0); S.actorSetFacing(w, 0x09, 0x00); S.actorSetFacing(w, 0x0A, 0x80);
    yield* animWait(sh, 0x08, 0x06);
    return;
  }
  T.scriptSkipText(w);
  yield* T.scriptShowTextKeepOpen(sh, 0x08);
  yield* wait(sh, 0x0A);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* wait(sh, 0x05);
  if (a) {
    yield* T.scriptShowText(sh, 0x08);                           // 30:7088
    S.actorSetFacing(w, 0x08, 0xC0);
    yield* animWait(sh, 0x08, 0x05);
    S.actorSetFacing(w, 0x09, 0x00); S.actorSetFacing(w, 0x0A, 0x80);
    return;
  }
  T.scriptSkipText(w);
  yield* T.scriptShowText(sh, 0x08);
  sh.sound(0x8A);
  S.actorJump(w, 0x08, 0xFF80);
  yield* S.waitActorLanded(sh, 0x08);
  S.actorsFaceEachOther(w, 0x0A, 0x09);
  yield* animWait(sh, 0x0A, 0x07);
  yield* T.scriptShowText(sh, 0x0A);
  yield* animWait(sh, 0x09, 0x05);
  yield* T.scriptShowText(sh, 0x08);
  clearFlag(w, 155);
  yield* altRules(sh, 0x02, true);
}
// 30:70B0 AltGameInviteAgain: $154B asked: No (30:7184): #249, the next text, back to their places; Yes: a hop (sound
// $8A), the next text, #155 cleared, the rules without "Which rules?" the first time (30:7127), warp 3
function* altGameInviteAgain(sh) {
  const w = sh.w;
  yield* altGolfersTurn(sh);
  T.scriptSetText(w, 0x154B);
  if (yield* altAsk(sh, 0x08)) {
    setFlag(w, 249);
    yield* T.scriptShowText(sh, 0x08);
    S.actorSetFacing(w, 0x08, 0xC0);
    yield* animWait(sh, 0x08, 0x05);
    S.actorSetFacing(w, 0x09, 0x00); S.actorSetFacing(w, 0x0A, 0x80);
    return;
  }
  T.scriptSkipText(w);
  sh.sound(0x8A);
  S.actorJump(w, 0x08, 0xFF80);
  yield* S.waitActorLanded(sh, 0x08);
  yield* T.scriptShowText(sh, 0x08);
  clearFlag(w, 155);
  yield* altRules(sh, 0x03, false);
}
// 30:681A / 683E / 6862 Map14Talk08-0A (the Dune green's golfers 8, 9, $0A): declined before (#249) $154E (30:71AF,
// speaker 8); played (#151) or won (#154): 30:70B0; the Links qualified (#114): 30:6F42; else their own line
function* altGolferTalk(sh, a, id) {
  const w = sh.w;
  if (testFlag(w, 249)) { T.scriptSetText(w, 0x154E); yield* T.scriptShowText(sh, 0x08); return; }
  if (testFlag(w, 151) || testFlag(w, 154)) { yield* altGameInviteAgain(sh); return; }
  if (testFlag(w, 114)) { yield* altGameInvite(sh); return; }
  T.scriptSetText(w, id);
  yield* T.scriptShowText(sh, a);
}
// 02:4A0B GolferProfileCopy: bytes +$00-$13 and +$19-$1F of the record hl to de
function golferProfileCopy(w, hl, de, read) {
  for (let k = 0; k < 0x14; k++) wr(w, de + k, read(hl + k));
  for (let k = 0x19; k < 0x20; k++) wr(w, de + k, read(hl + k));
}
// 02:49BA RefreshGolferProfile: golfer b for player c ($FF / $82 / $81 nothing; $80 the character, unless no save
// slot; else the preset 02:4B1D[b & $F] and its name, text $43 + its character, by 05:40C2; the WRAM bank kept)
function refreshGolferProfile(w, b, c) {
  const de = c & 1 ? 0xC8C0 : 0xC880;
  if (b === 0xFF || b === 0x82 || b === 0x81) return;
  if (b === 0x80) { if (rd(w, 0xC2A5) !== 0x0F) golferProfileCopy(w, 0xC800, de, a => rd(w, a)); return; }
  const hl = rb(0x02, 0x4B1D + 2 * (b & 0x0F)) | rb(0x02, 0x4B1D + 2 * (b & 0x0F) + 1) << 8;
  golferProfileCopy(w, hl, de, a => rb(0x02, a));
  const old = w.high[0x196];
  copyTextShortToDE(w, (0x43 + rd(w, de + 0x10)) & 0xFFFF, de);
  D.setWramBank(w, old);
}
// 30:72A8 AltShotNextGolfer: WRAM6; the team of wCurPlayer swaps its golfer (wAltShotTurns $C873 bit 0 / 1): team 1
// the character ($80) / $0B, team 2 $0C / $0D (02:49BA)
function altShotNextGolfer(w) {
  D.setWramBank(w, 6);
  const t = rd(w, 0xC873);
  if (!rd(w, 0xC835)) {
    if (t & 1) { wr(w, 0xC873, t & 0xFE); refreshGolferProfile(w, 0x80, 0x00); }
    else { wr(w, 0xC873, t | 1); refreshGolferProfile(w, 0x0B, 0x00); }
  } else if (t & 2) { wr(w, 0xC873, t & 0xFD); refreshGolferProfile(w, 0x0C, 0x01); }
  else { wr(w, 0xC873, t | 2); refreshGolferProfile(w, 0x0D, 0x01); }
}
// 30:72F0 AltShotStartRound: fade out (4), GolfSessionInit, game mode 3 with #155 (stroke) else 2 (30:72DF), the
// character and golfer $0C, the return point (map $2B, entrance 6), course 3 hole 1 (the wind byte is the 6 left in
// a), no forced wind direction, the hooks 30:7361, wAltShotTurns 0, the teams $C878 = 1, $C879-$C87C = the character,
// $0B, $0C, $0D; the partner first (#152): player 1's golfer swapped (30:72A8) and $C879 / $C87A swapped; 18 holes
function* altShotStartRound(sh) {
  const w = sh.w;
  Scr.beginFadeOut(w, 0x04);
  yield* Scr.waitFade(sh);
  St.golfSessionInit(w);
  wr(w, 0xC834, testFlag(w, 155) ? 0x03 : 0x02);
  St.setupPlayerGolfer(w, 0x80, 0x00);
  St.setupPlayerGolfer(w, 0x0C, 0x01);
  Ls.saveReturnPoint(w, 0x2B, 0x06);
  St.setCourseHole(w, 0x06, 0x03, 0x01);
  Ls.setForcedWindDir(w, 0x80);
  Ls.setGolfEventHook(w, 0x30, 0x7361);
  wr(w, 0xC873, 0x00);
  wr(w, 0xC878, 0x01); wr(w, 0xC879, rd(w, 0xC810)); wr(w, 0xC87A, 0x0B); wr(w, 0xC87B, 0x0C); wr(w, 0xC87C, 0x0D);
  if (testFlag(w, 152)) {
    D.setWramBank(w, 6);
    wr(w, 0xC835, 0x00);
    altShotNextGolfer(w);
    wr(w, 0xC879, 0x0B); wr(w, 0xC87A, rd(w, 0xC810));
  }
  if (!sh.playGolfRound) notPorted("the Alternate Game's match outside the game loop");
  yield* sh.playGolfRound(0x12);
  yield* inBankGen(w, 0x10, golfSessionEnd(sh));
}
// 30:7212 Map2AEnter: fade out ($7F, not waited for); entrance $0F: ScriptBegin (no ScriptEnd: the round follows),
// $1539, fade in (4), 30 frames, the caddie faces the player; the first time (neither #151 nor #154): #151, his
// animation 5, the rules, animation 7; "Who tees off first?" ($153A): Yes #152 cleared; No: the next part asked: Yes
// #152 (the partner first), No: the first question again; 30:72F0
function* map2AEnter(sh) {
  const w = sh.w;
  Scr.beginFadeOut(w, 0x7F);
  if (rd(w, 0xC46A) !== 0x0F) return;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  T.scriptSetText(w, 0x1539);
  Scr.beginFadeIn(w, 0x04);
  yield* Scr.waitFade(sh);
  yield* wait(sh, 0x1E);
  S.actorFaceActor(w, 0x02, 0x00);
  if (!testFlag(w, 151) && !testFlag(w, 154)) {
    setFlag(w, 151);
    yield* animWait(sh, 0x02, 0x05);
    yield* T.scriptShowText(sh, 0x02);
    yield* animWait(sh, 0x02, 0x07);
  }
  for (;;) {
    T.scriptSetText(w, 0x153A);
    yield* T.scriptShowTextKeepOpen(sh, 0x02);
    let a = yield* T.scriptAskYesNo(sh);
    yield* T.scriptCloseText(sh);
    yield* wait(sh, 0x05);
    if (!a) { clearFlag(w, 152); break; }
    yield* T.scriptShowTextKeepOpen(sh, 0x02);
    a = yield* T.scriptAskYesNo(sh);
    yield* T.scriptCloseText(sh);
    yield* wait(sh, 0x05);
    if (!a) { setFlag(w, 152); break; }
  }
  yield* altShotStartRound(sh);
}
// 30:7381 AltShotHoleStartGolfers (hook 3, a hole's start): WRAM6; each team's golfer due by wAltShotTurns $C873 (bit
// 0: $0B, else the character; bit 1: $0D, else $0C) set again (30:73AF -> 02:49BA)
function altShotHoleStartGolfers(w) {
  D.setWramBank(w, 6);
  const t = rd(w, 0xC873);
  refreshGolferProfile(w, t & 1 ? 0x0B : 0x80, 0x00);
  refreshGolferProfile(w, rd(w, 0xC873) & 2 ? 0x0D : 0x0C, 0x01);
}
// 30:73B5 AltShotShotSetup (hook 0): the current player's HUD line (12:4B8A / 12:4C18), a frame
function* altShotShotSetup(sh) {
  Rh.hud(sh.w, rd(sh.w, 0xC835) ? "hudDrawPlayer2" : "hudDrawPlayer1");
  yield* sh.advance();
}
// 30:74FE Map2BIntroScene (entrance 1): ScriptBegin; $1533 on, fade in (4); the caddie and the four golfers talk
// (after the Dune Club is won, #138, one line is skipped the other way round: 30:76EE); they file out (speed $10;
// the cheering script 30:7D7B), 90 frames, warp $0F (map $2A, the rules); ScriptEnd
function* map2BIntro(sh) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));                     // 30:74FE
  T.scriptSetText(w, 0x1533);                                     // 30:7504
  Scr.beginFadeIn(w, 0x04);                                       // 30:7509
  yield* Scr.waitFade(sh);                                        // 30:750C
  S.actorPlayAnim(w, 0x05, 0x06);                                 // 30:7514
  yield* S.waitActorAnimDone(sh, 0x05);                           // 30:7519
  yield* T.scriptShowText(sh, 0x05);                              // 30:751E
  S.actorsFaceEachOther(w, 0x00, 0x02);                           // 30:7526
  yield* S.scriptWaitFrames(sh, 0x1E);                            // 30:752C
  S.actorPlayAnim(w, 0x05, 0x07);                                 // 30:7535
  yield* S.waitActorAnimDone(sh, 0x05);                           // 30:753A
  yield* S.scriptWaitFrames(sh, 0x1E);                            // 30:7540
  S.actorPlayAnim(w, 0x05, 0x05);                                 // 30:7549
  yield* S.waitActorAnimDone(sh, 0x05);                           // 30:754E
  if (testFlag(w, 138)) { T.scriptSkipText(w); yield* T.scriptShowText(sh, 0x05); }   // 30:76EE
  else { yield* T.scriptShowText(sh, 0x05); T.scriptSkipText(w); }                    // 30:7559
  S.actorSetFacing(w, 0x00, 0xC0);                                // 30:7563
  S.actorSetFacing(w, 0x02, 0xC0);                                // 30:756A
  yield* S.scriptWaitFrames(sh, 0x1E);                            // 30:7570
  S.actorPlayAnim(w, 0x05, 0x05);                                 // 30:7579
  yield* S.waitActorAnimDone(sh, 0x05);                           // 30:757E
  yield* T.scriptShowText(sh, 0x05);                              // 30:7583
  S.actorsFaceEachOther(w, 0x03, 0x04);                           // 30:758B
  yield* S.scriptWaitFrames(sh, 0x1E);                            // 30:7591
  S.actorPlayAnim(w, 0x04, 0x05);                                 // 30:759A
  S.actorPlayAnim(w, 0x03, 0x05);                                 // 30:75A2
  yield* S.waitActorAnimDone(sh, 0x03);                           // 30:75A7
  S.actorSetFacing(w, 0x04, 0xC0);                                // 30:75AE
  S.actorSetFacing(w, 0x03, 0xC0);                                // 30:75B5
  S.actorPlayAnim(w, 0x04, 0x05);                                 // 30:75BD
  S.actorPlayAnim(w, 0x00, 0x05);                                 // 30:75C5
  S.actorPlayAnim(w, 0x02, 0x05);                                 // 30:75CD
  S.actorPlayAnim(w, 0x03, 0x05);                                 // 30:75D5
  yield* S.waitActorAnimDone(sh, 0x03);                           // 30:75DA
  S.actorSetSpeed(w, 0x00, 0x0010);                               // 30:75E2
  S.actorSetSpeed(w, 0x02, 0x0010);                               // 30:75EA
  S.actorSetSpeed(w, 0x03, 0x0010);                               // 30:75F2
  S.actorSetSpeed(w, 0x04, 0x0010);                               // 30:75FA
  yield* S.scriptWaitFrames(sh, 0x01);                            // 30:7600
  yield* S.scriptActorGoTo(sh, 0x00, 0x1D80, 0x0D80);             // 30:760B
  S.actorMoveTo(w, 0x00, 0x1D80, 0x0D80);                         // 30:7616
  S.actorMoveDir(w, 0x02, 0x00, 0x0200);                          // 30:7620
  yield* S.waitActorMoveDone(sh, 0x02);                           // 30:7625
  S.actorMoveTo(w, 0x02, 0x1B00, 0x0D80);                         // 30:7630
  S.actorMoveDir(w, 0x04, 0xC0, 0x0200);                          // 30:763A
  yield* S.scriptWaitFrames(sh, 0x05);                            // 30:7640
  S.actorMoveDir(w, 0x03, 0xC0, 0x0200);                          // 30:764B
  yield* S.waitActorMoveDone(sh, 0x03);                           // 30:7650
  S.actorMoveTo(w, 0x03, 0x1900, 0x0D80);                         // 30:765B
  S.actorMoveTo(w, 0x04, 0x1700, 0x0D80);                         // 30:7666
  yield* S.waitActorMoveDone(sh, 0x04);                           // 30:766B
  yield* S.waitScriptActorIdle(sh);                               // 30:766E
  yield* T.scriptShowText(sh, 0x02);                              // 30:7673
  S.actorFaceActor(w, 0x00, 0x02);                                // 30:767B
  S.actorPlayAnim(w, 0x02, 0x05);                                 // 30:7683
  yield* S.waitActorAnimDone(sh, 0x02);                           // 30:7688
  yield* T.scriptShowText(sh, 0x02);                              // 30:768D
  S.actorPlayAnim(w, 0x00, 0x07);                                 // 30:7695
  yield* S.waitActorAnimDone(sh, 0x00);                           // 30:769A
  S.actorSetScript(w, 0x02, 0x7D7B, 0x30);                        // 30:76A5
  yield* S.scriptWaitFrames(sh, 0x15);                            // 30:76AB
  S.actorSetScript(w, 0x03, 0x7D7B, 0x30);                        // 30:76B7
  yield* S.scriptWaitFrames(sh, 0x01);                            // 30:76BD
  S.actorSetScript(w, 0x04, 0x7D7B, 0x30);                        // 30:76C9
  yield* S.scriptWaitFrames(sh, 0x64);                            // 30:76CF
  S.actorSetScript(w, 0x00, 0x7D7B, 0x30);                        // 30:76DB
  yield* S.scriptWaitFrames(sh, 0x5A);                            // 30:76E1
  wr(w, 0xC441, 0x0F);                                            // 30:76E7
  D.inBank(w, 0x0A, () => S.scriptEnd(w));                       // 30:76EA
}
// 30:7713 (the match result's scene after its text: 30:7705 a tie $1541, 30:770D lost $153C; entrances $0C / $0D
// show them directly): the teams walk in (30:7D02), fade in (4), the partner's lines, the rivals' answers, both walk
// off to the left and are put away, the player and the caddie, warp 1
function* map2BResultScene(sh, id) {
  const w = sh.w;
  T.scriptSetText(w, id);
  map2BTeamsWalkIn(w);                                            // 30:7713
  Scr.beginFadeIn(w, 0x04);                                       // 30:7718
  yield* Scr.waitFade(sh);                                        // 30:771B
  yield* S.waitActorMoveDone(sh, 0x00);                           // 30:7720
  S.actorPlayAnim(w, 0x02, 0x07);                                 // 30:7728
  yield* S.waitActorAnimDone(sh, 0x02);                           // 30:772D
  S.actorFaceActor(w, 0x02, 0x03);                                // 30:7735
  S.actorPlayAnim(w, 0x02, 0x07);                                 // 30:773D
  yield* S.waitActorAnimDone(sh, 0x02);                           // 30:7742
  yield* T.scriptShowText(sh, 0x02);                              // 30:7747
  S.actorFaceActor(w, 0x00, 0x02);                                // 30:774F
  S.actorPlayAnim(w, 0x00, 0x07);                                 // 30:7757
  yield* S.waitActorAnimDone(sh, 0x00);                           // 30:775C
  S.actorFaceActor(w, 0x02, 0x00);                                // 30:7764
  yield* T.scriptShowText(sh, 0x02);                              // 30:7769
  S.actorPlayAnim(w, 0x02, 0x05);                                 // 30:7771
  yield* S.waitActorAnimDone(sh, 0x02);                           // 30:7776
  yield* T.scriptShowText(sh, 0x02);                              // 30:777B
  S.actorsFaceEachOther(w, 0x03, 0x04);                           // 30:7783
  yield* S.scriptWaitFrames(sh, 0x28);                            // 30:7789
  S.actorFaceActor(w, 0x03, 0x00);                                // 30:7792
  S.actorFaceActor(w, 0x04, 0x00);                                // 30:779A
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 30:77A0
  S.actorPlayAnim(w, 0x03, 0x05);                                 // 30:77A9
  S.actorPlayAnim(w, 0x04, 0x05);                                 // 30:77B1
  yield* S.waitActorAnimDone(sh, 0x04);                           // 30:77B6
  S.actorMoveDir(w, 0x02, 0x40, 0x0200);                          // 30:77C0
  S.actorMoveDir(w, 0x03, 0x00, 0x0200);                          // 30:77CA
  S.actorMoveDir(w, 0x04, 0x00, 0x0200);                          // 30:77D4
  yield* S.waitActorMoveDone(sh, 0x02);                           // 30:77D9
  S.actorMoveDir(w, 0x02, 0x00, 0x0200);                          // 30:77E3
  S.actorMoveDir(w, 0x03, 0x40, 0x0200);                          // 30:77ED
  S.actorMoveDir(w, 0x04, 0x00, 0x0200);                          // 30:77F7
  yield* S.waitActorMoveDone(sh, 0x04);                           // 30:77FC
  yield* S.waitActorMoveDone(sh, 0x02);                           // 30:7801
  S.actorFaceActor(w, 0x02, 0x00);                                // 30:7809
  S.actorFaceActor(w, 0x03, 0x00);                                // 30:7811
  yield* T.scriptShowText(sh, 0x02);                              // 30:7816
  S.actorPlayAnim(w, 0x02, 0x05);                                 // 30:781E
  S.actorPlayAnim(w, 0x03, 0x05);                                 // 30:7826
  yield* S.waitActorAnimDone(sh, 0x03);                           // 30:782B
  S.actorFaceActor(w, 0x02, 0x04);                                // 30:7833
  yield* T.scriptShowText(sh, 0x02);                              // 30:7838
  S.actorFaceActor(w, 0x04, 0x02);                                // 30:7840
  S.actorPlayAnim(w, 0x04, 0x05);                                 // 30:7848
  yield* S.waitActorAnimDone(sh, 0x04);                           // 30:784D
  S.actorMoveTo(w, 0x02, 0x0700, 0x1400);                         // 30:7858
  S.actorMoveTo(w, 0x03, 0x0500, 0x1400);                         // 30:7863
  S.actorMoveTo(w, 0x04, 0x0500, 0x1400);                         // 30:786E
  S.actorFaceActor(w, 0x00, 0x02);                                // 30:7876
  yield* S.scriptWaitFrames(sh, 0x32);                            // 30:787C
  S.actorFaceActor(w, 0x00, 0x05);                                // 30:7885
  yield* S.waitActorMoveDone(sh, 0x02);                           // 30:788A
  S.actorSetPos(w, 0x02, 0x3F00, 0x3F00);                         // 30:7895
  S.actorSetPos(w, 0x03, 0x3F00, 0x3F00);                         // 30:78A0
  yield* S.waitActorMoveDone(sh, 0x04);                           // 30:78A5
  S.actorFaceActor(w, 0x00, 0x05);                                // 30:78AD
  S.actorSetPos(w, 0x04, 0x3F00, 0x3F00);                         // 30:78B8
  yield* S.scriptWaitFrames(sh, 0x14);                            // 30:78BE
  S.actorPlayAnim(w, 0x00, 0x07);                                 // 30:78C7
  yield* S.waitActorAnimDone(sh, 0x00);                           // 30:78CC
  yield* S.scriptWaitFrames(sh, 0x14);                            // 30:78D2
  S.actorPlayAnim(w, 0x05, 0x05);                                 // 30:78DB
  yield* S.waitActorAnimDone(sh, 0x05);                           // 30:78E0
  yield* S.scriptWaitFrames(sh, 0x14);                            // 30:78E6
  S.actorPlayAnim(w, 0x00, 0x05);                                 // 30:78EF
  yield* S.waitActorAnimDone(sh, 0x00);                           // 30:78F4
  S.actorMoveTo(w, 0x00, 0x0700, 0x1300);                         // 30:78FF
  yield* S.scriptWaitFrames(sh, 0x5A);                            // 30:7905
  wr(w, 0xC441, 0x01);                                            // 30:790B
}
// 30:7A97 (the rest of 30:7A67, also 30:790F's way once won before): speeds 8, the rivals' "We'll practice" ($154A,
// speaker 3), they leave, the player's and the caddie's animations, warp 1
function* map2BRivalsRest(sh) {
  const w = sh.w;
  S.actorSetSpeed(w, 0x00, 0x0008);                               // 30:7A9C
  S.actorSetSpeed(w, 0x02, 0x0008);                               // 30:7AA4
  S.actorSetSpeed(w, 0x03, 0x0008);                               // 30:7AAC
  S.actorSetSpeed(w, 0x04, 0x0008);                               // 30:7AB4
  T.scriptSetText(w, 0x154A);                                     // 30:7ABA
  S.actorFaceActor(w, 0x02, 0x04);                                // 30:7AC2
  yield* T.scriptShowText(sh, 0x03);                              // 30:7AC7
  S.actorPlayAnim(w, 0x04, 0x05);                                 // 30:7ACF
  yield* S.waitActorAnimDone(sh, 0x04);                           // 30:7AD4
  S.actorMoveTo(w, 0x02, 0x0700, 0x1400);                         // 30:7ADF
  S.actorMoveTo(w, 0x03, 0x0500, 0x1400);                         // 30:7AEA
  S.actorMoveTo(w, 0x04, 0x0500, 0x1400);                         // 30:7AF5
  S.actorFaceActor(w, 0x00, 0x02);                                // 30:7AFD
  yield* S.scriptWaitFrames(sh, 0x32);                            // 30:7B03
  S.actorFaceActor(w, 0x00, 0x05);                                // 30:7B0C
  yield* S.waitActorMoveDone(sh, 0x02);                           // 30:7B11
  S.actorSetPos(w, 0x02, 0x3F00, 0x3F00);                         // 30:7B1C
  S.actorSetPos(w, 0x03, 0x3F00, 0x3F00);                         // 30:7B27
  yield* S.waitActorMoveDone(sh, 0x04);                           // 30:7B2C
  S.actorFaceActor(w, 0x00, 0x05);                                // 30:7B34
  S.actorSetPos(w, 0x04, 0x3F00, 0x3F00);                         // 30:7B3F
  S.actorPlayAnim(w, 0x00, 0x07);                                 // 30:7B47
  yield* S.waitActorAnimDone(sh, 0x00);                           // 30:7B4C
  yield* S.scriptWaitFrames(sh, 0x14);                            // 30:7B52
  S.actorPlayAnim(w, 0x05, 0x05);                                 // 30:7B5B
  yield* S.waitActorAnimDone(sh, 0x05);                           // 30:7B60
  yield* S.scriptWaitFrames(sh, 0x14);                            // 30:7B66
  S.actorPlayAnim(w, 0x00, 0x05);                                 // 30:7B6F
  yield* S.waitActorAnimDone(sh, 0x00);                           // 30:7B74
  S.actorMoveTo(w, 0x00, 0x0700, 0x1300);                         // 30:7B7F
  yield* S.scriptWaitFrames(sh, 0x5A);                            // 30:7B85
  wr(w, 0xC441, 0x01);                                            // 30:7B8B
}
// 30:7A67 Map2BRivalsLeave (entrance $0A, after the first win): the rivals placed, fade in (4), 30:7A97
function* map2BRivalsLeave(sh) {
  const w = sh.w;
  S.actorSetPos(w, 0x02, 0x0900, 0x0F00);                         // 30:7A6F
  S.actorSetPos(w, 0x03, 0x0700, 0x0F00);                         // 30:7A7A
  S.actorSetPos(w, 0x04, 0x0700, 0x0D00);                         // 30:7A85
  S.actorSetFacing(w, 0x04, 0x40);                                // 30:7A8C
  Scr.beginFadeIn(w, 0x04);                                       // 30:7A91
  yield* Scr.waitFade(sh);                                        // 30:7A94
  yield* map2BRivalsRest(sh);
}
// 30:790F Map2BMatchWon (a result of 1, or entrance $0B): the teams walk in, fade in (4), "We won!" ($1546) with two hops
// (sound $8A), the lines, the rivals' answer ($1549); won before (#154): 30:7A97; else #154, 200 EXP (sound $38,
// WaitJingleEnd, 30:7E73 the level-up screen), the return point (map 0, $FA), SaveGame, warp $0E
function* map2BMatchWon(sh) {
  const w = sh.w;
  map2BTeamsWalkIn(w);                                            // 30:790F
  Scr.beginFadeIn(w, 0x04);                                       // 30:7914
  yield* Scr.waitFade(sh);                                        // 30:7917
  yield* S.waitActorMoveDone(sh, 0x00);                           // 30:791C
  T.scriptSetText(w, 0x1546);                                     // 30:7922
  sh.sound(0x8A);                                                 // 30:7925
  S.actorJump(w, 0x02, 0xFF80);                                   // 30:792C
  yield* S.waitActorLanded(sh, 0x02);                             // 30:7931
  sh.sound(0x8A);                                                 // 30:7934
  S.actorJump(w, 0x02, 0xFF40);                                   // 30:793B
  yield* S.waitActorLanded(sh, 0x02);                             // 30:7940
  yield* S.scriptWaitFrames(sh, 0x1E);                            // 30:7946
  yield* T.scriptShowText(sh, 0x02);                              // 30:794C
  S.actorFaceActor(w, 0x00, 0x02);                                // 30:7954
  S.actorPlayAnim(w, 0x00, 0x07);                                 // 30:795C
  yield* S.waitActorAnimDone(sh, 0x00);                           // 30:7961
  yield* T.scriptShowText(sh, 0x02);                              // 30:7966
  S.actorPlayAnim(w, 0x02, 0x05);                                 // 30:796E
  yield* S.waitActorAnimDone(sh, 0x02);                           // 30:7973
  yield* T.scriptShowText(sh, 0x02);                              // 30:7978
  T.scriptSetText(w, 0x1549);                                     // 30:797E
  S.actorsFaceEachOther(w, 0x03, 0x04);                           // 30:7986
  yield* S.scriptWaitFrames(sh, 0x28);                            // 30:798C
  S.actorFaceActor(w, 0x03, 0x00);                                // 30:7995
  S.actorFaceActor(w, 0x04, 0x00);                                // 30:799D
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 30:79A3
  S.actorPlayAnim(w, 0x03, 0x05);                                 // 30:79AC
  S.actorPlayAnim(w, 0x04, 0x05);                                 // 30:79B4
  yield* S.waitActorAnimDone(sh, 0x04);                           // 30:79B9
  S.actorMoveDir(w, 0x02, 0x40, 0x0200);                          // 30:79C3
  S.actorMoveDir(w, 0x03, 0x00, 0x0200);                          // 30:79CD
  S.actorMoveDir(w, 0x04, 0x00, 0x0200);                          // 30:79D7
  yield* S.waitActorMoveDone(sh, 0x02);                           // 30:79DC
  S.actorMoveDir(w, 0x02, 0x00, 0x0200);                          // 30:79E6
  S.actorMoveDir(w, 0x03, 0x40, 0x0200);                          // 30:79F0
  S.actorMoveDir(w, 0x04, 0x00, 0x0200);                          // 30:79FA
  yield* S.waitActorMoveDone(sh, 0x04);                           // 30:79FF
  yield* S.waitActorMoveDone(sh, 0x02);                           // 30:7A04
  S.actorFaceActor(w, 0x02, 0x00);                                // 30:7A0C
  S.actorFaceActor(w, 0x03, 0x00);                                // 30:7A14
  yield* T.scriptShowText(sh, 0x04);                              // 30:7A19
  S.actorPlayAnim(w, 0x02, 0x05);                                 // 30:7A21
  S.actorPlayAnim(w, 0x03, 0x05);                                 // 30:7A29
  yield* S.waitActorAnimDone(sh, 0x03);                           // 30:7A2E
  if (testFlag(w, 154)) { yield* map2BRivalsRest(sh); return; }   // 30:7A34
  setFlag(w, 154);
  yield* Ls.awardExpPlain(sh, 0x00C8);                            // 30:7A39-7A54
  Ls.saveReturnPoint(w, 0x00, 0xFA);                              // 0A:4D5B
  saveGame(w);                                                    // 02:4489
  wr(w, 0xC441, 0x0E);
}
// 30:7D02 Map2BTeamsWalkIn: the player and actors 2-4 on row $0D (x 7, 5, 3, 1), speed $0A, two tiles right
function map2BTeamsWalkIn(w) {
  const xs = [[0x00, 0x0700], [0x02, 0x0500], [0x03, 0x0300], [0x04, 0x0100]];
  for (const [a, x] of xs) S.actorSetPos(w, a, x, 0x0D00);
  for (const [a] of xs) S.actorSetSpeed(w, a, 0x000A);
  for (const [a, x] of xs) S.actorMoveTo(w, a, x + 0x0200, 0x0D00);
}
// 30:74E5 Map2BPatchTiles: MapBufCopyRectRedraw (1, $1A) -> (1, 6), $3A x 4, and BG palettes 2-7 from 30:74B5
// (master copy only)
function* map2BPatchTiles(sh) {
  const w = sh.w;
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x01, 0x1A, 0x01, 0x06, 0x3A, 0x04));
  D.inBank(w, 0x30, () => D.loadPalettesMasterOnly(w, 0x74B5, 0x02, 0x06));
}
// 30:7C61 Map2BLoadSpriteGfx: VRAM bank 0, the tiles 30:7B90 to $8500 ($18 blocks), OBJ palette 7 from 30:7C59
function map2BLoadSpriteGfx(w) {
  if (w.vram) w.lcd.vbk = 0;
  D.inBank(w, 0x30, () => { D.queueVRAMCopy(w, 0x7B90, 0x8500, 0x18); D.loadPalettesImmediate(w, 0x7C59, 0x0F, 0x01); });
}
// 30:7C79 Map2BDrawSpriteFrames: six frames of the template 30:7C50 at ($0800, $0700) less the scroll, tile + c,
// attributes | b
function* map2BDrawSpriteFrames(sh, b, c) {
  const w = sh.w;
  for (let n = 6; n; n--) {
    const x = (0x0800 - (rd(w, 0xC320) | rd(w, 0xC321) << 8)) & 0xFFFF, y = (0x0700 - (rd(w, 0xC322) | rd(w, 0xC323) << 8)) & 0xFFFF;
    D.inBank(w, 0x30, () => D.queueSpriteTemplate(w, 0x7C50, ((y << 3) >> 8) & 0xFF, ((x << 3) >> 8) & 0xFF, c, b));
    yield* sh.advance();
  }
}
// 30:7453 / 745A Map2BTalk05 (the flag on the wall, by the facing): 30:7C61, then 30:7CAE ($C3E0 = 0, $C3E1 = $C3E2 =
// 5; five times $50 $54 $58 $54) or 30:7CE3 (eight times $54 $58)
function* map2BTalk05(sh, five) {
  const w = sh.w;
  map2BLoadSpriteGfx(w);
  wr(w, 0xC3E0, 0x00);
  if (five) {
    wr(w, 0xC3E1, 0x05); wr(w, 0xC3E2, 0x05);
    while (rd(w, 0xC3E0) !== 0x05) {
      wr(w, 0xC3E0, rd(w, 0xC3E0) + 1);
      for (const c of [0x50, 0x54, 0x58, 0x54]) yield* map2BDrawSpriteFrames(sh, 0x07, c);
    }
  } else {
    while (rd(w, 0xC3E0) !== 0x08) {
      wr(w, 0xC3E0, rd(w, 0xC3E0) + 1);
      for (const c of [0x54, 0x58]) yield* map2BDrawSpriteFrames(sh, 0x07, c);
    }
  }
}
// 30:747D Map2BEnter: 30:74E5, then by the entrance: 1 30:74FE; 6 the result (30:76F9: 1 won 30:790F, 2 lost
// 30:770D, else a tie 30:7705); $0A 30:7A67; $0B 30:790F; $0C 30:7705; $0D 30:770D
function* map2BEnter(sh) {
  const w = sh.w;
  yield* map2BPatchTiles(sh);
  let e = rd(w, 0xC46A);
  if (e === 0x06) { const r = rd(w, 0xC96C); e = r === 0x01 ? 0x0B : r === 0x02 ? 0x0D : 0x0C; }
  if (e === 0x01) yield* map2BIntro(sh);
  else if (e === 0x0A) yield* map2BRivalsLeave(sh);
  else if (e === 0x0B) yield* map2BMatchWon(sh);
  else if (e === 0x0C) yield* map2BResultScene(sh, 0x1541);
  else if (e === 0x0D) yield* map2BResultScene(sh, 0x153C);
}
export const HOOKS = {
  "30:73b5": altShotShotSetup,
  "30:73c7": function* (sh) { altShotNextGolfer(sh.w); },   // 30:73C7 AltShotAfterShot
  "30:7381": function* (sh) { altShotHoleStartGolfers(sh.w); },   // 30:7381 (hook 3)
  ...HOOKS16,
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
  ...SCRIPTS16,
  "30:69b9": puttingGreenEnter,
  "30:6635": sh => Ls.tipTalk(sh, 0x10B1, 0x02),  // 30:6635 PuttingGreenTalk02PuttingTip
  "30:6666": map0ETalkChallenge,
  "30:668b": sh => otherGreenTalkChallenge(sh, 195),   // 30:668B Map11Talk06PuttingChallenge
  "30:66b3": sh => otherGreenTalkChallenge(sh, 196),   // 30:66B3 Map14Talk06PuttingChallenge
  "30:66da": sh => otherGreenTalkChallenge(sh, 197),   // 30:66DA Map17Talk06PuttingChallenge
  "30:6a8c": map0ETalk09PuttDemo,
  "30:6ae0": function* (sh) { T.scriptSetText(sh.w, 0x10B8); yield* T.scriptShowText(sh, 0x09); },   // 30:6AE0
  "30:6aec": sh => Ls.triggerPractice(sh, puttingGreenStartPractice),   // 30:6AEC PuttingGreenTriggerPractice
  "30:6942": meetAzalea,
  "30:681a": sh => altGolferTalk(sh, 0x08, 0x1529),   // 30:681A Map14Talk08AltGameGolfer1
  "30:683e": sh => altGolferTalk(sh, 0x09, 0x152A),   // 30:683E Map14Talk09AltGameGolfer2
  "30:6862": sh => altGolferTalk(sh, 0x0A, 0x152B),   // 30:6862 Map14Talk0AAltGameGolfer3
  "30:7212": map2AEnter,
  "30:747d": map2BEnter,
  "30:7453": sh => map2BTalk05(sh, true),     // 30:7453 Map2BTalk05SpriteAnimA
  "30:745a": sh => map2BTalk05(sh, false),    // 30:745A Map2BTalk05SpriteAnimB
  "30:7473": function* () {},                 // 30:7473 Map2BTriggerNop
  "30:429a": map0DEnter,
  "30:40ee": sh => Ls.tipTalk(sh, 0x0C63, 0x02, false),   // 30:40EE Map0DTalk02ApproachTip
  "30:4119": sh => Ls.lessonTalk(sh, LESSONS.running),
  "30:41a2": sh => Ls.lessonTalk(sh, LESSONS.chip),
  "30:422b": sh => Ls.tipTalk(sh, 0x0C66, 0x06, false),   // 30:422B Map0DTalk05PitchAndPuttTip
  "30:4b62": map10Enter,
  "30:49d0": sh => Ls.tipTalk(sh, 0x0C6A, 0x02, false),   // 30:49D0 Map10Talk02ApproachClubTip
  "30:49fb": sh => Ls.tipTalk(sh, 0x0C6D, 0x06, false),   // 30:49FB Map10Talk05SpinTip (speaker 6)
  // (w.keepPracticingPatch: a test's patch of this talk's word, 30:499B, to 30:4888)
  "30:4a26": sh => (sh.w.keepPracticingPatch ? approachRangeKeepPracticing(sh) : Ls.lessonTalk(sh, LESSONS_10.bunker)),
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
