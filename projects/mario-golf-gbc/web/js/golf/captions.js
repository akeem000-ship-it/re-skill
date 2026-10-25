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
export function showCaption(sh, a) {
  const w = sh.w, r = w.wram[6];
  r[0x454] = 0;                                  // 12:4B1F HudBlinkOff
  r[0x455] = 1;                                  // 12:4B29 HudPanelsHide
  const entry = k => (0x455B + ((k * 4) & 0xFF)) & 0xFFFF;
  const dsp = fn => { if (w.vram) D.inBank(w, B, fn); };
  if (a >= 0x2C) {                               // two parts of the frame first ($3D, and $3E from $33 up)
    const k = a < 0x3D ? a : 0x3C;
    dsp(() => { D.queueVRAMCopy(w, r16(entry(0x3D) + 2), 0x8C00, 2); D.queueVRAMCopyBreak(w); });
    sh.advance();
    if (k >= 0x33) {
      dsp(() => { D.queueVRAMCopy(w, r16(entry(0x3E) + 2), 0x8C20, 2); D.queueVRAMCopyBreak(w); });
      sh.advance();
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
