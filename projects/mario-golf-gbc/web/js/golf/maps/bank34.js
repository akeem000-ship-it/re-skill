// Bank 34's map scripts (REVERSE.md "Bank 34: map scripts of the Field and the side places"): map $06 (the Locker
// Room), ...
import * as D from "../render/display.js";
import * as S from "../script.js";
import * as T from "../msgbox.js";
import * as M from "../mapengine.js";
import { mapBufCopyRectRedraw } from "../mapgfx.js";
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

export const SCRIPTS = {
  "34:42b6": map06EnterSelectTalkList,
  "34:407f": map06TalkGrumpyGolfer,
  "34:429b": map06Trigger01MutterWindTip,
  ...Object.fromEntries(Object.entries(LOCKERS).map(([k, [d, e]]) => [k, sh => map06OpenLocker(sh, d, e)])),
};
export const TASKS = () => ({});
