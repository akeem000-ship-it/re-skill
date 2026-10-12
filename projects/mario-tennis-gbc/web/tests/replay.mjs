// Replay a session recording (.mtrec from the REC button) on the JS core in Node and verify it reproduces the
// session exactly (frame hashes every 60 frames). Optional: screenshots, periodic core states for state_view.mjs.
// usage: node web/tests/replay.mjs FILE.mtrec [--shots K] [--states N] [--out DIR] [--to FRAME] [--interp]
import fs from "fs"; import zlib from "zlib";
import { GBC } from "../js/gb/gbc.js";
import { loadState, saveState } from "../js/gb/state.js";
import { stateOf, CORE_TAG } from "../js/recorder.js";
globalThis.atob ??= s => Buffer.from(s, "base64").toString("binary"); globalThis.btoa ??= s => Buffer.from(s, "binary").toString("base64");
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const raw = fs.readFileSync(a[0]), rec = JSON.parse((raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw).toString());
if (rec.format !== "mtrec") throw new Error("not a .mtrec recording");
const out = opt("--out", "out/replay"), shots = +opt("--shots", 0), every = +opt("--states", 0), to = Math.min(+opt("--to", rec.frames), rec.frames);
fs.mkdirSync(out, { recursive: true });
const gb = new GBC(new Uint8Array(fs.readFileSync("rom/mario_tennis.gbc")), { audio: false });
if (!a.includes("--interp")) { try { const mod = await import("../gen/game.js"); const T = {}; mod.install(T); gb.installRecomp(T); if (mod.HRAM_SIG) gb.exec.setHramSig(mod.HRAM_SIG); } catch (e) { console.log("interpreter only:", e.message); } }
loadState(gb, rec.start);
const inputs = Buffer.from(rec.inputs, "base64"), hashes = new Map(rec.hashes), events = new Map(rec.events.map(([f, e]) => [f, e]));
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = b => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const png = p => { const f = gb.ppu.frame, r = Buffer.alloc(144 * 481); for (let y = 0; y < 144; y++) for (let x = 0; x < 160; x++) { const v = f[y * 160 + x], o = y * 481 + 1 + x * 3; r[o] = v & 255; r[o + 1] = (v >> 8) & 255; r[o + 2] = (v >> 16) & 255; }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(160, 0); ih.writeUInt32BE(144, 4); ih[8] = 8; ih[9] = 2;
  fs.writeFileSync(p, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(r)), chunk("IEND", Buffer.alloc(0))])); };
let checked = 0, bad = null; const maps = new Map();
for (let f = 0; f < to; f++) {
  if (events.get(f) === "reset") gb.reset();
  gb.setInput(stateOf(inputs[f])); gb.runFrame();
  const n = f + 1, h = hashes.get(n);
  if (h) { checked++; if (h !== gb.frameHash() && !bad) bad = n; }
  const id = gb.mem.wram[0][0x32E]; maps.set(id, (maps.get(id) || 0) + 1);
  if (shots && n % shots === 0) png(`${out}/f${String(n).padStart(6, "0")}.png`);
  if (every && n % every === 0) fs.writeFileSync(`${out}/s${String(n).padStart(6, "0")}.json.gz`, zlib.gzipSync(JSON.stringify(saveState(gb))));
}
console.log(JSON.stringify({ core: rec.core, ourCore: CORE_TAG, frames: rec.frames, replayed: to, minutes: +(to / 3600).toFixed(1), hashChecks: checked,
  firstMismatchFrame: bad, exact: !bad && (to < rec.frames || rec.endHash === gb.frameHash()), mapsVisited: Object.fromEntries([...maps].map(([k, v]) => [k, Math.round(v / 60) + "s"])) }));
