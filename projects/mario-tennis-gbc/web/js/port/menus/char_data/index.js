// menus/char_data: the story's character-data screens (bank $1C's level-up stat screen, bank $1D's STATUS pages, the
// confirm prompts, the EXP distribution flow) and bank $1A's racket arrows, ported from the
// gerbiljames/mario-tennis-gbc-disasm (MIT); see each module's header.
import { HOOKS as SCREEN } from "./screen.js";
import { HOOKS as STAT_ARROWS } from "./stat_arrows.js";
import { HOOKS as CONFIRM } from "./confirm.js";
import { HOOKS as PAGES } from "./pages.js";
import { HOOKS as PAGE_SLIDES } from "./page_slides.js";
import { HOOKS as EXP } from "./exp.js";
export const HOOKS = [...SCREEN, ...STAT_ARROWS, ...CONFIRM, ...PAGES, ...PAGE_SLIDES, ...EXP];
