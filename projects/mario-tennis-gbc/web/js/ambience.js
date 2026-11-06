// AMBIENCE (3D stadium, render and sound only): each venue's air and its background sound.
//   particles   soft glowing flakes drawn as camera-facing quads: sea mist rolling across the far end and spray at the island courts;
//               falling leaves in the jungle and fireflies there at dusk and night; embers rising and ash drifting down at Bowser's
//               court; petals at the castle courts; sparkles round the ? blocks; dust motes under the hangar roof; butterflies by day and
//               fireflies at night at the class courts; camera flashes in the city bowl's crowd at night
//   sound       a quiet loop under the crowd (through crowdsound.js's bus, so the venue's echo applies): waves and gulls, birds,
//               the lava's rumble and bubbling, a distant bell, a far-off plane, the city's hum and a horn, a coin's chime
// The particles are a STADIUM EXTRA (venues.js EXTRAS.particles, off): without them only the bursts (bounces, big moments) are drawn.
// Night is the lighting's (lighting.js sky.lamps): fireflies and flashes come out with the floodlights. Nothing in the game is read.
import { EXTRAS } from "./venues.js";
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// kinds of particle: where they start (a box in world units), how they move (velocity, sway), size, colour, life (s), glow (blinking)
const K = {
  mist:    { box: [-2600, 2600, 40, 260, -2700, -1500], v: [60, 0, 0], sway: 20, size: [420, 700], col: [235, 240, 248], a: 0.12, life: 14, n: 18 },
  spray:   { box: [-2400, 2400, 0, 120, -2600, -1900], v: [0, 120, 0], sway: 40, size: [30, 70], col: [240, 250, 255], a: 0.35, life: 1.6, n: 30 },
  leaf:    { box: [-2300, 2300, 500, 900, -2400, 1500], v: [30, -80, 0], sway: 60, size: [14, 22], col: [70, 150, 60], a: 0.95, life: 9, n: 50, solid: true },
  firefly: { box: [-2200, 2200, 60, 500, -2400, 1600], v: [0, 6, 0], sway: 50, size: [14, 20], col: [220, 255, 120], a: 0.95, life: 6, n: 60, blink: true, night: true },
  ember:   { box: [-2400, 2400, 0, 120, -2500, -1800], v: [10, 140, 0], sway: 30, size: [10, 18], col: [255, 150, 50], a: 0.95, life: 4, n: 50 },
  ash:     { box: [-2600, 2600, 700, 1100, -2600, 1800], v: [20, -50, 0], sway: 40, size: [10, 16], col: [90, 86, 90], a: 0.8, life: 16, n: 90, solid: true },
  petal:   { box: [-2300, 2300, 500, 900, -2400, 1500], v: [40, -60, 0], sway: 70, size: [12, 18], col: [255, 170, 210], a: 0.95, life: 10, n: 40, solid: true },
  sparkle: { box: [-2200, 2200, 600, 900, -2600, 1900], v: [0, 0, 0], sway: 0, size: [16, 30], col: [255, 240, 150], a: 0.9, life: 0.8, n: 16, blink: true },
  dust:    { box: [1300, 2200, 100, 800, -1600, 1800], v: [5, 4, 0], sway: 20, size: [6, 10], col: [255, 240, 210], a: 0.5, life: 8, n: 70 },
  butterfly: { box: [-2000, 2000, 80, 500, -2200, 1400], v: [0, 0, 0], sway: 120, size: [16, 22], col: [255, 230, 90], a: 0.95, life: 7, n: 14, solid: true, day: true },
  bat:     { box: [-2400, 2400, 500, 1100, -2600, 1200], v: [0, 0, 0], sway: 260, size: [22, 30], col: [24, 20, 30], a: 0.95, life: 8, n: 26, solid: true, dusk: true },
  snow:    { box: [-2600, 2600, 900, 1300, -2600, 1900], v: [10, -70, 0], sway: 30, size: [10, 16], col: [255, 255, 255], a: 0.9, life: 18, n: 160 },
  flash:   { box: [-2100, 2100, 200, 700, -2500, 1800], v: [0, 0, 0], sway: 0, size: [24, 40], col: [255, 255, 255], a: 1, life: 0.12, n: 6, night: true },
};
const BY_VENUE = { tropics: ["mist", "spray"], jungle: ["leaf", "firefly"], volcano: ["ember", "ash"], castle: ["petal"], pipes: ["sparkle"], hangar: ["dust"],
  city: ["flash"], junior: ["butterfly", "firefly"], senior: ["butterfly"], varsity: [] };

