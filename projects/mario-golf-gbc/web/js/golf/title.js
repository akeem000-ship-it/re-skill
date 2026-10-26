// The title screen (TitleScreen 40:4032, bank 40) and the attract loop before it: the opening picture (IntroPicture
// 40:61CB) and the 16 demo slides (DemoSlide 40:5C72, DemoSlideTable 40:5D9F: a full-screen picture, a setup and a
// frame task each); A or Start skips them. The title: the logo and the golfers' sprite rows (TitleAnimTask
// 40:4D53), "PRESS START" (TitlePressStartTask 40:4D1D), the button code that sets hUnlockAll $FFCF
// (TitleCheatInput 40:4CB6); $4B0 frames without Start or A go back to the attract loop.

// 40:5775 Sqrt24: a:h:l -> hl (12 bits), a = l: a bit-by-bit square root on the complements, h:l first and a as
// the low byte of the second stage (so not the root of a:h:l: only the demo's debug prints use it). 0 -> 0
export function sqrt24(A, HL) {
  const H = HL >> 8, L = HL & 0xFF;
  const d0 = ~A & 0xFF;
  let bc = (~H & 0xFF) << 8 | (~L & 0xFF);
  if (((((~H & 0xFF) & (~L & 0xFF) & d0) + 1) & 0xFF) === 0) return [0, 0];
  // the first 8 bits, 16-bit: (trial, step) pairs
  let de = 0x4000, a = 0;
  const one = (bit, back, fwd) => {
    const sum = de + bc;
    if (sum <= 0xFFFF) { bc = sum; a |= bit; de = (de + fwd) & 0xFFFF; }
    de = ((de + back) & 0xFFFF) >> 1;
  };
  one(0x08, 0xE000, 0x8000); one(0x04, 0xF800, 0x2000); one(0x02, 0xFE00, 0x0800); one(0x01, 0xFF80, 0x0200);
  one(0x80, 0xFFE0, 0x0080); one(0x40, 0xFFF8, 0x0020); one(0x20, 0xFFFE, 0x0008);
  {                                              // the last of them, then the 24-bit stage's set-up
    const sum = de + bc;
    if (sum <= 0xFFFF) { bc = sum; a |= 0x10; de = (de + 2) & 0xFFFF; }
  }
  const s3 = a;
  de >>= 1;                                      // srl d / rr e
  let s0 = de >> 8;                              // the 24-bit trial s0:d:e
  de = (de & 0xFF) << 8 | 0x40;                  // (ld hl, sp+0 clears the carry before rr e)
  let s2 = 0;
  let s1 = bc >> 8;                              // the remainder s1:b:c
  bc = (bc & 0xFF) << 8 | d0;
  for (const [bit, fwd, back] of [[8, 0x60, 0xFFE0], [4, 0x18, 0xFFF8], [2, 0x06, 0xFFFE], [1, 0x02, 0x0000]]) {
    const sum = de + bc, c1 = sum > 0xFFFF ? 1 : 0;
    const t = s0 + s1 + c1;
    if (t <= 0xFF) {
      s1 = t; s2 |= bit; bc = sum & 0xFFFF;
      const n = de + fwd; de = n & 0xFFFF;
      if (n > 0xFFFF) s0 = (s0 + 1) & 0xFF;
    } else {
      const n = de + back; de = n & 0xFFFF;
      if (n <= 0xFFFF) s0 = (s0 - 1) & 0xFF;
    }
    const v = (s0 << 16 | de) >>> 1;             // srl [sp+0] / rr d / rr e
    s0 = v >> 16; de = v & 0xFFFF;
  }
  const h = s3 & 0x0F, l = (s3 & 0xF0) | s2;
  return [l, h << 8 | l];
}

import { rb, rw } from "./rom.js";
import * as D from "./render/display.js";
import * as Scr from "./screen.js";
import { clearFrameTasks, registerFrameTask, unregisterFrameTask } from "./tasks.js";
import { advanceRandomSeed } from "./round.js";
import { printHexByte } from "./match.js";
import { initFontScreen } from "./pictures.js";
import { closeMessageWindow } from "./windows.js";

const B = 0x40;
const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
function notPorted(what) { throw new Error(`${what} is not ported`); }
const linkPartnerSkips = w => rd(w, 0xCB40) === 0x10;   // wSerialRecvBuf: the link partner pressed Start

