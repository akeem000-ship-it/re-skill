// Bank 35's map scripts (REVERSE.md "Bank 35: Trophy Room, ending maps and the test rooms"): the Trophy Room (map
// $07); map $25, the caption
// screen of two story moments: the Marion Club Director's Office (entrance 1, from the clubhouse) and the letter read
// after it fell from the tree (entrances 2 / 3); the ending's maps $31-$3E, wordless replays run one after another
// by EndingSequence 0A:56B1 (ending.js).
import { rb } from "../rom.js";
import * as D from "../render/display.js";
import * as Scr from "../screen.js";
import * as S from "../script.js";
import * as T from "../msgbox.js";
import * as M from "../mapengine.js";
import * as A from "../actors.js";
import { registerFrameTask, unregisterFrameTask } from "../tasks.js";
import { mapBufCopyRectRedraw, mapCopyTerrainRect, mapCopyEventRect } from "../mapgfx.js";
import { loadCursorSprite } from "../nav.js";
import { setTextCourseIndex, pushTextNumberArg } from "../text.js";
import { testCourseHoleBit } from "../scorecard.js";
import { setSaveFlag } from "../match.js";
import { twoPlayerScoreScreen } from "../standings.js";
import * as R0C from "../records0c.js";
import { palFadeInitSepia, palFadeSetup, palFadeRun } from "../ending.js";
import { clearFrameTasks } from "../tasks.js";
import { debugSaveViewer } from "../debug.js";
import { countCharacterHeaders } from "../unreached.js";
import { actorSetCharacter } from "../render/actors.js";

const rd = D.rd, wr = D.wr;
const flag = (w, n) => w.wram[0][0x840 + (n >> 3)] & (0x80 >> (n & 7));
const setFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] |= 0x80 >> (n & 7); };
const wait = (sh, n) => S.scriptWaitFrames(sh, n);
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}

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

// ---- map $07, the Trophy Room (header 35:4024; the clubhouse's door 5, warp 7) ----
// 35:41B2 Map07PlaceTrophies (from 35:41AE Map07Enter): for each club, Peach's first ([placed flag, won flag, the
// winner's actor and place, the second's and third's actors, the club]): placed (#116 / #115 / #114 / #113 / #112):
// won (#117 / #139-#136): the other two put away and the winner's trophy placed; then (won or not) the place's test
// (TestCourseHoleBit 02:5C77, the club's bit $16): set -> the third's put away, clear -> the second's
const TROPHIES = [
  [116, 117, 0x0E, 0x0B00, 0x06A0, 0x0F, 0x10, 0x05],
  [115, 139, 0x0B, 0x1100, 0x04A0, 0x0C, 0x0D, 0x04],
  [114, 138, 0x08, 0x1100, 0x0AA0, 0x09, 0x0A, 0x03],
  [113, 137, 0x05, 0x0500, 0x04A0, 0x06, 0x07, 0x02],
  [112, 136, 0x02, 0x0500, 0x0AA0, 0x03, 0x04, 0x01],
];
function map07PlaceTrophies(w) {
  for (const [placed, won, a, x, y, second, third, club] of TROPHIES) {
    if (!flag(w, placed)) continue;
    if (flag(w, won)) {
      S.actorSetPos(w, second, 0x3F00, 0x3F00);
      S.actorSetPos(w, third, 0x3F00, 0x3F00);
      S.actorSetPos(w, a, x, y);
    }
    S.actorSetPos(w, testCourseHoleBit(w, club, 0x16) ? third : second, 0x3F00, 0x3F00);
  }
}
function* map07Enter(sh) { map07PlaceTrophies(sh.w); }
// 35:4396 Map07GetTrophyPlace: $C3E1 = 2 when the club's ($C3E0) bit $16 is set (02:5C77), else 3
function map07GetTrophyPlace(w) { wr(w, 0xC3E1, testCourseHoleBit(w, rd(w, 0xC3E0), 0x16) ? 0x02 : 0x03); }
// 35:43AE Map07PushTrophyTextArgs: SetTextCourseIndex 05:57C3 (the club), PushTextNumberArg 05:551F (the place)
function map07PushTrophyTextArgs(w) {
  D.inBank(w, 0x05, () => setTextCourseIndex(w, rd(w, 0xC3E0)));
  pushTextNumberArg(w, rd(w, 0xC3E1));
}
// 35:4345 Map07DescribeTrophy (hl = the win flag): won: $083F with the club (SetTextCourseIndex); Peach's (club 5):
// the next text ($0840) shown (speaker $80); else (quirk kept: a won club trophy goes on as a placed one) the place
// (35:4396) and the text arguments (35:43AE), shown; not won: $0841 with flag #0, else $0843, Peach's one text on
function* map07DescribeTrophy(sh, n) {
  const w = sh.w, club = rd(w, 0xC3E0);
  if (flag(w, n)) {
    T.scriptSetText(w, 0x083F);
    D.inBank(w, 0x05, () => setTextCourseIndex(w, club));
    if (club === 0x05) { T.scriptSkipText(w); yield* T.scriptShowText(sh, 0x80); return; }
  } else {
    T.scriptSetText(w, flag(w, 0) ? 0x0841 : 0x0843);
    if (club === 0x05) T.scriptSkipText(w);
  }
  map07GetTrophyPlace(w);                                         // 35:438A
  map07PushTrophyTextArgs(w);
  yield* T.scriptShowText(sh, 0x80);
}
// 35:4115 / 4126 / 4137 / 4148 / 4159 Map07Object*Trophy (objects 1-5): the placed flag (#112-#116) set: $C3E0 =
// the club (1-5), 35:4345 with the win flag (#136-#139, #117)
function* map07ObjectTrophy(sh, placed, club, won) {
  if (!flag(sh.w, placed)) return;
  wr(sh.w, 0xC3E0, club);
  yield* map07DescribeTrophy(sh, won);
}
// 35:4193 Map07Trigger01MutterWindTip (trigger 1): ScriptBegin, $0172 (speaker 0), ScriptEnd
function* map07Trigger01(sh) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  T.scriptSetText(w, 0x0172);
  yield* T.scriptShowText(sh, 0x00);
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}

