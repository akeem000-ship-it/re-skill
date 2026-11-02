// THE DECK'S SHOT MAP (the portrait layout's deck, during golf; render only): a live overhead map of the hole under the controls,
// drawn from the game's own hole data at run time (g3d/hole3d.js HoleArt: the terrain type of every 2 x 2 px cell, TerrainAt 10:6536;
// the tree tiles, TreeCheck 08:51D2; the green's slope bytes, GreenSlopeAt 10:64D1), in procedural colours (fairway with mowing
// stripes, rough, deep rough, sand, water, the green, out of bounds, trees as round canopies). Turned so the shot goes up the deck:
//   aiming   the ball, the pin, the aim line and its target, rings every 50 y, the wind (the HUD's speed, its direction $C816 as the
//            flight's wind push 10:52EE), and the SHOT PREVIEW from above: the flight (wider where it flies higher), the landing
//            reticle, the roll to the rest mark and the same tag as over the picture ("284 y  carry 280"); exactly the result the
//            marks over the picture use (aimpower.js shotNow: shotpreview.js runPreview on a copy of the memory);
//   putting  the green from above: the slope of every green tile as a chevron (its colour the strength), the four break lines
//            (aimpower.js puttLines: 100 / 77 / 50 / 27 %) with their stops and rolls, the cup;
//   flight   the ball's live place on the map and its track since the swing, over the preview (faded).
// It zooms so the ball and the landing area fit (the pin too when it is near), and pans, zooms and turns smoothly when the aim
// changes. The controls stay readable: on a tall narrow deck (a phone, the Fold's cover screen) the map's middle is the free space
// above the controls and the map is dimmed under them; on a wide deck (the Fold's inner screen) the map's middle is the space
// between the d-pad and A / B. Nothing is written to the game; the map's marks are kept in window.__deckMap.marks for the tests.
import { HoleArt, T } from "../g3d/hole3d.js";
import { rd16 } from "../golf/memory.js";
import { pinDist } from "../golf/cup.js";
import { PUTTER, feetText, humanTurn } from "./shotpreview.js";
import { COL, PUTT_COL, Placer, softText, softLine, dotted, ribbon, screenMark, hexA, FONT, rrect } from "./aimdraw.js";

