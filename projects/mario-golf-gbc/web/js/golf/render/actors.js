// Bank 04's map actors as the golf round uses them: actor 0 (WRAM4 $D000, $40 bytes) is the golfer's sprite on the
// course and green views. Its character header (04:4F1C) names the animation lists and frame tiles; GolferActorTask
// steps the animation and queues a new frame's tiles to VRAM when the frame or the facing changes.
// Fields: +$10 facing, +$12 moving, +$20 frame tile table, +$22 animation table, +$24 / +$26 animation start /
// pointer, +$28 / +$29 last frame / facing code, +$2A timer, +$2B bank, +$2D palette, +$30 character, +$31 animation,
// +$32 / +$33 facing override, +$34 hold, +$35 / +$36 speeds, +$38 VRAM address.
import { rb } from "../rom.js";
import * as D from "./display.js";

const far = (bank, a) => rb(a < 0x4000 ? 0 : bank, a);
const farWord = (bank, a) => far(bank, a) | far(bank, (a + 1) & 0xFFFF) << 8;   // 00:0626 FarReadWord

export function testGameFlag(w, n) { return w.wram[0][0x840 + (n >> 3)] & (0x80 >> (n & 7)) ? 1 : 0; }   // 00:2D10 TestGameFlag (masks 00:2D08: $80 >> (n & 7))

export function golferActorShow(w) {             // 04:57BA GolferActorShow (the task is registered by the caller)
  const keep = w.high[0x196];
  const ch = far(0x04, 0x57F1 + w.wram[6][0x332]);
  D.setWramBank(w, 4);
  actorSetCharacter(w, 0xD000, ch);
  actorSetAnim(w, 0xD000, 2);
  w.high[0x196] = keep;
}

export function golferActorSetAnim(w, a) {      // 04:57A1 GolferActorSetAnim
  const keep = w.high[0x196];
  actorSetAnim(w, 0xD000, a);
  w.high[0x196] = keep;
}

export function golferActorAnim3(w) {            // 04:5808 GolferActorAnim3 (04:4E93 ActorSetAnim3Alt)
  const keep = w.high[0x196];
  D.setWramBank(w, 4);
  const r = w.wram[4], p = 0x000;
  r[p + 0x31] = 3;
  const bank = r[p + 0x2B];
  const v = farWord(bank, ((r[p + 0x22] | r[p + 0x23] << 8) + 6) & 0xFFFF);
  r[p + 0x24] = v & 0xFF; r[p + 0x25] = v >> 8;
  const v2 = (v + 8) & 0xFFFF;
  r[p + 0x26] = v2 & 0xFF; r[p + 0x27] = v2 >> 8;
  r[p + 0x2A] = 0;
  w.high[0x196] = keep;
}

// 04:4D42 ActorSetCharacter: hl = actor (WRAM4), a = character
export function actorSetCharacter(w, hl, a) {
  const r = w.wram[4], p = hl - 0xD000, w0 = w.wram[0];
  r[p + 0x30] = a;
  const t = (0x4F1C + 2 * a) & 0xFFFF;
  const ref = far(0x04, t) | far(0x04, t + 1) << 8;   // (idx, bank)
  D.setWramBank(w, 4);
  const bank = ref >> 8;
  r[p + 0x2B] = bank;
  const src = farWord(bank, 0x4000 + (ref & 0xFF));   // 00:021A CopyDataFromBank: 16 bytes -> $C400
  for (let k = 0; k < 16; k++) w0[0x400 + k] = far(bank, (src + k) & 0xFFFF);
  r[p + 0x2D] = w0[0x400];
  r[p + 0x20] = w0[0x402]; r[p + 0x21] = w0[0x403];
  r[p + 0x22] = w0[0x404]; r[p + 0x23] = w0[0x405];
  if (r[p + 0x2D] === 0x63) {                    // its own palette
    const s = w0[0x406] | w0[0x407] << 8;
    for (let k = 0; k < 8; k++) w0[0x410 + k] = far(bank, (s + k) & 0xFFFF);
    let b = 3;
    const was = w0[0x289];
    w0[0x289] = (was + 1) & 0xFF;
    if (was) b--;
    actorLoadPalette(w, p, b, 0xC410);
  } else if (testGameFlag(w, 21)) {
    actorLoadPalette(w, p, 3, 0x4D0B + ((((r[p + 0x2D] - 4) & 0xFF) << 3) & 0xFF), 0x04);
  }
  r[p + 0x28] = 0xFF; r[p + 0x29] = 0xFF;
  r[p + 0x35] = 1; r[p + 0x36] = 4;
  actorSetAnim(w, hl, 0);
}

