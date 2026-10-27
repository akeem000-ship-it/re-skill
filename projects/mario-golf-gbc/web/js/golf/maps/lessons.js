// The lessons and practices of the clubs' ranges (banks 30 and 31: the driving ranges $0C $0F $12 $15, the approach
// ranges $0D $10 $13 $16): each coach's lesson is a demo round (the coach's replayed strokes) and the player's try
// (a round with a forced shot), each one hole with a table of golf event hooks (golfhooks.js); the range's practice
// repeats a shot until Quit Practice. The scripts of each map are the same code with its own constants; they are
// written here once, with each lesson's constants (and the few places where the copies differ) in a descriptor:
//   bank, map, coach (actor), flag (#101 / #102: tried), seen (the lesson's first success: #160-#167 ...), ask, retry,
//   after, no (texts), talkScript / walkBack / walkFacing (the coach's actor scripts), afterFade (the after-demo fade
//   speed), music (the try's round music until the first success: 8, $0A on the Palm ranges), resultWalk ([script,
//   facing] of the result's walk-back when not walkBack / walkFacing: quirks of 31:57EA, 30:4D57, 30:4F88),
//   resultNoEnd (no ScriptEnd after the result: quirk of 30:4F23), demo { entrance, mode, strokes, golfer, hole, tee,
//   wind, pre (more round set-up after the wind: the coach's golfer record $C89A-$C89D), hooks, offTee (true: after
//   GolfSessionInit, "afterTee": after SetForcedTee, 31:5E2F) }, try { entrance, mode, hole, tee, shot [e, bc], wind,
//   pre (after the wind: 31:616C's second forced shot), hooks, offTee }.
import * as D from "../render/display.js";
import * as Scr from "../screen.js";
import * as S from "../script.js";
import * as T from "../msgbox.js";
import * as St from "../start.js";
import { golfSessionEnd } from "../boot.js";
import { golfViewExit } from "../round.js";
import { lieTerrain } from "../shot.js";
import { pinDist } from "../cup.js";
import { ball } from "../memory.js";
import { addExp } from "../exp.js";
import { levelUpScreen } from "../levelup.js";
import { pushTextNumberArg } from "../text.js";

const rd = D.rd, wr = D.wr;
function notPorted(what) { throw new Error(`${what} is not ported`); }
export const testFlag = (w, n) => w.wram[0][0x840 + (n >> 3)] & (0x80 >> (n & 7));
export const setFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] |= 0x80 >> (n & 7); };
export const clearFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] &= ~(0x80 >> (n & 7)); };
export function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}

// ---- bank 10's round set-up exports (WRAM6 $D4DE-$D4EE; left mapped) ----
// 10:4BC7 SetGolfEventHook (a = the bank, hl = the table)
export const setGolfEventHook = (w, bank, hl) => { w.wram[0][0x870] = bank; w.wram[0][0x871] = hl & 0xFF; w.wram[0][0x872] = hl >> 8; };
// 10:4C04 SetForcedTee
export function setForcedTee(w, hl, de) { D.setWramBank(w, 6); const r6 = w.wram[6]; r6[0x4DE] = 1; r6[0x4DF] = hl & 0xFF; r6[0x4E0] = hl >> 8; r6[0x4E1] = de & 0xFF; r6[0x4E2] = de >> 8; }
// 10:4C26 SetForcedWind
export function setForcedWind(w, de) { D.setWramBank(w, 6); const r6 = w.wram[6]; r6[0x4E4] = 1; r6[0x4E5] = de & 0xFF; r6[0x4E6] = de >> 8; }
// 10:4BE5 SetForcedWindDir (a >= $80: off)
export function setForcedWindDir(w, a) { D.setWramBank(w, 6); const r6 = w.wram[6]; if (a & 0x80) r6[0x4ED] = 0; else { r6[0x4ED] = 1; r6[0x4EE] = a; } }
// 10:4C36 SetForcedShot: the club e, the aim bc
export function setForcedShot(w, e, bc) { D.setWramBank(w, 6); const r6 = w.wram[6]; r6[0x4E7] = 1; r6[0x4E8] = e; r6[0x4E9] = bc & 0xFF; r6[0x4EA] = bc >> 8; r6[0x4EB] = 0; r6[0x4EC] = 0; }
// 10:4C1A SetP1OffTee
export function setP1OffTee(w) { D.setWramBank(w, 6); w.wram[6][0x4E3] = 1; }
// 10:4CAD SetGolfEventFlag
export const setGolfEventFlag = (w, a) => { D.setWramBank(w, 6); w.wram[6][0x4DD] = a; };
// 10:4CB9 GolfAdvanceFrame
export function* golfAdvanceFrame(sh) { D.setWramBank(sh.w, 6); yield* sh.advance(); }
// 0A:4D5B MapSaveReturnPoint with b = the map, c = the entrance
export const saveReturnPoint = (w, b, c) => { wr(w, 0xC960, b); wr(w, 0xC961, c); };
// the round of a lesson or a practice: GolfRound 10:4451 for one hole, GolfSessionEnd 10:4B94
export function* lessonRound(sh) {
  if (!sh.playGolfRound) notPorted("a lesson's round outside the game loop");
  yield* sh.playGolfRound(0x01);
  yield* inBankGen(sh.w, 0x10, golfSessionEnd(sh));
}

