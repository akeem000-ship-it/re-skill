// Whole-match lockstep: replay a recording on the core's interpreter until the ROM enters RunMatchPlayLoop
// (08:4714), copy its RAM into the engine there, then run the engine's runMatchPlayLoop coroutine beside the
// game, frame by frame with the recorded pad bytes, comparing the gameplay RAM at every frame boundary.
// usage: node web/tests/engine_lockstep.mjs FILE.mtrec [--frames N] [--resync] [--show K] [--entry playPoint]
//   --resync  reload the engine's RAM from the game after every frame (each frame then tests one frame's code
//             while the coroutine keeps its place); without it the engine runs free from the entry point
import { readRecording, newCore, romObject } from "./engine/corpus.mjs";
import { loadState } from "../js/gb/state.js";
import { stateOf } from "../js/recorder.js";
import { MatchEngine } from "../js/engine/engine.js";
import { fieldAt } from "../js/engine/memory.js";
import * as flow from "../js/engine/flow.js";

const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const rec = readRecording(a[0]), maxFrames = +opt("--frames", 1e9), resync = a.includes("--resync"), show = +opt("--show", 6);
const ENTRY = { runMatchPlayLoop: [0x4714, flow.runMatchPlayLoop], playPoint: [0x4D0F, flow.playPoint] }[opt("--entry", "runMatchPlayLoop")];
const gb = await newCore({ recomp: false }), E = new MatchEngine(romObject());
loadState(gb, rec.start);
const inputs = Buffer.from(rec.inputs, "base64"), events = new Map(rec.events.map(([f, e]) => [f, e]));
let f = 0;
const setInput = () => { if (events.get(f) === "reset") gb.reset(); gb.setInput(stateOf(inputs[f])); };
// run the current frame to its end, or until stop() (then the frame is still open); the same frame rule as
// GBC.runFrame (VBlank start; with the LCD off, 70224 dots count as a frame)
let lcdOffDots = 0;
function stepUntil(stop) {
  const ppu = gb.ppu;
  for (;;) {
    if (!(ppu.lcdc & 0x80)) {
      while (lcdOffDots < 70224 && !(ppu.lcdc & 0x80)) { if (stop()) return "hit"; const c0 = gb.cycles; gb.stepInstruction(); const c = gb.cycles - c0; lcdOffDots += gb.mem.doubleSpeed ? c >> 1 : c; }
      if (!(ppu.lcdc & 0x80)) { lcdOffDots = 0; ppu.frameDone = false; gb.frames++; f++; return "frame"; }
      lcdOffDots = 0; continue;
    }
    if (ppu.frameDone) { ppu.frameDone = false; lcdOffDots = 0; gb.frames++; f++; return "frame"; }
    if (stop()) return "hit";
    gb.stepInstruction();
  }
}
// ---- find the entry ----
gb.ppu.frameDone = false; setInput();
const atEntry = () => gb.cpu.pc === ENTRY[0] && gb.mem.romBank === 8;
while (f < rec.frames) { if (stepUntil(atEntry) === "hit") break; setInput(); }
if (f >= rec.frames) { console.log("entry not reached"); process.exit(1); }
console.log(`entry ${opt("--entry", "runMatchPlayLoop")} at frame ${f}`);
E.mem.loadFromCore(gb); E.mem.bank = gb.mem.svbk;

// UI loops the engine does not draw: follow the game (pause menu, message windows)
E.pauseMenu = function* () { while (gb.mem.wram[0][0x4C0]) yield "frame"; };
E.messageWindow = function* () { yield "frame"; };

// ---- compare ----
const GROUPS = {
  ball: [[0, 0xC400, 0xC430]],
  match: [[0, 0xC430, 0xC500]],
  score: [[0, 0xC8C0, 0xC900]],
  chars: [4, 5, 6, 7].flatMap(b => [[b, 0xDF00, 0xDF80], [b, 0xDF90, 0xDF97]]),   // $DF80-$DF8F: sprite slots (drawing)
  hram: [[-1, 0xFF8A, 0xFF8C], [-1, 0xFFE9, 0xFFEA]],
};
const SKIP = new Set([0xC494, 0xC495, 0xC496, 0xC497, 0xC498, 0xC499, 0xC49A, 0xC49B, 0xC49C, 0xC49D, 0xC49E, 0xC49F]);   // scoreboard layout scratch
const first = {}, count = {}, fieldHits = {};
let compared = 0;
function compare(tag) {
  compared++;
  for (const [g, ranges] of Object.entries(GROUPS)) {
    const diffs = [];
    for (const [b, lo, hi] of ranges) for (let ad = lo; ad < hi; ad++) {
      if (SKIP.has(ad)) continue;
      const core = b === -1 ? gb.mem.hram[ad - 0xFF80] : b === 0 ? gb.mem.wram[0][ad - 0xC000] : gb.mem.wram[b][ad - 0xD000];
      const eng = b === -1 ? E.mem.hram[ad - 0xFF80] : b === 0 ? E.mem.w0[ad - 0xC000] : E.mem.wx[b][ad - 0xD000];
      if (core !== eng) diffs.push([b, ad, core, eng]);
    }
    if (!diffs.length) continue;
    count[g] = (count[g] || 0) + 1;
    for (const d of diffs) { const k = fieldAt(d[1], d[0]); fieldHits[g] ??= {}; fieldHits[g][k] = (fieldHits[g][k] || 0) + 1; }
    (first[g] ??= []).length < show && first[g].push(`frame ${tag}: ` + diffs.slice(0, 6).map(d => `${fieldAt(d[1], d[0])} game=$${d[2].toString(16)} engine=$${d[3].toString(16)}`).join(", ") + (diffs.length > 6 ? ` (+${diffs.length - 6})` : ""));
  }
}
// ---- run ----
const G = ENTRY[1](E);
let r = G.next();                                                        // up to the first frame wait
stepUntil(() => false);                                                  // the game finishes that frame
compare(f);
// a lag frame: no simulation frame completed (hMatchFrameCounter did not move: setup code or a long frame ran
// past VBlank), so the engine waits; the simulation frame that follows reads the pad bytes of its own frame
let lags = 0, wait = false;
for (let n = 0; n < maxFrames && !r.done && f < rec.frames; n++) {
  if (resync && !wait) { E.mem.loadFromCore(gb); E.mem.bank = gb.mem.hram[0x16] & 7 || 1; }
  const before = gb.mem.hram[0x69];
  setInput(); gb.runFrame(); f++;
  const pad = gb.mem.hram.slice(0x10, 0x15);
  if (gb.mem.hram[0x69] === before && !gb.mem.wram[0][0x4C0]) { lags++; wait = true; continue; }
  E.mem.hram.set(pad, 0x10); wait = false;                // hPlayerInputFlags..hInputRisingEdge
  E.events.length = 0;
  try { r = G.next(); } catch (e) { console.log(`engine stopped at frame ${f}: ${e.message}`); break; }
  compare(f);
}
console.log(JSON.stringify({ mode: resync ? "resync" : "free", framesCompared: compared, lagFrames: lags, lastFrame: f, done: !!r.done, framesWithDiffs: count }));
for (const [g, l] of Object.entries(first)) {
  console.log(`-- ${g}: top fields ` + Object.entries(fieldHits[g]).sort((x, y) => y[1] - x[1]).slice(0, 10).map(([k, v]) => `${k}×${v}`).join(" "));
  for (const x of l) console.log("   " + x);
}
