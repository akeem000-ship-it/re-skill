// Region labelling and hairstyle edits on the heroes' own frames, computed at run time from the user's ROM
// (nothing derived from the ROM is stored here: the rules below only look at colour indices and geometry).
//
// A frame is turned into two planes of the same size:
//   reg: what each pixel is (REG.*), used by the renderer to colour the hero with the player's colours;
//   idx: the 2bpp colour index written back into the ROM copy (unchanged where the pixel was not edited, so
//        the game's own picture, and anything drawn with the game's palette, stays coherent).
//
// Colour roles in the original art (REVERSE.md / the creator research): Alex's palette is 1 cream (cap, shirt
// trim, shorts), 2 red (all skin), 3 black (outline, hair, eyes, shoes); Nina's is 1 cream (skin and clothes),
// 2 orange (hair, skirt), 3 black. Portraits are BG tiles: colour 0 is the visible card behind the face.

import { NEW_STYLES, hairStyleSprite } from "./hairsprites.js";

export const REG = { NONE: 0, OUT: 1, SKIN: 2, HAIR: 3, HAT: 4, TOP: 5, BOTTOM: 6, SHOES: 7, KEEP: 8, SHADE: 9, RACKET: 10, CARD: 11, HAIR2: 12, HAIR3: 13, HILITE: 14 };
const { NONE, OUT, SKIN, HAIR, HAT, TOP, BOTTOM, SHOES, KEEP, SHADE, RACKET, HAIR2, HAIR3, HILITE } = REG;

// colour index each region is written with when a pixel is edited (the hero's own palette layout)
const LAYOUT = {
  alex: { [RACKET]: 3, [OUT]: 3, [HAIR]: 3, [SKIN]: 2, [SHADE]: 2, [HAT]: 1, [TOP]: 1, [BOTTOM]: 1, [SHOES]: 3, [HAIR2]: 3, [HAIR3]: 3, [HILITE]: 2 },
  nina: { [RACKET]: 3, [OUT]: 3, [HAIR]: 2, [SKIN]: 1, [SHADE]: 1, [HAT]: 1, [TOP]: 1, [BOTTOM]: 2, [SHOES]: 3, [HAIR2]: 2, [HAIR3]: 2, [HILITE]: 1 },
};

export const STYLES = { alex: ["cap", "headband", "ponytail", "short", ...NEW_STYLES], nina: ["pigtails", "cap", "bob", "ponytail", ...NEW_STYLES] };
// the styles an opponent mod may use: the creator's, plus sprite-only ones (a mod brings its own portrait art)
export const MOD_STYLES = { alex: [...STYLES.alex, "spiky", "neat", "visor"], nina: STYLES.nina };

// ---------------------------------------------------------------------------------------------- helpers
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]], N8 = [...N4, [1, 1], [1, -1], [-1, 1], [-1, -1]];

function bbox(w, h, pred) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (pred(y * w + x)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}
// flood fill over pixels where ok(i) from the seed indices; returns a Uint8Array mask
function flood(w, h, seeds, ok, nb = N4) {
  const m = new Uint8Array(w * h), q = [];
  for (const s of seeds) if (ok(s) && !m[s]) { m[s] = 1; q.push(s); }
  while (q.length) {
    const i = q.pop(), x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of nb) {
      const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const j = Y * w + X; if (!m[j] && ok(j)) { m[j] = 1; q.push(j); }
    }
  }
  return m;
}

// a racket head is drawn as a checkerboard of colours 1 and 3; mark those pixels (and the racket's rim and
// handle next to them) so they keep the game's own colours
function racketMask(im) {
  const { w, h, px } = im, at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : px[y * w + x];
  const chk = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = at(x, y); if (v !== 1 && v !== 3) continue;
    const o = v === 1 ? 3 : 1;
    if (at(x - 1, y) === o && at(x + 1, y) === o && at(x, y - 1) === o && at(x, y + 1) === o &&
        ((at(x - 1, y - 1) === v) + (at(x + 1, y - 1) === v) + (at(x - 1, y + 1) === v) + (at(x + 1, y + 1) === v)) >= 2) chk[y * w + x] = 1;
  }
  // components of checker pixels (8-connected through distance 2): keep the ones with >= 3 members
  const seen = new Uint8Array(w * h), keep = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!chk[i] || seen[i]) continue;
    const comp = [i]; seen[i] = 1;
    for (let k = 0; k < comp.length; k++) {
      const x = comp[k] % w, y = (comp[k] / w) | 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const j = Y * w + X; if (chk[j] && !seen[j]) { seen[j] = 1; comp.push(j); }
      }
    }
    if (comp.length < 3) continue;
    // the racket face: the checker pixels' bounding box, grown by one, restricted to colours 1/3
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (const j of comp) { const x = j % w, y = (j / w) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    for (let y = y0 - 1; y <= y1 + 1; y++) for (let x = x0 - 1; x <= x1 + 1; x++) {
      const v = at(x, y); if (v === 1 || v === 3) keep[y * w + x] = 1;
    }
  }
  return keep;
}

