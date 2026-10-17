// Routine tests for web/js/port/story_scripts, the story's scene scripts part 2 (src/story/lessonmenu_10 ..
// water_15 of the disassembly; run by web/tests/port_routines.mjs, filter "Scripts2 "): every hooked routine
// there that returns without waiting for a frame (the scenes that wait are checked by web/tests/port_lockstep.mjs),
// called at its ROM address on the ROM and on the port from recorded states of the overworld and the menus, with
// registers drawn per state (actor slots, levels, text ids, points in WRAM, random bytes) and prep() forcing the
// branches: the game flags (the story's progress, the challengers, the machine levels, doubles), the scene stages,
// the entry point, the genders and handedness, the drills and scores, the match format, the fireworks' and sky
// objects' bytes, the scroll. The registers compared are all eight (the hook puts back the ones the routine keeps and
// sets its results; F: Z and C), plus all memory.
// usage: node web/tests/port_routines.mjs "Scripts2 " --rec out/engine/rec2.mtrec,out/port/story_walk1.mtrec,\
//   out/port/cs_story_new2.mtrec --every 97
import { RAM_FIELDS } from "../../js/port/fields.js";
import { rng, pick } from "./routines_menus_common.mjs";
import { HOOK_TRACE } from "../../js/port/menus/char_select/defs.js";
import { hookKey } from "../../js/port/port.js";

const FIELD = Object.fromEntries(RAM_FIELDS.map(([n, bank, addr, size]) => [n, { bank, addr, size }]));
const at = name => { if (!FIELD[name]) throw new Error(`no field ${name}`); return FIELD[name].addr; };
const wx = (mem, bank, a, v) => { a &= 0xFFFF; if (a >= 0xD000 && a < 0xE000) mem.wram[bank || 1][a - 0xD000] = v & 0xFF; else mem.write(a, v & 0xFF); };
const wf = (mem, name, v, off = 0) => wx(mem, FIELD[name] ? FIELD[name].bank : 0, at(name) + off, v);
const wf16 = (mem, name, v, off = 0) => { wf(mem, name, v, off); wf(mem, name, v >> 8, off + 1); };
const ALL = ["a", "f", "b", "c", "d", "e", "h", "l"];

// ---- the entries ----
export const ROUTINES = [];
let salt = 0;
function E(name, bank, addr, { regs = () => ({}), prep = all, n = 2, active = null, wram, ignore, skip = [] } = {}) {
  const k = ++salt * 7919, off = salt % n;
  let i = 0;
  const entry = {
    name: `Scripts2 ${name}`, bank, addr, wram, ignore, out: [],
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
      entry.out = ALL.filter(r => !skip.includes(r));         // (the hook sets every register: the kept and its results)
      return ret;
    },
  };
  ROUTINES.push(entry);
}
// the overworld is up (live actors: the player's record in WRAM 4 marked live)
const overworld = s => (s.m.mem.wram[4][0x30] & 0x80) !== 0;

