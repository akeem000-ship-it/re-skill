// Resume the JS core from a PyBoy state (tools/emu_dump_snapshot.py -> JSON), play the presses of a recording,
// and compare every frame's hash with PyBoy's from the same state (tools/emu_frame_hashes.py --state --presses).
// usage: node web/tests/snap_vs_pyboy.mjs SNAP.json PYBOY_HASHES.txt [--presses REC.json] [--dump F,F,...]
//   presses: {"presses": {frame: "button[:hold]"}} as written by tools/emu_play_hole.py (hold default 6)
//   dump writes out/snap_fFRAME.ppm for the listed core frames
import fs from "fs";
import { fileURLToPath } from "url";
import { GBC } from "../js/gb/gbc.js";
import { loadSnapshot } from "../js/gb/snapshot.js";
const here = p => fileURLToPath(new URL(p, import.meta.url));
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const rom = new Uint8Array(fs.readFileSync(here("../../rom/mario_golf.gbc")));
const snap = JSON.parse(fs.readFileSync(a[0], "utf8"));
const ref = fs.readFileSync(a[1], "utf8").trim().split("\n").map(l => l.split(" ")[1]);
const held = {};                                   // frame -> [button, until]
if (opt("--presses", null)) {
  for (const [f, b] of Object.entries(JSON.parse(fs.readFileSync(opt("--presses"), "utf8")).presses)) {
    const [name, n] = b.split(":"); held[+f] = [name, +f + (n ? +n : 6)];
  }
}
const dumps = new Set((opt("--dump", "") || "").split(",").filter(Boolean).map(Number));
const gb = new GBC(rom, { audio: false });
loadSnapshot(gb, snap);
const down = new Map();
const hashes = []; const t0 = Date.now();
for (let f = 0; f < ref.length; f++) {
  if (held[f]) down.set(held[f][0], held[f][1]);
  for (const [b, until] of down) if (f >= until) down.delete(b);
  const st = {}; for (const b of down.keys()) st[b] = true;
  gb.setInput(st); gb.runFrame(); hashes.push(gb.frameHash());
  if (dumps.has(f)) {
    const px = gb.ppu.rgb5, out = Buffer.alloc(160 * 144 * 3); for (let i = 0; i < out.length; i++) out[i] = px[i] * 8;
    fs.writeFileSync(`out/snap_f${f}.ppm`, Buffer.concat([Buffer.from("P6 160 144 255\n"), out]));
  }
}
const N = ref.length;
console.log(`${N} frames in ${Date.now() - t0} ms`);
let same = 0, first = -1; for (let f = 0; f < N; f++) { if (hashes[f] === ref[f]) same++; else if (first < 0) first = f; }
console.log(`identical frames: ${same} of ${N}; first difference at frame ${first}`);
const runs = []; let cur = null;
for (let f = 0; f < N; f++) { const ok = ref[f] === hashes[f]; if (!cur || cur.ok !== ok) { cur = { ok, from: f, to: f }; runs.push(cur); } else cur.to = f; }
console.log(runs.slice(0, 20).map(r => `${r.ok ? "ok" : "XX"} ${r.from}-${r.to}`).join("  "));
process.exit(same === N ? 0 : 1);
