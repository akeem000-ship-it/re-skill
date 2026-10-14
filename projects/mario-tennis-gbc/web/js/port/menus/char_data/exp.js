// The story's EXP distribution after a match (bank $1D): the pool of EXP won is shared out between the two characters
// on the EXP screen (its input loop, RunExpDistributionLoop, and its frame tasks are bank $1D's exp/ code), then each
// character with a level-up waiting gets bank $1C's character-data screen to spend its points; B there goes back to
// the EXP screen, as it was.
// Port of the code of src/engine/menus/char_data/page_patches_1d.asm of the gerbiljames/mario-tennis-gbc-disasm
// (MIT, third_party/mario-tennis-gbc-disasm); names and addresses are its own. Tables, maps and graphics are read
// from the ROM.
//
// The EXP screen's state (WRAM 6): wExpPoolRemaining / Total, and per character (wExpScreenCharStats + 0 main, + 15
// partner): +0 the level shown (level + 1), +1 the EXP its level needs, +3 its bar (0-64), +4 the progress in it,
// +6 the EXP given now, +8 the EXP to the next level, +12 the EXP before (3 bytes, put back when the screen is
// left with B).
import {
  rd, wr, u8, w8, rd16, wr16, idx, rom, romWait, FAR, far, farGen, WRAM_STAGING, WRAM_COURT_PLANES, WRAM_SCREEN,
  WRAM_SCENE, TILEMAP_WIDTH, VRAM_BANK1, vTiles0, wDecompBuffer, wCharDataScreenCell, BGM_EXP_DISTRIBUTION,
  storyField, sound, advanceFrame, fadeIn, fadeOut, registerFrameTask, unregisterFrameTask, queueVRAMCopy,
  formatDecimalNumberUnsigned, disableLCDSafely, resetScrollAndCamera, hook, hookGen,
} from "../char_select/defs.js";
import { enableLCD } from "../../home/system.js";
import { clearFrameTasks } from "../../home/debugtext.js";
import { clearSpriteQueue } from "../../home/fade.js";
import { decompressData } from "../../home/decompress.js";
import { loadPaletteShadow } from "../../home/palettes.js";
import { pop as popStack } from "../../home/cpu.js";
import { charDataScreenShow, charDataScreenWriteStatNumber, backupCharData, restoreCharData,
  loadCharDataScreenGraphics, copyWram1To } from "./screen.js";
import { scaleValueToBar, queueScreenMaps } from "./confirm.js";
import { F } from "./patches.js";

export const BANK = 0x1D;
const BANK_SCREEN = 0x1C;
const rWY = 0xFF4A;
// the EXP screen's own code (src/engine/menus/exp, bank $1D)
const RunExpDistributionLoop = [0x1D, 0x6F3E], UpdateExpScreenSelectionPalettes = [0x1D, 0x7189];
const DrawExpToNextLevelTask = 0x765E, DrawExpCharCursorTask = 0x7727, DrawExpBarFillMarkersTask = 0x7760;
const DrawExpBarSweepSpriteTask = 0x7789;
const ExpBarFillTiles_1d = 0x6F35, ExpPoolGaugeTilePairTable = 0x6B69;
const ExpDistributionScreenPatchTilemap = 0x7822, ExpDistributionScreenPatchAttrmap = 0x7851;
const ExpDistributionScreenPalettes = 0x788F;
// the screen's tiles: [compressed tiles, VRAM bank 1 address, 16-byte blocks], in two runs around the palettes
const EXP_TILES_A = [[0x7876, vTiles0 + 0x16 * 16, 0x02], [0x79C1, vTiles0 + 0x18 * 16, 0x14], [0x7A63, vTiles0 + 0x2C * 16, 0x18],
  [0x7B8A, vTiles0 + 0x44 * 16, 0x18]];                              // ExpDistributionScreenGfx7, 2, 3, 4
