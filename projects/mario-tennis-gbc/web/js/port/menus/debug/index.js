// menus/debug: the unused debug screens of banks $1a and $1b: the EXP editor and EXP gain screen, the character
// viewer, and the debug text menus and unlock-flags screen; ported from the gerbiljames/mario-tennis-gbc-disasm (MIT);
// see each module's header.
import { HOOKS as EXPEDITOR } from "./expeditor.js";
import { HOOKS as EXP_BOXES } from "./exp_boxes.js";
import { HOOKS as EXPSCREEN } from "./expscreen.js";
import { HOOKS as EXP_GAUGE } from "./exp_gauge.js";
import { HOOKS as EXP_GFX } from "./exp_gfx.js";
import { HOOKS as CHAR_VIEWER } from "./char_viewer.js";
import { HOOKS as DEBUGMENU } from "./debugmenu.js";
export const HOOKS = [...EXPEDITOR, ...EXP_BOXES, ...EXPSCREEN, ...EXP_GAUGE, ...EXP_GFX, ...CHAR_VIEWER, ...DEBUGMENU];
