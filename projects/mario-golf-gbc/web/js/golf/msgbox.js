// Bank 05's message boxes (REVERSE.md "Message boxes") and bank 0A's script text calls on them: a message window
// (wMessageWindow $D824) opened as a 20 x 7 box at the bottom or top of the screen by the speaker's row, grown in 8
// steps to the text's measured size, its text typed page by page (code $02 waits for a button with a blinking
// arrow and leaves the rest pending in wTextResumePtr $D84E), and the Yes / No menu the scripts ask with.
import { rb } from "./rom.js";
import * as D from "./render/display.js";
import * as T from "./text.js";
import * as W from "./windows.js";
import { restoreShadowFromMap, copyMapRowToShadow } from "./shadow.js";
import { printHexByte } from "./match.js";
import { waitScriptActorIdle } from "./script.js";

const rd = D.rd, wr = D.wr;
const wbank = w => w.high[0x196];
const setW = (w, n) => D.setWramBank(w, n);
const r16 = (w, a) => rd(w, a) | rd(w, (a + 1) & 0xFFFF) << 8;
const testFlag = (w, n) => w.wram[0][0x840 + (n >> 3)] & (0x80 >> (n & 7));
const slotAddr = a => (0xD800 + ((a << 2) & 0xFF)) & 0xFFFF;
const sra = v => ((v >> 1) | (v & 0x80)) & 0xFF;
function notPorted(what) { throw new Error(`${what} is not ported`); }
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}
const widthOf = (w, hl) => {                     // the sum of GetCharWidth 03:4B89 over a zero-terminated string
  let b = 0;
  for (;; hl = (hl + 1) & 0xFFFF) { const a = rd(w, hl); if (!a) return b; b = (b + T.getCharWidth(a)) & 0xFF; }
};
const clearArgCounters = w => { for (const a of [0xD847, 0xD866, 0xD848, 0xD867, 0xD849, 0xD868]) wr(w, a, 0); };

// ---- measuring (SizeMessageBox's helpers) ----
// 05:55CB MeasureStringArg: the next $04 argument (counter $D866; no end check) copied from its WRAM bank to
// wTextArgBuffer $C780 ($20 bytes; leaves WRAM5 mapped); its width
function measureStringArg(w) {
  setW(w, 5);
  const n = rd(w, 0xD866);
  wr(w, 0xD866, (n + 1) & 0xFF);
  let hl = r16(w, (0xDFAE + ((n << 1) & 0xFF)) & 0xFFFF);
  const bank = ((hl >> 8) >> 1 & 0x7F) >> 3;
  if (bank) { hl = (((hl >> 8) & 0x0F) | 0xD0) << 8 | (hl & 0xFF); setW(w, bank); }
  else { hl = (((hl >> 8) & 0x0F) | 0xC0) << 8 | (hl & 0xFF); setW(w, 0); }
  D.copyMemoryBC(w, hl, 0xC780, 0x20);
  setW(w, 5);
  return widthOf(w, 0xC780);
}
// 05:5679 MeasureByteArg: the next $08 argument's short text loaded (counter $D868); quirk: its widths are added to
// a b that is never updated, so the width is 0
function measureByteArg(w) {
  const n = rd(w, 0xD868);
  wr(w, 0xD868, (n + 1) & 0xFF);
  T.loadTextShort(w, rd(w, (0xDFEE + n) & 0xFFFF));
  return 0;
}
// 05:56E2 MeasureNumberArg: the next $09 number (counter $D867): its digit count from the first power of ten
// (10000, 1000, 100, 10) it is not below (as signed 16-bit differences; that difference is kept), each digit's width
// (the digit found by subtracting PowersOfTenTable 05:577C)
function measureNumberArg(w) {
  const n = rd(w, 0xD867);
  wr(w, 0xD867, (n + 1) & 0xFF);
  const v = r16(w, (0xDFCE + ((n << 1) & 0xFF)) & 0xFFFF);
  let hl = v, a = 1;
  for (const [k, p] of [[5, 10000], [4, 1000], [3, 100], [2, 10]]) {
    const t = (hl - p) & 0xFFFF;
    if (!(t & 0x8000)) { hl = t; a = k; break; }
  }
  let b = 0;
  for (; a; a--) {
    const de = [1, 10, 100, 1000, 10000][a - 1];
    let digit = 0;
    for (;;) { hl = (hl - de) & 0xFFFF; if (hl & 0x8000) break; digit++; }
    hl = (hl + de) & 0xFFFF;
    b = (b + T.getCharWidth((digit + 0x30) & 0xFF)) & 0xFF;
  }
  return b;
}
function measureShort(w, id) {                   // 05:579E MeasureCourseName / 05:57FD MeasureCharName / 05:5857 MeasurePlacing
  T.copyTextShortToDE(w, id, 0xC780);
  return widthOf(w, 0xC780);
}

