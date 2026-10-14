// Routine tests for web/js/port/menus/char_select and menus/char_data (run by web/tests/port_routines.mjs, filter
// "Chars"): every routine there that does not wait, called at its ROM address on the ROM and on the port from
// recorded states, with registers drawn from the state and prep() forcing the branches (cursor positions, slots and
// pages, modes, characters, stat values and deltas, slides, levels at and past the cap, EXP pools, names with
// diacritics, digit strings with blanks). The registers compared are the ones each port says it returns (the hook
// adapter's HOOK_TRACE), plus all memory.
// States: the character-select and character-data recordings, e.g.
//   node web/tests/port_routines.mjs "Chars " --rec out/port/cs_singles.mtrec,out/port/cs_doubles.mtrec,\
//     out/port/cs_story_new.mtrec,out/port/cs_matchtype.mtrec,out/port/cd_levelup.mtrec,out/port/cd_status.mtrec,\
//     out/port/cd_erase.mtrec --every 37
// (char_select routines run on the cs_* states, char_data routines on the cd_* ones; with other recordings, on all).
import { RAM_FIELDS } from "../../js/port/fields.js";
import { rng, pick } from "./routines_menus_common.mjs";
import { HOOK_TRACE } from "../../js/port/menus/char_select/defs.js";
import { HOOKS as CHAR_SELECT } from "../../js/port/menus/char_select/index.js";
import { HOOKS as CHAR_DATA } from "../../js/port/menus/char_data/index.js";
import { MAIN, PARTNER, PATCH } from "../../js/port/menus/char_data/patches.js";
import { hookKey } from "../../js/port/port.js";
import { loadRom } from "../engine/corpus.mjs";

const FIELD = Object.fromEntries(RAM_FIELDS.map(([n, bank, addr, size]) => [n, { bank, addr, size }]));
const at = name => { if (!FIELD[name]) throw new Error(`no field ${name}`); return FIELD[name].addr; };
// a byte into WRAM: at a field (its own bank) or at an address of a given bank
const wx = (mem, bank, a, v) => { a &= 0xFFFF; if (a >= 0xD000 && a < 0xE000) mem.wram[bank || 1][a - 0xD000] = v & 0xFF; else mem.write(a, v & 0xFF); };
const wf = (mem, name, v, off = 0) => wx(mem, FIELD[name] ? FIELD[name].bank : 0, at(name) + off, v);
const wf16 = (mem, name, v, off = 0) => { wf(mem, name, v, off); wf(mem, name, v >> 8, off + 1); };
const REGS = new Set(["a", "f", "b", "c", "d", "e", "h", "l"]);
const regNames = out => {
  const r = new Set();
  for (const k of Object.keys(out && typeof out === "object" ? out : {})) {
    if (REGS.has(k)) r.add(k);
    else if (k === "bc" || k === "de" || k === "hl") { r.add(k[0]); r.add(k[1]); }
  }
  return [...r];
};

// ---- the entries ----
// E(name, bank, addr, { regs(r, s), prep(mem, r, s), n, recs, wram, ignore }): n: every n-th of the matching states
export const ROUTINES = [];
let salt = 0;
function E(name, bank, addr, { regs = () => ({}), prep = null, n = 3, recs = null, active = null, wram, ignore, skip = [] } = {}) {
  const k = ++salt * 7919, off = salt % n;
  let i = 0;
  const entry = {
    name: `Chars ${name}`, bank, addr, wram, ignore, out: [],
    when: s => (!recs || recs.test(s.rec) || !/^c[sd]_/.test(s.rec)) && (!active || active(s)) && (i++ % n) === off,
    regs: s => {
      const r = rng(s, k), g = { a: r(256), f: r(16) << 4, bc: r(0x10000), de: r(0x10000), hl: r(0x10000), ...regs(r, s) };
      for (const [p, hi, lo] of [["bc", "b", "c"], ["de", "d", "e"], ["hl", "h", "l"]]) {
        if (!(hi in g)) g[hi] = g[p] >> 8;
        if (!(lo in g)) g[lo] = g[p] & 0xFF;
      }
      return { a: g.a & 0xFF, f: g.f & 0xF0, b: g.b & 0xFF, c: g.c & 0xFF, d: g.d & 0xFF, e: g.e & 0xFF, h: g.h & 0xFF, l: g.l & 0xFF };
    },
    prep(mem, s) {
      mem.hram[0x16] = mem.svbk;
      mem.ie = 0;                                            // (no VBlank in the middle of the ROM's run)
      if (prep) prep(mem, rng(s, k + 1), s);
    },
    js(P, regs) {
      if (!P.hooks.has(hookKey(bank, addr))) throw new Error(`no port hooked at ${bank.toString(16)}:${addr.toString(16)}`);
      HOOK_TRACE.out = null;
      P.ime = false;
      const ret = P.callRom(bank, addr, regs);
      entry.out = regNames(HOOK_TRACE.out).filter(r => !skip.includes(r));   // the registers the port gives as its results
      return ret;
    },
  };
  ROUTINES.push(entry);
}

