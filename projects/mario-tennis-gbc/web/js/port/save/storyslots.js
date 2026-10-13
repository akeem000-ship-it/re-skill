// Save blocks and save flags (bank 3, $4AFF-$4E12): reading, verifying and invalidating a block, the story file's
// save and check, and the 256 global save flags.
// Port of storyslots_03.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm).
// The save format is in defs.js.
// Tests: web/tests/port/routines_save.mjs (every routine: valid, absent, corrupt and mismatching blocks, every
// story slot); the story saves in out/port/story1.mtrec, out/port/save1.mtrec and out/engine/rec2.mtrec.
import {
  SAVEDIR_VALID, SAVEDIR_CHECKSUM, SAVEDIR_TAG, SAVEDIR_TAG_SIZE, SAVEBLOCK_BACKUP, SAVEBLOCK_EXHIBITION,
  SAVEBLOCK_EXHIBITION_BACKUP, NUM_STORY_SLOTS, sSaveFlags, wStorySlotData, wTextBuffer,
  SAVE_OK, SAVE_BAD_CHECKSUM, SAVE_NO_BLOCK, SAVE_MISMATCH, FZ, FH, orFlags, cpFlags, spAddFlags,
  enableSram, disableSram, selectSramBank, dirEntry, blockPlace, byteSum, hook,
} from "./defs.js";
import { initSaveHeader } from "./saveheader.js";
import { mirrorSaveHeaderToBank1, updateSaveHeaderChecksum, writeSaveBlock, unusedClearSaveFlagsArea } from "./signature.js";
import { eraseStorySlotSaveData, ERASE_ENTRIES_ONLY } from "./saveslots.js";
import { updateUnlockablesSaveBlock } from "./repair.js";
import { saveGameTimer } from "../home/flags.js";

const SaveFlagMaskTable = 0x4D7E;          // (bank 3) $80 $40 ... $01: the mask of bit 0-7

// The flags ReadSaveBlock / VerifySaveBlock leave with their result: Z for 0 and for "no block" (the `or a` that
// found the entry invalid), clear for a bad checksum.
const blockResultFlags = a => (a === SAVE_BAD_CHECKSUM ? 0 : FZ);

// Unused_03_InvalidateStorySlot (03:4AFF): invalidate story file `slot`'s two blocks (2 * slot and 2 * slot + 1).
// Returns a = 0, or $FF for a slot past 2 (with the flags of `cp $03`). Nothing calls it but the debug editor's
// unreachable delete. bc, de, hl kept.
export function unusedInvalidateStorySlot(P, slot) {
  if (slot >= NUM_STORY_SLOTS) return { a: 0xFF, f: cpFlags(slot, NUM_STORY_SLOTS) };
  const block = (slot << 1) & 0xFF;
  if (invalidateSaveBlock(P, block) !== 0) return { a: 0xFF, f: 0 };     // (cannot happen: it returns 0)
  invalidateSaveBlock(P, block + 1);
  return { a: 0, f: FZ };
}

// InvalidateSaveBlock (03:4B1C): mark block `id` (b) unused: valid flag, checksum and tag cleared. Rewrites the
// header and its mirror. Returns 0 (Z); bc, de, hl kept.
export function invalidateSaveBlock(P, id) {
  const { bus } = P;
  enableSram(P);
  selectSramBank(P, 0);
  initSaveHeader(P);
  const entry = dirEntry(id);
  bus.w8(entry + SAVEDIR_VALID, 0);
  bus.w8(entry + SAVEDIR_CHECKSUM, 0); bus.w8(entry + SAVEDIR_CHECKSUM + 1, 0);
  for (let i = 0; i < SAVEDIR_TAG_SIZE; i++) bus.w8(entry + SAVEDIR_TAG + i, 0);
  mirrorSaveHeaderToBank1(P);
  disableSram(P);
  return 0;
}

// Unused_03_ResetAllSaveBlocks (03:4B54): forget every story file (their entries), the exhibition image, and all
// save flags. Nothing calls it. Leaves wCurrentStorySlot = 0, a = 0 (Z), b = $37, c = 0, hl = $A060.
export function unusedResetAllSaveBlocks(P) {
  for (let slot = 0; slot < NUM_STORY_SLOTS; slot++) {
    P.V.currentStorySlot = slot;
    eraseStorySlotSaveData(P, ERASE_ENTRIES_ONLY);
  }
  P.V.currentStorySlot = 0;
  invalidateSaveBlock(P, SAVEBLOCK_EXHIBITION);
  invalidateSaveBlock(P, SAVEBLOCK_EXHIBITION_BACKUP);
  enableSram(P);
  selectSramBank(P, 0);
  const { c, hl } = unusedClearSaveFlagsArea(P);
  initSaveHeader(P);
  mirrorSaveHeaderToBank1(P);
  disableSram(P);
  return { a: 0, f: FZ, b: SAVEBLOCK_EXHIBITION_BACKUP, c, hl };
}

