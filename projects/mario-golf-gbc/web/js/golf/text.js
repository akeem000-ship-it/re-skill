// Text: the proportional-font glyph renderer of bank 03 and the text printer of bank 05 for tile buffers.
//
// Glyphs (Font 03:50F0: one 2bpp 8x8 tile per character from $20, FontWidths 03:5750) are OR-ed into a glyph
// buffer of $80 tiles at $D000 (WRAM7 as the callers map it) at a bit-precise pen (wGlyphPen $C36A: bits 0-2 the
// pixel, /128 the tile), and the buffer's tiles are uploaded to VRAM $8800 (tile ids $80 up). PrintTextToBuffer
// 05:62AA (export 22) prints a text id into any tile map buffer: it draws the glyphs, then writes the run of tile
// numbers they cover. Control codes in the text insert names and numbers (TextControlDispatch 05:58E2).
//
// Everything goes through the CPU's view of memory (render/display.js rd / wr): WRAM $D000 is the bank in
// hWRAMBank ($FF96), as the ROM's code sees it, so the routines that leave the caller's bank mapped (the control
// codes read their argument lists in it) behave the same. A routine that waits frames is a generator (sh.advance).
import { rb, rw } from "./rom.js";
import { mulHLByA } from "./math.js";
import { formatDecimalNumber } from "./render/text.js";
import * as D from "./render/display.js";

const rd = D.rd, wr = D.wr;
const wbank = w => w.high[0x196];                // hWRAMBank (raw, as pushed and popped by the ROM)
const setW = (w, n) => D.setWramBank(w, n);      // ldh [hWRAMBank], a ; ldh [rSVBK], a
const r16 = (w, a) => rd(w, a) | rd(w, a + 1) << 8;
const testFlag = (w, n) => w.wram[0][0x840 + (n >> 3)] & (0x80 >> (n & 7));         // rst $30
const setFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] |= 0x80 >> (n & 7); };      // rst $20
const clearFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] &= ~(0x80 >> (n & 7)); }; // rst $28
const pen = w => rd(w, 0xC36A) | rd(w, 0xC36B) << 8;
const setPen = (w, de) => { wr(w, 0xC36A, de & 0xFF); wr(w, 0xC36B, de >> 8); };
const penTile = w => (pen(w) >> 7) & 0xFF;       // rl l / ld l, h / rl l: (pen >> 7) & $FF
const sraDE = (d, e) => ((d >> 1) | (d & 0x80)) << 8 | (d & 1) << 7 | e >> 1;   // sra d ; rr e
const FONT = 0x50F0, WIDTHS = 0x5750;

// ---- bank 03 ----

// 03:4B45 DrawGlyph: a = char; its 16 font bytes OR-ed in at the pen de; returns the pen moved by the glyph's width
export function drawGlyph(w, a, de) {
  const g = (a - 0x20) & 0xFF;
  let src = (g << 4) + FONT, p = de;
  for (let k = 0; k < 16; k++) { blitGlyphByte(w, rb(3, src++), p); p = (p + 8) & 0xFFFF; }
  const b = ((de & 7) + lookupGlyphWidth(g)) & 0xFF;
  let e = de & 0xFF, d = de >> 8;
  if (b & 8) { e += 0x80; if (e > 0xFF) { e &= 0xFF; d = (d + 1) & 0xFF; } }   // (only bit 3: a 16-pixel step is lost)
  return d << 8 | (e & 0xF8) | (b & 7);
}
export const getCharWidth = a => lookupGlyphWidth((a - 0x20) & 0xFF);   // 03:4B89 GetCharWidth
export const lookupGlyphWidth = g => rb(3, WIDTHS + (g & 0xFF));        // 03:4B93 LookupGlyphWidth

