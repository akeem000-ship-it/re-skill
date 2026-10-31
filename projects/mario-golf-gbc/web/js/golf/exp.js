// Bank 48: the EXP screen and the character card (REVERSE.md "Bank 48"). ExpScreen 48:4053 draws a full screen into
// the WRAM1 maps (attributes $D000, tiles $D400; PutCardTile 48:48CF), the character's animated sprite (bank 42,
// charsprite.js) and the counters as digit sprites; with a = 0 it is the card a saved game shows when loaded (name,
// level, where it was saved) with a Yes / No box; else it counts de EXP points into the character one at a time
// (faster with A or B; 6 or 14 more steps a frame while 1,000 or 10,000 remain), shows the bonus line ($CAAD /
// $CAAE: a trophy or the opponent beaten) and adds the total with AddExp 02:5465. AwardExpPoints 48:4D70 is the
// round's end (08:4F29) and the saved game's pending EXP (32:5146).
import { rb, rw } from "./rom.js";
import * as D from "./render/display.js";
import * as Scr from "./screen.js";
import * as T from "./text.js";
import { clearFrameTasks, registerFrameTask, unregisterFrameTask } from "./tasks.js";
import { initFontScreen } from "./pictures.js";
import { copyMapToScrollBuffers } from "./standings.js";
import { initWindowSystem } from "./round.js";
import { initCharSprite, charSpriteTask } from "./charsprite.js";
import { levelUpScreen } from "./levelup.js";
import { mapIndexOf } from "./mapengine.js";

const rd = D.rd, wr = D.wr;
const wbank = w => w.high[0x196];
const setW = (w, n) => D.setWramBank(w, n);
const r16 = (w, a) => rd(w, a) | rd(w, (a + 1) & 0xFFFF) << 8;
const w16 = (w, a, v) => { wr(w, a, v & 0xFF); wr(w, a + 1, (v >> 8) & 0xFF); };
const B = 0x48;
function notPorted(what) { throw new Error(`${what} is not ported`); }
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}

// ---- bank 02: EXP ----
// 02:53C4 Add24Capped: the 24-bit [hl] += de, at most the value at 02:53E4 (99,999); 02:53E8 Compare24
function add24Capped(w, hl, de) {
  let v = rd(w, hl) | rd(w, hl + 1) << 8 | rd(w, hl + 2) << 16;
  v = (v + de) & 0xFFFFFF;
  const cap = rb(0x02, 0x53E4) | rb(0x02, 0x53E5) << 8 | rb(0x02, 0x53E6) << 16;
  if (((cap - v) & 0x800000)) v = cap;           // (bit 7 of the top byte of cap - value: a borrow)
  wr(w, hl, v & 0xFF); wr(w, hl + 1, (v >> 8) & 0xFF); wr(w, hl + 2, v >> 16);
}
export function addExp(w, de) { add24Capped(w, 0xC826, de); }   // 02:5465 AddExp
// the next level's threshold entry: 02:54CD by wCharId & 3, 3 bytes per level
const thresholdAt = w => (rw(0x02, 0x54CD + 2 * (rd(w, 0xC810) & 3)) + 3 * rd(w, 0xC812)) & 0xFFFF;
// 02:546B CheckLevelUp: true (z) when the 24-bit EXP is at least the next level's threshold (02:53E8 Compare24: bit 7
// of the difference's top byte clear); never at level 99
export function checkLevelUp(w) {
  if (rd(w, 0xC812) >= 0x63) return false;
  const t = thresholdAt(w);
  const v = rd(w, 0xC826) | rd(w, 0xC827) << 8 | rd(w, 0xC828) << 16;
  const th = rb(0x02, t) | rb(0x02, t + 1) << 8 | rb(0x02, t + 2) << 16;
  return !(((v - th) >> 16) & 0x80);
}
// 02:5498 ExpToNextLevel: the threshold's low 16 bits - the EXP's (0 at level 99)
export function expToNextLevel(w) {
  if (rd(w, 0xC812) >= 0x63) return 0;
  return (rw(0x02, thresholdAt(w)) - r16(w, 0xC826)) & 0xFFFF;
}