// ReadSaveBlock (03:4B9B): read block `id` (b) into dst (hl) and check its checksum (summed from dst). Returns
// SAVE_OK, SAVE_BAD_CHECKSUM (the data is read all the same) or SAVE_NO_BLOCK (the entry is not valid; nothing
// read). bc, de, hl kept; SRAM left disabled with bank 0 mapped.
export function readSaveBlock(P, id, dst) {
  const { bus } = P;
  enableSram(P);
  selectSramBank(P, 0);
  const entry = dirEntry(id);
  let result = SAVE_NO_BLOCK;
  if (bus.u8(entry + SAVEDIR_VALID)) {
    const { bank, addr, length } = blockPlace(P, entry);
    selectSramBank(P, bank);
    for (let n = length || 0x10000, s = addr, d = dst; n > 0; n--) {
      bus.w8(d, bus.u8(s));
      s = (s + 1) & 0xFFFF; d = (d + 1) & 0xFFFF;
    }
    const sum = byteSum(P, dst, length);
    selectSramBank(P, 0);
    result = bus.u16(entry + SAVEDIR_CHECKSUM) === sum ? SAVE_OK : SAVE_BAD_CHECKSUM;
  }
  disableSram(P);
  return result;
}

// VerifySaveBlock (03:4C14): after a write, compare block `id` (b) with the data at src (hl) and check its checksum
// (summed from SRAM). Returns SAVE_OK, SAVE_MISMATCH (a byte differs: stops there), SAVE_BAD_CHECKSUM or
// SAVE_NO_BLOCK. bc, de, hl kept; SRAM left disabled with bank 0 mapped.
export function verifySaveBlock(P, id, src) {
  const { bus } = P;
  enableSram(P);
  selectSramBank(P, 0);
  const entry = dirEntry(id);
  let result = SAVE_NO_BLOCK;
  if (bus.u8(entry + SAVEDIR_VALID)) {
    const { bank, addr, length } = blockPlace(P, entry);
    selectSramBank(P, bank);
    result = SAVE_OK;
    for (let n = length || 0x10000, d = addr, s = src; n > 0; n--) {
      if (bus.u8(d) !== bus.u8(s)) { result = SAVE_MISMATCH; break; }
      s = (s + 1) & 0xFFFF; d = (d + 1) & 0xFFFF;
    }
    if (result === SAVE_OK) {
      const sum = byteSum(P, addr, length);
      selectSramBank(P, 0);
      if (bus.u16(entry + SAVEDIR_CHECKSUM) !== sum) result = SAVE_BAD_CHECKSUM;
    } else selectSramBank(P, 0);
  }
  disableSram(P);
  return result;
}
// its flags: a mismatch leaves those of the `add sp, 6` that drops its three saved words (sp: at the call, the
// return address on top; the routine is 12 bytes deeper there)
const verifyFlags = (a, sp) => (a === SAVE_MISMATCH ? spAddFlags((sp - 12) & 0xFFFF, 6) : blockResultFlags(a));

// ReadSaveBlockTag (03:4C9E): copy `size` bytes of block `id`'s tag field to dst (hl). Returns 0, or SAVE_NO_BLOCK
// for an invalid entry (Z either way); bc, de, hl kept. The source's low byte is entry + 8 without carry into the
// high byte (it cannot carry: entries are 16-aligned).
export function readSaveBlockTag(P, id, dst, size = SAVEDIR_TAG_SIZE) {
  const { bus } = P;
  enableSram(P);
  selectSramBank(P, 0);
  const entry = dirEntry(id);
  let result = SAVE_NO_BLOCK;
  if (bus.u8(entry + SAVEDIR_VALID)) {
    let src = (entry & 0xFF00) | ((entry + SAVEDIR_TAG) & 0xFF);
    for (let i = 0; i < size; i++) { bus.w8(dst, bus.u8(src)); dst = (dst + 1) & 0xFFFF; src = (src + 1) & 0xFFFF; }
    result = 0;
  }
  disableSram(P);
  return result;
}

// SaveStorySlot (03:4D08) / SaveStorySlotWithTimer (03:4D10): save the story file (wCurrentStorySlot 0-2): the
// image of $C800-$CAFF to block 2 * slot, then its backup (tag wTextBuffer), each verified; then the unlockables
// (UpdateUnlockablesSaveBlock). The timer version first keeps the play time (SaveGameTimer). For a slot past 2
// (exhibition, link, minigames) nothing is saved: a = the slot with the flags of `cp $03`. Otherwise returns
// a = 0, or the failed verify's result (flags of `or a`), and leaves b = the last block, hl = $C800, de = its tag.
export function saveStorySlot(P, { withTimer = false } = {}) {
  const slot = P.V.currentStorySlot;
  if (slot >= NUM_STORY_SLOTS) return { a: slot, f: cpFlags(slot, NUM_STORY_SLOTS) };
  if (withTimer) saveGameTimer(P);
  const primary = (slot << 1) & 0xFF, backup = (primary + SAVEBLOCK_BACKUP) & 0xFF;
  for (const [block, tag] of [[primary, 0], [backup, wTextBuffer]]) {
    const regs = { b: block, hl: wStorySlotData, de: tag };
    let a = writeSaveBlock(P, block, wStorySlotData, tag);
    if (a) return { ...regs, a, f: 0 };
    a = verifySaveBlock(P, block, wStorySlotData);
    if (a) return { ...regs, a, f: 0 };
  }
  updateUnlockablesSaveBlock(P);
  return { a: 0, f: FZ, b: backup, hl: wStorySlotData, de: wTextBuffer };
}
// (the ROM has `pop_wram_bank / ld a, $ff / ret` after SaveStorySlot's last `ret` at 03:4D5C: unreachable)

