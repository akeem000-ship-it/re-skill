// Diagnostic: load a core state and compare the live BG map in VRAM with the court's ROM tilemap
// (size, scroll, rows that differ). usage: node web/tests/court_map_diff.mjs STATE.json.gz
import fs from "fs"; import zlib from "zlib";
import { GBC } from "../js/gb/gbc.js";
import { loadState } from "../js/gb/state.js";
import { Rom } from "../js/rom.js";
import { COURTS } from "../js/assets.js";
globalThis.atob ??= s => Buffer.from(s, "base64").toString("binary"); globalThis.btoa ??= s => Buffer.from(s, "binary").toString("base64");
const romBytes = new Uint8Array(fs.readFileSync("rom/mario_tennis.gbc")), gb = new GBC(romBytes, { audio: false }), rom = new Rom(romBytes);
loadState(gb, JSON.parse(zlib.gunzipSync(fs.readFileSync(process.argv[2])).toString()));
const p = gb.ppu, w0 = gb.mem.wram[0], v0 = gb.mem.vram[0], base = p.lcdc & 8 ? 0x1C00 : 0x1800;
console.log({ map: w0[0x32E], scx: p.scx, scy: p.scy, field: [w0[0x320], w0[0x321], w0[0x322], w0[0x323]] });
for (const id of COURTS) {
  const b = 0x59D9 + id * 16, tm = rom.lzRef(rom.u8(0x0A, b + 4), rom.u8(0x0A, b + 5)), S = tm.length >= 4096 ? 64 : 32;
  let same = 0; for (let i = 0; i < 1024; i++) if (v0[base + i] === tm[(i >> 5) * S + (i & 31)]) same++;
  console.log(id, "len", tm.length, "S", S, "same", same);
}
