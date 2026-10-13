// The star victory grid's block, the unreachable save-slot debug editor, and the unreachable restore/clear helpers
// of blocks 6-10 (bank 3, $5229-$5668). RestoreStoryBlockFromBackup (03:550D), in the same ROM file, is in
// repair.js with the rest of the power-on repair.
// Port of results_03.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm).
// The save format is in defs.js.
// Tests: web/tests/port/routines_save.mjs (every routine but the editor); the editor, which never returns, by the
// lockstep on out/port/save_editor.mtrec (a state with the CPU put at its entry; web/tests/port/routines_save.mjs
// says how to make it).
import {
  SAVEBLOCK_BACKUP, SAVEBLOCK_STAR_GRID, WRAM_SOUND, wSaveBlockBuffer, FZ, FH, cpFlags, hook, hookGen, fillMemory16,
} from "./defs.js";
import { writeSaveBlock } from "./signature.js";
import { readSaveBlock, invalidateSaveBlock, unusedInvalidateStorySlot } from "./storyslots.js";
import { clearMemory16 } from "../home/memory.js";

const STAR_GRID_SIZE = 0x60;
const REPAIR_BUFFER = 0xD000;              // the unused helpers' buffer: WRAM $D000 in whatever bank is mapped
const STORYSLOT_NONE = 3;

// ---- the star characters' exhibition victory grid (block $3E): read and written by bank $3B ----
// ReadMarioCastVictoryGrid (03:5229): read the grid into dst (hl); if it does not read well, clear the 96 bytes
// there instead. Every register kept.
export function readMarioCastVictoryGrid(P, dst) {
  if (readSaveBlock(P, SAVEBLOCK_STAR_GRID, dst) !== 0) fillMemory16(P, dst, 0, STAR_GRID_SIZE / 16);
}
// WriteMarioCastVictoryGrid (03:5240): write the grid from src (hl). Returns 0 (a, Z); bc, de, hl kept.
export function writeMarioCastVictoryGrid(P, src) { return writeSaveBlock(P, SAVEBLOCK_STAR_GRID, src, 0); }

// ---- the save-slot debug editor (unreachable: nothing calls or jumps to Unused_03_SaveSlotDebugEditor) ----
// A hex view of 16 rows x 4 words of WRAM 7 from $D300, a cursor moved with the d-pad (A held: the word under it
// changed by the step instead), the story slot's block read, saved or deleted (Start, Start with A), the slot
// changed with Select, B the N64 block's six flags set. hSaveEditorCursor is the byte offset from $D300 ($000-$3FF).
const SaveEditorCursorTiles = 0x52F0, SaveEditorCursorTilesEnd = 0x5310;
const StorySlotBlockIds = 0x52AF;          // the block per wCurrentStorySlot & 3: 0, 2, 4, $0B
const SaveResultFailedString = 0x54B0, SaveResultLoadedString = 0x54BC, SaveResultSavedString = 0x54C8, SaveResultDeletedString = 0x54D4;
const EDITOR_VIEW = 0xD300;                // (WRAM 7)
const EDITOR_VIEW_BLOCKS = 0x30;           // the 768 bytes cleared when the block cannot be read
const CURSOR_MASK_HIGH = 0x03;
const VIEW_ROWS = 16, VIEW_WORDS_PER_ROW = 4;
const STATUS_ROW = 0x11;                   // the status line: the result at column 5, the cursor at $10, the slot at 0
const BGM_EXHIBITION_MATCH = 0x06, SFX_MENU_MOVE = 0x5E, SFX_MENU_SELECT = 0x5F, JINGLE_DONE_FOR_THE_DAY = 0x41;
const DEBUG_STEP_MODE_EDITOR = 3;
const PAD_A = 0x01, PAD_B = 0x02, PAD_SELECT = 0x04, PAD_START = 0x08, PAD_RIGHT = 0x10, PAD_LEFT = 0x20, PAD_UP = 0x40, PAD_DOWN = 0x80;
const N64_FLAG_BYTES = 6;
const vTiles0 = 0x8000;
// steps (b: the word's change, c: the cursor's move) per direction
const CURSOR_STEPS = [[PAD_UP, 0xF0, 0xF8], [PAD_LEFT, 0xFF, 0xFF], [PAD_RIGHT, 0x01, 0x01], [PAD_DOWN, 0x10, 0x08]];

