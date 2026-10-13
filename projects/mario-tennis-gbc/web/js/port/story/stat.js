// The story characters' stats (bank 2, $441B-$46EA): the eleven 0-9 stats of a record from its level and four
// training levels through its archetype's thresholds, the level's modifiers to the swing word, the physics
// template, and the equipment's stat changes.
// Port of stat_02.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm),
// whose routine names these are.
//
// A stat: its training level (spin for Top and Slice, power for Serve, Stroke, Volley, control for Angle and
// Placement, speed for Speed, Dash, Reaction, Stop) * 5 - (level - 1), clamped to a signed byte, counted against
// the archetype's 9 rising signed thresholds for that stat (StatArchetype*_02: the stat is how many it passes).
// The archetype is the character id & 3 (Alex, Nina, Harry, Kate).
// Tests: web/tests/port/routines_story.mjs; lockstep on out/port/story1.mtrec.
import { FZ, FN, FH, FC, BANK_STORY_02, hook, zf, bitFlags, subFlags, addHLFlags, decFlags, cpFlags } from "./common.js";
import { clearMemory16 } from "../home/memory.js";
import { mulHLByA } from "../home/math.js";
import { getPlayerRecordPtr, getStoryCharacterRecordPtr, getCharPaletteIndex, wStoryMainRecord } from "./story02.js";

const BANK = BANK_STORY_02;
const StatArchetypePtrs_02 = 0x47F2, CharIconMasks_02 = 0x466E, EquipStatDeltaPtrs_02 = 0x46EB;
const CHARREC_CHAR = 0x0B, CHARREC_PALETTE = 0x0C, CHARREC_LEVEL = 0x18, CHARREC_SWING = 0x19;
const CHARREC_REACH = 0x10, CHARREC_STAT_TOP = 0x20, CHARREC_BUILD_KIND = 0x2F, CHARREC_PHYSICS_TEMPLATE = 0x30;
const CHARREC_TRAIN_LEVELS = 0x38, CHARREC_EQUIPMENT = 0x3C;
const THRESHOLDS = 9, NUM_STATS = 11, TRAINING_STEP = 5, MODIFIERS = 0x70, STAT_MAX = 9, EQUIP_ROW = 16;
// per stat (in record order Top .. Stop): its training level (0 spin, 1 power, 2 control, 3 speed)
const STAT_TRAINING = [0, 0, 1, 1, 1, 2, 2, 3, 3, 3, 3];
const THRESHOLDS_FIRST = 0x0D;                 // the archetype's first stat row (after level and the $30 bytes)