// 30:7E2E BallWithinPinDist / 31:7D53: 0 when PinDist 10:62AD <= hl, else 1
export const ballWithinPinDist = (w, hl) => (((hl - pinDist(ball(w))) & 0xFFFF) & 0x8000 ? 1 : 0);
// 10:648B BallLieTerrain
export const ballLie = sh => lieTerrain(sh.hole, ball(sh.w));

// 30:7E7F AwardExpWithBonus / 31:7DA4: de EXP, a quarter more with flag #99 (holed out), AddExp 02:5465, the number
// for text $011B (speaker $80, sound $38), WaitJingleEnd 00:2C1F, the level-up screen (30:7E73: fade out, 41:402A)
export function* awardExpWithBonus(sh, de) {
  const w = sh.w;
  if (testFlag(w, 99)) de = (de + (((de << 16 >> 16) >> 2) & 0xFFFF)) & 0xFFFF;   // (sra h / rr l twice)
  yield* awardExpPlain(sh, de);
}
// the same without the bonus (30:6F00 in AwardPuttingChallengeExp): AddExp, $011B (sound $38), WaitJingleEnd, the
// level-up screen after a fade out (8)
export function* awardExpPlain(sh, de) {
  const w = sh.w;
  addExp(w, de);
  pushTextNumberArg(w, de);
  sh.sound(0x38);
  T.scriptSetText(w, 0x011B);
  yield* T.scriptShowText(sh, 0x80);
  yield* Scr.waitJingleEnd(sh);
  Scr.beginFadeOut(w, 0x08);
  yield* Scr.waitFade(sh);
  yield* inBankGen(w, 0x41, levelUpScreen(sh));
}

