// Bank 34's map scripts (REVERSE.md "Bank 34: map scripts of the Field and the side places"): map $06 (the Locker
// Room), map $02 (the Field between the clubs), ...
import * as D from "../render/display.js";
import { registerFrameTask, unregisterFrameTask } from "../tasks.js";
import * as A from "../actors.js";
import * as S from "../script.js";
import * as T from "../msgbox.js";
import * as M from "../mapengine.js";
import { mapBufCopyRectRedraw, mapCopyTerrainRect, mapCopyEventRect } from "../mapgfx.js";
import { navGuideStart } from "../nav.js";
import * as Scr from "../screen.js";
import { advanceRandomSeed, golfViewExit } from "../round.js";
import { rb, rw } from "../rom.js";
import * as St from "../start.js";
import * as Ls from "./lessons.js";
import { golfSessionEnd } from "../boot.js";
import { saveGame } from "../save.js";
import { addExp } from "../exp.js";
import { levelUpScreen } from "../levelup.js";
import { pushTextNumberArg } from "../text.js";
import { setSaveFlag } from "../match.js";

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
// gone); entrance $0E (34:5218, the Grand Champion) and $0F (34:5019, the path opening); else with #125 the marker
// sprite (34:4FCC and the frame task 34:46DF)
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
  if (e === 0x0E) { yield* enterAsGrandChampion(sh); return; }   // 34:46C3
  if (e === 0x0F) { yield* pathOpenCutscene(sh); return; }        // 34:46CB
  if (flag(w, 125)) {                                            // 34:46CE
    loadMarkerSpriteGfx(w);
    registerFrameTask(w, 0x01, 0x34, 0x46DF);                     // Map02MarkerSpriteTask
  }
}
// 34:4FCC Map02LoadMarkerSpriteGfx: the tiles 34:4950 ($60) to VRAM $8100 (bank 0), palettes 34:4F9C (OBJ 2: d = $0A,
// e = 2)
function loadMarkerSpriteGfx(w) {
  if (w.vram) w.lcd.vbk = 0;                                      // rVBK
  D.inBank(w, 0x34, () => {
    D.queueVRAMCopy(w, 0x4950, 0x8100, 0x60);
    D.loadPalettesImmediate(w, 0x4F9C, 0x0A, 0x02);
  });
}
// 34:50A2 Map02DrawMarkerSprite (the frame task 34:46DF, bc = $0230): the sprite 34:4F50 at the map's ($1300, $1080)
// when on screen (x - scroll + 4 under $16, y + 2 under $14, in tiles), tiles + $30, attributes | 2
function drawMarkerSprite(w, b, c) {
  const x = (0x1300 - (rd(w, 0xC320) | rd(w, 0xC321) << 8)) & 0xFFFF;
  if ((((x >> 8) + 4) & 0xFF) >= 0x16) return;
  const y = (0x1080 - (rd(w, 0xC322) | rd(w, 0xC323) << 8)) & 0xFFFF;
  if ((((y >> 8) + 2) & 0xFF) >= 0x14) return;
  D.queueSpriteTemplate(w, 0x4F50, ((y << 3) >> 8) & 0xFF, ((x << 3) >> 8) & 0xFF, c, b);
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
// 34:54C3 Map02SetChallengerText: wScriptArg $C4BC = the challenger (0-3 by the first of #144-#147 set) and the text
// hl + it; none: nothing set
function setChallengerText(w, hl) {
  const k = [144, 145, 146, 147].findIndex(n => flag(w, n));
  if (k < 0) return;
  wr(w, 0xC4BC, k);
  T.scriptSetText(w, (hl + k) & 0xFFFF);
}
// 34:544D Map02ConfirmMarioChallenge: no challenger following -> 1 (go on); else "Taking on Mario?" ($0C4F + the
// partner, speaker its slot) with the player facing it: No: the player steps back 2 tiles (direction $40) -> 0;
// Yes: the player faces it, $0C53 + the partner, its script reset, 34:54FA (#144 + it and #118 cleared), the player's
// animation 5, 30 frames, warp 5 -> 1
function* map02ConfirmMarioChallenge(sh) {
  const w = sh.w;
  if (![144, 145, 146, 147].some(n => flag(w, n))) return 1;
  setChallengerText(w, 0x0C4F);
  yield* T.scriptShowTextKeepOpen(sh, rd(w, 0xC298));
  S.actorFaceActor(w, 0x00, rd(w, 0xC298));
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* wait(sh, 0x05);
  if (a) { S.actorMoveDir(w, 0x00, 0x40, 0x0200); return 0; }    // 34:54B7
  S.actorFaceActor(w, 0x00, rd(w, 0xC298));
  setChallengerText(w, 0x0C53);
  yield* T.scriptShowText(sh, rd(w, 0xC298));
  S.actorResetScript(w, rd(w, 0xC298));
  clearFlag(w, (144 + rd(w, 0xC4BC)) & 0xFFFF);
  clearFlag(w, 118);
  S.actorPlayAnim(w, 0x00, 0x05);
  yield* S.waitActorAnimDone(sh, 0x00);
  yield* wait(sh, 0x1E);
  wr(w, 0xC441, 0x05);
  return 1;
}
// 34:532E Map02FlashPaletteWarp: sound $99; BG palette 2 from 34:5290, 5 frames; three times: 34:5250, 5258, 5260,
// 5268 (5 frames each), then 34:5290 again (5 frames)
function* flashPaletteWarp(sh) {
  const w = sh.w;
  const pal = hl => D.inBank(w, 0x34, () => D.loadPalettesImmediate(w, hl, 0x02, 0x01));
  sh.sound(0x99);
  wr(w, 0xC3E0, 0x00);
  for (;;) {
    pal(0x5290);
    yield* wait(sh, 0x05);
    if (rd(w, 0xC3E0) === 0x03) return;
    for (const hl of [0x5250, 0x5258, 0x5260, 0x5268]) { pal(hl); yield* wait(sh, 0x05); }
    wr(w, 0xC3E0, (rd(w, 0xC3E0) + 1) & 0xFF);
  }
}
// 34:450C Map02Trigger05RoadToPeachsCastle: 34:544D (0: stay); warp 5 (the Road to Peach's Castle), the player's
// walk script 34:55A6, the palette flash (34:532E), fade out (8)
function* map02Trigger05(sh) {
  const w = sh.w;
  if (!(yield* map02ConfirmMarioChallenge(sh))) return;
  wr(w, 0xC441, 0x05);
  S.actorSetScript(w, 0x00, 0x55A6, 0x34);
  yield* flashPaletteWarp(sh);
  Scr.beginFadeOut(w, 0x08);
}
// 34:5530 Map02ConfirmQuitMatchGame: no challenger following (34:5512: flags #144-#147) -> 0; else the partner faces
// the player, "Quitting this Match Game?" ($0C46 + the partner, speaker wPartnerId $C299) with the player facing it:
// No -> 1; Yes: $0C4A + the partner, the player faces up, 34:54FA Map02DropChallenger (#144 + $C4BC and #118
// cleared), fade out (8), the partner put away ($3F00, $3F00) -> 0
function* map02ConfirmQuitMatchGame(sh) {
  const w = sh.w;
  if (![144, 145, 146, 147].some(n => flag(w, n))) return 0;
  S.actorFaceActor(w, rd(w, 0xC298), 0x00);
  setChallengerText(w, 0x0C46);
  yield* T.scriptShowTextKeepOpen(sh, rd(w, 0xC299));
  S.actorFaceActor(w, 0x00, rd(w, 0xC298));
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* S.scriptWaitFrames(sh, 0x05);
  if (a) return 1;
  setChallengerText(w, 0x0C4A);
  yield* T.scriptShowText(sh, rd(w, 0xC299));
  S.actorSetFacing(w, 0x00, 0xC0);
  clearFlag(w, (144 + rd(w, 0xC4BC)) & 0xFFFF);
  clearFlag(w, 118);
  Scr.beginFadeOut(w, 0x08);
  yield* Scr.waitFade(sh);
  S.actorSetPos(w, rd(w, 0xC298), 0x3F00, 0x3F00);
  return 0;
}
// 34:4618 ... 34:4681 Map02Trigger06-0D: 34:5530, then warp 6-$0D (Windy Valley ... the Club Maker's Hut), sound $92 (the
// same code with their warps; the screen cases take 34:4618 34:4627 34:4636 34:4645 34:4663 34:4672 34:4681, and 34:4654
// (no Field cell has trigger $0A) with the trigger list patched: boot_kid_story_trigger0a)
function* map02TriggerPlace(sh, warp) {
  const w = sh.w;
  if ((yield* map02ConfirmQuitMatchGame(sh)) === 1) return;
  wr(w, 0xC441, warp);
  sh.sound(0x92);
}
// ---- the letter at the tree and the path it opens (after the Links Club is won) ----
// 34:4FB4 Map02LoadLetterSpriteGfx: the tiles 34:4890 ($0C) to VRAM $8100 (bank 0), palettes 34:4FAC (d = $0A, e = 2)
function loadLetterSpriteGfx(w) {
  if (w.vram) w.lcd.vbk = 0;                                      // rVBK
  D.inBank(w, 0x34, () => {
    D.queueVRAMCopy(w, 0x4890, 0x8100, 0x0C);
    D.loadPalettesImmediate(w, 0x4FAC, 0x0A, 0x02);
  });
}
// a sprite's screen position from a point given in 1/32 tiles ((base + t) << 5, 16-bit) less the map's scroll, << 3:
// the high byte (34:50E9 and its copies)
const spritePos = (w, base, t, scroll) => {
  const hl = ((((base + t) & 0xFFFF) << 5) - (rd(w, scroll) | rd(w, scroll + 1) << 8)) & 0xFFFF;
  return ((hl << 3) >> 8) & 0xFF;
};
// 34:4FE4 Map02DrawMarkerSpriteFrames: the marker sprite 34:4F50 at the map's ($1300, $1080) for 10 frames (tiles + c,
// attributes | b)
function* drawMarkerSpriteFrames(sh, b, c) {
  const w = sh.w;
  for (let h = 0x0A; h; h--) {
    const x = (0x1300 - (rd(w, 0xC320) | rd(w, 0xC321) << 8)) & 0xFFFF;
    const y = (0x1080 - (rd(w, 0xC322) | rd(w, 0xC323) << 8)) & 0xFFFF;
    D.inBank(w, 0x34, () => D.queueSpriteTemplate(w, 0x4F50, ((y << 3) >> 8) & 0xFF, ((x << 3) >> 8) & 0xFF, c, b));
    yield* sh.advance();
  }
}
// 34:50DF Map02DrawLetterSprite: the letter 34:4F61 at ($B8 + t, $80 + t) (t = $C3E2) for 12 frames
function* drawLetterSprite(sh, b, c) {
  const w = sh.w;
  for (let h = 0x0C; h; h--) {
    const t = rd(w, 0xC3E2);
    D.inBank(w, 0x34, () => D.queueSpriteTemplate(w, 0x4F61, spritePos(w, 0x80, t, 0xC322), spritePos(w, 0xB8, t, 0xC320), c, b));
    yield* sh.advance();
  }
}
// 34:512E Map02AnimLetterFall: from t = 0, the frames $10, $14 (t + 2), $18 (+ 1), $14 (+ 2) until t reaches $28
function* animLetterFall(sh) {
  const w = sh.w;
  wr(w, 0xC3E2, 0x00);
  for (;;) {
    yield* drawLetterSprite(sh, 0x02, 0x10);
    if (rd(w, 0xC3E2) >= 0x28) return;
    wr(w, 0xC3E2, (rd(w, 0xC3E2) + 2) & 0xFF);
    yield* drawLetterSprite(sh, 0x02, 0x14);
    wr(w, 0xC3E2, (rd(w, 0xC3E2) + 1) & 0xFF);
    yield* drawLetterSprite(sh, 0x02, 0x18);
    wr(w, 0xC3E2, (rd(w, 0xC3E2) + 2) & 0xFF);
    yield* drawLetterSprite(sh, 0x02, 0x14);
  }
}
// 34:516A Map02DrawFlyingSprite: the sprite 34:4F6A at ($E0 + $C3E1, $24 + $C3E2) for 2 frames
function* drawFlyingSprite(sh, b, c) {
  const w = sh.w;
  for (let h = 0x02; h; h--) {
    D.inBank(w, 0x34, () => D.queueSpriteTemplate(w, 0x4F6A, spritePos(w, 0x24, rd(w, 0xC3E2), 0xC322), spritePos(w, 0xE0, rd(w, 0xC3E1), 0xC320), c, b));
    yield* sh.advance();
  }
}
// 34:51B9 Map02AnimFlyingSprite: sound $96; while $C3E2 is under $5A: three steps of ($C3E1 - 2, $C3E2 + 3) with the
// frames $38, $48, $58 (the first step adds to $C3E2 first); sound $97, 10 frames
function* animFlyingSprite(sh) {
  const w = sh.w;
  wr(w, 0xC3E2, 0x00); wr(w, 0xC3E1, 0x00);
  sh.sound(0x96);
  const step = () => { wr(w, 0xC3E2, (rd(w, 0xC3E2) + 3) & 0xFF); wr(w, 0xC3E1, (rd(w, 0xC3E1) + 0xFE) & 0xFF); };
  while (rd(w, 0xC3E2) < 0x5A) {
    step(); yield* drawFlyingSprite(sh, 0x02, 0x38);
    step(); yield* drawFlyingSprite(sh, 0x02, 0x48);
    step(); yield* drawFlyingSprite(sh, 0x02, 0x58);
  }
  sh.sound(0x97);
  yield* S.scriptWaitFrames(sh, 0x0A);
}
// 34:5400 Map02DrawBurstSprite: the sprite 34:4F8B at ($A0, $90) for 5 frames
function* drawBurstSprite(sh, b, c) {
  const w = sh.w;
  for (let h = 0x05; h; h--) {
    D.inBank(w, 0x34, () => D.queueSpriteTemplate(w, 0x4F8B, spritePos(w, 0x90, 0, 0xC322), spritePos(w, 0xA0, 0, 0xC320), c, b));
    yield* sh.advance();
  }
}
// 34:5396 Map02AnimBurstSprite: while $C3E2 is under $10: four steps ($C3E2 + 3, $C3E1 - 2) with the frames $68, $6A,
// $6C, $6E (attributes 3)
function* animBurstSprite(sh) {
  const w = sh.w;
  wr(w, 0xC3E2, 0x00); wr(w, 0xC3E1, 0x00);
  const step = () => { wr(w, 0xC3E2, (rd(w, 0xC3E2) + 3) & 0xFF); wr(w, 0xC3E1, (rd(w, 0xC3E1) + 0xFE) & 0xFF); };
  while (rd(w, 0xC3E2) < 0x10) {
    for (const c of [0x68, 0x6A, 0x6C, 0x6E]) { step(); yield* drawBurstSprite(sh, 0x03, c); }
  }
}
// 34:52C0 Map02FlashPaletteSparkle: five times: BG palette 2 from 34:5290 with sound $95, 5 frames, then 34:5250
// (sound $95), 5258, 5260 (sound $95), 5268 (sound $95), 5 frames each; then 34:5290 once more (sound $95, 5 frames)
function* flashPaletteSparkle(sh) {
  const w = sh.w;
  const pal = (hl) => D.inBank(w, 0x34, () => D.loadPalettesImmediate(w, hl, 0x02, 0x01));
  wr(w, 0xC3E0, 0x00);
  for (;;) {
    pal(0x5290); sh.sound(0x95);
    yield* S.scriptWaitFrames(sh, 0x05);
    if (rd(w, 0xC3E0) === 0x05) return;
    pal(0x5250); sh.sound(0x95); yield* S.scriptWaitFrames(sh, 0x05);
    pal(0x5258); yield* S.scriptWaitFrames(sh, 0x05);
    pal(0x5260); sh.sound(0x95); yield* S.scriptWaitFrames(sh, 0x05);
    pal(0x5268); sh.sound(0x95); yield* S.scriptWaitFrames(sh, 0x05);
    wr(w, 0xC3E0, (rd(w, 0xC3E0) + 1) & 0xFF);
  }
}
// 34:5019 Map02PathOpenCutscene (entrance $0F, after the letter; also the tree's trigger once #123 is set): no name
// banner, the marker's tiles, the player walks to ($1900, $1100) at speed $40, fade in (4), the flying sprite, the
// burst, fade out (8), #125, the path opened (34:46E6) and its event cells (0B:4699: $1C $1A $1C $18 2 x 2), fade in
// (4), 10 frames, sound $98, the burst, 6 frames, sound $A4, the marker's frames $10 / $18 / $20 / $28, its frame task
// (34:46DF), 60 frames
function* pathOpenCutscene(sh) {
  const w = sh.w;
  wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0);
  loadMarkerSpriteGfx(w);
  S.scriptActorSetSpeed(w, 0x0040);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1900, 0x1100);
  yield* S.waitScriptActorIdle(sh);
  Scr.beginFadeIn(w, 0x04);
  yield* Scr.waitFade(sh);
  yield* animFlyingSprite(sh);
  yield* animBurstSprite(sh);
  Scr.beginFadeOut(w, 0x08);
  yield* Scr.waitFade(sh);
  setFlag(w, 125);
  yield* fieldRect(sh, "ter", 0x2C, 0x07, 0x14, 0x11, 0x02, 0x0A);   // 34:46E6 Map02OpenCastlePath (#125 set)
  mapCopyEventRect(w, 0x1C, 0x1A, 0x1C, 0x18, 0x02, 0x02);
  Scr.beginFadeIn(w, 0x04);
  yield* S.scriptWaitFrames(sh, 0x0A);
  sh.sound(0x98);
  yield* animBurstSprite(sh);
  yield* S.scriptWaitFrames(sh, 0x06);
  sh.sound(0xA4);
  for (const c of [0x10, 0x18, 0x20, 0x28]) yield* drawMarkerSpriteFrames(sh, 0x02, c);
  registerFrameTask(w, 0x01, 0x34, 0x46DF);
  yield* S.scriptWaitFrames(sh, 0x3C);
}
// 34:4847 the tree's letter (#139, not #125): #123 already: the path's scene; else the player walks to ($1D00,
// $1500) at speed $40, the sparkling palette (34:52C0), the letter's tiles, to ($1D00, $1900) at speed $20, animation 7,
// the letter falls (34:512E), fade out (2), warp $0F (map $25: the letter read)
function* treeLetter(sh) {
  const w = sh.w;
  if (flag(w, 123)) { yield* pathOpenCutscene(sh); return; }
  S.scriptActorSetSpeed(w, 0x0040);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1D00, 0x1500);
  yield* flashPaletteSparkle(sh);
  loadLetterSpriteGfx(w);
  S.scriptActorSetSpeed(w, 0x0020);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1D00, 0x1900);
  S.actorPlayAnim(w, 0x00, 0x07);
  yield* animLetterFall(sh);
  Scr.beginFadeOut(w, 0x02);
  yield* Scr.waitFade(sh);
  wr(w, 0xC441, 0x0F);
}
// 34:5218 Map02EnterAsGrandChampion (entrance $0E): #139 set, #125 cleared, fade in (8), 60 frames, the tree's trigger
// (34:483B)
function* enterAsGrandChampion(sh) {
  const w = sh.w;
  setFlag(w, 139); clearFlag(w, 125);
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  yield* S.scriptWaitFrames(sh, 0x3C);
  yield* map02Trigger0F(sh);
}
// 34:483B Map02Trigger0FLetterEvent (the tree): nothing before the Links Club is won (#139) or once the path is open
// (#125); else the letter (34:4847)
function* map02Trigger0F(sh) {
  const w = sh.w;
  if (!flag(w, 139) || flag(w, 125)) return;
  yield* treeLetter(sh);
}

