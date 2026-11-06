// The story's character-data screen of bank $1D (STATUS: both characters' data): a summary page (names, levels,
// stat levels, EXP and its bar, the racket and shoes) between the main character's stat page (left) and the
// partner's (right); left/right slide the pages, A or B leaves. The pages are built once into WRAM (the summary in
// the plane at $D5A0, the stat pages in the slots at $D7E0 / $DA20 / $DC60, tiles in WRAM 3 and attributes in WRAM 2)
// and the slides patch them onto the screen map step by step. Also the tile and text helpers the pages use.
// Port of src/engine/menus/char_data/pages_1d.asm and tile_text_1d.asm of the gerbiljames/mario-tennis-gbc-disasm
// (MIT, third_party/mario-tennis-gbc-disasm); names and addresses are its own. Tables, patch lists and graphics are
// read from the ROM.
//
// Frame tasks while the screen runs: CharDataScreenBgScrollTask (the background's scroll), DrawCharDataPageArrowsTask
// (the bobbing arrows to the other pages), CharDataValuesSyncTask (the sprites of the time played / match values,
// the EXP to the next level and the racket marks) and bank $1C's anim task.
import {
  rd, wr, u8, w8, rom, FAR, far, farGen, WRAM_STAGING, WRAM_COURT_PLANES, WRAM_SCREEN, WRAM_SCENE, TILEMAP_WIDTH,
  SCREEN_HEIGHT, VRAM_BANK1, vTiles0, vTiles2, wDecompBuffer, wShadowTilemap, wScreenAttrmap, wCharDataScreenCell,
  wCharDataPagePlane, wCharDataPageSlot1, wCharDataPageSlot2, wCharDataPageSlot3, wCharDataNumberBuffer_SIZE,
  BGM_STATUS_SCREEN, storyField, sound, advanceFrame, fadeIn, fadeOut, registerFrameTask, unregisterFrameTask,
  queueVRAMCopy, queueSprite, copyMemoryBC, copyMemoryFast, formatDecimalNumberUnsigned, timerInterruptOff,
  timerInterruptOn, beginFadeOut, waitFadeEnd, hook, hookGen,
} from "../char_select/defs.js";
import { enableLCD } from "../../home/system.js";
import { clearFrameTasks } from "../../home/debugtext.js";
import { decompressData } from "../../home/decompress.js";
import { loadPaletteShadow } from "../../home/palettes.js";
import { charDataScreenLoadScreen, charDataScreenWriteStatNumber, startCharDataScreenAnimTask,
  stopCharDataScreenAnimTask, copyWram1To } from "./screen.js";
import { initCharDataScreenVideo, applySlideOffsetToSpriteX, getCharDataDigitSprite, computeExpProgressBar,
  drawExpProgressBarTiles, loadMugshot, queueScreenMaps } from "./confirm.js";
import { applyTilemapPatchList, buildMainCharStatPage, buildPartnerStatPage, runDrillResultInputLoop,
  DrawCharDataPageArrowsTask } from "./page_slides.js";
import { PATCH, GFX, F } from "./patches.js";

export const BANK = 0x1D;
const BANK_SCREEN = 0x1C;
// frame tasks (bank $1D)
export const CharDataScreenBgScrollTask = 0x40CC, CharDataValuesSyncTask = 0x48C7;
const SCREEN_BLOCKS = SCREEN_HEIGHT * TILEMAP_WIDTH / 16;
const PAGE_BASE = wCharDataPagePlane + 13 * TILEMAP_WIDTH;    // the summary page's map (the base the slides start from)
const DIGIT_BLANK = 0x20, DIGIT_0 = 0x30;
const rlca = a => ((a << 1) | (a >> 7)) & 0xFF;
const record = (P, off) => storyField(rd(P, "storyCharacterSlot"), off);
// `ld a, [record + off] / ld h, 0 / ld l, a / ld a, 2 / ld de, wCharDataNumberBuffer / call
// FormatDecimalNumberUnsigned / ld de, cell / farcall CharDataScreen_WriteStatNumber`: a record byte as two digits
export function writeRecordNumber(P, off, cell) {
  P.wramBank(WRAM_SCENE);
  formatDecimalNumberUnsigned(P, u8(P, record(P, off)), 2, P.A.charDataNumberBuffer);
  far(P, BANK_SCREEN, () => charDataScreenWriteStatNumber(P, cell));
}