// 03:4B9D BlitGlyphByte: a = font byte at bit position de of the buffer $D000: the part right of the pen into this
// tile's byte, the rest into the same byte of the next tile (16 bytes on)
export function blitGlyphByte(w, a, de) {
  const c = de & 7;
  const hi = a >> c, maskR = 0xFF >> c;
  const lo = (a << (8 - c)) & 0xFF, maskL = (0xFF << (8 - c)) & 0xFF;
  const s = de & 0x8000 ? (de >> 3) | 0xE000 : de >> 3;   // sra d ; rr e (x3)
  const hl = (0xD000 + s) & 0xFFFF;
  wr(w, hl, (rd(w, hl) & maskL) | hi);
  const h2 = (hl + 16) & 0xFFFF;
  wr(w, h2, (rd(w, h2) & maskR) | lo);
}

export function clearGlyphBuffer(w) {            // 03:4BFE ClearGlyphBuffer: $80 tiles of Font tile 0
  let de = 0xD000;
  for (let t = 0; t < 0x80; t++) for (let k = 0; k < 16; k++) wr(w, de++, rb(3, FONT + k));
}

// 05:60B0 GetWindowRecord: a = window slot -> its record pointer (the slot word at $D800 + 4a)
export function getWindowRecord(w, a) {
  return r16(w, (0xD800 + ((a << 2) & 0xFF)) & 0xFFFF);
}

// 03:4C17 ClearWindowGlyphs: the glyph tiles of window [$D821] ((w - 2) x ((h - 2) / 2 + 1), low byte) from tile
// [$C36E] cleared; leaves WRAM7 mapped
export function clearWindowGlyphs(w) {
  setW(w, 5);
  const rec = getWindowRecord(w, rd(w, 0xD821));
  const a = (rd(w, rec + 3) - 2) & 0xFF;
  let b = (rd(w, rec + 4) - 2) & 0xFF;
  b = (((b >> 1) | (b & 0x80)) + 1) & 0xFF;
  let n = mulHLByA(b, a) & 0xFF;
  let de = (0xD000 + (rd(w, 0xC36E) << 4)) & 0xFFFF;
  setW(w, 7);
  do {
    for (let k = 0; k < 16; k++) { wr(w, de, rb(3, FONT + k)); de = (de + 1) & 0xFFFF; }
    n = (n - 1) & 0xFF;
  } while (n);
}

// 03:4C60 UploadGlyphBuffer: WRAM7 $D000-$D4FF to $8800-$8CFF (VRAM1 when wWindowAttr bit 3), $100 bytes a frame
// (the last block $70 bytes with flag #27), flag #24 set meanwhile
export function* uploadGlyphBuffer(sh) {
  const w = sh.w, old = wbank(w);
  setFlag(w, 24);
  yield* sh.advance();
  setW(w, 5);
  let hl = rd(w, 0xD84D) & 8 ? 0xAC00 : 0x8C00;
  const dst = [];
  for (let k = 0; k < 5; k++) { dst.unshift(hl); hl = (hl + 0xFF00) & 0xFFFF; }
  setW(w, 7);
  for (let k = 0; k < 5; k++) {
    const c = k < 4 ? 0x10 : testFlag(w, 27) ? 0x07 : 0x10;
    D.inBank(w, 3, () => D.queueVRAMCopy(w, 0xD000 + (k << 8), dst[k], c));
    yield* sh.advance();                         // (00:0684 DisableOAMDMA before each: a write to the MBC)
  }
  clearFlag(w, 24);
  setW(w, old);
}

// 03:4CF1 RenderStringToGlyphs (no callers): hl = string, drawn from the buffer's start after clearing it; $01 =
// next line (the window [$D821]'s width - 2 tiles on), $02 / $03 end
export function renderStringToGlyphs(w, hl) {
  const old = wbank(w);
  setW(w, 5);
  const b = (rd(w, getWindowRecord(w, rd(w, 0xD821)) + 3) - 2) & 0xFF;
  let c = b;
  setW(w, 7);
  clearGlyphBuffer(w);
  let de = 0;
  for (;;) {
    const a = rd(w, hl); hl = (hl + 1) & 0xFFFF;
    if (a === 2 || a === 3) break;
    if (a === 1) { de = sraDE(c, 0); c = (c + b) & 0xFF; continue; }
    de = drawGlyph(w, a, de);
  }
  setW(w, old);
}

