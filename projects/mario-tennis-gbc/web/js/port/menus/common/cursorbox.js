// The menu helpers of bank $18 (cursorbox_18.asm): its palettes, the hand cursor, boxes drawn into a tilemap,
// numbers and strings written to a tilemap, the bobbing offsets of its sprites, character records and unlocks,
// and a cursor that walks a grid of cells skipping the empty ones. Most of it is unused (nothing calls the
// Unused_18_* routines); LoadIndexedPalette_18, LoadMenuHandCursorGfx, AddBobbingOffsetY(Large),
// LoadCharacterRecordToBuffer and CheckCharacterUnlocked serve the other menus.
// Port of src/engine/menus/common/cursorbox_18.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm). Tables and graphics are read from the ROM.
// Tests: web/tests/port/routines_menus_common.mjs (all of it).
import { copyMemoryFast } from "../../home/memory.js";
import { testSaveFlag } from "../../save/storyslots.js";
import { romWait, nestedGen } from "../equipment/defs.js";
import {
  FZ, FN, FH, FC, cpFlags, addFlags, hook, hookGen, callHome, callFar, queueCopy, loadPalettes, HOME, FAR,
  TILE_SIZE, TILEMAP_WIDTH, SCREEN_HEIGHT, VRAM_BANK1, vBGMap0, wTextTileBuffer,
} from "./defs.js";

export const BANK_CURSORBOX = 0x18;
const MenuHandCursorGfx = 0x42A0, MenuHandCursorPalette = 0x42E0, AllIndexedPalettes_18 = 0x4300;
const AddBobbingOffsetXYTable = 0x4468, AddBobbingOffsetYTable = 0x448B, AddBobbingOffsetYLargeTable = 0x44AE;
const UnlockFlagIds_18 = 0x458A;
const MENU_HAND_CURSOR_BLOCKS = (MenuHandCursorPalette - MenuHandCursorGfx) / 16;
const INDEXED_PALETTES_18 = 5;
// the tilemap shadows of the bank-$18 screens: tiles in wTextTileBuffer (WRAM 1), attributes 64 tiles after
const wBgMapShadowTiles = wTextTileBuffer, wBgMapShadowAttrs = wTextTileBuffer + 64 * TILE_SIZE;
const BG_MAP_ROWS_BLOCKS = SCREEN_HEIGHT * TILEMAP_WIDTH / 16;

// Unused_18_LoadAllIndexedPalettes (18:4328): the five palettes of AllIndexedPalettes_18 from palette d (the
// caller's). Registers kept.
export function unusedLoadAllIndexedPalettes(P, first) { loadPalettes(P, AllIndexedPalettes_18, first, INDEXED_PALETTES_18); }
// LoadIndexedPalette_18 (18:4339): palette a & 15 of AllIndexedPalettes_18 as palette d. Registers kept.
export function loadIndexedPalette18(P, index, slot) {
  loadPalettes(P, (AllIndexedPalettes_18 + ((index & 0x0F) << 3)) & 0xFFFF, slot, 1);
}
// Unused_18_FlushBgMapShadowToVram (18:4353): queue the screen's tile rows (wBgMapShadowDirty low nibble) and
// attribute rows (high nibble) from their WRAM 1 shadows to $9800, 18 rows; then clear the flags.
export function unusedFlushBgMapShadowToVram(P) {
  let r = {};
  if (P.V.bgMapShadowDirty & 0x0F) r = queueCopy(P, wBgMapShadowTiles, vBGMap0, BG_MAP_ROWS_BLOCKS);
  if (P.V.bgMapShadowDirty & 0xF0) r = queueCopy(P, wBgMapShadowAttrs, vBGMap0 + VRAM_BANK1, BG_MAP_ROWS_BLOCKS);
  P.V.bgMapShadowDirty = 0;
  return { ...r, a: 0, f: FZ };
}
// LoadMenuHandCursorGfx (18:437C): the hand cursor's palettes (d, e: first palette, count) and its tiles to VRAM hl.
export function loadMenuHandCursorGfx(P, dest, first, count) {
  loadPalettes(P, MenuHandCursorPalette, first, count);
  return queueCopy(P, MenuHandCursorGfx, dest, MENU_HAND_CURSOR_BLOCKS);
}
// Unused_18_LoadFontTiles (18:438D) starts with `ret`: the copy after it (16 tiles of FontTiles, $40A0, to $9000)
// never runs. Nothing to do.
export function unusedLoadFontTiles() {}

