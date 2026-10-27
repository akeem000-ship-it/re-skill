// Mario Golf (GBC) sound driver, rewritten from the ROM's code (banks 7C/7D/7E: music; bank 7F: effects; the
// command layer in bank 0). It runs on a model of the driver's own RAM, laid out at the game's addresses
// ($C4C0-$C629, $C33E, $CAAB, hFFBF/hFFCD/hFFCE), and reads every song, effect, table and wave from the ROM by
// address at run time; nothing from the ROM is embedded here. REVERSE.md "Sound driver (native)" describes it.
//
// Each call returns the sound-register writes the game's code makes (FF10-FF3F, in order) as [register, value]
// pairs, register = $10..$3F. frame() is one VBlank: SoundUpdate (7E:40EB) then ResumeBGMAfterJingle (00:2C4A).
// The code follows the ROM routine by routine, bugs included (they are named where they matter), so that the writes
// are bit-exact; web/tests/sound_vs_core.mjs checks them against the ROM run on the CPU core.
//
// The driver reads back a few registers (NR11/NR21 duty bits, and NRx1 of the wave and noise channels in the effect
// code, which read as $FF); RegFile models those reads as the APU returns them.
//
// The copies in banks 7C and 7D: SongStart maps the song's bank and the music code runs on from that bank's copy.
// tools/sound_copies.py checks every traced routine of 7E against them: all identical, at the same addresses, so the
// methods below are these routines too (7E address, then its copies):
//   7C:4016 7D:4016 SoundCmdDispatch;  7C:4022 7D:4022 SoundRequestSFX;  7C:4043 7D:4043 SoundSetMuteMask
//   7C:4047 7D:4047 SoundIsMusicPlaying;  7C:4051 7D:4051 SoundIsSFXPlaying;  7C:405B 7D:405B SoundTogglePause
//   7C:4064 7D:4064 SoundSetMasterVolume;  7C:4072 7D:4072 SoundInit;  7C:40EB 7D:40EB SoundUpdate
//   7C:4119 7D:4119 SoundHandleRequests;  7C:4145 7D:4145 SoundSilenceMusicChannels;  7C:4186 7D:4186 SongStart
//   7C:42B8 7D:42B8 SoundNop;  7C:42B9 7D:42B9 MusicUpdateCh1;  7C:4308 7D:4308 MusicUpdateCh2
//   7C:4359 7D:4359 MusicUpdateCh3;  7C:43AE 7D:43AE MusicUpdateCh4;  7C:43EF 7D:43EF MusicRunScript
//   7C:4467 7D:4467 MusicPlayNote;  7C:456F 7D:456F MusicCmdLengthUnit;  7C:457A 7D:457A MusicCmdOctave
//   7C:4592 7D:4592 MusicCmdOctaveUp;  7C:459A 7D:459A MusicCmdOctaveDown;  7C:45A2 7D:45A2 MusicCmdTie
//   7C:45AB 7D:45AB MusicCmdPanning;  7C:45C6 7D:45C6 MusicCmdSetLoopPoint;  7C:45D4 7D:45D4 MusicCmdGotoLoopPoint
//   7C:45E0 7D:45E0 MusicCmdRepeatStart;  7C:45F5 7D:45F5 MusicCmdRepeatEnd;  7C:460F 7D:460F MusicCmdJump
//   7C:4616 7D:4616 MusicCmdCall;  7C:462D 7D:462D MusicCmdReturn;  7C:463E 7D:463E MusicCmdDetune
//   7C:464B 7D:464B MusicCmdDuty;  7C:465A 7D:465A MusicCmdEnvelope;  7C:4667 7D:4667 MusicCmdWave
//   7C:4677 7D:4677 MusicCmdGate;  7C:4684 7D:4684 MusicCmdParamE9;  7C:4691 7D:4691 MusicCmdVibrato
//   7C:46A3 7D:46A3 MusicCmdVibratoDelay;  7C:46B0 7D:46B0 MusicCmdTranspose;  7C:46BD 7D:46BD MusicCmdTransposeAdd
//   7C:46CB 7D:46CB MusicCmdRelease;  7C:46D8 7D:46D8 MusicCmdEnd;  7C:46E0 7D:46E0 MusicGetStackPtr
//   7C:46E9 7D:46E9 MusicSetStackPtr;  7C:46F4 7D:46F4 MusicNextCommand;  7C:46F8 7D:46F8 MusicCh1NoteOn
//   7C:4737 7D:4737 MusicCh1NoteOff;  7C:476F 7D:476F MusicCh2NoteOn;  7C:47AB 7D:47AB MusicCh2NoteOff
//   7C:47E3 7D:47E3 MusicCh3NoteOn;  7C:4831 7D:4831 LoadWavePattern;  7C:4851 7D:4851 MusicCh4NoteOn
//   7C:487F 7D:487F MusicCh4NoiseStep;  7C:48A0 7D:48A0 SoundUpdatePanning;  7C:48D0 7D:48D0 MusicVibratoFreq
//   7C:492E 7D:492E MusicApplyVibrato;  7C:4982 7D:4982 MusicAddDetune;  7C:499B 7D:499B SoundSilenceAll
//   7C:49CC 7D:49CC SoundCheckMusicEnd;  7C:49DF 7D:49DF SoundSaveAndStop;  7C:49EB 7D:49EB SoundRestoreAndResume
//   7C:49F7 7D:49F7 SoundSaveState;  7C:4B1C 7D:4B1C SoundRestoreState;  7C:4C33 7D:4C33 SoundCopyBytes


// APU register read-back masks (FF10-FF26), as the hardware returns them
const READ_MASK = [0x80, 0x3F, 0x00, 0xFF, 0xBF, 0xFF, 0x3F, 0x00, 0xFF, 0xBF, 0x7F, 0xFF, 0x9F, 0xFF, 0xBF, 0xFF,
  0xFF, 0x00, 0x00, 0xBF, 0x00, 0x00, 0x70];

// RAM addresses (labels.csv)
const wCurrentBGM = 0xC33E, wMusicRequest = 0xC4C0, wSoundBank = 0xC4C1, wSFXRequest = 0xC4C2, wSFXPriority = 0xC4C3,
  wPanning = 0xC4C4, wSFXPanning = 0xC4C5, wChDuty = 0xC4C6, wWaveIndex = 0xC4CA, wWaveReload = 0xC4CB,
  wSFXChannelMask = 0xC4CC, wChannelActive = 0xC4CD, wChNoteState = 0xC4D1, wChScriptPtr = 0xC4D5,
  wChLoopPoint = 0xC4DD, wChFreq = 0xC4E5, wNoiseRegs = 0xC4EB, wChOctave = 0xC4EF, wChNotePitch = 0xC4F7,
  wChNoteTimer = 0xC4FB, wChGate = 0xC4FF, wChGateTimer = 0xC503, wChParamE9 = 0xC507, wChTranspose = 0xC50B,
  wChLengthUnit = 0xC50F, wChVibratoIndex = 0xC513, wChVibratoType = 0xC517, wChVibratoPos = 0xC51B,
  wChVibratoDelay = 0xC51F, wChVibratoWait = 0xC523, wChEnvelope = 0xC527, wChRelease = 0xC52A, wChDetune = 0xC52D,
  wNoisePtr = 0xC530, wNoiseActive = 0xC532, wSoundMuteMask = 0xC533, wMasterVolume = 0xC534, wSoundPaused = 0xC535,
  wChStackPtr = 0xC536, wSFXChTrigger = 0xC56E, wSFXCh4Trigger = 0xC571, wSFXChSlide = 0xC572, wSFXCh4Slide = 0xC575,
  wSFXChWait = 0xC576, wSFXChFreq = 0xC57A, wSFXCh4Poly = 0xC580, wSFXChLoopCount = 0xC582, wSFXChLoopPtr = 0xC586,
  wSFXChScriptPtr = 0xC58E, wSFXActive = 0xC596, wSFXMaskScratch = 0xC597, wCh1Sounding = 0xC598,
  wCh2Sounding = 0xC599, wSoundSaveArea = 0xC59A, wSFXBallHeight = 0xCAAB,
  hSoundROMBank = 0xFFBF, hActiveJingle = 0xFFCD, hSoundFlags = 0xFFCE;

