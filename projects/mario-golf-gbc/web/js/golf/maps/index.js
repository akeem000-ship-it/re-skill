// The map scripts ported so far, by bank (the enter / talk / object / trigger scripts of banks 30-35, and the
// code they call), found by their ROM address "bb:aaaa" (mapengine.js MapRunScript); the frame tasks they register.
import * as B31 from "./bank31.js";
import * as B32 from "./bank32.js";

export const MAP_SCRIPTS = { ...B31.SCRIPTS, ...B32.SCRIPTS };
export const mapTasks = w => ({ ...B31.TASKS(w), ...B32.TASKS(w) });
