// "MATCH FX: on / off": the crowd and the camera around the score in the 3D stadium. Read only: the score ($C8E0-$C8EB) and the rally's
// shot count ($C4B6) are watched, nothing in the game changes.
//   set / match point   the crowd hushes as the point is about to be played (crowdsound hush); when it is won, a second roar
//   long rally          from the 10th shot on, an "ooh" every few shots, rising the longer it lasts
//   game / set won      after every game and every set, whoever won it, the camera sweeps slowly round the stadium, until a button
//   end of the match    the camera circles the winner, two cheers, and confetti falls over the stands; an opponent from a switched-on mod
//                       with lines (mods.js lines.win / lose) has their say about the result in a speech box
//   claps               before a big point (or now and then) the crowd claps in rhythm, faster and faster, until the serve
//   pause               while the game's pause menu is up (its labels written over the court: many BG tiles off the court map)
//                       TV shots of the court and the crowd cut one after another, each a slow pan
//   after each point    the game plays its own fist pump / slump (CharPointReactionPhase 08:6D27 by wCharPointResult $DF57); on top of
//                       it the point's winner hops twice under turning stars, the loser gets a sweat drop and a small grey cloud
const KEY = "mt-matchfx";
const ease = u => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
const SWEEP = 3.2, CELEB = 2.6;                             // seconds (the game leaves the court for its results about 2.3 s after match point)
const CONF_LIFE = 5.5, FW_COLOURS = [[255, 90, 80], [255, 210, 60], [120, 200, 255], [140, 255, 140], [255, 140, 230], [255, 255, 255]];
const REACT = 2.2;                                          // seconds a point's reaction marks stay up at most (the game moves on sooner)
// the reaction marks, 9 x 9 (1 ink, 2 shine): a star, a sweat drop, a cloud
const MARKS = { star: "000010000000111000000111000111222111011121110001111100011101110011000110010000010",
  drop: "000010000000010000000111000001121000011121100011111100011111100001111000000000000",
  cloud: "000000000001110000011111011111111111111111111111111111011111110000000000000000000" };
const CONFETTI = [[255, 70, 80], [255, 200, 40], [80, 200, 255], [120, 230, 110], [250, 250, 250], [230, 110, 230]];