// 34:7C99 / 34:7CB5 / 34:7CD1 Map30DrawPalmRoom / DuneRoom / LinksRoom (by 34:7CED Map30DrawClubRoom: entrance 2-4):
// WaitScriptActorIdle, the room's $14 x $14 tiles from the map buffer at (b, c) = ($1A, 0) / (0, $18) / ($1A, $18)
// to (0, 0) (MapBufCopyRectRedraw 0B:4864), six palettes from 2 (34:7BE9 / 7C29 / 7C69, master only)
function* map30DrawClubRoom(sh) {
  const w = sh.w;
  const room = { 2: [0x1A, 0x00, 0x7BE9], 3: [0x00, 0x18, 0x7C29], 4: [0x1A, 0x18, 0x7C69] }[rd(w, 0xC46A)];
  if (!room) return;
  yield* S.waitScriptActorIdle(sh);
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, room[0], room[1], 0x00, 0x00, 0x14, 0x14));
  if (w.vram) D.inBank(w, 0x34, () => D.loadPalettesMasterOnly(w, room[2], 0x02, 0x06));
}
// 34:77EB Map30EnterMatchResult (map $30, the Match Game Event; entrance = the club, 1-4): entrance $0C or more (a
// test's way in): #80 #82 #84 #86 set, #188 cleared, wStoryRoundKind $1E, a won result, warp entrance - $0A; else a
// result other than 1 warps straight back (warp = entrance); won: #188, the club's room (34:7CED), fade in (8), the
// champions (actors 2-5) and the player at speed 8, the beaten champion's scene (texts from $15C6, or $15D9 after
// #139; #127: #189 and $15EC from 34:7A3C, and the champion looks down and left), the champions file out, the
// player to ($0700, $0500), warp entrance (back to the office), 90 frames
function* map30Enter(sh) {
  const w = sh.w;
  const e = rd(w, 0xC46A);
  if (e >= 0x0C) {
    for (const n of [80, 82, 84, 86]) setFlag(w, n);
    clearFlag(w, 188);
    wr(w, 0xC967, 0x1E);
    wr(w, 0xC96C, 0x01);
    wr(w, 0xC441, (e - 0x0A) & 0xFF);
    return;
  }
  if (rd(w, 0xC96C) !== 0x01) { wr(w, 0xC441, e); return; }
  setFlag(w, 188);
  yield* map30DrawClubRoom(sh);
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  S.actorSetSpeed(w, 0x05, 0x0008);
  S.actorSetSpeed(w, 0x03, 0x0008);
  S.actorSetSpeed(w, 0x02, 0x0008);
  S.actorSetSpeed(w, 0x04, 0x0008);
  S.actorSetSpeed(w, 0x00, 0x0008);
  T.scriptSetText(w, flag(w, 139) ? 0x15D9 : 0x15C6);
  S.actorPlayAnim(w, 0x05, 0x07);
  yield* S.waitActorAnimDone(sh, 0x05);
  yield* T.scriptShowText(sh, 0x05);
  S.actorPlayAnim(w, 0x00, 0x07);
  yield* S.waitActorAnimDone(sh, 0x00);
  yield* T.scriptShowText(sh, 0x00);
  S.actorPlayAnim(w, 0x05, 0x06);
  yield* S.waitActorAnimDone(sh, 0x05);
  yield* T.scriptShowText(sh, 0x05);
  yield* wait(sh, 0x1E);
  yield* T.scriptShowText(sh, 0x02);
  S.actorSetFacing(w, 0x05, 0x00);
  S.actorMoveTo(w, 0x02, 0x0900, 0x0500);
  yield* wait(sh, 0x14);
  S.actorMoveTo(w, 0x03, 0x0B00, 0x0500);
  yield* wait(sh, 0x14);
  S.actorMoveTo(w, 0x04, 0x0D00, 0x0500);
  yield* wait(sh, 0x14);
  S.actorSetFacing(w, 0x05, 0xC0);
  yield* S.waitActorMoveDone(sh, 0x04);
  S.actorPlayAnim(w, 0x03, 0x06);
  yield* S.waitActorAnimDone(sh, 0x03);
  yield* T.scriptShowText(sh, 0x03);
  S.actorPlayAnim(w, 0x05, 0x06);
  yield* S.waitActorAnimDone(sh, 0x05);
  yield* T.scriptShowText(sh, 0x05);
  S.actorPlayAnim(w, 0x04, 0x07);
  yield* S.waitActorAnimDone(sh, 0x04);
  yield* T.scriptShowText(sh, 0x04);
  S.actorPlayAnim(w, 0x05, 0x07);
  yield* S.waitActorAnimDone(sh, 0x05);
  yield* T.scriptShowText(sh, 0x05);
  S.actorPlayAnim(w, 0x04, 0x05);
  yield* S.waitActorAnimDone(sh, 0x04);
  S.actorFaceActor(w, 0x02, 0x05);
  S.actorPlayAnim(w, 0x02, 0x07);
  yield* S.waitActorAnimDone(sh, 0x02);
  yield* T.scriptShowText(sh, 0x02);
  S.actorPlayAnim(w, 0x05, 0x06);
  yield* S.waitActorAnimDone(sh, 0x05);
  yield* T.scriptShowText(sh, 0x05);
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
  yield* wait(sh, 0x3C);
  S.actorMoveTo(w, 0x05, 0x0700, 0x0700);
  yield* wait(sh, 0x3C);
  S.actorFaceActor(w, 0x03, 0x05);
  S.actorFaceActor(w, 0x02, 0x05);
  S.actorFaceActor(w, 0x04, 0x05);
  S.actorMoveTo(w, 0x03, 0x0B00, 0x0700);
  yield* S.waitActorMoveDone(sh, 0x03);
  S.actorFaceActor(w, 0x03, 0x05);
  yield* T.scriptShowText(sh, 0x03);
  S.actorFaceActor(w, 0x03, 0x05);
  S.actorFaceActor(w, 0x05, 0x03);
  S.actorFaceActor(w, 0x02, 0x05);
  yield* T.scriptShowText(sh, 0x05);
  if (flag(w, 127)) {                                             // 34:7A39
    setFlag(w, 189);
    T.scriptSetText(w, 0x15EC);
  }
  S.actorSetFacing(w, 0x05, 0xC0);
  S.actorPlayAnim(w, 0x05, 0x06);
  yield* S.waitActorAnimDone(sh, 0x05);
  yield* T.scriptShowText(sh, 0x05);
  S.actorSetFacing(w, 0x04, 0x80);
  S.actorPlayAnim(w, 0x04, 0x07);
  yield* S.waitActorAnimDone(sh, 0x04);
  yield* T.scriptShowText(sh, 0x04);
  S.actorPlayAnim(w, 0x05, 0x07);
  yield* S.waitActorAnimDone(sh, 0x05);
  S.actorPlayAnim(w, 0x05, 0x06);
  yield* S.waitActorAnimDone(sh, 0x05);
  yield* T.scriptShowText(sh, 0x05);
  if (flag(w, 127)) {                                             // 34:7A98
    S.actorSetFacing(w, 0x05, 0x00);
    yield* wait(sh, 0x14);
    S.actorSetFacing(w, 0x05, 0x40);
    yield* wait(sh, 0x14);
  }
  S.actorPlayAnim(w, 0x05, 0x05);
  yield* S.waitActorAnimDone(sh, 0x05);
  yield* T.scriptShowText(sh, 0x05);
  S.actorMoveTo(w, 0x05, 0x0700, 0x0500);
  yield* S.waitActorMoveDone(sh, 0x05);
  S.actorSetFacing(w, 0x02, 0x80);
  S.actorMoveTo(w, 0x05, 0x0700, 0x0100);
  yield* S.waitActorMoveDone(sh, 0x05);
  S.actorSetPos(w, 0x05, 0x3F00, 0x3F00);
  S.actorFaceActor(w, 0x02, 0x03);
  yield* T.scriptShowText(sh, 0x02);
  S.actorFaceActor(w, 0x03, 0x02);
  S.actorPlayAnim(w, 0x03, 0x05);
  yield* S.waitActorAnimDone(sh, 0x03);
  yield* T.scriptShowText(sh, 0x03);
  S.actorFaceActor(w, 0x03, 0x00);
  S.actorFaceActor(w, 0x02, 0x00);
  S.actorFaceActor(w, 0x04, 0x00);
  S.actorMoveTo(w, 0x04, 0x0D00, 0x0700);
  yield* S.waitActorMoveDone(sh, 0x04);
  S.actorPlayAnim(w, 0x04, 0x05);
  yield* S.waitActorAnimDone(sh, 0x04);
  yield* T.scriptShowText(sh, 0x04);
  S.actorPlayAnim(w, 0x00, 0x07);
  yield* S.waitActorAnimDone(sh, 0x00);
  yield* wait(sh, 0x1E);
  S.actorPlayAnim(w, 0x04, 0x05);
  S.actorPlayAnim(w, 0x02, 0x05);
  S.actorPlayAnim(w, 0x03, 0x05);
  yield* S.waitActorAnimDone(sh, 0x03);
  S.actorMoveTo(w, 0x02, 0x0700, 0x0100);
  yield* wait(sh, 0x1E);
  S.actorMoveTo(w, 0x03, 0x0700, 0x0100);
  yield* wait(sh, 0x1E);
  S.actorMoveTo(w, 0x04, 0x0900, 0x0100);
  yield* wait(sh, 0x3C);
  S.actorMoveTo(w, 0x00, 0x0700, 0x0500);
  wr(w, 0xC441, e);
  yield* wait(sh, 0x5A);
}


