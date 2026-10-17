// High-detail (vector) version of the portrait kit: the same face, hairstyle and colours as portrait.js, drawn smooth
// with Canvas 2D for the HD UI (96x96 for the 24x24 portrait, 128x128 for the 32x32 win / lose faces). Hand-made art
// written for this project; every shape is in the portrait's 24-space (centre column 12, the face spans rows 4..19).
//
//   drawHDFace(g, { hero, style, face, colours, mood }, px, x = 0, y = 0)   draws a px x px portrait at (x, y)
//   hdFaceCanvas(spec, px)                                                   -> an offscreen canvas with it
import { normalizeFace, paletteCss } from "./portrait.js";

const TAU = Math.PI * 2, K24 = 24;
const path = fn => { const p = new Path2D(); fn(p); return p; };
const E = (cx, cy, rx, ry, rot = 0) => p => { p.moveTo(cx + rx * Math.cos(rot), cy + rx * Math.sin(rot)); p.ellipse(cx, cy, rx, ry, rot, 0, TAU); };
const mirrorX = (x) => 24 - x;
// a smooth closed path through points (Catmull-Rom as beziers)
function smooth(p, pts, closed = true, t = 0.5) {
  const n = pts.length, at = i => pts[(i + n) % n];
  p.moveTo(pts[0][0], pts[0][1]);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = closed ? at(i - 1) : pts[Math.max(0, i - 1)], p1 = at(i), p2 = at(i + 1), p3 = closed ? at(i + 2) : pts[Math.min(n - 1, i + 2)];
    p.bezierCurveTo(p1[0] + (p2[0] - p0[0]) * t / 3 * 2 / 2, p1[1] + (p2[1] - p0[1]) * t / 3 * 2 / 2, p2[0] - (p3[0] - p1[0]) * t / 3 * 2 / 2, p2[1] - (p3[1] - p1[1]) * t / 3 * 2 / 2, p2[0], p2[1]);
  }
  if (closed) p.closePath();
}
const FACE_PTS = {                                   // the right half of the face, top to chin (the left is mirrored)
  round: [[12, 3.9], [16.2, 4.7], [19, 8], [19.5, 12], [18.5, 15.6], [15.8, 18.5], [12, 19.4]],
  oval: [[12, 3.9], [15.6, 4.7], [18.1, 8], [18.5, 12.2], [17.3, 16], [14.6, 18.9], [12, 19.7]],
  square: [[12, 4.1], [17, 4.4], [19.3, 6.8], [19.5, 13.2], [18.7, 16.9], [16, 19], [12, 19.3]],
};
const facePath = shape => path(p => { const R = FACE_PTS[shape], L = R.slice(1, -1).map(([x, y]) => [mirrorX(x), y]).reverse(); smooth(p, [...R, ...L]); });

function lin(g, x0, y0, x1, y1, stops) { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; }
function rad(g, cx, cy, r, stops, fx = cx, fy = cy) { const gr = g.createRadialGradient(fx, fy, 0, cx, cy, r); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; }
const alpha = (css, a) => css.replace("rgb(", "rgba(").replace(")", `,${a})`);
// fill a union of shapes with an outline around the whole
function massOf(g, shapes, fill, line, lw = 0.5) {
  const all = path(p => shapes.forEach(s => typeof s === "function" ? s(p) : p.addPath(s)));
  if (line) { g.lineJoin = "round"; g.strokeStyle = line; g.lineWidth = lw * 2; g.stroke(all); }
  g.fillStyle = fill; g.fill(all); return all;
}
function clipped(g, shape, fn) { g.save(); g.clip(shape); fn(); g.restore(); }
function line(g, pts, col, w, cap = "round") { g.strokeStyle = col; g.lineWidth = w; g.lineCap = cap; g.lineJoin = "round"; g.beginPath(); smooth(g, pts, false); g.stroke(); }
const hairShade = (g, shape, C, o = {}) => {                  // light from the upper left over a hair mass
  clipped(g, shape, () => {
    g.fillStyle = rad(g, o.cx ?? 9, o.cy ?? 5, o.r ?? 14, [[0, alpha(C.g, 0.75)], [0.5, alpha(C.g, 0.12)], [1, alpha(C.g, 0)]]); g.fillRect(0, 0, 24, 24);
    g.fillStyle = lin(g, 0, 8, 24, 20, [[0, alpha(C.k, 0)], [1, alpha(C.k, 0.55)]]); g.fillRect(0, 0, 24, 24);
  });
};
// coil texture: little curls over a clipped mass
function coils(g, shape, C, r = 1.05, rows = null) {
  clipped(g, shape, () => {
    let row = 0;
    for (let y = 1.2; y < 20; y += r * 1.55, row++) for (let x = 0.6 + (row & 1) * r; x < 24; x += r * 2) {
      const sh = (x * 7.3 + y * 3.1) % 1;
      g.fillStyle = alpha(C.k, 0.65); g.beginPath(); g.ellipse(x + 0.1, y + 0.18, r * 0.92, r * 0.8, 0, 0, TAU); g.fill();
      g.fillStyle = C.H; g.beginPath(); g.ellipse(x, y, r * 0.86, r * 0.74, 0, 0, TAU); g.fill();
      g.strokeStyle = alpha(C.g, 0.8 - sh * 0.3); g.lineWidth = 0.28; g.lineCap = "round"; g.beginPath(); g.arc(x - 0.05, y - 0.05, r * 0.52, Math.PI * 1.05, Math.PI * 1.75); g.stroke();
    }
  });
}