// 03:4D41 InitTextPen: the pen at tile [$C36E] (0 for window 0), the line length [window w] - 2, the next line's
// tile, the window's glyph tiles cleared
export function initTextPen(w) {
  const old = wbank(w);
  setW(w, 5);
  let de = 0;
  const cur = rd(w, 0xD821);
  if (cur) de = sraDE(rd(w, 0xC36E), 0);
  setPen(w, de);
  const d = (rd(w, getWindowRecord(w, rd(w, 0xD821)) + 3) - 2) & 0xFF;
  let e = d;
  if (rd(w, 0xD821)) e = (rd(w, 0xC36E) + e) & 0xFF;
  wr(w, 0xC36C, d); wr(w, 0xC36D, e);
  clearWindowGlyphs(w);
  setW(w, old);
}

// 03:4D93 DrawNextChar: the char at [wTextReadPtr $D869] (read with WRAM5 mapped) at the pen; $01 = next line
export function drawNextChar(w) {
  const old = wbank(w);
  setW(w, 5);
  const b = rd(w, 0xC36C), c = rd(w, 0xC36D);
  let de = pen(w);
  const a = rd(w, r16(w, 0xD869));
  if (a !== 2 && a !== 3) {
    if (a === 1) { de = sraDE(c, 0); wr(w, 0xC36D, (c + b) & 0xFF); }
    else { setW(w, 7); de = drawGlyph(w, a, de); }
  }
  setPen(w, de);
  wr(w, 0xC36E, ((de << 1) >> 8) & 0xFF);
  setW(w, old);
}

// 03:4DF0 UploadCurrentCharTiles: for the message window (the last opened one) at a typing speed, the two glyph
// tiles under the pen go to VRAM at once (wReplayActive: only below tile $5F)
export function uploadCurrentCharTiles(w) {
  const cur = rd(w, 0xD821), last = rd(w, 0xD820);
  if (last !== cur || rd(w, 0xD824) !== last) return;
  const s = rd(w, 0xC82D);
  if (s & 0x80 || !(s & 0x7F)) return;
  const old = wbank(w);
  setW(w, 7);
  const b = rd(w, 0xC96D) ? 0x5F : 0x7F;
  if (rd(w, 0xC36E) < b) {
    const p = pen(w);
    let t = p >> 7 & 0x1FF;                      // (9 bits here)
    if (t) t--;
    const off = (t << 4) & 0xFFFF;
    D.inBank(w, 3, () => D.queueVRAMCopy(w, (0xD000 + off) & 0xFFFF, (0x8800 + off) & 0xFFFF, 2));
  }
  setW(w, old);
}

// 03:4E6A DrawCharFromHL: the char at hl at the pen ($01: next line, tile [$C36D] = [$C36E] = c + b; $02 / $03:
// nothing); hl is not moved
export function drawCharFromHL(w, hl) {
  const old = wbank(w);
  const b = rd(w, 0xC36C), c = rd(w, 0xC36D);
  let de = pen(w);
  const a = rd(w, hl);
  if (a !== 2 && a !== 3) {
    if (a === 1) {
      de = sraDE(c, 0);
      wr(w, 0xC36D, (c + b) & 0xFF); wr(w, 0xC36E, (c + b) & 0xFF);
    } else { setW(w, 7); de = drawGlyph(w, a, de); }
  }
  setPen(w, de);
  setW(w, old);
}

export function resetGlyphBuffer(w) {            // 03:4EB8 ResetGlyphBuffer (03:4EDC ResetGlyphBufferDup: the same)
  const old = wbank(w);
  for (let k = 0; k < 6; k++) wr(w, 0xC36A + k, 0);
  setW(w, 7);
  clearGlyphBuffer(w);
  setW(w, old);
}

export function setTextLineLength(w, c) {        // 03:4F02 SetTextLineLength: pen at tile [$C36E]; $C36C = $C36D = c
  setPen(w, sraDE(rd(w, 0xC36E), 0));
  wr(w, 0xC36C, c); wr(w, 0xC36D, c);
}

