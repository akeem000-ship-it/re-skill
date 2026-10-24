// Bank 0 view helpers: the 32x32 sprite queue, the court's world-to-screen projection and queueing a
// character's frame tiles.
// Port of view_00.asm (00:2CED-00:2F19; its sound wrappers, 00:2F1A-00:2FB2, are in web/js/port/audio); names and addresses from the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm).
// Covered by the routine tests (web/tests/port/routines_home_gfx.mjs) and the lockstep on out/engine/*.mtrec.
import { FZ, FN, FH, FC, switchRomBank, byte, setRegs, queueVRAMCopy } from "./memory.js";

const OAM_XFLIP = 0x20;                                     // attribute bit 5: the sprite is mirrored
const OAM_PAGE_END = 0xA0;                                  // 40 sprites x 4 bytes

// ---- the sprite queue (32x32) ----
// QueueSpriteBlockPart (00:2D79): one 8x16 sprite at (hSpriteBlitX + dx, hSpriteBlitY + dy), tile c,
// attribute b, at hl in the sprite page, unless the page is full (l = $A0). Returns the new hl and tile, and
// the carry of the x addition (the flags it leaves).
function queueSpriteBlockPart(P, hl, dx, dy, tile, attr) {
  if ((hl & 0xFF) === OAM_PAGE_END) return { hl, tile, full: true };
  const { bus, V } = P;
  bus.w8(hl, V.spriteBlitY + dy);
  bus.w8(hl + 1, V.spriteBlitX + dx);
  bus.w8(hl + 2, tile);
  bus.w8(hl + 3, attr);
  return { hl: (hl + 4) & 0xFFFF, tile: (tile + 2) & 0xFF, carry: V.spriteBlitX + dx > 0xFF };
}
// the flags QueueSpriteBlockPart leaves: `cp $a0` when full, else `inc c` with the x addition's carry
const blockPartFlags = r => (r.full ? FZ | FN : (r.tile === 0 ? FZ : 0) | ((r.tile & 0x0F) === 0 ? FH : 0) | (r.carry ? FC : 0));
// The eight parts of a 32x32 sprite, (x, y) offsets in the ROM's order: columns of two 8x16 halves.
const PARTS_32 = [[0, 0], [0, 16], [8, 0], [8, 16], [16, 0], [16, 16], [24, 0], [24, 16]];
// QueueSprite32x32 (00:2CED): a 32x32 sprite of eight 8x16 parts with tiles c, c+2, ... at screen (h + d,
// l + e), attribute b. Mirrored (b bit 5): the columns go right to left from d - h + 8. Returns the registers
// it leaves.
export function queueSprite32x32(P, attr, tile, h, l, d, e) {
  const { V } = P, mirrored = attr & OAM_XFLIP;
  V.spriteBlitX = mirrored ? d - h + 8 : h + d;
  V.spriteBlitY = l + e;
  let r = { hl: byte(P, "spriteBufferPage") << 8 | V.spriteQueueIndex, tile }, dx = 0, dy = 0;
  for (const [x, y] of PARTS_32) {
    dx = mirrored ? -x & 0xFF : x; dy = y;
    r = queueSpriteBlockPart(P, r.hl, dx, dy, r.tile, attr);
  }
  V.spriteQueueIndex = r.hl & 0xFF;
  return { a: r.hl & 0xFF, c: r.tile, d: dx, e: dy, hl: r.hl, f: blockPartFlags(r) };
}

// ---- projection ----
const ViewScaleTableA = 0x4000, ViewScaleTableB = 0x6000;   // bank $2F: |v| * cos / sin of the camera tilt
const PerspectiveScaleTable = 0x4000;                       // bank $2E: the perspective factor by depth
const BANK_VIEW_SCALE = 0x2F, BANK_PERSPECTIVE = 0x2E;
const neg16 = v => (-v) & 0xFFFF;
// MulViewScaleA/B (00:2DE9/2E39), MulViewScaleANeg (00:2E11): the table word for |hl| & $1FFE in the bank
// mapped now, with hl's sign (negated again for ...Neg). Return { hl, a } (a: the last byte the ROM had in a).
function mulViewScale(P, table, hl, negate) {
  const neg = (hl & 0x8000) !== 0, m = neg ? neg16(hl) : hl;
  const v = P.bus.u16(table + (m & 0x1FFE));
  const r = neg !== negate ? neg16(v) : v;
  return { hl: r, a: neg !== negate ? r >> 8 : r & 0xFF };
}
export const mulViewScaleA = (P, hl) => mulViewScale(P, ViewScaleTableA, hl, false);
export const mulViewScaleANeg = (P, hl) => mulViewScale(P, ViewScaleTableA, hl, true);
export const mulViewScaleB = (P, hl) => mulViewScale(P, ViewScaleTableB, hl, false);
// GetPerspectiveScale (00:2E61): d = the perspective factor for the depth hl (its high byte offset by $20,
// wrapped to 64 rows of the table in the bank mapped now). Returns { d, h, a }.
export function getPerspectiveScale(P, hl) {
  const a = ((hl >> 8) + 0x20) & 0x3F, h = a | (PerspectiveScaleTable >> 8);
  return { d: P.bus.u8(h << 8 | (hl & 0xFF)), h, a };
}
// ProjectWorldToScreen (00:2D8C): rotate (depth de, height bc) by the camera tilt, then scale x (hl) and the
// rotated height by the perspective factor of the rotated depth. Returns { hl: screen x, bc: screen y (both in
// 1/32 pixel), de: the rotated depth }.
export function projectWorldToScreen(P, hl, de, bc) {
  const old = P.V.romBank;
  switchRomBank(P, BANK_VIEW_SCALE);
  const y = (mulViewScaleA(P, de).hl + mulViewScaleB(P, bc).hl) & 0xFFFF;
  const depth = (mulViewScaleB(P, de).hl + mulViewScaleANeg(P, bc).hl) & 0xFFFF;
  switchRomBank(P, BANK_PERSPECTIVE);
  const k = getPerspectiveScale(P, depth).d;
  const scale = v => (((P.M.mulHLByASigned(v, k) << 1) + 4) << 2) & 0xFFFF;   // MulHLByASigned (00:0DFA), *2 + 4, *4
  const r = { bc: scale(y), hl: scale(hl), de: depth };
  switchRomBank(P, old);
  return r;
}

