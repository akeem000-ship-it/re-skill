// menus/equipment: bank $3e's equipment screens (the erase-data warning, the racket-or-shoes and play-alone partner
// choices, the racket and shoes select screens, the equipment status screen), ported from the
// gerbiljames/mario-tennis-gbc-disasm (MIT); see each module's header.
import { HOOKS as RACKET_CHOICE } from "./racket_choice.js";
import { HOOKS as CHOICETAB } from "./choicetab.js";
import { HOOKS as RACKET_SELECT } from "./racket_select.js";
import { HOOKS as EQUIP } from "./equip.js";
export const HOOKS = [...RACKET_CHOICE, ...CHOICETAB, ...RACKET_SELECT, ...EQUIP];
