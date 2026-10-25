// Dialogue windows (the speech bubble and the debug/unused variants), text fetching by text id and text-id
// arithmetic (bank $05, src/engine/text/dialogue_05.asm). Port of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own.
//
// A text id is a coordinate: bit 15 = a player-entered string in SRAM, bits 13-10 = the text bank
// (DialogueTextFetchers_05: 0-7 -> $30-$37, 8 -> $6E, 9 -> $1F, 10 -> $25, 11 -> $26, 12 -> $5E, 13-15 -> $30),
// bits 9-0 = the string's index. Each text bank exports FetchDialogueText_XX (slot 0, into wTextBuffer) and
// FetchShortText_XX (slot 2, into wShortTextBuffer).
// Covered by out/port/story1.mtrec (the speech bubbles) and web/tests/port/routines_text.mjs.
import {
  FLAG, WRAM_TEXT, WRAM_SOUND, WRAM_ACTORS, DIALOGUEWIN_NONE, mapped, hook, setFlag, clearFlag, farcall, pushWramBank, Z, H, C, hi,
} from "./common.js";
import {
  getWindowStructPtr, drawTextWindowFrame, saveWindowStruct, restoreWindowStruct, fetchSRAMDialogueText,
} from "./window_alloc.js";
import { createDialogueWindow } from "./window_create.js";
import {
  fitWindowToText, setActiveWindowTextId, renderActiveWindowText, applyMessageSpeed, resetTextArgQueues,
} from "./window_text.js";
import { restoreShadowTilemap, refreshShadowTilemapFromMapBuffer, setWindowRect } from "./shadow.js";
import { redrawWindowRowsPadded, closeWindow } from "./rows.js";
import { clearGlyphBuffer, uploadGlyphBufferFull } from "./glyph_buffer.js";
import { getSpeakerVoice, getObjectSlotPointer } from "./window_redraw.js";

// DialogueTextFetchers_05 / ShortTextFetchers_05: the text bank of each value of bits 13-10
export const TEXT_BANKS = [0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x6E, 0x1F, 0x25, 0x26, 0x5E, 0x30, 0x30, 0x30];
const AddTextIdOffsetWordLookupTable = 0x5D99;               // strings per text bank (13 words)
const VOICE_SILENT = 0x08;

// FetchDialogueText (05:5C18): string `textId` into wTextBuffer (keeps every register). An SRAM id (bit 15) reads
// the SRAM string whose index is in de — the caller's de, not the id: the code jumps to FetchSRAMDialogueText before
// it loads de from the id. So the callers pass the de they have.
export function fetchDialogueText(P, textId, de) {
  if (textId & 0x8000) { fetchSRAMDialogueText(P, de); return; }
  if (((textId >> 10) & 0x0F) === TEXT_CODE_PLUS && PLUS_LINES[textId & 0x3FF]) { fetchPlusText(P, PLUS_LINES[textId & 0x3FF]); return; }
  farcall(P, TEXT_BANKS[(textId >> 10) & 0x0F], 0x00, { d: (textId >> 8) & 3, e: textId & 0xFF, b: textId >> 8 });   // FetchDialogueText_XX
}
// PLAY+: the port's own lines, as text ids of bank code 13 (DialogueTextFetchers_05 sends 13-15 to bank $30 too; the
// game uses none of them): 0-1 the coach on STAMINA at the Academy's gate (story_scripts/student_11.js). The game's
// encoding: $01 a new line, $02 the next page, $03 the end; into wTextBuffer through the 0 that ends it (159 at most).
const TEXT_CODE_PLUS = 13;
export const TEXT_PLUS_STAMINA = TEXT_CODE_PLUS << 10;
const PLUS_LINES = [
  "One more thing:\x01every swing tires\x01you out.\x02Charged power shots\x01tire you the most.\x01That's STAMINA.\x02Tired players run\x01slower and hit\x01softer.\x03",
  "Your breath comes\x01back after every\x01point.\x02Eat well and rest in\x01your dorm room to\x01keep your energy up.\x02When you level up,\x01train STAMINA to\x01last even longer.\x03",
];
function fetchPlusText(P, text) {
  const n = Math.min(text.length, 159);
  for (let i = 0; i < n; i++) P.bus.w8(0xC600 + i, text.charCodeAt(i));
  P.bus.w8(0xC600 + n, 0);
}
// FetchShortText (05:5CA8): string `textId` of a text bank (bits 13-10, no SRAM case) into wShortTextBuffer
export function fetchShortText(P, textId) {
  farcall(P, TEXT_BANKS[(textId >> 10) & 0x0F], 0x02, { d: (textId >> 8) & 3, e: textId & 0xFF, b: textId >> 8 });   // FetchShortText_XX
}

