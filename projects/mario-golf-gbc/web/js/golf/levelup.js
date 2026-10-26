// Bank 41: the level-up screen (REVERSE.md "The level-up screen"). LevelUpScreen 41:402A runs after the EXP screen
// when the character reached a level (AwardExpPoints 48:4D70): it counts the levels due (each a skill point), shows
// the four skills (Drive, Height, Shot, Meet Area and Control) with their values and gauges, and lets the player give
// the points one by one (A: pick a skill, A again: take it, B: back / undo the last point); with no points left a
// Yes / No box confirms (No: start over). The screen is drawn into the WRAM2 (attributes) and WRAM3 (tiles) buffers
// at $D000, 32 bytes a row, and copied to the BG map by parts (UpdateLevelUpPanels 41:51E4); the numbers are sprites.
// The WRAM bank is left as the game leaves it: several reads go to whatever bank is mapped (as the game's do).
import { rb } from "./rom.js";
import * as D from "./render/display.js";
import * as Scr from "./screen.js";
import * as T from "./text.js";
import { formatDecimalNumber } from "./render/text.js";
import { clearFrameTasks, registerFrameTask, unregisterFrameTask } from "./tasks.js";
import { initFontScreen } from "./pictures.js";
import { initWindowSystem } from "./round.js";
import { initCharSprite, charSpriteTask } from "./charsprite.js";
import { charLevelUp, charComputeStats } from "./start.js";
import { checkLevelUp } from "./exp.js";

const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
const r16 = (w, a) => rd(w, a) | rd(w, (a + 1) & 0xFFFF) << 8;
const w16 = (w, a, v) => { wr(w, a, v & 0xFF); wr(w, (a + 1) & 0xFFFF, (v >> 8) & 0xFF); };
const sext = a => (a & 0x80 ? 0xFF00 | a : a);  // 41:4D2A SignExtendAToHL
const B = 0x41;
function notPorted(what) { throw new Error(`${what} is not ported`); }
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}
// the tasks by address (RegisterFrameTask a = flags)
const TASK = { sparkle: 0x4DFC, tick: 0x50B3, charSprite: 0x5088, level: 0x4D2F, stat3: 0x4CD1, points: 0x4D79,
  skills: 0x53B8, banner: 0x5694, yesNo: 0x4328 };
const reg = (w, f, a) => registerFrameTask(w, f, B, a);
const unreg = (w, a) => unregisterFrameTask(w, B, a);

// ---- small helpers ----
const fillBytes = (w, hl, bc, d) => { for (; bc; bc--) wr(w, hl++, d); };   // 41:48E5 FillBytes_41
// 41:48ED WriteTileRun: b bytes a, a + 1, ... at hl; returns a after the run (the next call may go on from it)
function writeTileRun(w, hl, a, b) {
  do { wr(w, hl++, a); a = (a + 1) & 0xFF; } while (--b & 0xFF);
  return a;
}
const copyBytesB = (w, hl, de, b) => { do wr(w, de++, rd(w, hl++)); while (--b & 0xFF); };   // 41:537B CopyBytesB
function incIfNonzero(w, hl) { const a = rd(w, hl); if (a) wr(w, hl, (a + 1) & 0xFF); }   // 41:51DE IncIfNonzero
// 00:21F0 FormatDecimalNumber of hl in a field of `width`, to de (with its 0)
function formatTo(w, hl, width, de) {
  const s = formatDecimalNumber(hl, width);
  for (let k = 0; k < s.length; k++) wr(w, (de + k) & 0xFFFF, s[k]);
}
// 41:546A FormatTwoDigits: the byte [hl] (2-wide decimal at $D64E) -> two digit values at bc, a leading blank $FF
function formatTwoDigits(w, hl, bc) {
  setW(w, 6);
  formatTo(w, rd(w, hl), 2, 0xD64E);
  wr(w, bc, rd(w, 0xD64E) === 0x20 ? 0xFF : (rd(w, 0xD64E) - 0x30) & 0xFF);
  wr(w, bc + 1, (rd(w, 0xD64F) - 0x30) & 0xFF);
}
// 41:5497 DrawTwoDigitSprites: the digit values at bc as sprites (tile $46 + 2 d, attribute 5) at (d, e), 8 apart
function drawTwoDigitSprites(w, bc, d, e) {
  const a = rd(w, bc);
  if (a & 0x80) {
    D.queueSprite(w, e, (d + 8) & 0xFF, (2 * rd(w, bc + 1) + 0x46) & 0xFF, 5);
    return;
  }
  D.queueSprite(w, e, d, (2 * a + 0x46) & 0xFF, 5);
  D.queueSprite(w, e, (d + 8) & 0xFF, (2 * rd(w, bc + 1) + 0x46) & 0xFF, 5);
}
// 41:4D04 DrawDigitSpritesAt: a chars at hl as sprites (tile $30 + 2 (char - $30 + 1), attribute 1) from x d, 8
// apart; the y of each is e + the byte at bc, bc counting down (so each digit takes its own row offset)
function drawDigitSpritesAt(w, a, hl, bc, d, e) {
  for (; a; a--, hl++, bc--, d = (d + 8) & 0xFF)
    D.queueSprite(w, (rd(w, bc) + e) & 0xFF, d, (((rd(w, hl) - 0x30 + 1) << 1) + 0x30) & 0xFF, 1);
}

