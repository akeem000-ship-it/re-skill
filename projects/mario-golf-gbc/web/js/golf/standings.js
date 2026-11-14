// The match standings screen between holes (MatchStandingsScreen 3E:403F, page 0 of the match-play scorecard
// 0E:4432): the two golfers' portraits, names and kinds, one mark per hole won, the holes up ("n Up") or the
// dormie label, the hole number in big digits, a banner for the decisive hole or a playoff, and the last hole's
// winner's mark blinking (MatchStandingsTask 3E:465A); A / B leave (a = 0), Right turns to the hole-by-hole card
// (a = 1). The tallies it makes ($D552-$D55C, $D525-$D52A in WRAM6) are kept headless too.
// The screen is built in WRAM1 (attributes $D000, tiles $D400, 32 wide; StandingsMapAddr 3E:61B7) and copied to the
// BG map; the names and numbers are printed with the text printer (text.js, 05:62AA).
import { rb } from "./rom.js";
import { mulHLByA } from "./math.js";
import { clearFrameTasks, registerFrameTask } from "./tasks.js";
import * as Scr from "./screen.js";
import * as D from "./render/display.js";
import * as T from "./text.js";

const B = 0x3E;
const rd = D.rd, wr = D.wr;
const wbank = w => w.high[0x196];
const setW = (w, n) => D.setWramBank(w, n);
function* inBankGen(w, bank, g) {                // a far call to a routine that waits frames
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}
const inc = (w, a, n = 1) => wr(w, a, rd(w, a) + n);

// 05:407A InitWindowSystem: WRAM5 cleared over 4 frames, the 6 window slots freed, no message window
export function* initWindowSystem(sh) {
  const w = sh.w, old = wbank(w);
  setW(w, 5);
  for (let k = 0; k < 4; k++) { w.wram[5].fill(0, 0x400 * k, 0x400 * k + 0x400); yield* sh.advance(); }
  for (let k = 0; k < 6; k++) w.wram[5][0x802 + 4 * k] = 3;   // wWindowSlots
  w.wram[5][0x83E] = 0xFF;                       // wMenuStackDepth
  w.wram[5][0x824] = 0xFF;                       // wMessageWindow
  w.wram[5][0x84D] = 0x80;                       // wWindowAttr
  w.wram[0].fill(0, 0x3F9, 0x3FD);               // 41:707C ClearMenuState
  setW(w, old);
}

// 01:421A ReloadFontTiles: LCD off, 01:41CE LoadFontTiles (01:42A0 -> $9000, 01:4AA0 -> $8800), LCD on
export function reloadFontTiles(w) {
  if (!w.vram) return;
  D.inBank(w, 0x01, () => {
    D.disableLCDSafely(w);
    w.lcd.vbk = 0;
    D.startVRAMDMAFromHL(w, 0x42A0, 0x9000, 0x80);
    D.startVRAMDMAFromHL(w, 0x4AA0, 0x8800, 0x60);
    D.enableLCD(w);
  });
}

// 00:0804 CopyMapToScrollBuffers: the 32-wide WRAM1 maps (attributes $D000, tiles $D400) into the 64 x 64 scroll
// buffers (WRAM2 attributes, WRAM3 tiles) through $C600, 16 rows at a time (00:0775 CopyMapRows32To64: 32 bytes
// copied, then 32 zeroed); the second half goes to $D800 and is cleared
export function copyMapToScrollBuffers(w) {
  const old = wbank(w);
  const half = (src, bank, dst) => {
    setW(w, 1);
    D.copyMemoryFast(w, src, 0xC600, 0x20);
    setW(w, bank);
    let hl = 0xC600, de = dst;
    for (let r = 0; r < 0x10; r++) {
      for (let k = 0; k < 32; k++) wr(w, de++, rd(w, hl++));
      for (let k = 0; k < 32; k++) wr(w, de++, 0);
    }
  };
  half(0xD000, 2, 0xD000);
  half(0xD200, 2, 0xD800);
  D.clearMemory16(w, 0xD800, 0x80);
  half(0xD400, 3, 0xD000);
  half(0xD600, 3, 0xD800);
  D.clearMemory16(w, 0xD800, 0x80);
  setW(w, old);
}

