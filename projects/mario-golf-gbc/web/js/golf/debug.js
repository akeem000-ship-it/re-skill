// The debug menus of bank 05, as the game runs them with hDebugMode ($FF9E) set (not reachable in the retail game:
// DebugBootMenu 01:40A6, which sets it, is jumped over by GameMain; REVERSE.md "Debug code"). The screen cases poke
// hDebugMode on both sides. A on the map with nothing ahead opens DebugMenu 05:6B2E (MapEventLoop 0A:4B50).
import * as D from "./render/display.js";
import * as W from "./windows.js";
import { restoreShadowFromMap } from "./shadow.js";
import { formatDecimalNumber } from "./render/text.js";
import { rb } from "./rom.js";
import { mapIndexOf } from "./mapengine.js";
import { mapCount, mapIdAt } from "./unreached.js";
import { registerFrameTask, unregisterFrameTask } from "./tasks.js";
import { adjustColor } from "./home.js";
import { addPointsSigned } from "./unreached.js";
import { awardExpPoints } from "./exp.js";
import { mapLoadGfxScreen, mapGfxStartTileAnim, mapGfxStopTileAnim } from "./mapgfx.js";
import { initWindowSystem as initWindowSystemW } from "./round.js";
import { printString, printHexByte, printDecimalByte } from "./match.js";
import { printHexWord, printDecimalByteSigned } from "./home.js";
import { printDecimalWord } from "./render/behind.js";
import { saveLoad, saveBlockLoad } from "./save.js";
import { mulHLByA } from "./math.js";

const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
function notPorted(what) { throw new Error(`${what} is not ported`); }
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}

// 05:6B2E DebugMenu: the menu of text $0084 (Scene / Map / Palette / Flag) at (1, $0C) (window slot kept in $C470),
// drawn (05:4492, 05:4949), RunMenu_05; the window closed and the screen redrawn; B leaves, a row runs its handler
// (DebugMenuJumpTable 05:6B6E: 05:6B76 DebugMenuScene, 05:6B7B DebugMenuMap, 05:6B83 DebugMenuPalette, 05:6B88
// DebugMenuFlag) and the menu opens again
export function* debugMenu(sh) {
  const w = sh.w;
  for (;;) {
    const s = yield* inBankGen(w, 0x05, W.openMenuWindow(sh, 0x0084, 0x0C, 0x01));
    wr(w, 0xC470, s);
    yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));
    yield* inBankGen(w, 0x05, W.updateWindows(sh));
    const a = yield* inBankGen(w, 0x05, W.runMenu05(sh));
    W.closeWindow(w, rd(w, 0xC470));
    yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));
    yield* inBankGen(w, 0x05, W.updateWindows(sh));
    if (a === 0xFF) return;
    if (a === 0) yield* debugWarpMenu(sh);       // 05:6B76 -> 05:6C25
    else if (a === 1) {                          // 05:6B7B (w.gfxBrowser: a test's patch of 0B:4579 into 0B:4776)
      yield* inBankGen(w, 0x0B, w.gfxBrowser ? mapGfxBrowser(sh) : debugMapGfxViewer(sh));
      D.restorePalettesFromMaster(w);
    }
    else if (a === 2) yield* inBankGen(w, 0x44, debugPaletteEditor(sh));   // 05:6B83 -> 44:42FB
    else yield* debugFlagEditor(sh);             // 05:6B88 -> 05:6A57
  }
}

// 05:6CCC DebugAdjustValue: a + 1 on Right, - 1 on Left (hJoyRepeat), wrapping within 0 .. d - 1
export function debugAdjustValue(w, a, d) {
  const r = w.high[0x191];
  let b;
  if (r & 0x10) b = (a + 1) & 0xFF;
  else if (r & 0x20) b = (a - 1) & 0xFF;
  else return a;
  if (b & 0x80) return (d - 1) & 0xFF;
  return b < d ? b : 0;
}

// 05:6B8D DebugDrawWarpWindow: window $C471's record rebuilt (05:4818), the map's name (text $012C + the map record
// $C470) as its text, "- ENTER NO -" (05:6C18) at (1, 4), the record and the entrance ($C474) in two digits at
// ($11, 2) / ($11, 4), the cursor tile $0D (attribute $80) at ($10, 2 + 2 x $C473); drawn (05:4492, 05:4949)
function* debugDrawWarpWindow(sh) {
  const w = sh.w;
  const s = rd(w, 0xC471);
  W.rebuildWindowRecord(w, s);
  W.setWindowText(w, s, (0x012C + rd(w, 0xC470)) & 0xFFFF);
  const put = (str, d, e) => {
    for (let k = 0; k < str.length; k++) wr(w, 0xC600 + k, str[k]);
    W.drawStringToWindow(w, s, str, d, e);
  };
  D.inBank(w, 0x05, () => D.copyMemoryFast(w, 0x6C18, 0xC600, 0x10));   // ($100 bytes from 05:6C18)
  const enter = [];
  for (let k = 0; rd(w, 0xC600 + k); k++) enter.push(rd(w, 0xC600 + k));
  W.drawStringToWindow(w, s, enter, 0x01, 0x04);
  put(formatDecimalNumber(rd(w, 0xC470), 2), 0x11, 0x02);
  put(formatDecimalNumber(rd(w, 0xC474), 2), 0x11, 0x04);
  W.setWindowTile(w, s, 0x10, (rd(w, 0xC473) * 2 + 2) & 0xFF, 0x0D, 0x80);
  yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));
  yield* inBankGen(w, 0x05, W.updateWindows(sh));
}

