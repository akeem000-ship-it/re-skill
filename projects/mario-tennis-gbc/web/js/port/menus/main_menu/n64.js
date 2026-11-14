// Bank $3B helpers (the start of n64_3b.asm): cursor cells, clearing a WRAM 3 map row, the animated-tiles frame task,
// a name with diacritics written into a tilemap, numbers as ASCII digits. (The rest of the file, the N64 exhibition
// records screen, is in n64data.js with the other records screens.)
// Port of the start of src/engine/menus/main_menu/n64_3b.asm ($43CB-$44A9) of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm). Tables are read from the ROM.
// Tests: web/tests/port/routines_menus_main.mjs; DrawNameWithDiacritics_3b on the main menu's caption (lockstep).
import {
  FZ, FH, addFlags, subFlags, farcallFlags, hook, callHome, withRomBank, withWramBank, HOME, WRAM_SCREEN,
  TILEMAP_WIDTH, wShadowTilemap,
} from "../common/defs.js";
import { BANK_MENU_LIB, updateAnimatedTiles } from "../common/tilemaps.js";

export const BANK_MAIN_MENU = 0x3B;

// Unused_3b_ClearWram3Row64 (3B:43FB) / ...Alt (3B:4411): 64 zero bytes at hl in WRAM 3. Leaves hl after them,
// a = the bank restored, c = 0 and the flags of the call (pop_wram_bank).
export function unusedClearWram3Row64(P, hl, f) {
  const old = P.V.wramBank;
  withWramBank(P, WRAM_SCREEN, () => { for (let i = 0; i < 0x40; i++) { P.bus.w8(hl, 0); hl = (hl + 1) & 0xFFFF; } });
  return { a: old, c: 0, hl, f };
}
// UpdateAnimatedTilesTask_3b (3B:4428): the animated tiles as a frame task of this bank (farcall UpdateAnimatedTiles)
export function updateAnimatedTilesTask(P, sp) {
  withRomBank(P, BANK_MENU_LIB, () => updateAnimatedTiles(P));
  return { f: farcallFlags(sp) };                           // UpdateAnimatedTiles keeps af
}

// DrawNameWithDiacritics_3b (3B:442C): the 0-ended name at hl into a tilemap at de; a dakuten / handakuten code
// ($DE / $DF) after a character goes in the row above it (as $0E / $0F where that cell holds tile 3, the window
// background). At the end of a 32-wide row de doubles (the ROM adds de to itself). Leaves hl at the 0, de after the
// name; af, bc kept.
const DAKUTEN = 0xDE, HANDAKUTEN = 0xDF, WINDOW_BLANK = 0x03, MARK_ON_BLANK = 0xD0;
export function drawNameWithDiacritics(P, hl, de) {
  const { bus } = P;
  for (;;) {
    const ch = bus.u8(hl);
    if (!ch) return { hl, de };
    bus.w8(de, ch);
    hl = (hl + 1) & 0xFFFF;
    const mark = bus.u8(hl);
    if (mark === DAKUTEN || mark === HANDAKUTEN) {
      const above = (de - TILEMAP_WIDTH) & 0xFFFF;
      bus.w8(above, bus.u8(above) === WINDOW_BLANK ? mark - MARK_ON_BLANK : mark);
      hl = (hl + 1) & 0xFFFF;
    }
    de = (de + 1) & 0xFFFF;
    if (!(de & 0x1F)) de = (de * 2) & 0xFFFF;
  }
}

// Unused_3b_DrawDecimalNumber (3B:4465): the number hl in decimal (FormatDecimalNumber, width a, into a buffer on
// the stack) written as ASCII digits at de (Unused_3b_DrawAsciiDigitString). af, bc, hl kept; de after it.
export function unusedDrawDecimalNumber(P, cpu) {
  const sp = cpu.sp, buffer = (sp - 16) & 0xFFFF, de = cpu.de;
  cpu.sp = (sp - 20) & 0xFFFF;
  try {
    const text = callHome(P, HOME.FormatDecimalNumber, { a: cpu.a, hl: cpu.hl, de: buffer, bc: buffer }).bc;
    const r = unusedDrawAsciiDigitString(P, text, de);
    return { de: r.de };
  } finally { cpu.sp = sp; }
}
// Unused_3b_DrawAsciiDigitString (3B:4486): each character of the 0-ended string at hl by DrawAsciiDigitChar
export function unusedDrawAsciiDigitString(P, hl, de) {
  let r = { de };
  for (;;) {
    const ch = P.bus.u8(hl); hl = (hl + 1) & 0xFFFF;
    if (!ch) return { ...r, a: 0, hl, f: FZ | FH };
    r = { ...r, ...unusedDrawAsciiDigitChar(P, ch, r.de) };
  }
}
// Unused_3b_DrawAsciiDigitChar (3B:4490): a character from '0' up written at de (in WRAM 3, left mapped); one below
// '0' skips the cell. de + 1.
export function unusedDrawAsciiDigitChar(P, ch, de) {
  if (ch < 0x30) return { de: (de + 1) & 0xFFFF, a: (ch - 0x30) & 0xFF, f: subFlags(ch, 0x30) };
  P.wramBank(WRAM_SCREEN);
  P.bus.w8(de, ch);
  return { de: (de + 1) & 0xFFFF, a: ch, b: ch, f: addFlags((ch - 0x30) & 0xFF, 0x30) };
}

export const HOOKS = [
  [BANK_MAIN_MENU, 0x43FB, hook((P, c) => unusedClearWram3Row64(P, c.hl, c.f))],
  [BANK_MAIN_MENU, 0x4411, hook((P, c) => unusedClearWram3Row64(P, c.hl, c.f))],
  [BANK_MAIN_MENU, 0x4428, hook((P, c) => updateAnimatedTilesTask(P, c.sp))],
  [BANK_MAIN_MENU, 0x442C, hook((P, c) => drawNameWithDiacritics(P, c.hl, c.de))],
  [BANK_MAIN_MENU, 0x4465, hook((P, c) => unusedDrawDecimalNumber(P, c))],
  [BANK_MAIN_MENU, 0x4486, hook((P, c) => unusedDrawAsciiDigitString(P, c.hl, c.de))],
  [BANK_MAIN_MENU, 0x4490, hook((P, c) => unusedDrawAsciiDigitChar(P, c.a, c.de))],
  [BANK_MAIN_MENU, 0x44A9, () => {}],                        // Unused_3b_StubNop
];
