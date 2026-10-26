// The character select (CharacterSelectScreen 06:6071, bank 06): the roster hl (10 records of 32 bytes: +0
// character ($0B a new one, $FF empty), +2 the name, +$0D, +$0E, +$10, +$11) as a 5 x 2 grid of mini portraits, a
// framed cursor (CharSelectCursorTask, its colour cycling in CharSelectPaletteTask), the slot's big portrait
// animating (CharSelectPortraitAnimTask), an info panel (the name, two numbers, trend marks) or "Create a new
// character here."; A picks a slot (its index, kept in $CABE), B leaves ($FF). The screen is built in WRAM1
// (attributes $D000, tiles $D200, 32 wide) from the LZ assets of bank 4C (00:0234 DecompressDataFromBank).
import { rb, rw } from "./rom.js";
import * as D from "./render/display.js";
import * as Scr from "./screen.js";
import * as T from "./text.js";
import { clearFrameTasks, registerFrameTask, unregisterFrameTask } from "./tasks.js";
import { decompressDataFromBank } from "./mapgfx.js";
import { printHexByte } from "./match.js";
import { formatDecimalNumber } from "./render/text.js";

const B = 0x06;
const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
const wbank = w => w.high[0x196];
const r16 = (w, a) => rd(w, a) | rd(w, (a + 1) & 0xFFFF) << 8;
function notPorted(what) { throw new Error(`${what} is not ported`); }
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}
const slotChar = (w, i) => rd(w, (0xD20A + (i & 0xFF)) & 0xFFFF);   // $D20A[i] (the mapped WRAM bank)
const cursor = w => rd(w, 0xD214);

// ---- the roster: record c of the list at [$D216] ----
const rec = (w, c) => (r16(w, 0xD216) + ((c << 5) & 0xFFFF)) & 0xFFFF;
export function rosterCharacter(w, c) {          // 06:697B RosterCharacter: +0 ($0B and up: $0B, $FF empty)
  const l = rd(w, rec(w, c));
  return l < 0x0B ? l : l === 0xFF ? 0xFF : 0x0B;
}
const rosterNamePtr = (w, c) => (rec(w, c) + 2) & 0xFFFF;              // 06:69A1
const rosterByte0D = (w, c) => rd(w, (rec(w, c) + 0x0D) & 0xFFFF);      // 06:69B5
const rosterWord0E = (w, c) => r16(w, (rec(w, c) + 0x0E) & 0xFFFF);     // 06:69CF
const rosterByte11 = (w, c) => rd(w, (rec(w, c) + 0x11) & 0xFFFF);      // 06:6A34
function rosterSetFlag10(w) {                    // 06:6A01 RosterSetFlag10: record $D214's +$10 = 1
  const old = wbank(w);
  setW(w, 6);
  wr(w, (rec(w, cursor(w)) + 0x10) & 0xFFFF, 1);
  setW(w, old);
}

const slotFirstTile = c => (((c << 3) & 0xFF) + c + 0x9E) & 0xFF;      // 06:64F8 SlotFirstTile
const slotCellList = c => rw(B, (0x6511 + ((c << 1) & 0xFF)) & 0xFFFF);   // 06:6503 SlotCellList (9 words)

// 06:68F8 CharSelectBuildSlots: $D20A[0-9] = RosterCharacter of each record
function buildSlots(w) {
  for (let c = 0; c < 10; c++) wr(w, 0xD20A + c, rosterCharacter(w, c));
}

// 06:6329 LoadMiniPortrait: slot c's portrait (ref hl) LZ to WRAM1 $D9E0 + c x $90
function loadMiniPortrait(w, hl, c) {
  setW(w, 1);
  decompressDataFromBank(w, hl, (0xD9E0 + 0x90 * c) & 0xFFFF);
}
// 06:6347 LoadAllMiniPortraits (refs 06:637E by character)
function loadAllMiniPortraits(w) {
  for (let c = 0; c < 10; c++) {
    setW(w, 6);
    const ch = slotChar(w, c);
    if (ch === 0xFF) continue;
    loadMiniPortrait(w, rw(B, (0x637E + (((ch & 0x0F) << 1) & 0xFF)) & 0xFFFF), c);
  }
  setW(w, 1);
}

