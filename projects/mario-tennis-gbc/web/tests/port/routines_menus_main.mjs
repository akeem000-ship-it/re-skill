// Routine tests for web/js/port/menus/main_menu (run by web/tests/port_routines.mjs, filter "menus/main"): every
// routine of the main menu and its submenus that does not wait, called at its ROM address on the ROM and on the port
// from recorded states, with prep() making the cases: cursor positions over each grid, story files present or
// empty (with names that carry diacritics), N64 records data of any shape in WRAM 3, every option of the match
// format, the N64 flags in WRAM 2, a full sprite queue. The screens themselves wait; the lockstep checks them on
// out/engine/exh1.mtrec and the out/port/menus_*.mtrec recordings.
// Default recordings work; more states with --rec out/engine/exh1.mtrec,out/port/save1.mtrec.
import { T, pick, w, wv, at } from "./routines_menus_common.mjs";

const ENTRIES = [];
const M = (name, addr, opts) => T(ENTRIES, `menus/main ${name}`, 0x3B, addr, opts);
const B1 = (name, addr, opts) => T(ENTRIES, `menus/main ${name}`, 0x01, addr, opts);

// ---- states ----
const spritePrep = (mem, r) => {
  wv(mem, "vBlankCounter", r(256));
  if (r(6) === 0) wv(mem, "spriteQueueIndex", 0xA0); else if (r(2)) wv(mem, "spriteQueueIndex", 4 * r(36));
};
const cursorOn = (cols, rows) => (mem, r) => { wv(mem, "menuCursorX", r(cols)); wv(mem, "menuCursorY", r(rows)); };
// the three story files' summaries (WRAM 3 $D300): present (a character, color, level, a name, play time) or empty
function summariesPrep(mem, r) {
  for (let f = 0; f < 3; f++) {
    const base = 0x300 + 16 * f, b = (i, v) => { mem.wram[3][base + i] = v & 0xFF; };
    if (r(3) === 0) { b(0, 0x3F); b(1, 3); continue; }
    b(0, r(0x1B)); b(1, r(16)); b(2, r(100));
    const len = 1 + r(9);
    for (let i = 0; i < 11; i++) b(3 + i, i < len ? (r(5) === 0 && i ? pick(r, [0xDE, 0xDF]) : 0x41 + r(26)) : 0);
    b(14, r(100)); b(15, r(60));
  }
}
const menuPrep = (cols, rows) => (mem, r) => { cursorOn(cols, rows)(mem, r); summariesPrep(mem, r); spritePrep(mem, r); if (r(4) === 0) wv(mem, "fadedOut", 1); };
// N64 records in WRAM 3: the block, the chart rows and lists, the windows' positions
function n64Prep(mem, r) {
  for (let i = 0; i < 0x200; i++) mem.wram[3][0x900 + i] = r(3) ? r(256) : 0;
  for (let i = 0; i < 0x150; i++) mem.wram[3][0xB00 + i] = r(11);
  for (let i = 0; i < 16; i++) { mem.wram[3][0xC01 + i] = r(17); mem.wram[3][0xC40 + i] = r(17); mem.wram[3][0x810 + i] = r(17); }
  for (let i = 0; i < 16 * 12; i++) mem.wram[3][0x830 + i] = r(3) === 0 ? 1 : 0;
  mem.wram[3][0xC12] = r(10); mem.wram[3][0xC13] = r(13);
  mem.wram[3][0x800] = r(2); mem.wram[3][0x801] = r(2); mem.wram[3][0x802] = r(12);
  mem.wram[3][0x819] = r(2);
  for (let i = 0; i < 32; i++) mem.wram[3][0xD00 + i] = r(256);   // (row 18 of the map: the faces, labels, cells)
  wv(mem, "menuCursorX", r(4)); wv(mem, "menuCursorY", r(12));
  w(mem, at("n64TrophyCounts"), r(256)); w(mem, at("n64TrophyCounts") + 1, r(256));
  spritePrep(mem, r);
}