// ---- map $27, the Tiny-Tots Golf Grounds (header 34:5661) ----
// 34:7DD8 FadeToLevelUpScreen_34: fade out (8), 41:402A LevelUpScreen
function* fadeToLevelUpScreen(sh) {
  Scr.beginFadeOut(sh.w, 0x08);
  yield* Scr.waitFade(sh);
  yield* inBankGen(sh.w, 0x41, levelUpScreen(sh));
}
// 34:7E12 AwardFoundAllRivalsExp (the same code as 33:7CF1 HiddenFriendsBonus and 30:7EAD HiddenFriendsBonus_30): the hidden friends #140-#143 all found (the player's own character's not asked):
// 300 EXP, $011B (speaker $80, sound $38), WaitJingleEnd, the level-up screen, the return point (map 0, $FA),
// SaveGame, the map again where the player stood (warp $FA, entrance $FA, wPlayerPosSave)
export function* awardFoundAllRivalsExp(sh) {
  const w = sh.w, id = rd(w, 0xC810);
  for (let k = 0; k < 4; k++) if (id !== k && !flag(w, 140 + k)) return;
  addExp(w, 0x012C);                                              // 02:5465
  pushTextNumberArg(w, 0x012C);                                   // 05:551F
  sh.sound(0x38);
  T.scriptSetText(w, 0x011B);
  yield* T.scriptShowText(sh, 0x80);
  yield* Scr.waitJingleEnd(sh);                                   // 00:2C1F
  yield* fadeToLevelUpScreen(sh);
  Ls.saveReturnPoint(w, 0x00, 0xFA);                              // 0A:4D5B
  saveGame(w);                                                    // 02:4489
  wr(w, 0xC441, 0xFA); wr(w, 0xC46A, 0xFA);
  for (let k = 0; k < 4; k++) wr(w, 0xC466 + k, rd(w, 0xC2A0 + k));   // 00:03D3 CopyMemoryBC
  wr(w, 0xC465, rd(w, 0xC2A4));
}
// 34:56F7 Map27ObjectHiddenSherry (object $0F): not when the player is Sherry (wCharId 1); #141, $0C58; Sherry (actor
// 3) to ($2500, $1700); the player hops back $0200 to the right with the facing locked (sound $8A), Sherry hops out the
// same way (sound $8A); the text (speaker 3), $0C5C; 34:7E12
function* map27ObjectHiddenSherry(sh) {
  const w = sh.w;
  if (rd(w, 0xC810) === 0x01) return;
  setFlag(w, 141);
  T.scriptSetText(w, 0x0C58);
  S.actorSetPos(w, 0x03, 0x2500, 0x1700);
  S.actorLockSpriteFacing(w, 0x00, 0x01);
  for (const a of [0x00, 0x03]) {
    if (a === 0x03) S.actorLockSpriteFacing(w, 0x00, 0x00);
    sh.sound(0x8A);
    S.actorJump(w, a, 0xFF80);
    S.actorMoveDir(w, a, 0x40, 0x0200);
    yield* S.waitActorMoveDone(sh, a);
  }
  yield* T.scriptShowText(sh, 0x03);
  T.scriptSetText(w, 0x0C5C);
  yield* T.scriptShowText(sh, 0x03);
  yield* awardFoundAllRivalsExp(sh);
}
// 34:576F Map27Trigger01CaretakerGrumbles (trigger 1, while #203 is clear): "Those darn kids!" ($14EA, speaker 2); the
// script actor walks to the caretaker's spot; he looks round (up 30 frames, right 10, down 30, right), animation 6,
// the next text, #203, animation 6; the script actor walks back to the player's spot (40 frames, not waited for); he
// looks round again (up, left, down, left)
function* map27TriggerCaretaker(sh) {
  const w = sh.w;
  T.scriptSetText(w, 0x14EA);
  yield* T.scriptShowText(sh, 0x02);
  yield* S.scriptActorGoToActor(sh, 0x02, 0x00);
  yield* S.waitScriptActorIdle(sh);
  const lookRound = function* (side) {
    S.actorSetFacing(w, 0x02, 0x00);
    yield* wait(sh, 0x1E);
    S.actorSetFacing(w, 0x02, side);
    yield* wait(sh, 0x0A);
    S.actorSetFacing(w, 0x02, 0x80);
    yield* wait(sh, 0x1E);
    S.actorSetFacing(w, 0x02, side);
  };
  yield* lookRound(0x40);
  S.actorPlayAnim(w, 0x02, 0x06);
  yield* S.waitActorAnimDone(sh, 0x02);
  yield* T.scriptShowText(sh, 0x02);
  setFlag(w, 203);
  S.actorPlayAnim(w, 0x02, 0x06);
  yield* S.waitActorAnimDone(sh, 0x02);
  yield* S.scriptActorGoToActor(sh, 0x00, 0x00);
  yield* wait(sh, 0x28);
  yield* lookRound(0xC0);
}
// 34:584B Map27AskBallCleanup: $14EC asked (speaker 2): No: the next part; Yes: the one after, then the caretaker's
// demo: GolfSessionInit, SetP1OffTee, $C82C = 7, the return point (map $27, entrance 5), game mode 6, the strokes 34:58D6
// (64 bytes to $C600) for golfer $4E (bit 6: replayed), no second player, course 8 hole 1 (the wind byte a is 0, from
// SetupPlayerGolfer's ClearMemory16), the wind direction 0, the tee ($1F60, $2880), the wind $C000, the hooks 34:58E6,
// one hole
function* map27AskBallCleanup(sh) {
  const w = sh.w;
  T.scriptSetText(w, 0x14EC);
  yield* T.scriptShowTextKeepOpen(sh, 0x02);
  yield* wait(sh, 0x05);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* wait(sh, 0x05);
  if (a) { yield* T.scriptShowText(sh, 0x02); return; }
  T.scriptSkipText(w);
  yield* T.scriptShowText(sh, 0x02);
  St.golfSessionInit(w);                                          // 10:4B28
  Ls.setP1OffTee(w);                                              // 10:4C1A
  wr(w, 0xC82C, 0x07);
  Ls.saveReturnPoint(w, 0x27, 0x05);
  wr(w, 0xC834, 0x06);
  D.inBank(w, 0x34, () => D.copyMemoryFast(w, 0x58D6, 0xC600, 0x04));   // 00:03EB
  St.setupPlayerGolfer(w, 0x4E, 0x00);                            // 02:4A28
  St.setupPlayerGolfer(w, 0xFF, 0x01);
  St.setCourseHole(w, 0x00, 0x08, 0x01);                          // 10:423B
  Ls.setForcedWindDir(w, 0x00);
  Ls.setForcedTee(w, 0x1F60, 0x2880);
  Ls.setForcedWind(w, 0xC000);
  Ls.setGolfEventHook(w, 0x34, 0x58E6);
  if (!sh.playGolfRound) notPorted("the Tiny-Tots demo outside the game loop");
  yield* sh.playGolfRound(0x01);                                  // 10:4451
  yield* inBankGen(w, 0x10, golfSessionEnd(sh));                  // 10:4B94
}
// 34:56C6 Map27TalkCaretaker (talk 2): the job done (#202): $14FC, animation 6; else 34:584B
function* map27TalkCaretaker(sh) {
  const w = sh.w;
  if (!flag(w, 202)) { yield* map27AskBallCleanup(sh); return; }
  T.scriptSetText(w, 0x14FC);
  yield* T.scriptShowText(sh, 0x02);
  S.actorPlayAnim(w, 0x02, 0x06);
  yield* S.waitActorAnimDone(sh, 0x02);
}
// 34:5D9E Map27SetupTimer (also hook 3, a hole's start): CountdownStart 12:4F52 with 10 seconds, CountdownPause
// 12:4F73 (ShotSetup 10:4798 lets it run)
function map27SetupTimer(w) {
  D.setWramBank(w, 6);
  wr(w, 0xC0F4, 0x01); wr(w, 0xC0F5, 0x00); wr(w, 0xC0F6, 0x0A); wr(w, 0xC0F7, 0x00);
  wr(w, 0xC0F4, 0x02);
}
// 34:590D Map27StartBallCleanup (entrance 5, after the demo): #224; the caretaker and the player face each other,
// fade in (4), $14EF (speaker 2); the balls $C3E0 / $C3E1 = 0; GolfSessionInit, the timer, $C82C = $28, SetP1OffTee,
// the return point (map $27, entrance 6), game mode $0B, the player and no second player, course 8 hole 1 (a = 0), the
// wind direction 0, the wind $C000, the hooks 34:5C61, GolfRound for ten holes (a ball each), GolfSessionEnd
function* map27StartBallCleanup(sh) {
  const w = sh.w;
  setFlag(w, 224);
  S.actorsFaceEachOther(w, 0x02, 0x00);
  Scr.beginFadeIn(w, 0x04);
  yield* Scr.waitFade(sh);
  T.scriptSetText(w, 0x14EF);
  yield* T.scriptShowText(sh, 0x02);
  wr(w, 0xC3E0, 0x00); wr(w, 0xC3E1, 0x00);
  St.golfSessionInit(w);
  map27SetupTimer(w);
  wr(w, 0xC82C, 0x28);
  Ls.setP1OffTee(w);
  Ls.saveReturnPoint(w, 0x27, 0x06);
  wr(w, 0xC834, 0x0B);
  St.setupPlayerGolfer(w, 0x80, 0x00);
  St.setupPlayerGolfer(w, 0xFF, 0x01);
  St.setCourseHole(w, 0x00, 0x08, 0x01);
  Ls.setForcedWindDir(w, 0x00);
  Ls.setForcedWind(w, 0xC000);
  Ls.setGolfEventHook(w, 0x34, 0x5C61);
  if (!sh.playGolfRound) notPorted("the Tiny-Tots clean-up outside the game loop");
  yield* sh.playGolfRound(0x0A);
  yield* inBankGen(w, 0x10, golfSessionEnd(sh));
}
// 34:5AE9 Map27DrawBallPiles: the job done before (#202): 10, 3 frames first; the piles 1..$C3E0 (up to 10; each one
// tile, from (b, c) to (d, e) of the map buffer by 0B:4864), drawn from the last down to the first
const BALL_PILES = [[0x28, 0x1F, 0x28], [0x28, 0x20, 0x2E], [0x2A, 0x1C, 0x27], [0x26, 0x1D, 0x2D], [0x26, 0x1C, 0x2A],
  [0x24, 0x19, 0x27], [0x26, 0x19, 0x24], [0x24, 0x16, 0x25], [0x26, 0x23, 0x20], [0x24, 0x2A, 0x24]];   // [c, d, e], b = $3F
