// Headless driver for long play sessions on the JS core (Node, no browser): resume a core save state (or
// power on), play a button script, save the resulting state, write PNG screenshots.
// usage: node web/tests/tour.mjs IN|- OUT "script" [--shots K] [--name N] [--interp]
// script: comma list of  BUTTON[*N][@W]  (press 6 frames, then wait W frames, default 30; *N repeats),
//   BUTTON~H[@W] (hold H frames), wait@W, mash@W (tap A every 20 frames for W frames), or
//   buttons joined with + (e.g. up+right~30). BUTTON: a b start select up down left right.
// Prints after the script: frame count, wCurMapID, field scroll, and writes out/tour/NAME.png.
import fs from "fs"; import zlib from "zlib";
import { GBC } from "../js/gb/gbc.js";
import { saveState, loadState } from "../js/gb/state.js";
globalThis.btoa ??= s => Buffer.from(s, "binary").toString("base64");
globalThis.atob ??= s => Buffer.from(s, "base64").toString("binary");
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const [inp, out, script] = a; const shots = +opt("--shots", 0), name = opt("--name", (out || "tour").replace(/.*\//, "").replace(/\..*/, ""));
fs.mkdirSync("out/tour", { recursive: true });
const rom = new Uint8Array(fs.readFileSync("rom/mario_tennis.gbc"));
const gb = new GBC(rom, { sampleRate: 44100, audio: false });
if (!a.includes("--interp")) { try { const mod = await import("../gen/game.js"); const T = {}; mod.install(T); gb.installRecomp(T); if (mod.HRAM_SIG) gb.exec.setHramSig(mod.HRAM_SIG); } catch (e) { console.log("interpreter only:", e.message); } }
if (inp && inp !== "-") loadState(gb, JSON.parse(zlib.gunzipSync(fs.readFileSync(inp))));
if (opt("--sram")) {                         // power on with the battery save of another state (continue a file)
  const tmp = new GBC(rom, { audio: false }); loadState(tmp, JSON.parse(zlib.gunzipSync(fs.readFileSync(opt("--sram"))))); gb.mem.sram.set(tmp.mem.sram);
}
// ---- PNG writer ----
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = b => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
function png(path) {
  const f = gb.ppu.frame, raw = Buffer.alloc(144 * (1 + 160 * 3));
  for (let y = 0; y < 144; y++) { raw[y * 481] = 0; for (let x = 0; x < 160; x++) { const v = f[y * 160 + x], o = y * 481 + 1 + x * 3; raw[o] = v & 255; raw[o + 1] = (v >> 8) & 255; raw[o + 2] = (v >> 16) & 255; } }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(160, 0); ih.writeUInt32BE(144, 4); ih[8] = 8; ih[9] = 2;
  fs.writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
// ---- input ----
const held = {}; let shotN = 0, f0 = gb.frames;
const step = () => { gb.setInput(held); gb.runFrame(); if (shots && (gb.frames - f0) % shots === 0) png(`out/tour/${name}_${String(shotN++).padStart(3, "0")}.png`); };
const run = n => { for (let i = 0; i < n; i++) step(); };
for (let tok of (script || "").split(",").map(t => t.trim()).filter(Boolean)) {
  let wait = 30, rep = 1, hold = 6;
  if (tok.includes("@")) { const [t, w] = tok.split("@"); tok = t; wait = +w; }
  if (tok.includes("*")) { const [t, r] = tok.split("*"); tok = t; rep = +r; }
  if (tok.includes("~")) { const [t, h] = tok.split("~"); tok = t; hold = +h; }
  for (let r = 0; r < rep; r++) {
    if (tok === "wait") { run(wait); continue; }
    if (tok === "mash") { for (let k = 0; k < wait; k += 20) { held.a = true; run(4); held.a = false; run(16); } continue; }
    const bs = tok.split("+"); for (const b of bs) held[b] = true; run(hold); for (const b of bs) held[b] = false; run(wait);
  }
}
const w = gb.mem.wram[0];
console.log(JSON.stringify({ frames: gb.frames, played: gb.frames - f0, map: w[0x32E], scroll: [w[0x321] * 8 + (w[0x320] >> 5), w[0x323] * 8 + (w[0x322] >> 5)], lcdc: gb.ppu.lcdc.toString(16), hash: gb.frameHash(), pc: gb.cpu.pc.toString(16), cyc: gb.cycles }));
png(`out/tour/${name}.png`);
if (out && out !== "-") fs.writeFileSync(out, zlib.gzipSync(JSON.stringify(saveState(gb))));