// ---- drawing into the WRAM1 maps ----
// 48:48CF PutCardTile: tile d, attribute e at (b, c) (48:48B9 CardBufferAddr: $D000 + 32 c + b)
function putCardTile(w, b, c, d, e) {
  const old = wbank(w);
  setW(w, 1);
  const hl = (0xD000 + ((32 * c) & 0xFFFF) + b) & 0xFFFF;
  wr(w, hl, e); wr(w, hl + 0x400, d);
  setW(w, old);
}
// a block of (tile, attribute) pairs from bank 48 at hl into columns x0.. (w wide), rows y0..y1-1
function putBlock(w, hl, x0, xw, y0, y1) {
  for (let c = y0; c < y1; c++) for (let b = x0; b < x0 + xw; b++, hl += 2) putCardTile(w, b, c, rb(B, hl), rb(B, hl + 1));
}
const drawExpFrameBlock = w => putBlock(w, 0x445F, 0, 0x14, 0, 5);   // 48:4527 DrawExpFrameBlock
const drawExpMessageBox = w => putBlock(w, 0x45CE, 1, 8, 0x0B, 0x0F); // 48:460E DrawExpMessageBox
function fillTiles(w, x0, x1, y0, y1, d, e) {    // 48:4673 / 48:4791 / 48:47B4 / 48:47D7 (the duplicate)
  for (let c = y0; c < y1; c++) for (let b = x0; b < x1; b++) putCardTile(w, b, c, d, e);
}
// 48:4867 DrawTileString: the tile string at hl (bank 48) from (b, c), attribute e; $9E / $9F / $DE / $DF put a mark
// on the row above (on row 0: drawn in place); 48:4852 DrawTileStringRecord: x, y, attribute, then the string
function drawTileString(w, hl, b, c, e) {
  for (;; hl = (hl + 1) & 0xFFFF) {
    const a = rb(B, hl);
    if (!a) return;
    if (a === 0x9E || a === 0x9F || a === 0xDE || a === 0xDF) {
      const bb = (b - 1) & 0xFF, cc = (c - 1) & 0xFF;
      if (cc) putCardTile(w, bb, cc, a, e);
      else putCardTile(w, bb, cc, a === 0x9E || a === 0xDE ? 0x03 : 0x04, 0x0B);
      continue;
    }
    putCardTile(w, b, c, a, e);
    b = (b + 1) & 0xFF;
  }
}
const drawTileStringRecord = (w, hl) => drawTileString(w, (hl + 3) & 0xFFFF, rb(B, hl), rb(B, hl + 1), rb(B, hl + 2));
const fillBytes = (w, hl, d, a) => { for (; d; d--) wr(w, hl++, a); };   // 48:4DFA FillBytesD

// 48:4639 DrawCardNameLevel: the name area cleared (48:4673: x 6-13, y 6-8), text $149B (the name) at $D4C7, the level
// pushed (05:551F) for text $149C at $D507
function* drawCardNameLevel(sh) {
  const w = sh.w;
  fillTiles(w, 6, 0x0E, 6, 9, 0x20, 0x00);
  setW(w, 1);
  yield* inBankGen(w, 5, T.printTextToBuffer(sh, 0x149B, 0xD4C7, 0x20));
  T.pushTextNumberArg(w, rd(w, 0xC812));
  yield* inBankGen(w, 5, T.printTextToBuffer(sh, 0x149C, 0xD507, 0x20));
}

