// Menu cursors: moving a cursor over a grid of cells (by the pad, the link partner's pad, or both cursors of a link
// menu), the cell index of a cursor and back, the corner-bracket boxes drawn around a choice, and the small bobbing
// offsets those boxes wobble by. The ROM has one copy of each routine per menu bank ($16, $17, $1B, $38, $3B, $3E);
// the copies are instruction-identical but for their own tables, so each family is one function here and HOOKS
// lists every copy's address.
// Port of src/engine/menus/common/cursor_{16,17,1b,38,3b,3e}.asm and their src/twins/ bodies of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm).
// Tests: web/tests/port/routines_menus_common.mjs (every copy); MoveMenuCursorGrid_3b and GetMenuCursorIndex_3b run
// every frame of the main menu in the lockstep on out/engine/exh1.mtrec.
import { queueSprite } from "../../home/fade.js";
import {
  FZ, FN, cpFlags, addFlags, subFlags, hook, hookGen, sound, waitRom, HOME, OAM_BANK1, OAM_XFLIP, OAM_YFLIP,
  LINKSTATE_MASTER, LINKSTATE_SLAVE, SFX_MENU_SELECT, SFX_MENU_CANCEL,
} from "./defs.js";

const PADF_RIGHT = 0x10, PADF_LEFT = 0x20, PADF_UP = 0x40, PADF_DOWN = 0x80, PADF_A = 0x01, PADF_B = 0x02;

// ---- moving a cursor over a grid ----
// One step along an axis, wrapping: a value past $7F (one left of 0) goes to the last cell, one past the last to 0.
function wrapStep(v, size) {
  v &= 0xFF;
  if (v & 0x80) return (size - 1) & 0xFF;                   // add a / jr nc: the step went below 0
  return v < size ? v : 0;
}
// Did the cursor (x, y) move from (oldX, oldY)? a = 1 with the flags of the compare that saw it, or a = 0 (Z).
function movedResult(x, y, oldX, oldY) {
  if (x !== oldX) return { a: 1, f: cpFlags(x, oldX) };
  if (y !== oldY) return { a: 1, f: cpFlags(y, oldY) };
  return { a: 0, f: FZ };
}
// Apply one d-pad direction of `input` to the cursor at xAddr/yAddr (right, left, up, down: the first one held
// wins) on a grid of `cols` x `rows`. Returns true if a direction was held.
function stepCursor(P, input, xAddr, yAddr, cols, rows) {
  const { bus } = P;
  if (input & PADF_RIGHT) bus.w8(xAddr, wrapStep(bus.u8(xAddr) + 1, cols));
  else if (input & PADF_LEFT) bus.w8(xAddr, wrapStep(bus.u8(xAddr) - 1, cols));
  else if (input & PADF_UP) bus.w8(yAddr, wrapStep(bus.u8(yAddr) - 1, rows));
  else if (input & PADF_DOWN) bus.w8(yAddr, wrapStep(bus.u8(yAddr) + 1, rows));
  else return false;
  return true;
}
// MoveMenuCursorGrid (3B:412A and its copies): move wMenuCursorX/Y by `input` (wMenuInputPressed, or hLinkInput for
// the link copies) over a cols (b) x rows (c) grid. Returns a = 1 if the cursor moved, 0 if not; leaves d, e = the
// old position.
export function moveMenuCursorGrid(P, cols, rows, input = P.V.menuInputPressed) {
  const { V } = P, oldX = V.menuCursorX, oldY = V.menuCursorY;
  stepCursor(P, input, P.A.menuCursorX, P.A.menuCursorY, cols, rows);
  return { ...movedResult(V.menuCursorX, V.menuCursorY, oldX, oldY), d: oldX, e: oldY };
}
// The two cursors of a two-player link menu (Unused_*_MoveMenuCursorGridRemote and ...2GridRemote): cursor 1
// (wMenuCursorX/Y) is the master's, cursor 2 (wMenuCursor2X/Y) the slave's; each side moves cursor `which` by
// its partner's or its own pad as the link state says (anything but master or slave is a link error). A locked
// cursor (wMenuCursorLockFlags bit 0 / 1) does not move. With no direction, A locks it (SFX_MENU_SELECT; cursor 1
// plays it a second time when it locks), B unlocks it, or with neither locked sets bit 2 / 3 ("backed out"),
// SFX_MENU_CANCEL. Returns a = 1 if it moved; leaves d, e = the old position, h = the input and, after A or B,
// b = the lock flags as they were.
const LOCK = [0, 0x01, 0x02], BACKED_OUT = [0, 0x04, 0x08], BOTH_LOCKS = 0x03;
export function* moveMenuCursorLinked(P, cols, rows, which) {
  const { V, A, bus } = P;
  const xAddr = which === 1 ? A.menuCursorX : A.menuCursor2X, yAddr = which === 1 ? A.menuCursorY : A.menuCursor2Y;
  const oldX = bus.u8(xAddr), oldY = bus.u8(yAddr);
  const state = V.linkState;
  if (state !== LINKSTATE_SLAVE && state !== LINKSTATE_MASTER) yield* waitRom(P, 0, HOME.LinkErrorReset);   // (never returns)
  // cursor 1 follows the remote pad on the master's side; cursor 2 the remote pad on the slave's
  const remote = (state === LINKSTATE_SLAVE) === (which === 1);
  const input = remote ? V.linkRemoteInput : V.linkRemoteInputBuf;
  const out = { h: input };
  const locked = V.menuCursorLockFlags & LOCK[which];
  if (locked || !stepCursor(P, input, xAddr, yAddr, cols, rows)) {
    if (input & PADF_A) {
      if (which === 1) sound(P, SFX_MENU_SELECT);
      const flags = V.menuCursorLockFlags;
      out.b = flags;
      if (!(flags & LOCK[which])) {
        sound(P, SFX_MENU_SELECT);
        V.menuCursorLockFlags = flags | LOCK[which];
      }
    } else if (input & PADF_B) {
      sound(P, SFX_MENU_CANCEL);
      const flags = V.menuCursorLockFlags;
      out.b = flags;
      V.menuCursorLockFlags = flags & BOTH_LOCKS ? flags & ~LOCK[which] & 0xFF : (flags & ~(LOCK[which] | BACKED_OUT[which]) & 0xFF) | BACKED_OUT[which];
    }
  }
  return { ...out, ...movedResult(bus.u8(xAddr), bus.u8(yAddr), oldX, oldY), d: oldX, e: oldY };
}

