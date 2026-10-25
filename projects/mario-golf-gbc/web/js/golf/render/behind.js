// The view behind the golfer (view 4), drawn by BuildBehindView 15:46AB: a perspective picture of the hole from
// $280 units behind the ball along the aim. Bank 15 projects the hole's objects (trees and the like: the WRAM4
// $DC00 list) and the flag into screen columns and depth rows; bank 16 renders the ground: 20 rows of 64 terrain
// samples (SampleViewRow 16:7B01), smoothed into sub-cells (16:5967) and drawn as 2bpp patterns by ground class
// (16:435F) into WRAM1 tiles; the course's scenery bank (4A-4F) draws the objects over them and adds the sky.
// Everything is written into the RAM and VRAM as the ROM does it, byte for byte.
import { rb } from "../rom.js";
import * as D from "./display.js";
import { rd, wr, setWramBank, inBank } from "./display.js";
import * as g from "../math.js";
import { registerFrameTask, unregisterFrameTask } from "../tasks.js";
import { holeAsset } from "./holeview.js";
import { formatDecimalNumber } from "./text.js";

const B15 = 0x15, B16 = 0x16;
const r16 = (b, a) => rb(b, a) | rb(b, (a + 1) & 0xFFFF) << 8;
const s16 = v => (v << 16 >> 16);

// ---- 15:4570 BehindViewSetup ----
function behindViewSetup(w) {
  const w0 = w.wram[0], r6 = w.wram[6];
  setWramBank(w, 6);
  const bc = (r6[0x418] & 0xF0) | r6[0x419] << 8;
  w0[0x3B0] = bc & 0xFF; w0[0x3B1] = bc >> 8;     // wViewAngle
  const back = (bc + 0x8000) & 0xFFFF;
  let hl = (g.mulSin(0x280, (back + 0x4000) & 0xFFFF) + (r6[0x401] | r6[0x402] << 8)) & 0xFFFF;   // 00:11C7 MulCos16
  w0[0x3A0] = hl & 0xFF; w0[0x3A1] = hl >> 8;     // wViewOrigin x
  let n = (-hl) & 0xFFFF;
  w0[0x3AC] = n & 0xFF; w0[0x3AD] = n >> 8;
  let q = (hl << 3);                             // add hl,hl x2, sla l / rl h / rla: bits 5-12 -> $C3A4, the carry -> $C3A5
  w0[0x3A5] = (q >> 16) & 1; w0[0x3A4] = (q >> 8) & 0xFF;
  hl = (g.mulSin(0x280, back) + (r6[0x404] | r6[0x405] << 8)) & 0xFFFF;   // 00:11CB MulSin
  w0[0x3A2] = hl & 0xFF; w0[0x3A3] = hl >> 8;
  n = (-hl) & 0xFFFF;
  w0[0x3AE] = n & 0xFF; w0[0x3AF] = n >> 8;
  q = (hl << 3);
  w0[0x3A7] = (q >> 16) & 1; w0[0x3A6] = (q >> 8) & 0xFF;
  w0[0x3A8] = r6[0x43D]; w0[0x3A9] = r6[0x43E];   // wViewCup
  w0[0x3AA] = r6[0x43F]; w0[0x3AB] = r6[0x440];
  w0[0x3B8] = r6[0x402];
  const d = ((r6[0x401] | r6[0x402] << 8) << 2) >> 8 & 0xFF;
  w0[0x3B9] = r6[0x405];
  const e = ((r6[0x404] | r6[0x405] << 8) << 2) >> 8 & 0xFF;
  w0[0x3B7] = terrainAtCell(w, d, e);            // 15:4F9A
}

// 15:4F9A TerrainAtCell: d, e = x, y in quarter tiles: the terrain nibble through the tile map (WRAM3), the flips
// (WRAM2) and the terrain table (WRAM6 $D800); leaves WRAM bank 6
export function terrainAtCell(w, d, e) {
  const cell = 0xD000 + ((e & 0xFC) << 4) + (d >> 2);
  setWramBank(w, 2);
  const attr = rd(w, cell);
  let c = attr & 0x20 ? ~d & 0xFF : d;
  const xbit = (c >> 1) & 1;                     // (rrca x2: the carry is bit 1)
  let a = attr & 0x40 ? ~e & 0xFF : e;
  const idx = ((a << 1) | xbit) & 7;
  setWramBank(w, 3);
  const tile = rd(w, cell);
  setWramBank(w, 6);
  let v = rd(w, 0xD800 + tile * 8 + idx);
  if (!(c & 1)) v = (v >> 4) | ((v & 0x0F) << 4);
  return v & 0x0F;
}

