// The character-data screen of bank $1C: a story character's four stats (spin, power, control, speed), each a page
// with its skills' values and bars. After a level-up the points are spent here (A on a stat page gives it a point,
// B takes the last one back), then confirmed ("OK? YES/NO"); with wCharDataViewOnly set the screen only shows.
// Port of src/engine/menus/char_data/screen_1c.asm, stats_1c.asm, stat_sprites_1c.asm, layout_1c.asm and the code
// of gfx_1c.asm (with src/twins/draw_confirm_selection_cursor.asm) of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm); names and addresses are its own. Tables, maps and graphics are read from
// the ROM.
//
// The screen's maps: the tiles in WRAM 3 and the attributes in WRAM 2, both at $D000 (wShadowTilemap /
// wScreenAttrmap, which the ROM also calls wCharDataScreenCell). Rows 0-17 are the screen; rows 18 and below hold
// the pieces ("bands") the screen is built from: BlitTilemapRunsFromTable copies runs of them onto the screen rows
// (tiles and attributes alike), one table per step of an animation. Rows 0-17 are backed up at $D430 (both banks)
// and restored before each step. FlushCharDataTilemaps queues the screen to VRAM in three chunks, a frame each.
// State (WRAM 6): wCharDataPage (the stat page 0-3 under the cursor, 4 none), wCharDataPointsLeft, the choices made
// (wCharDataChoiceLog / Count, to undo), wCharDataLevels / Stats / StatDeltas (what is shown), the reveal timer and
// step (the sprites' slide-in), wCharDataFlushChunk (the anim task's frame phase: 0 animates).
// Covered by the lockstep on out/port/cd_levelup.mtrec (the EXP distribution, then both characters' level-ups:
// points given, taken back, "no" then "yes"), out/port/cd_status.mtrec and the new-game recordings.
import {
  FZ, rd, wr, u8, w8, rd16, wr16, idx, rom, home, FAR, far, farGen, WRAM_STAGING, WRAM_COURT_PLANES, WRAM_SCREEN,
  WRAM_SCENE, TILEMAP_WIDTH, SCREEN_HEIGHT, VRAM_BANK1, vTiles0, vTiles1, vTiles2, vBGMap0, wDecompBuffer,
  wTextTileBuffer, wTextTileBuffer_SIZE, OAM_BANK1, PADF_A, PADF_B, PADF_START, rWY, BGM_NONE, BGM_STAT_DISTRIBUTION,
  SFX_MENU_MOVE, SFX_MENU_SELECT, SFX_MENU_CANCEL, FLAG_CHAR_DATA_START_EXITS, wStoryModeNameOfMainCharacter,
  wStorySlotData, wCharDataEditBackup_SIZE, wCharDataChoiceBackup_SIZE, sound, advanceFrame, waitFrames, fadeIn,
  fadeOut, registerFrameTask, unregisterFrameTask, queueVRAMCopy, queueSprite, copyMemoryBC, copyMemoryFast,
  formatDecimalNumberUnsigned, storyField, disableLCDSafely, resetScrollAndCamera, testGameFlag, hook, hookGen,
} from "../char_select/defs.js";
import { enableLCD } from "../../home/system.js";
import { clearFrameTasks } from "../../home/debugtext.js";
import { clearSpriteQueue } from "../../home/fade.js";
import { decompressData } from "../../home/decompress.js";
import { loadPaletteShadow } from "../../home/palettes.js";
import { charDataScreenBuildStats, charDataScreenLoadGfx, drawStatChangeArrows } from "./stat_arrows.js";
import { F } from "./patches.js";

export const BANK = 0x1C;
const BANK_STAT_ARROWS = 0x1A;
// routines and tables (bank $1C)
export const CharDataScreenAnimTask = 0x45FA, DrawStatValueSprites = 0x4E54, DrawRemainingPointsSprite = 0x5049;
export const DrawStatArrowIndicators = 0x54F2;
const CharDataScreen_DrawStatBarPtrs = 0x4558, CharDataScreen_DrawStatBarTable0 = 0x456E;
const CharDataScreen_DrawStatBarTable1 = 0x4584;
const CharDataScreen_DrawPageColumnsTable0 = 0x4E36, CharDataScreen_DrawPageColumnsTable1 = 0x4E4A;
const RadialOffsetRamps_1c = 0x4FE9;
export const CharDataPageUpTargets_1c = 0x5665, CharDataPageDownTargets_1c = 0x566A;
export const CharDataPageLeftTargets_1c = 0x566F, CharDataPageRightTargets_1c = 0x5674;
const Unused_1c_0 = 0x5679, CharDataScreenAnimTask_CharDataFlushChunkTable = 0x5699;
const CharDataScreen_LoadScreenPalette = 0x598C, CharDataScreenGfx0_1c = 0x59CC, CharDataScreenTilemap_1c = 0x6406;
const CharDataScreenAttrmap_1c = 0x6469, CharDataScreenGfx13 = 0x7080;
const CharDataScreenBgAndPalettes = 0x7541, CharDataScreenBgAndPalettes0 = 0x7581;
const CharDataScreenBgTilemap = 0x7CDF, CharDataScreenBgAttrmap = 0x7E1F;
// the maps' bands: [compressed tiles, compressed attributes, decoded size, where (in WRAM 1, then WRAM 3 / 2)]
const SCREEN_BANDS = [
  [0x6549, 0x657F, 0x32, 18 * 32], [0x65C8, 0x660B, 0x46, 20 * 32], [0x6668, 0x66A2, 0x32, 22 * 32 + 16],
  [0x66EC, 0x6734, 0x5A, 24 * 32 + 16], [0x67C5, 0x67D3, 0x09, 27 * 32 + 16],
];
const UI_PATCHES = [                                       // CharDataScreenUIPatch2, 3, 1, 0
  [0x682E, 0x6848, 0x21, 31 * 32], [0x684F, 0x686B, 0x18, 32 * 32 + 16], [0x67FE, 0x6825, 0x33, 29 * 32],
  [0x67DA, 0x67F2, 0x1E, 28 * 32],
];
const CONFIRM_PATCHES = [[0x682E, 0x6848, 0x21, 42 * 32 + 16], [0x684F, 0x686B, 0x18, 44 * 32]];   // LoadCharDataScreenTilemaps
// the run tables (BlitTilemapRunsFromTable), by band and step
const RUNS = {
  B0: [0x57B6, 0x571B, 0x570E, 0x56F9, 0x56E4, 0x56CF, 0x56B9], B1: [0x57A9, 0x5794, 0x5777, 0x575A, 0x573D, 0x5720],
  B2: [0x581C, 0x580F, 0x57FA, 0x57E5, 0x57D0, 0x57BB], B3: [0x58CB, 0x58BE, 0x58A9, 0x588C, 0x586B, 0x5846, 0x5821],
  B4: [0x58EA, 0x58DD, 0x58D0], B5: [0x5928, 0x591F, 0x5912], B6: [0x590D, 0x5904, 0x58F7], B7: [0x5943, 0x593A, 0x592D],
  B8: [0x597B, 0x596A, 0x5959, 0x5948],
};
// ...and the map rows their offsets are taken from
const ROW = { B0: 0xD000 + 18 * 32, B1: 0xD000 + 20 * 32, B2: 0xD000 + 22 * 32 + 16, B3: 0xD000 + 24 * 32 + 16,
  B4: 0xD000 + 27 * 32 + 16, B5: 0xD000 + 28 * 32, B6: 0xD000 + 29 * 32, B7: 0xD000 + 31 * 32, B8: 0xD000 + 32 * 32 + 16 };
