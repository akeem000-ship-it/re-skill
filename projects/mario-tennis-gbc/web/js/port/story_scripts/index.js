// story_scripts: the story's scenes and their native routines (src/story/ of the gerbiljames/mario-tennis-gbc-disasm,
// MIT), part 1 (academy_13 .. junior_singles_11). Each module exports HOOKS = [[bank, addr, fn(P, cpu)], ...]: ROM
// code reaching bank:addr runs fn instead (web/js/port/port.js). Add each module here.
import { HOOKS as ACADEMY_13 } from "./academy_13.js";
import { HOOKS as DORM_13 } from "./dorm_13.js";

export const MODULES = {
  academy_13: ACADEMY_13, dorm_13: DORM_13,
};
export const HOOKS = Object.values(MODULES).flat();
