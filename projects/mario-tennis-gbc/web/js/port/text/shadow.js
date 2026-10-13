// Putting the scenery back under windows (the 64x64 map buffer -> the window engine's shadow map), window rects
// and some rectangle helpers (bank $05, src/engine/text/shadow_05.asm). Port of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses are its own.
// Covered by out/port/story1.mtrec (dialogue over the field) and web/tests/port/routines_text.mjs.
import {
  WRAM_TEXT, WRAM_SCREEN, WRAM_COURT_PLANES, wMapBuffer64, mapped, hook, advanceFrame, lcdOn, copyMemoryFast,
  pushWramBank, addFlags, Z, H, hi,
} from "./common.js";
import { getWindowStructPtr, drawTextWindowFrame, freeWindow } from "./window_alloc.js";
import { createMenuWindowFromText } from "./window_create.js";
import { setWindowTextId } from "./window_text.js";
import { runMenuSelection } from "./window_create.js";
import { closeWindow } from "./rows.js";
import { getTilemapCellAddress } from "./window_tilemap.js";

const wTilemapRowStage = 0xC6A0;                             // 32 bytes: one map row on its way
const Text_30_26 = 0x001A;

// RestoreShadowTilemap (05:436F): the whole visible band of the map back into the shadow map (keeps the WRAM bank)
export function* restoreShadowTilemap(P) {
  const oldBank = P.V.wramBank;
  yield* restoreAllShadowTilemapRows(P);
  P.wramBank(oldBank);
}
// RestoreAllShadowTilemapRows (05:4383): 20 map rows from the camera's, 5 per frame while the LCD is on.
// Returns the registers it leaves (de/hl those of the last row's copy).
export function* restoreAllShadowTilemapRows(P) {
  let row = hi(mapped(P).cameraY) & 0x3F, last = {};
  for (let batch = 0; batch < 4; batch++) {
    for (let i = 0; i < 5; i++) { last = restoreShadowTilemapRow(P, row); row = (row + 1) & 0x3F; }
    if (lcdOn(P)) yield* advanceFrame(P);
  }
  return { a: row, f: Z | 0x40, b: 0, c: 0, de: last.de, hl: last.hl };
}
// RestoreTilemapUnderWindow (05:43A8): the map rows window `id` covers (the row taken 32 further on when the
// camera is below it), back into the shadow map
export function restoreTilemapUnderWindow(P, id) {
  const s = getWindowStructPtr(id);
  let row = P.bus.u8(s + 1);
  const height = P.bus.u8(s + 3);
  if (hi(mapped(P).cameraY) > row) row = (row + 0x20) & 0xFF;
  for (let n = height || 256; n > 0; n--, row = (row + 1) & 0xFF) restoreShadowTilemapRow(P, row);
}
// RestoreShadowTilemapRow (05:43D2): map row `row` (mod 64) of the 64-wide map buffer, 32 cells from the camera's
// column (wrapping at 64), into shadow-map row row & 31: tiles from WRAM bank 3 into $D000, attributes from bank 2
// into $D400 (bank 5), through wTilemapRowStage. Leaves WRAM bank 5; returns the registers the last copy leaves.
export function restoreShadowTilemapRow(P, row) {
  const { bus } = P, R = mapped(P);
  const mapRow = row & 0x3F;
  const src = (wMapBuffer64 + mapRow * 64 + (hi(R.cameraX) & 0x3F)) & 0xFFFF;
  const stageRow = (from, bank) => {                          // 32 cells from `from` into the stage, rotated by column
    P.wramBank(bank);
    let s = from, d = wTilemapRowStage + (s & 0x1F);
    for (let n = 0; n < 32; n++) {
      bus.w8(d++, bus.u8(s));
      s = (s + 1) & 0xFFFF;
      if ((s & 0x1F) === 0) {
        d = wTilemapRowStage;
        if ((s & 0x3F) === 0) s = ((s - 1) & 0xFFC0);         // past the end of the 64-cell row: back to its start
      }
    }
  };
  stageRow(src, WRAM_SCREEN);
  P.wramBank(WRAM_TEXT);
  copyMemoryFast(P, wTilemapRowStage, 0xD000 + (mapRow & 0x1F) * 32, 2, { b: 0 });
  stageRow(src, WRAM_COURT_PLANES);
  P.wramBank(WRAM_TEXT);
  return copyMemoryFast(P, wTilemapRowStage, 0xD400 + (mapRow & 0x1F) * 32, 2, { b: 0, a: WRAM_TEXT });
}

