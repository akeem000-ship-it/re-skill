// Menu widgets of bank $39: highlighting a cell of a menu grid, the minigame menu's cursor, numbers drawn as digit
// sprites, the cheat code typed on the main menu, and small fills.
// Port of src/engine/menus/common/menu_widgets_39.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm). Tables are read from the ROM.
// Tests: web/tests/port/routines_menus_common.mjs; UpdateCheatCodeEntry and ResetCheatCodeBuffer run on the main
// menu (lockstep on out/engine/exh1.mtrec).
import { queueSprite } from "../../home/fade.js";
import {
  FZ, FN, FC, cpFlags, decFlags, hook, callHome, sound, withRomBank, withWramBank, loadPalettes, HOME,
  WRAM_STAGING, WRAM_COURT_PLANES, wDecompBuffer, SFX_LOGO_JINGLE, PADF_A, PADF_RIGHT, PADF_LEFT, PADF_UP, PADF_DOWN,
} from "./defs.js";
import { BANK_MENU_LIB, fillTilemapRect } from "./tilemaps.js";
import { TILEBLOCK, tileBlockBlocks, loadCompressedTileBlock, loadIndexedPalette } from "./menu_lib.js";

const FillMenuGridCellTileTable = 0x6DED;                   // per cell: its 3 x 3 rectangle in wShadowAttrmap
const MoveMinigameGridCursorTable0 = 0x6EBA, MoveMinigameGridCursorTable1 = 0x6EBD;
const NumberSpritePalette = 0x6F08, CheatCodeEntryTable = 0x6FC6;
const CELL_SIZE = 3, ATTR_HIGHLIGHT = 0x0C, ATTR_PLAIN = 0x0D;
export const BANK_MAIN_MENU = 0x3B;
const ApplyUnlockEverythingCheat = 0x4B33;                  // (bank $3B, main_menu/n64trophies.js)

// FillMenuGridCellTile (39:6DC2): the attributes of grid cell b, highlighted (c != 0: palette $0C) or not ($0D).
// Registers kept.
export function fillMenuGridCellTile(P, cellIndex, highlighted) {
  const dest = P.bus.u16((FillMenuGridCellTileTable & 0xFF00) + (((FillMenuGridCellTileTable & 0xFF) + ((cellIndex * 2) & 0xFF)) & 0x1FF));
  fillTilemapRect(P, dest, CELL_SIZE, CELL_SIZE, highlighted ? ATTR_HIGHLIGHT : ATTR_PLAIN);
}

// MoveMinigameGridCursor (39:6DF9): the minigame menu: a top row of 3 cells (wMenuCursorY 0) over a bottom row of
// 2 (cells 0 and 2 of x). Left/right wrap along the row (on the bottom row they swap 0 and 2); up/down change rows,
// x mapped through the row's table. Returns a = 1 if a direction was pressed, else 0 (Z); the flags of the last
// step, hl = the table entry for up/down.
const TOP_ROW_CELLS = 3, BOTTOM_ROW_RIGHT = 2;
export function moveMinigameGridCursor(P) {
  const { V, bus } = P, input = V.menuInputPressed;
  const vertical = table => {
    const at = table + V.menuCursorX;
    V.menuCursorX = bus.u8(at);
    const y = V.menuCursorY ^ 1;
    V.menuCursorY = y;
    return { a: 1, hl: at, f: y ? 0 : FZ };
  };
  if (V.menuCursorY === 0) {
    if (input & (PADF_RIGHT | PADF_LEFT)) {
      const v = (V.menuCursorX + (input & PADF_RIGHT ? 1 : -1)) & 0xFF;
      let x, f;
      if (v & 0x80) { x = TOP_ROW_CELLS - 1; f = decFlags(TOP_ROW_CELLS, FC); }   // add a carried: ld a, 3 / dec a
      else if (v < TOP_ROW_CELLS) { x = v; f = cpFlags(v, TOP_ROW_CELLS); }
      else { x = 0; f = FZ; }
      V.menuCursorX = x;
      return { a: 1, f };
    }
    if (input & (PADF_UP | PADF_DOWN)) return vertical(MoveMinigameGridCursorTable0);
    return { a: 0, f: FZ };
  }
  if (input & (PADF_RIGHT | PADF_LEFT)) {
    V.menuCursorX = V.menuCursorX ? 0 : BOTTOM_ROW_RIGHT;
    return { a: 1, f: FZ };                                  // (`or a` of 0, or `xor a`: Z either way)
  }
  if (input & (PADF_UP | PADF_DOWN)) return vertical(MoveMinigameGridCursorTable1);
  return { a: 0, f: FZ };
}