// ---- the screen ----
// ShowCharDataScreen (1D:4016): the screen; a picks what the values sprites show (0: wCharDataSyncValues, else the
// game timer). Returns when RunDrillResultInputLoop does (A or B), the tasks stopped and cleared.
export function* showCharDataScreen(P, source) {
  P.wramBank(WRAM_SCENE);
  wr(P, "charDataSyncSource", source);
  sound(P, BGM_STATUS_SCREEN);
  rom(P, FAR.RefreshMainCharacterStats, { a: source, b: source });
  enableLCD(P);
  beginFadeOut(P, 127);
  yield* waitFadeEnd(P);
  initCharDataScreenVideo(P);
  loadPaletteShadow(P, GFX.CharDataScreenPalettes, 8 + 5, 1);
  P.wramBank(WRAM_STAGING);
  decompressData(P, GFX.CharDataScreenGfx14, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles0 + 0x60 * 16 + VRAM_BANK1, 0x14);
  rom(P, FAR.InitMenuBgScroll);
  rom(P, FAR.LoadMenuSpritePalettePair, { b: 5, c: 5 });
  wr(P, "menuBgScrollAttr", 0x0D); wr(P, "menuBgScrollAttr", 0x0D, 1);
  wr(P, "menuBgScrollTile", 0x60); wr(P, "menuBgScrollTile", 0x60, 1);
  timerInterruptOff(P);
  enableLCD(P);
  yield* advanceFrame(P);
  registerFrameTask(P, 1, CharDataScreenBgScrollTask);
  registerFrameTask(P, 1, DrawCharDataPageArrowsTask);
  registerFrameTask(P, 1, CharDataValuesSyncTask);
  far(P, BANK_SCREEN, () => startCharDataScreenAnimTask(P));
  yield* fadeIn(P, 16);
  yield* runDrillResultInputLoop(P);
  timerInterruptOn(P);
  yield* fadeOut(P, 16);
  unregisterFrameTask(P, DrawCharDataPageArrowsTask);
  unregisterFrameTask(P, CharDataValuesSyncTask);
  unregisterFrameTask(P, CharDataScreenBgScrollTask);
  far(P, BANK_SCREEN, () => stopCharDataScreenAnimTask(P));
  clearFrameTasks(P);
}
// CharDataScreenBgScrollTask (1D:40CC), a frame task: the menu background's scroll
export const charDataScreenBgScrollTask = P => rom(P, FAR.TickMenuBgScroll);
// InitDrillWorkRam (1D:40D0): the pages' state: the anim and flush phases, the arrows (summary mode, no slide), the
// stat sprites off the screen ($A8), the values at rest, no stat deltas
export function initDrillWorkRam(P) {
  P.wramBank(WRAM_SCENE);
  for (const name of ["charDataAnimCounter", "charDataAnimSubStep", "charDataFlushChunk", "charDataPageArrowMode",
    "charDataArrowHold", "charDataArrowPhase"]) wr(P, name, 0);
  wr(P, "charDataStatsSlideX", 0xA8); wr(P, "charDataStatsSlideX", 0x00, 1);
  wr(P, "charDataValuesSlideX", 0); wr(P, "charDataValuesSlideX", 0, 1);
  for (let i = 0; i < 11; i++) wr(P, "charDataStatDeltas", 0, i);
}
// BuildCharDataScreenPages (1D:411E): the screen's graphics, the summary's base map saved as the base page, then the
// main character's page (slot 2), the partner's (slot 3) and the summary (slot 1) built on it; the summary with the
// drill display shown and queued
export function buildCharDataScreenPages(P) {
  far(P, BANK_SCREEN, () => charDataScreenLoadScreen(P));
  loadCharDataScreenPageGraphics(P);
  saveWorkTilemapToPage(P, 0);
  loadBasePageIntoWorkTilemap(P);
  buildMainCharStatPage(P);
  saveWorkTilemapToPage(P, 2);
  loadBasePageIntoWorkTilemap(P);
  buildPartnerStatPage(P);
  saveWorkTilemapToPage(P, 3);
  loadBasePageIntoWorkTilemap(P);
  buildCharDataSummaryPage(P);
  saveWorkTilemapToPage(P, 1);
  applyTilemapPatchList(P, PATCH.DrillDisplayData_1d, wScreenAttrmap + 28 * TILEMAP_WIDTH + 16);
  queueScreenMaps(P);
}
// LoadCharDataScreenPageGraphics (1D:4175): the pages' tiles (VRAM bank 1), their map pieces (rows 28-42 of both
// maps) and both characters' palettes and mugshots (main: BG 4 at $9200, partner: BG 1 at $9230)
const PAGE_TILES_A = [                                   // [compressed tiles, VRAM bank 1 address, 16-byte blocks]
  [GFX.CharDataScreenPageGfx14, vTiles0 + 0x14 * 16, 0x0A], [GFX.CharDataScreenPageGraphicsGfx0, vTiles0 + 0x1E * 16, 0x0A],
  [GFX.CharDataScreenPageGraphicsGfx1, vTiles0 + 0x28 * 16, 0x08], [GFX.CharDataScreenPageGraphicsGfx2, vTiles0 + 0x30 * 16, 8],
];
const PAGE_PIECES_A = [                                  // [tiles, attributes, map offset, size]
  [GFX.CharDataScreenPagePatch3Tilemap, GFX.CharDataScreenPagePatch3Attrmap, 28 * TILEMAP_WIDTH, 0x09],
  [GFX.CharDataScreenPagePatch0Tilemap, GFX.CharDataScreenPagePatch0Attrmap, 28 * TILEMAP_WIDTH + 16, 0x28],
  [GFX.CharDataScreenPagePatch1Tilemap, GFX.CharDataScreenPagePatch1Attrmap, 30 * TILEMAP_WIDTH, 0x82],
  [GFX.CharDataScreenPagePatch1Tilemap, GFX.CharDataScreenPagePatch1Attrmap, 34 * TILEMAP_WIDTH + 16, 0x82],
  [GFX.CharDataScreenPagePatch2Tilemap, GFX.CharDataScreenPagePatch2Attrmap, 39 * TILEMAP_WIDTH, 0x1C],
  [GFX.CharDataScreenPagePatch4Tilemap, GFX.CharDataScreenPagePatch4Attrmap, 40 * TILEMAP_WIDTH, 0x2A],
];
const PAGE_TILES_B = [[GFX.CharDataScreenPageGfx10, vTiles0 + 0x38 * 16, 0x14], [GFX.CharDataScreenPageGfx13, vTiles0 + 0x4C * 16, 0x14]];
const PAGE_PIECE_C = [GFX.CharDataScreenPagePatch5Tilemap, GFX.CharDataScreenPagePatch5Attrmap, 41 * TILEMAP_WIDTH + 16, 0x1E];
export function loadCharDataScreenPageGraphics(P) {
  for (const tiles of PAGE_TILES_A) { P.wramBank(WRAM_STAGING); loadTiles(P, tiles); }
  for (const piece of PAGE_PIECES_A) loadMapPiece(P, piece);
  P.wramBank(WRAM_STAGING);
  for (const tiles of PAGE_TILES_B) loadTiles(P, tiles);
  loadMapPiece(P, PAGE_PIECE_C);
  wr(P, "storyCharacterSlot", 0);
  loadMugshot(P, 4, vTiles2 + 0x20 * 16);
  wr(P, "storyCharacterSlot", 1);
  loadMugshot(P, 1, vTiles2 + 0x23 * 16);
}
function loadTiles(P, [gfx, dest, blocks]) {
  decompressData(P, gfx, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, dest + VRAM_BANK1, blocks);
}
// a map piece: its tiles decompressed in WRAM 1 at the map offset and copied to WRAM 3, its attributes to WRAM 2
function loadMapPiece(P, [tiles, attrs, offset, size]) {
  const at = wDecompBuffer + offset;
  P.wramBank(WRAM_STAGING);
  decompressData(P, tiles, at);
  copyWram1ToWram3CharData(P, at, size);
  P.wramBank(WRAM_STAGING);
  decompressData(P, attrs, at);
  copyWram1ToWram2CharData(P, at, size);
}
// CopyWram1ToWram3CharData (1D:4423) / CopyWram1ToWram2CharData (1D:4438): as bank $1C's CopyWram1ToWram3/2 (bc bytes
// at hl from WRAM 1 to the same addresses in WRAM 3 / 2, that bank left mapped). Return hl after them.
export const copyWram1ToWram3CharData = (P, hl, bc) => copyWram1To(P, WRAM_SCREEN, hl, bc);
export const copyWram1ToWram2CharData = (P, hl, bc) => copyWram1To(P, WRAM_COURT_PLANES, hl, bc);
// BuildCharDataSummaryFields (1D:444D): the summary's fields of both characters: name, the tiles of its plot (the
// frame), the handedness label, level and the four stat levels, the EXP bar; into wCharStatPageMain / Partner the
// EXP to the next level (3 digits, at +10) and the EXP (6 characters at +4, " 99999" past 24 bits' range)
const SUMMARY = [
  { name: wScreenAttrmap + 30 * TILEMAP_WIDTH + 11, plot: [PATCH.CharDataSummaryFieldsTilePlot0, wScreenAttrmap + 30 * TILEMAP_WIDTH, 0x0C],
    flag: wScreenAttrmap + 31 * TILEMAP_WIDTH + 3, page: "charStatPageMain",
    numbers: [[F.LEVEL, wCharDataScreenCell + 30 * TILEMAP_WIDTH + 27], [F.STAT_LEVELS, wCharDataScreenCell + 31 * TILEMAP_WIDTH + 25],
      [F.STAT_LEVELS + 1, wCharDataPagePlane + 3], [F.STAT_LEVELS + 2, wCharDataPagePlane + 13],
      [F.STAT_LEVELS + 3, wCharDataPagePlane + 23]], bar: wCharDataPagePlane + 1 * TILEMAP_WIDTH + 15 },
  { name: wCharDataPagePlane + 2 * TILEMAP_WIDTH + 27, plot: [PATCH.CharDataSummaryFieldsTilePlot1, wCharDataPagePlane + 2 * TILEMAP_WIDTH + 16, 0x09],
    flag: wCharDataPagePlane + 3 * TILEMAP_WIDTH + 19, page: "charStatPagePartner",
    numbers: [[F.LEVEL, wCharDataPagePlane + 3 * TILEMAP_WIDTH + 11], [F.STAT_LEVELS, wCharDataPagePlane + 4 * TILEMAP_WIDTH + 9],
      [F.STAT_LEVELS + 1, wCharDataPagePlane + 4 * TILEMAP_WIDTH + 19], [F.STAT_LEVELS + 2, wCharDataPagePlane + 4 * TILEMAP_WIDTH + 29],
      [F.STAT_LEVELS + 3, wCharDataPagePlane + 5 * TILEMAP_WIDTH + 7]], bar: wCharDataPagePlane + 5 * TILEMAP_WIDTH + 31 },
];
const F_HANDEDNESS = 0x0E;
export function buildCharDataSummaryFields(P) {
  SUMMARY.forEach((s, slot) => {
    wr(P, "storyCharacterSlot", slot);
    writeNameStringTiles(P, record(P, 0), s.name, 0x0A);
    if (slot) P.wramBank(WRAM_SCREEN);
    plotTilesAtOffsets(P, ...s.plot);
    drawFourTileFlagLabel(P, u8(P, record(P, F_HANDEDNESS)), s.flag);
    for (const [off, cell] of s.numbers) writeRecordNumber(P, off, cell);
    drawExpProgressBarTiles(P, computeExpProgressBar(P).a, s.bar);
    P.wramBank(WRAM_SCENE);
    const toNext = rom(P, FAR.GetExpRemainingToNextLevel, { a: slot }).hl;
    formatDecimalNumberUnsigned(P, toNext, 3, P.A.charDataNumberBuffer);
    for (let i = 0; i < 3; i++) wr(P, s.page, rd(P, "charDataNumberBuffer", i), 10 + i);
    P.wramBank(WRAM_SCENE);
    formatExp24BitDecimal(P, record(P, F.EXP));
    const exp = (P.A[s.page] + 4) & 0xFFFF;
    if (!rd(P, "charDataNumberBuffer")) copyMemoryBC(P, P.A.charDataNumberBuffer, exp, wCharDataNumberBuffer_SIZE);
    else [0x20, 0x39, 0x39, 0x39, 0x39, 0x39].forEach((v, i) => w8(P, exp + i, v));
  });
}

