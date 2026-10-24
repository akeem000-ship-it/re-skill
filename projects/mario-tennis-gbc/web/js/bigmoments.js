// BIG MOMENTS (3D stadium, render and sound only):
//   venue events   when a set is won, and when the match is won, each court does its own thing: fireworks over the castle, the city
//                  bowl and the class courts' stadium; the volcano erupts behind Bowser's court; a biplane flies past the hangar
//                  trailing smoke; a whale breaches off the island; coins burst out of the pipes; a flock of birds bursts out of the
//                  jungle; balloons go up from the park's benches
//   trophy         you win a tour match (ranking, Island Open, dream match): the game waits a few seconds (as for the walk-out intro)
//                  while a podium rises under you and the trophy comes down into your hands and is lifted, to flashes and confetti
//   VIP box        a glass box in the left stand where the players you have beaten on the tour (TOUR+'s record) sit and watch: they
//                  jump up and clap when you win a point and sink back when you lose one
//   card display   when you win a set or the match, a block of the stand holds up cards that make a picture: the crest and your name
//                  for a set, your face (your own match picture, from the ROM at run time) for the match; the cards flip up row by row
// Nothing in the game is written; the score bytes, the players' records and positions are read.
import { matchPicture } from "./crowdfans.js";
import { crestIcon } from "./crestlogo.js";
const ease = u => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
const FW = { castle: [[255, 150, 210], [255, 220, 90], [255, 255, 255]], city: [[90, 220, 255], [255, 90, 200], [255, 255, 255]], varsity: [[60, 110, 230], [250, 200, 50], [255, 255, 255]],
  senior: [[250, 250, 240], [60, 160, 90], [255, 210, 70]] };
const EVENT = { castle: "fireworks", city: "fireworks", varsity: "fireworks", senior: "fireworks", volcano: "eruption", hangar: "flypast", tropics: "whale", pipes: "coins", jungle: "birds", junior: "balloons" };
export const VIP = { rows: 3, v0: -340, v1: 340 };          // the VIP box: the top rows of the left stand, this stretch of it (stadium3d.js leaves its seats empty)