export class Ambience {
  constructor(st) { this.st = st; this.v = st.v; this.parts = []; this.venue = ""; this.snd = null; this.tex = null; this.lastT = 0; this.rnd = mulberry32(77); }
  night() { const L = this.v.light; if (!L || L.broken || !L.active) return 0; const s = L.skyFor ? L.skyFor("court") : null; return s ? s.lamps || 0 : 0; }
  softTex() {
    if (this.tex) return this.tex; const N = 32, d = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const r = Math.hypot(x - N / 2 + 0.5, y - N / 2 + 0.5) / (N / 2), a = clamp(1 - r) ** 1.6, o = (y * N + x) * 4; d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = a * 255; }
    return this.tex = this.v.texture(N, N, d, true);
  }
  solidTex() {
    if (this.tex2) return this.tex2; const N = 8, d = new Uint8Array(N * N * 4).fill(255); return this.tex2 = this.v.texture(N, N, d, false);
  }
  spawn(kind) {
    const k = K[kind], r = this.rnd, b = k.box;
    return { kind, x: b[0] + r() * (b[1] - b[0]), y: b[2] + r() * (b[3] - b[2]), z: b[4] + r() * (b[5] - b[4]), age: -r() * k.life, life: k.life * (0.7 + r() * 0.6),
      s: k.size[0] + r() * (k.size[1] - k.size[0]), ph: r() * 6.28 };
  }
  // per frame while the 3D stadium is drawn: the venue's particles, and its sound
  draw(mvp, T, venue) {
    const v = this.v, gl = v.gl, dt = Math.min(0.1, Math.max(0, T - this.lastT)); this.lastT = T;
    if (!this.watch && typeof setInterval === "function") this.watch = setInterval(() => { if (this.venue && performance.now() / 1000 - this.lastT > 1) this.leave(); }, 1000);   // (the court left, or the 3D view off: quiet)
    if (venue !== this.venue) {                                                    // (venue ":" season: the season's particles too)
      this.venue = venue; this.parts = []; const [ven, season] = venue.split(":"), S = { halloween: ["bat"], winter: ["snow"], spring: ["petal"] }[season] || [];
      for (const kind of EXTRAS.particles ? [...(BY_VENUE[ven] || []), ...S.filter(k => !(BY_VENUE[ven] || []).includes(k))] : []) for (let i = 0; i < K[kind].n; i++) this.parts.push(this.spawn(kind)); this.sound(ven);
    }
    if (this.snd) this.snd.tick(T);
    const nk = this.night(), rx = Math.hypot(mvp[0], mvp[8]) || 1, R = [mvp[0] / rx, 0, mvp[8] / rx], soft = this.softTex(), solid = this.solidTex();
    gl.useProgram(v.prog); gl.bindVertexArray(v.vao); gl.depthMask(false);
    this.drawBursts(mvp, dt, R, soft, solid);
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i], k = K[p.kind];
      p.age += dt; if (p.age > p.life) { this.parts[i] = this.spawn(p.kind); this.parts[i].age = 0; continue; } if (p.age < 0) continue;
      if (k.night) { p.x += Math.sin(T * 1.3 + p.ph) * k.sway * dt; p.y += k.v[1] * dt; continue; }   // (night ones glow: drawGlow)
      const vis = k.day ? clamp(1 - nk * 1.5) : k.dusk ? clamp(0.25 + nk * 1.5) : 1; if (vis <= 0.01) continue;
      p.x += (k.v[0] + Math.sin(T * 1.3 + p.ph) * k.sway) * dt; p.y += k.v[1] * dt; p.z += (k.v[2] + Math.cos(T * 1.1 + p.ph) * k.sway * 0.6) * dt;
      const u = p.age / p.life, fade = clamp(Math.min(u * 5, (1 - u) * 4)), blink = k.blink ? 0.5 + 0.5 * Math.sin(T * 6 + p.ph * 3) : 1, a = k.a * fade * blink * vis;
      if (a < 0.02) continue;
      const s = p.s * (p.kind === "butterfly" || p.kind === "bat" ? 0.6 + 0.4 * Math.abs(Math.sin(T * (p.kind === "bat" ? 18 : 12) + p.ph)) : 1), tex = k.solid ? solid : soft;
      v.draw(tex, new Float32Array([R[0] * s, 0, R[2] * s, 0, 0, s, 0, 0, -R[2], 0, R[0], 0, p.x, p.y - s / 2, p.z, 1]), mvp, [0, 0, 1, 1], [k.col[0] / 255, k.col[1] / 255, k.col[2] / 255, a], 0.01);
    }
    gl.depthMask(true);
  }
  // the ball's bounce, the court's own way (stadium3d.js step): clay dust, grass bits, sparks at Bowser's court, a splash on the island,
  // pink glitter at the castle, a coin's sparkle at the pipe court, leaf bits in the jungle, dust elsewhere
  impact(X, Y, venue, surface) {
    const S = surface === "clay" ? ["clay", [214, 124, 72], 14, 0.9] : surface === "grass" ? ["bits", [96, 164, 64], 10, 0.95] : venue === "volcano" ? ["spark", [255, 170, 60], 14, 1] : venue === "tropics" ? ["splash", [205, 232, 255], 16, 0.9]
      : venue === "castle" ? ["spark", [255, 190, 230], 10, 1] : venue === "pipes" ? ["spark", [255, 220, 80], 10, 1] : venue === "jungle" ? ["bits", [80, 150, 60], 10, 0.95] : ["dust", [226, 222, 214], 10, 0.6];
    const r = this.rnd, B = this.bursts || (this.bursts = []);
    for (let i = 0; i < S[2]; i++) { const a = r() * 6.283, sp = 60 + r() * 160; B.push({ x: X, y: 4, z: Y, vx: Math.cos(a) * sp, vy: 120 + r() * (S[0] === "splash" ? 360 : 220), vz: Math.sin(a) * sp, age: 0, life: 0.45 + r() * 0.4, s: S[0] === "dust" || S[0] === "clay" ? 26 + r() * 30 : 10 + r() * 10, col: S[1], a: S[3], kind: S[0] }); }
    if (B.length > 200) B.splice(0, B.length - 200);
  }
  // a spray of particles (bigmoments.js: an eruption, a splash, coins, smoke): o = { x, y, z, n, sp: [min, max] sideways speed, up: [min, max],
  // col, life, size: [min, max], g: gravity, glow (added light), solid (hard-edged) }
  spray(o) {
    const r = this.rnd, B = this.bursts || (this.bursts = []);
    for (let i = 0; i < o.n; i++) { const a = r() * 6.283, sp = o.sp[0] + r() * (o.sp[1] - o.sp[0]); B.push({ x: o.x, y: o.y, z: o.z, vx: Math.cos(a) * sp, vy: o.up[0] + r() * (o.up[1] - o.up[0]), vz: Math.sin(a) * sp, age: 0, life: o.life * (0.7 + r() * 0.5), s: o.size[0] + r() * (o.size[1] - o.size[0]), col: o.col, a: 0.95, kind: o.solid ? "bits" : o.glow ? "glow" : "puff", g: o.g ?? 900 }); }
    if (B.length > 600) B.splice(0, B.length - 600);
  }
  drawBursts(mvp, dt, R, soft, solid) {
    const v = this.v, B = this.bursts; if (!B || !B.length) return;
    for (const b of B) {
      b.age += dt; if (b.age > b.life) continue; b.x += b.vx * dt; b.z += b.vz * dt; b.y = Math.max(2, b.y + b.vy * dt); b.vy -= (b.g ?? 900) * dt;
      const u = b.age / b.life, a = b.a * (1 - u), s = b.kind === "dust" || b.kind === "clay" || b.kind === "puff" ? b.s * (1 + u * 1.5) : b.s, tex = b.kind === "bits" ? solid : soft, gl = v.gl;
      if (b.kind === "glow") gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      v.draw(tex, new Float32Array([R[0] * s, 0, R[2] * s, 0, 0, s, 0, 0, -R[2], 0, R[0], 0, b.x, b.y - s / 2, b.z, 1]), mvp, [0, 0, 1, 1], [b.col[0] / 255, b.col[1] / 255, b.col[2] / 255, a], 0.01);
      if (b.kind === "glow") gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
    this.bursts = B.filter(b => b.age <= b.life);
  }
  // the night's own lights (fireflies, flashes in the crowd): added over the lit picture (stadium3d.js drawGlow)
  drawGlow(mvp, T, nk, halo) {
    for (const p of this.parts) {
      const k = K[p.kind]; if (!k.night || p.age < 0) continue;
      const u = p.age / p.life, fade = clamp(Math.min(u * 5, (1 - u) * 4)), blink = k.blink ? Math.max(0, Math.sin(T * 4 + p.ph * 3)) : 1, a = k.a * fade * blink * clamp((nk - 0.2) * 2);
      if (a > 0.02) { halo(p.x, p.y, p.z, p.s * 4, k.col, a * 0.7); halo(p.x, p.y, p.z, p.s, [255, 255, 255], a); }
    }
  }
  // ---- the venue's sound: a quiet loop and occasional calls, through the crowd sound's bus (its echo); none while CROWD SOUND is off ----
  sound(venue) {
    if (this.snd) { this.snd.stop(); this.snd = null; }
    const cs = this.st.sound; if (!cs) return;
    this.snd = new VenueSound(cs, venue);
  }
  leave() { if (this.snd) { this.snd.stop(); this.snd = null; } this.venue = ""; this.parts = []; }
}

