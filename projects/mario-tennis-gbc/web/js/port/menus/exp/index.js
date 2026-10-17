// menus/exp: the EXP screens (bank $1E's award calculation, award screen and sequence, the rewards, trophies and the
// game-progress screen; bank $1D's EXP distribution loop and pending awards), ported from the
// gerbiljames/mario-tennis-gbc-disasm (MIT); see each module's header.
import { HOOKS as DISTRIBUTE } from "./distribute.js";
import { HOOKS as AWARD_CALC } from "./award_calc.js";
import { HOOKS as AWARD_SCREEN } from "./award_screen.js";
import { HOOKS as AWARD_SEQUENCE } from "./award_sequence.js";
import { HOOKS as REWARD } from "./reward.js";
import { HOOKS as GAMEPROGRESS } from "./gameprogress.js";
export const HOOKS = [...DISTRIBUTE, ...AWARD_CALC, ...AWARD_SCREEN, ...AWARD_SEQUENCE, ...REWARD, ...GAMEPROGRESS];
