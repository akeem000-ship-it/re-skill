// The test maps of bank 32 ($1F-$22): not reached in the retail game (no warp leads there); the debug menu's Scene
// warp (05:6C25, with hDebugMode poked: debug.js) reaches them. Map $1F shows the two-player VS result scene with
// falling confetti (an older copy of bank 0B's result screen), map $20 runs RoundResultScreen 0B:59DE with test
// results or the story pictures of bank 77, map $21 a golfer grid that starts a test round, map $22 is empty; map $23
// (bank 31) prints angle tests and offers a menu of test rounds and screens.
import * as D from "../render/display.js";
import * as Scr from "../screen.js";
import * as S from "../script.js";
import * as T from "../msgbox.js";
import * as A from "../actors.js";
import * as St from "../start.js";
import { rb, rw } from "../rom.js";
import { registerFrameTask, clearFrameTasks } from "../tasks.js";
import { mapBufCopyRectRedraw } from "../mapgfx.js";
import { advanceRandomSeed } from "../round.js";
import { vectorFromLengthAndAngle } from "../math.js";
import { playerField } from "../memory.js";
import { loadPictureTiles, putTileBlock4x8, clearResultActors, resultPaletteCycleTask, roundResultScreen } from "../result.js";
import { debugPaletteEditor, runPagedMenu } from "../debug.js";
import { loadStoryPicture, initFontScreen } from "../pictures.js";
import { restoreShadowFromMap } from "../shadow.js";
import * as W from "../windows.js";
import { printHexByte } from "../match.js";
import { printHexWord } from "../home.js";
import { setForcedWindDir, saveReturnPoint } from "./lessons.js";
import { angleFromVector16 } from "../math.js";
import { golfSessionEnd } from "../boot.js";
import { eventListScreen } from "../nav.js";
import { showScorecard } from "../scorecard.js";

const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
const setCur = (w, p) => { w.high[0x1E0] = p & 0xFF; w.high[0x1E1] = p >> 8; };   // hFFE0 / hFFE1: the actor's address
const r16 = (w, a) => rd(w, a) | rd(w, (a + 1) & 0xFFFF) << 8;
const w16 = (w, a, v) => { wr(w, a, v & 0xFF); wr(w, (a + 1) & 0xFFFF, (v >> 8) & 0xFF); };
function notPorted(what) { throw new Error(`${what} is not ported`); }
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}

// 32:417E Map1FTriggerWindTip / 32:4844 Map20TriggerWindTip / 32:4F92 Map22TriggerWindTip: ScriptBegin, text $0172
// (speaker 0), ScriptEnd
function* triggerWindTip(sh) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  T.scriptSetText(w, 0x0172);
  yield* T.scriptShowText(sh, 0x00);
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}
// 32:40EB Map1FTalkPaletteEditor / 32:47B1 Map20TalkPaletteEditor (talk 8): the palette editor (44:42FB, bank 44's
// export 2)
function* talkPaletteEditor(sh) { yield* inBankGen(sh.w, 0x44, debugPaletteEditor(sh)); }

