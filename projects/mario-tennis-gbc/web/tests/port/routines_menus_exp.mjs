// Routine tests for web/js/port/menus/exp, menus/results and menus/ranking (run by web/tests/port_routines.mjs,
// filter "Exp "): every routine there that does not wait, called at its ROM address on the ROM and on the port from
// recorded states, with registers drawn from the state and prep() forcing the branches (EXP pools, levels at and past
// the cap, cursor and marker positions, game modes, flags, match lists and numbers, scores, trophy counts, names with
// diacritics). The registers compared are the ones each port says it returns (the hook adapter's HOOK_TRACE), plus all
// memory. Routines that draw on a screen run on the states where that screen is up (its frame task registered).
// States: the recordings of these screens, e.g.
//   node web/tests/port_routines.mjs "Exp " --rec out/port/xr_results.mtrec,out/port/xr_award.mtrec,\
//     out/port/xr_rewards.mtrec,out/port/xr_board_s.mtrec,out/port/xr_board_d.mtrec,out/port/xr_bracket.mtrec,\
//     out/port/xr_winlose.mtrec,out/port/xr_progress.mtrec,out/port/cd_levelup.mtrec --every 31
import { RAM_FIELDS } from "../../js/port/fields.js";
import { rng, pick } from "./routines_menus_common.mjs";
import { HOOK_TRACE } from "../../js/port/menus/char_select/defs.js";
import { hookKey } from "../../js/port/port.js";

const FIELD = Object.fromEntries(RAM_FIELDS.map(([n, bank, addr, size]) => [n, { bank, addr, size }]));
const at = name => { if (!FIELD[name]) throw new Error(`no field ${name}`); return FIELD[name].addr; };
const wx = (mem, bank, a, v) => { a &= 0xFFFF; if (a >= 0xD000 && a < 0xE000) mem.wram[bank || 1][a - 0xD000] = v & 0xFF; else mem.write(a, v & 0xFF); };
const wf = (mem, name, v, off = 0) => wx(mem, FIELD[name] ? FIELD[name].bank : 0, at(name) + off, v);
const wf16 = (mem, name, v, off = 0) => { wf(mem, name, v, off); wf(mem, name, v >> 8, off + 1); };
const REGS = new Set(["a", "f", "b", "c", "d", "e", "h", "l"]);
const regNames = out => {
  const r = new Set();
  for (const [k, v] of Object.entries(out && typeof out === "object" ? out : {})) {
    if (v === undefined) continue;
    if (REGS.has(k)) r.add(k);
    else if (k === "bc" || k === "de" || k === "hl") { r.add(k[0]); r.add(k[1]); }
  }
  return [...r];
};

