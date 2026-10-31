// COURT WEAR (3D stadium, render only): the court wears in as a match goes on. Where the players stand and run the surface is scuffed a
// little more every frame: lighter scrapes and slide marks on clay, the grass worn to brown at the baselines and the service line, black
// rubber on a hard court. On clay the ball leaves its mark where it bounces, and the marks stay for the rest of the match. A new match
// starts on a clean court. Painted on a low-resolution canvas over the court (world X -1100..1100, Y -1800..1800), drawn flat just above
// the floor; uploaded every few frames. Reads the players' and the ball's positions only.
const X0 = -1100, X1 = 1100, Y0 = -1800, Y1 = 1800, W = 320, H = 512;          // (about 7 world units a pixel)
const LOOK = {
  clay:  { scuff: "rgba(236,190,150,A)", mark: "rgba(150,70,40,A)", markA: 0.42, rate: 0.035, skid: "rgba(120,52,28,A)", skidA: 0.5, lite: "rgba(240,200,160,A)" },
  grass: { scuff: "rgba(150,124,70,A)", mark: "rgba(60,90,40,A)", markA: 0.18, rate: 0.03, skid: "rgba(120,100,55,A)", skidA: 0.42, lite: "rgba(190,215,140,A)" },
  hard:  { scuff: "rgba(30,30,34,A)", mark: "rgba(40,40,44,A)", markA: 0.10, rate: 0.012, skid: "rgba(28,28,32,A)", skidA: 0.38, lite: "rgba(255,255,255,A)" },
};
// STYLE (test: localStorage mt-wear, "spots" the old look): how the players mark the court instead of a dot under them every frame
//   skid    brake skids: where a player stops or turns hard, two short parallel strokes (the two feet) along the way they were going,
//           as long as they were fast; the ball's bounce a streak along its flight
//   trail   footwork: every step a soft pale line along the run, so the running lanes along the baseline wear in (scraped lighter);
//           shorter, fainter skids on a hard stop; the ball's bounce a streak
//   sweep   slides: on a turn the feet sweep a curved arc (out the old way, round into the new), wide and soft with a darker leading
//           edge and a little spray of kicked-up dots; the ball's bounce a comet with a short tail
const STYLE = (() => { try { return localStorage.getItem("mt-wear") || "spots"; } catch (e) { return "spots"; } })();
export class CourtWear {
  constructor(v) { this.v = v; this.cv = null; this.tex = null; this.dirty = 0; this.kind = "hard"; this.matchKey = -1; this.lastBall = 0; this.frames = 0; }
  reset(kind) {
    if (!this.cv && typeof document !== "undefined") { this.cv = document.createElement("canvas"); this.cv.width = W; this.cv.height = H; this.g = this.cv.getContext("2d"); }
    this.kind = LOOK[kind] ? kind : "hard"; if (this.g) this.g.clearRect(0, 0, W, H); this.dirty = 1;
  }
  px(X, Y) { return [(X - X0) / (X1 - X0) * W, (Y - Y0) / (Y1 - Y0) * H]; }
  // once per game frame (stadium3d.js step)
  step(w) {
    if (!this.g) return;
    const L = LOOK[this.kind], played = (w[0x8E0] + w[0x8E1]) * 100 + w[0x8E2] + w[0x8E3] + (w[0x8E4] + w[0x8E5] > 0 ? 0.5 : 0);
    if (played < this.matchKey) this.reset(this.kind); this.matchKey = played;                       // a new match: a clean court
    const g = this.g;
    if (STYLE === "spots") {
      for (const p of this.v.players()) {                                                          // the scuffing
        if (p.Z < -40) continue; const [x, y] = this.px(p.X, p.Y); if (x < 0 || y < 0 || x > W || y > H) continue;
        g.fillStyle = L.scuff.replace("A", L.rate); g.beginPath(); g.ellipse(x, y, 5.2, 3.6, 0, 0, 7); g.fill();
      }
    } else this.feet(g, L);
    const b = this.v.ballWorld(), bounce = w[0x4B3] === 1;                                            // a bounce: its mark
    if (bounce && this.lastBall !== 1) this.ballMark(g, L, b, this.lastB);
    this.lastBall = w[0x4B3]; this.lastB = { X: b.X, Y: b.Y };
    if (++this.frames % 15 === 0) this.dirty = 1;
  }
  // the players' marks by STYLE: each player's last position and step kept by slot (a jump of more than 60: a new point, no mark)
  feet(g, L) {
    const T = this.track || (this.track = new Map()), seen = new Set();
    for (const p of this.v.players()) {
      seen.add(p.slot); const t = T.get(p.slot); T.set(p.slot, { X: p.X, Y: p.Y, vx: t ? p.X - t.X : 0, vy: t ? p.Y - t.Y : 0 });
      if (!t || p.Z < -40) continue;
      const vx = p.X - t.X, vy = p.Y - t.Y, sp = Math.hypot(vx, vy), sp0 = Math.hypot(t.vx, t.vy); if (sp > 60 || sp0 > 60) continue;
      const turn = sp0 > 1 && sp > 0.5 ? 1 - (vx * t.vx + vy * t.vy) / (sp * sp0) : 0;              // 0 straight on .. 2 reversed
      const brake = sp0 - sp, hard = sp0 > 4 && (brake > 1.6 || turn > 0.6);                          // (world units a frame: a run is ~6-9)
      const [x0, y0] = this.px(t.X, t.Y), [x1, y1] = this.px(p.X, p.Y);
      if (STYLE === "trail" && sp > 1.5) { g.strokeStyle = L.lite.replace("A", 0.07); g.lineWidth = 3.4; g.lineCap = "round"; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
      if (!hard) continue;
      const ux = t.vx / sp0, uy = t.vy / sp0, len = Math.max(50, Math.min(170, sp0 * 15));              // the slide (world units): along the way they were going
      if (STYLE === "sweep") this.sweep(g, L, x1, y1, ux, uy, vx / (sp || 1), vy / (sp || 1), len, turn);
      else this.skid(g, L, x1, y1, ux, uy, STYLE === "trail" ? len * 0.6 : len, STYLE === "trail" ? 0.6 : 1);
    }
    for (const k of T.keys()) if (!seen.has(k)) T.delete(k);
  }
  // two strokes (the feet), a little apart across the slide, tapering: from where the player is back along the slide
  skid(g, L, x, y, ux, uy, len, k) {
    const sx = (X1 - X0) / W, sy = (Y1 - Y0) / H, nx = -uy / sx, ny = ux / sy, dx = ux * len / sx, dy = uy * len / sy;
    for (const side of [-1, 1]) {
      const ox = nx * side * 9, oy = ny * side * 9, gr = g.createLinearGradient(x + ox - dx, y + oy - dy, x + ox, y + oy);   // (the feet 18 apart)
      gr.addColorStop(0, L.skid.replace("A", 0)); gr.addColorStop(0.7, L.skid.replace("A", L.skidA * k * 0.8)); gr.addColorStop(1, L.skid.replace("A", L.skidA * k));
      g.strokeStyle = gr; g.lineWidth = 1.7; g.lineCap = "round"; g.beginPath(); g.moveTo(x + ox - dx, y + oy - dy); g.lineTo(x + ox, y + oy); g.stroke();
    }
  }
  // a slide's curved sweep: from behind, out along the old way, curling round into the new; soft and wide, a darker leading edge, spray
  sweep(g, L, x, y, ux, uy, wx, wy, len, turn) {
    const sx = (X1 - X0) / W, sy = (Y1 - Y0) / H, s = len, ax = x - ux * s / sx, ay = y - uy * s / sy, cx = x + ux * s * 0.45 / sx, cy = y + uy * s * 0.45 / sy;
    const ex = x + wx * s * 0.4 / sx, ey = y + wy * s * 0.4 / sy;
    g.lineCap = "round";
    g.strokeStyle = L.lite.replace("A", 0.16); g.lineWidth = 6; g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo(cx, cy, ex, ey); g.stroke();
    g.strokeStyle = L.skid.replace("A", L.skidA * 0.85); g.lineWidth = 1.5; g.beginPath(); g.moveTo(ax + (cx - ax) * 0.3, ay + (cy - ay) * 0.3); g.quadraticCurveTo(cx, cy, ex, ey); g.stroke();
    g.fillStyle = L.skid.replace("A", L.skidA * 0.55);
    for (let i = 0; i < 4 + Math.round(turn * 3); i++) { const a = ((this.frames * 7 + i * 53) % 100) / 100 * 6.28, r = 3 + ((i * 37 + this.frames) % 7) * 0.8; g.fillRect(ex + Math.cos(a) * r, ey + Math.sin(a) * r, 1.2, 1.2); }
  }
  // the ball's mark where it lands: the old oval (spots), else a streak along its flight (a comet with a tail for sweep)
  ballMark(g, L, b, prev) {
    const [x, y] = this.px(b.X, b.Y);
    if (STYLE === "spots" || !prev) { g.fillStyle = L.mark.replace("A", L.markA); g.beginPath(); g.ellipse(x, y, 2.8, 4.4, 0, 0, 7); g.fill(); return; }
    const a = Math.atan2((b.Y - prev.Y) / ((Y1 - Y0) / H), (b.X - prev.X) / ((X1 - X0) / W));
    g.save(); g.translate(x, y); g.rotate(a);
    if (STYLE === "sweep") { const gr = g.createLinearGradient(-13, 0, 3, 0); gr.addColorStop(0, L.mark.replace("A", 0)); gr.addColorStop(1, L.mark.replace("A", L.markA)); g.fillStyle = gr; g.beginPath(); g.ellipse(-5, 0, 8, 2, 0, 0, 7); g.fill(); g.fillStyle = L.mark.replace("A", L.markA); g.beginPath(); g.ellipse(1.5, 0, 3, 2.3, 0, 0, 7); g.fill(); }
    else { g.fillStyle = L.mark.replace("A", L.markA); g.beginPath(); g.ellipse(0, 0, 6, 2, 0, 0, 7); g.fill(); }
    g.restore();
  }
  draw(mvp) {
    const v = this.v, gl = v.gl; if (!this.cv) return;
    if (this.dirty || !this.tex) {
      if (!this.tex) { this.tex = gl.createTexture(); }
      gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.cv);
      for (const [k, val] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, val);
      this.dirty = 0;
    }
    gl.useProgram(v.prog); gl.bindVertexArray(v.vao); gl.depthMask(false);
    // a flat quad over the court: x across, the picture's rows along +Y (towards the camera)
    gl.disable(gl.CULL_FACE); v.draw(this.tex, new Float32Array([X1 - X0, 0, 0, 0, 0, 0, -(Y1 - Y0), 0, 0, 1, 0, 0, 0, 0.4, Y1, 1]), mvp, [0, 0, 1, 1], [1, 1, 1, 1], 0.004);
    gl.depthMask(true);
  }
}
