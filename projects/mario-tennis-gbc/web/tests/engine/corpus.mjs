// Match states from a session recording (.mtrec) for the engine tests: replays it on the JS core (recompiled
// code when web/gen/game.js exists) and hands out frames of real play.
import fs from "fs"; import zlib from "zlib";
import { GBC } from "../../js/gb/gbc.js";
import { loadState } from "../../js/gb/state.js";
import { stateOf } from "../../js/recorder.js";
import { Rom } from "../../js/rom.js";
globalThis.atob ??= s => Buffer.from(s, "base64").toString("binary"); globalThis.btoa ??= s => Buffer.from(s, "binary").toString("base64");

export const ROM_PATH = "rom/mario_tennis.gbc";
export function loadRom() { return new Uint8Array(fs.readFileSync(ROM_PATH)); }
export function romObject() { return new Rom(loadRom()); }
export function readRecording(path) {
  const raw = fs.readFileSync(path);
  return JSON.parse((raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw).toString());
}
export async function newCore({ recomp = true } = {}) {
  const gb = new GBC(loadRom(), { audio: false });
  if (recomp) { try { const mod = await import("../../gen/game.js"); const T = {}; mod.install(T); gb.installRecomp(T); if (mod.HRAM_SIG) gb.exec.setHramSig(mod.HRAM_SIG); } catch (e) { /* interpreter */ } }
  return gb;
}
// replay frames [0, to); onFrame(f, gb, before) is called for f >= from with the RAM before frame f
// (wram banks + hram copies) and the core after it. Return false from onFrame to stop.
export async function replay(rec, { from = 0, to = rec.frames, recomp = true } = {}, onFrame) {
  const gb = await newCore({ recomp });
  loadState(gb, rec.start);
  const inputs = Buffer.from(rec.inputs, "base64"), events = new Map(rec.events.map(([f, e]) => [f, e]));
  for (let f = 0; f < Math.min(to, rec.frames); f++) {
    if (events.get(f) === "reset") gb.reset();
    const before = f >= from ? { wram: gb.mem.wram.map(b => b.slice()), hram: gb.mem.hram.slice() } : null;
    gb.setInput(stateOf(inputs[f])); gb.runFrame();
    if (before && onFrame(f, gb, before) === false) break;
  }
  return gb;
}
// a frame in which the match simulation ran exactly once (StepMatchFrame: hMatchFrameCounter $FFE9 + 1,
// wMatchSimFrozen $C4C0 clear, on a court)
export function simFrame(before, gb) {
  const fc0 = before.hram[0x69], fc1 = gb.mem.hram[0x69];
  return ((fc1 - fc0) & 0xFF) === 1 && before.wram[0][0x4C0] === 0 && gb.mem.wram[0][0x4C0] === 0 && before.wram[0][0x32E] <= 15;
}
