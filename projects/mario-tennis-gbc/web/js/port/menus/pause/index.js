// menus/pause: the match and story pause menus, the scoreboard (bank 6) and the unused pause menu of bank $1a.
// Ported from the gerbiljames/mario-tennis-gbc-disasm (MIT); see each module's header.
import { HOOKS as MATCH_PAUSE } from "./match_pause.js";
import { HOOKS as SCOREBOARD } from "./scoreboard.js";
import { HOOKS as STORY_PAUSE } from "./story_pause.js";
import { HOOKS as OPTIONS_1A } from "./options_1a.js";
export const HOOKS = [...MATCH_PAUSE, ...SCOREBOARD, ...STORY_PAUSE, ...OPTIONS_1A];
