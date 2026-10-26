// The film-strip selects: GameModeSelect 0D:4AA7 and CourseSelect 0F:4AB7 run the same code (0D:4007-0D:4A90 and
// 0F:400B-0F:4AA0, only the addresses differ): a strip of pictures (one per item of an id list) that scrolls 12
// columns a step with Left / Right, a title sprite row bobbing (SelectTitleWaveTask), arrows (SelectArrowsTask), a
// name box drawn by the descriptor's hooks (0D:6FF7 / 0F:4CD4 draw, 0D:7070 / 0F:4D33 clear); A returns the id, B
// $FF. The strip is a 32-wide map at $C600 (attributes) / $C700 (tiles); the descriptor ([$D200]) has 12 bytes per
// id from +8 (fields: 0 emblem tiles, 2 strip picture, 4 picture tiles, 6 emblem attributes, 8 picture map, $0A
// palette); the id list is [$D207] (index hFFB0 from 1, count hFFB2).
import { rb, rw } from "./rom.js";
import * as D from "./render/display.js";
import * as Scr from "./screen.js";
import * as T from "./text.js";
import { clearFrameTasks, registerFrameTask, unregisterFrameTask } from "./tasks.js";
import { buildTextWindowRecord } from "./windows.js";
import { printHexByte } from "./match.js";

const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
const wbank = w => w.high[0x196];
const r16 = (w, a) => rd(w, a) | rd(w, (a + 1) & 0xFFFF) << 8;
const H = (w, a) => w.high[0x100 + a];           // HRAM $FFxx
const setH = (w, a, v) => { w.high[0x100 + a] = v & 0xFF; };
function notPorted(what) { throw new Error(`${what} is not ported`); }
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}

// the two copies' addresses (code 0D = 0F - 4; most data 0D = 0F - $10)
const CFG = {
  0x0D: { bank: 0x0D, frame: 0x4830, map1: 0x4882, map2: 0x48C5, pal: 0x4901, blank: 0x4670, tiles8700: 0x46F0,
    waveTbl: 0x4175, waveTpl: 0x41B5, arrowFrames: 0x4730, box1: 0x4944, box2: 0x4919, wave: 0x415C, arrows: 0x428E },
  0x0F: { bank: 0x0F, frame: 0x4840, map1: 0x4892, map2: 0x48D5, pal: 0x4911, blank: 0x4680, tiles8700: 0x4700,
    waveTbl: 0x4179, waveTpl: 0x41B9, arrowFrames: 0x4740, box1: 0x4954, box2: 0x4929, wave: 0x4160, arrows: 0x4292 },
};

// 0F:4613 GetCourseField / 0D:460F ModeGetField: h = -1 / 0 / +1 from the current item (wrapping), l = field: the
// word at [$D200] + 12 x id + 8 + l (an index 0 with more than one item reads the last; past the count, the first)
function getField(w, c, rel, l) {
  const old = wbank(w);
  setW(w, 6);
  const n = H(w, 0xB2);
  let h = (H(w, 0xB0) + rel) & 0xFF;
  if (!h) { if (n !== 1) h = n; }
  else if (n < h) h = n === 1 ? 0 : 1;
  const id = rd(w, (r16(w, 0xD207) + h) & 0xFFFF);
  const p = (r16(w, 0xD200) + (((id * 3) << 2) & 0xFFFF) + l + 8) & 0xFFFF;
  const v = rw(c.bank, p);
  setW(w, old);
  return v;
}
const lz = (w, c, src, de) => D.lzTo(w, c.bank, src, de);

