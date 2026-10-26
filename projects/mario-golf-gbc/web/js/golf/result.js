// The result screen after a match or a two-player round (RoundResultScreen 0B:59DE, a = 0 match / 2 two-player
// stroke; a = 1, the tournament placing, is not ported): the map graphics $0A with the map actors (bank 04), the two
// golfers' portraits (11:4EAB), WIN / LOSE plates, the holes-up figure, falling confetti actors and a palette cycle;
// A / B / Start leave. The plates and numbers are copied within the 64 x 64 map buffers (MapBufCopyRect) and the
// screen comes back through the BG shadow (bank 05). The tasks and RAM run headless too.
import { rb, rw } from "./rom.js";
import { mulHLByA, vectorFromLengthAndAngle } from "./math.js";
import { advanceRandomSeed } from "./round.js";
import { clearFrameTasks, registerFrameTask, unregisterFrameTask } from "./tasks.js";
import * as Scr from "./screen.js";
import * as D from "./render/display.js";
import * as A from "./actors.js";
import * as M from "./mapgfx.js";
import { restoreShadowFromMap, copyShadowRowsFramed } from "./shadow.js";

const B = 0x0B;
const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
const r16 = (w, a) => rd(w, a) | rd(w, (a + 1) & 0xFFFF) << 8;
const w16 = (w, a, v) => { wr(w, a, v & 0xFF); wr(w, (a + 1) & 0xFFFF, (v >> 8) & 0xFF); };
const setCur = (w, p) => { w.high[0x1E0] = p & 0xFF; w.high[0x1E1] = p >> 8; };
function* far(w, bank, g) {                      // a far call to a routine that runs frames
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}

// 0B:59DE RoundResultScreen; returns a as it came (the routine pops it)
export function* roundResultScreen(sh, a) {
  const w = sh.w;
  yield* sh.advance();
  wr(w, 0xC3E0, a);                              // wScriptLoop
  if (rd(w, 0xC878) === 1) return a;
  Scr.beginFadeOut(w, 0x08);
  yield* Scr.waitFade(sh);
  if (w.vram) D.disableLCDSafely(w);
  clearFrameTasks(w);
  if (w.vram) { w.lcd.wy = 0x90; D.resetSprites(w); }
  if (rd(w, 0xC96C) < 4) loadResultExtraTiles(w, rd(w, 0xC96C));
  if (w.vram) D.enableLCD(w);                    // 00:0371 (its rst $10 sound update leaves hl = $037A and the
  yield* sh.advance();                           //  channel the music driver last ran in c)
  D.inBank(w, 0x04, () => {
    A.actorsInit(w);                             // 04:410D (RegisterFrameTask leaves de = $C1C8)
    // 04:510A SpawnPlayerActor with those registers: the player's actor at ($037A, $C1C8) facing c (the sound
    // driver's channel register; w.soundBC when the page's driver gives it)
    A.spawnPlayerActor(w, 0x037A, 0xC1C8, (w.soundBC ?? 2) & 0xFF);
  });
  const old = w.high[0x196];
  setW(w, 4);
  const p = r16(w, 0xC290);
  w16(w, p + 4, 0); w16(w, p + 6, 0); wr(w, p + 0x16, 0);
  setW(w, old);
  w.high[0x18B] = w.high[0x18A] = 0;
  for (let k = 0; k < 4; k++) wr(w, 0xC320 + k, 0);
  yield* far(w, B, M.mapStartGfx(sh, 0x0A));     // 0B:46DF
  D.inBank(w, 0x04, () => { A.spawnActorList(w, 0x0B, 0x5938); A.loadActorPalettes(w); });   // 04:5084 04:4D2B
  if (w.vram) D.loadPalettesMasterOnly(w, 0x6527, 0x0B, 0x01);
  if (a === 1) throw new Error("the tournament placing (~0B:5B00, ~0B:61CF DrawRankResult) is not ported");
  const r = rd(w, 0xC96C);
  const [c, e] = r === 2 ? [1, 0] : r === 3 ? [1, 1] : [0, 1];
  const b = rd(w, 0xC890) | (rd(w, 0xC899) & 0x10), d = rd(w, 0xC8D0) | (rd(w, 0xC8D9) & 0x10);
  yield* drawVsResult(sh, a, b, c, d, e);
  yield* far(w, 0x05, restoreShadowFromMap(sh));   // 05:4492
  for (const [row, n] of [[0, 4], [4, 4], [8, 5], [0x0D, 5]]) yield* far(w, 0x05, copyShadowRowsFramed(sh, row, n));   // 05:42AD
  clearResultActors(w);
  wr(w, 0xC3F4, 0);
  Scr.beginFadeIn(w, 0x04);
  yield* Scr.waitFade(sh);
  registerFrameTask(w, 0x01, B, 0x648F);         // ResultPaletteCycleTask
  do yield* sh.advance(); while (!(w.high[0x191] & 0x0B));   // hJoyRepeat: A / B / Start
  unregisterFrameTask(w, B, 0x648F);
  unregisterFrameTask(w, B, 0x6694);
  D.inBank(w, 0x0A, () => A.actorSetPos(w, 0, 0x3F00, 0x3F00));   // 0A:43C6
  Scr.beginFadeOut(w, 0x08);
  yield* Scr.waitFade(sh);
  return a;
}

