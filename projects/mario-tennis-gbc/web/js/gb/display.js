// The picture as a renderer (native step 2): ppu.js's registers, modes and interrupts, with its line drawn by
// renderLine below instead: the palettes turned into colours once per line (not per pixel), a tile's row of pattern
// bits fetched once for its pixels, no buffers made per line. Every output is ppu.js's, value for value: the
// picture (frame, rgb5), the background alone (bgFrame), the tile-map cell and place of each pixel (pixCell, pixSub,
// the 3D views read them), the window's first column (winX), the sprite layer (spr) and the player's look.
// web/tests/port/display_vs_ppu.mjs draws every line both ways and compares them all.
import { PPU } from "./ppu.js";

const rgba5 = c => 0xFF000000 | ((c >> 10 & 31) << 19) | ((c >> 5 & 31) << 11) | ((c & 31) << 3);

export class Display extends PPU {
  constructor(mem) {
    super(mem);
    this.bgC = new Uint16Array(32); this.objC = new Uint16Array(32);      // palette p, colour i at p * 4 + i: 15-bit
    this.bgRGBA = new Uint32Array(32); this.objRGBA = new Uint32Array(32);
    this.lineRGBA = new Uint32Array(160); this.drawn = new Uint8Array(160);
  }
  palettes() {
    const bp = this.bgPal, op = this.objPal;
    for (let k = 0; k < 32; k++) {
      const b = bp[k * 2] | (bp[k * 2 + 1] << 8), o = op[k * 2] | (op[k * 2 + 1] << 8);
      this.bgC[k] = b; this.bgRGBA[k] = rgba5(b); this.objC[k] = o; this.objRGBA[k] = rgba5(o);
    }
  }
  renderLine() {
    const ly = this.ly, m = this.m, v0 = m.vram[0], v1 = m.vram[1], lcdc = this.lcdc;
    const lineColor = this.lineColor, linePrio = this.linePrio, frame = this.frame, rgb5 = this.rgb5, line = this.lineRGBA;
    const bgFrame = this.bgFrame, pixCell = this.pixCell, pixSub = this.pixSub, base = ly * 160;
    this.palettes();
    const bgC = this.bgC, bgRGBA = this.bgRGBA;
    const wx7 = this.wx - 7, windowOn = (lcdc & 0x20) && this.wy <= ly && this.wx <= 166;
    let windowDrawn = false;
    const L = this.look, lookPix = this.lookPix;
    let lkKey = -1, lkReg = null, lkFade = -1;
    if (L) lookPix.fill(0);
    const SP = this.spr; if (SP) { SP.rgba.fill(0, base, base + 160); SP.idx.fill(0, base, base + 160); }
    // --- background and window: tile by tile, a tile's pattern row fetched once for the pixels it covers ---
    const bgMap = lcdc & 0x08 ? 0x1C00 : 0x1800, winMap = lcdc & 0x40 ? 0x1C00 : 0x1800, unsigned = lcdc & 0x10;
    const bty = (ly + this.scy) & 0xFF, scx = this.scx, wty = this.windowLine;
    // two stretches of the line: the background up to the window's first column, the window from there
    const wStart = windowOn ? Math.min(160, Math.max(0, wx7)) : 160;
    for (let seg = 0; seg < 2; seg++) {
      const win = seg === 1; if (win && !windowOn) break;
      const x1 = win ? 160 : wStart, ty = win ? wty : bty, rowBase = (win ? winMap : bgMap) + ((ty >> 3) << 5), fine = ty & 7, cellFlag = win ? 0x8000 : 0;
      let x = win ? wStart : 0, tx = win ? x - wx7 : (x + scx) & 0xFF;
      if (win && x < x1) windowDrawn = true;
      while (x < x1) {
        const mapIdx = rowBase + (tx >> 3), tile = v0[mapIdx], attr = v1[mapIdx];
        const tileAddr = unsigned ? tile << 4 : 0x1000 + ((tile << 24 >> 24) << 4);
        const row = attr & 0x40 ? 7 - fine : fine, bankN = attr & 0x08 ? 1 : 0, bank = bankN ? v1 : v0;
        const lo = bank[tileAddr + row * 2], hi = bank[tileAddr + row * 2 + 1], flipX = attr & 0x20, pal = (attr & 7) << 2, prio = attr & 0x80 ? 1 : 0;
        const n = Math.min(8 - (tx & 7), x1 - x), cell = cellFlag | mapIdx;
        if (L) { const key = (attr & 0x0F) << 16 | tileAddr; if (key !== lkKey) { lkKey = key; lkReg = L.tileRegions(bankN, tileAddr); lkFade = lkReg ? L.fade(this.bgPal, attr & 7) : -1; } }
        for (let k = 0; k < n; k++, x++, tx++) {
          const sub = tx & 7, bit = flipX ? sub : 7 - sub, ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1), c = bgC[pal | ci], o = (base + x) * 3;
          lineColor[x] = ci; linePrio[x] = prio;
          rgb5[o] = c & 31; rgb5[o + 1] = (c >> 5) & 31; rgb5[o + 2] = (c >> 10) & 31;
          const rgba = bgRGBA[pal | ci]; bgFrame[base + x] = rgba; line[x] = rgba;
          if (L && lkReg && lkFade >= 0) { const lc = L.rgba(lkReg[row * 8 + 7 - bit], lkFade, this.bgPal, attr & 7); if (lc) { lookPix[x] = lc; bgFrame[base + x] = lc; } }   // the look: hero portraits on the BG
          pixCell[base + x] = cell; pixSub[base + x] = fine << 3 | sub;
        }
        if (!win) tx &= 0xFF;
      }
    }
    this.winX[ly] = windowDrawn ? Math.max(0, wx7) : 255;
    if (windowDrawn) this.windowLine++;
    // --- sprites: up to 10 per line, lower OAM index wins (CGB) ---
    if (lcdc & 0x02) {
      const oam = m.oam, h = lcdc & 0x04 ? 16 : 8, drawn = this.drawn, objC = this.objC, objRGBA = this.objRGBA;
      drawn.fill(0);
      let count = 0;
      for (let i = 0; i < 40 && count < 10; i++) {
        const sy = oam[i * 4] - 16, sx = oam[i * 4 + 1] - 8;
        if (ly < sy || ly >= sy + h) continue;
        count++;
        let tile = oam[i * 4 + 2]; const sattr = oam[i * 4 + 3];
        if (h === 16) tile &= 0xFE;
        let srow = ly - sy; if (sattr & 0x40) srow = h - 1 - srow;
        const bank = sattr & 0x08 ? v1 : v0, addr = (tile << 4) + srow * 2;
        const slo = bank[addr], shi = bank[addr + 1], spal = (sattr & 7) << 2;
        let sReg = null, sFade = -1;
        if (L) { sReg = L.tileRegions(sattr & 0x08 ? 1 : 0, (tile + (srow >> 3)) << 4); if (sReg) sFade = L.fade(this.objPal, sattr & 7); }
        for (let px = 0; px < 8; px++) {
          const x = sx + px; if (x < 0 || x >= 160 || drawn[x]) continue;
          const bit = sattr & 0x20 ? px : 7 - px;
          const ci = ((slo >> bit) & 1) | (((shi >> bit) & 1) << 1);
          if (!ci) continue;
          // CGB priority: LCDC bit 0 clear -> sprites always on top; else BG attr priority or OAM priority hide colours 1-3
          if ((lcdc & 0x01) && lineColor[x] !== 0 && (linePrio[x] || (sattr & 0x80))) { drawn[x] = 1; continue; }
          drawn[x] = 1;
          if (L) lookPix[x] = sReg && sFade >= 0 ? L.rgba(sReg[(srow & 7) * 8 + 7 - bit], sFade) : 0;
          const c = objC[spal | ci], o = (base + x) * 3;
          if (SP) { SP.idx[base + x] = i + 1; SP.rgba[base + x] = (L && lookPix[x]) || objRGBA[spal | ci]; }
          rgb5[o] = c & 31; rgb5[o + 1] = (c >> 5) & 31; rgb5[o + 2] = (c >> 10) & 31; line[x] = objRGBA[spal | ci];
        }
      }
    }
    frame.set(line, base);
    if (L) for (let x = 0; x < 160; x++) if (lookPix[x]) frame[base + x] = lookPix[x];
    if (SP && SP.hide) for (let x = 0; x < 160; x++) if (SP.idx[base + x]) frame[base + x] = bgFrame[base + x];
  }
}