function* map27DrawBallPiles(sh) {
  const w = sh.w;
  if (flag(w, 202)) { wr(w, 0xC3E0, 0x0A); yield* wait(sh, 0x03); }
  const n = rd(w, 0xC3E0);
  if (n < 1 || n > 10) return;
  for (let k = n; k >= 1; k--) {
    const [c, d, e] = BALL_PILES[k - 1];
    yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x3F, c, d, e, 0x01, 0x01));
  }
}
// 34:5A99 Map27AwardCleanupExp: the first time (#202 clear): 50 EXP, a quarter more for all ten, $011B (sound $38),
// #202, WaitJingleEnd, the level-up screen, the return point (map 0, $FA), SaveGame, warp 1
function* map27AwardCleanupExp(sh) {
  const w = sh.w;
  if (flag(w, 202)) return;
  let de = 0x0032;
  if (rd(w, 0xC3E1) === 0x0A) de = (de + (de >> 2)) & 0xFFFF;
  addExp(w, de);
  pushTextNumberArg(w, de);
  sh.sound(0x38);
  setFlag(w, 202);
  T.scriptSetText(w, 0x011B);
  yield* T.scriptShowText(sh, 0x80);
  yield* Scr.waitJingleEnd(sh);
  yield* fadeToLevelUpScreen(sh);
  Ls.saveReturnPoint(w, 0x00, 0xFA);
  saveGame(w);
  wr(w, 0xC441, 0x01);
}
// 34:597D Map27CleanupResult (entrance 6): the player at ($2100, $2900) facing down, the caretaker at ($1F00,
// $2700) facing up, the piles (34:5AE9), the banner's text cleared, fade in (4); by the balls in ($C3E1): $63 (quit)
// nothing; under 8: $14F4, warp 1; 8 or 9: $14F5, the caretaker faces the player, animation 7, 34:5A99; 10: $14F6 with
// a hop (sound $8A), asked: No: the next part, 34:5A99; Yes: the part after, a hop, the player's animation 7, the
// next, the caretaker walks to ($1F00, $3300), 30 frames, back to ($2100, $2B00), two texts more, 34:5A99
function* map27CleanupResult(sh) {
  const w = sh.w;
  S.actorSetPos(w, 0x00, 0x2100, 0x2900);
  S.actorSetPos(w, 0x02, 0x1F00, 0x2700);
  S.actorSetFacing(w, 0x00, 0x80);
  S.actorSetFacing(w, 0x02, 0x00);
  yield* map27DrawBallPiles(sh);
  wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0);
  Scr.beginFadeIn(w, 0x04);
  yield* Scr.waitFade(sh);
  const n = rd(w, 0xC3E1);
  if (n === 0x63) return;
  if (n === 0x0A) {
    T.scriptSetText(w, 0x14F6);
    S.actorFaceActor(w, 0x02, 0x00);
    sh.sound(0x8A);
    S.actorJump(w, 0x02, 0xFF40);
    yield* S.waitActorLanded(sh, 0x02);
    yield* T.scriptShowTextKeepOpen(sh, 0x02);
    yield* wait(sh, 0x05);
    const a = yield* T.scriptAskYesNo(sh);
    yield* T.scriptCloseText(sh);
    yield* wait(sh, 0x05);
    if (a) { yield* T.scriptShowText(sh, 0x02); yield* map27AwardCleanupExp(sh); return; }
    T.scriptSkipText(w);
    sh.sound(0x8A);
    S.actorJump(w, 0x02, 0xFF40);
    yield* S.waitActorLanded(sh, 0x02);
    yield* T.scriptShowText(sh, 0x02);
    S.actorPlayAnim(w, 0x00, 0x07);
    yield* S.waitActorAnimDone(sh, 0x00);
    yield* T.scriptShowText(sh, 0x02);
    S.actorMoveTo(w, 0x02, 0x1F00, 0x3300);
    yield* S.waitActorMoveDone(sh, 0x02);
    yield* wait(sh, 0x1E);
    S.actorMoveTo(w, 0x02, 0x2100, 0x2B00);
    yield* S.waitActorMoveDone(sh, 0x02);
    yield* T.scriptShowText(sh, 0x02);
    yield* T.scriptShowText(sh, 0x02);
    yield* map27AwardCleanupExp(sh);
    return;
  }
  if (n >= 0x08) {
    T.scriptSetText(w, 0x14F5);
    S.actorFaceActor(w, 0x02, 0x00);
    S.actorPlayAnim(w, 0x02, 0x07);
    yield* S.waitActorAnimDone(sh, 0x02);
    yield* T.scriptShowText(sh, 0x02);
    yield* map27AwardCleanupExp(sh);
    return;
  }
  T.scriptSetText(w, 0x14F4);
  yield* T.scriptShowText(sh, 0x02);
  wr(w, 0xC441, 0x01);
}
// 34:5820 Map27Enter: Sherry (actor 3) put away at ($0100, $0100) until found (#141); entrance 1 nothing more; else
// the banner's text cleared; entrance 5: 34:590D, 6: 34:597D
function* map27Enter(sh) {
  const w = sh.w;
  if (!flag(w, 141)) S.actorSetPos(w, 0x03, 0x0100, 0x0100);
  const e = rd(w, 0xC46A);
  if (e === 0x01) return;
  wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0);
  if (e === 0x05) yield* map27StartBallCleanup(sh);
  else if (e === 0x06) yield* map27CleanupResult(sh);
}
// 34:5C82 Map27CleanupAfterShot (hook 1): flag #224 + the hole (the ball) set; quit (game mode 0): $C3E0 = 0,
// $C3E1 = $63; within $3C of the pin (34:7D93): holed out, a ball more both counted and in; in the water or out of
// bounds (wShotEndLie 3 / 7): GolfViewExit, a ball more counted, "caretaker" texts $14F2 / $14F1 (or $14F3 after the
// tenth) at (10, 3), holed out, GolfAdvanceFrame; the time left: nothing (the same ball again); the time up: the
// same with $14F0 / $14F1
function* map27CleanupAfterShot(sh) {
  const w = sh.w;
  setFlag(w, (rd(w, 0xC837) + 0xE0) & 0x1FF);                     // 00:2D2E SetGameFlag
  if (!rd(w, 0xC834)) { wr(w, 0xC3E0, 0x00); wr(w, 0xC3E1, 0x63); return; }
  if (!Ls.ballWithinPinDist(w, 0x003C)) {
    wr(w, 0xC8AA, 0x01);
    wr(w, 0xC3E0, (rd(w, 0xC3E0) + 1) & 0xFF);
    wr(w, 0xC3E1, (rd(w, 0xC3E1) + 1) & 0xFF);
    return;
  }
  const lie = rd(w, 0xD4DC);
  let texts;
  if (lie === 0x03 || lie === 0x07) texts = [0x14F2, 0x14F1];
  else if (rd(w, 0xC0F6) | rd(w, 0xC0F7)) return;
  else texts = [0x14F0, 0x14F1];
  yield* inBankGen(w, 0x10, golfViewExit(sh));                    // 10:4C6E
  wr(w, 0xC3E0, (rd(w, 0xC3E0) + 1) & 0xFF);
  if (rd(w, 0xC3E0) === 0x0A) texts = [0x14F3];
  for (const t of texts) yield* inBankGen(w, 0x05, T.showMessageAt(sh, t, 0x80, 0x0A, 0x03));   // 05:5E70
  wr(w, 0xC8AA, 0x01);
  yield* Ls.golfAdvanceFrame(sh);                                 // 10:4CB9
}
// 34:55FE CopyHoleMapRect: the b x c rectangle of the 64 x 64 hole maps (row = the low byte, column = the high byte of
// hl / de) copied from hl to de in WRAM3 (tiles), then WRAM2 (attributes) (34:563B CopyRect64); the WRAM bank kept
function copyHoleMapRect(w, hl, de, b, c) {
  const at = v => (((v & 0xFF) << 6) + (v >> 8)) & 0xFFFF;        // (from $D000)
  const s = at(hl), d = at(de);
  for (const bank of [3, 2]) {
    const m = w.wram[bank];
    for (let r = 0; r < (c || 0x100); r++)
      for (let k = 0; k < (b || 0x100); k++) m[(d + r * 0x40 + k) & 0xFFF] = m[(s + r * 0x40 + k) & 0xFFF];
  }
}
// 34:55B6 ApplyFlaggedHoleMapEdits: hl = the lists of the course view and the green view (by wOnGreen 0 / 1; other
// views none): 8-byte records (a flag word, source, destination, c rows, b bytes; $FFFF ends), each whose game flag is
// set copied by 34:55FE; the WRAM bank kept. 34:5D40 Map27CleanupViewLoaded (hook 2) with 34:5D46
function applyFlaggedHoleMapEdits(w, hl) {
  const old = w.high[0x196];
  D.setWramBank(w, 6);
  const v = rd(w, 0xD443);
  if (v < 2) {
    for (let p = rb(0x34, hl + 2 * v) | rb(0x34, hl + 2 * v + 1) << 8; ; p += 8) {
      const e = rb(0x34, p), d = rb(0x34, p + 1);
      if ((d & e) === 0xFF) break;
      if (!flag(w, (d << 3) | (e >> 5))) continue;
      copyHoleMapRect(w, rb(0x34, p + 2) | rb(0x34, p + 3) << 8, rb(0x34, p + 4) | rb(0x34, p + 5) << 8, rb(0x34, p + 7), rb(0x34, p + 6));
    }
  }
  D.setWramBank(w, old);
}

export const HOOKS = {
  "34:5906": function* () {},                     // 34:5906 Map27DemoShotSetup: ret
  "34:5907": function* (sh) { Ls.setGolfEventFlag(sh.w, 0x82); },   // 34:5907 Map27DemoAfterShot: the round over
  "34:5c81": function* () {},                     // 34:5C81 Map27CleanupShotSetup: ret
  "34:5c82": map27CleanupAfterShot,
  "34:5d40": function* (sh) { applyFlaggedHoleMapEdits(sh.w, 0x5D46); },   // 34:5D40 Map27CleanupViewLoaded
  "34:5d9e": function* (sh) { map27SetupTimer(sh.w); },           // 34:5D9E Map27SetupTimer (hook 3)
};