// ---------------------------------------------------------------------------------------------- the hair
// each: back(g,C,o) behind the shirt and face, mid(...) over the shirt behind the face, front(...) over the face
const BANGS = path(p => smooth(p, [[4.4, 11.4], [4.7, 8.6], [6.4, 7.6], [9, 7.9], [12, 8.9], [15, 7.9], [17.6, 7.6], [19.3, 8.6], [19.6, 11.4]], false));
const topMass = (rx = 8.9, ry = 7.2, cy = 8.4) => E(12, cy, rx, ry);
const fringe = (g, C, o = {}) => {                                     // hair over the forehead: the crown down to the bangs
  const crown = path(p => { smooth(p, [[3.3, 11.2], [3, 6.2], [6.2, 2.7], [12, 2], [17.8, 2.7], [21, 6.2], [20.7, 11.2], [19.4, 11.4], [19.2, 9], [17.6, 7.7], [15, 7.9], [12, 8.9], [9, 7.9], [6.4, 7.7], [4.8, 9], [4.6, 11.4]]); });
  massOf(g, [p => p.addPath(crown)], C.H, C.O, 0.5); hairShade(g, crown, C);
  clipped(g, crown, () => { for (let i = 0; i < 5; i++) { const x = 6.5 + i * 2.8; line(g, [[x, 3.2], [x + 0.6, 5.2], [x + (i < 2 ? -0.6 : 0.3), 7.6]], alpha(C.k, 0.5), 0.3); } });
  g.strokeStyle = alpha(C.k, 0.9); g.lineWidth = 0.35; g.lineCap = "round"; g.beginPath(); smooth(g, [[4.8, 9], [6.4, 7.7], [9, 7.9], [12, 8.9], [15, 7.9], [17.6, 7.7], [19.2, 9]], false); g.stroke();
  return crown;
};
const CAPB = (g, C) => {
  const crown = path(p => smooth(p, [[4, 9], [3.8, 5.2], [7.2, 2.4], [12, 1.8], [16.8, 2.4], [20.2, 5.2], [20, 9], [12, 8.4]]));
  massOf(g, [p => p.addPath(crown)], C.C, C.O, 0.5);
  clipped(g, crown, () => {
    g.fillStyle = rad(g, 12, 6, 12, [[0, alpha(C.e, 0.9)], [0.45, alpha(C.e, 0.1)], [1, alpha(C.c, 0.55)]], 8.5, 4.2); g.fillRect(0, 0, 24, 24);
    g.strokeStyle = alpha(C.c, 0.8); g.lineWidth = 0.3; g.lineCap = "round";
    for (const x of [8.2, 12, 15.8]) { g.beginPath(); g.moveTo(12 + (x - 12) * 0.25, 2.1); g.quadraticCurveTo(12 + (x - 12) * 0.9, 5, x + (x - 12) * 0.1, 8.5); g.stroke(); }
  });
  g.fillStyle = C.e; g.beginPath(); g.arc(12, 2.1, 0.55, 0, TAU); g.fill(); g.strokeStyle = C.O; g.lineWidth = 0.25; g.stroke();
  const brim = path(p => smooth(p, [[3.4, 8.2], [8, 7.3], [12, 7.2], [16, 7.3], [20.6, 8.2], [21.2, 9.6], [19, 10.3], [12, 9.2], [5, 10.3], [2.8, 9.6]]));
  massOf(g, [p => p.addPath(brim)], C.C, C.O, 0.5);
  clipped(g, brim, () => { g.fillStyle = lin(g, 0, 7, 0, 10.4, [[0, alpha(C.e, 0.7)], [0.5, alpha(C.C, 0)], [1, alpha(C.c, 0.95)]]); g.fillRect(0, 0, 24, 24); });
};
const STYLES = {
  cap: {
    back(g, C) { massOf(g, [E(12, 10, 8.9, 6.6)], C.H, C.O, 0.5); },
    front(g, C) { CAPB(g, C); },
  },
  headband: {
    back(g, C) {
      const sp = path(p => { for (const x of [6.2, 9.4, 12, 14.6, 17.8]) { p.moveTo(x - 1.5, 5.4); p.lineTo(x - 0.2, 1.5); p.lineTo(x + 1.5, 5.4); p.closePath(); } });
      const m = massOf(g, [E(12, 8.6, 8.9, 6.9), p => p.addPath(sp)], C.H, C.O, 0.5); hairShade(g, m, C);
    },
    front(g, C) {
      const band = path(p => smooth(p, [[3.5, 7.6], [12, 6.6], [20.5, 7.6], [20.5, 9.2], [12, 8.2], [3.5, 9.2]]));
      massOf(g, [p => p.addPath(band)], C.C, C.O, 0.45); clipped(g, band, () => { g.fillStyle = lin(g, 0, 6.5, 0, 9.4, [[0, alpha(C.e, 0.8)], [1, alpha(C.c, 0.8)]]); g.fillRect(0, 0, 24, 24); });
      const tail = path(p => smooth(p, [[19.8, 8], [22.6, 7.6], [23, 10.4], [21.4, 9.6]]));
      massOf(g, [p => p.addPath(tail)], C.C, C.O, 0.4);
    },
  },
  ponytail: {
    back(g, C) {
      const tail = path(p => smooth(p, [[16.6, 3.6], [20, 3.4], [22.6, 6.6], [23, 11], [22, 15.6], [20.2, 17.2], [20.6, 13], [20, 9.4], [18, 6.4]]));
      const m = massOf(g, [p => p.addPath(tail), E(12, 8.6, 8.8, 7)], C.H, C.O, 0.5); hairShade(g, m, C);
    },
    front(g, C) {
      const f = fringe(g, C);
      const tie = path(p => smooth(p, [[16.8, 3], [19.2, 3.2], [19.6, 6.6], [17, 6.4]]));
      massOf(g, [p => p.addPath(tie)], C.C, C.O, 0.4);
    },
  },
  short: {
    back(g, C) { massOf(g, [E(12, 9, 8.9, 6.9)], C.H, C.O, 0.5); },
    front(g, C) { fringe(g, C); },
  },
  pigtails: {
    back(g, C) {},
    mid(g, C) {
      for (const s of [1, -1]) {
        g.save(); if (s < 0) { g.translate(24, 0); g.scale(-1, 1); }
        const tail = path(p => smooth(p, [[5.4, 6.2], [2.6, 7.6], [1.6, 11.6], [2.2, 16], [1.4, 19.6], [3.6, 20.4], [4.8, 17], [5.6, 12], [6.4, 8]]));
        const m = massOf(g, [p => p.addPath(tail)], C.H, C.O, 0.5); hairShade(g, m, C);
        clipped(g, tail, () => { for (let i = 0; i < 4; i++) line(g, [[2.6 + i * 0.7, 9 + i * 0.4], [2.2 + i * 0.8, 14], [2 + i * 0.9, 19]], alpha(C.k, 0.5), 0.28); });
        const tie = path(p => smooth(p, [[3.4, 5.6], [6.4, 5.4], [6.6, 7.6], [3.6, 8]]));
        massOf(g, [p => p.addPath(tie)], C.C, C.O, 0.4); g.restore();
      }
    },
    front(g, C) { fringe(g, C); },
  },
  bob: {
    back(g, C) {
      const m = massOf(g, [path(p => smooth(p, [[12, 2], [18.6, 3.4], [21.4, 8], [21.4, 14], [20, 17.4], [17.6, 17.4], [17.6, 12], [6.4, 12], [6.4, 17.4], [4, 17.4], [2.6, 14], [2.6, 8], [5.4, 3.4]]))], C.H, C.O, 0.5);
      hairShade(g, m, C);
    },
    front(g, C) {
      fringe(g, C);
      for (const s of [1, -1]) { g.save(); if (s < 0) { g.translate(24, 0); g.scale(-1, 1); }
        const lock = path(p => smooth(p, [[4.2, 8.6], [5.4, 9], [5.6, 12.4], [5.2, 16.2], [4.4, 17], [3.8, 14], [3.8, 10.6]]));
        g.fillStyle = C.H; g.fill(lock); hairShade(g, lock, C); g.strokeStyle = alpha(C.k, 0.9); g.lineWidth = 0.35; g.lineCap = "round"; g.beginPath(); smooth(g, [[5.5, 9], [5.8, 12.6], [5.4, 16.4]], false); g.stroke(); g.restore(); }
    },
  },
  afro: {
    back(g, C) {
      const m = massOf(g, [E(12, 9.2, 10.6, 7.8), E(12, 6.4, 8.6, 5.6)], C.H, C.O, 0.5); hairShade(g, m, C); coils(g, m, C, 1.05);
    },
    front(g, C) {
      const front = path(p => smooth(p, [[2.4, 10.6], [1.8, 6.2], [6, 2.2], [12, 1.5], [18, 2.2], [22.2, 6.2], [21.6, 10.6], [19.6, 10.6], [18.8, 8.8], [16.4, 7.8], [12, 8.8], [7.6, 7.8], [5.2, 8.8], [4.4, 10.6]]));
      g.save(); g.strokeStyle = C.O; g.lineWidth = 0.9; g.lineJoin = "round"; g.stroke(front); g.fillStyle = C.H; g.fill(front); g.restore();
      hairShade(g, front, C); coils(g, front, C, 1.05);
    },
  },
  puffs: {
    back(g, C) {
      for (const x of [5, 19]) { const m = massOf(g, [E(x, 5.4, 4.3, 4)], C.H, C.O, 0.5); hairShade(g, m, C, { cx: x - 2, cy: 3.5, r: 7 }); coils(g, m, C, 0.95); }
      for (const x of [8, 16]) { const tie = path(p => smooth(p, [[x - 1.2, 8], [x + 1.2, 7.6], [x + 1.4, 9.4], [x - 1, 9.8]])); massOf(g, [p => p.addPath(tie)], C.C, C.O, 0.35); }
    },
    front(g, C) {
      const f = path(p => smooth(p, [[3.4, 11.2], [3.4, 6.8], [7, 4.8], [12, 4.4], [17, 4.8], [20.6, 6.8], [20.6, 11.2], [19.4, 11.4], [19.2, 9], [17.6, 7.8], [15, 8], [12, 8.9], [9, 8], [6.4, 7.8], [4.8, 9], [4.6, 11.4]]));
      massOf(g, [p => p.addPath(f)], C.H, C.O, 0.5); hairShade(g, f, C);
      clipped(g, f, () => { for (const t of [-0.8, -0.4, 0, 0.4, 0.8]) line(g, [[12 + t * 8, 8.2 + Math.abs(t) * 1.6], [12 + t * 8.3, 6], [12 + t * 5, 4.6]], alpha(C.k, 0.7), 0.3); });
    },
  },
  locs: {
    back(g, C) { const m = massOf(g, [E(12, 9.2, 9.2, 7.2)], C.H, C.O, 0.5); hairShade(g, m, C); },
    mid(g, C) {
      for (const s of [1, -1]) {
        g.save(); if (s < 0) { g.translate(24, 0); g.scale(-1, 1); }
        for (const [x, len, w] of [[2.4, 20.8, 1.35], [4.5, 18.8, 1.3], [6.4, 16.5, 1.2]]) {
          const loc = path(p => { p.moveTo(x - w, 7.6); p.lineTo(x - w, len - w); p.arc(x, len - w, w, Math.PI, 0, true); p.lineTo(x + w, 7.6); p.closePath(); });
          massOf(g, [p => p.addPath(loc)], C.H, C.O, 0.4);
          clipped(g, loc, () => {
            g.fillStyle = lin(g, x - w, 0, x + w, 0, [[0, alpha(C.g, 0.7)], [0.5, alpha(C.g, 0)], [1, alpha(C.k, 0.6)]]); g.fillRect(0, 0, 24, 24);
            g.strokeStyle = alpha(C.k, 0.8); g.lineWidth = 0.3; for (let y = 8.4; y < len; y += 1.15) { g.beginPath(); g.moveTo(x - w, y + 0.5); g.lineTo(x + w, y - 0.3); g.stroke(); }
          });
        }
        g.restore();
      }
    },
    front(g, C) { const f = fringe(g, C); },
  },
  cornrows: {
    back(g, C) { const m = massOf(g, [E(12, 8.6, 8.7, 7)], C.H, C.O, 0.5); hairShade(g, m, C); },
    front(g, C) {
      const f = fringe(g, C);
      clipped(g, f, () => {
        for (const t of [-0.9, -0.65, -0.4, -0.15, 0.15, 0.4, 0.65, 0.9]) {
          const pts = []; for (let v = 8.6; v >= 2.2; v -= 1.1) { const hw = Math.sqrt(Math.max(0, 1 - ((v - 8.8) / 6.9) ** 2)) * 9; pts.push([12 + t * hw, v]); }
          line(g, pts, alpha(C.k, 0.95), 0.45); line(g, pts.map(([x, y]) => [x + 0.38, y]), alpha(C.g, 0.7), 0.22);
        }
      });
    },
  },
  fade: {
    back(g, C) { massOf(g, [E(12, 9, 8.6, 6.9)], C.H, C.O, 0.5); },
    front(g, C) {
      const top = path(p => smooth(p, [[3.9, 11], [4.2, 6.6], [6, 3.4], [12, 2.9], [18, 3.4], [19.8, 6.6], [20.1, 11], [19, 11.1], [18.8, 8.8], [16.8, 7.6], [12, 8.4], [7.2, 7.6], [5.2, 8.8], [5, 11.1]]));
      massOf(g, [p => p.addPath(top)], C.H, C.O, 0.5); hairShade(g, top, C);
      clipped(g, top, () => {                                           // the faded sides: stipple fading towards the skin
        g.fillStyle = alpha(C.S, 0.55); for (let y = 7; y < 12; y += 0.55) for (let x of [3.9, 4.6, 5.3, 18.7, 19.4, 20.1]) { if ((Math.floor(y / 0.55) + Math.floor(x * 3)) % 2) { g.beginPath(); g.arc(x, y, 0.2, 0, TAU); g.fill(); } }
        g.strokeStyle = alpha(C.k, 0.8); g.lineWidth = 0.3; g.lineCap = "round"; for (const s of [4.9, 19.1]) { g.beginPath(); g.moveTo(s, 6.4); g.lineTo(s, 10.4); g.stroke(); }
      });
    },
  },
  braids: {
    back(g, C) { const m = massOf(g, [E(12, 9, 9.1, 7.2)], C.H, C.O, 0.5); hairShade(g, m, C); },
    mid(g, C) {
      for (const s of [1, -1]) {
        g.save(); if (s < 0) { g.translate(24, 0); g.scale(-1, 1); }
        for (const [x, len] of [[2.5, 21.6], [4.6, 20], [6.4, 17.2]]) {
          const n = Math.floor((len - 7.6) / 0.95);
          for (let i = 0; i < n; i++) {
            const y = 7.8 + i * 0.95, wob = (i & 1) ? 0.32 : -0.32;
            g.fillStyle = (i & 1) ? C.k : C.H; g.strokeStyle = C.O; g.lineWidth = 0.22;
            g.beginPath(); g.ellipse(x + wob * 0.6, y, 0.95, 0.62, wob * 1.2, 0, TAU); g.fill(); g.stroke();
          }
          g.fillStyle = C.C; g.strokeStyle = C.O; g.lineWidth = 0.25; g.beginPath(); g.arc(x, len + 0.1, 0.8, 0, TAU); g.fill(); g.stroke();
        }
        g.restore();
      }
    },
    front(g, C) {
      const f = fringe(g, C);
      clipped(g, f, () => { for (const t of [-0.65, 0, 0.65]) line(g, [[12 + t * 7, 8.6], [12 + t * 8, 6], [12 + t * 5, 3]], alpha(C.O, 0.8), 0.32); });
    },
  },
};