// 03:4F21 WriteGlyphTileNumbers: de = tile map; writes $80 + [$C36E] on for the tiles from the block start
// [$C36F] to the pen's tile; [$C36E] moves past them (bit 7 set: $7F)
export function writeGlyphTileNumbers(w, de) {
  const n = (penTile(w) + 1 - rd(w, 0xC36F)) & 0xFF;
  let a = (rd(w, 0xC36E) + 0x80) & 0xFF;
  let c = n;
  do { wr(w, de, a); de = (de + 1) & 0xFFFF; a = (a + 1) & 0xFF; c = (c - 1) & 0xFF; } while (c);
  a = (a - 0x80) & 0xFF;
  if (a & 0x80) a = 0x7F;
  wr(w, 0xC36E, a);
}

export function commitGlyphBlock(w) {            // 03:4F58 CommitGlyphBlock
  const c = rd(w, 0xC36E), b = rd(w, 0xC36F);
  wr(w, 0xC370, (c - b) & 0xFF); wr(w, 0xC371, b); wr(w, 0xC36F, c);
}

export function* uploadGlyphTiles(sh) {          // 03:4F6C UploadGlyphTiles
  if (sh.w.lcd.lcdc & 0x80) yield* uploadGlyphTilesFramed(sh);
  else uploadGlyphTilesDirect(sh.w);
}

// 03:4F7D FinishTextBlock: the glyph tiles uploaded (unless typed into the message window char by char), then
// the next block starts at the next line's tile
export function* finishTextBlock(sh) {
  const w = sh.w;
  const typed = rd(w, 0xD824) === rd(w, 0xD821) && !(rd(w, 0xC82D) & 0x80) && (rd(w, 0xC82D) & 0x7F);
  if (!typed) yield* uploadGlyphTiles(sh);
  const b = rd(w, 0xC36C), c = rd(w, 0xC36D);
  wr(w, 0xC36F, rd(w, 0xC36E));
  const a = (c + b) & 0xFF;
  wr(w, 0xC36D, a); wr(w, 0xC36E, a);
}

// 03:4FB7 UploadGlyphTilesFramed: the glyph tiles up to [$C36E] (at most $80, $60 in a replay) to $8800, one
// $100-byte step a frame; each queued copy is $1A blocks long (it overlaps the next); flag #24 set meanwhile
export function* uploadGlyphTilesFramed(sh) {
  const w = sh.w, old = wbank(w);
  setFlag(w, 24);
  setW(w, 7);
  const lim = rd(w, 0xC96D) ? 0x60 : 0x80;
  let a = rd(w, 0xC36E);
  if (a >= lim) a = lim;
  let b = 0;
  for (;;) { b++; if (a < 0x10) break; a -= 0x10; }
  setW(w, 5);
  let de = rd(w, 0xD84D) & 8 ? 0xA800 : 0x8800;
  setW(w, 7);
  let hl = 0xD000;
  for (; b; b--) {
    D.inBank(w, 3, () => D.queueVRAMCopy(w, hl, de, 0x1A));
    de = (de + 0x100) & 0xFFFF; hl = (hl + 0x100) & 0xFFFF;
    yield* sh.advance();                         // (00:0684 DisableOAMDMA before: a write to the MBC)
  }
  clearFlag(w, 24);
  setW(w, old);
}

// 03:5039 UploadGlyphTilesDirect (LCD off): the tiles up to the pen's to VRAM0 $8800 in $200-byte DMA blocks
export function uploadGlyphTilesDirect(w) {
  const old = wbank(w);
  let a = penTile(w);
  setW(w, 7);
  let b = 0;
  for (;;) { b++; const r = a - 0x20; if (r <= 0) break; a = r; }
  let hl = 0xD000, de = 0x8800;
  for (; b; b--) {
    w.lcd.vbk = 0;
    D.startVRAMDMAFromHL(w, hl, de, 0x20);
    de = (de + 0x200) & 0xFFFF; hl = (hl + 0x200) & 0xFFFF;
  }
  setW(w, old);
}

