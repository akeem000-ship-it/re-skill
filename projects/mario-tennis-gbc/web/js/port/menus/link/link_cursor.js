// Bank $38: more of the link character select: the partner's slot moved back, a grid entry marked taken by
// character id, the link match's characters set up from the slots chosen (InitLinkMatchCharsFromSelection), the
// partner's cursor (wMenuCursor2X/Y and hLinkCursorPage) turned into a grid slot and the command our pad sends
// (UpdateMenuCursorFromLinkInput), and an unused CPU-difficulty debug loop for link doubles.
// Port of src/engine/menus/link/link_cursor_38.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own; tables are read from the ROM.
// Tests: web/tests/port/routines_menus_misc.mjs (from character-select states, the link modes, slots and cursors
// forced). The link character select needs a link partner, which the emulator does not have: no lockstep covers
// these, and the debug loop (it never returns) is unverified.
import {
  FZ, FN, FAR, HOME, rom, romWait, homeWait, home, near, wram, rd, wr, u8, w8, idx, ixF, cpFlags, sound, queueCopy,
  hook, hookGen, nop, regs8, getRegs, WRAM_SCREEN, TILEMAP_WIDTH, vBGMap0, wShadowTilemap, PADF_A, PADF_B,
  SFX_MENU_CANCEL,
} from "../equipment/defs.js";
import { RemotePlayerSlotLists_38, isP2Mode } from "./remote.js";

export const BANK = 0x38;
const rb = (P, a) => P.rom.u8(BANK, a & 0xFFFF), rw = (P, a) => P.rom.u16(BANK, a & 0xFFFF);
const GRID_ENTRY_SIZE = 4, ENTRY_TAKEN = 2, GRID_ENTRIES = 0x1F, FIRST_SELECTABLE_ID = 4;
const CHARSELECTMODE_LINK_SINGLES_P1 = 0x02, CHARSELECTMODE_LINK_SINGLES_P2 = 0x03;
const CHAR_NONE = 0xFF, CHAR_STORY_MAIN = 0x80, STORY_ID_MASK = 0x81;
const LINK_DIFFICULTIES = 4, ALL_DIRECTIONS = 0x0F, PAD_DIRECTIONS = 0xF0, GRID_COLUMNS = 3;
// the commands UpdateMenuCursorFromLinkInput leaves in b
const CMD_RESET = 0x20, CMD_SELECT = 0x21, CMD_NOTHING = 0x22, CMD_CANCEL = 0x23, CMD_SELECT_LEFT_HANDED = 0x28;
const HANDED_LEFT = 1;
// bank $38's character-select routines (menus/char_select), by address
const DrawCharGridSlotPrompt = 0x5424, ClearPlayerSlotPortrait = 0x55AB, DrawPlayerSlotPortrait = 0x5612;
const GetGridSlotFromCursor = 0x5CB7, BuildVisiblePageSpriteList = 0x5CE5, CacheStorySlotNames = 0x605B;
const LoadCachedStorySlotName = 0x60B9, IsMarioCastCharacter = 0x6208, CloseCpuDifficultyPanel = 0x62C8;
const HandleCpuDifficultyInput = 0x630F, DrawCpuDifficultyCursorBox = 0x633B, OpenCpuDifficultyPanel = 0x636D;
const QueueCpuDifficultyPanelToVram = 0x6396;
const MoveLinkCursorUp = 0x6D0B, MoveLinkCursorDown = 0x6D25, MoveLinkCursorRight = 0x6D58, MoveLinkCursorLeft = 0x6D77;
const InitCa00RecordFromCharId = [0x02, 0x4066];
const JumpSoftReset = 0x285D;

