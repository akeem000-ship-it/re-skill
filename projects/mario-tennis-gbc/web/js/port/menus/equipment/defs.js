// Shared pieces of the last menu ports (web/js/port/menus/equipment, dictionary, minigame_select, debug, link):
// the menu helpers of the pause-menu ports (menus/pause/defs.js: RAM through the mapped banks, far(), rom() with
// FarCall's entry flags, the fades and frame tasks), the hook adapters with HOOK_TRACE for the routine tests (the
// object of menus/char_select/defs.js), and the routines of other parts of the game these screens call.
// Names, addresses and constants from the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm); the values of its generated constants (screen assets, tile blocks, text ids, decoded
// sizes) are the operands of the ROM's own instructions.
//
// Calls. A routine here calls
//   - verified ports directly (home/*, audio, save, menus/common), inside far(P, bank, ...) when the ROM reaches
//     them with a farcall (FarCall maps the callee's bank: hRomBank and the MBC);
//   - its own routines directly (far ones inside far() / farGen());
//   - anything else (text, the menu library, characters, link, story) through its ROM address: rom() for a farcall
//     that does not wait, yield* romWait() for one that may; near() for a `call` of a routine of the caller's own
//     bank that has no port. Those run the ported JS where another part has hooked it.
// Waiting routines are generators (`yield* advanceFrame(P)`); the lockstep test does not need the ROM's stack.
import { HOOK_TRACE } from "../char_select/defs.js";
import { getRegs, setRegs, spAddFlags } from "../../home/cpu.js";
import { queueVRAMCopy } from "../../home/memory.js";
import { FAR as FAR_PAUSE, HOME as HOME_PAUSE } from "../pause/defs.js";
import { farcallFlags } from "../common/defs.js";

export * from "../pause/defs.js";
export { HOOK_TRACE, spAddFlags };

// ---- flags ----
export const addFlags = (a, x) => (((a + x) & 0xFF) === 0 ? 0x80 : 0) | ((a & 0xF) + (x & 0xF) > 0xF ? 0x20 : 0) | ((a & 0xFF) + (x & 0xFF) > 0xFF ? 0x10 : 0);
export const subFlags = (a, x) => (((a - x) & 0xFF) === 0 ? 0x80 : 0) | 0x40 | ((a & 0xF) < (x & 0xF) ? 0x20 : 0) | ((a & 0xFF) < (x & 0xFF) ? 0x10 : 0);
export const incFlags = (v, carry = 0) => (((v + 1) & 0xFF) === 0 ? 0x80 : 0) | ((v & 0x0F) === 0x0F ? 0x20 : 0) | carry;
export const decFlags = (v, carry = 0) => (((v - 1) & 0xFF) === 0 ? 0x80 : 0) | 0x40 | ((v & 0x0F) === 0 ? 0x20 : 0) | carry;
// the flags TestGameFlag leaves (Z when clear, H from its `and`)
export const testFlagF = set => (set ? 0 : 0x80) | 0x20;
// The ROM's table lookup `ld hl, table / add l / ld l, a / jr nc, .x / inc h`: the address and the flags it leaves
// (the add's; with a carry those of `inc h`, carry kept)
export function ixF(table, a) {
  const l = (table & 0xFF) + (a & 0xFF), h = (table >> 8) & 0xFF;
  if (l > 0xFF) return { hl: ((h + 1) & 0xFF) << 8 | (l & 0xFF), f: incFlags(h, 0x10) };
  return { hl: h << 8 | l, f: addFlags(a & 0xFF, table & 0xFF) };
}

// ---- hook adapters ----
// fn(P, cpu) runs the routine and returns the registers the ROM routine leaves changed ({ a, f, hl, ... }); the
// others are put back as they were at the call. HOOK_TRACE.out: the registers the last hook gave (the routine tests
// compare those with the ROM's).
export const hook = fn => (P, cpu) => {
  const saved = getRegs(cpu);
  const out = fn(P, cpu);
  setRegs(cpu, saved);
  if (out) setRegs(cpu, out);
  HOOK_TRACE.out = out;
};
export const hookGen = fn => function* (P, cpu) {
  const saved = getRegs(cpu);
  const out = yield* fn(P, cpu);
  setRegs(cpu, saved);
  if (out) setRegs(cpu, out);
  HOOK_TRACE.out = out;
};
// a hook for a routine that is only `ret` (or `nop / ret`): nothing changes
export const nop = () => {};

