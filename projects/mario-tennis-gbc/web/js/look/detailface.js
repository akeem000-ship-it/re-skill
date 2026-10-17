// Facial expressions for the detailed sprites (detail.js): eyes, brows and a mouth drawn at 3x over the hero's face pixels
// (faceinfo.js), in four moods that come from the frame the game shows: neutral, effort (swinging, running, diving),
// happy (point won) and sad (point lost). Hand-made small pixel art written for this project; nothing is taken from the ROM.
//
//   faceCanvas(info, mood, { hair }) -> { w, h, px: Uint32Array }   the face's box at 3x (frame space, not mirrored); px 0 = nothing
//   cleanFace(src, w, info, at)                                      (1x) the sprite's own dark eye / mouth pixels become skin
export const MOODS = ["neutral", "effort", "happy", "sad"];

const pack = (r, g, b) => (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0;
const C = { O: pack(34, 18, 40), W: pack(252, 248, 250), I: pack(48, 30, 42), S: pack(255, 255, 255), M: pack(150, 44, 56), L: pack(226, 112, 124), T: pack(252, 248, 250), Z: pack(122, 178, 246), K: pack(236, 150, 140) };

// eye glyphs by size class and mood: rows of tokens ("." = leave the skin). Left eye; the right eye is the same, mirrored.
const EYES = {
  neutral: { 2: ["OOO", "WIW"], 3: ["OOO", "WIW", "WIW"], 4: ["OOOO", "WSIW", "WIIW"] },
  effort: { 2: ["OOO", ".II"], 3: ["OOO", "OIW", ".I."], 4: ["OOOO", "OIIW", ".II."] },
  happy: { 2: [".O.", "O.O"], 3: [".O.", "O.O", "..."], 4: [".OO.", "O..O", "...."] },
  sad: { 2: ["OOO", "WII"], 3: ["OOO", "WII", "WIW"], 4: ["OOOO", "WIIW", "WIIW"] },
};
// mouths: [rows, ...]; width classes 3, 5
const MOUTH = {
  neutral: { 3: ["OOO"], 5: ["OOOOO"] },
  effort: { 3: ["TTT", "OOO"], 5: ["OOOOO", "TTTTT", "O...O"] },
  happy: { 3: ["O.O", ".O."], 5: ["OTTTO", "OLLLO", ".OOO."] },
  sad: { 3: [".O.", "O.O"], 5: [".OOO.", "O...O"] },
};

export function faceCanvas(info, mood, opts = {}) {
  const bw = info.x1 - info.x0 + 1, bh = info.y1 - info.y0 + 1, W = bw * 3, H = bh * 3, px = new Uint32Array(W * H);
  const inMask = (x, y) => x >= 0 && y >= 0 && x < W && y < H && info.mask[(info.y0 + (y / 3 | 0)) * info.w + info.x0 + (x / 3 | 0)];
  const rowSpan = y => { let a = -1, b = -1; for (let x = 0; x < W; x++) if (inMask(x, y)) { if (a < 0) a = x; b = x; } return a < 0 ? null : [a, b]; };
  const put = (x, y, t) => { if (t === "." || !C[t] || !inMask(x, y)) return; px[y * W + x] = C[t]; };
  const glyph = (rows, x0, y0, mirror = false) => rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) put(x0 + (mirror ? r.length - 1 - i : i), y0 + j, r[i]); });
  // rows with room: the first row from a quarter of the way down whose span is at least 7 subpixels wide
  const spans = []; for (let y = 0; y < H; y++) spans.push(rowSpan(y));
  const wide = y => spans[y] ? spans[y][1] - spans[y][0] + 1 : 0;
  const eh = H >= 13 ? 3 : 2, cls = W >= 24 && H >= 12 ? 4 : eh;
  let ye = Math.max(0, Math.round(H * 0.25)); while (ye < H - 3 && wide(ye) < 7) ye++;
  const ew = cls === 4 ? 4 : 3, rows = (EYES[mood] || EYES.neutral)[cls === 4 ? 4 : eh], ehh = rows.length;
  const sp = spans[Math.min(H - 1, ye + 1)] || spans[ye] || [0, W - 1], xc = Math.round((sp[0] + sp[1]) / 2), t = info.turn, side = Math.abs(t) > 0.5 ? Math.sign(t) : 0;
  const shift = Math.round(t * W * 0.14), ds = Math.max(ew / 2 + 1, Math.round((sp[1] - sp[0] + 1) * 0.26));
  const eyeAt = (cx, small) => { const r = small ? rows.map(s => s.slice(0, Math.max(2, ew - 1))) : rows; glyph(r, Math.round(cx - r[0].length / 2), ye, false); };
  if (side) eyeAt(xc + shift + side * Math.round(ds * 0.6), false);
  else { glyph(rows, Math.round(xc + shift - ds - ew / 2 + 0.5), ye); glyph(rows, Math.round(xc + shift + ds - ew / 2 + 0.5), ye, true); }
  // brows: a slanted line over each eye (effort: down towards the nose, sad: up towards the nose, happy: raised), in the hair colour
  const hair = opts.hair ? (opts.hair | 0xFF000000) >>> 0 : C.I;
  if (H >= 12 && ye >= 2) {
    const slope = mood === "effort" ? 1 : mood === "sad" ? -1 : 0, bx = [Math.round(xc + shift - ds - ew / 2 + 0.5), Math.round(xc + shift + ds - ew / 2 + 0.5)];
    for (const [k, x0] of bx.entries()) {
      if (side && k === 1) continue;
      for (let i = 0; i < ew; i++) {
        const inner = k === 0 ? i / (ew - 1) : 1 - i / (ew - 1), y = ye - 1 + (slope > 0 ? Math.round(inner) : slope < 0 ? -Math.round(inner) : 0) - (mood === "happy" ? 1 : 0);
        if (y >= 0 && inMask(x0 + i, y)) px[y * W + x0 + i] = hair;
      }
    }
  }
  // mouth
  const mw = W >= 21 ? 5 : 3, mrows = MOUTH[mood] ? MOUTH[mood][mw] : MOUTH.neutral[mw];
  let ym = Math.min(H - mrows.length, Math.max(ye + ehh + 1, Math.round(H * 0.72)));
  const mx = Math.round(xc + shift * 1.4 + side * Math.round(W * 0.08) - mrows[0].length / 2 + 0.5);
  if (ym >= ye + ehh) glyph(mrows, mx, ym);
  // tear / blush
  if (mood === "sad" && H >= 12) put(Math.round(xc + shift - ds - ew / 2 + 0.5) + (side ? 1 : 0), ye + ehh, "Z");
  if (mood === "happy" && H >= 12) for (const dx of [-1, 1]) { const cx = Math.round(xc + shift + dx * (ds + 2)); put(cx, ye + ehh + 1, "K"); put(cx + dx, ye + ehh + 1, "K"); }
  return { w: W, h: H, px };
}

// the sprite's own dark pixels inside the face (its eyes and mouth) become the skin colour, so the detailed features sit on a clean face.
// src: Uint32Array(w * hh); `at(x, y)` maps a face-mask pixel (frame space) to an index in src or -1 when it is not drawn
export function cleanFace(src, info, at, skin) {
  for (let y = info.y0; y <= info.y1; y++) for (let x = info.x0; x <= info.x1; x++) {
    if (!info.mask[y * info.w + x]) continue; const i = at(x, y); if (i >= 0 && src[i]) src[i] = skin;
  }
}
