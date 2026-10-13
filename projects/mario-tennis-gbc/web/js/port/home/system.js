// Bank 0 system routines: far calls and bank-switched calls, VRAM clears, the CPU speed switch and switching the
// LCD on (vectors_00.asm).
// Port of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses.
// Covered by the routine tests (web/tests/port/routines_home_system.mjs) and the lockstep on out/engine/*.mtrec.
//
// Elsewhere: rst $00's JumpTableDispatch and JumpToHL (palettes.js), CopyDataFromBank / DecompressDataFromBank
// (decompress.js), LoadBGPaletteData / LoadOBJPaletteData (palettes.js); rst $08's PlaySoundCmd is the sound
// driver's. ReadJoypad is in joypad.js.
// Not ported here: DisableLCDSafely (00:0346) busy-waits for LY = $91 by polling rLY, which needs hardware time to
// pass while JavaScript runs (see the report); it stays the ROM's and is called with P.callRom.
// The unused routines (Unused_00_*) are not ported.
import { FLAG_Z, FLAG_H, FLAG_C, setRegs, spAddFlags, jumpTo, takeInlineBytes, push } from "./cpu.js";
import { clearMemoryBC16 } from "./memory.js";
import { clearUnusedSprites } from "./fade.js";

const rROMB0 = 0x2000, rJOYP = 0xFF00, rIF = 0xFF0F, rLCDC = 0xFF40, rSPD = 0xFF4D, rVBK = 0xFF4F;
const rIE = 0xFFFF;
const LCDC_ON = 0x80;
const SPD_DOUBLE = 0x80, SPD_PREPARE = 0x01;                        // rSPD (KEY1): current speed, switch armed
const JOYP_NONE = 0x30;                                             // neither pad row selected
export const SLOT_TABLE = 0x4000;                                  // every bank's export table, indexed by a byte offset
const VRAM_START = 0x8000, VRAM_SIZE = 0x2000;
// routines other parts of the port own, still run as the ROM's code (they become direct calls once ported)
export const DisableLCDSafely = 0x0346;                            // (here, but busy-waits on rLY: see above)
// return addresses inside FarCall and CallHLInBankA: their bank-restoring tails
const FARCALL_RETURN = 0x01D5, CALLHL_RESTORE = 0x0175;

// ldh [hRomBank], a / ld [rROMB0], a: map a ROM bank at $4000 and note it in hRomBank
export function setRomBank(P, bank) {
  P.V.romBank = bank;
  P.bus.w8(rROMB0, bank);
}

// CallHLInBankA (00:015E): call hl with ROM bank a mapped; the callee returns through .restoreBank (00:0175), which
// maps the caller's bank again. As in the ROM the callee runs on the CPU's own stack: the hook pushes the ROM's
// frame (the restoring return address, the caller's bank, h) and jumps to hl. (Pushed, sp first, as the CPU does:
// a VBlank the lockstep test places at a read in here must not land on the frame.) A, F, BC, DE, HL reach the callee
// unchanged; the callee's come back unchanged.
function callHLInBankAHook(P, c) {
  push(P, (c.h << 8) | P.V.romBank);                             // the caller's bank (with h above it)
  push(P, CALLHL_RESTORE);                                       // the callee's return address
  setRomBank(P, c.a);
  jumpTo(P, c.hl);
}
// CallHLInBankA.restoreBank (00:0175): the callee returned here; map the caller's bank and return to it
function callHLRestoreHook(P, c) {
  setRomBank(P, P.bus.u8(c.sp));
  c.sp = (c.sp + 2) & 0xFFFF;                                    // inc sp / inc sp: drop the saved bank
}

// FarCall (00:01B6), the `rst $18 ; db slot, bank` far call: call the routine at entry `slot` of the bank's $4000
// table with that bank mapped, then map the caller's bank again (in FarCall's tail, 00:01D5) and go on after the two
// operand bytes. The callee runs on the CPU with the ROM's own stack frame (so a callee that waits, or one ported to
// JavaScript, works the same), and gets A, BC, DE, HL as the caller left them; F is what CallVectorEntryA (00:01E6)
// leaves from its `ld hl, sp+5`. Its A, F, BC, DE, HL come back to the caller.
// JavaScript code calls a far routine directly instead (or with P.callRom(bank, addr) while it is the ROM's).
export function farCallTarget(P, slot, bank) { return P.rom.u16(bank, SLOT_TABLE | slot); }
function farCallHook(P, c) {
  const [slot, bank] = takeInlineBytes(P, 2);                    // the return address now points past them
  push(P, c.hl);                                                 // push hl
  push(P, (c.a << 8) | P.V.romBank);                             // push af, its F byte replaced by the caller's bank
  setRomBank(P, bank);
  const target = P.bus.u16(SLOT_TABLE | slot);                   // CallVectorEntryA: the table entry, bank mapped
  push(P, FARCALL_RETURN);                                       // call CallVectorEntryA ... whose ret enters the callee
  c.f = spAddFlags((c.sp - 2) & 0xFFFF, 5);
  jumpTo(P, target);
}
// FarCall's tail (00:01D5), where the callee returns: map the caller's bank, drop the frame, return past the operands
function farCallReturnHook(P, c) {
  setRomBank(P, P.bus.u8(c.sp));
  c.sp = (c.sp + 4) & 0xFFFF;
}