// 40:6217 DemoCheckSkip: true while Start or A is held (the link partner's $10: not ported)
function demoCheckSkip(w) {
  if (linkPartnerSkips(w)) notPorted("the link partner's skip (~00:3081 SerialSendBlock)");
  return !!(w.high[0x190] & 9);
}
// 40:6238 IntroCheckSkip: as DemoCheckSkip, but it never skips (its xor a: z in every case)
function introCheckSkip(w) {
  if (linkPartnerSkips(w)) notPorted("the link partner's skip (~00:3081 SerialSendBlock)");
  return false;
}

// 40:5C62 WaitFadeOrSkip: frames until the fade ends; true when skipped
function* waitFadeOrSkip(sh) {
  const w = sh.w;
  while (w.high[0x1A2]) {
    yield* sh.advance();
    if (demoCheckSkip(w)) return true;
  }
  return false;
}

// 40:664B PictureScreenInit: frame tasks cleared, WRAM1, LCD off, sprites reset, window off (WY $90), scroll 0
function pictureScreenInit(w) {
  clearFrameTasks(w);
  setW(w, 1);
  D.disableLCDSafely(w);
  D.resetSprites(w);
  w.lcd.wy = 0x90;
  w.high[0x18B] = w.high[0x18A] = 0;
}

// 40:5BF9 LoadFullScreenPicture: hl = (bank, list index): entry 0 the BG palettes (master copies), 1 the tiles
// ($9000 and $8800 of VRAM1), 2 the attributes, 3 the tile map; LCD on
function loadFullScreenPicture(w, hl) {
  setW(w, 1);
  D.farCopyFastIndexed(w, hl, 0, 0xD000, 4);    // 00:0749
  D.loadPalettesMasterOnly(w, 0xD000, 0x00, 0x08);
  D.farDispatchIndexed(w, hl, 1, 0xD000);       // 00:069A
  D.queueVRAMCopy(w, 0xD000, 0xB000, 0x80);
  D.queueAndRunVRAMCopy(w, 0xD800, 0xA800, 0x80);
  D.farDispatchIndexed(w, hl, 2, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xB800, 0x40);
  D.farDispatchIndexed(w, hl, 3, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0x9800, 0x40);
  D.enableLCD(w);
}

// 40:61CB IntroPicture: the opening picture (40:4908) with sound $5E: 60 frames, SCY $80 for 60 more, fade out;
// true when skipped (only the fade-out can be)
function* introPicture(sh) {
  const w = sh.w;
  pictureScreenInit(w);
  loadFullScreenPicture(w, 0x4908);
  Scr.forceFadeIn(w, 0x7F);
  sh.sound(0x5E);
  let skip = false;
  for (let c = 0x3C; c && !skip; c--) { yield* sh.advance(); skip = introCheckSkip(w); }
  if (!skip) {
    w.high[0x18A] = 0x80;
    for (let c = 0x3C; c && !skip; c--) { yield* sh.advance(); skip = introCheckSkip(w); }
  }
  if (!skip) {
    Scr.beginFadeOut(w, 0x08);
    if (!(yield* waitFadeOrSkip(sh))) return false;
  }
  w.high[0x18A] = 0x80;
  Scr.beginFadeOut(w, 0x10);
  yield* Scr.waitFade(sh);
  return true;
}

