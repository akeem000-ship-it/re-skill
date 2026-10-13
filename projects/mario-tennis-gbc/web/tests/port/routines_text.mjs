// Routine tests for web/js/port/text, the text and window engine of bank $05 (run by web/tests/port_routines.mjs;
// names start "text." — run them alone with `node web/tests/port_routines.mjs text. --rec out/port/story1.mtrec,
// out/port/debug1.mtrec,out/engine/rec2.mtrec`). Registers are drawn from the state (a hash of the recording and
// frame); prep() sets up the
// engine's state where a branch needs it (windows, the glyph stream, queues, flags, the printer's text), and
// switches the LCD off for routines that only wait for frames while it is on (their VRAM copies then go by DMA at
// once). Every test runs with interrupts off on both machines (IE 0, the CPU not halted), as romCall runs the ROM.
// Routines that wait for frames whatever the state (the button and page waits, the delays, the menus) are checked
// by web/tests/port_lockstep.mjs over out/port/story1.mtrec, out/port/debug1.mtrec and out/engine/rec2.mtrec.

const ALL = ["a", "f", "b", "c", "d", "e", "h", "l"];
const NOF = ["a", "b", "c", "d", "e", "h", "l"];

function rng(s, salt) {
  let x = 2166136261 ^ salt;
  for (const ch of `${s.rec}@${s.f}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
  x = (x >>> 0) || 1;
  return n => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x % n; };
}
let salt = 0;
const regsOf = (gen, k) => s => {
  const r = rng(s, k), g = { a: r(256), f: r(16) << 4, bc: r(0x10000), de: r(0x10000), hl: r(0x10000), ...gen(r, s) };
  return { a: g.a & 0xFF, f: g.f & 0xF0, b: (g.bc >> 8) & 0xFF, c: g.bc & 0xFF, d: (g.de >> 8) & 0xFF, e: g.de & 0xFF, h: (g.hl >> 8) & 0xFF, l: g.hl & 0xFF };
};

// ---- memory helpers (prep gets the machine's mem) ----
const w = (mem, a, v) => mem.write(a, v & 0xFF);                          // as mapped now
const w16 = (mem, a, v) => { w(mem, a, v); w(mem, a + 1, v >> 8); };
const w5 = (mem, a, v) => { mem.wram[5][a - 0xD000] = v & 0xFF; };      // WRAM bank 5 whatever is mapped
const w5_16 = (mem, a, v) => { w5(mem, a, v); w5(mem, a + 1, v >> 8); };
const r5 = (mem, a) => mem.wram[5][a - 0xD000];
const lcdOff = mem => w(mem, 0xFF40, mem.read(0xFF40) & 0x7F);
const FLAGS = 0xC9C0;
const flag = (mem, n, on) => { const a = FLAGS + (n >> 3), m = 0x80 >> (n & 7); w(mem, a, on ? mem.read(a) | m : mem.read(a) & ~m); };
const F = { FAST_FORWARD: 22, VRAM_BUSY: 24, DEBUG_STATIC: 27, EDITOR_OPEN: 31, SHORT_UPLOAD: 34, RENDER_ACTIVE: 35, PROPORTIONAL: 36, PAUSE_OPTIONS: 48, MINIGAME_PAUSE: 49, WIDE: 253 };
// text ids: bank index (bits 13-10) and an index under the bank's string count (AddTextIdOffsetWordLookupTable)
const COUNTS = [0x230, 0x15B, 0xBB, 0xDD, 0x11F, 0x10E, 0x2C7, 0x100, 0xF2, 0xBD, 0x10B, 0xF9, 0x143];
const textId = r => { const b = r(13); return b << 10 | r(COUNTS[b]); };
const anyTextId = r => r(4) ? textId(r) : r(0x10000);
const shortId = r => r(256);
const MENU_TEXTS = r => [0x001A, 0x0132, 0x0133, 0x0134, 0x0135, 0x0137, 0x0136, 0x0179 + r(0x20)][r(8)];
// a window struct: column, row, width, height, state, text id
function window(mem, r, id, { width = 3 + r(18), height = 3 + 2 * r(4), state = [0, 2, 3, 0, 2][r(5)], text = textId(r) } = {}) {
  const p = 0xDC00 + (id & 7) * 8;
  [r(32), r(32), width, height, state, r(256)].forEach((v, i) => w5(mem, p + i, v));
  w5_16(mem, p + 6, text);
  w5(mem, 0xDC70, r5(mem, 0xDC70) | (1 << (id & 7)));
}
// the window engine pointed at its own map (or a screen's, bank 3), some windows, a dialogue window and the glyph state
function world(mem, r, { bank3 = r(4) === 0 } = {}) {
  w16(mem, 0xC3B4, 0xD000); w(mem, 0xC3B3, bank3 ? 3 : 5); w(mem, 0xC3B6, [0x80, 0x00, 0x08, 0x88][r(4)]);
  w5(mem, 0xDC70, 0);
  for (let id = 0; id < 8; id++) window(mem, r, id);
  w5(mem, 0xDC70, r(256));
  const dlg = r(7);
  window(mem, r, dlg, { width: 4 + r(17), height: 3 + 2 * r(3) });
  w5(mem, 0xD824, dlg); w5(mem, 0xD821, r(3) ? dlg : 0); w5(mem, 0xD820, r(2) ? dlg : r(7));
  w5(mem, 0xD82F, r(7)); w5(mem, 0xD822, r(3) ? 0 : 1);           // menu window, glyph buffer hold
  w(mem, 0xC3BB, r(0x60)); w(mem, 0xC3BC, r(0x60)); w(mem, 0xC3B9, 2 + r(16)); w(mem, 0xC3BA, r(0x40));   // row start, flushed, row width / column
  w16(mem, 0xC3B7, r(0x2000)); w16(mem, 0xCB76, 0xD000 + r(0x400)); w(mem, 0xCB78, r(2));               // pen, write pointer, stamp
  w(mem, 0xC8A4, [0, 1, 2, 0x80][r(4)]); w(mem, 0xC8A7, r(4) ? 0 : 1);                                 // message speed, match-stats
  w5(mem, 0xD82A, r(20)); w5(mem, 0xD82B, r(30));                   // printer cursor column / row
  w5_16(mem, 0xD869, r(2) ? 0xC600 : 0xC600 + r(0x40));           // wTextStreamPtr
  w5(mem, 0xD829, 0);                                              // wTextRedrawGuard: no per-character waits
  ["D825", "D826", "D827", "D828"].forEach((a, i) => w5(mem, parseInt(a, 16), [r(12), r(12), 4 + r(17), 3 + 2 * r(3)][i]));
  w(mem, 0xC362, r(2) ? 0 : 0xE0);                                 // wTextRowIndent
  w5_16(mem, 0xD864, 0xD000 + r(0x300));                           // wGlyphVramDest
}
// the argument queues: count / write / measure indices and entries
function queues(mem, r) {
  for (let i = 0; i < 16; i++) {
    const kind = r(3), p = [0xC900, 0xC940, 0xD880, 0xC6C0][r(4)];
    const tagged = p >= 0xD000 ? ((5 << 4) | (p >> 8 & 0x0F)) << 8 | (p & 0xFF) : (p & 0x0FFF);
    w5_16(mem, 0xD8B0 + i * 2, kind ? tagged : 0);
    w5_16(mem, 0xD8D0 + i * 2, [r(10), r(100), r(1000), r(0x10000), 9999, 10000, 65535][r(7)]);
    w5(mem, 0xD8F0 + i, r(256));
  }
  for (const a of [0xD847, 0xD848, 0xD849, 0xD866, 0xD867, 0xD868]) w5(mem, a, r(6));
  for (const a of [0xD84A, 0xD84B, 0xD84C]) w5(mem, a, r(8));
  w(mem, 0xC360, r(2));                                            // wTextNumberRightAlign
  writeString(mem, 0xC900, r); writeString(mem, 0xC940, r); writeString(mem, 0xC6C0, r);   // the names, the inline buffer
  for (let i = 0; i < 16; i++) w5(mem, 0xD880 + i, i < 15 ? 0x41 + r(26) : 0);              // and a short text
}
// a printable name ($00-terminated, letters and the odd dakuten mark)
function writeString(mem, at, r, n = 1 + r(8)) {
  for (let i = 0; i < n; i++) w(mem, at + i, r(8) ? 0x41 + r(26) : r(2) ? 0x20 : 0xDE + r(2));
  w(mem, at + n, 0);
}
// a page for the printer: characters and every control code that does not wait for frames
const SAFE_CODES = [0x01, 0x04, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0D, 0x0E, 0x0F, 0x10, 0x11, 0x12, 0x13, 0x14, 0x19, 0x1D, 0xDE, 0xDF];
function writePage(mem, r, at = 0xC600, n = 4 + r(40)) {
  let p = at;
  for (let i = 0; i < n && p < at + 0x9C; i++) {
    const k = r(10);
    if (k < 7) w(mem, p++, 0x20 + r(0x5B));
    else { const c = SAFE_CODES[r(SAFE_CODES.length)]; w(mem, p++, c); if (c === 0x0E) w(mem, p++, 0x14 + r(12)); }   // (an operand that is no waiting code, should a resume land on it)
  }
  w(mem, p, 0);
  return p - at;
}

// a test of the bank-5 routine at `addr`
const T = (name, addr, { gen = () => ({}), out = ALL, prep, when, wram = 5, ignore, lcd = true, setup = true } = {}) => {
  const k = ++salt * 7919;
  return {
    name: "text." + name, bank: 5, addr, out, regs: regsOf(gen, k), when, wram, ignore,
    prep: (mem, s) => {
      mem.hram[0x16] = mem.svbk; mem.ie = 0;
      const r = rng(s, k + 1);
      if (setup) world(mem, r);
      if (!lcd) lcdOff(mem);
      if (prep) prep(mem, s, r);
    },
    js: (P, regs) => { P.cpu.halted = false; P.ime = false; return P.callRom(5, addr, regs); },
  };
};
const cell = r => r(32) << 8 | r(32);
const winCell = r => r(20) << 8 | r(12);

export const ROUTINES = [
  // ---- window_tilemap.js ----
  T("InitTextWindows", 0x4096),
  T("FetchShortTextToBuffer", 0x409A, { gen: r => ({ hl: textId(r), de: 0xC6C0 + r(0x20) }) }),
  T("Unused_05_ClearWindowGlyphPage", 0x40BE, { wram: 3 }),
  ...[0, 1].map(a => T(`Unused_05_QueueGlyphPageDMAOnA (A ${a})`, 0x40D5, { prep: mem => { mem.hram[0x10] = a ? 0x01 : 0xF0; } })),
  T("WriteTileToShadowMapCell", 0x40FB, { gen: r => ({ a: r(3) ? r(256) : 0, de: cell(r) }) }),
  T("Unused_05_ReadShadowMapCell", 0x4111, { gen: r => ({ de: cell(r) }) }),
  T("GetTilemapCellAddress", 0x4122, { gen: r => ({ de: r(0x10000) }) }),
  T("Unused_05_CopyVisibleTilemapToVRAM", 0x4146, { gen: r => ({ bc: (2 + r(4)) << 8 }), prep: (mem, s, r) => w16(mem, 0xC322, r(0x10000)) }),
  T("Unused_05_CopyVisibleTilemapToVRAM (LCD off)", 0x4146, { gen: r => ({ bc: (2 + r(4)) << 8 }), lcd: false, prep: (mem, s, r) => w16(mem, 0xC322, r(0x10000)) }),
  T("Unused_05_QueueFullTilemapCopy", 0x41C6, { gen: r => ({ bc: (1 + r(7)) << 8 }) }),
  T("Unused_05_QueueFullAttrmapCopy", 0x41DF, { gen: r => ({ bc: (1 + r(7)) << 8 }), lcd: false }),
  T("Unused_05_CopyTilemapRowToVRAM", 0x41F8, { gen: r => ({ a: r(256), bc: (1 + r(7)) << 8 }), out: NOF }),
  T("Unused_05_CopyTilemapRowsToVRAM", 0x4239, { gen: r => ({ a: r(40), bc: (1 + r(7)) << 8 | (r(4) ? r(12) : 0) }), out: NOF }),
  T("RedrawActiveTextWindow (LCD off)", 0x42F1, { lcd: false }),
  T("RedrawActiveTextWindow (static window)", 0x42F1, { prep: mem => flag(mem, F.DEBUG_STATIC, true), out: ["a", "f"] }),
  T("RedrawWindowRowsPaddedThunk (LCD off)", 0x42E9, { gen: r => ({ a: r(8) }), lcd: false }),
  T("RedrawWindowRowsThunk (LCD off)", 0x42ED, { gen: r => ({ a: r(8) }), lcd: false }),
  T("GetWindowCellOffset", 0x4300, { gen: r => ({ a: r(8), de: r(0x10000) }) }),
  T("WriteWindowCellTileAttr", 0x431D, { gen: r => ({ a: r(8), de: winCell(r) }) }),
  T("ReadWindowCellTileAttr", 0x4346, { gen: r => ({ a: r(8), de: winCell(r) }) }),

  // ---- shadow.js ----
  T("RestoreShadowTilemap (LCD off)", 0x436F, { lcd: false, prep: (mem, s, r) => { w16(mem, 0xC320, r(0x10000)); w16(mem, 0xC322, r(0x10000)); } }),
  T("RestoreAllShadowTilemapRows (LCD off)", 0x4383, { lcd: false }),
  T("RestoreTilemapUnderWindow", 0x43A8, { gen: r => ({ a: r(8) }), prep: (mem, s, r) => w16(mem, 0xC322, r(0x2000)) }),
  T("RestoreShadowTilemapRow", 0x43D2, { gen: r => ({ a: r(256) }), prep: (mem, s, r) => w16(mem, 0xC320, r(0x10000)) }),
  T("Unused_05_RefreshShadowTilemapFromMapBuffer", 0x44A3, { prep: (mem, s, r) => { w5_16(mem, 0xDC76, 0xC000 + r(0x600)); mem.hram[0x0A] = r(256); } }),   // (not reading the stack page)
  T("Unused_05_GetCameraTileRow", 0x44F3, { out: ["a", "f"] }),
  T("Unused_05_SetFixedMenuWindowTextId", 0x44F9, { gen: r => ({ hl: textId(r) }) }),
  T("SetWindowRect", 0x4538, { gen: r => ({ hl: 0xDC00 + r(8) * 8, de: r(0x10000) }) }),
  T("DrawTextWindowFrameSaveRegs", 0x4546, { gen: r => ({ a: r(8) }) }),
  T("Unused_05_DrawTileAttrRect", 0x4552, { gen: () => ({ hl: 0xC780 }), prep: (mem, s, r) => {
    const wd = 1 + r(6), ht = 1 + r(4);
    [r(256), r(40), r(40), wd, ht].forEach((v, i) => w(mem, 0xC780 + i, v));
    for (let i = 0; i < wd * ht * 2; i++) w(mem, 0xC785 + i, r(256));
  } }),
  T("Unused_05_ClearShadowMapRect", 0x4590, { gen: () => ({ hl: 0xC780 }), prep: (mem, s, r) => [r(256), r(40), r(40), 1 + r(10), 1 + r(6)].forEach((v, i) => w(mem, 0xC780 + i, v)) }),
  T("Unused_05_CloseMenuWindow", 0x45BA, { gen: r => ({ a: r(9) }), prep: (mem, s, r) => { w5(mem, 0xD83E, r(4) ? r(5) : 0xFF); for (let i = 0; i < 12; i++) w5(mem, 0xD832 + i, r(256)); } }),

  // ---- window_create.js ----
  T("Unused_05_StubNop_05_0", 0x4626),
  T("Unused_05_AllocWindowSlotBit", 0x4627, { out: ["a", "f"], prep: (mem, s, r) => w5(mem, 0xDC70, r(3) ? r(256) : 0x7F) }),
  T("GetScreenTopLeftCell", 0x464B, { prep: (mem, s, r) => { mem.hram[0x0A] = r(256); mem.hram[0x0B] = r(256); } }),
  T("CreateWindowWithAttr", 0x4664, { gen: r => ({ a: r(256), de: winCell(r), bc: (3 + r(18)) << 8 | (3 + r(6)) }) }),
  T("CreateWindow", 0x4684, { gen: r => ({ de: winCell(r), bc: (3 + r(18)) << 8 | (3 + r(6)) }), prep: (mem, s, r) => w5(mem, 0xDC70, r(4) ? r(128) : 0x7F) }),
  T("CreateDialogueWindow", 0x4688, { gen: r => ({ de: winCell(r), bc: (3 + r(18)) << 8 | (3 + r(6)) }) }),
  T("CreateMenuWindowFromText", 0x46B0, { gen: r => ({ hl: textId(r), de: winCell(r) }), out: ["a", "f", "b", "c", "d", "e", "h", "l"],
    prep: (mem, s, r) => { queues(mem, r); w5(mem, 0xD83E, r(4) ? r(5) : 0xFF); w5(mem, 0xDC70, r(5) ? r(128) : 0x7F); } }),
  T("CreateMenuWindowPaged", 0x4747, { gen: r => ({ hl: textId(r), de: winCell(r) }), prep: (mem, s, r) => { queues(mem, r); w5(mem, 0xD83E, r(5)); } }),
  T("ResetWindowState", 0x4757, { gen: r => ({ a: r(256) }) }),
  T("Unused_05_StubNop_05_1", 0x4766),
  T("SetWindowState", 0x4767, { gen: r => ({ a: r(256) }) }),
  T("GetWindowState", 0x4773, { gen: r => ({ a: r(256) }) }),
  T("AnimateTextArrowTask", 0x48F1, { prep: (mem, s, r) => { w5(mem, 0xD841, r(256)); w5_16(mem, 0xD842, 0xD000 + r(0x400)); w5_16(mem, 0xD844, r(2) ? 0x9800 + r(0x400) : r(256) << 8); } }),

  // ---- paged.js / cursor.js ----
  T("Unused_05_PagedMenuFrameTask", 0x49DC),
  ...[0, 1, 2].map(m => T(`Unused_05_IsCursorOnAdjustRow (${m})`, 0x4C76, { out: ["a", "f", "b", "c"], prep: (mem, s, r) => {
    w(mem, 0xCB28, m === 0 ? r(0x80) : 0x80 | r(0x80)); w5(mem, 0xD830, m === 2 ? 0xFF : r(8)); mem.hram[0x11] = r(2) ? 0 : 0x40 << r(2); } })),
  ...[0, 1, 2, 3].map(m => T(`Unused_05_AnimateMenuScrollArrowsTask (${m})`, 0x4C9D, { out: [], prep: (mem, s, r) => {
    w(mem, 0xCB28, 0x80 | r(0x80)); w5(mem, 0xD830, r(5)); flag(mem, F.PAUSE_OPTIONS, m & 1); flag(mem, F.MINIGAME_PAUSE, m & 2);
    w5(mem, 0xD841, r(256)); w5_16(mem, 0xD842, 0xD000 + r(0x400)); w5_16(mem, 0xD844, r(2) ? 0x9800 + r(0x400) : 0); w(mem, 0xCB26, r(7)); } })),
  T("Unused_05_GetMenuCursorBlinkPhase", 0x4E10, { out: ["a", "f"], prep: (mem, s, r) => w5(mem, 0xD841, r(256)) }),
  // the printer on a page of characters and the control codes that do not wait (LCD off: its uploads go at once)
  T("RenderTextString", 0x4E23, { gen: r => ({ hl: 0xC600, de: cell(r) }), lcd: false, out: ["d", "e", "h", "l"],
    prep: (mem, s, r) => { queues(mem, r); writePage(mem, r); writeString(mem, 0xC900, r); writeString(mem, 0xC940, r); w5_16(mem, 0xD84E, 0); w5(mem, 0xD850, 0); flag(mem, F.RENDER_ACTIVE, r(4) === 0); } }),
  T("RenderTextString (resumed)", 0x4E23, { gen: r => ({ hl: 0xC600, de: cell(r) }), lcd: false, out: ["d", "e", "h", "l"],
    prep: (mem, s, r) => { queues(mem, r); const len = writePage(mem, r); writeString(mem, 0xC900, r); writeString(mem, 0xC940, r); w5_16(mem, 0xD84E, 0xC600 + r(1 + len)); w5(mem, 0xD850, 0); } }),
  T("RenderTextString (page break pending)", 0x4E23, { gen: r => ({ hl: 0xC600, de: cell(r) }), lcd: false, prep: (mem, s, r) => { writePage(mem, r); w5(mem, 0xD850, 1); } }),
  T("TextCmdNewline", 0x4ED0, { gen: r => ({ de: r(0x10000) }) }),
  T("TextCmdNop", 0x4EE8),
  T("TextCmdNextGlyphStreamRow", 0x4EE9),

  // ---- arg.js ----
  ...[0, 1].map(st => T(`GetTextContinueArrowCell (static ${st})`, 0x4FBF, { prep: mem => flag(mem, F.DEBUG_STATIC, st) })),
  T("TextContinueArrowBlinkTask", 0x4FE3, { prep: (mem, s, r) => { w5(mem, 0xD841, r(256)); w5_16(mem, 0xD842, 0xD000 + r(0x400)); } }),
  T("WaitTextAdvanceInput (fast forward)", 0x501D, { lcd: false, out: NOF, prep: mem => flag(mem, F.FAST_FORWARD, true) }),
  T("TextCmdPrintArgString", 0x5089, { gen: r => ({ de: 0xD020 + r(0x3E0) }), out: ["d", "e", "h", "l"], prep: (mem, s, r) => { queues(mem, r); writeString(mem, 0xC900, r); writeString(mem, 0xC940, r); writeString(mem, 0xC6C0, r); } }),
  T("PushTextArgString", 0x50F7, { gen: r => ({ hl: r(2) ? 0xD000 + r(0x1000) : 0xC000 + r(0x1000) }), prep: (mem, s, r) => { queues(mem, r); w5(mem, 0xD847, r(4) ? r(16) : 16); } }),
  T("PushTextArgNumber", 0x5147, { gen: r => ({ hl: r(0x10000) }), prep: (mem, s, r) => { queues(mem, r); w5(mem, 0xD848, r(4) ? r(16) : 16); } }),
  T("Unused_05_PushTextArgShortTextId", 0x517A, { prep: (mem, s, r) => { queues(mem, r); w5(mem, 0xD849, r(4) ? r(16) : 16); } }),
  T("TextCmdApplyDakuten", 0x51A8, { gen: r => ({ de: 0xD020 + r(0x3E0) }), lcd: false }),
  T("TextCmdApplyHandakuten", 0x51C8, { gen: r => ({ de: 0xD020 + r(0x3E0) }), lcd: false }),
  T("TextCmdPrintPlayerName", 0x51E8, { gen: r => ({ de: 0xD020 + r(0x3E0) }), out: ["d", "e", "h", "l"], prep: (mem, s, r) => { writeString(mem, 0xC900, r); flag(mem, F.PROPORTIONAL, r(2)); } }),
  T("TextCmdPrintPartnerName", 0x51F3, { gen: r => ({ de: 0xD020 + r(0x3E0) }), out: ["d", "e", "h", "l"], prep: (mem, s, r) => writeString(mem, 0xC940, r) }),
  T("MeasureNextArgStringWidth", 0x51FE, { out: ["a", "f", "b", "c", "d", "e", "h", "l"], prep: (mem, s, r) => { queues(mem, r); writeString(mem, 0xC900, r); writeString(mem, 0xC940, r); } }),
  T("MeasureMainCharacterNameWidth", 0x5267, { prep: (mem, s, r) => writeString(mem, 0xC900, r) }),
  T("MeasurePartnerCharacterNameWidth", 0x527F, { prep: (mem, s, r) => writeString(mem, 0xC940, r) }),

  // ---- control.js ----
  T("TextCmdNop2", 0x5297),
  T("GetNextArgShortTextLength", 0x5298, { prep: (mem, s, r) => queues(mem, r) }),
  T("TextCmdPrintArgNumber", 0x52CE, { gen: r => ({ de: 0xD020 + r(0x3E0) }), out: ["a", "d", "e"], prep: (mem, s, r) => queues(mem, r) }),
  T("MeasureNextArgNumberWidth", 0x5305, { out: ["a", "b", "c", "d", "e", "h", "l"], prep: (mem, s, r) => queues(mem, r) }),
  T("Unused_05_StubNop_05_2", 0x53AC),
  T("Unused_05_SetTextVar", 0x53AE),
  T("TextCmdPrintShortText", 0x53CA, { gen: r => ({ de: 0xD020 + r(0x3E0) }), out: ["d", "e", "h", "l"], prep: (mem, s, r) => w(mem, 0xC361, r(40)) }),
  T("MeasureIndexedShortTextWidth", 0x53E8, { prep: (mem, s, r) => w(mem, 0xC361, r(256)) }),
  T("WrapTextCellPointer", 0x5413, { gen: r => ({ de: r(0x10000) }) }),
  T("WrapTextCellPointerPrevRow", 0x543D, { gen: r => ({ de: r(0x10000) }) }),
  ...[0x00, 0x01, 0x04, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0D, 0x0E, 0x0F, 0x10, 0x13, 0x14, 0x1D, 0x1E, 0x1F].map(code =>
    T(`DispatchControlCode $${code.toString(16)}`, 0x546C, { gen: r => ({ a: code, de: 0xD020 + r(0x3E0) }), lcd: false, out: ["d", "e", "h", "l"],
      prep: (mem, s, r) => { queues(mem, r); writeString(mem, 0xC900, r); writeString(mem, 0xC940, r); w(mem, 0xC361, r(40)); } })),
  T("ControlCodeHandler16", 0x548A), T("ControlCodeHandler19", 0x548D), T("TextCmdNop0", 0x548E),
  T("RenderInlineString", 0x54CF, { gen: r => ({ hl: 0xC780, de: 0xD020 + r(0x3E0) }), out: ["d", "e", "h", "l"],
    prep: (mem, s, r) => { writeString(mem, 0xC780, r, 1 + r(20)); flag(mem, F.PROPORTIONAL, r(2)); w(mem, 0xD000 + r(0x400), 5); } }),
  T("Unused_05_RenderInlineHexByte", 0x5555, { gen: r => ({ de: 0xD020 + r(0x3E0) }), out: ["d", "e"] }),
  T("Unused_05_RenderInlineHexWord", 0x556A, { gen: r => ({ de: 0xD020 + r(0x3E0) }), out: ["d", "e"] }),
  T("Unused_05_RenderInlineDecimalByte", 0x5580, { gen: r => ({ de: 0xD020 + r(0x3E0) }), out: ["d", "e"] }),
  T("RenderInlineNumber", 0x5597, { gen: r => ({ hl: [r(10), r(100), r(0x10000)][r(3)], de: 0xD020 + r(0x3E0) }), out: ["d", "e"], prep: (mem, s, r) => w(mem, 0xC360, r(2)) }),

  // ---- window_text.js ----
  T("SetWindowTextId", 0x55D5, { gen: r => ({ bc: r(8) << 8, hl: anyTextId(r) }) }),
  T("SetActiveWindowTextId", 0x55E6, { gen: r => ({ hl: anyTextId(r) }) }),
  // (RenderWindowText prints game texts, which wait at $02 / $03: the lockstep checks it)
                                   // (texts wait at $02 / $03: the lockstep checks it)
  T("FitWindowToText", 0x5654, { prep: (mem, s, r) => { queues(mem, r); writePage(mem, r); writeString(mem, 0xC900, r); writeString(mem, 0xC940, r); w5_16(mem, 0xD84E, r(2) ? 0 : 0xC600 + r(16)); } }),
  T("FitWindowToText (no dialogue window)", 0x5654, { prep: (mem, s, r) => { queues(mem, r); writePage(mem, r); w5(mem, 0xD824, 0xFF); w5_16(mem, 0xD84E, 0); } }),
  T("MeasureTextDimensions", 0x5745, { prep: (mem, s, r) => { queues(mem, r); writePage(mem, r); } }),
  T("DelayTextCharacter (fast)", 0x579B),
  ...[0, 1, 2, 0x80, 0x81].map(sp => T(`ApplyMessageSpeed ${sp}`, 0x57E7, { prep: mem => w(mem, 0xC8A4, sp) })),

  // ---- dialogue.js ----
  T("Unused_05_OpenDialogueWindowCentered", 0x5BA0, { gen: r => ({ hl: textId(r), de: r(4) ? (10 + r(12)) << 8 | (4 + r(20)) : cell(r) }), prep: (mem, s, r) => queues(mem, r) }),
  T("MeasureDialogueWidthTiles", 0x5BFC, { gen: r => ({ hl: textId(r) }), prep: (mem, s, r) => queues(mem, r) }),
  T("FetchDialogueText", 0x5C18, { gen: r => ({ hl: textId(r) }) }),
  T("FetchDialogueText (any id)", 0x5C18, { gen: r => ({ hl: r(0x8000) }) }),
  // (de is the SRAM string's index: past the 16 table entries the offsets are code bytes, and the copy's source can be
  // the stack page, which differs)
  T("FetchDialogueText (SRAM)", 0x5C18, { gen: r => ({ hl: 0x8000 | r(0x8000), de: r(16) }), prep: mem => { mem.ramEnable = true; } }),
  T("FetchShortText", 0x5CA8, { gen: r => ({ hl: r(0x10000) }) }),
  T("AddTextIdOffset", 0x5D2B, { gen: r => ({ hl: anyTextId(r), a: r(256) }), out: ["a", "f", "b", "c", "d", "e", "h", "l"] }),
  T("AddTextIdOffset (bank end)", 0x5D2B, { gen: r => { const b = r(13); return { hl: b << 10 | (COUNTS[b] - 1 - r(4)), a: r(8) }; } }),

  // ---- proportional.js ----
  T("RenderProportionalTextAt (LCD off)", 0x5DB3, { gen: r => ({ hl: 0x0137 + r(4), de: 0xD020 + r(0x3E0), bc: 0x1000 | (2 + r(16)) }), lcd: false,
    prep: (mem, s, r) => { flag(mem, F.WIDE, r(2)); w(mem, 0xC3BA, r(0x20)); } }),
  T("RenderProportionalTextAt (menu texts)", 0x5DB3, { gen: r => ({ hl: MENU_TEXTS(r), de: 0xD020 + r(0x3E0), bc: 2 + r(16) }), lcd: false }),
  T("StampGlyphTileAtPen", 0x5F0D),
  // (on menu texts: some dialogue texts hold codes past its 16-entry handler table, which jump into garbage)
  T("RenderTextToBuffer64", 0x5F52, { gen: r => ({ hl: MENU_TEXTS(r), de: 0xC780 + r(0x40), bc: 0x20 + r(0x20) }),
    prep: (mem, s, r) => w16(mem, 0xC3B7, r(0x800)) }),
  ...[0x00, 0x05, 0x17, 0x18, 0x3F, 0xFF].map(a => T(`GetObjectSlotPointer $${a.toString(16)}`, 0x5FF2, { gen: () => ({ a }) })),
  T("WriteStringToWindow", 0x600E, { gen: r => ({ a: r(8), hl: 0xC780, de: winCell(r) }), prep: (mem, s, r) => writeString(mem, 0xC780, r, 1 + r(20)) }),
  T("WriteDialogueToWindow", 0x6055, { gen: r => ({ a: r(8), hl: textId(r), de: winCell(r) }) }),
  T("Unused_05_WriteNumberToWindow", 0x6067, { gen: r => ({ a: r(8), hl: r(0x10000), de: winCell(r) }), prep: (mem, s, r) => queues(mem, r) }),

  // ---- window_redraw.js ----
  T("GetSpeakerVoice", 0x608A, { gen: r => ({ a: [0xFF, r(0x18), r(0x40)][r(3)] }),
    prep: (mem, s, r) => { for (let i = 0; i < 0x18; i++) mem.wram[4][i * 64 + 0x21] = 0x1E + r(0x60); } }),
  T("ResetTextWindowsAndRestoreMap (LCD off)", 0x617A, { lcd: false }),
  T("Unused_05_CreateWindowWithTextId", 0x6181, { gen: r => ({ de: winCell(r), bc: (3 + r(18)) << 8 | (3 + r(6)), hl: anyTextId(r) }) }),
  T("UploadGlyphTilesPartial (LCD off)", 0x622E, { lcd: false, out: NOF }),
  T("RedrawWindowRowsSafe (LCD off)", 0x62BC, { gen: r => ({ a: r(8) }), lcd: false }),
  T("CloseWindowAlt (LCD off)", 0x62D8, { gen: r => ({ a: r(8) }), lcd: false }),
  // (centred where the 20x7 window stays on the map: off its top, the rows run into echo RAM over the stack)
  T("Unused_05_OpenCenteredDialogueWindow", 0x634F, { gen: r => ({ hl: textId(r), de: (10 + r(12)) << 8 | (4 + r(20)) }) }),
  T("Unused_05_ChooseSpeechBubbleHalf", 0x6388, { gen: r => ({ a: [r(0x18), 0x80 | r(0x80)][r(2)] }), prep: (mem, s, r) => w16(mem, 0xC322, r(0x10000)) }),
  T("DebugToggleSelectedFlag", 0x63D8, { prep: (mem, s, r) => { w(mem, 0xC714, r(4)); w(mem, 0xC715, r(8)); w(mem, 0xC716, r(8)); } }),
  T("DebugDrawFlagsWindow1", 0x6407, { prep: (mem, s, r) => { w(mem, 0xC714, r(4)); w(mem, 0xC718, r(7)); } }),
  T("DebugDrawFlagsWindow2", 0x6447, { prep: (mem, s, r) => { w(mem, 0xC714, r(4)); w(mem, 0xC719, r(7)); } }),

  // ---- debug_flags.js ----
  T("DebugDrawHexRowLabel", 0x6498, { gen: r => ({ bc: r(7) << 8, de: winCell(r) }) }),
  T("DebugDrawFlagBitRow", 0x64BA, { gen: r => ({ bc: r(7) << 8, de: winCell(r) }) }),
  T("DebugDrawFlagCursor", 0x64E3, { prep: (mem, s, r) => { w(mem, 0xC715, r(8)); w(mem, 0xC716, r(8)); w(mem, 0xC718, r(7)); w(mem, 0xC719, r(7)); } }),
  T("DebugEraseFlagCursor", 0x6514, { prep: (mem, s, r) => { w(mem, 0xC715, r(8)); w(mem, 0xC716, r(8)); } }),
  T("DebugMoveFlagCursor", 0x6546, { prep: (mem, s, r) => { w(mem, 0xC715, r(8)); w(mem, 0xC716, r(8)); mem.hram[0x10] = 0x10 << r(4); } }),
  T("StubNop_05_3", 0x6581),
  T("DebugDrawWarpMenu (LCD off)", 0x672D, { lcd: false, prep: (mem, s, r) => { w(mem, 0xC701, r(7)); w(mem, 0xC700, r(0x30)); w(mem, 0xC704, r(16)); w(mem, 0xC703, r(2)); } }),
  T("DebugStepValueWithDpad", 0x6862, { gen: r => ({ a: r(256), de: (1 + r(40)) << 8 }), out: ["a", "b", "c", "d", "e", "h", "l"],
    prep: (mem, s, r) => { mem.hram[0x11] = [0, 0x10, 0x20, 0x30][r(4)]; } }),

  // ---- debug_palette.js ----
  T("GetSelectedBGPaletteColorPtr", 0x6950, { prep: (mem, s, r) => { w(mem, 0xC712, r(4)); w(mem, 0xC713, r(16)); } }),
  T("DebugDrawColorComponents (LCD off)", 0x6964, { gen: r => ({ de: r(3) }), lcd: false, prep: (mem, s, r) => { w(mem, 0xC712, r(4)); w(mem, 0xC713, r(8)); w(mem, 0xC711, r(7)); } }),
  T("DrawPaletteCursorSprites", 0x6B03, { out: [], prep: (mem, s, r) => { w(mem, 0xC712, r(4)); w(mem, 0xC713, r(16)); mem.hram[0x5D] = r(0x60); } }),
  T("Unused_05_WriteStringToTilemap", 0x6B82, { gen: r => ({ hl: 0xC780, de: 0xD020 + r(0x3E0) }), prep: (mem, s, r) => writeString(mem, 0xC780, r, 1 + r(40)) }),
  T("Unused_05_WriteStringToTilemapAlt", 0x6BB9, { gen: r => ({ hl: 0xC780, de: 0xD020 + r(0x3E0) }), prep: (mem, s, r) => writeString(mem, 0xC780, r, 1 + r(40)) }),
  T("Unused_05_WriteStringToTilemapStreamed", 0x6BF0, { gen: r => ({ hl: 0xC780, de: 0xD020 + r(0x1E0) }), out: ["c", "d", "e", "h", "l"],
    prep: (mem, s, r) => { writeString(mem, 0xC780, r, 1 + r(30)); for (let i = 0; i < 3; i++) w(mem, 0xC780 + r(30), [1, 2, 3][r(3)]); } }),

  // ---- window_alloc.js ----
  T("FetchSRAMDialogueText", 0x6D2B, { gen: r => ({ de: r(16) }), prep: mem => { mem.ramEnable = true; } }),
  T("Unused_05_FetchSRAMShortText", 0x6D33, { gen: r => ({ de: r(16) }), prep: mem => { mem.ramEnable = true; } }),
  T("FetchSRAMText", 0x6D3B, { gen: r => ({ de: r(16), a: r(2) }), prep: mem => { mem.ramEnable = true; } }),
  T("ResetTextWindowState", 0x6E09),
  T("CreateWindowFromScreenRect", 0x6E45, { gen: r => ({ de: winCell(r), bc: (3 + r(18)) << 8 | (3 + r(6)) }), prep: (mem, s, r) => w5(mem, 0xDC70, r(4) ? r(128) : 0x7F) }),
  T("AllocWindowStruct", 0x6E6D, { gen: r => ({ de: r(0x10000), bc: r(0x10000) }), prep: (mem, s, r) => w5(mem, 0xDC70, r(4) ? r(128) : 0x7F) }),
  T("AllocWindowId", 0x6E96, { prep: (mem, s, r) => w5(mem, 0xDC70, [r(256), 0x7F, 0xFF, 0][r(4)]) }),
  T("FreeWindow", 0x6EBA, { gen: r => ({ a: [r(8), r(256), 0xFF][r(3)] }), prep: (mem, s, r) => w5(mem, 0xDC70, r(256)) }),
  T("GetWindowStructPtr", 0x6EEA),
  T("SaveWindowStruct", 0x6EFA), T("RestoreWindowStruct", 0x6F11),
  T("WrapCellPtrToRowStart", 0x6F2A, { gen: r => ({ hl: r(0x10000) }) }),
  T("ClampCellPtrToShadowMap", 0x6F38, { gen: r => ({ hl: 0xD000 + r(0x800) }) }),
  T("ClampCellPtrToAttrMap", 0x6F54, { gen: r => ({ hl: 0xD000 + r(0x1000) }) }),
  T("DrawTextWindowFrame", 0x6F70, { gen: r => ({ a: r(8) }), prep: (mem, s, r) => flag(mem, F.RENDER_ACTIVE, r(2)) }),
  T("DrawTextWindowFrame (hidden)", 0x6F70, { gen: r => ({ a: r(8) }), prep: (mem, s, r) => { for (let i = 0; i < 8; i++) w5(mem, 0xDC04 + i * 8, 0xFF); } }),
  T("DrawTextWindowFrame (edges)", 0x6F70, { gen: r => ({ a: r(8) }), prep: (mem, s, r) => {
    for (let i = 0; i < 8; i++) {                            // one edge size at a time (both at once runs 255 x 255 cells)
      const edgeW = r(2), wd = edgeW ? [1, 2, 31, 32, 33][r(5)] : 3 + r(18), ht = edgeW ? 3 + r(8) : [1, 2, 31][r(3)];
      [r(32), r(32), wd, ht, 0].forEach((v, k) => w5(mem, 0xDC00 + i * 8 + k, v));
    } } }),

  // ---- rows.js ----
  T("MarkTilemapRowsDirty", 0x7086, { gen: r => ({ de: r(0x10000) }) }),
  T("MarkWindowRowsDirty", 0x7096, { gen: r => ({ a: r(8) }) }),
  T("SetRowDirtyFlags", 0x70AA, { gen: r => ({ de: r(0x10000) }) }),
  T("MarkWindowRowsDirtyMin7", 0x70D1, { gen: r => ({ a: r(8) }) }),
  T("FlushDirtyRowsPerFrame (LCD off)", 0x711A, { lcd: false, prep: (mem, s, r) => { for (let i = 0; i < 32; i++) w5(mem, 0xDC40 + i, r(3) ? 0 : 1); } }),
  T("FlushDirtyRowsNow (LCD off)", 0x7148, { lcd: false, prep: (mem, s, r) => { for (let i = 0; i < 32; i++) w5(mem, 0xDC40 + i, r(2)); } }),
  T("CopyDirtyRowSpanToVRAM", 0x7176, { gen: r => ({ bc: (1 + r(7)) << 8 | r(32) }) }),
  T("BuildDirtyRowRuns", 0x71C4, { prep: (mem, s, r) => { for (let i = 0; i < 32; i++) w5(mem, 0xDC40 + i, r(3) ? r(2) : 1); } }),
  T("RedrawWindowRows (LCD off)", 0x7205, { gen: r => ({ a: r(8) }), lcd: false }),
  T("RedrawWindowRowsPadded (LCD off)", 0x7214, { gen: r => ({ a: r(8) }), lcd: false }),
  T("RedrawTilemapRowRange (LCD off)", 0x7223, { gen: r => ({ de: r(0x10000) }), lcd: false }),
  // (a menu window low on the map: its text rows would run past $DFFF into echo RAM over the stack)
  T("RenderMenuWindowText (LCD off)", 0x7232, { lcd: false, prep: (mem, s, r) => { const id = r(7); w5(mem, 0xD82F, id); w5(mem, 0xDC01 + id * 8, r(12)); w5_16(mem, 0xDC06 + id * 8, [0x001A, 0x0132, 0x0133, 0x0137][r(4)]); } }),
  T("CloseWindow (LCD off)", 0x72BD, { gen: r => ({ a: r(8) }), lcd: false }),
  T("RedrawAllTilemapRows (LCD off)", 0x72D2, { lcd: false }),
  T("PrepareGlyphBuffer", 0x72DC),
  T("ResetGlyphStream", 0x730D),
  T("DrawGlyph", 0x7322, { gen: r => ({ a: r(4) ? 0x20 + r(0x5B) : r(256), de: r(0x1000) }), wram: 7 }),
  T("GetGlyphWidth", 0x7366, { gen: r => ({ a: r(256) }) }),
  T("GetGlyphWidthByIndex", 0x7370, { gen: r => ({ a: r(256) }) }),

  // ---- glyph_buffer.js ----
  T("PlotGlyphRow", 0x737A, { gen: r => ({ a: r(256), de: r(0x10000) }), wram: 7 }),
  T("ClearGlyphBuffer", 0x73CB, { wram: 7 }),
  T("ClearWindowGlyphTiles", 0x73E4),
  T("UploadGlyphBufferFull (LCD off)", 0x742C, { lcd: false, prep: (mem, s, r) => flag(mem, F.SHORT_UPLOAD, r(2)) }),
  T("Unused_05_DrawWindowGlyphRun", 0x74DE, { gen: () => ({ hl: 0xC600 }), prep: (mem, s, r) => { writePage(mem, r); w(mem, 0xC600 + r(0x40), 0x02); } }),
  T("InitGlyphStreamForWindow", 0x752D),
  T("DrawStreamGlyph", 0x757E, { prep: (mem, s, r) => { writePage(mem, r); w5_16(mem, 0xD869, 0xC600 + r(8)); } }),
  T("StartGlyphStreamRow", 0x75DB),
  T("UploadLastGlyphTiles", 0x7607, { prep: (mem, s, r) => { if (r(2)) { w5(mem, 0xD821, r5(mem, 0xD820)); w5(mem, 0xD824, r5(mem, 0xD820)); } } }),

  // ---- glyph_font.js ----
  T("DrawInlineGlyph", 0x7681, { gen: () => ({ hl: 0xC780 }), prep: (mem, s, r) => w(mem, 0xC780, [0x01, 0x02, 0x03, 0x20 + r(0x5B)][r(4)]) }),
  T("Unused_05_ResetGlyphPen_1", 0x76D1), T("Unused_05_ResetGlyphPen_2", 0x76F5),
  T("InitGlyphStreamAt", 0x771B, { gen: r => ({ bc: r(0x20) }), prep: (mem, s, r) => flag(mem, F.WIDE, r(2)) }),
  T("SaveGlyphPenColumns", 0x7774),
  T("UploadGlyphBuffer (LCD off)", 0x7792, { lcd: false }),
  T("FlushGlyphRow (LCD off)", 0x77A3, { lcd: false, out: NOF }),
  T("UploadGlyphBufferDMA", 0x7866, { lcd: false }),
  T("Unused_05_UploadGlyphTileRange", 0x78AD, { out: ["a", "b", "c", "d", "e", "h", "l"], prep: (mem, s, r) => { w(mem, 0xC3BD, r(0x30)); w(mem, 0xC3BE, r(0x80)); w(mem, 0xC3BF, r(2)); } }),
  T("Unused_05_DrawGlyphString", 0x78F3, { gen: r => ({ hl: 0xC780, de: r(0x10000) }), wram: 7, prep: (mem, s, r) => writeString(mem, 0xC780, r, 1 + r(12)) }),
];