// 0B:5F54 DrawVsResult: l = mode, b / d = the two golfers (bit 4: alternative palette), c = player 2 won, e = player
// 1 won (both: a two-player tie)
function* drawVsResult(sh, l, b, c, d, e) {
  const w = sh.w;
  if (rd(w, 0xC878) === 1) return;
  const tie = l === 2 && (c & 1) && (e & 1);
  if (tie) {
    sh.sound(0x22);
    yield* loadResultTiles9100(sh);
    M.mapBufCopyRect(w, 0x18, 0x15, 0x04, 0x03, 0x0E, 0x02);
    for (let k = 8; k <= 0x0E; k++) D.inBank(w, 0x0A, () => A.actorSetPos(w, k, 0x0100, 0x0100));
  } else {
    const p1 = rd(w, 0xC893) === 3;
    sh.sound(!(c & 1) ? (p1 ? 0x21 : 0x20) : (p1 ? 0x20 : 0x21));
    if (c) {
      M.mapBufCopyRect(w, 0x05, 0x24, 0x04, 0x03, 0x05, 0x02);
      M.mapBufCopyRect(w, 0x00, 0x24, 0x0C, 0x03, 0x05, 0x02);
      D.inBank(w, 0x0A, () => {
        for (const [k, x, y] of [[8, 0x0D00, 0x0380], [9, 0x0F00, 0x0380], [0x0A, 0x1100, 0x0380], [0x0B, 0x0D00, 0x0580],
          [0x0C, 0x0F00, 0x0580], [0x0D, 0x1100, 0x0580], [0x0E, 0x0800, 0x0780]]) A.actorSetPos(w, k, x, y);
        A.actorSetFacing(w, 0x0E, 0);
      });
    }
  }
  if ((b & 0x0F) >= 0x0B) M.mapBufCopyRect(w, 0x30, 0x30, 0x04, 0x06, 0x04, 0x08);
  else yield* drawResultPortrait(sh, b, c, 0, 0x04, 0x06);
  if ((d & 0x0F) >= 0x0B) M.mapBufCopyRect(w, 0x30, 0x30, 0x0C, 0x06, 0x04, 0x08);
  else yield* drawResultPortrait(sh, d, e, 1, 0x0C, 0x06);
  if (!tie) {
    initResultActors(w, c ? 0x0E : 0x07);
    registerFrameTask(w, 0x01, B, 0x5DE1);       // ConfettiTask
    wr(w, 0xC3F5, 0);
  }
  if (l === 2) throw new Error("the two-player stroke result's figures (~0B:6143) are not ported");
  let bb = 5, cc = 0x0E;
  if (c) {
    M.mapBufCopyRect(w, 0x12, 0x2D, 0x0F, 0x0F, 0x04, 0x01);
    M.mapBufCopyRect(w, 0x12, 0x2E, 0x06, 0x0F, 0x04, 0x01);
  }
  const up = matchHolesUp(w);
  if (up >= 0x0A) { bb--; cc--; }
  drawResultNumber(w, up, bb, 0x0F);
  drawResultNumber(w, up, cc, 0x0F);
  drawResultNumber(w, rd(w, 0xC897), 0x04, 0x10);
  drawResultNumber(w, rd(w, 0xC898), 0x04, 0x11);
  drawResultNumber(w, rd(w, 0xC8D7), 0x0F, 0x10);
  drawResultNumber(w, rd(w, 0xC8D8), 0x0F, 0x11);
}