// Unused_18_RenderProportionalTextAt32 (18:439A): RenderProportionalTextAt (bank 5) with c = $20; bc kept. It waits
// as RenderProportionalTextAt does (a frame at each line break with the LCD on): bc pushed, then FarCall's frame.
export function* unusedRenderProportionalTextAt32(P) {
  const r = yield* nestedGen(P, 1, romWait(P, FAR.RenderProportionalTextAt, { c: 0x20 }));
  return { a: r.a, f: r.f, de: r.de, hl: r.hl };
}
// Unused_18_DrawStringToTilemap (18:43A2): Unused_05_WriteStringToTilemap (bank 5), its registers returned
export function unusedDrawStringToTilemap(P, regs) { return callFar(P, FAR.Unused_05_WriteStringToTilemap, regs); }
// Unused_18_WriteTilemapByteAdvance (18:43A6): [de] = a, de + 1
export function unusedWriteTilemapByteAdvance(P, a, de) { P.bus.w8(de, a); return { de: (de + 1) & 0xFFFF }; }
// Unused_18_DrawDecimalNumberToTilemap (18:43A9): the number hl in decimal (FormatDecimalNumber, width a, into a
// 10-byte buffer on the stack) written at de by DrawStringToTilemap. af, bc, hl kept; de as the writer leaves it.
export function unusedDrawDecimalNumberToTilemap(P, cpu) {
  const sp = cpu.sp, buffer = (sp - 16) & 0xFFFF, dest = cpu.de;   // push af / bc / hl, add sp, -10
  cpu.sp = (sp - 18) & 0xFFFF;                                 // push de
  try {
    const text = callHome(P, HOME.FormatDecimalNumber, { a: cpu.a, hl: cpu.hl, de: buffer, bc: buffer }).bc;
    const r = callFar(P, FAR.Unused_05_WriteStringToTilemap, { hl: text, de: dest });
    return { de: r.de };
  } finally { cpu.sp = sp; }
}

// ---- boxes in a tilemap: tiles at hl, attributes at de, rows 32 apart ----
const BOX_FILL = 0x20, BOX_ATTR = 0x00;
const BOX_TOP = [0x02, 0x03, 0x04], BOX_SIDE = [0x05, 0x06], BOX_BOTTOM = [0x07, 0x08, 0x09];
const row = v => (v + TILEMAP_WIDTH) & 0xFFFF;
// Unused_18_DrawBox (18:43C8): a b x c box: every cell blank (tile $20, attribute 0), then its frame. Registers kept.
export function unusedDrawBox(P, tiles, attrs, width, height) {
  for (let r = height || 0x100, t = tiles, a = attrs; r > 0; r--, t = row(t), a = row(a)) {
    for (let i = 0; i < (width || 0x100); i++) { P.bus.w8(t + i, BOX_FILL); P.bus.w8(a + i, BOX_ATTR); }
  }
  unusedDrawBoxTopRow(P, tiles, width);
  let hl = row(tiles);
  let sides = (height - 2) & 0xFF;
  do { unusedDrawBoxSideRow(P, hl, width); hl = row(hl); sides = (sides - 1) & 0xFF; } while (sides);
  unusedDrawBoxBottomRow(P, hl, width);
}
// a frame row: left, b - 2 middles (0 = 256), right; returns hl after it
function frameRow(P, hl, width, [left, middle, right]) {
  P.bus.w8(hl, left); hl = (hl + 1) & 0xFFFF;
  for (let n = ((width - 2) & 0xFF) || 0x100; n > 0; n--) { P.bus.w8(hl, middle); hl = (hl + 1) & 0xFFFF; }
  P.bus.w8(hl, right);
  return (hl + 1) & 0xFFFF;
}
// Unused_18_DrawBoxTopRow (18:4414): bc, hl kept; a = the right corner, Z from the count
export function unusedDrawBoxTopRow(P, hl, width, f = 0) { frameRow(P, hl, width, BOX_TOP); return { a: BOX_TOP[2], f: FZ | FN | (f & FC) }; }
// Unused_18_DrawBoxSideRow (18:4427): the left and right edges (b apart) of a row; hl kept, a = l + b - 1
export function unusedDrawBoxSideRow(P, hl, width) {
  P.bus.w8(hl, BOX_SIDE[0]);
  const l = hl & 0xFF, off = (width - 1) & 0xFF, sum = l + off;
  P.bus.w8((hl & 0xFF00) + sum, BOX_SIDE[1]);
  return { a: sum & 0xFF, f: addFlags(off, l) };
}
// Unused_18_DrawBoxBottomRow (18:4435): hl after the row, b = 0, a = the right corner
export function unusedDrawBoxBottomRow(P, hl, width, f = 0) {
  return { hl: frameRow(P, hl, width, BOX_BOTTOM), a: BOX_BOTTOM[2], b: 0, f: FZ | FN | (f & FC) };
}

