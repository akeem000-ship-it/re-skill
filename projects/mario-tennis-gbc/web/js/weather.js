// "WEATHER: Clear / Rain / Wet / Wind / Sunset / Random" (STADIUM menu): the look of a match, nothing in the game changes. Chosen once per
// match (Random: mostly clear, sometimes one of the others).
//   rain    streaks falling over the court, a grey veil, a duller sky for the lighting (lighting.js weatherRain), a soft hiss; the court
//           is wet (below) and drops ring the puddles
//   wet     after the rain: no rain, a duller sky, the court darker and glossy with puddles that mirror the sky and the floodlights
//   wind    leaves blown across the court in gusts, tumbling, settling and skidding along, and a low rush of wind
//   sunset  the lighting's hour for the match at 18:20 (lighting.js weatherHour: a low warm sun, long shadows)
const WET_FOR = 300;                                   // seconds the campus keeps puddles after a rainy match (fieldlife.js)
const KEY = "mt-weather", MODES = ["clear", "rain", "wet", "wind", "sunset", "random"];
import { SIDE_IN } from "./stadium3d.js";
const LEAF_COLS = [[0.42, 0.62, 0.20], [0.86, 0.66, 0.16], [0.80, 0.38, 0.14], [0.56, 0.36, 0.18]];

