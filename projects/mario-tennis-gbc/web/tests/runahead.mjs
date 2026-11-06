// Run-ahead must never change the game: replay a recording on the JS core twice, plainly and with run-ahead (after every real frame:
// snapshot, one look-ahead frame with the same buttons, restore), and compare the frame hashes every 30 frames.
// usage: node web/tests/runahead.mjs FILE.mtrec [FRAMES]
import fs from "fs"; import zlib from "zlib";
import { GBC } from "../js/gb/gbc.js";
import { loadState, snapshot, restore } from "../js/gb/state.js";
import { stateOf } from "../js/recorder.js";
globalThis.atob ??= s => Buffer.from(s, "base64").toString("binary"); globalThis.btoa ??= s => Buffer.from(s, "binary").toString("base64");
const [file, n = "6000"] = process.argv.slice(2), raw = fs.readFileSync(file), rec = JSON.parse((raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw).toString());
const rom = new Uint8Array(fs.readFileSync("rom/mario_tennis.gbc")), inputs = Uint8Array.from(atob(rec.inputs), c => c.charCodeAt(0)), N = Math.min(+n, rec.frames);
function run(ahead) {
  const gb = new GBC(rom, { audio: true, sampleRate: 44100 }); loadState(gb, rec.start); const out = [];
  for (let f = 0; f < N; f++) {
    gb.setInput(stateOf(inputs[f])); gb.runFrame(); gb.apu.outPos = 0;
    if (ahead) { const s = snapshot(gb); gb.runFrame(); gb.apu.outPos = 0; restore(gb, s); }
    if (f % 30 === 29) out.push(gb.frameHash());
  }
  return out;
}
const t0 = Date.now(), a = run(false), t1 = Date.now(), b = run(true), t2 = Date.now();
const bad = a.findIndex((h, i) => h !== b[i]);
console.log(bad < 0 ? `OK: ${a.length} hashes equal over ${N} frames` : `MISMATCH at frame ${(bad + 1) * 30}`, `(plain ${t1 - t0} ms, run-ahead ${t2 - t1} ms)`);
process.exit(bad < 0 ? 0 : 1);
