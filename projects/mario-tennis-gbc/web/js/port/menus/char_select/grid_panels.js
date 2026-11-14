// The character grid's panels (bank $38): the player-slot boxes with each selected character's portrait (and its
// left-handed and CPU-difficulty marks), the info panel under the grid (a roster character's name and type, or a
// created character's level and stats), the slot icons, and the CPU difficulty panel that opens when a Mario-cast
// character is picked for a CPU slot.
// Port of src/engine/menus/char_select/player_38.asm, the drawing half of grid_icons_38.asm and the difficulty panel
// of cpu_submenu_38.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm);
// names and addresses are its own. Tables are read from the ROM.
//
// The screen's maps are the WRAM 3 shadow maps (wShadowTilemap, wShadowAttrmap); rows are queued to VRAM as they
// change. Rows 18-25 of the shadow maps hold pieces copied in when needed: rows 18-21 the difficulty panel, rows
// 22-25 what it covers, row 26 the handedness labels.
// Tests: web/tests/port/routines_menus_chars.mjs; lockstep on out/port/cs_singles.mtrec, cs_doubles.mtrec (the
// difficulty panel: confirmed and cancelled), cs_saved.mtrec (created characters' stats) and out/engine/exh1.mtrec.
import {
  rd, wr, u8, w8, idx, rom, FAR, WRAM_SCREEN, TILEMAP_WIDTH, VRAM_BANK1, vBGMap0, wShadowTilemap, wShadowAttrmap,
  PADF_A, PADF_B, PADF_LEFT, PADF_RIGHT, SFX_MENU_MOVE, SFX_MENU_SELECT, SFX_MENU_CANCEL, CHARSELECTMODE_LINK_SINGLES_P2,
  CHARSELECTMODE_LINK_DOUBLES_P2, CHAR_NONE, Text_30_27, Text_30_149, Text_30_153, sound, withWram, queueVRAMCopy,
  queueMapRows, fillTilemapRect, copyTilemapRect, renderTextToBuffer64, hook,
} from "./defs.js";
import {
  BANK, getGridSlotFromCursor, buildVisiblePageSpriteList, advanceToNextPlayerSlot, buildCharGridFromUnlockFlags,
  fillCharGridPaletteIndices, addCreatedCharsToCharGrid, compactRosterGridEntries, compactMarioCastGridEntries,
  countCharGridEntries, setCharGridPageCount,
} from "./grid_data.js";
import { drawNameWithDiacritics, drawDecimalNumber, wrapIndex } from "./matchtype.js";
// FarCall with its entry flags and frame, registers chained (the last menus' helpers: their results are the ROM's)
import { rom as farcall, near, chain, regs8, ixF, getRegs, addFlags, FZ, FN, FC } from "../equipment/defs.js";

