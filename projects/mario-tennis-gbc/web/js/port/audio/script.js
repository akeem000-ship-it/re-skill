// The channel script interpreter: RunSoundChannelScript (00:3558) and its commands (bank 0, sound_00.asm).
// Port of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm); the command set is
// described in its docs/sound_engine.md ("Script command set"), the driver's model in defs.js.
//
// A track is a list of two-byte commands (opcode, operand) after a 4-byte header. The channel's position is a
// command index (hSndScriptPtr), so the command is at hSndDataPtr + index * 2. The interpreter runs commands until
// one ends the tick: a note (or snd_glide), or the end of the script. Loops keep command indexes too: in the
// channel's four loop slots (a pass counter and an index each), or for snd_call in hSndLoopCount/hSndLoopReturnPtr.
// Covered by the routine tests of UpdateSoundEngine (web/tests/port/routines_audio.mjs).
import { WAVE, MUSIC_CHANNEL, rAUD3ENA, rAUDVOL, swap, scriptPtr, setScriptPtr, dataPtr } from "./defs.js";
import { sndTriggerNote, updatePanShadow, sndReleaseChannel, applyChannelEnvelope, loadWavePattern, getChannelLoopSlot } from "./channel.js";

// opcodes $A0-$AF; $B0-$BF loop, $C0-$CF envelope, $D0-$DF/$E0-$EF volume slide, $FD loop point, $FF end;
// below $A0 a note
const SND_VOLUME = 0xA0, SND_WAVE = 0xA1, SND_DUTY = 0xA2, SND_NOTE_LENGTH = 0xA3, SND_DETUNE = 0xA4, SND_PAN = 0xA5,
  SND_MASTER_VOLUME = 0xA6, SND_GLIDE = 0xA7, SND_INSTRUMENT = 0xA8, SND_TRANSPOSE = 0xA9, SND_ECHO = 0xAA,
  SND_CALL = 0xAC, SND_RETURN = 0xAD, SND_TONE_FLAG = 0xAE, SND_LENGTH_NIBBLE = 0xAF;
const SND_LOOP_POINT = 0xFD, SND_END = 0xFF;

const byte = (P, a) => P.bus.u8(a & 0xFFFF);              // script bytes, from the track's bank (mapped)
const commandAddr = P => (scriptPtr(P) * 2 + dataPtr(P)) & 0xFFFF;