export class BigMoments {
  constructor(st) { this.st = st; this.v = st.v; this.ev = []; this.cer = null; this.cards = null; this.vip = null; this.react = { side: -1, at: -99 }; this.tex = new Map(); }
  // ---- built with the stadium: the VIP box (glass front, roof, its seats) in the left stand ----
  build(B, stands, opt) {
    this.vip = null; const L = stands.find(s => s.S.side && s.S.dir < 0); if (!L || opt.hall) return;
    const { N, D, RISE, BASE } = opt, u0 = (N - VIP.rows) * D, y0 = BASE + (N - VIP.rows) * RISE, frame = [230, 230, 236];
    L.box(u0 - 10, L.outer, VIP.v0 - 20, VIP.v0, 0, L.top + 90, frame); L.box(u0 - 10, L.outer, VIP.v1, VIP.v1 + 20, 0, L.top + 90, frame);   // the side walls
    L.box(u0 - 30, L.outer + 10, VIP.v0 - 30, VIP.v1 + 30, L.top + 90, L.top + 110, frame);                                                  // the roof
    L.box(u0 - 14, u0 - 8, VIP.v0, VIP.v1, y0 + 60, y0 + 70, frame);                                                                        // the rail along its front (open: the guests in view)
    for (const vv of [VIP.v0 + 170, VIP.v1 - 170]) L.box(u0 - 14, u0 - 8, vv - 6, vv + 6, y0 + 70, L.top + 90, frame);                          // its posts
    L.box(u0 - 30, u0 - 10, VIP.v0 - 30, VIP.v1 + 30, L.top + 60, L.top + 90, [30, 30, 40]);                                                // the fascia
    this.vip = { seats: [-240, -80, 80, 240].map(vv => { const [x, z] = L.at(u0 + D * 1.2, vv); return { x, y: BASE + (N - 1) * RISE + 14, z }; }), L };
    this.far = stands.find(s => !s.S.side) || L; this.geo = opt;
  }
  rivals() {
    const t = this.v.tour, w = this.v.gb.mem.wram[0], cur = w[0xA8B] & 0x3F; if (!t || !t.data) return [];
    const seen = new Set(), out = [];
    for (const m of [...t.data.matches].reverse()) if (m.won && m.oppId != null && m.oppId !== cur && !seen.has(m.oppId)) { seen.add(m.oppId); out.push(m.oppId); if (out.length >= 4) break; }
    return out;
  }
  // ---- once per game frame: who won the point (for the VIP box) ----
  step(w, E, p, now) {
    if (E.sig === p.sig) return;
    const key = s => s[0] * 1000 + s[1] * 10 + s[2], P = [w[0x8E0], w[0x8E2], w[0x8E4]], Q = [w[0x8E1], w[0x8E3], w[0x8E5]];
    if (this.lastK) { const d0 = key(P) - this.lastK[0], d1 = key(Q) - this.lastK[1]; this.react = { side: d0 >= d1 ? 0 : 1, at: now }; }
    this.lastK = [key(P), key(Q)];
  }
  // ---- matchfx.js: a set won, the match won ----
  setWon(side, venue) { this.event(venue, false); if (side === 0) this.showCards("set"); }
  matchWon(side, venue) {
    this.event(venue, true); if (side !== 0) return;
    this.showCards("match");
    const w = this.v.gb.mem.wram[0], mode = w[0x8A6]; if (mode === 1 || mode === 2 || mode === 10) this.cer = { t0: performance.now() / 1000, side };   // a tour win: the trophy
  }
  get holding() { return !!this.cer && performance.now() / 1000 - this.cer.t0 < 6.2; }
  event(venue, big) {
    const now = performance.now() / 1000, kind = EVENT[venue] || "fireworks", snd = this.st.sound, mf = this.v.matchfx;
    if (kind === "fireworks") { if (mf && mf.fireworks) mf.fireworks(big ? 7 : 4, FW[venue], snd); return; }
    this.ev.push({ kind, t0: now, big, seed: Math.random() });
    const amb = this.st.amb;
    if (kind === "eruption") { if (snd) { snd.boom(); setTimeout(() => snd.boom(), 500); } for (let k = 0; k < (big ? 6 : 4); k++) setTimeout(() => { for (const sx of [-1, 1]) amb.spray({ x: sx * 1800, y: 560, z: -2050, n: 40, sp: [100, 420], up: [500, 900], col: [255, 140, 40], glow: true, life: 2.2, size: [22, 46], g: 600 }); }, k * 380); }
    if (kind === "coins") { for (const x of [-1760, 1760]) amb.spray({ x, y: 800, z: -1700, n: big ? 40 : 24, sp: [80, 260], up: [500, 800], col: [255, 210, 60], solid: true, life: 2, size: [24, 30], g: 900 }); if (snd && snd.chime) snd.chime(); }
  }
  // ---- the card display: a canvas picture shown as cards over a block of the stand ----
  showCards(kind) {
    const w = this.v.gb.mem.wram[0], name = (() => { let o = ""; for (let i = 0; i < 16; i++) { const c = w[0xA00 + i]; if (c < 0x20 || c > 0x7E) break; o += String.fromCharCode(c); } return o.trim().toUpperCase(); })();
    const C = 64, R = 18, cv = document.createElement("canvas"); cv.width = C; cv.height = R; const g = cv.getContext("2d");
    g.fillStyle = kind === "match" ? "#1d2b7a" : "#c8102e"; g.fillRect(0, 0, C, R);
    if (kind === "match") {                                                   // your face (match frame 4, the head), with your name
      let pic = null; try { const sprite = this.v.gb.mem.rom[0x1DA50 + (w[0xA0B] & 0x3F)]; pic = matchPicture(this.v.gb, sprite, 4, { pal: 4 }); } catch (e) { pic = null; }
      if (pic) { g.imageSmoothingEnabled = false; const s = Math.min(1, pic.width); g.drawImage(pic, 0, 0, pic.width, Math.min(pic.height, pic.width), 2, 1, 16, 16); }
      g.fillStyle = "#ffd65a"; g.font = "bold 9px sans-serif"; g.textBaseline = "middle"; g.fillText(("CHAMP " + name).slice(0, 10), 20, R / 2 + 1);
    } else {                                                                  // the crest and GO NAME!
      try { g.drawImage(crestIcon(64, { round: false, bg: false }), 1, 1, 16, 16); } catch (e) { /* no crest */ }
      g.fillStyle = "#ffffff"; g.font = "bold 9px sans-serif"; g.textBaseline = "middle"; g.fillText(("GO " + name + "!").slice(0, 10), 20, R / 2 + 1);
    }
    // cards: each pixel a card, a dark gap round it (the picture drawn 4x)
    const out = document.createElement("canvas"), K = 4; out.width = C * K; out.height = R * K; const o = out.getContext("2d"), d = g.getImageData(0, 0, C, R).data;
    o.fillStyle = "#202024"; o.fillRect(0, 0, out.width, out.height);
    for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) { const i = (y * C + x) * 4; o.fillStyle = `rgb(${d[i]},${d[i + 1]},${d[i + 2]})`; o.fillRect(x * K, y * K, K - 1, K - 1); }
    const gl = this.v.gl, tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, out);
    for (const [k, val] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, val);
    if (this.cards && this.cards.tex) gl.deleteTexture(this.cards.tex);
    this.cards = { tex, t0: performance.now() / 1000, rows: R };
  }
  // a character's match picture as a texture (the VIP box), cached
  picTex(roster, frame) {
    const key = roster + ":" + frame; if (this.tex.has(key)) return this.tex.get(key);
    let t = null; try { const sprite = this.v.gb.mem.rom[0x1DA50 + roster], pic = matchPicture(this.v.gb, sprite, frame, { pal: 5 }); if (pic) { const gl = this.v.gl; t = { tex: gl.createTexture(), w: pic.width, h: pic.height }; gl.bindTexture(gl.TEXTURE_2D, t.tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pic); for (const [k, val] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, val); } } catch (e) { t = null; }
    this.tex.set(key, t); return t;
  }
  // ---- every frame: the moving boxes (courtside.js's instanced draw: add) ----
  boxes(T, add) {
    for (const e of this.ev) {
      const u = T - e.t0;
      if (e.kind === "flypast" && u < 7) {                                            // a biplane across the sky, smoke behind it
        const x = -4200 + u * 1250, y = 900 + Math.sin(u * 1.4) * 60, z = -1750, red = [210, 50, 40], yel = [250, 200, 50];
        add(x, y, z, 360, 70, 70, red); add(x - 20, y + 20, z, 90, 12, 420, yel); add(x - 20, y + 90, z, 90, 12, 420, yel); add(x - 170, y + 30, z, 50, 10, 140, yel); add(x - 175, y + 40, z, 50, 60, 10, red); add(x + 190, y + 10, z, 10, 100, 14, [60, 60, 66]);
        if (Math.floor(u * 20) !== e.puff) { e.puff = Math.floor(u * 20); this.st.amb.spray({ x: x - 200, y: y + 30, z, n: 2, sp: [0, 20], up: [0, 30], col: [240, 240, 240], life: 2.5, size: [60, 110], g: -10 }); }
      }
      if (e.kind === "whale" && u < 4) {                                              // a whale breaching off the island, and its splash
        const t = Math.min(1, u / 2.6), arc = Math.sin(Math.PI * t), x = -1900 + t * 800, y = 200 + arc * 560, z = -2000, body = [52, 70, 110], belly = [220, 226, 236];
        for (let k = 0; k < 8; k++) { const s = k / 7, by = y - s * 160 * Math.cos(Math.PI * t), bx = x - s * 420; add(bx, by, z, 90, 120 - s * 60, 120 - s * 60, k & 1 ? body : [62, 82, 124]); if (k < 5) add(bx, by - 30, z + 52, 80, 30, 10, belly); }
        add(x - 470, y - 160 * Math.cos(Math.PI * t), z, 40, 30, 220, body);           // the tail's flukes
        if (!e.splashed && t > 0.05) { e.splashed = true; this.st.amb.spray({ x: -2050, y: 300, z, n: 50, sp: [60, 300], up: [300, 900], col: [220, 240, 255], life: 1.8, size: [30, 70], g: 700 }); }
        if (!e.splashed2 && t >= 1) { e.splashed2 = true; this.st.amb.spray({ x: -1300, y: 300, z, n: 70, sp: [80, 400], up: [400, 1100], col: [220, 240, 255], life: 2, size: [30, 80], g: 700 }); }
      }
      if (e.kind === "birds" && u < 6) {                                              // a flock up out of the jungle
        for (let k = 0; k < 36; k++) { const a = (k * 2.39996 + e.seed * 6) % 6.283, r = 600 + (k % 7) * 160, x = Math.cos(a) * (1800 + u * 260) + Math.sin(u + k) * 60, z = -1400 + Math.sin(a) * r * 0.6, y = 500 + u * (260 + (k % 5) * 40), fl = Math.sin(T * 14 + k) * 14;
          add(x, y, z, 18, 12, 18, [30, 30, 36]); add(x - 20, y + 4 + fl, z, 22, 4, 10, [30, 30, 36]); add(x + 20, y + 4 + fl, z, 22, 4, 10, [30, 30, 36]); }
      }
      if (e.kind === "balloons" && u < 9) {                                           // balloons up from the stands
        const C = [[230, 60, 60], [60, 120, 230], [250, 200, 50], [60, 180, 90], [240, 120, 200], [255, 255, 255]];
        for (let k = 0; k < 48; k++) { const sx = (k & 1 ? 1 : -1) * (1600 + (k * 37) % 400), z = -1500 + (k * 211) % 3000, y = 300 + u * (180 + (k % 5) * 30), x = sx + Math.sin(T * 0.8 + k) * 40;
          add(x, y, z, 50, 60, 50, C[k % C.length]); add(x, y - 70, z, 3, 70, 3, [240, 240, 240]); }
      }
    }
    this.ev = this.ev.filter(e => T - e.t0 < 10);
    // the trophy ceremony: a podium rising under the winner, the trophy coming down to them and lifted
    const c = this.cer; if (c) {
      const u = T - c.t0; if (u > 7) { this.cer = null; return; }
      const pl = (this.v.interp().players || []).filter(q => (q.slot & 1) === c.side)[0] || { X: 0, Y: 1200 }, x = pl.X, z = pl.Y;
      const rise = ease(u / 0.8) * 60, gold = [250, 200, 50], dk = [200, 150, 30];
      add(x, 0, z, 300, rise, 220, [240, 240, 244]); add(x, rise - 6, z + 111, 300, 8, 4, [200, 30, 40]); add(x, rise - 30, z + 111, 60, 20, 4, gold);   // the podium, its stripe, a "1"
      const ty = u < 1 ? 900 - ease(u) * 600 : u < 2.2 ? 300 : 300 + ease((u - 2.2) / 0.6) * 160 + Math.sin(T * 5) * 10;   // down into the hands, then lifted
      add(x, ty, z, 50, 16, 50, dk); add(x, ty + 16, z, 16, 40, 16, gold); add(x, ty + 56, z, 70, 50, 70, gold); add(x, ty + 106, z, 80, 8, 80, [255, 230, 120]);
      add(x - 50, ty + 66, z, 16, 34, 10, gold); add(x + 50, ty + 66, z, 16, 34, 10, gold);
      if (u > 2.2 && !c.flashed) { c.flashed = true; if (this.st.side) for (let i = 0; i < 5; i++) for (let k = 0; k < 4; k++) this.st.side.flashes.push({ i, at: T + Math.random() * 3 }); if (this.st.sound) this.st.sound.cheer(1); }
    }
  }
  // ---- every frame: the pictures (the VIP box's rivals, the card display) ----
  sprites(mvp, T) {
    const v = this.v, gl = v.gl;
    if (this.vip && this.st.fill > 0.05) {
      const ids = this.rivals(), R = this.react, age = T - R.at;
      ids.forEach((id, i) => {
        const s = this.vip.seats[i]; if (!s) return;
        const happy = R.side === 0 && age < 1.6, sad = R.side === 1 && age < 1.6, t = this.picTex(id, happy ? 9 : 4); if (!t) return;
        const hop = happy ? Math.abs(Math.sin(age * 9 + i)) * 26 : 0, sink = sad ? 16 : 0, k = 7.5, W = t.w * k, H = t.h * k;
        v.draw(t.tex, new Float32Array([0, 0, -W, 0, 0, H, 0, 0, 1, 0, 0, 0, s.x, s.y + hop - sink, s.z, 1]), mvp, [0, 0, 1, 1], [1, 1, 1, 1], 0.5);
      });
    }
    const C = this.cards; if (C && this.geo) {
      const u = T - C.t0; if (u > 7.5) { gl.deleteTexture(C.tex); this.cards = null; return; }
      const S = this.far, { N, D, RISE, BASE } = this.geo, rows = C.rows, alpha = Math.min(1, (7.5 - u) / 0.6);
      // the plane of the cards: along the stand's rake, from its 2nd row to its top one, the middle stretch of it
      const len = S.S.side ? 2600 : 3400, du = (N - 1) * D, dy = (N - 1) * RISE, [x0, z0] = S.at(D * 0.5, 0), y0 = BASE + RISE + 130;   // (held up over the fans' heads)
      const ax = S.S.side ? [0, 0, -S.S.dir * len] : [len, 0, 0], ay = S.S.side ? [S.S.dir * du, dy, 0] : [0, dy, -du];
      for (let r = 0; r < rows; r++) {                                                  // row by row, from the bottom up, each flipping up
        const f = ease((u - r * 0.05) / 0.3); if (f <= 0.01) continue;
        const v0 = 1 - (r + 1) / rows, t0 = r / rows, t1 = (r + 1) / rows, base = [x0 + ay[0] * t0, y0 + ay[1] * t0, z0 + ay[2] * t0], h = 1 / rows;
        v.draw(C.tex, new Float32Array([ax[0], ax[1], ax[2], 0, ay[0] * h * f, ay[1] * h * f, ay[2] * h * f, 0, 0, 0, 1, 0, base[0], base[1], base[2], 1]), mvp, [0, v0, 1, v0 + 1 / rows], [1, 1, 1, alpha], 0.02);
      }
    }
  }
}
