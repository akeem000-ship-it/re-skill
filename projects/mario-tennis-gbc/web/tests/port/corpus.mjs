// Whole-machine states from recordings for the port's routine tests: replay on the core (recompiled), keep a
// copy at every K-th frame where the game waits in AdvanceFrame (00:2631, the halt at $2700), cached on disk.
import fs from "fs"; import zlib from "zlib"; import v8 from "v8";
import { readRecording, newCore } from "../engine/corpus.mjs";
import { loadState } from "../../js/gb/state.js";
import { stateOf } from "../../js/recorder.js";
import { cloneMachine } from "./machine.mjs";
export const atFrameWait = gb => gb.cpu.halted && gb.cpu.pc >= 0x2700 && gb.cpu.pc < 0x2712;
export async function portCorpus(recPaths, every = 23, max = 1e9) {
  const states = [];
  for (const p of recPaths) {
    const cache = `out/port/corpus_${p.replace(/.*\//, "").replace(/\W/g, "_")}_${every}.bin`;
    if (fs.existsSync(cache)) { for (const s of v8.deserialize(zlib.gunzipSync(fs.readFileSync(cache)))) if (states.length < max) states.push(s); continue; }
    const rec = readRecording(p), gb = await newCore(), inputs = Buffer.from(rec.inputs, "base64"), mine = [];
    loadState(gb, rec.start);
    let quiet = 0;
    for (let f = 0; f < rec.frames; f++) {
      gb.setInput(stateOf(inputs[f])); gb.runFrame();
      if (atFrameWait(gb) && (quiet++ % every === 0)) mine.push({ rec: p.replace(/.*\//, ""), f: f + 1, map: gb.mem.wram[0][0x32E], m: cloneMachine(gb) });
    }
    fs.mkdirSync("out/port", { recursive: true }); fs.writeFileSync(cache, zlib.gzipSync(v8.serialize(mine)));
    for (const s of mine) if (states.length < max) states.push(s);
  }
  return states;
}