// re-outline after edits: transparent pixels touching a coloured pixel become outline; stray outline with no
// coloured neighbour is removed
function reoutline(st, removed = null) {
  const { w, h, reg, idx, lay } = st, R = Uint8Array.from(reg), yTop = st.info ? st.info.yh : h;
  const near = (x, y) => { if (!removed) return y < yTop; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && removed[Y * w + X]) return true; } return false; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (reg[i] !== NONE) continue;
    for (const [dx, dy] of N4) {
      const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const r = reg[Y * w + X]; if (r !== NONE && r !== OUT && r !== KEEP) { R[i] = OUT; idx[i] = lay[OUT]; break; }
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (R[i] !== OUT || !near(x, y)) continue;   // only where pixels were removed (the shadow is solid outline)
    let ok = false;
    for (const [dx, dy] of N8) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h) { const r = R[Y * w + X]; if (r !== NONE && r !== OUT) ok = true; } }
    if (!ok) { R[i] = NONE; idx[i] = 0; }
  }
  st.reg.set(R);
}

// which way the head looks: -1 left, +1 right, 0 front, null back (no skin in the head)
function facing(st) {
  const { w, reg, info } = st; if (!info) return null;
  let n = 0, sx = 0, hx0 = w, hx1 = -1;
  for (let y = info.y0; y < info.yh; y++) for (let x = 0; x < w; x++) {
    const r = reg[y * w + x]; if (r === NONE || r === KEEP) continue;
    if (r === SKIN) { n++; sx += x; }
    hx0 = Math.min(hx0, x); hx1 = Math.max(hx1, x);
  }
  if (n < 3) return null;
  const d = sx / n - (hx0 + hx1) / 2;
  return Math.abs(d) < 1 ? 0 : d < 0 ? -1 : 1;
}

// ---------------------------------------------------------------------------------------------- labelling
// sprite frames (walk 16x16, match 24x32 / 32x32 with the standing shadow, the 16x16 HUD heads): colour 0 transparent
export function labelSprite(im, hero, kind) {
  const { w, h, px } = im, n = w * h, reg = new Uint8Array(n), idx = Uint8Array.from(px);
  const st = { w, h, reg, idx, lay: LAYOUT[hero], hero, kind, info: null };
  const bb = bbox(w, h, i => px[i] !== 0); if (!bb) return st;
  const H = bb.y1 - bb.y0 + 1;
  const yh = kind === "head" ? h : bb.y0 + Math.round(H * (kind === "walk" ? 0.56 : 0.42));
  // the body's lowest row with colour 1 or 2 (above the standing shadow): the feet
  let yb = bb.y0; for (let i = 0; i < n; i++) if (px[i] === 1 || px[i] === 2) yb = Math.max(yb, (i / w) | 0);
  const waist = yh + (yb - yh) * 0.55;
  const rk = kind === "head" ? new Uint8Array(n) : racketMask(im);
  st.info = { y0: bb.y0, yh, y1: bb.y1, yb, cx: (bb.x0 + bb.x1) / 2 };
  if (hero === "alex") {
    const seeds = []; for (let y = bb.y0; y < Math.min(bb.y0 + 4, h); y++) for (let x = 0; x < w; x++) if (px[y * w + x] === 1) seeds.push(y * w + x);
    const cap = flood(w, h, seeds, i => px[i] === 1 && !rk[i] && ((i / w) | 0) < yh);
    for (let i = 0; i < n; i++) {
      const v = px[i], y = (i / w) | 0; if (!v) continue;
      if (rk[i]) reg[i] = v === 3 ? RACKET : KEEP;
      else if (v === 3) reg[i] = OUT;
      else if (v === 2) reg[i] = SKIN;
      else if (cap[i] || y < yh) reg[i] = HAT;
      else if (kind !== "head" && y >= yb - 1) reg[i] = SHOES;
      else reg[i] = y < waist ? TOP : BOTTOM;
    }
  } else {
    const seeds = []; for (let i = 0; i < n; i++) if (px[i] === 2 && ((i / w) | 0) < yh && !rk[i]) seeds.push(i);
    const hair = flood(w, h, seeds, i => px[i] === 2 && !rk[i], N8);
    // the skirt's columns give the torso's width; the shirt is the colour-1 run above the skirt inside them
    let sx0 = w, sx1 = -1, sy0 = h;
    for (let i = 0; i < n; i++) if (px[i] === 2 && !hair[i] && !rk[i]) { const x = i % w, y = (i / w) | 0; sx0 = Math.min(sx0, x); sx1 = Math.max(sx1, x); sy0 = Math.min(sy0, y); }
    if (sx1 < 0) { const half = kind === "walk" ? 3 : 4; sx0 = Math.floor(st.info.cx - half); sx1 = Math.ceil(st.info.cx + half); sy0 = Math.round(waist + 1); }
    for (let i = 0; i < n; i++) {
      const v = px[i], x = i % w, y = (i / w) | 0; if (!v) continue;
      if (rk[i]) reg[i] = v === 3 ? RACKET : KEEP;
      else if (v === 3) reg[i] = OUT;
      else if (v === 2) reg[i] = hair[i] ? HAIR : BOTTOM;
      else if (y < yh || kind === "head") reg[i] = SKIN;
      else if (y >= yb - 1 && kind !== "head") reg[i] = SHOES;
      else if (y < sy0 && x >= sx0 && x <= sx1) reg[i] = TOP;
      else reg[i] = SKIN;
    }
  }
  return st;
}