// ---- the course from above: a 1024 x 1024 picture of the 512 x 512 px course map (2 picture px a course px) ----
// classes: 0 fairway, 1 tee, 2 first cut, 3 rough, 4 deep rough, 5 sand, 6 water, 7 green, 8 out of bounds
const CLASS = new Uint8Array(256).fill(3);
CLASS[T.FAIRWAY] = 0; CLASS[T.TEE] = 1; CLASS[T.SEMI] = 2; CLASS[T.ROUGH] = 3; CLASS[0x0C] = 4; CLASS[T.BUNKER] = 5; CLASS[T.BUNKER2] = 5;
CLASS[T.WATER] = 6; CLASS[T.GREEN] = 7; CLASS[T.OB] = 8;
const RGB = [[112, 198, 84], [126, 208, 96], [94, 176, 72], [72, 150, 60], [58, 128, 52], [238, 222, 170], [62, 146, 220], [150, 230, 112], [50, 98, 56], [214, 180, 124]];
// (class 9: the Dune course's desert: its out of bounds, rough and sandy waste $0D are brown sand there, as the game draws them)
const N = 1024;
function hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
// a class's membership (1 in its cells) blurred twice by a 5-cell box: the tiles' steps become rounded shapes
function field(cls, c) {
  const M = 256, a = new Float32Array(M * M), b = new Float32Array(M * M);
  for (let i = 0; i < a.length; i++) a[i] = cls[i] === c ? 1 : 0;
  const pass = (src, dst, dx, dy) => {
    for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
      let s = 0; for (let k = -2; k <= 2; k++) { const X = Math.max(0, Math.min(M - 1, x + k * dx)), Y = Math.max(0, Math.min(M - 1, y + k * dy)); s += src[Y * M + X]; }
      dst[y * M + x] = s / 5;
    }
  };
  pass(a, b, 1, 0); pass(b, a, 0, 1); pass(a, b, 1, 0); pass(b, a, 0, 1);
  return a;
}
export function paintCourse(art, desert = false) {
  const cls = new Uint8Array(256 * 256);
  for (let i = 0; i < cls.length; i++) { const t = art.terrain[i]; cls[i] = desert && (t === T.OB || t === T.ROUGH || t === T.BUNKER2) ? 9 : CLASS[t]; }
  const present = [...new Set(cls)], F = [];
  for (const c of present) F[c] = field(cls, c);
  const cv = document.createElement("canvas"); cv.width = cv.height = N;
  const g = cv.getContext("2d"), img = g.createImageData(N, N), d = img.data;
  const cl = v => Math.max(0, Math.min(255, v));
  for (let y = 0; y < N; y++) {
    const fy = (y + 0.5) / 4 - 0.5, y0 = Math.floor(fy), ty = fy - y0, ya = cl(y0) * 256, yb = cl(y0 + 1) * 256;
    for (let x = 0; x < N; x++) {
      const fx = (x + 0.5) / 4 - 0.5, x0 = Math.floor(fx), tx = fx - x0, xa = cl(x0), xb = cl(x0 + 1);
      // the class whose blurred field is highest here (bilinear between the cells): smooth, rounded edges
      let best = 0, bw = -1, second = 0;
      for (const c of present) {
        const f = F[c], v = (f[ya + xa] * (1 - tx) + f[ya + xb] * tx) * (1 - ty) + (f[yb + xa] * (1 - tx) + f[yb + xb] * tx) * ty;
        if (v > bw) { second = Math.max(second, bw); bw = v; best = c; } else if (v > second) second = v;
      }
      const [r, gg, b] = RGB[best];
      let k = 1 + (hash(x >> 1, y >> 1) - 0.5) * 0.06;                       // a fine grain
      if (best <= 1) k *= ((x + (y >> 1)) / 28 | 0) & 1 ? 1.05 : 0.96;        // mowing stripes
      if (best === 7) k *= ((x - y) / 10 | 0) & 1 ? 1.03 : 0.98;
      const edge = bw - second < 0.14 ? 1 - (bw - second) / 0.14 : 0;         // an outline where the class changes
      if (best === 6) k *= 0.9 + 0.16 * Math.min(1, (1 - bw) * 2);           // water: lighter at its banks
      if (best === 5) k *= 1.03 - edge * 0.14;
      else k *= 1 - edge * 0.15;
      const q = (y * N + x) * 4; d[q] = Math.min(255, r * k); d[q + 1] = Math.min(255, gg * k); d[q + 2] = Math.min(255, b * k); d[q + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // trees: a round canopy over each tree tile (8 course px), a shadow beside it
  const trees = [];
  for (let ty = 0; ty < 64; ty++) for (let tx = 0; tx < 64; tx++) if (art.treeTile[ty * 64 + tx])
    trees.push([(tx * 8 + 4 + (hash(tx, ty) - 0.5) * 3) * 2, (ty * 8 + 4 + (hash(ty, tx) - 0.5) * 3) * 2, 9 + hash(tx + 7, ty) * 3]);
  g.fillStyle = "rgba(0,0,0,0.28)"; for (const [x, y, r] of trees) { g.beginPath(); g.arc(x + 3, y + 4, r, 0, 7); g.fill(); }
  for (const [x, y, r] of trees) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = "#2f6b33"; g.fill(); g.beginPath(); g.arc(x - r * 0.25, y - r * 0.3, r * 0.6, 0, 7); g.fillStyle = "#43894a"; g.fill(); }
  return cv;
}

const ease = (a, b, k) => a + (b - a) * k;
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const ROUND = new Set(["round", "hole", "flyover", "windintro", "shotsetup", "pick", "aimmenu", "address", "aftershot"]);

export function attachDeckMap(deck) {
  const cv = document.createElement("canvas"); cv.id = "deckmap"; cv.setAttribute("aria-hidden", "true");
  deck.insertBefore(cv, deck.firstChild.nextSibling);
  const g = cv.getContext("2d");
  const arts = new Map();                              // hole id -> { art, pic }
  const view = { cx: 0, cz: 0, phi: 0, s: 1, set: false, t: 0 };
  const track = { from: null, pts: [], aimView: null };
  let lastSig = "", focus = null, focusAt = 0, shownHole = -1;
  const api = { marks: null, active: false, draws: 0, view };
  window.__deckMap = api;

  function artFor(hid, desert) {
    const key = hid + (desert ? "d" : "");
    let a = arts.get(key);
    if (!a) {
      const art = new HoleArt(hid); a = { art, pic: paintCourse(art, desert), desert };
      if (arts.size > 2) arts.delete(arts.keys().next().value);
      arts.set(key, a);
    }
    return a;
  }
  // the free space for the map's middle (CSS px in the deck), from where the controls are
  function freeArea() {
    const dr = deck.getBoundingClientRect(), W = dr.width, H = dr.height;
    const rel = sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? [r.left - dr.left, r.top - dr.top, r.right - dr.left, r.bottom - dr.top] : null; };
    const stick = document.body.classList.contains("stick"), pad = rel(stick ? ".stick-base" : "#pad .dpad"), ab = rel("#pad .ab"), mid = rel("#pad .mid"), lab = rel("#decklabel"), gear = rel("#hdgear");
    const top = (lab ? lab[3] : 0) + 6, ctl = [pad, ab].filter(Boolean), avoid = [...ctl, mid, gear, lab].filter(Boolean);
    if (pad && ab && ab[0] - pad[2] > W * 0.4) return { l: pad[2] + 10, t: 8, r: ab[0] - 10, b: H - 8, W, H, ctl, avoid, wide: true };   // (the label and Select / Start beside)
    const ct = ctl.length ? Math.min(...ctl.map(c => c[1])) - 8 : H - 8;
    if (ct - top > H * 0.34) return { l: 10, t: top, r: W - 10, b: ct, W, H, ctl, avoid, wide: false };
    return { l: 10, t: top, r: W - 10, b: H - 10, W, H, ctl, avoid, wide: false };
  }

  function frame(game, on) {
    const w = game && game.w;
    const golf = on && w && ROUND.has(game.mark) && w.wram[6][0x320] !== 0 && !game.error;
    api.active = !!golf;
    cv.style.display = golf ? "block" : "none";
    if (!golf) { api.marks = null; return false; }
    const r6 = w.wram[6], w0 = w.wram[0], hid = r6[0x320];
    // (the course $C836: 3 the Dune Club, as the 3D view's theme: its out of bounds is desert)
    let A; try { A = artFor(hid, w0[0x836] === 3); } catch (e) { console.warn("deck map", e); api.active = false; cv.style.display = "none"; return false; }
    const dpr = Math.min(2, devicePixelRatio || 1), cw = deck.clientWidth, ch = deck.clientHeight;
    if (!cw || !ch) return true;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); lastSig = ""; focus = null; }
    const now = performance.now();
    if (!focus || now - focusAt > 500) { focus = freeArea(); focusAt = now; }
    const u = dpr;                                     // (1 CSS px)
    const ball = [(rd16(r6, 0x401) + r6[0x400] / 256) / 32, (rd16(r6, 0x404) + r6[0x403] / 256) / 32], hgt = Math.max(0, (rd16(r6, 0x407) << 16 >> 16) / 32);
    const cup = [rd16(r6, 0x43D) / 32, rd16(r6, 0x43F) / 32];
    const putter = r6[0x329] === PUTTER, aimA = rd16(r6, 0x418) / 65536 * Math.PI * 2;
    const aiming = (game.mark === "aimmenu" || game.mark === "address") && !r6[0x44E] && !r6[0x415];
    const ap = window.__aimPower, human = humanTurn(w);
    const res = aiming && human && ap ? (putter ? null : ap.shotNow(w)) : null;
    const putts = aiming && human && ap && putter ? ap.puttLines(w) : null;
    // the flight: the ball's track since it left its spot
    if (shownHole !== hid) { track.from = null; track.pts = []; track.res = track.putts = track.aimView = null; }
    if (aiming) { track.from = ball.slice(); track.pts = []; track.res = res; track.putts = putts; }
    else if (track.from && (ball[0] !== track.from[0] || ball[1] !== track.from[1] || track.pts.length)) {
      const l = track.pts[track.pts.length - 1]; if (!l || l[0] !== ball[0] || l[1] !== ball[1]) track.pts.push([ball[0], ball[1], hgt]);
    }
    // what the view frames: the ball and the landing area (the pin when it is near); putting: the ball, the cup and the stops
    const poi = [ball];
    let pad = 22, minSpan = 60;
    if (putts) { putts.forEach(r => poi.push([r.end[0], r.end[2]])); poi.push(cup); pad = 3; minSpan = 14; }
    else if (res && res.path.length > 1) {
      const L = res.path[res.land], E = res.end; poi.push([L[0], L[2]], [E[0], E[2]]);
      const pd = Math.hypot(cup[0] - ball[0], cup[1] - ball[1]);
      if (pd < Math.hypot(E[0] - ball[0], E[2] - ball[1]) + 70) poi.push(cup);
      if (res.putt) { pad = 4; minSpan = 16; poi.push(cup); }
    } else if (aiming) {
      const t = [rd16(r6, 0x426) / 32, rd16(r6, 0x428) / 32]; if (rd16(r6, 0x428)) poi.push(t); else poi.push(cup);
    }
    if (track.aimView && !aiming) poi.push(...track.aimView);
    if (aiming) track.aimView = poi.slice();
    for (const p of track.pts.slice(-1)) poi.push(p);
    // the target view: turned so the aim points up the deck
    const phi = aiming ? -Math.PI / 2 - aimA : view.set ? view.phi : -Math.PI / 2 - aimA;
    const c = Math.cos(phi), s = Math.sin(phi);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const [x, z] of poi) { const rx = x * c - z * s, ry = x * s + z * c; x0 = Math.min(x0, rx); x1 = Math.max(x1, rx); y0 = Math.min(y0, ry); y1 = Math.max(y1, ry); }
    const fw = (focus.r - focus.l) * dpr, fh = (focus.b - focus.t) * dpr;
    let sc = Math.min(fw / Math.max(x1 - x0 + pad * 2, minSpan * Math.min(1, fw / fh)), fh / Math.max(y1 - y0 + pad * 2, minSpan * Math.min(1, fh / fw)));
    sc = Math.max(0.35 * dpr, Math.min(sc, (putts || (res && res.putt) ? 22 : 9) * dpr));
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, tcx = mx * c + my * s, tcz = -mx * s + my * c;
    const dt = Math.min(0.1, Math.max(0.001, (now - (view.t || now)) / 1000)); view.t = now;
    const snap = !view.set || shownHole !== hid;
    const k = snap ? 1 : 1 - Math.exp(-dt / 0.2);
    view.cx = ease(view.cx, tcx, k); view.cz = ease(view.cz, tcz, k); view.s = Math.exp(ease(Math.log(view.s), Math.log(sc), k));
    view.phi = view.phi + angDiff(view.phi, phi) * k; view.set = true; shownHole = hid;
    // (settled: exactly at the target, so a held game is not drawn again and again)
    if (Math.abs(view.cx - tcx) + Math.abs(view.cz - tcz) < 0.3 / sc * dpr && Math.abs(Math.log(view.s / sc)) < 0.003 && Math.abs(angDiff(view.phi, phi)) < 0.002) { view.cx = tcx; view.cz = tcz; view.s = sc; view.phi = phi; }
    api.settled = view.cx === tcx && view.cz === tcz && view.s === sc && view.phi === phi;
    // drawn again only when something changed (the view still moving, the ball, the preview, the size)
    const sig = [hid, Math.round(view.cx * 50), Math.round(view.cz * 50), Math.round(view.s * 1000), Math.round(view.phi * 1000), ball[0], ball[1], hgt, cv.width, cv.height,
      res ? res.len + ":" + res.end.join() + (res.stale ? "s" : "") : "-", putts ? putts.map(r => r.len).join() + (putts[0].stale ? "s" : "") : "-", aimA, r6[0x426], r6[0x428], game.mark, track.pts.length, w0[0x815], w0[0x816]].join(",");
    if (sig === lastSig) return true;
    lastSig = sig; api.sig = sig; api.draws++; const t0 = performance.now();
    // (the flight and after it: the preview the swing was aimed with, faded, under the ball's own track)
    const after = !aiming && track.from && track.pts.length;
    const fade = r => r && { ...r, stale: true };
    draw({ w, r6, w0, A, ball, hgt, cup, putter, aimA, aiming, res: res || (after ? fade(track.res) : null), putts: putts || (after && track.putts ? track.putts.map(fade) : null),
      human, dpr, u, focus, from: aiming || !track.from ? ball : track.from });
    api.ms = performance.now() - t0;
    return true;
  }

  function draw(o) {
    const { w, r6, w0, A, ball, cup, aimA, aiming, res, putts, dpr, u, focus: F } = o;
    const W = cv.width, H = cv.height, c = Math.cos(view.phi), s = Math.sin(view.phi), ox = (F.l + F.r) / 2 * dpr, oy = (F.t + F.b) / 2 * dpr;
    const S = (x, z) => { const dx = x - view.cx, dz = z - view.cz; return [ox + view.s * (dx * c - dz * s), oy + view.s * (dx * s + dz * c)]; };
    const Sg = (x, z) => S(x, z);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = A.desert ? "rgb(214,180,124)" : "rgb(50,98,56)"; g.fillRect(0, 0, W, H);   // (out of bounds, as the map's own)
    // the course
    g.save(); g.translate(ox, oy); g.rotate(view.phi); g.scale(view.s, view.s); g.translate(-view.cx, -view.cz);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = view.s < dpr ? "high" : "low";   // (enlarged: plain bilinear, cheap)
    g.drawImage(A.pic, 0, 0, 512, 512);
    g.restore();
    const marks = { hole: r6[0x320], ball: ball.slice() };
    g.lineCap = "round"; g.lineJoin = "round";
    // the green's slope (putting): a chevron per green tile along its push, coloured by strength
    if (putts || (res && res.putt) || o.putter) {
      const gs = A.art.greenSlopes(), gx = r6[0x441] * 8, gz = r6[0x442] * 8, cell = 2 * view.s;
      if (cell > 7 * u) for (let ty = 0; ty < 64; ty++) for (let tx = 0; tx < 64; tx++) {
        const q = (ty * 64 + tx) * 4; if (!gs[q + 3]) continue;
        const cx = gx + tx * 2 + 1, cz = gz + ty * 2 + 1, p = S(cx, cz); if (p[0] < -20 || p[1] < -20 || p[0] > W + 20 || p[1] > H + 20) continue;
        const st = gs[q + 2] / 85; if (!st) { g.fillStyle = "rgba(255,255,255,0.25)"; g.fillRect(p[0] - u, p[1] - u, 2 * u, 2 * u); continue; }
        const dx = (gs[q] - 127.5) / 127.5, dz = (gs[q + 1] - 127.5) / 127.5, l = 0.38 + 0.12 * st;
        const tip = S(cx + dx * l, cz + dz * l), tail = S(cx - dx * l, cz - dz * l), n = [-dz, dx], wv = 0.3;
        const bl = S(cx + dx * (l - wv) + n[0] * wv, cz + dz * (l - wv) + n[1] * wv), br = S(cx + dx * (l - wv) - n[0] * wv, cz + dz * (l - wv) - n[1] * wv);
        const col = ["", "255,240,140", "255,170,60", "250,80,60"][Math.round(st)];
        g.beginPath(); g.moveTo(tail[0], tail[1]); g.lineTo(tip[0], tip[1]); g.moveTo(bl[0], bl[1]); g.lineTo(tip[0], tip[1]); g.lineTo(br[0], br[1]);
        g.strokeStyle = "rgba(0,0,0,0.35)"; g.lineWidth = 2.6 * u; g.stroke(); g.strokeStyle = `rgba(${col},0.95)`; g.lineWidth = 1.3 * u; g.stroke();
      }
    }
    const aimV = [Math.cos(aimA), Math.sin(aimA)];
    const ringNums = [];
    // rings every 50 y round the ball (not on the green)
    if (!putts && !(res && res.putt) && !o.putter) {
      const vis = Math.hypot(W, H) / view.s;
      const o0 = o.from;
      for (let r = 50; r <= 350 && r < vis + Math.hypot(o0[0] - view.cx, o0[1] - view.cz); r += 50) {
        const p = S(o0[0], o0[1]); g.beginPath(); g.arc(p[0], p[1], r * view.s, 0, 7);
        g.setLineDash([4 * u, 4 * u]); g.strokeStyle = `rgba(255,255,255,${(0.34 - r / 1400).toFixed(2)})`; g.lineWidth = 1 * u; g.stroke(); g.setLineDash([]);
        if (r % 100 === 0) { const a = aimA + 0.45, q = S(o0[0] + Math.cos(a) * r, o0[1] + Math.sin(a) * r); ringNums.push([String(r), q[0], q[1]]); }
      }
    }
    // the aim line to the target
    const t = [rd16(r6, 0x426) / 32, rd16(r6, 0x428) / 32];
    if (aiming && rd16(r6, 0x428) && !o.putter) {
      const a = S(ball[0], ball[1]), b = S(t[0], t[1]), gr = g.createLinearGradient(a[0], a[1], b[0], b[1]);
      gr.addColorStop(0, "rgba(255,226,90,0.95)"); gr.addColorStop(1, "rgba(255,226,90,0.4)");
      softLine(g, [a, b], gr, 1.4 * u, { dash: [5 * u, 4 * u], under: 0.25 });
      screenMark(g, b[0], b[1], 4 * u, COL.aim, u);
    } else if (aiming && o.putter && !putts) {
      const a = S(ball[0], ball[1]), b = S(ball[0] + aimV[0] * 20, ball[1] + aimV[1] * 20);
      softLine(g, [a, b], "rgba(255,226,90,0.8)", 1.4 * u, { dash: [5 * u, 4 * u], under: 0.25 });
    }
    // the cup and its flag
    const cp = S(cup[0], cup[1]);
    g.beginPath(); g.arc(cp[0], cp[1], Math.max(2.5 * u, 0.15 * view.s), 0, 7); g.fillStyle = "#101010"; g.fill(); g.strokeStyle = "rgba(255,255,255,0.9)"; g.lineWidth = 1.2 * u; g.stroke();
    g.beginPath(); g.moveTo(cp[0], cp[1]); g.lineTo(cp[0], cp[1] - 16 * u); g.strokeStyle = "#f4f4f4"; g.lineWidth = 1.6 * u; g.stroke();
    g.beginPath(); g.moveTo(cp[0], cp[1] - 16 * u); g.lineTo(cp[0] + 10 * u, cp[1] - 12.5 * u); g.lineTo(cp[0], cp[1] - 9 * u); g.closePath(); g.fillStyle = COL.pin; g.fill();
    const dots = [], box = { l: F.l * dpr + 4 * u, t: F.t * dpr + 2 * u, r: F.r * dpr - 4 * u, b: F.b * dpr - 2 * u };
    for (let k = 0; k <= 16; k += 4) dots.push([cp[0], cp[1] - k * u], [cp[0] + 6 * u, cp[1] - 12 * u]);   // (the flag)
    const pl = new Placer(g, box, (F.avoid || []).map(q => [q[0] * dpr - 6 * u, q[1] * dpr - 6 * u, q[2] * dpr + 6 * u, q[3] * dpr + 6 * u]), dots);
    const TS = 14 * u;
    // the preview from above: the flight (wider where higher), the landing reticle, the roll to the rest mark
    if (res && res.path.length > 1) {
      const path = res.path, land = res.land, L = path[land], E = res.end;
      g.globalAlpha = res.stale ? 0.4 : 1;
      if (!res.putt) {
        const pts = []; for (let i = 0; i <= land; i++) { const p = S(path[i][0], path[i][2]); pts.push([p[0], p[1], (1.1 + Math.min(1.8, path[i][1] / 22)) * u]); if (i % 2 === 0) dots.push(p); }
        dotted(g, path.slice(land).map(p => S(p[0], p[2])), 4 * u, 1.1 * u, "#ffffff");
        const lp = S(L[0], L[2]), rr = Math.max(7 * u, 4.6 * view.s);
        g.beginPath(); g.arc(lp[0], lp[1], rr, 0, 7); g.fillStyle = hexA(COL.land, 0.18); g.fill();
        g.strokeStyle = "rgba(0,0,0,0.45)"; g.lineWidth = 3 * u; g.stroke(); g.strokeStyle = COL.land; g.lineWidth = 1.5 * u; g.stroke();
        g.beginPath(); g.arc(lp[0], lp[1], rr * 0.42, 0, 7); g.lineWidth = 1 * u; g.stroke();
        for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; g.beginPath(); g.moveTo(lp[0] + Math.cos(a) * rr * 1.15, lp[1] + Math.sin(a) * rr * 1.15); g.lineTo(lp[0] + Math.cos(a) * rr * 0.68, lp[1] + Math.sin(a) * rr * 0.68); g.lineWidth = 1.4 * u; g.stroke(); }
        ribbon(g, pts, u * 0.9, -1);
        const ep = S(E[0], E[2]); screenMark(g, ep[0], ep[1], 3.6 * u, COL.rest, u);
        dots.push(lp, ep);
        if (!res.stale) pl.add({ main: res.rest + " y", sub: "carry " + res.carry, size: TS, accent: COL.land, icon: "ring" }, lp[0], lp[1], 2);
        marks.land = [L[0], L[2]]; marks.rest = [E[0], E[2]]; marks.carry = res.carry; marks.restY = res.rest; marks.landPx = lp; marks.restPx = ep;
      } else {
        const pts = path.map(p => S(p[0], p[2])); softLine(g, pts, "#ffffff", 1.6 * u, { under: 0.4 });
        const ep = S(E[0], E[2]); screenMark(g, ep[0], ep[1], 3.6 * u, COL.land, u); pts.forEach(p => dots.push(p));
        if (!res.stale) pl.add({ main: res.outcome === 0x80 ? "in" : feetText(res.len) + " ft", sub: "full putt", size: TS, accent: COL.land, icon: "ring" }, ep[0], ep[1], 2);
        marks.rest = [E[0], E[2]]; marks.restPx = ep;
      }
      g.globalAlpha = 1;
    }
    // the putts: the four break lines, their stops and rolls
    if (putts) {
      g.globalAlpha = putts[0].stale ? 0.4 : 1;
      for (let i = putts.length - 1; i >= 0; i--) softLine(g, putts[i].path.map(p => S(p[0], p[2])), PUTT_COL[i], (i ? 1.3 : 1.9) * u, { dash: i ? [4 * u, 3 * u] : null, under: 0.45 });
      putts.forEach((r, i) => { const p = S(r.end[0], r.end[2]); screenMark(g, p[0], p[1], (i ? 3 : 3.8) * u, PUTT_COL[i], u); dots.push(p); r.path.forEach((q, k) => { if (k % 3 === 0) dots.push(S(q[0], q[2])); }); });
      g.globalAlpha = 1;
      if (!putts[0].stale) putts.forEach((r, i) => { const p = S(r.end[0], r.end[2]); pl.add({ main: r.outcome === 0x80 ? "in" : feetText(r.len) + " ft", sub: Math.round(r.power / 0.6) + "%", size: TS * 0.92, accent: PUTT_COL[i], icon: "ring" }, p[0], p[1], 4 - i); });
      marks.putts = putts.map(r => ({ end: [r.end[0], r.end[2]], len: r.len, outcome: r.outcome }));
    }
    // the flight: the ball's track since the swing
    if (track.pts.length) {
      const pts = [S(track.from[0], track.from[1]), ...track.pts.map(p => S(p[0], p[1]))];
      softLine(g, pts, "rgba(255,240,150,0.95)", 1.8 * u, { under: 0.45 });
    }
    // the ball (bigger while it flies: its height)
    const bp = S(ball[0], ball[1]), br = (3.4 + Math.min(3, o.hgt / 12)) * u;
    if (o.hgt > 0) { g.beginPath(); g.arc(bp[0] + o.hgt * 0.04 * view.s, bp[1] + o.hgt * 0.04 * view.s, br * 0.8, 0, 7); g.fillStyle = "rgba(0,0,0,0.3)"; g.fill(); }
    g.beginPath(); g.arc(bp[0], bp[1], br + 1.2 * u, 0, 7); g.fillStyle = "rgba(0,0,0,0.55)"; g.fill();
    g.beginPath(); g.arc(bp[0], bp[1], br, 0, 7); g.fillStyle = "#ffffff"; g.fill();
    dots.push(bp);
    // the pin's distance
    const hl = pinDist(r6.subarray(0x400, 0x500)), feet = o.putter && ((hl + 0xF7CB) & 0x8000);
    if (aiming) pl.add({ main: feet ? feetText(hl) + " ft" : (hl >> 5) + " y", sub: feet ? "cup" : "pin", size: TS, accent: COL.pin, icon: "flag" }, cp[0], cp[1] - 12 * u, 3);
    // dim the map under the controls (a narrow deck: they sit on it), softly
    for (const q of F.ctl || []) {
      const cx = (q[0] + q[2]) / 2 * dpr, cy = (q[1] + q[3]) / 2 * dpr, r = Math.max(q[2] - q[0], q[3] - q[1]) * 0.75 * dpr;
      const rg = g.createRadialGradient(cx, cy, r * 0.3, cx, cy, r); rg.addColorStop(0, "rgba(8,16,10,0.5)"); rg.addColorStop(1, "rgba(8,16,10,0)");
      g.fillStyle = rg; g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    }
    pl.avoid.push([F.l * dpr, F.t * dpr, F.l * dpr + 104 * u, F.t * dpr + 46 * u]);   // (the wind badge)
    pl.draw();
    // (the rings' numbers last, where no tag sits)
    for (const [t, x, y] of ringNums) if (!pl.placed.some(q => x > q[0] - 12 * u && x < q[2] + 12 * u && y > q[1] - 6 * u && y < q[3] + 6 * u)) softText(g, t, x, y, 10 * u, 0.8);
    // the wind: a badge at the free area's top left, its arrow turned with the map
    const mph = w0[0x815] & 0x1F, wa = w0[0x816] / 256 * Math.PI * 2 + view.phi, bx = F.l * dpr + 26 * u, by = F.t * dpr + 24 * u, R = 18 * u;
    g.beginPath(); g.arc(bx, by, R, 0, 7); g.fillStyle = "rgba(10,16,26,0.72)"; g.fill(); g.strokeStyle = "rgba(255,255,255,0.22)"; g.lineWidth = 1 * u; g.stroke();
    if (mph) {
      const dx = Math.cos(wa), dy = Math.sin(wa), l = R * 0.62;
      g.beginPath(); g.moveTo(bx - dx * l, by - dy * l); g.lineTo(bx + dx * l * 0.55, by + dy * l * 0.55); g.strokeStyle = COL.wind; g.lineWidth = 2.6 * u; g.stroke();
      g.beginPath(); g.moveTo(bx + dx * l, by + dy * l); g.lineTo(bx + dx * l * 0.25 - dy * l * 0.55, by + dy * l * 0.25 + dx * l * 0.55); g.lineTo(bx + dx * l * 0.25 + dy * l * 0.55, by + dy * l * 0.25 - dx * l * 0.55); g.closePath(); g.fillStyle = COL.wind; g.fill();
    }
    g.font = `bold ${10 * u}px ${FONT}`; g.textAlign = "left"; g.textBaseline = "middle";
    const wt = mph ? mph + " mph" : "calm"; g.fillStyle = "rgba(10,16,26,0.72)"; const tw = g.measureText(wt).width;
    rrect(g, bx + R + 3 * u, by - 8 * u, tw + 10 * u, 16 * u, 8 * u); g.fill(); g.fillStyle = "#fff"; g.fillText(wt, bx + R + 8 * u, by + 0.5 * u);
    marks.wind = [mph, w0[0x816]];
    api.marks = marks;
  }
  // its own animation frames: the pan and zoom go on (and the live ball follows) while the game is held or between its frames;
  // a frame that changed nothing draws nothing
  let cur = null, on = false;
  const loop = () => {
    requestAnimationFrame(loop);
    if (!cur) return;
    try { if (!frame(cur, on)) cur = null; } catch (e) { console.warn("deck map", e); cur = null; api.active = false; cv.style.display = "none"; }
  };
  requestAnimationFrame(loop);
  return {
    canvas: cv,
    // once per drawn frame of the game's (portrait.js): returns whether the map shows
    frame(game, show) { cur = game; on = show; if (!show || !game) { frame(game, false); } return api.active; },
    resize() { lastSig = ""; focus = null; },
  };
}
