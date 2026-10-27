// Bank 31's map scripts (REVERSE.md "Banks 30 and 31"): map $1E, the story's opening: a new character's creation
// (StoryOpeningCreateCharacter 31:43B9, the enter script of map $1E at 31:4052).
import * as D from "../render/display.js";
import * as Scr from "../screen.js";
import * as S from "../script.js";
import * as T from "../msgbox.js";
import { registerFrameTask, unregisterFrameTask } from "../tasks.js";
import { newGame, createCharacter } from "../start.js";
import { advanceRandomSeed, golfViewExit } from "../round.js";
import { restoreShadowFromMap } from "../shadow.js";
import { loadPortraitTiles, fillTileBlock3x3, nameEntryScreen } from "../nameentry.js";
import { charYesNoPrompt } from "../levelup.js";
import { rb } from "../rom.js";
import * as M from "../mapengine.js";
import { mapBufCopyRectRedraw } from "../mapgfx.js";
import { pushTextNumberArg, setTextCourseIndex } from "../text.js";
import { saveGame } from "../save.js";
import * as Ls from "./lessons.js";

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


// ---- the award ceremonies, maps $18-$1B (Marion, Palm, Dune, Links; one header 31:76B1) ----
function notPorted(what) { throw new Error(`${what} is not ported`); }
function* wait(sh, n) { yield* S.scriptWaitFrames(sh, n); }
function* moveAndWait(sh, a, bc, de) { S.actorMoveTo(sh.w, a, bc, de); yield* S.waitActorMoveDone(sh, a); }
function* animAndWait(sh, a, anim) { S.actorPlayAnim(sh.w, a, anim); yield* S.waitActorAnimDone(sh, a); }
// 31:7775 CeremonyEnter: BeginFadeOut ($7F); per map: Links ($1B) its warp list (31:774A) and palettes 31:7C80;
// Dune ($1A), Palm ($19), Marion ($18): seen before (flags #109 / #108 / #107) -> warp 2 (31:776F), else the flag
// set at entrance 2, Dune / Palm their palettes (31:7C40 / 31:7C00, 6 from 2: master only) and warp lists (31:7739
// / 31:7728), Dune flag #212 (31:7CB0); entrance 0-1: nothing; after the ending (#110): ~31:782F (the picture and
// the staff credits) not ported; entrance 2: the champion (actors 4, 5 off; 31:78E1), result 1, Links: ~31:7827 (the
// ending) not ported; entrance 3 / 4: the second / third place (31:7B86 / 7B96 the podium's tiles; actors 3 and 5 /
// 3 and 4 off; 31:7B1C), result 2 / 3; then warp 2 for a mode-select tournament (wStoryRoundKind $32), else warp
// 1; any other entrance: kind $63, result 5, warp 1
function* ceremonyEnter(sh) {
  const w = sh.w;
  Scr.beginFadeOut(w, 0x7F);
  const m = rd(w, 0xC450), e0 = rd(w, 0xC46A);
  const seen = { 0x1A: 109, 0x19: 108, 0x18: 107 }[m];
  if (m === 0x1B) {
    M.scriptSetMapField(w, 0x774A, 0x0008);
    if (w.vram) D.inBank(w, B, () => D.loadPalettesMasterOnly(w, 0x7C80, 0x02, 0x06));
  } else {
    if (testFlag(w, seen)) { wr(w, 0xC441, 0x02); return; }       // 31:776F
    if (e0 === 0x02) setFlag(w, seen);
    if (m === 0x1A) {
      M.scriptSetMapField(w, 0x7739, 0x0008);
      if (w.vram) D.inBank(w, B, () => D.loadPalettesMasterOnly(w, 0x7C40, 0x02, 0x06));
      if (testFlag(w, 198) && testFlag(w, 114)) setFlag(w, 212);  // 31:7CB0 CeremonyDuneSetFlag212
    } else if (m === 0x19) {
      if (w.vram) D.inBank(w, B, () => D.loadPalettesMasterOnly(w, 0x7C00, 0x02, 0x06));
      M.scriptSetMapField(w, 0x7728, 0x0008);
    }
  }
  const e = rd(w, 0xC46A);                                        // 31:77F5
  if (e < 0x02) return;
  if (testFlag(w, 110)) notPorted("the ceremony after the ending (~31:782F)");
  let result;
  if (e === 0x02) {
    S.actorSetState(w, 0x04, 0x00);
    S.actorSetState(w, 0x05, 0x00);
    yield* ceremonyChampion(sh);
    wr(w, 0xC96C, 0x01);
    if (rd(w, 0xC450) === 0x1B) notPorted("the Links Champion's ending (~31:7827)");
  } else if (testFlag(w, 110)) { wr(w, 0xC441, 0x02); return; }   // 31:786B (unreachable: tested above)
  else if (e === 0x03 || e === 0x04) {
    yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, e === 0x03 ? 0x16 : 0x19, 0x0A, 0x0A, 0x0A, 0x02, 0x02));
    S.actorSetState(w, 0x03, 0x00);
    S.actorSetState(w, e === 0x03 ? 0x05 : 0x04, 0x00);
    yield* ceremonyPlaceTrophy(sh);
    result = e === 0x03 ? 0x02 : 0x03;
    wr(w, 0xC96C, result);
  } else {
    wr(w, 0xC967, 0x63); wr(w, 0xC96C, 0x05); wr(w, 0xC441, 0x01);   // 31:78CB
    return;
  }
  wr(w, 0xC441, rd(w, 0xC967) === 0x32 ? 0x02 : 0x01);           // 31:785E / 31:78DB
}
// 31:7B5E CeremonySetCourseText: SetTextCourseIndex 05:57C3 = 1-4 by the map ($18-$1B)
function ceremonySetCourseText(w) {
  const m = rd(w, 0xC450);
  D.inBank(w, 0x05, () => setTextCourseIndex(w, m === 0x1B ? 4 : m === 0x1A ? 3 : m === 0x19 ? 2 : 1));
}
// 31:78E1 CeremonyChampion: ScriptBegin, sound 4 (the music), 60 frames, the player walks up (ScriptActorGoTo
// $0B00, $0E00), sound $93, fade in; the presenter (actor 2): animation 5, $0C3C with the course, the player's
// animation 7, the presenter looks around, $0C3D (Marion: $0C3E), then $0C3F, sound $93, the player turns and
// bows twice, faces the presenter, who bows; then 31:7A00
function* ceremonyChampion(sh) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  sh.sound(0x04);
  yield* wait(sh, 0x3C);
  yield* S.scriptActorGoTo(sh, 0x00, 0x0B00, 0x0E00);
  yield* S.waitScriptActorIdle(sh);
  sh.sound(0x93);
  Scr.beginFadeIn(w, 0x04);
  yield* Scr.waitFade(sh);
  yield* wait(sh, 0x1E);
  T.scriptSetText(w, 0x0C3C);
  yield* animAndWait(sh, 0x02, 0x05);
  yield* wait(sh, 0x0A);
  ceremonySetCourseText(w);
  yield* T.scriptShowText(sh, 0x02);
  yield* animAndWait(sh, 0x00, 0x07);
  for (const [b, n] of [[0x40, 0x1E], [0x80, 0x1E], [0x40, 0x0A], [0x00, 0x1E]]) {
    S.actorSetFacing(w, 0x02, b);
    yield* wait(sh, n);
  }
  S.actorSetFacing(w, 0x02, 0x40);
  if (rd(w, 0xC450) === 0x18) T.scriptSetText(w, 0x0C3E);
  yield* T.scriptShowText(sh, 0x02);
  T.scriptSetText(w, 0x0C3F);
  sh.sound(0x93);
  S.actorSetFacing(w, 0x00, 0x80);
  yield* wait(sh, 0x14);
  yield* animAndWait(sh, 0x00, 0x05);
  S.actorSetFacing(w, 0x00, 0x00);
  yield* animAndWait(sh, 0x00, 0x05);
  yield* wait(sh, 0x14);
  S.actorSetFacing(w, 0x00, 0x40);
  yield* wait(sh, 0x14);
  yield* animAndWait(sh, 0x00, 0x05);
  S.actorFaceActor(w, 0x02, 0x00);
  yield* wait(sh, 0x14);
  yield* animAndWait(sh, 0x02, 0x05);
  yield* ceremonyCongratsAndLeave(sh);
}
// 31:7B1C CeremonyPlaceTrophy: ScriptBegin, sound 4, 60 frames, fade in, 20 frames, the presenter's animation 5,
// $0C41 with the place (wMapEntrance - 1, PushTextNumberArg 05:551F); then 31:7A00
function* ceremonyPlaceTrophy(sh) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  sh.sound(0x04);
  yield* wait(sh, 0x3C);
  Scr.beginFadeIn(w, 0x04);
  yield* Scr.waitFade(sh);
  yield* wait(sh, 0x14);
  yield* animAndWait(sh, 0x02, 0x05);
  T.scriptSetText(w, 0x0C41);
  pushTextNumberArg(w, (rd(w, 0xC46A) - 1) & 0xFF);
  yield* ceremonyCongratsAndLeave(sh);
}
// 31:7A00 CeremonyCongratsAndLeave: the current text (speaker 2), actors 2-5 at speed 8; the presenter steps aside
// and the golfers (3-5) gather, the presenter faces the player and bows, the player bows, $0C40 (speaker 2), sound
// $93, 30 frames, the player's animation 7, 30 frames, warp 1, fade out (speed 8), 90 frames, ScriptEnd
function* ceremonyCongratsAndLeave(sh) {
  const w = sh.w;
  yield* T.scriptShowText(sh, 0x02);
  for (const a of [0x02, 0x03, 0x04, 0x05]) S.actorSetSpeed(w, a, 0x0008);
  S.actorSetFacing(w, 0x02, 0x80);
  yield* moveAndWait(sh, 0x02, 0x0A00, 0x0F00);
  for (const a of [0x03, 0x04, 0x05]) S.actorMoveTo(w, a, 0x0A80, 0x0E00);
  S.actorLockSpriteFacing(w, 0x02, 0x01);
  yield* moveAndWait(sh, 0x02, 0x0A80, 0x0F00);
  S.actorLockSpriteFacing(w, 0x02, 0x00);
  S.actorSetFacing(w, 0x02, 0xC0);
  for (const a of [0x03, 0x04, 0x05]) S.actorMoveTo(w, a, 0x0B40, 0x0C00);
  yield* moveAndWait(sh, 0x02, 0x0B00, 0x0C80);
  S.actorFaceActor(w, 0x02, 0x00);
  yield* wait(sh, 0x14);
  yield* animAndWait(sh, 0x02, 0x05);
  yield* animAndWait(sh, 0x00, 0x05);
  T.scriptSetText(w, 0x0C40);
  yield* T.scriptShowText(sh, 0x02);
  sh.sound(0x93);
  yield* wait(sh, 0x1E);
  yield* animAndWait(sh, 0x00, 0x07);
  yield* wait(sh, 0x1E);
  wr(w, 0xC441, 0x01);
  Scr.beginFadeOut(w, 0x08);
  yield* Scr.waitFade(sh);
  yield* wait(sh, 0x5A);
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}

