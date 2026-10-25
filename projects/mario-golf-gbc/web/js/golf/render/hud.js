// Bank 12: the golf HUD. Its parts are drawn as sprite tiles: rendered into WRAM6 buffers ($D000 / $D200) with the
// home bank's glyph code (render/text.js) and queued to VRAM bank 1; the HUD task (12:449F) lays the sprites out
// every frame. All of it reads its glyphs, tiles and palettes from bank 12 of the ROM.
import * as D from "./display.js";
import { rd, wr, inBank, queueVRAMCopy, loadPalettesImmediate, queueSprite, queueSpriteGrid, clearMemory16 } from "./display.js";
import { renderGlyphToTiles, renderCharToTiles, renderNumberToTiles, formatDecimalNumber } from "./text.js";
import { baseDistance } from "../launch.js";
import { pinDist, shotLength } from "../cup.js";
import { ball } from "../memory.js";
import * as g from "../math.js";

const B = 0x12;
const r6 = w => w.wram[6];
const bank6 = w => D.setWramBank(w, 6);
const hl16 = (w, a) => rd(w, a) | rd(w, a + 1) << 8;
const sra5 = v => ((v << 16 >> 16) >> 5) & 0xFFFF;   // five sra h / rr l
const srl5 = v => (v & 0xFFFF) >> 5;

export function hudInit(w) {                     // 12:442C HudInit (its frame task is registered by the caller)
  inBank(w, B, () => {
    D.disableLCDSafely(w);
    loadPalettesImmediate(w, 0x67FD, 0x00, 0x02);
    loadPalettesImmediate(w, 0x6805, 0x08, 0x01);
    hudLoadTiles(w); D.processVRAMCopyQueue(w);
    hudLoadMarkerTiles(w); D.processVRAMCopyQueue(w);
    hudDrawLieIcon(w);
    hudDrawClubIcon(w); D.processVRAMCopyQueue(w);
    hudDrawHoleInfo(w); D.processVRAMCopyQueue(w);
    hudDrawWind(w); D.processVRAMCopyQueue(w);
    hudDistance(w); D.processVRAMCopyQueue(w);
    hudDrawPlayer1(w);
    hudDrawPlayer2(w); D.processVRAMCopyQueue(w);
    hudLayoutWindow(w);
    hudDrawLabels(w); D.processVRAMCopyQueue(w);
    hudLoadCursorTiles(w);
    hudDrawShotPanel(w);
    hudWindowY80(w); D.processVRAMCopyQueue(w);
    bank6(w);
    r6(w)[0x44D] = 0xF0;
    r6(w)[0x328] = 1;                            // wHudBusy
  });
}

export function hudTask(w) {                     // 12:449F HudTask
  bank6(w);
  const r = r6(w), h = w.high;
  if (r[0x358]) return;
  if (!r[0x455]) {                               // wHudPanelsHidden
    queueSpriteGrid(w, 0x0201, 0x8820, 0x0C5C);
    queueSpriteGrid(w, 0x0201, 0x8832, 0x0D6C);
    let c = 3;
    if (r[0x454] && (h[0x18C] & 0x0F) >= 6) c = w.wram[0][0x835] ? 1 : 2;   // wHudBlink: the current player's panel
    if (c & 1) queueSpriteGrid(w, 0x0101, 0x9820, 0x0860);
    if (c & 2) queueSpriteGrid(w, 0x0101, 0x9832, 0x0870);
  }
  drawCountdown(w);                              // 12:4F24
  updateWindIndicator(w);                        // 12:50A0
  updateEffectObjectList(w);                     // 12:6B04
  if ((h[0x18C] & 7) >= 2 && r[0x44D] !== 0xF0) {
    const t = 0x458F + ((r[0x44D] >> 3) & 0x1E);
    queueSprite(w, (0x86 + rd(w, t + 1)) & 0xFF, (0x98 + rd(w, t)) & 0xFF, 0x78, 0x08);
  }
  hudDrawMeterCursor(w, r[0x44F], r[0x451]);     // wSwingCursor, wSwingPerfect
  hudDrawMeterCursor(w, r[0x450], r[0x452]);     // wSwingPower, wSwingFullPower
  if (w.wram[0][0x834] !== 8 && r[0x32A] === 1 && r[0x329] < 0x0D) queueSprite(w, 0x84, 0x2A, 0x3C, 0x08);
}

