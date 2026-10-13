// The story characters' level-ups and equipment (bank 2, $478F-$4C17): the main record's stats recomputed and
// copied to the save image's (match) copy with the training weights taken off, a level-up (one training level
// and the level), the stat changes a level-up would bring (the record tried and put back), and an unused
// debug routine that levels the partner from a table.
// Port of equip_02.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm),
// whose routine names these are. (Its tables, EquipStatDeltaPtrs_02 and the stat archetypes, are read by
// stat.js.)
//
// Equipment (record +$3C): the racket in the low nibble (3: the Iron Racket, a training weight), the shoes in
// the high nibble (1: the Iron Shoes, likewise). A level-up's training kind d: 0 spin, 1 power, 2 control,
// 3 speed (record +$38..+$3B), anything else only the level.
// Tests: web/tests/port/routines_story.mjs; lockstep on out/engine/rec2.mtrec (the story's level-ups).
import { FZ, FN, FH, FC, BANK_STORY_02, hook, zf, cpFlags, addHLFlags, addFlags, incFlags, spAddFlags } from "./common.js";
import { copyMemoryFast } from "../home/memory.js";
import { recomputeCharacterStats } from "./stat.js";
import { getPlayerRecordPtr, wStoryMainRecord } from "./story02.js";

const BANK = BANK_STORY_02;
const wStorySlotData = 0xC800;                  // the story file's image: its main record is the match copy
const CHARREC_LEVEL = 0x18, CHARREC_STAT_TOP = 0x20, CHARREC_EXP = 0x2C, CHARREC_TRAIN_LEVELS = 0x38;
const CHARREC_EQUIPMENT = 0x3C, CHAR_RECORD_SIZE = 0x40, NUM_STATS = 11, NUM_TRAININGS = 4;
const LEVEL_MAX = 0x63;                         // 99
const RACKET_IRON = 0x03, SHOES_IRON = 0x01;
const hStatDeltaOutPtr = 0xFFB0, hStatDeltaRecordCopy = 0xFFB2;
const Unused_02_4b99_Table = 0x4C18, CharDataPtr_02 = 0x4E78, EXP_THRESHOLD_SIZE = 3;

// RefreshMainCharacterStats (02:478F): the main record's stats recomputed, the two records copied to the save
// image, and the copy's Iron Racket / Iron Shoes taken off (so its stats in a match are without them).
// Returns the registers it leaves.
export function refreshMainCharacterStats(P) {
  const { bus } = P;
  recomputeCharacterStats(P, wStoryMainRecord);
  copyMemoryFast(P, wStoryMainRecord, wStorySlotData, (2 * CHAR_RECORD_SIZE) / 16);
  const at = wStorySlotData + CHARREC_EQUIPMENT;
  let b = bus.u8(at);
  if ((b & 0x0F) === RACKET_IRON) b &= 0xF0;
  if ((b >> 4) === SHOES_IRON) b &= 0x0F;
  bus.w8(at, b);
  return { ...recomputeCharacterStats(P, wStorySlotData), bc: wStorySlotData };
}
// RecomputeStatsWithoutRacket (02:47C6): the main record's stats recomputed as if it had nothing equipped (its
// equipment byte zeroed around it). Returns the registers it leaves (a the equipment byte, f as at the call).
export function recomputeStatsWithoutRacket(P) {
  const at = wStoryMainRecord + CHARREC_EQUIPMENT, eq = P.bus.u8(at);
  P.bus.w8(at, 0);
  const r = recomputeCharacterStats(P, wStoryMainRecord);
  P.bus.w8(at, eq);
  return { a: eq, de: r.de, hl: r.hl, bc: wStoryMainRecord };
}

// LevelUpPlayer (02:49BE): LevelUpPlayerRecord for the story file's record a (0 main, else the partner).
export function levelUpPlayer(P, a, d) {
  return levelUpPlayerRecord(P, getPlayerRecordPtr(a).bc, d);
}
// LevelUpPlayerRecord (02:49C1): record bc below level 99 gains training level d (0-3; others none) and a
// level, and its stats are recomputed. Returns the registers it leaves.
export function levelUpPlayerRecord(P, bc, d) {
  const { bus } = P, level = bus.u8(bc + CHARREC_LEVEL);
  if (level >= LEVEL_MAX) return { a: level, f: cpFlags(level, LEVEL_MAX), bc, hl: bc + CHARREC_LEVEL };
  if (d < NUM_TRAININGS) bus.w8(bc + CHARREC_TRAIN_LEVELS + d, (bus.u8(bc + CHARREC_TRAIN_LEVELS + d) + 1) & 0xFF);
  bus.w8(bc + CHARREC_LEVEL, (level + 1) & 0xFF);
  return { ...recomputeCharacterStats(P, bc), bc };
}