// ---- randomized state ----
const MAP = 0xD000;
const mapAt = r => MAP + r(0x300);                          // a cell of a screen map (WRAM 2 / 3 at $D000)
const DIGITS = [0x20, 0x30, 0x31, 0x35, 0x39];
function csPrep(mem, r) {
  wf(mem, "charSelectSlot", r(4));
  wf(mem, "charSelectIsPartner", r(2));
  wf(mem, "charSelectMode", pick(r, [0, 1, 0, 1, r(6)]));
  wf(mem, "charSelectHandedness", r(2));
  wf(mem, "charGridPage", r(4));
  wf(mem, "charGridPageCount", 1 + r(4));
  wf(mem, "menuCursorX", r(5)); wf(mem, "menuCursorY", r(4));
  wf(mem, "menuCursor2X", r(5)); wf(mem, "menuCursor2Y", r(4));
  wf(mem, "menuInputPressed", pick(r, [0x10, 0x20, 0x40, 0x80, 0x01, 0x02, 0x00, 0x11, r(256)]));
  wf(mem, "cpuDifficultyCursor", r(3));
  wf(mem, "matchIsDoubles", r(2));
  for (let i = 0; i < 4; i++) {
    wf(mem, "charSelectSlotChars", pick(r, [0, 1, 2, 3, 4, 8, 0x0F, 0xFF]), i);
    wf(mem, "charSelectSlotDifficulty", r(3), i);
    wf(mem, "charSelectSlotLeftHanded", r(2), i);
  }
}
function cdPrep(mem, r) {
  const slot = r(2);
  wf(mem, "storyCharacterSlot", slot);
  wf(mem, "charDataViewOnly", pick(r, [0, 0, 1]));
  wf(mem, "charDataPage", r(5));
  wf(mem, "charDataConfirmState", r(2));
  wf(mem, "charDataPointsLeft", r(6));
  wf(mem, "charDataRevealStep", r(4));
  wf(mem, "charDataRevealTimer", r(256));
  wf(mem, "charDataFlushChunk", r(3));
  wf(mem, "charDataLevelPreview", r(2));
  wf(mem, "charDataPageArrowMode", pick(r, [0, 1, 2, r(4)]));
  wf(mem, "charDataArrowHold", pick(r, [0, 0, 4, 8, 0x3C, 0x40, r(256)]));
  wf(mem, "charDataArrowPhase", r(256));
  wf16(mem, "charDataStatsSlideX", pick(r, [0, 0, 0xA8, 0xFF60, 0xFFE0, 0x0020, 0x00A0, r(0x10000)]));
  wf16(mem, "charDataValuesSlideX", pick(r, [0, 0, 0xA8, 0xFF60, 0x0040, 0x00A0, r(0x10000)]));
  for (let i = 0; i < 11; i++) {
    wf(mem, "charDataStatDeltas", pick(r, [0, 0, 1, 2, 0xFF, 0xFE]), i);
    wf(mem, "charDataRacketDeltas", pick(r, [0, 0, 1, 2, 3, 0xFF, 0xFE, 0xFD]), i);
    wf(mem, "charDataStatsNoRacket", r(25), i);
    wf(mem, "charDataStats", 1 + r(25), i);
  }
  for (let i = 0; i < 4; i++) wf(mem, "charDataLevels", pick(r, [0, 1, 9, 10, 15, r(100)]), i);
  wf(mem, "equippedRacket", pick(r, [0, 0x01, 0x10, 0x11, r(256)]));
  wf(mem, "charDataSyncSource", r(2));
  for (const page of ["charStatPageMain", "charStatPagePartner"]) for (let i = 0; i < 13; i++) wf(mem, page, pick(r, DIGITS), i);
  for (let i = 0; i < 6; i++) wf(mem, "charStatPageShown", pick(r, DIGITS), i);
  const total = 1 + r(0xFFFF);
  wf16(mem, "expPoolTotal", total); wf16(mem, "expPoolRemaining", r(total + 1));
  for (const base of [0, 15]) {
    wf(mem, "expScreenCharStats", pick(r, [1, 2, 9, 10, 50, 99, 0x64, 0x65]), base);
    const needed = 1 + r(0xFFFF);
    wf16(mem, "expScreenCharStats", needed, base + 1);
    wf16(mem, "expScreenCharStats", r(needed + 1), base + 4);
  }
  mem.hram[0x0C] = r(256);                                   // hVBlankCounter ($FF8C)
}
// a frame task registered in the state (wFrameTasks, $C1C0: 16 entries [active, routine, bank]): the screen it
// belongs to is up, its RAM set up
const task = (s, bank, addr) => {
  const w = s.m.mem.wram[0];
  for (let i = 0; i < 16; i++) { const e = 0x1C0 + i * 4; if (w[e] && w[e + 1] === (addr & 0xFF) && w[e + 2] === addr >> 8 && w[e + 3] === bank) return true; }
  return false;
};
const onGrid = s => task(s, 0x38, 0x4E52) && !task(s, 0x38, 0x4BAC) && !task(s, 0x38, 0x7090);   // (the bg scroll, alone)
const onCharScreen = s => task(s, 0x38, 0x4BAC);                                                  // DrawCharacterSelectChars
const onMatchType = s => task(s, 0x38, 0x458D);                                                   // ...DrawMatchTypeOptionBoxes
const cs = { prep: csPrep, recs: /^cs_/, active: onGrid };
// the character-select screen (character_38): its cursor and the pair shown (main / partner, in WRAM 2)
// (one row of two: with the pair flag, an index 0-3 into SelectedCharWramBankTable)
const charScreen = { recs: /^cs_/, active: onCharScreen, n: 1, prep: (mem, r) => { wf(mem, "menuCursorX", r(2)); wf(mem, "menuCursorY", 0); wx(mem, 2, at("charSelectIsPartner"), r(2)); } };
const cd = { prep: cdPrep, recs: /^cd_/ };
const both = (a, b) => (mem, r, s) => { a(mem, r, s); b(mem, r, s); };

