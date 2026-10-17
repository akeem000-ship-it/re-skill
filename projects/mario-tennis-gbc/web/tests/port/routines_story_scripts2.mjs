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
