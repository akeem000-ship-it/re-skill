// The player's picture between shots (ShowPlayerPicture 3B:7717 -> LoadStoryPicture 77:6E3E): a 10 x 8 tile
// portrait of the golfer reacting (a birdie, a hole in one, a pick-up ...) merged into the middle of the course
// view (BG rows 4-11), animated by StoryPictureAnimTask 77:7033 from a frame script, for wPictureTimer $D34D
// frames (WaitPictureTimeout 3B:773F waits for it, or A / B). The hole-in-one picture (picture 0) also loads a
// full-screen cycling picture (LoadCyclingPicture 4A:6205, PictureCycleTask 4A:62A3).
// The tasks, their registration and the RAM they keep run headless too; the tiles, maps and palettes only with a
// display (render/display.js). (EnableOAMDMA 00:068A / DisableOAMDMA 00:0684 write to the ROM area, the MBC's RAM
// enable register: no display effect, left out.)
import { rb, rw } from "./rom.js";
import { registerFrameTask, unregisterFrameTask, clearFrameTasks } from "./tasks.js";
import * as Scr from "./screen.js";
import { playerField as pf } from "./memory.js";
import * as D from "./render/display.js";
import { copyMapToScrollBuffers } from "./standings.js";

const B = 0x77;
const r77 = a => rw(B, a & 0xFFFF);

// 3B:7717 ShowPlayerPicture: a = picture; $D34D = $F0; the current player's golfer (+$10) and +$19 bit 4
export function* showPlayerPicture(sh, a) {
  const w = sh.w, w0 = w.wram[0];
  w.wram[6][0x34D] = 0xF0;                       // wPictureTimer
  const c = w0[pf(w, 0x10)] | (w0[pf(w, 0x19)] & 0x10);
  yield* loadStoryPicture(sh, a, c);
}

// 77:6E3E LoadStoryPicture: b = picture (its variant 77:6F86), c = golfer (bit 4: the other palette set)
export function* loadStoryPicture(sh, b0, c) {
  const w = sh.w, r6 = w.wram[6];
  const b = rb(B, 0x6F86 + b0);                  // the variant
  if ((c & 0x0F) >= 0x0B) {                      // no picture for this golfer: only the timer
    r6[0x444] = 0xFF;                            // wHoled
    registerFrameTask(w, 0x01, B, 0x70B6);       // StoryPictureTimerTask
  } else {
    r6[0x34C] = b;                               // wStoryPictureVariant
    r6[0x34B] = c & 0x0F;                        // wStoryPicture
    D.setWramBank(w, 1);
    D.inBank(w, B, () => D.farDispatchIndexed(w, r77(0x7346 + 2 * (c & 0x0F)), b, 0xD000));   // the tiles -> WRAM1
    yield* sh.advance();
    for (const [src, dst] of [[0xD000, 0x9200], [0xD200, 0x9400], [0xD400, 0x9600], [0xD600, 0x8800], [0xD800, 0x8A00], [0xDA00, 0x8C00]]) {
      if (w.vram) D.inBank(w, B, () => D.queueVRAMCopy(w, src, dst, 0x20));
      yield* sh.advance();
    }
    D.setWramBank(w, 6);
    r6[0x444] = 0xFF;
    const pal = (((c & 0x0F) * 0x28 + b * 8) + (c & 0x10 ? 0x752E : 0x7376)) & 0xFFFF;   // one palette (8 bytes)
    const s = r77(0x76E6 + r6[0x34B] * 16 + r6[0x34C] * 2);   // the frame script
    r6[0x347] = r6[0x349] = s & 0xFF;            // wStoryPictureAnim / wStoryAnimBase
    r6[0x348] = r6[0x34A] = s >> 8;
    yield* sh.advance();
    r6[0x346] = 0;                               // wStoryAnimDelay
    registerFrameTask(w, 0x01, B, 0x7033);       // StoryPictureAnimTask
    if (w.vram) D.inBank(w, B, () => D.loadPalettesImmediate(w, pal, 0x06, 0x01));
    if (r6[0x34C] >= 1 && r6[0x34C] < 5) {
      w.wram[0][0x3F4] = 0;                      // the colour step
      registerFrameTask(w, 0x01, B, 0x6F8E);     // StoryPicturePaletteTask
    }
  }
  loadCyclingPicture(sh, b0);                    // 4A:6205 (only picture 0 has one)
  yield* sh.advance(10);                         // WaitFramesCmd 10
}

