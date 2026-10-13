// The story characters' ids and EXP (bank 2, $4C58-$4E77, and the character groups at $5EB3-$5EFA): the extended
// character ids' name remap, the story file's two per-file save flags, the 24-bit EXP counter (capped at 99999),
// the level thresholds, and the AI shot-style rows.
// Port of records_02.asm and the end of debug_02.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm), whose routine names these are.
//
// EXP (record +$2C, 3 bytes little-endian). ExpLevelThresholds_02 (through CharDataPtr_02) holds, per level from
// 1, the total EXP the level starts at (3 bytes): level n's threshold is at (n - 1) * 3. The routines on words
// use the low 16 bits only. The save flags of a story file (A and B) are save-flag ids in two 4-entry tables, by
// wCurrentStorySlot; they live in SRAM (bank 3's TestSaveFlag / SetSaveFlag / ClearSaveFlag).
// Tests: web/tests/port/routines_story.mjs.
import { FZ, FN, FH, FC, BANK_STORY_02, hook, farcall, cpFlags, subFlags, bitFlags, addHLFlags } from "./common.js";
import { testSaveFlag, setSaveFlag, clearSaveFlag } from "../save/storyslots.js";
import { getPlayerRecordPtr, getCa00RecordPtr } from "./story02.js";

const BANK = BANK_STORY_02, BANK_SAVE = 0x03;
const NameTextRemap_02 = 0x4C6A, StorySlotFlagBIds_02 = 0x4CCC, StorySlotFlagAIds_02 = 0x4D08;
const Value100000_02 = 0x4D50, CharDataPtr_02 = 0x4E78, CharGroupTable_02 = 0x5E23;
const CHAR_EXTENDED_FIRST = 0x20;
const CHARREC_LEVEL = 0x18, CHARREC_EXP = 0x2C, LEVEL_MAX = 0x63, EXP_THRESHOLD_SIZE = 3;
const CHAR_GROUP_ROW = 0x10, CHAR_GROUP_FIND = 0x30;

// ld_hl_indexed table: hl = table + a, flags of its closing `sub l`
export function indexedHL(table, a) {
  const sum = a + (table & 0xFF), l = sum & 0xFF, x = ((table >> 8) + l + (sum > 0xFF ? 1 : 0)) & 0xFF;
  return { hl: (table + a) & 0xFFFF, f: subFlags(x, l) };
}

// RemapExtendedCharId (02:4C58): ids from $20 map to the base character whose name they show
// (NameTextRemap_02[(id - $20) & $7F]); lower ids are kept. hl kept.
export function remapExtendedCharId(P, a) {
  if (a < CHAR_EXTENDED_FIRST) return { a, f: cpFlags(a, CHAR_EXTENDED_FIRST) };
  const { hl, f } = indexedHL(NameTextRemap_02, (a - CHAR_EXTENDED_FIRST) & 0x7F);
  return { a: P.rom.u8(BANK, hl), f };
}

// the current story file's save-flag id from a 4-entry table, in de; hl left past it
function storySlotFlagId(P, table) {
  const { hl } = indexedHL(table, (P.V.currentStorySlot * 2) & 0xFF);
  return { de: P.rom.u16(BANK, hl), hl: (hl + 1) & 0xFFFF };
}
// SetStorySlotFlagB (02:4CB1) / SetStorySlotFlagA (02:4CED): set (a != 0) or clear the current story file's save
// flag B / A. Returns the registers it leaves (af as at the call, de the ROM's save-flag routine's).
export function setStorySlotFlag(P, table, a) {
  const { de, hl } = storySlotFlagId(P, table);
  farcall(P, BANK_SAVE, () => (a ? setSaveFlag : clearSaveFlag)(P, de));
  return { de: de >> 8, hl };
}
// TestStorySlotFlagB (02:4CD4) / TestStorySlotFlagA (02:4D10): a = 1 if the current story file's save flag B / A
// is set, else 0 (the flags of the test: Z when clear, H).
export function testStorySlotFlag(P, table) {
  const { de, hl } = storySlotFlagId(P, table);
  const set = farcall(P, BANK_SAVE, () => testSaveFlag(P, de));
  return { a: set ? 1 : 0, f: set ? FH : FZ | FH, de, hl };
}

// Unused_02_CheckExpAwardAllowed (02:4D29): the gate of Unused_02_AddExpToCa00RecordChecked; it always passes
// (NZ: `xor a / dec a`, then a put back).
export const unusedCheckExpAwardAllowed = () => ({ f: FN | FH });

