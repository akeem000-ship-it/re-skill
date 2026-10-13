// menus: the ported routines, by module. Each module exports HOOKS = [[bank, addr, fn(P, cpu)], ...]:
// ROM code reaching bank:addr runs fn instead (web/js/port/port.js). Add each module here.
// common/ (the shared menu code, banks $16-$18, $1B, $38, $39, $3B, $3E) and main_menu/ (boot, the main menu and
// its submenus) are ported from the gerbiljames/mario-tennis-gbc-disasm (MIT); see each module's header.
import { HOOKS as CURSORS } from "./common/cursors.js";
import { HOOKS as TILEMAPS } from "./common/tilemaps.js";
import { HOOKS as MENU_LIB } from "./common/menu_lib.js";
import { HOOKS as WIDGETS } from "./common/widgets.js";
import { HOOKS as CURSORBOX } from "./common/cursorbox.js";
export const HOOKS = [...CURSORS, ...TILEMAPS, ...MENU_LIB, ...WIDGETS, ...CURSORBOX];