// ---- char_select (banks $38, $1B) ----
const CS_PLAIN = [
  "AdvanceToNextPlayerSlot:5c47", "RetreatToPreviousPlayerSlot:5c63", "GetGridSlotFromCursor:5cb7",
  "BuildVisiblePageSpriteList:5ce5", "BuildCreatedCharRecords:5d83", "ResolveSelectedCharIds:5e6e",
  "InitMatchCharsFromSelection:5ea6", "ApplyCpuDifficultyToCharRecords:5f4c", "ApplyHandednessToCharRecords:601c",
  "CacheStorySlotNames:605b", "CompactRosterGridEntries:60ec", "CompactMarioCastGridEntries:6146",
  "CountCharGridEntries:6192", "SetCharGridPageCount:61cb", "BuildCharUnlockFlags:5a82",
  "FillCharGridPaletteIndices:5bb7", "AddCreatedCharsToCharGrid:5bd9", "ClearPlayerSlotPortrait:55ab",
  "DrawPlayerSlotLeftHandedMark:567a", "DrawPlayerSlotDifficultyMark:5693", "GetPlayerSlotBoxAddress:56ad",
  "RefreshCharInfoPanel:575e", "DrawCharSelectSlotLabel:591b", "DrawCharGridSlotIcons:598b", "InitCharGridState:5a1b",
  "DrawCharGridSlotPrompt:5424", "RunCpuDifficultySubmenu:6216", "CloseCpuDifficultyPanel:62c8",
  "HandleCpuDifficultyInput:630f", "DrawCpuDifficultyCursorBox:633b", "OpenCpuDifficultyPanel:636d",
  "QueueCpuDifficultyPanelToVram:6396", "DrawCharGridCursorBox:4f4b", 
  "HandleCharGridDpad:5195", "MoveCharGridCursorUp:51f4", "MoveCharGridCursorDown:521c",
  "MoveCharGridCursorRight:525e", "MoveCharGridCursorLeft:528b", "HandleCharGridButtons:52b9",
  "ConfirmCharGridSelection:5302", "CancelCharGridSelection:53b0", "DrawCharGridWaitBanner:549a",
  "DrawCharGridScrollArrows:54cc", "DrawCharGridCharSprites:5545", "ProcessLinkSelectCommand:6528",
  "MoveLinkCursorUp:6d0b", "MoveLinkCursorDown:6d25", "MoveLinkCursorRight:6d58", "MoveLinkCursorLeft:6d77",
  "Unused_38_RetreatLinkGridSelection:6d97", "Unused_38_ConfirmRemoteGridSelection:6dc4",
  "WaitLinkSelectStartupFrames:6e04", "Unused_38_DrawCharSelectCursorBox:490c", 
  
  
  
  "TickMenuBgScrollTask_38:4e52",
  "Unused_38_WramBank3Nop:4e56", "UpdateAnimatedTilesTask_38:4408", 
  
  
  "HandleNameEntryCursorMove:7072", "DrawNameEntryCursor:7090", "DrawEnterNameLabel:7159",
  "GetNameEntryBottomRowAction:7220", "SnapNameEntryCursorRight:723c", "SnapNameEntryCursorLeft:725b",
];
for (const e of CS_PLAIN) { const [name, addr] = e.split(":"); E(name, 0x38, parseInt(addr, 16), cs); }
for (const e of ["LoadCharSelectCharPalettes:492c", "LoadHighlightedCharPalette:4949", "RefreshCharacterSelectHighlight:4aae",
  "DrawCharacterSelectPrompt:4acf", "InitCharacterSelectChars:4b21", "DrawCharacterSelectChars:4bac",
  "SetCharSelectAnimations:4d14", "ReloadSelectedCharGfx:4d66", "TickCharSelectIdleAnim:4d9b", "GetSelectedCharWramBank:4dfa",
  "DrawCharacterSelectCursor:4e23"]) { const [name, addr] = e.split(":"); E(name, 0x38, parseInt(addr, 16), charScreen); }
