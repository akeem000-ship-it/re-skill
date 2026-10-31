// The developer's boot menu and what it starts (not reachable in the retail game: GameMain jumps over DebugBootMenu
// 01:40A6 with `jp $41A6` at 01:40A3; the screen cases `boot_kid_debugboot_*` let the core fall through to it, a
// test's patch, and set w.debugBoot on the native side; REVERSE.md "Debug code").
import * as D from "./render/display.js";
import * as Scr from "./screen.js";
import * as St from "./start.js";
import { rb } from "./rom.js";
import { printString, printDecimalByte } from "./match.js";
import { printDecimalWord } from "./render/behind.js";
import { advanceRandomSeed, initWindowSystem } from "./round.js";
import { saveLoad, saveBlockLoad, saveBlockStore, buildClubTable } from "./save.js";
import { staffCredits } from "./ending.js";
import { nameEntryScreen } from "./nameentry.js";

const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}
const str = (bank, a) => { const s = []; for (let c; (c = rb(bank, a)); a++) s.push(c); s.push(0); return s; };
const print = (w, bank, a, de) => printString(w, str(bank, a), de >> 8, de & 0xFF);
const setFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] |= 0x80 >> (n & 7); };   // rst $20 (00:2D2E)
const sext = l => (l & 0x80 ? 0xFF00 | l : l);   // 02:4E78 SignExtendL

// 01:40A6 DebugBootMenu: hDebugMode 1; the build stamp (00:0153) at (5, $11); hDebugMode 3, a frame; then for $B4
// frames (a frame each, 01:4199) hJoyRepeat picks: Up: hDebugMode 2 then 3, a number 0-3 (Right / Left, sound $5B; at
// (9, 9), the string 01:5160 at (7, 2)) until A (sound $5C): hDebugMode 1, it as $C810, the staff roll 41:7E07,
// 42:4008 (ret), then a hang (jr $); Start: on to the game; Down: the character editor 02:6176 (it never returns:
// the picture loop after it, 40:6666 / 40:66B5, is not reached); A: hDebugMode 1, GolfDebugEntry 10:4415 (it never
// returns); Right / B: hDebugMode 1, map $01 / $23 entrance 1 and MapEngine 0A:498C (returns "map": the caller goes
// on to the map engine without GameMainStart's map 0); Select: the sound test 01:516E (it never returns). Left does
// nothing. Then (01:41A2) hDebugMode 1 and GameMainStart.
export function* debugBootMenu(sh) {
  const w = sh.w;
  w.high[0x19E] = 1;
  print(w, 0x00, 0x0153, 0x0511);
  w.high[0x19E] = 3;
  yield* sh.advance();
  for (let bc = 0xB4; bc; bc = (bc - 1) & 0xFFFF) {
    const a = w.high[0x191];
    if (a & 0x40) {
      w.high[0x19E] = 2; w.high[0x19E] = 3;
      let b = bc >> 8;                           // (b of the frame count: 0)
      for (;;) {
        printDecimalByte(w, b, 0x0909);
        print(w, 0x01, 0x5160, 0x0207);
        yield* sh.advance();
        const j = w.high[0x191];
        if (j & 0x10) { b = (b + 1) & 3; sh.sound(0x5B); continue; }
        if (j & 0x20) { b = (b - 1) & 3; sh.sound(0x5B); continue; }
        if (j & 0x01) { sh.sound(0x5C); break; }
      }
      w.high[0x19E] = 1;
      wr(w, 0xC810, b);
      yield* inBankGen(w, 0x41, staffCredits(sh));
      throw new Error("01:411B DebugBootMenu: hangs (jr $) after the staff roll (42:4008 is a ret)");
    }
    if (a & 0x08) break;
    if (a & 0x80) { yield* inBankGen(w, 0x02, debugCharacterEditor(sh)); throw new Error("02:6176 returned"); }
    if (a & 0x01) { w.high[0x19E] = 1; yield* inBankGen(w, 0x10, golfDebugEntry(sh)); }
    if (a & 0x10) { w.high[0x19E] = 1; wr(w, 0xC450, 0x01); wr(w, 0xC46A, 0x01); return "map"; }
    if (a & 0x02) { w.high[0x19E] = 1; wr(w, 0xC450, 0x23); wr(w, 0xC46A, 0x01); return "map"; }
    if (a & 0x04) yield* debugSoundTest(sh);
    yield* sh.advance();
  }
  w.high[0x19E] = 1;
  return null;
}