// the routines of other parts the editor uses, in the ROM for now (bank 0 unless said)
const rom = {
  queueVRAMCopy: (P, src, dest, blocks) => P.callRom(0, 0x0480, { h: src >> 8, l: src, d: dest >> 8, e: dest, c: blocks }),
  playSound: (P, id) => P.callRom(0, 0x3024, { a: id }),           // PlaySoundManaged: the `sound id` (rst $08) request
  enableLCD: P => P.callRom(0, 0x0376),
  beginFadeOut: (P, speed) => P.callRom(0, 0x1D20, { c: speed }),
  beginFadeIn: (P, speed) => P.callRom(0, 0x1D2E, { c: speed }),
  printString: (P, src, x, y) => P.callRom(0, 0x1906, { h: src >> 8, l: src, d: x, e: y }),
  printHexWord: (P, value, x, y) => P.callRom(0, 0x1ACE, { h: value >> 8, l: value, d: x, e: y }),
  printDecimalByte: (P, value, x, y) => P.callRom(0, 0x1AE4, { a: value, d: x, e: y }),
  queueSprite: (P, attr, tile, x, y) => P.callRom(0, 0x1F51, { b: attr, c: tile, d: x, e: y }),
  clearMemory16: (P, hl, blocks) => P.callRom(0, 0x03AF, { h: hl >> 8, l: hl, c: blocks }),
};

// Unused_03_MoveSaveEditorCursor (03:524F): without A held, move the cursor by c (signed; the offset wraps in
// $000-$3FF) and return Z when it stayed in the same 128-byte page (the view needs no redraw). With A held, add b
// to the byte under the cursor and redraw its word (big-endian) at its place in the view; returns Z.
// Returns the registers it leaves. (03:526D, `xor a / dec a / ret` after its first `ret`, is unreachable.)
export function unusedMoveSaveEditorCursor(P, b, c) {
  const { bus, V } = P;
  const cursor = bus.u16(P.A.saveEditorCursor);
  if (!(V.playerInputFlags & PAD_A)) {
    const e = c, d = c & 0x80 ? 0xFF : 0x00;                    // Unused_00_SignExtendEToDE
    const sum = cursor + (d << 8 | e), hl = sum & 0xFFFF;
    bus.w8(P.A.saveEditorCursor + 1, (hl >> 8) & CURSOR_MASK_HIGH);
    bus.w8(P.A.saveEditorCursor, hl);
    const a = (hl ^ cursor) & 0xFF;                            // l xor the old l: bit 7 = another 128-byte page
    return { a, b: cursor & 0xFF, d, e, hl, f: (a & 0x80 ? 0 : FZ) | FH };
  }
  rom.playSound(P, SFX_MENU_MOVE);
  const at = (cursor + EDITOR_VIEW) & 0xFFFF;
  bus.w8(at, bus.u8(at) + b);
  const wordAt = at & 0xFFFE, low = wordAt & 0xFF;
  const word = bus.u8(wordAt) << 8 | bus.u8((wordAt + 1) & 0xFFFF);
  const x = ((low & 0x06) << 1) + 4;                           // the word's column: 4 + 4 * (word in the row)
  const rowTimes2 = (low & 0x78) << 1, y = (((rowTimes2 << 4) | (rowTimes2 >> 4)) & 0xFF) + 1;   // swap: the row, + 1
  rom.printHexWord(P, word, x, y);
  return { a: 0, f: FZ, b: low, d: x, e: y, hl: word };
}

