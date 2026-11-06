// Make a .mtrec recording on the core from power-on with a scripted pad: the exhibition menus into a match
// (the key script web/tests/play_match.mjs uses), then a simple pattern for the match itself.
// usage: node web/tests/engine/make_rec.mjs OUT.mtrec [--frames N] [--pattern idle|tap|rally]
import fs from "fs"; import zlib from "zlib";
import { newCore } from "./corpus.mjs";
import { saveState } from "../../js/gb/state.js";
import { CORE_TAG } from "../../js/recorder.js";
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const frames = +opt("--frames", 12000), pattern = opt("--pattern", "rally");
const A = 1, LEFT = 32, RIGHT = 16, UP = 64, DOWN = 128, START = 8;
const menu = { 332: START, 632: START, 1300: LEFT, 1360: A };            // title -> exhibition -> singles -> character -> court
for (let k = 700; k < 1300; k += 60) menu[k] = A;
for (let k = 1420; k < 1600; k += 60) menu[k] = A;
const mask = f => {
  for (let k = 0; k < 6; k++) if (menu[f - k]) return menu[f - k];        // a press lasts 6 frames
  if (f < 1700) return 0;
  const t = f - 1700;
  if (pattern === "idle") return 0;
  if (pattern === "tap") return t % 40 < 4 ? A : 0;
  // rally: wander left/right/up/down in 90-frame legs, tap A or B (and sometimes both in sequence)
  const leg = [LEFT, RIGHT, UP | LEFT, DOWN | RIGHT, 0, RIGHT, LEFT | DOWN, UP][Math.floor(t / 90) % 8];
  const btn = t % 37 < 3 ? A : t % 53 < 3 ? 2 : (t % 97 > 40 && t % 97 < 43) ? A | 2 : 0;
  return leg | btn;
};
const gb = await newCore({ recomp: true });
const start = saveState(gb), inputs = new Uint8Array(frames);
for (let f = 0; f < frames; f++) { inputs[f] = mask(f); const m = inputs[f]; gb.setInput({ a: !!(m & 1), b: !!(m & 2), select: !!(m & 4), start: !!(m & 8), right: !!(m & 16), left: !!(m & 32), up: !!(m & 64), down: !!(m & 128) }); gb.runFrame(); }
const rec = { format: "mtrec", v: 1, core: CORE_TAG, startedAt: new Date().toISOString(), frames, start, inputs: Buffer.from(inputs).toString("base64"), hashes: [], events: [], meta: { scripted: pattern } };
fs.writeFileSync(a[0], zlib.gzipSync(JSON.stringify(rec)));
const w = gb.mem.wram[0];
console.log(JSON.stringify({ frames, map: w[0x32E], p1: w[0xA0B], p2: w[0xA8B], court: w[0x8F4], score: [w[0x8E2], w[0x8E3], w[0x8E4], w[0x8E5]] }));
