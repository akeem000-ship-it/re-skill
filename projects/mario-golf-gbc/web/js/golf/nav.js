// The overworld's navigation (bank 0A): the Navigation menu (NavigationMenu 0A:7174: A on the Field with nothing
// ahead, or the start menu's Navigation) lists the places unlocked so far; the one picked becomes wNavDestination
// $C2A7 ($FF: none; MapEngine sets $FF), which the Field's guide (NavGuideStart 0A:7878, NavGuideTask 0A:78CE) shows
// with its name in a window, an arrow toward it and a marker over it.
import * as D from "./render/display.js";
import * as Scr from "./screen.js";
import * as T from "./text.js";
import { registerFrameTask, clearFrameTasks } from "./tasks.js";
import { angleFromVector16 } from "./math.js";
import { getTextBoxWidth } from "./select.js";
import { rb } from "./rom.js";

const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
const wbank = w => w.high[0x196];
const r16 = (w, a) => rd(w, a) | rd(w, (a + 1) & 0xFFFF) << 8;
const rw0A = a => rb(0x0A, a) | rb(0x0A, a + 1) << 8;
const setFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] |= 0x80 >> (n & 7); };
// 00:2D10 TestGameFlag with de = n << 5 (the byte d, the bit e >> 5)
const testFlagWord = (w, de) => w.wram[0][0x840 + (de >> 8)] & (0x80 >> ((de >> 5) & 7));
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}

// 01:4289 LoadCursorSprite: the hand's 4 tiles 01:5120 queued to de, OBJ palette b from 01:50E0 (master only)
export function loadCursorSprite(w, de, b) {
  if (!w.vram) return;
  D.inBank(w, 0x01, () => {
    D.queueVRAMCopy(w, 0x5120, de, 0x04);
    D.loadPalettesMasterOnly(w, 0x50E0, (b + 8) & 0xFF, 0x01);
  });
}

