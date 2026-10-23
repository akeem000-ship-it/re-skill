// "INTRO: on / off": a walk-out introduction before each match in the 3D stadium (3D / VOX court, STADIUM: 3D). A view effect: the game is
// held (the page simply runs no frames, as with pause) while the camera
//   A  pans low along the right-hand stand (the real stadium crowd, so its size follows the class of the match: STADIUM crowdClass),
//   B  you walk in along the left-hand side towards the camera (the match's walking frames), spotlights, your name plate and stats,
//   O  the same for your opponent along the right-hand side at the far end (their name plate and stats on the right),
//   VS a VS screen: you in the top half, your opponent in the bottom half, each in their waiting-for-serve stance (match frame 9 of their
//      sprite set, from the ROM, coloured as on the court: their palette, and your look), a moving background (VS BG: stripes / rays /
//      balls / energy, one at random per match), a fire line through the middle and a VS badge; it then splits open along the line onto the
//      court, READY? shows while both players run on from the sides (the match's running frames) to their places; as it fades the umpire
//      blows the whistle: PLAY!
// The close-ups show each player's level and four bars (power, spin, speed, control from their 11 stats); an opponent from a switched-on
// mod with an intro line (mods.js lines.intro) says it in a speech bubble over their head, and is billed as a RIVAL. The names, levels and stats are
// the match's player records (wP1Name $CA00 / wP2Name $CA80: name, roster id +$0B, level +$18, stats +$20-$2A).
// It grows with the match (tier, by STADIUM crowdClass): junior plain; senior and exhibition louder (a cheer as each player steps out);
// the big matches (Island Open, dream matches, the tour's last matches) add a second camera pass high round the stadium under fireworks
// with a big title banner, confetti over each player as they walk out of the tunnel and roars from the crowd. The players walk out of
// the stadium's tunnels (stadium3d.js TUNNELS: in the side stands beside the net) onto the court in every tier.
// A tap or key press skips it. The players' drawn positions are moved (voxel.js interp -> adjust) only while it runs; the game is never touched.
// Remembered in localStorage mt-intro; ?intro=off turns it off for a page load.
const KEY = "mt-intro", RUN_IN = 40;             // game frames the court fades in before the hold
const T_A = 2.4, T_B = 4.5, T_O = 6.6, T_C = 6.6, T_VS = 8.8, T_SPLIT = 0.6, T_WALK = 10.5, T_PLAY = 10.8, T_END = 11.4;
const RUN = [2, 7, 12, 17];                     // match frames: running sideways (four steps; facing right, mirrored to run left)
const FRONT = [4, 9, 14, 19], WALK_IN = 650;    // walking towards the camera; how far each player walks in along their side in their close-up
const PASS = 3.4;                                  // seconds of the big matches' second camera pass (after A)
const VS_BGS = ["stripes", "rays", "balls", "energy"];   // one at random per match
const TYPES = ["POWER", "TECHNIQUE", "ALL-AROUND", "TRICKY", "SPEED"];
import { matchFrameRaw } from "./crowdfans.js";
import { TUNNELS } from "./stadium3d.js";
import { hdFaceCanvas } from "./look/hdface.js";
import { faceColours } from "./look/faces.js";
import { normalizeFace } from "./look/portrait.js";
const ease = u => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
// READY? / PLAY! in the style of the game's own score captions ("0-15", "NICE!"): chunky 2-px strokes, yellow, orange on the right and lower
// edges of each stroke, a black outline. Glyphs 5x7, drawn at 2x onto a small canvas that is shown pixelated.
const GLYPHS = { R: "11110100011000111110101001001010001", E: "11111100001000011110100001000011111", A: "01110100011000111111100011000110001",
  D: "11110100011000110001100011000111110", Y: "10001100010101000100001000010000100", "?": "01110100010000100110001000000000100",
  P: "11110100011000111110100001000010000", L: "10000100001000010000100001000011111", "!": "00100001000010000100001000000000100",
  V: "10001100011000110001010100101000100", S: "01111100001000001110000010000111110" };
function captionImage(word) { return captionCanvas(word).toDataURL(); }
function captionCanvas(word, S = 2, sticker = 0) {           // sticker: a white rim this many px wide around the outline (the VS badge)
  const gw = 5 * S, gh = 7 * S, gap = 2, M = 1 + sticker, W = word.length * (gw + gap) - gap + 2 * M, H = gh + 2 * M, on = new Uint8Array(W * H);
  [...word].forEach((ch, k) => { const g = GLYPHS[ch]; if (g) for (let i = 0; i < 35; i++) if (g[i] === "1") for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) on[(M + Math.floor(i / 5) * S + dy) * W + M + k * (gw + gap) + (i % 5) * S + dx] = 1; });
  const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d"), img = g.createImageData(W, H), d = img.data, at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && on[y * W + x];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let col = null;
    if (at(x, y)) col = !at(x + 1, y) || !at(x, y + 1) ? [232, 80, 32] : [248, 248, 96];
    else if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1) || at(x - 1, y - 1) || at(x + 1, y + 1) || at(x - 1, y + 1) || at(x + 1, y - 1)) col = [16, 16, 24];
    else if (sticker) { for (let b = -1 - sticker; b <= 1 + sticker && !col; b++) for (let a = -1 - sticker; a <= 1 + sticker; a++) if (at(x + a, y + b)) { col = [250, 250, 250]; break; } }
    if (col) { const o = (y * W + x) * 4; d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255; }
  }
  g.putImageData(img, 0, 0); return c;
}
const MODES = { 1: "RANKING MATCH", 2: "TOURNAMENT", 3: "PRACTICE MATCH", 4: "EXHIBITION", 10: "SPECIAL MATCH" };

