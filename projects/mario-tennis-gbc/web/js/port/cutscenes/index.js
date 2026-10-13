// cutscenes: the ported routines, by module. Each module exports HOOKS = [[bank, addr, fn(P, cpu)], ...]:
// ROM code reaching bank:addr runs fn instead (web/js/port/port.js). Add each module here.
import { HOOKS as INTRO_STATES } from "./intro_states.js";
import { HOOKS as INTRO_SCENES } from "./intro_scenes.js";
import { HOOKS as TITLE } from "./title.js";
export const HOOKS = [...INTRO_STATES, ...INTRO_SCENES, ...TITLE];
