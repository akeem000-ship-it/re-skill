// The debug palette viewer and colour editor, and the unused raw-tilemap string writers (bank $05,
// src/engine/text/debug_palette_05.asm). Port of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own.
// Only reached from the debug menu; checked by web/tests/port/routines_text.mjs and the lockstep over out/port/debug1.mtrec.
import {
  WRAM_TEXT, PAD, vTiles0, mapped, hook, advanceFrame, registerFrameTask, unregisterFrameTask, queueVRAMCopy,
  callHome, HOME, pushWramBank, addFlags,
} from "./common.js";
import { drawTextWindowFrame, createWindowFromScreenRect } from "./window_alloc.js";
import { createWindowWithAttr } from "./window_create.js";
import { writeWindowCellTileAttr } from "./window_tilemap.js";
import { redrawWindowRows, closeWindow } from "./rows.js";
import { writeStringToWindow } from "./proportional.js";
import { fetchDialogueText, addTextIdOffset } from "./dialogue.js";
import { resetTextArgQueues, wTextBuffer } from "./window_text.js";
import { dispatchControlCode } from "./control.js";

const PaletteEditorCursorTiles_05 = 0x6890;                  // 12 sprite tiles
const ColorEditorHeader_05 = 0x69BB;                          // "--R--G--B"
const DrawPaletteCursorSprites = 0x6B03;
const wBGPalettes = 0xC100, wColorDigits = 0xC700;            // the digits overlay wDebugMenuWindowId.. ($C700-$C709)
const CURSOR_TILE = 0x0D;

// GetSelectedBGPaletteColorPtr (05:6950): the BG palette colour under the viewer's cursor in wBGPalettes.
// Returns hl, and the a / flags it leaves.
export function getSelectedBGPaletteColorPtr(P) {
  const R = mapped(P);
  const offset = ((((R.debugPaletteIndex * 4) & 0xFF) + R.debugPaletteColorIndex) * 2) & 0xFF;
  return { hl: wBGPalettes + offset, a: offset, f: addFlags(offset, 0x00) };
}

// DebugDrawColorComponents (05:6964): the selected colour's three components in decimal in the editor window, the
// cursor before component `component`
export function* debugDrawColorComponents(P, component) {
  const R = mapped(P), { bus } = P;
  const ptr = getSelectedBGPaletteColorPtr(P).hl;
  const parts = callHome(P, HOME.SplitColorComponents, { c: bus.u8(ptr), b: bus.u8(ptr + 1) });
  for (const [value, dest] of [[parts.a, 0xC700], [parts.b, 0xC703], [parts.c, 0xC706]]) {
    callHome(P, HOME.FormatDecimalNumber, { h: 0, l: value, d: dest >> 8, e: dest & 0xFF, a: 3, b: parts.b, c: parts.c });
  }
  bus.w8(wColorDigits + ((component * 3) & 0xFF), CURSOR_TILE);
  R.debugColorDigitsEnd = 0;
  writeStringToWindow(P, R.debugColorEditorWindowId, wColorDigits, 0x0102, parts.c);
  yield* redrawWindowRows(P, R.debugColorEditorWindowId);
}

// RunDebugColorEditor (05:69C5): edit the selected colour: left / right pick the component (wrapping), up / down
// add +1 / -1 to it (clamped), A or B closes. (No frame between steps but the window redraw's.)
export function* runDebugColorEditor(P) {
  const R = mapped(P), V = P.V, { bus } = P;
  const win = createWindowFromScreenRect(P, 0x07, 0x00, 0x0B, 0x04).id;
  R.debugColorEditorWindowId = win;
  drawTextWindowFrame(P, win);
  yield* redrawWindowRows(P, win);
  writeStringToWindow(P, win, ColorEditorHeader_05, 0x0101, 0x04);
  let component = 0;
  yield* debugDrawColorComponents(P, component);
  for (;;) {
    if (V.inputRisingEdge & (PAD.A | PAD.B)) break;
    const pad = V.playerInputFlags;
    let delta = null;
    if (pad & PAD.LEFT) component = (component - 1) & 0xFF;
    else if (pad & PAD.RIGHT) component = (component + 1) & 0xFF;
    else if (pad & PAD.UP) delta = 0x01;
    else if (pad & PAD.DOWN) delta = 0xFF;
    else { yield* advanceFrame(P); continue; }
    if (delta === null) {
      const was = component;
      if (was === 0xFF) component = 2;
      if (was === 3) component = 0;
    } else {
      const ptr = getSelectedBGPaletteColorPtr(P).hl;
      let color = { b: bus.u8(ptr + 1), c: bus.u8(ptr) };
      let a = component & 3;
      const adjust = addr => { const r = callHome(P, addr, { a, b: color.b, c: color.c, d: delta, e: component }); color = { b: r.b, c: r.c }; };
      if (a === 0) adjust(HOME.AdjustColorRed);
      a = (a - 1) & 0xFF;
      if (a === 0) adjust(HOME.AdjustColorGreen);
      a = (a - 1) & 0xFF;
      if (a === 0) adjust(HOME.AdjustColorBlue);
      bus.w8(ptr, color.c); bus.w8(ptr + 1, color.b);
      V.paletteDirtyFlags = 0x03;
    }
    yield* debugDrawColorComponents(P, component);
  }
  yield* closeWindow(P, R.debugColorEditorWindowId);
}

