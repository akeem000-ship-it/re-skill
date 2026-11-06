// Native step 3's synthesiser against the clocked APU: plays recordings from power on on the native port (no CPU,
// events, gb/synth.js) with a shadow gb/apu.js fed the same register writes and the same time, stepped as the port
// stepped it before (4 CPU cycles at a time: 2 dots in double speed). Checks:
//   * what the game can read back is the same: every APU register read (NR52's channel-on bits, the lengths) and the
//     state the frame sequencer keeps (lengths, envelopes, sweep), compared at every read, write and frame;
//   * the sound is the same to the ear: per frame the difference's energy against the signal's (the synthesiser's
//     waveforms are dot exact, the APU's move in 2-dot steps, so single samples can differ at a waveform edge).
// usage: node web/tests/port/synth_vs_apu.mjs [a.mtrec ...] [--frames N]   (default: exh1, story1, minigame_star)
import { readRecording, loadRom } from "../engine/corpus.mjs";
import { stateOf } from "../../js/recorder.js";
import { GamePort } from "../../js/port/port.js";
import { program } from "../../js/port/program.js";
import { APU } from "../../js/gb/apu.js";
import { Synth } from "../../js/gb/synth.js";

const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const recs = a.filter((x, i) => !x.startsWith("--") && a[i - 1] !== "--frames");
if (!recs.length) recs.push("out/engine/exh1.mtrec", "out/port/story1.mtrec", "out/port/minigame_star.mtrec");
const maxFrames = +opt("--frames", 1e9), rom = loadRom();
let bad = 0;
const state = A => A.ch.map(c => [c.enabled, c.dac, c.len, c.lenOn, c.envVol, c.freq, c.sweepShadow].join()).join("|") + "|" + A.fsStep;
for (const path of recs) {
  const rec = readRecording(path), ins = Buffer.from(rec.inputs, "base64");
  if (rec.start.cpu.pc !== 0x100) { console.log(`${path}: from a saved state, skipped`); continue; }
  const P = new GamePort(rom, program, { noCpu: true, audio: true });
  const N = P.gb.apu; if (!(N instanceof Synth)) throw new Error("not the synthesiser");
  const O = new APU(N.rate);                                                  // the shadow starts as the machine's sound after power on
  O.reg.set(N.reg); O.wave.set(N.wave); O.on = N.on; O.fsStep = N.fsStep; O.fsCounter = N.fsCounter; O.sampleCounter = N.sampleCounter; O.ch = structuredClone(N.ch);
  let readDiffs = 0, stateDiffs = 0;
  const nStep = N.step.bind(N), nWrite = N.write.bind(N), nRead = N.read.bind(N);
  N.step = n => { nStep(n); for (let k = 0; k < n; k += 2) O.step(Math.min(2, n - k)); };
  N.write = (r, v) => { nWrite(r, v); O.write(r, v); };
  N.read = r => { const v = nRead(r), w = O.read(r); if (v !== w && readDiffs++ < 5) console.log(`${path}: frame ${P.frames}: read of $FF${r.toString(16)}: ${v.toString(16)} / ${w.toString(16)}`); return v; };
  P.onVBlank = n => P.setInput(stateOf(ins[Math.min(n, ins.length - 1)])); P.setInput(stateOf(ins[0]));
  const frames = Math.min(maxFrames, rec.frames), bn = new Float32Array(16384), bo = new Float32Array(16384);
  let sig = 0, err = 0, worst = 0, loud = 0;
  for (let f = 0; f < frames; f++) {
    P.frame();
    if (state(N) !== state(O) && stateDiffs++ < 5) console.log(`${path}: frame ${f}: sound state differs\n  ${state(N)}\n  ${state(O)}`);
    const k = N.drain(bn), j = O.drain(bo); let s = 0, e = 0;
    for (let i = 0; i < Math.min(k, j); i++) { s += bn[i] * bn[i]; e += (bn[i] - bo[i]) ** 2; }
    sig += s; err += e; if (s > 1e-3) { loud++; worst = Math.max(worst, e / s); }
  }
  const snr = 10 * Math.log10(sig / Math.max(err, 1e-12));
  console.log(`${path}: ${frames} frames; reads differing ${readDiffs}, state differing ${stateDiffs}; sound: signal to difference ${snr.toFixed(1)} dB, worst frame ${(10 * Math.log10(1 / Math.max(worst, 1e-12))).toFixed(1)} dB (${loud} frames with sound)`);
  if (readDiffs || stateDiffs || snr < 20) bad++;
}
process.exit(bad ? 1 : 0);
