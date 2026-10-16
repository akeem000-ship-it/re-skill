// Bank $1a: the unused EXP gain screen's counting: its number task (the EXP counted and the EXP still needed, as
// digit sprites; a level-up queued when the need runs out), the gauge step, the captions and messages drawn into
// the tile buffer (texts fetched into wTextTileBuffer first), the bonus messages by kind, and the run of the screen
// for both characters.
// Port of src/engine/menus/debug/exp_gauge_1a.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own; positioned strings are read from the ROM.
// Nothing in the game reaches this code.
// Tests: web/tests/port/routines_menus_misc.mjs (the routines that do not wait); lockstep on
// out/port/dbg_expgain.mtrec (scripted: the screen and a bonus message).
import {
  FZ, FN, FH, FC, FAR, rom, far, u8, w8, wram, withWram, sound, advanceFrame, hook, hookGen, nop, decFlags, spAddFlags,
  WRAM_STAGING, WRAM_SCREEN, WRAM_TEXT, WRAM_SCENE, VRAM_BANK1, vBGMap0, wDecompBuffer, wTextTileBuffer,
  BGM_NONE, SFX_CAPTION, wTextBuffer, wCharDataAnimCounter, wExpScreenFlags, EXPSCREEN_MESSAGE, EXPSCREEN_REDRAW_CAPTION,
  wExpAwardTotal, wExpAwardCounted, wExpCountedSprite, wExpCountDone, wExpNumberSpriteShiftX, wExpLevelUpQueued,
  wExpToNextLevel, wExpToNextSprite, wExpToNextDisplayed, wExpToNextDigits, wExpCountedDigits, MAX_LEVEL,
  storyRecord, STORY_RECORD_LEVEL, sub16, bit7F, cpFlags, chain, farFlagsAt,
} from "./defs.js";
import { queueVRAMCopy } from "../../home/memory.js";
import { queueSprite } from "../../home/fade.js";
import { formatDecimalNumberUnsigned } from "../../home/debugtext.js";
import { getRegs } from "../../home/cpu.js";
import { fetchDialogueText } from "../../text/dialogue.js";
import { drawPositionedStringToTileBuffer, drawStringToTileBuffer } from "./expscreen.js";
import { drawExpScreenMessageBox } from "./exp_boxes.js";
import { showExpGainScreen } from "./expeditor.js";

export const BANK = 0x1A;
const ExtendModifierByteTable0 = 0x4483, ExtendModifierByteGfx1 = 0x449B;
const ExtendModifierByteTable2 = 0x44A8, ExtendModifierByteGfx3 = 0x44C1;
const MESSAGE_BLOCKS = 8;                                         // the message box's 4 rows
const NUMBER_DIGITS = 5, BLANK_DIGIT = 0x20, DIGIT_0 = 0x30, DIGIT_X_STEP = 8;
const CAPTION_AT = 0xD800 + 2 * 32 + 11, CAPTION_WIDTH = 0x20, TEXT_ATTR = 1;
const Text_31_238 = 0x04EE, Text_31_239 = 0x04EF, Text_31_240 = 0x04F0, Text_31_241 = 0x04F1, Text_31_242 = 0x04F2;
const Text_31_243 = 0x04F3, Text_31_244 = 0x04F4, Text_31_248 = 0x04F8, Text_31_249 = 0x04F9;
const Text_30_31 = 0x001F;                                        // the first of the bonus kinds' names ($14-$1e, other)
// the captions: [text, column, row] lines
const CAPTIONS = [
  [[Text_31_238, 3, 2]],
  [[Text_31_239, 1, 1], [Text_31_240, 1, 3]],
  [[Text_31_241, 1, 0x10]],
  null,                                                           // 3: the EXP caption, drawn to the screen rows
  [[Text_31_243, 3, 2]],
  [[Text_31_244, 0x0A, 0x10]],
];
const CAPTION_EXP = 3, CAPTION_MAX_LEVEL = 5;
// the bonus messages: kinds 1-3 have one line (Text_31_245-247); kinds $14-$1e and any other: Text_31_248, the
// kind's name, then Text_31_249 at a column that depends on the name's length
const BONUS_SIMPLE = { 0x01: 0x04F5, 0x02: 0x04F6, 0x03: 0x04F7 };
const BONUS_NAMED_FIRST = 0x14, BONUS_NAMED_COUNT = 11;
const BONUS_TAIL_COLUMN = [0x09, 0x0A, 0x0A, 0x09, 0x09, 0x0A, 0x0A, 0x09, 0x09, 0x0A, 0x0B, 0x09];

