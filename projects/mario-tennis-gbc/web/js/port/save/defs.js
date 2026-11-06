// The battery save (bank 3, $404A-$5956): what the save modules share. The cartridge RAM (MBC5, 4 banks of 8 KB
// at $A000-$BFFF) is reached as the ROM reaches it: enabled by writing $0A to rRAMG ($0000-$1FFF) and disabled
// again (0) after each access, the bank selected through rRAMB ($4000-$5FFF) with its shadow hSramBank.
// Names, addresses and the save format from the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm; its docs/save_format.md describes the format in full).
//
// The save format (SRAM bank 0; bank 1 holds a mirror of $A000-$A7FF):
//   $A000-$A01F  zeros (sSaveHeader: the start of the mirrored header)
//   $A020-$A02F  signature "CAMELOTGBTENNIS\0" (sSaveSignature; the ROM's copy is SaveSignature, 03:47E9)
//   $A030-$A031  master checksum (sSaveMasterChecksum): 16-bit byte sum of $A038-$A76F
//   $A038        format version, $71 (sSaveFormatVersion)
//   $A040-$A05F  256 global save flags (sSaveFlags; only bytes 0-7 are used)
//   $A060-$A76F  block directory (sSaveBlockDirectory): 113 entries of 16 bytes, one per block of save data:
//                +0 valid (1 = in use), +1 SRAM bank, +2 offset from $A000 (word), +4 length (word),
//                +6 checksum (word: 16-bit byte sum of the data), +8 tag (the writer's de, high byte first)
//   Each block's data lies elsewhere in the four banks (saveheader.js lists them all). A block is written whole
//   from WRAM (WriteSaveBlock) and read back whole (ReadSaveBlock); the story files and most records are written
//   twice, to a primary block and a backup (block + SAVEBLOCK_BACKUP for blocks 0-10).

// ---- the cartridge (MBC5) ----
export const rRAMG = 0x0000;               // RAM enable: $0A on, anything else off
export const rRAMB = 0x4000;               // RAM bank
export const RAMG_ENABLE = 0x0A, RAMG_DISABLE = 0x00;
export const SRAM_BASE = 0xA000;
export const NUM_SRAM_BANKS = 4;           // 32 KB: header byte $149 = 3
export const SRAM_BANK_SIZE = 0x2000;

// ---- the header (SRAM bank 0) ----
export const sSaveHeader = 0xA000;
export const sSaveSignature = 0xA020;
export const sSaveMasterChecksum = 0xA030;
export const sSaveFormatVersion = 0xA038;
export const sSaveFlags = 0xA040;
export const sSaveBlockDirectory = 0xA060;
export const SAVE_FORMAT_VERSION = 0x71;
export const SAVE_HEADER_CHUNK = 0x200;    // the bank-1 mirror is copied in 4 chunks through wTextBuffer
export const SAVE_HEADER_CHUNKS = 4;       // $A000-$A7FF
export const CHECKSUM_START = sSaveFormatVersion, CHECKSUM_END = 0xA770;   // the master checksum's bytes

// ---- the block directory ----
export const SAVEDIR_ENTRY_SIZE = 16;
export const SAVEDIR_VALID = 0, SAVEDIR_BANK = 1, SAVEDIR_OFFSET = 2, SAVEDIR_LENGTH = 4, SAVEDIR_CHECKSUM = 6, SAVEDIR_TAG = 8;
export const SAVEDIR_TAG_SIZE = 8;         // the tag word and six bytes after it, cleared and copied as one field
export const SAVEBLOCK_SLOT0 = 0x00;       // story file N: block 2N (image of $C800-$CAFF), 2N + 1 (never written)
export const SAVEBLOCK_PRESERVED = 0x06;   // kept across a full re-init (ReinitSaveRamPreservingBlock6)
export const SAVEBLOCK_SPARE7 = 0x07, SAVEBLOCK_SPARE8 = 0x08, SAVEBLOCK_SPARE9 = 0x09, SAVEBLOCK_SPARE10 = 0x0A;
export const SAVEBLOCK_N64_RECORDS = 0x0B; // Transfer Pak records and the unlockable flags
export const SAVEBLOCK_BACKUP = 0x1B;      // the bank-1 backup of block n (n <= $0A) is n + $1B
export const SAVEBLOCK_EXHIBITION = 0x36, SAVEBLOCK_EXHIBITION_BACKUP = 0x37;   // the save-and-quit image of $C800
export const SAVEBLOCK_MINIGAME_RECORDS = 0x38;   // + story slot (0-2); their backups at + 3
export const MINIGAME_RECORD_BACKUP = 3;
export const SAVEBLOCK_STAR_GRID = 0x3E;   // the star characters' exhibition victory grid

// ReadSaveBlock / VerifySaveBlock / ReadSaveBlockTag results (in a)
export const SAVE_OK = 0x00, SAVE_BAD_CHECKSUM = 0xFF, SAVE_NO_BLOCK = 0xFE, SAVE_MISMATCH = 0xFD;

