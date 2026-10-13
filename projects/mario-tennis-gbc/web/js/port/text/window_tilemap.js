// The window engine's shadow map: cell addresses, single cells, window cells, whole-map and row copies to VRAM,
// and the dialogue window's redraw (bank $05, src/engine/text/window_tilemap_05.asm). Port of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses are its own.
//
// The engine draws into a 32x32 shadow map named by wShadowTilemapPtr / wShadowTilemapBank (its own map at $D000
// in WRAM bank 5 by default; a screen's map in bank 3 after ResetScreenAndTextWindows), attributes $400 after the
// tiles. Covered by out/port/story1.mtrec, out/port/menus1.mtrec and web/tests/port/routines_text.mjs.
import {
  FLAG, WRAM_TEXT, PAD, vBGMap0, VRAM_BANK1, rVBK, rVDMA_SRC_HIGH, mapped, hook, testFlagF, advanceFrame,
  queueVRAMCopy, clearMemory16, pushWramBank, addFlags, Z, H, hi, lo,
} from "./common.js";
import { resetTextWindowState, getWindowStructPtr } from "./window_alloc.js";
import { fetchShortText } from "./dialogue.js";
import { redrawWindowRows, redrawWindowRowsPadded } from "./rows.js";

// InitTextWindows (05:4096): ResetTextWindowState
export function initTextWindows(P) { resetTextWindowState(P); }

// FetchShortTextToBuffer (05:409A): short text `textId` (FetchShortText, into wShortTextBuffer in WRAM bank 5),
// copied with its $00 to `dest`
export function fetchShortTextToBuffer(P, textId, dest) {
  const oldBank = pushWramBank(P, WRAM_TEXT);
  fetchShortText(P, textId);
  for (let src = P.A.shortTextBuffer, d = dest; ; src++, d = (d + 1) & 0xFFFF) {
    const ch = P.bus.u8(src);
    P.bus.w8(d, ch);
    if (ch === 0) break;
  }
  P.wramBank(oldBank);
}

// Unused_05_ClearWindowGlyphPage (05:40BE): clear the window engine's own map (tiles and attributes, WRAM bank 5).
// Leaves a = the bank put back, c = 0, hl = $D800.
export function clearWindowGlyphPage(P) {
  const oldBank = pushWramBank(P, WRAM_TEXT);
  clearMemory16(P, 0xD000, 0x80);
  P.wramBank(oldBank);
  return { a: oldBank, c: 0, hl: 0xD800 };
}

// Unused_05_QueueGlyphPageDMAOnA (05:40D5): while A is held, DMA the window engine's tile map (bank 5 $D000) to
// $9800 (37 blocks). Returns the registers it leaves.
export function queueGlyphPageDMAOnA(P, entryF) {
  const pad = P.V.playerInputFlags;
  if (!(pad & PAD.A)) return { a: pad, f: Z | H | (entryF & 0x10) };      // bit PADB_A, a
  P.bus.w8(rVBK, 0);
  P.wramBank(WRAM_TEXT);
  const regs = [0xD0, 0x00, 0x18, 0x00, 0x24];                // source $D000, destination $1800 ($9800), length $24
  regs.forEach((v, i) => P.bus.w8(rVDMA_SRC_HIGH + i, v));
  return { a: 0x24, f: Z, bc: 0xD000, de: 0x1800, hl: rVDMA_SRC_HIGH + 4 };
}

// WriteTileToShadowMapCell (05:40FB): tile `tile` (not 0) into map cell (col, row). Leaves WRAM bank 5 mapped.
export function writeTileToShadowMapCell(P, tile, col, row) {
  P.wramBank(WRAM_TEXT);
  const cell = getTilemapCellAddress(P, col, row);
  if (tile) P.bus.w8(cell, tile);
}
// Unused_05_ReadShadowMapCell (05:4111): reads map cell (col, row) — and drops the value (pop af). Leaves WRAM bank 5.
export function readShadowMapCell(P, col, row) {
  P.wramBank(WRAM_TEXT);
  P.bus.u8(getTilemapCellAddress(P, col, row));
}

// GetTilemapCellAddress (05:4122): the shadow-map address of cell (col & 31, row & 31)
export function getTilemapCellAddress(P, col, row) {
  return (mapped(P).shadowTilemapPtr + (row & 0x1F) * 32 + (col & 0x1F)) & 0xFFFF;
}

