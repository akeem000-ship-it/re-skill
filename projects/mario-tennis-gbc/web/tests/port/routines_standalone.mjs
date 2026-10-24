// Routine tests for web/js/port/standalone (run by web/tests/port_routines.mjs, filter "Standalone "): the
// routines of the standalone step that do not wait, against the ROM, every register compared. The hooks are
// installed on the port from the modules themselves (program.js may not list them yet).
// usage: node web/tests/port_routines.mjs "Standalone " --rec out/engine/rec2.mtrec,out/port/story1.mtrec --every 97
import { HOOKS as FETCH_TEXT, TEXT_BANKS } from "../../js/port/standalone/fetch_text.js";
import { hookKey } from "../../js/port/port.js";

const H = (s, k) => { let h = Math.imul(s.f + 1, 0x9E3779B1) ^ Math.imul(k + 1, 0x85EBCA77); h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12; return h >>> 0; };
const ALL = ["a", "f", "b", "c", "d", "e", "h", "l"];
const MINE = new Map([...FETCH_TEXT].map(([b, a, fn]) => [hookKey(b, a), fn]));
const install = P => { for (const [k, fn] of MINE) P.hooks.set(k, fn); };
export const ROUTINES = [];
function E(name, bank, addr, { regs, prep, wram } = {}) {
  ROUTINES.push({
    name: `Standalone ${name}`, bank, addr, wram, out: ALL, regs, prep,
    js: (P, r) => { install(P); P.cpu.halted = false; P.ime = false; return P.callRom(bank, addr, r); },
  });
}

// ---- fetch_text: a string index (mostly in range, sometimes anything), a = 0 / 1 / other, the debug step mode
// on now and then (the alarm on a cut string) ----
const textRegs = k => s => {
  const r = H(s, k), idx = r % 4 === 0 ? (r >>> 8) & 0x3FF : (r >>> 8) % 0x230;   // (a text id has 10 index bits)
  return { a: [0, 0, 1, 1, 2, 0xFF][(r >>> 4) % 6], d: idx >> 8, e: idx & 0xFF, b: H(s, k + 1) & 0xFF, c: H(s, k + 2) & 0xFF, h: H(s, k + 3) & 0xFF, l: H(s, k + 4) & 0xFF, f: H(s, k + 5) & 0xF0 };
};
const textPrep = k => (m, s) => { m.iflag = 0; m.ie = 0; m.hram[0x1E] = H(s, k + 9) % 5 === 0 ? 1 + (H(s, k + 10) & 0x7F) : 0; };
TEXT_BANKS.forEach(([bank, dialogue, short, fetch], i) => {
  const b = bank.toString(16);
  E(`FetchDialogueText_${b}`, bank, dialogue, { regs: textRegs(100 + i * 20), prep: textPrep(100 + i * 20), wram: 5 });
  E(`FetchShortText_${b}`, bank, short, { regs: textRegs(105 + i * 20), prep: textPrep(105 + i * 20), wram: 5 });
  E(`FetchText_${b}`, bank, fetch, { regs: textRegs(110 + i * 20), prep: textPrep(110 + i * 20), wram: 5 });
});
