// The confirmation and score-panel screens of bank $18 (prompts_18.asm): a player record set up for a character,
// the confirm screen with its box and score panel, numbers and strings drawn as sprites, the two-choice prompts and
// the option labels. Nothing in the game calls any of it (every routine is Unused_18_*); it is ported for
// completeness and checked routine by routine.
// Port of src/engine/menus/common/prompts_18.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm). Graphics, labels and tables are read from the ROM.
// Tests: web/tests/port/routines_menus_common.mjs (all but the two prompts, which wait; they are not reached by
// any recording).
import { decompressData } from "../../home/decompress.js";
import { queueSprite, queueSprite16, clearSpriteQueue } from "../../home/fade.js";
import { registerFrameTask } from "../../home/colorfade.js";
import {
  FZ, FN, FH, FC, addFlags, incFlags, subFlags, hook, hookGen, callHome, callFar, sound, advanceFrame, queueCopy,
  loadPalettes, HOME, FAR, TILE_SIZE, VRAM_BANK1, vTiles0, vTiles1, vTiles2, wDecompBuffer, wTextTileBuffer,
  wTextTileBuffer_SIZE, PADF_A, PADF_B, PADF_LEFT, PADF_RIGHT, PADF_SELECT, SFX_MENU_MOVE, SFX_MENU_SELECT, SFX_MENU_CANCEL,
} from "./defs.js";
import { BANK_CURSORBOX, unusedDrawBox, loadMenuHandCursorGfx, unusedFlushBgMapShadowToVram, unusedAddBobbingOffsetXY } from "./cursorbox.js";
import { streamBlocks } from "./menu_lib.js";

const ConfirmScreenGfx0 = 0x467A, ConfirmScreenPalette0 = 0x4F33, ConfirmScreenGfx1 = 0x4F73, ConfirmScreenGfx2 = 0x50CE;
const ThreeOptionLabelsData0 = 0x5158, YesNoLabels0 = 0x51B8;
const ConfirmScreenGfx3 = 0x51F8, ConfirmScreenPalette1 = 0x52C6;
const TextSlotPointerTable = 0x53F8, UnusedBobRamp_18 = 0x5507, TwoOptionSelectBTable = 0x5892;
const Unused_18_DrawScoreNumbersTask = 0x53B3;
const LABEL_SIZE = 16;

// Unused_18_InitPlayerRecordForCharacter (18:463B): character b's record (from its template, or with SELECT held
// in debug step mode from the roster) for player slot a; then the record's two name bytes at $C7C0 + 2a copied into
// the story character's name block (main character, or the partner's at $C940 when wStoryCharacterSlot is set),
// at +$0E and +$0C.
const RECORD_NAME_BYTES = 0xC7C0, PARTNER_NAME_LOW = 0x40;
export function unusedInitPlayerRecordForCharacter(P, slot, ch) {
  const { V, bus } = P;
  if (V.playerInputFlags & PADF_SELECT && V.debugStepMode) callFar(P, FAR.Unused_02_LoadMainCharacterFromRoster, { a: ch, d: slot });
  else callFar(P, FAR.InitPlayerRecordFromTemplate, { a: ch, d: slot });
  const l = ((slot * 2) & 0xFF) + (RECORD_NAME_BYTES & 0xFF), carry = l > 0xFF ? 1 : 0;
  const src = ((RECORD_NAME_BYTES >> 8) + carry) << 8 | (l & 0xFF);
  const sum = ((l & 0xFF) + (RECORD_NAME_BYTES >> 8) + carry) & 0xFF;      // adc $c7 / sub l
  let name = P.A.storyModeNameOfMainCharacter;
  if (V.storyCharacterSlot) name = (name & 0xFF00) | PARTNER_NAME_LOW;
  const first = bus.u8(src), second = bus.u8(src + 1);
  bus.w8(name + 0x0E, first);
  bus.w8(name + 0x0C, second);
  // (the flags: Z of `sub l`, then H and C of the last `add hl, bc`)
  const zero = ((sum - (l & 0xFF)) & 0xFF) === 0, h = ((name & 0xFFF) + 0x0C) > 0xFFF, cy = name + 0x0C > 0xFFFF;
  return { a: second, f: (zero ? FZ : 0) | (h ? FH : 0) | (cy ? FC : 0), bc: name, de: (src + 1) & 0xFFFF, hl: (name + 0x0C) & 0xFFFF };
}