// BG portraits (24x24, the 32x32 win/lose faces): an outer frame and a card (colour 0) behind the face
export function labelPortrait(im, hero) {
  const { w, h, px } = im, n = w * h, reg = new Uint8Array(n), idx = Uint8Array.from(px);
  const st = { w, h, reg, idx, lay: LAYOUT[hero], hero, kind: "portrait", info: null };
  const frame = i => { const x = i % w, y = (i / w) | 0; return x === 0 || y === 0 || x === w - 1 || y === h - 1; };
  const inner = []; for (let i = 0; i < n; i++) { const x = i % w, y = (i / w) | 0; if (x === 1 || y === 1 || x === w - 2 || y === h - 2) inner.push(i); }
  // the card behind the face: colour 0 reached from the frame; Alex's faces also use a colour-2 backdrop in the
  // upper half (the same colour as his skin), reached from the frame's upper half
  const card = flood(w, h, inner, i => px[i] === 0 && !frame(i));
  if (hero === "alex") {
    const up = inner.filter(i => ((i / w) | 0) < h / 2 && px[i] === 2);
    const bg = flood(w, h, up, i => px[i] === 2 && !frame(i)); for (let i = 0; i < n; i++) if (bg[i]) card[i] = 1;
  }
  // the face: the skin-coloured pixels' box (Alex: colour 2; Nina: colour 1), the card left out
  const skinIdx = hero === "alex" ? 2 : 1;
  const sk = bbox(w, h, i => px[i] === skinIdx && !frame(i) && !card[i] && ((i / w) | 0) > 2);
  let faceTop = (h / 3) | 0;                                                   // the first row that is mostly face
  for (let y = 3; y < h; y++) { let k = 0; for (let x = 1; x < w - 1; x++) if (px[y * w + x] === skinIdx && !card[y * w + x]) k++; if (k >= w / 5) { faceTop = y; break; } }
  const chin = Math.round(h * 0.79);
  // a dark mass (colour 3 with >= 3 dark 4-neighbours) above the chin is hair, thin dark lines are outline
  const dark = i => px[i] === 3;
  const isMass = i => { const x = i % w, y = (i / w) | 0; let k = 0; for (const [dx, dy] of N4) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && dark(Y * w + X)) k++; } return k >= 3; };
  let cap = new Uint8Array(n);
  if (hero === "alex") {
    const seeds = []; for (let y = 1; y < Math.min(7, h); y++) for (let x = 1; x < w - 1; x++) if (px[y * w + x] === 1) seeds.push(y * w + x);
    cap = flood(w, h, seeds, i => px[i] === 1 && !frame(i) && ((i / w) | 0) < faceTop + 4);
  }
  for (let i = 0; i < n; i++) {
    const v = px[i], y = (i / w) | 0;
    if (frame(i) || card[i]) { reg[i] = KEEP; continue; }
    if (hero === "alex") {
      if (v === 2) reg[i] = SKIN;
      else if (v === 3) reg[i] = (y < chin && isMass(i)) ? HAIR : OUT;
      else if (v === 1) reg[i] = cap[i] ? HAT : y >= chin - 2 ? TOP : KEEP;     // eye and teeth whites keep their colour
      else reg[i] = NONE;                                                     // inner colour 0: decided below
    } else {
      if (v === 2) reg[i] = y >= chin ? TOP : HAIR;
      else if (v === 3) reg[i] = OUT;
      else if (v === 1) reg[i] = y >= chin && w === 24 ? TOP : SKIN;          // the 32x32 faces show hands there, not the shirt
      else reg[i] = y >= chin ? (w === 24 ? TOP : SKIN) : HILITE;             // colour 0 inside the face: the highlights of the game's own portrait (a lighter skin)
    }
  }
  // Alex's inner colour-0 pixels are highlights / shading of what they sit in: take the most common neighbour region
  if (hero === "alex") for (let pass = 0; pass < 3; pass++) for (let i = 0; i < n; i++) {
    if (reg[i] !== NONE || card[i] || frame(i)) continue;
    const x = i % w, y = (i / w) | 0, cnt = {};
    for (const [dx, dy] of N8) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const r = reg[Y * w + X]; if (r && r !== OUT && r !== KEEP) cnt[r] = (cnt[r] || 0) + 1; }
    let best = 0, br = 0; for (const r in cnt) if (cnt[r] > best) { best = cnt[r]; br = +r; }
    if (br) reg[i] = br === SKIN ? HILITE : br; else if (pass === 2) reg[i] = KEEP;
  }
  st.info = { y0: sk ? sk.y0 : 0, yh: chin, faceTop, sk };
  return st;
}

