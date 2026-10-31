// The scorecard between holes (ShowScorecard 0E:43D6, from RoundHookHoleEnd): for a one-player Stroke round the
// hole-by-hole card (ScorecardPageStrokes 0E:6C7A): front and back nine, par, strokes, putts and the score against
// par, drawn into the 64 x 64 map buffers (WRAM2 attributes / WRAM3 tiles) and shown with MapDrawFullScreen; Up /
// Down scroll it (ScorecardScrollTask), A / B / Start leave; match play and the tournament have a second page (the
// match card, the standings: below). The two-player pages are not ported.
// The frame task, the scroll state, the frames and the buttons run headless too; the tiles, maps, palettes and
// sprites only with a display (render/display.js). Tournament: the standings page (0E:5209) and the strokes page
// with the course record's hole marks.
import { rb, rw } from "./rom.js";
import { clearFrameTasks, registerFrameTask } from "./tasks.js";
import { mapScrollTask } from "./render/holeview.js";
import { formatDecimalNumber } from "./render/text.js";
import * as D from "./render/display.js";
import { matchStandingsScreen, twoPlayerScoreScreen } from "./standings.js";
import { loadTextShort, copyTextShortToDE, drawStringToGlyphs } from "./text.js";
import { decompressDataFromBank } from "./mapgfx.js";
import { buildStandings, getPlayerRank } from "./tournament.js";

const B = 0x0E;

// 13:7044 GetHoleParAndYards: l = hole 1-18, h = course: [par, yards] from HoleInfoTable 13:5884 entry l - 1 (course
// 0), else $0A + l - 1 and $12 more for each course past 1 (d = h - 2, then the loop jumps back to its second dec d,
// 13:7051: one step each time round)
export function holeParAndYards(h, l) {
  let a = (l - 1) & 0xFF;
  if (h) {
    a = (a + 0x0A) & 0xFF;
    for (let d = (h - 2) & 0xFF; !(d & 0x80); d = (d - 1) & 0xFF) a = (a + 0x12) & 0xFF;
  }
  const p = (0x5884 + ((0x20 * a) & 0xFFFF)) & 0xFFFF;
  return [rb(0x13, p), rw(0x13, p + 4)];
}

// 0E:43D6 ShowScorecard: the pages by mode (ScorecardPageTable 0E:4422), turning pages while one returns 1
export function* showScorecard(sh) {
  const w0 = sh.w.wram[0];
  const c = w0[0x834] === 1 ? 0 : w0[0x834] === 2 ? 1 : w0[0x8D0] === 0xFF ? 2 : 3;
  const wb = sh.w.high[0x196];
  let b = 0;
  for (;;) {
    const page = rw(B, 0x4422 + (c * 2 + b) * 2);
    const run = PAGES[page];
    if (!run) throw new Error(`the scorecard page ~0E:${page.toString(16)} is not ported`);
    const a = yield* run(sh);
    if (!a) break;
    b ^= 1;
  }
  D.setWramBank(sh.w, wb);
}

const PAGES = {
  0x6C7A: sh => pageStrokes(sh),                 // 0E:6C7A ScorecardPageStrokes
  0x4432: sh => inBankGen(sh.w, 0x3E, matchStandingsScreen(sh)),   // 0E:4432 ScorecardPageMatchStandings -> 3E:403F
  0x762F: sh => pageMatchPlay(sh),               // 0E:762F ScorecardPageMatchPlay
  0x5209: sh => pageStandings(sh),               // 0E:5209 ScorecardPageStandings
  0x4436: sh => inBankGen(sh.w, 0x3E, twoPlayerScoreScreen(sh)),   // 0E:4436 ScorecardPageTwoPlayer -> 3E:6361
  0x7199: sh => pageTwoPlayerStrokes(sh),        // 0E:7199 ScorecardPageTwoPlayerStrokes
};
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}

function* resetView(sh) {                        // 0E:4373 ScorecardResetView
  const w = sh.w, w0 = w.wram[0], h = w.high;
  clearFrameTasks(w);                            // 00:23B6
  yield* sh.advance();
  let b = w0[0x837];
  if (b && !w0[0x4BD]) b = (b - 1) & 0xFF;
  w0[0x4BE] = b;                                 // wHolesDone
  if (b < 0x0A) { w0[0x480] = b; w0[0x481] = 0; } else { w0[0x481] = b - 9; w0[0x480] = 9; }   // front / back nine
  h[0x1B9] = h[0x1B8] = 0;
  if (w.vram) w.lcd.wy = 0x90;
  h[0x18B] = h[0x18A] = 0;                       // hSCX / hSCY
  w0.fill(0, 0x320, 0x324);                      // wMapScrollX / Y
  w0[0x329] = w0[0x32A] = 0;                     // wMapBounds
  w0[0x32B] = w0[0x32C] = 0x3F;
  D.resetSprites(w);                             // 00:2683
  h[0x1BC] = 0;                                  // hScreenFadedOut
}

