// THE AIM MARKS' LOOK (render only): the drawing pieces the aim helpers (aimpower.js, over the game's picture) and the deck's shot
// map (deckmap.js, below it in the portrait layout) share, so both speak one visual language:
//   tags     one compact label style for every number: a dark glass pill with a coloured accent (a dot, a ring, a flag, or an arrow
//            when its point is off the picture), the number in bold and a small caption after it ("284 y  carry 280");
//   Placer   puts the tags where they overlap nothing: each other, the HUD's corners, the golfer, the flight's line (it tries spots
//            round the point, nearest first, and draws a thin leader back to the point when it had to move far);
//   ribbon   the flight as a tapered tube: thick near, thin far, a dark soft edge so it reads on sky, sand, grass and water, a white
//            core, and a light pulse travelling along it (its phase from the game's frame count: no clock of its own);
//   rings    rings, reticles and rest marks lying on the ground through any projection (the 3D view's matrix: perspective-correct).
// Nothing here knows the game; it only draws what it is given.
export const FONT = '"DejaVu Sans", system-ui, sans-serif';
export const COL = { land: "#72e8ff", aim: "#ffd84a", pin: "#ff5d63", rest: "#ffffff", ring: "255,255,255", wind: "#bfe9ff" };
export const PUTT_COL = ["#ffffff", "#ffd84a", "#ffa040", "#ff6a5a"];

export function rrect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// ---- tags ----
const subK = 0.8;
export function tagSize(g, t) {
  const s = t.size;
  g.font = `bold ${s}px ${FONT}`; const mw = g.measureText(t.main).width;
  let sw = 0; if (t.sub) { g.font = `${Math.round(s * subK * 10) / 10}px ${FONT}`; sw = g.measureText(t.sub).width + s * 0.38; }
  const icon = t.icon === "none" ? 0 : s * 0.95;
  return [mw + sw + icon + s * 0.95, s * 1.42];
}
function icon(g, kind, x, y, s, col, dir) {
  g.save(); g.lineWidth = Math.max(1, s * 0.13); g.strokeStyle = col; g.fillStyle = col;
  if (kind === "arrow") {                          // pointing to where the point is (off the picture)
    const [dx, dy] = dir, l = s * 0.34;
    g.beginPath(); g.moveTo(x + dx * l, y + dy * l); g.lineTo(x - dx * l * 0.6 - dy * l * 0.8, y - dy * l * 0.6 + dx * l * 0.8); g.lineTo(x - dx * l * 0.6 + dy * l * 0.8, y - dy * l * 0.6 - dx * l * 0.8); g.closePath(); g.fill();
  } else if (kind === "flag") {
    g.beginPath(); g.moveTo(x - s * 0.18, y + s * 0.34); g.lineTo(x - s * 0.18, y - s * 0.36); g.stroke();
    g.beginPath(); g.moveTo(x - s * 0.18, y - s * 0.36); g.lineTo(x + s * 0.3, y - s * 0.2); g.lineTo(x - s * 0.18, y - s * 0.04); g.closePath(); g.fill();
  } else if (kind === "ring") {
    g.beginPath(); g.arc(x, y, s * 0.27, 0, 7); g.stroke(); g.beginPath(); g.arc(x, y, s * 0.08, 0, 7); g.fill();
  } else { g.beginPath(); g.arc(x, y, s * 0.22, 0, 7); g.fill(); }
  g.restore();
}
// a tag centred at x, y: { main, sub, size, accent, icon: dot | ring | flag | none, arrow: [dx, dy] }
export function drawTag(g, t, x, y) {
  const s = t.size, [w, h] = tagSize(g, t), x0 = x - w / 2;
  g.fillStyle = "rgba(10,16,26,0.80)"; rrect(g, x0, y - h / 2, w, h, h / 2); g.fill();
  g.strokeStyle = "rgba(255,255,255,0.20)"; g.lineWidth = Math.max(1, s * 0.07); g.stroke();
  let cx = x0 + s * 0.48;
  if (t.icon !== "none") { icon(g, t.arrow ? "arrow" : t.icon || "dot", cx + s * 0.22, y, s, t.accent || "#fff", t.arrow); cx += s * 0.95; }
  g.textAlign = "left"; g.textBaseline = "middle";
  g.font = `bold ${s}px ${FONT}`; g.fillStyle = "#fff"; g.fillText(t.main, cx, y + s * 0.05);
  if (t.sub) {
    const mw = g.measureText(t.main).width;
    g.font = `${Math.round(s * subK * 10) / 10}px ${FONT}`; g.fillStyle = "rgba(230,238,246,0.86)"; g.fillText(t.sub, cx + mw + s * 0.38, y + s * 0.09);
  }
}
// small text on the ground (the distance rings' numbers): no pill, a soft dark edge
export function softText(g, text, x, y, size, alpha = 0.9) {
  g.font = `bold ${size}px ${FONT}`; g.textAlign = "center"; g.textBaseline = "middle"; g.lineJoin = "round";
  g.lineWidth = size * 0.3; g.strokeStyle = `rgba(0,0,0,${0.55 * alpha})`; g.strokeText(text, x, y);
  g.fillStyle = `rgba(255,255,255,${alpha})`; g.fillText(text, x, y);
}

