// The ending after the first win of Peach's Tournament (REVERSE.md "The ending"): EndingSequence 0A:56B1 runs the
// ending maps one after another (bank 35, maps $31-$3E: maps/bank35.js), each turned sepia (0A:5422 / 54CF / 5561)
// under its page of the credits (CreditsRun 0B:5395), then the copyright screen (0B:58B0) and the final screen with
// its six sprite animations (0A:6747, bank 79).
import { rb } from "./rom.js";
import * as D from "./render/display.js";
import * as Scr from "./screen.js";
import * as S from "./script.js";
import * as M from "./mapengine.js";
import { loadText } from "./text.js";
import { initFontScreen } from "./pictures.js";
import { printDecimalByte } from "./match.js";
import { clearFrameTasks, registerFrameTask, unregisterFrameTask } from "./tasks.js";

const rd = D.rd, wr = D.wr;
const setW = (w, n) => { w.high[0x196] = n; };
const flagByte = n => 0x840 + (n >> 3), flagBit = n => 0x80 >> (n & 7);
const setFlag = (w, n) => { w.wram[0][flagByte(n)] |= flagBit(n); };
const clearFlag = (w, n) => { w.wram[0][flagByte(n)] &= ~flagBit(n); };
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}

// ---- the sepia fade (bank 0A) ----
// 00:24EB SplitColorComponents / 00:2504 CombineColorComponents: a colour word <-> red, green, blue (5 bits each)
const split = v => [v & 0x1F, (v >> 5) & 0x1F, (v >> 10) & 0x1F];
const combine = (r, g, b) => (r & 0x1F) | (g & 0x1F) << 5 | (b & 0x1F) << 10;
// 0A:5490 PalSepiaColor: s = red + green + blue: red s / 2 ($1F when that has bit 5), green s / 4, blue s / 8
function sepia(v) {
  const [r, g, b] = split(v);
  const s = r + g + b;
  let a = (s << 2) >> 3;
  if (a & 0x20) a = 0x1F;
  return combine(a, ((s << 1) >> 3) & 0xFF, s >> 3);
}
// 0A:5422 PalFadeInitSepia (WRAM6): the 16 select bytes $D5E0 cleared, the master palettes $C200 (128 bytes) to the
// current $D540 and the target $D4A0 (0A:5441), the target's 64 colours turned sepia (0A:545E)
function palFadeInitSepia(w) {
  const old = w.high[0x196];
  setW(w, 6);
  for (let k = 0; k < 0x10; k++) wr(w, 0xD5E0 + k, 0);
  for (let k = 0; k < 0x80; k++) { wr(w, 0xD540 + k, w.wram[0][0x200 + k]); wr(w, 0xD4A0 + k, w.wram[0][0x200 + k]); }
  for (let k = 0; k < 0x80; k += 2) {
    const v = sepia(rd(w, 0xD4A0 + k) | rd(w, 0xD4A1 + k) << 8);
    wr(w, 0xD4A0 + k, v & 0xFF); wr(w, 0xD4A1 + k, v >> 8);
  }
  setW(w, old);
}
// 0A:54CF PalFadeSetup (WRAM6): $D5F0 = d steps, the delay $D5F9 = d / 31, the palettes to fade from the mask bc
// (b bit 7 = BG 0 ... c bit 0 = OBJ 7) to $D5E0
function palFadeSetup(w, b, c, d) {
  const old = w.high[0x196];
  setW(w, 6);
  wr(w, 0xD5F0, d);
  wr(w, 0xD5F9, Math.floor(d / 0x1F) & 0xFF);
  const mask = b << 8 | c;
  for (let k = 0; k < 0x10; k++) if (mask & (0x8000 >> k)) wr(w, 0xD5E0 + k, 1);
  setW(w, old);
}
// 0A:561C PalStepComponent: one step toward the target, kept to 5 bits
const stepToward = (v, t) => (t === v ? v : t > v ? (v + 1) & 0x1F : (v - 1) & 0x1F);
// 0A:5561 PalFadeRun (WRAM6): each step: the delay, each selected palette's four colours a step toward the target
// (0A:55AC / 55C6), all 16 palettes loaded (00:056C), a frame; then 0A:562E PalFadeFinish: the selected palettes
// set to the target and loaded
function* palFadeRun(sh) {
  const w = sh.w, old = w.high[0x196];
  setW(w, 6);
  for (;;) {
    for (let a = rd(w, 0xD5F9); a; a--) yield* sh.advance();
    for (let b = 0; b < 0x10; b++) {
      if (!rd(w, 0xD5E0 + b)) continue;
      wr(w, 0xD5F1, b);
      for (let k = 0; k < 4; k++) {
        const hl = 0xD540 + b * 8 + k * 2, de = 0xD4A0 + b * 8 + k * 2;
        const cur = split(rd(w, hl) | rd(w, hl + 1) << 8), tgt = split(rd(w, de) | rd(w, de + 1) << 8);
        for (let j = 0; j < 3; j++) { wr(w, 0xD5F2 + j, cur[j]); wr(w, 0xD5F5 + j, tgt[j]); }
        for (let j = 0; j < 3; j++) wr(w, 0xD5F2 + j, stepToward(rd(w, 0xD5F2 + j), rd(w, 0xD5F5 + j)));
        const v = combine(rd(w, 0xD5F2), rd(w, 0xD5F3), rd(w, 0xD5F4));
        wr(w, hl, v & 0xFF); wr(w, hl + 1, v >> 8);
      }
    }
    D.loadPalettesImmediate(w, 0xD540, 0x00, 0x10);
    yield* sh.advance();
    const n = (rd(w, 0xD5F0) - 1) & 0xFF;
    wr(w, 0xD5F0, n);
    if (!n) break;
  }
  for (let b = 0; b < 0x10; b++)                                  // 0A:562E PalFadeFinish
    if (rd(w, 0xD5E0 + b)) for (let k = 0; k < 8; k++) wr(w, 0xD540 + b * 8 + k, rd(w, 0xD4A0 + b * 8 + k));
  D.loadPalettesImmediate(w, 0xD540, 0x00, 0x10);
  setW(w, old);
}

