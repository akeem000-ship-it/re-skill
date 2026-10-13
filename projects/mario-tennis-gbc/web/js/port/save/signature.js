// The save header (bank 3, $47E9-$4AFE): the signature, the master checksum and the bank-1 mirror; checking the
// save at power-on (ValidateSaveRam), wiping it, and writing a block (WriteSaveBlock).
// Port of signature_03.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm).
// The save format is in defs.js.
// Tests: web/tests/port/routines_save.mjs (every routine; good, damaged and blank saves); the power-on check of a
// blank save and the story saves are in out/port/story1.mtrec, of a good save (power-on with a story file, loaded,
// saved, erased) in out/port/save1.mtrec, saves from a mid-game state in out/engine/rec2.mtrec.
import {
  SRAM_BASE, NUM_SRAM_BANKS, SRAM_BANK_SIZE, sSaveHeader, sSaveSignature, sSaveMasterChecksum, sSaveFlags,
  SAVE_HEADER_CHUNK, SAVE_HEADER_CHUNKS, CHECKSUM_START, CHECKSUM_END, SAVEDIR_VALID, SAVEDIR_CHECKSUM, SAVEDIR_TAG,
  wTextBuffer, FZ, FN, FH, orFlags, enableSram, disableSram, selectSramBank, dirEntry, blockPlace, byteSum, hook,
} from "./defs.js";
import { initSaveHeader } from "./saveheader.js";
import { initAllMinigameRecordBlocks } from "./saveslots.js";
import { copyMemoryFast } from "../home/memory.js";

export const SaveSignature = 0x47E9;       // (bank 3) "CAMELOTGBTENNIS\0"
const SAVE_FLAGS_SIZE = 0x20;
const HEADER_COPY_SIZE = sSaveFlags - sSaveHeader;   // UpdateSaveHeaderChecksum mirrors $A000-$A03F only

// WipeAllSaveRam (03:47F9): zero all four SRAM banks (SRAM enabled by the caller). Leaves bank 3 mapped and
// a = e = 4, bc = 0, hl = $C000, the flags of the last `cp $04`.
export function wipeAllSaveRam(P) {
  for (let bank = 0; bank < NUM_SRAM_BANKS; bank++) {
    selectSramBank(P, bank);
    for (let i = 0; i < SRAM_BANK_SIZE; i++) P.bus.w8(SRAM_BASE + i, 0);
  }
  return { a: NUM_SRAM_BANKS, e: NUM_SRAM_BANKS, bc: 0, hl: SRAM_BASE + SRAM_BANK_SIZE, f: FZ | FN };
}

// Unused_03_ClearSaveFlagsArea (03:4825): zero the 32 bytes of save flags (bank 0). Nothing calls it.
// Leaves a = c = 0, hl past the flags, the flags of the last `dec c`.
export function unusedClearSaveFlagsArea(P) {
  selectSramBank(P, 0);
  for (let i = 0; i < SAVE_FLAGS_SIZE; i++) P.bus.w8(sSaveFlags + i, 0);
  return { a: 0, c: 0, hl: sSaveFlags + SAVE_FLAGS_SIZE, f: FZ | FN };
}

// SumSaveHeaderRegion (03:4844): the master checksum of the save as it is (bank 0 mapped): returns hl
export function sumSaveHeaderRegion(P) {
  selectSramBank(P, 0);
  return byteSum(P, CHECKSUM_START, CHECKSUM_END - CHECKSUM_START);
}
const storeMasterChecksum = (P, sum) => { P.bus.w8(sSaveMasterChecksum, sum); P.bus.w8(sSaveMasterChecksum + 1, sum >> 8); };

// UpdateSaveHeaderChecksum (03:4866), after a save flag changes: store the master checksum and mirror the first
// $40 bytes (signature, checksum, version; not the flags) to bank 1, through a buffer on the stack (here a JS
// array: the stack page is scratch). Bank 0 left mapped; every register kept.
export function updateSaveHeaderChecksum(P) {
  const { bus } = P;
  storeMasterChecksum(P, sumSaveHeaderRegion(P));
  const copy = [];
  for (let i = 0; i < HEADER_COPY_SIZE; i++) copy.push(bus.u8(sSaveHeader + i));
  selectSramBank(P, 1);
  copy.forEach((v, i) => bus.w8(sSaveHeader + i, v));
  selectSramBank(P, 0);
}