// RunDebugPaletteViewer (05:6A54): a window showing the 8 BG palettes (4 swatch tiles each, attribute = palette)
// with a sprite cursor (DrawPaletteCursorSprites, a frame task); the d-pad picks a colour, A edits it, B closes.
// Leaves WRAM bank 5 mapped.
export function* runDebugPaletteViewer(P) {
  const R = mapped(P), V = P.V;
  P.wramBank(WRAM_TEXT);
  const win = createWindowWithAttr(P, 0x00, 0x00, 0x00, 0x07, 0x12);
  R.debugPaletteViewerWindowId = win;
  drawTextWindowFrame(P, win);
  for (let i = 0, tile = 0x30; i < 16; i++, tile = (tile + 1) & ~0x08) writeWindowCellTileAttr(P, win, 0x01, 1 + i, tile, 0x00);
  for (let pal = 0; pal < 8; pal++) {
    for (let k = 0; k < 4; k++) writeWindowCellTileAttr(P, win, 0x02 + k, 1 + pal, 0xA0 + k, pal);
  }
  yield* redrawWindowRows(P, win);
  registerFrameTask(P, 0x0F, DrawPaletteCursorSprites);
  for (;;) {
    if (V.inputRisingEdge & PAD.B) break;
    if (V.inputRisingEdge & PAD.A) yield* runDebugColorEditor(P);
    let col = R.debugPaletteColorIndex, pal = R.debugPaletteIndex;
    const pad = V.inputPressed;
    if (pad & PAD.LEFT) col--; else if (pad & PAD.RIGHT) col++; else if (pad & PAD.UP) pal--; else if (pad & PAD.DOWN) pal++;
    R.debugPaletteColorIndex = col & 0x03;
    R.debugPaletteIndex = pal & 0x0F;
    yield* advanceFrame(P);
  }
  yield* closeWindow(P, R.debugPaletteViewerWindowId);
  unregisterFrameTask(P, DrawPaletteCursorSprites);
}

// DrawPaletteCursorSprites (05:6B03, a frame task): the cursor sprite on the selected swatch, and the 8 x 3 sprite
// legend down the left, both corrected for the camera's sub-tile scroll
export function drawPaletteCursorSprites(P) {
  const R = mapped(P);
  const fine = v => ((((v << 3) | (v >> 5)) & 0xFF) + 4) & 7;   // rlca x3, + 4, and 7
  const fx = fine(R.cameraX & 0xFF), fy = fine(R.cameraY & 0xFF);
  const x = (R.debugPaletteColorIndex * 8 + 0x18 - fx) & 0xFF, y = (R.debugPaletteIndex * 8 + 0x18 - fy) & 0xFF;
  callHome(P, HOME.QueueSprite16, { d: x, e: y, b: 0x01, c: 0x60, h: fx, l: fy });
  let row = (0x50 - fy) & 0xFF, attr = 0;
  for (let n = 0; n < 8; n++) {
    let col = (0x20 - fx) & 0xFF, tile = 0x66, r;
    for (let k = 0; k < 3; k++) {
      r = callHome(P, HOME.QueueSprite, { d: col, e: row, b: attr, c: tile, h: fx, l: fy });
      col = (col + 8) & 0xFF;
      tile = (r.c + 2) & 0xFF;
      attr = r.b;
    }
    row = (row + 8) & 0xFF;
    attr = (attr + 1) & 0xFF;
  }
}

// StartDebugPaletteEditor (05:6B6C): the cursor sprite tiles to $8600, cursor on colour 0 of palette 0, the viewer
export function* startDebugPaletteEditor(P) {
  const R = mapped(P);
  queueVRAMCopy(P, PaletteEditorCursorTiles_05, vTiles0 + 0x60 * 16, 12);
  R.debugPaletteColorIndex = 0;
  R.debugPaletteIndex = 0;
  yield* runDebugPaletteViewer(P);
}

// Unused_05_WriteStringToTilemap (05:6B82) / ...Alt (05:6BB9): a string straight into a tilemap at de, a dakuten mark
// on the byte a row up ($03 -> $0E/$0F; Alt: $0E -> $5C/$5D). At a row's end they add de to itself (a bug).
// Return { de, hl }.
function writeStringToTilemap(P, text, de, base, sub) {
  const { bus } = P;
  let hl = text;
  for (;;) {
    const ch = bus.u8(hl);
    if (ch === 0) return { de, hl };
    bus.w8(de, ch);
    hl = (hl + 1) & 0xFFFF;
    const next = bus.u8(hl);
    if (next === 0xDE || next === 0xDF) {
      const above = (de - 0x20) & 0xFFFF;
      bus.w8(above, bus.u8(above) === base ? (next - sub) & 0xFF : next);
      hl = (hl + 1) & 0xFFFF;
    }
    de = (de + 1) & 0xFFFF;
    if ((de & 0x1F) === 0) de = (de + de) & 0xFFFF;
  }
}
export const writeStringToTilemapPlain = (P, text, de) => writeStringToTilemap(P, text, de, 0x03, 0xD0);
export const writeStringToTilemapAlt = (P, text, de) => writeStringToTilemap(P, text, de, 0x0E, 0x82);

