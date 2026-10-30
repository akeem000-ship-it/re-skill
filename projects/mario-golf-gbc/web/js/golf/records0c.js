// Bank 0C: the records screens (reached from the link menu's Status, records.js): the stars (StarsScreen 0C:4014),
// the stats pages (0C:4A15), the ranking (0C:5AEC), the winners (0C:5FC5), the VS results (0C:65B2), the shot
// records (0C:67F8) and the best scores (0C:6EE0). Each draws into WRAM1 (or the 64-wide WRAM2 / WRAM3 maps) and
// copies to the BG map; the records come from the records block at WRAM6 $DC00 through the queries of records.js.
import { rb } from "./rom.js";
import * as D from "./render/display.js";
import * as Scr from "./screen.js";
import { registerFrameTask, unregisterFrameTask, clearFrameTasks } from "./tasks.js";
import { decompressDataFromBank } from "./mapgfx.js";
import { formatDecimalNumber } from "./render/text.js";
import { animateRecordsTiles } from "./nav.js";
import { printHexByte } from "./match.js";
import * as Q from "./records.js";
import { divAHLByDE, divHLByDE, mulHLByA } from "./math.js";
import { mapDrawFullScreen, testCourseHoleBit } from "./scorecard.js";
import { mapScrollTask } from "./render/holeview.js";

const B = 0x0C;
const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
const wbank = w => w.high[0x196];
const R = a => rb(B, a & 0xFFFF);
function notPorted(what) { throw new Error(`${what} is not ported`); }
// 00:2B54 ResumeBGM
function resumeBGM(sh) {
  const w = sh.w;
  if (w.high[0x1CE] & 1) { w.high[0x1CE] &= 0xFE; sh.sound(rd(w, 0xC33E)); }
}
// 00:21F0 FormatDecimalNumber: hl in a field of `width` to de (with its $00), in the mapped WRAM bank
function formatTo(w, hl, width, de) {
  const s = formatDecimalNumber(hl, width);
  for (let k = 0; k < s.length; k++) wr(w, (de + k) & 0xFFFF, s[k]);
}
const mapScroll = w => D.inBank(w, 0x04, () => mapScrollTask(w));   // 04:4072 MapScrollTask (called)
const add8 = (hl, a) => (hl & 0xFF00) + (((hl & 0xFF) + (a & 0xFF))) & 0xFFFF;   // `add l` with the carry into h

// ---- shared ----
// 0C:4958 DecompressPanelPieces: hl, de, b: the three map pieces (0C:499A: refs $4B:02 / 04 / 06) to hl, hl + b,
// hl + 2b and the three attribute pieces (0C:4973: $4B:08 / 0A / 0C) to de, de + b, de + 2b
function decompressPanelPieces(w, hl, de, b) {
  const old = wbank(w);
  for (let k = 0; k < 3; k++) decompressDataFromBank(w, 0x4B02 + 2 * k, (hl + k * b) & 0xFFFF);
  for (let k = 0; k < 3; k++) decompressDataFromBank(w, 0x4B08 + 2 * k, (de + k * b) & 0xFFFF);
  setW(w, old);
}
// 0C:49C1 LoadCourseBanner: a = course: its name banner (0C:4A07: refs $40:24-30) to WRAM3 $D000, 10 tiles queued to
// de, with a frame before and after (and the debug print of a)
function* loadCourseBanner(sh, a, de) {
  const w = sh.w, old = wbank(w);
  printHexByte(w, a, 0x0D02);                    // 00:22A5
  const p = add8(0x4A07, a * 2);
  const hl = R(p) | R(p + 1) << 8;
  yield* sh.advance();
  setW(w, 3);
  decompressDataFromBank(w, hl, 0xD000);
  D.queueVRAMCopy(w, 0xD000, de, 0x0A);
  yield* sh.advance();
  setW(w, old);
}
// 0C:4852 PageArrowsTask: the two page arrows (0C:4947) at y $1C, x $0A - bob and $96 + bob (the second flipped);
// bob = 0C:4950[(frame / 4) & 7]
export function pageArrowsTask(w) {
  const b = R(0x4950 + ((w.wram[0][0x4B2] >> 2) & 7));
  D.queueSpriteTemplate(w, 0x4947, 0x1C, (0x0A - b) & 0xFF, 0xE0, 0x00, R);
  D.queueSpriteTemplate(w, 0x4947, 0x1C, (0x96 + b) & 0xFF, 0xE0, 0x20, R);
}

