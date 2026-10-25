// Render a song or an effect with the native driver and the standalone chip (no CPU) to a WAV file in out/, and
// print its level per second (a quick check that the synth makes sound).
// usage: node web/tests/sound_wav.mjs song 3 [seconds=20]   |   node web/tests/sound_wav.mjs sfx 0x1A [seconds=3]
import fs from "fs";
import path from "path";
import { SoundDriver } from "../js/sound/driver.js";
import { SoundPlayer, CLOCK, DOTS_PER_FRAME } from "../js/sound/apu.js";
import { loadRom, root } from "./sound_ref.mjs";

const [kind = "song", idArg = "1", secsArg] = process.argv.slice(2);
const id = parseInt(idArg), secs = +(secsArg || (kind === "sfx" ? 3 : 20)), rate = 48000;
const driver = new SoundDriver(loadRom());
const player = new SoundPlayer(driver, rate);
if (kind === "sfx") driver.playSound(0x40 + id); else driver.playSound(id);
const frames = Math.round(secs * CLOCK / DOTS_PER_FRAME);
const { left, right } = player.render(frames);

const n = left.length, buf = Buffer.alloc(44 + n * 4);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 4, 28);
buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
const clip = v => Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
for (let i = 0; i < n; i++) { buf.writeInt16LE(clip(left[i]), 44 + 4 * i); buf.writeInt16LE(clip(right[i]), 46 + 4 * i); }
fs.mkdirSync(path.join(root, "out"), { recursive: true });
const file = path.join(root, "out", `${kind}_${id.toString(16).padStart(2, "0")}.wav`);
fs.writeFileSync(file, buf);
const rms = [];
for (let s = 0; s * rate < n; s++) {
  let acc = 0; const end = Math.min(n, (s + 1) * rate);
  for (let i = s * rate; i < end; i++) acc += left[i] * left[i] + right[i] * right[i];
  rms.push(Math.sqrt(acc / (2 * (end - s * rate))).toFixed(3));
}
console.log(`${file}: ${n} samples (${(n / rate).toFixed(1)} s); RMS per second: ${rms.join(" ")}`);
