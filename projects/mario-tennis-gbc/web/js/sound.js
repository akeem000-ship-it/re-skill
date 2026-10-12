// Sound: port of the game's sequence driver (REVERSE.md "Sound driver") plus a small Game Boy APU
// model. Pure JS (no WebAudio here) so Node tests can run it; audio.js wraps it in an AudioWorklet.
// The driver only ever touches the hardware at a few points (note-on 00:38E5, SeqWriteVolume 00:39DF,
// the vibrato 00:39A7, the pan update 00:3947, the end-of-sequence 00:3B02); between those the
// hardware envelope / sweep run on their own, which the APU model reproduces. Not modelled: the
// portamento command ($AA, unused by the music tested).

const PERIODS = 0x3B1D, NOISE_TAB = 0x3836, VIB = 0x3C4D, PROD = 0x3B4D, WAVESETS = 0x3DD4, ENVSETS = 0x3ED6;
const MUSIC_INDEX = 0x3151, SFX_INDEX = 0x31B5, REMAP = 0x2FE0;

export class Sequencer {
  constructor(romBytes) {
    this.b = romBytes;
    this.ch = [];                       // 6 driver slots: 0,1 SFX; 2-5 music
    for (let i = 0; i < 6; i++) this.ch.push(this.newChannel());
    this.tick = 0; this.counter2 = 0; this.nr50 = 0x77; this.music = 0;
    this.events = [];                   // note events for tests: {t, slot, hw, note, dur, vol, idx}
    this.voices = [0, 1, 2, 3].map(() => this.newVoice());
  }
  u8(a) { return this.b[a]; }
  u16(a) { return this.b[a] | this.b[a + 1] << 8; }
  rom(bank, addr) { return bank * 0x4000 + (addr - 0x4000); }
  // one hardware channel as the driver leaves it: NRx1 duty, NRx2 (nrx2), NRx3/4 (freq), NR51 bits (pan)
  newVoice() {
    return { on: false, pan: 0, freq: 0, duty: 2, nrx2: -1, vol: 0, envPeriod: 0, envDir: false, envTimer: 0,
      trigger: false, wave: null, waveId: -1, nr32: 0, nr43: 0, sweep: 0, owner: -1 };
  }
  // one driver slot (the 32-byte state block WRAM7:D100 + 32 * slot, swapped into HRAM FFD0-FFEF)
  newChannel() {
    return { active: false, started: false, bank: 0, base: 0, idx: 0, hw: 0,
      vol: 0, volLow: 0,                // hSeqVolume FFD8: volume nibble and the default NRx2 period/direction nibble
      duty: 0, frac: 0, acc: 0, ticksLeft: 0, gate: 0xFF, gateCount: 0, c1: 0,
      envShape: 0, envLen: 0, envElapsed: 0,          // FFDD shape (<<4 in the ROM), FFDE length (wave: decay length), FFDF
      fadeSteps: 0, fadeRate: 0, fadeCount: 0,        // FFE0 FFE1 FFE2
      freq: 0, vibBase: 0, nrx4: 0,                   // 11-bit frequency, FFE3 (clamped low byte), FFE4 (last NRx4 value)
      pan: 0xFF, vibDepth: 0, vibDelay: 0, vibDelayCount: 0, instr: 0, callRepeat: 0, callReturn: 0, callRemaining: 0,
      loops: [], alt: false, sweep: 0, waveId: 0xFF, noise: 0, note: -1, waitOnly: false };
  }