export function runSoundChannelScript(P) {
  const { V } = P;
  const isWave = () => V.sndChannelType_7 === WAVE;
  const channelIdle = () => !(V.sndActiveMask & V.sndChannelBits);   // no effect drives this APU channel this tick
  let hl = commandAddr(P);
  for (;;) {
    // .nextCommand: the index moves on before the command runs (jumps set it afterwards)
    setScriptPtr(P, scriptPtr(P) + 1);
    const op = byte(P, hl); hl = (hl + 1) & 0xFFFF;
    const operand = () => byte(P, hl);
    if (op < 0xA0) { sndTriggerNote(P, op, hl); return; }   // a note: ends the tick
    if (op >= 0xD0) {
      if (op >= 0xF0) {
        if (op === SND_LOOP_POINT) {                          // snd_loop_point slot: the next command's index
          const slot = getChannelLoopSlot(P, operand());
          P.bus.w8(slot, 0);
          P.bus.w16(slot + 1, scriptPtr(P));
        } else if (op === SND_END) {                          // snd_end
          setScriptPtr(P, 0xFFFF);
          if (isWave() && V.sndChannelIndex < MUSIC_CHANNEL) V.sndWaveReloadPending = 0xFF;   // the music's wave RAM was overwritten
          sndReleaseChannel(P);
          return;
        }
        hl++; continue;                                       // $F0-$FC, $FE: skipped with their operand
      }
      // $D0-$DF snd_volume_up steps, period; $E0-$EF snd_volume_down
      const steps = op >= 0xE0 ? (-(op & 0x0F)) & 0xFF : op & 0x0F;
      if (!isWave()) {
        V.sndVolSlide = steps;
        V.sndVolSlideReload = operand();
        V.sndVolSlideTimer = operand();
      }
      hl++; continue;
    }
    if (op >= 0xC0) {                                         // $C0-$CF snd_envelope rate, length
      if (!isWave() && !(V.sndVolume & 0x0F)) {
        V.sndEnvLength = operand();
        V.sndEnvRate = swap(op & 0x0F);
      }
      hl++; continue;
    }
    if (op >= 0xB0) {
      const count = op & 0x0F;
      if (!count) {                                           // $B0 snd_jump slot (operand $F0 | slot)
        const a = operand();
        if ((a & 0xF0) !== 0xF0) { hl++; continue; }
        const slot = getChannelLoopSlot(P, a);
        setScriptPtr(P, P.bus.u16(slot + 1));
        hl = commandAddr(P); continue;
      }
      // $B1-$BF snd_loop count, slot: back to the slot's loop point until the block has run count + 1 times
      const slot = getChannelLoopSlot(P, operand());
      const passes = (P.bus.u8(slot) + 1) & 0xFF;
      P.bus.w8(slot, passes);
      if (passes < count + 1) setScriptPtr(P, P.bus.u16(slot + 1));
      hl = commandAddr(P); continue;
    }
    // $A0-$AF
    switch (op) {
      case SND_VOLUME: {
        V.sndVolume = swap(operand()); hl++;
        // the ROM means to apply the new volume, but its a register holds the (zero) channel test by then: NRx2 = 0
        // (silent) until the next note
        if (channelIdle()) applyChannelEnvelope(P, 0);
        continue;
      }
      case SND_WAVE: {                                        // the wave channel's pattern (loaded now), square 1's sweep
        const id = operand(); hl++;
        V.sndWaveId = id;
        if (!isWave() || !channelIdle()) continue;
        P.bus.w8(rAUD3ENA, 0);
        V.sndLoadedWaveId = id;
        loadWavePattern(P, swap(id));
        continue;
      }
      case SND_DUTY: {                                        // the duty; the wave channel: its envelope length
        const a = operand(); hl++;
        if (isWave()) V.sndEnvLength = a;
        else V.sndToneCtrl = (V.sndToneCtrl & 0x3F) | ((((a >> 2) | (a << 6)) & 0xC0));
        continue;
      }
      case SND_NOTE_LENGTH: {                                 // vibrato: delay (low nibble, in 2 ticks) and depth
        const a = operand(); hl++;
        if (a === 0xFE) { V.sndChannelType &= 0x0F; continue; }   // vibrato off
        V.sndNoteLenReload = V.sndNoteLenTimer = ((a & 0x0F) * 2) & 0xFF;
        V.sndChannelType = (((a + 0x10) & 0xF0)) | (V.sndChannelType & 0x0F);
        continue;
      }
      case SND_DETUNE: V.sndNoteOffset = operand(); hl++; continue;   // the gate (see SndTriggerNote)
      case SND_PAN: {
        let a = operand(); hl++;
        if (a === 0x01) a = swap(V.sndPanMask);              // swap left and right
        V.sndPanMask = a;
        continue;
      }
      case SND_MASTER_VOLUME: P.bus.w8(rAUDVOL, operand()); hl++; continue;
      case SND_GLIDE:                                         // a new note length without a new note: ends the tick
        V.sndNoteTimer = operand();
        updatePanShadow(P);
        return;
      case SND_INSTRUMENT: V.sndInstrument = operand(); hl++; continue;
      case SND_TRANSPOSE: {
        const a = operand(); hl++;
        if (a === 0xF0) V.sndTranspose = (V.sndTranspose + 1) & 0xFF;
        else if (a === 0xF1) V.sndTranspose = (V.sndTranspose - 1) & 0xFF;
        else if (a === 0xF2) V.sndTranspose_7 = (V.sndTranspose_7 + 1) & 0xFF;
        else if (a === 0xF3) V.sndTranspose_7 = (V.sndTranspose_7 - 1) & 0xFF;
        else if (a === 0xFE || a === 0xFF) {
          // a jump table of command indexes follows, by the global (or the channel's) transpose
          const t = a === 0xFE ? V.sndTranspose_7 : V.sndTranspose;
          const entry = (hl + ((t << 1) & 0xFF)) & 0xFFFF;
          setScriptPtr(P, byte(P, entry) | byte(P, entry + 1) << 8);
          hl = commandAddr(P);
        } else if (a < 0x80) V.sndTranspose = a;
        else V.sndTranspose_7 = a - 0x80;
        continue;
      }
      case SND_ECHO: {                                        // high nibble: delay; low nibble: echo volume factor
        const a = operand(); hl++;
        if (!(a & 0xF0)) { V.sndEchoTimer = 0; V.sndEcho = 0; V.sndEchoCtrl = 0; continue; }
        V.sndEchoTimer = a >> 4;
        V.sndEchoCtrl = (a >> 4) | 0xF0;
        V.sndEcho = (V.sndEcho & 0xF0) | (a & 0x0F);
        continue;
      }
      case SND_CALL: {                                        // snd_call count, target (4 bytes): run a block count times
        const left = V.sndLoopCount;
        if (left === 1) {                                     // the last pass is over: on past the 4-byte command
          V.sndLoopCount = 0;
          setScriptPtr(P, scriptPtr(P) + 1);
          hl = commandAddr(P); continue;
        }
        V.sndLoopCount = left ? left - 1 : operand();
        P.bus.w16(P.A.sndLoopReturnPtr, scriptPtr(P) - 1);   // snd_return comes back to this command
        hl++;
        const target = byte(P, hl) | byte(P, hl + 1) << 8;   // a byte offset from the track start
        setScriptPtr(P, target >> 1);
        hl = commandAddr(P); continue;
      }
      case SND_RETURN:
        setScriptPtr(P, V.sndLoopReturnPtr);
        hl = commandAddr(P); continue;
      case SND_TONE_FLAG: V.sndToneCtrl = (V.sndToneCtrl & 0xEF) | (operand() & 0x10); hl++; continue;
      case SND_LENGTH_NIBBLE: {                               // the tick rate
        const a = operand() & 0x0F; hl++;
        V.sndLengthAccum = a;
        V.sndToneCtrl = (V.sndToneCtrl & 0xF0) | a;
        continue;
      }
      default: hl++; continue;                                // $AB: skipped
    }
  }
}
