// Lockstep: the recompiled executor against the interpreter, same inputs, compared every frame
// (frame hash, registers, WRAM/HRAM/OAM hash). usage: node web/tests/recomp_vs_interp.mjs [--frames N] [--keys F:button,...]
import fs from "fs";
import { fileURLToPath } from "url";
import { GBC } from "../js/gb/gbc.js";
import { install, HRAM_SIG } from "../gen/game.js";
const here = p => fileURLToPath(new URL(p, import.meta.url));
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const N = +opt("--frames", 600);
const keys = {}; for (const k of opt("--keys", "").split(",")) if (k) { const [f, b] = k.split(":"); keys[+f] = b; }
const rom = new Uint8Array(fs.readFileSync(here("../../rom/mario_tennis.gbc")));
const A = new GBC(rom, { audio: false }), B = new GBC(rom, { audio: false });
const T = {}; install(T); B.installRecomp(T); B.exec.setHramSig(HRAM_SIG);
console.log("blocks installed:", Object.keys(T).length);
const fnv = b => { let h = 0x811c9dc5; for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h; };
const state = gb => { const c = gb.cpu, m = gb.mem; let h = fnv(m.hram) ^ fnv(m.oam); for (const w of m.wram) h = (h * 31 + fnv(w)) >>> 0; return `${c.a},${c.f},${c.bc},${c.de},${c.hl},${c.sp},${c.pc},${c.ime?1:0} ram=${h.toString(16)} bank=${m.romBank}`; };
const t0 = Date.now(); let tA = 0, tB = 0;
for (let f = 0; f < N; f++) {
  const st = {}; for (const [kf, b] of Object.entries(keys)) if (f >= +kf && f < +kf + 6) st[b] = true;
  let t = Date.now(); A.setInput(st); A.runFrame(); tA += Date.now() - t;
  t = Date.now(); B.setInput(st); B.runFrame(); tB += Date.now() - t;
  const ha = A.frameHash(), hb = B.frameHash(), sa = state(A), sb = state(B);
  if (ha !== hb || sa !== sb) { console.log(`DIVERGE at frame ${f}: frame ${ha} vs ${hb}\n  interp ${sa}\n  recomp ${sb}`); process.exit(1); }
}
console.log(`${N} frames identical. interp ${tA} ms, recomp ${tB} ms; blocks run ${B.exec.blocks}, interpreted fallbacks ${B.exec.interp} (${(100 * B.exec.interp / (B.exec.blocks + B.exec.interp)).toFixed(2)}%), of which with the LCD on ${B.exec.interpOn}`);