// 06:6396 CharSelectPlaceSlotTiles / 06:63CB PutSlotTiles: each slot's 9 tiles from SlotFirstTile into $D200 + cells
function placeSlotTiles(w) {
  setW(w, 1);
  for (let c = 0; c < 10; c++) {
    setW(w, 6);
    if (slotChar(w, c) === 0xFF) continue;
    let b = slotFirstTile(c);
    const cells = slotCellList(c);
    setW(w, 1);
    for (let k = 0; k < 9; k++) { wr(w, (0xD200 + rw(B, cells + 2 * k)) & 0xFFFF, b); b = (b + 1) & 0xFF; }
  }
  setW(w, 1);
}
// 06:63F1 CharSelectSlotPalettes / 06:6422 PutSlotPalette: each slot's 9 attributes (SlotPaletteTable 06:6465 by
// the character) into $D000 + cells
function slotPalettes(w) {
  for (let c = 0; c < 10; c++) {
    setW(w, 6);
    if (slotChar(w, c) === 0xFF) continue;
    const cells = slotCellList(c);
    setW(w, 6);
    const ch = rosterCharacter(w, c);
    setW(w, 1);
    const b = rb(B, (0x6465 + ch) & 0xFFFF);
    for (let k = 0; k < 9; k++) wr(w, (0xD000 + rw(B, cells + 2 * k)) & 0xFFFF, b);
  }
  setW(w, 1);
}

// 06:60E6 CharSelectInit: hl = roster ($D216), b = 0 / not 0 (the other frame tiles); LCD off; the slots, the
// frame and cursor graphics and palettes (palette 10's first colours kept at $D218 for the cursor's cycling), the
// mini portraits, the attribute and tile maps, the panel's tiles; $D220-$D222 = $1F, $1F, 0
function charSelectInit(w, hl, b) {
  setW(w, 6);
  wr(w, 0xD216, hl & 0xFF); wr(w, 0xD217, hl >> 8);
  w.high[0x18A] = w.high[0x18B] = 0;
  D.disableLCDSafely(w);
  clearFrameTasks(w);
  buildSlots(w);
  setW(w, 1);
  decompressDataFromBank(w, 0x4C3E, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xA200, 0x06);
  decompressDataFromBank(w, 0x4C40, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xA260, 0x06);
  D.loadPalettesMasterOnly(w, 0x6255, 0x0A, 0x01);
  setW(w, 6);
  for (let k = 0; k < 8; k++) wr(w, 0xD218 + k, 0);
  for (let k = 0; k < 3; k++) { wr(w, 0xD218 + 2 * k, rb(B, 0x6255 + 2 * k)); wr(w, 0xD219 + 2 * k, rb(B, 0x6256 + 2 * k)); }
  setW(w, 1);
  decompressDataFromBank(w, b ? 0x4C3C : 0x4C3A, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0x8E00, 0x14);
  D.loadPalettesMasterOnly(w, 0x624D, 0x08, 0x01);
  decompressDataFromBank(w, 0x4C42, 0xD000);
  D.queueVRAMCopy(w, 0xD000, 0xB000, 0x80);
  loadAllMiniPortraits(w);
  D.queueAndRunVRAMCopy(w, 0xD800, 0xA800, 0x80);
  decompressDataFromBank(w, 0x4C48, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xA8B0, 0x06);
  D.loadPalettesMasterOnly(w, 0x625D, 0x00, 0x08);
  decompressDataFromBank(w, 0x4C44, 0xD000);
  slotPalettes(w);
  D.queueVRAMCopy(w, 0xD000, 0xB800, 0x24);
  decompressDataFromBank(w, 0x4C46, 0xD200);
  placeSlotTiles(w);
  D.queueAndRunVRAMCopy(w, 0xD200, 0x9800, 0x24);
  setW(w, 1);
  decompressDataFromBank(w, 0x4C4A, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xA920, 0x0C);
  D.loadPalettesMasterOnly(w, 0x629D, 0x09, 0x01);
  setW(w, 6);
  wr(w, 0xD220, 0x1F); wr(w, 0xD221, 0x1F); wr(w, 0xD222, 0);
  D.enableLCD(w);
}