// Unused_02_LoadMainCharacterFromRoster (02:443B): the main record from roster character d & $3F (64 bytes from
// its roster record on). Nothing calls it. Returns the registers it leaves.
export function unusedLoadMainCharacterFromRoster(P, d, e) {
  const { bus } = P, de = wStoryMainRecord;
  clearMemory16(P, de, 4);
  const b = d & 0x3F;
  unusedCopy64Bytes(P, getStoryCharacterRecordPtr(b), de);
  bus.w8(de + CHARREC_CHAR, b);
  bus.w8(de + CHARREC_PALETTE, getCharPaletteIndex(P, b).a);
  bus.w8(de + CHARREC_BUILD_KIND, 0);
  const at = de + CHARREC_CHAR, sum = (at & 0xFF) + bus.u8(at), hl = (at + bus.u8(at)) & 0xFFFF;
  const f = sum > 0xFF ? (zf((at >> 8) + 1) | (((at >> 8) & 0x0F) === 0x0F ? FH : 0) | FC) : (zf(sum) | (((at & 0x0F) + (bus.u8(at) & 0x0F)) > 0x0F ? FH : 0));
  return { a: P.V.wramBank, f, bc: b << 8 | d, de: de << 0 | (e & 0) | de, hl };
}
// Unused_02_Copy64Bytes (02:447A): 64 bytes from hl to de. Returns { a, c, hl } after (de kept).
export function unusedCopy64Bytes(P, hl, de) {
  let a = 0;
  for (let i = 0; i < 0x40; i++) { a = P.bus.u8(hl); P.bus.w8(de + i, a); hl = (hl + 1) & 0xFFFF; }
  return { a, c: 0, hl, f: FZ | FN };
}
// RefreshPlayerStatsAndGetPtr (02:4485): recompute the story file's record a; hl = its level field.
export function refreshPlayerStatsAndGetPtr(P, a) {
  const { bc } = getPlayerRecordPtr(a);
  const r = recomputeCharacterStats(P, bc);
  return { ...r, bc, hl: bc + CHARREC_LEVEL, f: addHLFlags(CHARREC_LEVEL, bc, r.f) };
}
// LookupStatBarLevel (02:4494): e = how many of the 9 signed thresholds at hl the signed stat b passes (it stops
// at the first one it does not exceed). Returns the registers it leaves.
export function lookupStatBarLevel(P, hl, b) {
  const s = (b << 24) >> 24;
  let e = 0, d = THRESHOLDS, a = 0;
  for (;;) {
    const t = (P.bus.u8(hl) << 24) >> 24, diff = (s - t) & 0xFFFF;
    a = (diff >> 8) | (diff & 0xFF);
    if (diff & 0x8000) return { a, f: FH, d, e, hl };
    if (!a) return { a, f: FZ, d, e, hl };
    e++; hl = (hl + 1) & 0xFFFF;
    if (!--d) return { a, f: FZ | FN, d, e, hl };
  }
}
// ScaleStatForBarLevel (02:44B7): b = training level [hl] * 5 - (level - 1) of record bc, clamped to -127..127.
// Returns the registers it leaves.
export function scaleStatForBarLevel(P, hl, a, bc) {
  const m = mulHLByA(P, P.bus.u8(hl), a);
  const lvl1 = (P.bus.u8(bc + CHARREC_LEVEL) - 1) & 0xFF, x = (m.hl - lvl1) & 0xFFFF;
  const out = { a, de: lvl1, hl: x };
  const t1 = x + 0xFF81;
  if (!(t1 & 0x8000)) return { ...out, b: 0x7F, f: FZ | FH | (t1 > 0xFFFF ? FC : 0) };
  const t2 = x + 0x007F, c2 = t2 > 0xFFFF ? FC : 0;
  if (t2 & 0x8000) return { ...out, b: 0x81, f: FH | c2 };
  return { ...out, b: x & 0xFF, f: FZ | FH | c2 };
}
// RecomputeCharacterStats (02:44E9): record bc's stats (above); its level's modifiers (the archetype's list at
// $70: [level, mask index] pairs ended by $FF) OR masks into its swing word (after the first match the ROM
// compares with the record's high byte instead of the level); its reach box from the physics template; and for a
// record at a $100 boundary (the story's main record), the equipment's changes. Returns the registers it leaves.
export function recomputeCharacterStats(P, bc) {
  const { bus } = P;
  const arch = P.rom.u16(BANK, (StatArchetypePtrs_02 + ((bus.u8(bc + CHARREC_CHAR) & 3) * 2)) & 0xFFFF);
  for (let k = 0; k < NUM_STATS; k++) {
    const b = scaleStatForBarLevel(P, bc + CHARREC_TRAIN_LEVELS + STAT_TRAINING[k], TRAINING_STEP, bc).b;
    const e = lookupStatBarLevelRom(P, arch + THRESHOLDS_FIRST + k * THRESHOLDS, b);
    bus.w8(bc + CHARREC_STAT_TOP + k, e);
  }
  let d = bus.u8(bc + CHARREC_LEVEL), hl = (arch + MODIFIERS) & 0xFFFF;
  for (;;) {
    const a = P.rom.u8(BANK, hl); hl = (hl + 1) & 0xFFFF;
    if (a === 0xFF) break;
    if (a === d) {
      const mask = (CharIconMasks_02 + ((P.rom.u8(BANK, hl) & 0x0F) * 2)) & 0xFFFF;
      const de = (bc & 0xFF00) | ((bc + CHARREC_SWING) & 0xFF);
      bus.w8(de, bus.u8(de) | P.rom.u8(BANK, mask));
      bus.w8(de + 1, bus.u8(de + 1) | P.rom.u8(BANK, mask + 1));
      d = de >> 8;
    }
    hl = (hl + 1) & 0xFFFF;
  }
  for (let i = 0; i < 8; i++) bus.w8((bc & 0xFF00) | ((bc + CHARREC_REACH + i) & 0xFF), bus.u8(bc + CHARREC_PHYSICS_TEMPLATE + i));
  if (!(bc & 0xFF)) applyStatModifiers(P, bc);
  return { a: bc & 0xFF, f: zf(bc & 0xFF), de: (bc & 0xFF00) | ((bc + CHARREC_REACH + 8) & 0xFF), hl: bc + CHARREC_PHYSICS_TEMPLATE + 8 };
}
// the thresholds are in this bank's ROM (the ROM reads them through the bank mapped: bank 2)
function lookupStatBarLevelRom(P, hl, b) {
  const s = (b << 24) >> 24;
  let e = 0;
  for (let d = THRESHOLDS; d > 0; d--) {
    const t = (P.rom.u8(BANK, hl) << 24) >> 24;
    if (s <= t) return e;
    e++; hl++;
  }
  return e;
}
// ApplyStatModifiers (02:468E): record bc's racket (equipment low nibble) and shoes (high nibble) change its stats,
// each kept in 0-9. Keeps the registers.
export function applyStatModifiers(P, bc) {
  const eq = P.bus.u8(bc + CHARREC_EQUIPMENT);
  applyStatModifierRow(P, eq & 0x0F, 0, bc);
  applyStatModifierRow(P, P.bus.u8(bc + CHARREC_EQUIPMENT) >> 4, 1, bc);
}
// ApplyStatModifierRow (02:46B3): item a of kind d (0 rackets, 1 shoes): its 11 signed deltas added to the stats.
// Returns the registers it leaves.
export function applyStatModifierRow(P, item, kind, bc) {
  const { bus } = P;
  const table = P.rom.u16(BANK, (EquipStatDeltaPtrs_02 + ((kind * 2) & 0xFF)) & 0xFFFF);
  let hl = (item * EQUIP_ROW + table) & 0xFFFF, de = (bc & 0xFF00) | ((bc + CHARREC_STAT_TOP) & 0xFF), a = 0, b = 0, carry = 0;
  for (let c = NUM_STATS; c > 0; c--) {
    b = P.rom.u8(BANK, hl);
    a = (bus.u8(de) + b) & 0xFF;
    if (a & 0x80) { a = 0; carry = 0; }
    else if (a >= STAT_MAX) { a = STAT_MAX; carry = 0; }
    else carry = FC;
    bus.w8(de, a);
    hl = (hl + 1) & 0xFFFF; de = (de + 1) & 0xFFFF;
  }
  return { a, bc: b << 8, de, hl, f: FZ | FN | carry };
}

export const HOOKS = [
  [BANK, 0x443B, hook((P, c) => unusedLoadMainCharacterFromRoster(P, c.d, c.e))],
  [BANK, 0x447A, hook((P, c) => unusedCopy64Bytes(P, c.hl, c.de))],
  [BANK, 0x4485, hook((P, c) => refreshPlayerStatsAndGetPtr(P, c.a))],
  [BANK, 0x4494, hook((P, c) => lookupStatBarLevel(P, c.hl, c.b))],
  [BANK, 0x44B7, hook((P, c) => scaleStatForBarLevel(P, c.hl, c.a, c.bc))],
  [BANK, 0x44E9, hook((P, c) => recomputeCharacterStats(P, c.bc))],
  [BANK, 0x468E, hook((P, c) => { applyStatModifiers(P, c.bc); })],
  [BANK, 0x46B3, hook((P, c) => applyStatModifierRow(P, c.a, c.d, c.bc))],
];
