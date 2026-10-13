// Bank 0 sprite queue and the (unused) white fade: sprites are queued into the shadow OAM page being built
// (wSpriteBufferPage: $C0 or $C5, swapped every frame; hSpriteQueueIndex is the next free byte, $A0 = full).
// Port of fade_00.asm (00:1DCC-00:1FF6; Unused_00_WaitFadeEndLinked 00:1DBD is in colorfade.js with
// WaitFadeEnd); names and addresses from the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm).
// Covered by the routine tests (web/tests/port/routines_home_gfx.mjs) and the lockstep on out/engine/*.mtrec.
import { FZ, FN, FH, FC, byte, setByte, setRegs } from "./memory.js";

const OAM_PAGE_END = 0xA0;                                  // 40 sprites x 4 bytes
const OAM_XFLIP = 0x20;                                     // attribute bit 5: mirrored
const TEMPLATE_END = 0x80;                                  // a sprite template ends with a y byte of $80
const SPRITE_Y_OFFSET = 12, SPRITE_X_OFFSET = 4;            // QueueSprite: OAM's (8, 16) origin, centered
const addSpFlags = (sp, n) => ((sp & 0x0F) + n > 0x0F ? FH : 0) | ((sp & 0xFF) + n > 0xFF ? FC : 0);
const page = P => byte(P, "spriteBufferPage");

// ---- the white fade (Unused: only Unused_00_BeginWhiteFadeOut asks for it) ----
const wMasterPalettes = 0xC200, wBGPalettes = 0xC100, PALETTE_COLORS = 0x40;
const rrca = v => ((v >> 1) | (v << 7)) & 0xFF, swap = v => ((v << 4) | (v >> 4)) & 0xFF;
// Unused_00_ApplyWhiteFade (00:1DCC): the live palettes from the master copy with level c (bits 3-6) added to
// every component at once as one 15-bit sum, with the ROM's own carry fix-ups. Returns { bc, de, hl } after.
export function applyWhiteFade(P, level) {
  const { bus } = P;
  const d0 = level & 0x78, e0 = rrca(rrca(d0));
  const add = ((rrca(swap(e0)) * 4) + (d0 << 8 | e0)) & 0xFFFF, d = add >> 8, e = add & 0xFF;
  let hl = wMasterPalettes, out = wBGPalettes;
  for (let n = PALETTE_COLORS; n > 0; n--) {
    const lo = (bus.u8(hl) & 0xDF) + e;
    let c = lo & 0xFF;
    let a = ((bus.u8(hl + 1) & ~0x04) + d + (lo > 0xFF ? 1 : 0)) & 0xFF;
    hl += 2;
    if (a & 0x80) a |= 0x78;
    if (a & 0x04) { a = ((a & 0xFC) - 1) & 0xFF; c |= 0xC0; }
    const b = a;
    a = c;
    if (a & 0x20) a = ((a & 0xE0) - 1) & 0xFF;
    bus.w8(out, a); bus.w8(out + 1, b);
    out += 2;
  }
  return { bc: out, de: add, hl };
}

// ---- clearing ----
// ClearSpriteQueue (00:1E1D): empty the queue (index and base 0), then ClearUnusedSprites.
export function clearSpriteQueue(P) {
  P.V.spriteQueueIndex = 0;
  P.V.spriteQueueBase = 0;
  return clearUnusedSprites(P);
}
// ClearUnusedSprites (00:1E22): drop the sprites queued since the base (hSpriteQueueBase) and zero the page
// from there to its end. Returns the registers it leaves.
export function clearUnusedSprites(P) {
  const base = P.V.spriteQueueBase;
  P.V.spriteQueueIndex = base;
  let hl = page(P) << 8 | base;
  const left = (OAM_PAGE_END - base) & 0xFF;
  if (!left) return { a: 0, hl, f: FZ | FN };
  for (let n = (left >> 2) || 0x100; n > 0; n--) for (let i = 0; i < 4; i++) { P.bus.w8(hl, 0); hl = (hl + 1) & 0xFFFF; }
  return { a: 0, c: 0, hl, f: FZ | FN };
}
// ClearBothSpriteBuffers (00:1E3D): clear the page, swap wSpriteBufferPage ($C0 <-> $C5), clear that one too.
// The page stays swapped; a = the first page.
export function clearBothSpriteBuffers(P) {
  clearSpriteQueue(P);
  const first = page(P);
  setByte(P, "spriteBufferPage", (first & 0xCF) ^ 0x05);
  return { ...clearSpriteQueue(P), a: first, f: FZ | FN };
}