// 05:6C25 DebugWarpMenu: WRAM5; a 20 x 6 window at the screen's top (05:4AF2) for the map record (from wMapId through
// 0A:5348 MapIndexOf, up to 0A:531F MapCount) and the entrance (0-15): Up / Down switch the row ($C473), Left / Right
// change it (05:6CCC); A: wMapId = the record's map (0A:5336), wMapEntrance, the warp $FA; B leaves; the window closed
function* debugWarpMenu(sh) {
  const w = sh.w;
  setW(w, 5);
  wr(w, 0xC473, 0); wr(w, 0xC474, 0);
  wr(w, 0xC470, mapIndexOf(rd(w, 0xC450)));
  wr(w, 0xC472, mapCount());
  wr(w, 0xC471, yield* inBankGen(w, 0x05, W.openWindow(sh, 0, 0, 0x14, 0x06)));
  yield* debugDrawWarpWindow(sh);
  yield* sh.advance();
  for (;;) {
    const p = w.high[0x194];
    if (p & 2) break;
    if (p & 1) {
      wr(w, 0xC450, mapIdAt(rd(w, 0xC470)));
      wr(w, 0xC46A, rd(w, 0xC474));
      wr(w, 0xC441, 0xFA);
      break;
    }
    if (w.high[0x191] & 0xC0) { wr(w, 0xC473, rd(w, 0xC473) ^ 1); yield* debugDrawWarpWindow(sh); }
    const [hl, d] = rd(w, 0xC473) === 1 ? [0xC474, 0x10] : [0xC470, rd(w, 0xC472)];
    const a = debugAdjustValue(w, rd(w, hl), d);
    if (a !== rd(w, hl)) { wr(w, hl, a); yield* debugDrawWarpWindow(sh); }
    yield* sh.advance();
  }
  W.closeWindow(w, rd(w, 0xC471));
  yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));
  yield* inBankGen(w, 0x05, W.updateWindows(sh));
}