// ---- tile and text helpers (tile_text_1d.asm) ----
// PlotTilesAtOffsets (1D:4771): tiles at offsets from de (entries [offset, tile], $FF), attribute b; de kept
export function plotTilesAtOffsets(P, hl, de, attr) {
  for (;;) {
    const off = u8(P, hl);
    if (off === 0xFF) return;
    const at = (de + off) & 0xFFFF, tile = u8(P, hl + 1);
    hl = (hl + 2) & 0xFFFF;
    P.wramBank(WRAM_SCREEN); w8(P, at, tile);
    P.wramBank(WRAM_COURT_PLANES); w8(P, at, attr);
  }
}
// DrawFourTileFlagLabel (1D:4793): a four-tile label at hl (WRAM 3): tiles 1-4 for a = 0, else 5-8
export function drawFourTileFlagLabel(P, a, hl) {
  P.wramBank(WRAM_SCREEN);
  const first = a ? 0x05 : 0x01;
  for (let i = 0; i < 4; i++) w8(P, hl + i, first + i);
}
// WriteNameStringTiles (1D:47B0): the 0-terminated name at hl into the maps at de, a letter a cell (attribute 0). A
// diacritic ($DE, $DF) goes to the cell above the letter before it (de - (c + 1), c the row stride less one): as
// tile mark - $30 with attribute 8 where that cell holds a tile, as itself with attribute 0 where it is empty;
// then back down (de + c + 1). Returns hl after the terminator, de.
export function writeNameStringTiles(P, hl, de, c) {
  for (;;) {
    const ch = u8(P, hl);
    hl = (hl + 1) & 0xFFFF;
    if (!ch) return { hl, de };
    if (ch !== 0xDE && ch !== 0xDF) {
      P.wramBank(WRAM_SCREEN); w8(P, de, ch);
      P.wramBank(WRAM_COURT_PLANES); w8(P, de, 0);
      de = (de + 1) & 0xFFFF;
      continue;
    }
    de = nameTilePtrUpOneRow(de, c);
    P.wramBank(WRAM_SCREEN);
    if (u8(P, de)) {
      w8(P, de, ch - 0x30);
      P.wramBank(WRAM_COURT_PLANES); w8(P, de, 0x08);
    } else {
      w8(P, de, ch);
      P.wramBank(WRAM_COURT_PLANES); w8(P, de, 0);
    }
    de = nameTilePtrDownOneRow(de, c);
  }
}
// NameTilePtrUpOneRow (1D:47FE): de - c - 1 (c = 0: 256 + 1) / NameTilePtrDownOneRow (1D:4806): de + (c + 1 as a byte)
export const nameTilePtrUpOneRow = (de, c) => (de - (c || 0x100) - 1) & 0xFFFF;
export const nameTilePtrDownOneRow = (de, c) => (de + ((c + 1) & 0xFF)) & 0xFFFF;
// FormatExp24BitDecimal (1D:480E): the 24-bit EXP at hl as decimal: its low word as five digits at
// wCharDataNumberBuffer + 1, then 65536 added for each unit of its high byte, digit by digit, with the ROM's
// carries: the carry byte is wCharDataNumberBuffer itself, which still holds the high byte when the first
// addition's units do not carry (its tens then get it), and the ten-thousands digit stops at 9.
export function formatExp24BitDecimal(P, hl) {
  P.wramBank(WRAM_SCENE);
  const low = u8(P, hl) | u8(P, hl + 1) << 8, high = u8(P, hl + 2);
  const buf = P.A.charDataNumberBuffer;
  w8(P, buf, high);
  formatDecimalNumberUnsigned(P, low, 5, buf + 1);
  let count = u8(P, buf);
  if (!count) return;
  const digit = ch => { let a = (ch - 0x20) & 0xFF; if (a) a = (a - 0x10) & 0xFF; return a; };
  // one digit: (the character + the carry so far) as a value, + add; past 9: - 10, carry 1
  const addDigit = (at, add, withCarry) => {
    let ch = u8(P, at);
    if (withCarry) { ch = (ch + u8(P, buf)) & 0xFF; w8(P, buf, 0); }
    let a = (digit(ch) + add) & 0xFF;
    if (a >= 0x0A) { a = (a - 0x0A) & 0xFF; w8(P, buf, 1); }
    w8(P, at, a + 0x30);
  };
  do {
    addDigit(buf + 5, 6, false);
    addDigit(buf + 4, 3, true);
    addDigit(buf + 3, 5, true);
    addDigit(buf + 2, 5, true);
    // the ten-thousands: + 5 and the carry (cleared first, so 0), capped at 9
    let ch = (u8(P, buf + 1) + u8(P, buf)) & 0xFF;
    w8(P, buf, 0);
    let a = (digit(ch) + 5 + u8(P, buf)) & 0xFF;
    if (a >= 0x0A) a = 0x09;
    w8(P, buf + 1, a + 0x30);
    count = (count - 1) & 0xFF;
  } while (count);
}
// CharDataValuesSyncTask (1D:48C7), a frame task: two two-digit values (wCharDataSyncValues, or the game timer's
// hours and minutes) as sprites, the EXP to the next level of both characters, and the racket / shoes marks; all
// moved with the values' slide
const SYNC_DIGITS = [[0x5D, 0x65], [0x74, 0x7C]];
const SUMMARY_EXP = [["charStatPageMain", [0x08, 0x0D, 0x12]], ["charStatPagePartner", [0x58, 0x5D, 0x62]]];
export function charDataValuesSyncTask(P) {
  P.wramBank(WRAM_SCENE);
  const src = rd(P, "charDataSyncSource") ? (P.A.gameTimer + 2) & 0xFFFF : P.A.charDataSyncValues;
  wr(P, "charDataSyncPair", u8(P, src)); wr(P, "charDataSyncPair", u8(P, src + 1), 1);
  const slide = P.A.charDataValuesSlideX;
  const put = (spr, x, y) => queueSprite(P, spr.b, spr.c, applySlideOffsetToSpriteX(P, slide, x), y);
  // the second value: its tens left out when blank
  formatDecimalNumberUnsigned(P, rd(P, "charDataSyncPair", 1), 2, P.A.charDataNumberBuffer);
  if (rd(P, "charDataNumberBuffer") !== DIGIT_BLANK) put(getCharDataDigitSprite(rd(P, "charDataNumberBuffer")), SYNC_DIGITS[0][0], 0x88);
  put(getCharDataDigitSprite(rd(P, "charDataNumberBuffer", 1)), SYNC_DIGITS[0][1], 0x88);
  // the first: a blank tens as 0
  formatDecimalNumberUnsigned(P, rd(P, "charDataSyncPair"), 2, P.A.charDataNumberBuffer);
  const tens = rd(P, "charDataNumberBuffer");
  put(getCharDataDigitSprite(tens === DIGIT_BLANK ? DIGIT_0 : tens), SYNC_DIGITS[1][0], 0x88);
  put(getCharDataDigitSprite(rd(P, "charDataNumberBuffer", 1)), SYNC_DIGITS[1][1], 0x88);
  P.wramBank(WRAM_SCENE);
  for (const [page, xs] of SUMMARY_EXP) xs.forEach((x, i) => {
    const ch = rd(P, page, 10 + i);
    if (ch !== DIGIT_BLANK) put(getSummaryExpDigitSprite(ch), x, 0x64);
  });
  const racket = rd(P, "equippedRacket");
  if (racket & 0x0F) put({ b: 0x0E, c: 0xD6 }, 0x30, 0x3C);
  if (racket & 0xF0) put({ b: 0x0E, c: 0xD8 }, 0x38, 0x3C);
}
// GetSummaryExpDigitSprite (1D:4A0B): the summary's small digit sprite (bank 1, palette 0) of character a
export const getSummaryExpDigitSprite = a => ({ b: 0x08, c: (rlca((a - 0x30) & 0xFF) + 0x4C) & 0xFF });
// SaveWorkTilemapToPage (1D:4A14): the screen's maps (both banks) to page a: 0 the base (the plane at $D5A0), 1-3
// the slots
const PAGES = [PAGE_BASE, wCharDataPageSlot1, wCharDataPageSlot2];
export function saveWorkTilemapToPage(P, a) {
  const dest = a < 3 ? PAGES[a] : wCharDataPageSlot3;
  P.wramBank(WRAM_SCREEN);
  copyMemoryFast(P, wShadowTilemap, dest, SCREEN_BLOCKS);
  P.wramBank(WRAM_COURT_PLANES);
  copyMemoryFast(P, wScreenAttrmap, dest, SCREEN_BLOCKS);
}
// LoadBasePageIntoWorkTilemap (1D:4AA9): the base page back onto the screen's maps
export function loadBasePageIntoWorkTilemap(P) {
  P.wramBank(WRAM_SCREEN);
  copyMemoryFast(P, PAGE_BASE, wShadowTilemap, SCREEN_BLOCKS);
  P.wramBank(WRAM_COURT_PLANES);
  copyMemoryFast(P, PAGE_BASE, wScreenAttrmap, SCREEN_BLOCKS);
}
// BuildCharDataSummaryPage (1D:4ACC): the summary's fields and its three patches
export function buildCharDataSummaryPage(P) {
  buildCharDataSummaryFields(P);
  applyTilemapPatchList(P, PATCH.CharDataSummaryPageTilemapPatch0, wCharDataScreenCell + 30 * TILEMAP_WIDTH);
  applyTilemapPatchList(P, PATCH.CharDataSummaryPageTilemapPatch1, wCharDataPagePlane + 2 * TILEMAP_WIDTH + 16);
  applyTilemapPatchList(P, PATCH.CharDataSummaryPageTilemapPatch2, wCharDataPagePlane + 7 * TILEMAP_WIDTH);
}