function* pageStrokes(sh) {                      // 0E:6C7A ScorecardPageStrokes
  const w = sh.w, w0 = w.wram[0];
  yield* resetView(sh);
  strokesSetup(w);
  registerFrameTask(w, 0x01, B, 0x6D47);         // ScorecardStrokesTask
  for (;;) {
    if (w.high[0x194] & 0x0B) { sh.sound(0x5C); return 0; }   // A / B / Start
    if (w0[0x834] !== 3 && w.high[0x194] & 0x20) { sh.sound(0x5C); return 1; }   // Left: the other page
    yield* sh.advance();
  }
}

function strokesSetup(w) {                       // 0E:6CA8 ScorecardStrokesSetup
  const w0 = w.wram[0];
  if (w.vram) D.inBank(w, B, () => {
    D.disableLCDSafely(w);
    D.setWramBank(w, 1);
    D.lzTo(w, B, 0x5480, 0xD200);
    w.lcd.vbk = 0;
    D.startVRAMDMAFromHL(w, 0xD200, 0x9200, 0x60);
    D.startVRAMDMAFromHL(w, 0xD800, 0x8800, 0x80);
    D.lzTo(w, B, 0x5E51, 0xD000);
    w.lcd.vbk = 1;
    D.startVRAMDMAFromHL(w, 0xD000, 0x9000, 0x80);
    D.startVRAMDMAFromHL(w, 0xD800, 0x8800, 0x40);
    D.setWramBank(w, 2);
    D.lzTo(w, B, 0x6B93, 0xD000);                // the card's attributes
    D.setWramBank(w, 3);
    D.lzTo(w, B, 0x6921, 0xD000);                // and tiles
    D.loadPalettesUnlessFaded(w, 0x68E1, 0x00, 0x08);
    loadCommonGfx(w);
    drawStrokesScorecard(w);
  });
  if (w0[0x837] >= 0x0A) w0[0x323] = 0x0C;       // the back nine in view
  w0[0x32C] = 0x1E;
  mapDrawFullScreen(w);                          // 0B:4306 with a = 1
  D.inBank(w, 0x04, () => mapScrollTask(w));     // 04:4072
  if (w.vram) D.enableLCD(w);                    // 00:0371
}

function loadCommonGfx(w) {                      // 0E:42F0 ScorecardLoadCommonGfx
  const w0 = w.wram[0];
  w.lcd.vbk = 0;
  D.startVRAMDMAFromHL(w, 0x4050, 0x8000, 0x20);
  D.startVRAMDMAFromHL(w, 0x4250, 0x8200, 0x04);
  D.startVRAMDMAFromHL(w, 0x4290, 0x8300, 0x02);
  D.loadPalettesUnlessFaded(w, 0x42B0, 0x08, 0x08);
  if (w0[0x878] === 1) {                         // four faces from $C879
    for (let k = 0; k < 4; k++) drawFaceIcon(w, w0[0x879 + k], 0, 0x0A + k, 0x8400 + 0x40 * k);
  } else {
    drawFaceIcon(w, w0[0x890], w0[0x899], 0x0A, 0x8400);
    drawFaceIcon(w, w0[0x8D0], w0[0x8D9], 0x0B, 0x8440);
  }
}

// 12:6CF0 DrawFaceIcon: a = face ($FF none): 4 tiles 12:5730 + a x $40 to de (VRAM1 from $A000), palette 12:5B30 +
// a x 8 (+$80 with c bit 4) to OBJ / BG palette b
export function drawFaceIcon(w, a, c, b, de) {
  if (a === 0xFF) return;
  D.inBank(w, 0x12, () => {
    w.lcd.vbk = 0;
    if (de >= 0xA000) { w.lcd.vbk = 1; de -= 0x2000; }
    D.startVRAMDMAFromHL(w, (0x5730 + (a << 6)) & 0xFFFF, de, 0x04);
    let p = (0x5B30 + a * 8) & 0xFFFF;
    if (c & 0x10) p = (p + 0x80) & 0xFFFF;
    D.loadPalettesUnlessFaded(w, p, b, 0x01);
  });
}

// ---- the card's text into the map buffers: tiles in WRAM3, attribute 0 in WRAM2 (0E:447C / 0E:4492) ----
function putTile(w, de, t) { w.wram[3][de - 0xD000] = t; w.wram[2][de - 0xD000] = 0; return de + 1; }
function putString(w, de, s) { for (const t of s) { if (!t) break; de = putTile(w, de, t); } return de; }
function putNumber(w, de, v, digits) { return putString(w, de, formatDecimalNumber(v, digits)); }   // 0E:4513
function putDigitPair(w, de, a) {                // 0E:4532 ScorecardPutDigitPair (ScorecardDigitTileTable 0E:454A)
  const p = 0x454A + (a & 0x1F) * 2;
  de = putTile(w, de, rb(B, p));
  return putTile(w, de, rb(B, p + 1));
}
function putScoreToPar(w, de, a) {               // 0E:458A ScorecardPutScoreToPar: "+n", "-n", or the even mark
  const v = (((a + 0x36) & 0xFF) - 0x36) & 0xFFFF;
  const s = formatDecimalNumber(v, 3);
  if (!(v & 0x8000)) {
    if (!v) s[1] = 0x2E;
    else if (v < 0x64) {
      let i = 0;
      while (s[i] === 0x20) i++;
      s[i - 1] = 0x2B;                           // (a '+' before the first digit)
    }
  }
  return putString(w, de, s);
}

