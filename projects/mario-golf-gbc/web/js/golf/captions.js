// Captions (bank 3B): a word picture that flies across the screen ("Nice shot!" and the like). ShowCaption 3B:4339
// loads the caption's tiles to VRAM $8C00 and its palette, and starts CaptionMotionTask 3B:4433, which steps the
// caption's motion script (3B:4014 by kind: a step routine, a keep flag, frames), moves it by its velocity and
// draws its sprite template (CaptionTemplateTable 3B:44DA). The step routines are small: they set the position or
// the velocity ($D338 x, $D33A y, $D33C / $D33E velocities, 8.8 screen pixels).
// The task, its registration and the RAM are kept headless too; the VRAM, palette and sprites only with a display.
import { rb } from "./rom.js";
import { registerFrameTask, unregisterFrameTask } from "./tasks.js";
import * as D from "./render/display.js";

const B = 0x3B;
const r16 = a => rb(B, a) | rb(B, a + 1) << 8;
const set16 = (r, o, v) => { r[o] = v & 0xFF; r[o + 1] = (v >> 8) & 0xFF; };
const get16 = (r, o) => r[o] | r[o + 1] << 8;

// the step routines the motion scripts name (3B:40EC-3B:430F)
const STEPS = {
  0x40EC: r => { set16(r, 0x33C, 0x0016); set16(r, 0x338, 0xF800); },
  0x4103: r => { r[0x338] = 0x00; },             // (its speed sums are lost: it writes $D338 twice, the low byte last)
  0x416F: r => { r[0x33A] = 0x80; r[0x33B] = 0x17; },
  0x4178: r => { set16(r, 0x338, 0x0000); set16(r, 0x33A, 0x4200); },
  0x418F: r => { set16(r, 0x338, 0x6000); set16(r, 0x33A, 0x4200); },
  0x41A6: r => { set16(r, 0x33E, 0x0110); },
  0x41B2: r => { set16(r, 0x33E, 0xFEF0); },
  0x41BE: r => { set16(r, 0x33C, 0xFD9A); set16(r, 0x33E, 0x0110); },
  0x41D5: r => { set16(r, 0x33C, 0xFD9A); set16(r, 0x33E, 0xFEF0); },
  0x41EC: () => {},                              // (nops)
  0x41F8: r => { set16(r, 0x33E, 0x0500); set16(r, 0x33A, 0x9080); },
  0x420F: r => { set16(r, 0x33C, 0x0000); },
  0x421B: r => { set16(r, 0x33E, 0x0000); },
  0x4227: r => { set16(r, 0x33E, get16(r, 0x33E) + 0xFFE0); },
  0x423A: r => { set16(r, 0x33E, get16(r, 0x33E) + 0x0020); },
  0x424D: r => { set16(r, 0x33C, 0x0500); set16(r, 0x338, 0xA000); },
  0x4264: r => { set16(r, 0x33C, get16(r, 0x33C) + 0xFFE0); },
  0x4277: r => { set16(r, 0x33C, 0x0000); },
  0x4283: r => { set16(r, 0x33C, get16(r, 0x33C) + 0x0020); },
  0x4296: r => { set16(r, 0x33C, 0x8000); },
  0x42A8: r => { set16(r, 0x338, 0x0000); set16(r, 0x33A, 0x1C00); },   // (entries into 3B:42A2 / 3B:42BF past the test)
  0x42C5: r => { set16(r, 0x338, 0x0000); set16(r, 0x33A, 0xF200); },
  0x42E2: r => { set16(r, 0x338, 0x0000); set16(r, 0x33A, 0x8000); },
  0x42F9: r => { set16(r, 0x338, 0x0000); set16(r, 0x33A, 0x1A00); },
};
function step(w, addr) {
  const r = w.wram[6];
  if (addr === 0x42A2 || addr === 0x42BF) {      // on odd frames to the top / bottom, else off screen (3B:42E2)
    if (w.high[0x18C] & 1) { set16(r, 0x338, 0); set16(r, 0x33A, addr === 0x42A2 ? 0x1C00 : 0xF200); }
    else STEPS[0x42E2](r);
    return;
  }
  if (addr === 0x42DC) { w.wram[0][0x8A8] = 0x0A; return; }
  const f = STEPS[addr];
  if (!f) throw new Error(`caption step 3B:${addr.toString(16)} is not ported`);
  f(r);
}

