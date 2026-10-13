// Window structs, the SRAM text fetch, the cold reset of the window engine and the frame drawer (bank $05,
// src/engine/text/window_alloc_05.asm). Port of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own.
//
// A window is an 8-byte record in wWindowStructs ($DC00, WRAM bank 5), one bit per slot in wWindowSlotMask:
//   +0 column, +1 row (cells of the 32x32 shadow map), +2 width, +3 height, +4 state ($FF: not drawn;
//   bit 1: a menu, text indented one cell), +5 unused, +6/+7 the text id.
// Covered by out/port/story1.mtrec (dialogue windows) and the routine tests in web/tests/port/routines_text.mjs.
import {
  WRAM_TEXT, TILEATTR_PRIORITY, DIALOGUEWIN_NONE, FLAG, PAD, SFX_BEEP, HOME, mapped, hook, testFlag, playSound,
  clearMemory16, copyMemoryBC, advanceFrame, pushWramBank, callHome, cpFlags, addFlags, Z, H, hi, lo,
} from "./common.js";
import { getScreenTopLeftCell } from "./window_create.js";
import { restoreShadowTilemap } from "./shadow.js";
import { redrawWindowRows, prepareGlyphBuffer } from "./rows.js";

export const wWindowStructs = 0xDC00, wSavedWindowStruct = 0xDC78;
const SramTextOffsetTable_05 = 0x6D65;                 // 16 words: offsets of the player-entered strings in SRAM $A800
const wTextBuffer = 0xC600, wShortTextBuffer = 0xD880;

// FetchSRAMDialogueText (05:6D2B) / Unused_05_FetchSRAMShortText (05:6D33): FetchSRAMText into wTextBuffer / the
// short-text buffer. Both keep af.
export function fetchSRAMDialogueText(P, index) { fetchSRAMText(P, index, 0); }
export function fetchSRAMShortText(P, index) { fetchSRAMText(P, index, 1); }
// FetchSRAMText (05:6D3B): copy string `index` (de) of the SRAM text block ($A800 + table offset). mode 0: $180
// bytes into wTextBuffer (more than its 160, docs/bugs.md); else $20 bytes into wShortTextBuffer (16).
// Returns the a/f CopyMemoryBC leaves.
export function fetchSRAMText(P, index, mode) {
  const offset = P.bus.u16((SramTextOffsetTable_05 + 2 * index) & 0xFFFF);        // the table, read as mapped (ROM bank 5)
  const src = (0xA800 + offset) & 0xFFFF;
  const dest = mode === 0 ? wTextBuffer : wShortTextBuffer, count = mode === 0 ? 0x180 : 0x20;
  const r = callHome(P, HOME.CopyMemoryBC, { h: src >> 8, l: src & 0xFF, d: dest >> 8, e: dest & 0xFF, b: count >> 8, c: count & 0xFF, f: 0 });   // (or a cleared C)
  return { a: r.a, f: r.f };
}

// Unused_05_RunDebugWindowDemo (05:6D85): two framed windows over the screen, then scroll the background with the
// d-pad for ever. Nothing calls it.
export function* runDebugWindowDemo(P) {
  const { V } = P, entryBank = V.wramBank;
  V.scrollX = 2; V.scrollY = 2;
  callHome(P, HOME.BeginFadeIn, { c: 127 });                  // script_fade_in 127 (home)
  yield* P.runRom(0, HOME.WaitFadeEnd);                       // home
  yield* restoreShadowTilemap(P);
  yield* P.runRom(0, 0x2740, { c: 30 });                      // wait_frames 30: WaitFrames (home)
  yield* P.runRom(0, HOME.DisableLCDSafely);                  // home
  resetTextWindowState(P);
  const R = mapped(P);
  R.shadowTilemapPtr = 0xD000; R.shadowTilemapBank = WRAM_TEXT; R.windowTileAttr = TILEATTR_PRIORITY;
  for (const [col, row, w, h] of [[0x00, 0x02, 0x10, 0x07], [0x02, 0x04, 0x08, 0x0C]]) {
    const id = createWindowFromScreenRect(P, col, row, w, h).id;
    drawTextWindowFrame(P, id);
    yield* redrawWindowRows(P, id);
  }
  callHome(P, HOME.EnableLCD);                                // home
  P.wramBank(entryBank);                                      // pop_wram_bank
  playSound(P, SFX_BEEP);
  for (;;) {
    const pad = V.playerInputFlags;
    if (pad & PAD.RIGHT) V.scrollX = (V.scrollX + 1) & 0xFF; else if (pad & PAD.LEFT) V.scrollX = (V.scrollX - 1) & 0xFF;
    if (pad & PAD.UP) V.scrollY = (V.scrollY - 1) & 0xFF; else if (pad & PAD.DOWN) V.scrollY = (V.scrollY + 1) & 0xFF;
    yield* advanceFrame(P);
  }
}

