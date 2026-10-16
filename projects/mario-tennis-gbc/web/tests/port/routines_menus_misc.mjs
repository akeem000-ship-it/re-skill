// Routine tests for web/js/port/menus/equipment, dictionary, minigame_select, debug and link (run by
// web/tests/port_routines.mjs, filter "Misc "): every routine there that does not wait (and the waiting ones whose
// waits need the LCD on, with the LCD off), called at its ROM address on the ROM and on the port from recorded states,
// with registers drawn from the state and prep() forcing the branches (items owned and equipped, stat lists, tabs and
// cursors, dictionary masks, rows and letters, minigame unlocks, clears, stars and scores, level counts, link roles,
// slots and remote inputs, debug cursors, flags and EXP counters, signed modifiers, names with diacritics). The
// registers compared are all eight (a hook puts back the ones the routine keeps and sets its results; F: Z and C),
// plus all memory.
// Routines that draw on a screen run on the states where that screen is up (its frame task registered).
// States: the recordings of these screens, e.g.
//   node web/tests/port_routines.mjs "Misc " --rec out/port/eq_all.mtrec,out/port/dc_a.mtrec,out/port/dc_b.mtrec,\
//     out/port/ms_grid9.mtrec,out/port/ms_data9.mtrec,out/port/ms_debug.mtrec,out/port/lk_error.mtrec,\
//     out/port/dbg_expgain.mtrec,out/port/dbg_viewer.mtrec,out/port/dbg_menus.mtrec,out/port/cs_singles.mtrec,\
//     out/port/cs_story_new.mtrec,out/port/menus_status1.mtrec --every 31
import { RAM_FIELDS } from "../../js/port/fields.js";
import { rng, pick } from "./routines_menus_common.mjs";
import { HOOK_TRACE } from "../../js/port/menus/char_select/defs.js";
import { hookKey } from "../../js/port/port.js";

const FIELD = Object.fromEntries(RAM_FIELDS.map(([n, bank, addr, size]) => [n, { bank, addr, size }]));
const at = name => { if (!FIELD[name]) throw new Error(`no field ${name}`); return FIELD[name].addr; };
const wx = (mem, bank, a, v) => { a &= 0xFFFF; if (a >= 0xD000 && a < 0xE000) mem.wram[bank || 1][a - 0xD000] = v & 0xFF; else mem.write(a, v & 0xFF); };
const rx = (mem, bank, a) => (a >= 0xD000 && a < 0xE000 ? mem.wram[bank || 1][a - 0xD000] : mem.read(a));
const wf = (mem, name, v, off = 0) => wx(mem, FIELD[name] ? FIELD[name].bank : 0, at(name) + off, v);
const rf = (mem, name, off = 0) => rx(mem, FIELD[name] ? FIELD[name].bank : 0, at(name) + off);
const wf16 = (mem, name, v, off = 0) => { wf(mem, name, v, off); wf(mem, name, v >> 8, off + 1); };
const ALL = ["a", "f", "b", "c", "d", "e", "h", "l"];

// ---- the entries ----
export const ROUTINES = [];
let salt = 0;
function E(name, bank, addr, { regs = () => ({}), prep = null, n = 3, active = null, wram, ignore, skip = [], lcdOff = false } = {}) {
  const k = ++salt * 7919, off = salt % n;
  let i = 0;
  const entry = {
    name: `Misc ${name}`, bank, addr, wram, ignore, out: [],
    when: s => (!active || active(s)) && (i++ % n) === off,
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
      if (lcdOff) mem.write(0xFF40, mem.read(0xFF40) & 0x7F);
      if (prep) prep(mem, rng(s, k + 1), s);
    },
    js(P, regs) {
      if (!P.hooks.has(hookKey(bank, addr))) throw new Error(`no port hooked at ${bank.toString(16)}:${addr.toString(16)}`);
      HOOK_TRACE.out = null;
      P.ime = false;
      const ret = P.callRom(bank, addr, regs);
      entry.out = ALL.filter(r => !skip.includes(r));         // (the hook sets every register: the saved ones and its results)
      return ret;
    },
  };
  ROUTINES.push(entry);
}
const both = (a, b) => (mem, r, s) => { a(mem, r, s); b(mem, r, s); };
// a frame task registered in the state (wFrameTasks, $C1C0: 16 entries [active, routine, bank]): its screen is up
const task = (s, bank, addr) => {
  const w = s.m.mem.wram[0];
  for (let i = 0; i < 16; i++) { const e = 0x1C0 + i * 4; if (w[e] && w[e + 1] === (addr & 0xFF) && w[e + 2] === addr >> 8 && w[e + 3] === bank) return true; }
  return false;
};
const MAP = 0xD000, mapAt = r => MAP + 0x40 + r(0x2C0);
const NAME_CHARS = [0x41, 0x4E, 0x61, 0x7A, 0x20];
const put = (mem, bank, a, list) => list.forEach((v, i) => wx(mem, bank, a + i, v));
const putName = (mem, r, a, bank = 0) => {
  const n = 1 + r(9), out = [];
  for (let i = 0; i < n; i++) { out.push(pick(r, NAME_CHARS)); if (r(4) === 0) out.push(pick(r, [0xDE, 0xDF])); }
  put(mem, bank, a, [...out, 0]);
};
const FLAGS = 0xC9C0;
const input = (mem, r) => {
  const m = pick(r, [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0, 0x11, r(256)]);
  mem.hram[0x11] = m; mem.hram[0x14] = pick(r, [m, 0, r(256)]); mem.hram[0x10] = pick(r, [m, 0, r(256)]);   // hInputPressed / RisingEdge / PlayerInputFlags
  wf(mem, "menuInputPressed", m);
};

