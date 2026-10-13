// The sound driver's tick and its set-up (bank 0, sound_00.asm; UpdateSoundEngine is in view_00.asm): the per-tick
// pass over the six channels, the start of a channel's track, the channel update requests, InitAudioEngine.
// Port of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm); the driver's model is
// in defs.js and its docs/sound_engine.md.
// Tests: web/tests/port/routines_audio.mjs (UpdateSoundEngine from match and menu states, with forced commands),
// and the lockstep, whose recordings play music and effects all along.
import {
  WAVE, WRAM_SOUND, CHANNELS, CHANNEL_SIZE, MUSIC_CHANNEL, HRAM_WINDOW, CH, rAUD3ENA, rAUDENA, rAUDTERM, rAUDVOL,
  swap, scriptPtr, dataPtr, copyBytes, setWramBank, setRomBank, setRegs,
} from "./defs.js";
import {
  tickVibrato, tickInstrumentEnvelope, tickVolumeSlide, scaleEchoVolume, applyChannelEnvelope, loadWavePattern,
} from "./channel.js";
import { runSoundChannelScript } from "./script.js";

// UpdateSoundEngine (00:2F1A): one tick of the driver (from the VBlank handler; from the timer handler while the
// LCD is off), unless one is running already (hSoundEngineBusy: the timer interrupt can come during VBlank's).
// Leaves a = 0 and the registers RunSoundEngine leaves; when busy, a = hSoundEngineBusy, hl = its address.
export function updateSoundEngine(P) {
  const busy = P.V.soundEngineBusy;
  if (busy) return { a: busy, f: 0x00, h: 0xFF, l: 0xD2 };
  P.V.soundEngineBusy = 1;
  const saved = P.V.wramBank;                            // push hWramBank ... pop_wram_bank
  const r = runSoundEngine(P);
  setWramBank(P, saved);
  P.V.soundEngineBusy = 0;
  return { ...r, a: 0, f: 0x80 };
}

// RunSoundEngine (00:3373): with WRAM bank 7 mapped, save the HRAM window $FFD0-$FFEF to wSndHramSave, run the
// channels, restore it. Leaves the registers of its last copy (CopyMemoryFast) and b from the update request.
export function runSoundEngine(P) {
  setWramBank(P, WRAM_SOUND);
  const save = P.A.sndHramSave, n = 0x20;
  copyBytes(P, HRAM_WINDOW, save, n);
  const b = updateSoundChannels(P);
  copyBytes(P, save, HRAM_WINDOW, n);
  return { a: P.bus.u8(save + n - 1), b, c: 0, d: 0xFF, e: 0xF0, h: (save + n) >> 8, l: (save + n) & 0xFF };
}

// UpdateSoundChannels (00:3392): the per-tick pass. For each channel with a track (in order: the effect channels
// first), its block is brought into HRAM, the track's bank mapped, the APU channel's globals set (register base,
// NR51 bits); then the channel's tick runs, and the block goes back. Afterwards NR51 = the pan shadow, limited to the
// APU channels driven this tick. Returns b as ApplyChannelUpdateRequest leaves it.
export function updateSoundChannels(P) {
  const { V } = P;
  const savedRomBank = V.romBank;
  V.sndChannelIndex = V.sndFirstChannel;
  V.sndActiveMask = 0;
  V.sndFrameCounter = (V.sndFrameCounter + 1) & 0xFF;
  let block = P.A.sndChannels;
  do {
    if ((P.bus.u8(block) & P.bus.u8(block + 1)) !== 0xFF) {   // script pointer $FFFF: idle
      copyBytes(P, block, HRAM_WINDOW, CHANNEL_SIZE);
      setRomBank(P, V.sndDataBank);
      const type = V.sndChannelType & 0x03;
      V.sndChannelType_7 = type;
      V.sndRegBase = type * 5;                                  // NR1x, NR2x, NR3x, NR4x
      const bits = 0x11 << type;                                // its NR51 bits (right and left)
      V.sndChannelBits = bits;
      V.sndChannelPanMask = bits;
      if (scriptPtr(P) === 0) startChannelTrack(P);
      else channelTick(P);
      reloadMusicWave(P);
      V.sndActiveMask |= V.sndChannelBits;
      copyBytes(P, HRAM_WINDOW, block, CHANNEL_SIZE);
    }
    block += CHANNEL_SIZE;
    V.sndChannelIndex = (V.sndChannelIndex + 1) & 0xFF;
  } while (V.sndChannelIndex < CHANNELS);
  V.sndPanShadow &= V.sndActiveMask;
  P.bus.w8(rAUDTERM, V.sndPanShadow);
  setRomBank(P, savedRomBank);
  return applyChannelUpdateRequest(P, V.sndActiveMask);
}