// ---- 00:0A7B AngleFromVectorCoarse: an 8-bit angle from x = hl, y = de by a tangent table (00:0AE1) ----
function angleFromVectorCoarse(hl, de) {
  let c;
  if (!hl) c = 0;
  else if (!de) c = 0x10;
  else {
    let ax = g.abs16(hl), ay = g.abs16(de);
    if ((ax >> 8) >= 0x10) { ay = (s16(ay) >> 2) & 0xFFFF; ax = (ax << 2) & 0xFFFF; }
    else ax = (ax << 4) & 0xFFFF;
    const qv = g.divHLByDE(ax, ay);
    if (qv >> 8) c = 0x0F;
    else {
      const b = qv & 0xFF;
      let p = 0x0AE1;
      c = 0xFF;
      for (;;) {
        c = (c + 1) & 0xFF;
        const t = rb(0, p++);
        if (t === 0xFF || t >= b) break;
      }
    }
  }
  let a = (c * 4) & 0xFF;
  if (de & 0x8000) a = (0x80 - a) & 0xFF;
  if (hl & 0x8000) a = (-a) & 0xFF;
  return a;
}

const squareOfByte = a => r16(0, 0x0FAA + 2 * a);   // 00:0EE8 GetSquareOfByte (table 00:0FAA)

// 15:47BD ProjectViewObjects: the WRAM4 $DC00 list ([type, ?, x, y] ... $FF) -> 6-byte records at WRAM1 $DA00
function projectViewObjects(w) {
  const w0 = w.wram[0], keep = w.high[0x196];
  setWramBank(w, 4);
  let hl = 0xDC00, bc = 0xDA00;
  w0[0x477] = 0;
  for (;;) {
    const t = rd(w, hl++);
    if (t === 0xFF) break;
    w0[0x470] = t;
    w0[0x475] = rd(w, hl++);
    const d = rd(w, hl++), e = rd(w, hl++);
    if (w0[0x3B8] === d && w0[0x3B9] === e) continue;   // the ball's own tile
    const y = (e << 8 | 0x70) + (w0[0x3AE] | w0[0x3AF] << 8) & 0xFFFF;   // object - view origin
    const x = (d << 8 | 0x70) + (w0[0x3AC] | w0[0x3AD] << 8) & 0xFFFF;
    const half = v => { let s = (s16(v) >> 5) & 0xFFFF; if (s & 0x8000) s = (-s) & 0xFFFF; return s; };
    const ay = half(y);
    if (ay >> 8) continue;
    const sq1 = squareOfByte((ay >> 1) & 0xFF);
    const ax = half(x);
    if (ax >> 8) continue;
    const dist = (squareOfByte((ax >> 1) & 0xFF) + sq1) & 0xFFFF;
    w0[0x473] = dist & 0xFF; w0[0x474] = dist >> 8;
    const a = angleFromVectorCoarse(y, x);       // (hl = y, de = x)
    if ((((-w0[0x3B1]) & 0xFF) + a + 0x0C & 0xFF) >= 0x18) continue;
    const ang = (g.angleFromVector16(y, x) - (w0[0x3B0] | w0[0x3B1] << 8)) & 0xFFFF;
    w0[0x471] = ang & 0xFF; w0[0x472] = ang >> 8;
    if (((ang >> 8) + 0x0A & 0xFF) >= 0x14) continue;
    setWramBank(w, 1);
    for (let k = 0; k < 6; k++) wr(w, bc++, w0[0x470 + k]);
    setWramBank(w, 4);
    w0[0x477] = (w0[0x477] + 1) & 0xFF;
    if (w0[0x477] >= 0x55 && w.onSound) w.onSound(0x23);   // the list is full (it goes on)
  }
  setWramBank(w, 1);
  wr(w, bc, 0xFF);
  w.high[0x196] = keep;
}

// the address after the first entry of a word table (15:48E7 / 15:490F / 15:4BF2) not below v (with inc added)
function scanBelow(t, v, inc = 0) {              // loop: hl = [t]; (hl + inc) - v borrows -> next
  let p = t;
  for (;;) {
    const x = (r16(B15, p) + inc) & 0xFFFF;
    p += 2;
    if (x < v) continue;
    return p;
  }
}

function objectsToScreen(w) {                    // 15:498F ObjectsToScreen
  let hl = 0xDA00;
  for (;;) {
    if (rd(w, hl) === 0xFF) return;
    const ang = (rd(w, hl + 1) | ((rd(w, hl + 2) + 0x20) & 0xFF) << 8);
    const pc = scanBelow(0x48E7, ang);
    const col = ((((pc - 0x48E7) & 0xFFFF) & 0xFF) >> 1) - 1 & 0xFF;
    const dist = rd(w, hl + 3) | rd(w, hl + 4) << 8;
    const pd = scanBelow(0x490F, dist, 1);
    let e = (((((pd - 0x490F) & 0xFFFF) & 0xFF) >> 1) - 1) & 0xFF;
    e = (0x3F - e) & 0xFF;
    wr(w, hl + 1, col); wr(w, hl + 2, e);
    hl += 6;
  }
}

