// Match setup check: replay a recording to RunMatch (08:4190), rebuild the character records from the menu's
// choices and run the engine's InitMatchScene there; then compare with the game at RunMatchPlayLoop (08:4714)
// entry. The court intro only moves the camera and scroll, so those are not compared.
// usage: node web/tests/engine_setup.mjs FILE.mtrec
import { readRecording, newCore, romObject } from "./engine/corpus.mjs";
import { loadState } from "../js/gb/state.js";
import { stateOf } from "../js/recorder.js";
import { MatchEngine } from "../js/engine/engine.js";
import { fieldAt } from "../js/engine/memory.js";
import * as setup from "../js/engine/setup.js";

const rec = readRecording(process.argv[2]);
const gb = await newCore({ recomp: false }); loadState(gb, rec.start);
const inputs = Buffer.from(rec.inputs, "base64");
let f = 0; gb.ppu.frameDone = false;
const until = (pc) => { for (;;) { if (gb.cpu.pc === pc && gb.mem.romBank === 8) return; if (gb.ppu.frameDone) { gb.ppu.frameDone = false; f++; gb.setInput(stateOf(inputs[f])); } gb.stepInstruction(); } };
gb.setInput(stateOf(inputs[0]));
until(0x4190);
const atRunMatch = { wram: gb.mem.wram.map(b => b.slice()), hram: gb.mem.hram.slice() };
console.log(`RunMatch at frame ${f}`);
until(0x4714);
console.log(`RunMatchPlayLoop at frame ${f}`);
// 1. the records: rebuild from the ids and difficulty the menu left
const E = new MatchEngine(romObject());
const w0 = atRunMatch.wram[0], ids = [0, 2].map(s => w0[0xA0B + s * 0x40]);
E.mem.w0.set(w0); for (let b = 1; b < 8; b++) E.mem.wx[b].set(atRunMatch.wram[b]); E.mem.hram.set(atRunMatch.hram);
const diff = w0[0xA9F];
console.log({ ids, cpuDifficulty: diff, court: w0[0x8F4], sets: w0[0x8F0], games: w0[0x8F1] });
// roster record ids: the menus pass the roster index; +$0B holds the remapped id, which equals it below $20
for (const s of [0, 2]) setup.initRosterRecord(E, s, ids[s / 2]);
setup.applyCpuDifficulty(E, 2, diff + 1);
let bad = 0;
for (let a = 0xCA00; a < 0xCB00; a++) { if ((a & 0x3F) < 0x0B) continue; const g = w0[a - 0xC000], e = E.mem.w0[a - 0xC000]; if (g !== e) { bad++; if (bad < 12) console.log(`record $${a.toString(16)} game=$${g.toString(16)} engine=$${e.toString(16)}`); } }
console.log(`records: ${bad} differing bytes (names excluded)`);
// 2. the scene: engine from the RunMatch state
E.mem.w0.set(w0); for (let b = 1; b < 8; b++) E.mem.wx[b].set(atRunMatch.wram[b]); E.mem.hram.set(atRunMatch.hram); E.mem.bank = 4;
setup.initMatchScene(E, { vblankCounter: gb.mem.wram[0][0x8DF], viewOption: gb.mem.wram[0][0x4DD] });
E.S.matchSimFrozen = 0;
const ranges = [[0, 0xC400, 0xC440], [0, 0xC448, 0xC478], [0, 0xC480, 0xC4E0], [0, 0xC8C0, 0xC900], ...[4, 5, 6, 7].flatMap(b => [[b, 0xDF00, 0xDF80], [b, 0xDF90, 0xDF97]])];
let n = 0;
for (const [b, lo, hi] of ranges) for (let a = lo; a < hi; a++) {
  const g = b === 0 ? gb.mem.wram[0][a - 0xC000] : gb.mem.wram[b][a - 0xD000], e = b === 0 ? E.mem.w0[a - 0xC000] : E.mem.wx[b][a - 0xD000];
  if (g !== e) { n++; if (n < 25) console.log(`${fieldAt(a, b)}${b ? "@" + b : ""} game=$${g.toString(16)} engine=$${e.toString(16)}`); }
}
console.log(`scene: ${n} differing bytes`);