// ---------------------------------------------------------------------------------------------- styles
function set(st, i, r) { st.reg[i] = r; st.idx[i] = r === NONE ? 0 : st.lay[r]; }

// the dark pixels inside the head next to the cap (bangs, sides, the back of the neck) become hair, so a hair
// colour shows under the cap; eyes (dark pixels inside the face, not touching the cap) stay outline
function hairUnderCap(st) {
  const { w, h, reg, info } = st; if (!info) return;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? NONE : reg[y * w + x];
  const interior = (x, y) => N4.every(([dx, dy]) => at(x + dx, y + dy) !== NONE);
  const grow = (from, rows) => {
    const add = [];
    for (let y = info.y0; y < Math.min(rows, h); y++) for (let x = 0; x < w; x++) {
      if (at(x, y) !== OUT || !interior(x, y)) continue;
      if (N4.some(([dx, dy]) => from.includes(at(x + dx, y + dy)))) add.push(y * w + x);
    }
    for (const i of add) set(st, i, HAIR);
    return add.length;
  };
  grow([HAT], info.yh);
  // one more ring at the sides, above the eyes' row (the face's upper third)
  let fy = h; for (let i = 0; i < w * h; i++) if (reg[i] === SKIN && ((i / w) | 0) < info.yh) { fy = Math.min(fy, (i / w) | 0); }
  grow([HAIR], Math.min(info.yh, fy + 2));
}