// ---- the stars (0C:4014) ----
// 0C:41AB DrawStarMark: the star (tile $BF, attribute $0A) on row c of the table (WRAM1 $D129 + 32 c, one further
// right for rows 0-5)
function drawStarMark(w, c) {
  const old = wbank(w);
  setW(w, 1);
  let hl = add8(0xD129, c < 6 ? 1 : 0);
  hl = add8(hl, c << 5);
  wr(w, hl, 0xBF);
  wr(w, (hl + 0x300) & 0xFFFF, 0x0A);
  setW(w, old);
}
// 0C:41E9 DrawStarCountDigits: b (99 at most) in digit tiles $E6 + n on row c ($D129 + 32 c; one further right below 10)
function drawStarCountDigits(w, b, c) {
  const old = wbank(w);
  setW(w, 1);
  if (b >= 0x64) b = 0x63;
  let hl = b < 10 ? 0xD12A : 0xD129;
  hl = add8(hl, c << 5);
  const t = Math.floor(b / 10), e = b - t * 10;
  if (t) wr(w, hl++, t + 0xE6);
  wr(w, hl, e + 0xE6);
  setW(w, old);
}
// 0C:4248 DrawStarsPage: the table's maps (refs $4B:18 attributes -> WRAM1 $D300, $4B:1A tiles -> $D000), the two
// totals' fields blanked, the course's banner (to VRAM1 $8D60), the course's own stars (row 6: the mark and the count
// when any), the total of rows 0-5 and 36 less it (2 digits each, then tile 6), the six marks
function* drawStarsPage(sh) {
  const w = sh.w, old = wbank(w);
  setW(w, 1);
  decompressDataFromBank(w, 0x4B18, 0xD300);
  decompressDataFromBank(w, 0x4B1A, 0xD000);
  for (const a of [0xD16E, 0xD1EE]) { wr(w, a, 0x20); wr(w, a + 0x300, 0); wr(w, a + 1, 0x30); wr(w, a + 0x301, 0); }
  setW(w, 6);
  yield* loadCourseBanner(sh, rd(w, 0xD223), 0xAD60);
  yield* sh.advance();
  setW(w, 6);
  const course = rd(w, 0xD223);
  const [n] = Q.recordsGridBit(w, course, 0);
  if (n) { drawStarMark(w, 6); drawStarCountDigits(w, n, 6); }
  setW(w, 1);
  let t = 0;
  for (let b = 0; b < 6; b++) t = (t + Q.recordsGridBit(w, b, 0)[0]) & 0xFF;
  formatTo(w, t, 2, 0xD16E);
  wr(w, 0xD170, 0x06);
  formatTo(w, (0x24 - t) & 0xFF, 2, 0xD1EE);
  wr(w, 0xD1F0, 0x06);
  for (const a of [0xD46E, 0xD46F, 0xD4EE, 0xD4EF]) wr(w, a, 0);
  setW(w, 6);
  for (let d = 0; d < 6; d++) if (Q.recordsGridBit(w, course, d)[1]) drawStarMark(w, d);
  setW(w, old);
}
// 0C:433A CopyStarsTilemapToVRAM: WRAM1 $D300 -> the attributes, a frame, $D000 -> the BG map
function* copyStarsTilemapToVRAM(sh) {
  const w = sh.w, old = wbank(w);
  setW(w, 1);
  D.queueVRAMCopy(w, 0xD300, 0xB800, 0x24);
  yield* sh.advance();
  D.queueVRAMCopy(w, 0xD000, 0x9800, 0x24);
  setW(w, old);
}
// 0C:40F3 StarsScreenInit: LCD off, no frame tasks; the star icon's frames (ref $4B:1C -> WRAM5 $D000), the cursor
// tiles ($4B:20 -> $8E00), palettes 0C:419B (OBJ 1) and 0C:5C00 (BG), the tiles ($4B:1E -> VRAM1 $9000 / $8800), the
// maps ($4B:18 / $4B:1A) with the panel pieces at $D022 / $D322 (stride $20) -> the BG map; LCD on; WRAM6
function starsScreenInit(w) {
  setW(w, 6);
  w.high[0x18A] = w.high[0x18B] = 0;
  D.disableLCDSafely(w);
  clearFrameTasks(w);
  setW(w, 5);
  decompressDataFromBank(w, 0x4B1C, 0xD000);
  setW(w, 1);
  decompressDataFromBank(w, 0x4B20, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0x8E00, 0x04);
  D.loadPalettesMasterOnly(w, 0x419B, 0x08, 0x01);
  decompressDataFromBank(w, 0x4B1E, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xB000, 0x80);
  D.queueAndRunVRAMCopy(w, 0xD800, 0xA800, 0x80);
  D.loadPalettesMasterOnly(w, 0x5C00, 0x00, 0x08);
  decompressDataFromBank(w, 0x4B18, 0xD300);
  decompressDataFromBank(w, 0x4B1A, 0xD000);
  decompressPanelPieces(w, 0xD022, 0xD322, 0x20);
  D.queueAndRunVRAMCopy(w, 0xD300, 0xB800, 0x24);
  D.queueAndRunVRAMCopy(w, 0xD000, 0x9800, 0x24);
  D.enableLCD(w);
  setW(w, 6);
}
// 0C:47E0 AnimateStarIconTiles: frame (wFrameCounter / 8) & 3 of WRAM5 $D000 (32 bytes): 2 tiles to VRAM1 $8D40,
// 2 from $80 further to $8E40
function animateStarIconTiles(w) {
  const old = wbank(w);
  setW(w, 5);
  const hl = 0xD000 + (((w.wram[0][0x4B2] >> 3) & 3) << 5);
  D.queueVRAMCopy(w, hl, 0xAD40, 0x02);
  D.queueVRAMCopy(w, hl + 0x80, 0xAE40, 0x02);
  setW(w, old);
}
// 0C:4821 StarsAnimTask: the records' animated tiles (0C:436A) to VRAM1 $91C0 / $91E0 and the star icon
export function starsAnimTask(w) {
  const old = wbank(w);
  setW(w, 6);
  wr(w, 0xD23E, 0xC0); wr(w, 0xD23F, 0xB1); wr(w, 0xD240, 0xE0); wr(w, 0xD241, 0xB1);
  setW(w, 1);
  animateRecordsTiles(w);
  animateStarIconTiles(w);
  setW(w, old);
}
// 0C:408B StarsScreenInput: Left / Right the course wStarsCourse $D223 among 0-[$D226] (wrapping), the page drawn
// again (sound $5B after); B (sound $5D) makes the result $FF, else 0. Quirk: its pops are crossed: the result goes
// to hWRAMBank and the WRAM bank it found is returned, so StarsScreen leaves one frame after B (when the previous
// call's $FF comes back), and meanwhile WRAM bank 0 / $FF (1 / 7) is mapped
function* starsScreenInput(sh) {
  const w = sh.w, old = wbank(w);
  setW(w, 6);
  let r = 0;
  const n = rd(w, 0xD226), cur = rd(w, 0xD223), p = w.high[0x191];
  let b = null;
  if (p & 0x20) { b = (cur - 1) & 0xFF; if (b & 0x80) b = n; }
  else if (p & 0x10) { b = (cur + 1) & 0xFF; if (b >= ((n + 1) & 0xFF)) b = 0; }
  else if (p & 0x02) { sh.sound(0x5D); r = 0xFF; }
  if (b !== null && b !== cur) {
    wr(w, 0xD223, b);
    yield* drawStarsPage(sh);
    yield* copyStarsTilemapToVRAM(sh);
    sh.sound(0x5B);
  }
  setW(w, r);
  return old;
}
// 0C:4014 StarsScreen (export $00): the stars of each club (6 a course; the pages: RecordsGridLevel), B leaves
export function* starsScreen(sh) {
  const w = sh.w;
  Q.loadRecordsBlock(w);                         // 0B:4FB7
  resumeBGM(sh);
  Q.recordsSelect(w, 0);
  starsScreenInit(w);
  setW(w, 6);
  wr(w, 0xD223, 0);
  Q.recordsGridLevel(w);                         // 0B:50EB
  yield* drawStarsPage(sh);
  yield* copyStarsTilemapToVRAM(sh);
  setW(w, 6);
  registerFrameTask(w, 0x0F, B, 0x4821);         // StarsAnimTask
  if (rd(w, 0xD226)) registerFrameTask(w, 0x1D, B, 0x4852);   // PageArrowsTask
  yield* sh.advance();
  Scr.beginFadeIn(w, 0x10);
  yield* Scr.waitFade(sh);
  let a;
  do { yield* sh.advance(); a = yield* starsScreenInput(sh); } while (a !== 0xFF);
  unregisterFrameTask(w, B, 0x4821);
  if (rd(w, 0xD226)) unregisterFrameTask(w, B, 0x4852);
  Scr.beginFadeOut(w, 0x10);
  yield* Scr.waitFade(sh);
  return a;
}

