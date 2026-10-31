// The text banks' string fetch: FetchText_<bank> (src/twins/fetch_text.asm, one routine assembled into the 13 text
// banks $1F, $25, $26, $30-$37, $5E, $6E) and each bank's two slot entries FetchDialogueText_<bank> (slot 0: into
// wTextBuffer) and FetchShortText_<bank> (slot 2: into wShortTextBuffer). One body for the 39 addresses; the bank
// is a parameter (its tables: FetchTextTable_<bank> at $4004, TextStrings_<bank>).
// Port of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm), whose names these are.
// Verified with web/tests/port/routines_standalone.mjs and strict lockstep (story1, rec1, rec2 and the menus).
import { playSoundManaged } from "../audio/requests.js";

const wTextBuffer = 0xC600, wTextBuffer_SIZE = 160;          // WRAM 0
const wShortTextBuffer = 0xD880, wShortTextBuffer_SIZE = 16; // WRAM 5 (as mapped: the callers map bank 5)
const hDebugStepMode = 0xFF9E, BGM_CREDITS = 0x2C;
const FetchTextTable = 0x4004;
const Z = 0x80;
// [bank, FetchDialogueText_<bank>, FetchShortText_<bank>, FetchText_<bank>, TextStrings_<bank>]
export const TEXT_BANKS = [
  [0x1F, 0x7A8B, 0x7A93, 0x7A9B, 0x417E], [0x25, 0x7B38, 0x7B40, 0x7B48, 0x421A], [0x26, 0x7B17, 0x7B1F, 0x7B27, 0x41F6],
  [0x30, 0x7D82, 0x7D8A, 0x7D92, 0x4464], [0x31, 0x7BC3, 0x7BCB, 0x7BD3, 0x42BA], [0x32, 0x7AA7, 0x7AAF, 0x7AB7, 0x417A],
  [0x33, 0x7ACA, 0x7AD2, 0x7ADA, 0x41BE], [0x34, 0x7B43, 0x7B4B, 0x7B53, 0x4242], [0x35, 0x7B29, 0x7B31, 0x7B39, 0x4220],
  [0x36, 0x7EBE, 0x7EC6, 0x7ECE, 0x4592], [0x37, 0x7B1E, 0x7B26, 0x7B2E, 0x4204], [0x5E, 0x6E8F, 0x6E97, 0x6E9F, 0x428A],
  [0x6E, 0x7B08, 0x7B10, 0x7B18, 0x41E8],
];

// FetchText_<bank>: string de of the bank (a = 0: into wTextBuffer, up to 159 bytes and its terminator; else into
// wShortTextBuffer, up to 15) copied through the 0 that ends it. A string too long is cut and terminated; with the
// debug step mode on, that sounds the credits theme as an alarm. Keeps bc, de, hl; returns a and F (the last
// `or a`). The table words and the string are read through the memory as mapped (this bank), as the ROM does.
export function fetchText(P, strings, a, de) {
  const bus = P.bus;
  let hl = (FetchTextTable + ((de << 1) & 0xFFFF)) & 0xFFFF;
  const off = bus.u8(hl) | bus.u8((hl + 1) & 0xFFFF) << 8;
  hl = (strings + off) & 0xFFFF;
  let dest = a ? wShortTextBuffer : wTextBuffer, c = a ? wShortTextBuffer_SIZE : wTextBuffer_SIZE;
  for (;;) {
    c = (c - 1) & 0xFF;
    if (c === 0) break;                                           // .countDone
    const v = bus.u8(hl); hl = (hl + 1) & 0xFFFF;
    bus.w8(dest, v); dest = (dest + 1) & 0xFFFF;
    if (!v) return { a: 0, f: Z };
  }
  bus.w8(dest, 0);
  const dbg = bus.u8(hDebugStepMode);
  if (dbg) playSoundManaged(P, BGM_CREDITS);                       // (sound BGM_CREDITS: every register kept)
  return { a: dbg, f: dbg ? 0 : Z };
}

// FetchDialogueText_<bank> / FetchShortText_<bank>: push af / ld a, 0 or 1 / call FetchText / pop af: every
// register kept
const entry = (strings, a) => (P, cpu) => { fetchText(P, strings, a, cpu.de); };
const body = strings => (P, cpu) => { const r = fetchText(P, strings, cpu.a, cpu.de); cpu.a = r.a; cpu.f = r.f; };

export const HOOKS = TEXT_BANKS.flatMap(([bank, dialogue, short, fetch, strings]) => [
  [bank, dialogue, entry(strings, 0)],
  [bank, short, entry(strings, 1)],
  [bank, fetch, body(strings)],
]);