function hudDrawMeterCursor(w, a, blink) {       // 12:456E HudDrawMeterCursor
  if (a === 0x80) return;
  let c = 0x4A;
  if ((blink & 1) && (w.high[0x18C] & 0x08)) c = 0x48;
  queueSprite(w, 0x86, (0x6D - a) & 0xFF, c, 0x08);
}

function hudLoadTiles(w) {                       // 12:45AF HudLoadTiles
  bank6(w);
  clearMemory16(w, 0xD000, 0x20);
  queueVRAMCopy(w, 0x5200, 0xBC00, 4);
  queueVRAMCopy(w, 0x51C0, 0x9C00, 4);
  queueVRAMCopy(w, 0x6020, 0x9100, 4);
  queueVRAMCopy(w, 0x5C60, 0x91C0, 4);
}

function hudWindowY80(w) { w.lcd.wy = 0x80; }    // 12:45EA HudWindowY80

export function hudLieIndex(w) {                 // 12:4239 HudLieIndex
  const r = r6(w);
  if (r[0x445]) return 0;
  const t = r[0x4CD], lie = r[0x446];
  if (t === 0x0D || t === 0x02) { if (lie) return lie === 1 ? 5 : 6; }
  else if (t === 0x00 || t === 0x0E) { if (lie) return lie === 1 ? 9 : 0x0A; }
  else if (t === 0x01) { if (lie) return 0x0B; }
  return rd(w, 0x4292 + t);                      // HudLieIconTable 12:4292
}

export function hudDrawLieIcon(w) {              // 12:45F4 HudDrawLieIcon
  inBank(w, B, () => {
    const p = 0x6670 + hudLieIndex(w) * 4;
    let pal = hl16(w, p);
    if (r6(w)[0x4CD] === 0x0D) pal = 0x6668;
    loadPalettesImmediate(w, pal, 0x0E, 0x01);
    queueVRAMCopy(w, hl16(w, p + 2), 0xA440, 4);
    hudDrawClubLieNumbers(w);                    // (no ret: it runs on into 12:4622)
  });
}

function hudDrawClubLieNumbers(w) {              // 12:4622 HudDrawClubLieNumbers (12:41B6 ClubLieEntry)
  const t = hl16(w, 0x41D5 + 2 * r6(w)[0x329]);
  const p = (t + 2 * hudLieIndex(w)) & 0xFFFF;
  drawNumberOr100(w, rd(w, p), 0x73, 0x00);
  drawNumberOr100(w, rd(w, p + 1), 0x73, 0x08);
  queueVRAMCopy(w, 0xD1C0, 0x8FC0, 4);
}
function drawNumberOr100(w, a, b, c) {           // 12:463F DrawNumberOr100
  if (a === 0x64) renderGlyphToTiles(w, 0x683D, 0xD000, b, c);
  else renderNumberToTiles(w, a, 2, 0xD000, b, c);
}

export function hudDrawClubIcon(w) {             // 12:465C HudDrawClubIcon
  inBank(w, B, () => queueVRAMCopy(w, hl16(w, 0x5C30 + 2 * r6(w)[0x329]), 0xA400, 4));
}

function hudDrawLabels(w) {                      // 12:4673 HudDrawLabels
  bank6(w);
  loadPalettesImmediate(w, 0x67DD, 0x07, 0x01);
  renderGlyphToTiles(w, 0x66B8, 0xD000, 0x1E, 0x03);
  renderGlyphToTiles(w, 0x6782, 0xD000, 0x50, 0x0E);
  queueVRAMCopy(w, 0xD060, 0x8E60, 0x16);
}

