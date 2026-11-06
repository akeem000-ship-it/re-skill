// Bank 0 frame tasks and color fades: the frame-task table (routines AdvanceFrame calls every frame, by
// priority), the 15-bit color helpers, and the palette fades run from the VBlank handler.
// Port of colorfade_00.asm (00:1B48-00:1DBC); names and addresses from the gerbiljames/mario-tennis-gbc-disasm
// (MIT, third_party/mario-tennis-gbc-disasm).
// Covered by the routine tests (web/tests/port/routines_home_gfx.mjs) and the lockstep on out/engine/*.mtrec.
import { FZ, FN, FH, FC, switchRomBank, byte, setByte, setRegs, cpFlags, pushWord, dropWords } from "./memory.js";
import { applyWhiteFade } from "./fade.js";

// ---- frame tasks ----
// wFrameTasks: 16 entries [priority, routine lo, routine hi, ROM bank]; an all-zero routine/bank is a free entry.
// Kept sorted by priority, highest first. RunFrameTasks runs the entries whose priority bit 7 matches its
// argument's and whose low 7 bits are not 0.
const FRAME_TASKS = 0xC1C0, FRAME_TASK_SLOTS = 16, FRAME_TASK_SIZE = 4;
// IF DEF(FIXES) uses 16: the ROM looks for a free entry over 22, past the table into wMasterPalettes.
const FRAME_TASK_INSERT_SCAN = 0x16;

// Flags of `add sp, n` (Z and N clear; H and C from the low byte), the last thing the task routines do.
const addSpFlags = (sp, n) => ((sp & 0x0F) + n > 0x0F ? FH : 0) | ((sp & 0xFF) + n > 0xFF ? FC : 0);

// Compare3Bytes (00:1B48): Z when the 3 bytes at de equal those at hl. Returns { a, f }.
export function compare3Bytes(P, hl, de) {
  const { bus } = P;
  for (let i = 0; i < 3; i++) if (bus.u8(de + i) !== bus.u8(hl + i)) return { a: 1, f: 0 };
  return { a: 0, f: FZ };
}
// Check3BytesZero (00:1B63): a = the OR of the 3 bytes at hl (Z when all are 0).
export function check3BytesZero(P, hl) {
  const a = P.bus.u8(hl) | P.bus.u8(hl + 1) | P.bus.u8(hl + 2);
  return { a, f: a ? 0 : FZ };
}

// SortFrameTasks (00:1C3F): bubble-sort the 16 entries by priority, highest first (equal ones swap too, as in
// the ROM). Returns the registers it leaves.
export function sortFrameTasks(P) {
  const { bus } = P;
  let a = 0, carry = 0;
  for (let pass = FRAME_TASK_SLOTS - 1; pass > 0; pass--) {
    for (let i = 0; i < pass; i++) {
      const hl = FRAME_TASKS + i * FRAME_TASK_SIZE, de = hl + FRAME_TASK_SIZE;
      a = bus.u8(de);
      carry = a < bus.u8(hl);
      if (carry) continue;                                  // in order
      for (let k = 0; k < FRAME_TASK_SIZE; k++) {
        const x = bus.u8(hl + k); a = bus.u8(de + k);
        bus.w8(hl + k, a); bus.w8(de + k, x); a = x;
      }
    }
  }
  return { a, bc: 0, de: FRAME_TASKS + 2 * FRAME_TASK_SIZE, hl: FRAME_TASKS + FRAME_TASK_SIZE, f: FZ | FN | (carry ? FC : 0) };
}