const EXP_TILES_B = [[0x78A7, vTiles0, 0x0C], [0x7949, vTiles0 + 0x0C * 16, 0x04], [0x7983, vTiles0 + 0x10 * 16, 0x06]];   // Gfx8, 0, 1
const EXP_PATCH_SIZE = 0x30;
const LEVEL_CAP_SHOWN = 0x64;                                        // level + 1 = 100: "MAX"
// the stats' offsets (wExpScreenCharStats + 15 * slot + ...)
const S = { LEVEL: 0, NEEDED: 1, BAR: 3, PROGRESS: 4, GIVEN: 6, TO_NEXT: 8, EXP: 12 };
const PARTNER = 15;
const stat = (P, off, slot = 0) => (P.A.expScreenCharStats + slot * PARTNER + off) & 0xFFFF;
const record = (P, off) => storyField(rd(P, "storyCharacterSlot"), off);
// map cells (the screen's map in WRAM 3 / 2 at $D000; the ROM names some of them after the WRAM 6 variables at the
// same addresses)
const cell = (row, col) => wCharDataScreenCell + row * TILEMAP_WIDTH + col;
const NAME_CELLS = [cell(7, 12), cell(16, 12)];                       // wCharDataChoiceBackup + 47, ...Cell + 16 * 32 + 12
const LEVEL_NUMBER_CELLS = [cell(3, 11), cell(12, 11)];               // wCharDataChoiceLog + 65, ...Cell + 12 * 32 + 11
const LEVEL_DIGIT_CELLS = [cell(4, 17), cell(13, 17)];
const LEVEL_BAR_CELLS = [cell(1, 7), cell(10, 7)];                    // wCharDataRevealStep, wCharDataValuesSlideX
const POOL_DIGITS_CELL = cell(16, 1), POOL_GAUGE_CELL = cell(11, 1);  // the gauge from its bottom: wExpScreenCharStats
// the return addresses of InitExpScreenCharStats' calls of WriteExpScreenStringTiles (what its slip pops)
const NAME_CALL_RETURNS = [[0x6BA9, 0x6C4A], [0x6CED, 0x6D3C]];

