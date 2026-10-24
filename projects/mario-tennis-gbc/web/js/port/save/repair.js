// Repairing story files from their backups at power-on, the N64 records block and its unlockables, and the
// accessors of blocks 6-10 (bank 3, $5669-$5956).
// Port of repair_03.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm).
// The save format is in defs.js.
//
// The N64 records block ($0B): bytes +0/+1 are non-zero when an N64 Mario Tennis (Transfer Pak) wrote records
// there; bytes +2-+7 are six unlockables, set to 1 when a minigame record beats its default and a save flag is set.
// Tests: web/tests/port/routines_save.mjs (every routine; present and absent N64 data, records above and below
// their defaults); the power-on repair in out/port/story1.mtrec (blank save) and out/port/save1.mtrec (a good one),
// block 6 kept across "erase all" in out/port/save1.mtrec.
import {
  SAVEBLOCK_BACKUP, SAVEBLOCK_PRESERVED, SAVEBLOCK_SPARE7, SAVEBLOCK_SPARE8, SAVEBLOCK_SPARE9, SAVEBLOCK_SPARE10,
  SAVEBLOCK_N64_RECORDS, SAVEBLOCK_EXHIBITION, SAVEBLOCK_EXHIBITION_BACKUP, WRAM_STAGING, WRAM_SOUND,
  wDecompBuffer, wDecompBufferTag, wSaveBlockBuffer, wMinigameRecordValue, SAVE_OK, SAVE_BAD_CHECKSUM, FZ,
  cpFlags, hook, getDefaultMinigameRecordValue,
} from "./defs.js";
import { writeSaveBlock } from "./signature.js";
import { readSaveBlock, verifySaveBlock, readSaveBlockTag, invalidateSaveBlock, testSaveFlag, setSaveFlag } from "./storyslots.js";
import { readMinigameRecord } from "./saveslots.js";
import { mulHLByA } from "../home/math.js";
import { testGameFlag, flagOperand } from "../home/flags.js";

const UnlockConditionFlagRows = 0x57D9;    // (bank 3) per condition 2-10: the save flag's number
const SAVE_FLAG_ID_SCALE = 0x20;           // a save flag's id (de) is its number * $20
const FLAG_CLEARED_MACHINE_LEVEL_4 = 213, FLAG_CLEARED_WALL_LEVEL_4 = 217;   // wGameFlags
// the save flags an N64 records block grants: SAVEFLAG_N64_RECORDS_PRESENT, SAVEFLAG_UNLOCKED_FAY/CURT/MARK/SEAN
const N64_GRANTED_SAVE_FLAGS = [0x07C0, 0x0140, 0x0160, 0x0180, 0x01A0];
// the six unlockables: [unlock condition (a minigame record), its byte in the N64 records block]
const UNLOCKABLES = [[0x02, 2], [0x04, 7], [0x06, 4], [0x08, 6], [0x09, 3], [0x0A, 5]];
const N64_DATA_PRESENT = 0, UNLOCKED = 1;

// RepairAllSaveSlots (03:5669), at power-on: each story file whose block has a bad checksum is restored from its
// backup (RestoreStoryBlockFromBackup), then the exhibition image (RestoreBlock36FromBackup). Maps WRAM 1
// (wDecompBuffer, their buffer) and leaves it mapped. Returns the registers it leaves.
export function repairAllSaveSlots(P) {
  P.wramBank(WRAM_STAGING);
  let regs = {};
  for (const block of [0, 2, 4]) regs = { ...regs, ...restoreStoryBlockFromBackup(P, block) };
  return { ...regs, ...restoreBlock36FromBackup(P) };
}