// ---- the WRAM1 map: bc = column, row (3E:61B7 StandingsMapAddr; tiles at +$400) ----
const mapAddr = (b, c) => (0xD000 + mulHLByA(0x20, c) + b) & 0xFFFF;
function put(w, b, c, tile, attr) {              // the cell writers, WRAM1 mapped while they write
  const old = wbank(w);
  setW(w, 1);
  const p = mapAddr(b & 0xFF, c & 0xFF);
  if (tile !== null) wr(w, p + 0x400, tile);
  if (attr !== null) wr(w, p, attr);
  setW(w, old);
}
const putTileOnly = (w, a, b, c) => put(w, b, c, a, null);    // 3E:6209 PutTileOnly
const putTileBank1 = (w, a, b, c) => put(w, b, c, a, 8);      // 3E:622A PutTileBank1
const putAttr = (w, a, b, c) => put(w, b, c, null, a);        // 3E:6250 PutAttr
// 3E:6293 DrawTileStringAt: hl = (x, y, tiles..., 0) in this bank, y + d; 3E:61A2 PutTileStringBank1
function drawTileStringAt(w, hl, d) {
  let b = rb(B, hl);
  const c = (rb(B, hl + 1) + d) & 0xFF;
  for (let p = hl + 2; rb(B, p); p++, b = (b + 1) & 0xFF) putTileBank1(w, rb(B, p), b, c);
}

// 3E:403F MatchStandingsScreen: returns 0 (A / B) or 1 (Right: the other page)
export function* matchStandingsScreen(sh) {
  const w = sh.w;
  Scr.beginFadeOut(w, 0x10);                     // 00:25A1
  yield* Scr.waitFade(sh);                       // 00:2625
  setW(w, 5);
  yield* initWindowSystem(sh);                   // 05:407A
  setW(w, 6);
  reloadFontTiles(w);                            // 01:421A
  D.inBank(w, 0x03, () => T.resetGlyphBuffer(w));   // 03:4EB8
  if (w.vram) D.disableLCDSafely(w);             // 00:0341
  clearFrameTasks(w);                            // 00:23B6
  if (w.vram) { D.resetSprites(w); w.lcd.wy = 0x90; }   // 00:2683
  w.high[0x18A] = w.high[0x18B] = 0;             // hSCY / hSCX
  const old = wbank(w);
  D.inBank(w, B, () => loadStandingsGfx(w));
  setW(w, 6);
  wr(w, 0xD592, 0);
  if (rd(w, 0xC83A)) matchTallyPlayoff(w); else matchTallyHoles(w);
  drawHoleNumber(w);
  fillUnusedMarkCells(w);
  yield* drawMatchStatus(sh, 0, 0x00);           // (c: what LoadStandingsGfx's last CopyMemoryFast left)
  drawHolesWonMarks(w, 0);
  yield* drawPlayerName(sh, 0, 0x05, 0x06);
  drawPlayerKindMatch(w, 0);
  yield* drawMatchStatus(sh, 1, 0x06);
  drawHolesWonMarks(w, 1);
  yield* drawPlayerName(sh, 1, 0x05, 0x0B);
  drawPlayerKindMatch(w, 1);
  setW(w, 1);
  if (w.vram) D.inBank(w, B, () => {
    D.queueVRAMCopy(w, 0xD000, 0xB800, 0x24);
    D.queueAndRunVRAMCopy(w, 0xD400, 0x9800, 0x24);
  });
  copyMapToScrollBuffers(w);                     // 00:0804
  if (w.vram) yield* inBankGen(w, 0x03, T.uploadGlyphTiles(sh));   // 03:4F6C (LCD off: at once)
  D.inBank(w, B, () => { loadMatchBanner(w); loadPlayerPortrait(w, 0); loadPlayerPortrait(w, 1); });
  D.inBank(w, B, () => registerFrameTask(w, 0x0F, B, 0x465A));   // MatchStandingsTask
  if (w.vram) D.enableLCD(w);                    // 00:0371
  Scr.beginFadeIn(w, 0x10);                      // 00:25AF
  yield* Scr.waitFade(sh);
  const a = yield* waitKeyNoTimeout(sh);
  setW(w, old);
  return a;
}