// ---- the ending's maps ($31-$3E) ----
// 35:4415 Map31EnterEndingDirector: ending: replays the first-day scene in the Director's Room ("Hello {name}! It's
// your 1st day as our student!" $0487; actors from list 43D5); warp 1
function* map31Enter(sh) {
  const w = sh.w;
  T.scriptSetText(w, 0x0487);
  M.scriptRespawnActors(w, 0x35, 0x43D5);
  S.actorSetSpeed(w, 0x02, 0x0010);
  S.actorSetSpeed(w, 0x03, 0x0010);
  S.actorSetSpeed(w, 0x04, 0x0010);
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  yield* wait(sh, 0x0A);
  S.actorPlayAnim(w, 0x02, 0x07);
  yield* S.waitActorAnimDone(sh, 0x02);
  yield* wait(sh, 0x0A);
  yield* wait(sh, 0x0A);
  yield* wait(sh, 0x14);
  yield* wait(sh, 0x0A);
  S.actorSetFacing(w, 0x02, 0x80);
  yield* wait(sh, 0x14);
  S.actorSetFacing(w, 0x03, 0x00);
  yield* wait(sh, 0x1E);
  S.actorSetFacing(w, 0x02, 0x40);
  yield* wait(sh, 0x0A);
  S.actorSetFacing(w, 0x03, 0x40);
  yield* wait(sh, 0x0A);
  S.actorMoveDir(w, 0x03, 0x40, 0x0200);
  yield* S.waitActorMoveDone(sh, 0x03);
  yield* wait(sh, 0x0A);
  yield* wait(sh, 0x0A);
  S.actorSetFacing(w, 0x03, 0xC0);
  yield* wait(sh, 0x14);
  S.actorPlayAnim(w, 0x03, 0x07);
  yield* S.waitActorAnimDone(sh, 0x03);
  yield* wait(sh, 0x0A);
  yield* wait(sh, 0x0A);
  S.actorSetFacing(w, 0x03, 0x40);
  yield* wait(sh, 0x0A);
  yield* wait(sh, 0x0A);
  S.actorSetFacing(w, 0x03, 0x40);
  S.actorMoveDir(w, 0x04, 0x40, 0x0200);
  yield* S.waitActorMoveDone(sh, 0x04);
  yield* wait(sh, 0x0A);
  yield* wait(sh, 0x14);
  S.actorMoveDir(w, 0x02, 0x40, 0x0200);
  yield* S.waitActorMoveDone(sh, 0x02);
  wr(w, 0xC441, 0x01);
}
// 35:479A Map32EnterEndingLounge: End Lounge enter: fade in; Map32Trigger01LoungeTour; warp
function* map32Enter(sh) {
  const w = sh.w;
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  yield* map32LoungeTour(sh);                                   // 35:466A
  wr(w, 0xC441, 0x01);
}
// 35:4AE5 Map33EndingScene2: entrance 2: Map33DrawRoom2; actors walk and jump; warp 2
function* map33Scene2(sh) {
  const w = sh.w;
  S.actorSetPos(w, 0x0B, 0x3F00, 0x3F00);
  yield* map33DrawRoom2(sh);                                    // 35:4DD7
  Scr.beginFadeIn(w, 0x04);
  S.scriptActorSetSpeed(w, 0x0010);
  S.actorSetSpeed(w, 0x00, 0x0010);
  yield* S.scriptActorGoTo(sh, 0x00, 0x2900, 0x0D00);
  S.actorMoveTo(w, 0x00, 0x2B00, 0x0D00);
  yield* S.waitActorMoveDone(sh, 0x00);
  yield* wait(sh, 0x28);
  S.actorSetPos(w, 0x0B, 0x2B00, 0x0700);
  S.actorMoveDir(w, 0x0B, 0x40, 0x0100);
  yield* S.waitActorMoveDone(sh, 0x0B);
  S.actorJump(w, 0x0B, 0xFF40);
  S.actorMoveTo(w, 0x0B, 0x2700, 0x0B00);
  yield* S.waitActorMoveDone(sh, 0x0B);
  S.actorSetFacing(w, 0x0B, 0x40);
  S.actorMoveTo(w, 0x00, 0x2900, 0x0D00);
  yield* S.waitActorMoveDone(sh, 0x00);
  yield* wait(sh, 0x50);
  wr(w, 0xC441, 0x02);
}
// 35:4B7D Map33EndingScene3: entrance 3: Map33DrawRoom3; actors respawned from 4D5D; long animated scene; four actors
// get Map33ActorScriptData; warp 3
function* map33Scene3(sh) {
  const w = sh.w;
  yield* map33DrawRoom3(sh);                                    // 35:4DBB
  M.scriptRespawnActors(w, 0x35, 0x4D5D);
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  Scr.beginFadeIn(w, 0x04);
  yield* Scr.waitFade(sh);
  S.actorPlayAnim(w, 0x05, 0x06);
  yield* S.waitActorAnimDone(sh, 0x05);
  S.actorsFaceEachOther(w, 0x00, 0x02);
  yield* wait(sh, 0x1E);
  S.actorPlayAnim(w, 0x05, 0x07);
  yield* S.waitActorAnimDone(sh, 0x05);
  yield* wait(sh, 0x1E);
  S.actorPlayAnim(w, 0x05, 0x05);
  yield* S.waitActorAnimDone(sh, 0x05);
  T.scriptSkipText(w);
  S.actorSetFacing(w, 0x00, 0xC0);
  S.actorSetFacing(w, 0x02, 0xC0);
  yield* wait(sh, 0x1E);
  S.actorPlayAnim(w, 0x05, 0x05);
  yield* S.waitActorAnimDone(sh, 0x05);
  S.actorsFaceEachOther(w, 0x03, 0x04);
  yield* wait(sh, 0x1E);
  S.actorPlayAnim(w, 0x04, 0x05);
  S.actorPlayAnim(w, 0x03, 0x05);
  yield* S.waitActorAnimDone(sh, 0x03);
  S.actorSetFacing(w, 0x04, 0xC0);
  S.actorSetFacing(w, 0x03, 0xC0);
  S.actorPlayAnim(w, 0x04, 0x05);
  S.actorPlayAnim(w, 0x00, 0x05);
  S.actorPlayAnim(w, 0x02, 0x05);
  S.actorPlayAnim(w, 0x03, 0x05);
  yield* S.waitActorAnimDone(sh, 0x03);
  S.actorSetSpeed(w, 0x00, 0x0010);
  S.actorSetSpeed(w, 0x02, 0x0010);
  S.actorSetSpeed(w, 0x03, 0x0010);
  S.actorSetSpeed(w, 0x04, 0x0010);
  S.scriptActorSetSpeed(w, 0x0010);
  yield* wait(sh, 0x01);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1D80, 0x0D80);
  S.actorMoveTo(w, 0x00, 0x1D80, 0x0D80);
  S.actorMoveDir(w, 0x02, 0x00, 0x0200);
  yield* S.waitActorMoveDone(sh, 0x02);
  S.actorMoveTo(w, 0x02, 0x1B00, 0x0D80);
  S.actorMoveDir(w, 0x04, 0xC0, 0x0200);
  yield* wait(sh, 0x05);
  S.actorMoveDir(w, 0x03, 0xC0, 0x0200);
  yield* S.waitActorMoveDone(sh, 0x03);
  S.actorMoveTo(w, 0x03, 0x1900, 0x0D80);
  S.actorMoveTo(w, 0x04, 0x1700, 0x0D80);
  yield* S.waitActorMoveDone(sh, 0x04);
  yield* S.waitScriptActorIdle(sh);
  yield* S.waitActorMoveDone(sh, 0x00);
  S.actorSetFacing(w, 0x00, 0x80);
  S.actorPlayAnim(w, 0x02, 0x05);
  yield* S.waitActorAnimDone(sh, 0x02);
  S.actorPlayAnim(w, 0x00, 0x07);
  yield* S.waitActorAnimDone(sh, 0x00);
  S.actorSetScript(w, 0x02, 0x48F9, 0x35);
  yield* wait(sh, 0x15);
  S.actorSetScript(w, 0x03, 0x48F9, 0x35);
  yield* wait(sh, 0x01);
  S.actorSetScript(w, 0x04, 0x48F9, 0x35);
  yield* wait(sh, 0x64);
  S.actorSetScript(w, 0x00, 0x48F9, 0x35);
  yield* wait(sh, 0x5A);
  wr(w, 0xC441, 0x03);
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}
// 35:4D9F Map33DrawRoom1: room tiles (MapBufCopyRectRedraw) and palettes 4E0A
function* map33DrawRoom1(sh) {
  const w = sh.w;
  yield* S.waitScriptActorIdle(sh);
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x01, 0x15, 0x01, 0x06, 0x3A, 0x04));
  D.inBank(w, 0x35, () => D.loadPalettesMasterOnly(w, 0x4E0A, 0x02, 0x06));
}
// 35:4DBB Map33DrawRoom3: room tiles (MapBufCopyRectRedraw) and palettes 4E4A
function* map33DrawRoom3(sh) {
  const w = sh.w;
  yield* S.waitScriptActorIdle(sh);
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x01, 0x1A, 0x01, 0x06, 0x3A, 0x04));
  D.inBank(w, 0x35, () => D.loadPalettesMasterOnly(w, 0x4E4A, 0x02, 0x06));
}
// 35:4DD7 Map33DrawRoom2: room tiles (MapBufCopyRectRedraw) and palettes 4E8A
function* map33DrawRoom2(sh) {
  const w = sh.w;
  yield* S.waitScriptActorIdle(sh);
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x01, 0x1F, 0x01, 0x06, 0x3A, 0x04));
  D.inBank(w, 0x35, () => D.loadPalettesMasterOnly(w, 0x4E8A, 0x02, 0x06));
}
// 35:4F35 Map34EnterEndingAward: fade out; actor states; Map34AwardCeremony; warp
function* map34Enter(sh) {
  const w = sh.w;
  Scr.beginFadeOut(w, 0x7F);
  S.actorSetState(w, 0x04, 0x00);
  S.actorSetState(w, 0x05, 0x00);
  yield* map34AwardCeremony(sh);                                // 35:4F51
  wr(w, 0xC441, 0x01);
}
// 35:5352 Map35Trigger01EndingCaretaker: ending: ball piles drawn; caretaker: "Those darn kids! Balls everywhere!"
// and walks the course; warp 1
function* map35CaretakerScene(sh) {
  const w = sh.w;
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x3F, 0x26, 0x19, 0x24, 0x01, 0x01));
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x3F, 0x24, 0x19, 0x27, 0x01, 0x01));
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x3F, 0x26, 0x1C, 0x2A, 0x01, 0x01));
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x3F, 0x28, 0x1F, 0x28, 0x01, 0x01));
  Scr.beginFadeIn(w, 0x04);
  S.scriptActorSetSpeed(w, 0x0020);
  T.scriptSetText(w, 0x14EA);
  yield* wait(sh, 0x0A);
  yield* S.scriptActorGoToActor(sh, 0x02, 0x00);
  yield* S.waitScriptActorIdle(sh);
  S.actorSetFacing(w, 0x02, 0x00);
  yield* wait(sh, 0x1E);
  S.actorSetFacing(w, 0x02, 0x40);
  yield* wait(sh, 0x0A);
  S.actorSetFacing(w, 0x02, 0x80);
  yield* wait(sh, 0x1E);
  S.actorSetFacing(w, 0x02, 0x40);
  S.actorPlayAnim(w, 0x02, 0x06);
  yield* S.waitActorAnimDone(sh, 0x02);
  yield* wait(sh, 0x0A);
  S.actorPlayAnim(w, 0x02, 0x06);
  yield* S.waitActorAnimDone(sh, 0x02);
  S.scriptActorSetSpeed(w, 0x0018);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1B00, 0x3500);
  S.actorSetFacing(w, 0x02, 0x00);
  yield* wait(sh, 0x1E);
  S.actorSetFacing(w, 0x02, 0xC0);
  yield* wait(sh, 0x0A);
  S.actorSetFacing(w, 0x02, 0x80);
  yield* wait(sh, 0x1E);
  S.actorSetFacing(w, 0x02, 0xC0);
  S.actorSetSpeed(w, 0x00, 0x0014);
  S.actorMoveTo(w, 0x00, 0x1B00, 0x3500);
  yield* S.waitActorMoveDone(sh, 0x00);
  S.scriptActorSetSpeed(w, 0x0014);
  S.actorSetFacing(w, 0x02, 0x40);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1F00, 0x3500);
  S.actorMoveTo(w, 0x00, 0x1F00, 0x3500);
  yield* S.waitActorMoveDone(sh, 0x00);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1F00, 0x3100);
  S.actorMoveTo(w, 0x00, 0x1F00, 0x2F00);
  yield* S.waitActorMoveDone(sh, 0x00);
  yield* wait(sh, 0x14);
  wr(w, 0xC441, 0x01);
}
// 35:55F5 Map36EndingSceneJoe: entrance 2: crow gfx; hat task; actors walk; Joe jumps out twice; warp
function* map36SceneJoe(sh) {
  const w = sh.w;
  map36LoadCrowGfx(w);                                         // 35:5921
  S.scriptActorSetSpeed(w, 0x0010);
  S.actorSetSpeed(w, 0x00, 0x0010);
  yield* wait(sh, 0x0A);
  Scr.beginFadeIn(w, 0x04);
  yield* Scr.waitFade(sh);
  registerFrameTask(w, 0x04, 0x35, 0x56F8);
  yield* wait(sh, 0x0A);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1300, 0x2100);
  S.actorMoveTo(w, 0x00, 0x1300, 0x2100);
  yield* S.waitActorMoveDone(sh, 0x00);
  S.actorMoveTo(w, 0x00, 0x0B00, 0x2100);
  S.actorMoveTo(w, 0x00, 0x0F00, 0x2100);
  yield* S.waitActorMoveDone(sh, 0x00);
  yield* wait(sh, 0x14);
  S.actorSetFacing(w, 0x00, 0x80);
  yield* wait(sh, 0x14);
  S.actorSetPos(w, 0x06, 0x0D00, 0x2100);
  S.actorLockSpriteFacing(w, 0x00, 0x01);
  S.actorJump(w, 0x00, 0xFF80);
  S.actorMoveDir(w, 0x00, 0x00, 0x0200);
  yield* S.waitActorMoveDone(sh, 0x00);
  S.actorLockSpriteFacing(w, 0x00, 0x00);
  S.actorJump(w, 0x06, 0xFF80);
  S.actorMoveDir(w, 0x06, 0x00, 0x0200);
  yield* S.waitActorMoveDone(sh, 0x06);
  wr(w, 0xC441, 0x01);
}
// 35:5BAA Map38EnterEndingMatchGame: Map38EndingMatchScene; warp
function* map38Enter(sh) {
  const w = sh.w;
  yield* map38MatchScene(sh);                                   // 35:5BB3
  wr(w, 0xC441, 0x01);
}
// 35:5BB3 Map38EndingMatchScene: Map38DrawRoom; fade in; champions walk in and face each other (wordless replay of
// the Match Game Event)
function* map38MatchScene(sh) {
  const w = sh.w;
  yield* map38DrawRoom(sh);                                     // 35:5DCC
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  S.actorSetSpeed(w, 0x05, 0x0008);
  S.actorSetSpeed(w, 0x03, 0x0008);
  S.actorSetSpeed(w, 0x02, 0x0008);
  S.actorSetSpeed(w, 0x04, 0x0008);
  S.actorSetSpeed(w, 0x00, 0x0008);
  S.actorPlayAnim(w, 0x05, 0x07);
  yield* S.waitActorAnimDone(sh, 0x05);
  S.actorPlayAnim(w, 0x00, 0x07);
  yield* S.waitActorAnimDone(sh, 0x00);
  yield* wait(sh, 0x0A);
  S.actorSetFacing(w, 0x05, 0x00);
  S.actorMoveTo(w, 0x02, 0x0900, 0x0500);
  yield* wait(sh, 0x14);
  S.actorMoveTo(w, 0x03, 0x0B00, 0x0500);
  yield* wait(sh, 0x14);
  S.actorMoveTo(w, 0x04, 0x0D00, 0x0500);
  yield* wait(sh, 0x14);
  S.actorSetFacing(w, 0x05, 0xC0);
  yield* S.waitActorMoveDone(sh, 0x04);
  S.actorPlayAnim(w, 0x04, 0x07);
  yield* S.waitActorAnimDone(sh, 0x04);
  S.actorPlayAnim(w, 0x05, 0x07);
  yield* S.waitActorAnimDone(sh, 0x05);
  S.actorFaceActor(w, 0x02, 0x05);
  S.actorPlayAnim(w, 0x02, 0x07);
  yield* S.waitActorAnimDone(sh, 0x02);
  S.actorSetFacing(w, 0x05, 0x00);
  yield* wait(sh, 0x0A);
  S.actorFaceActor(w, 0x05, 0x00);
  S.actorFaceActor(w, 0x03, 0x00);
  S.actorFaceActor(w, 0x02, 0x00);
  S.actorFaceActor(w, 0x04, 0x00);
  S.actorPlayAnim(w, 0x03, 0x05);
  yield* S.waitActorAnimDone(sh, 0x03);
  S.actorPlayAnim(w, 0x02, 0x05);
  S.actorPlayAnim(w, 0x04, 0x05);
  yield* S.waitActorAnimDone(sh, 0x04);
  yield* wait(sh, 0x1E);
  S.actorMoveTo(w, 0x05, 0x0700, 0x0700);
  yield* wait(sh, 0x28);
  S.actorFaceActor(w, 0x03, 0x05);
  S.actorFaceActor(w, 0x02, 0x05);
  S.actorFaceActor(w, 0x04, 0x05);
  S.actorMoveTo(w, 0x03, 0x0B00, 0x0700);
  yield* S.waitActorMoveDone(sh, 0x03);
  S.actorFaceActor(w, 0x03, 0x05);
  S.actorFaceActor(w, 0x03, 0x05);
  S.actorFaceActor(w, 0x05, 0x03);
  S.actorFaceActor(w, 0x02, 0x05);
  S.actorSetFacing(w, 0x05, 0xC0);
  S.actorSetFacing(w, 0x04, 0x80);
  S.actorPlayAnim(w, 0x04, 0x07);
  yield* S.waitActorAnimDone(sh, 0x04);
  S.actorPlayAnim(w, 0x05, 0x07);
  yield* S.waitActorAnimDone(sh, 0x05);
  S.actorSetFacing(w, 0x05, 0x00);
  yield* wait(sh, 0x14);
  S.actorSetFacing(w, 0x05, 0x40);
  yield* wait(sh, 0x14);
  S.actorMoveTo(w, 0x05, 0x0700, 0x0500);
  yield* S.waitActorMoveDone(sh, 0x05);
  yield* wait(sh, 0x1E);
}
// 35:5DCC Map38DrawRoom: room tiles (MapBufCopyRectRedraw) and palettes 5D9C
function* map38DrawRoom(sh) {
  const w = sh.w;
  yield* S.waitScriptActorIdle(sh);
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x1A, 0x18, 0x00, 0x00, 0x14, 0x14));
  D.inBank(w, 0x35, () => D.loadPalettesMasterOnly(w, 0x5D9C, 0x02, 0x06));
}
// 35:5E12 Map39EnterEndingField: ending replay of the Field letter event: actors walk; flash 6890; letter (65D4
// 6731); path-open scene 6639; warp
function* map39Enter(sh) {
  const w = sh.w;
  yield* wait(sh, 0x0A);
  Scr.beginFadeIn(w, 0x08);
  S.actorSetSpeed(w, 0x00, 0x0018);
  S.scriptActorSetSpeed(w, 0x0018);
  yield* S.scriptActorGoTo(sh, 0x00, 0x0F00, 0x1B00);
  S.actorMoveTo(w, 0x00, 0x0F00, 0x1B00);
  yield* S.waitActorMoveDone(sh, 0x00);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1D00, 0x1B00);
  S.actorMoveTo(w, 0x00, 0x1D00, 0x1B00);
  yield* S.waitActorMoveDone(sh, 0x00);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1D00, 0x1900);
  S.actorMoveTo(w, 0x00, 0x1D00, 0x1900);
  yield* S.waitActorMoveDone(sh, 0x00);
  S.scriptActorSetSpeed(w, 0x0040);
  yield* map39FlashSparkle(sh);                                 // 35:6890
  map39LoadLetterGfx(w);                                       // 35:65D4
  S.scriptActorSetSpeed(w, 0x0020);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1D00, 0x1900);
  S.actorPlayAnim(w, 0x00, 0x07);
  yield* map39AnimLetterFall(sh);                               // 35:6731
  yield* map39PathOpenScene(sh);                                // 35:6639
  wr(w, 0xC441, 0x01);
}
// 35:6A48 Map3AEnterEndingClouds: ending: actors jump and walk among the clouds; tile animations Map3AAnimRectsA /
// Map3AAnimRectsB; warp 1
function* map3AEnter(sh) {
  const w = sh.w;
  S.actorSetSpeed(w, 0x05, 0x000C);
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  S.actorMoveTo(w, 0x00, 0x0B00, 0x0F00);
  yield* S.waitActorMoveDone(sh, 0x00);
  S.actorJump(w, 0x00, 0xFF80);
  S.actorMoveTo(w, 0x00, 0x0B00, 0x0DC0);
  S.actorSetFacing(w, 0x00, 0xC0);
  yield* wait(sh, 0x05);
  S.actorPlayAnim(w, 0x00, 0x0A);
  yield* wait(sh, 0x14);
  S.actorSetState(w, 0x00, 0x00);
  yield* wait(sh, 0x0F);
  S.actorPlayAnim(w, 0x00, 0x02);
  S.actorSetSpeed(w, 0x05, 0x000C);
  S.actorMoveTo(w, 0x05, 0x0900, 0x1040);
  yield* S.waitActorMoveDone(sh, 0x05);
  S.actorMoveTo(w, 0x05, 0x0B00, 0x1080);
  yield* S.waitActorMoveDone(sh, 0x05);
  yield* wait(sh, 0x0F);
  S.actorSetFacing(w, 0x05, 0xC0);
  yield* S.scriptActorGoTo(sh, 0x00, 0x0B00, 0x0700);
  yield* map3AAnimRectsA(sh);                                   // 35:6B28
  yield* S.waitScriptActorIdle(sh);
  S.actorMoveTo(w, 0x05, 0x0B00, 0x0F00);
  yield* S.waitActorMoveDone(sh, 0x05);
  yield* wait(sh, 0x0A);
  S.actorPlayAnim(w, 0x05, 0x07);
  yield* S.waitActorAnimDone(sh, 0x05);
  yield* map3AAnimRectsB(sh);                                   // 35:6B97
  yield* wait(sh, 0x2D);
  wr(w, 0xC441, 0x01);
}
// 35:6B28 Map3AAnimRectsA: 5 tile rect frames (MapBufCopyRectRedraw) 30 frames apart
function* map3AAnimRectsA(sh) {
  const w = sh.w;
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x15, 0x0B, 0x09, 0x0B, 0x04, 0x04));
  yield* wait(sh, 0x1E);
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x1A, 0x0B, 0x09, 0x0B, 0x04, 0x04));
  yield* wait(sh, 0x1E);
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x1F, 0x0B, 0x09, 0x0B, 0x04, 0x04));
  yield* wait(sh, 0x1E);
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x24, 0x0B, 0x09, 0x0B, 0x04, 0x04));
  yield* wait(sh, 0x1E);
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x29, 0x0B, 0x09, 0x0B, 0x04, 0x04));
  yield* wait(sh, 0x0F);
}
// 35:6B97 Map3AAnimRectsB: second tile rect animation (MapBufCopyRectRedraw)
function* map3AAnimRectsB(sh) {
  const w = sh.w;
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x15, 0x10, 0x09, 0x09, 0x04, 0x06));
  S.actorMoveTo(w, 0x00, 0x0B00, 0x0A80);
  yield* wait(sh, 0x14);
  S.actorSetSpeed(w, 0x00, 0x001A);
  S.actorSetSpeed(w, 0x05, 0x001A);
  S.actorSetState(w, 0x00, 0x02);
  S.actorMoveTo(w, 0x00, 0x0B00, 0x0100);
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x1A, 0x10, 0x09, 0x09, 0x04, 0x06));
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x1F, 0x10, 0x09, 0x09, 0x04, 0x06));
  S.actorLockSpriteFacing(w, 0x05, 0x01);
  S.actorJump(w, 0x05, 0xFF40);
  S.actorMoveTo(w, 0x05, 0x0B00, 0x1200);
  yield* S.waitActorMoveDone(sh, 0x05);
  S.actorSetSpeed(w, 0x00, 0x0010);
  S.actorPlayAnim(w, 0x00, 0x0A);
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x24, 0x10, 0x09, 0x09, 0x04, 0x06));
  yield* wait(sh, 0x05);
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x29, 0x10, 0x09, 0x09, 0x04, 0x06));
  yield* wait(sh, 0x0A);
}
// 35:6CD2 Map3BEnterEndingAzalea: ending: Azalea scene (walks / jumps / anims); warp
function* map3BEnter(sh) {
  const w = sh.w;
  S.scriptActorSetSpeed(w, 0x0010);
  S.actorSetSpeed(w, 0x00, 0x0010);
  Scr.beginFadeIn(w, 0x04);
  yield* Scr.waitFade(sh);
  yield* S.scriptActorGoTo(sh, 0x00, 0x2D00, 0x1F00);
  S.actorMoveTo(w, 0x00, 0x2D00, 0x1F00);
  yield* S.waitActorMoveDone(sh, 0x00);
  yield* wait(sh, 0x3C);
  S.actorSetFacing(w, 0x00, 0x00);
  yield* wait(sh, 0x3C);
  yield* S.scriptActorGoTo(sh, 0x00, 0x3100, 0x1F00);
  S.actorMoveTo(w, 0x00, 0x3100, 0x1C00);
  yield* S.waitActorMoveDone(sh, 0x00);
  yield* wait(sh, 0x28);
  S.actorSetFacing(w, 0x00, 0x00);
  yield* wait(sh, 0x14);
  S.actorSetPos(w, 0x08, 0x3300, 0x1C00);
  S.actorLockSpriteFacing(w, 0x00, 0x01);
  S.actorJump(w, 0x00, 0xFF80);
  S.actorMoveDir(w, 0x00, 0x80, 0x0200);
  yield* S.waitActorMoveDone(sh, 0x00);
  S.actorLockSpriteFacing(w, 0x00, 0x00);
  S.actorMoveDir(w, 0x08, 0x80, 0x0200);
  yield* S.waitActorMoveDone(sh, 0x08);
  S.actorPlayAnim(w, 0x00, 0x07);
  yield* S.waitActorAnimDone(sh, 0x00);
  S.actorPlayAnim(w, 0x08, 0x05);
  yield* S.waitActorAnimDone(sh, 0x08);
  yield* wait(sh, 0x0A);
  wr(w, 0xC441, 0x01);
}
// 35:6E91 Map3CEndingCastleScene: ending at Peach's Castle: actors jump and walk (actor script 70E1); effect sprite
// (a sparkle? Map3CLoadSparkleGfx Map3CAnimSparkle); warp 1 (back to itself)
function* map3CCastleScene(sh) {
  const w = sh.w;
  S.actorSetPos(w, 0x02, 0x1400, 0x0700);
  S.actorSetPos(w, 0x06, 0x1F00, 0x0B00);
  S.actorJump(w, 0x00, 0xFF00);
  yield* wait(sh, 0x02);
  Scr.beginFadeIn(w, 0x04);
  S.actorLockSpriteFacing(w, 0x00, 0x01);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1400, 0x1300);
  yield* wait(sh, 0x02);
  S.actorMoveTo(w, 0x00, 0x1400, 0x0F00);
  yield* S.waitActorMoveDone(sh, 0x00);
  yield* wait(sh, 0x02);
  S.actorJump(w, 0x00, 0xFF80);
  yield* S.waitActorLanded(sh, 0x00);
  S.actorLockSpriteFacing(w, 0x00, 0x00);
  yield* wait(sh, 0x02);
  S.actorJump(w, 0x00, 0xFF80);
  yield* S.waitActorLanded(sh, 0x00);
  yield* wait(sh, 0x14);
  S.actorJump(w, 0x03, 0xFF80);
  yield* S.waitActorLanded(sh, 0x03);
  S.actorMoveTo(w, 0x03, 0x1280, 0x1100);
  yield* S.waitActorMoveDone(sh, 0x03);
  S.actorFaceActor(w, 0x03, 0x00);
  yield* wait(sh, 0x1E);
  S.actorPlayAnim(w, 0x03, 0x05);
  yield* S.waitActorAnimDone(sh, 0x03);
  S.actorFaceActor(w, 0x03, 0x02);
  S.actorLockSpriteFacing(w, 0x03, 0x01);
  yield* S.scriptActorGoToActor(sh, 0x02, 0x00);
  S.actorMoveTo(w, 0x03, 0x1100, 0x1300);
  yield* S.waitActorMoveDone(sh, 0x03);
  S.actorLockSpriteFacing(w, 0x03, 0x00);
  S.actorPlayAnim(w, 0x02, 0x05);
  yield* S.waitActorAnimDone(sh, 0x02);
  yield* wait(sh, 0x0A);
  S.actorFaceActor(w, 0x00, 0x02);
  S.actorPlayAnim(w, 0x00, 0x05);
  yield* S.waitActorAnimDone(sh, 0x00);
  yield* wait(sh, 0x0A);
  S.actorPlayAnim(w, 0x02, 0x07);
  yield* S.waitActorAnimDone(sh, 0x02);
  S.actorMoveTo(w, 0x02, 0x1400, 0x0A00);
  yield* S.waitActorMoveDone(sh, 0x02);
  S.actorSetFacing(w, 0x02, 0x80);
  yield* wait(sh, 0x1E);
  S.actorSetFacing(w, 0x02, 0x40);
  yield* wait(sh, 0x1E);
  S.actorSetFacing(w, 0x02, 0x00);
  yield* wait(sh, 0x1E);
  S.actorSetFacing(w, 0x02, 0x40);
  yield* S.scriptActorGoToActor(sh, 0x00, 0x00);
  yield* S.waitScriptActorIdle(sh);
  S.actorPlayAnim(w, 0x02, 0x05);
  yield* S.waitActorAnimDone(sh, 0x02);
  S.actorPlayAnim(w, 0x0C, 0x07);
  yield* S.waitActorAnimDone(sh, 0x0C);
  S.actorSetFacing(w, 0x00, 0x80);
  S.actorMoveTo(w, 0x0C, 0x1000, 0x0F00);
  yield* S.waitActorMoveDone(sh, 0x0C);
  S.actorPlayAnim(w, 0x0C, 0x06);
  yield* S.waitActorAnimDone(sh, 0x0C);
  yield* map3CYoshi(sh);
}
// 35:7045 the castle replay's Yoshi part (also entrance $0A's): the effect's tiles (35:7122), Yoshi's hops, his
// script 35:70E1 and the sparkles (35:716F), actor $0F placed, warp 1
function* map3CYoshi(sh) {
  const w = sh.w;
  map3CLoadSparkleGfx(w);                                      // 35:7122
  S.actorJump(w, 0x0A, 0xFF80);
  S.actorMoveTo(w, 0x0A, 0x1800, 0x1000);
  yield* S.waitActorMoveDone(sh, 0x0A);
  S.actorPlayAnim(w, 0x0A, 0x07);
  yield* S.waitActorAnimDone(sh, 0x0A);
  S.actorSetScript(w, 0x0A, 0x70E1, 0x35);
  yield* map3CAnimSparkle(sh);                                  // 35:716F
  S.actorPlayAnim(w, 0x0A, 0x06);
  yield* S.waitActorAnimDone(sh, 0x0A);
  S.actorPlayAnim(w, 0x0A, 0x06);
  S.actorJump(w, 0x0A, 0xFF80);
  yield* S.waitActorLanded(sh, 0x0A);
  S.actorPlayAnim(w, 0x0A, 0x07);
  yield* map3CAnimSparkle(sh);                                  // 35:716F
  yield* wait(sh, 0x0A);
  S.actorPlayAnim(w, 0x0A, 0x06);
  yield* map3CAnimSparkle(sh);                                  // 35:716F
  yield* wait(sh, 0x0A);
  S.actorSetPos(w, 0x0F, 0x1800, 0x0E00);
  S.actorPlayAnim(w, 0x0F, 0x00);
  yield* wait(sh, 0x02);
  wr(w, 0xC441, 0x01);
}
// 35:73F7 Map3DEnterEndingClubhouse: ending: player walks a 7-leg route through the clubhouse (ScriptActorGoTo); warp
// 1
function* map3DEnter(sh) {
  const w = sh.w;
  Scr.beginFadeIn(w, 0x08);
  S.actorSetSpeed(w, 0x00, 0x0018);
  S.scriptActorSetSpeed(w, 0x0018);
  S.actorMoveTo(w, 0x00, 0x1A00, 0x1C00);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1A00, 0x1C00);
  yield* S.waitScriptActorIdle(sh);
  S.actorMoveTo(w, 0x00, 0x1C00, 0x1C00);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1C00, 0x1C00);
  yield* S.waitScriptActorIdle(sh);
  S.actorMoveTo(w, 0x00, 0x1C00, 0x1600);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1C00, 0x1600);
  yield* S.waitScriptActorIdle(sh);
  S.actorMoveTo(w, 0x00, 0x2600, 0x1600);
  yield* S.scriptActorGoTo(sh, 0x00, 0x2600, 0x1600);
  yield* S.waitScriptActorIdle(sh);
  S.actorMoveTo(w, 0x00, 0x2600, 0x0F00);
  yield* S.scriptActorGoTo(sh, 0x00, 0x2600, 0x0F00);
  yield* S.waitScriptActorIdle(sh);
  S.actorMoveTo(w, 0x00, 0x2600, 0x0700);
  yield* S.scriptActorGoTo(sh, 0x00, 0x2600, 0x0800);
  yield* S.waitScriptActorIdle(sh);
  S.actorMoveTo(w, 0x00, 0x2A00, 0x0700);
  yield* S.scriptActorGoTo(sh, 0x00, 0x2A00, 0x0800);
  yield* S.waitScriptActorIdle(sh);
  wr(w, 0xC441, 0x01);
}
// 35:7525 Map3EEnterEndingField: ending: player walks an 8-leg route across the Field; warp 1
function* map3EEnter(sh) {
  const w = sh.w;
  Scr.beginFadeIn(w, 0x08);
  S.actorSetSpeed(w, 0x00, 0x0018);
  S.scriptActorSetSpeed(w, 0x0018);
  S.actorMoveTo(w, 0x00, 0x0500, 0x2F00);
  yield* S.scriptActorGoTo(sh, 0x00, 0x0500, 0x2F00);
  yield* S.waitScriptActorIdle(sh);
  S.actorMoveTo(w, 0x00, 0x0B00, 0x2F00);
  yield* S.scriptActorGoTo(sh, 0x00, 0x0B00, 0x2F00);
  yield* S.waitScriptActorIdle(sh);
  S.actorMoveTo(w, 0x00, 0x0B00, 0x2700);
  yield* S.scriptActorGoTo(sh, 0x00, 0x0B00, 0x2700);
  yield* S.waitScriptActorIdle(sh);
  S.actorMoveTo(w, 0x00, 0x0F00, 0x2700);
  yield* S.scriptActorGoTo(sh, 0x00, 0x0F00, 0x2700);
  yield* S.waitScriptActorIdle(sh);
  S.actorMoveTo(w, 0x00, 0x0F00, 0x2500);
  yield* S.scriptActorGoTo(sh, 0x00, 0x0F00, 0x2500);
  yield* S.waitScriptActorIdle(sh);
  S.actorMoveTo(w, 0x00, 0x1900, 0x2500);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1900, 0x2500);
  yield* S.waitScriptActorIdle(sh);
  S.actorMoveTo(w, 0x00, 0x1900, 0x2700);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1900, 0x2700);
  yield* S.waitScriptActorIdle(sh);
  S.actorMoveTo(w, 0x00, 0x1C00, 0x2700);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1C00, 0x2A00);
  yield* S.waitScriptActorIdle(sh);
  wr(w, 0xC441, 0x01);
}

