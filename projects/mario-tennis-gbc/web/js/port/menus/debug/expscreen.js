// Bank $1a: the tile buffer of the unused EXP gain screen (WRAM 1: tiles at $d000 + row * 32 + column, their
// attributes $400 above), with what draws into it: the character's name and level box, strings with their
// diacritics a row up, and a stat modifier as a signed number ("+12", "-5", " 0"; a byte of $91 or more is
// negative), with the small arithmetic routines that take one apart.
// Port of src/engine/menus/debug/expscreen_1a.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own. Nothing in the game reaches this code.
// Tests: web/tests/port/routines_menus_misc.mjs (every routine but the stubs, against the ROM); lockstep on
// out/port/dbg_expgain.mtrec (scripted: the screen called from a stub).
import {
  FZ, FN, FAR, rom, romWait, u8, w8, wram, withWram, hook, hookGen, nop, WRAM_STAGING, wDecompBuffer, TILEMAP_WIDTH,
  storyRecord, STORY_RECORD_LEVEL, sub16, bit7F, cpFlags,
} from "./defs.js";

export const BANK = 0x1A;
const ATTR_PLANE = 0x400;                                  // the second plane, $400 above the cell
const NAME_AT = wDecompBuffer + 76 * 16 + 7, LEVEL_AT = wDecompBuffer + 80 * 16 + 7;
const Text_31_237 = 0x04ED, LEVEL_TEXT_WIDTH = 0x20;
const DAKUTEN = 0xDE, HANDAKUTEN = 0xDF, SMALL_DAKUTEN = 0x9E, SMALL_HANDAKUTEN = 0x9F;
const ROW_UP = 0x21;                                       // one row up and one column back
const NAME_BOX = { left: 7, right: 13, top: 5, bottom: 9 }, NAME_BOX_CELL = 0x2000;
const PLUS = 0x2B, MINUS = 0x2D, BLANK_SIGN = 0x60, DIGIT_0 = 0x30, DIGIT_1 = 0x31, NUMBER_ATTR = 0x01;
const FIRST_NEGATIVE = 0x91;