// ---- bank $3e: the equipment screens ----
function eqPrep(mem, r) {
  wf(mem, "equippedRacket", r(7) | r(3) << 4);
  mem.write(FLAGS + 12, r(256)); mem.write(FLAGS + 13, r(256));      // the item flags ($61-$68)
  wf(mem, "equipItemKind", r(2));
  wf(mem, "equipStatRowSet", r(3));
  const count = 1 + r(7);
  wf(mem, "equipItemCount", count);
  for (let i = 0; i < 8; i++) wf(mem, "equipItemList", r(i ? 7 : 1), i);
  wf(mem, "equipEquippedIndex", r(count));
  wf(mem, "menuCursorX", r(count)); wf(mem, "menuCursorY", r(2));
  wf(mem, "racketShoesTabIndex", r(2));
  wf(mem, "screenScratch", pick(r, [0, 1, 2, 5]));
  wf(mem, "equipSelectExitTimer", pick(r, [0, 0, 1, 0x44]));
  input(mem, r);
  mem.hram[0x0C] = r(256);                                    // hVBlankCounter
}
const onEquip = s => task(s, 0x3E, 0x59CD) || task(s, 0x3E, 0x59EB), onErase = s => task(s, 0x3E, 0x4E0C);
const onChoice = s => task(s, 0x3E, 0x50F5);
const Q = (name, addr, o = {}) => E(name, 0x3E, addr, { prep: eqPrep, n: 3, ...o });
Q("EraseConfirmCursorSpriteTask", 0x4E0C);
Q("QueueEraseConfirmCursorSprites", 0x4E1C, { regs: r => ({ de: r(0x10000) }) });
Q("AnimateEraseConfirmPalette", 0x4E34, { active: onErase, n: 1 });
Q("RedrawRacketShoesChoiceMenu", 0x4FCF, { active: onChoice, n: 1 });
Q("SetRacketShoesChoicePalette", 0x5038, { regs: r => ({ a: r(2) }) });
Q("DrawRacketShoesChoiceCaption", 0x506D, { active: onChoice, n: 1 });
Q("ChoiceTabCursorSpriteTask", 0x50F5);
Q("SetChoiceTabAttrRect", 0x5165, { regs: r => ({ b: r(3), c: r(2) }), wram: 3 });
Q("RedrawPlayAlonePartnerMenu", 0x52B7, { active: onChoice, n: 1 });
Q("SetPlayAlonePartnerPalette", 0x5320, { regs: r => ({ a: r(2) }) });
Q("DrawPlayAlonePartnerCaption", 0x5355, { active: onChoice, n: 1 });
Q("DrawEquipmentStatusScreen", 0x53CF, { lcdOff: true, n: 8 });
Q("LoadEquipmentStatusWindows", 0x53F1, { lcdOff: true, n: 8 });
Q("SetEquipmentStatusAttrRects", 0x5439);
Q("DrawEquippedRacketPanel", 0x5458, { lcdOff: true, wram: 3 });
Q("DrawEquippedShoesPanel", 0x5486, { lcdOff: true, wram: 3 });
Q("LoadRacketSelectScreen", 0x550D, { lcdOff: true, n: 8 });
Q("LoadShoesSelectScreen", 0x5696, { lcdOff: true, n: 8 });
Q("DrawOwnedItemIcons", 0x5563, { wram: 3 });
Q("DrawItemIcon2x2", 0x557A, { regs: r => ({ c: r(8), de: mapAt(r) }), wram: 3 });
Q("HandleEquipSelectInput", 0x55AF, { lcdOff: true, active: onEquip, n: 1 });
Q("DrawRacketInfoPanel", 0x5624, { lcdOff: true, active: onEquip, n: 1 });
Q("DrawShoesInfoPanel", 0x5704, { lcdOff: true, active: onEquip, n: 1 });
Q("BuildOwnedItemList", 0x5725);
Q("MarkOwnedRackets", 0x575A); Q("MarkOwnedShoes", 0x57A8);
Q("LoadEquipSelectCommon", 0x57F4, { lcdOff: true, n: 8 });
Q("CreateEquipListWindow", 0x5814, { lcdOff: true, n: 6 });
Q("CreateEquipCaptionWindow", 0x5838, { lcdOff: true, n: 6 });
Q("ClearEquipSelectTextRows", 0x5854); Q("FlushEquipSelectTextRows", 0x5899);
Q("Unused_3e_GetEquipSelectTextRowPtr", 0x58BB, { regs: r => ({ b: r(4) }) });
Q("GetHoveredItemId", 0x594A, { wram: 3 }); Q("GetEquippedItemId", 0x595F, { wram: 3 });
Q("DrawEquippedItemStatMods", 0x596E); Q("DrawHoveredItemStatMods", 0x5981);
Q("RenderShoesDescText", 0x599E, { regs: r => ({ c: r(3) }), lcdOff: true, active: onEquip, n: 1 });
Q("RenderRacketDescText", 0x59A4, { regs: r => ({ c: r(7) }), lcdOff: true, active: onEquip, n: 1 });
Q("RenderShoesNameText", 0x59B8, { regs: r => ({ c: r(3), de: MAP + 0xA8 }), lcdOff: true, active: onEquip, n: 1 });
Q("RenderRacketNameText", 0x59BE, { regs: r => ({ c: r(7), de: MAP + 0xA8 }), lcdOff: true, active: onEquip, n: 1 });
Q("EquipListCursorSpriteTask", 0x59CD); Q("EquippedItemMarkerSpriteTask", 0x59EB);
Q("DrawItemStatModList", 0x5A15, { regs: r => ({ a: r(8) }), wram: 3 });
Q("DrawStatModEntry", 0x5A2D, { regs: r => ({ b: r(6), c: r(256), d: pick(r, [0, 1, 2, 3, 4, 5, 6, 7, 0xFF]) }), wram: 3 });
Q("GetItemStatModListPtr", 0x5A44, { regs: r => ({ b: r(8) }) });
Q("DrawStatModLabel", 0x5ACA, { regs: r => ({ b: r(6), d: r(8) }), wram: 3 });
Q("GetStatModLabelTile", 0x5AE2, { regs: r => ({ d: r(8) }) });
Q("GetStatModLabelLen", 0x5AFC, { regs: r => ({ d: r(8) }) });
Q("DrawStatModValue", 0x5B16, { regs: r => ({ b: r(6), d: pick(r, [0xFE, 0x01, 0x83, 0x07, 0x80, r(256)]) }), wram: 3 });
Q("WriteStatModValueTiles", 0x5B2C, { regs: r => ({ d: r(256), hl: mapAt(r) }), wram: 3 });
Q("GetStatModRowAddr", 0x5B3E, { regs: r => ({ b: r(6), e: r(2) }) });