const PlayerSlotBoxAddrPtrs_38 = 0x56C9, CharNameAndTypeTable = 0x58FB, CharGridSlotIconListPtrs_38 = 0x59BA;
const CharGridSlotPromptTable0 = 0x5486, CharGridSlotPromptTable1 = 0x5490;
const CpuDifficultyCursorBoxTable0 = 0x635D, CpuDifficultyCursorBoxTable1 = 0x6365;
const SLOT_DONE = 4;                                       // wCharSelectSlot after the last slot: waiting for the others
const NUM_CREATED_CHAR_IDS = 4;
const CPU_DIFFICULTIES = 4;                                // easy, normal, hard, intense
const PORTRAIT_FIRST_TILE = 0x80;                          // character n's 2x2 portrait: tiles $80 + 4n .. + 3
const PORTRAIT_ATTR = 0x08;                                // VRAM bank 1, palette = the character's + 3
const TILE_LEFT_HANDED_MARK = 0x32, TILE_DIFFICULTY_MARKS = 0x33;   // the "L" and the 4 difficulty marks (+ 1-4)
const TILE_SLOT_ICONS = 0x50, TILE_SLOT_ICON_KINDS = 0x54;
const cell = (base, x, y) => (base + y * TILEMAP_WIDTH + x) & 0xFFFF;
const word = (P, addr) => P.rom.u16(BANK, addr);
const entryAddr = (P, n) => (P.A.charGridEntries + ((n * 4) & 0xFF)) & 0xFFFF;
// the flags of `add hl, bc` (hl a constant n): Z kept, H and C of the 16-bit add
const addHL16Flags = (f, bc, n) => (f & FZ) | ((bc & 0xFFF) + n > 0xFFF ? 0x20 : 0) | (bc + n > 0xFFFF ? FC : 0);
// QueueVRAMCopy of 2 rows of both shadow maps from row `row`; returns the registers left (over r: those before)
function queueRows(P, row, rows = 2, r = {}) {
  r = queueAfter(P, r, cell(wShadowTilemap, 0, row), cell(vBGMap0, 0, row), rows * TILEMAP_WIDTH / 16);
  return queueAfter(P, r, cell(wShadowAttrmap, 0, row), cell(vBGMap0, 0, row) + VRAM_BANK1, rows * TILEMAP_WIDTH / 16);
}
// `ld hl, src / ld de, dest / ld c, blocks / call QueueVRAMCopy` after registers r: the registers then
const queueAfter = (P, r, src, dest, blocks) => chain(chain(regs8(r), { hl: src, de: dest, c: blocks }), queueVRAMCopy(P, src, dest, blocks));

// ---- the player-slot boxes ----
// GetPlayerSlotBoxAddress (38:56AD): the shadow-map cell of wCharSelectSlot's box in this mode's layout
// (PlayerSlotBoxAddrPtrs_38; NO_BOX for a slot the mode has not). Returns it in bc, a = its low byte, hl after it.
export function getPlayerSlotBoxAddress(P) {
  const list = word(P, idx(PlayerSlotBoxAddrPtrs_38, rd(P, "charSelectMode") * 2));
  const { hl: at, f } = ixF(list, rd(P, "charSelectSlot") * 2), bc = P.bus.u16(at);
  return { bc, a: bc & 0xFF, hl: (at + 1) & 0xFFFF, f };
}
// the box's rows on the screen: 6-7 for the slots on the top line (0, 1), 9-10 for the others
const boxRow = P => (rd(P, "charSelectSlot") >= 2 ? 9 : 6);
// ClearPlayerSlotPortrait (38:55AB): empty the slot's 2x2 box (tile 0, attribute 8), its two marks, and queue its rows
export function clearPlayerSlotPortrait(P) {
  const box = getPlayerSlotBoxAddress(P).bc;
  fillTilemapRect(P, box, 2, 2, 0x00);
  fillTilemapRect(P, (box + 0x400) & 0xFFFF, 2, 2, 0x08);
  const again = getPlayerSlotBoxAddress(P), marks = (again.bc + 0x1E) & 0xFFFF;
  w8(P, marks, 0); w8(P, marks + 1, 0);
  return queueRows(P, boxRow(P), 2, { b: again.bc >> 8 });       // (b: the box's, should both copies find the queue full)
}
// DrawPlayerSlotPortrait (38:5612): grid entry b's portrait into the slot's box, its marks, and queue its rows
export function drawPlayerSlotPortrait(P, entry) {
  const at = entryAddr(P, entry), id = u8(P, at), palette = u8(P, at + 1);
  writeCharPortraitTiles(P, id, (palette - 1) & 0xFF, getPlayerSlotBoxAddress(P).bc);
  drawPlayerSlotLeftHandedMark(P);
  drawPlayerSlotDifficultyMark(P);
  return queueRows(P, boxRow(P), 2, { b: getPlayerSlotBoxAddress(P).bc >> 8 });   // (b: as the mark's GetPlayerSlotBoxAddress left it)
}
// DrawPlayerSlotLeftHandedMark (38:567A): the "L" right of the box below, for a left-handed slot
export function drawPlayerSlotLeftHandedMark(P) {
  const { hl } = ixF(P.A.charSelectSlotLeftHanded, rd(P, "charSelectSlot"));
  if (!u8(P, hl)) return { a: 0, hl, f: FZ };
  const box = getPlayerSlotBoxAddress(P), at = (box.bc + 0x1F) & 0xFFFF;
  w8(P, at, TILE_LEFT_HANDED_MARK);
  return { ...box, a: TILE_LEFT_HANDED_MARK, hl: at, f: addHL16Flags(box.f, box.bc, 0x1F) };
}
// DrawPlayerSlotDifficultyMark (38:5693): the CPU difficulty's mark left of it (tile $33 + difficulty; $33 = none)
export function drawPlayerSlotDifficultyMark(P) {
  const v = u8(P, ixF(P.A.charSelectSlotDifficulty, rd(P, "charSelectSlot")).hl), mark = (v + TILE_DIFFICULTY_MARKS) & 0xFF;
  const box = getPlayerSlotBoxAddress(P), at = (box.bc + 0x1E) & 0xFFFF;
  w8(P, at, mark);
  return { a: mark, f: addFlags(v, TILE_DIFFICULTY_MARKS), bc: box.bc, hl: at };   // (af pushed around the address)
}
// WriteCharPortraitTiles (38:5712): character b's portrait tiles ($80 + 4b: top-left, top-right +2, bottom-left +1,
// bottom-right +3) at de, attributes (c + 3) | 8 for the 2x2 in the attribute map ($400 on)
// Returns the registers the attributes' FillTilemapRect leaves (a = the last tile, l the attribute cell's low byte).
export function writeCharPortraitTiles(P, id, palette, de) {
  const tile = (PORTRAIT_FIRST_TILE + id * 4) & 0xFF;
  w8(P, de, tile); w8(P, de + 1, tile + 2);
  w8(P, de + 0x20, tile + 1); w8(P, de + 0x21, tile + 3);
  const at = (de + 0x400) & 0xFFFF;
  return farcall(P, FAR.FillTilemapRect, { a: (tile + 3) & 0xFF, b: 2, c: 2, de: at, h: ((palette + 3) | PORTRAIT_ATTR) & 0xFF, l: at & 0xFF });
}
// LoadAllCharPortraitTiles (38:5746): the 32 characters' portrait tiles (LoadOnCourtCharTilesA), 4 tiles each from de
export function loadAllCharPortraitTiles(P, de) {
  for (let a = 0; a < 0x20; a++, de = (de + 0x40) & 0xFFFF) rom(P, FAR.LoadOnCourtCharTilesA, { a, de });
}

