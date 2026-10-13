// Proportional text at a cell (menu windows), text into a 64-column buffer, tile-per-character strings into a
// window, and the actor slot of a speaker (bank $05, src/engine/text/proportional_05.asm). Port of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses are its own.
//
// RenderProportionalTextAt rasterises a text id into the glyph stream from a cell, without a window, stamping each
// glyph tile's id into the shadow map as it goes (StampGlyphTileAtPen). Its control codes go through
// ProportionalTextCodeHandlers_05 ($05:5E39, 16 entries): $00/$02/$03 end, $01 a glyph-row newline, $04 $07 $08 $09
// $0B the printer's substitutions, $0E (broken, below), the rest are printed as glyphs.
// Covered by out/port/menus1.mtrec (menu windows) and web/tests/port/routines_text.mjs.
import {
  FLAG, WRAM_TEXT, mapped, hook, setFlag, clearFlag, pushWramBank, cpFlags, Z, N,
} from "./common.js";
import { fetchDialogueText, addTextIdOffset } from "./dialogue.js";
import { resetTextArgQueues, wTextBuffer } from "./window_text.js";
import { initGlyphStreamAt, drawInlineGlyph, saveGlyphPenColumns } from "./glyph_font.js";
import { penToColumn } from "./glyph_buffer.js";
import { dispatchControlCode } from "./control.js";
import { nextGlyphStreamRow } from "./cursor.js";
import { writeWindowCellTileAttr, readWindowCellTileAttr } from "./window_tilemap.js";
import { pushTextArgNumber } from "./arg.js";

const Text_30_310 = 0x0136;

// a control code past the 16-entry handler tables jumps through bytes of the code after them; $0E in proportional
// text unbalances the stack (its handler pops its own push into the WRAM bank and then the caller's de). Neither
// occurs in the game's texts; the port stops rather than guess.
function unsupported(where, code) { throw new Error(`${where}: code $${code.toString(16)} jumps through no handler (garbage in the ROM)`); }

// RenderProportionalTextAt (05:5DB3): text `textId` rasterised proportionally from shadow-map cell `cell`, rows
// `rowWidth` cells wide; the glyph tiles' ids are stamped into the map unless the window is the menu window. Leaves
// the WRAM bank wShadowTilemapBank once a glyph was drawn.
export function* renderProportionalTextAt(P, textId, cell, rowWidth) {
  const R = mapped(P), { bus } = P;
  setFlag(P, FLAG.PROPORTIONAL_TEXT_MODE);
  R.glyphTileWritePtr = cell;
  initGlyphStreamAt(P, rowWidth);
  const oldBank = pushWramBank(P, WRAM_TEXT);
  const id = addTextIdOffset(P, textId, 0).hl;
  resetTextArgQueues(P);
  let de = cell;
  if ((((R.shadowTilemapPtr >> 8) + 3) & 0xFF) < (de >> 8)) de = (de - 0x400) & 0xFFFF;
  R.glyphVramDest = de;
  const rowBack = 0xFFE0;                                     // bc = -$20; wTextRowIndent = -$20
  R.textRowIndent = 0xE0;
  fetchDialogueText(P, id, de);
  let hl = wTextBuffer;
  R.glyphStampEnabled = R.windowId === R.menuWindowId ? 0 : 1;
  P.wramBank(oldBank);
  for (;;) {
    let ch = bus.u8(hl);
    if (ch < 0x20) {
      if (ch === 0x00 || ch === 0x02 || ch === 0x03) break;  // ProportionalTextCodeHandler0_05
      if (ch === 0x01) { de = (yield* dispatchControlCode(P, 0x0D, de)).de; hl = (hl + 1) & 0xFFFF; continue; }
      if ([0x04, 0x07, 0x08, 0x09, 0x0B].includes(ch)) { de = (yield* dispatchControlCode(P, ch, de)).de; hl = (hl + 1) & 0xFFFF; continue; }
      if (ch === 0x0E || ch >= 0x10) unsupported("RenderProportionalTextAt", ch);
      // ProportionalTextCodeHandler5_05: the code itself drawn as a glyph
    }
    P.wramBank(R.shadowTilemapBank);
    stampGlyphTileAtPen(P);
    drawInlineGlyph(P, hl);
    stampGlyphTileAtPen(P);
    hl = (hl + 1) & 0xFFFF;
    const next = bus.u8(hl);
    if (next === 0xDE || next === 0xDF) {                     // a dakuten mark onto the cell above
      let above = (de + rowBack) & 0xFFFF;
      if (!((((R.shadowTilemapPtr >> 8) - 1) & 0xFF) < (above >> 8))) above = (above + 0x400) & 0xFFFF;
      bus.w8(above, bus.u8(above) === 0x03 ? (next - 0xD0) & 0xFF : next);
      hl = (hl + 1) & 0xFFFF;
    }
    de = (de + 1) & 0xFFFF;
    if ((de & 0x1F) === 0) de = (de + rowBack) & 0xFFFF;
  }
  // ProportionalTextCodeHandler0_05: the end
  const bank = pushWramBank(P, WRAM_TEXT);
  R.textRowIndent = 0;
  resetTextArgQueues(P);
  P.wramBank(bank);
  R.glyphRowStartCol = penToColumn(R.glyphPenX);
  saveGlyphPenColumns(P);
  clearFlag(P, FLAG.PROPORTIONAL_TEXT_MODE);
}