// ---- bank $3f: the tennis dictionary ----
function dcPrep(mem, r) {
  const count = rf(mem, "tennisDictEntryCount") || 1;
  wf(mem, "tennisDictScrollTop", r(count));
  wf(mem, "tennisDictCursorRow", r(6));
  wf(mem, "tennisDictFlags", pick(r, [0, 1, 2, 4, 8, r(256)]));
  wf(mem, "tennisDictSingleEntry", r(2));
  for (const n of ["tennisDictAnimState", "tennisDictAnimTimer", "tennisDictSpriteTimer", "tennisDictSpritePhase", "tennisDictScrollTimer"])
    wf(mem, n, pick(r, [0, 1, 2, 3, 8, r(256)]));
  input(mem, r);
  mem.hram[0x0C] = r(256);
}
const onDict = s => task(s, 0x3F, 0x4E8D);
const D = (name, addr, o = {}) => E(name, 0x3F, addr, { prep: dcPrep, active: onDict, n: 2, ...o });
D("SetTennisDictionaryListFromIndexRow", 0x5417, { prep: both(dcPrep, (mem, r) => wf(mem, "tennisDictCursorRow", r(9))) });
D("GetTennisDictionaryRowFirstLetter", 0x5453, { regs: r => ({ a: r(9) }) });
D("SetTennisDictionaryIndexRowFromList", 0x5468);
D("GetTennisDictionaryLetterRow", 0x54A1, { regs: r => ({ a: r(26) }) });
D("DrawTennisDictionaryIndexCursor", 0x54C8, { regs: r => ({ a: r(2), b: r(9) }) });
D("HandleTennisDictionaryIndexInput", 0x5588, { regs: () => ({ a: 2 }), prep: both(dcPrep, (mem, r) => wf(mem, "tennisDictCursorRow", r(9))) });
D("ResetTennisDictionaryScroll", 0x4244);
D("LoadTennisDictionaryAssetsDefault", 0x425F, { lcdOff: true, n: 6 });
D("LoadTennisDictionaryAssetsChar6", 0x42A0, { lcdOff: true, n: 6 });
D("ClearTennisDictionaryTilemap", 0x42DE);
D("EndTennisDictionaryAnim", 0x4E69); D("StartTennisDictionaryAnim", 0x4E7B);
D("UpdateTennisDictionarySprites", 0x4E8D);
D("FillBytes_3f", 0x50EA, { regs: r => ({ a: r(256), c: pick(r, [1, 7, 0x20, 0]), hl: MAP + r(0x700) }), active: null });
D("CountTennisDictionaryEntries", 0x50F7, { prep: both(dcPrep, (mem, r) => wf(mem, "tennisDictCategoryMask", pick(r, [1, 2, 4, 8, 0x10, 0x1F, r(32)]))) });
D("FindTennisDictionaryListEnd", 0x511A);
D("GetTennisDictionaryEntryIndex", 0x5134, { regs: (r, s) => ({ a: r(Math.max(1, s.m.mem.wram[0][at("tennisDictEntryCount") - 0xC000] || 1)), b: pick(r, [1, 2, 4, 8, 0x10, 0x1F]) }) });
D("GetTennisDictionaryEntryCategory", 0x514A, { regs: (r, s) => ({ a: r(8), b: pick(r, [1, 2, 4, 8, 0x10, 0x1F]) }) });
D("GetTennisDictionarySelectedIndex", 0x517B);
D("ScrollTennisDictionaryToPrevLetter", 0x5192); D("ScrollTennisDictionaryToNextLetter", 0x520F);

