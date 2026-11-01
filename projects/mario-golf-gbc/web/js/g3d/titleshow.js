// TITLE FLY-OVER (3D, render only; adapted from Mario Tennis's titleshow.js): behind PRESS START (the title's TitlePressStartTask 40:4D1D
// runs) the 3D view flies over the courses' holes, one after another: each a hole of a different club (built from the ROM as a round's
// hole is), flown from its tee end to its green at an hour of its own, for SHOT seconds. The title's own picture stays in front: its
// logo, Mario on his rock, PRESS START and the copyright line, with the title's sky and sea (the BG palettes 5 and 6) let through so
// the fly-over shows behind them. Only with the 3D view on; the title waits for START as before and nothing of the game is touched.
import { Golf3D } from "./scene.js";
import { T, CELLS } from "./hole3d.js";

const SHOT = 7;
const HOLES = [0x0A, 0x2E + 4, 0x1C + 2, 0x52, 0x40 + 6, 0x0A + 8, 0x2E + 12, 0x1C + 15, 0x40 + 1, 0x52 + 9];
const HOURS = [9, 15, 12, 18.8, 16.5, 7.5, 13, 17.8, 10.5, 20.5];

export class TitleShow {
  key = "titleshow";
  frame(sc, game) {
    const on = Golf3D.taskOn(game.w, 0x40, 0x4D1D) && !!game.w.vram && (game.w.lcd.lcdc & 0x80);
    if (!on) { if (this.live) this.end(sc); return; }
    if (!this.live) { this.live = true; this.t0 = sc.time; this.k = -1; this.keep = { kind: sc.kind }; }
    const k = Math.floor((sc.time - this.t0) / SHOT);
    if (k !== this.k) this.shot(sc, k, game.w);
    this.title = game.w;
  }
  shot(sc, k, w) {
    this.k = k; const i = k % HOLES.length, hid = HOLES[i];
    sc.course = 1 + ((hid - 0x0A) / 18 | 0);
    sc.buildHole(hid, w);
    // the green's middle and the far end of the playing area from it: the fly-over's line
    const art = sc.hole.art; let gx = 0, gz = 0, n = 0;
    for (let z = 0; z < CELLS; z++) for (let x = 0; x < CELLS; x++) if (art.terrain[z * CELLS + x] === T.GREEN) { gx += x * 2 + 1; gz += z * 2 + 1; n++; }
    if (!n) { gx = 256; gz = 256; n = 1; }
    gx /= n; gz /= n;
    let best = 0, tx = gx, tz = gz;
    for (let z = 0; z < CELLS; z += 2) for (let x = 0; x < CELLS; x += 2) { const t = art.terrain[z * CELLS + x]; if (t === T.OB || t === T.WATER) continue; const d = Math.hypot(x * 2 - gx, z * 2 - gz); if (d > best) { best = d; tx = x * 2; tz = z * 2; } }
    this.line = { tee: [tx, tz], green: [gx, gz] };
    sc.hourOverride = HOURS[i];
    sc.s = { view: 0, hid, air: 0, course: sc.course, ball: [tx, 0, tz], vel: [0, 0, 0], cup: [gx, gz], aim: Math.atan2(gz - tz, gx - tx), scroll: [0, 0], green: [0, 0], golfer: 0, lefty: false, player: 0, club: 0, frame: 0,
      wind: [6, 1], mark: "title", hole: 1, stroke: 0, swing: 0 };
    sc.golferAt = null; sc.golferShown = null; sc.hideBall = true; sc.teeAt = [tx, tz];
    sc.windVec = [3.6 * Math.cos(k), 3.6 * Math.sin(k)];
    this.cam = this.cam || (() => {
      const L = this.line; if (!L) return null;
      const u = Math.min(1, (sc.time - this.t0 - this.k * SHOT) / SHOT), e = u * u * (3 - 2 * u), H = sc.hole.H;
      const x = L.tee[0] + (L.green[0] - L.tee[0]) * (e * 0.85 - 0.08), z = L.tee[1] + (L.green[1] - L.tee[1]) * (e * 0.85 - 0.08);
      const ax = L.tee[0] + (L.green[0] - L.tee[0]) * Math.min(1, e * 0.85 + 0.25), az = L.tee[1] + (L.green[1] - L.tee[1]) * Math.min(1, e * 0.85 + 0.25);
      return { eye: [x, H(x, z) + 34 - 12 * e, z], at: [ax, H(ax, az) + 2, az], fov: 55, rate: 50, snap: u < 0.02 };
    });
    sc.camOverride = this.cam;
  }
  holdsScene() { return !!this.live; }
  end(sc) {
    this.live = false; sc.hourOverride = null; sc.hideBall = false; if (sc.camOverride === this.cam) sc.camOverride = null;
    sc.s = null; sc.hole && (sc.hole.id = -1);
  }
  // the title's picture in front, its sky and sea let through
  drawOverlay(sc) {
    if (!this.live || !this.title || globalThis.__golfAttract) return;   // (MTenn3D's game picker: the fly-over alone, play.js ATTRACT)
    const w = this.title, gl = sc.gl, hud = sc.hud;
    const out = sc.hud.raster(w, () => true, { bg: true, skipPals: new Set([5, 6]) });
    // the sky's own colours (the commonest ones in the top band, all sky) let through where they show round the logo and Mario
    const f = sc.frame2d, cnt = new Map(); if (f) for (const [i0, n] of [[0, 1600], [160 * 108, 640]]) for (let i = i0; i < i0 + n; i++) cnt.set(f[i] & 0xFFFFFF, (cnt.get(f[i] & 0xFFFFFF) || 0) + 1);
    const sky = new Set([...cnt].filter(([, n]) => n > 120).map(([c]) => c));
    for (let i = 0; i < 160 * 144; i++) { const q = i * 4, c = out[q] | out[q + 1] << 8 | out[q + 2] << 16; if (sky.has(c)) out[q + 3] = 0; }
    if (!this.tex) { this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 160, 144, 0, gl.RGBA, gl.UNSIGNED_BYTE, out);
      for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v); }
    else { gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 160, 144, gl.RGBA, gl.UNSIGNED_BYTE, out); }
    const p = sc.P.hud; gl.useProgram(p.p); gl.disable(gl.DEPTH_TEST);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(p.u.uTex, 0);
    const s = Math.min(1, (160 / 144) * sc.canvas.height / sc.canvas.width);   // (a wider picture, VIEW 4:3 / Fill: the title in its middle, unstretched)
    gl.uniform4fv(p.u.uRect, [(1 - s) / 2, 0, s, 1]); gl.uniform1f(p.u.uAlpha, 1);
    gl.bindVertexArray(sc.emptyVao); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.enable(gl.DEPTH_TEST);
  }
}
