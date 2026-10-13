// Routine tests for the bank-0 graphics and memory modules of web/js/port/home (memory, palettes, decompress,
// view, colorfade, fade; run by web/tests/port_routines.mjs). Registers are drawn from the state (a hash of the
// recording and frame) with edge values mixed in; prep() forces the rare branches (queue contents, fade states,
// palette dirty flags, full sprite pages). Jumps (rst $00, JumpToHL) run from a stub written into the stack
// page ($CF00, never compared).
import { loadRom } from "../engine/corpus.mjs";

const ALL = ["a", "f", "b", "c", "d", "e", "h", "l"];
const NOF = ["a", "b", "c", "d", "e", "h", "l"];

function rng(s, salt) {
  let x = 2166136261 ^ salt;
  for (const ch of `${s.rec}@${s.f}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
  x = (x >>> 0) || 1;
  return n => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x % n; };
}
let salt = 0;
// regs from gen(r, s) -> { a, f, bc, de, hl } (any left out are random)
const regsOf = (gen, k) => s => {
  const r = rng(s, k), g = { a: r(256), f: r(16) << 4, bc: r(0x10000), de: r(0x10000), hl: r(0x10000), ...gen(r, s) };
  return { a: g.a, f: g.f, b: g.bc >> 8, c: g.bc & 0xFF, d: g.de >> 8, e: g.de & 0xFF, h: g.hl >> 8, l: g.hl & 0xFF };
};
// a test: gen(r, s) draws the registers; prep(mem, s, r) forces a branch (r: the same draws on both machines).
// hWramBank is set to the WRAM bank mapped for the test on both machines (romCall sets it on the core only).
// noIrq: for routines whose ROM code turns interrupts on or runs long (the sound code, FarReadWordDI): IE off,
// so that no VBlank handler runs in the middle on the core (the port's code takes no time).
const T = (name, addr, { gen = () => ({}), out = ALL, prep, when, wram, ignore, noIrq } = {}) => {
  const k = ++salt * 7919;
  return { name, bank: 0, addr, out, regs: regsOf(gen, k), when, wram, ignore,
    prep: (mem, s) => { mem.hram[0x16] = mem.svbk; if (noIrq) mem.ie = 0; if (prep) prep(mem, s, rng(s, k + 1)); },
    js: noIrq ? (P, regs) => { P.cpu.halted = false; return P.callRom(0, addr, regs); } : undefined };
};
const pick = s => s.f % 16;                                  // an entry index both gen and prep agree on
// code at $CF00 (the stack page): the routine runs from it, as romCall runs it (interrupts off)
const STUB = 0xCF00;
const S = (name, bytes, opts = {}) => {
  const t = T(name, STUB, opts), prep = t.prep;
  return { ...t, js: (P, regs) => { P.ime = false; return P.callRom(0, STUB, regs); },
    prep(mem, s) { bytes(s).forEach((b, i) => mem.write(STUB + i, b)); if (prep) prep(mem, s); } };
};
const CALL = 0xCD, RET = 0xC9, RST00 = 0xC7, JP = 0xC3;

const wram0 = r => 0xC000 + r(0xC00);                       // pointers well below the stack page
const wramx = r => 0xD000 + r(0x800);
const anySrc = r => [r(0x8000), 0xC000 + r(0xC00), wramx(r)][r(3)];
const romBankOf = mem => mem.romBank;
const setRomBank = (mem, b) => { mem.romBank = b; mem.updateRom(); mem.hram[0x15] = b; };
const w = (mem, a, v) => mem.write(a, v & 0xFF);
const w16 = (mem, a, v) => { w(mem, a, v); w(mem, a + 1, v >> 8); };
const lcdOn = s => s.m.ppu.lcdc & 0x80;

// ---- real LZ streams: table entries of a few banks that decompress to at most $C00 bytes ----
const ROM = loadRom();
function lzSize(bank, addr) {
  let o = bank * 0x4000 + addr - 0x4000, n = 0;
  const end = (bank + 1) * 0x4000;
  for (;;) {
    if (o >= end) return -1;
    const flags = ROM[o++];
    for (let bit = 0; bit < 8; bit++) {
      if (o + 2 > end || n > 0xC00) return -1;
      if (flags >> bit & 1) { o++; n++; continue; }
      const lo = ROM[o++], hi = ROM[o++];
      if (!lo && !hi) return n;
      if (n + (((hi >> 5) << 8 | lo) - 0x800) < 0) return -1;      // reaches before the start: not a real stream
      n += (hi & 0x1F) + 3;
    }
  }
}
const romWord = (bank, a) => (a < 0x4000 ? ROM[a] | ROM[a + 1] << 8 : ROM[bank * 0x4000 + a - 0x4000] | ROM[bank * 0x4000 + a - 0x3FFF] << 8);
const STREAMS = [];                                          // [bank, slot, address, size]
for (const bank of [0x09, 0x0A, 0x16, 0x17, 0x1A, 0x29, 0x2A, 0x6B]) {
  for (let slot = 0; slot < 0x60 && STREAMS.length < 64; slot += 2) {
    const p = ROM[bank * 0x4000 + slot] | ROM[bank * 0x4000 + slot + 1] << 8;
    if (p < 0x4000 || p >= 0x8000) continue;
    const n = lzSize(bank, p);
    if (n >= 16) STREAMS.push([bank, slot, p, n]);
  }
}
const stream = r => STREAMS[r(STREAMS.length)];
const streamOf = s => STREAMS[(s.f * 7 + s.rec.length) % STREAMS.length];   // the same in gen and prep
// { a, hl } for the Unused_00_Far*Indexed helpers whose table and entry both lie in ROM (not the stack page)
function romIndexed(r) {
  for (;;) {
    const bank = r(0x80), slot = r(0x20) << 1, a = r(256);
    const t = romWord(bank, 0x4000 | slot);
    if (t >= 0x8000) continue;
    const at = (t + ((a * 2) & 0xFF)) & 0xFFFF;
    if (at < 0x7FFF && (at < 0x3FFF || at >= 0x4000) && romWord(at < 0x4000 ? 0 : bank, at) < 0x8000) return { a, hl: bank << 8 | slot };
  }
}
// [bank, slot, index]: entry `index` of the word table bank's slot points to is such a stream
const INDEXED = [];
for (const bank of [0x09, 0x0A, 0x16, 0x17, 0x1A, 0x29, 0x2A, 0x6B, 0x6C, 0x13, 0x14]) {
  for (let slot = 0; slot < 0x40 && INDEXED.length < 32; slot += 2) {
    const t = romWord(bank, 0x4000 + slot);
    if (t < 0x4000 || t >= 0x7FF0) continue;
    for (let i = 0; i < 4; i++) {
      const p = romWord(bank, t + 2 * i);
      if (p >= 0x4000 && p < 0x8000 && lzSize(bank, p) >= 16) INDEXED.push([bank, slot, i]);
    }
  }
}

// ---- queue contents for ProcessVRAMCopyQueues ----
function fillVRAMQueue(mem, r, n) {
  for (let i = 0; i < 10; i++) {
    const slot = 0xC0A0 + i * 8;
    if (i >= n) { w(mem, slot, 0); continue; }
    const src = anySrc(r);
    [1 + r(0x7F), 1 + r(7), src >> 8, src, r(2), 0x80 + r(0x18), r(256), r(8)].forEach((v, k) => w(mem, slot + k, v));
  }
}
function fillTileQueue(mem, r, n) {
  for (let i = 0; i < 16; i++) {
    const slot = 0xC180 + i * 4, dest = 0x9800 + r(0x800);
    if (i >= n) { w(mem, slot, 0); continue; }
    [dest >> 8, dest, r(256), r(256)].forEach((v, k) => w(mem, slot + k, v));
  }
}
const fillFrameTasks = (mem, r, free) => {
  for (let i = 0; i < 16; i++) {
    const at = 0xC1C0 + i * 4, used = !free.includes(i);
    [used ? r(256) : 0, used ? r(256) : 0, used ? 0x40 + r(0x40) : 0, used ? r(0x80) : 0].forEach((v, k) => w(mem, at + k, v));
  }
};

export const ROUTINES = [
  // ---- memory.js ----
  T("RetStub", 0x03AE),
  T("ClearMemory16", 0x03AF, { gen: r => ({ hl: wram0(r), bc: r(0x30) + 1 }) }),
  T("ClearMemory16 (banked, c 0)", 0x03AF, { gen: r => ({ hl: 0xD000, bc: 0 }) }),
  T("ClearMemoryBC16", 0x03C4, { gen: r => ({ hl: wramx(r), bc: 1 + r(0x40) }) }),
  T("CopyMemoryBC", 0x03DB, { gen: r => ({ hl: anySrc(r), de: wram0(r), bc: 1 + r(0x2FF) }), out: ALL }),
  T("CopyMemoryBC (c 0)", 0x03DB, { gen: r => ({ hl: anySrc(r), de: wram0(r), bc: (1 + r(2)) << 8 }) }),
  T("CopyMemoryBC (overlapping)", 0x03DB, { gen: r => { const d = wram0(r); return { hl: d - 1 - r(8), de: d, bc: 1 + r(0x100) }; } }),
  T("Unused_00_CopyMemoryReverseBC", 0x03EA, { gen: r => ({ hl: anySrc(r), de: 0xC400 + r(0x800), bc: 1 + r(0x3FF) }) }),
  T("CopyMemoryFast", 0x03F3, { gen: r => ({ hl: anySrc(r), de: wram0(r), bc: 1 + r(0x30) }) }),
  T("CopyMemoryFast (aligned)", 0x03F3, { gen: r => ({ hl: anySrc(r), de: wram0(r) & 0xFFF0, bc: 1 + r(0x30) }) }),
  T("CopyMemoryFast (c 0)", 0x03F3, { gen: r => ({ hl: anySrc(r), de: 0xD000, bc: 0 }) }),
  T("Unused_00_FillMemoryCFast", 0x0460, { gen: r => ({ hl: wram0(r), bc: r(0x100) }) }),
  T("ClearVRAMCopyQueue", 0x0465),
  T("QueueVRAMCopy", 0x0480, { gen: r => ({ hl: anySrc(r), de: 0x8000 + r(0x1800) + r(2) * 0x2000, bc: 1 + r(0x20) }) }),
  T("QueueVRAMCopy (queue part full)", 0x0480, { gen: r => ({ hl: anySrc(r), de: 0x8000 + r(0x3800), bc: 1 + r(0x20) }),
    prep: (mem, s, r) => fillVRAMQueue(mem, r, r(11)), when: lcdOn }),
  T("QueueVRAMCopy (queue full)", 0x0480, { gen: r => ({ hl: anySrc(r), de: 0x8000 + r(0x3800), bc: 1 + r(0x20) }),
    prep: (mem, s, r) => fillVRAMQueue(mem, r, 10), when: lcdOn }),
  T("QueueVRAMCopy (full, debug alarm)", 0x0480, { gen: r => ({ hl: anySrc(r), de: 0x8000 + r(0x3800), bc: 1 + r(0x20) }),
    prep: (mem, s, r) => { fillVRAMQueue(mem, r, 10); mem.hram[0x1E] = 1; }, when: lcdOn, noIrq: true }),
  T("QueueVRAMCopy (LCD off)", 0x0480, { gen: r => ({ hl: anySrc(r), de: 0x8000 + r(0x1800) + r(2) * 0x2000, bc: 1 + r(0x20) }),
    prep: mem => w(mem, 0xFF40, mem.read(0xFF40) & 0x7F) }),
  T("QueueVRAMCopyFromBank", 0x046D, { gen: r => ({ hl: 0x4000 + r(0x3E00), de: 0x8000 + r(0x3800), bc: (1 + r(0x7F)) << 8 | (1 + r(0x10)) }),
    prep: (mem, s, r) => fillVRAMQueue(mem, r, r(10)) }),
  T("QueueVRAMCopyFromBank (LCD off)", 0x046D, { gen: r => ({ hl: 0x4000 + r(0x3E00), de: 0x8000 + r(0x3800), bc: (1 + r(0x7F)) << 8 | (1 + r(0x10)) }),
    prep: mem => w(mem, 0xFF40, mem.read(0xFF40) & 0x7F) }),
  T("QueueBGTileWrite", 0x0507, { gen: r => ({ de: 0x9800 + r(0x800) }), prep: (mem, s, r) => fillTileQueue(mem, r, r(17)) }),
  T("QueueBGTileWrite (full)", 0x0507, { gen: r => ({ de: 0x9800 + r(0x800) }), prep: (mem, s, r) => fillTileQueue(mem, r, 16) }),
  T("ProcessVRAMCopyQueues", 0x052E),
  T("ProcessVRAMCopyQueues (queued)", 0x052E, { prep: (mem, s, r) => { fillVRAMQueue(mem, r, r(11)); fillTileQueue(mem, r, r(17)); mem.hram[0x19] = 1; } }),
  T("ProcessVRAMCopyQueues (all full)", 0x052E, { prep: (mem, s, r) => { fillVRAMQueue(mem, r, 10); fillTileQueue(mem, r, 16); mem.hram[0x19] = 1; } }),
  T("ProcessVRAMCopyQueues (not dirty)", 0x052E, { prep: (mem, s, r) => { fillVRAMQueue(mem, r, 3); mem.hram[0x19] = 0; } }),
  T("ProcessBGBlitQueue", 0x218D),
  ...[[1, 0], [0, 1], [1, 1]].map(([row, col]) => T(`ProcessBGBlitQueue (row ${row} col ${col})`, 0x218D, {
    prep: (mem, s, r) => { mem.hram[0x38] = row * (1 + r(255)); mem.hram[0x39] = col * (1 + r(255)); w16(mem, 0xC326, 0x9800 + (r(0x40) << 4)); w(mem, 0xC328, r(32)); } })),

  // ---- palettes.js ----
  T("LoadBGPaletteData", 0x027F, { gen: r => ({ hl: anySrc(r) }) }),
  T("LoadOBJPaletteData", 0x0287, { gen: r => ({ hl: anySrc(r) }) }),
  T("LoadPaletteShadow", 0x05B0, { gen: r => ({ hl: anySrc(r), de: r(16) << 8 | (1 + r(8)) }), prep: (mem, s, r) => { mem.hram[0x3C] = r(2); } }),
  T("LoadPalettesImmediate", 0x05B5, { gen: r => ({ hl: anySrc(r), de: r(16) << 8 | (1 + r(8)) }) }),
  T("LoadPalettesImmediate (wrapping)", 0x05B5, { gen: r => ({ hl: anySrc(r), de: r(256) << 8 | r(256) }) }),
  T("LoadPalettesMasterOnly", 0x05E1, { gen: r => ({ hl: anySrc(r), de: r(256) << 8 | r(256) }) }),
  T("RestorePalettesFromMaster", 0x05F4),
  ...[0, 1, 2, 3].map(d => T(`ApplyPendingPaletteUpdates (dirty ${d})`, 0x060D, { prep: mem => { mem.hram[0x1D] = d; } })),
  T("FarReadByte", 0x0628, { gen: r => ({ a: r(0x80), hl: anySrc(r) }), out: ALL }),
  T("FarReadWord", 0x063D, { gen: r => ({ a: r(0x80), hl: anySrc(r) }) }),
  T("FarReadWordDI", 0x0652, { gen: r => ({ a: r(0x80), hl: anySrc(r) }) }),
  T("Unused_00_ReadFarVectorEntry", 0x0661, { gen: r => ({ hl: r(0x80) << 8 | r(256) }) }),
  T("FarCopyBytes", 0x067A, { gen: r => ({ a: r(0x80), hl: anySrc(r), de: wram0(r), bc: 1 + r(0x1FF) }) }),
  T("Unused_00_FarDecompressData", 0x0692, { gen: r => { const [b, , p] = stream(r); return { a: b, hl: p, de: 0xD000 + r(0x100) }; }, wram: 1 }),
  T("CopyOAMDMARoutineToHRAM", 0x06AC),
  T("Unused_00_FarDispatchIndexed", 0x06CF, { gen: r => { const [b, slot, i] = INDEXED[r(INDEXED.length)]; return { a: i, hl: b << 8 | slot, de: 0xD000 + r(0x200) }; }, wram: 1 }),
  T("Unused_00_FarCopyIndexed", 0x06F7, { gen: r => ({ a: r(256), hl: r(0x80) << 8 | (r(0x20) << 1), de: wram0(r), bc: r(0x10000) }) }),
  T("Unused_00_FarCallIndexed1", 0x0726, { gen: r => ({ ...romIndexed(r), de: 0x8000 + r(0x3800), bc: 1 + r(0x10) }) }),
  T("Unused_00_FarCallIndexed2", 0x0752, { gen: r => ({ ...romIndexed(r), de: 0x8000 + r(0x1800), bc: 1 + r(0x10) }) }),
  T("Unused_00_FarCallIndexed3", 0x077E, { gen: r => ({ ...romIndexed(r), de: wram0(r), bc: 1 + r(0x10) }) }),
  // (UpdateAllObjSprites, 09:4002, waits for a frame: the lockstep covers it)
  T("FarCallVector LoadDebugMenuPalette", 0x07C5, { gen: r => ({ hl: 0x0110, bc: r(0x80) << 8 | r(256) }), noIrq: true }),
  T("Unused_00_FarReadPtrIndexed LoadDebugMenuPalette", 0x07AA, { gen: r => ({ hl: 0x0110, bc: r(0x80) << 8 | r(256) }), noIrq: true }),
  T("Unused_00_CopyMapRows32To64", 0x07DD, { gen: r => ({ hl: anySrc(r), de: 0xD000 + r(0x400) }), wram: 2 }),
  T("Unused_00_CopyMapToScrollBuffers", 0x086C),
  // rst $00 with a table of [ret, ret, AdvanceRandomSeed, SplitColorComponents]
  S("JumpTableDispatch", () => [RST00, 0x10, 0xCF, 0x11, 0xCF, 0x3A, 0x0A, 0x6A, 0x1C, 0, 0, 0, 0, 0, 0, 0, RET, RET],
    { gen: r => ({ a: r(4) }) }),
  // the same from $CFC0: entry $20 is at $D001, past the page (a ret written there)
  S("JumpTableDispatch (carry into h)", () => { const b = Array(0xC1).fill(0); b[0] = JP; b[1] = 0xC0; b[2] = 0xCF; b[0x10] = RET; b[0xC0] = RST00; return b; },
    { gen: () => ({ a: 0x20 }), prep: mem => { w16(mem, 0xD001, 0xCF10); } }),
  S("JumpToHL", () => [CALL, 0xCE, 0x06, RET], { gen: r => ({ hl: [0x0A3A, 0x1C6A, 0x1B63][r(3)] }) }),

  // ---- decompress.js ----
  T("DecompressData", 0x1797, { gen: (r, s) => ({ hl: streamOf(s)[2], de: 0xD000 + r(0x200) }), wram: 1,
    prep: (mem, s) => { mem.romBank = streamOf(s)[0]; mem.updateRom(); } }),
  T("DecompressDataFromBank", 0x0234, { gen: r => { const [b, slot] = stream(r); return { hl: b << 8 | slot, de: 0xD000 + r(0x200) }; }, wram: 1 }),
  T("CopyDataFromBank", 0x021A, { gen: r => ({ hl: (1 + r(0x7F)) << 8 | (r(0x20) << 1), de: wram0(r), bc: 1 + r(0x2FF) }) }),
  T("GetTangent", 0x1767),
  T("GetTangent (second quadrant)", 0x1767, { gen: r => ({ hl: 0x4000 | r(0x4000) | r(2) << 15 }) }),
  T("GetTangent (edges)", 0x1767, { gen: r => ({ hl: [0, 0x4000, 0x40FF, 0x3FFF, 0x3F00, 0x7FFF, 0xC000, 0x8000, 0xFFFF][r(9)] }) }),

  // ---- view.js ----
  T("QueueSprite32x32", 0x2CED, { prep: (mem, s, r) => { mem.hram[0x1B] = r(0x29) * 4; } }),
  T("QueueSprite32x32 (mirrored)", 0x2CED, { gen: r => ({ bc: (r(256) | 0x20) << 8 | r(256) }), prep: (mem, s, r) => { mem.hram[0x1B] = r(0x29) * 4; } }),
  T("QueueSpriteBlockPart", 0x2D79, { gen: r => ({ hl: (0xC0 + 5 * r(2)) << 8 | r(0x29) * 4 }) }),
  T("ProjectWorldToScreen", 0x2D8C, { out: NOF }),
  T("MulViewScaleA", 0x2DE9, { out: ["a", "h", "l"], prep: mem => setRomBank(mem, 0x2F) }),
  T("MulViewScaleANeg", 0x2E11, { out: ["a", "h", "l"], prep: mem => setRomBank(mem, 0x2F) }),
  T("MulViewScaleB", 0x2E39, { out: ["a", "h", "l"], prep: mem => setRomBank(mem, 0x2F) }),
  T("GetPerspectiveScale", 0x2E61, { prep: mem => setRomBank(mem, 0x2E) }),
  ...[4, 5, 6, 7].map(bank => T(`QueueCharFrameTiles (WRAM ${bank})`, 0x2E6B, { gen: r => ({ de: r(0x40) }), wram: bank, out: NOF,
    prep: (mem, s, r) => { w(mem, 0xC4CA, r(2)); fillVRAMQueue(mem, r, r(6)); } })),
  T("QueueTileCopyAdvance", 0x2F0C, { gen: r => ({ hl: anySrc(r), de: 0x8000 + r(0x3800) }) }),

  // ---- colorfade.js ----
  T("Compare3Bytes", 0x1B48, { gen: r => { const a = wram0(r); return { hl: a, de: r(2) ? a : wram0(r) }; } }),
  T("Check3BytesZero", 0x1B63, { gen: r => ({ hl: [wram0(r), 0xC1C1 + 4 * r(16)][r(2)] }) }),
  T("RegisterFrameTask", 0x1B6A, { gen: r => ({ a: r(256), hl: 0x4000 + r(0x4000) }) }),
  T("RegisterFrameTask (present)", 0x1B6A, {
    gen: (r, s) => { const k = pick(s), t = s.m.mem.wram[0]; return { a: r(256), hl: t[0x1C1 + 4 * k] | t[0x1C2 + 4 * k] << 8 }; },
    prep: (mem, s) => { mem.hram[0x15] = mem.wram[0][0x1C3 + 4 * pick(s)]; } }),
  T("RegisterFrameTask (table full)", 0x1B6A, { gen: r => ({ a: r(256), hl: 0x4000 + r(0x4000) }),
    prep: (mem, s, r) => { fillFrameTasks(mem, r, []); for (let i = 0; i < 0x18; i++) if (r(3) === 0) w(mem, 0xC200 + i, 0); } }),
  T("RegisterFrameTask (free entries)", 0x1B6A, { gen: r => ({ a: r(256), hl: 0x4000 + r(0x4000) }),
    prep: (mem, s, r) => fillFrameTasks(mem, r, [r(16), r(16), r(16)]) }),
  T("UnregisterFrameTask", 0x1BCB, { gen: r => ({ hl: 0x4000 + r(0x4000) }) }),
  T("UnregisterFrameTask (present)", 0x1BCB, {
    gen: (r, s) => { const k = pick(s), t = s.m.mem.wram[0]; return { hl: t[0x1C1 + 4 * k] | t[0x1C2 + 4 * k] << 8 }; },
    prep: (mem, s) => { mem.hram[0x15] = mem.wram[0][0x1C3 + 4 * pick(s)]; } }),
  T("RunFrameTasks", 0x1BFF, { gen: r => ({ a: r(2) << 7 | r(0x80) }), out: ALL, noIrq: true }),
  T("RunFrameTasks (not ready)", 0x1BFF, { prep: mem => { mem.hram[0x0F] = 0; } }),
  T("SortFrameTasks", 0x1C3F),
  T("SortFrameTasks (shuffled)", 0x1C3F, { prep: (mem, s, r) => fillFrameTasks(mem, r, [r(16), r(16)]) }),
  T("SortFrameTasks (ties)", 0x1C3F, { prep: (mem, s, r) => { fillFrameTasks(mem, r, [r(16)]); for (let i = 0; i < 16; i++) w(mem, 0xC1C0 + 4 * i, [0, 0x40, 0x81][r(3)]); } }),
  T("SplitColorComponents", 0x1C6A),
  T("CombineColorComponents", 0x1C83, { gen: r => ({ a: r(2) ? r(32) : r(256), bc: r(2) ? r(32) << 8 | r(32) : r(0x10000) }) }),
  T("AddClampColorComponent", 0x1CA0, { gen: r => ({ a: r(32), de: [r(32), 0x100 - r(32), r(256)][r(3)] << 8 }) }),
  T("AdjustColorRed", 0x1CAD, { gen: r => ({ de: [r(32), 0x100 - r(32)][r(2)] << 8 }) }),
  T("AdjustColorGreen", 0x1CB9, { gen: r => ({ de: [r(32), 0x100 - r(32)][r(2)] << 8 }) }),
  T("AdjustColorBlue", 0x1CC9, { gen: r => ({ de: [r(32), 0x100 - r(32)][r(2)] << 8 }) }),
  T("AdjustColorsBrightness", 0x1CD9, { gen: r => ({ hl: 0xC200, de: 0xC100, bc: 0x4000 | r(0x20) }) }),
  T("AdjustColorsBrightness (any)", 0x1CD9, { gen: r => ({ hl: anySrc(r), de: wram0(r), bc: r(0x10000) }) }),
  ...[["BeginFadeOut", 0x1D20], ["BeginFadeIn", 0x1D2E], ["Unused_00_ForceFadeOut", 0x1D09], ["ForceFadeIn", 0x1D0C],
    ["Unused_00_BeginWhiteFadeOut", 0x1D0F]].map(([name, addr]) => T(name, addr, {
    gen: r => ({ bc: r(2) ? r(4) : r(0x10000) }), prep: (mem, s, r) => { mem.hram[0x3C] = r(2); mem.hram[0x22] = r(4); } })),
  ...[["UpdateFadeOut", 0x1D5E], ["UpdateFadeIn", 0x1D48]].flatMap(([name, addr]) => [
    T(name, addr),
    T(`${name} (fading)`, addr, { prep: (mem, s, r) => { mem.hram[0x22] = [1, 2, 3][r(3)]; mem.hram[0x23] = 1 + r(8); mem.hram[0x24] = r(0x7D); } }),
    T(`${name} (ending)`, addr, { prep: (mem, s, r) => { mem.hram[0x22] = 3; mem.hram[0x23] = 4; mem.hram[0x24] = r(5); } }),
    T(`${name} (white)`, addr, { prep: (mem, s, r) => { mem.hram[0x22] = 0x80 | (1 + r(3)); mem.hram[0x23] = 1 + r(8); mem.hram[0x24] = r(0x7D); } }),
  ]),
  T("WaitFadeEnd (no fade)", 0x1DA4, { prep: mem => { mem.hram[0x22] = 0; } }),
  T("Unused_00_WaitFadeEndLinked (no fade)", 0x1DBD, { prep: mem => { mem.hram[0x22] = 0; } }),

  // ---- fade.js ----
  T("Unused_00_ApplyWhiteFade", 0x1DCC),
  T("ClearSpriteQueue", 0x1E1D),
  T("ClearUnusedSprites", 0x1E22, { prep: (mem, s, r) => { mem.hram[0x1C] = r(0x29) * 4; } }),
  T("ClearUnusedSprites (unaligned)", 0x1E22, { prep: (mem, s, r) => { mem.hram[0x1C] = 0x9D + r(3); } }),
  T("ClearBothSpriteBuffers", 0x1E3D),
  T("Unused_00_SetSpriteQueueBase", 0x1E50),
  T("QueueSprite16", 0x1E55, { out: NOF, prep: (mem, s, r) => { mem.hram[0x1B] = r(0x29) * 4; } }),
  T("QueueSprite16 (mirrored)", 0x1E55, { out: NOF, gen: r => ({ bc: (r(256) | 0x20) << 8 | r(256) }), prep: (mem, s, r) => { mem.hram[0x1B] = r(0x29) * 4; } }),
  T("QueueSpriteTemplate", 0x1E9D, { gen: r => ({ hl: anySrc(r) }), prep: (mem, s, r) => { mem.hram[0x1B] = r(0x29) * 4; } }),
  T("QueueSpriteTemplate (mirrored)", 0x1E9D, { gen: r => ({ hl: anySrc(r), bc: (r(256) | 0x20) << 8 | r(256) }),
    prep: (mem, s, r) => { mem.hram[0x1B] = r(0x29) * 4; } }),
  T("Unused_00_QueueSpriteGrid", 0x1F0D, { gen: r => ({ hl: (1 + r(4)) << 8 | (1 + r(4)) }), prep: (mem, s, r) => { mem.hram[0x1B] = r(0x29) * 4; } }),
  T("QueueSprite", 0x1F51, { out: NOF, prep: (mem, s, r) => { mem.hram[0x1B] = r(0x29) * 4; } }),
  T("Unused_00_PositionSpriteWorld", 0x1F6B, { gen: (r, s) => ({ hl: (s.m.mem.wram[0][0x320] | s.m.mem.wram[0][0x321] << 8) + r(0x1800) - 0x100,
    de: (s.m.mem.wram[0][0x322] | s.m.mem.wram[0][0x323] << 8) + r(0x1600) - 0x100 }) }),
  T("Unused_00_PositionSpriteWorld2", 0x1FB1, { gen: (r, s) => ({ hl: (s.m.mem.wram[0][0x320] | s.m.mem.wram[0][0x321] << 8) + r(0x1800) - 0x100,
    de: (s.m.mem.wram[0][0x322] | s.m.mem.wram[0][0x323] << 8) + r(0x1600) - 0x100 }) }),
];
