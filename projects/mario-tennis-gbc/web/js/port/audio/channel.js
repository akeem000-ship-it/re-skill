// The sound driver's per-channel hardware side: starting notes, the envelopes, vibrato and volume slides that
// shape them, and the writes to the serviced channel's APU registers (bank 0, $3836-$3dd3: note_00.asm,
// tables_00.asm). Port of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm);
// the driver's model is in defs.js and its docs/sound_engine.md.
//
// All of these work on the serviced channel: its block in HRAM ($FFD0-$FFEF, P.V.snd*) and the per-pass globals in
// WRAM bank 7 (P.V.sndChannelType_7, sndRegBase, sndChannelBits ...). Several start with AbortIfChannelTriggered:
// when a sound effect already drives this APU channel this tick, they return without touching the hardware.
// Covered by the routine tests of UpdateSoundEngine (web/tests/port/routines_audio.mjs).
import {
  WAVE, NOISE, SQUARE1, NRx0, NRx1, NRx2, NRx3, NRx4, rAUD3ENA, rAUD3LEN, rAUD3LEVEL, rAUDENA, rAUD3WAVE_0,
  LOOP_SLOTS_PER_CHANNEL, swap,
} from "./defs.js";

// bank-0 tables of the driver
const NoiseNoteTable = 0x3836;          // 16 NR43 values for noise "notes" 0-$F
const NotePeriodTable = 0x3B1D;         // 2 x 12 periods: the top octave, and an alternative tuning (snd_tone_flag)
const SoundChannelMaskTable = 0x3B4D;   // 16 x 16: envelope step x volume -> NRx2 volume
const SoundPitchTable = 0x3C4D;         // 15 x 16: vibrato offsets, a row per depth, a column per frame
const WavePatternTable = 0x3DD4;        // pointers to sets of 16-byte wave patterns (by instrument high nibble)
const SoundEnvelopeTable = 0x3ED6;      // pointers to instrument envelopes (by instrument low nibble)

const u8 = (P, a) => P.bus.u8(a & 0xFFFF);
const u16 = (P, a) => u8(P, a) | u8(P, a + 1) << 8;
const isWave = P => P.V.sndChannelType_7 === WAVE;

// AbortIfChannelTriggered (00:3B12): true when the serviced channel's APU channel was already driven this tick by
// an earlier (effect) channel. The ROM drops its caller's frame; here the caller returns.
export function channelTriggered(P) {
  return (P.V.sndActiveMask & P.V.sndChannelBits) !== 0;
}

// WriteChannelReg (00:3A14): the serviced channel's register reg (NRx0..NRx4 as numbered for square 1)
export function writeChannelReg(P, reg, value) {
  P.bus.w8(0xFF00 + ((P.V.sndRegBase + reg) & 0xFF), value);
}
// ResetChannelLength (00:3A23): NRx1 keeps its duty bits, length 0 (as read back through the register's mask)
export function resetChannelLength(P) {
  const r = 0xFF00 + ((P.V.sndRegBase + NRx1) & 0xFF);
  P.bus.w8(r, P.bus.u8(r) & 0xC0);
}

// ApplyChannelEnvelope (00:39DF): write NRx2 = value, unless it holds that already. A released note (gate timer 0)
// with a volume plays at a quarter of it, plus one step. An NRx2 with no envelope period gets the "increase" bit
// (on hardware a zero period with bit 3 clear would switch the DAC's envelope off). A changed NRx2 needs a
// retrigger: NRx4 is written again with the note's value, and the length reset.
export function applyChannelEnvelope(P, value) {
  let b = value;
  if (b & 0xF0 && !P.V.sndRestFlag) {
    const rr = ((b >> 2) | (b << 6)) & 0xFF;              // rrca twice
    b = (b & 0x0F) | (((rr + 0x10) & 0xF0));
  }
  if (!(b & 0x07)) b |= 0x08;
  const r = 0xFF00 + ((P.V.sndRegBase + NRx2) & 0xFF);
  if (P.bus.u8(r) === b) return;
  P.bus.w8(r, b);
  writeChannelReg(P, NRx4, P.V.sndPeriodHi);
  resetChannelLength(P);
}