// MirrorSaveHeaderToBank1 (03:48A1), after every block write: store the master checksum and copy the whole header
// ($A000-$A7FF: flags and directory too) to bank 1, in four chunks through wTextBuffer (left holding the last).
// Bank 0 left mapped; every register kept.
export function mirrorSaveHeaderToBank1(P) {
  storeMasterChecksum(P, sumSaveHeaderRegion(P));
  for (let k = 0; k < SAVE_HEADER_CHUNKS; k++) {
    const chunk = sSaveHeader + k * SAVE_HEADER_CHUNK;
    copyMemoryFast(P, chunk, wTextBuffer, SAVE_HEADER_CHUNK / 16);
    selectSramBank(P, 1);
    copyMemoryFast(P, wTextBuffer, chunk, SAVE_HEADER_CHUNK / 16);
    selectSramBank(P, 0);
  }
}

// VerifySaveHeaderChecksum (03:4945): whether the stored master checksum is right. Returns a = the high byte | the
// low byte of (stored - computed), 0 when right (Z); bc, de, hl kept.
export function verifySaveHeaderChecksum(P) {
  const computed = sumSaveHeaderRegion(P);
  const diff = (P.bus.u16(sSaveMasterChecksum) - computed) & 0xFFFF;
  return (diff >> 8) | (diff & 0xFF);
}

// CompareSaveSignature (03:4A56): compare the NUL-terminated string at de (the ROM's signature) with the bytes at hl.
// Returns 0 when equal, else 1 (with Z accordingly); de and hl kept.
export function compareSaveSignature(P, hl, de) {
  for (;;) {
    const a = P.bus.u8(de);
    if (a !== P.bus.u8(hl)) return 1;
    if (a === 0) return 0;
    de = (de + 1) & 0xFFFF; hl = (hl + 1) & 0xFFFF;
  }
}
// CopySaveSignature (03:4A69): copy the NUL-terminated string at hl to de, with its NUL; every register kept
export function copySaveSignature(P, hl, de) {
  for (;;) {
    const a = P.bus.u8(hl);
    P.bus.w8(de, a);
    if (a === 0) return;
    hl = (hl + 1) & 0xFFFF; de = (de + 1) & 0xFFFF;
  }
}

// The ROM's chunked copy of the bank-1 mirror back into bank 0 (ValidateSaveRam), through wTextBuffer
function restoreHeaderFromBank1(P) {
  for (let k = 0; k < SAVE_HEADER_CHUNKS; k++) {
    const chunk = sSaveHeader + k * SAVE_HEADER_CHUNK;
    selectSramBank(P, 1);
    copyMemoryFast(P, chunk, wTextBuffer, SAVE_HEADER_CHUNK / 16);
    selectSramBank(P, 0);
    copyMemoryFast(P, wTextBuffer, chunk, SAVE_HEADER_CHUNK / 16);
  }
}

export const SAVE_VALID = 0, SAVE_RESTORED = 1, SAVE_WIPED = 0xFF;
// ValidateSaveRam (03:495D), at power-on: check the signature and master checksum. If either is wrong, restore the
// header from the bank-1 mirror and check again; if that fails too, wipe the four banks and start a new save
// (header, mirror, minigame records). Returns a = 0 (good), 1 (restored) or $FF (new save), and the flags it
// leaves; bc, de, hl kept.
// The re-check compares the signature at $A000 instead of $A020 (docs/bugs.md): $A000 holds zeros, so it always
// fails and a damaged save is always wiped.
export function validateSaveRam(P) {
  enableSram(P);
  selectSramBank(P, 0);
  let result;
  if (compareSaveSignature(P, sSaveSignature, SaveSignature) === 0 && verifySaveHeaderChecksum(P) === 0) {
    result = { a: SAVE_VALID, f: FZ };
  } else {
    restoreHeaderFromBank1(P);
    if (compareSaveSignature(P, sSaveHeader, SaveSignature) === 0 && verifySaveHeaderChecksum(P) === 0) {
      result = { a: SAVE_RESTORED, f: FZ };
    } else {
      const wiped = wipeAllSaveRam(P);
      initSaveHeader(P);
      mirrorSaveHeaderToBank1(P);
      initAllMinigameRecordBlocks(P);
      result = { a: SAVE_WIPED, f: wiped.f };            // (the flags of WipeAllSaveRam's last compare)
    }
  }
  disableSram(P);
  return result;
}