// ---- the guide ----
// 0A:7878 NavGuideStart (export $5C; the Field's enter script 34:469B): $C2A9 = $FF, OBJ palette 1 from 0A:7870
// (unless faded: 00:05A8), the hand's tiles to $87C0 (palette 0), the place's name (0A:79BF), the frame task
// NavGuideTask 0A:78CE
export function* navGuideStart(sh) {
  const w = sh.w;
  wr(w, 0xC2A9, 0xFF);
  if (w.vram) D.inBank(w, 0x0A, () => D.loadPalettesUnlessFaded(w, 0x7870, 0x09, 0x01));
  loadCursorSprite(w, 0x87C0, 0x00);
  yield* navGuideDrawName(sh);
  D.inBank(w, 0x0A, () => registerFrameTask(w, 0x04, 0x0A, 0x78CE));
}
// 0A:79BF NavGuideDrawName (with a destination): the window at WY $78, WRAM1: its frame tiles 0A:70B4 ($60 bytes)
// at $DE00 with tiles $F0-$FF from $DE22, the attributes 0A:7114 | $80 at $DF00; the name ($1A06 + place) measured
// (05:615D: the centring it computes is not used), $DC00 cleared to $FF00 words, the name copied (05:40C2) and drawn
// as glyphs at $DC00 (03:50CD); the rows queued to $9C00 / VRAM1, a frame, the glyphs to $8F00
function* navGuideDrawName(sh) {
  const w = sh.w;
  const dest = rd(w, 0xC2A7);
  if (dest === 0xFF) return;
  if (w.vram) w.lcd.wy = 0x78;
  setW(w, 1);
  D.inBank(w, 0x0A, () => D.copyMemoryFast(w, 0x70B4, 0xDE00, 0x06));
  for (let k = 0; k < 0x10; k++) wr(w, 0xDE22 + k, 0xF0 + k);
  for (let k = 0; k < 0x60; k++) wr(w, 0xDF00 + k, rb(0x0A, 0x7114 + k) | 0x80);
  const id = (0x1A06 + dest) & 0xFFFF;
  getTextBoxWidth(w, id);
  for (let k = 0; k < 0x80; k++) { wr(w, 0xDC00 + 2 * k, 0xFF); wr(w, 0xDC01 + 2 * k, 0x00); }
  T.copyTextShortToDE(w, id, 0xC490);
  setW(w, 1);
  D.inBank(w, 0x03, () => T.drawStringToGlyphs(w, 0xC490, 0xDC00));
  if (w.vram) {
    D.queueVRAMCopy(w, 0xDE00, 0x9C00, 0x06);
    D.queueVRAMCopy(w, 0xDF00, 0xBC00, 0x06);
  }
  yield* sh.advance();
  if (w.vram) D.queueVRAMCopy(w, 0xDC00, 0x8F00, 0x10);
}
// the place's position (0A:789A NavDestPosTable: x, y words per place, in units of $20)
const destX = d => rw0A((0x789A + ((d << 2) & 0xFF)) & 0xFFFF);
const destY = d => rw0A((0x789C + ((d << 2) & 0xFF)) & 0xFFFF);
// 0A:78CE NavGuideTask: nothing without a destination; else the arrow (0A:7470: 4 tiles of the 16 directions by
// AngleFromVector16 00:1A03 from the player's saved position $C2A0 / $C2A2 >> 5 toward the place) to VRAM1 $8000
// and its sprite at (8, $10), then the marker (0A:7967)
export function navGuideTask(w) {
  const d = rd(w, 0xC2A7);
  if (d === 0xFF) return;
  const dy = ((r16(w, 0xC2A2) >> 5) - destY(d)) & 0xFFFF;
  const dx = ((r16(w, 0xC2A0) >> 5) - destX(d)) & 0xFFFF;
  const bc = angleFromVector16(dx, dy);
  const hl = ((0 - bc + 0x0800) & 0xFFFF) >> 8 & 0xF0;
  if (!w.vram) return;
  D.inBank(w, 0x0A, () => D.queueVRAMCopy(w, (0x7470 + (hl << 2)) & 0xFFFF, 0xA000, 0x04));
  D.queueSprite16(w, 0x10, 0x08, 0x00, 0x09);
  navGuideDrawMarker(w, d);
}
// 0A:7967 NavGuideDrawMarker: the marker (tile $7C, attributes $60) over the place, bobbing by 0A:79B7 (hVBlankCount
// / 2), at world (x - 8 - bob, y - bob) x $20 (PositionSpriteWorld 00:27B4)
function navGuideDrawMarker(w, d) {
  const b = rb(0x0A, 0x79B7 + ((w.high[0x18C] >> 1) & 7));
  const sub = v => (v - b) & 0xFFFF;                             // (an 8-bit sub with the borrow into h)
  const de = (sub(destY(d)) << 5) & 0xFFFF;
  const hl = (sub((destX(d) - 8) & 0xFFFF) << 5) & 0xFFFF;
  D.positionSpriteWorld(w, hl, de, 0x7C, 0x60);
}

