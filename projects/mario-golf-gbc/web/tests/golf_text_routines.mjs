// The text routines (web/js/golf/text.js: the glyph renderer of bank 03, the text printer of bank 05) against the
// ROM's on the emulator core's interpreter: the same random RAM, VRAM and registers in; all WRAM banks (but the
// call's stack), HRAM, VRAM and the returned registers compared after each call.
// usage: node web/tests/golf_text_routines.mjs [N per routine] [name filter]
import { useRom, rw } from "../js/golf/rom.js";
import { GolfMemory } from "../js/golf/memory.js";
import { initDisplay } from "../js/golf/render/display.js";
import * as T from "../js/golf/text.js";
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

const sh = w => ({ w, sound() {}, *advance() { throw new Error("a frame"); } });
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
  ["PushTextStringArg", 5, 0x54CF, () => ({ hl: rnd(0x10000) }), (w, r) => { T.pushTextStringArg(w, r.hl); return {}; }],
  ["PushTextNumberArg", 5, 0x551F, () => ({ hl: rnd(0x10000) }), (w, r) => { T.pushTextNumberArg(w, r.hl); return {}; }],
  ["PushTextByteArg", 5, 0x5552, () => ({ a: rnd(256) }), (w, r) => { T.pushTextByteArg(w, r.a); return {}; }],
  ["SetTextCourseIndex", 5, 0x57C3, () => ({ a: rnd(256) }), (w, r) => { T.setTextCourseIndex(w, r.a); return {}; }],
];
for (const [code, name] of [[4, "TextCmdStringArg"], [7, "TextCmdPlayerName"], [8, "TextCmdByteArg"], [9, "TextCmdNumberArg"], [0x0B, "TextCmdCourseName"], [0x0E, "TextCmdCharName"], [0x0F, "TextCmdPlacing"]]) {
  CASES.push([name, 5, 0x58E2, w => { for (const b of [1, 2, 3, 4, 5, 6, 7]) { w.wram[b][0x847] = rnd(17); w.wram[b][0x848] = rnd(17); w.wram[b][0x849] = rnd(17); } return { a: code, de: buf() }; },
    (w, r) => ({ de: run(T.textControlDispatch(sh(w), r.a, r.de)) })]);
}

const gb = newCore();
const h4 = v => "$" + v.toString(16).padStart(4, "0");
let bad = 0;
for (const [name, bank, addr, regsOf, js] of CASES) {
  if (filter && !name.includes(filter)) continue;
  let fails = 0, first = "", hung = 0;
  for (let n = 0; n < N; n++) {
    const w = randomState();
    const r = regsOf(w);
    const regs = { ...r };
    for (const p of ["bc", "de", "hl"]) if (p in r) { regs[p[0]] = r[p] >> 8; regs[p[1]] = r[p] & 0xFF; }
    loadCoreFull(gb, w);
    w.high[0x195] = bank;
    let out, err = null;
    try { out = romCall(gb, bank, addr, regs, 5_000_000); } catch (e) { err = e; }
    if (err) { hung++; continue; }
    const want = js(w, { ...regs, bc: (regs.b ?? 0) << 8 | (regs.c ?? 0), de: (regs.d ?? 0) << 8 | (regs.e ?? 0), hl: (regs.h ?? 0) << 8 | (regs.l ?? 0) });
    const diffs = [];
    {
      for (const [k, v] of Object.entries(want)) if (out[k] !== v) diffs.push(`${k} js ${h4(v)} rom ${h4(out[k])}`);
      for (let b = 0; b < 8 && diffs.length < 4; b++) for (let i = 0; i < 0x1000; i++) {
        if (b === 0 && i >= 0xF80) break;        // the call's stack
        if (b === 0 && w.wram[0] && gb.mem.wram[0][i] !== w.wram[0][i] || b && gb.mem.wram[b][i] !== w.wram[b][i]) {
          diffs.push(`wram${b} $${((b ? 0xD000 : 0xC000) + i).toString(16)} js ${w.wram[b][i]} rom ${gb.mem.wram[b][i]}`); break;
        }
      }
      for (let i = 0; i < 0x7F; i++) if (gb.mem.hram[i] !== w.high[0x180 + i] && i !== 0x15) { diffs.push(`hram $ff${(0x80 + i).toString(16)} js ${w.high[0x180 + i]} rom ${gb.mem.hram[i]}`); break; }
      if (gb.mem.svbk !== ((w.high[0x196] & 7) || 1)) diffs.push(`svbk js ${w.high[0x196]} rom ${gb.mem.svbk}`);
      for (let b = 0; b < 2; b++) for (let i = 0; i < 0x2000; i++) if (gb.mem.vram[b][i] !== w.vram[b][i]) { diffs.push(`vram${b} $${(0x8000 + i).toString(16)}`); break; }
      if (gb.mem.vbk !== w.lcd.vbk) diffs.push("vbk");
    }
    if (diffs.length) { fails++; if (!first) first = `${JSON.stringify(r)}: ${diffs.join(", ")}`; }
  }
  bad += fails > 0;
  console.log(`${fails ? "FAIL" : "ok  "} ${name}: ${N - hung - fails}/${N - hung}${hung ? ` (${hung} states where the ROM ran off: a string without its end over the stack)` : ""}${first ? "  first: " + first : ""}`);
}
process.exit(bad ? 1 : 0);
