// The people of the 3D layers (the gallery, the caddies, the overworld's walkers): the game's own map characters, read from the ROM at
// run time: a character's header (the table 04:4F1C: (idx, bank) of 16 bytes in banks 20-26: its palette, its frame tile table, its
// animation table, as js/golf/render/actors.js actorSetCharacter reads them), a frame's four tiles (16 x 16 pixels: the left 8 x 16
// half then the right, as the actor drawing queues two 8 x 16 sprites) at the facing's offset (FacingFrameTable 04:4ABD), coloured with a
// palette given here (the gallery's are recoloured, so a crowd of a few characters looks like many people). Render only.
import { rb } from "../golf/rom.js";

const far = (bank, a) => rb(a < 0x4000 ? 0 : bank, a);
const farWord = (bank, a) => far(bank, a) | far(bank, (a + 1) & 0xFFFF) << 8;

export function character(id) {
  const t = 0x4F1C + 2 * id, ref = far(0x04, t) | far(0x04, t + 1) << 8, bank = ref >> 8;
  if (bank < 0x20 || bank > 0x26) return null;
  const src = farWord(bank, 0x4000 + (ref & 0xFF)), h = [];
  for (let k = 0; k < 16; k++) h.push(far(bank, (src + k) & 0xFFFF));
  return { id, bank, pal: h[0], frames: h[2] | h[3] << 8, anims: h[4] | h[5] << 8, ownPal: h[6] | h[7] << 8 };
}
export const facingOffset = f => far(0x04, 0x4ABD + (f & 0x0F));       // FacingFrameTable: the tile offset of a facing
// the 16 x 16 picture of frame c at facing offset b; colours: 4 RGB triples (index 0 transparent)
export function personPicture(ch, c, b, colours) {
  const src = (farWord(ch.bank, (ch.frames + 2 * c) & 0xFFFF) + b) & 0xFFFF, rgba = new Uint8Array(16 * 16 * 4);
  let any = false;
  for (let t = 0; t < 4; t++) for (let r = 0; r < 8; r++) {
    const o = (src + t * 16 + r * 2) & 0xFFFF, lo = far(ch.bank, o), hi = far(ch.bank, o + 1);
    const X0 = (t >> 1) * 8, Y = (t & 1) * 8 + r;
    for (let x = 0; x < 8; x++) {
      const ci = ((lo >> (7 - x)) & 1) | (((hi >> (7 - x)) & 1) << 1); if (!ci) continue; any = true;
      const q = (Y * 16 + X0 + x) * 4, c3 = colours[ci]; rgba[q] = c3[0]; rgba[q + 1] = c3[1]; rgba[q + 2] = c3[2]; rgba[q + 3] = 255;
    }
  }
  return any ? { rgba, w: 16, h: 16 } : null;
}
// a character's own palette from the ROM when it has one (header palette $63: 8 bytes at its own address), else null
export function ownColours(ch) {
  if (ch.pal !== 0x63) return null;
  const out = [];
  for (let k = 0; k < 4; k++) { const c = far(ch.bank, ch.ownPal + 2 * k) | far(ch.bank, ch.ownPal + 2 * k + 1) << 8; out.push([(c & 31) << 3, ((c >> 5) & 31) << 3, ((c >> 10) & 31) << 3]); }
  return out;
}
// the shared actor palettes (04:4D0B, 8 bytes each, for palette numbers 4 up)
export function tableColours(n) {
  const out = [], a = 0x4D0B + (((n - 4) & 0xFF) << 3);
  for (let k = 0; k < 4; k++) { const c = far(0x04, a + 2 * k) | far(0x04, a + 2 * k + 1) << 8; out.push([(c & 31) << 3, ((c >> 5) & 31) << 3, ((c >> 10) & 31) << 3]); }
  return out;
}