// ROM tables (the driver code and its tables at $4000-$52D8 are the same in banks 7C, 7D and 7E)
const SongCountData = 0x52A4, SongBankTable = 0x52A5, SongTable = 0x52D7, SFXPriorityTable = 0x5235,
  MusicStackInitTable = 0x4C3B, MusicOctaveTable = 0x4C43, MusicFreqTable = 0x4C4B, WavePatternTable = 0x4CDD,
  NoiseInstrumentTable = 0x4F41, VibratoTable = 0x50C9, JingleSongTable = 0x2BE8,
  SFXCountAData = 0x495C, SFXTableA = 0x495D, SFXCountBData = 0x615F, SFXTableB = 0x6160, SFXWaveTable = 0x4B6B,
  SFXHeightFreqTable = 0x431C;
const DRIVER_BANK = 0x7E, SFX_BANK = 0x7F;

export const SONG_COUNT_ADDR = { bank: DRIVER_BANK, addr: SongCountData };

const rlc8 = v => ((v << 1) | (v >> 7)) & 0xFF;
const rrc8 = v => ((v >> 1) | ((v & 1) << 7)) & 0xFF;
const swap8 = v => ((v << 4) | (v >> 4)) & 0xFF;

// The APU registers as the driver sees them: writes are stored as the chip stores them, reads return them with the
// hardware's read-back masks (only the duty reads matter to the driver).
export class RegFile {
  constructor() { this.reg = new Uint8Array(0x40); this.on = false; }
  read(r) {
    if (r >= 0x30) return this.reg[r];
    if (r === 0x26) return (this.on ? 0x80 : 0) | 0x70;
    const i = r - 0x10;
    return i < READ_MASK.length ? this.reg[r] | READ_MASK[i] : 0xFF;
  }
  write(r, v) {
    if (r >= 0x30) { this.reg[r] = v; return; }
    if (r === 0x26) {
      const was = this.on; this.on = !!(v & 0x80);
      if (was && !this.on) this.reg.fill(0, 0x10, 0x26);
      return;
    }
    if (!this.on && r !== 0x20 && r !== 0x1B && r !== 0x11 && r !== 0x16) return;
    this.reg[r] = v;
  }
}

export class SoundDriver {
  constructor(rom) {
    this.rom = rom;
    this.ram = new Uint8Array(0x10000);       // only the driver's RAM and HRAM addresses are used
    this.regs = new RegFile();
    this.bank = DRIVER_BANK;                  // the ROM bank mapped at $4000-$7FFF while the driver runs
    this.out = [];
  }

  // ---- memory ----
  rd(a) {
    a &= 0xFFFF;
    if (a < 0x4000) return this.rom[a];
    if (a < 0x8000) return this.rom[this.bank * 0x4000 + (a - 0x4000)];
    if (a >= 0xFF10 && a < 0xFF40) return this.regs.read(a - 0xFF00);
    return this.ram[a];
  }
  rw(a) { return this.rd(a) | (this.rd(a + 1) << 8); }
  wr(a, v) {
    a &= 0xFFFF; v &= 0xFF;
    if (a >= 0xFF10 && a < 0xFF40) { this.out.push([a - 0xFF00, v]); this.regs.write(a - 0xFF00, v); return; }
    if (a < 0x8000) { if (a >= 0x2000 && a < 0x3000) this.bank = v; return; }   // MBC5 ROM bank (the driver's own)
    this.ram[a] = v;
  }
  reg(r, v) { this.wr(0xFF00 + r, v); }
  ww(a, v) { this.ram[a] = v & 0xFF; this.ram[a + 1] = (v >> 8) & 0xFF; }
  word(a) { return this.ram[a] | (this.ram[a + 1] << 8); }
  take() { const o = this.out; this.out = []; return o; }

  // ---- public API ----
  // SoundInit (7E:4072), as Start runs it at power-on
  init() { this.bank = DRIVER_BANK; this.soundInit(); return this.take(); }
  // a sound command as `rst $08 ; db id` makes it (PlaySoundCmd 00:2BBB): songs < $36, jingles $36-$3A, effects >= $40
  playSound(id) { this.playSoundCmd(id & 0xFF); return this.take(); }
  // start song n directly (SoundCmdDispatch 7E:4016), bypassing the jingle and current-song bookkeeping
  playSong(n) { this.bank = DRIVER_BANK; this.soundCmdDispatch(n & 0xFF); return this.take(); }
  // stop the music (song 0 is silence, as StopBGMIfPlaying 00:2B6C uses it)
  stop() { return this.playSong(0); }
  // the ball height the in-flight whistle (effect command $Ex) follows ($CAAB, copied by BallTask 10:4D6E)
  setBallHeight(h) { this.ww(wSFXBallHeight, h & 0xFFFF); }
  // one VBlank's worth of sound work: SoundUpdate (7E:40EB) then ResumeBGMAfterJingle (00:2C4A)
  frame() {
    this.bank = DRIVER_BANK;
    this.soundUpdate();
    this.resumeBGMAfterJingle();
    return this.take();
  }
  // SoundUpdate (7E:40EB) alone: what TimerHandler (00:2F6F) runs instead of a VBlank while the LCD is off
  update() { this.bank = DRIVER_BANK; this.soundUpdate(); return this.take(); }
  // the bank-0 helpers around the commands (they keep hSoundFlags bit 0 = music off, from wOptionFlags bit 0)
  resumeBGM() { this.resumeBGMCmd(); return this.take(); }
  stopBGMIfPlaying() { this.stopBGMIfPlayingCmd(); return this.take(); }
  syncBGMEnableFlag(optionFlags) { this.syncBGMEnableFlagCmd(optionFlags); return this.take(); }
  applyMusicOption(optionFlags) { this.applyMusicOptionCmd(optionFlags); return this.take(); }
  endJingle() { this.endJingleCmd(); return this.take(); }
  get musicPlaying() { return this.ram[wMusicRequest] !== 0x80; }
  get sfxPlaying() { return this.ram[wSFXChannelMask] !== 0; }
  get songCount() { return this.rom[DRIVER_BANK * 0x4000 + SongCountData - 0x4000]; }