// club names: the digit (or the first glyph) and the second glyph ("W" 12:6997 / "I" 12:6951) by wClub & $0F
const CLUB_NAMES = [[0x31, 0x6997], [0x33, 0x6997], [0x34, 0x6997], [0x32, 0x6951], [0x33, 0x6951], [0x34, 0x6951],
  [0x35, 0x6951], [0x36, 0x6951], [0x37, 0x6951], [0x38, 0x6951], [0x39, 0x6951], [-0x696B, 0x6997], [-0x6979, 0x6997]];

export function hudDrawShotPanel(w) {            // 12:46A6 HudDrawShotPanel
  inBank(w, B, () => {
    bank6(w);
    const r = r6(w);
    clearMemory16(w, 0xD000, 6);
    let pal, label;
    if (r[0x329] === 0x0D) {                     // the putter's range ($D32B)
      [pal, label] = [[0x67ED, 0x6979], [0x67DD, 0x69B5], [0x67E5, 0x69A7]][Math.min(r[0x32B], 2)];
    } else {
      [pal, label] = [[0x67DD, 0x695D], [0x67E5, 0x696B], [0x67ED, 0x6943], [0x67F5, 0x6943]][Math.min(r[0x32A], 3)];
    }
    loadPalettesImmediate(w, pal, 0x07, 0x01);
    renderGlyphToTiles(w, label, 0xD000, 0x11, 0x00);
    const club = r[0x329] & 0x0F;
    if (club <= 0x0C) {
      const [a, second] = CLUB_NAMES[club];
      if (a > 0) renderCharToTiles(w, a, 0xD000, 0x01, 0x00);
      else renderGlyphToTiles(w, -a, 0xD000, 0x01, 0x00);
      renderGlyphToTiles(w, second, 0xD000, 0x07, 0x00);
      renderNumberToTiles(w, sra5(baseDistance(w)), 3, 0xD000, 0x01, 0x08);   // 10:68B1 ClubBaseDistance, yards
      renderGlyphToTiles(w, 0x6859, 0xD000, 0x13, 0x09);
      const t = 0x66A0 + ((r[0x321] & 7) << 1);  // the shot's curve mark by $D321
      shotPanelTail(w, hl16(w, t));
    } else {                                     // the putter (and wClub & $0F above $0D)
      renderGlyphToTiles(w, 0x696B, 0xD000, 0x01, 0x00);
      renderGlyphToTiles(w, 0x6987, 0xD000, 0x07, 0x00);
      const d = baseDistance(w);
      renderNumberToTiles(w, sra5((d * 3 + 8) & 0xFFFF), 3, 0xD000, 0x00, 0x08);   // feet
      renderGlyphToTiles(w, 0x6864, 0xD000, 0x12, 0x08);
      shotPanelTail(w, 0x67D0);
    }
  });
}
function shotPanelTail(w, glyph) {               // 12:48FB
  renderGlyphToTiles(w, glyph, 0xD000, 0x50, 0x0E);
  queueVRAMCopy(w, 0xD120, 0x8F20, 8);
  queueVRAMCopy(w, 0xD000, 0x8E00, 8);
}

export function hudSetMeterSpritesY(w) {         // 12:4968 HudSetMeterSpritesY
  const o = w.wram[0], put = r6(w)[0x329] === 0x0D ? [0xA0, 0xA0, 0xA0, 0xA0, 0xA0] : [0x10, 0x10, 0x20, 0x20, 0x20];
  for (let k = 0; k < 5; k++) o[4 * k] = put[k];
}

function hudLayoutWindow(w) {                    // 12:49A5 HudLayoutWindow
  bank6(w);
  queueSpriteGrid(w, 0x0201, 0x8C00, 0x0962);
  queueSpriteGrid(w, 0x0301, 0x8810, 0x0866);
  if (r6(w)[0x325] < 6) queueSpriteGrid(w, 0x0302, 0x0000, 0x0850);
  queueSpriteGrid(w, 0x0301, 0x0070, 0x0872);
  queueSprite(w, 0x84, 0x04, 0x40, 0x08);
  queueSprite(w, 0x84, 0x0C, 0x42, 0x08);
  queueSprite(w, 0x84, 0x94, 0x44, 0x0E);
  queueSprite(w, 0x84, 0x9C, 0x46, 0x0E);
  D.setSpriteQueueBase(w);
}