// ---- the info panel ----
// RefreshCharInfoPanel (38:575E): rows 12-16 cleared, then the entry under the cursor: a created character's
// name, level and stats, or a roster character's name, type and handedness label; rows 12-16 queued. All
// registers kept.
export function refreshCharInfoPanel(P) {
  withWram(P, WRAM_SCREEN, () => {
    fillTilemapRect(P, cell(wShadowTilemap, 1, 12), 0x12, 1, 0x03);
    fillTilemapRect(P, cell(wShadowTilemap, 1, 13), 0x12, 4, 0x20);
    if (rd(P, "charSelectSlot") !== SLOT_DONE) {
      const slot = getGridSlotFromCursor(P).a, at = entryAddr(P, slot), id = u8(P, at);
      if (id < NUM_CREATED_CHAR_IDS) drawCreatedCharStats(P, u8(P, at + 3));
      else if (id !== CHAR_NONE) { drawCharNameAndType(P, id); drawCharSelectSlotLabel(P); }
    }
    queueVRAMCopy(P, cell(wShadowTilemap, 0, 12), cell(vBGMap0, 0, 12), 5 * TILEMAP_WIDTH / 16);
    queueVRAMCopy(P, cell(wShadowAttrmap, 0, 16), cell(vBGMap0, 0, 16) + VRAM_BANK1, TILEMAP_WIDTH / 16);
  });
}
// DrawCreatedCharStats (38:57DD): created record c (wCreatedCharRecords): name, "LV" and level, the four stats
// with their labels; the label row's attributes reset. All registers kept.
export function drawCreatedCharStats(P, record) {
  withWram(P, WRAM_SCREEN, () => {
    const rec = (P.A.createdCharRecords + record * 0x20) & 0xFFFF;
    if (u8(P, rec) !== 0xFF) {
      const T = (x, y, tile) => w8(P, cell(wShadowTilemap, x, y), tile);
      const number = (field, x, y) => drawDecimalNumber(P, u8(P, rec + field), 2, cell(wShadowTilemap, x, y));
      drawNameWithDiacritics(P, rec + 7, cell(wShadowTilemap, 3, 13));
      T(11, 13, 0x4C); T(12, 13, 0x56);                    // "LV"
      number(2, 14, 13);
      [0x1D, 0x1E, 0x1F].forEach((t, i) => T(2 + i, 15, t));      // "SPIN"
      number(3, 7, 15);
      number(4, 15, 15);
      [0x14, 0x15, 0x16, 0x17].forEach((t, i) => T(10 + i, 15, t));   // "POWER"
      [0x18, 0x19, 0x1A, 0x1B, 0x1C].forEach((t, i) => T(2 + i, 16, t));   // "CONTROL"
      number(5, 7, 16);
      [0x10, 0x11, 0x12, 0x13].forEach((t, i) => T(10 + i, 16, t));   // "SPEED"
      number(6, 15, 16);
    }
    fillTilemapRect(P, cell(wShadowAttrmap, 1, 16), 0x12, 1, 0x00);
  });
}
// DrawCharNameAndType (38:58CD): character c's name (text 30:27 + c) and type (text 30:153 + CharNameAndTypeTable[c])
export function drawCharNameAndType(P, id) {
  renderTextToBuffer64(P, (Text_30_27 + id) & 0xFFFF, cell(wShadowTilemap, 6, 13));
  renderTextToBuffer64(P, (Text_30_153 + P.rom.u8(BANK, idx(CharNameAndTypeTable, id))) & 0xFFFF, cell(wShadowTilemap, 3, 15));
}
// DrawCharSelectSlotLabel (38:591B): on the Mario-cast pages (0, 1) the "START: ..." label for wCharGridHandedness
// (0 right-handed, 1 left-handed, 2 change hands) copied from row 26; then the label row's attributes (8)
export function drawCharSelectSlotLabel(P) {
  if (rd(P, "charGridPage") < 2) {
    const handedness = rd(P, "charGridHandedness");
    copyTilemapRect(P, cell(wShadowTilemap, 0, 26), cell(wShadowTilemap, 4, 16), 5, 1);
    if (handedness === 0) copyTilemapRect(P, cell(wShadowTilemap, 10, 26), cell(wShadowTilemap, 9, 16), 5, 1);
    else if (handedness === 1) copyTilemapRect(P, cell(wShadowTilemap, 5, 26), cell(wShadowTilemap, 9, 16), 5, 1);
    else copyTilemapRect(P, cell(wShadowTilemap, 15, 26), cell(wShadowTilemap, 9, 16), 8, 1);
  }
  fillTilemapRect(P, cell(wShadowAttrmap, 1, 16), 0x12, 1, 0x08);
}
// DrawCharGridSlotIcons (38:598B): the mode's slot icons (CharGridSlotIconListPtrs_38: [count, kind, map address],
// 0-terminated) into the shadow map
export function drawCharGridSlotIcons(P) {
  withWram(P, WRAM_SCREEN, () => {
    let hl = word(P, idx(CharGridSlotIconListPtrs_38, rd(P, "charSelectMode") * 2));
    for (let n; (n = u8(P, hl)); hl = (hl + 4) & 0xFFFF) writeSlotIconTiles(P, n, u8(P, hl + 1), P.bus.u16(hl + 2));
  });
}
// WriteSlotIconTiles (38:59FA): icon c ($50 + c - 1) and kind b ($54 + b) at de, de + 1 in WRAM 3. All registers kept.
export function writeSlotIconTiles(P, n, kind, de) {
  withWram(P, WRAM_SCREEN, () => {
    w8(P, de, TILE_SLOT_ICONS + n - 1);
    w8(P, de + 1, TILE_SLOT_ICON_KINDS + kind);
  });
}
// DrawCharGridSlotPrompt (38:5424): the prompt line (row 3) for the slot being chosen: "CPU Difficulty" while the
// panel is asked for, else the slot's prompt (CharGridSlotPromptTable0/1: the second player of a link uses the
// second). Maps WRAM 3; nothing once all slots are chosen ($FF).
export function drawCharGridSlotPrompt(P) {
  P.wramBank(WRAM_SCREEN);
  const slot = rd(P, "charSelectSlot");
  if (slot === 0xFF) return { a: 0xFF, f: FZ | FN };
  let r = farcall(P, FAR.FillTilemapRect, { a: WRAM_SCREEN, de: cell(wShadowTilemap, 1, 2), b: 0x12, c: 1, h: 0x03 });
  r = farcall(P, FAR.FillTilemapRect, { ...regs8(r), de: cell(wShadowTilemap, 1, 3), b: 0x12, c: 1, h: 0x20 });
  const prompt = rd(P, "cpuDifficultyPrompt"), de = cell(wShadowTilemap, 1, 3);
  // (RenderTextToBuffer64 keeps every register: they are those of the farcall, a the prompt flag or the text's low byte)
  if (prompt) return farcall(P, FAR.RenderTextToBuffer64, { ...regs8(r), a: prompt, hl: Text_30_149, de, c: 0x20 });
  const mode = rd(P, "charSelectMode");
  const table = mode === CHARSELECTMODE_LINK_SINGLES_P2 || mode === CHARSELECTMODE_LINK_DOUBLES_P2 ? CharGridSlotPromptTable1 : CharGridSlotPromptTable0;
  const text = word(P, idx(table, slot * 2));
  return farcall(P, FAR.RenderTextToBuffer64, { ...regs8(r), a: text & 0xFF, hl: text, de, c: 0x20 });
}

