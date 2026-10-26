// Bank 05's windows and menus (REVERSE.md "Windows", "Menus"): 6 window slots at $D800 (WRAM5: the record pointer,
// priority << 5 | text-id high, text-id low; the pointer's high nibble $D live, $C a close request), records in 7
// buffers of $11D bytes at $D900 (flags, x, y, w, h, then (tile, attribute) pairs), drawn into the BG shadow
// (shadow.js) by UpdateWindows and queued to VRAM a few rows a frame. A menu window is sized from its text (options
// split by $01), pushed on the menu stack $D832 and run by RunMenu 05:4CD7 with the blinking cursor of
// MenuCursorTask 05:4F20.
import { mulHLByA } from "./math.js";
import { registerFrameTask, unregisterFrameTask } from "./tasks.js";
import * as D from "./render/display.js";
import * as T from "./text.js";
import { queueShadowRows } from "./shadow.js";
import { renderMessageWindow } from "./msgbox.js";

const rd = D.rd, wr = D.wr;
const wbank = w => w.high[0x196];
const setW = (w, n) => D.setWramBank(w, n);
const r16 = (w, a) => rd(w, a) | rd(w, (a + 1) & 0xFFFF) << 8;
const slotAddr = a => (0xD800 + ((a << 2) & 0xFF)) & 0xFFFF;
function notPorted(what) { throw new Error(`${what} is not ported`); }

// 05:414F ShadowTileAddr: d = x, e = y (each & 31) -> the BG shadow's address $D000 + y * 32 + x
export const shadowTileAddr = (d, e) => 0xD000 + ((e & 0x1F) << 5) + (d & 0x1F);

// 05:4128 WriteShadowTile: a = tile at (d, e) of the shadow (nothing for 0); leaves WRAM5 mapped
export function writeShadowTile(w, a, d, e) {
  setW(w, 5);
  if (a) wr(w, shadowTileAddr(d, e), a);
}

// 05:4AB1 GetScrollTilePos: hSCX / hSCY to tiles (rounded, & 31)
export function getScrollTilePos(w) {
  const f = v => ((((v + 4) & 0xFF) >> 1) >> 2) & 0x1F;
  return [f(w.high[0x18B]), f(w.high[0x18A])];
}

// 05:4624 BeginWindowText: with no window open the glyph buffer is cleared and uploaded (03:4BFE, 03:4C60) and the
// pen reset ($C36A-$C36F); otherwise the next glyph block starts at the next free tile
export function* beginWindowText(sh) {
  const w = sh.w, old = wbank(w);
  setW(w, 5);
  if (!rd(w, 0xD822)) {
    setW(w, 7);
    D.inBank(w, 3, () => T.clearGlyphBuffer(w));
    yield* T.uploadGlyphBuffer(sh);
    for (let k = 0; k < 6; k++) wr(w, 0xC36A + k, 0);
  } else wr(w, 0xC36F, rd(w, 0xC36E));
  setW(w, old);
}

// 05:46F1 FindFreeWindowSlot: the first of the 6 slots with a zero pointer high byte, or $FF
export function findFreeWindowSlot(w) {
  for (let k = 0; k < 6; k++) if (!rd(w, 0xD801 + 4 * k)) return k;
  return 0xFF;
}

// 05:468F AllocWindowSlot: hl = record buffer, b x c = size, a = priority: a free slot (-> wLastOpenedWindow $D820
// and wCurWindow $D821) gets the pointer and priority << 5 | 3; returns hl ($FFFF: none, or the record would reach
// $E000)
export function allocWindowSlot(w, hl, b, c, a) {
  wr(w, hl, 0);
  const end = (mulHLByA(c, (b << 1) & 0xFF) + hl + 5) & 0xFFFF;
  if ((end >> 8) >= 0xE0) return 0xFFFF;
  const s = findFreeWindowSlot(w);
  wr(w, 0xD820, s); wr(w, 0xD821, s);
  if (s === 0xFF) return 0xFFFF;
  const p = slotAddr(s);
  wr(w, p, hl & 0xFF); wr(w, p + 1, hl >> 8);
  wr(w, p + 2, ((a << 5) | 3) & 0xFF);
  return hl;
}

