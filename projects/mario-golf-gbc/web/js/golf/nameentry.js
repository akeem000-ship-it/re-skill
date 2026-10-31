// Bank 06's name entry (NameEntryScreen 06:51DC: the new character's name, from the story's opening) and the
// portrait helpers the opening uses. The letter grid is two pages of 17 x 6 keys drawn from the ROM's tile maps
// (06:4EA0: attributes and tiles per page) into WRAM1 ($D400 attributes, $D000 tiles), the name in the row at
// $D047; the cursor $C3F6 / $C3F7 moves over the keys of the layout 06:505B (0 a key, 1 a gap the cursor skips, 2
// the END row's wide keys); Start puts the cursor on END, B deletes (or, with no letters, cancels), A types the key
// (row 5: column $0A DEL, $10 END).
import * as D from "./render/display.js";
import { rb } from "./rom.js";
import { registerFrameTask, unregisterFrameTask } from "./tasks.js";
import { advanceRandomSeed } from "./round.js";
import { copyTextShort } from "./start.js";

const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
const B = 0x06;

// 06:5B39 LoadPortraitTiles: character a's 9 portrait tiles (06:5B80 + a x $90) queued to de, its palette (06:6000 +
// a x 8) to BG palette b now (00:056C LoadPalettesImmediate)
export function loadPortraitTiles(w, a, b, de) {
  D.inBank(w, B, () => {
    D.queueVRAMCopy(w, (0x5B80 + a * 0x90) & 0xFFFF, de, 0x09);
    D.loadPalettesImmediate(w, (0x6000 + a * 8) & 0xFFFF, b, 1);
  });
}
// 06:6040 FillTileBlock3x3: tiles c, c+1, ... in 3 rows of 3 at hl (row stride a), attribute b at de
export function fillTileBlock3x3(w, hl, de, b, c, a) {
  const skip = (a - 3) & 0xFF;
  for (let r = 0, t = c; r < 3; r++) {
    for (let k = 0; k < 3; k++) { wr(w, hl, t); hl = (hl + 1) & 0xFFFF; t = (t + 1) & 0xFF; }
    hl = (hl + skip) & 0xFFFF;
  }
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 3; k++) { wr(w, de, b); de = (de + 1) & 0xFFFF; }
    de = (de + skip) & 0xFFFF;
  }
}

