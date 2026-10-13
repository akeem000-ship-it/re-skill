// The speaker's voice, window text redraws, the alternative close, the centred dialogue variants, and the debug
// flag editor's drawing (bank $05, src/engine/text/window_redraw_05.asm). Port of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses are its own.
// Covered by out/port/story1.mtrec (speaker voices) and web/tests/port/routines_text.mjs.
import {
  WRAM_TEXT, WRAM_SOUND, WRAM_ACTORS, vTiles1, DIALOGUEWIN_NONE, mapped, hook, advanceFrame, lcdOn, queueVRAMCopy,
  callHome, HOME, pushWramBank, Z, hi,
} from "./common.js";
import { getWindowStructPtr, drawTextWindowFrame, freeWindow, createWindowFromScreenRect } from "./window_alloc.js";
import { createDialogueWindow, resetWindowState } from "./window_create.js";
import { fetchDialogueText, addTextIdOffset, measureDialogueWidthTiles } from "./dialogue.js";
import { setWindowTextId, setActiveWindowTextId, renderActiveWindowText, applyMessageSpeed, resetTextArgQueues, wTextBuffer } from "./window_text.js";
import { renderTextString } from "./cursor.js";
import { restoreShadowTilemap, restoreTilemapUnderWindow } from "./shadow.js";
import { redrawWindowRowsThunk, initTextWindows } from "./window_tilemap.js";
import { clearGlyphBuffer } from "./glyph_buffer.js";
import { getObjectSlotPointer } from "./proportional.js";
import { debugDrawHexRowLabel, debugDrawFlagBitRow } from "./debug_flags.js";

export { getObjectSlotPointer };
const SpeakerVoiceActorTypePropertyTable = 0x60CB;           // (actor type, voice) pairs from type $1E
const VOICE_SILENT = 0x08;

// GetSpeakerVoice (05:608A): the voice of the actor in slot `slot` (its type's entry in the table, from type $1E);
// 8 (silent) for no actor. A type below $1E (or $9E and up) leaves its pushed WRAM bank on the stack and returns
// through it: the port stops there.
export function getSpeakerVoice(P, slot) {
  const actor = getObjectSlotPointer(P, slot).hl;
  if (!actor) return VOICE_SILENT;
  const oldBank = pushWramBank(P, WRAM_ACTORS);
  P.V.actorPtr = actor & 0xFF; P.bus.w8(P.A.actorPtr + 1, actor >> 8);   // hActorPtr
  const type = P.bus.u8((actor & 0xFF00) | ((actor + 0x21) & 0xFF));
  const index = (type - 0x1E) & 0xFF;
  if (index & 0x80) throw new Error(`GetSpeakerVoice: actor type $${type.toString(16)} returns through its stack (ROM bug)`);
  const voice = P.bus.u8(SpeakerVoiceActorTypePropertyTable + index * 2 + 1);
  P.wramBank(oldBank);
  return voice;
}

// ResetTextWindowsAndRestoreMap (05:617A): InitTextWindows, RestoreShadowTilemap
export function* resetTextWindowsAndRestoreMap(P) { initTextWindows(P); yield* restoreShadowTilemap(P); }

// Unused_05_CreateWindowWithTextId (05:6181): CreateWindow, and its text id `textId` unless bit 15 is set. Returns
// wWindowId and the registers SetWindowTextId leaves.
export function createWindowWithTextId(P, col, row, width, height, textId) {
  const oldBank = pushWramBank(P, WRAM_TEXT);
  const id = createWindowFromScreenRect(P, col, row, width, height).id;
  let out = {};
  if (!(textId & 0x8000)) { const r = setWindowTextId(P, id, textId); out = { de: r.de, hl: r.hl }; }
  const a = mapped(P).windowId;
  P.wramBank(oldBank);
  return { a, ...out };
}

// RedrawWindowText (05:61A2): redraw window `id`'s text. The dialogue window becomes the glyph window and is
// re-typed page by page (glyph tiles cleared and uploaded, the frame drawn, its text rendered — then the scenery
// put back under it); any other window's text is rendered from its first interior cell (one further in for a menu),
// unless its text id's high byte is $FF. `de` is the caller's (MeasureDialogueWidthTiles fetches with it).
export function* redrawWindowText(P, id, de) {
  const R = mapped(P), { bus } = P, oldBank = pushWramBank(P, WRAM_TEXT);
  if (R.dialogueWindowId === id) {
    R.glyphWindowId = R.dialogueWindowId;
    do {
      R.glyphRowStartCol = 0; R.glyphFlushedCol = 0;
      const b7 = pushWramBank(P, WRAM_SOUND);
      clearGlyphBuffer(P);
      yield* uploadGlyphTilesPartial(P);
      P.wramBank(b7);
      const win = R.dialogueWindowId;
      measureDialogueWidthTiles(P, bus.u16(getWindowStructPtr(win) + 6), de);
      drawTextWindowFrame(P, win);
      yield* renderActiveWindowText(P);
      restoreTilemapUnderWindow(P, R.dialogueWindowId);
    } while (R.textPageBreakRequest);
  } else {
    const s = getWindowStructPtr(id);
    let col = (bus.u8(s) + 1) & 0xFF;
    const row = (bus.u8(s + 1) + 1) & 0xFF;
    if (bus.u8(s + 4) & 0x02) col = (col + 1) & 0xFF;
    const textId = bus.u16(s + 6);
    if (textId >> 8 !== 0xFF) {
      fetchDialogueText(P, textId, col << 8 | row);
      yield* renderTextString(P, wTextBuffer, col, row);
    }
  }
  P.wramBank(oldBank);
}

