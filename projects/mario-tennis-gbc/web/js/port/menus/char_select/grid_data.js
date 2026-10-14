// The exhibition/link character grid's data (bank $38): which characters are unlocked, the grid entries built from
// them, the created characters of the three story files, the player slots (1P, partner, the CPU opponents) and what
// a confirmed selection writes into the match's character records (CPU difficulty, handedness).
// Port of src/engine/menus/char_select/grid_icons_38.asm (the data half), grid_slots_38.asm (the slot ring, the grid
// cursor, created characters) and cpu_params_38.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm); names and addresses are its own. Tables are read from the ROM.
//
// The grid: wCharGridEntries (WRAM 3), 32 entries of 4 bytes [character id ($FF: empty), palette + 1 (or the
// created character's color + 1), taken flag, created-record index]. Entries 0-8 are the Mario cast, 9 on the
// roster characters and, from entry 9, the six created characters (main and partner of each story file). A page
// of the grid shows 6 entries (3 columns x 2 rows) starting at entry page * 3.
// Tests: web/tests/port/routines_menus_chars.mjs; lockstep on out/port/cs_singles.mtrec, cs_doubles.mtrec,
// cs_saved.mtrec (a story save: the created characters) and out/engine/exh1.mtrec.
import {
  FZ, FN, FC, cpFlags, rd, wr, u8, w8, idx, far, withWram, rom, FAR, WRAM_STAGING, WRAM_SCREEN, wDecompBuffer,
  wStoryModeNameOfMainCharacter, wCharUnlockFlags_SIZE, wCreatedCharRecords_SIZE, STORYSLOT_NONE, CHAR_NONE,
  copyMemoryFast, copyMemoryBC, hook, testGameFlag,
} from "./defs.js";
import { clearBytes } from "../../home/system.js";
import { checkStorySlot, testSaveFlag } from "../../save/storyslots.js";

export const BANK = 0x38;
const CharUnlockFlagsTable0 = 0x5B17, CharUnlockFlagsTable1 = 0x5B29, CharGridFromUnlockFlagsTable = 0x5B93;
const CharSelectSlotRingTable = 0x5C8F, CpuDifficultyParamPtrs_38 = 0x5FEB, CachedStorySlotNameTable = 0x60E6;
const CharGridPageCountTable = 0x61DB;
const BANK_SAVE = 0x03;
const GRID_ENTRY_SIZE = 4, GRID_ENTRIES = 0x20, GRID_PAGE_ENTRIES = 3;       // a page step: one row of 3 entries
const MARIO_CAST_ENTRIES = 8, ROSTER_FIRST_ENTRY = 9, ROSTER_ENTRIES = 0x16;
const CREATED_RECORD_SIZE = 0x20;                                            // wCreatedCharRecords: 6 of them
const STORY_FILES = 3;
const FIRST_MARIO_CAST = 0x17, LAST_MARIO_CAST = 0x1F;
const NUM_CREATED_CHAR_IDS = 4;                                              // ids 0-3: Alex, Nina, Harry, Kate
const word = (P, addr) => P.rom.u16(BANK, addr);
const byte = (P, addr) => P.rom.u8(BANK, addr);
// entry n's address: `add a / add a / add l`, the 8-bit index (wCharGridEntries is page-aligned)
const entryAddr = (P, n) => (P.A.charGridEntries + ((n * GRID_ENTRY_SIZE) & 0xFF)) & 0xFFFF;

// ---- the slot ring ----
// CharSelectSlotRingTable: per wCharSelectMode a list [$FF, slot, ..., $FF] of the player slots it fills, in
// order (0 = 1P, 1 = 1P's partner, 2 = the opponent, 3 = the opponent's partner, 4 = done)
const ringList = P => word(P, idx(CharSelectSlotRingTable, rd(P, "charSelectMode") * 2));
// AdvanceToNextPlayerSlot (38:5C47): wCharSelectSlot = the slot after it in the ring. Returns it (a), with b = the
// old slot and hl past it; the flags of the `cp b` that found the old one.
export function advanceToNextPlayerSlot(P) {
  let hl = ringList(P);
  const b = rd(P, "charSelectSlot");
  while (u8(P, hl) !== b) hl = (hl + 1) & 0xFFFF;
  hl = (hl + 1) & 0xFFFF;
  const a = u8(P, hl);
  wr(P, "charSelectSlot", a);
  return { a, b, hl, f: FZ | FN };
}
// RetreatToPreviousPlayerSlot (38:5C63): wCharSelectSlot = the slot before it. Returns it, or $FF before the first
// one, or $FE when leaving the "done" slot 4 (the last selection is cancelled, not the screen).
export function retreatToPreviousPlayerSlot(P) {
  let hl = ringList(P);
  const b = rd(P, "charSelectSlot");
  while (u8(P, hl) !== b) hl = (hl + 1) & 0xFFFF;
  hl = (hl - 1) & 0xFFFF;                                    // (`ld a, [hl+]` went one past: back two)
  const a = u8(P, hl);
  wr(P, "charSelectSlot", a);
  if (a === 0xFF) return { a, b, hl, f: FZ | FN };
  if (b === 4) return { a: 0xFE, b, c: a, hl, f: FZ | FN };
  return { a, b, c: a, hl, f: cpFlags(b, 4) };
}