  // SoundStart 00:3297. Music (id < $50) stops the 4 music slots first; an SFX resets both SFX
  // slots (and their loop slots) first, $50 alone just does that. $40-$44 are remapped (00:2FE0).
  start(id) {
    if (id === 0) { this.stopAll(); return; }
    if (id >= 0x40 && id <= 0x4F) id = this.u8(REMAP + (id - 0x40));
    const music = id < 0x50;
    if (music) { for (let i = 2; i < 6; i++) this.ch[i] = this.newChannel(); this.music = id; }
    else { this.ch[0] = this.newChannel(); this.ch[1] = this.newChannel(); if (id === 0x50) return; }
    const e = music ? MUSIC_INDEX + 2 * (id - 1) : SFX_INDEX + 2 * (id - 0x51);
    const bank = 0x70 | (this.u8(e) & 0x0F), nch = this.u8(e) >> 4, row = this.u8(e + 1);
    for (let i = 0; i < nch; i++) {
      const r = this.rom(bank, 0x4000) + (row + i) * 4;
      const slot = this.u8(r) >> 5, hw = this.u8(r + 1) & 3, ptr = this.u16(r + 2);
      const old = this.ch[slot];
      if (old.active) this.voices[old.hw].pan = 0;         // SoundChannelInit 00:3322: silence the replaced channel's output
      const c = this.newChannel();
      c.active = true; c.bank = bank; c.base = this.rom(bank, ptr); c.hw = hw; c.idx = 0;
      this.ch[slot] = c;
    }
  }
  musicPlaying() { return this.ch.slice(2).some(c => c.active); }
  stopAll() { this.music = 0; for (let i = 0; i < 6; i++) this.ch[i] = this.newChannel(); this.voices = this.voices.map(() => this.newVoice()); }

  // SoundDriverTick 00:3373: SFX slots first, then music; the first active slot on a hardware
  // channel claims it (wSndClaimed), the others run silently (their writes are skipped, 00:3B12)
  step() {
    this.tick++;
    const claimed = [false, false, false, false];
    for (let s = 0; s < 6; s++) {
      const c = this.ch[s];
      if (!c.active) continue;
      if (claimed[c.hw]) { this.channelTick(c, s, true); continue; }
      claimed[c.hw] = true;
      this.channelTick(c, s, false);
    }
    for (let hw = 0; hw < 4; hw++) if (!claimed[hw]) this.voices[hw].pan = 0;   // nothing drives the channel any more
  }

  channelTick(c, s, muted) {
    const v = this.voices[c.hw];
    if (!c.started) {                    // header (00:34DD): [tempo frac, duty | wave decay, volume, sweep | wave id]
      const h = c.base;
      c.frac = this.u8(h) & 15; c.acc = c.frac;
      if (c.hw === 2) { c.envLen = this.u8(h + 1); c.waveId = this.u8(h + 3); if (!muted) this.loadWave(c, v); }
      else { c.duty = this.u8(h + 1) & 3; c.sweep = this.u8(h + 3); }
      c.vol = this.u8(h + 2) & 15; c.volLow = this.u8(h + 2) >> 4;
      c.started = true; c.idx = 2; c.vibDelayCount = c.vibDelay;
      this.runCommands(c, s, muted);
      return;
    }
    // vibrato (00:39A7): low frequency byte = clamped base + table 3C4D[depth][tick & 15]
    if (!muted && c.hw !== 3 && c.vibDelayCount === 0 && c.vibDepth) {
      const d = this.u8(VIB + ((c.vibDepth - 1) << 4 | (this.tick & 15)));
      v.freq = (c.freq & 0x700) | ((c.vibBase + d) & 0xFF);
    }
    this.envelopeTick(c, s, muted, false);            // 00:3A40
    c.envElapsed = Math.min(c.envElapsed + 1, c.envLen);   // 00:33E9
    // tempo fraction (00:33F5): skip n/16 of the ticks
    c.acc += c.frac;
    if (c.acc >= 16) { c.acc -= 16; return; }
    this.fadeTick(c, s, muted);                       // 00:3968
    if (c.vibDelayCount > 0) c.vibDelayCount--;
    if (c.ticksLeft === 0) { c.vibDelayCount = c.vibDelay; this.runCommands(c, s, muted); return; }   // 00:342F
    c.ticksLeft--;
    if (c.gateCount > 0) c.gateCount--;
    if (c.ticksLeft === 0) { c.vibDelayCount = c.vibDelay; this.runCommands(c, s, muted); }
  }

