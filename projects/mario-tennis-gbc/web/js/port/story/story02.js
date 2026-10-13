// Story characters and the story file's state (bank 2, $4044-$441A): the court records of a match (wCa00..:
// four 64-byte character records, one per court slot) from a character id, the roster's records, palettes,
// the story file's two player records (main $C900, partner $C940) from a template, a new story file, and the
// story save signature (four random bytes that must differ from the other files').
// Port of story_02.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm),
// whose routine names these are.
//
// A character record (64 bytes, include/constants/characters.inc): name (7), ..., $0B character id, $0C palette,
// $0D gender, $0E left-handed, $0F physics..., $18 level, $19 swing word, $20-$2A the eleven stats (0-9), $2C EXP
// (24-bit), $2F build kind, $30 physics template (4 words), $38 the four training levels, $3C equipment. The
// roster (StoryCharacterRecords_02) has 29 bytes per character, copied to the record's $0F.
// Tests: web/tests/port/routines_story.mjs; lockstep on out/port/story1.mtrec (a new game).
import {
  FZ, FN, FH, FC, WRAM_SCENE, BANK_STORY_02, FLAG_NEW_GAME_CLEARED_BIT, FLAG_NEW_GAME_SET_BIT, hook, setFlag,
  clearFlag, withWramBank, randomSeed, cpFlags, subFlags, addFlags, addHLFlags, bitFlags, zf,
} from "./common.js";
import { clearMemory16, copyMemoryFast } from "../home/memory.js";
import { recomputeCharacterStats } from "./stat.js";
import { remapExtendedCharId } from "./records.js";

const BANK = BANK_STORY_02;
const CharPaletteIndexTable = 0x417E, Unused_02_CharIdRemapTable = 0x4133;
const StoryCharacterRecords_02 = 0x52CF, ROSTER_RECORD_SIZE = 29, ROSTER_RECORD_DEST = 0x0F;
const StoryCharGenderTable = 0x441B, StatArchetypePtrs_02 = 0x47F2;
const CHAR_RECORD_SIZE = 0x40, CHARREC_CHAR = 0x0B, CHARREC_PALETTE = 0x0C, CHARREC_GENDER = 0x0D;
const CHARREC_LEVEL = 0x18, CHARREC_BUILD_KIND = 0x2F, CHARREC_PHYSICS_TEMPLATE = 0x30;
export const wStoryMainRecord = 0xC900, wStoryPartnerRecord = 0xC940, wCa00Records = 0xCA00;
const wStorySlotData = 0xC800, wStorySlotSignatures = 0xD400, wStorySaveSignature = 0xC880, wStoryRandomBytes = 0xC8BB;
const wN64TransferMarker = 0xC9B4, wPendingExpStory = 0xC9B0, N64_MARKER = 0x64;
const CHAR_EMPTY = 0xFF, CHAR_STORY_ROSTER_MAIN = 0x90, CHAR_STORY_FLAG = 0x80, CHAR_KEEP_BUILD = 0x40;
const NAME_TEXT_BASE = 0x001B;                  // text id of character 0's name
const BUILD_MAIN = 0x03, BUILD_ROSTER = 0x02, NO_STORY_FILE = 0x0F;
const BANK_TEXT = 0x05, FetchShortTextToBuffer = 0x409A;
const BANK_SAVE = 0x03, CheckStorySlot = 0x4D64, SLOT_EMPTY = 0xFE;
const BANK_MATCH = 0x08, InitDefaultMatchSettings = 0x4070;
const STORY_BLOCK_TAG = 0x56;

// GetCa00RecordPtr (02:420E): bc = court slot a's record (wCa00 + (a & 3) * $40).
export function getCa00RecordPtr(a) {
  const c = ((a & 3) << 6) & 0xFF, t = (c + (wCa00Records >> 8)) & 0xFF;
  return { bc: wCa00Records | c, a: (t - c) & 0xFF, f: subFlags(t, c) };
}
// GetPlayerRecordPtr (02:4206): bc = the story file's main record (a = 0) or its partner's.
export function getPlayerRecordPtr(a) {
  return a ? { bc: wStoryPartnerRecord, f: 0 } : { bc: wStoryMainRecord, f: FZ };
}
// GetStoryCharacterRecordPtr (02:41EE): hl = character a's 29-byte roster record. Keeps the others.
export const getStoryCharacterRecordPtr = a => (a * ROSTER_RECORD_SIZE + StoryCharacterRecords_02) & 0xFFFF;
// GetCharPaletteIndex (02:4173) / Unused_02_CharIdRemapLookup (02:4128): a's entry in the table.
const indexed = (P, table, a) => {
  const sum = (a + (table & 0xFF)) & 0xFF, x = (sum + (table >> 8) + (a + (table & 0xFF) > 0xFF ? 1 : 0)) & 0xFF;
  return { a: P.rom.u8(BANK, (table + a) & 0xFFFF), f: subFlags(x, sum) };
};
export const getCharPaletteIndex = (P, a) => indexed(P, CharPaletteIndexTable, a);
export const unusedCharIdRemapLookup = (P, a) => indexed(P, Unused_02_CharIdRemapTable, a);