const run = (band, step) => [RUNS[band][step - 1], ROW[band]];
const SCREEN_MAP = 0xD000, SCREEN_BACKUP = 0xD430, SCREEN_BLOCKS = SCREEN_HEIGHT * TILEMAP_WIDTH / 16;
const PAGE_NONE = 4, LEVEL_CAP = 99;
const NUM_STATS = 11;
// story record fields (wStoryModeNameOfMainCharacter + 64 * slot)
export { F };
const slotField = (P, off) => storyField(rd(P, "storyCharacterSlot"), off);
const rlca = a => ((a << 1) | (a >> 7)) & 0xFF;
const word = (P, addr) => P.rom.u16(BANK, addr);
const hasReachedNextLevelExp = (P, slot) => (rom(P, FAR.HasReachedNextLevelExp, { a: slot }).f & FZ) !== 0;

// ---- the screen ----
// CharDataScreen_Show (1C:401A): story character c's screen. Unless only shown (wCharDataViewOnly, or the START-exits
// flag), nothing happens when it has no level-up waiting (returns $FF). Returns CharDataScreen_InputLoop's result:
// 0 confirmed, 1 left with B. The WRAM bank is kept.
export function* charDataScreenShow(P, slot) {
  const bank = P.V.wramBank;
  P.wramBank(WRAM_SCENE);
  if (!rd(P, "charDataViewOnly") && !testGameFlag(P, FLAG_CHAR_DATA_START_EXITS) && !hasReachedNextLevelExp(P, slot)) {
    P.wramBank(bank);
    return { a: 0xFF };
  }
  clearFrameTasks(P);
  disableLCDSafely(P);
  resetScrollAndCamera(P);
  P.bus.w8(rWY, 0x90);
  clearSpriteQueue(P);
  charDataScreenInitState(P, slot);
  loadCharStats(P);
  charDataScreenBuildTilemap(P);
  P.wramBank(WRAM_SCENE);
  if (rd(P, "charDataViewOnly")) yield* setupCharDataScreen(P);
  else {
    enableLCD(P);
    yield* advanceFrame(P);
    registerFrameTask(P, 1, DrawStatValueSprites);
    registerFrameTask(P, 1, DrawRemainingPointsSprite);
    yield* fadeIn(P, 16);
    registerFrameTask(P, 1, CharDataScreenAnimTask);
    yield* animateCharDataStatsReveal(P);
    P.wramBank(WRAM_SCENE);
    wr(P, "charDataLevelPreview", 0);
    charDataScreenDrawPageColumns(P);
    yield* flushCharDataTilemaps(P);
    registerFrameTask(P, 1, DrawStatArrowIndicators);
  }
  const result = yield* charDataScreenInputLoop(P);
  yield* fadeOut(P, 16);
  copyMemoryFast(P, wStoryModeNameOfMainCharacter, wStorySlotData, 8);
  unregisterFrameTask(P, DrawStatValueSprites);
  unregisterFrameTask(P, DrawRemainingPointsSprite);
  unregisterFrameTask(P, CharDataScreenAnimTask);
  sound(P, BGM_NONE);
  disableLCDSafely(P);
  rom(P, FAR.LoadMenuFontGfx);
  enableLCD(P);
  yield* advanceFrame(P);
  P.wramBank(bank);
  return { a: result };
}
// CharDataScreen_InitState (1C:40FB): the screen's state for character c: page none, the reveal at its start; unless
// only shown, the pending level-ups taken now (LevelUpPlayer for each, counted as points to give) after noting the
// levels before them
export function charDataScreenInitState(P, slot) {
  P.wramBank(WRAM_SCENE);
  wr(P, "storyCharacterSlot", slot);
  for (const name of ["charDataAnimCounter", "charDataAnimSubStep", "charDataFlushChunk", "charDataRevealDone"]) wr(P, name, 0);
  wr(P, "charDataStatsSlideX", slot); wr(P, "charDataStatsSlideX", slot, 1);
  wr(P, "charDataPageArrowMode", slot + 2);
  wr(P, "charDataPage", PAGE_NONE);
  wr(P, "charDataRevealTimer", 0x0A);
  wr(P, "charDataRevealStep", 3);
  wr(P, "charDataLevelPreview", 3);
  if (rd(P, "charDataViewOnly")) return;
  wr(P, "charDataPointsWorking", 0);
  wr(P, "charDataLevel", u8(P, slotField(P, F.LEVEL)));
  for (let i = 0; i < 4; i++) {
    const v = u8(P, slotField(P, F.STAT_LEVELS + i));
    wr(P, "charDataNewLevels", v, i); wr(P, "charDataLevels", v, i);
  }
  while (hasReachedNextLevelExp(P, rd(P, "storyCharacterSlot"))) {
    rom(P, FAR.LevelUpPlayer, { a: rd(P, "storyCharacterSlot"), d: 0 });
    wr(P, "charDataPointsWorking", rd(P, "charDataPointsWorking") + 1);
  }
  writeCharStatsToDisplayBuffer(P);
}
// CharDataScreen_BuildTilemap (1C:41DC): the maps (screen, bands, UI pieces), the stats, the portrait; the screen
// rows queued to VRAM
export function charDataScreenBuildTilemap(P) {
  charDataScreenLoadUIGraphics(P);
  charDataScreenDrawStats(P);
  charDataScreenDrawPortrait(P);
  P.wramBank(WRAM_SCREEN);
  queueVRAMCopy(P, SCREEN_MAP, vBGMap0, SCREEN_BLOCKS);
  P.wramBank(WRAM_COURT_PLANES);
  queueVRAMCopy(P, SCREEN_MAP, vBGMap0 + VRAM_BANK1, SCREEN_BLOCKS);
}
// a compressed map piece and its attributes into the maps: each decompressed in WRAM 1 at `at`, then copied to the
// same address in WRAM 3 (tiles) / WRAM 2 (attributes)
function loadMapPiece(P, [tiles, attrs, size, offset]) {
  const at = SCREEN_MAP + offset;
  P.wramBank(WRAM_STAGING); decompressData(P, tiles, at); copyWram1ToWram3(P, at, size);
  P.wramBank(WRAM_STAGING); decompressData(P, attrs, at); copyWram1ToWram2(P, at, size);
}
// CharDataScreen_LoadUIGraphics (1C:4208): the screen (CharDataScreen_LoadScreen), then the UI pieces
export function charDataScreenLoadUIGraphics(P) {
  charDataScreenLoadScreen(P);
  for (const piece of UI_PATCHES) loadMapPiece(P, piece);
}
// CopyWram1ToWram3 (1C:42CC) / CopyWram1ToWram2 (1C:42E1): bc bytes at hl from WRAM 1 to the same address in WRAM
// 3 / 2 (bc = 0: 64 KB); that bank left mapped. Returns hl after them.
export const copyWram1ToWram3 = (P, hl, bc) => copyWram1To(P, WRAM_SCREEN, hl, bc);
export const copyWram1ToWram2 = (P, hl, bc) => copyWram1To(P, WRAM_COURT_PLANES, hl, bc);
export function copyWram1To(P, bank, hl, bc) {
  do {
    P.wramBank(WRAM_STAGING);
    const d = u8(P, hl);
    P.wramBank(bank);
    w8(P, hl, d);
    hl = (hl + 1) & 0xFFFF; bc = (bc - 1) & 0xFFFF;
  } while (bc);
  return hl;
}
// CharDataScreen_DrawStats (1C:42F6): the 11 skills' values (two digits) and bars (CharDataScreen_DrawStatBar) at
// their cells: stat + delta (the level-up preview). Only shown: the stats loaded first. The racket's effect noted
// (CharDataScreen_BuildStats, bank $1A).
const SKILL_CELLS = [                                      // [number cell, bar cell, bar kind]
  [18 * 32 + 17, 18 * 32 + 22, 0], [19 * 32 + 5, 19 * 32 + 10, 1], [20 * 32 + 17, 20 * 32 + 22, 0],
  [21 * 32 + 5, 21 * 32 + 10, 0], [21 * 32 + 25, 21 * 32 + 30, 1], [23 * 32 + 1, 23 * 32 + 6, 0],
  [23 * 32 + 21, 23 * 32 + 26, 1], [25 * 32 + 1, 25 * 32 + 6, 0], [25 * 32 + 21, 25 * 32 + 26, 0],
  [26 * 32 + 9, 26 * 32 + 14, 0], [26 * 32 + 29, 27 * 32 + 2, 1],
];
export function charDataScreenDrawStats(P) {
  P.wramBank(WRAM_SCENE);
  if (rd(P, "charDataViewOnly")) loadCharStats(P);
  far(P, BANK_STAT_ARROWS, () => charDataScreenBuildStats(P));
  SKILL_CELLS.forEach(([number, bar, kind], i) => {
    P.wramBank(WRAM_SCENE);
    const value = (rd(P, "charDataStats", i) + rd(P, "charDataStatDeltas", i)) & 0xFF;
    formatDecimalNumberUnsigned(P, value, 2, P.A.charDataNumberBuffer);
    charDataScreenWriteStatNumber(P, SCREEN_MAP + number);
    charDataScreenDrawStatBar(P, value, kind, SCREEN_MAP + bar);
  });
}
// CharDataScreen_WriteStatNumber (1C:44CC): wCharDataNumberBuffer's two characters into the tile map at de (WRAM 3),
// attribute 0 (WRAM 2, left mapped). Returns de at the second cell.
export function charDataScreenWriteStatNumber(P, de) {
  for (let i = 0; i < 2; i++) {
    P.wramBank(WRAM_SCENE);
    const c = rd(P, "charDataNumberBuffer", i);
    P.wramBank(WRAM_SCREEN); w8(P, de + i, c);
    P.wramBank(WRAM_COURT_PLANES); w8(P, de + i, 0);
  }
  return (de + 1) & 0xFFFF;
}
// CharDataScreen_DrawStatBar (1C:4502): a 5-cell bar for value a at de: tiles from CharDataScreen_DrawStatBarPtrs
// (kind 0) or ...Table0 (kind 1) by value, attributes from ...Table1 (WRAM 2 left mapped)
export function charDataScreenDrawStatBar(P, value, kind, de) {
  const tiles = word(P, idx(kind ? CharDataScreen_DrawStatBarTable0 : CharDataScreen_DrawStatBarPtrs, rlca(value)));
  P.wramBank(WRAM_SCREEN);
  for (let i = 0; i < 5; i++) w8(P, de + i, u8(P, tiles + i));
  P.wramBank(WRAM_COURT_PLANES);
  const attrs = word(P, idx(CharDataScreen_DrawStatBarTable1, rlca(value)));
  for (let i = 0; i < 5; i++) w8(P, de + i, u8(P, attrs + i));
}
// CharDataScreen_DrawPortrait (1C:459A): the character's palette (BG 4) and mugshot (9 tiles, in rows of 3)
export function charDataScreenDrawPortrait(P) {
  rom(P, FAR.LoadIndexedPaletteThunk, { a: u8(P, slotField(P, F.PALETTE)), de: 0x0401 });
  P.wramBank(WRAM_STAGING);
  rom(P, FAR.DecompressCharMugshot, { a: u8(P, slotField(P, F.MUGSHOT)), de: wDecompBuffer });
  for (let row = 0; row < 3; row++) queueVRAMCopy(P, wDecompBuffer + row * 3 * 16, vTiles2 + (0x20 + row * 0x10) * 16 + VRAM_BANK1, 3);
}
// CharDataScreenAnimTask (1C:45FA), a frame task: on phase 0 the next frame (of 16) of two animated tile pairs
// (Unused_1c_0 and CharDataScreenAnimTask_CharDataFlushChunkTable); the phase steps 0-2. All registers kept.
export function charDataScreenAnimTask(P) {
  const bank = P.V.wramBank;
  P.wramBank(WRAM_SCENE);
  if (!rd(P, "charDataFlushChunk")) {
    P.wramBank(WRAM_SCENE);
    const counter = (rd(P, "charDataAnimCounter") + 1) & 0xFF;
    wr(P, "charDataAnimCounter", counter);
    const frame = rlca(counter & 0x0F);
    let hl = word(P, idx(Unused_1c_0, frame));
    queueVRAMCopy(P, hl, vTiles2 + 0x2E * 16 + VRAM_BANK1, 2);
    queueVRAMCopy(P, (hl + 0x20) & 0xFFFF, vTiles2 + 0x3E * 16 + VRAM_BANK1, 2);
    hl = word(P, idx(CharDataScreenAnimTask_CharDataFlushChunkTable, frame));
    queueVRAMCopy(P, hl, vTiles2 + 0x4E * 16 + VRAM_BANK1, 2);
    queueVRAMCopy(P, (hl + 0x20) & 0xFFFF, vTiles2 + 0x5E * 16 + VRAM_BANK1, 2);
  }
  P.wramBank(WRAM_SCENE);
  const chunk = (rd(P, "charDataFlushChunk") + 1) & 0xFF;
  wr(P, "charDataFlushChunk", chunk === 3 ? 0 : chunk);
  P.wramBank(bank);
}

