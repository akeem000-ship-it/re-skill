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

// ---- not ported yet ----
export function* statsScreen() { notPorted("the stats screen (~0C:4A15 StatsScreen)"); }
export function* vsResultScreen() { notPorted("the VS results (~0C:65B2 VsResultScreen)"); }
export function* bestScoreScreen() { notPorted("the best scores (~0C:6EE0 BestScoreScreen)"); }
export function* winnersScreen() { notPorted("the winners (~0C:5FC5 WinnersScreen)"); }
export function* rankingScreen() { notPorted("the ranking (~0C:5AEC RankingScreen)"); }
export function* shotRecordsScreen() { notPorted("the shot records (~0C:67F8 ShotRecordsScreen)"); }

// the frame tasks by ROM address
export const records0cTasks = w => ({
  "0c:4821": () => starsAnimTask(w),
  "0c:4852": () => pageArrowsTask(w),
});