export class MatchIntro {
  constructor(voxel) {
    this.v = voxel; this.lastCourt = -1; this.start = -1; this.fr0 = 0; this.ui = null;
    const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
    let m = q.get("intro"); if (m === null) { try { m = localStorage.getItem(KEY); } catch (e) { m = null; } }
    this.on = m !== "off";
    this.vsBg = "stripes";
    let vf = null; try { vf = new URLSearchParams(location.search).get("vs") || localStorage.getItem("mt-vs"); } catch (e) { /* no storage */ }
    this.vsFaces = vf !== "body";                        // VS screen: the players' faces close up (the default) or their whole figure
    this.skip = () => { if (this.start >= 0) this.t0 = performance.now() / 1000 - T_END - this.pass; };
  }
  setOn(on) { this.on = !!on; try { localStorage.setItem(KEY, this.on ? "on" : "off"); } catch (e) { /* private mode */ } if (!this.on) this.stop(); }
  get rt() { return performance.now() / 1000 - this.t0; }               // real seconds since the intro began
  get pass() { return this.tier === 2 ? PASS : 0; }
  get inPass() { const r = this.rt; return this.pass > 0 && r >= T_A && r < T_A + this.pass; }
  // the timeline's clock: the big matches' extra pass after A is time the rest does not see (A's end held)
  get t() { const r = this.rt, P = this.pass; return !P || r < T_A ? r : r < T_A + P ? T_A - 1e-4 : r - P; }
  // the page runs no game frames while this is true
  get holding() { return this.start >= 0 && this.v.gb.ppu.frames - this.fr0 >= RUN_IN && this.t < T_PLAY; }