const parOf = (w, l) => holeParAndYards(w.wram[0][0x836], l)[0];
function drawParColumn(w, de, l) {               // 0E:6D9E DrawParColumn: 9 holes' pars from hole l, a row apart
  for (let h = 9; h; h--, l++, de += 0x40) putDigitPair(w, de, parOf(w, l));
}
function drawParTotal(w, de, l, h) {             // 0E:6DEE DrawParTotal: the pars of h holes from hole l
  let c = 0;
  for (; h; h--, l++) c = (c + parOf(w, l)) & 0xFF;
  putNumber(w, de, c, 2);
}
// 0E:44F8 ScorecardPutText: short text hl (05:40C2 CopyTextShortToDE: through WRAM5 $D880) at de
function putText(w, de, id) {
  const old = w.high[0x196];
  D.setWramBank(w, 5);
  loadTextShort(w, id);
  const s = [];
  for (let k = 0x880; w.wram[5][k]; k++) s.push(w.wram[5][k]);
  D.setWramBank(w, old);
  return putString(w, de, s);
}

function drawStrokesScorecard(w) {               // 0E:6E61 DrawStrokesScorecard
  const w0 = w.wram[0], course = w0[0x836];
  const par = l => holeParAndYards(course, l)[0];
  const parColumn = (de, l) => drawParColumn(w, de, l);
  const scores = (h, bc, de, l) => {             // 0E:6DBA DrawHoleScoresColumn
    for (; h; h--, bc++, l++, de += 0x40) {
      const v = w0[bc - 0xC000];
      let e = putDigitPair(w, de, v & 0x0F) + 2;   // strokes, two cells, putts, one cell, the score against par
      e = putDigitPair(w, e, v >> 4) + 1;
      putScoreToPar(w, e, ((v & 0x0F) - par(l)) & 0xFF);
    }
  };
  const parTotal = (de, l, h) => drawParTotal(w, de, l, h);
  const totals = (h, bc, de, l) => {             // 0E:6E0A DrawScoreTotals
    if (!h) return;
    let b = 0, c = 0;
    for (let k = 0; k < h; k++) { const v = w0[bc - 0xC000 + k]; b = (b + (v & 0x0F)) & 0xFF; c = (c + (v >> 4)) & 0xFF; }
    let e = putNumber(w, de, b, 3) + 2;          // strokes, two cells, putts, one cell, the score against par
    e = putNumber(w, e, c, 2) + 1;
    let p = 0;
    for (; h; h--, l++) p = (p + par(l)) & 0xFF;
    putScoreToPar(w, e, (b - p) & 0xFF);
  };
  parColumn(0xD145, 1);
  parColumn(0xD445, 0x0A);
  scores(w0[0x480], 0xC8AC, 0xD149, 1);
  scores(w0[0x481], 0xC8B5, 0xD449, 0x0A);
  parTotal(0xD385, 1, 9);
  parTotal(0xD685, 0x0A, 9);
  parTotal(0xD705, 1, 0x12);
  totals(w0[0x480], 0xC8AC, 0xD388, 1);
  totals(w0[0x481], 0xC8B5, 0xD688, 0x0A);
  totals(w0[0x4BE], 0xC8AC, 0xD708, 1);
}

// 0B:4306 MapDrawFullScreen with a = 1: 22 x 20 tiles from the 64 x 64 map buffers at the view ($C321 x, $C323 y)
// into the BG map (WRAM2 attributes -> VRAM1, WRAM3 tiles -> VRAM0). (When the source row wraps, the BG map
// column wraps too.)
export function mapDrawFullScreen(w) {
  D.setWramBank(w, 3);                           // (it leaves WRAM3 mapped)
  if (!w.vram) return;
  const w0 = w.wram[0];
  const x = w0[0x321], y = w0[0x323];
  const de0 = 0x9800 + ((((y & 0x1F) * 32) & 0xFF00) | ((((y & 0x1F) * 32) + (x & 0x1F)) & 0xFF));
  const hl0 = 0xD000 + (((y * 64) & 0xFF00) | (((y * 64) + x) & 0xFF));
  for (const [bank, vbk] of [[2, 1], [3, 0]]) {
    const src = w.wram[bank], dst = w.vram[vbk];
    let hl = hl0 & 0xFFFF, de = de0;
    for (let row = 0; row < 0x14; row++) {
      let h = hl, d = de;
      for (let col = 0; col < 0x16; col++) {
        dst[d - 0x8000] = src[h - 0xD000];
        h++; d++;
        if (!(h & 0x3F)) { h -= 0x40; d -= 0x20; }
        else if (!(d & 0x1F)) d -= 0x20;
      }
      const l = (hl & 0xFF) + 0x40;
      hl = l > 0xFF ? (((((hl >> 8) + 1) & 0x0F) | 0xD0) << 8) | (l & 0xFF) : (hl & 0xFF00) | l;
      const e = (de & 0xFF) + 0x20;
      de = e > 0xFF ? ((((de >> 8) + 1) & ~4) << 8) | (e & 0xFF) : (de & 0xFF00) | e;
    }
  }
  w.lcd.vbk = 0;
}