  // SeqEnvelopeTick 00:3A40 (atNoteOn: the 00:39D0 entry at 3A55, used when a note starts with an
  // envelope shape set). Wave channel: NR32 steps 100% -> 50% -> 25% -> off over the decay length
  // once the step code reaches the header volume byte (00:3A2F). Pulse/noise: byte = level << 4 |
  // flags from the envelope set 3ED6[instrument][shape][phase]; bit0 write this phase, bit1 halve
  // the period, bit2 no period, bit3 direction up; the period comes from the length's high nibble,
  // scaled down by the volume bits (00:3AA6-3AC4); the write goes through SeqWriteVolume.
  envelopeTick(c, s, muted, atNoteOn) {
    if (muted) return;
    const v = this.voices[c.hw];
    if (!atNoteOn) {
      if ((c.nrx4 & 0x7F) === 0) { this.writeVolume(c, s, 0); return; }
      if (c.hw !== 2 && !c.envShape) return;
    }
    if (!c.envLen) return;
    const phase = Math.min(15, Math.floor(16 * c.envElapsed / c.envLen));
    const d8 = (c.volLow << 4) | c.vol;                 // hSeqVolume byte
    if (c.hw === 2) {
      const a = (((phase >> 1) + 2) << 4) & 0xFF;
      if (a < d8) return;
      v.nr32 = a & 0x60; v.owner = s;
      return;
    }
    const set = this.u16(ENVSETS + 2 * (c.instr & 15));
    const H = this.u8(set - 16 + ((c.envShape << 4) | phase)), E = (H & 0xF0) | d8;
    let B = 0;
    if (!(H & 4)) {
      B = 1;
      const a = (c.envLen >> 4) & 15;
      if (a) {
        B = a;
        if (!(E & 8)) { B <<= 1; if (!(E & 4)) { B <<= 1; if (!(E & 2)) B = 0; } }
        if (B >= 8) B = 0;
      }
    }
    if ((H & 2) && B) B >>= 1;
    B |= H & 8;
    const byte = this.u8(PROD + E) | B;
    if (H & 1) this.writeVolume(c, s, byte);
    else if (((v.nrx2 < 0 ? 0 : v.nrx2) & 8) !== (H & 8)) this.writeVolume(c, s, byte);
  }

  // SeqWriteVolume 00:39DF: NRx2 = byte, quieter ((vol >> 2) + 1) once the gate expired; a zero
  // period gets the "up" bit so the DAC stays on; nothing happens when the register already holds
  // the value, else the channel is retriggered with the note's NRx4 (wave: NR32, and NR34 only
  // retriggers when the note said so).
  writeVolume(c, s, a) {
    let b = a;
    if ((a & 0xF0) && c.gateCount === 0) b = (((((a & 3) << 6) | (a >> 2)) + 0x10) & 0xF0) | (a & 0x0F);
    if ((b & 7) === 0) b |= 8;
    const v = this.voices[c.hw];
    if (v.nrx2 === b) return;
    v.nrx2 = b; v.owner = s;
    if (c.hw === 2) v.nr32 = b;
    else { v.vol = b >> 4; v.envDir = !!(b & 8); v.envPeriod = b & 7; v.envTimer = 0; }
    if (c.nrx4 & 0x80) this.triggerVoice(c, v);
  }
  triggerVoice(c, v) {
    v.on = true; v.trigger = true; v.envTimer = 0;
    if (c.hw !== 2) v.vol = v.nrx2 >> 4;
    if (c.hw === 0) v.sweep = c.sweep;
  }
  // SeqLoadWave 00:3D3D / the $A1 and header loads: copy the 16 bytes (wave set by the instrument's
  // high nibble) with the DAC off; the channel stays off until a note triggers it again
  loadWave(c, v) {
    if (v.waveId === c.waveId) return;
    const set = this.u16(WAVESETS + 2 * (c.instr >> 4)), p = set + c.waveId * 16, w = [];
    for (let i = 0; i < 16; i++) { w.push(this.u8(p + i) >> 4); w.push(this.u8(p + i) & 15); }
    v.wave = w; v.waveId = c.waveId; v.on = false;
  }
  // SeqFadeTick 00:3968: every rate ticks one volume step (not while the default NRx2 nibble is set)
  fadeTick(c, s, muted) {
    if (c.hw === 2 || !c.fadeSteps) return;
    if (--c.fadeCount !== 0) return;
    if (c.volLow !== 0) return;
    c.fadeCount = c.fadeRate;
    if (c.fadeSteps < 0) { c.fadeSteps++; if (c.vol === 0) return; c.vol--; }
    else { c.fadeSteps--; if (c.vol === 15) return; c.vol++; }
    if (!muted) this.writeVolume(c, s, (c.volLow << 4) | c.vol);
  }