// Unused_03_GetCurrentSlotBlockId (03:529D): b = the block of wCurrentStorySlot (& 3); af, hl kept
export function unusedGetCurrentSlotBlockId(P) {
  return P.bus.u8((StorySlotBlockIds + (P.V.currentStorySlot & 3)) & 0xFFFF);
}
// Unused_03_ReadCurrentSlotBlock (03:52B3) / Unused_03_WriteCurrentSlotBlock (03:52C3, tag de) /
// Unused_03_InvalidateCurrentSlotBlock (03:52D3): that block through wSaveBlockBuffer, WRAM 7 mapped (and left
// mapped). The last passes the block id to Unused_03_InvalidateStorySlot as a slot: only slot 0's block (0) and
// slot 1's (2) are in range there, and mean story files 0 and 2. Return the registers they leave.
function currentSlotBlock(P) {
  P.wramBank(WRAM_SOUND);
  return { b: unusedGetCurrentSlotBlockId(P), hl: wSaveBlockBuffer };
}
export function unusedReadCurrentSlotBlock(P) {
  const regs = currentSlotBlock(P), a = readSaveBlock(P, regs.b, wSaveBlockBuffer);
  return { ...regs, a, f: a === 0xFF ? 0 : FZ };
}
export function unusedWriteCurrentSlotBlock(P, tag) {
  const regs = currentSlotBlock(P);
  return { ...regs, a: writeSaveBlock(P, regs.b, wSaveBlockBuffer, tag), f: FZ };
}
export function unusedInvalidateCurrentSlotBlock(P) {
  const regs = currentSlotBlock(P);
  return { ...regs, ...unusedInvalidateStorySlot(P, regs.b) };
}

