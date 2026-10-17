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
import { HOOKS as CHALLENGE_SCENES_15 } from "./challenge_scenes_15.js";
import { HOOKS as CHALLENGER_15 } from "./challenger_15.js";
import { HOOKS as COACH_LESSONS_15 } from "./coach_lessons_15.js";
import { HOOKS as COACH_WALKS_15 } from "./coach_walks_15.js";
import { HOOKS as COURT_MACHINE_14 } from "./court_machine_14.js";
import { HOOKS as COURT_PRACTICE_11 } from "./court_practice_11.js";
import { HOOKS as COURT_SKY_14 } from "./court_sky_14.js";
import { HOOKS as DEVMAP_10 } from "./devmap_10.js";
import { HOOKS as DORM_13 } from "./dorm_13.js";
import { HOOKS as DOUBLES_11 } from "./doubles_11.js";
import { HOOKS as ENDING_FINALS_27 } from "./ending_finals_27.js";
import { HOOKS as ENDING_JRCOURT_27 } from "./ending_jrcourt_27.js";
import { HOOKS as ENDING_OFFICE_27 } from "./ending_office_27.js";
import { HOOKS as ENDING_VARSITY_27 } from "./ending_varsity_27.js";
import { HOOKS as EXHIBITION_0E } from "./exhibition_0e.js";
import { HOOKS as FIREWORK_14 } from "./firework_14.js";
import { HOOKS as GYM_ACTORS_0E } from "./gym_actors_0e.js";
import { HOOKS as ISLAND_14 } from "./island_14.js";
import { HOOKS as ISLAND_OPEN_0F } from "./island_open_0f.js";
import { HOOKS as ISLAND_ROUNDS_0F } from "./island_rounds_0f.js";
import { HOOKS as JUNIOR_DOUBLES_11 } from "./junior_doubles_11.js";
import { HOOKS as JUNIOR_SINGLES_11 } from "./junior_singles_11.js";

export const MODULES = {
  academy_13: ACADEMY_13, academy_main_10: ACADEMY_MAIN_10, academy_wing_10: ACADEMY_WING_10, actor_0f: ACTOR_0F,
  actor_27: ACTOR_27, awards_0f: AWARDS_0F, center_11: CENTER_11, challenge_scenes_15: CHALLENGE_SCENES_15,
  challenger_15: CHALLENGER_15, coach_lessons_15: COACH_LESSONS_15, coach_walks_15: COACH_WALKS_15,
  court_machine_14: COURT_MACHINE_14, court_practice_11: COURT_PRACTICE_11, court_sky_14: COURT_SKY_14,
  devmap_10: DEVMAP_10, dorm_13: DORM_13, doubles_11: DOUBLES_11, ending_finals_27: ENDING_FINALS_27,
  ending_jrcourt_27: ENDING_JRCOURT_27, ending_office_27: ENDING_OFFICE_27, ending_varsity_27: ENDING_VARSITY_27,
  exhibition_0e: EXHIBITION_0E, firework_14: FIREWORK_14, gym_actors_0e: GYM_ACTORS_0E, island_14: ISLAND_14,
  island_open_0f: ISLAND_OPEN_0F, island_rounds_0f: ISLAND_ROUNDS_0F, junior_doubles_11: JUNIOR_DOUBLES_11,
  junior_singles_11: JUNIOR_SINGLES_11,
};
// part 2 (src/story/lessonmenu_10 .. water_15): its modules, added to MODULES
import { HOOKS as WALKS_10 } from "./walks_10.js";
Object.assign(MODULES, {
  walks_10: WALKS_10,
});
export const HOOKS = Object.values(MODULES).flat();
