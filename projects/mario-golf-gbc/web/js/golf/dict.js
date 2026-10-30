// The golf dictionary (bank 3F; GolfDictionary 3F:4002): reached from Options' first item (mode 6: the whole
// dictionary, from the A-Z index) and from the Marion office's tutors (map $08, 33:4DFF: modes 0-4 one category, 5
// all of them with the category named instead of the explanation). DictEntryTable 3F:5DFC has a byte per entry, its
// category bit (1 terms, 2 rules, 4 equipment, 8 techniques, $10 facilities), $00 between first letters, $40 at the
// end (and $40 just before it at 3F:5DFB, which the backward scans stop at). The entry names are texts $1A2B + n, the
// explanations $1AE7 + n, the category hints $1A1E + c. Two pages side by side in a 64-wide map: the A-Z index (view
// column $21) and the list of six names (column $0D), with a host whose face is animated by DictFrameTask 3F:58DD.
// The table scans are ported as the ROM runs them (8-bit counters, the pointer over the ROM bytes), quirks included:
// DictFindLetterStart takes a non-matching entry for a letter break (only mode 6, every entry matching, is exact).
import { rb } from "./rom.js";
import * as D from "./render/display.js";
import * as Scr from "./screen.js";
import * as T from "./text.js";
import * as W from "./windows.js";
import { clearFrameTasks, registerFrameTask, unregisterFrameTask } from "./tasks.js";
import { decompressDataFromBank } from "./mapgfx.js";
import { mapDrawFullScreen } from "./scorecard.js";
import { mapScrollTask } from "./render/holeview.js";
import { initWindowSystem } from "./standings.js";
import { restoreShadowFromMap } from "./shadow.js";
import { openMessageWindow, refreshWindowText, restoreMapUnderWindow, removeWindow } from "./msgbox.js";

const B = 0x3F;
const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
const R = a => rb(B, a & 0xFFFF);
const TABLE = 0x5DFC;                            // DictEntryTable
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}
const flag = (w, n) => w.wram[0][0x840 + (n >> 3)] & (0x80 >> (n & 7));
const setFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] |= 0x80 >> (n & 7); };
const clearFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] &= ~(0x80 >> (n & 7)); };
// WRAM6 $D600-: $D609 top entry, $D60A cursor (list row or index letter), $D60B count, $D60C/$D60D table end (big
// endian), $D60E category mask, $D60F hint mode, $D610 mode, $D613 flags (0 talking, 1 list page, 2 / 3 the arrows),
// $D614 host animation, $D615 / $D616 its frame, $D619 its timer, $D61A the cursor's blink
const v = (w, a) => w.wram[6][a - 0xD000];
const sv = (w, a, x) => { w.wram[6][a - 0xD000] = x & 0xFF; };