// ---- the grid cursor ----
// GetGridSlotFromCursor (38:5CB7): the grid entry under the cursor: x + 3y + 3 * page. Returns it in a and b
// (c = 0, d = x, e = 3y); flags kept.
export function getGridSlotFromCursor(P) {
  return withWram(P, WRAM_SCREEN, () => {
    const d = rd(P, "menuCursorX"), e = (rd(P, "menuCursorY") * 3) & 0xFF;
    let b = (d + e) & 0xFF;
    for (let c = rd(P, "charGridPage"); c; c--) b = (b + GRID_PAGE_ENTRIES) & 0xFF;
    return { a: b, b, c: 0, d, e };
  });
}
// BuildVisiblePageSpriteList (38:5CE5): the 6 entries of the page into wScreenScratch as [id, palette] pairs, the
// palette 0 for a taken entry (drawn grayed). All registers kept.
export function buildVisiblePageSpriteList(P) {
  withWram(P, WRAM_SCREEN, () => {
    let hl = (P.A.charGridEntries + rd(P, "charGridPage") * 12) & 0xFFFF, de = P.A.screenScratch;
    for (let c = 0; c < 6; c++) {
      w8(P, de, u8(P, hl)); de++;
      w8(P, de, u8(P, hl + 1));
      if (u8(P, hl + 2)) w8(P, de, 0);
      de++; hl = (hl + GRID_ENTRY_SIZE) & 0xFFFF;
    }
  });
}
// GetGridEntryTakenPtr (38:5D60): the taken flag of the entry at page c, column d, row e. Returns hl (and the
// registers it leaves: bc = $000C, e = 3 * row, a = the flag's low address byte).
export function getGridEntryTakenPtr(P, page, x, y) {
  let hl = P.A.charGridEntries;
  for (let a = page; a; a--) hl = (hl + 12) & 0xFFFF;
  const e = (y * 3) & 0xFF, a = (((x + e) & 0xFF) * 4) & 0xFF;
  hl = (hl + a + 2) & 0xFFFF;
  return { hl, bc: 0x000C, e, a: hl & 0xFF };
}
// TestAndSetGridEntryTaken (38:5D42) / Unused_38_TestAndClearGridEntryTaken (38:5D25): the taken flag of entry
// (page c, column d, row e), then set (or clear) it. Returns the old flag in a; the other registers and flags kept.
export function testAndSetGridEntryTaken(P, page, x, y, value = 1) {
  return withWram(P, WRAM_SCREEN, () => {
    const { hl } = getGridEntryTakenPtr(P, page, x, y), old = u8(P, hl);
    w8(P, hl, value);
    return old;
  });
}

