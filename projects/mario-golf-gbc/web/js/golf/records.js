// The link menu's Status (item 2, 32:54EC -> ModeSelectMenuLoop 0B:4D9D) and the records: bank 07's menus (MainMenu
// 07:4006, MenuFiveItems 07:51A6, MenuFourItems 07:63EC: bank 09's menu engine at other addresses, menu09.js
// MENU07), the loop and its two submenus of bank 0B, and the records queries of bank 0B (exports $28-$42) over the
// records block (save block 3, loaded to WRAM6 $DC00 by LoadRecordsBlock: $32 bytes per course record) that the
// screens of bank 0C (records0c.js) read.
import { rb } from "./rom.js";
import * as D from "./render/display.js";
import * as Scr from "./screen.js";
import * as Sv from "./save.js";
import { menuScreenInit, menuSelect, MENU07 } from "./menu09.js";
import { characterSelectScreen, resetCharSelectCursor } from "./charsel.js";
import { buildSaveSlotList } from "./modesel.js";
import { charDataScreen } from "./levelup.js";
import { eventListScreen } from "./nav.js";
import { printHexByte } from "./match.js";
import * as St from "./start.js";
import * as R0C from "./records0c.js";
import { decompressDataFromBank } from "./mapgfx.js";

const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
const wbank = w => w.high[0x196];
const flag = (w, n) => w.wram[0][0x840 + (n >> 3)] & (0x80 >> (n & 7));
function notPorted(what) { throw new Error(`${what} is not ported`); }
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}
// 00:2B54 ResumeBGM: hSoundFlags bit 0 set: cleared, wCurrentBGM played again
function resumeBGM(sh) {
  const w = sh.w;
  if (w.high[0x1CE] & 1) { w.high[0x1CE] &= 0xFE; sh.sound(rd(w, 0xC33E)); }
}

// ---- the records queries (bank 0B; each keeps the WRAM bank) ----
const r6 = (w, a) => w.wram[6][(a - 0xD000) & 0xFFF];
const keep = (w, fn) => { const old = wbank(w); try { return fn(); } finally { setW(w, old); } };