// ---- messages over the screen's top rows ----
// the message box with its strings drawn into the tile buffer, then copied to the top rows (wExpScreenFlags bit 0
// set meanwhile)
function* showTopMessage(P, draw) {
  const r = {};
  wram(P, WRAM_SCENE);
  w8(P, wExpScreenFlags, u8(P, wExpScreenFlags) | EXPSCREEN_MESSAGE);
  yield* advanceFrame(P);
  draw();
  wram(P, WRAM_STAGING);
  chain(r, { hl: wDecompBuffer, de: vBGMap0 + VRAM_BANK1, c: MESSAGE_BLOCKS });
  chain(r, queueVRAMCopy(P, wDecompBuffer, vBGMap0 + VRAM_BANK1, MESSAGE_BLOCKS));
  chain(r, { hl: wDecompBuffer + 0x400, de: vBGMap0, c: MESSAGE_BLOCKS });
  chain(r, queueVRAMCopy(P, wDecompBuffer + 0x400, vBGMap0, MESSAGE_BLOCKS));
  yield* advanceFrame(P);
  wram(P, WRAM_SCENE);
  const flags = u8(P, wExpScreenFlags) & ~EXPSCREEN_MESSAGE & 0xFF;
  w8(P, wExpScreenFlags, flags);
  return chain(r, { a: flags, f: (flags ? 0 : FZ) | FH });
}
// UnusedDrawExpScreenMessage_1 (1A:4DA9) / _2 (1A:4E07): the message box with two positioned strings
function* unusedDrawExpScreenMessage(P, first, second) {
  const old = P.V.wramBank;
  yield* showTopMessage(P, () => {
    drawExpScreenMessageBox(P);
    drawPositionedStringToTileBuffer(P, first);
    drawPositionedStringToTileBuffer(P, second);
  });
  wram(P, old);
}
export const unusedDrawExpScreenMessage1 = P => unusedDrawExpScreenMessage(P, ExtendModifierByteTable0, ExtendModifierByteGfx1);
export const unusedDrawExpScreenMessage2 = P => unusedDrawExpScreenMessage(P, ExtendModifierByteTable2, ExtendModifierByteGfx3);