// InitCa00RecordFromCharId (02:4066): court slot c's record for character b: $FF an empty slot (character $FF);
// $90 the story's main character by name (its build kind 3; the ROM writes the name's first letter one record
// on); $80/$81 a copy of the story file's main / partner record (not without a story file, slot $0F); else the
// roster character b: its 29 bytes, id (remapped), palette and name, and with b's bit 6 build kind 2.
// Returns the registers it leaves.
export function* initCa00RecordFromCharIdGen(P, b, c) { return initCa00RecordFromCharId(P, b, c); }
export function initCa00RecordFromCharId(P, char, slot) {
  const { bus } = P, rec = getCa00RecordPtr(slot).bc, recLo = rec & 0xFF;
  if (char === CHAR_EMPTY) {
    clearMemory16(P, rec, 4);
    bus.w8(rec + CHARREC_CHAR, 0xFF);
    return { a: 0, c: 0, de: rec, hl: rec + CHARREC_CHAR, f: addHLFlags(CHARREC_CHAR, rec, FZ) };
  }
  if (char === CHAR_STORY_ROSTER_MAIN) {
    const end = clearMemory16(P, rec, 4);
    const a = bus.u8(wStoryMainRecord);
    bus.w8(end, a);
    bus.w8(rec + CHARREC_BUILD_KIND, BUILD_MAIN);
    return { a, c: 0, de: rec, hl: rec + CHARREC_BUILD_KIND, f: addHLFlags(CHARREC_BUILD_KIND, rec, FZ) };
  }
  if (char & CHAR_STORY_FLAG) {
    if (P.V.currentStorySlot === NO_STORY_FILE) return { a: NO_STORY_FILE, b: char, c: recLo, hl: rec, f: FZ | FN };
    clearMemory16(P, rec, 4);
    const src = wStoryMainRecord + (char & 1) * CHAR_RECORD_SIZE;
    const r = copyMemoryFast(P, src, rec, 4);
    return { a: r.a, b: char, c: 0, de: r.de, hl: r.hl, f: FZ | FN };
  }
  const fromRosterF = FZ | FH | (char < CHAR_STORY_ROSTER_MAIN ? FC : 0);   // (pushed with a after `bit 7, a`)
  clearMemory16(P, rec, 4);
  let hl = getStoryCharacterRecordPtr(char);
  for (let i = 0; i < ROSTER_RECORD_SIZE; i++) {
    bus.w8((rec & 0xFF00) | ((rec + ROSTER_RECORD_DEST + i) & 0xFF), bus.u8(hl)); hl = (hl + 1) & 0xFFFF;
  }
  const id = remapExtendedCharId(P, char).a;
  bus.w8(rec + CHARREC_CHAR, id);
  bus.w8(rec + CHARREC_PALETTE, getCharPaletteIndex(P, char).a);
  const text = (NAME_TEXT_BASE + bus.u8(rec + CHARREC_CHAR)) & 0xFFFF;
  const t = P.callRom(BANK_TEXT, FetchShortTextToBuffer, { hl: text, de: rec, b: char, c: 0, a: text & 0xFF });
  if (!(char & CHAR_KEEP_BUILD)) return { a: char, f: fromRosterF, bc: t.bc, de: rec, hl: t.hl };
  bus.w8(rec + CHARREC_BUILD_KIND, BUILD_ROSTER);
  const f = addHLFlags(CHARREC_BUILD_KIND, rec, 0);
  const bank = P.V.wramBank;
  withWramBank(P, WRAM_SCENE, () => {});
  return { a: bank, f, bc: t.bc, de: rec, hl: rec + CHARREC_BUILD_KIND };
}