// ---- bank 02: the character record $C800 ----
// 02:4EF6 CharRefreshStats: the stats computed again at level - 1
function charRefreshStats(w) {
  const r = w.wram[0];
  r[0x812] = (r[0x812] - 1) & 0xFF;
  charComputeStats(w);
  r[0x812] = (r[0x812] + 1) & 0xFF;
}
// 02:503C CharLevelUpDiff: CharLevelUp d on a copy (the first 48 bytes kept on the stack and put back): the changes
// of the word +$1A (its low byte) and of +$1C-+$1F to hl..hl+4; hFFB0 / hFFB1 = the last address written, hFFB2 /
// hFFB3 = the stack copy's address
const LEVELUP_DIFF_SP = 0xCF56;                  // (the stack pointer there less 48, as after a round: 08:4F29 -> 48:4D70 -> 41:402A)
function charLevelUpDiff(w, d, hl) {
  const r = w.wram[0];
  const old = r.slice(0x800, 0x830);
  w.high[0x1B2] = LEVELUP_DIFF_SP & 0xFF; w.high[0x1B3] = LEVELUP_DIFF_SP >> 8;
  charLevelUp(w, d);
  wr(w, hl, ((r[0x81A] | r[0x81B] << 8) - (old[0x1A] | old[0x1B] << 8)) & 0xFF);
  for (let k = 0; k < 4; k++) wr(w, hl + 1 + k, (r[0x81C + k] - old[0x1C + k]) & 0xFF);
  const end = hl + 4;
  w.high[0x1B0] = end & 0xFF; w.high[0x1B1] = end >> 8;
  r.set(old, 0x800);
}

