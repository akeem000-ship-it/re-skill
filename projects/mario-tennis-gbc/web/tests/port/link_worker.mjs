// One machine of a linked pair (web/tests/port/link_pair.mjs): runs in a worker thread on its end of the link cable
// (web/js/gb/cable.js), from power on, playing its button script, and reports a hash of its machine at every one of
// the game's frames (AdvanceFrame, for a port) and of every picture, and the pictures asked for.
// workerData: { side, kind: "core" | "port", romLink: true (port: the link routines as the ROM's code), drop: port
//   modules whose routines run as the ROM's (e.g. "home/link"), dumpAt: AdvanceFrames whose memory to send, script:
//   [[frame, buttons]...] (buttons held from that frame on), frames, shots: [frame...], sram: Uint8Array?, shared }
import { workerData, parentPort } from "worker_threads";
import { GBC } from "../../js/gb/gbc.js";
import { CableEnd } from "../../js/gb/cable.js";
import { loadRom } from "../engine/corpus.mjs";

const { side, kind, romLink, script, frames, shots = [], sram, shared, linkHooks = [], drop = [], watch = [], dumpAt = [], padByAdvance = false } = workerData;
const rom = loadRom();
let gb, P = null;
if (kind === "core") gb = new GBC(rom, { audio: false });
else {
  const { GamePort, hookKey } = await import("../../js/port/port.js");
  const { program } = await import("../../js/port/program.js");
  P = new GamePort(rom, program);
  if (romLink) for (const [b, ad] of linkHooks) P.hooks.delete(hookKey(b, ad));
  for (const m of drop) for (const [b, ad] of (await import(`../../js/port/${m}.js`)).HOOKS) P.hooks.delete(hookKey(b, ad));   // (as the ROM's)
  gb = P.gb;
}
if (sram) gb.mem.sram.set(sram);
const cable = new CableEnd(gb, shared, side);
// watch: ROM addresses to log when reached (the frame, the return address on the stack, a few registers)
let frameNow = 0;
const log = [];
if (watch.length) {
  const W = new Set(watch), cpu = gb.cpu, m = gb.mem;
  const note = pc => { if (W.has(pc) && log.length < 200) log.push(`f${frameNow} ${pc.toString(16)} from ${(m.read(cpu.sp) | m.read(cpu.sp + 1) << 8).toString(16)} a=${cpu.a.toString(16)} rx=${m.hram[0x40].toString(16)} tx=${m.hram[0x41].toString(16)} st=${m.hram[0x42]} cnt=${m.hram[0x48]} ly=${gb.ppu.ly}`); };
  if (P) { const st = P.step.bind(P); P.step = () => { note(cpu.pc); return st(); }; }
  else { const st = gb.stepInstruction.bind(gb); gb.stepInstruction = () => { note(cpu.pc); return st(); }; }
}
const fnv = (h, arr) => { for (let i = 0; i < arr.length; i++) { h ^= arr[i]; h = Math.imul(h, 0x01000193); } return h >>> 0; };
const machineHash = () => {
  const m = gb.mem; let h = 0x811c9dc5;
  // not compared, as in port_lockstep.mjs: the stack page $CF00-$CFFF; the CPU-time readouts (the debug peak-LY
  // text $C0FB-$C0FF, hPeakLY and its hold count $FFA0-$FFA1)
  // the sound engine's state (WRAM 7 $D000-$D2FF) apart: the timer interrupt runs it as often as a load takes time
  m.wram.forEach((b, i) => { h = i === 7 ? fnv(h, b.subarray(0x300)) : i ? fnv(h, b) : fnv(fnv(h, b.subarray(0, 0xFB)), b.subarray(0x100, 0xF00)); });
  h = fnv(fnv(h, m.hram.subarray(0, 0x20)), m.hram.subarray(0x22)); m.vram.forEach(b => { h = fnv(h, b); }); h = fnv(h, m.oam); h = fnv(h, m.sram);
  return h;
};
const advances = [];
const dumps = {}, wantDump = new Set(dumpAt);
const snapshot = () => { const m = gb.mem; return { wram: m.wram.map(b => b.slice()), hram: m.hram.slice(), vram: m.vram.map(b => b.slice()), oam: m.oam.slice(), pc: gb.cpu.pc, ly: gb.ppu.ly, cycles: gb.cycles }; };
// padByAdvance (a port): the script's frames are the game's frames (its AdvanceFrames), so two runs whose timing
// drifts apart still see each press in the same frame of the game
const soundHash = () => fnv(0x811c9dc5, gb.mem.wram[7].subarray(0, 0x300));
const sounds = [];
let settled = 0;
if (P) P.afterAdvance = k => { advances.push(machineHash()); sounds.push(soundHash()); if (wantDump.has(k)) dumps[k] = snapshot(); if (padByAdvance) padAt(k); };
const pics = [], pngs = {}, wantShot = new Set(shots);
// the script by hardware frame (frame boundaries: a port's ROM code may run on through several in one P.frame())
let si = 0, held = {};
const padAt = f => { while (si < script.length && script[si][0] <= f) { held = {}; for (const b of script[si][1].split("+").filter(Boolean)) held[b] = true; si++; } gb.setInput(held); };
const boundary = f => {                                          // after frame f: its picture; the pad of frame f + 1
  pics.push(gb.frameHash());
  if (wantShot.has(f)) pngs[f] = Uint32Array.from(gb.ppu.frame);
  frameNow = f + 1; if (!padByAdvance) padAt(f + 1);
  if (f === frames - 30) settled = advances.length;              // (the game frames before either end stops)
};
padAt(0);
try {
  if (P) {
    P.onVBlank = n => { if (n <= frames) boundary(n - 1); };
    while (P.vblanks < frames) P.frame();
  } else for (let f = 0; f < frames; f++) { gb.runFrame(); boundary(f); }
} catch (e) { parentPort.postMessage({ error: `${e.message} (pc ${gb.cpu.pc.toString(16)})` }); }
cable.end();
parentPort.postMessage({ side, log, dumps, advances, sounds, settled, pics, pngs, final: machineHash(), w0: gb.mem.wram[0].slice(0, 0x1000), hram: gb.mem.hram.slice() });