// 06:6914 CharSelectInitCursor: the cursor from $CABE (printed to the debug text buffer) through the slot order
// 06:6971, past empty slots (the last lookup is not reduced mod 10)
function initCursor(w) {
  const old = wbank(w);
  setW(w, 6);
  let b = rd(w, 0xCABE);
  printHexByte(w, b, 0x0100);
  for (let c = 0; c < 10; c++) {
    const i = b >= 0x0A ? b - 0x0A : b;
    if (slotChar(w, rb(B, 0x6971 + i)) !== 0xFF) break;
    b = (b + 1) & 0xFF;
  }
  const a = rb(B, (0x6971 + b) & 0xFFFF);
  wr(w, 0xD214, a); wr(w, 0xD215, a);
  setW(w, old);
}

// 06:6D9A CharSelectLoadPortrait: wFrameCounter $C4B2 = 0; the previous slot's ($D215) still mini portrait back
// (06:6E35 refs; WRAM3 -> VRAM1 $89E0 + slot x $90), the current slot's four portrait frames to WRAM2 $D000
function loadPortrait(w) {
  const old = wbank(w);
  wr(w, 0xC4B2, 0);
  setW(w, 6);
  const prev = rd(w, 0xD215);
  const ch = slotChar(w, prev);
  if (ch === 0xFF) throw new Error("06:6DC0: an empty previous slot unbalances the stack (the game crashes)");
  const ref = rw(B, (0x6E35 + ((ch << 1) & 0xFF)) & 0xFFFF);
  setW(w, 3);
  decompressDataFromBank(w, ref, 0xD000);
  setW(w, 3);
  D.queueVRAMCopy(w, 0xD000, (prev * 0x90 + 0xA9E0) & 0xFFFF, 0x09);
  setW(w, 6);
  const cur = slotChar(w, cursor(w));
  const ref2 = rw(B, (0x6E35 + ((cur << 1) & 0xFF)) & 0xFFFF);
  setW(w, 2);
  decompressDataFromBank(w, ref2, 0xD000);
  setW(w, old);
}

// 06:62CF CharSelectCursorRow: row c of the cursor frame (cells 06:6323) at slot $D214: 3 tiles from b into
// $D300 + cells, the slot's palette into $D000 + cells; returns b
function cursorRow(w, c, b) {
  const cells = rw(B, (0x6323 + ((c << 1) & 0xFF)) & 0xFFFF);
  setW(w, 6);
  const ch = slotChar(w, cursor(w));
  const pal = rb(B, (0x6465 + ch) & 0xFFFF);
  setW(w, 1);
  for (let k = 0; k < 3; k++) {
    wr(w, (0xD000 + cells + k) & 0xFFFF, pal);
    wr(w, (0xD300 + cells + k) & 0xFFFF, b);
    b = (b + 1) & 0xFF;
  }
  setW(w, 6);
  return b;
}
// 06:62A5 CharSelectDrawCursor: the three rows, one a frame
function* drawCursor(sh) {
  const w = sh.w;
  setW(w, 6);
  let b = slotFirstTile(cursor(w));
  for (let c = 0; c < 3; c++) { b = cursorRow(w, c, b); yield* sh.advance(); }
  setW(w, 1);
}

