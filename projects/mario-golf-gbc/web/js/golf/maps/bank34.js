// Bank 34's map scripts (REVERSE.md "Bank 34: map scripts of the Field and the side places"): map $06 (the Locker
// Room), map $02 (the Field between the clubs), ...
import * as D from "../render/display.js";
import * as S from "../script.js";
import * as T from "../msgbox.js";
import * as M from "../mapengine.js";
import { mapBufCopyRectRedraw, mapCopyTerrainRect, mapCopyEventRect } from "../mapgfx.js";
import { navGuideStart } from "../nav.js";
import * as Scr from "../screen.js";
import { advanceRandomSeed } from "../round.js";

const rd = D.rd, wr = D.wr;
const flag = (w, n) => w.wram[0][0x840 + (n >> 3)] & (0x80 >> (n & 7));
const setFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] |= 0x80 >> (n & 7); };
const clearFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] &= ~(0x80 >> (n & 7)); };
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}

// 34:42B6 Map06EnterSelectTalkList: the talk list (+6) by progress: #139 34:41BF, #115 4196, #114 416D, #113 4144,
// #112 411B
function* map06EnterSelectTalkList(sh) {
  const w = sh.w;
  for (const [n, hl] of [[139, 0x41BF], [115, 0x4196], [114, 0x416D], [113, 0x4144], [112, 0x411B]])
    if (flag(w, n)) { M.scriptSetMapField(w, hl, 0x000C); return; }
}
// 34:407F Map06TalkGrumpyGolfer (talk 6): talked to: a random gripe $0814-$0816 (the low two bits of a random
// number, 0 taken as 2), flags #224 / #225 cleared; bumped into (flag #23): $0817, $0818, then $0819 with the screen
// shaking (strength 2, 40 frames) and a pause
function* map06TalkGrumpyGolfer(sh) {
  const w = sh.w;
  if (!flag(w, 23)) {
    let a = advanceRandomSeed(w) & 3;
    if (!a) a = 2;
    T.scriptSetText(w, 0x0813 + a);
    yield* T.scriptShowText(sh, 0x06);
    clearFlag(w, 224); clearFlag(w, 225);
    return;
  }
  if (!flag(w, 225)) {
    T.scriptSetText(w, flag(w, 224) ? 0x0818 : 0x0817);
    yield* T.scriptShowText(sh, 0x06);
    setFlag(w, flag(w, 224) ? 225 : 224);
    return;
  }
  T.scriptSetText(w, 0x0819);
  yield* T.scriptShowText(sh, 0x06);
  S.scriptShakeScreen(w, 0x02);
  yield* S.scriptWaitFrames(sh, 0x28);
  S.scriptShakeScreen(w, 0x00);
  yield* S.scriptWaitFrames(sh, 0x0F);
}
// 34:41E8 Map06OpenLocker (objects 1-$0A: 34:4218 ... 34:4245, the locker at tile (d, e)): flag #18 cleared, sound
// $A6, the door open (the 2 x 4 tiles from row $1A, 0B:4864), a random find ($082F + 0-15), sound $A6, closed (row $1E)
function* map06OpenLocker(sh, d, e) {
  const w = sh.w;
  clearFlag(w, 18);
  sh.sound(0xA6);
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, d, 0x1A, d, e, 0x02, 0x04));
  T.scriptSetText(w, 0x082F + (advanceRandomSeed(w) & 0x0F));
  yield* T.scriptShowText(sh, 0xFF);
  sh.sound(0xA6);
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, d, 0x1E, d, e, 0x02, 0x04));
}
const LOCKERS = { "34:4218": [0x04, 0x02], "34:421d": [0x06, 0x02], "34:4222": [0x08, 0x02], "34:4227": [0x02, 0x0A],
  "34:422c": [0x06, 0x0A], "34:4231": [0x12, 0x02], "34:4236": [0x14, 0x02], "34:423b": [0x16, 0x02],
  "34:4240": [0x12, 0x0A], "34:4245": [0x16, 0x0A] };   // [d, e] of 34:4218 ... 34:4245 (`ld de`)