// a coach's talk (31:4A8B, 30:4119 ...): tried before (the flag): the retry text, then the question again; else the
// offer (speaker = the coach): No the next text; Yes the one after and the coach's demo: GolfSessionInit, (SetP1OffTee),
// the return point (this map, the demo's entrance), the game mode, the demo strokes (64 bytes to $C600) for the coach's
// golfer (bit 6: replayed), player 2 none, course 7 and the hole, the wind direction 0, the tee, the wind, the hooks,
// one hole
export function* lessonTalk(sh, L) {
  const w = sh.w;
  if (testFlag(w, L.flag)) { T.scriptSetText(w, L.retry); yield* lessonAskTry(sh, L); return; }
  T.scriptSetText(w, L.ask);
  yield* T.scriptShowTextKeepOpen(sh, L.coach);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* S.scriptWaitFrames(sh, 0x05);
  if (a) { yield* T.scriptShowText(sh, L.coach); return; }
  T.scriptSkipText(w);
  yield* T.scriptShowText(sh, L.coach);
  const d = L.demo;
  St.golfSessionInit(w);
  if (d.offTee === true) setP1OffTee(w);
  saveReturnPoint(w, L.map, d.entrance);
  wr(w, 0xC834, d.mode);
  D.inBank(w, L.bank, () => D.copyMemoryFast(w, d.strokes, 0xC600, 0x04));
  St.setupPlayerGolfer(w, d.golfer, 0x00);
  St.setupPlayerGolfer(w, 0xFF, 0x01);
  St.setCourseHole(w, 0x07, 0x07, d.hole);
  setForcedWindDir(w, 0x00);
  setForcedTee(w, d.tee[0], d.tee[1]);
  if (d.offTee === "afterTee") setP1OffTee(w);
  setForcedWind(w, d.wind);
  if (d.pre) d.pre(w);
  setGolfEventHook(w, L.bank, d.hooks);
  yield* lessonRound(sh);
}
// back from the demo (the demo's entrance): ScriptBegin, the coach's talking script facing the player, fade in, the
// after-demo text asked (lessonAskTry), ScriptEnd
export function* lessonAfterDemo(sh, L) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  S.actorSetScript(w, L.coach, L.talkScript, L.bank);
  S.actorFaceActor(w, L.coach, rd(w, 0xC296));
  Scr.beginFadeIn(w, L.afterFade);
  yield* Scr.waitFade(sh);
  T.scriptSetText(w, L.after);
  yield* lessonAskTry(sh, L);
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}
// the question (31:4ED5, 30:4506 ...): No: the no text, the coach walks back; Yes: the flag, GolfSessionInit, the
// lesson music 8 until its first success, (SetP1OffTee), the return point (the try's entrance), the game mode, the
// player's golfer ($80), course 7 and the hole, the wind direction 0, the tee, the forced shot, the wind, the hooks,
// one hole
export function* lessonAskTry(sh, L) {
  const w = sh.w;
  yield* T.scriptShowTextKeepOpen(sh, L.coach);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* S.scriptWaitFrames(sh, 0x05);
  if (a) {
    T.scriptSetText(w, L.no);
    yield* T.scriptShowText(sh, L.coach);
    yield* lessonWalkBack(sh, L);
    return;
  }
  const t = L.try;
  setFlag(w, L.flag);
  St.golfSessionInit(w);
  if (!testFlag(w, L.seen)) wr(w, 0xC82C, L.music ?? 0x08);
  if (t.offTee === true) setP1OffTee(w);
  saveReturnPoint(w, L.map, t.entrance);
  wr(w, 0xC834, t.mode);
  St.setupPlayerGolfer(w, 0x80, 0x00);
  St.setupPlayerGolfer(w, 0xFF, 0x01);
  St.setCourseHole(w, 0x07, 0x07, t.hole);
  setForcedWindDir(w, 0x00);
  setForcedTee(w, t.tee[0], t.tee[1]);
  if (t.offTee === "afterTee") setP1OffTee(w);
  setForcedShot(w, t.shot[0], t.shot[1]);
  setForcedWind(w, t.wind);
  if (t.pre) t.pre(w);
  setGolfEventHook(w, L.bank, t.hooks);
  yield* lessonRound(sh);
}
// the coach back at his spot: his walk-back script and facing
export function* lessonWalkBack(sh, L) {
  S.actorSetScript(sh.w, L.coach, L.walkBack, L.bank);
  S.actorSetFacing(sh.w, L.coach, L.walkFacing);
}
// the result's start (31:4D9C, 30:4448 ...): ScriptBegin, the coach's talking script facing the player, fade in (8),
// 30 frames; the end: the coach walks back, ScriptEnd
export function* lessonResultBegin(sh, L) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  S.actorSetScript(w, L.coach, L.talkScript, L.bank);
  S.actorFaceActor(w, L.coach, rd(w, 0xC296));
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  yield* S.scriptWaitFrames(sh, 0x1E);
}
export function* lessonResultEnd(sh, L) {
  const [script, facing] = L.resultWalk ?? [L.walkBack, L.walkFacing];
  S.actorSetScript(sh.w, L.coach, script, L.bank);
  S.actorSetFacing(sh.w, L.coach, facing);
  if (!L.resultNoEnd) D.inBank(sh.w, 0x0A, () => S.scriptEnd(sh.w));
}
// the coach's cheer: animation 7, 30 frames
export function* lessonCheer(sh, L) {
  S.actorPlayAnim(sh.w, L.coach, 0x07);
  yield* S.waitActorAnimDone(sh, L.coach);
  yield* S.scriptWaitFrames(sh, 0x1E);
}
// a lesson passed: flag #98, the lesson's flag cleared
export function lessonPassed(w, L) { setFlag(w, 98); clearFlag(w, L.flag); }
// the text by the coach: ScriptSetText + ScriptShowText, or ShowMessageAt 05:5E70 at (3, $0A) (at: true)
export function* coachSays(sh, L, id, at = false) {
  if (at) yield* inBankGen(sh.w, 0x05, T.showMessageAt(sh, id, L.coach, 0x0A, 0x03));
  else { T.scriptSetText(sh.w, id); yield* T.scriptShowText(sh, L.coach); }
}
// a first success on the range's enter script: 30 frames, the seen flag, the EXP (30:7E7F), the return point (map 0,
// entrance $FA), SaveGame 02:4489, the warp
export function* lessonFirstSuccess(sh, L, exp, warp, saveGame) {
  const w = sh.w;
  if (!testFlag(w, 98)) return;
  clearFlag(w, 98);
  if (testFlag(w, L.seen)) return;
  yield* sh.advance(0x1E);                                       // 00:2ED5 WaitFramesCmd
  setFlag(w, L.seen);
  yield* awardExpWithBonus(sh, exp);
  saveReturnPoint(w, 0x00, 0xFA);
  saveGame(w);
  wr(w, 0xC441, warp);
}

