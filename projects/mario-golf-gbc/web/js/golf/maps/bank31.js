// Bank 31's map scripts (REVERSE.md "Banks 30 and 31"): map $1E, the story's opening: a new character's creation
// (StoryOpeningCreateCharacter 31:43B9, the enter script of map $1E at 31:4052).
import * as D from "../render/display.js";
import * as Scr from "../screen.js";
import * as S from "../script.js";
import * as T from "../msgbox.js";
import { registerFrameTask, unregisterFrameTask } from "../tasks.js";
import { newGame, createCharacter } from "../start.js";
import * as St from "../start.js";
import { advanceRandomSeed, golfViewExit } from "../round.js";
import { restoreShadowFromMap } from "../shadow.js";
import { loadPortraitTiles, fillTileBlock3x3, nameEntryScreen } from "../nameentry.js";
import { charYesNoPrompt } from "../levelup.js";
import { rb } from "../rom.js";
import * as M from "../mapengine.js";
import { mapBufCopyRectRedraw } from "../mapgfx.js";
import { pushTextNumberArg, setTextCourseIndex, copyTextShortToDE, pushTextStringArg } from "../text.js";
import { clubDistance, driverShape } from "../launch.js";
import { saveGame } from "../save.js";
import { showPictureTimed, showPictureUntilButton } from "../title.js";
import { staffCredits } from "../ending.js";
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
// 31:782F (a ceremony after the ending, #110, or the Links Champion's after 31:7827's fade out): the character's
// picture (40:6666), the staff roll (41:7E07), #110, the picture until a button (40:66B5), map 0 entrance 2,
// wReplayActive 0, the return point (b = $FF: map 0 at the saved position), SaveGame, warp 3
function* ceremonyStaffRoll(sh) {
  const w = sh.w;
  yield* inBankGen(w, 0x40, showPictureTimed(sh, rd(w, 0xC810)));
  yield* inBankGen(w, 0x41, staffCredits(sh));
  setFlag(w, 110);
  yield* inBankGen(w, 0x40, showPictureUntilButton(sh, rd(w, 0xC810)));
  wr(w, 0xC450, 0x00); wr(w, 0xC46A, 0x02); wr(w, 0xC96D, 0x00);
  St.mapSaveReturnPoint(w);                                       // 0A:4D5B (bc = $FFFF)
  saveGame(w);                                                    // 02:4489
  wr(w, 0xC441, 0x03);
}
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
  if (testFlag(w, 110)) { yield* ceremonyStaffRoll(sh); return; }   // 31:77FD
  let result;
  if (e === 0x02) {
    S.actorSetState(w, 0x04, 0x00);
    S.actorSetState(w, 0x05, 0x00);
    yield* ceremonyChampion(sh);
    wr(w, 0xC96C, 0x01);
    if (rd(w, 0xC450) === 0x1B) {                                 // 31:7827 the Links Champion
      Scr.beginFadeOut(w, 0x04);
      yield* Scr.waitFade(sh);
      yield* ceremonyStaffRoll(sh);
      return;
    }
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

// ---- the Links driving range (map $15): its two lessons and, after the Links tournament won, their contests ----
// (the code of each map here is its own: the lessons share little with the engine of maps/lessons.js)
const L15 = {
  tree: { bank: B, coach: 0x03, talkScript: 0x7CBE },
  buried: { bank: B, coach: 0x04, talkScript: 0x7CBE },
};
// 31:7051 Map15UnlockContests: after the Links win (#139): #224 once the tree shot's lesson is passed (#174), #225 once
// the buried lie's (#175)
function unlockContests15(w) {
  if (!testFlag(w, 139)) return;
  if (testFlag(w, 174)) setFlag(w, 224);
  if (testFlag(w, 175)) setFlag(w, 225);
}
// texts at (3, $0A) by a coach (05:5E70)
function* say15(sh, coach, id) { yield* inBankGen(sh.w, 0x05, T.showMessageAt(sh, id, coach, 0x0A, 0x03)); }
// the round of a lesson, a try or a contest: GolfRound 10:4451 (one hole), GolfSessionEnd 10:4B94
const round15 = sh => Ls.lessonRound(sh);
// 31:65B8 Map15Talk03TreeShotLesson (coach 1, actor 3): tried (#101): "Try again?" ($0D11) and the question; else the
// lesson's offer $108F (the contest's $1015 with #224): No the next text; Yes the one after and the coach's demo:
// music 7, the return point (entrance 4), game mode 6, the demo strokes 31:68D9 for golfer $4F, course 0 hole $0A,
// the wind direction 0, the tee ($2C60, $2120), player 1 off the tee, the wind $6000 (contest) or $C000, the hooks
// 31:68E9, then the coach's golfer record ($C89D = 3, $C89A-$C89B = $00F5: a 245 drive)
function* treeTalk(sh) {
  const w = sh.w;
  if (testFlag(w, 101)) { T.scriptSetText(w, 0x0D11); yield* treeAskTry(sh); return; }
  T.scriptSetText(w, testFlag(w, 224) ? 0x1015 : 0x108F);
  yield* T.scriptShowTextKeepOpen(sh, 0x03);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* S.scriptWaitFrames(sh, 0x05);
  if (a) { yield* T.scriptShowText(sh, 0x03); return; }
  T.scriptSkipText(w);
  yield* T.scriptShowText(sh, 0x03);
  St.golfSessionInit(w);
  wr(w, 0xC82C, 0x07);
  Ls.saveReturnPoint(w, 0x15, 0x04);
  wr(w, 0xC834, 0x06);
  D.inBank(w, B, () => D.copyMemoryFast(w, 0x68D9, 0xC600, 0x04));
  St.setupPlayerGolfer(w, 0x4F, 0x00);
  St.setupPlayerGolfer(w, 0xFF, 0x01);
  St.setCourseHole(w, 0x00, 0x00, 0x0A);
  Ls.setForcedWindDir(w, 0x00);
  Ls.setForcedTee(w, 0x2C60, 0x2120);
  Ls.setP1OffTee(w);
  Ls.setForcedWind(w, testFlag(w, 224) ? 0x6000 : 0xC000);
  Ls.setGolfEventHook(w, B, 0x68E9);
  wr(w, 0xC89D, 0x03);
  wr(w, 0xC89A, 0xF5); wr(w, 0xC89B, 0x00);
  yield* round15(sh);
}
// 31:6BF7 Map15TreeShotLessonAskTry: No: $109E, the coach faces up (his script not reset); Yes: #101, the try (or the
// contest): the return point (entrance 6), game mode 6, the player's golfer, course 0 hole $0A, the wind direction 0,
// the tee, player 1 off the tee, the forced shot (club 3, $B61D), the music ($0B until passed / won: #174 / #222, else
// 7) and the wind ($C000 / the contest's $6000), the hooks 31:699C
function* treeAskTry(sh) {
  const w = sh.w;
  yield* T.scriptShowTextKeepOpen(sh, 0x03);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* S.scriptWaitFrames(sh, 0x05);
  if (a) {
    T.scriptSetText(w, 0x109E);
    yield* T.scriptShowText(sh, 0x03);
    S.actorSetFacing(w, 0x03, 0x00);
    return;
  }
  setFlag(w, 101);
  St.golfSessionInit(w);
  Ls.saveReturnPoint(w, 0x15, 0x06);
  wr(w, 0xC834, 0x06);
  St.setupPlayerGolfer(w, 0x80, 0x00);
  St.setupPlayerGolfer(w, 0xFF, 0x01);
  St.setCourseHole(w, 0x00, 0x00, 0x0A);
  Ls.setForcedWindDir(w, 0x00);
  Ls.setForcedTee(w, 0x2C60, 0x2120);
  Ls.setP1OffTee(w);
  Ls.setForcedShot(w, 0x03, 0xB61D);
  const contest = testFlag(w, 224);
  wr(w, 0xC82C, testFlag(w, contest ? 222 : 174) ? 0x07 : 0x0B);
  Ls.setForcedWind(w, contest ? 0x6000 : 0xC000);
  Ls.setGolfEventHook(w, B, 0x699C);
  yield* round15(sh);
}
// 31:666F Map15Talk04BuriedLieLesson (coach 2, actor 4): tried (#102): "Want to try again?" ($0D12) and the question;
// the contest (#225): $1020 asked: No: the next text (quirk: $1028 instead once the Links is won, #139, which the
// contest needs anyway); else the lesson's $109F: No the next text; Yes: (not the contest: the text after), the
// coach's demo: music 7, the return point (entrance 5), game mode 6, the strokes 31:6CA6 for golfer $4E, course 7 hole
// $10, the wind direction 0, the tee ($1500, $2540), quirk: wP1OffTee $D4E3 = $21 written directly, the coach's 230
// drive ($C89A-$C89B = $00E6), the wind $0004 (contest) or $C000, the hooks 31:6CB6
function* buriedTalk(sh) {
  const w = sh.w;
  if (testFlag(w, 102)) { T.scriptSetText(w, 0x0D12); yield* buriedAskTry(sh); return; }
  const contest = testFlag(w, 225);
  T.scriptSetText(w, contest ? 0x1020 : 0x109F);
  yield* T.scriptShowTextKeepOpen(sh, 0x04);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* S.scriptWaitFrames(sh, 0x05);
  if (a) {
    if (contest && testFlag(w, 139)) T.scriptSetText(w, 0x1028);
    yield* T.scriptShowText(sh, 0x04);
    return;
  }
  if (!testFlag(w, 225)) { T.scriptSkipText(w); yield* T.scriptShowText(sh, 0x04); }
  St.golfSessionInit(w);
  wr(w, 0xC82C, 0x07);
  Ls.saveReturnPoint(w, 0x15, 0x05);
  wr(w, 0xC834, 0x06);
  D.inBank(w, B, () => D.copyMemoryFast(w, 0x6CA6, 0xC600, 0x04));
  St.setupPlayerGolfer(w, 0x4E, 0x00);
  St.setupPlayerGolfer(w, 0xFF, 0x01);
  St.setCourseHole(w, 0x07, 0x07, 0x10);
  Ls.setForcedWindDir(w, 0x00);
  Ls.setForcedTee(w, 0x1500, 0x2540);
  D.setWramBank(w, 6);
  w.wram[6][0x4E3] = 0x21;
  wr(w, 0xC89A, 0xE6); wr(w, 0xC89B, 0x00);
  Ls.setForcedWind(w, testFlag(w, 225) ? 0x0004 : 0xC000);
  Ls.setGolfEventHook(w, B, 0x6CB6);
  yield* round15(sh);
}
// 31:6F9A Map15BuriedLieLessonAskTry: No: $10AE, the coach faces up; Yes: #102, the try (or the contest): entrance 7,
// game mode 6, course 7 hole $10, the tee, $D4E3 = $21, the forced shot (club 3, $C982), the music ($0B until passed /
// won: #175 / #223, else 7) and the wind ($C000 / the contest's $0004), the hooks 31:6D52
function* buriedAskTry(sh) {
  const w = sh.w;
  yield* T.scriptShowTextKeepOpen(sh, 0x04);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* S.scriptWaitFrames(sh, 0x05);
  if (a) {
    T.scriptSetText(w, 0x10AE);
    yield* T.scriptShowText(sh, 0x04);
    S.actorSetFacing(w, 0x04, 0x00);
    return;
  }
  setFlag(w, 102);
  St.golfSessionInit(w);
  Ls.saveReturnPoint(w, 0x15, 0x07);
  wr(w, 0xC834, 0x06);
  St.setupPlayerGolfer(w, 0x80, 0x00);
  St.setupPlayerGolfer(w, 0xFF, 0x01);
  St.setCourseHole(w, 0x07, 0x07, 0x10);
  Ls.setForcedWindDir(w, 0x00);
  Ls.setForcedTee(w, 0x1500, 0x2540);
  D.setWramBank(w, 6);
  w.wram[6][0x4E3] = 0x21;
  Ls.setForcedShot(w, 0x03, 0xC982);
  const contest = testFlag(w, 225);
  wr(w, 0xC82C, testFlag(w, contest ? 223 : 175) ? 0x07 : 0x0B);
  Ls.setForcedWind(w, contest ? 0x0004 : 0xC000);
  Ls.setGolfEventHook(w, B, 0x6D52);
  yield* round15(sh);
}
// 31:6BCB / 31:6F6E Map15TreeShotLessonAfterDemo / Map15BuriedLieLessonAfterDemo (entrances 4 / 5): ScriptBegin, the
// coach's talking script facing the player, fade in (8), $1097 / $10A7 asked (the ask-try), ScriptEnd
function* afterDemo15(sh, coach, text, askTry) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  S.actorSetScript(w, coach, 0x7CBE, B);
  S.actorFaceActor(w, coach, rd(w, 0xC296));
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  T.scriptSetText(w, text);
  yield* askTry(sh);
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}
// 31:6A56 / 31:6DF8 the lessons' results (entrances 6 / 7, no contest): ScriptBegin, the coach's talking script facing
// the player, fade in (8), 30 frames; 0: the cheer, the passed text (#98, the lesson's flag cleared); else 30 frames
// and the text by wEventResult; not passed: the coach faces up (quirk: his talking script is never reset); ScriptEnd
function* result15(sh, coach, flag, texts) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  S.actorSetScript(w, coach, 0x7CBE, B);
  S.actorFaceActor(w, coach, rd(w, 0xC296));
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  yield* S.scriptWaitFrames(sh, 0x1E);
  const r = rd(w, 0xC968);
  if (r === 0) {
    S.actorPlayAnim(w, coach, 0x07);
    yield* S.waitActorAnimDone(sh, coach);
    yield* S.scriptWaitFrames(sh, 0x1E);
    T.scriptSetText(w, texts[0]);
    yield* T.scriptShowText(sh, coach);
    setFlag(w, 98); clearFlag(w, flag);
  } else {
    yield* S.scriptWaitFrames(sh, 0x1E);
    T.scriptSetText(w, texts[Math.min(r, texts.length - 1)]);
    yield* T.scriptShowText(sh, coach);
  }
  if (!testFlag(w, 98)) S.actorSetFacing(w, coach, 0xC0);
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}
// 31:6AE3 / 31:6E9D the contests' results: the lesson's flag cleared, ScriptBegin, the coach faces the player, fade in
// (8), 30 frames; the player's ball nearer the pin than the coach's ($C96A < $C968): the cheer, the win text, #98;
// else 30 frames, the loss text; not won: the coach faces up; ScriptEnd
function* contest15(sh, coach, flag, win, loss) {
  const w = sh.w;
  clearFlag(w, flag);
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  S.actorFaceActor(w, coach, rd(w, 0xC296));
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  yield* S.scriptWaitFrames(sh, 0x1E);
  const coachDist = rd(w, 0xC968) | rd(w, 0xC969) << 8, playerDist = rd(w, 0xC96A) | rd(w, 0xC96B) << 8;
  if (((playerDist - coachDist) & 0xFFFF) & 0x8000) {
    S.actorPlayAnim(w, coach, 0x07);
    yield* S.waitActorAnimDone(sh, coach);
    yield* S.scriptWaitFrames(sh, 0x1E);
    T.scriptSetText(w, win);
    yield* T.scriptShowText(sh, coach);
    setFlag(w, 98);
  } else {
    yield* S.scriptWaitFrames(sh, 0x1E);
    T.scriptSetText(w, loss);
    yield* T.scriptShowText(sh, coach);
  }
  if (!testFlag(w, 98)) S.actorSetFacing(w, coach, 0xC0);
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}
// 31:6B5A / 31:6F14 after a contest won (entrances $0A / $0B): ScriptBegin, the coach faces the player, fade in (8),
// 30 frames, $101E / $1028, the coach faces up, ScriptEnd
function* postContest15(sh, coach, text) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  S.actorFaceActor(w, coach, rd(w, 0xC296));
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  yield* S.scriptWaitFrames(sh, 0x1E);
  T.scriptSetText(w, text);
  yield* T.scriptShowText(sh, coach);
  S.actorSetFacing(w, coach, 0xC0);
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}
// a first success or win: (30 frames: wait), the flag, 50 EXP (31:7DA4), the return point (map 0, $FA), SaveGame, the
// warp
function* firstSuccess15(sh, seen, warp, wait) {
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
// 31:67C8 Map15Enter: Map15UnlockContests; the talk list 31:678D once the Links is won (#139), else 31:6764 after the
// Links tournament (#115); not entrance 1: no name banner; 4 / 5 after a demo; 6 / 7 the lesson's or the contest's
// result, a first success or win (#174 / #175, #222 / #223: 50 EXP, warps 8 / 9, $0A / $0B; quirks: no 30 frames
// first for the tree shot's lesson and the buried lie's contest); $0A / $0B after a win; $FA: #100 cleared
function* map15Enter(sh) {
  const w = sh.w;
  unlockContests15(w);
  if (testFlag(w, 139)) M.scriptSetMapField(w, 0x678D, 0x000C);
  else if (testFlag(w, 115)) M.scriptSetMapField(w, 0x6764, 0x000C);
  const e = rd(w, 0xC46A);
  if (e !== 1) { wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0); }
  if (e === 4) yield* afterDemo15(sh, 0x03, 0x1097, treeAskTry);
  else if (e === 5) yield* afterDemo15(sh, 0x04, 0x10A7, buriedAskTry);
  else if (e === 6) {
    if (testFlag(w, 224)) { yield* contest15(sh, 0x03, 101, 0x101C, 0x101D); yield* firstSuccess15(sh, 222, 0x0A, true); }
    else { yield* result15(sh, 0x03, 101, [0x109D, 0x109C, 0x109B]); yield* firstSuccess15(sh, 174, 0x08, false); }
  } else if (e === 7) {
    if (testFlag(w, 225)) { yield* contest15(sh, 0x04, 102, 0x1026, 0x1027); yield* firstSuccess15(sh, 223, 0x0B, false); }
    else { yield* result15(sh, 0x04, 102, [0x10AD, 0x10AC, 0x10AB, 0x10AF]); yield* firstSuccess15(sh, 175, 0x09, true); }
  } else if (e === 0x0A) yield* postContest15(sh, 0x03, 0x101E);
  else if (e === 0x0B) yield* postContest15(sh, 0x04, 0x1028);
  else if (e === 0xFA && testFlag(w, 100)) clearFlag(w, 100);
}
// 31:6B8B Map15TreeShotJudgeShot: 0 holed out (#99); 2 off the green; else 0 within $A0 of the pin, 1 (the stroke
// record's +$0A / +$0B read and unused)
function treeJudge15(sh) {
  const w = sh.w;
  if (testFlag(w, 99)) return 0;
  D.setWramBank(w, 6);
  if (Ls.ballLie(sh) !== 6) return 2;
  return Ls.ballWithinPinDist(w, 0xA0) ? 1 : 0;
}
// 31:6F45 Map15BuriedLieJudgeShot (the WRAM bank as it is): on the green 0 within $A0 of the pin, else 3; in a
// bunker (lie 2) 2; else 1
function buriedJudge15(sh) {
  const lie = Ls.ballLie(sh);
  if (lie === 6) return Ls.ballWithinPinDist(sh.w, 0xA0) ? 3 : 0;
  return lie === 2 ? 2 : 1;
}
// the coach's distance in a contest's demo (31:697D / 31:6D33): PinDist 10:62AD to wEventResult $C968 (a word)
const keepDist = (w, a) => { const d = Ls.ballPinDist(w); wr(w, a, d & 0xFF); wr(w, a + 1, (d >> 8) & 0xFF); };
const HOOKS15 = {
  // 31:6909 Map15TreeShotDemoShotSetup: the contest (#224) once (not tried: #101): $1018, 50 frames, $1019, $101A; the
  // lesson: $1092, 50 frames, $1094, $1095 (quirk: $1093 never shown); the WRAM bank kept
  "31:6909": function* (sh) {
    const w = sh.w;
    unlockContests15(w);
    const old = w.high[0x196];
    D.setWramBank(w, 6);
    yield* inBankGen(w, 0x10, golfViewExit(sh));
    const texts = testFlag(w, 224) ? (testFlag(w, 101) ? null : [0x1018, 0x1019, 0x101A]) : [0x1092, 0x1094, 0x1095];
    if (texts) {
      yield* say15(sh, 0x03, texts[0]);
      yield* S.scriptWaitFrames(sh, 0x32);
      yield* say15(sh, 0x03, texts[1]);
      yield* say15(sh, 0x03, texts[2]);
    }
    yield* Ls.golfAdvanceFrame(sh);
    D.setWramBank(w, old);
  },
  // 31:697D / 31:6D33 the demos' after-shots: the contest's (#224 / #225) coach's distance kept; the round over
  "31:697d": sh => demoAfter15(sh, 224),
  "31:6d33": sh => demoAfter15(sh, 225),
  // 31:69BC Map15TreeShotTryShotSetup: nothing in the contest; else $1098, $1099, 50 frames, $109A
  "31:69bc": function* (sh) {
    unlockContests15(sh.w);
    if (testFlag(sh.w, 224)) return;
    yield* trySetup15(sh, 0x03, [0x1098, 0x1099, 0x109A], 0x32);
  },
  // 31:6A02 Map15TreeShotTryAfterShot: quit: entrance 8; the contest: the player's distance to $C96A; else flag #99
  // and the judgement 31:6B8B (the WRAM bank kept); then flag #99 again
  "31:6a02": function* (sh) {
    const w = sh.w;
    unlockContests15(w);
    yield* inBankGen(w, 0x10, golfViewExit(sh));
    if (!rd(w, 0xC834)) wr(w, 0xC961, 0x08);
    else {
      if (testFlag(w, 224)) keepDist(w, 0xC96A);
      else {
        holed99(w);
        const old = w.high[0x196];
        wr(w, 0xC968, treeJudge15(sh));
        D.setWramBank(w, old);
      }
      holed99(w);
    }
    Ls.setGolfEventFlag(w, 0x82);
    yield* Ls.golfAdvanceFrame(sh);
  },
  // 31:6CD6 Map15BuriedLieDemoShotSetup: the contest (#225): $1023; the lesson: $10A2, $10A3, 50 frames, $10A4, $10A5
  "31:6cd6": function* (sh) {
    const w = sh.w;
    unlockContests15(w);
    const old = w.high[0x196];
    D.setWramBank(w, 6);
    yield* inBankGen(w, 0x10, golfViewExit(sh));
    if (testFlag(w, 225)) yield* say15(sh, 0x04, 0x1023);
    else {
      yield* say15(sh, 0x04, 0x10A2);
      yield* say15(sh, 0x04, 0x10A3);
      yield* S.scriptWaitFrames(sh, 0x32);
      yield* say15(sh, 0x04, 0x10A4);
      yield* say15(sh, 0x04, 0x10A5);
    }
    yield* Ls.golfAdvanceFrame(sh);
    D.setWramBank(w, old);
  },
  // 31:6D72 Map15BuriedLieTryShotSetup: nothing in the contest; else $10A8, $10A9, 60 frames, $10AA
  "31:6d72": function* (sh) {
    unlockContests15(sh.w);
    if (testFlag(sh.w, 225)) return;
    yield* trySetup15(sh, 0x04, [0x10A8, 0x10A9, 0x10AA], 0x3C);
  },
  // 31:6DB8 Map15BuriedLieTryAfterShot: quit: entrance 9; the contest: the player's distance; else the judgement
  // 31:6F45; flag #99
  "31:6db8": function* (sh) {
    const w = sh.w;
    unlockContests15(w);
    yield* inBankGen(w, 0x10, golfViewExit(sh));
    if (!rd(w, 0xC834)) wr(w, 0xC961, 0x09);
    else {
      if (testFlag(w, 225)) keepDist(w, 0xC96A);
      else wr(w, 0xC968, buriedJudge15(sh));
      holed99(w);
    }
    Ls.setGolfEventFlag(w, 0x82);
    yield* Ls.golfAdvanceFrame(sh);
  },
};
const holed99 = w => { clearFlag(w, 99); if (rd(w, 0xC8AA)) setFlag(w, 99); };
function* demoAfter15(sh, contestFlag) {
  const w = sh.w;
  unlockContests15(w);
  yield* inBankGen(w, 0x10, golfViewExit(sh));
  if (testFlag(w, contestFlag)) keepDist(w, 0xC968);
  Ls.setGolfEventFlag(w, 0x82);
  yield* Ls.golfAdvanceFrame(sh);
}
function* trySetup15(sh, coach, texts, frames) {
  const w = sh.w, old = w.high[0x196];
  D.setWramBank(w, 6);
  yield* inBankGen(w, 0x10, golfViewExit(sh));
  yield* say15(sh, coach, texts[0]);
  yield* say15(sh, coach, texts[1]);
  yield* S.scriptWaitFrames(sh, frames);
  yield* say15(sh, coach, texts[2]);
  yield* Ls.golfAdvanceFrame(sh);
  D.setWramBank(w, old);
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

// ---- map $2D, the Golf Clinic (header 31:7067) ----
// 31:7127 / 715F Map2DTalk03Student / Map2DTalk04Student: ScriptBegin; the student (actor a) gets the talking script
// 31:7CBE and faces the player, the text (speaker a), the script de, facing up; ScriptEnd
function* clinicStudent(sh, a, id, de) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  S.actorSetScript(w, a, 0x7CBE, B);
  S.actorFaceActor(w, a, rd(w, 0xC296));
  T.scriptSetText(w, id);
  yield* T.scriptShowText(sh, a);
  S.actorSetScript(w, a, de, B);
  S.actorSetFacing(w, a, 0x00);
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}
// "You want your shot judged?" ($1564, speaker 5; no wait before the question): true for No
function* clinicAsk(sh) {
  T.scriptSetText(sh.w, 0x1564);
  yield* T.scriptShowTextKeepOpen(sh, 0x05);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* S.scriptWaitFrames(sh, 0x05);
  return a;
}
// 31:7199 / 71D3 Map2DTalk05CoachJudge / 06: ScriptBegin; the coach faces the player; the question (speaker a); Yes: 31:7252; then the text (speaker a),
// facing down; ScriptEnd
function* clinicCoachTalk(sh, a) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  S.actorFaceActor(w, a, rd(w, 0xC296));
  T.scriptSetText(w, 0x1564);
  yield* T.scriptShowTextKeepOpen(sh, a);
  const no = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* S.scriptWaitFrames(sh, 0x05);
  if (!no) yield* clinicStartJudgedShot(sh);
  yield* T.scriptShowText(sh, a);
  S.actorSetFacing(w, a, 0xC0);
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}
// 31:720D Map2DTriggerCoachJudge (trigger 1): ScriptBegin; the question (speaker 5): Yes: 31:7252; No: the next text,
// the coach faces down, the player walks back to ($2000, $3900); ScriptEnd
function* map2DTrigger01(sh) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  if (!(yield* clinicAsk(sh))) yield* clinicStartJudgedShot(sh);
  else {
    yield* T.scriptShowText(sh, 0x05);
    S.actorSetFacing(w, 0x05, 0xC0);
    S.actorMoveTo(w, 0x00, 0x2000, 0x3900);
    yield* S.waitActorMoveDone(sh, 0x00);
  }
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}
// 31:7252 ClinicStartJudgedShot: GolfSessionInit, the return point (map $2D, entrance 2), game mode 6, the player,
// course 0 hole 6 (the wind byte a is 0, from ClearMemory16), the wind direction 0, the tee ($2000, $3800), the wind
// $C000, the hooks 31:75C0, one hole
function* clinicStartJudgedShot(sh) {
  const w = sh.w;
  St.golfSessionInit(w);
  Ls.saveReturnPoint(w, 0x2D, 0x02);
  wr(w, 0xC834, 0x06);
  St.setupPlayerGolfer(w, 0x80, 0x00);
  St.setupPlayerGolfer(w, 0xFF, 0x01);
  St.setCourseHole(w, 0x00, 0x00, 0x06);
  Ls.setForcedWindDir(w, 0x00);
  Ls.setForcedTee(w, 0x2000, 0x3800);
  Ls.setForcedWind(w, 0xC000);
  Ls.setGolfEventHook(w, B, 0x75C0);
  yield* Ls.lessonRound(sh);
}
// 31:760C ClinicClassifyShot: the first stroke record (WRAM6 $D680): power +$0A ($3C full: 0, $34 and up: 1, else 2),
// impact +$0B (|v|: 0: 0, under 4: 1, else 2); both 0: the curve bits of +$0C (bit 4 hook 5, 5 slice 6, 6 topspin 7,
// 7 backspin 8, none 0); else 4 when either is 2, 3 when both are 1, 2 for the power, 1 for the impact
function clinicClassifyShot(w) {
  setW(w, 6);
  const p = rd(w, 0xD68A);
  const c = p === 0x3C ? 0 : p >= 0x34 ? 1 : 2;
  let i = rd(w, 0xD68B);
  if (i & 0x80) i = (-i) & 0xFF;
  const d = !i ? 0 : i < 4 ? 1 : 2;
  if (!(c | d)) {
    const f = rd(w, 0xD68C);
    return f & 0x10 ? 5 : f & 0x20 ? 6 : f & 0x40 ? 7 : f & 0x80 ? 8 : 0;
  }
  if (c === 2 || d === 2) return 4;
  if (c & d) return 3;
  return c ? 2 : 1;
}
// 31:75E1 ClinicAfterShot (hook 1): flag #99 = not quit; wEventResult $C968 = 31:760C; wEventShotClub $C969 = the
// record's club (+8); the round over ($82)
function* clinicAfterShot(sh) {
  const w = sh.w;
  if (rd(w, 0xC834)) setFlag(w, 99); else clearFlag(w, 99);
  wr(w, 0xC968, clinicClassifyShot(w));
  setW(w, 6);
  wr(w, 0xC969, rd(w, 0xD688));
  Ls.setGolfEventFlag(w, 0x82);
}
// 31:756A ClinicGradeDistance: 5 / 4 / 3 / 2 / 1 for a distance at least $12D / $119 / $105 / $F1 / $DD, else 0
const clinicGrade = de => { for (const [t, a] of [[0x12D, 5], [0x119, 4], [0x105, 3], [0xF1, 2], [0xDD, 1]]) if (!(((de - t) & 0xFFFF) & 0x8000)) return a; return 0; };
// a word argument from the short text base + a (8-bit), copied to de (05:40C2) and pushed (05:54CF)
function clinicArg(w, base, a, de) {
  copyTextShortToDE(w, (base + (a & 0xFF)) & 0xFFFF, de);
  pushTextStringArg(w, de);
}
// 31:7392 / 74B8 ClinicCoach1JudgeShot / ClinicCoach2JudgeShot (shot class 0): WRAM5; the distance's grade
// (31:7691 ClubDistance 02:511A of wEventShotClub for wCharDriverDist / wCharFlags; 31:756A), the shape (31:76A2
// DriverShape 02:534B of $C81D) + 4, and 4 - each of the stats $C81C / $C81E / $C81F (8-bit) as texts from the bases
// (coach 1: $1566 $1572 $1584 $1596 $15A8; coach 2: $156C $157B $158D $159F $15B1) to $DD74 / $DD94 / $DDB4 / $DDD4 /
// $DDF4; the comment $15BA / $15BB (speaker a)
function* clinicJudge(sh, a, bases, id) {
  const w = sh.w;
  setW(w, 5);
  const dist = clubDistance(rd(w, 0xC969), rd(w, 0xC81A) | rd(w, 0xC81B) << 8, rd(w, 0xC819));
  clinicArg(w, bases[0], clinicGrade(dist), 0xDD74);
  clinicArg(w, bases[1], (driverShape(rd(w, 0xC81D), rd(w, 0xC969), rd(w, 0xC819)) + 4) & 0xFF, 0xDD94);
  clinicArg(w, bases[2], (4 - rd(w, 0xC81C)) & 0xFF, 0xDDB4);
  clinicArg(w, bases[3], (4 - rd(w, 0xC81E)) & 0xFF, 0xDDD4);
  clinicArg(w, bases[4], (4 - rd(w, 0xC81F)) & 0xFF, 0xDDF4);
  T.scriptSetText(w, id);
  yield* T.scriptShowText(sh, a);
}
// 31:72CF / 7444 ClinicCoach1Comment / ClinicCoach2Comment: ScriptBegin; no shot judged (#99 clear): the coach faces
// actor 3 / 4, $1562 / $1563; else he faces the player and comments by the shot class (31:72F6: 0 the judgement, 1-8
// $15BC $15BD $15BE $15BF $15C1 $15C2 $15C3 $15C4; 31:746A: 0 the judgement, 1-4 $15C0, 5-8 $15C5); facing down;
// ScriptEnd
function* clinicCoachComment(sh, a) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  if (!testFlag(w, 99)) {
    S.actorFaceActor(w, a, a === 0x05 ? 0x03 : 0x04);
    T.scriptSetText(w, a === 0x05 ? 0x1562 : 0x1563);
    yield* T.scriptShowText(sh, a);
  } else {
    S.actorFaceActor(w, a, rd(w, 0xC296));
    const k = rd(w, 0xC968);
    if (!k) {
      if (a === 0x05) yield* clinicJudge(sh, a, [0x1566, 0x1572, 0x1584, 0x1596, 0x15A8], 0x15BA);
      else yield* clinicJudge(sh, a, [0x156C, 0x157B, 0x158D, 0x159F, 0x15B1], 0x15BB);
    } else {
      const id = a === 0x05 ? [0x15BC, 0x15BD, 0x15BE, 0x15BF, 0x15C1, 0x15C2, 0x15C3, 0x15C4][k - 1] : k <= 4 ? 0x15C0 : 0x15C5;
      if (id === undefined) notPorted(`the clinic comment for class ${k}`);
      T.scriptSetText(w, id);
      yield* T.scriptShowText(sh, a);
    }
  }
  S.actorSetFacing(w, a, 0xC0);
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}
// 31:72A3 Map2DEnter: entrance 2 (back from the judged shot) with #99: fade in (4), both coaches' comments; then (and
// at $FA) the banner's text cleared
function* map2DEnter(sh) {
  const w = sh.w;
  const e = rd(w, 0xC46A);
  if (e === 0x02) {
    if (testFlag(w, 99)) {
      Scr.beginFadeIn(w, 0x04);
      yield* Scr.waitFade(sh);
      yield* clinicCoachComment(sh, 0x05);
      yield* clinicCoachComment(sh, 0x06);
    }
    wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0);
  } else if (e === 0xFA) { wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0); }
}
export const HOOKS = {
  "31:75e0": function* () {},                     // 31:75E0 ClinicShotSetup: ret
  "31:75e1": clinicAfterShot,
  ...HOOKS15,
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
  "31:72a3": map2DEnter,
  "31:7127": sh => clinicStudent(sh, 0x03, 0x1560, 0x7D19),   // 31:7127 Map2DTalk03Student
  "31:715f": sh => clinicStudent(sh, 0x04, 0x1561, 0x7D24),   // 31:715F Map2DTalk04Student
  "31:7199": sh => clinicCoachTalk(sh, 0x05),
  "31:71d3": sh => clinicCoachTalk(sh, 0x06),
  "31:720d": map2DTrigger01,
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
  "31:67c8": map15Enter,
  "31:656f": sh => Ls.tipTalk(sh, 0x100D, 0x02),  // 31:656F Map15Talk02HookSliceTip
  "31:65b8": treeTalk,
  "31:666f": buriedTalk,
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
