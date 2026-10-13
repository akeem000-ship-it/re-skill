// The continue arrow and the button wait, the text-argument queues, the dakuten marks, the name codes and the
// measures of names and argument strings (bank $05, src/engine/text/arg_05.asm). Port of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses are its own.
//
// Text arguments (WRAM bank 5, 16 entries each, reset at every dialogue): wTextArgStringQueue (2-byte pointers,
// the high nibble a WRAM bank tag for $Dxxx strings) for code $04, wTextArgNumberQueue for $09,
// wTextArgShortTextQueue for $08 (measured only). Each has a write index, a count, and a measure index.
// Covered by out/port/story1.mtrec (names, page waits) and web/tests/port/routines_text.mjs.
import {
  FLAG, WRAM_TEXT, PAD_ANY_BUTTON, mapped, hook, testFlag, testFlagF, setFlag, clearFlag, advanceFrame,
  registerFrameTask, unregisterFrameTask, queueBGTileWrite, callHome, copyMemoryBC, HOME, pushWramBank, Z, N, hi, lo,
} from "./common.js";
import { getWindowStructPtr } from "./window_alloc.js";
import { getTilemapCellAddress, redrawActiveTextWindow } from "./window_tilemap.js";
import { cellToVram } from "./window_create.js";
import { flushGlyphRow } from "./glyph_font.js";
import { delayTextCharacter } from "./window_text.js";
import { renderInlineString, wrapTextCellPointer, wrapTextCellPointerPrevRow, wInlineTextBuffer, measureStringWidth } from "./control.js";
import { getGlyphWidth } from "./rows.js";

const TextContinueArrowBlinkTask = 0x4FE3;
const wStoryModeNameOfMainCharacter = 0xC900, wStoryModeNameOfPartnerCharacter = 0xC940;
const CONTINUE_ARROW_TILE = 0x01, CONTINUE_ARROW_OFF_TILE = 0x08;

// GetTextContinueArrowCell (05:4FBF): the cell of the continue arrow: the middle of the dialogue window's bottom
// row ((10, 17) under FLAG_DEBUG_STATIC_TEXT_WINDOW). Returns { de, f } (the flags of the flag test).
export function getTextContinueArrowCell(P) {
  const f = testFlagF(P, FLAG.DEBUG_STATIC_TEXT_WINDOW);
  if (!(f & Z)) return { de: 0x0A11, f };
  const s = getWindowStructPtr(mapped(P).dialogueWindowId), { bus } = P;
  const col = (bus.u8(s) + ((bus.u8(s + 2) << 24 >> 24) >> 1)) & 0xFF;
  const row = (bus.u8(s + 1) + bus.u8(s + 3) - 1) & 0xFF;
  return { de: col << 8 | row, f };
}

// TextContinueArrowBlinkTask (05:4FE3, a frame task): blink the continue arrow at wTextArrowCell in VRAM (tile $01,
// then $08 for 16 frames). Leaves WRAM bank 5 mapped.
export function textContinueArrowBlinkTask(P) {
  const R = mapped(P);
  P.wramBank(WRAM_TEXT);
  const tile = R.textArrowBlinkCounter & 0x10 ? CONTINUE_ARROW_OFF_TILE : CONTINUE_ARROW_TILE;
  queueBGTileWrite(P, cellToVram(R.textArrowCell), tile);
  R.textArrowBlinkCounter = (R.textArrowBlinkCounter + 1) & 0xFF;
}

// the wait and delay commands redraw the window once when the message speed is fast (wTextRedrawGuard 0, which
// doubles as the guard)
function* redrawIfFast(P) {
  const R = mapped(P);
  if (R.textRedrawGuard) return;
  R.textRedrawGuard = 1;
  yield* redrawActiveTextWindow(P);
  R.textRedrawGuard = 0;
}

// WaitTextAdvanceInput (05:501D, code $03): redraw the window, flush the glyph row, then wait for a button press
// (A B or the d-pad), first letting go of one still held (up to 30 frames); the random seed advances while it
// waits. Skipped under FLAG_CUTSCENE_FAST_FORWARD. Returns the hl it leaves (the last seed).
export function* waitTextAdvanceInput(P, de, entryHl = 0) {
  const V = P.V;
  let hl = entryHl;
  yield* redrawIfFast(P);
  yield* redrawActiveTextWindow(P);
  if (!testFlag(P, FLAG.CUTSCENE_FAST_FORWARD)) {
    hl = (yield* flushGlyphRow(P)).hl;
    if (V.playerInputFlags & PAD_ANY_BUTTON) {
      for (let n = 0x1E; n > 0; n--) {
        yield* advanceFrame(P);
        if (!(V.playerInputFlags & PAD_ANY_BUTTON)) break;
      }
    }
    for (;;) {
      if (testFlag(P, FLAG.CUTSCENE_FAST_FORWARD)) break;
      hl = callHome(P, HOME.AdvanceRandomSeed).hl;            // AdvanceRandomSeed (home)
      yield* advanceFrame(P);
      if (V.inputPressed & PAD_ANY_BUTTON) break;
    }
  }
  return { de, hl };
}