// the cap's lower edge at the back that the labels took for the shirt (cap and shirt are both colour 1 in Alex's frames): in the first
// row under the cap, the shirt pixels within the cap's width; in the row after, the runs of shirt pixels that touch those
function capBand(st, hat) {
  const { w, h, reg } = st; let yb = -1; for (const i of hat) yb = Math.max(yb, (i / w) | 0);
  if (yb < 0 || yb + 1 >= h) return [];
  let x0 = w, x1 = -1; for (const i of hat) if (((i / w) | 0) >= yb - 1) { const x = i % w; x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  const band = new Set(); for (let x = Math.max(0, x0 - 1); x <= Math.min(w - 1, x1 + 1); x++) if (reg[(yb + 1) * w + x] === TOP) band.add((yb + 1) * w + x);
  if (yb + 2 < h) {
    const y = yb + 2;
    for (let x = x0; x <= x1; x++) {
      if (reg[y * w + x] !== TOP || (x > x0 && reg[y * w + x - 1] === TOP)) continue;                // the start of a run
      let e = x; while (e + 1 <= x1 && reg[y * w + e + 1] === TOP) e++;
      let touches = false; for (let k = x; k <= e; k++) if (band.has((y - 1) * w + k)) touches = true;
      if (touches) for (let k = x; k <= e; k++) band.add(y * w + k);
      x = e;
    }
  }
  return [...band];
}
// under a cap or a visor band: the shirt pixels right under it become hair (the nape), and the head's square corners are trimmed
function napeAndRound(st) {
  const { w, h, reg } = st, head = r => r === HAT || r === HAIR || r === HAIR2 || r === HAIR3;
  let yb = -1; for (let i = 0; i < w * h; i++) if (reg[i] === HAT) yb = Math.max(yb, (i / w) | 0);
  if (yb < 0) return;
  let x0 = w, x1 = -1; for (let i = 0; i < w * h; i++) if (reg[i] === HAT && ((i / w) | 0) >= yb - 1) { x0 = Math.min(x0, i % w); x1 = Math.max(x1, i % w); }
  for (let x = x0; x <= x1; x++) {                                    // down each column under the cap: past its outline, the first shirt pixel is hair
    let y = yb + 1; while (y < h && y <= yb + 2 && reg[y * w + x] === OUT) y++;
    if (y < h && y <= yb + 3 && reg[y * w + x] === TOP) set(st, y * w + x, HAIR);
  }
  const outside = (x, y) => x < 0 || y < 0 || x >= w || y >= h || reg[y * w + x] === NONE || (reg[y * w + x] === OUT && N4.some(([dx, dy]) => { const X = x + dx, Y = y + dy; return X < 0 || Y < 0 || X >= w || Y >= h || reg[Y * w + X] === NONE; }));
  const corners = [];
  for (let y = 0; y <= yb; y++) for (let x = 0; x < w; x++) {
    if (!head(reg[y * w + x])) continue;
    const v = outside(x, y - 1) ? -1 : outside(x, y + 1) ? 1 : 0, s = outside(x - 1, y) ? -1 : outside(x + 1, y) ? 1 : 0;
    if (v < 0 && s && !outside(x - s, y) && !outside(x, y - v) && outside(x - s, y + v)) corners.push(y * w + x);   // a square top corner
  }
  if (!corners.length) return;
  const removed = new Uint8Array(w * h); for (const i of corners) { set(st, i, NONE); removed[i] = 1; }
  reoutline(st, removed);
}
function styleAlex(st, style) {
  const { w, h, reg } = st;
  if (style === "cap") { if (st.kind !== "portrait") { hairUnderCap(st); for (const i of capBand(st, Array.from(st.reg.keys()).filter(i => st.reg[i] === HAT))) set(st, i, HAT); napeAndRound(st); } return; }
  const hat = []; for (let i = 0; i < w * h; i++) if (reg[i] === HAT) hat.push(i);
  if (!hat.length) return;
  const f = facing(st);
  for (const i of hat) set(st, i, HAIR);
  if (style === "headband" || style === "visor") {           // (visor: the headband over a smooth, round head: no tufts)
    if (st.kind !== "portrait") { const band = capBand(st, hat); if (band.length) { const rm = new Uint8Array(w * h); for (const i of band) { set(st, i, NONE); rm[i] = 1; } reoutline(st, rm); } }   // (the cap's back band, taken for the shirt: gone, a visor is open at the back)
    // the band: the lowest hair pixel of every column above the face (two rows seen from behind)
    const low = new Map(); for (const i of hat) { const x = i % w, y = (i / w) | 0; if (!low.has(x) || low.get(x) < y) low.set(x, y); }
    for (const [x, y] of low) { set(st, y * w + x, HAT); if (f === null && y > 0 && reg[(y - 1) * w + x] === HAIR) set(st, (y - 1) * w + x, HAT); }
    // spiky top: every other column of the head's top gets a two-pixel tuft
    const top = new Map(); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (reg[y * w + x] !== NONE && reg[y * w + x] !== KEEP && !top.has(x)) top.set(x, y);
    const xs = [...top.keys()].sort((a, b) => a - b).slice(1, -1);
    if (style === "headband") xs.forEach((x, k) => {
      const y = top.get(x); if (k % 2 || y < 2) return;
      if (reg[(y + 1) * w + x] !== HAIR && reg[(y + 1) * w + x] !== OUT) return;
      set(st, y * w + x, HAIR); set(st, (y - 1) * w + x, HAIR);
    });
  }
  if (style === "spiky" || style === "neat") {        // short hair: no brim, a ragged fringe, and tufts on top (spiky) or a smooth top (neat)
    const yTop = st.info ? st.info.yh : h; let removed = null;
    {                                                   // the brim (in front or, turned, behind): the cap's two lowest rows wider than its dome
      let yb = -1; for (const i of hat) yb = Math.max(yb, (i / w) | 0);
      let x0 = w, x1 = -1; for (const i of hat) { const y = (i / w) | 0; if (y < yb - 1) { const x = i % w; x0 = Math.min(x0, x); x1 = Math.max(x1, x); } }
      if (x1 >= 0) {
        removed = new Uint8Array(w * h);
        for (const i of hat) { const x = i % w, y = (i / w) | 0; if (y >= yb - 1 && (x < x0 || x > x1)) { set(st, i, NONE); removed[i] = 1; } }
      }
    }
    // the fringe: every other column over the face, the outline under the hair becomes hair, so the brim's straight edge breaks up
    const low = new Map(); for (const i of hat) { if (reg[i] !== HAIR) continue; const x = i % w, y = (i / w) | 0; if (!low.has(x) || low.get(x) < y) low.set(x, y); }
    [...low].sort((a, b) => a[0] - b[0]).forEach(([x, y], k) => {
      if (k % 2 || y + 2 >= h) return;
      if (reg[(y + 1) * w + x] === OUT && reg[(y + 2) * w + x] === SKIN) set(st, (y + 1) * w + x, HAIR);
    });
    // tufts: every other column of the head's top a pixel higher
    const top = new Map(); for (let y = 0; y < yTop; y++) for (let x = 0; x < w; x++) if (reg[y * w + x] === HAIR && !top.has(x)) top.set(x, y);
    if (style === "spiky") [...top].sort((a, b) => a[0] - b[0]).slice(1, -1).forEach(([x, y], k) => { if (!(k % 2) && y >= 2 && reg[(y - 1) * w + x] === OUT) set(st, (y - 1) * w + x, HAIR); });
    // the cap's back band that the labels took for the shirt goes with the cap
    { const band = capBand(st, hat); if (band.length) { removed = removed || new Uint8Array(w * h); for (const i of band) { set(st, i, NONE); removed[i] = 1; } } }
    // a rounded head: below its widest row the hair does not widen again (the brim's last rows hang down at the back of the neck)
    {
      const hairRow = y => { let a = w, b = -1; for (let x = 0; x < w; x++) if (reg[y * w + x] === HAIR) { a = Math.min(a, x); b = Math.max(b, x); } return [a, b]; };
      let yb = -1, wide = -1, yw = -1; for (const i of hat) yb = Math.max(yb, (i / w) | 0);
      for (let y = 0; y <= yb; y++) { const [a, b] = hairRow(y); if (b >= a && b - a > wide) { wide = b - a; yw = y; } }
      if (yw >= 0) {
        removed = removed || new Uint8Array(w * h);
        let [L, R] = hairRow(yw);
        for (let y = yw + 1; y <= yb; y++) {
          for (let x = 0; x < w; x++) { const i = y * w + x; if (reg[i] === HAIR && (x < L || x > R)) { set(st, i, NONE); removed[i] = 1; } }
          const [a, b] = hairRow(y); if (b >= a) { L = Math.max(L, a); R = Math.min(R, b); }
        }
      }
    }
    // round the square corners the cap left (its flat back and top): a hair pixel with the outside both above or below it and beside it
    {
      let yb = -1; for (const i of hat) yb = Math.max(yb, (i / w) | 0);
      const out = (x, y) => { const r = (x < 0 || y < 0 || x >= w || y >= h) ? NONE : reg[y * w + x]; return r === NONE || r === OUT; };
      const outside = (x, y) => out(x, y) && (x < 0 || y < 0 || x >= w || y >= h || reg[y * w + x] === NONE || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const X = x + dx, Y = y + dy; return X < 0 || Y < 0 || X >= w || Y >= h || reg[Y * w + X] === NONE; }));
      const corners = [];
      for (let y = 0; y <= yb; y++) for (let x = 0; x < w; x++) {
        if (reg[y * w + x] !== HAIR) continue;
        const v = outside(x, y - 1) ? -1 : outside(x, y + 1) ? 1 : 0, s = outside(x - 1, y) ? -1 : outside(x + 1, y) ? 1 : 0;
        if (v && s && !outside(x - s, y) && !outside(x, y - v) && outside(x - s, y + v) && (v < 0 || y >= yb - 2)) corners.push(y * w + x);   // (a square corner only: a stepped, already round edge stays)   // the top corners, and the bottom ones at the neck
      }
      removed = removed || new Uint8Array(w * h);
      for (const i of corners) { set(st, i, NONE); removed[i] = 1; }
      // neat: the cap's button off (a top row much narrower than the one under it reads as a point)
      if (style === "neat") for (let y = 0; y + 1 < h; y++) {
        const row = yy => { const xs = []; for (let x = 0; x < w; x++) if (reg[yy * w + x] === HAIR) xs.push(x); return xs; };
        const a = row(y); if (!a.length) continue;
        const b = row(y + 1); if (a.length <= 3 && b.length >= a.length + 3) for (const x of a) { set(st, y * w + x, NONE); removed[y * w + x] = 1; }
        break;
      }
    }
    reoutline(st, removed);
    // round off the head: outline in the cap's rows that touches nothing coloured (the cap's doubled edges and the stubs left where its
    // back and brim stuck out) goes
    let yb = -1; for (const i of hat) yb = Math.max(yb, (i / w) | 0);
    const coloured = r => r !== NONE && r !== OUT && r !== KEEP;
    for (let pass = 0; pass < 2; pass++) for (let y = 0; y <= Math.min(h - 1, yb + 1); y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (reg[i] !== OUT) continue;
      if (!N4.some(([dx, dy]) => { const X = x + dx, Y = y + dy; return X >= 0 && Y >= 0 && X < w && Y < h && coloured(reg[Y * w + X]); })) set(st, i, NONE);
    }
    // fill: the cap's band and seams left as outline inside the hair (outline that touches only hair, not the face or the background)
    const hairy = r => r === HAIR || r === HAIR2 || r === HAIR3, at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? NONE : reg[y * w + x];
    for (let pass = 0; pass < 3; pass++) for (let y = 0; y <= Math.min(h - 1, yb + 1); y++) for (let x = 0; x < w; x++) {
      if (at(x, y) !== OUT) continue;
      const nb = N4.map(([dx, dy]) => at(x + dx, y + dy));
      if (nb.some(r => r === NONE || (coloured(r) && !hairy(r)))) continue;
      if (nb.filter(hairy).length >= 2) set(st, y * w + x, HAIR);
    }
    // detail: darker strand tips along the fringe, a darker edge on the side away from the light, a highlight streak near the top-left
    const cells = []; for (let y = 0; y <= Math.min(h - 1, yb + 1); y++) for (let x = 0; x < w; x++) if (at(x, y) === HAIR) cells.push([x, y]);
    if (!cells.length) return;
    const hy0 = Math.min(...cells.map(c => c[1])), hx0 = Math.min(...cells.map(c => c[0])), hx1 = Math.max(...cells.map(c => c[0]));
    for (const [x, y] of cells) {
      const below = at(x, y + 1), right = at(x + 1, y);
      if ((below === OUT || below === SKIN) && y > hy0 + 1 && (x & 1)) set(st, y * w + x, HAIR2);              // fringe tips
      else if (right === OUT && x === hx1 - 1 + (at(hx1, y) === HAIR ? 1 : 0) && y > hy0) set(st, y * w + x, HAIR2);   // the shaded side
    }
    const span = hx1 - hx0, hlx = hx0 + Math.max(1, Math.round(span * 0.28));
    for (const [dx, dy] of [[0, 1], [1, 1], [1, 2]]) if (at(hlx + dx, hy0 + dy) === HAIR) set(st, (hy0 + dy) * w + hlx + dx, HAIR3);  // highlight
    return;
  }
  if ((style === "headband" || style === "visor") && st.kind !== "portrait") napeAndRound(st);
  if (style === "ponytail" && f !== 0) {
    let xl = w, xr = -1, yt = h, yb = -1;
    for (const i of hat) { const x = i % w, y = (i / w) | 0; xl = Math.min(xl, x); xr = Math.max(xr, x); yt = Math.min(yt, y); yb = Math.max(yb, y); }
    const tail = [];
    if (f === null) {                                   // from behind: the tail hangs down the middle
      const cx = (xl + xr) >> 1;
      for (let y = yb; y < Math.min(yb + 5, h - 1); y++) { tail.push([cx, y]); if (y < yb + 3) tail.push([cx + 1, y]); }
    } else {                                            // side view: out behind the head, then down
      const side = f < 0 ? 1 : -1, bx = side > 0 ? xr + 1 : xl - 1, yy = Math.max(yt + 2, yb - 2);
      for (let k = 0; k < 3; k++) tail.push([bx + side * k, yy], [bx + side * k, yy + 1]);
      tail.push([bx + side * 2, yy + 2], [bx + side * 2, yy + 3], [bx + side * 3, yy + 2]);
    }
    for (const [x, y] of tail) if (x >= 0 && y >= 0 && x < w && y < h) { const r = reg[y * w + x]; if (r === NONE || r === OUT || r === TOP) set(st, y * w + x, HAIR); }
  }
  reoutline(st);
}

