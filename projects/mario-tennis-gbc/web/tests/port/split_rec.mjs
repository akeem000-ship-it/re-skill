// Cut a recording into overlapping pieces, each starting from the state the original reaches at its first frame
// (played on the core), with the original's pad from there. The lockstep stops at the first timing event that
// changes the game's course (web/tests/port_lockstep.mjs); pieces let the rest of a long recording be compared too.
// usage: node web/tests/port/split_rec.mjs IN.mtrec OUTPREFIX --every N --length M
//   writes OUTPREFIX_<start>.mtrec for start = N, 2N, ... (the first piece, from 0, is the original itself)
import fs from "fs"; import zlib from "zlib";
import { readRecording, newCore } from "../engine/corpus.mjs";
import { saveState, loadState } from "../../js/gb/state.js";
import { stateOf } from "../../js/recorder.js";

const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const [inPath, prefix] = a, every = +opt("--every", 2000), length = +opt("--length", 2500);
const rec = readRecording(inPath), pads = Buffer.from(rec.inputs, "base64");
const gb = await newCore({ recomp: true });
loadState(gb, rec.start);
for (let f = 0, next = every; next < rec.frames; f++) {
  if (f === next) {
    const n = Math.min(length, rec.frames - f);
    const piece = { ...rec, startedAt: new Date().toISOString(), frames: n, start: saveState(gb),
      inputs: Buffer.from(pads.subarray(f, f + n)).toString("base64"), hashes: [], events: [], meta: { ...(rec.meta || {}), from: `${inPath}@${f}` } };
    fs.writeFileSync(`${prefix}_${f}.mtrec`, zlib.gzipSync(JSON.stringify(piece)));
    console.log(`${prefix}_${f}.mtrec: frames ${f}-${f + n}`);
    next += every;
  }
  gb.setInput(stateOf(pads[f])); gb.runFrame();
}
