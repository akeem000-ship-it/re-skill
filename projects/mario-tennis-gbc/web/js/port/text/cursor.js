// The text printer (RenderTextString and its TextInterpreterLoop) with its newline, glyph-row, delay and page
// commands, and the unused pause-menu cursor helpers (bank $05, src/engine/text/cursor_05.asm). Port of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses are its own.
//
// The printer walks a string (hl, normally wTextBuffer) with a cell pointer (de, the shadow-map cell of the
// cursor, wTextCursorColumn / wTextCursorRow): a character >= $20 is rasterised into the glyph stream, uploaded
// and delayed; $00 ends (flushing the glyph row); $DE / $DF become codes $1E / $1F; $0E takes one operand byte;
// any other byte < $20 is a control code (control.js). A page break ($02) suspends the printer: it returns with
// the stream position in wTextResumePtr, and the next call resumes there.
// Covered by out/port/story1.mtrec (every dialogue page of the story's opening) and web/tests/port/routines_text.mjs.
import {
  FLAG, WRAM_TEXT, PAD_ANY_BUTTON, mapped, hook, testFlag, testFlagF, setFlag, clearFlag, advanceFrame,
  registerFrameTask, unregisterFrameTask, queueBGTileWrite, farcall, pushWramBank, Z, H, hi, lo,
} from "./common.js";
import { getTilemapCellAddress, redrawActiveTextWindow } from "./window_tilemap.js";
import { cellToVram } from "./window_create.js";
import { initGlyphStreamForWindow, drawStreamGlyph, uploadLastGlyphTiles, startGlyphStreamRow } from "./glyph_buffer.js";
import { flushGlyphRow } from "./glyph_font.js";
import { delayTextCharacter } from "./window_text.js";
import { dispatchControlCode, wrapTextCellPointer } from "./control.js";
import { getTextContinueArrowCell, waitTextAdvanceInput } from "./arg.js";

const TextContinueArrowBlinkTask = 0x4FE3;
const CONTINUE_ARROW_TILE = 0x01;
const BLANK = 0x20, MENU_ARROW = 0x0D, MENU_ARROW_LEFT = 0x0C;

// Unused_05_IsCursorOnAdjustRow (05:4C76): 1 when the cursor row's bit is set in wMenuAdjustRowMask (bit 7 = in
// use) and neither up nor down is pressed, else 0. Returns a and its flags.
export function isCursorOnAdjustRow(P) {
  const R = mapped(P), mask = R.menuAdjustRowMask;
  if (!(mask & 0x80)) return { a: 0, f: Z };
  let b = mask & 0x7F;
  for (let n = ((R.menuCursorRow + 1) & 0xFF) || 256; n > 0; n--) b = ((b >> 1) | (b << 7)) & 0xFF;   // rrc b
  b = ((b << 1) | (b >> 7)) & 0xFF;                                                                      // rlc b
  if (!(b & 1) || (P.V.inputPressed & 0xC0)) return { a: 0, f: Z };
  return { a: 1, f: Z | H };
}