// ---- the demo slides: DemoSlideTable 40:5D9F, 8 bytes each: frames, frame task, setup, picture list ----
const SETUPS = {                                 // the setups (all in bank 40; WRAM6 $D247 / $D248 the scroll)
  0x5E2C: () => {},                              // 40:5E2C DemoSetupNone
  0x5E2D: w => { setW(w, 6); wr(w, 0xD247, 0x78); wr(w, 0xD248, 0); },   // 40:5E2D DemoSetupPanLeft
  0x5E50: w => { setW(w, 6); wr(w, 0xD247, 0); wr(w, 0xD248, 0); },      // 40:5E50 DemoSetupOrigin
  0x5E66: w => { setW(w, 6); wr(w, 0xD247, 0xEC); wr(w, 0xD248, 0); },   // 40:5E66 DemoSetupPanRight
  0x5E8A: w => {                                 // 40:5E8A DemoSetupDiagonal
    setW(w, 6); wr(w, 0xD247, 0x70); w.high[0x18B] = 0x70; wr(w, 0xD248, 0x70); w.high[0x18A] = 0x70;
  },
  0x5EC0: w => { setW(w, 6); wr(w, 0xD247, 0x28); wr(w, 0xD248, 0x28); },   // 40:5EC0 (and 00:0684 DisableOAMDMA)
  0x5EEE: w => { setW(w, 6); wr(w, 0xD247, 0); wr(w, 0xD248, 0); },      // 40:5EEE DemoSetupZero
  0x6143: w => {                                 // 40:6143 DemoSetupWindow: the window slides in from WX $78
    setW(w, 6); wr(w, 0xD247, 0x78); wr(w, 0xD248, 0x48);
    w.lcd.wy = 0x48;
    wr(w, 0xD24B, 0x78);
    registerFrameTask(w, 0x01, B, 0x5E26);       // DemoWindowXTask
    w.lcd.lcdc &= 0xBF;
  },
  0x6194: w => {                                 // 40:6194 DemoSetupReset
    setW(w, 6); wr(w, 0xD247, 0); w.high[0x18B] = 0; wr(w, 0xD248, 0); w.high[0x18A] = 0;
  },
};

// the demo's frame tasks (registered in bank 40)
export const demoTasks = w => ({
  "40:5e1f": () => setW(w, 6),                   // 40:5E1F DemoTaskNone
  "40:5e26": () => { w.lcd.wx = rd(w, 0xD24B); },   // 40:5E26 DemoWindowXTask (the mapped WRAM bank's $D24B)
  "40:5e3d": () => {                             // 40:5E3D DemoTaskPanLeft
    setW(w, 6);
    const a = rd(w, 0xD247);
    if (a) { wr(w, 0xD247, (a - 6) & 0xFF); w.high[0x18B] = (a - 6) & 0xFF; }
  },
  "40:5e5f": () => setW(w, 6),                   // 40:5E5F DemoTaskStatic
  "40:5e76": () => {                             // 40:5E76 DemoTaskPanRight
    setW(w, 6);
    const a = rd(w, 0xD247);
    if (a !== 0x58) { wr(w, 0xD247, (a + 6) & 0xFF); w.high[0x18B] = (a + 6) & 0xFF; }
  },
  "40:5e9f": () => {                             // 40:5E9F DemoTaskDiagonalLate
    setW(w, 6);
    if (rd(w, 0xD24C) < 0x3C) return;
    diagonalStep(w);
  },
  "40:5ed4": () => { setW(w, 6); diagonalStep(w); },   // 40:5ED4 DemoTaskDiagonal
  "40:5f11": () => demoTaskAnimFrames(w),        // 40:5F11
  "40:616b": () => {                             // 40:616B DemoTaskWindowSlide
    setW(w, 6);
    const x = rd(w, 0xD24B) - 6;
    if (x >= 0) wr(w, 0xD24B, x < 7 ? 7 : x);
    const a = rd(w, 0xD247);
    if (a) { wr(w, 0xD247, (a - 6) & 0xFF); w.high[0x18B] = (a - 6) & 0xFF; }
    w.high[0x18A] = rd(w, 0xD248);
  },
  "40:61a9": () => {},                           // 40:61A9 DemoTaskNoneB
  "40:4d53": () => titleAnimTask(w),             // 40:4D53
  "40:4d1d": () => D.queueSpriteTemplate(w, 0x4D2A, 0x54, 0x18, 0x00, 0x09),   // 40:4D1D TitlePressStartTask
});
function diagonalStep(w) {                       // (40:5EDA-40:5EEB): x and y down by 1 until x is 0
  const a = rd(w, 0xD247);
  if (!a) return;
  wr(w, 0xD247, a - 1); w.high[0x18B] = a - 1;
  const y = (rd(w, 0xD248) - 1) & 0xFF;
  wr(w, 0xD248, y); w.high[0x18A] = y;
}

// 40:5F11 DemoTaskAnimFrames: at given frames of wDemoFrame $D24C, new tiles or map rows of picture list 79:06
// queued (the list's entries LZ-decompressed to WRAM1 each time); sound $A5 at frame $70
const ANIM_TILES = { 0x32: [0xD000, 0x9000, 0xD800, 0x8800], 0x33: [0xD200, 0x9200, 0xDA00, 0x8A00],
  0x34: [0xD400, 0x9400, 0xDC00, 0x8C00], 0x35: [0xD600, 0x9600, 0xDE00, 0x8E00] };
