// Small UI helpers of bank 0: proportional menu text, copying a text rectangle, window frames, the menu cursor,
// countdown timers and a 24x32 sprite (timer_00.asm; EnableTimerInterrupt, also there, is in vblank.js).
// Port of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses.
// Covered by the routine tests (web/tests/port/routines_home_system.mjs) and the lockstep on out/engine/*.mtrec.
// Not ported: the Unused_00_* routines (deferred tilemap copy, text and number drawing, cursor moves by d-pad).
import { FLAG_Z, FLAG_N, FLAG_H, FLAG_C, setRegs, preserving, spAddFlags } from "./cpu.js";

const TILEMAP_WIDTH = 32;
const PADF_RIGHT = 0x10, PADF_LEFT = 0x20;
const OAM_XFLIP = 0x20;
// window frame tiles (the menu font's border pieces), and the blank tile inside
const FRAME_BLANK = 0x20, FRAME_TOP_LEFT = 0x02, FRAME_TOP = 0x03, FRAME_TOP_RIGHT = 0x04, FRAME_LEFT = 0x05;
const FRAME_RIGHT = 0x06, FRAME_BOTTOM_LEFT = 0x07, FRAME_BOTTOM = 0x08, FRAME_BOTTOM_RIGHT = 0x09;
const ATTR_PRIORITY = 0x80;
const SPRITE_QUEUE_FULL = 0x89;                                  // fewer than 6 OAM entries left in the buffer
const OAM_ENTRY = 4;
// routines other parts of the port own, still run as the ROM's code (they become direct calls once ported)
const BANK_PROPORTIONAL_TEXT = 0x05, RenderProportionalTextAt = 0x5DB3;
const PROPORTIONAL_MENU_STYLE = 0x11;

// RenderProportionalMenuText (00:2A9E): RenderProportionalTextAt with the menu style (c = $11), far. Leaves its
// a, f, de, hl; bc kept.
export function renderProportionalMenuText(P) {
  const sp = P.cpu.sp;                                           // FarCall hands the callee F from `ld hl, sp+5`
  return P.callRom(BANK_PROPORTIONAL_TEXT, RenderProportionalTextAt, { c: PROPORTIONAL_MENU_STYLE, f: spAddFlags((sp - 12) & 0xFFFF, 5) });
}

// CopyTextRect (00:2B46): copy `rows` rows of `width` bytes from src (contiguous) to the tile map at dest (rows
// 32 apart). A count of 0 means 256. Returns the registers it leaves: hl after the source, de = dest + 32 * rows,
// a = e, c = 0, b = width.
export function copyTextRect(P, src, dest, width, rows) {
  const { bus } = P;
  let rowStart = dest, r = rows;
  do {
    let n = width, at = rowStart;
    do {
      bus.w8(at, bus.u8(src));
      src = (src + 1) & 0xFFFF; at = (at + 1) & 0xFFFF;
      n = (n - 1) & 0xFF;
    } while (n);
    rowStart = (rowStart + TILEMAP_WIDTH) & 0xFFFF;
    r = (r - 1) & 0xFF;
  } while (r);
  return { hl: src, de: rowStart, a: rowStart & 0xFF, b: width, c: 0 };
}

