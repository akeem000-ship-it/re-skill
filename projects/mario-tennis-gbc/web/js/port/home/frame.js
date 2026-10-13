// The frame: the boot (Start) and the soft reset that sets the machine up and starts the game, AdvanceFrame (the
// game's one frame barrier, with the debug single-stepper in it) and the frame waits built on it (flags_00.asm).
// Port of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses.
// These wait, so the lockstep on out/engine/*.mtrec checks them (exh1 boots from power-on; AdvanceFrame runs every
// frame). The debug stepper and the link paths are not reached by any recording.
import { getRegs, setRegs, halt, spinUntil, push, pop, takeInlineBytes, spAddFlags } from "./cpu.js";
import { clearVRAMBank, switchCPUSpeed, farCallRom, DisableLCDSafely } from "./system.js";
import { formatHexWord, clearFrameTasks } from "./debugtext.js";
import { initSerialLink, linkErrorReset } from "./link.js";
import { LINKSTATE_SLAVE } from "./vblank.js";
import { clearMemory16, clearVRAMCopyQueue } from "./memory.js";
import { copyOAMDMARoutineToHRAM } from "./palettes.js";
import { runFrameTasks } from "./colorfade.js";
import { clearSpriteQueue, clearUnusedSprites } from "./fade.js";

const rRAMG = 0x0000, rSB = 0xFF01, rSC = 0xFF02, rTMA = 0xFF06, rTAC = 0xFF07, rIF = 0xFF0F;
const rLCDC = 0xFF40, rSTAT = 0xFF41, rSCY = 0xFF42, rSCX = 0xFF43, rLY = 0xFF44, rLYC = 0xFF45, rWY = 0xFF4A;
const rWX = 0xFF4B, rVBK = 0xFF4F, rRP = 0xFF56, rWBK = 0xFF70, rIE = 0xFFFF;
const STACK_TOP = 0xD000;
const HRAM_START = 0xFF80, HRAM_CLEARED = 0x70;                  // $FF80-$FFEF (hIsCGB and the rest stay)
const SHADOW_OAM = 0xC000, SHADOW_OAM_CLEARED_BLOCKS = 0xFF;      // $C000-$CFEF, 16 bytes a block
const WRAM_SOUND = 7, WRAMX_START = 0xD000;
const CGB_BOOT_A = 0x11;                                         // a at power-on on a Game Boy Color
const INPUT_REPEAT_DELAY = 6;                                    // frames between auto-repeats of a held button
const WX_LEFT = 7, WY_OFF_SCREEN = 0x90;                         // the window parked below the screen
const TIMER_MODULO = 0x77, TAC_START = 0x04;                     // the timer interrupt that runs sound while the LCD is off
const STAT_LYC_INTERRUPT = 0x08, LYC_RASTER = 0x50;
const SC_START = 0x80, SC_FAST = 0x02, SC_EXTERNAL = 0x00;
const IE_GAME = 0x0D;                                            // VBlank, timer, serial
const LCDC_GAME = 0xE7;                                          // on; window $9C00, on; tiles $8000; BG $9800; 8x16 sprites, on; BG on
const SPRITE_BUFFER_FIRST = 0xC0, SPRITE_PAGE_FLIP = 0x05, SPRITE_PAGE_MASK = 0xCF;
const PEAK_LY_HOLD = 0x0F;                                       // frames the peak-LY readout holds a peak
const PADF_SELECT = 0x04, PADF_START = 0x08, PAD_STEP_KEYS = 0xF3;  // d-pad, A, B: let one frame run
const STEP_MODES = 3;
const LINK_ERROR_BITS = 0xE0;
// routines other parts of the port own, still run as the ROM's code (they become direct calls once ported)
const ResumeBGMAfterJingle = 0x305D, InitAudioEngine = 0x3078;   // the sound driver's
const BANK_GAME = 0x01, InitAndRunGame = 0x4018, ShowDmgLockoutScreen = 0x6030;

// push_wram_bank ... pop_wram_bank around fn. As P.withWramBank, but hWramBank is read through the bus, as the
// ROM's `ldh a, [hWramBank]` (the lockstep test places a VBlank the ROM took mid-work by counting such reads).
function withWramBank(P, bank, fn) {
  const old = P.V.wramBank;
  P.wramBank(bank);
  fn();
  P.wramBank(old);
}

// Start (00:2578), from the cartridge entry point: note whether this is a Game Boy Color (a = $11 at power-on),
// then SoftReset.
export function* start(P, a) {
  P.V.isCGB = a === CGB_BOOT_A ? 1 : 0;
  yield* softReset(P);
}