// ---- the VS results (0C:65B2) ----
// 0C:5F32 DrawRecordsFaceIcon: c = character, hl = offset: its 2 x 2 face from the sheet in WRAM2 ($D000 + 4c, two
// bytes a row, the second byte plane $100 further) to WRAM1 $D000 + hl (rows 32 apart, the second plane $400 further)
function drawRecordsFaceIcon(w, c, hl) {
  const old = wbank(w);
  const src0 = (0xD000 + ((c << 2) & 0xFF)) & 0xFFFF, dst0 = (0xD000 + hl) & 0xFFFF;
  for (let b = 0; b < 2; b++) {
    let de = (dst0 + b * 32) & 0xFFFF, s = (src0 + b * 2) & 0xFFFF;
    for (let c2 = 0; c2 < 2; c2++, de++, s++) {
      setW(w, 2); const t = rd(w, s);
      setW(w, 1); wr(w, de, t);
      setW(w, 2); const a = rd(w, (s + 0x100) & 0xFFFF);
      setW(w, 1); wr(w, (de + 0x400) & 0xFFFF, a);
    }
  }
  setW(w, old);
}
// 0C:6799 DrawVsResultMark: mark c (0 won $D014, 1 lost $D054, 2 $D094: 2 x 2 in WRAM1, both planes $400 apart) to de
function drawVsResultMark(w, c, de) {
  const old = wbank(w);
  setW(w, 1);
  let hl = c === 0 ? 0xD014 : c === 2 ? 0xD094 : 0xD054;
  for (let b = 0; b < 2; b++, hl += 0x400, de += 0x400)
    for (let r = 0; r < 2; r++) for (let k = 0; k < 2; k++) wr(w, de + r * 32 + k, rd(w, hl + r * 32 + k));
  setW(w, old);
}
// 0C:665A DrawVsResultMarks: the face sheet (refs $4C:1C -> WRAM2 $D000, $4C:1A -> $D100), the character's face
// ($C810) at $142, a mark per rival by its flag pair (the odd flag: 1, else the even one: 0): #81 / #80 at $D144,
// #83 / #82 $D146, #85 / #84 $D148, #87 / #86 $D14A, #89 / #88 $D14E, #91 / #90 $D14C, #93 / #92 $D150 (with neither,
// mark 2 at $D110 unless #117); then (0C:6783 EmptyStub) WRAM1 $D000 / $D400 to the attributes and the BG map
function drawVsResultMarks(w) {
  const old = wbank(w);
  setW(w, 2);
  decompressDataFromBank(w, 0x4C1C, 0xD000);
  decompressDataFromBank(w, 0x4C1A, 0xD100);
  drawRecordsFaceIcon(w, rd(w, 0xC810), 0x0142);
  const flag = n => w.wram[0][0x840 + (n >> 3)] & (0x80 >> (n & 7));
  for (const [n, de] of [[80, 0xD144], [82, 0xD146], [84, 0xD148], [86, 0xD14A], [88, 0xD14E], [90, 0xD14C], [92, 0xD150]]) {
    if (flag(n + 1)) drawVsResultMark(w, 1, de);
    else if (flag(n)) drawVsResultMark(w, 0, de);
    else if (n === 92 && !flag(117)) drawVsResultMark(w, 2, 0xD110);
  }
  setW(w, 1);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xB800, 0x24);
  D.queueAndRunVRAMCopy(w, 0xD400, 0x9800, 0x24);
  setW(w, old);
}
// 0C:65E3 VsResultScreenInit: LCD off, no frame tasks; tiles $4B:1E (VRAM1 $9000 / $8800), palettes 0C:5C00, the maps
// $4C:0C (attributes, WRAM1 $D000) / $4C:0A (tiles, $D400), the marks; LCD on; WRAM6
function vsResultScreenInit(w) {
  setW(w, 6);
  w.high[0x18A] = w.high[0x18B] = 0;
  D.disableLCDSafely(w);
  clearFrameTasks(w);
  setW(w, 1);
  decompressDataFromBank(w, 0x4B1E, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xB000, 0x80);
  D.queueAndRunVRAMCopy(w, 0xD800, 0xA800, 0x80);
  D.loadPalettesMasterOnly(w, 0x5C00, 0x00, 0x08);
  decompressDataFromBank(w, 0x4C0C, 0xD000);
  decompressDataFromBank(w, 0x4C0A, 0xD400);
  drawVsResultMarks(w);
  D.enableLCD(w);
  setW(w, 6);
}
// 0C:65B2 VsResultScreen (export $06): the character against the seven rivals; B (held) leaves (sound $5D;
// 0C:6641 VsResultScreenInput)
export function* vsResultScreen(sh) {
  const w = sh.w;
  vsResultScreenInit(w);
  registerFrameTask(w, 0x0F, B, 0x4821);         // StarsAnimTask
  yield* sh.advance();
  Scr.beginFadeIn(w, 0x10);
  yield* Scr.waitFade(sh);
  for (;;) {
    yield* sh.advance();
    const p = w.high[0x190];                     // hJoyHeld
    if (!(p & 1) && (p & 2)) { sh.sound(0x5D); break; }
  }
  unregisterFrameTask(w, B, 0x4821);
  Scr.beginFadeOut(w, 0x10);
  yield* Scr.waitFade(sh);
  return 0xFF;
}

