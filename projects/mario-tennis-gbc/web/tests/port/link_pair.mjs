// Link play on two emulated machines joined by a link cable (web/js/gb/cable.js), each in a worker thread
// (link_worker.mjs), from power on with button scripts for both. Modes:
//   --kind core          both run the ROM on the interpreter (to see what link play does; --shots for pictures)
//   --kind port          both run the whole-game port
//   --check              the port twice: once with the link routines as the ROM's code (their hooks removed), once
//                        with their port; everything else the same on both runs. Compares each machine's state at
//                        every one of the game's frames (AdvanceFrame), run against run. The
//                        scripts' frames are then the game's frames (AdvanceFrames), not the hardware's: the two
//                        runs' timing drifts apart (ported code between the waits takes no time), their games must not.
//                        As in port_lockstep.mjs the sound engine's state (WRAM 7 $D000-$D2FF), which the timer runs
//                        as often as a load takes time, and the CPU-time readouts are counted apart.
// usage: node web/tests/port/link_pair.mjs --a "SCRIPT" --b "SCRIPT" [--frames N] [--kind core|port] [--check]
//          [--shots F,F,...] [--name NAME] [--sram-a a.sav] [--sram-b b.sav] [--drop home/link,menus/link/index]
//          [--watch 284b,4a29] (log when these ROM addresses are reached) [--diff-at K,K] (--check: the bytes that
//          differ at those AdvanceFrames)
//   SCRIPT: as web/tests/tour.mjs (BUTTON[*N][@W], BUTTON~H[@W], wait@W, a+b...), from power on.
//   Pictures: out/link/NAME_{a,b}_FRAME.png.
import fs from "fs"; import zlib from "zlib";
import { Worker } from "worker_threads";
import { CABLE_WORDS } from "../../js/gb/cable.js";
import { LINK_HOOKS } from "../../js/port/match/link/index.js";