// ---- setting up ----
// 41:5669 ClearLevelUpBuffers: $D000-$D7FF cleared in WRAM2 and WRAM3
function clearLevelUpBuffers(w) {
  setW(w, 2); fillBytes(w, 0xD000, 0x800, 0);
  setW(w, 3); fillBytes(w, 0xD000, 0x800, 0);
}
// 41:4366 InitLevelUpVars: the cursor rows' y $D400-$D403 and the Yes / No rows' $D408 / $D409, the timers $D4A0 /
// $D4A1 (the wait before input), the banner's $D4A4-$D4A7 (its first delay from 41:6463), cursor / blink / phase
// $D630-$D632, $D4A2 / $D4A3, $D5AE
function initLevelUpVars(w) {
  setW(w, 6);
  [0x1B, 0x2B, 0x43, 0x5D, 0, 0, 0, 0, 0x24, 0x34, 0].forEach((v, k) => wr(w, 0xD400 + k, v));
  wr(w, 0xD4A0, 1); wr(w, 0xD4A1, 0x28);
  wr(w, 0xD4A4, 0); wr(w, 0xD4A5, 0x1E); wr(w, 0xD4A6, rb(B, 0x6463)); wr(w, 0xD4A7, 0);
  wr(w, 0xD630, 0); wr(w, 0xD631, 0x1F); wr(w, 0xD632, 0);
  wr(w, 0xD4A2, 0x38); wr(w, 0xD4A3, 0x40);
  wr(w, 0xD5AE, 0);
}
const SAVED = [[0x12, 0xD436], [0x20, 0xD437], [0x21, 0xD438], [0x22, 0xD439], [0x23, 0xD43A], [0x24, 0xD43B]];
// 41:48F4 CountPendingLevelUps: the level and the skill points (+$12, +$20-$24) kept at $D436-$D43B; while
// CheckLevelUp 02:546B says one is due, CharLevelUp 0 and $D435 + 1; then 41:4970
function countPendingLevelUps(w) {
  setW(w, 6);
  wr(w, 0xD435, 0);
  for (const [o, a] of SAVED) wr(w, a, rd(w, 0xC800 + o));
  wr(w, 0xD43C, 0);
  while (checkLevelUp(w)) {
    charLevelUp(w, 0);                           // 02:4FFA
    wr(w, 0xD435, (rd(w, 0xD435) + 1) & 0xFF);
  }
  restoreStatsAndHistory(w);
}
// 41:4970 RestoreStatsAndHistory: the points to give $D43C = $D435; the kept values put back; the pick history
// $D4D2 (100 bytes) and its count $D4D1 cleared, $D43F = 0; CharRefreshStats 02:4EF6
function restoreStatsAndHistory(w) {
  setW(w, 6);
  wr(w, 0xD43C, rd(w, 0xD435));
  for (const [o, a] of SAVED) wr(w, 0xC800 + o, rd(w, a));
  fillBytes(w, 0xD4D2, 0x64, 0);
  wr(w, 0xD4D1, 0);
  wr(w, 0xD43F, 0);
  charRefreshStats(w);
}
// 41:49ED LoadStatDisplayValues: (a != 0: the phase and the previews $D648-$D64C cleared first) the level word
// (+$12) to $D63C, +$1A to $D63E, the stats +$1C-+$1F to $D640-$D647 (words), the skill points +$20 +$21 +$22 +$24
// to $D453-$D456; a = 0: the level shown + 1; the level's digits to $D406 and the points left's to $D43D
function loadStatDisplayValues(w, a) {
  setW(w, 6);
  if (a) { wr(w, 0xD632, 0); for (let k = 0; k < 5; k++) wr(w, 0xD648 + k, 0); }
  w16(w, 0xD63C, r16(w, 0xC812));
  w16(w, 0xD63E, r16(w, 0xC81A));
  for (let k = 0; k < 4; k++) w16(w, 0xD640 + 2 * k, rd(w, 0xC81C + k));
  [0x20, 0x21, 0x22, 0x24].forEach((o, k) => wr(w, 0xD453 + k, rd(w, 0xC800 + o)));
  setW(w, 6);
  if (!a) wr(w, 0xD63C, (rd(w, 0xD63C) + 1) & 0xFF);
  formatTwoDigits(w, 0xD63C, 0xD406);
  formatTwoDigits(w, 0xD43C, 0xD43D);
}
// 41:43C0 LoadLevelUpSpriteGfx: OBJ palettes 9, $0F, $0D and four LZ tile sets to $8300 / $8460 / $85A0 / $82C0
// (through WRAM1 $D000); the sparkles' positions $D442-$D451 and their counter $D452
function loadLevelUpSpriteGfx(w) {
  setW(w, 1);
  D.loadPalettesMasterOnly(w, 0x5943, 0x09, 0x01);
  D.lzTo(w, B, 0x5950, 0xD000); D.queueAndRunVRAMCopy(w, 0xD000, 0x8300, 0x16);
  D.loadPalettesMasterOnly(w, 0x5B1A, 0x0F, 0x01);
  D.loadPalettesMasterOnly(w, 0x5A08, 0x0D, 0x01);
  D.lzTo(w, B, 0x5A10, 0xD000); D.queueAndRunVRAMCopy(w, 0xD000, 0x8460, 0x14);
  D.lzTo(w, B, 0x5AA7, 0xD000); D.queueAndRunVRAMCopy(w, 0xD000, 0x85A0, 0x04);
  D.lzTo(w, B, 0x5ACB, 0xD000); D.queueAndRunVRAMCopy(w, 0xD000, 0x82C0, 0x04);
  setW(w, 6);
  [0x1C, 0x2F, 0x23, 0x31, 0x23, 0x46, 0x1C, 0x48, 0x0D, 0x48, 0x07, 0x46, 0x07, 0x31, 0x0D, 0x2F, 0x00]
    .forEach((v, k) => wr(w, 0xD442 + k, v));
}
// 41:446D LoadLevelUpBgAndTilemap: the BG tiles (LZ to WRAM1 $D000-$D5xx, then to VRAM1 $9000, VRAM1 $9630, VRAM1
// $8800 and $8000), the frames and boxes of the attribute (WRAM2) and tile (WRAM3) buffers, BG palettes, and the
// highlight colours $D428-$D42F (WRAM6)
function loadLevelUpBgAndTilemap(w) {
  setW(w, 1);
  for (const [src, de] of [[0x5D80, 0xD000], [0x621A, 0xD1E0], [0x6190, 0xD2A0], [0x61D5, 0xD300], [0x625D, 0xD3C0],
    [0x6339, 0xD420], [0x5D00, 0xD4C0], [0x5D15, 0xD590]]) D.lzTo(w, B, src, de);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xB000, 0x63);
  D.lzTo(w, B, 0x62A0, 0xD000); D.lzTo(w, B, 0x62F8, 0xD080);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xB630, 0x0E);
  D.lzTo(w, B, 0x5EB0, 0xD4D0); D.queueAndRunVRAMCopy(w, 0xD4D0, 0xA800, 0x38);
  D.lzTo(w, B, 0x637D, 0xD000); D.queueAndRunVRAMCopy(w, 0xD000, 0x8000, 0x06);
  // the attributes (WRAM2)
  setW(w, 2);
  fillBytes(w, 0xD000, 0x1000, 0x01);
  for (const [hl, n] of [[0xD0D0, 3], [0xD0F0, 3], [0xD127, 3], [0xD147, 3], [0xD130, 3], [0xD150, 3], [0xD1A6, 4],
    [0xD1C6, 4], [0xD1B0, 3], [0xD1D0, 3], [0xD1E7, 3], [0xD207, 3], [0xD1F0, 3], [0xD210, 3]]) fillBytes(w, hl, n, 0x09);
  fillBytes(w, 0xD0CA, 6, 0x0B); fillBytes(w, 0xD0EA, 6, 0x0B);
  fillBytes(w, 0xD12A, 6, 0x0C); fillBytes(w, 0xD14A, 6, 0x0C);
  for (const hl of [0xD1AA, 0xD1CA, 0xD1EA, 0xD20A]) fillBytes(w, hl, 6, 0x0D);
  for (const hl of [0xD460, 0xD480, 0xD4A0, 0xD4C0]) fillBytes(w, hl, 0x0C, 0x8E);
  fillBytes(w, 0xD460, 0x0B, 0x8F);
  const box = rows => {                          // a frame's top and bottom rows (x 0 and $13, 18 between)
    for (const [hl, v] of rows) wr(w, hl, v);
  };
  box([[0xD000, 9], [0xD013, 9], [0xD220, 9], [0xD233, 9]]);
  fillBytes(w, 0xD001, 0x12, 0x09); fillBytes(w, 0xD221, 0x12, 0x09);
  for (let k = 0; k < 16; k++) wr(w, 0xD020 + 32 * k, 9);
  for (let k = 0; k < 16; k++) wr(w, 0xD033 + 32 * k, 9);
  box([[0xD240, 9], [0xD253, 9]]);
  fillBytes(w, 0xD241, 0x12, 0x09);
  box([[0xD260, 9], [0xD273, 9], [0xD280, 9], [0xD293, 9]]);
  fillBytes(w, 0xD281, 0x12, 0x09);
  box([[0xD2A0, 9], [0xD2B3, 9]]);
  fillBytes(w, 0xD2C0, 0x100, 0x00);
  // the tiles (WRAM3)
  setW(w, 3);
  fillBytes(w, 0xD000, 0x1000, 0x20);
  box([[0xD000, 0x59], [0xD013, 0x5A], [0xD220, 0x5B], [0xD233, 0x5C]]);
  fillBytes(w, 0xD001, 0x12, 0x5D); fillBytes(w, 0xD221, 0x12, 0x5E);
  for (let k = 0; k < 16; k++) wr(w, 0xD020 + 32 * k, 0x5F);
  for (let k = 0; k < 16; k++) wr(w, 0xD033 + 32 * k, 0x60);
  box([[0xD240, 0x59], [0xD253, 0x5A]]);
  fillBytes(w, 0xD241, 0x12, 0x5D);
  box([[0xD260, 0x5F], [0xD273, 0x60], [0xD280, 0x59], [0xD293, 0x5A]]);
  fillBytes(w, 0xD281, 0x12, 0x5D);
  box([[0xD2A0, 0x5F], [0xD2B3, 0x60], [0xD2C0, 0x02], [0xD2D3, 0x04], [0xD300, 0x07], [0xD313, 0x09]]);
  fillBytes(w, 0xD2C1, 0x12, 0x03); fillBytes(w, 0xD301, 0x12, 0x08);
  box([[0xD2E0, 0x05], [0xD2F3, 0x06], [0xD320, 0x02], [0xD325, 0x04], [0xD3A0, 0x07], [0xD3A5, 0x09],
    [0xD340, 0x05], [0xD360, 0x05], [0xD380, 0x05], [0xD345, 0x06], [0xD365, 0x06], [0xD385, 0x06]]);
  fillBytes(w, 0xD321, 4, 0x03); fillBytes(w, 0xD3A1, 4, 0x08);
  wr(w, 0xD090, 0x59);
  let a = writeTileRun(w, 0xD0D0, 0x1E, 3); writeTileRun(w, 0xD0F0, a, 3);
  a = writeTileRun(w, 0xD127, 0x2A, 3); writeTileRun(w, 0xD147, a, 3);
  a = writeTileRun(w, 0xD130, 0x30, 3); writeTileRun(w, 0xD150, a, 3);
  a = writeTileRun(w, 0xD1A6, 0x63, 4); writeTileRun(w, 0xD1C6, a, 4);
  a = writeTileRun(w, 0xD1B0, 0x3C, 3); writeTileRun(w, 0xD1D0, a, 3);
  a = writeTileRun(w, 0xD1E7, 0x42, 3); writeTileRun(w, 0xD207, a, 3);
  a = writeTileRun(w, 0xD1F0, 0x6B, 3); writeTileRun(w, 0xD210, a, 3);
  writeTileRun(w, 0xD460, 0x80, 0x0C);
  writeTileRun(w, 0xD480, 0x8C, 0x0C);
  writeTileRun(w, 0xD4A0, 0x98, 0x0C);
  writeTileRun(w, 0xD4C0, 0xA4, 0x0C);
  // the palettes
  D.loadPalettesMasterOnly(w, 0x5AFA, 0x0C, 0x01);
  D.loadPalettesMasterOnly(w, 0x5D71, 0x03, 0x01);
  D.loadPalettesMasterOnly(w, 0x5D71, 0x04, 0x01);
  D.loadPalettesMasterOnly(w, 0x5D71, 0x05, 0x01);
  D.loadPalettesMasterOnly(w, 0x5E92, 0x06, 0x01);
  D.loadPalettesMasterOnly(w, 0x5E9A, 0x07, 0x01);
  setW(w, 6);
  for (let k = 0; k < 8; k++) wr(w, 0xD428 + k, rb(B, 0x5D71 + k));
  wr(w, 0xD432, 0); wr(w, 0xD433, 0); wr(w, 0xD434, 0);
  wr(w, 0xD428, 0);                              // (the first colour's low byte only)
  D.loadPalettesMasterOnly(w, 0x5CED, 0x01, 0x01);
  D.loadPalettesMasterOnly(w, 0x5CED, 0x0A, 0x01);
  D.loadPalettesMasterOnly(w, 0x5CE5, 0x00, 0x01);
  D.loadPalettesMasterOnly(w, 0x5CE5, 0x08, 0x01);
}
// 41:4BAB DrawLevelUpLabels: a = 0: "Improve which skill?" (text $10DF), else the name and EXP header (~41:5598,
// not ported); then the labels $10E0-$10EA into the WRAM3 tile buffer (PrintTextToBuffer 05:62AA, rows of $20)
function* drawLevelUpLabels(sh, a) {
  const w = sh.w;
  D.inBank(w, 0x03, () => T.resetGlyphBuffer(w));   // 03:4EB8
  if (a) notPorted("the level-up header with the name and EXP (~41:5598 DrawNameAndExpHeader)");
  setW(w, 3);
  yield* inBankGen(w, 0x05, T.printTextToBuffer(sh, 0x10DF, 0xD021, 0x20));
  setW(w, 3);
  for (const [de, id] of [[0xD061, 0x10E0], [0xD066, 0x10E1], [0xD0A6, 0x10E3], [0xD106, 0x10E2], [0xD166, 0x10E4],
    [0xD187, 0x10E5], [0xD261, 0x10E7], [0xD2A1, 0x10E8], [0xD2E1, 0x10E6], [0xD342, 0x10E9], [0xD382, 0x10EA]])
    yield* inBankGen(w, 0x05, T.printTextToBuffer(sh, id, de, 0x20));
  yield* inBankGen(w, 0x03, T.uploadGlyphTiles(sh));   // 03:4F6C
}
// 41:4C4A CopyLevelUpTilemapToVRAM: $12 rows of the WRAM3 tiles to $9800 and of the WRAM2 attributes to VRAM1
// $9800, one row at a time; then the first row of each again
function copyLevelUpTilemapToVRAM(w) {
  setW(w, 3);
  for (let k = 0; k < 0x12; k++) D.queueAndRunVRAMCopy(w, 0xD000 + 32 * k, 0x9800 + 32 * k, 0x02);
  setW(w, 2);
  for (let k = 0; k < 0x12; k++) D.queueAndRunVRAMCopy(w, 0xD000 + 32 * k, 0xB800 + 32 * k, 0x02);
  setW(w, 3); D.queueAndRunVRAMCopy(w, 0xD000, 0x9800, 0x02);
  setW(w, 2); D.queueAndRunVRAMCopy(w, 0xD000, 0xB800, 0x02);
}
// 41:4CC1 FormatLevelDigits
function formatLevelDigits(w) { setW(w, 6); formatTwoDigits(w, 0xD63C, 0xD406); }