// 05:4773 BuildTextWindowRecord: the record at hl: x d, y e, w b, h c, then the frame (tiles $02-$09) around the
// interior: blank ($20) rows and, every other row, a run of glyph tiles numbered from [$D86B] (the window's tiles
// from $80, or $80 + [$C36E] past window 0), less the row's tiles each row up; [$D86C] set: each glyph row starts
// with a blank
export function buildTextWindowRecord(w, hl, d, e, b, c) {
  wr(w, hl + 1, d); wr(w, hl + 2, e); wr(w, hl + 3, b); wr(w, hl + 4, c);
  let p = (hl + 5) & 0xFFFF;
  const put = (t, a) => { wr(w, p, t); wr(w, p + 1, a); p = (p + 2) & 0xFFFF; };
  const iw = (b - 2) & 0xFF;
  let ih = (c - 2) & 0xFF;
  let n = 0, dd = ih;
  do { if (!(dd & 1)) n = (n + iw) & 0xFF; dd = (dd - 1) & 0xFF; } while (dd);
  let base = 0x80;
  if (rd(w, 0xD821)) base = (rd(w, 0xC36E) + 0x80) & 0xFF;
  wr(w, 0xD86B, (n + base) & 0xFF);
  const attr = rd(w, 0xD84D);
  put(0x02, attr);
  let k = iw;
  do { put(0x03, attr); k = (k - 1) & 0xFF; } while (k);
  put(0x04, attr);
  do {
    put(0x05, attr);
    let cnt = iw;
    if (ih & 1) {
      let t = rd(w, 0xD86B);
      for (let k = ((ih >> 1) | (ih & 0x80)) & 0xFF; k; k = (k - 1) & 0xFF) t = (t - iw) & 0xFF;
      if (rd(w, 0xD86C)) { put(0x20, attr); cnt = (cnt - 1) & 0xFF; }
      do { put(t, attr); t = (t + 1) & 0xFF; cnt = (cnt - 1) & 0xFF; } while (cnt);
    } else {
      do { put(0x20, attr); cnt = (cnt - 1) & 0xFF; } while (cnt);
    }
    put(0x06, attr);
    ih = (ih - 1) & 0xFF;
  } while (ih);
  put(0x07, attr);
  k = iw;
  do { put(0x08, attr); k = (k - 1) & 0xFF; } while (k);
  put(0x09, attr);
}

// 05:4831 DrawWindowToShadow: the record's tiles into the shadow (tiles $D000, attributes $D400) at its x, y; each
// row wraps within its shadow row
export function drawWindowToShadow(w, hl) {
  const d = rd(w, hl + 1), b = rd(w, hl + 3);
  let e = rd(w, hl + 2), c = rd(w, hl + 4);
  let p = (hl + 5) & 0xFFFF;
  do {
    let de = shadowTileAddr(d, e);
    for (let k = b; ; ) {
      wr(w, de, rd(w, p)); wr(w, (de + 0x400) & 0xFFFF, rd(w, p + 1)); p = (p + 2) & 0xFFFF;
      if ((de & 0x1F) === 0x1F) de = (de - 0x20) & 0xFFFF;
      de = (de + 1) & 0xFFFF;
      k = (k - 1) & 0xFF;
      if (!k) break;
    }
    e = (e + 1) & 0xFF;
    c = (c - 1) & 0xFF;
  } while (c);
}

// 05:4899 OpenWindowRecord: a = priority, hl = record buffer, d e b c = x y w h: a slot (6 open at most) and the
// record built; returns the open count before ($FF: none)
export function openWindowRecord(w, a, hl, d, e, b, c) {
  setW(w, 5);
  if (rd(w, 0xD822) >= 6) return 0xFF;
  hl = allocWindowSlot(w, hl, b, c, a);
  if ((hl >> 8) === 0xFF) return 0xFF;
  buildTextWindowRecord(w, hl, d, e, b, c);
  const n = rd(w, 0xD822);
  wr(w, 0xD822, (n + 1) & 0xFF);
  return n;
}