function actorLoadPalette(w, p, b, hl, bank) {   // 04:4E02 ActorLoadPalette: OBJ palette b (master copy only)
  w.wram[4][p + 0x2D] = b;
  D.inBank(w, bank ?? w.high[0x195], () => D.loadPalettesMasterOnly(w, hl, b + 8, 1));
}

export function actorSetAnim(w, hl, a) {         // 04:4E51 ActorSetAnim
  const r = w.wram[4], p = hl - 0xD000;
  D.setWramBank(w, 4);
  r[p + 0x31] = a;
  const v = farWord(r[p + 0x2B], ((r[p + 0x22] | r[p + 0x23] << 8) + 2 * a) & 0xFFFF);
  r[p + 0x24] = r[p + 0x26] = v & 0xFF;
  r[p + 0x25] = r[p + 0x27] = v >> 8;
  r[p + 0x2A] = 0;
}

// 04:4ACD ActorAnimStep: returns the frame (c); sound(id) for the list's $FC entries
export function actorAnimStep(w, p, sound) {
  const r = w.wram[4], bank = w.wram[0][0x286];
  let c;
  if (r[p + 0x34] || r[p + 0x2A]) c = r[p + 0x28];
  else {
    for (;;) {
      if (r[p + 0x2A]) { c = r[p + 0x28]; break; }   // (a $F0-$FB entry sets the timer to $FF)
      const ptr = r[p + 0x26] | r[p + 0x27] << 8;
      const v = farWord(bank, ptr);
      c = v & 0xFF; const b = v >> 8;
      if (c < 0xF0) {
        r[p + 0x2A] = b;
        const n = (ptr + 2) & 0xFFFF;
        r[p + 0x26] = n & 0xFF; r[p + 0x27] = n >> 8;
        break;
      }
      if (c === 0xFF) {                          // back to the start + b
        const n = ((r[p + 0x24] | r[p + 0x25] << 8) + b) & 0xFFFF;
        r[p + 0x26] = n & 0xFF; r[p + 0x27] = n >> 8;
      } else if (c === 0xFE) actorSetAnim(w, 0xD000 + p, b);
      else if (c === 0xFC) {
        sound(b);                                // 00:2C19 PlaySoundManaged
        const n = (ptr + 2) & 0xFFFF;
        r[p + 0x26] = n & 0xFF; r[p + 0x27] = n >> 8;
      } else r[p + 0x2A] = 0xFF;
    }
  }
  const sp = r[p + (r[p + 0x12] ? 0x36 : 0x35)];
  r[p + 0x2A] = r[p + 0x2A] >= sp ? r[p + 0x2A] - sp : 0;
  return c;
}

export function golferActorTask(w, sound = () => {}) {   // 04:573F GolferActorTask
  D.setWramBank(w, 4);
  const r = w.wram[4], p = 0;
  w.wram[0][0x286] = r[p + 0x2B];                // wActorBank
  const c = actorAnimStep(w, p, sound);
  if (!r[p + 0x33]) r[p + 0x32] = r[p + 0x10];
  const b = far(0x04, 0x4ABD + ((((r[p + 0x32] + 8) & 0xFF) >> 4) & 0x0F));   // FacingFrameTable 04:4ABD
  if (r[p + 0x28] === c && r[p + 0x29] === b) return;
  r[p + 0x29] = b; r[p + 0x28] = c;
  const table = r[p + 0x20] | r[p + 0x21] << 8, de = r[p + 0x38] | r[p + 0x39] << 8;
  const bank = w.wram[0][0x286];                 // 26:4012 ActorCopyFrameTiles (the same code in banks 20-26)
  w.high[0x195] = bank;                          // (it switches hROMBank and leaves it: FarCall restores it)
  const src = (farWord(bank, (table + 2 * c) & 0xFFFF) + b) & 0xFFFF;
  D.queueVRAMCopy(w, src, de, 4);
}