// the unused match-type menu: on its own screen (out/port/cs_matchtype.mtrec)
for (const e of ["Unused_38_DrawMatchTypeOptionBoxes:458d", "Unused_38_RefreshMatchTypeLabelRow:4666",
  "Unused_38_DrawMatchTypeOptionLabel:4722", "Unused_38_AdjustMatchTypeSetting:474f"]) {
  const [name, addr] = e.split(":");
  E(name, 0x38, parseInt(addr, 16), { recs: /^cs_matchtype/, active: onMatchType, n: 1,
    prep: (mem, r) => {
      wf(mem, "menuCursorX", 0); wf(mem, "menuCursorY", r(3));
      wf(mem, "menuInputPressed", pick(r, [0x10, 0x20, 0x40, 0x80, 0, r(256)]));
      wf(mem, "matchFormatDoubles", r(2)); wf(mem, "matchFormatGames", r(2)); wf(mem, "matchFormatSets", r(3));
    } });
}
// (SetupCharGridScreen, SetupCharacterSelectScreen, Unused_38_SetupMatchTypeMenuScreen and SetupNameEntryScreen run
// past this test's 2M-step limit on the ROM side, the LCD off and graphics decompressed; the lockstep runs them in the
// cs_* recordings and cs_matchtype.)
const S38 = (name, addr, o) => E(name, 0x38, addr, { ...cs, ...o });
S38("Unused_38_TestAndClearGridEntryTaken", 0x5D25, { regs: r => ({ c: r(5), d: r(4), e: r(20) }) });
S38("TestAndSetGridEntryTaken", 0x5D42, { regs: r => ({ c: r(5), d: r(4), e: r(20) }) });
S38("GetGridEntryTakenPtr", 0x5D60, { regs: r => ({ c: r(5), d: r(4), e: r(20) }) });
S38("IsCreatedCharId", 0x6013, { regs: r => ({ a: pick(r, [0, 0x7F, 0x80, 0x81, 0x82, 0x83, 0xFF, r(256)]) }) });
S38("LoadCachedStorySlotName", 0x60B9, { regs: r => ({ b: r(4) }) });
S38("NeedsCpuDifficultyPrompt", 0x61F7, { regs: r => ({ c: r(5) }) });
S38("IsMarioCastCharacter", 0x6208, { regs: r => ({ c: pick(r, [0, 3, 4, 8, 0x10, 0x1F, 0x80, r(256)]) }) });
S38("BuildCharGridFromUnlockFlags", 0x5B43, { regs: () => ({ hl: at("charUnlockFlags") }), wram: 3 });
S38("DrawPlayerSlotPortrait", 0x5612, { regs: r => ({ b: r(5) }) });
S38("WriteCharPortraitTiles", 0x5712, { regs: r => ({ b: r(0x20), c: r(8), de: MAP + r(0x3C0) }) });
S38("LoadAllCharPortraitTiles", 0x5746, { regs: r => ({ de: pick(r, [0x8000, 0xA800]) }), n: 6 });
S38("DrawCreatedCharStats", 0x57DD, { regs: r => ({ c: pick(r, [0x80, 0x81, 0x82]) }) });   // (a created character)
S38("DrawCharNameAndType", 0x58CD, { regs: r => ({ c: pick(r, [0, 3, 0x0C, 0x1F, 0x80, 0x81, 0x82, r(256)]) }) });
S38("WriteSlotIconTiles", 0x59FA, { regs: r => ({ c: r(5), b: r(4), de: MAP + r(0x3C0) }) });
S38("QueueCharGridCharSprite", 0x5589, { regs: r => ({ b: r(0x20), c: r(8), de: r(0x10000) }) });
S38("UpdateCharSelectCharSprite", 0x4CE2, { regs: () => ({ hl: 0xDF00 }), wram: 4 });
S38("Unused_38_ClearWram3Row64", 0x43DB, { regs: r => ({ hl: MAP + r(0xFC0) }) });
S38("Unused_38_ClearWram3Row64Alt", 0x43F1, { regs: r => ({ hl: MAP + r(0xFC0) }) });
const NAME_AT = 0xCF40;                                     // a string for the routine (in the stack page: not compared)
const putName = (mem, r, chars) => { const n = 1 + r(8); for (let i = 0; i < n; i++) mem.write(NAME_AT + i, pick(r, chars)); mem.write(NAME_AT + n, 0); };
S38("DrawNameWithDiacritics_38", 0x440C, {
  regs: r => ({ hl: NAME_AT, de: MAP + 0x40 + r(0x300) }), wram: 3,
  prep: both(csPrep, (mem, r) => {
    putName(mem, r, [0x41, 0x42, 0x61, 0xDE, 0xDF, 0x20]);
    for (let i = 0; i < 0x400; i++) if (r(4) === 0) mem.wram[3][i] = pick(r, [0x03, 0x05]);
  }),
});
S38("DrawDecimalNumber", 0x4445, { regs: r => ({ hl: pick(r, [0, 7, 99, 100, 0xFFFF, r(0x10000)]), a: pick(r, [0, 1, 2, 3, 5]), de: MAP + r(0x300) }) });
S38("CopyDecimalStringToTilemap", 0x4466, {
  regs: r => ({ hl: NAME_AT, de: MAP + r(0x300) }),
  prep: both(csPrep, (mem, r) => putName(mem, r, [0x20, 0x2D, 0x30, 0x35, 0x39, 0x41])),
});
S38("WriteDecimalDigitTile", 0x4470, { regs: r => ({ a: pick(r, [0x20, 0x2D, 0x2F, 0x30, 0x39, 0x41, r(256)]), de: MAP + r(0x300) }) });
S38("DrawNameEntryCharGrid", 0x717C, { regs: () => ({ hl: 0x71B6 }) });   // NameEntryCharset_38
S38("QueueNameEntryCursorSprites", 0x727A, { regs: r => ({ de: r(0x10000) }) });
const CS_1B = ["Unused_1b_LoadCharSelectNavGrid:5fd4", "Unused_1b_LoadCharSelectRosterTable:5fe1",
"Unused_1b_StartCharSelectCursorTask:6029",
  "Unused_1b_UpdateCharSelectCursorTask:6035", "Unused_1b_DrawCharSelectPrompt:6045",
"Unused_1b_MoveCharSelectCursor:6192"];
for (const e of CS_1B) { const [name, addr] = e.split(":"); E(name, 0x1B, parseInt(addr, 16), cs); }
// (Unused_1b_LoadCharSelectScreenGfx is left to the lockstep-free reading: it decompresses CharSelectNavGridTable,
// which is not LZ data, past this test's 2M-step limit on the ROM side.)
// the roster the unused screen loads (Unused_1b_LoadCharSelectRosterTable: CharSelectRosterTable, 1B:5F9C)
const ROM = loadRom();
const rosterPrep = (mem, r) => {
  for (let i = 0; i < 0x80; i++) wf(mem, "charSelectRoster", ROM[0x1B * 0x4000 + 0x5F9C - 0x4000 + i], i);
  wf(mem, "charSelectChar", r(8));
};
E("Unused_1b_DrawCharSelectMugshots", 0x1B, 0x606F, { ...cs, prep: both(csPrep, rosterPrep), n: 6 });
E("Unused_1b_FindCharSelectRosterEntry", 0x1B, 0x5FC4, { ...cs, regs: r => ({ a: r(8), de: pick(r, [0, 2, 6]) }) });
E("Unused_1b_GetCharSelectRosterField", 0x1B, 0x5FCB, { ...cs, regs: r => ({ a: r(8), de: pick(r, [0, 2, 6]) }) });