// 48:4C7D DrawExpMessage: a = 0 "Calculating EXP Pts." (with the bonus line 48:4DFF) / 1 the N64 transfer's two lines /
// 2 "Pts to next level:" / 3 "Level up!" (into WRAM7 $DD2B for later; sound $63) / 4 "Your level increased." /
// 5 "It's the highest level!" (sound 0); each line's attributes 1
function* drawExpMessage(sh, a) {
  const w = sh.w;
  const line = function* (id, de, attr) {
    yield* inBankGen(w, 5, T.printTextToBuffer(sh, id, de, 0x20));
    if (attr) fillBytes(w, attr, 0x10, 1);
  };
  switch (a) {
    case 0: setW(w, 1); yield* line(0x14AE, 0xD442, 0xD042); yield* drawBonusExpMessage(sh); return;
    case 1: setW(w, 1); yield* line(0x14AF, 0xD422, 0xD022); yield* line(0x14B0, 0xD462, 0xD062); return;
    case 2: setW(w, 1); yield* line(0x14B1, 0xD601, 0xD201); return;
    case 3: setW(w, 7); yield* line(0x14B2, 0xDD2B, 0); sh.sound(0x63); return;
    case 4: setW(w, 1); yield* line(0x14B3, 0xD442, 0xD042); return;
    case 5: sh.sound(0x00); setW(w, 1); yield* line(0x14B4, 0xD601, 0xD201); return;
    default: return;
  }
}
// 48:4DFF DrawBonusExpMessage: with a bonus ($CAAD): WRAM7 rows $DB00-$DB5F / $DA00-$DA5F get the frame's tiles /
// attributes (every other byte of 48:4487 / 48:4488, 20 each), then the line: 1-3 a trophy ($14B6-$14B8), $14-$19
// "for beating" + text $47-$4C (48:4F3F), others + $4D, at $DB42 (attributes 1 x 17 at $DA42), and "Adding EXP Pts"
// ($14B5) at $DB02
function* drawBonusExpMessage(sh) {
  const w = sh.w;
  const k = rd(w, 0xCAAD);
  if (!k) return;
  const old = wbank(w);
  setW(w, 7);
  for (const [dst, src] of [[0xDB00, 0x4487], [0xDB20, 0x4487], [0xDB40, 0x4487], [0xDA00, 0x4488], [0xDA20, 0x4488], [0xDA40, 0x4488]])
    for (let c = 0; c < 0x14; c++) wr(w, dst + c, rb(B, src + 2 * c));   // 48:4F37 CopyEvenBytes
  setW(w, old);
  setW(w, 7);
  if (k >= 1 && k <= 3) yield* inBankGen(w, 5, T.printTextToBuffer(sh, 0x14B5 + k, 0xDB42, 0x20));
  else {                                         // 48:4F3F DrawBeatingLine
    yield* inBankGen(w, 5, T.printTextToBuffer(sh, 0x14B9, 0xDB42, 0x20));
    yield* inBankGen(w, 5, T.printTextToBuffer(sh, k >= 0x14 && k <= 0x19 ? 0x47 + k - 0x14 : 0x4D, 0xDB4A, 0x20));
  }
  fillBytes(w, 0xDA42, 0x11, 1);
  setW(w, 7);
  yield* inBankGen(w, 5, T.printTextToBuffer(sh, 0x14B5, 0xDB02, 0x20));
  fillBytes(w, 0xDA02, 0x11, 1);
}

// 48:4362 LoadExpScreenGfx: h = ExpScreen's a: the screen's tiles (LZ 48:4F70 -> VRAM1 $9000 / $8800), palettes
// 0-7 (48:58A0), the character sprite (42:400B) at ($78, $28), two LZ tile sets at VRAM1 $8C00 / $8C40 and OBJ
// palette 1 (48:5B19); a = 1: the counters' digits (LZ 48:5B29 -> VRAM1 $8CA0); else (the card) the Yes / No
// cursor (LZ 48:5A60 -> VRAM1 $8C80, OBJ palette 2) and the card's art (LZ 48:5BC0 -> $9400); then the maps
// (48:5660 -> $D000, 48:5420 -> $D400)
function loadExpScreenGfx(w, h) {
  setW(w, 1);
  D.lzTo(w, B, 0x4F70, 0xD000);
  D.inBank(w, B, () => {
    D.queueVRAMCopy(w, 0xD000, 0xB000, 0x80);
    D.queueAndRunVRAMCopy(w, 0xD800, 0xA800, 0x40);
    D.loadPalettesMasterOnly(w, 0x58A0, 0x00, 0x08);
  });
  setW(w, 6);
  wr(w, 0xD504, 0);
  D.processVRAMCopyQueue(w);
  initCharSprite(w);                             // 42:400B
  D.processVRAMCopyQueue(w);
  setW(w, 6);
  wr(w, 0xD54C, 0x78); wr(w, 0xD54D, 0x28);
  setW(w, 1);
  D.inBank(w, B, () => {
    D.lzTo(w, B, 0x5A90, 0xD000); D.queueAndRunVRAMCopy(w, 0xD000, 0xAC00, 0x04);
    D.lzTo(w, B, 0x5AD0, 0xD000); D.queueAndRunVRAMCopy(w, 0xD000, 0xAC40, 0x04);
    D.loadPalettesMasterOnly(w, 0x5B19, 0x09, 0x01);
    if (h !== 1) {
      D.lzTo(w, B, 0x5A60, 0xD000); D.queueAndRunVRAMCopy(w, 0xD000, 0xAC80, 0x02);
      D.loadPalettesMasterOnly(w, 0x5A78, 0x0A, 0x01);
      D.lzTo(w, B, 0x5BC0, 0xD000); D.queueAndRunVRAMCopy(w, 0xD000, 0x9400, 0x40);
    } else {
      D.processVRAMCopyQueue(w);
      setW(w, 1);
      D.lzTo(w, B, 0x5B29, 0xDE00); D.queueAndRunVRAMCopy(w, 0xDE00, 0xACA0, 0x14);
    }
    setW(w, 1);
    D.copyMemoryFast(w, 0x5660, 0xD000, 0x24);
    D.copyMemoryFast(w, 0x5420, 0xD400, 0x24);
  });
}

