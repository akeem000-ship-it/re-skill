// The pieces of the racket and shoes select screens (bank $3e): their windows (the item list and the caption), the
// text rows cleared and flushed, the hovered and equipped items, their names and descriptions, the two cursor
// sprite tasks, and an item's stat changes: a list of up to six (stat, change) pairs drawn as a label (a run of
// tiles) and a sign-and-digit value in a set of rows (wEquipStatRowSet: the select screen's or one of the status
// screen's panels).
// Port of src/engine/menus/equipment/equip_3e.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own; the item and stat tables are read from the
// ROM.
// Tests: lockstep on out/port/story_pause_items.mtrec and out/port/eq_all.mtrec (scripted: the racket and shoes
// selects with items owned); web/tests/port/routines_menus_misc.mjs.
import {
  FZ, FAR, cpFlags, rom, near, wram, rd, u8, w8, chain, getRegs, idx, ixF, addFlags, queueVRAMCopy, queueSprite,
  loadCompressedTileBlock, hook, hookGen, romWait, WRAM_SCREEN, WRAM_TEXT, TILEMAP_WIDTH, VRAM_BANK1, vTiles0,
  vTiles2, vBGMap0, wShadowTilemap, wShadowAttrmap, OAM_BANK1,
} from "./defs.js";
import { getMenuCursorIndex } from "../common/cursors.js";
import { drawTextWindow } from "./racket_choice.js";

export const BANK = 0x3E;
export const EquipListCursorSpriteTask = 0x59CD, EquippedItemMarkerSpriteTask = 0x59EB;
const rb = (P, a) => P.rom.u8(BANK, a & 0xFFFF), rw = (P, a) => P.rom.u16(BANK, a & 0xFFFF);
const EquipSelectTextRowPtrs_3e = 0x58D6, EquipSelectTextRows_3e = 0x58E4;
const EquipListCursorYPositions_3e = 0x59E5, EquippedMarkerYPositions_3e = 0x5A0F;
const ItemStatModListPtrPtrs = 0x5A5F, ItemStatModListPtrTable = 0x5A6D;
const StatModLabelTiles_3e = 0x5AEF, StatModLabelLengths_3e = 0x5B09, StatModRowAddrPtrs = 0x5B63;
const TILEBLOCK_SharedMenuGfx17Alias17 = 0x11, SharedMenuGfx17_BLOCKS = 0x10;
const Text_30_229 = 0x00E5, Text_30_237 = 0x00ED, SHOES_NAMES = 0x00F4, SHOES_DESCS = 0x00F7;
const TEXT_WIDTH = 0x12, LIST_ATTR = 0x08, LIST_COLUMNS = 7;
const STAT_END = 0xFF, STAT_NONE = 0xFE, STAT_MODS = 6;    // a stat list's end and an empty pair
const VALUE_COLUMN = 6;                                     // a value's cells: 6 past its label's
const TILE_PLUS = 0xD0, TILE_MINUS = 0xD1, TILE_DIGIT_0 = 0xD2;
const FRAME_TOP = 0x03, FRAME_LEFT_CORNER = 0x02, FRAME_RIGHT_CORNER = 0x04, BLANK = 0x20;
const MARKER_ATTR = OAM_BANK1 | 1, MARKER_TILE = 0x20, MARKER_Y = 0x18, CURSOR_Y = 0x06;