// Unused_05_RefreshShadowTilemapFromMapBuffer (05:44A3): 21 rows of 32 bytes from wShadowTilemapReadOffset (+ the
// scroll's row) into the shadow map, stopping at the end of WRAM. Nothing calls it.
export function refreshShadowTilemapFromMapBuffer(P) {
  const R = mapped(P), oldBank = pushWramBank(P, WRAM_TEXT);
  const bank = R.shadowTilemapBank, base = R.shadowTilemapPtr, readOffset = R.shadowTilemapReadOffset;
  P.wramBank(bank);
  const rowOffset = (P.V.scrollY & 0xF8) * 4;
  let de = (rowOffset + base) & 0xFFFF, hl = (rowOffset + readOffset) & 0xFFFF;
  for (let n = 0x15; n > 0; n--) {
    const r = copyMemoryFast(P, hl, de, 2, { b: n });
    hl = r.hl; de = r.de;
    if (hi(hl) >= 0xE0 || hi(de) >= 0xE0) break;
  }
  P.wramBank(oldBank);
}
// Unused_05_GetCameraTileRow (05:44F3): the camera's map row (mod 64), with the flags of its `and`
export function getCameraTileRow(P) { const a = hi(mapped(P).cameraY) & 0x3F; return { a, f: (a ? 0 : Z) | H }; }

// Unused_05_SetFixedMenuWindowTextId (05:44F9): set a window's text id — the window being hWramBank's value (b is
// loaded from a = hWramBank) — and remember it in wFixedMenuWindowId. Returns a = that value.
export function setFixedMenuWindowTextId(P, textId) {
  const id = P.V.wramBank;
  setWindowTextId(P, id, textId);
  P.wramBank(id);
  mapped(P).fixedMenuWindowId = id;
  return id;
}
// Unused_05_RunFixedTextMenu (05:4510): a menu from Text_30_26 at (d, e); returns the row chosen. Closes it and
// the wFixedMenuWindowId window.
export function* runFixedTextMenu(P, col, row) {
  const R = mapped(P), oldBank = P.V.wramBank;
  createMenuWindowFromText(P, Text_30_26, col, row);
  yield* restoreShadowTilemap(P);
  const choice = yield* runMenuSelection(P);
  yield* closeWindow(P, R.menuWindowId);
  yield* closeWindow(P, R.fixedMenuWindowId);
  P.wramBank(oldBank);
  return choice;
}

// SetWindowRect (05:4538): column and row (mod 32), width and height into the struct at hl. Returns the a (row)
// and flags it leaves.
export function setWindowRect(P, struct, col, row, width, height) {
  P.bus.w8(struct, col & 0x1F); P.bus.w8(struct + 1, row & 0x1F); P.bus.w8(struct + 2, width); P.bus.w8(struct + 3, height);
  return { a: row & 0x1F, f: (row & 0x1F ? 0 : Z) | H };
}
// DrawTextWindowFrameSaveRegs (05:4546): DrawTextWindowFrame
export function drawTextWindowFrameSaveRegs(P, id) { drawTextWindowFrame(P, id); }

