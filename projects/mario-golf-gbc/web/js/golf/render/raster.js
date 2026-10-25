// The Game Boy Color screen drawn from the display model the ported game code writes (render/display.js): two
// 8 KB VRAM banks, OAM, the BG and OBJ palette RAM and the LCD registers (LCDC, SCX, SCY, WX, WY). This is the
// display hardware's job, not the game's: the background (and window) per pixel with its CGB attributes (palette,
// VRAM bank, flips, priority), then up to 10 sprites a line in OAM order (lower index in front), sprites behind
// BG colours 1-3 when LCDC bit 0 is set and either the BG attribute or the sprite asks. The game changes no LCD
// register in mid-frame (its STAT handler is a lone reti; REVERSE.md "Vectors"), so one register set per frame.
// Output: rgb5 (160 x 144 x 3 values 0-31, as the colours are stored) and rgba (Uint32 0xAABBGGRR for a canvas).
export const W = 160, H = 144;

export function rasterize(d, rgb5 = new Uint8Array(W * H * 3), rgba = null) {
  const { vram, oam, bgPal, objPal } = d;
  const lcdc = d.lcdc, v0 = vram[0], v1 = vram[1];
  if (!(lcdc & 0x80)) {                          // LCD off: a white screen
    rgb5.fill(31);
    if (rgba) rgba.fill(0xFFFFFFFF);
    return rgb5;
  }
  const lineColor = new Uint8Array(W), linePrio = new Uint8Array(W), drawn = new Uint8Array(W);
  let windowLine = 0;
  const sprH = lcdc & 0x04 ? 16 : 8;
  for (let ly = 0; ly < H; ly++) {
    const base = ly * W;
    const windowOn = (lcdc & 0x20) && d.wy <= ly && d.wx <= 166;
    let windowDrawn = false;
    for (let x = 0; x < W; x++) {
      let tx, ty, map;
      if (windowOn && x >= d.wx - 7) { tx = x - (d.wx - 7); ty = windowLine; map = lcdc & 0x40 ? 0x1C00 : 0x1800; windowDrawn = true; }
      else { tx = (x + d.scx) & 0xFF; ty = (ly + d.scy) & 0xFF; map = lcdc & 0x08 ? 0x1C00 : 0x1800; }
      const cell = map + ((ty >> 3) << 5) + (tx >> 3);
      const tile = v0[cell], attr = v1[cell];
      const addr = lcdc & 0x10 ? tile << 4 : 0x1000 + ((tile << 24 >> 24) << 4);
      const row = attr & 0x40 ? 7 - (ty & 7) : ty & 7;
      const bank = attr & 0x08 ? v1 : v0;
      const lo = bank[addr + row * 2], hi = bank[addr + row * 2 + 1];
      const bit = attr & 0x20 ? tx & 7 : 7 - (tx & 7);
      const ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
      lineColor[x] = ci; linePrio[x] = attr >> 7;
      put(rgb5, base + x, bgPal, attr & 7, ci);
    }
    if (windowDrawn) windowLine++;
    if (lcdc & 0x02) {
      drawn.fill(0);
      let count = 0;
      for (let i = 0; i < 40 && count < 10; i++) {
        const sy = oam[i * 4] - 16, sx = oam[i * 4 + 1] - 8;
        if (ly < sy || ly >= sy + sprH) continue;
        count++;
        let tile = oam[i * 4 + 2];
        const attr = oam[i * 4 + 3];
        if (sprH === 16) tile &= 0xFE;
        const row = attr & 0x40 ? sprH - 1 - (ly - sy) : ly - sy;
        const bank = attr & 0x08 ? v1 : v0, addr = (tile << 4) + row * 2;
        const lo = bank[addr], hi = bank[addr + 1];
        for (let px = 0; px < 8; px++) {
          const x = sx + px;
          if (x < 0 || x >= W || drawn[x]) continue;
          const bit = attr & 0x20 ? px : 7 - px;
          const ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
          if (!ci) continue;
          drawn[x] = 1;
          if ((lcdc & 0x01) && lineColor[x] && (linePrio[x] || (attr & 0x80))) continue;
          put(rgb5, base + x, objPal, attr & 7, ci);
        }
      }
    }
  }
  if (rgba) for (let i = 0; i < W * H; i++)
    rgba[i] = 0xFF000000 | (rgb5[i * 3 + 2] << 19) | (rgb5[i * 3 + 1] << 11) | (rgb5[i * 3] << 3);
  return rgb5;
}

function put(rgb5, p, pal, n, ci) {
  const o = n * 8 + ci * 2, c = pal[o] | pal[o + 1] << 8;
  rgb5[p * 3] = c & 31; rgb5[p * 3 + 1] = (c >> 5) & 31; rgb5[p * 3 + 2] = (c >> 10) & 31;
}
