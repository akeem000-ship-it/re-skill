// Render-time colouring of the hero (the "look"). The game draws the hero with one of five palettes it shares
// with other characters and NPCs, three colours each; the look gives the hero its own colours per region
// (skin, hair, hat, top, bottom, shoes) without touching any palette the game uses:
//   * VRAM tiles are tagged with the ROM offset they were DMA'd from (the hero's frames are copied straight
//     from ROM by QueueVRAMCopy), and recognised by content otherwise (the LZ portraits, a loaded state);
//   * a tagged tile is recoloured only while it is shown with one of the five hero palettes (unchanged or
//     faded), so the charge flash and anything else keep the game's colours;
//   * the game fades through white by adding the same amount to every colour component (00:1CD9); the amount
//     is read back from the palette's colour 3, which is black in all five hero palettes.
// The emulator's exact picture (ppu.rgb5, frameHash) is never changed: only the displayed frame is.
import { tileHash } from "./build.js";

const SLOTS = 2 * 512;                                   // VRAM banks x 16-byte tiles

export class LookRenderer {
  constructor(built) {
    this.rom = null; this.gen = (LookRenderer.gens = (LookRenderer.gens || 0) + 1);
    this.byOffset = built.tileRegions; this.contentRegions = built.contentRegions;
    this.base = built.basePalettes.map(p => p.map(c => [c & 31, (c >> 5) & 31, (c >> 10) & 31]));
    this.colours = built.colours;
    this.tags = new Int32Array(SLOTS).fill(-1);
    this.cacheBytes = new Uint8Array(SLOTS * 16); this.cacheRes = new Array(SLOTS).fill(undefined);
    this.mem = null; this.origDma = null;
  }
  // hook the machine: the PPU and voxel/wide renderers find the look at gb.look / ppu.look
  attach(gb) {
    this.detach();
    const mem = gb.mem, self = this, orig = mem.hdmaCopy;
    this.gb = gb; this.mem = mem; this.origDma = orig; this.rom = mem.rom;
    mem.hdmaCopy = function (n) {                       // HDMA/GDMA: remember where each 16-byte block came from
      const src = this.hdma.src, dst = this.hdma.dst, bank = this.vbk, ro = this.romOffset;
      orig.call(this, n);
      for (let k = 0; k < n; k += 16) {
        const s = (src + k) & 0xFFFF, t = bank * 512 + (((dst + k) & 0x1FFF) >> 4);
        self.tags[t] = s < 0x4000 ? s : s < 0x8000 ? ro + (s & 0x3FFF) : -1;
        self.cacheRes[t] = undefined;
      }
    };
    gb.look = this; gb.ppu.look = this;
  }
  detach() {
    if (this.mem && this.origDma) { this.mem.hdmaCopy = this.origDma; }
    if (this.gb) { if (this.gb.look === this) this.gb.look = null; if (this.gb.ppu.look === this) this.gb.ppu.look = null; }
    this.mem = null; this.origDma = null; this.gb = null;
  }
  // the region plane (Uint8Array(64), hero*16 + region per pixel) of the tile at VRAM bank / byte address, or null
  tileRegions(bank, addr) {
    const t = bank * 512 + (addr >> 4), v = this.mem.vram[bank], cb = this.cacheBytes, co = t * 16;
    let res = this.cacheRes[t];
    if (res !== undefined) {
      let same = true; for (let i = 0; i < 16; i++) if (cb[co + i] !== v[addr + i]) { same = false; break; }
      if (same) return res;
    }
    for (let i = 0; i < 16; i++) cb[co + i] = v[addr + i];
    res = null;
    const o = this.tags[t];
    if (o >= 0) {
      const rom = this.rom; let same = true;
      for (let i = 0; i < 16; i++) if (rom[o + i] !== v[addr + i]) { same = false; break; }
      if (same) res = this.byOffset.get(o) || null;
    }
    if (!res) {
      const list = this.contentRegions.get(tileHash(v, addr));
      if (list) for (const e of list) { let same = true; for (let i = 0; i < 16; i++) if (e.bytes[i] !== v[addr + i]) { same = false; break; } if (same) { res = e.plane; break; } }
    }
    this.cacheRes[t] = res;
    return res;
  }
  // fade amount (0-31) when palette `slot` of palRAM (64 bytes) is one of the hero palettes, else -1
  fade(palRAM, slot) {
    const o = slot * 8, c3 = palRAM[o + 6] | palRAM[o + 7] << 8, d = c3 & 31;
    if (((c3 >> 5) & 31) !== d || ((c3 >> 10) & 31) !== d) return -1;
    for (const P of this.base) {
      let ok = true;
      for (let i = 1; i < 3 && ok; i++) {
        const c = palRAM[o + 2 * i] | palRAM[o + 2 * i + 1] << 8, p = P[i];
        if ((c & 31) !== Math.min(31, p[0] + d) || ((c >> 5) & 31) !== Math.min(31, p[1] + d) || ((c >> 10) & 31) !== Math.min(31, p[2] + d)) ok = false;
      }
      if (ok) return d;
    }
    return -1;
  }
  // displayed colour (0xAABBGGRR) of region value v at fade d, or 0 for "keep the game's colour"
  rgba(v, d) {
    if (!v) return 0;
    const c = this.colours[v]; if (c === 0xFFFF) return 0;
    const r = Math.min(31, (c & 31) + d), g = Math.min(31, ((c >> 5) & 31) + d), b = Math.min(31, ((c >> 10) & 31) + d);
    return (0xFF000000 | (b << 19) | (g << 11) | (r << 3)) >>> 0;
  }
}
