// Routine tests for web/js/port/twins (run by web/tests/port_routines.mjs, filter "Twins "): each twin copy that
// does not wait, against the ROM's copy, with the same random states and forced branches as the test of the
// verified copy it is identical to (web/tests/port/routines_story_scripts.mjs, web/tests/engine/routines_shot.mjs).
// The copies are hooked on the port from web/js/port/twins/index.js (program.js does not list that module).
// usage: node web/tests/port_routines.mjs "Twins " --rec out/engine/rec2.mtrec,out/port/story_walk1.mtrec,\
//   out/port/cs_story_new2.mtrec,out/engine/exh1.mtrec --every 97
import { HOOKS } from "../../js/port/twins/index.js";
import { HOOK_TRACE } from "../../js/port/menus/char_select/defs.js";
import { hookKey } from "../../js/port/port.js";
import { ROUTINES as STORY } from "./routines_story_scripts.mjs";
import { ROUTINES as SHOT } from "../engine/routines_shot.mjs";
import { inMatch, quiet, callHook } from "./routines_match.mjs";

const TWINS = new Map(HOOKS.map(([b, a, fn]) => [hookKey(b, a), fn]));
const install = P => { for (const [k, fn] of TWINS) P.hooks.set(k, fn); };
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
export const ROUTINES = [];

// a story copy: the verified copy's entry (states, registers, preparation) at the copy's bank and address
const byName = new Map(STORY.map(R => [R.name.replace(/^Scripts /, ""), R]));
function S(name, bank, addr, model) {
  const M = byName.get(model);
  if (!M) throw new Error(`no story routine test ${model}`);
  const entry = {
    name: `Twins ${name}`, bank, addr, wram: M.wram, ignore: M.ignore, out: [], when: M.when, regs: M.regs, prep: M.prep,
    js(P, regs) {
      install(P);
      HOOK_TRACE.out = null;
      P.ime = false;
      const ret = P.callRom(bank, addr, regs);
      entry.out = regNames(HOOK_TRACE.out);
      return ret;
    },
  };
  ROUTINES.push(entry);
}
S("ComputeRankingProgressIndex_0e", 0x0E, 0x7E5A, "ComputeRankingProgressIndex_11");
S("ComputeRankingProgressIndex_12", 0x12, 0x7C75, "ComputeRankingProgressIndex_11");
S("ComputeStoryRankTier_13", 0x13, 0x7D58, "ComputeStoryRankTier_15");
S("FetchAndPushShortTextArg", 0x0E, 0x4F3C, "QueueShortText");
S("PushTextArgFetchedString", 0x12, 0x7A68, "QueueShortText");
S("SetPlayerPartnerActorSprites", 0x15, 0x475F, "LoadCourtPlayerPartnerObjDefs_14");
S("AdvancePlaneFrameCounter_14", 0x14, 0x641F, "AdvancePlaneFrameCounter2_14");
S("ApplyPartnerCharacterVariant_13", 0x13, 0x62BE, "SetPartnerObjDefByGender_27");
S("ReadSceneTilemapTile_10", 0x10, 0x7AC8, "ReadSceneTilemapTile_0f");

// a ball-path copy: the engine's entry for the bank-$20 copy (routines_shot.mjs), in another bank
const shotByName = new Map(SHOT.map(R => [R.name, R]));
function T(name, bank, addr, model) {
  const M = shotByName.get(model);
  if (!M) throw new Error(`no shot routine test ${model}`);
  const hookOf = callHook(bank, addr);
  ROUTINES.push({
    name: `Twins ${name}`, bank, addr, wram: M.wram, regs: M.regs, out: [], when: inMatch,
    prep: (m, s) => { quiet(m); if (M.wram !== undefined) m.hram[0x16] = M.wram; M.prep(m, s); m.hram[0x15] = bank; },
    js: (P, regs) => { install(P); return hookOf(P, regs); },
  });
}
for (const [b, a] of [[0x21, 0x41F5], [0x22, 0x41F5], [0x23, 0x41F5], [0x24, 0x4201], [0x2C, 0x41F9]])
  T(`SetBallTargetFromAim_${b.toString(16)}`, b, a, "SetBallTargetFromAim_20");
for (const b of [0x21, 0x22, 0x23]) T(`ApplyBallTrajectory6Capped_${b.toString(16)}`, b, 0x4102, "ApplyBallTrajectory6Capped_20");
