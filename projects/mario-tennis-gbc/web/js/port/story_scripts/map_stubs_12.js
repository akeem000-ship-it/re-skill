// Bank $12's shared stubs ($7A65-$7CEC): the short-text argument routine, the map-script stubs and the bank's unused
// copy of the story-rank tier. The actor scripts (ActorScript_12_51..58) and Unclassified_12 are data.
// Port of src/story/map_stubs_12.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/engine/rec1.mtrec, rec2.mtrec (bank $12's senior court scenes: the round names); tests:
// web/tests/port/routines_story_scripts2.mjs.
import { hook } from "./common.js";
import { computeStoryRankTier } from "./twins.js";
import { mapScriptStubs, pushTextArgFetchedString } from "./shared2.js";

const BANK = 0x12;

export const HOOKS = [
  [BANK, 0x7A68, hook((P, c) => pushTextArgFetchedString(P, c.hl, c.f))],   // PushTextArgFetchedString
  ...mapScriptStubs(BANK, 0x7AB1, 0x7AB2, 0x7AB7, 0x7ABA),
  [BANK, 0x7CBC, hook(P => computeStoryRankTier(P))],               // Unused_12_ComputeStoryRankTier
];
