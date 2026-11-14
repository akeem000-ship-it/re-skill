// InitSaveHeader (03:404A): the save header's fixed part, rewritten before every block write — the signature, the
// format version and the place (bank, offset, length) of each of the 113 blocks in the directory. The valid flag,
// checksum and tag of each entry are left alone.
// Port of saveheader_03.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm);
// the block names are its SAVEBLOCK_* constants and docs/save_format.md.
// Tests: web/tests/port/routines_save.mjs ("Save InitSaveHeader"); reached on every block write in out/port/story1.mtrec
// and out/port/save1.mtrec.
import { sSaveSignature, sSaveFormatVersion, SAVE_FORMAT_VERSION, SAVEDIR_BANK, dirEntry, selectSramBank } from "./defs.js";
import { copySaveSignature, SaveSignature } from "./signature.js";

// The directory's layout: [first block, count, SRAM bank, offset of the first from $A000, length]; consecutive
// blocks of a run follow each other in SRAM. Only blocks 0, 2, 4 (story files), 6, 11, 27-37 (backups of 0-10),
// 54-62 (exhibition, minigame records, star grid) are ever written; the rest is reserved space, banks 4-14 beyond
// the cartridge's 32 KB (MBC5 would alias them to banks 0-3).
const DIRECTORY_LAYOUT = [
  // bank 0: the primary blocks
  [0x00, 1, 0, 0x0800, 0x0300],    // SAVEBLOCK_SLOT0: story file 0, the image of $C800-$CAFF
  [0x01, 1, 0, 0x0B00, 0x0200],    // SAVEBLOCK_SLOT0_EXTRA (never written)
  [0x02, 1, 0, 0x0D00, 0x0300],    // SAVEBLOCK_SLOT1
  [0x03, 1, 0, 0x1000, 0x0200],    // SAVEBLOCK_SLOT1_EXTRA
  [0x04, 1, 0, 0x1200, 0x0300],    // SAVEBLOCK_SLOT2
  [0x05, 1, 0, 0x1500, 0x0200],    // SAVEBLOCK_SLOT2_EXTRA
  [0x06, 1, 0, 0x1700, 0x0030],    // SAVEBLOCK_PRESERVED
  [0x07, 3, 0, 0x1730, 0x0020],    // SAVEBLOCK_SPARE7-9 (only unreachable code uses them)
  [0x0A, 1, 0, 0x1790, 0x0010],    // SAVEBLOCK_SPARE10
  [0x0B, 1, 0, 0x1800, 0x0200],    // SAVEBLOCK_N64_RECORDS
  [0x0C, 4, 0, 0x1A00, 0x0020],    // 12-15: never written
  [0x10, 11, 0, 0x1A80, 0x0080],   // 16-26
  // bank 1: the backups of blocks 0-10 (+ SAVEBLOCK_BACKUP), at the same offsets
  [0x1B, 1, 1, 0x0800, 0x0300],
  [0x1C, 1, 1, 0x0B00, 0x0200],
  [0x1D, 1, 1, 0x0D00, 0x0300],
  [0x1E, 1, 1, 0x1000, 0x0200],
  [0x1F, 1, 1, 0x1200, 0x0300],
  [0x20, 1, 1, 0x1500, 0x0200],
  [0x21, 1, 1, 0x1700, 0x0030],
  [0x22, 3, 1, 0x1730, 0x0020],
  [0x25, 1, 1, 0x1790, 0x0010],
  [0x26, 16, 1, 0x1800, 0x0080],   // 38-53: never written
  // bank 2
  [0x36, 2, 2, 0x0000, 0x0300],    // SAVEBLOCK_EXHIBITION and its backup
  [0x38, 6, 2, 0x0600, 0x0020],    // SAVEBLOCK_MINIGAME_RECORDS: story slots 0-2, then their backups
  [0x3E, 1, 2, 0x06C0, 0x0060],    // SAVEBLOCK_STAR_GRID
  [0x3F, 1, 2, 0x0720, 0x0DA0],    // 63-73: never written
  [0x40, 1, 2, 0x14C0, 0x06C0],
  [0x41, 9, 2, 0x1B80, 0x0080],
  // bank 3 and beyond: never written
  [0x4A, 5, 3, 0x0000, 0x0100],
  [0x4F, 1, 3, 0x0500, 0x0200],
  [0x50, 5, 3, 0x0700, 0x0100],
  [0x55, 2, 3, 0x0C00, 0x0200],
  [0x57, 1, 3, 0x1000, 0x0500],
  [0x58, 5, 4, 0x0000, 0x0100],
  [0x5D, 1, 4, 0x0500, 0x0200],
  [0x5E, 4, 4, 0x0700, 0x0500],
  [0x62, 1, 5, 0x0000, 0x1500],
  [0x63, 5, 5, 0x1500, 0x0200],
];
const WHOLE_BANK_BLOCKS = [0x68, 9, 6, 0x1E00];   // 104-112: one block of $1E00 at offset 0 of each bank 6-14

// InitSaveHeader (03:404A). Maps SRAM bank 0 (the caller has enabled SRAM); every register kept.
export function initSaveHeader(P) {
  const { bus } = P;
  selectSramBank(P, 0);
  copySaveSignature(P, SaveSignature, sSaveSignature);
  // each entry: bank, offset (word), length (word), written byte by byte from SAVEDIR_BANK
  const place = (id, bank, offset, length) => {
    const at = dirEntry(id) + SAVEDIR_BANK;
    bus.w8(at, bank); bus.w16(at + 1, offset); bus.w16(at + 3, length);
  };
  for (const [first, count, bank, offset, length] of DIRECTORY_LAYOUT)
    for (let i = 0; i < count; i++) place(first + i, bank, offset + i * length, length);
  const [first, count, bank0, length] = WHOLE_BANK_BLOCKS;
  for (let i = 0; i < count; i++) place(first + i, bank0 + i, 0, length);
  bus.w8(sSaveFormatVersion, SAVE_FORMAT_VERSION);
}

export const HOOKS = [
  [3, 0x404A, P => { initSaveHeader(P); }],
];