// ---- the bobbing offsets of bank $18 ----
// These push af and hl and pop them the wrong way round: they return with a:f = the caller's hl and h:l = its af.
const swapped = (cpu, out) => ({ ...out, a: cpu.h, f: cpu.l, h: cpu.a, l: cpu.f });
const tableAt = (P, table, i) => P.bus.u8((table + i) & 0xFFFF);
// Unused_18_AddBobbingOffsetXY (18:4444): d + table[frame & 15], e + ~table[(frame + 4) & 15] (one less than minus)
export function unusedAddBobbingOffsetXY(P, x, y) {
  const n = P.V.vBlankCounter;
  return { d: (x + tableAt(P, AddBobbingOffsetXYTable, n & 0x0F)) & 0xFF, e: (y + (~tableAt(P, AddBobbingOffsetXYTable, (n + 4) & 0x0F) & 0xFF)) & 0xFF };
}
// AddBobbingOffsetY (18:4478): e + table[frame & 15]
export function addBobbingOffsetY(P, y) { return { e: (y + tableAt(P, AddBobbingOffsetYTable, P.V.vBlankCounter & 0x0F)) & 0xFF }; }
// AddBobbingOffsetYLarge (18:449B): e + table[frame & 63] (a wave of -3..3)
export function addBobbingOffsetYLarge(P, y) { return { e: (y + tableAt(P, AddBobbingOffsetYLargeTable, P.V.vBlankCounter & 0x3F)) & 0xFF }; }

