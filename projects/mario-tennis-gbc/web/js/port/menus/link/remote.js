// Bank $38: the link character select's other side. The partner's picks and cancels (sent over the link as
// commands, menus/char_select/grid_screen.js) mark the grid entries taken and fill or empty the partner's slot boxes
// (their portraits, left-handed marks and CPU difficulty); our own A / B / START on the link grid (confirm a pick,
// cancel the last, toggle a Mario-cast character's handedness); and whether both sides have chosen.
// The partner's slots are 2-3 for the first player (link modes P1) and 0-1 for the second (P2).
// Port of src/engine/menus/link/remote_38.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own; tables are read from the ROM.
// Tests: web/tests/port/routines_menus_misc.mjs (from character-select states, the link modes and slots forced).
// The link character select needs a link partner, which the emulator does not have: no lockstep covers these.
import {
  FZ, FN, FAR, rom, near, wram, rd, wr, u8, w8, idx, ixF, cpFlags, addFlags, sound, queueCopy, fillTilemapRect,
  hook, regs8, WRAM_SCREEN, TILEMAP_WIDTH, VRAM_BANK1, vBGMap0, wShadowTilemap, wShadowAttrmap, PADF_A, PADF_B,
  PADF_START, SFX_MENU_MOVE, SFX_MENU_SELECT, SFX_MENU_CANCEL,
} from "../equipment/defs.js";
import { setGridEntryTakenByCharId, retreatRemotePlayerSlot } from "./link_cursor.js";

export const BANK = 0x38;
const rb = (P, a) => P.rom.u8(BANK, a & 0xFFFF), rw = (P, a) => P.rom.u16(BANK, a & 0xFFFF);
const RemoteSlotBoxAddrPtrs_38 = 0x69C1;
export const RemotePlayerSlotLists_38 = 0x6A27;
export const CHARSELECTMODE_LINK_SINGLES_P2 = 0x03, CHARSELECTMODE_LINK_DOUBLES_P2 = 0x05;
const SLOTS_DONE = 0x04, REMOTE_SLOTS_DONE = 0x02, SLOT_NONE = 0xFF, PREVIOUS_IS_FIRST = 0xFE;
const EXIT_LOCAL_DONE = 0x01, EXIT_ALL_CHOSEN = 0x02;           // wCharSelectExitCode
const LINK_CMD_SELECT = 0x21, LINK_CMD_SELECT_DONE = 0x22;      // hLinkRemoteInput: the partner's command
const GRID_ENTRY_SIZE = 4, ENTRY_TAKEN = 2;
const HANDED_RIGHT = 0, HANDED_LEFT = 1, HANDED_STAR = 2;        // wCharGridHandedness
const LEFT_HANDED_MARK = 0x32, LEFT_HANDED_MARK_AT = 0x1F, MARKS_AT = 0x1E, DIFFICULTY_DIGIT_0 = 0x33;
const PORTRAIT_ATTR = 0x08;
// bank $38's character-select routines (menus/char_select), by address: called with the registers as the ROM
// passes them (they are hooked JS)
const DrawCharGridSlotPrompt = 0x5424, ClearPlayerSlotPortrait = 0x55AB, DrawPlayerSlotPortrait = 0x5612;
const WriteCharPortraitTiles = 0x5712, RefreshCharInfoPanel = 0x575E, AdvanceToNextPlayerSlot = 0x5C47;
const RetreatToPreviousPlayerSlot = 0x5C63, GetGridSlotFromCursor = 0x5CB7, BuildVisiblePageSpriteList = 0x5CE5;
const TestAndSetGridEntryTaken = 0x5D42, IsMarioCastCharacter = 0x6208;
const GetCharPaletteIndex = [0x02, 0x4173];

// the partner plays the second player's slots (0-1) when we are the second player
export const isP2Mode = P => { const m = rd(P, "charSelectMode"); return m === CHARSELECTMODE_LINK_SINGLES_P2 || m === CHARSELECTMODE_LINK_DOUBLES_P2; };
// the partner's slot of the per-slot arrays (difficulty, left-handed): remote slot + 2, or + 0 as the second player
const remoteSlotOffset = P => (isP2Mode(P) ? 0 : 2);
// the grid entry of a slot (wCharGridEntries: 4 bytes an entry)
const gridEntry = (P, slot) => idx(P.A.charGridEntries, slot * GRID_ENTRY_SIZE);
// the box rows queued: the partner's boxes are on rows 6-7 (second player) or 9-10
function queueRemoteSlotRows(P) {
  const row = isP2Mode(P) ? 6 : 9;
  queueCopy(P, wShadowTilemap + row * TILEMAP_WIDTH, vBGMap0 + row * TILEMAP_WIDTH, 2 * TILEMAP_WIDTH / 16);
  return queueCopy(P, wShadowAttrmap + row * TILEMAP_WIDTH, vBGMap0 + row * TILEMAP_WIDTH + VRAM_BANK1, 2 * TILEMAP_WIDTH / 16);
}