// ---- queueing ----
// Write one OAM entry [y, x, tile, attribute] at hl; returns hl after (the ROM steps l alone: within the page).
function putSprite(P, hl, y, x, tile, attr) {
  const { bus } = P, h = hl & 0xFF00;
  let l = hl & 0xFF;
  for (const v of [y, x, tile, attr]) { bus.w8(h | l, v); l = (l + 1) & 0xFF; }
  return h | l;
}
// QueueSprite16 (00:1E55): an 8x16-wide pair (16x16) at (d, e), tiles c and c+2, attribute b; mirrored (b bit
// 5): the pair swapped. Stops when the page fills. Returns the registers it leaves.
export function queueSprite16(P, attr, tile, x, y) {
  const index = P.V.spriteQueueIndex;
  if (index === OAM_PAGE_END) return { a: index };
  const mirrored = attr & OAM_XFLIP;
  let hl = putSprite(P, page(P) << 8 | index, y, mirrored ? x + 8 : x, tile, attr);
  tile = (tile + 2) & 0xFF;
  if ((hl & 0xFF) !== OAM_PAGE_END) hl = putSprite(P, hl, y, mirrored ? x : x + 8, tile, attr);
  P.V.spriteQueueIndex = hl & 0xFF;
  return { a: hl & 0xFF, c: tile, hl };
}
// QueueSprite (00:1F51): one sprite at (d, e) given as its center (OAM coordinates + (4, 12)), tile c, attribute b.
export function queueSprite(P, attr, tile, x, y) {
  const index = P.V.spriteQueueIndex;
  if (index === OAM_PAGE_END) return { a: index };
  const { bus } = P, hl = page(P) << 8 | index;
  bus.w8(hl, y + SPRITE_Y_OFFSET); bus.w8(hl + 1, x + SPRITE_X_OFFSET); bus.w8(hl + 2, tile); bus.w8(hl + 3, attr);
  const end = (hl + 4) & 0xFFFF;
  P.V.spriteQueueIndex = end & 0xFF;
  return { a: end & 0xFF, hl: end };
}
// QueueSpriteTemplate (00:1E9D): the sprites of the template at hl (entries [y, x, tile, attribute], ended by a
// y of $80), each offset by (d, e), tile + c, attribute + b; mirrored (b bit 5): x reflected about d + 4 and the
// attribute ORed. Stops when the page fills. The ROM keeps (e, d, c, b) on the stack (sp - 4).
// Returns the registers it leaves.
export function queueSpriteTemplate(P, hl, x, y, tile, attr, sp) {
  const { bus } = P, buf = (sp - 4) & 0xFFFF;
  bus.w8(buf - 1, hl >> 8); bus.w8(buf - 2, hl & 0xFF);   // push hl
  [y, x, tile, attr].forEach((v, i) => bus.w8(buf + i, v));
  const mirrored = attr & OAM_XFLIP, b = page(P);
  let c = P.V.spriteQueueIndex, de = hl;
  const put = v => { bus.w8(b << 8 | c, v); c = (c + 1) & 0xFF; de = (de + 1) & 0xFFFF; };
  while (c !== OAM_PAGE_END && bus.u8(de) !== TEMPLATE_END) {
    put(bus.u8(de) + y);
    put(mirrored ? (~bus.u8(de) & 0xFF) + 9 + x : bus.u8(de) + x);
    put(bus.u8(de) + tile);
    put(mirrored ? bus.u8(de) | attr : bus.u8(de) + attr);
  }
  P.V.spriteQueueIndex = c;
  return { a: c, b, c, de, hl: buf + 3, f: addSpFlags(buf, 4) };
}
// Unused_00_QueueSpriteGrid (00:1F0D): a grid of h columns x l rows of 8x16 sprites from (d + 8, e + 16),
// tiles c, c+2, ... attribute b. Stops when the page fills. Keeps all registers.
export function queueSpriteGrid(P, cols, rows, de, tile, attr) {
  const start = (de + 0x0810) & 0xFFFF;
  let y = start & 0xFF;
  for (let r = rows || 0x100; r > 0; r--) {
    let x = start >> 8;
    for (let k = cols || 0x100; k > 0; k--) {
      const index = P.V.spriteQueueIndex;
      if (index === OAM_PAGE_END) return;
      const hl = putSprite(P, page(P) << 8 | index, y, x, tile, attr);
      P.V.spriteQueueIndex = hl & 0xFF;
      tile = (tile + 2) & 0xFF; x = (x + 8) & 0xFF;
    }
    y = (y + 0x10) & 0xFF;
  }
}
// Unused_00_PositionSpriteWorld / ...2 (00:1F6B / 00:1FB1): a sprite at world (hl, de) in 1/8-tile units:
// minus the camera (wCameraX/Y), times 8, the high bytes as the screen position; queued with QueueSprite16
// (rows below $14 shown) or QueueSprite (rows below $13). Keeps all registers.
export function positionSpriteWorld(P, hl, de, tile, attr, single) {
  const dx = (hl - P.V.cameraX) & 0xFFFF;
  if (((dx >> 8) + 1 & 0xFF) >= 0x16) return;
  const dy = (de - P.V.cameraY) & 0xFFFF;
  if ((dy >> 8) >= (single ? 0x13 : 0x14)) return;
  const x = ((dx << 3) & 0xFFFF) >> 8, y = ((dy << 3) & 0xFFFF) >> 8;
  if (single) queueSprite(P, attr, tile, x, y); else queueSprite16(P, attr, tile, x, y);
}

export const HOOKS = [
  [0, 0x1DCC, (P, c) => setRegs(c, applyWhiteFade(P, c.c))],
  [0, 0x1E1D, (P, c) => setRegs(c, clearSpriteQueue(P))],
  [0, 0x1E22, (P, c) => setRegs(c, clearUnusedSprites(P))],
  [0, 0x1E3D, (P, c) => setRegs(c, clearBothSpriteBuffers(P))],
  [0, 0x1E50, (P, c) => { const a = P.V.spriteQueueIndex; P.V.spriteQueueBase = a; c.a = a; }],
  [0, 0x1E55, (P, c) => setRegs(c, queueSprite16(P, c.b, c.c, c.d, c.e))],
  [0, 0x1E9D, (P, c) => setRegs(c, queueSpriteTemplate(P, c.hl, c.d, c.e, c.c, c.b, c.sp))],
  [0, 0x1F0D, (P, c) => queueSpriteGrid(P, c.h, c.l, c.de, c.c, c.b)],
  [0, 0x1F51, (P, c) => setRegs(c, queueSprite(P, c.b, c.c, c.d, c.e))],
  [0, 0x1F6B, (P, c) => positionSpriteWorld(P, c.hl, c.de, c.c, c.b, false)],
  [0, 0x1FB1, (P, c) => positionSpriteWorld(P, c.hl, c.de, c.c, c.b, true)],
];