// ResetTextWindowState (05:6E09): the window engine's cold init. In WRAM bank 5 (left mapped): clear the window
// shadow maps ($D000-$D7FF) and everything from wWindowFitTable to the end of the bank (structs, dirty rows, slot
// mask); point the engine at its own map; attribute $80; no dialogue window, no menu window ($FE).
export function resetTextWindowState(P) {
  P.wramBank(WRAM_TEXT);
  clearMemory16(P, 0xD000, 0x80);                             // wWindowShadowTilemap + wWindowShadowAttrmap
  clearMemory16(P, 0xD800, 0x80);                             // wWindowFitTable .. WRAMX_END
  const R = mapped(P);
  R.shadowTilemapPtr = 0xD000; R.shadowTilemapBank = WRAM_TEXT; R.windowTileAttr = TILEATTR_PRIORITY;
  R.dialogueWindowId = DIALOGUEWIN_NONE; R.menuWindowId = 0xFE;
}

// CreateWindowFromScreenRect (05:6E45): a window at screen cell (col, row) (made map cells with the scroll),
// width x height. Prepares the glyph buffer and leaves WRAM bank 5 mapped. Returns wWindowId (the old one when no
// slot was free: AllocWindowStruct leaves it) and the flags of its compare with $FF.
export function createWindowFromScreenRect(P, col, row, width, height) {
  prepareGlyphBuffer(P);
  P.wramBank(WRAM_TEXT);
  const top = getScreenTopLeftCell(P);
  allocWindowStruct(P, (top.col + col) & 0xFF, (top.row + row) & 0xFF, width, height);
  const id = mapped(P).windowId;
  return { id, f: cpFlags(id, 0xFF) };
}

// AllocWindowStruct (05:6E6D): claim a slot (wWindowId) and store column, row, width, height. Leaves WRAM bank 5
// mapped. Returns the a it leaves: $FF when full, else id * 8, with its flags.
export function allocWindowStruct(P, col, row, width, height) {
  P.wramBank(WRAM_TEXT);
  const alloc = allocWindowId(P);
  if (alloc.a === 0xFF) return { a: 0xFF, f: cpFlags(0xFF, 0xFF) };
  const id = alloc.a, R = mapped(P);
  R.windowId = id;
  const p = wWindowStructs + ((id * 8) & 0xFF);
  P.bus.w8(p, col); P.bus.w8(p + 1, row); P.bus.w8(p + 2, width); P.bus.w8(p + 3, height);
  return { a: (id * 8) & 0xFF, f: addFlags((id * 8) & 0xFF, 0) };
}

// AllocWindowId (05:6E96): the first clear bit of wWindowSlotMask among bits 0-6 (slot 7 is never handed out),
// set it, and return its index, or $FF when all seven are taken. (Unused_05_AllocWindowSlotBit, 05:4627, is the
// same code.) Returns a and its flags.
export function allocWindowId(P) {
  const R = mapped(P), mask = R.windowSlotMask;
  for (let slot = 0; slot < 7; slot++) {
    if (mask >> slot & 1) continue;
    R.windowSlotMask = mask | (1 << slot);
    return { a: slot, f: (slot === 0 ? Z : 0) | 0x40 };      // ld a, 7 / sub b (b = 7 - slot)
  }
  return { a: 0xFF, f: Z | 0x40 };                          // the flags of the last dec b
}