// DrawWindowFrame (00:2B68): a framed window `width` x `height` tiles: the tiles at tiles (a map in WRAM, rows 32
// apart) and the attribute wWindowFrameAttr at attrs, all blank inside; then the border (DrawWindowFrameTop,
// DrawWindowFrameSides, DrawWindowFrameBottom). Counts of 0 mean 256 (and a height of 2 draws 256 side rows, as
// the ROM does). Registers kept. DrawWindowFramePriority (00:2B5C) / DrawWindowFrameNoPriority (00:2B63) set the
// attribute first (BG-over-sprites priority or none) and leave a = it.
export function drawWindowFrame(P, tiles, attrs, width, height) {
  const { bus, V } = P;
  let rowTiles = tiles, rowAttrs = attrs, r = height;
  do {
    let n = width, t = rowTiles, at = rowAttrs;
    do {
      bus.w8(t, FRAME_BLANK); bus.w8(at, V.windowFrameAttr);
      t = (t + 1) & 0xFFFF; at = (at + 1) & 0xFFFF;
      n = (n - 1) & 0xFF;
    } while (n);
    rowTiles = (rowTiles + TILEMAP_WIDTH) & 0xFFFF; rowAttrs = (rowAttrs + TILEMAP_WIDTH) & 0xFFFF;
    r = (r - 1) & 0xFF;
  } while (r);
  drawWindowFrameTop(P, tiles, width);
  let row = (tiles + TILEMAP_WIDTH) & 0xFFFF, sides = (height - 2) & 0xFF;
  do {
    drawWindowFrameSides(P, row, width);
    row = (row + TILEMAP_WIDTH) & 0xFFFF;
    sides = (sides - 1) & 0xFF;
  } while (sides);
  drawWindowFrameBottom(P, row, width);
}
// a run of tiles: first, (width - 2) of middle (0: 256), last; returns the address after it
function frameRow(P, at, width, first, middle, last) {
  P.bus.w8(at, first); at = (at + 1) & 0xFFFF;
  let n = (width - 2) & 0xFF;
  do { P.bus.w8(at, middle); at = (at + 1) & 0xFFFF; n = (n - 1) & 0xFF; } while (n);
  P.bus.w8(at, last);
  return (at + 1) & 0xFFFF;
}
// DrawWindowFrameTop (00:2BBB): the top border at hl, b wide. Leaves a = its last tile; bc, hl kept.
export function drawWindowFrameTop(P, at, width) { frameRow(P, at, width, FRAME_TOP_LEFT, FRAME_TOP, FRAME_TOP_RIGHT); }
// DrawWindowFrameSides (00:2BCE): the side pieces of the row at hl, b wide. Leaves a = the low byte of the right
// piece's address; hl kept.
export function drawWindowFrameSides(P, at, width) {
  P.bus.w8(at, FRAME_LEFT);
  P.bus.w8((at + ((width - 1) & 0xFF)) & 0xFFFF, FRAME_RIGHT);
}
// DrawWindowFrameBottom (00:2BDC): the bottom border at hl, b wide. Leaves a = its last tile, b = 0, hl after it.
export function drawWindowFrameBottom(P, at, width) { return frameRow(P, at, width, FRAME_BOTTOM_LEFT, FRAME_BOTTOM, FRAME_BOTTOM_RIGHT); }

// MoveCursorHorizontal (00:2C0D): move a menu cursor a (0 to count - 1) left or right by the pad bits in b,
// wrapping around. Returns a and the flags it leaves.
export function moveCursorHorizontal(cursor, pad, count, f) {
  let a;
  if (pad & PADF_LEFT) a = (cursor - 1) & 0xFF;
  else if (pad & PADF_RIGHT) a = (cursor + 1) & 0xFF;
  else return { a: cursor, f: FLAG_Z | FLAG_H | (f & FLAG_C) };  // neither: the flags of `bit 4, b`
  if (a & 0x80) {                                                // left of the first: the last
    const last = (count - 1) & 0xFF;
    return { a: last, f: (last ? 0 : FLAG_Z) | FLAG_N | ((count & 0xF) === 0 ? FLAG_H : 0) | FLAG_C };
  }
  if (a < count) return { a, f: FLAG_N | ((a & 0xF) < (count & 0xF) ? FLAG_H : 0) | FLAG_C };
  return { a: 0, f: FLAG_Z };                                    // right of the last: the first
}

// TickTimer (00:2C26): count the byte at hl down to 0. Returns a = its value before, and the flags: Z when it
// was 0 already, else those of the `dec` (Z when it just reached 0).
export function tickTimer(P, at) {
  const v = P.bus.u8(at);
  if (!v) return { a: 0, f: FLAG_Z | FLAG_H };
  P.bus.w8(at, v - 1);
  return { a: v, f: (v === 1 ? FLAG_Z : 0) | FLAG_N | ((v & 0xF) === 0 ? FLAG_H : 0) };
}

