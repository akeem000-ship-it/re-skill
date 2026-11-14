// Routine tests for web/js/port/menus/pause, briefing, court_select and scenes (run by web/tests/port_routines.mjs;
// filter "MP " for all of them): the routines that do not wait, on states of recorded play, with prep() setting the
// variables they read to random and edge values (menu ids and selections, scoreboard layouts, briefing places and
// animation steps, court cursors and unlock bits, scene objects, ...). Every register is compared (these hooks are
// reachable from ROM code). Interrupts are off (IE = 0) on both machines. The waiting routines are checked by the
// lockstep (with the routines that call the text windows' redraw or jump into bank 0) on out/port/pause_*.mtrec, brief_*.mtrec, court*_*.mtrec, scene_*.mtrec, story_pause*.mtrec and the
// match and minigame recordings (see each module's header).
import { RAM_FIELDS } from "../../js/port/fields.js";

const ALL = ["a", "f", "b", "c", "d", "e", "h", "l"];
const A = {}; for (const [n, , addr] of RAM_FIELDS) if (!(n in A)) A[n] = addr;
function rng(s, salt) {
  let x = 2166136261 ^ salt;
  for (const ch of `${s.rec}@${s.f}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
  x = (x >>> 0) || 1;
  return n => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x % n; };
}
let salt = 0;
const regsOf = (gen, k) => s => {
  const r = rng(s, k), g = { a: r(256), f: r(16) << 4, bc: r(0x10000), de: r(0x10000), hl: r(0x10000), ...gen(r, s) };
  return { a: g.a, f: g.f, b: g.bc >> 8, c: g.bc & 0xFF, d: g.de >> 8, e: g.de & 0xFF, h: g.hl >> 8, l: g.hl & 0xFF };
};
// a test of bank:addr; gen(r, s) draws registers, prep(mem, r) sets RAM (the same draws on both machines)
// the hooks ROM code of other parts reaches (slots and their callees): every register compared. The others are
// reached only from the ported routines of these menus (bank-local calls), which call the JavaScript directly: their
// memory is compared, and the registers they return are what those callers use.
const EXTERNAL = new Set(["FlushTilemapToVram", "LoadOnCourtCharTilesA", "LoadOnCourtCharTilesB", "LoadOnCourtCharTilesFallback",
  "LoadCourtSelectGraphics", "ComputeUnlockedCourtFlags", "StubNop_3e"]);
const T = (name, bank, addr, { gen = () => ({}), out = EXTERNAL.has(name) ? ALL : [], prep, wram } = {}) => {
  const k = ++salt * 7919;
  return { name: "MP " + name, bank, addr, out, wram, regs: regsOf(gen, k),
    prep: (mem, s) => { mem.ie = 0; mem.hram[0x16] = mem.svbk; if (prep) prep(mem, rng(s, k + 1)); } };
};
const w = (mem, a, v) => mem.write(a, v & 0xFF);                 // as mapped
const w16 = (mem, a, v) => { w(mem, a, v); w(mem, a + 1, v >> 8); };
const wb = (mem, bank, a, v) => { mem.wram[bank][a - 0xD000] = v & 0xFF; };
const v = (mem, name, x, off = 0) => w(mem, A[name] + off, x);
const edge = (r, values, n = 256) => (r(3) ? r(n) : values[r(values.length)]);
const pick = (r, values) => values[r(values.length)];
const cell = r => ({ de: r(20) << 8 | r(18) });
const scroll = (m, r) => { w(m, 0xFF8A, r(256)); w(m, 0xFF8B, r(256)); };
const vblank = (m, r) => w(m, 0xFF8C, r(256));
const B6 = 0x06, B17 = 0x17, B1A = 0x1A, B3E = 0x3E, B18 = 0x18;

// ---- the pause menus (bank 6) ----
const menuPrep = (ids, counts = null) => (m, r) => {
  const id = pick(r, ids); v(m, "pauseMenuId", id);
  v(m, "pauseMenuItemCount", counts ? pick(r, counts) : 2 + r(3)); v(m, "matchMenuSelection", r(4)); scroll(m, r);
};
const scoreboardPrep = layouts => (m, r) => {
  v(m, "scoreboardLayout", pick(r, layouts)); v(m, "scoreboardOrigin", r(8)); v(m, "scoreboardOrigin", r(4), 1);
  v(m, "drillShotResultBits", r(256)); v(m, "drillShotResultBits", r(256), 1);
  v(m, "player1PointsWon", r(6)); v(m, "player2PointsWon", r(6)); scroll(m, r); vblank(m, r);
  w16(m, A.minigamesCurrentScore, r(10000)); w16(m, A.minigamesTargetScore, r(10000)); w16(m, A.minigameHighScore, r(10000));
  v(m, "minigameHighScoreMode", r(2));
};
const PAUSE = [
  T("DrawRulesNextPageArrow_06", B6, 0x4373, { prep: vblank }),
  T("MatchQuitMenu_SaveAndQuit", B6, 0x44B2), T("MatchQuitMenu_Retry", B6, 0x44C3),
  T("MatchQuitMenu_SelectNewLevel", B6, 0x44D4), T("MatchQuitMenu_Quit", B6, 0x44E5),
  T("DrawWindowFrameAt", B6, 0x4564, { gen: r => ({ ...cell(r), bc: (2 + r(18)) << 8 | (3 + r(13)) }), prep: scroll, wram: 2 }),
  T("RestoreBgTilemap", B6, 0x45AA, { wram: 2 }),
  T("RestoreBgTilemapRegion", B6, 0x45C1, { prep: scroll, wram: 2 }),
  T("ClearAttrPriorityRegion", B6, 0x45E9, { gen: r => ({ hl: 0xD400 + r(0x300), bc: 1 + r(0x80) }), wram: 2 }),
  T("Unused_06_FlushTilemapToVramIfDirty", B6, 0x45F3, { prep: (m, r) => { v(m, "tilemapDirtyFlag", r(2)); scroll(m, r); }, wram: 2 }),
  T("FlushTilemapToVram", B6, 0x45F8, { prep: scroll, wram: 2 }),
  T("GetShadowTilemapAddr", B6, 0x4624, { gen: cell, prep: scroll }),
  T("GetShadowAttrmapAddr", B6, 0x462E, { gen: cell, prep: scroll }),
  T("GetScrolledTilemapOffset", B6, 0x4638, { gen: cell, prep: scroll }),
  T("GetScrolledTilemapRowOffset", B6, 0x464B, { gen: cell, prep: scroll }),
  T("AdjustSpriteCoordsForScroll", B6, 0x465E, { prep: scroll }),
  T("GetMatchMenuItemId", B6, 0x480A, { gen: r => ({ a: r(4) }), prep: menuPrep([...Array(15).keys()]) }),
  T("GetMatchMenuItemCount", B6, 0x4820, { prep: menuPrep([...Array(15).keys()]) }),
  T("DrawMatchMenuItems", B6, 0x482F, { prep: menuPrep([0, 1, 2, 5, 11]), wram: 2 }),
  T("DrawMatchMenuCursor", B6, 0x4873, { prep: menuPrep([0, 2, 5, 11], [2, 3, 4]) }),
  T("DrawScoreboard", B6, 0x49A7, { gen: r => ({ bc: r(2) << 8 | r(256) }), prep: scoreboardPrep([0, 1, 2, 3, 4, 5, 6, 7]), wram: 2 }),
  T("DrawScoreboardPackedPips", B6, 0x4A13, { gen: r => ({ ...cell(r), bc: r(256) }), prep: scoreboardPrep([3]), wram: 2 }),
  T("DrawScoreboardFilledPips", B6, 0x4A3A, { gen: r => ({ ...cell(r), bc: r(6) }), prep: scoreboardPrep([5]), wram: 2 }),
  T("DrawScoreboardEmptyPips", B6, 0x4A53, { gen: r => ({ ...cell(r), bc: r(2) << 8 | (1 + r(5)) }), prep: scoreboardPrep([5]), wram: 2 }),
  T("CopyTextRectPair", B6, 0x5045, { gen: r => ({ ...cell(r), hl: pick(r, [0x4A9B, 0x4AA1, 0x4AA7, 0x5011, 0x5029]) }), prep: scroll, wram: 2 }),
  T("DrawScoreboardSprites", B6, 0x506A, { prep: scoreboardPrep([0, 1, 2, 3, 4, 5, 6, 7]) }),
  T("LoadMatchMenuItemGfx", B6, 0x5219, { gen: r => ({ a: r(24) }) }),
  T("LoadScoreboardModeGfx", B6, 0x5C8A, { prep: (m, r) => { v(m, "gameMode", r(11)); v(m, "currentMinigameStoryMatch", r(42), 1); } }),
  T("DrawMatchMenuItem", B6, 0x6802, { gen: r => ({ a: r(24), ...cell(r) }), prep: scroll, wram: 2 }),
  T("Unused_06_DrawMusicMenuRow", B6, 0x698B, { prep: (m, r) => { v(m, "courtViewLocked", r(2)); scroll(m, r); }, wram: 2 }),
  T("QueueMatchMenuCursorSprite", B6, 0x69B7, { prep: scroll }),
  T("DrawScoreboardModeTitle", B6, 0x69C8, { prep: scoreboardPrep([0]) }),
  T("Unused_06_DrawDebugStatsLabels", B6, 0x6ABA, { prep: scroll, wram: 2 }),
  T("Unused_06_DrawDebugStatsValues", B6, 0x6AF3, { prep: scroll, wram: 2 }),
  T("Unused_06_HandleDebugStatsInput", B6, 0x6BF6, { prep: (m, r) => { v(m, "matchMenuSelection", r(11)); w(m, 0xFF91, r(256)); scroll(m, r); }, wram: 2 }),
  T("Unused_06_QueueDebugStatsCursorSprites", B6, 0x6C13, { prep: (m, r) => { v(m, "matchMenuSelection", r(11)); scroll(m, r); } }),
  T("Unused_06_AdjustDebugStatByte", B6, 0x6CA8, { gen: r => ({ hl: 0xC768 + r(8), bc: r(256) << 8 }), prep: (m, r) => w(m, 0xFF91, pick(r, [0x10, 0x20, 0x30, 0])) }),
  T("Unused_06_AdjustDebugStatWord", B6, 0x6CBB, { gen: r => ({ hl: 0xC760 + r(8) }), prep: (m, r) => w(m, 0xFF91, pick(r, [0x10, 0x20, 0x30, 0])) }),
  T("GetStoryMenuItemId", B6, 0x6D74, { gen: r => ({ a: r(4) }), prep: menuPrep([0, 1, 2, 3, 4, 5]) }),
  T("GetStoryMenuItemCount", B6, 0x6D8A, { prep: menuPrep([0, 1, 2, 3, 4, 5]) }),
  T("DrawStoryMenuItems", B6, 0x6D99, { prep: menuPrep([0, 1, 2, 3, 4, 5], [2, 3, 4]), wram: 5 }),
  T("DrawStoryMenuCursor", B6, 0x6DDD, { prep: menuPrep([0, 3, 5], [2, 3, 4]) }),
  T("ClearStoryAttrPriorityBits", B6, 0x726A, { prep: (m, r) => w16(m, A.shadowTilemapPtr, 0xD000 + r(0x200)) }),
  T("LoadStoryMenuItemGfx", B6, 0x7283, { gen: r => ({ a: r(16) }) }),
  T("QueueStoryMenuCursorSprite", B6, 0x72CE, { prep: scroll }),
  T("DrawStoryMenuItem", B6, 0x77A6, { gen: r => ({ a: r(16), ...cell(r) }), prep: scroll, wram: 5 }),
  T("Unused_06_DrawStoryMenuItemRow", B6, 0x7863, { prep: scroll, wram: 5 }),
  T("CopyTileRectToShadowTilemap", B6, 0x7882, { gen: r => ({ hl: 0x77EB, de: 0xD000 + r(0x400), bc: (1 + r(12)) << 8 | (1 + r(3)) }), wram: 5 }),
  T("CopyTileRectToShadowAttrmap", B6, 0x78AB, { gen: r => ({ hl: 0x77EB, de: 0xD400 + r(0x400), bc: (1 + r(12)) << 8 | (1 + r(3)) }), wram: 5 }),
  // the unused pause menu of bank $1a
  T("Unused_1a_ResetPauseMenuState", B1A, 0x4092),
  T("Unused_1a_AdjustMessageSpeedSetting", B1A, 0x426B, { prep: (m, r) => { v(m, "pauseMenuOptionBits", r(4)); v(m, "messageSpeed", edge(r, [0, 1, 2, 0x80, 0x82])); } }),
  T("Unused_1a_ToggleMusicSetting", B1A, 0x42A9),
  T("Unused_1a_ForceInstantMessageSpeed", B1A, 0x42BC), T("Unused_1a_RestoreMessageSpeed", B1A, 0x42C5),
  T("Unused_1a_BuildMinigameModePauseMenu", B1A, 0x437C),
];

// ---- the briefings (bank $17) ----
const briefPrep = (m, r) => {
  for (let a = 0xD810; a <= 0xD82E; a++) wb(m, 3, a, r(256));
  wb(m, 3, 0xD827, r(4)); wb(m, 3, 0xD82E, r(4)); wb(m, 3, 0xD822, r(10)); wb(m, 3, 0xD82C, edge(r, [0x76, 0x77, 0x78]));
  for (const n of ["briefingHMarkerUnflipped", "briefingVMarkerUpright", "briefingSpinMarkerUnflipped"]) wb(m, 3, A[n], r(3));
  vblank(m, r); v(m, "storyModeMainCharacterLeftHanded", r(2));
};
const BRIEF = [
  T("Unused_17_DrawWobblingCornerBrackets", B17, 0x4016, { prep: vblank }),
  T("Unused_17_WriteGridPosFromLinearIndex", B17, 0x43CB, { gen: r => ({ bc: (1 + r(8)) << 8 | r(64), hl: 0xC600 + r(0x40) }) }),
  T("Unused_17_ClearWram3Row64", B17, 0x43D9, { gen: r => ({ hl: 0xD000 + r(0xF00) }) }),
  T("Unused_17_ClearWram3Row64Alt", B17, 0x43EF, { gen: r => ({ hl: 0xD000 + r(0xF00) }) }),
  T("UpdateAnimatedTilesTask_17", B17, 0x4406),
  T("Unused_17_DrawNameWithDiacritics", B17, 0x440A, { gen: r => ({ hl: 0xC600, de: 0xD020 + r(0x200) }),
    prep: (m, r) => { for (let i = 0; i < 12; i++) w(m, 0xC600 + i, i === 11 ? 0 : pick(r, [0x41, 0xDE, 0xDF, 0x42, 0x03])); }, wram: 3 }),
  T("Unused_17_DrawDecimalNumber", B17, 0x4443, { gen: r => ({ hl: r(0x10000), a: 1 + r(6), de: 0xD000 + r(0x200) }) }),
  T("Unused_17_DrawAsciiDigitString", B17, 0x4464, { gen: r => ({ hl: 0xC600, de: 0xD000 + r(0x200) }),
    prep: (m, r) => { for (let i = 0; i < 6; i++) w(m, 0xC600 + i, i === 5 ? 0 : r(0x50)); } }),
  T("Unused_17_DrawAsciiDigitChar", B17, 0x446E, { gen: r => ({ a: r(0x50), de: 0xD000 + r(0x200) }) }),
  T("DrawDiagramTargetOverlay", B17, 0x466C, { gen: r => ({ bc: r(7) << 8 }), wram: 3 }),
  T("CycleDiagramTargetPalette", B17, 0x4676, { prep: vblank }),
  ...[["DrawBriefingPlayerSprite", 0x46E2], ["DrawBriefingOpponentSprite", 0x470C], ["DrawBriefingBallSprite", 0x4736],
    ["DrawBriefingMarkerHFlip", 0x4754], ["DrawBriefingSwingAnim", 0x478E], ["DrawBriefingPoleSprites", 0x47EF],
    ["DrawBriefingMarkerVFlip", 0x481C], ["DrawSpinServeBriefingMarker", 0x4843], ["DrawBriefingMarkerRotated", 0x4876],
    ["DrawBlinkingPrompt", 0x48A2], ["DrawBriefingTargetBrackets", 0x48C1]].map(([n, a]) => T(n, B17, a, { prep: briefPrep })),
  T("ClearBriefingCaptionTilemap", B17, 0x49CE, { wram: 3 }),
  T("QueueCaptionRowToVRAM", B17, 0x49F9, { wram: 3 }),
  T("Unused_17_QueueSpritePair", B17, 0x4A1B),
  T("RestoreDiagramServiceBoxes", B17, 0x4A32, { wram: 3 }),
  T("QueueDiagramServiceBoxesToVRAM", B17, 0x4A48, { wram: 3 }),
  T("DrawDiagramTargetPatch", B17, 0x4A54, { gen: r => ({ bc: r(7) << 8 }), wram: 3 }),
  T("DecompressGraphicsList", B17, 0x4A99),
  T("LoadCourtDiagramObjPalettes", B17, 0x4B0D),
  ...[["ServeToTargetsBriefing_TickAnim", 0x570F], ["ServeToTargetsBriefing_AdvanceAnim", 0x571B],
    ["SpinServeBriefing_TickAnim", 0x5A75], ["SpinServeBriefing_AdvanceAnim", 0x5A81], ["SpinServeBriefing_TickAnim2", 0x5B21],
    ["SpinServeBriefing_AdvanceAnim2", 0x5B2D], ["PoleServeBriefing_TickAnim", 0x5DD0], ["PoleServeBriefing_AdvanceAnim", 0x5DDC],
    ["PoleServeBriefing_TickAnim2", 0x5E68], ["PoleServeBriefing_AdvanceAnim2", 0x5E74], ["ServeAndVolleyBriefing_TickAnim", 0x60DF],
    ["ServeAndVolleyBriefing_AdvanceAnim", 0x60EC], ["ReturnToTargetBriefing_TickAnim", 0x6958],
    ["ReturnToTargetBriefing_AdvanceAnim", 0x6965], ["ReturnLobBriefing_TickAnim", 0x6B99], ["ReturnLobBriefing_AdvanceAnim", 0x6BA6],
    ["ReturnDownLineBriefing_TickAnim", 0x6E00], ["ReturnDownLineBriefing_AdvanceAnim", 0x6E0D]].map(([n, a]) => T(n, B17, a, { prep: briefPrep, wram: 3 })),
  T("LoadRulesScreen", B17, 0x7157),
  T("ClearRulesScreenTextArea", B17, 0x71BD), T("ClearRulesPageRows", B17, 0x71DB),
  T("PrepareRulesPageTilemap", B17, 0x7202, { prep: (m, r) => { wb(m, 3, 0xDC05, r(2)); wb(m, 3, 0xDC06, r(3)); } }),
  T("LoadRulesBorderAnimTiles", B17, 0x7293),
  T("AdvanceRulesScreenAnimFrame", B17, 0x7420, { prep: (m, r) => { wb(m, 3, 0xDC03, r(2)); wb(m, 3, 0xDC04, edge(r, [0xFE, 0xFF])); vblank(m, r); } }),
  T("DrawRulesScreenCharacters", B17, 0x74DB, { prep: (m, r) => wb(m, 3, 0xDC00, r(6)) }),
  T("DrawRulesNextPageArrow", B17, 0x755E, { prep: vblank }),
];

// ---- the court select (bank $3e) ----
const courtPrep = (cols, rows) => (m, r) => {
  v(m, "menuCursorX", r(cols)); v(m, "menuCursorY", r(rows));
  for (let i = 0; i < 5; i++) wb(m, 2, 0xD000 + i, r(2));
  vblank(m, r);
};
const COURT = [
  T("CourtSelectIndexToCourtId", B3E, 0x5CFE, { gen: r => ({ a: r(9) }) }),
  T("LoadCourtSelectGraphics", B3E, 0x5D11, { prep: (m, r) => { v(m, "unlockedCourtMask", r(32)); v(m, "linkPartnerCourtMask", r(32)); } }),
  T("GetCourtThumbnailPtr", B3E, 0x5E17, { gen: r => ({ bc: r(9) }), prep: courtPrep(3, 3) }),
  T("CourtSelect4CursorSpriteTask", B3E, 0x5E93, { prep: courtPrep(2, 2) }),
  T("RedrawCourtSelect4Menu", B3E, 0x5F51, { prep: courtPrep(2, 2) }),
  T("SetCourtSelect4TabAttrRect", B3E, 0x5FAD, { gen: r => ({ bc: r(4) << 8 | r(2) }), wram: 3 }),
  T("SetCourtSelect4Palette", B3E, 0x5FDE, { gen: r => ({ a: r(4) }) }),
  T("SetCourtSelectBGM", B3E, 0x60DD, { gen: r => ({ bc: r(9) }) }),
  T("SetCourtSelectBGMLink", B3E, 0x60F4, { gen: r => ({ bc: r(9) }) }),
  T("DrawCourtSelectTitleRow", B3E, 0x6118), T("DrawCourtSelectTitleLeft", B3E, 0x6139, { wram: 3 }),
  T("DrawCourtSelectTitleRight", B3E, 0x6154, { wram: 3 }), T("FlushCourtSelectTitleRow", B3E, 0x615F),
  T("LoadCourtSelectTitleGfx", B3E, 0x617A),
  T("DrawCourtNameTiles", B3E, 0x648F, { gen: r => ({ bc: pick(r, [0, 3, 4, 8, 0xFF]) << 8 }) }),
  T("CourtSelect9CursorSpriteTask", B3E, 0x6714, { prep: courtPrep(3, 3) }),
  T("AdjustCursorForLockedCourt", B3E, 0x680C, { prep: courtPrep(3, 3) }),
  T("RedrawCourtSelect9Menu", B3E, 0x6824, { prep: courtPrep(3, 3) }),
  T("SetCourtSelect9TabAttrRect", B3E, 0x688B, { gen: r => ({ bc: r(9) << 8 | r(2) }), wram: 3 }),
  T("SetCourtSelect9Palette", B3E, 0x68C6, { gen: r => ({ a: r(9) }) }),
  T("StoreCourtUnlockBits", B3E, 0x695A),
  T("IsCourtUnlocked", B3E, 0x697B, { gen: r => ({ bc: r(9) << 8 }), prep: courtPrep(3, 3) }),
  T("ComputeUnlockedCourtFlags", B3E, 0x69A0),
  T("StubNop_3e", B3E, 0x69D4),
];

// ---- the scenes (bank $18) ----
const objectsPrep = (m, r) => {
  for (let i = 0; i < 16; i++) {
    for (let k = 0; k < 16; k++) wb(m, 3, 0xD800 + i * 16 + k, r(256));
    const cb = pick(r, [0x7E38, 0x7E89]); wb(m, 3, 0xD809 + i * 16, cb); wb(m, 3, 0xD80A + i * 16, cb >> 8);
  }
  vblank(m, r);
};
const SCENES = [
  T("Unused_18_CopyBytes11", B18, 0x55B9, { gen: r => ({ hl: 0xC600 + r(0x40), de: 0xC700 + r(0x40) }) }),
  T("Unused_18_ClearTileVramBothBanks", B18, 0x55DB),
  T("Unused_18_LoadConfirmScreenSpriteGfx", B18, 0x55F8, { wram: 1 }),
  T("Unused_18_LoadCharSelectCursorGfx", B18, 0x59C1),
  T("Unused_18_DrawCharSelectCursor", B18, 0x59D6, { gen: r => ({ a: pick(r, [0x84, r(256)]) }), prep: vblank }),
  T("Unused_18_ApplySpriteBobOffset", B18, 0x5A6A, { prep: vblank }),
  T("LoadOnCourtCharTilesA", B18, 0x5AB9, { gen: r => ({ a: r(32), de: 0x8000 + r(0x800) }) }),
  T("LoadOnCourtCharTilesB", B18, 0x5ACE, { gen: r => ({ a: pick(r, [0xFF, r(32)]), de: 0x8000 + r(0x800) }) }),
  T("LoadOnCourtCharTilesFallback", B18, 0x5AE7, { gen: r => ({ de: 0x8000 + r(0x800) }) }),
  T("ResetScrollAndCamera", B18, 0x7647),
  T("LookupScreen0AssetId", B18, 0x772D, { prep: (m, r) => v(m, "storySceneAssetIndex", r(6)) }),
  T("LookupScreen1AssetId", B18, 0x7842, { prep: (m, r) => v(m, "storySceneAssetIndex", r(6)) }),
  T("LookupScreen2AssetIdA", B18, 0x7A07, { prep: (m, r) => v(m, "storySceneAssetIndex", r(6)) }),
  T("LookupScreen2AssetIdB", B18, 0x7A1A, { prep: (m, r) => v(m, "storySceneAssetIndex", r(6)) }),
  T("SetupScreen1Assets", B18, 0x7835, { prep: (m, r) => v(m, "storySceneAssetIndex", r(6)) }),
  T("LoadScreen0TilesAndPalette", B18, 0x7740), T("LoadScreen1ObjTiles", B18, 0x78B1), T("LoadScreen2ObjTiles", B18, 0x7A2D),
  T("FillAllBgPalettes", B18, 0x7855),
  T("QueueScreen0Sprites", B18, 0x775C), T("QueueScreen1Sprites", B18, 0x78CD), T("QueueScreen2Sprites", B18, 0x7A49),
  T("TaskFadeInPalette_18", B18, 0x7A81, { prep: (m, r) => { wb(m, 3, 0xDA00, edge(r, [0x0F, 0x10], 0x11)); vblank(m, r); } }),
  T("TaskDrawObjectSprites_18", B18, 0x7B36, { prep: objectsPrep, wram: 3 }),
  T("TaskUpdateObjects_18", B18, 0x7B6E, { prep: objectsPrep, wram: 3 }),
  T("LoadObjectSceneATiles", B18, 0x7BE7), T("PopulateObjectArrayA", B18, 0x7C27, { wram: 3 }),
  T("LoadObjectSceneBTiles", B18, 0x7D1C), T("PopulateObjectArrayB", B18, 0x7D5C, { wram: 3 }),
];

export const ROUTINES = [...PAUSE, ...BRIEF, ...COURT, ...SCENES];