// ---- banks $1b / $3b: the minigame screens ----
function mgPrep(mem, r) {
  wf(mem, "menuCursorX", r(3)); wf(mem, "menuCursorY", r(5));
  wf(mem, "selectedMinigame", r(9));
  wf(mem, "savedDataTypeTabIndex", r(2));
  wf(mem, "minigameHighScoreMode", r(2));
  input(mem, r);
  mem.hram[0x0C] = r(256);
}
const onMG = s => task(s, 0x3B, 0x646D), onChart = s => task(s, 0x1B, 0x7827), onType = s => task(s, 0x1B, 0x72A8);
const onLevel2 = s => task(s, 0x1B, 0x6F62), onLevel3 = s => task(s, 0x1B, 0x70ED), onLevel = s => onLevel2(s) || onLevel3(s);
const M = (name, addr, o = {}) => E(name, 0x1B, addr, { prep: mgPrep, n: 3, ...o });
// the chart (data_marks / minigame_data)
M("MapMinigameRowToMugshotSlot", 0x768A, { regs: r => ({ c: r(9) }) });
M("GetMinigameRowTilemapDest", 0x76A1, { regs: r => ({ b: r(5) }) });
M("DrawMinigameDataScrollArrows", 0x76B9, { active: onChart, n: 1 });
M("DrawMinigameDataMarks", 0x76EE, { active: onChart, n: 1, wram: 3 });
M("DrawMinigameClearMarks", 0x76FB, { active: onChart, n: 1, wram: 3 });
M("DrawMinigameStarMarks", 0x7719, { active: onChart, n: 1, wram: 3 });
M("DrawMinigameSpecialMark", 0x7737, { active: onChart, n: 1, wram: 3 });
M("DrawMinigameMarkTile", 0x774C, { regs: r => ({ b: r(3), c: r(5) }), active: onChart, n: 1, wram: 3 });
M("ClearMinigameMarkColumns", 0x77AC, { active: onChart, n: 1, wram: 3 });
M("DrawStarLegendMark", 0x77FB, { active: onChart, n: 1, wram: 3 });
M("DrawMinigameHighScoreNumbers", 0x7827, { active: onChart, n: 1 });
M("DrawMinigameHighScoreNumber", 0x7847, { regs: r => ({ b: r(5), c: r(9) }), active: onChart, n: 1 });
M("CheckMinigameDataScrollable", 0x787F);
M("CompactMinigameDataRows", 0x7896, { active: onChart, n: 1, wram: 3 });
M("TickMenuBgScrollTask_1b", 0x72A4);
M("DrawSavedDataTypeSelectCursor", 0x72A8, { active: onType, n: 1 });
M("DrawSavedDataCursorOption0", 0x72B8, { active: onType, n: 1 }); M("DrawSavedDataCursorOption1", 0x72D9, { active: onType, n: 1 });
M("RedrawSavedDataTypeSelect", 0x7352, { active: onType, n: 1 });
M("DrawSavedDataTypeDescription", 0x7383, { active: onType, n: 1 });
M("LoadSavedDataTypePalette", 0x73B6, { regs: r => ({ a: r(2) }) });
M("BuildMinigameDataScreen", 0x7449, { lcdOff: true, n: 8 });
M("LoadMinigameDataState", 0x74CA, { active: onChart, n: 1 });
M("LoadMinigameClearFlags", 0x74DF, { active: onChart, n: 1 }); M("LoadMinigameStarFlags", 0x751F, { active: onChart, n: 1 });
M("LoadMinigameHighScores", 0x7560, { active: onChart, n: 1 });
M("DrawMinigameDataMugshotsScrolled", 0x7604, { active: onChart, n: 1 });
M("DrawMinigameDataMugshotsStatic", 0x7634, { active: onChart, n: 1 });
M("DrawMinigameDataMugshot", 0x7669, { regs: r => ({ b: r(5), c: r(9) }), active: onChart, n: 1 });
// the level select (level_select / level_variants): its state bytes in WRAM 2's $D000-$D003
const levelPrep = both(mgPrep, (mem, r) => { mem.wram[2][1] = r(3); mem.wram[2][2] = pick(r, [2, 3]); mem.wram[2][3] = r(3); });
M("CountClearedMinigameLevels", 0x6BD3, { wram: 2, prep: both(mgPrep, (mem, r) => { mem.wram[2][0] = r(9); }) });
M("DrawMinigameLevelDescription", 0x6D3D, { prep: levelPrep, active: onLevel, n: 1 });
M("LoadMinigameLevelSelectPalette", 0x6D95, { regs: r => ({ a: r(3) }) });
M("FlushLevelSelectTextRows", 0x6DC6, { active: onLevel, n: 1 });
M("ClearMinigameLevelDescriptionRow", 0x6DEB, { active: onLevel, n: 1 });
M("GetMinigameLevelColumnCount", 0x6E1C, { prep: levelPrep });
M("RedrawMinigameLevelSelect2", 0x6F04, { prep: levelPrep, active: onLevel2, n: 1 });
M("SetSelectPanelAttrRect", 0x6F35, { regs: r => ({ b: r(2), c: r(2) }), wram: 3 });
M("DrawMinigameLevelSelect2Cursor", 0x6F62, { prep: levelPrep, active: onLevel2, n: 1 });
M("RedrawMinigameLevelSelect3", 0x708D, { prep: levelPrep, active: onLevel3, n: 1 });
M("SetSelectPanelAttrRect3", 0x70BE, { regs: r => ({ b: r(3), c: r(2) }), wram: 3 });
M("DrawMinigameLevelSelect3Cursor", 0x70ED, { prep: levelPrep, active: onLevel3, n: 1 });
// bank $1b's unused screens and prompts
const unlockPrep = both(mgPrep, (mem, r) => {
  wf(mem, "charSelectChar", pick(r, [0x17, 0x18, 0x1A, 0x1F, 0x03, r(0x20)]));
  for (let i = 0; i < 8; i++) mem.wram[6][0x400 + i] = r(256);
});
M("Unused_1b_ToggleSelectedUnlockFlag", 0x68A4, { prep: unlockPrep });
M("Unused_1b_LoadUnlockDebugCursorGfx", 0x68D6, { n: 6 });
M("Unused_1b_DrawUnlockDebugFlagSprites", 0x6938, { prep: unlockPrep });
M("Unused_1b_QueueBobbingFlagSprite", 0x6974, { regs: r => ({ de: r(0x10000) }) });
const promptPrep = both(mgPrep, (mem, r) => putName(mem, r, 0xC900));
for (const [n, a] of [["Unused_1b_DrawErasePrompt", 0x6A0F], ["Unused_1b_DrawContinuePrompt", 0x6A25],
  ["Unused_1b_DrawEraseConfirmPrompt", 0x6A32], ["Unused_1b_DrawIsThisCorrectPrompt", 0x6A3F],
  ["Unused_1b_DrawCharAndItemDataPrompt", 0x6A4C]]) M(n, a, { prep: promptPrep, wram: 2, active: onMG, n: 1 });
