// 2bpp tile codec and the sprite layouts the hero's graphics use (docs: third_party/.../graphics_formats.md §0, §4).
// An "image" here is { w, h, px: Uint8Array(w*h) } holding colour indices 0-3.

export const img = (w, h) => ({ w, h, px: new Uint8Array(w * h) });
export const clone = a => ({ w: a.w, h: a.h, px: Uint8Array.from(a.px) });

export function decodeTile(buf, o, dst, x0, y0) {
  for (let y = 0; y < 8; y++) {
    const lo = buf[o + 2 * y], hi = buf[o + 2 * y + 1];
    for (let x = 0; x < 8; x++) dst.px[(y0 + y) * dst.w + x0 + x] = ((lo >> (7 - x)) & 1) | (((hi >> (7 - x)) & 1) << 1);
  }
}
export function encodeTile(src, x0, y0, out, o) {
  for (let y = 0; y < 8; y++) {
    let lo = 0, hi = 0;
    for (let x = 0; x < 8; x++) { const v = src.px[(y0 + y) * src.w + x0 + x]; lo |= (v & 1) << (7 - x); hi |= ((v >> 1) & 1) << (7 - x); }
    out[o + 2 * y] = lo; out[o + 2 * y + 1] = hi;
  }
}

// columns of 8x16 objects, column-major (QueueSprite16 / QueueSprite24x32 / 32x32): tile t -> column t>>(rows-ish)
export function decodeColMajor(buf, o, cols, rows8) {
  const im = img(cols * 8, rows8 * 8);
  let t = 0;
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows8; r++, t++) decodeTile(buf, o + t * 16, im, c * 8, r * 8);
  return im;
}
export function encodeColMajor(im, cols, rows8, out, o) {
  let t = 0;
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows8; r++, t++) encodeTile(im, c * 8, r * 8, out, o + t * 16);
}
// tile offset (bytes, from the asset start) of each 8x8 cell of a column-major image: cell (cx, cy) -> t*16
export const colMajorTile = (cx, cy, rows8) => (cx * rows8 + cy) * 16;

export function decodeRowMajor(buf, o, cols, rows8) {
  const im = img(cols * 8, rows8 * 8);
  for (let t = 0; t < cols * rows8; t++) decodeTile(buf, o + t * 16, im, (t % cols) * 8, ((t / cols) | 0) * 8);
  return im;
}
export function encodeRowMajor(im, cols, rows8) {
  const out = new Uint8Array(cols * rows8 * 16);
  for (let t = 0; t < cols * rows8; t++) encodeTile(im, (t % cols) * 8, ((t / cols) | 0) * 8, out, t * 16);
  return out;
}

// the 64 values of cell (cx, cy) of a plane (Uint8Array w*h), row-major within the tile
export function cellOf(plane, w, cx, cy) {
  const out = new Uint8Array(64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) out[y * 8 + x] = plane[(cy * 8 + y) * w + cx * 8 + x];
  return out;
}