// 05:5B3B SizeMessageBox: measures wTextBuffer (or from the resume pointer $D84E) to its page end ($00 or $02):
// wTextBoxWidth $D854 = the widest line in tiles (printed to the debug text buffer), and the record of wMessageWindow
// (slot 0's with none: a zero pointer, whose writes go to the MBC's registers) rebuilt to that size centred in its
// box ($D825-$D828); $D867 = the record's flags byte (05:4773 returns it)
export function sizeMessageBox(w) {
  let hl = rd(w, 0xD84F) ? r16(w, 0xD84E) : 0xC600;
  let b = 0, d = 0, e = 0;
  for (;;) {
    const a = rd(w, hl); hl = (hl + 1) & 0xFFFF;
    if (a === 0 || a === 2) break;
    if (a === 1) { e = (e + 1) & 0xFF; if (d < b) d = b; b = 0; continue; }
    let add = -1;
    if (a === 8) add = measureByteArg(w);
    else if (a === 9) add = measureNumberArg(w);
    else if (a === 7) add = widthOf(w, 0xC800);  // 05:5634 MeasurePlayerName
    else if (a === 4) add = measureStringArg(w);
    else if (a === 0x0B) add = measureShort(w, (0x3C + rd(w, 0xD85D)) & 0xFFFF);
    else if (a === 0x0E) { wr(w, 0xC361, rd(w, hl)); hl = (hl + 1) & 0xFFFF; add = measureShort(w, (0x43 + rd(w, 0xC361)) & 0xFFFF); }
    else if (a === 0x0F) add = measureShort(w, 0x1CA3 + (rd(w, 0xDFCE) & 3));
    else if (a >= 0x20 && a < 0x7B) add = T.getCharWidth(a);
    if (add >= 0) b = (b + add) & 0xFF;
  }
  e = (e + 1) & 0xFF;
  if (d < b) d = b;
  d = ((d >> 3) + (d & 7 ? 1 : 0)) & 0xFF;
  wr(w, 0xD854, d);
  printHexByte(w, d, 0x0A0C);                    // 00:22A5 (a leftover)
  const bw = (d + 2) & 0xFF, ch = ((e << 1) + 1) & 0xFF;
  let s = rd(w, 0xD824);
  if (s === 0xFF) s = 0;
  const rec = r16(w, slotAddr(s));
  const x = (sra((rd(w, 0xD827) - bw) & 0xFF) + rd(w, 0xD825)) & 0xFF;
  const y = (sra((rd(w, 0xD828) - ch) & 0xFF) + rd(w, 0xD826)) & 0xFF;
  const f = rd(w, rec);
  W.buildTextWindowRecord(w, rec, x, y, bw, ch);
  wr(w, 0xD867, f);
}

// 05:5AA8 RenderWindowText: slot b (up to 5): a pending page cleared; text high bits 3 (none): $D85F = 1; else
// $D85F = 0, the text loaded (05:6179), the message box sized, drawn into the shadow and the text printed inside it
export function* renderWindowText(sh, b) {
  const w = sh.w;
  if (b > 5) return;
  const p = slotAddr(b);
  const rec = r16(w, p), hi = rd(w, p + 2) & 0x1F, lo = rd(w, p + 3);
  if (rd(w, 0xD850)) wr(w, 0xD850, 0);
  wr(w, 0xD85F, 1);
  if (hi === 3) return;
  wr(w, 0xD85F, 0);
  T.loadText(w, hi << 8 | lo);
  sizeMessageBox(w);
  const d = (rd(w, rec + 1) + 1) & 0xFF, e = (rd(w, rec + 2) + 1) & 0xFF;
  W.drawWindowToShadow(w, rec);
  yield* W.printText(sh, 0xC600, d, e);
}
export function* renderMessageWindow(sh) { yield* renderWindowText(sh, rd(sh.w, 0xD824)); }   // 05:5B03

