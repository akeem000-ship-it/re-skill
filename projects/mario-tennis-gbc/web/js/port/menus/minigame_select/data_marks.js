// Bank $1b: the minigame data chart's pieces (minigame_data.js has the screen): a chart row's icon slot and map
// place, the scroll arrows, the clear / star / two-on-one marks (2x2 tiles copied from the map's spare columns), the
// star legend, the best scores as digit sprites, whether the chart scrolls (the ninth character unlocked) and the
// short chart's fifth row.
// Port of src/engine/menus/minigame_select/data_marks_1b.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own; tables are read from the ROM.
// Tests: lockstep on out/port/menus_status1.mtrec and out/port/ms_data9.mtrec (scrolling); web/tests/port/
// routines_menus_misc.mjs.
import {
  FZ, FN, rom, near, wram, u8, w8, idx, ixF, cpFlags, copyTilemapRect, hook, regs8, WRAM_SCREEN, TILEMAP_WIDTH,
  wShadowTilemap, wShadowAttrmap,
} from "../equipment/defs.js";
import { CHAR_UNUSED_15 } from "./minigame.js";

export const BANK = 0x1B;
const rb = (P, a) => P.rom.u8(BANK, a & 0xFFFF), rw = (P, a) => P.rom.u16(BANK, a & 0xFFFF);
export const DrawMinigameDataScrollArrows = 0x76B9, DrawMinigameHighScoreNumbers = 0x7827;
const MapMinigameRowToMugshotSlotTable = 0x7697, MinigameRowTilemapDestTable = 0x76AF, MinigameMarkTileTable = 0x7788;
const MinigameHighScoreNumberTable = 0x7875;
const ApplyArrowBobOffset = 0x40CD, QueueStackedSpritePair = [0x39, 0x4A53];
const GetUnlockedMarioCastCharAtGridSlot = [0x3B, 0x66B5], DrawDecimalNumberSprites_39 = [0x39, 0x6F10];
const VISIBLE_ROWS = 5, LAST_SCROLL_ROW = 4, MINIGAMES = 9, NINTH_SLOT = 4, NO_RECORD_ROW = 8;
const MARK_CLEAR = 0, MARK_STAR = 1, MARK_TWO_ON_ONE = 2, TWO_ON_ONE_COLUMN = 4;
const ARROW_UP_AT = 0x1128, ARROW_DOWN_AT = 0x1184, ARROW_ATTR = 0x08, ARROW_UP_FRAME = 2, ARROW_DOWN_FRAME = 3;
const MARK_TILES = wShadowTilemap + 2 * TILEMAP_WIDTH + 21;            // the marks' 2x2 tiles, off screen
const MARK_COLUMN_BLANK = wShadowTilemap + 4 * TILEMAP_WIDTH + 21;     // a blank 2 x 10 column, off screen
const STAR_LEGEND_TILES = wShadowTilemap + 22, STAR_LEGEND_AT = wShadowTilemap + 4 * TILEMAP_WIDTH + 14;
const MARK_COLUMNS = [6, 10, 14];
const ATTRMAP_OFFSET = wShadowAttrmap - wShadowTilemap;
const flags = (P, name) => P.A[name];