// ---- the flow ----
// RunExpDistributionFlow (1D:682C): EXP pool hl shared out; then the character-data screens of the characters with a
// level-up (the partner's after the main character's confirmed); B on one goes back to the EXP screen with the EXP
// as before it (and the screens only showing), B on the partner's screen back to the main character's.
// Returns a = the last screen's result - 1.
export function* runExpDistributionFlow(P, hl) {
  P.wramBank(WRAM_SCENE);
  wr(P, "charDataViewOnly", 0);
  const show = function* (slot) { return (yield* farGen(P, BANK_SCREEN, charDataScreenShow(P, slot))).a; };
  for (;;) {
    yield* showExpDistributionScreen(P, hl);
    P.wramBank(WRAM_SCENE);
    rom(P, FAR.AddPlayerExp, { a: 0, de: P.bus.u16(stat(P, S.GIVEN)), hl: stat(P, S.GIVEN + 1) });
    rom(P, FAR.AddPlayerExp, { a: 1, de: P.bus.u16(stat(P, S.GIVEN, 1)), hl: stat(P, S.GIVEN + 1, 1) });
    for (;;) {                                                       // .loopB
      const main = yield* show(0);
      if (main === 1) break;
      if (main === 0) {
        far(P, BANK_SCREEN, () => backupCharData(P));
        if ((yield* show(1)) === 1) { far(P, BANK_SCREEN, () => restoreCharData(P)); continue; }
      }
      const partner = yield* show(1);                                 // .countLeft
      if (partner === 1) break;
      return { a: (partner - 1) & 0xFF };
    }
    // .loop2: B on a screen: the EXP as it was, the EXP screen again, only showing
    P.wramBank(WRAM_SCENE);
    for (let i = 0; i < 3; i++) {
      w8(P, P.A.storyMainCharExp + i, u8(P, stat(P, S.EXP + i)));
      w8(P, P.A.storyPartnerCharExp + i, u8(P, stat(P, S.EXP + i, 1)));
    }
    hl = stat(P, S.EXP + 2, 1);
    wr(P, "charDataViewOnly", 1);
  }
}
// ShowExpDistributionScreen (1D:68A3): the EXP screen for pool hl (unless only showing), run by RunExpDistributionLoop
export function* showExpDistributionScreen(P, hl) {
  sound(P, BGM_EXP_DISTRIBUTION);
  clearFrameTasks(P);
  disableLCDSafely(P);
  resetScrollAndCamera(P);
  P.bus.w8(rWY, 0x90);
  clearSpriteQueue(P);
  initLevelUpScreenState(P, hl);
  far(P, BANK_SCREEN, () => loadCharDataScreenGraphics(P));
  buildExpDistributionScreen(P);
  enableLCD(P);
  yield* advanceFrame(P);
  registerFrameTask(P, 4, DrawExpCharCursorTask);
  registerFrameTask(P, 4, DrawExpBarFillMarkersTask);
  registerFrameTask(P, 1, DrawExpBarSweepSpriteTask);
  registerFrameTask(P, 8, DrawExpToNextLevelTask);
  wr(P, "storyCharacterSlot", 0);
  yield* fadeIn(P, 16);
  P.wramBank(WRAM_SCENE);
  wr(P, "storyCharacterSlot", 0);
  rom(P, UpdateExpScreenSelectionPalettes);
  yield* advanceFrame(P);
  yield* romWait(P, RunExpDistributionLoop);
  yield* fadeOut(P, 16);
  unregisterFrameTask(P, DrawExpCharCursorTask);
  unregisterFrameTask(P, DrawExpBarFillMarkersTask);
  unregisterFrameTask(P, DrawExpBarSweepSpriteTask);
  unregisterFrameTask(P, DrawExpToNextLevelTask);
}
// InitLevelUpScreenState (1D:6934): unless only showing, the pool (hl) and nothing given yet, the input's repeat
// reset; the cursor on the main character, the bar marker off the screen
export function initLevelUpScreenState(P, hl) {
  P.wramBank(WRAM_SCENE);
  if (!rd(P, "charDataViewOnly")) {
    wr16(P, "expPoolRemaining", hl); wr16(P, "expPoolTotal", hl);
    P.bus.w16(stat(P, S.GIVEN), 0); P.bus.w16(stat(P, S.GIVEN, 1), 0);
    wr(P, "expLevelUpFanfare", 0); wr(P, "expInputRepeating", 0); wr(P, "expRepeatDelay", 8);
  }
  wr(P, "expCursorChar", 0); wr(P, "expCursorSlide", 0); wr(P, "expRedrawPending", 0);
  wr(P, "expBarMarkerX", 0xA8);
}
// BuildExpDistributionScreen (1D:6977): the pool's readout and gauge, both characters' names, levels and bars, the
// screen's map patch, tiles and OBJ palettes 6-7, all queued
export function buildExpDistributionScreen(P) {
  drawExpPoolReadout(P);
  initExpScreenCharStats(P);
  for (const slot of [0, 1]) {
    wr(P, "storyCharacterSlot", slot);
    drawExpScreenLevelNumber(P);
    drawExpScreenLevelBar(P);
  }
  const at = wDecompBuffer + 18 * TILEMAP_WIDTH;
  P.wramBank(WRAM_STAGING);
  decompressData(P, ExpDistributionScreenPatchTilemap, at);
  copyWram1ToWram3ExpScreen(P, at, EXP_PATCH_SIZE);
  P.wramBank(WRAM_STAGING);
  decompressData(P, ExpDistributionScreenPatchAttrmap, at);
  copyWram1ToWram2ExpScreen(P, at, EXP_PATCH_SIZE);
  for (const tiles of EXP_TILES_A) loadTiles(P, tiles);
  loadPaletteShadow(P, ExpDistributionScreenPalettes, 8 + 6, 2);
  for (const tiles of EXP_TILES_B) loadTiles(P, tiles);
  queueScreenMaps(P);
}
function loadTiles(P, [gfx, dest, blocks]) {
  P.wramBank(WRAM_STAGING);
  decompressData(P, gfx, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, dest + VRAM_BANK1, blocks);
}
// CopyWram1ToWram3ExpScreen (1D:6AA4) / CopyWram1ToWram2ExpScreen (1D:6AB9): as bank $1C's CopyWram1ToWram3 / 2
export const copyWram1ToWram3ExpScreen = (P, hl, bc) => copyWram1To(P, WRAM_SCREEN, hl, bc);
export const copyWram1ToWram2ExpScreen = (P, hl, bc) => copyWram1To(P, WRAM_COURT_PLANES, hl, bc);