export function hudDrawHoleInfo(w) {             // 12:4A0A HudDrawHoleInfo
  bank6(w);
  const r = r6(w);
  if (r[0x325] >= 6) return;
  clearMemory16(w, 0xD200, 0x0C);
  renderNumberToTiles(w, w.wram[0][0x837], 2, 0xD200, 0x06, 0x00);
  renderGlyphToTiles(w, 0x687A, 0xD200, 0x12, 0x01);
  renderNumberToTiles(w, r[0x323] | r[0x324] << 8, 3, 0xD200, 0x00, 0x08);
  renderGlyphToTiles(w, 0x6859, 0xD200, 0x12, 0x09);
  renderGlyphToTiles(w, 0x6885, 0xD200, 0x19, 0x01);
  renderNumberToTiles(w, r[0x325], 1, 0xD200, 0x29, 0x00);
  queueVRAMCopy(w, 0xD200, 0xA500, 0x0C);
}

export function hudDrawWind(w) {                 // 12:4A81 HudDrawWind
  inBank(w, B, () => {
    bank6(w);
    const r = r6(w), w0 = w.wram[0];
    clearMemory16(w, 0xD200, 6);
    const speed = w0[0x815] & 0x1F;
    drawStrokeNumber(w, speed, 0xD200);
    renderGlyphToTiles(w, 0x68CA, 0xD200, 0x08, 0x01);
    queueVRAMCopy(w, 0xD200, 0xA660, 6);
    let src;
    if (!speed) src = 0x56F0;
    else {
      const a = r[0x443] === 4
        ? (w0[0x816] - (((r[0x418] | r[0x419] << 8) + 0x80) >> 8 & 0xFF) + 0xC8) & 0xFF   // against the aim (view 4)
        : (w0[0x816] + 8) & 0xFF;
      src = 0x52F0 + ((a & 0xF0) << 2);
    }
    queueVRAMCopy(w, src, 0xA620, 4);
    r[0x326] = r[0x327] = r[0x328] = 0;
  });
}

export function hudDrawDigit(w, a) {             // 12:4AF6 HudDrawDigit
  clearMemory16(w, 0xD200, 2);
  renderCharToTiles(w, 0x30 + (a & 0x0F), 0xD200, 0, 0);
  queueVRAMCopy(w, 0xD200, 0xA3C0, 2);
}

function strokeTile(a) { return 0x5240 + ((a < 0x14 ? a - 0x0A : 9) << 4); }
function drawStrokeNumberAt10(w, a, de) {        // 12:4B2F DrawStrokeNumberAt10
  if (a < 0x0A) return renderCharToTiles(w, 0x30 + a, de, 0x00, 0x08);
  D.copyMemoryFast(w, strokeTile(a), (de + 0x10) & 0xFFFF, 1);
}
function drawStrokeNumber(w, a, de) {            // 12:4B60 DrawStrokeNumber
  if (a < 0x0A) return renderCharToTiles(w, 0x30 + a, de, 0x00, 0x00);
  D.copyMemoryFast(w, strokeTile(a), de, 1);
}

function drawPlayer(w, rec, vram, pal, buf, strokes) {   // 12:4B8A HudDrawPlayer1 / 12:4C18 HudDrawPlayer2
  const w0 = w.wram[0];
  inBank(w, B, () => {
    const ch = w0[rec];
    if (ch === 0xFF) {
      queueVRAMCopy(w, 0x56F0, vram, 4);
      clearMemory16(w, buf, 2);
      queueVRAMCopy(w, buf, (vram + 0x40) & 0xFFFF, 2);
      return;
    }
    const hl = (ch & 0x0F) << 3;
    queueVRAMCopy(w, 0x5730 + (hl << 3), vram, 4);
    loadPalettesImmediate(w, 0x5B30 + hl + (w0[rec + 9] & 0x10 ? 0x80 : 0), pal, 0x01);
    clearMemory16(w, buf, 2);
    drawStrokeNumberAt10(w, w0[strokes], buf);
    queueVRAMCopy(w, buf, (vram + 0x40) & 0xFFFF, 2);
  });
}
export function hudDrawPlayer1(w) { drawPlayer(w, 0x890, 0xA5C0, 0x0C, 0xD200, 0x8A0); }
export function hudDrawPlayer2(w) { drawPlayer(w, 0x8D0, 0xA6C0, 0x0D, 0xD220, 0x8E0); }