// Unused_1a_QueueWindowTileWrite (1a:413C): a tile into a pause-menu window cell at the next VBlank (bank $1A's)
const queueWindowTileWrite = (P, tile, cell) => farcall(P, 0x1A, 0x02, { l: tile, d: cell >> 8, e: cell & 0xFF });
// Unused_05_AnimateMenuScrollArrowsTask (05:4C9D, a frame task of Unused_05_RunMenuSelectionShared): the blinking
// menu arrow; on an "adjust" row of the options / minigame pause menus, the left and right value arrows instead.
export function animateMenuScrollArrowsTask(P) {
  const R = mapped(P);
  P.wramBank(WRAM_TEXT);
  const pauseOptions = () => testFlag(P, FLAG.PAUSE_OPTIONS_MENU_OPEN);
  const minigamePause = () => testFlag(P, FLAG.MINIGAME_PAUSE_MENU_OPEN);
  let onAdjustRow = false;
  const mask = R.menuAdjustRowMask;
  if (mask & 0x80) {
    let b = mask & 0x7F;
    for (let n = ((R.menuCursorRow + 1) & 0xFF) || 256; n > 0; n--) b = ((b >> 1) | (b << 7)) & 0xFF;
    b = ((b << 1) | (b >> 7)) & 0xFF;
    if (b & 1 && (pauseOptions() || minigamePause())) onAdjustRow = true;
  }
  const eraseLeft = () => {
    const erase = R.textArrowEraseAddr;
    if (erase >> 8) { queueBGTileWrite(P, erase, BLANK); P.bus.w8(P.A.textArrowEraseAddr + 1, 0); }
  };
  if (!onAdjustRow) {
    if (pauseOptions()) { queueWindowTileWrite(P, BLANK, 0x0B01); queueWindowTileWrite(P, BLANK, 0x0B03); }
    else if (minigamePause()) { queueWindowTileWrite(P, BLANK, 0x0D05); queueWindowTileWrite(P, BLANK, 0x0D07); }
    queueBGTileWrite(P, cellToVram(R.textArrowCell), R.textArrowBlinkCounter & 0x10 ? BLANK : MENU_ARROW);
    R.textArrowBlinkCounter = (R.textArrowBlinkCounter + 1) & 0xFF;
    eraseLeft();
    return;
  }
  eraseLeft();
  P.wramBank(WRAM_TEXT);
  R.textArrowBlinkCounter = (R.textArrowBlinkCounter + 1) & 0xFF;
  // the value arrows either side of the row: < at column 1, > at the right column (blank while blinking off)
  const valueArrows = (row, rightCol) => {
    const left = 0x0100 | row, right = rightCol << 8 | row;
    if (getMenuCursorBlinkPhase(P) === 0) { queueWindowTileWrite(P, BLANK, left); return; }
    queueWindowTileWrite(P, MENU_ARROW_LEFT, left);
    queueWindowTileWrite(P, MENU_ARROW, right);
  };
  if (pauseOptions()) {
    queueWindowTileWrite(P, BLANK, 0x0B01); queueWindowTileWrite(P, BLANK, 0x0B03);
    if (R.menuCursorRow === 0) valueArrows(0x01, 0x0B); else valueArrows(0x03, 0x0B);
  } else if (minigamePause()) {
    queueWindowTileWrite(P, BLANK, 0x0D05); queueWindowTileWrite(P, BLANK, 0x0D07);
    if (R.menuCursorRow === 3) valueArrows(0x07, 0x0D); else valueArrows(0x05, 0x0D);
  }
}
// Unused_05_GetMenuCursorBlinkPhase (05:4E10): 1 in the visible half of the blink, else 0. Leaves WRAM bank 5.
export function getMenuCursorBlinkPhase(P) {
  P.wramBank(WRAM_TEXT);
  return mapped(P).textArrowBlinkCounter & 0x10 ? 0 : 1;
}

// RenderTextString (05:4E23) and TextInterpreterLoop (05:4E5D): print the string at `text` from cell (col, row)
// (resuming after a page break at wTextResumePtr — the ROM adds the string's address to $3A00 + the resume pointer,
// which is right for wTextBuffer at $C600). Returns the registers it leaves.
export function* renderTextString(P, text, col, row) {
  const R = mapped(P), { bus } = P;
  let hl = text;
  if (hi(R.textResumePtr)) {
    hl = (R.textResumePtr + text + 0x3A00) & 0xFFFF;
    bus.w8(P.A.textResumePtr + 1, 0);
  }
  if (R.glyphWindowId === 0) { R.glyphRowStartCol = 0; R.glyphFlushedCol = 0; }
  initGlyphStreamForWindow(P);
  yield* redrawActiveTextWindow(P);
  R.textCursorColumn = col & 0x1F;
  R.textCursorRow = row & 0x1F;
  let de = getTilemapCellAddress(P, col, row);
  for (;;) {                                                  // TextInterpreterLoop
    if (R.textPageBreakRequest) {                             // a page break: suspend here
      R.textResumePtr = hl;
      return { hl, de, a: hi(hl), f: 0 };
    }
    R.textStreamPtr = hl;
    const ch = bus.u8(hl); hl = (hl + 1) & 0xFFFF;
    if (ch === 0x00) {                                        // the end: flush the glyph row (not while the frame is drawn)
      const f = testFlagF(P, FLAG.TEXT_RENDER_ACTIVE);
      if (f & Z) hl = (yield* flushGlyphRow(P)).hl;
      return { hl, de, a: 0, f };
    }
    let code;
    if (ch === 0xDE) code = 0x1E;
    else if (ch === 0xDF) code = 0x1F;
    else if (ch === 0x0E) { R.textCharNameArg = bus.u8(hl); hl = (hl + 1) & 0xFFFF; code = 0x0E; }
    else if (ch < 0x20) code = ch;
    if (code !== undefined) {
      de = (yield* dispatchControlCode(P, code, de)).de;
      yield* redrawActiveTextWindow(P);
      continue;
    }
    de = wrapTextCellPointer(P, de);
    drawStreamGlyph(P);
    uploadLastGlyphTiles(P);
    yield* delayTextCharacter(P, ch);
    de = (de + 1) & 0xFFFF;                                   // (at a row's end it computes a -$20 wrap and drops it)
  }
}

