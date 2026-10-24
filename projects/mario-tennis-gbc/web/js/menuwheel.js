// "MENU: Wheel / Game": the main menu as a ball wheel (render-time overlay, the game's own menu runs underneath). A big tennis ball at
// the left, the menu's nine cells on an arc round it (Exhibition, Mini-games, Linked play, the three tour files, Status, Dictionary,
// Saved data); the chosen one slides out on a gold pill, and a panel at the right shows its picture (the game's own cell, copied from the
// screen as it draws it, highlighted) with a line about it; a tour file shows its player, level and play time.
// The port's main menu (port/menus/main_menu/main_menu.js) does the choosing: with P.menuWheel.on the d-pad steps through the nine cells
// in order (up / left back, down / right on) instead of round the 3 x 3 grid; A and B are the game's. The overlay shows only while the
// menu waits for a choice (P.menuWheel.active), so the game's slide-in and slide-out play as they are. Through the JS port only.
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
  update() {
    this.sync();
    const P = this.getPort(), gb = this.getGb(), act = !!(this.on && P && P.menuWheel && P.menuWheel.active && gb);
    if (!act) { if (this.root && this.root.style.display !== "none") this.root.style.display = "none"; return; }
    this.ui();
    const view = [document.getElementById("gl"), document.getElementById("screen")].find(e => e && !e.hidden && e.offsetWidth > 0); if (!view) return;
    const r = view.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    Object.assign(this.root.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr); if (this.cv.width !== W || this.cv.height !== H) { this.cv.width = W; this.cv.height = H; }
    const w0 = gb.mem.wram[0], sel = Math.min(8, w0[0xB05] * 3 + w0[0xB04]);          // wMenuCursorY / X
    // the wheel turns smoothly towards the chosen cell (the shorter way round the nine)
    let d = sel - this.pos; if (d > 4.5) d -= 9; if (d < -4.5) d += 9; this.pos += d * 0.3; if (Math.abs(d) < 0.01) this.pos = sel;
    this.draw(gb, sel, W, H);
  }
  draw(gb, sel, W, H) {
    const g = this.cv.getContext("2d"), k = Math.min(W / 1280, H / 720), cy = H / 2, br = 250 * k, bx = -60 * k;
    g.clearRect(0, 0, W, H);
    // the ball: glow, felt, seam, a soft highlight
    g.save(); g.shadowColor = "rgba(220,255,120,0.55)"; g.shadowBlur = 40 * k; g.fillStyle = "#d6ec46"; g.beginPath(); g.arc(bx, cy, br, 0, 6.2832); g.fill(); g.restore();
    g.lineWidth = 6 * k; g.strokeStyle = "#96aa1e"; g.beginPath(); g.arc(bx, cy, br, 0, 6.2832); g.stroke();
    g.save(); g.beginPath(); g.arc(bx, cy, br - 3 * k, 0, 6.2832); g.clip(); g.lineWidth = 11 * k; g.strokeStyle = "#fff";
    const turn = -this.pos * 0.28;
    for (const c of [-1, 1]) { g.beginPath(); g.ellipse(bx + Math.cos(turn) * c * br * 1.2, cy + Math.sin(turn) * c * br * 1.2, br * 0.95, br * 0.95, 0, 0, 6.2832); g.stroke(); }
    const hl = g.createRadialGradient(bx + br * 0.3, cy - br * 0.45, 0, bx + br * 0.3, cy - br * 0.45, br * 0.6); hl.addColorStop(0, "rgba(255,255,230,0.45)"); hl.addColorStop(1, "rgba(255,255,230,0)"); g.fillStyle = hl; g.fillRect(bx - br, cy - br, br * 2, br * 2);
    g.restore();
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
    const [cx0, cy0, cw, ch] = c.r, fr = gb.ppu.frame, cc = this.cell; cc.width = cw; cc.height = ch;
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
  pill(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
}
export function attachMenuWheel(getGb, getPort, hud) {
  const mw = new MenuWheel(getGb, getPort);
  if (typeof window !== "undefined") window.__menuWheel = mw;   // (tests)
  const b = document.createElement("span"); b.className = "k"; b.id = "menubtn"; b.title = "the main menu: a ball wheel, or the game's own grid (needs the JS port)";
  const show = () => { b.textContent = "MENU: " + (mw.on ? "Wheel" : "Game"); b.classList.toggle("on", mw.on); }; show();
  b.addEventListener("pointerdown", () => { mw.setStyle(mw.on ? "game" : "wheel"); show(); });
  hud.appendChild(document.createTextNode(" ")); hud.appendChild(b);
  return mw;
}