// ---- the frame tasks ----
// 00:2326 FormatDecimalNumberUnsigned: hl in decimal, right-aligned in a field of a (0: none), 0-ended, to de
export function formatDecimalUnsigned(w, hl, de, a) {
  const dig = [Math.floor(hl / 10000), Math.floor(hl / 1000) % 10, Math.floor(hl / 100) % 10, Math.floor(hl / 10) % 10, hl % 10];
  if (a) {
    let b = 5, i = 0;
    while (i < 5 && !dig[i]) { b--; i++; }
    if (!b) b = 1;
    for (let p = a - b; p > 0; p--) wr(w, de++, 0x20);
  }
  let i = 0;
  while (i < 4 && !dig[i]) i++;
  for (; i < 5; i++) wr(w, de++, 0x30 + dig[i]);
  wr(w, de, 0);
}
// 48:4C54 DrawDigitSprites / 48:4BD4 DrawDigitSpritesShifted (x + [$D63A]): a chars at hl as sprites at (d, e), 8
// apart: tile [$D636] + 2 x digit, attribute [$D637]; spaces skipped
function drawDigitSprites(w, n, hl, d, e, shift) {
  for (; n; n--, hl++, d = (d + 8) & 0xFF) {
    const a = rd(w, hl);
    if (a === 0x20) continue;
    const dd = shift ? (rd(w, 0xD63A) + d) & 0xFF : d;
    D.queueSprite(w, e, dd, (rd(w, 0xD636) + (((a - 0x30) << 1) & 0xFF)) & 0xFF, rd(w, 0xD637));
  }
}
// 48:4B05 ExpDrawCounters: the counted EXP [$D632] (5 digits at [$D634], [$D635], shifted); unless level 99: after a
// level-up (wBallX $D400 set) the next threshold's points [$D63C]; else the points to go [$D642] while above 0; at 0
// (once: $D63B) the message rows give way to "Level up!" (WRAM2 $D800 attributes 1 -> VRAM1 $99E0, WRAM7 $DD00 ->
// $99E0; the WRAM3 row filled with spaces is not queued) and [$D63C] is shown
export function expDrawCounters(w) {
  setW(w, 6);
  formatDecimalUnsigned(w, r16(w, 0xD632), 0xD64E, 5);
  drawDigitSprites(w, 5, 0xD64E, rd(w, 0xD634), rd(w, 0xD635), true);
  setW(w, 6);
  if (rd(w, 0xC812) === 0x63) return;
  if (!rd(w, 0xD400)) {
    if (rd(w, 0xD63B)) return;
    const v = r16(w, 0xD642);
    if (v) {
      formatDecimalUnsigned(w, v, 0xD644, 5);
      drawDigitSprites(w, 5, 0xD644, rd(w, 0xD63E), rd(w, 0xD63F), false);
      return;
    }
    setW(w, 2);
    fillBytes(w, 0xD800, 0x40, 0x01);
    D.queueVRAMCopy(w, 0xD800, 0xB9E0, 0x04);
    setW(w, 3);
    fillBytes(w, 0xD800, 0x40, 0x20);
    setW(w, 7);
    D.queueVRAMCopy(w, 0xDD00, 0x99E0, 0x04);
    setW(w, 6);
    wr(w, 0xD63B, 1);
  }
  formatDecimalUnsigned(w, r16(w, 0xD63C), 0xD644, 5);
  drawDigitSprites(w, 5, 0xD644, rd(w, 0xD63E), rd(w, 0xD63F), false);
}
// 48:4336 ExpCharSpriteTask: CharSpriteTask 42:4074, then the sprite template 48:4350 at d $70, e $58, tile $C0,
// attribute 9
export function expCharSpriteTask(w) {
  charSpriteTask(w);
  D.inBank(w, B, () => D.queueSpriteTemplate(w, 0x4350, 0x58, 0x70, 0xC0, 0x09));
}
// 48:42F7 YesNoCursorTask: the cursor (template 48:4330, tile $C8, attribute $0A) at row [$D251] x 16, shown while
// bit 5 of the counter [$D253] (counted first) is clear
export function yesNoCursorTask(w) {
  setW(w, 6);
  const e = (rd(w, 0xD251) << 4) & 0xFF;
  const n = (rd(w, 0xD253) + 1) & 0xFF;
  wr(w, 0xD253, n);
  if (!(n & 0x20)) D.inBank(w, B, () => D.queueSpriteTemplate(w, 0x4330, e, 0x00, 0xC8, 0x0A));
}

