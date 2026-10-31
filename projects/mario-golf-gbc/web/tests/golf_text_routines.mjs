// The text routines (web/js/golf/text.js: the glyph renderer of bank 03, the text printer of bank 05) against the
// ROM's on the emulator core's interpreter: the same random RAM, VRAM and registers in; all WRAM banks (but the
// call's stack: from the lowest sp it reached), HRAM, VRAM and the returned registers compared after each call.
// usage: node web/tests/golf_text_routines.mjs [N per routine] [name filter]
import { useRom, rw } from "../js/golf/rom.js";
import { GolfMemory } from "../js/golf/memory.js";
import { initDisplay } from "../js/golf/render/display.js";
import * as T from "../js/golf/text.js";
import * as W from "../js/golf/windows.js";
import * as MB from "../js/golf/msgbox.js";
import * as PA from "../js/golf/pause.js";
import * as B31 from "../js/golf/maps/bank31.js";
import * as BOOT from "../js/golf/boot.js";
import * as DBG from "../js/golf/debug.js";
import { newCore, romCall, romBytes } from "./golf/romcall.mjs";

useRom(romBytes());
const N = +(process.argv[2] || 300), filter = process.argv[3] || "";

let seed = 0x13579bdf;
const rnd = n => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
const pick = a => a[rnd(a.length)];

// text ids: every string of banks 18-1F, half of them chosen from those with control codes or dakuten
const SIZES = [512, 216, 252, 285, 264, 497, 768, 169];
const ids = [], codeIds = [];
{
  const rom = romBytes();
  for (let k = 0; k < 8; k++) {
    const bank = 0x18 + k, copy = rw(bank, 0x4002) + 8;
    const offs = rw(bank, copy + 4), strs = rw(bank, copy + 0x0F);
    for (let i = 0; i < SIZES[k]; i++) {
      const id = k << 10 | i;
      ids.push(id);
      let p = bank * 0x4000 + (strs + rw(bank, offs + 2 * i)) - 0x4000;
      for (let n = 0; n < 0x180 && rom[p]; n++, p++) {
        const c = rom[p];
        if ([4, 7, 8, 9, 0x0B, 0x0E, 0xDE, 0xDF].includes(c)) { codeIds.push(id); break; }
        if (c === 1 || c === 3) break;
      }
    }
  }
}

function randomState() {
  const w = initDisplay(new GolfMemory());
  for (let i = 0; i < 8; i++) for (let k = 0; k < 0x1000; k++) w.wram[i][k] = rnd(256);
  for (let k = 0; k < 0x200; k++) w.high[k] = rnd(256);
  for (let b = 0; b < 2; b++) for (let k = 0; k < 0x2000; k++) w.vram[b][k] = rnd(256);
  const w0 = w.wram[0], w5 = w.wram[5];
  w.lcd.lcdc = 0x00; w.lcd.vbk = rnd(2);
  w.high[0x196] = pick([1, 2, 3, 4, 5, 5, 6, 7, 0]);       // hWRAMBank
  w.high[0x199] = 0;
  w0.fill(0, 0x0A0, 0x0F0);                      // the VRAM copy queue: free (some entries used)
  for (let k = 0; k < rnd(12); k++) w0[0x0A0 + 8 * rnd(10)] = 1 + rnd(255);
  const tile = rnd(0x80);
  w0[0x36E] = tile; w0[0x36F] = rnd(2) ? tile : rnd(tile + 1);
  const pen = (rnd(4) ? tile : rnd(0x80)) << 7 | rnd(0x80);
  w0[0x36A] = pen & 0xFF; w0[0x36B] = pen >> 8;
  w0[0x36C] = 1 + rnd(20); w0[0x36D] = rnd(0x80);
  w0[0x82D] = pick([0, 1, 2, 0x80, 0x81, rnd(256)]);   // wTextSpeed
  w0[0x96D] = rnd(3) ? 0 : 1;                    // wReplayActive
  w0[0x360] = rnd(2) ? 0 : rnd(256);             // wPrintNoPad
  for (let b = 1; b < 8; b++) {                  // window state in every bank (some codes read the mapped one)
    const r = w.wram[b];
    for (let s = 0; s < 6; s++) { const p = 0xD900 + 0x11D * rnd(7); r[0x800 + 4 * s] = p & 0xFF; r[0x801 + 4 * s] = p >> 8; }
    r[0x821] = rnd(6); r[0x820] = rnd(2) ? r[0x821] : rnd(6); r[0x824] = rnd(2) ? r[0x820] : rnd(6);
    r[0x829] = 0;                                // no typing delay (the frames are not run here)
    r[0x84A] = rnd(17); r[0x84B] = rnd(17); r[0x84C] = rnd(17);
    for (let k = 0; k < 16; k++) {               // string arguments: WRAM0, or WRAM 1-7 by the high nibble
      const bank = rnd(8), lo = rnd(256), hi = bank ? (bank << 4) | rnd(14) : 0xC0 | (2 + rnd(12));
      r[0xFAE + 2 * k] = lo; r[0xFAF + 2 * k] = rnd(10) ? hi : 0;
      r[0xFEE + k] = rnd(0x400) & 0xFF;          // short text indices
    }
    r[0x85D] = rnd(16);
  }
  for (let s = 0; s < 7; s++) {                  // window records: sane sizes
    const p = 0x900 + 0x11D * s;
    w5[p + 3] = 3 + rnd(18); w5[p + 4] = 3 + rnd(16);
  }
  w0[0x361] = rnd(0x40);
  for (let k = 0; k < 0x20; k++) w0[0x800 + k] = k < 3 + rnd(8) ? 0x41 + rnd(26) : 0;   // the player's name
  return w;
}