// ---- character frame tiles ----
// The on-court character's record, in the WRAM bank mapped now (one per character, banks 4-7).
const wCharSpriteFrame = 0xDF1B, wCharObjectBank = 0xDF22, wCharFrameTablePtr = 0xDF24;
const wCharFrameVramDest = 0xDF26, wCharShadowTablePtr = 0xDF38;
const TILE_SIZE = 16;
// QueueTileCopyAdvance (00:2F0C): queue one tile from hl to de, then step hl to the next tile. Returns the
// registers it leaves (a from QueueVRAMCopy; the flags of the 16-bit add, Z from QueueVRAMCopy).
function queueTileCopyAdvance(P, hl, de) {
  const r = queueVRAMCopy(P, hl, de, 1);
  const f = (r.f & FZ) | (((hl & 0x0FFF) + TILE_SIZE) > 0x0FFF ? FH : 0) | (hl + TILE_SIZE > 0xFFFF ? FC : 0);
  return { a: r.a, bc: TILE_SIZE, de, hl: (hl + TILE_SIZE) & 0xFFFF, f };
}
// QueueCharFrameTiles (00:2E6B): queue the tiles of a character's frame, with the character's graphics bank
// mapped. de = 2 * the frame: the byte offset of its tile pointer in the frame table, and half that of its
// 4-byte entry in the shadow table (three descriptor bytes, copied to wCharSpriteFrame, then the number of
// 16-byte blocks). b: the caller's b (kept when the queue is full). With
// standing shadows on, the shadow's tiles follow: 3 tiles (4 when the frame's 32x32 flag, descriptor byte 2,
// is set) taken after the frame's $C0 ($100) bytes, into VRAM $30 past the frame and then every $40.
// Returns the registers it leaves.
export function queueCharFrameTiles(P, de, b) {
  const { bus } = P, old = P.V.romBank;
  switchRomBank(P, bus.u8(wCharObjectBank));
  const p = (bus.u16(wCharShadowTablePtr) + 2 * de) & 0xFFFF;
  for (let i = 0; i < 3; i++) bus.w8(wCharSpriteFrame + i, bus.u8(p + i));
  const blocks = bus.u8(p + 3);
  let hl = bus.u16((bus.u16(wCharFrameTablePtr) + de) & 0xFFFF);
  let dest = bus.u16(wCharFrameVramDest), r;
  if (!P.V.standingShadowsEnabled) r = { b, c: blocks, ...queueVRAMCopy(P, hl, dest, blocks) };
  else {
    queueVRAMCopy(P, hl, dest, blocks);
    const big = bus.u8(wCharSpriteFrame + 2) !== 0;
    hl = (hl + (big ? 0x100 : 0xC0)) & 0xFFFF;
    dest = (dest + 0x30) & 0xFFFF;
    for (let i = big ? 4 : 3; i > 0; i--) {
      hl = queueTileCopyAdvance(P, hl, dest).hl;
      if (i > 1) dest = (dest + 0x40) & 0xFFFF;
    }
    r = { bc: TILE_SIZE, de: dest, hl };
  }
  switchRomBank(P, old);
  return { ...r, a: old, f: undefined };
}

export const HOOKS = [
  [0, 0x2CED, (P, c) => setRegs(c, queueSprite32x32(P, c.b, c.c, c.h, c.l, c.d, c.e))],
  [0, 0x2D79, (P, c) => {
    const r = queueSpriteBlockPart(P, c.hl, c.d, c.e, c.c, c.b);
    setRegs(c, r.full ? { a: c.l, f: blockPartFlags(r) } : { a: c.b, hl: r.hl, c: r.tile, f: blockPartFlags(r) });
  }],
  [0, 0x2D8C, (P, c) => setRegs(c, { ...projectWorldToScreen(P, c.hl, c.de, c.bc), a: P.V.romBank })],
  [0, 0x2DE9, (P, c) => setRegs(c, mulViewScaleA(P, c.hl))],
  [0, 0x2E11, (P, c) => setRegs(c, mulViewScaleANeg(P, c.hl))],
  [0, 0x2E39, (P, c) => setRegs(c, mulViewScaleB(P, c.hl))],
  [0, 0x2E61, (P, c) => { const r = getPerspectiveScale(P, c.hl); setRegs(c, { ...r, f: (r.a ? 0 : FZ) | FH }); }],
  [0, 0x2E6B, (P, c) => setRegs(c, queueCharFrameTiles(P, c.de, c.b))],
  [0, 0x2F0C, (P, c) => setRegs(c, queueTileCopyAdvance(P, c.hl, c.de))],
];
