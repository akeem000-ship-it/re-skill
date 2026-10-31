// The game as a GamePort program: its entry points, interrupt handlers and the ported routines that replace ROM
// code (hooks). Every module of the port registers its routines here as [bank, addr, fn]; anything not listed
// still runs as the ROM's code (port.js, "Not yet ported code").
import { HOOKS as HOME } from "./home/index.js";
import { HOOKS as AUDIO } from "./audio/index.js";
import { HOOKS as TEXT } from "./text/index.js";
import { HOOKS as SAVE } from "./save/index.js";
import { HOOKS as CUTSCENES } from "./cutscenes/index.js";
import { HOOKS as MENUS } from "./menus/index.js";
import { HOOKS as STORY } from "./story/index.js";
import { HOOKS as STORY_SCRIPTS } from "./story_scripts/index.js";
import { HOOKS as MINIGAMES } from "./minigames/index.js";
import { HOOKS as MATCH } from "./match/index.js";
import { HOOKS as TWINS } from "./twins/index.js";
import { HOOKS as FETCH_TEXT } from "./standalone/fetch_text.js";
import { HOOKS as LINK } from "./match/link/index.js";

import { entry } from "./entry.js";

export const program = {
  ...entry,
  hooks: [...HOME, ...AUDIO, ...TEXT, ...SAVE, ...CUTSCENES, ...MENUS, ...STORY, ...STORY_SCRIPTS, ...MINIGAMES, ...MATCH, ...TWINS, ...FETCH_TEXT, ...LINK],
};
