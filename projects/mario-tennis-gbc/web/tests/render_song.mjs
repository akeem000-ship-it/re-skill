// Render a song/SFX with the ported driver + APU model to a 16-bit stereo WAV (listening check).
// usage: node web/tests/render_song.mjs ID_HEX SECONDS OUT.wav
import fs from "fs";
import { fileURLToPath } from "url";
import { Sequencer, Apu } from "../js/sound.js";
const root = new URL("../../", import.meta.url);
const rom = new Uint8Array(fs.readFileSync(fileURLToPath(new URL("rom/mario_tennis.gbc", root))));
const [idHex, secs, out] = process.argv.slice(2);
const rate = 44100, perTick = 735, ticks = Math.round(+secs * 60);
const seq = new Sequencer(rom), apu = new Apu(rate); seq.start(parseInt(idHex, 16));
const buf = new Float32Array(2 * perTick), pcm = new Int16Array(2 * perTick * ticks);
for (let t = 0; t < ticks; t++) {
  seq.step(); apu.render(seq, buf, perTick);
  for (let i = 0; i < 2 * perTick; i++) pcm[2 * perTick * t + i] = Math.max(-1, Math.min(1, buf[i])) * 32767;
}
const hdr = Buffer.alloc(44), n = pcm.length * 2;
hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + n, 4); hdr.write("WAVE", 8); hdr.write("fmt ", 12); hdr.writeUInt32LE(16, 16);
hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22); hdr.writeUInt32LE(rate, 24); hdr.writeUInt32LE(rate * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34);
hdr.write("data", 36); hdr.writeUInt32LE(n, 40);
fs.writeFileSync(out, Buffer.concat([hdr, Buffer.from(pcm.buffer)]));
console.log("wrote", out, ticks, "ticks,", seq.events.length, "note events");