// 05:5A96 SetMessageText: hl (NormalizeTextId) on the message window
export function setMessageText(w, hl) { W.setWindowText(w, rd(w, 0xD824), T.normalizeTextId(hl, 0)); }

// 05:5D1F SetTextDelayFromOption: wTextCharDelay $D829 = 0 / 2 / 4 by wTextSpeed $C82D 0 / 1 / other (0 with bit 7)
function setTextDelayFromOption(w) {
  const a = rd(w, 0xC82D);
  wr(w, 0xD829, a & 0x80 ? 0 : a === 0 ? 0 : a === 1 ? 2 : 4);
}
// 05:6472 GetActorPtr: actor a (< $18) -> $D000 + a x $40 (WRAM4); $FF: 0; $18 or more: $D000
export const getActorPtr = a => (a === 0xFF ? 0 : a >= 0x18 ? 0xD000 : (0xD000 + (((a << 8) >> 2) & 0xFFFF)) & 0xFFFF);
// 05:667B GetSpeakerVoice: SpeakerVoiceTable 05:66C0 (pairs, $FF ends) by the actor's +$30 byte: the voice (8 and
// up: 8 = none)
function getSpeakerVoice(w, a) {
  const hl = getActorPtr(a);
  if (!hl) return 8;
  const old = wbank(w);
  setW(w, 4);
  const c = rd(w, (hl & 0xFF00) | ((hl + 0x30) & 0xFF));
  let b = 8;
  for (let p = 0x66C0; ; p += 2) {
    const k = rb(0x05, p);
    if (k === 0xFF) break;
    if (k === c) { b = Math.min(rb(0x05, p + 1), 8); break; }
  }
  setW(w, old);
  return b;
}

// 05:4B20 OpenMessageWindow: d e = screen tile, b c = size: BeginWindowText, the box ($D825-$D828, the position
// relative to the scroll), a buffered window (priority 2) made wMessageWindow
function* openMessageWindow(sh, d, e, b, c) {
  const w = sh.w;
  setW(w, 5);
  yield* W.beginWindowText(sh);
  wr(w, 0xD827, b); wr(w, 0xD828, c);
  const [sd, se] = W.getScrollTilePos(w);
  d = (d + sd) & 0x1F; e = (e + se) & 0x1F;
  wr(w, 0xD825, d); wr(w, 0xD826, e);
  W.openWindowBuffered(w, 2, d, e, b, c);
  const s = rd(w, 0xD820);
  if (s !== 0xFF) wr(w, 0xD824, s);
}

