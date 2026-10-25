// The scorecard between holes (ShowScorecard 0E:43D6, from RoundHookHoleEnd): for a one-player Stroke round the
// hole-by-hole card (ScorecardPageStrokes 0E:6C7A): front and back nine, par, strokes, putts and the score against
// par, drawn into the 64 x 64 map buffers (WRAM2 attributes / WRAM3 tiles) and shown with MapDrawFullScreen; Up /
// Down scroll it (ScorecardScrollTask), A / B / Start leave. The other modes' pages are not ported.
// The frame task, the scroll state, the frames and the buttons run headless too; the tiles, maps, palettes and
// sprites only with a display (render/display.js).
import { rb, rw } from "./rom.js";
import { clearFrameTasks, registerFrameTask } from "./tasks.js";
import { mapScrollTask } from "./render/holeview.js";
import { formatDecimalNumber } from "./render/text.js";
import * as D from "./render/display.js";

const B = 0x0E;

// 13:7044 GetHoleParAndYards: l = hole 1-18, h = course: [par, yards] from HoleInfoTable 13:5884
export function holeParAndYards(h, l) {
  let a = (l - 1) & 0xFF;
  if (h) {
    a = (a + 0x0A) & 0xFF;
    for (let d = (h - 2) & 0xFF; !(d & 0x80); d = (d - 2) & 0xFF) a = (a + 0x12) & 0xFF;
  }
  const p = (0x5884 + ((0x20 * a) & 0xFFFF)) & 0xFFFF;
  return [rb(0x13, p), rw(0x13, p + 4)];
}

// 0E:43D6 ShowScorecard: the pages by mode (ScorecardPageTable 0E:4422), turning pages while one returns 1
export function* showScorecard(sh) {
  const w0 = sh.w.wram[0];
  const c = w0[0x834] === 1 ? 0 : w0[0x834] === 2 ? 1 : w0[0x8D0] === 0xFF ? 2 : 3;
  let b = 0;
  for (;;) {
    const page = rw(B, 0x4422 + (c * 2 + b) * 2);
    if (page !== 0x6C7A) throw new Error(`the scorecard page 0E:${page.toString(16)} is not ported`);
    const a = yield* pageStrokes(sh);
    if (!a) return;
    b ^= 1;
  }
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
  if (w.vram) mapDrawFullScreen(w);             // 0B:4306 with a = 1
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
function drawFaceIcon(w, a, c, b, de) {
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

function drawStrokesScorecard(w) {               // 0E:6E61 DrawStrokesScorecard
  const w0 = w.wram[0], course = w0[0x836];
  const par = l => holeParAndYards(course, l)[0];
  const parColumn = (de, l) => { for (let h = 9; h; h--, l++, de += 0x40) putDigitPair(w, de, par(l)); };   // 0E:6D9E
  const scores = (h, bc, de, l) => {             // 0E:6DBA DrawHoleScoresColumn
    for (; h; h--, bc++, l++, de += 0x40) {
      const v = w0[bc - 0xC000];
      let e = putDigitPair(w, de, v & 0x0F) + 2;   // strokes, two cells, putts, one cell, the score against par
      e = putDigitPair(w, e, v >> 4) + 1;
      putScoreToPar(w, e, ((v & 0x0F) - par(l)) & 0xFF);
    }
  };
  const parTotal = (de, l, h) => { let c = 0; for (; h; h--, l++) c = (c + par(l)) & 0xFF; putNumber(w, de, c, 2); };   // 0E:6DEE
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
export function scorecardStrokesTask(w) {
  const w0 = w.wram[0], h = w.high;
  let v = w0[0x322] | w0[0x323] << 8;            // 0E:443A ScorecardScrollTask
  if (h[0x190] & 0x40) { const n = (v + 0xFF80) & 0xFFFF; if (!(n & 0x8000)) v = n; }
  if (h[0x190] & 0x80) { const n = (v + 0x80) & 0xFFFF; if ((n >> 8) < ((w0[0x32C] - 0x12) & 0xFF)) v = n; }
  w0[0x322] = v & 0xFF; w0[0x323] = v >> 8;
  D.inBank(w, 0x04, () => mapScrollTask(w));     // 04:4072
  if (w.vram) {
    D.positionSpriteWorld(w, 0x0900, 0x0500, 0x40, 0x02);
    D.positionSpriteWorld(w, 0x0900, 0x1100, 0x40, 0x02);
  }
  if (w0[0x834] !== 3) throw new Error("the scorecard's cleared-hole marks (~0E:6D69) are not ported");
}