function styleNina(st, style) {
  const { w, h, reg, info } = st;
  if (style === "pigtails" || !info) return;
  const hair = []; for (let i = 0; i < w * h; i++) if (reg[i] === HAIR) hair.push(i);
  if (!hair.length) return;
  // the head's core columns: the face's span, widened; seen from behind, the span of the top hair rows
  let cl = w, cr = -1;
  for (let y = info.y0; y < info.yh; y++) for (let x = 0; x < w; x++) if (reg[y * w + x] === SKIN) { cl = Math.min(cl, x); cr = Math.max(cr, x); }
  if (cr - cl >= 2) { cl -= 2; cr += 2; }
  else {
    let top = h; for (const i of hair) top = Math.min(top, (i / w) | 0);
    cl = w; cr = -1; for (const i of hair) if (((i / w) | 0) <= top + 2) { cl = Math.min(cl, i % w); cr = Math.max(cr, i % w); }
    cl -= 1; cr += 1;
  }
  const f = facing(st);
  let removed = null;
  if (style === "bob" || style === "cap" || style === "ponytail") {
    removed = new Uint8Array(w * h);
    for (const i of hair) { const x = i % w; if (x < cl || x > cr) { set(st, i, NONE); removed[i] = 1; } }
    for (let y = 0; y < info.yh; y++) for (let x = 0; x < w; x++) if (reg[y * w + x] === OUT && (x < cl - 1 || x > cr + 1)) { set(st, y * w + x, NONE); removed[y * w + x] = 1; }
  }
  if (style === "cap") {
    const rows = [...new Set(hair.filter(i => reg[i] === HAIR).map(i => (i / w) | 0))].sort((a, b) => a - b), capRows = new Set(rows.slice(0, 4));
    for (const i of hair) { const x = i % w; if (reg[i] === HAIR && capRows.has((i / w) | 0) && x >= cl && x <= cr) set(st, i, HAT); }
    if (f !== null && rows.length) {
      const yb = rows[Math.min(3, rows.length - 1)], xs = []; for (let x = 0; x < w; x++) if (reg[yb * w + x] === HAT) xs.push(x);
      if (xs.length) {
        const ext = [...(f <= 0 ? [xs[0] - 1, xs[0] - 2] : []), ...(f >= 0 ? [xs[xs.length - 1] + 1, xs[xs.length - 1] + 2] : [])];
        for (const x of ext) if (x >= 0 && x < w) { const r = reg[yb * w + x]; if (r === NONE || r === OUT || r === HAIR) set(st, yb * w + x, HAT); }
      }
    }
  }
  if (style === "ponytail" && f !== 0) {                // one tail, as Alex's
    let xl = w, xr = -1, yt = h, yb = -1;
    for (let i = 0; i < w * h; i++) if (reg[i] === HAIR) { const x = i % w, y = (i / w) | 0; xl = Math.min(xl, x); xr = Math.max(xr, x); yt = Math.min(yt, y); yb = Math.max(yb, y); }
    const tail = [];
    if (f === null) { const cx = (xl + xr) >> 1; for (let y = yb; y < Math.min(yb + 5, h - 1); y++) { tail.push([cx, y]); if (y < yb + 3) tail.push([cx + 1, y]); } }
    else {
      const side = f < 0 ? 1 : -1, bx = side > 0 ? xr + 1 : xl - 1, yy = Math.max(yt + 2, Math.min(yb, info.yh) - 3);
      for (let k = 0; k < 3; k++) tail.push([bx + side * k, yy], [bx + side * k, yy + 1]);
      tail.push([bx + side * 2, yy + 2], [bx + side * 2, yy + 3], [bx + side * 3, yy + 2]);
    }
    for (const [x, y] of tail) if (x >= 0 && y >= 0 && x < w && y < h) { const r = reg[y * w + x]; if (r === NONE || r === OUT || r === TOP) set(st, y * w + x, HAIR); }
  }
  reoutline(st, removed);
  if (removed) reoutline(st, removed);
}

