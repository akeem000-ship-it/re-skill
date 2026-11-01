// The game's HUD over the 3D hole view: the window layer (the bottom bar, message boxes) and the sprites the HUD's and the captions'
// code queues, drawn as the game's display hardware would (as js/golf/render/raster.js, one layer only, transparent elsewhere), from
// the game's display model (read only). Which sprites are the HUD's: the shadow OAM slots are tagged with the ROM bank of the code
// that queued them (display.js setOamHook: the hROMBank at the time); the 3D view draws the world's own (banks 11 and 04: the ball,
// its shadow, the golfer, the target marker; bank 15: the flag behind the golfer) itself and leaves those out.
import { setOamHook } from "../golf/render/display.js";

const W = 160, H = 144, HUD_PX = 3.4;
export const WORLD_BANKS = new Set([0x11, 0x04, 0x15]);
const tags = new WeakMap();                       // GolfMemory -> Uint8Array(40): the bank that wrote each slot (0: unknown)
export function tagsOf(w) { let t = tags.get(w); if (!t) tags.set(w, t = new Uint8Array(40)); return t; }
export function installOamTags() { setOamHook((w, slot) => { tagsOf(w)[slot] = w.high[0x195]; }); }

export class HudLayer {
  constructor(gl) {
    this.gl = gl; this.rgba = new Uint8Array(W * H * 4); this.tex = null;
  }
  // the HUD as RGBA (alpha 0 where the BG shows the course); keep(slot) picks the sprites
  raster(w, keep, opts = null) {
    const bgOn = opts && opts.bg, skip = (opts && opts.skipPals) || null, clear0 = (opts && opts.clear0) || null;
    const d = { vram: w.vram, oam: w.oam, bgPal: w.bgPal, objPal: w.objPal, ...w.lcd }, out = this.rgba;
    out.fill(0);
    const lcdc = d.lcdc, v0 = d.vram[0], v1 = d.vram[1];
    if (!(lcdc & 0x80)) return out;
    const lineColor = new Uint8Array(W), linePrio = new Uint8Array(W), win = new Uint8Array(W), drawn = new Uint8Array(W);
    let windowLine = 0; const sprH = lcdc & 0x04 ? 16 : 8;
    let winPx = 0;
    for (let ly = 0; ly < H; ly++) {
      const windowOn = (lcdc & 0x20) && d.wy <= ly && d.wx <= 166;
      let windowDrawn = false;
      lineColor.fill(0); win.fill(0);
      if (bgOn) for (let x = 0; x < W; x++) {          // (the BG too, for a caller that lets some palettes through)
        const tx = (x + d.scx) & 0xFF, ty = (ly + d.scy) & 0xFF, map = lcdc & 0x08 ? 0x1C00 : 0x1800;
        const cell = map + ((ty >> 3) << 5) + (tx >> 3), tile = v0[cell], attr = v1[cell];
        if (skip && skip.has(attr & 7)) continue;
        const addr = lcdc & 0x10 ? tile << 4 : 0x1000 + ((tile << 24 >> 24) << 4);
        const row = attr & 0x40 ? 7 - (ty & 7) : ty & 7, bank = attr & 0x08 ? v1 : v0;
        const lo = bank[addr + row * 2], hi = bank[addr + row * 2 + 1], bit = attr & 0x20 ? tx & 7 : 7 - (tx & 7);
        const ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
        if (clear0 && !ci && clear0.has(attr & 7)) continue;
        lineColor[x] = ci; linePrio[x] = attr >> 7; win[x] = 1;
        put(out, ly * W + x, d.bgPal, attr & 7, ci);
      }
      if (windowOn) for (let x = Math.max(0, d.wx - 7); x < W; x++) {
        const tx = x - (d.wx - 7), ty = windowLine, map = lcdc & 0x40 ? 0x1C00 : 0x1800;
        const cell = map + ((ty >> 3) << 5) + (tx >> 3), tile = v0[cell], attr = v1[cell];
        const addr = lcdc & 0x10 ? tile << 4 : 0x1000 + ((tile << 24 >> 24) << 4);
        const row = attr & 0x40 ? 7 - (ty & 7) : ty & 7, bank = attr & 0x08 ? v1 : v0;
        if (skip && skip.has(attr & 7)) { lineColor[x] = 0; win[x] = 0; const q = (ly * W + x) * 4; out[q + 3] = 0; windowDrawn = true; continue; }
        const lo = bank[addr + row * 2], hi = bank[addr + row * 2 + 1], bit = attr & 0x20 ? tx & 7 : 7 - (tx & 7);
        const ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
        if (clear0 && !ci && clear0.has(attr & 7)) { windowDrawn = true; continue; }
        lineColor[x] = ci; linePrio[x] = attr >> 7; win[x] = 1; windowDrawn = true; winPx++;
        put(out, ly * W + x, d.bgPal, attr & 7, ci);
      }
      if (windowDrawn) windowLine++;
      if (!(lcdc & 0x02)) continue;
      drawn.fill(0); let count = 0;
      for (let i = 0; i < 40 && count < 10; i++) {
        const sy = d.oam[i * 4] - 16, sx = d.oam[i * 4 + 1] - 8;
        if (ly < sy || ly >= sy + sprH) continue;
        count++;
        if (!keep(i)) continue;
        let tile = d.oam[i * 4 + 2]; const attr = d.oam[i * 4 + 3]; if (sprH === 16) tile &= 0xFE;
        const row = attr & 0x40 ? sprH - 1 - (ly - sy) : ly - sy, bank = attr & 0x08 ? v1 : v0, addr = (tile << 4) + row * 2;
        const lo = bank[addr], hi = bank[addr + 1];
        for (let px = 0; px < 8; px++) {
          const x = sx + px; if (x < 0 || x >= W || drawn[x]) continue;
          const bit = attr & 0x20 ? px : 7 - px, ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
          if (!ci) continue;
          drawn[x] = 1;
          if (win[x] && (lcdc & 0x01) && lineColor[x] && (linePrio[x] || (attr & 0x80))) continue;
          put(out, ly * W + x, d.objPal, attr & 7, ci);
        }
      }
    }
    this.winCover = winPx / (W * H);
    return out;
  }
  draw(scene, game) {
    const w = game.w, t = tagsOf(w);
    const keep = i => w.oam[i * 4] - 16 >= 124 || (!WORLD_BANKS.has(t[i]) && !(scene.hideSprite && scene.hideSprite(i)));   // (the meter row is the HUD)
    this.drawLayer(scene, w, keep);
  }
  drawLayer(scene, w, keep) {
    const gl = this.gl;
    this.raster(w, keep);
    if (!this.tex) {
      this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.rgba);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } else { gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, this.rgba); }
    const p = scene.P.hud; gl.useProgram(p.p); gl.disable(gl.DEPTH_TEST);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(p.u.uTex, 0); gl.uniform1f(p.u.uAlpha, 1);
    gl.bindVertexArray(scene.emptyVao);
    for (const [off, sx, sy, sw, sh] of this.pieces(scene.canvas, w.lcd)) {
      gl.uniform4fv(p.u.uRect, off); if (sw > 0) { gl.enable(gl.SCISSOR_TEST); gl.scissor(sx, sy, sw, sh); }
      gl.drawArrays(gl.TRIANGLES, 0, 3); gl.disable(gl.SCISSOR_TEST);
    }
    gl.enable(gl.DEPTH_TEST);
  }
  // VIEW 4:3 / Fill / Wide (hd/view.js: the 3D picture wider than the Game Boy's): the HUD at the picture's height, not stretched,
  // in pieces: the window's rows (the bottom bar, message boxes) in the middle; above them each group of columns the HUD covers (the
  // hole and yards at the top left, the wind and the player at the top right) pinned to its own side, a group across the middle
  // (a caption) in the middle. At 10:9 one piece, the whole screen, as before. Returns [uRect, scissor x, y, w, h (w 0: none)].
  // SIZE: the HUD at most HUD_PX screen (CSS) pixels to the game's pixel, so a big screen (a foldable's inner one) shows more of the course
  // around a HUD of the same size, as Mario Tennis's does, not the same picture larger: its top pinned to the top, the bar to the bottom
  pieces(c, lcd) {
    const CW = c.width, CH = c.height, css = c.clientHeight || CH, hs = Math.min(CH / H, (CH / css) * HUD_PX), bw = W * hs, bh = H * hs;
    if (bw >= CW - 2 && bh >= CH - 2) return [[[0, 0, 1, 1], 0, 0, 0, 0]];
    const at = (off, y = 0) => [off / CW, y / CH, bw / CW, bh / CH], mid = (CW - bw) / 2, low = CH - bh;
    let top = (lcd.lcdc & 0x20) && lcd.wx <= 7 ? Math.max(0, Math.min(H, lcd.wy)) : H;
    if (top < 16) return [[at(mid, (CH - bh) / 2), 0, 0, 0, 0]];                    // (a full-screen window: all in the middle)
    const used = new Uint8Array(W), a = this.rgba;
    for (let y = 0; y < top; y++) for (let x = 0; x < W; x++) if (a[(y * W + x) * 4 + 3]) used[x] = 1;
    const out = [], yTop = Math.round(CH - top * hs), hTop = CH - yTop;               // (the top rows: from the top down)
    for (let x = 0; x < W;) {
      if (!used[x]) { x++; continue; }
      let e = x; for (let gap = 0; e < W && gap < 6; e++) gap = used[e] ? 0 : gap + 1;     // (a group: columns with gaps under 6 px)
      while (e > x && !used[e - 1]) e--;
      const off = e <= W * 0.45 ? 0 : x >= W * 0.55 ? CW - bw : mid;
      out.push([at(off), Math.floor(off + x * hs), yTop, Math.ceil((e - x) * hs) + 1, hTop]);
      x = e;
    }
    if (top < H) out.push([at(mid, low), 0, 0, CW, Math.round(bh - top * hs)]);      // (the window's rows: the bar, at the bottom)
    return out;
  }
}
function put(out, p, pal, n, ci) {
  const o = n * 8 + ci * 2, c = pal[o] | pal[o + 1] << 8, q = p * 4;
  out[q] = (c & 31) << 3; out[q + 1] = ((c >> 5) & 31) << 3; out[q + 2] = ((c >> 10) & 31) << 3; out[q + 3] = 255;
}