// 0E:6D47 ScorecardStrokesTask: Up / Down scroll (0E:443A), the map scroll, two sprites (other modes also mark
// the cleared holes: not ported)
function scorecardScrollTask(w) {                // 0E:443A ScorecardScrollTask
  const w0 = w.wram[0], h = w.high;
  let v = w0[0x322] | w0[0x323] << 8;
  if (h[0x190] & 0x40) { const n = (v + 0xFF80) & 0xFFFF; if (!(n & 0x8000)) v = n; }
  if (h[0x190] & 0x80) { const n = (v + 0x80) & 0xFFFF; if ((n >> 8) < ((w0[0x32C] - 0x12) & 0xFF)) v = n; }
  w0[0x322] = v & 0xFF; w0[0x323] = v >> 8;
  D.inBank(w, 0x04, () => mapScrollTask(w));     // 04:4072
}
export function scorecardStrokesTask(w) {
  const w0 = w.wram[0];
  scorecardScrollTask(w);
  if (w.vram) {
    D.positionSpriteWorld(w, 0x0900, 0x0500, 0x40, 0x02);
    D.positionSpriteWorld(w, 0x0900, 0x1100, 0x40, 0x02);
  }
  if (w0[0x834] !== 3 && w.vram) strokesHoleMarks(w);   // 0E:6D69
}

// ---- the match-play card (0E:762F ScorecardPageMatchPlay, page 1 in match play): the pars, a mark per hole for
// each player (won $7E, lost $7F, halved $7D) and the holes up ----
function* pageMatchPlay(sh) {
  const w = sh.w;
  yield* resetView(sh);
  matchPlaySetup(w);
  registerFrameTask(w, 0x01, B, 0x76F5);         // ScorecardMatchPlayTask
  for (;;) {
    if (w.high[0x194] & 0x0B) { sh.sound(0x5C); return 0; }   // A / B / Start
    if (w.high[0x194] & 0x20) { sh.sound(0x5C); return 1; }   // Left: the other page
    yield* sh.advance();
  }
}

function matchPlaySetup(w) {                     // 0E:7656 ScorecardMatchPlaySetup
  const w0 = w.wram[0];
  if (w.vram) D.inBank(w, B, () => {
    D.disableLCDSafely(w);
    D.setWramBank(w, 1);
    D.lzTo(w, B, 0x5480, 0xD200);
    w.lcd.vbk = 0;
    D.startVRAMDMAFromHL(w, 0xD200, 0x9200, 0x60);
    D.startVRAMDMAFromHL(w, 0xD800, 0x8800, 0x80);
    D.setWramBank(w, 1);
    D.lzTo(w, B, 0x5E51, 0xD000);
    w.lcd.vbk = 1;
    D.startVRAMDMAFromHL(w, 0xD000, 0x9000, 0x80);
    D.startVRAMDMAFromHL(w, 0xD800, 0x8800, 0x80);
    D.setWramBank(w, 2);
    D.lzTo(w, B, 0x7573, 0xD000);                // the card's attributes
    D.setWramBank(w, 3);
    D.lzTo(w, B, 0x73F0, 0xD000);                // and tiles
    D.loadPalettesUnlessFaded(w, 0x68E1, 0x00, 0x08);
    loadCommonGfx(w);
    drawMatchPlayScorecard(w);
  });
  else drawMatchPlayHoleResults(w);              // (headless: the holes-up count $C484 only)
  if (w0[0x837] >= 0x0A) w0[0x323] = 0x0A;
  w0[0x32C] = 0x1C;
  mapDrawFullScreen(w);                          // 0B:4306 with a = 1
  D.inBank(w, 0x04, () => mapScrollTask(w));     // 04:4072
  if (w.vram) D.enableLCD(w);                    // 00:0371
}

function drawMatchPlayScorecard(w) {             // 0E:7850 DrawMatchPlayScorecard
  drawParColumn(w, 0xD145, 1);
  drawParColumn(w, 0xD405, 0x0A);
  drawParTotal(w, 0xD685, 1, 0x12);
  drawMatchPlayHoleResults(w);
  drawMatchPlayStatus(w);
}

