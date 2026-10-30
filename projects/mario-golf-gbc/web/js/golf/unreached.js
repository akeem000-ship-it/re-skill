// Code no play reaches: unreferenced copies, dead branches and debug-only routines, ported so that the rewrite holds
// the whole traced code; each is checked against the ROM with random RAM and registers (web/tests/golf_fuzz_routines.mjs:
// the same RAM and registers in, the same registers, WRAM and HRAM out), not by a screen. REVERSE.md "Unreached code"
// lists them with how each is (not) reached.
import * as M from "./math.js";

// 40:5AA9 MulHLByDE_40 (unreferenced; the same code as 00:0CB5 MulHLByDE, its jumps relative): the high 16 bits of hl x de;
// the whole 32-bit product left in HRAM $FFA8-$FFAB (low byte first)
export function mulHLByDE40(w, hl, de) {
  const p = BigInt(hl) * BigInt(de);
  for (let k = 0; k < 4; k++) w.high[0x1A8 + k] = Number((p >> BigInt(8 * k)) & 0xFFn);
  return M.mulHLByDE(hl, de);
}
// 40:599C DivAHLByDE_40 (unreferenced; the same code as 00:0DDB DivAHLByDE): a:hl / de; HRAM $FFAC = a, and with de
// nonzero $FFAE / $FFAD = the first / second phase's quotient bytes; returns {a, h, l}
export function divAHLByDE40(w, a, hl, de) {
  w.high[0x1AC] = a;
  const [qa, q] = M.divAHLByDE(a, hl, de);
  if (de) { w.high[0x1AE] = qa; w.high[0x1AD] = q >> 8; }
  return { a: qa, h: q >> 8, l: q & 0xFF };
}

// more cases for the fuzz test: functions of rnd returning a case
export const FUZZ = [];