// 06:6ADE CharSelectDrawInfo: the panel rows (WRAM1 $D1A0 attributes / $D4A0 tiles, from the 4C:4E / 4C:4C maps)
// for slot $D214: a record's name (dakuten written a row up), its trend label (rows from $D314 / $D334 / $D354 by
// the sign of +$11), +$0D for the first three slots, +$0E, and fixed labels; a new one's "Create a new character
// here." (text $10F6, $10F7), an empty one's text $10F8; the cursor frame; queued (06:6D22); one frame more
function* drawInfo(sh) {
  const w = sh.w, old = wbank(w);
  setW(w, 1);
  decompressDataFromBank(w, 0x4C44, 0xD000);
  decompressDataFromBank(w, 0x4C46, 0xD300);
  decompressDataFromBank(w, 0x4C4E, 0xD600);
  decompressDataFromBank(w, 0x4C4C, 0xD900);
  D.copyMemoryFast(w, 0xD600, 0xD1A0, 0x0A);
  D.copyMemoryFast(w, 0xD900, 0xD4A0, 0x0A);
  setW(w, 6);
  const ch = slotChar(w, cursor(w));
  if (ch === 0x0B || ch === 0xFF) {
    setW(w, 1);
    D.inBank(w, 0x03, () => T.resetGlyphBuffer(w));   // 03:4EB8
    if (ch === 0x0B) {
      yield* inBankGen(w, 0x05, T.printTextToBuffer(sh, 0x10F6, 0xD4C5, 0x20));
      yield* inBankGen(w, 0x05, T.printTextToBuffer(sh, 0x10F7, 0xD505, 0x20));
    } else yield* inBankGen(w, 0x05, T.printTextToBuffer(sh, 0x10F8, 0xD4E5, 0x20));
    yield* inBankGen(w, 0x03, T.uploadGlyphTiles(sh));   // 03:4F6C
  } else {
    let hl = rosterNamePtr(w, cursor(w));
    let b = 0;
    for (let c = 0; c < 0x0B; c++) {
      setW(w, 6);
      let e = rd(w, hl);
      if (!e) break;
      setW(w, 1);
      let p = (0xD4C5 + b) & 0xFFFF;
      if (e === 0xDE || e === 0xDF) {
        e = e === 0xDE ? 0x0E : 0x0F;
        p = (0xD4A5 + ((b - 1) & 0xFF)) & 0xFFFF;
        b = (b - 1) & 0xFF;
      }
      wr(w, p, e);
      setW(w, 6);
      hl = (hl + 1) & 0xFFFF;
      b = (b + 1) & 0xFF;
    }
    setW(w, 6);
    const t = rosterByte11(w, cursor(w));
    setW(w, 1);
    const src = !t ? 0xD314 : t & 0x80 ? 0xD334 : 0xD354;
    for (let k = 0; k < 5; k++) wr(w, 0xD4EE + k, rd(w, src + k));
    for (let k = 0; k < 5; k++) wr(w, 0xD1EE + k, rd(w, src - 0x300 + k));
    const dec = (v, n, de) => { const s = formatDecimalNumber(v, n); for (let k = 0; k < s.length; k++) wr(w, de + k, s[k]); };   // 00:21F0
    setW(w, 6);
    if (cursor(w) < 3) {
      const l = rosterByte0D(w, cursor(w));
      setW(w, 1);
      if (l >= 0x0A) dec(l, 2, 0xD506); else dec(l, 1, 0xD507);
      wr(w, 0xD508, 0x20);
    }
    setW(w, 6);
    const v = rosterWord0E(w, cursor(w));
    setW(w, 1);
    if (v >> 8 || (v & 0xFF) >= 0x64) dec(v, 3, 0xD509);
    else if ((v & 0xFF) >= 0x0A) dec(v, 2, 0xD50A);
    else dec(v, 1, 0xD50B);
    wr(w, 0xD50C, 0x20);
    setW(w, 1);
    setW(w, 6);
    if (cursor(w) < 3) { setW(w, 1); wr(w, 0xD205, 0x08); wr(w, 0xD505, 0x8F); }
    setW(w, 1);
    for (const [a, v2] of [[0xD20C, 0x08], [0xD20E, 0x28], [0xD20F, 0x28], [0xD210, 0x08], [0xD211, 0x08], [0xD212, 0x08],
      [0xD50C, 0x8E], [0xD50E, 0x8C], [0xD50F, 0x8C], [0xD510, 0x8B], [0xD511, 0x8C], [0xD512, 0x8C]]) wr(w, a, v2);
  }
  setW(w, 1);
  yield* drawCursor(sh);
  D.queueVRAMCopy(w, 0xD1A0, 0xB9A0, 0x0A);     // 06:6D22 CharSelectCopyInfo
  D.queueVRAMCopy(w, 0xD4A0, 0x99A0, 0x0A);
  yield* sh.advance();
  setW(w, 6);
  setW(w, old);
}