// StoreRemoteCpuDifficulty (38:6609): the partner's CPU difficulty c into its slot's entry (slot 3, or 1)
export function storeRemoteCpuDifficulty(P, c) {
  const p2 = isP2Mode(P);
  wr(P, "charSelectSlotDifficulty", c, p2 ? 1 : 3);
  return { a: c, f: p2 ? FZ | FN : cpFlags(rd(P, "charSelectMode"), CHARSELECTMODE_LINK_DOUBLES_P2) };
}
// ApplyRemoteCharSelection (38:661E): the partner picked character c: its grid entry taken (unless it is
// already), its portrait in the partner's slot, the page's sprites rebuilt, the character noted, the slot advanced
export function applyRemoteCharSelection(P, ch, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  if (setGridEntryTakenByCharId(P, ch, 1).a !== 0xFF) {
    drawRemoteSlotPortrait(P, ch);
    near(P, BuildVisiblePageSpriteList);
    wr(P, "charSelectRemoteChars", ch, rd(P, "charSelectRemoteSlot") ? 1 : 0);
    advanceRemotePlayerSlot(P);
  }
  wram(P, bank);
  return { a: bank, f: entryF };
}
// ApplyRemoteCharCancel (38:6655): the partner cancelled its last pick: the slot back, its character's entry free,
// the slot's difficulty and handedness cleared, its box emptied and the page's sprites rebuilt
export function applyRemoteCharCancel(P) {
  const back = retreatRemotePlayerSlot(P);
  if (back.a === 0xFF) return { a: 0xFF, f: FZ | FN, hl: back.hl };          // (bc kept)
  const ch = rd(P, "charSelectRemoteChars", rd(P, "charSelectRemoteSlot") ? 1 : 0);
  setGridEntryTakenByCharId(P, ch, 0);
  wram(P, WRAM_SCREEN);
  const slot = (rd(P, "charSelectRemoteSlot") + remoteSlotOffset(P)) & 0xFF;
  wr(P, "charSelectSlotDifficulty", 0, slot);
  wr(P, "charSelectSlotLeftHanded", 0, slot);
  clearRemoteSlotPortrait(P);
  return near(P, BuildVisiblePageSpriteList);
}
// Unused_38_CopyRemoteCharsToSlots (38:66C3): the partner's two characters into its slots. Nothing calls it.
export function unusedCopyRemoteCharsToSlots(P) {
  const first = isP2Mode(P) ? 0 : 2;
  wr(P, "charSelectSlotChars", rd(P, "charSelectRemoteChars"), first);
  const a = rd(P, "charSelectRemoteChars", 1);
  wr(P, "charSelectSlotChars", a, first + 1);
  return { a, f: isP2Mode(P) ? FZ | FN : cpFlags(rd(P, "charSelectMode"), CHARSELECTMODE_LINK_DOUBLES_P2) };
}
// CheckLinkSelectionComplete (38:66E9): wCharSelectExitCode = 1 when we have filled our slots (4) and the partner
// its (2); 2 when either side's slot is $FF (all chosen)
export function checkLinkSelectionComplete(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  if (rd(P, "charSelectSlot") === SLOTS_DONE && rd(P, "charSelectRemoteSlot") === REMOTE_SLOTS_DONE) wr(P, "charSelectExitCode", EXIT_LOCAL_DONE);
  if (rd(P, "charSelectSlot") === SLOT_NONE || rd(P, "charSelectRemoteSlot") === SLOT_NONE) wr(P, "charSelectExitCode", EXIT_ALL_CHOSEN);
  wram(P, bank);
  return { a: bank, f: entryF };
}
// HandleLinkGridButtons (38:6720): with no direction pressed, A confirms the cursor's character, B cancels the
// last pick, START toggles a Mario-cast character's handedness (a star character's goes to left-handed)
export function handleLinkGridButtons(P) {
  const input = P.V.menuInputPressed;
  if (input & 0xF0) return { a: input & 0xF0, f: 0x20 };
  if (input & PADF_A) return confirmLinkGridSelection(P);
  if (input & PADF_B) return cancelLinkGridSelection(P);
  if (!(input & PADF_START)) return { a: input, f: FZ | 0x20 };
  const slot = near(P, GetGridSlotFromCursor);
  const at = gridEntry(P, slot.a), ch = u8(P, at);
  const cast = near(P, IsMarioCastCharacter, { ...regs8(slot), b: slot.a, c: ch, hl: at });
  if (!cast.a) return { ...cast, b: slot.a, c: ch, hl: at };
  sound(P, SFX_MENU_MOVE);
  const h = rd(P, "charGridHandedness"), now = h === HANDED_STAR ? HANDED_LEFT : h ^ 1;
  wr(P, "charGridHandedness", now);
  const f = h === HANDED_STAR ? FZ | FN : now ? 0 : FZ;            // (the flags of its `cp $02` or `xor $01`)
  return near(P, RefreshCharInfoPanel, { ...regs8(cast), a: now, b: slot.a, c: ch, hl: at, f });
}
// ConfirmLinkGridSelection (38:676F): our pick: refused (SFX_MENU_CANCEL) when our slots are full, when the partner
// has just sent a pick ($21, answered with $22), or when the cursor's entry is taken or empty; else the entry taken,
// the character (with its handedness) into our slot, its portrait drawn, the next slot and its prompt
export function confirmLinkGridSelection(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  const refuse = () => { sound(P, SFX_MENU_CANCEL); wram(P, bank); return { a: bank, f: entryF }; };
  if (rd(P, "charSelectSlot") === SLOTS_DONE) return refuse();
  if (P.V.linkRemoteInput === LINK_CMD_SELECT) { P.V.linkRemoteInput = LINK_CMD_SELECT_DONE; return refuse(); }
  const taken = near(P, TestAndSetGridEntryTaken, { c: rd(P, "charGridPage"), d: P.V.menuCursorX, e: P.V.menuCursorY });
  if (taken.a) return refuse();
  sound(P, SFX_MENU_SELECT);
  const entry = near(P, GetGridSlotFromCursor).a, ch = u8(P, gridEntry(P, entry));
  if (ch === 0xFF) return refuse();
  if (near(P, IsMarioCastCharacter, { c: ch }).a && rd(P, "charGridHandedness") === HANDED_LEFT)
    wr(P, "charSelectSlotLeftHanded", 1, rd(P, "charSelectSlot"));
  wr(P, "charSelectSlotChars", entry, rd(P, "charSelectSlot"));
  near(P, DrawPlayerSlotPortrait, { b: entry });
  near(P, BuildVisiblePageSpriteList);
  near(P, AdvanceToNextPlayerSlot);
  near(P, DrawCharGridSlotPrompt);
  queueCopy(P, wShadowTilemap + 2 * TILEMAP_WIDTH, vBGMap0 + 2 * TILEMAP_WIDTH, 2 * TILEMAP_WIDTH / 16);
  wram(P, bank);
  return { a: bank, f: entryF };
}
// CancelLinkGridSelection (38:6805): our last pick undone: the previous slot (back to the first: the cursors and
// page reset and the info panel redrawn), its character's entry free again, its difficulty and handedness cleared,
// its box emptied, the prompt redrawn
export function cancelLinkGridSelection(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  const back = near(P, RetreatToPreviousPlayerSlot).a;
  if (back === 0xFF) { wram(P, bank); return { a: bank, f: entryF }; }
  if (back === PREVIOUS_IS_FIRST) {
    P.V.menuCursorX = 0; P.V.menuCursorY = 0; P.V.menuCursor2X = 0; P.V.menuCursor2Y = 0;
    wr(P, "charGridPage", 0);
    P.V.linkCursorPage = 0;
    near(P, RefreshCharInfoPanel);
  }
  sound(P, SFX_MENU_CANCEL);
  const slot = rd(P, "charSelectSlot"), entry = rd(P, "charSelectSlotChars", slot);
  wr(P, "charSelectSlotChars", 0, slot);
  w8(P, gridEntry(P, entry) + ENTRY_TAKEN, 0);
  wram(P, WRAM_SCREEN);
  wr(P, "charSelectSlotDifficulty", 0, rd(P, "charSelectSlot"));
  wr(P, "charSelectSlotLeftHanded", 0, rd(P, "charSelectSlot"));
  near(P, ClearPlayerSlotPortrait);
  near(P, BuildVisiblePageSpriteList);
  near(P, DrawCharGridSlotPrompt);
  queueCopy(P, wShadowTilemap + 2 * TILEMAP_WIDTH, vBGMap0 + 2 * TILEMAP_WIDTH, 2 * TILEMAP_WIDTH / 16);
  wram(P, bank);
  return { a: bank, f: entryF };
}
// DrawRemoteSlotPortrait (38:688D): character c's portrait (in its palette) in the partner's current slot box,
// with its left-handed mark; the box rows queued
export function drawRemoteSlotPortrait(P, ch, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  const palette = rom(P, GetCharPaletteIndex, { a: ch, c: ch }).a;
  const box = getRemoteSlotBoxAddress(P).bc;
  near(P, WriteCharPortraitTiles, { b: ch, c: palette, de: box, hl: palette << 8 | ch });
  drawRemoteSlotLeftHandedMark(P);
  const r = queueRemoteSlotRows(P);
  wram(P, bank);
  return { ...r, a: bank, f: entryF };
}
// DrawRemoteSlotLeftHandedMark (38:68EC): the "L" beside the partner's slot box when that slot is left-handed
export function drawRemoteSlotLeftHandedMark(P) {
  const { hl } = ixF(P.A.charSelectSlotLeftHanded + remoteSlotOffset(P), rd(P, "charSelectRemoteSlot"));
  if (!u8(P, hl)) return { a: 0, hl, f: FZ };
  const box = getRemoteSlotBoxAddress(P);
  const at = (box.bc + LEFT_HANDED_MARK_AT) & 0xFFFF;
  w8(P, at, LEFT_HANDED_MARK);
  return { ...box, a: LEFT_HANDED_MARK, hl: at, f: ((box.bc & 0xFFF) + LEFT_HANDED_MARK_AT > 0xFFF ? 0x20 : 0) | ((box.bc + LEFT_HANDED_MARK_AT) > 0xFFFF ? 0x10 : 0) | (box.f & FZ) };
}
// Unused_38_DrawRemoteDifficultyDigit (38:6920): the partner's CPU difficulty as a digit in the map beside its box.
// Nothing calls it.
export function unusedDrawRemoteDifficultyDigit(P) {
  const p2 = isP2Mode(P), v = rd(P, "charSelectSlotDifficulty", p2 ? 1 : 3), a = (v + DIFFICULTY_DIGIT_0) & 0xFF;
  const hl = p2 ? 0xD0EF : 0xD14F;
  w8(P, hl, a);
  return { a, c: DIFFICULTY_DIGIT_0, hl, f: addFlags(v, DIFFICULTY_DIGIT_0) };
}
// ClearRemoteSlotPortrait (38:6942): the partner's current slot box emptied (tile 0, attribute 8) with its two marks;
// the box rows queued
export function clearRemoteSlotPortrait(P) {
  const box = getRemoteSlotBoxAddress(P).bc;
  fillTilemapRect(P, box, 0x02, 0x02, 0x00);
  fillTilemapRect(P, (box + 0x400) & 0xFFFF, 0x02, 0x02, PORTRAIT_ATTR);
  const marks = (getRemoteSlotBoxAddress(P).bc + MARKS_AT) & 0xFFFF;
  w8(P, marks, 0);
  w8(P, marks + 1, 0);
  return queueRemoteSlotRows(P);
}
// GetRemoteSlotBoxAddress (38:69A5): bc = the map address of the partner's current slot box (by the mode's table)
export function getRemoteSlotBoxAddress(P) {
  const table = rw(P, idx(RemoteSlotBoxAddrPtrs_38, rd(P, "charSelectMode") * 2));
  const { hl, f } = ixF(table, rd(P, "charSelectRemoteSlot") * 2);
  const bc = rw(P, hl);
  return { a: bc & 0xFF, bc, hl: (hl + 1) & 0xFFFF, f };
}
// AdvanceRemotePlayerSlot (38:69ED): the partner's slot to the next in the mode's slot list
export function advanceRemotePlayerSlot(P) {
  let hl = rw(P, idx(RemotePlayerSlotLists_38, rd(P, "charSelectMode") * 2));
  const b = rd(P, "charSelectRemoteSlot");
  while (rb(P, hl) !== b) hl = (hl + 1) & 0xFFFF;
  hl = (hl + 1) & 0xFFFF;
  const a = rb(P, hl);
  wr(P, "charSelectRemoteSlot", a);
  return { a, b, hl, f: FZ | FN };
}