// FreeWindow (05:6EBA): zero the struct of window `id` and clear its slot bit. Returns a = id, or $FF when the
// bit was already clear (or id > 7), with the flags of the mask test; hl past the struct.
export function freeWindow(P, id) {
  const p = getWindowStructPtr(id);
  for (let i = 0; i < 8; i++) P.bus.w8(p + i, 0);
  const R = mapped(P), bit = id < 8 ? 1 << id : 0;
  if ((R.windowSlotMask & bit) === 0) return { a: 0xFF, f: Z | H, hl: p + 8 };
  const mask = R.windowSlotMask & ~bit & 0xFF;
  R.windowSlotMask = mask;
  return { a: id, f: (mask === 0 ? Z : 0) | H, hl: p + 8 };
}

// GetWindowStructPtr (05:6EEA): the struct of window id & 7
export function getWindowStructPtr(id) { return wWindowStructs + (id & 7) * 8; }

// SaveWindowStruct (05:6EFA) / RestoreWindowStruct (05:6F11): the struct of a window to and from wSavedWindowStruct
export function saveWindowStruct(P, id) { const p = getWindowStructPtr(id); for (let i = 0; i < 8; i++) P.bus.w8(wSavedWindowStruct + i, P.bus.u8(p + i)); }
export function restoreWindowStruct(P, id) { const p = getWindowStructPtr(id); for (let i = 0; i < 8; i++) P.bus.w8(p + i, P.bus.u8(wSavedWindowStruct + i)); }

// WrapCellPtrToRowStart (05:6F2A): a cell pointer that has just stepped onto the next map row goes back to the
// start of its own row (windows wrap round the 32-cell plane)
export function wrapCellPtrToRowStart(hl) { return (hl & 0x1F) === 0 ? (hl - 0x20) & 0xFFFF : hl; }
// ClampCellPtrToShadowMap (05:6F38) / ClampCellPtrToAttrMap (05:6F54): a pointer that has run off the bottom of
// the tile plane (attribute plane) wraps to its top. (Both map WRAM bank 5 while they read and put the bank back.)
export function clampCellPtrToShadowMap(P, hl) { return clampCellPtr(P, hl, 3); }
export function clampCellPtrToAttrMap(P, hl) { return clampCellPtr(P, hl, 7); }
function clampCellPtr(P, hl, last) {
  const old = pushWramBank(P, WRAM_TEXT);
  const top = (mapped(P).shadowTilemapPtr >> 8) + last & 0xFF;
  if (top < hi(hl)) hl = ((top - 3) & 0xFF) << 8 | lo(hl);
  P.wramBank(old);
  return hl;
}

// frame tiles of the font (docs/screens_and_ui.md 3.3)
const FRAME_TOP_LEFT = 0x02, FRAME_TOP = 0x03, FRAME_TOP_RIGHT = 0x04, FRAME_LEFT = 0x05, FRAME_RIGHT = 0x06,
  FRAME_BOTTOM_LEFT = 0x07, FRAME_BOTTOM = 0x08, FRAME_BOTTOM_RIGHT = 0x09, BLANK = 0x20;
const count8 = n => (n & 0xFF) || 256;                       // a dec / jr nz loop counter (0 runs 256 times)