// 05:5F62 OpenMessageBoxNearSpeaker: a = actor (bit 7: none: the box's row is a & $3F); the box at row 11 (lower,
// $D85C = 1) when the actor's screen row is under 10, else row 0 (one lower / higher by the map scroll's sign); the
// text measured (the record resized), then the window grown from 3 x 3 (4 wide for an even width) near the middle to
// that size, one step per UpdateWindows; the steps are the width / 2 (a loop count left by "rr a" on the width, the
// carry of [$D826] + 2 rotated in; 0 would be 256)
function* openMessageBoxNearSpeaker(sh, a, hl) {
  const w = sh.w;
  const old = wbank(w);
  let e = a & 0x3F, b = (a << 1) & 0xFF;         // (rl b: b is the actor shifted; it is the box's side flag only below)
  if (!(a & 0x80)) {
    const p = getActorPtr(a & 0x3F);
    const cam = rd(w, 0xC323);
    w.high[0x1E0] = p & 0xFF; w.high[0x1E1] = p >> 8;
    setW(w, 4);
    const row = (rd(w, (((p & 0xFF) + 6) & 0xFF | (p & 0xFF00)) + 1 & 0xFFFF) - cam) & 0xFF;
    if (row >= 0x0A) { e = 0; b = 0; if (!(rd(w, 0xC322) & 0x80)) e = 1; }
    else { e = 0x0B; b = 1; if (rd(w, 0xC322) & 0x80) e = 0x0A; }
  }
  setW(w, 5);
  wr(w, 0xD85C, b);
  setW(w, old);
  yield* openMessageWindow(sh, 0, e, 0x14, 0x07);
  T.loadText(w, hl);                             // 05:6179
  sizeMessageBox(w);
  wr(w, 0xD866, 0); wr(w, 0xD868, 0);
  const rec = r16(w, slotAddr(rd(w, 0xD824)));
  wr(w, 0xD858, rec & 0xFF); wr(w, 0xD859, rec >> 8);
  for (let k = 0; k < 5; k++) wr(w, 0xC600 + k, rd(w, rec + k));   // the target: flags x y w h
  let d = (rd(w, 0xD825) + 8) & 0xFF;
  const carry = rd(w, 0xD826) + 2 > 0xFF ? 0x80 : 0;
  e = (rd(w, 0xD826) + 2) & 0xFF;
  let bb = 3, c = 3;
  const wd = rd(w, 0xC603);
  if (!(wd & 1)) bb++;                           // an even width starts 4 wide
  let n = (wd >> 1) | carry;
  yield* restoreShadowFromMap(sh);
  do {
    W.buildTextWindowRecord(w, r16(w, 0xD858), d, e, bb, c);
    yield* W.updateWindows(sh);
    d = (d - 1) & 0xFF;
    if (d < rd(w, 0xC601)) d = rd(w, 0xC601);
    e = (e - 1) & 0xFF;
    if ((e - rd(w, 0xC602)) & 0x80) e = rd(w, 0xC602);
    bb = (bb + 2) & 0xFF;
    if (rd(w, 0xC603) < bb) bb = rd(w, 0xC603);
    c = (c + 1) & 0xFF;
    if (rd(w, 0xC604) < c) c = rd(w, 0xC604);
    n = (n - 1) & 0xFF;
  } while (n);
}

// 05:5D49 ShowMessage / 05:5DE5 ShowMessageKeepOpen: hl = text id, a = speaker ($FF: the player's actor): the
// argument counters cleared, the voice (8 with the speaker's bit 7), the box opened near the speaker unless one is
// open; each page: the glyph buffer cleared and uploaded, the text set, the shadow redrawn and the windows updated
// (the message window printing it); ShowMessage then closes the box
function* showMessageBody(sh, hl, a, keep) {
  const w = sh.w, old = wbank(w);
  setW(w, 5);
  clearArgCounters(w);
  hl = T.normalizeTextId(hl, 0);
  if (a === 0xFF) a = rd(w, 0xC296);
  wr(w, 0xD851, a);
  setTextDelayFromOption(w);
  wr(w, 0xD862, a & 0x80 ? 8 : getSpeakerVoice(w, a));
  if (rd(w, 0xD824) === 0xFF) yield* openMessageBoxNearSpeaker(sh, rd(w, 0xD851), hl);
  do {
    const o = wbank(w);
    setW(w, 7);
    D.inBank(w, 3, () => T.clearGlyphBuffer(w));
    yield* inBankGen(w, 3, T.uploadGlyphBuffer(sh));
    setW(w, o);
    setMessageText(w, hl);
    yield* restoreShadowFromMap(sh);
    yield* W.updateWindows(sh);
  } while (rd(w, 0xD850));
  if (!keep) {
    W.closeWindow(w, rd(w, 0xD824));
    wr(w, 0xD824, 0xFF);
    yield* restoreShadowFromMap(sh);
    yield* W.updateWindows(sh);
  }
  clearArgCounters(w);
  setW(w, old);
}
export function* showMessage(sh, hl, a) { yield* showMessageBody(sh, hl, a, false); }
export function* showMessageKeepOpen(sh, hl, a) { yield* showMessageBody(sh, hl, a, true); }

