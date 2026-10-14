// Routine tests for the bank-0 system modules of web/js/port/home (system, vblank, link, flags, frame, debugtext,
// bgblit, ui; run by web/tests/port_routines.mjs). Routines whose callers pass inline operands (rst $18/$20/$28/$30,
// WaitFramesCmd) or that end in a jump are called from a small stub of code written into the stack page
// ($CF00, not compared): the stub's own call, then `ret`. Registers are drawn from the state (a hash of the
// recording and frame), with edge values mixed in; prep() forces the rare branches.
const ALL = ["a", "f", "b", "c", "d", "e", "h", "l"];
const NOF = ["a", "b", "c", "d", "e", "h", "l"];

function rng(s, salt) {
  let x = 2166136261 ^ salt;
  for (const ch of `${s.rec}@${s.f}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
  x = (x >>> 0) || 1;
  return n => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x % n; };
}
let salt = 0;
// regs from gen(r) -> { a, f, bc, de, hl } (any left out are random)
const regsOf = gen => { const k = ++salt * 7919; return s => {
  const r = rng(s, k), g = { a: r(256), f: r(16) << 4, bc: r(0x10000), de: r(0x10000), hl: r(0x10000), ...gen(r, s) };
  return { a: g.a, f: g.f, b: g.bc >> 8, c: g.bc & 0xFF, d: g.de >> 8, e: g.de & 0xFF, h: g.hl >> 8, l: g.hl & 0xFF };
}; };
// The ROM side runs with interrupts off (romCall); so does the port here (the harness would give it the state's
// IME, and a routine that calls into the ROM would then take the pending interrupts there).
const T = (name, addr, { gen = () => ({}), out = ALL, prep, when, wram, ignore } = {}) => ({
  name, bank: 0, addr, out, regs: regsOf(gen), prep, when, wram, ignore,
  js(P, regs) {
    if (!P.hooks.has(addr)) throw new Error(`no port hooked at ${addr.toString(16)}`);
    P.ime = false;
    return P.callRom(0, addr, regs);
  },
});

// a stub of code at $CF00 (the stack page, which the tests never compare): bytes, then the routine runs from it
const STUB = 0xCF00;
const S = (name, bytes, { gen = () => ({}), out = ALL, prep, when } = {}) => { const k = ++salt * 104729; return {
  name, bank: 0, addr: STUB, out, regs: regsOf(gen), when,
  js: (P, regs) => { P.ime = false; return P.callRom(0, STUB, regs); },   // as romCall: interrupts off
  prep(mem, s) {
    const code = typeof bytes === "function" ? bytes(rng(s, k)) : bytes;
    code.forEach((b, i) => mem.write(STUB + i, b));
    if (prep) prep(mem, s);
  },
}; };
// prep helpers: write bytes; values drawn from the state (a salt per entry)
const W = (mem, addr, ...bytes) => bytes.forEach((b, i) => mem.write(addr + i, b & 0xFF));
const P_ = f => { const k = ++salt * 15485863; return (mem, s) => f(mem, rng(s, k), s); };
const BUF = 0xCE80;                                             // a scratch buffer in WRAM0 (compared)
// `ei` at the end (taken on the ROM side before its ret): nothing pending, and the CPU awake (the states are taken
// at AdvanceFrame's halt; romCall wakes the core, not the port)
const noIrq = mem => { mem.iflag = 0; mem.machine.cpu.halted = false; };
const pick = (r, list) => list[r(list.length)];
const E16 = [0, 1, 9, 10, 99, 100, 999, 1000, 9999, 10000, 32767, 32768, 32769, 65535];
const RST18 = 0xDF, RST20 = 0xE7, RST28 = 0xEF, RST30 = 0xF7, CALL = 0xCD, RET = 0xC9;
const call = addr => [CALL, addr & 0xFF, addr >> 8];
const wram0 = r => 0xC000 + r(0xE00);                           // a pointer into WRAM0 below the stack page

export const ROUTINES = [
  // ---- system.js ----
  S("FarCall Compare24Bit", [RST18, 0x1E, 0x02, RET], { gen: r => ({ hl: wram0(r), de: wram0(r) }) }),
  S("FarCall GetCharPaletteIndex", [RST18, 0x34, 0x02, RET], { gen: r => ({ a: r(112) }) }),
  S("FarCall LoadMenuFontPalette", [RST18, 0x08, 0x01, RET]),
  S("FarCall from FarCall's own entry", [...call(0x01B6), 0x1E, 0x02, RET], { gen: r => ({ hl: wram0(r), de: wram0(r) }) }),
  S("CallHLInBankA Compare24Bit", [...call(0x015E), RET], { gen: r => ({ a: 2, hl: 0x4D54, de: wram0(r), bc: wram0(r) }) }),
  S("CallHLInBankA GetCharPaletteIndex", [...call(0x015E), RET], { gen: () => ({ a: 2, hl: 0x4173 }) }),
  T("ClearBothVRAMBanks", 0x024E),
  T("ClearVRAMBank", 0x0383),
  T("ClearVRAMBank (DMG)", 0x0383, { prep: mem => { mem.hram[0x7E] = 0; } }),
  T("SwitchCPUSpeed (already fast)", 0x02A3),
  T("SwitchCPUSpeed (switching)", 0x02A3, { prep: mem => { mem.doubleSpeed = false; } }),
  T("EnableLCD", 0x0376),
  T("EnableLCD (from off)", 0x0376, { prep: (mem) => { mem.write(0xFF40, mem.read(0xFF40) & 0x7F); } }),
  T("ClearBytes", 0x03A7, { gen: r => ({ hl: wram0(r), bc: 1 + r(0x100) }) }),


  // ---- flags.js ----
  T("TestGameFlag", 0x249F, { gen: r => ({ de: r(2) ? r(0x40) << 5 : r(0x10000) & 0x3FFF }) }),
  T("SetGameFlag", 0x24BA, { gen: r => ({ de: r(2) ? r(0x40) << 5 : r(0x10000) & 0x3FFF }) }),
  T("ClearGameFlag", 0x24D4, { gen: r => ({ de: r(2) ? r(0x40) << 5 : r(0x10000) & 0x3FFF }) }),
  T("TestGameFlagByNumber", 0x24EF, { gen: r => ({ de: r(2) ? r(0x100) : r(0x10000) }) }),
  T("SetGameFlagByNumber", 0x2509, { gen: r => ({ de: r(2) ? r(0x100) : r(0x10000) }) }),
  T("ClearGameFlagByNumber", 0x2523, { gen: r => ({ de: r(2) ? r(0x100) : r(0x10000) }) }),
  S("rst $30 TestGameFlagCmd", r => [RST30, r(8) << 5, r(0x30), RET]),
  S("rst $20 SetGameFlagCmd", r => [RST20, r(8) << 5, r(0x30), RET]),
  S("rst $28 ClearGameFlagCmd", r => [RST28, r(8) << 5, r(0x30), RET]),
  S("rst $30 odd operand", r => [RST30, r(256), r(0x30), RET]),
  S("call TestGameFlagCmd", r => [...call(0x2551), r(8) << 5, r(0x30), RET]),
  T("FetchInlineWordOperand", 0x253D, { gen: () => ({ hl: BUF }), prep: P_((mem, r) => W(mem, BUF, BUF + 2, (BUF + 2) >> 8, r(256), r(256))) }),
  T("UpdateGameTimer", 0x23DD),
  T("UpdateGameTimer rollovers", 0x23DD, { prep: P_((mem, r) => W(mem, 0xC0F0, pick(r, [59, 58, 0xFF]), pick(r, [59, 0, 58]), pick(r, [59, 1]), pick(r, [99, 98, 0, 0xFF]), pick(r, [0, 1, 2]), pick(r, [59, 3]), pick(r, [59, 2]), pick(r, [9, 8]))) }),
  T("TickSecondaryTimer", 0x2435, { prep: P_((mem, r) => W(mem, 0xC0F5, pick(r, [59, 1]), pick(r, [59, 2]), pick(r, [9, 8, 0xFF]))) }),
  T("SaveGameTimer", 0x2452, { prep: noIrq }),
  T("RestoreGameTimer", 0x246D, { prep: noIrq }),
  T("ResetGameTimer", 0x2488, { prep: noIrq }),

  // ---- debugtext.js ----
  T("ClearDebugTextBuffer", 0x188B),
  T("UpdateDebugOverlay", 0x1893, { prep: P_((mem, r) => { mem.hram[0x1E] = r(5); mem.hram[0x0E] = r(2); mem.hram[0x0C] = r(256); }) }),
  T("StartVRAMDMATransfer", 0x18D7, { gen: r => ({ bc: 0xC000 + r(0xE00), de: 0x8000 + r(0x1800), a: r(0x10) }) }),
  T("StartVRAMDMAFromHL", 0x18EB, { gen: r => ({ hl: 0xC000 + r(0xE00), de: 0x8000 + r(0x1800), bc: 1 + r(0x10) }) }),
  T("GetDebugTextBufferAddr", 0x18F1),
  T("PrintString", 0x1906, { gen: r => ({ hl: BUF, de: r(2) ? (r(32) << 8) | r(18) : r(0x10000) & 0x1F0F }),
    prep: P_((mem, r) => { const n = r(40); for (let i = 0; i < n; i++) W(mem, BUF + i, 0x20 + r(0x60)); W(mem, BUF + n, 0); }) }),
  T("FormatHexWord", 0x1935, { gen: r => ({ de: BUF + r(16) }) }),
  T("FormatDecimalNumber", 0x1972, { gen: r => ({ de: BUF + r(16), a: r(9), hl: r(2) ? pick(r, E16) : r(0x10000) }) }),
  T("FormatDecimalNumber wide", 0x1972, { gen: r => ({ de: BUF, a: r(256), hl: r(0x10000) }) }),
  T("FormatDecimalNumberUnsigned", 0x1A27, { gen: r => ({ de: BUF + r(16), a: r(9), hl: r(2) ? pick(r, E16) : r(0x10000) }) }),
  T("ExtractDecimalDigit", 0x1A20, { gen: r => ({ hl: r(0x10000), bc: pick(r, [0xD8F0, 0xFC18, 0xFF9C, 0xFFF6, 0xFFFF, 0x8000]) }) }),
  T("ExtractDecimalDigitUnsigned", 0x1AB0, { gen: r => ({ hl: r(0x10000), bc: pick(r, [0xD8F0, 0xFC18, 0xFF9C, 0xFFF6]) }) }),
  T("PrintHexByte", 0x1AB7, { gen: r => ({ de: (r(32) << 8) | r(18) }) }),
  T("PrintHexWord", 0x1ACE, { gen: r => ({ de: (r(32) << 8) | r(18) }) }),
  T("PrintDecimalByte", 0x1AE4, { gen: r => ({ de: (r(32) << 8) | r(18) }) }),
  T("Unused_00_PrintDecimalWord", 0x1B15, { gen: r => ({ de: (r(32) << 8) | r(18) }) }),
  T("ClearFrameTasks", 0x1B38),

  // ---- ui.js ----
  T("CopyTextRect", 0x2B46, { out: NOF, gen: r => ({ hl: 0xC000 + r(0x400), de: 0xC400 + r(0x400), bc: ((1 + r(20)) << 8) | (1 + r(18)) }) }),
  T("CopyTextRect 256 wide", 0x2B46, { out: NOF, gen: r => ({ hl: 0xC000 + r(0x100), de: 0xC100 + r(0x100), bc: 1 + r(3) }) }),
  T("DrawWindowFrame", 0x2B68, { gen: r => ({ hl: ((2 + r(20)) << 8) | (3 + r(16)), de: 0xC400 + r(0x200), bc: 0xC800 + r(0x200) }) }),
  T("DrawWindowFramePriority", 0x2B5C, { gen: r => ({ hl: ((2 + r(20)) << 8) | (3 + r(16)), de: 0xC400 + r(0x200), bc: 0xC800 + r(0x200) }) }),
  T("DrawWindowFrameNoPriority", 0x2B63, { gen: r => ({ hl: ((2 + r(20)) << 8) | (3 + r(16)), de: 0xC400 + r(0x200), bc: 0xC800 + r(0x200) }) }),
  T("DrawWindowFrame 2 wide", 0x2B68, { gen: r => ({ hl: (2 << 8) | (3 + r(4)), de: 0xC400 + r(0x200), bc: 0xC800 + r(0x200) }) }),
  T("DrawWindowFrameTop", 0x2BBB, { out: NOF, gen: r => ({ hl: 0xC400 + r(0x200), bc: (r(24) << 8) | r(256) }) }),
  T("DrawWindowFrameSides", 0x2BCE, { out: NOF, gen: r => ({ hl: 0xC400 + r(0x200), bc: (r(256) << 8) | r(256) }) }),
  T("DrawWindowFrameBottom", 0x2BDC, { out: NOF, gen: r => ({ hl: 0xC400 + r(0x200), bc: (r(24) << 8) | r(256) }) }),
  T("MoveCursorHorizontal", 0x2C0D, { gen: r => { const c = 1 + r(10); return { bc: (pick(r, [0x10, 0x20, 0x30, 0, 0x40, r(256)]) << 8) | c, a: r(3) ? r(c) : r(256) }; } }),
  T("TickTimer", 0x2C26, { gen: () => ({ hl: BUF }), prep: P_((mem, r) => W(mem, BUF, pick(r, [0, 1, 2, 0x10, 0x11, r(256)]))) }),
  T("QueueSprite24x32", 0x2C2B),
  T("QueueSprite24x32 mirrored, edges", 0x2C2B, { gen: r => ({ bc: (pick(r, [0x20, 0x00, 0x60, r(256)]) << 8) | pick(r, [0xF4, 0xF0, 0xFE, r(256)]), de: (pick(r, [0x00, 0x0F, 0x10, 0xE8, 0xF0, 0xFF, r(256)]) << 8) | r(256), hl: (pick(r, [0, 8, 0x10, r(256)]) << 8) | r(256) }) }),
  T("QueueSprite24x32 queue", 0x2C2B, { prep: P_((mem, r) => { mem.hram[0x1B] = pick(r, [0, 0x40, 0x88, 0x89, 0x8C, r(0xA1)]); }) }),

  // ---- bgblit.js ----
  T("GetMapBufferAddr64", 0x220E),
  T("BlitBGRowFrom64", 0x222C, { out: NOF }),
  T("BlitBGColumnFrom64", 0x2299, { out: NOF }),

  // ---- link.js ----
  T("SerialHandler", 0x2861, { prep: P_((mem, r) => { mem.hram[0x61] = r(256); mem.hram[0x42] = r(3); mem.hram[0x5F] = r(2); mem.hram[0x60] = r(2) * r(256); mem.hram[0x41] = r(256); }) }),
  T("IncrementLinkFrameCounter", 0x28AF, { prep: P_((mem, r) => { mem.hram[0x48] = r(10); }) }),
  T("InitSerialLink", 0x28B9),
  T("ResetSerialState", 0x28F8),
  T("SerialEncodeInput", 0x2924, { prep: P_((mem, r) => { noIrq(mem); mem.hram[0x42] = 1 + r(2); mem.hram[0x5F] = 0; mem.hram[0x56] = r(256); mem.hram[0x5C] = r(256); }) }),
  T("SerialEncodeInput (master, ack)", 0x2924, { prep: P_((mem, r) => { noIrq(mem); mem.hram[0x42] = 1; mem.hram[0x5F] = 1; mem.hram[0x56] = r(256); mem.hram[0x5C] = r(256); }) }),
  T("SerialDecodeInput", 0x2994, { prep: P_((mem, r) => { noIrq(mem); mem.hram[0x40] = r(256); mem.hram[0x42] = 1 + r(2); mem.hram[0x55] = r(2) * r(256); mem.hram[0x5E] = r(2) * r(256); }) }),

  // ---- vblank.js (the handlers run as routines here; in place, the lockstep) ----
  T("VBlankHandler", 0x2749),
  T("VBlankHandler variants", 0x2749, { when: s => (s.m.mem.hram[0x10] & 0x0F) !== 0x0F, prep: P_((mem, r) => {
    mem.hram[0x0D] = r(2); mem.hram[0x18] = r(3); mem.hram[0x1E] = r(4) ? 0 : 1 + r(3); mem.hram[0x58] = r(4) ? 0 : 1; mem.hram[0x67] = r(8) ? 0 : 1;
  }) }),
  T("TimerHandler", 0x27D7, { prep: P_((mem, r) => { if (r(2)) mem.write(0xFF40, mem.read(0xFF40) & 0x7F); mem.hram[0x42] = r(3); mem.iflag = r(32); mem.machine.cpu.halted = false; }) }),
  T("LCDStatHandler", 0x27F5, { prep: P_((mem, r) => W(mem, 0xCB01, r(256), r(160), r(160))) }),
  T("EnableTimerInterrupt", 0x2A0E, { prep: noIrq }),
  T("ReadJoypadThunk", 0x2851, { out: NOF }),          // (ReadJoypad's port leaves F alone)
  T("SoftResetIfABStartSelect", 0x2855, { gen: r => ({ a: (a => (a === 0x0F ? 0x0E : a))(r(256)) }) }),
];