// ClearBothVRAMBanks (00:024E): zero all of VRAM, bank 1 then bank 0 (ClearMemoryBC16, 16 bytes a step).
// Returns the registers ClearMemoryBC16 leaves.
const VRAM_CLEARED = { a: 0, bc: 0, hl: VRAM_START + VRAM_SIZE, f: FLAG_Z };
export function clearBothVRAMBanks(P) {
  P.bus.w8(rVBK, 1);
  clearMemoryBC16(P, VRAM_START, VRAM_SIZE / 16);
  P.bus.w8(rVBK, 0);
  clearMemoryBC16(P, VRAM_START, VRAM_SIZE / 16);
  return VRAM_CLEARED;
}
// ClearVRAMBank (00:0383): on a Game Boy Color both banks, else bank 0 only
export function clearVRAMBank(P) {
  if (P.V.isCGB) return clearBothVRAMBanks(P);
  clearMemoryBC16(P, VRAM_START, VRAM_SIZE / 16);
  return VRAM_CLEARED;
}

// SwitchCPUSpeed (00:02A3): to double speed, if not there already: arm the switch, mask all interrupts and run
// `stop` with the pad rows deselected (the switch itself), then clear IF and unmask. Returns a and f: rSPD and the
// flags of `bit 7` when already fast, else the saved IE and those of the first `bit 7`.
export function switchCPUSpeed(P, f) {
  const { bus } = P, spd = bus.u8(rSPD);
  if (spd & SPD_DOUBLE) return { a: spd, f: FLAG_H | (f & FLAG_C) };
  bus.w8(rSPD, SPD_PREPARE);
  const ie = bus.u8(rIE);
  bus.w8(rIE, 0);
  bus.w8(rJOYP, JOYP_NONE);
  P.mem.switchSpeed();                                           // stop: the CPU switches to double speed
  bus.u8(rSPD);                                                  // the ROM reads rSPD until bit 7 is set: done now
  bus.w8(rJOYP, 0);
  bus.w8(rIF, 0);
  bus.w8(rIE, ie);
  return { a: ie, f: FLAG_Z | FLAG_H | (f & FLAG_C) };
}

// EnableLCD (00:0376): switch the LCD on, clear the sprites no one queued this frame (ClearUnusedSprites), and
// clear hVBlankOccurred. Returns the registers: a = 0, F = Z, and ClearUnusedSprites' c and hl.
export function enableLCD(P) {
  P.bus.w8(rLCDC, P.bus.u8(rLCDC) | LCDC_ON);
  const r = clearUnusedSprites(P);
  P.V.vBlankOccurred = 0;
  return { ...r, a: 0, f: FLAG_Z };
}

// ClearBytes (00:03A7): zero bc bytes from hl (bc = 0: 64 KB). Returns hl after them.
export function clearBytes(P, hl, bc) {
  do {
    P.bus.w8(hl, 0);
    hl = (hl + 1) & 0xFFFF; bc = (bc - 1) & 0xFFFF;
  } while (bc);
  return hl;
}

export const HOOKS = [
  [0, 0x015E, callHLInBankAHook],
  [0, CALLHL_RESTORE, callHLRestoreHook],
  [0, 0x0018, farCallHook],                                      // rst $18 (its jp to FarCall)
  [0, 0x01B6, farCallHook],
  [0, FARCALL_RETURN, farCallReturnHook],
  [0, 0x024E, (P, c) => setRegs(c, clearBothVRAMBanks(P))],
  [0, 0x02A3, (P, c) => setRegs(c, switchCPUSpeed(P, c.f))],
  [0, 0x0376, (P, c) => setRegs(c, enableLCD(P))],
  [0, 0x0383, (P, c) => setRegs(c, clearVRAMBank(P))],
  [0, 0x03A7, (P, c) => setRegs(c, { hl: clearBytes(P, c.hl, c.bc), bc: 0, a: 0, f: FLAG_Z })],
];

// A far call from ported code to a routine that is still the ROM's and may wait (or never return), with the ROM's
// stack: the return address after the `rst $18` operands (returnAddr) and FarCall's frame are pushed as the ROM
// does, so the callee's stack sits where the ROM's would. The callee runs with its bank mapped (P.runRom maps it
// and maps the caller's back afterwards, as FarCall's tail does). Returns its registers.
export function* farCallRom(P, bank, target, returnAddr, regs = {}) {
  const { cpu } = P, sp = cpu.sp;
  push(P, returnAddr);                                           // rst $18
  push(P, ((regs.h ?? cpu.h) << 8) | (regs.l ?? cpu.l));         // push hl
  push(P, ((regs.a ?? cpu.a) << 8) | P.V.romBank);               // push af, its F byte replaced by the caller's bank
  const r = yield* P.runRom(bank, target, regs);                 // its return address where FarCall's is
  cpu.sp = sp;
  return r;
}