// StampGlyphTileAtPen (05:5F0D): with wGlyphStampEnabled, write the pen's glyph tile ($80 + its column) into the
// shadow map at wGlyphTileWritePtr + (column - wGlyphFlushedCol), wrapping within the map row; never over a $06
// (a window's right border)
export function stampGlyphTileAtPen(P) {
  const R = mapped(P), { bus } = P;
  if (!R.glyphStampEnabled) return;
  const ptr = R.glyphTileWritePtr, col = penToColumn(R.glyphPenX);
  const sum = ((col - R.glyphFlushedCol) & 0xFF) + (ptr & 0xFF);
  let cell = (((ptr >> 8) + (sum >> 8)) & 0xFF) << 8 | (sum & 0xFF);
  if (((cell ^ ptr) & 0x20) !== 0) cell = (cell - 0x20) & 0xFFFF;
  if (bus.u8(cell) === 0x06) return;
  bus.w8(cell, (col + 0x80) & 0xFF);
}

// RenderTextToBuffer64 (05:5F52): text `textId` stored one byte per character (no rasterising) from `dest` in a
// 64-column buffer; a newline is the glyph-row newline ($0D: wGlyphVramDest, less the row indent = `width`); other
// codes below $10 are stored as they are; $00 / $03 end. Dakuten marks onto the byte `width` before.
export function renderTextToBuffer64(P, textId, dest, width) {
  const R = mapped(P), { bus } = P;
  const oldBank = pushWramBank(P, WRAM_TEXT);
  const id = addTextIdOffset(P, textId, 0).hl;
  R.glyphVramDest = dest;
  const back = 0xFF00 | ((-width) & 0xFF);                    // bc = $FF:-width
  R.textRowIndent = (-width) & 0xFF;
  fetchDialogueText(P, id, dest);
  let hl = wTextBuffer, de = dest;
  P.wramBank(oldBank);
  for (;;) {
    const ch = bus.u8(hl);
    if (ch < 0x20) {
      if (ch === 0x00 || ch === 0x03) return;                 // TextCodeEnd_05
      if (ch >= 0x10) unsupported("RenderTextToBuffer64", ch);
      if (ch === 0x01) {                                     // TextCodeLineBreak_05: DispatchControlCode $0D
        de = nextGlyphStreamRow(P); hl = (hl + 1) & 0xFFFF; continue;
      }
    }
    bus.w8(de, ch);                                          // TextCodeLiteral_05
    hl = (hl + 1) & 0xFFFF;
    const next = bus.u8(hl);
    if (next === 0xDE || next === 0xDF) {
      const above = (de + back) & 0xFFFF;
      bus.w8(above, bus.u8(above) === 0x03 ? (next - 0xD0) & 0xFF : next);
      hl = (hl + 1) & 0xFFFF;
    }
    de = (de + 1) & 0xFFFF;
    if ((de & 0x3F) === 0) de = (de + back) & 0xFFFF;
  }
}