// ---- the pool ----
// DrawExpPoolReadout (1D:6ACE): the pool left as five digits, and its gauge
export function drawExpPoolReadout(P, c = 0) {
  P.wramBank(WRAM_SCENE);
  formatDecimalNumberUnsigned(P, rd16(P, "expPoolRemaining"), 5, P.A.charDataNumberBuffer);
  writeExpScreenStringTiles(P, P.A.charDataNumberBuffer, POOL_DIGITS_CELL, c, noSlip);
  drawExpPoolGauge(P);
}
// DrawExpPoolGauge (1D:6AEF): the pool's vertical gauge (11 cells upward from row 11, two tiles wide, 8 pixels a
// cell): remaining / total of $58 pixels (both halved when the total is $8000 or more). `slip`: see ScaleValueToBar.
export function drawExpPoolGauge(P, pop = () => 0x6B12) {
  P.wramBank(WRAM_SCENE);
  let value = rd16(P, "expPoolRemaining"), total = rd16(P, "expPoolTotal");
  if (total & 0x8000) { total >>= 1; value >>= 1; }
  const r = scaleValueToBar(P, total, value, 0x58, pop);
  if (r.slip) return r;
  let b = r.a, de = POOL_GAUGE_CELL;
  P.wramBank(WRAM_SCREEN);
  const put = hl => { w8(P, de, u8(P, hl)); w8(P, de + 1, u8(P, hl + 1)); };
  let full = true;                                                  // .loop, then .loopB once below 8
  for (let c = 0x0B; ; ) {
    if (full && b >= 8) { b -= 8; put(idx(ExpPoolGaugeTilePairTable, 16)); }
    else if (full) { full = false; put(idx(ExpPoolGaugeTilePairTable, rlca(b))); }
    else put(ExpPoolGaugeTilePairTable);
    c = (c - 1) & 0xFF;
    if (!c) return { a: b };
    de = expGaugePtrUpOneRow(de);
  }
}
// ExpGaugePtrUpOneRow (1D:6B60): de one row up
export const expGaugePtrUpOneRow = de => (de - TILEMAP_WIDTH) & 0xFFFF;
const rlca = a => ((a << 1) | (a >> 7)) & 0xFF;