// 0B:4FB7 LoadRecordsBlock: SaveLoad (anything but a clean load is an error), then block 3 to WRAM6 $DC00; 0 or $FF
export function loadRecordsBlock(w) {
  return keep(w, () => {
    if (Sv.saveLoad(w)) return 0xFF;             // 02:41F6
    setW(w, 6);
    return Sv.saveBlockLoad(w, 3, 0xDC00) ? 0xFF : 0;   // 02:4355
  });
}
// 0B:4FE5 RecordsSelect: wRecordPtr $D224 = $DC00 + b x $32 (WRAM6); returns hl (de the same)
export function recordsSelect(w, b) {
  return keep(w, () => {
    setW(w, 6);
    const hl = (b * 0x32 + 0xDC00) & 0xFFFF;
    wr(w, 0xD224, hl & 0xFF); wr(w, 0xD225, hl >> 8);
    return hl;
  });
}
// 0B:5009 RecordsGridBit: b, c clamped to 0-5 (bit 7: 0); the word at $DC00 + $15F + b: [the bits set in its low 6,
// bit c of it]
export function recordsGridBit(w, b, c) {
  return keep(w, () => {
    setW(w, 6);
    b = b & 0x80 ? 0 : b >= 6 ? 5 : b;
    c = c & 0x80 ? 0 : c >= 6 ? 5 : c;
    const p = (0xDC00 + 0x15F + b) & 0xFFFF;
    const hl = rd(w, p) | rd(w, (p + 1) & 0xFFFF) << 8;
    let n = 0;
    for (let k = 0, a = hl & 0xFF; k < 6; k++, a >>= 1) if (a & 1) n++;
    return [n, (hl >> c) & 1];
  });
}
// 0B:506E RecordsFirstBit: wRecordResult $D226 = 1-6, the lowest set bit of $DC00 + $15E (none: what is left of the
// byte after six shifts, 0 or capped at 6)
export function recordsFirstBit(w) {
  keep(w, () => {
    setW(w, 6);
    let b = rd(w, 0xDD5E), a = 0, d = 1, found = false;
    for (let c = 6; c; c--) { if (b & 1) { a = d; found = true; break; } b >>= 1; d++; }
    if (!found) a = b;
    wr(w, 0xD226, a & 0x80 ? 0 : a >= 6 ? 6 : a);
  });
}
// 0B:50B6 CountFlags112To114: wRecordResult = 1 + the flags #112 #113 #114 #139 set (the clubs won)
export function countFlags112To114(w) {
  keep(w, () => {
    let b = 1;
    for (const n of [112, 113, 114, 139]) if (flag(w, n)) b++;
    setW(w, 6);
    wr(w, 0xD226, b);
  });
}
// 0B:50EB RecordsGridLevel: the grid's bits over rows 0-5 summed; wRecordResult = the level 0-5 (by 4s)
export function recordsGridLevel(w) {
  keep(w, () => {
    setW(w, 6);
    let a = 0;
    for (let c = 0; c < 6; c++) a = (a + recordsGridBit(w, c, c)[0]) & 0xFF;
    let b = 0;
    for (const t of [4, 8, 12, 16, 20]) if (a >= t) b++; else break;
    wr(w, 0xD226, b);
  });
}
// 0B:5133 RecordsTestBits: b, c index the table 0B:5209 (17 field numbers); the 4-byte entry of field [b] at
// $DC00 + $166: bit [c] of its second word set -> 2, else bit [c] of its first word; returns [a (the WRAM bank it
// restored: the pop af), b (the shifted byte), c]
export function recordsTestBits(w, b, c) {
  const old = wbank(w);
  setW(w, 6);
  const t = a => rb(0x0B, a & 0xFFFF);
  const base = 0xDD66 + ((t(0x5209 + b) << 2) & 0xFFFF);
  const w0 = rd(w, base) | rd(w, base + 1) << 8, w1 = rd(w, base + 2) | rd(w, base + 3) << 8;
  const bitOf = (word, n) => {
    let a = n, x;
    if (a < 8) x = word & 0xFF; else { a = (a + 0xF8) & 0xFF; x = word >> 8; }
    if (a & 0x80) a = 0;
    for (; a; a--) x >>= 1;
    return x;
  };
  const n = t(0x5209 + c);
  let x = bitOf(w1, n), r;
  if (x & 1) r = 2;
  else { x = bitOf(w0, n); r = x & 1; }
  setW(w, old);
  return [old, x, r];
}
// 0B:51B9 RecordsReadField: field c (0B:51F7[c] + $0E) of course record b (RecordsSelect), wRecordPtr read in the
// mapped WRAM bank
export function recordsReadField(w, b, c) {
  const old = wbank(w);
  const off = (rb(0x0B, (0x51F7 + c) & 0xFFFF) + 0x0E) & 0xFF;
  recordsSelect(w, b);
  let hl = rd(w, 0xD224) | rd(w, 0xD225) << 8;
  hl = (hl + off) & 0xFFFF;
  const a = rd(w, hl);
  setW(w, old);
  return a;
}
// 0B:51E7 RecordsFieldIndex: 0B:521B[c]
export const recordsFieldIndex = c => rb(0x0B, (0x521B + c) & 0xFFFF);
// 0B:522D RecordsEntryAddr: $DC00 + b x $32 + (5 c & $FF) + $20
export const recordsEntryAddr = (b, c) => (0xDC00 + b * 0x32 + ((c * 5) & 0xFF) + 0x20) & 0xFFFF;
// 0B:5260 LoadSaveBlockByte0B: block 4 + c (a saved hole) to WRAM6 $DC00; its byte $0B, $FF when it does not load
export function loadSaveBlockByte0B(w, c) {
  return keep(w, () => {
    setW(w, 6);
    if (Sv.saveBlockLoad(w, (4 + c) & 0xFF, 0xDC00)) return 0xFF;
    setW(w, 6);
    return rd(w, 0xDC0B);
  });
}
// 0B:5296 RecordsSlotId: the byte at $DC00 + c x $80 + $10 (WRAM6) when below $0B, else $FF
export function recordsSlotId(w, c) {
  const a = r6(w, 0xDC10 + c * 0x80);
  return a & 0x80 || a >= 0x0B ? 0xFF : a;
}
// 0B:52D2 RecordsSlotWord: [b, c] = the bytes at $DC00 + c x $80 + $20
export const recordsSlotWord = (w, c) => [r6(w, 0xDC20 + c * 0x80), r6(w, 0xDC21 + c * 0x80)];
// 0B:5303 RecordsHoleBit: c = hole 0-17 (clamped); the 18 bits at [wRecordPtr] + $2F: [the bits set, the hole's]
export function recordsHoleBit(w, c) {
  return keep(w, () => {
    setW(w, 6);
    c = c & 0x80 ? 0 : c >= 0x12 ? 0x11 : c;
    const ptr = rd(w, 0xD224) | rd(w, 0xD225) << 8;
    const hl = ((ptr & 0xFF00) + (((ptr & 0xFF) + 0x2F))) & 0xFFFF;
    let b = 0;
    for (let k = 0; k < 2; k++) for (let a = rd(w, hl + k); a; a >>= 1) if (a & 1) b++;
    const a3 = rd(w, hl + 2) >> 6;
    if (a3 & 1) b++;
    if (a3 & 2) b++;
    const p = c >= 0x10 ? hl + 2 : c >= 8 ? hl + 1 : hl;
    const sh = 7 - (c & 7);
    return [b & 0xFF, (rd(w, p & 0xFFFF) >> sh) & 1];
  });
}