export function captionMotionTask(w) {           // 3B:4433 CaptionMotionTask
  const r = w.wram[6];
  D.setWramBank(w, 6);
  for (;;) {
    const f = get16(r, 0x340);
    if (f) {
      step(w, f);
      if (!r[0x342]) r[0x340] = r[0x341] = 0;
    }
    if (r[0x343]) break;
    let p = get16(r, 0x335);                     // the next step of the script
    for (let k = 0; k < 4; k++) r[0x340 + k] = rb(B, p++);
    set16(r, 0x335, p);
  }
  r[0x343]--;
  set16(r, 0x338, get16(r, 0x338) + get16(r, 0x33C));
  set16(r, 0x33A, get16(r, 0x33A) + get16(r, 0x33E));
  r[0x337] = (r[0x337] - 1) & 0xFF;
  if (!r[0x337]) {
    unregisterFrameTask(w, B, 0x4433);
    r[0x455] = 0;                                // 12:4B24 HudPanelsShow
    r[0x454] = 1;                                // 12:4B19 HudFlags
  }
  if (w.vram) {
    const t = r16(0x44DA + 2 * (r[0x344] & 0x0F));
    D.inBank(w, B, () => D.queueSpriteTemplate(w, t, r[0x33B], r[0x339], 0xC0, 0x03));
  }
}

// 3B:4339 ShowCaption: a = caption; advance(n) runs the frames it waits (captions $2C up)
export function* showCaption(sh, a) {
  const w = sh.w, r = w.wram[6];
  r[0x454] = 0;                                  // 12:4B1F HudBlinkOff
  r[0x455] = 1;                                  // 12:4B29 HudPanelsHide
  const entry = k => (0x455B + ((k * 4) & 0xFF)) & 0xFFFF;
  const dsp = fn => { if (w.vram) D.inBank(w, B, fn); };
  if (a >= 0x2C) {                               // two parts of the frame first ($3D, and $3E from $33 up)
    const k = a < 0x3D ? a : 0x3C;
    dsp(() => { D.queueVRAMCopy(w, r16(entry(0x3D) + 2), 0x8C00, 2); D.queueVRAMCopyBreak(w); });
    yield* sh.advance();
    if (k >= 0x33) {
      dsp(() => { D.queueVRAMCopy(w, r16(entry(0x3E) + 2), 0x8C20, 2); D.queueVRAMCopyBreak(w); });
      yield* sh.advance();
    }
  }
  const p = entry(a);
  const sprite = rb(B, p);
  r[0x344] = sprite;
  r[0x345] = rb(B, p + 1) & 0x0F;
  dsp(() => {
    D.loadPalettesImmediate(w, 0x7220 + ((rb(B, p + 1) >> 4) * 8), 0x0B, 0x01);
    let de = 0x8C00, n = sprite;
    if (a >= 0x2C) {
      if (a >= 0x33) { de += 0x40; n = (sprite + 0xFE) & 0xFF; }
      else { de += 0x20; n = (sprite + 0xFF) & 0xFF; }
    }
    D.queueVRAMCopy(w, r16(p + 2), de, (n * 2) & 0xFF);
    D.queueVRAMCopyBreak(w);
  });
  set16(r, 0x335, r16(0x4014 + 2 * r[0x345]));   // the motion script
  r.fill(0, 0x338, 0x344);
  r[0x337] = 0x8C;                               // wCaptionActive: frames to live
  r[0x343] = 0;
  registerFrameTask(w, 0x1F, B, 0x4433);
  captionMotionTask(w);                          // (it runs on into the task once)
}

// 3B:76F8 ShowCaptionAndWait: a = caption; the ball objects' flags $D485 bits 1 and 4 are off meanwhile
export function* showCaptionAndWait(sh, a) {
  const w = sh.w, r6 = w.wram[6];
  yield* sh.advance();
  const keep = r6[0x485];
  r6[0x485] &= 0xED;
  yield* showCaption(sh, a);
  for (;;) {                                     // 3B:4310 WaitCaptionOrButton
    yield* sh.advance();
    if (w.high[0x194]) { yield* sh.viewLeave(); break; }   // 3B:431F ShotViewLeave
    if (!r6[0x337]) break;
  }
  unregisterFrameTask(w, 0x4F, 0x62A7);          // 4F:6184 StopCaptionAnim
  yield* sh.advance();
  r6[0x485] = keep;
}