// ---- boot_01 ----
B1("LoadMenuFontPalette", 0x5050, { n: 4 });
B1("LoadMenuTilesA", 0x5062, { n: 4, prep: (mem, r) => { if (r(3) === 0) mem.ppu.lcdc &= 0x7F; } });
B1("LoadMenuTilesB", 0x5076, { n: 4 });
B1("Unused_01_LoadMenuTilesBChunk2", 0x50D6, { n: 4 });
B1("LoadMenuFontGfx", 0x50E2, { n: 3 });
B1("Unused_01_LoadMenuBgPalettes3To7", 0x5176, { n: 4 });
B1("LoadMenuObjPalettes3To7", 0x5188, { n: 3 });
B1("LoadDebugMenuPalette", 0x519A, { regs: r => ({ b: r(16), d: r(16) }), n: 3 });

// ---- the main menu (main_menu_3b, saveslots_3b) ----
M("MapMainMenuCursorToItemId", 0x56B0, { regs: r => ({ a: r(9) }), n: 3 });
M("MainMenuCursorSpriteTask", 0x5863, { wram: 3, prep: menuPrep(3, 3) });
M("DrawMainMenuSelection", 0x5968, { wram: 3, prep: menuPrep(3, 3) });
M("FillMainMenuCellHighlight", 0x5A09, { wram: 3, regs: r => ({ b: r(9), c: r(2) }), n: 2 });
M("LoadMainMenuItemPalette", 0x5A57, { regs: r => ({ a: r(9) }), n: 2, prep: menuPrep(3, 3) });
M("BuildSaveSlotSummaries", 0x5AAC, { n: 2 });
M("DrawMainMenuCaption", 0x5B3E, { prep: menuPrep(3, 3) });
const numberRegs = r => ({ hl: pick(r, [0, 5, 10, 99, 100, 255, r(1000)]), de: 0xD200 + r(0x20), bc: 0xD330 });
M("Print2DigitNumberRightAligned", 0x5C27, { wram: 3, regs: numberRegs, n: 2 });
M("PrintNumberRightAligned", 0x5C2B, { wram: 3, regs: numberRegs, n: 2 });
M("Unused_3b_StubNop3", 0x5C52, { n: 10 });
M("TryMainMenuLinkHandshake (not the Link cell)", 0x5C53, { prep: (mem, r) => { wv(mem, "menuCursorX", r(2)); wv(mem, "menuCursorY", r(3)); }, n: 3 });
// the match format
const formatPrep = (mem, r) => {
  wv(mem, "menuCursorX", 0); wv(mem, "menuCursorY", r(3));
  wv(mem, "matchFormatDoubles", r(2)); wv(mem, "matchFormatGames", r(2)); wv(mem, "matchFormatSets", r(3));
  wv(mem, "menuInputPressed", pick(r, [0x10, 0x20, 0, 0x01, 0x30]));
  spritePrep(mem, r);
};
M("InitMatchFormatOptions", 0x5D80, { wram: 3, prep: formatPrep, n: 2 });
M("HandleMatchFormatInput", 0x5F3C, { wram: 3, prep: formatPrep, out: [] });
M("RedrawMatchFormatModeRow", 0x5FF6, { wram: 3, prep: formatPrep, n: 2 });
M("RedrawMatchFormatGamesRow", 0x600E, { wram: 3, prep: formatPrep, n: 2 });
M("RedrawMatchFormatSetsRow", 0x6028, { wram: 3, prep: formatPrep, n: 2 });
M("FillMatchFormatOptionCell", 0x6049, { regs: r => ({ b: r(7), c: r(2) }), n: 2 });
M("FlushMatchFormatRowToVram", 0x609A, { regs: r => ({ b: r(4) }), n: 2 });
M("MatchFormatCursorSpriteTask", 0x60D0, { wram: 3, prep: formatPrep });
M("DrawMatchFormatCaption", 0x6164, { prep: formatPrep, n: 2 });
M("RenderMatchFormatOptionText", 0x619B, { prep: formatPrep, n: 2 });