const ANIM_MAPS = { 0x3C: [0xD000, 0xD6C0], 0x41: [0xD120, 0xD7E0], 0x69: [0xD240, 0xD900], 0x6E: [0xD360, 0xDA20],
  0x73: [0xD480, 0xDB40], 0x70: [0xD5A0, 0xDD80] };
function demoTaskAnimFrames(w) {
  setW(w, 6);
  const f = rd(w, 0xD24C);
  if (ANIM_TILES[f]) {
    const [s1, d1, s2, d2] = ANIM_TILES[f];
    setW(w, 1);
    D.farDispatchIndexed(w, 0x7906, 1, 0xD000);
    D.queueVRAMCopy(w, s1, d1, 0x20);
    D.queueVRAMCopy(w, s2, d2, 0x20);
  } else if (ANIM_MAPS[f]) {
    const [attr, map] = ANIM_MAPS[f];
    if (f === 0x70) sh0(w, 0xA5);
    setW(w, 1);
    D.farDispatchIndexed(w, 0x7906, 2, 0xD000);
    D.queueVRAMCopy(w, attr, 0xB8C0, 0x12);
    D.farDispatchIndexed(w, 0x7906, 3, f === 0x70 ? 0xD7E0 : 0xD6C0);
    D.queueVRAMCopy(w, map, 0x98C0, 0x12);
  }
  setW(w, 6);
}
const sh0 = (w, id) => w.sh.sound(id);           // (a frame task's rst $08)

// 40:5C72 DemoSlide: slide a: its picture (or a blank screen), its setup, its frame task (wDemoTask $D24D), a fade
// in, then its frames (wDemoFrame $D24C counts; the debug prints of hVBlankCount, rDIV, the frame and 40:5775 Sqrt24
// of the three go to the debug text buffer), 05:5F46 CloseMessageWindow, a white fade out; true when skipped
function* demoSlide(sh, a) {
  const w = sh.w;
  pictureScreenInit(w);
  const e = (0x5D9F + a * 8) & 0xFFFF;
  const count = rw(B, e), task = rw(B, e + 2), setup = rw(B, e + 4), pics = rw(B, e + 6);
  if (pics) loadFullScreenPicture(w, pics);
  else {
    setW(w, 1);
    D.clearMemoryBC16(w, 0xD000, 0x40);
    D.queueAndRunVRAMCopy(w, 0xD000, 0xB800, 0x40);
    D.clearMemoryBC16(w, 0xD000, 0x40);
    D.queueAndRunVRAMCopy(w, 0xD000, 0x9800, 0x40);
  }
  if (!SETUPS[setup]) notPorted(`the demo setup ~40:${setup.toString(16)}`);
  SETUPS[setup](w);                              // (00:0699 JumpToHL)
  setW(w, 6);
  wr(w, 0xD24C, 0);
  D.enableLCD(w);
  setW(w, 6);
  wr(w, 0xD24D, task >> 8); wr(w, 0xD24E, task & 0xFF);
  registerFrameTask(w, 0x01, B, task);
  Scr.beginFadeIn(w, 0x10);
  let skip = yield* waitFadeOrSkip(sh);
  for (let bc = count; !skip; ) {
    setW(w, 6);
    const v = w.high[0x18C];
    printHexByte(w, v, 0x0503);                  // (debug prints: 00:22A5)
    const div = w.readDIV ? w.readDIV() : 0;     // rDIV: the hardware's divider (a test can give the game's)
    printHexByte(w, div, 0x0504);
    const f = rd(w, 0xD24C);
    printHexByte(w, f, 0x0505);
    const [ra, hl] = sqrt24(f, v << 8 | div);
    printHexByte(w, hl >> 8, 0x0508);
    printHexByte(w, hl & 0xFF, 0x0509);
    printHexByte(w, ra, 0x050A);
    yield* sh.advance();
    if (demoCheckSkip(w)) { skip = true; break; }
    setW(w, 6);
    wr(w, 0xD24C, (rd(w, 0xD24C) + 1) & 0xFF);
    printHexByte(w, rd(w, 0xD24C), 0x0501);
    bc = (bc - 1) & 0xFFFF;
    if (!bc) {
      D.inBank(w, 0x05, () => closeMessageWindow(w));   // 05:5F46
      Scr.beginFadeOut(w, 0x10);
      w.high[0x1A2] |= 0x80;                     // white
      if (!(yield* waitFadeOrSkip(sh))) return false;
      skip = true;
    }
  }
  unregisterFrameTask(w, B, 0x5E26);             // DemoWindowXTask (00:068A EnableOAMDMA)
  Scr.beginFadeOut(w, 0x10);
  yield* Scr.waitFade(sh);
  return true;
}