// ---- the flag editor (05:6A57 DebugFlagEditor): the game flags $C840- by pages of 64 ----
const flagOn = (w, n) => w.wram[0][0x840 + ((n & 0xFF) >> 3)] & (0x80 >> (n & 7));
const romString = (bank, hl) => { const s = []; for (let p = hl; rb(bank, p); p++) s.push(rb(bank, p)); return s; };
// 05:687E DebugToggleFlagAtCursor: flag page x 64 + row x 8 + column (8-bit) toggled (00:2D10 / 2D2E / 2D49)
function debugToggleFlagAtCursor(w) {
  const n = ((rd(w, 0xC484) << 6) + (rd(w, 0xC486) << 3) + rd(w, 0xC485)) & 0xFF;
  w.wram[0][0x840 + (n >> 3)] ^= 0x80 >> (n & 7);
}
// 05:6945 DebugDrawHexLabel: flag a's high hex digit (05:6935) then tile $3F at (d, e) of window b (attribute $80)
function debugDrawHexLabel(w, a, b, d, e) {
  W.setWindowTile(w, b, d, e, rb(0x05, 0x6935 + (a >> 4)), 0x80);
  W.setWindowTile(w, b, (d + 1) & 0xFF, e, 0x3F, 0x80);
}
// 05:6967 DebugDrawFlagRow: flags a .. a + 7 as tiles $65 (clear) / $40 (set) every two columns from (d, e)
function debugDrawFlagRow(w, a, b, d, e) {
  for (let k = 0; k < 8; k++, d = (d + 2) & 0xFF) W.setWindowTile(w, b, d, e, flagOn(w, a + k) ? 0x40 : 0x65, 0x80);
}
// 05:68B4 DebugDrawFlagsLeft / 05:68F4 DebugDrawFlagsRight: the page's first / last 32 flags in window $C488 / $C489:
// two hex labels and four rows
function debugDrawFlags(w, right) {
  const b = rd(w, right ? 0xC489 : 0xC488);
  let a = right ? ((rd(w, 0xC484) * 2 + 1) << 5) & 0xFF : (rd(w, 0xC484) << 6) & 0xFF;
  debugDrawHexLabel(w, a, b, 1, 1);
  debugDrawFlagRow(w, a, b, 4, 1); a = (a + 8) & 0xFF;
  debugDrawFlagRow(w, a, b, 4, 2); a = (a + 8) & 0xFF;
  debugDrawHexLabel(w, a, b, 1, 4);
  debugDrawFlagRow(w, a, b, 4, 4); a = (a + 8) & 0xFF;
  debugDrawFlagRow(w, a, b, 4, 5);
}
// 05:6998 DebugDrawFlagCursor / 05:69C9 DebugEraseFlagCursor: tile $0D / $20 at the cursor (column $C485 x 2 + 3, row
// ($C486 & 3) + 1, + 1 past the label row) in the left window, or the right one with $C486 bit 2
function debugFlagCursor(w, t) {
  const d = (rd(w, 0xC485) * 2 + 3) & 0xFF;
  let e = ((rd(w, 0xC486) & 3) + 1) & 0xFF;
  if (e >= 3) e++;
  W.setWindowTile(w, rd(w, rd(w, 0xC486) & 4 ? 0xC489 : 0xC488), d, e, t, 0x80);
}
// 05:69FB DebugMoveFlagCursor: the held d-pad (Left, Right, Up, Down: the first of them) moves the cursor, wrapping 0-7
function debugMoveFlagCursor(w) {
  let d = rd(w, 0xC485), e = rd(w, 0xC486);
  const h = w.high[0x190];
  if (h & 0x20) d--; else if (h & 0x10) d++; else if (h & 0x40) e--; else if (h & 0x80) e++;
  wr(w, 0xC485, d & 7); wr(w, 0xC486, e & 7);
}
function* redraw(sh) {
  yield* inBankGen(sh.w, 0x05, restoreShadowFromMap(sh));
  yield* inBankGen(sh.w, 0x05, W.updateWindows(sh));
}
// 05:6A57 DebugFlagEditor: with flag #31 set it is set again and the cursor and page cleared (a quirk: so only the
// first open after #31 keeps them); three windows (05:4AF2): the header (05:6A37 / 05:6A47 at (4, 1) / (4, 2)), the
// left and right flags; the cursor drawn; NullFrameTask 05:6A36 registered (flags $0F); each frame: B leaves, A toggles
// the flag at the cursor, Start the next of four pages, a held d-pad moves the cursor (every frame)
function* debugFlagEditor(sh) {
  const w = sh.w;
  if (flagOn(w, 31)) { w.wram[0][0x843] |= 0x01; wr(w, 0xC485, 0); wr(w, 0xC486, 0); wr(w, 0xC484, 0); }
  const s0 = yield* inBankGen(w, 0x05, W.openWindow(sh, 0, 0, 0x14, 0x04));
  wr(w, 0xC487, s0);
  W.drawStringToWindow(w, s0, romString(0x05, 0x6A37), 4, 1);
  W.drawStringToWindow(w, s0, romString(0x05, 0x6A47), 4, 2);
  wr(w, 0xC488, yield* inBankGen(w, 0x05, W.openWindow(sh, 0, 4, 0x14, 0x07)));
  wr(w, 0xC489, yield* inBankGen(w, 0x05, W.openWindow(sh, 0, 0x0B, 0x14, 0x07)));
  debugDrawFlags(w, false); debugDrawFlags(w, true);
  debugFlagCursor(w, 0x0D);
  yield* redraw(sh);
  D.inBank(w, 0x05, () => registerFrameTask(w, 0x0F, 0x05, 0x6A36));
  for (;;) {
    const p = w.high[0x194];
    if (p & 2) break;
    if (p & 1) { debugToggleFlagAtCursor(w); debugDrawFlags(w, false); debugDrawFlags(w, true); yield* redraw(sh); }
    if (w.high[0x194] & 8) {
      wr(w, 0xC484, (rd(w, 0xC484) + 1) & 3);
      debugDrawFlags(w, false); debugDrawFlags(w, true);
      yield* redraw(sh);
    }
    if (w.high[0x190] & 0xF0) { debugFlagCursor(w, 0x20); debugMoveFlagCursor(w); debugFlagCursor(w, 0x0D); yield* redraw(sh); }
    yield* sh.advance();
  }
  for (const a of [0xC487, 0xC488, 0xC489]) W.closeWindow(w, rd(w, a));
  yield* redraw(sh);
  unregisterFrameTask(w, 0x05, 0x6A36);
}
export function nullFrameTask() {}               // 05:6A36 NullFrameTask: ret

