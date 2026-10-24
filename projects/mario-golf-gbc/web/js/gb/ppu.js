// Game Boy Color PPU: scanline renderer with the CGB attribute rules, STAT/LYC interrupts, HBlank DMA
// hook. Output: frame (Uint32Array 160x144, 0xAABBGGRR) and a 5-bit RGB framebuffer (Uint8Array
// 160*144*3, values 0-31) for exact comparisons with another emulator.
export class PPU {
  constructor(mem) {
    this.m = mem;
    this.lcdc = 0x91; this.stat = 0x85; this.scy = 0; this.scx = 0; this.ly = 0; this.lyc = 0; this.wy = 0; this.wx = 0;
    this.bgp = 0xFC; this.obp0 = 0xFF; this.obp1 = 0xFF;
    this.bcps = 0; this.ocps = 0; this.bgPal = new Uint8Array(64); this.objPal = new Uint8Array(64);
    this.dots = 0; this.mode = 2; this.windowLine = 0; this.frameDone = false; this.statLine = false;
    // frameStart: a frame ends where PyBoy ends one (line 153 -> 0, the LCD switched on, or 70224 dots with the
    // LCD off), so inputs given per frame land at the same point as in PyBoy; firstFrame: the frame after the
    // LCD is switched on shows blank, as on the hardware (and PyBoy)
    this.frameStart = false; this.offDots = 0; this.firstFrame = false; this.startDelay = false;
    this.frame = new Uint32Array(160 * 144); this.rgb5 = new Uint8Array(160 * 144 * 3);
    this.lineColor = new Uint8Array(160); this.linePrio = new Uint8Array(160);   // BG colour index 0-3 and attribute priority per pixel
    this.bgFrame = new Uint32Array(160 * 144);   // background + window only (no sprites), 0xAABBGGRR
    this.pixCell = new Uint16Array(160 * 144);   // per pixel: the tile-map entry shown ($1800-$1FFF offset), +$8000 when from the window
    this.pixSub = new Uint8Array(160 * 144);     // per pixel: its place in that tile, row << 3 | column (unflipped)
    this.winX = new Uint8Array(144).fill(255);  // per scanline: first screen x drawn from the window layer (255 = none); raster splits included
    this.frames = 0;
    this.look = null;                            // web/js/look: the player's look colours the hero in `frame` only (never rgb5)
    this.lookPix = new Uint32Array(160);
    this.spr = null;                             // web/js/look/detail.js: { rgba, idx, hide }: the sprite layer as drawn (look colours), and the OAM index + 1 per pixel; hide = leave sprites out of `frame`
  }
  read(r) {
    switch (r) {
      case 0x40: return this.lcdc; case 0x41: return this.stat | 0x80; case 0x42: return this.scy; case 0x43: return this.scx;
      case 0x44: return this.ly; case 0x45: return this.lyc; case 0x47: return this.bgp; case 0x48: return this.obp0; case 0x49: return this.obp1;
      case 0x4A: return this.wy; case 0x4B: return this.wx;
      case 0x68: return this.bcps | 0x40; case 0x69: return this.bgPal[this.bcps & 0x3F];
      case 0x6A: return this.ocps | 0x40; case 0x6B: return this.objPal[this.ocps & 0x3F];
    }
    return 0xFF;
  }
  write(r, v) {
    switch (r) {
      case 0x40: {
        const was = this.lcdc & 0x80; this.lcdc = v;
        if (was && !(v & 0x80)) { this.ly = 0; this.dots = 0; this.mode = 0; this.stat = (this.stat & 0xFC); this.windowLine = 0; this.offDots = 0; this.frameStart = true; this.blank(); }
        else if (!was && (v & 0x80)) {
          // the LCD restarts when the writing instruction ends (step() skips its remaining dots); its first line is
          // 8 dots short and line 153 of that frame 8 dots long, so the frame keeps its length (PyBoy's timing)
          this.dots = 8; this.mode = 2; this.stat = (this.stat & 0xFC) | 2; this.checkStat(); this.frameStart = true; this.firstFrame = true;
          this.startDelay = !globalThis.NO_DELAY;
        }
        return;
      }
      case 0x41: this.stat = (this.stat & 0x07) | (v & 0x78); this.checkStat(); return;
      case 0x42: this.scy = v; return; case 0x43: this.scx = v; return;
      case 0x44: return;
      case 0x45: this.lyc = v; this.checkStat(); return;
      case 0x47: this.bgp = v; return; case 0x48: this.obp0 = v; return; case 0x49: this.obp1 = v; return;
      case 0x4A: this.wy = v; return; case 0x4B: this.wx = v; return;
      case 0x68: this.bcps = v & 0xBF; return;
      case 0x69: this.bgPal[this.bcps & 0x3F] = v; if (this.bcps & 0x80) this.bcps = 0x80 | ((this.bcps + 1) & 0x3F); return;
      case 0x6A: this.ocps = v & 0xBF; return;
      case 0x6B: this.objPal[this.ocps & 0x3F] = v; if (this.ocps & 0x80) this.ocps = 0x80 | ((this.ocps + 1) & 0x3F); return;
    }
  }
  // STAT interrupt line: rises when any enabled source becomes active (LYC, mode 0/1/2)
  checkStat() {
    const coincidence = this.ly === this.lyc;
    this.stat = (this.stat & 0xFB) | (coincidence ? 4 : 0);
    if (!(this.lcdc & 0x80)) { this.statLine = false; return; }
    const line = ((this.stat & 0x40) && coincidence) || ((this.stat & 0x08) && this.mode === 0) ||
                 ((this.stat & 0x10) && this.mode === 1) || ((this.stat & 0x20) && this.mode === 2);
    if (line && !this.statLine) this.m.requestInterrupt(2);
    this.statLine = !!line;
  }
  setMode(mode) { this.mode = mode; this.stat = (this.stat & 0xFC) | mode; this.checkStat(); }