// 48:4C02 ExpCountStep: until done ($D638), the counted EXP [$D632] + 1 (done when it reaches the award [$D630]);
// [$D642] = [$D63C] - counted, 0 when negative
function expCountStep(w) {
  setW(w, 6);
  if (!rd(w, 0xD638)) {
    const n = (r16(w, 0xD632) + 1) & 0xFFFF;
    w16(w, 0xD632, n);
    if (r16(w, 0xD630) === n) wr(w, 0xD638, 1);
  }
  const v = (r16(w, 0xD63C) - r16(w, 0xD632)) & 0xFFFF;
  w16(w, 0xD642, v & 0x8000 ? 0 : v);
}

// the wait at the end of a count: the bonus line's shift [$D63A] ($FC on the first screen, else 0; counted up while
// not 0, which moves the digits right) for up to b frames or until a button is pressed
function* waitShift(sh, b) {
  const w = sh.w;
  setW(w, 6);
  wr(w, 0xD63A, rd(w, 0xD400) ? 0 : 0xFC);
  for (;;) {
    if (rd(w, 0xD63A)) wr(w, 0xD63A, (rd(w, 0xD63A) + 1) & 0xFF);
    yield* sh.advance();
    if (!--b) return;
    if (w.high[0x194]) return;
  }
}

// 48:4053 ExpScreen: a = 0: the card; else the EXP count of de with message h
export function* expScreen(sh, a, de, h) {
  const w = sh.w;
  const bank0 = wbank(w);
  Scr.beginFadeOut(w, 0x10);
  yield* Scr.waitFade(sh);
  clearFrameTasks(w);
  yield* inBankGen(w, 5, initWindowSystem(sh));  // 05:407A
  initFontScreen(w);                             // 01:41E8
  D.inBank(w, 3, () => T.resetGlyphBuffer(w));   // 03:4EB8
  D.disableLCDSafely(w);
  D.resetSprites(w);
  w.high[0x18A] = 0; w.high[0x18B] = 0;
  loadExpScreenGfx(w, a);
  yield* drawCardNameLevel(sh);
  if (!a) {                                      // 48:4088 the card
    yield* drawYesNoBox(sh);                     // 48:458C
    registerFrameTask(w, 0x0E, B, 0x42F7);       // YesNoCursorTask
    if (rd(w, 0xC834) !== 9) yield* drawCardRoundInfo(sh);   // 48:4696
    else notPorted("the card's place in the story (~48:480D DrawCardMapName)");
    setW(w, 1);                                  // 48:42B9
    D.queueVRAMCopy(w, 0xD000, 0xB800, 0x24);
    D.queueAndRunVRAMCopy(w, 0xD400, 0x9800, 0x24);
    copyMapToScrollBuffers(w);                   // 00:0804
    yield* inBankGen(w, 3, T.uploadGlyphTiles(sh));   // 03:4F6C
    registerFrameTask(w, 0x0F, B, 0x4336);       // ExpCharSpriteTask
    D.enableLCD(w);
    Scr.beginFadeIn(w, 0x10);
    yield* Scr.waitFade(sh);
    setW(w, bank0);
    return;
  }
  drawExpMessageBox(w);
  setW(w, bank0);
  const bank1 = wbank(w);
  yield* drawExpMessage(sh, h);
  yield* drawExpMessage(sh, 3);
  setW(w, 6);
  yield* drawExpMessage(sh, rd(w, 0xC812) === 0x63 ? 5 : 2);
  yield* inBankGen(w, 3, T.uploadGlyphTiles(sh));   // 03:4F6C
  setW(w, 6);
  w16(w, 0xD630, de); w16(w, 0xD632, 0);
  [0x1C, 0x6C, 0xCA, 0x08, 0x00, 0x00, 0x00].forEach((v, k) => wr(w, 0xD634 + k, v));
  const next = expToNextLevel(w);                // 02:5498
  w16(w, 0xD63C, next); w16(w, 0xD642, next);
  [0x68, 0x84, 0xCA, 0x08].forEach((v, k) => wr(w, 0xD63E + k, v));
  wr(w, 0xD63B, 0);
  setW(w, 1);
  D.queueVRAMCopy(w, 0xD000, 0xB800, 0x24);
  D.queueAndRunVRAMCopy(w, 0xD400, 0x9800, 0x24);
  copyMapToScrollBuffers(w);                     // 00:0804
  registerFrameTask(w, 0x0F, B, 0x4336);         // ExpCharSpriteTask
  D.enableLCD(w);
  Scr.beginFadeIn(w, 0x10);
  yield* Scr.waitFade(sh);
  registerFrameTask(w, 0x0F, B, 0x4B05);         // ExpDrawCounters
  setW(w, 6);
  if (h !== 4 && r16(w, 0xD630)) {
    for (;;) {
      expCountStep(w);
      if (rd(w, 0xD638)) {                       // 48:41F9 counted
        sh.sound(0x5C);
        const k = rd(w, 0xCAAD);
        if (!k) break;
        yield* waitShift(sh, 0x28);
        yield* showBonusLine(sh, k);
        sh.sound(0x5C);
        yield* sh.advance(0x14);
        setW(w, 6);
        w16(w, 0xD630, (r16(w, 0xD630) + r16(w, 0xCAAE)) & 0xFFFF);
        wr(w, 0xCAAD, 0); wr(w, 0xD638, 0);
        continue;
      }
      if (!rd(w, 0xD639) && !(w.high[0x190] & 3)) {
        sh.sound(0x5B);
        yield* sh.advance(4);                    // WaitFramesCmd 4
        continue;
      }
      wr(w, 0xD639, 1);
      sh.sound(0x5C);
      expCountStep(w);
      const v = r16(w, 0xD630);
      if (v >= 1000) for (let n = v >= 10000 ? 14 : 6; n; n--) expCountStep(w);
      yield* sh.advance();
    }
  }
  yield* waitShift(sh, 0xF0);                    // 48:425C
  Scr.beginFadeOut(w, 0x10);
  yield* Scr.waitFade(sh);
  unregisterFrameTask(w, B, 0x4336);
  unregisterFrameTask(w, B, 0x4B05);
  yield* sh.advance();
  setW(w, 6);
  const total = r16(w, 0xD630);
  if (total) addExp(w, total);                   // 02:5465
  void bank1;
}

