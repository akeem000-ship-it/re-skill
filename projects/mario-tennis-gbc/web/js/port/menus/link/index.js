// menus/link: the link screens (bank $38's name entry editing, link match sequence and link character select
// pieces; bank $3e's link match rules, link message and link error screens), ported from the
// gerbiljames/mario-tennis-gbc-disasm (MIT); see each module's header.
import { HOOKS as LINK_SEQUENCE } from "./link_sequence.js";
import { HOOKS as REMOTE } from "./remote.js";
import { HOOKS as LINK_CURSOR } from "./link_cursor.js";
import { HOOKS as RULES } from "./rules.js";
import { HOOKS as LINKRULES } from "./linkrules.js";
export const HOOKS = [...LINK_SEQUENCE, ...REMOTE, ...LINK_CURSOR, ...RULES, ...LINKRULES];
