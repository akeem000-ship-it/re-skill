// The text printer's control-code dispatch, its inline strings and numbers, the cell-pointer wraps and some of the
// substitution measures (bank $05, src/engine/text/control_05.asm). Port of the gerbiljames/mario-tennis-gbc-disasm
// (MIT, third_party/mario-tennis-gbc-disasm): names and addresses are its own.
//
// A byte below $20 in a string is a control code (include/text_codes.inc), dispatched through ControlCodeHandlers_05
// ($05:548F). The handlers get the cell pointer (de: the shadow-map cell the printer is on) and may move it; the
// stream pointer (hl) is the dispatcher's to keep. Each handler here is a generator returning { de, ... } (the
// registers it leaves; some wait for frames: the delays, the page and button waits, the inline strings' typing).
// Covered by out/port/story1.mtrec (the player's name $07, the partner's $0B, pauses $06, pages $02 / $03) and
// web/tests/port/routines_text.mjs (every code, forced with prep).
import {
  WRAM_TEXT, FLAG, mapped, hook, testFlag, callHome, HOME, pushWramBank, Z, N,
} from "./common.js";
import { getGlyphWidth } from "./rows.js";
import { fetchShortText } from "./dialogue.js";
import { fetchShortTextToBuffer } from "./window_tilemap.js";
import { drawInlineGlyph } from "./glyph_font.js";
import { uploadLastGlyphTiles } from "./glyph_buffer.js";
import { delayTextCharacter } from "./window_text.js";
import { stampGlyphTileAtPen } from "./proportional.js";
import {
  textCmdNewline, textCmdNop, textCmdNextGlyphStreamRow, textCmdDelay30, textCmdDelay15Skippable, textCmdWaitButtonPage,
} from "./cursor.js";
import {
  waitTextAdvanceInput, textCmdPrintArgString, textCmdDelay150Skippable, textCmdApplyDakuten, textCmdApplyHandakuten,
  textCmdPrintPlayerName, textCmdPrintPartnerName,
} from "./arg.js";

export const wInlineTextBuffer = 0xC6C0;
const PowersOfTen_05 = 0x53A2;
const SHORT_TEXT_ROSTER = 0x001B;                            // $0E n prints short text $1B + n (the roster's names)

// TX_* (include/text_codes.inc)
export const TX = {
  END: 0x00, NEWLINE: 0x01, PAGE: 0x02, DONE: 0x03, ARG_STRING: 0x04, DELAY_30: 0x05, DELAY_15: 0x06,
  PLAYER_NAME: 0x07, SHORT_TEXT_ARG: 0x08, ARG_NUMBER: 0x09, NOP: 0x0A, PARTNER_NAME: 0x0B, DELAY_150: 0x0C,
  NEXT_GLYPH_ROW: 0x0D, SHORT_TEXT: 0x0E, DAKUTEN: 0xDE, HANDAKUTEN: 0xDF,
};

// TextCmdNop2 (05:5297, code $08), TextCmdNop0 (05:548E, $00), ControlCodeHandler16-19 (05:548A-548D, $10-$13):
// a bare ret each
function* noop(P, de) { return { de }; }

// ControlCodeHandlers_05 (05:548F): the handler of each code $00-$1F
const HANDLERS = [
  noop, textCmdNewline, textCmdWaitButtonPage, waitTextAdvanceInput, textCmdPrintArgString, textCmdDelay30,
  textCmdDelay15Skippable, textCmdPrintPlayerName, noop, textCmdPrintArgNumber, textCmdNop, textCmdPrintPartnerName,
  textCmdDelay150Skippable, textCmdNextGlyphStreamRow, textCmdPrintShortText, textCmdNewline,
  noop, noop, noop, noop, textCmdNewline, textCmdNewline, textCmdNewline, textCmdNewline, textCmdNewline,
  textCmdNewline, textCmdNewline, textCmdNewline, textCmdNewline, textCmdNewline, textCmdApplyDakuten,
  textCmdApplyHandakuten,
];
// DispatchControlCode (05:546C): run the handler of code `code` with the cell pointer `de` (the stream pointer,
// hl, is kept). Returns the registers the handler leaves ({ de, a, ... }).
export function* dispatchControlCode(P, code, de) {
  const handler = HANDLERS[code];
  if (!handler) throw new Error(`DispatchControlCode: code $${code.toString(16)} indexes past ControlCodeHandlers_05`);
  const out = yield* handler(P, de);
  const { hl, ...kept } = out || {};
  return { de, ...kept };
}