export function hudDistance(w) {                 // 12:4CA6 HudDistance
  bank6(w);
  r6(w)[0x322] = 0xFF;                           // wPinDistDirty
  hudDrawPinDistance(w);
}

export function hudDrawPinDistance(w) {          // 12:4CB1 HudDrawPinDistance
  inBank(w, B, () => {
    bank6(w);
    const r = r6(w);
    clearMemory16(w, 0xD200, 6);
    renderGlyphToTiles(w, 0x68A3, 0xD200, 0x00, 0x01);
    const hl = pinDist(ball(w));                 // 10:62AD PinDist
    if (r[0x329] === 0x0D && ((hl + 0xF7CB) & 0x8000)) {   // the putter, under $835: in feet
      if (r[0x322] === 1) return;
      if ((hl + 0xFF96) & 0x8000) {              // under $6A: feet and tenths
        const f = (hl * 3) & 0xFFFF, ft = sra5(f);
        renderGlyphToTiles(w, 0x6872, 0xD200, 0x09, 0x08);
        renderNumberToTiles(w, ft, 1, 0xD200, 0x03, 0x08);
        const tenths = sra5(g.mulHLByA((f - ((ft << 5) & 0xFFFF)) & 0xFFFF, 0x0A));
        renderNumberToTiles(w, tenths, 1, 0xD200, 0x0C, 0x08);
      } else {
        renderNumberToTiles(w, sra5((hl * 3 + 8) & 0xFFFF), 3, 0xD200, 0x00, 0x08);
      }
      renderGlyphToTiles(w, 0x6864, 0xD200, 0x12, 0x08);
      r[0x322] = 1;
    } else {
      if (!r[0x322]) return;
      renderNumberToTiles(w, srl5(hl), 3, 0xD200, 0x00, 0x08);
      renderGlyphToTiles(w, 0x6859, 0xD200, 0x13, 0x09);
      r[0x322] = 0;
    }
    queueVRAMCopy(w, 0xD200, 0xA720, 6);
  });
}

// ---- the shot length during the shot (12:4F07) ----
export function shotLengthTask(w) {              // 12:4F07 ShotLengthTask
  bank6(w);
  const r = r6(w);
  drawShotLength(w, shotLength(ball(w), r.subarray(0x5F8, 0x5FE)));   // 10:6276 ShotLength
}

function drawShotLength(w, hl) {                 // 12:4DE9 DrawShotLength
  bank6(w);
  if (r6(w)[0x329] !== 0x0D) {
    drawShotLengthNumber(w, srl5(hl), 0);
    queueShotLengthDigit(w, 0x0B, 0x12);
    return;
  }
  if ((hl + 0xFF96) & 0x8000) {
    const f = (hl * 3) & 0xFFFF, ft = sra5(f);
    queueShotLengthDigit(w, 0x0A, 0x09);
    queueShotLengthDigit(w, ft & 0xFF, 0x03);
    const tenths = sra5(g.mulHLByA((f - ((ft << 5) & 0xFFFF)) & 0xFFFF, 0x0A));
    queueShotLengthDigit(w, tenths & 0xFF, 0x0C);
    queueShotLengthDigit(w, 0x0C, 0x12);
    return;
  }
  drawShotLengthNumber(w, sra5((hl * 3 + 8) & 0xFFFF), 0);
  queueShotLengthDigit(w, 0x0C, 0x12);
}