// RegisterFrameTask (00:1B6A): add the routine hl in the ROM bank mapped now (the caller's) with priority a,
// unless it is there already; then sort. hFrameTasksReady is cleared meanwhile, so the table is not run half
// changed. The ROM builds the 4-byte entry on the stack (sp - 4). Returns the registers it leaves.
export function registerFrameTask(P, priority, hl, sp) {
  const { bus, V } = P;
  V.frameTasksReady = 0;
  const buf = (sp - 4) & 0xFFFF, entry = [priority, hl & 0xFF, hl >> 8, V.romBank];
  entry.forEach((v, i) => bus.w8(buf + i, v));
  let found = false;
  for (let i = 0; i < FRAME_TASK_SLOTS && !found; i++) found = compare3Bytes(P, FRAME_TASKS + i * FRAME_TASK_SIZE + 1, buf + 1).f === FZ;
  if (!found) {
    for (let i = 0; i < FRAME_TASK_INSERT_SCAN; i++) {
      const at = FRAME_TASKS + i * FRAME_TASK_SIZE;
      if (check3BytesZero(P, at + 1).a) continue;
      for (let k = 0; k < FRAME_TASK_SIZE; k++) bus.w8(at + k, bus.u8(buf + k));
      break;
    }
  }
  sortFrameTasks(P);
  V.frameTasksReady = 1;
  return { a: 1, bc: 0, de: FRAME_TASKS + 2 * FRAME_TASK_SIZE, hl: FRAME_TASKS + FRAME_TASK_SIZE, f: addSpFlags(buf, 4) };
}
// UnregisterFrameTask (00:1BCB): free the entry of routine hl in the ROM bank mapped now (the caller's).
// The ROM builds the 3-byte key on the stack (sp - 3). Returns the registers it leaves.
export function unregisterFrameTask(P, hl, sp) {
  const { bus, V } = P;
  V.frameTasksReady = 0;
  const buf = (sp - 3) & 0xFFFF;
  [hl & 0xFF, hl >> 8, V.romBank].forEach((v, i) => bus.w8(buf + i, v));
  let c = FRAME_TASK_SLOTS, at = FRAME_TASKS;
  for (; c > 0; c--, at += FRAME_TASK_SIZE) {
    if (compare3Bytes(P, at + 1, buf).f) {
      for (let k = 0; k < FRAME_TASK_SIZE; k++) bus.w8(at + k, 0);
      at += FRAME_TASK_SIZE;
      break;
    }
  }
  V.frameTasksReady = 1;
  return { a: 1, c, de: buf, hl: at, f: addSpFlags(buf, 3) };
}
// RunFrameTasks (00:1BFF), from AdvanceFrame: call every entry whose priority has bit 7 equal to a's and low
// bits not 0, in table order, each in its own ROM bank (called in the ROM: tasks are game code). Entries are read
// as the loop reaches them, since tasks may (un)register tasks. Restores the ROM and WRAM banks.
// Returns the registers it leaves.
export function runFrameTasks(P, mask) {
  const { bus, V } = P;
  const b = mask & 0x80;
  if (!V.frameTasksReady) return { a: 0, b, f: FZ };
  const savedRom = V.romBank, savedWram = V.wramBank;
  pushWord(P, savedRom << 8 | savedWram);                   // (push de)
  let carry = 0;                                            // the last entry's: its key's bit 7, or its routine's
  for (let i = 0; i < FRAME_TASK_SLOTS; i++) {
    const at = FRAME_TASKS + i * FRAME_TASK_SIZE, key = bus.u8(at) ^ b;
    carry = key & 0x80 ? FC : 0;
    if (!(key & 0x7F) || key & 0x80) continue;
    const routine = bus.u16(at + 1), bank = bus.u8(at + 3), c = FRAME_TASK_SLOTS - i;
    switchRomBank(P, bank);
    pushWord(P, b << 8 | c); pushWord(P, at + 1);           // (push bc, push hl; then call JumpToHL)
    const r = P.callRom(bank, routine, { a: bank, b, c, d: routine >> 8, e: routine & 0xFF, h: routine >> 8, l: routine & 0xFF });
    dropWords(P, 2);
    carry = r.f & FC;
  }
  dropWords(P, 1);
  switchRomBank(P, savedRom);
  P.wramBank(savedWram);
  return { a: savedWram, b, c: 0, de: savedRom << 8 | savedWram, hl: FRAME_TASKS + FRAME_TASK_SLOTS * FRAME_TASK_SIZE, f: FZ | FN | carry };
}

