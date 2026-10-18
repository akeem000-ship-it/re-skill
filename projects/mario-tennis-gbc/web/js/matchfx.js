// "MATCH FX: on / off": the crowd and the camera around the score in the 3D stadium. Read only: the score ($C8E0-$C8EB) and the rally's
// shot count ($C4B6) are watched, nothing in the game changes.
//   set / match point   the crowd hushes as the point is about to be played (crowdsound hush); when it is won, a second roar
//   long rally          from the 10th shot on, an "ooh" every few shots, rising the longer it lasts
//   changeover          after an odd game (the players change ends) the camera sweeps slowly round the stadium, until a button
//   end of the match    the camera circles the winner, two cheers, and confetti falls over the stands
const KEY = "mt-matchfx";
const ease = u => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
const SWEEP = 3.2, CELEB = 2.6;                             // seconds (the game leaves the court for its results about 2.3 s after match point)
const CONFETTI = [[255, 70, 80], [255, 200, 40], [80, 200, 255], [120, 230, 110], [250, 250, 250], [230, 110, 230]];

export class MatchFX {
  constructor(voxel) {
    this.v = voxel; this.on = (() => { try { return localStorage.getItem(KEY) !== "off"; } catch (e) { return true; } })();
    this.prev = null; this.cine = null; this.confetti = null; this.tense = false; this.oohAt = 0;
    this.skip = () => { if (this.cine && this.cine.kind === "sweep") this.cine = null; };
    addEventListener("pointerdown", this.skip, true); addEventListener("keydown", this.skip, true);
  }
  setOn(on) { this.on = !!on; try { localStorage.setItem(KEY, this.on ? "on" : "off"); } catch (e) { /* private mode */ } if (!this.on) { this.cine = null; this.confetti = null; } }
  score(w) {
    return { sets: [w[0x8E0], w[0x8E1]], games: [w[0x8E2], w[0x8E3]], pts: [w[0x8E4], w[0x8E5]], tb: w[0x8E7], nsets: w[0x8F0] || 1, short: w[0x8F1] === 2, won: w[0x8E8], hits: w[0x4B6] };
  }
  // would winning the next point win side i the game, and with it the set (and the match)? Points are raw counts (deuce taken back to
  // 30-30 by the game, so 3+ and ahead is a game point); a tiebreak is first to 7 by two; a set is 6 games (2 in a short set) by two
  stakes(S, i) {
    const o = 1 - i, p = S.pts[i] + 1, q = S.pts[o];
    const game = S.tb ? p >= 7 && p - q >= 2 : p >= 4 && p - q >= 1 && S.pts[i] >= 3;
    if (!game) return 0;
    const L = S.short ? 2 : 6, g = S.games[i] + 1, set = S.tb || (g >= L && g - S.games[o] >= 2);
    if (!set) return 0;
    return S.sets[i] + 1 >= Math.floor((S.nsets + 1) / 2) ? 2 : 1;   // 2 match point, 1 set point
  }
  // per game frame (stadium3d.js step, the 3D stadium only)
  step(st) {
    const v = this.v, w = v.gb.mem.wram[0], S = this.score(w), p = this.prev, snd = st.sound, now = performance.now() / 1000; this.prev = S;
    if (!this.on || !p) return;
    const sig = s => [...s.sets, ...s.games, ...s.pts].join();
    if (sig(S) !== sig(p)) {                                // a point was played
      const setDone = S.sets[0] + S.sets[1] > p.sets[0] + p.sets[1], gameDone = S.games[0] + S.games[1] !== p.games[0] + p.games[1] || setDone;
      if (S.won && !p.won) { this.celebrate(S.sets[0] >= S.sets[1] ? 0 : 1, st); return; }
      if (this.tense && setDone && snd) setTimeout(() => snd.cheer(1), 700);           // the set point was won: a second roar
      if (gameDone && (S.games[0] + S.games[1]) % 2 === 1 && !setDone) this.cine = { kind: "sweep", t0: now, a0: Math.random() < 0.5 ? -1 : 1 };
      const k = Math.max(this.stakes(S, 0), this.stakes(S, 1)); this.tense = k > 0;
      if (k && snd) setTimeout(() => snd.hush(st.fill), 1400);
    }
    if (S.hits > p.hits && S.hits >= 10 && now - this.oohAt > 1.2 && (S.hits - 10) % 3 === 0 && snd) { this.oohAt = now; snd.ooh(st.fill, Math.min(1, (S.hits - 10) / 15)); }
    if (this.cine && now - this.cine.t0 > (this.cine.kind === "sweep" ? SWEEP : CELEB)) this.cine = null;
  }
  celebrate(side, st) {
    const now = performance.now() / 1000, snd = st.sound;
    this.cine = { kind: "win", t0: now, side, a0: Math.random() * Math.PI * 2 };
    if (snd) { snd.cheer(1); setTimeout(() => snd.cheer(1), 1200); }
    // round the winner (where the camera looks) and over the stands
    const rnd = () => Math.random(), parts = [], h = ((this.v.interp().players || []).filter(q => (q.slot & 1) === side)[0]) || { X: 0, Y: side ? -1200 : 1200 };
    for (let i = 0; i < 260; i++) {
      const near = i % 2 === 0, x = near ? h.X + (rnd() * 2 - 1) * 800 : (rnd() * 2 - 1) * 1900, z = near ? h.Y + (rnd() * 2 - 1) * 800 : -2500 + rnd() * 4400;
      parts.push({ x, y: (near ? 260 : 700) + rnd() * 500, z, vy: 70 + rnd() * 90, sw: rnd() * 6.28, sp: 1 + rnd() * 2, rot: rnd() * 6.28, c: CONFETTI[i % CONFETTI.length] });
    }
    this.confetti = { t0: now, parts };
  }
  // voxel.js renderCourt: the camera while a sweep or the celebration runs (null: the usual camera)
  camera(aspect, m4, clip, players) {
    const c = this.cine; if (!c || !this.on) return null;
    const t = performance.now() / 1000 - c.t0;
    let eye, at;
    if (c.kind === "sweep") {                               // a slow arc high round the stadium, centred on the court
      const u = ease(t / SWEEP), a = c.a0 * (-0.55 + 1.1 * u), R = 4200;
      eye = [R * Math.sin(a), 1500 - 200 * Math.sin(Math.PI * u), R * Math.cos(a)]; at = [0, 0, -200];
    } else {                                                // circling the winner, coming in
      const pl = (players || []).filter(q => (q.slot & 1) === c.side), h = pl[0] || { X: 0, Y: c.side ? -1200 : 1200, Z: 0 };
      const u = t / CELEB, a = c.a0 + 1.6 * ease(u), R = 1300 - 500 * ease(u);
      eye = [h.X + R * Math.sin(a), 300 + 200 * (1 - ease(u)), h.Y + R * Math.cos(a)]; at = [h.X, 110, h.Y];
    }
    return { mvp: m4.mul(m4.perspective(0.7, aspect, clip.near, clip.far), m4.lookAt(eye, at, [0, 1, 0])), tilt: 0 };
  }
  // confetti over the stands (after the stadium): small paper squares falling, swaying and turning
  draw(mvp, m4) {
    const C = this.confetti, v = this.v; if (!C || !this.on) return;
    const t = performance.now() / 1000 - C.t0; if (t > CELEB + 2) { this.confetti = null; return; }
    const gl = v.gl; if (!this.tex) this.tex = v.solidTexture([255, 255, 255, 255]);
    gl.useProgram(v.prog); gl.bindVertexArray(v.vao); const fade = Math.min(1, (CELEB + 2 - t) / 1.5);
    for (const q of C.parts) {
      const y = q.y - q.vy * t; if (y < 0) continue;
      const x = q.x + 40 * Math.sin(q.sw + t * q.sp), r = q.rot + t * q.sp * 2;
      v.draw(this.tex, m4.trs(x, y, q.z, 22, 14 * Math.abs(Math.cos(r)) + 3, r, r * 0.7), mvp, [0, 0, 1, 1], [q.c[0] / 255, q.c[1] / 255, q.c[2] / 255, fade], 0);
    }
  }
}

export function addMatchFxButton(hud, fx) {
  if (!hud || !fx) return null;
  const b = document.createElement("span"); b.className = "k"; b.id = "matchfxbtn"; b.title = "3D stadium: the crowd hushes on set and match point and gasps at long rallies; the camera sweeps the stadium at changeovers and circles the winner at the end, with confetti";
  const show = () => { b.textContent = "MATCH FX: " + (fx.on ? "on" : "off"); b.classList.toggle("on", fx.on); };
  b.addEventListener("pointerdown", () => { fx.setOn(!fx.on); show(); });
  hud.appendChild(document.createTextNode(" ")); hud.appendChild(b); show(); return b;
}
export function attachMatchFx(voxel, hud) { const fx = voxel.matchfx = new MatchFX(voxel); addMatchFxButton(hud, fx); return fx; }
