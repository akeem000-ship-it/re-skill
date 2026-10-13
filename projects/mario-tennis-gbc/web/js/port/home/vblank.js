// The interrupt handlers (VBlank, LCD STAT, timer; the serial one is in link.js), waiting for VBlank, and the
// small soft-reset helpers (vblank_00.asm; EnableTimerInterrupt from timer_00.asm).
// Port of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses.
// Covered by the routine tests (web/tests/port/routines_home_system.mjs) and the lockstep on out/engine/*.mtrec.
//
// Not ported: ShortDelay (00:2821) and WaitSerialTransfer (00:282E) are busy loops that measure CPU time (a delay;
// a timeout counted in loop iterations), which ported code does not take; they stay the ROM's (link play only).
import { SoftResetSignal } from "../port.js";
import { FLAG_H, getRegs, setRegs, spinUntil } from "./cpu.js";
import { readJoypad, advanceRandomSeed } from "./joypad.js";
import { updateGameTimer } from "./flags.js";
import { updateDebugOverlay } from "./debugtext.js";

const rIF = 0xFF0F, rLCDC = 0xFF40, rSCY = 0xFF42, rSCX = 0xFF43, rLY = 0xFF44, rDMA = 0xFF46, rVBK = 0xFF4F, rIE = 0xFFFF;
const LCDC_ON = 0x80, LCDC_BG_MAP_9C00 = 0x08;
const IE_TIMER = 0x04, IF_SERIAL = 0x08;
const PAD_RESET = 0x0F;                                          // A+B+SELECT+START held, nothing else
const SPRITE_PAGE_FLIP = 0x05;                                   // wSpriteBufferPage alternates $C0 / $C5
const DEBUG_CONSOLE_SCY = 0x40;                                  // the debug console's scroll (on the $9C00 map)
export const LINKSTATE_MASTER = 0x01, LINKSTATE_SLAVE = 0x02;
// routines other parts of the port own, still run as the ROM's code (they become direct calls once ported)
const ApplyPendingPaletteUpdates = 0x060D, ProcessVRAMCopyQueues = 0x052E, ProcessBGBlitQueue = 0x218D;
const UpdateFadeIn = 0x1D48, UpdateFadeOut = 0x1D5E, UpdateSoundEngine = 0x2F1A;

// VBlankHandler (00:2749). Unless the link code suppresses it: the palettes the game changed go to the hardware;
// if the frame's work is done (hVBlankOccurred clear: the game has reached AdvanceFrame), the scroll, the sprites
// (OAM DMA from the sprite buffer the game just finished), the queued BG blits or VRAM copies and the debug
// overlay; hVBlankOccurred set and hVBlankCounter counted. Then (except during a link exchange, which reads the
// pad itself) the pad, a soft reset on A+B+SELECT+START, the random seed; then the play-time clock, the fades and
// the sound driver, every VBlank.
export function vBlankHandler(P) {
  const { V, A, bus } = P;
  if (V.vBlankSuppressed) return;
  const vbk = bus.u8(rVBK);
  P.callRom(0, ApplyPendingPaletteUpdates);
  if (!V.vBlankOccurred) {
    if (!V.showDebugConsole) {                                   // the game's own scroll, on the $9800 map
      bus.w8(rSCX, V.scrollX); bus.w8(rSCY, V.scrollY);
      bus.w8(rLCDC, bus.u8(rLCDC) & ~LCDC_BG_MAP_9C00);
    } else if (V.showDebugConsole === 1) {                       // the debug console, on the $9C00 map
      bus.w8(rSCX, 0); bus.w8(rSCY, DEBUG_CONSOLE_SCY);
      bus.w8(rLCDC, bus.u8(rLCDC) | LCDC_BG_MAP_9C00);
    } else {
      bus.w8(rSCX, V.scrollX); bus.w8(rSCY, V.scrollY);
    }
    // the sprites: hOAMDMARoutine (the HRAM routine CopyOAMDMARoutineToHRAM installed) with its page operand
    // set to the buffer the game finished last frame, i.e. OAM DMA from it
    const page = V.spriteBufferPage ^ SPRITE_PAGE_FLIP;
    bus.w8(A.oAMDMARoutine + 1, page);
    bus.w8(rDMA, page);
    const columnBlitted = P.callRom(0, ProcessBGBlitQueue).a;
    if (!columnBlitted) P.callRom(0, ProcessVRAMCopyQueues);   // (a BG column blit takes this VBlank's time)
    if (V.debugStepMode) updateDebugOverlay(P);
    V.vBlankOccurred = 1;
    V.vBlankCounter = (V.vBlankCounter + 1) & 0xFF;
  }
  if (!V.linkExchangeActive) {
    readJoypad(P);
    if (V.playerInputFlags === PAD_RESET) throw new SoftResetSignal();   // jp SoftReset
    advanceRandomSeed(P);
  }
  updateGameTimer(P);
  P.callRom(0, UpdateFadeOut);
  P.callRom(0, UpdateFadeIn);
  P.callRom(0, UpdateSoundEngine);
  bus.w8(rVBK, vbk);
}

