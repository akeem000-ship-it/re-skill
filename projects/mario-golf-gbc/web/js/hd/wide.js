// Wide: the screen widened with the real map on both sides, unstretched. The course and green views and the overworld keep their whole
// map in WRAM (64 x 64 tiles: WRAM3 $D000 the tile numbers, WRAM2 $D000 the attributes; render/holeview.js, mapgfx.js) and copy only
// the 22 x 20 tiles round the camera into the BG map; the tiles' pictures are all in VRAM. So the columns left and right of the screen
// are drawn here from the map in WRAM at the camera's scroll (wMapScrollX / Y $C320-$C323, as MapScrollTask 04:4072 turns them into
// SCX / SCY), within the map's bounds ($C329-$C32C, as the aim marker uses them), with the tiles in VRAM and the frame's palettes.
// The picture between them is the game's own frame, untouched. It is only done when the screen shows that map: every visible BG
// cell of the screen must hold the map's tile and attribute at that place (a menu, a picture, a caption over the BG, a view being
// redrawn: no wide sides, the plain picture). The game changes no LCD register in mid-frame, so one scroll holds for every line.
// Sprites stay inside the 160 columns, as on the console (the game hides sprites by moving them off screen). Reads only.
export const WIDE_H = 144;
const col = (pal, p, i) => { const o = p * 8 + i * 2, c = pal[o] | (pal[o + 1] << 8); return 0xFF000000 | ((c >> 10 & 31) << 19) | ((c >> 5 & 31) << 11) | ((c & 31) << 3); };

// the map's place on screen, or null when the screen does not show the map: { x0, y0 } = the map pixel at the screen's top-left,
// bounds in tiles, the window's top line (rows from it down are the window's, drawn as the game draws them)
export function mapPlace(w) {
  const l = w.lcd, w0 = w.wram[0], v0 = w.vram[0], v1 = w.vram[1], t3 = w.wram[3], t2 = w.wram[2];
  if (!(l.lcdc & 0x80) || !(l.lcdc & 0x01)) return null;
  // the views that scroll over a map run MapScrollTask 04:4072 as a frame task (the course and green views, the overworld); the
  // full-screen pages drawn from the same buffers (the scorecard: its other pages lie beside it) do not
  let scrolling = false;
  for (let p = 0x1C0; p < 0x200; p += 4) {          // (the overworld's MapGfxScrollTask 0B:4784 farcalls it)
    const a = w0[p + 1] | w0[p + 2] << 8;
    if (w0[p] && ((w0[p + 3] === 0x04 && a === 0x4072) || (w0[p + 3] === 0x0B && a === 0x4784))) scrolling = true;
  }
  if (!scrolling) return null;
  const bx = w0[0x321] << 3 | w0[0x320] >> 5, by = w0[0x323] << 3 | w0[0x322] >> 5;
  const dx = ((l.scx - bx) << 24 >> 24), dy = ((l.scy - by) << 24 >> 24);      // the shake offsets ($C368 / $C369)
  if (Math.abs(dx) > 8 || Math.abs(dy) > 8) return null;
  const x0 = bx + dx, y0 = by + dy;
  const bounds = [w0[0x329], w0[0x32A], Math.min(64, w0[0x32B]), Math.min(64, w0[0x32C])];   // (the maps are 64 x 64: past that they wrap)
  if (!(bounds[0] < bounds[2] && bounds[1] < bounds[3])) return null;
  const winTop = (l.lcdc & 0x20) && l.wx <= 7 ? Math.max(0, l.wy) : 144;      // (a window from the left edge: the rows below it are the window's)
  if (winTop < 16) return null;
  const map = l.lcdc & 0x08 ? 0x1C00 : 0x1800;
  let n = 0, ok = 0;
  for (let ty = y0 >> 3; ty <= (y0 + winTop - 1) >> 3; ty++) for (let tx = x0 >> 3; tx <= (x0 + 159) >> 3; tx++) {
    const mi = ((ty & 63) << 6) | (tx & 63), bi = map + ((ty & 31) << 5) + (tx & 31);
    n++; if (v0[bi] === t3[mi] && v1[bi] === t2[mi]) ok++;
  }
  if (ok < n) return null;                                                      // the screen is not (all) the map
  return { x0, y0, bounds, winTop };
}

// compose a frame `W` px wide (out: Uint32Array W * 144, 0xAABBGGRR): the game's frame (frame: Uint32Array 160 * 144) in the middle,
// the map on both sides; returns false (out untouched) when the screen does not show the map
export function composeWide(w, frame, out, W, place = mapPlace(w)) {
  if (!place) return false;
  const pad = (W - 160) >> 1, l = w.lcd, v0 = w.vram[0], v1 = w.vram[1], t3 = w.wram[3], t2 = w.wram[2], pal = w.bgPal, lcdc = l.lcdc;
  const [bx0, by0, bx1, by1] = place.bounds, dark = 0xFF000000;
  for (let y = 0; y < WIDE_H; y++) {
    const o = y * W;
    out.set(frame.subarray(y * 160, y * 160 + 160), o + pad);
    const inWin = y >= place.winTop;
    for (let x = 0; x < W; x++) {
      if (x === pad) x += 160;
      if (x >= W) break;
      if (inWin) {                                                               // the window's rows (the HUD bar): its edge colour carried on
        out[o + x] = frame[y * 160 + (x < pad ? 0 : 159)]; continue;
      }
      const mx = place.x0 + x - pad, my = place.y0 + y, tx = mx >> 3, ty = my >> 3;
      if (tx < bx0 || tx >= bx1 || ty < by0 || ty >= by1) { out[o + x] = dark; continue; }   // past the map's edge
      const mi = ((ty & 63) << 6) | (tx & 63), tile = t3[mi], attr = t2[mi], bank = attr & 8 ? v1 : v0;
      const addr = lcdc & 0x10 ? tile << 4 : 0x1000 + ((tile << 24 >> 24) << 4);
      const row = attr & 0x40 ? 7 - (my & 7) : my & 7, bit = attr & 0x20 ? mx & 7 : 7 - (mx & 7);
      const ci = ((bank[addr + row * 2] >> bit) & 1) | (((bank[addr + row * 2 + 1] >> bit) & 1) << 1);
      out[o + x] = col(pal, attr & 7, ci);
    }
  }
  return true;
}