// the pause camera's shots (u: 0..1 through the shot): [eye, look at], world units (the court X +-432, Y +-1248; the side stands from
// |X| 1420 out to 2100 and up to ~660, the far stand behind Y -1800); every eye stays above the stands' top rows
const PAUSE_SHOT = 5.5, lerp = (a, b, u) => a + (b - a) * u;
const PAUSE_SHOTS = [
  u => [[lerp(-3000, 3000, u), 1700, 3600], [0, 0, -300]],                                        // wide, high behind the near end, tracking across
  u => [[-1050, 1150, lerp(1500, -1300, u)], [1740, 380, lerp(1100, -1600, u)]],                  // over the left stand, along the right-hand crowd
  u => [[1050, 1150, lerp(-1300, 1500, u)], [-1740, 380, lerp(-1600, 1100, u)]],                  // over the right stand, along the left-hand crowd
  u => [[lerp(-900, 900, u), 1000, -2300], [0, 60, 600]],                                         // high behind the far stand, down the court
  u => [[lerp(1600, 1300, u), 1050, lerp(400, -400, u)], [0, 90, 0]],                            // the net from the umpire's side, drifting
  u => [[lerp(-1200, 1200, u), 1250, 300], [lerp(-900, 900, u), 420, -2300]],                     // over the court, panning the far stand's crowd
];
export class MatchFX {
  constructor(voxel) {
    this.v = voxel; this.on = (() => { try { return localStorage.getItem(KEY) !== "off"; } catch (e) { return true; } })();
    this.prev = null; this.react = new Map(); this.cine = null; this.confetti = null; this.tense = false; this.oohAt = 0; this.claps = null; this.pauseN = 0;
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
      if (gameDone) this.cine = { kind: "sweep", t0: now, a0: Math.random() < 0.5 ? -1 : 1 };
      const k = Math.max(this.stakes(S, 0), this.stakes(S, 1)); this.tense = k > 0;
      if (k && snd) setTimeout(() => snd.hush(st.fill), 1400);
      if (!S.won && (k || Math.random() < 0.3)) this.claps = { next: now + (k ? 3.2 : 1.6), n: 0, until: now + 9 };   // (after the hush on a big point)
    }
    this.reactStep(v);
    // claps in rhythm until the serve is hit (the rally's shot count leaves 0)
    const C = this.claps;
    if (C && (S.hits > 0 || now > C.until)) this.claps = null;
    else if (C && now >= C.next && snd) { snd.clap(st.fill); C.n++; C.next = now + Math.max(0.26, 0.55 - C.n * 0.025); }
    // the pause menu: the camera circles the stadium while it is up
    const pz = this.pausedNow(v);
    if (pz && (!this.cine || this.cine.kind !== "pause")) { if (++this.pauseN > 20) this.cine = { kind: "pause", t0: now, first: Math.floor(Math.random() * PAUSE_SHOTS.length) }; }
    else if (!pz) { this.pauseN = 0; if (this.cine && this.cine.kind === "pause") this.cine = null; }
    if (S.hits > p.hits && S.hits >= 10 && now - this.oohAt > 1.2 && (S.hits - 10) % 3 === 0 && snd) { this.oohAt = now; snd.ooh(st.fill, Math.min(1, (S.hits - 10) / 15)); }
    if (this.cine && this.cine.kind !== "pause" && now - this.cine.t0 > (this.cine.kind === "sweep" ? SWEEP : CELEB)) this.cine = null;
  }
  // seconds since a reaction began, in game frames (held with the game: the pause menu, the intro)
  reactAge(q) { return (this.v.gb.ppu.frames - q.f0) / 60; }
  // each match slot's point reaction: state 7 (the point's end) from its reaction phase on, wCharPointResult's sign the mood
  reactStep(v) {
    const m = v.gb.mem, n = m.wram[0][0x8F3] >= 4 ? 4 : 2;
    for (let k = 4; k < 4 + n; k++) {
      const b = m.wram[k], res = b[0xF57], on = b[0xF18] === 7 && b[0xF19] >= 2 && (res & 0x7F) !== 0, r = this.react.get(k);
      if (on && !r) this.react.set(k, { f0: v.gb.ppu.frames, win: !(res & 0x80) }); else if (!on && r) this.react.delete(k);
    }
  }
  // voxel.js interp: the winner's two hops (the drawn height only)
  adjust(r) {
    if (!this.on || !this.react.size || !r.players) return r;
    const players = r.players.map(p => { const q = this.react.get(p.slot), t = q && q.win ? this.reactAge(q) : 9; return t < 0.9 ? { ...p, Z: p.Z - 64 * Math.abs(Math.sin(Math.PI * t / 0.45)) } : p; });
    return { ...r, players };
  }
  markTex(name) {
    const T = this.marks || (this.marks = {}); if (T[name]) return T[name];
    const s = MARKS[name], d = new Uint8Array(81 * 4);    // shine white, ink a shade under it (the tint colours both)
    for (let i = 0; i < 81; i++) if (s[i] !== "0") d.set(s[i] === "2" ? [255, 255, 255, 255] : [200, 200, 200, 255], i * 4);
    return (T[name] = this.v.texture(9, 9, d));
  }
  // the reaction marks over each reacting player's head (cards facing the court camera)
  drawReactions(mvp, m4) {
    if (!this.on || !this.react.size || this.cine) return;
    const v = this.v, players = v.interp().players || [];
    for (const p of players) {
      const q = this.react.get(p.slot); if (!q) continue;
      const t = this.reactAge(q); if (t > REACT) continue;
      const fade = Math.min(1, (REACT - t) / 0.5), head = -p.Z + 330;
      if (q.win) for (let i = 0; i < 3; i++) {            // three stars turning round the head, rising a little
        const a = t * 3.2 + i * 2.094, x = p.X + Math.cos(a) * 130, z = p.Y + Math.sin(a) * 70, s = 66 + 12 * Math.sin(t * 8 + i);
        v.draw(this.markTex("star"), m4.trs(x, head + 30 * Math.min(1, t * 3) + 18 * i, z, s, s, 0, 0), mvp, [0, 0, 1, 1], [1, 0.86, 0.25, fade], 0.3);
      } else {                                             // a drop sliding down beside the head, a cloud over it
        const u = (t % 1.1) / 1.1;
        v.draw(this.markTex("drop"), m4.trs(p.X + 95, head - 30 - 80 * u, p.Y + 10, 62, 74, 0, 0), mvp, [0, 0, 1, 1], [0.55, 0.8, 1, fade * (1 - u * 0.6)], 0.3);
        v.draw(this.markTex("cloud"), m4.trs(p.X - 120 + 10 * Math.sin(t * 2), head + 40, p.Y, 170, 110, 0, 0), mvp, [0, 0, 1, 1], [0.45, 0.47, 0.55, fade * 0.85], 0.3);
      }
    }
  }
  pausedNow(v) {
    if (!v.courtMaps || v.courtId < 0) return false;
    const m = v.gb.mem, base = v.bgBase(), pr = v.courtMaps[v.courtId]; if (!pr) return false; let n = 0;
    for (let k = 0; k < 1024; k += 2) if (m.vram[0][base + k] !== pr[k] && ++n > 50) return true;
    return false;
  }
  celebrate(side, st) {
    const now = performance.now() / 1000, snd = st.sound;
    this.cine = { kind: "win", t0: now, side, a0: Math.random() * Math.PI * 2 };
    if (snd) { snd.cheer(1); setTimeout(() => snd.cheer(1), 1200); }
    // round the winner (where the camera looks) and over the stands
    const h = ((this.v.interp().players || []).filter(q => (q.slot & 1) === side)[0]) || { X: 0, Y: side ? -1200 : 1200 };
    const w = this.v.gb.mem.wram[0], c = this.v.gb.modChar && this.v.gb.modChar(w[0xA8B] & 0x3F), line = c && c.lines && (side ? c.lines.win : c.lines.lose);
    if (line) setTimeout(() => this.quote(c.name || "", line), 700);
    this.confettiAt(h.X, h.Y, 130, 800, 260); this.confettiAt(0, -300, 130, 2200, 700);   // round the winner (where the camera looks) and over the stands
  }
  // a speech box low over the view for a few seconds: who, and what they say
  quote(who, text) {
    if (typeof document === "undefined" || !this.v.cv) return;
    let e = this.say;
    if (!e) {
      e = this.say = document.createElement("div");
      e.style.cssText = "position:fixed;z-index:8;pointer-events:none;max-width:70%;padding:.5em .9em;border-radius:12px;background:#fffdf4;color:#1c1c28;border:3px solid #1c1c28;font:clamp(14px,2.6vw,22px)/1.25 Itim,system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.45);transition:opacity .4s;opacity:0;transform:translateX(-50%)";
      document.body.appendChild(e);
    }
    const r = this.v.cv.getBoundingClientRect(); e.replaceChildren();
    if (who) { const b = document.createElement("b"); b.textContent = who.toUpperCase(); b.style.cssText = "display:block;color:#c81e28;font-size:.75em;letter-spacing:.1em"; e.appendChild(b); }
    e.appendChild(document.createTextNode("\u201C" + text + "\u201D"));
    e.style.left = Math.round(r.left + r.width / 2) + "px"; e.style.top = Math.round(r.top + r.height * 0.7) + "px"; e.style.opacity = "1";
    clearTimeout(this.sayT); this.sayT = setTimeout(() => { e.style.opacity = "0"; }, 3800);
  }
  // confetti: n paper squares around (x, z) within r, starting h up (also the intro's walk-on: intro.js); each falls for CONF_LIFE seconds
  confettiAt(x, z, n, r, h, intro = false) {
    const now = performance.now() / 1000, rnd = () => Math.random(), C = this.confetti || (this.confetti = { parts: [] });
    for (let i = 0; i < n; i++) C.parts.push({ t0: now, x: x + (rnd() * 2 - 1) * r, y: h + rnd() * 500, z: z + (rnd() * 2 - 1) * r, vy: 70 + rnd() * 90, sw: rnd() * 6.28, sp: 1 + rnd() * 2, rot: rnd() * 6.28, c: CONFETTI[i % CONFETTI.length], intro });
  }
  // fireworks over the stadium until `until` (intro.js: the big matches' walk-out): shells rise and burst into sparks; pal: their colours
  fireworks(dur, pal, snd) {
    const now = performance.now() / 1000; this.fw = { until: now + dur, next: now, shells: [], pal: pal || FW_COLOURS, snd };
  }
  drawFireworks(mvp, m4, now) {
    const F = this.fw, v = this.v, gl = v.gl; if (!F) return;
    if (now < F.until && now >= F.next) {
      F.next = now + 0.25 + Math.random() * 0.45;
      F.shells.push({ t0: now, x: (Math.random() * 2 - 1) * 1900, z: -2600 + Math.random() * 3000, h: 950 + Math.random() * 650, c: F.pal[Math.floor(Math.random() * F.pal.length)], n: 36 + Math.floor(Math.random() * 20), boomed: false });
    }
    F.shells = F.shells.filter(s => now - s.t0 < 2.4); if (!F.shells.length && now > F.until) { this.fw = null; return; }
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthMask(false);
    for (const s of F.shells) {
      const t = now - s.t0, RISE = 0.7;
      if (t < RISE) { const y = s.h * (1 - (1 - t / RISE) ** 2); v.draw(this.tex, m4.trs(s.x, y, s.z, 14, 14, 0, 0), mvp, [0, 0, 1, 1], [1, 0.9, 0.6, 1], 0); continue; }
      if (!s.boomed) { s.boomed = true; if (F.snd) F.snd.boom(); }
      const u = t - RISE, fade = Math.max(0, 1 - u / 1.6);
      for (let k = 0; k < s.n; k++) {
        const a = k * 2.399, b = Math.acos(1 - 2 * ((k + 0.5) / s.n)), sp = 420, dx = Math.sin(b) * Math.cos(a), dy = Math.cos(b), dz = Math.sin(b) * Math.sin(a);
        const r = sp * (1 - Math.exp(-u * 2.2)) / 2.2 * 2.2;
        v.draw(this.tex, m4.trs(s.x + dx * r, s.h + dy * r - 160 * u * u, s.z + dz * r, 16, 16, 0, 0), mvp, [0, 0, 1, 1], [s.c[0] / 255, s.c[1] / 255, s.c[2] / 255, fade], 0);
      }
    }
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(true);
  }
  // voxel.js renderCourt: the camera while a sweep or the celebration runs (null: the usual camera)
  camera(aspect, m4, clip, players) {
    const c = this.cine; if (!c || !this.on) return null;
    const t = performance.now() / 1000 - c.t0;
    let eye, at;
    if (c.kind === "pause") {                               // TV shots cut one after another, each a slow pan (PAUSE_SHOTS)
      const k = Math.floor(t / PAUSE_SHOT), u = (t % PAUSE_SHOT) / PAUSE_SHOT, sh = PAUSE_SHOTS[(k + c.first) % PAUSE_SHOTS.length](u);
      eye = sh[0]; at = sh[1];
    } else if (c.kind === "sweep") {                               // a slow arc high round the stadium, centred on the court
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
    const C = this.confetti, v = this.v, now = performance.now() / 1000, gl = v.gl;
    if (!this.tex) this.tex = v.solidTexture([255, 255, 255, 255]);
    gl.useProgram(v.prog); gl.bindVertexArray(v.vao);
    this.drawFireworks(mvp, m4, now);
    this.drawReactions(mvp, m4);
    if (!C) return;
    C.parts = C.parts.filter(q => now - q.t0 < CONF_LIFE); if (!C.parts.length) { this.confetti = null; return; }
    for (const q of C.parts) {
      if (!this.on && !q.intro) continue;
      const t = now - q.t0, y = q.y - q.vy * t; if (y < 0) continue;
      const fade = Math.min(1, (CONF_LIFE - t) / 1.5), x = q.x + 40 * Math.sin(q.sw + t * q.sp), r = q.rot + t * q.sp * 2;
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
