// menus/results: the match results screens (bank $1E's results screen, its texts and "Continue?" prompt; bank $16's
// win / lose screen, match statistics and portraits), ported from the gerbiljames/mario-tennis-gbc-disasm (MIT); see
// each module's header.
import { HOOKS as RESULTS_SCREEN } from "./results_screen.js";
import { HOOKS as RESULTS_TEXT } from "./results_text.js";
import { HOOKS as RESULTS_PROMPT } from "./results_prompt.js";
import { HOOKS as RESULT } from "./result.js";
import { HOOKS as MATCH_STATS } from "./match_stats.js";
export const HOOKS = [...RESULTS_SCREEN, ...RESULTS_TEXT, ...RESULTS_PROMPT, ...RESULT, ...MATCH_STATS];