// 06:6839 CharSelectMove: e = 0 up / 1 left / 2 down / 3 right in the 5 x 2 grid (wrapping), past empty slots (up
// and down retry for ever when both rows are empty: the game hangs)
function move(sh, e) {
  const w = sh.w;
  sh.sound(0x5B);
  let c = 0x0A;
  let d = cursor(w);
  let a;
  for (let guard = 0; ; guard++) {
    if (guard > 1000) throw new Error("06:6839 CharSelectMove: no slot to move to (the game hangs)");
    if (e === 1) { a = (d - 1) & 0xFF; if (a === 0xFF) a = 9; }
    else if (e === 2) { a = d + 5; if (a >= 0x0A) a = (d + 0xFB) & 0xFF; }
    else if (e === 3) { a = d + 1; if (a === 0x0A) a = 0; }
    else { c = 2; a = (d + 0xFB) & 0xFF; if (a >= 0xFB) a = (d + 5) & 0xFF; }
    d = a;
    if (slotChar(w, a) !== 0xFF) break;
    c = (c - 1) & 0xFF;
    if (!c) break;
  }
  wr(w, 0xD214, a);
}

// 06:6778 CharSelectInput: the d-pad moves (a new slot: its portrait and panel); A picks a slot that is not empty
// (sound $5C either way; Select with A on slots 3 and up sets the record's +$10); B: $FF; else $FE
function* input(sh) {
  const w = sh.w;
  wr(w, 0xD215, cursor(w));
  const rep = w.high[0x191];
  const dir = rep & 0x40 ? 0 : rep & 0x20 ? 1 : rep & 0x80 ? 2 : rep & 0x10 ? 3 : -1;
  if (dir >= 0) {
    move(sh, dir);
    if (cursor(w) !== rd(w, 0xD215)) { loadPortrait(w); yield* drawInfo(sh); }
  }
  if (rep & 1) {
    if (rep & 4 && cursor(w) >= 3) rosterSetFlag10(w);
    sh.sound(0x5C);
    if (slotChar(w, cursor(w)) === 0xFF) return 0xFE;
    wr(w, 0xCABE, cursor(w));
    return cursor(w);
  }
  if (rep & 2) { sh.sound(0x5D); return 0xFF; }
  return 0xFE;
}