// ---- char_data (banks $1C, $1A, $1D) ----
const CD_PLAIN = [
  [0x1C, "CharDataScreen_BuildTilemap:41dc"], [0x1C, "CharDataScreen_LoadUIGraphics:4208"],
  [0x1C, "CharDataScreen_DrawStats:42f6"], [0x1C, "CharDataScreen_DrawPortrait:459a"],
  [0x1C, "CharDataScreenAnimTask:45fa"], [0x1C, "DrawCharStatRows:489b"], [0x1C, "BackupCharDataScreenRow:48c9"],
  [0x1C, "RestoreCharDataScreenRow:48ec"], [0x1C, "WriteCharStatsToDisplayBuffer:49eb"],
[0x1C, "LoadCharStats:4c43"], [0x1C, "CharDataScreen_DrawPageColumns:4dd6"],
  [0x1C, "DrawStatValueSprites:4e54"], [0x1C, "DrawRemainingPointsSprite:5049"], [0x1C, "DrawConfirmSelectionCursor_1c:53a3"],
  [0x1C, "SelectCharDataConfirmSlot:54e3"], [0x1C, "DrawStatArrowIndicators:54f2"], [0x1C, "CharDataScreen_LoadScreen:7116"],
  [0x1C, "LoadCharDataScreenTilemaps:728b"], [0x1C, "StartCharDataScreenAnimTask:72ec"],
  [0x1C, "StopCharDataScreenAnimTask:72f5"], [0x1C, "BackupCharData:7300"], [0x1C, "RestoreCharData:731f"],
  [0x1C, "LoadCharDataScreenGraphics:73f4"], [0x1C, "LoadCharDataScreenBgAndPalettes:73fb"],
  [0x1C, "LoadCharDataScreenMugshots:748d"],
[0x1A, "Unused_1a_LoadCharViewerMugshot:7096"],
  [0x1A, "Unused_1a_ApplyCharViewerPalette:70c0"], [0x1A, "DrawConfirmSelectionCursor_1a:7a1d"],
  [0x1A, "CharDataScreen_BuildStats:7ab5"], [0x1A, "CharDataScreen_LoadGfx:7b85"], [0x1A, "DrawStatChangeArrows:7be5"],
  [0x1D, "ComputeExpProgressBar:59be"], [0x1D, "DrawConfirmSelectionCursor_1d:5afa"],
[0x1D, "DrawCharDataConfirmPrompt:5c0b"],
  [0x1D, "StartCharDataValuesSyncTask:5c15"], [0x1D, "StopCharDataValuesSyncTask:5c1e"],
  [0x1D, "CharDataScreenBgScrollTask:40cc"], [0x1D, "InitDrillWorkRam:40d0"], [0x1D, "BuildCharDataScreenPages:411e"],
  [0x1D, "LoadCharDataScreenPageGraphics:4175"], [0x1D, "BuildCharDataSummaryFields:444d"],
  [0x1D, "CharDataValuesSyncTask:48c7"], [0x1D, "LoadBasePageIntoWorkTilemap:4aa9"],
  [0x1D, "BuildCharDataSummaryPage:4acc"], [0x1D, "BuildMainCharStatPage:4aeb"], [0x1D, "BuildPartnerStatPage:4b50"],
  [0x1D, "DrawCharDataPageArrowsTask:4c04"], [0x1D, "SlideCharDataArrowsOutTask:4e5e"],
  [0x1D, "SlideCharDataArrowsInTask:4e76"], [0x1D, "BuildCharStatDisplay:4e8d"], [0x1D, "DrawCharStatDigitsTask:57d2"],
  [0x1D, "BuildExpDistributionScreen:6977"], [0x1D, "DrawExpPoolReadout:6ace"], [0x1D, "DrawExpPoolGauge:6aef"],
  [0x1D, "InitExpScreenCharStats:6b7b"], [0x1D, "DrawExpScreenLevelNumber:6de7"], [0x1D, "DrawExpScreenLevelBar:6ea2"],
];
const HEAVY = /LoadScreen|Graphics|BuildTilemap|LoadUIGraphics|Pages|Video|ExpDistributionScreen|Mugshots|BgAndPalettes/;
// (InitCharDataScreenVideo, 1D:5BE3, runs past this test's 2M-step limit on the ROM side: the menu font and all
// the pages; the lockstep runs it in cd_status and cd_erase.)
for (const [bank, e] of CD_PLAIN) { const [name, addr] = e.split(":"); E(name, bank, parseInt(addr, 16), { ...cd, n: HEAVY.test(name) ? 8 : 3 }); }
const SD = (name, bank, addr, o) => E(name, bank, addr, { ...cd, ...o });
SD("CharDataScreen_InitState", 0x1C, 0x40FB, { regs: r => ({ c: r(2) }) });
// (hStatDeltaRecordCopy: ComputeLevelUpStatDeltas keeps its stack buffer's address there, which depends on the depth
// of the calls on the way, not on what the routine does)
SD("LoadCharStatsWithLevelUpDeltas", 0x1C, 0x4A94, { ignore: (b, a) => b === -2 && (a === 0xFFB2 || a === 0xFFB3) });
SD("CopyWram1ToWram3", 0x1C, 0x42CC, { regs: r => ({ hl: MAP + r(0x800), bc: 1 + r(0x200) }) });
SD("CopyWram1ToWram2", 0x1C, 0x42E1, { regs: r => ({ hl: MAP + r(0x800), bc: 1 + r(0x200) }) });
SD("CharDataScreen_WriteStatNumber", 0x1C, 0x44CC, { regs: r => ({ de: MAP + r(0x500) }) });
SD("CharDataScreen_DrawStatBar", 0x1C, 0x4502, { regs: r => ({ a: r(100), c: r(2), de: MAP + r(0x500) }) });
const RUN_TABLES = [[0x57B6, 0xD240], [0x56B9, 0xD240], [0x57A9, 0xD280], [0x581C, 0xD2D0], [0x58CB, 0xD310], [0x58EA, 0xD370],
  [0x5928, 0xD380], [0x590D, 0xD3A0], [0x5943, 0xD3E0], [0x597B, 0xD410], [0x5948, 0xD410]];