// ---- the caption's picture object (bank 4F): an animated 12-tile word picture beside the caption ("Fairway",
// "Bunker" ...) at wCaptionObj $CAA0: +0 script (frame, delay pairs; $FF ends), +2 step, +3 delay, +4 tiles,
// +6 VRAM, +8 y, +9 x, +$0A first tile ----
const B4F = 0x4F;
const r4F = a => rb(B4F, a) | rb(B4F, a + 1) << 8;
const OBJ = 0xAA0;

// 4F:619C StartCaptionAnim: a = animation, c = first tile, d / e = position
export function startCaptionAnim(sh, a, c, d, e) {
  const w = sh.w, r = w.wram[0];
  sh.sound(0x8A);
  registerFrameTask(w, 0x64, B4F, 0x62A7);       // CaptionAnimTask
  r[OBJ + 0x0A] = c;
  const v = (c * 16) | 0x8000;
  r[OBJ + 6] = v & 0xFF; r[OBJ + 7] = (v >> 8) & 0xFF;
  r[OBJ + 8] = d; r[OBJ + 9] = e;
  const s = r4F(0x632B + 2 * a);
  r[OBJ] = s & 0xFF; r[OBJ + 1] = s >> 8;
  r[OBJ + 2] = r[OBJ + 3] = 0;
  const t = r4F(0x6569 + 2 * a);
  r[OBJ + 4] = t & 0xFF; r[OBJ + 5] = t >> 8;
  if (!w.vram) return;
  let p = (0x63A9 + a * 32) & 0xFFFF;            // OBJ palette 7 by course (and hole)
  const course = r[0x836], hole = r[0x837];
  if (course === 0) { if (hole === 0x0A) p += 16; }
  else if ([1, 2, 6, 0x0A].includes(course)) { /* the first */ }
  else if (course === 7) {                       // 4F:627B CaptionPaletteByHole3 (each + 8: 4F:6272 SkipPalette)
    if (hole >= 0x0D) p += 8;
    if (hole >= 0x10) p += 8;
    if (hole >= 0x13) p += 8;
  } else if (course === 9) {                     // 4F:6294 CaptionPaletteByHole6
    if (hole >= 0x0D) { p += 16; if (hole >= 0x10) p += 8; }
  } else p += course === 3 ? 8 : course === 4 ? 16 : 24;
  D.inBank(w, B4F, () => D.loadPalettesImmediate(w, p, 0x0F, 0x01));
}

export function captionAnimTask(w) {             // 4F:62A7 CaptionAnimTask: 4F:62B4 CaptionObjStep on $CAA0
  const r = w.wram[0];
  D.setWramBank(w, 6);
  if (!r[OBJ] && !r[OBJ + 1]) return;
  if (!r[OBJ + 3]) {
    const s = (r[OBJ] | r[OBJ + 1] << 8) + 2 * r[OBJ + 2];
    r[OBJ + 2] = (r[OBJ + 2] + 1) & 0xFF;
    const f = rb(B4F, s);
    if (f === 0xFF) { r[OBJ] = r[OBJ + 1] = 0; return; }
    r[OBJ + 3] = rb(B4F, s + 1);
    if (w.vram) {                                // 12 tiles of frame f
      const src = ((r[OBJ + 4] | r[OBJ + 5] << 8) + (f & 0x0F) * 0xC0) & 0xFFFF;
      D.inBank(w, B4F, () => D.queueVRAMCopy(w, src, r[OBJ + 6] | r[OBJ + 7] << 8, 0x0C));
    }
  }
  r[OBJ + 3] = (r[OBJ + 3] - 1) & 0xFF;
  if (w.vram) D.inBank(w, B4F, () => D.queueSpriteTemplate(w, 0x6312, r[OBJ + 9], r[OBJ + 8], r[OBJ + 0x0A], 0x07));
}