// Unused_05_DrawTileAttrRect (05:4552): a rectangle record at hl — skip byte, column, row, width, height, then
// (tile, attribute) pairs row by row — into the shadow map (mapped WRAM bank), wrapping at the row's end
export function drawTileAttrRect(P, record) {
  const { bus } = P;
  let col = bus.u8(record + 1), row = bus.u8(record + 2);
  const width = bus.u8(record + 3), height = bus.u8(record + 4);
  let p = record + 5;
  for (let r = height || 256; r > 0; r--, row = (row + 1) & 0xFF) {
    let cell = getTilemapCellAddress(P, col, row);
    for (let n = width || 256; n > 0; n--) {
      bus.w8(cell, bus.u8(p++));
      bus.w8((cell + 0x400) & 0xFFFF, bus.u8(p++));
      if ((cell & 0x1F) === 0x1F) cell = (cell - 0x20) & 0xFFFF;
      cell = (cell + 1) & 0xFFFF;
    }
  }
}
// Unused_05_ClearShadowMapRect (05:4590): the rectangle of a record at hl (skip byte, column, row, width, height) to
// tile 0. Leaves hl past the record header.
export function clearShadowMapRect(P, record) {
  const { bus } = P;
  const col = bus.u8(record + 1), width = bus.u8(record + 3), height = bus.u8(record + 4);
  let row = bus.u8(record + 2);
  for (let r = height || 256; r > 0; r--, row = (row + 1) & 0xFF) {
    for (let n = 0, c = col; n < (width || 256); n++, c = (c + 1) & 0xFF) bus.w8(getTilemapCellAddress(P, c, row), 0);
  }
  return (record + 5) & 0xFFFF;
}

// Unused_05_CloseMenuWindow (05:45BA): free a menu window and pop the menu stack. Its second FreeWindow leaves hl
// past the struct, so it then looks at the state of the *next* window (+12) to decide whether to pop.
export function closeMenuWindow(P, id) {
  const R = mapped(P), { bus } = P;
  if (freeWindow(P, id).a === 0xFF) return;
  const next = (freeWindow(P, id).hl + 4) & 0xFFFF;
  R.glyphBufferHoldCount = (R.glyphBufferHoldCount - 1) & 0xFF;
  if (!(bus.u8(next) & 0x02)) return;
  if (R.menuDepth) R.menuCursorRow = bus.u8(P.A.menuStack + (((R.menuDepth - 1) * 2) & 0xFF)) & 0x0F;
  R.menuDepth = (R.menuDepth - 1) & 0xFF;
  if (R.menuDepth === 0xFF) return;
  const p = P.A.menuStack + ((R.menuDepth * 2) & 0xFF);
  R.menuRowCount = ((bus.u8(p) << 24 >> 24) >> 4) & 0x0F;
  R.menuWindowId = bus.u8(p + 1) & 0x0F;
}

export const HOOKS = [
  hook(5, 0x436F, P => restoreShadowTilemap(P)),
  hook(5, 0x4383, P => restoreAllShadowTilemapRows(P)),
  hook(5, 0x43A8, (P, r) => { restoreTilemapUnderWindow(P, r.a); }),
  hook(5, 0x43D2, (P, r) => restoreShadowTilemapRow(P, r.a)),
  hook(5, 0x44A3, P => { refreshShadowTilemapFromMapBuffer(P); }),
  hook(5, 0x44F3, P => getCameraTileRow(P)),
  hook(5, 0x44F9, (P, r) => ({ a: setFixedMenuWindowTextId(P, r.hl) })),
  hook(5, 0x4510, (P, r) => (function* () { return { a: yield* runFixedTextMenu(P, r.d, r.e) }; })()),
  hook(5, 0x4538, (P, r) => setWindowRect(P, r.hl, r.d, r.e, r.b, r.c)),
  hook(5, 0x4546, (P, r) => { drawTextWindowFrameSaveRegs(P, r.a); }),
  hook(5, 0x4552, (P, r) => { drawTileAttrRect(P, r.hl); }),
  hook(5, 0x4590, (P, r) => ({ hl: clearShadowMapRect(P, r.hl) })),
  hook(5, 0x45BA, (P, r) => { closeMenuWindow(P, r.a); }),
];
