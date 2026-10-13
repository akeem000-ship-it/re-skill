// A window's text: its text id, rendering it, sizing a window to its text, the per-character delay and the message
// speed, and the speaker dialogue loop (bank $05, src/engine/text/window_text_05.asm). Port of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses are its own.
//
// ShowSpeakerDialogue is the story's dialogue box: a speech bubble over the speaker, filled page by page by the
// text printer (RenderTextString), resized to each page's text (FitWindowToText).
// Covered by out/port/story1.mtrec (every scene of the story's opening) and web/tests/port/routines_text.mjs.
import {
  FLAG, WRAM_TEXT, WRAM_SOUND, DIALOGUEWIN_NONE, PAD_ANY_BUTTON, mapped, hook, setFlag, clearFlag, advanceFrame,
  playSound, pushWramBank, addFlags,
} from "./common.js";
import { getWindowStructPtr, drawTextWindowFrame } from "./window_alloc.js";
import { fetchDialogueText, addTextIdOffset, openSpeechBubble } from "./dialogue.js";
import { renderTextString } from "./cursor.js";
import { getGlyphWidth, redrawWindowRowsPadded, closeWindow } from "./rows.js";
import { setWindowRect, restoreShadowTilemap, restoreTilemapUnderWindow } from "./shadow.js";
import { clearGlyphBuffer, uploadGlyphBufferFull } from "./glyph_buffer.js";
import {
  measureNextArgStringWidth, measureMainCharacterNameWidth, measurePartnerCharacterNameWidth,
} from "./arg.js";
import { getNextArgShortTextLength, measureNextArgNumberWidth, measureIndexedShortTextWidth } from "./control.js";
import { getSpeakerVoice } from "./window_redraw.js";

export const wTextBuffer = 0xC600;
const TEXT_ID_NONE_HIGH = 0x03;                               // a text id whose high byte is 3: the window has no text
const VOICE_SILENT = 0x08;

// SetWindowTextId (05:55D5): text id `textId` into window `id`'s struct (+6). Returns the registers it leaves.
export function setWindowTextId(P, id, textId) {
  const s = getWindowStructPtr(id);
  P.bus.w8(s + 6, textId & 0xFF); P.bus.w8(s + 7, textId >> 8);
  return { a: textId & 0xFF, f: addFlags(6, s & 0xFF), de: textId, hl: s + 7 };
}
// SetActiveWindowTextId (05:55E6): the dialogue window's text id (AddTextIdOffset with 0 first). Returns the id.
export function setActiveWindowTextId(P, textId) {
  const id = addTextIdOffset(P, textId, 0).hl;
  setWindowTextId(P, mapped(P).dialogueWindowId, id);
  return id;
}

// RenderWindowText (05:55F8): print window `id`'s text (its id's high byte masked to 6 bits; $03xx: no text, then
// wWindowTextEmpty = 1) from its first interior cell. A page break pending from the last call is cleared first.
export function* renderWindowText(P, id) {
  const R = mapped(P), s = getWindowStructPtr(id);
  const textId = (P.bus.u16(s + 6)) & 0x3FFF;
  if (R.textPageBreakRequest) R.textPageBreakRequest = 0;
  R.windowTextEmpty = 1;
  if (textId >> 8 === TEXT_ID_NONE_HIGH) return;
  R.windowTextEmpty = 0;
  fetchDialogueText(P, textId);
  const col = (P.bus.u8(s) + 1) & 0x1F, row = (P.bus.u8(s + 1) + 1) & 0x1F;
  yield* renderTextString(P, wTextBuffer, col, row);
}
// RenderActiveWindowText (05:5648): RenderWindowText of the dialogue window
export function* renderActiveWindowText(P) { yield* renderWindowText(P, mapped(P).dialogueWindowId); }

// the widths the measuring passes add for the substitutions (control codes)
function measureSubstitution(P, code, text) {
  switch (code) {
    case 0x08: return { w: getNextArgShortTextLength(P) };
    case 0x09: return { w: measureNextArgNumberWidth(P) };
    case 0x07: return { w: measureMainCharacterNameWidth(P) };
    case 0x04: return { w: measureNextArgStringWidth(P) };
    case 0x0B: return { w: measurePartnerCharacterNameWidth(P) };
    case 0x0E: mapped(P).textCharNameArg = P.bus.u8(text); return { w: measureIndexedShortTextWidth(P), skip: 1 };
  }
  return null;
}