// ---- the numbers ----
// FormatDecimalNumberUnsigned (00:1A27) called by a routine that pushed nothing: hl = its entry sp, a = 0
function formatNumber(P, value, dest) {
  const sp = (P.cpu.sp - 2) & 0xFFFF;
  return { de: formatDecimalNumberUnsigned(P, value, NUMBER_DIGITS, dest), hl: sp, a: 0, f: spAddFlags((sp - 6) & 0xFFFF, 6) };
}
// Unused_1a_ExpScreenNumberTask (1A:4E65), a frame task: the EXP counted; then, below level 99, the EXP still
// needed (while it is not 0; when it reaches 0 the caption is redrawn and a level-up queued, and from then on, as
// once a level-up has run, the full need of the next level)
export function expScreenNumberTask(P, entry) {
  const r = { ...entry };
  wram(P, WRAM_SCENE);
  chain(r, formatNumber(P, P.bus.u16(wExpAwardCounted), wExpCountedDigits));
  chain(r, unusedQueueNumberSpritesShifted(P, NUMBER_DIGITS, wExpCountedDigits, u8(P, wExpCountedSprite), u8(P, wExpCountedSprite + 1), (r.b << 8 | r.c), r.f));
  wram(P, WRAM_SCENE);
  const record = storyRecord(P) + STORY_RECORD_LEVEL;
  const level = u8(P, record);
  chain(r, { hl: record, a: level, f: cpFlags(level, MAX_LEVEL) });
  if (level === MAX_LEVEL) return r;
  const showNeed = value => {
    chain(r, formatNumber(P, value, wExpToNextDigits));
    return chain(r, unusedQueueNumberSprites(P, NUMBER_DIGITS, wExpToNextDigits, u8(P, wExpToNextSprite), u8(P, wExpToNextSprite + 1), (r.b << 8 | r.c), r.f));
  };
  if (!u8(P, wCharDataAnimCounter)) {
    const queued = u8(P, wExpLevelUpQueued);
    if (queued) return chain(r, { a: queued, f: FH });
    const need = P.bus.u16(wExpToNextDisplayed);
    if (need) return showNeed(need);
    w8(P, wExpScreenFlags, u8(P, wExpScreenFlags) | EXPSCREEN_REDRAW_CAPTION);
    w8(P, wExpLevelUpQueued, 1);
  }
  return showNeed(P.bus.u16(wExpToNextLevel));
}
// the digits at hl as sprites from (d, e) on, 8 apart (blanks skipped): tile = base + 2 * digit, the base and
// attribute in wExpCountedSprite + 2 / + 3; shift: wExpNumberSpriteShiftX added to x
function queueNumberSprites(P, count, hl, d, e, bc, f, shift) {
  let n = count;
  do {
    const x = shift ? (u8(P, wExpNumberSpriteShiftX) + d) & 0xFF : d;
    const ch = u8(P, hl);
    if (((ch - BLANK_DIGIT) & 0xFF) !== 0) {
      const tile = (u8(P, wExpCountedSprite + 2) + 2 * (ch - DIGIT_0)) & 0xFF;
      queueSprite(P, u8(P, wExpCountedSprite + 3), tile, x, e);
    }
    bc = (bc - 1) & 0xFFFF;
    hl = (hl + 1) & 0xFFFF;
    d = (d + DIGIT_X_STEP) & 0xFF;
    n = (n - 1) & 0xFF;
  } while (n);
  return { a: 0, f: FZ | FN | (f & FC), bc, hl, d, e };
}
// Unused_1a_QueueNumberSpritesShifted (1A:4F02): a digits at hl from (d, e), shifted by wExpNumberSpriteShiftX
export const unusedQueueNumberSpritesShifted = (P, count, hl, d, e, bc, f) => queueNumberSprites(P, count, hl, d, e, bc, f, true);
// Unused_1a_QueueNumberSprites (1A:4F82): the same without the shift
export const unusedQueueNumberSprites = (P, count, hl, d, e, bc, f) => queueNumberSprites(P, count, hl, d, e, bc, f, false);
// Unused_1a_AdvanceExpGaugeFill (1A:4F30): one more EXP counted (until the total: then wExpCountDone); the EXP still
// needed shown = the need less the count (0 once it goes negative)
export function unusedAdvanceExpGaugeFill(P, de) {
  wram(P, WRAM_SCENE);
  if (!u8(P, wExpCountDone)) {
    de = (P.bus.u16(wExpAwardCounted) + 1) & 0xFFFF;
    P.bus.w16(wExpAwardCounted, de);
    if (sub16(P.bus.u16(wExpAwardTotal), de).hl === 0) w8(P, wExpCountDone, 1);
  }
  const bc = P.bus.u16(wExpAwardCounted), left = sub16(P.bus.u16(wExpToNextLevel), bc), h = left.hl >> 8;
  if (h & 0x80) {
    P.bus.w16(wExpToNextDisplayed, 0);
    return { a: 0, f: FZ, bc, de, hl: wExpToNextDisplayed + 2 };
  }
  P.bus.w16(wExpToNextDisplayed, left.hl);
  return { a: left.hl & 0xFF, f: bit7F(h, left.f), bc, de: left.hl, hl: wExpToNextDisplayed + 1 };
}