// ---- the entries ----
export const ROUTINES = [];
let salt = 0;
function E(name, bank, addr, { regs = () => ({}), prep = null, n = 3, active = null, wram, ignore, skip = [] } = {}) {
  const k = ++salt * 7919, off = salt % n;
  let i = 0;
  const entry = {
    name: `Exp ${name}`, bank, addr, wram, ignore, out: [],
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
      if (prep) prep(mem, rng(s, k + 1), s);
    },
    js(P, regs) {
      if (!P.hooks.has(hookKey(bank, addr))) throw new Error(`no port hooked at ${bank.toString(16)}:${addr.toString(16)}`);
      HOOK_TRACE.out = null;
      P.ime = false;
      const ret = P.callRom(bank, addr, regs);
      entry.out = regNames(HOOK_TRACE.out).filter(r => !skip.includes(r));
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
const onExp = s => task(s, 0x1D, 0x7727), onAward = s => task(s, 0x1E, 0x5914), onResults = s => task(s, 0x1E, 0x4A76);
const onProgress = s => task(s, 0x1E, 0x7A8D), onBoard = s => task(s, 0x1B, 0x5A45), onBracket = s => task(s, 0x3B, 0x79D6);
const onChart = s => task(s, 0x3B, 0x7A6D), onWinLose = s => task(s, 0x16, 0x4CB1);
const onStats = s => task(s, 0x16, 0x43F6) && !task(s, 0x16, 0x4CB1);
const onAny = s => onExp(s) || onAward(s) || onResults(s) || onProgress(s) || onBoard(s) || onBracket(s) || onChart(s) ||
  onWinLose(s) || onStats(s);
const MAP = 0xD000, mapAt = r => MAP + r(0x300);

// ---- randomized state ----
function expPrep(mem, r) {
  wf(mem, "storyCharacterSlot", r(2));
  wf(mem, "charDataViewOnly", pick(r, [0, 0, 1]));
  const total = 1 + r(0xFFFF);
  wf16(mem, "expPoolTotal", total); wf16(mem, "expPoolRemaining", pick(r, [0, 1, r(total + 1)]));
  for (const base of [0, 15]) {
    const level = pick(r, [1, 2, 9, 10, 50, 98, 99, 0x64]);
    wf(mem, "expScreenCharStats", level, base);
    const needed = 1 + r(0x400);
    wf16(mem, "expScreenCharStats", needed, base + 1);
    wf(mem, "expScreenCharStats", r(65), base + 3);
    wf16(mem, "expScreenCharStats", pick(r, [0, 0xFFFF, r(needed + 1)]), base + 4);
    wf16(mem, "expScreenCharStats", pick(r, [0, 1, r(0x100)]), base + 6);
    wf16(mem, "expScreenCharStats", pick(r, [0, 1, r(needed + 1)]), base + 8);
    wf16(mem, "expScreenCharStats", r(0x10000), base + 10);
  }
  wf(mem, "expCursorChar", pick(r, [0, 1, 2, 4, r(8)]));
  wf(mem, "expCursorSlide", pick(r, [0, 1, 0x17, 0x18, r(0x19)]));
  wf(mem, "expBarMarkerX", pick(r, [0xA8, 0x18, 0x17, 0x30, r(256)]));
  wf(mem, "expPromptCursorRow", r(2));
  wf(mem, "expLevelUpFanfare", pick(r, [0, 0xFF, 1, 2, 0x10, r(256)]));
  mem.hram[0x0C] = r(256);                                   // hVBlankCounter
}
function charPrep(mem, r) {                                  // the character structs (WRAM 4-7): id and tier
  for (const bank of [4, 5, 6, 7]) { wx(mem, bank, 0xDF78, pick(r, [0, 1, 3, 4, 0x1A, r(256)])); wx(mem, bank, 0xDF95, pick(r, [0, 1, 9, 10, 35, 60, 99, r(256)])); }
  wf(mem, "matchIsDoubles", r(2));
  wf(mem, "totalGamesWonInMatch", r(13));
  for (const n of [1, 2, 3, 4]) for (const st of ["ServiceAces", "ReturnAces", "SmashAces", "LobShotWinners", "DropShotWinners", "DoubleFaults"])
    wf(mem, `character${n}${st}`, pick(r, [0, 1, 5, 99, r(256)]));
}
const FLAGS = 0xC9C0;
function flagPrep(mem, r) {                                  // the game flags of the classes, drills, trophies, Island Open
  for (let i = 5; i < 0x1C; i++) mem.write(FLAGS + i, pick(r, [0, 0xFF, r(256), r(256)]));
  mem.write(FLAGS + 0x1F, r(256));
}
function matchPrep(mem, r) {
  wf(mem, "gameMode", pick(r, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  wf(mem, "currentMinigameStoryMatch", pick(r, [0, 1, 2, r(8)]));
  wf(mem, "currentMinigameStoryMatch", pick(r, [0, 1, 4, 0x13, 0x16, 0x18, 0x1A, 0x1B, 0x1C, 0x1D, 0x1F, 0x21, r(0x20)]), 1);
  wf(mem, "matchWinLoseFlag", pick(r, [1, 0xFF, 0]));
  wf(mem, "pointWinLoseFlag", pick(r, [1, 0xFF, 0]));
  wf(mem, "minigameHighScoreMode", r(2));
  wf16(mem, "minigamesCurrentScore", pick(r, [0, 50, 99, 100, 499, 500, 999, 1000, 0x270F, r(0x10000)]));
  wf(mem, "minigameLevel", r(3));
  wf(mem, "linkMatchRole", pick(r, [0, 1, 2]));
  wf(mem, "storyMainCharExpTier", pick(r, [1, 9, 10, 25, 45, 59, 60, 99]));
  wf(mem, "storyPartnerCharExpTier", pick(r, [1, 9, 10, 25, 45, 59, 60, 99]));
  wf(mem, "storyReturnLocation", pick(r, [0, 3, 0x1D, r(0x20)]));
  for (let i = 0; i < 2; i++) wf(mem, "n64TrophyCounts", r(256), i);
  wf(mem, "victoryScoreTableAlt", r(2));
  wf(mem, "exhibitionModeCPUMainCharacterDifficulty", r(4));
  wf(mem, "matchSlotCharRefs", pick(r, [0, 0x80, 0x82, 0x84, 0xFF]));
}
const all = both(both(both(expPrep, charPrep), flagPrep), matchPrep);
const put = (mem, bank, a, list) => list.forEach((v, i) => wx(mem, bank, a + i, v));
const NAME_CHARS = [0x41, 0x4E, 0x61, 0x7A, 0x20];
const putName = (mem, r, a, marks = true) => {
  const n = 1 + r(9), out = [];
  for (let i = 0; i < n; i++) { out.push(pick(r, NAME_CHARS)); if (marks && r(4) === 0) out.push(pick(r, [0xDE, 0xDF])); }
  put(mem, 0, a, [...out, 0]);
};
const namesPrep = (mem, r) => {
  for (const a of [0xC900, 0xC940, at("player1MainName"), at("player1PartnerName"), at("player2MainName"), at("player2PartnerName")]) putName(mem, r, a);
};

// ---- bank $1D: the EXP distribution ----
const D = (name, addr, o = {}) => E(name, 0x1D, addr, { prep: expPrep, n: 4, ...o });
D("SlideExpCursorToMainCharTask", 0x70CC); D("SlideExpCursorToPartnerTask", 0x70E6);
D("SweepExpBarMarkerLeft", 0x7102); D("SweepExpBarMarkerRight", 0x7133); D("GetExpBarSweepStep", 0x7168);
D("UpdateExpScreenSelectionPalettes", 0x7189);
D("GrayscalePaletteColorInPlace", 0x7205, { regs: r => ({ hl: 0xC100 + 2 * r(64) }) });
D("ConvertColorToGrayscale", 0x7210, { regs: r => ({ de: r(0x10000) }) });
D("AssignExpPointToChar", 0x726D); D("UnassignExpPointFromChar", 0x72DD);
D("UploadExpScreenTilemapRows", 0x734B); D("RefreshExpScreenReadouts", 0x7373, { active: onExp, n: 1 });
D("CheckExpLevelUp", 0x737D); D("CheckExpLevelDown", 0x73E7);
D("UploadExpPromptWindowRows", 0x7505); D("UploadExpPromptWindowRowsClosing", 0x7545); D("DrawExpPromptCursor", 0x7568);
D("ApplyTilemapPatchListExpScreen", 0x7610, { regs: r => ({ hl: pick(r, [0x77C8, 0x77E1, 0x77F6, 0x7807, 0x7814, 0x781D]), bc: 0xD240 }) });
D("DrawExpToNextLevelTask", 0x765E);
D("GetExpScreenDigitSprite", 0x771E, { regs: r => ({ a: pick(r, [0x30, 0x35, 0x39, r(256)]) }) });
D("DrawExpCharCursorTask", 0x7727); D("DrawExpBarFillMarkersTask", 0x7760); D("DrawExpBarSweepSpriteTask", 0x7789);
D("TickLevelUpJingle", 0x77A7);
D("ClearPendingExpAwards", 0x7CAE);
D("SetPendingExpAward", 0x7CC6, { regs: r => ({ b: r(5), c: r(6), de: r(0x10000) }) });
["N64:7ce3", "Exhibition:7cee", "Linked:7cf9", "Match:7d04", "Trophy:7d0f"].forEach(e => {
  const [n, a] = e.split(":"); D(`SetPendingExpAward_${n}`, parseInt(a, 16), { regs: r => ({ c: r(6), de: r(0x10000) }) });
});

// ---- bank $1E: the awards ----
const X = (name, addr, o = {}) => E(name, 0x1E, addr, { prep: all, n: 4, ...o });
X("GetScoreBonus", 0x6807, { regs: r => ({ hl: r(0x10000) }) });
X("ComputeMatchStatsReward", 0x6851, { regs: r => ({ hl: r(0x400) }), wram: 4 });
X("ComputeMatchStatsReward_p2", 0x6851, { regs: r => ({ hl: r(0x400) }), wram: 5 });
X("AccumulateStatExp", 0x68CF, { regs: r => ({ hl: pick(r, [0x67D7, 0x67DF, 0x67E7, 0x67EF, 0x67F7, 0x67FF]), c: r(7), a: r(16), de: r(0x1000) }) });
X("ApplyMatchSettingsExpBonus", 0x68DC, { regs: r => ({ hl: pick(r, [0, 0x10, 0x7FFF, 0x8000, 0xFFFF, r(0x10000)]), d: pick(r, [0x13, 0x03, 0x10, 0x23, 0x00, r(256)]) }) });
X("GetOpponentExpTier", 0x6901); X("GetPlayerExpTier", 0x6932, { wram: 4 }); X("LookupExpTierForChar", 0x693E, { wram: 4 });
X("ScaleExpByPlayerLevel", 0x6C09, { regs: r => ({ de: pick(r, [0, 1, 0x1234, 0x8000, 0xFFFF, r(0x10000)]) }) });
X("InitExpAwardScreenState", 0x54BB);
X("FillMemoryD", 0x54F0, { regs: r => ({ hl: mapAt(r), a: r(256), d: pick(r, [1, 5, 0x20, 0]) }) });
X("ExpScreenCopyToTilemap", 0x55BA, { regs: r => ({ hl: MAP + r(0x800), bc: 1 + r(0x240) }) });
X("ExpScreenCopyToAttrmap", 0x55CF, { regs: r => ({ hl: MAP + r(0x800), bc: 1 + r(0x240) }) });
X("DrawExpMessageWindow", 0x5896);
X("FillTilemapRun", 0x5900, { regs: r => ({ hl: mapAt(r), b: r(256), c: pick(r, [1, 7, 0x12, 0]) }) });
X("UpdateExpScreenCharSprite", 0x5954, { regs: r => ({ a: r(2) }), active: onAward, wram: 4, n: 1 });
X("DrawExpScreenCharSprites", 0x5914, { active: onAward, n: 1, skip: ["f"] });
X("DrawExpTotalDigits", 0x5A4E, { prep: (mem, r) => { mem.wram[6][0x005] = r(256); mem.wram[6][0x006] = pick(r, [0, 3, 0x27, 0x28, r(256)]); } });
const textPrep = both(all, namesPrep);
for (const e of ["DrawExpSinglesPlayerPanel:55fd", "DrawExpDoublesPlayerPanel:5693", "DrawExpDoublesPartnerPanel:5758", "DrawExpTotalPanel:5814"]) {
  const [n, a] = e.split(":"); X(n, parseInt(a, 16), { prep: textPrep, active: s => onAward(s) || onResults(s), n: 2 });
}
X("LoadExpAwardScreenGraphics", 0x551E, { n: 12 });
X("GetDigitSpriteTile", 0x5AFA, { regs: r => ({ a: pick(r, [0x30, 0x35, 0x39, r(256)]) }) });
X("HasPendingExpAwards", 0x5BBB, { prep: (mem, r) => { for (let i = 0; i < 10; i++) mem.write(0xD152 + i, r(3) ? 0 : r(256)); } });
X("GetFirstClearRewardExp", 0x66D2);
// rewards and trophies
for (const e of ["ApplyStatGapProgressFlag:6c62", "ApplyClassProgressRule1:6c7c", "ApplyClassProgressRule2:6c86",
  "ApplyClassProgressRule3:6c93", "ApplyClassProgressFlags:6ca0", "SetRewardGameFlag:6caa", "TestRewardGameFlag:6cd1",
  "GetRewardTableIndex:6cf6", "ApplyRewardUnlockFlags:6e1c", "SetMinigameRecordSaveFlag:6eb1", "SetMinigameClearFlag:6edc",
  "UpdateMinigameBestScore:6f38", "CheckAllProgressComplete:6f8d", "SetupRankingBoardArgs:6fbf", "ComputeTrophyExpAwards:6ffb",
  "UnusedSetPendingTrophyExpAwards:7065", "ComputeTrophyExpGroup0:70da", "ComputeTrophyExpGroup1:70e0",
  "ComputeTrophyExpGroup2:70e6", "ComputeTrophyExpGroup3:70ec", "ComputeTrophyExpGroup4:70f2", "ComputeTrophyExpGroup5:70f8"]) {
  const [n, a] = e.split(":"); X(n, parseInt(a, 16), { prep: all, n: /Update|Unused|ComputeTrophyExpAwards|Minigame/.test(n) ? 6 : 4 });
}
X("SetRewardUnlockFlag", 0x6E50, { regs: r => ({ c: r(13) }) });
X("GetTrophyExpValue", 0x6FEB, { regs: r => ({ a: r(6), b: pick(r, [0, 2, 4, 6]) }) });
X("ComputeTrophyExpForGroup", 0x70FE, { regs: r => ({ a: r(6) }) });
// the game-progress screen
const P5 = (name, addr, o = {}) => X(name, addr, { wram: 5, prep: both(all, (mem, r) => {
  mem.wram[5][0xF03] = pick(r, [0, 3, 7, 12, 0x2F]); mem.wram[5][0xF05] = pick(r, [0, 1, 5, 0x20]);
  for (let i = 0; i < 0x30; i++) { mem.wram[5][0xF10 + i] = r(2); mem.wram[5][0xF40 + i] = r(2); mem.wram[5][0xF70 + i] = r(4) ? r(0x30) : 0xFF; }
}), ...o });
P5("InitGameProgressScreen", 0x727D, { active: onProgress, n: 2 });
P5("UpdateProgressScreenAnimatedTiles", 0x737E);
P5("UnusedCreateProgressHeaderWindow", 0x73D7, { active: onProgress, n: 2 });
P5("CreateProgressListWindow", 0x73E3, { active: onProgress, n: 2 });
P5("TestProgressEntryFlag", 0x73EF, { regs: r => ({ a: r(0x25) }) });
P5("RunRewardCategoryList", 0x7408, { regs: r => ({ a: r(6) }) });
P5("BuildVisibleProgressEntryList", 0x747C); P5("BuildProgressEntryEarnedTable", 0x7499);
P5("GetProgressEntryEarned", 0x74AA, { regs: r => ({ a: r(0x30) }) });
P5("LoadGameProgressScreenAssets", 0x74FA, { active: onProgress, n: 2 });
P5("LoadGameProgressScreenTiles", 0x7504, { n: 10 });
P5("FillProgressListRowTiles", 0x79E8, { active: onProgress, n: 2 }); P5("FillProgressListRowAttrs", 0x7A14, { active: onProgress, n: 2 });
P5("UnusedCopyProgressListTilemap", 0x7A30);
P5("DrawProgressEntryDefaultIcon", 0x7A3C, { regs: r => ({ b: r(7) }) });
P5("DrawProgressEntryTrophyIcon", 0x7A68, { regs: r => ({ b: r(7), c: r(5) }) });
P5("DrawProgressScreenSprites", 0x7A8D, { active: onProgress, n: 1 });
P5("LoadProgressScreenIconTiles", 0x7B4C, { n: 8 });

// ---- bank $1E: the results screen ----
const R1 = (name, addr, o = {}) => X(name, addr, { prep: textPrep, ...o });
R1("InitResultsPromptState", 0x40AC, { regs: r => ({ c: r(4) }) });
R1("LoadResultsScreenGraphics", 0x4105, { n: 12 });
R1("ResultsCopyToTilemap", 0x4187, { regs: r => ({ hl: MAP + r(0x800), bc: 1 + r(0x240) }) });
R1("ResultsCopyToAttrmap", 0x419C, { regs: r => ({ hl: MAP + r(0x800), bc: 1 + r(0x240) }) });
R1("LoadSinglesLabelTiles", 0x433A); R1("LoadDoublesLabelTiles", 0x434A);
R1("DrawResultsNameLabelRows", 0x435A, { regs: r => ({ a: r(2) }) });
R1("CopyLabelTilesToTilemap", 0x440D, { regs: r => ({ hl: MAP + r(0x400), de: mapAt(r), c: pick(r, [1, 7, 0x14]) }) });
R1("UnusedClearLabelTilemapRow", 0x442B);
R1("FillMemoryC", 0x4461, { regs: r => ({ hl: mapAt(r), a: r(256), c: pick(r, [1, 6, 0x12, 0xA0]) }) });
const onText = s => onResults(s);   // (on the award screen the text engine state is mid-message)
for (const e of ["BuildResultsScreenPanels:41b1", "DrawStoryResultsHeader:4466", "DrawExhibitionResultsHeader:44b1",
  "DrawMarioExhibitionResultsHeader:44d3", "DrawRankMatchResultsHeader:44f4", "DrawTournamentResultsHeader:451b",
  "DrawPracticeResultsHeader:453c", "DrawSinglesPlayerNames:4606", "DrawDoublesPlayerNames:4634", "DrawSetsGamesScore:46a4",
  "DrawClassNameLabel:4717", "DrawRankMatchLabel:4749", "DrawTournamentRoundLabel:47f4", "ClearRoundLabelRow:4867",
  "DrawPracticeMatchLabel:4881", "DrawMarioExhibitionLabel:488e", "DrawPlayerNameAndLevel:489b"]) {
  const [n, a] = e.split(":"); R1(n, parseInt(a, 16), { active: onText, n: 1 });
}
R1("DrawProportionalTextLine", 0x4563, { regs: r => ({ hl: pick(r, [0x04D8, 0x04DA, 0x04E0, 0x04EA]), de: MAP + 0x40 + r(0x200) }), active: onText, n: 1 });
R1("DrawContinuePromptText", 0x4572, { regs: r => ({ hl: mapAt(r) }) });
R1("DrawSaveWarningTextLine1", 0x458C, { regs: r => ({ hl: mapAt(r) }) });
R1("DrawSaveWarningTextLine2", 0x45A6, { regs: r => ({ hl: mapAt(r) }) });
R1("FetchAndDrawDialogueText", 0x45C0, { regs: r => ({ hl: pick(r, [0x04D7, 0x04E1, 0x04E3, 0x04E4]), de: MAP + 0x40 + r(0x200), bc: 0x0020 }), active: onText, n: 1 });
R1("WriteTextToTilemap", 0x45C9, {
  regs: r => ({ de: MAP + 0x40 + r(0x200), b: r(8), c: pick(r, [0x20, 0x20, 1, 0]) }),
  prep: both(textPrep, (mem, r) => { putName(mem, r, 0xC600); for (let i = 0; i < 0x400; i++) if (r(5) === 0) mem.wram[3][i] = 3; }),
});
R1("ShiftDestForLongName", 0x4683, { regs: r => ({ de: mapAt(r) }), prep: both(textPrep, (mem, r) => putName(mem, r, 0xC600)) });
R1("FormatAndDrawNumber", 0x46F6, { regs: r => ({ a: r(256), de: mapAt(r) }) });
R1("CopyStringToTextBuffer", 0x470D, { regs: r => ({ hl: pick(r, [0xC900, 0xC940, at("player1MainName")]) }) });
R1("Fill7Bytes", 0x495A, { regs: r => ({ hl: mapAt(r), a: r(256) }) });
R1("CopyTilesAndAttrsRun", 0x4962, { regs: r => ({ hl: MAP + r(0x100), de: mapAt(r), c: pick(r, [1, 8]) }) });
R1("InitResultsScreenCharacters", 0x498F, { active: onText, n: 1 });
R1("DrawResultsCharSprites", 0x4A76, { active: onResults, n: 1, skip: ["f"] });
R1("UpdateResultsCharSprite", 0x4AA8, { regs: r => ({ a: r(2) }), active: onResults, wram: 4, n: 1 });
R1("DrawContinuePromptCursor", 0x4B46, { prep: (mem, r) => { mem.wram[6][1] = r(2); } });
R1("RefreshContinuePromptText", 0x4BCA, { wram: 6, prep: (mem, r) => { mem.wram[6][2] = r(2); } });
R1("ClearContinuePromptRows", 0x4C15);

// ---- bank $16: the win / lose and statistics screens ----
const W = (name, addr, o = {}) => E(name, 0x16, addr, { prep: both(all, (mem, r) => { mem.wram[3][0x800] = r(2); mem.wram[3][0x801] = r(2); }), n: 3, ...o });
W("Unused_16_GetCellIndexFromCursorPtr", 0x4399, { regs: r => ({ hl: 0xC801 + r(0x100), c: r(8) }) });
W("Unused_16_SetMenuCursorFromIndex", 0x43A9, { regs: r => ({ b: 1 + r(6), c: r(30) }) });
W("Unused_16_SetMenuCursorFromIndexToPtr", 0x43BB, { regs: r => ({ b: 1 + r(6), c: r(30), hl: mapAt(r) }) });
W("Unused_16_ClearWram3Row64", 0x43C9, { regs: r => ({ hl: MAP + r(0xFC0) }) });
W("Unused_16_ClearWram3Row64Alt", 0x43DF, { regs: r => ({ hl: MAP + r(0xFC0) }) });
W("UpdateResultScreenAnimatedTilesTask", 0x43F6, { skip: ["f"] });
W("UnusedDrawCourtDiagramMarkers", 0x43FA, { regs: r => ({ hl: 0xC600, de: MAP + 0x40 + r(0x300) }), wram: 3, prep: both(all, (mem, r) => putName(mem, r, 0xC600)) });
W("UnusedPrintDecimalNumber_16", 0x4433, { regs: r => ({ a: pick(r, [0, 2, 5]), hl: r(0x10000), de: mapAt(r) }), wram: 3 });
W("Unused_16_PrintNumberString", 0x4454, { regs: r => ({ hl: 0xC600, de: mapAt(r) }), wram: 3, prep: both(all, (mem, r) => put(mem, 0, 0xC600, [0x31, 0x20, 0x35, 0x2D, 0x39, 0])) });
W("Unused_16_DrawAsciiDigitChar", 0x445E, { regs: r => ({ a: pick(r, [0x20, 0x2F, 0x30, 0x39, r(256)]), de: mapAt(r) }) });
W("InitMatchWinLoseScreen", 0x4571, { active: onWinLose, n: 6, wram: 3 });
W("LoadWinLoseScreenAssets", 0x490C, { n: 8, wram: 3 });
W("SetWinLosePortraitPaletteAttrs", 0x4963, { wram: 3 });
W("LoadMatchResultPalettes", 0x4A0F); W("AdjustResultTilemapForLoss", 0x4A56, { wram: 3 });
W("Unused_16_BuildMatchResultTilemap", 0x4A71, { wram: 3, prep: both(all, (mem, r) => wf(mem, "currentMinigameStoryMatch", r(20), 1)) });
W("AdvanceResultScreenTimer", 0x4C9D); W("QueueResultScreenSprites", 0x4CB1);
for (const e of ["QueueResultPortraitTop:4cea", "QueueResultPortraitBottom:4d45", "QueueWinnerMarkerForPlayer:4d96",
  "QueueLoserMarkerForOpponent:4dad", "QueueWinnerMarkerForOpponent:4dba", "QueueLoserMarkerForPlayer:4dc7"]) {
  const [n, a] = e.split(":"); W(n, parseInt(a, 16), { regs: r => ({ d: r(256), e: r(256) }) });
}
W("GetResultSpriteWobbleOffset", 0x4DDE);
W("LoadResultScreenTileGraphics", 0x4DFE, { wram: 3, n: 8 }); W("LoadMatchResultGfxSet", 0x4E54, { n: 8 });
W("RemapDoublesMatchGfxIndex", 0x4E8A, { regs: r => ({ a: pick(r, [0x10, 0x11, 0x12, r(256)]) }) });
W("ApplyLinkRoleToWinLoseFlag", 0x5C11);
W("InitMatchStatsScreen", 0x5C8A, { active: s => onStats(s) || onWinLose(s), n: 6, wram: 3 });
W("SetMatchStatsPortraitPaletteAttrs", 0x5CDC, { wram: 3 });
W("PrintMatchStatistics", 0x5D2F, { wram: 3 }); W("PrintSinglesMatchStats", 0x5D43, { wram: 3 }); W("PrintDoublesMatchStats", 0x5DF8, { wram: 3 });
W("ClearMatchStatsNumberArea", 0x5F61, { wram: 3 }); W("CopyMatchStatsHeaderRects", 0x5F92, { wram: 3 });
W("PrintMatchSetScores", 0x5FCE, { prep: both(all, (mem, r) => { wf(mem, "player1SetsWon", r(4)); wf(mem, "player2SetsWon", r(4)); }) });
W("LoadResultScreenPortraits", 0x5FE7, { regs: r => ({ c: r(2) }), wram: 3, n: 6 });
W("LoadResultPortraitSlot", 0x6073, { regs: r => ({ d: r(0x20), b: r(16), c: r(4) }), wram: 3, n: 4 });
W("DecompressResultPortrait", 0x60C0, { regs: r => ({ b: r(0x20), c: r(3), de: pick(r, [0x8C00, 0x8D00]) }) });
W("DecompressWinLosePortraitVariant", 0x60D5, { regs: r => ({ b: r(16), c: 1 + r(2), de: pick(r, [0x8C00, 0x8D00]) }) });
W("DecompressCharacterPortrait", 0x6955, { regs: r => ({ b: r(256), de: pick(r, [0x8C00, 0x8D00]) }) });

// ---- bank $1B: the ranking board and mugshots ----
const boardPrep = both(all, (mem, r) => {
  const w3 = mem.wram[3];
  w3[0x800] = r(2); w3[0x801] = r(5); w3[0x802] = pick(r, [0, 1, 2]); w3[0x85A] = r(2);
  w3[0x855] = pick(r, [0, 1, 0x86, r(0x87)]); w3[0x856] = r(256);
  for (let i = 0; i < 0x30; i++) w3[0x803 + i] = r(4) ? r(256) : 0xFF;
  for (let k = 0; k < 4; k++) {
    w3[0x840 + 2 * k] = 0x03 + 4 * r(12); w3[0x841 + 2 * k] = 0xD8;
    const t = pick(r, [0x5B94, 0x5BA5, 0x5BB2, 0x5BD4, 0x5BF7, 0x5C0C]); w3[0x848 + 2 * k] = t & 0xFF; w3[0x849 + 2 * k] = t >> 8;
    w3[0x850 + k] = r(4);
  }
});
const B = (name, addr, o = {}) => E(name, 0x1B, addr, { prep: boardPrep, wram: 3, n: 3, ...o });
B("Unused_1b_ClearWram3Row64", 0x4403, { regs: r => ({ hl: MAP + r(0xFC0) }) });
B("Unused_1b_ClearWram3Row64Alt", 0x4419, { regs: r => ({ hl: MAP + r(0xFC0) }) });
B("UpdateAnimatedTilesTask", 0x4430, { skip: ["f"] });
B("DrawNameWithDiacritics_1b", 0x4434, { regs: r => ({ hl: 0xC600, de: MAP + 0x40 + r(0x300) }), prep: both(boardPrep, (mem, r) => putName(mem, r, 0xC600)) });
B("Unused_1b_DrawDecimalNumber", 0x446D, { regs: r => ({ a: pick(r, [0, 2, 5]), hl: r(0x10000), de: mapAt(r) }) });
B("Unused_1b_DrawAsciiDigitString", 0x448E, { regs: r => ({ hl: 0xC600, de: mapAt(r) }), prep: both(boardPrep, (mem, r) => put(mem, 0, 0xC600, [0x31, 0x20, 0x35, 0x2D, 0x39, 0])) });
B("Unused_1b_DrawAsciiDigitChar", 0x4498, { regs: r => ({ a: pick(r, [0x20, 0x2F, 0x30, 0x39, r(256)]), de: mapAt(r) }) });
B("Unused_1b_ResetMugshotPalettes", 0x4E0D);
B("Unused_1b_SetMugshotAttrs", 0x4E18, { regs: r => ({ a: r(256), de: r(0x200) }), wram: 1 });
B("LoadCharMugshotToBuffer", 0x4E37, { regs: r => ({ a: pick(r, [0, 3, 0x1A, 0x1F, 0x3F, 0x40, r(256)]) }), n: 5 });
B("CopyMugshotBufferToVram", 0x4E46, { regs: r => ({ de: pick(r, [0x8800, 0xA900, 0x9000]) }) });
B("LoadIndexedPaletteThunk", 0x4E58, { regs: r => ({ a: r(256), d: r(16) }) });
B("DecompressCharMugshot", 0x4E5C, { regs: r => ({ a: pick(r, [0, 3, 0x1A, 0x1F, 0x3F, r(0x40)]), de: 0xD600 }), n: 5 });
B("LoadRankingBoardTiles", 0x4FA6, { n: 8 });
B("HighlightDoublesRankingRows", 0x5829); B("HighlightDoublesRankingRow", 0x5846, { regs: r => ({ b: r(7) }) });
["0:5865", "2:5875", "3:5885", "4:5895", "5:58a5", "6:58b5"].forEach(e => { const [n, a] = e.split(":"); B(`DrawDoublesRankingMarker${n}`, parseInt(a, 16)); });
B("RankingBoardAnimTask_1b", 0x5912); B("RankingCursorBobTask", 0x5A04); B("DrawRankingMarkersTask", 0x5A45);
B("QueueRankingMarkerSprite", 0x5A5F, { regs: r => ({ b: r(8), d: r(256), e: r(256) }) });
[0x5A6E, 0x5A89, 0x5AA4, 0x5ABF].forEach((a, k) => B(`StartRankingMarkerAnim${k}`, a, { regs: r => ({ hl: 0xD803 + 4 * r(12), de: pick(r, [0x5B94, 0x5BA5, 0x5C0C]) }) }));
[0x5ADA, 0x5B08, 0x5B36, 0x5B65].forEach((a, k) => B(`UpdateScriptedOffsetChannel${k}`, a));
B("ClearRankingMarkerSlots", 0x5C31); B("LoadRankingMarkerCoords", 0x5C3B, { regs: r => ({ c: pick(r, [0, 0, 1, 3]) }) });
B("GetRankingMarkerSlot", 0x5F51, { regs: r => ({ c: r(12) }) });
B("Unused_1b_WriteRankingMarkerSlot", 0x5F5F, { regs: r => ({ hl: 0xD803 + 4 * r(12), b: r(8), d: r(256), e: r(256) }) });
B("Unused_1b_AddRankingMarkerSlotByte1", 0x5F69, { regs: r => ({ hl: 0xD803 + 4 * r(12), b: r(256) }) });
B("Unused_1b_AddRankingMarkerSlotByte2", 0x5F72, { regs: r => ({ hl: 0xD803 + 4 * r(12), b: r(256) }) });
B("DrawSinglesRankingEntry", 0x5536, { regs: r => ({ b: 1 + r(11) }), active: onBoard, n: 1 });
B("DrawDoublesRankingEntry", 0x55FF, { regs: r => ({ b: 2 + r(10) }), active: onBoard, n: 1 });
B("ClearSinglesRankingNameRects", 0x558E); B("ClearDoublesRankingNameRects", 0x5659);
B("InitRankingNameRender", 0x569C, { active: onBoard, n: 1 });
const namePrep = both(boardPrep, (mem, r) => putName(mem, r, 0xC600));
// a destination clear of the tilemap row ends (the ROM walks off into MBC space when a name wraps a row end)
const nameDest = r => MAP + 0x40 + 32 * r(20) + r(12);
// a ranking-board name of lo..hi bytes (diacritic marks counted): the two-row split copies bytes 4..10
// (wRankingNameRowBuffer, 7 bytes) and is only used for names of 6 or more
const boardName = (lo, hi) => both(boardPrep, (mem, r) => {
  const n = lo + r(hi - lo + 1), out = [];
  while (out.length < n) out.push(out.length && out.length < n - 1 && r(4) === 0 ? pick(r, [0xDE, 0xDF]) : pick(r, NAME_CHARS));
  put(mem, 0, 0xC600, [...out, 0]);
});
B("RenderPlayerNameFitted", 0x56B3, { regs: r => ({ hl: 0xC600, de: nameDest(r) }), prep: boardName(1, 10) });
B("GetStringLength", 0x56C2, { regs: () => ({ hl: 0xC600 }), prep: namePrep });
B("RenderNameTwoRows", 0x56CF, { regs: r => ({ hl: 0xC600, de: nameDest(r) }), prep: boardName(6, 10) });
B("RenderNameTopRow", 0x56E2, { regs: r => ({ hl: 0xC600, de: nameDest(r) }), prep: namePrep });
B("RenderNameBottomRow", 0x56FA, { regs: r => ({ hl: 0xC600, de: nameDest(r) }), prep: boardName(6, 10) });
B("HighlightSinglesRankingRows", 0x5710); B("HighlightRankingRow", 0x5750, { regs: r => ({ b: r(12) }) });
["0:5779", "2:5789", "3:5799", "4:57a9", "5:57b9", "6:57c9", "7:57d9", "8:57e9", "9:57f9", "10:5809", "11:5819"].forEach(e => {
  const [n, a] = e.split(":"); B(`DrawRankingRow${n}`, parseInt(a, 16));
});

// ---- bank $3B: the team bracket, the Mario-cast chart, the exhibition victories ----
const chartPrep = both(all, (mem, r) => {
  const w3 = mem.wram[3];
  w3[0x800] = r(2); w3[0x801] = r(5);
  for (let i = 0; i < 9; i++) w3[0xC01 + i] = r(3) ? r(0x20) : 0x10;
  for (let i = 0; i < 0x100; i++) w3[0xB00 + i] = r(5);
  wf(mem, "menuCursorX", r(3)); wf(mem, "menuCursorY", r(6)); wf(mem, "menuInputPressed", pick(r, [0x10, 0x20, 0x40, 0x80, 0, 1, 2]));
  wf(mem, "player1CurrentMainCharacter", pick(r, [0x17, 0x1A, 0x1F, 0x03, r(0x20)]));
  wf(mem, "player2CurrentMainCharacter", pick(r, [0x18, 0x1B, 0x1E, 0x05, r(0x20)]));
});
const T = (name, addr, o = {}) => E(name, 0x3B, addr, { prep: chartPrep, wram: 3, n: 3, ...o });
T("BuildTournamentBracketScreen", 0x77A7, { active: onBracket, n: 4 });
T("ClearTournamentBracketAttrs", 0x77F7); T("DrawTournamentBracketNameBoxes", 0x7804);
T("WriteBracketSinglesNames", 0x786C, { active: onBracket, n: 1, prep: both(chartPrep, (mem, r) => { mem.wram[3][0x801] = r(5); }) });
T("WriteBracketEntrantName", 0x78A3, { regs: r => ({ a: r(16), b: r(4) }), active: onBracket, n: 1 });
T("WriteBracketDoublesNames", 0x78EC, { active: onBracket, n: 1 });
T("HighlightBracketPlayerRow", 0x7945); T("BracketHighlightBlinkTask", 0x79D6);
T("MarioCastChartScrollArrowsTask", 0x7A6D);
T("BuildMarioCastExhibScreen", 0x7B11, { active: onChart, n: 4 });
T("RedrawMarioCastChartWindow", 0x7BEA); T("BuildMarioCastChartColumnList", 0x7CCA); T("LoadMarioCastExhibGrid", 0x7D1E, { n: 5 });
T("RecordExhibitionVictory", 0x7D57, { n: 4 });
T("GetVictoryScore", 0x7DC4, { regs: r => ({ a: r(4) }) });
T("GetMarioCastIndex", 0x7DE1, { regs: r => ({ a: 0x17 + r(9) }) });
T("UpdateMarioCastUnlocks", 0x7DF6, { prep: both(chartPrep, (mem, r) => { for (let i = 0; i < 81; i++) mem.wram[3][0x900 + i] = r(6) ? 1 + r(3) : 0; }) });
T("CheckMarioCastChartExpanded", 0x7E25); T("ApplyMarioCastChartReducedLayout", 0x7E43);
T("CopyMarioCastChartReducedTilemap", 0x7E69); T("FixupMarioCastChartHeaderRow", 0x7E84); T("CompactMarioCastChartRows", 0x7E8B);