// ---- the stats pages (0C:4A15): a course's page or the total ($D214 = $D226; its column $14 tiles to the right,
// wRecordsSubPage $D215 = $14), from the records block (wStatsSource $D23B = 0) or the character's profile ($C980,
// 25 bytes a course: $D23B = 1). The pages are drawn into the 64-wide WRAM2 / WRAM3 maps and scroll up and down ----
const sub = w => w.wram[6][0x215];
// 00:0DDB DivAHLByDE with its HRAM: $FFAC = a, $FFAE = the first phase's quotient byte
function divAHL(w, a, hl, de) {
  w.high[0x1AC] = a;
  const [qa, q] = divAHLByDE(a, hl, de);
  if (de) w.high[0x1AE] = qa;
  return q;
}
// 0C:51B1 SplitScoreSign: a = a score (54 is even): [the sign tile ($2B over, $2D under, $60 even), the difference]
function splitScoreSign(a) {
  const d = (a - 0x36) & 0xFF;
  if (!d) return [0x60, 0];
  if (d & 0x80) return [0x2D, (0x36 - a) & 0xFF];
  return [0x2B, d];
}
// 0C:51D2 DrawStatsMedal: medal c (0-2): 2 x 3 tiles (0C:528D + 6c) to WRAM3 at 0C:5287[c] (rows $40 apart), the
// attribute 0C:529F[c] to WRAM2
function drawStatsMedal(w, c) {
  const old = wbank(w);
  let de = R(0x5287 + 2 * c) | R(0x5288 + 2 * c) << 8;
  const b = R(0x529F + c);
  let hl = 0x528D + c * 6;
  for (let r = 0; r < 3; r++, de = (de + 0x40) & 0xFFFF)
    for (let k = 0; k < 2; k++) {
      setW(w, 3); wr(w, de + k, R(hl++));
      setW(w, 2); wr(w, de + k, b);
    }
  setW(w, old);
}
// 0C:5001 SetStatsUnitsAndAttrs: the numbers' attributes cleared (WRAM2) and the end and unit tiles written (WRAM3:
// 6 the field end, $38 Y, $37 %), at the page's column
function setStatsUnitsAndAttrs(w) {
  const old = wbank(w);
  setW(w, 6);
  const e = sub(w);
  setW(w, 2);
  for (const [a, n] of [[0xD110, 3], [0xD18F, 4], [0xD20E, 5], [0xD28D, 5], [0xD30D, 5], [0xD38D, 5], [0xD410, 6], [0xD48D, 5], [0xD50D, 5], [0xD58D, 5]])
    for (let k = 0; k < n; k++) wr(w, a + e + k, 0);
  setW(w, 3);
  for (const a of [0xD193, 0xD213, 0xD413, 0xD113, 0xD413]) wr(w, a + e, 0x06);
  for (const a of [0xD292, 0xD312]) wr(w, a + e, 0x38);
  for (const a of [0xD392, 0xD492, 0xD512, 0xD592]) wr(w, a + e, 0x37);
  setW(w, old);
}
// 0C:50C4 SetBadgeCountAttrs: the badge count's attributes cleared ($D610, WRAM2) and its end tile 6 ($D613, WRAM3)
function setBadgeCountAttrs(w) {
  const old = wbank(w);
  setW(w, 6);
  const e = sub(w);
  setW(w, 2);
  for (let k = 0; k < 3; k++) wr(w, 0xD610 + e + k, 0);
  setW(w, 3);
  wr(w, 0xD613 + e, 0x06);
  setW(w, old);
  return e;
}
// 0C:5100 DrawRecordBadgeHoles: tile $4E (WRAM3) by each hole with its badge (0B:5303): holes 1-9 down from $D706,
// 10-18 from $D70C, rows $40 apart
function drawRecordBadgeHoles(w) {
  const old = wbank(w);
  setW(w, 3);
  for (let c = 0, hl = 0xD706; c < 0x12; c++, hl += 0x40) {
    if (c === 9) hl = 0xD70C;
    if (Q.recordsHoleBit(w, c)[1]) wr(w, hl, 0x4E);
  }
  setW(w, old);
}
// 0C:5153 DrawProfileBadgeHoles: the same from the profile's hole bits of course $D214 (02:5C77)
function drawProfileBadgeHoles(w) {
  const old = wbank(w);
  setW(w, 6);
  const h = (rd(w, 0xD214) + 1) & 0xFF;
  setW(w, 3);
  for (let l = 1, de = 0xD706; l < 0x13; l++, de += 0x40) {
    if (l === 0x0A) de = 0xD70C;
    if (testCourseHoleBit(w, h, l)) wr(w, de, 0x4E);
  }
  setW(w, old);
}
// 0C:5665 LoadStatsPageFrame: the frame (refs $4B:12 -> WRAM2 $D000, $4B:10 -> WRAM3), the page's title banner
// (0C:570B records: the course or 6 the total; 0C:5719 profile: the course or 5) to VRAM1 $8900, its palette ($0B
// records, $0C profile) on 12 tiles at $D044 + the column (WRAM2)
function loadStatsPageFrame(w) {
  const old = wbank(w);
  setW(w, 2);
  decompressDataFromBank(w, 0x4B12, 0xD000);
  setW(w, 3);
  decompressDataFromBank(w, 0x4B10, 0xD000);
  setW(w, 6);
  const prof = rd(w, 0xD23B);
  const idx = sub(w) ? (prof ? 5 : 6) : rd(w, 0xD214);
  const t = add8(prof ? 0x5719 : 0x570B, idx * 2);
  setW(w, 1);
  decompressDataFromBank(w, R(t) | R(t + 1) << 8, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xA900, 0x0C);
  setW(w, 6);
  const b = prof ? 0x0C : 0x0B;
  const hl = add8(0xD044, sub(w));
  setW(w, 2);
  for (let k = 0; k < 0x0C; k++) wr(w, hl + k, b);   // 0C:576D FillBytesHLC
  setW(w, old);
}
// the field writers of both pages: FormatDecimalNumber to de + the column in WRAM3
function field(w, v, width, de) {
  setW(w, 6);
  const p = add8(de, sub(w));
  setW(w, 3);
  formatTo(w, v, width, p);
}
// the putts with one decimal (0C:4ECA / 0C:5468): the tens (as tens x 10, width 1: the second digit then covered by
// the point) at $D410, '.' at $D411, the units at $D412
function puttsField(w, a) {
  let c = 0, x = a;
  while (x >= 10) { c++; x = (x + 0xF6) & 0xFF; }
  c = (c * 10) & 0xFF;
  field(w, c, 1, 0xD410);
  setW(w, 6);
  const p = add8(0xD411, sub(w));
  setW(w, 3);
  wr(w, p, 0x2E);
  field(w, (a - c) & 0xFF, 1, 0xD412);
}
// the best score with its sign tile (0C:4DCC / 0C:5326): the difference (width 4) at $D18F, the sign at $D18F-$D191
// by the number of digits
function scoreField(w, sign, c) {
  field(w, c, 4, 0xD18F);
  const l = c < 10 ? 0x91 : c < 100 ? 0x90 : 0x8F;
  setW(w, 6);
  const p = add8(0xD100 | l, sub(w));
  setW(w, 3);
  wr(w, p, sign);
}
// 0C:4D08 DrawRecordStatsPage: the record of the course (or the total, record 6): the badges (the course's from its
// hole bits; the total: each course's count summed), and with rounds played: the rounds, the best score, the average,
// the best and average drives, the fairway %, the putts, the three save rates, the medals (+$0D bits 2-0; the course
// pages only); then drawn (0B:4306) and scrolled (04:4072)
function drawRecordStatsPage(w) {
  const old = wbank(w);
  loadStatsPageFrame(w);
  setW(w, 6);
  Q.recordsSelect(w, sub(w) ? 6 : rd(w, 0xD214));
  const rec = rd(w, 0xD224) | rd(w, 0xD225) << 8;
  setW(w, 6);
  let b;
  if (!sub(w)) b = Q.recordsHoleBit(w, 0)[0];
  else {
    let a = 0;
    for (let c = 0; c < 6; c++) { Q.recordsSelect(w, c); a = (a + Q.recordsHoleBit(w, c)[0]) & 0xFF; }
    b = a;
  }
  if (b) {
    field(w, b, 3, 0xD610);
    setW(w, 6);
    Q.recordsSelect(w, rd(w, 0xD214));
    if (!setBadgeCountAttrs(w)) drawRecordBadgeHoles(w);
  }
  setW(w, 6);
  const at = k => rd(w, add8(rec, k));
  const word = k => at(k) | rd(w, (add8(rec, k) + 1) & 0xFFFF) << 8;
  const rounds = word(0);
  if (rounds) {
    field(w, rounds, 3, 0xD110);
    setW(w, 6);
    const [sign, c] = splitScoreSign(at(2));
    scoreField(w, sign, c);
    setW(w, 6); field(w, at(3), 5, 0xD20E);
    setW(w, 6); field(w, word(4), 5, 0xD28D);
    setW(w, 6); field(w, word(6), 5, 0xD30D);
    setW(w, 6); field(w, at(8), 5, 0xD38D);
    setW(w, 6); puttsField(w, at(9));
    setW(w, 6); field(w, at(0x0A), 5, 0xD48D);
    setW(w, 6); field(w, at(0x0B), 5, 0xD50D);
    setW(w, 6); field(w, at(0x0C), 5, 0xD58D);
    setStatsUnitsAndAttrs(w);
    setW(w, 6);
    if (!sub(w)) {
      const p = rd(w, 0xD224) | rd(w, 0xD225) << 8;
      const a = rd(w, add8(p, 0x0D));
      if (a & 4) drawStatsMedal(w, 0);
      if (a & 2) drawStatsMedal(w, 1);
      if (a & 1) drawStatsMedal(w, 2);
    }
  }
  D.inBank(w, 0x0B, () => mapDrawFullScreen(w));   // 0B:4306 (a = 1)
  mapScroll(w);
  setW(w, old);
}

