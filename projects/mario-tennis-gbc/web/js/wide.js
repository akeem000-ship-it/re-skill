// Wide (4:3) 2D composite of the current frame: the Game Boy shows 160 of the court map's 256 columns, so on
// a court the screen can be widened to 192 px with the real map content on both sides, unstretched. The BG,
// the window and the OAM sprites are composed from VRAM with the frame's scroll (no mid-frame raster effects;
// courts have none). Sprites the game hid as off-screen stay hidden, as on the console.
export const WIDE_W = 192, WIDE_H = 144, WIDE_PAD = (WIDE_W - 160) / 2;
const col5 = (pal, p, i) => { const o = p * 8 + i * 2, c = pal[o] | (pal[o + 1] << 8); return 0xFF000000 | ((c >> 10 & 31) * 8 << 16) | ((c >> 5 & 31) * 8 << 8) | ((c & 31) * 8); };
export function composeWide(gb, out, bgIdx) {          // out: Uint32Array(WIDE_W * WIDE_H) ABGR; bgIdx: Uint8Array same size (BG colour index)
  const m = gb.mem, p = gb.ppu, v0 = m.vram[0], v1 = m.vram[1], lcdc = p.lcdc, bgPal = p.bgPal, objPal = p.objPal;
  const bgBase = lcdc & 0x08 ? 0x1C00 : 0x1800, winBase = lcdc & 0x40 ? 0x1C00 : 0x1800, tileAddr = t => lcdc & 0x10 ? t << 4 : 0x1000 + ((t << 24 >> 24) << 4);
  const winOn = (lcdc & 0x20) && p.wy < 144 && p.wx < 167, wx0 = p.wx - 7 + WIDE_PAD, wy0 = p.wy;
  for (let y = 0; y < WIDE_H; y++) {
    const my = (y + p.scy) & 255;
    for (let x = 0; x < WIDE_W; x++) {
      let base, tx, ty, px, py;
      if (winOn && y >= wy0 && x >= wx0) { base = winBase; px = x - wx0; py = y - wy0; tx = px >> 3; ty = py >> 3; }
      else { const mx = (x - WIDE_PAD + p.scx) & 255; base = bgBase; tx = mx >> 3; ty = my >> 3; px = mx; py = my; }
      const i = base + (ty & 31) * 32 + (tx & 31), tile = v0[i], attr = v1[i], bank = attr & 8 ? v1 : v0, addr = tileAddr(tile);
      const row = attr & 0x40 ? 7 - (py & 7) : (py & 7), bit = attr & 0x20 ? (px & 7) : 7 - (px & 7);
      const lo = bank[addr + row * 2], hi = bank[addr + row * 2 + 1], ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1), o = y * WIDE_W + x;
      out[o] = col5(bgPal, attr & 7, ci); bgIdx[o] = ci | (attr & 0x80 ? 4 : 0);
    }
  }
  if (!(lcdc & 0x02)) return;
  const oam = m.oam, tall = lcdc & 4, hgt = tall ? 16 : 8;
  for (let n = 39; n >= 0; n--) {                       // lower OAM index drawn last = on top
    const sy = oam[n * 4] - 16, sx = oam[n * 4 + 1] - 8; if (sy <= -16 || sy >= 144 || sx <= -8 || sx >= 160) continue;
    let tile = oam[n * 4 + 2]; const attr = oam[n * 4 + 3]; if (tall) tile &= 0xFE;
    const bank = attr & 8 ? v1 : v0, pal = attr & 7;
    for (let y = 0; y < hgt; y++) {
      const yy = sy + y; if (yy < 0 || yy >= WIDE_H) continue;
      const row = attr & 0x40 ? hgt - 1 - y : y, addr = (tile + (row >> 3)) * 16 + (row & 7) * 2, lo = bank[addr], hi = bank[addr + 1];
      for (let x = 0; x < 8; x++) {
        const xx = sx + x + WIDE_PAD; if (xx < WIDE_PAD || xx >= WIDE_PAD + 160) continue;
        const bit = attr & 0x20 ? x : 7 - x, ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1); if (!ci) continue;
        const o = yy * WIDE_W + xx; if ((attr & 0x80) && (bgIdx[o] & 3)) continue;   // behind non-zero BG
        out[o] = col5(objPal, pal, ci);
      }
    }
  }
}