// ---- map $28, the Mini-Mini Lake Course (header 34:5DA8) ----
// an animation of actor b, waited for
function* animWait(sh, b, a) { S.actorPlayAnim(sh.w, b, a); yield* S.waitActorAnimDone(sh, b); }
// animation a of actor b, then the text shown with speaker b
function* animSay(sh, b, a) { yield* animWait(sh, b, a); yield* T.scriptShowText(sh, b); }
// a Yes / No question (speaker s, 5 frames before and after): true for No
function* ask(sh, s) {
  yield* T.scriptShowTextKeepOpen(sh, s);
  yield* wait(sh, 0x05);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* wait(sh, 0x05);
  return a;
}
// a round started by the map: GolfRound for one hole, GolfSessionEnd
function* oneHole(sh, what) {
  if (!sh.playGolfRound) notPorted(`${what} outside the game loop`);
  yield* sh.playGolfRound(0x01);                                  // 10:4451
  yield* inBankGen(sh.w, 0x10, golfSessionEnd(sh));               // 10:4B94
}
// the golfer's shot from the rough (34:5F28 / 34:622E): GolfSessionInit, SetP1OffTee, $C82C, the return point (map
// $28, entrance e), game mode m, his strokes (64 bytes from hl to $C600) for golfer $4F (bit 6: replayed), no second
// player, course 8 hole $0D (a = 0, from ClearMemory16), the wind direction 0, the tee ($18C0, $1EC0), the wind $C000,
// the hooks
function* map28GolferShot(sh, music, e, m, hl, hooks) {
  const w = sh.w;
  St.golfSessionInit(w);
  Ls.setP1OffTee(w);
  wr(w, 0xC82C, music);
  Ls.saveReturnPoint(w, 0x28, e);
  wr(w, 0xC834, m);
  D.inBank(w, 0x34, () => D.copyMemoryFast(w, hl, 0xC600, 0x04));
  St.setupPlayerGolfer(w, 0x4F, 0x00);
  St.setupPlayerGolfer(w, 0xFF, 0x01);
  St.setCourseHole(w, 0x00, 0x08, 0x0D);
  Ls.setForcedWindDir(w, 0x00);
  Ls.setForcedTee(w, 0x18C0, 0x1EC0);
  Ls.setForcedWind(w, 0xC000);
  Ls.setGolfEventHook(w, 0x34, hooks);
  yield* oneHole(sh, "the Mini-Mini Lake golfer's shot");
}
// 34:5E86 Map28Trigger0FPlayCourse (trigger $0F): "Want to play?" ($14FD, speaker $80): Yes: wStoryRoundKind $0A,
// GolfSessionInit, $C82C = 7, game mode 6, the player, the wind direction 0, the wind $C000, course $0A hole 1 (the
// wind byte a is the 6 SetForcedWind leaves), one hole (no hooks)
function* map28TriggerPlayCourse(sh) {
  const w = sh.w;
  T.scriptSetText(w, 0x14FD);
  if (yield* ask(sh, 0x80)) return;
  wr(w, 0xC967, 0x0A);
  St.golfSessionInit(w);
  wr(w, 0xC82C, 0x07);
  wr(w, 0xC834, 0x06);
  St.setupPlayerGolfer(w, 0x80, 0x00);
  St.setupPlayerGolfer(w, 0xFF, 0x01);
  Ls.setForcedWindDir(w, 0x00);
  Ls.setForcedWind(w, 0xC000);
  St.setCourseHole(w, 0x06, 0x0A, 0x01);
  yield* oneHole(sh, "the Mini-Mini Lake course");
}
// 34:5EE1 Map28Trigger01UnplayableShow (trigger 1, while #211 is clear): #211; $14FE (speaker $82); the script actor
// (speed $48) walks to ($1900, $1F00); the golfer's animation 7 and the next text, animation 5, 10 frames; his shot
// (game mode 5, $C82C = 7, entrance 5, the strokes 34:5F83, the hooks 34:5F93)
function* map28TriggerUnplayable(sh) {
  const w = sh.w;
  setFlag(w, 211);
  T.scriptSetText(w, 0x14FE);
  yield* T.scriptShowText(sh, 0x82);
  S.scriptActorSetSpeed(w, 0x0048);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1900, 0x1F00);
  yield* S.waitScriptActorIdle(sh);
  yield* animSay(sh, 0x02, 0x07);
  yield* animWait(sh, 0x02, 0x05);
  yield* wait(sh, 0x0A);
  yield* map28GolferShot(sh, 0x07, 0x05, 0x05, 0x5F83, 0x5F93);
}
// 34:5FBE Map28AfterGolferShot (entrance 5): $1500; the script actor (speed $7F) to ($1900, $1F00); fade in (8); his
// partner (actor 3) animation 6 and the text, the golfer animation 6 and the next; the script actor walks to ($0B00,
// $3B00), 30 frames
function* map28AfterGolferShot(sh) {
  const w = sh.w;
  T.scriptSetText(w, 0x1500);
  S.scriptActorSetSpeed(w, 0x007F);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1900, 0x1F00);
  yield* S.waitScriptActorIdle(sh);
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  yield* animSay(sh, 0x03, 0x06);
  yield* animSay(sh, 0x02, 0x06);
  yield* S.scriptActorGoTo(sh, 0x00, 0x0B00, 0x3B00);
  yield* S.waitScriptActorIdle(sh);
  yield* wait(sh, 0x1E);
}
// 34:64B1 Map28PlayerTryShot: #224 cleared, $C3E0 / $C3E1 = 0; GolfSessionInit, SetP1OffTee, the tee ($18C0, $1EC0),
// the return point (map $28, entrance 6), game mode 5, the player, course 8 hole $0D (a = 0), the wind direction 0,
// the wind $C000, the hooks 34:6507, one hole
function* map28PlayerTryShot(sh) {
  const w = sh.w;
  clearFlag(w, 224);
  wr(w, 0xC3E1, 0x00); wr(w, 0xC3E0, 0x00);
  St.golfSessionInit(w);
  Ls.setP1OffTee(w);
  Ls.setForcedTee(w, 0x18C0, 0x1EC0);
  Ls.saveReturnPoint(w, 0x28, 0x06);
  wr(w, 0xC834, 0x05);
  St.setupPlayerGolfer(w, 0x80, 0x00);
  St.setupPlayerGolfer(w, 0xFF, 0x01);
  St.setCourseHole(w, 0x00, 0x08, 0x0D);
  Ls.setForcedWindDir(w, 0x00);
  Ls.setForcedWind(w, 0xC000);
  Ls.setGolfEventHook(w, 0x34, 0x6507);
  yield* oneHole(sh, "the Mini-Mini Lake shot");
}
// 34:6018 Map28TalkKeepTrying (talk 3): "Keep trying?" ($150C, speaker 3): Yes: the next part, 34:64B1; No: the part
// after skipped to, his animation 5, the text (speaker 2)
function* map28TalkKeepTrying(sh) {
  const w = sh.w;
  T.scriptSetText(w, 0x150C);
  if (!(yield* ask(sh, 0x03))) { yield* T.scriptShowText(sh, 0x03); yield* map28PlayerTryShot(sh); return; }
  T.scriptSkipText(w);
  yield* animWait(sh, 0x03, 0x05);
  yield* T.scriptShowText(sh, 0x02);
}
// 34:6064 Map28TalkUnplayableDebate (talk 3; 34:6059 first shows $1502, speaker 2): $1503 on: actor 3 animation 6,
// the player faces the golfer, the golfer 6, actor 3 7, the golfer 6, actor 3 6, actor 3 5 and asked: Yes: his
// animation 5, the text (speaker 2); No: the next part skipped to (speaker 3), 34:64B1
function* map28TalkDebate(sh) {
  const w = sh.w;
  T.scriptSetText(w, 0x1503);
  yield* animSay(sh, 0x03, 0x06);
  S.actorFaceActor(w, 0x02, 0x00);
  yield* animSay(sh, 0x02, 0x06);
  yield* animSay(sh, 0x03, 0x07);
  yield* animSay(sh, 0x02, 0x06);
  yield* animSay(sh, 0x03, 0x06);
  yield* animWait(sh, 0x03, 0x05);
  if (!(yield* ask(sh, 0x03))) {
    yield* animWait(sh, 0x03, 0x05);
    yield* T.scriptShowText(sh, 0x02);
    return;
  }
  T.scriptSkipText(w);
  yield* T.scriptShowText(sh, 0x03);
  yield* map28PlayerTryShot(sh);
}
// 34:6586 Map28AwardShotExp: 140 EXP, a quarter more with $C3E1 = 1, $011B (sound $38), WaitJingleEnd, the level-up
// screen, the return point (map 0, $FA), SaveGame
function* map28AwardShotExp(sh) {
  const w = sh.w;
  let de = 0x008C;
  if (rd(w, 0xC3E1) === 0x01) de = (de + (de >> 2)) & 0xFFFF;
  addExp(w, de);
  pushTextNumberArg(w, de);
  sh.sound(0x38);
  T.scriptSetText(w, 0x011B);
  yield* T.scriptShowText(sh, 0x80);
  yield* Scr.waitJingleEnd(sh);
  yield* fadeToLevelUpScreen(sh);
  Ls.saveReturnPoint(w, 0x00, 0xFA);
  saveGame(w);
}
// the results' start (34:6114 / 6159 / 61BB): fade in (8), actor 3's animation, the player faces actor 3 (a = 3,
// b = 0: actor 3 turned to the player)
function* map28ResultStart(sh, anim) {
  Scr.beginFadeIn(sh.w, 0x08);
  yield* Scr.waitFade(sh);
  yield* animWait(sh, 0x03, anim);
  S.actorFaceActor(sh.w, 0x03, 0x00);
}
// 34:6114 Map28ShotFailed: "HAH! See!" ($150F, speaker 3), the golfer's animation 6, facing right, the next; #218
function* map28ShotFailed(sh) {
  const w = sh.w;
  yield* map28ResultStart(sh, 0x06);
  T.scriptSetText(w, 0x150F);
  yield* T.scriptShowText(sh, 0x03);
  yield* animWait(sh, 0x02, 0x06);
  S.actorSetFacing(w, 0x02, 0x40);
  yield* T.scriptShowText(sh, 0x02);
  setFlag(w, 218);
}
// 34:6159 Map28ShotOnGreen: $1511 (speaker 3), the golfer 7 and 6 with the next parts, actor 3 animation 5, 140 EXP
// (34:6586), warp $0E
function* map28ShotOnGreen(sh) {
  const w = sh.w;
  yield* map28ResultStart(sh, 0x07);
  T.scriptSetText(w, 0x1511);
  yield* T.scriptShowText(sh, 0x03);
  yield* animSay(sh, 0x02, 0x07);
  yield* animSay(sh, 0x02, 0x06);
  yield* animWait(sh, 0x03, 0x05);
  yield* map28AwardShotExp(sh);
  wr(w, 0xC441, 0x0E);
}
// 34:61BB Map28ShotNiceOn ($C3E1 = 1: the ball skipped over the water): "NICE ON!" ($1514, speaker 3), the golfer 5
// and the next, both turn to the player, the golfer 7 and the next; the player faces "actor $C0" (ActorSlotAddr
// gives the player's own slot: no turn, a quirk kept); actor 3 steps $0200 left; the golfer tries the same (game mode
// 6, $C82C = $28, entrance $0D, the strokes 34:6289, the hooks 34:6299)
function* map28ShotNiceOn(sh) {
  const w = sh.w;
  yield* map28ResultStart(sh, 0x07);
  T.scriptSetText(w, 0x1514);
  yield* T.scriptShowText(sh, 0x03);
  yield* animSay(sh, 0x02, 0x05);
  S.actorFaceActor(w, 0x02, 0x00);
  S.actorFaceActor(w, 0x03, 0x00);
  yield* animSay(sh, 0x02, 0x07);
  S.actorFaceActor(w, 0x00, 0xC0);
  S.actorMoveDir(w, 0x03, 0xC0, 0x0200);
  yield* S.waitActorMoveDone(sh, 0x03);
  yield* map28GolferShot(sh, 0x28, 0x0D, 0x06, 0x6289, 0x6299);
}
// 34:6568 Map28ShotResult (entrance 6): quit (#224) nothing; not on the green ($C3E0 = 0): 34:6114; $C3E1 = 1: 34:61BB;
// else 34:6159
function* map28ShotResult(sh) {
  const w = sh.w;
  if (flag(w, 224)) return;
  if (!rd(w, 0xC3E0)) { yield* map28ShotFailed(sh); return; }
  if (rd(w, 0xC3E1) === 0x01) yield* map28ShotNiceOn(sh);
  else yield* map28ShotOnGreen(sh);
}
// 34:62C0 Map28GolferSucceeds (entrance $0D, after the golfer's try): "You did it!" ($1517); actor 3 at ($1700, $1F00),
// fade in (8); he hops, faces the golfer, the text; the golfer faces him, hops, the next; 30 frames; both animation 5,
// 30 frames; both face the player, the golfer 5 and the next, 10 frames; 140 EXP (34:6586), warp $0F
function* map28GolferSucceeds(sh) {
  const w = sh.w;
  T.scriptSetText(w, 0x1517);
  S.actorSetPos(w, 0x03, 0x1700, 0x1F00);
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  S.actorJump(w, 0x03, 0xFF80);
  yield* S.waitActorLanded(sh, 0x03);
  S.actorFaceActor(w, 0x03, 0x02);
  yield* T.scriptShowText(sh, 0x03);
  S.actorFaceActor(w, 0x02, 0x03);
  S.actorJump(w, 0x02, 0xFF80);
  yield* S.waitActorLanded(sh, 0x02);
  yield* T.scriptShowText(sh, 0x02);
  yield* wait(sh, 0x1E);
  S.actorPlayAnim(w, 0x02, 0x05);
  yield* animWait(sh, 0x03, 0x05);
  yield* wait(sh, 0x1E);
  S.actorFaceActor(w, 0x02, 0x00);
  S.actorFaceActor(w, 0x03, 0x00);
  yield* animSay(sh, 0x02, 0x05);
  yield* wait(sh, 0x0A);
  yield* map28AwardShotExp(sh);
  wr(w, 0xC441, 0x0F);
}
// 34:6362 Map28HoleOutAndLeave (entrance $0F) / 34:6412 Map28WalkOff (entrance $0E): (actor 3 at ($1700, $1F00)) both
// face the player, #210, the return point (map 0, $FA), SaveGame, fade in (8); ($151A, speaker 2, and) they face each
// other, the golfer 5 (34:6412: 6) and actor 3 5; the player steps $0200 up with the facing locked; they walk off to
// ($1900, $2900) by ($1900, $2100); 60 frames, warp 1
function* map28Leave(sh, talk) {
  const w = sh.w;
  if (talk) S.actorSetPos(w, 0x03, 0x1700, 0x1F00);
  S.actorFaceActor(w, 0x02, 0x00);
  S.actorFaceActor(w, 0x03, 0x00);
  setFlag(w, 210);
  Ls.saveReturnPoint(w, 0x00, 0xFA);
  saveGame(w);
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  if (talk) { T.scriptSetText(w, 0x151A); yield* T.scriptShowText(sh, 0x02); }
  S.actorFaceActor(w, 0x02, 0x03);
  S.actorFaceActor(w, 0x03, 0x02);
  if (talk) S.actorPlayAnim(w, 0x02, 0x05);
  else yield* animWait(sh, 0x02, 0x06);
  yield* animWait(sh, 0x03, 0x05);
  S.actorLockSpriteFacing(w, 0x00, 0x01);
  S.actorMoveDir(w, 0x00, 0x00, 0x0200);
  yield* S.waitActorMoveDone(sh, 0x00);
  S.actorLockSpriteFacing(w, 0x00, 0x00);
  if (talk) S.actorMoveTo(w, 0x02, 0x1900, 0x2900);
  S.actorMoveTo(w, 0x03, 0x1900, 0x2100);
  yield* S.waitActorMoveDone(sh, 0x03);
  S.actorMoveTo(w, 0x03, 0x1900, 0x2900);
  if (!talk) S.actorMoveTo(w, 0x02, 0x1900, 0x2900);
  yield* wait(sh, 0x3C);
  wr(w, 0xC441, 0x01);
}
// 34:5E53 Map28Enter: #82; the banner's text cleared unless entrance 1; wStoryRoundKind 0; entrance 5 34:5FBE, 6
// 34:6568, $0D 34:62C0, $0E 34:6412, $0F 34:6362
function* map28Enter(sh) {
  const w = sh.w;
  setFlag(w, 82);
  const e = rd(w, 0xC46A);
  if (e !== 0x01) { wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0); }
  wr(w, 0xC967, 0x00);
  if (e === 0x05) yield* map28AfterGolferShot(sh);
  else if (e === 0x06) yield* map28ShotResult(sh);
  else if (e === 0x0D) yield* map28GolferSucceeds(sh);
  else if (e === 0x0E) yield* map28Leave(sh, false);
  else if (e === 0x0F) yield* map28Leave(sh, true);
}
// 34:6528 Map28PlayerShotAfterShot (hook 1): not game mode 5 any more (quit): #224, the round over ($80); holed out
// or on the green (wShotEndLie 6): $C3E0 = 1; skipped on the water (wBallFlags bit 0): $C3E1 = 1; the round over ($80)
function* map28PlayerAfterShot(sh) {
  const w = sh.w;
  if (rd(w, 0xC834) !== 0x05) { setFlag(w, 224); Ls.setGolfEventFlag(w, 0x80); return; }
  if (rd(w, 0xC8AA)) wr(w, 0xC3E0, 0x01);
  if (rd(w, 0xD4DC) === 0x06) wr(w, 0xC3E0, 0x01);
  if (rd(w, 0xD48E) & 0x01) wr(w, 0xC3E1, 0x01);
  Ls.setGolfEventFlag(w, 0x80);
}