// ---------------------------------------------------------------------------------------------- the face
const EYE_AT = { l: [8.9, 12.1], r: [15.1, 12.1] };
function eye(g, C, kind, cx, cy, side, mood) {          // side: -1 left eye, +1 right eye (its outer corner is away from the nose)
  g.save(); g.translate(cx, cy); g.scale(side * 1.18, 1.18);       // draw the left eye; mirrored for the right
  const O = C.O;
  const iris = (x, y, r, ry = r) => {
    g.fillStyle = rad(g, x, y, r, [[0, C.i], [0.55, C.I], [1, "rgb(36,22,16)"]], x, y + r * 0.3); g.beginPath(); g.ellipse(x, y, r, ry, 0, 0, TAU); g.fill();
    g.fillStyle = "rgb(20,12,10)"; g.beginPath(); g.ellipse(x, y, r * 0.5, ry * 0.52, 0, 0, TAU); g.fill();
    g.fillStyle = "#fff"; g.beginPath(); g.arc(x - r * 0.36, y - ry * 0.38, r * 0.3, 0, TAU); g.fill(); g.beginPath(); g.arc(x + r * 0.34, y + ry * 0.42, r * 0.14, 0, TAU); g.fill();
  };
  const sclera = (path2) => { g.fillStyle = C.W; g.fill(path2); };
  if (kind === "happy" || (mood === "win" && false)) {
    g.strokeStyle = O; g.lineWidth = 0.55; g.lineCap = "round"; g.beginPath(); g.moveTo(-1.8, 0.5); g.quadraticCurveTo(0, -1.9, 1.8, 0.5); g.stroke();
    g.restore(); return;
  }
  const H = { round: 1.55, bright: 1.85, sharp: 1.25, sleepy: 1.1, determined: 1.4 }[kind] || 1.55, W = 1.85;
  const top = kind === "sleepy" ? -0.1 : -H, bot = H * (kind === "sharp" ? 0.75 : 1);
  const eyeP = path(p => { p.moveTo(-W, 0.1); p.bezierCurveTo(-W * 0.8, top - 0.5, W * 0.8, top - 0.5, W, kind === "sharp" ? -0.6 : 0.1); p.bezierCurveTo(W * 0.8, bot + 0.4, -W * 0.8, bot + 0.4, -W, 0.1); p.closePath(); });
  sclera(eyeP);
  clipped(g, eyeP, () => {
    iris(0.1, 0.05 + (kind === "sleepy" ? 0.2 : 0), kind === "bright" ? 1.42 : 1.22, kind === "bright" ? 1.5 : kind === "sleepy" ? 1.1 : 1.3);
    if (kind === "sleepy") { g.fillStyle = alpha(C.s, 0.95); g.fillRect(-3, -3, 6, 2.65); }
    g.fillStyle = alpha("rgb(60,40,40)", 0.18); g.fillRect(-3, -3, 6, 1.0);
  });
  g.strokeStyle = O; g.lineCap = "round"; g.lineJoin = "round";
  g.lineWidth = kind === "determined" || kind === "sharp" ? 0.62 : 0.5;
  g.beginPath(); g.moveTo(-W - 0.1, 0.1); g.bezierCurveTo(-W * 0.8, top - 0.5, W * 0.8, top - 0.5, W + 0.1, kind === "sharp" ? -0.6 : 0.1); g.stroke();
  if (kind === "sharp") { g.beginPath(); g.moveTo(W, -0.6); g.lineTo(W + 0.75, -1.2); g.stroke(); }
  g.lineWidth = 0.22; g.globalAlpha = 0.7; g.beginPath(); g.moveTo(-W * 0.9, 0.2); g.bezierCurveTo(-W * 0.6, bot + 0.3, W * 0.6, bot + 0.3, W * 0.9, 0.2); g.stroke(); g.globalAlpha = 1;
  g.restore();
}
function brow(g, C, kind, cx, y, side, mood) {
  g.save(); g.translate(cx, y); g.scale(side, 1);
  g.strokeStyle = C.k; g.lineWidth = 0.6; g.lineCap = "round"; g.lineJoin = "round"; g.beginPath();
  const lose = mood === "lose";
  if (lose) { g.moveTo(-1.9, 0.5); g.lineTo(1.9, -0.5); }
  else if (kind === "arched") { g.moveTo(-1.9, 0.4); g.quadraticCurveTo(-0.2, -1.2, 1.9, 0.2); }
  else if (kind === "angled") { g.moveTo(-1.9, -0.45); g.lineTo(1.9, 0.5); g.lineWidth = 0.75; }
  else { g.moveTo(-1.9, 0); g.lineTo(1.9, -0.1); }
  g.stroke(); g.restore();
}
function mouth(g, C, kind, mood, cx, cy) {
  g.save(); g.translate(cx, cy); const O = C.O;
  g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = O; g.lineWidth = 0.5;
  const open = (w, h, teeth) => {
    const m = path(p => { p.moveTo(-w, 0); p.bezierCurveTo(-w * 0.8, h * 1.45, w * 0.8, h * 1.45, w, 0); p.bezierCurveTo(w * 0.6, -0.35, -w * 0.6, -0.35, -w, 0); p.closePath(); });
    g.fillStyle = C.M; g.fill(m);
    clipped(g, m, () => { if (teeth) { g.fillStyle = C.W; g.fillRect(-w, -0.5, w * 2, 0.95); } g.fillStyle = C.L; g.beginPath(); g.ellipse(0, h * 1.05, w * 0.55, h * 0.34, 0, 0, TAU); g.fill(); });
    g.stroke(m);
  };
  if (mood === "win") {
    if (kind === "grin") open(2.7, 1.9, true); else if (kind === "smile") open(1.9, 1.5, false);
    else if (kind === "smirk") { g.beginPath(); g.moveTo(-1.8, 0.3); g.quadraticCurveTo(0.4, 1.2, 2.2, -0.5); g.stroke(); g.beginPath(); g.moveTo(-1.2, 0.4); g.quadraticCurveTo(0.4, 2, 1.9, 0.3); g.fillStyle = C.M; g.fill(); g.stroke(); }
    else open(1.4, 1.2, false);
  } else if (mood === "lose") {
    g.beginPath();
    if (kind === "grin") { g.ellipse(0, 0.6, 1.5, 1.1, 0, 0, TAU); g.fillStyle = C.M; g.fill(); }
    else if (kind === "smirk") { g.moveTo(-1.8, -0.3); g.quadraticCurveTo(0.4, 0.4, 2, 0.9); }
    else { g.moveTo(-1.8, 0.6); g.quadraticCurveTo(0, -0.9, 1.8, 0.6); }
    g.stroke();
  } else {
    if (kind === "grin") open(2.3, 1.15, true);
    else if (kind === "smile") { g.beginPath(); g.moveTo(-1.7, -0.1); g.quadraticCurveTo(0, 1.55, 1.7, -0.1); g.stroke(); }
    else if (kind === "smirk") { g.beginPath(); g.moveTo(-1.5, 0.35); g.quadraticCurveTo(0.3, 0.7, 1.5, 0.35); g.quadraticCurveTo(1.85, 0.2, 2, -0.35); g.stroke(); }
    else { g.beginPath(); g.moveTo(-1.5, 0.1); g.lineTo(1.5, 0.1); g.stroke(); }
  }
  g.restore();
}
function shirt(g, C) {
  const body = path(p => smooth(p, [[0, 24], [1.6, 21.8], [6, 19.8], [9.6, 19.1], [14.4, 19.1], [18, 19.8], [22.4, 21.8], [24, 24]], false));
  const sh = path(p => { p.addPath(body); p.lineTo(24, 24.5); p.lineTo(0, 24.5); p.closePath(); });
  g.strokeStyle = C.O; g.lineWidth = 1.0; g.stroke(sh); g.fillStyle = lin(g, 0, 19, 0, 24, [[0, C.u], [0.35, C.T], [1, C.t]]); g.fill(sh);
  g.fillStyle = lin(g, 3, 0, 22, 0, [[0, alpha(C.u, 0.5)], [0.6, alpha(C.u, 0)], [1, alpha(C.t, 0.6)]]); g.fill(sh);
  // neck and a crew collar
  const neck = path(p => smooth(p, [[9.6, 17], [14.4, 17], [14.8, 19.2], [14, 21], [12, 21.6], [10, 21], [9.2, 19.2]]));
  g.fillStyle = lin(g, 0, 17, 0, 21.6, [[0, C.d], [0.4, C.s], [1, C.s]]); g.fill(neck);
  g.strokeStyle = C.u; g.lineWidth = 0.9; g.beginPath(); g.ellipse(12, 19.3, 3.5, 2.5, 0, 0.05 * Math.PI, 0.95 * Math.PI); g.stroke();
  g.strokeStyle = alpha(C.O, 0.55); g.lineWidth = 0.25; g.beginPath(); g.ellipse(12, 19.3, 4.0, 2.9, 0, 0.05 * Math.PI, 0.95 * Math.PI); g.stroke();
}
function faceShape(g, C, shape) {
  const fp = facePath(shape);
  for (const s of [1, -1]) {                                                    // ears
    const ex = s > 0 ? 19.3 : 4.7, ear = path(E(ex, 12.3, 1.15, 1.65, s * 0.1));
    g.fillStyle = C.s; g.fill(ear); g.strokeStyle = C.O; g.lineWidth = 0.4; g.stroke(ear);
    g.strokeStyle = alpha(C.d, 0.8); g.lineWidth = 0.25; g.beginPath(); g.arc(ex + s * 0.1, 12.3, 0.55, 0, TAU); g.stroke();
  }
  g.fillStyle = C.S; g.fill(fp);
  clipped(g, fp, () => {
    g.fillStyle = rad(g, 9.2, 10, 11, [[0, alpha(C.h, 0.85)], [0.55, alpha(C.h, 0.12)], [1, alpha(C.h, 0)]], 8.4, 8.6); g.fillRect(0, 0, 24, 24);   // the lit upper left
    g.fillStyle = lin(g, 4, 0, 21, 0, [[0.55, alpha(C.s, 0)], [1, alpha(C.s, 0.75)]]); g.fillRect(0, 0, 24, 24);                                  // the shaded right
    g.fillStyle = lin(g, 0, 15.5, 0, 20, [[0, alpha(C.s, 0)], [1, alpha(C.d, 0.8)]]); g.fillRect(0, 0, 24, 24);                                   // under the chin
  });
  g.strokeStyle = C.O; g.lineWidth = 0.55; g.lineJoin = "round"; g.stroke(fp);
  return fp;
}
function nose(g, C) { g.strokeStyle = alpha(C.d, 0.9); g.lineWidth = 0.32; g.lineCap = "round"; g.beginPath(); g.moveTo(11.5, 14.1); g.quadraticCurveTo(12, 15.05, 12.7, 14.3); g.stroke(); g.fillStyle = alpha(C.h, 0.7); g.beginPath(); g.arc(11.2, 13.1, 0.4, 0, TAU); g.fill(); }
function extras(g, C, face, mood) {
  if (face.extras.includes("blush")) for (const x of [7.2, 16.8]) { g.fillStyle = rad(g, x, 15.1, 2.2, [[0, alpha(C.r, 0.75)], [1, alpha(C.r, 0)]]); g.beginPath(); g.ellipse(x, 15.1, 2.2, 1.3, 0, 0, TAU); g.fill(); }
  if (face.extras.includes("freckles")) { g.fillStyle = alpha(C.q, 0.9); for (const [x, y] of [[7.6, 14.2], [8.7, 15], [9.6, 14.1], [14.4, 14.1], [15.3, 15], [16.4, 14.2], [11.2, 12.9], [12.9, 12.8]]) { g.beginPath(); g.arc(x, y, 0.2, 0, TAU); g.fill(); } }
}
function glasses(g, C) {
  g.strokeStyle = C.G; g.lineWidth = 0.55; g.lineJoin = "round";
  for (const [x0, x1] of [[6.5, 11.3], [12.7, 17.5]]) { g.fillStyle = "rgba(210,232,250,0.22)"; g.beginPath(); g.roundRect(x0, 9.6, x1 - x0, 5.1, 1.6); g.fill(); g.stroke(); g.strokeStyle = "rgba(255,255,255,0.8)"; g.lineWidth = 0.22; g.beginPath(); g.moveTo(x0 + 0.9, 10.7); g.lineTo(x0 + 2.1, 10); g.stroke(); g.strokeStyle = C.G; g.lineWidth = 0.55; }
  g.beginPath(); g.moveTo(11.3, 11.4); g.quadraticCurveTo(12, 10.9, 12.7, 11.4); g.stroke();
  g.beginPath(); g.moveTo(6.5, 11); g.lineTo(5.1, 10.6); g.moveTo(17.5, 11); g.lineTo(18.9, 10.6); g.stroke();
}
function card(g, C, mood) {
  const inner = path(p => p.roundRect(0.5, 0.5, 23, 23, 1.3));
  g.fillStyle = lin(g, 0, 0, 24, 24, [[0, C.a], [0.45, C.B], [1, C.b]]); g.fill(inner);
  clipped(g, inner, () => {
    g.fillStyle = alpha(C.a, 0.35); g.beginPath(); g.moveTo(0, 0); g.lineTo(9, 0); g.lineTo(0, 9); g.fill();
    g.strokeStyle = alpha(C.a, 0.3); g.lineWidth = 0.6; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(11 + i * 3.4, 24); g.lineTo(24, 11 + i * 3.4); g.stroke(); }
  });
  return inner;
}
function frame(g, C) { g.strokeStyle = C.F; g.lineWidth = 1.2; g.beginPath(); g.roundRect(0.6, 0.6, 22.8, 22.8, 1.6); g.stroke(); g.strokeStyle = alpha(C.O, 0.25); g.lineWidth = 0.2; g.beginPath(); g.roundRect(1.25, 1.25, 21.5, 21.5, 1.1); g.stroke(); }
function sparkle(g, x, y, r, col) { g.fillStyle = col; g.beginPath(); g.moveTo(x, y - r); g.quadraticCurveTo(x + 0.12 * r, y - 0.12 * r, x + r, y); g.quadraticCurveTo(x + 0.12 * r, y + 0.12 * r, x, y + r); g.quadraticCurveTo(x - 0.12 * r, y + 0.12 * r, x - r, y); g.quadraticCurveTo(x - 0.12 * r, y - 0.12 * r, x, y - r); g.fill(); }