// ---- the table scans ----
// 3F:5B9F DictCountEntries: $D60B = the entries matching the mask
function dictCountEntries(w) {
  setW(w, 6);
  let hl = TABLE, c = 0;
  const d = v(w, 0xD60E);
  for (;;) {
    const a = R(hl++);
    if (!a) continue;
    if (a === 0x40) break;
    if (a & d) c = (c + 1) & 0xFF;
  }
  sv(w, 0xD60B, c);
}
// 3F:5BC2 DictFindTableEnd: $D60C/$D60D = the address of the $40 end marker
function dictFindTableEnd(w) {
  setW(w, 6);
  let hl = TABLE;
  while (R(hl++) !== 0x40);
  hl--;
  sv(w, 0xD60C, hl >> 8); sv(w, 0xD60D, hl & 0xFF);
}
// 3F:5BDC DictEntryAbsIndex: the a-th entry matching mask b -> its index among all entries
function dictEntryAbsIndex(a, b) {
  let d = 0, c = (a + 1) & 0xFF, hl = TABLE;
  for (;;) {
    const x = R(hl++);
    if (!x) continue;
    d = (d + 1) & 0xFF;
    if (!(x & b)) continue;
    c = (c - 1) & 0xFF;
    if (!c) break;
  }
  return (d - 1) & 0xFF;
}
// 3F:5BF2 DictEntryCategory: the a-th entry matching mask b -> its category 0-4 (by the bits it shares with b)
function dictEntryCategory(a, b) {
  let c = (a + 1) & 0xFF, hl = TABLE, x;
  for (;;) {
    x = R(hl++);
    if (!x) continue;
    x &= b;
    if (!x) continue;
    c = (c - 1) & 0xFF;
    if (!c) break;
  }
  return x === 1 ? 0 : x === 2 ? 1 : x === 4 ? 2 : x === 8 ? 3 : 4;
}
// 3F:5C23 DictCurrentEntry: (top + cursor row) less the count when past it (WRAM6 left mapped)
function dictCurrentEntry(w) {
  setW(w, 6);
  const d = v(w, 0xD60B);
  let a = (v(w, 0xD609) + v(w, 0xD60A)) & 0xFF;
  if (a >= d) a = (a - d) & 0xFF;
  return a;
}
// 3F:5C3A DictPrevLetter (Left): the top entry to the start of the previous letter's group (wrapping through
// DictWrapToEnd 3F:5C53: c = count - 1, hl = the end marker - 2); the cursor row 0
function dictPrevLetter(w) {
  setW(w, 6);
  let hl = TABLE;
  const cur = dictCurrentEntry(w);
  let b = (cur + 1) & 0xFF, c = cur;
  sv(w, 0xD60A, 0);
  const e = v(w, 0xD60E);
  const wrap = () => { c = (v(w, 0xD60B) - 1) & 0xFF; hl = ((v(w, 0xD60C) << 8 | v(w, 0xD60D)) - 2) & 0xFFFF; };
  for (;;) { const a = R(hl++); hl &= 0xFFFF; if (!(a & e)) continue; b = (b - 1) & 0xFF; if (!b) break; }
  hl = (hl - 1) & 0xFFFF;
  for (;;) {                                     // 3F:5C6D back to this group's separator
    const d = R(hl); hl = (hl - 1) & 0xFFFF;
    if (d & e) c = (c - 1) & 0xFF;
    if (d === 0x40) { wrap(); break; }
    if (d === 0) break;
  }
  for (;;) {                                     // 3F:5C81 back to the previous group's last matching entry
    const a = R(hl); hl = (hl - 1) & 0xFFFF;
    if (a === 0x40) wrap();
    if (a & e) break;
  }
  c = (c - 1) & 0xFF;
  for (;;) {                                     // 3F:5C8D back to its separator
    const d = R(hl); hl = (hl - 1) & 0xFFFF;
    if (d & e) c = (c - 1) & 0xFF;
    if (d === 0x40) { wrap(); hl = (hl + 1) & 0xFFFF; break; }
    if (d === 0) { hl = (hl + 1) & 0xFFFF; c = (c + 1) & 0xFF; break; }
  }
  for (;;) {                                     // 3F:5CA4 on to the group's first matching entry
    const a = R(hl); hl = (hl + 1) & 0xFFFF;
    if (a === 0x40) { c = 0; hl = TABLE; continue; }
    if (a & e) break;
  }
  sv(w, 0xD609, c);
}
// 3F:5CB8 DictNextLetter (Right): the top entry to the first matching entry after the next separator (0 past the
// end); the cursor row 0
function dictNextLetter(w) {
  setW(w, 6);
  let hl = TABLE;
  const n = v(w, 0xD60B);
  let a = (v(w, 0xD609) + v(w, 0xD60A)) & 0xFF;
  if (a >= n) a = (a - n) & 0xFF;
  let b = (a + 1) & 0xFF, d = a;
  sv(w, 0xD60A, 0);
  const e = v(w, 0xD60E);
  for (;;) { const x = R(hl++); if (!(x & e)) continue; b = (b - 1) & 0xFF; if (!b) break; }
  for (;;) {                                     // 3F:5CE3
    const x = R(hl++);
    if (!x) break;
    if (x & e) d = (d + 1) & 0xFF;
    if (x === 0x40) { hl = TABLE; d = 0xFF; break; }
  }
  d = (d + 1) & 0xFF;
  for (;;) {                                     // 3F:5CF8
    const x = R(hl++);
    if (x === 0x40) { hl = TABLE; d = 0; }
    if (x & e) break;
  }
  sv(w, 0xD609, d);
}
// 3F:5ED2 DictFindLetterStart: the top entry = the first of letter [$D60A]'s group (counting a byte with no mask bit
// as a break), 0 when none; the cursor row 0
function dictFindLetterStart(w) {
  setW(w, 6);
  let c = 0, hl = TABLE;
  const e = v(w, 0xD60E);
  let b = v(w, 0xD60A);
  if (b) {
    for (;;) {
      const a = R(hl++) & e;
      if (a) c = (c + 1) & 0xFF;
      if (a === 0x40) break;                     // (never: a is masked)
      if (a) continue;
      b = (b - 1) & 0xFF;
      if (!b) {                                  // 3F:5F02
        sv(w, 0xD60A, 0);
        sv(w, 0xD609, v(w, 0xD60B) === c ? 0 : c);
        return;
      }
    }
  }
  sv(w, 0xD60A, 0); sv(w, 0xD609, 0);            // 3F:5EFA
}
// 3F:5F16 DictFindLetterOfTop: the index cursor = the letter group of the highlighted entry
function dictFindLetterOfTop(w) {
  setW(w, 6);
  let b = (dictCurrentEntry(w) + 1) & 0xFF, c = 0, hl = TABLE;
  const e = v(w, 0xD60E);
  for (;;) {
    const a = R(hl++) & e;
    if (a) { b = (b - 1) & 0xFF; if (b) continue; sv(w, 0xD60A, c); return; }
    if (a === 0x40) break;
    c = (c + 1) & 0xFF;
  }
  sv(w, 0xD60A, 0);
}

