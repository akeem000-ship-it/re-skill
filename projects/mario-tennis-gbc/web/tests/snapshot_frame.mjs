// Resume the core from a PyBoy snapshot (tools/emu_dump_snapshot.py), run N frames and write a PPM.
// usage: node web/tests/snapshot_frame.mjs SNAP.json OUT.ppm [--frames N]
import fs from "fs";
import { fileURLToPath } from "url";
import { GBC } from "../js/gb/gbc.js";
import { loadSnapshot } from "../js/gb/snapshot.js";
const here = p => fileURLToPath(new URL(p, import.meta.url));
const a = process.argv.slice(2), N = a.includes("--frames") ? +a[a.indexOf("--frames") + 1] : 60;
const rom = new Uint8Array(fs.readFileSync(here("../../rom/mario_tennis.gbc")));
const gb = new GBC(rom, { audio: false }); loadSnapshot(gb, JSON.parse(fs.readFileSync(a[0])));
for (let f = 0; f < N; f++) gb.runFrame();
const b = gb.ppu.rgb5, out = Buffer.alloc(160 * 144 * 3); for (let i = 0; i < out.length; i++) out[i] = b[i] * 8;
fs.writeFileSync(a[1], Buffer.concat([Buffer.from("P6 160 144 255\n"), out]));
console.log("wrote", a[1], "pc", gb.cpu.pc.toString(16), "bank", gb.mem.romBank, "map", gb.mem.wram[0][0x281], "hash", gb.frameHash());