// GetObjectSlotPointer (05:5FF2): the actor struct of slot `slot` (64 bytes each at $D000, WRAM bank 4); 0 for $FF,
// $D000 for slots past $17. Returns hl and the flags it leaves.
export function getObjectSlotPointer(P, slot) {
  if (slot === 0xFF) return { hl: 0, f: cpFlags(slot, 0xFF) };
  if (slot >= 0x18) return { hl: 0xD000, f: cpFlags(slot, 0x18) };
  return { hl: 0xD000 + slot * 64, f: (slot & 3) ? 0 : Z };     // Z of its last rr c; add hl, bc carries nothing
}

// WriteStringToWindow (05:600E): a string into window `id` one tile per character from cell (col, row); a dakuten
// mark goes on the cell above the previous character ($0E / $0F when the previous character — the c it last wrote,
// or the caller's c — is $03; ReadWindowCellTileAttr's read is lost)
export function writeStringToWindow(P, id, text, cell, entryC) {
  const { bus } = P;
  let col = cell >> 8, row = cell & 0xFF, last = entryC, p = text;
  for (;;) {
    const ch = bus.u8(p);
    if (ch === 0) return;
    if (ch === 0xDE || ch === 0xDF) {
      readWindowCellTileAttr(P, id, (col - 1) & 0xFF, (row - 1) & 0xFF);
      const mark = last === 0x03 ? (ch - 0xD0) & 0xFF : ch;
      writeWindowCellTileAttr(P, id, (col - 1) & 0xFF, (row - 1) & 0xFF, mark, 0x80);
      p = (p + 1) & 0xFFFF;
      continue;
    }
    p = (p + 1) & 0xFFFF;
    writeWindowCellTileAttr(P, id, col, row, ch, 0x80);
    last = ch;
    col = (col + 1) & 0xFF;
  }
}
// WriteDialogueToWindow (05:6055): text `textId` into window `id` with WriteStringToWindow
export function writeDialogueToWindow(P, id, textId, cell, entryC) {
  fetchDialogueText(P, textId, cell);
  writeStringToWindow(P, id, wTextBuffer, cell, entryC);
}
// Unused_05_WriteNumberToWindow (05:6067): queues the number, but writes Text_30_310 with WriteStringToWindow,
// which prints its $09 as a tile. Nothing calls it.
export function writeNumberToWindow(P, id, value, cell, entryC) {
  pushTextArgNumber(P, value);
  mapped(P).textNumberRightAlign = 1;
  fetchDialogueText(P, Text_30_310, cell);
  writeStringToWindow(P, id, wTextBuffer, cell, entryC);
  mapped(P).textNumberRightAlign = 0;
}

export const HOOKS = [
  hook(5, 0x5DB3, (P, r) => renderProportionalTextAt(P, r.hl, r.de, r.c)),
  hook(5, 0x5F0D, P => { stampGlyphTileAtPen(P); }),
  hook(5, 0x5F52, (P, r) => { renderTextToBuffer64(P, r.hl, r.de, r.c); }),
  hook(5, 0x5FF2, (P, r) => getObjectSlotPointer(P, r.a)),
  hook(5, 0x600E, (P, r) => { writeStringToWindow(P, r.a, r.hl, r.de, r.c); }),
  hook(5, 0x6055, (P, r) => { writeDialogueToWindow(P, r.a, r.hl, r.de, r.c); }),
  hook(5, 0x6067, (P, r) => { writeNumberToWindow(P, r.a, r.hl, r.de, r.c); }),
];