M("Unused_1b_DrawGameTimerRow", 0x6A5F, { prep: both(mgPrep, (mem, r) => { for (let i = 0; i < 4; i++) mem.write(0xC0F0 + i, r(i === 3 ? 100 : 60)); }), wram: 2 });
M("Unused_1b_QueueStoryInfoRowToVram", 0x6AA1, { wram: 2 });
M("Unused_1b_CopyMainCharNameWithDiacritics", 0x6AAE, { regs: r => ({ de: mapAt(r) }), prep: promptPrep, wram: 2 });
M("Unused_1b_FillTilemapRow17", 0x6B5D, { regs: r => ({ a: r(256), hl: mapAt(r) }), wram: 2 });
// the minigame select (bank $3b)
const G = (name, addr, o = {}) => E(name, 0x3B, addr, { prep: mgPrep, n: 3, ...o });
G("MinigameSelectCursorSpriteTask", 0x646D, { active: onMG, n: 1 });
G("GetMinigameCursorPosTable", 0x64B6);
G("OverrideMinigameCursorIfLocked", 0x654D, { regs: r => ({ b: r(256), c: r(256) }), active: onMG, n: 1 });
G("DrawMinigameSelectCaption", 0x6569, { active: onMG, n: 1 });
G("RenderMinigameNameText", 0x65A0, { active: onMG, n: 1 });
G("DrawMinigameSelectGrid9", 0x65EC, { active: onMG, n: 1 });
G("FillMinigameSelectCell", 0x6635, { regs: r => ({ b: r(9), c: r(2) }), wram: 3 });
G("LoadMinigameCharPalette", 0x6672, { regs: r => ({ a: r(9) }), active: onMG, n: 1 });