// 0E:777A DrawMatchPlayHoleResults: per hole done, player 1's strokes ($C8AC) against player 2's ($C8EC); $C484 =
// player 1's holes up
function drawMatchPlayHoleResults(w) {
  const w0 = w.wram[0], disp = !!w.vram;
  w0[0x484] = 0;
  let de = 0xD14A;
  let h = w0[0x4BE];
  if (!h) return;
  for (let l = 1; h; l++, h = (h - 1) & 0xFF) {
    const p1 = w0[(0x8AC + l - 1) & 0xFFF] & 0x0F, p2 = w0[(0x8EC + l - 1) & 0xFFF] & 0x0F;
    const [a, b] = p2 < p1 ? [0x7F, 0x7E] : p2 > p1 ? [0x7E, 0x7F] : [0x7D, 0x7D];
    if (p2 < p1) w0[0x484] = (w0[0x484] - 1) & 0xFF;
    else if (p2 > p1) w0[0x484] = (w0[0x484] + 1) & 0xFF;
    if (disp) putTile(w, putTile(w, de, a) + 5, b);
    de += 0x40;
    if (l === 9) de += 0x80;
  }
}

function drawMatchPlayStatus(w) {                // 0E:7804 DrawMatchPlayStatus: "n Up" / "n Down", or "Even" twice
  let de = 0xD687;
  let a = w.wram[0][0x484];
  if (!a) { de = putText(w, de + 2, 0x121); putText(w, de + 2, 0x121); return; }
  if (!(a & 0x80)) {
    de = putDigitPair(w, de + 2, a);
    de = putText(w, de, 0x120);
    de = putDigitPair(w, de, a);
    putText(w, de, 0x122);
  } else {
    a = (-a) & 0xFF;
    de = putDigitPair(w, de, a);
    de = putText(w, de, 0x122);
    de = putDigitPair(w, de + 2, a);
    putText(w, de, 0x120);
  }
}

// 0E:4643 ScorecardQueueSprite: template hl at row e (tiles; skipped off screen) and column d, with a bob offset
// (ScorecardBobTable 0E:467D by hVBlankCount)
function scorecardQueueSprite(w, hl, e, d, c, b) {
  const w0 = w.wram[0];
  const v = (((e << 8) - (w0[0x322] | w0[0x323] << 8)) & 0xFFFF);
  if ((((v >> 8) + 2) & 0xFF) >= 0x14) return;
  const ee = ((v << 3) >> 8) & 0xFF;
  const dd = (((d << 3) & 0xFF) + rb(B, 0x467D + (w.high[0x18C] & 0x3F))) & 0xFF;
  D.queueSpriteTemplate(w, hl, ee, dd, c, b);
}

// 0E:76F5 ScorecardMatchPlayTask: the scroll, the cursor sprite, the faces beside the rows
export function scorecardMatchPlayTask(w) {
  scorecardScrollTask(w);
  if (!w.vram) return;
  scorecardQueueSprite(w, 0x4036, 0x00, 0x01, 0x16, 0x01);
  const pairs = w.wram[0][0x878] === 1
    ? [[0x09C0, 0x40, 0x02], [0x0BC0, 0x44, 0x03], [0x0FC0, 0x48, 0x04], [0x11C0, 0x4C, 0x05]]
    : [[0x0A80, 0x40, 0x02], [0x1080, 0x44, 0x03]];
  for (const [hl, c, b] of pairs) {
    D.positionSpriteWorld(w, hl, 0x0500, c, b);  // 00:27B4
    D.positionSpriteWorld(w, hl, 0x1000, c, b);
  }
}