// TextCmdDelay150Skippable (05:5064, code $0C): wait 150 frames, a button press cutting it short
export function* textCmdDelay150Skippable(P, de) {
  yield* redrawIfFast(P);
  for (let n = 0x96; n > 0; n--) {
    yield* advanceFrame(P);
    if (P.V.inputPressed & PAD_ANY_BUTTON) break;
  }
  return { de };
}

// the pointer of a string argument: a $Dxxx pointer carries its WRAM bank in the high nibble ($D -> bank),
// a $Cxxx one has 0 there
const unpackArgString = (packed, bank) => (bank ? ((packed >> 8) & 0x0F | 0xD0) : ((packed >> 8) & 0x0F | 0xC0)) << 8 | (packed & 0xFF);

// TextCmdPrintArgString (05:5089, code $04): print the next string of wTextArgStringQueue (copied to
// wInlineTextBuffer from its WRAM bank); a used entry's high byte is cleared. Nothing when the queue is used up or
// the entry is null. Returns { de, hl } (hl: the queue, the null entry, or the string's end).
export function* textCmdPrintArgString(P, de) {
  const R = mapped(P), oldBank = pushWramBank(P, WRAM_TEXT);
  const index = R.textArgStringWriteIndex;
  let out = { de, hl: P.A.textArgStringQueue };
  if (index !== R.textArgStringCount) {
    R.textArgStringWriteIndex = (index + 1) & 0xFF;
    const entry = (P.A.textArgStringQueue + ((index * 2) & 0xFF)) & 0xFFFF;
    const packed = P.bus.u16(entry);
    out = { de, hl: packed };
    if (packed >> 8) {
      P.bus.w8(entry + 1, 0);
      const bank = ((packed >> 8) << 24 >> 24 >> 4) & 0xFF;    // sra a x4
      if (bank) P.wramBank(bank);
      copyMemoryBC(P, unpackArgString(packed, bank), wInlineTextBuffer, 0x20);
      P.wramBank(WRAM_TEXT);
      out = yield* renderInlineString(P, wInlineTextBuffer, de);
    }
  }
  P.wramBank(oldBank);
  return out;
}

// PushTextArgString (05:50F7): queue string pointer hl for code $04 ($Dxxx pointers tagged with hWramBank).
// At most 16.
export function pushTextArgString(P, ptr) {
  const R = mapped(P);
  const high = (ptr >> 8) & 0xFF;
  const h = (high & 0xF0) === 0xD0 ? ((P.V.wramBank << 4) | (high & 0x0F)) & 0xFF : high & 0x0F;
  const oldBank = pushWramBank(P, WRAM_TEXT);
  const index = R.textArgStringWriteIndex;
  if (index !== 0x10) {
    R.textArgStringWriteIndex = index + 1; R.textArgStringCount = index + 1;
    P.bus.w16(P.A.textArgStringQueue + index * 2, h << 8 | (ptr & 0xFF));
  }
  P.wramBank(oldBank);
}
// PushTextArgNumber (05:5147): queue the number hl for code $09. At most 16.
export function pushTextArgNumber(P, value) {
  const R = mapped(P), oldBank = pushWramBank(P, WRAM_TEXT);
  const index = R.textArgNumberWriteIndex;
  if (index !== 0x10) {
    R.textArgNumberWriteIndex = index + 1; R.textArgNumberCount = index + 1;
    P.bus.w16(P.A.textArgNumberQueue + index * 2, value);
  }
  P.wramBank(oldBank);
}
// Unused_05_PushTextArgShortTextId (05:517A): queue the short-text id a for code $08 (only measured). At most 16.
export function pushTextArgShortTextId(P, id) {
  const R = mapped(P), oldBank = pushWramBank(P, WRAM_TEXT);
  const index = R.textArgShortTextWriteIndex;
  if (index !== 0x10) {
    R.textArgShortTextWriteIndex = index + 1; R.textArgShortTextCount = index + 1;
    P.bus.w8(P.A.textArgShortTextQueue + index, id);
  }
  P.wramBank(oldBank);
}