function loadCoreFull(gb, w) {
  for (let i = 0; i < 8; i++) gb.mem.wram[i].set(w.wram[i]);
  gb.mem.hram.set(w.high.subarray(0x180, 0x1FF));
  gb.mem.svbk = (w.high[0x196] & 7) || 1;
  gb.mem.vram[0].set(w.vram[0]); gb.mem.vram[1].set(w.vram[1]);
  gb.mem.vbk = w.lcd.vbk; gb.ppu.lcdc = w.lcd.lcdc;
}

// (frames stubbed: each frame sets the joypad from the case's script on both sides, [held, repeat, pressed], the script
// repeated; the sounds are recorded, compared as lists)
const sh = w => ({ w, sound(id) { if (w.jsSounds) w.jsSounds.push(id); }, *advance(n = 1) {
  for (let k = 0; k < n; k++) {
    if (!w.framesStubbed) throw new Error("a frame");
    if (++w.framesRun > 20000) throw new Error("frames run out");
    if (w.joy) { const j = w.joy[(w.framesRun - 1) % w.joy.length]; w.high[0x190] = j[0]; w.high[0x191] = j[1]; w.high[0x194] = j[2]; }
  }
} });
const run = g => { for (let r = g.next(); ; r = g.next()) if (r.done) return r.value; };
const buf = () => pick([0xC200 + rnd(0xA00), 0xD000 + rnd(0xD00)]);