// ---- cell index <-> cursor position ----
// GetMenuCursorIndex (3B:43B9 and its copies): a = wMenuCursorY * c + wMenuCursorX (8 bits); leaves b = the row's
// first index and the flags of the add.
export function getMenuCursorIndex(P, cols) {
  const row = (P.V.menuCursorY * cols) & 0xFF, x = P.V.menuCursorX;
  return { a: (row + x) & 0xFF, b: row, f: addFlags(x, row) };
}
// GetMenuCursorIndexFromPtr (1B:43D3 and copies): the same for a cursor whose y is at hl and x at hl - 1.
// Returns a and hl - 1 (bc kept).
export function getMenuCursorIndexFromPtr(P, cols, hl) {
  const row = (P.bus.u8(hl) * cols) & 0xFF, x = P.bus.u8(hl - 1);
  return { a: (row + x) & 0xFF, hl: (hl - 1) & 0xFFFF, f: addFlags(x, row) };
}
// SetMenuCursorFromIndex (3B:43DB and copies): the cursor of cell c on a grid b wide (wMenuCursorX = c mod b,
// wMenuCursorY = c / b). Leaves a = d = the row and the flags of the last compare. (b = 0 never ends, as on the ROM.)
export function setMenuCursorFromIndex(P, cols, index, dest = null) {
  let row = 0, a = index;
  while (a >= cols) { row++; a -= cols; }
  if (dest === null) { P.V.menuCursorX = a; P.V.menuCursorY = row & 0xFF; }
  else { P.bus.w8(dest, a); P.bus.w8(dest + 1, row); }
  const out = { a: row & 0xFF, d: row & 0xFF, f: cpFlags(a, cols) };
  if (dest !== null) out.hl = (dest + 1) & 0xFFFF;
  return out;
}

// ---- the bobbing offsets: a 16-step table by hVBlankCounter ----
// ApplySpriteBobOffsetX (38:407B) and its copies: d = d + table[frame & 15] (c != 0) or d - table[...] (c = 0);
// the Y copies the same with e. Each table sits right after its routine. Leaves a = the new coordinate, b = the
// table byte, hl = its address and the flags of the add / sub.
const BOB_TABLE_OFFSET = 0x1A;
export function applyBobOffset(P, routine, c, v) {
  const at = routine + BOB_TABLE_OFFSET + (P.V.vBlankCounter & 0x0F), b = P.bus.u8(at);
  const r = c ? (b + v) & 0xFF : (v - b) & 0xFF;
  return { value: r, a: r, b, hl: at, f: c ? addFlags(b, v) : subFlags(v, b) };
}
const bobX = (P, routine, c, cpu) => { const r = applyBobOffset(P, routine, c, cpu.d); return { ...r, d: r.value, value: undefined }; };
const bobY = (P, routine, c, cpu) => { const r = applyBobOffset(P, routine, c, cpu.e); return { ...r, e: r.value, value: undefined }; };