// ApplyChannelVolumeEnvelope (00:39D0): the volume at a note's start. The wave channel's volume is its NR32 as is;
// with an instrument envelope the envelope's first step; otherwise hSndVolume.
function applyChannelVolumeEnvelope(P) {
  if (isWave(P)) { writeChannelReg(P, NRx2, P.V.sndVolume); return; }
  if (P.V.sndEnvRate) { instrumentEnvelopeStep(P); return; }
  applyChannelEnvelope(P, P.V.sndVolume);
}

// SndSilenceChannel (00:3AFA): volume 0 (NRx2 = $08)
export function sndSilenceChannel(P) {
  if (channelTriggered(P)) return;
  applyChannelEnvelope(P, 0x00);
}
// SndReleaseChannel (00:3B02): the channel's script has ended: take it off the mix (NR51 shadow)
export function sndReleaseChannel(P) {
  if (channelTriggered(P)) return;
  P.V.sndPanShadow &= ~P.V.sndChannelBits & 0xFF;
}

// SndTriggerNote (00:3864): note byte `note`, length byte at `operand` (the script's next byte). Sets the note timer
// (shortened by the echo delay when an echo is on) and the gate timer, then starts the note on the APU channel.
// The low nibble of a pulse/wave note is the semitone (C..B; $C-$F: a rest or hold, SndTriggerNoteBody), the high
// nibble the octave (how many times the period is halved); a noise note is an NR43 value (< $10: from
// NoiseNoteTable; $1F: a rest).
export function sndTriggerNote(P, note, operand) {
  const { V } = P;
  let len;
  if (V.sndEchoCtrl & 0xF0) {
    const delay = V.sndEchoCtrl & 0x0F;
    V.sndEchoTimer = delay;
    len = (u8(P, operand) - delay) & 0xFF;
  } else len = u8(P, operand);
  V.sndNoteTimer = len;
  // the gate: a fixed number of ticks (offset >= 0), or the length plus a negative offset (at least 1)
  let gate = V.sndNoteOffset;
  if (gate & 0x80) {
    const sum = gate + len;
    gate = (sum & 0xFF) && sum > 0xFF ? sum & 0xFF : 1;
  }
  V.sndRestFlag = gate;
  let period;
  if (V.sndChannelType_7 === NOISE) {
    if (note === 0x1F) { sndTriggerNoteBody(P); return; }
    period = note < 0x10 ? u8(P, NoiseNoteTable + note) : note;
  } else {
    const semitone = note & 0x0F;
    if (semitone >= 0x0C) { sndTriggerNoteBody(P); return; }
    let e = semitone * 2;
    if (V.sndToneCtrl & 0x10) e += 0x18;
    let p = u16(P, NotePeriodTable + e);
    p >>= note >> 4;                                     // the octave
    period = (0x0800 - p) & 0xFFFF;                      // as the APU's period register counts
  }
  V.sndEnvPos = 0;
  if (channelTriggered(P)) return;
  if (isWave(P)) {
    // (a new wave pattern leaves the ROM's hl, which held the period, pointing past the pattern it copied: the
    // note is played at that "period")
    const hl = loadWavePatternIfChanged(P);
    if (hl !== null) period = hl;
    P.bus.w8(rAUD3ENA, 0x80);
  }
  applyChannelVolumeEnvelope(P);
  const lo = period & 0xFF, hi = period >> 8;
  if (V.sndChannelType_7 === SQUARE1) writeChannelReg(P, NRx0, V.sndWaveId);   // the sweep
  writeChannelReg(P, NRx3, lo);
  V.sndPeriodLo = lo < 0x02 ? 0x02 : lo >= 0xFE ? 0xFD : lo;   // room for the vibrato either way
  let nrx4;
  const type = V.sndChannelType_7;
  if (type === WAVE) {
    P.bus.w8(rAUD3LEN, 0);
    // the wave channel still playing: change its period without a restart (which would replay the wave from 0)
    nrx4 = P.bus.u8(rAUDENA) & 0x04 ? hi & 0x07 : (hi & 0x07) | 0x80;
  } else {
    if (type < WAVE) writeChannelReg(P, NRx1, (V.sndToneCtrl & 0xC0) | 0x3F);   // duty, shortest length
    nrx4 = (hi & 0x07) | 0x80;                           // trigger
  }
  nrx4 |= 0x20;                                          // (not a register bit: "a note is sounding")
  V.sndPeriodHi = nrx4;
  writeChannelReg(P, NRx4, nrx4);
  resetChannelLength(P);
  updatePanShadow(P);
}
// SndTriggerNote.checkSndChannelPanMask (00:3947): the channel's NR51 bits in the pan shadow from its pan mask
export function updatePanShadow(P) {
  const { V } = P, bits = V.sndChannelPanMask;
  V.sndPanShadow = (V.sndPanShadow & ~bits & 0xFF) | (V.sndPanMask & bits);
}