// 05:4A61 AllocWindowBuffer / 05:4A85 FreeWindowBuffer: the 7 record buffers' bits in wWindowBufferMask $D823
export function allocWindowBuffer(w) {
  const m = rd(w, 0xD823);
  for (let k = 0; k < 7; k++) if (!(m & (1 << k))) { wr(w, 0xD823, m | (1 << k)); return k; }
  return 0xFF;
}
export function freeWindowBuffer(w, a) {
  if (a >= 6) return 0xFF;
  const bit = 1 << a;
  if (!(rd(w, 0xD823) & bit)) return 0xFF;
  wr(w, 0xD823, rd(w, 0xD823) & ~bit & 0xFF);
  return a;
}

// 05:4A2F OpenWindowBuffered: a = priority; a free buffer at $D900 + n * $11D, then OpenWindowRecord
export function openWindowBuffered(w, a, d, e, b, c) {
  setW(w, 5);
  const n = allocWindowBuffer(w);
  if (n === 0xFF) return 0xFF;
  return openWindowRecord(w, a, (0xD900 + n * 0x11D) & 0xFFFF, d, e, b, c);
}

// 05:48CE FreeWindowSlot: a = slot: its buffer freed (FreeWindowBuffer is given the slot number: a slot whose
// number is not a used buffer stays as it is), the slot cleared, the count down; a menu window pops the menu stack
// (the cursor back from the entry below, the rows and window from the new top)
export function freeWindowSlot(w, a) {
  if (freeWindowBuffer(w, a) === 0xFF) return;
  const p = slotAddr(a);
  const rec = r16(w, p);
  wr(w, p, 0); wr(w, p + 1, 0); wr(w, p + 2, 3); wr(w, p + 3, 0);
  wr(w, 0xD822, (rd(w, 0xD822) - 1) & 0xFF);
  if (!(rd(w, rec) & 2)) return;
  let dep = rd(w, 0xD83E);
  if (dep) wr(w, 0xD830, rd(w, 0xD832 + (((dep - 1) << 1) & 0xFF)) & 0x0F);
  dep = (rd(w, 0xD83E) - 1) & 0xFF;
  wr(w, 0xD83E, dep);
  if (dep === 0xFF) return;
  const q = 0xD832 + ((dep << 1) & 0xFF);
  wr(w, 0xD831, (rd(w, q) >> 4) & 0x0F);
  wr(w, 0xD82F, rd(w, q + 1) & 0x0F);
}

// 05:4384 CopyWindowRowsFramed: a = slot: the window's rows queued to VRAM 7 a frame (a part past row 31 from row 0;
// the last part's size is h mod 7 only for h up to 21, as the code computes it); `jr $` if a wrapped part is 8+ rows
export function* copyWindowRowsFramed(sh, a) {
  const w = sh.w;
  const rec = T.getWindowRecord(w, a);
  let d = rd(w, rec + 2);
  const h = rd(w, rec + 4);
  let e;
  if (h <= 7) e = h; else if (h - 7 <= 7) e = h - 7; else e = (h - 14) & 0xFF;
  let n = 0;
  for (let r = h; ; ) { n++; if (r <= 7) break; r -= 7; }
  for (; n; n--) {
    let c = n === 1 ? e : 7;
    if (d < 0x20) {
      const end = (d + c) & 0xFF;
      if (end >= 0x20) {
        const over = (end - 0x20) & 0xFF;
        if (over >= 8) throw new Error("CopyWindowRowsFramed 05:43F4: hangs (jr $) on a wrapped part of 8+ rows");
        queueShadowRows(w, 0, over, 5);
        c = (c - over) & 0xFF;
      }
    }
    queueShadowRows(w, d & 0x1F, c, 5);
    yield* sh.advance();
    d = (d + 7) & 0xFF;
  }
}

// 05:431B CopyWindowRowsToVRAM: a = slot: its rows queued at once (a 3-row window as 7 rows from 2 up, a 5-row one
// as 7 from 1 up), one frame
export function* copyWindowRowsToVRAM(sh, a) {
  const w = sh.w;
  const rec = r16(w, slotAddr(a));
  let b = rd(w, rec + 2), c = rd(w, rec + 4);
  if (c === 3) { c = 7; b = (b - 2) & 0xFF; } else if (c === 5) { c = 7; b = (b - 1) & 0xFF; }
  const d = b;
  const end = (d + c) & 0xFF;
  if (end > 0x20) {
    const over = end - 0x20;
    queueShadowRows(w, 0, over, 5);
    c = (c - over) & 0xFF;
  }
  queueShadowRows(w, d, c, 5);
  yield* sh.advance();
}

