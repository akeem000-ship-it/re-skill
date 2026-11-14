// Record every executed (bank, pc) on the interpreter while playing a key script, and merge the
// addresses into a coverage file the translator uses as seeds (tools/recomp.py --coverage FILE).
// usage: node web/tests/record_coverage.mjs OUT.json [--frames N] [--keys F:button,...] [--auto]
//   --auto: press A every 45 frames after frame 600 and Start at 332/632 (walks the menus into a match)
import fs from "fs";
import { fileURLToPath } from "url";
import { GBC } from "../js/gb/gbc.js";
const here = p => fileURLToPath(new URL(p, import.meta.url));
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const out = a[0] || "states/coverage.json", N = +opt("--frames", 6000);
const keys = {}; for (const k of opt("--keys", "").split(",")) if (k) { const [f, b] = k.split(":"); keys[+f] = b; }
if (a.includes("--auto")) { keys[332] = "start"; keys[632] = "start"; for (let f = 700; f < N; f += 45) keys[f] = (f / 45 | 0) % 7 === 3 ? "start" : "a"; }
const rom = new Uint8Array(fs.readFileSync(here("../../rom/mario_tennis.gbc")));
const gb = new GBC(rom, { audio: false });
const cov = new Map();                                   // bank -> Set of pc
const cpu = gb.cpu, mem = gb.mem, origStep = cpu.step.bind(cpu);
cpu.step = () => { const pc = cpu.pc; if (!cpu.halted) { const bank = pc < 0x4000 ? 0 : pc < 0x8000 ? mem.romBank : -1; if (bank >= 0) { let s = cov.get(bank); if (!s) cov.set(bank, s = new Set()); s.add(pc); } } return origStep(); };
for (let f = 0; f < N; f++) { const st = {}; for (const [kf, b] of Object.entries(keys)) if (f >= +kf && f < +kf + 6) st[b] = true; gb.setInput(st); gb.runFrame(); }
let prev = {}; try { prev = JSON.parse(fs.readFileSync(out)); } catch (e) {}
let added = 0;
for (const [bank, s] of cov) { const old = new Set(prev[bank] || []); for (const pc of s) if (!old.has(pc)) { old.add(pc); added++; } prev[bank] = [...old].sort((x, y) => x - y); }
fs.writeFileSync(out, JSON.stringify(prev));
console.log(`${N} frames, ${[...cov.values()].reduce((s, x) => s + x.size, 0)} distinct addresses executed, ${added} new in ${out}; final PC ${cpu.pc.toString(16)} bank ${mem.romBank}`);