  loopSlot(c, n) { return c.loops[n & 15] || (c.loops[n & 15] = { count: 0, idx: 0 }); }

  // SeqNextByte 00:3566: read 2-byte commands until a note or wait
  runCommands(c, s, muted) {
    const v = this.voices[c.hw];
    for (let guard = 0; guard < 500; guard++) {
      const p = c.base + 2 * c.idx, op = this.u8(p), arg = this.u8(p + 1);
      c.idx++;
      if (op < 0xA0) { this.note(c, s, muted, op, arg); return; }
      if (op === 0xFF) {                 // end: the slot goes inactive, its output bits in NR51 are cleared (00:3B02)
        c.active = false; c.idx = 0xFFFF;
        if (!muted) { v.pan = 0; if (c.hw === 2 && s < 2) v.waveId = -1; }   // an SFX on the wave channel: the music reloads its wave
        return;
      }
      if (op === 0xFD) { const L = this.loopSlot(c, arg); L.count = 0; L.idx = c.idx; continue; }
      if (op >= 0xF0) continue;
      if (op >= 0xD0) {                  // fades: Dn up, En down, one step every arg ticks (not on the wave channel)
        const n = op & 15;
        if (c.hw !== 2) { c.fadeSteps = op >= 0xE0 ? -n : n; c.fadeRate = c.fadeCount = arg; }
        continue;
      }
      if (op >= 0xC0) {                  // envelope shape/length: pulse and noise only, and only with a zero NRx2 nibble
        if (c.hw !== 2 && c.volLow === 0) { c.envShape = op & 15; c.envLen = arg; }
        continue;
      }
      if (op >= 0xB0) {
        if (op === 0xB0) { if ((arg & 0xF0) === 0xF0) c.idx = this.loopSlot(c, arg).idx; continue; }
        const L = this.loopSlot(c, arg); L.count++;
        if (L.count < (op & 15) + 1) c.idx = L.idx;
        continue;
      }
      switch (op) {
        case 0xA0: c.vol = arg & 15; c.volLow = arg >> 4; if (!muted) this.writeVolume(c, s, (c.volLow << 4) | c.vol); break;
        case 0xA1: if (c.hw === 2) { c.waveId = arg; if (!muted) this.loadWave(c, v); } else c.sweep = arg; break;
        case 0xA2: if (c.hw === 2) c.envLen = arg; else c.duty = arg & 3; break;
        case 0xA3:
          if (arg === 0xFE) c.vibDepth = 0;
          else { c.vibDelay = c.vibDelayCount = (arg & 15) * 2; c.vibDepth = ((arg + 0x10) & 0xF0) >> 4; }
          break;
        case 0xA4: c.gate = arg; break;
        case 0xA5: c.pan = arg === 1 ? ((c.pan << 4) | (c.pan >> 4)) & 0xFF : arg; break;
        case 0xA6: this.nr50 = arg; break;
        case 0xA7: c.ticksLeft = arg; c.waitOnly = true; if (!muted) { v.pan = c.pan; v.owner = s; } return;   // 00:3947
        case 0xA8: c.instr = arg; break;
        case 0xA9:                       // counters and the computed jump: the word at [counter] is the new index
          if (arg === 0xF0) c.c1++; else if (arg === 0xF1) c.c1--; else if (arg === 0xF2) this.counter2++; else if (arg === 0xF3) this.counter2--;
          else if (arg === 0xFE || arg === 0xFF) { const k = arg === 0xFF ? c.c1 : this.counter2; c.idx = this.u16(c.base + 2 * c.idx + 2 * k); }
          else if (arg < 0x80) c.c1 = arg; else this.counter2 = arg - 0x80;
          break;
        case 0xAA: break;                                 // portamento: not modelled
        case 0xAC: {                     // call (arg = repeat count, then a byte offset); $AD returns to the call itself
          const target = this.u16(c.base + 2 * c.idx); c.idx++;
          if (c.callRepeat === 0) c.callRepeat = arg;
          c.callRepeat--;
          c.callReturn = c.idx - 2; c.callRemaining = c.callRepeat;
          c.idx = target >> 1;
          break;
        }
        case 0xAD: c.idx = c.callRemaining > 0 ? c.callReturn : c.callReturn + 2; break;
        case 0xAE: c.alt = !!(arg & 0x10); break;
        case 0xAF: c.frac = arg & 15; break;
        default: break;
      }
    }
  }