// 05:43F6 FlushMessageWindowRows: the current window's rows, when it is the message window
export function* flushMessageWindowRows(sh) {
  const w = sh.w;
  if (rd(w, 0xD821) === rd(w, 0xD824)) yield* copyWindowRowsToVRAM(sh, rd(w, 0xD821));
}

// 05:4408 SetWindowTile: slot a, (d, e) inside the window: tile c, attribute b into its record
export function setWindowTile(w, a, d, e, c, b) {
  const old = wbank(w);
  setW(w, 5);
  const rec = r16(w, slotAddr(a));
  const width = rd(w, rec + 3);
  let off = 0;
  let k = e;
  do { off = (off + width) & 0xFFFF; k = (k - 1) & 0xFF; } while (k);
  off = ((off + d) << 1) & 0xFFFF;
  const p = (rec + 5 + off) & 0xFFFF;
  wr(w, p, c); wr(w, p + 1, b);
  setW(w, old);
}

// 05:4C5C CloseWindow: a = slot marked for closing (pointer high nibble $C); 16-bit index (a = $FF: $DBFD)
export function closeWindow(w, a) {
  const p = (0xD800 + a * 4 + 1) & 0xFFFF;
  wr(w, p, (rd(w, p) & 0x0F) | 0xC0);
}
// 05:5F46 CloseMessageWindow: CloseWindow wMessageWindow ($FF with none: the byte at $DBFD), wMessageWindow = $FF
export function closeMessageWindow(w) {
  const old = wbank(w);
  setW(w, 5);
  closeWindow(w, rd(w, 0xD824));
  wr(w, 0xD824, 0xFF);
  setW(w, old);
}
// 05:4C9A SetWindowFlags: slot a, mask b set (c bit 0) or cleared in the record's flags
export function setWindowFlags(w, a, b, c) {
  const rec = r16(w, slotAddr(a));
  wr(w, rec, c & 1 ? rd(w, rec) | b : rd(w, rec) & ~b & 0xFF);
}
export const getWindowFlags = (w, a) => rd(w, r16(w, slotAddr(a))) & 3;   // 05:4CC1 GetWindowFlags
// 05:5A51 SetWindowText: slot b (up to 5) gets text id hl (the priority bits kept)
export function setWindowText(w, b, hl) {
  if (b > 5) return;
  const p = slotAddr(b) + 2;
  wr(w, p, (rd(w, p) & 0xE0) | (hl >> 8)); wr(w, p + 1, hl & 0xFF);
}

// 05:4949 UpdateWindows: priorities 1 to 8, each slot in turn: one marked for closing has its rows queued and is
// freed; the message window is rendered by 05:5B03 (msgbox.js; drawn as the others when it has no text); the others are drawn into the shadow, queued, and
// their text (unless the slot's text bits are 3) printed inside the frame (one tile further right in a menu) and
// queued again; $D840 = the windows drawn
export function* updateWindows(sh) {
  const w = sh.w;
  wr(w, 0xD83F, 0);
  setW(w, 5);
  for (let c = 1; c <= 8; c++) {
    for (let s = 0; s < 6; s++) {
      const p = slotAddr(s);
      const pri = (rd(w, p + 2) >> 5) & 7;
      if (pri !== c) continue;
      wr(w, 0xD821, s);
      const hi = rd(w, p + 1);
      wr(w, p + 1, (hi & 0x0F) | 0xD0);
      if ((hi & 0xF0) === 0xC0) {
        wr(w, 0xD85E, 1);
        yield* copyWindowRowsFramed(sh, rd(w, 0xD821));
        wr(w, 0xD85E, 0);
        freeWindowSlot(w, rd(w, 0xD821));
        continue;
      }
      if (rd(w, 0xD824) === rd(w, 0xD821)) {    // the message window: 05:5B03 RenderMessageWindow (with text)
        yield* renderMessageWindow(sh);
        if (!rd(w, 0xD85F)) { wr(w, 0xD83F, (rd(w, 0xD83F) + 1) & 0xFF); continue; }
      }
      const rec = r16(w, p);
      drawWindowToShadow(w, rec);
      yield* copyWindowRowsFramed(sh, rd(w, 0xD821));
      wr(w, 0xD83F, (rd(w, 0xD83F) + 1) & 0xFF);
      const f = rd(w, rec);
      let d = (rd(w, rec + 1) + 1) & 0xFF;
      if (f & 2) d = (d + 1) & 0xFF;
      const e = (rd(w, rec + 2) + 1) & 0xFF;
      if ((rd(w, p + 2) & 3) === 3) continue;
      T.loadText(w, rd(w, p + 2) << 8 | rd(w, p + 3));   // 05:6179
      yield* printText(sh, 0xC600, d, e);
      wr(w, 0xD85E, 1);
      yield* copyWindowRowsFramed(sh, rd(w, 0xD821));
      wr(w, 0xD85E, 0);
    }
  }
  wr(w, 0xD840, rd(w, 0xD83F));
}