// 0A:57A3 FreezeAllActors: each actor in use (+1 not 0): +$1A = $FF, +$34 = 1; WRAM4 left mapped
function freezeAllActors(w) {
  setW(w, 4);
  for (let k = 0, de = 0xD000; k < 0x18; k++, de += 0x40) {
    if (!rd(w, de + 1)) continue;
    wr(w, de + 0x1A, 0xFF);
    wr(w, de + 0x34, 0x01);
  }
}

// ---- the credits (bank 0B) ----
// 0B:538D FillBytes: [hl++] = b for de bytes
function fillBytes(w, hl, b, de) { for (let k = 0; k < de; k++) wr(w, (hl + k) & 0xFFFF, b); }
// 0B:5640 CreditsWindowTask: the scene's steps ($D5FE: 0B:56C9's SCY and wMapScrollY bytes; scene 7 by wCharId:
// 0 none, else 1 and $20) added to SCY and wMapScrollY, WY = $90 - (wFrameCounter + 1 & $3F); at $3F the task
// removes itself and sets $D242 (quirk kept: WRAM6 is left mapped then)
function creditsWindowTask(w) {
  const old = w.high[0x196];
  setW(w, 6);
  const b = rd(w, 0xD5FE);
  let c, de;
  if (b === 0x07) [c, de] = rd(w, 0xC810) === 0 ? [0x00, 0x0000] : [0x01, 0x0020];
  else { const p = 0x56C9 + b * 2; c = rb(0x0B, p); de = rb(0x0B, p + 1); }
  setW(w, old);
  w.high[0x18A] = (w.high[0x18A] + c) & 0xFF;
  const y = ((rd(w, 0xC322) | rd(w, 0xC323) << 8) + de) & 0xFFFF;
  wr(w, 0xC322, y & 0xFF); wr(w, 0xC323, y >> 8);
  const f = (rd(w, 0xC4B2) + 1) & 0xFF;
  wr(w, 0xC4B2, f);
  const n = f & 0x3F;
  if (w.vram) w.lcd.wy = (0x90 - n) & 0xFF;
  if (n !== 0x3F) return;
  unregisterFrameTask(w, 0x0B, 0x5640);
  setW(w, 6);
  wr(w, 0xD242, 0x01);
}
// 0B:5884 CopyTextLine: text hl loaded (05:6179) to wTextBuffer $C600, its first 20 characters (up to a 0) to WRAM1 at
// de
function copyTextLine(w, hl, de) {
  const old = w.high[0x196];
  loadText(w, hl);
  setW(w, 1);
  for (let c = 0x14, p = 0xC600; c; c--) {
    const a = rd(w, p++);
    if (!a) break;
    wr(w, de++, a);
  }
  setW(w, old);
}
// 0B:5795 CreditsPrintLines: block c of a page (hl: the text offset from $1900, then the line count): its lines to
// WRAM1 $D063 + 20c, $50 apart, a frame after each
function* creditsPrintLines(sh, c, hl) {
  const w = sh.w, old = w.high[0x196];
  let de = (0xD063 + (c ? 0x14 * c : 0)) & 0xFFFF;
  let id = 0x1900 + rb(0x0B, hl);
  for (let b = rb(0x0B, hl + 1); ;) {
    setW(w, 1);
    copyTextLine(w, id, de);
    yield* sh.advance();
    de = (de + 0x50) & 0xFFFF;
    id++;
    b = (b - 1) & 0xFF;
    if (!b) break;
  }
  setW(w, old);
}
// 0B:56EF CreditsShowPage: page a's 7-byte record at 0B:572C (the block count to $D243, then up to three blocks:
// 0B:5795 and a frame each)
function* creditsShowPage(sh, a) {
  const w = sh.w, old = w.high[0x196];
  let hl = 0x572C + a * 7;
  setW(w, 6);
  const b = rb(0x0B, hl);
  wr(w, 0xD243, b);
  hl++;
  for (let c = 0; ;) {
    yield* creditsPrintLines(sh, c, hl);
    yield* sh.advance();
    hl += 2;
    c++;
    if (c === b) break;
  }
  setW(w, old);
}
// 0B:5822 CreditsScrollStep: 8 rows of 20 from WRAM1 $D000 + c ($50 apart) to WRAM5 $D000 ($20 apart), queued to
// the window's map $9C00 ($10 blocks), a frame
function* creditsScrollStep(sh, c) {
  const w = sh.w, old = w.high[0x196];
  let hl = 0xD000 + c, de = 0xD000;
  for (let b = 0x08; b; b--) {
    for (let k = 0; k < 0x14; k++) {
      setW(w, 1);
      const a = rd(w, hl + k);
      setW(w, 5);
      wr(w, de + k, a);
    }
    hl = (hl + 0x50) & 0xFFFF;
    de = (de + 0x20) & 0xFFFF;
  }
  setW(w, 5);
  D.queueVRAMCopy(w, 0xD000, 0x9C00, 0x10);
  yield* sh.advance();
  setW(w, old);
}
// 0B:57E4 CreditsScroll: ($D243 & 3, or 1) times: a frame, 20 steps (the column c going on from 0), 255 frames
function* creditsScroll(sh) {
  const w = sh.w, old = w.high[0x196];
  setW(w, 6);
  let b = rd(w, 0xD243) & 0x03;
  if (!b) b = 1;
  let c = 0;
  for (let d = 0; d !== b; d++) {
    yield* sh.advance();
    for (let e = 0x14; e; e--) { yield* creditsScrollStep(sh, c); c = (c + 1) & 0xFF; }
    for (let e = 0xFF; e; e--) yield* sh.advance();
  }
  setW(w, old);
}
// 0B:5395 CreditsRun (a = the page): the font tile 0B:5430 to $8FF0, the window's attributes 0B:5440 and map
// 0B:5540 queued, a frame, the map's graphics task stopped (0B:4732), WY $90, $D242 and wFrameCounter 0, $D5FE = a,
// the window task 0B:5640 until it has risen ($D242), 32 frames, WRAM1 $D000 ($300) and WRAM5 $D000 ($100) filled
// with spaces, a frame, the page (0B:56EF) and its scrolling (0B:57E4)
function* creditsRun(sh, a) {
  const w = sh.w, old = w.high[0x196];
  D.inBank(w, 0x0B, () => {
    D.queueVRAMCopy(w, 0x5430, 0x8FF0, 0x01);
    D.queueVRAMCopy(w, 0x5440, 0xBC00, 0x10);
    D.queueVRAMCopy(w, 0x5540, 0x9C00, 0x10);
  });
  yield* sh.advance();
  unregisterFrameTask(w, 0x0B, 0x4784);                          // 0B:4732 MapStopGfxTask: MapGfxScrollTask off
  if (w.vram) w.lcd.wy = 0x90;
  setW(w, 6);
  wr(w, 0xD242, 0);
  wr(w, 0xC4B2, 0);
  wr(w, 0xD5FE, a);
  registerFrameTask(w, 0x01, 0x0B, 0x5640);
  do { yield* sh.advance(); } while (!rd(w, 0xD242));
  for (let c = 0x20; c; c--) yield* sh.advance();
  setW(w, 1);
  fillBytes(w, 0xD000, 0x20, 0x0300);
  setW(w, 5);
  fillBytes(w, 0xD000, 0x20, 0x0100);
  yield* sh.advance();
  yield* creditsShowPage(sh, a);
  yield* creditsScroll(sh);
  setW(w, old);
}
// 0B:58B0 CopyrightScreen: WRAM1: $D000 ($240) attribute $80, $D300 ($240) spaces, the texts $19DA / $19DC / $19DE
// at $D3C0 / $D400 / $D440 (0B:5884), queued to VRAM1 $9800 and VRAM0 $9800 ($24 blocks each), no scroll, a frame,
// fade in ($10), 132 frames
function* copyrightScreen(sh) {
  const w = sh.w, old = w.high[0x196];
  setW(w, 1);
  fillBytes(w, 0xD000, 0x80, 0x0240);
  fillBytes(w, 0xD300, 0x20, 0x0240);
  for (let k = 0, hl = 0x19DA, de = 0xD3C0; k < 3; k++, hl += 2, de += 0x40) copyTextLine(w, hl, de);
  D.queueVRAMCopy(w, 0xD000, 0xB800, 0x24);
  D.queueVRAMCopy(w, 0xD300, 0x9800, 0x24);
  w.high[0x18B] = 0; w.high[0x18A] = 0;
  for (let k = 0; k < 4; k++) wr(w, 0xC320 + k, 0);
  yield* sh.advance();
  Scr.beginFadeIn(w, 0x10);
  yield* Scr.waitFade(sh);
  for (let c = 0x84; c; c--) yield* sh.advance();
  setW(w, old);
}

