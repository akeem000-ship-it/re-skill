// A standalone Game Boy sound chip for the native sound driver: it takes the register writes driver.js produces
// (FF10-FF3F) and turns them into stereo PCM. No CPU, no memory map: the chip only. The channel model (two pulse
// channels with sweep on the first, wave, noise, the 512 Hz frame sequencer for length / sweep / envelope, the DACs
// and NR50/NR51 mixing) is the one of the emulator core's web/js/gb/apu.js; this copy adds frame-paced rendering
// into caller buffers and a DC-blocking high-pass, as the console's output capacitor does.
//
//   const apu = new SynthAPU(48000);
//   for each 59.7 Hz frame: for (const [r, v] of driver.frame()) apu.write(r, v); apu.renderFrame(left, right, at)
const DUTY = [[0, 0, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 1, 1, 1], [0, 1, 1, 1, 1, 1, 1, 0]];
export const CLOCK = 4194304, DOTS_PER_FRAME = 70224;

export class SynthAPU {
  constructor(sampleRate = 48000) {
    this.rate = sampleRate; this.reg = new Uint8Array(0x30); this.wave = new Uint8Array(16);
    this.on = false; this.fsStep = 0; this.fsCounter = 0;
    this.ch = [this.newCh(), this.newCh(), this.newCh(), this.newCh()];
    this.samplesPer = CLOCK / sampleRate; this.sampleCounter = 0;
    this.accL = 0; this.accR = 0; this.accN = 0;          // box filter over the dots of one output sample
    this.hpL = 0; this.hpR = 0; this.hpCharge = Math.pow(0.999958, CLOCK / sampleRate);
    this.muted = [false, false, false, false];
  }
  newCh() {
    return { enabled: false, dac: false, timer: 0, duty: 0, pos: 0, len: 0, lenOn: false, envVol: 0, envDir: 0,
      envPeriod: 0, envTimer: 0, freq: 0, sweepTimer: 0, sweepShadow: 0, sweepOn: false, sweepNeg: false,
      lfsr: 0x7FFF, wavePos: 0, waveBuf: 0 };
  }
  // register r = $10-$3F (the low byte of FF10-FF3F)
  write(r, v) {
    if (r >= 0x30) { this.wave[r - 0x30] = v; return; }
    if (r === 0x26) {
      const was = this.on; this.on = !!(v & 0x80);
      if (was && !this.on) { this.reg.fill(0, 0x10, 0x26); for (const c of this.ch) { c.enabled = false; c.dac = false; } }
      if (!was && this.on) this.fsStep = 0;
      return;
    }
    if (!this.on && r !== 0x20 && r !== 0x1B && r !== 0x11 && r !== 0x16) return;
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
  writeAll(writes) { for (const [r, v] of writes) this.write(r, v); }
  lengthEnable(i, v) {
    const c = this.ch[i], was = c.lenOn; c.lenOn = !!(v & 0x40);
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
        const nr10 = reg[0x10]; c.sweepShadow = c.freq; c.sweepTimer = ((nr10 >> 4) & 7) || 8;
        c.sweepOn = !!((nr10 & 0x70) || (nr10 & 7)); c.sweepNeg = false;
        if (nr10 & 7) this.sweepCalc();
      }
    } else if (i === 2) { c.timer = (2048 - c.freq) * 2; c.wavePos = 0; }
    else {
      const nr42 = reg[0x21]; c.envVol = nr42 >> 4; c.envDir = nr42 & 8 ? 1 : -1; c.envPeriod = nr42 & 7; c.envTimer = c.envPeriod || 8;
      c.lfsr = 0x7FFF; c.timer = this.noisePeriod();
    }
  }
  noisePeriod() { const nr43 = this.reg[0x22], d = nr43 & 7, s = nr43 >> 4; return (d ? d * 16 : 8) << s; }
  sweepCalc() {
    const c = this.ch[0], nr10 = this.reg[0x10];
    let f = c.sweepShadow >> (nr10 & 7);
    if (nr10 & 8) { f = c.sweepShadow - f; c.sweepNeg = true; } else f = c.sweepShadow + f;
    if (f > 2047) c.enabled = false;
    return f;
  }
  frameSequencer() {
    const s = this.fsStep; this.fsStep = (s + 1) & 7;
    if ((s & 1) === 0) for (const c of this.ch) if (c.lenOn && c.len > 0) { c.len--; if (c.len === 0) c.enabled = false; }
    if (s === 2 || s === 6) {
      const c = this.ch[0];
      if (c.sweepOn && --c.sweepTimer <= 0) {
        const nr10 = this.reg[0x10]; c.sweepTimer = ((nr10 >> 4) & 7) || 8;
        if (nr10 & 0x70) { const f = this.sweepCalc(); if (f <= 2047 && (nr10 & 7)) { c.sweepShadow = f; c.freq = f; this.sweepCalc(); } }
      }
    }
    if (s === 7) for (const i of [0, 1, 3]) {
      const c = this.ch[i]; if (!c.envPeriod) continue;
      if (--c.envTimer <= 0) { c.envTimer = c.envPeriod; const nv = c.envVol + c.envDir; if (nv >= 0 && nv <= 15) c.envVol = nv; }
    }
  }
  // the DAC outputs mixed by NR51 / NR50, in about -1..1 per side
  mix() {
    const ch = this.ch, reg = this.reg, nr50 = reg[0x24], nr51 = reg[0x25];
    let l = 0, r = 0;
    for (let i = 0; i < 4; i++) {
      const c = ch[i];
      if (!c.dac || this.muted[i]) continue;
      let o = 0;
      if (c.enabled) {
        if (i < 2) o = DUTY[c.duty][c.pos] * c.envVol;
        else if (i === 2) { const code = (reg[0x1C] >> 5) & 3; o = code ? c.waveBuf >> (code - 1) : 0; }
        else o = (c.lfsr & 1) ? 0 : c.envVol;
      }
      const v = (o / 15) * 2 - 1;
      if (nr51 & (0x10 << i)) l += v;
      if (nr51 & (1 << i)) r += v;
    }
    this.accL += l * (((nr50 >> 4) & 7) + 1); this.accR += r * ((nr50 & 7) + 1); this.accN++;
  }
  // advance n dots, writing output samples into left/right from index at; returns the new index
  run(n, left, right, at) {
    const ch = this.ch;
    for (let k = 0; k < n; k += 4) {
      if (this.on) {
        this.fsCounter += 4; if (this.fsCounter >= 8192) { this.fsCounter -= 8192; this.frameSequencer(); }
        for (let i = 0; i < 2; i++) { const c = ch[i]; c.timer -= 4; if (c.timer <= 0) { c.timer += (2048 - c.freq) * 4; c.pos = (c.pos + 1) & 7; } }
        { const c = ch[2]; c.timer -= 4; if (c.timer <= 0) { c.timer += (2048 - c.freq) * 2; c.wavePos = (c.wavePos + 1) & 31; const b = this.wave[c.wavePos >> 1]; c.waveBuf = c.wavePos & 1 ? b & 15 : b >> 4; } }
        { const c = ch[3]; c.timer -= 4; if (c.timer <= 0) { c.timer += this.noisePeriod(); const x = (c.lfsr ^ (c.lfsr >> 1)) & 1; c.lfsr = (c.lfsr >> 1) | (x << 14); if (this.reg[0x22] & 8) c.lfsr = (c.lfsr & ~0x40) | (x << 6); } }
        this.mix();
      } else this.accN++;
      this.sampleCounter += 4;
      if (this.sampleCounter >= this.samplesPer) {
        this.sampleCounter -= this.samplesPer;
        const l = this.accN ? this.accL / this.accN / 32 : 0, r = this.accN ? this.accR / this.accN / 32 : 0;
        this.accL = this.accR = 0; this.accN = 0;
        const ol = l - this.hpL, or = r - this.hpR;            // high-pass: the output capacitor
        this.hpL = l - ol * this.hpCharge; this.hpR = r - or * this.hpCharge;
        if (at < left.length) { left[at] = ol; right[at] = or; }
        at++;
      }
    }
    return at;
  }
  // samples one frame will produce from now (the count varies by one as the fraction accumulates)
  samplesInNextFrame() { return Math.floor((this.sampleCounter + DOTS_PER_FRAME) / this.samplesPer); }
  renderFrame(left, right, at = 0) { return this.run(DOTS_PER_FRAME, left, right, at); }
}

// Driver + chip together: frame-paced PCM for a song or effects, without any CPU.
export class SoundPlayer {
  constructor(driver, sampleRate = 48000) {
    this.driver = driver; this.apu = new SynthAPU(sampleRate);
    this.apu.writeAll(driver.init());
    this.frames = 0;
  }
  // render `frames` driver frames into fresh Float32Arrays
  render(frames) {
    let total = 0; const counts = [];
    const n = Math.ceil(frames * DOTS_PER_FRAME / this.apu.samplesPer) + 2;
    const left = new Float32Array(n), right = new Float32Array(n);
    for (let f = 0; f < frames; f++) {
      this.apu.writeAll(this.driver.frame());
      total = this.apu.renderFrame(left, right, total);
      counts.push(total); this.frames++;
    }
    return { left: left.subarray(0, total), right: right.subarray(0, total) };
  }
}
