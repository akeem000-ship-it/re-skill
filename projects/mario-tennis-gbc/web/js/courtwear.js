// COURT WEAR (3D stadium, render only): the court wears in as a match goes on. Where the players stand and run the surface is scuffed a
// little more every frame: lighter scrapes and slide marks on clay, the grass worn to brown at the baselines and the service line, black
// rubber on a hard court. On clay the ball leaves its mark where it bounces, and the marks stay for the rest of the match. A new match
// starts on a clean court. Painted on a low-resolution canvas over the court (world X -1100..1100, Y -1800..1800), drawn flat just above
// the floor; uploaded every few frames. Reads the players' and the ball's positions only.
const X0 = -1100, X1 = 1100, Y0 = -1800, Y1 = 1800, W = 160, H = 256;
const LOOK = {
  clay:  { scuff: "rgba(236,190,150,A)", mark: "rgba(150,70,40,A)", markA: 0.42, rate: 0.035 },
  grass: { scuff: "rgba(150,124,70,A)", mark: "rgba(60,90,40,A)", markA: 0.18, rate: 0.03 },
  hard:  { scuff: "rgba(30,30,34,A)", mark: "rgba(40,40,44,A)", markA: 0.10, rate: 0.012 },
};
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
    for (const p of this.v.players()) {                                                            // the scuffing
      if (p.Z < -40) continue; const [x, y] = this.px(p.X, p.Y); if (x < 0 || y < 0 || x > W || y > H) continue;
      g.fillStyle = L.scuff.replace("A", L.rate); g.beginPath(); g.ellipse(x, y, 2.6, 1.8, 0, 0, 7); g.fill();
    }
    const bounce = w[0x4B3] === 1;                                                                   // a bounce: its mark
    if (bounce && this.lastBall !== 1) { const b = this.v.ballWorld(), [x, y] = this.px(b.X, b.Y); g.fillStyle = L.mark.replace("A", L.markA); g.beginPath(); g.ellipse(x, y, 1.4, 2.2, 0, 0, 7); g.fill(); }
    this.lastBall = w[0x4B3];
    if (++this.frames % 15 === 0) this.dirty = 1;
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
