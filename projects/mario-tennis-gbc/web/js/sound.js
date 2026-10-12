// Sound: port of the game's sequence driver (REVERSE.md "Sound driver") plus a small Game Boy APU
// model. Pure JS (no WebAudio here) so Node tests can run it; audio.js wraps it in an AudioWorklet.
// Approximations: hardware envelope decay inside an envelope phase, portamento ($AA) and the NR32
// wave volume rule are simplified; sweep (NR10) is not emulated.

const PERIODS = 0x3B1D, NOISE_TAB = 0x3836, VIB = 0x3C4D, PROD = 0x3B4D, WAVESETS = 0x3DD4, ENVSETS = 0x3ED6;
const MUSIC_INDEX = 0x3151, SFX_INDEX = 0x31B5, REMAP = 0x2FE0;

export class Sequencer {
  constructor(romBytes) {
    this.b = romBytes;
    this.ch = [];                       // 6 driver slots: 0,1 SFX; 2-5 music
    for (let i = 0; i < 6; i++) this.ch.push(this.newChannel());
    this.tick = 0; this.counter2 = 0; this.nr50 = 0x77;
    this.events = [];                   // note events for tests: {t, slot, hw, note, dur, vol}
    this.voices = [0, 1, 2, 3].map(() => ({ on: false, freq: 0, duty: 2, vol: 0, pan: 3, wave: null, waveVol: 0, nr43: 0, trigger: false, owner: -1 }));
  }
  u8(a) { return this.b[a]; }
  u16(a) { return this.b[a] | this.b[a + 1] << 8; }
  rom(bank, addr) { return bank * 0x4000 + (addr - 0x4000); }
  newChannel() {
    return { active: false, started: false, bank: 0, base: 0, idx: 0, hw: 0, vol: 0, duty: 0, frac: 0, acc: 0,
      ticksLeft: 0, gate: 0xFF, gateCount: 0xFF, c1: 0, envShape: 0, envLen: 0, envElapsed: 0, fadeSteps: 0, fadeRate: 0, fadeCount: 0,
      freq: 0, baseFreq: 0, pan: 0xFF, vibDepth: 0, vibDelay: 0, vibDelayCount: 0, instr: 0, callRepeat: 0, callReturn: 0,
      loops: [], alt: false, sweep: 0, waveId: 0xFF, waveVol: 0, noise: 0, note: -1, released: false, waitOnly: false };
  }

  // SoundStart 00:3297
  start(id) {
    if (id === 0) { this.stopAll(); return; }
    if (id >= 0x40 && id <= 0x44) id = this.u8(REMAP + (id - 0x40));
    const music = id < 0x50;
    if (music) {                         // music restarts every music slot
      for (let i = 2; i < 6; i++) this.ch[i] = this.newChannel();
      this.music = id;
    }
    const e = music ? MUSIC_INDEX + 2 * (id - 1) : SFX_INDEX + 2 * (id - 0x50);
    const bank = 0x70 | (this.u8(e) & 0x0F), nch = this.u8(e) >> 4, row = this.u8(e + 1);
    for (let i = 0; i < nch; i++) {
      const r = this.rom(bank, 0x4000) + (row + i) * 4;
      const slot = this.u8(r) >> 5, hw = this.u8(r + 1) & 3, ptr = this.u16(r + 2);
      const c = this.newChannel();
      c.active = true; c.bank = bank; c.base = this.rom(bank, ptr); c.hw = hw; c.idx = 0;
      this.ch[slot] = c;
    }
  }
  musicPlaying() { return this.ch.slice(2).some(c => c.active); }
  stopAll() { this.music = 0; for (let i = 0; i < 6; i++) this.ch[i] = this.newChannel(); for (const v of this.voices) v.on = false; }

  // SoundDriverTick 00:3373: SFX slots first, then music; a slot claims its hardware channel
  step() {
    this.tick++;
    const claimed = [false, false, false, false];
    for (let s = 0; s < 6; s++) {
      const c = this.ch[s];
      if (!c.active) continue;
      if (claimed[c.hw]) { this.channelTick(c, s, true); continue; }   // muted by an SFX on the same channel
      claimed[c.hw] = true;
      this.channelTick(c, s, false);
    }
    for (let hw = 0; hw < 4; hw++) if (!claimed[hw]) this.voices[hw].on = false;
  }

