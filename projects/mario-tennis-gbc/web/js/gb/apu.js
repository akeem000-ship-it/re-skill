// Game Boy APU at register level: two pulse channels (sweep on 1), wave, noise; frame sequencer
// (512 Hz: length at 256 Hz, sweep at 128 Hz, envelope at 64 Hz), DACs, NR50/NR51 mixing.
// step(dots) advances the channels at the 4.19 MHz base clock and accumulates stereo samples
// into an internal ring buffer at the output sample rate (pull them with drain()).
const DUTY = [[0,0,0,0,0,0,0,1], [1,0,0,0,0,0,0,1], [1,0,0,0,0,1,1,1], [0,1,1,1,1,1,1,0]];

export class APU {
  constructor(sampleRate = 44100) {
    this.rate = sampleRate; this.reg = new Uint8Array(0x30); this.wave = new Uint8Array(16);
    this.on = false; this.fsStep = 0; this.fsCounter = 0;
    this.ch = [this.newCh(), this.newCh(), this.newCh(), this.newCh()];
    this.sampleCounter = 0; this.samplesPer = 4194304 / sampleRate;
    this.out = new Float32Array(2 * 8192); this.outPos = 0;
    this.left = 0; this.right = 0;
  }
  newCh() { return { enabled: false, dac: false, timer: 0, duty: 0, pos: 0, len: 0, lenOn: false, vol: 0, envVol: 0, envDir: 0, envPeriod: 0, envTimer: 0,
                     freq: 0, sweepTimer: 0, sweepShadow: 0, sweepOn: false, sweepNeg: false, lfsr: 0x7FFF, sample: 0, wavePos: 0, waveBuf: 0 }; }
  read(r) {
    const masks = [0x80,0x3F,0x00,0xFF,0xBF, 0xFF,0x3F,0x00,0xFF,0xBF, 0x7F,0xFF,0x9F,0xFF,0xBF, 0xFF,0xFF,0x00,0x00,0xBF, 0x00,0x00,0x70];
    if (r >= 0x30) return this.wave[r - 0x30];
    if (r === 0x26) return (this.on ? 0x80 : 0) | 0x70 | (this.ch[0].enabled ? 1 : 0) | (this.ch[1].enabled ? 2 : 0) | (this.ch[2].enabled ? 4 : 0) | (this.ch[3].enabled ? 8 : 0);
    const i = r - 0x10;
    return i < masks.length ? this.reg[r] | masks[i] : 0xFF;
  }
  write(r, v) {
    if (r >= 0x30) { this.wave[r - 0x30] = v; return; }
    if (r === 0x26) {
      const was = this.on; this.on = !!(v & 0x80);
      if (was && !this.on) { for (let i = 0x10; i < 0x26; i++) this.reg[i] = 0; for (const c of this.ch) { c.enabled = false; c.dac = false; } }
      if (!was && this.on) { this.fsStep = 0; }
      return;
    }
    if (!this.on && r !== 0x20 && r !== 0x1B && r !== 0x11 && r !== 0x16) return;   // length registers are writable while off
    this.reg[r] = v;
    const ch = this.ch;
    switch (r) {
      case 0x10: if (ch[0].sweepNeg && !(v & 8)) ch[0].enabled = false; break;
      case 0x11: ch[0].duty = v >> 6; ch[0].len = 64 - (v & 63); break;
      case 0x12: ch[0].dac = (v & 0xF8) !== 0; if (!ch[0].dac) ch[0].enabled = false; break;
      case 0x13: ch[0].freq = (ch[0].freq & 0x700) | v; break;
      case 0x14: ch[0].freq = (ch[0].freq & 0xFF) | ((v & 7) << 8); this.lengthEnable(0, v); if (v & 0x80) this.trigger(0); break;
      case 0x16: ch[1].duty = v >> 6; ch[1].len = 64 - (v & 63); break;
      case 0x17: ch[1].dac = (v & 0xF8) !== 0; if (!ch[1].dac) ch[1].enabled = false; break;
      case 0x18: ch[1].freq = (ch[1].freq & 0x700) | v; break;
      case 0x19: ch[1].freq = (ch[1].freq & 0xFF) | ((v & 7) << 8); this.lengthEnable(1, v); if (v & 0x80) this.trigger(1); break;
      case 0x1A: ch[2].dac = !!(v & 0x80); if (!ch[2].dac) ch[2].enabled = false; break;
      case 0x1B: ch[2].len = 256 - v; break;
      case 0x1D: ch[2].freq = (ch[2].freq & 0x700) | v; break;
      case 0x1E: ch[2].freq = (ch[2].freq & 0xFF) | ((v & 7) << 8); this.lengthEnable(2, v); if (v & 0x80) this.trigger(2); break;
      case 0x20: ch[3].len = 64 - (v & 63); break;
      case 0x21: ch[3].dac = (v & 0xF8) !== 0; if (!ch[3].dac) ch[3].enabled = false; break;
      case 0x23: this.lengthEnable(3, v); if (v & 0x80) this.trigger(3); break;
    }
  }
  lengthEnable(i, v) {
    const c = this.ch[i], was = c.lenOn; c.lenOn = !!(v & 0x40);
    // enabling length in the first half of a length period clocks it once (obscure behaviour)
    if (!was && c.lenOn && (this.fsStep & 1) && c.len > 0) { c.len--; if (c.len === 0 && !(v & 0x80)) c.enabled = false; }
  }
  trigger(i) {
    const c = this.ch[i], reg = this.reg;
    c.enabled = c.dac;
    if (c.len === 0) { c.len = i === 2 ? 256 : 64; if (c.lenOn && (this.fsStep & 1)) c.len--; }
    if (i < 2) {
      const nrx2 = reg[i === 0 ? 0x12 : 0x17];
      c.timer = (2048 - c.freq) * 4; c.envVol = nrx2 >> 4; c.envDir = nrx2 & 8 ? 1 : -1; c.envPeriod = nrx2 & 7; c.envTimer = c.envPeriod || 8;
      if (i === 0) {
        const nr10 = reg[0x10]; c.sweepShadow = c.freq; c.sweepTimer = ((nr10 >> 4) & 7) || 8; c.sweepOn = !!((nr10 & 0x70) || (nr10 & 7)); c.sweepNeg = false;
        if (nr10 & 7) this.sweepCalc(true);
      }
    } else if (i === 2) { c.timer = (2048 - c.freq) * 2; c.wavePos = 0; }
    else {
      const nr42 = reg[0x21]; c.envVol = nr42 >> 4; c.envDir = nr42 & 8 ? 1 : -1; c.envPeriod = nr42 & 7; c.envTimer = c.envPeriod || 8;
      c.lfsr = 0x7FFF; c.timer = this.noisePeriod();
    }
  }
  noisePeriod() { const nr43 = this.reg[0x22], d = nr43 & 7, s = nr43 >> 4; return (d ? d * 16 : 8) << s; }
  sweepCalc(check) {
    const c = this.ch[0], nr10 = this.reg[0x10], shift = nr10 & 7;
    let f = c.sweepShadow >> shift;
    if (nr10 & 8) { f = c.sweepShadow - f; c.sweepNeg = true; } else f = c.sweepShadow + f;
    if (f > 2047) { c.enabled = false; return f; }
    return f;
  }
  frameSequencer() {
    const s = this.fsStep; this.fsStep = (s + 1) & 7;
    if ((s & 1) === 0) for (let i = 0; i < 4; i++) { const c = this.ch[i]; if (c.lenOn && c.len > 0) { c.len--; if (c.len === 0) c.enabled = false; } }
    if (s === 2 || s === 6) {
      const c = this.ch[0]; if (c.sweepOn && --c.sweepTimer <= 0) {
        const nr10 = this.reg[0x10]; c.sweepTimer = ((nr10 >> 4) & 7) || 8;
        if (nr10 & 0x70) { const f = this.sweepCalc(); if (f <= 2047 && (nr10 & 7)) { c.sweepShadow = f; c.freq = f; this.sweepCalc(); } }
      }
    }
    if (s === 7) for (const i of [0, 1, 3]) {
      const c = this.ch[i]; if (!c.envPeriod) continue;
      if (--c.envTimer <= 0) { c.envTimer = c.envPeriod; const nv = c.envVol + c.envDir; if (nv >= 0 && nv <= 15) c.envVol = nv; }
    }
  }
  // advance by n base-clock cycles (dots)
  step(n) {
    if (!this.on) { this.sampleCounter += n; while (this.sampleCounter >= this.samplesPer) { this.sampleCounter -= this.samplesPer; this.pushSample(0, 0); } return; }
    const ch = this.ch;
    for (let k = 0; k < n; k += 4) {
      this.fsCounter += 4; if (this.fsCounter >= 8192) { this.fsCounter -= 8192; this.frameSequencer(); }
      for (let i = 0; i < 2; i++) { const c = ch[i]; c.timer -= 4; if (c.timer <= 0) { c.timer += (2048 - c.freq) * 4; c.pos = (c.pos + 1) & 7; } }
      { const c = ch[2]; c.timer -= 4; if (c.timer <= 0) { c.timer += (2048 - c.freq) * 2; c.wavePos = (c.wavePos + 1) & 31; const b = this.wave[c.wavePos >> 1]; c.waveBuf = c.wavePos & 1 ? b & 15 : b >> 4; } }
      { const c = ch[3]; c.timer -= 4; if (c.timer <= 0) { c.timer += this.noisePeriod(); const x = (c.lfsr ^ (c.lfsr >> 1)) & 1; c.lfsr = (c.lfsr >> 1) | (x << 14); if (this.reg[0x22] & 8) c.lfsr = (c.lfsr & ~0x40) | (x << 6); } }
      this.sampleCounter += 4;
      if (this.sampleCounter >= this.samplesPer) { this.sampleCounter -= this.samplesPer; this.mix(); }
    }
  }
  mix() {
    const ch = this.ch, nr50 = this.reg[0x24], nr51 = this.reg[0x25], reg = this.reg;
    const outs = [0, 0, 0, 0];
    for (let i = 0; i < 2; i++) { const c = ch[i]; outs[i] = c.enabled && c.dac ? DUTY[c.duty][c.pos] * c.envVol : 0; }
    { const c = ch[2], code = (reg[0x1C] >> 5) & 3; outs[2] = c.enabled && c.dac && code ? c.waveBuf >> (code - 1) : 0; }
    { const c = ch[3]; outs[3] = c.enabled && c.dac ? ((c.lfsr & 1) ? 0 : c.envVol) : 0; }
    let l = 0, r = 0;
    for (let i = 0; i < 4; i++) { const v = (outs[i] / 15) * 2 - (ch[i].dac ? 1 : 0); if (nr51 & (0x10 << i)) l += v; if (nr51 & (1 << i)) r += v; }
    l *= ((nr50 >> 4) & 7) + 1; r *= (nr50 & 7) + 1;
    this.pushSample(l / 32, r / 32);
  }
  pushSample(l, r) {
    if (this.outPos >= this.out.length) return;
    this.out[this.outPos++] = l; this.out[this.outPos++] = r;
  }
  drain(dst) {                                // copy the accumulated samples out (interleaved stereo)
    const n = Math.min(dst.length, this.outPos); dst.set(this.out.subarray(0, n));
    this.out.copyWithin(0, n, this.outPos); this.outPos -= n; return n;
  }
}
