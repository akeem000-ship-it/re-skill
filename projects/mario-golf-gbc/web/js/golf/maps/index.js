// The map scripts ported so far, by bank (the enter / talk / object / trigger scripts of banks 30-35, and the
// code they call), found by their ROM address "bb:aaaa" (mapengine.js MapRunScript); the frame tasks they register;
// the golf event hooks of the rounds they start (golfhooks.js).
import * as B30 from "./bank30.js";
import * as B31 from "./bank31.js";
import * as B32 from "./bank32.js";
import * as B33 from "./bank33.js";
import * as B34 from "./bank34.js";
import * as B35 from "./bank35.js";

const BANKS = [B30, B31, B32, B33, B34, B35];
export const MAP_SCRIPTS = Object.assign({}, ...BANKS.map(b => b.SCRIPTS));
export const mapTasks = w => Object.assign({}, ...BANKS.map(b => b.TASKS(w)));
let hooks = null;                               // (built on first use: round.js reaches here through an import cycle)
export const golfHooks = () => hooks || (hooks = Object.assign({}, ...BANKS.map(b => b.HOOKS || {})));