// 05:5885 ClampPenToLine: de (a shadow address) back a row unless on row [$D82B]; kept in $D000-$D3FF
export function clampPenToLine(w, de) {
  if (((de >> 5) & 0x1F) !== rd(w, 0xD82B)) de = (de - 0x20) & 0xFFFF;
  return ((de & 0x3FF) | 0xD000) & 0xFFFF;
}

// 05:5235 PrintText: hl = string, (d, e) = the pen's tile in the shadow: glyphs drawn at the pen (03:4D93, 03:4DF0)
// with the typing delay; control codes below $20 ($DE / $DF as $1E / $1F, $0E with its argument) through
// TextControlDispatch; $00 ends (03:4F7D FinishTextBlock). A page pending ($D850) keeps the resume pointer. The
// shadow address moves one per char (the code's row wrap at 32 restores de: it does nothing)
export function* printText(sh, hl, d, e) {
  const w = sh.w;
  if (rd(w, 0xD84F) && rd(w, 0xD821) === rd(w, 0xD824)) {
    hl = (r16(w, 0xD84E) + hl + 0x3A00) & 0xFFFF;
    wr(w, 0xD84F, 0);
  }
  if (!rd(w, 0xD821)) { wr(w, 0xC36E, 0); wr(w, 0xC36F, 0); }
  D.inBank(w, 3, () => T.initTextPen(w));
  yield* flushMessageWindowRows(sh);
  wr(w, 0xD82A, d & 0x1F); wr(w, 0xD82B, e & 0x1F);
  let de = shadowTileAddr(d, e);
  for (;;) {
    if (rd(w, 0xD850)) { wr(w, 0xD84E, hl & 0xFF); wr(w, 0xD84F, hl >> 8); return; }
    wr(w, 0xD869, hl & 0xFF); wr(w, 0xD86A, hl >> 8);
    let a = rd(w, hl); hl = (hl + 1) & 0xFFFF;
    if (!a) { yield* T.finishTextBlock(sh); return; }
    let code = -1;
    if (a === 0xDE) code = 0x1E;
    else if (a === 0xDF) code = 0x1F;
    else if (a === 0x0E) { wr(w, 0xC361, rd(w, hl)); hl = (hl + 1) & 0xFFFF; code = 0x0E; }
    else if (a < 0x20) code = a;
    if (code >= 0) {
      de = yield* T.textControlDispatch(sh, code, de);
      yield* flushMessageWindowRows(sh);
      continue;
    }
    de = clampPenToLine(w, de);
    D.inBank(w, 3, () => { T.drawNextChar(w); T.uploadCurrentCharTiles(w); });
    a = rd(w, hl);
    if (a !== 0xDE && a !== 0xDF) yield* T.textCharDelay(sh, a);
    de = (de + 1) & 0xFFFF;
  }
}