function sortObjectsByColumn(w) {                // 15:49F7 SortObjectsByColumn (15:4A47 ObjectsOfColumn x 20)
  let bc = 0xDB00;
  for (let d = 0; d < 20; d++) {
    for (const want of [t => t === 2 || t === 3, t => t === 1]) {
      let e = 0, best = null;
      for (let hl = 0xDA00; rd(w, hl) !== 0xFF; hl += 6) {
        const t = rd(w, hl);
        if (!want(t) || rd(w, hl + 1) !== d) continue;
        const depth = rd(w, hl + 2);
        if (depth >= 0x3F || depth < e) continue;
        e = depth; best = [t, rd(w, hl + 1)];
      }
      if (best) { wr(w, bc++, best[0]); wr(w, bc++, best[1]); wr(w, bc++, e); }
    }
  }
  wr(w, bc, 0xFF);
  D.copyMemoryFast(w, 0xDB00, 0xDA00, 8);
}

function sortObjectsByDepth(w) {                 // 15:4AC7 SortObjectsByDepth: insertion by the depth byte
  wr(w, 0xDB00, 0xFF);
  for (let de = 0xDA00; rd(w, de) !== 0xFF; de += 3) {
    let rec = [rd(w, de), rd(w, de + 1), rd(w, de + 2)];
    let hl = 0xDB00;
    for (;;) {
      if (rd(w, hl) === 0xFF) {
        wr(w, hl, rec[0]); wr(w, hl + 1, rec[1]); wr(w, hl + 2, rec[2]); wr(w, hl + 3, 0xFF);
        break;
      }
      if (rec[2] < rd(w, hl + 2)) {              // swap the record in and carry the old one on
        const old = [rd(w, hl), rd(w, hl + 1), rd(w, hl + 2)];
        wr(w, hl, rec[0]); wr(w, hl + 1, rec[1]); wr(w, hl + 2, rec[2]);
        rec = old;
      }
      hl += 3;
    }
    wr(w, de, rec[0]); wr(w, de + 1, rec[1]); wr(w, de + 2, rec[2]);   // (the record it carried, written back)
  }
  D.copyMemoryFast(w, 0xDB00, 0xDA00, 8);
}

// ---- the flag ----
function printDecimalWord(w, hl, d, e) {         // 00:2303 PrintDecimalWord -> the debug text buffer $CC00 (00:20B1)
  const text = formatDecimalNumber(hl, 6);
  let p = 0xCC00 + d + e * 32;
  for (const ch of text) {
    if (!ch) break;
    wr(w, p, ch);
    p++;
    if (!(p & 0x1F)) p -= 0x20;
  }
  w.high[0x18E] = 1;
}

function projectFlag(w) {                        // 15:4B18 ProjectFlag
  const w0 = w.wram[0];
  w0[0x470] = 0;
  const de = ((w0[0x3A8] | w0[0x3A9] << 8) + (w0[0x3AC] | w0[0x3AD] << 8)) & 0xFFFF;   // cup x - origin x
  const bc = ((w0[0x3AA] | w0[0x3AB] << 8) + (w0[0x3AE] | w0[0x3AF] << 8)) & 0xFFFF;   // cup y - origin y
  const half = v => { let s = (s16(v) >> 5) & 0xFFFF; if (s & 0x8000) s = (-s) & 0xFFFF; return s; };
  const a1 = half(bc);
  if (a1 >> 8) return;
  const t = (a1 >> 1) & 0xFF;
  const sq = g.mulHLByA(t, t);
  const a2 = half(de);
  if (a2 >> 8) return;
  const t2 = (a2 >> 1) & 0xFF;
  const dist = (g.mulHLByA(t2, t2) + sq) & 0xFFFF;
  w0[0x473] = dist & 0xFF; w0[0x474] = dist >> 8;
  const ang = g.angleFromVector16(bc, de);
  printDecimalWord(w, ang, 0x02, 0x0A);          // (a debug leftover: the angle and the view angle)
  const va = w0[0x3B0] | w0[0x3B1] << 8;
  printDecimalWord(w, va, 0x02, 0x0B);
  const rel = (ang - va) & 0xFFFF;
  w0[0x471] = rel & 0xFF; w0[0x472] = rel >> 8;
  if (((rel >> 8) + 0x0A & 0xFF) < 0x14) w0[0x470] = 1;
}