// ---- characters ----
const ROSTER_ENTRY_SIZE = 8, ROSTER_END = 0xFF;
// Unused_18_FindRosterEntry (18:44EF): the entry of a 8-byte-record list at hl whose first byte is a (or the $FF
// end), plus de. Returns hl.
export function unusedFindRosterEntry(P, id, hl, de) {
  for (;;) {
    const v = P.bus.u8(hl);
    if (v === id || v === ROSTER_END) return { hl: (hl + de) & 0xFFFF };
    hl = (hl & 0xFF00) + (((hl & 0xFF) + ROSTER_ENTRY_SIZE) & 0x1FF);
  }
}
const CHAR_CUSTOM = 0x84, CHAR_RECORD_LOCK = 11, CUSTOM_RECORD_LOCK = 0x3E;
const wCharRecordScratch = 0xD580, CHAR_RECORD_BLOCKS = 0x80 / 16;
// LoadCharacterRecordToBuffer (18:4507): character a's record into wCharRecordScratch (WRAM bank as mapped) via
// LoadCharacterRecordToCa80 (bank 2, into wPlayer2MainName); character $84 (the custom one) only marks its lock
// byte. Registers kept; the flags of `cp $84`.
export function loadCharacterRecordToBuffer(P, ch) {
  if (ch === CHAR_CUSTOM) { P.bus.w8(wCharRecordScratch + CHAR_RECORD_LOCK, CUSTOM_RECORD_LOCK); return { f: FZ | FN }; }
  callFar(P, FAR.LoadCharacterRecordToCa80, { a: ch });
  copyMemoryFast(P, P.A.player2MainName, wCharRecordScratch, CHAR_RECORD_BLOCKS);
  return { f: cpFlags(ch, CHAR_CUSTOM) };
}
// CheckCharacterUnlocked (18:452A): whether character a is unlocked, as the flags: a record (bit 7) compares its
// lock byte with $FF (a = that byte); ids 0-3 compare themselves with $FF (NZ: always unlocked); the others test
// save flag a * 32 (TestSaveFlag: NZ when set).
const FIRST_LOCKABLE = 4;
export function checkCharacterUnlocked(P, ch) {
  if (ch & 0x80) { const v = P.bus.u8(wCharRecordScratch + CHAR_RECORD_LOCK); return { a: v, f: cpFlags(v, 0xFF) }; }
  if (ch < FIRST_LOCKABLE) return { f: cpFlags(ch, 0xFF) };
  return { f: testSaveFlag(P, (ch << 5) & 0xFFFF) ? FH : FZ | FH };
}
// UnusedCheckCharacterIdUnlocked (18:454D): a = 1 (NZ) for ids below $10, else 0 (Z)
export function unusedCheckCharacterIdUnlocked(ch) { return ch < 0x10 ? { a: 1, f: FH } : { a: 0, f: FZ }; }
// Unused_18_CheckUnlockFlag (18:4557): bit 7 clear: Unused_18_TestUnlockFlagById; $84: NZ; any other record: a = 0
export function unusedCheckUnlockFlag(P, id) {
  if (!(id & 0x80)) return unusedTestUnlockFlagById(P, id);
  if (id !== CHAR_CUSTOM) return { a: 0, f: FZ };
  return { f: cpFlags(id, 0xFF) };
}
// Unused_18_TestUnlockFlagById (18:4564): the flag of UnlockFlagIds_18[a] (all zero in the ROM: a = 0, NZ): an odd
// id is a save flag, an even one a game flag. Returns a and the flags of the test.
export function unusedTestUnlockFlagById(P, id) {
  const at = (UnlockFlagIds_18 & 0xFF00) + (((UnlockFlagIds_18 & 0xFF) + ((id * 2) & 0xFF)) & 0x1FF);
  const flag = P.bus.u16(at), a = (flag & 0xFF) | (flag >> 8);
  if (!a) return { a, f: cpFlags(a, 0xFF) };
  if (flag & 1) return { a, f: testSaveFlag(P, flag & 0xFFFE) ? FH : FZ | FH };
  const r = callHome(P, HOME.TestGameFlag, { a, de: flag });
  return { a: r.a, f: r.f, b: r.b, c: r.c };
}

// Unused_18_MoveGridCursor (18:45CA): move the cell (d, e) of an 8 x 4 grid of cell codes at hl by the d-pad in b
// (left, right, up, down), wrapping, and walk on past cells that are not stops: $FF (again the same way), $FE / $FD
// (diagonally down-right / up-left), $FC (left), $FB (right, unless moving left). Returns d, e and a = the cell.
const GRID_COLS = 8, GRID_ROWS = 4;
const wrapGrid = (v, n) => (v & 0x80 ? n - 1 : v < n ? v : 0);
export function unusedMoveGridCursor(P, input, x, y, hl) {
  for (;;) {
    if (input & 0x20) x--; else if (input & 0x10) x++; else if (input & 0x40) y--; else if (input & 0x80) y++;
    x = wrapGrid(x & 0xFF, GRID_COLS); y = wrapGrid(y & 0xFF, GRID_ROWS);
    const index = (y * GRID_COLS + x) & 0xFF, cellCode = P.bus.u8((hl & 0xFF00) + (((hl & 0xFF) + index) & 0x1FF));
    if (cellCode === 0xFF) continue;
    if (cellCode === 0xFE) { x++; y++; continue; }
    if (cellCode === 0xFD) { x--; y--; continue; }
    if (cellCode === 0xFC) { x--; continue; }
    if (cellCode === 0xFB) {
      if (input & 0x20) return { a: 0x20, d: x, e: y, f: FH };
      x++; continue;
    }
    return { a: cellCode, d: x, e: y, f: cpFlags(cellCode, 0xFB) };
  }
}

