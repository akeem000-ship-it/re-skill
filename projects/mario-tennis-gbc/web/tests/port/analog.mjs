// STICK FEEL: Analog with the port (web/js/stick.js, engine/chars.js ANALOG): a recorded exhibition is played to a frame in
// a rally, then the player's pad holds a direction for a while, three ways: the d-pad alone; the d-pad with the stick at the
// same angle at full tilt (must be the same game, frame for frame); and the stick at another angle and a light tilt (the
// player must run at that angle, slower). Each run starts from power-on (a port can't be copied mid-game).
// usage: node web/tests/port/analog.mjs [REC.mtrec] [FRAME]
import { readRecording, loadRom } from "../engine/corpus.mjs";
import { loadState } from "../../js/gb/state.js";
import { stateOf } from "../../js/recorder.js";
import { GamePort } from "../../js/port/port.js";
import { program } from "../../js/port/program.js";

const [recPath = "out/engine/exh1.mtrec", at = "3000"] = process.argv.slice(2);
const rec = readRecording(recPath), inputs = Buffer.from(rec.inputs, "base64"), rom = loadRom(), F = +at, HOLD = 40;
const RIGHT = 0x10, DOWN = 0x80;                                          // the recording's input byte: low nibble buttons, high the d-pad
const fnv = (h, a) => { for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 0x01000193); } return h >>> 0; };
const hash = gb => { let h = 0x811c9dc5; gb.mem.wram.forEach(b => { h = fnv(h, b); }); return fnv(h, gb.mem.oam); };
const s16 = (b, a) => { const v = b[a - 0xD000] | b[a - 0xD000 + 1] << 8; return v & 0x8000 ? v - 0x10000 : v; };

function run(pad, analog) {
  const P = new GamePort(rom, rec.start.cpu.pc === 0x100 ? program : { ...program, *main(Q) { yield* Q.continueCpu(); } });
  loadState(P.gb, rec.start);
  P.onVBlank = n => P.setInput(stateOf(n < F ? inputs[Math.min(n, rec.frames - 1)] : pad));
  while (P.vblanks < F) P.frame();
  const me = [4, 5, 6, 7].find(k => [0, 2, 3].includes(P.gb.mem.wram[k][0xF1E]));
  const W = P.gb.mem.wram[me], x0 = s16(W, 0xDF01), d0 = s16(W, 0xDF04), hashes = [];
  P.analog = analog;
  while (P.vblanks < F + HOLD) { P.frame(); hashes.push(hash(P.gb)); }
  return { dx: s16(W, 0xDF01) - x0, dd: s16(W, 0xDF04) - d0, facing: W[0xF0D], hashes };
}
const pad = run(RIGHT, null), same = run(RIGHT, { facing: 0x00, speed: 1 });
const diag = run(RIGHT | DOWN, null), slow = run(RIGHT | DOWN, { facing: 0x10, speed: 0.5 });
const differ = pad.hashes.findIndex((h, i) => h !== same.hashes[i]);
const fail = [];
if (differ >= 0) fail.push(`the stick right at full tilt differs from the d-pad after ${differ} frames`);
if (slow.facing !== 0x10) fail.push(`facing ${slow.facing.toString(16)}, not 10`);
const dist = r => Math.hypot(r.dx, r.dd), ang = r => Math.atan2(r.dd, r.dx) * 180 / Math.PI;
if (!(ang(slow) > 0 && ang(slow) < ang(diag) - 5)) fail.push(`the stick at 22 degrees ran at ${ang(slow).toFixed(0)}, the d-pad's down-right at ${ang(diag).toFixed(0)}`);
if (!(dist(slow) < dist(diag) * 0.8)) fail.push(`a half tilt ran ${dist(slow).toFixed(1)}, the d-pad ${dist(diag).toFixed(1)}`);
console.log(`d-pad right: moved ${pad.dx},${pad.dd}; stick right: ${same.dx},${same.dd}; d-pad down-right: ${diag.dx},${diag.dd} (${ang(diag).toFixed(0)} deg); ` +
  `stick at $10, half tilt: ${slow.dx},${slow.dd} (${ang(slow).toFixed(0)} deg; facing $${slow.facing.toString(16)})`);
console.log(fail.length ? "FAIL: " + fail.join("; ") : "ok");
process.exit(fail.length ? 1 : 0);