// ---- the created characters ----
// BuildCreatedCharRecords (38:5D83): wCreatedCharRecords (WRAM 3): for each story file (CHAR_STORY_MAIN + 0..2,
// loaded with LoadCharacterRecordToBuffer, whose CheckCharacterUnlocked brings the file in) a 32-byte record of
// the main character and one of the partner: [overworld sprite, color, EXP tier, spin, power, control, speed, name
// (11 bytes)]; a file without a created character (the id in its record not 0-3) gets $FF in both. All registers
// kept.
const CREATED_FIELDS = [
  ["storyModeMainCharacterOverworldSprite", "storyModeMainCharacterOverworldSpriteColor", "storyMainCharExpTier",
    "storyMainCharSpinLevel", "storyMainCharPowerLevel", "storyMainCharControlLevel", "storyMainCharSpeedLevel",
    "storyModeNameOfMainCharacter"],
  ["storyModePartnerCharacterOverworldSprite", "storyModePartnerCharacterOverworldSpriteColor", "storyPartnerCharExpTier",
    "storyPartnerCharSpinLevel", "storyPartnerCharPowerLevel", "storyPartnerCharControlLevel", "storyPartnerCharSpeedLevel",
    "storyModeNameOfPartnerCharacter"],
];
const CREATED_NAME_OFFSET = 7, NAME_SIZE = 0x0B;
const RECORD_CHAR_ID = 0xD400 + 12 * 32 + 11;            // wShadowAttrmap + 12 * TILEMAP_WIDTH + 11 (as the ROM names it)
export function buildCreatedCharRecords(P) {
  withWram(P, WRAM_SCREEN, () => {
    clearBytes(P, P.A.createdCharRecords, wCreatedCharRecords_SIZE);
    let bc = P.A.createdCharRecords;
    for (let ch = 0x80; ch !== 0x83; ch++) {
      rom(P, FAR.LoadCharacterRecordToBuffer, { a: ch, bc });
      rom(P, FAR.CheckCharacterUnlocked, { a: ch, bc });
      if (u8(P, RECORD_CHAR_ID) >= NUM_CREATED_CHAR_IDS) {
        w8(P, bc, 0xFF); bc = (bc + CREATED_RECORD_SIZE) & 0xFFFF;
        w8(P, bc, 0xFF); bc = (bc + CREATED_RECORD_SIZE) & 0xFFFF;
        continue;
      }
      for (const fields of CREATED_FIELDS) {
        for (let i = 0; i < CREATED_NAME_OFFSET; i++) w8(P, bc + i, rd(P, fields[i]));
        const e = (bc & 0xFF) + CREATED_NAME_OFFSET;       // `ld a, $07 / add c / ld e, a / ld d, b` (no carry into d)
        copyMemoryBC(P, P.A[fields[CREATED_NAME_OFFSET]], (bc & 0xFF00) | (e & 0xFF), NAME_SIZE);
        bc = (bc + CREATED_RECORD_SIZE) & 0xFFFF;
      }
    }
  });
}
// AddCreatedCharsToCharGrid (38:5BD9): the created characters into the grid from entry 9: file n's main character
// at entry 9 + k, its partner at entry 12 + k (k counting the files that have one), as [sprite, color + 1, 0,
// record index (2 * file, + 1 for the partner)].
export function addCreatedCharsToCharGrid(P) {
  withWram(P, WRAM_SCREEN, () => {
    let hl = P.A.createdCharRecords, b = 0;
    const base = (P.A.charGridEntries + ROSTER_FIRST_ENTRY * GRID_ENTRY_SIZE) & 0xFFFF;
    for (let c = 0; c < STORY_FILES; c++) {
      if (u8(P, hl) === 0xFF) { hl = (hl + 2 * CREATED_RECORD_SIZE) & 0xFFFF; continue; }
      for (const [k, part] of [[b, 0], [b + 3, 1]]) {
        const de = (base + ((k * 4) & 0xFF)) & 0xFFFF;
        w8(P, de, u8(P, hl));
        w8(P, de + 1, u8(P, hl + 1) + 1);
        w8(P, de + 2, 0);
        w8(P, de + 3, c * 2 + part);
        hl = (hl + CREATED_RECORD_SIZE) & 0xFFFF;
      }
      b++;
    }
  });
}