// 06:4EA9 NameEntryLoadPage: page $C4B3's attributes -> $D400, tiles -> $D000 ($240 bytes each, 00:03EB
// CopyMemoryFast)
function nameEntryLoadPage(w) {
  const p = 0x4EA0 + ((rd(w, 0xC4B3) << 2) & 0xFF);
  const at = rb(B, p) | rb(B, p + 1) << 8, ti = rb(B, p + 2) | rb(B, p + 3) << 8;
  D.inBank(w, B, () => { D.copyMemoryFast(w, at, 0xD400, 0x24); D.copyMemoryFast(w, ti, 0xD000, 0x24); });
}
const copyTilemap = w => D.inBank(w, B, () => D.queueVRAMCopy(w, 0xD000, 0x9800, 0x24));   // 06:4ED3
const copyAttrmap = w => D.inBank(w, B, () => D.queueVRAMCopy(w, 0xD400, 0xB800, 0x24));   // 06:4EE0
function cursorToEnd(w) { wr(w, 0xC3F6, 0x10); wr(w, 0xC3F7, 0x05); }   // 06:4EED NameEntryCursorToEnd
export function nameLength(w) {                  // 06:4EFA NameLength
  let c = 0;
  for (let hl = 0xC800; rd(w, hl); hl++) c = (c + 1) & 0xFF;
  return c;
}
// 06:4F0D NameEntryDrawName: the 7 cells' attributes 3 ($D027) and blanks ($D047), then the name's letters (the
// dakuten branch 06:4F38 is never reached)
function nameEntryDrawName(w) {
  for (let k = 0; k < 7; k++) wr(w, 0xD027 + k, 0x03);
  for (let k = 0; k < 7; k++) wr(w, 0xD047 + k, 0x20);
  for (let hl = 0xD047, de = 0xC800; ;) {
    const a = rd(w, de++);
    if (!a) return;
    wr(w, hl++, a);
  }
}
// 06:4F4A NameEntryBackspace: the last letter removed, the name and the tile map again
function nameEntryBackspace(w) {
  if (!nameLength(w)) return;
  let hl = 0xC800;
  while (rd(w, hl++)) {}
  wr(w, hl - 2, 0);
  nameEntryDrawName(w);
  copyTilemap(w);
}
// 06:4F6C NameEntrySwitchPage: the page, the name, the portrait's frame (06:6040 at $D021 / $D421: tiles $E0,
// attribute 6, stride $20), both maps queued
function nameEntrySwitchPage(w) {
  nameEntryLoadPage(w);
  nameEntryDrawName(w);
  fillTileBlock3x3(w, 0xD021, 0xD421, 0x06, 0xE0, 0x20);
  copyTilemap(w);
  copyAttrmap(w);
}
// 06:5001 NameFull: 7 letters
const nameFull = w => (nameLength(w) >= 7 ? 0xFF : 0);
// 06:4F87 NameEntryPressA: row 5 column $0A: backspace; column $10: END ($C4B3 bit 7); otherwise the key's tile
// ($D0C0 + 64 x row + column + 1) appended unless the name is full, the cursor to END at 7 letters (the page switch
// 06:4FA4 and 06:4FD8 are never reached)
function nameEntryPressA(w) {
  const d = rd(w, 0xC3F6), e = rd(w, 0xC3F7);
  if (e === 5 && d === 0x0A) { nameEntryBackspace(w); return; }
  if (e === 5 && d === 0x10) { wr(w, 0xC4B3, rd(w, 0xC4B3) | 0x80); return; }
  const key = rd(w, (0xD0C0 + (e << 6) + ((d + 1) & 0xFF)) & 0xFFFF);
  let hl = 0xC800;
  while (rd(w, hl++)) {}
  hl--;
  if (nameFull(w)) return;
  wr(w, hl, key); wr(w, hl + 1, 0);
  nameEntryDrawName(w);
  copyTilemap(w);
  if (nameLength(w) === 7) cursorToEnd(w);
}
// 06:50C1 NameEntryMoveCursor: hJoyRepeat's d-pad (sound $5B): x 0-$10 and y 0-5 wrapping; a gap key (1) moves on
// the same way, a wide key (2) moves on sideways (Right when the move was Up / Down)
function nameEntryMoveCursor(sh) {
  const w = sh.w;
  let d = rd(w, 0xC3F6), e = rd(w, 0xC3F7), b = w.high[0x191];
  if (b & 0xF0) {
    sh.sound(0x5B);
    for (;;) {
      if (b & 0x20) d = (d - 1) & 0xFF;
      else if (b & 0x10) d = (d + 1) & 0xFF;
      else if (b & 0x40) e = (e - 1) & 0xFF;
      else if (b & 0x80) e = (e + 1) & 0xFF;
      d = d & 0x80 ? 0x10 : d >= 0x11 ? 0 : d;
      e = e & 0x80 ? 0x05 : e >= 0x06 ? 0 : e;
      const k = rb(B, 0x505B + ((e * 0x11 + d) & 0xFF));
      if (k === 0) break;
      if (k === 2 && !(b & 0x30)) b = 0x10;
    }
  }
  wr(w, 0xC3F6, d); wr(w, 0xC3F7, e);
}
// 06:5143 NameEntryDrawCursor: the hand (tile $60, palette 3) at x $14 + 8 x column, y $44 + 16 x row (the END row 2
// higher)
function nameEntryDrawCursor(w) {
  const d = (rd(w, 0xC3F6) * 8 + 0x14) & 0xFF;
  let e = (rd(w, 0xC3F7) * 16 + 0x44) & 0xFF;
  if (rd(w, 0xC3F7) === 5) e = (e - 2) & 0xFF;
  D.queueSprite16(w, e, d, 0x60, 0x03);          // 00:26A4
}
// 06:5171 NameEntryDrawBlanks: the underscores (tile $20, palette 3) on the empty cells from the name's end (the
// first of them blinks: wFrameCounter bit 4), 8 apart from x $6C at y $14
function nameEntryDrawBlanks(w) {
  let h = nameLength(w);
  if (!(rd(w, 0xC4B2) & 0x10)) h++;
  for (let d = 0x6C; h < 7; h++, d = (d + 0xF8) & 0xFF) D.queueSprite(w, 0x14, d, 0x20, 0x03);   // 00:2798
}
// 06:5197 NameEntryAnimTiles: frame (wFrameCounter >> 2) & $0F of 06:41A0 (the second eight 256 bytes on) -> $8F00
// and, $100 on, $8F20 (2 blocks each)
function nameEntryAnimTiles(w) {
  let a = ((rd(w, 0xC4B2) >> 2 | rd(w, 0xC4B2) << 6) & 0x0F);
  if (a >= 8) a += 8;
  const hl = (0x41A0 + (a << 5)) & 0xFFFF;
  D.inBank(w, B, () => {
    D.queueVRAMCopy(w, hl, 0x8F00, 0x02);
    D.queueVRAMCopy(w, (hl + 0x100) & 0xFFFF, 0x8F20, 0x02);
  });
}
// 06:51CC NameEntryTask
export function nameEntryTask(w) {
  setW(w, 1);
  if (!w.vram) return;
  nameEntryDrawCursor(w);
  nameEntryDrawBlanks(w);
  nameEntryAnimTiles(w);
}
export const nameEntryTasks = w => ({ "06:51cc": () => nameEntryTask(w) });

