// The debug menu (hDebugStepMode): the game-flag editor, the warp menu and the jump to the character data
// screens (bank $05, src/engine/text/debug_flags_05.asm). Port of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own.
// Only reached in debug mode; checked by web/tests/port/routines_text.mjs (the drawing routines) and
// the lockstep over out/port/debug1.mtrec (the menus, from a state of out/engine/rec2.mtrec with hDebugStepMode forced on).
import {
  FLAG, WRAM_TEXT, PAD, STORYENTRY_NONE, mapped, hook, testFlag, setFlag, clearFlag, advanceFrame,
  registerFrameTask, unregisterFrameTask, callHome, copyMemoryFast, copyMemoryBC, farcall, farcallWaiting, HOME, addFlags, Z,
} from "./common.js";
import { createWindowFromScreenRect } from "./window_alloc.js";
import { drawTextWindowFrame } from "./window_alloc.js";
import { createMenuWindowFromText, runMenuSelection } from "./window_create.js";
import { writeWindowCellTileAttr } from "./window_tilemap.js";
import { redrawWindowRows, renderMenuWindowText, closeWindow } from "./rows.js";
import { restoreShadowTilemap, drawTextWindowFrameSaveRegs } from "./shadow.js";
import { writeStringToWindow, writeDialogueToWindow } from "./proportional.js";
import { debugToggleSelectedFlag, debugDrawFlagsWindow } from "./window_redraw.js";
import { startDebugPaletteEditor } from "./debug_palette.js";

const HexDigitChars_05 = 0x6488;                             // "0123456789ABCDEF" as font tiles
const HexDigitHeaderRow0_05 = 0x6582, HexDigitHeaderRow1_05 = 0x6592, EnterNumberPrompt_05 = 0x67B7;
const StubNop_05_3 = 0x6581;
const Text_30_311 = 0x0137;                                   // the debug menu
const LOCATION_NAME_TEXT = 0x0179;                            // + location: the location's name
const FLAG_ON_TILE = 0x40, FLAG_OFF_TILE = 0x65, CURSOR_TILE = 0x0D, BLANK = 0x20, HEX_SUFFIX_TILE = 0x3F;
const wDebugNumberEntryText = 0xC720, wStoryModePlayersXPosition = 0xC2D0, wStoryModeSpawnPosition = 0xC296;

// DebugDrawHexRowLabel (05:6498): the high hex digit of flag number `base` and an "x" mark at (col, row) of window `id`
export function debugDrawHexRowLabel(P, base, id, cell) {
  const digit = P.bus.u8(HexDigitChars_05 + (base >> 4 & 0x0F));
  writeWindowCellTileAttr(P, id, cell >> 8, cell & 0xFF, digit, 0x80);
  writeWindowCellTileAttr(P, id, (cell >> 8) + 1 & 0xFF, cell & 0xFF, HEX_SUFFIX_TILE, 0x80);
}
// DebugDrawFlagBitRow (05:64BA): flags base .. base + 7, one every other column from (col, row): set or clear
export function debugDrawFlagBitRow(P, base, id, cell) {
  let col = cell >> 8;
  for (let n = 0; n < 8; n++, col = (col + 2) & 0xFF) {
    const flag = (base + n) & 0xFFFF;
    const clear = callHome(P, HOME.TestGameFlagByNumber, { d: flag >> 8, e: flag & 0xFF }).f & Z;
    writeWindowCellTileAttr(P, id, col, cell & 0xFF, clear ? FLAG_OFF_TILE : FLAG_ON_TILE, 0x80);
  }
}
// the editor's cursor cell: column bit * 2 + 3; rows 1, 2, 4, 5 of window 1 (bytes 0-3) or window 2 (bytes 4-7)
function flagCursor(P, tile) {
  const R = mapped(P);
  const col = (R.debugFlagBit * 2 + 3) & 0xFF;
  let row = ((R.debugFlagByte & 3) + 1) & 0xFF;
  if (row >= 3) row++;
  const id = R.debugFlagByte & 0x04 ? R.debugFlagWindow2Id : R.debugFlagWindow1Id;
  writeWindowCellTileAttr(P, id, col, row, tile, 0x80);
}
// DebugDrawFlagCursor (05:64E3) / DebugEraseFlagCursor (05:6514)
export function debugDrawFlagCursor(P) { flagCursor(P, CURSOR_TILE); }
export function debugEraseFlagCursor(P) { flagCursor(P, BLANK); }
// DebugMoveFlagCursor (05:6546): one step with the held d-pad (left > right > up > down), wrapping at 8
export function debugMoveFlagCursor(P) {
  const R = mapped(P), pad = P.V.playerInputFlags;
  let bit = R.debugFlagBit, byte = R.debugFlagByte;
  if (pad & PAD.LEFT) bit--; else if (pad & PAD.RIGHT) bit++; else if (pad & PAD.UP) byte--; else if (pad & PAD.DOWN) byte++;
  R.debugFlagBit = bit & 7;
  R.debugFlagByte = byte & 7;
}

