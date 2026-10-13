// minigames: the ported routines, by module. Each module exports HOOKS = [[bank, addr, fn(P, cpu)], ...]:
// ROM code reaching bank:addr runs fn instead (web/js/port/port.js). Add each module here.
// The training drills and minigames (banks $0B and $0D), ported from the gerbiljames/mario-tennis-gbc-disasm (MIT):
// common.js (shared constants and idioms), drills.js (bank $0B's drill framework), service_drills.js, net_drills.js,
// stroke_drills.js (the eighteen drills), minigame_core.js (bank $0D's shared machinery), games.js (the minigames).
import { HOOKS as DRILLS } from "./drills.js";
import { HOOKS as SERVICE } from "./service_drills.js";
import { HOOKS as NET } from "./net_drills.js";
import { HOOKS as STROKE } from "./stroke_drills.js";
import { HOOKS as CORE } from "./minigame_core.js";
import { HOOKS as GAMES } from "./games.js";
export const HOOKS = [...DRILLS, ...SERVICE, ...NET, ...STROKE, ...CORE, ...GAMES];