function flagToScreen(w) {                       // 15:4D32 FlagToScreen
  const w0 = w.wram[0];
  if (!w0[0x470]) return;
  const ang = w0[0x471] | ((w0[0x472] + 0x20) & 0xFF) << 8;
  const pc = scanBelow(0x4BF2, ang);
  const c = ((((pc - 0x4BF2) & 0xFFFF) >> 1) - 1) & 0xFF;
  const dist = w0[0x473] | w0[0x474] << 8;
  const pd = scanBelow(0x490F, dist);
  let e = (((((pd - 0x490F) & 0xFFFF) & 0xFF) >> 1) - 1) & 0xFF;
  e = (0x3F - e) & 0xFF;
  w0[0x471] = c; w0[0x472] = e;
}

function flagOcclusion(w) {                      // 15:4D96 FlagOcclusion
  const w0 = w.wram[0];
  const col = ((((w0[0x471] + 1) & 0xFF) >> 3) | (((w0[0x471] + 1) & 0xFF) << 5)) & 0x1F;
  for (let hl = 0xDA00; ;) {
    const t = rd(w, hl);
    if (t === 0xFF) return;
    const b = rd(w, hl + 1), c = rd(w, hl + 2);
    hl += 3;
    if (t === 1 || col !== b) continue;
    if (w0[0x472] < c) w0[0x470] = 0;
    return;
  }
}

function placeFlagSprite(w) {                    // 15:4DC1 PlaceFlagSprite
  const w0 = w.wram[0];
  w0[0x3B2] = 0xFF;
  projectFlag(w);
  flagToScreen(w);
  flagOcclusion(w);
  if (!w0[0x470]) return;
  w0[0x3B4] = w0[0x471];
  w0[0x3B5] = (w0[0x472] + 0x40) & 0xFF;
  const row = ((w0[0x472] >> 3) | (w0[0x472] << 5)) & 0x1F;
  if (row) w0[0x3B2] = row;
}

export function drawFlagSprite(w) {              // 15:4DEC DrawFlagSprite (BehindViewTask 15:47AD)
  const w0 = w.wram[0];
  const row = w0[0x3B2];
  if (row === 0xFF) return;
  const p = 0x4E65 + (((row - 1) * 4) & 0xFF);
  D.queueSpriteTemplate(w, r16(B15, p + 2), w0[0x3B5], w0[0x3B4], rb(B15, p), 0x00, a => rb(B15, a));
}

// ---- bank 16: the ground ----
function loadTerrainClassTable(w) {              // 16:4004 LoadTerrainClassTable: 16 bytes 16:4010 -> $C400
  for (let k = 0; k < 16; k++) w.wram[0][0x400 + k] = rb(B16, 0x4010 + k);
}

// 16:7A65: the step to sample k at the 8-bit angle e: [bc = dx, de = dy] from the table at 16:5A65
function sampleStep(k, e) {
  const rd16t = a => rb(B16, a);
  const rra = (a, d) => ((d & 1) << 7) | (a >> 1);
  const neg = v => (-v) & 0xFFFF;
  const a2 = (e << 1) & 0xFF, a3 = (e << 2) & 0xFF;
  if (!(e & 0x80)) {
    if (!(e & 0x40)) {                           // $00-$3F
      const p = 0x5A65 + ((k >> 1) << 8 | rra(a3, k));
      return [rd16t(p), rd16t(p + 1)];
    }
    if (!a3) {                                   // $40
      const p = 0x5A65 + ((k >> 1) << 8 | rra(0, k));
      return [0, rd16t(p)];
    }
    const p = 0x5A67 + ((k >> 1) << 8 | rra(~a3 & 0xFF, k));   // $41-$7F
    return [neg(rd16t(p - 1)), rd16t(p)];
  }
  if (!(e & 0x40)) {                             // $80-$BF
    const p = 0x5A65 + ((k >> 1) << 8 | rra(a3, k));
    return [neg(rd16t(p)), neg(rd16t(p + 1))];
  }
  if (!a3) {                                     // $C0
    const p = 0x5A65 + ((k >> 1) << 8 | rra(0, k));
    return [0, neg(rd16t(p))];
  }
  const p = 0x5A66 + ((k >> 1) << 8 | rra(~a3 & 0xFF, k));     // $C1-$FF
  return [rd16t(p), neg(rd16t(p + 1))];
}