// 48:4DC4 ShowBonusLine: a != 0: (a frame first while the character's tiles are uploading) the WRAM7 rows $DA00 /
// $DB00 queued to the window rows at $9820 (attributes, tiles)
function* showBonusLine(sh, a) {
  const w = sh.w;
  if (!a) return;
  setW(w, 6);
  if (rd(w, 0xD551)) yield* sh.advance();
  const old = wbank(w);
  setW(w, 7);
  D.inBank(w, B, () => { D.queueVRAMCopy(w, 0xDA00, 0xB820, 0x06); D.queueVRAMCopy(w, 0xDB00, 0x9820, 0x06); });
  setW(w, old);
}

// 48:4D70 AwardExpPoints: de EXP with message h: wBallX $D400 = 0, ExpScreen(1, de, h); a level reached ($D63B):
// LevelUpScreen 41:402A (levelup.js), then ExpScreen(1, 0, 4) with $D400 = 1. The WRAM bank is restored.
export function* awardExpPoints(sh, de, h) {
  const w = sh.w, old = wbank(w);
  setW(w, 6);
  wr(w, 0xD400, 0);
  setW(w, old);
  yield* expScreen(sh, 1, de, h);
  setW(w, 6);
  if (rd(w, 0xD63B)) {
    yield* levelUpScreen(sh);                    // 41:402A
    setW(w, 6);
    wr(w, 0xD400, 1);
    yield* expScreen(sh, 1, 0, 4);
  }
  setW(w, old);
}