// ---- the menu ----
// 0A:6CAF ListEntryFlag (page wListPage $C470): the flag word of entry b in the page's table at hl (page 3's entries
// 5 and up also need flag #139)
function listEntryFlag(w, hl, b) {
  const page = rd(w, 0xC470);
  const t = rw0A((hl + ((page << 1) & 0xFF)) & 0xFFFF);
  const f = testFlagWord(w, rw0A((t + ((b << 1) & 0xFF)) & 0xFFFF));
  if (page === 3 && b >= 5 && f) return w.wram[0][0x840 + (139 >> 3)] & (0x80 >> (139 & 7));
  return f;
}
// 0A:6C58 DrawListMark: the blinking mark (tiles 0, 4, 8, $C by hVBlankCount / 8; attributes $0A) by list row b
function drawListMark(w, b) {
  const e = ((((((b << 1) + 5) << 3) & 0xFF) - w.high[0x18A] + 3) & 0xFF);
  D.queueSprite16(w, e, 0x90, ((w.high[0x18C] >> 3) & 3) << 2, 0x0A);
}
// 0A:73D3 NavBuildEntries: wNavEntries $C480 = the places 0-13 whose flag (0A:6FA9) is set, then $FF
function navBuildEntries(w) {
  let de = 0xC480;
  for (let b = 0; b < 0x0E; b++) if (listEntryFlag(w, 0x6FA9, b)) wr(w, de++, b);
  wr(w, de, 0xFF);
}
// 0A:73ED NavCountEntries
function navCountEntries(w) { let b = 0; while (rd(w, 0xC480 + b) !== 0xFF) b++; return b; }
// 0A:72BF NavDrawList: the frame's tiles and attributes (LZ 0A:6FE5 / 0A:7085 to WRAM1 $D000 / $D400), the glyphs
// reset (03:4EB8), the text (0A:7387)
function* navDrawList(sh) {
  const w = sh.w;
  setW(w, 1);
  D.lzTo(w, 0x0A, 0x6FE5, 0xD000);
  D.lzTo(w, 0x0A, 0x7085, 0xD400);
  setW(w, 1);
  D.inBank(w, 0x03, () => T.resetGlyphBuffer(w));
  yield* navDrawText(sh);
}
// 0A:7387 NavDrawText: "Navigation" ($1A05) centred in row 1 (05:615D, 05:62AA), then 7 places' names ($1A06 +
// place) from the scroll, two rows apart from $D081
function* navDrawText(sh) {
  const w = sh.w;
  const a = (((-getTextBoxWidth(w, 0x1A05)) & 0xFF) + 0x14 & 0xFF) >> 1;
  yield* inBankGen(w, 0x05, T.printTextToBuffer(sh, 0x1A05, (0xD020 + a) & 0xFFFF, 0x20));
  let de = 0xD081, hl = (0xC480 + rd(w, 0xC474)) & 0xFFFF;
  for (let c = 7; c; c--) {
    const p = rd(w, hl++);
    if (p === 0xFF) return;
    yield* inBankGen(w, 0x05, T.printTextToBuffer(sh, (0x1A06 + p) & 0xFFFF, de, 0x20));
    de = (de + 0x40) & 0xFFFF;
  }
}
const navQueue = (w, hl, de, c) => { if (!w.vram) return; setW(w, 1); D.queueVRAMCopy(w, hl, de, c); };
// 0A:73FC NavHandleInput: Up / Down (repeat) move the cursor (clamped to the list) and its row (0-6), sound $5B;
// a new scroll redraws the list (0A:72BF), queues its rows (0A:729B: $D080 -> $9880; 0A:72AD: $D480 -> VRAM1),
// a frame each, and the glyphs (03:4FB7)
function* navHandleInput(sh) {
  const w = sh.w;
  const k = w.high[0x191];
  let d;
  if (k & 0x40) d = -1;
  else if (k & 0x80) d = 1;
  else return;
  wr(w, 0xC473, (rd(w, 0xC473) + d) & 0xFF);
  wr(w, 0xC476, (rd(w, 0xC476) + d) & 0xFF);
  sh.sound(0x5B);
  const n = rd(w, 0xC475);
  let a = rd(w, 0xC473);
  a = a & 0x80 ? 0 : a >= n ? (n - 1) & 0xFF : a;
  wr(w, 0xC473, a);
  let r = rd(w, 0xC476);
  r = r & 0x80 ? 0 : r >= 7 ? 6 : r;
  wr(w, 0xC476, r);
  const s = (a - r) & 0xFF;
  if (s === rd(w, 0xC474)) return;
  wr(w, 0xC474, s);
  yield* navDrawList(sh);
  navQueue(w, 0xD080, 0x9880, 0x1A);
  yield* sh.advance(1);
  navQueue(w, 0xD480, 0xB880, 0x1A);
  yield* sh.advance(1);
  yield* inBankGen(w, 0x03, T.uploadGlyphTilesFramed(sh));
}
// 0C:43AD InitRecordsTileAnim (WRAM6 $D23E / $D240 = $8FC0 / $8FE0, WRAM1 mapped) and 0C:436A AnimateRecordsTiles:
// frame (wFrameCounter / 8) & 15 of 0C:43E0 (2 tiles) to [$D23E] and of 0C:45E0 to [$D240]; WRAM6 left mapped
function initRecordsTileAnim(w) {
  setW(w, 6);
  wr(w, 0xD23E, 0xC0); wr(w, 0xD23F, 0x8F); wr(w, 0xD240, 0xE0); wr(w, 0xD241, 0x8F);
  setW(w, 1);
  const hl = 0x43E0 + (((rd(w, 0xC4B2) >> 3) & 0x0F) << 5);
  setW(w, 6);
  if (!w.vram) return;
  D.inBank(w, 0x0C, () => {
    D.queueVRAMCopy(w, hl, r16(w, 0xD23E), 0x02);
    D.queueVRAMCopy(w, hl + 0x200, r16(w, 0xD240), 0x02);
  });
}
const BOB = [0x00, 0x02, 0x04, 0x04, 0x03, 0x03, 0x02, 0x01];   // 0A:733C (the cursor's bob)
// 0A:72D2 NavFrame: the input, the animated tiles (0C:43AD), the marks of the places visited (flags 0A:6FC7), the
// scroll arrows (0A:7344), the bobbing hand (tile $7C, attributes $20) at the cursor's row
function* navFrame(sh) {
  const w = sh.w;
  yield* navHandleInput(sh);
  D.inBank(w, 0x0C, () => initRecordsTileAnim(w));
  let hl = (0xC480 + rd(w, 0xC474)) & 0xFFFF;
  for (let b = 0; b < 7; b++) {
    const p = rd(w, hl++);
    if (p === 0xFF) break;
    if (listEntryFlag(w, 0x6FC7, p) && w.vram) drawListMark(w, b);
  }
  if (!w.vram) return;
  navDrawScrollArrows(w);
  const bob = BOB[(w.high[0x18C] >> 1) & 7];
  const e = ((((((rd(w, 0xC476) << 1) + 6) << 3) + 8) & 0xFF) - bob) & 0xFF;
  D.queueSprite16(w, e, (bob + 3) & 0xFF, 0x7C, 0x20);
}
// 0A:7344 NavDrawScrollArrows: bobbing by 0A:6CA7 (hVBlankCount / 4): up (tile $10, attributes 9) while scrolled,
// down ($49: flipped) while more than 7 places remain below
function navDrawScrollArrows(w) {
  const e = rb(0x0A, 0x6CA7 + ((w.high[0x18C] >> 2) & 7));
  if (rd(w, 0xC474)) D.queueSprite16(w, (e + 0x24) & 0xFF, 0x4C, 0x10, 0x09);
  if (((rd(w, 0xC474) + 7) & 0xFF) < rd(w, 0xC475)) D.queueSprite16(w, ((~e & 0xFF) + 0x94) & 0xFF, 0x4C, 0x10, 0x49);
}
// 0A:7174 NavigationMenu: flag #15, WY $90, the frame tasks cleared, a frame, LCD off, no scroll; the frame's tiles
// (0A:6A80 / 0A:6BD0 to VRAM1), palettes (0A:6B80 BG 10, 0A:6C10 OBJ 1, 0A:6C20 BG 1), the hand; the list from the
// top (0A:73D3), drawn and queued (0A:7277 / 0A:7289), the glyphs (03:5039), LCD on, fade in ($10); then each frame
// until B (sound $5D) or A (sound $5C: the place under the cursor, Quit ($0D) -> $FF, to wNavDestination): fade out
// ($10), warp $FA at the saved position ($C2A0 -> $C466, facing $C2A4 -> $C465)
export function* navigationMenu(sh) {
  const w = sh.w;
  const oldBank = wbank(w);
  setFlag(w, 15);
  if (w.vram) w.lcd.wy = 0x90;
  clearFrameTasks(w);
  yield* sh.advance();
  if (w.vram) D.disableLCDSafely(w);
  w.high[0x1B9] = 0; w.high[0x1B8] = 0;
  w.high[0x18B] = 0; w.high[0x18A] = 0;
  if (w.vram) D.inBank(w, 0x0A, () => {
    D.queueVRAMCopy(w, 0x6A80, 0xA000, 0x10);
    D.queueVRAMCopy(w, 0x6BD0, 0xA100, 0x04);
    D.loadPalettesUnlessFaded(w, 0x6B80, 0x0A, 0x01);
    D.loadPalettesUnlessFaded(w, 0x6C10, 0x09, 0x01);
    D.loadPalettesUnlessFaded(w, 0x6C20, 0x01, 0x01);
  });
  loadCursorSprite(w, 0x87C0, 0x00);
  for (const a of [0xC470, 0xC473, 0xC474, 0xC476]) wr(w, a, 0);
  navBuildEntries(w);
  wr(w, 0xC475, navCountEntries(w));
  yield* navDrawList(sh);
  navQueue(w, 0xD000, 0x9800, 0x24);
  navQueue(w, 0xD400, 0xB800, 0x24);
  if (w.vram) {
    D.inBank(w, 0x03, () => T.uploadGlyphTilesDirect(w));
    D.processVRAMCopyQueue(w);
    D.enableLCD(w);
  }
  Scr.beginFadeIn(w, 0x10);
  for (;;) {
    const p = w.high[0x194];
    if (p & 0x02) { sh.sound(0x5D); break; }
    if (p & 0x01) {
      sh.sound(0x5C);
      const a = rd(w, (0xC480 + rd(w, 0xC473)) & 0xFFFF);
      wr(w, 0xC2A7, a === 0x0D ? 0xFF : a);
      break;
    }
    yield* navFrame(sh);
    yield* sh.advance();
  }
  Scr.beginFadeOut(w, 0x10);
  yield* Scr.waitFade(sh);
  wr(w, 0xC441, 0xFA);
  wr(w, 0xC46A, 0xFA);
  for (let k = 0; k < 4; k++) wr(w, 0xC466 + k, rd(w, 0xC2A0 + k));
  wr(w, 0xC465, rd(w, 0xC2A4));
  setW(w, oldBank);
}