  channelTick(c, s, muted) {
    const v = this.voices[c.hw];
    if (!c.started) {                    // header (00:34DD)
      const h = c.base;
      c.frac = this.u8(h) & 15; c.acc = c.frac;
      if (c.hw === 2) { c.waveVol = this.u8(h + 1); c.vol = this.u8(h + 2); c.waveId = this.u8(h + 3); }
      else { c.duty = (this.u8(h + 1) >> 2) & 3; c.vol = this.u8(h + 2); c.sweep = this.u8(h + 3); }
      c.started = true; c.idx = 2;
      this.runCommands(c, s, muted);
      return;
    }
    // vibrato (00:39A7)
    if (c.vibDepth && c.vibDelayCount === 0 && c.ticksLeft > 0 && !c.waitOnly) {
      const d = this.u8(VIB + ((c.vibDepth - 1) << 4 | (this.tick & 15)));
      c.freq = (c.baseFreq + (d & 0x80 ? d - 256 : d)) & 0x7FF;
    }
    // envelope elapsed (00:33E9) and shape (00:3A40)
    if (c.envLen) {
      c.envElapsed = Math.min(c.envElapsed + 1, c.envLen);
      this.applyEnvelope(c);
    }
    // tempo fraction (00:33F5): skip n/16 of the ticks
    c.acc += c.frac;
    if (c.acc >= 16) { c.acc -= 16; this.updateVoice(c, s, muted); return; }
    // fades (00:3968)
    if (c.fadeSteps && --c.fadeCount <= 0) {
      c.fadeCount = c.fadeRate;
      if (c.fadeSteps < 0) { c.fadeSteps++; if (c.vol > 0) c.vol--; } else { c.fadeSteps--; if (c.vol < 15) c.vol++; }
    }
    if (c.vibDelayCount > 0) c.vibDelayCount--;
    if (c.ticksLeft === 0) { this.runCommands(c, s, muted); return; }
    c.ticksLeft--;
    if (c.gateCount > 0 && --c.gateCount === 0) c.released = true;
    if (c.ticksLeft === 0) { this.runCommands(c, s, muted); return; }
    this.updateVoice(c, s, muted);
  }

  // 00:3A40-3AF7: hardware envelope from the envelope set. Row = shape, phase = 16*elapsed/length;
  // byte = level<<4 | flags: bit0 write this phase, bit1 halve the period, bit2 fixed period 1,
  // bit3 direction (1 = up). Period = (length>>4) << (0..2 by the channel volume bits), 0 = none.
  applyEnvelope(c) {
    const phase = Math.min(15, Math.floor(16 * c.envElapsed / c.envLen));
    if (phase === c.envPhase) return;
    c.envPhase = phase;
    const set = this.u16(ENVSETS + 2 * (c.instr & 15));
    const H = this.u8(set - 16 + ((c.envShape << 4) | phase)), E = (H & 0xF0) | (c.vol & 15);
    let B = 0;
    if (!(H & 4)) {
      B = 1;
      const a = (c.envLen >> 4) & 15;
      if (a) {
        B = a;
        let keep = true;
        if (!(E & 8)) { B <<= 1; if (!(E & 4)) { B <<= 1; if (!(E & 2)) keep = false; } }
        if (keep) { if (B >= 8) B = 0; } else B = 0;
      }
    }
    if (H & 2 && B) B >>= 1;
    B = (H & 8) | B;
    const write = (H & 1) || ((c.envDir || 0) !== (H & 8));
    if (write) { c.envLevel = H >> 4; c.envPeriod = B & 7; c.envDir = H & 8; c.envWrite = true; }
  }
  effectiveVol(c) {
    let vol = c.vol;
    if (c.envLen && c.envLevel !== undefined) vol = this.u8(PROD + ((c.envLevel << 4) | vol)) >> 4;
    if (c.released && vol) vol = (vol >> 2) + 1;
    return vol;
  }
  updateVoice(c, s, muted, trigger = false) {
    if (muted) return;
    const v = this.voices[c.hw];
    v.owner = s; v.on = c.note >= 0 && c.note !== 0x1F && !c.waitOnly ? true : v.on && !trigger;
    if (c.note === 0x1F) v.on = v.on && !c.released;
    v.pan = c.pan; v.freq = c.freq; v.duty = c.duty; v.nr43 = c.noise;
    if (trigger || c.envWrite || v.setVol === undefined || !c.envLen) {   // an NR12 write: restart the hardware envelope
      v.setVol = this.effectiveVol(c); v.vol = v.setVol; v.envPeriod = c.envLen ? (c.envPeriod || 0) : 0; v.envDir = c.envLen ? !!c.envDir : false; v.envTimer = 0;
      c.envWrite = false;
    }
    if (trigger) v.trigger = true;
    if (c.hw === 2 && c.waveId !== 0xFF && (!v.wave || v.waveKey !== (c.instr >> 4) * 256 + c.waveId)) {
      const set = this.u16(WAVESETS + 2 * (c.instr >> 4)), p = set + c.waveId * 16, w = [];
      for (let i = 0; i < 16; i++) { w.push(this.u8(p + i) >> 4); w.push(this.u8(p + i) & 15); }
      v.wave = w; v.waveKey = (c.instr >> 4) * 256 + c.waveId;
    }
    if (c.hw === 2) v.waveVol = c.waveVol;
  }