// 16:7B01 SampleViewRow: 64 terrain types along the view ray of this row (offset 16:7AD9) to hl (WRAM1)
function sampleViewRow(w, row, out) {
  const w0 = w.wram[0];
  const off = r16(B16, 0x7AD9 + 2 * row);
  const e = (((w0[0x3B0] | w0[0x3B1] << 8) + off) & 0xFFFF) >> 8;
  const ox = w0[0x3A4] | w0[0x3A5] << 8, oy = w0[0x3A6] | w0[0x3A7] << 8;
  for (let k = 0x3F; k >= 0; k--) {
    const [bc, de] = sampleStep(k, e);
    let v = 7;
    const x = (ox + bc) & 0xFFFF;
    if (!(s16(x) >> 1 >> 8 & 0xFF)) {            // sra h: inside the map when it leaves 0
      const y = (oy + de) & 0xFFFF;
      if (!(s16(y) >> 1 >> 8 & 0xFF)) v = terrainAtCell(w, (x >> 1) & 0xFF, (y >> 1) & 0xFF);
    }
    setWramBank(w, 1);
    wr(w, out++, v);
  }
}

function translateRow(w, hl) {                   // 16:4020 TranslateRowByC4Table
  for (let k = 0; k < 64; k++) wr(w, hl + k, w.wram[0][0x400 + rd(w, hl + k)]);
}

// 16:5967 SmoothGroundRow: the middle row ($DB80; $DB40 above, $DBC0 below) -> $DC00: a cell whose
// neighbours mostly match is 1 byte (class | $80), else 4 sub-cells taking neighbours' classes at its corners
function smoothGroundRow(w) {
  const w0 = w.wram[0];
  let out = 0xDC00;
  for (let de = 0xDB80; de < 0xDBC0; de++) {
    const c = rd(w, de);
    let b = 0;
    const left = w0[0x473] = rd(w, de - 1);
    if (left === c) b = (b + 1) | 0x80;
    const right = w0[0x471] = rd(w, de + 1);
    if (right === c) b = (b + 1) | 0x20;
    const up = w0[0x472] = rd(w, de - 0x40);
    let pure = false;
    if (up === c) { if (b === 0xA2) pure = true; else b = (b + 1) | 0x40; }
    let down = 0;
    if (!pure) { down = w0[0x470] = rd(w, de + 0x40); if (down === c) b = (b + 1) | 0x10; }
    let cells = null;
    if (!pure && (b & 0x0F) < 3) {
      const n = b & 0x0F, m = b >> 4;
      if (n === 0) cells = [up, left, right, down];
      else if (n === 1) cells = { 1: [right, left, c, c], 2: [up, c, c, down], 4: [c, c, left, right], 8: [up, c, c, down] }[m] || null;
      else cells = { 3: [left, c, c, c], 6: [c, c, c, left], 0x0C: [c, c, c, right], 9: [right, c, c, c] }[m] || null;
    }
    if (cells) for (const v of cells) wr(w, out++, v);
    else wr(w, out++, c | 0x80);
  }
}

// 16:427B CountGroundClasses / 16:432A DominantGroundClass: 8 cells from hl; returns [class, hl]
function dominantGroundClass(w, hl) {
  let b = 0x80, c = 0x80, d = 0x80, e = 0x80;
  const sub = v => {                             // one sub-cell (16:42D6)
    if (v < 3) return;
    if (v === 3) b++;
    else if (v === 6) c--;
    else if (v === 5) { c++; d++; }
    else if (v === 4) { c++; e++; }
  };
  for (let n = 0; n < 8; n++) {
    const v = rd(w, hl++);
    if (v & 0x80) {
      const k = v & 0x7F;
      if (k === 3) b += 4;
      else if (k === 6) c -= 4;
      else if (k === 5) { c += 4; d += 4; }
      else if (k === 4) { c += 4; e += 4; }
    } else {
      sub(v); sub(rd(w, hl++)); sub(rd(w, hl++)); sub(rd(w, hl++));
    }
    b &= 0xFF; c &= 0xFF; d &= 0xFF; e &= 0xFF;
  }
  let a = c, cls = 4;
  if (a < d) { a = d; cls = 5; }
  if (a < e) { a = e; cls = 6; }
  if (a < b) { a = b; cls = 3; }
  return [cls, hl];
}