// ---- numbers as sprites ----
// InitNumberSpriteGfx (39:6EC0): clear the digit buffer, digits drawn with attribute 8 from tile 0; c = 0: the
// narrow digit tiles (NumberSpriteGfx) to de with their palette as palette b; else InitNumberSpriteGfxWide.
export function initNumberSpriteGfx(P, palette, wide, dest) {
  const { V, A } = P;
  callHome(P, HOME.ClearBytes, { hl: A.digitSpriteSlots, bc: 7 });
  V.digitSpriteTileBase = 0;
  V.digitSpriteAttr = 0;
  V.digitSpriteAttr = 0x08;
  V.digitSpriteTileBase = 0;
  if (wide) return initNumberSpriteGfxWide(P, palette, dest);
  withRomBank(P, BANK_MENU_LIB, () => loadCompressedTileBlock(P, TILEBLOCK.NumberSpriteGfx, dest, tileBlockBlocks(P, TILEBLOCK.NumberSpriteGfx)));
  return { b: palette, ...loadPalettes(P, NumberSpritePalette, palette, 1) };
}
// InitNumberSpriteGfxWide (39:6EF9): the wide digit tiles to de, IndexedPalettes $0C as palette b
const WIDE_DIGITS_PALETTE = 0x0C;
export function initNumberSpriteGfxWide(P, palette, dest) {
  withRomBank(P, BANK_MENU_LIB, () => loadCompressedTileBlock(P, TILEBLOCK.NumberSpriteGfxWideGfx, dest, tileBlockBlocks(P, TILEBLOCK.NumberSpriteGfxWideGfx)));
  return withRomBank(P, BANK_MENU_LIB, () => loadIndexedPalette(P, palette, WIDE_DIGITS_PALETTE));
}
// DrawDecimalNumberSprites_39 (39:6F10): the number hl in decimal (FormatDecimalNumber into wDigitSpriteSlots) as
// digit sprites, right-aligned: the last digit at d, each one before it 8 to the left. Registers and the WRAM bank
// kept.
const DIGIT_WIDTH = 8, CHAR_0 = 0x30;
export function drawDecimalNumberSprites(P, value, x, y) {
  withWramBank(P, WRAM_COURT_PLANES, () => {
    const slots = P.A.digitSpriteSlots;
    callHome(P, HOME.FormatDecimalNumber, { hl: value, de: slots, a: 0 });
    let len = 0, hl = slots;
    while (P.bus.u8(hl)) { len++; hl++; }
    hl--;
    do {
      drawDigitSprite(P, (P.bus.u8(hl) - CHAR_0) & 0xFF, x, y);
      hl--;
      x = (x - DIGIT_WIDTH) & 0xFF;
      len = (len - 1) & 0xFF;
    } while (len);
  });
}
// DrawDigitSprite_39 (39:6F4F): digit c at (d, e): tile wDigitSpriteTileBase + 2c, attribute wDigitSpriteAttr.
// Registers kept.
export function drawDigitSprite(P, digit, x, y) {
  queueSprite(P, P.V.digitSpriteAttr, (digit * 2 + P.V.digitSpriteTileBase) & 0xFF, x, y);
}