// 0B:5ED6 DrawResultPortrait: a = golfer (bit 4: palette 1 from 0B:5E8A by 0B:5ECA), b / c = picture choice and
// side, (d, e) = where: the picture's tiles (11:4EAB LoadPictureTiles, entry a x 2 + b) into tile slot
// (0B:5F40 ResultPortraitSlot), its tile numbers there (0B:5E13), then the block copied to (d, e)
function* drawResultPortrait(sh, a, b, c, d, e) {
  const w = sh.w;
  const h = a & 0x0F, l = c;
  loadPictureTiles(w, (((a & 0x0F) << 1) + b) & 0xFF, 0, (9 + 2 * l) & 0xFF);
  yield* sh.advance();
  let sd, se = 0x30, ah = h;                     // 0B:5F40 ResultPortraitSlot
  if (h >= 6) { ah = h - 6; se = 0x38; }
  sd = ((((ah << 1) + l) & 0xFF) << 2) & 0xFF;
  putTileBlock4x8(w, 0, (9 + 2 * l) & 0xFF, sd, se);
  if (a & 0x10) {
    setAttrBlock4x8Pal1(w, sd, se);
    const i = rb(B, 0x5ECA + (a & 0x0F));
    if (w.vram) D.loadPalettesMasterOnly(w, (0x5E8A + ((i << 3) & 0xFF)) & 0xFFFF, 0x01, 0x01);
  }
  M.mapBufCopyRect(w, sd, se, d, e, 0x04, 0x08);
}

// 11:4EAB LoadPictureTiles: c = entry of the LZ list 11:4F02 -> WRAM1 $D000 -> VRAM1 $8800 + (e - 8) x $100 + d x 16
// ($20 tiles; LCD off meanwhile); leaves VRAM bank 1
function loadPictureTiles(w, c, d, e) {
  const old = w.high[0x196];
  if (w.vram) D.disableLCDSafely(w);
  setW(w, 1);
  if (w.vram) w.lcd.vbk = 1;
  D.lzTo(w, 0x11, rw(0x11, (0x4F02 + (c << 1)) & 0xFFFF), 0xD000);
  const dst = ((((e - 8) & 0xFF) << 8) + ((d << 4) & 0xFFFF) + 0x8800) & 0xFFFF;
  if (w.vram) { D.startVRAMDMAFromHL(w, 0xD000, dst, 0x20); D.enableLCD(w); }
  setW(w, old);
}