export function storyPicturePaletteTask(w) {     // 77:6F8E StoryPicturePaletteTask: BG palette 6 colour 0 cycles
  const w0 = w.wram[0];
  if (w0[0x3F4] >= 0x27) w0[0x3F4] = 0;
  if (w.vram) D.inBank(w, B, () => setPaletteColor(w, 0x6FD5 + w0[0x3F4] * 2, 6, 0));
  w0[0x3F4] = (w0[0x3F4] + 1) & 0xFF;
}

function setPaletteColor(w, hl, d, e) {          // 77:6FAE SetPaletteColor: $C100 / $C200 + (4d + e) x 2
  const o = ((d * 4 + e) * 2) & 0xFF;
  for (let k = 0; k < 2; k++) { const v = D.rd(w, hl + k); w.wram[0][0x100 + o + k] = v; w.wram[0][0x200 + o + k] = v; }
  if (!(d & 8)) w.high[0x19D] |= 1;              // hPalUpdate
  if (((e + d) & 0xFF) >= 9) w.high[0x19D] |= 2;
}

export function storyPictureAnimTask(w) {        // 77:7033 StoryPictureAnimTask
  const r6 = w.wram[6];
  D.setWramBank(w, 6);
  if (r6[0x34D] !== 0xFF && !r6[0x34D]) {        // the time is up
    unregisterFrameTask(w, B, 0x7033);
    unregisterFrameTask(w, B, 0x6F8E);
    return;
  }
  if (!r6[0x346]) {
    let p = r6[0x347] | r6[0x348] << 8;
    let f = rb(B, p++);
    if (f === 0xFF) {                            // the script ends
      r6[0x34D] = 0;
      unregisterFrameTask(w, B, 0x7033);
      unregisterFrameTask(w, B, 0x6F8E);
    } else {
      if (f === 0xFE) {                          // $FE n: to entry n of the script
        p = ((r6[0x349] | r6[0x34A] << 8) + rb(B, p)) & 0xFFFF;
        f = rb(B, p++);
      }
      r6[0x346] = rb(B, p++);
      r6[0x347] = p & 0xFF; r6[0x348] = p >> 8;
      drawStoryPictureFrame(w, f, r6[0x34B]);
    }
  }
  D.setWramBank(w, 6);
  r6[0x346] = (r6[0x346] - 1) & 0xFF;
  if (r6[0x34D] !== 0xFF) r6[0x34D] = (r6[0x34D] - 1) & 0xFF;
}

export function storyPictureTimerTask(w) {       // 77:70B6 StoryPictureTimerTask
  const r6 = w.wram[6];
  D.setWramBank(w, 6);
  r6[0x34D] = (r6[0x34D] - 1) & 0xFF;
  if (r6[0x34D]) return;
  unregisterFrameTask(w, B, 0x70B6);
}