// ---- randomized state ----
const FLAGS = at("gameFlags");
const FLAG_BYTES = 0x20;
function flagsPrep(mem, r) {                                 // every game flag: all set, all clear or random
  const mode = r(4);
  for (let i = 0; i < FLAG_BYTES; i++) mem.write(FLAGS + i, mode === 0 ? 0 : mode === 1 ? 0xFF : r(256));
}
function storyPrep(mem, r) {
  wf(mem, "mapSceneStage", pick(r, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0x20, 0x50, r(256)]));
  wf(mem, "mapSceneStage2", pick(r, [0, 1, 0x0C, 0x11, 0x58, 0x88, r(256)]));
  wf(mem, "storyModeEntryPoint", pick(r, [0, 1, 2, 7, 8, 0x0A, 0x0C, 0x0D, 0x0E, 0x0F, 0xFF, r(256)]));
  wf(mem, "storyModeGenderOfMainCharacter", r(2));
  wf(mem, "storyModeGenderOfPartnerCharacter", r(2));
  wf(mem, "storyModeMainCharacterLeftHanded", r(2));
  wf(mem, "storyModeShowLocationName", r(2));
  wf(mem, "currentMinigameStoryMatch", pick(r, [0, 1, 3, 4, 9, 0x0A, 0x0E, 0x12, 0x15, 0x19, 0x1A, r(0x20)]), 1);
  wf(mem, "pointWinLoseFlag", pick(r, [0, 1, 2, 0xFF]));
  wf(mem, "currentStorySlot", pick(r, [0, 1, 2, 3]));
}
function matchPrep(mem, r) {
  wf16(mem, "minigamesCurrentScore", pick(r, [0, 1, 2, 50, 0x270F, 0x2710, r(0x10000)]));
  wf16(mem, "minigamesTargetScore", r(0x10000));
  wx(mem, 7, at("minigameRecordValue"), r(256)); wx(mem, 7, at("minigameRecordValue") + 1, pick(r, [0, 0x26, 0x27, r(256)]));
  wf(mem, "rallyLength", pick(r, [0, 1, 2, 3, r(256)]));
  wf(mem, "totalPointsScoredInCurrentGame", r(256));
  wf(mem, "character1ServiceAces", r(4));
  wf(mem, "character2ServiceAces", r(4));
  wf(mem, "matchFormatSets", pick(r, [0, 1, 2, r(8)]));
  wf(mem, "matchFormatGames", pick(r, [0, 1, r(8)]));
  wf(mem, "matchFormatDoubles", r(2));
}
function objPrep(mem, r) {                                   // the cutscene objects (fireworks, splashes, the sky)
  for (let i = 0; i < 14; i++) mem.write(at("cutsceneObjX") + i, pick(r, [0, 1, 3, 4, 9, 0x0A, 0x0C, 0x13, 0x14, r(256)]));
  mem.write(0xFF8B, r(256)); mem.write(0xFF8C, r(256));      // hScrollX, hScrollY
  wf(mem, "inputRisingEdge", pick(r, [0, 2, r(256)]));
}
const both = (a, b) => (mem, r, s) => { a(mem, r, s); b(mem, r, s); };
const all = (mem, r) => { flagsPrep(mem, r); storyPrep(mem, r); matchPrep(mem, r); objPrep(mem, r); };
const slot = r => pick(r, [0, 1, 2, 3, 4, 5, 8, 0x0C, 0x11, r(24)]);
const TEXT_IDS = [0x0001, 0x01AE, 0x1C1C, 0x2040, 0x246A, 0x3063];

const B = (bank, list, o = {}) => list.forEach(([name, addr, more]) => E(name, bank, addr, { ...o, ...more }));
const OW = { active: overworld };
// walks_10
B(0x10, [["ReadSceneTilemapTile_10", 0x7AC8, { regs: r => ({ bc: 0xD000 + r(0x400), d: r(0x40), e: r(0x10) }) }],
  ["GetDoublesProgressStage_10", 0x7BB6], ["MapScriptNop_10", 0x7BF9], ["Unused_10_MapScriptClearActiveFlag", 0x7BFA],
  ["Unused_10_MapScriptPlaySoundA2", 0x7BFF], ["Unused_10_MapScriptHideLocationName", 0x7C02],
  ["SetStoryDialogueStage_10", 0x7DBD], ["Unused_10_ComputeStoryRankTier", 0x7E04]]);
// map_stubs_12
B(0x12, [["PushTextArgFetchedString", 0x7A68, { regs: r => ({ hl: pick(r, TEXT_IDS) }) }], ["MapScriptNop_12", 0x7AB1],
  ["Unused_12_MapScriptClearActiveFlag", 0x7AB2], ["Unused_12_MapScriptPlaySoundA2", 0x7AB7],
  ["Unused_12_MapScriptHideLocationName", 0x7ABA], ["ComputeRankingProgressIndex_12", 0x7C75],
  ["Unused_12_ComputeStoryRankTier", 0x7CBC]]);