// Unused_03_SaveSlotDebugEditor (03:5310): the editor's screen and loop; it never returns. de is carried through
// the loop as in the ROM: it becomes the tag of a block saved with B or Start (whatever PrintString, AdvanceFrame or
// the cursor move left in it). Start with A held (delete) jumps back with a `push de` not popped: the stack grows
// by a word each time, as in the ROM.
export function* unusedSaveSlotDebugEditor(P) {
  const { V, bus } = P;
  const cursor = () => bus.u16(P.A.saveEditorCursor);
  rom.queueVRAMCopy(P, SaveEditorCursorTiles, vTiles0, (SaveEditorCursorTilesEnd - SaveEditorCursorTiles) / 16);
  rom.playSound(P, BGM_EXHIBITION_MATCH);
  V.debugStepMode = DEBUG_STEP_MODE_EDITOR;
  V.currentStorySlot = 0;
  bus.w8(P.A.saveEditorCursor, 0); bus.w8(P.A.saveEditorCursor + 1, 0);
  yield* P.runRom(5, 0x4096);                                  // farcall InitTextWindows
  rom.enableLCD(P);
  rom.beginFadeOut(P, 127);
  rom.beginFadeIn(P, 127);                                     // script_fade_in 127
  yield* P.runRom(2, 0x421C);                                  // farcall InitStoryModeState
  let de = 0, step = "load";
  for (;;) {
    if (step === "load") {                                     // .loop: read the slot's block into the buffer
      if (unusedReadCurrentSlotBlock(P).a !== 0) {
        rom.printString(P, SaveResultFailedString, 5, STATUS_ROW);
        rom.clearMemory16(P, EDITOR_VIEW, EDITOR_VIEW_BLOCKS);
      } else de = rom.printString(P, SaveResultLoadedString, 5, STATUS_ROW).de;
      step = "view";
    }
    if (step === "view") {                                     // .loopB: the 128-byte page around the cursor
      P.wramBank(WRAM_SOUND);
      let at = (cursor() + EDITOR_VIEW) & 0xFF80;
      for (let row = 0, y = 1; row < VIEW_ROWS; row++, y++) {
        rom.printHexWord(P, (at - EDITOR_VIEW) & 0xFFFF, 0, y);   // the offset
        for (let w = 0, x = 4; w < VIEW_WORDS_PER_ROW; w++, x += 4) {
          rom.printHexWord(P, bus.u8(at) << 8 | bus.u8((at + 1) & 0xFFFF), x, y);
          at = (at + 2) & 0xFFFF;
        }
      }
      step = "status";
    }
    if (step === "status") {                                   // .loop4: the cursor and the slot
      rom.printHexWord(P, cursor(), 0x10, STATUS_ROW);
      rom.printDecimalByte(P, V.currentStorySlot, 0x00, STATUS_ROW);
    }
    // .loop5: the cursor's two sprites (blinking unless A is held), a frame, the pad
    if (V.playerInputFlags & PAD_A || V.vBlankCounter & 0x08) {
      const low = bus.u8(P.A.saveEditorCursor);
      const x = (((low & 7) << 4) + 0x24) & 0xFF, y = ((low & 0x78) + 0x0C) & 0xFF;
      rom.queueSprite(P, 0, 0, x, y);
      rom.queueSprite(P, 0, 0, (x + 8) & 0xFF, y);
    }
    const out = yield* P.runRom(0, 0x2631, { d: de >> 8, e: de });   // AdvanceFrame
    de = out.de;
    const pressed = V.inputPressed;
    const dir = CURSOR_STEPS.find(([bit]) => pressed & bit);
    if (dir) {
      const r = unusedMoveSaveEditorCursor(P, dir[1], dir[2]);
      de = r.d << 8 | r.e;
      step = r.f & FZ ? "status" : "view";
    } else if (pressed & PAD_B) {                              // the N64 block's six flags set, if it has data
      const slot = V.currentStorySlot;
      V.currentStorySlot = STORYSLOT_NONE;
      if (unusedReadCurrentSlotBlock(P).a === 0 && (bus.u8(EDITOR_VIEW) | bus.u8(EDITOR_VIEW + 1)) !== 0) {
        for (let i = 0; i < N64_FLAG_BYTES; i++) bus.w8(EDITOR_VIEW + 2 + i, 1);
        unusedWriteCurrentSlotBlock(P, de);
        rom.playSound(P, JINGLE_DONE_FOR_THE_DAY);             // (the slot stays STORYSLOT_NONE)
      } else V.currentStorySlot = slot;
      step = "load";
    } else if (pressed & PAD_SELECT) {
      rom.playSound(P, SFX_MENU_SELECT);
      V.currentStorySlot = (V.currentStorySlot + 1) & 3;
      step = "load";
    } else if (pressed & PAD_START) {
      rom.playSound(P, SFX_MENU_SELECT);
      if (!(V.playerInputFlags & PAD_A)) {
        const tag = rom.printString(P, SaveResultSavedString, 5, STATUS_ROW).de;
        unusedWriteCurrentSlotBlock(P, tag);
      } else {
        P.cpu.sp = (P.cpu.sp - 2) & 0xFFFF; bus.w16(P.cpu.sp, de);   // push de, never popped
        de = rom.printString(P, SaveResultDeletedString, 5, STATUS_ROW).de;
        unusedInvalidateCurrentSlotBlock(P);
      }
      step = "status";
    } else step = "frame";
  }
}