// TimerHandler (00:27D7): with the LCD off (no VBlanks: loading) the timer interrupt runs the sound driver
// instead. A link slave with a serial byte due leaves it alone.
export function timerHandler(P) {
  const { V, bus } = P;
  if (V.linkState === LINKSTATE_SLAVE && bus.u8(rIF) & IF_SERIAL) return;
  if (bus.u8(rLCDC) & LCDC_ON) return;
  P.callRom(0, UpdateSoundEngine);
}

// LCDStatHandler (00:27F5): the raster split (LYC interrupt): from line wRasterScrollStartLY the BG scrolls by
// wRasterScrollX, and from wRasterScrollEndLY not at all (rLY is read again for the second test, as the ROM does).
export function lcdStatHandler(P) {
  const { V, bus } = P;
  if (bus.u8(rLY) < V.rasterScrollStartLY) return;
  bus.w8(rSCX, V.rasterScrollX);
  if (bus.u8(rLY) < V.rasterScrollEndLY) return;
  bus.w8(rSCX, 0);
}

// an interrupt handler's hook: every register kept, and `reti`
const handlerHook = fn => (P, c) => {
  const saved = getRegs(c);
  fn(P);
  setRegs(c, saved);
  P.ime = true;
};

// WaitVBlank (00:2814): wait for the next VBlank handler run (with interrupts on). Leaves a = hVBlankOccurred
// (1), F = H (from `and a`), interrupts on.
export function* waitVBlank(P) {
  P.V.vBlankOccurred = 0;
  yield* spinUntil(P, () => P.V.vBlankOccurred);
  P.ei();
}

// EnableTimerInterrupt (00:2A0E): unmask the timer interrupt (any pending interrupt request dropped). Leaves
// a = rIE, F clear, interrupts on.
export function enableTimerInterrupt(P) {
  P.di();
  P.bus.w8(rIF, 0);
  const ie = P.bus.u8(rIE) | IE_TIMER;
  P.bus.w8(rIE, ie);
  P.ei();
  return ie;
}

// SoftResetIfABStartSelect (00:2855): soft reset if a is A+B+SELECT+START; else a ^= that, F clear.
// JumpSoftReset (00:285D): soft reset. Both `jp SoftReset`: the port throws SoftResetSignal, which restarts the
// game's coroutine at SoftReset (port.js).
export function softResetIfABStartSelect(P, a) {
  if ((a ^ PAD_RESET) === 0) throw new SoftResetSignal();
  return a ^ PAD_RESET;
}

export const HOOKS = [
  [0, 0x2749, handlerHook(vBlankHandler)],
  [0, 0x27D7, handlerHook(timerHandler)],
  [0, 0x27F5, handlerHook(lcdStatHandler)],
  [0, 0x2814, (P, c) => (function* () { yield* waitVBlank(P); setRegs(c, { a: P.V.vBlankOccurred, f: FLAG_H }); })()],
  [0, 0x2A0E, (P, c) => setRegs(c, { a: enableTimerInterrupt(P), f: 0 })],
  [0, 0x2851, (P, c) => setRegs(c, readJoypad(P))],              // ReadJoypadThunk: call ReadJoypad
  [0, 0x2855, (P, c) => setRegs(c, { a: softResetIfABStartSelect(P, c.a), f: 0 })],
  [0, 0x285D, () => { throw new SoftResetSignal(); }],
];