// ---- the two-player Stroke card (0E:7199 ScorecardPageTwoPlayerStrokes, page 1 with two players): the pars, both
// players' strokes per hole and their totals ----
function* pageTwoPlayerStrokes(sh) {
  const w = sh.w;
  yield* resetView(sh);
  twoPlayerSetup(w);
  registerFrameTask(w, 0x01, B, 0x725F);         // ScorecardTwoPlayerTask
  for (;;) {
    if (w.high[0x194] & 0x0B) { sh.sound(0x5C); return 0; }   // A / B / Start
    if (w.high[0x194] & 0x20) { sh.sound(0x5C); return 1; }   // Left: the other page
    yield* sh.advance();
  }
}
function twoPlayerSetup(w) {                     // 0E:71C0 ScorecardTwoPlayerSetup
  const w0 = w.wram[0];
  if (w.vram) D.inBank(w, B, () => {
    D.disableLCDSafely(w);
    D.setWramBank(w, 1);
    D.lzTo(w, B, 0x5480, 0xD200);
    w.lcd.vbk = 0;
    D.startVRAMDMAFromHL(w, 0xD200, 0x9200, 0x60);
    D.startVRAMDMAFromHL(w, 0xD800, 0x8800, 0x80);
    D.setWramBank(w, 1);
    D.lzTo(w, B, 0x5E51, 0xD000);
    w.lcd.vbk = 1;
    D.startVRAMDMAFromHL(w, 0xD000, 0x9000, 0x80);
    D.startVRAMDMAFromHL(w, 0xD800, 0x8800, 0x40);
    D.setWramBank(w, 2);
    D.lzTo(w, B, 0x70C2, 0xD000);                // the card's attributes
    D.setWramBank(w, 3);
    D.lzTo(w, B, 0x6F00, 0xD000);                // and tiles
    D.loadPalettesUnlessFaded(w, 0x68E1, 0x00, 0x08);
    loadCommonGfx(w);
    drawTwoPlayerScorecard(w);
  });
  if (w0[0x837] >= 0x0A) w0[0x323] = 0x0C;
  w0[0x32C] = 0x1E;
  mapDrawFullScreen(w);                          // 0B:4306 with a = 1
  D.inBank(w, 0x04, () => mapScrollTask(w));     // 04:4072
  if (w.vram) D.enableLCD(w);                    // 00:0371
}
function drawTwoPlayerScorecard(w) {             // 0E:7377 DrawTwoPlayerScorecard
  const w0 = w.wram[0];
  // 0E:72E4 DrawTwoPlayerScoresColumn: h holes from hole l, a row ($40) apart: player 1's strokes ($C8AC) and, four
  // cells after that pair, player 2's ($C8EC)
  const scores = (h, de, l) => {
    for (; h; h--, l++, de += 0x40) {
      putDigitPair(w, putDigitPair(w, de, w0[0x8AC + l - 1] & 0x0F) + 4, w0[0x8EC + l - 1] & 0x0F);
    }
  };
  // 0E:731A DrawTwoPlayerTotals: the two players' stroke totals over h holes from l (3 digits; three cells on)
  const totals = (h, de, l) => {
    if (!h) return;
    let b = 0, c = 0;
    for (; h; h--, l++) { b = (b + (w0[0x8AC + l - 1] & 0x0F)) & 0xFF; c = (c + (w0[0x8EC + l - 1] & 0x0F)) & 0xFF; }
    putNumber(w, putNumber(w, de, b, 3) + 3, c, 3);
  };
  drawParColumn(w, 0xD145, 1);
  drawParColumn(w, 0xD445, 0x0A);
  scores(w0[0x480], 0xD149, 1);
  scores(w0[0x481], 0xD449, 0x0A);
  drawParTotal(w, 0xD385, 1, 9);
  drawParTotal(w, 0xD685, 0x0A, 9);
  drawParTotal(w, 0xD705, 1, 0x12);
  totals(w0[0x480], 0xD388, 1);
  totals(w0[0x481], 0xD688, 0x0A);
  totals(w0[0x4BE], 0xD708, 1);
}
// 0E:725F ScorecardTwoPlayerTask: as 0E:76F5, the faces' second column at $1100
export function scorecardTwoPlayerTask(w) {
  scorecardScrollTask(w);
  if (!w.vram) return;
  scorecardQueueSprite(w, 0x4036, 0x00, 0x01, 0x16, 0x01);
  const pairs = w.wram[0][0x878] === 1
    ? [[0x09C0, 0x40, 0x02], [0x0BC0, 0x44, 0x03], [0x0FC0, 0x48, 0x04], [0x11C0, 0x4C, 0x05]]
    : [[0x0A80, 0x40, 0x02], [0x1080, 0x44, 0x03]];
  for (const [hl, c, b] of pairs) {
    D.positionSpriteWorld(w, hl, 0x0500, c, b);  // 00:27B4
    D.positionSpriteWorld(w, hl, 0x1100, c, b);
  }
}