// 3E:4102 LoadStandingsGfx: tiles 3E:4E90 to VRAM1 $9000 / $8800, 3E:5D50 to VRAM1 $8000, the palettes 3E:5882
// (BG 0-7) and 3E:6048 (OBJ 0), the attribute and tile maps 3E:58D0 / 3E:5B10 to WRAM1 $D000 / $D400
function loadStandingsGfx(w) {
  setW(w, 1);
  D.lzTo(w, B, 0x4E90, 0xD000);
  if (w.vram) {
    D.queueVRAMCopy(w, 0xD000, 0xB000, 0x80);
    D.queueAndRunVRAMCopy(w, 0xD800, 0xA800, 0x80);
  }
  D.lzTo(w, B, 0x5D50, 0xD000);
  if (w.vram) {
    D.queueAndRunVRAMCopy(w, 0xD000, 0xA000, 0x0A);
    D.loadPalettesMasterOnly(w, 0x5882, 0x00, 0x08);
    D.loadPalettesMasterOnly(w, 0x6048, 0x08, 0x01);
  }
  D.copyMemoryFast(w, 0x58D0, 0xD000, 0x24);
  D.copyMemoryFast(w, 0x5B10, 0xD400, 0x24);
}

// 3E:4164 MatchTallyHoles: over the holes played (wMatchHoles $C96E: 1 / 2 the player who won it, else halved):
// $D555 / $D556 holes won, $D557 halved, $D553 holes to go x 2 (from 20), $D559 / $D55A two points a win and one a
// half, $D55B / $D55C the same without the last hole (phase 1); then MatchStatusFlags
function matchTallyHoles(w) {
  wr(w, 0xD553, 0x14);
  for (const a of [0xD557, 0xD555, 0xD556, 0xD559, 0xD55A, 0xD55B, 0xD55C, 0xD526, 0xD527, 0xD528, 0xD529, 0xD558]) wr(w, a, 0);
  for (;;) {
    let b = rd(w, 0xC837);
    if (!rd(w, 0xC4BD)) { b = (b - 1) & 0xFF; if (!b) break; }
    const n = rd(w, 0xD558);
    if (n === b) break;
    const r = rd(w, 0xC96E + n);
    const counts = () => !rd(w, 0xC4BD) || n !== ((rd(w, 0xC837) - 1) & 0xFF);
    if (r === 1) { inc(w, 0xD555); inc(w, 0xD559, 2); if (counts()) inc(w, 0xD55B, 2); }
    else if (r === 2) { inc(w, 0xD556); inc(w, 0xD55A, 2); if (counts()) inc(w, 0xD55C, 2); }
    else {
      inc(w, 0xD553, -1); inc(w, 0xD557); inc(w, 0xD559); inc(w, 0xD55A);
      if (counts()) { inc(w, 0xD55B); inc(w, 0xD55C); }
    }
    inc(w, 0xD558);
  }
  matchStatusFlags(w);
}

// 3E:4377 MatchTallyPlayoff: the playoff hole alone (wRoundResult $C96C once phase 1)
function matchTallyPlayoff(w) {
  wr(w, 0xD553, 2);
  for (const a of [0xD557, 0xD555, 0xD556, 0xD559, 0xD55A, 0xD526, 0xD527, 0xD528, 0xD529, 0xD55B, 0xD55C, 0xD558]) wr(w, a, 0);
  if (rd(w, 0xC4BD)) {
    const r = rd(w, 0xC96C);
    if (r === 1) { inc(w, 0xD555); inc(w, 0xD559, 2); }
    else if (r === 2) { inc(w, 0xD556); inc(w, 0xD55A, 2); }
    else { inc(w, 0xD557); inc(w, 0xD559); inc(w, 0xD55A); }
  }
  matchStatusFlags(w);
}

// 3E:425B MatchStatusFlags: $D553 halved (holes to go; $D552 set when it was odd... as the code compares), $D525 a
// side past $11 points ($01 in a playoff), $D52A a side at exactly that + 1 without the last hole, $D526 / $D527
// dormie (one side up by the holes to go), $D528 / $D529 each side's holes to go minus holes won
function matchStatusFlags(w) {
  const sra = v => ((v >> 1) | (v & 0x80)) & 0xFF;
  const a0 = rd(w, 0xD553);
  wr(w, 0xD554, a0);
  const b = sra(a0);
  wr(w, 0xD553, b);
  if (sra((a0 - 1) & 0xFF) !== b) wr(w, 0xD552, 1);
  if (b & 0x80) wr(w, 0xD553, 1);
  const lim = () => (rd(w, 0xC83A) ? 1 : 0x11);
  const past = a => { const v = (rd(w, a) - lim()) & 0xFF; return !(v & 0x80) && v; };
  wr(w, 0xD525, past(0xD559) || past(0xD55A) ? 1 : 0);
  wr(w, 0xD52A, ((rd(w, 0xD55B) - lim()) & 0xFF) === 1 || ((rd(w, 0xD55C) - lim()) & 0xFF) === 1 ? 1 : 0);
  if (rd(w, 0xD525)) {
    const t = rd(w, 0xD553), p = rd(w, 0xD555), q = rd(w, 0xD556);
    if (((t - p) & 0xFF) === 1 && !(((t - q - 2) & 0xFF) & 0x80)) wr(w, 0xD526, 1);
    if (((t - q) & 0xFF) === 1 && !(((t - p - 2) & 0xFF) & 0x80)) wr(w, 0xD527, 1);
  }
  wr(w, 0xD528, rd(w, 0xD553) - rd(w, 0xD555));
  wr(w, 0xD529, rd(w, 0xD553) - rd(w, 0xD556));
}