// Unused_05_CopyVisibleTilemapToVRAM (05:4146): the 19 map rows from the camera's row of the map at $D000 in WRAM
// bank `bank` (left mapped) to $9800, tiles then attributes, split in two where the band wraps past row 32
export function copyVisibleTilemapToVRAM(P, bank) {
  P.wramBank(bank);
  for (const [src, dest] of [[0xD000, vBGMap0], [0xD400, vBGMap0 + VRAM_BANK1]]) {
    const row = hi(mapped(P).cameraY) & 0x1F, offset = row * 32;
    const over = row + 0x12 - 0x20;                          // rows past the bottom of the plane
    if (over <= 0) { queueVRAMCopy(P, src + offset, dest + offset, 0x26); continue; }
    queueVRAMCopy(P, src + offset, dest + offset, (0x26 - over * 2) & 0xFF);
    queueVRAMCopy(P, src, dest, (over * 2) & 0xFF);
  }
}
// Unused_05_QueueFullTilemapCopy (05:41C6) / Unused_05_QueueFullAttrmapCopy (05:41DF): the whole tile (attribute)
// plane at $D000 ($D400) in WRAM bank `bank` (left mapped) to $9800 (in VRAM bank 1)
export function queueFullTilemapCopy(P, bank) { P.wramBank(bank); queueVRAMCopy(P, 0xD000, vBGMap0, 0x40); }
export function queueFullAttrmapCopy(P, bank) { P.wramBank(bank); queueVRAMCopy(P, 0xD400, vBGMap0 + VRAM_BANK1, 0x40); }
// Unused_05_CopyTilemapRowToVRAM (05:41F8): map row `row` (mod 32) of WRAM bank `bank`, tiles and attributes.
// Returns the registers the last QueueVRAMCopy leaves.
export function copyTilemapRowToVRAM(P, row, bank) {
  P.wramBank(bank);
  const offset = (row & 0x1F) * 32;
  queueVRAMCopy(P, 0xD000 + offset, vBGMap0 + offset, 2, { b: offset >> 8 });
  return queueVRAMCopy(P, 0xD400 + offset, vBGMap0 + VRAM_BANK1 + offset, 2, { b: offset >> 8 });
}
// Unused_05_CopyTilemapRowsToVRAM (05:4239): `count` map rows from `row` of WRAM bank `bank` (nothing for 0).
// Returns the registers it leaves.
export function copyTilemapRowsToVRAM(P, row, bank, count) {
  if (!count) return { a: 0, f: Z, d: row };
  P.wramBank(bank);
  const offset = (row * 32) & 0xFFFF, blocks = (count * 2) & 0xFF;
  queueVRAMCopy(P, (0xD000 + offset) & 0xFFFF, (vBGMap0 + offset) & 0xFFFF, blocks, { b: offset >> 8 });
  const de = (vBGMap0 + VRAM_BANK1 + offset) & 0xFFFF;
  const r = queueVRAMCopy(P, (0xD400 + offset) & 0xFFFF, de, blocks, { b: offset >> 8, a: blocks });
  return { ...r, de };
}
// Unused_05_CopyTilemapRowsAnimated (05:4284): `count` map rows from `row` (WRAM bank 5), 7 rows per frame, each
// piece split where it passes row 32
export function* copyTilemapRowsAnimated(P, row, count) {
  let last = count;                                           // the size of the last piece (count - 7, - 14, ...)
  if (count - 7 > 0) last = count - 14 > 0 ? count - 14 : count - 7;
  last &= 0xFF;
  let pieces = 0;
  for (let a = count; ; ) { pieces++; a -= 7; if (a <= 0) break; }
  for (let first = row; pieces > 0; pieces--, first = (first + 7) & 0xFF) {
    let n = pieces === 1 ? last : 7;
    if (first < 0x20) {
      const end = first + n;
      if ((end & 0xFF) >= 0x20) {                             // the part past row 32 goes to the top
        const over = ((end & 0xFF) - 0x20) & 0xFF;
        copyTilemapRowsToVRAM(P, 0, WRAM_TEXT, over);
        n = (n - over) & 0xFF;
      }
    }
    copyTilemapRowsToVRAM(P, first & 0x1F, WRAM_TEXT, n);
    yield* advanceFrame(P);
  }
}