function stylePortrait(st, style) {
  const { w, h, reg, hero, info } = st;
  const sk = info && info.sk;
  if (hero === "alex" && style !== "cap") {
    for (let i = 0; i < w * h; i++) if (reg[i] === HAT) set(st, i, HAIR);
    if (style === "headband" && sk) {
      // a band across the forehead: the two rows above the face, over the face's width
      const ft = info.faceTop;
      for (let x = sk.x0; x <= sk.x1; x++) for (let y = ft - 2; y < ft; y++) {
        const j = y * w + x; if (y > 0 && (reg[j] === HAIR || reg[j] === OUT || reg[j] === SHADE || reg[j] === HILITE || reg[j] === HAT)) set(st, j, HAT);
      }
    }
  }
  if (hero === "nina" && (style === "bob" || style === "cap" || style === "ponytail")) {
    // the buns sit in the outer sixth on both sides: back to card
    const m = Math.round(w / 6);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x; if ((x < m || x >= w - m) && y < info.yh && (reg[i] === HAIR || reg[i] === OUT)) { reg[i] = KEEP; st.idx[i] = 0; }
    }
    if (style === "cap") {
      for (let y = 1; y < Math.round(h / 4); y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (reg[i] === HAIR) set(st, i, HAT); }
    }
  }
}