// the profile's records (0C:5820-0C:5ACC): a = the course, b = the total page's index; on the total page the
// courses 0 to b - 1 with rounds played are summed
const profRec = a => (0xC980 + 25 * a) & 0xFFFF;          // 0C:5ACC GetProfileCourseRecord
const pw = (w, p) => rd(w, p) | rd(w, (p + 1) & 0xFFFF) << 8;
// 0C:5820 GetProfileRounds
function getProfileRounds(w, a, b) {
  if (a !== b) return pw(w, profRec(a));
  let de = 0;
  for (let k = 0; ; ) { de = (pw(w, profRec(k)) + de) & 0xFFFF; k = (k + 1) & 0xFF; if (k === b) break; }
  return de;
}
// 0C:5843 GetProfileBestScore: [|best - 54|, d: 0 over, 1 under, 2 even]; the total: the least nonzero best of the
// courses played (the first one found, then any lower)
function getProfileBestScore(w, a, b) {
  let e;
  if (a !== b) e = rd(w, add8(profRec(a), 2));
  else {
    e = 0;
    for (let c = 0; ; ) {
      if (getProfileRounds(w, c, b)) { e = rd(w, add8(profRec(c), 2)); if (e) break; }
      c = (c + 1) & 0xFF;
      if (c === b) break;
    }
    for (let c = 0; ; ) {
      if (getProfileRounds(w, c, b)) { const x = rd(w, add8(profRec(c), 2)); if (x < e) e = x; }
      c = (c + 1) & 0xFF;
      if (c === b) break;
    }
  }
  const d = (e - 0x36) & 0xFFFF;
  if (d & 0x8000) return [(0x36 - e) & 0xFFFF, 1];
  if (!d) return [0, 2];
  return [d, 0];
}
// 0C:58CC GetProfileAverage: the word at +[$D23C] / the byte at +[$D23D] (the total: 24-bit sums, the carry byte in
// $D244 of the mapped WRAM bank, by DivAHLByDE)
function getProfileAverage(w, a, b) {
  const num = rd(w, 0xD23C), den = rd(w, 0xD23D);
  if (a !== b) return divHLByDE(pw(w, add8(profRec(a), num)), rd(w, add8(profRec(a), den)));
  let de = 0;
  for (let k = 0; ; ) { if (getProfileRounds(w, k, b)) de = (de + rd(w, add8(profRec(k), den))) & 0xFFFF; k = (k + 1) & 0xFF; if (k === b) break; }
  wr(w, 0xD244, 0);
  let s = 0;
  for (let k = 0; ; ) {
    if (getProfileRounds(w, k, b)) {
      const t = pw(w, add8(profRec(k), num)) + s;
      s = t & 0xFFFF;
      wr(w, 0xD244, rd(w, 0xD244) + (t >> 16));
    }
    k = (k + 1) & 0xFF; if (k === b) break;
  }
  return divAHL(w, rd(w, 0xD244), s, de);
}
// 0C:5955 GetProfileBestDrive: the word +6 (the total: the largest, by a signed difference) / 32
function getProfileBestDrive(w, a, b) {
  if (a !== b) return divHLByDE(pw(w, add8(profRec(a), 6)), 0x20);
  let de = 0;
  for (let k = 0; ; ) {
    if (getProfileRounds(w, k, b)) { const hl = pw(w, add8(profRec(k), 6)); if (!(((hl - de) & 0xFFFF) & 0x8000)) de = hl; }
    k = (k + 1) & 0xFF; if (k === b) break;
  }
  return divHLByDE(de, 0x20);
}
// 0C:59A5 GetProfilePercent: 100 x the byte at +[$D23C] / the byte at +[$D23D] (the total: 16-bit sums, the product
// 24-bit)
function getProfilePercent(w, a, b) {
  const num = rd(w, 0xD23C), den = rd(w, 0xD23D);
  if (a !== b) return divHLByDE(mulHLByA(rd(w, add8(profRec(a), num)), 0x64), rd(w, add8(profRec(a), den)));
  let de = 0, s = 0;
  for (let k = 0; ; ) { if (getProfileRounds(w, k, b)) de = (de + rd(w, add8(profRec(k), den))) & 0xFFFF; k = (k + 1) & 0xFF; if (k === b) break; }
  for (let k = 0; ; ) { if (getProfileRounds(w, k, b)) s = (s + rd(w, add8(profRec(k), num))) & 0xFFFF; k = (k + 1) & 0xFF; if (k === b) break; }
  const p = s * 0x64;                            // 00:0BEC MulHLByAFrac (a:hl = the 24-bit product)
  return divAHL(w, p >> 16, p & 0xFFFF, de);
}
// 0C:5A31 GetProfileAverageX10: 10 x the word at +[$D23C] / the byte at +[$D23D] (the total: the 24-bit sum x 10, the
// high byte 8-bit)
function getProfileAverageX10(w, a, b) {
  const num = rd(w, 0xD23C), den = rd(w, 0xD23D);
  if (a !== b) return divHLByDE(mulHLByA(pw(w, add8(profRec(a), num)), 0x0A), rd(w, add8(profRec(a), den)));
  let de = 0;
  for (let k = 0; ; ) { if (getProfileRounds(w, k, b)) de = (de + rd(w, add8(profRec(k), den))) & 0xFFFF; k = (k + 1) & 0xFF; if (k === b) break; }
  wr(w, 0xD244, 0);
  let s = 0;
  for (let k = 0; ; ) {
    if (getProfileRounds(w, k, b)) {
      const t = pw(w, add8(profRec(k), num)) + s;
      s = t & 0xFFFF;
      wr(w, 0xD244, rd(w, 0xD244) + (t >> 16));
    }
    k = (k + 1) & 0xFF; if (k === b) break;
  }
  let hi = (rd(w, 0xD244) * 10) & 0xFF, hl = s;
  for (let k = 0; k < 9; k++) { const t = hl + s; hl = t & 0xFFFF; hi = (hi + (t >> 16)) & 0xFF; }
  return divAHL(w, hi, hl, de);
}
// 0C:57D0 CountCourseProfileBadges / 0C:579D CountProfileBadges: the profile's hole bits of a course (the total:
// summed over the courses played)
function countCourseProfileBadges(w, a) {
  let e = 0;
  for (let l = 1; l < 0x13; l++) if (testCourseHoleBit(w, (a + 1) & 0xFF, l)) e++;
  return e;
}
function countProfileBadges(w) {
  setW(w, 6);
  const b = rd(w, 0xD226), cur = rd(w, 0xD214);
  if (cur !== b) return countCourseProfileBadges(w, cur);
  let c = 0;
  for (let d = 0; ; ) { if (getProfileRounds(w, d, b)) c = (c + countCourseProfileBadges(w, d)) & 0xFF; d = (d + 1) & 0xFF; if (d === b) break; }
  return c;
}
const clampNeg = hl => (hl & 0x8000 ? 0 : hl);
// 0C:52A2 DrawProfileStatsPage: as the record page from the profile: the badges, and with rounds played the rounds,
// the best score, the average (+$12, the score's base), the best drive, the average drive (+9 / +8), the fairway %
// (+$0C / +$0B), the putts (+$0E / +$0D, x 10), the saves (+$11 / +$10, +$13 / +$12, +$15 / +$14), and on a course's
// page its medals (the hole bits $15-$17)
function drawProfileStatsPage(w) {
  const old = wbank(w);
  loadStatsPageFrame(w);
  setW(w, 6);
  const n = countProfileBadges(w);
  if (n) {
    field(w, n, 3, 0xD610);
    setBadgeCountAttrs(w);
    setW(w, 6);
    if (rd(w, 0xD214) !== rd(w, 0xD226)) drawProfileBadgeHoles(w);
  }
  setW(w, 6);
  const a = rd(w, 0xD214), b = rd(w, 0xD226);
  setW(w, 3);
  const rounds = getProfileRounds(w, a, b);
  if (rounds) {
    field(w, rounds, 3, 0xD110);
    const [v, d] = getProfileBestScore(w, a, b);
    scoreField(w, d === 2 ? 0x60 : d === 1 ? 0x2D : 0x2B, v);
    const stat = (num, den, get, width, de, add = 0) => {
      setW(w, 6);
      if (num !== null) { wr(w, 0xD23C, num); wr(w, 0xD23D, den); }
      let hl = get(w, a, b);
      if (add) hl = add8(hl, add);
      field(w, clampNeg(hl), width, de);
    };
    stat(4, 3, getProfileAverage, 5, 0xD20E, 0x12);
    setW(w, 6);
    field(w, getProfileBestDrive(w, a, b), 5, 0xD28D);
    stat(9, 8, getProfileAverage, 5, 0xD30D);
    stat(0x0C, 0x0B, getProfilePercent, 5, 0xD38D);
    setW(w, 6);
    wr(w, 0xD23C, 0x0E); wr(w, 0xD23D, 0x0D);
    puttsField(w, clampNeg(getProfileAverageX10(w, a, b)) & 0xFF);
    stat(0x11, 0x10, getProfilePercent, 5, 0xD48D);
    stat(0x13, 0x12, getProfilePercent, 5, 0xD50D);
    stat(0x15, 0x14, getProfilePercent, 5, 0xD58D);
    setStatsUnitsAndAttrs(w);
    setW(w, 6);
    if (rd(w, 0xD214) !== rd(w, 0xD226)) {
      const h = (rd(w, 0xD214) + 1) & 0xFF;
      for (let c = 0; c < 3; c++) if (testCourseHoleBit(w, h, 0x15 + c)) drawStatsMedal(w, c);
    }
  }
  D.inBank(w, 0x0B, () => mapDrawFullScreen(w));
  mapScroll(w);
  setW(w, old);
}
const drawStatsPage = w => (rd(w, 0xD23B) ? drawProfileStatsPage(w) : drawRecordStatsPage(w));
// the view of a page: the scroll 0 (the total page's column $14)
function statsView(w) {
  wr(w, 0xC320, 0); wr(w, 0xC322, 0); wr(w, 0xC323, 0);
  w.high[0x1B9] = 0; w.high[0x18A] = 0;
  const x = sub(w) ? 0x14 : 0;
  w.high[0x18B] = x; wr(w, 0xC321, x); w.high[0x1B8] = x;
}
// 0C:4AAB StatsScreenInit: WRAM6; the map's bottom $C32C = $3F, the view; LCD off, no frame tasks; the cursor tiles
// ($4B:20 -> $8E00), palettes 0C:419B (OBJ 1) and 0C:4B68 (BG), the tiles ($4B:0E -> VRAM1 $9000 / $8800), the frame
// maps, the page; drawn; LCD on; WRAM6
function statsScreenInit(w) {
  setW(w, 6);
  wr(w, 0xC32C, 0x3F);
  statsView(w);
  D.disableLCDSafely(w);
  clearFrameTasks(w);
  setW(w, 1);
  decompressDataFromBank(w, 0x4B20, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0x8E00, 0x04);
  D.loadPalettesMasterOnly(w, 0x419B, 0x08, 0x01);
  decompressDataFromBank(w, 0x4B0E, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xB000, 0x80);
  D.queueAndRunVRAMCopy(w, 0xD800, 0xA800, 0x80);
  D.loadPalettesMasterOnly(w, 0x4B68, 0x00, 0x08);
  setW(w, 2);
  decompressDataFromBank(w, 0x4B12, 0xD000);
  setW(w, 3);
  decompressDataFromBank(w, 0x4B10, 0xD000);
  setW(w, 6);
  drawStatsPage(w);
  D.inBank(w, 0x0B, () => mapDrawFullScreen(w));
  mapScroll(w);
  D.enableLCD(w);
  setW(w, 6);
}
// 0C:4C89 StatsChangePage: a frame, fade out ($18), LCD off; the total page's column when $D214 = $D226; the view;
// the page; drawn row by row through the scroll (04:4072 with $C323 = $0A, then 0); LCD on, a frame, fade in
function* statsChangePage(sh) {
  const w = sh.w, old = wbank(w);
  yield* sh.advance();
  Scr.beginFadeOut(w, 0x18);
  yield* Scr.waitFade(sh);
  D.disableLCDSafely(w);
  setW(w, 6);
  w.wram[6][0x215] = rd(w, 0xD214) === rd(w, 0xD226) ? 0x14 : 0;
  statsView(w);
  drawStatsPage(w);
  wr(w, 0xC323, 0x0A);
  mapScroll(w);
  wr(w, 0xC323, 0);
  mapScroll(w);
  D.enableLCD(w);
  yield* sh.advance();
  Scr.beginFadeIn(w, 0x18);
  yield* Scr.waitFade(sh);
  setW(w, old);
}
// 0C:4BA8 StatsScreenInput: Left / Right the page $D214 among 0-[$D226] (wrapping; sound $5B, 0C:4C89); Up / Down
// (held) scroll by half a tile ($80) within the map ([$C32C] less $2A, or $35 on the total page); B (held) $FF (sound
// $5D); the scroll (04:4072)
function* statsScreenInput(sh) {
  const w = sh.w;
  setW(w, 6);
  let r = 0;
  const n = rd(w, 0xD226), cur = rd(w, 0xD214), rep = w.high[0x191];
  let b = null;
  if (rep & 0x20) { b = (cur - 1) & 0xFF; if (b & 0x80) b = n; }
  else if (rep & 0x10) { b = (cur + 1) & 0xFF; if (b >= ((n + 1) & 0xFF)) b = 0; }
  else {
    const held = w.high[0x190];
    const y = rd(w, 0xC322) | rd(w, 0xC323) << 8;
    if (held & 0x40) {
      const hl = (y + 0xFF80) & 0xFFFF;
      if (!(hl & 0x8000)) { wr(w, 0xC322, hl & 0xFF); wr(w, 0xC323, hl >> 8); }
    } else if (held & 0x80) {
      const hl = (y + 0x80) & 0xFFFF;
      setW(w, 6);
      const e = (rd(w, 0xC32C) - (sub(w) ? 0x35 : 0x2A)) & 0xFF;
      if ((hl >> 8) < e) { wr(w, 0xC322, hl & 0xFF); wr(w, 0xC323, hl >> 8); }
    } else if (!(held & 1) && (held & 2)) { sh.sound(0x5D); r = 0xFF; }
  }
  if (b !== null && b !== cur) {
    wr(w, 0xD214, b);
    sh.sound(0x5B);
    yield* statsChangePage(sh);
  }
  mapScroll(w);
  return r;
}
// 0C:4C63 StatsAnimTask: the records' animated tiles (0C:436A) to VRAM1 $9620 / $9640
export function statsAnimTask(w) {
  setW(w, 6);
  wr(w, 0xD23E, 0x20); wr(w, 0xD23F, 0xB6); wr(w, 0xD240, 0x40); wr(w, 0xD241, 0xB6);
  setW(w, 1);
  animateRecordsTiles(w);
}
// 0C:48D6 PageArrowsScrolledTask: the page arrows at the map's x ($C321 x 256, + $140 less the bob x 32 / + $12C0
// plus it), y $280 (PositionSpriteWorld)
export function pageArrowsScrolledTask(w) {
  const b = (R(0x4950 + ((w.wram[0][0x4B2] >> 2) & 7)) << 5) & 0xFF;
  const x = rd(w, 0xC321) << 8;
  D.positionSpriteWorld(w, (x + 0x140 - b) & 0xFFFF, 0x0280, 0xE0, 0x00);
  D.positionSpriteWorld(w, (x + 0x12C0 + b) & 0xFFFF, 0x0280, 0xE0, 0x20);
}
// 0C:4A15 StatsScreen (export $0C): wStatsSource $D23B 0: the records (LoadRecordsBlock; the pages up to the first
// course record bit 0B:506E), 1: the profile (the pages up to the clubs won, 0B:50B6); it opens on the total page;
// Left / Right pages, Up / Down scroll, B leaves
export function* statsScreen(sh) {
  const w = sh.w;
  setW(w, 6);
  wr(w, 0xD214, 0); wr(w, 0xD215, 0);
  setW(w, 6);
  if (!rd(w, 0xD23B)) {
    Q.loadRecordsBlock(w);
    resumeBGM(sh);
    Q.recordsFirstBit(w);
    wr(w, 0xD215, 0x14);
    const a = rd(w, 0xD226);
    wr(w, 0xD214, a);
    Q.recordsSelect(w, a);
  } else {
    Q.countFlags112To114(w);
    wr(w, 0xD215, 0x14);
    wr(w, 0xD214, rd(w, 0xD226));
  }
  statsScreenInit(w);
  registerFrameTask(w, 0x0F, B, 0x4C63);         // StatsAnimTask
  if (rd(w, 0xD226)) registerFrameTask(w, 0x1D, B, 0x48D6);   // PageArrowsScrolledTask
  yield* sh.advance();
  Scr.beginFadeIn(w, 0x10);
  yield* Scr.waitFade(sh);
  let a;
  do { yield* sh.advance(); a = yield* statsScreenInput(sh); } while (a !== 0xFF);
  unregisterFrameTask(w, B, 0x4C63);
  if (rd(w, 0xD226)) unregisterFrameTask(w, B, 0x48D6);
  Scr.beginFadeOut(w, 0x10);
  yield* Scr.waitFade(sh);
  return a;
}

// ---- not ported yet ----
export function* bestScoreScreen() { notPorted("the best scores (~0C:6EE0 BestScoreScreen)"); }
export function* winnersScreen() { notPorted("the winners (~0C:5FC5 WinnersScreen)"); }
export function* rankingScreen() { notPorted("the ranking (~0C:5AEC RankingScreen)"); }
export function* shotRecordsScreen() { notPorted("the shot records (~0C:67F8 ShotRecordsScreen)"); }

// the frame tasks by ROM address
export const records0cTasks = w => ({
  "0c:4821": () => starsAnimTask(w),
  "0c:4852": () => pageArrowsTask(w),
  "0c:4c63": () => statsAnimTask(w),
  "0c:48d6": () => pageArrowsScrolledTask(w),
});
