// "MENU: Wheel / Game": the main menu as a ball wheel (render-time overlay, the game's own menu runs underneath). A big tennis ball at
// the left, the menu's nine cells on an arc round it (Exhibition, Mini-games, Linked play, the three tour files, Status, Dictionary,
// Saved data); the chosen one slides out on a gold pill, and a panel at the right shows its picture (the game's own cell, copied from the
// screen as it draws it, highlighted) with a line about it; a tour file shows its player, level and play time.
// The port's main menu (port/menus/main_menu/main_menu.js) does the choosing: with P.menuWheel.on the d-pad steps through the nine cells
// in order (up / left back, down / right on) instead of round the 3 x 3 grid; A and B are the game's. The overlay shows only while the
// menu waits for a choice (P.menuWheel.active), so the game's slide-in and slide-out play as they are. Through the JS port only.
// TITLE (with MENU: Wheel): the title screen becomes a courtside night scene: the game's own logo (its pixels, lifted off the screen) over
// a floodlit court, PRESS START, and a real-looking tennis ball in the foreground (optic-yellow felt, thousands of fibres of fuzz and a
// fuzzy rim, the white rubber seam sunk in its groove, lit from the upper left). Press Start: the ball zooms in towards the camera and
// rolls to the left, where it becomes the wheel's ball as the main menu comes in. The title is recognised by its logo tiles (as the
// HD title painter does it); nothing of the game is changed.
import { sigHits } from "./hdmenus/b_common.js";
import { MenuSkins } from "./menuskins.js";   // the sub-menus in the same look
const TITLE_LOGO = [[20, 20, "3a2df153"], [60, 24, "847037c7"], [100, 40, "2ee97ec9"], [130, 30, "b3a7e81d"], [40, 56, "bf70c43a"], [80, 64, "10cddfdc"], [120, 60, "d82c442b"]];
const ZOOM = 1.0;                                   // seconds of the title -> menu move
// ---- the ball (drawn once, 512 px): felt (seam and fibres, turned with the ball), light (fixed shading over it), rim (the fuzzy edge) ----
function makeBall(N = 512) {
  const mk = () => { const c = document.createElement("canvas"); c.width = c.height = N; return c; };
  const R = N * 0.46, C = N / 2, rnd = (() => { let a = 0x1234567; return () => { a = (a * 1103515245 + 12345) >>> 0; return a / 4294967296; }; })();
  const felt = mk(), f = felt.getContext("2d");
  f.save(); f.beginPath(); f.arc(C, C, R, 0, 6.2832); f.clip();
  f.fillStyle = "#cfe23a"; f.fillRect(0, 0, N, N);
  // the felt's mottling: soft blobs of lighter and darker yellow-green
  for (let i = 0; i < 260; i++) { const x = rnd() * N, y = rnd() * N, r = 8 + rnd() * 30, l = rnd() < 0.5; f.fillStyle = l ? `rgba(238,250,120,${0.05 + rnd() * 0.07})` : `rgba(150,170,20,${0.05 + rnd() * 0.07})`; f.beginPath(); f.arc(x, y, r, 0, 6.2832); f.fill(); }
  // the seam: two curves facing each other, a white rubber band sunk in a groove (dark edges either side, a fine line along its middle)
  const seam = (w, style) => { f.lineWidth = w; f.strokeStyle = style; for (const c of [-1, 1]) { f.beginPath(); f.arc(C + c * R * 1.22, C, R * 0.93, 0, 6.2832); f.stroke(); } };
  seam(R * 0.135, "rgba(70,84,8,0.55)");             // the groove's shadow
  seam(R * 0.095, "#eef1e2");                        // the rubber
  seam(R * 0.03, "rgba(255,255,255,0.9)");           // its raised middle catching the light
  seam(R * 0.008, "rgba(150,150,130,0.55)");         // the moulding line
  // fuzz: short fibres everywhere (on the seam's edges white-tipped), then a fine grain
  for (let i = 0; i < 26000; i++) {
    const x = rnd() * N, y = rnd() * N, a = rnd() * 6.2832, l = 1.5 + rnd() * 4.5, t = rnd();
    f.strokeStyle = t < 0.45 ? `rgba(245,255,150,${0.18 + rnd() * 0.25})` : t < 0.85 ? `rgba(160,180,25,${0.16 + rnd() * 0.22})` : `rgba(255,255,235,${0.12 + rnd() * 0.15})`;
    f.lineWidth = 0.6 + rnd() * 0.8; f.beginPath(); f.moveTo(x, y); f.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); f.stroke();
  }
  const im = f.getImageData(0, 0, N, N), d = im.data; for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 22; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.6; } f.putImageData(im, 0, 0);
  f.restore();
  // the light: lit from the upper left, darker towards the lower right and the limb, a soft sheen on the fuzz
  const light = mk(), L = light.getContext("2d");
  let gr = L.createRadialGradient(C - R * 0.38, C - R * 0.42, R * 0.05, C, C, R * 1.02);
  gr.addColorStop(0, "rgba(255,255,230,0.55)"); gr.addColorStop(0.35, "rgba(255,255,220,0.08)"); gr.addColorStop(0.7, "rgba(40,50,0,0.25)"); gr.addColorStop(1, "rgba(20,26,0,0.75)");
  L.fillStyle = gr; L.beginPath(); L.arc(C, C, R, 0, 6.2832); L.fill();
  // the rim: fibres standing off the edge, the fuzzy silhouette
  const rim = mk(), Q = rim.getContext("2d");
  for (let i = 0; i < 9000; i++) {
    const a = rnd() * 6.2832, r0 = R * (0.97 + rnd() * 0.02), r1 = r0 + 2 + rnd() * 9, lit = Math.max(0, Math.cos(a + 2.3)), b = 120 + lit * 110;
    Q.strokeStyle = `rgba(${b + 30},${b + 50},${30 + lit * 60},${0.25 + rnd() * 0.35})`; Q.lineWidth = 0.7 + rnd() * 0.7;
    const wob = (rnd() - 0.5) * 0.08; Q.beginPath(); Q.moveTo(C + Math.cos(a) * r0, C + Math.sin(a) * r0); Q.lineTo(C + Math.cos(a + wob) * r1, C + Math.sin(a + wob) * r1); Q.stroke();
  }
  return { felt, light, rim, N, R };
}
// draws the ball centred at (x, y) with radius r, turned by `turn` radians (the seam turns, the light stays)
function drawBall(g, B, x, y, r, turn = 0) {
  const s = r / B.R;
  g.save(); g.translate(x, y); g.scale(s, s);
  g.save(); g.rotate(turn); g.drawImage(B.felt, -B.N / 2, -B.N / 2); g.restore();
  g.drawImage(B.light, -B.N / 2, -B.N / 2); g.drawImage(B.rim, -B.N / 2, -B.N / 2);
  g.restore();
}
const KEY = "mt-menu";
const FONT = "MT Luckiest Guy", BODY = "Itim, system-ui, sans-serif";
// the cells: names, lines, and where the game draws each (Game Boy pixels: x, y, w, h)
const CELLS = [
  { name: "EXHIBITION", line: "One match: your players, your court", r: [8, 24, 40, 24] },
  { name: "MINI-GAMES", line: "Ring Shot, Banana Bunch and more", r: [56, 24, 40, 24] },
  { name: "LINKED PLAY", line: "Play a friend over the link cable", r: [104, 24, 40, 24] },
  { name: "TOUR FILE 1", file: 0, r: [16, 56, 24, 24] }, { name: "TOUR FILE 2", file: 1, r: [64, 56, 24, 24] }, { name: "TOUR FILE 3", file: 2, r: [112, 56, 24, 24] },
  { name: "STATUS", line: "The files' players and records", r: [8, 88, 40, 24] },
  { name: "DICTIONARY", line: "Every move and rule, explained", r: [56, 88, 40, 24] },
  { name: "SAVED DATA", line: "Copy or erase a tour file", r: [104, 88, 40, 24] },
];
export class MenuWheel {
  constructor(getGb, getPort) {
    this.getGb = getGb; this.getPort = getPort; this.shown = 0; this.pos = 0; this.root = null;
    this.getHd = null; this.ball = null; this.phase = "none"; this.zoomAt = 0; this.logo = null;   // TITLE: the screen, the ball, the move to the menu
    const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
    let m = q.get("menu"); if (m === null) { try { m = localStorage.getItem(KEY); } catch (e) { m = null; } }
    this.style = m === "game" ? "game" : "wheel";
    if (typeof FontFace !== "undefined") new FontFace(FONT, `url(${new URL("../fonts/LuckiestGuy-Regular.ttf", import.meta.url)})`).load().then(f => document.fonts.add(f)).catch(() => {});
  }
  get on() { return this.style === "wheel"; }
  setStyle(s) { this.style = s === "game" ? "game" : "wheel"; try { localStorage.setItem(KEY, this.style); } catch (e) { /* private mode */ } this.sync(); }
  sync() { const P = this.getPort(); if (P) { P.menuWheel = P.menuWheel || { on: false, active: false }; P.menuWheel.on = this.on; } }
  // the tour files' summaries (main_menu.js BuildSaveSlotSummaries: WRAM 3 $D300, 16 bytes each: character or $3F, colour, level, name, hours, minutes)
  file(gb, k) {
    const w = gb.mem.wram[3], o = 0x300 + k * 16; if (!w || w[o] === 0x3F || w[o] >= 0x40) return null;
    let name = ""; for (let i = 0; i < 11; i++) { const c = w[o + 3 + i]; if (c < 0x20 || c > 0x7E) break; name += String.fromCharCode(c); }
    return name.trim() ? { name: name.trim(), level: w[o + 2], h: w[o + 14], m: w[o + 15] } : null;
  }
  ui() {
    if (this.root) return;
    const root = this.root = document.createElement("div"); root.id = "menuwheel";
    Object.assign(root.style, { position: "fixed", zIndex: 1, pointerEvents: "none", overflow: "hidden", display: "none", backdropFilter: "blur(7px) brightness(0.62)", WebkitBackdropFilter: "blur(7px) brightness(0.62)", background: "rgba(8,10,32,0.35)" });
    this.cv = document.createElement("canvas"); Object.assign(this.cv.style, { position: "absolute", left: "0", top: "0", width: "100%", height: "100%", maxWidth: "none", aspectRatio: "auto", background: "transparent", transform: "none", display: "block" }); root.appendChild(this.cv);   // (not the page's own canvas look)
    this.cell = document.createElement("canvas"); document.body.appendChild(root);
  }
  // once a frame (full.js draw): shown while the port's main menu waits for a choice
  isTitle() {
    const hd = this.getHd && this.getHd(); if (!hd || !hd.screen) return false;
    try { if (!hd.active) hd.screen.scan(); return sigHits(hd.screen, "bg", TITLE_LOGO) >= 5; } catch (e) { return false; }
  }
  update() {
    this.sync();
    const P = this.getPort(), gb = this.getGb(), wheel = !!(this.on && P && P.menuWheel && P.menuWheel.active && gb);
    const title = !!(this.on && P && gb && !wheel && this.isTitle()), T = performance.now() / 1000;
    // the title, then (Start) the zoom until the wheel is up, then the wheel
    if (title) { if (this.phase !== "title") this.logo = null; this.phase = "title"; }
    else if (this.phase === "title" && this.on && P && gb) { this.phase = "zoom"; this.zoomAt = T; }
    if (this.phase === "zoom" && T - this.zoomAt > ZOOM && (wheel || T - this.zoomAt > ZOOM + 1.5)) this.phase = "none";   // (the wheel up, or soon after: a quick player may already be past the main menu)
    const skin = this.on && P && P.menuWheel && P.menuWheel.skin, skinOn = !!(skin && !wheel && !title && this.phase !== "zoom" && P.frames - skin.at <= 2);   // (a sub-menu's loop running now)
    const show = title || wheel || this.phase === "zoom" || skinOn;
    if (!show) { if (this.root && this.root.style.display !== "none") this.root.style.display = "none"; return; }
    this.ui();
    const view = [document.getElementById("gl"), document.getElementById("screen")].find(e => e && !e.hidden && e.offsetWidth > 0); if (!view) return;
    const r = view.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    Object.assign(this.root.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr); if (this.cv.width !== W || this.cv.height !== H) { this.cv.width = W; this.cv.height = H; }
    if (!this.ball) this.ball = makeBall();
    const zooming = this.phase === "zoom", opaque = title || (zooming && T - this.zoomAt < ZOOM);
    this.root.style.background = opaque ? "#0b1024" : "rgba(8,10,32,0.35)";
    if (title) { this.drawTitle(gb, W, H, T); return; }
    if (zooming && (T - this.zoomAt < ZOOM || !wheel)) { this.drawZoom(gb, W, H, Math.min(1, (T - this.zoomAt) / ZOOM), T); return; }
    this.phase = "none";
    if (skinOn) { (this.skins || (this.skins = new MenuSkins(this))).draw(this.cv.getContext("2d"), W, H, skin, gb, this.getHd && this.getHd()); return; }
    const w0 = gb.mem.wram[0], sel = Math.min(8, w0[0xB05] * 3 + w0[0xB04]);          // wMenuCursorY / X
    // the wheel turns smoothly towards the chosen cell (the shorter way round the nine)
    let d = sel - this.pos; if (d > 4.5) d -= 9; if (d < -4.5) d += 9; this.pos += d * 0.3; if (Math.abs(d) < 0.01) this.pos = sel;
    this.draw(gb, sel, W, H);
  }
  draw(gb, sel, W, H) {
    const g = this.cv.getContext("2d"), k = Math.min(W / 1280, H / 720), cy = H / 2, br = 250 * k, bx = -60 * k;
    g.clearRect(0, 0, W, H);
    // the ball (the title's, turning as the wheel turns)
    this.menuBall(g, bx, cy, br, -this.pos * 0.35);
    // the cells on the arc: the chosen one on a gold pill, the others fading with their distance from it
    for (let i = 0; i < 9; i++) {
      let o = i - this.pos; if (o > 4.5) o -= 9; if (o < -4.5) o += 9; if (Math.abs(o) > 3.6) continue;
      const a = o * 0.3, rr = br + 80 * k + (Math.abs(o) < 0.5 ? 40 * k * (1 - Math.abs(o) * 2) : 0), x = bx + rr * Math.cos(a), y = cy + rr * Math.sin(a), c = CELLS[i], f = c.file != null ? this.file(gb, c.file) : null;
      const label = c.file != null ? (f ? f.name.toUpperCase() : "NEW FILE") : c.name, near = i === sel;
      if (near) {
        g.font = `${44 * k}px "${FONT}", ${BODY}`; const tw = g.measureText(label).width;
        g.fillStyle = "#ffd65a"; this.pill(g, x - 20 * k, y - 36 * k, tw + 60 * k, 72 * k, 36 * k); g.fill();
        g.fillStyle = "#281e0a"; g.textBaseline = "middle"; g.fillText(label, x + 10 * k, y + 3 * k);
      } else {
        g.globalAlpha = Math.max(0.25, 1 - Math.abs(o) * 0.22); g.font = `${30 * k}px "${FONT}", ${BODY}`; g.textBaseline = "middle";
        g.fillStyle = "#000"; g.fillText(label, x + 2 * k, y + 2 * k); g.fillStyle = "#c8d0eb"; g.fillText(label, x, y); g.globalAlpha = 1;
      }
    }
    // the panel: the chosen cell as the game draws it, its name and its line
    const c = CELLS[sel], f = c.file != null ? this.file(gb, c.file) : null, px = W - 480 * k, py = 150 * k, pw = 420 * k, ph = 380 * k;
    g.fillStyle = "rgba(250,250,255,0.93)"; this.pill(g, px, py, pw, ph, 30 * k); g.fill(); g.lineWidth = 4 * k; g.strokeStyle = "#ffd65a"; g.stroke();
    const [cx0, cy0, cw, ch] = c.r, fr = gb.ppu.bgFrame || gb.ppu.frame, cc = this.cell; cc.width = cw; cc.height = ch;   // (the background only: the chosen cell's name banner and bobbing frame are sprites over it)
    const cg = cc.getContext("2d"), im = cg.createImageData(cw, ch), u32 = new Uint32Array(im.data.buffer);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) u32[y * cw + x] = fr[(cy0 + y) * 160 + cx0 + x] | 0xFF000000;
    cg.putImageData(im, 0, 0);
    const s = Math.min(300 * k / cw, 180 * k / ch); g.imageSmoothingEnabled = false; g.drawImage(cc, px + (pw - cw * s) / 2, py + 26 * k, cw * s, ch * s);
    g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#281e0a"; g.font = `${40 * k}px "${FONT}", ${BODY}`;
    g.fillText(c.file != null ? (f ? f.name.toUpperCase() : c.name) : c.name, px + pw / 2, py + 250 * k);
    g.fillStyle = "#464a64"; g.font = `${23 * k}px ${BODY}`;
    const line = c.file != null ? (f ? `Level ${f.level}  ·  ${f.h} h ${String(f.m).padStart(2, "0")} m played` : "Start a new Mario Tour") : c.line;
    g.fillText(line, px + pw / 2, py + 310 * k); g.textAlign = "start";
    g.fillStyle = "#dce2f5"; g.font = `${24 * k}px ${BODY}`; g.textAlign = "right"; g.fillText("▲ ▼ turn the ball   A choose   B back", W - 60 * k, H - 40 * k); g.textAlign = "start";
  }
  // the court at night for the title: a navy court in perspective with its lines, floodlit, a dark stand of dots, soft (drawn once per size)
  scene(W, H) {
    if (this.bg && this.bg.width === W && this.bg.height === H) return this.bg;
    const c = this.bg = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
    let gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "#070a1c"); gr.addColorStop(0.42, "#141a3a"); gr.addColorStop(0.43, "#3a2a6a"); gr.addColorStop(1, "#24184c"); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    let a = 0x9e3779b9; const rnd = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
    for (let i = 0; i < 2600; i++) { const x = rnd() * W, y = H * (0.08 + rnd() * 0.33); g.fillStyle = `hsla(${rnd() * 360},55%,${35 + rnd() * 30}%,0.8)`; g.fillRect(x, y, 2 + rnd() * 3, 3 + rnd() * 3); }   // the crowd
    const P = (u, v) => { const z = 1 + v * 2.2; return [W * 0.5 + (u * W * 0.75) / z, H * 0.43 + (H * 0.57) * (1 - 1 / z) * 1.55]; };       // court u -1..1, v 0 (far)..1 (near)
    const quad = (u0, v0, u1, v1, fill) => { g.fillStyle = fill; g.beginPath(); for (const [u, v] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]) g.lineTo(...P(u, v)); g.fill(); };
    quad(-0.62, 0.02, 0.62, 1.4, "#1c3a92");
    g.strokeStyle = "rgba(255,255,255,0.92)"; g.lineWidth = Math.max(2, W / 400);
    const line = (u0, v0, u1, v1) => { g.beginPath(); g.moveTo(...P(u0, v0)); g.lineTo(...P(u1, v1)); g.stroke(); };
    for (const u of [-0.62, -0.47, 0.47, 0.62]) line(u, 0.02, u, 1.4); for (const v of [0.02, 0.32, 1.1]) line(-0.62, v, 0.62, v); line(0, 0.32, 0, 1.1);
    g.fillStyle = "rgba(20,24,30,0.9)"; const n0 = P(-0.68, 0.62), n1 = P(0.68, 0.62); g.fillRect(n0[0], n0[1] - H * 0.07, n1[0] - n0[0], H * 0.07);   // the net
    for (const x of [0.12, 0.88]) { const r = g.createRadialGradient(W * x, H * 0.05, 0, W * x, H * 0.05, W * 0.5); r.addColorStop(0, "rgba(255,248,210,0.35)"); r.addColorStop(1, "rgba(255,248,210,0)"); g.fillStyle = r; g.fillRect(0, 0, W, H); }   // floodlights
    const soft = document.createElement("canvas"); soft.width = W; soft.height = H; const sg = soft.getContext("2d"); sg.filter = "blur(" + Math.round(W / 160) + "px)"; sg.drawImage(c, 0, 0); g.clearRect(0, 0, W, H); g.drawImage(soft, 0, 0);
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.75); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.6)"); g.fillStyle = v; g.fillRect(0, 0, W, H);
    return c;
  }
  // the game's logo off the title screen: its pixels from (10, 6) to (152, 78), the screen's background colour made clear
  grabLogo(gb) {
    const fr = gb.ppu.frame, x0 = 10, y0 = 6, w = 142, h = 72, bg = fr[2 * 160 + 2];
    const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d"), im = g.createImageData(w, h), u = new Uint32Array(im.data.buffer);
    let n = 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = fr[(y0 + y) * 160 + x0 + x]; if (p !== bg) { u[y * w + x] = p | 0xFF000000; n++; } }
    g.putImageData(im, 0, 0); return n > 500 ? c : null;
  }
  drawTitle(gb, W, H, T) {
    const g = this.cv.getContext("2d"), k = Math.min(W / 1280, H / 720);
    if (!this.logo) this.logo = this.grabLogo(gb);
    g.drawImage(this.scene(W, H), 0, 0);
    if (this.logo) { const s = 3.2 * k; g.save(); g.shadowColor = "rgba(0,0,0,0.6)"; g.shadowBlur = 16 * k; g.imageSmoothingEnabled = false; g.drawImage(this.logo, 50 * k, 36 * k, this.logo.width * s, this.logo.height * s); g.restore(); }
    this.menuBall(g, W - 300 * k, H - 210 * k, 150 * k, -this.pos * 0.35 + Math.sin(T * 0.6) * 0.15);
    const pulse = 0.65 + 0.35 * Math.sin(T * 4);
    g.font = `${58 * k}px "${FONT}", ${BODY}`; g.textBaseline = "middle"; g.fillStyle = "rgba(0,0,0,0.6)"; g.fillText("PRESS START", 64 * k, H - 76 * k);
    g.fillStyle = `rgba(255,255,255,${pulse})`; g.fillText("PRESS START", 60 * k, H - 80 * k);
  }
  // Start: the ball zooms in towards the camera, then rolls left to the wheel's place as the scene fades into the menu
  drawZoom(gb, W, H, u, T) {
    const g = this.cv.getContext("2d"), k = Math.min(W / 1280, H / 720), e = u * u * (3 - 2 * u);
    g.clearRect(0, 0, W, H);
    g.globalAlpha = 1 - e; g.drawImage(this.scene(W, H), 0, 0); if (this.logo) { const s = 3.2 * k; g.imageSmoothingEnabled = false; g.drawImage(this.logo, 50 * k - e * 400 * k, 36 * k, this.logo.width * s, this.logo.height * s); } g.globalAlpha = 1;
    const x0 = W - 300 * k, y0 = H - 210 * k, r0 = 150 * k, x1 = -60 * k, y1 = H / 2, r1 = 250 * k;
    const grow = Math.sin(Math.min(1, u * 1.6) * Math.PI) * 0.55;                 // in towards the camera first
    const x = x0 + (x1 - x0) * e, y = y0 + (y1 - y0) * e, r = (r0 + (r1 - r0) * e) * (1 + grow);
    this.menuBall(g, x, y, r, -this.pos * 0.35 - e * 6.2832);             // one whole turn, landing as the wheel shows it
  }
  // the one ball of the title, the zoom and the wheel: the same picture, the same green glow, turned by `turn`
  menuBall(g, x, y, r, turn) {
    g.save(); g.shadowColor = "rgba(220,255,120,0.35)"; g.shadowBlur = r * 0.2; g.fillStyle = "rgba(0,0,0,0.01)"; g.beginPath(); g.arc(x, y, r * 0.98, 0, 6.2832); g.fill(); g.restore();
    drawBall(g, this.ball, x, y, r, turn);
  }
  pill(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
}
export function attachMenuWheel(getGb, getPort, hud, getHd) {
  const mw = new MenuWheel(getGb, getPort); mw.getHd = getHd || null;
  if (typeof window !== "undefined") window.__menuWheel = mw;   // (tests)
  const b = document.createElement("span"); b.className = "k"; b.id = "menubtn"; b.title = "the main menu: a ball wheel, or the game's own grid (needs the JS port)";
  const show = () => { b.textContent = "MENU: " + (mw.on ? "Wheel" : "Game"); b.classList.toggle("on", mw.on); }; show();
  b.addEventListener("pointerdown", () => { mw.setStyle(mw.on ? "game" : "wheel"); show(); });
  hud.appendChild(document.createTextNode(" ")); hud.appendChild(b);
  return mw;
}