// 05:44E3 RestoreMapUnderWindow: slot a: the map rows under it copied back into the shadow (rows from y, + 32 when
// the scroll's row is not below it)
function restoreMapUnderWindow(w, a) {
  const rec = T.getWindowRecord(w, a);
  let b = rd(w, rec + 2);
  const c = rd(w, rec + 4);
  if (rd(w, 0xC323) >= b) b = (b + 0x20) & 0xFF;
  for (let k = 0; k < c; k++) copyMapRowToShadow(w, (b + k) & 0xFF);
}
// 05:6729 RefreshWindowText: slot a: the message window re-renders its pages (the glyphs cleared and uploaded, the
// map under it restored); another window is redrawn and its text printed again
export function* refreshWindowText(sh, a) {
  const w = sh.w, old = wbank(w);
  setW(w, 5);
  if (rd(w, 0xD824) === a) {
    wr(w, 0xD821, a);
    do {
      const o = wbank(w);
      setW(w, 7);
      D.inBank(w, 3, () => T.clearGlyphBuffer(w));
      yield* inBankGen(w, 3, T.uploadGlyphBuffer(sh));
      setW(w, o);
      restoreMapUnderWindow(w, rd(w, 0xD824));
      yield* renderMessageWindow(sh);
    } while (rd(w, 0xD850));
  } else {
    const p = slotAddr(a);
    const rec = r16(w, p);
    W.drawWindowToShadow(w, rec);
    let d = (rd(w, rec + 1) + 1) & 0xFF;
    if (rd(w, rec) & 2) d = (d + 1) & 0xFF;
    const e = (rd(w, rec + 2) + 1) & 0xFF;
    T.loadText(w, (rd(w, p + 2) & 0x1F) << 8 | rd(w, p + 3));
    yield* W.printText(sh, 0xC600, d, e);
  }
  setW(w, old);
}
// 05:679F CopyWindowToVRAM: slot a's rows queued (CopyWindowRowsFramed) with WRAM5 mapped
export function* copyWindowToVRAM(sh, a) {
  const w = sh.w, old = wbank(w);
  setW(w, 5);
  yield* W.copyWindowRowsFramed(sh, a);
  setW(w, old);
}
// 05:67BB RemoveWindow: slot a: the map under it restored, its rows queued, closed
export function* removeWindow(sh, a) {
  restoreMapUnderWindow(sh.w, a);
  yield* W.copyWindowRowsFramed(sh, a);
  W.closeWindow(sh.w, a);
}