// ---- unlocks and the grid's entries ----
// BuildCharUnlockFlags (38:5A82): wCharUnlockFlags (WRAM 3): bytes 0-8, the Mario cast (CharUnlockFlagsTable0:
// a save flag each, $FFFF = always); 15-17 always 1; 18-30, the roster characters met in any of the three story
// files (CharUnlockFlagsTable1: a game flag each, tested in each file's image). wCurrentStorySlot is kept.
export function buildCharUnlockFlags(P) {
  withWram(P, WRAM_SCREEN, () => {
    const flags = P.A.charUnlockFlags;
    clearBytes(P, flags, wCharUnlockFlags_SIZE);
    for (let b = 0; b < 9; b++) {
      const de = word(P, idx(CharUnlockFlagsTable0, b * 2));
      if (((de >> 8) & de & 0xFF) === 0xFF || far(P, BANK_SAVE, () => testSaveFlag(P, de))) w8(P, flags + b, 1);
    }
    for (let i = 15; i < 18; i++) w8(P, flags + i, 1);
    const slot = rd(P, "currentStorySlot");
    for (let c = 0; c < STORY_FILES; c++) {
      wr(P, "currentStorySlot", c);
      far(P, BANK_SAVE, () => checkStorySlot(P));
      for (let b = 0; b < 13; b++) {
        if (testGameFlag(P, word(P, idx(CharUnlockFlagsTable1, b * 2)))) w8(P, flags + 18 + b, 1);
      }
    }
    wr(P, "currentStorySlot", slot);
  });
}
// BuildCharGridFromUnlockFlags (38:5B43): one grid entry per unlock flag at hl: the id from
// CharGridFromUnlockFlagsTable if set, else CHAR_NONE. Sets wCharGridBuilt.
export function buildCharGridFromUnlockFlags(P, hl) {
  wr(P, "charGridBuilt", 1);
  for (let c = 0; c < GRID_ENTRIES; c++) {
    w8(P, entryAddr(P, c), u8(P, hl + c) ? byte(P, idx(CharGridFromUnlockFlagsTable, c)) : CHAR_NONE);
  }
}
// FillCharGridPaletteIndices (38:5BB7): each entry's byte 1 = its character's palette (GetCharPaletteIndex) + 1
export function fillCharGridPaletteIndices(P) {
  for (let c = 0; c < GRID_ENTRIES; c++) {
    const at = entryAddr(P, c);
    w8(P, at + 1, rom(P, FAR.GetCharPaletteIndex, { a: u8(P, at), bc: c, hl: at }).a + 1);
  }
}
// Move an entry (4 bytes) from `from` to the empty one at `to`, leaving `from` empty ($FF, 0, 0, 0)
function moveEntry(P, from, to) {
  for (let i = 0; i < GRID_ENTRY_SIZE; i++) { w8(P, to + i, u8(P, from + i)); w8(P, from + i, i ? 0 : 0xFF); }
}
// The compaction both routines share: for each of `count` entries from `start`, an empty one takes the next entry
// after it that is neither empty nor a created character (ids 0-3) -- searching `count - k` entries ahead, and
// taking the entry it stops on when none is found. Returns hl as the ROM leaves it.
function compactEntries(P, start, count) {
  let hl = start;
  for (let c = 0; c < count; c++) {
    if (u8(P, hl) !== 0xFF) { hl = (hl + GRID_ENTRY_SIZE) & 0xFFFF; continue; }
    const empty = hl;
    for (let b = (count - c) & 0xFF; ;) {
      hl = (hl + GRID_ENTRY_SIZE) & 0xFFFF;
      const a = u8(P, hl);
      if (a >= NUM_CREATED_CHAR_IDS && a !== 0xFF) break;
      b = (b - 1) & 0xFF;
      if (!b) break;
    }
    moveEntry(P, hl, empty);
    hl = (empty + GRID_ENTRY_SIZE) & 0xFFFF;
  }
  return hl;
}
// CompactRosterGridEntries (38:60EC): close the gaps among the 22 entries from entry 9 (the roster characters move
// up, the created characters stay), then 12 bytes of $FF after them.
export function compactRosterGridEntries(P) {
  let hl = compactEntries(P, entryAddr(P, ROSTER_FIRST_ENTRY), ROSTER_ENTRIES);
  for (let i = 0; i < 12; i++) { w8(P, hl, 0xFF); hl = (hl + 1) & 0xFFFF; }
}
// CompactMarioCastGridEntries (38:6146): the same for the Mario cast (entries 0-7)
export function compactMarioCastGridEntries(P) { compactEntries(P, P.A.charGridEntries, MARIO_CAST_ENTRIES); }
// CountCharGridEntries (38:6192): wCharGridEntryCount = the used entries among the 22 from entry 9;
// wCharGridCreatedCount = the used ones among entries 0-8
export function countCharGridEntries(P) {
  let n = 0;
  for (let c = 0; c < ROSTER_ENTRIES; c++) if (u8(P, entryAddr(P, ROSTER_FIRST_ENTRY + c)) !== 0xFF) n++;
  wr(P, "charGridEntryCount", n);
  n = 0;
  for (let c = 0; c < 9; c++) if (u8(P, entryAddr(P, c)) !== 0xFF) n++;
  wr(P, "charGridCreatedCount", n);
}
// SetCharGridPageCount (38:61CB): wCharGridPageCount from CharGridPageCountTable by wCharGridEntryCount
export function setCharGridPageCount(P) {
  wr(P, "charGridPageCount", byte(P, idx(CharGridPageCountTable, rd(P, "charGridEntryCount"))));
}