// Unused_1a_GetTileBufferCellAddr (1A:4C22): hl = cell (b, c) of the tile buffer
export function getTileBufferCellAddr(b, c) {
  return { hl: (wDecompBuffer + ((c * TILEMAP_WIDTH) & 0xFFFF) + b) & 0xFFFF };
}
// Unused_1a_WriteTileBufferCell (1A:4C38): cell (b, c) = e, its attribute = d (WRAM 1 mapped meanwhile)
export function writeTileBufferCell(P, b, c, d, e) {
  withWram(P, WRAM_STAGING, () => {
    const { hl } = getTileBufferCellAddr(b, c);
    w8(P, hl, e);
    w8(P, hl + ATTR_PLANE, d);
  });
}
// Unused_1a_ClearExpScreenNameBox (1A:4B96): the name box (columns 7-12, rows 5-8) blank
export function clearExpScreenNameBox(P) {
  for (let c = NAME_BOX.top; c < NAME_BOX.bottom; c++)
    for (let b = NAME_BOX.left; b < NAME_BOX.right; b++) writeTileBufferCell(P, b, c, NAME_BOX_CELL >> 8, NAME_BOX_CELL & 0xFF);
}
// Unused_1a_DrawExpScreenNameAndLevel (1A:4B1F): the story character's name and level ("Lv" text with the level
// as its argument) into the tile buffer. Leaves WRAM 1 mapped.
export function* drawExpScreenNameAndLevel(P) {
  clearExpScreenNameBox(P);
  wram(P, WRAM_STAGING);
  copyNameToTileBuffer(P, storyRecord(P), NAME_AT, 0);
  rom(P, FAR.PushTextArgNumber, { hl: u8(P, storyRecord(P) + STORY_RECORD_LEVEL) });
  yield* romWait(P, FAR.RenderProportionalTextAt, { hl: Text_31_237, de: LEVEL_AT, c: LEVEL_TEXT_WIDTH });
}
// Unused_1a_CopyNameToTileBuffer (1A:4B73): the string at hl to de, a diacritic going a row up over the last
// character. Returns hl past the end, de after the last character, b (0 after a diacritic)
export function copyNameToTileBuffer(P, hl, de, b) {
  for (;;) {
    const ch = u8(P, hl);
    hl = (hl + 1) & 0xFFFF;
    if (!ch) return { a: 0, f: FZ, hl, de, b };
    if (ch === DAKUTEN || ch === HANDAKUTEN) {
      ({ de, b } = moveTileBufferDestUpRow(de, 0));
      w8(P, de, ch);
      de = (de + ROW_UP) & 0xFFFF;
    } else {
      w8(P, de, ch);
      de = (de + 1) & 0xFFFF;
    }
  }
}
// Unused_1a_MoveTileBufferDestUpRow (1A:4B8F): de back $21 bytes (a row up, a column back)
export function moveTileBufferDestUpRow(de, f) {
  return { de: (de - ROW_UP) & 0xFFFF, b: 0, f: FZ | FN | (f & 0x10) };
}
// Unused_1a_DrawPositionedStringToTileBuffer (1A:4BBB): the string after a header (column, row, attribute) at hl
export function drawPositionedStringToTileBuffer(P, hl) {
  drawStringToTileBuffer(P, (hl + 3) & 0xFFFF, u8(P, hl), u8(P, hl + 1), u8(P, hl + 2));
}
// Unused_1a_DrawStringToTileBuffer (1A:4BD0): the string at hl from cell (b, c) on, attribute e; a diacritic goes on
// the cell above the last character (on the top row: tile $0b with attribute 3 or 4 at the previous column)
export function drawStringToTileBuffer(P, hl, b, c, e) {
  for (;; hl = (hl + 1) & 0xFFFF) {
    const ch = u8(P, hl);
    if (!ch) return;
    if (ch !== SMALL_DAKUTEN && ch !== SMALL_HANDAKUTEN && ch !== DAKUTEN && ch !== HANDAKUTEN) {
      writeTileBufferCell(P, b, c, ch, e);
      b = (b + 1) & 0xFF;
      continue;
    }
    const x = (b - 1) & 0xFF, y = (c - 1) & 0xFF;
    if (y) writeTileBufferCell(P, x, y, ch, e);
    else writeTileBufferCell(P, x, y, ch === SMALL_DAKUTEN || ch === DAKUTEN ? 0x03 : 0x04, 0x0B);
  }
}
// Unused_1a_WriteStatModifierToTileBuffer (1A:4C5C): stat modifier a as a sign, hundreds ("1"), tens and ones at
// cell (b, c) on (attribute 1); tens shown for 10-99 and 100-109 (as "0")
export function writeStatModifierToTileBuffer(P, a, b, c) {
  const value = signExtendModifierByte(a).hl;
  const sign = !value ? BLANK_SIGN : value & 0x8000 ? MINUS : PLUS;
  const put = ch => { writeTileBufferCell(P, b, c, ch, NUMBER_ATTR); b = (b + 1) & 0xFF; };
  put(sign);
  if (a) {
    const magnitude = value & 0x8000 ? (0x10000 - value) & 0xFFFF : value;
    if ((Math.floor(magnitude / 100) & 0xFF) !== 0) put(DIGIT_1);
  }
  const tens = getModifierTensDigit(a).a;
  if (tens) put(DIGIT_0 + tens);
  else if (!((a - 0x64) & 0x80)) put(DIGIT_0);
  writeTileBufferCell(P, b, c, DIGIT_0 + getModifierOnesDigit(a).a, NUMBER_ATTR);
}
// Unused_1a_CompareBCToDE (1A:4CEA): a = 0 when bc = de, 1 when bc > de, 2 when bc - de is negative (signed)
export function compareBCToDE(bc, de) {
  const r = sub16(bc, de), h = r.hl >> 8, l = r.hl & 0xFF;
  if (h & 0x80) return { a: 2, f: bit7F(h, r.f) };
  if (h) return { a: 1, f: cpFlags(h, 0) };
  return { a: l ? 1 : 0, f: cpFlags(l, 0) };
}
// the magnitude of modifier a, less 100 when it is 100 or more (the bc of the digit routines), and the flags of
// that test
function modifierBelowHundred(a) {
  let m = signExtendModifierByte(a).hl;
  if (m & 0x8000) m = (0x10000 - m) & 0xFFFF;
  const r = sub16(m, 100);
  return { bc: r.hl & 0x8000 ? m : r.hl, f: bit7F(r.hl >> 8, r.f) };
}
// Unused_1a_GetModifierTensDigit (1A:4D11): a = the tens digit of modifier a's magnitude (mod 100)
export function getModifierTensDigit(a) {
  const { bc, f } = modifierBelowHundred(a);
  return { a: Math.floor(bc / 10) & 0xFF, f };
}
// Unused_1a_GetModifierOnesDigit (1A:4D44): a = the ones digit of modifier a's magnitude
export function getModifierOnesDigit(a) {
  const { bc } = modifierBelowHundred(a);
  const r = sub16(bc, (Math.floor(bc / 10) * 10) & 0xFFFF);
  return { a: r.hl & 0xFF, f: r.f };
}
// Unused_1a_SignExtendModifierByte (1A:4D86): hl = a, negative ($ffxx) for $91 or more
export function signExtendModifierByte(a) {
  return { hl: a < FIRST_NEGATIVE ? a : 0xFF00 | a };
}

export const HOOKS = [
  [BANK, 0x4B1F, hookGen(function* (P) { yield* drawExpScreenNameAndLevel(P); })],
  [BANK, 0x4B73, hook((P, c) => copyNameToTileBuffer(P, c.hl, c.de, c.b))],
  [BANK, 0x4B8F, hook((P, c) => moveTileBufferDestUpRow(c.de, c.f))],
  [BANK, 0x4B96, hook(P => { clearExpScreenNameBox(P); })],
  [BANK, 0x4BB9, nop],                                              // Unused_1a_StubNop_1a_1
  [BANK, 0x4BBA, nop],                                              // Unused_1a_StubNop_1a_2
  [BANK, 0x4BBB, hook((P, c) => { drawPositionedStringToTileBuffer(P, c.hl); })],
  [BANK, 0x4BD0, hook((P, c) => { drawStringToTileBuffer(P, c.hl, c.b, c.c, c.e); })],
  [BANK, 0x4C22, hook((P, c) => getTileBufferCellAddr(c.b, c.c))],
  [BANK, 0x4C38, hook((P, c) => { writeTileBufferCell(P, c.b, c.c, c.d, c.e); })],
  [BANK, 0x4C5C, hook((P, c) => { writeStatModifierToTileBuffer(P, c.a, c.b, c.c); })],
  [BANK, 0x4CEA, hook((P, c) => compareBCToDE(c.bc, c.de))],
  [BANK, 0x4D11, hook((P, c) => getModifierTensDigit(c.a))],
  [BANK, 0x4D44, hook((P, c) => getModifierOnesDigit(c.a))],
  [BANK, 0x4D86, hook((P, c) => signExtendModifierByte(c.a))],
];
