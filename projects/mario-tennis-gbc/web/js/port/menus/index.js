// menus: the ported routines, by module. Each module exports HOOKS = [[bank, addr, fn(P, cpu)], ...]:
// ROM code reaching bank:addr runs fn instead (web/js/port/port.js). Add each module here.
// common/ (the shared menu code, banks $16-$18, $1B, $38, $39, $3B, $3E) and main_menu/ (boot, the main menu and
// its submenus) are ported from the gerbiljames/mario-tennis-gbc-disasm (MIT); see each module's header.
import { HOOKS as CURSORS } from "./common/cursors.js";
import { HOOKS as TILEMAPS } from "./common/tilemaps.js";
import { HOOKS as MENU_LIB } from "./common/menu_lib.js";
import { HOOKS as WIDGETS } from "./common/widgets.js";
import { HOOKS as CURSORBOX } from "./common/cursorbox.js";
import { HOOKS as PROMPTS } from "./common/prompts.js";
import { HOOKS as BOOT } from "./main_menu/boot.js";
import { HOOKS as MAIN_MENU } from "./main_menu/main_menu.js";
import { HOOKS as N64 } from "./main_menu/n64.js";
import { HOOKS as MATCH_FORMAT } from "./main_menu/match_format.js";
import { HOOKS as SAVED } from "./main_menu/saved.js";
import { HOOKS as ERASE } from "./main_menu/erase.js";
import { HOOKS as N64TRANSFER } from "./main_menu/n64transfer.js";
import { HOOKS as N64DATA } from "./main_menu/n64data.js";
import { HOOKS as CHAR_SELECT } from "./char_select/index.js";
import { HOOKS as CHAR_DATA } from "./char_data/index.js";
export const HOOKS = [...CURSORS, ...TILEMAPS, ...MENU_LIB, ...WIDGETS, ...CURSORBOX, ...PROMPTS,
  ...BOOT, ...MAIN_MENU, ...N64, ...MATCH_FORMAT, ...SAVED, ...ERASE, ...N64TRANSFER, ...N64DATA,
  ...CHAR_SELECT, ...CHAR_DATA];