// One tick of a playing channel (UpdateSoundChannels from $33E3): vibrato, instrument envelope, then — unless the
// tick-rate accumulator says to skip this tick — the volume slide, the vibrato delay, and the note timer. When the
// note is over, the script runs to its next note. With an echo, a note's last ticks (the echo delay) play it again
// at the echo's volume, and the next note comes when they are over.
function channelTick(P) {
  const { V } = P;
  tickVibrato(P);
  tickInstrumentEnvelope(P);
  const pos = (V.sndEnvPos + 1) & 0xFF, envLen = V.sndEnvLength;
  V.sndEnvPos = pos < envLen ? pos : envLen;
  const acc = ((V.sndToneCtrl & 0x0F) + V.sndLengthAccum) & 0xFF;
  if (acc >= 0x10) { V.sndLengthAccum = acc - 0x10; return; }   // this tick skipped
  V.sndLengthAccum = acc;
  tickVolumeSlide(P);
  if (V.sndNoteLenTimer) V.sndNoteLenTimer = V.sndNoteLenTimer - 1;
  const timer = V.sndNoteTimer;
  if (timer) {
    V.sndNoteTimer = timer - 1;
    if (V.sndRestFlag) V.sndRestFlag = V.sndRestFlag - 1;     // the gate
    if (timer - 1) return;
    if (V.sndEchoCtrl & 0xF0) return;                         // the echo's ticks come first
    nextNote(P);
    return;
  }
  if (V.sndEchoCtrl & 0xF0) {
    const left = (V.sndEchoTimer - 1) & 0xFF;
    V.sndEchoTimer = left;
    if (left) {
      // the echo starts: the note again, softer
      if (((V.sndEchoCtrl & 0x0F) - 1 & 0xFF) !== left) return;
      scaleEchoVolume(P);
      applyChannelEnvelope(P, V.sndVolume);
      return;
    }
    V.sndVolume = (V.sndEcho & 0xF0) | (V.sndVolume & 0x0F);  // the echo is over: the volume back
  }
  nextNote(P);
}
// UpdateSoundChannels.loop2 (00:342F): mark the channel for a pending update request, reload the vibrato delay,
// and run the script to the next note
function nextNote(P) {
  markCurrentChannelUpdated(P);
  runScript(P);
}
// .loop3 (00:3432)
function runScript(P) {
  P.V.sndNoteLenTimer = P.V.sndNoteLenReload;
  runSoundChannelScript(P);
}

// UpdateSoundChannels.zero2 (00:34DD): a channel's first tick reads its track's 4-byte header: tick rate, duty
// (the wave channel: envelope length), volume, and sweep / wave pattern. The wave channel's pattern is loaded now
// (the channel off). Then the commands from index 2 run to the first note.
function startChannelTrack(P) {
  const { V } = P;
  let hl = dataPtr(P);
  const rd = () => { const v = P.bus.u8(hl); hl = (hl + 1) & 0xFFFF; return v; };
  const rate = rd() & 0x0F;
  V.sndLengthAccum = rate;
  const wave = V.sndChannelType_7 === WAVE;
  if (!wave) {
    const duty = rd();
    V.sndToneCtrl = ((((duty >> 2) | (duty << 6)) & 0xC0)) | rate;
  } else {
    V.sndEnvLength = rd();
    V.sndToneCtrl = rate;
  }
  V.sndVolume = swap(rd());
  if (!wave) V.sndWaveId = rd();
  else {
    P.bus.w8(rAUD3ENA, 0);
    let id = V.sndWaveId;
    if (id === 0xFF) { id = P.bus.u8(hl); V.sndWaveId = id; }  // no pattern set yet: the header's
    V.sndLoadedWaveId = id;
    loadWavePattern(P, swap(id));
  }
  V.sndNoteOffset = 0xFF;
  V.sndTranspose = 0;
  V.sndEnvRate = 0;
  V.sndVolSlide = 0;
  P.bus.w8(HRAM_WINDOW + CH.scriptPtr + 1, 0);
  V.sndPanMask = 0xFF;
  P.bus.w8(HRAM_WINDOW + CH.scriptPtr, 0x02);
  runScript(P);
}

