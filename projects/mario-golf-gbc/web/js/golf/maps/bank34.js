// Bank 34's map scripts (REVERSE.md "Bank 34: map scripts of the Field and the side places"): map $06 (the Locker
// Room), map $02 (the Field between the clubs), ...
import * as D from "../render/display.js";
import { registerFrameTask } from "../tasks.js";
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
// 34:4618 ... 34:4681 Map02Trigger06-0D: 34:5530, then warp 6-$0D (Windy Valley ... the Club Maker's Hut), sound $92
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

// 34:7C99 / 7CB5 / 7CD1 Map30DrawPalmRoom / DuneRoom / LinksRoom (by 34:7CED Map30DrawClubRoom: entrance 2-4):
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

export const SCRIPTS = {
  "34:4690": map02Enter,
  "34:4474": sh => map02TriggerEnter(sh, 1, 0x0500, 0x2F00),
  "34:4497": sh => map02TriggerEnter(sh, 2, 0x0500, 0x1B00),
  "34:44c6": sh => map02TriggerEnter(sh, 3, 0x2100, 0x2F00),
  "34:44f5": sh => map02TriggerEnter(sh, 4),
  ...Object.fromEntries([0x4618, 0x4627, 0x4636, 0x4645, 0x4654, 0x4663, 0x4672, 0x4681].map((a, k) => [`34:${a.toString(16)}`, sh => map02TriggerPlace(sh, 6 + k)])),
  "34:483b": map02Trigger0F,
  "34:77eb": map30Enter,
  "34:7d58": () => {},                           // 34:7D58 Map30ObjectNop (object 1)
  "34:42b6": map06EnterSelectTalkList,
  "34:407f": map06TalkGrumpyGolfer,
  "34:429b": map06Trigger01MutterWindTip,
  ...Object.fromEntries(Object.entries(LOCKERS).map(([k, [d, e]]) => [k, sh => map06OpenLocker(sh, d, e)])),
};
export const TASKS = w => ({
  "34:46df": () => drawMarkerSprite(w, 0x02, 0x30),   // 34:46DF Map02MarkerSpriteTask
});
