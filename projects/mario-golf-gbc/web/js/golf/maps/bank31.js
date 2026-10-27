// Bank 31's map scripts (REVERSE.md "Banks 30 and 31"): map $1E, the story's opening: a new character's creation
// (StoryOpeningCreateCharacter 31:43B9, the enter script of map $1E at 31:4052).
import * as D from "../render/display.js";
import * as Scr from "../screen.js";
import * as S from "../script.js";
import * as T from "../msgbox.js";
import { registerFrameTask, unregisterFrameTask } from "../tasks.js";
import { newGame, createCharacter } from "../start.js";
import { advanceRandomSeed } from "../round.js";
import { restoreShadowFromMap } from "../shadow.js";
import { loadPortraitTiles, fillTileBlock3x3, nameEntryScreen } from "../nameentry.js";
import { charYesNoPrompt } from "../levelup.js";
import { rb } from "../rom.js";

const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
const testFlag = (w, n) => w.wram[0][0x840 + (n >> 3)] & (0x80 >> (n & 7));
const setFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] |= 0x80 >> (n & 7); };
const clearFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] &= ~(0x80 >> (n & 7)); };
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}
const B = 0x31;
const PLAYER = 0x03, POINTER = 0x02;              // the actor slots of the script: the new golfer, the hand pointer

// 31:4262 OpeningLoadGfx: LCD off; the tiles 31:4060 -> $8600 (4 blocks) and 31:40B0 -> $8400 ($20 blocks) by VRAM
// DMA, palettes $0A-$0B from 31:40A0 (master only); LCD on
function openingLoadGfx(w) {
  if (!w.vram) return;
  D.inBank(w, B, () => {
    D.disableLCDSafely(w);
    w.lcd.vbk = 0;
    D.startVRAMDMAFromHL(w, 0x4060, 0x8600, 0x04);
    D.loadPalettesMasterOnly(w, 0x40A0, 0x0A, 0x02);
    D.startVRAMDMAFromHL(w, 0x40B0, 0x8400, 0x20);
    D.enableLCD(w);
  });
}
// 31:428C OpeningDrawPortraitFrames: the map shadow restored (05:4492), two 3x3 frames (06:6040: tiles $E0 / $F0,
// attributes 6 / 7, row stride $20) at WRAM5 $D084 / $D08D (attributes $D484 / $D48D), the rows queued to $9880 /
// $B880 (leaves WRAM5 mapped)
function* openingDrawPortraitFrames(sh) {
  const w = sh.w;
  setW(w, 5);
  yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));
  fillTileBlock3x3(w, 0xD084, 0xD484, 0x06, 0xE0, 0x20);
  fillTileBlock3x3(w, 0xD08D, 0xD48D, 0x07, 0xF0, 0x20);
  D.inBank(w, B, () => {
    D.queueVRAMCopy(w, 0xD080, 0x9880, 0x06);
    D.queueVRAMCopy(w, 0xD480, 0xB880, 0x06);
  });
}
// 31:42C8 OpeningLoadPortraitPair: question a's two portraits (31:42E7 OpeningPortraitPairTable) -> tiles $8E00
// (palette 6) / $8F00 (palette 7) (06:5B39 LoadPortraitTiles); a frame
function* openingLoadPortraitPair(sh, a) {
  const w = sh.w, hl = 0x42E7 + 2 * a;
  loadPortraitTiles(w, rb(B, hl), 0x06, 0x8E00);
  loadPortraitTiles(w, rb(B, hl + 1), 0x07, 0x8F00);
  yield* sh.advance();
}
// 31:42EF OpeningPickLeftRight: a = the side to start on (0: the right portrait's spot $78 ... see below): Left / Right
// move the pointer (actor 2) and the cursor ($C471 / $C472) to a portrait (sound $5B); A -> 0 / 1 (sound $5C), B ->
// $FF (sound $5D). The first frame's side: a = 0 goes to 31:4337 (x $78, the actor to $0C00: returns 0), else to
// 31:4315 (x $30, $0800: 1)
function* openingPickLeftRight(sh, a) {
  const w = sh.w;
  yield* sh.advance();
  let h, step = a ? "4315" : "4337";
  for (;;) {
    if (step === "4315") {
      if (rd(w, 0xC471) !== 0x30) {
        wr(w, 0xC471, 0x30); wr(w, 0xC472, 0x40);
        S.actorMoveTo(w, POINTER, 0x0800, 0x0700);
        sh.sound(0x5B);
      }
      h = 1;
    } else if (step === "4337") {
      if (rd(w, 0xC471) !== 0x78) {
        wr(w, 0xC471, 0x78); wr(w, 0xC472, 0x40);
        S.actorMoveTo(w, POINTER, 0x0C00, 0x0700);
        sh.sound(0x5B);
      }
      h = 0;
    }
    yield* sh.advance();                         // 31:4357
    const p = w.high[0x194];                     // hJoyPressed
    if (p & 2) { sh.sound(0x5D); return 0xFF; }
    if (p & 1) { sh.sound(0x5C); return h; }
    step = p & 0x20 ? "4315" : p & 0x10 ? "4337" : "";
  }
}
// 31:435E OpeningDrawCursor: the hand sprite (tile $60, palette 3) at $C471 / $C472, bobbing with wFrameCounter
function openingDrawCursor(w) {
  const b = (rd(w, 0xC4B2) >> 1 | rd(w, 0xC4B2) << 7) & 0x07;
  D.queueSprite16(w, (rd(w, 0xC472) + b) & 0xFF, (rd(w, 0xC471) + b) & 0xFF, 0x60, 0x03);   // 00:26A4
}
// 31:437D OpeningDrawChoiceMarks: by bits 0 / 1 of $C470 (0: none) a mark on the left (31:4230, tiles $40) or the
// right (31:4249, tiles $4C) portrait, at (y $20, x $20) and (y $20, x $68)
function openingDrawChoiceMarks(w) {
  const a = rd(w, 0xC470);
  if (!a) return;
  const read = x => rb(B, x);
  let [hl, c] = a & 1 ? [0x4249, 0x4C] : [0x4230, 0x40];
  D.queueSpriteTemplate(w, hl, 0x20, 0x20, c, 0x02, read);   // 00:26EA
  [hl, c] = a & 2 ? [0x4249, 0x4C] : [0x4230, 0x40];
  D.queueSpriteTemplate(w, hl, 0x20, 0x68, c, 0x02, read);
}
// 31:43B2 OpeningSpriteTask
export function openingSpriteTask(w) {
  if (!w.vram) return;
  openingDrawChoiceMarks(w);
  openingDrawCursor(w);
}