// ---- drawing ----
// 3F:431C DictClearTextAreas: the 14 rectangles of DictTextAreaTable 3F:444D (dst, length) cleared in WRAM2
function dictClearTextAreas(w, fill = 0) {
  for (let k = 0, hl = 0x444D; k < 0x0E; k++, hl += 4) {
    const de = R(hl) | R(hl + 1) << 8, n = fill ? R(hl + 2) || 256 : R(hl + 2) | R(hl + 3) << 8;
    for (let i = 0; i < n; i++) wr(w, (de + i) & 0xFFFF, fill);   // 00:039F ClearBytes / 3F:5B92 FillBytes_3F
  }
}
// 3F:5DBA DictDrawListCursor: the highlighted entry's letter group d (its separators counted): 256 bytes from WRAM1
// $D000 + d x 32 queued to VRAM1 $8600 (WRAM1 left mapped)
function dictDrawListCursor(w) {
  let b = (dictCurrentEntry(w) + 1) & 0xFF, d = 0, hl = TABLE;
  const e = v(w, 0xD60E);
  for (;;) {
    const a = R(hl++);
    if (!a) { d = (d + 1) & 0xFF; continue; }
    if (!(a & e)) continue;
    b = (b - 1) & 0xFF;
    if (!b) break;
  }
  setW(w, 1);
  D.queueVRAMCopy(w, (0xD000 + d * 32) & 0xFFFF, 0xA600, 0x10);
}
// 3F:5F4C DictDrawIndexCursor: a = 1: letter b's two highlighted tiles (WRAM1 $D000 + b x 64) queued to VRAM1 $8600;
// WRAM6 mapped after
function dictDrawIndexCursor(w, a, b) {
  if (a) {
    setW(w, 1);
    D.queueVRAMCopy(w, (0xD000 + ((b * 64) & 0x3FFF)) & 0xFFFF, 0xA600, 0x20);
  }
  setW(w, 6);
}
// 3F:6142 DictCopyNameRow: de = the name's row in the WRAM3 / WRAM2 maps: its attributes (16 x [$C372], 3F:61A0
// DictBlankAttrRow via $C600) to WRAM2 de; the row's tiles and attributes queued to $9810 + (de - $D010) / 2 and
// VRAM1; the glyphs (03:5087); a frame
function* dictCopyNameRow(sh, de) {
  const w = sh.w, old = w.high[0x196];
  setW(w, 2);
  const g = rd(w, 0xC372);
  for (let k = 0; k < 16; k++) wr(w, 0xC600 + k, g);
  D.copyMemoryFast(w, 0xC600, de, 0x01);
  let hl = (de - 0xD010) & 0xFFFF;
  hl = ((hl >> 1) | (hl & 0x8000)) & 0xFFFF;
  const vr = (hl + 0x9810) & 0xFFFF;
  setW(w, 3);
  D.queueVRAMCopy(w, de, vr, 0x01);
  setW(w, 2);
  D.queueVRAMCopy(w, de, (vr + 0x2000) & 0xFFFF, 0x01);
  D.inBank(w, 0x03, () => T.uploadGlyphRange(w));
  yield* sh.advance();
  setW(w, old);
}
// 3F:5D0A DictDrawEntryList: the glyph buffer reset (03:4EDC) and the other glyph bank used; the text areas blanked
// with $20 in WRAM3; the six names from the top entry (05:62AA, rows $D150 + $80 k, stride $40), each copied by
// DictCopyNameRow (a frame each); the list cursor; WRAM6 after
function* dictDrawEntryList(sh) {
  const w = sh.w;
  D.inBank(w, 0x03, () => T.resetGlyphBuffer(w));
  wr(w, 0xC372, rd(w, 0xC372) ^ 0x08);
  setW(w, 3);
  dictClearTextAreas(w, 0x20);
  setW(w, 6);
  let c = 0, b = (v(w, 0xD609) + 1) & 0xFF, hl = TABLE;
  const e = v(w, 0xD60E);
  for (;;) {                                     // the top entry's index among all entries
    c = (c + 1) & 0xFF;
    let a;
    do a = R(hl++); while (!a);
    if (!(a & e)) continue;
    b = (b - 1) & 0xFF;
    if (!b) break;
  }
  c = (c - 1) & 0xFF;
  hl--;
  b = 0;
  setW(w, 3);
  for (;;) {                                     // 3F:5D68
    c = (c + 1) & 0xFF;
    let a;
    do a = R(hl++); while (!a);
    if (a === 0x40) { hl = TABLE; c = 0; continue; }
    if (!(a & e)) continue;
    c = (c - 1) & 0xFF;
    const id = (0x1A2B + c) & 0xFFFF;
    c = (c + 1) & 0xFF;
    b = (b + 1) & 0xFF;
    const de = (0xD0D0 + b * 0x80) & 0xFFFF;
    yield* inBankGen(w, 0x05, T.printTextToBuffer(sh, id, de, 0x40));
    yield* dictCopyNameRow(sh, de);
    if (b === 6) break;
  }
  setW(w, 3);
  dictDrawListCursor(w);
  setW(w, 6);
}