// ---- the final screen (0A:6747, bank 79) ----
// the six parts of 79:68B1 (79:68F6, 6AA5, 6C59, 6E0D, 6FC1, 7175): from its first step (part 1: any), each of its
// nine steps decompresses its frame (WRAM1) and queues it to VRAM, then draws its template; past them the last
// template is drawn again. [first step, the LZ frames, buffer, VRAM, blocks, the first template and its stride,
// x, y, attributes / tiles bc]
const FINAL_PARTS = [
  [0x00, [0x7340, 0x736A, 0x7398, 0x73C8, 0x7409, 0x744B, 0x7493, 0x74DC, 0x7525], 0xD000, 0x8000, 4, 0x7BE5, 9, 0xFE, 0x80, 0x0300],
  [0x09, [0x756C, 0x7592, 0x75C0, 0x75EE, 0x7631, 0x767C, 0x76C7, 0x7712, 0x775C], 0xD040, 0x8040, 4, 0x7C36, 9, 0x0E, 0x80, 0x0204],
  [0x12, [0x77A5, 0x77CC, 0x77FD, 0x7832, 0x7874, 0x78B9, 0x7902, 0x794C, 0x7996], 0xD080, 0x8080, 4, 0x7C87, 9, 0x1E, 0x80, 0x0308],
  [0x1B, [0x79DB, 0x79EA, 0x79F9, 0x7A08, 0x7A1B, 0x7A31, 0x7A47, 0x7A5D, 0x7A73], 0xD0C0, 0x80C0, 2, 0x7CD8, 5, 0x2E, 0x80, 0x030C],
  [0x24, [0x7A89, 0x7A98, 0x7AA7, 0x7AB6, 0x7ACA, 0x7ADF, 0x7AF5, 0x7B0B, 0x7B21], 0xD0E0, 0x80E0, 2, 0x7D05, 5, 0x36, 0x80, 0x020E],
  [0x2D, [0x7B37, 0x7B46, 0x7B55, 0x7B64, 0x7B77, 0x7B8D, 0x7BA3, 0x7BB9, 0x7BCF], 0xD100, 0x8100, 2, 0x7D32, 5, 0x3E, 0x80, 0x0310],
];
function finalSpritePart(w, [first, lz, buf, dst, n, t0, dt, d, e, bc], step) {
  if (step < first) return;
  const k = step - first;
  if (k < 9) {
    setW(w, 1);
    D.lzTo(w, 0x79, lz[k], buf);
    D.queueVRAMCopy(w, buf, dst, n);
  }
  D.inBank(w, 0x79, () => D.queueSpriteTemplate(w, t0 + dt * Math.min(k, 8), e, d, bc & 0xFF, bc >> 8));
}
// 79:688C EndingFinalSpritesInit: the step $D400 (WRAM6) = 0, OBJ palettes 2 and 3 ($0A / $0B) from 79:7329 / 7331
function endingFinalSpritesInit(w) {
  const old = w.high[0x196];
  setW(w, 6);
  wr(w, 0xD400, 0);
  D.inBank(w, 0x79, () => {
    D.loadPalettesMasterOnly(w, 0x7329, 0x0A, 0x01);
    D.loadPalettesMasterOnly(w, 0x7331, 0x0B, 0x01);
  });
  setW(w, old);
}
// 0A:6806 EndingFinalScreenTask -> 79:68B1 EndingFinalSpritesTask (WRAM6): the step printed at (3, $0F) (00:22D2, the
// debug text buffer), the six parts, then every 4th frame the step up by one to $36
function endingFinalScreenTask(w) {
  const old = w.high[0x196];
  setW(w, 6);
  const step = rd(w, 0xD400);
  printDecimalByte(w, step, 0x030F);
  for (const p of FINAL_PARTS) finalSpritePart(w, p, step);
  setW(w, 6);
  if (!(rd(w, 0xC4B2) & 0x03) && rd(w, 0xD400) < 0x36) wr(w, 0xD400, rd(w, 0xD400) + 1);
  setW(w, old);
}
// 0A:6747 EndingFinalScreen: WRAM1, LCD off, the BG palettes 0-7 from 0A:6707 (master only);
// the LZ tiles 0A:57CC (VRAM0 $9000 $80 blocks and $8800 from $D800 $34 blocks), the maps 0A:5E70 / 5F52 (VRAM0 /
// VRAM1 $9800, $12 blocks), the tiles 0A:5F7F (VRAM1), the maps 0A:65C6 / 66A8 (VRAM0 / VRAM1 $9920), the sprites'
// set-up (79:688C), LCD on
function endingFinalScreen(w) {
  setW(w, 1);
  if (w.vram) D.disableLCDSafely(w);
  D.inBank(w, 0x0A, () => D.loadPalettesMasterOnly(w, 0x6707, 0x00, 0x08));
  const lzDma = (src, vbk, list) => {
    D.lzTo(w, 0x0A, src, 0xD000);
    if (!w.vram) return;
    w.lcd.vbk = vbk;
    for (const [hl, de, c] of list) D.startVRAMDMAFromHL(w, hl, de, c);
  };
  lzDma(0x57CC, 0, [[0xD000, 0x9000, 0x80], [0xD800, 0x8800, 0x34]]);
  lzDma(0x5E70, 0, [[0xD000, 0x9800, 0x12]]);
  lzDma(0x5F52, 1, [[0xD000, 0x9800, 0x12]]);
  lzDma(0x5F7F, 1, [[0xD000, 0x9000, 0x80], [0xD800, 0x8800, 0x34]]);
  lzDma(0x65C6, 0, [[0xD000, 0x9920, 0x12]]);
  lzDma(0x66A8, 1, [[0xD000, 0x9920, 0x12]]);
  endingFinalSpritesInit(w);                                      // 79:688C
  if (w.vram) D.enableLCD(w);
}