function copyFilmRows(w) {                       // 0F:4247 CopyFilmRowsToVRAM
  D.queueVRAMCopy(w, 0xC600, 0xB880, 0x10);
  D.queueVRAMCopy(w, 0xC700, 0x9880, 0x10);
}
function nextSlot(w) { let a = (H(w, 0xB4) + 8) & 0xFF; if (a === 0xB0) a = 0x10; setH(w, 0xB4, a); }   // 0F:425E
function prevSlot(w) { let a = (H(w, 0xB4) + 0xF8) & 0xFF; if (a === 0x08) a = 0xA8; setH(w, 0xB4, a); }  // 0F:4278
function shiftLeft(w) { D.copyMemoryBC(w, 0xC601, 0xC600, 0x1FF); }                // 0F:426B
function shiftRight(w) {                         // 0F:4285 (00:03E2 CopyMemoryReverseBC)
  for (let hl = 0xC7FE, de = 0xC7FF, n = 0x1FF; n; n--, hl--, de--) wr(w, de, rd(w, hl));
}
const slotVram = a => {                          // the tile slot's VRAM1 address ($9000 + a x 16, or $8800 + ...)
  let hl = (a << 4) & 0xFFFF;
  if (!(hl & 0x800)) hl |= 0x1000;
  return (hl + 0xA000) & 0xFFFF;
};

// 0F:459B InitFilmMaps: the strip's attributes ($0B, $09 sprockets at columns 4 and 15) and tile ids from hFFB4
function initFilmMaps(w) {
  let hl = 0xC600;
  for (let r = 0; r < 8; r++) {
    for (let k = 0; k < 20; k++) wr(w, hl + k, k === 4 || k === 15 ? 0x09 : 0x0B);
    hl += 32;
  }
  let a0 = H(w, 0xB4);
  for (let r = 0; r < 8; r++) {
    let a = a0;
    for (let k = 0; k < 20; k++) {               // 0F:4592 StoreFilmTileId
      wr(w, hl++, a);
      a = (a + 8) & 0xFF;
      if (a >= 0xB0) a = (a - 0xA0) & 0xFF;
    }
    hl += 0x0C;
    a0 = (a0 + 1) & 0xFF;
  }
  copyFilmRows(w);
}

// 0F:44FD LoadCoursePicture (LCD off) / 0F:44BA ReloadCoursePicture: the palette (field $0A), the picture's tiles
// (field 4 -> VRAM1 $8B00-$8FFF), then 0F:4538: the 10 x 8 picture map rows (field 8) and tile ids $B0-$FF
function* loadPicture(sh, c, reload) {
  const w = sh.w;
  const pal = getField(w, c, 0, 0x0A);
  if (reload) D.loadPalettesImmediate(w, pal, 0x04, 0x04); else D.loadPalettesMasterOnly(w, pal, 0x04, 0x04);
  lz(w, c, getField(w, c, 0, 4), 0xD000);
  D.queueVRAMCopy(w, 0xD000, 0xAB00, 0x20);
  if (reload) yield* sh.advance();
  D.queueVRAMCopy(w, 0xD200, 0xAD00, 0x20);
  if (reload) { yield* sh.advance(); D.queueVRAMCopy(w, 0xD400, 0xAF00, 0x10); }
  else D.queueAndRunVRAMCopy(w, 0xD400, 0xAF00, 0x10);
  let de = 0xC605;
  let hl = getField(w, c, 0, 8);
  for (let r = 0; r < 8; r++) {
    for (let k = 0; k < 10; k++) { wr(w, de, rd(w, hl)); de++; hl = (hl + 1) & 0xFFFF; }
    de += 0x16;
  }
  let a = 0xB0;
  for (let r = 0; r < 8; r++) {
    for (let k = 0; k < 10; k++) { wr(w, de++, a); a = (a + 1) & 0xFF; }
    de += 0x16;
  }
  copyFilmRows(w);
}

