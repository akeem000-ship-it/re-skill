// The front end's pure routines (web/js/golf/title.js ...) against the ROM's on the emulator core's interpreter:
// random registers in, the returned registers compared.
// usage: node web/tests/golf_title_routines.mjs [N per routine]
import { useRom } from "../js/golf/rom.js";
import { sqrt24 } from "../js/golf/title.js";
import { newCore, romCall, romBytes } from "./golf/romcall.mjs";

useRom(romBytes());
const N = +(process.argv[2] || 2000);
let seed = 0x2468ace1;
const rnd = n => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };

const gb = newCore();
let bad = 0;
const CASES = [
  // 40:5775 Sqrt24: a:h:l -> h:l (and a), bc de kept
  { name: "Sqrt24", bank: 0x40, addr: 0x5775, regs: () => {
      const k = rnd(4), v = k === 0 ? rnd(256) : k === 1 ? rnd(0x10000) : k === 2 ? 0xFFFFFF - rnd(256) : rnd(0x1000000);
      return { a: v >> 16, h: (v >> 8) & 0xFF, l: v & 0xFF, b: rnd(256), c: rnd(256), d: rnd(256), e: rnd(256) };
    },
    js: r => { const [a, hl] = sqrt24(r.a, r.h << 8 | r.l); return { a, h: hl >> 8, l: hl & 0xFF, b: r.b, c: r.c, d: r.d, e: r.e }; } },
];
for (const c of CASES) {
  let ok = 0, first = null;
  for (let i = 0; i < N; i++) {
    const regs = c.regs();
    const got = romCall(gb, c.bank, c.addr, regs);
    const want = c.js(regs);
    const diff = Object.keys(want).filter(k => want[k] !== got[k]);
    if (!diff.length) ok++;
    else if (!first) first = `in ${JSON.stringify(regs)}: ${diff.map(k => `${k} rom ${got[k].toString(16)} js ${want[k].toString(16)}`).join(", ")}`;
  }
  if (ok !== N) bad++;
  console.log(`${ok === N ? "ok  " : "FAIL"} ${c.name}: ${ok}/${N}${first ? `; first: ${first}` : ""}`);
}
process.exit(bad ? 1 : 0);