// RetreatRemotePlayerSlot (38:6A09): the partner's slot back to the one before it in the mode's slot list
export function retreatRemotePlayerSlot(P) {
  let hl = rw(P, idx(RemotePlayerSlotLists_38, rd(P, "charSelectMode") * 2));
  const b = rd(P, "charSelectRemoteSlot");
  while (rb(P, hl) !== b) hl = (hl + 1) & 0xFFFF;
  hl = (hl - 1) & 0xFFFF;                                         // (one past it, then back two)
  const a = rb(P, hl);
  wr(P, "charSelectRemoteSlot", a);
  return { a, b, hl, f: FZ | FN };
}
// Unused_38_GetGridEntryAtCursor (38:6A3C): a = the character id of the grid entry under our cursor. Nothing calls it.
export function unusedGetGridEntryAtCursor(P) {
  const slot = near(P, GetGridSlotFromCursor);
  const { hl, f } = ixF(P.A.charGridEntries, slot.a * GRID_ENTRY_SIZE);
  return { ...regs8(slot), a: u8(P, hl), hl, f };
}
// SetGridEntryTakenByCharId (38:6A4B): the grid entry of character d marked taken (e != 0) or free (e = 0). Returns
// a = 1 when done, $FF when it was taken already, $FE when no entry has it, 0 for ids below 4 (no entry)
export function setGridEntryTakenByCharId(P, id, value) {
  if (id < FIRST_SELECTABLE_ID) return { a: 0, f: FZ };
  let hl = P.A.charGridEntries;
  for (let c = 0; ; ) {
    if (u8(P, hl) === id) {
      hl = (hl + ENTRY_TAKEN) & 0xFFFF;
      if (!value) { w8(P, hl, value); return { a: 1, c, hl, f: FZ }; }
      if (u8(P, hl)) return { a: 0xFF, c, hl, f: 0 };
      w8(P, hl, 1);
      return { a: 1, c, hl, f: FZ };
    }
    hl = (hl + GRID_ENTRY_SIZE) & 0xFFFF;
    c++;
    if (c === GRID_ENTRIES) return { a: 0xFE, c, hl, f: FZ | FN };
  }
}
// InitLinkMatchCharsFromSelection (38:6A7F): the match's character records (InitCa00RecordFromCharId) from our two
// slots (0-1, or 2-3 as the second player): a roster id as it is, a story character ($80 + file * 2 + partner) with
// its file's name loaded first; an empty slot ($FF) skipped
export function initLinkMatchCharsFromSelection(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  near(P, CacheStorySlotNames);
  const first = isP2Mode(P) ? 2 : 0;
  for (let slot = first; slot < first + 2; slot++) {
    const id = rd(P, "charSelectSlotChars", slot);
    if (id === CHAR_NONE) continue;
    let b = id;
    if (id >= CHAR_STORY_MAIN) b = near(P, LoadCachedStorySlotName, { a: id, b: (id & 0x07) >> 1, c: id }).a & STORY_ID_MASK;
    rom(P, InitCa00RecordFromCharId, { b, c: slot });
  }
  wram(P, bank);
  return { a: bank, f: entryF };
}
// Unused_38_LinkCpuDifficultyDebugLoop (38:6B32): a debug loop for link doubles (it never returns; nothing calls
// it): each link frame the partner's pad drives the CPU-difficulty submenu and wLinkCpuDifficulty (both shown as
// debug numbers); all four directions at once soft-reset. Singles modes return at once.
export function* unusedLinkCpuDifficultyDebugLoop(P) {
  const mode = rd(P, "charSelectMode");
  if (mode === CHARSELECTMODE_LINK_SINGLES_P2 || mode === CHARSELECTMODE_LINK_SINGLES_P1) return { a: mode, f: FZ | FN };
  wr(P, "linkCpuDifficulty", 0);
  wr(P, "cpuDifficultyCursor", 0);
  for (;;) {
    yield* romWait(P, FAR.RunLinkInputFrame);
    P.V.menuInputPressed = P.V.linkRemoteInputBuf;
    if (!(P.V.menuInputPressed ^ ALL_DIRECTIONS)) yield* homeWait(P, JumpSoftReset);
    home(P, HOME.PrintDecimalByte, { a: rd(P, "linkCpuDifficulty"), de: 0x0303 });
    home(P, HOME.PrintDecimalByte, { a: rd(P, "cpuDifficultyCursor"), de: 0x0304 });
    unusedRunLinkCpuDifficultySubmenu(P);
    unusedHandleLinkCpuDifficultyInput(P);
  }
}
// the difficulty one step down or up, wrapping over 0-3 (the ROM's `add a / jr nc` test: carry means below 0)
function stepDifficulty(v) {
  v &= 0xFF;
  if (v & 0x80) return { a: LINK_DIFFICULTIES - 1, f: FN | 0x10 };   // (`ld a, 4 / dec a`, the carry kept)
  return v < LINK_DIFFICULTIES ? { a: v, f: cpFlags(v, LINK_DIFFICULTIES) } : { a: 0, f: FZ };
}
// Unused_38_HandleLinkCpuDifficultyInput (38:6B79): the partner's left / right step wLinkCpuDifficulty; A and B
// call the two stubs below
export function unusedHandleLinkCpuDifficultyInput(P, entryF = P.cpu.f) {
  const input = P.V.linkRemoteInput, d = rd(P, "linkCpuDifficulty");
  const bitF = bit => (input & bit ? 0 : FZ) | 0x20 | (entryF & 0x10);
  let r;
  if (input & 0x20) r = stepDifficulty(d - 1);
  else if (input & 0x10) r = stepDifficulty(d + 1);
  else if (input & PADF_A) return { a: input, f: bitF(PADF_A) };
  else if (input & PADF_B) return { a: input, f: bitF(PADF_B) };
  else return { a: input, f: bitF(PADF_B) };
  wr(P, "linkCpuDifficulty", r.a);
  return r;
}
// Unused_38_CheckMarioCastEquipCategory (38:6BC2): a = 1 for a Mario-cast character c in slot 1 or 3, else 0.
// Nothing calls it.
export function unusedCheckMarioCastEquipCategory(P, ch) {
  const cast = near(P, IsMarioCastCharacter, { c: ch });
  if (!cast.a) return { ...regs8(cast), a: 0, f: FZ };
  const slot = rd(P, "charSelectSlot");
  if (!slot || slot === 2) return { ...regs8(cast), a: 0, f: FZ };
  return { ...regs8(cast), a: 1, f: cpFlags(slot, 2) };
}
// Unused_38_RunLinkCpuDifficultySubmenu (38:6BD7): a frame of the CPU-difficulty panel (opened the first time): its
// input and cursor box; A draws the slot's portrait (with its difficulty), B closes the panel and empties the box;
// then the slot prompt is redrawn
export function unusedRunLinkCpuDifficultySubmenu(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  let r = getRegs(P.cpu);
  if (!rd(P, "cpuDifficultyPanelOpen")) {
    r = near(P, OpenCpuDifficultyPanel, r);
    r = near(P, QueueCpuDifficultyPanelToVram, regs8(r));
    wr(P, "cpuDifficultyPanelOpen", 1);
  }
  r = near(P, HandleCpuDifficultyInput, regs8(r));
  r = near(P, DrawCpuDifficultyCursorBox, regs8(r));
  const input = P.V.menuInputPressed;
  if (input & (PADF_A | PADF_B)) {
    if (input & PADF_A) {
      r = near(P, GetGridSlotFromCursor, { ...regs8(r), a: rd(P, "cpuDifficultyCursor"), hl: P.A.charSelectSlotDifficulty });
      r = near(P, DrawPlayerSlotPortrait, regs8(r));
    } else {
      r = near(P, CloseCpuDifficultyPanel, regs8(r));
      sound(P, SFX_MENU_CANCEL);
      wram(P, WRAM_SCREEN);
      r = near(P, ClearPlayerSlotPortrait, { ...regs8(r), a: WRAM_SCREEN });
      r = near(P, BuildVisiblePageSpriteList, regs8(r));
    }
    near(P, DrawCharGridSlotPrompt, regs8(r));
    r = queueCopy(P, wShadowTilemap + 2 * TILEMAP_WIDTH, vBGMap0 + 2 * TILEMAP_WIDTH, 2 * TILEMAP_WIDTH / 16);
  }
  wram(P, bank);
  return { ...regs8(r), a: bank, f: entryF };
}
// GetGridSlotFromLinkCursor (38:6C37): a = b = the grid slot under the partner's cursor (x + 3y, + 3 per page);
// leaves d = x, e = 3y
export function getGridSlotFromLinkCursor(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  const d = P.V.menuCursor2X, e = (P.V.menuCursor2Y * GRID_COLUMNS) & 0xFF;
  let b = (d + e) & 0xFF;
  for (let c = P.V.linkCursorPage; c; c--) b = (b + GRID_COLUMNS) & 0xFF;
  wram(P, bank);
  return { a: b, b, c: 0, d, e, f: entryF };
}
// GetLinkCursorSelectionCode (38:6C64): a = the character id under the partner's cursor, or $22 (nothing) for an
// empty or taken entry
export function getLinkCursorSelectionCode(P) {
  const slot = getGridSlotFromLinkCursor(P);
  const at = ixF(P.A.charGridEntries, slot.a * GRID_ENTRY_SIZE), id = u8(P, at.hl);
  if (id === 0xFF) return { ...slot, a: CMD_NOTHING, hl: at.hl, f: FZ | FN };
  const taken = u8(P, at.hl + ENTRY_TAKEN);
  return { ...slot, a: taken ? CMD_NOTHING : id, b: taken, c: id, hl: at.hl, f: taken ? 0 : FZ };
}
// UpdateMenuCursorFromLinkInput (38:6C8A): our pad (a) as the command for the partner (in b): all four directions
// $20 (reset), A $21 (or $28 picking a Mario-cast character left-handed), B $23; a direction moves the cursor
// (MoveLinkCursor*) and the command is the character now under it. Returns a = 1 if the cursor "moved".
// (The ROM compares the new cursor with d and e as GetLinkCursorSelectionCode leaves them, x and 3y of the new
// cursor: so it reports a move whenever the new row is not 0.)
export function updateMenuCursorFromLinkInput(P, input, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  let r = { ...getRegs(P.cpu), b: input, d: P.V.menuCursor2X, e: P.V.menuCursor2Y };
  const send = b => { wram(P, bank); return { ...regs8(r), b, a: 0, f: FZ }; };
  if (!(input ^ ALL_DIRECTIONS)) return send(CMD_RESET);
  if (!(input & PAD_DIRECTIONS)) {
    if (input & PADF_A) return send(rd(P, "charGridHandedness") === HANDED_LEFT ? CMD_SELECT_LEFT_HANDED : CMD_SELECT);
    if (input & PADF_B) return send(CMD_CANCEL);
  }
  const move = input & 0x10 ? MoveLinkCursorRight : input & 0x20 ? MoveLinkCursorLeft : input & 0x40 ? MoveLinkCursorUp
    : input & 0x80 ? MoveLinkCursorDown : 0;
  if (move) r = near(P, move, { ...regs8(r), a: input });
  const code = getLinkCursorSelectionCode(P);
  r = { ...regs8(r), ...code, b: code.a };
  const moved = P.V.menuCursor2X !== code.d || P.V.menuCursor2Y !== code.e;
  wram(P, bank);
  return { ...regs8(r), a: moved ? 1 : 0, f: moved ? entryF : FZ };     // (pop_wram_bank: the flags at the call)
}