// 0F:42CD FilmScrollLeftStep / 0F:43AC FilmScrollRightStep: the strip one column over, the next picture column (8
// tiles from hFFB6, which moves $80) into the tile slot hFFB4, the new column's attributes and ids; one frame
function* scrollLeftStep(sh) {
  const w = sh.w;
  shiftLeft(w);
  const a = H(w, 0xB4);
  const src = H(w, 0xB6) | H(w, 0xB7) << 8;
  D.queueVRAMCopy(w, src, slotVram(a), 0x08);
  const n = (src + 0x80) & 0xFFFF;
  setH(w, 0xB6, n & 0xFF); setH(w, 0xB7, n >> 8);
  for (let k = 0; k < 8; k++) wr(w, 0xC613 + 32 * k, 0x0B);
  for (let k = 0; k < 8; k++) wr(w, 0xC713 + 32 * k, (a + k) & 0xFF);
  nextSlot(w);
  copyFilmRows(w);
  yield* sh.advance();
}
function* scrollRightStep(sh) {
  const w = sh.w;
  prevSlot(w);
  shiftRight(w);
  const a = H(w, 0xB4);
  const src = H(w, 0xB6) | H(w, 0xB7) << 8;
  D.queueVRAMCopy(w, src, slotVram(a), 0x08);
  const n = (src + 0xFF80) & 0xFFFF;
  setH(w, 0xB6, n & 0xFF); setH(w, 0xB7, n >> 8);
  for (let k = 0; k < 8; k++) wr(w, 0xC600 + 32 * k, 0x0B);
  for (let k = 0; k < 8; k++) wr(w, 0xC700 + 32 * k, (a + k) & 0xFF);
  copyFilmRows(w);
  yield* sh.advance();
}
// 0F:4481 DrawFilmGapColumn: hl = the column: sprockets ($09) and the slot's ids; the blank tile into the slot
function* drawGapColumn(sh, c, hl) {
  const w = sh.w;
  for (let k = 0; k < 8; k++) wr(w, hl + 32 * k, 0x09);
  const a = H(w, 0xB4);
  for (let k = 0; k < 8; k++) wr(w, hl + 0x100 + 32 * k, (a + k) & 0xFF);
  D.queueVRAMCopy(w, c.blank, slotVram(a), 0x08);
  copyFilmRows(w);
  yield* sh.advance();
}

// the name box: 0F:4AA0 CopyNameBoxToVRAM, 0F:4995 LoadNameBoxMaps, 0F:4A11 OpenNameBoxAnim
function copyNameBox(w) {
  D.queueVRAMCopy(w, 0xD1A0, 0xB9A0, 0x0A);
  D.queueVRAMCopy(w, 0xD4A0, 0x99A0, 0x0A);
}
function loadNameBoxMaps(w, c) { lz(w, c, c.box1, 0xD1A0); lz(w, c, c.box2, 0xD4A0); }
function* openNameBoxAnim(sh, c) {
  const w = sh.w;
  lz(w, c, c.map1, 0xD000); lz(w, c, c.map2, 0xD300); lz(w, c, c.box1, 0xD600); lz(w, c, c.box2, 0xD900);
  D.copyMemoryFast(w, 0xD620, 0xD1E0, 2); D.copyMemoryFast(w, 0xD920, 0xD4E0, 2);
  copyNameBox(w); yield* sh.advance();
  D.copyMemoryFast(w, 0xD600, 0xD1C0, 4); D.copyMemoryFast(w, 0xD900, 0xD4C0, 4);
  D.copyMemoryFast(w, 0xD680, 0xD200, 2); D.copyMemoryFast(w, 0xD980, 0xD500, 2);
  copyNameBox(w); yield* sh.advance();
  D.copyMemoryFast(w, 0xD600, 0xD1A0, 0x0A); D.copyMemoryFast(w, 0xD900, 0xD4A0, 0x0A);
  copyNameBox(w); yield* sh.advance();
}
const currentId = w => {                         // [[$D207] + hFFB0] with WRAM6 mapped
  const old = wbank(w);
  setW(w, 6);
  const id = rd(w, (r16(w, 0xD207) + H(w, 0xB0)) & 0xFFFF);
  setW(w, old);
  return id;
};