// ---- map $1F: the VS results ----
// 32:4219 VsConfettiInitActors: actors 2-7 (WRAM4; hWRAMBank kept): +$17 = 0, the column +$18 a - 1 / a / a + 1 /
// a - 1 / a / a, the phase +$19 $CC / $99 / $66 / $33 / 0 / 0, a speed +$0E $10-$17 ($08-$0F for actor 7: one
// seed each, 00:0A61's low byte)
function vsConfettiInitActors(w, a) {
  const old = w.high[0x196];
  setW(w, 4);
  for (const [slot, col, ph, base] of [[2, -1, 0xCC, 0x10], [3, 0, 0x99, 0x10], [4, 1, 0x66, 0x10], [5, -1, 0x33, 0x10],
    [6, 0, 0x00, 0x10], [7, 0, 0x00, 0x08]]) {
    const p = A.actorSlotAddr(slot);             // 0A:42E0
    setCur(w, p);
    wr(w, p + 0x17, 0); wr(w, p + 0x18, (a + col) & 0xFF); wr(w, p + 0x19, ph);
    const v = advanceRandomSeed(w);
    wr(w, p + 0x0E, ((v & 7) + base) & 0xFF); wr(w, p + 0x0F, 0);
  }
  setW(w, old);
}
// 32:434E VsConfettiStepActor: WRAM4 (left mapped); x = column +$18 x $100 + the sway (00:0AF2: $180 at phase +$19 +
// y / 8); y += the speed; from row $11 back to $0780 ($0600 with $C3F5 set) at a new speed $10-$17
function vsConfettiStepActor(w, slot) {
  const p = A.actorSlotAddr(slot);
  setCur(w, p);
  setW(w, 4);
  const y0 = r16(w, p + 6);
  const ang = (((y0 & 0x8000 ? y0 | ~0xFFFF : y0) >> 3) + rd(w, p + 0x19)) & 0xFF;
  const [x] = vectorFromLengthAndAngle(0x0180, ang);
  w16(w, p + 4, (x + (rd(w, p + 0x18) << 8)) & 0xFFFF);
  const y = (y0 + r16(w, p + 0x0E)) & 0xFFFF;
  w16(w, p + 6, y);
  if ((y >> 8) < 0x11) return;
  w16(w, p + 6, rd(w, 0xC3F5) ? 0x0600 : 0x0780);
  const v = advanceRandomSeed(w);
  wr(w, p + 0x0E, ((v & 7) + 0x10) & 0xFF); wr(w, p + 0x0F, 0);
}
// 32:471B VsBobActor0E: as 0B:652F ResultBobActor with y = $0900 + the sine
function vsBobActor0E(w) {
  const p = A.actorSlotAddr(0x0E);
  setCur(w, p);
  setW(w, 4);
  const a = rd(w, p + 0x18);
  wr(w, p + 0x18, (a + (a & 0x80 ? 4 : 2)) & 0xFF);
  const [, s] = vectorFromLengthAndAngle(0x40, a);
  w16(w, p + 6, (0x0900 + s) & 0xFFFF);
}
// 32:43F5 VsConfettiTask (the same code as 0B:5DE1 ConfettiTask, calling this bank's copies): actors 2-7, actor $0E
export function vsConfettiTask(w) {
  const old = w.high[0x196];
  for (let k = 2; k <= 7; k++) vsConfettiStepActor(w, k);
  vsBobActor0E(w);
  setW(w, old);
}
// 32:475B SumPlayerHoleScores: a = player: the sum of the low nibbles of the 18 hole scores ($C8AC / $C8EC), 8-bit
function sumPlayerHoleScores(w, a) {
  const hl = a ? 0xC8EC : 0xC8AC;
  let b = 0;
  for (let k = 0; k < 0x12; k++) b = (b + (rd(w, hl + k) & 0x0F)) & 0xFF;
  return b;
}
// 32:4469 DrawVsPortrait: a = character, b = picture; (d, e) = where: LoadPictureTiles 11:4EAB (entry 2a + b, tile
// slot e = 9 + 2b), the slot (32:44A0 VsPortraitTileBase, the same code as 0B:5F40), its tile numbers there (32:4427
// FillTileBlock4x8, the same code as 0B:5E13), then the 4 x 8 block copied to (d, e) and redrawn (0B:4864)
function* drawVsPortrait(sh, a, b, d, e) {
  const w = sh.w;
  loadPictureTiles(w, ((a << 1) + b) & 0xFF, 0, (9 + 2 * b) & 0xFF);
  let h = a, se = 0x30;
  if (h >= 6) { h -= 6; se = 0x38; }
  const sd = ((((h << 1) + b) & 0xFF) << 2) & 0xFF;
  putTileBlock4x8(w, 0, (9 + 2 * b) & 0xFF, sd, se);
  yield* mapBufCopyRectRedraw(sh, sd, se, d, e, 0x04, 0x08);
}
// 32:44B4 VsResultsShowTwoPlayers: b / d = the two characters, c / e their pictures; with c set the score panels
// (0B:4864: (5, $24) to (4, 4), (0, $24) to ($0C, 4), 5 x 2) and actors 8-$0E placed (0A:43C6; $0E faces 0); the
// portraits at (4, 7) and ($0C, 7); confetti (32:4219) from column 7 ($0E with c set) and its task; $C3F5 = 0
function* vsResultsShowTwoPlayers(sh, b, c, d, e) {
  const w = sh.w;
  if (c) {
    yield* mapBufCopyRectRedraw(sh, 0x05, 0x24, 0x04, 0x04, 0x05, 0x02);
    yield* mapBufCopyRectRedraw(sh, 0x00, 0x24, 0x0C, 0x04, 0x05, 0x02);
    D.inBank(w, 0x0A, () => {
      for (const [a, bc, de] of [[8, 0x0D00, 0x0480], [9, 0x0F00, 0x0480], [0x0A, 0x1100, 0x0480], [0x0B, 0x0D00, 0x0680],
        [0x0C, 0x0F00, 0x0680], [0x0D, 0x1100, 0x0680], [0x0E, 0x0800, 0x0980]]) A.actorSetPos(w, a, bc, de);
      A.actorSetFacing(w, 0x0E, 0x00);
    });
  }
  yield* drawVsPortrait(sh, b, c, 0x04, 0x07);
  yield* drawVsPortrait(sh, d, e, 0x0C, 0x07);
  vsConfettiInitActors(w, c ? 0x0E : 0x07);
  registerFrameTask(w, 0x01, 0x32, 0x43F5);
  wr(w, 0xC3F5, 0);
}
// 32:456A VsResultsShowOnePlayer: b = the character, c = the rank (1 first): from 2nd on a ribbon ((4 (c - 2), $26)
// to ($1F, 5), 4 x 3), a figure (($0A + 2 (c - 2), $24) to ($17, $0E), 2 x 2) and two plates (($22, $0D) to ($1F,
// $0D), 3 x 4; ($0E, $24) to ($1B, $0B), $0D x 3); the portrait (picture 0) at ($16, 6); $C3F5 = 1; confetti from
// column $18 and its task
function* vsResultsShowOnePlayer(sh, b, c) {
  const w = sh.w;
  if (c !== 1) {
    yield* mapBufCopyRectRedraw(sh, (((c - 2) & 0xFF) << 2) & 0xFF, 0x26, 0x1F, 0x05, 0x04, 0x03);
    yield* mapBufCopyRectRedraw(sh, (0x0A + ((((c - 2) & 0xFF) << 1) & 0xFF)) & 0xFF, 0x24, 0x17, 0x0E, 0x02, 0x02);
    yield* mapBufCopyRectRedraw(sh, 0x22, 0x0D, 0x1F, 0x0D, 0x03, 0x04);
    yield* mapBufCopyRectRedraw(sh, 0x0E, 0x24, 0x1B, 0x0B, 0x0D, 0x03);
  }
  yield* drawVsPortrait(sh, b, 0x00, 0x16, 0x06);
  wr(w, 0xC3F5, 1);
  vsConfettiInitActors(w, 0x18);
  registerFrameTask(w, 0x01, 0x32, 0x43F5);
}
// 32:4199 Map1FEnterVsResults: the palette 32:4713 to BG 11 (master copy only); entrance 1: the two players' sums
// (32:475B; c = 1 / e = 0 when P2's is lower, else c = 0 / e = 1), the characters from the current player's +$10
// (high / low nibble), 32:44B4, the panel actors hidden (32:45EE, the same code as 0B:6402), $C3F4 = 0, a fade in
// (8), the palette cycle task (32:467B); entrance 2: 32:456A with the low nibble and rank 2, a fade in; then until
// A, B or Start (hJoyRepeat)
function* map1FEnterVsResults(sh) {
  const w = sh.w;
  D.loadPalettesMasterOnly(w, 0x4713, 0x0B, 0x01);   // 00:0595
  const ent = rd(w, 0xC46A);
  if (ent === 1) {
    const b0 = sumPlayerHoleScores(w, 0), a = sumPlayerHoleScores(w, 1);
    const [c, e] = a < b0 ? [1, 0] : [0, 1];
    const v = rd(w, 0xC000 + playerField(w, 0x10));   // 32:7E8E CurPlayerFieldAddr
    yield* vsResultsShowTwoPlayers(sh, (v >> 4) & 0x0F, c, v & 0x0F, e);
    clearResultActors(w);
    wr(w, 0xC3F4, 0);
    Scr.beginFadeIn(w, 0x08);
    yield* Scr.waitFade(sh);
    registerFrameTask(w, 0x01, 0x32, 0x467B);
  } else if (ent === 2) {
    yield* vsResultsShowOnePlayer(sh, rd(w, 0xC000 + playerField(w, 0x10)) & 0x0F, 0x02);
    Scr.beginFadeIn(w, 0x08);
    yield* Scr.waitFade(sh);
  }
  do yield* sh.advance(); while (!(w.high[0x191] & 0x0B));
}