// ---- bank 0A: the scripts' text calls ----
// 0A:410D ScriptWaitFrames: a frames (2 while flag #22 skips); a = 0: returns at once (with af / bc left on the
// stack: never called so)
export function* scriptWaitFrames(sh, a) {
  if (testFlag(sh.w, 22)) a = 2;
  if (!a) notPorted("ScriptWaitFrames with a = 0 (~0A:411F: returns into its own pushes)");
  yield* sh.advance(a);
}
// 0A:4124 ScriptSetText: hl = text id on the message window and the script's text cursor wScriptTextId $D852
export function scriptSetText(w, hl) {
  const old = wbank(w);
  setW(w, 5);
  setMessageText(w, hl);
  wr(w, 0xD852, hl & 0xFF); wr(w, 0xD853, hl >> 8);
  setW(w, old);
}
// 0A:4164 ScriptShowText / 0A:4199 ScriptShowTextKeepOpen: a = speaker: (out of a round: 0A:48AC WaitScriptActorIdle)
// text wScriptTextId shown (skipped while flag #22), the cursor moved on
function* scriptShowBody(sh, a, keep) {
  const w = sh.w, old = wbank(w);
  if (!rd(w, 0xC96D)) yield* waitScriptActorIdle(sh);   // 0A:48AC
  setW(w, 5);
  const hl = r16(w, 0xD852);
  if (!testFlag(w, 22)) {
    if (keep) yield* inBankGen(w, 5, showMessageKeepOpen(sh, hl, a));
    else yield* inBankGen(w, 5, showMessage(sh, hl, a));
  }
  const n = (hl + 1) & 0xFFFF;
  wr(w, 0xD852, n & 0xFF); wr(w, 0xD853, n >> 8);
  setW(w, old);
}
export function* scriptShowText(sh, a) { yield* scriptShowBody(sh, a, false); }
export function* scriptShowTextKeepOpen(sh, a) { yield* scriptShowBody(sh, a, true); }
// 0A:41CE ScriptCloseText: CloseMessageWindow, RestoreShadowFromMap, UpdateWindows
export function* scriptCloseText(sh) {
  W.closeMessageWindow(sh.w);
  yield* inBankGen(sh.w, 5, restoreShadowFromMap(sh));
  yield* inBankGen(sh.w, 5, W.updateWindows(sh));
}
// 0A:4281 ScriptTextResumeLastPage: text wScriptTextId - 1 loaded; wTextResumePtr $D84E after its last $02 (kept
// when it has none)
function scriptTextResumeLastPage(w) {
  const id = T.normalizeTextId((r16(w, 0xD852) - 1) & 0xFFFF, 0);
  T.loadText(w, id);
  let de = 0;
  for (let hl = 0xC600, n = 0x180; n; n--) {
    const a = rd(w, hl);
    if (!a) break;
    hl = (hl + 1) & 0xFFFF;
    if (a === 2) de = hl;
  }
  if (de) { wr(w, 0xD84E, de & 0xFF); wr(w, 0xD84F, de >> 8); }
}
// 0A:4227 OpenYesNoWindow: the menu "Yes / No" (text $1A) at x 2, y 1 or $0A: by the speaker's screen row (its +7
// byte less the camera row; row 10 or more: y 1), or with no speaker ($80 bit) by its low bits (9 or more: y 1)
function* openYesNoWindow(sh) {
  const w = sh.w, old = wbank(w);
  const s = rd(w, 0xD851);
  let e;
  if (s & 0x80) e = (s & 0x7F) >= 9 ? 1 : 0x0A;
  else {
    const p = getActorPtr(s);                    // 0A:42E0 ActorSlotAddr (the same)
    const cam = rd(w, 0xC323);
    w.high[0x1E0] = p & 0xFF; w.high[0x1E1] = p >> 8;
    setW(w, 4);
    const row = (rd(w, (((p & 0xFF) + 4) & 0xFF | (p & 0xFF00)) + 3 & 0xFFFF) - cam) & 0xFF;
    e = row >= 0x0A ? 0x0A : 1;
  }
  setW(w, old);
  yield* inBankGen(w, 5, W.openMenuWindow(sh, 0x001A, 2, e));
}
// 0A:41D8 ScriptAskYesNo: the last page of the text shown again (no typing), the Yes / No menu over it (priority 6),
// its text drawn and queued, RunMenu: a = 0 Yes / 1 No / $FF B; the last page again, the menu removed
export function* scriptAskYesNo(sh) {
  const w = sh.w, old = wbank(w);
  setW(w, 5);
  scriptTextResumeLastPage(w);
  const delay = rd(w, 0xD829);
  wr(w, 0xD829, 0);
  yield* openYesNoWindow(sh);
  setWindowPriority(w, rd(w, 0xD82F), 6);        // 05:4C75
  yield* inBankGen(w, 5, refreshWindowText(sh, rd(w, 0xD82F)));
  yield* inBankGen(w, 5, copyWindowToVRAM(sh, rd(w, 0xD82F)));
  const b = yield* inBankGen(w, 5, W.runMenu05(sh));
  scriptTextResumeLastPage(w);
  yield* inBankGen(w, 5, removeWindow(sh, rd(w, 0xD82F)));
  wr(w, 0xD84F, 0);
  wr(w, 0xD82F, 0xFF);
  wr(w, 0xD829, delay);
  setW(w, old);
  return b;
}
// 05:4C75 SetWindowPriority: slot a's priority = b (its text-id high bits kept)
function setWindowPriority(w, a, b) {
  const p = slotAddr(a) + 2;
  wr(w, p, (rd(w, p) & 0x1F) | ((b << 5) & 0xFF));
}