// 3E:43F7 DrawHoleNumber: wHoleNumber in two-tile-high digits (tiles $C0 + n top / $D0 + n bottom, $AF / $BF zero)
function drawHoleNumber(w) {
  const h = rd(w, 0xC837);
  let d = h;
  if (!(((h - 10) & 0xFF) & 0x80)) {
    putTileOnly(w, 0xC0, 7, 4); putTileOnly(w, 0xD0, 7, 5);
    d = (h - 10) & 0xFF;
  }
  if (d) { const a = (d - 1) & 0xFF; putTileOnly(w, (a + 0xC0) & 0xFF, 8, 4); putTileOnly(w, (a + 0xD0) & 0xFF, 8, 5); }
  else { putTileOnly(w, 0xAF, 8, 4); putTileOnly(w, 0xBF, 8, 5); }
}

// 3E:4450 DrawMatchStatus: a = player: nothing while either side is level with the holes to go; the dormie label
// (3E:4006) or the holes to go in figures (text $14BE, code $09) then " Up"-like tiles (3E:4010). c = the caller's
// c, PrintTextToBuffer's stride
function* drawMatchStatus(sh, a, c) {
  const w = sh.w, old = wbank(w);
  const [flag, n, d, de, clr] = a === 1 ? [0xD527, 0xD529, 5, 0xD587, 0xD187] : [0xD526, 0xD528, 0, 0xD4E7, 0xD0E7];
  if (rd(w, 0xD528) && rd(w, 0xD529)) {
    if (rd(w, flag) === 1) drawTileStringAt(w, 0x4006, d);
    else {
      T.pushTextNumberArg(w, rd(w, n));          // 05:551F
      setW(w, 1);
      yield* T.printTextToBuffer(sh, 0x14BE, de, c);   // 05:62AA
      wr(w, clr, 0); wr(w, clr + 1, 0);
      drawTileStringAt(w, 0x4010, d);
    }
  }
  setW(w, old);
}

// 3E:4505 DrawHolesWonMarks: a = player: a mark (tiles [3E:4038] over [3E:403A]) per hole won, from column
// [3E:403C], row [3E:403D] (+ [3E:403E] for player 2); leaves WRAM6 mapped
function drawHolesWonMarks(w, a) {
  setW(w, 6);
  let b = rb(B, 0x403C), c = rb(B, 0x403D);
  if (a === 1) c = (c + rb(B, 0x403E)) & 0xFF;
  for (let n = rd(w, a === 1 ? 0xD556 : 0xD555); n; n = (n - 1) & 0xFF, b = (b + 1) & 0xFF) {
    putTileOnly(w, rb(B, 0x4038), b, c);
    putTileOnly(w, rb(B, 0x403A), b, c + 1);
  }
}

// 3E:456A DrawPlayerKindMatch: a = player: the label 3E:4023 for a computer golfer ($13 = 0 / 2, or golfer $0B) or
// 3E:401C for a person ($13 = 1 / 3)
function drawPlayerKindMatch(w, a) {
  const [ch, k, d] = a === 1 ? [0xC8D0, 0xC8D3, 5] : [0xC890, 0xC893, 0];
  let s = null;
  if (rd(w, ch) === 0x0B) s = 0x4023;
  else s = [0x4023, 0x401C, 0x4023, 0x401C][rd(w, k)] ?? null;
  if (s !== null) drawTileStringAt(w, s, d);
}