// QueueSprite24x32 (00:2C2B): queue a 24x32 sprite, six 8x16 OAM entries (three columns of two) into the sprite
// buffer at hSpriteQueueIndex: at x + dx, y + dy (attribute bit 5, mirrored: at x - dx + 8, the columns leftward),
// tiles from `tile` on (2 per entry), all with `attr`. Nothing when the buffer is too full. Returns the registers
// it leaves, and the flags: too full, those of its `cp $89`; else Z and H of the last `inc c` (N clear), and C of
// the last `add` before it, the last column's x (x + $10, mirrored x + $F0).
export function queueSprite24x32(P, attr, tile, x, y, dx, dy, l) {
  const { V, bus } = P;
  const flipped = attr & OAM_XFLIP;
  x = flipped ? (x - dx + 8) & 0xFF : (dx + x) & 0xFF;
  y = (dy + y) & 0xFF;
  const page = V.spriteBufferPage;
  let index = V.spriteQueueIndex;
  if (index >= SPRITE_QUEUE_FULL)                                // cp $89 / ret nc
    return { a: index, d: x, e: y, h: page, l, f: (index === SPRITE_QUEUE_FULL ? FLAG_Z : 0) | FLAG_N | ((index & 0xF) < (SPRITE_QUEUE_FULL & 0xF) ? FLAG_H : 0) };
  const carry = (flipped ? x + 0xF0 : x + 0x10) > 0xFF ? FLAG_C : 0;
  const columns = flipped ? [0, -8, -16] : [0, 8, 16];
  for (const dxCol of columns) {
    for (const dyRow of [0, 16]) {
      const at = (page << 8) | index;
      bus.w8(at, y + dyRow); bus.w8(at + 1, x + dxCol); bus.w8(at + 2, tile); bus.w8(at + 3, attr);
      index += OAM_ENTRY;
      tile = (tile + 2) & 0xFF;
    }
  }
  V.spriteQueueIndex = index;
  return { a: index, c: tile, d: x, e: y, h: page, l: index, f: (tile ? 0 : FLAG_Z) | ((tile & 0xF) === 0 ? FLAG_H : 0) | carry };
}

const frameHook = attr => preserving((P, c) => {
  if (attr !== null) P.V.windowFrameAttr = attr;
  drawWindowFrame(P, c.de, c.bc, c.h, c.l);
  if (attr !== null) return { a: attr };
});
export const HOOKS = [
  [0, 0x2A9E, preserving((P) => { const r = renderProportionalMenuText(P); return { a: r.a, f: r.f, de: r.de, hl: r.hl }; })],
  [0, 0x2B46, (P, c) => setRegs(c, copyTextRect(P, c.hl, c.de, c.b, c.c))],
  [0, 0x2B5C, frameHook(ATTR_PRIORITY)],
  [0, 0x2B63, frameHook(0)],
  [0, 0x2B68, frameHook(null)],
  [0, 0x2BBB, (P, c) => { drawWindowFrameTop(P, c.hl, c.b); c.a = FRAME_TOP_RIGHT; }],
  [0, 0x2BCE, (P, c) => { drawWindowFrameSides(P, c.hl, c.b); c.a = (c.l + c.b - 1) & 0xFF; }],
  [0, 0x2BDC, (P, c) => setRegs(c, { hl: drawWindowFrameBottom(P, c.hl, c.b), a: FRAME_BOTTOM_RIGHT, b: 0 })],
  [0, 0x2C0D, (P, c) => setRegs(c, moveCursorHorizontal(c.a, c.b, c.c, c.f))],
  [0, 0x2C26, (P, c) => setRegs(c, tickTimer(P, c.hl))],
  [0, 0x2C2B, (P, c) => setRegs(c, queueSprite24x32(P, c.b, c.c, c.d, c.e, c.h, c.l, c.l))],
];
