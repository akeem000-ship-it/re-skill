// Bank 42: the menus' animated golfer sprite with its shadow (REVERSE.md "Bank 42"): InitCharSprite 42:400B picks
// the character's record (42:41F2 by wCharId $C810: OBJ palette 6, then pointers to the frame tiles, metasprites
// and animations, copied as pointers to the record's words to $D540-$D547), the animation state $D548-$D551 and the
// shadow tiles; CharSpriteTask 42:4074 (a frame task of banks 41 / 48 / 66) steps the animation and draws both.
import { rw } from "./rom.js";
import * as D from "./render/display.js";

const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
const r16 = (w, a) => rd(w, a) | rd(w, (a + 1) & 0xFFFF) << 8;
const B = 0x42;
const add8 = (hl, a) => (hl + (a & 0xFF)) & 0xFFFF;   // "add a, l / ld l, a / jr nc / inc h"

// 42:400B InitCharSprite
export function initCharSprite(w) {
  setW(w, 6);
  const c = rd(w, 0xC810);
  const rec = rw(B, add8(0x41F2, c << 1));       // CharSpriteDataTable
  D.inBank(w, B, () => D.loadPalettesMasterOnly(w, rw(B, rec), 0x0E, 0x01));
  setW(w, 6);
  for (let k = 0; k < 4; k++) { const p = (rec + 2 + 2 * k) & 0xFFFF; wr(w, 0xD540 + 2 * k, p & 0xFF); wr(w, 0xD541 + 2 * k, p >> 8); }
  [0x00, 0xFF, 0x01, 0xFF, 0x09, 0x4A, 0x00, 0x00, 0x01].forEach((v, k) => wr(w, 0xD548 + k, v));
  loadCharShadowTiles(w);
}

// 42:40D2 CharAnimFramePtr: entry [$D549] (4 bytes: tile set and metasprite, timer, dx, dy) of animation [$D548],
// whose pointer is the word at [$D544] + 2 x animation (the record's own words from +6: one dereference fewer than
// the tile and metasprite lists)
function charAnimFramePtr(w) {
  const anim = rd(w, 0xD548), frame = rd(w, 0xD549);
  const p = rw(B, add8(r16(w, 0xD544), anim << 1));
  return add8(p, frame << 2);
}

// 42:4074 CharSpriteTask: a delay [$D550] first; the upload-pending count [$D551] down; the frame timer [$D54A]: at 0
// the next frame (its +1 is the new timer; $FF ends the animation: the next one [$D54B] unless its bit 7, frame 0),
// its tiles loaded; then the metasprite and the shadow drawn
export function charSpriteTask(w) {
  D.inBank(w, B, () => {
    setW(w, 6);
    const dl = rd(w, 0xD550);
    if (dl) { wr(w, 0xD550, dl - 1); return; }
    if (rd(w, 0xD551)) wr(w, 0xD551, rd(w, 0xD551) - 1);
    const t = (rd(w, 0xD54A) - 1) & 0xFF;
    wr(w, 0xD54A, t);
    if (!t) {
      wr(w, 0xD549, (rd(w, 0xD549) + 1) & 0xFF);
      let p = charAnimFramePtr(w);
      if (rd(w, p) !== 0xFF) wr(w, 0xD54A, rd(w, (p + 1) & 0xFFFF));
      else {
        const n = rd(w, 0xD54B);
        if (!(n & 0x80)) { wr(w, 0xD548, n); wr(w, 0xD54B, 0xFF); }
        wr(w, 0xD549, 0);
        p = charAnimFramePtr(w);
        wr(w, 0xD54A, rd(w, (p + 1) & 0xFFFF));
      }
      loadCharAnimTiles(w);
    }
    drawCharMetasprite(w);
    drawCharShadow(w);
  });
}

// 42:40F1 LoadCharAnimTiles: the frame's tile set (LZ, from the list at [[$D540]]) to WRAM6 $D000, queued to VRAM1
// $8000 ($20 blocks) with a break after; $D551 = 1
function loadCharAnimTiles(w) {
  const set = rd(w, charAnimFramePtr(w));
  const list = rw(B, r16(w, 0xD540));
  D.lzTo(w, B, rw(B, add8(list, set << 1)), 0xD000);
  D.queueVRAMCopy(w, 0xD000, 0xA000, 0x20);
  D.queueVRAMCopyBreak(w);
  setW(w, 6);
  wr(w, 0xD551, 1);
}

// 42:4128 DrawCharMetasprite: 42:414A ApplyCharFrameOffset (the frame's dx, dy added to $D54E / $D54F; the position
// $D54C + $D54E, $D54D + $D54F), then metasprite [frame +0] of the list at [[$D542]] with attribute $0E, tile 0
function drawCharMetasprite(w) {
  const p = (charAnimFramePtr(w) + 2) & 0xFFFF;
  wr(w, 0xD54E, (rd(w, p) + rd(w, 0xD54E)) & 0xFF);
  wr(w, 0xD54F, (rd(w, p + 1) + rd(w, 0xD54F)) & 0xFF);
  const d = (rd(w, 0xD54C) + rd(w, 0xD54E)) & 0xFF, e = (rd(w, 0xD54D) + rd(w, 0xD54F)) & 0xFF;
  const ms = rd(w, charAnimFramePtr(w));          // (the frame's first byte, as for the tiles)
  const list = rw(B, r16(w, 0xD542));
  D.queueSpriteTemplate(w, rw(B, add8(list, ms << 1)), e, d, 0x00, 0x0E);
}

// 42:416B LoadCharShadowTiles: the three shadow sizes (LZ 42:4200 / 421C / 4238 to WRAM1 $D000) to VRAM1 $8200 /
// $8280 / $8300
function loadCharShadowTiles(w) {
  D.processVRAMCopyQueue(w);
  setW(w, 1);
  for (const [src, dst] of [[0x4200, 0xA200], [0x421C, 0xA280], [0x4238, 0xA300]]) {
    D.lzTo(w, B, src, 0xD000);
    D.inBank(w, B, () => D.queueAndRunVRAMCopy(w, 0xD000, dst, 0x06));
  }
}

// 42:41B1 DrawCharShadow: the size k by the jump height [$D54F] (0 while it is within -8 of 1, 1 within -16, else 2):
// metasprite CharShadowSpriteTable 42:4254 [k], tile $20 + 8k, attribute $0E, at ($D54C + 4, $D54D + $3E)
function drawCharShadow(w) {
  let a = (rd(w, 0xD54F) - 1) & 0xFF, k = 0;
  if (a + 8 <= 0xFF) { k = 1; a = (a + 8) & 0xFF; if (a + 8 <= 0xFF) k = 2; }
  const hl = rw(B, 0x4254 + 2 * k);
  setW(w, 6);
  D.queueSpriteTemplate(w, hl, (rd(w, 0xD54D) + 0x3E) & 0xFF, (rd(w, 0xD54C) + 4) & 0xFF, (0x20 + 8 * k) & 0xFF, 0x0E);
}