export function drawHDFace(g, spec, px, x = 0, y = 0) {
  const hero = spec.hero || "boy", face = normalizeFace(spec.face, hero), mood = spec.mood || "neutral";
  const style = STYLES[spec.style] ? spec.style : (hero === "boy" ? "cap" : "pigtails"), ST = STYLES[style];
  const col = { skin: 0x2E5F, hair: 0x0C63, hat: 0x2D5, top: 0x1F, ...(spec.colours || {}) };
  const C = paletteCss(col, mood);
  g.save(); g.translate(x, y); g.scale(px / K24, px / K24);
  const clip = card(g, C, mood);
  g.save(); g.clip(clip);
  if (ST.back) ST.back(g, C);
  shirt(g, C);
  if (ST.mid) ST.mid(g, C);
  const fp = faceShape(g, C, face.shape);
  extras(g, C, face, mood);
  const kinds = { l: face.eyes, r: face.eyes };
  const dy = mood === "win" ? -0.0 : mood === "lose" ? 0.15 : 0;
  brow(g, C, face.brows, 8.9, (mood === "win" ? 8.6 : mood === "lose" ? 9.2 : 9.0), 1, mood); brow(g, C, face.brows, 15.1, (mood === "win" ? 8.6 : mood === "lose" ? 9.2 : 9.0), -1, mood);
  eye(g, C, kinds.l, EYE_AT.l[0], EYE_AT.l[1] + dy, 1, mood); eye(g, C, kinds.r, EYE_AT.r[0], EYE_AT.r[1] + dy, -1, mood);
  nose(g, C);
  mouth(g, C, face.mouth, mood, 12, 16.7);
  if (mood === "lose") { g.fillStyle = C.z; g.beginPath(); g.moveTo(7.3, 14.1); g.quadraticCurveTo(6.5, 15.3, 7.3, 15.9); g.quadraticCurveTo(8.1, 15.3, 7.3, 14.1); g.fill(); g.strokeStyle = "rgba(255,255,255,0.7)"; g.lineWidth = 0.15; g.stroke(); }
  if (face.extras.includes("glasses")) glasses(g, C);
  if (ST.front) ST.front(g, C);
  if (mood === "win") { sparkle(g, 3.4, 4.2, 1.5, "rgba(255,255,255,0.95)"); sparkle(g, 20.6, 3, 1.1, "rgba(255,255,255,0.9)"); sparkle(g, 21.4, 6.6, 0.7, "rgba(255,255,255,0.85)"); }
  if (mood === "lose") { g.fillStyle = "rgba(60,70,110,0.16)"; g.fillRect(0, 0, 24, 24); }
  g.restore();
  frame(g, C);
  g.restore();
}
export function hdFaceCanvas(spec, px) {
  const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(px, px) : Object.assign(document.createElement("canvas"), { width: px, height: px });
  drawHDFace(c.getContext("2d"), spec, px); return c;
}
export const HD_STYLES = Object.keys(STYLES);