// AddTextIdOffset (05:5D2B): text id + `offset`, carried into the next text bank (once) when it passes the bank's
// string count, so ids form one sequence. SRAM ids (bit 15) come back as they are. Returns hl (and the flags of
// the bit test for an SRAM id).
export function addTextIdOffset(P, textId, offset, entryF = 0) {
  if (textId & 0x8000) return { hl: textId, f: H | (entryF & C) };
  const h = textId >> 8, f = Z | (entryF & C);                // (the flags of bit 7, h, kept by its push af)
  if (((h >> 2) & 0x0F) === TEXT_CODE_PLUS && PLUS_LINES[textId & 0x3FF]) return { hl: (textId + offset) & 0xFFFF, f };   // PLAY+
  const sum = ((((h & 3) << 8) | (textId & 0xFF)) + offset) & 0xFFFF;
  const candidate = ((((sum >> 8) | (h & 0x3C)) & 0xFF) << 8) | (sum & 0xFF);
  const count = P.bus.u16(AddTextIdOffsetWordLookupTable + ((h & 0x3C) >> 1));
  const left = (count - sum) & 0xFFFF;
  if (left !== 0 && !(left & 0x8000)) return { hl: candidate, f };
  const over = (-left) & 0xFFFF;                             // how far past the bank's last string
  const ch = candidate >> 8;
  const bank = ((((ch & 0x3C) + 4) & 0xFF) | (ch & 0xC0)) | ((over >> 8) & 3);
  return { hl: (bank & 0xFF) << 8 | (over & 0xFF), f };
}

// a fresh page: the glyph tiles cleared and uploaded
function* clearGlyphPage(P) {
  const R = mapped(P);
  R.glyphRowStartCol = 0; R.glyphFlushedCol = 0;
  const oldBank = pushWramBank(P, WRAM_SOUND);
  clearGlyphBuffer(P);
  yield* uploadGlyphBufferFull(P);
  P.wramBank(oldBank);
}

// Unused_05_ShowDialogueAtPosition (05:59B0): ShowSpeakerDialogue's loop around a dialogue window opened centred
// on (d, e). Returns the text id left in hl. Nothing calls it.
export function* showDialogueAtPosition(P, speaker, textId, center) {
  const R = mapped(P), oldBank = pushWramBank(P, WRAM_TEXT);
  resetTextArgQueues(P);
  let id = addTextIdOffset(P, textId, 0).hl;
  R.dialogueVoice = speaker & 0x80 ? VOICE_SILENT : getSpeakerVoice(P, speaker).a;
  applyMessageSpeed(P);
  if (R.dialogueWindowId === DIALOGUEWIN_NONE) {
    openDialogueWindowCentered(P, id, center);
    refreshShadowTilemapFromMapBuffer(P);
  }
  do {
    yield* clearGlyphPage(P);
    id = setActiveWindowTextId(P, id);
    const win = R.dialogueWindowId;
    setFlag(P, FLAG.TEXT_RENDER_ACTIVE);
    drawTextWindowFrame(P, win);
    clearFlag(P, FLAG.TEXT_RENDER_ACTIVE);
    yield* redrawWindowRowsPadded(P, win);
    yield* renderActiveWindowText(P);
  } while (R.textPageBreakRequest);
  yield* closeWindow(P, R.dialogueWindowId);
  R.dialogueWindowId = DIALOGUEWIN_NONE;
  resetTextArgQueues(P);
  P.wramBank(oldBank);
  return id;
}

// Unused_05_DrawDialogueAtPosition (05:5A4F): a dialogue window centred on (d - 10, e - 9) with the text set but
// never printed (the printer call is a stub): it restores the scenery for ever while a page break is pending.
// The voice is looked up for the speaker e - 9. Returns the text id left in hl. Nothing calls it.
export function* drawDialogueAtPosition(P, textId, center) {
  const R = mapped(P);
  const d = ((center >> 8) - 0x0A) & 0xFF, e = ((center & 0xFF) - 0x09) & 0xFF;
  const oldBank = pushWramBank(P, WRAM_TEXT);
  R.dialogueVoice = e & 0x80 ? VOICE_SILENT : getSpeakerVoice(P, e).a;
  if (R.dialogueWindowId === DIALOGUEWIN_NONE) openDialogueWindowCentered(P, textId, d << 8 | e);
  let id = textId;
  do {
    id = setActiveWindowTextId(P, id);
    yield* restoreShadowTilemap(P);
  } while (R.textPageBreakRequest);
  P.wramBank(oldBank);
  return id;
}

// CloseActiveDialogueWindow (05:5A93): close the dialogue window and forget it
export function* closeActiveDialogueWindow(P) {
  const R = mapped(P), oldBank = pushWramBank(P, WRAM_TEXT);
  yield* closeWindow(P, R.dialogueWindowId);
  R.dialogueWindowId = DIALOGUEWIN_NONE;
  P.wramBank(oldBank);
}