// ---- the event list (the start menu's Stars: 0A:6F56) ----
// 0A:6C7A DrawPageArrows: the two arrows by 0A:6CA7 (hVBlankCount / 4), y $14 less the scroll: left at x bob + 6
// (tile $10, attributes 9), right at x $9A - bob - 1 (attributes $29)
function drawPageArrows(w) {
  const e = (0x14 - w.high[0x18A]) & 0xFF;
  const d = rb(0x0A, 0x6CA7 + ((w.high[0x18C] >> 2) & 7));
  D.queueSprite16(w, e, (d + 6) & 0xFF, 0x10, 0x09);
  D.queueSprite16(w, e, ((~d & 0xFF) + 0x9A) & 0xFF, 0x10, 0x29);
}
// 0A:6CFE ListCountUnlocked: the entries of the page whose flag (0A:680A) is set
function listCountUnlocked(w) {
  let d = 0;
  for (let b = 0, c = rd(w, 0xC471); c; b++, c--) if (listEntryFlag(w, 0x680A, b)) d++;
  return d;
}
// 0A:6D15 ListPageSetup: wListCount $C471 = the page's entries (0A:6852's list of words up to $FF..); the scroll's
// most $C472 = (2 count + 4 - $12, at least 0) * 8
function listPageSetup(w) {
  let hl = rw0A((0x6852 + ((rd(w, 0xC470) << 1) & 0xFF)) & 0xFFFF);
  let b = 0xFF;
  do { b = (b + 1) & 0xFF; hl += 2; } while (rb(0x0A, hl - 1) !== 0xFF);
  wr(w, 0xC471, b);
  let a = (((b << 1) + 4) & 0xFF) - 0x12;
  if (a < 0) a = 0;
  wr(w, 0xC472, (a << 3) & 0xFF);
}
// 0A:6D42 ListDrawFrame: for each entry two rows of the frame (0A:69BA tiles to $D080..., 0A:6A1A attributes to
// $D480...), then the closing row (0A:69FA / 0A:6A5A) one row up from the end; WRAM1
function listDrawFrame(w) {
  let de = 0xD080;
  for (let b = rd(w, 0xC471); ;) {
    D.inBank(w, 0x0A, () => {
      D.copyMemoryFast(w, 0x6A1A, de + 0x400, 0x04);
      D.copyMemoryFast(w, 0x69BA, de, 0x04);
    });
    de = (de + 0x40) & 0xFFFF;
    b = (b - 1) & 0xFF;
    if (!b) break;
  }
  de = (de - 0x20) & 0xFFFF;
  D.inBank(w, 0x0A, () => {
    D.copyMemoryFast(w, 0x6A5A, de + 0x400, 0x02);
    D.copyMemoryFast(w, 0x69FA, de, 0x02);
  });
}
// 0A:6D7F ListDrawText: the glyphs reset; the page's title ($19E1 + page) centred in row 1; the names of the unlocked
// entries (texts 0A:6DE4 by page + the entry) two rows apart from $D081
function* listDrawText(sh) {
  const w = sh.w;
  D.inBank(w, 0x03, () => T.resetGlyphBuffer(w));
  const title = (0x19E1 + rd(w, 0xC470)) & 0xFFFF;
  const a = ((((-getTextBoxWidth(w, title)) & 0xFF) + 0x14) & 0xFF) >> 1;
  yield* inBankGen(w, 0x05, T.printTextToBuffer(sh, title, (0xD020 + a) & 0xFFFF, 0x20));
  let de = 0xD081;
  for (let b = 0, c = rd(w, 0xC471); c; b++, c--) {
    if (listEntryFlag(w, 0x680A, b)) {
      const id = (rw0A((0x6DE4 + ((rd(w, 0xC470) << 1) & 0xFF)) & 0xFFFF) + b) & 0xFFFF;
      yield* inBankGen(w, 0x05, T.printTextToBuffer(sh, id, de, 0x20));
    }
    de = (de + 0x40) & 0xFFFF;
  }
}
// the page's frame and text: the LZ frame 0A:68E4 / 0A:698A to WRAM1 $D000 / $D400, 0A:6D42, 0A:6D7F
function* listBuildPage(sh) {
  const w = sh.w;
  setW(w, 1);
  D.lzTo(w, 0x0A, 0x68E4, 0xD000);
  D.lzTo(w, 0x0A, 0x698A, 0xD400);
  listDrawFrame(w);
  yield* listDrawText(sh);
}
// the page to the BG map: VRAM1 from $D400, VRAM0 from $D000 ($2C blocks each, StartVRAMDMAFromHL 00:2096)
function listCopyPage(w) {
  if (!w.vram) return;
  w.lcd.vbk = 1; D.startVRAMDMAFromHL(w, 0xD400, 0x9800, 0x2C);
  w.lcd.vbk = 0; D.startVRAMDMAFromHL(w, 0xD000, 0x9800, 0x2C);
}
// 0A:6E47 ListChangePage: fade out ($10), the page set up and built, LCD off, no scroll, copied, the glyphs
// (03:5039), LCD on, fade in ($10)
function* listChangePage(sh) {
  const w = sh.w;
  Scr.beginFadeOut(w, 0x10);
  listPageSetup(w);
  yield* listBuildPage(sh);
  yield* Scr.waitFade(sh);
  if (w.vram) D.disableLCDSafely(w);
  w.high[0x18B] = 0; w.high[0x18A] = 0;
  listCopyPage(w);
  if (w.vram) { D.inBank(w, 0x03, () => T.uploadGlyphTilesDirect(w)); D.enableLCD(w); }
  Scr.beginFadeIn(w, 0x10);
}
// 0A:6DEE ListHandleInput: Up / Down held scroll by 2 (0 to $C472); Left / Right (repeat) change the page (Right
// first, 0-4 wrapping), passing the pages with nothing unlocked; then sound $5B and the new page (0A:6E47)
function* listHandleInput(sh) {
  const w = sh.w;
  if (w.high[0x190] & 0x40) { const a = (w.high[0x18A] - 2) & 0xFF; if (!(a & 0x80)) w.high[0x18A] = a; }
  if (w.high[0x190] & 0x80) { const a = (w.high[0x18A] + 2) & 0xFF; if (a < rd(w, 0xC472)) w.high[0x18A] = a; }
  const b = w.high[0x191] & 0x30;
  if (!b) return;
  for (;;) {
    let p = rd(w, 0xC470);
    p = (b & 0x10) || !(b & 0x20) ? (p + 1) & 0xFF : (p - 1) & 0xFF;
    if (p & 0x80) p = 0x04;
    else if (p >= 0x05) p = 0;
    wr(w, 0xC470, p);
    if (listCountUnlocked(w)) break;
  }
  sh.sound(0x5B);
  yield* listChangePage(sh);
}
// 0A:6EA2 ListScreenInit: flag #15, WY $90, no scroll, page 0 set up, LCD off, built and copied, the sprite tiles
// (0A:6A80 / 0A:6B90 to VRAM1 $8000 / $8100) and palettes (0A:6C20 BG 1, 0A:6C10 OBJ 1, 0A:6B80 BG 10), the glyphs,
// LCD on
function* listScreenInit(sh) {
  const w = sh.w;
  setFlag(w, 15);
  if (w.vram) w.lcd.wy = 0x90;
  w.high[0x1B9] = 0; w.high[0x1B8] = 0;
  w.high[0x18B] = 0; w.high[0x18A] = 0;
  wr(w, 0xC470, 0);
  listPageSetup(w);
  if (w.vram) D.disableLCDSafely(w);
  yield* listBuildPage(sh);
  if (w.vram) {
    listCopyPage(w);
    w.lcd.vbk = 1;
    D.inBank(w, 0x0A, () => {
      D.startVRAMDMAFromHL(w, 0x6A80, 0x8000, 0x10);
      D.startVRAMDMAFromHL(w, 0x6B90, 0x8100, 0x04);
    });
  }
  D.inBank(w, 0x0A, () => {
    D.loadPalettesUnlessFaded(w, 0x6C20, 0x01, 0x01);
    D.loadPalettesUnlessFaded(w, 0x6C10, 0x09, 0x01);
    D.loadPalettesUnlessFaded(w, 0x6B80, 0x0A, 0x01);
  });
  if (w.vram) { D.inBank(w, 0x03, () => T.uploadGlyphTilesDirect(w)); D.enableLCD(w); }
}
// 0A:6F35 ListFrame: the input, the animated tiles (0C:43AD), the page arrows, the marks of the cleared entries
// (0A:6852's flags)
function* listFrame(sh) {
  const w = sh.w;
  yield* listHandleInput(sh);
  D.inBank(w, 0x0C, () => initRecordsTileAnim(w));
  if (!w.vram) return;
  drawPageArrows(w);
  for (let b = 0, c = rd(w, 0xC471); c; b++, c--) if (listEntryFlag(w, 0x6852, b)) drawListMark(w, b);
}
// 0A:6F56 EventListScreen (export $58; the start menu's Stars 41:7965): the frame tasks cleared, a frame, the list
// (0A:6EA2), fade in ($10); each frame until B (sound $5D); fade out ($10), warp $FA at the saved position
export function* eventListScreen(sh) {
  const w = sh.w;
  const oldBank = wbank(w);
  clearFrameTasks(w);
  yield* sh.advance();
  yield* listScreenInit(sh);
  Scr.beginFadeIn(w, 0x10);
  for (;;) {
    if (w.high[0x194] & 0x02) break;
    yield* listFrame(sh);
    yield* sh.advance();
  }
  sh.sound(0x5D);
  Scr.beginFadeOut(w, 0x10);
  yield* Scr.waitFade(sh);
  wr(w, 0xC441, 0xFA);
  wr(w, 0xC46A, 0xFA);
  for (let k = 0; k < 4; k++) wr(w, 0xC466 + k, rd(w, 0xC2A0 + k));
  wr(w, 0xC465, rd(w, 0xC2A4));
  setW(w, oldBank);
}
