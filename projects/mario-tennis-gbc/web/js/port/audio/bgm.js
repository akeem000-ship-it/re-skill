// The music on/off helpers around the sound driver (bank 0, view_00.asm $2F32-$2FB2): ResumeBGM, SetMusicMuted and
// two unused ones. hMusic bit 0 set mutes the music (the sound option); wCurrentBGM is the song to play.
// Port of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm). Every one keeps all
// registers but Unused_00_StopBGMIfPlaying's flags. Tests: web/tests/port/routines_audio.mjs.
import { setWramBank } from "./defs.js";
import { playSound, playSoundManaged, playSoundKeepBank } from "./requests.js";

const setMusicFlags = (P, v) => P.bus.w8(P.A.music, v);     // hMusic (one byte)
const musicFlags = P => P.bus.u8(P.A.music);

// ResumeBGM (00:2F32): if the music is muted, unmute it and play the current song
export function resumeBGM(P) {
  const m = musicFlags(P);
  if (!(m & 1)) return;
  setMusicFlags(P, m & ~1);
  playSoundKeepBank(P, P.V.currentBGM);
}

// Unused_00_StopBGMIfPlaying (00:2F52): if the music is muted, unmute it and request song 0 (`sound BGM_NONE`).
// Returns the flags of its bit test (Z: was not muted; H set; C kept).
export function unusedStopBGMIfPlaying(P, f) {
  const m = musicFlags(P);
  if (m & 1) {
    setMusicFlags(P, m & ~1);
    playSoundManaged(P, 0);
  }
  return (f & 0x10) | 0x20 | (m & 1 ? 0 : 0x80);
}

// Unused_00_SyncBGMEnableFlag (00:2F60): hMusic bit 0 from the sound option (wSoundOptionBits bit 0); when that
// mutes, stop the music
export function unusedSyncBGMEnableFlag(P) {
  const m = (musicFlags(P) & 0xFE) | (P.V.soundOptionBits & 1);
  setMusicFlags(P, m);
  if (m & 1) playSoundKeepBank(P, 0);
}

// SetMusicMuted (00:2F86): a bit 0 = mute. Ends any jingle; stops the music, or plays the current song.
export function setMusicMuted(P, mute) {
  P.V.activeJingle = 0;
  const saved = P.V.wramBank;
  const m = (musicFlags(P) & 0xFE) | (mute & 1);
  setMusicFlags(P, m);
  playSound(P, m & 1 ? 0 : P.V.currentBGM);
  setWramBank(P, saved);
}

export const HOOKS = [
  [0, 0x2F32, P => { resumeBGM(P); }],
  [0, 0x2F52, (P, c) => { c.f = unusedStopBGMIfPlaying(P, c.f); }],
  [0, 0x2F60, P => { unusedSyncBGMEnableFlag(P); }],
  [0, 0x2F86, (P, c) => { setMusicMuted(P, c.a); }],
];