// the training gym's runners and the repair counter (repair_0e), Mario World (mario_world_0e), the star warp
// (specialcourt_0e), the exhibition's settings (match_setup_0e)
const scratchPrep = both(all, (mem, r) => {
  for (let i = 0; i < 12; i++) mem.write(at("mapScratch") + i, pick(r, [0, 1, 4, 5, 0x10, 0xFF, r(256)]));
  wf(mem, "equippedRacket", pick(r, [0, 0x11, 0x21, 0x12, r(256)]));
});
const warpPrep = both(all, (mem, r) => {
  const w6 = mem.wram[6];
  w6[0] = r(6); w6[1] = pick(r, [0, 2, 0x40, 0xB2, r(256)]); w6[2] = pick(r, [1, 2, 0x1E, 0x5A, r(256)]);
  for (let i = 3; i < 0x13; i++) w6[i] = pick(r, [0, 1, 2, 3, 0x10, r(256)]);
  for (let i = 0x14; i < 0x34; i++) w6[i] = r(256);
  w6[0x40] = r(256); w6[0x41] = r(256);
  mem.write(0xFF8C, r(256));                                 // hVBlankCounter
});
B(0x0E, [["TrainingGymRunner0AWaitWaypointClear", 0x4C37, OW], ["UnusedTrainingGymRunner0AClearWaypoint", 0x4C7C, OW],
  ["TrainingGymRunner0BWaitWaypointClear", 0x4C8E, OW], ["UnusedTrainingGymRunner0BClearWaypoint", 0x4CD3, OW],
  ["TrainingGymRunner0CWaitWaypointClear", 0x4CE5, OW], ["UnusedTrainingGymRunner0CClearWaypoint", 0x4D2A, OW],
  ["TrainingGymRunnerCheckClearance", 0x4D3C], ["FetchAndPushShortTextArg", 0x4F3C, { regs: r => ({ hl: pick(r, TEXT_IDS) }) }],
  ["GetEquippedRacketNibble", 0x4F5D], ["PushEquipmentNameTextArg", 0x4F73],
  ["CompareEquippedRacketToMinigameFlag", 0x5005], ["MirrorPlayerSpriteIfLeftHanded", 0x520F, OW],
  ["Unused_0e_StubNop", 0x54D1], ["ComputeMarioWorldProgressIndex", 0x555D]], { prep: scratchPrep });
B(0x0E, [["UpdateStarWarpSprite", 0x71E9, { wram: 6 }], ["OffsetStarWarpPathPoint", 0x724A, { wram: 6, regs: r => ({ d: r(256), e: r(256) }) }],
  ["UpdateStarWarpTrailSparkles", 0x7265, { wram: 6 }]], { prep: warpPrep });
B(0x0E, [["LoadExhibitionMatchSettings0", 0x7BB8], ["LoadExhibitionMatchSettings1", 0x7BC6],
  ["LoadExhibitionMatchSettings2", 0x7BD4], ["LoadExhibitionMatchSettings3", 0x7BE2],
  ["LoadExhibitionMatchSettings4", 0x7BF0], ["LoadExhibitionMatchSettings5", 0x7BFE], ["MapScriptNop_0e", 0x7C96],
  ["Unused_0e_MapScriptClearActiveFlag", 0x7C97], ["Unused_0e_MapScriptPlaySoundA2", 0x7C9C],
  ["Unused_0e_MapScriptHideLocationName", 0x7C9F], ["ComputeRankingProgressIndex_0e", 0x7E5A],
  ["Unused_0e_ComputeStoryRankTier", 0x7EA1]]);