// AddExpCapped (02:4D30): add de to the 24-bit EXP at hl, capped at 99999. Returns the registers it leaves.
export function addExpCapped(P, hl, de) {
  const { bus } = P;
  const sum = bus.u8(hl) + (de & 0xFF);
  bus.w8(hl, sum);
  const mid = bus.u8(hl + 1) + (de >> 8) + (sum > 0xFF ? 1 : 0);
  bus.w8(hl + 1, mid);
  bus.w8(hl + 2, bus.u8(hl + 2) + (mid > 0xFF ? 1 : 0));
  const r = compare24Bit(P, Value100000_02, hl);
  if (r.f & FZ) return r;
  for (let i = 0; i < 3; i++) bus.w8(hl + i, bus.u8(Value100000_02 + i));
  return { ...r, a: bus.u8(Value100000_02 + 2) };
}
// Compare24Bit (02:4D54): the 24-bit [de] - [hl]; Z when it is not negative (bit 7 of its top byte clear), C the
// borrow. Returns { a (the top byte), f, de, hl } (both past their second byte).
export function compare24Bit(P, de, hl) {
  const { bus } = P;
  let a = bus.u8(de) - bus.u8(hl), borrow = a < 0 ? 1 : 0;
  a = bus.u8(de + 1) - bus.u8(hl + 1) - borrow; borrow = a < 0 ? 1 : 0;
  a = bus.u8(de + 2) - bus.u8(hl + 2) - borrow; borrow = a < 0 ? 1 : 0;
  a &= 0xFF;
  return { a, f: bitFlags(!!(a & 0x80), borrow ? FC : 0), de: (de + 2) & 0xFFFF, hl: (hl + 2) & 0xFFFF };
}

// Unused_02_ClearCa00RecordExp (02:4D61): court slot a's record's EXP = 0. Returns the registers it leaves.
export function unusedClearCa00RecordExp(P, a) {
  const { bc } = getCa00RecordPtr(a);
  for (let i = 0; i < 3; i++) P.bus.w8(bc + CHARREC_EXP + i, 0);
  return { a: 0, f: FZ, bc, hl: bc + CHARREC_EXP + 3 };
}
// Unused_02_AddExpToCa00Record (02:4D74) (and its Checked / Hooked entries, 4D6D / 4D71, which reach it): de EXP
// added to court slot a's record. Returns the registers it leaves.
export function unusedAddExpToCa00Record(P, a, de) {
  const { bc } = getCa00RecordPtr(a);
  return { ...addExpCapped(P, bc + CHARREC_EXP, de), bc };
}
// AddPlayerExp (02:4D8F): de EXP added to the story file's record a (0 main, else the partner).
export function addPlayerExp(P, a, de) {
  const { bc } = getPlayerRecordPtr(a);
  return { ...addExpCapped(P, bc + CHARREC_EXP, de), bc };
}

// the 24-bit threshold of level n + 1 (index n), and its low word
const thresholdAt = (P, n) => (P.rom.u16(BANK, CharDataPtr_02) + n * EXP_THRESHOLD_SIZE) & 0xFFFF;
const word = (P, at) => P.rom.u16(BANK, at);
// 16-bit hl - de as `sub e / sbc d`: { a: h, f, hl }
function sub16(hl, de) {
  const lo = (hl & 0xFF) - (de & 0xFF), borrow = lo < 0 ? 1 : 0;
  const r = (hl - de) & 0xFFFF;
  return { a: r >> 8, f: subFlags(hl >> 8, de >> 8, borrow), hl: r };
}

// HasReachedNextLevelExp (02:4D99): Z when the story file's record a's EXP has reached the next level's threshold
// (Compare24Bit's result); NZ (a = $80) at level 99.
export function hasReachedNextLevelExp(P, a) {
  const { bc } = getPlayerRecordPtr(a), level = P.bus.u8(bc + CHARREC_LEVEL);
  if (level >= LEVEL_MAX) return { a: 0x80, f: 0, bc, hl: bc + CHARREC_LEVEL };
  const exp = (bc & 0xFF00) | ((CHARREC_EXP + (bc & 0xFF)) & 0xFF);
  const { de: _d, hl: _h, ...r } = compare24Bit(P, exp, thresholdAt(P, level));
  return { ...r, bc, de: (exp + 2) & 0xFFFF, hl: (thresholdAt(P, level) + 2) & 0xFFFF };
}
// GetExpRemainingToNextLevel (02:4DC8): hl = the next level's threshold - the EXP of record a (low words);
// 0 at level 99.
export function getExpRemainingToNextLevel(P, a) {
  const { bc } = getPlayerRecordPtr(a), level = P.bus.u8(bc + CHARREC_LEVEL);
  if (level >= LEVEL_MAX) return { a: level, f: cpFlags(level, LEVEL_MAX), bc, hl: 0 };
  const de = P.bus.u16(bc + CHARREC_EXP);
  return { ...sub16(word(P, thresholdAt(P, level)), de), bc, de };
}
// GetExpProgressInCurrentLevel (02:4E02): hl = record a's EXP - its level's threshold (low words); 0 at level 99.
export function getExpProgressInCurrentLevel(P, a) {
  const { bc } = getPlayerRecordPtr(a), level = P.bus.u8(bc + CHARREC_LEVEL);
  if (level >= LEVEL_MAX) return { a: level, f: cpFlags(level, LEVEL_MAX), bc, hl: 0 };
  const de = word(P, thresholdAt(P, (level - 1) & 0xFF));
  return { ...sub16(P.bus.u16(bc + CHARREC_EXP), de), bc, de };
}
// GetExpRequiredForLevel (02:4E3A): hl = level a + 1's threshold - level a's (the EXP the level takes; low words).
export function getExpRequiredForLevel(P, a) {
  const de = word(P, thresholdAt(P, (a - 1) & 0xFF));
  return { ...sub16(word(P, thresholdAt(P, a)), de), de };
}