// 3E:60CA DrawPlayerName: a = player, (b, c) = cell: attributes of 7 cells cleared (3E:612C), the name printed
// (text $14BF, code $04 with the player record's name) into $CA00 (7 spaces first, 3E:6144) and its 7 tiles copied
// to the cell (3E:615E)
function* drawPlayerName(sh, a, b, c) {
  const w = sh.w, old = wbank(w);
  setW(w, 1);
  for (let k = 0; k < 7; k++) putAttr(w, 0, b + k, c);
  setW(w, 5);
  T.pushTextStringArg(w, a === 1 ? 0xC8C0 : 0xC880);   // 05:54CF
  wr(w, 0xD847, 0);
  const de = (0xD400 + mulHLByA(0x20, c) + b) & 0xFFFF;
  for (let k = 0; k < 7; k++) wr(w, 0xCA00 + k, 0x20);
  yield* T.printTextToBuffer(sh, 0x14BF, 0xCA00, 0x20);
  setW(w, 1);
  for (let k = 0; k < 7; k++) wr(w, de + k, rd(w, 0xCA00 + k));
  setW(w, old);
}

// 3E:4842 FillUnusedMarkCells: tile $C9 over the cells after the holes still to win, both rows (the second loop
// always counts from $D553: the first left the zero flag set)
function fillUnusedMarkCells(w) {
  const fill = (b, c, a) => {
    for (; a; a = (a - 1) & 0xFF, b = (b - 1) & 0xFF) { putTileOnly(w, 0xC9, b, c); putTileOnly(w, 0xC9, b, c + 1); }
  };
  fill(0x10, 0x08, rd(w, 0xC83A) ? 9 : (0x0A - rd(w, 0xD553)) & 0xFF);
  fill(0x10, 0x0D, (0x0A - rd(w, 0xD553)) & 0xFF);
}

// 3E:489E LoadMatchBanner: a playoff's banner 3E:5E88 ($D61D = 2) or, with $D52A, the decisive hole's 3E:5F94
// ($D61D = 1), to VRAM1 $8300 with OBJ palette 3
function loadMatchBanner(w) {
  const old = wbank(w);
  setW(w, 6); wr(w, 0xD61D, 0);
  setW(w, 1);
  if (rd(w, 0xC83A)) {
    D.lzTo(w, B, 0x5E88, 0xD000);
    if (w.vram) { D.queueAndRunVRAMCopy(w, 0xD000, 0xA300, 0x10); D.loadPalettesMasterOnly(w, 0x6078, 0x0B, 0x01); }
    setW(w, 6); wr(w, 0xD61D, 2);
  } else {
    setW(w, 6);
    if (rd(w, 0xD52A) === 1) {
      setW(w, 1);
      D.lzTo(w, B, 0x5F94, 0xD000);
      if (w.vram) { D.queueAndRunVRAMCopy(w, 0xD000, 0xA300, 0x0E); D.loadPalettesMasterOnly(w, 0x6088, 0x0B, 0x01); }
      setW(w, 6); wr(w, 0xD61D, 1);
    }
  }
  setW(w, old);
}

// 3E:45B0 LoadPlayer1Portrait / 3E:4605 LoadPlayer2Portrait: the face (3E:4990 + golfer x $40) to VRAM1 $85C0 /
// $86C0, its palette (3E:4D90 + golfer x 8, + $80 with record bit 4 of +$19) to OBJ palette 4 / 5
function loadPlayerPortrait(w, p) {
  if (!w.vram) return;
  const ch = rd(w, p ? 0xC8D0 : 0xC890);
  const hl = ch * 8;
  D.queueAndRunVRAMCopy(w, (hl * 8 + 0x4990) & 0xFFFF, p ? 0xA6C0 : 0xA5C0, 0x04);
  let pal = (hl + 0x4D90) & 0xFFFF;
  if (rd(w, p ? 0xC8D9 : 0xC899) & 0x10) pal = (pal + 0x80) & 0xFFFF;
  D.loadPalettesImmediate(w, pal, p ? 0x0D : 0x0C, 0x01);
}

// 3E:6098 WaitKeyNoTimeout: A / B -> 0, Right -> 1 (its 300-frame count is never decremented), sound $5C, a frame
function* waitKeyNoTimeout(sh) {
  const w = sh.w;
  let a;
  for (;;) {
    yield* sh.advance();
    const p = w.high[0x194];
    if (p & 3) { a = 0; break; }
    if (p & 0x10) { a = 1; break; }
  }
  sh.sound(0x5C);
  yield* sh.advance();
  return a;
}