// ---- the tags' places ----
export class Placer {
  // box: { l, t, r, b } where tags may go; avoid: [[x0, y0, x1, y1]] the HUD's corners, the golfer; dots: [[x, y]] the flight's line
  constructor(g, box, avoid = [], dots = []) { this.g = g; this.box = box; this.avoid = avoid; this.dots = dots; this.list = []; this.placed = []; }
  add(t, x, y, prio = 0) { if (x == null || y == null || !isFinite(x) || !isFinite(y)) return; this.list.push({ ...t, x, y, prio }); }
  draw() {
    const g = this.g, b = this.box;
    this.list.sort((a, c) => c.prio - a.prio);
    for (const t of this.list) {
      let ax = t.x, ay = t.y, arrow = null;
      const off = ax < b.l || ax > b.r || ay < b.t || ay > b.b;
      if (off) { const cx = (b.l + b.r) / 2, cy = (b.t + b.b) / 2, d = Math.hypot(ax - cx, ay - cy) || 1; arrow = [(ax - cx) / d, (ay - cy) / d]; }
      const tag = { ...t, arrow }, [w, h] = tagSize(g, tag), gap = t.size * 0.55;
      ax = Math.max(b.l, Math.min(b.r, ax)); ay = Math.max(b.t, Math.min(b.b, ay));
      const tries = off ? [[0, 0]] : [];
      if (off) for (let k = 1; k <= 6; k++) tries.push([k * w * 0.6, 0], [-k * w * 0.6, 0], [0, k * h * 1.1], [0, -k * h * 1.1]);   // (along the edge)
      for (const k of [1, 1.9, 3]) for (const [ox, oy] of [[w / 2 + gap, 0], [-(w / 2 + gap), 0], [0, -(h / 2 + gap)], [0, h / 2 + gap], [w / 2 + gap, -(h / 2 + gap)], [-(w / 2 + gap), -(h / 2 + gap)], [w / 2 + gap, h / 2 + gap], [-(w / 2 + gap), h / 2 + gap]])
        tries.push([ox * (k === 1 ? 1 : 1 + (k - 1) * 0.6), oy * k]);
      let best = null;
      for (const [ox, oy] of tries) {
        const x = Math.max(b.l + w / 2, Math.min(b.r - w / 2, ax + ox)), y = Math.max(b.t + h / 2, Math.min(b.b - h / 2, ay + oy));
        const r = [x - w / 2 - 1, y - h / 2 - 1, x + w / 2 + 1, y + h / 2 + 1];
        const hit = (q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1];
        let bad = 0; for (const q of this.placed) if (hit(q)) bad += 1000; for (const q of this.avoid) if (hit(q)) bad += 400;
        let dots = 0; for (const d of this.dots) if (d[0] > r[0] && d[0] < r[2] && d[1] > r[1] && d[1] < r[3]) dots++;
        const score = bad + dots * 12 + Math.hypot(x - ax, y - ay) / t.size;
        if (!best || score < best.score) best = { x, y, r, score };
        if (score < 4) break;
      }
      this.placed.push(best.r);
      const far = Math.hypot(best.x - ax, best.y - ay) > Math.max(w, h) * 0.75 + gap;
      if (far && !off) {                             // a leader back to the point
        const ex = Math.max(best.r[0], Math.min(best.r[2], ax)), ey = Math.max(best.r[1], Math.min(best.r[3], ay));
        g.strokeStyle = "rgba(0,0,0,0.45)"; g.lineWidth = t.size * 0.24; g.beginPath(); g.moveTo(ax, ay); g.lineTo(ex, ey); g.stroke();
        g.strokeStyle = "rgba(255,255,255,0.8)"; g.lineWidth = t.size * 0.1; g.stroke();
      }
      drawTag(g, tag, best.x, best.y);
    }
  }
}

