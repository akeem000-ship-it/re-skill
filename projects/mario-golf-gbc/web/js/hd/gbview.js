// A read-only view of the native game's display model (GolfMemory w: w.vram, w.oam, w.bgPal, w.objPal, w.lcd; render/display.js)
// shaped like the emulator core the Mario Tennis HD code was written for (gb.mem.vram / oam / wram, gb.ppu.lcdc / scx / scy / wx / wy /
// bgPal / objPal, and the per-pixel tables the core's PPU keeps: pixCell (which BG / window map cell each pixel shows, bit 15 = the
// window), pixSub (the pixel's place in its tile: y << 3 | x) and bgFrame (the picture without sprites, 0xAABBGGRR)), so the HD text,
// HD UI, wide and portrait code can be shared. refresh(w, frame) recomputes the tables from the model once per drawn frame; nothing here
// writes to w (the game's state). The model holds one register set per frame (the game changes no LCD register mid-frame: REVERSE.md
// "Vectors"), so the tables are exact.
export class GbView {
  constructor() {
    this.w = null;
    this.mem = { vram: null, oam: null, wram: null, rom: null, ie: 0 };
    this.ppu = { lcdc: 0, scx: 0, scy: 0, wx: 0, wy: 0, bgPal: null, objPal: null, frames: -1,
      pixCell: new Uint16Array(160 * 144), pixSub: new Uint8Array(160 * 144), bgFrame: new Uint32Array(160 * 144) };
    this.key = "";
  }
  // point the view at w's display model and recompute the per-pixel tables (cheap enough for every drawn frame)
  refresh(w, frame, rom) {
    this.w = w; const m = this.mem, p = this.ppu, l = w.lcd;
    m.vram = w.vram; m.oam = w.oam; m.wram = w.wram; m.rom = rom || m.rom; m.ie = l.ie;
    p.lcdc = l.lcdc; p.scx = l.scx; p.scy = l.scy; p.wx = l.wx; p.wy = l.wy; p.bgPal = w.bgPal; p.objPal = w.objPal;
    if (p.frames === frame) return;
    p.frames = frame;
    const v0 = w.vram[0], v1 = w.vram[1], lcdc = l.lcdc, cell = p.pixCell, sub = p.pixSub, out = p.bgFrame, pal = w.bgPal;
    if (!(lcdc & 0x80)) { out.fill(0xFFFFFFFF); cell.fill(0); sub.fill(0); return; }
    let wline = 0;
    for (let ly = 0; ly < 144; ly++) {
      const winOn = (lcdc & 0x20) && l.wy <= ly && l.wx <= 166; let drawn = false;
      for (let x = 0; x < 160; x++) {
        let tx, ty, map, win = 0;
        if (winOn && x >= l.wx - 7) { tx = x - (l.wx - 7); ty = wline; map = lcdc & 0x40 ? 0x1C00 : 0x1800; win = 0x8000; drawn = true; }
        else { tx = (x + l.scx) & 0xFF; ty = (ly + l.scy) & 0xFF; map = lcdc & 0x08 ? 0x1C00 : 0x1800; }
        const c = map + ((ty >> 3) << 5) + (tx >> 3), i = ly * 160 + x;
        cell[i] = c | win; sub[i] = (ty & 7) << 3 | (tx & 7);
        const tile = v0[c], attr = v1[c], addr = lcdc & 0x10 ? tile << 4 : 0x1000 + ((tile << 24 >> 24) << 4);
        const row = attr & 0x40 ? 7 - (ty & 7) : ty & 7, bank = attr & 8 ? v1 : v0;
        const bit = attr & 0x20 ? tx & 7 : 7 - (tx & 7), ci = ((bank[addr + row * 2] >> bit) & 1) | (((bank[addr + row * 2 + 1] >> bit) & 1) << 1);
        const o = (attr & 7) * 8 + ci * 2, c15 = pal[o] | pal[o + 1] << 8;
        out[i] = 0xFF000000 | ((c15 >> 10 & 31) << 19) | ((c15 >> 5 & 31) << 11) | ((c15 & 31) << 3);
      }
      if (drawn) wline++;
    }
  }
}