export const HOOKS = [
  [BANK, 0x6A09, hook(P => retreatRemotePlayerSlot(P))],
  [BANK, 0x6A3C, hook(P => unusedGetGridEntryAtCursor(P))],
  [BANK, 0x6A4B, hook((P, c) => setGridEntryTakenByCharId(P, c.d, c.e))],
  [BANK, 0x6A7F, hook((P, c) => initLinkMatchCharsFromSelection(P, c.f))],
  [BANK, 0x6B32, hookGen(P => unusedLinkCpuDifficultyDebugLoop(P))],
  [BANK, 0x6B79, hook((P, c) => unusedHandleLinkCpuDifficultyInput(P, c.f))],
  [BANK, 0x6BC0, nop],                                              // Unused_38_StubNop_38_0
  [BANK, 0x6BC1, nop],                                              // Unused_38_StubNop_38_1
  [BANK, 0x6BC2, hook((P, c) => unusedCheckMarioCastEquipCategory(P, c.c))],
  [BANK, 0x6BD7, hook((P, c) => unusedRunLinkCpuDifficultySubmenu(P, c.f))],
  [BANK, 0x6C37, hook((P, c) => getGridSlotFromLinkCursor(P, c.f))],
  [BANK, 0x6C64, hook(P => getLinkCursorSelectionCode(P))],
  [BANK, 0x6C8A, hook((P, c) => updateMenuCursorFromLinkInput(P, c.a, c.f))],
];