export function applyStyle(st, style) {
  if (NEW_STYLES.includes(style) && st.kind !== "portrait") hairStyleSprite(st, style, { REG, set, reoutline, facing, styleAlex, styleNina });
  else if (st.kind === "portrait") stylePortrait(st, style);
  else if (st.hero === "alex") styleAlex(st, style);
  else styleNina(st, style);
  return st;
}

// extras drawn over a styled frame (mods.js): "glasses" turns the eyes into lenses in the hat colour (at 16-32 px the eyes are small
// dark blobs inside the face with hardly any skin round them, so the face's own outline is the frame)
export const EXTRAS = ["glasses"];
function glasses(st) {
  const { w, h, reg, info } = st; if (!info || st.kind === "portrait") return;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? NONE : reg[y * w + x];
  let sy0 = h; for (let i = 0; i < w * h; i++) if (reg[i] === SKIN && ((i / w) | 0) < info.yh) sy0 = Math.min(sy0, (i / w) | 0);
  if (sy0 >= h) return;
  const edge = r => r === NONE || r === HAIR || r === HAIR2 || r === HAIR3 || r === HAT;
  const lens = [];
  for (let y = sy0; y <= Math.min(info.yh, sy0 + 2); y++) for (let x = 0; x < w; x++) {
    if (at(x, y) !== OUT || N8.some(([dx, dy]) => edge(at(x + dx, y + dy)))) continue;     // inside the face: not its border with the hair or the background
    if (N4.some(([dx, dy]) => at(x + dx, y + dy) === SKIN)) lens.push(y * w + x);
  }
  for (const i of lens) set(st, i, HAT);
}
export function applyExtras(st, extras) {
  for (const e of extras || []) if (e === "glasses") glasses(st);
  return st;
}

// touch-ups: { x, y, r } pixel overrides, coordinates relative to the frame (hand-made, no ROM data)
export function applyTouchups(st, list) {
  for (const t of list || []) { if (t.x < 0 || t.y < 0 || t.x >= st.w || t.y >= st.h) continue; set(st, t.y * st.w + t.x, t.r); }
}
