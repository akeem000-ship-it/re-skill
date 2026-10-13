// match: the ported routines, by module. Each module exports HOOKS = [[bank, addr, fn(P, cpu)], ...]:
// ROM code reaching bank:addr runs fn instead (web/js/port/port.js). Add each module here.
import { HOOKS as ENGINE } from "./engine_hooks.js";
import { HOOKS as DRAW } from "./draw.js";
import { HOOKS as OBJ } from "./obj.js";
import { HOOKS as LOOP } from "./match_loop.js";
import { HOOKS as MATCH } from "./match.js";
import { HOOKS as VARIANTS } from "./variants.js";
export const HOOKS = [...ENGINE, ...DRAW, ...OBJ, ...LOOP, ...MATCH, ...VARIANTS];