// ---- windows and text rows ----
// LoadEquipSelectCommon (3E:57F4): the windows reset, the font, the caption and list windows (WRAM 5 mapped while
// they are made), the fixed tile block and palette for the icons
export function loadEquipSelectCommon(P) {
  rom(P, FAR.ResetTextWindowState);
  loadCompressedTileBlock(P, TILEBLOCK_SharedMenuGfx17Alias17, vTiles2, SharedMenuGfx17_BLOCKS);
  wram(P, WRAM_TEXT);
  createEquipCaptionWindow(P);
  createEquipListWindow(P);
  return rom(P, FAR.LoadFixedTileBlockAndPalette, { de: vTiles0 + VRAM_BANK1 });
}
// CreateEquipListWindow (3E:5814): the 20 x 9 list window from row 4, its 18 x 5 inside in attribute $08
export function createEquipListWindow(P) {
  const r = drawTextWindow(P, 0x00, 0x04, 0x14, 0x09);
  wram(P, WRAM_SCREEN);
  return rom(P, FAR.FillTilemapRect, { ...r, a: WRAM_SCREEN, de: wShadowAttrmap + 7 * TILEMAP_WIDTH + 1, b: 0x12, c: 0x05, h: LIST_ATTR });
}
// CreateEquipCaptionWindow (3E:5838): the 20 x 5 caption window from row 13 (windows drawn into WRAM 3's map)
export function createEquipCaptionWindow(P) {
  P.V.shadowTilemapBank = WRAM_SCREEN;
  P.V.windowTileAttr = 0;
  return drawTextWindow(P, 0x00, 0x0D, 0x14, 0x05);
}
// one window's top frame row (the corners and the edge) and its inside blank (r: the registers, a sequence)
function clearWindowRows(P, top, rows, r) {
  chain(r, rom(P, FAR.FillTilemapRect, { ...r, de: wShadowTilemap + top * TILEMAP_WIDTH, b: 0x14, c: 0x01, h: FRAME_TOP }));
  w8(P, wShadowTilemap + top * TILEMAP_WIDTH, FRAME_LEFT_CORNER);
  w8(P, wShadowTilemap + top * TILEMAP_WIDTH + 19, FRAME_RIGHT_CORNER);
  r.a = FRAME_RIGHT_CORNER;
  return chain(r, rom(P, FAR.FillTilemapRect, { ...r, de: wShadowTilemap + (top + 1) * TILEMAP_WIDTH + 1, b: 0x12, c: rows, h: BLANK }));
}
// ClearEquipSelectTextRows (3E:5854): the caption window (row 13, 3 rows inside) and the list window (row 4,
// 7 rows) blank again
export function clearEquipSelectTextRows(P, entry = getRegs(P.cpu)) {
  const r = clearWindowRows(P, 13, 0x03, { ...entry });
  return clearWindowRows(P, 4, 0x07, r);
}
// FlushEquipSelectTextRows (3E:5899): rows 4-11 and 13-16 of the map, and the attributes of rows 5-6, queued
export function flushEquipSelectTextRows(P, entry = getRegs(P.cpu)) {
  const r = { ...entry };
  const queue = (src, dest, blocks) => chain(chain(r, { hl: src, de: dest, c: blocks }), queueVRAMCopy(P, src, dest, blocks));
  queue(wShadowTilemap + 4 * TILEMAP_WIDTH, vBGMap0 + 4 * TILEMAP_WIDTH, 8 * TILEMAP_WIDTH / 16);
  queue(wShadowTilemap + 13 * TILEMAP_WIDTH, vBGMap0 + 13 * TILEMAP_WIDTH, 4 * TILEMAP_WIDTH / 16);
  return queue(wShadowAttrmap + 5 * TILEMAP_WIDTH, vBGMap0 + 5 * TILEMAP_WIDTH + VRAM_BANK1, 2 * TILEMAP_WIDTH / 16);
}
// Unused_3e_GetEquipSelectTextRowPtr (3E:58BB): hl = entry b of the kind's text-row table (the two-level lookup of
// GetItemStatModListPtr over two other tables). Nothing calls it. af, bc kept.
export function unusedGetEquipSelectTextRowPtr(P, b) {
  const table = rd(P, "equipItemKind") ? EquipSelectTextRows_3e : EquipSelectTextRowPtrs_3e;
  return { hl: rw(P, idx(table, b * 2)) };
}

// ---- the hovered and the equipped item ----
// GetHoveredItemId (3E:594A): a = the item under the cursor (wEquipItemList at the cursor's cell); bc, hl kept
export function getHoveredItemId(P) {
  const { hl, f } = ixF(P.A.equipItemList, getMenuCursorIndex(P, rd(P, "equipItemCount")).a);
  return { a: u8(P, hl), f };
}
// GetEquippedItemId (3E:595F): a = the item equipped (wEquipItemList at wEquipEquippedIndex); hl kept
export function getEquippedItemId(P) {
  const { hl, f } = ixF(P.A.equipItemList, rd(P, "equipEquippedIndex"));
  return { a: u8(P, hl), f };
}
// DrawEquippedItemStatMods (3E:596E) / DrawHoveredItemStatMods (3E:5981): that item's stat changes, with WRAM 3
// mapped. Registers kept.
export function drawEquippedItemStatMods(P) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  drawItemStatModList(P, getEquippedItemId(P).a);
  wram(P, bank);
}
export function drawHoveredItemStatMods(P) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  drawItemStatModList(P, getHoveredItemId(P).a);
  wram(P, bank);
}
// RenderRacketDescText (3E:59A4) / RenderShoesDescText (3E:599E): item c's description in the caption window
// (hl = its text id after). The text's line breaks upload the glyphs, over frames with the LCD on.
function* renderDesc(P, base, item, regs = {}) {
  const text = idx(base, item);
  const r = yield* romWait(P, FAR.RenderProportionalTextAt, { ...regs, a: text & 0xFF, hl: text, de: wShadowTilemap + 14 * TILEMAP_WIDTH + 1, c: TEXT_WIDTH });
  return { ...r, h: text >> 8, l: text & 0xFF };
}
export const renderRacketDescText = (P, item, regs) => renderDesc(P, Text_30_237, item, regs);
export const renderShoesDescText = (P, item, regs) => renderDesc(P, SHOES_DESCS, item, regs);
// RenderRacketNameText (3E:59BE) / RenderShoesNameText (3E:59B8): item c's name at de
const renderName = (P, base, item, de, regs = {}) => {
  const text = idx(base, item);
  return romWait(P, FAR.RenderProportionalTextAt, { ...regs, a: text & 0xFF, hl: text, de, c: TEXT_WIDTH });
};
export const renderRacketNameText = (P, item, de, regs) => renderName(P, Text_30_229, item, de, regs);
export const renderShoesNameText = (P, item, de, regs) => renderName(P, SHOES_NAMES, item, de, regs);