// Unused_05_WriteStringToTilemapStreamed (05:6BF0): WriteStringToTilemapAlt with lines ($01: $40 on from the line's
// start, kept at $DC05/$DC06), a page stop ($02: the position kept at $DC07/$DC08, $DC09 = 1) and an end ($03:
// $DC0A = 1) — its scratch from before the window structs lived at $DC00. Returns { c, de, hl }.
export function writeStringToTilemapStreamed(P, text, de, entryC) {
  const { bus } = P;
  bus.w8(0xDC05, de >> 8); bus.w8(0xDC06, de & 0xFF); bus.w8(0xDC09, 0);
  let hl = text, c = entryC;
  for (;;) {
    let ch = bus.u8(hl);
    if (ch === 0) return { c, de, hl };
    if (ch === 0x01) {
      c = ch;
      de = ((bus.u8(0xDC05) << 8 | bus.u8(0xDC06)) + 0x40) & 0xFFFF;
      bus.w8(0xDC05, de >> 8); bus.w8(0xDC06, de & 0xFF);
      hl = (hl + 1) & 0xFFFF;
      ch = bus.u8(hl);
    }
    c = 0;
    if (ch === 0x02) {
      bus.w8(0xDC09, 1);
      hl = (hl + 1) & 0xFFFF;
      bus.w8(0xDC07, hl >> 8); bus.w8(0xDC08, hl & 0xFF);
      return { c, de, hl };
    }
    c = 1;
    if (ch === 0x03) { bus.w8(0xDC0A, 1); return { c, de, hl }; }
    bus.w8(de, ch);
    hl = (hl + 1) & 0xFFFF;
    const next = bus.u8(hl);
    if (next === 0xDE || next === 0xDF) {
      const above = (de - 0x20) & 0xFFFF;
      bus.w8(above, bus.u8(above) === 0x0E ? (next - 0x82) & 0xFF : next);
      hl = (hl + 1) & 0xFFFF;
    }
    de = (de + 1) & 0xFFFF;
    if ((de & 0x1F) === 0) de = (de + de) & 0xFFFF;
  }
}

// Unused_05_WriteDialogueToTilemapStreamed (05:6C79): meant to store text `textId` byte per byte, but every byte
// (other than $00 / $03) is dispatched as a control code with the next byte as its operand, two at a time — a
// character >= $20 jumps past the handler table (the port stops there). Nothing calls it.
export function* writeDialogueToTilemapStreamed(P, textId, de, width) {
  const R = mapped(P), { bus } = P;
  let oldBank = pushWramBank(P, WRAM_TEXT);
  const id = addTextIdOffset(P, textId, 0).hl;
  resetTextArgQueues(P);
  R.glyphVramDest = de;
  R.textRowIndent = (-width) & 0xFF;
  fetchDialogueText(P, id, de);
  let hl = wTextBuffer;
  P.wramBank(oldBank);
  for (;;) {
    const ch = bus.u8(hl);
    if (ch === 0x00 || ch === 0x03) break;
    hl = (hl + 1) & 0xFFFF;
    R.textCharNameArg = bus.u8(hl);
    if (ch >= 0x20) throw new Error(`Unused_05_WriteDialogueToTilemapStreamed: character $${ch.toString(16)} dispatched as a control code`);
    de = (yield* dispatchControlCode(P, ch, de)).de;
    hl = (hl + 1) & 0xFFFF;
  }
  oldBank = pushWramBank(P, WRAM_TEXT);
  R.textRowIndent = 0;
  resetTextArgQueues(P);
  P.wramBank(oldBank);
}

export const HOOKS = [
  hook(5, 0x6950, P => getSelectedBGPaletteColorPtr(P)),
  hook(5, 0x6964, (P, r) => debugDrawColorComponents(P, r.e)),
  hook(5, 0x69C5, P => runDebugColorEditor(P)),
  hook(5, 0x6A54, P => runDebugPaletteViewer(P)),
  hook(5, 0x6B03, P => { drawPaletteCursorSprites(P); }),
  hook(5, 0x6B6C, P => startDebugPaletteEditor(P)),
  hook(5, 0x6B82, (P, r) => writeStringToTilemapPlain(P, r.hl, r.de)),
  hook(5, 0x6BB9, (P, r) => writeStringToTilemapAlt(P, r.hl, r.de)),
  hook(5, 0x6BF0, (P, r) => writeStringToTilemapStreamed(P, r.hl, r.de, r.c)),
  hook(5, 0x6C79, (P, r) => writeDialogueToTilemapStreamed(P, r.hl, r.de, r.c)),
];
