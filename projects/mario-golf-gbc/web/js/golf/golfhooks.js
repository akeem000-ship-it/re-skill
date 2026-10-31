// The golf event hooks (bank 10): a map script that starts a round of its own (a practice, a lesson, a contest) gives
// it a table of handlers (SetGolfEventHook 10:4BC7: wGolfEventBank $C870, the table $C871) that the round calls at
// its events (CallGolfEventHook 10:4CC3): 0 a shot's set-up (10:484C), 1 after a shot (10:4611), 2 a view loaded
// (13:43F6), 3 a hole's start (10:45CD), 4 the course view's start (10:4237). The handlers are ported with the map
// scripts (maps/: HOOKS, by their ROM address).
import * as D from "./render/display.js";
import { rb } from "./rom.js";
import { golfHooks } from "./maps/index.js";

function notPorted(what) { throw new Error(`${what} is not ported`); }
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}
// 10:4CC3 CallGolfEventHook: entry a of the table in bank wGolfEventBank (00:0184 CallTableEntryInBankA: a zero
// entry does nothing), the WRAM bank kept
export function* callGolfEventHook(sh, a) {
  const w = sh.w, w0 = w.wram[0];
  const bank = w0[0x870];
  if (!bank) return;
  const old = w.high[0x196];
  const t = (w0[0x871] | w0[0x872] << 8) + ((a << 1) & 0xFF) & 0xFFFF;
  const hl = rb(bank, t) | rb(bank, (t + 1) & 0xFFFF) << 8;
  if (hl) {
    const key = `${bank.toString(16).padStart(2, "0")}:${hl.toString(16).padStart(4, "0")}`;
    const f = golfHooks()[key];
    if (typeof process !== "undefined" && process.env && process.env.HOOKS) console.error("HOOK", a, key);
    if (!f) notPorted(`the golf event hook ~${key}`);
    yield* inBankGen(w, bank, f(sh));
  }
  D.setWramBank(w, old);
}