// [name, bank, addr, regs(w), js(w, regs) -> {reg: value}]
const CASES = [
  ["DrawGlyph", 3, 0x4B45, w => ({ a: 0x20 + rnd(0x66), de: (w.wram[0][0x36A] | w.wram[0][0x36B] << 8) }), (w, r) => ({ de: T.drawGlyph(w, r.a, r.de) })],
  ["GetCharWidth", 3, 0x4B89, () => ({ a: rnd(256) }), (w, r) => ({ c: T.getCharWidth(r.a) })],
  ["BlitGlyphByte", 3, 0x4B9D, () => ({ a: rnd(256), de: rnd(0x4000) }), (w, r) => { T.blitGlyphByte(w, r.a, r.de); return {}; }],
  ["ClearGlyphBuffer", 3, 0x4BFE, () => ({}), w => { T.clearGlyphBuffer(w); return {}; }],
  ["ClearWindowGlyphs", 3, 0x4C17, () => ({}), w => { T.clearWindowGlyphs(w); return {}; }],
  ["InitTextPen", 3, 0x4D41, () => ({}), w => { T.initTextPen(w); return {}; }],
  ["DrawNextChar", 3, 0x4D93, w => { const r = w.wram[5], p = 0xD000 + rnd(0x700); r[0x869] = p & 0xFF; r[0x86A] = p >> 8; if (rnd(3) === 0) r[p - 0xD000] = pick([1, 2, 3]); return {}; }, w => { T.drawNextChar(w); return {}; }],
  ["UploadCurrentCharTiles", 3, 0x4DF0, () => ({}), w => { T.uploadCurrentCharTiles(w); return {}; }],
  ["DrawCharFromHL", 3, 0x4E6A, w => { const hl = buf(); if (rnd(3) === 0) w.wram[0][(hl & 0xFFF)] = pick([1, 2, 3]); return { hl }; }, (w, r) => { T.drawCharFromHL(w, r.hl); return {}; }],
  ["ResetGlyphBuffer", 3, 0x4EB8, () => ({}), w => { T.resetGlyphBuffer(w); return {}; }],
  ["ResetGlyphBufferDup", 3, 0x4EDC, () => ({}), w => { T.resetGlyphBuffer(w); return {}; }],
  ["SetTextLineLength", 3, 0x4F02, () => ({ c: rnd(256) }), (w, r) => { T.setTextLineLength(w, r.c); return {}; }],
  ["WriteGlyphTileNumbers", 3, 0x4F21, () => ({ de: buf() }), (w, r) => { T.writeGlyphTileNumbers(w, r.de); return {}; }],
  ["CommitGlyphBlock", 3, 0x4F58, () => ({}), w => { T.commitGlyphBlock(w); return {}; }],
  ["UploadGlyphTilesDirect", 3, 0x5039, () => ({}), w => { T.uploadGlyphTilesDirect(w); return {}; }],
  ["UploadGlyphRange", 3, 0x5087, () => ({}), w => ({ a: T.uploadGlyphRange(w) })],
  ["DrawStringToGlyphs", 3, 0x50CD, w => { const hl = 0xC200 + rnd(0xA00); const n = rnd(20); const m = w.wram[0]; for (let k = 0; k < 24; k++) m[(hl + k) & 0xFFF] = k < n ? 0x20 + rnd(0x5B) : 0; return { hl, de: rnd(0x10000) & 0xF07F }; }, (w, r) => { T.drawStringToGlyphs(w, r.hl, r.de); return {}; }],
  ["LoadText", 5, 0x6179, () => ({ hl: pick(ids) | rnd(8) << 13 }), (w, r) => { T.loadText(w, r.hl); return {}; }],
  ["LoadTextShort", 5, 0x61D4, () => ({ hl: pick(ids) }), (w, r) => { T.loadTextShort(w, r.hl); return {}; }],
  ["CopyTextShortToDE", 5, 0x40C2, () => ({ hl: pick(ids), de: buf() }), (w, r) => { T.copyTextShortToDE(w, r.hl, r.de); return {}; }],
  ["NormalizeTextId", 5, 0x622F, () => ({ hl: rnd(0x10000), a: rnd(256) }), (w, r) => ({ hl: T.normalizeTextId(r.hl, r.a) })],
  ["PrintTextToBuffer", 5, 0x62AA, () => ({ hl: rnd(2) ? pick(codeIds) : pick(ids), de: buf(), c: 1 + rnd(0x40) }), (w, r) => { run(T.printTextToBuffer(sh(w), r.hl, r.de, r.c)); return {}; }],
  ["PrintDecWordInline", 5, 0x5A13, () => ({ hl: rnd(2) ? rnd(0x10000) : rnd(1000), de: buf() }), (w, r) => ({ de: run(T.printDecWordInline(sh(w), r.hl, r.de)) })],
  ["PrintHexByteInline", 5, 0x59D1, () => ({ a: rnd(256), de: buf() }), (w, r) => ({ de: run(T.printHexByteInline(sh(w), r.a, r.de)) })],
  ["PrintHexWordInline", 5, 0x59E6, () => ({ hl: rnd(0x10000), de: buf() }), (w, r) => ({ de: run(T.printHexWordInline(sh(w), r.hl, r.de)) })],
  ["PrintDecByteInline", 5, 0x59FC, () => ({ a: rnd(256), de: buf() }), (w, r) => ({ de: run(T.printDecByteInline(sh(w), r.a, r.de)) })],
  ["PushTextStringArg", 5, 0x54CF, () => ({ hl: rnd(0x10000) }), (w, r) => { T.pushTextStringArg(w, r.hl); return {}; }],
  ["PushTextNumberArg", 5, 0x551F, () => ({ hl: rnd(0x10000) }), (w, r) => { T.pushTextNumberArg(w, r.hl); return {}; }],
  ["PushTextByteArg", 5, 0x5552, () => ({ a: rnd(256) }), (w, r) => { T.pushTextByteArg(w, r.a); return {}; }],
  ["SetTextCourseIndex", 5, 0x57C3, () => ({ a: rnd(256) }), (w, r) => { T.setTextCourseIndex(w, r.a); return {}; }],
];
for (const [code, name] of [[4, "TextCmdStringArg"], [7, "TextCmdPlayerName"], [8, "TextCmdByteArg"], [9, "TextCmdNumberArg"], [0x0B, "TextCmdCourseName"], [0x0E, "TextCmdCharName"], [0x0F, "TextCmdPlacing"]]) {
  CASES.push([name, 5, 0x58E2, w => { for (const b of [1, 2, 3, 4, 5, 6, 7]) { w.wram[b][0x847] = rnd(17); w.wram[b][0x848] = rnd(17); w.wram[b][0x849] = rnd(17); } return { a: code, de: buf() }; },
    (w, r) => ({ de: run(T.textControlDispatch(sh(w), r.a, r.de)) })]);
}