// 3E:465A MatchStandingsTask: the two portrait panels (00:2756), the bobbing sprite 3E:4930 (offsets 3E:47B3 by
// hVBlankCount), the banner (3E:4800 / 3E:4820 by $D61D) and, once the hole is over, the last hole winner's newest
// mark blinking (tiles 3E:4034 / 3E:4036 or the mark 3E:4038 / 3E:403A by $D592 bit 4) through QueueBGTileWrite
export function matchStandingsTask(w) {
  const old = wbank(w);
  setW(w, 6);
  D.inBank(w, B, () => {
    if (w.vram) {
      D.queueSpriteGrid(w, 0x0201, 0x1030, 0x0C5C);
      D.queueSpriteGrid(w, 0x0201, 0x1058, 0x0D6C);
      D.queueSpriteTemplate(w, 0x4930, 0, rb(B, 0x47B3 + (w.high[0x18C] & 0x3F)), 0x00, 0x08);
      const k = rd(w, 0xD61D);
      if (k) D.queueSpriteTemplate(w, k === 2 ? 0x4820 : 0x4800, 0, 0, 0x30, 0x0B);
    }
    if (!rd(w, 0xC4BD)) return;
    const r = rd(w, 0xC83A) ? rd(w, 0xC96C) : rd(w, (0xC96E + ((rd(w, 0xC837) - 1) & 0xFF)) & 0xFFFF);
    if (r !== 1 && r !== 2) return;
    const b = (rb(B, 0x403C) + rd(w, r === 1 ? 0xD555 : 0xD556) - 1) & 0xFF;
    let c = rb(B, 0x403D);
    if (r === 2) c = (c + rb(B, 0x403E)) & 0xFF;
    const n = (rd(w, 0xD592) + 1) & 0x1F;
    wr(w, 0xD592, n);
    const [t0, t1] = n & 0x10 ? [0x4038, 0x403A] : [0x4034, 0x4036];
    for (const [t, cc] of [[t0, c], [t1, c + 1]]) {
      const de = (0x9800 + mulHLByA(0x20, cc & 0xFF) + b) & 0xFFFF;   // 3E:61CD BGMap9800Addr
      D.queueBGTileWrite(w, de, rb(B, t), rb(B, t + 1));   // 00:04B4
    }
  });
  setW(w, old);
}