// 03:5087 UploadGlyphRange: [$C370] glyph tiles (at most 32) from tile [$C371] queued to $8800 (VRAM1 with
// wGlyphVRAMBank $C372); returns QueueVRAMCopy's a
export function uploadGlyphRange(w) {
  const old = wbank(w);
  setW(w, 7);
  const off = rd(w, 0xC371) << 4;
  let de = 0x8800 + off;
  if (rd(w, 0xC372)) de = (de + 0x2000) & 0xFFFF;
  let c = rd(w, 0xC370);
  if (c >= 0x20) c = 0x20;
  const ok = D.inBank(w, 3, () => D.queueVRAMCopy(w, 0xD000 + off, de, c));
  setW(w, old);
  return ok ? 1 : 0;
}

// 03:50CD DrawStringToGlyphs: hl = string ($00 ends), de = tile (x 16 bytes; the high nibble of d dropped)
export function drawStringToGlyphs(w, hl, de) {
  let p = ((de & 0x0FFF) << 3) & 0xFFFF;
  for (;;) {
    const a = rd(w, hl); hl = (hl + 1) & 0xFFFF;
    if (!a) return;
    p = drawGlyph(w, a, p);
  }
}

// ---- bank 05 ----

// the text bank's export 0 / 1 (TextBankXX_Load / TextBankXX_LoadShort) -> TextBankXX_Copy: the string at index de
// (a word index) of the bank's offset table to wTextBuffer $C600 ($180 bytes) or wTextShortBuffer $D880 ($20 bytes).
// The same three routines sit in each text bank: 18:7D04 18:7D0C 18:7D14, 19:7AC3 19:7ACB 19:7AD3, 1A:7B20 1A:7B28
// 1A:7B30, 1B:7B4B 1B:7B53 1B:7B5B, 1C:7B14 1C:7B1C 1C:7B24, 1D:7CF5 1D:7CFD 1D:7D05, 1E:6B4D 1E:6B55 1E:6B5D,
// 1F:73B1 1F:73B9 1F:73C1 (their tables and strings are read from where each copy's own code points)
function textBankCopy(w, bank, de, short) {
  const copy = rw(bank, 0x4002) + 8;             // the routine after LoadShort
  const offsets = rw(bank, copy + 4), strings = rw(bank, copy + 0x0F);
  const src = (strings + rw(bank, (offsets + ((de << 1) & 0xFFFF)) & 0xFFFF)) & 0xFFFF;
  D.inBank(w, bank, () => D.copyMemoryBC(w, src, short ? 0xD880 : 0xC600, short ? 0x20 : 0x180));
}
const textBankOf = id => 0x18 + ((id >> 10) & 7);

export function loadText(w, id) {                // 05:6179 LoadText: the string of text id hl to $C600
  textBankCopy(w, textBankOf(id), id & 0x3FF, false);
}
export function loadTextShort(w, id) {           // 05:61D4 LoadTextShort: to $D880 in the mapped WRAM bank
  textBankCopy(w, textBankOf(id), id & 0x3FF, true);
}

// 05:40C2 CopyTextShortToDE: LoadTextShort with WRAM5 mapped, then the string with its $00 to de (WRAM5 mapped)
export function copyTextShortToDE(w, id, de) {
  const old = wbank(w);
  setW(w, 5);
  loadTextShort(w, id);
  let hl = 0xD880;
  for (;;) {
    const a = rd(w, hl); hl = (hl + 1) & 0xFFFF;
    wr(w, de, a); de = (de + 1) & 0xFFFF;
    if (!a) break;
  }
  setW(w, old);
}

// 05:622F NormalizeTextId: hl = text id + a; an index at or past its bank's count (TextBankSizeTable 05:629A)
// carries once into the next text bank
export function normalizeTextId(id, a) {
  const e0 = id >> 8;
  const idx = ((id & 0x3FF) + a) & 0xFFFF;
  const saved = ((idx >> 8) | (e0 & 0x1C)) << 8 | (idx & 0xFF);
  const size = rw(5, 0x629A + ((e0 & 0x1C) >> 1));
  const left = (size - idx) & 0xFFFF;
  if (left && !(left & 0x8000)) return saved;
  let b = saved >> 8;
  b = (b & 0xE0) | (((b & 0x1C) + 4) & 0xFF);
  const over = (-left) & 0xFFFF;
  b = (b | (over >> 8 & 3)) & 0xFF;
  return b << 8 | (over & 0xFF);
}