// the window buffers' text helpers (windows.js, 05:648E-05:6672), their frames stubbed (opts.frames: AdvanceFrame
// 00:2E3B returns at once on both sides): [$D860] a buffer 0-6
const wb = w => { w.wram[5][0x860] = rnd(7); };
const cellRegs = () => ({ d: rnd(32), e: 1 + rnd(30) });
const slotRegs = w => {                          // (a slot's record in $D900-$DAFF of a sane size, in every bank: the
  const a = rnd(6), p = 0x800 + 4 * a, hi = 0xD9 + rnd(2), x = 3 + rnd(18), y = 3 + rnd(16);   // routine reads the
  for (let b = 1; b < 8; b++) { const r = w.wram[b]; r[p] = 0x00; r[p + 1] = hi; r[(hi << 8) - 0xD000 + 3] = x; r[(hi << 8) - 0xD000 + 4] = y; }
  return a;                                      // slots in the bank mapped)
};
CASES.push(["PrintTextToShadow", 5, 0x648E, () => ({ hl: rnd(2) ? pick(codeIds) : pick(ids), ...cellRegs() }), (w, r) => { run(W.printTextToShadow(sh(w), r.hl, r.d, r.e)); return {}; }, { frames: true }]);
CASES.push(["PrintTextToShadowNow", 5, 0x64B8, () => ({ hl: pick(ids), ...cellRegs() }), (w, r) => { run(W.printTextToShadowNow(sh(w), r.hl, r.d, r.e)); return {}; }, { frames: true }]);
CASES.push(["CopyShadowToVRAMFramed", 5, 0x64D1, () => ({}), w => { run(W.copyShadowToVRAMFramed(sh(w))); return {}; }, { frames: true }]);
CASES.push(["DrawWindowBuffer", 5, 0x6510, w => { wb(w); return {}; }, w => { run(W.drawWindowBuffer(sh(w))); return {}; }, { frames: true }]);
CASES.push(["PrintTextInWindowBuffer", 5, 0x652F, w => { wb(w); return { hl: pick(ids), d: rnd(8), e: rnd(8) }; }, (w, r) => { run(W.printTextInWindowBuffer(sh(w), r.hl, r.d, r.e)); return {}; }, { frames: true }]);
CASES.push(["PrintTextInWindowBufferNow", 5, 0x6597, w => { wb(w); return { hl: pick(ids), d: rnd(8), e: rnd(8) }; }, (w, r) => { run(W.printTextInWindowBuffer(sh(w), r.hl, r.d, r.e, true)); return {}; }, { frames: true }]);
CASES.push(["PrintNumberInWindowBuffer", 5, 0x6564, w => { wb(w); return { hl: rnd(0x10000), d: rnd(8), e: rnd(8) }; }, (w, r) => { run(W.printNumberInWindowBuffer(sh(w), r.hl, r.d, r.e)); return {}; }, { frames: true }]);
CASES.push(["PrintNumberInWindowBufferNow", 5, 0x65CC, w => { wb(w); return { hl: rnd(0x10000), d: rnd(8), e: rnd(8) }; }, (w, r) => { run(W.printNumberInWindowBuffer(sh(w), r.hl, r.d, r.e, true)); return {}; }, { frames: true }]);
CASES.push(["PrintStringInWindowBuffer", 5, 0x6589, w => { wb(w); return { hl: buf(), d: rnd(8), e: rnd(8) }; }, (w, r) => { run(W.printStringInWindowBuffer(sh(w), r.hl, r.d, r.e)); return {}; }, { frames: true }]);
CASES.push(["PrintStringInWindowBufferNow", 5, 0x65F1, w => { wb(w); return { hl: buf(), d: rnd(8), e: rnd(8) }; }, (w, r) => { run(W.printStringInWindowBuffer(sh(w), r.hl, r.d, r.e, true)); return {}; }, { frames: true }]);
// the message box's other entries (msgbox.js), the frames stubbed; no message window open ($D824 $FF) or one
const pageJoy = () => [[0, 0, 0], [0, 0, 0], [1, 1, 1]];   // (A every third frame: the pages go on)
// (the window system as the game keeps it between messages: no window open, no page pending, no menu)
const noMsg = w => {
  const r = w.wram[5];
  for (let k = 0; k < 6; k++) { r[0x800 + 4 * k] = 0; r[0x801 + 4 * k] = 0; r[0x802 + 4 * k] = 0; r[0x803 + 4 * k] = 0; }
  r[0x822] = 0; r[0x823] = 0; r[0x824] = 0xFF; r[0x82F] = 0xFF; r[0x83E] = 0xFF; r[0x850] = 0; r[0x84F] = 0;
};
CASES.push(["ContinueMessageAt", 5, 0x5F02, w => { noMsg(w); return { hl: pick(ids), d: 10 + rnd(10), e: 9 + rnd(12) }; }, (w, r) => { run(MB.continueMessageAt(sh(w), r.hl, r.d, r.e)); return {}; }, { frames: true, joy: pageJoy }]);
CASES.push(["ResizeMessageBox", 5, 0x60C3, w => { const r = w.wram[5]; r[0x84F] = 0;   // (no resume pointer: the text buffer measured)
 for (const a of [0x856, 0x858]) { const p = 0xD900 + 0x11D * rnd(7); r[a] = p & 0xFF; r[a + 1] = p >> 8; } r[0x850] = rnd(2); return { hl: pick(ids) }; },
  (w, r) => { MB.resizeMessageBox(w, r.hl); return {}; }]);