// ---- the menus ----
// 07:4006 MainMenu: the records loaded (0B:4FB7): the menu 07:4040 (3 items: Character, Shots, Records) or without
// them 07:406A (2); the cursor wMainMenuCursor $CABB (kept unless B); fades in, not out
export function* mainMenu(sh) {
  const w = sh.w;
  const ok = !loadRecordsBlock(w);
  w.high[0x18A] = w.high[0x18B] = 0;
  menuScreenInit(w, ok ? 0x4040 : 0x406A, ok ? 3 : 2, 0x01, 0x00, MENU07);   // 07:741E MenuScreenInit
  Scr.beginFadeIn(w, 0x10);
  yield* Scr.waitFade(sh);
  setW(w, 6);
  const a = yield* menuSelect(sh, rd(w, 0xCABB), MENU07);   // 07:7C00 MenuSelect
  if (!(a & 0x80)) wr(w, 0xCABB, a);
  return a;
}
// 07:51A6 MenuFiveItems (menu 07:51DC from slot 0, cursor $CABC) / 07:63EC MenuFourItems (menu 07:6422 from slot 1,
// cursor $CABD): fade in, the choice, fade out
function* menuItems(sh, hl, d, e, cur) {
  const w = sh.w;
  w.high[0x18A] = w.high[0x18B] = 0;
  menuScreenInit(w, hl, d, e, 0x00, MENU07);
  Scr.beginFadeIn(w, 0x10);
  yield* Scr.waitFade(sh);
  setW(w, 6);
  const a = yield* menuSelect(sh, rd(w, cur), MENU07);
  if (!(a & 0x80)) wr(w, cur, a);
  Scr.beginFadeOut(w, 0x10);
  yield* Scr.waitFade(sh);
  return a;
}
export const menuFiveItems = sh => menuItems(sh, 0x51DC, 0x05, 0x00, 0xCABC);
export const menuFourItems = sh => menuItems(sh, 0x6422, 0x04, 0x01, 0xCABD);

// 0B:4FAC FadeOutWait
function* fadeOutWait(sh) {
  Scr.beginFadeOut(sh.w, 0x10);
  yield* Scr.waitFade(sh);
}
// 0B:4F98 WaitAnyButton: frames until a button is pressed, one more
function* waitAnyButton(sh) {
  do yield* sh.advance(); while (!sh.w.high[0x194]);
  yield* sh.advance();
}
// 0B:4F66 ShowSaveMessageAndWait: the message picture (refs $4C:38 / $4C:36, WRAM1) queued to the BG rows at $9982
// (and its attributes), then any button
function* showSaveMessageAndWait(sh) {
  const w = sh.w;
  setW(w, 1);
  decompressDataFromBank(w, 0x4C38, 0xD000);
  decompressDataFromBank(w, 0x4C36, 0xD080);
  D.queueVRAMCopy(w, 0xD000, 0xB982, 0x08);
  D.queueVRAMCopy(w, 0xD080, 0x9982, 0x08);
  yield* waitAnyButton(sh);
}
// 0B:4E48 LoadRecordsOrError / 0B:4F51 LoadRosterOrError (the slot list at $D658; 0 slots is the error)
function* loadRecordsOrError(sh) {
  const a = loadRecordsBlock(sh.w);
  if (a) yield* showSaveMessageAndWait(sh);
  resumeBGM(sh);
  return a;
}
function* loadRosterOrError(sh) {
  const a = buildSaveSlotList(sh.w, 0xD658);     // 02:5B5B
  if (!a) yield* showSaveMessageAndWait(sh);
  return a;
}