// ---- the palette editor (bank 44: DebugPaletteEditor 44:42FB, from the debug menu's Palette or, with hDebugMode, Up
// held after a golf pause menu 08:4708) ----
// 44:4004 PrintWindowString: the bytes (0 ends) into window a from (d, e), attribute $80
function printWindowString(w, a, s, d, e) { for (const t of s) { if (!t) break; W.setWindowTile(w, a, d, e, t, 0x80); d = (d + 1) & 0xFF; } }
// 44:40E0 PalEditColorPtr: $C100 + 2 x (4 x row $C3F7 + column $C3F6)
const palEditColorPtr = w => (0xC100 + ((((rd(w, 0xC3F7) << 2) + rd(w, 0xC3F6)) << 1) & 0xFF)) & 0xFFFF;
// 44:40F4 DrawColorRGB: the colour's red, green and blue (00:24EB) as three-digit numbers at $C470 / $C473 / $C476 (each
// 0-ended, the next over the 0), tile $0D over the first character of component e's, $C479 = 0, printed at (1, 2) of
// window $C3F5; drawn (05:4492, 05:4949)
function* drawColorRGB(sh, e) {
  const w = sh.w, p = palEditColorPtr(w);
  const v = rd(w, p) | rd(w, p + 1) << 8;
  const put = (de, n) => formatDecimalNumber(n, 3).forEach((t, k) => wr(w, de + k, t));
  put(0xC470, v & 0x1F); put(0xC473, (v >> 5) & 0x1F); put(0xC476, (v >> 10) & 0x1F);
  wr(w, (0xC470 + ((e * 3) & 0xFF)) & 0xFFFF, 0x0D);
  wr(w, 0xC479, 0);
  const s = [];
  for (let a = 0xC470; rd(w, a); a++) s.push(rd(w, a));
  printWindowString(w, rd(w, 0xC3F5), s, 1, 2);
  yield* redraw(sh);
}
// 44:4156 EditColorDialog: an 11 x 4 window at (7, 0) (05:4AF2), "--R--G--B" (44:414C) at (1, 1), the colour; each frame
// A / B close it; held Left / Right pick the component (wrapping 0-2), held Up / Down step it by + / - 1 (00:252E /
// 00:253A / 00:254A, kept in 0-$1F) and hPalUpdate = 3; the window closed
function* editColorDialog(sh) {
  const w = sh.w;
  const s = yield* inBankGen(w, 0x05, W.openWindow(sh, 7, 0, 0x0B, 0x04));
  wr(w, 0xC3F5, s);
  yield* redraw(sh);
  const label = [];
  for (let a = 0x414C; rb(0x44, a); a++) label.push(rb(0x44, a));
  printWindowString(w, s, label, 1, 1);
  let e = 0;
  yield* drawColorRGB(sh, e);
  for (;;) {
    if (w.high[0x194] & 3) break;
    const held = w.high[0x190];
    if (held & 0x30) {
      e = held & 0x20 ? (e - 1) & 0xFF : (e + 1) & 0xFF;
      if (e === 0xFF) e = 2;
      if (e === 3) e = 0;
      yield* drawColorRGB(sh, e);
      continue;
    }
    if (held & 0xC0) {
      const d = held & 0x40 ? 1 : 0xFF, p = palEditColorPtr(w);
      const bc = adjustColor(rd(w, p) | rd(w, p + 1) << 8, d, e & 3);
      wr(w, p, bc & 0xFF); wr(w, p + 1, bc >> 8);
      w.high[0x19D] = 3;
      yield* drawColorRGB(sh, e);
      continue;
    }
    yield* sh.advance();
  }
  W.closeWindow(w, rd(w, 0xC3F5));
  yield* redraw(sh);
}
// 44:41EB DebugPaletteEditorLoop: a 7 x 18 window at (0, 0) with attribute 0 (05:4AD2): the digits $30-$37 down column
// 1 (16 rows: 0-7 twice), and rows 1-8 of four tiles $A0-$A3 from column 2 with palette 0-7; drawn; the sprite task
// 44:4292; each frame B leaves, A edits the colour (44:4156), Left / Right / Up / Down (hJoyRepeat) move the cursor
// ($C3F6 0-3, $C3F7 0-15); the window closed, the task removed
function* debugPaletteEditorLoop(sh) {
  const w = sh.w;
  const old = w.high[0x196];                     // (05:4AD2 OpenWindowWithAttr: wWindowAttr $D84D = 0 meanwhile)
  setW(w, 5); wr(w, 0xD84D, 0);
  const s = yield* inBankGen(w, 0x05, W.openWindow(sh, 0, 0, 0x07, 0x12));
  wr(w, 0xD84D, 0x80);
  setW(w, old);
  wr(w, 0xC3F4, s);
  let c = 0x30;
  for (let e = 1; e <= 0x10; e++) { W.setWindowTile(w, s, 1, e, c, 0); c = (c + 1) & 0xF7; }
  for (let e = 1, b = 0; b < 8; e++, b++) for (let k = 0; k < 4; k++) W.setWindowTile(w, s, 2 + k, e, 0xA0 + k, b);
  yield* redraw(sh);
  D.inBank(w, 0x44, () => registerFrameTask(w, 0x0F, 0x44, 0x4292));
  for (;;) {
    if (w.high[0x194] & 2) break;
    if (w.high[0x194] & 1) yield* editColorDialog(sh);
    let d = rd(w, 0xC3F6), e = rd(w, 0xC3F7);
    const r = w.high[0x191];
    if (r & 0x20) d--; else if (r & 0x10) d++; else if (r & 0x40) e--; else if (r & 0x80) e++;
    wr(w, 0xC3F6, d & 3); wr(w, 0xC3F7, e & 0x0F);
    yield* sh.advance();
  }
  W.closeWindow(w, rd(w, 0xC3F4));
  yield* redraw(sh);
  unregisterFrameTask(w, 0x44, 0x4292);
}
// 44:42FB DebugPaletteEditor: the hex digit tiles 44:4020 queued to $8600 ($0C blocks), the cursor at colour 0
export function* debugPaletteEditor(sh) {
  const w = sh.w;
  D.inBank(w, 0x44, () => D.queueVRAMCopy(w, 0x4020, 0x8600, 0x0C));
  wr(w, 0xC3F6, 0); wr(w, 0xC3F7, 0);
  yield* debugPaletteEditorLoop(sh);
}
// 44:4292 PalEditorSpriteTask: the cursor (QueueSprite16 tile $60, attribute 1) over the colour ($C3F6 x 8 + $18, $C3F7 x
// 8 + $18, less the map's fine scroll + 4 in pixels), and eight rows of three sprites (tiles $66, $68, $6A; palette =
// the row) from ($20, $50)
export function palEditorSpriteTask(w) {
  if (!w.vram) return;
  const h = (((rd(w, 0xC320) << 3) | (rd(w, 0xC320) >> 5)) + 4) & 7;
  const l = (((rd(w, 0xC322) << 3) | (rd(w, 0xC322) >> 5)) + 4) & 7;
  D.queueSprite16(w, ((rd(w, 0xC3F7) << 3) + 0x18 - l) & 0xFF, ((rd(w, 0xC3F6) << 3) + 0x18 - h) & 0xFF, 0x60, 0x01);
  let e = (0x50 - l) & 0xFF;
  for (let b = 0; b < 8; b++, e = (e + 8) & 0xFF) {
    let d = (0x20 - h) & 0xFF;
    for (const c of [0x66, 0x68, 0x6A]) { D.queueSprite(w, e, d, c, b); d = (d + 8) & 0xFF; }
  }
}

