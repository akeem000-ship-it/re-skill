// menus/ranking: the Island Open ranking board and the mugshot loaders (bank $1B), the team bracket, the Mario-cast
// exhibition chart and victories (bank $3B), ported from the gerbiljames/mario-tennis-gbc-disasm (MIT); see each
// module's header.
import { HOOKS as BOARD } from "./board.js";
import { HOOKS as BOARD_MARKERS } from "./board_markers.js";
import { HOOKS as BOARD_NAMES } from "./board_names.js";
import { HOOKS as BRACKET } from "./bracket.js";
export const HOOKS = [...BOARD, ...BOARD_MARKERS, ...BOARD_NAMES, ...BRACKET];