export const HOOKS = [
  [BANK, 0x6609, hook((P, c) => storeRemoteCpuDifficulty(P, c.c))],
  [BANK, 0x661E, hook((P, c) => applyRemoteCharSelection(P, c.c, c.f))],
  [BANK, 0x6655, hook(P => applyRemoteCharCancel(P))],
  [BANK, 0x66C3, hook(P => unusedCopyRemoteCharsToSlots(P))],
  [BANK, 0x66E9, hook((P, c) => checkLinkSelectionComplete(P, c.f))],
  [BANK, 0x6720, hook(P => handleLinkGridButtons(P))],
  [BANK, 0x676F, hook((P, c) => confirmLinkGridSelection(P, c.f))],
  [BANK, 0x6805, hook((P, c) => cancelLinkGridSelection(P, c.f))],
  [BANK, 0x688D, hook((P, c) => drawRemoteSlotPortrait(P, c.c, c.f))],
  [BANK, 0x68EC, hook(P => drawRemoteSlotLeftHandedMark(P))],
  [BANK, 0x6920, hook(P => unusedDrawRemoteDifficultyDigit(P))],
  [BANK, 0x6942, hook(P => clearRemoteSlotPortrait(P))],
  [BANK, 0x69A5, hook(P => getRemoteSlotBoxAddress(P))],
  [BANK, 0x69ED, hook(P => advanceRemotePlayerSlot(P))],
];