const HOOKS_28 = {
  "34:5fb3": function* () {},                     // 34:5FB3 Map28GolferShotShotSetup: ret
  "34:5fb4": function* (sh) { yield* sh.advance(0x1E); Ls.setGolfEventFlag(sh.w, 0x82); },   // 34:5FB4: WaitFramesCmd $1E, over
  "34:62b9": function* () {},                     // 34:62B9 Map28GolferRetryShotSetup: ret
  "34:62ba": function* (sh) { Ls.setGolfEventFlag(sh.w, 0x82); },   // 34:62BA Map28GolferRetryAfterShot
  "34:6527": function* () {},                     // 34:6527 Map28PlayerShotShotSetup: ret
  "34:6528": map28PlayerAfterShot,
};
Object.assign(HOOKS, HOOKS_28);

// ---- map $2C, the Golf Guru's Pitch and Putt (header 34:73C0) ----
// 34:7547 Map2CStartRound: the guru's animation 5, 30 frames; the player walks to the tee ($1D00, $2300), ($2100,
// $2300), ($2100, $2100), 30 frames; wStoryRoundKind $14, GolfSessionInit, game mode $0A, the return point (map $2C,
// entrance 6), the player, no second player, the wind direction 0, the hooks 34:75C8; 34:7516 Map2CPlayCourse: before
// the guru is beaten (#208) course 9's nine holes in game mode $0A ($C82C = $28; SetCourseHole's wind byte is the
// mode's $0A), after it course 6's 18 in game mode 3 ($C82C = 7, the wind byte 3); GolfSessionEnd
function* map2CStartRound(sh) {
  const w = sh.w;
  yield* animWait(sh, 0x02, 0x05);
  yield* wait(sh, 0x1E);
  for (const [bc, de] of [[0x1D00, 0x2300], [0x2100, 0x2300], [0x2100, 0x2100]]) {
    S.actorMoveTo(w, 0x00, bc, de);
    yield* S.waitActorMoveDone(sh, 0x00);
  }
  yield* wait(sh, 0x1E);
  wr(w, 0xC967, 0x14);
  St.golfSessionInit(w);
  wr(w, 0xC834, 0x0A);
  Ls.saveReturnPoint(w, 0x2C, 0x06);
  St.setupPlayerGolfer(w, 0x80, 0x00);
  St.setupPlayerGolfer(w, 0xFF, 0x01);
  Ls.setForcedWindDir(w, 0x00);
  Ls.setGolfEventHook(w, 0x34, 0x75C8);
  if (!sh.playGolfRound) notPorted("the Pitch and Putt round outside the game loop");
  let holes;
  if (!flag(w, 208)) {
    wr(w, 0xC82C, 0x28); wr(w, 0xC834, 0x0A);
    St.setCourseHole(w, 0x0A, 0x09, 0x01);
    holes = 0x09;
  } else {
    wr(w, 0xC82C, 0x07); wr(w, 0xC834, 0x03);
    St.setCourseHole(w, 0x03, 0x06, 0x01);
    holes = 0x12;
  }
  yield* sh.playGolfRound(holes);                                 // 10:4451
  yield* inBankGen(w, 0x10, golfSessionEnd(sh));                  // 10:4B94
}
// 34:7407 Map2CTalkGolfGuru (talk 2): beaten (#208): the first time (#252 clear) $155D (facing the player), then
// 34:74E6; else #209, he faces the player, "Will you test your skills?" ($154F) asked: Yes: the next part, #241 #240
// cleared, 34:7547; No: the part after, his animation 6, facing left, the text
function* map2CTalkGuru(sh) {
  const w = sh.w;
  if (flag(w, 208)) {
    if (!flag(w, 252)) {
      S.actorFaceActor(w, 0x02, 0x00);
      T.scriptSetText(w, 0x155D);
      yield* T.scriptShowText(sh, 0x02);
    }
    yield* map2CAskPlayAgain(sh);
    return;
  }
  setFlag(w, 209);
  S.actorFaceActor(w, 0x02, 0x00);
  T.scriptSetText(w, 0x154F);
  if (!(yield* ask(sh, 0x02))) {
    yield* T.scriptShowText(sh, 0x02);
    clearFlag(w, 241); clearFlag(w, 240);
    yield* map2CStartRound(sh);
    return;
  }
  T.scriptSkipText(w);
  yield* animWait(sh, 0x02, 0x06);
  S.actorSetFacing(w, 0x02, 0xC0);
  yield* T.scriptShowText(sh, 0x02);
}
// 34:74E6 Map2CAskPlayAgain: #252; ScriptBegin; "So will you play?" ($155E, speaker $80; no wait before the question):
// Yes: #241 #240 cleared, 34:7547; ScriptEnd
function* map2CAskPlayAgain(sh) {
  const w = sh.w;
  setFlag(w, 252);
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  T.scriptSetText(w, 0x155E);
  yield* T.scriptShowTextKeepOpen(sh, 0x80);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* wait(sh, 0x05);
  if (!a) { clearFlag(w, 241); clearFlag(w, 240); yield* map2CStartRound(sh); }
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}
// 34:75F6 Map2CRoundResult (entrance 6 with wStoryRoundKind $14): fade in (4), "So what did you shoot?" ($1553); per
// hole of the nine ($C8AC: the strokes to the green in the high nibble, to $C3E0, and the strokes in the low) #241
// when the green was not reached in 0 or 1, #240 when the strokes less those are not 1; $C3E2 = wP1ScoreVsPar + 27
// (8-bit); 19 or more: $1554; else #241: $1556; #240: $1558 with $C3E2; neither (34:76B5): $155A with $C3E2 and the
// next part, then the first time (#208 clear) 300 EXP (sound $38), #208, #159, the save flag $0200 (02:4522), $011B,
// WaitJingleEnd, the level-up screen, the return point (map 0, $FA), SaveGame, warp $0F; (neither and beaten before:
// nothing). The texts of $1554-$1558 (34:7683): the player's animation 7, the guru's 7 and the text, 6 and the next
function* map2CRoundResult(sh) {
  const w = sh.w;
  if (rd(w, 0xC967) !== 0x14) return;
  Scr.beginFadeIn(w, 0x04);
  yield* Scr.waitFade(sh);
  T.scriptSetText(w, 0x1553);
  yield* T.scriptShowText(sh, 0x02);
  for (let k = 0; k < 9; k++) {
    const v = rd(w, 0xC8AC + k), g = v >> 4;
    wr(w, 0xC3E0, g);
    if (g !== 0x01 && g !== 0x00) setFlag(w, 241);          // 34:765D Map2CSetMissedGreenInOne (its bytes run on: the texts 34:7661-)
    if ((((v & 0x0F) - g) & 0xFF) !== 0x01) setFlag(w, 240);   // 34:7659 Map2CSetMissedOnePutt
  }
  const n = (rd(w, 0xC8BE) + 0x1B) & 0xFF;
  wr(w, 0xC3E2, n);
  if (n >= 0x13) T.scriptSetText(w, 0x1554);
  else if (flag(w, 241)) T.scriptSetText(w, 0x1556);
  else if (flag(w, 240)) { T.scriptSetText(w, 0x1558); pushTextNumberArg(w, n); }
  else {
    if (flag(w, 208)) return;
    T.scriptSetText(w, 0x155A);
    pushTextNumberArg(w, n);
    yield* T.scriptShowText(sh, 0x02);
    yield* T.scriptShowText(sh, 0x02);
    if (flag(w, 208)) return;
    addExp(w, 0x012C);
    pushTextNumberArg(w, 0x012C);
    sh.sound(0x38);
    setFlag(w, 208); setFlag(w, 159);
    setSaveFlag(w, 0x0200);                                       // 02:4522
    T.scriptSetText(w, 0x011B);
    yield* T.scriptShowText(sh, 0x80);
    yield* Scr.waitJingleEnd(sh);
    yield* fadeToLevelUpScreen(sh);
    Ls.saveReturnPoint(w, 0x00, 0xFA);
    saveGame(w);
    wr(w, 0xC441, 0x0F);
    return;
  }
  yield* animWait(sh, 0x00, 0x07);
  yield* animSay(sh, 0x02, 0x07);
  yield* animSay(sh, 0x02, 0x06);
}
// 34:74B5 Map2CEnter: entrance 1: wStoryRoundKind 0; else the banner's text cleared; $FA nothing more; 6 (unless
// beaten, #208) 34:75F6; 7 (34:770F: fade in (8), the guru faces the player, $155C with his animation 5); then
// wStoryRoundKind 0 (not after 34:75F6)
function* map2CEnter(sh) {
  const w = sh.w;
  const e = rd(w, 0xC46A);
  if (e !== 0x01) {
    wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0);
    if (e === 0xFA) return;
    if (e === 0x06 && !flag(w, 208)) { yield* map2CRoundResult(sh); return; }
    if (e === 0x07) {
      Scr.beginFadeIn(w, 0x08);
      yield* Scr.waitFade(sh);
      S.actorFaceActor(w, 0x02, 0x00);
      T.scriptSetText(w, 0x155C);
      yield* animSay(sh, 0x02, 0x05);
    }
  }
  wr(w, 0xC967, 0x00);
}
const HOOKS_2C = {
  "34:75e8": function* () {},                     // 34:75E8 Map2CRoundShotSetup: ret
  "34:75e9": function* (sh) { if (!rd(sh.w, 0xC834)) wr(sh.w, 0xC967, 0x00); },   // 34:75E9: quit: wStoryRoundKind 0
};
Object.assign(HOOKS, HOOKS_2C);