// RunDebugFlagEditor (05:65A2): the flag editor: a header (bit numbers) and two windows of 32 flags each; A toggles
// the flag under the cursor, START turns the page (4 pages of 64), the d-pad moves (every frame it is held), B
// closes. (The cursor is reset when FLAG_DEBUG_FLAG_EDITOR_OPEN is already set.)
export function* runDebugFlagEditor(P) {
  const R = mapped(P), V = P.V;
  if (testFlag(P, FLAG.DEBUG_FLAG_EDITOR_OPEN)) {
    setFlag(P, FLAG.DEBUG_FLAG_EDITOR_OPEN);
    R.debugFlagBit = 0; R.debugFlagByte = 0; R.debugFlagPage = 0;
  }
  const header = createWindowFromScreenRect(P, 0x00, 0x00, 0x14, 0x04).id;
  R.debugFlagHeaderWindowId = header;
  drawTextWindowFrame(P, header);
  writeStringToWindow(P, header, HexDigitHeaderRow0_05, 0x0401, 0x04);
  writeStringToWindow(P, header, HexDigitHeaderRow1_05, 0x0402, 0x04);
  R.debugFlagWindow1Id = createWindowFromScreenRect(P, 0x00, 0x04, 0x14, 0x07).id;
  drawTextWindowFrame(P, R.debugFlagWindow1Id);
  R.debugFlagWindow2Id = createWindowFromScreenRect(P, 0x00, 0x0B, 0x14, 0x07).id;
  drawTextWindowFrame(P, R.debugFlagWindow2Id);
  debugDrawFlagsWindow(P, 1); debugDrawFlagsWindow(P, 2); debugDrawFlagCursor(P);
  yield* redrawWindowRows(P, R.debugFlagHeaderWindowId);
  yield* redrawWindowRows(P, R.debugFlagWindow1Id);
  yield* redrawWindowRows(P, R.debugFlagWindow2Id);
  registerFrameTask(P, 0x0F, StubNop_05_3);
  const redrawFlags = function* () {
    debugDrawFlagsWindow(P, 1); debugDrawFlagsWindow(P, 2);
    yield* redrawWindowRows(P, R.debugFlagWindow1Id);
    yield* redrawWindowRows(P, R.debugFlagWindow2Id);
  };
  for (;;) {
    if (V.inputRisingEdge & PAD.B) break;
    if (V.inputRisingEdge & PAD.A) { debugToggleSelectedFlag(P); yield* redrawFlags(); }
    if (V.inputRisingEdge & PAD.START) { R.debugFlagPage = (R.debugFlagPage + 1) & 3; yield* redrawFlags(); }
    if (V.playerInputFlags & 0xF0) {
      debugEraseFlagCursor(P); debugMoveFlagCursor(P); debugDrawFlagCursor(P);
      yield* redrawWindowRows(P, R.debugFlagHeaderWindowId);
      yield* redrawWindowRows(P, R.debugFlagWindow1Id);
      yield* redrawWindowRows(P, R.debugFlagWindow2Id);
    }
    yield* advanceFrame(P);
  }
  yield* closeWindow(P, R.debugFlagHeaderWindowId);
  yield* closeWindow(P, R.debugFlagWindow1Id);
  yield* closeWindow(P, R.debugFlagWindow2Id);
  unregisterFrameTask(P, StubNop_05_3);
}