// Unused_02_ValidateN64TransferRecord (02:4044): a = $FF when an N64 transfer record is there (marker $64 and its
// checksum: the 7 bytes' sum, rotated, xor $FE), else 0. Nothing calls it.
export function unusedValidateN64TransferRecord(P) {
  const { bus } = P, m = bus.u8(wN64TransferMarker);
  if (m !== N64_MARKER) return { a: 0, f: FZ };
  let a = 0;
  for (let i = 0; i < 7; i++) a = (a + bus.u8(wPendingExpStory + i)) & 0xFF;
  a = (((a << 1) | (a >> 7)) & 0xFF) ^ 0xFE;
  const hl = wPendingExpStory + 7, ok = a === bus.u8(hl);
  return ok ? { a: 0xFF, f: FZ | FN, hl } : { a: 0, f: FZ, hl };
}

// InitStoryModeState (02:421C): a new story file: the files' signatures cached, the slot data cleared, the main
// record from template 0 (Alex) and the partner's from template 2 (Harry), location 0 entry 2, message speed 1,
// the default match settings, the new-game flags and the block tag. Returns the registers it leaves.
export function initStoryModeState(P) {
  const { V, bus } = P;
  cacheStorySlotSummaries(P);
  clearMemory16(P, wStorySlotData, 0x30);
  initPlayerRecordFromTemplate(P, 0, 0);
  initPlayerRecordFromTemplate(P, 1, 2);
  V.storyModeCurrentLocation = 0;
  V.storyModeEntryPoint = 2;
  V.messageSpeed = 1;
  const r = P.callRom(BANK_MATCH, InitDefaultMatchSettings);
  clearFlag(P, FLAG_NEW_GAME_CLEARED_BIT);
  setFlag(P, FLAG_NEW_GAME_SET_BIT);
  bus.w8(P.A.storySlotBlockTag, STORY_BLOCK_TAG);
  bus.w8(P.A.storySlotBlockTag + 1, 0); bus.w8(P.A.storySlotBlockTag + 2, 0);
  return { a: 0, f: FZ, bc: r.bc, de: r.de, hl: P.A.storySlotBlockTag + 2 };
}
// Unused_02_SignExtendL (02:4257): h = l's sign.
export const unusedSignExtendL = (hl, f) => ({ h: hl & 0x80 ? 0xFF : 0, f: bitFlags(!!(hl & 0x80), f & FC) });
// CacheStorySlotSummaries (02:4261): the three files' save signatures (from CheckStorySlot, bank 3) into
// wStorySlotSignatures (WRAM 6; zeros for an empty file). Keeps the registers.
export function cacheStorySlotSummaries(P) {
  const { bus, V } = P;
  withWramBank(P, WRAM_SCENE, () => {
    for (let i = 0; i < 12; i++) bus.w8(wStorySlotSignatures + i, 0);
    const saved = V.currentStorySlot;
    for (let slot = 0; slot < 3; slot++) {
      V.currentStorySlot = slot;
      if (P.callRom(BANK_SAVE, CheckStorySlot).a !== SLOT_EMPTY) copy4Bytes(P, wStorySaveSignature, wStorySlotSignatures + 4 * slot);
    }
    V.currentStorySlot = saved;
  });
}
// Copy4Bytes (02:42C9): 4 bytes from hl to de. Returns { a, hl, de } after.
export function copy4Bytes(P, hl, de) {
  let a = 0;
  for (let i = 0; i < 4; i++) { a = P.bus.u8(hl + i); P.bus.w8(de + i, a); }
  return { a, hl: (hl + 4) & 0xFFFF, de: (de + 4) & 0xFFFF };
}
// CheckStorySignatureCollision (02:42D6): a = $FF when the save signature is 0 or shares a byte (in place) with
// another file's (the ROM stops at the first equal byte), else 0.
export function checkStorySignatureCollision(P) {
  const { bus } = P;
  return withWramBank(P, WRAM_SCENE, () => {
    let or = 0;
    for (let i = 0; i < 4; i++) or |= bus.u8(wStorySaveSignature + i);
    if (!or) return 0xFF;
    for (let slot = 0; slot < 3; slot++)
      for (let i = 0; i < 4; i++) if (bus.u8(wStorySaveSignature + i) === bus.u8(wStorySlotSignatures + 4 * slot + i)) return 0xFF;
    return 0;
  });
}
// CompareNextByte (02:4347): Z when [de] = [hl]; both advanced; a = $FF.
export function compareNextByte(P, de, hl) {
  return { a: 0xFF, f: cpFlags(P.bus.u8(de), P.bus.u8(hl)), de: (de + 1) & 0xFFFF, hl: (hl + 1) & 0xFFFF };
}
// RollStoryRandomByte (02:434E): wStoryRandomBytes[a] = a random byte (the seed's high byte). Keeps the registers.
export function rollStoryRandomByte(P, a) {
  const de = (wStoryRandomBytes + a) & 0xFFFF;
  P.bus.w8(de, randomSeed(P) >> 8);
}
// GenerateUniqueStorySaveSignature (02:4364): the save signature from the 4 rolled bytes, re-rolled until it does
// not collide. Keeps the registers.
export function generateUniqueStorySaveSignature(P) {
  copy4Bytes(P, wStoryRandomBytes, wStorySaveSignature);
  while (checkStorySignatureCollision(P)) for (let i = 0; i < 4; i++) P.bus.w8(wStorySaveSignature + i, randomSeed(P) >> 8);
}
// InitPlayerRecordFromTemplate (02:43A3): the story file's record a (0 main, 1 partner) for template d & 3 (Alex,
// Nina, Harry, Kate): id, palette, name, gender, the archetype's level and 12 bytes at $30, the stats; then both
// records copied to the slot data. Returns the registers it leaves.
export function initPlayerRecordFromTemplate(P, which, template) {
  const { bus } = P, d = template & 3, bc = getPlayerRecordPtr(which & 1).bc;
  clearMemory16(P, bc, 4);
  bus.w8(bc + CHARREC_CHAR, remapExtendedCharId(P, d).a);
  bus.w8(bc + CHARREC_PALETTE, getCharPaletteIndex(P, d).a);
  P.callRom(BANK_TEXT, FetchShortTextToBuffer, { hl: NAME_TEXT_BASE + d, de: bc, bc, a: (bc & 0xFF) });
  bus.w8(bc + CHARREC_GENDER, P.rom.u8(BANK, StoryCharGenderTable + d));
  let hl = P.rom.u16(BANK, StatArchetypePtrs_02 + d * 2);
  bus.w8(bc + CHARREC_LEVEL, P.rom.u8(BANK, hl)); hl++;
  for (let i = 0; i < 12; i++) bus.w8(bc + CHARREC_PHYSICS_TEMPLATE + i, P.rom.u8(BANK, hl + i));
  recomputeCharacterStats(P, bc);
  const r = copyMemoryFast(P, wStoryMainRecord, wStorySlotData, (2 * CHAR_RECORD_SIZE) / 16);
  return { a: r.a, bc: bc & 0xFF00, de: r.de, hl: r.hl, f: FZ | FN };
}