// GetNextArgShortTextLength (05:5298): the measuring pass for code $08: the next short-text id of
// wTextArgShortTextQueue, fetched; its length in characters (dakuten marks not counted)
export function getNextArgShortTextLength(P) {
  const R = mapped(P), index = R.textArgShortTextMeasureIndex;
  R.textArgShortTextMeasureIndex = (index + 1) & 0xFF;
  fetchShortText(P, P.bus.u8(P.A.textArgShortTextQueue + index));
  let n = 0;
  for (let p = P.A.shortTextBuffer; ; p++) {
    const ch = P.bus.u8(p);
    if (ch === 0) break;
    if (ch !== 0xDE && ch !== 0xDF) n = (n + 1) & 0xFF;
  }
  return n;
}

// TextCmdPrintArgNumber (05:52CE, code $09): print the next number of wTextArgNumberQueue (nothing when the queue
// is used up). Leaves a = the WRAM bank it put back.
export function* textCmdPrintArgNumber(P, de) {
  const R = mapped(P), oldBank = pushWramBank(P, WRAM_TEXT);
  const index = R.textArgNumberWriteIndex;
  if (index === R.textArgNumberCount) { P.wramBank(oldBank); return { de, a: oldBank }; }
  R.textArgNumberWriteIndex = (index + 1) & 0xFF;
  const value = P.bus.u16(P.A.textArgNumberQueue + ((index * 2) & 0xFF));
  P.wramBank(oldBank);
  const out = yield* renderInlineNumber(P, value, de);
  return { de: out.de, a: oldBank };
}

// MeasureNextArgNumberWidth (05:5305): the measuring pass for code $09: the width of the next queued number. It
// counts the digits right, but its digit loop keeps the high byte of the overshoot in a (inc a is overwritten), so
// each "digit" measured is that byte + $30: the widths come from past the glyph-width table.
export function measureNextArgNumberWidth(P) {
  const R = mapped(P), index = R.textArgNumberMeasureIndex;
  R.textArgNumberMeasureIndex = (index + 1) & 0xFF;
  let hl = P.bus.u16(P.A.textArgNumberQueue + ((index * 2) & 0xFF));
  const neg = v => (v & 0x8000) !== 0;
  let digits = 0;
  for (const [n, step] of [[5, 10000], [4, 1000], [3, 100], [2, 10]]) {
    const down = (0x10000 - step) & 0xFFFF;
    hl = (hl + down) & 0xFFFF;
    if (!neg(hl)) { digits = n; break; }
    hl = (hl + step) & 0xFFFF;
    do hl = (hl + down) & 0xFFFF; while (!neg(hl));
    hl = (hl + step) & 0xFFFF;
  }
  if (!digits) digits = 1;
  let width = 0;
  for (let k = digits; k > 0; k--) {
    const power = P.bus.u16(PowersOfTen_05 + (k - 1) * 2);
    do hl = (hl - power) & 0xFFFF; while (!neg(hl));
    const ch = ((hl >> 8) + 0x30) & 0xFF;
    hl = (hl + power) & 0xFFFF;
    width = (width + getGlyphWidth(P, ch)) & 0xFF;
  }
  return width;
}

// Unused_05_SetTextVar (05:53AE): a into wUnusedTextByte (WRAM bank 5). Nothing calls it.
export function setTextVar(P, value) {
  const oldBank = pushWramBank(P, WRAM_TEXT);
  mapped(P).unusedTextByte = value;
  P.wramBank(oldBank);
}