// ---- the tournament's standings (0E:5209 ScorecardPageStandings, page 0 in mode 1): rank, name (drawn as glyphs
// into the row's own tiles), score to par and holes played for the 28 golfers, the player's row marked, an arrow
// when the player's rank moved ----
function* pageStandings(sh) {
  const w = sh.w;
  yield* resetView(sh);
  standingsSetup(w);
  registerFrameTask(w, 0x01, B, 0x5348);         // ScorecardStandingsTask
  for (;;) {
    if (w.high[0x194] & 0x0B) { sh.sound(0x5C); return 0; }   // A / B / Start
    if (w.high[0x194] & 0x10) { sh.sound(0x5C); return 1; }   // Right: the other page
    yield* sh.advance();
  }
}
function standingsSetup(w) {                     // 0E:5230 ScorecardStandingsSetup
  const w0 = w.wram[0];
  if (w.vram) D.inBank(w, B, () => {
    D.disableLCDSafely(w);
    D.setWramBank(w, 1);
    decompressDataFromBank(w, 0x0C10, 0xD200);   // 00:0234
    w.lcd.vbk = 0;
    D.startVRAMDMAFromHL(w, 0xD200, 0x9200, 0x20);
    D.startVRAMDMAFromHL(w, 0xD800, 0x8800, 0x80);
    D.setWramBank(w, 1);
    D.lzTo(w, B, 0x4710, 0xD000);
    w.lcd.vbk = 1;
    D.startVRAMDMAFromHL(w, 0xD000, 0x9000, 0x80);
    D.startVRAMDMAFromHL(w, 0xD800, 0x8800, 0x80);
    D.setWramBank(w, 2);
    D.lzTo(w, B, 0x5131, 0xD000);                // the list's attributes
    D.setWramBank(w, 3);
    D.lzTo(w, B, 0x4FEA, 0xD000);                // and tiles
    initNameTiles(w);                            // 0E:5309
    D.loadPalettesUnlessFaded(w, 0x4FAA, 0x00, 0x08);
    loadCommonGfx(w);
    D.setWramBank(w, 1);
    for (let k = 0, de = 0xD400; k < 0xA8; k++, de += 16) D.copyMemoryFast(w, 0x46BD, de, 1);   // blank name tiles
  });
  buildStandingsRows(w);                         // 0E:5448
  if (w.vram) D.inBank(w, B, () => {
    D.setWramBank(w, 1);
    w.lcd.vbk = 0;
    D.startVRAMDMAFromHL(w, 0xD400, 0x9400, 0x40);
    D.startVRAMDMAFromHL(w, 0xD800, 0x8800, 0x68);
  });
  if (((w0[0x482] + 1) & 0xFF) >= 0x0D) w0[0x323] = 0x10;
  w0[0x32C] = 0x22;
  mapDrawFullScreen(w);                          // 0B:4306 with a = 1
  D.inBank(w, 0x04, () => mapScrollTask(w));     // 04:4072
  if (w.vram) D.enableLCD(w);                    // 00:0371
}
// 0E:5309 ScorecardInitNameTiles: tiles $40, $41, ... six to a row (28 rows, $40 apart) from WRAM3 $D146, attribute 0
function initNameTiles(w) {
  D.setWramBank(w, 3);
  for (let r = 0, a = 0x40; r < 0x1C; r++) for (let k = 0; k < 6; k++) D.wr(w, 0xD146 + 0x40 * r + k, (a++) & 0xFF);
  D.setWramBank(w, 2);
  for (let r = 0; r < 0x1C; r++) for (let k = 0; k < 6; k++) D.wr(w, 0xD146 + 0x40 * r + k, 0);
}
// 0E:5448 ScorecardBuildStandingsRows: the standings (0E:78B4), copied ($74 bytes) to $C600 and drawn (0E:53A6);
// wStandingsPlayerIdx $C482 (0E:7871) and wStandingsPlayerRank $C483 (0E:7887)
function buildStandingsRows(w) {
  const w0 = w.wram[0];
  buildStandings(w);
  D.setWramBank(w, 6);
  D.copyMemoryBC(w, 0xD800, 0xC600, 0x74);
  if (w.vram) D.inBank(w, B, () => drawStandingsList(w, 0xC600));
  let c = 0;
  for (let hl = 0xC600; w0[hl - 0xC000] !== 0x96 && w0[hl + 2 - 0xC000]; hl += 4) c++;   // 0E:7871 FindPlayerInStandings
  w0[0x482] = c;
  w0[0x483] = getPlayerRank(w);
}
// 0E:53A6 DrawStandingsList: per entry (a row of $40 from $D141): its rank + 1 (and '/' when tied), the name (0E:45E8
// GetGolferName to $C490, 03:50CD DrawStringToGlyphs into WRAM1 $D200, merged into the row's six tiles at
// [$C485] with 0E:46CD BlitGlyphRows), the score to par and the holes played ('-' for none)
function drawStandingsList(w, bc) {
  const w0 = w.wram[0];
  w0[0x485] = 0; w0[0x486] = 0xD4;
  for (let row = 0xD141; D.rd(w, bc) !== 0x96; row += 0x40, bc += 4) {
    let de = putDigitPair(w, row, ((D.rd(w, bc + 3) & 0x7F) + 1) & 0xFF);
    if (D.rd(w, bc + 3) & 0x80) putTile(w, de, 0x2F);
    D.setWramBank(w, 2);                         // (0E:447C ScorecardPutTile leaves WRAM2)
    de += 2;
    getGolferName(w, D.rd(w, bc + 2), 0xC490);
    D.setWramBank(w, 1);
    D.clearMemory16(w, 0xD200, 6);               // 00:03A7
    D.inBank(w, 0x03, () => drawStringToGlyphs(w, 0xC490, 0xD200));
    let hl = w0[0x485] | w0[0x486] << 8;
    for (let k = 0, src = 0xD200; k < 6 * 8; k++, src += 2, hl += 2) {   // 0E:46EB BlitGlyphRowMasked
      const c = D.rd(w, src), b = D.rd(w, src + 1), e = (~b) & 0xFF;
      D.wr(w, hl, (D.rd(w, hl) & e) | (b & c));
      D.wr(w, hl + 1, (D.rd(w, hl + 1) & e) | b);
    }
    w0[0x485] = hl & 0xFF; w0[0x486] = hl >> 8;
    de = (de + 7) & 0xFFFF;
    de = putScoreToPar(w, de, D.rd(w, bc)) + 1;
    const n = D.rd(w, bc + 1);
    if (n) putDigitPair(w, de, n);
    else putTile(w, de + 1, 0x2D);
    D.setWramBank(w, 2);
  }
}
// 0E:45E8 GetGolferName: a = 0 or $FF: the player's name ($C800, 11 bytes); bit 7: the course's golfer list (0E:4633)
// entry a & $7F; else text $53 + a; to de
function getGolferName(w, a, de) {
  if (!a || a === 0xFF) { D.copyMemoryBC(w, 0xC800, de, 0x0B); return; }
  if (a & 0x80) {
    const t = rw(B, (0x4633 + ((2 * w.wram[0][0x836]) & 0xFF)) & 0xFFFF);
    copyTextShortToDE(w, (t + (a & 0x7F)) & 0xFFFF, de);
  } else copyTextShortToDE(w, (0x53 + a) & 0xFFFF, de);
}
// 0E:5348 ScorecardStandingsTask: the scroll; the player's row's marker and the cursor; once a hole is done and the
// rank moved ($C875 against $C483), a blinking arrow (up: rank improved, tile $22) beside the row
export function scorecardStandingsTask(w) {
  const w0 = w.wram[0];
  scorecardScrollTask(w);
  if (!w.vram) return;
  D.positionSpriteWorld(w, 0x0500, (((w0[0x482] + 6) & 0xFF) << 8) | 0x60, 0x40, 0x02);
  scorecardQueueSprite(w, 0x4008, 0x00, 0x0D, 0x00, 0x01);
  if (!w0[0x4BE] || w0[0x875] === w0[0x483]) return;
  const d = (w0[0x482] + 5) & 0xFF;
  let e = ((((w.high[0x18C] & 0x0F) + 0x0A) & 0xFF) << 3) & 0xFF, c = 0x20;
  if (w0[0x875] < w0[0x483]) { e = (~e) & 0xFF; c = 0x22; }
  D.positionSpriteWorld2(w, 0x0080, d << 8 | e, c, 0x06);
}
// 0E:6D69 (ScorecardStrokesTask outside Stroke play): the cursor sprite, and a mark beside each hole of the course
// whose bit is set in the course record (02:5C77 TestCourseHoleBit)
function strokesHoleMarks(w) {
  scorecardQueueSprite(w, 0x401D, 0x00, 0x01, 0x0A, 0x01);
  let d = 0x05;
  for (let l = 1; l <= 0x12; l++) {
    if (testCourseHoleBit(w, w.wram[0][0x836], l)) D.positionSpriteWorld2(w, 0x0180, d << 8 | 0x80, 0x30, 0x07);
    d = (d + 1 + (l === 9 ? 3 : 0)) & 0xFF;
  }
}
// 02:5C77 TestCourseHoleBit: bit l (below $18) of the course's bitmap ($C996 + 25 x (course - 1)); courses 1-5
export function testCourseHoleBit(w, h, l) {
  if (!h || h >= 6 || l >= 0x18) return 0;
  const p = 0xC996 + 25 * (h - 1) + (l >> 3);
  return rb(0x02, 0x5D27 + (l & 7)) & D.rd(w, p);
}
// 02:5CA5 SetCourseHoleBit
export function setCourseHoleBit(w, h, l) {
  if (!h || h >= 6 || l >= 0x18) return;
  const p = 0xC996 + 25 * (h - 1) + (l >> 3);
  D.wr(w, p, D.rd(w, p) | rb(0x02, 0x5CEA + (l & 7)));
}