// 3F:4216 DictLoadListGfx: the list page's tiles (ref $4E:04 -> VRAM1 $9000), the title by the mode (3F:4889, $200
// per mode, to VRAM1 $9400), palettes 3F:4841 (BG 0-7), the attribute map 3F:44F5 (WRAM2, $480 bytes to VRAM1
// $9800), the text areas cleared, the cursor tiles 3F:4F54 (WRAM1 $D000 -> VRAM1 $8600) and 3F:5036 (to $D200); WRAM2
// left mapped
function dictLoadListGfx(w) {
  setW(w, 1);
  decompressDataFromBank(w, 0x4E04, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xB000, 0x80);
  setW(w, 6);
  const mode = v(w, 0xD610);
  setW(w, 1);
  D.lzTo(w, B, 0x4889, 0xD000);
  D.queueAndRunVRAMCopy(w, (((mode * 2 + 0xD0) & 0xFF) << 8), 0xB400, 0x20);
  D.loadPalettesMasterOnly(w, 0x4841, 0x00, 0x08);
  setW(w, 2);
  D.lzTo(w, B, 0x44F5, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xB800, 0x48);
  setW(w, 2);
  dictClearTextAreas(w);
  setW(w, 1);
  D.lzTo(w, B, 0x4F54, 0xD000);
  D.lzTo(w, B, 0x5036, 0xD200);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xA600, 0x20);
  setW(w, 2);
}
// 3F:42A9 DictLoadIndexGfx: the index page's tiles (ref $4E:02 -> VRAM1 $9000, WRAM1 $D800 -> VRAM1 $8800), palettes
// 3F:47F9, the attribute map 3F:4485 (WRAM2), the letters' highlighted tiles (refs $4E:06 / 08 / 0A / 0C to WRAM1
// $D000 / $D200 / $D400 / $D600; $D000 also to VRAM1 $8600); WRAM1 left mapped
function dictLoadIndexGfx(w) {
  setW(w, 1);
  decompressDataFromBank(w, 0x4E02, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xB000, 0x80);
  D.queueAndRunVRAMCopy(w, 0xD800, 0xA800, 0x80);
  D.loadPalettesMasterOnly(w, 0x47F9, 0x00, 0x08);
  setW(w, 2);
  D.lzTo(w, B, 0x4485, 0xD000);
  setW(w, 1);
  decompressDataFromBank(w, 0x4E06, 0xD000);
  decompressDataFromBank(w, 0x4E08, 0xD200);
  decompressDataFromBank(w, 0x4E0A, 0xD400);
  decompressDataFromBank(w, 0x4E0C, 0xD600);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xA600, 0x20);
}
// 3F:41F6 DictResetScroll: the scroll and its shadows 0, wTextSpeed bit 7 cleared (WRAM6 mapped)
function dictResetScroll(w) {
  setW(w, 6);
  w.high[0x18B] = 0;
  wr(w, 0xC321, 0); wr(w, 0xC320, 0);
  w.high[0x18A] = 0;
  wr(w, 0xC322, 0); wr(w, 0xC323, 0);
  w.high[0x1B9] = 0; w.high[0x1B8] = 0;
  w.wram[0][0x82D] &= 0x7F;
}
const mapScroll = w => D.inBank(w, 0x04, () => mapScrollTask(w));   // 04:4072 MapScrollTask (called)

