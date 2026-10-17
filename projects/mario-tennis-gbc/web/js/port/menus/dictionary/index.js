// menus/dictionary: the tennis dictionary (bank $3f), ported from the gerbiljames/mario-tennis-gbc-disasm (MIT); see
// each module's header.
import { HOOKS as SCREEN } from "./screen.js";
import { HOOKS as INDEX_LIST } from "./index_list.js";
export const HOOKS = [...SCREEN, ...INDEX_LIST];
