// Starting and stopping sounds (bank 0, sound_00.asm $2FB3-$3372): the `rst $08 ; db id` sound request
// (PlaySoundCmd), PlaySoundManaged, the jingle that pauses the music (WaitJingleEnd, ResumeBGMAfterJingle),
// PlaySound and StopMusic. Port of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm);
// the driver's model is in defs.js and its docs/sound_engine.md.
//
// Sound ids: $01-$3F are songs (BGM), $40-$4F jingles (short songs that interrupt the BGM, which then resumes),
// $50 stops the effects, $51-$FF are sound effects; 0 stops the music. hMusic bit 0 mutes the music (songs and
// jingles are then only remembered). Each id's index-table entry gives the track bank ($70 + n) and the tracks to
// start: each one starts a channel (0-1 for effects, 2-5 for music).
// Tests: web/tests/port/routines_audio.mjs.
import { WRAM_SOUND, CHANNEL_SIZE, MUSIC_CHANNEL, LOOP_SLOTS_PER_CHANNEL, setWramBank, setRomBank, clearBytes, setRegs } from "./defs.js";

const JingleSoundIds = 0x2FE0;             // the song of each jingle id $40-$45
const MusicIndexTable = 0x3151;            // per song id from 1: (channel count << 4 | bank - $70), track table index
const SfxIndexTable = 0x31B5;              // the same per effect id from $51
const SOUND_TABLE = 0x4000;                // each track bank's table of 4-byte tracks: (channel * $20, type), address
export const SFX_STOP = 0x50, FIRST_JINGLE = 0x40;

const rom0 = (P, a) => P.bus.u8(a & 0xFFFF);
const musicMuted = P => (P.V.music & 1) !== 0;

// PlaySoundCmd (00:2FB3), reached by `rst $08 ; db id` (Rst08 at $0008 jumps here). The id is the byte after the
// rst: read through the return address on the stack, which is moved past it. Every register is kept. cpu: the
// CPU whose stack holds the return address (as the hook sees it); a port of Rst08 can call this as it is.
export function playSoundCmd(P, cpu) {
  const ret = P.bus.u16(cpu.sp);
  const id = P.bus.u8(ret);
  P.bus.w16(cpu.sp, (ret + 1) & 0xFFFF);
  requestSound(P, id);
}
// PlaySoundManaged (00:3024): the same request with the id in a; every register kept
export function playSoundManaged(P, id) { requestSound(P, id); }

// PlaySoundCmd.loop (00:2FC2): the request. Effects always play. A song plays unless it is the one playing already
// (or the music is muted); during a jingle it is only remembered, to start when the jingle ends. A jingle replaces
// the song (remembered in wCurrentBGM) unless the music is muted.
function requestSound(P, id) {
  const { V } = P;
  if (id >= SFX_STOP) { playSoundKeepBank(P, id); return; }
  let song = id;
  if (id >= FIRST_JINGLE) {
    if (musicMuted(P)) return;
    V.activeJingle = id;
    song = rom0(P, JingleSoundIds + (id - FIRST_JINGLE));
  } else {
    if (V.activeJingle) { V.currentBGM = id; return; }
    if (id === V.currentBGM) return;
    V.currentBGM = id;
  }
  if (musicMuted(P)) return;
  playSoundKeepBank(P, song);
}
// PlaySound with the WRAM bank saved and restored around it (push hWramBank ... pop_wram_bank)
export function playSoundKeepBank(P, id) {
  const saved = P.V.wramBank;
  playSound(P, id);
  setWramBank(P, saved);
}

// WaitJingleEnd (00:302A): wait (frames) until the jingle is over or a button is held, then end it and resume the
// song. Every register kept.
export function* waitJingleEnd(P) {
  const { V } = P;
  if (!V.activeJingle) return;
  do {
    yield* P.runRom(0, 0x2631);                         // AdvanceFrame (the ROM's, or its port through the hooks)
    if (V.playerInputFlags) break;
  } while (V.activeJingle);
  V.activeJingle = 0;
  if (musicMuted(P)) return;
  playSoundKeepBank(P, V.currentBGM);
}

// ResumeBGMAfterJingle (00:305D), from AdvanceFrame with WRAM bank 7: once the jingle's channels are idle, end the
// jingle and start the song again. Returns the registers it leaves (CheckMusicChannelsIdle's, or PlaySound's).
export function resumeBGMAfterJingle(P) {
  const r = checkMusicChannelsIdle(P);
  if (!r.idle) return r;
  if (!P.V.activeJingle) return { ...r, a: 0, f: 0x80 };
  // (the ROM tests e & $0F here: e is $20 from CheckMusicChannelsIdle, so it always goes on)
  P.V.activeJingle = 0;
  if (musicMuted(P)) return { ...r, a: 0, f: 0x20, h: 0xFF, l: 0xCE };
  const out = playSound(P, P.V.currentBGM);
  return { ...r, ...out, h: 0xFF, l: 0xCE };
}

// CheckMusicChannelsIdle (00:3110): selects WRAM bank 7; idle (Z) when channels 2-5 all have no track. Returns the
// registers it leaves and idle.
export function checkMusicChannelsIdle(P) {
  setWramBank(P, WRAM_SOUND);
  let hl = P.A.sndChannels + MUSIC_CHANNEL * CHANNEL_SIZE;
  for (let b = 4; b > 0; b--) {
    let a = (P.bus.u8(hl) + 1) & 0xFF;
    if (a) return { idle: false, a, f: 0x00, b, d: 0, e: CHANNEL_SIZE, h: (hl + 1) >> 8, l: (hl + 1) & 0xFF };
    a = (P.bus.u8(hl + 1) + 1) & 0xFF;
    if (a) return { idle: false, a, f: 0x00, b, d: 0, e: CHANNEL_SIZE, h: hl >> 8, l: hl & 0xFF };
    hl += CHANNEL_SIZE;
  }
  return { idle: true, a: 0, f: 0xC0, b: 0, d: 0, e: CHANNEL_SIZE, h: hl >> 8, l: hl & 0xFF };
}

