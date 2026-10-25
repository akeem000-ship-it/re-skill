// Small display routines of other banks that run during a round.
import { rd, queueSpriteTemplate } from "./display.js";

export function courseTitleWaveTask(w) {         // 0F:4160 CourseTitleWaveTask (left over from the course select)
  const e = rd(w, 0x4179 + (w.high[0x18C] & 0x3F));
  queueSpriteTemplate(w, 0x41B9, e, 0x00, 0xE0, 0x04);
}