// ---- map $20: the result tests ----
// 32:4AA6 ShowStoryPictureB: WRAM6, wPictureTimer $D34D = $FF (endless), LoadStoryPicture 77:6E3E (b = picture,
// c = golfer)
function* showStoryPictureB(sh, b, c) {
  setW(sh.w, 6);
  wr(sh.w, 0xD34D, 0xFF);
  yield* inBankGen(sh.w, 0x77, loadStoryPicture(sh, b, c));
}
// 32:4B3B RestoreBgRowsFromWram: WRAM6 wHoled $D444 = $FF; 8 rows x 20 of WRAM2 / WRAM3 $D100 (stride $40) to $C600 /
// $C700 (stride $20), queued to $B880 / $9880 (00:0468, $10 each; 00:0460); the WRAM bank restored
function restoreBgRowsFromWram(w) {
  const old = w.high[0x196];
  setW(w, 6);
  wr(w, 0xD444, 0xFF);
  let de = 0xC600;
  for (const bank of [2, 3]) {
    setW(w, bank);
    let hl = 0xD100;
    for (let r = 0; r < 8; r++) {
      for (let k = 0; k < 20; k++) wr(w, de++, rd(w, hl++));
      hl += 0x2C; de += 0x0C;
    }
  }
  D.queueVRAMCopy(w, 0xC600, 0xB880, 0x10);
  D.queueVRAMCopy(w, 0xC700, 0x9880, 0x10);
  D.queueVRAMCopyBreak(w);
  setW(w, old);
}
// 32:48AE Map20EnterResultTests: entrance 4: a fade in (4) and the paged menu of characters (05:5197, text $011C, 3
// pages; B: again), the player $C890 = it and P2 $C8D0 = it | $10, wRoundResult 1, RoundResultScreen 0B:59DE (a =
// 0), the player's actor to ($100, $100) (0A:43C6), again (it never leaves); entrances 5-7: fixed results (5: course
// 3, $C890 $0A, P2 8, result 3, a = 2; 6: $C890 0, wP1ScoreVsPar $F6, result 4, a = 1; 7: $C890 6, P2 2, result 3,
// a = 2) and a fade in; any other: 32:4956
function* map20EnterResultTests(sh) {
  const w = sh.w;
  const ent = rd(w, 0xC46A);
  const result = function* (a) { yield* inBankGen(w, 0x0B, roundResultScreen(sh, a)); };
  if (ent === 4) {
    for (;;) {
      Scr.beginFadeIn(w, 0x04);
      yield* Scr.waitFade(sh);
      const a = yield* inBankGen(w, 0x05, runPagedMenu(sh, 0x011C, 0x03));
      if (a === 0xFF) continue;
      wr(w, 0xC890, a); wr(w, 0xC8D0, a | 0x10); wr(w, 0xC96C, 0x01);
      yield* result(0x00);
      D.inBank(w, 0x0A, () => A.actorSetPos(w, 0x00, 0x0100, 0x0100));
    }
  }
  if (ent === 5) { wr(w, 0xC836, 0x03); wr(w, 0xC890, 0x0A); wr(w, 0xC8D0, 0x08); wr(w, 0xC96C, 0x03); yield* result(0x02); }
  else if (ent === 6) { wr(w, 0xC890, 0x00); wr(w, 0xC8BE, 0xF6); wr(w, 0xC96C, 0x04); yield* result(0x01); }
  else if (ent === 7) { wr(w, 0xC890, 0x06); wr(w, 0xC8D0, 0x02); wr(w, 0xC96C, 0x03); yield* result(0x02); }
  else { yield* map20ResultTestsCont(sh); return; }
  Scr.beginFadeIn(w, 0x04);
  yield* Scr.waitFade(sh);
}
// 32:4956 Map20EnterResultTestsCont: a fade in (4), the player's actor to ($3F00, $3F00), WRAM5; the paged menu of
// characters (05:5197; B: again), $C3E0 = it | $10; then the menu $011F (Hole in One .. Bogey) at (4, 4) (05:4BB0,
// 05:4492, 05:4949, RunMenu_05; closed, $D82F = $FF, redrawn); B: the paged menu again; a row: its story picture
// (ScoreNamePictureTable 32:4951) for the golfer $C3E0 (32:4AA6) until A or B (hJoyPressed), 32:4B3B, ClearFrameTasks,
// a frame, InitFontScreen 01:41E8, redrawn, the menu again. It never leaves (32:49D9-32:4A00 after it is not reached)
function* map20ResultTestsCont(sh) {
  const w = sh.w;
  Scr.beginFadeIn(w, 0x04);
  yield* Scr.waitFade(sh);
  D.inBank(w, 0x0A, () => A.actorSetPos(w, 0x00, 0x3F00, 0x3F00));
  setW(w, 5);
  for (;;) {
    let a;
    do a = yield* inBankGen(w, 0x05, runPagedMenu(sh, 0x011C, 0x03)); while (a === 0xFF);
    wr(w, 0xC3E0, a | 0x10);
    for (;;) {
      const c = rd(w, 0xC3E0);
      const s = yield* inBankGen(w, 0x05, W.openMenuWindow(sh, 0x011F, 0x04, 0x04));
      void s;
      yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));
      yield* inBankGen(w, 0x05, W.updateWindows(sh));
      const m = yield* inBankGen(w, 0x05, W.runMenu05(sh));
      W.closeWindow(w, rd(w, 0xD82F));
      wr(w, 0xD82F, 0xFF);
      yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));
      yield* inBankGen(w, 0x05, W.updateWindows(sh));
      if (m === 0xFF) break;
      yield* showStoryPictureB(sh, rb(0x32, 0x4951 + m), c);
      do yield* sh.advance(); while (!(w.high[0x194] & 0x03));
      restoreBgRowsFromWram(w);
      clearFrameTasks(w);
      yield* sh.advance();
      initFontScreen(w);
      yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));
      yield* inBankGen(w, 0x05, W.updateWindows(sh));
    }
  }
}