// TextCmdApplyDakuten (05:51A8, $DE -> code $1E) / TextCmdApplyHandakuten (05:51C8, $DF -> $1F): put the
// voiced-sound mark on the cell above the previous character ($0E / $0F over a $03, else $DE / $DF), redraw and
// delay. Returns the a, f and hl it leaves.
function* applyMark(P, de, mark) {
  const cell = wrapTextCellPointerPrevRow(P, (de - 0x21) & 0xFFFF);
  const a = P.bus.u8(cell) === 0x03 ? mark - 0xD0 : mark;
  P.bus.w8(cell, a);
  const f = (yield* redrawActiveTextWindow(P)).f;
  yield* delayTextCharacter(P, a);
  return { de, a, f, hl: (de - 0x21) & 0xFFFF };
}
export function* textCmdApplyDakuten(P, de) { return yield* applyMark(P, de, 0xDE); }
export function* textCmdApplyHandakuten(P, de) { return yield* applyMark(P, de, 0xDF); }

// TextCmdPrintPlayerName (05:51E8, code $07) / TextCmdPrintPartnerName (05:51F3, code $0B): the story's main
// character's / partner's name
export function* textCmdPrintPlayerName(P, de) { return yield* renderInlineString(P, wStoryModeNameOfMainCharacter, de); }
export function* textCmdPrintPartnerName(P, de) { return yield* renderInlineString(P, wStoryModeNameOfPartnerCharacter, de); }

// MeasureNextArgStringWidth (05:51FE): the measuring pass for code $04: the width of the next queued string
// (copied to wInlineTextBuffer from its bank — WRAM bank "0" for a $Cxxx string). Leaves WRAM bank 5 mapped.
export function measureNextArgStringWidth(P) {
  const R = mapped(P);
  P.wramBank(WRAM_TEXT);
  const index = R.textArgStringMeasureIndex;
  R.textArgStringMeasureIndex = (index + 1) & 0xFF;
  const packed = P.bus.u16((P.A.textArgStringQueue + ((index * 2) & 0xFF)) & 0xFFFF);
  const bank = (packed >> 12) & 0x07;                         // sra a / res 7, a / sra a x3
  P.wramBank(bank);
  copyMemoryBC(P, unpackArgString(packed, bank), wInlineTextBuffer, 0x20);
  P.wramBank(WRAM_TEXT);
  return measureStringWidth(P, wInlineTextBuffer);
}
// MeasureMainCharacterNameWidth (05:5267) / MeasurePartnerCharacterNameWidth (05:527F): the names' widths
export function measureMainCharacterNameWidth(P) { return measureStringWidth(P, wStoryModeNameOfMainCharacter); }
export function measurePartnerCharacterNameWidth(P) { return measureStringWidth(P, wStoryModeNameOfPartnerCharacter); }

export const HOOKS = [
  hook(5, 0x4FBF, P => getTextContinueArrowCell(P)),
  hook(5, 0x4FE3, P => { textContinueArrowBlinkTask(P); }),
  hook(5, 0x501D, (P, r) => (function* () { return { hl: (yield* waitTextAdvanceInput(P, r.de, r.hl)).hl }; })()),
  hook(5, 0x5064, (P, r) => textCmdDelay150Skippable(P, r.de)),
  hook(5, 0x5089, (P, r) => textCmdPrintArgString(P, r.de)),
  hook(5, 0x50F7, (P, r) => { pushTextArgString(P, r.hl); }),
  hook(5, 0x5147, (P, r) => { pushTextArgNumber(P, r.hl); }),
  hook(5, 0x517A, (P, r) => { pushTextArgShortTextId(P, r.a); }),
  hook(5, 0x51A8, (P, r) => textCmdApplyDakuten(P, r.de)),
  hook(5, 0x51C8, (P, r) => textCmdApplyHandakuten(P, r.de)),
  hook(5, 0x51E8, (P, r) => textCmdPrintPlayerName(P, r.de)),
  hook(5, 0x51F3, (P, r) => textCmdPrintPartnerName(P, r.de)),
  hook(5, 0x51FE, P => ({ a: measureNextArgStringWidth(P), f: Z })),
  hook(5, 0x5267, P => ({ a: measureMainCharacterNameWidth(P), f: Z | N })),
  hook(5, 0x527F, P => ({ a: measurePartnerCharacterNameWidth(P), f: Z | N })),
];