// 05:5C3B MeasureTextBox: wTextBuffer $C600's size: b = the widest line in tiles (rounded up) + 3, c = lines * 2 + 1
// (lines split by $01; codes $10-$13 one pixel; chars $20-$7A their widths)
export function measureTextBox(w) {
  let hl = 0xC600, b = 0, d = 0, e = 0;
  for (;;) {
    const a = rd(w, hl); hl = (hl + 1) & 0xFFFF;
    if (a === 0) break;
    if (a === 1) { e++; if (d < b) d = b; b = 0; continue; }
    if (a === 8) notPorted("measuring a byte argument (~05:5679 MeasureByteArg)");
    if (a === 9) notPorted("measuring a number argument (~05:56E2 MeasureNumberArg)");
    if (a >= 0x10 && a <= 0x13) { b = (b + 1) & 0xFF; continue; }
    if (a < 0x20 || a >= 0x7B) continue;
    b = (b + T.getCharWidth(a)) & 0xFF;
  }
  e = (e + 1) & 0xFF;
  if (d < b) d = b;
  d = ((d >> 3) + (d & 7 ? 1 : 0) + 3) & 0xFF;
  return [d, ((e << 1) + 1) & 0xFF];
}

// 05:4BB0 OpenMenuWindow: hl = text id, (d, e) = position from the scroll's tile: a window sized to the text
// (priority 1, glyph rows led by a blank), the text and the menu flag set, pushed on the menu stack ($D832: rows
// << 4 | cursor, window; the cursor of the menu below kept in its entry); returns the slot ($FF: none)
export function* openMenuWindow(sh, hl, d, e) {
  const w = sh.w;
  setW(w, 5);
  yield* beginWindowText(sh);
  T.loadText(w, hl);                             // 05:6179
  const [sd, se] = getScrollTilePos(w);
  d = (d + sd) & 0x1F; e = (e + se) & 0x1F;
  const [b, c] = measureTextBox(w);
  const r = (c - 1) & 0xFF;
  wr(w, 0xD831, (r >> 1) | (r & 0x80));
  wr(w, 0xD86C, 1);
  openWindowBuffered(w, 1, d, e, b, c);
  const s = rd(w, 0xD820);
  wr(w, 0xD86C, 0);
  if (s === 0xFF) return s;
  setWindowText(w, s, hl);
  setWindowFlags(w, s, 2, 1);
  let dep = rd(w, 0xD83E);
  if (dep !== 0xFF) {
    const q = 0xD832 + ((dep << 1) & 0xFF);
    wr(w, q, (rd(w, q) & 0xF0) | rd(w, 0xD830));
  }
  dep = (rd(w, 0xD83E) + 1) & 0xFF;
  wr(w, 0xD83E, dep);
  const q = 0xD832 + ((dep << 1) & 0xFF);
  wr(w, q, (rd(w, 0xD831) << 4) & 0xFF);
  wr(w, 0xD82F, s);
  wr(w, q + 1, s);
  wr(w, 0xD830, 0);
  return s;
}

// the bit of a menu-option mask (bit 7: on) for the cursor's row (rrc b cursor + 1 times, rlc once)
const maskBit = (m, cur) => {
  let b = m & 0x7F;
  for (let k = (cur + 1) & 0xFF; ; ) { b = ((b >> 1) | (b << 7)) & 0xFF; k = (k - 1) & 0xFF; if (!k) break; }
  b = ((b << 1) | (b >> 7)) & 0xFF;
  return b & 1;
};

