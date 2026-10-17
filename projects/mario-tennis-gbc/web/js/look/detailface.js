// Facial expressions for the detailed sprites (detail.js): eyes, brows and a mouth drawn at 3x over a character's face pixels
// (faceinfo.js for the heroes' labelled frames, faceauto.js for any figure), in four moods that come from the frame the game
// shows: neutral, effort (swinging, running, diving), happy (point won) and sad (point lost); "blink" is neutral with the eyes
// shut. Hand-made small pixel art written for this project; nothing is taken from the ROM.
//
//   faceCanvas(info, mood, { hair }) -> { w, h, px: Uint32Array }   the face's box at 3x (not mirrored); px 0 = nothing
//   cleanFace(src, info, at, skin)                                   (1x) the sprite's own dark eye / mouth pixels become skin
export const MOODS = ["neutral", "effort", "happy", "sad", "blink"];

const pack = (r, g, b) => (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0;
const C = { O: pack(34, 18, 40), W: pack(252, 248, 250), I: pack(48, 30, 42), S: pack(255, 255, 255), M: pack(150, 44, 56), L: pack(226, 112, 124), T: pack(252, 248, 250), Z: pack(122, 178, 246), K: pack(240, 140, 134) };

// eye glyphs [size class][mood]: rows of tokens ("." = leave the skin). The left eye; the right eye is mirrored.
// tiny: faces 3 rows tall (9 subpixels), small: up to 4 rows, big: taller
const EYES = {
  tiny: {
    neutral: ["OOO", "SOO", "OOO"], effort: ["OOO", "OOO"], happy: [".O.", "O.O"], sad: ["OOO", "SOO", "OOO"], blink: ["...", "OOO"],
  },
  small: {
    neutral: ["OOO", "SOO", "OOO"], effort: ["OOO", "OIO", ".I."], happy: [".O.", "O.O"], sad: ["OOO", "SOO", "OOO"], blink: ["...", "OOO"],
  },
  big: {
    neutral: ["OOOO", "OSIO", "OIIO", ".OO."], effort: ["OOOO", "OIIO", ".II."], happy: [".OO.", "O..O"], sad: ["OOOO", "OSIO", "OIIO", ".OO."], blink: ["....", "OOOO"],
  },
};
const MOUTH = {
  tiny: { neutral: ["MMM"], effort: ["TTTT", "MMMM"], happy: ["M...M", ".MMM."], sad: [".MMM.", "M...M"], blink: ["MMM"] },
  small: { neutral: ["MMM"], effort: ["TTTT", "MMMM"], happy: ["M...M", ".MMM."], sad: [".MMM.", "M...M"], blink: ["MMM"] },
  big: { neutral: ["MMMMM"], effort: ["MMMMM", "TTTTT", "M...M"], happy: ["MTTTM", "MLLLM", ".MMM."], sad: [".MMM.", "M...M"], blink: ["MMMMM"] },
};

export function faceCanvas(info, mood, opts = {}) {
  if (!EYES.tiny[mood]) mood = "neutral";
  const bw = info.x1 - info.x0 + 1, bh = info.y1 - info.y0 + 1, W = bw * 3, H = bh * 3, px = new Uint32Array(W * H);
  const cls = H <= 9 ? "tiny" : H <= 14 ? "small" : "big";
  const inMask = (x, y) => x >= 0 && y >= 0 && x < W && y < H && info.mask[(info.y0 + (y / 3 | 0)) * info.w + info.x0 + (x / 3 | 0)];
  const spanOf = y => { let a = -1, b = -1; for (let x = 0; x < W; x++) if (inMask(x, y)) { if (a < 0) a = x; b = x; } return a < 0 ? null : [a, b]; };
  const put = (x, y, t) => { if (t === "." || !C[t] || !inMask(x, y)) return; px[y * W + x] = C[t]; };
  const glyph = (rows, x0, y0, mirror = false) => rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) put(x0 + (mirror ? r.length - 1 - i : i), y0 + j, r[i]); });
  if (info.eyes && info.eyes.length) return keepEyes(info, mood, opts, { W, H, px, inMask, spanOf, put, glyph, cls });
  const spans = []; for (let y = 0; y < H; y++) spans.push(spanOf(y));
  const wide = y => spans[y] ? spans[y][1] - spans[y][0] + 1 : 0;
  // the eye row: a quarter of the way down, where the face is wide enough
  let ye = Math.max(0, Math.round(H * (cls === "tiny" ? 0.3 : 0.25))); while (ye < H - 3 && wide(ye) < 7) ye++;
  const rows = EYES[cls][mood], ew = rows[0].length, ehh = rows.length;
  const sp = spans[Math.min(H - 1, ye + 1)] || spans[ye] || [0, W - 1], span = sp[1] - sp[0] + 1, xc = Math.round((sp[0] + sp[1]) / 2);
  const t = info.turn, side = Math.abs(t) > 0.5 ? Math.sign(t) : 0, shift = Math.round(t * W * 0.14), ds = Math.max(Math.ceil(ew / 2) + 1, Math.round(span * 0.27));
  const lx = Math.round(xc + shift - ds - ew / 2 + 0.5), rx = Math.round(xc + shift + ds - ew / 2 + 0.5);
  if (side) glyph(rows, Math.round(xc + shift + side * Math.round(ds * 0.6) - ew / 2 + 0.5), ye);
  else { glyph(rows, lx, ye); glyph(rows, rx, ye, true); }
  // brows: a slanted line above each eye in the hair colour (effort: down towards the nose, sad: up towards it, happy: raised)
  const hair = opts.hair ? (opts.hair | 0xFF000000) >>> 0 : C.I;
  if (mood === "effort" || mood === "sad" || (mood === "happy" && cls !== "tiny")) {
    const slope = mood === "effort" ? 1 : mood === "sad" ? -1 : 0, by0 = ye - 1;
    for (const [k, x0] of [lx, rx].entries()) {
      if (side && k === 1) continue;
      for (let i = 0; i < ew; i++) {
        const inner = k === 0 ? i / (ew - 1) : 1 - i / (ew - 1), y = by0 + (slope > 0 ? Math.round(inner) : slope < 0 ? -Math.round(inner) : 0) - (mood === "happy" ? 1 : 0);
        if (y >= 0 && inMask(x0 + i, y)) px[y * W + x0 + i] = hair;
      }
    }
  }
  // mouth
  const mrows = MOUTH[cls][mood], mw = mrows[0].length;
  const ym = Math.min(H - mrows.length, Math.max(ye + ehh + 1, Math.round(H * (cls === "tiny" ? 0.7 : 0.72))));
  const mx = Math.round(xc + shift * 1.4 + side * Math.round(W * 0.08) - mw / 2 + 0.5);
  if (ym >= ye + ehh) glyph(mrows, mx, ym);
  // a tear on a sad face, blush on a happy one
  if (mood === "sad") { put((side ? lx + 1 : lx + ew - 1), ye + ehh, "Z"); put((side ? lx + 1 : lx + ew - 1), ye + ehh + 1, "Z"); }
  if (mood === "happy" && cls !== "tiny") for (const dx of [-1, 1]) { const cx = Math.round(xc + shift + dx * (ds + 3)); put(cx, ye + ehh, "K"); put(cx + dx, ye + ehh, "K"); }
  return { w: W, h: H, px };
}