// ---- the reveal and the bands (stats_1c.asm) ----
// AnimateCharDataStatsReveal (1C:4682): the music, then the stat bands drawn in 7 steps with the sprites sliding in
// (wCharDataRevealTimer 9 .. 0), the page arrows mode stepped down, then the lower bands and the points box (step
// 2 .. 0)
const REVEAL_STEPS = [
  [9, ["B0", 1], ["B3", 1]],
  [7, ["B0", 2], ["B1", 1], ["B2", 1], ["B3", 2]],
  [5, ["B0", 3], ["B1", 2], ["B2", 2], ["B3", 3]],
  [3, ["B0", 4], ["B1", 3], ["B2", 3], ["B3", 4]],
  [2, ["B0", 5], ["B1", 4], ["B2", 4], ["B3", 5]],
  [1, ["B0", 6], ["B1", 5], ["B2", 5], ["B3", 6]],
  [0, ["B0", 7], ["B1", 6], ["B2", 6], ["B3", 7]],
];
export function* animateCharDataStatsReveal(P) {
  sound(P, BGM_STAT_DISTRIBUTION);
  backupCharDataScreenRow(P);
  P.wramBank(WRAM_SCENE);
  do yield* advanceFrame(P); while (rd(P, "charDataFlushChunk"));
  for (const [timer, ...runs] of REVEAL_STEPS) {
    restoreCharDataScreenRow(P);
    blitRuns(P, runs);
    P.wramBank(WRAM_SCENE);
    if (!timer) wr(P, "charDataPageArrowMode", rd(P, "charDataPageArrowMode") - 1);
    wr(P, "charDataRevealTimer", timer);
    yield* flushCharDataTilemaps(P);
  }
  yield* waitFrames(P, 6);
  for (let step = 1; step <= 3; step++) { blitRuns(P, [["B4", step]]); yield* flushCharDataTilemaps(P); }
  for (let step = 1; step <= 3; step++) {
    blitRuns(P, [["B6", step], ["B5", step]]);
    P.wramBank(WRAM_SCENE);
    wr(P, "charDataRevealStep", 3 - step);
    yield* flushCharDataTilemaps(P);
  }
}
const blitRuns = (P, runs) => { for (const [band, step] of runs) blitTilemapRunsFromTable(P, ...run(band, step)); };
// DrawCharStatsAndFlush (1C:4882): the stat rows, the points box shown (bands 6 and 5 at their last step), flushed
export function* drawCharStatsAndFlush(P) {
  drawCharStatRows(P);
  blitRuns(P, [["B6", 3], ["B5", 3]]);
  return yield* flushCharDataTilemaps(P);
}
// DrawCharStatRows (1C:489B): the stat bands at their last steps
export function drawCharStatRows(P) { blitRuns(P, [["B0", 7], ["B1", 6], ["B2", 6], ["B3", 7], ["B4", 3]]); }
// BackupCharDataScreenRow (1C:48C9) / RestoreCharDataScreenRow (1C:48EC): screen rows 0-17 of both maps to / from
// $D430 (WRAM 2 left mapped)
export function backupCharDataScreenRow(P) {
  P.wramBank(WRAM_SCREEN); copyMemoryFast(P, SCREEN_MAP, SCREEN_BACKUP, SCREEN_BLOCKS);
  P.wramBank(WRAM_COURT_PLANES); copyMemoryFast(P, SCREEN_MAP, SCREEN_BACKUP, SCREEN_BLOCKS);
}
export function restoreCharDataScreenRow(P) {
  P.wramBank(WRAM_SCREEN); copyMemoryFast(P, SCREEN_BACKUP, SCREEN_MAP, SCREEN_BLOCKS);
  P.wramBank(WRAM_COURT_PLANES); copyMemoryFast(P, SCREEN_BACKUP, SCREEN_MAP, SCREEN_BLOCKS);
}
// BlitTilemapRunsFromTable (1C:490F): the runs of table hl ([dest offset hi, lo, source offset, count], $FF-ended)
// from bc + source offset to $D000 + dest offset, in both maps (WRAM 3, then WRAM 2, a cell at a time). The source
// is kept in wCharDataNumberBuffer (WRAM 6) meanwhile, as the ROM does.
export function blitTilemapRunsFromTable(P, hl, bc) {
  for (; P.bus.u8(hl) !== 0xFF; hl = (hl + 4) & 0xFFFF) {
    let de = (SCREEN_MAP + (P.bus.u8(hl) << 8 | P.bus.u8(hl + 1))) & 0xFFFF;
    let src = (bc + P.bus.u8(hl + 2)) & 0xFFFF;
    P.wramBank(WRAM_SCENE);
    wr16(P, "charDataNumberBuffer", src);
    src = rd16(P, "charDataNumberBuffer");
    for (let c = P.bus.u8(hl + 3) || 0x100; c > 0; c--) {
      P.wramBank(WRAM_SCREEN); w8(P, de, u8(P, src));
      P.wramBank(WRAM_COURT_PLANES); w8(P, de, u8(P, src));
      src = (src + 1) & 0xFFFF; de = (de + 1) & 0xFFFF;
    }
  }
}
// FlushCharDataTilemaps (1C:495D): the screen to VRAM in three chunks, one a frame (FlushCharDataTilemapChunk ×3).
// Returns the flags of the last QueueVRAMCopy (Z when the queue was full).
export function* flushCharDataTilemaps(P) {
  let f;
  for (let i = 0; i < 3; i++) f = yield* flushCharDataTilemapChunk(P);
  return f;
}
// FlushCharDataTilemapChunk (1C:4967): the chunk for the anim task's phase (0: rows 15-17, 1: rows 7-14, 2: rows
// 0-6) of both maps queued, then a frame
const FLUSH_CHUNKS = [[15, 3], [7, 8], [0, 7]];
export function* flushCharDataTilemapChunk(P) {
  P.wramBank(WRAM_SCENE);
  const chunk = rd(P, "charDataFlushChunk");
  const [row, rows] = FLUSH_CHUNKS[chunk === 0 ? 0 : chunk === 1 ? 1 : 2];
  const at = row * TILEMAP_WIDTH, blocks = rows * TILEMAP_WIDTH / 16;
  P.wramBank(WRAM_SCREEN);
  queueVRAMCopy(P, SCREEN_MAP + at, vBGMap0 + at, blocks);
  P.wramBank(WRAM_COURT_PLANES);
  const r = queueVRAMCopy(P, SCREEN_MAP + at, vBGMap0 + at + VRAM_BANK1, blocks);
  yield* advanceFrame(P);
  return r.f;
}
// WriteCharStatsToDisplayBuffer (1C:49EB): the points to give, the record's level and stat levels back to those
// before the level-ups, the choices cleared; the record's stats recomputed (RefreshPlayerStatsAndGetPtr)
export function writeCharStatsToDisplayBuffer(P) {
  P.wramBank(WRAM_SCENE);
  wr(P, "charDataPointsLeft", rd(P, "charDataPointsWorking"));
  restoreRecordLevels(P);
  for (let i = 0; i < 0x64; i++) wr(P, "charDataChoiceLog", 0, i);
  wr(P, "charDataChoiceCount", 0);
  rom(P, FAR.RefreshPlayerStatsAndGetPtr, { a: rd(P, "storyCharacterSlot") });
}
// the record's level and stat levels from wCharDataLevel / wCharDataNewLevels (wCharDataLevels follows)
export function restoreRecordLevels(P) {
  w8(P, slotField(P, F.LEVEL), rd(P, "charDataLevel"));
  for (let i = 0; i < 4; i++) {
    const v = rd(P, "charDataNewLevels", i);
    w8(P, slotField(P, F.STAT_LEVELS + i), v);
    wr(P, "charDataLevels", v, i);
  }
}
// the record's stat levels and skills (+ 1: shown from 1) into wCharDataLevels / wCharDataStats, in the ROM's order
function readRecordStats(P) {
  const stat = (i, field) => wr(P, "charDataStats", u8(P, slotField(P, field)) + 1, i);
  const level = (i) => wr(P, "charDataLevels", u8(P, slotField(P, F.STAT_LEVELS + i)), i);
  level(0); stat(0, 0x20); stat(1, 0x21);
  level(1); stat(2, 0x22); stat(3, 0x23); stat(4, 0x24);
  level(2); stat(5, 0x25); stat(6, 0x26);
  level(3); for (let i = 7; i < NUM_STATS; i++) stat(i, 0x20 + i);
}
// LoadCharStatsWithLevelUpDeltas (1C:4A94): the stats, and for a stat page under the cursor what a point there
// would add (ComputeLevelUpStatDeltas); nothing when only shown
export function loadCharStatsWithLevelUpDeltas(P) {
  P.wramBank(WRAM_SCENE);
  if (rd(P, "charDataViewOnly")) return;
  readRecordStats(P);
  const page = rd(P, "charDataPage");
  if (page === PAGE_NONE) { for (let i = 0; i < NUM_STATS; i++) wr(P, "charDataStatDeltas", 0, i); return; }
  rom(P, FAR.ComputeLevelUpStatDeltas, { a: rd(P, "storyCharacterSlot"), d: page, hl: P.A.charDataStatDeltas });
}
// LoadCharStats (1C:4C43): the stats, no deltas
export function loadCharStats(P) {
  P.wramBank(WRAM_SCENE);
  readRecordStats(P);
  for (let i = 0; i < NUM_STATS; i++) wr(P, "charDataStatDeltas", 0, i);
}
// CharDataScreen_DrawPageColumns (1C:4DD6): the stat pages' column highlights (attributes) for wCharDataPage:
// rows of b cells from the page's data (CharDataScreen_DrawPageColumnsTable0: [dest, width, rows]; ...Table1:
// the data); on a stat page every other row also marks the two cells before its end with attribute 1
export function charDataScreenDrawPageColumns(P) {
  P.wramBank(WRAM_SCENE);
  const page = rd(P, "charDataPage"), p2 = rlca(page), p4 = rlca(p2);
  const at = idx(CharDataScreen_DrawPageColumnsTable0, p4);
  let de = P.bus.u8(at + 1) << 8 | P.bus.u8(at);
  const width = P.bus.u8(at + 3);
  let hl = word(P, idx(CharDataScreen_DrawPageColumnsTable1, p2));
  for (let c = P.bus.u8(at + 2); ; ) {
    for (let b = width || 0x100; b > 0; b--) {
      P.wramBank(WRAM_COURT_PLANES);
      w8(P, de, u8(P, hl)); hl = (hl + 1) & 0xFFFF; de = (de + 1) & 0xFFFF;
    }
    if (!(c & 1)) {
      P.wramBank(WRAM_SCENE);
      if (rd(P, "charDataPage") !== PAGE_NONE) {
        P.wramBank(WRAM_COURT_PLANES);
        w8(P, de - 3, 1); w8(P, de - 2, 1);
      }
    }
    de = ((de & 0xFF00) + (((de & 0xFF) + 0x16) & 0x100) + ((de + 0x16) & 0xFF)) & 0xFFFF;
    c = (c - 1) & 0xFF;
    if (!c) break;
  }
}