// UploadGlyphTilesPartial (05:622E): the first 54 glyph tiles to $8800 in two halves, a frame after each while the
// LCD is on. Returns the registers it leaves (a = the bank put back).
export function* uploadGlyphTilesPartial(P) {
  const oldBank = pushWramBank(P, WRAM_SOUND);
  queueVRAMCopy(P, 0xD300, vTiles1, 27);
  if (lcdOn(P)) yield* advanceFrame(P);
  const r = queueVRAMCopy(P, 0xD300 + 27 * 16, vTiles1 + 0x1B * 16, 27);
  if (lcdOn(P)) yield* advanceFrame(P);
  P.wramBank(oldBank);
  return { a: oldBank, bc: r.bc, de: r.de, hl: r.hl };
}

// Unused_05_RenderWindowTextToCompletion (05:6269): for the dialogue window, draw and render it page by page;
// for another window it looks up the text and does nothing with it. Nothing calls it.
export function* renderWindowTextToCompletion(P, id) {
  const R = mapped(P), oldBank = pushWramBank(P, WRAM_TEXT);
  if (R.dialogueWindowId === id) {
    R.glyphWindowId = R.dialogueWindowId;
    do {
      drawTextWindowFrame(P, R.dialogueWindowId);
      yield* renderActiveWindowText(P);
    } while (R.textPageBreakRequest);
  }
  P.wramBank(oldBank);
}

// RedrawWindowRowsSafe (05:62BC): RedrawWindowRows of window `id` in WRAM bank 5
export function* redrawWindowRowsSafe(P, id) {
  const oldBank = pushWramBank(P, WRAM_TEXT);
  yield* redrawWindowRowsThunk(P, id);
  P.wramBank(oldBank);
}
// CloseWindowAlt (05:62D8): CloseWindow (keeps a; leaves hl past the struct, from FreeWindow)
export function* closeWindowAlt(P, id) {
  restoreTilemapUnderWindow(P, id);
  yield* redrawWindowRowsThunk(P, id);
  resetWindowState(P, id);
  return freeWindow(P, id).hl;
}

// Unused_05_ShowDialogueCentered (05:62E7): a dialogue centred on cell (d, e), drawn page by page with
// RedrawWindowText, then closed. Returns the hl CloseWindowAlt leaves. Nothing calls it.
export function* showDialogueCentered(P, textId, center) {
  const R = mapped(P), oldBank = pushWramBank(P, WRAM_TEXT);
  resetTextArgQueues(P);
  let id = addTextIdOffset(P, textId, 0).hl;
  applyMessageSpeed(P);
  if (R.dialogueWindowId === DIALOGUEWIN_NONE) openCenteredDialogueWindow(P, id, center);
  do {
    id = setActiveWindowTextId(P, id);
    yield* redrawWindowText(P, R.dialogueWindowId, id);
    yield* redrawWindowRowsThunk(P, R.dialogueWindowId);
  } while (R.textPageBreakRequest);
  const hl = yield* closeWindowAlt(P, R.dialogueWindowId);
  R.dialogueWindowId = DIALOGUEWIN_NONE;
  resetTextArgQueues(P);
  P.wramBank(oldBank);
  return hl;
}
// Unused_05_OpenCenteredDialogueWindow (05:634F): a 20x7 dialogue window moved to centre on (d, e) (no fitting,
// no wrap), drawn
export function openCenteredDialogueWindow(P, textId, center) {
  const R = mapped(P), { bus } = P;
  const top = createDialogueWindow(P, 0, 0, 0x14, 0x07).de;
  fetchDialogueText(P, textId, top);
  const s = getWindowStructPtr(R.dialogueWindowId);
  const col = ((center >> 8) - ((bus.u8(s + 2) << 24 >> 24) >> 1)) & 0xFF;
  const row = ((center & 0xFF) - ((bus.u8(s + 3) << 24 >> 24) >> 1)) & 0xFF;
  bus.w8(s + 1, row); bus.w8(s, col);
  drawTextWindowFrame(P, R.dialogueWindowId);
}

