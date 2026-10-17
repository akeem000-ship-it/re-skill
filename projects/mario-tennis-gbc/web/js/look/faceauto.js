// Faces of any character, found in the pixels on screen (no knowledge of whose sprite it is): the game draws a face as a patch of
// one colour (the skin) with the eyes as one or two small dark clusters inside it. Such a patch near the top of a figure is a face;
// seen from behind or in a hat's shadow there is none. The result has the same shape as faceinfo.js's (mask over the layer,
// bounding box, turn), so detailface.js draws the expression the same way.
//
//   findFaces(layer, w, h) -> [{ info, skin }]    layer: Uint32Array(w * h) of 0xAABBGGRR, 0 = no sprite
const lumOf = c => (c & 255) + ((c >> 8) & 255) + ((c >> 16) & 255);

export function findFaces(layer, w, h, minH = 11) {
  const out = [], lab = new Int32Array(w * h).fill(-1), at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : layer[y * w + x];
  // figures: 8-connected components of sprite pixels
  for (let s = 0; s < w * h; s++) {
    if (!layer[s] || lab[s] >= 0) continue;
    const q = [s]; lab[s] = s; let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let k = 0; k < q.length; k++) {
      const p = q[k], x = p % w, y = (p / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X; if (layer[j] && lab[j] < 0) { lab[j] = s; q.push(j); } }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1; if (bh < minH || bw < 6 || bw > 40) continue;
    const f = faceIn(layer, w, h, at, x0, y0, x1, y1, lab, s); if (f) out.push(f);
  }
  return out;
}

function faceIn(layer, w, h, at, x0, y0, x1, y1, lab, id) {
  const bh = y1 - y0 + 1, bw = x1 - x0 + 1, hz = y0 + Math.max(7, Math.round(bh * (bh > 20 ? 0.42 : 0.55)));        // the head zone: the top of the figure
  const mine = (x, y) => x >= 0 && y >= 0 && x < w && y < h && lab[y * w + x] === id, dark = c => lumOf(c) < 150;
  // the skin: the lightest-used colour in the lower half of the head's middle columns (a hat or hair sits above, a body below)
  const cnt = new Map(), ya = y0 + Math.round((hz - y0) * 0.45), xa = x0 + Math.round(bw * 0.2), xb = x1 - Math.round(bw * 0.2);
  for (let y = ya; y <= hz; y++) for (let x = xa; x <= xb; x++) if (mine(x, y)) { const c = layer[y * w + x]; if (!dark(c)) cnt.set(c, (cnt.get(c) || 0) + 1); }
  let K = 0, kn = 0; for (const [c, n] of cnt) if (n > kn) { K = c; kn = n; }
  if (!K || kn < 8) return null;
  const S = new Uint8Array(w * h); let n = 0;
  for (let y = y0; y <= hz; y++) for (let x = x0; x <= x1; x++) if (mine(x, y) && layer[y * w + x] === K) { S[y * w + x] = 1; n++; }
  if (n < 8) return null;
  const C = closeMask(S, w, h, 2, 1), lab2 = new Int32Array(w * h).fill(-1); let best = null;
  for (let i = 0; i < w * h; i++) {                                // the 8-connected piece of the closed mask holding most skin
    if (!C[i] || lab2[i] >= 0) continue; const q = [i], c = { n: 0, px: q }; lab2[i] = i;
    for (let k = 0; k < q.length; k++) { const p = q[k], x = p % w, y = (p / w) | 0; if (S[p]) c.n++; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X; if (C[j] && lab2[j] < 0) { lab2[j] = i; q.push(j); } } }
    if (!best || c.n > best.n) best = c;
  }
  if (!best) return null;
  const mask = new Uint8Array(w * h); let fx0 = w, fy0 = h, fx1 = -1, fy1 = -1;
  for (const p of best.px) { const x = p % w, y = (p / w) | 0; if (!mine(x, y)) continue; mask[p] = 1; if (x < fx0) fx0 = x; if (x > fx1) fx1 = x; if (y < fy0) fy0 = y; if (y > fy1) fy1 = y; }
  const fw = fx1 - fx0 + 1, fh = fy1 - fy0 + 1;
  if (fw < 4 || fh < 3 || fw > 13 || fh > 8 || best.n < 10) return null;
  let hx0 = w, hx1 = -1; for (let y = y0; y <= hz; y++) for (let x = x0; x <= x1; x++) if (mine(x, y)) { if (x < hx0) hx0 = x; if (x > hx1) hx1 = x; }
  const turn = Math.max(-1, Math.min(1, ((fx0 + fx1) / 2 - (hx0 + hx1) / 2) / Math.max(1, (hx1 - hx0) / 2)));
  const skinIdx = []; for (const p of best.px) if (S[p]) skinIdx.push(p);
  return { info: { w, h, mask, x0: fx0, y0: fy0, x1: fx1, y1: fy1, head: { x0: hx0, x1: hx1, y0, y1: hz }, turn, skinIdx, hairIdx: [] }, skin: K };
}
function closeMask(m, w, h, rx, ry) {
  const dil = a => { const o = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let j = -ry; j <= ry && !v; j++) for (let i = -rx; i <= rx; i++) { const X = x + i, Y = y + j; if (X >= 0 && Y >= 0 && X < w && Y < h && a[Y * w + X]) { v = 1; break; } } o[y * w + x] = v; } return o; };
  const ero = a => { const o = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 1; for (let j = -ry; j <= ry && v; j++) for (let i = -rx; i <= rx; i++) { const X = x + i, Y = y + j; if (X < 0 || Y < 0 || X >= w || Y >= h || !a[Y * w + X]) { v = 0; break; } } o[y * w + x] = v; } return o; };
  return ero(dil(m));
}