CASES.push(["OpenWindowWithText", 5, 0x6708, () => ({ hl: rnd(0x10000), d: rnd(12), e: rnd(10), b: 3 + rnd(10), c: 3 + rnd(8) }), (w, r) => ({ a: run(MB.openWindowWithText(sh(w), r.hl, r.d, r.e, r.b, r.c)) }), { frames: true }]);
CASES.push(["ShowMessageInPlace", 5, 0x67C5, w => { noMsg(w); return { hl: pick(ids), d: 10 + rnd(10), e: 9 + rnd(12) }; }, (w, r) => { run(MB.showMessageInPlace(sh(w), r.hl, r.d, r.e)); return {}; }, { frames: true, joy: pageJoy }]);
CASES.push(["OpenPromptWindow", 5, 0x45DC, () => ({ hl: pick(ids), d: rnd(12), e: rnd(10), b: 3 + rnd(10), c: 3 + rnd(8) }), (w, r) => { run(MB.openPromptWindow(sh(w), r.hl, r.d, r.e, r.b, r.c)); return {}; }, { frames: true }]);
// (a few moves, then A or B, each after a frame with nothing held, over and over: the menu's wait for the buttons to be
// let go ends wherever it starts in the script)
const menuJoy = () => { const j = []; for (let n = rnd(4); n; n--) { const b = [0x40, 0x80][rnd(2)]; j.push([0, 0, 0], [b, b, b]); } const b = [1, 2][rnd(2)]; j.push([0, 0, 0], [b, b, b]); return j; };
CASES.push(["RunYesNoMenu", 5, 0x45F6, w => { noMsg(w); return { d: rnd(12), e: rnd(10) }; }, (w, r) => ({ a: run(MB.runYesNoMenu(sh(w), r.d, r.e)) }), { frames: true, joy: menuJoy }]);
CASES.push(["ShowNextScriptText", 0x41, 0x42D9, w => { noMsg(w); const id = pick(ids); w.wram[5][0x852] = id & 0xFF; w.wram[5][0x853] = id >> 8; return { a: rnd(2) ? 0x80 | rnd(0x80) : rnd(0x18) }; },
  (w, r) => { run(MB.showNextScriptText(sh(w), r.a)); return {}; }, { frames: true, joy: pageJoy }]);