// ComputeLevelUpStatDeltas (02:4A00): the eleven stat changes (signed) a level-up with training d would bring to
// record a, written from hl on: the record is copied to a 64-byte stack buffer, levelled up, compared, and
// copied back. hStatDeltaOutPtr is left past the deltas, hStatDeltaRecordCopy at the buffer. sp: the stack
// pointer at the routine (its return address on top). Returns the registers it leaves.
export function computeLevelUpStatDeltas(P, a, d, hl, sp) {
  const { bus } = P;
  const copy = (sp - CHAR_RECORD_SIZE) & 0xFFFF;
  bus.w16(hStatDeltaOutPtr, hl);
  bus.w16(hStatDeltaRecordCopy, copy);
  const { bc } = getPlayerRecordPtr(a);
  copyMemoryFast(P, bc, copy, CHAR_RECORD_SIZE / 16);
  levelUpPlayerRecord(P, bc, d);
  let out = hl;
  for (let k = 0; k < NUM_STATS; k++, out = (out + 1) & 0xFFFF)
    bus.w8(out, (bus.u8(bc + CHARREC_STAT_TOP + k) - bus.u8(copy + CHARREC_STAT_TOP + k)) & 0xFF);
  bus.w16(hStatDeltaOutPtr, out);
  const r = copyMemoryFast(P, copy, bc, CHAR_RECORD_SIZE / 16);
  return { a: r.a, bc: 0, de: r.de, hl: r.hl, f: spAddFlags(copy, CHAR_RECORD_SIZE) };
}

// Unused_02_ListForEach (02:4B99): a debug level-up from Unused_02_4b99_Table's row a (4 bytes: how many spin,
// power, control and speed level-ups), after one plain level-up, then the record's EXP set to its level's
// threshold. Nothing calls it. The ROM passes the table pointer's low byte, and then each count, as
// LevelUpPlayer's record index, so all but row 0's first level-up go to the partner record (kept here).
// Returns the registers it leaves.
export function unusedListForEach(P, a) {
  const { bus } = P;
  const l = ((a * 4) & 0xFF) + (Unused_02_4b99_Table & 0xFF);
  let hl = ((Unused_02_4b99_Table & 0xFF00) + l) & 0xFFFF;
  let { bc } = levelUpPlayer(P, l & 0xFF, 0xFF);
  for (let kind = 0; kind < NUM_TRAININGS; kind++) {
    const count = P.rom.u8(BANK, hl); hl = (hl + 1) & 0xFFFF;
    for (let n = count; n; n--) bc = levelUpPlayer(P, n, kind).bc;
  }
  const table = P.rom.u16(BANK, CharDataPtr_02);
  const level = bus.u8(bc + CHARREC_LEVEL);
  if (level === 1) return { a: 1, f: cpFlags(1, 1), bc, de: table, hl: bc + CHARREC_LEVEL };
  const sum = ((level * 3) & 0xFF) + (table & 0xFF);
  let f = addFlags((level * 3) & 0xFF, table & 0xFF), de = ((table & 0xFF00) | (sum & 0xFF));
  if (sum > 0xFF) { f = incFlags(de >> 8, f & FC); de = (de + 0x100) & 0xFFFF; }
  f = addHLFlags(CHARREC_EXP, bc, f);
  for (let i = 0; i < EXP_THRESHOLD_SIZE; i++) bus.w8(bc + CHARREC_EXP + i, P.rom.u8(BANK, de + i));
  return { a: P.rom.u8(BANK, de + 2), f, bc, de: de + 2, hl: bc + CHARREC_EXP + 2 };
}

export const HOOKS = [
  [BANK, 0x478F, hook(P => refreshMainCharacterStats(P))],
  [BANK, 0x47C6, hook(P => recomputeStatsWithoutRacket(P))],
  [BANK, 0x49BE, hook((P, c) => levelUpPlayer(P, c.a, c.d))],
  [BANK, 0x49C1, hook((P, c) => levelUpPlayerRecord(P, c.bc, c.d))],
  [BANK, 0x4A00, hook((P, c) => computeLevelUpStatDeltas(P, c.a, c.d, c.hl, c.sp))],
  [BANK, 0x4B99, hook((P, c) => unusedListForEach(P, c.a))],
];