  // called by voxel.js renderCourt each display frame: notices a new match, ends a finished intro
  update() {
    const v = this.v, fr = v.gb.ppu.frames, st = v.stadium, w = v.gb.mem.wram[0];
    if (v.replaying) { this.lastCourt = fr; return; }                  // INSTANT REPLAY: no intro for the replayed point
    // a new match: the court back after 10 s away, or after any break (half a second) with the score at its start (no
    // sets, games or points: wP1Sets-wP2Points $C8E0-$C8E5, wGamesPlayed $C8EC 0 or 1, wPointsPlayed $C8ED 0), as when you
    // quit a match and start the next one quickly
    const away = this.lastCourt < 0 || fr < this.lastCourt ? 1e9 : fr - this.lastCourt;
    let atStart = w[0x8EC] <= 1 && w[0x8ED] === 0; for (let a = 0x8E0; a <= 0x8E5 && atStart; a++) if (w[a]) atStart = false;
    const fresh = this.start < 0 && (away > 600 || (away > 30 && atStart)); this.lastCourt = fr;
    if (fresh && this.on && st && st.active && MODES[w[0x8A6]]) {
      this.start = fr; this.fr0 = fr; this.t0 = performance.now() / 1000; this.cheered = false; this.whistled = false; this.freeRun(); this.runTex = new Map();
      const name = a => { let o = ""; for (let i = 0; i < 16; i++) { const c = w[a + i]; if (c < 0x20 || c > 0x7E) break; o += String.fromCharCode(c); } return o.trim(); };
      this.names = [name(0xA00) || "YOU", name(0xA80) || "OPPONENT"];
      this.cls = st.crowdClass(); this.mode = w[0x8A6]; this.tier = this.cls === "major" ? 2 : this.cls === "senior" ? 1 : 0; this.fx = {};
      this.who = [0xA00, 0xA80].map((a, side) => this.player(a, side));
      if (this.vsFaces) this.who.forEach((p, side) => { if (p) p.face = this.face(w[(side ? 0xA80 : 0xA00) + 0x0B] & 0x3F, p.pic); });
      this.says = [0xA00, 0xA80].map(a => { const c = v.gb.modChar && v.gb.modChar(w[a + 0x0B] & 0x3F); return (c && c.lines && c.lines.intro) || ""; }); this.vsBg = VS_BGS[Math.floor(Math.random() * VS_BGS.length)]; this.show();
      addEventListener("pointerdown", this.skip, true); addEventListener("keydown", this.skip, true);
    }
    if (this.start < 0) return;
    if (!st || !st.active || this.t >= T_END) { this.stop(); return; }
    if (!this.cheered && this.t >= T_A && st.sound) { this.cheered = true; st.sound.cheer(st.fill); }
    this.grand(st);
    if (!this.whistled && this.t >= T_PLAY && st.sound) { this.whistled = true; st.sound.whistle(); }
    this.overlay();
  }
  // a player of the match from their record: level, the 11 stats, play style, and their waiting-for-serve picture for the VS screen
  player(a, side) {
    const v = this.v, w = v.gb.mem.wram[0], rom = v.gb.mem.rom, roster = w[a + 0x0B] & 0x3F, s = Array.from(w.subarray(a + 0x20, a + 0x2B));
    const avg = (...i) => i.reduce((t, k) => t + s[k], 0) / i.length;
    // CharTypeTable 38:58FB; your own tour player (Alex / Nina): the play style chosen for them, tour record wC90B & 3 (styles 0-3 are types 0-3)
    const type = roster > 1 ? TYPES[rom[0xE18FB + roster]] || "" : TYPES[w[0x90B] & 3];
    const sprite = rom[0x1DA50 + roster], pal = side ? 5 : 4;                // RosterToSprite 07:5A50; the court's OBJ palette of each side
    return { lv: w[a + 0x18], type, sprite, pal, bars: [["POWER", avg(2, 3, 4)], ["SPIN", avg(0, 1)], ["SPEED", avg(7, 8, 9, 10)], ["CONTROL", avg(5, 6)]], pic: this.picture(sprite, pal) };
  }
  // a player's face for the VS close-up: your redrawn face (the look's HD art, or the default one without a look), a mod's
  // photo, else the head of their match sprite (its top rows), drawn big with its pixels; {c, pixel} or null
  face(roster, pic) {
    const L = this.v.gb.look, F = (L && L.faces) || {}, hero = ["boy", "girl"][roster];
    const spec = hero ? F[hero] || { hero, face: normalizeFace(null, hero), colours: faceColours(hero) } : F["mod" + roster];
    try {
      if (spec && spec.photo) { const im = new Image(); im.src = spec.photo; return { c: im, pixel: false }; }
      if (spec) return { c: hdFaceCanvas({ ...spec, mood: "neutral" }, 256), pixel: false };
    } catch (e) { console.warn("intro face", e); }
    if (!pic) return null;
    const h = Math.min(pic.height, Math.max(10, Math.round(pic.width * 0.8))), c = document.createElement("canvas");
    c.width = pic.width; c.height = h; c.getContext("2d").drawImage(pic, 0, 0); return { c, pixel: true };
  }
  // the running player during the walk-on: one card of the match's running frame (voxel.js draws it in place of the game's sprites)
  freeRun() { const v = this.v; for (const e of (this.runTex || new Map()).values()) { if (e.tex) v.gl.deleteTexture(e.tex); if (e.mesh) v.freeMesh(e.mesh); } }
  // each player's walk in their close-up: [start, end] seconds, and how much of it is left at t (1 before, 0 after)
  walkIn(side, t) { const a = side ? T_B : T_A, b = (side ? T_O : T_B) - 0.4; return { a, left: 1 - Math.max(0, Math.min(1, (t - a) / (b - a))) }; }
  // after their close-up each walks on from the tunnel's mouth to their place on the court, arriving as the VS screen comes up
  walkOn(side, t) { const a = (side ? T_O : T_B) - 0.4; return { a, u: Math.max(0, Math.min(1, (t - a) / (T_VS - 0.3 - a))) }; }
  walkBody(pl) {
    const v = this.v, t = this.t; if (this.start < 0 || !this.who) return null;
    const side = pl.Y >= 0 ? 0 : 1, p = this.who[side], w = this.walkIn(side, t), walking = w.left > 0 && w.left < 1, on = this.walkOn(side, t), onCourt = on.u > 0 && on.u < 1;
    if (!walking && !onCourt) return null;
    // VOX: a voxel body of the frame (bodyMesh, as the game's own sprites get; Rounded or Blocky), else one card. Walking on to their
    // place: the running frames at a walking pace, facing the way they go (the frames face right: mirrored to go left)
    const dir = Math.sign(pl.X - this.from(pl).X) || 1;
    const vox = !!v.voxelSprites, k = walking ? FRONT[Math.floor((t - w.a) * 6) % 4] : RUN[Math.floor((t - on.a) * 6) % 4], flip = !walking && dir < 0;
    const key = side + ":" + k + (flip ? "f" : "") + (vox ? (v.rounded ? "R" : "V") : ""), gen = vox ? v.meshGen || 0 : v.texGen || 0;
    let e = this.runTex.get(key);
    if (!e || e.gen !== gen) {
      const cv = this.picture(p.sprite, p.pal, k, flip); if (!cv) return null;
      const d = new Uint8Array(cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data.buffer);
      e = vox ? { gen, mesh: v.bodyMesh(d, cv.width, cv.height, 5, 4.5) } : { gen, w: cv.width, h: cv.height, tex: v.texture(cv.width, cv.height, d) };
      this.runTex.set(key, e);
    }
    return vox ? { mesh: e.mesh, dx: 0, up: 0, ms: 1, gen } : { cards: [{ tex: e.tex, dx: 0, up: 0, w: e.w, h: e.h }], gen };
  }
  // match frame k of sprite set c (9: the stance waiting for a serve), coloured with OBJ palette pal and, on your own player, your look
  picture(c, pal, k = 9, flip = false) {
    try {
      const v = this.v, rom = v.gb.mem.rom, f = matchFrameRaw(rom, c, k); if (!f) return null;
      const { w, h, px } = f.im, op = v.gb.ppu.objPal, L = v.gb.look, fd = L ? L.fade(op, pal) : -1;
      let x0 = w, x1 = -1, y0 = h, y1 = -1; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[y * w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      if (x1 < 0) return null;
      const cv = document.createElement("canvas"); cv.width = x1 - x0 + 1; cv.height = y1 - y0 + 1; const g = cv.getContext("2d"), im = g.createImageData(cv.width, cv.height);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const ci = px[y * w + x]; if (!ci) continue; const o = ((y - y0) * cv.width + x - x0) * 4;
        const reg = fd >= 0 && L.byOffset ? L.byOffset.get(f.base + ((x >> 3) * 4 + (y >> 3)) * 16) : null, lc = reg ? L.rgba(reg[(y & 7) * 8 + (x & 7)], fd) : 0;
        const c3 = lc ? [lc & 255, (lc >> 8) & 255, (lc >> 16) & 255] : v.col5(op, pal, ci), q = flip ? ((y - y0) * cv.width + (x1 - x)) * 4 : o;
        im.data[q] = c3[0]; im.data[q + 1] = c3[1]; im.data[q + 2] = c3[2]; im.data[q + 3] = 255;
      }
      g.putImageData(im, 0, 0); return cv;
    } catch (e) { console.warn("intro picture", e); return null; }
  }
  stop() {
    this.start = -1; removeEventListener("pointerdown", this.skip, true); removeEventListener("keydown", this.skip, true);
    if (this.ui) this.ui.root.hidden = true;
  }
  // where the players stand: the near side walks in from beside the left stand, the far side from beside the right one
  // where a player steps out to: on the court in front of their tunnel's mouth
  from(p) { const T = TUNNELS[p.Y >= 0 ? 0 : 1]; return { X: T.x - T.dir * 150, Y: T.z }; }
  hero(players) { return players.find(p => p.slot === 0) || players.reduce((a, b) => (b.Y > a.Y ? b : a), players[0]); }
  rival(players) { const far = players.filter(p => p.Y < 0); return far.find(p => p.slot === 1) || far[0] || players.reduce((a, b) => (b.Y < a.Y ? b : a), players[0]); }
  // voxel.js interp(): the drawn positions while the intro runs (a new object; the sampled state is left alone)
  adjust(s) {
    if (this.start < 0 || !s || !s.players || !s.players.length) return s;
    const t = this.t;
    // in their close-up each walks out of their tunnel (from inside its dark passage) onto the court, then on to their place (an even walk)
    const players = s.players.map(p => {
      const side = p.Y >= 0 ? 0 : 1, f = this.from(p), T = TUNNELS[side], x0 = T.x + T.dir * T.d * 0.8, left = this.walkIn(side, t).left, x = f.X + (x0 - f.X) * left, e = this.walkOn(side, t).u;
      return { ...p, X: x + (p.X - x) * e, Y: f.Y + (p.Y - f.Y) * e };
    });
    return { ...s, players };
  }
  // what the tier adds, each once at its time: fireworks and roars for the second pass, a cheer (and confetti) as each player steps out
  grand(st) {
    const F = this.fx, snd = st.sound, mf = this.v.matchfx, once = (k, at, fn) => { if (!F[k] && this.rt >= at) { F[k] = true; fn(); } };
    if (this.tier === 2) {
      once("fw", 0.2, () => { if (mf) mf.fireworks(T_A + PASS + T_B - T_A + 1.5, this.mode === 10 ? [[255, 215, 0], [255, 80, 60], [80, 220, 120], [255, 255, 255]] : null, snd); });
      once("roar1", T_A, () => { if (snd) { snd.cheer(1); setTimeout(() => snd.cheer(1), 900); } });
    }
    if (this.tier >= 1) {
      once("out0", T_A + this.pass + 0.35, () => { if (snd) snd.cheer(this.tier === 2 ? 1 : st.fill); if (this.tier === 2 && mf) mf.confettiAt(TUNNELS[0].x + 150, TUNNELS[0].z, 110, 330, 380, true); });
      once("out1", T_B + this.pass + 0.35, () => { if (snd) snd.cheer(this.tier === 2 ? 1 : st.fill); if (this.tier === 2 && mf) mf.confettiAt(TUNNELS[1].x - 150, TUNNELS[1].z, 110, 330, 380, true); });
    }
  }
  // the camera while the intro runs ({ mvp, tilt }), or null for the usual one
  camera(aspect, m4, clip, players) {
    if (this.start < 0) return null;
    const t = this.t; if (t >= T_O) return null;          // from the VS screen on: the usual camera
    let eye, at, fov = 0.75;
    if (this.inPass) {                            // the big matches: high round the stadium under the fireworks
      const u = ease((this.rt - T_A) / PASS), a = -1.0 + 2.0 * u;
      eye = [3900 * Math.sin(a), 1750 - 350 * u, 3600 * Math.cos(a) - 400]; at = [0, 380, -500]; fov = 0.8;
    } else if (t < T_A) {                                // A: low along the right-hand stand
      const u = ease(t / T_A), z = 1500 - 2400 * u;
      eye = [350, 170, z]; at = [1500, 300, z - 260];
    } else if (t < T_O) {                         // B / O: on each player stepping out of their tunnel (yours in the left-hand stand, the
      const near = t < T_B, T = TUNNELS[near ? 0 : 1];                                       // opponent's in the right-hand one): from the court, on their side of the net
      const h = near ? this.hero(players || []) || { X: 0, Y: 1200 } : this.rival(players || []) || { X: 0, Y: -1200 }, f = this.from(h);
      const u = ease(near ? (t - T_A) / (T_B - T_A) : (t - T_B) / (T_O - T_B)), d = 820 - 260 * u;
      eye = [f.X - T.dir * d * 0.8, 175, f.Y + (near ? 1 : -1) * d * 0.6]; at = [f.X + T.dir * 40, 120, f.Y]; fov = 0.62; this.head = [f.X, 215, f.Y];
    } else {                                      // C: high behind the near baseline, drifting in
      const u = ease((t - T_O) / (T_C - T_O));
      eye = [-500 + 500 * u, 1700 - 200 * u, 4200 - 500 * u]; at = [0, 0, -150];
    }
    const mvp = m4.mul(m4.perspective(fov, aspect, clip.near, clip.far), m4.lookAt(eye, at, [0, 1, 0])); this.mvp = mvp;
    return { mvp, tilt: 0 };
  }

