// "Sprites: Detailed": the game's own sprites redrawn at 3x resolution from the pixels on screen: the same silhouette and
// colours, curves smoothed (Scale3x), a thin dark outline at the new resolution, banded shading and highlights per colour
// region and small glints on light areas. Nothing is read from the ROM here: the input is the sprite layer the PPU drew
// (look colours included); the output is an RGBA layer three times as large.
//
//   detail3x(src, w, h) -> { data: Uint32Array(9 * w * h), w: 3w, h: 3h }      src: 0xAABBGGRR per pixel, 0 = nothing
//
// Pixels are 0xAABBGGRR (little-endian RGBA bytes), the layout of ImageData / ppu.frame.
const DARK = 90;                                          // r + g + b below this is outline / dark clothing

const lumOf = c => (c & 255) + ((c >> 8) & 255) + ((c >> 16) & 255);
const pack = (r, g, b) => (0xFF000000 | (Math.max(0, Math.min(255, b | 0)) << 16) | (Math.max(0, Math.min(255, g | 0)) << 8) | Math.max(0, Math.min(255, r | 0))) >>> 0;
const OUTLINE = pack(20, 14, 30), DEEP = pack(24, 22, 30), SHEEN = pack(66, 62, 84), WHITE = pack(255, 255, 255);

// Scale3x (AdvMAME3x): smooths diagonals without blending colours. a: Uint32Array(w * h)
export function scale3x(a, w, h, out = null) {
  const W = w * 3, o = out || new Uint32Array(W * h * 3);
  for (let y = 0; y < h; y++) {
    const ym = y > 0 ? y - 1 : 0, yp = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0, xp = x < w - 1 ? x + 1 : w - 1;
      const A = a[ym * w + xm], B = a[ym * w + x], C = a[ym * w + xp], D = a[y * w + xm], E = a[y * w + x], F = a[y * w + xp], G = a[yp * w + xm], H = a[yp * w + x], I = a[yp * w + xp];
      let e0 = E, e1 = E, e2 = E, e3 = E, e5 = E, e6 = E, e7 = E, e8 = E;
      if (B !== H && D !== F) {
        e0 = D === B ? D : E; e1 = (D === B && E !== C) || (B === F && E !== A) ? B : E; e2 = B === F ? F : E;
        e3 = (D === B && E !== G) || (D === H && E !== A) ? D : E; e5 = (B === F && E !== I) || (H === F && E !== C) ? F : E;
        e6 = D === H ? D : E; e7 = (D === H && E !== I) || (H === F && E !== G) ? H : E; e8 = H === F ? F : E;
      }
      const i = y * 3 * W + x * 3;
      o[i] = e0; o[i + 1] = e1; o[i + 2] = e2; o[i + W] = e3; o[i + W + 1] = E; o[i + W + 2] = e5; o[i + 2 * W] = e6; o[i + 2 * W + 1] = e7; o[i + 2 * W + 2] = e8;
    }
  }
  return o;
}

// outline, shading and glints on a Scale3x image (src: 3x pixels; returns a new array). The rules, per pixel:
//   dark pixels (outline, black hair / clothes): the ring touching the picture or a light pixel becomes a near-black outline,
//   the inside a deep tint with a faint sheen on its top-left edge, so large dark areas keep some form;
//   other colours: a cool, darker band on the bottom-right edge of each colour region and a warm highlight on the top-left;
//   light areas get white glints next to dark pixels.
export function shade3(src, W, H) {
  const out = new Uint32Array(src), P = 2, PW = W + 2 * P, pad = new Uint32Array(PW * (H + 2 * P));      // a 2-pixel clear border: neighbours are plain index offsets
  for (let y = 0; y < H; y++) pad.set(src.subarray(y * W, y * W + W), (y + P) * PW + P);
  const dk = c => c !== 0 && lumOf(c) < DARK;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = src[y * W + x]; if (!c) continue;
    const i = (y + P) * PW + x + P, n = pad[i - PW], s = pad[i + PW], w = pad[i - 1], e = pad[i + 1];
    if (dk(c)) {
      const dn = dk(n), ds = dk(s), dw = dk(w), de = dk(e);
      if (!n || !s || !w || !e || !dn || !ds || !dw || !de) { out[y * W + x] = OUTLINE; continue; }        // next to clear or a light pixel
      out[y * W + x] = (!dk(pad[i - 2 * PW])) ? SHEEN : DEEP; continue;                                    // the inside: a faint sheen on the top-left edge
    }
    const r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255;
    if (s !== c || e !== c || pad[i + 2 * PW] !== c) out[y * W + x] = pack(r * 0.72 + 4, g * 0.72 + 2, b * 0.86 + 18);        // bottom-right band: cool and darker
    else if (n !== c || w !== c) out[y * W + x] = pack(r * 1.06 + 26, g * 1.04 + 22, b * 0.98 + 10);                          // top-left band: warm highlight
    else if (lumOf(c) > 600 && dk(pad[i + PW + 1])) out[y * W + x] = WHITE;                                                   // glint
  }
  return out;
}

export function detail3x(src, w, h) {
  const big = scale3x(src, w, h);
  return { data: shade3(big, w * 3, h * 3), w: w * 3, h: h * 3 };
}