// ---- calls ----
// Calls into ROM code (or other parts' hooked JS) through its address, as menus/pause/defs.js's, with the registers
// given (undefined ones left as they are: register sets built from partial results).
const given = regs => { const r = {}; for (const k in regs) if (regs[k] !== undefined) r[k] = regs[k]; return r; };
export const rom = (P, [bank, a], regs = {}) => P.callRom(bank, a, { f: farcallFlags(P.cpu.sp), ...given(regs) });
export const home = (P, a, regs = {}) => P.callRom(0, a, given(regs));
export function* romWait(P, [bank, a], regs = {}) { return yield* P.runRom(bank, a, { f: farcallFlags(P.cpu.sp), ...given(regs) }); }
export function* homeWait(P, a, regs = {}) { return yield* P.runRom(0, a, given(regs)); }
// `call X` of a routine of the caller's bank (P.callRom with the bank mapped now)
export const near = (P, addr, regs = {}) => P.callRom(P.mem.romBank, addr, given(regs));
export function* nearWait(P, addr, regs = {}) { return yield* P.runRom(P.mem.romBank, addr, given(regs)); }
// QueueVRAMCopy (00:0480) with every register it leaves (c = the count loaded, which a full queue keeps)
export const queueCopy = (P, src, dest, blocks) => ({ c: blocks & 0xFF, ...queueVRAMCopy(P, src, dest, blocks) });
// the flags the rst $20 / $28 handlers (set_flag / clear_flag) leave: their `ld hl, sp+4`, sp 4 below the caller's
export const setFlagF = P => spAddFlags((P.cpu.sp - 6) & 0xFFFF, 4);
// the 8-bit registers of a register set (P.callRom's result): to pass on with some changed (a pair given to
// P.callRom wins over its halves)
export const regs8 = r => ({ a: r.a, f: r.f, b: r.b, c: r.c, d: r.d, e: r.e, h: r.h, l: r.l });

// ---- constants (include/constants/*.inc) ----
export const BGM_STATUS_SCREEN = 0x04, SFX_STOP = 0x50, BGM_NONE = 0x00;
export const CHAR_MARIO = 0x1A;
export const wWindowShadowTilemap = 0xD000, wTextTileBuffer = 0xD800;   // WRAM 5 / WRAM 1

// ---- the ROM's routines, by address ----
export const HOME = {
  ...HOME_PAUSE, DecompressDataFromBank: 0x0234, CopyMemoryBC: 0x03DB, CopyMemoryFast: 0x03F3, PrintString: 0x1906,
  TestGameFlagByNumber: 0x24EF, SetGameFlagByNumber: 0x2509, ClearGameFlagByNumber: 0x2523, LinkErrorReset: 0x284B,
  WaitVBlank: 0x2814,
};
export const FAR = {
  ...FAR_PAUSE,
  RefreshMainCharacterStats: [0x02, 0x478F], RenderTextToBuffer64: [0x05, 0x5F52],
  LoadMenuHandCursorGfx: [0x18, 0x437C],
  LoadFixedTileBlockAndPalette: [0x39, 0x44D3], FillIncrementingBytes: [0x39, 0x745A],
  // bank $3e's own copies of the shared menu code (cursor_3e.asm)
  DrawSelectionBoxCorners_3e: [0x3E, 0x4048], MoveMenuCursorGrid_3e: [0x3E, 0x413A],
  MoveMenuCursorGridFromLinkInput_3e: [0x3E, 0x41B8], GetMenuCursorIndex_3e: [0x3E, 0x43C9],
  SetMenuCursorFromIndex_3e: [0x3E, 0x43EB],
};