// SndTriggerNoteBody (00:3846): a rest or hold note. The gate closes at once. A pulse/noise channel with no note
// sounding is silenced; the wave channel with none is switched off.
function sndTriggerNoteBody(P) {
  const { V } = P;
  V.sndRestFlag = 0;
  if (!isWave(P)) {
    if (!(V.sndPeriodHi & 0x7F)) sndSilenceChannel(P);
    return;
  }
  if (V.sndPeriodHi & 0x7F) return;
  if (channelTriggered(P)) return;
  P.bus.w8(rAUD3ENA, 0);
}

// TickVolumeSlide (00:3968): every hSndVolSlideReload ticks, one step of the volume slide (up or down by one
// level, within 0..15), while steps are left. Only for a volume with no hardware envelope.
export function tickVolumeSlide(P) {
  const { V } = P;
  if (isWave(P)) return;
  if (!V.sndVolSlide) return;
  V.sndVolSlideTimer = (V.sndVolSlideTimer - 1) & 0xFF;
  if (V.sndVolSlideTimer) return;
  const vol = V.sndVolume;
  if (vol & 0x0F) return;
  const level = vol >> 4;
  V.sndVolSlideTimer = V.sndVolSlideReload;
  const steps = V.sndVolSlide;
  if (steps & 0x80) {                                    // down
    V.sndVolSlide = (steps + 1) & 0xFF;
    if (!level) return;
    V.sndVolume = (V.sndVolume - 0x10) & 0xFF;
  } else {                                               // up
    V.sndVolSlide = (steps - 1) & 0xFF;
    if (level === 0x0F) return;
    V.sndVolume = (V.sndVolume + 0x10) & 0xFF;
  }
  applyChannelEnvelope(P, V.sndVolume);
}

// TickVibrato (00:39A7): after the vibrato delay (hSndNoteLenTimer), NRx3 = the note's period + an offset from
// SoundPitchTable: the row is the depth (hSndChannelType high nibble - 1), the column the frame counter.
export function tickVibrato(P) {
  const { V } = P;
  if (channelTriggered(P)) return;
  if (V.sndChannelType_7 === NOISE) return;
  if (V.sndNoteLenTimer) return;
  const depth = V.sndChannelType & 0xF0;
  if (!depth) return;
  const e = (depth - 0x10) | (V.sndFrameCounter & 0x0F);
  writeChannelReg(P, NRx3, (V.sndPeriodLo + u8(P, SoundPitchTable + e)) & 0xFF);
}