// ---- the driving ranges: map $0C (the Marion Club's; maps $0F, $12, $15 share the practice): maps/lessons.js ----
const LESSONS = {
  // 31:4A8B Map0CTalk03DriverLesson (coach 1, actor 3): the driver
  driver: { bank: B, map: 0x0C, coach: 0x03, flag: 101, seen: 162, ask: 0x102F, retry: 0x0D11, after: 0x1036,
    no: 0x103D, talkScript: 0x7CBE, walkBack: 0x7D24, walkFacing: 0x00, afterFade: 0x08,
    demo: { entrance: 4, mode: 0x06, strokes: 0x4C88, golfer: 0x4F, hole: 0x07, tee: [0x1400, 0x3980], wind: 0xC005,
      hooks: 0x4C98, offTee: false },
    try: { entrance: 6, mode: 0x06, hole: 0x07, tee: [0x1400, 0x3980], shot: [0x00, 0xC4D2], wind: 0xC005,
      hooks: 0x4D14, offTee: false } },
  // 31:4B11 Map0CTalk04IronShotLesson (coach 2, actor 4): the iron shot
  iron: { bank: B, map: 0x0C, coach: 0x04, flag: 102, seen: 163, ask: 0x103F, retry: 0x0D12, after: 0x1046,
    no: 0x104D, talkScript: 0x7CBE, walkBack: 0x7D2D, walkFacing: 0x00, afterFade: 0x08,
    demo: { entrance: 5, mode: 0x06, strokes: 0x4F66, golfer: 0x4E, hole: 0x07, tee: [0x2000, 0x38E0], wind: 0xC005,
      hooks: 0x4F76, offTee: false },
    try: { entrance: 7, mode: 0x06, hole: 0x07, tee: [0x2000, 0x38E0], shot: [0x03, 0xBD40], wind: 0xC005,
      hooks: 0x4FF2, offTee: false } },
};
// the Palm driving range (map $0F): its coaches' demos give the coach's golfer record a 210 drive ($C89A-$C89B =
// $00D2) and the intentional shot's $C89D = 3; the tries' music is $0A
const map0FPre = (curve) => w => { if (curve) wr(w, 0xC89D, 0x03); wr(w, 0xC89A, 0xD2); wr(w, 0xC89B, 0x00); };
const LESSONS_0F = {
  // 31:540E Map0FTalk03IntentionalShotLesson (coach 1, actor 3): the intentional hook / slice
  curve: { bank: B, map: 0x0F, coach: 0x03, flag: 101, seen: 166, ask: 0x104E, retry: 0x0D11, after: 0x1056,
    no: 0x1057, talkScript: 0x7CBE, walkBack: 0x7D24, resultWalk: [0x7D2D, 0x00], walkFacing: 0x00, afterFade: 0x08,
    music: 0x0A,
    demo: { entrance: 4, mode: 0x06, strokes: 0x5600, golfer: 0x4F, hole: 0x0A, tee: [0x2000, 0x3A80], wind: 0xC000,
      pre: map0FPre(true), hooks: 0x5610, offTee: false },
    try: { entrance: 6, mode: 0x06, hole: 0x0A, tee: [0x2000, 0x3A80], shot: [0x00, 0xC000], wind: 0xC000,
      hooks: 0x5681, offTee: false } },
  // 31:54A2 Map0FTalk04WindShotLesson (coach 2, actor 4): the shot into the wind
  wind: { bank: B, map: 0x0F, coach: 0x04, flag: 102, seen: 167, ask: 0x1061, retry: 0x0D12, after: 0x1068,
    no: 0x1069, talkScript: 0x7CBE, walkBack: 0x7D2D, walkFacing: 0x00, afterFade: 0x08, music: 0x0A,
    demo: { entrance: 5, mode: 0x06, strokes: 0x5913, golfer: 0x4E, hole: 0x0A, tee: [0x17C0, 0x3A40], wind: 0x4005,
      pre: map0FPre(false), hooks: 0x5923, offTee: false },
    try: { entrance: 7, mode: 0x06, hole: 0x0A, tee: [0x17C0, 0x3A40], shot: [0x03, 0xBF4C], wind: 0x4005,
      hooks: 0x599F, offTee: false } },
};
// 31:5800 Map0FIntentionalShotJudgeShot: 2 off the fairway; 3 no curve (the stroke record's +$0C bits 4-5 clear); 5
// the ball's y ($D404) $2480 or more; 4 wBallFlags ($D48E) bit 4 (the tree); else 0 (quirk: the x test 31:582D is
// never reached)
function curveJudge(sh) {
  const w = sh.w;
  D.setWramBank(w, 6);
  const r6 = w.wram[6];
  if (Ls.ballLie(sh) !== 0) return 2;
  if (!(r6[0x68C] & 0x30)) return 3;
  if (!(((r6[0x404] | r6[0x405] << 8) - 0x2480) & 0x8000)) return 5;
  return r6[0x48E] & 0x10 ? 4 : 0;
}
// 31:5711 Map0FIntentionalShotLessonResult (entrance 6): 0 the cheer, $105D, passed; 1 $105C; 2 $105B; 3 $105F; 4 the
// cheer, $105E, passed; else $1060; the coach walks back with coach 2's script (31:7D2D)
function* curveResult(sh) {
  const w = sh.w, L = LESSONS_0F.curve;
  yield* Ls.lessonResultBegin(sh, L);
  const r = rd(w, 0xC968);
  if (r === 0 || r === 4) { yield* Ls.lessonCheer(sh, L); yield* Ls.coachSays(sh, L, r ? 0x105E : 0x105D); Ls.lessonPassed(w, L); }
  else { yield* S.scriptWaitFrames(sh, 0x1E); yield* Ls.coachSays(sh, L, { 1: 0x105C, 2: 0x105B, 3: 0x105F }[r] ?? 0x1060); }
  yield* Ls.lessonResultEnd(sh, L);
}
// 31:5A27 Map0FWindShotLessonResult (entrance 7; the judgement 31:5ABA is the iron shot's): 0 the cheer, $106F,
// passed; 1 $106E; else $106D
function* windResult(sh) {
  const w = sh.w, L = LESSONS_0F.wind;
  yield* Ls.lessonResultBegin(sh, L);
  const r = rd(w, 0xC968);
  if (r === 0) { yield* Ls.lessonCheer(sh, L); yield* Ls.coachSays(sh, L, 0x106F); Ls.lessonPassed(w, L); }
  else { yield* S.scriptWaitFrames(sh, 0x1E); yield* Ls.coachSays(sh, L, r === 1 ? 0x106E : 0x106D); }
  yield* Ls.lessonResultEnd(sh, L);
}
// 31:5543 Map0FEnter: (no fade of its own) not entrance 1: no name banner; 4 / 5 after a demo; 6 / 7 a lesson's result
// and a first success (25 EXP, warp 8 / 9); $FA: flag #100 cleared
function* map0FEnter(sh) {
  const w = sh.w, e = rd(w, 0xC46A);
  if (e !== 1) { wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0); }
  if (e === 4) yield* Ls.lessonAfterDemo(sh, LESSONS_0F.curve);
  else if (e === 5) yield* Ls.lessonAfterDemo(sh, LESSONS_0F.wind);
  else if (e === 6) { yield* curveResult(sh); yield* Ls.lessonFirstSuccess(sh, LESSONS_0F.curve, 0x0019, 8, saveGame); }
  else if (e === 7) { yield* windResult(sh); yield* Ls.lessonFirstSuccess(sh, LESSONS_0F.wind, 0x0019, 9, saveGame); }
  else if (e === 0xFA && testFlag(w, 100)) clearFlag(w, 100);
}
// the Dune driving range (map $12): the demos give the coach a 220 drive ($C89A-$C89B = $00DC; the high shot also
// $C89C = 4), the tries' music is 9
const LESSONS_12 = {
  // 31:5D2A Map12Talk03HighShotLesson (coach 1, actor 3): the high shot
  high: { bank: B, map: 0x12, coach: 0x03, flag: 101, seen: 170, ask: 0x1070, retry: 0x0D11, after: 0x1078,
    no: 0x107F, talkScript: 0x7CBE, walkBack: 0x7D24, resultWalk: [0x7D2D, 0x00], walkFacing: 0x00, afterFade: 0x08,
    music: 0x09,
    demo: { entrance: 4, mode: 0x06, strokes: 0x5EF7, golfer: 0x4F, hole: 0x0D, tee: [0x2400, 0x3A40], wind: 0x4002,
      pre: w => { wr(w, 0xC89A, 0xDC); wr(w, 0xC89B, 0x00); wr(w, 0xC89C, 0x04); }, hooks: 0x5F07, offTee: false },
    // (quirk: SetForcedShot twice, 31:615E club 4 then 31:616C club $0A after the wind)
    try: { entrance: 6, mode: 0x06, hole: 0x0D, tee: [0x2400, 0x3A40], shot: [0x04, 0xC2F8], wind: 0x4002,
      pre: w => Ls.setForcedShot(w, 0x0A, 0xC2F8), hooks: 0x5F58, offTee: false } },
  // 31:5DBF Map12Talk04TreeRecoveryLesson (coach 2, actor 4): the low shot out of the trees
  tree: { bank: B, map: 0x12, coach: 0x04, flag: 102, seen: 171, ask: 0x1080, retry: 0x0D12, after: 0x1087,
    no: 0x108D, talkScript: 0x7CBE, walkBack: 0x7D2D, walkFacing: 0x00, afterFade: 0x08, music: 0x09,
    demo: { entrance: 5, mode: 0x06, strokes: 0x6185, golfer: 0x4E, hole: 0x0D, tee: [0x1000, 0x2D80], wind: 0x4000,
      pre: w => { wr(w, 0xC89A, 0xDC); wr(w, 0xC89B, 0x00); }, hooks: 0x6195, offTee: "afterTee" },
    try: { entrance: 7, mode: 0x06, hole: 0x0D, tee: [0x1000, 0x2D80], shot: [0x06, 0xE078], wind: 0x4000,
      hooks: 0x6206, offTee: "afterTee" } },
};
// 31:607B Map12HighShotJudgeShot: 0 holed out (#99); else 2 off the green (lie 6) or when the stroke record's +$0C has
// bit 7 clear; else 0 within $A0 of the pin, 1 (the record's +$0A / +$0B are read and unused)
function highJudge(sh) {
  const w = sh.w;
  if (testFlag(w, 99)) return 0;
  D.setWramBank(w, 6);
  if (Ls.ballLie(sh) !== 6) return 2;
  if (!(w.wram[6][0x68C] & 0x80)) return 2;
  return Ls.ballWithinPinDist(w, 0xA0) ? 1 : 0;
}
// 31:5FB5 Map12HighShotTryAfterShot: as the others but flag #99 first (the judgement reads it), the judgement with the
// WRAM bank kept
function* highTryAfterShot(sh) {
  const w = sh.w;
  yield* inBankGen(w, 0x10, golfViewExit(sh));
  if (!rd(w, 0xC834)) wr(w, 0xC961, 0x08);
  else {
    clearFlag(w, 99);
    if (rd(w, 0xC8AA)) setFlag(w, 99);
    const old = w.high[0x196];
    wr(w, 0xC968, highJudge(sh));
    D.setWramBank(w, old);
  }
  Ls.setGolfEventFlag(w, 0x82);
  yield* Ls.golfAdvanceFrame(sh);
}
// 31:6321 Map12TreeRecoveryJudgeShot: 1 off the fairway; the ball's y ($D404) under $2100: 2 with x ($D401) $2100 or
// more, else 0; lower: 2 with x $1980 or more, else 0
function treeJudge(sh) {
  const w = sh.w;
  D.setWramBank(w, 6);
  if (Ls.ballLie(sh) !== 0) return 1;
  const r6 = w.wram[6], x = r6[0x401] | r6[0x402] << 8, y = r6[0x404] | r6[0x405] << 8;
  const ge = (a, b) => !(((a - b) & 0xFFFF) & 0x8000);
  return ge(x, ge(y, 0x2100) ? 0x1980 : 0x2100) ? 2 : 0;
}
// 31:5FE8 Map12HighShotLessonResult (entrance 6): 0 the cheer, $107E, passed; 1 $107D; else $107C (coach 1 walks back
// with coach 2's script, as on map $0F) / 31:628E Map12TreeRecoveryLessonResult (entrance 7): 0 the cheer, $108C,
// passed; 1 $108B; else $108E
function* map12Result(sh, L, pass, one, other) {
  const w = sh.w;
  yield* Ls.lessonResultBegin(sh, L);
  const r = rd(w, 0xC968);
  if (r === 0) { yield* Ls.lessonCheer(sh, L); yield* Ls.coachSays(sh, L, pass); Ls.lessonPassed(w, L); }
  else { yield* S.scriptWaitFrames(sh, 0x1E); yield* Ls.coachSays(sh, L, r === 1 ? one : other); }
  yield* Ls.lessonResultEnd(sh, L);
}
// 31:5E63 Map12Enter: as 31:5543 (a first success #170 / #171: 45 EXP, warp 8 / 9)
function* map12Enter(sh) {
  const w = sh.w, e = rd(w, 0xC46A);
  if (e !== 1) { wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0); }
  if (e === 4) yield* Ls.lessonAfterDemo(sh, LESSONS_12.high);
  else if (e === 5) yield* Ls.lessonAfterDemo(sh, LESSONS_12.tree);
  else if (e === 6) { yield* map12Result(sh, LESSONS_12.high, 0x107E, 0x107D, 0x107C); yield* Ls.lessonFirstSuccess(sh, LESSONS_12.high, 0x002D, 8, saveGame); }
  else if (e === 7) { yield* map12Result(sh, LESSONS_12.tree, 0x108C, 0x108B, 0x108E); yield* Ls.lessonFirstSuccess(sh, LESSONS_12.tree, 0x002D, 9, saveGame); }
  else if (e === 0xFA && testFlag(w, 100)) clearFlag(w, 100);
}