// ---- bank 0E's unreferenced card writers (fuzz-checked: web/tests/golf_fuzz_routines.mjs); each leaves the WRAM
// bank its last write used mapped (ScorecardPutTile 0E:447C ends on WRAM2, ScorecardPutString 0E:4492 on WRAM3) ----
const strAt = (w, hl) => { const s = []; for (let a = hl; ; a = (a + 1) & 0xFFFF) { const t = a >= 0xC000 ? D.rd(w, a) : rb(B, a); if (!t) break; s.push(t); } return s; };
// 0E:44E2 ScorecardPutStringRight: the string at hl right-aligned in 6 cells from de (de + 6 - its length)
export function scorecardPutStringRight(w, hl, de) {
  const s = strAt(w, hl);
  putString(w, (de + 6 - s.length) & 0xFFFF, s);
  D.setWramBank(w, 3);
}
// 0E:45CD ScorecardFillBlank: b spaces ($20, attribute 0) from hl (b = 0: 256)
export function scorecardFillBlank(w, hl, b) {
  let n = b || 0x100;
  for (; n; n--, hl = (hl + 1) & 0xFFFF) putTile(w, hl, 0x20);
  D.setWramBank(w, 2);
}
// 0E:6EDB SumScoreToPar: l holes of the strokes at de (low nibbles) less their pars (13:7044, course $C836), 8-bit
function sumScoreToPar(w, l, de) {
  let b = 0;
  for (let h = 1; l; l--, h++, de++) b = (((D.rd(w, de) & 0x0F) - parOf(w, h)) + b) & 0xFF;
  return b;
}
// 0E:6E50 DrawP1ScoreToPar / 0E:7356 DrawTwoPlayerToPar: player 1's (and player 2's) score to par over wHolesDone
// $C4BE at $D708 (and $D70E)
export function drawScoreToParUnused(w, both) {
  putScoreToPar(w, 0xD708, sumScoreToPar(w, D.rd(w, 0xC4BE), 0xC8AC));
  if (both) putScoreToPar(w, 0xD70E, sumScoreToPar(w, D.rd(w, 0xC4BE), 0xC8EC));
  D.setWramBank(w, 3);
}