export const HOOKS = [
  [BANK, 0x4016, hookGen((P, c) => showCharDataScreen(P, c.a))],
  [BANK, 0x40CC, hook(P => { charDataScreenBgScrollTask(P); })],
  [BANK, 0x40D0, hook(P => { initDrillWorkRam(P); })],
  [BANK, 0x411E, hook(P => { buildCharDataScreenPages(P); })],
  [BANK, 0x4175, hook(P => { loadCharDataScreenPageGraphics(P); })],
  [BANK, 0x4423, hook((P, c) => ({ hl: copyWram1ToWram3CharData(P, c.hl, c.bc), bc: 0 }))],
  [BANK, 0x4438, hook((P, c) => ({ hl: copyWram1ToWram2CharData(P, c.hl, c.bc), bc: 0 }))],
  [BANK, 0x444D, hook(P => { buildCharDataSummaryFields(P); })],
  [BANK, 0x4771, hook((P, c) => { plotTilesAtOffsets(P, c.hl, c.de, c.b); })],
  [BANK, 0x4793, hook((P, c) => { drawFourTileFlagLabel(P, c.a, c.hl); })],
  [BANK, 0x47B0, hook((P, c) => writeNameStringTiles(P, c.hl, c.de, c.c))],
  [BANK, 0x47FE, hook((P, c) => ({ de: nameTilePtrUpOneRow(c.de, c.c) }))],
  [BANK, 0x4806, hook((P, c) => ({ de: nameTilePtrDownOneRow(c.de, c.c) }))],
  [BANK, 0x480E, hook((P, c) => { formatExp24BitDecimal(P, c.hl); })],
  [BANK, 0x48C7, hook(P => { charDataValuesSyncTask(P); })],
  [BANK, 0x4A0B, hook((P, c) => getSummaryExpDigitSprite(c.a))],
  [BANK, 0x4A14, hook((P, c) => { saveWorkTilemapToPage(P, c.a); })],
  [BANK, 0x4AA9, hook(P => { loadBasePageIntoWorkTilemap(P); })],
  [BANK, 0x4ACC, hook(P => { buildCharDataSummaryPage(P); })],
];