// 3F:433C DictInit: the view at column $21 (the index, mode 6) or $0D, LCD off, no frame tasks, the counts, the host
// and letters' tiles (3F:5119 / 525A / 53D2 to $8000 / $8200 / $8400, 3F:5530 / 5609 / 5756 to VRAM1 $8000-$85FF),
// OBJ palettes 3F:5811, the page's graphics, the tile map 3F:4565 (WRAM3); drawn (04:4072, 0B:4306); wTextSpeed bit 7
// set, wGlyphVRAMBank 0
function dictInit(w) {
  setW(w, 6);
  const col = v(w, 0xD610) === 6 ? 0x21 : 0x0D;
  w.high[0x18B] = col;
  wr(w, 0xC321, col); wr(w, 0xC320, 0);
  w.high[0x18A] = 0;
  wr(w, 0xC322, 0); wr(w, 0xC323, 0);
  w.high[0x1B9] = 0; w.high[0x1B8] = 0;
  D.disableLCDSafely(w);
  clearFrameTasks(w);
  dictCountEntries(w);
  dictFindTableEnd(w);
  setW(w, 1);
  for (const [src, dst] of [[0x5119, 0x8000], [0x525A, 0x8200], [0x53D2, 0x8400], [0x5530, 0xA000], [0x5609, 0xA200], [0x5756, 0xA400]]) {
    D.lzTo(w, B, src, 0xD000);
    D.queueAndRunVRAMCopy(w, 0xD000, dst, 0x20);
  }
  setW(w, 1);
  D.loadPalettesMasterOnly(w, 0x5811, 0x08, 0x08);
  setW(w, 6);
  if (v(w, 0xD610) === 6) dictLoadIndexGfx(w); else dictLoadListGfx(w);
  setW(w, 3);
  D.lzTo(w, B, 0x4565, 0xD000);
  setW(w, 6);
  D.enableLCD(w);
  setW(w, 6);
  mapScroll(w);
  D.disableLCDSafely(w);
  setW(w, 3);
  D.inBank(w, 0x0B, () => mapDrawFullScreen(w));
  D.enableLCD(w);
  w.wram[0][0x82D] |= 0x80;
  wr(w, 0xC372, 0);
}

// 3F:58B9 DictHostStopTalking / 3F:58CB DictHostStartTalking
function dictHostStopTalking(w) {
  if (v(w, 0xD614) < 3) { sv(w, 0xD614, 4); sv(w, 0xD619, 0xFF); }
}
function dictHostStartTalking(w) {
  sv(w, 0xD619, 0xB4);
  const a = w.high[0x18C] & 3;
  sv(w, 0xD614, a === 3 ? 0 : a);
}