// ---- saved data, minigame helpers (saved_3b) ----
M("BuildMarioCastUnlockMask", 0x667F, { n: 2 });
M("GetUnlockedMarioCastCharAtGridSlot", 0x66B5, { regs: r => ({ c: r(9) }), prep: (mem, r) => wv(mem, "marioCastUnlockMask", r(64)), n: 2 });
M("GetMarioCastCharAtGridSlot", 0x66DE, { regs: r => ({ c: r(9) }), n: 3 });
M("CheckMinigameGridExpanded", 0x66F2, { prep: (mem, r) => wv(mem, "marioCastUnlockMask", r(64)), n: 2 });
M("DrawMinigameSelectGrid6", 0x6763, { prep: menuPrep(3, 2), n: 2 });
M("SavedDataSourceCursorSpriteTask", 0x69DC, { wram: 3, prep: menuPrep(3, 2), n: 2 });
M("DrawSavedDataSourceGrid", 0x6A7E, { prep: (mem, r) => { menuPrep(3, 2)(mem, r); if (r(2)) { wv(mem, "menuCursorY", 1); wv(mem, "menuCursorX", r(2)); } } });
M("FillSavedDataSourceCell", 0x6B0E, { wram: 3, regs: r => ({ b: r(5), c: r(2) }), n: 2 });
M("LoadSavedDataSourceCellPalette", 0x6B4E, { regs: r => ({ a: r(9) }), n: 3 });
M("DrawSavedDataSourceCaption", 0x6B83, { prep: menuPrep(3, 2) });
// erase, the N64 block in WRAM 2
const n64FlagPrep = (mem, r) => { mem.wram[2][0] = pick(r, [0, 0, 1, r(256)]); mem.wram[2][1] = pick(r, [0, 0, 1, r(256)]); };
M("LoadN64RecordsToWram2", 0x6C3D, { n: 3 });
M("CheckN64DataPresent", 0x6C5D, { prep: n64FlagPrep, n: 2 });
M("MoveSavedDataPickerCursor", 0x6E87, {
  prep: (mem, r) => { wv(mem, "menuCursorY", r(2)); wv(mem, "menuCursorX", r(3)); wv(mem, "menuInputPressed", pick(r, [0x10, 0x20, 0x40, 0x80, 0, 0x01])); },
});
M("EraseSavedDataCursorSpriteTask", 0x6F5B, { wram: 3, prep: menuPrep(3, 2), n: 2 });
M("DrawEraseSavedDataGrid", 0x6FFB, { prep: menuPrep(3, 2) });
M("FillEraseSavedDataCell", 0x708B, { wram: 3, regs: r => ({ b: r(5), c: r(2) }), n: 2 });
M("LoadEraseSavedDataCellPalette", 0x70CB, { regs: r => ({ a: r(9) }), n: 3 });
M("DrawEraseSavedDataCaption", 0x7100, { prep: menuPrep(3, 2) });
// the N64 record type and transfer item menus
M("N64RecordTypeCursorSpriteTask", 0x734F, { wram: 3, prep: menuPrep(3, 1), n: 2 });
M("DrawN64RecordTypeGrid", 0x73BF, { prep: menuPrep(3, 1), n: 2 });
M("FillN64RecordTypeCell", 0x7428, { wram: 3, regs: r => ({ b: r(6), c: r(2) }), n: 2 });
M("LoadN64RecordTypeCellPalette", 0x745D, { regs: r => ({ a: r(9) }), n: 3 });
M("DrawN64RecordTypeCaption", 0x749A, { prep: menuPrep(3, 1), n: 2 });
M("DrawN64TransferItemGrid", 0x760C, { prep: menuPrep(2, 2), n: 2 });
M("LoadN64TransferItemCellPalette", 0x7680, { regs: r => ({ a: r(9) }), n: 3 });
M("DrawN64TransferItemCaption", 0x76C5, { prep: menuPrep(2, 2), n: 2 });
M("N64TransferItemCursorSpriteTask", 0x76EA, { wram: 3, prep: menuPrep(2, 2), n: 2 });