// 35:466A Map32Trigger01LoungeTour (from the enter script 35:479A): the player led round the Lounge at speed $18;
// with #189 nothing more; else the hand ($C4B3 = 0; LoadCursorSprite 01:4289 to $87C0, OBJ palette 0), the palettes
// restored (00:05DD), the hand's task 35:4666, $01EE set (and skipped past when the four clubs are won), the
// members' turns and steps, the player to ($0A00, $0D00), the task removed
function* map32LoungeTour(sh) {
  const w = sh.w;
  S.actorSetSpeed(w, 0x00, 0x0018);
  S.scriptActorSetSpeed(w, 0x0018);
  for (const [x, y] of [[0x1800, 0x1900], [0x1500, 0x1900], [0x1500, 0x1600], [0x0B00, 0x1600], [0x0B00, 0x1400]]) {
    S.actorMoveTo(w, 0x00, x, y);
    yield* S.scriptActorGoTo(sh, 0x00, x, y);
    yield* S.waitScriptActorIdle(sh);
  }
  if (flag(w, 189)) return;
  wr(w, 0xC4B3, 0x00);
  loadCursorSprite(w, 0x87C0, 0x00);                              // 01:4289
  D.restorePalettesFromMaster(w);                                 // 00:05DD
  registerFrameTask(w, 0x0F, 0x35, 0x4666);
  T.scriptSetText(w, 0x01EE);
  S.scriptActorSetSpeed(w, 0x0020);
  S.actorSetFacing(w, 0x06, 0xC0);
  S.actorPlayAnim(w, 0x06, 0x07);
  yield* S.waitActorAnimDone(sh, 0x06);
  yield* wait(sh, 0x0A);
  S.actorSetFacing(w, 0x00, 0x40);
  S.actorSetFacing(w, 0x05, 0xC0);
  yield* wait(sh, 0x0A);
  S.actorMoveDir(w, 0x05, 0xC0, 0x0200);
  yield* S.waitActorMoveDone(sh, 0x05);
  yield* wait(sh, 0x0A);
  if (flag(w, 136) && flag(w, 137) && flag(w, 138) && flag(w, 139)) T.scriptSkipText(w);
  yield* wait(sh, 0x1E);
  yield* S.scriptActorGoTo(sh, 0x00, 0x0A00, 0x0D00);
  yield* S.waitScriptActorIdle(sh);
  unregisterFrameTask(w, 0x35, 0x4666);
}
// 35:47BF Map32PointerSpriteTask (the task 35:4666): the hand (tile $7C) at 35:47AB's entry $C4B3 (x, y, attributes),
// bobbing with wFrameCounter / 2 & 7 (the other way with attribute bit 5); no sound
function map32PointerSpriteTask(w) {
  const t = 0x47AB + ((rd(w, 0xC4B3) << 2) & 0xFF);
  const b = rb(0x35, t + 2);
  const fc = rd(w, 0xC4B2);
  let o = ((fc >> 1) | (fc << 7)) & 0x07;
  if (b & 0x20) o = ~o & 0xFF;
  const d = (o + rb(0x35, t)) & 0xFF;
  const e = ((((fc >> 1) | (fc << 7)) & 0x07) + 0x08 + rb(0x35, t + 1)) & 0xFF;
  if (w.vram) D.queueSprite16(w, e, d, 0x7C, b);                // 00:26A4
}
// 35:48E6 Map33EnterEndingOffice: entrance 1 / 2 / 3 -> 35:492C / 4AE5 / 4B7D
function* map33Enter(sh) {
  const e = rd(sh.w, 0xC46A);
  if (e === 0x01) yield* map33Scene1(sh);
  else if (e === 0x02) yield* map33Scene2(sh);
  else if (e === 0x03) yield* map33Scene3(sh);
}
// 35:492C Map33EndingScene1: the room (35:4D9F), fade in (4), the Caddie Master (7) at ($1D00, $0B00); on map $08
// (a leftover of the real office: never in the ending) the golfers put in a row; else the waiting group's walk
// (actor 4 with the script 35:7B22), the player to the counter; then the group walks out with the scripts 35:48F9,
// 170 frames, warp 1
function* map33Scene1(sh) {
  const w = sh.w;
  yield* map33DrawRoom1(sh);                                      // 35:4D9F
  Scr.beginFadeIn(w, 0x04);
  yield* Scr.waitFade(sh);
  S.actorSetPos(w, 0x07, 0x1D00, 0x0B00);
  if (rd(w, 0xC450) === 0x08) {
    S.actorSetPos(w, 0x02, 0x1500, 0x0D80);
    S.actorSetPos(w, 0x03, 0x1700, 0x0D80);
    S.actorSetPos(w, 0x04, 0x1B00, 0x0D80);
    S.actorSetPos(w, 0x05, 0x1900, 0x0D80);
    S.actorSetPos(w, 0x0B, 0x3F00, 0x3F00);
  } else {
    S.actorLockSpriteFacing(w, 0x00, 0x01);                       // 35:4987
    S.actorMoveDir(w, 0x00, 0x40, 0x0280);
    yield* S.waitActorMoveDone(sh, 0x00);
    S.actorSetScript(w, 0x04, 0x7B22, 0x35);
    yield* wait(sh, 0x01);
    S.actorSetSpeed(w, 0x02, 0x0010);
    S.actorSetSpeed(w, 0x03, 0x0010);
    S.actorSetSpeed(w, 0x04, 0x0010);
    S.actorSetSpeed(w, 0x05, 0x0010);
    yield* wait(sh, 0x01);
    S.actorMoveTo(w, 0x02, 0x1580, 0x0D80);
    S.actorMoveDir(w, 0x03, 0xC0, 0x0200);
    yield* S.waitActorMoveDone(sh, 0x03);
    S.actorMoveTo(w, 0x03, 0x1700, 0x0D80);
    S.actorMoveTo(w, 0x04, 0x1A00, 0x0D80);
    S.actorMoveTo(w, 0x05, 0x1880, 0x0D80);
    yield* S.waitActorMoveDone(sh, 0x05);
    S.actorLockSpriteFacing(w, 0x00, 0x00);
    yield* wait(sh, 0x0F);
    S.actorMoveTo(w, 0x00, 0x0900, 0x0D00);
    yield* S.waitActorMoveDone(sh, 0x00);
  }
  S.actorPlayAnim(w, 0x00, 0x05);                                 // 35:4A34
  yield* wait(sh, 0x1E);
  S.actorSetPos(w, 0x04, 0x3F00, 0x3F00);
  S.scriptActorSetSpeed(w, 0x0040);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1900, 0x0B00);
  yield* S.waitActorMoveDone(sh, 0x02);
  S.actorSetFacing(w, 0x02, 0x00);
  S.actorSetFacing(w, 0x03, 0x00);
  S.actorSetFacing(w, 0x04, 0x00);
  S.actorSetFacing(w, 0x05, 0x00);
  S.actorSetSpeed(w, 0x00, 0x000D);
  S.actorMoveTo(w, 0x00, 0x1280, 0x0D80);
  yield* S.waitActorMoveDone(sh, 0x00);
  S.actorSetScript(w, 0x05, 0x48F9, 0x35);
  yield* wait(sh, 0x01);
  S.actorSetScript(w, 0x03, 0x48F9, 0x35);
  yield* wait(sh, 0x01);
  S.actorSetScript(w, 0x02, 0x48F9, 0x35);
  yield* wait(sh, 0x01);
  S.actorSetScript(w, 0x00, 0x48F9, 0x35);
  yield* wait(sh, 0xAA);
  wr(w, 0xC441, 0x01);
}
// 35:5117 Map34SetClubByMapId: SetTextCourseIndex 05:57C3 = 4 / 3 / 2 for maps $1B / $1A / $19, else 1
function map34SetClubByMapId(w) {
  const m = rd(w, 0xC450);
  D.inBank(w, 0x05, () => setTextCourseIndex(w, m === 0x1B ? 4 : m === 0x1A ? 3 : m === 0x19 ? 2 : 1));
}
// 35:4F51 Map34AwardCeremony (wordless here: the texts $0C3C, $0C3E on map $18, $0C3F are set, not shown): the
// player led in, fade in (4), the champion's looks round, the crowd (actors 2-5) walk in (35:5011), warp 1
function* map34AwardCeremony(sh) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  yield* S.scriptActorGoTo(sh, 0x00, 0x0B00, 0x0E00);
  yield* S.waitScriptActorIdle(sh);
  Scr.beginFadeIn(w, 0x04);
  yield* Scr.waitFade(sh);
  T.scriptSetText(w, 0x0C3C);
  map34SetClubByMapId(w);                                         // 35:5117
  yield* wait(sh, 0x14);
  S.actorPlayAnim(w, 0x00, 0x07);
  yield* S.waitActorAnimDone(sh, 0x00);
  S.actorSetFacing(w, 0x02, 0x40);
  yield* wait(sh, 0x1E);
  S.actorSetFacing(w, 0x02, 0x80);
  yield* wait(sh, 0x1E);
  S.actorSetFacing(w, 0x02, 0x40);
  yield* wait(sh, 0x0A);
  S.actorSetFacing(w, 0x02, 0x00);
  yield* wait(sh, 0x1E);
  S.actorSetFacing(w, 0x02, 0x40);
  if (rd(w, 0xC450) === 0x18) T.scriptSetText(w, 0x0C3E);
  T.scriptSetText(w, 0x0C3F);
  S.actorSetFacing(w, 0x00, 0x80);
  yield* wait(sh, 0x14);
  S.actorSetFacing(w, 0x00, 0x00);
  yield* wait(sh, 0x14);
  S.actorSetFacing(w, 0x00, 0x40);
  yield* wait(sh, 0x14);
  S.actorFaceActor(w, 0x02, 0x00);
  yield* wait(sh, 0x14);
  S.actorSetSpeed(w, 0x02, 0x0008);                               // 35:5011 Map34CeremonyActorsWalkIn
  S.actorSetSpeed(w, 0x03, 0x0008);
  S.actorSetSpeed(w, 0x04, 0x0008);
  S.actorSetSpeed(w, 0x05, 0x0008);
  S.actorSetFacing(w, 0x02, 0x80);
  S.actorMoveTo(w, 0x02, 0x0A00, 0x0F00);
  yield* S.waitActorMoveDone(sh, 0x02);
  S.actorMoveTo(w, 0x03, 0x0A80, 0x0E00);
  S.actorMoveTo(w, 0x04, 0x0A80, 0x0E00);
  S.actorMoveTo(w, 0x05, 0x0A80, 0x0E00);
  yield* wait(sh, 0x14);
  S.actorLockSpriteFacing(w, 0x02, 0x01);
  S.actorMoveTo(w, 0x02, 0x0A80, 0x0F00);
  yield* S.waitActorMoveDone(sh, 0x02);
  S.actorLockSpriteFacing(w, 0x02, 0x00);
  S.actorSetFacing(w, 0x02, 0xC0);
  S.actorMoveTo(w, 0x03, 0x0B40, 0x0C00);
  S.actorMoveTo(w, 0x04, 0x0B40, 0x0C00);
  S.actorMoveTo(w, 0x05, 0x0B40, 0x0C00);
  S.actorMoveTo(w, 0x02, 0x0B00, 0x0C80);
  yield* S.waitActorMoveDone(sh, 0x02);
  S.actorFaceActor(w, 0x02, 0x00);
  yield* wait(sh, 0x14);
  wr(w, 0xC441, 0x01);
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}
// 35:54B2 Map35EnterEndingTinyTots: entrance 2: Sherry's scene (35:54BD); else the caretaker (35:5352)
function* map35Enter(sh) {
  const w = sh.w;
  if (rd(w, 0xC46A) !== 0x02) { yield* map35CaretakerScene(sh); return; }
  S.actorSetState(w, 0x02, 0x00);
  S.scriptActorSetSpeed(w, 0x0010);
  S.actorSetSpeed(w, 0x00, 0x0010);
  Scr.beginFadeIn(w, 0x04);
  yield* S.scriptActorGoTo(sh, 0x00, 0x2500, 0x1F00);
  S.actorMoveTo(w, 0x00, 0x2900, 0x2100);
  yield* S.waitActorMoveDone(sh, 0x00);
  S.actorSetFacing(w, 0x00, 0x00);
  yield* wait(sh, 0x0A);
  S.actorSetFacing(w, 0x00, 0x80);
  yield* wait(sh, 0x14);
  S.actorMoveTo(w, 0x00, 0x2500, 0x1900);
  yield* S.waitActorMoveDone(sh, 0x00);
  S.actorSetPos(w, 0x03, 0x2500, 0x1700);
  S.actorLockSpriteFacing(w, 0x00, 0x01);
  S.actorJump(w, 0x00, 0xFF80);
  S.actorMoveDir(w, 0x00, 0x40, 0x0200);
  yield* S.waitActorMoveDone(sh, 0x00);
  S.actorLockSpriteFacing(w, 0x00, 0x00);
  S.actorJump(w, 0x03, 0xFF80);
  S.actorMoveDir(w, 0x03, 0x40, 0x0200);
  yield* S.waitActorMoveDone(sh, 0x03);
  S.actorPlayAnim(w, 0x00, 0x07);
  yield* S.waitActorAnimDone(sh, 0x00);
  S.actorPlayAnim(w, 0x03, 0x05);
  yield* S.waitActorAnimDone(sh, 0x03);
  yield* wait(sh, 0x0A);
  wr(w, 0xC441, 0x01);
}
// 35:5921 Map36LoadCrowGfx: the crow's tiles 35:58D0 (4 blocks) to VRAM0 $8400, OBJ palette 7 from 35:5919 (master
// only)
function map36LoadCrowGfx(w) {
  if (w.vram) w.lcd.vbk = 0;
  D.inBank(w, 0x35, () => {
    D.queueVRAMCopy(w, 0x58D0, 0x8400, 0x04);
    D.loadPalettesMasterOnly(w, 0x5919, 0x0F, 0x01);
  });
}
// 35:5939 Map36DrawHatSprite (copy of 34:72F9): the hat 35:5910 at the map's ($1FA0, $1C60) less the scroll (<< 3,
// the high bytes); quirk kept: the on-screen tests' results are computed and not used, so it is always queued
function map36DrawHatSprite(w, b, c) {
  const x = ((((0x1FA0 - (rd(w, 0xC320) | rd(w, 0xC321) << 8)) & 0xFFFF) << 3) & 0xFFFF) >> 8;
  const y = ((((0x1C60 - (rd(w, 0xC322) | rd(w, 0xC323) << 8)) & 0xFFFF) << 3) & 0xFFFF) >> 8;
  D.inBank(w, 0x35, () => D.queueSpriteTemplate(w, 0x5910, y, x, c, b));
}
// 35:56BD Map36EnterEndingRavenWoods: entrance 2: Joe's scene (35:55F5); else the crow (actor 4, script 35:5808)
// and the golfer (3, script 35:581A) at the pin, the crow's tiles (35:5921), the hat dropped (35:56FF)
function* map36Enter(sh) {
  const w = sh.w;
  if (rd(w, 0xC46A) === 0x02) { yield* map36SceneJoe(sh); return; }
  S.actorSetPos(w, 0x04, 0x2000, 0x1C80);
  S.actorSetPos(w, 0x03, 0x2000, 0x1D00);
  S.actorSetScript(w, 0x04, 0x5808, 0x35);
  S.actorSetScript(w, 0x03, 0x581A, 0x35);
  map36LoadCrowGfx(w);                                            // 35:5921
  yield* map36CrowDropsHat(sh);                                   // 35:56FF
}
// 35:56FF Map36CrowDropsHat: the golfer (2) placed, 10 frames, fade in (8), the hat's task 35:56F8, $1524 set, 5
// frames, actor 3's +$15 = 3 (through ActorSlotAddr 0A:42E0 and whatever WRAM bank is mapped), the crow's and the
// golfer's scripts 35:5832 / 35:57FF, the player led up, the golfer's dance and walk off, warp 1
function* map36CrowDropsHat(sh) {
  const w = sh.w;
  S.actorSetPos(w, 0x02, 0x1D00, 0x2500);
  yield* wait(sh, 0x0A);
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  registerFrameTask(w, 0x04, 0x35, 0x56F8);
  T.scriptSetText(w, 0x1524);
  yield* wait(sh, 0x05);
  const hl = A.actorSlotAddr(0x03);
  if (hl >> 8) wr(w, (hl + 0x15) & 0xFFFF, 0x03);
  S.actorSetScript(w, 0x03, 0x5832, 0x35);
  S.actorSetScript(w, 0x04, 0x57FF, 0x35);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1F00, 0x2000);
  S.actorSetFacing(w, 0x00, 0x80);
  yield* wait(sh, 0x64);
  S.actorPlayAnim(w, 0x02, 0x07);
  yield* S.waitActorAnimDone(sh, 0x02);
  S.actorPlayAnim(w, 0x02, 0x07);
  yield* S.waitActorAnimDone(sh, 0x02);
  yield* wait(sh, 0x0A);
  S.actorFaceActor(w, 0x02, 0x00);
  yield* wait(sh, 0x0A);
  S.actorMoveTo(w, 0x02, 0x1D00, 0x2100);
  yield* S.waitActorMoveDone(sh, 0x02);
  S.actorFaceActor(w, 0x02, 0x00);
  S.actorFaceActor(w, 0x00, 0x02);
  S.actorPlayAnim(w, 0x02, 0x05);
  yield* S.waitActorAnimDone(sh, 0x02);
  yield* wait(sh, 0x0A);
  S.actorSetFacing(w, 0x02, 0x00);
  S.actorPlayAnim(w, 0x02, 0x05);
  yield* S.waitActorAnimDone(sh, 0x02);
  yield* wait(sh, 0x0A);
  S.actorMoveTo(w, 0x02, 0x1B00, 0x1C00);
  yield* S.waitActorMoveDone(sh, 0x02);
  wr(w, 0xC441, 0x01);
}
// 35:5A0B Map37EnterEndingAltGame: the Dune pair asks the player to team up (texts $152C on, set, not shown); "Which
// rules?" with its menu call removed: $1809 loaded, then $180B set and the $180A branch jumped over; warp 1 (the
// code after it, 35:5B04-5B4F, is never reached)
function* map37Enter(sh) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  S.actorSetSpeed(w, 0x00, 0x0010);
  S.scriptActorSetSpeed(w, 0x0010);
  Scr.beginFadeIn(w, 0x08);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1D00, 0x1600);
  S.actorMoveTo(w, 0x00, 0x1D00, 0x1380);
  yield* S.waitActorMoveDone(sh, 0x00);
  S.actorFaceActor(w, 0x08, 0x00);
  S.actorPlayAnim(w, 0x08, 0x07);
  yield* S.waitActorAnimDone(sh, 0x08);
  S.actorFaceActor(w, 0x09, 0x00);
  S.actorFaceActor(w, 0x0A, 0x00);
  T.scriptSetText(w, 0x152C);
  S.actorFaceActor(w, 0x00, 0x08);
  yield* wait(sh, 0x0A);
  T.scriptSkipText(w);
  yield* wait(sh, 0x0A);
  T.scriptSkipText(w);
  S.actorJump(w, 0x08, 0xFF80);
  yield* S.waitActorLanded(sh, 0x08);
  S.actorsFaceEachOther(w, 0x0A, 0x09);
  S.actorPlayAnim(w, 0x0A, 0x07);
  yield* S.waitActorAnimDone(sh, 0x0A);
  S.actorPlayAnim(w, 0x09, 0x05);
  yield* S.waitActorAnimDone(sh, 0x09);
  T.scriptSetText(w, 0x1808);
  yield* wait(sh, 0x14);
  T.scriptSetText(w, 0x180B);
  S.actorPlayAnim(w, 0x0A, 0x05);                                 // 35:5AD2
  yield* S.waitActorAnimDone(sh, 0x0A);
  S.actorSetFacing(w, 0x08, 0xC0);
  S.actorPlayAnim(w, 0x08, 0x05);
  S.actorPlayAnim(w, 0x09, 0x05);
  yield* S.waitActorAnimDone(sh, 0x09);
  wr(w, 0xC441, 0x01);
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}