SD("BlitTilemapRunsFromTable", 0x1C, 0x490F, { regs: r => { const [hl, bc] = pick(r, RUN_TABLES); return { hl, bc }; } });
SD("GetStatDigitSpritePos", 0x1C, 0x4FCE, { regs: r => ({ a: r(11), de: r(0x10000) }) });
SD("OffsetStatSpriteY", 0x1C, 0x5094, { regs: r => ({ e: r(256) }) });
SD("QueueStatChangeArrow", 0x1C, 0x555C, { regs: r => ({ a: pick(r, [0, 1, 2, 0xFF, 0x80, r(256)]), d: r(256), e: r(256) }) });
// (its flags are DrawCharSprite's, the match port's hook at 08:650A: not compared, see the report)
SD("Unused_1a_DrawCharViewerCharSprite", 0x1A, 0x7012, { skip: ["f"] });
SD("CopyBank1ToBank3BufferAlt", 0x1A, 0x7A3D, { regs: r => ({ hl: MAP + r(0x800), bc: 1 + r(0x200) }) });
SD("CopyBank1ToBank2BufferAlt", 0x1A, 0x7A52, { regs: r => ({ hl: MAP + r(0x800), bc: 1 + r(0x200) }) });
SD("ApplyTilemapPatchList_1a", 0x1A, 0x7A67, { regs: () => ({ hl: 0x7E46, bc: 0xDEA0 }) });   // CharDataConfirmScreenTable0
const DELTAS = [1, 2, 3, 5, 0x7F, 0xFF, 0xFE, 0xFD, 0x80, r => r(256)];
const delta = r => { const d = pick(r, DELTAS); return typeof d === "function" ? d(r) : d; };
SD("GetStatArrowSpriteAttr", 0x1A, 0x7DEE, { regs: r => ({ a: delta(r) }) });
SD("GetStatArrowTile", 0x1A, 0x7DF5, { regs: r => ({ a: delta(r) }) });
SD("GetStatArrowExtraTile", 0x1A, 0x7E15, { regs: r => ({ a: delta(r) }) });
SD("ComputeStatArrowSpriteX", 0x1A, 0x7E23, { regs: r => ({ a: r(256), h: r(4), d: r(256) }) });
SD("OffsetStatArrowSpriteX", 0x1A, 0x7E38, { regs: r => ({ a: delta(r), d: r(256) }) });
SD("ApplySlideOffsetToSpriteX", 0x1D, 0x5997, { regs: r => ({ hl: pick(r, [at("charDataStatsSlideX"), at("charDataValuesSlideX")]), d: r(256) }) });
SD("GetCharDataDigitSprite", 0x1D, 0x59B5, { regs: r => ({ a: pick(r, [0x30, 0x35, 0x39, r(256)]) }) });
SD("GetSummaryExpDigitSprite", 0x1D, 0x4A0B, { regs: r => ({ a: pick(r, [0x30, 0x35, 0x39, r(256)]) }) });
SD("ScaleValueToBar", 0x1D, 0x59DC, {                       // value <= total (more takes the ROM's extra pop)
  regs: r => { const total = 1 + r(0xFFFF); return { hl: total, de: pick(r, [0, total, r(total + 1)]), b: pick(r, [0x40, 0x58, 1, r(0xFF)]) }; },
});
SD("DrawExpProgressBarTiles", 0x1D, 0x59FC, { regs: r => ({ a: pick(r, [0, 1, 7, 8, 9, 63, 64, r(65)]), de: MAP + r(0x380) }) });
SD("BuildCharDataConfirmScreen", 0x1D, 0x5B1A, { regs: r => ({ a: r(2) }), n: 8 });
SD("CopyWram1ToWram3CharData", 0x1D, 0x4423, { regs: r => ({ hl: MAP + r(0x800), bc: 1 + r(0x200) }) });
SD("CopyWram1ToWram2CharData", 0x1D, 0x4438, { regs: r => ({ hl: MAP + r(0x800), bc: 1 + r(0x200) }) });
SD("CopyWram1ToWram3ExpScreen", 0x1D, 0x6AA4, { regs: r => ({ hl: MAP + r(0x800), bc: 1 + r(0x200) }) });
SD("CopyWram1ToWram2ExpScreen", 0x1D, 0x6AB9, { regs: r => ({ hl: MAP + r(0x800), bc: 1 + r(0x200) }) });
SD("PlotTilesAtOffsets", 0x1D, 0x4771, { regs: r => ({ hl: pick(r, [PATCH.CharDataSummaryFieldsTilePlot0, PATCH.CharDataSummaryFieldsTilePlot1]), de: MAP + r(0x700), b: r(256) }) });
SD("DrawFourTileFlagLabel", 0x1D, 0x4793, { regs: r => ({ a: r(3), hl: MAP + r(0x700) }) });
// a name with diacritics in a story record (WRAM 0), and the cells above its letters blank or not
// (letters, each maybe followed by a mark: two marks in a row would find the first one's tile above, not the box's
// blank, and take WriteExpScreenStringTiles' extra pop)
const putRecordName = (mem, r, base, chars) => {
  const letters = chars.filter(c => c !== 0xDE && c !== 0xDF), n = 1 + r(5);
  let at = base;
  for (let i = 0; i < n; i++) { mem.write(at++, pick(r, letters)); if (r(2)) mem.write(at++, pick(r, [0xDE, 0xDF])); }
  mem.write(at, 0);
};
SD("WriteNameStringTiles", 0x1D, 0x47B0, {
  regs: r => ({ hl: pick(r, [0xC900, 0xC940]), de: MAP + 0x40 + r(0x700), c: pick(r, [0x0A, 0x0E, 0x1F]) }),
  prep: both(cdPrep, (mem, r) => {
    for (const base of [0xC900, 0xC940]) putRecordName(mem, r, base, [0x41, 0x4D, 0x61, 0xDE, 0xDF]);
    for (let i = 0; i < 0x800; i++) if (r(3) === 0) mem.wram[3][i] = pick(r, [0, 0, 0x41, 0x73]);
  }),
});
SD("NameTilePtrUpOneRow", 0x1D, 0x47FE, { regs: r => ({ de: r(0x10000), c: pick(r, [0, 0x0A, 0x0E, r(256)]) }) });
SD("NameTilePtrDownOneRow", 0x1D, 0x4806, { regs: r => ({ de: r(0x10000), c: pick(r, [0xFF, 0x0A, 0x0E, r(256)]) }) });
SD("FormatExp24BitDecimal", 0x1D, 0x480E, {
  regs: r => ({ hl: pick(r, [0xC92C, 0xC96C]) }),
  prep: both(cdPrep, (mem, r) => {
    for (const base of [0xC92C, 0xC96C]) { mem.write(base, r(256)); mem.write(base + 1, r(256)); mem.write(base + 2, pick(r, [0, 0, 1, 2, 3, 0x10, r(256)])); }
  }),
});
SD("SaveWorkTilemapToPage", 0x1D, 0x4A14, { regs: r => ({ a: r(5) }) });
const PATCH_LISTS = [[MAIN[2], 0xD7E0], [MAIN[14], 0xDA20], [MAIN[26], 0xDA20], [PARTNER[5], 0xD7E0], [PARTNER[20], 0xDC60],
  [PATCH.DrillDisplayData_1d, 0xD390], [PATCH.StatPageTilemapPatch0, 0xD390], [PATCH.CharDataConfirmPromptTilemapPatch, 0xD580],
  [PATCH.CharDataSummaryPageTilemapPatch0, 0xD3C0], [PATCH.StatPageTilemapPatch6, 0xD7E0]];