// CheckStorySlot (03:4D64): read the story file (wCurrentStorySlot) into $C800 and check it. Returns
// ReadSaveBlock's result, or SAVE_NO_BLOCK for a slot past 2 (with the flags of `cp $03`); bc, de, hl kept.
export function checkStorySlot(P) {
  const slot = P.V.currentStorySlot;
  if (slot >= NUM_STORY_SLOTS) return { a: SAVE_NO_BLOCK, f: cpFlags(slot, NUM_STORY_SLOTS) };
  const a = readSaveBlock(P, (slot << 1) & 0xFF, wStorySlotData);
  return { a, f: blockResultFlags(a) };
}

// ---- the save flags: de = (byte << 8) | (bit << 5), mask $80 >> bit ----
// The mask comes from SaveFlagMaskTable indexed by e rotated left 3 times (for a well-formed id, the bit),
// through the ROM bank mapped (bank 3); the byte is sSaveFlags + d.
function saveFlagMask(P, id) {
  const e = id & 0xFF, index = ((e << 3) | (e >> 5)) & 0xFF;
  return P.bus.u8(SaveFlagMaskTable + index);
}
const saveFlagByte = id => (sSaveFlags + (id >> 8)) & 0xFFFF;

// TestSaveFlag (03:4D86): whether save flag `id` (de) is set. Returns the ROM's result, the flags of `and`
// (Z when clear, H); a, bc, de, hl kept. SRAM left disabled with bank 0 mapped.
export function testSaveFlag(P, id) {
  enableSram(P);
  selectSramBank(P, 0);
  const mask = saveFlagMask(P, id), set = (mask & P.bus.u8(saveFlagByte(id))) !== 0;
  disableSram(P);
  return set;
}
// SetSaveFlag (03:4DB6) / ClearSaveFlag (03:4DE4): set or clear save flag `id` (de) and update the master checksum
// (UpdateSaveHeaderChecksum). af, bc, hl kept; de left = (0, the byte index).
export function setSaveFlag(P, id) { changeSaveFlag(P, id, (v, mask) => v | mask); }
export function clearSaveFlag(P, id) { changeSaveFlag(P, id, (v, mask) => v & ~mask); }
function changeSaveFlag(P, id, op) {
  enableSram(P);
  selectSramBank(P, 0);
  const mask = saveFlagMask(P, id), at = saveFlagByte(id);
  P.bus.w8(at, op(P.bus.u8(at), mask));
  updateSaveHeaderChecksum(P);
  disableSram(P);
}

const verifyHook = (P, c) => { const a = verifySaveBlock(P, c.b, c.hl); return { a, f: verifyFlags(a, c.sp) }; };
export const HOOKS = [
  [3, 0x4AFF, hook((P, c) => unusedInvalidateStorySlot(P, c.b))],
  [3, 0x4B1C, hook((P, c) => ({ a: invalidateSaveBlock(P, c.b), f: FZ }))],
  [3, 0x4B54, hook(P => unusedResetAllSaveBlocks(P))],
  [3, 0x4B9B, hook((P, c) => { const a = readSaveBlock(P, c.b, c.hl); return { a, f: blockResultFlags(a) }; })],
  [3, 0x4C14, hook(verifyHook)],
  [3, 0x4C9E, hook((P, c) => ({ a: readSaveBlockTag(P, c.b, c.hl), f: FZ }))],
  [3, 0x4CD3, hook((P, c) => ({ a: readSaveBlockTag(P, c.b, c.hl, 2), f: FZ }))],   // Unused_03_ReadSaveBlockTagWord
  [3, 0x4D08, hook(P => saveStorySlot(P))],
  [3, 0x4D10, hook(P => saveStorySlot(P, { withTimer: true }))],
  [3, 0x4D64, hook(P => checkStorySlot(P))],
  [3, 0x4D86, hook((P, c) => ({ f: testSaveFlag(P, c.de) ? FH : FZ | FH }))],
  [3, 0x4DB6, hook((P, c) => { const de = c.de; setSaveFlag(P, de); return { d: 0, e: de >> 8 }; })],
  [3, 0x4DE4, hook((P, c) => { const de = c.de; clearSaveFlag(P, de); return { d: 0, e: de >> 8 }; })],
];