// ---- map $39: the letter's replay (copies of bank 34's routines with bank 35's tiles and templates; the flying
// and the sparkle without their sounds, the path without its flag test) ----
const spritePos35 = (w, base, t, scroll) => {
  const hl = ((((base + t) & 0xFFFF) << 5) - (rd(w, scroll) | rd(w, scroll + 1) << 8)) & 0xFFFF;
  return ((hl << 3) >> 8) & 0xFF;
};
// 35:65D4 Map39LoadLetterSpriteGfx: the tiles 35:5EB0 ($0C) to VRAM0 $8100, palettes 35:65CC (2 from OBJ 2)
function map39LoadLetterGfx(w) {
  if (w.vram) w.lcd.vbk = 0;
  D.inBank(w, 0x35, () => { D.queueVRAMCopy(w, 0x5EB0, 0x8100, 0x0C); D.loadPalettesImmediate(w, 0x65CC, 0x0A, 0x02); });
}
// 35:65EC Map39LoadMarkerSpriteGfx: the tiles 35:5F70 ($60) to VRAM0 $8100, palettes 35:65BC (2 from OBJ 2)
function map39LoadMarkerGfx(w) {
  if (w.vram) w.lcd.vbk = 0;
  D.inBank(w, 0x35, () => { D.queueVRAMCopy(w, 0x5F70, 0x8100, 0x60); D.loadPalettesImmediate(w, 0x65BC, 0x0A, 0x02); });
}
// 35:6604 Map39DrawMarkerSpriteFrames: the marker 35:6570 at the map's ($1300, $1080) for 10 frames
function* map39DrawMarkerFrames(sh, b, c) {
  const w = sh.w;
  for (let h = 0x0A; h; h--) {
    const x = (0x1300 - (rd(w, 0xC320) | rd(w, 0xC321) << 8)) & 0xFFFF;
    const y = (0x1080 - (rd(w, 0xC322) | rd(w, 0xC323) << 8)) & 0xFFFF;
    D.inBank(w, 0x35, () => D.queueSpriteTemplate(w, 0x6570, ((y << 3) >> 8) & 0xFF, ((x << 3) >> 8) & 0xFF, c, b));
    yield* sh.advance();
  }
}
// 35:66A5 Map39DrawMarkerSprite (the task 35:69DB, bc = $0230): the marker when on screen
function map39DrawMarkerSprite(w, b, c) {
  const x = (0x1300 - (rd(w, 0xC320) | rd(w, 0xC321) << 8)) & 0xFFFF;
  if ((((x >> 8) + 4) & 0xFF) >= 0x16) return;
  const y = (0x1080 - (rd(w, 0xC322) | rd(w, 0xC323) << 8)) & 0xFFFF;
  if ((((y >> 8) + 2) & 0xFF) >= 0x14) return;
  D.inBank(w, 0x35, () => D.queueSpriteTemplate(w, 0x6570, ((y << 3) >> 8) & 0xFF, ((x << 3) >> 8) & 0xFF, c, b));
}
// 35:66E2 Map39DrawLetterSprite: the letter 35:6581 at ($B8 + t, $80 + t) for 12 frames
function* map39DrawLetterSprite(sh, b, c) {
  const w = sh.w;
  for (let h = 0x0C; h; h--) {
    const t = rd(w, 0xC3E2);
    D.inBank(w, 0x35, () => D.queueSpriteTemplate(w, 0x6581, spritePos35(w, 0x80, t, 0xC322), spritePos35(w, 0xB8, t, 0xC320), c, b));
    yield* sh.advance();
  }
}
// 35:6731 Map39AnimLetterFall: as 34:512E
function* map39AnimLetterFall(sh) {
  const w = sh.w;
  wr(w, 0xC3E2, 0x00);
  for (;;) {
    yield* map39DrawLetterSprite(sh, 0x02, 0x10);
    if (rd(w, 0xC3E2) >= 0x28) return;
    wr(w, 0xC3E2, (rd(w, 0xC3E2) + 2) & 0xFF);
    yield* map39DrawLetterSprite(sh, 0x02, 0x14);
    wr(w, 0xC3E2, (rd(w, 0xC3E2) + 1) & 0xFF);
    yield* map39DrawLetterSprite(sh, 0x02, 0x18);
    wr(w, 0xC3E2, (rd(w, 0xC3E2) + 2) & 0xFF);
    yield* map39DrawLetterSprite(sh, 0x02, 0x14);
  }
}
// 35:676D Map39DrawFlyingSprite: the sprite 35:658A at ($E0 + $C3E1, $24 + $C3E2) for 2 frames
function* map39DrawFlyingSprite(sh, b, c) {
  const w = sh.w;
  for (let h = 0x02; h; h--) {
    D.inBank(w, 0x35, () => D.queueSpriteTemplate(w, 0x658A, spritePos35(w, 0x24, rd(w, 0xC3E2), 0xC322), spritePos35(w, 0xE0, rd(w, 0xC3E1), 0xC320), c, b));
    yield* sh.advance();
  }
}
// 35:67BC Map39AnimFlyingSprite: as 34:51B9 without its sounds and closing wait (the second step moves $C3E1 before
// $C3E2, to the same effect)
function* map39AnimFlyingSprite(sh) {
  const w = sh.w;
  wr(w, 0xC3E2, 0x00); wr(w, 0xC3E1, 0x00);
  const step = () => { wr(w, 0xC3E2, (rd(w, 0xC3E2) + 3) & 0xFF); wr(w, 0xC3E1, (rd(w, 0xC3E1) + 0xFE) & 0xFF); };
  while (rd(w, 0xC3E2) < 0x5A) {
    step(); yield* map39DrawFlyingSprite(sh, 0x02, 0x38);
    step(); yield* map39DrawFlyingSprite(sh, 0x02, 0x48);
    step(); yield* map39DrawFlyingSprite(sh, 0x02, 0x58);
  }
}
// 35:6960 Map39DrawBurstSprite: the sprite 35:65AB at ($A0, $90) for 5 frames
function* map39DrawBurstSprite(sh, b, c) {
  const w = sh.w;
  for (let h = 0x05; h; h--) {
    D.inBank(w, 0x35, () => D.queueSpriteTemplate(w, 0x65AB, spritePos35(w, 0x90, 0, 0xC322), spritePos35(w, 0xA0, 0, 0xC320), c, b));
    yield* sh.advance();
  }
}
// 35:68F6 Map39AnimBurstSprite: as 34:5396
function* map39AnimBurstSprite(sh) {
  const w = sh.w;
  wr(w, 0xC3E2, 0x00); wr(w, 0xC3E1, 0x00);
  const step = () => { wr(w, 0xC3E2, (rd(w, 0xC3E2) + 3) & 0xFF); wr(w, 0xC3E1, (rd(w, 0xC3E1) + 0xFE) & 0xFF); };
  while (rd(w, 0xC3E2) < 0x10) {
    for (const c of [0x68, 0x6A, 0x6C, 0x6E]) { step(); yield* map39DrawBurstSprite(sh, 0x03, c); }
  }
}
// 35:6890 Map39FlashPaletteSparkle: as 34:52C0 without its sounds: BG palette 2 from 35:6860, then 35:6820 / 6828 /
// 6830 / 6838, 5 frames each, five times, 35:6860 once more
function* map39FlashSparkle(sh) {
  const w = sh.w;
  const pal = hl => D.inBank(w, 0x35, () => D.loadPalettesImmediate(w, hl, 0x02, 0x01));
  wr(w, 0xC3E0, 0x00);
  for (;;) {
    pal(0x6860);
    yield* wait(sh, 0x05);
    if (rd(w, 0xC3E0) === 0x05) return;
    for (const hl of [0x6820, 0x6828, 0x6830, 0x6838]) { pal(hl); yield* wait(sh, 0x05); }
    wr(w, 0xC3E0, (rd(w, 0xC3E0) + 1) & 0xFF);
  }
}
// 35:6639 Map39PathOpenScene: no name banner, the marker's tiles, the player to ($1900, $1380) at speed $40, fade in
// (4), the flying sprite, the burst, the path (35:69AD: terrain, events and tiles of 2 x $0A from ($2C, 7) to ($14,
// $11)), the event cells ($1C $1A to $1C $18, 2 x 2), fade in (8), the burst, the marker's frames $10 / $18 / $20 /
// $28, its task 35:69DB, 60 frames
function* map39PathOpenScene(sh) {
  const w = sh.w;
  wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0);
  map39LoadMarkerGfx(w);                                          // 35:65EC
  S.scriptActorSetSpeed(w, 0x0040);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1900, 0x1380);
  yield* S.waitScriptActorIdle(sh);
  Scr.beginFadeIn(w, 0x04);
  yield* Scr.waitFade(sh);
  yield* map39AnimFlyingSprite(sh);
  yield* map39AnimBurstSprite(sh);
  mapCopyTerrainRect(w, 0x2C, 0x07, 0x14, 0x11, 0x02, 0x0A);     // 35:69AD Map39OpenCastlePath
  mapCopyEventRect(w, 0x2C, 0x07, 0x14, 0x11, 0x02, 0x0A);
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x2C, 0x07, 0x14, 0x11, 0x02, 0x0A));
  mapCopyEventRect(w, 0x1C, 0x1A, 0x1C, 0x18, 0x02, 0x02);
  Scr.beginFadeIn(w, 0x08);
  yield* map39AnimBurstSprite(sh);
  for (const c of [0x10, 0x18, 0x20, 0x28]) yield* map39DrawMarkerFrames(sh, 0x02, c);
  registerFrameTask(w, 0x01, 0x35, 0x69DB);
  yield* wait(sh, 0x3C);
}

