// CLOSE CALLS (3D hole view, render only; adapted from Mario Tennis's closecall.js): a review panel for the shots that nearly did
// something. When a shot stops (its outcome from the page's shot list) the ball's path is looked over:
//   lip out     the ball rolled past within a whisker of the cup (closer than a ball's width or so) and did not drop
//   the water   the ball stopped (not in the water) within a few yards of the hole's water
// The panel is a second picture of the hole in a corner, low by the spot, the ball going through it again at half speed, with what
// happened and how close it was (1 px of the course map is about a yard). Reads the ball's path (scene.js watch); writes nothing.
import { T } from "./hole3d.js";
import { drawLabel } from "./labels.js";

export class CloseCall {
  key = "closecall";
  holeBuilt() { this.c = null; }
  frame(sc, game, s) {
    if (!s) return;
    for (const [k, d] of sc.events || []) {
      if (k !== "stop" || !d.flight || d.outcome === 0x80) continue;
      const P = d.flight.path; if (P.length < 4) continue;
      const [cx, cz] = d.cup;
      let best = 1e9, bi = -1;
      for (let i = 0; i < P.length; i++) { const p = P[i]; if (p[1] > 0.15) continue; const dd = Math.hypot(p[0] - cx, p[2] - cz); if (dd < best) { best = dd; bi = i; } }
      const last = P[P.length - 1], endD = Math.hypot(last[0] - cx, last[2] - cz);
      if (bi >= 0 && best < 0.45 && endD > best + 0.4) { this.start(sc, "LIP OUT!", `${Math.max(1, Math.round(best * 36))} in from the cup`, P, bi, [cx, cz]); continue; }
      if (d.outcome !== 3) {                          // stopped by the water?
        const art = sc.hole.art; let near = 99;
        for (let r = 1; r <= 4 && near === 99; r++) for (let a = 0; a < 16; a++) { const x = last[0] + Math.cos(a / 16 * 6.283) * r, z = last[2] + Math.sin(a / 16 * 6.283) * r; if (art.terrainAtPx(x, z) === T.WATER) { near = r; break; } }
        if (near <= 3) this.start(sc, "JUST SHORT OF THE WATER", `${near} yd to spare`, P, P.length - 1, [last[0], last[2]]);
      }
    }
  }
  start(sc, title, sub, path, at, spot) { this.c = { title, sub, path, at, spot, t: 0, dur: 4.5 }; }
  drawInset(sc) {
    const c = this.c; if (!c) return;
    c.t += sc.dt; if (c.t > c.dur) { this.c = null; return; }
    const P = c.path, a = Math.max(0, c.at - 40), b = Math.min(P.length - 1, c.at + 20), span = b - a;
    const i = a + ((c.t * 30) % (span + 15)), k = Math.min(b, Math.floor(i)), p = P[k];
    const q = P[Math.max(a, k - 6)]; let dx = p[0] - q[0], dz = p[2] - q[2]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const H = sc.hole.H, s = c.spot, gy = H(s[0], s[1]);
    const side = [-dz, dx], eye = [s[0] - dx * 5 + side[0] * 3, gy + 1.6, s[1] - dz * 5 + side[1] * 3];
    const keep = sc.ballOverride; sc.ballOverride = [p[0], p[1], p[2]];
    const fade = Math.min(1, c.t * 4, (c.dur - c.t) * 3);
    sc.renderInset([0.52, 0.5, 0.45, 0.42], eye, [s[0], gy + 0.3, s[1]], 0.75);
    sc.ballOverride = keep;
    drawLabel(sc, c.title, 0.745, 0.06, 0.06, { size: 30, fg: "#ffe24a", bg: "rgba(0,0,0,0.6)", stroke: null }, fade);
    drawLabel(sc, c.sub, 0.745, 0.47, 0.045, { size: 24, fg: "#fff", bg: "rgba(0,0,0,0.6)", stroke: null }, fade);
  }
}
