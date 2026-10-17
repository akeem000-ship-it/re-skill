// "Sprites: Detailed" at run time. The PPU hands over the sprite layer it drew (ppu.spr: colours with the look applied, and the
// OAM index of each pixel) and, in 2D, leaves the sprites out of its frame; this module redraws that layer at 3x on an overlay canvas
// (detail.js: smoothed, outlined, shaded) and gives the heroes faces with expressions (faceinfo.js / detailface.js). The expression
// comes from the animation frame the game shows: which frame of the hero's sprite sheet is in VRAM tells whether the player is
// standing, swinging, celebrating a point or dismayed by losing one. Only reads: nothing here touches the machine's state.
//
// 3D / VOX: the view builds its objects (a player's tiles) itself; `objectImage` composites one the same way (see voxel.js bodyOf).
import { detail3x } from "./detail.js";
import { faceCanvas, cleanFace } from "./detailface.js";

const SW = 160, SH = 144;
const pack = (r, g, b) => (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0;

// ---- hero faces among a list of sprites ------------------------------------------------------------------------------------
// sprs: [{ sx, sy, h, tile, attr, i? }] (OAM-like; tile already even for 8x16). Returns the hero frames on show, each with a map
// from a frame pixel to the screen: { frame, mir, tiles: Map(t -> { tx, ty, fx, fy, i }), at(px, py) -> { X, Y, i } | null }
export function heroFaces(L, sprs) {
  const out = new Map();
  if (!L || !L.frameTile) return [];
  for (const s of sprs) {
    const n = s.h >> 3, bank = (s.attr >> 3) & 1, fx = !!(s.attr & 0x20), fy = !!(s.attr & 0x40);
    for (let half = 0; half < n; half++) {
      const e = L.frameTile(bank, s.tile + (fy ? n - 1 - half : half)); if (!e || !e.frame.info) continue;
      const fr = e.frame, cx = (e.t / fr.rows) | 0, cy = e.t % fr.rows, tx = s.sx, ty = s.sy + half * 8;
      const ox = fx ? tx + cx * 8 + 7 : tx - cx * 8, oy = fy ? ty + cy * 8 + 7 : ty - cy * 8, key = e.fi + (fx ? "m" : "n") + ox + "," + oy;
      let inst = out.get(key); if (!inst) out.set(key, inst = { frame: fr, fi: e.fi, mir: fx, tiles: new Map(), at: null });
      inst.tiles.set(e.t, { tx, ty, fx, fy, i: s.i === undefined ? -1 : s.i });
    }
  }
  for (const inst of out.values()) {
    const rows = inst.frame.rows;
    inst.at = (px, py) => {
      const e = inst.tiles.get((px >> 3) * rows + (py >> 3)); if (!e) return null;
      const lx = px & 7, ly = py & 7; return { X: e.tx + (e.fx ? 7 - lx : lx), Y: e.ty + (e.fy ? 7 - ly : ly), i: e.i, fx: e.fx, fy: e.fy };
    };
  }
  return [...out.values()];
}

// the most common colour of some frame pixels as they are on the layer
function modeColour(inst, idxList, layer, lw, ownerIdx = null) {
  const cnt = new Map(); let best = 0, bn = 0;
  for (const p of idxList) {
    const w = inst.frame.info.w, m = inst.at(p % w, (p / w) | 0); if (!m) continue;
    const c = layer[m.Y * lw + m.X]; if (!c || (ownerIdx && m.i >= 0 && ownerIdx[m.Y * lw + m.X] !== m.i + 1)) continue;
    const k = (cnt.get(c) || 0) + 1; cnt.set(c, k); if (k > bn) { bn = k; best = c; }
  }
  return best;
}

// Clean the face of each hero instance in `layer` (lw wide; owner: per-pixel OAM index + 1 or null) and return the decals to draw on the detailed layer.
export function prepareFaces(insts, layer, lw, owner, expressionOf = null) {
  const decals = [];
  for (const inst of insts) {
    const info = inst.frame.info, skin = modeColour(inst, info.skinIdx, layer, lw, owner); if (!skin) continue;
    const at = (x, y) => { const m = inst.at(x, y); if (!m) return -1; const i = m.Y * lw + m.X; return owner && m.i >= 0 && owner[i] !== m.i + 1 ? -1 : i; };
    cleanFace(layer, info, at, skin);
    const hair = modeColour(inst, info.hairIdx, layer, lw, owner), mood = expressionOf ? expressionOf(inst) : inst.frame.mood;
    decals.push({ inst, canvas: faceCanvas(info, mood, { hair: hair ? darken(hair, 0.6) : 0 }), owner });
  }
  return decals;
}
function darken(c, k) { return pack(((c & 255) * k) | 0, (((c >> 8) & 255) * k) | 0, (((c >> 16) & 255) * k) | 0); }

// draw the decals into a 3x image (pixels 0xAABBGGRR, width W3): the layer's pixel (X, Y) is at (3 (X - ox) + s, 3 (Y - oy) + s), s in 0..2
export function blitFaces(decals, out, W3, H3, ox, oy, lw) {
  for (const d of decals) {
    const info = d.inst.frame.info, f = d.canvas;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const c = f.px[y * f.w + x]; if (!c) continue;
      const m = d.inst.at(info.x0 + ((x / 3) | 0), info.y0 + ((y / 3) | 0)); if (!m) continue;
      if (d.owner && m.i >= 0 && d.owner[m.Y * lw + m.X] !== m.i + 1) continue;
      const X = 3 * (m.X - ox) + (m.fx ? 2 - x % 3 : x % 3), Y = 3 * (m.Y - oy) + (m.fy ? 2 - y % 3 : y % 3);
      if (X < 0 || Y < 0 || X >= W3 || Y >= H3 || !out[Y * W3 + X]) continue;       // only on pixels the sprite has
      out[Y * W3 + X] = c;
    }
  }
}