// 05:62AA PrintTextToBuffer: hl = text id, de = tile map buffer, c = its row stride. The glyphs go at the pen from
// tile [$C36E] (line length c), then the tile numbers they cover are written at de. $00, $01 and $03 end the text;
// the codes $04 $07 $08 $09 $0B $0E insert their strings; any other byte (other codes included) is drawn as a
// glyph. A following $DE / $DF (dakuten) rewrites the byte a row above in the buffer (de - stride).
export function* printTextToBuffer(sh, id, de, c) {
  const w = sh.w;
  const de0 = de;
  setTextLineLength(w, c);
  let old = wbank(w);
  setW(w, 5);
  id = normalizeTextId(id, 0);
  for (const a of [0xD847, 0xD866, 0xD848, 0xD867, 0xD849, 0xD868]) wr(w, a, 0);
  wr(w, 0xD864, de & 0xFF); wr(w, 0xD865, de >> 8);
  const bc = 0xFF00 | ((-c) & 0xFF);
  wr(w, 0xC362, bc & 0xFF);
  loadText(w, id);
  let hl = 0xC600;
  setW(w, old);
  for (;;) {
    let a = rd(w, hl);
    if (!a || a === 3 || a === 1) break;
    if (a === 7 || a === 4 || a === 9 || a === 8 || a === 0x0B || a === 0x0E) {
      if (a === 0x0E) { hl = (hl + 1) & 0xFFFF; wr(w, 0xC361, rd(w, hl)); }
      de = yield* textControlDispatch(sh, a, de);
      hl = (hl + 1) & 0xFFFF;
      continue;
    }
    D.inBank(w, 3, () => drawCharFromHL(w, hl));
    hl = (hl + 1) & 0xFFFF;
    a = rd(w, hl);
    if (a === 0xDE || a === 0xDF) {
      const p = (de + bc) & 0xFFFF;
      wr(w, p, rd(w, p) === 3 ? (a - 0xD0) & 0xFF : a);
      hl = (hl + 1) & 0xFFFF;
    }
    de = (de + 1) & 0xFFFF;
    if (!(de & 0x3F)) de = (de + bc) & 0xFFFF;
  }
  old = wbank(w);
  setW(w, 5);
  wr(w, 0xC362, 0);
  for (const a of [0xD847, 0xD866, 0xD848, 0xD867, 0xD849, 0xD868]) wr(w, a, 0);
  setW(w, old);
  D.inBank(w, 3, () => { writeGlyphTileNumbers(w, de0); commitGlyphBlock(w); });
}

// 05:58E2 TextControlDispatch: a = code; the handler (TextControlTable 05:592C) gets de (the pen in the buffer or
// the shadow) and gives it back moved
export function* textControlDispatch(sh, a, de) {
  const w = sh.w;
  switch (a) {
    case 0x04: return yield* textCmdStringArg(sh, de);
    case 0x07: return yield* printInlineString(sh, 0xC800, de);     // 05:55C0 TextCmdPlayerName
    case 0x08: return yield* textCmdByteArg(sh, de);
    case 0x09: return yield* textCmdNumberArg(sh, de);
    case 0x0B:                                   // 05:5786 TextCmdCourseName: short text $3C + [$D85D]
      loadTextShort(w, (0x3C + rd(w, 0xD85D)) & 0xFFFF);
      return yield* printInlineString(sh, 0xD880, de);
    case 0x0C: yield* sh.advance(0x3C); return de;   // 05:5465 TextCmdPause60: WaitFramesCmd 60
    case 0x0E:                                   // 05:57DF TextCmdCharName: short text $43 + [wTextControlArg]
      copyTextShortToDE(w, (0x43 + rd(w, 0xC361)) & 0xFFFF, 0xC780);
      return yield* printInlineString(sh, 0xC780, de);
    case 0x0F: {                                 // 05:5828 TextCmdPlacing: short text $1CA3 + ([$DFCE] & 3)
      const old = wbank(w);
      setW(w, 5);
      copyTextShortToDE(w, 0x1CA3 + (rd(w, 0xDFCE) & 3), 0xC780);
      de = yield* printInlineString(sh, 0xC780, de);
      setW(w, old);
      return de;
    }
    default:
      throw new Error(`text control code $${a.toString(16)} (~05:58E2 TextControlDispatch: the window printer's) is not ported`);
  }
}