export const HOOKS = [
  [BANK_CURSORBOX, 0x4328, hook((P, c) => { unusedLoadAllIndexedPalettes(P, c.d); })],
  [BANK_CURSORBOX, 0x4339, hook((P, c) => { loadIndexedPalette18(P, c.a, c.d); })],
  [BANK_CURSORBOX, 0x4353, hook(P => unusedFlushBgMapShadowToVram(P))],
  [BANK_CURSORBOX, 0x437C, hook((P, c) => loadMenuHandCursorGfx(P, c.hl, c.d, c.e))],
  [BANK_CURSORBOX, 0x438D, () => {}],                        // Unused_18_LoadFontTiles: ret
  [BANK_CURSORBOX, 0x439A, hookGen(P => unusedRenderProportionalTextAt32(P))],
  [BANK_CURSORBOX, 0x43A2, (P, c) => { const r = unusedDrawStringToTilemap(P, {}); for (const k of ["a", "f", "b", "c", "d", "e", "h", "l"]) c[k] = r[k]; }],
  [BANK_CURSORBOX, 0x43A6, hook((P, c) => unusedWriteTilemapByteAdvance(P, c.a, c.de))],
  [BANK_CURSORBOX, 0x43A9, hook((P, c) => unusedDrawDecimalNumberToTilemap(P, c))],
  [BANK_CURSORBOX, 0x43C8, hook((P, c) => { unusedDrawBox(P, c.hl, c.de, c.b, c.c); })],
  [BANK_CURSORBOX, 0x4414, hook((P, c) => unusedDrawBoxTopRow(P, c.hl, c.b, c.f))],
  [BANK_CURSORBOX, 0x4427, hook((P, c) => unusedDrawBoxSideRow(P, c.hl, c.b))],
  [BANK_CURSORBOX, 0x4435, hook((P, c) => unusedDrawBoxBottomRow(P, c.hl, c.b, c.f))],
  [BANK_CURSORBOX, 0x4444, hook((P, c) => swapped(c, unusedAddBobbingOffsetXY(P, c.d, c.e)))],
  [BANK_CURSORBOX, 0x4478, hook((P, c) => swapped(c, addBobbingOffsetY(P, c.e)))],
  [BANK_CURSORBOX, 0x449B, hook((P, c) => swapped(c, addBobbingOffsetYLarge(P, c.e)))],
  [BANK_CURSORBOX, 0x44EE, () => {}],                        // Unused_18_StubNop
  [BANK_CURSORBOX, 0x44EF, hook((P, c) => unusedFindRosterEntry(P, c.a, c.hl, c.de))],
  [BANK_CURSORBOX, 0x4507, hook((P, c) => loadCharacterRecordToBuffer(P, c.a))],
  [BANK_CURSORBOX, 0x452A, hook((P, c) => checkCharacterUnlocked(P, c.a))],
  [BANK_CURSORBOX, 0x454D, hook((P, c) => unusedCheckCharacterIdUnlocked(c.a))],
  [BANK_CURSORBOX, 0x4557, hook((P, c) => unusedCheckUnlockFlag(P, c.a))],
  [BANK_CURSORBOX, 0x4564, hook((P, c) => unusedTestUnlockFlagById(P, c.a))],
  [BANK_CURSORBOX, 0x45CA, hook((P, c) => unusedMoveGridCursor(P, c.b, c.d, c.e, c.hl))],
];