// ---- the characters ----
// InitExpScreenCharStats (1D:6B7B): both characters' names and levels on the screen; unless only showing, their
// levels (+ 1), the EXP their levels need, the progress, the EXP to the next level and the EXP now noted.
// Returns slip when a name's diacritic slip left it early (see WriteExpScreenStringTiles).
export function initExpScreenCharStats(P) {
  P.wramBank(WRAM_SCENE);
  const viewOnly = rd(P, "charDataViewOnly") ? 1 : 0;
  for (const slot of [0, 1]) {
    wr(P, "storyCharacterSlot", slot);
    let slipped = false;
    const pop = () => { if (slipped) throw new Error("WriteExpScreenStringTiles: a second diacritic slip (the ROM unwinds two frames)"); slipped = true; return NAME_CALL_RETURNS[viewOnly][slot]; };
    writeExpScreenStringTiles(P, record(P, 0), NAME_CELLS[slot], 0x20, pop);
    if (slipped) return { slip: true };
    P.wramBank(WRAM_SCENE);
    const level = u8(P, record(P, F.LEVEL));
    if (!viewOnly) w8(P, stat(P, S.LEVEL, slot), level + 1);
    formatDecimalNumberUnsigned(P, level, 2, P.A.charDataNumberBuffer);
    far(P, BANK_SCREEN, () => charDataScreenWriteStatNumber(P, LEVEL_NUMBER_CELLS[slot]));
    if (viewOnly) continue;
    P.wramBank(WRAM_SCENE);
    const needed = rom(P, FAR.GetExpRequiredForLevel, { a: level }).hl;
    P.bus.w16(stat(P, S.NEEDED, slot), needed);
    P.bus.w16(stat(P, S.PROGRESS, slot), rom(P, FAR.GetExpProgressInCurrentLevel, { a: slot }).hl);
    const toNext = rom(P, FAR.GetExpRemainingToNextLevel, { a: slot }).hl;
    P.bus.w16(stat(P, S.TO_NEXT, slot), toNext);
    for (let i = 0; i < 3; i++) w8(P, stat(P, S.EXP + i, slot), u8(P, record(P, F.EXP + i)));
  }
  return {};
}
// WriteExpScreenStringTiles (1D:6D6A): the 0-terminated string at hl (read with WRAM 6 mapped) into the maps at de, a
// letter a cell (attribute 0). A diacritic ($DE, $DF) goes to the cell above the letter before it (de - 33): where
// that cell is the box's blank ($73 or $8F), the stat-label form (tile - $7E, attribute $0F; the partner: + 2,
// attribute $0C); elsewhere as itself with attribute c, and there the ROM pops one word more than it pushed (its
// slip): bc = pop() (the caller's return address: the routine then returns from its caller). Back down: de + 33.
const noSlip = () => { throw new Error("WriteExpScreenStringTiles: a diacritic in a number"); };
// Returns hl after the terminator and de (with b and c after a slip).
export function writeExpScreenStringTiles(P, hl, de, c, pop) {
  let b = 0, slipped = false;
  for (;;) {
    P.wramBank(WRAM_SCENE);
    const ch = u8(P, hl);
    hl = (hl + 1) & 0xFFFF;
    if (!ch) return slipped ? { hl, de, b, c } : { hl, de };
    if (ch !== 0xDE && ch !== 0xDF) {
      b = ch;
      P.wramBank(WRAM_SCREEN); w8(P, de, ch);
      P.wramBank(WRAM_COURT_PLANES); w8(P, de, 0);
      de = (de + 1) & 0xFFFF;
      continue;
    }
    de = expScreenTilePtrUpOneRow(de);
    b = ch;
    P.wramBank(WRAM_SCREEN);
    const above = u8(P, de);
    if (above === 0x73 || above === 0x8F) {                          // .statLabel (b and c pushed)
      let tile = (ch - 0x7E) & 0xFF, attr = 0x0F;
      if (rd(P, "storyCharacterSlot")) { tile = (tile + 2) & 0xFF; attr = 0x0C; }
      w8(P, de, tile);
      P.wramBank(WRAM_COURT_PLANES); w8(P, de, attr);
    } else {                                                          // .plainTile without the push
      w8(P, de, b);
      P.wramBank(WRAM_COURT_PLANES); w8(P, de, c);
      const bc = pop();
      b = bc >> 8; c = bc & 0xFF; slipped = true;
    }
    de = expScreenTilePtrDownOneRow(de);
  }
}
// ExpScreenTilePtrUpOneRow (1D:6DD5): de - 33 / ExpScreenTilePtrDownOneRow (1D:6DDF): de + 33
export const expScreenTilePtrUpOneRow = de => (de - 0x21) & 0xFFFF;
export const expScreenTilePtrDownOneRow = de => (de + 0x21) & 0xFFFF;
// DrawExpScreenLevelNumber (1D:6DE7): the current character's level (+ 1) in big digits (two cells tall), "MAX" at
// 100
export function drawExpScreenLevelNumber(P) {
  P.wramBank(WRAM_SCENE);
  const slot = rd(P, "storyCharacterSlot") ? 1 : 0;
  const level = u8(P, stat(P, S.LEVEL, slot));
  let de = LEVEL_DIGIT_CELLS[slot];
  clearExpScreenLevelDigits(P, de);
  if (level >= LEVEL_CAP_SHOWN) {
    P.wramBank(WRAM_SCREEN);
    let hl = (de - 2) & 0xFFFF;
    for (let i = 0; i < 4; i++) w8(P, hl + i, 0x9C + i);
    hl = idx(hl + 3, 0x1D);
    for (let i = 0; i < 4; i++) w8(P, hl + i, 0xAC + i);
    P.wramBank(WRAM_SCENE);
    return;
  }
  formatDecimalNumberUnsigned(P, level, 2, P.A.charDataNumberBuffer);
  const tens = rd(P, "charDataNumberBuffer");
  if (tens !== 0x20) drawExpScreenLevelDigit(P, tens, de);
  de = (de + 1) & 0xFFFF;
  drawExpScreenLevelDigit(P, rd(P, "charDataNumberBuffer", 1), de);
}
// DrawExpScreenLevelDigit (1D:6E51): big digit a at de: tile digit + $66, and + $10 below it
export function drawExpScreenLevelDigit(P, a, de) {
  const top = (a - 0x30 + 0x66) & 0xFF;
  P.wramBank(WRAM_SCREEN);
  w8(P, de, top);
  w8(P, idx(de, 0x20), top + 0x10);
  P.wramBank(WRAM_SCENE);
}
// ClearExpScreenLevelDigits (1D:6E74): the level's four cells left of and at de (two rows) back to "LV" and blanks
export function clearExpScreenLevelDigits(P, de) {
  P.wramBank(WRAM_SCREEN);
  let hl = (de - 2) & 0xFFFF;
  [0x64, 0x65, 0x65, 0x65].forEach((t, i) => w8(P, hl + i, t));
  hl = idx(hl + 3, 0x1D);
  [0x74, 0x75, 0x51, 0x51].forEach((t, i) => w8(P, hl + i, t));
  P.wramBank(WRAM_SCENE);
}
// DrawExpScreenLevelBar (1D:6EA2): the current character's progress bar (8 cells, 64 pixels; empty at the cap),
// its pixels noted at +3. `slip`: see ScaleValueToBar.
export function drawExpScreenLevelBar(P, pop) {
  P.wramBank(WRAM_SCENE);
  const slot = rd(P, "storyCharacterSlot") ? 1 : 0;
  let a = 0;
  if (u8(P, stat(P, S.LEVEL, slot)) < LEVEL_CAP_SHOWN) {
    const r = scaleValueToBar(P, P.bus.u16(stat(P, S.NEEDED, slot)), P.bus.u16(stat(P, S.PROGRESS, slot)), 0x40,
      pop || (() => (slot ? 0x6EF8 : 0x6ECF)));
    if (r.slip) return r;
    a = r.a;
  }
  w8(P, stat(P, S.BAR, slot), a);
  let b = a, de = LEVEL_BAR_CELLS[slot];
  P.wramBank(WRAM_SCREEN);
  for (let c = 8; ; ) {
    if (b >= 8) { b -= 8; w8(P, de, u8(P, idx(ExpBarFillTiles_1d, 8))); }
    else {
      w8(P, de, u8(P, idx(ExpBarFillTiles_1d, b)));
      for (;;) {                                                      // .loopB: the rest empty
        c = (c - 1) & 0xFF;
        if (!c) return { a: b };
        de = (de + 1) & 0xFFFF;
        w8(P, de, u8(P, ExpBarFillTiles_1d));
      }
    }
    c = (c - 1) & 0xFF;
    if (!c) return { a: b };
    de = (de + 1) & 0xFFFF;
  }
}

