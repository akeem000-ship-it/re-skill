// Make a power-on .mtrec recording on the core from a button script, for the text-engine port's tests
// (web/js/port/text): story mode, name entry, dialogue scenes and menus with text windows. Same recording
// format as web/tests/engine/make_rec.mjs; the script syntax is web/tests/tour.mjs's.
// usage: node web/tests/port/make_text_rec.mjs OUT.mtrec "script" [--shots K] [--name N]
// script: comma list of  BUTTON[*N][@W]  (press 6 frames, then wait W frames, default 30; *N repeats),
//   BUTTON~H[@W] (hold H frames), wait@W, or buttons joined with + (e.g. up+right~30).
//   BUTTON: a b start select up down left right.
// --from REC[@F]: start from another recording's start state (played F frames on with its own pad) instead of
// power-on; --poke ADDR=VAL[,...]: then write bytes (hex, as mapped; e.g. FF9E=1 turns hDebugStepMode on).
// --shots K: a picture every K frames, 24 to a contact sheet out/port/shots/NAME_###.png (to find the inputs by
// looking at the screen), and the last picture as NAME_end.png.
import fs from "fs"; import zlib from "zlib";
import { newCore } from "../engine/corpus.mjs";
import { saveState, loadState } from "../../js/gb/state.js";
import { readRecording } from "../engine/corpus.mjs";
import { stateOf } from "../../js/recorder.js";
import { CORE_TAG } from "../../js/recorder.js";

const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const [out, script] = a, shots = +opt("--shots", 0), name = opt("--name", (out || "rec").replace(/.*\//, "").replace(/\..*/, ""));
const BIT = { a: 1, b: 2, select: 4, start: 8, right: 16, left: 32, up: 64, down: 128 };

// ---- PNG writer (as web/tests/tour.mjs) ----
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = b => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
// frames: one picture (gb.ppu.frame) or several, tiled 6 to a row (a contact sheet)
function png(frames, path) {
  if (!Array.isArray(frames)) frames = [frames];
  const cols = Math.min(6, frames.length), rows = Math.ceil(frames.length / cols), W = 160 * cols, H = 144 * rows;
  const raw = Buffer.alloc(H * (1 + W * 3));
  frames.forEach((f, i) => {
    const X = (i % cols) * 160, Y = Math.floor(i / cols) * 144;
    for (let y = 0; y < 144; y++) for (let x = 0; x < 160; x++) { const v = f[y * 160 + x], o = (Y + y) * (1 + W * 3) + 1 + (X + x) * 3; raw[o] = v & 255; raw[o + 1] = (v >> 8) & 255; raw[o + 2] = (v >> 16) & 255; }
  });
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
  fs.writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

const gb = await newCore({ recomp: true });
if (opt("--from")) {
  const [path, upTo] = opt("--from").split("@"), src = readRecording(path), pads = Buffer.from(src.inputs, "base64");
  loadState(gb, src.start);
  for (let f = 0; f < +(upTo || 0); f++) { gb.setInput(stateOf(pads[f])); gb.runFrame(); }
}
for (const kv of (opt("--poke") || "").split(",").filter(Boolean)) { const [ad, v] = kv.split("="); gb.mem.write(parseInt(ad, 16), parseInt(v, 16)); }
const start = saveState(gb), inputs = [];
if (shots) fs.mkdirSync("out/port/shots", { recursive: true });
let mask = 0, shotN = 0, sheet = [];
const flush = () => { if (sheet.length) png(sheet, `out/port/shots/${name}_${String(shotN++).padStart(3, "0")}.png`); sheet = []; };
const step = () => {
  inputs.push(mask);
  gb.setInput({ a: !!(mask & 1), b: !!(mask & 2), select: !!(mask & 4), start: !!(mask & 8), right: !!(mask & 16), left: !!(mask & 32), up: !!(mask & 64), down: !!(mask & 128) });
  gb.runFrame();
  if (shots && inputs.length % shots === 0) { sheet.push(gb.ppu.frame.slice()); if (sheet.length === 24) flush(); }
};
const run = n => { for (let i = 0; i < n; i++) step(); };
for (let tok of (script || "").split(",").map(t => t.trim()).filter(Boolean)) {
  let wait = 30, rep = 1, hold = 6;
  if (tok.includes("@")) { const [t, w] = tok.split("@"); tok = t; wait = +w; }
  if (tok.includes("*")) { const [t, r] = tok.split("*"); tok = t; rep = +r; }
  if (tok.includes("~")) { const [t, h] = tok.split("~"); tok = t; hold = +h; }
  for (let r = 0; r < rep; r++) {
    if (tok === "wait") { run(wait); continue; }
    const m = tok.split("+").reduce((s, b) => s | BIT[b], 0);
    mask = m; run(hold); mask = 0; run(wait);
  }
}
const rec = { format: "mtrec", v: 1, core: CORE_TAG, startedAt: new Date().toISOString(), frames: inputs.length, start,
  inputs: Buffer.from(Uint8Array.from(inputs)).toString("base64"), hashes: [], events: [], meta: { scripted: script } };
if (out && out !== "-") fs.writeFileSync(out, zlib.gzipSync(JSON.stringify(rec)));
if (shots) { flush(); png(gb.ppu.frame, `out/port/shots/${name}_end.png`); }
const w = gb.mem.wram[0];
console.log(JSON.stringify({ frames: inputs.length, map: w[0x32E], location: w[0x280] }));