// 3F:58DD DictFrameTask: while flag #25 the host starts talking again (sound $90); the host's states (4: closed for
// [$D619] frames, then 3: still; 0-2: talking for [$D619] frames, then 4 with $FF); in mode 6 the host's face (frame
// lists 3F:5AD0 by state, 16 steps of 8 frames; four parts from 3F:5B20, the templates 3F:5B78 / 3F:5B81, $20 lower on
// the list page); on the list page the blinking cursor (3F:5A90) and the arrows (3F:5AA0, 3F:5AC2), on the index
// page the letter cursor (3F:5AB9, 9 letters a row)
export function dictFrameTask(w, sound) {
  const old = w.high[0x196];
  setW(w, 6);
  if (flag(w, 25)) { sound(0x90); dictHostStartTalking(w); }
  const st = v(w, 0xD614);
  if (st === 4) {
    sv(w, 0xD619, v(w, 0xD619) - 1);
    if (!v(w, 0xD619)) sv(w, 0xD614, 3);
  } else if (st !== 3) {
    sv(w, 0xD619, v(w, 0xD619) - 1);
    if (!v(w, 0xD619)) { sv(w, 0xD614, 4); sv(w, 0xD619, 0xFF); }
  }
  const tpl = (hl, e, d, c, b) => D.queueSpriteTemplate(w, hl, e, d, c, b, R);
  if (v(w, 0xD610) === 6) {
    sv(w, 0xD615, v(w, 0xD615) - 1);
    if (!v(w, 0xD615)) {
      sv(w, 0xD615, 8);
      let f = (v(w, 0xD616) + 1) & 0xFF;
      if (f === 0x10) f = 0;
      sv(w, 0xD616, f);
    }
    let hl = (0x5AD0 + ((v(w, 0xD614) << 4) & 0xFF)) & 0xFFFF;
    hl = (hl + v(w, 0xD616)) & 0xFFFF;
    hl = (0x5B20 + ((R(hl) << 3) & 0xFF)) & 0xFFFF;
    const low = v(w, 0xD613) & 2;
    const parts = [[0x5B78, 0x7E, 0x70], [0x5B81, 0x6E, 0x68], [0x5B81, 0x7E, 0x68], [0x5B81, 0x8E, 0x68]];
    for (const [t, e, d] of parts) {
      const c = R(hl++), b = R(hl++);
      tpl(t, e, low ? d + 0x20 : d, c, b);
    }
  }
  const f = v(w, 0xD613);
  if (f & 2) {
    if (!(f & 1)) sv(w, 0xD61A, v(w, 0xD61A) + 1);
    const e = (0x18 + (v(w, 0xD60A) + 2) * 0x10) & 0xFF;
    const d = (R(0x5A90 + (v(w, 0xD61A) & 0x0F)) + 0x0A) & 0xFF;
    tpl(0x5AC7, e, d, 0x28, 0x0B);
    if (f & 4) tpl(0x5AA0, 0x10, 0x18, 0x34, 0x0D);
    if (f & 8) tpl(0x5AA0, 0x10, 0x88, 0x3A, 0x0D);
    tpl(0x5AC2, 0x18, 0x20, 0x60, 0x08);
    tpl(0x5AC2, 0x18, 0x90, 0x64, 0x08);
  } else {
    let a = v(w, 0xD60A), d, b;
    if (a < 9) { d = 0x88; b = 0xFF; }
    else if (a < 0x12) { d = 0x90; a -= 9; b = 1; }
    else { d = 0x98; b = 2; a -= 0x12; }
    tpl(0x5AB9, ((a << 4) + 0x10 + b) & 0xFF, d, 0x60, 0x0E);
  }
  setW(w, old);
}

// ---- the pages ----
// 3F:4140 DictShowEntryListPage: fade out; the view to column $0D, the index cursor off, the list's graphics and the
// screen drawn, the letter's first entry on top, the names; fade in; 8
function* dictShowEntryListPage(sh) {
  const w = sh.w;
  Scr.beginFadeOut(w, 0x10);
  yield* Scr.waitFade(sh);
  wr(w, 0xC321, 0x0D); wr(w, 0xC320, 0);
  setW(w, 6);
  dictDrawIndexCursor(w, 0, v(w, 0xD60A));
  mapScroll(w);
  yield* sh.advance();
  D.disableLCDSafely(w);
  dictLoadListGfx(w);
  D.inBank(w, 0x0B, () => mapDrawFullScreen(w));
  D.enableLCD(w);
  dictFindLetterStart(w);
  yield* dictDrawEntryList(sh);
  sv(w, 0xD613, v(w, 0xD613) | 2);
  Scr.beginFadeIn(w, 0x10);
  yield* Scr.waitFade(sh);
  return 8;
}
// 3F:418C DictShowIndexPage: fade out; the view to column $21, the cursor on the highlighted entry's letter, the
// index's graphics and the screen drawn; fade in; 2
function* dictShowIndexPage(sh) {
  const w = sh.w;
  Scr.beginFadeOut(w, 0x10);
  yield* Scr.waitFade(sh);
  wr(w, 0xC321, 0x21); wr(w, 0xC320, 0);
  dictFindLetterOfTop(w);
  mapScroll(w);
  yield* sh.advance();
  D.disableLCDSafely(w);
  dictLoadIndexGfx(w);
  setW(w, 6);
  dictDrawIndexCursor(w, 1, v(w, 0xD60A));
  D.inBank(w, 0x0B, () => mapDrawFullScreen(w));
  D.enableLCD(w);
  setW(w, 6);
  sv(w, 0xD613, v(w, 0xD613) & ~2);
  Scr.beginFadeIn(w, 0x10);
  yield* Scr.waitFade(sh);
  return 2;
}