// ---- boxes of four corner sprites ----
// A register model for the box routines, which leave whatever their last calls left.
const regsOf = cpu => ({ a: cpu.a, f: cpu.f, b: cpu.b, c: cpu.c, d: cpu.d, e: cpu.e, h: cpu.h, l: cpu.l });
// QueueSprite (00:1F51) with the registers it leaves: a = the new queue index and hl the next entry, the flags of
// its `add $04` (of d); a full queue returns at once with a = $A0 and the flags of `cp $a0`.
const OAM_PAGE_END = 0xA0;
export function queueSpriteRegs(P, r, tile, attr) {
  r.c = tile; r.b = attr;
  if (P.V.spriteQueueIndex === OAM_PAGE_END) { r.a = OAM_PAGE_END; r.f = FZ | FN; return; }
  const q = queueSprite(P, attr, tile, r.d, r.e);
  r.a = q.a; r.h = q.hl >> 8; r.l = q.hl & 0xFF; r.f = addFlags(r.d, 4);
}
const queueCorner = queueSpriteRegs;
const CORNERS = [                     // [x side (0 left), y side (0 top), attribute]
  [0, 0, OAM_BANK1], [1, 0, OAM_BANK1 | OAM_XFLIP], [1, 1, OAM_BANK1 | OAM_XFLIP | OAM_YFLIP], [0, 1, OAM_BANK1 | OAM_YFLIP],
];
// DrawSelectedOptionBox (38:4018) and its copies: the four corners (tile 0) of a box at (d, e), b wide and c tall,
// each corner bobbing outwards by the bank's offset routines (xRoutine, yRoutine). Leaves de = (d, e + c),
// bc = the last corner's attribute and tile, and a, hl as the last QueueSprite left them.
export function drawBobbingBox(P, cpu, xRoutine, yRoutine, palette = 0) {
  const r = regsOf(cpu), d0 = cpu.d, e0 = cpu.e, w = cpu.b, h = cpu.c;
  for (const [sx, sy, attr] of CORNERS) {
    r.d = (d0 + (sx ? w : 0)) & 0xFF; r.e = (e0 + (sy ? h : 0)) & 0xFF;
    if (xRoutine) {
      let o = applyBobOffset(P, xRoutine, sx, r.d); r.d = o.value;
      o = applyBobOffset(P, yRoutine, sy, r.e); r.e = o.value;
      r.a = o.a; r.b = o.b; r.h = o.hl >> 8; r.l = o.hl & 0xFF; r.f = o.f;
    }
    queueCorner(P, r, 0, attr | palette);
  }
  r.d = d0; r.e = (e0 + h) & 0xFF;
  return r;
}
// DrawCornerBrackets (3B:40EF and its copies): the same box without the bobbing, in palette 1
export const drawCornerBrackets = (P, cpu) => drawBobbingBox(P, cpu, 0, 0, 1);
// Unused_16_DrawCornerBrackets (16:40CD): the label sits 16 bytes into its routine (which starts at $40BD, inside
// SpriteWobbleYTable_16's second row), after the first corner's `push de / push bc`: from here the first corner is
// queued with the caller's de and the routine pops its "saved" bc and de off the caller's stack (the return address
// and the word above it), draws the other three corners with those, and returns to the word above them.
function unusedDrawCornerBracketsMidway(P, cpu) {
  const r = regsOf(cpu), sp = cpu.sp;
  queueCorner(P, r, 0, OAM_BANK1 | OAM_XFLIP | 1);           // (the first corner's sprite, with the second's attribute)
  const bc = P.bus.u16(sp), de = P.bus.u16(sp + 2);
  const d0 = de >> 8, e0 = de & 0xFF, w = bc >> 8, h = bc & 0xFF;
  for (const [sx, sy, attr] of CORNERS.slice(2)) {
    r.d = (d0 + (sx ? w : 0)) & 0xFF; r.e = (e0 + (sy ? h : 0)) & 0xFF;
    queueCorner(P, r, 0, attr | 1);
  }
  // the stack as the ROM leaves it: pushes of the (unchanged) words below the caller's frame
  P.bus.w16(sp + 2, (d0 << 8) | ((e0 + h) & 0xFF));
  P.bus.w16(sp, bc);
  P.bus.w16(sp - 2, ((d0 + w) & 0xFF) << 8 | ((e0 + h) & 0xFF));
  r.d = d0; r.e = (e0 + h) & 0xFF;
  cpu.sp = (sp + 4) & 0xFFFF;                                // ret: to the word above the two it popped
  return r;
}