function putTileBlock4x8(w, b, c, d, e) {        // 0B:5E13 PutTileBlock4x8: tiles c x 16 + b on, 4 x 8 at (d, e) in WRAM3
  const old = w.high[0x196];
  let t = (mulHLByA(c, 0x10) + b) & 0xFF;
  let hl = (0xD000 + mulHLByA(e, 0x40) + d) & 0xFFFF;
  setW(w, 3);
  for (let r = 8; r; r--, hl = (hl + 0x3C) & 0xFFFF) for (let k = 4; k; k--) { wr(w, hl, t); hl++; t = (t + 1) & 0xFF; }
  setW(w, old);
}
function setAttrBlock4x8Pal1(w, d, e) {          // 0B:5E55 SetAttrBlock4x8Pal1: palette 1 in a 4 x 8 block of WRAM2
  const old = w.high[0x196];
  let hl = (0xD000 + mulHLByA(e, 0x40) + d) & 0xFFFF;
  setW(w, 2);
  for (let r = 8; r; r--, hl = (hl + 0x3C) & 0xFFFF) for (let k = 4; k; k--) { wr(w, hl, (rd(w, hl) & 0xF8) | 1); hl++; }
  setW(w, old);
}

function matchHolesUp(w) {                       // 0B:65AE MatchHolesUp: |holes won by 2 - by 1| (1 in a playoff)
  if (rd(w, 0xC83A)) return 1;
  let d = 0, e = 0;
  for (let k = 0; k < 0x12; k++) { const v = rd(w, 0xC96E + k); if (v === 1) d++; else if (v === 2) e++; }
  let a = (e - d) & 0xFF;
  if (a >= 0xCA) a = (-a) & 0xFF;
  return a;
}

// 0B:65FE DrawResultNumber: a in 1-3 digits (the digit strip at row $29) at (d, e)
function drawResultNumber(w, a, d, e) {
  const c = Math.floor(a / 100), rest = a % 100, h = Math.floor(rest / 10), l = rest % 10;
  if (c) { M.mapBufCopyRect(w, c, 0x29, d, e, 1, 1); d = (d + 1) & 0xFF; M.mapBufCopyRect(w, h, 0x29, d, e, 1, 1); d = (d + 1) & 0xFF; }
  else if (h) { M.mapBufCopyRect(w, h, 0x29, d, e, 1, 1); d = (d + 1) & 0xFF; }
  M.mapBufCopyRect(w, l, 0x29, d, e, 1, 1);
}

// 0B:666E LoadResultExtraTiles: a = 1-3 (a 0 reads the word before the table): LZ tiles (0B:66B9) -> VRAM0 $8600
function loadResultExtraTiles(w, a) {
  const p = (0x66B9 + (((a - 1) << 1) & 0xFF)) & 0xFFFF;
  setW(w, 1);
  D.lzTo(w, B, rw(B, p), 0xD000);
  if (w.vram) D.inBank(w, B, () => D.queueAndRunVRAMCopy(w, 0xD000, 0x8600, 0x08));
}

function* loadResultTiles9100(sh) {              // 0B:6C79 LoadResultTiles9100 (LCD off)
  const w = sh.w;
  if (w.vram) D.disableLCDSafely(w);
  setW(w, 1);
  if (w.vram) w.lcd.vbk = 1;
  D.lzTo(w, B, 0x6CAE, 0xD000);
  if (w.vram) { D.startVRAMDMAFromHL(w, 0xD000, 0x9100, 0x08); D.startVRAMDMAFromHL(w, 0xD080, 0x9200, 0x08); D.enableLCD(w); }
  yield* sh.advance();
}

// 0B:5BE6 InitResultActors: actors 2-7 as confetti: +$17 = 0, column +$18 = a (or a - 1), phase +$19, a random
// falling speed +$0E ($10-$17; $08-$0F for actor 7), drawn from 1-3 seeds each
function initResultActors(w, a) {
  const old = w.high[0x196];
  setW(w, 4);
  for (const [slot, col, ph, seeds, base] of [[2, -1, 0xCC, 3, 0x10], [3, 0, 0x99, 2, 0x10], [4, 0, 0x66, 1, 0x10],
    [5, -1, 0x33, 3, 0x10], [6, 0, 0x00, 2, 0x10], [7, 0, 0x00, 1, 0x08]]) {
    const p = A.actorSlotAddr(slot);             // 0A:42E0
    setCur(w, p);
    wr(w, p + 0x17, 0); wr(w, p + 0x18, (a + col) & 0xFF); wr(w, p + 0x19, ph);
    let v = 0;
    for (let k = 0; k < seeds; k++) v = advanceRandomSeed(w);
    wr(w, p + 0x0E, ((v & 7) + base) & 0xFF); wr(w, p + 0x0F, 0);
  }
  setW(w, old);
}