// a number picker of DebugBootMenuCont 01:516E and DebugHoleSelect 10:7BAC: Up / Down switch between d and e
// (b); Right / Left step the chosen one, wrapped by `wrapD` / `wrapE`; the marks (bank `bank`'s strings m0 / m1,
// the one at row 9 marks the chosen) and both numbers ((14, $0A), (14, $0C))
function pickerStep(w, s, bank, m0, m1, wrapD, wrapE) {
  const a = w.high[0x191];
  if (a & 0xC0) s.b ^= 1;
  if (!s.b) {
    if (a & 0x10) s.d = wrapD((s.d + 1) & 0xFF);
    else if (a & 0x20) s.d = wrapD((s.d - 1) & 0xFF);
  } else if (a & 0x10) s.e = wrapE((s.e + 1) & 0xFF);
  else if (a & 0x20) s.e = wrapE((s.e - 1) & 0xFF);
  print(w, bank, m0, s.b ? 0x0C0B : 0x0C09);
  print(w, bank, m1, s.b ? 0x0C09 : 0x0C0B);
  printDecimalByte(w, s.d, 0x0E0A);
  printDecimalByte(w, s.e, 0x0E0C);
}
// 01:516E DebugBootMenuCont (the sound test): d = wCourse, e = wHoleNumber, hDebugMode 3; the labels 01:5267 /
// 01:526D at (13, 9) / (13, $0B); every frame the picker (d, e: 0 becomes $7F, past $7F 0; the marks 01:5274 /
// 01:5276) and A plays sound d (b = 0) or e + $40 (PlaySoundManaged 00:2C19). It never returns
function* debugSoundTest(sh) {
  const w = sh.w;
  const s = { d: rd(w, 0xC836), e: rd(w, 0xC837), b: 0 };
  w.high[0x19E] = 3;
  print(w, 0x01, 0x5267, 0x0D09);
  print(w, 0x01, 0x526D, 0x0D0B);
  const wrap = v => (!v ? 0x7F : v <= 0x7F ? v : 0);
  for (;;) {
    yield* sh.advance();
    pickerStep(w, s, 0x01, 0x5274, 0x5276, wrap, wrap);
    if (w.high[0x191] & 0x01) sh.sound(s.b & 1 ? (s.e + 0x40) & 0xFF : s.d);
  }
}

// 10:7BAC DebugHoleSelect: flag #75; d = wCourse, e = wHoleNumber; hDebugMode 3 (restored after); the labels 10:7C9B
// / 10:7CA2 at (13, 9) / (13, $0B); every frame the picker (d 0-$0A: below 0 $0A, past $0A 0; e: 0 becomes $12, past
// $12 1; the marks 10:7CA7 / 10:7CA9), then A: d and e as the course and hole; else AdvanceRandomSeed 00:0A61
function* debugHoleSelect(sh) {
  const w = sh.w;
  setFlag(w, 75);
  const s = { d: rd(w, 0xC836), e: rd(w, 0xC837), b: 0 };
  const old = w.high[0x19E];
  w.high[0x19E] = 3;
  print(w, 0x10, 0x7C9B, 0x0D09);
  print(w, 0x10, 0x7CA2, 0x0D0B);
  for (;;) {
    yield* sh.advance();
    pickerStep(w, s, 0x10, 0x7CA7, 0x7CA9, v => (v & 0x80 ? 0x0A : v <= 0x0A ? v : 0), v => (!v ? 0x12 : v <= 0x12 ? v : 1));
    if (w.high[0x191] & 0x01) break;
    advanceRandomSeed(w);
  }
  w.high[0x19E] = old;
  wr(w, 0xC836, s.d); wr(w, 0xC837, s.e);
}
// 10:4415 GolfDebugEntry: NewGame 02:4E3D, SaveLoad 02:41F6, save block 0 to $C800 (02:4355), GolfSessionInit
// 10:4B28, wGameMode 3, no save slot ($C2A5 = $0F), $C893 / $C8D3 = 0; then forever: WRAM6, course 1 hole 1 (wind 0,
// 10:423B), the hole select 10:7BAC, GolfRound 10:4451 of 18 holes
function* golfDebugEntry(sh) {
  const w = sh.w;
  St.newGame(w);
  saveLoad(w);
  saveBlockLoad(w, 0, 0xC800);
  St.golfSessionInit(w);
  wr(w, 0xC834, 0x03);
  wr(w, 0xC2A5, 0x0F);
  wr(w, 0xC893, 0x00);
  wr(w, 0xC8D3, 0x00);
  if (!sh.playGolfRound) throw new Error("GolfDebugEntry 10:4415 outside the game loop is not ported");
  for (;;) {
    setW(w, 6);
    St.setCourseHole(w, 0x00, 0x01, 0x01);
    yield* debugHoleSelect(sh);
    yield* sh.playGolfRound(0x12);
  }
}