// ---- the two-player Stroke screen (TwoPlayerScoreScreen 3E:6361, page 0 of the two-player scorecard 0E:4436; also
// the debug room's 35:775F): the two names and kinds, each score against par, the winner's and loser's faces ----
const scoreWord = a => (a >= 0x91 ? 0xFF00 | a : a);   // 3E:6342 MatchScoreToWord
const absWord = v => (v & 0x8000 ? (0x10000 - v) & 0xFFFF : v);
// 3E:62A6 ScoreTensDigit / 3E:62D3 ScoreOnesDigit: |score|, less 100 once when it is 100 or more, its tens / ones
function scoreTensOnes(a) {
  let v = absWord(scoreWord(a));
  const t = (v - 100) & 0xFFFF;
  if (!(t & 0x8000)) v = t;
  const q = Math.floor(v / 10);
  return [q & 0xFF, (v - mulHLByA(q, 10)) & 0xFF];
}
const putTileAttr0 = (w, a, b, c) => put(w, b, c, a, 0);   // 3E:61E3 PutTileAttr0
// 3E:6525 DrawScoreVsPar: a = the score byte at (b, c): the sign ('+', '-', or $60 when even), a '1' when |score|
// has hundreds, the tens (none when 0 and the byte less 100 is negative), the ones
function drawScoreVsPar(w, d, b, c) {
  const v = scoreWord(d);
  putTileAttr0(w, !v ? 0x60 : v & 0x8000 ? 0x2D : 0x2B, b, c);
  b++;
  if (d && (Math.floor(absWord(v) / 100) & 0xFF)) putTileAttr0(w, 0x31, b, c);
  b++;
  const [t, o] = scoreTensOnes(d);
  if (t) putTileAttr0(w, (t + 0x30) & 0xFF, b, c);
  else if (!(((d - 0x64) & 0xFF) & 0x80)) putTileAttr0(w, 0x30, b, c);
  b++;
  putTileAttr0(w, (o + 0x30) & 0xFF, b, c);
}
// 3E:659D DrawPlayerKindResult: a = player: the label 3E:402F for a computer golfer ($13 = 0 / 2, or golfer $0B) or
// 3E:4028 for a person ($13 = 1 / 3)
function drawPlayerKindResult(w, a) {
  const [ch, k, d] = a === 1 ? [0xC8D0, 0xC8D3, 5] : [0xC890, 0xC893, 0];
  let s = null;
  if (rd(w, ch) === 0x0B) s = 0x402F;
  else s = [0x402F, 0x4028, 0x402F, 0x4028][rd(w, k)] ?? null;
  if (s !== null) drawTileStringAt(w, s, d);
}
// 3E:64FB DrawScoreLabel: tiles $39-$3B over $49-$4B at (b, c)
function drawScoreLabel(w, b, c) {
  for (let k = 0; k < 3; k++) putTileOnly(w, 0x39 + k, b + k, c);
  for (let k = 0; k < 3; k++) putTileOnly(w, 0x49 + k, b + k, c + 1);
}
// 3E:6421 FillScorePanels: tile $C9 over columns 7-$10 of rows 8-9 and $0D-$0E
function fillScorePanels(w) {
  for (const c of [8, 9, 0x0D, 0x0E]) for (let b = 7; b < 0x11; b++) putTileOnly(w, 0xC9, b, c);
}
// 3E:665B LoadResultFaces: player 1's score word against player 2's (3E:6637): the lower gets the face 3E:5DE1
// (palette 3E:6068), the other 3E:5E2E (3E:6058), to VRAM1 $8100 (OBJ palette 9) / $8200 ($0A); a tie: 3E:5DE1 both
function loadResultFaces(w) {
  const old = wbank(w);
  setW(w, 1);
  const p1 = scoreWord(rd(w, 0xC8BE)), p2 = scoreWord(rd(w, 0xC8FE));
  const diff = (p1 - p2) & 0xFFFF;
  const face = (src, de, pal, slot) => {
    D.lzTo(w, B, src, 0xD000);
    if (w.vram) { D.queueAndRunVRAMCopy(w, 0xD000, de, 0x06); D.loadPalettesMasterOnly(w, pal, slot, 0x01); }
  };
  if (!diff) {
    D.lzTo(w, B, 0x5DE1, 0xD000);
    if (w.vram) {
      D.queueAndRunVRAMCopy(w, 0xD000, 0xA100, 0x06);
      D.queueAndRunVRAMCopy(w, 0xD000, 0xA200, 0x06);
      D.loadPalettesMasterOnly(w, 0x6068, 0x09, 0x01);
      D.loadPalettesMasterOnly(w, 0x6068, 0x0A, 0x01);
    }
  } else if (diff & 0x8000) { face(0x5DE1, 0xA100, 0x6068, 0x09); face(0x5E2E, 0xA200, 0x6058, 0x0A); }
  else { face(0x5E2E, 0xA100, 0x6058, 0x09); face(0x5DE1, 0xA200, 0x6068, 0x0A); }
  setW(w, old);
}
// 3E:6361 TwoPlayerScoreScreen: returns 0 (A / B) or 1 (Right: the other page)
export function* twoPlayerScoreScreen(sh) {
  const w = sh.w;
  Scr.beginFadeOut(w, 0x08);                     // 00:25A1
  yield* Scr.waitFade(sh);                       // 00:2625
  setW(w, 5);
  yield* initWindowSystem(sh);                   // 05:407A
  setW(w, 6);
  reloadFontTiles(w);                            // 01:421A
  D.inBank(w, 0x03, () => T.resetGlyphBuffer(w));   // 03:4EB8
  if (w.vram) D.disableLCDSafely(w);             // 00:0341
  clearFrameTasks(w);                            // 00:23B6
  if (w.vram) { D.resetSprites(w); w.lcd.wy = 0x90; }   // 00:2683
  w.high[0x18A] = w.high[0x18B] = 0;             // hSCY / hSCX
  const old = wbank(w);
  D.inBank(w, B, () => loadStandingsGfx(w));
  fillScorePanels(w);
  setW(w, 6);
  drawHoleNumber(w);
  yield* drawPlayerName(sh, 0, 0x06, 0x08);
  drawPlayerKindResult(w, 0);
  yield* drawPlayerName(sh, 1, 0x06, 0x0D);
  drawPlayerKindResult(w, 1);
  drawScoreLabel(w, 0x0E, 0x06);
  drawScoreLabel(w, 0x0E, 0x0B);
  drawScoreVsPar(w, rd(w, 0xC8BE), 0x0E, 0x08);
  drawScoreVsPar(w, rd(w, 0xC8FE), 0x0E, 0x0D);
  setW(w, 1);
  if (w.vram) D.inBank(w, B, () => {
    D.queueVRAMCopy(w, 0xD000, 0xB800, 0x24);
    D.queueAndRunVRAMCopy(w, 0xD400, 0x9800, 0x24);
  });
  copyMapToScrollBuffers(w);                     // 00:0804
  if (w.vram) yield* inBankGen(w, 0x03, T.uploadGlyphTiles(sh));   // 03:4F6C (LCD off: at once)
  setW(w, 1);
  D.inBank(w, B, () => { loadPlayerPortrait(w, 0); loadPlayerPortrait(w, 1); loadResultFaces(w); });
  D.inBank(w, B, () => registerFrameTask(w, 0x0F, B, 0x645C));   // TwoPlayerScoreTask
  if (w.vram) D.enableLCD(w);                    // 00:0371
  Scr.beginFadeIn(w, 0x08);                      // 00:25AF
  yield* Scr.waitFade(sh);
  const a = yield* waitKeyNoTimeout(sh);
  setW(w, old);
  return a;
}
// 3E:645C TwoPlayerScoreTask: the two portrait panels (00:2756), the sprite templates 3E:6740 / 3E:674E and the
// bobbing sprite 3E:4930 (offsets 3E:64BB by hVBlankCount); WRAM6 meanwhile
export function twoPlayerScoreTask(w) {
  const old = wbank(w);
  setW(w, 6);
  if (w.vram) D.inBank(w, B, () => {
    D.queueSpriteGrid(w, 0x0201, 0x3030, 0x0C5C);
    D.queueSpriteGrid(w, 0x0201, 0x3058, 0x0D6C);
    D.queueSpriteTemplate(w, 0x6740, 0, 0, 0x10, 0x09);
    D.queueSpriteTemplate(w, 0x674E, 0, 0, 0x20, 0x0A);
    D.queueSpriteTemplate(w, 0x4930, 0, rb(B, 0x64BB + (w.high[0x18C] & 0x3F)), 0x00, 0x08);
  });
  setW(w, old);
}

