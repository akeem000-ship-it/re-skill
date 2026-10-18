// "WEATHER: Clear / Rain / Sunset / Random" (STADIUM menu): the look of a match, nothing in the game changes. Chosen once per match (Random:
// mostly clear, sometimes rain or a sunset).
//   rain    streaks falling over the court, a grey veil, a duller sky for the lighting (lighting.js weatherRain), a soft hiss
//   sunset  the lighting's hour for the match at 18:20 (lighting.js weatherHour: a low warm sun, long shadows)
const KEY = "mt-weather", MODES = ["clear", "rain", "sunset", "random"];

export class Weather {
  constructor(voxel) {
    this.v = voxel; this.mode = (() => { try { const m = localStorage.getItem(KEY); return MODES.includes(m) ? m : "clear"; } catch (e) { return "clear"; } })();
    this.cur = "clear"; this.lastFr = -1; this.tex = null; this.hiss = null;
    const rnd = (() => { let s = 12345; return () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff; })();
    this.drops = Array.from({ length: 260 }, () => ({ x: (rnd() * 2 - 1) * 1700, z: -2500 + rnd() * 4600, y0: rnd() * 1400, sp: 1900 + rnd() * 600 }));
  }
  setMode(m) { this.mode = MODES.includes(m) ? m : "clear"; try { localStorage.setItem(KEY, this.mode); } catch (e) { /* private mode */ } this.lastFr = -1; }
  // per court frame (voxel.js renderCourt, after the lighting pass): a new match picks its weather; rain is drawn
  draw(mvp, m4) {
    const v = this.v, fr = v.gb.ppu.frames, L = v.light;
    if (!v.replaying && (this.lastFr < 0 || fr < this.lastFr || fr - this.lastFr > 600)) {   // (INSTANT REPLAY: the same weather, the match's frames left alone)
      const r = Math.random();
      this.cur = this.mode !== "random" ? this.mode : r < 0.2 ? "rain" : r < 0.4 ? "sunset" : "clear";
    }
    if (!v.replaying) this.lastFr = fr;
    if (v.isDrill && v.isDrill()) { if (L) { L.weatherHour = null; L.weatherRain = false; } this.sound(false); return; }   // the drill hall is indoors
    if (L) { L.weatherHour = this.cur === "sunset" ? 18.3 : null; L.weatherRain = this.cur === "rain"; }
    this.sound(this.cur === "rain");
    if (this.cur !== "rain") return;
    const gl = v.gl; if (!this.tex) this.tex = v.solidTexture([255, 255, 255, 255]);
    gl.useProgram(v.prog); gl.bindVertexArray(v.vao); gl.depthMask(false);
    v.draw(this.tex, m4.trs(0, -1, 0, 2, 2), m4.identity(), [0, 0, 1, 1], [0.42, 0.46, 0.55, 0.22], 0);   // the grey veil
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    const T = performance.now() / 1000;
    for (const d of this.drops) {
      const y = 1400 - ((d.y0 + T * d.sp) % 1400);
      v.draw(this.tex, m4.trs(d.x + y * 0.08, y, d.z, 3.5, 70, 0, 0), mvp, [0, 0, 1, 1], [0.75, 0.8, 0.9, 0.35], 0);
    }
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(true);
  }
  leftCourt() { this.sound(false); if (this.v.light) { this.v.light.weatherHour = null; this.v.light.weatherRain = false; } }
  // a soft rain hiss through the crowd sound's audio (only while it is on)
  sound(on) {
    const snd = this.v.stadium && this.v.stadium.sound, c = on && snd && snd.on ? snd.ctx() : null;
    if (c && !this.hiss) {
      const s = snd.src(c), lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2600; const g = c.createGain(); g.gain.value = 0.06 * snd.volume;
      s.connect(lp); lp.connect(g); g.connect(c.destination); this.hiss = { s, g };
    } else if (!c && this.hiss) { try { this.hiss.s.stop(); } catch (e) { /* stopped */ } this.hiss = null; }
  }
}

export function addWeatherButton(hud, w) {
  if (!hud || !w) return null;
  const b = document.createElement("span"); b.className = "k"; b.id = "weatherbtn"; b.title = "the weather of a match (the look only): clear, rain, a sunset, or random per match";
  const show = () => { b.textContent = "WEATHER: " + w.mode[0].toUpperCase() + w.mode.slice(1); b.classList.toggle("on", w.mode !== "clear"); };
  b.addEventListener("pointerdown", () => { w.setMode(MODES[(MODES.indexOf(w.mode) + 1) % MODES.length]); show(); });
  hud.appendChild(document.createTextNode(" ")); hud.appendChild(b); show(); return b;
}
export function attachWeather(voxel, hud) { const w = voxel.weather = new Weather(voxel); addWeatherButton(hud, w); return w; }