// 77:70D0 DrawStoryPictureFrame: b = frame, c = picture: the frame's 10 x 8 tiles (LZ, 77:735E) merged into 8 rows
// of the course view's maps (WRAM2 $D100 attributes, WRAM3 $D100 tiles, stride $40, columns 5-14) in $C600 / $C700,
// queued to BG rows 4-11 ($9880)
export function drawStoryPictureFrame(w, b, c) {
  const r6 = w.wram[6];
  D.setWramBank(w, 6);
  r6[0x444] = 0xFF;
  const v = r6[0x34C];
  D.setWramBank(w, 1);
  D.inBank(w, B, () => D.farDispatchIndexed(w, r77(0x735E + 2 * c), ((v * 8) + b) & 0xFF, 0xD000));
  const w0 = w.wram[0], frame = w.wram[1];
  let f = 0;                                     // hFFB0: the frame data read so far (WRAM1 $D000)
  let de = 0x600;
  for (const [bank, merge] of [[2, t => (t & 0xF0) | 0x06], [3, t => (t + 0x20) & 0xFF]]) {
    const map = w.wram[bank];
    let hl = 0x100;
    for (let row = 0; row < 8; row++) {
      for (let k = 0; k < 5; k++) w0[de++] = map[hl++];
      hl += 0x0A;
      for (let k = 0; k < 10; k++) w0[de++] = merge(frame[f++]);
      for (let k = 0; k < 5; k++) w0[de++] = map[hl++];
      hl += 0x2C;
      de += 0x0C;
    }
  }
  w.high[0x1B0] = (0xD000 + f) & 0xFF; w.high[0x1B1] = (0xD000 + f) >> 8;
  if (w.vram) D.inBank(w, B, () => {
    D.queueVRAMCopy(w, 0xC600, 0xB880, 0x10);
    D.queueVRAMCopy(w, 0xC700, 0x9880, 0x10);
    D.queueVRAMCopyBreak(w);
  });
}

// 3B:773F WaitPictureTimeout: frames until wPictureTimer is 0 (A or B: at once), then one more
export function* waitPictureTimeout(sh) {
  const w = sh.w, r6 = w.wram[6];
  D.setWramBank(w, 6);
  for (;;) {
    yield* sh.advance();
    if (!r6[0x34D]) break;
    if (w.high[0x194] & 3) { r6[0x34D] = 0; break; }
  }
  yield* sh.advance();
}

// ---- 4A:6205 LoadCyclingPicture: a = picture (only 0: table 4A:62F1); the full-screen picture, its palette 2
// cycling (PictureCycleTask 4A:62A3) ----
export function loadCyclingPicture(sh, a) {
  if (a >= 1) return;
  const w = sh.w;
  const rec = rw(0x4A, 0x62F1 + 2 * a);
  D.setWramBank(w, 1);
  D.inBank(w, 0x4A, () => {
    D.lzTo(w, 0x4A, rw(0x4A, rec), 0xD800);
    D.lzTo(w, 0x4A, rw(0x4A, rec + 2), 0xD400);
    w.wram[1].fill(0x0A, 0x000, 0x400);
    const pal = rw(0x4A, rec + 4);
    if (w.vram) {
      D.disableLCDSafely(w);
      D.loadPalettesImmediate(w, pal, 0x02, 0x01);
      D.queueVRAMCopy(w, 0xD800, 0xB000, 0x40);
      D.queueVRAMCopy(w, 0xD400, 0x9800, 0x20);
      D.queueAndRunVRAMCopy(w, 0xD000, 0xB800, 0x20);
      D.enableLCD(w);
    }
    copyMapToScrollBuffers(w);                   // 00:0804
    w.wram[6][0x34E] = pal & 0xFF; w.wram[6][0x34F] = pal >> 8;   // wCyclePalettePtr
  });
  w.wram[6][0x443] = 0xFF;                       // wOnGreen
  registerFrameTask(w, 0x01, 0x4A, 0x62A3);      // PictureCycleTask
}
export function pictureCycleStop(w) { unregisterFrameTask(w, 0x4A, 0x62A3); }   // 4A:629C PictureCycleStop