// 05:546A TextCmdStringArg: the next pointer of wTextStringArgs $DFAE (its high byte zeroed after; the pointer's
// high nibble is the WRAM bank) copied ($20 bytes) to wTextArgBuffer $C780 and printed; leaves WRAM5 mapped
function* textCmdStringArg(sh, de) {
  const w = sh.w;
  const idx = rd(w, 0xD847);
  if (idx === rd(w, 0xD84A)) return de;
  wr(w, 0xD847, (idx + 1) & 0xFF);
  const p = (0xDFAE + ((idx << 1) & 0xFF)) & 0xFFFF;
  let hl = r16(w, p);
  if (!(hl >> 8)) return de;
  wr(w, (p + 1) & 0xFFFF, 0);
  const h = hl >> 8;
  let bank = h >> 4;
  if (h & 0x80) bank |= 0xF0;                    // (sra: the sign copied in)
  if (bank) { hl = ((h & 0x0F) | 0xD0) << 8 | (hl & 0xFF); setW(w, bank); }
  else { hl = ((h & 0x0F) | 0xC0) << 8 | (hl & 0xFF); setW(w, 0); }
  D.copyMemoryBC(w, hl, 0xC780, 0x20);
  setW(w, 5);
  return yield* printInlineString(sh, 0xC780, de);
}

// 05:564C TextCmdByteArg: short text [wTextByteArgs $DFEE + n] printed (the counters in the mapped WRAM bank)
function* textCmdByteArg(sh, de) {
  const w = sh.w;
  const idx = rd(w, 0xD849);
  if (idx === rd(w, 0xD84C)) return de;
  wr(w, 0xD849, (idx + 1) & 0xFF);
  loadTextShort(w, rd(w, (0xDFEE + idx) & 0xFFFF));
  return yield* printInlineString(sh, 0xD880, de);
}

// 05:56AB TextCmdNumberArg: the next word of wTextNumberArgs $DFCE in decimal
function* textCmdNumberArg(sh, de) {
  const w = sh.w, old = wbank(w);
  setW(w, 5);
  const idx = rd(w, 0xD848);
  if (idx === rd(w, 0xD84B)) { setW(w, old); return de; }
  wr(w, 0xD848, (idx + 1) & 0xFF);
  const v = r16(w, (0xDFCE + ((idx << 1) & 0xFF)) & 0xFFFF);
  setW(w, old);
  return yield* printDecWordInline(sh, v, de);
}

// 05:5A13 PrintDecWordInline: hl in decimal (00:21F0 FormatDecimalNumber, no padding, on the stack); with
// wPrintNoPad $C360 set the pen first moves right by 5 - digits
export function* printDecWordInline(sh, hl, de) {
  const w = sh.w;
  const s = formatDecimalNumber(hl, 0);
  if (rd(w, 0xC360)) {
    let e = 5;
    for (let i = 0; ; i++) { if (!s[i]) break; e--; if (!e) break; }
    de = (de + e) & 0xFFFF;
  }
  return yield* printInlineString(sh, s, de);
}

