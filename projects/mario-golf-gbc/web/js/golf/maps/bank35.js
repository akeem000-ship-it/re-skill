// Bank 35's map scripts (REVERSE.md "Bank 35: Trophy Room, ending maps and the test rooms"): map $25, the caption
// screen of two story moments: the Marion Club Director's Office (entrance 1, from the clubhouse) and the letter read
// after it fell from the tree (entrances 2 / 3).
import * as D from "../render/display.js";
import * as Scr from "../screen.js";
import * as S from "../script.js";
import * as T from "../msgbox.js";
import { setSaveFlag } from "../match.js";

const rd = D.rd, wr = D.wr;
const setFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] |= 0x80 >> (n & 7); };

// 35:79D2 Map25EnterCaption: entrance 1: the player and the partner hidden (state 0), fade in (4), "Marion Club
// Director's Office" ($0486, speaker $86, the text speed's bit 7 set while shown) for 110 frames, fade out (4), warp 1
// (map 5); entrances 2 / 3: $1442 (speaker $8A), the player and partner hidden, actor 1 jumped to ($0800, $0800) at
// speed $80, fade in (2), 20 frames, the text, fade out (4), the player walks to ($0900, $2100), fade in (2), 20
// frames, the next text ($1443, Peach's invitation), fade out (4), #123 and the save flag $1E0, warp 2 (the Field's
// entrance $0F) / 3 (map 0)
function* map25Enter(sh) {
  const w = sh.w, e = rd(w, 0xC46A);
  if (e === 1) {
    S.actorSetState(w, 0x00, 0x00);
    S.actorSetState(w, rd(w, 0xC298), 0x00);
    Scr.beginFadeIn(w, 0x04);
    yield* Scr.waitFade(sh);
    wr(w, 0xC82D, rd(w, 0xC82D) | 0x80);
    T.scriptSetText(w, 0x0486);
    yield* T.scriptShowTextKeepOpen(sh, 0x86);
    yield* S.scriptWaitFrames(sh, 0x6E);
    yield* T.scriptCloseText(sh);
    wr(w, 0xC82D, rd(w, 0xC82D) & 0x7F);
    Scr.beginFadeOut(w, 0x04);
    yield* Scr.waitFade(sh);
    wr(w, 0xC441, 0x01);
    return;
  }
  if (e !== 2 && e !== 3) return;
  T.scriptSetText(w, 0x1442);
  S.actorSetState(w, 0x00, 0x00);
  S.actorSetState(w, rd(w, 0xC298), 0x00);
  S.scriptActorSetSpeed(w, 0x0080);
  yield* S.scriptActorGoTo(sh, 0x01, 0x0800, 0x0800);
  Scr.beginFadeIn(w, 0x02);
  yield* Scr.waitFade(sh);
  yield* S.scriptWaitFrames(sh, 0x14);
  yield* T.scriptShowText(sh, 0x8A);
  Scr.beginFadeOut(w, 0x04);
  yield* Scr.waitFade(sh);
  yield* S.scriptActorGoTo(sh, 0x00, 0x0900, 0x2100);
  yield* S.waitScriptActorIdle(sh);
  Scr.beginFadeIn(w, 0x02);
  yield* Scr.waitFade(sh);
  yield* S.scriptWaitFrames(sh, 0x14);
  yield* T.scriptShowText(sh, 0x8A);
  Scr.beginFadeOut(w, 0x04);
  yield* Scr.waitFade(sh);
  setFlag(w, 123);
  setSaveFlag(w, 0x01E0);
  wr(w, 0xC441, e);
}

export const SCRIPTS = {
  "35:79d2": map25Enter,
};
export const TASKS = () => ({});