  // ---- bank 0: the command layer ----
  // 00:2BBB PlaySoundCmd / 00:2C19 PlaySoundManaged
  playSoundCmd(a) {
    const r = this.ram;
    this.bank = DRIVER_BANK;
    if (a >= 0x40) { this.soundRequestSFX((a - 0x40) & 0xFF); return; }
    if (a >= 0x36) {                                   // jingle: plays a song, the BGM comes back afterwards
      if (r[hSoundFlags] & 1) return;
      r[hActiveJingle] = a;
      this.soundCmdDispatch(this.rd(JingleSongTable + (a - 0x36)));
      return;
    }
    if (r[hActiveJingle]) { r[wCurrentBGM] = a; return; }
    if (a === r[wCurrentBGM]) return;
    r[wCurrentBGM] = a;
    if (r[hSoundFlags] & 1) return;
    this.soundCmdDispatch(a);
  }
  // 00:2B54 ResumeBGM: if the music is off, turn it on and replay wCurrentBGM
  resumeBGMCmd() {
    const r = this.ram;
    if (!(r[hSoundFlags] & 1)) return;
    r[hSoundFlags] &= 0xFE;
    this.bank = DRIVER_BANK; this.soundCmdDispatch(r[wCurrentBGM]);
  }
  // 00:2B6C StopBGMIfPlaying: if the music is off, clear the flag and send command 0
  stopBGMIfPlayingCmd() {
    const r = this.ram;
    if (!(r[hSoundFlags] & 1)) return;
    r[hSoundFlags] &= 0xFE;
    this.playSoundCmd(0);
  }
  // 00:2B7A SyncBGMEnableFlag: hSoundFlags bit 0 = option bit 0; music off -> song 0
  syncBGMEnableFlagCmd(opt) {
    const r = this.ram;
    r[hSoundFlags] = (r[hSoundFlags] & 0xFE) | (opt & 1);
    if (r[hSoundFlags] & 1) { this.bank = DRIVER_BANK; this.soundCmdDispatch(0); }
  }
  // 00:2B98 ApplyMusicOption: as SyncBGMEnableFlag, and music on replays wCurrentBGM
  applyMusicOptionCmd(opt) {
    const r = this.ram;
    r[hSoundFlags] = (r[hSoundFlags] & 0xFE) | (opt & 1);
    this.bank = DRIVER_BANK;
    this.soundCmdDispatch(r[hSoundFlags] & 1 ? 0 : r[wCurrentBGM]);
  }
  // 00:2C35, the end of WaitJingleEnd (00:2C1F; its wait loop is the caller's): the jingle is over, replay the BGM
  endJingleCmd() {
    const r = this.ram;
    r[hActiveJingle] = 0;
    if (r[hSoundFlags] & 1) return;
    this.bank = DRIVER_BANK; this.soundCmdDispatch(r[wCurrentBGM]);
  }
  // 00:2C4A ResumeBGMAfterJingle: when the jingle's channels are idle, replay wCurrentBGM
  resumeBGMAfterJingle() {
    const r = this.ram;
    if (!r[hActiveJingle]) return;
    if (r[wChannelActive] | r[wChannelActive + 1] | r[wChannelActive + 2] | r[wChannelActive + 3]) return;
    r[hActiveJingle] = 0;
    if (r[hSoundFlags] & 1) return;
    this.bank = DRIVER_BANK;
    this.soundCmdDispatch(r[wCurrentBGM]);
  }