// 05:4CD7 RunMenu: the cursor in menu window [$D82F] from row [$C3F9] (then cleared); buttons let go first; Up /
// Down move it (sound $5B), A picks the row ($5C; the cursor tile $0D left in the window), B (or Start with
// wMenuFlags $C3FC bit 7) cancels ($FF, $5D); rows whose bit is set in wMenuLRMask $C3FA report Left / Right in
// $C3FC; a paged window (flags 3, read from slot 0's record) returns $FE / $FD for Left / Right. Restores the WRAM
// bank.
export function* runMenu05(sh) {
  const w = sh.w, old = wbank(w);
  setW(w, 5);
  wr(w, 0xD844, 0); wr(w, 0xD845, 0); wr(w, 0xD842, 0xFF); wr(w, 0xD843, 0xFF);
  const rec = r16(w, slotAddr(rd(w, 0xD82F)));
  const d = (rd(w, rec + 1) + 1) & 0xFF, e = (rd(w, rec + 2) + 1) & 0xFF;
  wr(w, 0xD830, rd(w, 0xC3F9));
  wr(w, 0xC3F9, 0);
  let p = shadowTileAddr(d, (((rd(w, 0xD830) << 1) & 0xFF) + e) & 0xFF);
  wr(w, 0xD841, 0); wr(w, 0xD842, p & 0xFF); wr(w, 0xD843, p >> 8);
  registerFrameTask(w, 0x01, 0x05, 0x4F20);      // MenuCursorTask
  const flags = rd(w, 0xC3FC);
  let mask = 0x03;
  if (flags & 0x40) {
    if (rd(w, 0xC3FA) & 0x80) { wr(w, 0xC3FC, (flags & 0xF0) | 3); mask = 0x3B; }
    else { wr(w, 0xC3FC, flags & 0xF0); mask = 0x0B; }
  } else wr(w, 0xC3FC, flags & 0xF0);
  do yield* sh.advance(); while (w.high[0x190] & mask);
  let b = rd(w, 0xD830);
  let a;
  for (;;) {
    yield* sh.advance();
    const rep = w.high[0x191];
    if (rep & 1) {                               // A
      wr(w, 0xD830, b);
      sh.sound(0x5C);
      unregisterFrameTask(w, 0x05, 0x4F20);
      yield* sh.advance();
      setWindowTile(w, rd(w, 0xD82F), 1, (((rd(w, 0xD830) << 1) + 1) & 0xFF), 0x0D, 0x80);
      setW(w, old);
      return b;
    }
    let moved = false;
    if (rep & 0x40) { b = (b - 1) & 0xFF; if (b & 0x80) b = (rd(w, 0xD831) - 1) & 0xFF; moved = true; }
    else if (rep & 0x80) { b = (b + 1) & 0xFF; if (b >= rd(w, 0xD831)) b = 0; moved = true; }
    if (moved) {
      sh.sound(0x5B);
      wr(w, 0xD841, 0);
      writeShadowTile(w, 0x20, d, (((b << 1) & 0xFF) + e) & 0xFF);
      const v = (r16(w, 0xD842) + 0x3000 + 0x9800) & 0xFFFF;
      wr(w, 0xD844, v & 0xFF); wr(w, 0xD845, v >> 8);
      p = shadowTileAddr(d, (((b << 1) & 0xFF) + e) & 0xFF);
      wr(w, 0xD842, p & 0xFF); wr(w, 0xD843, p >> 8);
      wr(w, 0xD830, b);
    }
    if (w.high[0x194] & 8 && rd(w, 0xC3FC) & 0x80) {   // Start
      wr(w, 0xC3FC, rd(w, 0xC3FC) & 0xF0);
      sh.sound(0x5D);
      a = 0xFF; wr(w, 0xD830, a); break;
    }
    if (w.high[0x191] & 2) {                     // B
      sh.sound(0x5D);
      wr(w, 0xC3FC, rd(w, 0xC3FC) & 0xF0);
      a = 0xFF; wr(w, 0xD830, a); break;
    }
    const lr = rd(w, 0xC3FA);
    if (lr & 0x80 && maskBit(lr, rd(w, 0xD830)) && !(w.high[0x191] & 0xC0)) {
      if (w.high[0x191] & 0x20) { wr(w, 0xC3FC, (rd(w, 0xC3FC) & 0xF0) | 1); a = rd(w, 0xD830); break; }
      if (w.high[0x191] & 0x10) { wr(w, 0xC3FC, (rd(w, 0xC3FC) & 0xF0) | 2); a = rd(w, 0xD830); break; }
    }
    if (getWindowFlags(w, 0) !== 3) continue;    // (a = 0 here: slot 0's flags)
    const pages = (rd(w, 0xC32D) - 1) & 0xFF;
    if (!(((pages >> 2) | (pages & 0x80 ? 0xC0 : 0)) & 0xFF)) continue;
    if (w.high[0x191] & 0x20) a = 0xFE;
    else if (w.high[0x191] & 0x10) a = 0xFD;
    else continue;
    wr(w, 0xD830, a);
    break;
  }
  unregisterFrameTask(w, 0x05, 0x4F20);
  yield* sh.advance();
  const dep = rd(w, 0xD83E);
  if (dep) {
    const q = 0xD832 + (((dep - 1) << 1) & 0xFF);
    setWindowTile(w, rd(w, q + 1) & 0x0F, 1, (((rd(w, q) & 0x0F) << 1) + 1) & 0xFF, 0x20, 0x80);
  }
  setW(w, old);
  return a;
}