// ---- the gauges ----
// 41:506F ClearStatGauge: tile runs $00-$05 and $0F-$14 on the gauge's two rows (+$CA / +$EA from $D000 + de)
function clearStatGauge(w, de) {
  writeTileRun(w, 0xD0CA + de, 0x00, 6);
  writeTileRun(w, 0xD0EA + de, 0x0F, 6);
}
// 41:4F71 DrawStatGauge: l = 1..4 fills right of the centre ($D0CD...), $FC..$FF left ($D0CC...); else empty
function drawStatGauge(w, l, de) {
  clearStatGauge(w, de);
  const put = (o, t) => wr(w, 0xD000 + o + de, t);
  l &= 0xFF;
  if (!(l & 0x80)) {
    if (l === 4) { put(0xCF, 0x0A); put(0xEF, 0x19); }
    if (l === 3) { put(0xCF, 0x09); put(0xEF, 0x18); }
    if (l === 4 || l === 3) { put(0xCE, 0x08); put(0xEE, 0x17); }
    if (l === 2) { put(0xCE, 0x07); put(0xEE, 0x16); }
    if (l >= 1 && l <= 4) { put(0xCD, 0x06); put(0xED, 0x15); }
    return;
  }
  if (l === 0xFC) { put(0xCA, 0x0E); put(0xEA, 0x1D); }
  if (l === 0xFC || l === 0xFD) { put(0xCB, 0x0D); put(0xEB, 0x1C); }
  if (l === 0xFE) { put(0xCB, 0x0C); put(0xEB, 0x1B); }
  put(0xCC, 0x0B); put(0xEC, 0x1A);
}
// 41:4ECE / 4E94 / 4F08 / 4F42 DrawStatGaugeRow0-3: the stat (+ its preview change unless phase 0) as a gauge
// (WRAM3), rows 0-2 queued to the BG map
function drawStatGaugeRow(w, n) {
  const [val, dl, de, q] = [[0xD640, 0xD649, 0x000, [0xD0C0, 0x98C0, 4]], [0xD642, 0xD64A, 0x060, [0xD120, 0x9920, 4]],
    [0xD644, 0xD64B, 0x0E0, [0xD1A2, 0x99A2, 8]], [0xD646, 0xD64C, 0x120, null]][n];
  setW(w, 6);
  let hl = r16(w, val);
  if (rd(w, 0xD632)) hl = (hl + sext(rd(w, dl))) & 0xFFFF;
  setW(w, 3);
  drawStatGauge(w, hl & 0xFF, de);
  if (q) D.queueVRAMCopy(w, q[0], q[1], q[2]);
  setW(w, 6);
}
// 41:508C RefreshStatGauges: in phases 1 and 3 the changes skill [$D630] would bring (CharLevelUpDiff 02:503C) to
// $D648-$D64C; the four gauges
function refreshStatGauges(w) {
  setW(w, 6);
  const ph = rd(w, 0xD632);
  if (ph && ph !== 2) charLevelUpDiff(w, rd(w, 0xD630), 0xD648);
  drawStatGaugeRow(w, 1);
  drawStatGaugeRow(w, 0);
  drawStatGaugeRow(w, 2);
  drawStatGaugeRow(w, 3);
}

