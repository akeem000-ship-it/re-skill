// Erasing story files, the exhibition image, and the minigame records (bank 3, $4E13-$5228).
// Port of saveslots_03.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm).
// The save format is in defs.js.
//
// Minigame records: 11 words. Records 0-1 belong to the story file (block $38 + wCurrentStorySlot), records 2-10
// are global (they live in block $38, story slot 0's). A record's value goes in and out through
// wMinigameRecordValue (WRAM 7), the block through wMinigameRecordBlock (WRAM 7). Each block has a backup at + 3.
// Tests: web/tests/port/routines_save.mjs (every routine, every slot, with valid, absent and corrupt blocks); the
// new save's records in out/port/story1.mtrec, the exhibition image in out/port/debug1.mtrec.
import {
  SAVEDIR_VALID, SAVEDIR_CHECKSUM, SAVEDIR_TAG, SAVEDIR_TAG_SIZE, SAVEBLOCK_BACKUP, SAVEBLOCK_PRESERVED,
  SAVEBLOCK_N64_RECORDS, SAVEBLOCK_EXHIBITION, SAVEBLOCK_EXHIBITION_BACKUP, SAVEBLOCK_MINIGAME_RECORDS,
  MINIGAME_RECORD_BACKUP, NUM_STORY_SLOTS, WRAM_STAGING, WRAM_SOUND, wStorySlotData, wTextBuffer, wDecompBuffer,
  wMinigameRecordBlock, wMinigameRecordValue, SAVE_NO_BLOCK, FZ, FN, cpFlags, enableSram, disableSram,
  selectSramBank, dirEntry, blockPlace, hook, fillMemory16, getDefaultMinigameRecordValue,
} from "./defs.js";
import { initSaveHeader } from "./saveheader.js";
import { mirrorSaveHeaderToBank1, writeSaveBlock, eraseAndInitSaveRam } from "./signature.js";
import { readSaveBlock, verifySaveBlock, clearSaveFlag } from "./storyslots.js";
import { readBlock6, writeBlock6WithBackup } from "./repair.js";

const NUM_MINIGAME_RECORDS = 11;
const FIRST_GLOBAL_RECORD = 2;             // records 0-1 are the story file's
const MINIGAME_RECORD_BLOCK_SIZE = 0x20;
// the story-file save flags EraseStorySlotSaveData clears, per slot: SAVEFLAG_STORY_SLOTn_A and _B
const STORY_SLOT_FLAGS = [[0x0400, 0x0480], [0x0420, 0x04A0], [0x0440, 0x04C0]];

// EraseStorySlotSaveData (03:4E13) modes (a): 0 forgets the blocks (directory entries only), else zeroes their data
export const ERASE_ENTRIES_ONLY = 0;
// Erase story file wCurrentStorySlot: blocks 2 * slot and 2 * slot + 1 and their backups, its minigame records
// 0-1 (back to the defaults) and its two save flags. Returns a = 0 (Z), or 1 for a slot past 2 (flags of
// `cp $03`; SRAM is left enabled then). bc, de, hl kept.
export function eraseStorySlotSaveData(P, mode) {
  enableSram(P);
  initSaveHeader(P);
  const slot = P.V.currentStorySlot;
  if (slot >= NUM_STORY_SLOTS) return { a: 1, f: cpFlags(slot, NUM_STORY_SLOTS) };
  const block = (slot << 1) & 0xFF;
  for (const b of [block, block + 1, block + SAVEBLOCK_BACKUP, block + SAVEBLOCK_BACKUP + 1]) clearSaveBlock(P, b, mode);
  mirrorSaveHeaderToBank1(P);
  disableSram(P);
  initCurrentSlotMinigameRecords(P);
  for (const flag of STORY_SLOT_FLAGS[slot]) clearSaveFlag(P, flag);   // (farcall ClearSaveFlag: the same bank)
  return { a: 0, f: FZ };
}

// ClearSaveBlock (03:4E90): block `id` (b) forgotten (mode h = 0) or zeroed. Returns a = 0 and the flags it leaves.
export function clearSaveBlock(P, id, mode) {
  if (mode === 0) return clearSaveBlockEntry(P, id);
  return clearSaveBlockData(P, id);
}