// GetCharGroupEntry (02:5EB3): a = CharGroupTable_02[a][b & $0F] (the AI shot of serve style a's slot b).
export function getCharGroupEntry(P, a, b) {
  const row = indexedHL(CharGroupTable_02, (a * CHAR_GROUP_ROW) & 0xFF).hl;
  const l = (b & 0x0F) + (row & 0xFF);
  let hl = (row & 0xFF00) | (l & 0xFF), f = (l & 0xFF ? 0 : FZ) | ((((b & 0x0F) + (row & 0x0F)) > 0x0F) ? FH : 0);
  if (l > 0xFF) { f = ((hl >> 8) + 1 & 0xFF ? 0 : FZ) | (((hl >> 8) & 0x0F) === 0x0F ? FH : 0) | FC; hl = (hl + 0x100) & 0xFFFF; }
  return { a: P.rom.u8(BANK, hl), f, hl };
}
// Unused_02_CharGroupFind (02:5EC8): a = 1 if row a holds $30, else 0. Nothing calls it.
export function unusedCharGroupFind(P, a) {
  return rowContains(P, a, CHAR_GROUP_FIND, "b");
}
// DoesCharGroupRowContain (02:5EE2): a = 1 if row a holds b, else 0 (c the count left).
export function doesCharGroupRowContain(P, a, b) {
  return rowContains(P, a, b, "c");
}
function rowContains(P, a, value, counter) {
  let hl = indexedHL(CharGroupTable_02, (a * CHAR_GROUP_ROW) & 0xFF).hl;
  for (let n = CHAR_GROUP_ROW; n > 0; n--) {
    const v = P.rom.u8(BANK, hl); hl = (hl + 1) & 0xFFFF;
    if (v === value) return { a: 1, f: cpFlags(v, value), [counter]: n, hl };
  }
  return { a: 0, f: FZ, [counter]: 0, hl };
}

export const HOOKS = [
  [BANK, 0x4C58, hook((P, c) => remapExtendedCharId(P, c.a))],
  [BANK, 0x4CB1, hook((P, c) => setStorySlotFlag(P, StorySlotFlagBIds_02, c.a))],
  [BANK, 0x4CD4, hook(P => testStorySlotFlag(P, StorySlotFlagBIds_02))],
  [BANK, 0x4CED, hook((P, c) => setStorySlotFlag(P, StorySlotFlagAIds_02, c.a))],
  [BANK, 0x4D10, hook(P => testStorySlotFlag(P, StorySlotFlagAIds_02))],
  [BANK, 0x4D29, hook(() => unusedCheckExpAwardAllowed())],
  [BANK, 0x4D30, hook((P, c) => addExpCapped(P, c.hl, c.de))],
  [BANK, 0x4D54, hook((P, c) => compare24Bit(P, c.de, c.hl))],
  [BANK, 0x4D61, hook((P, c) => unusedClearCa00RecordExp(P, c.a))],
  [BANK, 0x4D6D, hook((P, c) => unusedAddExpToCa00Record(P, c.a, c.de))],
  [BANK, 0x4D71, hook((P, c) => unusedAddExpToCa00Record(P, c.a, c.de))],
  [BANK, 0x4D74, hook((P, c) => unusedAddExpToCa00Record(P, c.a, c.de))],
  [BANK, 0x4D7E, hook(() => {})],                                  // Unused_02_StubNop
  [BANK, 0x4D8F, hook((P, c) => addPlayerExp(P, c.a, c.de))],
  [BANK, 0x4D99, hook((P, c) => hasReachedNextLevelExp(P, c.a))],
  [BANK, 0x4DC8, hook((P, c) => getExpRemainingToNextLevel(P, c.a))],
  [BANK, 0x4E02, hook((P, c) => getExpProgressInCurrentLevel(P, c.a))],
  [BANK, 0x4E3A, hook((P, c) => getExpRequiredForLevel(P, c.a))],
  [BANK, 0x5EB3, hook((P, c) => getCharGroupEntry(P, c.a, c.b))],
  [BANK, 0x5EC8, hook((P, c) => unusedCharGroupFind(P, c.a))],
  [BANK, 0x5EE2, hook((P, c) => doesCharGroupRowContain(P, c.a, c.b))],
];