export function pictureCycleTask(w) {            // 4A:62A3 PictureCycleTask: palette 2 in $D350 from wCyclePalettePtr
  const r6 = w.wram[6];
  D.setWramBank(w, 6);
  const p = r6[0x34E] | r6[0x34F] << 8, n = w.high[0x18C];
  D.inBank(w, 0x4A, () => {
    for (let k = 0; k < 4; k++) r6[0x350 + k] = D.rd(w, p + k);
    const c2 = (p + 8 + (((n >> 1 | n << 7) & 0xFF) & 0x1E)) & 0xFFFF;   // rrca
    const c3 = (p + 0x28 + (((n >> 1 | n << 7) & 0xFF) & 0x0E)) & 0xFFFF;
    r6[0x354] = D.rd(w, c2); r6[0x355] = D.rd(w, c2 + 1);
    r6[0x356] = D.rd(w, c3); r6[0x357] = D.rd(w, c3 + 1);
    if (w.vram) D.loadPalettesImmediate(w, 0xD350, 0x02, 0x01);
  });
}


// ---- after nine holes (08:4F75 ShowHalfwayPicture, when wHolesLeft is $0A): ShowPictureScreen 48:5E42, a full
// screen picture with animated tiles for up to $0E10 frames or a button, then InitFontScreen 01:41E8 ----
export function* showHalfwayPicture(sh) {
  const w = sh.w;
  if (w.wram[0][0x839] !== 0x0A) return;
  Scr.forceFadeOut(w, 0x7F);                     // 48:5E42 ShowPictureScreen
  yield* Scr.waitFade(sh);
  clearFrameTasks(w);
  D.setWramBank(w, 1);
  D.resetSprites(w);
  w.high[0x18B] = w.high[0x18A] = 0;
  if (w.vram) D.inBank(w, 0x48, () => {
    D.disableLCDSafely(w);
    w.lcd.wy = 0x90;
    D.loadPalettesMasterOnly(w, 0x5F0C, 0x00, 0x08);
    D.lzTo(w, 0x48, 0x5F4C, 0xD000);
    D.queueVRAMCopy(w, 0xD000, 0xB000, 0x40);
    D.queueVRAMCopy(w, 0xD400, 0xB400, 0x40);
    D.queueAndRunVRAMCopy(w, 0xD800, 0xA800, 0x40);
    D.lzTo(w, 0x48, 0x6776, 0xD000);
    D.queueAndRunVRAMCopy(w, 0xD000, 0xB800, 0x24);
    D.lzTo(w, 0x48, 0x6801, 0xD000);
    D.queueAndRunVRAMCopy(w, 0xD000, 0x9800, 0x24);
    D.enableLCD(w);
  });
  w.wram[0][0x0F8] = 0;
  registerFrameTask(w, 0x01, 0x48, 0x5EE9);      // PictureAnimTiles
  Scr.forceFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  for (let n = 0x0E10; n; n--) {
    yield* sh.advance();
    if (w.high[0x194]) { sh.sound(0x5C); break; }
  }
  if (w.vram) D.inBank(w, 0x01, () => {          // 01:41E8 InitFontScreen
    D.disableLCDSafely(w);
    w.lcd.vbk = 0;                               // 01:41CE LoadFontTiles
    D.startVRAMDMAFromHL(w, 0x42A0, 0x9000, 0x80);
    D.startVRAMDMAFromHL(w, 0x4AA0, 0x8800, 0x60);
    w.lcd.vbk = 0;
    D.startVRAMDMAFromHL(w, 0x5120, 0x87C0, 0x04);
    D.loadPalettesMasterOnly(w, 0x50A0, 0x00, 0x08);
    D.loadPalettesMasterOnly(w, 0x50E0, 0x08, 0x08);
    D.enableLCD(w);
  });
}

export function pictureAnimTiles(w) {           // 48:5EE9 PictureAnimTiles: 4 tiles 48:6900 + (frame & $FC) x 16
  const w0 = w.wram[0];
  if (w.vram) D.inBank(w, 0x48, () => D.queueVRAMCopy(w, (0x6900 + (w0[0x0F8] & 0xFC) * 16) & 0xFFFF, 0xB000, 0x04));
  w0[0x0F8] = (w0[0x0F8] + 1) & 0xFF;
  if (w0[0x0F8] >= 0x30) w0[0x0F8] = 0;
}