  // advance by n dots (4.19 MHz); returns extra CPU cycles consumed by an HBlank DMA block
  step(n) {
    if (!(this.lcdc & 0x80)) {
      this.offDots += n;
      if (this.offDots >= 70224) { this.offDots -= 70224; this.frameStart = true; this.blank(); }
      return 0;
    }
    let extra = 0;
    if (this.startDelay) { this.startDelay = false; return 0; }   // the rest of the instruction that switched the LCD on
    this.dots += n;
    while (true) {
      if (this.ly < 144) {
        if (this.mode === 2 && this.dots >= 80) { this.setMode(3); }
        else if (this.mode === 3 && this.dots >= 80 + 172) { this.renderLine(); this.setMode(0); extra += this.m.hblankDma(); }
        else if (this.mode === 0 && this.dots >= 456) { this.dots -= 456; this.ly++; if (this.ly === 144) { this.setMode(1); this.m.requestInterrupt(1); this.frameDone = true; this.frames++; if (this.firstFrame) this.blank(); } else this.setMode(2); this.checkStat(); continue; }
        else break;
      } else {
        const len = this.ly === 153 && this.firstFrame ? 464 : 456;
        if (this.dots >= len) { this.dots -= len; this.ly++; if (this.ly > 153) { this.ly = 0; this.windowLine = 0; this.setMode(2); this.frameStart = true; this.firstFrame = false; } this.checkStat(); continue; }
        break;
      }
      break;
    }
    return extra;
  }

  blank() { this.rgb5.fill(31); this.frame.fill(0xFFFFFFFF); this.bgFrame.fill(0xFFFFFFFF); }