// ---- unreachable restore and clear helpers, on $D000 (whatever WRAM bank is mapped) ----
// Unused_03_InvalidateBlockIfUnwritten (03:553B): forget block `id` (b) if it reads with a bad checksum
export function unusedInvalidateBlockIfUnwritten(P, id) {
  const a = readSaveBlock(P, id, REPAIR_BUFFER);
  if (a !== 0xFF) return { a, f: cpFlags(a, 0xFF), hl: REPAIR_BUFFER };
  return { a: invalidateSaveBlock(P, id), f: FZ, hl: REPAIR_BUFFER };
}
// Unused_03_RestoreBlockOrClear (03:5548): if block `id` (b) reads badly, restore it from its backup; if the backup
// is bad too, write zeros ($200 bytes) over the backup instead. That path returns with the caller's bc still on
// the stack (a `push bc` too many): its `ret` jumps to the address bc. Returns the registers it leaves.
export function unusedRestoreBlockOrClear(P, id, c) {
  const a = readSaveBlock(P, id, REPAIR_BUFFER);
  if (a !== 0xFF) return { a, f: cpFlags(a, 0xFF), hl: REPAIR_BUFFER };
  const backup = (id + SAVEBLOCK_BACKUP) & 0xFF;
  if (readSaveBlock(P, backup, REPAIR_BUFFER) === 0) {
    writeSaveBlock(P, id, REPAIR_BUFFER, 0);
    return { a: 0, f: FZ, hl: REPAIR_BUFFER, de: 0 };
  }
  clearMemory16(P, REPAIR_BUFFER, 0x20);
  writeSaveBlock(P, backup, REPAIR_BUFFER, 0);
  P.cpu.sp = (P.cpu.sp - 2) & 0xFFFF;                          // the stray push bc, left for the `ret`
  P.bus.w16(P.cpu.sp, id << 8 | c);
  return { a: 0, f: FZ, b: backup, hl: REPAIR_BUFFER, de: 0 };
}
// Unused_03_RestoreBlock06FromBackup ... 0aFromBackup (03:557B-03:564C): if block `id` reads badly, restore it from
// its backup, or forget both if that is bad too
export function unusedRestoreBlockFromBackup(P, id) {
  const a = readSaveBlock(P, id, REPAIR_BUFFER);
  if (a !== 0xFF) return { a, f: cpFlags(a, 0xFF), b: id, hl: REPAIR_BUFFER };
  const backup = id + SAVEBLOCK_BACKUP;
  if (readSaveBlock(P, backup, REPAIR_BUFFER) === 0) {
    writeSaveBlock(P, id, REPAIR_BUFFER, 0);
    return { a: 0, f: FZ, b: id, hl: REPAIR_BUFFER, de: 0 };
  }
  invalidateSaveBlock(P, id);
  invalidateSaveBlock(P, backup);
  return { a: 0, f: FZ, b: backup, hl: REPAIR_BUFFER };
}
// Unused_03_ClearBlockIfSet (03:564D): if block `id` (b) does not read well, write it as zeros ($280 bytes cleared)
export function unusedClearBlockIfSet(P, id) {
  const a = readSaveBlock(P, id, REPAIR_BUFFER);
  if (a === 0) return { a, f: FZ, hl: REPAIR_BUFFER };
  clearMemory16(P, REPAIR_BUFFER, 0x28);
  writeSaveBlock(P, id, REPAIR_BUFFER, 0);
  return { a: 0, f: FZ, hl: REPAIR_BUFFER, de: 0 };
}

export const HOOKS = [
  [3, 0x5229, hook((P, c) => { readMarioCastVictoryGrid(P, c.hl); })],
  [3, 0x5240, hook((P, c) => ({ a: writeMarioCastVictoryGrid(P, c.hl), f: FZ }))],
  [3, 0x524F, hook((P, c) => unusedMoveSaveEditorCursor(P, c.b, c.c))],
  [3, 0x529D, (P, c) => { c.b = unusedGetCurrentSlotBlockId(P); }],
  [3, 0x52B3, hook(P => unusedReadCurrentSlotBlock(P))],
  [3, 0x52C3, hook((P, c) => unusedWriteCurrentSlotBlock(P, c.de))],
  [3, 0x52D3, hook(P => unusedInvalidateCurrentSlotBlock(P))],
  [3, 0x5310, hookGen(P => unusedSaveSlotDebugEditor(P))],
  [3, 0x553B, hook((P, c) => unusedInvalidateBlockIfUnwritten(P, c.b))],
  [3, 0x5548, hook((P, c) => unusedRestoreBlockOrClear(P, c.b, c.c))],
  [3, 0x557B, hook(P => unusedRestoreBlockFromBackup(P, 0x06))],
  [3, 0x55A5, hook(P => unusedRestoreBlockFromBackup(P, 0x07))],
  [3, 0x55CF, hook(P => unusedRestoreBlockFromBackup(P, 0x08))],
  [3, 0x55F9, hook(P => unusedRestoreBlockFromBackup(P, 0x09))],
  [3, 0x5623, hook(P => unusedRestoreBlockFromBackup(P, 0x0A))],
  [3, 0x564D, hook((P, c) => unusedClearBlockIfSet(P, c.b))],
];