// 05:5B3B SizeMessageBox: measures wTextBuffer (or the resume pointer) to wTextBoxWidth $D854 (printed to the debug
// text buffer) and rebuilds the record of wMessageWindow (slot 0 with none: a zero pointer writes the MBC's RAM
// enable register, nothing kept) centred in its box ($D825-$D828); $D867 = the record's flags byte
function sizeMessageBox(w) {
  let hl = rd(w, 0xD84F) ? r16(w, 0xD84E) : 0xC600;
  let b = 0, d = 0, e = 0;
  for (;;) {
    const a = rd(w, hl); hl = (hl + 1) & 0xFFFF;
    if (a === 0 || a === 2) break;
    if (a === 1) { e = (e + 1) & 0xFF; if (d < b) d = b; b = 0; continue; }
    if ([8, 9, 7, 4, 0x0B, 0x0E, 0x0F].includes(a)) notPorted(`measuring text code $${a.toString(16)} (~05:5B3B)`);
    if (a < 0x20 || a >= 0x7B) continue;
    b = (b + T.getCharWidth(a)) & 0xFF;
  }
  e = (e + 1) & 0xFF;
  if (d < b) d = b;
  d = ((d >> 3) + (d & 7 ? 1 : 0)) & 0xFF;
  wr(w, 0xD854, d);
  printHexByte(w, d, 0x0A0C);
  const bw = (d + 2) & 0xFF, ch = ((e << 1) + 1) & 0xFF;
  let s = rd(w, 0xD824);
  if (s === 0xFF) s = 0;
  const rec = r16(w, (0xD800 + ((s << 2) & 0xFF)) & 0xFFFF);
  const sra = v => ((v >> 1) | (v & 0x80)) & 0xFF;
  const x = (sra((rd(w, 0xD827) - bw) & 0xFF) + rd(w, 0xD825)) & 0xFF;
  const y = (sra((rd(w, 0xD828) - ch) & 0xFF) + rd(w, 0xD826)) & 0xFF;
  const f = rd(w, rec);
  buildTextWindowRecord(w, rec, x, y, bw, ch);   // 05:4773
  wr(w, 0xD867, f);
}
// 05:615D GetTextBoxWidth: hl = text id -> its width in tiles (LoadText, SizeMessageBox)
function getTextBoxWidth(w, hl) {
  const old = wbank(w);
  setW(w, 5);
  T.loadText(w, hl);
  D.inBank(w, 0x05, () => sizeMessageBox(w));
  const a = rd(w, 0xD854);
  setW(w, old);
  return a;
}

// the descriptors' hooks: draw (0) and clear (1) the name box
const HOOKS = {
  0x4CD4: function* (sh, c) {                    // 0F:4CD4 DrawCourseNameBox: the emblem; texts $21 + id and $28 + id
    const w = sh.w;                              // ($2F + id without a save file)
    D.inBank(w, 0x03, () => T.resetGlyphBuffer(w));
    loadNameBoxMaps(w, c);
    lz(w, c, getField(w, c, 0, 0), 0xD600);      // 0F:49AA DrawCourseEmblem
    D.queueVRAMCopy(w, 0xD600, 0xB070, 0x09);
    for (let r = 0, t = 7; r < 3; r++) for (let k = 0; k < 3; k++) wr(w, 0xD4C1 + 32 * r + k, t++);
    const at = getField(w, c, 0, 6);
    for (let r = 0, p = at; r < 3; r++) for (let k = 0; k < 3; k++, p++) wr(w, 0xD1C1 + 32 * r + k, rd(w, p));
    const id = currentId(w);
    yield* inBankGen(w, 0x05, T.printTextToBuffer(sh, (0x21 + id) & 0xFFFF, 0xD4C5, 0x20));
    const base = (rd(w, 0xC2A5) & 0x0F) === 0x0F ? 0x2F : 0x28;
    yield* inBankGen(w, 0x05, T.printTextToBuffer(sh, (base + id) & 0xFFFF, 0xD505, 0x20));
    yield* inBankGen(w, 0x03, T.uploadGlyphTiles(sh));
    copyNameBox(w);
    yield* sh.advance();
  },
  0x6FF7: function* (sh, c) {                    // 0D:6FF7 DrawModeNameBox: the mode's name (text $66 + id) centred
    const w = sh.w;                              // on $D4CA, its description ($70 + id; $7A + id in link play) on $D50A
    D.inBank(w, 0x03, () => T.resetGlyphBuffer(w));
    loadNameBoxMaps(w, c);
    const id = currentId(w);
    let hl = (0x66 + id) & 0xFFFF;
    let a = ((getTextBoxWidth(w, hl) + 1) & 0xFF) >> 1;
    yield* inBankGen(w, 0x05, T.printTextToBuffer(sh, hl, (0xD4CA - a) & 0xFFFF, 0x20));
    hl = ((rd(w, 0xC33F) ? 0x7A : 0x70) + id) & 0xFFFF;
    a = ((getTextBoxWidth(w, hl) + 1) & 0xFF) >> 1;
    yield* inBankGen(w, 0x05, T.printTextToBuffer(sh, hl, (0xD50A - a) & 0xFFFF, 0x20));
    yield* inBankGen(w, 0x03, T.uploadGlyphTiles(sh));
    copyNameBox(w);
    yield* sh.advance();
  },
  0x4D33: function* (sh, c) { loadNameBoxMaps(sh.w, c); copyNameBox(sh.w); yield* sh.advance(); },   // 0F:4D33
  0x7070: function* (sh, c) { loadNameBoxMaps(sh.w, c); copyNameBox(sh.w); yield* sh.advance(); },   // 0D:7070
};
function* callHook(sh, c, n) {                   // 0F:4963 CallSelectHook0 / 0F:497B CallSelectHook1
  const w = sh.w, old = wbank(w);
  setW(w, 6);
  const h = rw(c.bank, (r16(w, 0xD200) + 2 * n) & 0xFFFF);
  setW(w, old);
  if (!HOOKS[h]) notPorted(`the select hook ~${c.bank.toString(16)}:${h.toString(16)}`);
  yield* HOOKS[h](sh, c);
}