// ---- the saved game's card (ExpScreen a = 0, from 32:7D35 LoadSummaryPrompt) ----
// 48:458C DrawYesNoBox: the 6 x 5 block of 48:4550 at rows 5-9; "Yes" / "No" (text $1A: its first line at $D4C2, the
// rest at $D502: 05:638A)
function* drawYesNoBox(sh) {
  const w = sh.w;
  for (let c = 5, hl = 0x4550; c < 0x0A; c++) for (let b = 0; b < 6; b++, hl += 2) putCardTile(w, b, c, rb(B, hl), rb(B, hl + 1));
  yield* inBankGen(w, 5, T.printTextToBuffer(sh, 0x1A, 0xD4C2, 0x20));
  yield* inBankGen(w, 5, T.printTextToBuffer(sh, 0x1A, 0xD502, 0x20, true));
}
// 48:4696 DrawCardRoundInfo: rows $0B-$11 cleared (48:47B4, 48:4791); the mode's name (text $14A8 + mode - 1), the
// course (text $21 + course), "Hole n" ($14A0 with the hole pushed) and "Score" ($14A1) with the score to par
// (48:48F3) from the record; in match play the holes up instead (~48:4724, not ported)
function* drawCardRoundInfo(sh) {
  const w = sh.w;
  fillTiles(w, 1, 0x14, 0x0D, 0x12, 0x20, 0x01);   // 48:4791 ClearCardRows13
  fillTiles(w, 1, 0x0A, 0x0B, 0x0D, 0x20, 0x01);   // 48:47B4 ClearCardRows11 (x 1-9)
  yield* inBankGen(w, 5, T.printTextToBuffer(sh, (0x14A8 + ((rd(w, 0xC834) - 1) & 0xFF)) & 0xFFFF, 0xD581, 0x20));
  yield* inBankGen(w, 5, T.printTextToBuffer(sh, (0x21 + rd(w, 0xC836)) & 0xFFFF, 0xD5C1, 0x20));
  T.pushTextNumberArg(w, rd(w, 0xC837));         // 05:551F
  setW(w, 1);
  yield* inBankGen(w, 5, T.printTextToBuffer(sh, 0x14A0, 0xD601, 0x20));
  if (rd(w, 0xC834) === 2) {
    // 48:4724 (match play): the holes up so far: b counts wMatchHoles $C96E for the holes played (1: +1, 2: -1)
    // from the caller's b, which is 0 (left by RegisterFrameTask's SortFrameTasks 00:24BD just before; 05:62AA and
    // 05:551F keep bc); a playoff ($C83A) or level: $14BD; ahead: $14BB with b; behind: $14BC with -b
    let b = 0;
    for (let a = rd(w, 0xC837), hl = 0xC96E; a; a = (a - 1) & 0xFF, hl++) {
      const v = rd(w, hl);
      if (v === 1) b = (b + 1) & 0xFF; else if (v === 2) b = (b - 1) & 0xFF;
    }
    let id = 0x14BD;
    if (!rd(w, 0xC83A) && b) {
      if (b & 0x80) { T.pushTextNumberArg(w, (-b) & 0xFF); id = 0x14BC; }
      else { T.pushTextNumberArg(w, b); id = 0x14BB; }
    }
    yield* inBankGen(w, 5, T.printTextToBuffer(sh, id, 0xD608, 0x20));
    return;
  }
  yield* inBankGen(w, 5, T.printTextToBuffer(sh, 0x14A1, 0xD608, 0x20));
  drawSignedScore(w, rd(w, 0xC8BE), 0x0C, 0x10);
}
// 48:4A08 ScoreByteToSigned: $91 and up negative
const scoreSigned = a => (a >= 0x91 ? (a - 0x100) : a);
// 48:48F3 DrawSignedScore: at (b, c), attribute 1: '+' ($2B), '-' ($2D) or even ($47); a hundred as '1'; the tens
// (also a 0 when the byte is $64-$E3); the units (48:49A2 / 48:49CF: of |score| less 100 when at least 100)
function drawSignedScore(w, d, b, c) {
  const s = scoreSigned(d), m = Math.abs(s), r = m >= 100 ? m - 100 : m;
  putCardTile(w, b++, c, !s ? 0x47 : s > 0 ? 0x2B : 0x2D, 0x01);
  if (d && Math.floor(m / 100)) putCardTile(w, b++, c, 0x31, 0x01);
  const t = Math.floor(r / 10);
  if (t) putCardTile(w, b++, c, 0x30 + t, 0x01);
  else if (!((d - 0x64) & 0x80)) putCardTile(w, b++, c, 0x30, 0x01);
  putCardTile(w, b, c, 0x30 + r % 10, 0x01);
}
// 48:4A81 DrawGfxPromptA / 48:4AC3 DrawGfxPromptB: the frame (48:4527) and two tile strings (48:400E / 48:4019 or
// 48:4029 / 48:4039) in the WRAM1 maps, their top 8 rows queued to the BG map
export function drawGfxPrompt(w, b) {
  const old = wbank(w);
  setW(w, 1);
  drawExpFrameBlock(w);
  drawTileStringRecord(w, b ? 0x4029 : 0x400E);
  drawTileStringRecord(w, b ? 0x4039 : 0x4019);
  setW(w, 1);
  D.queueVRAMCopy(w, 0xD000, 0xB800, 0x08);
  D.queueVRAMCopy(w, 0xD400, 0x9800, 0x08);
  setW(w, old);
}

