// cutscenes: the ported routines, by module. Each module exports HOOKS = [[bank, addr, fn(P, cpu)], ...]:
// ROM code reaching bank:addr runs fn instead (web/js/port/port.js). Add each module here.
import { HOOKS as INTRO_STATES } from "./intro_states.js";
import { HOOKS as INTRO_SCENES } from "./intro_scenes.js";
import { HOOKS as TITLE } from "./title.js";
import { HOOKS as SCROLLTEXT } from "./scrolltext.js";
import { HOOKS as SCENE_ANIM } from "./scene_anim.js";
import { HOOKS as STORY_WINDOW } from "./story_window.js";
import { HOOKS as PALETTE_FADE } from "./palette_fade.js";
export const HOOKS = [...INTRO_STATES, ...INTRO_SCENES, ...TITLE, ...SCROLLTEXT, ...SCENE_ANIM, ...STORY_WINDOW, ...PALETTE_FADE];