// ---- banks $1a / $1b: the debug screens ----
function dbgPrep(mem, r) {
  wf(mem, "storyCharacterSlot", r(2));
  putName(mem, r, 0xC900); putName(mem, r, 0xC940);
  mem.write(0xC918, pick(r, [1, 10, 98, 99, r(100)])); mem.write(0xC958, pick(r, [1, 10, 98, 99, r(100)]));
  const w6 = mem.wram[6];
  w6[0x151] = pick(r, [0, 1, 0x80, 0x81]);
  const total = pick(r, [0, 1, 50, 999, 1000, 10000, r(0x10000)]);
  w6[0x230] = total & 0xFF; w6[0x231] = total >> 8;
  const counted = r(total + 1); w6[0x232] = counted & 0xFF; w6[0x233] = counted >> 8;
  for (let i = 0; i < 4; i++) w6[0x234 + i] = r(256);
  w6[0x238] = r(2); w6[0x239] = r(2); w6[0x23A] = pick(r, [0, 0xFC, 0xFE, r(256)]); w6[0x23B] = r(2);
  const need = pick(r, [0, 1, 30, counted, r(0x10000)]); w6[0x23C] = need & 0xFF; w6[0x23D] = need >> 8;
  for (let i = 0; i < 4; i++) w6[0x23E + i] = r(256);
  const shown = pick(r, [0, 1, r(0x10000)]); w6[0x242] = shown & 0xFF; w6[0x243] = shown >> 8;
  for (let i = 0; i < 6; i++) { w6[0x244 + i] = pick(r, [0x20, 0x30, 0x35, 0x39, 0]); w6[0x24E + i] = pick(r, [0x20, 0x31, 0x39]); }
  w6[0x000] = r(2);                                           // wCharDataAnimCounter / wCharViewerRow
  w6[0x001] = r(0x16); w6[0x003] = r(0x16); w6[0x004] = r(5); w6[0x005] = r(8);
  w6[0x002] = pick(r, [0, 3, 0x0F, 0x10, 0x1A, r(0x20)]);
  mem.write(0xCB62, r(2)); mem.write(0xCB63, r(16));        // wDebugCharViewerPage / Index
  input(mem, r);
  mem.hram[0x0C] = r(256);
}
const onExp = s => task(s, 0x1A, 0x477A), onViewerGrid = s => task(s, 0x1A, 0x6AB3), onViewer = s => task(s, 0x1A, 0x6C28);
const X = (name, addr, o = {}) => E(name, 0x1A, addr, { prep: dbgPrep, n: 3, ...o });
X("Unused_1a_ExpScreenDrawTask", 0x477A, { active: onExp, n: 1, prep: both(dbgPrep, (mem, r) => { mem.wram[6][0x151] = pick(r, [0, 0x80]); }) });
X("Unused_1a_LoadExpScreenGfx", 0x4852, { regs: r => ({ h: pick(r, [0, 1, 2]) }), lcdOff: true, n: 8 });
X("Unused_1a_DrawExpScreenMessageBox", 0x4A18);
X("Unused_1a_FillTileBufferBlockFromTable", 0x4AF4);
X("Unused_1a_ExpScreenNumberTask", 0x4E65, { active: onExp, n: 1 });
X("Unused_1a_QueueNumberSpritesShifted", 0x4F02, { regs: r => ({ a: pick(r, [1, 5, 0]), hl: 0xD244, d: r(256), e: r(256) }), wram: 6 });
X("Unused_1a_AdvanceExpGaugeFill", 0x4F30);
X("Unused_1a_QueueNumberSprites", 0x4F82, { regs: r => ({ a: pick(r, [1, 5]), hl: 0xD24E, d: r(256), e: r(256) }), wram: 6 });
X("Unused_1a_LoadDialogueTextToBuffer", 0x505E, { regs: r => ({ hl: pick(r, [0x04EE, 0x04F4, 0x04F8, 0x001F, 0x0029]) }) });
X("Unused_1a_DrawExpScreenCaption", 0x4FAB, { regs: r => ({ a: pick(r, [0, 1, 2, 4, 5, 6, r(256)]) }) });
X("Unused_1a_CopyNameToTileBuffer", 0x4B73, { regs: r => ({ hl: 0xC900, de: 0xD040 + r(0x380) }), wram: 1 });
X("Unused_1a_MoveTileBufferDestUpRow", 0x4B8F);
X("Unused_1a_ClearExpScreenNameBox", 0x4B96);
X("Unused_1a_DrawPositionedStringToTileBuffer", 0x4BBB, { regs: r => ({ hl: pick(r, [0x4483, 0x449B, 0x44A8, 0x44C1]) }) });
X("Unused_1a_DrawStringToTileBuffer", 0x4BD0, { regs: r => ({ hl: 0xC940, b: r(20), c: r(18), e: r(256) }) });
X("Unused_1a_GetTileBufferCellAddr", 0x4C22, { regs: r => ({ b: r(256), c: r(64) }) });
X("Unused_1a_WriteTileBufferCell", 0x4C38, { regs: r => ({ b: r(32), c: r(32) }) });
X("Unused_1a_WriteStatModifierToTileBuffer", 0x4C5C, { regs: r => ({ a: pick(r, [0, 1, 9, 10, 99, 100, 105, 0x90, 0x91, 0x92, 0x9B, 0xE3, 0xE4, 0xF6, 0xF7, 0xFF, r(256)]), b: r(16), c: r(30) }) });
X("Unused_1a_CompareBCToDE", 0x4CEA, { regs: r => ({ bc: pick(r, [0, 1, 0x100, 0x8000, r(0x10000)]), de: pick(r, [0, 1, 0x100, r(0x10000)]) }) });
for (const [n, a] of [["Unused_1a_GetModifierTensDigit", 0x4D11], ["Unused_1a_GetModifierOnesDigit", 0x4D44], ["Unused_1a_SignExtendModifierByte", 0x4D86]])
  X(n, a, { regs: r => ({ a: pick(r, [0, 1, 9, 10, 99, 100, 109, 110, 0x90, 0x91, 0xE3, 0xE4, 0xF6, 0xFF, r(256)]) }) });