  loopSlot(c, n) { return c.loops[n & 15] || (c.loops[n & 15] = { count: 0, idx: 0 }); }

  // SeqNextByte 00:3566: read 2-byte commands until a note or wait
  runCommands(c, s, muted) {
    for (let guard = 0; guard < 500; guard++) {
      const p = c.base + 2 * c.idx, op = this.u8(p), arg = this.u8(p + 1);
      c.idx++;
      if (op < 0xA0) { this.note(c, s, muted, op, arg); return; }
      if (op === 0xFF) { c.active = false; c.idx = 0xFFFF; if (!muted) this.voices[c.hw].on = false; return; }
      if (op === 0xFD) { const L = this.loopSlot(c, arg); L.count = 0; L.idx = c.idx; continue; }
      if (op >= 0xF0) continue;
      if (op >= 0xD0) {                  // fades: Dn up, En down, every arg ticks
        const n = op & 15;
        if (c.hw !== 2) { c.fadeSteps = op >= 0xE0 ? -n : n; c.fadeRate = c.fadeCount = arg; }
        continue;
      }
      if (op >= 0xC0) { if (c.hw === 2 || (c.vol & 0) === 0) { c.envShape = op & 15; c.envLen = arg; } continue; }
      if (op >= 0xB0) {
        if (op === 0xB0) { if ((arg & 0xF0) === 0xF0) { c.idx = this.loopSlot(c, arg).idx; } continue; }
        const L = this.loopSlot(c, arg); L.count++;
        if (L.count < (op & 15) + 1) c.idx = L.idx;
        continue;
      }
      switch (op) {
        case 0xA0: c.vol = arg & 15; c.envElapsed = 0; break;
        case 0xA1: if (c.hw === 2) c.waveId = arg; else c.sweep = arg; break;
        case 0xA2: if (c.hw === 2) c.waveVol = arg; else c.duty = (arg >> 2) & 3; break;
        case 0xA3: if (arg === 0xFE) c.vibDepth = 0; else { c.vibDelay = c.vibDelayCount = (arg & 15) * 2; c.vibDepth = ((arg + 0x10) >> 4) & 15; } break;
        case 0xA4: c.gate = arg; break;
        case 0xA5: c.pan = arg === 1 ? ((c.pan << 4) | (c.pan >> 4)) & 0xFF : arg; break;
        case 0xA6: this.nr50 = arg; break;
        case 0xA7: c.ticksLeft = arg; c.waitOnly = true; this.updateVoice(c, s, muted); return;
        case 0xA8: c.instr = arg; break;
        case 0xA9:
          if (arg === 0xF0) c.c1++; else if (arg === 0xF1) c.c1--; else if (arg === 0xF2) this.counter2++; else if (arg === 0xF3) this.counter2--;
          else if (arg === 0xFE || arg === 0xFF) { const k = arg === 0xFF ? c.c1 : this.counter2; c.idx = this.u16(c.base + 2 * c.idx + 2 * k) >> 1; }
          else if (arg < 0x80) c.c1 = arg; else this.counter2 = arg - 0x80;
          break;
        case 0xAA: break;                                 // portamento: not modelled
        case 0xAC: {
          const target = this.u16(c.base + 2 * c.idx); c.idx++;
          if (c.callRepeat === 0) c.callRepeat = arg;
          c.callRepeat--;
          c.callReturn = c.idx - 2; c.callRemaining = c.callRepeat;
          c.idx = target >> 1;
          break;
        }
        case 0xAD:
          if (c.callRemaining > 0) { c.idx = c.callReturn; } else c.idx = c.callReturn + 2;
          break;
        case 0xAE: c.alt = !!(arg & 0x10); break;
        case 0xAF: c.frac = arg & 15; break;
        default: break;
      }
    }
  }