// Unused_18_InitConfirmScreen (18:52DE): the confirm screen: frame tasks and sprites cleared, the tile VRAM cleared
// (Unused_18_ClearTileVramBothBanks), the score panel's value; its background tiles (two halves) to VRAM bank 1 and
// palettes; its tilemap pieces decompressed into wTextTileBuffer, the box drawn; the cursor and sprite tiles and
// palettes; the score panel and its frame task.
export function unusedInitConfirmScreen(P) {
  const { V } = P;
  callHome(P, HOME.ClearFrameTasks);
  clearSpriteQueue(P);
  callFar(P, FAR.Unused_18_ClearTileVramBothBanks);
  unusedLoadScorePanelValue(P);
  V.scorePanelBobActive = 0;
  V.scorePanelBobStep = 0;
  decompressData(P, ConfirmScreenGfx0, wDecompBuffer);
  queueCopy(P, wDecompBuffer, vTiles2 + VRAM_BANK1, 128);
  queueCopy(P, wTextTileBuffer, vTiles1 + VRAM_BANK1, wTextTileBuffer_SIZE / 16);
  loadPalettes(P, ConfirmScreenPalette0, 0, 8);
  decompressData(P, ConfirmScreenGfx2, wTextTileBuffer + 64 * TILE_SIZE);
  decompressData(P, ConfirmScreenGfx1, wTextTileBuffer);
  unusedDrawConfirmScreenBox(P);
  decompressData(P, ConfirmScreenGfx3, wDecompBuffer);
  queueCopy(P, wDecompBuffer, vTiles0 + 0x30 * TILE_SIZE, streamBlocks(P, BANK_CURSORBOX, ConfirmScreenGfx3));
  loadPalettes(P, ConfirmScreenPalette1, 8 + 1, 3);
  loadMenuHandCursorGfx(P, vTiles0 + 0x50 * TILE_SIZE, 0x0E, 0x01);
  callFar(P, FAR.Unused_18_LoadConfirmScreenSpriteGfx);
  const r = unusedSetupScoreboardDisplay(P);
  return { ...r, b: V.minigameHighScoreMode, hl: P.A.minigameHighScoreMode };
}
// Unused_18_DrawConfirmScreenBox (18:5365): a 14 x 5 box in the confirm screen's tilemap pieces
const BOX_TILES = wTextTileBuffer + 26 * TILE_SIZE, BOX_ATTRS = wTextTileBuffer + 90 * TILE_SIZE;
export function unusedDrawConfirmScreenBox(P) {
  unusedDrawBox(P, BOX_TILES, BOX_ATTRS, 0x0E, 0x05);
  return { hl: BOX_TILES, de: BOX_ATTRS, bc: 0x0E05 };
}
// Unused_18_LoadScorePanelValue (18:5372): the panel shows the story character's EXP tier
export function unusedLoadScorePanelValue(P) { const a = P.V.storyMainCharExpTier; P.V.scorePanelExpTier = a; return { a }; }
// Unused_18_SetupScoreboardDisplay (18:537A): four 6 x 2 digit blocks (wScorePanelValues 0-2, wTargetZoneX1) into
// rows 4, 8, 12, 16 of the confirm screen's tilemap piece; then the score-number frame task (priority $0A).
export function unusedSetupScoreboardDisplay(P) {
  const values = [P.A.scorePanelValues, P.A.scorePanelValues + 1, P.A.scorePanelValues + 2, P.A.targetZoneX1];
  values.forEach((at, i) => unusedDrawTileBlock6x2ToTilemap(P, unusedGetTextSlotPointer(P, P.bus.u8(at)).hl, wTextTileBuffer + (4 + 4 * i) * TILE_SIZE + 11));
  return registerFrameTask(P, 0x0A, Unused_18_DrawScoreNumbersTask, P.cpu.sp - 2);
}
// Unused_18_DrawScoreNumbersTask (18:53B3): the EXP tier (3 wide, at $44,$04) and the score (wScorePanelScore,
// at $44,$54), the score bobbing while wScorePanelBobStep is 3.
export function unusedDrawScoreNumbersTask(P, cpu) {
  const { V } = P;
  let r = unusedDrawDecimalNumberSprites(P, cpu, V.scorePanelExpTier, 0x4404, 0x03, 0x02);
  if (V.scorePanelBobStep === 3) V.scorePanelBobActive = 1;
  r = unusedDrawDecimalNumberSprites(P, cpu, P.bus.u16(P.A.scorePanelScore), 0x4454, 0x01, 0x03);
  V.scorePanelBobActive = 0;
  return { de: r.de, a: 0, b: 0x01, hl: P.bus.u16(P.A.scorePanelScore), f: FZ };
}
// Unused_18_GetTextSlotPointer (18:53E4): hl = wTextTileBuffer + TextSlotPointerTable[(a + 4) & 15], de =
// wTextTileBuffer. Leaves a = the entry's low byte.
export function unusedGetTextSlotPointer(P, v) {
  const off = (((v + 4) & 0x0F) * 2) & 0xFF, l = (TextSlotPointerTable & 0xFF) + off;
  const at = ((TextSlotPointerTable >> 8) + (l >> 8)) << 8 | (l & 0xFF);
  const word = P.bus.u16(at), hl = (word + wTextTileBuffer) & 0xFFFF;
  const zero = (((TextSlotPointerTable >> 8) + (l >> 8)) & 0xFF) === 0;       // (Z of ld_hl_indexed's `sub l`)
  return { a: word & 0xFF, de: wTextTileBuffer, hl, f: (zero ? FZ : 0) | (((word & 0xFFF) + (wTextTileBuffer & 0xFFF)) > 0xFFF ? FH : 0) | (word + wTextTileBuffer > 0xFFFF ? FC : 0) };
}
// Unused_18_ForceFlushBgMapToVram (18:5418): both planes marked dirty and flushed
export function unusedForceFlushBgMapToVram(P) { P.V.bgMapShadowDirty = 0xFF; return unusedFlushBgMapShadowToVram(P); }