// 41:6FC4 CharStartMenu: the menu opened and B (or Start) after a few moves: wMenuResult $FF (the items' screens are the
// start menu's, checked there)
const cancelJoy = () => { const j = []; for (let n = rnd(4); n; n--) { const b = [0x40, 0x80][rnd(2)]; j.push([0, 0, 0], [b, b, b]); } const b = [2, 8][rnd(2)]; j.push([0, 0, 0], [b, b, b]); return j; };
CASES.push(["CharStartMenu", 0x41, 0x6FC4, w => { noMsg(w); return {}; }, w => ({ a: run(PA.charStartMenu(sh(w))) }), { frames: true, joy: cancelJoy }]);
// the three unreferenced lesson placeholders of bank 31 (maps/bank31.js), the same bytes at 31:53F6 / 31:5D12 / 31:65A0
for (const [name, addr] of [["Map0FUnusedLessonPlaceholder", 0x53F6], ["Map12UnusedLessonPlaceholder", 0x5D12], ["Map15UnusedLessonPlaceholder", 0x65A0]])
  CASES.push([name, 0x31, addr, w => { noMsg(w); w.wram[0][0x96D] = 1; return {}; }, w => { run(B31.unusedLessonPlaceholder(sh(w))); return {}; }, { frames: true, joy: pageJoy }]);   // ($C96D set: the actor wait 0A:48AC, checked in the screen cases, skipped)
// 01:5278 CGBRequiredScreen (boot.js) with its endless AdvanceFrame loop patched to return after one (01:52B7 jr ->
// ret: opts.patch on the core's ROM), the frames stubbed: VRAM, WRAM (the LZ buffer) compared
CASES.push(["CGBRequiredScreen", 0x01, 0x5278, () => ({}), w => { run(BOOT.cgbRequiredScreen(sh(w), 1)); return {}; }, { frames: true, patch: { "01:52b7": [0xC9, 0x00] } }]);
// 0B:4534 DebugMapGfxQuickMenu (debug.js): moves and B: nothing loaded (a pick loads the map graphics, 0B:44C4: the
// debug viewer's, checked in boot_kid_debug_mapgfx)
CASES.push(["DebugMapGfxQuickMenu", 0x0B, 0x4534, w => { noMsg(w); return {}; }, w => { run(DBG.debugMapGfxQuickMenu(sh(w))); return {}; }, { frames: true, joy: () => [[0, 0, 0], [0x80, 0x80, 0x80], [0, 0, 0], [2, 2, 2]] }]);
// 31:4A4E Map0CUnusedShotTermsTip (maps/bank31.js): the pages by A, Yes (A) or No (B, after its pages by A); flag #22
// (the scripts' text skipping) clear, as in play
CASES.push(["Map0CUnusedShotTermsTip", 0x31, 0x4A4E, w => { noMsg(w); w.wram[0][0x96D] = 1; w.wram[0][0x840 + (22 >> 3)] &= ~(0x80 >> (22 & 7)); return {}; },
  w => { run(B31.map0CUnusedShotTermsTip(sh(w))); return {}; },
  { frames: true, joy: () => (rnd(2) ? pageJoy() : [[0, 0, 0], [0, 0, 0], [1, 1, 1], [0, 0, 0], [2, 2, 2]]) }]);