// the frame tasks (bank 06)
export const charSelTasks = w => ({
  "06:65d9": () => {                             // 06:65D9 CharSelectCursorTask: template 06:65FE at the slot
    const old = wbank(w);
    setW(w, 6);
    const p = (0x68D0 + ((cursor(w) << 2) & 0xFF)) & 0xFFFF;   // 06:68B6 CharSelectSlotPos
    D.queueSpriteTemplate(w, 0x65FE, rb(B, p + 2), rb(B, p), 0x20, 0x0A);
    setW(w, old);
  },
  "06:6617": () => {                             // 06:6617 CharSelectPaletteTask: the cursor colour from three
    const old = wbank(w);                        // indices stepping through the triangle 06:66B6
    setW(w, 6);
    const step = (a, n) => { const v = (rd(w, a) + n) & 0x3F; wr(w, a, v); return rb(B, 0x66B6 + v) & 0x1F; };
    const r = step(0xD220, 2), g = step(0xD221, 1), bl = step(0xD222, 1);
    const lo = (r + ((g << 5) & 0xFF)) & 0xFF;
    const hi = (((bl << 2) & 0xFF) + ((g >> 3) & 3)) & 0xFF;
    wr(w, 0xD21A, lo); wr(w, 0xD21B, hi);
    D.loadPalettesImmediate(w, 0xD218, 0x0A, 0x01);
    setW(w, old);
  },
  "06:66f6": () => {                             // 06:66F6 CharSelectBobSprite: template 06:674F bobbing (06:670F)
    D.queueSpriteTemplate(w, 0x674F, rb(B, 0x670F + (w.high[0x18C] & 0x3F)), 0x00, 0xE0, 0x00);
  },
  "06:6a4e": () => {                             // 06:6A4E CharSelectDrawTrendMarks: up to 4 marks left (+$11 negative)
    const old = wbank(w);                        // or right of a centre mark, for a record's slot
    setW(w, 6);
    const ch = slotChar(w, cursor(w));
    if (ch !== 0x0B && ch !== 0xFF) {
      const l = rosterByte11(w, cursor(w));
      if (l) {
        if (l < 0x80) {                          // 06:6AC0 CharSelectMarksRight
          let n = l & 0x0F; if (n >= 4) n = 4;   // (0: dec a wraps, 256 sprites tried)
          let d = 0x8C;
          do { D.queueSprite(w, 0x84, d, 0x9C, 0x09); d = (d + 4) & 0xFF; n = (n - 1) & 0xFF; } while (n);
        } else {                                 // 06:6AA3 CharSelectMarksLeft
          let n = (((l & 0x0F) ^ 0x0F) + 1) & 0xFF; if (n >= 4) n = 4;
          for (let d = 0x7C; n; n--, d = (d + 0xFC) & 0xFF) D.queueSprite(w, 0x84, d, 0x9C, 0x29);
        }
      }
      D.queueSprite(w, 0x84, 0x84, 0x92, 0x09);
    }
    setW(w, old);
  },
  "06:6e4d": () => {                             // 06:6E4D CharSelectPortraitAnimTask: the slot's portrait frame by
    const old = wbank(w);                        // wFrameCounter against the character's thresholds 06:6EFE
    if (rd(w, 0xC4B2)) {
      setW(w, 6);
      const de = (cursor(w) * 0x90 + 0xA9E0) & 0xFFFF;
      const t = (0x6EFE + ((slotChar(w, cursor(w)) << 2) & 0xFF)) & 0xFFFF;
      setW(w, 2);
      const f = rd(w, 0xC4B2);
      let a;
      if (f >= rb(B, t)) {
        if (f >= ((rb(B, t + 3) + rb(B, t)) & 0xFF)) wr(w, 0xC4B2, 0);
        a = 3;
      } else if (f >= rb(B, t + 1)) a = 2;
      else if (f >= rb(B, t + 2)) a = 1;
      else a = 0;
      const fr = rb(B, 0x6EFA + (a & 3));
      D.queueVRAMCopy(w, (0xD000 + fr * 0x90) & 0xFFFF, de, 0x09);
    }
    setW(w, old);
  },
});

// 06:6071 CharacterSelectScreen: hl = roster, b (CharSelectInit); returns the slot or $FF
export function* characterSelectScreen(sh, hl, b) {
  const w = sh.w;
  charSelectInit(w, hl, b);
  registerFrameTask(w, 0x1F, B, 0x66F6);         // CharSelectBobSprite
  registerFrameTask(w, 0x1E, B, 0x6A4E);         // CharSelectDrawTrendMarks
  initCursor(w);
  loadPortrait(w);
  registerFrameTask(w, 0x1B, B, 0x6E4D);         // CharSelectPortraitAnimTask
  yield* drawInfo(sh);
  Scr.beginFadeIn(w, 0x10);
  yield* Scr.waitFade(sh);
  registerFrameTask(w, 0x1D, B, 0x65D9);         // CharSelectCursorTask
  registerFrameTask(w, 0x1C, B, 0x6617);         // CharSelectPaletteTask
  let a;
  do {
    yield* sh.advance();
    a = yield* input(sh);
  } while (a === 0xFE);
  for (const t of [0x66F6, 0x65D9, 0x6A4E, 0x6617, 0x6E4D]) unregisterFrameTask(w, B, t);
  Scr.beginFadeOut(w, 0x10);
  yield* Scr.waitFade(sh);
  return a;
}

// 06:690F ResetCharSelectCursor
export function resetCharSelectCursor(w) { wr(w, 0xCABE, 0); }