// 0B:4ECA ModeSubmenuA (a character's status): the four-item menu: Char. Data (41:6506 a = b = 1), the character's
// stats (0C:4A15 with wStatsSource $D23B = 1), the VS results (0C:65B2), Stars (0A:6F56); B: the character select
// again (none: back)
function* modeSubmenuA(sh) {
  const w = sh.w, old = wbank(w);
  for (;;) {
    const a = yield* inBankGen(w, 0x07, menuFourItems(sh));
    if (a === 0xFF) {
      yield* sh.advance();
      buildSaveSlotList(w, 0xD658);
      const r = yield* inBankGen(w, 0x06, characterSelectScreen(sh, 0xD658, 0x01));
      if (r === 0xFF) break;
      Sv.saveBlockLoad(w, r, 0xC800);
      resumeBGM(sh);
      yield* sh.advance();
      continue;
    }
    if (a > 3) break;
    yield* sh.advance();
    if (a === 0) { yield* charDataScreen(sh, 0x01, 0x01); sh.sound(0x01); }
    else if (a === 1) { setW(w, 6); wr(w, 0xD23B, 1); yield* inBankGen(w, 0x0C, R0C.statsScreen(sh)); }
    else if (a === 2) yield* inBankGen(w, 0x0C, R0C.vsResultScreen(sh));
    else yield* inBankGen(w, 0x0A, eventListScreen(sh));
  }
  yield* sh.advance();
  setW(w, old);
}
// 0B:4E5D ModeSubmenuB (the records): the five-item menu: the records' stats (0C:4A15 with $D23B = 0, c = 1), best
// scores (0C:6EE0), the winners (0C:5FC5), the ranking (0C:5AEC), the stars (0C:4014); B back
function* modeSubmenuB(sh) {
  const w = sh.w, old = wbank(w);
  for (;;) {
    const a = yield* inBankGen(w, 0x07, menuFiveItems(sh));
    if (a > 4) break;
    yield* sh.advance();
    if (a === 0) { setW(w, 6); wr(w, 0xD23B, 0); yield* inBankGen(w, 0x0C, R0C.statsScreen(sh)); }
    else if (a === 1) yield* inBankGen(w, 0x0C, R0C.bestScoreScreen(sh));
    else if (a === 2) yield* inBankGen(w, 0x0C, R0C.winnersScreen(sh));
    else if (a === 3) yield* inBankGen(w, 0x0C, R0C.rankingScreen(sh));
    else yield* inBankGen(w, 0x0C, R0C.starsScreen(sh));
  }
  yield* sh.advance();
  setW(w, old);
}

// 0B:4D9D ModeSelectMenuLoop (the link menu's Status): MainMenu until B: 0 a character (the slot list, the character
// select, the character loaded with its play clock and SetupPlayerGolfer $80, ModeSubmenuA), 1 the shot records
// (0C:67F8; $FE replays a saved hole: ~10:435E), 2 the records (ModeSubmenuB)
export function* modeSelectMenuLoop(sh) {
  const w = sh.w, old = wbank(w);
  for (;;) {
    const a = yield* inBankGen(w, 0x07, mainMenu(sh));
    printHexByte(w, a, 0x0D0D);                  // 00:22A5 (debug)
    if (a === 0) {
      const n = yield* loadRosterOrError(sh);
      yield* fadeOutWait(sh);
      if (!n) continue;
      yield* sh.advance();
      resetCharSelectCursor(w);
      const r = yield* inBankGen(w, 0x06, characterSelectScreen(sh, 0xD658, 0x01));
      if (r === 0xFF) continue;
      Sv.saveBlockLoad(w, r, 0xC800);
      yield* sh.advance();
      Sv.restoreGameTimer(w);
      St.setupPlayerGolfer(w, 0x80, 0x00);       // 02:4A28
      yield* modeSubmenuA(sh);
    } else if (a === 1) {
      yield* fadeOutWait(sh);
      wr(w, 0xCA7F, 0);                          // wLastShotRecord
      for (;;) {
        yield* sh.advance();
        const [r] = yield* inBankGen(w, 0x0C, R0C.shotRecordsScreen(sh));
        if (r !== 0xFE) break;
        notPorted("replaying a saved hole (~10:435E ReplaySavedHole)");
      }
    } else if (a === 2) {
      const e = yield* loadRecordsOrError(sh);
      yield* fadeOutWait(sh);
      if (e) continue;
      yield* sh.advance();
      yield* modeSubmenuB(sh);
    } else break;
  }
  yield* fadeOutWait(sh);
  setW(w, old);
}