class VenueSound {
  constructor(cs, venue) { this.cs = cs; this.venue = venue; this.nodes = []; this.next = 0; this.started = false; }
  stop() { for (const n of this.nodes) { try { n.stop ? n.stop() : n.disconnect(); } catch (e) { /* stopped */ } } this.nodes = []; }
  tick(T) {
    const cs = this.cs, c = cs.on && cs.ctx(); if (!c) { if (this.started) { this.stop(); this.started = false; } return; }
    if (!this.started) { this.started = true; this.loop(c); this.next = T + 2; }
    if (T >= this.next) { this.call(c); this.next = T + 4 + Math.random() * 10; }
  }
  out(c, g, keep = true) { const o = c.createGain(); o.gain.value = g * this.cs.volume; o.connect(this.cs.bus(c)); if (keep) this.nodes.push(o); return o; }
  loop(c) {
    const v = this.venue, noise = (f, type, q, g) => { const n = this.cs.src(c), fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const o = this.out(c, g); n.connect(fl); fl.connect(o); this.nodes.push(n); return o; };
    const lfo = (o, rate, depth) => { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = rate; lg.gain.value = depth * o.gain.value; l.connect(lg); lg.connect(o.gain); l.start(); this.nodes.push(l); };
    if (v === "tropics") { const w = noise(700, "lowpass", 0.7, 0.07); lfo(w, 0.11, 0.9); }                                  // waves rolling in
    else if (v === "volcano") { noise(90, "lowpass", 1, 0.12); }                                                              // the lava's rumble
    else if (v === "jungle") noise(5200, "bandpass", 8, 0.008);                                                               // insects
    else if (v === "city") noise(260, "lowpass", 0.7, 0.03);                                                                  // the city's hum
    else if (v === "hangar") { const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.value = 68; const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 240; const g = this.out(c, 0.012); o.connect(f); f.connect(g); o.start(); this.nodes.push(o); lfo(g, 0.05, 0.9); }   // a far-off plane
    else noise(3000, "bandpass", 1, 0.004);                                                                                   // open air
  }
  call(c) {
    const v = this.venue, t = c.currentTime, tone = (f0, f1, dur, type, g, at = 0) => { const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t + at); o.frequency.exponentialRampToValueAtTime(f1, t + at + dur); const e = this.out(c, 0, false); e.gain.setValueAtTime(0, t + at); e.gain.linearRampToValueAtTime(g * this.cs.volume, t + at + 0.01); e.gain.exponentialRampToValueAtTime(0.0005, t + at + dur); o.connect(e); o.start(t + at); o.stop(t + at + dur + 0.05); };
    if (v === "tropics") { tone(1900, 1300, 0.35, "sine", 0.03); tone(2100, 1400, 0.3, "sine", 0.025, 0.45); }               // a gull
    else if (v === "jungle" || v === "junior" || v === "senior" || v === "castle") for (let i = 0; i < 3 + Math.random() * 4; i++) tone(2600 + Math.random() * 1600, 3400 + Math.random() * 1000, 0.07, "sine", 0.02, i * 0.11);   // birdsong
    if (v === "castle" && Math.random() < 0.35) for (const [f, g] of [[392, 0.04], [784, 0.02], [1180, 0.01]]) tone(f, f * 0.995, 3.5, "sine", g);   // a distant bell
    else if (v === "volcano") for (let i = 0; i < 4; i++) tone(140 + Math.random() * 80, 60, 0.18, "sine", 0.05, i * 0.2 + Math.random() * 0.1);   // the lava bubbling
    else if (v === "city" && Math.random() < 0.5) { tone(330, 320, 0.5, "square", 0.006); tone(415, 405, 0.5, "square", 0.005); }   // a horn far off
    else if (v === "pipes") { tone(988, 988, 0.08, "square", 0.012); tone(1319, 1319, 0.4, "square", 0.012, 0.08); }      // a coin's chime
  }
}