// Unused_18_RunTwoOptionSelect (18:5421) / ...B (18:5469): a choice of two (b = 0 left, 1 right) by left / right,
// a bobbing hand cursor (a 16 x 16 sprite pair, tile $50, attribute 6) at one of two places; A returns the choice,
// B returns $FF. SFX_MENU_SELECT for the left choice, SFX_MENU_CANCEL otherwise. Returns a = b and the flags of `and a`.
const TWO_OPTION_PLACES = [[0x128E, 0x3A8E], [0x2892, TwoOptionSelectBTable]];
export function* unusedRunTwoOptionSelect(P, cpu, variant) {
  const { V } = P, places = TWO_OPTION_PLACES[variant];
  let b = cpu.b, hl = cpu.hl, c = cpu.c;
  for (;;) {
    if (V.inputRisingEdge & PADF_LEFT) { b = 0; sound(P, SFX_MENU_MOVE); }
    if (V.inputRisingEdge & PADF_RIGHT) { b = 1; sound(P, SFX_MENU_MOVE); }
    if (V.inputRisingEdge & PADF_A) break;
    if (V.inputRisingEdge & PADF_B) { b = 0xFF; break; }
    const at = b ? places[1] : places[0];
    const { d, e } = unusedAddBobbingOffsetXY(P, at >> 8, at & 0xFF);
    const q = queueSprite16(P, 0x06, 0x50, d, e);
    if ("hl" in q) hl = q.hl; else hl = b << 8 | (b ? 0 : FZ) | FH;   // (the bobbing routine's swapped af, when the queue is full)
    yield* advanceFrame(P);
    cpu.de = d << 8 | e;
  }
  sound(P, b ? SFX_MENU_CANCEL : SFX_MENU_SELECT);
  return { a: b, b, c, hl, f: b ? FH : FZ | FH };
}