// 0B:5D2C ConfettiActorStep: x = column +$18 + a sway (VectorFromLengthAndAngle $180 at phase +$19 + y / 8), y +=
// speed; past row $0F ($11 when $C3E0 = 1) back to row 6 ($0680, or $0600 with $C3F5) at a new speed
function confettiActorStep(w, slot) {
  const p = A.actorSlotAddr(slot);
  setCur(w, p);
  setW(w, 4);
  const y0 = r16(w, p + 6);
  const ang = (((y0 & 0x8000 ? y0 | ~0xFFFF : y0) >> 3) + rd(w, p + 0x19)) & 0xFF;
  const [x] = vectorFromLengthAndAngle(0x0180, ang);
  w16(w, p + 4, (x + (rd(w, p + 0x18) << 8)) & 0xFFFF);
  const y = (y0 + r16(w, p + 0x0E)) & 0xFFFF;
  w16(w, p + 6, y);
  if ((y >> 8) < (rd(w, 0xC3E0) === 1 ? 0x11 : 0x0F)) return;
  w16(w, p + 6, rd(w, 0xC3F5) ? 0x0600 : 0x0680);
  const v = advanceRandomSeed(w);
  wr(w, p + 0x0E, ((v & 7) + 0x10) & 0xFF); wr(w, p + 0x0F, 0);
}
export function confettiTask(w) {                // 0B:5DE1 ConfettiTask
  const old = w.high[0x196];
  for (let k = 2; k <= 7; k++) confettiActorStep(w, k);
  resultBobActor(w);
  setW(w, old);
}
function resultBobActor(w) {                     // 0B:652F ResultBobActor: actor $0E's y = $0800 + a sine x $40
  const p = A.actorSlotAddr(0x0E);
  setCur(w, p);
  setW(w, 4);
  const a = rd(w, p + 0x18);
  wr(w, p + 0x18, (a + (a & 0x80 ? 4 : 2)) & 0xFF);
  const [, s] = vectorFromLengthAndAngle(0x40, a);
  w16(w, p + 6, (0x0800 + s) & 0xFFFF);
}
function clearResultActors(w) {                  // 0B:6402 ClearResultActors: +$17 of actors 8-13 (leaves WRAM4)
  setW(w, 4);
  for (let k = 8; k <= 0x0D; k++) { const p = A.actorSlotAddr(k); setCur(w, p); wr(w, p + 0x17, 0); }
}

export function resultPaletteCycleTask(w) {      // 0B:648F ResultPaletteCycleTask: colours 0B:64C9 by $C3F4 (0-$26)
  let a = rd(w, 0xC3F4);
  if (a >= 0x27) { a = 0; wr(w, 0xC3F4, 0); }
  const hl = 0x64C9 + ((a << 1) & 0xFF);
  if (w.vram) { D.loadPalettesImmediate(w, hl, 0x0A, 0x01); D.loadPalettesImmediate(w, hl + 6, 0x0C, 0x01); }
  wr(w, 0xC3F4, (rd(w, 0xC3F4) + 1) & 0xFF);
}
export function resultSpriteTask(w) {            // 0B:6694 ResultSpriteTask: a 2 x 2 sprite at ($22-$32, $5C-$64)
  if (!w.vram) return;
  D.queueSprite(w, 0x22, 0x5C, 0x60, 0x02);
  D.queueSprite(w, 0x22, 0x64, 0x62, 0x02);
  D.queueSprite(w, 0x32, 0x5C, 0x64, 0x04);
  D.queueSprite(w, 0x32, 0x64, 0x66, 0x04);
}