// ---- the copies, by bank ----
// [bank, MoveMenuCursorGrid, ...FromLinkInput, ...GridRemote, ...2GridRemote, GetMenuCursorIndex]
const GRID_COPIES = [
  [0x16, 0x40F8, 0x4176, 0x41F3, 0x42BE, 0x4387],
  [0x17, 0x4108, 0x4186, 0x4203, 0x42CE, 0x4397],             // (17:4397 is Unused_17_GetMenuCursorLinearIndex)
  [0x1B, 0x4132, 0x41B0, 0x422D, 0x42F8, 0x43C1],
  [0x38, 0x410A, 0x4188, 0x4205, 0x42D0, 0x4399],
  [0x3B, 0x412A, 0x41A8, 0x4225, 0x42F0, 0x43B9],             // (3B: Unused_3b_MoveMenuCursorRepeat / LinkLocal / LinkRemote)
  [0x3E, 0x413A, 0x41B8, 0x4235, 0x4300, 0x43C9],
];
const FROM_PTR = [[0x17, 0x43A9], [0x1B, 0x43D3], [0x38, 0x43AB], [0x3B, 0x43CB]];
const SET_FROM_INDEX = [[0x17, 0x43B9], [0x1B, 0x43E3], [0x38, 0x43BB], [0x3B, 0x43DB]];
const SET_FROM_INDEX_TO_PTR = [[0x1B, 0x43F5], [0x38, 0x43CD], [0x3B, 0x43ED]];
// [bank, box, x offset, y offset]: the box calls the bank's two offset routines
const BOB_COPIES = [
  [0x16, 0x4006, 0x4069, 0x4093], [0x17, 0, 0x4079, 0x40A3], [0x1B, 0x4040, 0x40A3, 0x40CD],
  [0x38, 0x4018, 0x407B, 0x40A5], [0x3B, 0x4038, 0x409B, 0x40C5], [0x3E, 0x4048, 0x40AB, 0x40D5],
];
const CORNER_BRACKETS = [[0x17, 0x40CD], [0x1B, 0x40F7], [0x38, 0x40CF], [0x3B, 0x40EF], [0x3E, 0x40FF]];

export const HOOKS = [];
for (const [bank, grid, gridLink, remote1, remote2, index] of GRID_COPIES) {
  HOOKS.push(
    [bank, grid, hook((P, c) => moveMenuCursorGrid(P, c.b, c.c))],
    [bank, gridLink, hook((P, c) => moveMenuCursorGrid(P, c.b, c.c, P.V.linkInput))],
    [bank, remote1, hookGen((P, c) => moveMenuCursorLinked(P, c.b, c.c, 1))],
    [bank, remote2, hookGen((P, c) => moveMenuCursorLinked(P, c.b, c.c, 2))],
    [bank, index, hook((P, c) => getMenuCursorIndex(P, c.c))],
  );
}
for (const [bank, addr] of FROM_PTR) HOOKS.push([bank, addr, hook((P, c) => getMenuCursorIndexFromPtr(P, c.c, c.hl))]);
for (const [bank, addr] of SET_FROM_INDEX) HOOKS.push([bank, addr, hook((P, c) => setMenuCursorFromIndex(P, c.b, c.c))]);
for (const [bank, addr] of SET_FROM_INDEX_TO_PTR) HOOKS.push([bank, addr, hook((P, c) => setMenuCursorFromIndex(P, c.b, c.c, c.hl))]);
for (const [bank, box, x, y] of BOB_COPIES) {
  HOOKS.push([bank, x, hook((P, c) => bobX(P, x, c.c, c))], [bank, y, hook((P, c) => bobY(P, y, c.c, c))]);
  if (box) HOOKS.push([bank, box, hook((P, c) => drawBobbingBox(P, c, x, y))]);
}
for (const [bank, addr] of CORNER_BRACKETS) HOOKS.push([bank, addr, hook((P, c) => drawCornerBrackets(P, c))]);
HOOKS.push([0x16, 0x40CD, (P, c) => { const r = unusedDrawCornerBracketsMidway(P, c); for (const k in r) c[k] = r[k]; }]);