// ---- the panels and palettes ----
// 41:51E4 UpdateLevelUpPanels: by phase: 4 (back to 0): the top rows and rows 2-7 of the buffers ($D240 + $D040...)
// to the BG map's first 8 rows; 3: the same with the "Moving up a level!" box ($D280); 2: the Yes / No box ($D2C0,
// with the labels' rows 3-7 columns 6-$14 copied into it); 1: the prompt row ($D000); 0: the top frame ($D240)
function updateLevelUpPanels(w) {
  setW(w, 6);
  const ph = rd(w, 0xD632);
  const top8 = (b, src, vram) => {
    setW(w, b);
    copyBytesB(w, 0xD040, 0xD400, 0xC0);
    copyBytesB(w, src, 0xD3C0, 0x40);
    D.queueVRAMCopy(w, 0xD3C0, vram, 0x10);
  };
  const box = (b, vram) => {
    setW(w, b);
    for (let k = 0; k < 5; k++) copyBytesB(w, 0xD066 + 32 * k, 0xD326 + 32 * k, 0x0F);
    D.queueVRAMCopy(w, 0xD2C0, vram, 0x10);
  };
  if (ph === 4) {
    wr(w, 0xD632, 0);
    top8(2, 0xD240, 0xB800); top8(3, 0xD240, 0x9800);
  } else if (ph === 3) {
    top8(2, 0xD280, 0xB800); top8(3, 0xD280, 0x9800);
  } else if (ph === 2) {
    box(3, 0x9800); box(2, 0xB800);
  } else if (ph === 1) {
    setW(w, 2); D.queueVRAMCopy(w, 0xD000, 0xB800, 0x04);
    setW(w, 3); D.queueVRAMCopy(w, 0xD000, 0x9800, 0x04);
  } else {
    setW(w, 2); D.queueVRAMCopy(w, 0xD240, 0xB800, 0x04);
    setW(w, 3); D.queueVRAMCopy(w, 0xD240, 0x9800, 0x04);
  }
}
// 41:5383 HighlightSkillRow: skill [$D630] 1-3: its row's palette (3-5) back to 41:5D71; 0: $D432-$D434 cleared
function highlightSkillRow(w) {
  setW(w, 6);
  const s = rd(w, 0xD630);
  if (s >= 1 && s <= 3) D.loadPalettesImmediate(w, 0x5D71, 2 + s, 0x01);
  else { wr(w, 0xD432, 0); wr(w, 0xD433, 0); wr(w, 0xD434, 0); }
}
// 41:50D2 CycleSkillHighlightPalette: phase 1: the next colour of 41:6486 ($D430, 64 steps) as the palette $D428's
// second colour ($D42E; the others $02C7 $7FFF $003F), loaded for the selected skill's row (palettes 3-5; skill 0, the
// first row, has none: its digits jump instead, $D432-$D434 set to $FC at frames $0F / $0A / $05 of 32 and counted
// back to 0)
function cycleSkillHighlightPalette(w) {
  setW(w, 6);
  if (rd(w, 0xD632) !== 1) return;
  const i = rd(w, 0xD430);
  const p = (0x6486 + ((2 * i) & 0xFF)) & 0xFFFF;
  wr(w, 0xD42E, rb(B, p)); wr(w, 0xD42F, rb(B, p + 1));
  wr(w, 0xD430, (i + 1) & 0x3F);
  [0xC7, 0x02, 0xFF, 0x7F, 0x3F, 0x00].forEach((v, k) => wr(w, 0xD428 + k, v));
  const clear = () => { wr(w, 0xD432, 0); wr(w, 0xD433, 0); wr(w, 0xD434, 0); };
  const s = rd(w, 0xD630);
  if (s === 3) {
    clear();
    D.loadPalettesImmediate(w, 0x5D71, 3, 1); D.loadPalettesImmediate(w, 0x5D71, 4, 1); D.loadPalettesImmediate(w, 0xD428, 5, 1);
  } else if (s === 2) {
    D.loadPalettesImmediate(w, 0x5D71, 3, 1); D.loadPalettesImmediate(w, 0x5D71, 5, 1); D.loadPalettesImmediate(w, 0xD428, 4, 1);
  } else if (s === 1) {
    clear();
    D.loadPalettesImmediate(w, 0x5D71, 4, 1); D.loadPalettesImmediate(w, 0x5D71, 5, 1); D.loadPalettesImmediate(w, 0xD428, 3, 1);
  } else {
    D.loadPalettesImmediate(w, 0x5D71, 3, 1); D.loadPalettesImmediate(w, 0x5D71, 4, 1); D.loadPalettesImmediate(w, 0x5D71, 5, 1);
    const f = w.wram[0][0x4B2] & 0x1F;
    if (f === 0x0F) wr(w, 0xD432, 0xFC);
    else if (f === 0x0A) wr(w, 0xD433, 0xFC);
    else if (f === 0x05) wr(w, 0xD434, 0xFC);
    else { incIfNonzero(w, 0xD432); incIfNonzero(w, 0xD433); incIfNonzero(w, 0xD434); }
  }
}