// 3F:5F73 DictIndexInput: A -> 4 (the list; sound $8E), B -> 1 (leave; $5D); Up / Down the previous / next letter
// (of 26; $8B), Left / Right a row of 9 back / on; else the state a kept
function dictIndexInput(sh, a) {
  const w = sh.w;
  setW(w, 6);
  const p = w.high[0x194];
  if (p & 1) { sh.sound(0x8E); return 4; }
  if (p & 2) { sh.sound(0x5D); return 1; }
  const r = w.high[0x191];
  const cur = v(w, 0xD60A);
  if (r & 0x40 || r & 0x80) {
    const n = r & 0x40 ? (cur - 1) & 0xFF : cur + 1;
    if (n === 0xFF || n === 0x1A) return a;
    sv(w, 0xD60A, n);
    dictDrawIndexCursor(w, 0, cur);
    sh.sound(0x8B);
    dictDrawIndexCursor(w, 1, v(w, 0xD60A));
    return a;
  }
  if (r & 0x20) {
    if (cur < 9) return a;
    sh.sound(0x8B);
    sv(w, 0xD60A, cur - 9);
    dictDrawIndexCursor(w, 1, cur - 9);
    return a;
  }
  if (r & 0x10) {
    if (cur >= 0x11) return a;
    sh.sound(0x8B);
    sv(w, 0xD60A, cur + 9);
    dictDrawIndexCursor(w, 1, cur + 9);
  }
  return a;
}

// 05:465B BeginWindowTextNoUpload / 05:4B63 OpenMessageWindowVRAM1: as OpenMessageWindow (msgbox.js) with the window
// attribute ([$C372] ^ 8) | $80 and the glyph buffer cleared but not uploaded
function* openMessageWindowVRAM1(sh, d, e, b, c) {
  const w = sh.w;
  setW(w, 5);
  wr(w, 0xD84D, (rd(w, 0xC372) ^ 0x08) | 0x80);
  if (!rd(w, 0xD822)) {
    setW(w, 7);
    D.inBank(w, 3, () => T.clearGlyphBuffer(w));
    for (let k = 0; k < 6; k++) wr(w, 0xC36A + k, 0);
    setW(w, 5);
  } else wr(w, 0xC36F, rd(w, 0xC36E));
  wr(w, 0xD827, b); wr(w, 0xD828, c);
  const [sd, se] = W.getScrollTilePos(w);
  d = (d + sd) & 0x1F; e = (e + se) & 0x1F;
  wr(w, 0xD825, d); wr(w, 0xD826, e);
  W.openWindowBuffered(w, 2, d, e, b, c);
  const s = rd(w, 0xD820);
  if (s !== 0xFF) wr(w, 0xD824, s);
}
// 05:6701 ResetWindowsAndMap: InitWindowSystem, RestoreShadowFromMap
function* resetWindowsAndMap(sh) {
  yield* initWindowSystem(sh);
  yield* restoreShadowFromMap(sh);
}
// the explanation window (3F:40B8, 3F:6065): text hl in a message window 20 x 5 at row 6 (vram1: 05:4B63, else
// 05:4B20), read through its pages (05:6729; flag #27 around it when vram1), then taken away (05:44E3, 05:67BB)
function* showWindowText(sh, hl, vram1) {
  const w = sh.w;
  yield* inBankGen(w, 0x05, resetWindowsAndMap(sh));
  if (vram1) yield* inBankGen(w, 0x05, openMessageWindowVRAM1(sh, 0x00, 0x06, 0x14, 0x05));
  else yield* inBankGen(w, 0x05, openMessageWindow(sh, 0x00, 0x06, 0x14, 0x05));
  hl = T.normalizeTextId(hl, 0);                 // 05:622F
  W.setWindowText(w, 0, hl);                     // 05:5A51
  if (vram1) setFlag(w, 27);
  yield* inBankGen(w, 0x05, refreshWindowText(sh, 0));
  if (vram1) clearFlag(w, 27);
  restoreMapUnderWindow(w, 0);
  yield* inBankGen(w, 0x05, removeWindow(sh, 0));
}