// 40:4CB6 TitleCheatInput: hJoyHeld against the code 40:4CF5 (Up, Up, Down, Up, Left, Right, Left, Right, B,
// Select, twice; each press then a release; index $D254); any other press restarts it; done: sound $63 and
// hUnlockAll $FFCF = 1
function titleCheatInput(w) {
  const old = w.high[0x196];
  setW(w, 6);
  if (!w.high[0x1CF]) {
    const i = rd(w, 0xD254);
    const d = rb(B, (0x4CF5 + i) & 0xFFFF);
    if (d === 0xFF) { w.sh.sound(0x63); w.high[0x1CF] = 1; }
    else {
      const a = w.high[0x190];
      if (a === d) wr(w, 0xD254, (i + 1) & 0xFF);
      else if (a && d) wr(w, 0xD254, 0);
    }
  }
  setW(w, old);
}

// 40:4D53 TitleAnimTask: the two rows of golfer sprites scrolling across ($D24F / $D250, templates 40:4EB2 /
// 40:4EC7, each drawn twice), the logo's palette 9 colour cycling (40:4CA6, colours 40:5755), the animated logo tiles
// (lists 40:4ED8 / 40:4EF8 by the frame, to VRAM1 $8000) and the scroll wobble (table 40:4E72; the d-pad moves it
// sideways too)
function titleAnimTask(w) {
  setW(w, 6);
  const n = w.high[0x18C];
  let a = (rd(w, 0xD24F) + (n & 1)) & 0xFF;
  if (a === 0xA0) a = (a - 0x78) & 0xFF;
  wr(w, 0xD24F, a);
  D.queueSpriteTemplate(w, 0x4EB2, 0x30, a, 0x14, 0x00);
  a = rd(w, 0xD24F);
  if (a >= 0x64) a = (a - 0xF0) & 0xFF;
  D.queueSpriteTemplate(w, 0x4EB2, 0x30, (a + 0x78) & 0xFF, 0x14, 0x00);
  const cy = n & rd(w, 0xD24F) & 1;
  a = (rd(w, 0xD250) + cy) & 0xFF;
  if (a === 0xA0) a = (a - 0x60) & 0xFF;
  wr(w, 0xD250, a);
  D.queueSpriteTemplate(w, 0x4EC7, 0x30, a, 0x14, 0x00);
  a = rd(w, 0xD250);
  if (a >= 0x64) a = (a - 0xC0) & 0xFF;
  D.queueSpriteTemplate(w, 0x4EC7, 0x30, (a + 0x60) & 0xFF, 0x14, 0x00);
  setW(w, 1);
  D.copyMemoryBC(w, 0x4CA6, 0xD200, 0x10);
  const c = (0x5755 + ((n & 0x0F) << 1)) & 0xFFFF;
  wr(w, 0xD202, rb(B, c)); wr(w, 0xD203, rb(B, c + 1));
  D.loadPalettesMasterOnly(w, 0xD200, 0x09, 0x02);
  const r = (n >> 1) | ((n << 7) & 0x80);        // rrca
  D.lzTo(w, B, rw(B, (0x4ED8 + (r & 0x1E)) & 0xFFFF), 0xD000);
  D.lzTo(w, B, rw(B, (0x4EF8 + (r & 0x1E)) & 0xFFFF), 0xD0A0);
  D.queueVRAMCopy(w, 0xD000, 0xA000, 0x14);
  w.high[0x18A] = (rb(B, 0x4E72 + (r & 0x3F)) + 4) & 0xFF;
  w.high[0x18B] = w.high[0x190] & 0xF0 ? rb(B, 0x4E72 + ((r + 0x10) & 0x3F)) : 0;
}