// FitWindowToText (05:5654): measure the page of wTextBuffer the printer is on (from wTextResumePtr after a page
// break) — the widest line in pixels, the number of lines, with the substitutions' widths — and resize the dialogue
// window to fit, centred in its rect (wDialogueWindow*). The size is kept in wFitTextWidthCells / wFitTextLineCount.
// (The last thing it does is store the new row in wTextArgNumberMeasureIndex: SetWindowRect leaves it in a.)
export function fitWindowToText(P) {
  const R = mapped(P), { bus } = P;
  let p = R.textResumePtr >> 8 ? R.textResumePtr : wTextBuffer;
  let line = 0, widest = 0, lines = 0;
  for (;;) {
    const ch = bus.u8(p); p = (p + 1) & 0xFFFF;
    if (ch === 0x00 || ch === 0x02) break;
    if (ch === 0x01) { lines++; if (widest < line) widest = line; line = 0; continue; }
    const sub = measureSubstitution(P, ch, p);
    if (sub) { line = (line + sub.w) & 0xFF; p = (p + (sub.skip || 0)) & 0xFFFF; continue; }
    if (ch < 0x20 || ch >= 0x7B) continue;
    line = (line + getGlyphWidth(P, ch)) & 0xFF;
  }
  lines = (lines + 1) & 0xFF;
  if (widest < line) widest = line;
  const widthCells = ((widest >> 3) + (widest & 7 ? 1 : 0)) & 0xFF;
  R.fitTextWidthCells = widthCells;
  R.fitTextLineCount = lines;
  const width = (widthCells + 2) & 0xFF, height = (lines * 2 + 1) & 0xFF;
  const col = (((R.dialogueWindowWidth - width) & 0xFF) >> 1) + R.dialogueWindowCol & 0xFF;
  const row = (((R.dialogueWindowHeight - height) & 0xFF) >> 1) + R.dialogueWindowRow & 0xFF;
  const rect = setWindowRect(P, getWindowStructPtr(R.dialogueWindowId), col, row, width, height);
  R.textArgNumberMeasureIndex = rect.a;
}

// MeasureTextDimensions (05:5745): the size of the text in wTextBuffer (to its $00): b = the widest line in pixels
// + 3, c = lines * 2 + 1 (only the $08 and $09 substitutions are measured here)
export function measureTextDimensions(P) {
  const { bus } = P;
  let p = wTextBuffer, line = 0, widest = 0, lines = 0;
  for (;;) {
    const ch = bus.u8(p); p = (p + 1) & 0xFFFF;
    if (ch === 0x00) break;
    if (ch === 0x01) { lines++; if (widest < line) widest = line; line = 0; continue; }
    if (ch === 0x08) { line = (line + getNextArgShortTextLength(P)) & 0xFF; continue; }
    if (ch === 0x09) { line = (line + measureNextArgNumberWidth(P)) & 0xFF; continue; }
    if (ch < 0x20 || ch >= 0x7B) continue;
    line = (line + getGlyphWidth(P, ch)) & 0xFF;
  }
  lines = (lines + 1) & 0xFF;
  if (widest < line) widest = line;
  return { b: (widest + 3) & 0xFF, c: (lines * 2 + 1) & 0xFF };
}

// DelayTextCharacter (05:579B): after a character is printed, wait wTextRedrawGuard frames (the message speed: 0
// fast, 2 normal, 4 slow; 4 after a space), any button cutting it short — with the speaker's voice blip
// ($9A + voice * 4 + (char & 3)) unless the voice is 8 (silent) or the character a space
export function* delayTextCharacter(P, ch) {
  const R = mapped(P), V = P.V, oldBank = pushWramBank(P, WRAM_TEXT);
  let frames = R.textRedrawGuard;
  if (frames) {
    if (ch === 0x20) frames = 4;
    else if (R.dialogueVoice !== VOICE_SILENT) playSound(P, (0x9A + ((R.dialogueVoice << 2) & 0xFF) + (ch & 3)) & 0xFF);
    do {
      yield* advanceFrame(P);
      if (V.playerInputFlags & PAD_ANY_BUTTON) break;
      frames = (frames - 1) & 0xFF;
    } while (frames);
  }
  P.wramBank(oldBank);
}

// ApplyMessageSpeed (05:57E7): wTextRedrawGuard (the per-character delay) from wMessageSpeed: "instant" (bit 7) or
// fast 0 -> 0, normal 1 -> 2, slow -> 4
export function applyMessageSpeed(P) {
  const R = mapped(P), oldBank = pushWramBank(P, WRAM_TEXT);
  const speed = R.messageSpeed;
  R.textRedrawGuard = speed & 0x80 ? 0 : speed === 0 ? 0 : speed === 1 ? 2 : 4;
  P.wramBank(oldBank);
}