// ---- character classes ----
// IsMarioCastCharacter (38:6208): whether character c is one of the Mario cast ($17-$1F): a = 1 or 0 (Z)
export function isMarioCastCharacter(c) {
  if (c < FIRST_MARIO_CAST || c > LAST_MARIO_CAST) return { a: 0, f: FZ };
  return { a: 1, f: cpFlags(c, LAST_MARIO_CAST + 1) };
}
// IsCreatedCharId (38:6013): whether id a is a created character (0-3): a = 1 with the flags of `cp $04`, or a = 0
// with those of `xor a` (Z)
export const isCreatedCharId = a => (a < NUM_CREATED_CHAR_IDS ? { a: 1, f: cpFlags(a, NUM_CREATED_CHAR_IDS) } : { a: 0, f: FZ });
// NeedsCpuDifficultyPrompt (38:61F7): a Mario-cast character picked for a slot other than 1P asks for a CPU
// difficulty: a = 1, else 0 (Z)
export function needsCpuDifficultyPrompt(P, c) {
  if (!isMarioCastCharacter(c).a || !rd(P, "charSelectSlot")) return { a: 0, f: FZ };
  return { a: 1, f: 0 };
}

// ---- a confirmed selection ----
// ResolveSelectedCharIds (38:5E6E): wCharSelectSlotChars (grid entry numbers) become character ids: the entry's
// id, or for a created character its record index | $80 (empty slots, $FF, stay).
export function resolveSelectedCharIds(P) {
  withWram(P, WRAM_SCREEN, () => {
    let hl = P.A.charSelectSlotChars;
    for (let c = 0; c < 4; c++, hl = (hl + 1) & 0xFFFF) {
      let a = u8(P, hl);
      if (a !== 0xFF) {
        const entry = entryAddr(P, a);
        a = u8(P, entry);
        if (a < NUM_CREATED_CHAR_IDS) a = u8(P, entry + 3) | 0x80;
      }
      w8(P, hl, a);
    }
  });
}
// InitMatchCharsFromSelection (38:5EA6): the four match records ($CA00 + 64 * slot) from the selected ids: a
// created character ($80 | record index) first has its story file's names put back at $C900 (from the cache
// CacheStorySlotNames filled), then InitCa00RecordFromCharId with b = the id & $81.
export function initMatchCharsFromSelection(P) {
  withWram(P, WRAM_SCREEN, () => {
    cacheStorySlotNames(P);
    for (let slot = 0; slot < 4; slot++) {
      const a = rd(P, "charSelectSlotChars", slot);
      if (a === CHAR_NONE) continue;
      if (a >= 0x80) loadCachedStorySlotName(P, (a & 7) >> 1);
      rom(P, FAR.InitCa00RecordFromCharId, { a: a >= 0x80 ? a & 0x81 : a, b: a >= 0x80 ? a & 0x81 : a, c: slot });
    }
  });
}
// The records the CPU difficulty is written to, per slot (1: 1P's partner, 2: the opponent, 3: its partner)
const AI_RECORDS = [
  null,
  ["player1PartnerAiParams", "exhibitionModePlayerPartnerCharacterDifficulty", "player1CurrentPartnerCharacter", "player1PartnerExpTier"],
  ["player2MainAiParams", "exhibitionModeCPUMainCharacterDifficulty", "player2CurrentMainCharacter", "player2MainExpTier"],
  ["player2PartnerAiParams", "exhibitionModeCPUPartnerCharacterDifficulty", "player2CurrentPartnerCharacter", "player2PartnerExpTier"],
];
// ApplyCpuDifficultyToCharRecords (38:5F4C): for the three CPU slots, the difficulty's record (CpuDifficultyParamPtrs_38
// by wCharSelectSlotDifficulty: 0 unset (= intense), 1-4 easy..intense): 4 AI parameters, the difficulty byte, and
// the EXP tier unless the character is a created one.
export function applyCpuDifficultyToCharRecords(P) {
  withWram(P, WRAM_SCREEN, () => {
    for (let slot = 1; slot < 4; slot++) {
      const [params, difficulty, character, tier] = AI_RECORDS[slot];
      let hl = word(P, idx(CpuDifficultyParamPtrs_38, rd(P, "charSelectSlotDifficulty", slot) * 2));
      for (let i = 0; i < 4; i++) wr(P, params, u8(P, hl++), i);
      wr(P, difficulty, u8(P, hl++));
      if (!isCreatedCharId(rd(P, character)).a) wr(P, tier, u8(P, hl));
    }
  });
}
// ApplyHandednessToCharRecords (38:601C): each match record not already left-handed takes the slot's choice
const LEFT_HANDED = ["player1MainLeftHanded", "player1PartnerLeftHanded", "player2MainLeftHanded", "player2PartnerLeftHanded"];
export function applyHandednessToCharRecords(P) {
  withWram(P, WRAM_SCREEN, () => {
    LEFT_HANDED.forEach((name, i) => { if (!rd(P, name)) wr(P, name, rd(P, "charSelectSlotLeftHanded", i)); });
  });
}
// CacheStorySlotNames (38:605B): the first 128 bytes of each story file's records ($C900: main and partner, with
// their names) into WRAM 1 at $D000/$D100/$D200, each file loaded with CheckStorySlot; then no story file
// (STORYSLOT_NONE), the story state reset and the default match settings.
export function cacheStorySlotNames(P) {
  withWram(P, WRAM_STAGING, () => {
    for (let slot = 0; slot < STORY_FILES; slot++) {
      wr(P, "currentStorySlot", slot);
      far(P, BANK_SAVE, () => checkStorySlot(P));
      copyMemoryFast(P, wStoryModeNameOfMainCharacter, wDecompBuffer + slot * 0x100, 8);
    }
  });
  wr(P, "currentStorySlot", STORYSLOT_NONE);
  rom(P, FAR.InitStoryModeState);
  rom(P, FAR.InitDefaultMatchSettings);
}
// LoadCachedStorySlotName (38:60B9): story file b's cached records back to $C900. All registers kept.
export function loadCachedStorySlotName(P, file) {
  withWram(P, WRAM_STAGING, () => copyMemoryFast(P, word(P, idx(CachedStorySlotNameTable, file * 2)), wStoryModeNameOfMainCharacter, 8));
}

