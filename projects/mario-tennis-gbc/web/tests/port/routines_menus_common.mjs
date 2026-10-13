// Routine tests for web/js/port/menus/common (run by web/tests/port_routines.mjs, filter "Menu"): the shared menu
// code of banks $16-$18, $1B, $38, $39, $3B, $3E. Each entry calls one routine at its ROM address on the ROM and on
// the port from recorded states (the default recordings, or --rec out/engine/exh1.mtrec,out/port/save1.mtrec),
// with registers drawn from the state and prep() forcing the branches: cursor positions at the grid's edges and
// past them, every pad direction, link states, lock flags, a full sprite queue, every animated-tile set and
// timer phase, every tilemap-assembly entry, every cheat-code prefix.
// The helpers are exported for routines_menus_main.mjs.
import { RAM_FIELDS } from "../../js/port/fields.js";
import { loadRom } from "../engine/corpus.mjs";
import { hookKey } from "../../js/port/port.js";

export const ALL = ["a", "f", "b", "c", "d", "e", "h", "l"];
export const NOF = ["a", "b", "c", "d", "e", "h", "l"];
const FIELD = Object.fromEntries(RAM_FIELDS.map(([n, bank, addr]) => [n, { bank, addr }]));
export const at = name => { if (!FIELD[name]) throw new Error(`no field ${name}`); return FIELD[name].addr; };