// ---- the sprites and the input (stat_sprites_1c.asm) ----
// DrawStatValueSprites (1C:4E54), a frame task: the four stat levels as digit sprites (the page under the cursor
// one more, in the highlight palette, unless the preview is off), sliding in by the reveal timer; then the racket's
// arrows (DrawStatChangeArrows, bank $1A)
const LEVEL_DIGITS = [[0x05, 0x0C, 0x09, 0x1C], [0x05, 0x0C, 0x09, 0x44], [0x55, 0x5C, 0x59, 0x1C], [0x55, 0x5C, 0x59, 0x44]];
export function drawStatValueSprites(P) {
  P.wramBank(WRAM_SCENE);
  LEVEL_DIGITS.forEach(([x1, x2, xm, y], i) => {
    let b = 0x0E, l = rd(P, "charDataLevels", i);
    if (!rd(P, "charDataLevelPreview") && rd(P, "charDataPage") === i) { l = (l + 1) & 0xFF; b = 0x0F; }
    const digit = (c, x) => { const p = getStatDigitSpritePos(P, i, x << 8 | y); queueSprite(P, b, c, p >> 8, p & 0xFF); };
    if (l >= 10) {
      formatDecimalNumberUnsigned(P, l, 2, P.A.charDataNumberBuffer);
      digit(rlca((rd(P, "charDataNumberBuffer") - 0x30) & 0xFF), x1);
      digit(rlca((rd(P, "charDataNumberBuffer", 1) - 0x30) & 0xFF), x2);
    } else digit(rlca(l), xm);
  });
  far(P, BANK_STAT_ARROWS, () => drawStatChangeArrows(P));
}
// GetStatDigitSpritePos (1C:4FCE): de moved by stat a's slide-in ramp (RadialOffsetRamps_1c) at the reveal timer
export function getStatDigitSpritePos(P, stat, de) {
  const ramp = word(P, idx(RadialOffsetRamps_1c, rlca(stat))), at = (ramp + rlca(rd(P, "charDataRevealTimer"))) & 0xFFFF;
  return (((de >> 8) + P.bus.u8(at)) & 0xFF) << 8 | (((de & 0xFF) + P.bus.u8(at + 1)) & 0xFF);
}
// DrawRemainingPointsSprite (1C:5049), a frame task: the points left as digit sprites, lowered by the reveal step
export function drawRemainingPointsSprite(P) {
  P.wramBank(WRAM_SCENE);
  const points = rd(P, "charDataPointsLeft");
  const digit = (c, x) => queueSprite(P, OAM_BANK1 | 7, c, x, offsetStatSpriteY(P, 0x7F));
  if (points >= 10) {
    formatDecimalNumberUnsigned(P, points, 2, P.A.charDataNumberBuffer);
    digit(rlca((rd(P, "charDataNumberBuffer") - 0x30) & 0xFF), 0x14);
    digit(rlca((rd(P, "charDataNumberBuffer", 1) - 0x30) & 0xFF), 0x1B);
  } else digit(rlca(points), 0x18);
}
// OffsetStatSpriteY (1C:5094): e + 8 * wCharDataRevealStep (rotated, as the ROM's three rlca)
export const offsetStatSpriteY = (P, e) => (e + rlca(rlca(rlca(rd(P, "charDataRevealStep"))))) & 0xFF;
// CharDataScreen_InputLoop (1C:509D): the level-up input: the d-pad moves between the stat pages, A gives the page a
// point (to the level cap, or until no level-up is left), B takes the last back (or leaves the page; with no choice
// made, leaves the screen: returns 1). Then the confirm box: yes returns 0, no goes back to giving points.
// (START leaves at once with FLAG_CHAR_DATA_START_EXITS; only shown: the confirm box at once.)
export function* charDataScreenInputLoop(P) {
  const startExits = () => testGameFlag(P, FLAG_CHAR_DATA_START_EXITS);
  for (;;) {
    let finish = false;
    P.wramBank(WRAM_SCENE);
    if (rd(P, "charDataViewOnly")) finish = true;
    else {
      yield* advanceFrame(P);
      const edge = P.V.inputRisingEdge;
      if (startExits() && edge & PADF_START) finish = true;
      else if (edge & PADF_B) {
        P.wramBank(WRAM_SCENE);
        if (rd(P, "charDataPage") === PAGE_NONE) {
          if (!applyCharStatLevelUp(P).a) return 1;
          yield* redraw(P);                               // (inside ApplyCharStatLevelUp)
          continue;
        }
        wr(P, "charDataPage", PAGE_NONE);
        const f = yield* redraw(P);
        if (!(f & FZ)) continue;                          // (`jp nz`: a full VRAM queue falls into the A press)
        finish = yield* pressA(P);
      } else if (edge & PADF_A) finish = yield* pressA(P);
      else {
        const table = edge & 0x10 ? CharDataPageRightTargets_1c : edge & 0x20 ? CharDataPageLeftTargets_1c
          : edge & 0x80 ? CharDataPageDownTargets_1c : edge & 0x40 ? CharDataPageUpTargets_1c : 0;
        if (table) yield* moveCharDataScreenSelection(P, table);
        continue;
      }
    }
    if (!finish) continue;
    const r = yield* confirmBox(P);
    if (r === 0) return 0;
  }
}
// the page redrawn: stats, rows, columns (RestoreCharDataScreenRow ... FlushCharDataTilemaps)
function* redraw(P, deltas = false) {
  restoreCharDataScreenRow(P);
  if (deltas) loadCharStatsWithLevelUpDeltas(P); else loadCharStats(P);
  charDataScreenDrawStats(P);
  yield* drawCharStatsAndFlush(P);
  charDataScreenDrawPageColumns(P);
  return yield* flushCharDataTilemaps(P);
}
// .pressA: a point to the page under the cursor (noted in the choice log); returns whether the points are done
function* pressA(P) {
  P.wramBank(WRAM_SCENE);
  const page = rd(P, "charDataPage");
  if (page === PAGE_NONE) return false;
  sound(P, SFX_MENU_SELECT);
  rom(P, FAR.LevelUpPlayer, { a: rd(P, "storyCharacterSlot"), d: page });
  P.wramBank(WRAM_SCENE);
  wr(P, "charDataPointsLeft", rd(P, "charDataPointsLeft") - 1);
  w8(P, 0xD02A + rd(P, "charDataChoiceCount"), rd(P, "charDataPage"));
  wr(P, "charDataChoiceCount", rd(P, "charDataChoiceCount") + 1);
  wr(P, "charDataPage", PAGE_NONE);
  if (!testGameFlag(P, FLAG_CHAR_DATA_START_EXITS)) {
    if (!hasReachedNextLevelExp(P, rd(P, "storyCharacterSlot"))) return true;
  } else if (u8(P, slotField(P, F.LEVEL)) === LEVEL_CAP) return true;
  yield* redraw(P);
  return false;
}
// .finish ... .cancel: the points box away and the confirm box in; then yes / no. Returns 0 (yes) or 1 (no: the
// editing restored and the screen back as it was)
function* confirmBox(P) {
  P.wramBank(WRAM_SCENE);
  if (rd(P, "charDataViewOnly")) wr(P, "charDataViewOnly", 0);
  else {
    unregisterFrameTask(P, DrawStatArrowIndicators);
    loadCharStats(P);
    charDataScreenDrawStats(P);
    restoreCharDataScreenRow(P); drawCharStatRows(P); blitRuns(P, [["B6", 2], ["B5", 2]]);
    P.wramBank(WRAM_SCENE);
    wr(P, "charDataRevealStep", 1); wr(P, "charDataConfirmState", 1); wr(P, "charDataLevelPreview", 1);
    yield* flushCharDataTilemaps(P);
    restoreCharDataScreenRow(P); drawCharStatRows(P); blitRuns(P, [["B6", 1], ["B5", 1]]);
    P.wramBank(WRAM_SCENE);
    wr(P, "charDataRevealStep", 2);
    yield* flushCharDataTilemaps(P);
    P.wramBank(WRAM_SCENE);
    wr(P, "charDataRevealStep", 3);
    unregisterFrameTask(P, DrawRemainingPointsSprite);
    restoreCharDataScreenRow(P); drawCharStatRows(P);
    yield* flushCharDataTilemaps(P);
    yield* wipeConfirmBox(P, [[], ["B8", 1]], [["B7", 1], ["B8", 2]], [["B7", 2], ["B8", 3]], [["B7", 3], ["B8", 4]]);
  }
  for (;;) {
    drawConfirmSelectionCursor(P);
    yield* advanceFrame(P);
    const edge = P.V.inputRisingEdge;
    if (edge & PADF_A) {
      P.wramBank(WRAM_SCENE);
      if (!rd(P, "charDataConfirmState")) { sound(P, SFX_MENU_SELECT); return 0; }
      break;
    }
    if (edge & PADF_B) break;
    if (edge & 0xC0) { sound(P, SFX_MENU_MOVE); wr(P, "charDataConfirmState", rd(P, "charDataConfirmState") ^ 1); }
  }
  // .cancel: back to giving points
  sound(P, SFX_MENU_CANCEL);
  selectCharDataConfirmSlot(P);
  restoreCharDataScreenRow(P);
  loadCharStats(P);
  charDataScreenDrawStats(P);
  drawCharStatRows(P); blitRuns(P, [["B7", 2], ["B8", 3]]);
  yield* flushCharDataTilemaps(P);
  yield* wipeConfirmBox(P, [["B7", 1], ["B8", 2]], [["B8", 1]], []);
  P.wramBank(WRAM_SCENE);
  wr(P, "charDataRevealStep", 3);
  yield* flushCharDataTilemaps(P);
  registerFrameTask(P, 1, DrawRemainingPointsSprite);
  for (const step of [1, 2]) {
    restoreCharDataScreenRow(P); drawCharStatRows(P); blitRuns(P, [["B6", step], ["B5", step]]);
    P.wramBank(WRAM_SCENE);
    wr(P, "charDataRevealStep", 3 - step);
    yield* flushCharDataTilemaps(P);
  }
  P.wramBank(WRAM_SCENE);
  wr(P, "charDataLevelPreview", 0); wr(P, "charDataRevealStep", 0);
  restoreCharDataScreenRow(P);
  yield* drawCharStatsAndFlush(P);
  charDataScreenDrawPageColumns(P);
  yield* flushCharDataTilemaps(P);
  registerFrameTask(P, 1, DrawStatArrowIndicators);
  return 1;
}
// steps of the confirm box's slide: each the rows restored, the stat rows, the runs (band 8 from the page plane), a flush
function* wipeConfirmBox(P, ...steps) {
  for (const runs of steps) {
    restoreCharDataScreenRow(P); drawCharStatRows(P);
    for (const [band, step] of runs) blitTilemapRunsFromTable(P, RUNS[band][step - 1], band === "B8" ? 0xD410 : ROW[band]);
    yield* flushCharDataTilemaps(P);
  }
}