// ---- the cursor sprites ----
// EquipListCursorSpriteTask (3E:59CD), a frame task: the bobbing box over the hovered icon (DrawSelectionBoxCorners)
export function equipListCursorSpriteTask(P) {
  const cell = getMenuCursorIndex(P, LIST_COLUMNS).a;
  return near(P, FAR.DrawSelectionBoxCorners_3e[1], { d: rb(P, idx(EquipListCursorYPositions_3e, cell)), e: CURSOR_Y, b: 0x10, c: 0x0E });
}
// EquippedItemMarkerSpriteTask (3E:59EB), a frame task: the marker over the equipped icon
export function equippedItemMarkerSpriteTask(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  const at = idx(EquippedMarkerYPositions_3e, rd(P, "equipEquippedIndex"));
  const r = queueSprite(P, MARKER_ATTR, MARKER_TILE, rb(P, at), MARKER_Y);
  wram(P, bank);
  return chain(chain({ hl: at }, r), { a: bank, f: entryF, b: MARKER_ATTR, c: MARKER_TILE, d: rb(P, at), e: MARKER_Y });
}

// ---- stat changes ----
// DrawItemStatModList (3E:5A15): item a's (stat, change) pairs in rows 0-5, up to the list's end mark
export function drawItemStatModList(P, item) {
  let hl = getItemStatModListPtr(P, item).hl;
  for (let row = 0; ;) {
    const stat = u8(P, hl), value = u8(P, hl + 1);
    hl = (hl + 2) & 0xFFFF;
    const r = drawStatModEntry(P, stat, value, row), d = r.d ?? stat;
    if (r.a === STAT_END) return { a: STAT_END, f: r.f, b: row, c: value, d, hl };
    row++;
    if (row === STAT_MODS) return { a: row, f: FZ | 0x40, b: row, c: value, d, hl };
  }
}
// DrawStatModEntry (3E:5A2D): pair (d = stat, c = change) in row b: its label and value, unless d is the end ($FF)
// or empty ($FE). Returns a = d, or $FE once drawn (d = the change then); bc, hl kept.
export function drawStatModEntry(P, stat, value, row) {
  if (stat === STAT_END) return { a: stat, f: cpFlags(stat, STAT_END) };
  if (stat === STAT_NONE) return { a: stat, f: cpFlags(stat, STAT_NONE) };
  drawStatModLabel(P, stat, row);
  drawStatModValue(P, value, row);
  return { a: STAT_NONE, d: value, f: cpFlags(stat, STAT_NONE) };             // (the flags of its `cp $fe`)
}
// GetItemStatModListPtr (3E:5A44): hl = item b's stat list (the kind's table); af, bc kept
export function getItemStatModListPtr(P, item) {
  const table = rd(P, "equipItemKind") ? ItemStatModListPtrTable : ItemStatModListPtrPtrs;
  return { hl: rw(P, idx(table, item * 2)) };
}
// DrawStatModLabel (3E:5ACA): stat d's label (its run of tiles, StatModLabelTiles_3e / StatModLabelLengths_3e) at
// the label cell of row b. Registers kept.
export function drawStatModLabel(P, stat, row) {
  const { hl } = getStatModRowAddr(P, row, 0);
  rom(P, FAR.FillIncrementingBytes, { hl, b: getStatModLabelTile(P, stat).b, c: getStatModLabelLen(P, stat).a });
}
// GetStatModLabelTile (3E:5AE2): b = stat d's first label tile (a = the entry's low address byte; hl kept)
export function getStatModLabelTile(P, stat) {
  const { hl, f } = ixF(StatModLabelTiles_3e, stat);
  return { a: hl & 0xFF, b: rb(P, hl), f };
}
// GetStatModLabelLen (3E:5AFC): a = stat d's label length (hl kept)
export function getStatModLabelLen(P, stat) {
  const { hl, f } = ixF(StatModLabelLengths_3e, stat);
  return { a: rb(P, hl), f };
}
// DrawStatModValue (3E:5B16): change d (sign bit 7, size 0-7) at the value cells of row b, unless d is $FE.
// Registers kept.
export function drawStatModValue(P, value, row) {
  if (value === STAT_NONE) return;
  writeStatModValueTiles(P, value, getStatModRowAddr(P, row, 1).hl);
}
// WriteStatModValueTiles (3E:5B2C): the sign tile (+ $D0 / - $D1) and the digit tile ($D2 + size) at hl
export function writeStatModValueTiles(P, value, hl) {
  w8(P, hl, value < 0x80 ? TILE_PLUS : TILE_MINUS);
  const a = ((value & 0x07) + TILE_DIGIT_0) & 0xFF;
  w8(P, hl + 1, a);
  return { a, b: TILE_DIGIT_0, hl: (hl + 1) & 0xFFFF, f: addFlags(value & 0x07, TILE_DIGIT_0) };
}
// GetStatModRowAddr (3E:5B3E): hl = row b's label cell in the rows of wEquipStatRowSet; e != 0: its value cell
export function getStatModRowAddr(P, row, value) {
  const set = (rd(P, "equipStatRowSet") * 2) & 0xFF;
  // (read through the bus: an out-of-range set's pointer can lead out of the ROM)
  const u16 = a => u8(P, a) | u8(P, (a + 1) & 0xFFFF) << 8;
  const rows = u16(idx(StatModRowAddrPtrs, set)), hl = u16(idx(rows, row * 2));
  if (!value) return { a: 0, hl, f: FZ };
  const r = ixF(hl, VALUE_COLUMN);
  return { a: r.hl & 0xFF, hl: r.hl, f: r.f };
}