// TickInstrumentEnvelope (00:3A40): a channel whose note has ended is silenced; otherwise, with an instrument
// envelope, the envelope's step for this tick.
export function tickInstrumentEnvelope(P) {
  const { V } = P;
  if (channelTriggered(P)) return;
  if (!(V.sndPeriodHi & 0x7F)) { sndSilenceChannel(P); return; }
  if (!isWave(P) && !V.sndEnvRate) return;
  instrumentEnvelopeStep(P);
}
// TickInstrumentEnvelope.eq02 (00:3A55): the envelope position as a fraction of its length in sixteenths (a 4-bit
// long division of hSndEnvPos by hSndEnvLength). The wave channel uses it for its output level directly. A pulse or
// noise channel looks up the step byte of its instrument's envelope row (hSndInstrument low nibble picks the table,
// hSndEnvRate the row, the fraction the column): its high nibble scales the volume through SoundChannelMaskTable,
// its low bits pick the NRx2 envelope (bit 3 the direction, bit 2: no hardware sweep, bit 1: half the sweep
// period, bit 0: write even when the direction is unchanged).
function instrumentEnvelopeStep(P) {
  const { V } = P;
  const len = V.sndEnvLength;
  if (!len) return;
  let a = V.sndEnvPos, frac = 0;
  for (let i = 0; i < 4; i++) {
    a = (a * 2) & 0xFF;
    const below = a < len;
    if (!below) a -= len;
    frac = ((frac << 1) | (below ? 0 : 1)) & 0xFF;
  }
  if (isWave(P)) {                                       // ResetChannelLength.loop (00:3A2F): NR32 output level
    const level = swap(((frac >> 1) + 2) & 0xFF);
    if (level < V.sndVolume) return;
    P.bus.w8(rAUD3LEVEL, level & 0x60);
    return;
  }
  const row = (V.sndEnvRate | frac) & 0xFF;
  const table = u16(P, SoundEnvelopeTable + ((V.sndInstrument & 0x0F) << 1));
  const step = u8(P, (table - 0x10 + row) & 0xFFFF);
  const index = (step & 0xF0) | swap(V.sndVolume);       // SoundChannelMaskTable: step x volume
  let sweep = 0;
  if (!(step & 0x04)) {
    // the hardware sweep period: the envelope length's high nibble, scaled up while the volume is low
    sweep = 1;
    const n = len >> 4;
    if (n) {
      sweep = n;
      if (!(index & 0x08)) {
        sweep <<= 1;
        if (!(index & 0x04)) {
          sweep <<= 1;
          if (!(index & 0x02)) sweep = 0;
        }
      }
      if (sweep >= 0x08) sweep = 0;
    }
  }
  if (step & 0x02) sweep >>= 1;
  const env = (step & 0x08) | sweep;
  if (!(step & 0x01)) {
    // only when the envelope direction changes
    const nrx2 = P.bus.u8(0xFF00 + ((P.V.sndRegBase + NRx2) & 0xFF));
    if ((step & 0x08) === (nrx2 & 0x08)) return;
  }
  applyChannelEnvelope(P, u8(P, SoundChannelMaskTable + index) | env);
}

// LoadWavePatternIfChanged (00:3D3D): load the channel's wave pattern into wave RAM unless it is loaded already
// (the wave channel off meanwhile). Returns null, or the address after the pattern (the ROM's hl).
export function loadWavePatternIfChanged(P) {
  const id = P.V.sndWaveId;
  if (id === P.V.sndLoadedWaveId) return null;
  P.V.sndLoadedWaveId = id;
  P.bus.w8(rAUD3ENA, 0);
  return loadWavePattern(P, swap(id));
}
// LoadWavePattern (00:3D4E): 16 bytes to wave RAM, from the pattern set of hSndInstrument's high nibble, at
// offset (the pattern id with its nibbles swapped: id * 16 for ids below 16). Returns the address after it.
export function loadWavePattern(P, offset) {
  const set = u16(P, WavePatternTable + ((P.V.sndInstrument >> 4) << 1));
  const src = set + offset;
  for (let i = 0; i < 16; i++) P.bus.w8(rAUD3WAVE_0 + i, u8(P, src + i));
  return (src + 16) & 0xFFFF;
}

// GetChannelLoopSlot (00:3D6F): the address of loop slot (operand's low nibble) of the serviced channel
export function getChannelLoopSlot(P, operand) {
  const off = ((P.V.sndChannelIndex * LOOP_SLOTS_PER_CHANNEL) + (operand & 0x0F) * 3) & 0xFF;
  return P.A.sndLoopSlots + off;
}

// ScaleEchoVolume (00:3D89): the echo: keep the volume in hSndEcho's high nibble, and play at volume
// (volume + 1) * (echo factor + 1) / 16 (at least 1; the nibbles of the result are swapped into place, so 16
// comes out as an envelope bit)
export function scaleEchoVolume(P) {
  const { V } = P;
  const factor = (V.sndEcho & 0x0F) + 1, level = (V.sndVolume >> 4) + 1;
  let c = ((factor * level) >> 4) & 0xFF;
  if (!c) c = 1;
  c = swap(c);
  const vol = V.sndVolume;
  V.sndEcho = (vol & 0xF0) | (V.sndEcho & 0x0F);
  V.sndVolume = (vol & 0x0F) | c;
}