// ---- the 2D overlay ----------------------------------------------------------------------------------------------------------
export class SpriteDetail {
  constructor() {
    this.enabled = false; this.gb = null; this.screen = null; this.canvas = null; this.ctx = null; this.dirty = null; this.last = null;
    this.spr = { rgba: new Uint32Array(SW * SH), idx: new Uint8Array(SW * SH), hide: false };
    this.work = new Uint32Array(SW * SH);
  }
  // screen: the page's 2D canvas (#screen), under which the overlay is stacked
  attach(gb, screen) {
    this.gb = gb; this.screen = screen || this.screen; gb.detail = this;
    if (this.enabled) gb.ppu.spr = this.spr;
  }
  setEnabled(on) {
    on = !!on; if (on === this.enabled) return; this.enabled = on;
    if (this.gb) { this.gb.ppu.spr = on ? this.spr : null; this.spr.hide = false; }
    if (!on) this._hide();
  }
  _ensureCanvas() {
    if (this.canvas) return;
    const c = document.createElement("canvas"); c.width = SW * 3; c.height = SH * 3; c.id = "spritedetail";
    c.style.cssText = "position:fixed;pointer-events:none;image-rendering:pixelated;z-index:3;display:none;background:transparent;border:0;margin:0;padding:0;transform:none;aspect-ratio:auto;max-width:none";
    (this.screen && this.screen.parentNode || document.body).appendChild(c);
    this.canvas = c; this.ctx = c.getContext("2d", { willReadFrequently: false }); this.img = this.ctx.createImageData(SW * 3, SH * 3); this.img32 = new Uint32Array(this.img.data.buffer);
  }
  _hide() { if (this.canvas) this.canvas.style.display = "none"; this.dirty = null; if (this.ctx) this.ctx.clearRect(0, 0, SW * 3, SH * 3); this.img32 && this.img32.fill(0); }
  // lay the overlay over the page's screen canvas (object-fit: contain: the picture keeps 10:9 inside the element's box)
  _place() {
    const s = this.screen, c = this.canvas; if (!s) return false;
    if (s.hidden || !s.getClientRects().length || s.width * SH !== s.height * SW) return false;      // 3D view, or the 4:3 courts' wide picture (drawn from the OAM itself)
    const r = s.getBoundingClientRect(); let w = r.width, h = r.height, x = r.left, y = r.top;
    if (w * SH > h * SW) { const nw = h * SW / SH; x += (w - nw) / 2; w = nw; } else { const nh = w * SH / SW; y += (h - nh) / 2; h = nh; }
    const st = c.style; st.display = "block"; st.left = x + "px"; st.top = y + "px"; st.width = w + "px"; st.height = h + "px";
    return true;
  }
  // once per emulated frame, after it ran
  frame() {
    if (!this.enabled || !this.gb) return;
    this._ensureCanvas();
    const show = this._place(); this.spr.hide = show;
    if (!show) { this.dirty = null; return; }
    const spr = this.spr, idx = spr.idx;
    let x0 = SW, y0 = SH, x1 = -1, y1 = -1;
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) if (idx[y * SW + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const img32 = this.img32, prev = this.dirty;
    if (prev) for (let y = prev.y0 * 3; y < (prev.y1 + 1) * 3; y++) img32.fill(0, y * SW * 3 + prev.x0 * 3, y * SW * 3 + (prev.x1 + 1) * 3);
    if (x1 < 0) { if (prev) this.ctx.putImageData(this.img, 0, 0, prev.x0 * 3, prev.y0 * 3, (prev.x1 - prev.x0 + 1) * 3, (prev.y1 - prev.y0 + 1) * 3); this.dirty = null; return; }
    x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(SW - 1, x1 + 1); y1 = Math.min(SH - 1, y1 + 1);
    const work = this.work; work.set(spr.rgba);
    const L = this.gb.look, oam = this.gb.mem.oam, tall = this.gb.ppu.lcdc & 4, sprs = [];
    if (L && L.frameTile) for (let i = 0; i < 40; i++) {
      const sy = oam[i * 4] - 16, sx = oam[i * 4 + 1] - 8; if (sy <= -16 || sy >= SH || sx <= -8 || sx >= SW) continue;
      sprs.push({ i, sx, sy, h: tall ? 16 : 8, tile: tall ? oam[i * 4 + 2] & 0xFE : oam[i * 4 + 2], attr: oam[i * 4 + 3] });
    }
    const decals = prepareFaces(heroFaces(L, sprs), work, SW, idx);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1, crop = new Uint32Array(cw * ch);
    for (let y = 0; y < ch; y++) crop.set(work.subarray((y0 + y) * SW + x0, (y0 + y) * SW + x0 + cw), y * cw);
    const d = detail3x(crop, cw, ch);
    for (let y = 0; y < d.h; y++) img32.set(d.data.subarray(y * d.w, (y + 1) * d.w), (y0 * 3 + y) * SW * 3 + x0 * 3);
    if (decals.length) {                                                       // faces: blit into the full-size image (coordinates of the layer)
      blitFaces(decals, img32, SW * 3, SH * 3, 0, 0, SW);
    }
    const u = prev ? { x0: Math.min(prev.x0, x0), y0: Math.min(prev.y0, y0), x1: Math.max(prev.x1, x1), y1: Math.max(prev.y1, y1) } : { x0, y0, x1, y1 };
    this.ctx.putImageData(this.img, 0, 0, u.x0 * 3, u.y0 * 3, (u.x1 - u.x0 + 1) * 3, (u.y1 - u.y0 + 1) * 3);
    this.dirty = { x0, y0, x1, y1 };
  }
}