// ---- the page moves and choices (layout_1c.asm) ----
// DrawConfirmSelectionCursor_1c (1C:53A3): the hand at YES (state 0) or NO (state 1)
export function drawConfirmSelectionCursor(P) {
  P.wramBank(WRAM_SCENE);
  queueSprite(P, OAM_BANK1 | 7, 0xD4, 0x7A, rd(P, "charDataConfirmState") ? 0x14 : 0x0C);
}
// MoveCharDataScreenSelection (1C:53C3): the page the table gives for the current one ($FF: none), redrawn (with
// the point's preview on a stat page)
export function* moveCharDataScreenSelection(P, table) {
  P.wramBank(WRAM_SCENE);
  const page = P.bus.u8(idx(table, rd(P, "charDataPage")));
  if (page === 0xFF) return;
  wr(P, "charDataPage", page);
  sound(P, SFX_MENU_MOVE);
  yield* redraw(P, page !== PAGE_NONE);
}
// ApplyCharStatLevelUp (1C:5404): take the last point back: the record back to before the level-ups, all choices but
// the last one given again, the page redrawn. Returns a = 1, or 0 when no choice was made.
export function applyCharStatLevelUp(P) {
  P.wramBank(WRAM_SCENE);
  if (!rd(P, "charDataChoiceCount")) return { a: 0, f: FZ };
  sound(P, SFX_MENU_CANCEL);
  wr(P, "charDataPointsLeft", rd(P, "charDataPointsLeft") + 1);
  restoreRecordLevels(P);
  rom(P, FAR.RefreshPlayerStatsAndGetPtr, { a: rd(P, "storyCharacterSlot") });
  for (let b = 0, c = rd(P, "charDataChoiceCount"); (c = (c - 1) & 0xFF); b++) {
    rom(P, FAR.LevelUpPlayer, { a: rd(P, "storyCharacterSlot"), d: u8(P, 0xD02A + b) });
  }
  wr(P, "charDataChoiceCount", rd(P, "charDataChoiceCount") - 1);
  wr(P, "charDataPage", PAGE_NONE);
  return { a: 1 };
}
// SelectCharDataConfirmSlot (1C:54E3): page none, the record back to before the level-ups
export function selectCharDataConfirmSlot(P) {
  P.wramBank(WRAM_SCENE);
  wr(P, "charDataPage", PAGE_NONE);
  writeCharStatsToDisplayBuffer(P);
}
// DrawStatArrowIndicators (1C:54F2), a frame task: an up or down arrow beside each skill a point would change
const ARROW_CELLS = [[0x4C, 0x24], [0x4C, 0x34], [0x4C, 0x4C], [0x4C, 0x5C], [0x4C, 0x6C], [0x9C, 0x24], [0x9C, 0x34],
  [0x9C, 0x4C], [0x9C, 0x5C], [0x9C, 0x6C], [0x9C, 0x7C]];