// ---- the grid's state ----
// InitCharGridState (38:5A1B): page 0, nothing chosen, the first slot (1P; the second player of a link starts at
// slot 2), the grid built from the unlock flags with the created characters, compacted and counted
export function initCharGridState(P) {
  withWram(P, WRAM_SCREEN, () => {
    for (const name of ["charGridPage", "charSelectExitCode", "charSelectRemoteSlot", "cpuDifficultyPrompt",
      "cpuDifficultyPanelOpen", "cpuDifficultyCursor"]) wr(P, name, 0);
    for (let i = 0; i < 4; i++) wr(P, "charSelectSlotChars", CHAR_NONE, i);
    wr(P, "charSelectRemoteChars", CHAR_NONE); wr(P, "charSelectRemoteChars", CHAR_NONE, 1);
    const mode = rd(P, "charSelectMode");
    wr(P, "charSelectSlot", mode === CHARSELECTMODE_LINK_SINGLES_P2 || mode === CHARSELECTMODE_LINK_DOUBLES_P2 ? 2 : 0);
    buildCharGridFromUnlockFlags(P, P.A.charUnlockFlags);
    fillCharGridPaletteIndices(P);
    addCreatedCharsToCharGrid(P);
    compactRosterGridEntries(P);
    compactMarioCastGridEntries(P);
    countCharGridEntries(P);
    setCharGridPageCount(P);
    buildVisiblePageSpriteList(P);
  });
}

