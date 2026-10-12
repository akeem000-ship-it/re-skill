// Render the core's audio for N seconds from power-on (optionally pressing Start at a frame) to a WAV
// and report its level. usage: node web/tests/core_audio.mjs OUT.wav [--seconds S] [--start F]
import fs from "fs";
import { fileURLToPath } from "url";
import { GBC } from "../js/gb/gbc.js";
const here = p => fileURLToPath(new URL(p, import.meta.url));
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const out = a[0] || "out/core.wav", secs = +opt("--seconds", 8), startAt = +opt("--start", -1);
const rom = new Uint8Array(fs.readFileSync(here("../../rom/mario_tennis.gbc")));
const gb = new GBC(rom, { sampleRate: 44100, audio: true });
const frames = Math.round(secs * 60), chunks = [], buf = new Float32Array(2 * 4096);
let dots = 0; const dotsPerFrame = [];
for (let f = 0; f < frames; f++) {
  gb.setInput({ start: startAt >= 0 && f >= startAt && f < startAt + 6 });
  const d0 = gb.ppu.frames; const c0 = gb.cycles; gb.runFrame(); dotsPerFrame.push(gb.mem.doubleSpeed ? (gb.cycles - c0) / 2 : gb.cycles - c0);
  let n; while ((n = gb.apu.drain(buf)) > 0) chunks.push(buf.slice(0, n));
}
const total = chunks.reduce((s, c) => s + c.length, 0), pcm = new Int16Array(total); let p = 0, peak = 0, sq = 0;
for (const c of chunks) for (let i = 0; i < c.length; i++) { const v = Math.max(-1, Math.min(1, c[i])); pcm[p++] = v * 32767; peak = Math.max(peak, Math.abs(v)); sq += v * v; }
const hdr = Buffer.alloc(44); hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + pcm.length * 2, 4); hdr.write("WAVEfmt ", 8); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22);
hdr.writeUInt32LE(44100, 24); hdr.writeUInt32LE(44100 * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34); hdr.write("data", 36); hdr.writeUInt32LE(pcm.length * 2, 40);
fs.writeFileSync(out, Buffer.concat([hdr, Buffer.from(pcm.buffer)]));
const avg = dotsPerFrame.reduce((s, v) => s + v, 0) / dotsPerFrame.length;
console.log(`wrote ${out}: ${(total / 2 / 44100).toFixed(2)} s, peak ${peak.toFixed(3)}, rms ${Math.sqrt(sq / total).toFixed(4)}; dots/frame avg ${avg.toFixed(1)} (expected 70224), doubleSpeed ${gb.mem.doubleSpeed}`);