// ---- map $21: the golfer test ----
// 32:4DAB GolferTestMoveCursor: cell b (0-8 of a 3 x 3 grid) moved by c (1 up, 2 left, 3 down, 4 right), wrapping
// within its row / column
function golferTestMoveCursor(b, c) {
  let a;
  if (c === 1) { a = (b + 0xFD) & 0xFF; return a >= 0xFC ? (b + 6) & 0xFF : a; }
  if (c === 2) { a = (b + 0xFF) & 0xFF; return a === 0xFF || a === 2 || a === 5 ? (b + 2) & 0xFF : a; }
  if (c === 3) { a = (b + 3) & 0xFF; return a >= 9 ? (b + 0xFA) & 0xFF : a; }
  if (c === 4) { a = (b + 1) & 0xFF; return a === 3 || a === 6 || a === 9 ? (b + 0xFE) & 0xFF : a; }
  return c;
}
// 32:4D74 DrawGolferStatBar: the bar row cleared ((6, $15) to (5, $10), $0A x 1, 0B:4864), then cell a's length
// (GolferTestBarTable 32:4EA2, the low byte): 1-$7F tiles (0, $15) from column $0B on (32:4D4C DrawStatBarLeft),
// $80 on (negative) from column 5 + (4 + it) to 8 (32:4D1F DrawStatBarRight), each a 1 x 1 copy with its redraw
function* drawGolferStatBar(sh, a) {
  yield* mapBufCopyRectRedraw(sh, 0x06, 0x15, 0x05, 0x10, 0x0A, 0x01);
  const l = rb(0x32, (0x4EA2 + ((a << 1) & 0xFF)) & 0xFFFF);
  if (!l) return;
  if (l < 0x80) { for (let k = 0; k !== l; k = (k + 1) & 0xFF) yield* mapBufCopyRectRedraw(sh, 0x00, 0x15, (0x0B + k) & 0xFF, 0x10, 1, 1); }
  else { for (let k = (l + 4) & 0xFF; k !== 4; k = (k + 1) & 0xFF) yield* mapBufCopyRectRedraw(sh, 0x00, 0x15, (0x05 + k) & 0xFF, 0x10, 1, 1); }
}
// 32:4E0C GolferTestStartRound: GolfSessionInit 10:4B28; no player 2, player 0 the own character (02:4A28); cell b
// (PrintHexByte at ($0D, 7)) and its golfer id (GolferTestIdTable 32:4E90; PrintHexWord at ($0D, 8)); player 1
// that preset golfer (b = the id, c = 1); SetCourseHole 10:423B (course 1, hole 1; the wind byte a is the id
// SetupPlayerGolfer returns); SetForcedWindDir 10:4BE5 (0); GolfRound 10:4451 of 18 holes
function* golferTestStartRound(sh, b) {
  const w = sh.w;
  St.golfSessionInit(w);
  St.setupPlayerGolfer(w, 0xFF, 0x01);
  St.setupPlayerGolfer(w, 0x80, 0x00);
  printHexByte(w, b, 0x0D07);                    // 00:22A5
  const id = rw(0x32, (0x4E90 + ((b << 1) & 0xFF)) & 0xFFFF);
  printHexWord(w, id, 0x0D08);                   // 00:22BC
  const bc = ((id << 8) + 1) & 0xFFFF;
  const a = St.setupPlayerGolferA(w, bc >> 8, bc & 0xFF);
  St.setCourseHole(w, a, 0x01, 0x01);
  setForcedWindDir(w, 0x00);
  if (!sh.playGolfRound) notPorted("the golfer test's round outside the game loop");
  yield* sh.playGolfRound(0x12);
}
// 32:4C66 Map21EnterGolferTest: the player's actor faces $40 (0A:4644); a fade in (4); cell 0's bar; every frame
// (hJoyRepeat) A starts the round (32:4E0C) and asks warp 1; Up: the bar of the cell, the cursor moved, sound 8;
// Left: the same, sound $0A; Down: moved first, then the bar of the new cell, sound 9; Right: sound $0B; then the
// player's actor (the cursor) at GolferTestCursorTable 32:4E66's (x, y): ActorSetPos 0A:43C6 with x = (x + 8) x
// 32, y = (y + 8) x 32 and the slot a = y's low byte + 8 (a quirk: $34 / $4C / $64, all past $17: ActorSlotAddr
// gives the player's actor)
function* map21EnterGolferTest(sh) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => A.actorSetFacing(w, 0x00, 0x40));
  Scr.beginFadeIn(w, 0x04);
  yield* Scr.waitFade(sh);
  let b = 0;
  yield* drawGolferStatBar(sh, b);
  for (;;) {
    yield* sh.advance();
    if (w.high[0x191] & 0x01) {
      yield* golferTestStartRound(sh, b);
      wr(w, 0xC441, 0x01);
      return;
    }
    if (w.high[0x191] & 0x40) { yield* drawGolferStatBar(sh, b); b = golferTestMoveCursor(b, 1); sh.sound(0x08); }
    if (w.high[0x191] & 0x20) { yield* drawGolferStatBar(sh, b); b = golferTestMoveCursor(b, 2); sh.sound(0x0A); }
    if (w.high[0x191] & 0x80) { b = golferTestMoveCursor(b, 3); yield* drawGolferStatBar(sh, b); sh.sound(0x09); }
    if (w.high[0x191] & 0x10) { yield* drawGolferStatBar(sh, b); b = golferTestMoveCursor(b, 4); sh.sound(0x0B); }
    const p = (0x4E66 + ((b << 2) & 0xFF)) & 0xFFFF;
    const x = rw(0x32, p), y = rw(0x32, p + 2);
    const a = ((y & 0xFF) + 8) & 0xFF;
    D.inBank(w, 0x0A, () => A.actorSetPos(w, a, ((x + 8) << 5) & 0xFFFF, ((y + 8) << 5) & 0xFFFF));
  }
}

