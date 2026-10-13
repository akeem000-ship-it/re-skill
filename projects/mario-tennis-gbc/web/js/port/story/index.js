// story: the ported routines, by module. Each module exports HOOKS = [[bank, addr, fn(P, cpu)], ...]:
// ROM code reaching bank:addr runs fn instead (web/js/port/port.js). Add each module here.
// The story-mode engine of banks 2, 4 and $0A (third_party/mario-tennis-gbc-disasm/src/engine/story/, MIT).
import { HOOKS as ACTOR_SLOTS } from "./actor_slots.js";
import { HOOKS as ACTOR_OPS } from "./actor_ops.js";
import { HOOKS as ACTOR_OBJDEFS } from "./actor_objdefs.js";
import { HOOKS as SCRIPTED } from "./scripted.js";
import { HOOKS as PLAYER } from "./player.js";
import { HOOKS as ACTOR_QUERIES } from "./actor_queries.js";
import { HOOKS as SCRIPT } from "./script.js";
import { HOOKS as ACTOR_MOVES } from "./actor_moves.js";
import { HOOKS as ACTOR_WAITS } from "./actor_waits.js";
import { HOOKS as MATCH } from "./match.js";
import { HOOKS as STORY_LOOP } from "./story_loop.js";
import { HOOKS as STORY_INTERACT } from "./story_interact.js";
import { HOOKS as SCENE_TRIGGERS } from "./scene_triggers.js";
import { HOOKS as SCENE_COLLISION } from "./scene_collision.js";
import { HOOKS as SCENE_VIEWER } from "./scene_viewer.js";
import { HOOKS as SCENE_TILEANIM } from "./scene_tileanim.js";
import { HOOKS as MINIGAME } from "./minigame.js";
import { HOOKS as CREDITS } from "./credits.js";
import { HOOKS as STORY02 } from "./story02.js";
import { HOOKS as STAT } from "./stat.js";
import { HOOKS as EQUIP } from "./equip.js";
import { HOOKS as RECORDS } from "./records.js";
import { HOOKS as DEBUG } from "./debug.js";

export const MODULES = {
  actor_slots: ACTOR_SLOTS, actor_ops: ACTOR_OPS, actor_objdefs: ACTOR_OBJDEFS, scripted: SCRIPTED, player: PLAYER,
  actor_queries: ACTOR_QUERIES, script: SCRIPT, actor_moves: ACTOR_MOVES, actor_waits: ACTOR_WAITS, match: MATCH,
  story_loop: STORY_LOOP, story_interact: STORY_INTERACT, scene_triggers: SCENE_TRIGGERS,
  scene_collision: SCENE_COLLISION, scene_viewer: SCENE_VIEWER, scene_tileanim: SCENE_TILEANIM, minigame: MINIGAME,
  credits: CREDITS, story02: STORY02, stat: STAT, equip: EQUIP, records: RECORDS, debug: DEBUG,
};
export const HOOKS = Object.values(MODULES).flat();