// UpdateSoundChannels.checkSndWaveReloadPending (00:3464): after an effect used the wave channel (its snd_end set
// wSndWaveReloadPending), the first music channel on it with the APU channel free gets its own pattern back
function reloadMusicWave(P) {
  const { V } = P;
  if (!V.sndWaveReloadPending) return;
  if (V.sndChannelType_7 !== WAVE) return;
  if (V.sndChannelIndex < MUSIC_CHANNEL) return;
  if (V.sndActiveMask & V.sndChannelBits) return;
  const id = V.sndWaveId;
  if (id === V.sndLoadedWaveId) return;
  V.sndLoadedWaveId = id;
  V.sndWaveReloadPending = 0;
  P.bus.w8(rAUD3ENA, 0);
  loadWavePattern(P, swap(id));
  P.bus.w8(rAUD3ENA, 0x80);
}

// ---- channel update requests: set the tick rate (hSndToneCtrl low nibble) of a set of channels, applied once
// every one of them has finished a note (nothing in the game makes a request but InitAudioEngine's clear) ----

// SetChannelUpdateRequest (00:30B4): b = channel mask, c = the new value (in the WRAM bank mapped: 7 at its call)
export function setChannelUpdateRequest(P, mask, data) {
  P.bus.w8(P.A.sndUpdateReqMask, mask);
  P.bus.w8(P.A.sndUpdateReqData, data);
  P.bus.w8(P.A.sndUpdateReqAck, 0);
}
// MarkCurrentChannelUpdated (00:30C1)
function markCurrentChannelUpdated(P) {
  const i = P.V.sndChannelIndex;
  P.V.sndUpdateReqAck |= i < 8 ? 1 << i : 0;
}
// ApplyChannelUpdateRequest (00:30D7): when every requested channel has acknowledged, apply. Returns b as left
// (activeMask: UpdateSoundChannels' b on entry).
function applyChannelUpdateRequest(P, b) {
  const { V } = P;
  const mask = V.sndUpdateReqMask;
  if ((V.sndUpdateReqAck & mask) === mask) {
    const value = V.sndUpdateReqData & 0x0F;
    b = value;
    let a = mask, addr = P.A.sndChannels + CH.toneCtrl;
    do {
      const bit = a & 1;
      a >>= 1;
      V.sndUpdateReqAck = a;
      if (bit) P.bus.w8(addr, (P.bus.u8(addr) & 0xF0) | value);
      addr += CHANNEL_SIZE;
    } while (V.sndUpdateReqAck);
    V.sndUpdateReqMask = 0;
  }
  V.sndUpdateReqAck = 0;
  return b;
}

// InitAudioEngine (00:3078): the APU on, all outputs off, master volume full; every channel idle, the loop slots
// cleared. Leaves WRAM bank 7 mapped.
export function initAudioEngine(P) {
  const { V } = P;
  setWramBank(P, WRAM_SOUND);
  setChannelUpdateRequest(P, 0, 0);
  P.bus.w8(rAUDENA, 0x80);
  P.bus.w8(rAUDTERM, 0);
  V.sndPanShadow = 0;
  P.bus.w8(rAUDVOL, 0x77);
  for (let i = 0; i < CHANNELS; i++) P.bus.w16(P.A.sndChannels + i * CHANNEL_SIZE, 0xFFFF);
  for (let i = 0; i < 0x48; i++) P.bus.w8(P.A.sndLoopSlots + i, 0);
  V.sndFirstChannel = 0;
  V.sndWaveReloadPending = 0;
  const hl = P.A.sndLoopSlots + 0x48;
  return { a: 0, f: 0x80, b: 0, c: 0, d: 0, e: CHANNEL_SIZE, h: hl >> 8, l: hl & 0xFF };
}

export const HOOKS = [
  [0, 0x2F1A, (P, c) => setRegs(c, updateSoundEngine(P))],
  [0, 0x3373, (P, c) => setRegs(c, runSoundEngine(P))],
  [0, 0x3078, (P, c) => setRegs(c, initAudioEngine(P))],
  [0, 0x30B4, (P, c) => { setChannelUpdateRequest(P, c.b, c.c); setRegs(c, { a: 0, f: 0x80 }); }],
];