SD("ApplyTilemapPatchList", 0x1D, 0x4BB6, { regs: r => { const [hl, bc] = pick(r, PATCH_LISTS); return { hl, bc }; } });
SD("BobArrowSpriteLeft", 0x1D, 0x4C60, { regs: r => ({ d: r(256) }) });
SD("BobArrowSpriteRight", 0x1D, 0x4C80, { regs: r => ({ d: r(256) }) });
SD("InitLevelUpScreenState", 0x1D, 0x6934, { regs: r => ({ hl: r(0x10000) }) });
SD("ExpGaugePtrUpOneRow", 0x1D, 0x6B60, { regs: r => ({ de: r(0x10000) }) });
SD("WriteExpScreenStringTiles", 0x1D, 0x6D6A, {               // diacritics only below the box's blanks ($73 / $8F)
  regs: r => ({ hl: pick(r, [0xC900, 0xC940, at("charDataNumberBuffer")]), de: MAP + 0x40 + r(0x700), c: r(256) }),
  prep: both(cdPrep, (mem, r) => {
    for (const base of [0xC900, 0xC940]) putRecordName(mem, r, base, [0x41, 0x4D, 0x61, 0xDE, 0xDF]);
    for (let i = 0; i < 5; i++) wf(mem, "charDataNumberBuffer", pick(r, DIGITS), i);
    wf(mem, "charDataNumberBuffer", 0, 5);
    for (let i = 0; i < 0x800; i++) mem.wram[3][i] = pick(r, [0x73, 0x8F]);
  }),
});
SD("ExpScreenTilePtrUpOneRow", 0x1D, 0x6DD5, { regs: r => ({ de: r(0x10000) }) });
SD("ExpScreenTilePtrDownOneRow", 0x1D, 0x6DDF, { regs: r => ({ de: r(0x10000) }) });
SD("DrawExpScreenLevelDigit", 0x1D, 0x6E51, { regs: r => ({ a: pick(r, [0x30, 0x35, 0x39]), de: MAP + 0x40 + r(0x700) }) });
SD("ClearExpScreenLevelDigits", 0x1D, 0x6E74, { regs: r => ({ de: MAP + 0x40 + r(0x700) }) });