export const HOOKS = [
  [BANK, 0x57F4, hook(P => loadEquipSelectCommon(P))],
  [BANK, 0x5814, hook(P => createEquipListWindow(P))],
  [BANK, 0x5838, hook(P => createEquipCaptionWindow(P))],
  [BANK, 0x5854, hook(P => clearEquipSelectTextRows(P))],
  [BANK, 0x5899, hook(P => flushEquipSelectTextRows(P))],
  [BANK, 0x58BB, hook((P, c) => unusedGetEquipSelectTextRowPtr(P, c.b))],
  [BANK, 0x594A, hook(P => getHoveredItemId(P))],
  [BANK, 0x595F, hook(P => getEquippedItemId(P))],
  [BANK, 0x596E, hook(P => { drawEquippedItemStatMods(P); })],
  [BANK, 0x5981, hook(P => { drawHoveredItemStatMods(P); })],
  [BANK, 0x599E, hookGen((P, c) => renderShoesDescText(P, c.c))],
  [BANK, 0x59A4, hookGen((P, c) => renderRacketDescText(P, c.c))],
  [BANK, 0x59B8, hookGen((P, c) => renderShoesNameText(P, c.c, c.de))],
  [BANK, 0x59BE, hookGen((P, c) => renderRacketNameText(P, c.c, c.de))],
  [BANK, 0x59CD, hook(P => equipListCursorSpriteTask(P))],
  [BANK, 0x59EB, hook((P, c) => equippedItemMarkerSpriteTask(P, c.f))],
  [BANK, 0x5A15, hook((P, c) => drawItemStatModList(P, c.a))],
  [BANK, 0x5A2D, hook((P, c) => drawStatModEntry(P, c.d, c.c, c.b))],
  [BANK, 0x5A44, hook((P, c) => getItemStatModListPtr(P, c.b))],
  [BANK, 0x5ACA, hook((P, c) => { drawStatModLabel(P, c.d, c.b); })],
  [BANK, 0x5AE2, hook((P, c) => getStatModLabelTile(P, c.d))],
  [BANK, 0x5AFC, hook((P, c) => getStatModLabelLen(P, c.d))],
  [BANK, 0x5B16, hook((P, c) => { drawStatModValue(P, c.d, c.b); })],
  [BANK, 0x5B2C, hook((P, c) => writeStatModValueTiles(P, c.d, c.hl))],
  [BANK, 0x5B3E, hook((P, c) => getStatModRowAddr(P, c.b, c.e))],
];
