// story_scripts: the story's scenes and their native routines (src/story/ of the gerbiljames/mario-tennis-gbc-disasm,
// MIT), part 1 (academy_13 .. junior_singles_11). Each module exports HOOKS = [[bank, addr, fn(P, cpu)], ...]: ROM
// code reaching bank:addr runs fn instead (web/js/port/port.js). Add each module here.
import { HOOKS as ACADEMY_13 } from "./academy_13.js";
import { HOOKS as ACADEMY_MAIN_10 } from "./academy_main_10.js";
import { HOOKS as ACADEMY_WING_10 } from "./academy_wing_10.js";
import { HOOKS as ACTOR_0F } from "./actor_0f.js";
import { HOOKS as ACTOR_27 } from "./actor_27.js";
import { HOOKS as AWARDS_0F } from "./awards_0f.js";
import { HOOKS as CENTER_11 } from "./center_11.js";
import { HOOKS as COURT_PRACTICE_11 } from "./court_practice_11.js";
import { HOOKS as DORM_13 } from "./dorm_13.js";
import { HOOKS as DOUBLES_11 } from "./doubles_11.js";
import { HOOKS as ISLAND_OPEN_0F } from "./island_open_0f.js";
import { HOOKS as ISLAND_ROUNDS_0F } from "./island_rounds_0f.js";
import { HOOKS as JUNIOR_DOUBLES_11 } from "./junior_doubles_11.js";
import { HOOKS as JUNIOR_SINGLES_11 } from "./junior_singles_11.js";

export const MODULES = {
  academy_13: ACADEMY_13, academy_main_10: ACADEMY_MAIN_10, academy_wing_10: ACADEMY_WING_10, actor_0f: ACTOR_0F,
  actor_27: ACTOR_27, awards_0f: AWARDS_0F, center_11: CENTER_11, court_practice_11: COURT_PRACTICE_11,
  dorm_13: DORM_13, doubles_11: DOUBLES_11, island_open_0f: ISLAND_OPEN_0F, island_rounds_0f: ISLAND_ROUNDS_0F, junior_doubles_11: JUNIOR_DOUBLES_11, junior_singles_11: JUNIOR_SINGLES_11,
};
export const HOOKS = Object.values(MODULES).flat();