// ---- the cheat code on the main menu ----
// The buttons newly pressed are kept in the first 32 bytes of wDecompBuffer (WRAM 1), wCheatCodeLength counting
// (mod 32). A press of A compares the buffer with CheatCodeEntryTable (29 presses, then 3 zeros); a match unlocks
// everything (TriggerCheatUnlock), once (wCheatUnlockTriggered).
const CHEAT_BUFFER_SIZE = 0x20;
// UpdateCheatCodeEntry (39:6F67). Leaves a = the WRAM bank, the flags of the call, and the registers its path set.
export function updateCheatCodeEntry(P, f = 0) {
  const { V, bus } = P, old = V.wramBank;
  return withWramBank(P, WRAM_STAGING, () => {
    const out = { a: old, f };
    if (V.cheatUnlockTriggered) return out;
    const pressed = V.inputRisingEdge;
    if (pressed & PADF_A) {
      for (let i = 0; i < CHEAT_BUFFER_SIZE; i++) {
        const typed = bus.u8(wDecompBuffer + i), at = CheatCodeEntryTable + i;
        Object.assign(out, { c: i, d: typed, hl: at });
        if (bus.u8(at) !== typed) return out;
      }
      out.c = CHEAT_BUFFER_SIZE;
      Object.assign(out, triggerCheatUnlock(P));
      V.cheatUnlockTriggered = 1;
      return { ...out, a: old, f };
    }
    if (!pressed) return out;
    const at = wDecompBuffer + (V.cheatCodeLength & (CHEAT_BUFFER_SIZE - 1));
    bus.w8(at, pressed);
    V.cheatCodeLength = (V.cheatCodeLength + 1) & 0xFF;
    return { ...out, b: pressed, hl: at };
  });
}
// ResetCheatCodeBuffer (39:6FE7): empty the buffer. Leaves a = the WRAM bank, the flags of the call, bc = 0 and hl
// past the buffer.
export function resetCheatCodeBuffer(P, f = 0) {
  const old = P.V.wramBank;
  return withWramBank(P, WRAM_STAGING, () => {
    P.V.cheatCodeLength = 0;
    callHome(P, HOME.ClearBytes, { hl: wDecompBuffer, bc: CHEAT_BUFFER_SIZE });
    return { a: old, f, bc: 0, hl: wDecompBuffer + CHEAT_BUFFER_SIZE };
  });
}
// TriggerCheatUnlock (39:7003): the jingle, and every unlockable unlocked (ApplyUnlockEverythingCheat, bank $3B).
export function triggerCheatUnlock(P) {
  sound(P, SFX_LOGO_JINGLE);
  return P.callRom(BANK_MAIN_MENU, ApplyUnlockEverythingCheat);
}

// FillIncrementingBytes (39:745A): c bytes (0 = 256) at hl: b, b + 1, ... Leaves a = c = 0 (Z), b and hl after.
export function fillIncrementingBytes(P, hl, b, count) {
  let n = count || 0x100;
  for (; n > 0; n--) { P.bus.w8(hl, b); hl = (hl + 1) & 0xFFFF; b = (b + 1) & 0xFF; }
  return { a: 0, c: 0, b, hl, f: FZ };
}

export const HOOKS = [
  [BANK_MENU_LIB, 0x6DC2, hook((P, c) => { fillMenuGridCellTile(P, c.b, c.c); })],
  [BANK_MENU_LIB, 0x6DF9, hook(P => moveMinigameGridCursor(P))],
  [BANK_MENU_LIB, 0x6EC0, hook((P, c) => initNumberSpriteGfx(P, c.b, c.c, c.de))],
  [BANK_MENU_LIB, 0x6EF9, hook((P, c) => initNumberSpriteGfxWide(P, c.b, c.de))],
  [BANK_MENU_LIB, 0x6F10, hook((P, c) => { drawDecimalNumberSprites(P, c.hl, c.d, c.e); })],
  [BANK_MENU_LIB, 0x6F4F, hook((P, c) => { drawDigitSprite(P, c.c, c.d, c.e); })],
  [BANK_MENU_LIB, 0x6F67, hook((P, c) => updateCheatCodeEntry(P, c.f))],
  [BANK_MENU_LIB, 0x6FE7, hook((P, c) => resetCheatCodeBuffer(P, c.f))],
  [BANK_MENU_LIB, 0x7003, hook(P => triggerCheatUnlock(P))],
  [BANK_MENU_LIB, 0x7447, () => {}],                         // Unused_39_StubNop
  [BANK_MENU_LIB, 0x7448, () => {}],                         // Unused_39_PushPopNop_1
  [BANK_MENU_LIB, 0x7451, () => {}],                         // Unused_39_PushPopNop_2
  [BANK_MENU_LIB, 0x745A, hook((P, c) => fillIncrementingBytes(P, c.hl, c.b, c.c))],
];
