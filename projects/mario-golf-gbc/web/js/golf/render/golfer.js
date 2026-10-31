// Bank 11: the golfer's big sprite behind the ball (view 4). The animation's state is swing.js (11:6E3E
// GolfAnimTask); here its tiles and sprites: each new frame's 16 tiles queued to VRAM1 $8000 (from the golfer's
// list 11:6EEF), and every frame the frame's sprite template (11:6F0F) at (x $50, y $7C), flipped for a left-handed
// golfer, in the current player's palette.
import { rb } from "../rom.js";
import * as D from "./display.js";

const B = 0x11;
const r16 = a => rb(B, a) | rb(B, a + 1) << 8;
const list = golfer => r16(0x6EEF + 2 * golfer);   // (idx, bank) of the golfer's tile list

export function loadGolferSpriteTiles(w, golfer, entry, de) {   // 11:6E1E LoadGolferSpriteTiles (00:071D: HDMA now)
  D.farDMAIndexed(w, list(golfer), entry, de, 0x10);
}
function loadGolferFrameTiles(w, golfer, entry, de) {           // 11:6E08 LoadGolferFrameTiles (00:06F1: queued)
  D.farQueueIndexed(w, list(golfer), entry, de, 0x10);
}

export function golfAnimDraw(w, loaded) {        // 11:6E85-11:6ECC (the tail of GolfAnimTask)
  const r6 = w.wram[6], golfer = r6[0x332], frame = r6[0x467];
  if (loaded) loadGolferFrameTiles(w, golfer, frame, 0xA000);
  const t = r16((r16(0x6F0F + 2 * golfer) + 2 * frame) & 0xFFFF);
  let b = 0x0C;
  if (r6[0x333]) b |= 0x20;
  if (w.wram[0][0x835] & 1) b |= 0x01;
  D.queueSpriteTemplate(w, t, 0x7C, 0x50, 0x00, b);
}