// SoftReset (00:2582), also on A+B+SELECT+START and after a link error: a fresh stack; the LCD off (in VBlank);
// the sprite buffers, WRAM bank 0 below the stack and HRAM cleared; the interrupts and scroll reset; the DMG
// lockout screen on a plain Game Boy; VRAM cleared, double speed, the sound driver's bank cleared and the driver
// initialised; the window parked, the timer (sound with the LCD off), the LYC raster interrupt and the serial port
// set; interrupts and the LCD on; then the game (InitAndRunGame, which never returns).
export function* softReset(P) {
  const { V, A, bus } = P;
  P.cpu.sp = STACK_TOP;
  P.callRom(0, DisableLCDSafely);                                // still the ROM's: it polls rLY (see system.js)
  P.di();
  clearMemory16(P, SHADOW_OAM, SHADOW_OAM_CLEARED_BLOCKS);
  for (let i = 0; i < HRAM_CLEARED; i++) bus.w8(HRAM_START + i, 0);
  for (const r of [rIF, rIE, rSCY, rSCX, rSTAT]) bus.w8(r, 0);
  if (!V.isCGB) yield* farCallRom(P, BANK_GAME, ShowDmgLockoutScreen, 0x25AD);
  bus.w8(rVBK, 0);
  bus.w8(rWBK, 0);
  bus.w8(rRP, 0);
  bus.w8(rRAMG, 0);                                              // cartridge RAM off
  copyOAMDMARoutineToHRAM(P);
  clearVRAMBank(P);
  V.debugStepMode = 0;
  switchCPUSpeed(P, 0);
  V.inputRepeatDelay = INPUT_REPEAT_DELAY;
  clearSpriteQueue(P);
  clearFrameTasks(P);
  clearVRAMCopyQueue(P);
  withWramBank(P, WRAM_SOUND, () => {                            // the sound driver's WRAM bank, cleared
    clearMemory16(P, WRAMX_START, 0);                            // 0: 256 blocks, all 4 KB
    P.callRom(0, InitAudioEngine);
  });
  bus.w8(rWX, WX_LEFT);
  bus.w8(rWY, WY_OFF_SCREEN);
  bus.w8(rTMA, TIMER_MODULO);
  bus.w8(rTAC, 0);
  bus.w8(rTAC, bus.u8(rTAC) | TAC_START);                        // set 2, [hl]
  bus.w8(rSTAT, STAT_LYC_INTERRUPT);
  bus.w8(rLYC, LYC_RASTER);
  bus.w8(rSB, 0);
  bus.w8(rSC, SC_FAST | SC_EXTERNAL);
  bus.w8(rSC, SC_START | SC_FAST | SC_EXTERNAL);
  bus.w8(rIF, 0);
  bus.w8(rIE, IE_GAME);
  bus.w8(rLCDC, LCDC_GAME);
  P.ei();
  V.paletteDirtyFlags = 0;
  V.fadeState = 0;
  V.fadeSpeed = 0;
  V.fadeCounter = 0;
  V.spriteBufferPage = SPRITE_BUFFER_FIRST;
  initSerialLink(P);
  yield* farCallRom(P, BANK_GAME, InitAndRunGame, 0x262F, { a: 0 });
  throw new Error("InitAndRunGame returned");                    // the ROM has `stop` here
}