// MapMinigameRowToMugshotSlot (1B:768A): c = row c's icon slot (hl kept)
export function mapMinigameRowToMugshotSlot(P, row) {
  const { hl, f } = ixF(MapMinigameRowToMugshotSlotTable, row);
  return { a: hl & 0xFF, c: rb(P, hl), f };
}
// GetMinigameRowTilemapDest (1B:76A1): hl = chart slot b's map address
export function getMinigameRowTilemapDest(P, slot) {
  const { hl: at, f } = ixF(MinigameRowTilemapDestTable, slot * 2), hl = rw(P, at);
  return { a: hl & 0xFF, hl, f };
}
// DrawMinigameDataScrollArrows (1B:76B9), a frame task: on a scrolling chart, the up arrow unless at the top and the
// down arrow unless at the bottom (bobbing)
export function drawMinigameDataScrollArrows(P) {
  if (!checkMinigameDataScrollable(P).a) return { a: 0, f: FZ };
  let r = { a: P.V.menuCursorY, f: P.V.menuCursorY ? 0 : FZ };
  if (P.V.menuCursorY) {
    r = near(P, ApplyArrowBobOffset, { de: ARROW_UP_AT, c: 1 });
    r = rom(P, QueueStackedSpritePair, { ...regs8(r), b: ARROW_ATTR, c: 0, h: ARROW_UP_FRAME });
  }
  if (P.V.menuCursorY === LAST_SCROLL_ROW) return { ...regs8(r), a: LAST_SCROLL_ROW, f: FZ | FN };
  r = near(P, ApplyArrowBobOffset, { de: ARROW_DOWN_AT, c: 0 });
  return rom(P, QueueStackedSpritePair, { ...regs8(r), b: ARROW_ATTR, c: 0, h: ARROW_DOWN_FRAME });
}
// DrawMinigameDataMarks (1B:76EE): the visible rows' mark columns cleared, then their clear, star and two-on-one marks
export function drawMinigameDataMarks(P) {
  clearMinigameMarkColumns(P);
  drawMinigameClearMarks(P);
  drawMinigameStarMarks(P);
  return drawMinigameSpecialMark(P);
}
// one mark column: the kind's mark in each visible row whose flag is set (the flags from the scroll row on)
function drawMarks(P, list, kind) {
  let hl = idx(list, P.V.menuCursorY);
  for (let c = 0; c < VISIBLE_ROWS; c++) {
    const set = u8(P, hl);
    hl = (hl + 1) & 0xFFFF;
    if (set) drawMinigameMarkTile(P, kind, c);
  }
  return { a: VISIBLE_ROWS, b: kind, c: VISIBLE_ROWS, hl, f: FZ | FN };
}
// DrawMinigameClearMarks (1B:76FB) / DrawMinigameStarMarks (1B:7719)
export const drawMinigameClearMarks = P => drawMarks(P, flags(P, "minigameDataClearFlags"), MARK_CLEAR);
export const drawMinigameStarMarks = P => drawMarks(P, flags(P, "minigameDataStarFlags"), MARK_STAR);
// DrawMinigameSpecialMark (1B:7737): at the bottom of a scrolling chart, the two-on-one mark in the last row
export function drawMinigameSpecialMark(P) {
  const y = P.V.menuCursorY;
  if (y !== LAST_SCROLL_ROW) return { a: y, f: cpFlags(y, LAST_SCROLL_ROW) };
  const at = flags(P, "minigameDataTwoOnOneCleared"), b = u8(P, at + 1), a = u8(P, at) | b;
  if (!a) return { a, b, hl: at + 1, f: FZ };
  drawMinigameMarkTile(P, MARK_TWO_ON_ONE, TWO_ON_ONE_COLUMN);
  return { a, b: MARK_TWO_ON_ONE, c: TWO_ON_ONE_COLUMN, hl: at + 1, f: 0 };
}
// DrawMinigameMarkTile (1B:774C): mark b (its 2x2 tiles and attributes) at row c's place in its column. Registers
// kept.
export function drawMinigameMarkTile(P, kind, row) {
  const at = rw(P, idx(rw(P, idx(MinigameMarkTileTable, kind * 2)), row * 2));
  copyTilemapRect(P, MARK_TILES, at, 0x02, 0x02);
  copyTilemapRect(P, MARK_TILES + ATTRMAP_OFFSET, (at + 0x400) & 0xFFFF, 0x02, 0x02);
}
// ClearMinigameMarkColumns (1B:77AC): the three mark columns (rows 6-15) blank (tiles and attributes)
export function clearMinigameMarkColumns(P) {
  let r;
  for (const col of MARK_COLUMNS) {
    copyTilemapRect(P, MARK_COLUMN_BLANK, wShadowTilemap + 6 * TILEMAP_WIDTH + col, 0x02, 0x0A);
    r = copyTilemapRect(P, MARK_COLUMN_BLANK + ATTRMAP_OFFSET, wShadowAttrmap + 6 * TILEMAP_WIDTH + col, 0x02, 0x0A);
  }
  return r;
}
// DrawStarLegendMark (1B:77FB): the star legend in the header once any minigame has its star
export function drawStarLegendMark(P) {
  const list = flags(P, "minigameDataStarFlags");
  for (let c = 0; c < MINIGAMES; c++) {
    if (!u8(P, list + c)) continue;
    copyTilemapRect(P, STAR_LEGEND_TILES, STAR_LEGEND_AT, 0x02, 0x02);
    return copyTilemapRect(P, STAR_LEGEND_TILES + ATTRMAP_OFFSET, STAR_LEGEND_AT + ATTRMAP_OFFSET, 0x02, 0x02);
  }
  return { a: MINIGAMES, c: MINIGAMES, hl: list + MINIGAMES, f: FZ | FN };
}
// DrawMinigameHighScoreNumbers (1B:7827), a frame task: the visible rows' best scores
export function drawMinigameHighScoreNumbers(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  for (let b = 0, c = P.V.menuCursorY; b < VISIBLE_ROWS; b++, c = (c + 1) & 0xFF) drawMinigameHighScoreNumber(P, b, c);
  wram(P, bank);
  return { a: bank, b: VISIBLE_ROWS, c: (P.V.menuCursorY + VISIBLE_ROWS) & 0xFF, f: entryF };
}
// DrawMinigameHighScoreNumber (1B:7847): minigame c's best score (digit sprites) at chart slot b's place, for a
// minigame with its star (none for row 8)
export function drawMinigameHighScoreNumber(P, slot, row) {
  if (row === NO_RECORD_ROW) return { a: row, f: FZ | FN };
  const de = rw(P, idx(MinigameHighScoreNumberTable, slot * 2));
  const star = ixF(flags(P, "minigameDataStarFlags"), row);
  if (!u8(P, star.hl)) return { a: 0, de, hl: star.hl, f: FZ };
  const hl = P.bus.u16(idx(flags(P, "minigameDataHighScores"), row * 2));
  return rom(P, DrawDecimalNumberSprites_39, { b: slot, c: row, de, hl });
}
// CheckMinigameDataScrollable (1B:787F): a = 1 when the ninth grid slot's character is unlocked (the chart scrolls),
// else 0; bc, de, hl kept
export function checkMinigameDataScrollable(P) {
  const ch = rom(P, GetUnlockedMarioCastCharAtGridSlot, { c: NINTH_SLOT }).a;
  return ch === CHAR_UNUSED_15 ? { a: 0, f: FZ } : { a: 1, f: cpFlags(ch, CHAR_UNUSED_15) };
}
// CompactMinigameDataRows (1B:7896): the short chart's fifth row shows the sixth minigame: its clear and star flags
// and best score moved up a row
export function compactMinigameDataRows(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  const clear = flags(P, "minigameDataClearFlags"), star = flags(P, "minigameDataStarFlags");
  const scores = flags(P, "minigameDataHighScores");
  w8(P, clear + 4, u8(P, clear + 5));
  w8(P, star + 4, u8(P, star + 5));
  w8(P, scores + 8, u8(P, scores + 10));
  w8(P, scores + 9, u8(P, scores + 11));
  wram(P, bank);
  return { a: bank, f: entryF };
}