// match_10: the init script, the scene animation's frame task, the match loaders
B(0x10, [["MatchSelectInitScript_10", 0x4190], ["SceneAnimationFrameTask_10", 0x4141],
  ...[0x4266, 0x4274, 0x4282, 0x4290, 0x429E, 0x42AC, 0x42BA, 0x42C8, 0x42D6, 0x42E4, 0x42F2, 0x4300, 0x430E, 0x431C,
    0x432A, 0x4338, 0x4346, 0x4354, 0x4362, 0x4370, 0x437E, 0x438C, 0x439A, 0x43A8, 0x43B6, 0x43C4, 0x43D2, 0x43E0,
    0x43EE, 0x43FC, 0x440A, 0x4418, 0x4426, 0x4434, 0x4442].map(addr => [`LoadMatch_10_${addr.toString(16)}`, addr])]);
// restaurant_10: the main menu's helpers, the restaurant's exit, init script and the students' positions and flags
const restPrep = both(all, (mem, r) => {
  wf(mem, "mapSceneStage2", pick(r, [0, 1, 2, 3, 4, r(256)]));
  wf(mem, "saveAndQuitRequest", r(2));
  for (let i = 0; i < 4; i++) wf(mem, "matchSlotCharRefs", pick(r, [0, 0x80, 0x82, 0x84, r(256)]), i);
  for (let i = 0; i < 4; i++) wx(mem, 3, at("charSelectSlotChars") + i, r(256));
});
B(0x10, [["GetMinigameDrillId", 0x56E9, { regs: r => ({ a: pick(r, [0, 1, 4, 8, 0x0C, r(256)]) }) }],
  ["CopyExhibitionCharSlotIds", 0x56FC, { wram: 3 }], ["Unused_10_CheckAnyStorySlot", 0x571E],
  ["GetStoryContinueDestination", 0x5752], ["RestaurantExit01_10", 0x5BEE],
  // (script-macro routines, their registers put back: memory only)
  ["RestaurantInitScript_10", 0x60F1, { ...OW, skip: ALL }], ["RestaurantRestoreNpc08Position_10", 0x6103, { ...OW, skip: ALL }],
  ["RestaurantRestoreNpc12Position_10", 0x611B, { ...OW, skip: ALL }], ["TestRestaurantNpc12StageFlag_10", 0x612C],
  ["SetRestaurantNpc12StageFlag_10", 0x613E]], { prep: restPrep });
// plane_14: the plane's and the splashes' graphics, sprites and frame counter
const splashPrep = both(all, (mem, r) => {
  for (const [name, vals] of [["cutsceneObjX", [0, 0x40, 0x5E, r(256)]], ["cutsceneObjY", [0, 1, 2, 0x0F, r(256)]],
    ["cutsceneObjActive", [0, 0, 1, r(256)]], ["cutsceneObjLimit", [0, 0x14, 0x20, 0x3C, r(256)]],
    ["cutsceneObjPhase", [0, 0x10, 0x14, 0x18, 0x20, 0x3C, r(256)]], ["cutsceneObjRiseTimer", [0, 0, 1, 0x10, r(256)]],
    ["cutsceneObjTimer", [0, 6, 7, 8, 9, r(256)]]]) for (const i of [0, 1]) wf(mem, name, pick(r, vals), i);
  wf(mem, "mapSceneStage2", pick(r, [0x88, 0x91, 0x92, 0x9C, 0xA6, 0xD8, 0xFF, r(256)]));
});
B(0x14, [["LoadPlaneObjGfx_14", 0x5E79], ["QueuePlaneSpriteByHeight_14", 0x5E9C], ["LoadWaterSplashObjGfx_14", 0x60A1],
  ["UpdateWaterSplash0_14", 0x60C4], ["AdvanceWaterSplash0Rise_14", 0x616B], ["UpdateWaterSplash1_14", 0x617E],
  ["AdvanceWaterSplash1Rise_14", 0x6225], ["LoadPlaneObjGfx2_14", 0x6238],
  ["QueuePlaneSpriteByFrameCounter_14", 0x625B], ["AdvancePlaneFrameCounter_14", 0x641F]], { prep: splashPrep, n: 1 });