// RunDebugMenu (05:66A0): in debug mode, the debug menu (Text_30_311) at (10, 1) until B: warp, the character
// data screens (then back to the game), the palette editor, the flag editor (TextSubcmdHandlers_05). Returns
// whether it did anything (a = 0 and Z when not in debug mode).
export function* runDebugMenu(P) {
  const R = mapped(P);
  if (!P.V.debugStepMode) return false;
  for (;;) {
    R.debugMenuWindowId = createMenuWindowFromText(P, Text_30_311, 0x0A, 0x01).id;
    yield* restoreShadowTilemap(P);
    yield* renderMenuWindowText(P);
    const choice = yield* runMenuSelection(P);
    yield* closeWindow(P, R.debugMenuWindowId);
    if (choice === 0xFF) return true;
    switch (choice) {
      case 0: yield* runDebugWarpMenu(P); continue;          // RunDebugWarpMenuThunk
      case 1: yield* textSubcmdHandler1(P); return true;     // TextSubcmdHandler1: leaves the menu
      case 2: yield* startDebugPaletteEditor(P); continue;   // StartDebugPaletteEditorThunk
      case 3: yield* runDebugFlagEditor(P); continue;        // RunDebugFlagEditorThunk
      default: throw new Error(`RunDebugMenu: row ${choice} jumps past TextSubcmdHandlers_05`);
    }
  }
}
// TextSubcmdHandler1 (05:66EB): fade out, keep the player's position as the spawn point (no entry point), show the
// two character data pages (START leaves them), save the story slot
function* textSubcmdHandler1(P) {
  const { V } = P;
  callHome(P, HOME.BeginFadeOut, { c: 16 });                  // home
  yield* P.runRom(0, HOME.WaitFadeEnd);                       // home
  copyMemoryBC(P, wStoryModePlayersXPosition, wStoryModeSpawnPosition, 5);
  V.storyModeEntryPoint = STORYENTRY_NONE;
  V.unusedExitTriggerIdMirror = STORYENTRY_NONE;
  V.storyModeExitTriggerRequest = STORYENTRY_NONE;
  setFlag(P, FLAG.CHAR_DATA_START_EXITS);
  yield* farcallWaiting(P, 0x1C, 0x00, { c: 0x00 });          // farcall CharDataScreen_Show (1c:401A)
  yield* farcallWaiting(P, 0x1C, 0x00, { c: 0x01 });
  clearFlag(P, FLAG.CHAR_DATA_START_EXITS);
  yield* farcallWaiting(P, 0x03, 0x18);                      // farcall SaveStorySlotWithTimer (03:4D10)
}

// DebugDrawWarpMenu (05:672D): the warp window: the chosen location's name, "- ENTER NO -", the location and entry
// point numbers, the cursor; redrawn. `c` is the caller's (WriteDialogueToWindow's dakuten check). Returns the
// registers it leaves.
export function* debugDrawWarpMenu(P, c) {
  const R = mapped(P);
  const win = R.debugWarpWindowId;
  drawTextWindowFrameSaveRegs(P, win);
  const location = R.debugMenuWindowId;                       // (the warp menu keeps the location here)
  writeDialogueToWindow(P, win, (LOCATION_NAME_TEXT + location) & 0xFFFF, 0x0102, c);
  copyMemoryFast(P, EnterNumberPrompt_05, wDebugNumberEntryText, 1);
  writeStringToWindow(P, win, wDebugNumberEntryText, 0x0104, 0);
  callHome(P, HOME.FormatDecimalNumber, { h: 0, l: location, d: 0xC7, e: 0x20, a: 2, b: 0, c: 0 });
  writeStringToWindow(P, win, wDebugNumberEntryText, 0x1102, 0);
  callHome(P, HOME.FormatDecimalNumber, { h: 0, l: R.debugWarpEntryPoint, d: 0xC7, e: 0x20, a: 2, b: 0, c: 0 });
  writeStringToWindow(P, win, wDebugNumberEntryText, 0x1104, 0);
  const row = (R.debugWarpCursorRow * 2 + 2) & 0xFF;
  writeWindowCellTileAttr(P, win, 0x10, row, CURSOR_TILE, 0x80);
  yield* redrawWindowRows(P, win);
  return { a: win, f: addFlags((R.debugWarpCursorRow * 2) & 0xFF, 2), bc: 0x800D, d: 0x10, e: row, hl: wDebugNumberEntryText };
}

