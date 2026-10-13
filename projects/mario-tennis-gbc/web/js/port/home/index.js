// Bank 0 ("home"): the ported routines, by module. Each module exports HOOKS = [[bank, addr, fn(P, cpu)], ...]:
// ROM code reaching bank:addr runs fn instead (web/js/port/port.js).
import { HOOKS as JOYPAD } from "./joypad.js";
export const HOOKS = [...JOYPAD];