// ClearSaveBlockData (03:4E9D): zero block `id`'s data and mark its entry valid, checksum 0 (right for zeros), tag 0.
// Reads the directory as it is (no InitSaveHeader) and does not enable SRAM. Returns a = 0 (Z); bc, de, hl kept.
// offset: Unused_03_EraseSaveBlock's 8 (the same clear starting 8 bytes into the block, as long).
export function clearSaveBlockData(P, id, offset = 0) {
  const { bus } = P;
  selectSramBank(P, 0);
  const entry = dirEntry(id), { bank, addr, length } = blockPlace(P, entry);
  selectSramBank(P, bank);
  for (let n = length || 0x10000, d = (addr + offset) & 0xFFFF; n > 0; n--) { bus.w8(d, 0); d = (d + 1) & 0xFFFF; }
  selectSramBank(P, 0);
  bus.w8(entry + SAVEDIR_VALID, 1);
  bus.w8(entry + SAVEDIR_CHECKSUM, 0); bus.w8(entry + SAVEDIR_CHECKSUM + 1, 0);
  for (let i = 0; i < SAVEDIR_TAG_SIZE; i++) bus.w8(entry + SAVEDIR_TAG + i, 0);
  return { a: 0, f: FZ };
}
// Unused_03_EraseSaveBlock (03:4EF7): ClearSaveBlockData from 8 bytes into the block. Nothing calls it.
export const unusedEraseSaveBlock = (P, id) => clearSaveBlockData(P, id, 8);

// ClearSaveBlockEntry (03:4F57): forget block `id`: valid flag, checksum and tag cleared (SRAM enabled by the
// caller). Returns a = 0 with the flags of its last `dec c`; bc, de, hl kept.
export function clearSaveBlockEntry(P, id) {
  const { bus } = P;
  selectSramBank(P, 0);
  const entry = dirEntry(id);
  bus.w8(entry + SAVEDIR_VALID, 0);
  bus.w8(entry + SAVEDIR_CHECKSUM, 0); bus.w8(entry + SAVEDIR_CHECKSUM + 1, 0);
  for (let i = 0; i < SAVEDIR_TAG_SIZE; i++) bus.w8(entry + SAVEDIR_TAG + i, 0);
  return { a: 0, f: FZ | FN };
}

// ReinitSaveRamPreservingBlock6 (03:4F7D): a new save that keeps block 6: read it into wDecompBuffer (WRAM 1), wipe
// and re-initialise SRAM, write it back with its backup unless it was absent (a bad checksum is kept as read),
// then the default minigame records. Every register kept.
export function reinitSaveRamPreservingBlock6(P) {
  P.withWramBank(WRAM_STAGING, () => {
    const read = readBlock6(P, wDecompBuffer);
    eraseAndInitSaveRam(P);
    if (read !== SAVE_NO_BLOCK) writeBlock6WithBackup(P, wDecompBuffer);
    initAllMinigameRecordBlocks(P);
  });
}

// WriteExhibitionSaveBlock (03:4FAE): save the image of $C800 (an exhibition's save-and-quit state) to block $36
// and its backup $37 (tag wTextBuffer), each verified. Returns a = 0 (Z) or the failed verify's result (flags of
// `or a`), and leaves b = the last block, hl = $C800, de = its tag.
export function writeExhibitionSaveBlock(P) {
  for (const [block, tag] of [[SAVEBLOCK_EXHIBITION, 0], [SAVEBLOCK_EXHIBITION_BACKUP, wTextBuffer]]) {
    const regs = { b: block, hl: wStorySlotData, de: tag };
    let a = writeSaveBlock(P, block, wStorySlotData, tag);
    if (a) return { ...regs, a, f: 0 };
    a = verifySaveBlock(P, block, wStorySlotData);
    if (a) return { ...regs, a, f: 0 };
  }
  return { a: 0, f: FZ, b: SAVEBLOCK_EXHIBITION_BACKUP, hl: wStorySlotData, de: wTextBuffer };
}
// (03:4FE2: `pop_wram_bank / ld a, $ff / ret` after its last `ret`, unreachable)

// ReadExhibitionSaveBlock (03:4FEA): read block $36 into $C800. Returns ReadSaveBlock's result; bc, de, hl kept.
// (ld a, $fe at 03:4FF8 is unreachable.)
export function readExhibitionSaveBlock(P) { return readSaveBlock(P, SAVEBLOCK_EXHIBITION, wStorySlotData); }

// ClearSaveBlock11 (03:4FFE): zero the N64 records block (as the directory has it). Returns a = 0 (Z); bc, de, hl kept.
export function clearSaveBlock11(P) {
  enableSram(P);
  clearSaveBlockData(P, SAVEBLOCK_N64_RECORDS);
  disableSram(P);
}

// the block of record `record`: the story file's for records 0-1, else slot 0's
const recordBlock = (P, record) => (SAVEBLOCK_MINIGAME_RECORDS + (record < FIRST_GLOBAL_RECORD ? P.V.currentStorySlot : 0)) & 0xFF;
const recordAddr = record => wMinigameRecordBlock + ((record << 1) & 0xFF);

// ReadMinigameRecord (03:5015): wMinigameRecordValue = minigame record `record` (a), read from its block (cleared
// first: an absent block gives 0). A story file's record without a story file (slot past 2) is not read. Every
// register kept.
export function readMinigameRecord(P, record) {
  P.withWramBank(WRAM_SOUND, () => {
    if (record < FIRST_GLOBAL_RECORD && P.V.currentStorySlot >= NUM_STORY_SLOTS) return;
    fillMemory16(P, wMinigameRecordBlock, 0, MINIGAME_RECORD_BLOCK_SIZE / 16);
    readSaveBlock(P, recordBlock(P, record), wMinigameRecordBlock);
    const value = P.bus.u16(recordAddr(record));
    P.bus.w8(wMinigameRecordValue, value); P.bus.w8(wMinigameRecordValue + 1, value >> 8);
  });
}