export const HOOKS = [
  [BANK, 0x4044, hook(P => unusedValidateN64TransferRecord(P))],
  [BANK, 0x4066, hook((P, c) => initCa00RecordFromCharId(P, c.b, c.c))],
  [BANK, 0x4128, hook((P, c) => unusedCharIdRemapLookup(P, c.a))],
  [BANK, 0x4173, hook((P, c) => getCharPaletteIndex(P, c.a))],
  [BANK, 0x41EE, hook((P, c) => ({ hl: getStoryCharacterRecordPtr(c.a) }))],
  [BANK, 0x4206, hook((P, c) => getPlayerRecordPtr(c.a))],
  [BANK, 0x420E, hook((P, c) => getCa00RecordPtr(c.a))],
  [BANK, 0x421C, hook(P => initStoryModeState(P))],
  [BANK, 0x4257, hook((P, c) => unusedSignExtendL(c.hl, c.f))],
  [BANK, 0x4261, hook(P => { cacheStorySlotSummaries(P); })],
  [BANK, 0x42C9, hook((P, c) => copy4Bytes(P, c.hl, c.de))],
  [BANK, 0x42D6, hook(P => ({ a: checkStorySignatureCollision(P) }))],
  [BANK, 0x4347, hook((P, c) => compareNextByte(P, c.de, c.hl))],
  [BANK, 0x434E, hook((P, c) => { rollStoryRandomByte(P, c.a); })],
  [BANK, 0x4364, hook(P => { generateUniqueStorySaveSignature(P); })],
  [BANK, 0x43A3, hook((P, c) => initPlayerRecordFromTemplate(P, c.a, c.d))],
];