// 16:435F DrawGroundColumn: 8 cells of class pair (16:4351 by the column's class) as 2bpp rows to de
function drawGroundColumn(w, cls, col, de) {
  const w0 = w.wram[0];
  w0[0x47D] = (cls * 2) & 0xFF;
  w0[0x47C] = ((((w0[0x47E] & 3) << 6) | ((w0[0x47E] & 3) >> 2)) + col) & 0xFF;
  const pc = rb(B16, 0x4351 + cls * 2), pb = rb(B16, 0x4352 + cls * 2);
  const tableC = w.wram[0][0x836] === 3 ? 0x4767 : 0x4567;
  const pat = (base, withClass) => {
    const i = withClass ? ((w0[0x47D] << 8 | w0[0x47C]) * 2) & 0xFFFF : w0[0x47C] * 2;
    return [rb(B16, (base + i) & 0xFFFF), rb(B16, (base + i + 1) & 0xFFFF)];
  };
  for (let n = 0; n < 8; n++) {
    let src = w0[0x486] | w0[0x487] << 8;
    const v = rd(w, src);
    if (v & 0x80) {
      const k = v & 0x7F;
      const two = k === pc ? pat(0x3D67, true) : k === pb ? pat(0x3F67, true) : k === 0x0F ? [0xFF, 0xFF] : pat(tableC, false);
      wr(w, de, two[0]); wr(w, (de & 0xFF00) | ((de + 1) & 0xFF), two[1]);
      de = ((de & 0xFF00) | ((de + 1) & 0xFF)) + 1 & 0xFFFF;
      w0[0x47C] = (w0[0x47C] + 1) & 0xFF;
      src = (src + 1) & 0xFFFF;
      w0[0x486] = src & 0xFF; w0[0x487] = src >> 8;
      continue;
    }
    const A = pat(0x3D67, true), Bp = pat(0x3F67, true), C = pat(tableC, false);
    w0[0x480] = A[0]; w0[0x481] = A[1]; w0[0x482] = Bp[0]; w0[0x483] = Bp[1]; w0[0x484] = C[0]; w0[0x485] = C[1];
    w0[0x47C] = (w0[0x47C] + 1) & 0xFF;
    let hi = 0, lo = 0;
    for (const m of [0xC0, 0x30, 0x0C, 0x03]) {
      const k = rd(w, src++);
      if (k === pc) { hi |= A[0] & m; lo |= A[1] & m; }
      else if (k === pb) { hi |= Bp[0] & m; lo |= Bp[1] & m; }
      else if (k === 0x0F) { hi |= m; lo |= m; }
      else { hi |= C[0] & m; lo |= C[1] & m; }
    }
    src &= 0xFFFF;
    w0[0x486] = src & 0xFF; w0[0x487] = src >> 8;
    wr(w, de, hi); wr(w, de + 1, lo);
    de = (de + 2) & 0xFFFF;
  }
  return de;
}

function groundRowDraw(w, de, bc) {              // 16:41E3 GroundRowDraw
  const w0 = w.wram[0];
  smoothGroundRow(w);
  let hl = 0xDC00;
  for (let k = 0; k < 8; k++) {
    let cls;
    [cls, hl] = dominantGroundClass(w, hl);
    wr(w, bc, cls + 8);
    bc = (bc + 0x20) & 0xFFFF;
    w0[0x470 + k] = cls;
  }
  w0[0x486] = 0x00; w0[0x487] = 0xDC;            // wGroundSrc
  for (let k = 0; k < 8; k++) de = drawGroundColumn(w, w0[0x470 + k], k * 8, de);
}

export function renderBehindViewGround(w) {      // 16:4058 RenderBehindViewGround: 20 rows into WRAM1 $D000-$D9FF
  const w0 = w.wram[0];
  const keep = () => D.copyMemoryFast(w, 0xDB80, 0xDB40, 8);   // 16:41BE GroundRowKeepPrev
  const sample = row => { sampleViewRow(w, row, 0xDBC0); translateRow(w, 0xDBC0); };   // 16:41D2
  w0[0x47E] = 0xFF;
  sample(0);                                     // 16:41A9 GroundRowFirst
  for (let r = 1; r <= 0x13; r++) {              // 16:41AD GroundRowNext
    w0[0x47E] = r - 1;
    keep(); sample(r);
    groundRowDraw(w, 0xCF80 + 0x80 * r, 0xDF00 + r - 1);
  }
  w0[0x47E] = 0x13;
  keep();                                        // 16:41B7 GroundRowLast
  groundRowDraw(w, 0xD980, 0xDF13);
}

// ---- the course's scenery (banks 4A-4F export 0, the same code at other addresses; its operands are read) ----
const SCENERY_BY_COURSE = 0x463F;
function sceneryBank(w) {                        // 15:462D DrawBehindViewScenery
  const w0 = w.wram[0];
  let fn = r16(B15, SCENERY_BY_COURSE + 2 * (w0[0x836] & 0x0F));
  if (fn === 0x4697) fn = r16(B15, 0x465F + 2 * ((w0[0x837] - 7) & 0x0F));   // 15:4697 course 7 by hole
  return rb(B15, fn + 2);                        // the farcall's bank byte (rst $18 ; db idx, bank)
}