// ---- the older summary card of bank 41 (OpenCharSummaryScreen, bank 41 export $1C: nothing calls it; the loaded
// game's card is ExpScreen 48:4053 a = 0. A test's patch of LoadSummaryPrompt's farcall 32:7D39 reaches it:
// w.charSummary) ----
// 41:7C7D DrawCharSummary: WRAM1; the tile rows 41:7BFD (row 0), 41:7C1D (rows 1-16), 41:7C3D (row 17) to $D400 and
// the attribute row 41:7C5D x 18 to $D000 (32 bytes each); the texts (05:62AA, $20 wide): the name $149B at $D4C7, the
// level (+$12; $149C) at $D507, the drive yards (+$1A word; $149D) at $D547; the place: the saved mode +$34 9 (the
// story): the map's name ($012C + 0A:5348 of wReturnMap $C960) at $D587, else the mode's ($14A8 + mode - 1) at $D587,
// the course (+$36; text $21 + it) at $D5C7, the hole (+$37; $14A0) at $D607; the attributes and tiles to the BG
// (00:0468, 00:04DB), the scroll buffers (00:0804); the WRAM bank restored
function* drawCharSummary(sh) {
  const w = sh.w, old = w.high[0x196];
  setW(w, 1);
  const B41 = 0x41;
  D.inBank(w, B41, () => {
    D.copyMemoryFast(w, 0x7BFD, 0xD400, 0x02);
    for (let a = 0; a < 0x10; a++) D.copyMemoryFast(w, 0x7C1D, (0xD420 + a * 0x20) & 0xFFFF, 0x02);
    D.copyMemoryFast(w, 0x7C3D, 0xD620, 0x02);
    for (let a = 0; a < 0x12; a++) D.copyMemoryFast(w, 0x7C5D, (0xD000 + a * 0x20) & 0xFFFF, 0x02);
  });
  const text = function* (id, de) { yield* inBankGen(w, 0x05, T.printTextToBuffer(sh, id, de, 0x20)); };
  yield* text(0x149B, 0xD4C7);
  T.pushTextNumberArg(w, rd(w, 0xC812));
  yield* text(0x149C, 0xD507);
  T.pushTextNumberArg(w, rd(w, 0xC81A) | rd(w, 0xC81B) << 8);
  yield* text(0x149D, 0xD547);
  const m = rd(w, 0xC834);
  if (m === 0x09) {
    yield* text((0x012C + mapIndexOf(rd(w, 0xC960))) & 0xFFFF, 0xD587);
  } else {
    yield* text((0x14A8 + ((m - 1) & 0xFF)) & 0xFFFF, 0xD587);
    yield* text((0x0021 + rd(w, 0xC836)) & 0xFFFF, 0xD5C7);
    T.pushTextNumberArg(w, rd(w, 0xC837));
    yield* text(0x14A0, 0xD607);
  }
  D.queueVRAMCopy(w, 0xD000, 0xB800, 0x24);
  D.queueAndRunVRAMCopy(w, 0xD400, 0x9800, 0x24);
  copyMapToScrollBuffers(w);                     // 00:0804
  setW(w, old);
}
// 41:7DB3 OpenCharSummaryScreen: ClearFrameTasks, InitWindowSystem 05:407A, InitFontScreen 01:41E8, LCD off; 41:7C7D;
// WY $90, no sprites; WRAM6 $D504 = 0, the character's sprite (42:400B); LCD on; the task 41:7E03 (42:4074) in slot 3;
// a frame; the WRAM bank restored
export function* openCharSummaryScreen(sh) {
  const w = sh.w, old = w.high[0x196];
  clearFrameTasks(w);
  yield* inBankGen(w, 0x05, initWindowSystem(sh));
  initFontScreen(w);
  if (w.vram) D.disableLCDSafely(w);
  yield* drawCharSummary(sh);
  if (w.vram) w.lcd.wy = 0x90;
  D.resetSprites(w);
  setW(w, 6);
  wr(w, 0xD504, 0);
  initCharSprite(w);
  setW(w, 6);
  if (w.vram) D.enableLCD(w);
  registerFrameTask(w, 0x03, 0x41, 0x7E03);
  yield* sh.advance();
  setW(w, old);
}
export const charSummaryTask = w => charSpriteTask(w);   // 41:7E03 CharSummaryTask: 42:4074
