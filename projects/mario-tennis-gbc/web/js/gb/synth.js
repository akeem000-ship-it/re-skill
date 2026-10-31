// The sound as a synthesiser (native step 3): apu.js's channels, registers, frame sequencer and mixing, but not
// clocked. step(dots) runs from one point that matters to the next (an output sample, a frame-sequencer tick: at
// most about 95 dots apart) and moves each channel's waveform on by the whole stretch at once (how many times its
// timer ran out in it, and the step it is at), instead of 4 dots at a time. The channels' timers count single
// dots, so the waveforms are those of the hardware dot for dot, whatever size of step the machine is run in (apu.js
// counts in steps of up to 4 dots, so its waveforms depend on them). Lengths, sweep and envelopes are the frame
// sequencer's as in apu.js: what the game can read back (NR52's channel-on bits) is the same.
import { APU } from "./apu.js";

export class Synth extends APU {
  step(n) {
    if (!this.on) { super.step(n); return; }
    while (n > 0) {
      let s = Math.min(n, 8192 - this.fsCounter, Math.ceil(this.samplesPer - this.sampleCounter));
      if (s < 1) s = 1;
      this.advance(s);
      this.fsCounter += s; if (this.fsCounter >= 8192) { this.fsCounter -= 8192; this.frameSequencer(); }
      this.sampleCounter += s; if (this.sampleCounter >= this.samplesPer) { this.sampleCounter -= this.samplesPer; this.mix(); }
      n -= s;
    }
  }
  // the channels' timers over s dots: each time a timer runs out it reloads and the channel steps once
  advance(s) {
    const ch = this.ch;
    for (let i = 0; i < 2; i++) {
      const c = ch[i]; c.timer -= s;
      if (c.timer <= 0) { const p = (2048 - c.freq) * 4, e = 1 + Math.floor(-c.timer / p); c.timer += e * p; c.pos = (c.pos + e) & 7; }
    }
    { const c = ch[2]; c.timer -= s;
      if (c.timer <= 0) { const p = (2048 - c.freq) * 2, e = 1 + Math.floor(-c.timer / p); c.timer += e * p; c.wavePos = (c.wavePos + e) & 31; const b = this.wave[c.wavePos >> 1]; c.waveBuf = c.wavePos & 1 ? b & 15 : b >> 4; } }
    { const c = ch[3]; c.timer -= s;
      if (c.timer <= 0) {
        const p = this.noisePeriod(), e = 1 + Math.floor(-c.timer / p), narrow = this.reg[0x22] & 8; c.timer += e * p;
        for (let k = 0; k < e; k++) { const x = (c.lfsr ^ (c.lfsr >> 1)) & 1; c.lfsr = (c.lfsr >> 1) | (x << 14); if (narrow) c.lfsr = (c.lfsr & ~0x40) | (x << 6); }
      } }
  }
}