function composeObjectPicture(w, bank) {         // 4x:export 0 ComposeObjectPicture
  const E = r16(bank, 0x4000);
  const op = a => r16(bank, a);
  const list1 = op(E + 3), list23 = op(E + 6), lz = op(E + 0x23), overlay23 = op(E + 0x2C), pals = op(E + 0x2F);
  inBank(w, bank, () => {
    drawObjectList1(w, bank, list1);
    drawObjectList23(w, bank, list23);
    w.lcd.vbk = 1;
    D.startVRAMDMAFromHL(w, 0xD000, 0x9000, 0x80);
    D.startVRAMDMAFromHL(w, 0xD800, 0x8800, 0x20);
    D.lzTo(w, bank, lz, 0xD000);
    drawObjectOverlay23(w, bank, overlay23);
    D.loadPalettesMasterOnly(w, pals, 0x02, 0x05);
  });
}

function blitRow(w, bank, de, hl, masked) {      // BlitRowOpaque03 / BlitRowMasked: one 2bpp row through a mask
  const c = rb(bank, de), b = rb(bank, de + 1);
  let m, keep;
  if (masked) { m = (b | c) & 0xFF; keep = ~m & 0xFF; } else { keep = (b ^ c) & 0xFF; m = ~keep & 0xFF; }
  wr(w, hl, (rd(w, hl) & keep) | (m & c));
  wr(w, hl + 1, (rd(w, hl + 1) & keep) | (m & b));
  return [de + 2, hl + 2];
}

function drawObjectList23(w, bank, L) {          // DrawObjectList23 (4F:567D): type 2/3 objects at depth > 0
  const fn = r16(bank, L + 0x24);                // its call to DrawObject23
  for (let hl = 0xDA00; ;) {
    const t = rd(w, hl);
    if (t === 0xFF) return;
    const d = rd(w, hl + 1), c = rd(w, hl + 2);
    hl += 3;
    if ((t === 3 || t === 2) && c) drawObject23(w, bank, fn, ((c >> 3) | (c << 5)) & 7, d, 0, c);
  }
}

function drawObject23(w, bank, F, a, d, e, c) {  // DrawObject23 (4F:56A7): shape a at column d, row c
  const shapes = r16(bank, F + 4), tiles = r16(bank, F + 0x31);
  let p = (shapes + ((a * 8) & 0xFF)) & 0xFFFF;
  d = (rb(bank, p) + d) & 0xFF;
  let b = (rb(bank, p + 1) + e) & 0xFF;
  e = rb(bank, p + 2);
  let hl = r16(bank, p + 4);
  for (;;) {
    let dd = d, ee = e, h2 = hl;
    for (;;) {
      const t = rb(bank, h2);
      if (t && !(dd & 0x80) && dd < 0x14) {
        let de = (tiles + t * 16) & 0xFFFF;
        let dst = (0xD000 + ((((dd * 8) & 0xFF) + b) & 0xFF) * 16) & 0xFFFF;
        let n = Math.min(c, 8);
        for (; n; n--) [de, dst] = blitRow(w, bank, de, dst, false);
      }
      h2++; dd = (dd + 1) & 0xFF; ee = (ee - 1) & 0xFF;
      if (!ee) break;
    }
    hl = h2;
    b = (b + 1) & 0xFF;
    const cc = c - 8;
    if (cc <= 0) return;
    c = cc;
  }
}

function drawObjectList1(w, bank, L) {           // DrawObjectList1 (4F:5752): type 1 objects of kinds 1-6
  const fn = r16(bank, L + 0x21);
  for (let hl = 0xDA00; ;) {
    const t = rd(w, hl);
    if (t === 0xFF) break;
    const d = rd(w, hl + 1), b = rd(w, hl + 2);
    hl += 3;
    if (t !== 1) continue;
    const k = ((b >> 3) | (b << 5)) & 7;
    if (!k || k === 7) continue;
    drawObject1(w, bank, fn, k, d, b);
  }
  if (w.wram[0][0x3B7] === 0x0C) drawObject1(w, bank, fn, 7, 0x0A, 0x3F);   // the ball's own spot (terrain $0C)
}