// ---- the frame tasks ----
// 41:4357 TickCursorBlink
function tickCursorBlink(w) { setW(w, 6); wr(w, 0xD631, (rd(w, 0xD631) - 1) & 0x1F); }
// 41:42FA DrawSkillCursorTask: phase 1: the cursor (tile $30, attribute 4) at x $28, y [$D400 + skill] while the
// blink [$D631] >= $10
function drawSkillCursorTask(w) {
  setW(w, 6);
  if (rd(w, 0xD632) !== 1) return;
  if (rd(w, 0xD631) >= 0x10) D.queueSprite(w, rd(w, 0xD400 + rd(w, 0xD630)), 0x28, 0x30, 0x04);
  tickCursorBlink(w);
}
// 41:4328 DrawYesNoCursorTask: phase 2: the cursor (attribute 2) at x $0A, y [$D408 + [$D40A]]
function drawYesNoCursorTask(w) {
  setW(w, 6);
  if (rd(w, 0xD632) !== 2) return;
  if (rd(w, 0xD631) >= 0x10) D.queueSprite(w, rd(w, 0xD408 + rd(w, 0xD40A)), 0x0A, 0x30, 0x02);
  tickCursorBlink(w);
}
// 41:4CD1 DrawStatValueSprite3: the value [$D63E] (+ the preview change [$D648] unless phase 0) as 3 digit sprites
// at x $6B, y $1E + [$D434], [$D433], [$D432] (a blank's tile is drawn too)
function drawStatValueSprite3(w) {
  setW(w, 6);
  let hl = r16(w, 0xD63E);
  if (rd(w, 0xD632)) hl = (hl + sext(rd(w, 0xD648))) & 0xFFFF;
  formatTo(w, hl, 3, 0xD64E);
  drawDigitSpritesAt(w, 3, 0xD64E, 0xD434, 0x6B, 0x1E);
}
// 41:4D2F DrawLevelSprites: the level's digits $D406 / $D407 (tile $30 + 2 (d + 1), attribute 1) at y $26, x $10 /
// $18 (one digit: x $14), and the template 41:63BE at ($38, $30) attribute 2
function drawLevelSprites(w) {
  setW(w, 6);
  const t = v => (((v + 1) << 1) + 0x30) & 0xFF;
  const a = rd(w, 0xD406);
  if (a & 0x80) D.queueSprite(w, 0x26, 0x14, t(rd(w, 0xD407)), 1);
  else { D.queueSprite(w, 0x26, 0x10, t(a), 1); D.queueSprite(w, 0x26, 0x18, t(rd(w, 0xD407)), 1); }
  D.queueSpriteTemplate(w, 0x63BE, 0x30, 0x38, 0x00, 0x02);
}
// 41:4D79 PointsBounceTask: once the banner is out ($D4A4): the points left's digits $D43D / $D43E (tile $46 + 2 d,
// attribute 5) and the tiles $5A / $5C at y $40 + [$D43F], which jumps 3 px every 32 frames (cleared outside phase 0)
function pointsBounceTask(w) {
  setW(w, 6);
  if (!rd(w, 0xD4A4)) return;
  if (rd(w, 0xD632)) wr(w, 0xD43F, 0);
  const y = () => (0x40 + rd(w, 0xD43F)) & 0xFF;
  const a = rd(w, 0xD43D);
  if (a & 0x80) D.queueSprite(w, y(), 0x0C, (2 * rd(w, 0xD43E) + 0x46) & 0xFF, 5);
  else { D.queueSprite(w, y(), 0x08, (2 * a + 0x46) & 0xFF, 5); D.queueSprite(w, y(), 0x10, (2 * rd(w, 0xD43E) + 0x46) & 0xFF, 5); }
  D.queueSprite(w, y(), 0x19, 0x5A, 5);
  D.queueSprite(w, y(), 0x21, 0x5C, 5);
  if ((w.wram[0][0x4B2] & 0x1F) === 0x0F) wr(w, 0xD43F, 0xFD);
  else incIfNonzero(w, 0xD43F);
}
// 41:4DFC SparkleTask: phase 0 with the banner out and the character still: frames $14-$3F of each 64 ($D452) but
// $19-$1D, eight sparkles (tiles $2C / $2E, attribute 7) at the positions $D442-$D451 (x, y)
function sparkleTask(w) {
  setW(w, 6);
  if (!rd(w, 0xD4A4) || rd(w, 0xD632) || rd(w, 0xD548)) return;
  const n = (rd(w, 0xD452) + 1) & 0x3F;
  wr(w, 0xD452, n);
  if (n < 0x14) return;
  if (n - 0x14 >= 5 && n - 0x14 <= 9) return;
  [0x2C, 0x2C, 0x2E, 0x2E, 0x2C, 0x2C, 0x2E, 0x2E].forEach((c, k) =>
    D.queueSprite(w, rd(w, 0xD443 + 2 * k), rd(w, 0xD442 + 2 * k), c, 0x07));
}
// 41:50B3 TickAnimTimer: while [$D4A0], [$D4A1] counted down; $D4A0 = 0 at 0
function tickAnimTimer(w) {
  setW(w, 6);
  if (!rd(w, 0xD4A0)) return;
  const b = (rd(w, 0xD4A1) - 1) & 0xFF;
  if (!b) wr(w, 0xD4A0, 0);
  wr(w, 0xD4A1, b);
}
// 41:53B8 DrawSkillValueSprites: outside phase 0, the four skills' points $D453-$D456 as two digits (41:546A to
// $D457 + 2 k, 41:5497) at x $8C, y $1C / $2E / $46 / $60; the selected skill blinks with its value + 1
function drawSkillValueSprites(w) {
  setW(w, 6);
  if (!rd(w, 0xD632)) return;
  [0x1C, 0x2E, 0x46, 0x60].forEach((y, k) => {
    let b = 0;
    if (rd(w, 0xD630) === k) {
      if (rd(w, 0xD631) < 0x10) return;
      b = 1;
    }
    const hl = 0xD453 + k, v = rd(w, hl);
    wr(w, hl, (v + b) & 0xFF);
    formatTwoDigits(w, hl, 0xD457 + 2 * k);
    drawTwoDigitSprites(w, 0xD457 + 2 * k, 0x8C, y);
    wr(w, hl, v);
  });
}
// 41:5726 CopyRectBothBuffers: b bytes x 4 rows (32 apart) from hl to de in WRAM2, then in WRAM3; then WRAM6
function copyRectBothBuffers(w, b, hl, de) {
  if (!b) return;
  for (let c = 0; c < 4; c++, hl += 32, de += 32) {
    setW(w, 2);
    for (let k = 0; k < b; k++) wr(w, de + k, rd(w, hl + k));
    setW(w, 3);
    for (let k = 0; k < b; k++) wr(w, de + k, rd(w, hl + k));
  }
  setW(w, 6);
}
// 41:5694 LevelUpBannerRevealTask: until $D4A4 (read in the mapped WRAM bank), every [$D4A5] frames: the banner area
// ($D0E0, 20 x 4) put back into the work rows $D4E0 and the 12-tile banner ($D460) laid over it at offset [$D4A6]
// (sliding in from the right: [$D4A7] tiles; past the left edge: the rest); the next delay from 41:6463; both
// buffers' rows queued to $98E0
function levelUpBannerRevealTask(w) {
  if (rd(w, 0xD4A4)) return;
  const n = (rd(w, 0xD4A5) - 1) & 0xFF;
  wr(w, 0xD4A5, n);
  if (n) return;
  copyRectBothBuffers(w, 0x14, 0xD0E0, 0xD4E0);
  const a = rd(w, 0xD4A6);
  let next = true;
  if (!(a & 0x80)) {
    let b = rd(w, 0xD4A7);
    if (!((0xF4 + b) & 0x80)) b = 0x0C;
    copyRectBothBuffers(w, b, 0xD460, 0xD400 | ((0xE1 + a) & 0xFF));
  } else {
    const c = (-a) & 0xFF, b = (0x0C - c) & 0xFF;
    if (!b) { wr(w, 0xD4A4, 1); next = false; }
    else copyRectBothBuffers(w, b, (0xD400 | ((0x61 + c) & 0xFF)), 0xD4E0);
  }
  if (next) {
    wr(w, 0xD4A6, (rd(w, 0xD4A6) - 1) & 0xFF);
    const t = (rd(w, 0xD4A7) + 1) & 0xFF;
    wr(w, 0xD4A7, t);
    wr(w, 0xD4A5, rb(B, 0x6463 + t));
  }
  setW(w, 3); D.queueVRAMCopy(w, 0xD4E0, 0x98E0, 0x08);
  setW(w, 2); D.queueVRAMCopy(w, 0xD4E0, 0xB8E0, 0x08);
}