// ---- lines ----
// a smooth polyline through screen points (null breaks it): quadratic curves through the midpoints
export function smooth(g, pts) {
  g.beginPath(); let run = [];
  const flush = () => {
    if (run.length > 1) {
      g.moveTo(run[0][0], run[0][1]);
      if (run.length === 2) g.lineTo(run[1][0], run[1][1]);
      for (let i = 1; i < run.length - 1; i++) { const p = run[i], q = run[i + 1]; g.quadraticCurveTo(p[0], p[1], i === run.length - 2 ? q[0] : (p[0] + q[0]) / 2, i === run.length - 2 ? q[1] : (p[1] + q[1]) / 2); }
    }
    run = [];
  };
  for (const p of pts) { if (!p) { flush(); continue; } const l = run[run.length - 1]; if (!l || Math.abs(l[0] - p[0]) + Math.abs(l[1] - p[1]) > 0.4) run.push(p); }
  flush();
}
// a soft line: a wide faint dark stroke under a coloured one
export function softLine(g, pts, col, width, { dash = null, under = 0.4, alpha = 1 } = {}) {
  g.lineCap = "round"; g.lineJoin = "round"; smooth(g, pts);
  g.setLineDash([]); g.strokeStyle = `rgba(0,0,0,${under * alpha})`; g.lineWidth = width * 2.1; g.stroke();
  g.setLineDash(dash || []); g.globalAlpha *= alpha; g.strokeStyle = col; g.lineWidth = width; g.stroke(); g.globalAlpha /= alpha; g.setLineDash([]);
}
// dots spaced along a screen polyline
export function dotted(g, pts, step, rad, col) {
  const q = pts.filter(Boolean); if (q.length < 2) return;
  let left = 0;
  for (let i = 1; i < q.length; i++) {
    const [x0, y0] = q[i - 1], [x1, y1] = q[i], d = Math.hypot(x1 - x0, y1 - y0);
    for (let s = left; s < d; s += step) {
      const x = x0 + (x1 - x0) * s / d, y = y0 + (y1 - y0) * s / d;
      g.beginPath(); g.arc(x, y, rad * 1.7, 0, 7); g.fillStyle = "rgba(0,0,0,0.35)"; g.fill();
      g.beginPath(); g.arc(x, y, rad, 0, 7); g.fillStyle = col; g.fill();
    }
    left = (left - d) % step; if (left < 0) left += step;
  }
}