export const HOOKS = [
  [BANK, 0x5C47, hook(P => advanceToNextPlayerSlot(P))],
  [BANK, 0x5C63, hook(P => retreatToPreviousPlayerSlot(P))],
  [BANK, 0x5CB7, hook(P => getGridSlotFromCursor(P))],
  [BANK, 0x5CE5, hook(P => buildVisiblePageSpriteList(P))],
  [BANK, 0x5D25, hook((P, c) => ({ a: testAndSetGridEntryTaken(P, c.c, c.d, c.e, 0) }))],
  [BANK, 0x5D42, hook((P, c) => ({ a: testAndSetGridEntryTaken(P, c.c, c.d, c.e, 1) }))],
  [BANK, 0x5D60, hook((P, c) => getGridEntryTakenPtr(P, c.c, c.d, c.e))],
  [BANK, 0x5D83, hook(P => buildCreatedCharRecords(P))],
  [BANK, 0x5E6E, hook(P => resolveSelectedCharIds(P))],
  [BANK, 0x5EA6, hook(P => initMatchCharsFromSelection(P))],
  [BANK, 0x5F4C, hook(P => applyCpuDifficultyToCharRecords(P))],
  [BANK, 0x6013, hook((P, c) => isCreatedCharId(c.a))],
  [BANK, 0x601C, hook(P => applyHandednessToCharRecords(P))],
  [BANK, 0x605B, hook(P => cacheStorySlotNames(P))],
  [BANK, 0x60B9, hook((P, c) => loadCachedStorySlotName(P, c.b))],
  [BANK, 0x60EC, hook(P => compactRosterGridEntries(P))],
  [BANK, 0x6146, hook(P => compactMarioCastGridEntries(P))],
  [BANK, 0x6192, hook(P => countCharGridEntries(P))],
  [BANK, 0x61CB, hook(P => setCharGridPageCount(P))],
  [BANK, 0x61F7, hook((P, c) => needsCpuDifficultyPrompt(P, c.c))],
  [BANK, 0x6208, hook((P, c) => isMarioCastCharacter(c.c))],
  [BANK, 0x5A82, hook(P => buildCharUnlockFlags(P))],
  [BANK, 0x5B43, hook((P, c) => buildCharGridFromUnlockFlags(P, c.hl))],
  [BANK, 0x5BB7, hook(P => fillCharGridPaletteIndices(P))],
  [BANK, 0x5BD9, hook(P => addCreatedCharsToCharGrid(P))],
];