// ---- the CPU difficulty panel ----
// RunCpuDifficultySubmenu (38:6216): one frame of the panel (opened on the first): left/right pick the difficulty,
// A confirms it for the slot (its portrait drawn, the next slot), B cancels the slot's character.
export function runCpuDifficultySubmenu(P) {
  withWram(P, WRAM_SCREEN, () => {
    if (!rd(P, "cpuDifficultyPanelOpen")) {
      openCpuDifficultyPanel(P);
      queueCpuDifficultyPanelToVram(P);
      wr(P, "cpuDifficultyPanelOpen", 1);
    }
    handleCpuDifficultyInput(P);
    drawCpuDifficultyCursorBox(P);
    const input = rd(P, "menuInputPressed"), slot = () => rd(P, "charSelectSlot");
    if (input & PADF_A) {
      sound(P, SFX_MENU_SELECT);
      closeCpuDifficultyPanel(P);
      w8(P, idx(P.A.charSelectSlotDifficulty, slot()), rd(P, "cpuDifficultyCursor") + 1);
      drawPlayerSlotPortrait(P, getGridSlotFromCursor(P).a);
      if (advanceToNextPlayerSlot(P).a === 0xFF) wr(P, "charSelectExitCode", 1);
    } else if (input & PADF_B) {
      closeCpuDifficultyPanel(P);
      sound(P, SFX_MENU_CANCEL);
      P.wramBank(WRAM_SCREEN);
      w8(P, idx(P.A.charSelectSlotDifficulty, slot()), 0);
      w8(P, idx(P.A.charSelectSlotLeftHanded, slot()), 0);
      const chars = idx(P.A.charSelectSlotChars, slot()), entry = u8(P, chars);
      w8(P, chars, 0);
      w8(P, entryAddr(P, entry) + 2, 0);                   // not taken any more
      clearPlayerSlotPortrait(P);
      buildVisiblePageSpriteList(P);
    } else return;
    drawCharGridSlotPrompt(P);
    queueMapRows(P, wShadowTilemap, vBGMap0, 2, 2);
  });
}
// CloseCpuDifficultyPanel (38:62C8): the panel's rows (14-17) restored from rows 22-25, the info panel redrawn
export function closeCpuDifficultyPanel(P) {
  wr(P, "cpuDifficultyPanelOpen", 0);
  wr(P, "cpuDifficultyPrompt", 0);
  let r = farcall(P, FAR.CopyTilemapRect, { a: 0, hl: cell(wShadowTilemap, 0, 22), de: cell(wShadowTilemap, 0, 14), b: 0x14, c: 4 });
  r = farcall(P, FAR.CopyTilemapRect, { ...regs8(r), hl: cell(wShadowAttrmap, 0, 22), de: cell(wShadowAttrmap, 0, 14), b: 0x14, c: 4 });
  r = farcall(P, FAR.FillTilemapRect, { ...regs8(r), de: cell(wShadowAttrmap, 1, 14), b: 0x12, c: 3, h: 0x00 });
  refreshCharInfoPanel(P);                                     // (all registers kept)
  r = queueAfter(P, r, cell(wShadowTilemap, 0, 17), cell(vBGMap0, 0, 17), TILEMAP_WIDTH / 16);
  return queueAfter(P, r, cell(wShadowAttrmap, 0, 14), cell(vBGMap0, 0, 14) + VRAM_BANK1, 4 * TILEMAP_WIDTH / 16);
}
// HandleCpuDifficultyInput (38:630F): left/right step wCpuDifficultyCursor (0-3, wrapping)
export function handleCpuDifficultyInput(P, entryF = P.cpu.f) {
  const input = rd(P, "menuInputPressed");
  let step;
  if (input & PADF_LEFT) step = -1; else if (input & PADF_RIGHT) step = 1;
  else return { a: input, f: FZ | 0x20 | (entryF & FC) };          // (its `bit 4, a`)
  sound(P, SFX_MENU_MOVE);
  const v = (rd(P, "cpuDifficultyCursor") + step) & 0xFF, a = wrapIndex(v, CPU_DIFFICULTIES);
  wr(P, "cpuDifficultyCursor", a);
  // the flags of the ROM's wrap: `add a` carried (below 0: `ld a, 4 / dec a`), `cp 4` (in range) or `xor a`
  const f = v & 0x80 ? FN | FC : v < CPU_DIFFICULTIES ? FN | ((v & 0xF) < 4 ? 0x20 : 0) | FC : FZ;
  return { a, f };
}
// DrawCpuDifficultyCursorBox (38:633B): the selected-option box around the difficulty (its place and size by the
// cursor: CpuDifficultyCursorBoxTable0/1)
export function drawCpuDifficultyCursorBox(P) {
  const n = rd(P, "cpuDifficultyCursor") * 2;
  const at0 = idx(CpuDifficultyCursorBoxTable0, n), at1 = idx(CpuDifficultyCursorBoxTable1, n);
  const { f } = ixF(CpuDifficultyCursorBoxTable1, n);
  return near(P, FAR.DrawSelectedOptionBox[1], { a: P.bus.u8(at1), f, de: P.bus.u8(at0 + 1) << 8 | P.bus.u8(at0),
    bc: P.bus.u8(at1 + 1) << 8 | P.bus.u8(at1), hl: (at1 + 1) & 0xFFFF });
}
// OpenCpuDifficultyPanel (38:636D): the panel (rows 18-21) copied over rows 14-17 of both maps
export function openCpuDifficultyPanel(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  P.wramBank(WRAM_SCREEN);
  let r = farcall(P, FAR.CopyTilemapRect, { a: WRAM_SCREEN, hl: cell(wShadowTilemap, 0, 18), de: cell(wShadowTilemap, 0, 14), b: 0x14, c: 4 });
  r = farcall(P, FAR.CopyTilemapRect, { ...regs8(r), hl: cell(wShadowAttrmap, 0, 18), de: cell(wShadowAttrmap, 0, 14), b: 0x14, c: 4 });
  P.wramBank(bank);
  return { ...regs8(r), a: bank, f: entryF };
}
// QueueCpuDifficultyPanelToVram (38:6396): rows 14-17 of both maps to VRAM
export function queueCpuDifficultyPanelToVram(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  P.wramBank(WRAM_SCREEN);
  const r = queueRows(P, 14, 4, regs8(getRegs(P.cpu)));
  P.wramBank(bank);
  return { ...r, a: bank, f: entryF };
}

