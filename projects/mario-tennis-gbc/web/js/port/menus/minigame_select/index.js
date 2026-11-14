// menus/minigame_select: the Mario minigame select (bank $3b), the minigame level select, the saved-data type select
// and the minigame data chart (bank $1b), with bank $1b's unused confirm screens beside them; ported from the
// gerbiljames/mario-tennis-gbc-disasm (MIT); see each module's header.
import { HOOKS as MINIGAME } from "./minigame.js";
import { HOOKS as LEVEL_SELECT } from "./level_select.js";
import { HOOKS as LEVEL_VARIANTS } from "./level_variants.js";
import { HOOKS as MINIGAME_DATA } from "./minigame_data.js";
import { HOOKS as DATA_MARKS } from "./data_marks.js";
export const HOOKS = [...MINIGAME, ...LEVEL_SELECT, ...LEVEL_VARIANTS, ...MINIGAME_DATA, ...DATA_MARKS];
