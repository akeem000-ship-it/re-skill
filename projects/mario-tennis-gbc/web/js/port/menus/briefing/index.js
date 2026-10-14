// menus/briefing: the drill briefings on the court diagram and the minigame rules screen (bank $17).
// Ported from the gerbiljames/mario-tennis-gbc-disasm (MIT); see each module's header.
import { HOOKS as DRILLS } from "./drills.js";               // (with screen.js's hooks)
import { HOOKS as RULES } from "./rules.js";
export const HOOKS = [...DRILLS, ...RULES];