// RedrawWindowRowsPaddedThunk (05:42E9) / RedrawWindowRowsThunk (05:42ED)
export function* redrawWindowRowsPaddedThunk(P, id) { yield* redrawWindowRowsPadded(P, id); }
export function* redrawWindowRowsThunk(P, id) { yield* redrawWindowRows(P, id); }
// RedrawActiveTextWindow (05:42F1): redraw the dialogue window's rows (at least 7) now — unless
// FLAG_DEBUG_STATIC_TEXT_WINDOW. Returns the flags it leaves (those of the flag test).
export function* redrawActiveTextWindow(P) {
  const f = testFlagF(P, FLAG.DEBUG_STATIC_TEXT_WINDOW);
  if (f & Z) yield* redrawWindowRowsPadded(P, mapped(P).dialogueWindowId);
  return { f };
}

// GetWindowCellOffset (05:4300): the map offset of cell (dcol, drow) inside window `id` (wrapping at 32).
// Returns the registers it leaves (de = hl = the offset).
export function getWindowCellOffset(P, id, dcol, drow) {
  const s = getWindowStructPtr(id);
  const col = (P.bus.u8(s) + dcol) & 0x1F, row = (P.bus.u8(s + 1) + drow) & 0x1F;
  const offset = row * 32 + col, low = ((row * 32) & 0xFF) + col;
  return { offset, a: low & 0xFF, f: addFlags((row * 32) & 0xFF, col), de: offset, hl: offset };
}
// WriteWindowCellTileAttr (05:431D): tile and attribute into cell (dcol, drow) of window `id`, in WRAM bank
// wShadowTilemapBank (put back after)
export function writeWindowCellTileAttr(P, id, dcol, drow, tile, attr) {
  const R = mapped(P);
  const cell = (R.shadowTilemapPtr + getWindowCellOffset(P, id, dcol, drow).offset) & 0xFFFF;
  const oldBank = pushWramBank(P, R.shadowTilemapBank);
  P.bus.w8(cell, tile);
  P.bus.w8((cell + 0x400) & 0xFFFF, attr);
  P.wramBank(oldBank);
}
// ReadWindowCellTileAttr (05:4346): reads the tile and attribute of a window cell — into bc, which it then pops:
// nothing comes back (WriteStringToWindow's dakuten check sees its own c)
export function readWindowCellTileAttr(P, id, dcol, drow) {
  const R = mapped(P);
  const cell = (R.shadowTilemapPtr + getWindowCellOffset(P, id, dcol, drow).offset) & 0xFFFF;
  const oldBank = pushWramBank(P, R.shadowTilemapBank);
  P.bus.u8(cell); P.bus.u8((cell + 0x400) & 0xFFFF);
  P.wramBank(oldBank);
}

export const HOOKS = [
  hook(5, 0x4096, P => { initTextWindows(P); }),
  hook(5, 0x409A, (P, r) => { fetchShortTextToBuffer(P, r.hl, r.de); }),
  hook(5, 0x40BE, P => clearWindowGlyphPage(P)),
  hook(5, 0x40D5, (P, r) => queueGlyphPageDMAOnA(P, r.f)),
  hook(5, 0x40FB, (P, r) => { writeTileToShadowMapCell(P, r.a, r.d, r.e); }),
  hook(5, 0x4111, (P, r) => { readShadowMapCell(P, r.d, r.e); }),
  hook(5, 0x4122, (P, r) => ({ de: getTilemapCellAddress(P, r.d, r.e) })),
  hook(5, 0x4146, (P, r) => { copyVisibleTilemapToVRAM(P, r.b); }),
  hook(5, 0x41C6, (P, r) => { queueFullTilemapCopy(P, r.b); }),
  hook(5, 0x41DF, (P, r) => { queueFullAttrmapCopy(P, r.b); }),
  hook(5, 0x41F8, (P, r) => copyTilemapRowToVRAM(P, r.a, r.b)),
  hook(5, 0x4239, (P, r) => copyTilemapRowsToVRAM(P, r.a, r.b, r.c)),
  hook(5, 0x4284, (P, r) => copyTilemapRowsAnimated(P, r.a, r.c)),
  hook(5, 0x42E9, (P, r) => redrawWindowRowsPaddedThunk(P, r.a)),
  hook(5, 0x42ED, (P, r) => redrawWindowRowsThunk(P, r.a)),
  hook(5, 0x42F1, P => redrawActiveTextWindow(P)),
  hook(5, 0x4300, (P, r) => { const o = getWindowCellOffset(P, r.a, r.d, r.e); return { a: o.a, f: o.f, de: o.de, hl: o.hl }; }),
  hook(5, 0x431D, (P, r) => { writeWindowCellTileAttr(P, r.a, r.d, r.e, r.c, r.b); }),
  hook(5, 0x4346, (P, r) => { readWindowCellTileAttr(P, r.a, r.d, r.e); }),
];