export class Weather {
  constructor(voxel) {
    this.v = voxel; this.mode = (() => { try { const m = localStorage.getItem(KEY); return MODES.includes(m) ? m : "clear"; } catch (e) { return "clear"; } })();
    this.cur = "clear"; this.lastFr = -1; this.tex = null; this.hiss = null;
    const rnd = (() => { let s = 12345; return () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff; })();
    this.drops = Array.from({ length: 260 }, () => ({ x: (rnd() * 2 - 1) * 1700, z: -2500 + rnd() * 4600, y0: rnd() * 1400, sp: 1900 + rnd() * 600 }));
    // puddles on and round the court (x, z, radii), the rings the drops make in them, the leaves (their own phase, speed and colour)
    this.puddles = Array.from({ length: 16 }, () => ({ x: (rnd() * 2 - 1) * 900, z: (rnd() * 2 - 1) * 1700, rx: 70 + rnd() * 150, rz: 40 + rnd() * 80 }));
    this.rings = Array.from({ length: 40 }, () => ({ p: Math.floor(rnd() * 16), dx: rnd() * 2 - 1, dz: rnd() * 2 - 1, ph: rnd() }));
    this.leaves = Array.from({ length: 70 }, () => ({ x: rnd() * 4000, z: -2000 + rnd() * 3800, ph: rnd() * 6.28, sp: 0.6 + rnd() * 0.8, c: LEAF_COLS[Math.floor(rnd() * 4)], s: 34 + rnd() * 18, h: rnd() }));
  }
  // a soft round spot (the puddles, the ripples' rings): white, alpha falling off to the edge (ring: a thin bright band)
  spot(ring) {
    const key = ring ? "ringTex" : "spotTex"; if (this[key]) return this[key];
    const N = 64, d = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const r = Math.hypot(x - N / 2 + 0.5, y - N / 2 + 0.5) / (N / 2), a = ring ? Math.max(0, 1 - Math.abs(r - 0.85) / 0.12) : Math.max(0, Math.min(1, (1 - r) / 0.35));
      d.set([255, 255, 255, Math.round(255 * a)], (y * N + x) * 4);
    }
    return (this[key] = this.v.texture(N, N, d, true));
  }
  setMode(m) { this.mode = MODES.includes(m) ? m : "clear"; try { localStorage.setItem(KEY, this.mode); } catch (e) { /* private mode */ } this.lastFr = -1; }
  // per court frame (voxel.js renderCourt, after the lighting pass): a new match picks its weather; rain is drawn
  draw(mvp, m4) {
    const v = this.v, fr = v.gb.ppu.frames, L = v.light;
    if (!v.replaying && (this.lastFr < 0 || fr < this.lastFr || fr - this.lastFr > 600)) {   // (INSTANT REPLAY: the same weather, the match's frames left alone)
      const r = Math.random();
      this.cur = this.mode !== "random" ? this.mode : r < 0.15 ? "rain" : r < 0.25 ? "wet" : r < 0.4 ? "wind" : r < 0.55 ? "sunset" : "clear";
    }
    if (!v.replaying) this.lastFr = fr;
    if (v.isDrill && v.isDrill()) { if (L) { L.weatherHour = null; L.weatherRain = false; } this.sound(false); return; }   // the drill hall is indoors
    if (L) { L.weatherHour = this.cur === "sunset" ? 18.3 : null; L.weatherRain = this.cur === "rain" || this.cur === "wet"; }
    this.sound(this.cur === "rain" ? "rain" : this.cur === "wind" ? "wind" : false);
    if (this.cur !== "rain" && this.cur !== "wet" && this.cur !== "wind") return;
    const gl = v.gl; if (!this.tex) this.tex = v.solidTexture([255, 255, 255, 255]);
    gl.useProgram(v.prog); gl.bindVertexArray(v.vao); gl.depthMask(false);
    const T = performance.now() / 1000;
    if (this.cur === "wind") { this.drawLeaves(mvp, m4, T); gl.depthMask(true); return; }
    this.drawWet(mvp, m4, T, L); this.wetUntil = T + WET_FOR;     // (FIELD LIFE: puddles on the campus for a while after)
    if (this.cur === "wet") { gl.depthMask(true); return; }
    v.draw(this.tex, m4.trs(0, -1, 0, 2, 2), m4.identity(), [0, 0, 1, 1], [0.42, 0.46, 0.55, 0.22], 0);   // the grey veil
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    for (const d of this.drops) {
      const y = 1400 - ((d.y0 + T * d.sp) % 1400);
      v.draw(this.tex, m4.trs(d.x + y * 0.08, y, d.z, 3.5, 70, 0, 0), mvp, [0, 0, 1, 1], [0.75, 0.8, 0.9, 0.35], 0);
    }
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(true);
  }
  // the wet court: a dark sheen over it, puddles mirroring the sky (bright under the floodlights at night), and in the rain rings
  // spreading where drops land in them
  drawWet(mvp, m4, T, L) {
    const v = this.v, gl = v.gl, night = L && L.cfg && L.cfg.fx && L.cfg.fx.night, flat = -Math.PI / 2;
    v.draw(this.tex, m4.trs(0, 0.7, 0, 2 * SIDE_IN, 4000, flat), mvp, [0, 0, 1, 1], [0.05, 0.08, 0.14, 0.22], 0);
    const spot = this.spot(false), sky = night ? [0.55, 0.6, 0.75] : [0.62, 0.7, 0.82];
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    for (const p of this.puddles) {
      v.draw(spot, m4.trs(p.x, 0.9, p.z, p.rx * 2, p.rz * 2, flat), mvp, [0, 0, 1, 1], [sky[0], sky[1], sky[2], 0.16], 0);
      // a floodlight's glint: a long thin streak down the puddle towards the camera
      if (night) v.draw(spot, m4.trs(p.x + p.rx * 0.2, 1.0, p.z, p.rx * 0.35, p.rz * 1.8, flat), mvp, [0, 0, 1, 1], [1, 0.95, 0.8, 0.22], 0);
    }
    if (this.cur === "rain") {
      const ring = this.spot(true);
      for (const r of this.rings) {
        const u = (T * 1.4 + r.ph) % 1, p = this.puddles[r.p], k = Math.floor(T * 1.4 + r.ph), jx = Math.sin(k * 12.9898 + r.ph * 78.2), jz = Math.sin(k * 39.346 + r.ph * 11.1);
        const x = p.x + (r.dx * 0.5 + jx * 0.5) * p.rx * 0.8, z = p.z + (r.dz * 0.5 + jz * 0.5) * p.rz * 0.8, s = 10 + 60 * u;
        v.draw(ring, m4.trs(x, 1.1, z, s, s * 0.6, flat), mvp, [0, 0, 1, 1], [0.8, 0.85, 0.95, 0.5 * (1 - u)], 0);
      }
    }
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }
  // leaves on the wind: blown across from the left in gusts, fluttering down, then skidding along the court until they blow off the right
  drawLeaves(mvp, m4, T) {
    const v = this.v, gust = 0.6 + 0.4 * Math.sin(T * 0.7) * Math.sin(T * 0.23 + 1);
    for (const f of this.leaves) {
      const t = T * f.sp, x = ((f.x + t * 520 * (0.6 + gust)) % 4000) - 2000, life = (x + 2000) / 4000;
      const fall = Math.max(0, 1 - life * 2.2), y = 4 + 520 * f.h * fall + 30 * Math.sin(t * 3 + f.ph) * fall;
      const z = f.z + 90 * Math.sin(t * 1.3 + f.ph), spin = t * 6 + f.ph, a = Math.min(1, (1 - life) * 6, life * 12);
      v.draw(this.tex, m4.trs(x, y, z, f.s, f.s * (0.35 + 0.65 * Math.abs(Math.sin(spin))), fall > 0 ? Math.sin(spin) * 1.2 : -Math.PI / 2, spin * 0.5), mvp, [0, 0, 1, 1], [f.c[0], f.c[1], f.c[2], a], 0);
    }
  }
  leftCourt() { this.sound(false); if (this.v.light) { this.v.light.weatherHour = null; this.v.light.weatherRain = false; } }
  // a soft rain hiss, or a low rush of wind, through the crowd sound's audio (only while it is on)
  sound(kind) {
    const snd = this.v.stadium && this.v.stadium.sound, c = kind && snd && snd.on ? snd.ctx() : null;
    if (this.hiss && (!c || this.hiss.kind !== kind)) { try { this.hiss.s.stop(); } catch (e) { /* stopped */ } this.hiss = null; }
    if (c && !this.hiss) {
      const s = snd.src(c), lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = kind === "wind" ? 520 : 2600; const g = c.createGain(); g.gain.value = (kind === "wind" ? 0.09 : 0.06) * snd.volume;
      s.connect(lp); lp.connect(g); g.connect(c.destination); this.hiss = { s, g, kind };
    }
  }
}

export function addWeatherButton(hud, w) {
  if (!hud || !w) return null;
  const b = document.createElement("span"); b.className = "k"; b.id = "weatherbtn"; b.title = "the weather of a match (the look only): clear, rain, a wet court after rain, wind with leaves, a sunset, or random per match";
  const show = () => { b.textContent = "WEATHER: " + w.mode[0].toUpperCase() + w.mode.slice(1); b.classList.toggle("on", w.mode !== "clear"); };
  b.addEventListener("pointerdown", () => { w.setMode(MODES[(MODES.indexOf(w.mode) + 1) % MODES.length]); show(); });
  hud.appendChild(document.createTextNode(" ")); hud.appendChild(b); show(); return b;
}
export function attachWeather(voxel, hud) { const w = voxel.weather = new Weather(voxel); addWeatherButton(hud, w); return w; }
