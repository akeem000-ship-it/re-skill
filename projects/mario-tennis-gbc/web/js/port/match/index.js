// match: the ported routines, by module. Each module exports HOOKS = [[bank, addr, fn(P, cpu)], ...]:
// ROM code reaching bank:addr runs fn instead (web/js/port/port.js). Add each module here.
import { HOOKS as ENGINE } from "./engine_hooks.js";
import { HOOKS as DRAW } from "./draw.js";
import { HOOKS as OBJ } from "./obj.js";
import { HOOKS as LOOP } from "./match_loop.js";
import { HOOKS as MATCH } from "./match.js";
import { HOOKS as VARIANTS } from "./variants.js";
import { keepingRegs } from "./regs.js";
import { LEFTOVERS } from "./leftovers.js";
// every hook keeps the caller's registers except the ones the ROM routine sets (regs.js, leftovers.js)
export const HOOKS = keepingRegs([...ENGINE, ...DRAW, ...OBJ, ...LOOP, ...MATCH, ...VARIANTS], LEFTOVERS);
