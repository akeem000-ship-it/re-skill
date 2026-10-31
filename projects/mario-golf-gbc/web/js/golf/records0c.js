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
import * as T from "./text.js";
import { divAHLByDE, divHLByDE, mulHLByA } from "./math.js";
import { mapDrawFullScreen, testCourseHoleBit } from "./scorecard.js";
import { mapScrollTask } from "./render/holeview.js";

const B = 0x0C;
const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
const wbank = w => w.high[0x196];
const R = a => rb(B, a & 0xFFFF);
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}
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
// 00:0DDB DivAHLByDE with its HRAM: $FFAC = a, $FFAE / $FFAD = the first / second phase's quotient bytes
function divAHL(w, a, hl, de) {
  w.high[0x1AC] = a;
  const [qa, q] = divAHLByDE(a, hl, de);
  if (de) { w.high[0x1AE] = qa; w.high[0x1AD] = q >> 8; }
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

// ---- the shot records (0C:67F8): Birdie / Eagle / Albatross / Hole-in-One (the saved holes, save blocks 4-7, five
// slots of $80 bytes each: +$10 the character, +$20 a word, 0 when empty) as a 5 x 4 grid of faces; A picks one ($FE:
// the caller replays it, ~10:435E), B leaves ----
// 0C:6DA3 SplitShotCursor: [$D214 / 5 (the category), $D214 mod 5 (the slot)]
function splitShotCursor(w) {
  let b = 0, c = w.wram[6][0x214];
  for (let a = c; !((a = (a - 5) & 0xFF) & 0x80); b++) c = a;
  return [b, c];
}
// 0C:6DC8 DrawShotInfoLine: b = the category, c = the slot: the info rows cleared (WRAM1 maps $4C:10 / $4C:0E again),
// the category's name ($1424 + b - 1), the slot's number (2 wide at $D610) and $1423 printed (05:62AA), the glyphs
// uploaded, the rows queued to $99E0
function* drawShotInfoLine(sh, b, c) {
  const w = sh.w;
  setW(w, 1);
  decompressDataFromBank(w, 0x4C10, 0xD000);
  decompressDataFromBank(w, 0x4C0E, 0xD400);
  const fill = (hl, n, a) => { for (let k = 0; k < n; k++) wr(w, hl + k, a); };   // 0C:6E7B FillBytes3
  fill(0xD1E1, 0x0A, 0); fill(0xD1EC, 7, 0); fill(0xD201, 0x0B, 0); fill(0xD20C, 7, 0);
  fill(0xD5E1, 0x0A, 3); fill(0xD5EC, 7, 3);
  fill(0xD601, 0x0B, 0x20); fill(0xD60C, 7, 0x20);
  D.inBank(w, 0x03, () => T.resetGlyphBuffer(w));   // 03:4EB8
  yield* inBankGen(w, 0x05, T.printTextToBuffer(sh, add8(0x1424, b - 1), 0xD602, 0x20));
  formatTo(w, c, 2, 0xD610);
  wr(w, 0xD612, 0x20);
  yield* inBankGen(w, 0x05, T.printTextToBuffer(sh, 0x1423, 0xD60D, 0x20));
  yield* inBankGen(w, 0x03, T.uploadGlyphTiles(sh));   // 03:4F6C
  D.queueVRAMCopy(w, 0xD1E0, 0xB9E0, 0x06);
  D.queueVRAMCopy(w, 0xD5E0, 0x99E0, 0x06);
}
// 0C:6D76 DrawSelectedShotInfo: with a slot in use ($D215): the category's block (0B:5260) and the slot's word
// (0B:52D2) -> DrawShotInfoLine
function* drawSelectedShotInfo(sh) {
  const w = sh.w, old = wbank(w);
  setW(w, 6);
  if (rd(w, 0xD215)) {
    const [b, c] = splitShotCursor(w);
    Q.loadSaveBlockByte0B(w, b);
    resumeBGM(sh);
    const [b2, c2] = Q.recordsSlotWord(w, c);
    yield* drawShotInfoLine(sh, b2, c2);
  }
  setW(w, old);
}
// 0C:6C29 LoadShotRecordList: the 20 slots wRecordsList $D227: a category whose block does not load (0B:5260) all
// $FF (0C:6C91), else (0C:6C54) $FF for an empty slot (0B:52D2) or its character (0B:5296)
function loadShotRecordList(sh) {
  const w = sh.w, old = wbank(w);
  for (let c = 0; c < 4; c++) {
    const a = Q.loadSaveBlockByte0B(w, c);
    resumeBGM(sh);
    const o = wbank(w);
    setW(w, 6);
    for (let k = 0; k < 5; k++)
      wr(w, 0xD227 + 5 * c + k, a === 0xFF ? 0xFF : !Q.recordsSlotWord(w, k)[0] ? 0xFF : Q.recordsSlotId(w, k));
    setW(w, o);
  }
  setW(w, old);
}
// 0C:5EF6 CopyPanelTilemapToVRAM: WRAM1 $D000 / $D400 (attributes / tiles) to the BG map in two halves, a frame
// before each and after
function* copyPanelTilemapToVRAM(sh) {
  const w = sh.w;
  setW(w, 1);
  yield* sh.advance();
  D.queueVRAMCopy(w, 0xD000, 0xB800, 0x12);
  D.queueVRAMCopy(w, 0xD400, 0x9800, 0x12);
  yield* sh.advance();
  D.queueVRAMCopy(w, 0xD120, 0xB920, 0x12);
  D.queueVRAMCopy(w, 0xD520, 0x9920, 0x12);
  yield* sh.advance();
}
// 0C:6CBC DrawShotRecordFaces: the maps ($4C:10 / $4C:0E to WRAM1), the face of each used slot (0C:5F32) at $44 +
// 3 x slot + $60 x category, then copied
function* drawShotRecordFaces(sh) {
  const w = sh.w, old = wbank(w);
  setW(w, 1);
  decompressDataFromBank(w, 0x4C10, 0xD000);
  decompressDataFromBank(w, 0x4C0E, 0xD400);
  setW(w, 6);
  for (let c = 0; c < 4; c++) {
    let de = 0x44;
    for (let k = 0; k < 5; k++, de += 3) {
      const a = rd(w, 0xD227 + 5 * c + k);
      if (a !== 0xFF) drawRecordsFaceIcon(w, a, (((c * 3) & 0xFF) * 32 + de) & 0xFFFF);
    }
  }
  yield* copyPanelTilemapToVRAM(sh);
  setW(w, old);
}
// 0C:6D2D InitShotCursor: the last pick wLastShotRecord $CA7F if used, else the first used slot (20: none);
// $D215 = 1 with a slot in use
function initShotCursor(w) {
  const old = wbank(w);
  setW(w, 6);
  let c = rd(w, 0xCA7F);
  if (rd(w, add8(0xD227, c)) === 0xFF) {
    for (c = 0; c < 0x14; c++) if (rd(w, 0xD227 + c) !== 0xFF) break;
  }
  wr(w, 0xD214, c);
  wr(w, 0xD215, c < 0x14 ? 1 : 0);
  setW(w, old);
}
// 0C:6A48 MoveShotCursor: e = Up / Left / Down / Right: the cursor to the next used slot that way in the 5 x 4 grid
// (wrapping; sound $5B); quirk: the tries' count is always 5 (its compare's jumps are unconditional), and Up's is
// reset to 2 each try (it goes on until a used slot); the last slot tried is taken even when empty; kept in $CA7F
function* moveShotCursor(sh, e) {
  const w = sh.w;
  sh.sound(0x5B);
  let c = 5, d = rd(w, 0xD214), a;
  for (let guard = 0; ; guard++) {
    if (guard > 0x10000) throw new Error("MoveShotCursor does not end (the game hangs)");
    if (e === 1) { a = (d - 1) & 0xFF; if (a === 0xFF || a === 4 || a === 9 || a === 0x0E) a = (d + 4) & 0xFF; }
    else if (e === 2) { a = (d + 5) & 0xFF; if (a >= 0x14) a = (d + 0xF1) & 0xFF; }
    else if (e === 3) { a = (d + 1) & 0xFF; if (a === 5 || a === 0x0A || a === 0x0F || a === 0x14) a = (d + 0xFC) & 0xFF; }
    else { c = 2; a = (d + 0xFB) & 0xFF; if (a & 0x80) a = (d + 0x0F) & 0xFF; }
    d = a;
    if (rd(w, add8(0xD227, a)) !== 0xFF) break;
    c = (c - 1) & 0xFF;
    if (!c) break;
  }
  wr(w, 0xD214, d);
  wr(w, 0xCA7F, d);
  yield* drawSelectedShotInfo(sh);
}
// 0C:69D5 ShotRecordsInput: with a slot in use, Up / Left / Down / Right move the cursor (the first of them); then A
// $FE (sound $5C), B $FF ($5D), else 0
function* shotRecordsInput(sh) {
  const w = sh.w, old = wbank(w);
  setW(w, 6);
  let a = 0;
  if (rd(w, 0xD215)) {
    const r = w.high[0x191];
    const e = r & 0x40 ? 0 : r & 0x20 ? 1 : r & 0x80 ? 2 : r & 0x10 ? 3 : -1;
    if (e >= 0) yield* moveShotCursor(sh, e);
    if (w.high[0x191] & 1) { sh.sound(0x5C); a = 0xFE; }
    else if (w.high[0x191] & 2) { sh.sound(0x5D); a = 0xFF; }
  } else if (w.high[0x191] & 2) { sh.sound(0x5D); a = 0xFF; }
  setW(w, old);
  return a;
}
// 0C:687C ShotRecordsScreenInit: $D214 0, the slot list cleared; LCD off, no frame tasks; the cursor's tiles ($4C:12
// / $4C:14 -> VRAM1 $8200 / $8280) and palette 0C:6987 (OBJ 2; its three colours also to $D218 for the cycle), the
// tiles (ref $40:08 -> VRAM1 $9000 / $8800), palettes 0C:5C00, the maps ($4C:10 / $4C:0E), the face sheet
// ($4C:1C / $4C:1A -> WRAM2); LCD on; WRAM6
function shotRecordsScreenInit(w) {
  setW(w, 6);
  wr(w, 0xD214, 0);
  for (let k = 0; k < 0x14; k++) wr(w, 0xD227 + k, 0);
  w.high[0x18A] = w.high[0x18B] = 0;
  D.disableLCDSafely(w);
  clearFrameTasks(w);
  setW(w, 1);
  decompressDataFromBank(w, 0x4C12, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xA200, 0x08);
  decompressDataFromBank(w, 0x4C14, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xA280, 0x08);
  D.loadPalettesMasterOnly(w, 0x6987, 0x0A, 0x01);
  setW(w, 6);
  for (let k = 0; k < 8; k++) wr(w, 0xD218 + k, 0);
  for (let k = 0; k < 6; k++) wr(w, 0xD218 + k, R(0x6987 + k));
  setW(w, 1);
  decompressDataFromBank(w, 0x4008, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xB000, 0x80);
  D.queueAndRunVRAMCopy(w, 0xD800, 0xA800, 0x80);
  D.loadPalettesMasterOnly(w, 0x5C00, 0x00, 0x08);
  decompressDataFromBank(w, 0x4C10, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xB800, 0x24);
  decompressDataFromBank(w, 0x4C0E, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0x9800, 0x24);
  setW(w, 2);
  decompressDataFromBank(w, 0x4C1C, 0xD000);
  decompressDataFromBank(w, 0x4C1A, 0xD100);
  D.enableLCD(w);
  setW(w, 6);
}
// 0C:698F ShotCursorTask: the cursor (0C:69B4, tiles $20, attribute $0A) at the slot's place (0C:6AE5
// GetShotCursorPos: 0C:6B05, x and y words)
export function shotCursorTask(w) {
  const old = wbank(w);
  setW(w, 6);
  const p = add8(0x6B05, (rd(w, 0xD214) << 2) & 0xFF);
  D.queueSpriteTemplate(w, 0x69B4, R(p + 2), R(p), 0x20, 0x0A, R);
  setW(w, old);
}
// 0C:6B55 CycleCursorPaletteTask: the three colour phases $D220-$D222 step through 0C:6BF6 (32 levels; red, green
// at +1, blue at +2): the cursor palette's second colour ($D21A) made of them and loaded (OBJ 2, 00:056C)
export function cycleCursorPaletteTask(w) {
  const old = wbank(w);
  setW(w, 6);
  const step = (a, o) => { const x = (rd(w, a) + 1) & 0x1F; wr(w, a, x); return R(add8(0x6BF6, x) + o) & 0x1F; };
  const r = step(0xD220, 0), g = step(0xD221, 1), b = step(0xD222, 2);
  wr(w, 0xD21A, (r + ((g << 5) & 0xFF)) & 0xFF);
  wr(w, 0xD21B, ((b << 2) + ((g >> 3) & 3)) & 0xFF);
  D.loadPalettesImmediate(w, 0xD218, 0x0A, 0x01);
  setW(w, old);
}
// 0C:67F8 ShotRecordsScreen (export $08): returns $FF (B) or $FE (A, with [category, slot] for the replay)
export function* shotRecordsScreen(sh) {
  const w = sh.w;
  setW(w, 6);
  shotRecordsScreenInit(w);
  loadShotRecordList(sh);
  yield* drawShotRecordFaces(sh);
  initShotCursor(w);
  yield* drawSelectedShotInfo(sh);
  registerFrameTask(w, 0x0F, B, 0x4821);         // StarsAnimTask
  yield* sh.advance();
  Scr.beginFadeIn(w, 0x10);
  yield* Scr.waitFade(sh);
  setW(w, 6);
  if (rd(w, 0xD215)) {
    registerFrameTask(w, 0x1D, B, 0x698F);       // ShotCursorTask
    registerFrameTask(w, 0x1C, B, 0x6B55);       // CycleCursorPaletteTask
  }
  let a;
  do { yield* sh.advance(); a = yield* shotRecordsInput(sh); } while (a !== 0xFE && a !== 0xFF);
  setW(w, 6);
  if (rd(w, 0xD215)) { unregisterFrameTask(w, B, 0x698F); unregisterFrameTask(w, B, 0x6B55); }
  unregisterFrameTask(w, B, 0x4821);
  Scr.beginFadeOut(w, 0x10);
  yield* Scr.waitFade(sh);
  return a === 0xFE ? [a, ...splitShotCursor(w)] : [a];
}

// ---- the ranking (0C:5AEC; the records block): per course the three best rounds (0B:522D: 5 bytes each, hours,
// minutes, seconds, the character, the score) with their time, score, face and name ----
// 0C:4894 PageArrowsTaskLow: the page arrows as two 8 x 16 pairs (00:26A4) at y $14
export function pageArrowsTaskLow(w) {
  const b = R(0x4950 + ((w.wram[0][0x4B2] >> 2) & 7));
  D.queueSprite16(w, 0x14, (0x0A - b) & 0xFF, 0xE0, 0x00);
  D.queueSprite16(w, 0x14, (0x96 + b) & 0xFF, 0xE0, 0x20);
}
// 0C:5FB0 IsRankEntryUsed: any of the three bytes at hl nonzero
const isRankEntryUsed = (w, hl) => (rd(w, hl) || rd(w, hl + 1) || rd(w, hl + 2) ? 1 : 0);
// 0C:5DB8 DrawRankingTimeAndScore: row c ($D0E6 + $80 c, WRAM1): the attributes cleared, the time h:m:s (two digits
// each, a 0 before one digit; $3A between, $12 after) and the score's sign ($2B / $2D / $60 even; $2B and 99 from
// 100) and difference (2 wide, $11 after) from the entry hl (WRAM6)
function drawRankingTimeAndScore(w, c, hl) {
  const old = wbank(w);
  setW(w, 1);
  const row = (0xD0E6 + c * 0x80) & 0xFFFF;
  for (let k = 0; k < 8; k++) wr(w, row + k, 0);
  for (let k = 9; k < 12; k++) wr(w, row + k, 0);
  let de = (row + 0x400) & 0xFFFF;
  const two = (v, sep) => {
    setW(w, 6); const b = rd(w, hl++); setW(w, 1);
    let p = de;
    if (b < 10) { formatTo(w, 0, 1, p); p++; formatTo(w, b, 1, p); } else formatTo(w, b, 2, p);
    wr(w, de + 2, sep);
    de += 3;
  };
  two(0, 0x3A); two(0, 0x3A);
  setW(w, 6); const b3 = rd(w, hl); setW(w, 1);
  if (b3 < 10) { formatTo(w, 0, 1, de); formatTo(w, b3, 1, de + 1); } else formatTo(w, b3, 2, de);
  wr(w, de + 2, 0x12);
  setW(w, 6);
  de += 3;
  const s = rd(w, hl + 2), d = (s - 0x36) & 0xFF;
  let b, t;
  if (!d) { b = 0; t = 0x60; } else if (d & 0x80) { b = (0x36 - s) & 0xFF; t = 0x2D; } else { b = d; t = 0x2B; }
  setW(w, 1);
  wr(w, de, t);
  if (b >= 0x64) { b = 0x63; wr(w, de, 0x2B); }
  formatTo(w, b, 2, de + 1);
  wr(w, de + 3, 0x11);
  setW(w, old);
}
// 0C:5CAA DrawCourseRankingPage: the panel ($4B:14 / $4B:16, copied: 0C:5EF6), the course's banner; for ranks 0-2
// in use: the time and score, the face (0B:51E7's index of the character, at $A6 + $80 r), the name's row ($11
// tiles at $D4A8 / $D4C8, attributes 0, tiles $20) and the name ($1410 + face, below $0E; 05:62AA at $D4C9 + $80 r, a
// frame); the glyphs, copied again
function* drawCourseRankingPage(sh) {
  const w = sh.w, old = wbank(w);
  setW(w, 1);
  decompressDataFromBank(w, 0x4B14, 0xD000);
  decompressDataFromBank(w, 0x4B16, 0xD400);
  yield* copyPanelTilemapToVRAM(sh);
  setW(w, 6);
  const course = rd(w, 0xD214);
  yield* loadCourseBanner(sh, course, 0xAD60);
  setW(w, 6);
  D.inBank(w, 0x03, () => T.resetGlyphBuffer(w));
  for (let c = 0; c < 3; c++) {
    const hl = Q.recordsEntryAddr(course, c);
    if (!isRankEntryUsed(w, hl)) continue;
    drawRankingTimeAndScore(w, c, hl);
    const face = Q.recordsFieldIndex(rd(w, hl + 3));
    drawRecordsFaceIcon(w, face, (0xA6 + c * 0x80) & 0xFFFF);
    setW(w, 1);
    const p = (c * 0x80 + 0xD0A9) & 0xFFFF;
    wr(w, p - 1 + 0x400, 0x11);
    wr(w, p - 1 + 0x420, 0x11);
    for (let k = 0; k < 8; k++) { wr(w, p + k, 0); wr(w, p + 0x20 + k, 0); wr(w, p + 0x400 + k, 0x20); wr(w, p + 0x420 + k, 0x20); }
    if (face < 0x0E) {
      yield* inBankGen(w, 0x05, T.printTextToBuffer(sh, add8(0x1410, face), (c * 0x80 + 0xD4C9) & 0xFFFF, 0x20));
      yield* sh.advance();
    }
    setW(w, 6);
  }
  yield* inBankGen(w, 0x03, T.uploadGlyphTiles(sh));
  yield* copyPanelTilemapToVRAM(sh);
  setW(w, old);
}
// 0C:5B5A RankingScreenInit: LCD off, no frame tasks; the cursor tiles ($4B:20), palettes 0C:419B / 0C:5C00, the
// tiles ($4B:1E), the panel maps ($4B:14 / $4B:16) to the BG map, the face sheet ($4C:18 / $4C:16 -> WRAM2); LCD on
function rankingScreenInit(w) {
  setW(w, 6);
  w.high[0x18A] = w.high[0x18B] = 0;
  D.disableLCDSafely(w);
  clearFrameTasks(w);
  setW(w, 1);
  decompressDataFromBank(w, 0x4B20, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0x8E00, 0x04);
  D.loadPalettesMasterOnly(w, 0x419B, 0x08, 0x01);
  decompressDataFromBank(w, 0x4B1E, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xB000, 0x80);
  D.queueAndRunVRAMCopy(w, 0xD800, 0xA800, 0x80);
  D.loadPalettesMasterOnly(w, 0x5C00, 0x00, 0x08);
  decompressDataFromBank(w, 0x4B14, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xB800, 0x24);
  decompressDataFromBank(w, 0x4B16, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0x9800, 0x24);
  setW(w, 2);
  decompressDataFromBank(w, 0x4C18, 0xD000);
  decompressDataFromBank(w, 0x4C16, 0xD100);
  D.enableLCD(w);
  setW(w, 6);
}
// 0C:5C40 RankingScreenInput: Left / Right the course among 0-[$D226] - 1 (wrapping; drawn, then sound $5B); B $FF
function* rankingScreenInput(sh) {
  const w = sh.w, old = wbank(w);
  setW(w, 6);
  let r = 0;
  const n = rd(w, 0xD226), cur = rd(w, 0xD214), p = w.high[0x191];
  let b = null;
  if (p & 0x20) { b = (cur - 1) & 0xFF; if (b & 0x80) b = (n - 1) & 0xFF; }
  else if (p & 0x10) { b = (cur + 1) & 0xFF; if (b >= n) b = 0; }
  else if (!(p & 1) && (p & 2)) { sh.sound(0x5D); r = 0xFF; }
  if (b !== null && b !== cur) {
    wr(w, 0xD214, b);
    yield* drawCourseRankingPage(sh);
    sh.sound(0x5B);
  }
  setW(w, old);
  return r;
}
// 0C:5AEC RankingScreen (export $02): the courses up to the first course record bit (0B:506E), B leaves
export function* rankingScreen(sh) {
  const w = sh.w;
  setW(w, 6);
  rankingScreenInit(w);
  wr(w, 0xD214, 0);
  Q.loadRecordsBlock(w);
  resumeBGM(sh);
  Q.recordsSelect(w, 0);
  Q.recordsFirstBit(w);
  yield* drawCourseRankingPage(sh);
  registerFrameTask(w, 0x0F, B, 0x4821);         // StarsAnimTask
  const arrows = () => { const n = rd(w, 0xD226); return n !== 0 && n !== 1; };
  if (arrows()) registerFrameTask(w, 0x1D, B, 0x4894);   // PageArrowsTaskLow
  yield* sh.advance();
  Scr.beginFadeIn(w, 0x10);
  yield* Scr.waitFade(sh);
  let a;
  do { yield* sh.advance(); a = yield* rankingScreenInput(sh); } while (a !== 0xFF);
  unregisterFrameTask(w, B, 0x4821);
  if (arrows()) unregisterFrameTask(w, B, 0x4894);
  Scr.beginFadeOut(w, 0x10);
  yield* Scr.waitFade(sh);
  return a;
}

// ---- the winners (0C:5FC5; the records block): who beat whom, 18 rows x 14 columns (0B:5133), a 7 x 6 view of the
// grid (WRAM2 maps, scrolled by $D214 / $D215) with the characters' headers ----
// 0C:6217 Copy2x2Tiles: hl -> de, two rows 32 apart (in the mapped WRAM bank)
function copy2x2(w, hl, de) {
  for (const o of [0, 1, 0x20, 0x21]) wr(w, (de + o) & 0xFFFF, rd(w, (hl + o) & 0xFFFF));
}
// 0C:61B2 DrawWinnersMarks: each grid cell's result (1, or 2 beaten) as its mark ($D51E / $D55E, 0C:61F5
// DrawWinnersMark: WRAM2 left mapped) at $D502 + $40 row + 2 col
function drawWinnersMarks(w) {
  const old = wbank(w);
  for (let b = 0; b < 0x12; b++)
    for (let c = 0; c < 0x0E; c++) {
      const r = Q.recordsTestBits(w, b, c)[2];
      if (r) { setW(w, 2); copy2x2(w, r === 2 ? 0xD55E : 0xD51E, (0xD502 + b * 0x40 + c * 2) & 0xFFFF); }
    }
  setW(w, old);
}
// 0C:62F3 HideWinnersHeader: c's column header ($D500 + $40 c, and $4C0 lower: $D01E's blank) and, below $0E, its row
// header ($D4C2 + 2c) covered with the blank 2 x 2 ($D4DE, $D01E); WRAM2 left mapped
function hideWinnersHeader(w, c) {
  setW(w, 2);
  let de = (0xD500 + c * 0x40) & 0xFFFF;
  copy2x2(w, 0xD4DE, de);
  copy2x2(w, 0xD01E, (de - 0x4C0) & 0xFFFF);
  if (c < 0x0E) {
    de = (0xD4C2 + c * 2) & 0xFFFF;
    copy2x2(w, 0xD4DE, de);
    copy2x2(w, 0xD01E, (de - 0x4C0) & 0xFFFF);
  }
}
// 0C:6240 HideLockedWinners: the headers of characters not met yet: columns 4-9 and $0C with no result in any row,
// $0A under 50 badges (0B:5303 over the six course records), $0D under 108, $0B under 30 stars (0B:5009), rows
// $0E-$11 with no result
function hideLockedWinners(w) {
  const old = wbank(w);
  setW(w, 6);
  const none = (rows, col) => { for (const b of rows) if (Q.recordsTestBits(w, b, col)[2]) return false; return true; };
  const all = [...Array(0x12).keys()];
  for (let c = 4; c < 0x0A; c++) if (none(all, c)) hideWinnersHeader(w, c);
  if (none(all, 0x0C)) hideWinnersHeader(w, 0x0C);
  let b = 0;
  for (let c = 0; c < 6; c++) { Q.recordsSelect(w, c); b = (b + Q.recordsHoleBit(w, c)[0]) & 0xFF; }
  if (b < 0x32) hideWinnersHeader(w, 0x0A);
  if (b < 0x6C) hideWinnersHeader(w, 0x0D);
  let h = 0;
  for (let l = 0; l < 6; l++) h = (h + Q.recordsGridBit(w, l, 0)[0]) & 0xFF;
  if (h < 0x1E) hideWinnersHeader(w, 0x0B);
  for (let r = 0x0E; r < 0x12; r++) {
    let any = false;
    for (let c = 0; c < 0x0E; c++) if (Q.recordsTestBits(w, r, c)[2]) { any = true; break; }
    if (!any) hideWinnersHeader(w, r);
  }
  setW(w, old);
}
// WRAM2 -> WRAM1 copies of the view: 0C:6352 CopyWinnersColumnHeaders (2 rows x 14 from hl + 2 $D214 + 2),
// 0C:63A9 CopyWinnersRowHeaders (c rows x 2 from hl + $40 $D215), 0C:6410 CopyWinnersGridCells (12 x 14 from hl +
// $40 ($D215 + 1) + 2 $D214 + 2)
function winnersCopy(w, hl, de, rows, cols) {
  for (let r = 0; r < rows; r++)
    for (let k = 0; k < cols; k++) {
      setW(w, 2); const a = rd(w, (hl + r * 0x20 + k) & 0xFFFF);
      setW(w, 1); wr(w, (de + r * 0x20 + k) & 0xFFFF, a);
    }
}
function copyWinnersColumnHeaders(w, hl, de) {
  const old = wbank(w);
  setW(w, 6);
  winnersCopy(w, add8(hl, rd(w, 0xD214) * 2 + 2), de, 2, 0x0E);
  setW(w, old);
}
function copyWinnersRowHeaders(w, hl, de, c) {
  const old = wbank(w);
  setW(w, 6);
  winnersCopy(w, (hl + rd(w, 0xD215) * 0x40) & 0xFFFF, de, c || 256, 2);
  setW(w, old);
}
function copyWinnersGridCells(w, hl, de) {
  const old = wbank(w);
  setW(w, 6);
  const a = (rd(w, 0xD214) * 2 + 2) & 0xFF;
  const off = add8((rd(w, 0xD215) * 0x40 + 0x40) & 0xFFFF, a);
  winnersCopy(w, (hl + off) & 0xFFFF, de, 0x0C, 0x0E);
  setW(w, old);
}
// 0C:6563 CopyWinnersTilemapToVRAM: WRAM1 $D000 / $D400 / $D120 / $D520 to the BG map, a frame after each
function* copyWinnersTilemapToVRAM(sh) {
  const w = sh.w, old = wbank(w);
  setW(w, 1);
  for (const [hl, de] of [[0xD000, 0xB800], [0xD400, 0x9800], [0xD120, 0xB920], [0xD520, 0x9920]]) {
    D.queueVRAMCopy(w, hl, de, 0x12);
    yield* sh.advance();
  }
  setW(w, old);
}
// 0C:6481 RedrawWinnersView: the headers and cells of both planes (tiles from WRAM2 $D4C0 / $D500, attributes from
// $D000 / $D040) into WRAM1, then copied
function* redrawWinnersView(sh) {
  const w = sh.w, old = wbank(w);
  copyWinnersColumnHeaders(w, 0xD4C0, 0xD464);
  copyWinnersRowHeaders(w, 0xD500, 0xD4A2, 0x0C);
  copyWinnersGridCells(w, 0xD4C0, 0xD4A4);
  copyWinnersColumnHeaders(w, 0xD000, 0xD064);
  copyWinnersRowHeaders(w, 0xD040, 0xD0A2, 0x0C);
  copyWinnersGridCells(w, 0xD000, 0xD0A4);
  yield* copyWinnersTilemapToVRAM(sh);
  setW(w, old);
}
// 0C:61A8 WinnersAnimTask / 0C:6179 AnimateWinnersTiles: frame (wFrameCounter / 8) & 7 of 0C:43E0: 2 tiles to VRAM1
// $91C0, 2 from $100 further to $91E0 (WRAM1 left mapped)
export function winnersAnimTask(w) {
  setW(w, 1);
  const hl = 0x43E0 + (((w.wram[0][0x4B2] >> 3) & 7) << 5);
  D.queueVRAMCopy(w, hl, 0xB1C0, 0x02);
  D.queueVRAMCopy(w, hl + 0x100, 0xB1E0, 0x02);
}
// 0C:64CD WinnersCursorTask: at the bob's ends (0C:4950: 4 / 0) the cursor tiles from WRAM3 $D000 / $D080 to
// $8E00; the scroll arrows that are not at an edge (left / right of 0-7, up / down of 0-$0C)
export function winnersCursorTask(w) {
  const old = wbank(w);
  setW(w, 3);
  const bob = R(0x4950 + ((w.wram[0][0x4B2] >> 2) & 7));
  if (bob === 4) D.queueVRAMCopy(w, 0xD000, 0x8E00, 0x08);
  else if (!bob) D.queueVRAMCopy(w, 0xD080, 0x8E00, 0x08);
  setW(w, 6);
  const tpl = (e, d, c, b) => D.queueSpriteTemplate(w, 0x4947, e, d, c, b, R);
  if (rd(w, 0xD214)) tpl(0x1F, 0x1C, 0xE0, 0x01);
  if (rd(w, 0xD214) !== 7) tpl(0x1F, 0x96, 0xE0, 0x21);
  if (rd(w, 0xD215)) tpl(0x2A, 0x10, 0xE4, 0x01);
  if (rd(w, 0xD215) !== 0x0C) tpl(0x8A, 0x10, 0xE4, 0x41);
  setW(w, old);
}
// 0C:600A WinnersScreenInit: the view 0, LCD off, no frame tasks; the cursor tiles ($4B:22 / $4B:24 and the second
// frame $4D:24 / $4D:26 to WRAM3; to $8E00), palettes 0C:419B (OBJ 2) and 0C:5C00, the tiles ($4B:1E), the frame maps
// ($4C:04 / $4C:02) to the BG map, the grid's maps ($4C:08 / $4C:06 -> WRAM2), the marks, the hidden headers; LCD on,
// two frames, the view drawn; WRAM6
function* winnersScreenInit(sh) {
  const w = sh.w;
  setW(w, 6);
  w.high[0x18A] = w.high[0x18B] = 0;
  wr(w, 0xD214, 0); wr(w, 0xD215, 0);
  D.disableLCDSafely(w);
  clearFrameTasks(w);
  setW(w, 3);
  decompressDataFromBank(w, 0x4B22, 0xD000);
  decompressDataFromBank(w, 0x4B24, 0xD040);
  decompressDataFromBank(w, 0x4D24, 0xD080);
  decompressDataFromBank(w, 0x4D26, 0xD0C0);
  setW(w, 1);
  decompressDataFromBank(w, 0x4B22, 0xD000);
  decompressDataFromBank(w, 0x4B24, 0xD040);
  D.queueAndRunVRAMCopy(w, 0xD000, 0x8E00, 0x08);
  D.loadPalettesMasterOnly(w, 0x419B, 0x08, 0x02);
  decompressDataFromBank(w, 0x4B1E, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xB000, 0x80);
  D.queueAndRunVRAMCopy(w, 0xD800, 0xA800, 0x80);
  D.loadPalettesMasterOnly(w, 0x5C00, 0x00, 0x08);
  decompressDataFromBank(w, 0x4C04, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xB800, 0x24);
  decompressDataFromBank(w, 0x4C02, 0xD400);
  D.queueAndRunVRAMCopy(w, 0xD400, 0x9800, 0x24);
  setW(w, 2);
  decompressDataFromBank(w, 0x4C08, 0xD000);
  decompressDataFromBank(w, 0x4C06, 0xD4C0);
  drawWinnersMarks(w);
  hideLockedWinners(w);
  D.enableLCD(w);
  yield* sh.advance(2);
  yield* redrawWinnersView(sh);
  setW(w, 6);
}
// 0C:60F8 WinnersScreenInput: Up / Down the row scroll $D215 (0-$0C), Left / Right the column scroll $D214 (0-7)
// (sound $5B, the view drawn even at an edge); B $FF (sound $5D). Quirk: its pops are crossed: hWRAMBank gets the
// result slot (0), and without B the WRAM bank it found is returned
function* winnersScreenInput(sh) {
  const w = sh.w, old = wbank(w);
  setW(w, 6);
  const r = w.high[0x191];
  let res = null;
  const move = function* (a, lo, hi) {
    sh.sound(0x5B);
    const v = (rd(w, a) + lo) & 0xFF;
    if (lo < 0 ? !(v & 0x80) : v < hi) wr(w, a, v);
    yield* redrawWinnersView(sh);
  };
  if (r & 0x40) yield* move(0xD215, -1);
  else if (r & 0x80) yield* move(0xD215, 1, 0x0D);
  else if (r & 0x20) yield* move(0xD214, -1);
  else if (r & 0x10) yield* move(0xD214, 1, 0x08);
  else if (!(r & 1) && (r & 2)) { sh.sound(0x5D); res = 0xFF; }
  setW(w, 0);
  return res === null ? old : res;
}
// 0C:5FC5 WinnersScreen (export $04)
export function* winnersScreen(sh) {
  const w = sh.w;
  Q.loadRecordsBlock(w);
  resumeBGM(sh);
  yield* winnersScreenInit(sh);
  registerFrameTask(w, 0x0F, B, 0x61A8);         // WinnersAnimTask
  registerFrameTask(w, 0x1D, B, 0x64CD);         // WinnersCursorTask
  yield* sh.advance();
  Scr.beginFadeIn(w, 0x10);
  yield* Scr.waitFade(sh);
  let a;
  do { yield* sh.advance(); a = yield* winnersScreenInput(sh); } while (a !== 0xFF);
  unregisterFrameTask(w, B, 0x61A8);
  unregisterFrameTask(w, B, 0x64CD);
  Scr.beginFadeOut(w, 0x10);
  yield* Scr.waitFade(sh);
  return a;
}

// ---- the best scores (0C:6EE0; the records block): per course the characters with a best score (0B:51B9 field
// = the character), sorted, with their faces and scores ----
// 0C:70FC SortBestScoreList: wRecordsList $D227 ($FF ends) sorted by score, each place swapped with any lower later
function sortBestScoreList(w) {
  const b = rd(w, 0xD214);
  const score = c => Q.recordsReadField(w, b, c);
  for (let hl = 0xD227; ; hl++) {
    let d = rd(w, hl);
    if (d === 0xFF) break;
    let c = score(d);
    for (let p = hl + 1; ; p++) {
      const e = rd(w, p);
      if (e === 0xFF) break;
      const a = score(e);
      if (a < c) { c = a; wr(w, p, d); d = e; }
    }
    wr(w, hl, d);
  }
}
// 0C:726F BestScoreSlotTable: [column, row] of list place c
const bestScoreSlot = c => (R(0x726F + 2 * c) + R(0x7270 + 2 * c) * 32) & 0xFFFF;
// 0C:7136 DrawBestScoreFaces: each listed character's 2 x 2 face (the sheet in WRAM2: 4 bytes a character at
// $D000, the second plane at $D400) to WRAM1 $D000 + its slot (both planes)
function drawBestScoreFaces(w) {
  const old = wbank(w);
  for (let c = 0, hl = 0xD227; ; c++) {
    setW(w, 6);
    const a = rd(w, hl++);
    if (a === 0xFF) break;
    const src = (0xD000 + a * 4) & 0xFFFF, dst = (0xD000 + bestScoreSlot(c)) & 0xFFFF;
    [[0, 0], [1, 1], [2, 0x20], [3, 0x21]].forEach(([s, d]) => {
      for (const pl of [0, 0x400]) { setW(w, 2); const v = rd(w, src + s + pl); setW(w, 1); wr(w, dst + d + pl, v); }
    });
  }
  setW(w, old);
}
// 0C:7326 DrawNumberTiles: a (1-2 digits, one place further right below 10; 100 or more: three tiles b + $0B from
// hl - 1) in tiles b + digit at hl
function drawNumberTiles(w, a, b, hl) {
  if (a >= 0x64) { for (let k = -1; k < 2; k++) wr(w, hl + k, (b + 0x0B) & 0xFF); return; }
  setW(w, 1);
  if (a < 10) hl++;
  const t = Math.floor(a / 10), u = a - t * 10;
  if (t) wr(w, hl++, (t + b) & 0xFF);
  wr(w, hl, (u + b) & 0xFF);
}
// 0C:7297 DrawBestScoreValues: each listed character's score (nonzero, below $80) at its slot + $423: the sign
// ($3D over, $3E under, $3F even) and the difference (0C:7326, digit tiles from $33)
function drawBestScoreValues(w) {
  const old = wbank(w);
  setW(w, 6);
  const b = rd(w, 0xD214);
  for (let c = 0, hl = 0xD227; ; c++) {
    setW(w, 6);
    const ch = rd(w, hl++);
    if (ch === 0xFF) break;
    const s = Q.recordsReadField(w, b, ch);
    if (!s || s & 0x80) continue;
    let p = (bestScoreSlot(c) + 0xD423) & 0xFFFF;
    setW(w, 1);
    const d = (s - 0x36) & 0xFF;
    let v;
    if (!d) { wr(w, p++, 0x3F); v = 0; } else if (!(d & 0x80)) { wr(w, p++, 0x3D); v = d; } else { wr(w, p++, 0x3E); v = (0x36 - s) & 0xFF; }
    drawNumberTiles(w, v, 0x33, p);
  }
  setW(w, old);
}
// 0C:70C2 BuildBestScoreList: the characters 0-$11 with a score on the course to $D227 ($FF after), sorted, drawn
// (WRAM6 left mapped)
function buildBestScoreList(w) {
  setW(w, 6);
  for (let k = 0; k < 0x14; k++) wr(w, 0xD227 + k, 0xFF);
  const b = rd(w, 0xD214);
  let hl = 0xD227;
  for (let c = 0; c < 0x12; c++) if (Q.recordsReadField(w, b, c)) wr(w, hl++, c);
  sortBestScoreList(w);
  drawBestScoreFaces(w);
  drawBestScoreValues(w);
}
// 0C:7083 DrawBestScorePage: the panel maps ($4D:1C / $4D:1E), the course's banner (to VRAM1 $8860), the list, copied
function* drawBestScorePage(sh) {
  const w = sh.w, old = wbank(w);
  setW(w, 1);
  decompressDataFromBank(w, 0x4D1C, 0xD000);
  decompressDataFromBank(w, 0x4D1E, 0xD400);
  setW(w, 6);
  yield* loadCourseBanner(sh, rd(w, 0xD214), 0xA860);
  buildBestScoreList(w);
  yield* copyPanelTilemapToVRAM(sh);
  setW(w, old);
}
// 0C:705D BestScoreAnimTask: the records' animated tiles (0C:436A) to VRAM1 $9220 / $9240
export function bestScoreAnimTask(w) {
  setW(w, 6);
  wr(w, 0xD23E, 0x20); wr(w, 0xD23F, 0xB2); wr(w, 0xD240, 0x40); wr(w, 0xD241, 0xB2);
  setW(w, 1);
  animateRecordsTiles(w);
}
// 0C:6F4B BestScoreScreenInit: LCD off, no frame tasks; the cursor tiles ($4B:20), palettes 0C:419B / 0C:5C00, the
// tiles ($4D:1A), the panel maps ($4D:1C / $4D:1E) to the BG map, the face sheet ($4D:20 / $4D:22 -> WRAM2); LCD on
function bestScoreScreenInit(w) {
  setW(w, 6);
  w.high[0x18A] = w.high[0x18B] = 0;
  D.disableLCDSafely(w);
  clearFrameTasks(w);
  setW(w, 1);
  decompressDataFromBank(w, 0x4B20, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0x8E00, 0x04);
  D.loadPalettesMasterOnly(w, 0x419B, 0x08, 0x01);
  decompressDataFromBank(w, 0x4D1A, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xB000, 0x80);
  D.queueAndRunVRAMCopy(w, 0xD800, 0xA800, 0x80);
  D.loadPalettesMasterOnly(w, 0x5C00, 0x00, 0x08);
  decompressDataFromBank(w, 0x4D1C, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xB800, 0x24);
  decompressDataFromBank(w, 0x4D1E, 0xD400);
  D.queueAndRunVRAMCopy(w, 0xD400, 0x9800, 0x24);
  setW(w, 2);
  decompressDataFromBank(w, 0x4D20, 0xD000);
  decompressDataFromBank(w, 0x4D22, 0xD400);
  D.enableLCD(w);
  setW(w, 6);
}
// 0C:6FF1 BestScoreScreenInput: Left / Right the course among 0-[$D226] - 1 (wrapping; drawn, then sound $5B); B
// $FF ($5D); otherwise it returns what was in a (the course, or the buttons), never $FF
function* bestScoreScreenInput(sh) {
  const w = sh.w, old = wbank(w);
  setW(w, 6);
  const n = rd(w, 0xD226), cur = rd(w, 0xD214), p = w.high[0x191];
  let a = p, b = null;
  if (p & 0x20) { b = (cur - 1) & 0xFF; if (b & 0x80) b = (n - 1) & 0xFF; a = cur; }
  else if (p & 0x10) { b = (cur + 1) & 0xFF; if (b >= n) b = 0; a = cur; }
  else if (!(p & 1) && (p & 2)) { sh.sound(0x5D); a = 0xFF; }
  if (b !== null && b !== cur) {
    wr(w, 0xD214, b);
    yield* drawBestScorePage(sh);
    sh.sound(0x5B);
    a = b;
  }
  setW(w, old);
  return a;
}
// 0C:6EE0 BestScoreScreen (export $0A)
export function* bestScoreScreen(sh) {
  const w = sh.w;
  bestScoreScreenInit(w);
  wr(w, 0xD214, 0);
  Q.loadRecordsBlock(w);
  resumeBGM(sh);
  Q.recordsSelect(w, 0);
  Q.recordsFirstBit(w);
  yield* drawBestScorePage(sh);
  registerFrameTask(w, 0x0F, B, 0x705D);         // BestScoreAnimTask
  const arrows = () => { const n = rd(w, 0xD226); return n !== 0 && n !== 1; };
  if (arrows()) registerFrameTask(w, 0x1D, B, 0x4894);   // PageArrowsTaskLow
  yield* sh.advance();
  Scr.beginFadeIn(w, 0x10);
  yield* Scr.waitFade(sh);
  let a;
  do { yield* sh.advance(); a = yield* bestScoreScreenInput(sh); } while (a !== 0xFF);
  unregisterFrameTask(w, B, 0x705D);
  if (arrows()) unregisterFrameTask(w, B, 0x4894);
  Scr.beginFadeOut(w, 0x10);
  yield* Scr.waitFade(sh);
  return a;
}

// ---- not ported yet ----

// the frame tasks by ROM address
export const records0cTasks = w => ({
  "0c:4821": () => starsAnimTask(w),
  "0c:4852": () => pageArrowsTask(w),
  "0c:4c63": () => statsAnimTask(w),
  "0c:48d6": () => pageArrowsScrolledTask(w),
  "0c:698f": () => shotCursorTask(w),
  "0c:4894": () => pageArrowsTaskLow(w),
  "0c:705d": () => bestScoreAnimTask(w),
  "0c:61a8": () => winnersAnimTask(w),
  "0c:64cd": () => winnersCursorTask(w),
  "0c:6b55": () => cycleCursorPaletteTask(w),
});

// ---- unreferenced (dead) routines of the bank, checked against the ROM by web/tests/golf_fuzz_routines.mjs ----
// 0C:5725 ClearStatsColumn: 22 rows of 12 tiles from $D101 + the column: attributes 0 (WRAM2), tiles $20 (WRAM3)
export function clearStatsColumn(w) {
  const old = wbank(w);
  setW(w, 6);
  let hl = add8(0xD101, w.wram[6][0x215]);
  for (let b = 0; b < 0x16; b++, hl = (hl + 0x40) & 0xFFFF) {
    setW(w, 2); for (let k = 0; k < 0x0C; k++) wr(w, hl + k, 0);
    setW(w, 3); for (let k = 0; k < 0x0C; k++) wr(w, hl + k, 0x20);
  }
  setW(w, old);
}
// 0C:5772 CopyTextIdToBuffer (export $12, no callers): text hl loaded (05:6179), then with WRAM bank c mapped up to 20
// of its characters (to its $00) copied to de
export function copyTextIdToBuffer(w, hl, c, de) {
  const old = wbank(w);
  T.loadText(w, hl);
  setW(w, c);
  for (let k = 0, p = 0xC600; k < 0x14; k++) { const a = rd(w, p++); if (!a) break; wr(w, de++, a); }
  setW(w, old);
}
// 0C:57E7 TestProfileHoleBit: bit c of the 24 hole bits at the profile's course record b + $16
export function testProfileHoleBit(w, b, c) {
  let hl = add8((0xC980 + 25 * b) & 0xFFFF, 0x16);
  if (c >= 0x10) { hl += 2; c -= 0x10; } else if (c >= 8) { hl++; c -= 8; }
  return (rd(w, hl & 0xFFFF) >> c) & 1;
}
// 0C:6794 FillBytes2: c bytes of a at hl (0: 256); returns hl after them
export function fillBytes2(w, hl, c, a) {
  for (let n = c || 256; n; n--) wr(w, hl++, a);
  return hl & 0xFFFF;
}
// 0C:55B7 RedrawStatsFrame: the frame maps again ($4B:12 / $4B:10) with the panel pieces at $D002 + the column (stride
// $40), and the page's title ($1105 + the course or 6 for the records, $140A + it or 5 for the profile) printed at $D043
// + the column (05:62AA, WRAM3)
export function* redrawStatsFrame(sh) {
  const w = sh.w, old = wbank(w);
  setW(w, 2); decompressDataFromBank(w, 0x4B12, 0xD000);
  setW(w, 3); decompressDataFromBank(w, 0x4B10, 0xD000);
  setW(w, 6);
  const de = add8(0xD002, sub(w));
  setW(w, 2); for (let k = 0; k < 3; k++) decompressDataFromBank(w, 0x4B08 + 2 * k, (de + k * 0x40) & 0xFFFF);
  setW(w, 3); for (let k = 0; k < 3; k++) decompressDataFromBank(w, 0x4B02 + 2 * k, (de + k * 0x40) & 0xFFFF);
  setW(w, 6);
  const prof = rd(w, 0xD23B);
  const b = sub(w) ? (prof ? 5 : 6) : rd(w, 0xD214);
  const id = add8(prof ? 0x140A : 0x1105, b);
  setW(w, 3);
  yield* inBankGen(w, 0x05, T.printTextToBuffer(sh, id, add8(0xD043, sub(w)), 0x40));
  setW(w, old);
}

// 0C:6E80 LoadBannerGfxUnused (unreferenced): LoadCourseBanner's code (the debug print, a frame, the LZ data to WRAM3
// $D000, 10 tiles queued to de) with the table 0C:6EC3 (refs $40:18-22) and no frame after; the bank restored
export function* loadBannerGfxUnused(sh, a, de) {
  const w = sh.w, old = wbank(w);
  printHexByte(w, a, 0x0D02);                    // 00:22A5
  const p = add8(0x6EC3, a * 2);
  const hl = R(p) | R(p + 1) << 8;
  yield* sh.advance();
  setW(w, 3);
  decompressDataFromBank(w, hl, 0xD000);
  D.queueVRAMCopy(w, 0xD000, de, 0x0A);
  setW(w, old);
}