// ---- the flight as a tapered tube ----
// pts: [[x, y, halfWidth]] screen points along the flight (null where it can't be projected); phase 0..1: the travelling light
// nearFade: the first part (from the ball) fainter, so a flight seen from behind (rising straight at the camera) does not read as a
// solid bar and its far part (the apex, the fall) leads
export function ribbon(g, pts, u, phase = -1, tint = COL.land, nearFade = false) {
  const runs = []; let run = [];
  for (const p of pts) { if (!p) { if (run.length > 1) runs.push(run); run = []; continue; } const l = run[run.length - 1]; if (!l || Math.hypot(l[0] - p[0], l[1] - p[1]) > 0.6) run.push(p); }
  if (run.length > 1) runs.push(run);
  const edge = (r, grow, k = 1) => {
    const L = [], R = [];
    for (let i = 0; i < r.length; i++) {
      const a = r[Math.max(0, i - 1)], c = r[Math.min(r.length - 1, i + 1)], dx = c[0] - a[0], dy = c[1] - a[1], d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d, hw = r[i][2] * k + grow;
      L.push([r[i][0] + nx * hw, r[i][1] + ny * hw]); R.push([r[i][0] - nx * hw, r[i][1] - ny * hw]);
    }
    g.beginPath(); g.moveTo(L[0][0], L[0][1]); for (const p of L) g.lineTo(p[0], p[1]);
    const e = r[r.length - 1]; g.arc(e[0], e[1], Math.max(0.1, e[2] * k + grow), Math.atan2(L[L.length - 1][1] - e[1], L[L.length - 1][0] - e[0]), Math.atan2(R[R.length - 1][1] - e[1], R[R.length - 1][0] - e[0]));
    for (let i = R.length - 1; i >= 0; i--) g.lineTo(R[i][0], R[i][1]);
    const s = r[0]; g.arc(s[0], s[1], Math.max(0.1, s[2] * k + grow), Math.atan2(R[0][1] - s[1], R[0][0] - s[0]), Math.atan2(L[0][1] - s[1], L[0][0] - s[0]));
    g.closePath();
  };
  for (const r of runs) {
    // the soft dark edge (it reads on the sky and on light sand), then the tinted body, then the white core
    const a = r[0], z = r[r.length - 1], grad = (c0, c1, k0) => { const q = g.createLinearGradient(a[0], a[1], z[0], z[1]); q.addColorStop(0, c0(nearFade ? k0 : 1)); if (nearFade) q.addColorStop(0.3, c0(1)); q.addColorStop(1, c1); return q; };
    g.save(); g.shadowColor = "rgba(0,12,30,0.55)"; g.shadowBlur = 2.5 * u; edge(r, 0.7 * u); g.fillStyle = grad(k => `rgba(10,25,45,${0.42 * k})`, "rgba(10,25,45,0.42)", 0.2); g.fill(); g.restore();
    edge(r, 0); g.fillStyle = grad(k => `rgba(200,245,255,${0.95 * k})`, tint, 0.3); g.fill();
    edge(r, 0, 0.42); g.fillStyle = grad(k => `rgba(255,255,255,${0.95 * k})`, "rgba(255,255,255,0.95)", 0.3); g.fill();
  }
  // the light travelling along it
  if (phase >= 0 && runs.length) {
    const all = runs.flat(), len = [0];
    for (let i = 1; i < all.length; i++) len.push(len[i - 1] + Math.hypot(all[i][0] - all[i - 1][0], all[i][1] - all[i - 1][1]));
    const L = len[len.length - 1], at = phase * L;
    let i = 1; while (i < all.length - 1 && len[i] < at) i++;
    const p0 = all[i - 1], p1 = all[i], f = (at - len[i - 1]) / Math.max(1e-6, len[i] - len[i - 1]), x = p0[0] + (p1[0] - p0[0]) * f, y = p0[1] + (p1[1] - p0[1]) * f;
    const hw = p0[2] + (p1[2] - p0[2]) * f, rad = Math.max(2.2 * u, hw * 3.2), fade = Math.min(1, phase * 8, (1 - phase) * 6);
    const rg = g.createRadialGradient(x, y, 0, x, y, rad);
    rg.addColorStop(0, `rgba(255,255,255,${0.95 * fade})`); rg.addColorStop(0.35, `rgba(170,240,255,${0.55 * fade})`); rg.addColorStop(1, "rgba(120,220,255,0)");
    g.fillStyle = rg; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
  }
}