// ---- map $23 (bank 31; the debug warp's record $23) ----
// 31:483E Map23ModeMenu: the player's actor state 0 (0A:4794), a fade in (8); the menu $0085 (Tournament / Match
// Game / Practice / Clubhouse / VS / Start Over) at (1, 1) (0A:42BF) until a row, then its handler (31:4867):
// 31:4873 / 31:48A3 / 31:48D3: GolfSessionInit 10:4B28, this map and entrance as the return point (0A:4D5B), the
// mode (1 / 2 / 6), the own character as player 0 and none ($FF) / the own character again as player 1 (02:4A28),
// course 1 hole 1 / 3 / 2 (10:423B; the wind byte is the a the last SetupPlayerGolfer leaves), GolfRound 10:4451 of
// one hole, GolfSessionEnd 10:4B94; 31:4902: GolfSessionInit, EventListScreen 0A:6F56, GolfSessionEnd, warp 4;
// 31:4912: GolfSessionInit, course 2, hole $0B, mode 1, $C4BD / $C83A / $C890 = 0, P2 4, ShowScorecard 0E:43D6,
// GolfSessionEnd; 31:4940: warp 5
function* map23ModeMenu(sh) {
  const w = sh.w;
  S.actorSetState(w, 0x00, 0x00);
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  let a;
  do a = yield* S.scriptRunMenu(sh, 0x0085, 0x01, 0x01); while (a === 0xFF);
  const end = function* () { yield* inBankGen(w, 0x10, golfSessionEnd(sh)); };
  if (a <= 2) {
    const [mode, p1, hole] = [[0x01, 0xFF, 0x01], [0x02, 0x80, 0x03], [0x06, 0xFF, 0x02]][a];
    St.golfSessionInit(w);
    saveReturnPoint(w, rd(w, 0xC450), rd(w, 0xC46A));
    wr(w, 0xC834, mode);
    St.setupPlayerGolfer(w, 0x80, 0x00);
    const wind = St.setupPlayerGolferA(w, p1, 0x01);
    St.setCourseHole(w, wind, 0x01, hole);
    if (!sh.playGolfRound) notPorted("map $23's round outside the game loop");
    yield* sh.playGolfRound(0x01);
    yield* end();
  } else if (a === 3) {
    St.golfSessionInit(w);
    yield* inBankGen(w, 0x0A, eventListScreen(sh));
    yield* end();
    wr(w, 0xC441, 0x04);
  } else if (a === 4) {
    St.golfSessionInit(w);
    wr(w, 0xC836, 0x02); wr(w, 0xC837, 0x0B); wr(w, 0xC834, 0x01);
    wr(w, 0xC4BD, 0x00); wr(w, 0xC83A, 0x00); wr(w, 0xC890, 0x00); wr(w, 0xC8D0, 0x04);
    yield* inBankGen(w, 0x0E, showScorecard(sh));
    yield* end();
  } else if (a === 5) wr(w, 0xC441, 0x05);
  else notPorted(`map $23's menu row ${a} (past the table 31:4867)`);
}
// 31:47D7 Map23EnterAngleTest: frames between AngleFromVector16 00:1A03 of ($11C0, $0480), ($115C, $0480), ($11F8,
// $044C), ($11F8, $0480), ($11F8, $04E4); the last three printed (PrintHexWord 00:22BC at (9, $0C-$0E)); a frame;
// 31:483E
function* map23EnterAngleTest(sh) {
  const w = sh.w;
  yield* sh.advance();
  angleFromVector16(0x11C0, 0x0480);
  yield* sh.advance();
  angleFromVector16(0x115C, 0x0480);
  yield* sh.advance();
  printHexWord(w, angleFromVector16(0x11F8, 0x044C), 0x090C);
  yield* sh.advance();
  printHexWord(w, angleFromVector16(0x11F8, 0x0480), 0x090D);
  yield* sh.advance();
  printHexWord(w, angleFromVector16(0x11F8, 0x04E4), 0x090E);
  yield* sh.advance();
  yield* map23ModeMenu(sh);
}

export const SCRIPTS = {
  "31:47d7": map23EnterAngleTest,
  "32:40eb": talkPaletteEditor, "32:47b1": talkPaletteEditor,
  "32:417e": triggerWindTip, "32:4844": triggerWindTip, "32:4f92": triggerWindTip,
  "32:4199": map1FEnterVsResults,
  "32:48ae": map20EnterResultTests,
  "32:4c5c": function* () {},                     // 32:4C5C Map21TriggerNone: ret
  "32:4c66": map21EnterGolferTest,
  "32:4fad": function* () {},                     // 32:4FAD Map22EnterNone: ret
};
export const TASKS = w => ({
  "32:43f5": () => vsConfettiTask(w),             // 32:43F5 VsConfettiTask
  "32:467b": () => resultPaletteCycleTask(w, 0x46B5),   // 32:467B VsRainbowPaletteTask
});