// OpenSpeechBubble (05:5AAF): open the dialogue window for text `textId` said by `speaker`: a 20x7 rect at the top
// of the screen, or at row 10 when the speaker (an actor slot) stands within 10 rows of the camera's top
// (wSpeechBubbleLowerHalf); sized to the text (FitWindowToText), then grown from a small box in the middle to that
// size, a frame per step. (A speaker with bit 7 set takes row = its low 6 bits.)
export function* openSpeechBubble(P, speaker, textId) {
  const R = mapped(P), { bus } = P, entryBank = P.V.wramBank;
  let row = speaker & 0x3F, lowerHalf = (speaker << 1) & 0xFF;
  if (!(speaker & 0x80)) {
    const actor = getObjectSlotPointer(P, speaker & 0x3F).hl;
    const cameraRow = hi(R.cameraY);
    P.V.actorPtr = actor & 0xFF; bus.w8(P.A.actorPtr + 1, actor >> 8);   // hActorPtr
    P.wramBank(WRAM_ACTORS);
    const actorRow = bus.u8(((actor & 0xFF00) | ((actor + 0x0E) & 0xFF)) + 1 & 0xFFFF);
    if (((actorRow - cameraRow) & 0xFF) < 0x0A) { row = 0x0A; lowerHalf = 1; } else { row = 0; lowerHalf = 0; }
  }
  P.wramBank(WRAM_TEXT);
  R.speechBubbleLowerHalf = lowerHalf;
  P.wramBank(entryBank);
  const top = createDialogueWindow(P, 0, row, 0x14, 0x07).de;
  fetchDialogueText(P, textId, top);
  fitWindowToText(P);
  R.textArgStringMeasureIndex = 0;
  R.textArgShortTextMeasureIndex = 0;
  const target = getWindowStructPtr(R.dialogueWindowId);
  P.wramBank(WRAM_TEXT);
  let col = (R.dialogueWindowCol + 8) & 0x1F, r = (R.dialogueWindowRow + 2) & 0x1F, w = 3, h = 3;
  const targetWidth = bus.u8(target + 2);
  let steps = targetWidth >> 1;
  if (!(targetWidth & 1)) w = 4;
  yield* restoreShadowTilemap(P);
  saveWindowStruct(P, R.windowId);
  const saved = 0xDC78;                                       // wSavedWindowStruct: the size to grow to
  for (let n = steps || 256; n > 0; n--) {
    setWindowRect(P, getWindowStructPtr(R.windowId), col, r, w, h);
    drawTextWindowFrame(P, R.windowId);
    yield* redrawWindowRowsPadded(P, R.windowId);
    if (col !== bus.u8(saved)) col = (col - 1) & 0x1F;        // step left to the target column
    r = (r - 1) & 0xFF;                                       // and up to the target row
    if (((r - bus.u8(saved + 1)) & 0x80)) r = bus.u8(saved + 1);
    w = (w + 2) & 0xFF; if (bus.u8(saved + 2) < w) w = bus.u8(saved + 2);
    h = (h + 1) & 0xFF; if (bus.u8(saved + 3) < h) h = bus.u8(saved + 3);
  }
  restoreWindowStruct(P, R.dialogueWindowId);
}

// Unused_05_OpenDialogueWindowCentered (05:5BA0): a dialogue window for text `textId`, sized to it and centred on
// cell `center` (d, e), drawn. Nothing reaches it.
export function openDialogueWindowCentered(P, textId, center) {
  const R = mapped(P), { bus } = P;
  const top = createDialogueWindow(P, 0, 0, 0x14, 0x07).de;
  fetchDialogueText(P, textId, top);
  fitWindowToText(P);
  const s = getWindowStructPtr(R.dialogueWindowId);
  const col = ((center >> 8) - ((bus.u8(s + 2) << 24 >> 24) >> 1)) & 0x1F;
  const row = ((center & 0xFF) - ((bus.u8(s + 3) << 24 >> 24) >> 1)) & 0x1F;
  bus.w8(s + 1, row); bus.w8(s, col);
  drawTextWindowFrame(P, R.windowId);
}

// MeasureDialogueWidthTiles (05:5BFC): the width in cells of text `textId` (its FitWindowToText)
export function measureDialogueWidthTiles(P, textId, de) {
  const oldBank = pushWramBank(P, WRAM_TEXT);
  fetchDialogueText(P, textId, de);
  fitWindowToText(P);
  const width = mapped(P).fitTextWidthCells;
  P.wramBank(oldBank);
  return width;
}

export const HOOKS = [
  hook(5, 0x59B0, (P, r) => (function* () { return { hl: yield* showDialogueAtPosition(P, r.a, r.hl, r.de) }; })()),
  hook(5, 0x5A4F, (P, r) => (function* () { return { hl: yield* drawDialogueAtPosition(P, r.hl, r.de) }; })()),
  hook(5, 0x5A93, P => closeActiveDialogueWindow(P)),
  hook(5, 0x5AAF, (P, r) => openSpeechBubble(P, r.a, r.hl)),
  hook(5, 0x5BA0, (P, r) => { openDialogueWindowCentered(P, r.hl, r.de); }),
  hook(5, 0x5BFC, (P, r) => ({ a: measureDialogueWidthTiles(P, r.hl, r.de) })),
  hook(5, 0x5C18, (P, r) => { fetchDialogueText(P, r.hl, r.de); }),
  hook(5, 0x5CA8, (P, r) => { fetchShortText(P, r.hl); }),
  hook(5, 0x5D2B, (P, r) => addTextIdOffset(P, r.hl, r.a, r.f)),
];