// ---- 15-bit colors: red bits 0-4, green 5-9, blue 10-14; bc = the color (c low byte) ----
const rlca = v => ((v << 1) | (v >> 7)) & 0xFF, rrca = v => ((v >> 1) | (v << 7)) & 0xFF;
const MAX_COMPONENT = 0x1F;
// SplitColorComponents (00:1C6A): bc -> a = red, b = green, c = blue (de kept).
export function splitColorComponents(bc) {
  const lo = bc & 0xFF, hi = bc >> 8;
  const red = lo & 0x1F;
  return { a: red, b: rlca(rlca(rlca((lo & 0xE0) | (hi & 0x03)))), c: (hi & 0x7C) >> 2, f: (red ? 0 : FZ) | FH };
}
// CombineColorComponents (00:1C83): a = red, b = green, c = blue -> bc (af and de kept).
export function combineColorComponents(red, green, blue) {
  const g = rrca(rrca(rrca(green)));
  return ((rlca(rlca(blue)) & 0x7C) | (g & 0x03)) << 8 | (g & 0xE0) | (red & 0x1F);
}
// AddClampColorComponent (00:1CA0): a + d, 0 when the sum has bit 7 set (gone negative), at most $1F.
export function addClampColorComponent(a, d) {
  const v = (a + d) & 0xFF;
  if (v & 0x80) return { a: 0, f: FZ };
  return { a: Math.min(v, MAX_COMPONENT), f: cpFlags(v, MAX_COMPONENT) };
}
// AdjustColorRed/Green/Blue (00:1CAD/1CB9/1CC9): add d to one component of bc, clamped (af and de kept).
export function adjustColor(bc, component, d) {
  const s = splitColorComponents(bc), rgb = [s.a, s.b, s.c];
  rgb[component] = addClampColorComponent(rgb[component], d).a;
  return combineColorComponents(...rgb);
}
// AdjustColorsBrightness (00:1CD9): b colors from hl to de, each component plus c (clamped). Keeps all registers.
export function adjustColorsBrightness(P, hl, de, count, delta) {
  const { bus } = P;
  for (let n = count || 0x100; n > 0; n--) {
    const s = splitColorComponents(bus.u16(hl));
    const color = combineColorComponents(addClampColorComponent(s.a, delta).a, addClampColorComponent(s.b, delta).a,
      addClampColorComponent(s.c, delta).a);
    bus.w8(de, color & 0xFF); bus.w8(de + 1, color >> 8);
    hl = (hl + 2) & 0xFFFF; de = (de + 2) & 0xFFFF;
  }
}

// ---- fades ----
// hFadeState: bit 0 fading out, bit 1 fading in, bit 7 the (unused) white fade. hFadeCounter runs from $7C
// down by hFadeSpeed each frame; each step rebuilds the live palettes from wMasterPalettes with every component
// raised by a quarter of the distance from the end (out: growing, in: shrinking), and marks both for VBlank.
const FADE_OUT = 1, FADE_IN = 2, FADE_WHITE = 0x80;
const FADE_START = 0x7C;
const wMasterPalettes = 0xC200, wBGPalettes = 0xC100, PALETTE_COLORS = 0x40;
// BeginFadeOut (00:1D20) / BeginFadeIn (00:1D2E): start a fade of speed c (0 counts as 1) unless the screen is
// already faded out / in; force: Unused_00_ForceFadeOut (00:1D09) / ForceFadeIn (00:1D0C) start it anyway.
// All registers kept.
export function beginFadeOut(P, speed, force = false) {
  if (!force && byte(P, "fadedOut")) return;
  P.V.fadeState = FADE_OUT;
  setByte(P, "fadedOut", 1);
  startFade(P, speed);
}
export function beginFadeIn(P, speed, force = false) {
  if (!force && !byte(P, "fadedOut")) return;
  P.V.fadeState = FADE_IN;
  setByte(P, "fadedOut", 0);
  startFade(P, speed);
}
function startFade(P, speed) {
  P.V.fadeSpeed = speed || 1;
  setByte(P, "fadeCounter", FADE_START);
}
// Unused_00_BeginWhiteFadeOut (00:1D0F): BeginFadeOut with interrupts off, marking a started fade white.
export function beginWhiteFadeOut(P, speed) {
  P.di();
  beginFadeOut(P, speed);
  if (P.V.fadeState) P.V.fadeState |= FADE_WHITE;
  P.ei();
}
// UpdateFadeOut (00:1D5E) / UpdateFadeIn (00:1D48), from the VBlank handler: one step of a running fade.
// All registers kept.
export function updateFadeOut(P) {
  if (!(P.V.fadeState & FADE_OUT)) return;
  const counter = Math.max(0, byte(P, "fadeCounter") - P.V.fadeSpeed);
  fadeStep(P, counter, (FADE_START - counter) & 0xFF);
}
export function updateFadeIn(P) {
  if (!(P.V.fadeState & FADE_IN)) return;
  const counter = Math.max(0, byte(P, "fadeCounter") - P.V.fadeSpeed);
  fadeStep(P, counter, counter);
}
function fadeStep(P, counter, level) {
  if (P.V.fadeState & FADE_WHITE) { if (!(level & 4)) applyWhiteFade(P, level); }
  else adjustColorsBrightness(P, wMasterPalettes, wBGPalettes, PALETTE_COLORS, level >> 2);
  if (!counter) P.V.fadeState = 0;                          // done
  setByte(P, "fadeCounter", counter);
  P.V.paletteDirtyFlags = 3;
}
// WaitFadeEnd (00:1DA4): wait frames until the fade is over (over the link: the link's frame sync instead).
// Returns the registers the last wait left (b, c, d, e, h, l). The calls are made at the ROM's stack depth:
// its push af, and for the far call its push af and FarCall's frame (as FarCall leaves it at the callee).
const AdvanceFrame = 0x2631, BANK_LINK = 0x07, SyncLinkFrame = 0x4747;
function* syncLinkFrame(P, regs, afterFarcall) {
  const af = regs.a << 8 | (regs.f || 0), old = P.V.romBank;
  pushWord(P, af); pushWord(P, afterFarcall); pushWord(P, regs.h << 8 | regs.l); pushWord(P, af & 0xFF00 | old);
  const r = yield* P.runRom(BANK_LINK, SyncLinkFrame, regs);
  dropWords(P, 4);
  return r;
}
export function* waitFadeEnd(P, regs) {
  let r = regs;
  pushWord(P, regs.a << 8 | regs.f);
  while (P.V.fadeState) {
    const link = P.V.linkExchangeActive;                   // (a holds it at the call)
    r = link ? yield* syncLinkFrame(P, { ...r, a: link, f: 0 }, 0x1DB3) : yield* P.runRom(0, AdvanceFrame, { ...r, a: 0, f: FZ });
  }
  dropWords(P, 1);
  return r;
}
// Unused_00_WaitFadeEndLinked (00:1DBD): the same, always over the link.
export function* waitFadeEndLinked(P, regs) {
  let r = regs;
  pushWord(P, regs.a << 8 | regs.f);
  while (P.V.fadeState) r = yield* syncLinkFrame(P, { ...r, a: P.V.fadeState, f: 0 }, 0x1DC7);
  dropWords(P, 1);
  return r;
}

