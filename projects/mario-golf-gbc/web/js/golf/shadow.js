// Bank 05's BG shadow: a 32 x 32 copy of the BG map in WRAM5 (tiles $D000, attributes $D400) that the window
// system draws into and queues to VRAM; the map under it comes back from the 64 x 64 buffers (WRAM3 tiles, WRAM2
// attributes) at the scroll position.
import * as D from "./render/display.js";

const rd = D.rd;
const setW = (w, n) => D.setWramBank(w, n);
const testFlagSet = (w, n, on) => {
  const p = 0x840 + (n >> 3), m = 0x80 >> (n & 7);
  if (on) w.wram[0][p] |= m; else w.wram[0][p] &= ~m;
};

// 05:4262 QueueShadowRows: a = first row, c = rows, b = WRAM bank (left mapped): tiles to $9800, attributes to VRAM1
export function queueShadowRows(w, a, c, b) {
  if (!c) return;
  setW(w, b);
  const n = (c << 1) & 0xFF;
  const off = (a << 5) & 0xFFFF;
  D.inBank(w, 0x05, () => {
    D.queueVRAMCopy(w, (0xD000 + off) & 0xFFFF, (0x9800 + off) & 0xFFFF, n);
    D.queueVRAMCopy(w, (0xD400 + off) & 0xFFFF, (0xB800 + off) & 0xFFFF, n);
  });
}

// 05:42AD CopyShadowRowsFramed: a = first row, c = rows: queued 7 rows a frame (a part past row 31 from row 0), flag
// #24 set meanwhile (the last part's size is c mod 7 only for c up to 21, as the code computes it)
export function* copyShadowRowsFramed(sh, a, c) {
  const w = sh.w;
  testFlagSet(w, 24, true);
  yield* sh.advance();
  let d = a;
  let e = c;
  if (c > 7) e = c > 14 ? (c - 14) & 0xFF : c - 7;
  let n = 0;
  for (let r = c; ; ) { n++; if (r <= 7) break; r -= 7; }
  for (; n; n--) {
    let cc = n === 1 ? e : 7;
    if (d < 0x20) {
      const end = d + cc;
      if (end >= 0x20) {
        const over = (end - 0x20) & 0xFF;
        queueShadowRows(w, 0, over, 5);
        cc = (cc - over) & 0xFF;
      }
    }
    queueShadowRows(w, d & 0x1F, cc, 5);
    yield* sh.advance();
    d = (d + 7) & 0xFF;
  }
  testFlagSet(w, 24, false);
}

// 05:4492 RestoreShadowFromMap: 20 shadow rows from the map rows at the scroll ([$C323] on), 5 a frame
export function* restoreShadowFromMap(sh) {
  const w = sh.w;
  let a = rd(w, 0xC323) & 0x3F;
  for (let c = 4; c; c--) {
    for (let b = 5; b; b--) { copyMapRowToShadow(w, a); a = (a + 1) & 0x3F; }
    yield* sh.advance();
  }
}

// 05:450B CopyMapRowToShadow: map row a (WRAM3 tiles, then WRAM2 attributes) from column [$C321], 32 entries (the
// buffer row wraps at 64) through wMapRowBuffer $C7E0 (rotated by the column), into shadow row a & 31; leaves WRAM5
export function copyMapRowToShadow(w, a) {
  const e = a & 0x3F;
  const src0 = (0xD000 + (e << 6) + (rd(w, 0xC321) & 0x3F)) & 0xFFFF;
  for (const [bank, dst] of [[3, 0xD000], [2, 0xD400]]) {
    setW(w, bank);
    let bc = src0, hl = (0xC7E0 + (bc & 0x1F)) & 0xFFFF;
    for (let d = 0x20; d; d--) {
      D.wr(w, hl, rd(w, bc)); hl = (hl + 1) & 0xFFFF;
      bc = (bc + 1) & 0xFFFF;
      if (!(bc & 0x1F)) {
        hl = 0xC7E0;
        if (!(bc & 0x3F)) { bc = (bc - 1) & 0xFFFF; bc = (bc & 0xFF00) | (bc & 0xC0); }
      }
    }
    setW(w, 5);
    D.copyMemoryFast(w, 0xC7E0, (dst + ((e & 0x1F) << 5)) & 0xFFFF, 2);   // 00:03EB
  }
}