// RestoreStoryBlockFromBackup (03:550D): if block `id` (b) reads with a bad checksum, read its backup (+ $1B): if
// that is good, write it back as the block (with the tag de = $D400, where the backup's tag was read to: the
// stored tag is that address), else forget the block and the next (id + 1). Reads through wDecompBuffer (hl).
// Returns the registers it leaves: a (the first read's result, flags of `cp $ff`; or 0), hl, and b or de.
export function restoreStoryBlockFromBackup(P, id) {
  const first = readSaveBlock(P, id, wDecompBuffer);
  if (first !== SAVE_BAD_CHECKSUM) return { a: first, f: cpFlags(first, 0xFF), hl: wDecompBuffer };
  const backup = (id + SAVEBLOCK_BACKUP) & 0xFF;
  if (readSaveBlock(P, backup, wDecompBuffer) !== SAVE_OK) {
    invalidateSaveBlock(P, id);
    invalidateSaveBlock(P, (id + 1) & 0xFF);
    return { a: 0, f: FZ, b: id + 1, hl: wDecompBuffer };
  }
  readSaveBlockTag(P, backup, wDecompBufferTag);
  writeSaveBlock(P, id, wDecompBuffer, wDecompBufferTag);
  return { a: 0, f: FZ, hl: wDecompBuffer, de: wDecompBufferTag };
}

// RestoreBlock36FromBackup (03:5682): the same for the exhibition image, block $36 from $37 (tag $D400 too, but no
// tag read); a bad backup forgets block $36 only. Returns the registers it leaves (b = $36, hl, a, and de).
export function restoreBlock36FromBackup(P) {
  const regs = { b: SAVEBLOCK_EXHIBITION, hl: wDecompBuffer };
  const first = readSaveBlock(P, SAVEBLOCK_EXHIBITION, wDecompBuffer);
  if (first !== SAVE_BAD_CHECKSUM) return { ...regs, a: first, f: cpFlags(first, 0xFF) };
  if (readSaveBlock(P, SAVEBLOCK_EXHIBITION_BACKUP, wDecompBuffer) !== SAVE_OK) {
    invalidateSaveBlock(P, SAVEBLOCK_EXHIBITION);
    return { ...regs, a: 0, f: FZ };
  }
  writeSaveBlock(P, SAVEBLOCK_EXHIBITION, wDecompBuffer, wDecompBufferTag);
  return { ...regs, a: 0, f: FZ, de: wDecompBufferTag };
}

// whether the N64 records block (read into wSaveBlockBuffer) holds data: its first two bytes' 8-bit sum
const n64DataPresent = P => ((P.bus.u8(wSaveBlockBuffer + N64_DATA_PRESENT) + P.bus.u8(wSaveBlockBuffer + N64_DATA_PRESENT + 1)) & 0xFF) !== 0;

// ApplyN64RecordsUnlockFlags (03:56A8), at power-on: if the N64 records block reads well and holds data, set the
// save flags it grants (the records present; Fay, Curt, Mark and Sean unlocked). Every register kept.
export function applyN64RecordsUnlockFlags(P) {
  P.withWramBank(WRAM_SOUND, () => {
    if (readSaveBlock(P, SAVEBLOCK_N64_RECORDS, wSaveBlockBuffer) !== SAVE_OK) return;
    if (!n64DataPresent(P)) return;
    for (const flag of N64_GRANTED_SAVE_FLAGS) setSaveFlag(P, flag);   // (farcall SetSaveFlag: the same bank)
  });
}

// UpdateUnlockablesSaveBlock (03:56FB), after a story save: if the N64 records block reads well and holds data,
// mark each unlockable whose condition holds (CheckUnlockCondition) and write the block back. Every register kept.
export function updateUnlockablesSaveBlock(P) {
  P.withWramBank(WRAM_SOUND, () => {
    if (readSaveBlock(P, SAVEBLOCK_N64_RECORDS, wSaveBlockBuffer) !== SAVE_OK) return;
    if (!n64DataPresent(P)) return;
    for (const [condition, at] of UNLOCKABLES)
      if (checkUnlockCondition(P, condition)) P.bus.w8(wSaveBlockBuffer + at, UNLOCKED);
    writeSaveBlock(P, SAVEBLOCK_N64_RECORDS, wSaveBlockBuffer, 0);
  });
}

// SetAllUnlockablesInSaveBlock (03:5787), from the trophy/cheat flow: mark all six unlockables in the N64 records
// block, if it reads well (whether or not it holds data). Every register kept.
export function setAllUnlockablesInSaveBlock(P) {
  P.withWramBank(WRAM_SOUND, () => {
    if (readSaveBlock(P, SAVEBLOCK_N64_RECORDS, wSaveBlockBuffer) !== SAVE_OK) return;
    for (const [, at] of UNLOCKABLES) P.bus.w8(wSaveBlockBuffer + at, UNLOCKED);
    writeSaveBlock(P, SAVEBLOCK_N64_RECORDS, wSaveBlockBuffer, 0);
  });
}