// the pointer walks back to its spot (x $0A00, y $0700), faces down, a pause, animation a (5 nod / 6 shake), a pause
function* pointerBack(sh, anim, wait1, wait2) {
  const w = sh.w;
  S.actorMoveTo(w, POINTER, 0x0A00, 0x0700);
  yield* S.waitActorMoveDone(sh, POINTER);
  S.actorSetFacing(w, POINTER, 0x40);
  yield* S.scriptWaitFrames(sh, wait1);
  S.actorPlayAnim(w, POINTER, anim);
  yield* S.waitActorAnimDone(sh, POINTER);
  yield* S.scriptWaitFrames(sh, wait2);
}
// a question: portrait pair q, text id, the pick; B on it: the pointer shakes its head (anim 6) and the previous
// question is asked again (returns null); else the flag n is the pick, $C470 = pick + 1, the text closed, the
// pointer nods
function* question(sh, q, text, flag) {
  const w = sh.w;
  yield* openingLoadPortraitPair(sh, q);
  wr(w, 0xC470, 0);
  T.scriptSetText(w, text);
  yield* T.scriptShowTextKeepOpen(sh, 0x8B);
  return yield* openingPickLeftRight(sh, 0);
}

// 31:43B9 StoryOpeningCreateCharacter (map $1E's enter script, 31:4052): NewGame; boy or girl (flag #0), the
// character (flag #1; 31:4791 OpeningCharTable -> 02:4E82 CreateCharacter), the hand (flag #2 -> $C811), a random
// $C83E; the confirm screen (41:6784 CharYesNoPrompt); the name (06:51DC NameEntryScreen); flag #97, warp 1
function* storyOpeningCreateCharacter(sh) {
  const w = sh.w;
  D.inBank(w, 0x02, () => newGame(w));           // 02:4E3D
  for (let k = 0; k < 4; k++) wr(w, 0xC0F0 + k, 0);   // 00:2CF9 ResetGameTimer
  setFlag(w, 28);
  openingLoadGfx(w);
  wr(w, 0xC470, 0);
  w.high[0x18B] = 0; w.high[0x18A] = 0;          // hSCX, hSCY
  wr(w, 0xC471, 0xF0); wr(w, 0xC472, 0xF0);
  T.scriptSetText(w, 0x0845);
  D.inBank(w, B, () => registerFrameTask(w, 0x01, B, 0x43B2));   // OpeningSpriteTask
  S.actorSetPos(w, rd(w, 0xC296), 0x3F00, 0x3F00);
  S.actorSetPos(w, rd(w, 0xC298), 0x3F00, 0x3F00);
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  yield* sh.advance(1);                          // 00:2ED5 WaitFramesCmd 1
  S.actorMoveTo(w, PLAYER, 0x0A00, 0x0B00);
  yield* S.waitActorMoveDone(sh, PLAYER);
  S.actorSetFacing(w, PLAYER, 0x40);
  yield* S.scriptWaitFrames(sh, 0x14);
  S.actorPlayAnim(w, PLAYER, 0x05);
  yield* S.waitActorAnimDone(sh, PLAYER);
  yield* S.scriptWaitFrames(sh, 0x14);
  S.actorMoveTo(w, PLAYER, 0x0200, 0x0B00);
  yield* S.waitActorMoveDone(sh, PLAYER);
  S.actorSetFacing(w, PLAYER, 0x40);
  yield* S.scriptWaitFrames(sh, 0x14);
  yield* T.scriptShowText(sh, 0x8B);
  yield* T.scriptShowText(sh, 0x8B);
  S.actorMoveTo(w, POINTER, 0x0A00, 0x0700);
  yield* S.waitActorMoveDone(sh, POINTER);
  let at = "4473";
  for (;;) {
    if (at === "4473") {                         // boy or girl
      yield* openingDrawPortraitFrames(sh);
      let a;
      do a = yield* question(sh, 0, 0x0847, 0); while (a === 0xFF);   // (B: asked again)
      wr(w, 0xC473, a);                          // wNavCursor
      clearFlag(w, 0);
      if (a) setFlag(w, 0);
      wr(w, 0xC470, (a + 1) & 0xFF);
      wr(w, 0xC471, 0xF0);
      yield* T.scriptCloseText(sh);
      yield* pointerBack(sh, 0x05, 0x0A, 0x14);
      at = "44DF";
    }
    if (at === "44DF") {                         // the character: pair 1 or 2 by the first pick
      const a = yield* question(sh, (rd(w, 0xC473) + 1) & 0xFF, 0x0848, 1);
      if (a === 0xFF) {
        wr(w, 0xC470, 0xFF); wr(w, 0xC471, 0xF0);
        yield* pointerBack(sh, 0x06, 0x0A, 0x0A);
        at = "4476";
      } else {
        clearFlag(w, 1);
        if (a) setFlag(w, 1);
        wr(w, 0xC470, (a + 1) & 0xFF); wr(w, 0xC471, 0xF0);
        yield* T.scriptCloseText(sh);
        yield* pointerBack(sh, 0x05, 0x0A, 0x14);
        at = "4584";
      }
    }
    if (at === "4476") {                         // (31:4476: the first question again, without the frames)
      let a;
      do a = yield* question(sh, 0, 0x0847, 0); while (a === 0xFF);
      wr(w, 0xC473, a);
      clearFlag(w, 0);
      if (a) setFlag(w, 0);
      wr(w, 0xC470, (a + 1) & 0xFF);
      wr(w, 0xC471, 0xF0);
      yield* T.scriptCloseText(sh);
      yield* pointerBack(sh, 0x05, 0x0A, 0x14);
      at = "44DF";
      continue;
    }
    if (at === "4584") {                         // the hand
      const a = yield* question(sh, 3, 0x0849, 2);
      if (a === 0xFF) {
        wr(w, 0xC470, 0xFF); wr(w, 0xC471, 0xF0);
        yield* pointerBack(sh, 0x06, 0x0A, 0x0A);
        at = "44DF";
        continue;
      }
      clearFlag(w, 2);
      if (a) setFlag(w, 2);
      wr(w, 0xC470, (a + 1) & 0xFF); wr(w, 0xC471, 0xF0);
      yield* T.scriptCloseText(sh);
      yield* pointerBack(sh, 0x05, 0x0A, 0x14);
      at = "4627";
    }
    if (at === "4627") {                         // the character made, the confirm screen
      let a = 0;
      if (testFlag(w, 0)) a |= 1;
      if (testFlag(w, 1)) a |= 2;
      D.inBank(w, 0x02, () => createCharacter(w, rb(B, 0x4791 + a)));   // 02:4E82 (a = 0)
      if (testFlag(w, 2)) wr(w, 0xC811, 1);
      const r = advanceRandomSeed(w) >> 8 & 7;   // 00:0A61
      wr(w, 0xC83E, r === 6 ? 0 : r);
      wr(w, 0xC470, 0);
      Scr.beginFadeOut(w, 0x10);
      yield* Scr.waitFade(sh);
      clearFlag(w, 28); setFlag(w, 24); setFlag(w, 20);
      const ok = yield* inBankGen(w, 0x41, charYesNoPrompt(sh, 0, 0));   // 41:6784
      clearFlag(w, 20); clearFlag(w, 24); setFlag(w, 28);
      setW(w, 1);
      openingLoadGfx(w);
      yield* sh.advance();
      yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));
      yield* sh.advance();
      setW(w, 5);
      D.inBank(w, B, () => D.queueVRAMCopy(w, 0xD000, 0x9800, 0x24));
      yield* sh.advance();
      D.inBank(w, B, () => D.queueVRAMCopy(w, 0xD400, 0xB800, 0x24));
      Scr.beginFadeIn(w, 0x10);
      yield* Scr.waitFade(sh);
      if (!ok) {                                 // No: the questions again
        yield* sh.advance();
        yield* openingDrawPortraitFrames(sh);
        at = "4476";
        continue;
      }
      at = "46C6";
    }
    if (at === "46C6") {                         // the name
      T.scriptSetText(w, 0x084A);
      yield* T.scriptShowText(sh, 0x8B);
      wr(w, 0xC470, 0);
      setFlag(w, 20);
      const a = yield* inBankGen(w, 0x06, nameEntryScreen(sh));   // 06:51DC
      clearFlag(w, 20);
      if (a === 0xFF) {                          // B: back to the character's confirm screen
        setFlag(w, 20);
        Scr.beginFadeOut(w, 0x7F);
        yield* Scr.waitFade(sh);
        at = "4627";
        continue;
      }
      break;
    }
  }
  // 31:46F0
  clearFlag(w, 22);
  wr(w, 0xC82D, rd(w, 0xC82D) & 0x7F);           // wTextSpeed
  yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));
  setW(w, 5);
  D.inBank(w, B, () => {
    D.queueVRAMCopy(w, 0xD000, 0x9800, 0x24);
    D.queueVRAMCopy(w, 0xD400, 0xB800, 0x24);
  });
  T.scriptSetText(w, 0x084B);
  yield* T.scriptShowText(sh, 0x8B);
  unregisterFrameTask(w, B, 0x43B2);
  yield* sh.advance(0x0A);                       // WaitFramesCmd $0A
  Scr.beginFadeOut(w, 0x04);
  yield* Scr.waitFade(sh);
  yield* S.scriptWaitFrames(sh, 0x46);
  for (let k = 0; k < 0x30; k++) wr(w, 0xC210 + k, 0);   // 00:039F ClearBytes (the sprite queue's entries)
  setFlag(w, 20);
  Scr.beginFadeIn(w, 0x04);
  yield* Scr.waitFade(sh);
  sh.sound(0x00);
  wr(w, 0xC82D, rd(w, 0xC82D) | 0x80);
  T.scriptSetText(w, 0x0486);
  yield* T.scriptShowTextKeepOpen(sh, 0x86);
  yield* S.scriptWaitFrames(sh, 0x6E);
  yield* T.scriptCloseText(sh);
  wr(w, 0xC82D, rd(w, 0xC82D) & 0x7F);
  Scr.beginFadeOut(w, 0x04);
  yield* Scr.waitFade(sh);
  yield* S.scriptWaitFrames(sh, 0x3C);
  clearFlag(w, 20);
  wr(w, 0xC441, 1);                              // wMapWarpRequest: map $05 entrance 2
  setFlag(w, 97);
  clearFlag(w, 28);
}

export const SCRIPTS = {
  "31:4052": storyOpeningCreateCharacter,        // 31:4052 Map1EEnter: call 31:43B9
};
export const TASKS = w => ({
  "31:43b2": () => openingSpriteTask(w),         // 31:43B2 OpeningSpriteTask
});