// 02:6176 DebugCharacterEditor: sound 5; WRAM1; hDebugMode 3; the save block $CA80 = 0; LCD off, 06:4EA8 (ret),
// LoadFaceTiles8800 06:5B20 (06:52F0 to VRAM1 $8800, the palettes 06:5B00 as BG 4-7, master copy; VRAM bank 1
// left), LCD on; InitWindowSystem 05:407A; LCD on; fades out and in ($7F); NewGame 02:4E3D; type d = 0. Each pass
// the record's figures as debug text (02:61A7) and +$3E = level & 7; then each frame (and a random step) until a
// button: Up / Left / Right / Down raise stat 0-3 (CharLevelUp 02:4FFA, sound $5B); B: the type d made anew
// (CreateCharacter 02:4E82 with bit 2 clear; bit 2 set: $C811 = 1) and the name entry 06:51DC (hDebugMode 1 meanwhile);
// A: the next type (d + 1 & 7) made; Select: the save block 0-2 (sound $39); Start: sound $5C, the jingle waited
// for, "SAVING", five random bytes $C80B-$C80F, 02:6392 -> $C94E (14), BuildClubTable 02:51F6, MapSaveReturnPoint
// 0A:4D5B ($FFFF), WRAM1 $D000 = 02:63A0 ($18), the record stored as that block (02:429B), 10 frames, the line
// blanked. It never returns
export function* debugCharacterEditor(sh) {
  const w = sh.w;
  sh.sound(0x05);
  setW(w, 1);
  w.high[0x19E] = 3;
  wr(w, 0xCA80, 0);
  if (w.vram) D.disableLCDSafely(w);
  D.inBank(w, 0x06, () => {                      // 06:5B20 LoadFaceTiles8800
    if (w.vram) { w.lcd.vbk = 1; D.startVRAMDMAFromHL(w, 0x52F0, 0x8800, 0x80); }
    D.loadPalettesMasterOnly(w, 0x5B00, 0x04, 0x04);
  });
  if (w.vram) D.enableLCD(w);
  yield* inBankGen(w, 0x05, initWindowSystem(sh));
  if (w.vram) D.enableLCD(w);
  Scr.beginFadeOut(w, 0x7F);
  Scr.beginFadeIn(w, 0x7F);
  St.newGame(w);
  let d = 0;
  for (;;) {
    const r = k => rd(w, 0xC800 + k);
    for (const [k, de] of [[0x10, 0x0204], [0x18, 0x0206], [0x12, 0x0205], [0x11, 0x0207], [0x20, 0x0704]]) printDecimalByte(w, r(k), de);
    printDecimalWord(w, r(0x1A) | r(0x1B) << 8, 0x0C, 0x04);
    printDecimalByte(w, r(0x21), 0x0705);
    printDecimalWord(w, sext(r(0x1C)), 0x0C, 0x05);
    printDecimalByte(w, r(0x22), 0x0706);
    printDecimalWord(w, sext(r(0x1D)), 0x0C, 0x06);
    printDecimalByte(w, r(0x24), 0x0707);
    printDecimalWord(w, sext(r(0x1F)), 0x0C, 0x07);
    printDecimalWord(w, sext(r(0x1E)), 0x0C, 0x08);
    printDecimalByte(w, rd(w, 0xCA80), 0x020A);
    wr(w, 0xC83E, r(0x12) & 0x07);
    let a;
    for (;;) {
      yield* sh.advance();
      advanceRandomSeed(w);
      a = w.high[0x191];
      if (a & 0xFF) break;
    }
    const stat = [[0x40, 0], [0x20, 1], [0x10, 2], [0x80, 3]].find(([m]) => a & m);
    if (stat) { St.charLevelUp(w, stat[1]); sh.sound(0x5B); continue; }
    if (a & 0x02) {
      St.createCharacter(w, d & ~4);
      if (d & 4) wr(w, 0xC811, 1);
      w.high[0x19E] = 1;
      yield* inBankGen(w, 0x06, nameEntryScreen(sh));
      w.high[0x19E] = 3;
      continue;
    }
    if (a & 0x01) {
      d = (d + 1) & 7;
      St.createCharacter(w, d & ~4);
      if (d & 4) wr(w, 0xC811, 1);
      continue;
    }
    if (a & 0x04) {
      sh.sound(0x39);
      let v = (rd(w, 0xCA80) + 1) & 0xFF;
      if (v >= 3) v = 0;
      wr(w, 0xCA80, v);
      continue;
    }
    // (a & 0x08: Start)
    sh.sound(0x5C);
    yield* Scr.waitJingleEnd(sh);
    print(w, 0x02, 0x6384, 0x020B);
    for (let k = 0x0B; k <= 0x0F; k++) wr(w, 0xC800 + k, advanceRandomSeed(w) >> 8);
    D.copyMemoryBC(w, 0x6392, 0xC94E, 0x0E);
    buildClubTable(w);
    St.mapSaveReturnPoint(w);
    setW(w, 1);
    D.copyMemoryBC(w, 0x63A0, 0xD000, 0x18);
    saveBlockStore(w, rd(w, 0xCA80), 0xC800, 0xD000);
    yield* sh.advance(0x0A);
    print(w, 0x02, 0x638B, 0x020B);
  }
}