// 40:4032 TitleScreen: a = 0 plays the attract loop first; the title until Start or A (sound $5C; true) or $4B0
// frames (back to the attract loop); hDebugMode off meanwhile (returned in a)
export function* titleScreen(sh, a) {
  const w = sh.w;
  const debug = w.high[0x19E];
  w.high[0x19E] = 0;
  Scr.beginFadeOut(w, 0x7F);
  yield* Scr.waitFade(sh);
  let attract = !a;
  for (;;) {
    if (attract) {                               // 40:4048
      clearFrameTasks(w);
      sh.sound(0x00);
      if (!(yield* introPicture(sh))) {
        sh.sound(0x29);
        for (let k = 0; k < 0x10; k++) if (yield* demoSlide(sh, k)) { sh.sound(0x5C); break; }
      }
    }
    attract = true;
    sh.sound(0x24);                              // 40:4069: the title
    w.lcd.lcdc |= 0x40;
    w.lcd.wx = 0x07; w.lcd.wy = 0x98;
    initFontScreen(w);                           // 01:41E8
    D.disableLCDSafely(w);
    clearFrameTasks(w);
    setW(w, 1);
    D.lzTo(w, B, 0x41CE, 0xD000);
    D.queueVRAMCopy(w, 0xD000, 0xB000, 0x80);
    D.queueAndRunVRAMCopy(w, 0xD800, 0xA800, 0x80);
    D.lzTo(w, B, 0x4B8D, 0xD000);
    D.lzTo(w, B, 0x4C30, 0xD0A0);
    D.queueAndRunVRAMCopy(w, 0xD000, 0xA140, 0x12);
    D.loadPalettesMasterOnly(w, 0x48EB, 0x01, 0x07);
    D.loadPalettesMasterOnly(w, 0x4CA6, 0x09, 0x02);
    D.lzTo(w, B, 0x4A3F, 0xD000);
    D.lzTo(w, B, 0x4AA2, 0xD400);
    D.queueVRAMCopy(w, 0xD000, 0xB800, 0x40);
    D.queueAndRunVRAMCopy(w, 0xD400, 0x9800, 0x40);
    D.lzTo(w, B, 0x4923, 0xD000);
    D.lzTo(w, B, 0x4976, 0xD400);
    D.queueVRAMCopy(w, 0xD100, 0xBC00, 0x24);
    D.queueAndRunVRAMCopy(w, 0xD500, 0x9C00, 0x24);
    w.lcd.wy = 0x40;
    D.enableLCD(w);
    registerFrameTask(w, 0x01, B, 0x4D53);       // TitleAnimTask
    Scr.beginFadeIn(w, 0x08);
    yield* Scr.waitFade(sh);
    yield* sh.advance(0x3C);                     // WaitFramesCmd 60
    registerFrameTask(w, 0x01, B, 0x4D1D);       // TitlePressStartTask
    let pressed = false;
    for (let bc = 0x4B0; bc; bc--) {
      D.restorePalettesFromMaster(w);
      titleCheatInput(w);
      yield* sh.advance();
      advanceRandomSeed(w);                      // 00:0A61
      if (linkPartnerSkips(w)) notPorted("the link partner's Start (~40:4161)");
      if (w.high[0x190] & 9) { pressed = true; break; }
    }
    if (pressed) break;
    Scr.beginFadeOut(w, 0x08);
    yield* Scr.waitFade(sh);
  }
  sh.sound(0x5C);                                // 40:4187
  Scr.beginFadeOut(w, 0x08);
  yield* Scr.waitFade(sh);
  unregisterFrameTask(w, B, 0x4D53);
  w.lcd.wy = 0x90;
  w.high[0x18B] = w.high[0x18A] = 0;
  D.disableLCDSafely(w);
  setW(w, 2);
  D.clearMemory16(w, 0xD000, 0x24);
  D.queueAndRunVRAMCopy(w, 0xD000, 0x9C00, 0x24);
  D.queueAndRunVRAMCopy(w, 0xD000, 0xBC00, 0x24);
  D.enableLCD(w);
  w.high[0x19E] = debug;
  return debug;                                  // (a: the restored hDebugMode)
}