  // ---- bank 7E: music ----
  // 7E:4016 SoundCmdDispatch
  soundCmdDispatch(a) { if (a < this.rd(SongCountData)) this.ram[wMusicRequest] = a; }
  // 7E:4022 SoundRequestSFX: the lower priority value wins; an equal one replaces
  soundRequestSFX(c) {
    let b = 0;
    if (c !== 0) {
      b = this.rd(SFXPriorityTable + c);
      const p = this.ram[wSFXPriority];
      if (p !== 0 && p < b) return;
    }
    this.ram[wSFXPriority] = b; this.ram[wSFXRequest] = c;
  }
  // 7E:4072 SoundInit
  soundInit() {
    const r = this.ram;
    this.reg(0x26, 0); this.reg(0x26, 0x80); this.reg(0x24, 0x77); this.reg(0x25, 0xFF);
    r[wSoundBank] = 0x7E; r[wMusicRequest] = 0x80; r[wSFXRequest] = 0x80; r[wMasterVolume] = 0x77;
    r[wSFXChannelMask] = 0; r[wSFXActive] = 0; r[wWaveReload] = 0; r[wNoiseActive] = 0; r[wSoundMuteMask] = 0;
    r[wSoundPaused] = 0;
    r[wChRelease] = r[wChRelease + 1] = r[wChRelease + 2] = 0x46;
    r[wPanning] = 0xFF;
    for (let c = 0; c < 4; c++) {
      r[wChannelActive + c] = 0; r[wChNoteState + c] = 0; r[0xC4F3 + c] = 0; r[wChTranspose + c] = 0; r[wChGate + c] = 0;
    }
    for (let i = 0; i < 8; i++) r[wChStackPtr + i] = this.rd(MusicStackInitTable + i);
  }
  // 7E:40EB SoundUpdate
  soundUpdate() {
    const r = this.ram;
    this.soundHandleRequests();                        // (7E:42B8 SoundNop first)
    this.bank = SFX_BANK; this.sfxUpdate(); this.bank = DRIVER_BANK;    // farcall 7F:406C
    r[hSoundROMBank] = r[wSoundBank]; this.bank = r[wSoundBank];
    if (r[wSoundPaused]) this.soundSilenceAll();
    else { this.musicUpdateCh1(); this.musicUpdateCh2(); this.musicUpdateCh3(); this.musicUpdateCh4(); }
    this.soundUpdatePanning();
    this.soundCheckMusicEnd();
  }
  // 7E:4119 SoundHandleRequests
  soundHandleRequests() {
    const r = this.ram;
    if (!(r[wMusicRequest] & 0x80)) {
      this.soundSilenceMusicChannels();
      this.songStart(r[wMusicRequest]);
      r[wMusicRequest] |= 0x80;
    }
    if (!(r[wSFXRequest] & 0x80)) {
      this.bank = SFX_BANK; this.sfxStart(r[wSFXRequest]); this.bank = DRIVER_BANK;   // farcall 7F:400A
      r[wSFXRequest] |= 0x80;
    }
  }
  // 7E:4145 SoundSilenceMusicChannels
  soundSilenceMusicChannels() {
    const r = this.ram, d = r[wSFXChannelMask];
    r[wChannelActive] = 0;
    if (!(d & 1)) { this.reg(0x12, 0x08); this.reg(0x14, 0x80); }
    r[wChannelActive + 1] = 0;
    if (!(d & 2)) { this.reg(0x17, 0x08); this.reg(0x19, 0x80); }
    r[wChannelActive + 3] = 0;
    if (!(d & 8)) { this.reg(0x21, 0x08); this.reg(0x23, 0x80); }
    r[wChannelActive + 2] = 0;
    if (!(d & 4)) this.reg(0x1C, 0x00);
  }
  // 7E:4186 SongStart: maps the song's bank (the driver code is the same in each) and sets up its channels
  songStart(a) {
    const r = this.ram;
    const bank = this.rd(SongBankTable + a);
    r[wSoundBank] = bank; r[hSoundROMBank] = bank; this.bank = bank;
    let hl = this.rw((SongTable + ((a * 2) & 0xFF)) & 0xFFFF);
    let e = this.rd(hl), bc = hl + 1;
    const ptr = () => { const v = this.rd(bc); bc = (bc + 1) & 0xFFFF; return v; };
    // channel 1
    let cy = e & 1; e >>= 1;
    if (cy) {
      let v = ptr(); r[wChScriptPtr] = v; r[wChLoopPoint] = v;
      v = ptr(); r[wChScriptPtr + 1] = v; r[wChLoopPoint + 1] = v;
      r[wChNoteTimer] = 1; r[wChannelActive] = 1;
      r[wChNoteState] = 0; r[wChDetune] = 0; r[wChGate] = 0;
      r[wChVibratoDelay] = 1; r[wChTranspose] = 0;
      r[wChEnvelope] = 0xC0; r[wChRelease] = 0x46;
      r[wChStackPtr] = this.rd(MusicStackInitTable); r[wChStackPtr + 1] = this.rd(MusicStackInitTable + 1);
      r[wChParamE9] = 0x08;
    }
    // channel 2 (its envelope and release go to channel 1's bytes: the ROM writes $C527 / $C52A here too)
    cy = e & 1; e >>= 1;
    if (cy) {
      let v = ptr(); r[wChScriptPtr + 2] = v; r[wChLoopPoint + 2] = v;
      v = ptr(); r[wChScriptPtr + 3] = v; r[wChLoopPoint + 3] = v;
      r[wChNoteTimer + 1] = 1; r[wChannelActive + 1] = 1;
      r[wChNoteState + 1] = 0; r[wChDetune + 1] = 0; r[wChGate + 1] = 0;
      r[wChVibratoDelay + 1] = 1; r[wChTranspose + 1] = 0;
      r[wChEnvelope] = 0xC0; r[wChRelease] = 0x46;
      r[wChStackPtr + 2] = this.rd(MusicStackInitTable + 2); r[wChStackPtr + 3] = this.rd(MusicStackInitTable + 3);
      r[wChParamE9 + 1] = 0x08;
    }
    // channel 3
    cy = e & 1; e >>= 1;
    if (cy) {
      let v = ptr(); r[wChScriptPtr + 4] = v; r[wChLoopPoint + 4] = v;
      v = ptr(); r[wChScriptPtr + 5] = v; r[wChLoopPoint + 5] = v;
      r[wChNoteTimer + 2] = 1; r[wChannelActive + 2] = 1;
      r[wChNoteState + 2] = 0; r[wChDetune + 2] = 0; r[wChGate + 2] = 0;
      r[wChVibratoDelay + 2] = 0; r[wChTranspose + 2] = 0;
      r[wChStackPtr + 4] = this.rd(MusicStackInitTable + 4); r[wChStackPtr + 5] = this.rd(MusicStackInitTable + 5);
      r[wChParamE9 + 2] = 0x40;
    }
    // channel 4 (its detune byte is $C530, the low byte of wNoisePtr)
    cy = e & 1; e >>= 1;
    if (cy) {
      let v = ptr(); r[wChScriptPtr + 6] = v; r[wChLoopPoint + 6] = v;
      v = ptr(); r[wChScriptPtr + 7] = v; r[wChLoopPoint + 7] = v;
      r[wChNoteTimer + 3] = 1; r[wChannelActive + 3] = 1;
      r[wChNoteState + 3] = 0; r[wChGate + 3] = 0; r[wChVibratoDelay + 3] = 0; r[wChTranspose + 3] = 0;
      r[wChStackPtr + 6] = this.rd(MusicStackInitTable + 6); r[wChStackPtr + 7] = this.rd(MusicStackInitTable + 7);
      r[wChParamE9 + 3] = 0x40;
    }
    r[wSoundPaused] = 0;
  }
  // 7E:42B9 MusicUpdateCh1
  musicUpdateCh1() {
    const r = this.ram;
    if (!r[wChannelActive]) { this.musicChOff(0); return; }
    if (r[wChNotePitch]) {
      r[wChGateTimer] = (r[wChGateTimer] - 1) & 0xFF;
      if (!r[wChGateTimer] && r[wChNoteTimer] !== 1 && !(r[wSFXChannelMask] & 1)) this.musicCh1NoteOff();
    }
    r[wChNoteTimer] = (r[wChNoteTimer] - 1) & 0xFF;
    if (!r[wChNoteTimer]) {
      this.musicRunScript(this.word(wChScriptPtr), 0);
      if (!r[wChannelActive]) { this.musicChOff(0); return; }
      this.musicCh1NoteOn();
    }
    this.musicApplyVibrato(0);
  }
  // 7E:4308 MusicUpdateCh2
  musicUpdateCh2() {
    const r = this.ram;
    if (!r[wChannelActive + 1]) { this.musicChOff(1); return; }
    if (r[wChNotePitch + 1]) {
      r[wChGateTimer + 1] = (r[wChGateTimer + 1] - 1) & 0xFF;
      if (!r[wChGateTimer + 1] && r[wChNoteTimer + 1] !== 1 && !(r[wSFXChannelMask] & 2)) this.musicCh2NoteOff();
    }
    r[wChNoteTimer + 1] = (r[wChNoteTimer + 1] - 1) & 0xFF;
    if (!r[wChNoteTimer + 1]) {
      this.musicRunScript(this.word(wChScriptPtr + 2), 1);
      if (!r[wChannelActive + 1]) { this.musicChOff(1); return; }
      this.musicCh2NoteOn();
    }
    this.musicApplyVibrato(1);
  }
  // 7E:4359 MusicUpdateCh3
  musicUpdateCh3() {
    const r = this.ram;
    if (!r[wChannelActive + 2]) { this.musicChOff(2); return; }
    if (r[wChNotePitch + 2]) {
      r[wChGateTimer + 2] = (r[wChGateTimer + 2] - 1) & 0xFF;
      if (!r[wChGateTimer + 2] && !(r[wSFXChannelMask] & 4) && r[wChNoteTimer + 2] !== 1) this.reg(0x1C, r[wChParamE9 + 2]);
    }
    r[wChNoteTimer + 2] = (r[wChNoteTimer + 2] - 1) & 0xFF;
    if (!r[wChNoteTimer + 2]) {
      this.musicRunScript(this.word(wChScriptPtr + 4), 2);
      if (!r[wChannelActive + 2]) { this.musicChOff(2); return; }
      this.musicCh3NoteOn();
    }
    this.musicApplyVibrato(2);
  }
  // 7E:43AE MusicUpdateCh4
  musicUpdateCh4() {
    const r = this.ram;
    if (!r[wChannelActive + 3]) { this.musicChOff(3); return; }
    r[wChNoteTimer + 3] = (r[wChNoteTimer + 3] - 1) & 0xFF;
    if (r[wChNoteTimer + 3]) { if (r[wNoiseActive]) this.musicCh4NoiseStep(); return; }
    this.musicRunScript(this.word(wChScriptPtr + 6), 3);
    if (!r[wChannelActive + 3]) { this.musicChOff(3); return; }
    this.musicCh4NoteOn();
  }
  // the inactive-channel tails of MusicUpdateCh1-4 (7E:42F8, 4349, 439E, 43DB): silence unless an effect holds it
  musicChOff(c) {
    const r = this.ram;
    if (r[wSFXChannelMask] & (1 << c)) return;
    if (c === 0) { this.reg(0x12, 0x08); this.reg(0x14, 0x80); }
    else if (c === 1) { this.reg(0x17, 0x08); this.reg(0x19, 0x80); }
    else if (c === 2) { this.reg(0x1C, 0x00); this.reg(0x1E, 0x80); }
    else { r[wNoiseActive] = 0; this.reg(0x21, 0x08); this.reg(0x23, 0x80); }
  }
  // 7E:43EF MusicRunScript and the commands of MusicCommandTable (7E:4407); stops at a note (MusicPlayNote) or an end
  // (each command returns through 7E:46F4 MusicNextCommand; the stack commands get and set wChStackPtr with
  // 7E:46E0 MusicGetStackPtr / 7E:46E9 MusicSetStackPtr)
  musicRunScript(hl, c) {
    const r = this.ram;
    const arg = () => { const v = this.rd(hl); hl = (hl + 1) & 0xFFFF; return v; };
    for (let guard = 0; guard < 0x100000; guard++) {
      const a = arg();
      if (a < 0xD0) { this.musicPlayNote(a, hl, c); return; }
      switch (a) {
        case 0xD0: r[wChLengthUnit + c] = arg(); break;                     // 7E:456F MusicCmdLengthUnit
        case 0xD1: case 0xD2: case 0xD3: case 0xD4: case 0xD5: case 0xD6:   // 7E:457A MusicCmdOctave
          r[wChOctave + c] = ((a & 7) - 1 + (c === 2 ? 1 : 0)) & 0xFF; break;
        case 0xD7: r[wChOctave + c] = (r[wChOctave + c] + 1) & 0xFF; break;  // 7E:4592 MusicCmdOctaveUp
        case 0xD8: r[wChOctave + c] = (r[wChOctave + c] - 1) & 0xFF; break;  // 7E:459A MusicCmdOctaveDown
        case 0xD9: r[wChNoteState + c] = 0x80; break;                       // 7E:45A2 MusicCmdTie
        case 0xDC: {                                                        // 7E:45AB MusicCmdPanning
          let v = arg(), e = 0xEE;
          for (let k = 0; k < c; k++) { v = rlc8(v); e = rlc8(e); }
          r[wPanning] = (r[wPanning] & e) | v; break;
        }
        case 0xDD: this.ww(wChLoopPoint + 2 * c, hl - 1); break;            // 7E:45C6 MusicCmdSetLoopPoint
        case 0xDE: hl = this.word(wChLoopPoint + 2 * c); break;             // 7E:45D4 MusicCmdGotoLoopPoint
        case 0xDF: {                                                        // 7E:45E0 MusicCmdRepeatStart
          const n = arg(); let sp = this.word(wChStackPtr + 2 * c);
          this.wr(sp, hl & 0xFF); this.wr(sp + 1, hl >> 8); this.wr(sp + 2, n);
          this.ww(wChStackPtr + 2 * c, (sp + 3) & 0xFFFF); break;
        }
        case 0xE0: {                                                        // 7E:45F5 MusicCmdRepeatEnd
          const sp = (this.word(wChStackPtr + 2 * c) - 1) & 0xFFFF;
          const n = (this.rd(sp) - 1) & 0xFF;
          if (n) { this.wr(sp, n); hl = this.rd(sp - 2) | (this.rd(sp - 1) << 8); }
          else this.ww(wChStackPtr + 2 * c, (sp - 2) & 0xFFFF);
          break;
        }
        case 0xE1: hl = this.rw(hl); break;                                  // 7E:460F MusicCmdJump
        case 0xE2: {                                                        // 7E:4616 MusicCmdCall
          const sp = this.word(wChStackPtr + 2 * c);
          this.wr(sp, hl & 0xFF); this.wr(sp + 1, hl >> 8);
          hl = this.rw(hl);
          this.ww(wChStackPtr + 2 * c, (sp + 2) & 0xFFFF); break;
        }
        case 0xE3: {                                                        // 7E:462D MusicCmdReturn
          const sp = (this.word(wChStackPtr + 2 * c) - 2) & 0xFFFF;
          hl = ((this.rd(sp) | (this.rd(sp + 1) << 8)) + 2) & 0xFFFF;
          this.ww(wChStackPtr + 2 * c, sp); break;
        }
        // the per-channel parameters below are 3-byte arrays in RAM for some: channel 4 writes the next array's first byte
        case 0xE4: this.wr(wChDetune + c, arg()); break;                    // 7E:463E MusicCmdDetune
        case 0xE5: this.wr(wChDuty + c, arg() & 0xC0); break;               // 7E:464B MusicCmdDuty
        case 0xE6: this.wr(wChEnvelope + c, arg()); break;                  // 7E:465A MusicCmdEnvelope
        case 0xE7: r[wWaveIndex] = arg(); r[wWaveReload] = 1; break;        // 7E:4667 MusicCmdWave
        case 0xE8: r[wChGate + c] = arg(); break;                           // 7E:4677 MusicCmdGate
        case 0xE9: r[wChParamE9 + c] = arg(); break;                        // 7E:4684 MusicCmdParamE9
        case 0xEA: { const v = arg(); r[wChVibratoIndex + c] = v; r[wChVibratoType + c] = v; break; }  // 7E:4691
        case 0xEB: r[wChVibratoDelay + c] = arg(); break;                   // 7E:46A3 MusicCmdVibratoDelay
        case 0xEC: r[wChTranspose + c] = arg(); break;                      // 7E:46B0 MusicCmdTranspose
        case 0xED: r[wChTranspose + c] = (r[wChTranspose + c] + arg()) & 0xFF; break;   // 7E:46BD
        case 0xEE: this.wr(wChRelease + c, arg()); break;                   // 7E:46CB MusicCmdRelease
        default: r[wChannelActive + c] = 0; return;                         // 7E:46D8 MusicCmdEnd ($DA $DB $EF-$FF)
      }
    }
    throw new Error(`music script of channel ${c + 1} does not reach a note`);
  }
  // 7E:4467 MusicPlayNote (hl = the byte after the note)
  musicPlayNote(note, hl, c) {
    const r = this.ram;
    const next = this.rd(hl);                       // a $D9 (tie) after the note: the note sounds its whole length
    if (r[wChNoteState + c] !== 0x80) {
      r[wChNoteState + c] = 1; r[wChVibratoPos + c] = 0; r[wChVibratoWait + c] = 1;
      r[wChVibratoIndex + c] = r[wChVibratoType + c];
    }
    // duration = (low nibble + 1) x length unit (8-bit)
    const len = r[wChLengthUnit + c], dur = (((note & 0x0F) + 1) * len) & 0xFF;
    r[wChNoteTimer + c] = dur;
    let gate = dur;
    if (next !== 0xD9) {
      const g = r[wChGate + c];
      if (g !== 0x08) gate = ((dur * (g || 256)) & 0xFFFF) >> 3 & 0xFF;
    }
    r[wChGateTimer + c] = gate;
    const pitch = note & 0xF0;
    r[wChNotePitch + c] = pitch;
    if (pitch) {
      const p = (pitch >> 4) - 1;
      if (c === 3) {
        // noise: NoiseInstrumentTable by octave x 12 + pitch -> panning, NR41, NR42, NR44, NR43, then the NR43 pattern
        const e = (r[wChOctave + 3] * 24) & 0xFF;
        let ptr = this.rw((NoiseInstrumentTable + ((p * 2) & 0xFF) + e) & 0xFFFF);
        const pan = this.rd(ptr++);
        r[wPanning] = (r[wPanning] & 0x77) | pan;
        r[wNoiseRegs] = this.rd(ptr++); r[wNoiseRegs + 1] = this.rd(ptr++);
        const b = this.rd(ptr++);
        r[wNoiseRegs + 2] = this.rd(ptr++); r[wNoiseRegs + 3] = b;
        this.ww(wNoisePtr, ptr & 0xFFFF);
        r[wNoiseActive] = 1;
      } else {
        const base = this.rd(MusicOctaveTable + r[wChOctave + c]);
        const t = r[wChTranspose + c];
        const idx = (p * 2 + base + t + t) & 0xFF;
        const f = this.musicAddDetune(this.rw(MusicFreqTable + idx), c);
        this.ww(wChFreq + 2 * c, f);
      }
    }
    this.ww(wChScriptPtr + 2 * c, hl);
  }
  // 7E:4982 MusicAddDetune: a negative detune subtracts its complement (-d - 1), so it is one less than it says
  musicAddDetune(de, c) {
    const a = this.rd(wChDetune + c);
    if (!(a & 0x80)) {
      const lo = (de & 0xFF) + a;
      return ((((de >> 8) + (lo >> 8)) & 0xFF) << 8) | (lo & 0xFF);
    }
    const h = a ^ 0xFF, lo = (de & 0xFF) - h;
    return ((((de >> 8) - (lo < 0 ? 1 : 0)) & 0xFF) << 8) | (lo & 0xFF);
  }
  // 7E:46F8 MusicCh1NoteOn
  musicCh1NoteOn() {
    const r = this.ram;
    if (r[wSFXChannelMask] & 1) { r[wCh1Sounding] = 0; return; }
    if (!r[wChNotePitch]) { this.musicCh1NoteOff(); return; }
    r[wCh1Sounding] = 1;
    let d = 0;
    if (r[wChNoteState] !== 0x80) { this.reg(0x12, r[wChEnvelope]); d = 0x80; }
    r[wChNoteState] = 2;
    this.reg(0x10, 0x08); this.reg(0x11, r[wChDuty]); this.reg(0x13, r[wChFreq]); this.reg(0x14, r[wChFreq + 1] | d);
  }
  // 7E:4737 MusicCh1NoteOff / 7E:47AB MusicCh2NoteOff: NRx2 = (envelope volume - release volume) | release sweep
  musicNoteOff(c) {
    const r = this.ram, sounding = wCh1Sounding + c;
    if (!r[sounding]) return;
    r[sounding] = 0; r[wChNoteState + c] = 0;
    const rel = r[wChRelease + c];
    let v = (r[wChEnvelope + c] >> 4) - (rel >> 4);
    if (v < 0) v = 0;
    const base = c === 0 ? 0x12 : 0x17;
    this.reg(base, ((v << 4) & 0xFF) | (rel & 7)); this.reg(base + 2, 0x80);
  }
  musicCh1NoteOff() { this.musicNoteOff(0); }
  musicCh2NoteOff() { this.musicNoteOff(1); }
  // 7E:476F MusicCh2NoteOn
  musicCh2NoteOn() {
    const r = this.ram;
    if (r[wSFXChannelMask] & 2) { r[wCh2Sounding] = 0; return; }
    if (!r[wChNotePitch + 1]) { this.musicCh2NoteOff(); return; }
    r[wCh2Sounding] = 1;
    let d = 0;
    if (r[wChNoteState + 1] !== 0x80) { this.reg(0x17, r[wChEnvelope + 1]); d = 0x80; }
    r[wChNoteState + 1] = 2;
    this.reg(0x16, r[wChDuty + 1]); this.reg(0x18, r[wChFreq + 2]); this.reg(0x19, r[wChFreq + 3] | d);
  }
  // 7E:47E3 MusicCh3NoteOn (a rest clears channel 1's note state, $C4D1: a ROM slip)
  musicCh3NoteOn() {
    const r = this.ram;
    if (r[wSFXChannelMask] & 4) return;
    let d = 0;
    if (r[wWaveReload]) { this.reg(0x1A, 0); this.loadWavePattern(); d = 0x80; }
    if (!r[wChNotePitch + 2]) { r[wChNoteState] = 0; this.reg(0x1A, 0); return; }
    if (r[wChNoteState + 2] !== 0x80) { this.reg(0x1C, r[wChEnvelope + 2]); this.reg(0x1A, 0); d = 0x80; }
    r[wChNoteState + 2] = 2;
    this.reg(0x1B, 0); this.reg(0x1D, r[wChFreq + 4]); this.reg(0x1A, 0x80); this.reg(0x1E, r[wChFreq + 5] | d);
  }
  // 7E:4831 LoadWavePattern
  loadWavePattern() {
    const r = this.ram;
    let hl = this.rw(WavePatternTable + ((r[wWaveIndex] * 2) & 0xFF));
    for (let i = 0; i < 16; i++) this.reg(0x30 + i, this.rd(hl++));
    r[wWaveReload] = 0;
  }
  // 7E:4851 MusicCh4NoteOn
  musicCh4NoteOn() {
    const r = this.ram;
    if (r[wSFXChannelMask] & 8) return;
    if (!r[wChNotePitch + 3]) { this.musicCh4Silence(); return; }
    for (let i = 0; i < 4; i++) this.reg(0x20 + i, r[wNoiseRegs + i]);
  }
  // 7E:4870
  musicCh4Silence() { this.ram[wNoiseActive] = 0; this.reg(0x21, 0x08); this.reg(0x23, 0x80); }
  // 7E:487F MusicCh4NoiseStep
  musicCh4NoiseStep() {
    const r = this.ram;
    if (r[wSFXChannelMask] & 8) { r[wNoiseActive] = 0; return; }
    const de = this.word(wNoisePtr), a = this.rd(de);
    if (a === 0xFF) { this.musicCh4Silence(); return; }
    this.reg(0x22, a);
    this.ww(wNoisePtr, (de + 1) & 0xFFFF);
  }
  // 7E:48A0 SoundUpdatePanning
  soundUpdatePanning() {
    const r = this.ram;
    this.reg(0x24, r[wMasterVolume]);
    let a = r[wPanning];
    const m = r[wSFXChannelMask];
    if (m) {
      const d = (m & 0x0F) | ((m & 0x0F) << 4);
      a = (r[wSFXPanning] & d) | (r[wPanning] & (~d & 0xFF));
    }
    const e = ~r[wSoundMuteMask] & 0x0F;
    this.reg(0x25, (e | (e << 4)) & a);
  }
  // 7E:492E MusicApplyVibrato (with MusicVibratoFreq 7E:48D0)
  musicApplyVibrato(c) {
    const r = this.ram;
    const de = this.musicVibratoFreq(c), e = de & 0xFF, d = de >> 8;
    if (c === 0) {
      if (!r[wChVibratoDelay] || (r[wSFXChannelMask] & 1)) return;
      this.reg(0x13, e); this.reg(0x11, this.regs.read(0x11) & 0xC0); this.reg(0x14, d);
    } else if (c === 1) {
      if (!r[wChVibratoDelay + 1] || (r[wSFXChannelMask] & 2)) return;
      this.reg(0x18, e); this.reg(0x16, this.regs.read(0x16) & 0xC0); this.reg(0x19, d);
    } else if (c === 2) {
      if (!r[wChVibratoDelay + 2] || (r[wSFXChannelMask] & 4)) return;
      this.reg(0x1D, e); this.reg(0x1B, 0); this.reg(0x1E, d);
    }
  }
  // 7E:48D0 MusicVibratoFreq: wChFreq plus the vibrato table's offset once wChVibratoDelay frames have passed
  musicVibratoFreq(c) {
    const r = this.ram, f = this.word(wChFreq + 2 * c);
    const delay = r[wChVibratoDelay + c];
    if (!delay) return f;
    if (delay !== r[wChVibratoWait + c]) { r[wChVibratoWait + c] = (r[wChVibratoWait + c] + 1) & 0xFF; return f; }
    for (let guard = 0; guard < 0x10000; guard++) {
      const pos = r[wChVibratoPos + c];
      r[wChVibratoPos + c] = (pos + 1) & 0xFF;
      const tbl = this.rw(VibratoTable + ((r[wChVibratoIndex + c] * 2) & 0xFF));
      let hl = (tbl + pos) & 0xFFFF;
      const a = this.rd(hl++);
      if (a !== 0x80) {
        const lo = (f & 0xFF) + a, sign = a & 0x80 ? 0xFF : 0;
        return ((((f >> 8) + sign + (lo >> 8)) & 0x07) << 8) | (lo & 0xFF);
      }
      r[wChVibratoPos + c] = 0;
      const nx = this.rd(hl);
      if (nx !== 0x80) r[wChVibratoIndex + c] = nx;
    }
    throw new Error(`vibrato table of channel ${c + 1} loops on $80`);
  }
  // 7E:499B SoundSilenceAll (the value written follows the a register through swaps: with channel 1 held by an
  // effect, NR22/NR24 and NR42/NR44 get the swapped effect mask, as in the ROM)
  soundSilenceAll() {
    const d = this.ram[wSFXChannelMask];
    let a = d;
    if (!(d & 1)) { a = 0x08; this.reg(0x12, a); a = swap8(a); this.reg(0x14, a); }
    if (!(d & 2)) { a = swap8(a); this.reg(0x17, a); a = swap8(a); this.reg(0x19, a); }
    if (!(d & 8)) { a = swap8(a); this.reg(0x21, a); a = swap8(a); this.reg(0x23, a); }
    if (!(d & 4)) this.reg(0x1C, 0x00);
  }
  // 7E:49CC SoundCheckMusicEnd
  soundCheckMusicEnd() {
    const r = this.ram;
    if (((r[wChannelActive] + r[wChannelActive + 1] + r[wChannelActive + 2] + r[wChannelActive + 3]) & 0xFF) === 0)
      r[wMusicRequest] = 0x80;
  }
  // exports $08-$14 (never far-called by the game; kept for completeness)
  soundSetMuteMask(a) { this.ram[wSoundMuteMask] = a & 0xFF; }                           // 7E:4043
  soundTogglePause() { this.ram[wSoundPaused] ^= 1; }                                    // 7E:405B
  soundSetMasterVolume(a) { a &= 7; this.ram[wMasterVolume] = a | (a << 4); }            // 7E:4064
  soundIsMusicPlaying() { return this.ram[wMusicRequest] === 0x80 ? 0 : 1; }                   // 7E:4047 (a)
  soundIsSFXPlaying() { return this.ram[wSFXRequest] === 0x80 ? 0 : 1; }                     // 7E:4051 (a)
  // 7E:49F7 SoundSaveState / 7E:4B1C SoundRestoreState: the copy lists of the ROM, in order
  static SAVE_LIST = [[0xC4C0, 0xC59A, 1], [0xC4C1, 0xC59B, 1], [0xC4C4, 0xC59C, 1], [0xC4C6, 0xC59D, 4],
    [0xC4CA, 0xC5A1, 1], [0xC4CB, 0xC5A2, 1], [0xC4CD, 0xC5A3, 4], [0xC4D1, 0xC5A7, 4], [0xC4D5, 0xC5AB, 8],
    [0xC4DD, 0xC5B3, 8], [0xC4EB, 0xC5BB, 2], [0xC4EF, 0xC5BD, 4], [0xC4F3, 0xC5C1, 4], [0xC4F7, 0xC5C5, 4],
    [0xC4FB, 0xC5C9, 4], [0xC4FF, 0xC5CD, 4], [0xC503, 0xC5D1, 4], [0xC507, 0xC5D5, 4], [0xC50B, 0xC5D9, 4],
    [0xC50F, 0xC5DD, 4], [0xC517, 0xC5E1, 4], [0xC51F, 0xC5E5, 4]];
  static SAVE_TAIL = [[0xC527, 0xC5E9, 3], [0xC52D, 0xC5EC, 3], [0xC530, 0xC5EF, 2]];
  soundSaveState() {
    // cp: 7E:4C33 SoundCopyBytes
    const r = this.ram, cp = (s, d, n) => { for (let i = 0; i < n; i++) r[d + i] = r[s + i]; };
    for (const [s, d, n] of SoundDriver.SAVE_LIST) cp(s, d, n);
    r[0xC51B] = r[0xC51C] = r[0xC51D] = r[0xC51E] = 0;
    for (const [s, d, n] of SoundDriver.SAVE_TAIL) cp(s, d, n);
    r[0xC5F1] = 0;                                          // (wNoiseActive is saved as 0)
    cp(0xC536, 0xC5F2, 8); cp(0xC53E, 0xC5FA, 0x30);
  }
  soundRestoreState() {
    // cp: 7E:4C33 SoundCopyBytes
    const r = this.ram, cp = (s, d, n) => { for (let i = 0; i < n; i++) r[d + i] = r[s + i]; };
    for (const [s, d, n] of SoundDriver.SAVE_LIST) cp(d, s, n);
    r[wWaveReload] = 1;
    for (const [s, d, n] of SoundDriver.SAVE_TAIL) cp(d, s, n);
    r[wNoiseActive] = r[0xC5F1];
    cp(0xC5F2, 0xC536, 8); cp(0xC5FA, 0xC53E, 0x30);
  }
  // 7E:49DF SoundSaveAndStop / 7E:49EB SoundRestoreAndResume
  soundSaveAndStop() { this.soundSilenceAll(); this.soundSaveState(); this.soundSilenceMusicChannels(); return this.take(); }
  soundRestoreAndResume() { this.soundSilenceAll(); this.soundSilenceMusicChannels(); this.soundRestoreState(); return this.take(); }