// TextCmdPrintShortText (05:53CA, code $0E n): print short text $1B + n (wTextCharNameArg, latched by the printer)
export function* textCmdPrintShortText(P, de) {
  fetchShortTextToBuffer(P, SHORT_TEXT_ROSTER + mapped(P).textCharNameArg, wInlineTextBuffer);
  return yield* renderInlineString(P, wInlineTextBuffer, de);
}
// MeasureIndexedShortTextWidth (05:53E8): the measuring pass for code $0E: the width of short text $1B + n
export function measureIndexedShortTextWidth(P) {
  fetchShortTextToBuffer(P, SHORT_TEXT_ROSTER + mapped(P).textCharNameArg, wInlineTextBuffer);
  return measureStringWidth(P, wInlineTextBuffer);
}
// the width in pixels of the $00-terminated string at `p` (8 bits)
export function measureStringWidth(P, p) {
  let w = 0;
  for (let ch; (ch = P.bus.u8(p)) !== 0; p = (p + 1) & 0xFFFF) w = (w + getGlyphWidth(P, ch)) & 0xFF;
  return w;
}

// the map row of a cell pointer (bits 5-9) — the ROM's shifts in WrapTextCellPointer
const cellRow = de => (de >> 5) & 0x1F;
// WrapTextCellPointer (05:5413): a cell pointer that has run past the end of the printer's row (wTextCursorRow)
// goes back a row; and it is kept in $D000-$D3FF
export function wrapTextCellPointer(P, de) {
  if (mapped(P).textCursorRow !== cellRow(de)) de = (de - 0x20) & 0xFFFF;
  return (0xD0 | ((de >> 8) & 3)) << 8 | (de & 0xFF);
}
// WrapTextCellPointerPrevRow (05:543D): the same against the row above the printer's (for the dakuten marks); its
// borrow case also masks the low byte to 6 bits
export function wrapTextCellPointerPrevRow(P, de) {
  if (((mapped(P).textCursorRow - 1) & 0x1F) !== cellRow(de)) {
    const e = (de & 0xFF) - 0x20;
    de = e >= 0 ? (de & 0xFF00) | e : ((de - 0x100) & 0xFF00) | (e & 0x3F);
  }
  return (0xD0 | ((de >> 8) & 3)) << 8 | (de & 0xFF);
}

// RenderInlineString (05:54CF): print the $00-terminated string at `text` (a name, an argument) into the text at
// cell `de`, a glyph and a typing delay per character, dakuten marks ($DE/$DF after a character) onto the cell above
// it. At the start of a row it first steps back to the end of the row before (except at the start of the text, or
// after a $05). Returns { de, hl } (the cell after, the terminator).
export function* renderInlineString(P, text, de) {
  const R = mapped(P), { bus } = P;
  let hl = text;
  if (!(R.textStreamPtr === 0xC600)) {                       // not at the start of wTextBuffer
    if (bus.u8((de - 1) & 0xFFFF) !== 0x05 && (de & 0x1F) === 0) de = (de - 0x20) & 0xFFFF;
  }
  for (;;) {
    if (bus.u8(hl) === 0) break;
    if (testFlag(P, FLAG.PROPORTIONAL_TEXT_MODE)) {
      stampGlyphTileAtPen(P);
      drawInlineGlyph(P, hl);
      stampGlyphTileAtPen(P);
      uploadLastGlyphTiles(P);
    } else {
      drawInlineGlyph(P, hl);
      uploadLastGlyphTiles(P);
    }
    hl = (hl + 1) & 0xFFFF;
    let a = bus.u8(hl);
    if (a === 0xDE || a === 0xDF) {                          // a dakuten mark: onto the cell above
      let cell = (de - 0x20) & 0xFFFF;
      if ((cell >> 8) < (R.shadowTilemapPtr >> 8)) cell = (cell + 0x400) & 0xFFFF;
      if (bus.u8(cell) === 0x03) a = (a - 0xD0) & 0xFF;
      bus.w8(cell, a);
      hl = (hl + 1) & 0xFFFF;
    }
    yield* delayTextCharacter(P, a);                          // (with the next character, or the mark, in a)
    de = (de + 1) & 0xFFFF;
    if ((de & 0x1F) === 0) de = (de - 0x20) & 0xFFFF;
  }
  return { de, hl };
}