// DrawTextWindowFrame (05:6F70): draw window `id` into the shadow map (wShadowTilemapPtr in WRAM bank
// wShadowTilemapBank): the border, blank interior rows and, on every other row, the window's glyph tiles —
// consecutive ids from $80 + wGlyphRowStartCol (only while FLAG_TEXT_RENDER_ACTIVE is set; blanks otherwise) —
// then the whole rectangle in the attribute plane (+$400) with wWindowTileAttr. Not for state $FF. No VRAM access.
export function drawTextWindowFrame(P, id) {
  const { bus } = P, R = mapped(P), oldBank = P.V.wramBank;
  const s = getWindowStructPtr(id);
  const col = bus.u8(s), row = bus.u8(s + 1), width = bus.u8(s + 2), height = bus.u8(s + 3);
  if (bus.u8(s + 4) === 0xFF) return;
  let start = (R.shadowTilemapPtr + ((row * 32 + col) & 0xFFFF)) & 0xFFFF;
  if ((((R.shadowTilemapPtr >> 8) + 3) & 0xFF) < hi(start)) start = (start - 0x400) & 0xFFFF;
  const attr = R.windowTileAttr;
  const inner = (width - 2) & 0xFF;
  P.wramBank(R.shadowTilemapBank);
  R.textRowNextTile = (R.glyphRowStartCol + 0x80) & 0xFF;
  const put = (hl, v) => { bus.w8(hl, v); return wrapCellPtrToRowStart((hl + 1) & 0xFFFF); };
  const row3 = (hl, left, mid, right) => {                   // one row: left cell, `inner` cells, right cell
    hl = put(hl, left);
    for (let n = count8(inner); n > 0; n--) hl = put(hl, mid);
    put(hl, right);
  };
  const nextRow = hl => clampCellPtrToShadowMap(P, (hl + 0x20) & 0xFFFF);
  let hl = start;
  row3(hl, FRAME_TOP_LEFT, FRAME_TOP, FRAME_TOP_RIGHT);
  hl = nextRow(hl);
  const textRows = testFlag(P, FLAG.TEXT_RENDER_ACTIVE);     // (the ROM tests the flag at every glyph cell)
  for (let d = count8(height - 2); d > 0; d--) {
    let p = put(hl, FRAME_LEFT);
    if (d & 1) {                                             // a glyph row
      let tile = R.textRowNextTile;
      for (let n = count8(inner); n > 0; n--) { p = put(p, textRows ? tile : BLANK); tile = (tile + 1) & 0xFF; }
      R.textRowNextTile = tile;
    } else {
      for (let n = count8(inner); n > 0; n--) p = put(p, BLANK);
    }
    put(p, FRAME_RIGHT);
    hl = nextRow(hl);
  }
  row3(hl, FRAME_BOTTOM_LEFT, FRAME_BOTTOM, FRAME_BOTTOM_RIGHT);
  nextRow(hl);
  // the attribute plane: the same rectangle, every cell wWindowTileAttr
  hl = (start + 0x400) & 0xFFFF;
  for (let d = count8(height); d > 0; d--) {
    row3(hl, attr, attr, attr);
    hl = clampCellPtrToAttrMap(P, (hl + 0x20) & 0xFFFF);
  }
  P.wramBank(oldBank);
}

export const HOOKS = [
  hook(5, 0x6D2B, (P, r) => { fetchSRAMDialogueText(P, r.de); }),
  hook(5, 0x6D33, (P, r) => { fetchSRAMShortText(P, r.de); }),
  hook(5, 0x6D3B, (P, r) => fetchSRAMText(P, r.de, r.a)),
  hook(5, 0x6D85, P => runDebugWindowDemo(P)),
  hook(5, 0x6E09, P => { resetTextWindowState(P); }),
  hook(5, 0x6E45, (P, r) => { const w = createWindowFromScreenRect(P, r.d, r.e, r.b, r.c); return { a: w.id, f: w.f }; }),
  hook(5, 0x6E6D, (P, r) => allocWindowStruct(P, r.d, r.e, r.b, r.c)),
  hook(5, 0x6E96, P => allocWindowId(P)),
  hook(5, 0x4627, P => allocWindowId(P)),                    // Unused_05_AllocWindowSlotBit: the same code
  hook(5, 0x6EBA, (P, r) => freeWindow(P, r.a)),
  hook(5, 0x6EEA, (P, r) => ({ hl: getWindowStructPtr(r.a) })),
  hook(5, 0x6EFA, (P, r) => { saveWindowStruct(P, r.a); }),
  hook(5, 0x6F11, (P, r) => { restoreWindowStruct(P, r.a); }),
  hook(5, 0x6F2A, (P, r) => ({ hl: wrapCellPtrToRowStart(r.hl) })),
  hook(5, 0x6F38, (P, r) => ({ hl: clampCellPtrToShadowMap(P, r.hl) })),
  hook(5, 0x6F54, (P, r) => ({ hl: clampCellPtrToAttrMap(P, r.hl) })),
  hook(5, 0x6F70, (P, r) => { drawTextWindowFrame(P, r.a); }),
];