// ---- 0A:56B1 EndingSequence ----
// the credits parts (0A:5682: map and entrance, map 0 = the character's part from 0A:56A1 by wCharId; $FF ends)
// 0A:56B1 EndingSequence (export $64): fade out (4), 120 frames, music $15, 120 frames; no player, script or partner
// actor; InitFontScreen, BG palette 0 from 0A:56A9 (master only), wCreditsPart $C2AC = 0; each part: the frame tasks
// cleared, its map (flag #24 clear) run by MapRun 0A:4A21 to its warp, #24, the actors frozen (0A:57A3), the sepia
// fade of BG and OBJ palettes 2-7 over 30 steps (0A:5422 / 54CF / 5561), its credits page (0B:5395), fade out (4),
// WY $90; then the copyright (0B:58B0), fade out (8), no scroll, the final screen (0A:6747), the frame tasks
// cleared, #24 cleared, fade in (8), 30 frames, its task 0A:6806, 240 frames, until a button is held or 3600
// frames, fade out (8), the task removed, InitFontScreen
export function* endingSequence(sh) {
  const w = sh.w;
  Scr.beginFadeOut(w, 0x04);
  yield* Scr.waitFade(sh);
  yield* S.scriptWaitFrames(sh, 0x78);
  sh.sound(0x15);
  yield* S.scriptWaitFrames(sh, 0x78);
  for (let k = 0; k < 6; k++) wr(w, 0xC290 + k, 0);
  wr(w, 0xC296, 0xFF); wr(w, 0xC297, 0xFF); wr(w, 0xC298, 0xFF);
  initFontScreen(w);                                              // 01:41E8
  D.inBank(w, 0x0A, () => D.loadPalettesMasterOnly(w, 0x56A9, 0x00, 0x01));
  wr(w, 0xC2AC, 0);
  for (;;) {
    clearFrameTasks(w);
    let p = 0x5682 + rd(w, 0xC2AC) * 2;
    let m = rb(0x0A, p);
    if (m === 0xFF) break;
    if (!m) { p = 0x56A1 + rd(w, 0xC810) * 2; m = rb(0x0A, p); }
    wr(w, 0xC450, m);
    wr(w, 0xC46A, rb(0x0A, p + 1));
    clearFlag(w, 24);
    yield* inBankGen(w, 0x0A, M.mapRunToEnterScript(sh));       // 0A:4A21 MapRun
    yield* M.mapRunEnd(sh, w.mapScriptBank);
    setFlag(w, 24);
    freezeAllActors(w);
    palFadeInitSepia(w);
    palFadeSetup(w, 0x3F, 0x3F, 0x1E);
    yield* palFadeRun(sh);
    yield* inBankGen(w, 0x0B, creditsRun(sh, rd(w, 0xC2AC)));
    Scr.beginFadeOut(w, 0x04);
    yield* Scr.waitFade(sh);
    if (w.vram) w.lcd.wy = 0x90;
    wr(w, 0xC2AC, (rd(w, 0xC2AC) + 1) & 0xFF);
  }
  yield* inBankGen(w, 0x0B, copyrightScreen(sh));
  Scr.beginFadeOut(w, 0x08);
  yield* Scr.waitFade(sh);
  w.high[0x18B] = 0; w.high[0x18A] = 0;
  endingFinalScreen(w);
  clearFrameTasks(w);
  clearFlag(w, 24);
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  yield* sh.advance(0x1E);                                        // WaitFramesCmd $1E
  registerFrameTask(w, 0x01, 0x0A, 0x6806);
  yield* sh.advance(0xF0);                                        // WaitFramesCmd $F0
  for (let bc = 0x0E10; bc; bc--) {
    if (w.high[0x190]) break;
    yield* sh.advance();
  }
  Scr.beginFadeOut(w, 0x08);
  yield* Scr.waitFade(sh);
  unregisterFrameTask(w, 0x0A, 0x6806);
  initFontScreen(w);
}

export const TASKS = w => ({
  "0b:5640": () => creditsWindowTask(w),                          // 0B:5640 CreditsWindowTask
  "0a:6806": () => endingFinalScreenTask(w),                      // 0A:6806 EndingFinalScreenTask
});