// ---- map $3C: the castle's replay; its Yoshi effect (copies of 33:6E5D / 6E75 / 6EAA with bank 35's tiles) ----
// 35:6E7E Map3CEnterEndingCastle: entrance $0A: fade in (4) and the Yoshi part (35:7045); else 35:6E91
function* map3CEnter(sh) {
  const w = sh.w;
  if (rd(w, 0xC46A) !== 0x0A) { yield* map3CCastleScene(sh); return; }
  Scr.beginFadeIn(w, 0x04);
  yield* Scr.waitFade(sh);
  yield* map3CYoshi(sh);
}
// 35:7122 Map3CLoadSparkleGfx: the tiles 35:71C0 ($18 blocks) to VRAM0 $8500, OBJ palette 7 from 35:734D
function map3CLoadSparkleGfx(w) {
  if (w.vram) w.lcd.vbk = 0;
  D.inBank(w, 0x35, () => { D.queueVRAMCopy(w, 0x71C0, 0x8500, 0x18); D.loadPalettesImmediate(w, 0x734D, 0x0F, 0x01); });
}
// 35:713A Map3CDrawSparkle: the sprite 35:7340 at the map's ($1600, $0C80) for 6 frames
function* map3CDrawSparkle(sh, b, c) {
  const w = sh.w;
  for (let h = 0x06; h; h--) {
    const x = (((0x1600 - (rd(w, 0xC320) | rd(w, 0xC321) << 8)) & 0xFFFF) << 3) >> 8 & 0xFF;
    const y = (((0x0C80 - (rd(w, 0xC322) | rd(w, 0xC323) << 8)) & 0xFFFF) << 3) >> 8 & 0xFF;
    D.inBank(w, 0x35, () => D.queueSpriteTemplate(w, 0x7340, y, x, c, b));
    yield* sh.advance();
  }
}
// 35:716F Map3CAnimSparkle: the tiles $50, $56, $5C (attributes 7) four times
function* map3CAnimSparkle(sh) {
  for (let k = 0; k < 4; k++) for (const c of [0x50, 0x56, 0x5C]) yield* map3CDrawSparkle(sh, 0x07, c);
}