// ---- marks on the ground through a projection P(x, z) -> [sx, sy] | null ----
export function groundRing(P, cx, cz, r, n = 48) {
  const out = []; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; out.push(P(cx + Math.cos(a) * r, cz + Math.sin(a) * r)); }
  return out;
}
function closedPath(g, pts) { g.beginPath(); let on = false; for (const p of pts) { if (!p) { on = false; continue; } if (on) g.lineTo(p[0], p[1]); else { g.moveTo(p[0], p[1]); on = true; } } }
// the landing reticle: a filled disc, an outer ring with four ticks pointing in, an inner ring, all lying on the ground
// (minPx: never smaller on the picture than that radius: far off, the 3D view's perspective would make it a speck)
export function minRadius(P, cx, cz, r, minPx) {
  const c = P(cx, cz), a = P(cx + r, cz), b = P(cx, cz + r); if (!c || !a || !b || !minPx) return r;
  const px = Math.max(Math.hypot(a[0] - c[0], a[1] - c[1]), Math.hypot(b[0] - c[0], b[1] - c[1]));
  return px > 0 && px < minPx ? r * Math.min(8, minPx / px) : r;
}
export function reticle(g, P, cx, cz, R, col, u, k = 1, minPx = 0) {
  R = minRadius(P, cx, cz, R, minPx);
  const outer = groundRing(P, cx, cz, R, 56), inner = groundRing(P, cx, cz, R * 0.42, 32);
  g.lineCap = "round"; g.lineJoin = "round";
  if (outer.every(Boolean)) { closedPath(g, outer); g.fillStyle = hexA(col, 0.16); g.fill(); }
  closedPath(g, outer); g.strokeStyle = "rgba(0,0,0,0.45)"; g.lineWidth = 2.8 * u * k; g.stroke(); g.strokeStyle = col; g.lineWidth = 1.25 * u * k; g.stroke();
  closedPath(g, inner); g.strokeStyle = "rgba(0,0,0,0.35)"; g.lineWidth = 1.9 * u * k; g.stroke(); g.strokeStyle = col; g.lineWidth = 0.8 * u * k; g.stroke();
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4, p = P(cx + Math.cos(a) * R * 1.12, cz + Math.sin(a) * R * 1.12), q = P(cx + Math.cos(a) * R * 0.66, cz + Math.sin(a) * R * 0.66);
    if (!p || !q) continue;
    g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.strokeStyle = "rgba(0,0,0,0.45)"; g.lineWidth = 2.6 * u * k; g.stroke(); g.strokeStyle = col; g.lineWidth = 1.1 * u * k; g.stroke();
  }
}
// a ring on the ground (the target, a putt's stop, the rest spot) with a dot in it
export function groundMark(g, P, cx, cz, r, col, u, { dot = true, k = 1, fill = 0.0, minPx = 0 } = {}) {
  r = minRadius(P, cx, cz, r, minPx);
  const pts = groundRing(P, cx, cz, r, 32), c = P(cx, cz);
  if (fill && pts.every(Boolean)) { closedPath(g, pts); g.fillStyle = hexA(col, fill); g.fill(); }
  closedPath(g, pts); g.strokeStyle = "rgba(0,0,0,0.5)"; g.lineWidth = 2.4 * u * k; g.stroke(); g.strokeStyle = col; g.lineWidth = 1.05 * u * k; g.stroke();
  if (dot && c) { g.beginPath(); g.arc(c[0], c[1], 1.1 * u * k, 0, 7); g.fillStyle = "rgba(0,0,0,0.5)"; g.fill(); g.beginPath(); g.arc(c[0], c[1], 0.7 * u * k, 0, 7); g.fillStyle = col; g.fill(); }
}
// a screen-space ring with a dot (marks whose size should not shrink with the distance)
export function screenMark(g, x, y, r, col, u, dot = true) {
  g.beginPath(); g.arc(x, y, r, 0, 7); g.strokeStyle = "rgba(0,0,0,0.55)"; g.lineWidth = 2.2 * u; g.stroke(); g.strokeStyle = col; g.lineWidth = 1 * u; g.stroke();
  if (dot) { g.beginPath(); g.arc(x, y, Math.max(1, r * 0.32), 0, 7); g.fillStyle = col; g.fill(); }
}
export function hexA(hex, a) {
  if (hex[0] !== "#") return hex;
  const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}