function drawObject1(w, bank, F, a, d, e) {      // DrawObject1 (4F:5789)
  const shapes = r16(bank, F + 4), tiles = r16(bank, F + 0x32);
  const p = (shapes + ((a * 8) & 0xFF)) & 0xFFFF;
  d = (rb(bank, p) + d) & 0xFF;
  let b = (rb(bank, p + 1) + e) & 0xFF;
  e = rb(bank, p + 2);
  let c = rb(bank, p + 3);
  let hl = r16(bank, p + 4);
  for (;;) {
    let dd = d, ee = e, h2 = hl;
    for (;;) {
      const t = rb(bank, h2);
      if (t && !(dd & 0x80) && dd < 0x14) {
        let de = (tiles + t * 16) & 0xFFFF;
        let dst = (0xD000 + (dd << 7) + ((b * 2) & 0xFF)) & 0xFFFF;
        for (let n = 0; n < 8; n++) [de, dst] = blitRow(w, bank, de, dst, false);
      }
      h2++; dd = (dd + 1) & 0xFF; ee = (ee - 1) & 0xFF;
      if (!ee) break;
    }
    hl = h2;
    b = (b + 8) & 0xFF;
    c = (c - 1) & 0xFF;
    if (!c) return;
  }
}

function drawObjectOverlay23(w, bank, L) {       // DrawObjectOverlay23 (4F:6089)
  const fn = r16(bank, L + 0x20);
  for (let hl = 0xDA00; ;) {
    const t = rd(w, hl);
    if (t === 0xFF) return;
    const d = rd(w, hl + 1), b = rd(w, hl + 2);
    hl += 3;
    if (t === 3 || t === 2) drawObjectOverlay(w, bank, fn, ((b >> 3) | (b << 5)) & 7, d, 7, b);
  }
}

function drawObjectOverlay(w, bank, F, a, d, e, b0) {   // DrawObjectOverlay (4F:60AF): masked
  const shapes = r16(bank, F + 4), tiles = r16(bank, F + 0x32);
  const p = (shapes + ((a * 8) & 0xFF)) & 0xFFFF;
  d = (rb(bank, p) + d) & 0xFF;
  let b = (rb(bank, p + 1) + e) & 0xFF;
  e = rb(bank, p + 2);
  let c = rb(bank, p + 3);
  let hl = r16(bank, p + 4);
  for (;;) {
    let dd = d, ee = e, h2 = hl;
    for (;;) {
      const t = rb(bank, h2);
      if (t && !(dd & 0x80) && dd < 0x14) {
        let de = (tiles + t * 16) & 0xFFFF;
        let dst = (0xD000 + ((((dd * 8) & 0xFF) + b) & 0xFF) * 16) & 0xFFFF;
        for (let n = 0; n < 8; n++) [de, dst] = blitRow(w, bank, de, dst, true);
      }
      h2++; dd = (dd + 1) & 0xFF; ee = (ee - 1) & 0xFF;
      if (!ee) break;
    }
    hl = h2;
    b = (b + 1) & 0xFF;
    c = (c - 1) & 0xFF;
    if (!c) return;
  }
}

// ---- 15:46AB BuildBehindView, in the parts between its frames (the caller runs the frames) ----
export function buildPart1(w) {                  // 15:46E0-15:46FD: the projection and the ground
  behindViewSetup(w);
  setWramBank(w, 1);
  loadTerrainClassTable(w);                      // 16:4004
  projectViewObjects(w);                         // 15:47BD
  objectsToScreen(w);                            // 15:498F
  sortObjectsByColumn(w);                        // 15:49F7
  sortObjectsByDepth(w);                         // 15:4AC7
  placeFlagSprite(w);                            // 15:4DC1
  renderBehindViewGround(w);                     // 16:4058
}

export function buildPart2(w) {                  // 15:4701-15:4777: the maps, the scenery, VRAM, the scroll
  D.disableLCDSafely(w);
  D.copyMemoryFast(w, 0x410A, 0xDE00, 0x10);     // attributes (15:410A)
  for (let k = 0; k < 256; k++) wr(w, 0xDC00 + k, (rb(B15, 0x400A + k) + 0x40) & 0xFF);   // tile numbers + $40
  D.copyMemoryFast(w, 0x4470, 0xDD00, 0x10);
  composeObjectPicture(w, sceneryBank(w));       // 15:462D DrawBehindViewScenery
  w.lcd.vbk = 1;
  D.startVRAMDMAFromHL(w, 0xDE00, 0x9800, 0x20);
  w.lcd.vbk = 0;
  D.startVRAMDMAFromHL(w, 0xD000, 0x9400, 0x40);
  D.startVRAMDMAFromHL(w, 0xD400, 0x8800, 0x60);
  w.lcd.vbk = 0;
  D.startVRAMDMAFromHL(w, 0xDC00, 0x9800, 0x20);
  w.lcd.vbk = 0;
  D.startVRAMDMAFromHL(w, 0x4210, 0x8400, 0x28);
  w.high[0x18B] = w.high[0x18A] = 0;
}

export function buildPart3(w) {                  // 15:4787-15:479B: the slope map of the course view back in WRAM1
  setWramBank(w, 1);
  D.farDispatchIndexed(w, holeAsset(w, 0), 4, 0xD800);
}