// 05:596C PrintInlineString: hl = string (an address, or the bytes of one on the stack): each char drawn at the
// pen (03:4E6A, 03:4DF0) with the typing delay; de (the shadow address) moves one per char and wraps to the row's
// start every 32; first, unless reading the text buffer's start, a de at a row start (after other than $05) is
// moved back a row
export function* printInlineString(sh, str, de) {
  const w = sh.w;
  const at = typeof str === "number" ? i => rd(w, (str + i) & 0xFFFF) : i => str[i];
  const back = () => { de = (de + 0xFFE0) & 0xFFFF; };
  if (!(rd(w, 0xD86A) === 0xC6 && rd(w, 0xD869) === 0)) {
    if (rd(w, (de - 1) & 0xFFFF) !== 5 && !(de & 0x1F)) back();
  }
  let i = 0;
  for (;;) {
    let a = at(i);
    if (!a) return de;
    if (typeof str === "number") D.inBank(w, 3, () => drawCharFromHL(w, (str + i) & 0xFFFF));
    else drawCharFromStack(w, a);
    D.inBank(w, 3, () => uploadCurrentCharTiles(w));
    i++;
    a = at(i);
    if (a === 0xDE || a === 0xDF) {
      const p = (de + 0xFFE0) & 0xFFFF;
      if (rd(w, p) === 3) a = (a - 0xD0) & 0xFF;
      wr(w, p, a);
      i++;
    }
    yield* textCharDelay(sh, a);
    de = (de + 1) & 0xFFFF;
    if (!(de & 0x1F)) back();
  }
}
function drawCharFromStack(w, a) {               // 03:4E6A DrawCharFromHL on a byte of a stack string
  const old = wbank(w);
  const b = rd(w, 0xC36C), c = rd(w, 0xC36D);
  let de = pen(w);
  if (a === 1) { de = sraDE(c, 0); wr(w, 0xC36D, (c + b) & 0xFF); wr(w, 0xC36E, (c + b) & 0xFF); }
  else if (a !== 2 && a !== 3) { setW(w, 7); de = drawGlyph(w, a, de); }
  setPen(w, de);
  setW(w, old);
}

// 05:5CC2 TextCharDelay: in the message window, with a delay wTextCharDelay $D829: the voice blip ($69 + voice x 4
// + (char & 3), unless voice 8) and the delay's frames (one while a button other than Select / Start is held)
export function* textCharDelay(sh, c) {
  const w = sh.w, old = wbank(w);
  setW(w, 5);
  if (rd(w, 0xD821) === rd(w, 0xD824)) {
    const b = rd(w, 0xD829);
    if (b) {
      const v = rd(w, 0xD862);
      if (v !== 8) sh.sound(((c & 3) + ((v << 2) & 0xFF) + 0x69) & 0xFF);   // 00:2C19 PlaySoundManaged
      if (w.high[0x190] & 0xF3) yield* sh.advance();
      else yield* sh.advance(b);
    }
  }
  setW(w, old);
}

// 05:54CF PushTextStringArg: hl = string; a $Dxxx pointer gets the mapped WRAM bank in its high nibble, any other
// its high nibble dropped (bank 0); appended to wTextStringArgs (16 at most) for code $04
export function pushTextStringArg(w, hl) {
  const h = hl >> 8, old = wbank(w);
  const hh = (h & 0xF0) === 0xD0 ? ((old << 4) | (h & 0x0F)) & 0xFF : h & 0x0F;
  setW(w, 5);
  const n = rd(w, 0xD847);
  if (n !== 0x10) {
    wr(w, 0xD847, n + 1); wr(w, 0xD84A, n + 1);
    const p = 0xDFAE + ((n << 1) & 0xFF);
    wr(w, p, hl & 0xFF); wr(w, p + 1, hh);
  }
  setW(w, old);
}
export function pushTextNumberArg(w, hl) {       // 05:551F PushTextNumberArg: for code $09 (16 at most)
  const old = wbank(w);
  setW(w, 5);
  const n = rd(w, 0xD848);
  if (n !== 0x10) {
    wr(w, 0xD848, n + 1); wr(w, 0xD84B, n + 1);
    const p = 0xDFCE + ((n << 1) & 0xFF);
    wr(w, p, hl & 0xFF); wr(w, p + 1, (hl >> 8) & 0xFF);
  }
  setW(w, old);
}
export function pushTextByteArg(w, a) {          // 05:5552 PushTextByteArg: a short text index for code $08
  const old = wbank(w);
  setW(w, 5);
  const n = rd(w, 0xD849);
  if (n !== 0x10) { wr(w, 0xD849, n + 1); wr(w, 0xD84C, n + 1); wr(w, 0xDFEE + n, a); }
  setW(w, old);
}
export function setTextCourseIndex(w, a) {       // 05:57C3 SetTextCourseIndex: the argument of code $0B
  const old = wbank(w);
  setW(w, 5); wr(w, 0xD85D, a); setW(w, old);
}
