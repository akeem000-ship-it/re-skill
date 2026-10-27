// The map scripts ported so far, by bank (the enter / talk / object / trigger scripts of banks 30-35, and the
// code they call), found by their ROM address "bb:aaaa" (mapengine.js MapRunScript); the frame tasks they register.
import * as B31 from "./bank31.js";
import * as B32 from "./bank32.js";
import * as B34 from "./bank34.js";

const BANKS = [B31, B32, B34];
export const MAP_SCRIPTS = Object.assign({}, ...BANKS.map(b => b.SCRIPTS));
export const mapTasks = w => Object.assign({}, ...BANKS.map(b => b.TASKS(w)));