// 0F:400B CourseSelectInit / 0D:4007 ModeSelectInit: hl = id list, e = start index, d = count, bc = descriptor
function* selectInit(sh, c, hl, e, d, bc) {
  const w = sh.w;
  setW(w, 6);
  wr(w, 0xD207, hl & 0xFF); wr(w, 0xD208, hl >> 8);
  wr(w, 0xD200, bc & 0xFF); wr(w, 0xD201, bc >> 8);
  setH(w, 0xB0, e); setH(w, 0xB2, d); setH(w, 0xB4, 0x10);
  D.disableLCDSafely(w);
  clearFrameTasks(w);
  w.high[0x18A] = w.high[0x18B] = 0;
  setW(w, 1);
  lz(w, c, rw(c.bank, (bc + 4) & 0xFFFF), 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0x8E00, 0x14);
  D.loadPalettesMasterOnly(w, rw(c.bank, (bc + 6) & 0xFFFF), 0x0C, 0x01);
  lz(w, c, c.frame, 0xD000); lz(w, c, c.map1, 0xD100); lz(w, c, c.map2, 0xD400);
  lz(w, c, getField(w, c, 1, 2), 0xD700);
  lz(w, c, getField(w, c, 0xFF, 2), 0xDB00);
  lz(w, c, getField(w, c, 0, 2), 0xD900);
  w.lcd.vbk = 1;
  D.startVRAMDMAFromHL(w, 0xD000, 0x9000, 0x10);
  D.startVRAMDMAFromHL(w, 0xD100, 0x9800, 0x24);
  w.lcd.vbk = 0;
  D.startVRAMDMAFromHL(w, 0xD400, 0x9800, 0x24);
  D.loadPalettesMasterOnly(w, c.pal, 0x01, 0x03);
  D.loadPalettesMasterOnly(w, c.pal, 0x09, 0x03);
  D.loadPalettesMasterOnly(w, getField(w, c, 0, 0x0A), 0x04, 0x04);
  w.lcd.vbk = 1;
  D.startVRAMDMAFromHL(w, 0xDE00, 0x9100, 0x20);
  D.startVRAMDMAFromHL(w, c.blank, 0x9300, 0x08);
  D.startVRAMDMAFromHL(w, 0xD900, 0x9380, 0x48);
  D.startVRAMDMAFromHL(w, 0xDD80, 0x8800, 0x08);
  D.startVRAMDMAFromHL(w, c.blank, 0x8880, 0x08);
  D.startVRAMDMAFromHL(w, 0xD700, 0x8900, 0x20);
  D.startVRAMDMAFromHL(w, c.tiles8700, 0xA700, 0x04);
  initFilmMaps(w);
  yield* loadPicture(sh, c, false);
  D.enableLCD(w);
  yield* sh.advance(2);
  registerFrameTask(w, 0x01, c.bank, c.wave);
  registerFrameTask(w, 0x01, c.bank, c.arrows);
  yield* openNameBoxAnim(sh, c);
}