// TextCmdNewline (05:4ED0, codes $01 $0F $14-$1D): the glyph stream's newline (DrawStreamGlyph of the code), and the
// cursor two map rows down
export function* textCmdNewline(P, de) {
  const R = mapped(P);
  drawStreamGlyph(P);
  const row = (R.textCursorRow + 2) & 0x1F;
  R.textCursorRow = row;
  return { de: getTilemapCellAddress(P, R.textCursorColumn, row) };
}
// TextCmdNop (05:4EE8, code $0A)
export function* textCmdNop(P, de) { return { de }; }
// TextCmdNextGlyphStreamRow (05:4EE9, code $0D; the proportional printers' newline): the glyph write pointer and the
// destination cell two map rows on (less twice the row indent), the glyph stream to its next row
export function* textCmdNextGlyphStreamRow(P, de) { return { de: nextGlyphStreamRow(P) }; }
export function nextGlyphStreamRow(P) {
  const R = mapped(P);
  R.glyphTileWritePtr = (R.glyphTileWritePtr + 0x40) & 0xFFFF;
  startGlyphStreamRow(P);
  const oldBank = pushWramBank(P, WRAM_TEXT);
  const back = ((((~R.textRowIndent) + 1) & 0xFF) << 1) & 0xFF;
  const dest = (R.glyphVramDest + back) & 0xFFFF;
  R.glyphVramDest = dest;
  P.wramBank(oldBank);
  return dest;
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
// TextCmdDelay30 (05:4F32, code $05): 30 frames
export function* textCmdDelay30(P, de) {
  yield* redrawIfFast(P);
  for (let n = 0x1E; n > 0; n--) yield* advanceFrame(P);
  return { de };
}
// TextCmdDelay15Skippable (05:4F4F, code $06): 15 frames, a button press cutting it short
export function* textCmdDelay15Skippable(P, de) {
  yield* redrawIfFast(P);
  for (let n = 0x0F; n > 0; n--) {
    yield* advanceFrame(P);
    if (P.V.inputPressed & PAD_ANY_BUTTON) break;
  }
  return { de };
}

// TextCmdWaitButtonPage (05:4F74, code $02): the continue arrow at the bottom of the window, blinking (a frame task)
// until a button (WaitTextAdvanceInput), then a page break (wTextPageBreakRequest). FLAG_TEXT_WAITING_FOR_BUTTON is
// set for one frame after. Leaves hl past wTextArrowCell.
export function* textCmdWaitButtonPage(P, de) {
  const R = mapped(P);
  wrapTextCellPointer(P, de);                                 // (its result is dropped)
  const arrow = getTextContinueArrowCell(P).de;
  const cell = getTilemapCellAddress(P, hi(arrow), lo(arrow));
  P.bus.w8(cell, CONTINUE_ARROW_TILE);
  yield* redrawActiveTextWindow(P);
  R.textArrowBlinkCounter = 0;
  R.textArrowCell = cell;
  registerFrameTask(P, 0x01, TextContinueArrowBlinkTask);
  yield* waitTextAdvanceInput(P, de);
  R.textArrowBlinkCounter = 0x10;
  yield* advanceFrame(P);
  unregisterFrameTask(P, TextContinueArrowBlinkTask);
  setFlag(P, FLAG.TEXT_WAITING_FOR_BUTTON);
  yield* advanceFrame(P);
  clearFlag(P, FLAG.TEXT_WAITING_FOR_BUTTON);
  R.textPageBreakRequest = 1;
  return { de, hl: (P.A.textArrowCell + 1) & 0xFFFF };
}

export const HOOKS = [
  hook(5, 0x4C76, P => isCursorOnAdjustRow(P)),
  hook(5, 0x4C9D, P => { animateMenuScrollArrowsTask(P); }),
  hook(5, 0x4E10, P => ({ a: getMenuCursorBlinkPhase(P), f: Z })),
  hook(5, 0x4E23, (P, r) => renderTextString(P, r.hl, r.d, r.e)),
  hook(5, 0x4ED0, (P, r) => textCmdNewline(P, r.de)),
  hook(5, 0x4EE8, () => {}),                                  // TextCmdNop
  hook(5, 0x4EE9, (P, r) => textCmdNextGlyphStreamRow(P, r.de)),
  hook(5, 0x4F32, (P, r) => textCmdDelay30(P, r.de)),
  hook(5, 0x4F4F, (P, r) => textCmdDelay15Skippable(P, r.de)),
  hook(5, 0x4F74, (P, r) => textCmdWaitButtonPage(P, r.de)),
];