// 41:726C MenuTileAddr + 41:7BB4 PutMenuTile: tile l (attribute $80) at (d, e) inside the menu window [$C3F8] (its
// record's x, y added; 05:414F, + $C800 into the BG map), through the BG tile write queue
export function putMenuTile(w, l, d, e) {
  const old = w.high[0x196];
  setW(w, 5);
  const rec = rd(w, 0xD800 + ((rd(w, 0xC3F8) << 2) & 0xFF)) | rd(w, 0xD801 + ((rd(w, 0xC3F8) << 2) & 0xFF)) << 8;
  const x = (rd(w, rec + 1) + d) & 0x1F, y = (rd(w, rec + 2) + e) & 0x1F;
  setW(w, old);
  D.queueBGTileWrite(w, (0xD000 + (y << 5) + x + 0x3000 + 0x9800) & 0xFFFF, l, 0x80);
}

// 05:4F20 MenuCursorTask: the cursor tile at [$D842] (in VRAM: + $C800) blinks between $0D and blank by bit 4 of
// [$D841]; the old position [$D844] is blanked once. With flag #48 (the Settings menu) the arrows right of rows 0 and 1
// are blanked; on its Left / Right rows (wMenuLRMask $C3FA) instead the arrows blink at the cursor's row (tiles $0C at
// x 1 and $0D at x 13; blank at x 1) and the cursor tile is not drawn. (Flags #49-#52: other menus' arrows, not
// ported.) Leaves WRAM5 mapped
export function menuCursorTask(w) {
  setW(w, 5);
  const fl = w.wram[0][0x846] & 0xF8;            // flags #48-#52
  if (fl & 0x78) notPorted("the menu cursor's arrows for flags #49-#52 (~05:4F8F, 05:509A)");
  const lr = rd(w, 0xC3FA);
  if (lr & 0x80 && maskBit(lr, rd(w, 0xD830)) && fl) {   // 05:500A a Left / Right row with flag #48: the arrows
    if (rd(w, 0xD845)) { D.queueBGTileWrite(w, r16(w, 0xD844), 0x20, 0x80); wr(w, 0xD845, 0); }
    setW(w, 5);
    wr(w, 0xD841, (rd(w, 0xD841) + 1) & 0xFF);
    D.inBank(w, 0x41, () => {
      putMenuTile(w, 0x20, 0x0D, 0x01); putMenuTile(w, 0x20, 0x0D, 0x03);
      const y = rd(w, 0xD830) ? 3 : 1;
      if (!(rd(w, 0xD841) & 0x10)) { putMenuTile(w, 0x0C, 0x01, y); putMenuTile(w, 0x0D, 0x0D, y); }
      else putMenuTile(w, 0x20, 0x01, y);        // 05:517E (05:5184 MenuBlinkPhase)
    });
    return;
  }
  if (fl & 0x80) D.inBank(w, 0x41, () => { putMenuTile(w, 0x20, 0x0D, 0x01); putMenuTile(w, 0x20, 0x0D, 0x03); });   // 05:4F7D
  const t = rd(w, 0xD841) & 0x10 ? 0x20 : 0x0D;
  D.queueBGTileWrite(w, (r16(w, 0xD842) + 0x3000 + 0x9800) & 0xFFFF, t, 0x80);
  wr(w, 0xD841, (rd(w, 0xD841) + 1) & 0xFF);
  if (rd(w, 0xD845)) {
    D.queueBGTileWrite(w, r16(w, 0xD844), 0x20, 0x80);
    wr(w, 0xD845, 0);
  }
}

