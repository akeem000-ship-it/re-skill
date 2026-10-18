// "INTRO: on / off": a walk-out introduction before each match in the 3D stadium (3D / VOX court, STADIUM: 3D). A view effect: the game is
// held (the page simply runs no frames, as with pause) while the camera
//   A  pans low along the right-hand stand (the real stadium crowd, so its size follows the class of the match: STADIUM crowdClass),
//   B  pushes in on the player, who stands by the left-hand stand, with two spotlight flares and a name plate (class and kind of match),
//   C  watches from high behind the court as the players walk to their places, then the usual camera returns: READY? PLAY!
// A tap or key press skips it. The players' drawn positions are moved (voxel.js interp -> adjust) only while it runs; the game is never touched.
// Remembered in localStorage mt-intro; ?intro=off turns it off for a page load.
const KEY = "mt-intro", RUN_IN = 40;             // game frames the court fades in before the hold
const T_A = 2.6, T_B = 5.0, T_C = 6.9, T_PLAY = 7.5, T_END = 8.1;
const ease = u => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
// READY? / PLAY! in the style of the game's own score captions ("0-15", "NICE!"): chunky 2-px strokes, yellow, orange on the right and lower
// edges of each stroke, a black outline. Glyphs 5x7, drawn at 2x onto a small canvas that is shown pixelated.
const GLYPHS = { R: "11110100011000111110101001001010001", E: "11111100001000011110100001000011111", A: "01110100011000111111100011000110001",
  D: "11110100011000110001100011000111110", Y: "10001100010101000100001000010000100", "?": "01110100010000100110001000000000100",
  P: "11110100011000111110100001000010000", L: "10000100001000010000100001000011111", "!": "00100001000010000100001000000000100" };
function captionImage(word) {
  const S = 2, gw = 5 * S, gh = 7 * S, gap = 2, W = word.length * (gw + gap) - gap + 2, H = gh + 2, on = new Uint8Array(W * H);
  [...word].forEach((ch, k) => { const g = GLYPHS[ch]; if (g) for (let i = 0; i < 35; i++) if (g[i] === "1") for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) on[(1 + Math.floor(i / 5) * S + dy) * W + 1 + k * (gw + gap) + (i % 5) * S + dx] = 1; });
  const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d"), img = g.createImageData(W, H), d = img.data, at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && on[y * W + x];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let col = null;
    if (at(x, y)) col = !at(x + 1, y) || !at(x, y + 1) ? [232, 80, 32] : [248, 248, 96];
    else if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1) || at(x - 1, y - 1) || at(x + 1, y + 1) || at(x - 1, y + 1) || at(x + 1, y - 1)) col = [16, 16, 24];
    if (col) { const o = (y * W + x) * 4; d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255; }
  }
  g.putImageData(img, 0, 0); return c.toDataURL();
}
const MODES = { 1: "RANKING MATCH", 2: "TOURNAMENT", 3: "PRACTICE MATCH", 4: "EXHIBITION", 10: "SPECIAL MATCH" };

export class MatchIntro {
  constructor(voxel) {
    this.v = voxel; this.lastCourt = -1; this.start = -1; this.fr0 = 0; this.ui = null;
    const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
    let m = q.get("intro"); if (m === null) { try { m = localStorage.getItem(KEY); } catch (e) { m = null; } }
    this.on = m !== "off";
    this.skip = () => { if (this.start >= 0) this.t0 = performance.now() / 1000 - T_END; };
  }
  setOn(on) { this.on = !!on; try { localStorage.setItem(KEY, this.on ? "on" : "off"); } catch (e) { /* private mode */ } if (!this.on) this.stop(); }
  get t() { return performance.now() / 1000 - this.t0; }
  // the page runs no game frames while this is true
  get holding() { return this.start >= 0 && this.v.gb.ppu.frames - this.fr0 >= RUN_IN && this.t < T_PLAY; }