// ---- the hooks ----
// a shot's set-up (31:4CB8, 30:435E ...): (WRAM6 and the bank kept: push), GolfViewExit 10:4C6E, the texts at (3,
// $0A) by the coach (05:5E70), before the last a wait (ScriptWaitFrames $3C, WaitFramesCmd $28 or "none"), GolfAdvanceFrame
export function* hookShotSetup(sh, coach, texts, { push = true, wait = "script" } = {}) {
  const w = sh.w, old = w.high[0x196];
  if (push) D.setWramBank(w, 6);
  yield* inBankGen(w, 0x10, golfViewExit(sh));
  for (let k = 0; k < texts.length; k++) {
    if (k === texts.length - 1) {
      if (wait === "script") yield* S.scriptWaitFrames(sh, 0x3C);
      else if (wait === "frames") yield* sh.advance(0x28);
    }
    yield* inBankGen(w, 0x05, T.showMessageAt(sh, texts[k], coach, 0x0A, 0x03));
  }
  yield* golfAdvanceFrame(sh);
  if (push) D.setWramBank(w, old);
}
// a demo's after-shot (31:4D00, 30:439B ...): GolfViewExit, the round over ($82) (and flag #99 = holed out: 30:4607),
// GolfAdvanceFrame; the WRAM bank kept (push; without: left at 6, 30:4EA1)
export function* hookDemoAfterShot(sh, { holed = false, push = true } = {}) {
  const w = sh.w, old = push ? w.high[0x196] : 6;
  yield* inBankGen(w, 0x10, golfViewExit(sh));
  setGolfEventFlag(w, 0x82);
  if (holed) { clearFlag(w, 99); if (rd(w, 0xC8AA)) setFlag(w, 99); }
  yield* golfAdvanceFrame(sh);
  D.setWramBank(w, old);
}
// a try's after-shot (31:4D71, 30:4409 ...): GolfViewExit; quit (game mode 0): the return entrance; else wEventResult
// $C968 = the judgement, flag #99 = holed out; (wEventShotClub $C969 = the first stroke's club, $D688, or another
// byte of its record: club, 30:543F reads +$0C with the bank kept, which ends the same); the round over
// ($82), GolfAdvanceFrame
export function* hookTryAfterShot(sh, quitEntrance, judge, { club = false } = {}) {
  if (club === true) club = 0x688;
  const w = sh.w;
  yield* inBankGen(w, 0x10, golfViewExit(sh));
  if (!rd(w, 0xC834)) wr(w, 0xC961, quitEntrance);
  else {
    wr(w, 0xC968, judge(sh));
    clearFlag(w, 99);
    if (rd(w, 0xC8AA)) setFlag(w, 99);
  }
  if (club) { D.setWramBank(w, 6); wr(w, 0xC969, w.wram[6][club]); }
  setGolfEventFlag(w, 0x82);
  yield* golfAdvanceFrame(sh);
}
// a practice's after-shot (31:52B7, 30:48DD): GolfViewExit; quit: the round over ($82), else the same shot again (1)
export function* hookPracticeAfterShot(sh) {
  const w = sh.w;
  yield* inBankGen(w, 0x10, golfViewExit(sh));
  setGolfEventFlag(w, rd(w, 0xC834) ? 0x01 : 0x82);
  yield* golfAdvanceFrame(sh);
}
// a range's "Practice here?" (31:51F4, 30:47E6): ScriptBegin, $0C60 (speaker $80): Yes: start(); ScriptEnd
export function* triggerPractice(sh, start) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  T.scriptSetText(w, 0x0C60);
  yield* T.scriptShowTextKeepOpen(sh, 0x80);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* S.scriptWaitFrames(sh, 0x05);
  if (!a) yield* start(sh);
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}
// a range's practice (31:521B, 30:480D): flag #100, GolfSessionInit, course 7 and the range's hole, player 1 off the
// tee, the golfers, the mode, the wind direction 0, the tee where the player stands ($C2A0 / $C2A2), the wind $C000,
// the hooks, one hole
export function* startPractice(sh, bank, hole, mode, hooks) {
  const w = sh.w;
  setFlag(w, 100);
  St.golfSessionInit(w);
  St.setCourseHole(w, 0x07, 0x07, hole);
  setP1OffTee(w);
  St.setupPlayerGolfer(w, 0x80, 0x00);
  St.setupPlayerGolfer(w, 0xFF, 0x01);
  wr(w, 0xC834, mode);
  setForcedWindDir(w, 0x00);
  setForcedTee(w, rd(w, 0xC2A0) | rd(w, 0xC2A1) << 8, rd(w, 0xC2A2) | rd(w, 0xC2A3) << 8);
  setForcedWind(w, 0xC000);
  setGolfEventHook(w, bank, hooks);
  yield* lessonRound(sh);
}
// the tip talks (31:4A1D, 30:40EE ...): the text asked (speaker s): Yes the next text, No the one after (with or
// without the 5 frames before the question: pre)
export function* tipTalk(sh, id, s, pre = true) {
  const w = sh.w;
  T.scriptSetText(w, id);
  yield* T.scriptShowTextKeepOpen(sh, s);
  if (pre) yield* S.scriptWaitFrames(sh, 0x05);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* S.scriptWaitFrames(sh, 0x05);
  if (a) T.scriptSkipText(w);
  yield* T.scriptShowText(sh, s);
}
// the chained tips (31:53A6, 31:5CC2, 30:515D): the text asked (speaker s; 5 frames before the question: pre): Yes
// the next text; No: the one after asked again (the same way): Yes the next, No the one after
export function* chainedTip(sh, id, s, pre = true) {
  const w = sh.w;
  T.scriptSetText(w, id);
  for (let k = 0; k < 2; k++) {
    if (k) T.scriptSkipText(w);
    yield* T.scriptShowTextKeepOpen(sh, s);
    if (pre) yield* S.scriptWaitFrames(sh, 0x05);
    const a = yield* T.scriptAskYesNo(sh);
    yield* T.scriptCloseText(sh);
    yield* S.scriptWaitFrames(sh, 0x05);
    if (!a) { yield* T.scriptShowText(sh, s); return; }
    if (k) { T.scriptSkipText(w); yield* T.scriptShowText(sh, s); }
  }
}
// the golf lingo sign (trigger 1 of the ranges, 31:4BC9, 30:4277): ScriptBegin, $0857 (speaker 0), ScriptEnd
export function* triggerLingoSign(sh) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  T.scriptSetText(w, 0x0857);
  yield* T.scriptShowText(sh, 0x00);
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}