// CheckUnlockCondition (03:57E2): whether unlock condition `condition` (a) holds: its save flag
// (UnlockConditionFlagRows[condition - 2]) is set and minigame record `condition` is at least its default.
// Returns 1 or 0 (a); the flags as they were at the call; bc, de, hl kept.
// The ROM picks the kind of test with `cp $02` just after push_wram_bank has loaded a with WRAM_SOUND (7), not
// the condition: so it always takes the save-flag test, even for conditions 0 and 1 (which would test the
// "cleared Wall / Machine level 4" game flags), and those read their flag number from the bytes before the table.
export function checkUnlockCondition(P, condition) {
  return P.withWramBank(WRAM_SOUND, () => {
    const selector = WRAM_SOUND;
    if (selector < 2) {
      const flag = selector !== 0 ? FLAG_CLEARED_MACHINE_LEVEL_4 : FLAG_CLEARED_WALL_LEVEL_4;
      if (!testGameFlag(P, flagOperand(flag))) return 0;
    } else {
      const number = P.bus.u8((UnlockConditionFlagRows + ((condition - 2) & 0xFF)) & 0xFFFF);
      if (!testSaveFlag(P, mulHLByA(P, number, SAVE_FLAG_ID_SCALE).hl)) return 0;
    }
    const target = getDefaultMinigameRecordValue(P, condition);
    readMinigameRecord(P, condition);
    return P.bus.u16(wMinigameRecordValue) >= target ? 1 : 0;
  });
}

// WriteBlockNWithBackup: write block `id` from src (hl, tag 0) and verify it, then its backup (+ $1B). Returns 0 (Z)
// or $FF at the first failure; bc, de, hl kept. ReadBlockN: ReadSaveBlock of block `id` into dst; bc, de, hl kept.
// WriteBlock6WithBackup (03:5844) / ReadBlock6 (03:586F) keep block 6 across a re-init; the same pairs for blocks
// 7-10 (03:587B-03:5956) are Unused_03_*: nothing calls them.
export function writeBlockWithBackup(P, id, src) {
  for (const block of [id, id + SAVEBLOCK_BACKUP]) {
    if (writeSaveBlock(P, block, src, 0)) return 0xFF;
    if (verifySaveBlock(P, block, src)) return 0xFF;
  }
  return 0;
}
export const writeBlock6WithBackup = (P, src) => writeBlockWithBackup(P, SAVEBLOCK_PRESERVED, src);
export const readBlock6 = (P, dst) => readSaveBlock(P, SAVEBLOCK_PRESERVED, dst);

const readFlags = a => (a === SAVE_BAD_CHECKSUM ? 0 : FZ);
const blockAccessors = (id, writeAt, readAt) => [
  [3, writeAt, hook((P, c) => { const a = writeBlockWithBackup(P, id, c.hl); return { a, f: a ? 0 : FZ }; })],
  [3, readAt, hook((P, c) => { const a = readSaveBlock(P, id, c.hl); return { a, f: readFlags(a) }; })],
];
export const HOOKS = [
  [3, 0x550D, hook((P, c) => restoreStoryBlockFromBackup(P, c.b))],
  [3, 0x5669, hook(P => repairAllSaveSlots(P))],
  [3, 0x5682, hook(P => restoreBlock36FromBackup(P))],
  [3, 0x56A8, hook(P => { applyN64RecordsUnlockFlags(P); })],
  [3, 0x56FB, hook(P => { updateUnlockablesSaveBlock(P); })],
  [3, 0x5787, hook(P => { setAllUnlockablesInSaveBlock(P); })],
  [3, 0x57E2, hook((P, c) => ({ a: checkUnlockCondition(P, c.a) }))],
  ...blockAccessors(SAVEBLOCK_PRESERVED, 0x5844, 0x586F),
  ...blockAccessors(SAVEBLOCK_SPARE7, 0x587B, 0x58A6),
  ...blockAccessors(SAVEBLOCK_SPARE8, 0x58B2, 0x58DD),
  ...blockAccessors(SAVEBLOCK_SPARE9, 0x58E9, 0x5914),
  ...blockAccessors(SAVEBLOCK_SPARE10, 0x5920, 0x594B),
];