CASES.push(["DrawTextToWindow", 5, 0x6646, w => ({ a: slotRegs(w), hl: pick(ids), d: rnd(6), e: rnd(6) }), (w, r) => { W.drawTextToWindow(w, r.a, r.hl, r.d, r.e); return {}; }]);
CASES.push(["DrawNumberToWindow", 5, 0x6658, w => ({ a: slotRegs(w), hl: rnd(0x10000), d: rnd(6), e: rnd(6) }), (w, r) => { W.drawNumberToWindow(w, r.a, r.hl, r.d, r.e); return {}; }]);

// the codes $10-$13 (05:5900 05:590B 05:5916 05:5921 TextCmdTile0A-0D: the tile at the pen, the rows flushed, the delay)
// with the current window not the message window (no flush: its frame is not run here)
for (const [code, name] of [[0x10, "TextCmdTile0A"], [0x11, "TextCmdTile0B"], [0x12, "TextCmdTile0C"], [0x13, "TextCmdTile0D"]]) {
  CASES.push([name, 5, 0x58E2, w => { for (const b of [1, 2, 3, 4, 5, 6, 7]) w.wram[b][0x824] = (w.wram[b][0x821] + 1) % 6; return { a: code, de: buf() }; },
    (w, r) => ({ de: run(T.textControlDispatch(sh(w), r.a, r.de)) })]);
}