// 0F:4328 CourseSelectNext / 0F:4401 CourseSelectPrev: sound $5B; the name box cleared; the next / previous item
// (wrapping) scrolled in over 12 steps with a gap column between the pictures; the name box drawn
function* selectNext(sh, c) {
  const w = sh.w;
  sh.sound(0x5B);
  unregisterFrameTask(w, c.bank, c.arrows);
  yield* callHook(sh, c, 1);
  initFilmMaps(w);
  yield* sh.advance();
  let a = (H(w, 0xB0) + 1) & 0xFF;
  if (a >= ((H(w, 0xB2) + 1) & 0xFF)) a = 1;
  setH(w, 0xB0, a);
  lz(w, c, getField(w, c, 0, 2), 0xD000);
  lz(w, c, getField(w, c, 1, 2), 0xD500);
  yield* sh.advance(2);
  setH(w, 0xB6, 0x00); setH(w, 0xB7, 0xD2);
  for (let k = 0; k < 6; k++) yield* scrollLeftStep(sh);
  shiftLeft(w);
  yield* drawGapColumn(sh, c, 0xC613);
  nextSlot(w);
  for (let k = 0; k < 4; k++) yield* scrollLeftStep(sh);
  yield* loadPicture(sh, c, true);
  yield* sh.advance();
  yield* callHook(sh, c, 0);
  registerFrameTask(w, 0x01, c.bank, c.arrows);
}
function* selectPrev(sh, c) {
  const w = sh.w;
  sh.sound(0x5B);
  unregisterFrameTask(w, c.bank, c.arrows);
  yield* callHook(sh, c, 1);
  initFilmMaps(w);
  yield* sh.advance();
  let a = (H(w, 0xB0) - 1) & 0xFF;
  if (!a) a = H(w, 0xB2);
  setH(w, 0xB0, a);
  lz(w, c, getField(w, c, 0, 2), 0xD500);
  lz(w, c, getField(w, c, 0xFF, 2), 0xD000);
  yield* sh.advance(2);
  setH(w, 0xB6, 0x80); setH(w, 0xB7, 0xD7);
  for (let k = 0; k < 6; k++) yield* scrollRightStep(sh);
  prevSlot(w);
  shiftRight(w);
  yield* drawGapColumn(sh, c, 0xC600);
  for (let k = 0; k < 4; k++) yield* scrollRightStep(sh);
  yield* loadPicture(sh, c, true);
  yield* sh.advance();
  yield* callHook(sh, c, 0);
  registerFrameTask(w, 0x01, c.bank, c.arrows);
}

// 0F:41E2 CourseSelectInput / 0D:41DE ModeSelectInput
function* selectInput(sh, c) {
  const w = sh.w;
  registerFrameTask(w, 0x01, c.bank, c.arrows);
  yield* callHook(sh, c, 0);
  let a;
  for (;;) {
    yield* sh.advance();
    const rep = w.high[0x191];
    if (rep & 0x20) { if (H(w, 0xB2) >= 2) yield* selectPrev(sh, c); continue; }
    if (rep & 0x10) { if (H(w, 0xB2) >= 2) yield* selectNext(sh, c); continue; }
    if (rep & 1) {
      sh.sound(0x5C);
      setW(w, 6);
      a = rd(w, (r16(w, 0xD207) + H(w, 0xB0)) & 0xFFFF);
      break;
    }
    if (rep & 2) { setW(w, 6); sh.sound(0x5D); a = 0xFF; break; }
  }
  unregisterFrameTask(w, c.bank, c.arrows);
  return a;
}

// the frame tasks of both copies
export const selectTasks = w => {
  const o = {};
  for (const c of Object.values(CFG)) {
    const k = a => `${c.bank.toString(16).padStart(2, "0")}:${a.toString(16)}`;
    o[k(c.wave)] = () => {                       // 0F:4160 / 0D:415C: the title sprite row bobbing
      D.queueSpriteTemplate(w, c.waveTpl, rb(c.bank, c.waveTbl + (w.high[0x18C] & 0x3F)), 0x00, 0xE0, 0x04);
    };
    o[k(c.arrows)] = () => {                     // 0F:4292 / 0D:428E: the animated tile (0F:42B4), the arrows
      const n = (H(w, 0xB1) + 1) & 0xFF;
      setH(w, 0xB1, n);
      D.queueVRAMCopy(w, (c.arrowFrames + ((n & 0x1C) << 2)) & 0xFFFF, 0xB060, 0x01);
      if (H(w, 0xB2) < 2) return;
      if ((H(w, 0xB1) & 0x0F) >= 0x0C) return;
      D.queueSprite16(w, 0x48, 0x14, 0x70, 0x09);
      D.queueSprite16(w, 0x48, 0x8C, 0x70, 0x29);
    };
  }
  return o;
};