// the sprite's own dark pixels inside the face (its eyes and mouth) become the skin colour, so the detailed features sit on a clean face.
// `at(x, y)` maps a face-mask pixel (frame space) to an index in src or -1 when it is not drawn
export function cleanFace(src, info, at, skin) {
  for (let y = info.y0; y <= info.y1; y++) for (let x = info.x0; x <= info.x1; x++) {
    if (!info.mask[y * info.w + x]) continue; const i = at(x, y); if (i >= 0 && src[i]) src[i] = skin;
  }
}

// Faces found in the pixels (faceauto.js) keep the sprite's own eyes, which give the character its look: they are given a shine, and
// the mood adds brows, a mouth, a tear, or, for a happy or blinking face, closed eyes drawn over them.
function keepEyes(info, mood, opts, { W, H, px, inMask, spanOf, put, glyph, cls }) {
  const skin = opts.skin ? (opts.skin | 0xFF000000) >>> 0 : 0, hair = opts.hair ? (opts.hair | 0xFF000000) >>> 0 : C.O;
  const eyes = info.eyes.map(e => ({ x0: (e.x0 - info.x0) * 3, x1: (e.x1 - info.x0 + 1) * 3 - 1, y0: (e.y0 - info.y0) * 3, y1: (e.y1 - info.y0 + 1) * 3 - 1 })).sort((a, b) => a.x0 - b.x0);
  const fill = (e, c) => { for (let y = e.y0; y <= e.y1; y++) for (let x = e.x0; x <= e.x1; x++) if (inMask(x, y)) px[y * W + x] = c; };
  let yLow = 0;
  for (const e of eyes) {
    yLow = Math.max(yLow, e.y1);
    if (mood === "happy" || mood === "blink") {
      if (skin) fill(e, skin);
      const w = e.x1 - e.x0 + 1, cx = (e.x0 + e.x1) >> 1;
      if (mood === "blink") { for (let x = e.x0; x <= e.x1; x++) put(x, e.y1, "O"); }
      else { for (let x = e.x0; x <= e.x1; x++) put(x, e.y1 - (x === e.x0 || x === e.x1 ? 0 : 1), "O"); if (w >= 6) put(cx, e.y1 - 1, "O"), put(cx + 1, e.y1 - 1, "O"); }
    } else {
      put(e.x0, e.y0, "S");                                                  // the shine
      if (mood === "effort") for (let x = e.x0; x <= e.x1; x++) { const inner = eyes.length > 1 ? ((x - e.x0) / Math.max(1, e.x1 - e.x0)) : 0.5, k = e === eyes[0] ? inner : 1 - inner; const y = e.y0 - 1 - 0 + (k > 0.5 ? 1 : 0); if (y >= 0 && inMask(x, y)) px[y * W + x] = hair; if (y - 1 >= 0 && inMask(x, y - 1) && k <= 0.5) px[(y - 1) * W + x] = hair; }
      if (mood === "sad") { for (let x = e.x0; x <= e.x1; x++) { const inner = eyes.length > 1 ? ((x - e.x0) / Math.max(1, e.x1 - e.x0)) : 0.5, k = e === eyes[0] ? inner : 1 - inner; const y = e.y0 - 1 - (k > 0.5 ? 1 : 0); if (y >= 0 && inMask(x, y)) px[y * W + x] = hair; } if (e === eyes[0]) { put(e.x1, e.y1 + 1, "Z"); put(e.x1, e.y1 + 2, "Z"); } }
    }
  }
  if (mood === "happy" && cls !== "tiny") for (const e of eyes) { put(e.x0 - 1, e.y1 + 2, "K"); put(e.x1 + 1, e.y1 + 2, "K"); }
  const cx = Math.round(eyes.reduce((a, e) => a + (e.x0 + e.x1) / 2, 0) / eyes.length), mrows = MOUTH[cls][mood] || MOUTH[cls].neutral, mw = mrows[0].length;
  const ym = Math.min(H - mrows.length, Math.max(yLow + 3, Math.round(H * 0.7)));
  if (ym > yLow + 1) glyph(mrows, Math.round(cx - mw / 2 + 0.5), ym);
  return { w: W, h: H, px };
}