export function drawStatArrowIndicators(P) {
  P.wramBank(WRAM_SCENE);
  ARROW_CELLS.forEach(([x, y], i) => queueStatChangeArrow(P, rd(P, "charDataStatDeltas", i), x, y));
}
// QueueStatChangeArrow (1C:555C): for a delta a: none (0), the down arrow (negative) or the up arrow
export function queueStatChangeArrow(P, delta, x, y) {
  if (!delta) return;
  if (delta & 0x80) queueSprite(P, OAM_BANK1 | 7, 0xD2, x, y);
  else queueSprite(P, OAM_BANK1 | 6, 0xD0, x, y);
}
// SetupCharDataScreen (1C:5572): the screen when only shown: the stat rows at once, the confirm box sliding in
export function* setupCharDataScreen(P) {
  sound(P, BGM_STAT_DISTRIBUTION);
  backupCharDataScreenRow(P);
  blitRuns(P, [["B0", 7], ["B1", 6], ["B2", 6], ["B3", 7], ["B4", 3]]);
  P.wramBank(WRAM_SCENE);
  wr(P, "charDataRevealTimer", 0);
  P.wramBank(WRAM_SCREEN);
  queueVRAMCopy(P, SCREEN_MAP, vBGMap0, SCREEN_BLOCKS);
  P.wramBank(WRAM_COURT_PLANES);
  queueVRAMCopy(P, SCREEN_MAP, vBGMap0 + VRAM_BANK1, SCREEN_BLOCKS);
  P.wramBank(WRAM_SCENE);
  wr(P, "charDataRevealStep", 3); wr(P, "charDataConfirmState", 1); wr(P, "charDataLevelPreview", 1);
  enableLCD(P);
  yield* advanceFrame(P);
  registerFrameTask(P, 1, DrawStatValueSprites);
  yield* fadeIn(P, 16);
  registerFrameTask(P, 1, CharDataScreenAnimTask);
  yield* wipeConfirmBox(P, [["B8", 1]], [["B7", 1], ["B8", 2]], [["B7", 2], ["B8", 3]], [["B7", 3], ["B8", 4]]);
}