// 0F:4B7A BuildCourseList: $D658 = 0, then the course ids for the game mode (hUnlockAll: all six); returns d = count
function buildCourseList(w) {
  setW(w, 6);
  const ids = [];
  const flag = n => w.wram[0][0x840 + (n >> 3)] & (0x80 >> (n & 7));   // rst $30
  const saveFlag = (d, e) => {                   // 02:44F2 TestSaveFlag: SRAM $A038[d] & mask 02:44EA (hFF97 = 0)
    w.high[0x197] = 0;
    return w.sram[0x38 + d] & rb(0x02, 0x44EA + ((((e << 3) | (e >> 5)) & 0xFF) & 0xFF));
  };
  const unlock = w.high[0x1CF];
  if ((rd(w, 0xC2A5) & 0x0F) === 0x0F) {
    if (unlock) ids.push(1, 2, 3, 4, 5, 6);
    else {
      ids.push(1, 2, 3, 4);
      if (saveFlag(0x01, 0xE0)) ids.push(5);
      if (saveFlag(0x02, 0x00)) ids.push(6);
    }
  } else if (rd(w, 0xC834) === 1) {
    if (unlock) ids.push(1, 2, 3, 4, 5);
    else {
      ids.push(1);
      if (flag(112)) ids.push(2);
      if (flag(113)) ids.push(3);
      if (flag(114)) ids.push(4);
      if (flag(139)) ids.push(5);
    }
  } else if (rd(w, 0xC834) === 2 && !rd(w, 0xC33F)) ids.push(1, 2, 3, 4);
  else if (unlock) ids.push(1, 2, 3, 4, 5, 6);
  else {
    ids.push(1, 2, 3, 4);
    if (flag(139)) ids.push(5);
    if (flag(159)) ids.push(6);
  }
  wr(w, 0xD658, 0);
  ids.forEach((v, k) => wr(w, 0xD659 + k, v));
  return ids.length;
}

// 0F:4AB7 CourseSelect: the course list, the select (descriptor 0F:4C78); returns the course id or $FF
export function* courseSelect(sh) {
  const w = sh.w, c = CFG[0x0F];
  const d = buildCourseList(w);
  yield* selectInit(sh, c, 0xD658, 1, d, 0x4C78);
  Scr.beginFadeIn(w, 0x10);
  yield* Scr.waitFade(sh);
  const a = yield* selectInput(sh, c);
  Scr.beginFadeOut(w, 0x10);
  yield* Scr.waitFade(sh);
  return a;
}

// 0D:4AA7 GameModeSelect: the mode list (0D:707A GetModeList: 1 2 3 4 9; 3 4 without a save file; 2 3 in link
// play), from the current wGameMode (0D:70A9 FindModeIndex: 1 when absent; 0, the list's pad byte, for mode 0);
// returns the mode id or $FF
export function* gameModeSelect(sh) {
  const w = sh.w, c = CFG[0x0D];
  let hl, d;
  if (rd(w, 0xC33F)) { hl = 0x70A6; d = 2; }
  else if ((rd(w, 0xC2A5) & 0x0F) === 0x0F) { hl = 0x709D; d = 2; }
  else { hl = 0x708F; d = 5; }
  const m = rd(w, 0xC834);
  let e = 1;
  for (let k = 0; k <= d; k++) if (rb(0x0D, hl + k) === m) { e = k; break; }
  yield* selectInit(sh, c, hl, e, d, 0x4ACC);
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  const a = yield* selectInput(sh, c);
  Scr.beginFadeOut(w, 0x08);
  yield* Scr.waitFade(sh);
  return a;
}