// Generator hooks that keep af and hand back the other registers of their last wait.
const waitHook = gen => function* (P, c) {
  const af = c.af, r = yield* gen(P, { a: c.a, f: c.f, b: c.b, c: c.c, d: c.d, e: c.e, h: c.h, l: c.l });
  setRegs(c, { b: r.b, c: r.c, d: r.d, e: r.e, h: r.h, l: r.l, af });
};

export const HOOKS = [
  [0, 0x1B48, (P, c) => setRegs(c, compare3Bytes(P, c.hl, c.de))],
  [0, 0x1B63, (P, c) => setRegs(c, check3BytesZero(P, c.hl))],
  [0, 0x1B6A, (P, c) => setRegs(c, registerFrameTask(P, c.a, c.hl, c.sp))],
  [0, 0x1BCB, (P, c) => setRegs(c, unregisterFrameTask(P, c.hl, c.sp))],
  [0, 0x1BFF, (P, c) => setRegs(c, runFrameTasks(P, c.a))],
  [0, 0x1C3F, (P, c) => setRegs(c, sortFrameTasks(P))],
  [0, 0x1C6A, (P, c) => setRegs(c, splitColorComponents(c.bc))],
  [0, 0x1C83, (P, c) => { c.bc = combineColorComponents(c.a, c.b, c.c); }],
  [0, 0x1CA0, (P, c) => setRegs(c, addClampColorComponent(c.a, c.d))],
  [0, 0x1CAD, (P, c) => { c.bc = adjustColor(c.bc, 0, c.d); }],
  [0, 0x1CB9, (P, c) => { c.bc = adjustColor(c.bc, 1, c.d); }],
  [0, 0x1CC9, (P, c) => { c.bc = adjustColor(c.bc, 2, c.d); }],
  [0, 0x1CD9, (P, c) => adjustColorsBrightness(P, c.hl, c.de, c.b, c.c)],
  [0, 0x1D09, (P, c) => beginFadeOut(P, c.c, true)],
  [0, 0x1D0C, (P, c) => beginFadeIn(P, c.c, true)],
  [0, 0x1D0F, (P, c) => beginWhiteFadeOut(P, c.c)],
  [0, 0x1D20, (P, c) => beginFadeOut(P, c.c)],
  [0, 0x1D2E, (P, c) => beginFadeIn(P, c.c)],
  [0, 0x1D48, P => updateFadeIn(P)],
  [0, 0x1D5E, P => updateFadeOut(P)],
  [0, 0x1DA4, waitHook(waitFadeEnd)],
  [0, 0x1DBD, waitHook(waitFadeEndLinked)],
];