  // ---- bank 7F: sound effects ----
  // 7F:400A SFXStart
  sfxStart(a) {
    const r = this.ram;
    let tbl;
    if (a >= 0x65) {
      if (a >= this.rd(SFXCountBData)) return;
      a -= 0x65; tbl = SFXTableB;
    } else {
      if (a >= this.rd(SFXCountAData)) return;
      tbl = SFXTableA;
    }
    if (r[wSFXActive]) this.sfxSilenceActive();
    r[wSFXActive] = 1;
    let hl = this.rw((tbl + ((a * 2) & 0xFF)) & 0xFFFF);
    const m = this.rd(hl++);
    r[wSFXChannelMask] = m; r[wSFXMaskScratch] = m;
    for (let c = 0; c < 4; c++) {
      const s = r[wSFXMaskScratch]; r[wSFXMaskScratch] = rrc8(s);
      if (s & 1) {
        r[wSFXChScriptPtr + 2 * c] = this.rd(hl++); r[wSFXChScriptPtr + 2 * c + 1] = this.rd(hl++);
        r[wSFXChSlide + c] = 0; r[wSFXChWait + c] = 1;
      }
    }
  }
  // 7F:406C SFXUpdate
  sfxUpdate() {
    const r = this.ram;
    if (!r[wSFXChannelMask]) { this.sfxClearState(); return; }
    r[wSFXMaskScratch] = r[wSFXChannelMask];
    for (let c = 0; c < 4; c++) {
      const s = r[wSFXMaskScratch]; r[wSFXMaskScratch] = rrc8(s);
      if (!(s & 1)) continue;
      const w = (r[wSFXChWait + c] - 1) & 0xFF;
      if (w) { r[wSFXChWait + c] = w; this.sfxApplySlide(c); }
      else this.sfxRunScript(this.word(wSFXChScriptPtr + 2 * c), c);
    }
  }
  // NRx1 of channel c ($FF11 + 5c); the driver keeps only the duty bits it reads back
  sfxDutyKeep(c) { const n = 0x11 + c * 5; this.reg(n, this.regs.read(n) & 0xC0); return n; }
  // 7F:40A4 SFXRunScript and the commands of SFXCommandTable (7F:40BB)
  sfxRunScript(hl, c) {
    const r = this.ram;
    const arg = () => { const v = this.rd(hl); hl = (hl + 1) & 0xFFFF; return v; };
    const save = () => this.ww(wSFXChScriptPtr + 2 * c, hl);
    for (let guard = 0; guard < 0x100000; guard++) {
      const op = arg(), lo = op & 0x0F;
      switch (op >> 4) {
        case 0x0: {                                       // 7F:40DE SFXCmdNote: frequency (noise: NR43), ends the frame
          let d = lo; const e = arg();
          const f = wSFXChFreq + 2 * c, old = r[f];
          r[f] = e; r[f + 1] = d;
          if (c === 3) d = swap8((old ^ e) & 0x08);
          d |= r[wSFXChTrigger + c]; r[wSFXChTrigger + c] = 0;
          const n = this.sfxDutyKeep(c);
          this.reg(n + 2, e); this.reg(n + 3, d);
          save(); return;
        }
        case 0x1: {                                       // 7F:411E SFXCmdEnvelope
          r[wSFXChTrigger + c] = 0x80;
          this.reg(0x12 + c * 5, arg()); break;
        }
        case 0x2: this.reg(0x11 + c * 5, swap8(lo)); break;   // 7F:4137 SFXCmdDuty
        case 0x3: {                                       // 7F:4148 SFXCmdLoopStart
          const n = arg(); this.ww(wSFXChLoopPtr + 2 * c, hl); r[wSFXChLoopCount + c] = n; break;
        }
        case 0x4: {                                       // 7F:415D SFXCmdLoopEnd
          const n = (r[wSFXChLoopCount + c] - 1) & 0xFF;
          if (n) { r[wSFXChLoopCount + c] = n; hl = this.word(wSFXChLoopPtr + 2 * c); }
          break;
        }
        case 0x5: r[wSFXChSlide + c] = arg(); break;      // 7F:4176 SFXCmdSlide
        case 0x6: {                                       // 7F:4182 SFXCmdWait: one slide step, then wait; ends the frame
          if (c === 3) this.sfxApplyNoiseSlide(); else this.sfxApplySlide(c);
          r[wSFXChWait + c] = arg();
          save(); return;
        }
        case 0x7: {                                       // 7F:4212 SFXCmdWave
          let p = this.rw(SFXWaveTable + ((lo * 2) & 0xFF));
          this.reg(0x1A, 0);
          for (let i = 0; i < 16; i++) this.reg(0x30 + i, this.rd(p++));
          r[wWaveReload] = 1;
          this.reg(0x1A, 0x80); break;
        }
        case 0x8: {                                       // 7F:423D SFXCmdPanning
          let v = arg(), e = 0xEE;
          for (let k = 0; k < c; k++) { v = rlc8(v); e = rlc8(e); }
          r[wSFXPanning] = (r[wSFXPanning] & e) | v; break;
        }
        case 0xE: {                                       // 7F:4259 SFXCmdBallPitch: frequency by the ball's height
          const h = this.word(wSFXBallHeight);
          const de = this.rw((SFXHeightFreqTable + ((h >> 1) & 0xFFFE)) & 0xFFFF);
          const e = de & 0xFF; let d = de >> 8;
          this.ww(wSFXChFreq + 2 * c, de);
          d |= r[wSFXChTrigger + c]; r[wSFXChTrigger + c] = 0;
          const n = this.sfxDutyKeep(c);
          this.reg(n + 2, e); this.reg(n + 3, d);
          save(); return;
        }
        case 0xF: {                                       // 7F:429B SFXCmdEnd
          r[wSFXChannelMask] &= ~(1 << c) & 0xFF;
          this.reg(0x12 + c * 5, 0x08); this.reg(0x14 + c * 5, 0x80);
          return;
        }
        default:                                          // $9x-$Dx: 7F:40DB jumps to itself in the ROM (a hang)
          throw new Error(`effect command $${op.toString(16)} hangs the ROM (7F:40DB)`);
      }
    }
    throw new Error(`effect script of channel ${c + 1} does not end a frame`);
  }
  // 7F:419D SFXApplySlide (also run for the noise channel by SFXUpdate: then on NR41/NR43/NR44)
  sfxApplySlide(c) {
    const r = this.ram, s = r[wSFXChSlide + c];
    if (!s) return;
    const f = wSFXChFreq + 2 * c;
    let lo, hi;
    if (s & 0x80) { lo = r[f] - ((-s) & 0xFF); hi = r[f + 1] - (lo < 0 ? 1 : 0); }
    else { lo = r[f] + s; hi = r[f + 1] + (lo > 0xFF ? 1 : 0); }
    lo &= 0xFF; hi &= 0xFF;
    r[f] = lo; r[f + 1] = hi;
    const d = hi | r[wSFXChTrigger + c]; r[wSFXChTrigger + c] = 0;
    const n = this.sfxDutyKeep(c);
    this.reg(n + 2, lo); this.reg(n + 3, d);
  }
  // 7F:41DD SFXApplyNoiseSlide
  sfxApplyNoiseSlide() {
    const r = this.ram, s = r[wSFXCh4Slide];
    if (!s) return;
    const e = r[wSFXCh4Poly];
    const a = (s & 0x80 ? e - ((-s) & 0xFF) : e + s) & 0xFF;
    r[wSFXCh4Poly] = a;
    const t = swap8((a ^ e) & 0x08) | r[wSFXCh4Trigger]; r[wSFXCh4Trigger] = 0;
    this.reg(0x20, 0); this.reg(0x22, a); this.reg(0x23, t);
  }
  // 7F:42BE SFXClearState
  sfxClearState() { const r = this.ram; r[wSFXActive] = 0; r[wSFXPriority] = 0; r[wSFXRequest] = 0x80; }
  // 7F:42CB SFXSilenceAllBroken (unreferenced): its NRx2 / NRx4 "writes" are ldh a, [n] reads, so it only clears the mask
  sfxSilenceAllBroken() { this.ram[wSFXChannelMask] = 0; }
  // 7F:42E2 SFXSilenceActive
  sfxSilenceActive() {
    const r = this.ram, m = r[wSFXChannelMask];
    if (m & 1) { this.reg(0x12, 0x08); this.reg(0x14, 0x80); }
    if (m & 2) { this.reg(0x17, 0x08); this.reg(0x19, 0x80); }
    if (m & 4) { this.reg(0x1C, 0x08); this.reg(0x1E, 0x80); }
    if (m & 8) { this.reg(0x21, 0x08); this.reg(0x23, 0x80); }
    r[wSFXChannelMask] = 0;
  }
}

// the ids the game can play: songs 0..count-1 (SoundCmdDispatch rejects the rest), effects 0..$6B (SFXStart's limits)
export function soundIds(rom) {
  const at = (bank, addr) => rom[bank * 0x4000 + addr - 0x4000];
  const songs = at(DRIVER_BANK, SongCountData);
  const effects = [];
  for (let i = 0; i < 0x65 && i < at(SFX_BANK, SFXCountAData); i++) effects.push(i);
  for (let i = 0x65; i < at(SFX_BANK, SFXCountBData); i++) effects.push(i);
  return { songs, effects };
}