const slipRegs = r => (r && r.slip ? { a: r.a, bc: r.bc } : undefined);
export const HOOKS = [
  [BANK, 0x682C, hookGen((P, c) => runExpDistributionFlow(P, c.hl))],
  [BANK, 0x68A3, hookGen((P, c) => showExpDistributionScreen(P, c.hl))],
  [BANK, 0x6934, hook((P, c) => { initLevelUpScreenState(P, c.hl); })],
  [BANK, 0x6977, hook(P => { buildExpDistributionScreen(P); })],
  [BANK, 0x6AA4, hook((P, c) => ({ hl: copyWram1ToWram3ExpScreen(P, c.hl, c.bc), bc: 0 }))],
  [BANK, 0x6AB9, hook((P, c) => ({ hl: copyWram1ToWram2ExpScreen(P, c.hl, c.bc), bc: 0 }))],
  [BANK, 0x6ACE, hook((P, c) => { drawExpPoolReadout(P, c.c); })],
  [BANK, 0x6AEF, hook(P => slipRegs(drawExpPoolGauge(P)))],
  [BANK, 0x6B60, hook((P, c) => ({ de: expGaugePtrUpOneRow(c.de) }))],
  [BANK, 0x6B7B, hook(P => { initExpScreenCharStats(P); })],
  [BANK, 0x6D6A, hook((P, c) => writeExpScreenStringTiles(P, c.hl, c.de, c.c, () => popStack(P)))],
  [BANK, 0x6DD5, hook((P, c) => ({ de: expScreenTilePtrUpOneRow(c.de) }))],
  [BANK, 0x6DDF, hook((P, c) => ({ de: expScreenTilePtrDownOneRow(c.de) }))],
  [BANK, 0x6DE7, hook(P => { drawExpScreenLevelNumber(P); })],
  [BANK, 0x6E51, hook((P, c) => { drawExpScreenLevelDigit(P, c.a, c.de); })],
  [BANK, 0x6E74, hook((P, c) => { clearExpScreenLevelDigits(P, c.de); })],
  [BANK, 0x6EA2, hook(P => slipRegs(drawExpScreenLevelBar(P)))],
];
