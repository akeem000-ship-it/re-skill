// The sound driver's model, shared by the audio modules: channels, their state blocks, the APU registers.
// Names and addresses from the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm;
// its docs/sound_engine.md describes the driver and the script format).
//
// Six logical channels share the four APU channels. Channels 0-1 play sound effects, 2-5 music; each one is a
// script of two-byte commands (opcode, operand) stepped by the driver once per tick (each VBlank, or the timer
// interrupt while the LCD is off). Each channel says which APU channel it drives (its "type": square 1, square 2,
// wave, noise). The effect channels are serviced first: a music channel whose APU channel is already in use by an
// effect this tick still runs its script, but writes no registers ("AbortIfChannelTriggered").
//
// Each channel owns a 32-byte state block in WRAM bank 7 (wSndChannels, $D100 + n * $20). While the driver services
// a channel it copies the block into HRAM $FFD0-$FFEF (hSndScriptPtr ...) to work on it with ldh, and copies it back
// afterwards; RunSoundEngine saves and restores what that HRAM window held before (the window is shared with the
// sprite queue, the link code and the match frame counter).

export const WRAM_SOUND = 7;

// APU channels (the low two bits of a block's type byte): the driver writes register $FF10 + type * 5 + reg
export const SQUARE1 = 0, SQUARE2 = 1, WAVE = 2, NOISE = 3;
// register numbers as WriteChannelReg takes them (square 1's: NR10..NR14; + type * 5 for the others)
export const NRx0 = 0x10, NRx1 = 0x11, NRx2 = 0x12, NRx3 = 0x13, NRx4 = 0x14;
export const rAUD3ENA = 0xFF1A, rAUD3LEN = 0xFF1B, rAUD3LEVEL = 0xFF1C, rAUDVOL = 0xFF24, rAUDTERM = 0xFF25, rAUDENA = 0xFF26;
export const rAUD3WAVE_0 = 0xFF30;
export const rROMB0 = 0x2000;

export const CHANNELS = 6, MUSIC_CHANNEL = 2, CHANNEL_SIZE = 0x20;
export const LOOP_SLOTS_PER_CHANNEL = 12;      // four 3-byte slots: a pass counter and a saved command index
export const HRAM_WINDOW = 0xFFD0;             // hSndScriptPtr: the serviced channel's block

// A state block, by offset (HRAM $FFD0 + offset while a channel is serviced). The P.V names of the HRAM copy are
// in brackets.
export const CH = {
  scriptPtr: 0x00,      // [sndScriptPtr] 2 bytes: index of the next command (2 bytes each) from the track start;
                        //   $FFFF: the channel is idle; 0: just started (the 4-byte track header is read first)
  type: 0x02,           // [sndChannelType] low 2 bits: the APU channel; high nibble: vibrato depth + 1 (snd_note_length)
  dataPtr: 0x03,        // [sndDataPtr] 2 bytes: the track's address
  dataBank: 0x05,       // [sndDataBank] its ROM bank
  toneCtrl: 0x06,       // [sndToneCtrl] bits 6-7 duty; bit 4 the note table's other octave; low nibble the tick rate
  lengthAccum: 0x07,    // [sndLengthAccum] tick-rate accumulator: when it passes $10 the channel skips a tick
  volume: 0x08,         // [sndVolume] NRx2 value (volume high nibble, envelope low nibble)
  noteTimer: 0x09,      // [sndNoteTimer] ticks left of the current note
  waveId: 0x0A,         // [sndWaveId] wave pattern (wave channel), NR10 sweep (square 1)
  noteOffset: 0x0B,     // [sndNoteOffset] gate: >= 0 a fixed gate time; negative: note length + this
  transpose: 0x0C,      // [sndTranspose]
  envRate: 0x0D,        // [sndEnvRate] instrument envelope row (high nibble); 0 = none
  envLength: 0x0E,      // [sndEnvLength] instrument envelope length in ticks
  envPos: 0x0F,         // [sndEnvPos] ticks since the note started (up to envLength)
  volSlide: 0x10,       // [sndVolSlide] volume slide steps left (signed: + up, - down)
  volSlideReload: 0x11, // [sndVolSlideReload] ticks per slide step
  volSlideTimer: 0x12,  // [sndVolSlideTimer]
  periodLo: 0x13,       // [sndPeriodLo] the note's NRx3 (clamped to 2..$FD), the vibrato's centre
  periodHi: 0x14,       // [sndPeriodHi] the NRx4 written at the note (bit 5 set: a note is sounding; $80: none yet)
  echo: 0x15,           // [sndEcho] low nibble: echo volume factor; high nibble: the volume before the echo
  panMask: 0x16,        // [sndPanMask] NR51 bits this channel may enable
  noteLenReload: 0x17,  // [sndNoteLenReload] vibrato delay: ticks after a note before vibrato starts
  noteLenTimer: 0x18,   // [sndNoteLenTimer]
  instrument: 0x19,     // [sndInstrument] low nibble: envelope table; high nibble: wave pattern table
  echoTimer: 0x1A,      // [sndEchoTimer]
  echoCtrl: 0x1B,       // [sndEchoCtrl] $F0 | echo delay in ticks; 0 = no echo
  loopCount: 0x1C,      // [sndLoopCount] snd_call passes left
  loopReturnPtr: 0x1D,  // [sndLoopReturnPtr] 2 bytes: the snd_call command's index
  restFlag: 0x1F,       // [sndRestFlag] gate timer: ticks until the note is released (0: released)
};

// the two-byte fields of the HRAM working set (their P.V names are one byte: other HRAM variables overlap them)
export const scriptPtr = P => P.bus.u16(HRAM_WINDOW + CH.scriptPtr);
export const setScriptPtr = (P, v) => P.bus.w16(HRAM_WINDOW + CH.scriptPtr, v & 0xFFFF);
export const dataPtr = P => P.bus.u16(HRAM_WINDOW + CH.dataPtr);

export const swap = v => ((v & 0x0F) << 4) | ((v >> 4) & 0x0F);

// CopyMemoryFast (00:03F3) as the driver uses it: n bytes (a multiple of 16), source to destination
export function copyBytes(P, src, dst, n) {
  for (let i = 0; i < n; i++) P.bus.w8(dst + i, P.bus.u8(src + i));
}
// ClearBytes (00:03A7): bc bytes (0 means 65536) to 0
export function clearBytes(P, addr, n) {
  do { P.bus.w8(addr, 0); addr = (addr + 1) & 0xFFFF; n = (n - 1) & 0xFFFF; } while (n);
}
// the ROM's wram_bank macro (hWramBank and rSVBK) and the restore of pop_wram_bank
export const setWramBank = (P, b) => P.wramBank(b);
// hRomBank and the MBC's bank register, as the driver switches to a track's bank
export function setRomBank(P, b) { P.V.romBank = b; P.bus.w8(rROMB0, b); }
// the hook adapters' write-back: the registers a routine leaves (a, b, c, d, e, h, l, f; others are ignored)
export function setRegs(cpu, r) {
  for (const k of ["a", "b", "c", "d", "e", "h", "l"]) if (k in r) cpu[k] = r[k] & 0xFF;
  if ("f" in r) cpu.f = r.f & 0xF0;
}