// ---- deterministic randomness per (state, entry) ----
export function rng(s, salt) {
  let x = 2166136261 ^ salt;
  for (const ch of `${s.rec}@${s.f}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
  x = (x >>> 0) || 1;
  return n => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x % n; };
}
export const pick = (r, list) => list[r(list.length)];
// memory writes as the CPU sees them (the bank mapped now), and into a given WRAM bank
export const w = (mem, a, v) => mem.write(a & 0xFFFF, v & 0xFF);
export const w16 = (mem, a, v) => { w(mem, a, v); w(mem, a + 1, v >> 8); };
export const wv = (mem, name, v) => w(mem, at(name), v);
export const wx = (mem, bank, a, v) => { if (a < 0xD000) w(mem, a, v); else mem.wram[bank][a - 0xD000] = v & 0xFF; };
export const fillx = (mem, bank, a, n, f) => { for (let i = 0; i < n; i++) wx(mem, bank, a + i, f(i)); };

// T(list, name, bank, addr, { regs(r, s) -> {a, f, bc, de, hl, ...}, prep(mem, r, s), out, n, wram, ignore, js })
// n: test every n-th state. The WRAM bank mapped is `wram` or the state's; hWramBank follows it on both machines.
let salt = 0;
export function T(list, name, bank, addr, { regs = () => ({}), prep = null, out = ALL, n = 1, wram, ignore, js } = {}) {
  const k = ++salt * 7919;
  let i = 0, off = salt % n;
  const regsOf = s => {
    const r = rng(s, k), g = { a: r(256), f: r(16) << 4, bc: r(0x10000), de: r(0x10000), hl: r(0x10000), ...regs(r, s) };
    for (const [p, hi, lo] of [["bc", "b", "c"], ["de", "d", "e"], ["hl", "h", "l"]]) {
      if (!(hi in g)) g[hi] = g[p] >> 8;
      if (!(lo in g)) g[lo] = g[p] & 0xFF;
    }
    return { a: g.a & 0xFF, f: g.f & 0xF0, b: g.b & 0xFF, c: g.c & 0xFF, d: g.d & 0xFF, e: g.e & 0xFF, h: g.h & 0xFF, l: g.l & 0xFF };
  };
  list.push({
    name, bank, addr, out, wram, ignore, when: () => (i++ % n) === off,
    regs: regsOf,
    prep(mem, s) {
      mem.hram[0x16] = mem.svbk;
      mem.ie = 0;                                            // (no VBlank in the middle of the ROM's run)
      if (prep) prep(mem, rng(s, k + 1), s);
    },
    js: js || ((P, regs) => {
      if (!P.hooks.has(hookKey(bank, addr))) throw new Error(`no port hooked at ${bank.toString(16)}:${addr.toString(16)}`);
      P.ime = false;
      return P.callRom(bank, addr, regs);
    }),
  });
}

const ENTRIES = [];
const C = (...a) => T(ENTRIES, ...a);

// ---- cursors (cursor_*.asm) ----
const DIRS = [0x10, 0x20, 0x40, 0x80, 0x01, 0x02, 0x00, 0x11, 0xC0, 0x30, 0xFF];
const gridRegs = r => ({ b: pick(r, [1, 2, 3, 4, 5, 9, 0x80, 0xFF, r(256)]), c: pick(r, [1, 2, 3, 4, 6, 0x81, r(256)]) });
const cursorPrep = (mem, r) => {
  for (const n of ["menuCursorX", "menuCursorY", "menuCursor2X", "menuCursor2Y"]) wv(mem, n, pick(r, [0, 1, 2, 3, 4, 8, 0x7F, 0x80, 0xFF, r(256)]));
  wv(mem, "menuInputPressed", pick(r, DIRS)); wv(mem, "linkInput", pick(r, DIRS));
  wv(mem, "linkRemoteInput", pick(r, DIRS)); wv(mem, "linkRemoteInputBuf", pick(r, DIRS));
  wv(mem, "linkState", pick(r, [1, 2]));
  wv(mem, "menuCursorLockFlags", pick(r, [0, 1, 2, 3, 4, 8, 0x0C, 0xF0, r(256)]));
};
const GRID_COPIES = [
  [0x16, 0x40F8, 0x4176, 0x41F3, 0x42BE, 0x4387], [0x17, 0x4108, 0x4186, 0x4203, 0x42CE, 0x4397],
  [0x1B, 0x4132, 0x41B0, 0x422D, 0x42F8, 0x43C1], [0x38, 0x410A, 0x4188, 0x4205, 0x42D0, 0x4399],
  [0x3B, 0x412A, 0x41A8, 0x4225, 0x42F0, 0x43B9], [0x3E, 0x413A, 0x41B8, 0x4235, 0x4300, 0x43C9],
];
for (const [bank, grid, gridLink, remote1, remote2, index] of GRID_COPIES) {
  const b = bank.toString(16);
  C(`menus/common MoveMenuCursorGrid_${b}`, bank, grid, { regs: gridRegs, prep: cursorPrep });
  C(`menus/common MoveMenuCursorGridFromLinkInput_${b}`, bank, gridLink, { regs: gridRegs, prep: cursorPrep, n: 2 });
  C(`menus/common MoveMenuCursorGridRemote_${b}`, bank, remote1, { regs: gridRegs, prep: cursorPrep });
  C(`menus/common MoveMenuCursor2GridRemote_${b}`, bank, remote2, { regs: gridRegs, prep: cursorPrep });
  C(`menus/common GetMenuCursorIndex_${b}`, bank, index, { regs: gridRegs, prep: cursorPrep, n: 2 });
}
const ptrRegs = r => ({ ...gridRegs(r), hl: 0xC800 + r(0x400) });
for (const [bank, addr] of [[0x17, 0x43A9], [0x1B, 0x43D3], [0x38, 0x43AB], [0x3B, 0x43CB]])
  C(`menus/common GetMenuCursorIndexFromPtr_${bank.toString(16)}`, bank, addr, { regs: ptrRegs, prep: (mem, r) => { cursorPrep(mem, r); }, n: 2 });
const divRegs = r => ({ b: pick(r, [1, 2, 3, 5, 9, 0x40, 0xFF, 1 + r(255)]), c: r(256), hl: 0xC800 + r(0x400) });
for (const [bank, addr] of [[0x17, 0x43B9], [0x1B, 0x43E3], [0x38, 0x43BB], [0x3B, 0x43DB]])
  C(`menus/common SetMenuCursorFromIndex_${bank.toString(16)}`, bank, addr, { regs: divRegs, n: 2 });
for (const [bank, addr] of [[0x1B, 0x43F5], [0x38, 0x43CD], [0x3B, 0x43ED]])
  C(`menus/common SetMenuCursorFromIndexToPtr_${bank.toString(16)}`, bank, addr, { regs: divRegs, n: 2 });
// the bobbing offsets and the boxes; a full sprite queue sometimes
const spritePrep = (mem, r) => {
  wv(mem, "vBlankCounter", r(256));
  if (r(5) === 0) wv(mem, "spriteQueueIndex", 0xA0); else if (r(2)) wv(mem, "spriteQueueIndex", 4 * r(40));
};
for (const [bank, box, x, y] of [[0x16, 0x4006, 0x4069, 0x4093], [0x17, 0, 0x4079, 0x40A3], [0x1B, 0x4040, 0x40A3, 0x40CD],
  [0x38, 0x4018, 0x407B, 0x40A5], [0x3B, 0x4038, 0x409B, 0x40C5], [0x3E, 0x4048, 0x40AB, 0x40D5]]) {
  const b = bank.toString(16);
  C(`menus/common BobOffsetX_${b}`, bank, x, { regs: r => ({ c: pick(r, [0, 1, r(256)]) }), prep: spritePrep, n: 2 });
  C(`menus/common BobOffsetY_${b}`, bank, y, { regs: r => ({ c: pick(r, [0, 1, r(256)]) }), prep: spritePrep, n: 2 });
  if (box) C(`menus/common BobbingBox_${b}`, bank, box, { prep: spritePrep });
}
for (const [bank, addr] of [[0x17, 0x40CD], [0x1B, 0x40F7], [0x38, 0x40CF], [0x3B, 0x40EF], [0x3E, 0x40FF]])
  C(`menus/common DrawCornerBrackets_${bank.toString(16)}`, bank, addr, { prep: spritePrep, n: 2 });
// Unused_16_DrawCornerBrackets: entered past its first pushes; it returns to the word 4 bytes above its return
// address, which the test makes the harness's own return address (the ROM's run then ends there)
C("menus/common Unused_16_DrawCornerBrackets", 0x16, 0x40CD, {
  prep: (mem, r) => { spritePrep(mem, r); w16(mem, 0xCFF0, r(0x10000)); w16(mem, 0xCFF2, 0xFFF0); },
  js: (P, regs) => {
    const c = P.cpu;
    for (const k in regs) c[k] = regs[k];
    c.sp = 0xCFEE; P.bus.w16(0xCFEE, 0xFFF0);
    P.gb.mem.romBank = 0x16; P.gb.mem.updateRom(); P.V.romBank = 0x16;
    P.hooks.get(hookKey(0x16, 0x40CD))(P, c);
    P.ret();
    return { a: c.a, f: c.f, b: c.b, c: c.c, d: c.d, e: c.e, h: c.h, l: c.l };
  },
});

// ---- screen assets and tilemaps (animated_39.asm, assets_39.asm) ----
export const ROM = loadRom();
export const romByte = (bank, a) => (a < 0x4000 ? ROM[a] : ROM[bank * 0x4000 + a - 0x4000]);
export const romWord = (bank, a) => romByte(bank, a) | romByte(bank, a + 1) << 8;
const TILEMAPS = 0x39;
// (records 9 and 32 are slot pointers into code, not screens: their "streams" reach back before the buffer)
C("menus/common LoadScreenAssetRecord", TILEMAPS, 0x407E, { regs: r => ({ c: pick(r, [...Array(70).keys()].filter(x => x !== 9 && x !== 32)) }), n: 3, prep: (mem, r) => { if (r(3) === 0) wv(mem, "fadedOut", 1); } });
C("menus/common QueueWram3MapToVRAM", TILEMAPS, 0x4325, { n: 2 });
C("menus/common UpdateAnimatedTiles", TILEMAPS, 0x4342, {
  prep: (mem, r) => {
    wv(mem, "animatedTileTimer", pick(r, [0, 1, 2, 3, 0x7F, 0xFF, r(256)])); wv(mem, "animatedTilePeriod", pick(r, [1, 2, 3, 4, 0, r(256)]));
    wv(mem, "animatedTileSet", r(256)); wv(mem, "animatedTileFrame", r(256));
  },
});
C("menus/common LoadFixedTileBlockAndPalette", TILEMAPS, 0x44D3, { regs: r => ({ de: pick(r, [0x8000, 0x8800, 0x9000, 0xA000]) + 16 * r(64) }), n: 2 });
C("menus/common Unused_39_LoadFixedBgPalette0", TILEMAPS, 0x451E, { n: 3 });
const rectRegs = r => ({ hl: 0xC800 + r(0x300), de: pick(r, [0xC800, 0xD000]) + r(0x300), b: 1 + r(24), c: 1 + r(16) });
C("menus/common CopyTilemapRect", TILEMAPS, 0x4530, { regs: rectRegs, n: 2 });
C("menus/common FillTilemapRect", TILEMAPS, 0x4558, { regs: rectRegs, n: 2 });
// the panels: every panel b, every step c of its list (the lists' lengths from the ROM: up to the next list)
const DISPATCH = 0x4E60, PANELS = 24;
const listStarts = [...new Set(Array.from({ length: PANELS }, (_, i) => romWord(TILEMAPS, DISPATCH + 2 * i)))].sort((x, y) => x - y);
const stepsOf = panel => { const s = romWord(TILEMAPS, DISPATCH + 2 * panel), next = listStarts.find(x => x > s) ?? s + 32; return (next - s) >> 1; };
C("menus/common RestoreMenuBgAndDrawPanel", TILEMAPS, 0x4DEB, {
  wram: 3, regs: r => { const b = r(PANELS); return { b, c: r(stepsOf(b)) }; },
  prep: (mem, r) => { for (let i = 0; i < 0x800; i += 1 + r(8)) mem.wram[3][0x800 + i] = r(256); },
});

// ---- the menu library (menu_lib_39.asm) ----
export function lzLen(bank, a) {
  let o = bank * 0x4000 + a - 0x4000, n = 0;
  for (;;) {
    const flags = ROM[o++];
    for (let bit = 0; bit < 8; bit++) {
      if (flags >> bit & 1) { o++; n++; continue; }
      const lo = ROM[o++], hi = ROM[o++];
      if (!lo && !hi) return n;
      n += (hi & 0x1F) + 3;
    }
  }
}
const blockLen = b => { const w = romWord(TILEMAPS, 0x46B7 + 2 * b); return lzLen(w >> 8, romWord(w >> 8, 0x4000 + (w & 0xFF))); };
export const SMALL_BLOCKS = [...Array(122).keys()].filter(b => blockLen(b) <= 0xE00);
const vramDest = r => pick(r, [0x8000, 0x8800, 0x9000, 0xA000, 0xA800, 0xB000]) + 16 * r(64);
C("menus/common LoadIndexedPalette", TILEMAPS, 0x457F, { regs: r => ({ b: r(16), c: r(25) }), n: 2, prep: (mem, r) => { if (r(3) === 0) wv(mem, "fadedOut", 1); } });
C("menus/common Unused_39_LoadFixedPaletteSet", TILEMAPS, 0x4661, { n: 4 });
C("menus/common LoadCompressedTileBlock", TILEMAPS, 0x468B, { regs: r => ({ b: pick(r, SMALL_BLOCKS), c: 1 + r(16), de: vramDest(r) }), n: 2,
  prep: (mem, r) => { if (r(4) === 0) mem.ppu.lcdc &= 0x7F; } });
C("menus/common LoadMenuArrowSpriteTiles", TILEMAPS, 0x4A16, { regs: r => ({ de: vramDest(r) }), n: 3 });
C("menus/common QueueStackedSpritePair", TILEMAPS, 0x4A53, { prep: spritePrep, n: 2 });
C("menus/common ApplySpriteWaveOffset", TILEMAPS, 0x4A75, { prep: spritePrep, n: 2 });
C("menus/common ApplySpriteBobOffset", TILEMAPS, 0x4AC4, { prep: spritePrep, n: 2 });
C("menus/common InitMenuBgScroll", TILEMAPS, 0x4B13, { n: 4 });
C("menus/common LoadMenuSpritePalettePair", TILEMAPS, 0x4B3A, { regs: r => ({ b: r(8), c: r(8) }), n: 2 });
const scrollPrep = (mem, r) => {
  spritePrep(mem, r);
  for (const [n, k] of [["menuBgScrollY", 2], ["menuBgScrollTile", 2], ["menuBgScrollAttr", 2], ["menuBgScrollX", 1], ["menuBgScrollLane", 1]])
    for (let i = 0; i < k; i++) w(mem, at(n) + i, pick(r, [0, 1, 0xA0, 0xB0, 0xB1, 0xC6, r(256)]));
};
C("menus/common TickMenuBgScroll", TILEMAPS, 0x4B6D, { prep: scrollPrep });
C("menus/common LoadMenuFontTiles", TILEMAPS, 0x4BE8, { n: 3 });
C("menus/common LoadStadiumBgGraphics", TILEMAPS, 0x4C38, { n: 3 });

// ---- widgets (menu_widgets_39.asm) ----
C("menus/common FillMenuGridCellTile", TILEMAPS, 0x6DC2, { wram: 3, regs: r => ({ b: r(6), c: pick(r, [0, 1, r(256)]) }), n: 2 });
C("menus/common MoveMinigameGridCursor", TILEMAPS, 0x6DF9, {
  prep: (mem, r) => { wv(mem, "menuCursorY", pick(r, [0, 1, 0, 1, r(256)])); wv(mem, "menuCursorX", pick(r, [0, 1, 2, 3, 0xFF])); wv(mem, "menuInputPressed", pick(r, DIRS)); },
});
const digitsPrep = (mem, r) => { spritePrep(mem, r); wv(mem, "digitSpriteTileBase", r(256)); wv(mem, "digitSpriteAttr", r(256)); };
C("menus/common InitNumberSpriteGfx", TILEMAPS, 0x6EC0, { regs: r => ({ b: r(16), c: pick(r, [0, 0, 1, r(256)]), de: vramDest(r) }), n: 2 });
C("menus/common InitNumberSpriteGfxWide", TILEMAPS, 0x6EF9, { regs: r => ({ b: r(16), de: vramDest(r) }), n: 3 });
C("menus/common DrawDecimalNumberSprites_39", TILEMAPS, 0x6F10, { regs: r => ({ hl: pick(r, [0, 7, 10, 99, 100, 9999, 0xFFFF, r(0x10000)]) }), prep: digitsPrep });
C("menus/common DrawDigitSprite_39", TILEMAPS, 0x6F4F, { regs: r => ({ c: r(10) }), prep: digitsPrep, n: 2 });
// the cheat code: the buffer holds a prefix of the code (or all of it) and the next button pressed
const CHEAT = Array.from({ length: 32 }, (_, i) => romByte(TILEMAPS, 0x6FC6 + i));
const cheatPrep = (mem, r) => {
  wv(mem, "cheatUnlockTriggered", r(4) === 0 ? 1 : 0);
  wv(mem, "cheatCodeLength", pick(r, [0, 5, 28, 29, 31, 32, r(256)]));
  const k = pick(r, [32, 32, 29, r(33)]);
  for (let i = 0; i < 32; i++) mem.wram[1][i] = i < k ? CHEAT[i] : r(3) ? 0 : r(256);
  wv(mem, "inputRisingEdge", pick(r, [0, 1, 1, 0x10, 0x80, 0x04, 0x21, r(256)]));
};
C("menus/common UpdateCheatCodeEntry", TILEMAPS, 0x6F67, { prep: cheatPrep });
C("menus/common ResetCheatCodeBuffer", TILEMAPS, 0x6FE7, { n: 3 });
C("menus/common TriggerCheatUnlock", TILEMAPS, 0x7003, { n: 6 });
for (const [nm, a] of [["Unused_39_StubNop", 0x7447], ["Unused_39_PushPopNop_1", 0x7448], ["Unused_39_PushPopNop_2", 0x7451]]) C(`menus/common ${nm}`, TILEMAPS, a, { n: 20 });
C("menus/common FillIncrementingBytes", TILEMAPS, 0x745A, { regs: r => ({ hl: 0xC800 + r(0x400), c: pick(r, [0, 1, 2, r(256)]) }), n: 2 });

// ---- bank $18 helpers (cursorbox_18.asm) ----
const B18 = 0x18;
const palPrep = (mem, r) => { if (r(3) === 0) wv(mem, "fadedOut", 1); };
C("menus/common Unused_18_LoadAllIndexedPalettes", B18, 0x4328, { regs: r => ({ d: r(12) }), prep: palPrep, n: 2 });
C("menus/common LoadIndexedPalette_18", B18, 0x4339, { regs: r => ({ d: r(16) }), prep: palPrep, n: 2 });
C("menus/common Unused_18_FlushBgMapShadowToVram", B18, 0x4353, { prep: (mem, r) => wv(mem, "bgMapShadowDirty", pick(r, [0, 1, 0x10, 0xFF, r(256)])), n: 2 });
C("menus/common LoadMenuHandCursorGfx", B18, 0x437C, { regs: r => ({ hl: vramDest(r), d: r(12), e: 1 + r(4) }), prep: palPrep, n: 2 });
C("menus/common Unused_18_LoadFontTiles", B18, 0x438D, { n: 10 });
C("menus/common Unused_18_WriteTilemapByteAdvance", B18, 0x43A6, { regs: r => ({ de: 0xC800 + r(0x400) }), n: 4 });
C("menus/common Unused_18_DrawDecimalNumberToTilemap", B18, 0x43A9, { regs: r => ({ a: pick(r, [0, 1, 3, 5]), hl: r(0x10000), de: 0xC800 + r(0x300) }), n: 2 });
const boxRegs = r => ({ hl: 0xC800 + r(0x200), de: 0xD000 + r(0x400), b: pick(r, [3, 4, 8, 20, 2 + r(20)]), c: pick(r, [3, 4, 5, 3 + r(12)]) });
C("menus/common Unused_18_DrawBox", B18, 0x43C8, { regs: boxRegs, n: 2 });
C("menus/common Unused_18_DrawBoxTopRow", B18, 0x4414, { regs: boxRegs, n: 3 });
C("menus/common Unused_18_DrawBoxSideRow", B18, 0x4427, { regs: boxRegs, n: 3 });
C("menus/common Unused_18_DrawBoxBottomRow", B18, 0x4435, { regs: boxRegs, n: 3 });
C("menus/common Unused_18_AddBobbingOffsetXY", B18, 0x4444, { prep: spritePrep, n: 2 });
C("menus/common AddBobbingOffsetY", B18, 0x4478, { prep: spritePrep, n: 2 });
C("menus/common AddBobbingOffsetYLarge", B18, 0x449B, { prep: spritePrep, n: 2 });
C("menus/common Unused_18_StubNop", B18, 0x44EE, { n: 10 });
C("menus/common Unused_18_FindRosterEntry", B18, 0x44EF, {
  regs: r => ({ hl: 0xC800, a: r(8) }), n: 2,
  prep: (mem, r) => { for (let i = 0; i < 12; i++) w(mem, 0xC800 + 8 * i, i === 11 ? 0xFF : r(10)); },
});
C("menus/common LoadCharacterRecordToBuffer", B18, 0x4507, { regs: r => ({ a: pick(r, [0x84, 0, 1, 5, 0x0F, r(0x20)]) }), wram: 2, n: 2 });
C("menus/common CheckCharacterUnlocked", B18, 0x452A, { regs: r => ({ a: pick(r, [0, 3, 4, 5, 9, 0x84, 0x85, r(256)]) }), wram: 2,
  prep: (mem, r) => { mem.wram[2][0x580 + 11] = pick(r, [0xFF, 0, 0x3E]); } });
C("menus/common UnusedCheckCharacterIdUnlocked", B18, 0x454D, { regs: r => ({ a: pick(r, [0, 0x0F, 0x10, r(256)]) }), n: 3 });
C("menus/common Unused_18_CheckUnlockFlag", B18, 0x4557, { regs: r => ({ a: pick(r, [0, 5, 0x1F, 0x84, 0x85, r(256)]) }), n: 2 });
C("menus/common Unused_18_TestUnlockFlagById", B18, 0x4564, { regs: r => ({ a: r(256) }), n: 3 });
// the grid walk: a grid of stops with a few skipped cells (never all of a line, so the walk ends; $FC, $FE and
// $FD send it back where it came from on some moves, for ever, on the ROM too)
C("menus/common Unused_18_MoveGridCursor", B18, 0x45CA, {
  regs: r => ({ b: pick(r, [0x10, 0x20, 0x40, 0x80, 0x30]), d: pick(r, [0, 3, 7, 8, 0xFF]), e: pick(r, [0, 2, 3, 4, 0xFF]), hl: 0xC800 }),
  prep: (mem, r) => {
    for (let i = 0; i < 32; i++) w(mem, 0xC800 + i, r(4) ? r(0xF0) : 0xF0);
    for (let k = r(4); k > 0; k--) { const y = r(4), x = 1 + r(6); w(mem, 0xC800 + y * 8 + x, pick(r, [0xFF, 0xFB])); }
  },
});

// ---- the confirm screens of bank $18 (prompts_18.asm) ----
C("menus/common Unused_18_InitPlayerRecordForCharacter", B18, 0x463B, { regs: r => ({ a: r(4), b: r(16) }), n: 3,
  prep: (mem, r) => { wv(mem, "storyCharacterSlot", r(2)); wv(mem, "playerInputFlags", r(2) ? 4 : 0); wv(mem, "debugStepMode", r(2)); } });
C("menus/common Unused_18_InitConfirmScreen", B18, 0x52DE, { wram: 1, n: 4 });
C("menus/common Unused_18_DrawConfirmScreenBox", B18, 0x5365, { wram: 1, n: 3 });
C("menus/common Unused_18_LoadScorePanelValue", B18, 0x5372, { n: 4 });
C("menus/common Unused_18_StubNop_18_1", B18, 0x5379, { n: 10 });
const panelPrep = (mem, r) => { spritePrep(mem, r); for (let i = 0; i < 16; i++) w(mem, at("scorePanelBobStep") + i, r(5)); };
C("menus/common Unused_18_SetupScoreboardDisplay", B18, 0x537A, { wram: 1, prep: panelPrep, n: 2 });
C("menus/common Unused_18_DrawScoreNumbersTask", B18, 0x53B3, { prep: panelPrep, n: 2 });
C("menus/common Unused_18_GetTextSlotPointer", B18, 0x53E4, { n: 2 });
C("menus/common Unused_18_ForceFlushBgMapToVram", B18, 0x5418, { n: 3 });
C("menus/common Unused_18_DrawDecimalNumberSprites", B18, 0x54B1, { regs: r => ({ a: r(5), hl: r(0x10000) }), prep: panelPrep, n: 2 });
C("menus/common Unused_18_DrawStringSprites", B18, 0x54D2, { regs: () => ({ hl: 0xC800 }), n: 2,
  prep: (mem, r) => { panelPrep(mem, r); for (let i = 0; i < 8; i++) w(mem, 0xC800 + i, i === 7 ? 0 : 0x20 + r(0x30)); } });
C("menus/common Unused_18_DrawGlyphSprite", B18, 0x54DC, { regs: r => ({ a: 0x20 + r(0x40) }), prep: panelPrep, n: 2 });
C("menus/common Unused_18_DrawThreeOptionLabels", B18, 0x5527, { wram: 1, n: 3 });
C("menus/common Unused_18_DrawYesNoLabels", B18, 0x5561, { wram: 1, n: 3 });
C("menus/common Unused_18_DrawTileBlock6x2ToTilemap", B18, 0x5586, { regs: r => ({ hl: 0xC800 + r(0x200), de: 0xCA00 + r(0x200) }), n: 2 });

export const ROUTINES = ENTRIES;