// ---- graphics (gfx_1c.asm) ----
// CharDataScreen_LoadScreen (1C:7116): the palettes (BG and OBJ), the tiles (with bank $1A's arrow tiles and the text
// tiles), the screen map and its bands
export function charDataScreenLoadScreen(P) {
  loadPaletteShadow(P, CharDataScreen_LoadScreenPalette, 0, 8);
  loadPaletteShadow(P, CharDataScreen_LoadScreenPalette, 8, 8);
  P.wramBank(WRAM_STAGING);
  decompressData(P, CharDataScreenGfx13, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles0 + VRAM_BANK1, 0x14);
  far(P, BANK_STAT_ARROWS, () => charDataScreenLoadGfx(P));
  P.wramBank(WRAM_STAGING);
  decompressData(P, CharDataScreenGfx0_1c, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles2 + VRAM_BANK1, 128);           // 128 of its 256 tiles
  queueVRAMCopy(P, wTextTileBuffer, vTiles1 + VRAM_BANK1, wTextTileBuffer_SIZE / 16);
  loadMapPiece(P, [CharDataScreenTilemap_1c, CharDataScreenAttrmap_1c, 0x240, 0]);
  for (const band of SCREEN_BANDS) loadMapPiece(P, band);
}
// LoadCharDataScreenTilemaps (1C:728B): the confirm box's pieces (rows 42-45)
export function loadCharDataScreenTilemaps(P) { for (const piece of CONFIRM_PATCHES) loadMapPiece(P, piece); }
// StartCharDataScreenAnimTask (1C:72EC) / StopCharDataScreenAnimTask (1C:72F5)
export const startCharDataScreenAnimTask = P => registerFrameTask(P, 1, CharDataScreenAnimTask);
export const stopCharDataScreenAnimTask = P => unregisterFrameTask(P, CharDataScreenAnimTask);
// BackupCharData (1C:7300): the editing state (points, level, levels) and the choice log aside
export function backupCharData(P) {
  P.wramBank(WRAM_SCENE);
  copyMemoryBC(P, P.A.charDataPointsWorking, P.A.charDataEditBackup, wCharDataEditBackup_SIZE);
  copyMemoryBC(P, P.A.charDataChoiceCount, P.A.charDataChoiceBackup, wCharDataChoiceBackup_SIZE);
}
// RestoreCharData (1C:731F): the editing state back, the main character's record as before the level-ups and the
// saved choices given again; the screen then only shows
export function restoreCharData(P) {
  P.wramBank(WRAM_SCENE);
  copyMemoryBC(P, P.A.charDataEditBackup, P.A.charDataPointsWorking, wCharDataEditBackup_SIZE);
  copyMemoryBC(P, P.A.charDataChoiceBackup, P.A.charDataChoiceCount, wCharDataChoiceBackup_SIZE);
  wr(P, "charDataViewOnly", 1);
  wr(P, "storyCharacterSlot", 0);
  wr(P, "charDataPointsLeft", rd(P, "charDataPointsWorking"));
  restoreRecordLevels(P);
  rom(P, FAR.RefreshPlayerStatsAndGetPtr, { a: 0 });
  P.wramBank(WRAM_SCENE);
  let hl = P.A.charDataChoiceLog, b = rd(P, "charDataChoiceCount");
  do {
    rom(P, FAR.LevelUpPlayer, { a: 0, d: u8(P, hl) });
    hl = (hl + 1) & 0xFFFF; b = (b - 1) & 0xFF;
  } while (b);
}
// LoadCharDataScreenGraphics (1C:73F4): the EXP screen's background and the two mugshots
export function loadCharDataScreenGraphics(P) {
  loadCharDataScreenBgAndPalettes(P);
  loadCharDataScreenMugshots(P);
}
// LoadCharDataScreenBgAndPalettes (1C:73FB): palettes (two colors kept in wExpScreenCharStats, then grayed), tiles,
// the background map
export function loadCharDataScreenBgAndPalettes(P) {
  loadPaletteShadow(P, CharDataScreenBgAndPalettes, 0, 8);
  loadPaletteShadow(P, CharDataScreenBgAndPalettes, 8, 8);
  P.wramBank(WRAM_SCENE);
  const master = P.A.masterPalettes;
  wr(P, "expScreenCharStats", u8(P, master + 58), 10); wr(P, "expScreenCharStats", u8(P, master + 59), 11);
  wr(P, "expScreenCharStats", u8(P, master + 34), 25); wr(P, "expScreenCharStats", u8(P, master + 35), 26);
  rom(P, FAR.GrayscalePaletteColorInPlace, { hl: master + 34 });
  rom(P, FAR.GrayscalePaletteColorInPlace, { hl: master + 34 });
  P.wramBank(WRAM_STAGING);
  decompressData(P, CharDataScreenBgAndPalettes0, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles2 + VRAM_BANK1, 128);
  queueVRAMCopy(P, wTextTileBuffer, vTiles1 + VRAM_BANK1, wTextTileBuffer_SIZE / 16);
  loadMapPiece(P, [CharDataScreenBgTilemap, CharDataScreenBgAttrmap, 0x240, 0]);
}
// LoadCharDataScreenMugshots (1C:748D): both characters' palettes (BG 1, 2) and mugshots, the four colors grayed
export function loadCharDataScreenMugshots(P) {
  for (const slot of [0, 1]) {
    wr(P, "storyCharacterSlot", slot);
    rom(P, FAR.LoadIndexedPaletteThunk, { a: u8(P, slotField(P, F.PALETTE)), de: (slot + 1) << 8 | 1 });
    P.wramBank(WRAM_STAGING);
    rom(P, FAR.DecompressCharMugshot, { a: u8(P, slotField(P, F.MUGSHOT)), de: wDecompBuffer });
    queueVRAMCopy(P, wDecompBuffer, vTiles1 + (0x30 + slot * 0x10) * 16 + VRAM_BANK1, 9);
  }
  for (const off of [16, 18, 20, 22]) rom(P, FAR.GrayscalePaletteColorInPlace, { hl: P.A.masterPalettes + off });
}