// 06:51DC NameEntryScreen: the name typed into wPlayerName $C800 (the portrait of wCharId $C810): returns 0, the
// five random bytes $C80B-$C80F drawn; $FF when B leaves with no letters. END with no letters takes the character's
// default name (05:40C2 CopyTextShortToDE, text $43 + character) and goes on.
export function* nameEntryScreen(sh) {
  const w = sh.w;
  setW(w, 1);
  w.high[0x18A] = 0; w.high[0x18B] = 0;          // hSCY, hSCX
  wr(w, 0xC4B3, 0); wr(w, 0xC3F6, 0); wr(w, 0xC3F7, 0);
  if (w.vram) w.lcd.vbk = 0;
  D.inBank(w, B, () => {
    D.queueVRAMCopy(w, 0x4040, 0x8600, 0x04);
    D.loadPalettesImmediate(w, 0x4080, 0x0A, 0x02);
    D.queueVRAMCopy(w, 0x4020, 0x8200, 0x02);
  });
  yield* sh.advance();
  D.inBank(w, B, () => {
    D.queueVRAMCopy(w, 0x4090, 0x8F00, 0x10);
    D.loadPalettesImmediate(w, 0x4190, 0x01, 0x01);
  });
  loadPortraitTiles(w, rd(w, 0xC810), 0x06, 0x8E00);
  yield* sh.advance();
  nameEntrySwitchPage(w);
  D.inBank(w, B, () => registerFrameTask(w, 0x0F, B, 0x51CC));
  yield* sh.advance();
  for (;;) {
    setW(w, 1);
    const p = () => w.high[0x194];             // hJoyPressed
    if (p() & 8) { sh.sound(0x5C); cursorToEnd(w); }
    if (p() & 2) {
      if (!nameLength(w)) { unregisterFrameTask(w, B, 0x51CC); return 0xFF; }
      sh.sound(0x5D);
      nameEntryBackspace(w);
    } else if (p() & 1) { sh.sound(0x5C); nameEntryPressA(w); }
    else nameEntryMoveCursor(sh);
    yield* sh.advance();
    advanceRandomSeed(w);                        // 00:0A61
    const pg = rd(w, 0xC4B3);
    if (!(pg & 0x80)) continue;
    wr(w, 0xC4B3, pg & 0x7F);
    if (nameLength(w)) break;
    D.inBank(w, 0x05, () => copyTextShort(w, (0x43 + rd(w, 0xC810)) & 0xFFFF, 0xC800));   // 05:40C2
    setW(w, 1);
    nameEntryDrawName(w);
    copyTilemap(w);
  }
  unregisterFrameTask(w, B, 0x51CC);
  for (let k = 0; k < 5; k++) wr(w, 0xC80B + k, advanceRandomSeed(w) >> 8);
  return 0;
}