  note(c, s, muted, nn, dur) {
    c.ticksLeft = dur; c.waitOnly = false; c.note = nn;
    c.gateCount = c.gate & 0x80 ? Math.max(1, (dur + c.gate - 256)) : c.gate;
    c.released = false;
    this.events.push({ t: this.tick, slot: s, hw: c.hw, note: nn, dur, vol: c.vol, idx: c.idx - 1 });
    if (nn === 0x1F) { c.released = true; this.updateVoice(c, s, muted); return; }   // rest: release
    if (c.hw === 3) c.noise = nn < 0x10 ? this.u8(NOISE_TAB + nn) : nn;
    else {
      const semi = nn & 15;
      if (semi >= 12) { c.released = true; this.updateVoice(c, s, muted); return; }
      let period = this.u16(PERIODS + 2 * (semi + (c.alt ? 12 : 0)));
      period >>= nn >> 4;
      c.baseFreq = c.freq = (0x800 - period) & 0x7FF;
    }
    c.envElapsed = 0; c.envLevel = undefined; c.envPhase = -1;
    if (c.envLen) this.applyEnvelope(c);
    this.updateVoice(c, s, muted, true);
  }
}

// --- Game Boy APU model (pulse x2, wave, noise) rendering one driver tick (1/60 s) ---
const DUTY = [[0,0,0,0,0,0,0,1], [1,0,0,0,0,0,0,1], [1,0,0,0,0,1,1,1], [0,1,1,1,1,1,1,0]];
export class Apu {
  constructor(sampleRate = 44100) {
    this.rate = sampleRate; this.phase = [0, 0, 0, 0]; this.lfsr = 0x7FFF; this.noiseAcc = 0;
  }
  // render n stereo samples from the sequencer voices into out (Float32 interleaved L R)
  render(seq, out, n) {
    const v = seq.voices, rate = this.rate;
    // hardware envelopes: one step per period/64 s (NR12), between the driver's writes
    for (let hw = 0; hw < 4; hw++) {
      const vc = v[hw];
      if (hw === 2 || !vc.on || !vc.envPeriod) continue;
      vc.envTimer += n / rate * 64;
      while (vc.envTimer >= vc.envPeriod) { vc.envTimer -= vc.envPeriod; vc.vol = Math.max(0, Math.min(15, vc.vol + (vc.envDir ? 1 : -1))); }
    }
    for (let i = 0; i < n; i++) {
      let l = 0, r = 0;
      for (let hw = 0; hw < 4; hw++) {
        const vc = v[hw];
        if (!vc.on || vc.vol === 0) continue;
        let smp = 0;
        if (hw < 2) {
          const f = 131072 / (2048 - vc.freq);
          this.phase[hw] = (this.phase[hw] + f / rate) % 1;
          smp = (DUTY[vc.duty][Math.floor(this.phase[hw] * 8)] * 2 - 1) * vc.vol / 15;
        } else if (hw === 2) {
          if (!vc.wave) continue;
          const f = 65536 / (2048 - vc.freq);
          this.phase[2] = (this.phase[2] + f / rate) % 1;
          const shift = vc.waveVol >= 0x10 ? 0 : vc.waveVol >= 8 ? 1 : 2;   // APPROX NR32 volume code
          smp = ((vc.wave[Math.floor(this.phase[2] * 32)] >> shift) / 15 * 2 - 1) * Math.min(1, vc.vol / 8);
        } else {
          const s = vc.nr43 >> 4, w7 = vc.nr43 & 8, d = vc.nr43 & 7;
          const f = 524288 / (d ? d : 0.5) / Math.pow(2, s + 1);
          this.noiseAcc += f / rate;
          while (this.noiseAcc >= 1) {
            this.noiseAcc -= 1;
            const bit = (this.lfsr ^ (this.lfsr >> 1)) & 1;
            this.lfsr = (this.lfsr >> 1) | (bit << 14);
            if (w7) this.lfsr = (this.lfsr & ~0x40) | (bit << 6);
          }
          smp = ((this.lfsr & 1) ? -1 : 1) * vc.vol / 15;
        }
        const pan = vc.pan;
        if (pan & (1 << hw) << 4) l += smp; if (pan & (1 << hw)) r += smp;
      }
      out[2 * i] = l * 0.2; out[2 * i + 1] = r * 0.2;
    }
  }
}