// ---- texts in the tile buffer ----
// Unused_1a_LoadDialogueTextToBuffer (1A:505E): text hl fetched (WRAM 5's wTextBuffer) and copied to wTextTileBuffer
// (WRAM 1), its terminator included. Leaves WRAM 1 mapped; de: the caller's (FetchDialogueText's SRAM case)
export function unusedLoadDialogueTextToBuffer(P, text, de) {
  wram(P, WRAM_TEXT);
  far(P, FAR.FetchDialogueText[0], () => fetchDialogueText(P, text, de));
  let hl = wTextBuffer, dest = wTextTileBuffer, ch;
  do {
    wram(P, WRAM_TEXT);
    ch = u8(P, hl);
    wram(P, WRAM_STAGING);
    w8(P, dest, ch);
    hl = (hl + 1) & 0xFFFF;
    dest = (dest + 1) & 0xFFFF;
  } while (ch);
  return { a: 0, b: 0, f: FZ | FH, hl, de: dest };
}
// a fetched text drawn into the tile buffer at (b, c), attribute 1
function drawTextLine(P, r, [text, b, c]) {
  chain(r, unusedLoadDialogueTextToBuffer(P, text, r.d << 8 | r.e));
  drawStringToTileBuffer(P, wTextTileBuffer, b, c, TEXT_ATTR);
  return chain(r, { hl: wTextTileBuffer, b, c, e: TEXT_ATTR });
}
// Unused_1a_DrawExpScreenCaption (1A:4FAB): caption a (0-5; others none) into the tile buffer; caption 3 ("EXP")
// rendered into WRAM 3's screen rows with a sound; caption 5 (top level) stops the music first
export function unusedDrawExpScreenCaption(P, a, entry) {
  const r = { ...entry };
  if (a > 5) return chain(r, { a: (a - 5) & 0xFF, f: decFlags((a - 4) & 0xFF, 0) });
  if (a === CAPTION_EXP) {
    wram(P, WRAM_SCREEN);
    chain(r, rom(P, FAR.RenderProportionalTextAt, { ...r, f: farFlagsAt(P, 0), a: WRAM_SCREEN, hl: Text_31_242, de: CAPTION_AT, c: CAPTION_WIDTH }));
    sound(P, SFX_CAPTION);
    return r;
  }
  if (a === CAPTION_MAX_LEVEL) sound(P, BGM_NONE);
  CAPTIONS[a].forEach((line, i) => {
    chain(r, unusedLoadDialogueTextToBuffer(P, line[0], r.d << 8 | r.e));
    if (i === 0) { wram(P, WRAM_STAGING); r.a = WRAM_STAGING; }
    drawStringToTileBuffer(P, wTextTileBuffer, line[1], line[2], TEXT_ATTR);
    chain(r, { hl: wTextTileBuffer, b: line[1], c: line[2], e: TEXT_ATTR });
  });
  return r;
}
export const drawExpScreenCaption = (P, a) => unusedDrawExpScreenCaption(P, a, getRegs(P.cpu));
// Unused_1a_DrawExpBonusMessage (1A:50D3): the message box with bonus kind a's lines and Text_31_244 below, shown
// over the top rows
export function* unusedDrawExpBonusMessage(P, kind, entry) {
  const r = { ...entry };
  drawExpScreenMessageBox(P);
  let lines;
  if (BONUS_SIMPLE[kind]) lines = [[BONUS_SIMPLE[kind], 2, 1]];
  else {
    const k = kind >= BONUS_NAMED_FIRST && kind < BONUS_NAMED_FIRST + BONUS_NAMED_COUNT ? kind - BONUS_NAMED_FIRST : BONUS_NAMED_COUNT;
    lines = [[Text_31_248, 2, 1], [Text_30_31 + k, 6, 1], [Text_31_249, BONUS_TAIL_COLUMN[k], 1]];
  }
  for (const line of [...lines, [Text_31_244, 2, 3]]) {
    chain(r, unusedLoadDialogueTextToBuffer(P, line[0], r.d << 8 | r.e));
    wram(P, WRAM_STAGING);
    drawStringToTileBuffer(P, wTextTileBuffer, line[1], line[2], TEXT_ATTR);
    chain(r, { a: WRAM_STAGING, hl: wTextTileBuffer, b: line[1], c: line[2], e: TEXT_ATTR });
  }
  return chain(r, yield* showTopMessage(P, () => {}));
}
// Unused_1a_ResetCharDataScreenAnim (1A:5082): the EXP gain screen (layout 1) with the registers given; after a
// level-up, once more for the next level (h = 4: no counting, de = 0), with wCharDataAnimCounter set
export function* unusedResetCharDataScreenAnim(P, entry) {
  withWram(P, WRAM_SCENE, () => w8(P, wCharDataAnimCounter, 0));
  const old = P.V.wramBank;
  const r = yield* showExpGainScreen(P, { ...entry, a: 1 });
  wram(P, WRAM_SCENE);
  if (u8(P, wExpLevelUpQueued)) {
    w8(P, wCharDataAnimCounter, 1);
    yield* showExpGainScreen(P, { ...r, a: 1, f: FH, d: 0, e: 0, h: 4 });
  }
  wram(P, old);
}

export const HOOKS = [
  [BANK, 0x4DA8, nop],                                              // Unused_1a_StubNop3
  [BANK, 0x4DA9, hookGen(P => unusedDrawExpScreenMessage1(P))],
  [BANK, 0x4E07, hookGen(P => unusedDrawExpScreenMessage2(P))],
  [BANK, 0x4E65, hook((P, c) => expScreenNumberTask(P, getRegs(c)))],
  [BANK, 0x4F02, hook((P, c) => unusedQueueNumberSpritesShifted(P, c.a, c.hl, c.d, c.e, c.bc, c.f))],
  [BANK, 0x4F30, hook((P, c) => unusedAdvanceExpGaugeFill(P, c.de))],
  [BANK, 0x4F82, hook((P, c) => unusedQueueNumberSprites(P, c.a, c.hl, c.d, c.e, c.bc, c.f))],
  [BANK, 0x4FAB, hook((P, c) => unusedDrawExpScreenCaption(P, c.a, getRegs(c)))],
  [BANK, 0x505E, hook((P, c) => unusedLoadDialogueTextToBuffer(P, c.hl, c.de))],
  [BANK, 0x5082, hookGen((P, c) => unusedResetCharDataScreenAnim(P, getRegs(c)))],
  [BANK, 0x50D3, hookGen((P, c) => unusedDrawExpBonusMessage(P, c.a, getRegs(c)))],
];
