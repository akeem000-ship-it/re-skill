// Scrolling a 64x64-tile map through the 32x32 BG map: one BG row or column at a time is taken from the map buffer
// (wMapBuffer64: attributes in WRAM bank 2, tiles in bank 3) into a staging buffer, which ProcessBGBlitQueue
// (memory.js) writes to VRAM in the next VBlank (numberfont_00.asm).
// Port of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses.
// Covered by the routine tests (web/tests/port/routines_home_system.mjs) and the lockstep on out/engine/*.mtrec.
// Not ported: the number font and its Unused_00_* tile renderer (nothing calls them).
import { FLAG_Z, setRegs } from "./cpu.js";

const MAP_BUFFER_64 = 0xD000, MAP_SIZE_64 = 64, BG_MAP_SIZE = 32;
const BG_MAP_9800 = 0x9800;
const WRAM_COURT_PLANES = 2, WRAM_SCREEN = 3;                     // the buffer's attribute and tile halves
const STAGING_TILES = 0x40;                                       // tile staging = attribute staging + $40

// the camera's tile position (the high bytes of wCameraX / wCameraY) plus a tile offset
const cameraTileX = (P, dx) => ((P.V.cameraX >> 8) + dx) & 0xFF;
const cameraTileY = (P, dy) => ((P.V.cameraY >> 8) + dy) & 0xFF;

// GetMapBufferAddr64 (00:220E): the buffer address of the cell b columns, c rows from the camera (wrapping at 64).
// Leaves de = wMapBuffer64, a = the column, F = Z when the column is 0.
export function getMapBufferAddr64(P, dx, dy) {
  const row = cameraTileY(P, dy) & (MAP_SIZE_64 - 1), col = cameraTileX(P, dx) & (MAP_SIZE_64 - 1);
  return MAP_BUFFER_64 + row * MAP_SIZE_64 + col;
}

// copy the 32 cells of a buffer row from src (wrapping within its 64) into a staging row from column `start` on
// (wrapping within its 32). Returns the source address after, and whether it wrapped (the ROM's b is then $FF).
function copyRow(P, src, staging, start) {
  let wrapped = false, col = start;
  for (let i = 0; i < BG_MAP_SIZE; i++) {
    P.bus.w8(staging + col, P.bus.u8(src));
    src = (src + 1) & 0xFFFF;
    if ((src & (MAP_SIZE_64 - 1)) === 0) { src = (src - MAP_SIZE_64) & 0xFFFF; wrapped = true; }
    col = (col + 1) & (BG_MAP_SIZE - 1);
  }
  return { src, wrapped };
}
// BlitBGRowFrom64 (00:222C): stage the BG map row c rows below the camera (its 32 cells from column b on) for the
// next VBlank: wBGRowBlitDest, wBGRowBlitAttrs / wBGRowBlitTiles, hBGRowBlitPending. Leaves WRAM bank 3 mapped.
// Returns the registers it leaves.
export function blitBGRowFrom64(P, dx, dy) {
  const { V, A } = P;
  V.bGRowBlitDest = BG_MAP_9800 + (cameraTileY(P, dy) & (BG_MAP_SIZE - 1)) * BG_MAP_SIZE;
  const start = cameraTileX(P, dx) & (BG_MAP_SIZE - 1);
  const src = getMapBufferAddr64(P, dx, dy);
  P.wramBank(WRAM_COURT_PLANES);
  copyRow(P, src, A.bGRowBlitAttrs, start);
  P.wramBank(WRAM_SCREEN);
  const end = copyRow(P, src, A.bGRowBlitTiles, start);
  V.bGRowBlitPending = 1;
  return { a: 1, b: end.wrapped ? 0xFF : STAGING_TILES, c: 0, de: A.bGRowBlitAttrs + STAGING_TILES + start, hl: end.src };
}

// copy the 32 cells of a buffer column from src (64 apart, wrapping within the buffer's 4 KB) into a staging
// column from row `start` on (wrapping within its 32). Returns the source address after.
function copyColumn(P, src, staging, start) {
  let row = start;
  for (let i = 0; i < BG_MAP_SIZE; i++) {
    P.bus.w8(staging + row, P.bus.u8(src));
    src = (src + MAP_SIZE_64) & 0xFFFF;
    src = (src & ~0x2000) | 0x1000;                              // res 5, h / set 4, h: back into $D000-$DFFF
    row = (row + 1) & (BG_MAP_SIZE - 1);
  }
  return src;
}
// BlitBGColumnFrom64 (00:2299): stage the BG map column b columns right of the camera (its 32 cells from row c on)
// for the next VBlank: wBGColumnBlitX, wBGColumnBlitAttrs / wBGColumnBlitTiles, hBGColumnBlitPending. Leaves WRAM
// bank 3 mapped. Returns the registers it leaves.
export function blitBGColumnFrom64(P, dx, dy) {
  const { V, A } = P;
  V.bGColumnBlitX = cameraTileX(P, dx) & (BG_MAP_SIZE - 1);
  const start = cameraTileY(P, dy) & (BG_MAP_SIZE - 1);
  const src = getMapBufferAddr64(P, dx, dy);
  P.wramBank(WRAM_COURT_PLANES);
  copyColumn(P, src, A.bGColumnBlitAttrs, start);
  P.wramBank(WRAM_SCREEN);
  const end = copyColumn(P, src, A.bGColumnBlitTiles, start);
  V.bGColumnBlitPending = 1;
  return { a: 1, bc: 0, de: A.bGColumnBlitAttrs + STAGING_TILES + start, hl: end };
}

export const HOOKS = [
  [0, 0x220E, (P, c) => {
    const col = cameraTileX(P, c.b) & (MAP_SIZE_64 - 1);
    setRegs(c, { hl: getMapBufferAddr64(P, c.b, c.c), de: MAP_BUFFER_64, a: col, f: col ? 0 : FLAG_Z });
  }],
  [0, 0x222C, (P, c) => setRegs(c, blitBGRowFrom64(P, c.b, c.c))],
  [0, 0x2299, (P, c) => setRegs(c, blitBGColumnFrom64(P, c.b, c.c))],
];