  // called by voxel.js renderCourt each display frame: notices a new match, ends a finished intro
  update() {
    const v = this.v, fr = v.gb.ppu.frames, st = v.stadium, w = v.gb.mem.wram[0];
    const fresh = this.lastCourt < 0 || fr < this.lastCourt || fr - this.lastCourt > 600; this.lastCourt = fr;
    if (fresh && this.on && st && st.active && MODES[w[0x8A6]]) {
      this.start = fr; this.fr0 = fr; this.t0 = performance.now() / 1000; this.cheered = false;
      this.cls = st.crowdClass(); this.mode = w[0x8A6]; this.show();
      addEventListener("pointerdown", this.skip, true); addEventListener("keydown", this.skip, true);
    }
    if (this.start < 0) return;
    if (!st || !st.active || this.t >= T_END) { this.stop(); return; }
    if (!this.cheered && this.t >= T_A && st.sound) { this.cheered = true; st.sound.cheer(st.fill); }
    this.overlay();
  }
  stop() {
    this.start = -1; removeEventListener("pointerdown", this.skip, true); removeEventListener("keydown", this.skip, true);
    if (this.ui) this.ui.root.hidden = true;
  }
  // where the players stand: the near side walks in from beside the left stand, the far side from beside the right one
  from(p) { return { X: p.Y >= 0 ? -1050 : 1050, Y: p.Y }; }
  hero(players) { return players.find(p => p.slot === 0) || players.reduce((a, b) => (b.Y > a.Y ? b : a), players[0]); }
  // voxel.js interp(): the drawn positions while the intro runs (a new object; the sampled state is left alone)
  adjust(s) {
    if (this.start < 0 || !s || !s.players || !s.players.length) return s;
    const t = this.t, e = ease((t - T_B - 0.15) / (T_C - T_B - 0.35)), walking = e > 0 && e < 1;
    const players = s.players.map(p => { const f = this.from(p); return { ...p, X: f.X + (p.X - f.X) * e, Y: f.Y + (p.Y - f.Y) * e, Z: p.Z - (walking ? 14 * Math.abs(Math.sin(t * 11 + p.slot)) : 0) }; });
    return { ...s, players };
  }
  // the camera while the intro runs ({ mvp, tilt }), or null for the usual one
  camera(aspect, m4, clip, players) {
    if (this.start < 0) return null;
    const t = this.t; if (t >= T_C) return null;
    let eye, at, fov = 0.75;
    if (t < T_A) {                                // A: low along the right-hand stand
      const u = ease(t / T_A), z = 1500 - 2400 * u;
      eye = [350, 170, z]; at = [1500, 300, z - 260];
    } else if (t < T_B) {                         // B: on the player by the left-hand stand
      const h = this.hero(players || []) || { X: 0, Y: 1200, Z: 0 }, f = this.from(h), u = ease((t - T_A) / (T_B - T_A)), d = 820 - 260 * u;
      eye = [f.X + 260, 175, f.Y + d]; at = [f.X, 115, f.Y]; fov = 0.62;
    } else {                                      // C: high behind the near baseline, drifting in
      const u = ease((t - T_B) / (T_C - T_B));
      eye = [-500 + 500 * u, 1700 - 200 * u, 4200 - 500 * u]; at = [0, 0, -150];
    }
    return { mvp: m4.mul(m4.perspective(fov, aspect, clip.near, clip.far), m4.lookAt(eye, at, [0, 1, 0])), tilt: 0 };
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
#matchintro .plate b { display: block; background: #c81e28; color: #fff; font-size: clamp(20px, 5vw, 38px); font-weight: normal; padding: 2px 34px 2px 16px; clip-path: polygon(0 0, 100% 0, 93% 100%, 0 100%); }
#matchintro .plate i { display: block; background: #14141e; color: #ffdc5a; font-style: normal; font-size: clamp(12px, 2.6vw, 18px); padding: 2px 16px; }
#matchintro .big { position: absolute; left: 50%; top: 38%; height: 16%; transform: translateX(-50%); image-rendering: pixelated; opacity: 0; transition: opacity .15s; }
</style><div class="bar" style="top:0"></div><div class="bar" style="bottom:0"></div><div class="flare" style="left:14%;top:12%">✦</div><div class="flare" style="right:12%;top:8%;font-size:46px;animation-direction:reverse">✦</div><div class="plate"><b></b><i></i></div><img class="big" alt="">`;
      document.body.appendChild(root);
      const q = s => root.querySelectorAll(s);
      this.ui = { root, bars: q(".bar"), flares: q(".flare"), plate: q(".plate")[0], big: q(".big")[0] };
    }
    const u = this.ui, title = this.mode === 4 ? "EXHIBITION" : this.cls === "junior" ? "JUNIOR CLASS" : this.cls === "senior" ? "SENIOR CLASS" : this.mode === 10 ? "DREAM MATCH" : "ISLAND OPEN";
    u.plate.children[0].textContent = title; u.plate.children[1].textContent = this.mode === 4 ? "LET'S PLAY!" : MODES[this.mode];
    u.root.hidden = false; u.word = ""; u.big.style.opacity = 0;
    u.img ||= { "READY?": captionImage("READY?"), "PLAY!": captionImage("PLAY!") };
  }
  overlay() {
    const u = this.ui, t = this.t, r = this.v.cv.getBoundingClientRect();
    Object.assign(u.root.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    const bars = t < T_C - 0.2; u.bars[0].style.transform = bars ? "none" : "translateY(-100%)"; u.bars[1].style.transform = bars ? "none" : "translateY(100%)";
    const lit = t >= T_A && t < T_B; for (const f of u.flares) f.style.opacity = lit ? 0.95 : 0;
    u.plate.style.transform = t >= T_A + 0.5 && t < T_B ? "none" : "translateX(-120%)";
    const word = t >= T_C && t < T_PLAY ? "READY?" : t >= T_PLAY && t < T_END ? "PLAY!" : "";
    if (u.word !== word) { u.word = word; if (word) u.big.src = u.img[word]; } u.big.style.opacity = word ? 1 : 0;
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
  }
  return it;
}
