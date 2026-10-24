// COURTSIDE (3D stadium, render only): the people and things round the court, drawn every frame from boxes (stadium3d.js's box shader,
// one instanced draw):
//   ball kids       crouched at the net and at the corners of the baselines; after a point the one at the net dashes in for the ball
//                   and back; at a changeover they run to the benches with towels and stand by the players' chairs
//   line judges     seated at the ends of the baselines in blazers and caps; on a ball called out (wPointOutcome $C4D8 = 5) the
//                   nearest one shoots an arm up
//   benches         two players' benches beside the umpire's chair with bags, towels, drinks, a cooler and a sunshade; the towels,
//                   the cooler and the shade in your TOUR+ sponsors' colours in a tour match (tour.js sponsorAds), else the venue's
//   TV crane        behind the far corner a camera on a crane arm, sweeping slowly, faster after a point; photographers kneel along
//                   the far baseline, their flashes going off after points and now and then
//   flags           every flag of the venue (venues.js ctx.flag) and a row along the far stand wave in the wind: a breeze, more in rain,
//                   a gale in WEATHER: Wind, blowing the way its leaves do
// Read only: the score bytes, the rally length and the point's outcome; nothing written.
const shade = (c, k) => c.map(x => Math.max(0, Math.min(255, x * k)));
const pack = c => ((Math.max(0, Math.min(255, Math.round(c[0]))) << 16) | (Math.max(0, Math.min(255, Math.round(c[1]))) << 8) | Math.max(0, Math.min(255, Math.round(c[2]))));
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const ease = u => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
// kit by venue: [shirt, shorts] for the ball kids, [blazer, trousers] for the line judges
const KITS = { castle: [[200, 40, 70], [240, 240, 240]], pipes: [[220, 40, 40], [40, 70, 200]], volcano: [[40, 36, 40], [150, 30, 30]], hangar: [[250, 190, 40], [60, 64, 74]],
  jungle: [[70, 140, 60], [150, 110, 64]], tropics: [[40, 190, 204], [255, 255, 255]], city: [[30, 40, 60], [230, 230, 236]], junior: [[60, 150, 80], [40, 50, 70]],
  senior: [[240, 240, 236], [40, 90, 60]], varsity: [[40, 80, 190], [240, 190, 40]] };
const SKIN = [[240, 196, 160], [214, 160, 120], [170, 116, 80], [120, 80, 56]];