// ---- AdvanceFrame ----
// the peak-LY readout of the debug overlay: the highest LY seen at this point of the frame (how far the frame's
// work ran), held 15 frames, as "PPLL" (peak, this frame's LY) in wDebugPeakLYText
function trackPeakLY(P) {
  const { V, bus } = P;
  const ly = bus.u8(rLY);
  let peak = V.peakLY;
  if (peak < ly || (V.peakLYFrames = (V.peakLYFrames - 1) & 0xFF) === 0) {
    peak = ly;
    V.peakLY = ly;
    V.peakLYFrames = PEAK_LY_HOLD;
  }
  formatHexWord(P, (peak << 8) | ly, P.A.debugPeakLYText);
}
// wait for this frame's VBlank handler (over a link exchange, for the master also for the serial transfer; the
// slave does not wait). Returns with interrupts off.
// The ROM's `halt` loop wakes at every interrupt and tests hVBlankOccurred. With interrupts on the port sleeps to
// the frame boundary instead ("halt": the mid-frame handlers still run): only the VBlank handler sets the flag, and
// when the lockstep test has placed this frame's VBlank in the work already, whether the ROM's next wake is a timer
// interrupt or the next VBlank is a matter of CPU time, which ported code does not take.
function* waitForVBlank(P) {
  const { V, mem } = P;
  if (!V.linkExchangeActive) {
    for (;;) {
      if (P.ime && !(mem.iflag & mem.ie & 0x1F)) yield "halt"; else yield* halt(P);
      P.di();
      if (V.vBlankOccurred) return;
      P.ei();
    }
  }
  if (V.linkState === LINKSTATE_SLAVE) return;
  yield* spinUntil(P, () => V.vBlankOccurred & V.linkTransferDone);
  V.linkTransferDone = 0;
}
// the debug single-stepper (hDebugStepMode set): SELECT+START pauses the game here; while paused SELECT cycles the
// overlay mode 1-3, START alone resumes, and a d-pad/A/B press lets one frame run. Each pass waits for an
// interrupt (after the first VBlank hVBlankOccurred stays set, so any interrupt ends the wait).
function* debugStepper(P) {
  const { V } = P;
  if (!V.linkExchangeActive && (V.playerInputFlags & (PADF_SELECT | PADF_START)) === (PADF_SELECT | PADF_START)) V.debugStepPaused = 1;
  else if (!V.debugStepPaused) return;
  for (;;) {
    if (V.inputRisingEdge & PADF_SELECT) {
      const mode = V.debugStepMode + 1;
      V.debugStepMode = mode <= STEP_MODES ? mode : 1;
    } else if (V.playerInputFlags & PADF_START && !(V.playerInputFlags & PADF_SELECT)) {
      V.debugStepPaused = 0;
      return;
    }
    if (V.inputPressed & PAD_STEP_KEYS) return;
    if (!V.linkExchangeActive) {
      do { P.ei(); yield* halt(P); P.di(); } while (!V.vBlankOccurred);
    } else if (V.linkState !== LINKSTATE_SLAVE) {
      yield* spinUntil(P, () => V.vBlankOccurred & V.linkTransferDone);
      V.linkTransferDone = 0;
    }
    P.ei();
  }
}
// AdvanceFrame (00:2631) after the line-up: run the frame tasks, flip the sprite buffers (the game draws into one
// while the VBlank handler shows the other), resume the music after a jingle, the peak-LY readout, the debug
// stepper; then wait for the VBlank handler, and clear the sprites not drawn this frame. The link-error check at
// the top is dead (hLinkErrorFlags is only ever cleared).
function* frameWork(P) {
  const { V, bus } = P;
  if (V.linkCounter && V.linkErrorFlags & LINK_ERROR_BITS) yield* linkErrorReset(P);   // jp: it does not return
  const vbk = bus.u8(rVBK);
  V.vBlankOccurred = 0;
  runFrameTasks(P, 0);
  V.spriteBufferPage = (V.spriteBufferPage & SPRITE_PAGE_MASK) ^ SPRITE_PAGE_FLIP;
  withWramBank(P, WRAM_SOUND, () => P.callRom(0, ResumeBGMAfterJingle));
  trackPeakLY(P);
  if (V.debugStepMode) yield* debugStepper(P);
  yield* waitForVBlank(P);
  P.ei();
  bus.w8(rVBK, vbk);
  clearUnusedSprites(P);
}
// AdvanceFrame (00:2631): the game's frame barrier. All registers kept.
export function* advanceFrame(P) {
  yield* P.atAdvanceFrame();                                     // where the lockstep test lines the port up
  yield* frameWork(P);
}
// as a hook: the registers are taken after the line-up (the lockstep may copy the ROM's in there)
function* advanceFrameHook(P, cpu) {
  yield* P.atAdvanceFrame();
  const saved = getRegs(cpu);
  yield* frameWork(P);
  setRegs(cpu, saved);
}

// WaitFrames (00:2740): AdvanceFrame c times (c = 0: 256). Leaves c = 0; the rest kept. The count and af live where
// the ROM keeps them, in c and on the stack (the lockstep may copy the ROM's in at each AdvanceFrame).
export function* waitFrames(P, count) {
  do {
    yield* advanceFrame(P);
    count = (count - 1) & 0xFF;
  } while (count);
}
function* waitFramesHook(P, cpu) {
  push(P, (cpu.a << 8) | cpu.f);                                 // push af
  do {
    push(P, 0x2744);                                             // call AdvanceFrame
    yield* advanceFrameHook(P, cpu);
    pop(P);
    cpu.c = (cpu.c - 1) & 0xFF;
  } while (cpu.c);
  const af = pop(P);
  setRegs(cpu, { a: af >> 8, f: af & 0xF0 });
}
// WaitFramesCmd (00:2725): WaitFrames with the count in the byte after the call. Registers kept but F, which is
// left from its `ld hl, sp+6`.
function* waitFramesCmdHook(P, cpu) {
  push(P, cpu.bc);                                               // push bc (de and hl are pushed and popped back)
  const [count] = takeInlineBytes(P, 1, 2);
  cpu.c = count;
  cpu.f = spAddFlags((cpu.sp - 4) & 0xFFFF, 6);
  push(P, 0x273E);                                               // call WaitFrames
  yield* waitFramesHook(P, cpu);
  pop(P);
  cpu.bc = pop(P);
}

export const HOOKS = [
  [0, 0x2578, (P, c) => start(P, c.a)],
  [0, 0x2582, P => softReset(P)],
  [0, 0x2631, advanceFrameHook],
  [0, 0x2740, waitFramesHook],
  [0, 0x2725, waitFramesCmdHook],
];