// RenderInlineNumber (05:5597) and the unused hex / decimal variants: format into a 10-byte buffer on the stack
// (as the ROM: below its pushes, so the calls it makes stack below it), then RenderInlineString. With
// wTextNumberRightAlign the number is right-aligned in 5 cells.
function* renderFormatted(P, de, format, rightAlign) {
  const sp0 = P.cpu.sp, buffer = (sp0 - 16) & 0xFFFF;         // push af/bc/hl, add sp, -10
  P.cpu.sp = (sp0 - 18) & 0xFFFF;                            // push de
  try {
    format(buffer);
    if (rightAlign) {
      let pad = 5;
      for (let p = buffer; P.bus.u8(p) && --pad; p++);
      de = (de + pad) & 0xFFFF;
    }
    return (yield* renderInlineString(P, buffer, de)).de;
  } finally { P.cpu.sp = sp0; }
}
const regsHL = v => ({ h: (v >> 8) & 0xFF, l: v & 0xFF });
const regsDEBC = b => ({ d: b >> 8, e: b & 0xFF, b: b >> 8, c: b & 0xFF });
// RenderInlineNumber (05:5597): the decimal number `value` (FormatDecimalNumber, home)
export function* renderInlineNumber(P, value, de) {
  const rightAlign = mapped(P).textNumberRightAlign !== 0;
  return { de: yield* renderFormatted(P, de, buf => callHome(P, HOME.FormatDecimalNumber, { ...regsHL(value), ...regsDEBC(buf), a: 0 }), rightAlign) };
}
// Unused_05_RenderInlineHexByte (05:5555) / Unused_05_RenderInlineHexWord (05:556A): FormatHexWord of a / hl.
// Unused_05_RenderInlineDecimalByte (05:5580): a in decimal, at least 4 characters. Nothing calls them.
export function* renderInlineHex(P, value, de) {
  return { de: yield* renderFormatted(P, de, buf => callHome(P, HOME.FormatHexWord, { ...regsHL(value), ...regsDEBC(buf) }), false) };
}
export function* renderInlineDecimalByte(P, value, de) {
  return { de: yield* renderFormatted(P, de, buf => callHome(P, HOME.FormatDecimalNumber, { h: 0, l: value, ...regsDEBC(buf), a: 4 }), false) };
}

export const HOOKS = [
  hook(5, 0x5297, () => {}),                                  // TextCmdNop2
  hook(5, 0x5298, P => ({ a: getNextArgShortTextLength(P), f: Z | N })),
  hook(5, 0x52CE, (P, r) => textCmdPrintArgNumber(P, r.de)),
  hook(5, 0x5305, P => ({ a: measureNextArgNumberWidth(P) })),
  hook(5, 0x53AC, () => {}),                                  // Unused_05_StubNop_05_2
  hook(5, 0x53AE, (P, r) => { setTextVar(P, r.a); }),
  hook(5, 0x53CA, (P, r) => textCmdPrintShortText(P, r.de)),
  hook(5, 0x53E8, P => ({ a: measureIndexedShortTextWidth(P), f: Z | N })),
  hook(5, 0x5413, (P, r) => ({ de: wrapTextCellPointer(P, r.de) })),
  hook(5, 0x543D, (P, r) => ({ de: wrapTextCellPointerPrevRow(P, r.de) })),
  hook(5, 0x546C, (P, r) => dispatchControlCode(P, r.a, r.de)),
  hook(5, 0x548A, () => {}), hook(5, 0x548B, () => {}), hook(5, 0x548C, () => {}), hook(5, 0x548D, () => {}),   // ControlCodeHandler16-19
  hook(5, 0x548E, () => {}),                                  // TextCmdNop0
  hook(5, 0x54CF, (P, r) => renderInlineString(P, r.hl, r.de)),
  hook(5, 0x5555, (P, r) => renderInlineHex(P, r.a, r.de)),
  hook(5, 0x556A, (P, r) => renderInlineHex(P, r.hl, r.de)),
  hook(5, 0x5580, (P, r) => renderInlineDecimalByte(P, r.a, r.de)),
  hook(5, 0x5597, (P, r) => renderInlineNumber(P, r.hl, r.de)),
];