// Unused_18_DrawDecimalNumberSprites (18:54B1): the number hl in decimal (FormatDecimalNumber, width a, into a
// buffer on the stack) as glyph sprites from (d, e), attribute b. af, bc, hl kept; de after the last glyph.
export function unusedDrawDecimalNumberSprites(P, cpu, value, de, attr, width) {
  const sp = cpu.sp, buffer = (sp - 16) & 0xFFFF, c = cpu.c;   // push af / bc / hl, add sp, -10
  cpu.sp = (sp - 20) & 0xFFFF;                                 // push bc / de
  try {
    const text = callHome(P, HOME.FormatDecimalNumber, { a: width, hl: value, de: buffer, bc: buffer }).bc;
    const r = unusedDrawStringSprites(P, text, de >> 8, de & 0xFF, attr, c);
    return { de: r.d << 8 | r.e };
  } finally { cpu.sp = sp; }
}
// Unused_18_DrawStringSprites (18:54D2): each character of the 0-ended string at hl as a glyph sprite
export function unusedDrawStringSprites(P, hl, d, e, attr, c) {
  let r = { d, e, c };
  for (;;) {
    const ch = P.bus.u8(hl); hl = (hl + 1) & 0xFFFF;
    if (!ch) return { ...r, a: 0, hl, f: FZ | FH };
    r = { ...r, ...unusedDrawGlyphSprite(P, ch, r.d, r.e, attr, r.c) };
  }
}
// Unused_18_DrawGlyphSprite (18:54DC): a digit (or any code from '0') as sprite tile $30 + 2 * (code - '0') at
// (d, e), bobbing on UnusedBobRamp_18 while wScorePanelBobActive; codes below '0' only advance. d + 8.
export function unusedDrawGlyphSprite(P, ch, d, e, attr, c) {
  const v = (ch - 0x30) & 0xFF, out = {};
  if (ch >= 0x30) {
    out.c = ((v * 2) + 0x30) & 0xFF;
    let y = e;
    if (P.V.scorePanelBobActive) y = (y + P.bus.u8(UnusedBobRamp_18 + (((d - P.V.vBlankCounter) & 0x1F)))) & 0xFF;
    queueSprite(P, attr, out.c, d, y);
  } else out.c = c;
  const nd = (d + 8) & 0xFF;
  return { ...out, a: nd, d: nd, e, f: addFlags(d, 8) };
}
// Unused_18_DrawThreeOptionLabels (18:5527) / Unused_18_DrawYesNoLabels (18:5561): the box, and the labels' rows
// (16 bytes each, Unused_18_CopyBytes11) into the tilemap pieces at their places
const THREE_OPTION_ROWS = [[3, 0xDDC1], [4, 0xDDE1], [5, 0xDE01], [0, 0xD9C1], [1, 0xD9E1], [2, 0xDA01]];
const YES_NO_ROWS = [[2, 0xDDE1], [3, 0xDE01], [0, 0xD9E1], [1, 0xDA01]];
// (each copy gets the registers the one before left, as on the ROM; the first one bc as the caller had it)
const copyLabels = (P, base, rows, first = {}) => {
  let r = {};
  rows.forEach(([i, de], k) => { r = callFar(P, FAR.Unused_18_CopyBytes11, { ...(k ? {} : first), hl: base + i * LABEL_SIZE, de }); });
  return r;
};
export function unusedDrawThreeOptionLabels(P) { const box = unusedDrawConfirmScreenBox(P); return copyLabels(P, ThreeOptionLabelsData0, THREE_OPTION_ROWS, { bc: box.bc }); }
export function unusedDrawYesNoLabels(P) { return copyLabels(P, YesNoLabels0, YES_NO_ROWS); }
// Unused_18_DrawTileBlock6x2ToTilemap (18:5586): a 6 x 2 block from hl to de, rows $20 apart in both
export function unusedDrawTileBlock6x2ToTilemap(P, hl, de) {
  const copy6 = () => { for (let i = 0; i < 6; i++) { P.bus.w8(de, P.bus.u8(hl)); hl = (hl + 1) & 0xFFFF; de = (de + 1) & 0xFFFF; } };
  copy6();
  hl = (hl & 0xFF00) + (((hl & 0xFF) + 0x1A) & 0x1FF);
  const e = de & 0xFF, carry = e + 0x1A > 0xFF;
  de = (de & 0xFF00) + ((e + 0x1A) & 0x1FF);
  const f = carry ? incFlags((de >> 8) - 1 & 0xFF, FC) : addFlags(0x1A, e);
  copy6();
  return { a: P.bus.u8(hl - 1), hl, de, f };
}

export const HOOKS = [
  [BANK_CURSORBOX, 0x463B, hook((P, c) => unusedInitPlayerRecordForCharacter(P, c.a, c.b))],
  [BANK_CURSORBOX, 0x52DE, hook(P => unusedInitConfirmScreen(P))],
  [BANK_CURSORBOX, 0x5365, hook(P => unusedDrawConfirmScreenBox(P))],
  [BANK_CURSORBOX, 0x5372, hook(P => unusedLoadScorePanelValue(P))],
  [BANK_CURSORBOX, 0x5379, () => {}],                        // Unused_18_StubNop_18_1
  [BANK_CURSORBOX, 0x537A, hook(P => unusedSetupScoreboardDisplay(P))],
  [BANK_CURSORBOX, 0x53B3, hook((P, c) => unusedDrawScoreNumbersTask(P, c))],
  [BANK_CURSORBOX, 0x53E4, hook((P, c) => unusedGetTextSlotPointer(P, c.a))],
  [BANK_CURSORBOX, 0x5418, hook(P => unusedForceFlushBgMapToVram(P))],
  [BANK_CURSORBOX, 0x5421, hookGen((P, c) => unusedRunTwoOptionSelect(P, c, 0))],
  [BANK_CURSORBOX, 0x5469, hookGen((P, c) => unusedRunTwoOptionSelect(P, c, 1))],
  [BANK_CURSORBOX, 0x54B1, hook((P, c) => unusedDrawDecimalNumberSprites(P, c, c.hl, c.de, c.b, c.a))],
  [BANK_CURSORBOX, 0x54D2, hook((P, c) => unusedDrawStringSprites(P, c.hl, c.d, c.e, c.b, c.c))],
  [BANK_CURSORBOX, 0x54DC, hook((P, c) => unusedDrawGlyphSprite(P, c.a, c.d, c.e, c.b, c.c))],
  [BANK_CURSORBOX, 0x5527, hook(P => unusedDrawThreeOptionLabels(P))],
  [BANK_CURSORBOX, 0x5561, hook(P => unusedDrawYesNoLabels(P))],
  [BANK_CURSORBOX, 0x5586, hook((P, c) => unusedDrawTileBlock6x2ToTilemap(P, c.hl, c.de))],
];