// StopMusic (00:3129): channels 2-5 idle, their loop slots cleared; leaves WRAM bank 7 mapped. Every register kept.
export function stopMusic(P) {
  setWramBank(P, WRAM_SOUND);
  for (let ch = MUSIC_CHANNEL; ch < 6; ch++) P.bus.w16(P.A.sndChannels + ch * CHANNEL_SIZE, 0xFFFF);
  clearBytes(P, P.A.sndLoopSlots + MUSIC_CHANNEL * LOOP_SLOTS_PER_CHANNEL, 0x30);
}

// PlaySound (00:3297): start sound id (0: stop the music; $50: stop the effects). A song first stops the music; an
// effect first stops both effect channels. Then each of the id's tracks starts its channel, with interrupts off.
// Leaves WRAM bank 7 mapped; keeps bc, de, hl. Returns a (and f where a caller could see it).
export function playSound(P, id) {
  if (id === 0) { stopMusic(P); return { a: 0, f: 0xA0 }; }
  let table, n;
  if (id >= SFX_STOP) {
    setWramBank(P, WRAM_SOUND);
    P.bus.w16(P.A.sndChannels, 0xFFFF);
    P.bus.w16(P.A.sndChannels + CHANNEL_SIZE, 0xFFFF);
    clearBytes(P, P.A.sndLoopSlots, MUSIC_CHANNEL * LOOP_SLOTS_PER_CHANNEL);
    if (id === SFX_STOP) return { a: 0, f: 0xC0 };
    table = SfxIndexTable; n = (id - SFX_STOP - 1) & 0xFF;
  } else {
    stopMusic(P);
    table = MusicIndexTable; n = (id - 1) & 0xFF;
  }
  const index = table + 2 * n;
  const savedRomBank = P.V.romBank;
  const head = rom0(P, index);
  setRomBank(P, (head & 0x0F) | 0x70);
  let count = head >> 4;
  let track = SOUND_TABLE + rom0(P, index + 1) * 4;
  P.di();
  do {
    startSoundChannel(P, track);
    track += 4;
    count = (count - 1) & 0xFF;
  } while (count);
  P.ei();
  setRomBank(P, savedRomBank);
  return { a: savedRomBank, f: indexFlags(table, n) };
}
// the flags PlaySound leaves (pushed with hRomBank, popped with it): those of the last step of its 8-bit sum
// table + 2n (add l, then inc h on a carry)
function indexFlags(table, n) {
  const x2 = 2 * n;
  const hi = ((table >> 8) + (x2 > 0xFF ? 1 : 0)) & 0xFF, lo = table & 0xFF, x = x2 & 0xFF;
  const sum = lo + x;
  if (sum > 0xFF) {                                    // the carry: inc h
    const h = (hi + 1) & 0xFF;
    return (h ? 0 : 0x80) | ((h & 0x0F) === 0 ? 0x20 : 0) | 0x10;
  }
  return ((sum & 0xFF) ? 0 : 0x80) | ((lo & 0x0F) + (x & 0x0F) > 0x0F ? 0x20 : 0);
}

// StartSoundChannel (00:3314): a track (4 bytes in the mapped bank: channel * $20, type, track address) starts its
// channel: the block is reset, with the script pointer 0 (the header is read on its first tick). If the channel was
// playing, an APU channel's bits leave the pan shadow: meant to be its own, but the ROM takes the low bits of the
// script pointer's high byte (block + 1), not of the type (block + 2).
function startSoundChannel(P, track) {
  const { V } = P;
  const block = P.A.sndChannels + P.bus.u8(track);
  if (P.bus.u8(block) !== 0xFF) {
    const mask = [0xEE, 0xDD, 0xBB, 0x77][P.bus.u8(block + 1) & 0x03];
    V.sndPanShadow &= mask;
  }
  const w = (o, v) => P.bus.w8(block + o, v);
  w(0x00, 0); w(0x01, 0);                              // script pointer: start
  w(0x02, P.bus.u8(track + 1));                        // type
  w(0x03, P.bus.u8(track + 2)); w(0x04, P.bus.u8(track + 3));   // track address
  w(0x05, V.romBank);                                  // its bank
  w(0x0A, 0xFF);                                       // wave pattern: none
  w(0x19, 0); w(0x1A, 0); w(0x1B, 0);                  // instrument, echo
  w(0x15, 0);                                          // echo
  w(0x14, 0x80);                                       // NRx4: no note yet
  w(0x1C, 0); w(0x1D, 0); w(0x1E, 0); w(0x1F, 0);      // snd_call, gate
}

export const HOOKS = [
  [0, 0x2FB3, (P, c) => { playSoundCmd(P, c); }],
  [0, 0x3024, (P, c) => { playSoundManaged(P, c.a); }],
  [0, 0x302A, P => waitJingleEnd(P)],
  [0, 0x305D, (P, c) => setRegs(c, resumeBGMAfterJingle(P))],
  [0, 0x3110, (P, c) => setRegs(c, checkMusicChannelsIdle(P))],
  [0, 0x3129, P => { stopMusic(P); }],
  [0, 0x3297, (P, c) => setRegs(c, playSound(P, c.a))],
];