// ---- WRAM ----
export const WRAM_STAGING = 1;             // wDecompBuffer ($D000): the repair routines' scratch
export const WRAM_SOUND = 7;               // wMinigameRecordBlock, wSaveBlockBuffer, wMinigameRecordValue
export const NUM_STORY_SLOTS = 3;
export const wTextBuffer = 0xC600;         // the header mirror's bounce buffer, and the backup writes' tag
export const wStorySlotData = 0xC800;      // the story file's image ($C800-$CAFF)
export const wDecompBuffer = 0xD000;       // (WRAM 1)
export const wDecompBufferTag = 0xD400;    // wDecompBuffer + 64 * TILE_SIZE: where a backup's tag is read to
export const wMinigameRecordBlock = 0xD480;   // (WRAM 7) the 32-byte record block
export const wSaveBlockBuffer = 0xD500;    // (WRAM 7) the N64 records block and the debug editor's block
export const wMinigameRecordValue = 0xDE00;   // (WRAM 7) a record's value, in and out

// ---- flags (F) ----
export const FZ = 0x80, FN = 0x40, FH = 0x20, FC = 0x10;
export const orFlags = v => (v & 0xFF ? 0 : FZ);                   // `or` / `xor` / `and` (and sets H too)
export const cpFlags = (a, n) => (a === n ? FZ : 0) | FN | ((a & 0x0F) < (n & 0x0F) ? FH : 0) | (a < n ? FC : 0);
// `add sp, e` / `ld hl, sp + e`: Z and N clear, H and C from adding e to sp's low byte
export const spAddFlags = (sp, e) => (((sp & 0x0F) + (e & 0x0F)) > 0x0F ? FH : 0) | (((sp & 0xFF) + (e & 0xFF)) > 0xFF ? FC : 0);

// ---- SRAM access, as the ROM does it ----
export function enableSram(P) { P.bus.w8(rRAMG, RAMG_ENABLE); }
export function disableSram(P) { P.bus.w8(rRAMG, RAMG_DISABLE); }
// `ldh [hSramBank], a ; ld [rRAMB], a`
export function selectSramBank(P, bank) {
  P.V.sramBank = bank;
  P.bus.w8(rRAMB, bank);
}
// GetSaveBlockDirEntry's address: the directory entry of block `id` (0-255)
export const dirEntry = id => (sSaveBlockDirectory + id * SAVEDIR_ENTRY_SIZE) & 0xFFFF;
// 16-bit byte sum of `count` bytes at addr (count 0: 64 KB, as the ROM's `dec bc / or c` loops)
export function byteSum(P, addr, count) {
  let sum = 0, n = count || 0x10000;
  for (; n > 0; n--) { sum = (sum + P.bus.u8(addr)) & 0xFFFF; addr = (addr + 1) & 0xFFFF; }
  return sum;
}
// A block's place, from its directory entry (SRAM bank 0 mapped): its SRAM bank, CPU address and length
export function blockPlace(P, entry) {
  const { bus } = P;
  return { bank: bus.u8(entry + SAVEDIR_BANK), addr: (SRAM_BASE + bus.u16(entry + SAVEDIR_OFFSET)) & 0xFFFF, length: bus.u16(entry + SAVEDIR_LENGTH) };
}

// ---- hooks ----
const REGS = ["a", "f", "b", "c", "d", "e", "h", "l"];
// A hook for a routine: fn(P, cpu) returns the registers the ROM routine leaves changed ({ a, f, b, hl, ... });
// every other register is put back as it was at the call (the port's calls into the ROM change the CPU's).
export function hook(fn) {
  return (P, cpu) => {
    const saved = {};
    for (const r of REGS) saved[r] = cpu[r];
    const out = fn(P, cpu) || {};
    for (const r of REGS) cpu[r] = saved[r];
    for (const [r, v] of Object.entries(out)) {
      if (v === undefined) continue;
      if (r.length === 2) cpu[r] = v & 0xFFFF; else if (r === "f") cpu.f = v & 0xF0; else cpu[r] = v & 0xFF;
    }
  };
}
// the same for a routine that waits (fn is a generator function)
export function hookGen(fn) {
  return function* (P, cpu) {
    const saved = {};
    for (const r of REGS) saved[r] = cpu[r];
    const out = (yield* fn(P, cpu)) || {};
    for (const r of REGS) cpu[r] = saved[r];
    for (const [r, v] of Object.entries(out)) {
      if (v === undefined) continue;
      if (r.length === 2) cpu[r] = v & 0xFFFF; else if (r === "f") cpu.f = v & 0xF0; else cpu[r] = v & 0xFF;
    }
  };
}

// ---- other parts of the game, not ported yet (or not this module's): calls into the ROM ----
// FillMemory16 (03:59B1, scrolltext_03.asm): fill c blocks of 16 bytes at hl with a
export function fillMemory16(P, hl, a, blocks) { P.callRom(3, 0x59B1, { h: hl >> 8, l: hl, a, c: blocks }); }
// GetDefaultMinigameRecordValue (0D:41A6, through FarPtr_ 0D:4002): de = record a's default value
export function getDefaultMinigameRecordValue(P, record) {
  const r = P.callRom(0x0D, 0x41A6, { a: record });
  return r.de;
}