// 41:77EA DebugPointsEditor (with hDebugMode, Select held after a golf pause menu, 08:46FF): WRAM5; a 20 x 6 window at
// (0, 0); every frame wPoints $C83C in four digits at (6, 2) (via WRAM5 $D000), drawn; held A + 100 (sound $5C), Right
// + 10, Left - 10 (sound $5B; 02:544E AddPointsSigned), B: the window closed and the points given as EXP (48:4D70 with
// h = $C8); the WRAM bank restored
export function* debugPointsEditor(sh) {
  const w = sh.w, old = w.high[0x196];
  setW(w, 5);
  const s = yield* inBankGen(w, 0x05, W.openWindow(sh, 0, 0, 0x14, 0x06));
  wr(w, 0xC3F8, s);
  yield* redraw(sh);
  for (;;) {
    const digits = formatDecimalNumber(rd(w, 0xC83C) | rd(w, 0xC83D) << 8, 4);
    digits.forEach((t, k) => wr(w, 0xD000 + k, t));
    W.drawStringToWindow(w, rd(w, 0xC3F8), digits, 6, 2);
    yield* redraw(sh);
    yield* sh.advance();
    const h = w.high[0x190];
    if (h & 1) { sh.sound(0x5C); addPointsSigned(w, 0x0064); continue; }
    if (h & 0x10) { sh.sound(0x5B); addPointsSigned(w, 0x000A); continue; }
    if (h & 0x20) { sh.sound(0x5B); addPointsSigned(w, 0xFFF6); continue; }
    if (h & 2) break;
  }
  W.closeWindow(w, rd(w, 0xC3F8));
  yield* redraw(sh);
  w.levelUpDiffSP = 0xCF4A;                     // (the stack in its level-up screen: 12 bytes deeper than after a round, as
  try {                                          // 02:503C CharLevelUpDiff leaves in HRAM $FFB2 / $FFB3)
    yield* inBankGen(w, 0x48, awardExpPoints(sh, rd(w, 0xC83C) | rd(w, 0xC83D) << 8, 0xC8));
  } finally { delete w.levelUpDiffSP; }
  setW(w, old);
}