export const HOOKS = [
  [BANK, 0x768A, hook((P, c) => mapMinigameRowToMugshotSlot(P, c.c))],
  [BANK, 0x76A1, hook((P, c) => getMinigameRowTilemapDest(P, c.b))],
  [BANK, 0x76B9, hook(P => drawMinigameDataScrollArrows(P))],
  [BANK, 0x76EE, hook(P => drawMinigameDataMarks(P))],
  [BANK, 0x76FB, hook(P => drawMinigameClearMarks(P))],
  [BANK, 0x7719, hook(P => drawMinigameStarMarks(P))],
  [BANK, 0x7737, hook(P => drawMinigameSpecialMark(P))],
  [BANK, 0x774C, hook((P, c) => { drawMinigameMarkTile(P, c.b, c.c); })],
  [BANK, 0x77AC, hook(P => clearMinigameMarkColumns(P))],
  [BANK, 0x77FB, hook(P => drawStarLegendMark(P))],
  [BANK, 0x7827, hook((P, c) => drawMinigameHighScoreNumbers(P, c.f))],
  [BANK, 0x7847, hook((P, c) => drawMinigameHighScoreNumber(P, c.b, c.c))],
  [BANK, 0x787F, hook(P => checkMinigameDataScrollable(P))],
  [BANK, 0x7896, hook((P, c) => compactMinigameDataRows(P, c.f))],
];