function drawShotLengthNumber(w, hl, d) {        // 12:4EB1 DrawShotLengthNumber
  const t = formatDecimalNumber(hl, 3);
  if (t[0] !== 0x20) queueShotLengthDigit(w, (t[0] - 0x30) & 0xFF, d);
  d = (d + 6) & 0xFF;
  if (t[1] !== 0x20) queueShotLengthDigit(w, (t[1] - 0x30) & 0xFF, d);
  d = (d + 6) & 0xFF;
  queueShotLengthDigit(w, (t[2] - 0x30) & 0xFF, d);
}

function queueShotLengthDigit(w, a, d) {         // 12:4EEF QueueShotLengthDigit
  queueSprite(w, 0x74, (0x48 + d) & 0xFF, (2 * a + 0x10) & 0xFF, 0x08);
}

// ---- the countdown (wCountdownState $C0F4) ----
function drawCountdown(w) {                      // 12:4F24 DrawCountdown
  const w0 = w.wram[0];
  if (!w0[0x0F4]) return;
  if (!(w0[0x0F5] | w0[0x0F6]) && !(w.high[0x18C] & 0x10)) return;
  queueCountdownDigit(w, w0[0x0F7] & 0x0F, 0x00);
  queueCountdownDigit(w, 0x0D, 0x06);
  const t = formatDecimalNumber((w0[0x0F6] + 0x64) & 0xFF, 2);   // 12:4F8A DrawCountdownNumber (3 digits: the
  if (t[1] !== 0x20) queueCountdownDigit(w, (t[1] - 0x30) & 0xFF, 0x09);   // last two show)
  queueCountdownDigit(w, (t[2] - 0x30) & 0xFF, 0x0F);
}
function queueCountdownDigit(w, a, d) {          // 12:4FBA QueueCountdownDigit
  queueSprite(w, 0x0C, (4 + d) & 0xFF, (2 * a + 0x10) & 0xFF, 0x08);
}

// ---- the target marker and cursor tiles ----
function hudLoadMarkerTiles(w) {                 // 12:4FD2 HudLoadMarkerTiles
  queueVRAMCopy(w, 0x64C0, 0xA480, 8);
  queueVRAMCopy(w, 0x6540, 0xA780, 8);
  queueVRAMCopy(w, 0x65C0, 0xA300, 8);
}

function hudLoadCursorTiles(w) {                 // 12:4FF4 HudLoadCursorTiles
  queueVRAMCopy(w, 0x6480, 0xA3A0, 2);
  queueVRAMCopy(w, 0x6320, 0xA3E0, 2);
  const keep = w.high[0x196];
  D.setWramBank(w, 1);
  D.lzTo(w, B, 0x69C5, 0xD000);
  queueVRAMCopy(w, 0xD000, 0xA100, 0x1C);
  w.high[0x196] = keep;
}

export function blinkTargetMarker(w) {           // 12:502C BlinkTargetMarker
  inBank(w, B, () => {
    const r = r6(w);
    const e = r[0x36C];
    r[0x36C] = (e + 1) & 0xFF;
    if (e & 7) return;
    let hl;
    if (!r[0x36B]) hl = 0x6480 + ((e & 8) << 2);
    else if (e & 8) hl = 0x56F0;
    else hl = 0x6380 + rd(w, 0x506E + r[0x36B]);
    queueVRAMCopy(w, hl, 0xA3A0, 2);
  });
}
export function markerIconNormal(w) { inBank(w, B, () => queueVRAMCopy(w, 0x6320, 0xA3E0, 2)); }   // 12:507E
export function markerIconFrame(w, a) {          // 12:508A MarkerIconFrame
  inBank(w, B, () => queueVRAMCopy(w, 0x6340 + ((a & 1) << 5), 0xA3E0, 2));
}