// the six text-argument queue indices (write and measure, for strings, numbers and short texts)
export function resetTextArgQueues(P) {
  const R = mapped(P);
  R.textArgStringWriteIndex = 0; R.textArgStringMeasureIndex = 0;
  R.textArgNumberWriteIndex = 0; R.textArgNumberMeasureIndex = 0;
  R.textArgShortTextWriteIndex = 0; R.textArgShortTextMeasureIndex = 0;
}
// wDialogueSpeaker ($FF becomes 0), the message speed, and the speaker's voice: 8 (silent) for a speaker with bit 7
// set, else GetSpeakerVoice
function setDialogueSpeaker(P, speaker) {
  const R = mapped(P), who = speaker === 0xFF ? 0x00 : speaker;
  R.dialogueSpeaker = who;
  applyMessageSpeed(P);
  R.dialogueVoice = who & 0x80 ? VOICE_SILENT : getSpeakerVoice(P, who);
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

// ShowSpeakerDialogue (05:581F): show text `textId` said by `speaker` (an actor slot; $FF none; bit 7: no voice) in
// a speech bubble — opened over the speaker unless a dialogue window is already open — page by page, then close it.
// Returns the text id it leaves in hl.
export function* showSpeakerDialogue(P, speaker, textId) {
  const R = mapped(P), oldBank = pushWramBank(P, WRAM_TEXT);
  resetTextArgQueues(P);
  let id = addTextIdOffset(P, textId, 0).hl;
  setDialogueSpeaker(P, speaker);
  if (R.dialogueWindowId === DIALOGUEWIN_NONE) {
    yield* clearGlyphPage(P);
    yield* openSpeechBubble(P, R.dialogueSpeaker, id);
    yield* restoreShadowTilemap(P);
  }
  for (;;) {
    yield* clearGlyphPage(P);
    id = setActiveWindowTextId(P, id);
    const win = R.dialogueWindowId;
    setFlag(P, FLAG.TEXT_RENDER_ACTIVE);
    drawTextWindowFrame(P, win);
    clearFlag(P, FLAG.TEXT_RENDER_ACTIVE);
    yield* redrawWindowRowsPadded(P, win);
    yield* renderActiveWindowText(P);
    if (!R.textPageBreakRequest) break;
    restoreTilemapUnderWindow(P, R.dialogueWindowId);
    fitWindowToText(P);
  }
  yield* closeWindow(P, R.dialogueWindowId);
  R.dialogueWindowId = DIALOGUEWIN_NONE;
  resetTextArgQueues(P);
  P.wramBank(oldBank);
  return id;
}
// ShowSpeakerDialogueRestoreBG (05:58F0): as ShowSpeakerDialogue, but the scenery is restored before every page,
// and the window stays open at the end
export function* showSpeakerDialogueRestoreBG(P, speaker, textId) {
  const R = mapped(P), oldBank = pushWramBank(P, WRAM_TEXT);
  resetTextArgQueues(P);
  let id = addTextIdOffset(P, textId, 0).hl;
  setDialogueSpeaker(P, speaker);
  if (R.dialogueWindowId === DIALOGUEWIN_NONE) {
    yield* clearGlyphPage(P);
    yield* openSpeechBubble(P, R.dialogueSpeaker, id);
  }
  for (;;) {
    yield* clearGlyphPage(P);
    id = setActiveWindowTextId(P, id);
    yield* restoreShadowTilemap(P);
    const win = R.dialogueWindowId;
    setFlag(P, FLAG.TEXT_RENDER_ACTIVE);
    drawTextWindowFrame(P, win);
    clearFlag(P, FLAG.TEXT_RENDER_ACTIVE);
    yield* redrawWindowRowsPadded(P, win);
    yield* renderActiveWindowText(P);
    if (!R.textPageBreakRequest) break;
    fitWindowToText(P);
  }
  resetTextArgQueues(P);
  P.wramBank(oldBank);
  return id;
}

export const HOOKS = [
  hook(5, 0x55D5, (P, r) => setWindowTextId(P, r.b, r.hl)),
  hook(5, 0x55E6, (P, r) => { const id = setActiveWindowTextId(P, r.hl); return { hl: id, de: id }; }),
  hook(5, 0x55F8, (P, r) => renderWindowText(P, r.b)),
  hook(5, 0x5648, P => renderActiveWindowText(P)),
  hook(5, 0x5654, P => { fitWindowToText(P); }),
  hook(5, 0x5745, P => measureTextDimensions(P)),
  hook(5, 0x579B, (P, r) => delayTextCharacter(P, r.a)),
  hook(5, 0x57E7, P => { applyMessageSpeed(P); }),
  hook(5, 0x581F, (P, r) => (function* () { return { hl: yield* showSpeakerDialogue(P, r.a, r.hl) }; })()),
  hook(5, 0x58F0, (P, r) => (function* () { return { hl: yield* showSpeakerDialogueRestoreBG(P, r.a, r.hl) }; })()),
];