// UpdateMinigameRecord (03:5072): store wMinigameRecordValue as minigame record `record` (a): read its block,
// change the record, write and verify the block and its backup. Returns a = 0 (Z), or 1 on failure (a story
// file's record without a story file; a failed verify) with the flags as they were at the call. bc, de, hl kept.
export function updateMinigameRecord(P, record, entryF = 0) {
  return P.withWramBank(WRAM_SOUND, () => {
    const failed = { a: 1, f: entryF };
    if (record < FIRST_GLOBAL_RECORD && P.V.currentStorySlot >= NUM_STORY_SLOTS) return failed;
    fillMemory16(P, wMinigameRecordBlock, 0, MINIGAME_RECORD_BLOCK_SIZE / 16);
    const block = recordBlock(P, record);
    readSaveBlock(P, block, wMinigameRecordBlock);
    const value = P.bus.u16(wMinigameRecordValue), at = recordAddr(record);
    P.bus.w8(at, value); P.bus.w8(at + 1, value >> 8);
    for (const b of [block, block + MINIGAME_RECORD_BACKUP]) {
      if (writeSaveBlock(P, b, wMinigameRecordBlock, 0)) return failed;
      if (verifySaveBlock(P, b, wMinigameRecordBlock)) return failed;
    }
    return { a: 0, f: FZ };
  });
}

// InitCurrentSlotMinigameRecords (03:5141): records 0-1 of the story file back to their defaults, in its block and
// the backup. The slot is not checked: for wCurrentStorySlot 3 (no story file) that is block $3B (slot 0's backup)
// and $3E (the star grid). Every register kept.
export function initCurrentSlotMinigameRecords(P) {
  P.withWramBank(WRAM_SOUND, () => {
    const slot = P.V.currentStorySlot, block = (SAVEBLOCK_MINIGAME_RECORDS + slot) & 0xFF;
    readSaveBlock(P, block, wMinigameRecordBlock);
    for (let record = 0; record < FIRST_GLOBAL_RECORD; record++) P.bus.w16(recordAddr(record), getDefaultMinigameRecordValue(P, record));
    if (writeSaveBlock(P, block, wMinigameRecordBlock, 0)) return;
    writeSaveBlock(P, (block + MINIGAME_RECORD_BACKUP) & 0xFF, wMinigameRecordBlock, 0);
  });
}

// InitAllMinigameRecordBlocks (03:519A), for a new save: the three record blocks and their backups, every record
// at its default. Every register kept.
export function initAllMinigameRecordBlocks(P) {
  P.withWramBank(WRAM_SOUND, () => {
    fillMemory16(P, wMinigameRecordBlock, 0, MINIGAME_RECORD_BLOCK_SIZE / 16);
    for (let record = 0; record < NUM_MINIGAME_RECORDS; record++) P.bus.w16(recordAddr(record), getDefaultMinigameRecordValue(P, record));
    for (let slot = 0; slot < NUM_STORY_SLOTS; slot++) {
      const block = SAVEBLOCK_MINIGAME_RECORDS + slot;
      if (writeSaveBlock(P, block, wMinigameRecordBlock, 0)) return;
      writeSaveBlock(P, block + MINIGAME_RECORD_BACKUP, wMinigameRecordBlock, 0);
    }
  });
}

export const HOOKS = [
  [3, 0x4E13, hook((P, c) => eraseStorySlotSaveData(P, c.a))],
  [3, 0x4E90, hook((P, c) => clearSaveBlock(P, c.b, c.h))],
  [3, 0x4E9D, hook((P, c) => clearSaveBlockData(P, c.b))],
  [3, 0x4EF7, hook((P, c) => unusedEraseSaveBlock(P, c.b))],
  [3, 0x4F57, hook((P, c) => clearSaveBlockEntry(P, c.b))],
  [3, 0x4F7D, hook(P => { reinitSaveRamPreservingBlock6(P); })],
  [3, 0x4FAE, hook(P => writeExhibitionSaveBlock(P))],
  [3, 0x4FEA, hook(P => { const a = readExhibitionSaveBlock(P); return { a, f: a === 0xFF ? 0 : FZ }; })],
  [3, 0x4FFE, hook(P => { clearSaveBlock11(P); return { a: 0, f: FZ }; })],
  [3, 0x5015, hook((P, c) => { readMinigameRecord(P, c.a); })],
  [3, 0x5072, hook((P, c) => updateMinigameRecord(P, c.a, c.f))],
  [3, 0x5141, hook(P => { initCurrentSlotMinigameRecords(P); })],
  [3, 0x519A, hook(P => { initAllMinigameRecordBlocks(P); })],
];