function updateWindIndicator(w) {                // 12:50A0 UpdateWindIndicator
  const r = r6(w), w0 = w.wram[0];
  if (r[0x328] || !w0[0x815]) return;
  if (!r[0x326]) {
    const t = 0x5110 + ((w0[0x815] & 0x1E) << 1);
    r[0x326] = rd(w, t + 2);
    let p = hl16(w, t);
    w0[0xAB4] = rd(w, p); w0[0xAB5] = rd(w, p + 1); w0[0xAB6] = 0; w0[0xAB7] = 0;
    p = (p + 2 + ((r[0x327] & 0x0F) << 1)) & 0xFFFF;
    w0[0xAB0] = 0; w0[0xAB1] = 0; w0[0xAB2] = rd(w, p); w0[0xAB3] = rd(w, p + 1);
    w0[0xAB6] = 0; w0[0xAB7] = 0;
    loadPalettesImmediate(w, 0xCAB0, 0x09, 0x01);
    r[0x327] = (r[0x327] + 1) & 0xFF;
  }
  r[0x326] = (r[0x326] - 1) & 0xFF;
}

// ---- effect objects at $CA80 (the water splash) ----
export function waterSplashGfx(w) {              // 12:6A7F WaterSplashGfx
  inBank(w, B, () => {
    queueVRAMCopy(w, 0x6BB0, 0x8200, 0x10);
    loadPalettesImmediate(w, 0x6BA7, 0x0F, 0x01);
  });
}

export function waterSplashAt(w, hl, de) {       // 12:6A9C WaterSplashAt (hl = x, de = y)
  const r = r6(w);
  if (r[0x443] === 4) return;
  if (r[0x443]) {                                // 12:6AB8 ToGreenViewCoords
    hl = ((hl - (r[0x441] << 8)) << 2) & 0xFFFF;
    de = ((de - (r[0x442] << 8)) << 2) & 0xFFFF;
  }
  spawnEffectObject(w, 0, 0x6AAD, de, hl);
}

function spawnEffectObject(w, a, bc, de, hl) {   // 12:6ADC SpawnEffectObject
  const o = w.wram[0], p = 0xA80 + (a & 7) * 10;
  o[p] = bc & 0xFF; o[p + 1] = bc >> 8; o[p + 2] = 0; o[p + 3] = 0;
  o[p + 4] = (a << 4 | a >> 4) & 0xFF;
  o[p + 5] = hl & 0xFF; o[p + 6] = hl >> 8;      // (the pushes put x first: x at +5, y at +7)
  o[p + 7] = de & 0xFF; o[p + 8] = de >> 8;
}

function updateEffectObjectList(w) {             // 12:6B04 UpdateEffectObjectList
  bank6(w);
  updateEffectObject(w, 0xCA80);
}

function updateEffectObject(w, hl) {             // 12:6B11 UpdateEffectObject (10-byte objects)
  if (!(rd(w, hl) | rd(w, hl + 1))) return;
  const timer = hl + 3;
  if (!rd(w, timer)) {                           // the next (tile, frames) pair of its list
    const list = rd(w, hl) | rd(w, hl + 1) << 8, k = rd(w, hl + 2);
    wr(w, hl + 2, k + 1);
    const p = (list + 2 * k) & 0xFFFF;
    const t = rd(w, p);
    if (t === 0xFF) { wr(w, hl, 0); wr(w, hl + 1, 0); return; }
    wr(w, timer, rd(w, p + 1));
    wr(w, hl + 9, t);
  }
  wr(w, timer, rd(w, timer) - 1);
  if (rd(w, hl + 4)) return;
  const x = rd(w, hl + 5) | rd(w, hl + 6) << 8, y = rd(w, hl + 7) | rd(w, hl + 8) << 8, tile = rd(w, hl + 9);
  const w0 = w.wram[0];
  let a = (x - (w0[0x320] | w0[0x321] << 8) + 0x10) & 0xFFFF;
  if ((((a >> 8) + 1) & 0xFF) >= 0x14) return;
  const sx = ((a << 3) >> 8) & 0xFF;
  a = (y - (w0[0x322] | w0[0x323] << 8) + 0xFF10) & 0xFFFF;
  if ((a >> 8) >= 0x10) return;
  queueSprite(w, ((a << 3) >> 8) & 0xFF, sx, (tile + 0x20) & 0xFF, 0x07);
}