// ---- map $01, the debug room (reached by the debug menu's Scene warp, 05:6C25) ----
// 35:7735 35:773B 35:7741 35:7747 35:774D 35:7753 35:7759 Map01TalkWarp...: warps 1-7 (the room's warp list 35:76C4: map
// $20 entrances 1 / 5, the Locker Room 2, the clubhouse 1, the Lounge 1, the Trophy Room 1, the Caddie Master's office 2)
function* map01Warp(sh, a) { wr(sh.w, 0xC441, a); }
// 35:775F Map01TalkTwoPlayerScore: TwoPlayerScoreScreen 3E:6361, warp 8 (map $20)
function* map01TwoPlayerScore(sh) {
  yield* inBankGen(sh.w, 0x3E, twoPlayerScoreScreen(sh));
  wr(sh.w, 0xC441, 0x08);
}
// 35:7774 / 35:7780 / 35:778C Map01TalkStarsScreen / StatsScreen / RankingScreen: ClearFrameTasks 00:23B6, the screen
// (0C:4014 / 0C:4A15 / 0C:5AEC), warp $0A / $0B / $0C (the mode select's entrances 2 / 1, the Field); 35:7768
// Map01TalkSaveViewer: the same with the save viewer 02:5D2F (bank 02; it never returns: warp 9, map $21, is not reached)
function* map01Screen(sh, screen, warp) {
  clearFrameTasks(sh.w);
  yield* inBankGen(sh.w, 0x0C, screen(sh));
  wr(sh.w, 0xC441, warp);
}
// 35:7798 Map01TalkSepiaFadeTest: the sepia fade (0A:5422, 0A:54CF bc $FFFF d $3C, 0A:5561), 60 frames, 30 x (sound
// $5C, 10 frames), warp $0D (the room again)
function* map01SepiaFadeTest(sh) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => palFadeInitSepia(w));
  D.inBank(w, 0x0A, () => palFadeSetup(w, 0xFF, 0xFF, 0x3C));
  yield* inBankGen(w, 0x0A, palFadeRun(sh));
  yield* sh.advance(0x3C);
  for (let b = 0x1E; b; b--) { sh.sound(0x5C); yield* sh.advance(0x0A); }
  wr(w, 0xC441, 0x0D);
}
// 35:783D Map01Trigger01Nop / 35:7847 Map01EnterNop: ret (the enter script's farcall 79:68B1 after it is never run)
function* map01Nop() {}
// ---- map $24, a sprite test (by the debug warp; maps/testmaps.js has the other test maps) ----
// 35:793F Map24ApplySprite: $C289 = 0; the player's actor ($C290) takes character a (04:4D3D: not for a null actor),
// the palettes restored (00:05DD), its animation 1 (0A:475B)
function map24ApplySprite(w, a) {
  wr(w, 0xC289, 0);
  const hl = rd(w, 0xC290) | rd(w, 0xC291) << 8;
  if (hl >> 8) D.inBank(w, 0x04, () => actorSetCharacter(w, hl, a));
  D.restorePalettesFromMaster(w);
  D.inBank(w, 0x0A, () => S.actorPlayAnim(w, rd(w, 0xC296), 0x01));
}
// 35:789B Map24TalkPrevSprite / 35:78B7 Map24TalkNextSprite (talks 2 / 3): wTestSprite $C3F0 - 1 / + 1, wrapping
// within wTestSpriteCount $C3F1 (below 0 the last, from the count 0), then 35:793F
function* map24StepSprite(sh, d) {
  const w = sh.w;
  let a = (rd(w, 0xC3F0) + d) & 0xFF;
  if (a & 0x80) a = (rd(w, 0xC3F1) - 1) & 0xFF;
  else if (a >= rd(w, 0xC3F1)) a = 0;
  wr(w, 0xC3F0, a);
  map24ApplySprite(w, a);
}
// 35:78D3 Map24TalkAnim3 / 35:78DD Map24TalkAnim4 (talks 4 / 5): the player's animation 3 / 4 (0A:475B)
function* map24TalkAnim(sh, a) { D.inBank(sh.w, 0x0A, () => S.actorPlayAnim(sh.w, rd(sh.w, 0xC296), a)); }
// 35:791C Map24EnterSpriteTest: wTestSprite 0, the count of character headers (04:4F0A), the task 35:792F
function* map24EnterSpriteTest(sh) {
  const w = sh.w;
  wr(w, 0xC3F0, 0);
  wr(w, 0xC3F1, countCharacterHeaders());
  registerFrameTask(w, 0x01, 0x35, 0x792F);
}
// 35:792F Map24WalkAnimTask: a d-pad press (hJoyPressed) plays the player's animation 1 (0A:475B)
function map24WalkAnimTask(w) {
  if (w.high[0x194] & 0xF0) D.inBank(w, 0x0A, () => S.actorPlayAnim(w, rd(w, 0xC296), 0x01));
}
export const SCRIPTS = {
  "35:41ae": map07Enter,
  "35:4115": sh => map07ObjectTrophy(sh, 112, 0x01, 136),
  "35:4126": sh => map07ObjectTrophy(sh, 113, 0x02, 137),
  "35:4137": sh => map07ObjectTrophy(sh, 114, 0x03, 138),
  "35:4148": sh => map07ObjectTrophy(sh, 115, 0x04, 139),
  "35:4159": sh => map07ObjectTrophy(sh, 116, 0x05, 117),
  "35:4193": map07Trigger01,
  "35:79d2": map25Enter,
  "35:4415": map31Enter,
  "35:479a": map32Enter,
  "35:466a": map32LoungeTour,
  "35:48e6": map33Enter,
  "35:4f35": map34Enter,
  "35:54b2": map35Enter,
  "35:5352": map35CaretakerScene,
  "35:56bd": map36Enter,
  "35:5a0b": map37Enter,
  "35:5baa": map38Enter,
  "35:5e12": map39Enter,
  "35:6a48": map3AEnter,
  "35:6cd2": map3BEnter,
  "35:6e7e": map3CEnter,
  "35:73f7": map3DEnter,
  "35:7525": map3EEnter,
  "35:7b7b": function* () {},                     // 35:7B7B Bank35ObjectNop
  ...Object.fromEntries([[0x7735, 1], [0x773B, 2], [0x7741, 3], [0x7747, 4], [0x774D, 5], [0x7753, 6], [0x7759, 7], [0x77BC, 0x0E]]
    .map(([a, n]) => [`35:${a.toString(16)}`, sh => map01Warp(sh, n)])),   // (35:77BC Map01TalkWarpCharacterTest: warp $0E)
  "35:775f": map01TwoPlayerScore,
  "35:7768": function* (sh) { clearFrameTasks(sh.w); yield* inBankGen(sh.w, 0x02, debugSaveViewer(sh)); wr(sh.w, 0xC441, 0x09); },
  "35:7774": sh => map01Screen(sh, R0C.starsScreen, 0x0A), "35:7780": sh => map01Screen(sh, R0C.statsScreen, 0x0B),
  "35:778c": sh => map01Screen(sh, R0C.rankingScreen, 0x0C),
  "35:7798": map01SepiaFadeTest, "35:783d": map01Nop, "35:7847": map01Nop,
  "35:789b": sh => map24StepSprite(sh, -1), "35:78b7": sh => map24StepSprite(sh, 1),
  "35:78d3": sh => map24TalkAnim(sh, 0x03), "35:78dd": sh => map24TalkAnim(sh, 0x04),
  "35:791c": map24EnterSpriteTest, "35:7912": map01Nop,   // (35:7912 Map24Trigger01Nop: ret)
};
export const TASKS = w => ({
  "35:4666": () => map32PointerSpriteTask(w),     // 35:4666 -> 35:47BF Map32PointerSpriteTask
  "35:56f8": () => map36DrawHatSprite(w, 0x07, 0x40),   // 35:56F8 Map36HatSpriteTask (bc = $0740)
  "35:69db": () => map39DrawMarkerSprite(w, 0x02, 0x30),   // 35:69DB Map39MarkerSpriteTask (bc = $0230)
  "35:792f": () => map24WalkAnimTask(w),          // 35:792F Map24WalkAnimTask
});
