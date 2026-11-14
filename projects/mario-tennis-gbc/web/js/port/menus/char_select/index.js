// menus/char_select: the character-select screens (story "Create a Character", the exhibition and link grids, name
// entry, the new-game flow), ported from the gerbiljames/mario-tennis-gbc-disasm (MIT); see each module's header.
import { HOOKS as GRID_DATA } from "./grid_data.js";
import { HOOKS as GRID_PANELS } from "./grid_panels.js";
import { HOOKS as GRID_SCREEN } from "./grid_screen.js";
import { HOOKS as CHARACTER } from "./character.js";
import { HOOKS as MATCHTYPE } from "./matchtype.js";
import { HOOKS as NAME_ENTRY } from "./name_entry.js";
import { HOOKS as NEW_GAME } from "./new_game.js";
export const HOOKS = [...GRID_DATA, ...GRID_PANELS, ...GRID_SCREEN, ...CHARACTER, ...MATCHTYPE, ...NAME_ENTRY, ...NEW_GAME];
