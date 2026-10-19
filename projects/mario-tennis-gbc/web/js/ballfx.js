// Ball effects for the 3D / VOX court ("BALL FX: on / off"). A render-time layer: it only READS the game (ball position, velocity,
// spin, shot type, the hit / bounce / net bytes) and draws extra things over the finished scene; it never writes game state, so frame
// hashes and replays are untouched. What it adds:
//   trail      a ribbon behind fast balls, coloured by the shot (topspin amber, slice cyan, flat white, lob green, drop pink, smash red;
//              power shots hotter and wider), restarting at every hit
//   spin       a seam that sweeps over the ball face at a rate set by the spin (direction by top / back spin, tilted by side spin)
//              and a small highlight that makes the flat sprite read as a ball
//   squash     the ball stretches along its flight at speed and just after a hit, and squashes against the court on a bounce
//   dust       a ring on the court and puffs (clay: soft orange clouds, grass: green flecks and a few puffs, hard: small pale puffs and
//              specks), coloured from the court under the ball
//   impact     a flare, a glow, a ring and spark streaks at the racket contact; power shots and smashes are bigger with a second burst
//   net        the net rocks when the ball hits it and flutters when the ball clips the tape (wBallNetHit / wBallNetCross)
//   shadow     the ball's shadow is wide, pale and soft high up and shrinks to a small dark crisp one at the court
//   speed      a power shot, a smash or a special shot puts its speed up for a moment ("142 km/h"), read two frames after the contact
//              (the launch speed): 1 world unit is 23.77 m / 2496 of the court, and the game's ball flies at a little over half the
//              pace of a real one, so the reading is scaled by 1.8 to feel like the shot looks (power serves near 215, power drives 120)
// Everything is drawn in the scene (before the HUD, and before lighting.js's resolve when LIGHT is on), additive effects are overbright
// so the lighting layer's bloom picks them up, and lights() hands the lighting layer a point light for strong impacts.
// The game state is read once per game frame (step(), called from Voxel3D.tick()); the drawing is a function of the display time
// (game frame + alpha), so it is smooth at 120 Hz and identical with SMOOTH off.
//
// Enhanced physics later: the effects are driven by ONE plain sample per game frame (readGame() below: position, velocity, spin,
// shot, the hit / bounce / net flags). A different physics source only has to call ingest(sample) with the same fields (spin as
// top / side numbers is enough; a real spin vector can be added as sample.spinVec) instead of reading the game's bytes.
const KEY = "mt-ballfx";
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const WHITE = [1, 1, 0.92];
const R_BALL = 24;                       // world units: the ball sprite is about 5 px of 7.5 units
const KMH = 60 * 3.6 * 23.77 / 2496 * 1.8;   // km/h per world unit per frame (scaled: see "speed")

// shot colours by wShotType (wC4A0): 0 top 1 power top 2 slice 3 power slice 4 flat A+B 5 low volley 6 / 7 / 8 volleys 9 smash 10 lob 11 drop 12 / 13 / 14 serves
const SHOT = {
  0: { c: [1.0, 0.64, 0.20], n: "topspin" }, 1: { c: [1.0, 0.36, 0.12], n: "power topspin" }, 2: { c: [0.30, 0.86, 1.0], n: "slice" }, 3: { c: [0.46, 0.60, 1.0], n: "power slice" },
  4: { c: [1.0, 0.96, 0.72], n: "flat" }, 5: { c: [1.0, 0.96, 0.72], n: "low volley" }, 6: { c: [1.0, 0.72, 0.30], n: "volley" }, 7: { c: [0.40, 0.88, 1.0], n: "volley slice" }, 8: { c: [1.0, 0.96, 0.72], n: "flat volley" },
  9: { c: [1.0, 0.18, 0.30], n: "smash" }, 10: { c: [0.52, 1.0, 0.46], n: "lob" }, 11: { c: [1.0, 0.58, 0.86], n: "drop" },
  12: { c: [1.0, 0.82, 0.30], n: "serve" }, 13: { c: [0.30, 0.86, 1.0], n: "slice serve" }, 14: { c: [1.0, 0.96, 0.72], n: "flat serve" },
};
const shotInfo = t => SHOT[t] || SHOT[4];

const VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec4 aUVK; layout(location=2) in vec4 aCol;
uniform mat4 uMVP; out vec4 vUVK; out vec4 vCol;
void main() { vUVK = aUVK; vCol = aCol; gl_Position = uMVP * vec4(aPos, 1.0); }`;
// kinds: 0 glow, 1 puff, 2 flare, 3 ring (p = inner radius), 4 spark streak, 5 trail ribbon, 6 ball seam + highlight (p = phase), 7 shadow (p = edge softness)
// vCol.a > 0: normal blending with that opacity; vCol.a = 0: additive (colour already scaled, may exceed 1 for the bloom)
const FS = `#version 300 es
precision mediump float; in vec4 vUVK; in vec4 vCol; out vec4 o;
void main() {
  vec2 q = vUVK.xy; float k = vUVK.z, p = vUVK.w, r = length(q), a = 0.0;
  if (k < 0.5) { a = r >= 1.0 ? 0.0 : pow(1.0 - r * r, 2.0); }
  else if (k < 1.5) { a = 1.0 - smoothstep(0.35, 1.0, r); a *= a; }
  else if (k < 2.5) {
    float g = pow(max(1.0 - r, 0.0), 3.0);
    float cx = exp(-abs(q.x) * 16.0) * max(1.0 - abs(q.y), 0.0) + exp(-abs(q.y) * 16.0) * max(1.0 - abs(q.x), 0.0);
    vec2 d = vec2(q.x + q.y, q.x - q.y) * 0.7071;
    float cd = (exp(-abs(d.x) * 24.0) * max(1.0 - abs(d.y), 0.0) + exp(-abs(d.y) * 24.0) * max(1.0 - abs(d.x), 0.0)) * 0.4;
    a = clamp(g * 1.3 + cx + cd, 0.0, 1.0);
  }
  else if (k < 3.5) { float t = max(1.0 - p, 0.02); a = r > 1.0 ? 0.0 : clamp(1.0 - abs(r - (1.0 - 0.5 * t)) / (0.5 * t), 0.0, 1.0); a = a * a * (3.0 - 2.0 * a); }
  else if (k < 4.5) { a = pow(smoothstep(-1.0, 1.0, q.x), 1.4) * pow(max(1.0 - abs(q.y), 0.0), 1.5); }
  else if (k < 5.5) { a = 1.0 - smoothstep(0.15, 1.0, abs(q.y)); }
  else if (k < 6.5) {
    if (r < 1.0) {
      float cy = sqrt(max(1.0 - q.y * q.y, 0.0001)), lon = asin(clamp(q.x / cy, -1.0, 1.0)) + p * 6.2831853, lat = asin(q.y);
      float seam = abs(sin(lon + 0.9 * sin(lat * 2.0))), limb = sqrt(1.0 - r * r);
      float s = (1.0 - smoothstep(0.0, 0.30, seam)) * smoothstep(0.0, 0.45, limb);
      float g = exp(-length(q - vec2(-0.32, 0.42)) * 6.5);
      a = max(s * 0.92, g * 0.85);
    }
  }
  else { a = 1.0 - smoothstep(1.0 - p, 1.0, r); }
  if (vCol.a > 0.0) o = vec4(vCol.rgb * vCol.a * a, vCol.a * a); else o = vec4(vCol.rgb * a, 0.0);
}`;

const mul4 = (a, b) => { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; };
// stretch by kd along the unit vector d and kp across it, about the point c
const squashAbout = (c, d, kd, kp) => {
  const A = [0, 0, 0, 0, 0, 0, 0, 0, 0]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) A[j * 3 + i] = (i === j ? kp : 0) + (kd - kp) * d[i] * d[j];   // column j, row i
  const ac = [0, 1, 2].map(i => A[i] * c[0] + A[3 + i] * c[1] + A[6 + i] * c[2]);
  return new Float32Array([A[0], A[1], A[2], 0, A[3], A[4], A[5], 0, A[6], A[7], A[8], 0, c[0] - ac[0], c[1] - ac[1], c[2] - ac[2], 1]);
};

export class BallFX {
  constructor(vox) {
    this.v = vox; this.on = true; this.onChange = null;
    this.parts = []; this.hits = []; this.bounces = []; this.net = null; this.shot = { type: 4, c: shotInfo(4).c, power: 0 };
    this.sq = null; this.cut = -1; this.phase = 0; this.rate = 0; this.T = 0; this.lastFr = -99; this.prev = null; this.ball = null;
    this.rnd = 1; this.surface = { kind: "hard", c: [0.78, 0.82, 0.86], at: -1 };
    this.gl = null; this.stats = { ms: 0, quads: 0 }; this.k = { R: 1, w: 1, front: 2.2, depth: true, size: 1.6, alpha: 1.35 };   // tuning knobs (tests)
    this.buf = new Float32Array(11 * 6 * 700);
  }
  setOn(on) { this.on = !!on; try { localStorage.setItem(KEY, this.on ? "on" : "off"); } catch (e) { /* private mode */ } if (this.onChange) this.onChange(this.on); }
  reset() { this.parts.length = 0; this.hits.length = 0; this.bounces.length = 0; this.net = null; this.sq = null; this.prev = null; this.cut = -1; this.ball = null; }
  // the speed tag over the 3D view: a short-lived label under the scoreboard, in the shot's colour
  showSpeed(kmh, c) {
    if (typeof document === "undefined" || !this.v || !this.v.cv) return;
    let e = this.tag;
    if (!e) {
      e = this.tag = document.createElement("div");
      e.style.cssText = "position:fixed;z-index:7;pointer-events:none;font:italic 700 22px Itim,system-ui,sans-serif;color:#fff;padding:2px 14px 2px 10px;border-radius:4px;transform:skewX(-12deg);transition:opacity .5s;opacity:0;text-shadow:0 2px 0 #000";
      document.body.appendChild(e);
    }
    const r = this.v.cv.getBoundingClientRect(), col = `rgb(${c.map(x => Math.round(x * 200)).join(",")})`;
    e.textContent = kmh + " km/h"; e.style.background = `linear-gradient(90deg, ${col}, rgba(0,0,0,.55))`;
    e.style.left = Math.round(r.left + r.width * 0.06) + "px"; e.style.top = Math.round(r.top + r.height * 0.2) + "px";
    e.style.transition = "none"; e.style.opacity = "1"; void e.offsetWidth; e.style.transition = "opacity .5s";
    clearTimeout(this.tagT); this.tagT = setTimeout(() => { e.style.opacity = "0"; }, 1400);
  }
  rand() { this.rnd = (this.rnd * 1664525 + 1013904223) >>> 0; return this.rnd / 4294967296; }

  // ---------------- reading the game, once per game frame ----------------
  readGame() {
    const v = this.v, w = v.gb.mem.wram[0], hist = v.ballHist, cur = hist && hist[hist.length - 1];
    if (!cur) return null;
    const s16 = a => (w[a] | (w[a + 1] << 8)) << 16 >> 16, s24 = a => ((w[a] | (w[a + 1] << 8) | (w[a + 2] << 16)) << 8 >> 8) / 65536;
    const b = cur.ball, spd = (w[0x42C] | (w[0x42D] << 8)) / 256;
    return {
      fr: cur.fr, X: b.X, Y: b.Y, Z: b.Z,                                           // 16.16 world position (Z negative = up)
      vx: s24(0x420), vy: s24(0x423), vz: s24(0x426), spd,                          // units per frame (vz positive = down)
      top: s16(0x41C), side: s16(0x41E),                                            // topspin (negative = backspin) and sidespin
      type: w[0x4A0], power: w[0x4A6], hitCount: w[0x4B6], timers: [w[0x4A8], w[0x4A9], w[0x4AA]],
      bounce: w[0x4B3] === 1, netCross: w[0x4B4] === 1, netHit: w[0x4BF] === 1,
      active: spd > 0.5 && !(b.X === 896 && b.Y === 0 && b.Z === 0) && w[0x32E] <= 15,
      mapId: w[0x32E],
    };
  }
  // per game frame (Voxel3D.tick): turns the sample into events
  step(v) {
    if (!this.on) { if (this.parts.length || this.hits.length) this.reset(); return; }
    this.v = v; const s = this.readGame(); if (s) this.ingest(s);
  }
  ingest(s) {
    const p = this.prev, fr = s.fr, cont = p && fr === p.fr + 1;
    this.prev = s;
    if (!s.active) { this.cut = fr; this.sq = null; this.rate = 0; this.vel = null; this.age(fr); return; }
    if (!cont || !p.active) { this.cut = fr; this.sq = null; }                   // the first sample, skipped frames, a new ball: no events from this one
    const q = cont ? p : null; this.lastFr = fr;     // the previous sample, for the edges (the serve toss is a ball that was not active yet)
    const pos = { x: s.X, y: -s.Z, z: s.Y }, vw = [s.vx, -s.vz, s.vy], sp = Math.hypot(...vw);
    this.vel = vw; this.spd = Math.max(s.spd, sp);
    // spin: the seam's rate follows the spin amount, its direction top / back spin; the tilt follows sidespin
    const topN = clamp(Math.abs(s.top) / 3700), sideN = clamp(Math.abs(s.side) / 1400);
    this.rate = (s.top >= 0 ? 1 : -1) * (0.010 + 0.060 * clamp(topN + 0.5 * sideN)); this.phase += this.rate; this.tilt = clamp(s.side / 1500, -1, 1) * 0.9;
    // hit: the hit counter went up or the hit-spark timer restarted (the game starts it at the racket contact)
    const hitNow = (q && ((s.hitCount !== q.hitCount && s.hitCount > 0) || s.timers[1] > q.timers[1])), special = q && s.timers[2] > q.timers[2];
    if (hitNow && fr - (this.lastHit || -99) > 5) {
      this.lastHit = fr; const info = shotInfo(s.type), power = s.power || s.type === 9 ? 1 : 0;
      const str = clamp(0.25 + 0.55 * clamp(this.spd / 36) + 0.25 * power + (special ? 0.25 : 0) + (s.type === 9 ? 0.2 : 0)) * (s.type === 10 || s.type === 11 ? 0.7 : 1);
      this.shot = { type: s.type, c: info.c, power: power || (special ? 1 : 0) };
      const dir = this.norm(vw, [0, 0, -1]); this.cut = fr; this.sq = { kind: "hit", fr, str, d: dir };
      const h = { fr, pos: { ...pos }, str, dir, c: info.c, power: this.shot.power, smash: s.type === 9 }; this.hits.push(h); if (this.hits.length > 6) this.hits.shift();
      this.spawnHit(h);
      if (this.shot.power) this.speedAt = fr + 2;
    }
    if (this.speedAt && fr >= this.speedAt) { this.speedAt = 0; this.showSpeed(Math.round(sp * KMH / 5) * 5, this.shot.c); }
    if (s.bounce && !(q && q.bounce)) {
      const impact = clamp(Math.abs(q ? q.vz : s.vz) / 14), str = clamp(0.2 + 0.5 * impact + 0.4 * clamp(this.spd / 34));
      const b = { fr, pos: { x: s.X, y: 0, z: s.Y }, str }; this.bounces.push(b); if (this.bounces.length > 6) this.bounces.shift();
      this.sq = { kind: "bounce", fr, str: clamp(0.25 + 0.75 * impact * (0.5 + 0.5 * clamp(this.spd / 24))), d: [0, 1, 0] };
      this.spawnBounce(b, s);
    }
    // the net: wBallNetHit (the game's own test: the ball met the net and was thrown back), or the ball crossing it within a tape's
    // width above the tape (wBallNetCross with the height at the crossing): the net rocks, the tape flicks a spark
    if (s.netHit && !(q && q.netHit) || (s.netCross && !(q && q.netCross))) {
      const hitNet = s.netHit, h = -s.Z, near = !hitNet && h > 96 && h < 124;
      if (hitNet || near) {
        const str = (hitNet ? 1 : 0.35 * (1 - (h - 96) / 40) + 0.12) * clamp(0.35 + this.spd / 26, 0.35, 1.2);
        this.net = { fr, str, x: s.X, side: s.X >= 0 ? 1 : -1 };
        this.spawnNet({ x: s.X, y: Math.max(h, 40), z: 0 }, str, hitNet);
        if (hitNet) { this.sq = { kind: "hit", fr, str: 0.5, d: this.norm(vw, [0, 0, 1]) }; this.cut = fr; }
      }
    }
    this.age(fr);
  }
  norm(v, fb) { const l = Math.hypot(v[0], v[1], v[2]); return l > 1e-3 ? [v[0] / l, v[1] / l, v[2] / l] : fb; }
  age(fr) {
    this.parts = this.parts.filter(p => fr - p.t0 < p.life + 2);
    this.hits = this.hits.filter(h => fr - h.fr < 40); this.bounces = this.bounces.filter(b => fr - b.fr < 40);
    if (this.net && fr - this.net.fr > 70) this.net = null;
    if (this.sq && fr - this.sq.fr > 14) this.sq = null;
  }

  // ---------------- spawning (positions are analytic in the age, so any display time works) ----------------
  add(p) { if (this.parts.length > 420) this.parts.shift(); this.parts.push(p); }
  spawnHit(h) {
    const t0 = h.fr - 1, S = h.str, c = h.c, big = h.power || h.smash, R = this.rand.bind(this);
    const hot = mix3(c, WHITE, 0.55);
    // short and small: a flare that peaks within a frame or two and is gone after about 4 game frames (6 for power shots and smashes),
    // a thin ring, short sparks; nothing here may hide the hitter (see occlusion() in draw)
    const L = big ? 6 : 3.6;
    this.add({ k: 2, add: true, t0, life: L, pos: h.pos, s0: 15 + 20 * S, s1: 37 + 50 * S, c: mix3(WHITE, c, 0.3), a: 1.5 });
    this.add({ k: 0, add: true, t0, life: L, pos: h.pos, s0: 22 + 30 * S, s1: 40 + 63 * S, c, a: 0.6 });
    this.add({ k: 3, add: true, t0, life: big ? 7 : 5, pos: h.pos, s0: 8, s1: 30 + 50 * S, p: 0.93, c: hot, a: 0.75 });
    if (big) {
      this.add({ k: 2, add: true, t0: t0 + 0.5, life: 6, pos: h.pos, s0: 24, s1: 90 + (h.smash ? 35 : 0), c, a: 1.2, rot: 0.785 });
      this.add({ k: 3, add: true, t0: t0 + 0.5, life: 7, pos: h.pos, s0: 16, s1: 80 + (h.smash ? 30 : 0), p: 0.95, c, a: 0.6 });
    }
    const n = Math.round(5 + 5 * S + (big ? 5 : 0));
    for (let i = 0; i < n; i++) {                    // spark streaks: out of the contact, along the shot more than against it
      const th = R() * 6.2832, ph = Math.acos(2 * R() - 1), dir = [Math.sin(ph) * Math.cos(th), Math.sin(ph) * Math.sin(th), Math.cos(ph)];
      const bias = 0.55 + 0.6 * R(), sp = (6 + 10 * R()) * (0.6 + 0.6 * S) * (big ? 1.2 : 1);
      const d = this.norm([dir[0] + h.dir[0] * bias, dir[1] + h.dir[1] * bias + 0.12, dir[2] + h.dir[2] * bias], dir);
      this.add({ k: 4, add: true, streak: true, t0, life: 3.5 + 3 * R() + (big ? 1.5 : 0), pos: h.pos, v: d.map(x => x * sp), drag: 0.18, g: 0.3, s0: 1.8 + 2 * S, c: R() < 0.35 ? mix3(c, WHITE, 0.7) : mix3(c, WHITE, 0.25), a: 1.5, len: 1.2 });
    }
  }
  spawnBounce(b, s) {
    const t0 = b.fr - 1, S = b.str, R = this.rand.bind(this), sf = this.surfaceAt(b.pos.x, b.pos.z), dc = sf.c, kind = sf.kind;
    this.add({ k: 3, add: false, flat: true, t0, life: 13 + 5 * S, pos: b.pos, s0: 12, s1: 40 + 70 * S, p: 0.72, c: mix3(dc, WHITE, 0.55), a: 0.5 * (0.5 + S) });
    if (S < 0.16) return;
    const mk = (n, f) => { for (let i = 0; i < n; i++) { const th = R() * 6.2832; f(i, th, Math.cos(th), Math.sin(th)); } };
    if (kind === "clay") {
      mk(Math.round(5 + 7 * S), (i, th, cx, sz) => { const sp = 0.8 + 2.6 * R() * (0.5 + S); this.add({ k: 1, t0, life: 24 + 14 * R(), pos: { x: b.pos.x + cx * 6, y: 4, z: b.pos.z + sz * 6 }, v: [cx * sp, 1.4 + 2.2 * R() * (0.4 + S), sz * sp * 0.8], drag: 0.085, g: -0.02, s0: 12 + 8 * R(), s1: 36 + 34 * S * (0.5 + R()), c: mix3(dc, [0.62, 0.30, 0.16], 0.25), a: 0.55 * (0.55 + 0.45 * S) }); });
    } else if (kind === "grass") {
      const gr = [0.34, 0.68, 0.22];
      mk(Math.round(6 + 8 * S), (i, th, cx, sz) => { const sp = 2 + 4.5 * R() * (0.5 + S); this.add({ k: 1, t0, life: 13 + 10 * R(), pos: { x: b.pos.x + cx * 5, y: 3, z: b.pos.z + sz * 5 }, v: [cx * sp, 5 + 6 * R() * (0.4 + S), sz * sp * 0.8], drag: 0.05, g: 0.55, s0: 6 + 3 * R(), s1: 5 + 2 * R(), c: R() < 0.3 ? [0.9, 0.95, 0.55] : mix3(gr, dc, 0.3), a: 0.95 }); });
      mk(3, (i, th, cx, sz) => this.add({ k: 1, t0, life: 16, pos: { x: b.pos.x, y: 5, z: b.pos.z }, v: [cx * 1.4, 1.4, sz * 1.1], drag: 0.1, g: 0, s0: 10, s1: 30 + 20 * S, c: mix3(dc, WHITE, 0.45), a: 0.32 }));
    } else {
      mk(Math.round(4 + 5 * S), (i, th, cx, sz) => { const sp = 1.6 + 3.2 * R() * (0.5 + S); this.add({ k: 1, t0, life: 12 + 7 * R(), pos: { x: b.pos.x + cx * 5, y: 3, z: b.pos.z + sz * 5 }, v: [cx * sp, 0.8 + 1.4 * R(), sz * sp * 0.8], drag: 0.11, g: 0, s0: 9 + 4 * R(), s1: 22 + 20 * S * (0.5 + R()), c: mix3(dc, WHITE, 0.5), a: 0.42 * (0.6 + 0.4 * S) }); });
      mk(Math.round(3 + 4 * S), (i, th, cx, sz) => { const sp = 5 + 8 * R() * (0.5 + S); this.add({ k: 0, add: true, t0, life: 7 + 4 * R(), pos: { x: b.pos.x, y: 4, z: b.pos.z }, v: [cx * sp, 3 + 5 * R(), sz * sp * 0.8], drag: 0.12, g: 0.5, s0: 5, s1: 2, c: [1.2, 1.2, 1.1], a: 1 }); });
    }
  }
  spawnNet(p, S, hitNet) {
    const t0 = this.net.fr - 1, R = this.rand.bind(this);
    this.add({ k: 2, add: true, t0, life: 4, pos: p, s0: 14, s1: 30 + 30 * S, c: [1.0, 0.98, 0.9], a: 1.5 });
    for (let i = 0; i < Math.round(4 + 6 * S); i++) { const th = R() * 6.2832; this.add({ k: 4, add: true, streak: true, t0, life: 4 + 3 * R(), pos: p, v: [Math.cos(th) * (3 + 6 * R()), 1.5 + 4 * R(), Math.sin(th) * (2 + 4 * R())], drag: 0.18, g: 0.4, s0: 2, c: [1.0, 0.96, 0.8], a: 1.4, len: 1.5 }); }
    if (hitNet) this.add({ k: 3, add: true, t0, life: 6, pos: p, s0: 10, s1: 55, p: 0.93, c: [1, 1, 0.9], a: 0.7 });
  }
  // the court colour under a point (voxel.js groundColour), and the surface type: clay / grass / hard by the map, else by the colour
  surfaceAt(X, Y) {
    const s = this.surface, v = this.v, fr = this.lastFr; if (s.at >= 0 && fr - s.at < 90 && Math.abs(X - s.x) < 500 && Math.abs(Y - s.y) < 500) return s;
    let c = v.groundColour ? v.groundColour(X, Y) : null; if (!c) c = s.c;
    const w = v.gb.mem.wram[0], map = w[0x32E]; let kind = map === 4 ? "clay" : map === 2 ? "grass" : map === 5 ? "hard" : null;
    if (!kind) kind = (c[1] > c[0] * 1.12 && c[1] > c[2] * 1.12) ? "grass" : (c[0] > c[1] * 1.25 && c[0] > c[2] * 1.5) ? "clay" : "hard";
    s.kind = kind; s.c = c.map(x => clamp(x * 1.1 + 0.04)); s.at = fr; s.x = X; s.y = Y; return s;
  }

  // ---------------- per render ----------------
  // the display time in game frames: between the last two game frames by alpha (the same interpolation the sprites use)
  time() { const v = this.v; return v.lastFrame - (v.prev && v.prev !== v.cur ? 1 - v.alpha : 0); }
  frameAge(fr, T = this.T) { return T - (fr - 1); }
  // the ball drawn this frame, set by voxel.js where it draws the ball sprite (null = no ball on screen)
  setBall(b) { this.ball = b ? { x: b.X, y: -b.Z, z: b.Y, h: Math.max(0, -b.Z) } : null; this.T = this.time(); }

  // extra transform for the ball body (squash and stretch), or null
  ballPost() {
    if (!this.on || !this.ball || !this.vel) return null;
    const b = this.ball, T = this.T, sp = this.spd || 0; let M = null;
    const vd = this.norm(this.vel, [0, 0, 1]);
    let kd = 1 + 0.32 * sstep(12, 40, sp);
    const sq = this.sq;
    if (sq && sq.kind === "hit") { const a = this.frameAge(sq.fr, T); if (a >= 0 && a < 12) kd += 0.55 * sq.str * Math.exp(-a / 3.2); }
    if (kd > 1.01) M = squashAbout([b.x, b.y, b.z], vd, kd, 1 / Math.sqrt(kd));
    if (sq && sq.kind === "bounce") {
      const a = this.frameAge(sq.fr, T);
      if (a >= 0 && a < 14) { const ky = 1 - 0.42 * sq.str * Math.exp(-a / 2.4) * Math.cos(a * 0.75), kxz = 1 / Math.sqrt(Math.max(ky, 0.3)); const B = squashAbout([b.x, 0, b.z], [0, 1, 0], ky, kxz); M = M ? mul4(B, M) : B; }
    }
    return M;
  }
  // net transform (sway at the top, a small flutter in height), or null
  netPost(c) {
    const n = this.net; if (!this.on || !n) return null;
    const a = this.frameAge(n.fr); if (a < 0 || a > 66) return null;
    const env = Math.exp(-a / 15) * n.str, sx = 0.42 * env * Math.sin(a * 0.72) * n.side, ky = 1 + 0.07 * env * Math.cos(a * 1.1 + 0.6), sz = 0.32 * env * Math.sin(a * 0.72 + 0.4);
    if (Math.abs(sx) + Math.abs(ky - 1) + Math.abs(sz) < 0.002) return null;
    return new Float32Array([1, 0, 0, 0, sx, ky, sz, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }
  // point lights for strong impacts (lighting.js adds them to its list): [{p: [x, y, z], r, c}]
  lights() {
    const out = []; if (!this.on) return out;
    for (const h of this.hits) { const a = this.frameAge(h.fr); if (a < 0 || a > 5 || h.str < 0.5) continue; const k = 0.6 * h.str * Math.pow(1 - a / 5, 2); out.push({ p: [h.pos.x, h.pos.y + 20, h.pos.z], r: 330 + 380 * h.str, c: h.c.map(x => x * k) }); }
    return out.slice(-2);
  }

  // ---------------- drawing ----------------
  init() {
    const gl = this.v.gl; this.gl = gl;
    const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.prog = p; this.uMVP = gl.getUniformLocation(p, "uMVP");
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao); this.vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.buf.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 44, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 44, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 44, 28);
    gl.bindVertexArray(null);
  }
  // camera basis from the view-projection: screen right, screen up and the direction towards the viewer, in world space
  basis(m) {
    const r0 = [m[0], m[4], m[8]], r1 = [m[1], m[5], m[9]], r3 = [m[3], m[7], m[11]], cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const nz = a => this.norm(a, [1, 0, 0]), d = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let right = nz(cr(r1, r3)); if (d(right, r0) < 0) right = right.map(x => -x);
    let up = nz(cr(r3, r0)); if (d(up, r1) < 0) up = up.map(x => -x);
    // the eye: where clip x, y and w are all zero
    const A = [r0, r1, r3], bb = [-m[12], -m[13], -m[15]], det3 = M => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    const D = det3(A); let eye = null;
    if (Math.abs(D) > 1e-9) eye = [0, 1, 2].map(i => det3(A.map((row, r) => row.map((x, c) => c === i ? bb[r] : x))) / D);
    return { right, up, toward: nz(r3).map(x => -x), eye };
  }
  // ---- vertex emitters ----
  vert(x, y, z, u, vv, k, p, col) { const b = this.buf, o = this.n * 11; if (o + 11 > b.length) return; b[o] = x; b[o + 1] = y; b[o + 2] = z; b[o + 3] = u; b[o + 4] = vv; b[o + 5] = k; b[o + 6] = p; b[o + 7] = col[0]; b[o + 8] = col[1]; b[o + 9] = col[2]; b[o + 10] = col[3]; this.n++; }
  // a quad spanned by the axes ax, ay (world vectors, half extents) round the centre c
  quad(c, ax, ay, k, p, col) {
    const P = (sx, sy) => [c[0] + ax[0] * sx + ay[0] * sy, c[1] + ax[1] * sx + ay[1] * sy, c[2] + ax[2] * sx + ay[2] * sy];
    const a = P(-1, -1), b = P(1, -1), d = P(1, 1), e = P(-1, 1);
    this.vert(...a, -1, -1, k, p, col); this.vert(...b, 1, -1, k, p, col); this.vert(...d, 1, 1, k, p, col);
    this.vert(...a, -1, -1, k, p, col); this.vert(...d, 1, 1, k, p, col); this.vert(...e, -1, 1, k, p, col);
  }
  billboard(c, size, k, p, col, rot = 0) {
    const B = this.B; let rx = B.right, uy = B.up;
    if (rot) { const cs = Math.cos(rot), sn = Math.sin(rot); rx = B.right.map((x, i) => x * cs + B.up[i] * sn); uy = B.up.map((x, i) => x * cs - B.right[i] * sn); }
    this.quad(c, rx.map(x => x * size), uy.map(x => x * size), k, p, col);
  }
  flat(c, rx, rz, k, p, col) { this.quad(c, [rx, 0, 0], [0, 0, rz], k, p, col); }
  // a ribbon from p0 to p1, widths w0 / w1 (half), colours c0 / c1 ([r, g, b, a]); u runs tail (-1) to head (+1) in the streak kind
  ribbon(p0, p1, w0, w1, c0, c1, k) {
    const B = this.B, d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], dr = d[0] * B.right[0] + d[1] * B.right[1] + d[2] * B.right[2], du = d[0] * B.up[0] + d[1] * B.up[1] + d[2] * B.up[2];
    const l = Math.hypot(dr, du) || 1, nr = -du / l, nu = dr / l, px = B.right[0] * nr + B.up[0] * nu, py = B.right[1] * nr + B.up[1] * nu, pz = B.right[2] * nr + B.up[2] * nu;
    const a = [p0[0] - px * w0, p0[1] - py * w0, p0[2] - pz * w0], b = [p0[0] + px * w0, p0[1] + py * w0, p0[2] + pz * w0], c = [p1[0] + px * w1, p1[1] + py * w1, p1[2] + pz * w1], e = [p1[0] - px * w1, p1[1] - py * w1, p1[2] - pz * w1];
    this.vert(...a, -1, -1, k, 0, c0); this.vert(...b, -1, 1, k, 0, c0); this.vert(...c, 1, 1, k, 0, c1);
    this.vert(...a, -1, -1, k, 0, c0); this.vert(...c, 1, 1, k, 0, c1); this.vert(...e, 1, -1, k, 0, c1);
  }

  // the players' bodies as screen-plane ellipses (centre in world space), from the interpolated player positions
  bodies() {
    const v = this.v, out = []; let pl = null; try { pl = v.interp().players; } catch (e) { return out; }
    for (const q of pl || []) out.push([q.X, -q.Z + 85, q.Y]);
    return out;
  }
  // 0..1: how much of an additive glow at (x, y, z) of size s may show: none over a character's body, full once clear of it
  occlusion(PL, x, y, z, s) {
    const B = this.B; let m = 1;
    for (const c of PL) {
      const dx = x - c[0], dy = y - c[1], dz = z - c[2], dr = dx * B.right[0] + dy * B.right[1] + dz * B.right[2], du = dx * B.up[0] + dy * B.up[1] + dz * B.up[2];
      const e = Math.hypot(dr / (62 + 0.35 * s), du / (92 + 0.35 * s)); m = Math.min(m, 0.06 + 0.94 * sstep(0.85, 1.7, e));
    }
    return m;
  }
  // draws everything; called by voxel.js after the ball, before the HUD / the lighting resolve, with the scene's view-projection
  draw(mvp) {
    if (!this.on) return; const t0 = performance.now();
    try { if (!this.prog) this.init(); } catch (e) { console.warn("ballfx", e); this.on = false; return; }
    const gl = this.gl, T = this.T = this.time(); this.n = 0; this.B = this.basis(mvp);
    const L = this.v.light; this.gk = L && L.active && L.begun && !L.broken ? 0.5 : 1;     // LIGHT is on: its bloom adds to the overbright additive colours, so they start lower
    const B = this.B, ball = this.ball, PL = this.bodies();
    // 1. shadow of the ball (the court-level one the voxel view used to draw as a fixed blob)
    if (ball) {
      const h = ball.h, k = clamp(h / 420), rx = 24 * (1 + 1.5 * k), rz = 16 * (1 + 1.5 * k), soft = clamp(0.10 + 0.85 * sstep(0, 260, h)), al = 0.68 * (1 - 0.62 * sstep(0, 420, h));
      this.flat([ball.x, 0.55, ball.z - 3], rx, rz, 7, soft, [0, 0, 0, al]);
    }
    // 2. alpha particles (dust, flecks), then the additive ones
    for (let pass = 0; pass < 2; pass++) for (const p of this.parts) {
      if ((pass === 0) === !!p.add) continue; const age = this.frameAge(p.t0 + 1, T); if (age < 0 || age > p.life) continue;
      const u = age / p.life, f = p.drag ? (1 - Math.exp(-p.drag * age)) / p.drag : age, v = p.v || [0, 0, 0], g = p.g || 0;
      const x = p.pos.x + v[0] * f, z = p.pos.z + v[2] * f; let y = p.pos.y + v[1] * f - 0.5 * g * age * age; if (y < 0.6) y = 0.6;
      const s = lerp(p.s0, p.s1 === undefined ? p.s0 : p.s1, Math.sqrt(u)) * this.k.size, fade = Math.pow(1 - u, p.k === 3 || p.k === 2 ? 1.6 : 1.3) * Math.min(1, age * 3 + 0.35);
      const c = p.c; let a = p.a;
      if (p.add && p.k !== 5 && PL.length) a *= this.occlusion(PL, x, y, z, s);
      if (p.streak) {
        const vx = v[0] * Math.exp(-p.drag * age), vy = v[1] * Math.exp(-p.drag * age) - g * age, vz = v[2] * Math.exp(-p.drag * age), L = p.len || 1.6;
        this.ribbon([x - vx * L, y - vy * L, z - vz * L], [x, y, z], 0.2 * p.s0, p.s0 * (0.4 + 0.6 * (1 - u)), [c[0] * a * fade * this.gk, c[1] * a * fade * this.gk, c[2] * a * fade * this.gk, 0], [c[0] * a * fade * this.gk, c[1] * a * fade * this.gk, c[2] * a * fade * this.gk, 0], 4);
      } else if (p.flat) this.flat([x, 0.6, z], s, s * 0.62, p.k, p.p || 0, [c[0], c[1], c[2], Math.min(1, a * fade * this.k.alpha)]);
      else if (p.add) this.billboard([x, y, z], s, p.k, p.p || 0, [c[0] * a * fade * this.gk, c[1] * a * fade * this.gk, c[2] * a * fade * this.gk, 0], p.rot || 0);
      else this.billboard([x, y, z], s, p.k, p.p || 0, [c[0], c[1], c[2], Math.min(1, a * fade * this.k.alpha)]);
    }
    // 3. the trail and the spin cues on the ball
    if (ball && this.vel) this.drawBall(T);
    if (this.n) {
      gl.useProgram(this.prog); gl.bindVertexArray(this.vao); gl.uniformMatrix4fv(this.uMVP, false, mvp);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.buf, 0, this.n * 11);
      if (this.k.depth) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, this.n);
      gl.depthMask(true); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.bindVertexArray(this.v.vao); gl.useProgram(this.v.prog);
    }
    this.stats.quads = this.n / 6; this.stats.ms = this.stats.ms * 0.95 + (performance.now() - t0) * 0.05;
  }
  drawBall(T) {
    const v = this.v, ball = this.ball, B = this.B, sp = this.spd || 0, hist = v.ballHist || [], head = [ball.x, ball.y, ball.z], sc = this.shot.c, power = this.shot.power;
    const vis = sstep(13, 26, sp);
    if (vis > 0.02 && hist.length > 2) {                // trail: the interpolated ball, then the per-game-frame samples back to the last hit
      const n = Math.round(5 + 11 * sstep(14, 40, sp)) + (power ? 3 : 0), pts = [head];
      for (let i = hist.length - 2; i >= 0 && pts.length <= n; i--) {
        const e = hist[i], nx = hist[i + 1]; if (e.fr < this.cut || nx.fr !== e.fr + 1) break;
        const b = e.ball; if (Math.abs(b.X - nx.ball.X) > 160 || Math.abs(b.Y - nx.ball.Y) > 160) break; pts.push([b.X, -b.Z, b.Y]);
      }
      const wd = (34 + 20 * sstep(14, 40, sp) + (power ? 14 : 0)) * this.k.w, hot = mix3(sc, WHITE, 0.45);
      for (let i = 0; i + 1 < pts.length; i++) {
        const u0 = i / (pts.length - 1), u1 = (i + 1) / (pts.length - 1), a0 = 0.78 * vis * Math.pow(1 - u0, 1.5), a1 = 0.78 * vis * Math.pow(1 - u1, 1.5), cc0 = mix3(hot, sc, u0 * 1.6), cc1 = mix3(hot, sc, u1 * 1.6);
        this.ribbon(pts[i], pts[i + 1], wd * (1 - 0.8 * u0), wd * (1 - 0.8 * u1), [cc0[0], cc0[1], cc0[2], a0], [cc1[0], cc1[1], cc1[2], a1], 5);        // the coloured band (normal blending, shows on light courts)
        this.ribbon(pts[i], pts[i + 1], wd * 0.42 * (1 - 0.8 * u0), wd * 0.42 * (1 - 0.8 * u1), [1.3 * a0 * this.gk, 1.3 * a0 * this.gk, 1.2 * a0 * this.gk, 0], [1.3 * a1 * this.gk, 1.3 * a1 * this.gk, 1.2 * a1 * this.gk, 0], 5);   // its hot core (additive: blooms)
      }
      this.billboard(head, 26 + 16 * (power ? 1 : 0), 0, 0, [sc[0] * 0.9 * vis * this.gk, sc[1] * 0.9 * vis * this.gk, sc[2] * 0.9 * vis * this.gk, 0]);
    }
    // spin: the seam sweeps over the ball face along the screen motion; a quad just in front of the ball (towards the viewer)
    const vr = this.vel[0] * B.right[0] + this.vel[1] * B.right[1] + this.vel[2] * B.right[2], vu = this.vel[0] * B.up[0] + this.vel[1] * B.up[1] + this.vel[2] * B.up[2], l = Math.hypot(vr, vu);
    let dx = l > 0.05 ? vr / l : 0, dy = l > 0.05 ? vu / l : -1; const th = Math.atan2(dy, dx) + (this.tilt || 0), cs = Math.cos(th), sn = Math.sin(th);
    const ax = B.right.map((x, i) => (x * cs + B.up[i] * sn) * R_BALL * 1.12 * this.k.R), ay = B.right.map((x, i) => (-x * sn + B.up[i] * cs) * R_BALL * 1.12 * this.k.R);
    const ph = this.phase + this.rate * (T - this.lastFr), fr = R_BALL * this.k.front, tw = B.eye ? this.norm([B.eye[0] - head[0], B.eye[1] - head[1], B.eye[2] - head[2]], B.toward) : B.toward, c = [head[0] + tw[0] * fr, head[1] + tw[1] * fr, head[2] + tw[2] * fr];
    this.quad(c, ax, ay, 6, ph, [1, 1, 0.9, 0.9]);
  }
}

// the HUD button: "BALL FX: on / off" (remembered)
export function addBallFXButton(hud, fx) {
  if (!hud || !fx) return null;
  const b = document.createElement("span"); b.className = "k"; b.id = "ballfxbtn"; b.title = "3D / VOX court: ball trail coloured by shot, spin seam, squash and stretch, bounce dust, impact sparks, net wobble, ball shadow";
  const show = () => { b.textContent = "BALL FX: " + (fx.on ? "on" : "off"); b.classList.toggle("on", fx.on); };
  b.addEventListener("pointerdown", () => { fx.setOn(!fx.on); });
  hud.appendChild(document.createTextNode(" ")); hud.appendChild(b); show(); fx.onChange = show;
  return b;
}
export function attachBallFX(voxel, hud) {
  const fx = voxel.ballfx = new BallFX(voxel);
  let m = null; try { m = new URLSearchParams(location.search).get("ballfx"); } catch (e) { /* no location */ }
  if (m === null) { try { m = localStorage.getItem(KEY); } catch (e) { m = null; } }
  fx.on = !(m === "0" || m === "off");
  addBallFXButton(hud, fx); return fx;
}