// 3F:6017 DictListInput: the arrows cleared; A: the explanation ($1AE7 + the entry's index, or with the hint mode the
// category $1A1E + c; sound $5C) while the host talks; B: 1 (leave), or $10 in mode 6 (back to the index; $8F); Up /
// Down the cursor row, or the list scrolled at the ends (wrapping; $5B); Left / Right the previous / next letter
// (the arrow shown; $8B); else the state a kept
function* dictListInput(sh, a) {
  const w = sh.w;
  setW(w, 6);
  sv(w, 0xD613, v(w, 0xD613) & ~0x0C);
  const p = w.high[0x194];
  if (p & 1) {
    sh.sound(0x5C);
    dictHostStartTalking(w);
    sv(w, 0xD613, v(w, 0xD613) | 1);
    const b = v(w, 0xD60E);
    let hl;
    if (v(w, 0xD60F) !== 1) hl = 0x1AE7 + dictEntryAbsIndex(dictCurrentEntry(w), b);
    else hl = 0x1A1E + dictEntryCategory(dictCurrentEntry(w), b);
    yield* showWindowText(sh, hl, true);
    setW(w, 6);
    sv(w, 0xD613, v(w, 0xD613) & ~1);
    dictHostStopTalking(w);
    return a;
  }
  if (p & 2) { sh.sound(0x8F); return v(w, 0xD610) === 6 ? 0x10 : 1; }
  const r = w.high[0x191];
  if (r & 0x40) {
    sh.sound(0x5B);
    const c = (v(w, 0xD60A) - 1) & 0xFF;
    if (c !== 0xFF) { sv(w, 0xD60A, c); dictDrawListCursor(w); return a; }
    let t = (v(w, 0xD609) - 1) & 0xFF;
    if (t === 0xFF) t = (v(w, 0xD60B) - 1) & 0xFF;
    sv(w, 0xD609, t);
    yield* dictDrawEntryList(sh);
  } else if (r & 0x80) {
    sh.sound(0x5B);
    const c = (v(w, 0xD60A) + 1) & 0xFF;
    if (c < 6) { sv(w, 0xD60A, c); dictDrawListCursor(w); return a; }
    let t = (v(w, 0xD609) + 1) & 0xFF;
    if (t === v(w, 0xD60B)) t = 0;
    sv(w, 0xD609, t);
    yield* dictDrawEntryList(sh);
  } else if (r & 0x20) {
    sv(w, 0xD613, v(w, 0xD613) | 4);
    sh.sound(0x8B);
    dictPrevLetter(w);
    yield* dictDrawEntryList(sh);
  } else if (r & 0x10) {
    sv(w, 0xD613, v(w, 0xD613) | 8);
    sh.sound(0x8B);
    dictNextLetter(w);
    yield* dictDrawEntryList(sh);
  }
  return a;
}

// 3F:4002 GolfDictionary: a = mode (0-4 one category, 5 all with the hints, 6 all from the index); the page loop
// (4: to the list, $10: to the index, 8: the list's input, else the index's) until a handler gives 1; fade out, the
// scroll reset, the frame task removed
export function* golfDictionary(sh, mode) {
  const w = sh.w;
  setW(w, 6);
  sv(w, 0xD610, mode);
  let mask = 0x1F;
  if (mode <= 4) mask = 1 << mode;
  else if (mode === 5) sv(w, 0xD60F, 1);
  sv(w, 0xD60E, mask);
  for (const a of [0xD616, 0xD613, 0xD609, 0xD60A, 0xD61A]) sv(w, a, 0);
  sv(w, 0xD615, 8); sv(w, 0xD614, 0); sv(w, 0xD619, 0xB4);
  dictInit(w);
  setW(w, 6);
  sv(w, 0xD60F, 0);
  if (v(w, 0xD610) !== 6) {
    yield* sh.advance();
    yield* dictDrawEntryList(sh);
    if (v(w, 0xD610) === 5) sv(w, 0xD60F, 1);
  }
  sh.sound(0x16);
  yield* sh.advance();
  Scr.beginFadeIn(w, 0x10);
  yield* Scr.waitFade(sh);
  registerFrameTask(w, 0x1D, B, 0x58DD);         // DictFrameTask
  setW(w, 6);
  let a;
  if (v(w, 0xD610) === 6) {                      // the index's greeting $1A23
    sv(w, 0xD613, v(w, 0xD613) | 1);
    yield* showWindowText(sh, 0x1A23, false);
    setW(w, 6);
    sv(w, 0xD613, v(w, 0xD613) & ~1);
    dictHostStopTalking(w);
    yield* sh.advance(1);                        // 00:2ED5 WaitFramesCmd 1
    a = 2;
  } else {
    sv(w, 0xD613, v(w, 0xD613) | 2);
    a = 8;
  }
  do {
    yield* sh.advance();
    if (a === 4) a = yield* dictShowEntryListPage(sh);
    else if (a === 0x10) a = yield* dictShowIndexPage(sh);
    else if (a === 8) a = yield* dictListInput(sh, a);
    else a = dictIndexInput(sh, a);
    D.restorePalettesFromMaster(w);              // 00:05DD
  } while (a !== 1);
  Scr.beginFadeOut(w, 0x10);
  yield* Scr.waitFade(sh);
  dictResetScroll(w);
  unregisterFrameTask(w, B, 0x58DD);
}