export const HOOKS = [
  [BANK, 0x55AB, hook(P => clearPlayerSlotPortrait(P))],
  [BANK, 0x5612, hook((P, c) => drawPlayerSlotPortrait(P, c.b))],
  [BANK, 0x567A, hook(P => drawPlayerSlotLeftHandedMark(P))],
  [BANK, 0x5693, hook(P => drawPlayerSlotDifficultyMark(P))],
  [BANK, 0x56AD, hook(P => getPlayerSlotBoxAddress(P))],
  [BANK, 0x5712, hook((P, c) => writeCharPortraitTiles(P, c.b, c.c, c.de))],
  [BANK, 0x5746, hook((P, c) => loadAllCharPortraitTiles(P, c.de))],
  [BANK, 0x575E, hook(P => refreshCharInfoPanel(P))],
  [BANK, 0x57DD, hook((P, c) => drawCreatedCharStats(P, c.c))],
  [BANK, 0x58CD, hook((P, c) => drawCharNameAndType(P, c.c))],
  [BANK, 0x591B, hook(P => drawCharSelectSlotLabel(P))],
  [BANK, 0x598B, hook(P => drawCharGridSlotIcons(P))],
  [BANK, 0x59FA, hook((P, c) => writeSlotIconTiles(P, c.c, c.b, c.de))],
  [BANK, 0x5A1B, hook(P => initCharGridState(P))],
  [BANK, 0x5424, hook(P => drawCharGridSlotPrompt(P))],
  [BANK, 0x6216, hook(P => runCpuDifficultySubmenu(P))],
  [BANK, 0x62C8, hook(P => closeCpuDifficultyPanel(P))],
  [BANK, 0x630F, hook((P, c) => handleCpuDifficultyInput(P, c.f))],
  [BANK, 0x633B, hook(P => drawCpuDifficultyCursorBox(P))],
  [BANK, 0x636D, hook((P, c) => openCpuDifficultyPanel(P, c.f))],
  [BANK, 0x6396, hook((P, c) => queueCpuDifficultyPanelToVram(P, c.f))],
];