  // SeqNote 00:3864: note nn (octave << 4 | semitone, $1F rest, noise: table index or raw NR43) for
  // dur ticks. A rest, and semitones >= 12, only expire the gate (the sound keeps ringing until the
  // next volume write). Note-on (00:38E5): wave load, volume (envelope entry or plain write), sweep,
  // frequency, duty, NRx4 trigger (the wave channel is not retriggered while it is still sounding,
  // 00:395D), pan.
  note(c, s, muted, nn, dur) {
    c.ticksLeft = dur; c.waitOnly = false; c.note = nn;
    if (c.gate & 0x80) { const sum = c.gate + dur; c.gateCount = sum >= 256 && (sum & 0xFF) ? sum & 0xFF : 1; }
    else c.gateCount = c.gate;
    this.events.push({ t: this.tick, slot: s, hw: c.hw, note: nn, dur, vol: c.vol, idx: c.idx - 1 });
    let lo, hi;
    if (nn === 0x1F) { c.gateCount = 0; return; }
    if (c.hw === 3) { lo = nn < 0x10 ? this.u8(NOISE_TAB + nn) : nn; hi = 0; }
    else {
      const semi = nn & 15;
      if (semi >= 12) { c.gateCount = 0; return; }
      let period = this.u16(PERIODS + 2 * (semi + (c.alt ? 12 : 0)));
      period >>= nn >> 4;
      const f = (0x800 - period) & 0x7FF;
      lo = f & 0xFF; hi = f >> 8;
    }
    c.envElapsed = 0;
    if (muted) return;                   // 00:3B12: a claimed channel skips the whole note-on
    const v = this.voices[c.hw];
    v.owner = s;
    if (c.hw === 2) this.loadWave(c, v);
    const d8 = (c.volLow << 4) | c.vol;
    if (c.hw === 2) v.nr32 = d8;
    else if (c.envShape) this.envelopeTick(c, s, false, true);
    else this.writeVolume(c, s, d8);
    if (c.hw === 0) v.sweep = c.sweep;
    c.vibBase = Math.max(2, Math.min(0xFD, lo));
    if (c.hw === 3) { c.noise = lo; v.nr43 = lo; c.nrx4 = 0xA0; }
    else { c.freq = (hi << 8) | lo; v.freq = c.freq; }
    if (c.hw < 2) { v.duty = c.duty; c.nrx4 = (hi & 7) | 0xA0; }
    if (c.hw === 2) c.nrx4 = (hi & 7) | (v.on ? 0x20 : 0xA0);
    if (c.nrx4 & 0x80) this.triggerVoice(c, v);
    v.pan = c.pan;
  }
}