// 05:5197 RunPagedMenu: hl = the first page's text id, a = the pages: WRAM5; $D846 = 0; each page: the menu of text hl +
// page at (1, 1) (05:4C4A OpenPagedMenuWindow: 05:4BB0, then the window's flag bits 0-1 set: Left / Right report $FE /
// $FD), drawn, RunMenu_05, closed (wMenuWindow_2 $D82F = $FF), drawn; a row: page x 4 + row; $FF: $FF; $FE / $FD the page
// before / after (wrapping); wMenuCursor = the result; the WRAM bank restored
export function* runPagedMenu(sh, hl, pages) {
  const w = sh.w, old = w.high[0x196];
  setW(w, 5);
  wr(w, 0xD846, 0);
  let a;
  for (;;) {
    yield* inBankGen(w, 0x05, W.openMenuWindow(sh, (hl + rd(w, 0xD846)) & 0xFFFF, 1, 1));
    W.setWindowFlags(w, rd(w, 0xD820), 3, 1);
    yield* redraw(sh);
    a = yield* inBankGen(w, 0x05, W.runMenu05(sh));
    W.closeWindow(w, rd(w, 0xD82F));
    wr(w, 0xD82F, 0xFF);
    yield* redraw(sh);
    if (a < 0x7F) { a = ((rd(w, 0xD846) << 2) + a) & 0xFF; break; }
    if (a === 0xFF) break;
    let p = rd(w, 0xD846);
    if (a === 0xFE) { p = (p - 1) & 0xFF; if (p === 0xFF) p = (pages - 1) & 0xFF; }
    else { p = (p + 1) & 0xFF; if (p >= pages) p = 0; }
    wr(w, 0xD846, p);
  }
  wr(w, 0xD830, a);
  setW(w, old);
  return a;
}
// 0B:4579 DebugMapGfxViewer (the debug menu's Map): the loaded graphics ($C32E) kept in $C33D, its tile animation
// stopped (0B:497D); a paged menu of the graphics ids (05:5197, text $0123 on, (count - 1) / 4 + 1 pages); a choice:
// MapLoadGfxScreen 0B:44C4 (b = 1) and its tile animation (0B:4900); then (05:6B7E) RestorePalettesFromMaster 00:05DD
function* debugMapGfxViewer(sh) {
  const w = sh.w;
  const pages = ((((rd(w, 0xC32D) - 1) & 0xFF) << 24 >> 24 >> 2) + 1) & 0xFF;
  wr(w, 0xC33D, rd(w, 0xC32E));
  mapGfxStopTileAnim(w, rd(w, 0xC32E));
  const a = yield* inBankGen(w, 0x05, runPagedMenu(sh, 0x0123, pages));
  wr(w, 0xC32E, a);
  if (a !== 0xFF) {
    yield* mapLoadGfxScreen(sh, a, 1);
    mapGfxStartTileAnim(w, rd(w, 0xC32E));
  }
}

// ---- the save viewer (02:5D2F DebugSaveViewer, the debug room's talk $0A 35:7768; bank 02 export $68) ----
const romString02 = (a) => { const s = []; for (let c; (c = rb(0x02, a)); a++) s.push(c); s.push(0); return s; };
const field = (w, bc, a) => rd(w, (bc + a) & 0xFFFF);
// 02:608E DebugPrintScoreField: byte [bc + a] - $36 signed (00:22E9), or the string 02:60A7 ("   -") when 0
function printScoreField(w, bc, a, de) {
  const v = field(w, bc, a);
  if (v) printDecimalByteSigned(w, (v - 0x36) & 0xFF, de);
  else printString(w, romString02(0x60A7), de >> 8, de & 0xFF);
}
const FIELD = {
  s: printScoreField,
  g: (w, bc, a, de) => printDecimalByteSigned(w, field(w, bc, a), de),             // 02:60AC DebugPrintSignedField
  w: (w, bc, a, de) => printDecimalWord(w, field(w, bc, a) | field(w, bc, a + 1) << 8, de >> 8, de & 0xFF),   // 02:60B7
  h: (w, bc, a, de) => printHexByte(w, field(w, bc, a), de),                       // 02:60C4 DebugPrintHexField
  p: (w, bc, a, de) => {                                                           // 02:60CF DebugPrintHexWordPair
    printHexWord(w, field(w, bc, a) | field(w, bc, a + 1) << 8, de);
    printHexWord(w, field(w, bc, a + 2) | field(w, bc, a + 3) << 8, (de + 0x0800) & 0xFFFF);
  },
};
// the pages' call lists ([printer, offset a, de]) as the code runs them
const REC_FIELDS = [["w", 0x00, 0x0102], ["s", 0x02, 0x0303], ["g", 0x03, 0x0304], ["w", 0x04, 0x0802], ["w", 0x06, 0x0803],
  ["g", 0x08, 0x0A04], ["g", 0x09, 0x0F02], ["g", 0x0A, 0x0F03], ["g", 0x0B, 0x0F04], ["g", 0x0C, 0x0F05], ["h", 0x0D, 0x0305],
  ...[0x07, 0x08, 0x09].flatMap((e, r) => [0, 5, 10, 15].map((d, k) => ["s", 0x0E + r * 4 + k, d << 8 | e])),
  ["s", 0x1A, 0x000A],                                                             // (byte $1B is not shown)
  ...[0, 5, 10, 15].map((d, k) => ["s", 0x1C + k, d << 8 | 0x0B]),
  ...[0x0D, 0x0E, 0x0F].flatMap((e, r) => [0, 4, 8, 12, 16].map((d, k) => [k === 4 ? "s" : "g", 0x20 + r * 5 + k, d << 8 | e])),
  ["h", 0x2F, 0x0111], ["h", 0x30, 0x0711], ["h", 0x31, 0x0D11]];
