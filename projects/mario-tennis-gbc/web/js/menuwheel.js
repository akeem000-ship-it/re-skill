// "MENU: Wheel / Game": the main menu as a ball wheel (render-time overlay, the game's own menu runs underneath). A big tennis ball at
// the left, the menu's nine cells on an arc round it (Exhibition, Mini-games, Linked play, the three tour files, Status, Dictionary,
// Saved data); the chosen one slides out on a gold pill, and a panel at the right shows its picture (the game's own cell, copied from the
// screen as it draws it, highlighted) with a line about it; a tour file shows its player, level and play time.
// The port's main menu (port/menus/main_menu/main_menu.js) does the choosing: with P.menuWheel.on the d-pad steps through the nine cells
// in order (up / left back, down / right on) instead of round the 3 x 3 grid; A and B are the game's. The overlay shows only while the
// menu waits for a choice (P.menuWheel.active), so the game's slide-in and slide-out play as they are. Through the JS port only.
// TITLE (with MENU: Wheel): the title screen becomes a courtside night scene: the app's logo (crestlogo.js: the shield and the wordmark,
// 2D-HD on its ribbon) over a floodlit court, PRESS START, and a real-looking tennis ball in the foreground (optic-yellow felt, thousands of fibres of fuzz and a
// fuzzy rim, the white rubber seam sunk in its groove, lit from the upper left). Press Start: the ball zooms in towards the camera and
// rolls to the left, where it becomes the wheel's ball as the main menu comes in. The title is recognised by its logo tiles (as the
// HD title painter does it); nothing of the game is changed.
import { sigHits } from "./hdmenus/b_common.js";
import { MenuSkins } from "./menuskins.js";   // the sub-menus in the same look
import { crestLogo } from "./crestlogo.js";
const TITLE_LOGO = [[20, 20, "3a2df153"], [60, 24, "847037c7"], [100, 40, "2ee97ec9"], [130, 30, "b3a7e81d"], [40, 56, "bf70c43a"], [80, 64, "10cddfdc"], [120, 60, "d82c442b"]];
const ZOOM = 1.0, HOLD = 90;                          // seconds of the title -> menu move; game frames a screen's picture is held between two (BACKDROP)
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
  { name: "OPTIONS", line: "Picture, stadium, menus and play", options: true },   // OPTIONS: not a cell of the game's (P.menuWheel.virtual)
];
const NC = CELLS.length;
// OPTIONS: the menu bar's settings in the game's menu, by category; each row is a button of the bar (read: its "NAME: value"; changed:
// the button pressed for it, as a tap would), so the two never disagree. Buttons the bar has not made yet (the 3D view's, before it
// is first turned on) are left out until they exist.
const OPTION_CATS = [
  ["PICTURE", "the view, the camera, the screen", ["view3d", "cam", "aspect", "smoothbtn", "voxstylebtn", "lightbtn", "fieldlifebtn", "groundbtn", "treesbtn"]],
  ["STADIUM", "the court, the crowd, the effects", ["stadiumbtn", "stadiumqbtn", "seasonbtn", "venuetourbtn", "courtbtn", "farendbtn", "crowdsndbtn", "ballfxbtn", "matchfxbtn", "kitbtn", "introbtn", "vsbtn", "callsbtn", "aimbtn"]],
  ["MENUS & TEXT", "how menus and words are drawn", ["uibtn", "fontbtn", "sprbtn"]],
  ["MODES", "exhibition rules, rematch, practice, partner, text", ["mode-sets", "mode-games", "mode-tiebreak", "mode-noAd", "mode-rematch", "mode-machine", "mode-mgHard", "mode-partner", "mode-fastText", "recordsbtn"]],
  ["PLAY", "the rules, the feel, the controls", ["physbtn", "netbtn", "plusbtn", "tourlenbtn", "runaheadbtn", "padmode", "stickfeelbtn", "vibratebtn", "batterybtn", "tourplusbtn", "tourbtn"]],
];
const OPTION_NAMES = { view3d: "3D VIEW", aspect: "SCREEN", cam: "CAMERA", padmode: "TOUCH PAD", lightbtn: "LIGHT", uibtn: "MENUS", sprbtn: "SPRITES" };
// the BACKDROP's court in perspective, seen from behind the near baseline (a camera 6 m back, its eye about 3.7 m up): u across
// (-1..1, the doubles sidelines at +-0.62), v along (0 the far baseline, 0.6 the net, 1.2 the near baseline, low on the screen).
// A point at z metres from the camera sits 1/z below the horizon, so the far half is small and the near half comes towards you;
// d is z over the near baseline's z (1 there), for the sizes of the ball and its shadow
const courtPoint = (u, v, W, H) => { const z = Math.max(0.5, 6 + (1.2 - v) * 19.81); return [W * 0.5 + (u * 8.85 * W * 0.47) / z, H * 0.4 + (H * 3.12) / z, z / 6]; };
const courtHeight = (z, H) => (H * 0.836) / z;                                   // one metre up at z metres, on the screen
export class MenuWheel {
  constructor(getGb, getPort) {
    this.getGb = getGb; this.getPort = getPort; this.shown = 0; this.pos = 0; this.root = null;
    this.getHd = null; this.ball = null; this.phase = "none"; this.zoomAt = 0;   // TITLE: the ball, the move to the menu
    const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
    let m = q.get("menu"); if (m === null) { try { m = localStorage.getItem(KEY); } catch (e) { m = null; } }
    this.style = m === "game" ? "game" : "wheel";
    if (typeof FontFace !== "undefined") new FontFace(FONT, `url(${new URL("../fonts/LuckiestGuy-Regular.ttf", import.meta.url)})`).load().then(f => document.fonts.add(f)).catch(() => {});
  }
  get on() { return this.style === "wheel"; }
  setStyle(s) { this.style = s === "game" ? "game" : "wheel"; try { localStorage.setItem(KEY, this.style); } catch (e) { /* private mode */ } this.sync(); }
  sync() {
    const P = this.getPort(); if (!P) return;
    P.menuWheel = P.menuWheel || { on: false, active: false }; P.menuWheel.on = this.on;
    P.menuWheel.openOptions = () => this.openOptions(); P.menuWheel.optionsInput = input => this.optionsInput(input);   // OPTIONS (main_menu.js)
  }
  // ---- OPTIONS ----
  optionRows(cat) {
    return OPTION_CATS[cat][2].map(id => document.getElementById(id)).filter(e => e && !e.hidden && e.offsetParent !== undefined).map(el => {
      const t = el.textContent.trim(), i = t.indexOf(":"), name = OPTION_NAMES[el.id] || (i > 0 ? t.slice(0, i) : t).toUpperCase();
      const value = el.id === "view3d" ? (el.classList.contains("on") ? t : "Off") : i > 0 ? t.slice(i + 1).trim() : el.classList.contains("on") ? "On" : t;
      return { el, name, value, help: el.title || "" };
    });
  }
  // two steps, as every menu: ▲ ▼ the category round the ball, A opens it; then ▲ ▼ its settings, A changes one, B back to the categories
  openOptions() { const P = this.getPort(); this.opts = { cat: this.opts ? this.opts.cat : 0, row: 0, pos: this.opts ? this.opts.cat : 0, flash: 0, inCat: false }; if (P && P.menuWheel) P.menuWheel.optionsOpen = true; }
  // a frame's pad (the edges) while the panel is open; returns the sound to play ("move", "select", "cancel") or null
  optionsInput(input) {
    const o = this.opts, P = this.getPort(); if (!o) return null;
    const rows = this.optionRows(o.cat);
    if (input & 0x08 || (input & 0x02 && !o.inCat)) { if (P && P.menuWheel) P.menuWheel.optionsOpen = false; return "cancel"; }   // START, or B on the categories: back to the wheel
    if (input & 0x02) { o.inCat = false; return "cancel"; }                                              // B in a category: back to the categories
    if (!o.inCat) {                                                                                      // the categories: ▲ ▼ (◀ ▶ too), A opens one
      if (input & 0xF0) { o.cat = (o.cat + (input & 0x90 ? 1 : -1) + OPTION_CATS.length) % OPTION_CATS.length; o.row = 0; return "move"; }
      if (input & 0x01 && rows.length) { o.inCat = true; o.row = 0; return "select"; }
      return null;
    }
    if (input & 0xC0) { if (!rows.length) return null; o.row = (o.row + (input & 0x80 ? 1 : -1) + rows.length) % rows.length; return "move"; }
    if (input & 0x01 && rows[o.row]) {                                                                   // A: the button pressed, as a tap
      const el = rows[o.row].el, before = el.textContent + el.className;
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      if (el.textContent + el.className === before) el.click();
      o.flash = performance.now(); return "select";
    }
    return null;
  }
  gear(g, x, y, r) {
    g.save(); g.translate(x, y); g.fillStyle = "#3d6fd8";
    for (let i = 0; i < 8; i++) { g.rotate(Math.PI / 4); this.pill(g, -r * 0.16, -r * 1.05, r * 0.32, r * 0.4, r * 0.08); g.fill(); }
    g.beginPath(); g.arc(0, 0, r * 0.82, 0, 6.2832); g.fill(); g.fillStyle = "#f4f6fb"; g.beginPath(); g.arc(0, 0, r * 0.36, 0, 6.2832); g.fill(); g.restore();
  }
  drawOptions(W, H) {
    const g = this.cv.getContext("2d"), k = Math.min(W / 1280, H / 720), o = this.opts, cy = H / 2, br = 250 * k, bx = -60 * k, n = OPTION_CATS.length;
    g.clearRect(0, 0, W, H);
    let d = o.cat - o.pos; if (d > n / 2) d -= n; if (d < -n / 2) d += n; o.pos += d * 0.3; if (Math.abs(d) < 0.01) o.pos = o.cat;
    this.menuBall(g, bx, cy, br, -o.pos * 0.6);
    g.font = `${54 * k}px "${FONT}", ${BODY}`; g.textBaseline = "top"; g.fillStyle = "rgba(0,0,0,0.5)"; g.fillText("OPTIONS", 404 * k, 34 * k); g.fillStyle = "#ffd65a"; g.fillText("OPTIONS", 400 * k, 30 * k); g.textBaseline = "middle";
    for (let i = 0; i < n; i++) {                                                     // the categories round the ball
      let off = i - o.pos; if (off > n / 2) off -= n; if (off < -n / 2) off += n;
      const a = off * 0.42, rr = br + 80 * k + (Math.abs(off) < 0.5 ? 40 * k * (1 - Math.abs(off) * 2) : 0), x = bx + rr * Math.cos(a), y = cy + rr * Math.sin(a), label = OPTION_CATS[i][0];
      if (i === o.cat) { g.font = `${40 * k}px "${FONT}", ${BODY}`; const tw = g.measureText(label).width; g.fillStyle = "#ffd65a"; this.pill(g, x - 20 * k, y - 34 * k, tw + 56 * k, 68 * k, 34 * k); g.fill(); g.fillStyle = "#281e0a"; g.fillText(label, x + 8 * k, y + 3 * k); }
      else { g.globalAlpha = Math.max(0.3, 1 - Math.abs(off) * 0.25); g.font = `${28 * k}px "${FONT}", ${BODY}`; g.fillStyle = "#000"; g.fillText(label, x + 2 * k, y + 2 * k); g.fillStyle = "#c8d0eb"; g.fillText(label, x, y); g.globalAlpha = 1; }
    }
    // the panel: the category's settings, the chosen row gold, each value on a pill
    const rows = this.optionRows(o.cat), px = W - 600 * k, py = 96 * k, pw = 540 * k, rh = (rows.length > 8 ? 36 : 46) * k, ph = Math.max(220 * k, 80 * k + rows.length * rh + 90 * k);
    g.fillStyle = "rgba(250,250,255,0.95)"; this.pill(g, px, py, pw, ph, 28 * k); g.fill(); g.lineWidth = 4 * k; g.strokeStyle = "#ffd65a"; g.stroke();
    g.fillStyle = "#8a7a50"; g.font = `${20 * k}px ${BODY}`; g.fillText(OPTION_CATS[o.cat][1], px + 30 * k, py + 36 * k);
    if (!rows.length) { g.fillStyle = "#7a7f98"; g.font = `${24 * k}px ${BODY}`; g.fillText("Turn on 3D VIEW (PICTURE) for these", px + 30 * k, py + 100 * k); }
    rows.forEach((r, i) => {
      const y = py + 80 * k + i * rh, on = o.inCat && i === Math.min(o.row, rows.length - 1);
      if (on) { g.fillStyle = "rgba(255,214,90,0.35)"; this.pill(g, px + 14 * k, y - rh / 2 + 3 * k, pw - 28 * k, rh - 6 * k, 14 * k); g.fill(); }
      g.fillStyle = "#281e0a"; g.font = `${(on ? 26 : 24) * k}px "${FONT}", ${BODY}`; g.textAlign = "left"; g.fillText(r.name, px + 32 * k, y + 2 * k);
      g.font = `700 ${22 * k}px ${BODY}`; const vw = Math.max(90 * k, g.measureText(r.value).width + 30 * k), flash = on && performance.now() - o.flash < 250;
      g.fillStyle = flash ? "#ffb43a" : on ? "#ffd65a" : "#e4e6f0"; this.pill(g, px + pw - 30 * k - vw, y - 17 * k, vw, 34 * k, 17 * k); g.fill();
      g.fillStyle = "#281e0a"; g.textAlign = "center"; g.fillText(r.value, px + pw - 30 * k - vw / 2, y + 1 * k); g.textAlign = "left";
    });
    const cur = o.inCat ? rows[Math.min(o.row, rows.length - 1)] : null;
    if (cur && cur.help) {                                                            // the setting's help (the button's own tooltip)
      g.fillStyle = "#464a64"; g.font = `${18 * k}px ${BODY}`; let line = ""; const maxW = pw - 60 * k, lines = [];
      for (const w of cur.help.split(" ")) { const t = line ? line + " " + w : w; if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; } if (line) lines.push(line);
      g.strokeStyle = "rgba(70,74,100,0.18)"; g.lineWidth = 2 * k; g.beginPath(); g.moveTo(px + 30 * k, py + ph - 82 * k); g.lineTo(px + pw - 30 * k, py + ph - 82 * k); g.stroke();
      lines.slice(0, 3).forEach((l, i) => g.fillText(l, px + 30 * k, py + ph - 62 * k + i * 22 * k));
    }
    g.fillStyle = "#dce2f5"; g.font = `${24 * k}px ${BODY}`; g.textAlign = "right"; g.fillText(o.inCat ? "▲ ▼ setting   A change   B back" : "▲ ▼ category   A open   B back", W - 60 * k, H - 40 * k); g.textAlign = "start";
  }
  // the tour files' summaries (main_menu.js BuildSaveSlotSummaries: WRAM 3 $D300, 16 bytes each: character or $3F, colour, level, name, minutes (+14), hours (+15))
  file(gb, k) {
    const w = gb.mem.wram[3], o = 0x300 + k * 16; if (!w || w[o] === 0x3F || w[o] >= 0x40) return null;
    let name = ""; for (let i = 0; i < 11; i++) { const c = w[o + 3 + i]; if (c < 0x20 || c > 0x7E) break; name += String.fromCharCode(c); }
    return name.trim() ? { name: name.trim(), level: w[o + 2], h: w[o + 15], m: w[o + 14] } : null;   // (the caption prints +15 before the colon, +14 after it)
  }
  ui() {
    if (this.root) return;
    const root = this.root = document.createElement("div"); root.id = "menuwheel";
    Object.assign(root.style, { position: "fixed", zIndex: 1, pointerEvents: "none", overflow: "hidden", display: "none", backdropFilter: "blur(7px) brightness(0.62)", WebkitBackdropFilter: "blur(7px) brightness(0.62)", background: "rgba(8,10,32,0.35)" });
    this.bgcv = document.createElement("canvas"); Object.assign(this.bgcv.style, { position: "absolute", left: "0", top: "0", width: "100%", height: "100%", maxWidth: "none", aspectRatio: "auto", transform: "none", display: "none" }); root.appendChild(this.bgcv);   // BACKDROP
    this.cv = document.createElement("canvas"); Object.assign(this.cv.style, { position: "absolute", left: "0", top: "0", width: "100%", height: "100%", maxWidth: "none", aspectRatio: "auto", background: "transparent", transform: "none", display: "block" }); root.appendChild(this.cv);   // (not the page's own canvas look)
    this.cell = document.createElement("canvas");
    // inside <main>: on a phone <main> is fixed (a stacking context of its own), and the menu must sit over the game view but under
    // the button bar (#hud, z 3) and the touch controls (#pad, z 2) there, not over all of <main>
    (document.querySelector("main") || document.body).appendChild(root);
  }
  // once a frame (full.js draw): shown while the port's main menu waits for a choice
  isTitle() {
    const hd = this.getHd && this.getHd(); if (!hd || !hd.screen) return false;
    try { if (!hd.active) hd.screen.scan(); return sigHits(hd.screen, "bg", TITLE_LOGO) >= 5; } catch (e) { return false; }
  }
  update() {
    this.sync();
    if (globalThis.__venueTourOn) { if (this.root) this.root.style.display = "none"; return; }   // (VENUE TOUR: its own view)
    const P = this.getPort(), gb = this.getGb(), wheel = !!(this.on && P && P.menuWheel && P.menuWheel.active && gb);
    const onTitle = !!(this.on && P && gb && !wheel && this.isTitle()), T = performance.now() / 1000, F = gb ? gb.frames : 0;
    // the title, then (Start) the zoom until the wheel is up, then the wheel. The title also stays up while the game plays its own
    // attract loop (the ball toss, then the title again: no Start or A pressed when the title went), until the title or the menu is back
    if (onTitle) { this.phase = "title"; if (gb.joypad.buttons & 9) this.startAt = F; }
    else if (this.phase === "title" && this.on && P && gb) {
      if (F - (this.startAt ?? -1e9) < 45) { this.phase = "zoom"; this.zoomAt = T; }
      else { this.phase = "attract"; this.attractAt = F; }
    } else if (this.phase === "attract" && (!this.on || wheel || F - this.attractAt > 1200 || F < this.attractAt)) this.phase = "none";
    const title = onTitle || this.phase === "attract";
    if (this.phase === "zoom" && T - this.zoomAt > ZOOM && (wheel || T - this.zoomAt > ZOOM + 1.5)) this.phase = "none";   // (the wheel up, or soon after: a quick player may already be past the main menu)
    const skin = this.on && P && P.menuWheel && P.menuWheel.skin, skinOn = !!(skin && !wheel && !title && this.phase !== "zoom" && P.frames - skin.at <= 2);   // (a sub-menu's loop running now)
    const opts = !!(this.on && P && P.menuWheel && P.menuWheel.optionsOpen && this.opts);   // OPTIONS: open (from the main menu or a match's options)
    const show = title || wheel || this.phase === "zoom" || skinOn || opts;
    // BACKDROP: the front end's screens (the wheel, the sub-menus, OPTIONS from the menu) play over a moving night court of their own,
    // not the game's screen; a match's pause menu and its OPTIONS keep the match behind them. Between two screens (the game's
    // slide-out, load and slide-in, where no skin is up) the last picture stays up over the backdrop for a moment, fading, so the
    // game's own menu never shows through.
    const front = show && !title && (wheel || this.phase === "zoom" || (skinOn && skin.icon !== "pause") || (opts && !P.menuWheel.pauseMore));
    if (front) this.lastFront = F;
    const court = this.isCourt && this.isCourt();                                  // (a match's court is up: no more holding)
    const hold = !show && !court && this.on && this.lastFront && F - this.lastFront < HOLD && F >= this.lastFront && this.snap;
    // TITLE SHOW (titleshow.js): behind the title and its zoom, the 3D view's flight through the venues (with the 3D view on), and on
    // behind the main menu and its sub-menus, softened under the panels (the drawn night court only without it)
    const live = !!(this.show && this.show.update(title || this.phase === "zoom" || front || hold));
    if (!show && !hold) { this.lastFront = 0; if (this.root && this.root.style.display !== "none") this.root.style.display = "none"; return; }
    this.ui();
    const view = [document.getElementById("gl"), document.getElementById("screen")].find(e => e && !e.hidden && e.offsetWidth > 0); if (!view) return;
    const r = view.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    Object.assign(this.root.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr); if (this.cv.width !== W || this.cv.height !== H) { this.cv.width = W; this.cv.height = H; }
    if (!this.ball) this.ball = makeBall();
    const zooming = this.phase === "zoom", opaque = title || (zooming && T - this.zoomAt < ZOOM);
    this.root.style.background = live ? (front || hold ? "rgba(8,10,32,0.3)" : "transparent") : opaque || front || hold ? "#0b1024" : "rgba(8,10,32,0.35)";
    const blur = live && !front && !hold ? "none" : "blur(7px) brightness(0.62)"; if (this.root.style.backdropFilter !== blur) { this.root.style.backdropFilter = blur; this.root.style.webkitBackdropFilter = blur; }
    this.bgcv.style.display = (front || hold) && !live ? "block" : "none";
    if ((front || hold) && !live) this.backdrop(W, H, T);
    if (hold) {                                                                   // between two screens: the last one, fading
      const g = this.cv.getContext("2d"); g.clearRect(0, 0, W, H); g.globalAlpha = Math.max(0, 1 - (F - this.lastFront) / HOLD); g.drawImage(this.snap, 0, 0, W, H); g.globalAlpha = 1; return;
    }
    if (title) { this.drawTitle(gb, W, H, T, live); return; }
    if (zooming && (T - this.zoomAt < ZOOM || !wheel)) { this.drawZoom(gb, W, H, Math.min(1, (T - this.zoomAt) / ZOOM), T, live); return; }
    this.phase = "none";
    if (opts) { this.drawOptions(W, H); this.keep(front); return; }
    if (skinOn) { (this.skins || (this.skins = new MenuSkins(this))).draw(this.cv.getContext("2d"), W, H, skin, gb, this.getHd && this.getHd()); this.keep(front); return; }
    const w0 = gb.mem.wram[0], sel = P.menuWheel.virtual ? NC - 1 : Math.min(8, w0[0xB05] * 3 + w0[0xB04]);          // wMenuCursorY / X (or OPTIONS)
    // the wheel turns smoothly towards the chosen cell (the shorter way round)
    let d = sel - this.pos; if (d > NC / 2) d -= NC; if (d < -NC / 2) d += NC; this.pos += d * 0.3; if (Math.abs(d) < 0.01) this.pos = sel;
    this.draw(gb, sel, W, H); this.keep(true);
  }
  // the picture just drawn, kept for the gap before the next screen (BACKDROP)
  keep(front) {
    if (!front) return; const c = this.cv;
    if (!this.snap) this.snap = document.createElement("canvas");
    if (this.snap.width !== c.width || this.snap.height !== c.height) { this.snap.width = c.width; this.snap.height = c.height; }
    const g = this.snap.getContext("2d"); g.clearRect(0, 0, c.width, c.height); g.drawImage(c, 0, 0);
  }
  // BACKDROP: the title's night court, alive: the camera drifting in and swaying, a rally crossing the court (the ball on its arc, its
  // shadow, a short trail), camera flashes in the stands; drawn at half size (soft), darkened a little under the panels
  backdrop(W, H, T) {
    const c = this.bgcv, w = Math.max(2, Math.round(W / 2)), h = Math.max(2, Math.round(H / 2));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext("2d"), z = 1.08 + 0.05 * Math.sin(T * 0.11), ox = Math.sin(T * 0.07) * w * 0.03, oy = Math.cos(T * 0.09) * h * 0.015;
    const X = x => (x - w / 2) * z + w / 2 + ox, Y = y => (y - h / 2) * z + h / 2 + oy;
    g.drawImage(this.scene(w, h), X(0), Y(0), w * z, h * z);
    const P = (u, v) => { const [x, y, d] = courtPoint(u, v, w, h); return [X(x), Y(y), d]; };   // (scene()'s court)
    let s = (Math.floor(T * 6) * 2654435761) >>> 0; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 3; i++) if (rnd() < 0.5) { const fx = X(rnd() * w), fy = Y(h * (0.1 + rnd() * 0.3)), r = g.createRadialGradient(fx, fy, 0, fx, fy, w * 0.02); r.addColorStop(0, "rgba(255,255,255,0.9)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(fx - w * 0.02, fy - w * 0.02, w * 0.04, w * 0.04); }
    const ball = t => { const q = (t % 2.4) / 1.2, back = q > 1, f = back ? q - 1 : q, v = back ? 0.12 + 1.0 * f : 1.12 - 1.0 * f, u = 0.32 * Math.sin(t * 0.9) * (back ? 1 - f : f) + 0.1;
      const [bx, by, d] = P(u, v), m = courtHeight(d * 6, h), hgt = Math.sin(Math.min(1, f * 1.25) * Math.PI) * m * 2.6 + Math.abs(Math.sin((f - 0.8) * Math.PI * 5)) * (f > 0.8 ? m * 0.5 : 0); return [bx, by, by - hgt, d]; };
    const [sx, sy, , d0] = ball(T); g.fillStyle = "rgba(0,0,0,0.35)"; g.beginPath(); g.ellipse(sx, sy, w * 0.012 / d0 * 2, w * 0.005 / d0 * 2, 0, 0, 6.2832); g.fill();
    for (let i = 6; i >= 0; i--) { const [bx, , gy, d] = ball(T - i * 0.025), r = w * 0.009 / d * 2 * (1 - i * 0.08); g.fillStyle = i ? `rgba(232,240,74,${0.12 * (7 - i) / 7})` : "#e8f04a"; g.beginPath(); g.arc(bx, gy, r, 0, 6.2832); g.fill(); }
    g.fillStyle = "rgba(6,8,24,0.28)"; g.fillRect(0, 0, w, h);
  }
  draw(gb, sel, W, H) {
    const g = this.cv.getContext("2d"), k = Math.min(W / 1280, H / 720), cy = H / 2, br = 250 * k, bx = -60 * k;
    g.clearRect(0, 0, W, H);
    // the ball (the title's, turning as the wheel turns)
    this.menuBall(g, bx, cy, br, -this.pos * 0.35);
    // the cells on the arc: the chosen one on a gold pill, the others fading with their distance from it
    for (let i = 0; i < NC; i++) {
      let o = i - this.pos; if (o > NC / 2) o -= NC; if (o < -NC / 2) o += NC; if (Math.abs(o) > 3.6) continue;
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
    if (c.options) this.gear(g, px + pw / 2, py + 120 * k, 86 * k);
    else {
      const [cx0, cy0, cw, ch] = c.r, fr = gb.ppu.bgFrame || gb.ppu.frame, cc = this.cell; cc.width = cw; cc.height = ch;   // (the background only: the chosen cell's name banner and bobbing frame are sprites over it)
      const cg = cc.getContext("2d"), im = cg.createImageData(cw, ch), u32 = new Uint32Array(im.data.buffer);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) u32[y * cw + x] = fr[(cy0 + y) * 160 + cx0 + x] | 0xFF000000;
      cg.putImageData(im, 0, 0);
      const s = Math.min(300 * k / cw, 180 * k / ch); g.imageSmoothingEnabled = false; g.drawImage(cc, px + (pw - cw * s) / 2, py + 26 * k, cw * s, ch * s);
    }
    g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#281e0a"; g.font = `${40 * k}px "${FONT}", ${BODY}`;
    g.fillText(c.file != null ? (f ? f.name.toUpperCase() : c.name) : c.name, px + pw / 2, py + 250 * k);
    g.fillStyle = "#464a64"; g.font = `${23 * k}px ${BODY}`;
    const line = c.file != null ? (f ? `Level ${f.level}  ·  ${f.h} h ${String(f.m).padStart(2, "0")} m played` : "Start a new Mario Tour") : c.line;
    g.fillText(line, px + pw / 2, py + 310 * k); g.textAlign = "start";
    g.fillStyle = "#dce2f5"; g.font = `${24 * k}px ${BODY}`; g.textAlign = "right"; g.fillText("▲ ▼ turn the ball   A choose   B back", W - 60 * k, H - 40 * k); g.textAlign = "start";
  }
  // the court at night for the title: a navy court in perspective with its lines, floodlit, a dark stand of dots, soft (drawn once per size)
  scene(W, H) {
    const key = W + "x" + H, S = this.scenes || (this.scenes = new Map()); if (S.has(key)) return S.get(key);
    if (S.size > 3) S.clear();
    const c = document.createElement("canvas"); c.width = W; c.height = H; S.set(key, c); const g = c.getContext("2d");
    let gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "#070a1c"); gr.addColorStop(0.42, "#141a3a"); gr.addColorStop(0.43, "#3a2a6a"); gr.addColorStop(1, "#24184c"); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    let a = 0x9e3779b9; const rnd = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
    for (let i = 0; i < 2600; i++) { const x = rnd() * W, y = H * (0.08 + rnd() * 0.33); g.fillStyle = `hsla(${rnd() * 360},55%,${35 + rnd() * 30}%,0.8)`; g.fillRect(x, y, 2 + rnd() * 3, 3 + rnd() * 3); }   // the crowd
    const P = (u, v) => courtPoint(u, v, W, H);                                     // court u -1..1, v 0 (far)..1.2 (near)
    const quad = (u0, v0, u1, v1, fill) => { g.fillStyle = fill; g.beginPath(); for (const [u, v] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]) g.lineTo(...P(u, v)); g.fill(); };
    g.fillStyle = "#0c1230"; g.fillRect(0, H * 0.41, W, P(0, -0.35)[1] - H * 0.41 + 1);           // the back wall under the stand, its boards
    for (let i = 0; i < 7; i++) { const x0 = W * (0.06 + i * 0.13); g.fillStyle = i % 2 ? "#23306a" : "#2c2560"; g.fillRect(x0, H * 0.425, W * 0.11, (P(0, -0.35)[1] - H * 0.425) * 0.8); }
    quad(-1.2, -0.35, 1.2, 1.4, "#1f5468");                                       // the run-off round the court
    quad(-0.62, 0, 0.62, 1.2, "#1c3a92");                                         // the court: doubles width, baseline to baseline
    g.strokeStyle = "rgba(255,255,255,0.92)"; g.lineWidth = Math.max(2, W / 400);
    const line = (u0, v0, u1, v1) => { g.beginPath(); g.moveTo(...P(u0, v0)); g.lineTo(...P(u1, v1)); g.stroke(); };
    for (const u of [-0.62, -0.465, 0.465, 0.62]) line(u, 0, u, 1.2);              // the doubles and singles sidelines
    for (const v of [0, 1.2]) line(-0.62, v, 0.62, v);                            // the baselines
    for (const v of [0.297, 0.903]) line(-0.465, v, 0.465, v);                    // the service lines, 6.4 m either side of the net
    line(0, 0.297, 0, 0.903); line(0, 0, 0, 0.012); line(0, 1.2, 0, 1.17);        // the centre service line and the centre marks
    const nz = 6 + 0.6 * 19.81, nh = courtHeight(nz, H) * 1.07, na = P(-0.68, 0.6), nb = P(0.68, 0.6), mh = courtHeight(nz, H) * 0.914;   // the net: posts 1.07 m, 0.914 m in the middle
    g.fillStyle = "rgba(10,12,20,0.72)"; g.beginPath(); g.moveTo(na[0], na[1]); g.lineTo(na[0], na[1] - nh); g.lineTo(W / 2, na[1] - mh); g.lineTo(nb[0], nb[1] - nh); g.lineTo(nb[0], nb[1]); g.closePath(); g.fill();
    g.strokeStyle = "rgba(255,255,255,0.16)"; g.lineWidth = 1; for (let i = 1; i < 40; i++) { const x = na[0] + (nb[0] - na[0]) * i / 40; g.beginPath(); g.moveTo(x, na[1]); g.lineTo(x, na[1] - nh + (nh - mh) * (1 - Math.abs(x - W / 2) / ((nb[0] - na[0]) / 2))); g.stroke(); }
    g.strokeStyle = "#f4f6ff"; g.lineWidth = Math.max(2, W / 360); g.beginPath(); g.moveTo(na[0], na[1] - nh); g.lineTo(W / 2, na[1] - mh); g.lineTo(nb[0], nb[1] - nh); g.stroke();   // the white tape
    g.fillStyle = "#c8ccd8"; const pw = Math.max(2, W / 300); g.fillRect(na[0] - pw, na[1] - nh, pw * 2, nh); g.fillRect(nb[0] - pw, nb[1] - nh, pw * 2, nh);   // the posts
    for (const x of [0.12, 0.88]) { const r = g.createRadialGradient(W * x, H * 0.05, 0, W * x, H * 0.05, W * 0.5); r.addColorStop(0, "rgba(255,248,210,0.35)"); r.addColorStop(1, "rgba(255,248,210,0)"); g.fillStyle = r; g.fillRect(0, 0, W, H); }   // floodlights
    const soft = document.createElement("canvas"); soft.width = W; soft.height = H; const sg = soft.getContext("2d"); sg.filter = "blur(" + Math.round(W / 160) + "px)"; sg.drawImage(c, 0, 0); g.clearRect(0, 0, W, H); g.drawImage(soft, 0, 0);
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.75); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.6)"); g.fillStyle = v; g.fillRect(0, 0, W, H);
    return c;
  }
  drawTitle(gb, W, H, T, live) {
    const g = this.cv.getContext("2d"), k = Math.min(W / 1280, H / 720);
    if (live) this.showShade(g, W, H, k); else g.drawImage(this.scene(W, H), 0, 0);
    g.drawImage(crestLogo(), 20 * k, 10 * k, 800 * k, 450 * k);
    this.menuBall(g, W - 300 * k, H - 210 * k, 150 * k, -this.pos * 0.35 + Math.sin(T * 0.6) * 0.15);
    const pulse = 0.65 + 0.35 * Math.sin(T * 4);
    g.font = `${58 * k}px "${FONT}", ${BODY}`; g.textBaseline = "middle"; g.fillStyle = "rgba(0,0,0,0.6)"; g.fillText("PRESS START", 64 * k, H - 76 * k);
    g.fillStyle = `rgba(255,255,255,${pulse})`; g.fillText("PRESS START", 60 * k, H - 80 * k);
  }
  // Start: the ball zooms in towards the camera, then rolls left to the wheel's place as the scene fades into the menu
  drawZoom(gb, W, H, u, T, live) {
    const g = this.cv.getContext("2d"), k = Math.min(W / 1280, H / 720), e = u * u * (3 - 2 * u);
    g.clearRect(0, 0, W, H);
    if (live) { g.fillStyle = `rgba(11,16,36,${e * 0.15})`; g.fillRect(0, 0, W, H); }      // (the venues stay on behind the menu, softened)
    g.globalAlpha = 1 - e; if (!live) g.drawImage(this.scene(W, H), 0, 0); g.drawImage(crestLogo(), 20 * k - e * 400 * k, 10 * k, 800 * k, 450 * k); g.globalAlpha = 1;
    const x0 = W - 300 * k, y0 = H - 210 * k, r0 = 150 * k, x1 = -60 * k, y1 = H / 2, r1 = 250 * k;
    const grow = Math.sin(Math.min(1, u * 1.6) * Math.PI) * 0.55;                 // in towards the camera first
    const x = x0 + (x1 - x0) * e, y = y0 + (y1 - y0) * e, r = (r0 + (r1 - r0) * e) * (1 + grow);
    this.menuBall(g, x, y, r, -this.pos * 0.35 - e * 6.2832);             // one whole turn, landing as the wheel shows it
  }
  // TITLE SHOW: over the venue's shot, a shade where the crest and PRESS START sit, and the venue's name in the corner
  showShade(g, W, H, k) {
    g.clearRect(0, 0, W, H);
    const gr = g.createLinearGradient(0, 0, W * 0.75, 0); gr.addColorStop(0, "rgba(6,8,20,0.55)"); gr.addColorStop(1, "rgba(6,8,20,0)");
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const gb2 = g.createLinearGradient(0, H * 0.7, 0, H); gb2.addColorStop(0, "rgba(6,8,20,0)"); gb2.addColorStop(1, "rgba(6,8,20,0.5)");
    g.fillStyle = gb2; g.fillRect(0, H * 0.7, W, H * 0.3);
    const name = this.show && this.show.name; if (!name) return;
    g.font = `${26 * k}px "${FONT}", ${BODY}`; g.textBaseline = "middle"; g.textAlign = "right";
    g.fillStyle = "rgba(0,0,0,0.55)"; g.fillText(name, W - 28 * k, 38 * k); g.fillStyle = "rgba(255,255,255,0.9)"; g.fillText(name, W - 30 * k, 36 * k);
    g.textAlign = "left";
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