// --- Game Boy APU model (pulse x2, wave, noise) rendering one driver tick (1/60 s) ---
const DUTY = [[0,0,0,0,0,0,0,1], [1,0,0,0,0,0,0,1], [1,0,0,0,0,1,1,1], [0,1,1,1,1,1,1,0]];
const WAVE_SHIFT = [4, 0, 1, 2];      // NR32 volume code: off, 100%, 50%, 25%
export class Apu {
  constructor(sampleRate = 44100) {
    this.rate = sampleRate; this.phase = [0, 0, 0, 0]; this.lfsr = 0x7FFF; this.noiseAcc = 0;
    this.sweep = { shadow: 0, timer: 0, on: false, acc: 0 };
  }
  // render n stereo samples from the sequencer voices into out (Float32 interleaved L R)
  render(seq, out, n) {
    const v = seq.voices, rate = this.rate, sw = this.sweep;
    for (let hw = 0; hw < 4; hw++) {
      const vc = v[hw];
      if (vc.trigger) {                  // NRx4 bit 7: restart envelope / sweep / noise LFSR / wave position
        vc.trigger = false;
        if (hw === 3) this.lfsr = 0x7FFF;
        if (hw === 2) this.phase[2] = 0;
        if (hw === 0) {
          const pace = (vc.sweep >> 4) & 7, shift = vc.sweep & 7;
          sw.shadow = vc.freq; sw.timer = pace || 8; sw.on = !!(pace || shift); sw.acc = 0;
          if (shift && this.sweepNext(vc) > 2047) vc.on = false;
        }
      }
      // hardware envelope: one step per period/64 s, stops at 0 / 15
      if (hw !== 2 && vc.on && vc.envPeriod) {
        vc.envTimer += n / rate * 64;
        while (vc.envTimer >= vc.envPeriod) { vc.envTimer -= vc.envPeriod; vc.vol = Math.max(0, Math.min(15, vc.vol + (vc.envDir ? 1 : -1))); }
      }
    }
    // frequency sweep of pulse 1 (NR10): every pace/128 s, freq +- freq >> shift; overflow turns the channel off
    const p1 = v[0];
    if (p1.on && sw.on && ((p1.sweep >> 4) & 7)) {
      sw.acc += n / rate * 128;
      while (sw.acc >= 1) {
        sw.acc -= 1;
        if (--sw.timer <= 0) {
          sw.timer = (p1.sweep >> 4) & 7;
          const nf = this.sweepNext(p1);
          if (nf > 2047) { p1.on = false; break; }
          if (p1.sweep & 7) { sw.shadow = nf; p1.freq = nf; if (this.sweepNext(p1) > 2047) { p1.on = false; break; } }
        }
      }
    }
    for (let i = 0; i < n; i++) {
      let l = 0, r = 0;
      for (let hw = 0; hw < 4; hw++) {
        const vc = v[hw];
        if (!vc.on || !vc.pan) continue;
        let smp = 0;
        if (hw < 2) {
          if (vc.vol === 0) continue;
          const f = 131072 / (2048 - vc.freq);
          this.phase[hw] = (this.phase[hw] + f / rate) % 1;
          smp = (DUTY[vc.duty][Math.floor(this.phase[hw] * 8)] * 2 - 1) * vc.vol / 15;
        } else if (hw === 2) {
          const shift = WAVE_SHIFT[(vc.nr32 >> 5) & 3];
          if (!vc.wave || shift === 4) continue;
          const f = 65536 / (2048 - vc.freq);
          this.phase[2] = (this.phase[2] + f / rate) % 1;
          smp = (vc.wave[Math.floor(this.phase[2] * 32)] >> shift) / 15 * 2 - 1;
        } else {
          if (vc.vol === 0) continue;
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
  sweepNext(vc) {
    const shift = vc.sweep & 7, d = this.sweep.shadow >> shift;
    return vc.sweep & 8 ? this.sweep.shadow - d : this.sweep.shadow + d;
  }
}