// 34:429B Map06Trigger01MutterWindTip: ScriptBegin, text $0172 (speaker 0), ScriptEnd
function* map06Trigger01MutterWindTip(sh) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  T.scriptSetText(w, 0x0172);
  yield* T.scriptShowText(sh, 0x00);
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}

function notPorted(what) { throw new Error(`${what} is not ported`); }
const wait = (sh, n) => S.scriptWaitFrames(sh, n);
// ---- map $02, the Field ----
// a rectangle of the map (b, c) -> (d, e), h x l tiles: in the event grid, the terrain grid and the tiles (0B:4699,
// 0B:4653, 0B:4864) in the order given
function* fieldRect(sh, order, b, c, d, e, h, l) {
  const w = sh.w;
  for (const k of order) {
    if (k === "e") mapCopyEventRect(w, b, c, d, e, h, l);
    else if (k === "t") mapCopyTerrainRect(w, b, c, d, e, h, l);
    else yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, b, c, d, e, h, l));
  }
}
// 34:4690 Map02Enter: flag #99 cleared, #212 (34:5598: #198 and #114), wStoryRoundKind 0, the navigation guide
// (0A:7878), no name banner; #127 sets #125; #118 / #119 cleared; the map's changes by progress: 34:4719 (#139 and
// not #125: the tree's event cell), 34:4769 (the paths still closed: a block for each of #86, #84, #82, #80 clear,
// up to the first set one; then a frame), 34:4733 (#114: #124 and an area opened), 34:46E6 (#125: the tree
// gone); entrance $0E (~34:5218, the Grand Champion) and $0F (~34:5019, the path opening) are not ported, nor the
// marker sprite of #125 (~34:4FCC)
function* map02Enter(sh) {
  const w = sh.w;
  clearFlag(w, 99);
  if (flag(w, 198) && flag(w, 114)) setFlag(w, 212);
  wr(w, 0xC967, 0x00);
  yield* navGuideStart(sh);
  wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0);
  if (flag(w, 127)) setFlag(w, 125);
  clearFlag(w, 118); clearFlag(w, 119);
  if (!flag(w, 125) && flag(w, 139)) mapCopyEventRect(w, 0x2C, 0x1E, 0x1C, 0x18, 0x02, 0x02);   // 34:4719
  for (const [n, d, e] of [[86, 0x22, 0x1A], [84, 0x0E, 0x16], [82, 0x0A, 0x24], [80, 0x0E, 0x2C]]) {   // 34:4769
    if (flag(w, n)) break;
    yield* fieldRect(sh, "etr", 0x2C, 0x1C, d, e, 0x02, 0x02);
  }
  yield* wait(sh, 0x01);                                          // 34:4833
  if (flag(w, 114)) { setFlag(w, 124); yield* fieldRect(sh, "etr", 0x2C, 0x16, 0x14, 0x20, 0x04, 0x05); }   // 34:4733
  if (flag(w, 125)) yield* fieldRect(sh, "ter", 0x2C, 0x07, 0x14, 0x11, 0x02, 0x0A);   // 34:46E6
  const e = rd(w, 0xC46A);
  if (e === 0x0E) notPorted("the Grand Champion's return to the Field (~34:5218)");
  if (e === 0x0F) notPorted("the path's opening scene (~34:5019)");
  if (flag(w, 125)) notPorted("the Field's marker sprite (~34:4FCC)");
}
// 34:452A Map02WalkInWithPartner: the player and the partner at speed $10; the player half a tile up, animation $0A,
// a tile up, 20 frames, hidden (state 0); both $140 up, the partner's walk awaited, the partner $140 up again
function* map02WalkInWithPartner(sh) {
  const w = sh.w, p = rd(w, 0xC298);
  S.actorSetSpeed(w, 0x00, 0x0010);
  S.actorSetSpeed(w, p, 0x0010);
  S.actorMoveDir(w, 0x00, 0xC0, 0x0080);
  yield* S.waitActorMoveDone(sh, 0x00);
  S.actorPlayAnim(w, 0x00, 0x0A);
  S.actorMoveDir(w, 0x00, 0xC0, 0x0100);
  yield* wait(sh, 0x14);
  S.actorSetState(w, 0x00, 0x00);
  S.actorSetSpeed(w, 0x00, 0x0010);
  S.actorSetSpeed(w, p, 0x0010);
  S.actorMoveDir(w, 0x00, 0xC0, 0x0140);
  S.actorMoveDir(w, p, 0xC0, 0x0140);
  yield* S.waitActorMoveDone(sh, p);
  S.actorMoveDir(w, p, 0xC0, 0x0140);
}
// 34:4474 / 4497 / 44C6 / 44F5 Map02Trigger01-04: the partner (its script reset) to the door ($0500, $2F00 /
// $0500, $1B00 / $2100, $2F00; the Links Club none), the walk in (34:452A), warp 1-4 (the Marion clubhouse, the
// Palm, Dune and Links offices), sound $92; 2-4 then fade out (speed 8) and 30 frames
function* map02TriggerEnter(sh, warp, x, y) {
  const w = sh.w, p = rd(w, 0xC298);
  if (x !== undefined) {
    S.actorResetScript(w, p);
    S.actorMoveTo(w, p, x, y);
    yield* S.waitActorMoveDone(sh, p);
  }
  yield* map02WalkInWithPartner(sh);
  wr(w, 0xC441, warp);
  sh.sound(0x92);
  if (warp === 1) return;
  Scr.beginFadeOut(w, 0x08);
  yield* wait(sh, 0x1E);
}
// 34:5530 Map02ConfirmQuitMatchGame: no challenger following (34:5512: flags #144-#147) -> 0; the question
// (~34:553A) is not ported
function map02ConfirmQuitMatchGame(w) {
  if ([144, 145, 146, 147].some(n => flag(w, n))) notPorted("quitting a Match Game (~34:553A)");
  return 0;
}
// 34:4618 ... 34:4681 Map02Trigger06-0D: 34:5530, then warp 6-$0D (Windy Valley ... the Club Maker's Hut), sound $92
function* map02TriggerPlace(sh, warp) {
  const w = sh.w;
  if (map02ConfirmQuitMatchGame(w) === 1) return;
  wr(w, 0xC441, warp);
  sh.sound(0x92);
}
// 34:483B Map02Trigger0FLetterEvent (the tree): nothing before the Links Club is won (#139) or once the path is open
// (#125); the letter (~34:484D) and #123's scene (~34:5019) are not ported
function* map02Trigger0F(sh) {
  const w = sh.w;
  if (!flag(w, 139) || flag(w, 125)) return;
  notPorted("the letter at the tree (~34:4847)");
}

export const SCRIPTS = {
  "34:4690": map02Enter,
  "34:4474": sh => map02TriggerEnter(sh, 1, 0x0500, 0x2F00),
  "34:4497": sh => map02TriggerEnter(sh, 2, 0x0500, 0x1B00),
  "34:44c6": sh => map02TriggerEnter(sh, 3, 0x2100, 0x2F00),
  "34:44f5": sh => map02TriggerEnter(sh, 4),
  ...Object.fromEntries([0x4618, 0x4627, 0x4636, 0x4645, 0x4654, 0x4663, 0x4672, 0x4681].map((a, k) => [`34:${a.toString(16)}`, sh => map02TriggerPlace(sh, 6 + k)])),
  "34:483b": map02Trigger0F,
  "34:42b6": map06EnterSelectTalkList,
  "34:407f": map06TalkGrumpyGolfer,
  "34:429b": map06Trigger01MutterWindTip,
  ...Object.fromEntries(Object.entries(LOCKERS).map(([k, [d, e]]) => [k, sh => map06OpenLocker(sh, d, e)])),
};
export const TASKS = () => ({});
