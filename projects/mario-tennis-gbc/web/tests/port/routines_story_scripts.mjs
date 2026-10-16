// Routine tests for web/js/port/story_scripts, the story's scene scripts part 1 (src/story/academy_13 ..
// junior_singles_11 of the disassembly; run by web/tests/port_routines.mjs, filter "Scripts "): every hooked routine
// there that returns without waiting for a frame (the scenes that wait are checked by web/tests/port_lockstep.mjs),
// called at its ROM address on the ROM and on the port from recorded states of the overworld and the menus, with
// registers drawn per state (actor slots, levels, text ids, points in WRAM, random bytes) and prep() forcing the
// branches: the game flags (the story's progress, the challengers, the machine levels, doubles), the scene stages,
// the entry point, the genders and handedness, the drills and scores, the match format, the fireworks' and sky
// objects' bytes, the scroll. The registers compared are those each port says it returns (HOOK_TRACE.out of the
// hook adapter), plus all memory.
// usage: node web/tests/port_routines.mjs "Scripts " --rec out/engine/rec2.mtrec,out/port/story_walk1.mtrec,\
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
function E(name, bank, addr, { regs = () => ({}), prep = all, n = 2, active = null, wram, ignore, skip = [] } = {}) {
  const k = ++salt * 7919, off = salt % n;
  let i = 0;
  const entry = {
    name: `Scripts ${name}`, bank, addr, wram, ignore, out: [],
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
const all = (mem, r) => { flagsPrep(mem, r); storyPrep(mem, r); matchPrep(mem, r); objPrep(mem, r); };
const slot = r => pick(r, [0, 1, 2, 3, 4, 5, 8, 0x0C, 0x11, r(24)]);
const TEXT_IDS = [0x0001, 0x01AE, 0x1C1C, 0x2040, 0x246A, 0x3063];

const B = (bank, list, o = {}) => list.forEach(([name, addr, more]) => E(name, bank, addr, { ...o, ...more }));
const OW = { active: overworld };
B(0x13, [["GetDormRoomStoryStage_13", 0x5ACA], ["LoadTourPointerSpriteGfx_13", 0x4CDC, { n: 6 }],
  ["QueueTourPointerSprite_13", 0x4CFF], ["AnimateTourPointerSprite_13", 0x4D0A],
  ["SetDormRoomEventTriggerCells_13", 0x5067, OW]]);
B(0x10, [["AcademyWingInstallDoorTriggers_10", 0x7429, OW], ["AcademyWingHideActorByProgressFlag_10", 0x7443, OW],
  ["SetAcademyWingDialogueStage_10", 0x7472], ["UpdatePlayerPairTileAnimState_10", 0x79D0, OW],
  ["UpdateActorTileAnimState_10", 0x79DF, { ...OW, regs: r => ({ a: slot(r) }) }],
  ["Unused_10_UpdateActorTileAnimStateByIndex", 0x7A56, { ...OW, regs: r => ({ a: slot(r) }) }],
  ["Unused_10_WaterSpriteHook_Frame", 0x4BE8], ["Unused_10_WaterSpriteHook_RallyTick", 0x4BE9],
  ["Unused_10_WaterSpriteHook_Bounce", 0x4BEA], ["Unused_10_WaterSpriteHook_BallHit", 0x4BEB],
  ["Unused_10_WaterSpriteHook_PointStart", 0x4BFC], ["Unused_10_WaterSpriteHook_PointEnd", 0x4BFD],
  ...Array.from({ length: 11 }, (_, i) => [`Unused_10_StubNop${i}`, 0x4D9B + i]),
  ["Unused_10_RequestExitTrigger0e", 0x4DA6], ["DevelopmentInitScript_10", 0x4E6B],
  ["ApplyMatchTypeSettings", 0x4ECE]]);
B(0x0F, [["QueueFinishedRoundNameText", 0x78EC], ["ReplacePartnerWithStandInActor", 0x7A17, OW],
  ["QueueShortText", 0x7A8E, { regs: r => ({ hl: pick(r, TEXT_IDS) }) }], ["SetPlayerAndPartnerObjectDefs", 0x7B20, OW],
  ["Unused_0f_MapScriptNopAlt", 0x7B7F], ["Unused_0f_MapScriptClearActiveFlag", 0x7B80],
  ["Unused_0f_MapScriptPlaySoundA2", 0x7B85], ["Unused_0f_MapScriptHideLocationName", 0x7B88],
  ["Unused_0f_ComputeRankingProgressIndex", 0x7D43], ["Unused_0f_ComputeStoryRankTier", 0x7D8A],
  ["ReplacePlayerWithStandInActor", 0x5641, OW], ["FaceAwardsCeremonyCrowdUp", 0x5C96, OW],
  ["SavePlayerActorPosition", 0x5F52, OW], ["CheckAwardsCeremonyRivalSceneDone", 0x5F7A],
  ["TournamentExit_0f", 0x60DA], ["UpdateTournamentActorDrawModes_0f", 0x6310, OW],
  ["SetActorDrawModeFromSceneTile_0f", 0x631F, { ...OW, regs: r => ({ a: slot(r) }) }],
  ["UnusedSetActorDrawModeFromSceneTileSingle_0f", 0x6396, { ...OW, regs: r => ({ a: slot(r) }) }],
  ["ReadSceneTilemapTile_0f", 0x6408, { regs: r => ({ bc: 0xD000 + r(0x400), d: r(0x10), e: r(0x40) }) }],
  ["ComputeIslandOpenRound", 0x660F], ["LoadIslandOpenRoundNpcs", 0x6651, OW],
  ["LoadIslandOpenRoundNpcsDoubles", 0x66B8, OW], ["GetIslandOpenRoundParams", 0x7416],
  ["QueueUpcomingRoundNameText", 0x744D], ["CheckIslandOpenVictoryTransition", 0x745C]]);
B(0x27, [["MapScriptNop_27", 0x7885], ["Unused_27_MapScriptClearActiveFlag", 0x7886],
  ["Unused_27_MapScriptPlaySoundA2", 0x788B], ["Unused_27_MapScriptHideLocationName", 0x788E],
  ["Unused_27_ComputeRankingProgressIndex", 0x7A49], ["Unused_27_SetStoryRankTier", 0x7A90],
  ["SetEnd17CeremonyObjectDefs_27", 0x45BE, OW], ["SetPartnerObjDefByGender_27", 0x5626, OW]]);
B(0x11, [["CenterCourtFacing01_11", 0x4199], ["CenterCourtTile01_11", 0x41A3],
  ["SetupCenterCourtSceneVariant", 0x41B6, OW], ["SetPlayerAndPartnerObjectDefs_11", 0x4343, OW],
  ["ParkMiddleCourtPracticePair", 0x7A76, OW], ["MapScriptNop_11", 0x7BD1], ["Unused_11_MapScriptClearActiveFlag", 0x7BD2],
  ["Unused_11_MapScriptPlaySoundA2", 0x7BD7], ["Unused_11_MapScriptHideLocationName", 0x7BDA],
  ["ComputeRankingProgressIndex_11", 0x7D95], ["Unused_11_ComputeStoryRankTier", 0x7DDC],
  ["EnableAcademyCampusExit", 0x5482, OW], ["MoveCampusGateGuardAside", 0x54A6, OW],
  ["Unused_11_NullScriptA", 0x5A1F, OW], ["Unused_11_NullScriptB", 0x5A21, OW], ["Unused_11_NullScriptC", 0x692B, OW]]);
B(0x15, [["HideServeChallengerActor", 0x71BE, OW], ["TestServeChallengerGameFlag", 0x71D4],
  ["Unused_15_SetServeChallengerGameFlag", 0x71E6], ["HideNetChallengerActor", 0x7204, OW],
  ["TestNetChallengerGameFlag", 0x721A], ["Unused_15_SetNetChallengerGameFlag", 0x722C],
  ["HideStrokeChallengerActor", 0x724A, OW], ["TestStrokeChallengerGameFlag", 0x7260],
  ["Unused_15_SetStrokeChallengerGameFlag", 0x7272], ["MapScriptNop_15", 0x7D95],
  ["Unused_15_MapScriptClearActiveFlag", 0x7D96], ["Unused_15_MapScriptPlaySoundA2", 0x7D9B],
  ["Unused_15_MapScriptHideLocationName", 0x7D9E], ["Unused_15_ComputeRankingProgressIndex", 0x7F59],
  ["ComputeStoryRankTier_15", 0x7FA0]]);
B(0x14, [["TestMachineLevelClearedFlag", 0x469F, { regs: r => ({ a: pick(r, [0, 1, 2, 3, 4, 5, 6, 7, r(256)]) }) }],
  ["Unused_14_SetMachineLevelClearedFlag", 0x46AE, { regs: r => ({ a: r(8) }) }],
  ["UnusedMachineRecordOverrideAndReturn_14", 0x4813], ["Unused_14_CompareMinigameScoreToRecord", 0x4951],
  ["Court2Facing01_14", 0x4E4B], ["Court2Tile01_14", 0x4E55], ["InitCourt2SceneVariant", 0x4E60, OW],
  ["Court1Facing01_14", 0x50F0], ["Court1Tile01_14", 0x50FA], ["InitCourt1SceneVariant", 0x5105, OW],
  ["LoadCourtPlayerPartnerObjDefs_14", 0x51EA, OW], ["Unused_14_StubNop", 0x52AB],
  ["LoadFireworkObjGfx_14", 0x6427, { n: 6 }], ["UpdateFirework0_14", 0x644A], ["AdvanceFirework0Ascent_14", 0x64BE],
  ["IslandSkyInitScript_14.notDoubles", 0x6662], ["Unused_14_ResetFireworkObjOnButton", 0x6EC1],
  ["UpdateFirework1_14", 0x6EF0], ["AdvanceFirework1Ascent_14", 0x6F64],
  ["LoadIslandSkyEffectObjGfx_14", 0x73AA, { n: 6 }], ["AnimateIslandSkyEffectSprites_14", 0x73D8],
  ["LoadDistantPlaneObjGfx_14", 0x7539, { n: 6 }], ["QueueDistantPlaneSprite_14", 0x755C],
  ["GetSceneObjectScreenPos_14", 0x756D], ["LoadTwinkleObjGfx_14", 0x7688, { n: 6 }],
  ["QueueTwinkleSprite_14", 0x76AB], ["AdvancePlaneFrameCounter2_14", 0x7873],
  ["PlayPlaneMoveSfx_14", 0x78A7, { regs: r => ({ h: r(256) }) }], ["MapScriptNop_14", 0x78D9],
  ["Unused_14_MapScriptClearActiveFlag", 0x78DA], ["Unused_14_MapScriptPlaySoundA2", 0x78DF],
  ["Unused_14_MapScriptHideLocationName", 0x78E2], ["Unused_14_ComputeRankingProgressIndex", 0x7A9D],
  ["Unused_14_ComputeStoryRankTier", 0x7AE4]]);
B(0x0E, [["SetupGymActorsForProgress", 0x4681, OW]]);