X("Unused_1a_DebugAddExp", 0x4473, { regs: r => ({ c: r(2), de: pick(r, [1, 10, 100, r(0x400)]) }) });
// the character viewer
X("Unused_1a_CopyBank1ToBank3Buffer", 0x6BE1, { regs: r => ({ hl: 0xD000 + r(0x400), bc: 1 + r(0x200) }) });
X("Unused_1a_CopyBank1ToBank2Buffer", 0x6BF6, { regs: r => ({ hl: 0xD000 + r(0x400), bc: 1 + r(0x200) }) });
X("Unused_1a_InitCharViewerState", 0x6C0B);
X("Unused_1a_DrawCharViewerCursorSprite", 0x6C28, { active: onViewer, n: 1 });
X("Unused_1a_RefreshCharViewerSelection", 0x6E41, { active: onViewer, n: 1 });
X("Unused_1a_SetupCharViewerScene", 0x6F3D, { active: onViewer, n: 1 });
X("Unused_1a_LoadCharViewerGridTilemap", 0x69EB, { n: 6 });
X("Unused_1a_DrawCharViewerPageNames", 0x6A3A, { regs: r => ({ a: pick(r, [0, 1, 2, 3, r(256)]) }), active: s => onViewerGrid(s) || onViewer(s), n: 1 });
X("Unused_1a_RenderTextColumnToBuffer64", 0x6A9B, { regs: r => ({ hl: 0x001B + r(0x30), de: 0xD043 + r(0x40), c: pick(r, [1, 2, 8]) }), wram: 3, active: s => onViewerGrid(s) || onViewer(s), n: 1 });
X("Unused_1a_DrawCharViewerGridCursor", 0x6AB3, { active: s => onViewerGrid(s) || onViewer(s), n: 1 });
X("Unused_1a_LoadCharViewerScreen", 0x6B2F, { lcdOff: true, n: 8 });
X("Unused_1a_LoadCharViewerScreenGfx", 0x6B55, { lcdOff: true, n: 8 });
// bank $1b's debug menus
const onUnlock = s => task(s, 0x1B, 0x668D);
const Y = (name, addr, o = {}) => E(name, 0x1B, addr, { prep: both(dbgPrep, unlockPrep), n: 3, ...o });
const gridPrep = both(both(dbgPrep, unlockPrep), (mem, r) => { wf(mem, "charSelectCol", r(5)); wf(mem, "charSelectRow", r(2)); });
Y("Unused_1b_ClearScreenMaps", 0x651E, { lcdOff: true, n: 6 });
Y("Unused_1b_FillBytesWithValue", 0x6569, { regs: r => ({ a: r(256), hl: MAP + r(0x700), bc: pick(r, [1, 0x20, 0x100]) }) });
Y("Unused_1b_FindUnlockDebugRosterEntry", 0x65EA, { active: onUnlock, n: 1, regs: r => ({ a: pick(r, [0x17, 0x1A, 0x1F, r(0x20)]), de: r(8) }) });
Y("Unused_1b_GetUnlockDebugRosterField", 0x65F1, { active: onUnlock, n: 1, regs: r => ({ a: pick(r, [0x17, 0x1A, 0x1F, r(0x20)]), de: r(8) }) });
Y("Unused_1b_LoadUnlockDebugNavGrid", 0x65FA); Y("Unused_1b_LoadUnlockDebugRosterTable", 0x6609, { active: onUnlock, n: 1 });
Y("Unused_1b_LoadUnlockDebugScreenGfx", 0x6618, { lcdOff: true, n: 6, wram: 1 });
Y("Unused_1b_UpdateBobbingDecorSprite", 0x6671);
Y("Unused_1b_StartUnlockDebugCursorTask", 0x6681, { active: onUnlock, n: 1 });
Y("Unused_1b_UpdateUnlockDebugCursorTask", 0x668D, { active: onUnlock, n: 1 });
Y("Unused_1b_UpdateUnlockDebugSelectedMugshot", 0x669D, { active: onUnlock, n: 1, wram: 1 });
Y("Unused_1b_UpdateUnlockDebugStatOnChange", 0x66C4, { active: onUnlock, n: 1, prep: both(gridPrep, (mem, r) => wf(mem, "charSelectPrevChar", pick(r, [rf(mem, "charSelectChar"), r(0x20)]))) });
Y("Unused_1b_DrawUnlockDebugMugshots", 0x66D7, { active: onUnlock, n: 1, wram: 1 });
Y("Unused_1b_UpdateUnlockDebugSelection", 0x67D8, { prep: gridPrep, active: onUnlock, n: 1 });
Y("Unused_1b_MoveUnlockDebugCursor", 0x67F4, { prep: gridPrep, active: onUnlock, n: 1, wram: 1 });
Y("Unused_1b_StepUnlockDebugCursor", 0x6827, { regs: r => ({ b: pick(r, [0x10, 0x20, 0x40, 0x80, 0x30, 0]), d: pick(r, [0, 4, 5, 0xFF]), e: pick(r, [0, 1, 2, 0xFF]), hl: 0xC7A0 }) });
Y("Unused_1b_ReadUnlockFlagsSaveBlock", 0x686F, { n: 6 });
Y("Unused_1b_WriteUnlockFlagsSaveBlock", 0x688A, { n: 6 });

// ---- banks $38 / $3e: the link screens ----
function lkPrep(mem, r) {
  wf(mem, "linkMatchRole", pick(r, [0, 1, 2]));
  wf(mem, "matchIsDoubles", r(2));
  wf(mem, "menuCursorX", r(5)); wf(mem, "menuCursorY", r(4));
  wf(mem, "menuCursor2X", r(5)); wf(mem, "menuCursor2Y", r(4));
  wf(mem, "charSelectSlot", r(4)); wf(mem, "charSelectMode", pick(r, [0, 1, r(6)]));
  for (let i = 0; i < 4; i++) {
    wf(mem, "charSelectSlotChars", pick(r, [0, 1, 2, 3, 4, 8, 0x0F, 0xFF]), i);
    wf(mem, "charSelectSlotDifficulty", r(3), i);
    wf(mem, "charSelectSlotLeftHanded", r(2), i);
  }
  wf(mem, "linkRemoteInput", pick(r, [0, 0x01, 0x02, 0x10, 0x20, 0x40, 0x80, 0x81, 0x82, 0xC0, r(256)]));
  wf(mem, "matchFormatDoubles", r(2)); wf(mem, "matchFormatGames", r(3)); wf(mem, "matchFormatSets", r(3));
  input(mem, r);
  mem.hram[0x0C] = r(256);
}
const onCharGrid = s => task(s, 0x38, 0x4E52);
const L = (name, bank, addr, o = {}) => E(name, bank, addr, { prep: lkPrep, n: 3, ...o });
for (const [n, a] of [["RetreatRemotePlayerSlot", 0x6A09], ["Unused_38_GetGridEntryAtCursor", 0x6A3C],
  ["InitLinkMatchCharsFromSelection", 0x6A7F], ["Unused_38_HandleLinkCpuDifficultyInput", 0x6B79],
  ["Unused_38_RunLinkCpuDifficultySubmenu", 0x6BD7], ["GetGridSlotFromLinkCursor", 0x6C37], ["GetLinkCursorSelectionCode", 0x6C64],
  ["UpdateMenuCursorFromLinkInput", 0x6C8A], ["ApplyRemoteCharCancel", 0x6655], ["Unused_38_CopyRemoteCharsToSlots", 0x66C3],
  ["CheckLinkSelectionComplete", 0x66E9], ["HandleLinkGridButtons", 0x6720], ["ConfirmLinkGridSelection", 0x676F],
  ["CancelLinkGridSelection", 0x6805], ["DrawRemoteSlotLeftHandedMark", 0x68EC], ["Unused_38_DrawRemoteDifficultyDigit", 0x6920],
  ["ClearRemoteSlotPortrait", 0x6942], ["GetRemoteSlotBoxAddress", 0x69A5], ["AdvanceRemotePlayerSlot", 0x69ED]])
  L(n, 0x38, a, { active: onCharGrid, n: 2 });