// Unused_05_ChooseSpeechBubbleHalf (05:6388): OpenSpeechBubble's choice of half (row 11 here) on its own: sets
// wSpeechBubbleLowerHalf and returns de = (0, row)
export function chooseSpeechBubbleHalf(P, speaker) {
  const R = mapped(P), { bus } = P, entryBank = P.V.wramBank;
  let row = speaker & 0x3F, lowerHalf = (speaker << 1) & 0xFF;
  if (!(speaker & 0x80)) {
    const actor = getObjectSlotPointer(P, speaker & 0x3F).hl;
    const cameraRow = hi(R.cameraY);
    P.V.actorPtr = actor & 0xFF; bus.w8(P.A.actorPtr + 1, actor >> 8);
    P.wramBank(WRAM_ACTORS);
    const actorRow = bus.u8(((actor & 0xFF00) | ((actor + 0x0E) & 0xFF)) + 1 & 0xFFFF);
    if (((actorRow - cameraRow) & 0xFF) < 0x0A) { row = 0x0B; lowerHalf = 1; } else { row = 0; lowerHalf = 0; }
  }
  P.wramBank(WRAM_TEXT);
  R.speechBubbleLowerHalf = lowerHalf;
  P.wramBank(entryBank);
  return row;
}

// the flag number under the debug flag editor's cursor: page * 64 + byte * 8 + bit (8 bits)
const selectedFlag = R => ((((R.debugFlagPage << 6) & 0xFF) + R.debugFlagByte * 8) & 0xFF) + R.debugFlagBit & 0xFF;
// DebugToggleSelectedFlag (05:63D8): flip the game flag under the cursor
export function debugToggleSelectedFlag(P) {
  const n = selectedFlag(mapped(P));
  const set = !(callHome(P, HOME.TestGameFlagByNumber, { d: 0, e: n }).f & Z);
  callHome(P, set ? HOME.ClearGameFlagByNumber : HOME.SetGameFlagByNumber, { d: 0, e: n });
}
// DebugDrawFlagsWindow1 (05:6407) / DebugDrawFlagsWindow2 (05:6447): 32 flags of the page in each window: two
// hex row labels and four rows of 8 bits
export function debugDrawFlagsWindow(P, which) {
  const R = mapped(P);
  const id = which === 1 ? R.debugFlagWindow1Id : R.debugFlagWindow2Id;
  let base = which === 1 ? (R.debugFlagPage << 6) & 0xFF : ((R.debugFlagPage * 2 + 1) << 5) & 0xFF;
  debugDrawHexRowLabel(P, base, id, 0x0101);
  debugDrawFlagBitRow(P, base, id, 0x0401);
  base = (base + 8) & 0xFF; debugDrawFlagBitRow(P, base, id, 0x0402);
  base = (base + 8) & 0xFF; debugDrawHexRowLabel(P, base, id, 0x0104); debugDrawFlagBitRow(P, base, id, 0x0404);
  base = (base + 8) & 0xFF; debugDrawFlagBitRow(P, base, id, 0x0405);
}

export const HOOKS = [
  hook(5, 0x608A, (P, r) => ({ a: getSpeakerVoice(P, r.a) })),
  hook(5, 0x617A, P => resetTextWindowsAndRestoreMap(P)),
  hook(5, 0x6181, (P, r) => createWindowWithTextId(P, r.d, r.e, r.b, r.c, r.hl)),
  hook(5, 0x61A2, (P, r) => redrawWindowText(P, r.a, r.de)),
  hook(5, 0x622E, P => uploadGlyphTilesPartial(P)),
  hook(5, 0x6269, (P, r) => renderWindowTextToCompletion(P, r.a)),
  hook(5, 0x62BC, (P, r) => redrawWindowRowsSafe(P, r.a)),
  hook(5, 0x62D8, (P, r) => (function* () { return { hl: yield* closeWindowAlt(P, r.a) }; })()),
  hook(5, 0x62E7, (P, r) => (function* () { return { hl: yield* showDialogueCentered(P, r.hl, r.de) }; })()),
  hook(5, 0x634F, (P, r) => { openCenteredDialogueWindow(P, r.hl, r.de); }),
  hook(5, 0x6388, (P, r) => ({ d: 0, e: chooseSpeechBubbleHalf(P, r.a) })),
  hook(5, 0x63D8, P => { debugToggleSelectedFlag(P); }),
  hook(5, 0x6407, P => { debugDrawFlagsWindow(P, 1); }),
  hook(5, 0x6447, P => { debugDrawFlagsWindow(P, 2); }),
];