// 31:4E5A Map0CDriverJudgeShot: 2 off the fairway (the lie not 0); the shot's power ($D68A) $3C with impact ($D68B,
// absolute) 0: 0 when $D689 is set, else 3; power $34 or more and impact under 4: 1; else 2
function driverJudge(sh) {
  const w = sh.w;
  D.setWramBank(w, 6);
  const r6 = w.wram[6];
  if (Ls.ballLie(sh) !== 0) return 2;
  const b = r6[0x68A];
  let c = r6[0x68B];
  if (c & 0x80) c = (-c) & 0xFF;
  if (b === 0x3C && !c) return r6[0x689] ? 0 : 3;
  if (b >= 0x34 && c < 4) return 1;
  return 2;
}
// 31:510D Map0CIronShotJudgeShot: 0 within $A0 of the pin (31:7D53), 1 on the green (lie 6), else 2
function ironJudge(sh) {
  D.setWramBank(sh.w, 6);
  if (!Ls.ballWithinPinDist(sh.w, 0xA0)) return 0;
  return Ls.ballLie(sh) === 6 ? 1 : 2;
}
// 31:4D9C Map0CDriverLessonResult (entrance 6): by wEventResult: 0 the cheer, $103C, passed; 1 $103B; 2 $103A; 3 the
// cheer, $103E, passed
function* driverResult(sh) {
  const w = sh.w, L = LESSONS.driver;
  yield* Ls.lessonResultBegin(sh, L);
  const r = rd(w, 0xC968);
  if (r === 0) { yield* Ls.lessonCheer(sh, L); yield* Ls.coachSays(sh, L, 0x103C); Ls.lessonPassed(w, L); }
  else if (r === 1) { yield* S.scriptWaitFrames(sh, 0x1E); yield* Ls.coachSays(sh, L, 0x103B); }
  else if (r === 2) { yield* S.scriptWaitFrames(sh, 0x1E); yield* Ls.coachSays(sh, L, 0x103A); }
  else { yield* Ls.lessonCheer(sh, L); yield* Ls.coachSays(sh, L, 0x103E); Ls.lessonPassed(w, L); }
  yield* Ls.lessonResultEnd(sh, L);
}
// 31:507A Map0CIronShotLessonResult (entrance 7; the texts at (3, $0A)): 0 the cheer, $104C, passed; 1 $104B; else
// $104A
function* ironResult(sh) {
  const w = sh.w, L = LESSONS.iron;
  yield* Ls.lessonResultBegin(sh, L);
  const r = rd(w, 0xC968);
  if (r === 0) { yield* Ls.lessonCheer(sh, L); yield* Ls.coachSays(sh, L, 0x104C, true); Ls.lessonPassed(w, L); }
  else { yield* S.scriptWaitFrames(sh, 0x1E); yield* Ls.coachSays(sh, L, r === 1 ? 0x104B : 0x104A, true); }
  yield* Ls.lessonResultEnd(sh, L);
}
// 31:4BEC Map0CEnter: fade in (8); not entrance 1: no name banner; 4 / 5 after a demo; 6 / 7 a lesson's result and a
// first success (20 EXP, warp 8 / 9); $FA: flag #100 cleared
function* map0CEnter(sh) {
  const w = sh.w;
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  const e = rd(w, 0xC46A);
  if (e !== 1) { wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0); }
  if (e === 4) yield* Ls.lessonAfterDemo(sh, LESSONS.driver);
  else if (e === 5) yield* Ls.lessonAfterDemo(sh, LESSONS.iron);
  else if (e === 6) { yield* driverResult(sh); yield* Ls.lessonFirstSuccess(sh, LESSONS.driver, 0x0014, 8, saveGame); }
  else if (e === 7) { yield* ironResult(sh); yield* Ls.lessonFirstSuccess(sh, LESSONS.iron, 0x0014, 9, saveGame); }
  else if (e === 0xFA && testFlag(w, 100)) clearFlag(w, 100);
}
// 31:521B DrivingRangeStartPractice: the hole (31:5263: 7 / $0A / $0D / $10 for maps $0C / $0F / $12 / $15), game
// mode 6, the hooks 31:5296
function* drivingRangeStartPractice(sh) {
  const m = rd(sh.w, 0xC450);
  yield* Ls.startPractice(sh, B, m === 0x0C ? 0x07 : m === 0x0F ? 0x0A : m === 0x12 ? 0x0D : 0x10, 0x06, 0x5296);
}
export const HOOKS = {
  "31:4cb8": sh => Ls.hookShotSetup(sh, 0x03, [0x1032, 0x1033, 0x1034, 0x1035]),   // 31:4CB8 Map0CDriverDemoShotSetup
  "31:4d00": sh => Ls.hookDemoAfterShot(sh),                                      // 31:4D00
  "31:4d34": sh => Ls.hookShotSetup(sh, 0x03, [0x1037, 0x1038, 0x1039]),          // 31:4D34 Map0CDriverTryShotSetup
  "31:4d71": sh => Ls.hookTryAfterShot(sh, 0x08, driverJudge),                    // 31:4D71
  "31:4f96": sh => Ls.hookShotSetup(sh, 0x04, [0x1042, 0x1043, 0x1044, 0x1045]),   // 31:4F96 Map0CIronShotDemoShotSetup
  "31:4fde": sh => Ls.hookDemoAfterShot(sh),                                      // 31:4FDE
  "31:5012": sh => Ls.hookShotSetup(sh, 0x04, [0x1047, 0x1048, 0x1049]),          // 31:5012 Map0CIronShotTryShotSetup
  "31:504f": sh => Ls.hookTryAfterShot(sh, 0x09, ironJudge),                      // 31:504F
  "31:5630": sh => Ls.hookShotSetup(sh, 0x03, [0x1051, 0x1052, 0x1054]),   // 31:5630 Map0FIntentionalShotDemoShotSetup (quirk: $1053 never shown)
  "31:566d": sh => Ls.hookDemoAfterShot(sh),                              // 31:566D
  "31:56a1": sh => Ls.hookShotSetup(sh, 0x03, [0x1058, 0x1059, 0x105A]),   // 31:56A1 Map0FIntentionalShotTryShotSetup
  "31:56de": sh => Ls.hookTryAfterShot(sh, 0x08, curveJudge),             // 31:56DE
  "31:5943": sh => Ls.hookShotSetup(sh, 0x04, [0x1064, 0x1065, 0x1066, 0x1067]),   // 31:5943 Map0FWindShotDemoShotSetup
  "31:598b": sh => Ls.hookDemoAfterShot(sh),                              // 31:598B
  "31:59bf": sh => Ls.hookShotSetup(sh, 0x04, [0x106A, 0x106B, 0x106C]),   // 31:59BF Map0FWindShotTryShotSetup
  "31:59fc": sh => Ls.hookTryAfterShot(sh, 0x09, ironJudge),              // 31:59FC (31:5ABA: as 31:510D)
  "31:5f27": sh => Ls.hookShotSetup(sh, 0x03, [0x1073, 0x1074], { wait: "none" }),   // 31:5F27 Map12HighShotDemoShotSetup
  "31:5f52": function* (sh) { Ls.setGolfEventFlag(sh.w, 0x82); },   // 31:5F52 (only the flag: no GolfViewExit, no frame)
  "31:5f78": sh => Ls.hookShotSetup(sh, 0x03, [0x1079, 0x107A, 0x107B]),   // 31:5F78
  "31:5fb5": highTryAfterShot,
  "31:61b5": sh => Ls.hookShotSetup(sh, 0x04, [0x1083, 0x1084, 0x1086]),   // 31:61B5 (quirk: $1085 never shown)
  "31:61f2": sh => Ls.hookDemoAfterShot(sh),                              // 31:61F2
  "31:6226": sh => Ls.hookShotSetup(sh, 0x04, [0x1088, 0x1089, 0x108A]),   // 31:6226
  "31:6263": sh => Ls.hookTryAfterShot(sh, 0x09, treeJudge),              // 31:6263
  "31:52b6": function* () {},                     // 31:52B6 DrivingRangePracticeShotSetup: ret
  "31:52b7": Ls.hookPracticeAfterShot,            // 31:52B7 DrivingRangePracticeAfterShot
};