// ---- bank $3B helpers (n64_3b) ----
M("Unused_3b_ClearWram3Row64", 0x43FB, { regs: r => ({ hl: 0xD000 + r(0xF00) }), n: 3 });
M("Unused_3b_ClearWram3Row64Alt", 0x4411, { regs: r => ({ hl: 0xD000 + r(0xF00) }), n: 3 });
M("UpdateAnimatedTilesTask_3b", 0x4428, { prep: (mem, r) => { wv(mem, "animatedTileTimer", r(4)); wv(mem, "animatedTilePeriod", 1 + r(3)); wv(mem, "animatedTileSet", r(4)); } });
M("DrawNameWithDiacritics_3b", 0x442C, {
  wram: 3, regs: r => ({ hl: 0xD303, de: 0xD000 + 32 * (1 + r(20)) + pick(r, [1, 10, 25, 31]) }), prep: summariesPrep,
});
M("Unused_3b_DrawDecimalNumber", 0x4465, { regs: r => ({ a: r(5), hl: r(0x10000), de: 0xD000 + r(0x200) }), n: 2 });
M("Unused_3b_DrawAsciiDigitString", 0x4486, { regs: r => ({ hl: 0xC800, de: 0xD000 + r(0x200) }), prep: (mem, r) => { for (let i = 0; i < 6; i++) w(mem, 0xC800 + i, i === 5 ? 0 : 0x20 + r(0x20)); }, n: 2 });
M("Unused_3b_DrawAsciiDigitChar", 0x4490, { regs: r => ({ a: 0x20 + r(0x30), de: 0xD000 + r(0x200) }), n: 2 });
M("Unused_3b_StubNop", 0x44A9, { n: 10 });