export function levelUpTasks(w) {
  const k = a => `41:${a.toString(16).padStart(4, "0")}`;
  return {
    [k(TASK.sparkle)]: () => sparkleTask(w),
    [k(TASK.tick)]: () => tickAnimTimer(w),
    [k(TASK.charSprite)]: () => charSpriteTask(w),   // 41:5088 CharSpriteTask_41: farcall 42:4074
    [k(TASK.level)]: () => drawLevelSprites(w),
    [k(TASK.stat3)]: () => drawStatValueSprite3(w),
    [k(TASK.points)]: () => pointsBounceTask(w),
    [k(TASK.skills)]: () => drawSkillValueSprites(w),
    [k(TASK.banner)]: () => levelUpBannerRevealTask(w),
    [k(TASK.yesNo)]: () => drawYesNoCursorTask(w),
  };
}

// ---- the screen ----
// 41:550C UndoLastSkillPoint: B in phase 0: no history: sound $5D; else sound $5B, a point back ($D43C + 1, the
// level - 1, the last picked skill's points - 1 in the record and in $D453-$D456), CharRefreshStats, the values
function undoLastSkillPoint(sh) {
  const w = sh.w;
  setW(w, 6);
  if (!rd(w, 0xD4D1)) { sh.sound(0x5D); return; }
  sh.sound(0x5B);
  wr(w, 0xD43C, (rd(w, 0xD43C) + 1) & 0xFF);
  wr(w, 0xC812, (rd(w, 0xC812) - 1) & 0xFF);
  const a = (rd(w, 0xD4D1) - 1) & 0xFF;
  wr(w, 0xD4D1, a);
  const s = rd(w, 0xD4D2 + a);
  const [o, d] = s === 3 ? [0x24, 0xD456] : s === 2 ? [0x22, 0xD455] : s === 1 ? [0x21, 0xD454] : [0x20, 0xD453];
  wr(w, 0xC800 + o, (rd(w, 0xC800 + o) - 1) & 0xFF);
  wr(w, d, (rd(w, d) - 1) & 0xFF);
  charRefreshStats(w);
  loadStatDisplayValues(w, 0);
}
// 41:54CA LevelUpRestart: No (or B) in the Yes / No box: skill 0, Yes, phase 4; the phase-0 tasks back, the Yes / No
// cursor's off; the points given back (41:4970) and the values
function levelUpRestart(w) {
  setW(w, 6);
  wr(w, 0xD630, 0); wr(w, 0xD40A, 0); wr(w, 0xD632, 4);
  reg(w, 0x03, TASK.sparkle);
  reg(w, 0x01, TASK.points);
  reg(w, 0x01, TASK.skills);
  reg(w, 0x02, TASK.level);
  unreg(w, TASK.yesNo);
  restoreStatsAndHistory(w);
  loadStatDisplayValues(w, 0);
}
// 41:42B4 WaitLevelUpCheer: the character's animation 1 next ($D54B); up to 256 frames or until A
function* waitLevelUpCheer(sh) {
  const w = sh.w;
  setW(w, 6);
  wr(w, 0xD5A4, 0);
  wr(w, 0xD54B, 1);
  for (;;) {
    yield* sh.advance();
    if (w.high[0x194] & 1) return;
    const n = (rd(w, 0xD5A4) - 1) & 0xFF;
    wr(w, 0xD5A4, n);
    if (!n) return;
  }
}