export const SCRIPTS = {
  "31:4bec": map0CEnter,
  "31:4a1d": sh => Ls.tipTalk(sh, 0x0D17, 0x02),  // 31:4A1D Map0CTalk02GoodShotTip
  "31:4a8b": sh => Ls.lessonTalk(sh, LESSONS.driver),
  "31:4b11": sh => Ls.lessonTalk(sh, LESSONS.iron),
  "31:5543": map0FEnter,
  "31:53a6": sh => Ls.chainedTip(sh, 0x0D1C, 0x02),
  "31:5e63": map12Enter,
  "31:5cc2": sh => Ls.chainedTip(sh, 0x1006, 0x02),
  "31:5d2a": sh => Ls.lessonTalk(sh, LESSONS_12.high),
  "31:5dbf": sh => Ls.lessonTalk(sh, LESSONS_12.tree),
  "31:540e": sh => Ls.lessonTalk(sh, LESSONS_0F.curve),
  "31:54a2": sh => Ls.lessonTalk(sh, LESSONS_0F.wind),
  "31:4bc9": Ls.triggerLingoSign,                // 31:4BC9 Map0CTriggerGolfLingoSign
  "31:51f4": sh => Ls.triggerPractice(sh, drivingRangeStartPractice),   // 31:51F4 DrivingRangeTriggerPractice
  "31:7775": ceremonyEnter,
  "31:7d18": function* () {},                 // 31:7D18 MapScriptNop_31
  "31:4052": storyOpeningCreateCharacter,        // 31:4052 Map1EEnter: call 31:43B9
};
export const TASKS = w => ({
  "31:43b2": () => openingSpriteTask(w),         // 31:43B2 OpeningSpriteTask
});