// ---- the records screens (n64_3b .., n64exhib_3b, n64tnmt_3b, n64trophies_3b, ring_3b) ----
const N = (name, addr, opts = {}) => M(name, addr, { wram: 3, prep: n64Prep, ...opts });
N("N64ExhibScrollArrowsTask", 0x4567);
N("DrawChartIconColumn", 0x46C0, { regs: r => ({ hl: 0xDC01 + r(12), bc: 0xD0E2 }), n: 2 });
N("DrawChartIconRow", 0x46DA, { regs: r => ({ hl: 0xDC01 + r(9), bc: 0xD0A4, a: 1 + r(7) }), n: 2 });
N("DrawChartCellRows", 0x46ED, { regs: r => ({ hl: 0xDB00 + r(0x80), de: 0xD0E4, a: 1 + r(7) }), n: 2 });
N("DrawChartCellMark", 0x4718, { regs: r => ({ b: r(11), de: 0xD000 + r(0x300) }), n: 2 });
N("BuildN64ExhibColumnList", 0x4743, { n: 2 });
N("Unused_3b_StubNop1", 0x4771, { n: 10 });
N("InitChartRowFlags", 0x4783, { n: 3 });
N("BuildN64ExhibResultsGrid", 0x479A, { n: 2 });
N("DecodeN64ExhibResultsRow", 0x47CC, { regs: r => ({ b: r(16), de: 0xDB00 + 16 * r(16) }), n: 2 });
N("MapExhibCellValueToGlyph", 0x4818, { regs: r => ({ a: r(16) }), n: 3 });
N("CombineExhibCellBits", 0x4834, { regs: r => ({ b: r(256) }), n: 2, prep: (mem, r) => { n64Prep(mem, r); for (let i = 0; i < 64; i++) mem.wram[3][0xC20 + i] = r(2); } });
N("ExpandRowBytesToBits", 0x4870, { regs: r => ({ de: 0xD9D8 + r(0x80) }), n: 2 });
N("ExpandByteToBitArray", 0x489D, { regs: r => ({ hl: 0xDC20 + r(0x38) }), n: 2 });
N("Unused_3b_FillN64RecordsPalettes", 0x48B8, { n: 3 });
N("LoadChartWindowTiles", 0x48F2, { regs: () => ({ de: 0xAAC0 }), n: 3 });
N("DrawChartCharIcon", 0x48FA, { regs: r => ({ b: r(17), hl: 0xD000 + r(0x300) }), n: 2 });
N("ReadN64RecordsSaveBlock", 0x493F, { n: 3 });
N("Unused_3b_StubNop2", 0x49E4, { n: 10 });
N("BuildTrophiesScreen", 0x49E5, { n: 3 });
N("DrawTrophiesWonRows", 0x4A71, { n: 2 });
N("DrawTrophyRowPair", 0x4AA3, { regs: r => ({ hl: 0xD800 + r(0x12), de: 0xD000 + r(0x300) }), n: 2 });
N("DrawWonTrophyIcon", 0x4AC9, { regs: r => ({ de: 0xD000 + r(0x300) }), n: 2 });
N("DrawTrophiesCharSprite", 0x4AF1, { regs: r => ({ c: r(16), de: 0xD000 + r(0x300) }), n: 2 });
N("CheckTrophiesCheatCode", 0x4B19, { n: 3, prep: (mem, r) => { n64Prep(mem, r); if (r(2)) { mem.wram[3][0x900] = 0x0C; mem.wram[3][0x901] = 0x22; } wv(mem, "currentStorySlot", r(4)); } });
N("ApplyUnlockEverythingCheat", 0x4B33, { n: 4, prep: (mem, r) => { n64Prep(mem, r); wv(mem, "currentStorySlot", r(4)); } });
N("DecodeTrophyCounts", 0x4C53, { n: 2 });
N("BuildN64TnmtDataScreen", 0x4DBD, { n: 3 });
N("LoadN64TnmtDataRecords", 0x4DFF, { n: 3 });
N("BuildN64TnmtTrophyGrid", 0x4E54, { n: 2 });
N("GetN64CharTrophyRowPtr", 0x4E74, { regs: r => ({ b: r(16) }), n: 3 });
N("DecodeN64CharTrophyCounts", 0x4E97, { regs: r => ({ hl: 0xD908 + r(16), de: 0xD830 + 12 * r(16) }), n: 2 });
N("FillTrophyCountCells", 0x4ED1, { regs: r => ({ b: r(4), de: 0xD830 + r(0x80) }), n: 2 });
N("CheckN64TnmtSecondPage", 0x4EE3, { prep: (mem, r) => { n64Prep(mem, r); const k = r(4); for (let i = 0; i < 16; i++) { if (k & 1) mem.wram[3][0x832 + 12 * i] = i < 14 || r(2) ? 1 : 0; if (k & 2) mem.wram[3][0x835 + 12 * i] = i < 14 || r(2) ? 1 : 0; } } });
N("DrawN64TnmtRowIcons", 0x4F45, { n: 2 });
N("DrawN64TnmtPageLabels", 0x4F81, { n: 2 });
N("DrawN64TnmtTrophyRows", 0x5000, { n: 2 });
N("DrawN64TnmtTrophyRow", 0x5042, { regs: r => ({ hl: 0xD830 + r(0x80), de: 0xD000 + r(0x300) }), n: 2 });
N("DrawEmptyTrophyCell", 0x507A, { regs: r => ({ de: 0xD000 + r(0x300) }), n: 3 });
N("N64TnmtScrollArrowsTask", 0x50D6);
N("BuildN64RingShotScreen", 0x51B3, { n: 3 });
N("DrawRingShotRowIcons", 0x5202, { n: 2 });
N("LoadN64RingShotRecords", 0x523E, { n: 3 });
N("Unused_3b_SeedDefaultRingShotRecords", 0x5288, { n: 3 });
N("BuildRingShotResultsGrid", 0x5319, { n: 2 });
N("CopyRingShotCharScores", 0x5368, { regs: r => ({ b: r(16), de: 0xDB04 + 12 * r(16) }), n: 2 });
N("DecodeRingShotCharClears", 0x538E, { regs: r => ({ b: r(16), de: 0xDB00 + 12 * r(16) }), n: 2 });
N("CountConsecutiveSetBits", 0x53B2, { regs: r => ({ b: pick(r, [0, 1, 3, 7, 0x1F, 0x3F, 0x7F, 0xFF, r(256)]) }), n: 2 });
N("DrawRingShotModeTab", 0x5426, { n: 2 });
N("RingShotScrollArrowsTask", 0x5491);
N("DrawRingShotClearMarks", 0x54FE, { prep: (mem, r) => { n64Prep(mem, r); for (let i = 0; i < 0x150; i++) mem.wram[3][0xB00 + i] = r(6); }, n: 2 });
N("DrawRingShotClearMarkRow", 0x5529, { regs: r => ({ b: r(5), c: r(6) }), n: 2 });
N("DrawRingShotMarkCell", 0x556E, { regs: r => ({ b: r(2), de: 0xD000 + r(0x300) }), n: 3 });
N("RingShotScoreDrawTask", 0x558F, { prep: (mem, r) => { n64Prep(mem, r); wv(mem, "digitSpriteTileBase", 0x10); wv(mem, "digitSpriteAttr", 9); } });

export const ROUTINES = ENTRIES;