  color5(pal, idx, slot) {                    // palette RAM -> 15-bit colour
    const o = idx * 8 + slot * 2; return pal[o] | (pal[o + 1] << 8);
  }
  renderLine() {
    const ly = this.ly, m = this.m, v0 = m.vram[0], v1 = m.vram[1], lcdc = this.lcdc;
    const lineColor = this.lineColor, linePrio = this.linePrio, frame = this.frame, rgb5 = this.rgb5;
    const base = ly * 160;
    const windowOn = (lcdc & 0x20) && this.wy <= ly && this.wx <= 166;
    let windowDrawn = false;
    const L = this.look, lookPix = this.lookPix;
    let lkKey = -1, lkReg = null, lkFade = -1;
    if (L) lookPix.fill(0);
    const SP = this.spr; if (SP) { SP.rgba.fill(0, base, base + 160); SP.idx.fill(0, base, base + 160); }
    // --- background and window ---
    for (let x = 0; x < 160; x++) {
      let tx, ty, mapBase, inWindow = false;
      if (windowOn && x >= this.wx - 7) { inWindow = true; tx = x - (this.wx - 7); ty = this.windowLine; mapBase = lcdc & 0x40 ? 0x1C00 : 0x1800; }
      else { tx = (x + this.scx) & 0xFF; ty = (ly + this.scy) & 0xFF; mapBase = lcdc & 0x08 ? 0x1C00 : 0x1800; }
      const mapIdx = mapBase + ((ty >> 3) << 5) + (tx >> 3);
      const tile = v0[mapIdx], attr = v1[mapIdx];
      let tileAddr = lcdc & 0x10 ? tile << 4 : 0x1000 + ((tile << 24 >> 24) << 4);
      let row = ty & 7; if (attr & 0x40) row = 7 - row;
      const bank = attr & 0x08 ? v1 : v0;
      const lo = bank[tileAddr + row * 2], hi = bank[tileAddr + row * 2 + 1];
      let bit = tx & 7; if (!(attr & 0x20)) bit = 7 - bit;
      const ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
      lineColor[x] = ci; linePrio[x] = attr & 0x80 ? 1 : 0;
      const c = this.color5(this.bgPal, attr & 7, ci);
      rgb5[(base + x) * 3] = c & 31; rgb5[(base + x) * 3 + 1] = (c >> 5) & 31; rgb5[(base + x) * 3 + 2] = (c >> 10) & 31;
      this.bgFrame[base + x] = 0xFF000000 | ((c >> 10 & 31) << 19) | ((c >> 5 & 31) << 11) | ((c & 31) << 3);
      if (L) {                                   // the look: hero portraits on the BG
        const key = (attr & 0x0F) << 16 | tileAddr;
        if (key !== lkKey) { lkKey = key; lkReg = L.tileRegions(attr & 0x08 ? 1 : 0, tileAddr); lkFade = lkReg ? L.fade(this.bgPal, attr & 7) : -1; }
        if (lkReg && lkFade >= 0) { const lc = L.rgba(lkReg[row * 8 + 7 - bit], lkFade, this.bgPal, attr & 7); if (lc) { lookPix[x] = lc; this.bgFrame[base + x] = lc; } }
      }
      this.pixCell[base + x] = inWindow ? 0x8000 | mapIdx : mapIdx;
      this.pixSub[base + x] = (ty & 7) << 3 | (tx & 7);
      if (inWindow) windowDrawn = true;
    }
    this.winX[ly] = windowDrawn ? Math.max(0, this.wx - 7) : 255;
    if (windowDrawn) this.windowLine++;
    // --- sprites: up to 10 per line, lower OAM index wins (CGB) ---
    if (lcdc & 0x02) {
      const oam = m.oam, h = lcdc & 0x04 ? 16 : 8, drawn = new Uint8Array(160);
      let count = 0;
      for (let i = 0; i < 40 && count < 10; i++) {
        const sy = oam[i * 4] - 16, sx = oam[i * 4 + 1] - 8;
        if (ly < sy || ly >= sy + h) continue;
        count++;
        let tile = oam[i * 4 + 2], attr = oam[i * 4 + 3];
        if (h === 16) tile &= 0xFE;
        let row = ly - sy; if (attr & 0x40) row = h - 1 - row;
        const bank = attr & 0x08 ? v1 : v0, addr = (tile << 4) + row * 2;
        const lo = bank[addr], hi = bank[addr + 1];
        let sReg = null, sFade = -1;
        if (L) { sReg = L.tileRegions(attr & 0x08 ? 1 : 0, (tile + (row >> 3)) << 4); if (sReg) sFade = L.fade(this.objPal, attr & 7); }
        for (let px = 0; px < 8; px++) {
          const x = sx + px; if (x < 0 || x >= 160 || drawn[x]) continue;
          const bit = attr & 0x20 ? px : 7 - px;
          const ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
          if (!ci) continue;
          // CGB priority: LCDC bit 0 clear -> sprites always on top; else BG attr priority or OAM priority hide colours 1-3
          if ((lcdc & 0x01) && lineColor[x] !== 0 && (linePrio[x] || (attr & 0x80))) { drawn[x] = 1; continue; }
          drawn[x] = 1;
          if (L) lookPix[x] = sReg && sFade >= 0 ? L.rgba(sReg[(row & 7) * 8 + 7 - bit], sFade) : 0;
          const c = this.color5(this.objPal, attr & 7, ci);
          if (SP) { SP.idx[base + x] = i + 1; SP.rgba[base + x] = (L && lookPix[x]) || (0xFF000000 | ((c >> 10 & 31) << 19) | ((c >> 5 & 31) << 11) | ((c & 31) << 3)); }
          rgb5[(base + x) * 3] = c & 31; rgb5[(base + x) * 3 + 1] = (c >> 5) & 31; rgb5[(base + x) * 3 + 2] = (c >> 10) & 31;
        }
      }
    }
    for (let x = 0; x < 160; x++) {
      const o = (base + x) * 3, r = rgb5[o] * 8, g = rgb5[o + 1] * 8, b = rgb5[o + 2] * 8;
      frame[base + x] = 0xFF000000 | (b << 16) | (g << 8) | r;
    }
    if (L) for (let x = 0; x < 160; x++) if (lookPix[x]) frame[base + x] = lookPix[x];
    if (SP && SP.hide) for (let x = 0; x < 160; x++) if (SP.idx[base + x]) frame[base + x] = this.bgFrame[base + x];
  }
}