const BYTE_FIELDS = [["h", 0, 0x0102], ...[1, 2, 3, 4, 5, 6].map(k => ["h", k, 0x0103 + k]), ["g", 7, 0x010B]];
const WORD_FIELDS = Array.from({ length: 17 }, (_, k) => ["p", k * 4, 0x0101 + k]);
const BALL_FIELDS = [["w", 0, 0x0101], ["h", 2, 0x0801], ["w", 3, 0x0102], ["h", 5, 0x0802], ["w", 6, 0x0103], ["h", 8, 0x0803]];
const printFields = (w, bc, list) => { for (const [k, a, de] of list) FIELD[k](w, bc, a, de); };
// 02:60F0 ClearDebugLines: the string 02:6109 (spaces) at (0, 1) to (0, $11)
function clearDebugLines(w) {
  const s = romString02(0x6109);
  for (let e = 1; e <= 0x11; e++) printString(w, s, 0, e);
}
// 02:5DCE DebugSaveViewerPage: ClearDebugLines, then page b by the table 02:5DDF: 0-5 02:5E03 DebugSavePageRecord (the
// number b + 1 at (0, 1), record b: $32 bytes at $D000 + $32 b, 00:08B9), 6 02:5DF3 DebugSavePageAll ("ALL", 02:5DFF, at
// (1, 1), record 6), 7 02:5F8A DebugSavePageBytes ($D15E), 8 02:5FCE DebugSavePageWords ($D166), 9 02:605A
// DebugSavePageBall ($D400)
function debugSaveViewerPage(w, b) {
  clearDebugLines(w);
  if (b < 7) {
    if (b === 6) printString(w, romString02(0x5DFF), 1, 1);
    else printDecimalByte(w, b + 1, 0x0001);
    printFields(w, (mulHLByA(b, 0x32) + 0xD000) & 0xFFFF, REC_FIELDS);
  } else if (b === 7) printFields(w, 0xD15E, BYTE_FIELDS);
  else if (b === 8) printFields(w, 0xD166, WORD_FIELDS);
  else printFields(w, 0xD400, BALL_FIELDS);
}
// 02:5D2F DebugSaveViewer: SaveLoad 02:41F6 (its result ignored: the jr over 02:5D35's "FAT INIT/RECOVER" message and
// wait is unconditional, ~02:5D35 never runs); hDebugMode 3; WRAM1; save block 3 to $D000 (02:4355): $FF prints "CHECK
// SUM ERROR" (02:5D7F), another failure "NO FILE" (02:5D77), at (8, 4), one frame, then hangs (jr $, 02:5D67 /
// 02:5D75); 0: sound $01, page 0 and every frame (00:2E3B) Left / Right (hJoyRepeat) the previous / next page (0-9,
// wrapping) drawn. It never returns
export function* debugSaveViewer(sh) {
  const w = sh.w;
  saveLoad(w);
  w.high[0x19E] = 3;
  setW(w, 1);
  const r = saveBlockLoad(w, 3, 0xD000);
  if (r) {
    printString(w, romString02(r === 0xFF ? 0x5D7F : 0x5D77), 8, 4);
    yield* sh.advance();
    throw new Error(`02:${r === 0xFF ? "5D67" : "5D75"} DebugSaveViewer: hangs (jr $) after the save block 3 load failed`);
  }
  sh.sound(0x01);
  let b = 0;
  for (;;) {
    debugSaveViewerPage(w, b);
    for (;;) {
      yield* sh.advance();
      const a = w.high[0x191];
      if (a & 0x20) { b = (b - 1) & 0xFF; if (b & 0x80) b = 9; break; }
      if (a & 0x10) { b++; if (b >= 10) b = 0; break; }
    }
  }
}