// RunDebugWarpMenu (05:67C4): pick a location (left / right on the first row) and an entry point (second row; up /
// down switch rows); A warps (sets the story location and entry point), B leaves. Leaves WRAM bank 5 mapped.
export function* runDebugWarpMenu(P) {
  const R = mapped(P), V = P.V;
  P.wramBank(WRAM_TEXT);
  R.debugWarpCursorRow = 0;
  R.debugWarpEntryPoint = 0;
  R.debugMenuWindowId = V.storyModeCurrentLocation;
  R.debugWarpLocationCount = farcall(P, 0x0A, 0x66).a;        // farcall GetStoryLocationCount (0a:574B)
  R.debugWarpWindowId = createWindowFromScreenRect(P, 0x00, 0x00, 0x14, 0x06).id;
  let c = (yield* debugDrawWarpMenu(P, 0x06)).bc & 0xFF;
  yield* advanceFrame(P);
  for (;;) {
    if (V.inputRisingEdge & PAD.B) break;
    if (V.inputRisingEdge & PAD.A) {
      V.storyModeCurrentLocation = R.debugMenuWindowId;
      V.storyModeEntryPoint = R.debugWarpEntryPoint;
      V.unusedExitTriggerIdMirror = 0xFF;
      V.storyModeExitTriggerRequest = 0xFF;
      break;
    }
    if (V.inputPressed & (PAD.UP | PAD.DOWN)) {
      R.debugWarpCursorRow ^= 1;
      c = (yield* debugDrawWarpMenu(P, c)).bc & 0xFF;
    }
    const onEntryRow = R.debugWarpCursorRow === 1;
    const value = onEntryRow ? R.debugWarpEntryPoint : R.debugMenuWindowId;
    const stepped = debugStepValueWithDpad(P, value, onEntryRow ? 0x10 : R.debugWarpLocationCount);
    if (stepped !== value) {
      if (onEntryRow) R.debugWarpEntryPoint = stepped; else R.debugMenuWindowId = stepped;
      c = (yield* debugDrawWarpMenu(P, c)).bc & 0xFF;
    }
    yield* advanceFrame(P);
  }
  yield* closeWindow(P, R.debugWarpWindowId);
}

// DebugStepValueWithDpad (05:6862): value + 1 with RIGHT, - 1 with LEFT, wrapping within 0 .. count - 1
export function debugStepValueWithDpad(P, value, count) {
  const pad = P.V.inputPressed;
  let v;
  if (pad & PAD.RIGHT) v = (value + 1) & 0xFF;
  else if (pad & PAD.LEFT) v = (value - 1) & 0xFF;
  else return value;
  if (v & 0x80) return (count - 1) & 0xFF;
  return v < count ? v : 0;
}

export const HOOKS = [
  hook(5, 0x6498, (P, r) => { debugDrawHexRowLabel(P, r.a, r.b, r.de); }),
  hook(5, 0x64BA, (P, r) => { debugDrawFlagBitRow(P, r.a, r.b, r.de); }),
  hook(5, 0x64E3, P => { debugDrawFlagCursor(P); }),
  hook(5, 0x6514, P => { debugEraseFlagCursor(P); }),
  hook(5, 0x6546, P => { debugMoveFlagCursor(P); }),
  hook(5, 0x6581, () => {}),                                  // StubNop_05_3 (the flag editor's frame task)
  hook(5, 0x65A2, P => runDebugFlagEditor(P)),
  hook(5, 0x66A0, P => (function* () { if (!(yield* runDebugMenu(P))) return { a: 0, f: Z }; })()),
  hook(5, 0x672D, (P, r) => debugDrawWarpMenu(P, r.c)),
  hook(5, 0x67C4, P => runDebugWarpMenu(P)),
  hook(5, 0x6862, (P, r) => ({ a: debugStepValueWithDpad(P, r.a, r.d) })),
];