// ---- map $29, Raven Woods (header 34:689C) ----
// actor a's +$15 = a (the ROM's `ld [hl], a` after ActorSlotAddr: a is still the slot), in the WRAM bank mapped
function actorField15(w, a) { const hl = A.actorSlotAddr(a); if (hl >> 8) wr(w, (hl + 0x15) & 0xFFFF, a); }
// 04:4CD6 ActorSetFrame: actor hl's frame +$28 / +$29 = c / b; with a graphics bank (+$2B) the frame's tiles queued
// (26:4012 ActorCopyFrameTiles from +$20 to +$38)
function actorSetFrame(w, hl, b, c) {
  D.setWramBank(w, 4);
  wr(w, hl + 0x28, c); wr(w, hl + 0x29, b);
  const bank = rd(w, hl + 0x2B);
  if (bank) A.actorCopyFrameTiles(w, bank, rd(w, hl + 0x20) | rd(w, hl + 0x21) << 8, rd(w, hl + 0x38) | rd(w, hl + 0x39) << 8, c, b);
}
// the crow (actor 3) and the hat (actor 4) back on the pin: 34:711B / 34:7109
function crowOnPin(w) {
  S.actorSetPos(w, 0x03, 0x1FC0, 0x1CE0);
  S.actorSetPos(w, 0x04, 0x2000, 0x1C80);
  S.actorSetScript(w, 0x03, 0x711B, 0x34);
  S.actorSetScript(w, 0x04, 0x7109, 0x34);
}
// 34:6BF7 Map29HatSpriteTask with the priority flags a (re-registered)
function hatTask(w, a) { unregisterFrameTask(w, 0x34, 0x6BF7); registerFrameTask(w, a, 0x34, 0x6BF7); }
// 34:72F9 Map29DrawHatSprite: the template 34:72D0 at the pin ($1FA0, $1C60) less the scroll (the on-screen tests'
// sums are computed and not used), tile + c, attributes | b
function drawHatSprite(w, b, c) {
  const x = (0x1FA0 - (rd(w, 0xC320) | rd(w, 0xC321) << 8)) & 0xFFFF, y = (0x1C60 - (rd(w, 0xC322) | rd(w, 0xC323) << 8)) & 0xFFFF;
  D.inBank(w, 0x34, () => D.queueSpriteTemplate(w, 0x72D0, ((y << 3) >> 8) & 0xFF, ((x << 3) >> 8) & 0xFF, c, b));
}
// 34:7029 Map29DrawSpriteNearPlayer: six frames of the template 34:7000 at the saved player position less ($0100,
// $03C0) and the scroll
function* drawSpriteNearPlayer(sh, b, c) {
  const w = sh.w, r = a => rd(w, a) | rd(w, a + 1) << 8;
  for (let n = 6; n; n--) {
    const x = (r(0xC2A0) - r(0xC320) - 0x0100) & 0xFFFF, y = (r(0xC2A2) - r(0xC322) - 0x03C0) & 0xFFFF;
    D.inBank(w, 0x34, () => D.queueSpriteTemplate(w, 0x7000, ((y << 3) >> 8) & 0xFF, ((x << 3) >> 8) & 0xFF, c, b));
    yield* sh.advance();
  }
}
// 34:7070 Map29AnimSpriteNearPlayer: $C3E0 = 0; frames $58 $58 $54 $54, then three times $50 $54 $58 $54
function* animSpriteNearPlayer(sh) {
  const w = sh.w;
  wr(w, 0xC3E0, 0x00);
  for (const c of [0x58, 0x58, 0x54, 0x54]) yield* drawSpriteNearPlayer(sh, 0x07, c);
  while (rd(w, 0xC3E0) !== 0x03) {
    wr(w, 0xC3E0, rd(w, 0xC3E0) + 1);
    for (const c of [0x50, 0x54, 0x58, 0x54]) yield* drawSpriteNearPlayer(sh, 0x07, c);
  }
}
// 34:7011 Map29LoadSpriteGfx: VRAM bank 0, the tiles 34:6F40 to $8500 ($18 blocks), OBJ palette 7 from 34:7009
function loadSpriteGfx(w) {
  if (w.vram) w.lcd.vbk = 0;
  D.inBank(w, 0x34, () => { D.queueVRAMCopy(w, 0x6F40, 0x8500, 0x18); D.loadPalettesImmediate(w, 0x7009, 0x0F, 0x01); });
}
// 34:72E1 Map29LoadCrowGfx: VRAM bank 0, the tiles 34:7290 to $8400 (4 blocks), OBJ palette 7 (master copy only)
function loadCrowGfx(w) {
  if (w.vram) w.lcd.vbk = 0;
  D.inBank(w, 0x34, () => { D.queueVRAMCopy(w, 0x7290, 0x8400, 0x04); D.loadPalettesMasterOnly(w, 0x7009, 0x0F, 0x01); });
}
// 34:692C Map29ObjectHiddenJoe (object $0F): not when the player is Joe (wCharId 3); #143, $0C5A (speaker 6), Joe
// (actor 6) to ($0D00, $2100), the player hops $0200 up with the facing locked (sound $8A), Joe the same; $0C5E;
// 34:7E12
function* map29ObjectHiddenJoe(sh) {
  const w = sh.w;
  if (rd(w, 0xC810) === 0x03) return;
  setFlag(w, 143);
  T.scriptSetText(w, 0x0C5A);
  yield* T.scriptShowText(sh, 0x06);
  S.actorSetPos(w, 0x06, 0x0D00, 0x2100);
  S.actorLockSpriteFacing(w, 0x00, 0x01);
  for (const a of [0x00, 0x06]) {
    if (a === 0x06) S.actorLockSpriteFacing(w, 0x00, 0x00);
    sh.sound(0x8A);
    S.actorJump(w, a, 0xFF80);
    S.actorMoveDir(w, a, 0x00, 0x0200);
    yield* S.waitActorMoveDone(sh, a);
  }
  T.scriptSetText(w, 0x0C5E);
  yield* T.scriptShowText(sh, 0x06);
  yield* awardFoundAllRivalsExp(sh);
}
// 34:732C Map29AskPlayIfAPressed: A held: 34:7144
function* askPlayIfA(sh) { if (sh.w.high[0x190] & 0x01) yield* map29AskPlayFromHere(sh); }
// 34:7144 Map29AskPlayFromHere: ScriptBegin, "Play from here?" ($1523, speaker $80; no wait before the question): Yes:
// 34:716B; ScriptEnd
function* map29AskPlayFromHere(sh) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  T.scriptSetText(w, 0x1523);
  yield* T.scriptShowTextKeepOpen(sh, 0x80);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* wait(sh, 0x05);
  if (!a) yield* map29StartPinShot(sh);
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}
// 34:716B Map29StartPinShot: wStoryRoundKind $14, $C3E1 = 0, GolfSessionInit, SetP1OffTee; the crow on the pin (#206
// and #207 clear): game mode 5, $C82C = $28; else game mode 7, $C82C = 7; the player, course 0 hole 8 (the wind byte a
// is 0, from ClearMemory16), the wind direction 0, the tee from the player's spot (34:7254), a random wind (34:7215),
// the hooks 34:71CC, one hole
function* map29StartPinShot(sh) {
  const w = sh.w;
  wr(w, 0xC967, 0x14);
  wr(w, 0xC3E1, 0x00);
  St.golfSessionInit(w);
  Ls.setP1OffTee(w);
  const crow = !flag(w, 207) && !flag(w, 206);
  wr(w, 0xC834, crow ? 0x05 : 0x07);
  wr(w, 0xC82C, crow ? 0x28 : 0x07);
  St.setupPlayerGolfer(w, 0x80, 0x00);
  St.setupPlayerGolfer(w, 0xFF, 0x01);
  St.setCourseHole(w, 0x00, 0x00, 0x08);
  Ls.setForcedWindDir(w, 0x00);
  map29SetTeeFromPlayer(w);
  map29SetRandomWind(w);
  Ls.setGolfEventHook(w, 0x34, 0x71CC);
  yield* oneHole(sh, "the Raven Woods pin shot");
}
// 34:7254 Map29SetTeeFromPlayer: SetForcedTee at ($1F80, $1D40) + (the saved player position - that) / 4 (signed)
function map29SetTeeFromPlayer(w) {
  const r = a => rd(w, a) | rd(w, a + 1) << 8;
  const q = (v, o) => (((((v - o) & 0xFFFF) << 16 >> 16) >> 2) + o) & 0xFFFF;
  Ls.setForcedTee(w, q(r(0xC2A0), 0x1F80), q(r(0xC2A2), 0x1D40));
}
// 34:7215 Map29SetRandomWind: $C3E3 = 5 + (the random low byte & 3, 0 -> 1); SetForcedWind ((the next random low byte
// & 7) x 32 - 16) x 256 + $C3E3 (16-bit, the direction in the high byte)
function map29SetRandomWind(w) {
  let a = advanceRandomSeed(w) & 0x03;
  if (!a) a = 0x01;
  wr(w, 0xC3E3, (a + 0x05) & 0xFF);
  const d = advanceRandomSeed(w) & 0x07;
  Ls.setForcedWind(w, (((((d << 5) - 0x10) << 8) & 0xFFFF) + rd(w, 0xC3E3)) & 0xFFFF);
}
// 34:6BFE Map29HatStolenCutscene (trigger 3 the first time): sound $A1 twice 20 frames apart; the script actor at
// speed $20; the crow and the hat on the pin; "Gimme back my hat!" ($151B, speaker 2); the script actor to ($2100,
// $1F00), 60 frames, to ($2700, $2300); the golfer hops three times (sound $89; $FF80, $FF40, $FF80), the next text;
// the script actor back at the player's spot; the crow and hat set up again; #204
function* map29HatStolen(sh) {
  const w = sh.w;
  sh.sound(0xA1);
  yield* wait(sh, 0x14);
  sh.sound(0xA1);
  S.scriptActorSetSpeed(w, 0x0020);
  actorField15(w, 0x03);
  crowOnPin(w);
  T.scriptSetText(w, 0x151B);
  yield* T.scriptShowText(sh, 0x02);
  yield* S.scriptActorGoTo(sh, 0x00, 0x2100, 0x1F00);
  yield* S.waitScriptActorIdle(sh);
  yield* wait(sh, 0x3C);
  yield* S.scriptActorGoTo(sh, 0x00, 0x2700, 0x2300);
  yield* S.waitScriptActorIdle(sh);
  for (const de of [0xFF80, 0xFF40, 0xFF80]) {
    sh.sound(0x89);
    S.actorJump(w, 0x02, de);
    yield* S.waitActorLanded(sh, 0x02);
  }
  yield* T.scriptShowText(sh, 0x02);
  yield* S.scriptActorGoToActor(sh, 0x00, 0x00);
  yield* S.waitScriptActorIdle(sh);
  S.scriptActorSetSpeed(w, 0x0020);
  actorField15(w, 0x03);
  crowOnPin(w);
  setFlag(w, 204);
}
// 34:69A4 Map29Trigger01CrowFlies (trigger 1): done (#207): #206; the hat on the pin (#206): 34:732C; else "OH!
// You idiot!" ($151D): the crow flies off (actor 3's +$15, the scripts 34:7114 / 34:70FC), the script actor to
// ($1700, $1D00), the hat's task at priority 7; the first time only (#205): 90 frames, the golfer faces the player
// and talks, the script actor to ($2500, $2700), the hat's task re-registered (4, then 7), the player faces the golfer,
// two hops (sound $89), the next text, the script actor to ($2100, $2100), the hat's sprite near the player (34:7011,
// sound $8A, 34:7070), the golfer's animation 7 and the text, facing down, animation 6 and the next, the script actor
// back at the player's spot, the player facing down, #206; after the first time just #206
function* map29Trigger01(sh) {
  const w = sh.w;
  if (flag(w, 207)) { setFlag(w, 206); return; }
  if (flag(w, 206)) { yield* askPlayIfA(sh); return; }
  T.scriptSetText(w, 0x151D);
  const hl = A.actorSlotAddr(0x03);
  if (hl >> 8) {
    wr(w, (hl + 0x15) & 0xFFFF, 0x03);
    S.actorSetScript(w, 0x03, 0x7114, 0x34);
    S.actorSetScript(w, 0x04, 0x70FC, 0x34);
    yield* S.scriptActorGoTo(sh, 0x00, 0x1700, 0x1D00);
    yield* S.waitScriptActorIdle(sh);
  }
  hatTask(w, 0x07);
  if (flag(w, 205)) { setFlag(w, 206); return; }
  setFlag(w, 205);
  yield* wait(sh, 0x5A);
  S.actorFaceActor(w, 0x02, 0x00);
  yield* T.scriptShowText(sh, 0x02);
  yield* S.scriptActorGoTo(sh, 0x00, 0x2500, 0x2700);
  yield* S.waitScriptActorIdle(sh);
  hatTask(w, 0x04);
  hatTask(w, 0x07);
  S.actorFaceActor(w, 0x00, 0x02);
  for (let k = 0; k < 2; k++) {
    sh.sound(0x89);
    S.actorJump(w, 0x02, 0xFF80);
    yield* S.waitActorLanded(sh, 0x02);
  }
  yield* T.scriptShowText(sh, 0x02);
  yield* S.scriptActorGoTo(sh, 0x00, 0x2100, 0x2100);
  yield* S.waitScriptActorIdle(sh);
  loadSpriteGfx(w);
  sh.sound(0x8A);
  yield* animSpriteNearPlayer(sh);
  yield* animSay(sh, 0x02, 0x07);
  S.actorSetFacing(w, 0x02, 0x80);
  S.actorPlayAnim(w, 0x02, 0x06);
  yield* T.scriptShowText(sh, 0x02);
  yield* S.scriptActorGoToActor(sh, 0x00, 0x00);
  yield* S.waitScriptActorIdle(sh);
  S.actorSetFacing(w, 0x00, 0x80);
  setFlag(w, 206);
}
// 34:6ABE Map29Trigger02CrowReturns (trigger 2): with #206 and not #207: "The crow came back!" ($1522): the script
// actor heads for ($1F00, $1F00) (not waited for), the crow and hat scripts 34:711B / 7109, the hat's task at 4, the
// text, #206 cleared; then 34:732C
function* map29Trigger02(sh) {
  const w = sh.w;
  if (!flag(w, 207) && flag(w, 206)) {
    T.scriptSetText(w, 0x1522);
    yield* S.scriptActorGoTo(sh, 0x00, 0x1F00, 0x1F00);
    S.actorSetScript(w, 0x03, 0x711B, 0x34);
    S.actorSetScript(w, 0x04, 0x7109, 0x34);
    hatTask(w, 0x04);
    yield* T.scriptShowText(sh, 0x02);
    clearFlag(w, 206);
  }
  yield* askPlayIfA(sh);
}
// 34:6B08 Map29Trigger03HatStolen (trigger 3): the first time (#204 clear) 34:6BFE, else 34:732C
function* map29Trigger03(sh) {
  if (!flag(sh.w, 204)) yield* map29HatStolen(sh);
  else yield* askPlayIfA(sh);
}
// 34:6CF5 Map29TalkHatlessGolfer (talk 2): the script actor (speed $40) walks to the golfer; $1521; he faces up and
// gets the script 34:6D2D; the script actor walks back to the player's spot
function* map29TalkGolfer(sh) {
  const w = sh.w;
  S.scriptActorSetSpeed(w, 0x0040);
  yield* S.scriptActorGoToActor(sh, 0x02, 0x00);
  yield* S.waitScriptActorIdle(sh);
  T.scriptSetText(w, 0x1521);
  yield* T.scriptShowText(sh, 0x02);
  S.actorSetFacing(w, 0x02, 0x00);
  S.actorSetScript(w, 0x02, 0x6D2D, 0x34);
  yield* S.scriptActorGoToActor(sh, 0x00, 0x00);
  yield* S.waitScriptActorIdle(sh);
}
// 34:6D46 Map29PinHitResult (entrance 6, after the pin was hit): with neither #206 nor #207: the golfer at ($1D00,
// $2500), fade in (8), the hat's task (4), $1524 with sound $A1, 5 frames, the crow and hat fly off (34:7133 /
// 34:70FC), 10 frames, the script actor heads for ($1B00, $1D00), #206, 5 frames, sound $A1, 120 frames, the golfer's
// animation 7 twice (the text between), 10 frames, he faces the player and talks, walks to ($1D00, $2100), they face
// each other, his animation 5 and the next text; 200 EXP (a quarter more with #99; sound $38), $011B, WaitJingleEnd,
// the level-up screen, warp 3. Returns the a the ROM leaves (the entrance 6, or 3 after the warp)
function* map29PinHitResult(sh) {
  const w = sh.w;
  if (flag(w, 206) || flag(w, 207)) return 0x06;
  S.actorSetPos(w, 0x02, 0x1D00, 0x2500);
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  registerFrameTask(w, 0x04, 0x34, 0x6BF7);
  T.scriptSetText(w, 0x1524);
  sh.sound(0xA1);
  yield* wait(sh, 0x05);
  actorField15(w, 0x03);
  S.actorSetScript(w, 0x03, 0x7133, 0x34);
  S.actorSetScript(w, 0x04, 0x70FC, 0x34);
  yield* wait(sh, 0x0A);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1B00, 0x1D00);
  setFlag(w, 206);
  yield* wait(sh, 0x05);
  sh.sound(0xA1);
  yield* wait(sh, 0x78);
  yield* animSay(sh, 0x02, 0x07);
  yield* animWait(sh, 0x02, 0x07);
  yield* wait(sh, 0x0A);
  S.actorFaceActor(w, 0x02, 0x00);
  yield* T.scriptShowText(sh, 0x02);
  S.actorMoveTo(w, 0x02, 0x1D00, 0x2100);
  yield* S.waitActorMoveDone(sh, 0x02);
  S.actorFaceActor(w, 0x02, 0x00);
  S.actorFaceActor(w, 0x00, 0x02);
  yield* animSay(sh, 0x02, 0x05);
  let de = 0x00C8;
  if (flag(w, 99)) de = (de + (de >> 2)) & 0xFFFF;
  addExp(w, de);
  pushTextNumberArg(w, de);
  sh.sound(0x38);
  T.scriptSetText(w, 0x011B);
  yield* T.scriptShowText(sh, 0x80);
  yield* Scr.waitJingleEnd(sh);
  yield* fadeToLevelUpScreen(sh);
  wr(w, 0xC441, 0x03);
  return 0x03;
}
// 34:6E5F (entrance 7, after 34:6D46's warp): the golfer at ($1D00, $2100), the crow at ($1B00, $1B00); #207, the
// return point (map 0, $FA), SaveGame, fade in (8), the hat's task (7), the golfer faces up, animation 5, $1527, walks to
// ($1B00, $1C00), animation 7, 10 frames, sound $94, the crow's state 0, he faces the player and talks, animation 5, the
// player's animation 7, the golfer leaves for ($1400, $2F00), the player faces right, 120 frames, fade out (4), warp 1
function* map29HatReturned(sh) {
  const w = sh.w;
  S.actorSetPos(w, 0x02, 0x1D00, 0x2100);
  S.actorSetPos(w, 0x03, 0x1B00, 0x1B00);
  setFlag(w, 207);
  Ls.saveReturnPoint(w, 0x00, 0xFA);
  saveGame(w);
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  registerFrameTask(w, 0x07, 0x34, 0x6BF7);
  S.actorSetFacing(w, 0x02, 0x00);
  yield* animWait(sh, 0x02, 0x05);
  T.scriptSetText(w, 0x1527);
  yield* T.scriptShowText(sh, 0x02);
  S.actorMoveTo(w, 0x02, 0x1B00, 0x1C00);
  yield* S.waitActorMoveDone(sh, 0x02);
  yield* animWait(sh, 0x02, 0x07);
  yield* wait(sh, 0x0A);
  sh.sound(0x94);
  S.actorSetState(w, 0x03, 0x00);
  S.actorFaceActor(w, 0x02, 0x00);
  yield* T.scriptShowText(sh, 0x02);
  yield* animWait(sh, 0x02, 0x05);
  yield* animWait(sh, 0x00, 0x07);
  S.actorMoveTo(w, 0x02, 0x1400, 0x2F00);
  S.actorSetFacing(w, 0x00, 0x40);
  yield* wait(sh, 0x5A);
  yield* wait(sh, 0x1E);
  Scr.beginFadeOut(w, 0x04);
  yield* Scr.waitFade(sh);
  wr(w, 0xC441, 0x01);
}
// 34:6B37 Map29Enter: the hat (actor 4) frame ($40, 2) with +$37 = 1; the banner's text cleared unless entrance 1;
// the crow's tiles (34:72E1); the crow and hat on the pin unless #206; Joe (actor 6) put away at ($0100, $3D00) until
// found (#143); entrance 6 34:6D46; (a = 7: 34:6E5F); entrance $FA back from a pin shot ($14) that hit it ($C3E1 =
// 1): warp 2; else the crow's task 34:7347 (unless #207), wStoryRoundKind 0, the hat's task (4, or 7 with #206)
function* map29Enter(sh) {
  const w = sh.w;
  actorSetFrame(w, A.actorSlotAddr(0x04), 0x40, 0x02);
  const hl = A.actorSlotAddr(0x04);
  if (hl >> 8) wr(w, (hl + 0x37) & 0xFFFF, 0x01);
  let e = rd(w, 0xC46A);
  if (e !== 0x01) { wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0); }
  loadCrowGfx(w);
  if (!flag(w, 206)) crowOnPin(w);
  if (!flag(w, 143)) S.actorSetPos(w, 0x06, 0x0100, 0x3D00);
  let a = rd(w, 0xC46A);
  if (a === 0x06) a = yield* map29PinHitResult(sh);
  if (a === 0x07) { yield* map29HatReturned(sh); return; }
  e = rd(w, 0xC46A);
  if (e === 0xFA && rd(w, 0xC967) === 0x14 && rd(w, 0xC3E1) === 0x01) { wr(w, 0xC441, 0x02); return; }
  if (!flag(w, 207)) registerFrameTask(w, 0x06, 0x34, 0x7347);
  wr(w, 0xC967, 0x00);
  registerFrameTask(w, flag(w, 206) ? 0x07 : 0x04, 0x34, 0x6BF7);
}
// 34:65C3 Map29PinShotSceneStart (hook 4): unless #206: the crow's 12 tile blocks 34:65E0 to $8200 and the task
// 34:66A0 (priority $13)
function map29PinShotSceneStart(w) {
  if (flag(w, 206)) return;
  D.inBank(w, 0x34, () => D.queueVRAMCopy(w, 0x65E0, 0x8200, 0x0C));
  registerFrameTask(w, 0x13, 0x34, 0x66A0);
}
// 34:66A0 Map29CrowOnPinTask: in the green view (wOnGreen 1) with a cup: the crow's template (34:6804 by the frame of
// 34:6704 at hVBlankCount) at the cup's position on the green less the corner, +4, / 8; tile + $20
function crowOnPinTask(w) {
  if (rd(w, 0xD443) !== 0x01) return;
  const cy = rd(w, 0xD43F) | rd(w, 0xD440) << 8;
  if (!cy) return;
  const b = ((((cy - (rd(w, 0xD442) << 8)) & 0xFFFF) + 4) & 0xFFFF) >> 3 & 0xFF;
  const cx = rd(w, 0xD43D) | rd(w, 0xD43E) << 8;
  const d = ((((cx - (rd(w, 0xD441) << 8)) & 0xFFFF) + 4) & 0xFFFF) >> 3 & 0xFF;
  const f = rb(0x34, (0x6704 + w.high[0x18C]) & 0xFFFF);
  const t = (0x6804 + ((f << 1) & 0xFF)) & 0xFFFF;
  const hl = rb(0x34, t) | rb(0x34, t + 1) << 8;
  D.queueSpriteTemplate(w, hl, b, d, 0x20, 0x00, a => rb(0x34, a));
}
// 34:7347 Map29CrowSpriteTask: WRAM4; for actors 3 and 4: PositionSpriteWorld 00:27B4 at their position + ($10,
// $90), tile +$2C x 4, attributes +$2D
function crowSpriteTask(w) {
  D.setWramBank(w, 4);
  for (const a of [0x03, 0x04]) {
    const hl = A.actorSlotAddr(a);
    if (!(hl >> 8)) continue;
    const c = (rd(w, hl + 0x2C) << 2) & 0xFF, b = rd(w, hl + 0x2D);
    const x = ((rd(w, hl + 4) | rd(w, hl + 5) << 8) + 0x10) & 0xFFFF, y = ((rd(w, hl + 6) | rd(w, hl + 7) << 8) + 0x90) & 0xFFFF;
    D.positionSpriteWorld(w, x, y, c, b);
  }
}
// 34:71ED Map29PinShotAfterShot (hook 1): the pin hit (wBallFlags bit 1 or 2): $C3E1 = 1, flag #99 = player 1 holed
// out; the round over ($80)
function* map29PinShotAfterShot(sh) {
  const w = sh.w, f = rd(w, 0xD48E);
  if (f & 0x06) {
    wr(w, 0xC3E1, 0x01);
    clearFlag(w, 99);
    if (rd(w, 0xC8AA)) setFlag(w, 99);
  }
  Ls.setGolfEventFlag(w, 0x80);
}
Object.assign(HOOKS, {
  "34:71ec": function* () {},                     // 34:71EC Map29PinShotShotSetup: ret
  "34:71ed": map29PinShotAfterShot,
  "34:65c3": function* (sh) { map29PinShotSceneStart(sh.w); },   // 34:65C3 (hook 4)
});
// 34:5BC7 Map27SetTeeForBallPile (unreferenced): by $C3E0 (the balls cleared, 9 down to 0: the tests at 34:5BCA) the
// forced tee (10:4C04) at one of ten spots, the hl / de pairs of the branches 34:5BFD + 10 k; above 9 nothing
export function map27SetTeeForBallPile(w) {
  const a = rd(w, 0xC3E0);
  if (a > 9) return;
  const p = 0x5BFD + (9 - a) * 10;
  Ls.setForcedTee(w, rw(0x34, p + 1), rw(0x34, p + 4));
}
export const SCRIPTS = {
  "34:4690": map02Enter,
  "34:4474": sh => map02TriggerEnter(sh, 1, 0x0500, 0x2F00),
  "34:4497": sh => map02TriggerEnter(sh, 2, 0x0500, 0x1B00),
  "34:44c6": sh => map02TriggerEnter(sh, 3, 0x2100, 0x2F00),
  "34:44f5": sh => map02TriggerEnter(sh, 4),
  "34:450c": map02Trigger05,
  ...Object.fromEntries([0x4618, 0x4627, 0x4636, 0x4645, 0x4654, 0x4663, 0x4672, 0x4681].map((a, k) => [`34:${a.toString(16)}`, sh => map02TriggerPlace(sh, 6 + k)])),
  "34:483b": map02Trigger0F,
  "34:77eb": map30Enter,
  "34:7d58": () => {},                           // 34:7D58 Map30ObjectNop (object 1)
  "34:42b6": map06EnterSelectTalkList,
  "34:407f": map06TalkGrumpyGolfer,
  "34:429b": map06Trigger01MutterWindTip,
  "34:5820": map27Enter,
  "34:56c6": map27TalkCaretaker,
  "34:56f7": map27ObjectHiddenSherry,
  "34:576f": map27TriggerCaretaker,
  "34:5e53": map28Enter,
  "34:5e86": map28TriggerPlayCourse,
  "34:5ee1": map28TriggerUnplayable,
  "34:6018": map28TalkKeepTrying,
  "34:6059": function* (sh) { T.scriptSetText(sh.w, 0x1502); yield* T.scriptShowText(sh, 0x02); yield* map28TalkDebate(sh); },   // 34:6059 Map28TalkWhatAmIDoing
  "34:6064": map28TalkDebate,
  "34:74b5": map2CEnter,
  "34:7407": map2CTalkGuru,
  "34:6b37": map29Enter,
  "34:692c": map29ObjectHiddenJoe,
  "34:69a4": map29Trigger01,
  "34:6abe": map29Trigger02,
  "34:6b08": map29Trigger03,
  "34:6cf5": map29TalkGolfer,
  "34:7144": map29AskPlayFromHere,
  ...Object.fromEntries(Object.entries(LOCKERS).map(([k, [d, e]]) => [k, sh => map06OpenLocker(sh, d, e)])),
};
export const TASKS = w => ({
  "34:46df": () => drawMarkerSprite(w, 0x02, 0x30),   // 34:46DF Map02MarkerSpriteTask
  "34:6bf7": () => drawHatSprite(w, 0x07, 0x40),        // 34:6BF7 Map29HatSpriteTask
  "34:7347": () => crowSpriteTask(w),                     // 34:7347 Map29CrowSpriteTask
  "34:66a0": () => crowOnPinTask(w),                      // 34:66A0 Map29CrowOnPinTask
});
