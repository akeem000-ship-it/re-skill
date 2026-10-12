// Run the JS core from power-on and compare its per-frame hashes with PyBoy's (tools/emu_frame_hashes.py).
// usage: node web/tests/core_vs_pyboy.mjs out/pyboy_hashes.txt [--frames N] [--dump FRAME]  (dump writes out/core_fFRAME.ppm)
import fs from "fs";
import { fileURLToPath } from "url";
import { GBC } from "../js/gb/gbc.js";
const here = p => fileURLToPath(new URL(p, import.meta.url));
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const rom = new Uint8Array(fs.readFileSync(here("../../rom/mario_tennis.gbc")));
const ref = fs.existsSync(a[0]) ? fs.readFileSync(a[0], "utf8").trim().split("\n").map(l => l.split(" ")[1]) : [];
const N = +opt("--frames", ref.length || 300), dump = opt("--dump", null);
const gb = new GBC(rom, { audio: false });
const hashes = []; const t0 = Date.now();
for (let f = 0; f < N; f++) {
  gb.runFrame(); hashes.push(gb.frameHash());
  if (dump !== null && f === +dump) {
    const b = gb.ppu.rgb5, out = Buffer.alloc(160 * 144 * 3); for (let i = 0; i < out.length; i++) out[i] = b[i] * 8;
    fs.writeFileSync(`out/core_f${f}.ppm`, Buffer.concat([Buffer.from(`P6 160 144 255\n`), out]));
  }
}
console.log(`${N} frames in ${Date.now() - t0} ms (${(N * 1000 / (Date.now() - t0)).toFixed(0)} fps)`);
if (!ref.length) { console.log(hashes.slice(0, 10).join(" ")); process.exit(0); }
// find the best frame offset (the boot ROM timing differs), then the first mismatch
let best = { off: 0, matches: -1 };
for (let off = -3; off <= 3; off++) {
  let m = 0; for (let f = 0; f < N; f++) { const r = ref[f + off]; if (r !== undefined && r === hashes[f]) m++; }
  if (m > best.matches) best = { off, matches: m };
}
console.log("best offset", best.off, "matching frames", best.matches, "of", N);
let first = -1; for (let f = 0; f < N; f++) { if (ref[f + best.off] !== undefined && ref[f + best.off] !== hashes[f]) { first = f; break; } }
console.log("first mismatch at core frame", first, first >= 0 ? `(core ${hashes[first]} vs pyboy ${ref[first + best.off]})` : "");
let runs = []; let cur = null;
for (let f = 0; f < N; f++) { const ok = ref[f + best.off] === hashes[f]; if (!cur || cur.ok !== ok) { cur = { ok, from: f, to: f }; runs.push(cur); } else cur.to = f; }
console.log(runs.slice(0, 12).map(r => `${r.ok ? "ok" : "XX"} ${r.from}-${r.to}`).join("  "));