// EraseAndInitSaveRam (03:4A3C): wipe all SRAM and write a new header and its mirror. Leaves a = 0 (Z) and
// WipeAllSaveRam's bc, e, hl.
export function eraseAndInitSaveRam(P) {
  enableSram(P);
  selectSramBank(P, 0);
  const { bc, e, hl } = wipeAllSaveRam(P);
  initSaveHeader(P);
  mirrorSaveHeaderToBank1(P);
  disableSram(P);
  return { a: 0, f: FZ, bc, e, hl };
}

// GetSaveBlockDirEntry (03:4A79): bc = the directory entry of block a. Its flags: those of `add hl, bc` (N, C
// clear; H from bit 11), Z as it was.
export function getSaveBlockDirEntry(id) { return dirEntry(id); }
const dirEntryFlags = (id, f) => (f & FZ) | ((((id << 4) & 0xFFF) + (dirEntry(0) & 0xFFF)) > 0xFFF ? FH : 0);

// WriteSaveBlock (03:4A89): save `length` bytes from src (hl) as block `id` (b), with the tag `tag` (de; the
// callers pass 0, or wTextBuffer for a backup). Rewrites the header first (InitSaveHeader), copies the data, sums
// it (from the source again), marks the entry valid with its checksum and tag, and mirrors the header to bank 1.
// Returns 0 (a, with Z): it cannot fail. bc, de, hl kept; SRAM left disabled with bank 0 mapped.
export function writeSaveBlock(P, id, src, tag) {
  const { bus } = P;
  enableSram(P);
  selectSramBank(P, 0);
  initSaveHeader(P);
  const entry = dirEntry(id), { bank, addr, length } = blockPlace(P, entry);
  selectSramBank(P, bank);
  for (let n = length || 0x10000, s = src, d = addr; n > 0; n--) {
    bus.w8(d, bus.u8(s));
    s = (s + 1) & 0xFFFF; d = (d + 1) & 0xFFFF;
  }
  const sum = byteSum(P, src, length);
  selectSramBank(P, 0);
  bus.w8(entry + SAVEDIR_VALID, 1);
  bus.w8(entry + SAVEDIR_CHECKSUM, sum); bus.w8(entry + SAVEDIR_CHECKSUM + 1, sum >> 8);
  bus.w8(entry + SAVEDIR_TAG, tag >> 8); bus.w8(entry + SAVEDIR_TAG + 1, tag);
  mirrorSaveHeaderToBank1(P);
  disableSram(P);
  return 0;
}

export const HOOKS = [
  [3, 0x47F9, hook(P => wipeAllSaveRam(P))],
  [3, 0x4825, hook(P => unusedClearSaveFlagsArea(P))],
  [3, 0x4844, hook(P => ({ hl: sumSaveHeaderRegion(P) }))],
  [3, 0x4866, P => { updateSaveHeaderChecksum(P); }],
  [3, 0x48A1, P => { mirrorSaveHeaderToBank1(P); }],
  [3, 0x4945, hook(P => { const a = verifySaveHeaderChecksum(P); return { a, f: orFlags(a) }; })],
  [3, 0x495D, hook(P => validateSaveRam(P))],
  [3, 0x4A3C, hook(P => eraseAndInitSaveRam(P))],
  [3, 0x4A56, hook((P, c) => { const a = compareSaveSignature(P, c.hl, c.de); return { a, f: orFlags(a) }; })],
  [3, 0x4A69, (P, c) => { copySaveSignature(P, c.hl, c.de); }],
  [3, 0x4A79, (P, c) => { c.f = dirEntryFlags(c.a, c.f); c.bc = getSaveBlockDirEntry(c.a); }],
  [3, 0x4A89, hook((P, c) => ({ a: writeSaveBlock(P, c.b, c.hl, c.de), f: FZ }))],
];