export class Courtside {
  constructor(st) { this.st = st; this.v = st.v; this.gl = st.gl; this.items = null; this.flags = []; this.a = new Float32Array(8 * 2048); this.n = 0; this.outAt = -99; this.changeAt = -99; this.pointAt = -99; this.flashes = []; }
  // ---- built with the stadium (static parts go into its boxes; the moving ones are kept here) ----
  build(B, VEN, opt) {
    const name = VEN ? VEN.name : "varsity", kit = KITS[name] || KITS.varsity, jk = name === "city" || name === "varsity" ? [[30, 40, 90], [200, 200, 210]] : [shade(kit[0], 0.6), [60, 60, 70]];
    this.kit = kit; this.judgeKit = jk; this.venue = name;
    // the sponsors' colours (tour.js sponsorAds: indices into stadium3d.js ADS), else the venue's kit and a neutral
    const sp = (opt.sponsors || []).map(i => opt.ads[i]).filter(Boolean), cols = sp.length ? sp.map(a => hex(a.bg[0])) : [kit[0], kit[1], [240, 240, 236]];
    const fg = sp.length ? sp.map(a => hex(a.fg)) : [[255, 255, 255]];
    // the benches: either side of the umpire's chair, along the right edge of the court
    const bx = 1180, wood = [150, 112, 70], metal = [170, 174, 184];
    for (const [bz, k] of [[-360, 0], [360, 1]]) {
      const c = cols[k % cols.length], f = fg[k % fg.length];
      B.add(bx, 0, bz, 70, 54, 220, metal); B.add(bx, 54, bz, 80, 10, 230, wood); B.add(bx + 34, 64, bz, 10, 70, 230, wood);       // the bench, its back
      B.add(bx - 20, 64, bz - 60, 40, 30, 70, shade(c, 0.8)); B.add(bx - 20, 94, bz - 60, 30, 8, 50, shade(c, 0.6));          // a bag
      B.add(bx - 2, 64, bz + 50, 74, 4, 60, c); B.add(bx - 40, 30, bz + 50, 4, 34, 60, c); B.add(bx - 40, 30, bz + 52, 5, 8, 56, f);   // a towel over the seat, its stripe
      for (let i = 0; i < 3; i++) B.add(bx - 70, 0, bz - 70 + i * 22, 12, 30, 12, i === 1 ? [240, 240, 250] : [80, 160, 230]);   // drinks
      B.add(bx - 6, 0, bz + 140, 60, 44, 44, c); B.add(bx - 6, 44, bz + 140, 64, 8, 48, f);                                   // the cooler
      B.add(bx + 70, 0, bz, 8, 300, 8, metal);                                                                                    // the sunshade
      for (let i = 0; i < 4; i++) B.add(bx + 70, 300 + i * 16, bz, 200 - i * 46, 16, 260 - i * 56, i & 1 ? f : c);
    }
    // the crane's base and the photographers' kneeling spot (the moving parts in draw)
    this.crane = { x: -1180, z: -1560 };
    B.add(-1180, 0, -1560, 160, 40, 160, [60, 62, 70]); B.add(-1180, 40, -1560, 50, 300, 50, [80, 82, 92]);
    this.bench = [[bx - 80, -360], [bx - 80, 360]];
    this.flags = opt.flags || [];
  }
  // ---- once per game frame (stadium3d.js step): a point, an out call, a changeover ----
  step(w, E, p, now) {
    if (!p) return;
    if (E.sig !== p.sig) { this.pointAt = now; for (let i = 0; i < 5; i++) if (Math.random() < 0.7) this.flashes.push({ i, at: now + Math.random() * 0.8 }); }
    if (E.res === 5 && p.res !== 5) this.outAt = now;
    const games = w[0x8E2] + w[0x8E3], pg = this.lastGames; this.lastGames = games;
    if (pg !== undefined && games !== pg && games % 2 === 1) this.changeAt = now;
    if (w[0x4B6] > 0 && now - this.changeAt > 2) this.changeAt = -99;                // the serve: back to their places
  }
  // ---- a person of boxes: feet at (x, y, z), facing +z or -z (f = 1 / -1) or +x / -x (fx); pose: stand, crouch, sit, run (k: the stride) ----
  person(x, y, z, f, pose, top, bottom, skin, o = {}) {
    const P = (dx, dy, dz, sx, sy, sz, c) => this.add(x + dx, y + dy, z + dz, sx, sy, sz, c), s = o.s || 1, side = o.side || false;
    const lx = (a, b) => side ? [b, a] : [a, b];                                     // (facing along x: the body's width runs along z)
    const W = 44 * s, D = 26 * s;
    if (pose === "sit") {
      const [a, b] = lx(W, D); P(0, 0, 0, a * 0.9, 50 * s, b * 0.9, bottom); P(0, 50 * s, 0, a, 60 * s, b, top); P(0, 110 * s, 0, 26 * s, 26 * s, 26 * s, skin); P(0, 136 * s, 0, 30 * s, 10 * s, 30 * s, o.cap || top);
      if (o.arm) P(...(side ? [0, 110 * s, 14 * s] : [14 * s, 110 * s, 0]), 10 * s, 70 * s, 10 * s, top);
      return;
    }
    const crouch = pose === "crouch", leg = crouch ? 34 * s : 60 * s, k = o.k || 0, [a, b] = lx(W, D);
    for (const sg of [-1, 1]) { const st = pose === "run" ? Math.sin(k) * 18 * sg * s : 0; P(...(side ? [st, 0, sg * 10 * s] : [sg * 10 * s, 0, st]), 16 * s, leg, 16 * s, bottom); }
    const by = leg, bh = crouch ? 46 * s : 58 * s; P(0, by, 0, a, bh, b, top);
    for (const sg of [-1, 1]) { const sw = pose === "run" ? -Math.sin(k) * 14 * sg * s : 0; P(...(side ? [sw, by + 10 * s, sg * (a / 2 + 6 * s)] : [sg * (a / 2 + 6 * s), by + 10 * s, sw]), 10 * s, bh - 10 * s, 10 * s, top); }
    P(0, by + bh, 0, 26 * s, 26 * s, 26 * s, skin); if (o.cap) P(0, by + bh + 22 * s, 0, 30 * s, 8 * s, 30 * s, o.cap);
  }
  add(x, y, z, sx, sy, sz, rgb) {
    if ((this.n + 1) * 8 > this.a.length) { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a.set([x, y, z, pack(rgb), sx, sy, sz, 0.04], this.n * 8); this.n++;
  }
  // ---- every frame: the moving people, the crane, the flags ----
  draw(mvp, T, pBox, uBox, cube) {
    const gl = this.gl; if (!this.kit) return; this.n = 0;
    const kit = this.kit, jk = this.judgeKit, cap = shade(kit[0], 0.8);
    const sinceP = T - this.pointAt, change = T - this.changeAt < 30, cu = ease((T - this.changeAt) / 1.6);
    // ball kids: two at the net (left side; the umpire sits right), four at the baselines' corners
    const KIDS = [[-780, -70, 1], [-780, 70, -1], [-860, -1440, 1], [860, -1440, 1], [-860, 1440, -1], [860, 1440, -1]];
    KIDS.forEach(([x, z, f], i) => {
      let px = x, pz = z, pose = "crouch", kk = 0;
      if (i < 2 && sinceP > 0.2 && sinceP < 2.6) {                                   // the dash in for the ball after a point, and back
        const u = sinceP < 1.4 ? (sinceP - 0.2) / 1.2 : 1 - (sinceP - 1.4) / 1.2; px = x + ease(u) * 420; pose = "run"; kk = T * 14;
      } else if (change && i < 4) {                                                   // a changeover: to the benches with towels
        const [bx, bz] = this.bench[i & 1], m = cu; px = x + (bx - 60 - x) * m; pz = z + (bz + (i < 2 ? -110 : 110) - z) * m; pose = m < 1 ? "run" : "stand"; kk = T * 14;
        if (m >= 1) this.add(px, 90, pz + 10, 50, 40, 8, [250, 250, 250]);         // the towel held out
      } else kk = 0;
      this.person(px, 0, pz, f, pose, kit[0], kit[1], SKIN[i % 4], { s: 0.82, cap, k: kk, side: pose === "run" && !change });
    });
    // line judges: at the ends of the baselines, on chairs, facing across; the nearest one to the ball calls an out with an arm up
    const out = T - this.outAt < 1.6, ball = this.v.ballWorld ? this.v.ballWorld() : null;
    const JUDGES = [[-800, -1250], [800, -1250], [-800, 1250], [800, 1250]];
    let near = -1; if (out && ball) { let best = 1e9; JUDGES.forEach(([x, z], i) => { const d = Math.hypot(x - ball.X, z - ball.Y); if (d < best) { best = d; near = i; } }); }
    JUDGES.forEach(([x, z], i) => {
      this.add(x, 0, z, 46, 44, 46, [70, 70, 80]); this.add(x + (x < 0 ? -22 : 22), 44, z, 8, 56, 46, [70, 70, 80]);
      this.person(x, 44, z, 1, "sit", jk[0], jk[1], SKIN[(i + 2) % 4], { cap: [240, 240, 240], arm: i === near, side: true });
    });
    // the TV crane: the arm turning on its column, the camera at its end, a counterweight behind
    const C = this.crane, yaw = 0.55 * Math.sin(T * (sinceP < 3 ? 0.9 : 0.35)) + 0.6, pitch = 0.25 + 0.12 * Math.sin(T * 0.5), L = 760, n = 16;
    const dx = Math.sin(yaw) * Math.cos(pitch), dy = Math.sin(pitch), dz = Math.cos(yaw) * Math.cos(pitch), py = 340;
    for (let i = -4; i <= n; i++) { const t = i / n; this.add(C.x + dx * L * t, py + dy * L * t, C.z + dz * L * t, 28, 28, 28, i < 0 ? [50, 52, 60] : [200, 204, 214]); }
    this.add(C.x - dx * L * 0.3, py - dy * L * 0.3 - 30, C.z - dz * L * 0.3, 80, 80, 80, [40, 42, 48]);
    const ex = C.x + dx * L, ey = py + dy * L, ez = C.z + dz * L; this.add(ex, ey - 70, ez, 60, 50, 70, [30, 30, 34]); this.add(ex + dx * 40, ey - 60, ez + dz * 40, 26, 26, 26, [20, 20, 24]);
    this.add(ex, ey - 20, ez, 8, 30, 8, [255, 40, 40]);
    this.person(C.x + 60, 0, C.z + 80, 1, "stand", [60, 60, 70], [40, 40, 50], SKIN[1], { cap: [30, 30, 30] });   // the operator
    // photographers along the far baseline, kneeling, their cameras up; flashes after points and now and then
    for (let i = 0; i < 5; i++) {
      const x = -520 + i * 260, z = -1540; this.person(x, 0, z, 1, "crouch", [50, 54, 64], [30, 32, 40], SKIN[(i + 1) % 4], { s: 0.9 });
      this.add(x, 96, z + 26, 30, 22, 26, [24, 24, 28]); this.add(x, 100, z + 46, 14, 14, 18, [60, 60, 70]);
      const fl = this.flashes.find(e => e.i === i && T >= e.at && T < e.at + 0.09) || (Math.sin(T * 1.7 + i * 2.1) > 0.995 ? {} : null);
      if (fl) this.add(x, 116, z + 34, 26, 16, 8, [255, 255, 255]);
    }
    this.flashes = this.flashes.filter(e => T < e.at + 0.2);
    // flags in the wind: strips across the flag, each further strip swung more
    const W = this.v.weather, wind = W && W.cur === "wind" ? 1 : W && W.cur === "rain" ? 0.6 : 0.3;
    for (const fl of this.flags) {
      const m = 6, along = fl.along || "x";
      for (let k = 0; k < m; k++) {
        const t = (k + 0.5) / m, wave = Math.sin(T * (3 + wind * 5) - k * 0.9 + fl.x * 0.01) * (6 + 22 * wind) * t, droop = (1 - wind) * 30 * t * t;
        if (along === "x") this.add(fl.x + t * fl.w, fl.y - droop, fl.z + wave, fl.w / m + 1, fl.h, 4, k & 1 ? fl.col : shade(fl.col, 0.9));
        else this.add(fl.x + wave, fl.y - droop, fl.z + t * fl.w, 4, fl.h, fl.w / m + 1, k & 1 ? fl.col : shade(fl.col, 0.9));
      }
    }
    // one instanced draw
    if (!this.vao) { this.buf = gl.createBuffer(); this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, cube); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); for (const [loc, off] of [[2, 0], [3, 16]]) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 32, off); gl.vertexAttribDivisor(loc, 1); } }
    gl.useProgram(pBox); gl.uniformMatrix4fv(uBox.uMVP, false, mvp); gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.bufferData(gl.ARRAY_BUFFER, this.a.subarray(0, this.n * 8), gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 30, this.n);
  }
}