const gb = newCore();
const h4 = v => "$" + v.toString(16).padStart(4, "0");
let bad = 0;
const coreStep = gb.cpu.step.bind(gb.cpu);
let minSp = 0xCFF0, joy = null, kj = 0, coreSounds = [], errorSound = false;
for (const [name, bank, addr, regsOf, js, opts = {}] of CASES) {
  // (the lowest sp the call reached: WRAM0 from there to $CFFF is its stack, not compared)
  gb.cpu.step = () => {
    const cpu = gb.cpu, m = gb.mem;
    if (cpu.sp < minSp) minSp = cpu.sp;
    if (opts.frames && cpu.pc === 0x2E3B) {
      if (joy) { const j = joy[kj % joy.length]; m.hram[0x10] = j[0]; m.hram[0x11] = j[1]; m.hram[0x14] = j[2]; }
      kj++;
      cpu.pc = m.read(cpu.sp) | m.read((cpu.sp + 1) & 0xFFFF) << 8; cpu.sp = (cpu.sp + 2) & 0xFFFF; return 16;
    }
    // (QueueVRAMCopy's error sounds, rst $08 at 00:04A8 / 00:04AA for more than $80 blocks: the call is not compared, as
    // in golf_fuzz_routines.mjs: the JS queue has no sound)
    if (opts.frames && cpu.pc === 0x2BCA) { const r = m.read(cpu.sp + 8) | m.read(cpu.sp + 9) << 8; if (r === 0x04AA || r === 0x04AC) errorSound = true; coreSounds.push(cpu.a); cpu.pc = 0x2C14; return 4; }   // (PlaySoundCmd: the id recorded, the driver not run)
    return coreStep();
  };
  if (filter && !name.includes(filter)) continue;
  let fails = 0, first = "", hung = 0, skipped = 0;
  for (let n = 0; n < N; n++) {
    const w = randomState();
    const r = regsOf(w);
    const regs = { ...r };
    for (const p of ["bc", "de", "hl"]) if (p in r) { regs[p[0]] = r[p] >> 8; regs[p[1]] = r[p] & 0xFF; }
    loadCoreFull(gb, w);
    w.high[0x195] = bank;
    let out, err = null;
    minSp = 0xCFF0;
    joy = opts.joy ? opts.joy() : null; kj = 0; coreSounds = []; errorSound = false;
    const saved = [];                            // (opts.patch: {"BB:AAAA": [bytes]}: the core's ROM patched for the call)
    for (const [k, bytes] of Object.entries(opts.patch || {})) {
      const [pb, pa] = k.split(":").map(x => parseInt(x, 16)), o = (pa < 0x4000 ? 0 : pb * 0x4000) + (pa & 0x3FFF);
      bytes.forEach((v, i) => { saved.push([o + i, gb.mem.rom[o + i]]); gb.mem.rom[o + i] = v; });
    }
    if (process.env.WATCHW) { const wa = parseInt(process.env.WATCHW, 16), mw = gb.mem.write.bind(gb.mem); gb.mem.write = (a, v) => { if (a === wa && gb.mem.svbk === 5) console.log("W", a.toString(16), v.toString(16), gb.mem.romBank.toString(16) + ":" + gb.cpu.pc.toString(16)); return mw(a, v); }; }
    try { out = romCall(gb, bank, addr, regs, opts.frames ? 20_000_000 : 5_000_000); } catch (e) { err = e; }
    if (process.env.WATCHW) delete gb.mem.write;
    for (const [o, v] of saved) gb.mem.rom[o] = v;
    if (err) { hung++; continue; }
    if (errorSound) { skipped++; continue; }
    w.framesStubbed = !!opts.frames; w.framesRun = 0; w.joy = joy; w.jsSounds = opts.frames ? [] : null;
    let want;
    try { want = js(w, { ...regs, bc: (regs.b ?? 0) << 8 | (regs.c ?? 0), de: (regs.d ?? 0) << 8 | (regs.e ?? 0), hl: (regs.h ?? 0) << 8 | (regs.l ?? 0) }); }
    catch (e) { fails++; if (!first) first = `${JSON.stringify(r)}: js ${e.message} (rom returned after ${kj} frames)`; continue; }
    const diffs = [];
    {
      for (const [k, v] of Object.entries(want)) if (out[k] !== v) diffs.push(`${k} js ${h4(v)} rom ${h4(out[k])}`);
      for (let b = 0; b < 8 && diffs.length < 4; b++) for (let i = 0; i < 0x1000; i++) {
        if (b === 0 && i >= minSp - 0xC000) break;   // the call's stack (from the lowest sp it reached)
        if (b === 0 && w.wram[0] && gb.mem.wram[0][i] !== w.wram[0][i] || b && gb.mem.wram[b][i] !== w.wram[b][i]) {
          diffs.push(`wram${b} $${((b ? 0xD000 : 0xC000) + i).toString(16)} js ${w.wram[b][i]} rom ${gb.mem.wram[b][i]}`); break;
        }
      }
      for (let i = 0; i < 0x7F; i++) if (gb.mem.hram[i] !== w.high[0x180 + i] && i !== 0x15) { diffs.push(`hram $ff${(0x80 + i).toString(16)} js ${w.high[0x180 + i]} rom ${gb.mem.hram[i]}`); break; }
      if (gb.mem.svbk !== ((w.high[0x196] & 7) || 1)) diffs.push(`svbk js ${w.high[0x196]} rom ${gb.mem.svbk}`);
      for (let b = 0; b < 2; b++) for (let i = 0; i < 0x2000; i++) if (gb.mem.vram[b][i] !== w.vram[b][i]) { diffs.push(`vram${b} $${(0x8000 + i).toString(16)}`); break; }
      if (gb.mem.vbk !== w.lcd.vbk) diffs.push("vbk");
      if (opts.frames && coreSounds.join() !== w.jsSounds.join()) diffs.push(`sounds rom ${coreSounds.join()} js ${w.jsSounds.join()}`);
    }
    if (diffs.length && opts.frames) diffs.push(`frames rom ${kj} js ${w.framesRun}`, `$D852 rom ${(gb.mem.wram[5][0x853] << 8 | gb.mem.wram[5][0x852]).toString(16)} js ${(w.wram[5][0x853] << 8 | w.wram[5][0x852]).toString(16)}`);
    if (diffs.length) { fails++; if (!first) first = `${JSON.stringify(r)}: ${diffs.join(", ")}`; }
  }
  bad += fails > 0;
  console.log(`${fails ? "FAIL" : "ok  "} ${name}: ${N - hung - fails - skipped}/${N - hung - skipped}${hung ? ` (${hung} states where the ROM ran off: a string without its end over the stack, or a wait that never ends)` : ""}${skipped ? ` (${skipped} with the queue's error sound, not compared)` : ""}${first ? "  first: " + first.slice(0, 300) : ""}`);
}
process.exit(bad ? 1 : 0);
