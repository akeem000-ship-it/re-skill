// Where the face is in one of a hero's labelled frames (label.js): the skin pixels of the head, closed over the eyes and
// mouth the sprite draws in dark pixels, so a detailed face (detailface.js) can be drawn over the same pixels.
//   faceInfoOf(st) -> { w, h, mask: Uint8Array(w*h), x0, y0, x1, y1, head: { x0, x1, y0, y1 }, turn } | null (no face: seen from behind)
// turn: how far the face lies to one side of the head, -1..1 (0 = facing us, about 0.3 = three quarters, 0.6+ = profile).
import { REG } from "./label.js";

function closeMask(m, w, h, rx = 2, ry = 2) {                // closing: fills the gaps the sprite draws its eyes and mouth in (dark pixels inside the skin)
  const dil = a => { const o = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let j = -ry; j <= ry && !v; j++) for (let i = -rx; i <= rx; i++) { const X = x + i, Y = y + j; if (X >= 0 && Y >= 0 && X < w && Y < h && a[Y * w + X]) { v = 1; break; } } o[y * w + x] = v; } return o; };
  const ero = a => { const o = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 1; for (let j = -ry; j <= ry && v; j++) for (let i = -rx; i <= rx; i++) { const X = x + i, Y = y + j; if (X < 0 || Y < 0 || X >= w || Y >= h || !a[Y * w + X]) { v = 0; break; } } o[y * w + x] = v; } return o; };
  return ero(dil(m));
}
export function faceInfoOf(st) {
  const { w, h, reg, info } = st; if (!info) return null;
  const yh = Math.min(h, Math.ceil(info.yh)), S = new Uint8Array(w * h);
  let n = 0, hx0 = w, hx1 = -1, hy0 = h; const hairIdx = [];
  for (let y = info.y0; y < yh; y++) for (let x = 0; x < w; x++) {
    const r = reg[y * w + x];
    if (r === REG.SKIN || r === REG.SHADE) { S[y * w + x] = 1; n++; }
    if ((r === REG.HAIR || r === REG.HAIR2 || r === REG.HAIR3) && hairIdx.length < 60) hairIdx.push(y * w + x);
    if (r === REG.SKIN || r === REG.SHADE || r === REG.HAIR || r === REG.HAT || r === REG.HAIR2 || r === REG.HAIR3) { hx0 = Math.min(hx0, x); hx1 = Math.max(hx1, x); hy0 = Math.min(hy0, y); }
  }
  if (n < 5) return null;
  const C = closeMask(S, w, h), lab = new Int32Array(w * h).fill(-1), comps = [];
  for (let i = 0; i < w * h; i++) {                           // 8-connected components of the closed mask; the one holding most skin is the face
    if (!C[i] || lab[i] >= 0) continue;
    const q = [i], c = { n: 0, px: [] }; lab[i] = comps.length;
    for (let k = 0; k < q.length; k++) {
      const p = q[k], x = p % w, y = (p / w) | 0; c.px.push(p); if (S[p]) c.n++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X; if (C[j] && lab[j] < 0) { lab[j] = comps.length; q.push(j); } }
    }
    comps.push(c);
  }
  let best = null; for (const c of comps) if (!best || c.n > best.n) best = c;
  if (!best || best.n < 5) return null;
  const mask = new Uint8Array(w * h); let x0 = w, y0 = h, x1 = -1, y1 = -1, ys0 = h;
  for (const p of best.px) { const x = p % w, y = (p / w) | 0; if (S[p]) ys0 = Math.min(ys0, y); }
  for (const p of best.px) { const x = p % w, y = (p / w) | 0; if (y > ys0 + 6) continue; mask[p] = 1; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }   // not down the neck and arms
  if (x1 < 0) return null;
  const hc = (hx0 + hx1) / 2, turn = Math.max(-1, Math.min(1, ((x0 + x1) / 2 - hc) / Math.max(1, (hx1 - hx0) / 2)));
  const skinIdx = []; for (const p of best.px) if (S[p] && mask[p]) skinIdx.push(p);
  return { w, h, mask, x0, y0, x1, y1, head: { x0: hx0, x1: hx1, y0: hy0, y1: yh - 1 }, turn, skinIdx, hairIdx };
}