// ---- bank 3E's unreferenced cell writers (fuzz-checked: web/tests/golf_fuzz_routines.mjs) ----
const rdAny = (w, a) => (a >= 0xC000 ? rd(w, a) : rb(B, a));
// 3E:60C3 PutTileStringAttr0 (the loop at 3E:617C) / 3E:618D PutTileStringNoAttr: the tiles at hl up to a 0 from (b, c)
export function putTileStringAttr0(w, hl, b, c) { for (; rdAny(w, hl); hl = (hl + 1) & 0xFFFF, b = (b + 1) & 0xFF) putTileAttr0(w, rdAny(w, hl), b, c); }
export function putTileStringNoAttr(w, hl, b, c) { for (; rdAny(w, hl); hl = (hl + 1) & 0xFFFF, b = (b + 1) & 0xFF) putTileOnly(w, rdAny(w, hl), b, c); }
// 3E:626D DrawTileStringAttr0At / 3E:6280 DrawTileStringNoAttrAt: hl = (x, y + d, tiles..., 0)
export function drawTileStringAttr0At(w, hl, d) { putTileStringAttr0(w, (hl + 2) & 0xFFFF, rdAny(w, hl), (rdAny(w, hl + 1) + d) & 0xFF); }
export function drawTileStringNoAttrAt(w, hl, d) { putTileStringNoAttr(w, (hl + 2) & 0xFFFF, rdAny(w, hl), (rdAny(w, hl + 1) + d) & 0xFF); }
// 3E:65E3 DrawScoreLabelB / 3E:660D DrawScoreLabelC: tiles $CA-$CC over $DA-$DC / $CD-$CF over $DD-$DF at (b, c)
export function drawScoreLabelBC(w, t, b, c) {
  for (let k = 0; k < 3; k++) putTileOnly(w, t + k, (b + k) & 0xFF, c);
  for (let k = 0; k < 3; k++) putTileOnly(w, t + 0x10 + k, (b + k) & 0xFF, (c + 1) & 0xFF);
}
export { scoreTensOnes, drawScoreVsPar, putTileAttr0 };