// 41:402A LevelUpScreen
export function* levelUpScreen(sh) {
  if (!checkLevelUp(sh.w)) return;               // 02:546B
  yield* inBankGen(sh.w, B, levelUpBody(sh));
}
function* levelUpBody(sh) {
  const w = sh.w;
  clearFrameTasks(w);
  initFontScreen(w);                             // 01:41E8
  yield* inBankGen(w, 0x05, initWindowSystem(sh));   // 05:407A
  D.disableLCDSafely(w);
  w.high[0x18B] = 0; w.high[0x18A] = 0;
  w.wram[0].fill(0, 0x320, 0x324);               // wMapScrollX / Y
  if (w.vram) w.lcd.wy = 0x90;
  D.resetSprites(w);
  clearLevelUpBuffers(w);
  initLevelUpVars(w);
  countPendingLevelUps(w);
  loadStatDisplayValues(w, 0);
  loadLevelUpSpriteGfx(w);
  loadLevelUpBgAndTilemap(w);
  refreshStatGauges(w);
  D.processVRAMCopyQueue(w);
  initCharSprite(w);                             // 42:400B
  D.processVRAMCopyQueue(w);
  yield* drawLevelUpLabels(sh, 0);
  formatLevelDigits(w);
  w.wram[0][0x82D] |= 0x80;                      // wTextSpeed
  copyLevelUpTilemapToVRAM(w);
  updateLevelUpPanels(w);
  D.processVRAMCopyQueue(w);
  D.enableLCD(w);
  reg(w, 0x03, TASK.sparkle);
  reg(w, 0x04, TASK.tick);
  reg(w, 0x05, TASK.charSprite);
  reg(w, 0x02, TASK.level);
  reg(w, 0x01, TASK.stat3);
  reg(w, 0x01, TASK.points);
  reg(w, 0x01, TASK.skills);
  reg(w, 0x01, TASK.banner);
  sh.sound(0x00);
  sh.sound(0x1B);
  Scr.forceFadeIn(w, 0x10);
  yield* Scr.waitFade(sh);
  let refresh = false;
  for (;;) {
    if (refresh) {                               // 41:40DA
      refreshStatGauges(w);
      updateLevelUpPanels(w);
      refresh = false;
    }
    // 41:40E0 (the banner's flag read in the mapped bank)
    if (!rd(w, 0xD4A4)) { yield* sh.advance(); continue; }
    drawSkillCursorTask(w);
    cycleSkillHighlightPalette(w);
    yield* sh.advance();
    setW(w, 6);
    if (rd(w, 0xD4A0)) continue;
    if (w.high[0x194]) wr(w, 0xD633, w.high[0x194]);
    if (rd(w, 0xD551) || rd(w, 0xD548)) continue;
    setW(w, 6);
    const p = rd(w, 0xD633);
    const ph = () => rd(w, 0xD632);
    if (p & 0xC0) {                              // up / down
      const dir = p & 0x40 ? -1 : 1;
      wr(w, 0xD633, 0);
      if (ph() === 2) {
        sh.sound(0x5B);
        wr(w, 0xD40A, (rd(w, 0xD40A) + dir) & 1);
        wr(w, 0xD631, 0x1F);
      } else if (ph() === 1) {
        sh.sound(0x5B);
        wr(w, 0xD630, (rd(w, 0xD630) + dir) & 3);
        wr(w, 0xD631, 0x1F);
        refresh = true;
      }
      continue;
    }
    if (p & 0x01) {                              // A
      wr(w, 0xD633, 0);
      if (ph() === 2) {                          // 41:422E
        sh.sound(0x5C);
        if (rd(w, 0xD40A)) { levelUpRestart(w); refresh = true; continue; }
        reg(w, 0x02, TASK.level);
        yield* sh.advance();
        wr(w, 0xD632, 3);
        updateLevelUpPanels(w);
        yield* waitLevelUpCheer(sh);
        w.wram[0][0x82D] &= 0x7F;
        Scr.beginFadeOut(w, 0x10);
        yield* Scr.waitFade(sh);
        for (const a of [TASK.tick, TASK.charSprite, TASK.level, TASK.banner, TASK.stat3, TASK.yesNo]) unreg(w, a);
        initFontScreen(w);                       // 01:41E8
        yield* sh.advance();
        return;
      }
      if (ph() === 1) {                          // 41:41CD
        sh.sound(0x5C);
        charLevelUp(w, rd(w, 0xD630));           // 02:4FFA
        highlightSkillRow(w);
        setW(w, 6);
        const n = (rd(w, 0xD43C) - 1) & 0xFF;
        wr(w, 0xD43C, n);
        if (n) {
          const c = rd(w, 0xD4D1);
          wr(w, 0xD4D2 + c, rd(w, 0xD630));
          wr(w, 0xD4D1, (c + 1) & 0xFF);
          loadStatDisplayValues(w, 0);
          wr(w, 0xD632, 0);
        } else {
          wr(w, 0xD632, 2);
          for (const a of [TASK.sparkle, TASK.points, TASK.skills, TASK.level]) unreg(w, a);
          reg(w, 0x01, TASK.yesNo);
        }
        refresh = true;
        continue;
      }
      sh.sound(0x5C);
      wr(w, 0xD632, 1);
      refresh = true;
      continue;
    }
    if (p & 0x02) {                              // B
      wr(w, 0xD633, 0);
      if (ph() === 2) { sh.sound(0x5D); levelUpRestart(w); }
      else if (ph() === 1) { sh.sound(0x5D); wr(w, 0xD632, 0); highlightSkillRow(w); }
      else undoLastSkillPoint(sh);
      refresh = true;
      continue;
    }
  }
}
