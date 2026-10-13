// Routine-level check of the match engine: for states taken from recorded play, run a ROM routine on the
// core's interpreter and its engine port on the same RAM, and compare all of WRAM (bank 0 and 1-7, the
// stack page excepted) and HRAM afterwards.
// usage: node web/tests/engine_routines.mjs FILE.mtrec [routine filter] [--every K] [--max N] [--show M] [--ignore b:from:to,...]
// A routine entry (web/tests/engine/routines*.mjs): { name, bank, addr, wram (bank to map; default the state's),
// regs(state) -> input registers {a,b,c,d,e,h,l}, prep(coreMem, state) to force a branch on both sides,
// when(state) to select states, js(E, regs) the port, out(jsReturn) -> registers to compare }.
import fs from "fs";
import { readRecording, replay, simFrame, newCore, romObject } from "./engine/corpus.mjs";
import { romCall } from "./engine/romcall.mjs";
import { MatchEngine } from "../js/engine/engine.js";
import { fieldAt } from "../js/engine/memory.js";
// every web/tests/engine/routines*.mjs contributes a ROUTINES list (one file per engine module)
const ROUTINES = [];
for (const f of fs.readdirSync(new URL("./engine/", import.meta.url)).filter(f => /^routines.*\.mjs$/.test(f)).sort())
  ROUTINES.push(...(await import(`./engine/${f}`)).ROUTINES);

const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const vals = new Set(["--every", "--max", "--show"]), pos = a.filter((x, i) => !x.startsWith("--") && !vals.has(a[i - 1]));
const rec = readRecording(pos[0]), filter = pos[1] || "", every = +opt("--every", 7), max = +opt("--max", 1e9), show = +opt("--show", 3);
// not kept by the engine: the stack page; the sound driver (rst $08 requests: E.sfx); drawing state — shadow
// OAM and the VRAM copy queue, the ball history ring, HUD object slots and fixed sprite slots in bank 4
const IGNORE = [[0, 0xCF00, 0xD000], [7, 0xD000, 0xD400], [-2, 0xFFCD, 0xFFCF], [0, 0xC000, 0xC0F0], [4, 0xDD00, 0xDF00]];
for (const extra of (opt("--ignore", "") || "").split(",").filter(Boolean)) { const [b, f, t] = extra.split(":").map(x => parseInt(x, 16)); IGNORE.push([b, f, t]); }

// corpus: RAM before every K-th simulated frame, cached in out/engine/ (WRAM banks 0-7 + HRAM per state)
const snaps = [], SZ = 8 * 0x1000 + 0x7F;
const cache = `out/engine/corpus_${pos[0].replace(/.*\//, "").replace(/\W/g, "_")}_${every}.bin`;
if (fs.existsSync(cache)) {
  const buf = fs.readFileSync(cache);
  for (let o = 0; o + 4 + SZ <= buf.length && snaps.length < max; o += 4 + SZ) {
    const f = buf.readUInt32LE(o), wram = [];
    for (let b = 0; b < 8; b++) wram.push(new Uint8Array(buf.subarray(o + 4 + b * 0x1000, o + 4 + (b + 1) * 0x1000)));
    snaps.push({ f, wram, hram: new Uint8Array(buf.subarray(o + 4 + 0x8000, o + 4 + SZ)) });
  }
} else {
  await replay(rec, {}, (f, gb, before) => { if (simFrame(before, gb) && f % every === 0) snaps.push({ f, wram: before.wram, hram: before.hram }); });
  const out = Buffer.alloc(snaps.length * (4 + SZ));
  snaps.forEach((s, i) => { const o = i * (4 + SZ); out.writeUInt32LE(s.f, o); s.wram.forEach((b, k) => out.set(b, o + 4 + k * 0x1000)); out.set(s.hram, o + 4 + 0x8000); });
  fs.mkdirSync("out/engine", { recursive: true }); fs.writeFileSync(cache, out);
  snaps.length = Math.min(snaps.length, max);
}
console.log(`${snaps.length} states`);

const gb = await newCore({ recomp: false }), rom = romObject(), E = new MatchEngine(rom);
const ignored = (bank, addr) => IGNORE.some(([b, f, t]) => (b === bank || (b === -1)) && addr >= f && addr < t);
function load(s) { const m = gb.mem; s.wram.forEach((b, i) => m.wram[i].set(b)); m.hram.set(s.hram); m.svbk = s.hram[0x16] & 7 || 1; gb.cpu.sp = 0xCFF0; }
for (const R of ROUTINES) {
  if (filter && !R.name.includes(filter)) continue;
  let fails = 0, tested = 0; const shown = [], fieldCount = new Map();
  for (const s of snaps) {
    if (R.when && !R.when(s)) continue;
    tested++;
    load(s);
    const bank = R.wram ?? (s.hram[0x16] & 7 || 4);
    const regs = R.regs ? R.regs(s) : {};
    if (R.prep) { gb.mem.svbk = bank; R.prep(gb.mem, s); }               // force a branch the snapshot does not reach
    E.mem.loadFromCore(gb); E.setBank(bank); E.events.length = 0;   // the engine starts from the same RAM
    const ret = R.js(E, regs);
    const out = romCall(gb, R.bank, R.addr, regs, { wramBank: bank });
    const engH = E.mem.hram;
    const diffs = [];
    for (let b = 0; b < 8; b++) {
      const core = gb.mem.wram[b], eng = b === 0 ? E.mem.w0 : E.mem.wx[b], base = b === 0 ? 0xC000 : 0xD000;
      if (b === 1 || b === 0) { /* compare */ }
      for (let i = 0; i < 0x1000; i++) if (core[i] !== eng[i] && !ignored(b, base + i)) diffs.push([b, base + i, core[i], eng[i]]);
    }
    for (let i = 0; i < 0x7F; i++) if (gb.mem.hram[i] !== engH[i] && !ignored(-2, 0xFF80 + i)) diffs.push([-2, 0xFF80 + i, gb.mem.hram[i], engH[i]]);
    if (R.out) for (const [r, v] of Object.entries(R.out(ret))) if (out[r] !== v) diffs.push(["reg", r, out[r], v]);
    if (diffs.length) {
      fails++;
      for (const d of diffs) { const k = d[0] === "reg" ? "reg " + d[1] : fieldAt(d[1], d[0]); fieldCount.set(k, (fieldCount.get(k) || 0) + 1); }
      if (shown.length < show) shown.push(`  frame ${s.f}: ` + diffs.slice(0, 8).map(d => d[0] === "reg" ? `${d[1]} rom=${d[2]} js=${d[3]}` : `${fieldAt(d[1], d[0])}${d[0] > 1 ? "@" + d[0] : ""} rom=$${d[2].toString(16)} js=$${d[3].toString(16)}`).join(", ") + (diffs.length > 8 ? ` (+${diffs.length - 8})` : ""));
    }
  }
  console.log(`${fails ? "FAIL" : "ok  "} ${R.name.padEnd(30)} ${fails}/${tested}` + (fails ? "  fields: " + [...fieldCount].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => `${k}×${v}`).join(" ") : ""));
  for (const l of shown) console.log(l);
}