L("SetGridEntryTakenByCharId", 0x38, 0x6A4B, { regs: r => ({ d: r(4), e: r(0x20) }), active: onCharGrid, n: 2 });
L("Unused_38_CheckMarioCastEquipCategory", 0x38, 0x6BC2, { regs: r => ({ c: r(0x20) }) });
L("StoreRemoteCpuDifficulty", 0x38, 0x6609, { regs: r => ({ c: r(4) }), active: onCharGrid, n: 2 });
L("ApplyRemoteCharSelection", 0x38, 0x661E, { regs: r => ({ c: r(0x20) }), active: onCharGrid, n: 2 });
L("DrawRemoteSlotPortrait", 0x38, 0x688D, { regs: r => ({ c: r(0x20) }), active: onCharGrid, n: 2 });
// the name entry (link_sequence's name routines run in story file creation: cs_story_new)
const onNameEntry = s => task(s, 0x38, 0x7090);
const namePrep = both(lkPrep, (mem, r) => { for (const a of [0xC900, 0xC940]) putName(mem, r, a); wf(mem, "storyCharacterSlot", r(2)); });
for (const [n, a] of [["DrawEnteredName", 0x728F], ["DeleteLastNameChar", 0x7341], ["IsNameBufferFull", 0x7379],
  ["DrawNameEntryUnderlineSprites", 0x7385], ["TrimTrailingSpacesFromName", 0x73AE], ["GetEnteredNameLength", 0x73CF],
  ["GetActiveStoryNameBuffer", 0x73FA]]) L(n, 0x38, a, { prep: namePrep, active: onNameEntry, n: 1 });
L("AppendCharToName", 0x38, 0x72B3, { regs: r => ({ a: pick(r, NAME_CHARS), c: r(256) }), prep: namePrep, active: onNameEntry, n: 1 });
for (const [n, a] of [["ApplyMatchTypeSettingsLink", 0x74E3], ["StoreLinkMatchCharInfo", 0x7646], ["PackUnlockFlagsForLink", 0x7686],
  ["UnpackUnlockFlagsFromLink", 0x76FA], ["MergeLinkUnlockFlags", 0x7773]]) L(n, 0x38, a, { n: 4 });
// the rules rows and the linking / error screens (bank $3e)
const onLink = s => task(s, 0x3E, 0x4438);
for (const [n, a] of [["DrawSinglesDoublesRow", 0x4817], ["DrawGameCountRow", 0x482F], ["DrawSetCountRow", 0x4849],
  ["MatchRulesCursorSpriteTask", 0x48F1], ["DrawMatchRulesCaption", 0x4982], ["Unused_3e_DrawMatchRulesCaptionText", 0x49B9],
  ["AnimateLinkStatusPalette", 0x4A54], ["AnimateLinkErrorPalette", 0x4B37], ["ClearLinkMessageWindow", 0x4BED],
  ["FlushLinkMessageRows", 0x4C06], ["DrawMatchRulesInitialState", 0x459B], ["HandleMatchRulesToggleInput", 0x475D],
  ["UpdateAnimatedTiles_3e", 0x4438]]) L(n, 0x3E, a, { active: onLink, n: 2 });
L("SetMatchRuleOptionAttrRect", 0x3E, 0x486A, { regs: r => ({ b: r(3), c: r(3) }), wram: 3 });
L("LoadLinkMessageScreen", 0x3E, 0x4A14, { lcdOff: true, n: 6 });
L("Unused_3e_GetCellIndexFromCursorPtr", 0x3E, 0x43DB, { regs: r => ({ hl: 0xC801 + r(0x100), c: r(8) }) });
L("SetMenuCursorFromIndex_3e", 0x3E, 0x43EB, { regs: r => ({ b: 1 + r(6), c: r(30) }) });
L("Unused_3e_SetMenuCursorFromIndexToPtr", 0x3E, 0x43FD, { regs: r => ({ b: 1 + r(6), c: r(30), hl: mapAt(r) }) });
L("Unused_3e_ClearWram3Row64", 0x3E, 0x440B, { regs: r => ({ hl: MAP + r(0xFC0) }) });
L("Unused_3e_ClearWram3Row64Alt", 0x3E, 0x4421, { regs: r => ({ hl: MAP + r(0xFC0) }) });
L("Unused_3e_DrawNameWithDiacritics", 0x3E, 0x443C, { regs: r => ({ hl: 0xC600, de: MAP + 0x40 + r(0x300) }), wram: 3, prep: both(lkPrep, (mem, r) => putName(mem, r, 0xC600)) });
L("Unused_3e_DrawDecimalNumber", 0x3E, 0x4475, { regs: r => ({ a: pick(r, [0, 2, 5]), hl: r(0x10000), de: mapAt(r) }), wram: 3 });
L("Unused_3e_DrawAsciiDigitString", 0x3E, 0x4496, { regs: r => ({ hl: 0xC600, de: mapAt(r) }), wram: 3, prep: both(lkPrep, (mem, r) => put(mem, 0, 0xC600, [0x31, 0x20, 0x39, 0])) });
L("Unused_3e_DrawAsciiDigitChar", 0x3E, 0x44A0, { regs: r => ({ a: pick(r, [0x20, 0x2F, 0x30, 0x39, r(256)]), de: mapAt(r) }) });
L("FlushMatchRuleRowAttrs", 0x3E, 0x48BB, { regs: r => ({ b: r(3) }), active: onLink, n: 2 });