  // ---- the overlay: letterbox bars, spotlight flares, the name plate, READY? / PLAY! ----
  show() {
    if (!this.ui) {
      const root = document.createElement("div"); root.id = "matchintro";
      root.innerHTML = `<style>
#matchintro { position: fixed; z-index: 8; pointer-events: none; overflow: hidden; font-family: Itim, system-ui, sans-serif; }
#matchintro .bar { position: absolute; left: 0; right: 0; height: 9%; background: #000; transition: transform .5s; }
#matchintro .flare { position: absolute; color: #fff; font-size: 64px; line-height: 1; text-shadow: 0 0 12px #fff, 0 0 30px #9cf; opacity: 0; transition: opacity .4s; animation: mi-spin 6s linear infinite; }
@keyframes mi-spin { to { transform: rotate(360deg); } }
#matchintro .plate { position: absolute; left: 4%; bottom: 13%; transition: transform .45s cubic-bezier(.2,.9,.3,1.2); }
#matchintro .plate.r { left: auto; right: 4%; text-align: right; }
#matchintro .plate.r b { background: #1e50c8; padding: 2px 16px 2px 34px; clip-path: polygon(0 0, 100% 0, 100% 100%, 7% 100%); }
#matchintro .plate b { display: block; background: #c81e28; color: #fff; font-size: clamp(20px, 5vw, 38px); font-weight: normal; padding: 2px 34px 2px 16px; clip-path: polygon(0 0, 100% 0, 93% 100%, 0 100%); }
#matchintro .plate i { display: block; background: #14141e; color: #ffdc5a; font-style: normal; font-size: clamp(12px, 2.6vw, 18px); padding: 2px 16px; }
#matchintro .stats { position: absolute; left: 0; top: 0; opacity: 0; transition: opacity .3s; width: clamp(130px, 19vw, 190px); padding: 6px 9px 7px; border-radius: 9px; background: rgba(14,16,26,.78); border: 1px solid rgba(255,255,255,.18); color: #e9ecf4; font-size: clamp(9px, 1.4vw, 12px); }
#matchintro .stats.r { }
#matchintro .stats .t { color: #ffdc5a; margin-bottom: 3px; font-size: 1.1em; }
#matchintro .stats .row { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
#matchintro .stats .row span { width: 4.6em; }
#matchintro .stats .sb { flex: 1; height: .62em; border-radius: .31em; background: #343849; overflow: hidden; }
#matchintro .stats .sb i { display: block; height: 100%; border-radius: inherit; }
#matchintro canvas.vs { position: absolute; left: 0; top: 0; transform: none; width: 100%; height: 100%; max-width: none; aspect-ratio: auto; background: transparent; image-rendering: pixelated; display: none; }   /* (not the page's own canvas rules: they centre and blacken every canvas) */
#matchintro .banner { position: absolute; left: 0; right: 0; top: 20%; text-align: center; opacity: 0; transform: scale(.7); transition: opacity .5s, transform .6s cubic-bezier(.2,.9,.3,1.3); }
#matchintro .banner b { display: inline-block; padding: .08em .6em; font-size: clamp(34px, 9vw, 88px); font-weight: normal; letter-spacing: .06em; color: #fff4c0;
  background: linear-gradient(180deg, #e8b020, #a8660a); border: 3px solid #fff2b0; border-radius: 12px; text-shadow: 0 3px 0 #6a3a00, 0 0 18px rgba(255,220,120,.8); box-shadow: 0 6px 24px rgba(0,0,0,.5); }
#matchintro .banner i { display: block; margin-top: .4em; font-style: normal; color: #fff; font-size: clamp(14px, 3vw, 26px); letter-spacing: .3em; text-shadow: 0 2px 6px #000; }
#matchintro .banner.on { opacity: 1; transform: none; }
#matchintro .say { position: absolute; left: 0; top: 0; max-width: 42%; padding: .45em .8em; border-radius: 14px; background: #fffdf4; color: #1c1c28; border: 3px solid #1c1c28;
  font-size: clamp(13px, 2.6vw, 22px); line-height: 1.2; box-shadow: 0 4px 14px rgba(0,0,0,.45); opacity: 0; transition: opacity .25s; }
#matchintro .say::after { content: ""; position: absolute; left: 50%; bottom: -14px; margin-left: -9px; border: 9px solid transparent; border-top: 9px solid #1c1c28; border-bottom: 0; }
#matchintro .plate i em { font-style: normal; color: #ff7a7a; letter-spacing: .12em; }
#matchintro .big { position: absolute; left: 50%; top: 38%; height: 16%; transform: translateX(-50%); image-rendering: pixelated; opacity: 0; transition: opacity .15s; }
</style><div class="bar" style="top:0"></div><div class="bar" style="bottom:0"></div><div class="flare" style="left:14%;top:12%">✦</div><div class="flare" style="right:12%;top:8%;font-size:46px;animation-direction:reverse">✦</div><div class="plate"><b></b><i></i></div><div class="plate r"><b></b><i></i></div><div class="stats"></div><div class="stats r"></div><div class="say"></div><div class="say"></div><canvas class="vs"></canvas><img class="big" alt=""><div class="banner"><b></b><i></i></div>`;
      document.body.appendChild(root);
      const q = s => root.querySelectorAll(s);
      this.ui = { root, bars: q(".bar"), flares: q(".flare"), plate: q(".plate")[0], plate2: q(".plate")[1], stats: q(".stats"), says: q(".say"), vs: q(".vs")[0], big: q(".big")[0], banner: q(".banner")[0] };
    }
    const u = this.ui, title = this.mode === 4 ? "EXHIBITION" : this.cls === "junior" ? "JUNIOR CLASS" : this.cls === "senior" ? "SENIOR CLASS" : this.mode === 10 ? "DREAM MATCH" : "ISLAND OPEN";
    u.plate.children[0].textContent = this.names[0]; u.plate.children[1].textContent = title + "  ·  " + (this.mode === 4 ? "LET'S PLAY!" : MODES[this.mode]);
    u.plate2.children[0].textContent = this.names[1]; u.plate2.children[1].textContent = title + (this.who[1].type ? "  ·  " + this.who[1].type : "");
    if (this.says[1]) { const e = document.createElement("em"); e.textContent = "RIVAL  ·  "; u.plate2.children[1].prepend(e); }
    this.says.forEach((line, i) => { u.says[i].textContent = line ? "\u201C" + line + "\u201D" : ""; });
    this.who.forEach((p, i) => {
      const col = i ? "#3c78ff" : "#ff4a4a", el = u.stats[i]; el.replaceChildren();
      const t = document.createElement("div"); t.className = "t"; t.textContent = "LV " + p.lv + (p.type ? "  ·  " + p.type : ""); el.appendChild(t);
      for (const [n, val] of p.bars) {
        const r = document.createElement("div"); r.className = "row"; const a = document.createElement("span"); a.textContent = n; const b = document.createElement("div"); b.className = "sb";
        const f = document.createElement("i"); f.style.width = Math.max(4, val / 9 * 100) + "%"; f.style.background = col; b.appendChild(f); r.append(a, b); el.appendChild(r);
      }
    });
    u.vsTitle = title;
    u.banner.children[0].textContent = this.mode === 10 ? "DREAM MATCH" : this.mode === 2 ? "ISLAND OPEN" : "CHAMPIONSHIP"; u.banner.children[1].textContent = MODES[this.mode] || "";
    u.root.hidden = false; u.word = ""; u.big.style.opacity = 0;
    u.img ||= { "READY?": captionImage("READY?"), "PLAY!": captionImage("PLAY!") };
  }
  overlay() {
    const u = this.ui, t = this.t, r = this.v.cv.getBoundingClientRect();
    Object.assign(u.root.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    const bars = t < T_C; u.bars[0].style.transform = bars ? "none" : "translateY(-100%)"; u.bars[1].style.transform = bars ? "none" : "translateY(100%)";
    const lit = t >= T_A && t < T_O && !this.inPass; for (const f of u.flares) f.style.opacity = lit ? 0.95 : 0;
    u.banner.classList.toggle("on", this.inPass && this.rt < T_A + PASS - 0.4);
    u.plate.style.transform = t >= T_A + 0.5 && t < T_B ? "none" : "translateX(-120%)";
    u.plate2.style.transform = t >= T_B + 0.5 && t < T_O ? "none" : "translateX(120%)";
    // the stats panel beside the walking player's head (projected each frame): right of yours, left of your opponent's
    for (const i of [0, 1]) {
      const el = u.stats[i], on = i ? t >= T_B + 0.5 && t < T_O : t >= T_A + 0.5 && t < T_B; el.style.opacity = on ? 1 : 0;
      const say = u.says[i], talk = this.says[i] && (i ? t >= T_B + 1.1 && t < T_O - 0.15 : t >= T_A + 1.1 && t < T_B - 0.15); say.style.opacity = talk ? 1 : 0;   // RIVAL: their line
      if (!on || !this.mvp || !this.head) continue;
      const m = this.mvp, [x, y, z] = this.head, cw = m[3] * x + m[7] * y + m[11] * z + m[15]; if (cw <= 0) continue;
      const sx = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / cw * 0.5 + 0.5) * r.width, sy = (1 - ((m[1] * x + m[5] * y + m[9] * z + m[13]) / cw * 0.5 + 0.5)) * r.height;
      const w = el.offsetWidth, h = el.offsetHeight, gap = r.width * 0.06, left = i ? sx - gap - w : sx + gap;
      el.style.left = Math.max(4, Math.min(r.width - w - 4, left)) + "px"; el.style.top = Math.max(r.height * 0.1, Math.min(r.height * 0.9 - h, sy - h * 0.5)) + "px";
      // RIVAL: their line in a bubble over their head, from a second into the close-up
      if (talk) { const sw = say.offsetWidth, sh = say.offsetHeight; say.style.left = Math.max(4, Math.min(r.width - sw - 4, sx - sw / 2)) + "px"; say.style.top = Math.max(r.height * 0.1, Math.min(sy - sh - r.height * 0.1, el.offsetTop - sh - 10)) + "px"; }
    }
    const vsOn = t >= T_C && t < T_VS + T_SPLIT; u.vs.style.display = vsOn ? "block" : "none"; if (vsOn) this.drawVS(t - T_C, r);
    const word = t >= T_VS && t < T_WALK + 0.1 ? "READY?" : t >= T_PLAY && t < T_END ? "PLAY!" : "";
    if (u.word !== word) { u.word = word; if (word) u.big.src = u.img[word]; } u.big.style.opacity = word ? 1 : 0;
  }
  // the VS screen at time tt after it starts, on a canvas 270 px high (as wide as the view's shape), shown pixelated
  drawVS(tt, rect) {
    const u = this.ui, cv = u.vs, H = 270, W = Math.max(360, Math.round(H * rect.width / Math.max(1, rect.height))), M = H / 2;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext("2d"); g.imageSmoothingEnabled = false; g.clearRect(0, 0, W, H);
    const split = ease((tt - (T_VS - T_C)) / T_SPLIT), gap = split * (M + 8), slide = 1 - Math.pow(1 - Math.min(1, tt / 0.45), 3);
    const half = (top, draw) => { g.save(); g.translate(0, top ? -gap : gap); g.beginPath(); g.rect(0, top ? 0 : M + 2, W, top ? M - 2 : M - 2); g.clip(); draw(); g.restore(); };
    for (const top of [true, false]) half(top, () => {
      this.vsBack(g, W, H, top, tt);
      const p = this.who[top ? 0 : 1], pic = p && p.pic;
      const fc = this.vsFaces && p && p.face && p.face.c;
      if (fc && (fc.width || fc.naturalWidth)) {                         // the face close up: as tall as the half, sliding in, bobbing a little
        const fw0 = fc.naturalWidth || fc.width, fh0 = fc.naturalHeight || fc.height, fh = M + 18, fw = fw0 * fh / fh0, bob = 2 * Math.sin(tt * 5);
        const x = top ? W + (W - 30 - fw - W) * slide : -fw + (30 + fw) * slide, y = top ? -6 + bob : M - 10 - bob;
        g.save(); g.imageSmoothingEnabled = !p.face.pixel; g.shadowColor = "rgba(0,0,0,.55)"; g.shadowBlur = 0; g.shadowOffsetX = top ? -6 : 6; g.shadowOffsetY = 4;
        g.drawImage(fc, 0, 0, fw0, fh0, Math.round(x), Math.round(y), Math.round(fw), Math.round(fh)); g.restore();
      } else if (pic) {                                                  // the player, 5x, breathing and bouncing, cut by the line
        const k = 5, sq = Math.floor(tt * 4) % 2, bob = 3 * Math.sin(tt * 7), w = pic.width * k, h = (pic.height - sq) * k;
        const x = top ? W + (W - 70 - w - W) * slide : -w + (70 + w) * slide, y = top ? 8 + bob : M + 6 - bob;
        g.drawImage(pic, 0, 0, pic.width, pic.height, Math.round(x), Math.round(y + sq * k), w, h);
      }
      this.vsPlate(g, top ? 22 : W - 22, top ? 40 : 182, this.names[top ? 0 : 1], top ? u.vsTitle : u.vsTitle + (p && p.type ? " · " + p.type : ""), top ? "#c81e28" : "#1e50c8", !top);
    });
    if (split < 1) {                                                     // the fire line and the badge stay on the seam until it opens
      g.save(); g.globalAlpha = 1 - split;
      for (const [w, c] of [[14, "rgba(255,90,20,.35)"], [8, "rgba(255,140,30,.7)"], [4, "rgba(255,210,60,.95)"], [1.5, "#fffbe0"]]) { g.fillStyle = c; g.fillRect(0, M - w / 2, W, w); }
      for (let i = 0; i < 26; i++) { const x = (i * 37 + tt * 240) % W, y = M + 5 * Math.sin(i * 3 + tt * 9); g.fillStyle = "rgba(255,230,120,.9)"; g.fillRect(x, y, 2, 2); }
      const pop = Math.min(1, Math.max(0, (tt - 0.35) / 0.25)), sc = (0.6 + 0.4 * pop + 0.12 * Math.sin(pop * Math.PI)) * (1 - split * 0.5), b = u.vsBadge ||= captionCanvas("VS", 6, 2);
      if (pop > 0) g.drawImage(b, Math.round(W / 2 - b.width * sc / 2), Math.round(M - b.height * sc / 2), Math.round(b.width * sc), Math.round(b.height * sc));
      g.restore();
    }
  }
  // the moving background of one half: yours warm, the opponent's cool; vsBg picks the pattern (at random per match)
  vsBack(g, W, H, top, t) {
    const M = H / 2, y0 = top ? 0 : M, y1 = top ? M : H, c0 = top ? "#c8283a" : "#1e3cc8", c1 = top ? "#f06e28" : "#3c96f0", sgn = top ? 1 : -1;
    g.fillStyle = c0; g.fillRect(0, y0, W, y1 - y0); g.fillStyle = c1;
    if (this.vsBg === "stripes") {
      const off = ((t * 160 * sgn) % 40 + 40) % 40;
      for (let x = -H; x < W + H; x += 40) { g.beginPath(); g.moveTo(x + off, y0); g.lineTo(x + off + 18, y0); g.lineTo(x + off + 18 - (y1 - y0), y1); g.lineTo(x + off - (y1 - y0), y1); g.fill(); }
    } else if (this.vsBg === "rays") {
      const cx = top ? W - 130 : 130, cy = top ? 70 : 200, a0 = t * 0.9 * sgn;
      for (let k = 0; k < 16; k++) { const a = a0 + k * Math.PI / 8; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + 900 * Math.cos(a), cy + 900 * Math.sin(a)); g.lineTo(cx + 900 * Math.cos(a + 0.2), cy + 900 * Math.sin(a + 0.2)); g.fill(); }
    } else if (this.vsBg === "balls") {
      const off = (t * 40) % 48; g.strokeStyle = "#fff"; g.lineWidth = 2;
      for (let gy = -48; gy < 200; gy += 48) for (let gx = -48; gx < W + 48; gx += 48) {
        const bx = gx + off * sgn + ((gy / 48) % 2 ? 24 : 0), by = y0 + gy + off; g.beginPath(); g.arc(bx, by, 9, 0, 2 * Math.PI); g.fill(); g.beginPath(); g.arc(bx - 5, by + 2, 8, -0.9, 0.9); g.stroke();
      }
    } else {
      for (let k = 0; k < 90; k++) {
        const r = (k * 9301 + (top ? 49297 : 23333)) % 233280 / 233280, r2 = (k * 4561 + 1234) % 9973 / 9973, x = r * W, sp = 40 + r2 * 100, L = 8 + r * 22, y = (r2 * 400 + t * sp) % (M + 60) - 30;
        const yy = top ? y1 - y : y0 + y; g.fillRect(x, top ? yy : yy - L, 2, L);
      }
    }
    g.fillStyle = "rgba(0,0,0,.09)"; for (let y = y0; y < y1; y += 4) g.fillRect(0, y, W, 1);       // scan lines
  }
  vsPlate(g, x, y, name, sub, col, right) {
    g.font = "26px Itim, system-ui, sans-serif"; const nw = g.measureText(name).width; g.font = "12px Itim, system-ui, sans-serif"; const sw = g.measureText(sub).width;
    const w = Math.max(nw, sw) + 26, x0 = right ? x - w : x;
    g.fillStyle = col; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + w, y); g.lineTo(x0 + w - (right ? 0 : 10), y + 30); g.lineTo(x0 + (right ? 10 : 0), y + 30); g.fill();
    g.fillStyle = "#fff"; g.font = "26px Itim, system-ui, sans-serif"; g.textBaseline = "top"; g.fillText(name, x0 + 13, y + 1);
    g.fillStyle = "#14141e"; g.fillRect(x0, y + 30, w, 16); g.fillStyle = "#ffdc5a"; g.font = "12px Itim, system-ui, sans-serif"; g.fillText(sub, x0 + 13, y + 32);
  }
}

// the HUD button: "INTRO: on / off" (remembered)
export function attachIntro(voxel, hud) {
  const it = voxel.intro = new MatchIntro(voxel);
  if (hud) {
    const b = document.createElement("span"); b.className = "k"; b.id = "introbtn"; b.title = "3D stadium: a walk-out introduction before each match (tap to skip it)";
    const show = () => { b.textContent = "INTRO: " + (it.on ? "on" : "off"); b.classList.toggle("on", it.on); };
    b.addEventListener("pointerdown", () => { it.setOn(!it.on); show(); });
    hud.appendChild(document.createTextNode(" ")); hud.appendChild(b); show();
    const v = document.createElement("span"); v.className = "k"; v.id = "vsbtn"; v.title = "the VS screen before a match: the players' faces close up, or their whole figure";
    const showV = () => { v.textContent = "VS: " + (it.vsFaces ? "Faces" : "Body"); };
    v.addEventListener("pointerdown", () => { it.vsFaces = !it.vsFaces; try { localStorage.setItem("mt-vs", it.vsFaces ? "faces" : "body"); } catch (e) { /* private mode */ } showV(); });
    hud.appendChild(document.createTextNode(" ")); hud.appendChild(v); showV();
  }
  return it;
}