export const HOOKS = [
  [BANK, 0x401A, hookGen((P, c) => charDataScreenShow(P, c.c))],
  [BANK, 0x40FB, hook((P, c) => charDataScreenInitState(P, c.c))],
  [BANK, 0x41DC, hook(P => charDataScreenBuildTilemap(P))],
  [BANK, 0x4208, hook(P => charDataScreenLoadUIGraphics(P))],
  [BANK, 0x42CC, hook((P, c) => ({ hl: copyWram1ToWram3(P, c.hl, c.bc), bc: 0 }))],
  [BANK, 0x42E1, hook((P, c) => ({ hl: copyWram1ToWram2(P, c.hl, c.bc), bc: 0 }))],
  [BANK, 0x42F6, hook(P => charDataScreenDrawStats(P))],
  [BANK, 0x44CC, hook((P, c) => ({ de: charDataScreenWriteStatNumber(P, c.de) }))],
  [BANK, 0x4502, hook((P, c) => charDataScreenDrawStatBar(P, c.a, c.c, c.de))],
  [BANK, 0x459A, hook(P => charDataScreenDrawPortrait(P))],
  [BANK, 0x45FA, hook(P => charDataScreenAnimTask(P))],
  [BANK, 0x4682, hookGen(P => animateCharDataStatsReveal(P))],
  [BANK, 0x4882, hookGen(P => drawCharStatsAndFlush(P))],
  [BANK, 0x489B, hook(P => drawCharStatRows(P))],
  [BANK, 0x48C9, hook(P => backupCharDataScreenRow(P))],
  [BANK, 0x48EC, hook(P => restoreCharDataScreenRow(P))],
  [BANK, 0x490F, hook((P, c) => blitTilemapRunsFromTable(P, c.hl, c.bc))],
  [BANK, 0x495D, hookGen(P => flushCharDataTilemaps(P))],
  [BANK, 0x4967, hookGen(P => flushCharDataTilemapChunk(P))],
  [BANK, 0x49EB, hook(P => writeCharStatsToDisplayBuffer(P))],
  [BANK, 0x4A94, hook(P => loadCharStatsWithLevelUpDeltas(P))],
  [BANK, 0x4C43, hook(P => loadCharStats(P))],
  [BANK, 0x4DD6, hook(P => charDataScreenDrawPageColumns(P))],
  [BANK, 0x4E54, hook(P => drawStatValueSprites(P))],
  [BANK, 0x4FCE, hook((P, c) => ({ de: getStatDigitSpritePos(P, c.a, c.de) }))],
  [BANK, 0x5049, hook(P => drawRemainingPointsSprite(P))],
  [BANK, 0x5094, hook((P, c) => ({ e: offsetStatSpriteY(P, c.e) }))],
  [BANK, 0x509D, hookGen(function* (P) { return { a: yield* charDataScreenInputLoop(P) }; })],
  [BANK, 0x53A3, hook(P => drawConfirmSelectionCursor(P))],
  [BANK, 0x53C3, hookGen((P, c) => moveCharDataScreenSelection(P, c.hl))],
  [BANK, 0x5404, hookGen(function* (P) { const r = applyCharStatLevelUp(P); if (r.a) yield* redraw(P); return r; })],
  [BANK, 0x54E3, hook(P => selectCharDataConfirmSlot(P))],
  [BANK, 0x54F2, hook(P => drawStatArrowIndicators(P))],
  [BANK, 0x555C, hook((P, c) => queueStatChangeArrow(P, c.a, c.d, c.e))],
  [BANK, 0x5572, hookGen(P => setupCharDataScreen(P))],
  [BANK, 0x7116, hook(P => charDataScreenLoadScreen(P))],
  [BANK, 0x728B, hook(P => loadCharDataScreenTilemaps(P))],
  [BANK, 0x72EC, hook(P => startCharDataScreenAnimTask(P))],
  [BANK, 0x72F5, hook(P => stopCharDataScreenAnimTask(P))],
  [BANK, 0x72FC, hookGen(P => flushCharDataTilemaps(P))],
  [BANK, 0x7300, hook(P => backupCharData(P))],
  [BANK, 0x731F, hook(P => restoreCharData(P))],
  [BANK, 0x73F4, hook(P => loadCharDataScreenGraphics(P))],
  [BANK, 0x73FB, hook(P => loadCharDataScreenBgAndPalettes(P))],
  [BANK, 0x748D, hook(P => loadCharDataScreenMugshots(P))],
];