// ---- the map graphics browser of bank 0B (unreferenced: the cases reach it by a patch of DebugMapGfxViewer 0B:4579
// into 0B:4776) ----
// 0B:4739 MapGfxBrowserInit: no scroll; wMapGfxCount $C32D = ($FF00 + the words of MapGfxTable 0B:4048 before its 0
// word) / 9 (a quirk: b is never cleared, 00:09AE), the low byte; graphics 0 loaded (0B:44C4, b = 0), InitWindowSystem
// 05:407A, 05:4492, its tile animation (0B:4900)
function* mapGfxBrowserInit(sh) {
  const w = sh.w;
  w.high[0x18A] = 0; w.high[0x18B] = 0;
  let c = 0;
  for (let p = 0x4048; rb(0x0B, p) | rb(0x0B, p + 1); p += 2) c = (c + 1) & 0xFF;
  wr(w, 0xC32D, Math.floor((0xFF00 + c) / 9) & 0xFF);
  wr(w, 0xC32E, 0);
  yield* mapLoadGfxScreen(sh, 0, 0);
  yield* inBankGen(w, 0x05, initWindowSystemW(sh));
  yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));
  mapGfxStartTileAnim(w, rd(w, 0xC32E));
}
// 0B:4826 MapBrowserDPadMove: the (dx, dy) words of DPadScrollVectorTable 0B:47E6 at (hJoyHeld >> 2) & $3C added to
// wMapScrollX $C320 / wMapScrollY $C322
function mapBrowserDPadMove(w) {
  const p = 0x47E6 + ((w.high[0x190] >> 2) & 0x3C);
  const r16 = a => rd(w, a) | rd(w, a + 1) << 8, w16 = (a, v) => { wr(w, a, v & 0xFF); wr(w, a + 1, (v >> 8) & 0xFF); };
  w16(0xC320, (r16(0xC320) + (rb(0x0B, p) | rb(0x0B, p + 1) << 8)) & 0xFFFF);
  w16(0xC322, (r16(0xC322) + (rb(0x0B, p + 2) | rb(0x0B, p + 3) << 8)) & 0xFFFF);
}
// 0B:4788 MapBrowserScroll: 0B:4826; a new map row in view: the row below ($FB, $13) or above ($FB, 0) blitted
// (00:2A8A); a new column: right ($15, $FA) or left (0, $FA) (00:2AF7); SCY / SCX from the scroll (8.8 x 8)
function mapBrowserScroll(w) {
  const y0 = rd(w, 0xC323), x0 = rd(w, 0xC321);
  mapBrowserDPadMove(w);
  const y = rd(w, 0xC323), x = rd(w, 0xC321);
  if (y !== y0) D.blitBGRowFrom64(w, 0xFB, y < y0 ? 0x00 : 0x13);
  if (x !== x0) D.blitBGColumnFrom64(w, x < x0 ? 0x00 : 0x15, 0xFA);
  w.high[0x18A] = ((y << 3) | (rd(w, 0xC322) >> 5)) & 0xFF;
  w.high[0x18B] = ((x << 3) | (rd(w, 0xC320) >> 5)) & 0xFF;
}
// 0B:4501 MapGfxBrowserPick: on B (hJoyPressed) as the debug viewer 0B:4579: the loaded id kept in $C33D, its tile
// animation stopped (0B:497D), the paged menu of ids (05:5197, (count - 1) / 4 + 1 pages; sra: signed), a choice
// loaded (0B:44C4, b = 1) and animated (0B:4900)
function* mapGfxBrowserPick(sh) {
  const w = sh.w;
  if (!(w.high[0x194] & 0x02)) return;
  const pages = ((((rd(w, 0xC32D) - 1) & 0xFF) << 24 >> 24 >> 2) + 1) & 0xFF;
  wr(w, 0xC33D, rd(w, 0xC32E));
  mapGfxStopTileAnim(w, rd(w, 0xC32E));
  const a = yield* inBankGen(w, 0x05, runPagedMenu(sh, 0x0123, pages));
  wr(w, 0xC32E, a);
  if (a === 0xFF) return;
  yield* mapLoadGfxScreen(sh, a, 1);
  mapGfxStartTileAnim(w, rd(w, 0xC32E));
}
// 0B:4776 MapGfxBrowser: 0B:4739, then every frame 0B:4788, 0B:4501. It never returns
function* mapGfxBrowser(sh) {
  yield* mapGfxBrowserInit(sh);
  for (;;) {
    mapBrowserScroll(sh.w);
    yield* mapGfxBrowserPick(sh);
    yield* sh.advance();
  }
}

// 0B:4534 DebugMapGfxQuickMenu (unreferenced): the menu text $0123 (gb_04 / gb_05 / gb_03 / gb_06) at (1, 1) (05:4BB0,
// its slot to $D82F), the shadow and windows drawn, frames while B is held, RunMenu; the choice to wMapGfxLoaded
// $C32E; the menu closed, the shadow and windows again; a choice: MapLoadGfxScreen (0B:44C4, b = 1) and the shadow
// restored
export function* debugMapGfxQuickMenu(sh) {
  const w = sh.w;
  yield* inBankGen(w, 0x05, W.openMenuWindow(sh, 0x0123, 0x01, 0x01));
  wr(w, 0xD82F, rd(w, 0xD820));
  yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));
  yield* inBankGen(w, 0x05, W.updateWindows(sh));
  do yield* sh.advance(); while (w.high[0x190] & 2);
  const a = yield* inBankGen(w, 0x05, W.runMenu05(sh));
  wr(w, 0xC32E, a);
  D.inBank(w, 0x05, () => W.closeWindow(w, rd(w, 0xD82F)));
  yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));
  yield* inBankGen(w, 0x05, W.updateWindows(sh));
  if (rd(w, 0xC32E) === 0xFF) return;
  yield* mapLoadGfxScreen(sh, rd(w, 0xC32E), 1);
  yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));
}