const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const frames = +opt("--frames", 3000), name = opt("--name", "link"), shots = opt("--shots", "").split(",").filter(Boolean).map(Number);
// a tour.mjs script as [[frame, buttons held from then]...]
function compile(script) {
  const out = []; let f = 0;
  for (let tok of (script || "").split(",").map(t => t.trim()).filter(Boolean)) {
    let wait = 30, rep = 1, hold = 6;
    if (tok.includes("@")) { const [t, w] = tok.split("@"); tok = t; wait = +w; }
    if (tok.includes("*")) { const [t, r] = tok.split("*"); tok = t; rep = +r; }
    if (tok.includes("~")) { const [t, h] = tok.split("~"); tok = t; hold = +h; }
    for (let r = 0; r < rep; r++) {
      if (tok === "wait") { f += wait; continue; }
      if (tok === "mash") { for (let k = 0; k < wait; k += 20) { out.push([f, "a"]); out.push([f + 4, ""]); f += 20; } continue; }
      out.push([f, tok]); f += hold; out.push([f, ""]); f += wait;
    }
  }
  return out;
}
const scripts = [compile(opt("--a", "")), compile(opt("--b", ""))];
const drop = opt("--drop", "").split(",").filter(Boolean);            // port modules to run as the ROM's code
const watch = opt("--watch", "").split(",").filter(Boolean).map(x => parseInt(x, 16));   // ROM addresses to log
const dumpAt = opt("--diff-at", "").split(",").filter(Boolean).map(Number);   // --check: AdvanceFrames to compare byte by byte
const srams = [opt("--sram-a"), opt("--sram-b")].map(p => (p ? new Uint8Array(fs.readFileSync(p)) : null));
function runPair(kind, romLink) {
  const shared = new SharedArrayBuffer(CABLE_WORDS * 4);
  return Promise.all([0, 1].map(side => new Promise((res, rej) => {
    const w = new Worker(new URL("./link_worker.mjs", import.meta.url), { workerData: { side, kind, romLink, script: scripts[side], frames, shots, sram: srams[side], shared, linkHooks: LINK_HOOKS.map(([b, ad]) => [b, ad]), drop, watch, dumpAt, padByAdvance: a.includes("--check") } });
    let err = null;
    w.on("message", m => { if (m.error) err = m.error; else res({ ...m, err }); });
    w.on("error", rej);
  })));
}
// ---- PNG ----
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = b => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
function png(path, f) {
  const raw = Buffer.alloc(144 * 481);
  for (let y = 0; y < 144; y++) for (let x = 0; x < 160; x++) { const v = f[y * 160 + x], o = y * 481 + 1 + x * 3; raw[o] = v & 255; raw[o + 1] = (v >> 8) & 255; raw[o + 2] = (v >> 16) & 255; }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(160, 0); ih.writeUInt32BE(144, 4); ih[8] = 8; ih[9] = 2;
  fs.writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
const report = (label, r) => {
  fs.mkdirSync("out/link", { recursive: true });
  for (const s of r) {
    for (const [f, px] of Object.entries(s.pngs)) png(`out/link/${name}${label.startsWith("ported") ? "_port" : ""}_${"ab"[s.side]}_${f}.png`, px);
    for (const l of s.log || []) console.log(`  ${"ab"[s.side]} ${l}`);
    console.log(`${label} ${"ab"[s.side]}: ${s.pics.length} frames, ${s.advances.length} AdvanceFrames, map ${s.w0[0x32E]}, link state ${s.hram[0x42]}${s.err ? ", stopped: " + s.err : ""}`);
  }
};
if (!a.includes("--check")) {
  const kind = opt("--kind", "core");
  report(kind, await runPair(kind, false));
} else {
  const t0 = Date.now();
  const [rom, port] = await Promise.all([runPair("port", true), runPair("port", false)]);
  report("ROM link code", rom); report("ported link code", port);
  let bad = 0;
  for (const side of [0, 1]) {
    // the game frames both runs had made half a second before the end (after that one machine may stop first
    // and leave the other alone on the cable)
    const x = rom[side], y = port[side], n = Math.min(x.settled, y.settled);
    let k = 0; while (k < n && x.advances[k] === y.advances[k]) k++;
    let p = 0; while (p < Math.min(x.pics.length, y.pics.length) && x.pics[p] === y.pics[p]) p++;
    let soundOnly = 0; for (let i = 0; i < n; i++) if (x.sounds[i] !== y.sounds[i]) soundOnly++;
    const same = k === n && n > 0;
    if (!same) bad++;
    console.log(`side ${"ab"[side]}: ${same ? "same" : "DIFFERENT"}: ${k} of ${n} AdvanceFrames alike (pictures, by hardware frame, alike to frame ${p})${soundOnly ? `; the sound engine's state differs in ${soundOnly} (timing: it runs from the timer during loads)` : ""}`);
  }
  // --diff-at K: the bytes that differ at AdvanceFrame K, run against run, named where a RAM field holds them
  if (dumpAt.length) {
    const { RAM_FIELDS } = await import("../../js/port/fields.js");
    const nameOf = (bank, addr) => { for (const [n, b, a0, size] of RAM_FIELDS) if ((b === bank || (addr >= 0xFF80 || addr < 0xD000) && b === 0) && addr >= a0 && addr < a0 + size) return n + (addr > a0 ? `+${addr - a0}` : ""); return ""; };
    for (const side of [0, 1]) for (const k of dumpAt) {
      const x = rom[side].dumps[k], y = port[side].dumps[k];
      if (!x || !y) { console.log(`side ${"ab"[side]} AdvanceFrame ${k}: not reached`); continue; }
      const out = [];
      x.wram.forEach((b, i) => { for (let j = 0; j < b.length; j++) if (b[j] !== y.wram[i][j] && !(i === 0 && (j >= 0xF00 || (j >= 0xFB && j < 0x100)))) out.push(`${i ? `W${i}:` : ""}${((i ? 0xD000 : 0xC000) + j).toString(16)} ${nameOf(i, (i ? 0xD000 : 0xC000) + j)} ${b[j].toString(16)}/${y.wram[i][j].toString(16)}`); });
      for (let j = 0; j < 0x7F; j++) if (x.hram[j] !== y.hram[j] && j !== 0x20 && j !== 0x21) out.push(`${(0xFF80 + j).toString(16)} ${nameOf(0, 0xFF80 + j)} ${x.hram[j].toString(16)}/${y.hram[j].toString(16)}`);
      let vd = 0; x.vram.forEach((b, i) => { for (let j = 0; j < b.length; j++) if (b[j] !== y.vram[i][j]) vd++; });
      console.log(`side ${"ab"[side]} AdvanceFrame ${k} (ROM link code / port): ly ${x.ly}/${y.ly}, cycles ${x.cycles}/${y.cycles}, ${vd} VRAM bytes; ${out.length} RAM bytes: ${out.slice(0, 24).join(", ")}`);
    }
  }
  console.log(`${bad ? "FAIL" : "ok"} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  process.exit(bad ? 1 : 0);
}
