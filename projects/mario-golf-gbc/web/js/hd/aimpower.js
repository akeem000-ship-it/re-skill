// AIM & SWING HELPERS (the play page, render / UI only): four options drawn over the game's picture, in 2D (+HD) and in 3D.
//   Meter    Big (default) | Game: while the game's swing meter runs, a big HD meter grows into the middle of the picture (~170 ms),
//            with a glowing MAX mark, the PERFECT line at 0 and its window, a fading trail behind the cursor, the power held
//            ("90% · 242 y": ScaleByPower 10:6865 of ClubBaseDistance 10:68B1) and NICE! on a perfect impact; it shrinks back
//            after the impact. The meter's speed and timing are the game's own: it only reads wSwingCount / wSwingCursor /
//            wSwingPower / wSwingPerfect ($D44E-$D451, the swing loop 10:57E0) and covers the game's small meter while it is big.
//   Preview  On (default) | Off: while aiming, the flight of a perfect full-power swing with this club, aim, lie and wind: a dotted
//            arc, the landing ring, the roll to rest and "carry X y · Y y" (putter: the roll line to where a full-power putt
//            stops). Computed by the game's own shot code on a copy of the memory (shotpreview.js).
//   Markers  On (default) | Off: the aim line from the ball to the target marker ($D426 / $D428, 10:56EF), a bold ring there with the
//            club's yards (the shot panel's number), faint rings every 50 y round the ball, the pin's distance over the flag
//            (PinDist 10:62AD >> 5, feet with the putter as the HUD's 12:4CB1); marks off the picture sit at its edge with an arrow.
//   Tap area On (default on touch screens) | Off: at the address and through the swing the lower half of the screen is the A
//            button (the d-pad, B and the other controls keep their own places): it sets the same key the pad's A sets.
// PUTTING VIEW (the 3D view's Putting: Green camera, scene.puttView while a putt is aimed): instead of the aim line and the full
//            putt, THE BREAK: the roll path and stop point of a putt struck at 100 / 75 / 50 / 25 % (the putter's one press at count
//            $3C / $2D / $1E / $0F), each run by the game's own shot code on a copy (shotpreview.js runPreview), with its roll in feet
//            (ShotLength 10:6276 in the HUD's conversion 12:4CB1) or "in"; labels placed so they don't overlap; and a light grid of the
//            green's tiles only near the line, each with a chevron along its slope (GreenSlopeAt 10:64D1, hole3d.js greenSlopes; its
//            colour the strength 1 / 2 / 3), a ring round the cup (never smaller than ~7 px, so a long putt's cup stays readable).
//            Lines with Preview on, the grid and the cup's ring with Markers on.
// 3D: the marks are drawn from the 3D view's own matrix; 2D: from the hole view's projection (the course view's scroll, the green
// view's 4x corner, the view behind the golfer's camera, 11:4795). Nothing here writes to the game's memory.
import { rd16 } from "../golf/memory.js";
import { pinDist } from "../golf/cup.js";
import { baseDistance, scaleByPower } from "../golf/launch.js";
import { mapPlace } from "./wide.js";
import { ShotPreview, previewKey, humanTurn, PUTTER, feetText, runPreview, PUTT_POWERS } from "./shotpreview.js";

const stored = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const keep = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
const s8 = v => v << 24 >> 24;
const ease = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const GROW = 10, HOLD = 14, SHRINK = 10;             // game frames: the meter grows in ~170 ms, shows the impact ~230 ms, shrinks in ~170 ms

export const OPTIONS = {
  meter: { label: "Meter", key: "mg-meter", values: [["big", "Big"], ["game", "Game"]], def: "big" },
  preview: { label: "Preview", key: "mg-preview", values: [["on", "On"], ["off", "Off"]], def: "on" },
  marks: { label: "Markers", key: "mg-marks", values: [["on", "On"], ["off", "Off"]], def: "on" },
  tap: { label: "Tap area", key: "mg-tap", values: [["on", "On"], ["off", "Off"]], def: "on", touch: true },
};

// ---- drawing helpers ----
const FONT = '"DejaVu Sans", system-ui, sans-serif';
function rrect(g, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function label(g, text, x, y, size, fill = "#fff", align = "center") {
  g.font = `bold ${size}px ${FONT}`; g.textAlign = align; g.textBaseline = "middle"; g.lineJoin = "round";
  g.lineWidth = size * 0.28; g.strokeStyle = "rgba(0,0,0,0.85)"; g.strokeText(text, x, y); g.fillStyle = fill; g.fillText(text, x, y);
}
function pillSize(g, text, size) { g.font = `bold ${size}px ${FONT}`; return [g.measureText(text).width + size * 0.9, size * 1.45]; }
function pill(g, text, x, y, size, bg, fg = "#fff") {
  const [w, h] = pillSize(g, text, size);
  g.fillStyle = bg; rrect(g, x - w / 2, y - h / 2, w, h, h / 2); g.fill();
  g.strokeStyle = "rgba(0,0,0,0.55)"; g.lineWidth = Math.max(1, size * 0.1); g.stroke();
  g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, x, y + size * 0.04);
}

// labels collected, then placed so they don't overlap (later ones move down or up) and kept inside the box; a label whose point is
// off the picture sits at the edge with an arrow
class Pills {
  constructor(g, box) { this.g = g; this.box = box; this.list = []; }
  add(text, x, y, size, bg, prio = 0) { this.list.push({ text, x, y, size, bg, prio }); }
  draw() {
    const g = this.g, b = this.box, placed = [];
    this.list.sort((a, c) => c.prio - a.prio);
    for (const p of this.list) {
      let arrow = "", { x, y } = p;
      if (y < b.t) { arrow = "▲ "; y = b.t; } else if (y > b.b) { arrow = "▼ "; y = b.b; }
      if (x < b.l) { arrow = arrow || "◀ "; } else if (x > b.r) { arrow = arrow || "▶ "; }
      const text = arrow + p.text, [w, h] = pillSize(g, text, p.size);
      x = Math.max(b.l + w / 2, Math.min(b.r - w / 2, x));
      const hit = yy => placed.some(q => Math.abs(q.x - x) < (q.w + w) / 2 + 2 && Math.abs(q.y - yy) < (q.h + h) / 2 + 1);
      let yy = y;
      for (let k = 1; k < 12 && hit(yy); k++) yy = y + (k & 1 ? 1 : -1) * Math.ceil(k / 2) * (h + 2);
      yy = Math.max(b.t, Math.min(b.b, yy));
      placed.push({ x, y: yy, w, h });
      pill(g, text, x, yy, p.size, p.bg);
    }
  }
}

export function attachAimPower({ screen, keys, getGame }) {
  const q = new URLSearchParams(location.search), body = document.body;
  const opt = {};
  for (const [k, o] of Object.entries(OPTIONS)) { const v = q.get(k) || stored(o.key) || o.def; opt[k] = o.values.some(([x]) => x === v) ? v : o.def; }
  const cv = document.createElement("canvas"); cv.id = "aimpower"; cv.setAttribute("aria-hidden", "true");
  Object.assign(cv.style, { position: "absolute", left: "0", top: "0", pointerEvents: "none", zIndex: "6", display: "none" });
  document.body.appendChild(cv);
  const g = cv.getContext("2d");
  const preview = new ShotPreview();
  let shown = false, paintedAt = 0, lastGame = null, lastImage = null;
  const meter = { phase: "idle", at: 0, cnt: 0, cntAt: 0, frames: -1 };
  const pv = { key: "", since: 0 };
  const stats = { paints: 0, ms: 0, n: 0, cpu: 0 };

  // ---- the options on the page (after the picture options), remembered ----
  function mount() {
    const d = document.getElementById("hdopts"); if (!d) return;
    const touch = body.classList.contains("touch");
    for (const [k, o] of Object.entries(OPTIONS)) {
      if (o.touch && !touch) continue;
      const l = document.createElement("label"); l.textContent = o.label + " ";
      const s = document.createElement("select"); s.id = "ap" + k; s.title = k === "preview" ? "a helper: the flight of a perfect full-power swing" : "";
      for (const [v, t] of o.values) { const e = document.createElement("option"); e.value = v; e.textContent = t; s.appendChild(e); }
      s.value = opt[k]; s.addEventListener("change", () => { opt[k] = s.value; keep(o.key, s.value); s.blur(); paint(); });
      l.appendChild(s); d.appendChild(l); d.appendChild(document.createTextNode(" "));
    }
  }

  // ---- where things are: the overlay over the screen, and the game's picture in it ----
  function place() {
    const r = screen.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.max(160, Math.round(r.width * dpr)), H = Math.max(144, Math.round(r.height * dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    Object.assign(cv.style, { left: r.left + scrollX + "px", top: r.top + scrollY + "px", width: r.width + "px", height: r.height + "px" });
    return [W, H];
  }
  // the 3D view's scene when it drew this hole, else null
  function scene3d() {
    const p = window.__g3d, v = p && p.canvas, sc = p && p.scene;
    return v && v.style.display !== "none" && sc && sc.kind === "hole" && sc.s && sc.mvp ? sc : null;
  }
  // the frame: game px -> overlay px. 2D: the 160 x 144 frame inside the picture (a wide picture has the map at its sides);
  // 3D: the HUD is laid over the whole canvas
  function frameOf(W, H, sc) {
    const pw = sc ? 160 : (window.__hd && window.__hd.view ? window.__hd.view.width : 160) || 160;
    const sx = sc ? W / 160 : W / pw, sy = H / 144, ox = sc ? 0 : (pw - 160) / 2 * sx;
    return { W, H, sx, sy, ox, X: x => ox + x * sx, Y: y => y * sy, u: sy, pw };
  }

  // ---- P2: the big meter ----
  function meterState(game) {
    const r6 = game.w.wram[6], cnt = r6[0x44E], f = game.frames;
    if (f !== meter.frames) {
      if (cnt !== meter.cnt) { meter.cnt = cnt; meter.cntAt = f; }
      const running = game.mark === "address" && cnt > 0 && f - meter.cntAt < 2;
      if (running && meter.phase !== "run") { meter.phase = "run"; meter.at = f; }
      else if (!running && meter.phase === "run") { meter.phase = "after"; meter.at = f; }
      else if (meter.phase === "after" && f - meter.at > HOLD + SHRINK) meter.phase = "idle";
      meter.frames = f;
    }
    if (meter.phase === "run") return ease((f - meter.at + 1) / GROW);
    if (meter.phase === "after") return 1 - ease((f - meter.at - HOLD) / SHRINK);
    return 0;
  }
  // where the big meter goes (game px: its bar's top and height): clear of the golfer. In 2D the golfer stands at the bottom of the
  // picture behind the ball (the view behind the golfer); in 3D he is where the camera shows him: the meter takes the larger free
  // space above his head or below his feet (the labels above the bar, the HUD's text rows at the corners kept)
  function bigPlace(F) {
    const sc = F.sc;
    if (!sc || !sc.golferAt) return { y: 56, h: 30, x0: 0.05, x1: 0.95 };   // (2D: the golfer at the bottom, the HUD's face icon above)
    const m = sc.mvp, H = sc.hole.H, [gx, gz] = sc.golferAt, gy = H(gx, gz);
    const P = (x, y, z) => { const o = [0, 0, 0, 0]; for (let i = 0; i < 4; i++) o[i] = m[i] * x + m[4 + i] * y + m[8 + i] * z + m[12 + i]; return o[3] > 0.05 ? (0.5 - o[1] / o[3] * 0.5) * 144 : null; };
    const feet = P(gx, gy, gz), head = P(gx, gy + 4.6, gz);
    if (feet === null || head === null) return { y: 52, h: 30, x0: 0.05, x1: 0.95 };
    const x0 = 0.15, x1 = 0.82;   // (narrower: the HUD's text and face stay clear at the top corners)
    const top = 22, bottom = 114, above = head - top, below = bottom - feet;   // (the bar needs its labels' row above it, the pill's too)
    if (above >= below) { const h = Math.max(18, Math.min(30, above - 22)); return { y: Math.max(top + 12, head - 6 - h), h, x0, x1 }; }
    const h = Math.max(18, Math.min(30, below - 18)); return { y: Math.min(bottom - h, feet + 16), h, x0, x1 };
  }
  const U = c => (60 - c) / 78;                    // the bar: full power ($3C) at the left, 0 at 60/78, the timeout (-18) at the right
  const cursorAt = cnt => cnt >= 0x3C ? (0x78 - cnt) : cnt;
  function drawMeter(game, F, k) {
    const w = game.w, r6 = w.wram[6], cnt = r6[0x44E], cur = s8(r6[0x44F]), pow = r6[0x450], club = r6[0x329], putter = club === PUTTER;
    const after = meter.phase === "after";
    // the game's small meter (the HUD row y 128-143, x 43-130) covered with the HUD's colour while the big one shows
    const img = lastImage, o = (136 * 160 + 40) * 4;
    g.fillStyle = img ? `rgb(${img.data[o]},${img.data[o + 1]},${img.data[o + 2]})` : "#204020";
    g.fillRect(F.X(43), F.Y(128), 87 * F.sx, 16 * F.sy);
    // from the small meter's place (k 0) to the middle (k 1)
    const lerp = (a, b) => a + (b - a) * k;
    const fx0 = F.sc ? 0 : F.ox, fw = F.sc ? F.W : 160 * F.sx;
    const T = bigPlace(F);
    const x = lerp(F.X(44), fx0 + fw * T.x0), wd = lerp(84 * F.sx, fw * (T.x1 - T.x0)), y = lerp(F.Y(130), F.Y(T.y)), h = lerp(10 * F.sy, T.h * F.sy);
    const u = F.u * lerp(0.55, T.h / 30), hh = h;
    if (k > 0.02) { g.fillStyle = `rgba(0,0,0,${0.18 * k})`; g.fillRect(0, F.Y(T.y - 14), F.W, F.Y(T.h + 30)); }
    g.save(); g.globalAlpha = Math.min(1, 0.4 + k);
    // the panel
    g.save(); g.shadowColor = "rgba(0,0,0,0.5)"; g.shadowBlur = 6 * u; g.fillStyle = `rgba(14,22,30,${0.6 + 0.3 * k})`;
    rrect(g, x - 6 * u, y - 5 * u, wd + 12 * u, hh + 10 * u, 6 * u); g.fill(); g.restore();
    // the track: warm (full power) to cool (past the impact)
    const gr = g.createLinearGradient(x, 0, x + wd, 0);
    gr.addColorStop(0, "#ff5a36"); gr.addColorStop(0.25, "#ffb23a"); gr.addColorStop(0.62, "#7dd36a"); gr.addColorStop(U(0), "#4cc3ff"); gr.addColorStop(1, "#3a5d9a");
    g.fillStyle = gr; rrect(g, x, y + hh * 0.28, wd, hh * 0.44, hh * 0.22); g.fill();
    for (let c = 0; c <= 60; c += 6) { const tx = x + U(c) * wd; g.fillStyle = "rgba(255,255,255,0.5)"; g.fillRect(tx - 0.5 * u, y + hh * 0.2, 1 * u, hh * 0.6); }
    const mx = x + U(60) * wd, zx = x + U(0) * wd, one = wd / 78;
    // MAX: the full-power turn ($3C)
    g.save(); g.shadowColor = "#fff6a0"; g.shadowBlur = 10 * u; g.fillStyle = "#fff6a0"; g.fillRect(mx - 2 * u, y - 1 * u, 4 * u, hh + 2 * u); g.restore();
    label(g, "MAX", mx + 2 * u, y - 8 * u, 6.5 * u, "#fff6a0", "left");
    if (!putter) {
      // PERFECT: the impact exactly at 0 (wSwingPerfect), the count's own width; the faint window +-3 counts round it
      g.fillStyle = "rgba(255,255,255,0.16)"; g.fillRect(x + U(3) * wd, y, (U(-3) - U(3)) * wd, hh);
      g.save(); g.shadowColor = "#ffe14a"; g.shadowBlur = 12 * u; g.fillStyle = "#ffe14a"; g.fillRect(zx - Math.max(one, 2 * u) / 2, y - 2 * u, Math.max(one, 2 * u), hh + 4 * u); g.restore();
      label(g, "PERFECT", zx, y - 8 * u, 6.5 * u, "#ffe14a");
    }
    if (cnt || pow !== 0x80) {
      // the trail: the cursor's last frames (the cursor follows from the count)
      if (cnt && !after) for (let i = 10; i >= 1; i--) {
        const c = cursorAt(Math.max(0, cnt - i)), tx = x + U(s8(c)) * wd;
        g.fillStyle = `rgba(255,255,255,${0.42 * (1 - i / 11)})`; rrect(g, tx - 2.5 * u, y + hh * 0.12, 5 * u, hh * 0.76, 2 * u); g.fill();
      }
      // the power set by the first press, held where it stopped
      if (pow !== 0x80) {
        const p = s8(pow), px = x + U(p) * wd, full = pow === 0x3C;
        g.fillStyle = full ? "#fff6a0" : "#ff7a3a"; g.strokeStyle = "#000"; g.lineWidth = 1 * u;
        g.beginPath(); g.moveTo(px, y + hh + 1 * u); g.lineTo(px - 4.5 * u, y + hh + 8 * u); g.lineTo(px + 4.5 * u, y + hh + 8 * u); g.closePath(); g.fill(); g.stroke();
        g.fillRect(px - 1.5 * u, y, 3 * u, hh);
        const yd = putter ? null : scaleByPower(baseDistance(w), p) >> 5;
        const text = `${Math.round(p / 60 * 100)}%${yd != null ? " · " + yd + " y" : ""}`;
        const [pwid] = pillSize(g, text, 7 * u);   // (on the top row, between MAX and PERFECT: the golfer below stays clear)
        pill(g, text, mx + 24 * u + pwid / 2, y - 8 * u, 7 * u, full ? "rgba(170,140,0,0.95)" : "rgba(190,70,20,0.95)");
      }
      // the cursor
      const cx = x + U(cnt ? cur : 0) * wd;
      g.save(); g.shadowColor = "rgba(0,0,0,0.7)"; g.shadowBlur = 4 * u; g.fillStyle = "#ffffff"; rrect(g, cx - 2.5 * u, y - 3 * u, 5 * u, hh + 6 * u, 2.5 * u); g.fill(); g.restore();
      g.strokeStyle = "#1a1a1a"; g.lineWidth = 1 * u; rrect(g, cx - 2.5 * u, y - 3 * u, 5 * u, hh + 6 * u, 2.5 * u); g.stroke();
      if (after && !putter && r6[0x451] && pow !== 0x80) label(g, "NICE!", zx - 22 * u, y + hh * 0.5, 10 * u, "#ffe14a");
    }
    g.restore();
  }

  // ---- projections of world points (x, height over the ground, z; world px = 1/32 of the RAM's units) to the overlay ----
  function projector(game, F, sc) {
    const w = game.w, r6 = w.wram[6], w0 = w.wram[0];
    if (sc) {
      const m = sc.mvp, Hh = sc.hole.H;
      const P = (x, y, z) => { const o = [0, 0, 0, 0]; for (let i = 0; i < 4; i++) o[i] = m[i] * x + m[4 + i] * y + m[8 + i] * z + m[12 + i]; if (o[3] <= 0.05) return null; return [(o[0] / o[3] * 0.5 + 0.5) * F.W, (0.5 - o[1] / o[3] * 0.5) * F.H]; };
      return { kind: "3d", P: (x, h, z, up = 0.1) => P(x, Hh(x, z) + Math.max(0, h) + up, z), unit: F.u, green: sc.s.view === 1 };
    }
    const view = r6[0x443] & 7;
    if (view === 0) {                                // the course view: 1 px a world px from the scroll ($C320 / $C322); heights at half
      const sx = (rd16(w0, 0x320) & 0xFFE0) / 32, sy = (rd16(w0, 0x322) & 0xFFE0) / 32;
      return { kind: "course", P: (x, h, z) => [F.X(x - sx), F.Y(z - sy - Math.max(0, h) / 2)], unit: F.u };
    }
    if (view === 1) {                                // the green view: 4x from the green's corner ($D441 / $D442)
      const gx = r6[0x441] * 8, gy = r6[0x442] * 8;
      return { kind: "green", P: (x, h, z) => [F.X((x - gx) * 4), F.Y((z - gy - Math.max(0, h)) * 4)], unit: F.u, green: true };
    }
    if (view === 4) {                                // behind the golfer: 11:4795's camera ($D456 / $D458, angle $D45A), by the depth
      const cx = rd16(r6, 0x456) / 32, cz = rd16(r6, 0x458) / 32, a = rd16(r6, 0x45A) / 65536 * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      return { kind: "behind", unit: F.u, P: (x, h, z) => {
        const dx = (x - cx) * 32, dz = (z - cz) * 32, X = dx * ca - dz * sa, nz = -(dx * sa + dz * ca);
        if (nz < -0x200) return null;
        const k = 160 / Math.max(64, nz + 0x280);
        return [F.X(X * k / 2 + 0x50), F.Y((0x80 - Math.max(0, h) * 32) * k / 2 + 0x3C)];   // (the sprites' centres, as queueSprite takes them)
      } };
    }
    return null;
  }

  // ---- A5 + A2: the marks while aiming ----
  function drawAim(game, F, pr) {
    const w = game.w, r6 = w.wram[6], club = r6[0x329], putter = club === PUTTER, u = pr.unit;
    const ball = [(rd16(r6, 0x401) + r6[0x400] / 256) / 32, (rd16(r6, 0x404) + r6[0x403] / 256) / 32];
    const box = { l: F.sc ? 4 * u : F.ox + 4 * u, r: F.sc ? F.W - 4 * u : F.ox + 156 * F.sx, t: 8 * u, b: 118 * u };
    const pills = new Pills(g, box);
    g.lineCap = "round"; g.lineJoin = "round";
    const line = (pts, color, width, dash = null) => { g.beginPath(); let on = false; for (const p of pts) { if (!p) { on = false; continue; } if (on) g.lineTo(p[0], p[1]); else { g.moveTo(p[0], p[1]); on = true; } } g.setLineDash(dash || []); g.strokeStyle = color; g.lineWidth = width; g.stroke(); g.setLineDash([]); };
    const ring = (cx, cz, r, n = 72) => { const out = []; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; out.push(pr.P(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r)); } return out; };
    const green = !!pr.green, behind = pr.kind === "behind";   // (behind the golfer the game's picture squeezes the course into a band
    // at its horizon: marks of a fixed size there, no rings, aim line or arc)
    const flat = (p, rx, ry, color, wd) => { if (!p) return; g.beginPath(); g.ellipse(p[0], p[1], rx, ry, 0, 0, 7); g.strokeStyle = "rgba(0,0,0,0.5)"; g.lineWidth = wd + 2 * u; g.stroke(); g.strokeStyle = color; g.lineWidth = wd; g.stroke(); };
    g.save(); g.beginPath(); g.rect(F.sc ? 0 : F.ox, 0, F.sc ? F.W : 160 * F.sx, F.Y(126)); g.clip();   // (the picture above the HUD row)
    if (F.sc && F.sc.puttView && putter) { drawPuttView(game, F, pr, ball); g.restore(); return; }
    if (opt.marks === "on") {
      const aim = rd16(r6, 0x418) / 65536 * Math.PI * 2, ad = [Math.cos(aim), Math.sin(aim)], side = [ad[1], -ad[0]];
      const t = [rd16(r6, 0x426) / 32, rd16(r6, 0x428) / 32], tR = Math.hypot(t[0] - ball[0], t[1] - ball[1]);
      // rings every 50 y round the ball (not on the green: it shows a few yards)
      if (!green && !behind) {
        let lastLab = null;
        for (let r = 50; r <= Math.min(300, tR + 40); r += 50) {
          line(ring(ball[0], ball[1], r, 120), "rgba(255,255,255,0.33)", 1.3 * u, [5 * u, 4 * u]);
          const p = pr.P(ball[0] + ad[0] * r + side[0] * 7, 0.2, ball[1] + ad[1] * r + side[1] * 7);
          if (p && (lastLab === null || Math.abs(p[1] - lastLab) > 9 * u)) { label(g, r + "", p[0], p[1], 5.2 * u, "rgba(255,255,255,0.9)"); lastLab = p[1]; }
        }
      }
      // the aim line to the target marker, the target's ring and the club's yards
      if (rd16(r6, 0x428) && behind) {
        const p = pr.P(t[0], 0, t[1]); flat(p, 7 * u, 2.2 * u, "#ffd23a", 1.6 * u);
        if (p) pills.add("target " + (baseDistance(w) >> 5) + " y", p[0] + 30 * u, p[1] - 6 * u, 5.4 * u, "rgba(200,140,0,0.92)", 2);
      } else if (rd16(r6, 0x428)) {
        const pts = []; for (let i = 0; i <= 40; i++) pts.push(pr.P(ball[0] + (t[0] - ball[0]) * i / 40, 0.15, ball[1] + (t[1] - ball[1]) * i / 40));
        line(pts, "rgba(0,0,0,0.45)", 3.4 * u); line(pts, "rgba(255,240,90,0.95)", 1.6 * u, [4 * u, 3 * u]);
        if (!green) {
          const rr = ring(t[0], t[1], 6);
          line(rr, "rgba(0,0,0,0.5)", 4.2 * u); line(rr, "#ffd23a", 2.4 * u); line(ring(t[0], t[1], 1.6), "#ffd23a", 1.6 * u);
          const p = pr.P(t[0], 0.2, t[1]);
          if (p) pills.add("target " + (baseDistance(w) >> 5) + " y", p[0] + 26 * u, p[1], 6 * u, "rgba(200,140,0,0.92)", 2);
        }
      }
      // the pin's distance over the flag (yards; feet with the putter near the green, as the HUD)
      const hl = pinDist(r6.subarray(0x400, 0x500)), feet = putter && ((hl + 0xF7CB) & 0x8000);
      const cup = [rd16(r6, 0x43D) / 32, rd16(r6, 0x43F) / 32];
      const pp = pr.P(cup[0], green ? (pr.kind === "3d" ? 4.6 : 5) : (pr.kind === "3d" ? 5.5 : 14), cup[1]);
      if (pp && !behind) pills.add(feet ? feetText(hl) + " ft to cup" : (hl >> 5) + " y to pin", pp[0], pp[1] - 6 * u, 6 * u, "rgba(200,30,40,0.92)", 3);
    }
    if (opt.preview === "on") {
      const res = previewFor(w);
      if (res && res.path.length > 1) {
        const path = res.path, land = res.land, L = path[land], E = path[path.length - 1];
        const alpha = res.stale ? 0.35 : 1;
        g.globalAlpha = alpha;
        if (behind) flat(pr.P(L[0], 0, L[2]), 6 * u, 2 * u, "#7ef0ff", 1.6 * u);
        else if (!res.putt) {
          // the dotted arc and its shadow on the ground
          line(path.slice(0, land + 1).map(p => pr.P(p[0], 0, p[2], 0.05)), "rgba(0,0,0,0.25)", 1.4 * u, [1, 3 * u]);
          for (let i = 0; i <= land; i += 3) { const p = pr.P(path[i][0], path[i][1], path[i][2]); if (!p) continue;
            g.beginPath(); g.arc(p[0], p[1], 1.3 * u, 0, 7); g.fillStyle = "rgba(0,0,0,0.5)"; g.fill(); g.beginPath(); g.arc(p[0], p[1], 0.85 * u, 0, 7); g.fillStyle = "#fff"; g.fill(); }
          // the roll to rest
          line(path.slice(land).map(p => pr.P(p[0], 0, p[2], 0.12)), "rgba(255,255,255,0.8)", 1.2 * u, [2 * u, 2 * u]);
          const lr = ring(L[0], L[2], green || pr.kind === "green" ? 1.2 : 4.5);
          line(lr, "rgba(0,0,0,0.5)", 3.6 * u); line(lr, "#7ef0ff", 2 * u);
        } else {
          // the putt: the roll line to where a full-power putt stops
          const pts = path.map(p => pr.P(p[0], 0, p[2], 0.08));
          line(pts, "rgba(0,0,0,0.45)", 3 * u); line(pts, "#7ef0ff", 1.5 * u, [3 * u, 2 * u]);
        }
        const e = pr.P(E[0], 0, E[2], 0.2);
        if (e) { g.beginPath(); g.arc(e[0], e[1], 2 * u, 0, 7); g.fillStyle = "#7ef0ff"; g.fill(); g.strokeStyle = "#000"; g.lineWidth = 0.8 * u; g.stroke(); }
        g.globalAlpha = 1;
        if (!res.stale) {
          const at = res.putt ? e : pr.P(L[0], 0, L[2], 0.2);
          const text = res.putt ? `full putt: ${res.outcome === 0x80 ? "in" : (res.path.some(q => q[3]) ? "off the pin · " : "") + rollFeet(res) + " ft"}` : `carry ${res.carry} y · ${res.rest} y`;   // (a putt that hits the pin hops: in the air a moment)
          if (at) pills.add(text, at[0] - (behind ? 30 * u : 0), at[1] + (behind ? 8 : 11) * u, (behind ? 5.4 : 5.8) * u, "rgba(0,110,150,0.92)", 1);
        }
      }
    }
    g.restore();
    pills.draw();
  }
  // ---- the putting view: the break lines and the slope grid near the line ----
  const putts = { key: "", runs: null, ms: 0, pend: "", since: 0 };
  // the four putts (run again only when what decides the putt has held still ~90 ms, as the preview)
  function puttRuns(w) {
    const key = previewKey(w), now = performance.now();
    if (key === putts.key) return putts.runs;
    if (key !== putts.pend) { putts.pend = key; putts.since = now; }
    if (now - putts.since < 90 && putts.runs && putts.hole === w.wram[6][0x320]) return putts.runs.map(r => ({ ...r, stale: true }));
    const t = performance.now();
    try { putts.runs = PUTT_POWERS.map(power => runPreview(w, { power })); } catch (e) { console.warn("putt lines", e); putts.runs = null; }
    putts.ms = performance.now() - t; putts.key = key; putts.hole = w.wram[6][0x320];
    return putts.runs;
  }
  const PCOL = ["#ffffff", "#ffd84a", "#ffa040", "#ff6a5a"], SCOL = ["", "255,236,120", "255,160,40", "240,60,40"];
  function drawPuttView(game, F, pr, ball) {
    const w = game.w, r6 = w.wram[6], sc = F.sc, H = sc.hole.H, u = pr.unit, s = sc.s;
    const cup = [rd16(r6, 0x43D) / 32, rd16(r6, 0x43F) / 32], P = (x, z, up = 0.02) => pr.P(x, 0, z, up);
    const vx = cup[0] - ball[0], vz = cup[1] - ball[1], L2 = vx * vx + vz * vz || 1;
    const segDist = (x, z) => { const t = Math.max(-0.15, Math.min(1.25, ((x - ball[0]) * vx + (z - ball[1]) * vz) / L2)); return Math.hypot(x - ball[0] - vx * t, z - ball[1] - vz * t); };
    g.lineCap = "round"; g.lineJoin = "round";
    // the grid: the green's tiles (2 px) near the line, fading away from it; a chevron along each sloped tile's push
    if (opt.marks === "on") {
      const gs = sc.hole.art.greenSlopes();
      for (let ty = 0; ty < 16; ty++) for (let tx = 0; tx < 20; tx++) {
        const q = (ty * 64 + tx) * 4; if (!gs[q + 3]) continue;
        const x0 = s.green[0] + tx * 2, z0 = s.green[1] + ty * 2, a = Math.exp(-Math.pow(segDist(x0 + 1, z0 + 1) / 2.5, 2)); if (a < 0.04) continue;
        const c = [P(x0, z0, 0.01), P(x0 + 2, z0, 0.01), P(x0 + 2, z0 + 2, 0.01)]; if (c.some(p => !p)) continue;
        g.strokeStyle = `rgba(255,255,255,${0.5 * a})`; g.lineWidth = Math.max(1, 0.5 * u); g.beginPath(); g.moveTo(c[0][0], c[0][1]); g.lineTo(c[1][0], c[1][1]); g.lineTo(c[2][0], c[2][1]); g.stroke();
        const st = gs[q + 2] / 85; if (!st) continue;
        const dx = (gs[q] - 127.5) / 127.5, dz = (gs[q + 1] - 127.5) / 127.5, cx = x0 + 1, cz = z0 + 1, l = 0.35 + 0.2 * st, wv = 0.32, n = [-dz, dx];
        const tip = P(cx + dx * l, cz + dz * l), tail = P(cx - dx * l, cz - dz * l);
        const bl = P(cx + dx * (l - wv) + n[0] * wv * 0.8, cz + dz * (l - wv) + n[1] * wv * 0.8), br = P(cx + dx * (l - wv) - n[0] * wv * 0.8, cz + dz * (l - wv) - n[1] * wv * 0.8);
        if (!tip || !tail || !bl || !br) continue;
        g.strokeStyle = `rgba(${SCOL[Math.round(st)]},${(0.95 * a).toFixed(2)})`; g.lineWidth = Math.max(1.5, 1.1 * u);
        g.beginPath(); g.moveTo(tail[0], tail[1]); g.lineTo(tip[0], tip[1]); g.moveTo(bl[0], bl[1]); g.lineTo(tip[0], tip[1]); g.lineTo(br[0], br[1]); g.stroke();
      }
    }
    // the cup, kept readable far off (a long putt): a white ring round it, at least ~7 px across on the picture
    if (opt.marks === "on") {
      const c0 = P(cup[0] - 0.15, cup[1]), c1 = P(cup[0] + 0.15, cup[1]), c = P(cup[0], cup[1]);
      if (c && c0 && c1) {
        const k = Math.max(1, 3.5 * u / Math.max(0.5, Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) / 2)), pts = [];
        for (let i = 0; i <= 36; i++) { const a = i / 36 * Math.PI * 2; pts.push(P(cup[0] + Math.cos(a) * 0.3 * k, cup[1] + Math.sin(a) * 0.3 * k)); }
        if (pts.every(Boolean)) { g.beginPath(); pts.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.strokeStyle = "rgba(0,0,0,0.45)"; g.lineWidth = 2.4 * u; g.stroke(); g.strokeStyle = "rgba(255,255,255,0.95)"; g.lineWidth = 1.1 * u; g.stroke(); }
      }
    }
    if (opt.preview !== "on") return;
    const R = puttRuns(w); if (!R) return;
    g.globalAlpha = R[0].stale ? 0.4 : 1;
    // the paths, the softest first; each to where it stops
    for (let i = R.length - 1; i >= 0; i--) {
      const pts = R[i].path.map(p => pr.P(p[0], p[1], p[2], 0.03));
      g.beginPath(); let on = false; for (const p of pts) { if (!p) { on = false; continue; } if (on) g.lineTo(p[0], p[1]); else { g.moveTo(p[0], p[1]); on = true; } }
      g.strokeStyle = "rgba(0,0,0,0.4)"; g.lineWidth = (i ? 2.2 : 2.8) * u; g.setLineDash([]); g.stroke();
      g.strokeStyle = PCOL[i]; g.lineWidth = Math.max(1.5, (i ? 0.9 : 1.3) * u); g.setLineDash(i ? [2 * u, 2.5 * u] : []); g.stroke(); g.setLineDash([]);
    }
    const stops = R.map(r => pr.P(r.end[0], r.end[1], r.end[2], 0.03));
    stops.forEach((p, i) => { if (!p) return; g.beginPath(); g.arc(p[0], p[1], (i ? 1.6 : 2.1) * u, 0, 7); g.fillStyle = PCOL[i]; g.fill(); g.strokeStyle = "rgba(0,0,0,0.8)"; g.lineWidth = Math.max(1, 0.5 * u); g.stroke(); });
    g.globalAlpha = 1;
    if (R[0].stale) return;
    // the labels beside their stops, each at the first free spot of a few (right, left, above, below, the corners), clear of the
    // other labels and the stop dots, inside the picture between the HUD's rows
    const placed = [], sz = 5.2 * u, top = 30 * u, bot = 120 * u;
    const free = (x, y, tw, th) => !placed.some(q => Math.abs(q[0] - x) < (q[2] + tw) / 2 + u && Math.abs(q[1] - y) < (q[3] + th) / 2 + 0.5 * u)
      && !stops.some(p => p && Math.abs(p[0] - x) < tw / 2 + 2 * u && Math.abs(p[1] - y) < th / 2 + 2 * u);
    R.forEach((r, i) => {
      const p = stops[i]; if (!p) return;
      const text = `${Math.round(r.power / 0.6)}%: ${r.outcome === 0x80 ? "in" : feetText(r.len) + " ft"}`, [tw, th] = pillSize(g, text, sz);
      const dx = tw / 2 + 4 * u, tries = [[dx, 0], [-dx, 0], [0, -th - u], [0, th + u], [dx, -th], [-dx, th], [dx, th], [-dx, -th], [dx, -2 * th], [-dx, 2 * th], [dx, 2 * th], [-dx, -2 * th]];
      let best = null;
      for (const [ox, oy] of tries) {
        const x = Math.max(tw / 2 + 2 * u, Math.min(F.W - tw / 2 - 2 * u, p[0] + ox)), y = Math.max(top, Math.min(bot, p[1] + oy));
        if (free(x, y, tw, th)) { best = [x, y]; break; }
      }
      if (!best) best = [Math.max(tw / 2, Math.min(F.W - tw / 2, p[0] + dx)), Math.max(top, Math.min(bot, p[1] - (th + u) * (placed.length + 1)))];
      placed.push([best[0], best[1], tw, th]);
      pill(g, text, best[0], best[1], sz, i ? "rgba(30,30,30,0.82)" : "rgba(200,30,40,0.92)", i ? PCOL[i] : "#fff");
    });
  }
  // a putt's roll in feet as the HUD gives the putter's distances (ShotLength 10:6276 in 12:4CB1's conversion)
  const rollFeet = res => feetText(res.len);

  // the preview for this moment: run again only after what decides the shot has held still a moment (the aim keys held down move it
  // every frame); meanwhile the last one dimmed
  function previewFor(w) {
    const key = preview.key, now = performance.now(), cur = previewKey(w);
    if (cur === key) return preview.res;
    if (cur !== pv.key) { pv.key = cur; pv.since = now; }
    if (now - pv.since >= 90 || !preview.res) { const r = preview.get(w); return r; }
    return preview.res && preview.res.hole === w.wram[6][0x320] ? { ...preview.res, stale: true } : null;
  }

  // ---- P4: the tap area ----
  const tap = { down: new Set(), shown: 0, hintFrom: 0, active: false };
  const tapHints = () => +(stored("mg-taphint") || 0);
  function tapActive(game) {
    if (opt.tap !== "on" || !body.classList.contains("touch") || !game || !game.w || game.error) return false;
    return game.mark === "address" && humanTurn(game.w) && !body.classList.contains("showopts") && !body.classList.contains("showside");
  }
  const EXCLUDE = "button, select, input, a, label, #stickzone, .stick-base, #mgside, #hdopts, #modes, #layers3d, #message, #hdgear";
  function inTapZone(e) {
    if (e.clientY < innerHeight * 0.5) return false;
    const t = e.target; return !(t && t.closest && t.closest(EXCLUDE));
  }
  const press = on => { keys.KeyZ = on; const a = document.querySelector("#pad .ab .a"); if (a) a.classList.toggle("on", on); };
  addEventListener("pointerdown", e => {
    if (!tap.active || !inTapZone(e)) return;
    e.preventDefault(); tap.down.add(e.pointerId); press(true);
  }, { capture: true, passive: false });
  const up = e => { if (!tap.down.delete(e.pointerId)) return; if (!tap.down.size) press(false); };
  addEventListener("pointerup", up, true); addEventListener("pointercancel", up, true);
  function drawTapHint(game) {
    // the outline and a hint, the first few addresses (counted in this browser), drawn on the page's own layer
    let hc = document.getElementById("aptaphint");
    const want = tap.active && tap.hint;
    if (!want) { if (hc) hc.style.display = "none"; return; }
    if (!hc) { hc = document.createElement("canvas"); hc.id = "aptaphint"; Object.assign(hc.style, { position: "fixed", left: "0", top: "0", width: "100vw", height: "100vh", pointerEvents: "none", zIndex: "9" }); document.body.appendChild(hc); }
    hc.style.display = "block";
    const dpr = Math.min(2, devicePixelRatio || 1), W = innerWidth, H = innerHeight;
    if (hc.width !== Math.round(W * dpr) || hc.height !== Math.round(H * dpr)) { hc.width = Math.round(W * dpr); hc.height = Math.round(H * dpr); }
    const t = hc.getContext("2d"); t.setTransform(dpr, 0, 0, dpr, 0, 0); t.clearRect(0, 0, W, H);
    const top = Math.round(H * 0.5) + 2, m = 6, a = Math.max(0, Math.min(1, (performance.now() - tap.hintFrom) / 250));
    t.globalAlpha = 0.85 * a;
    t.setLineDash([10, 6]); t.lineWidth = 2; t.strokeStyle = "rgba(255,220,80,0.9)"; rrect(t, m, top, W - 2 * m, H - top - m, 16); t.stroke(); t.setLineDash([]);
    // the controls that keep their own places (the d-pad or the stick, B; A is A anyway), outlined as cut out of the area
    for (const sel of [body.classList.contains("stick") ? "#stickzone" : "#pad .dpad button", "#pad .ab .b"]) {
      const L = [...document.querySelectorAll(sel)].map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.bottom > top);
      if (!L.length) continue;
      const l = Math.min(...L.map(r => r.left)) - 6, tp = Math.max(top + 4, Math.min(...L.map(r => r.top)) - 6), r = Math.max(...L.map(r => r.right)) + 6, b = Math.min(H - m - 2, Math.max(...L.map(r => r.bottom)) + 6);
      t.fillStyle = "rgba(0,0,0,0.18)"; rrect(t, l, tp, r - l, b - tp, 14); t.fill(); t.strokeStyle = "rgba(255,255,255,0.75)"; t.lineWidth = 1.5; t.stroke();
    }
    const sz = Math.min(18, W / 22), cy = top + Math.min(26, (H - top) * 0.2);
    label(t, "TAP HERE = A", W / 2, cy, sz, "#ffe14a");
    label(t, "power, then impact · d-pad and B keep working", W / 2, cy + sz * 1.15, sz * 0.6, "#fff");
    t.globalAlpha = 1;
  }

  // ---- the frame ----
  function paint(game = lastGame) {
    if (!game || !game.w) return;
    const t0 = performance.now();
    paintedAt = t0;
    const w = game.w, r6 = w.wram[6];
    // P4 first (it works with the meter off too)
    const act = tapActive(game);
    if (act && !tap.active) { const n = tapHints(); tap.hint = n < 3; if (tap.hint) { keep("mg-taphint", String(n + 1)); tap.hintFrom = performance.now(); } }
    if (!act && tap.active && tap.down.size) { tap.down.clear(); press(false); }
    if (tap.hint && act && r6[0x44E]) tap.hint = false;                     // (gone once the swing starts)
    tap.active = act;
    drawTapHint(game);
    const sc = scene3d(), round = game.mark === "aimmenu" || game.mark === "address" || meter.phase !== "idle";
    const k = opt.meter === "big" ? meterState(game) : (meterState(game), 0);
    const showMeter = opt.meter === "big" && meter.phase !== "idle" && game.mark !== "menus" && humanTurn(w);   // (the computer's swings keep the game's meter)
    const aiming = (game.mark === "aimmenu" || game.mark === "address") && !r6[0x44E] && !r6[0x415] && humanTurn(w) && (opt.marks === "on" || opt.preview === "on");
    if (!round || (!showMeter && !aiming)) { if (shown) { cv.style.display = "none"; shown = false; } return; }
    const [W, H] = place(), F = frameOf(W, H, sc); F.sc = sc;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
    if (aiming) { const pr = projector(game, F, sc); if (pr) drawAim(game, F, pr); }
    if (showMeter) drawMeter(game, F, k);
    if (!shown) { cv.style.display = "block"; shown = true; }
    const ms = performance.now() - t0; stats.ms += ms; stats.n++; stats.paints++;
    if (stats.n >= 60) { stats.cpu = stats.ms / stats.n; stats.ms = 0; stats.n = 0; }
  }
  // while the game is not stepping (paused, a held test) the overlay still follows the page's layout, the options and the 3D camera,
  // but is painted again only when one of them changed (or a preview is due): a repaint costs the GPU a whole canvas, and with a CPU
  // renderer (SwiftShader) painting it at every animation frame starved the page's frames (requestAnimationFrame stopped coming)
  let idleSig = "";
  const idle = () => {
    requestAnimationFrame(idle);
    if (performance.now() - paintedAt <= 60 || !lastGame) return;
    const r = screen.getBoundingClientRect(), G = window.__g3d;
    const sig = [lastGame.frames, G && G.stats ? G.stats.drawn : 0, r.left, r.top, r.width, r.height, scrollX, scrollY, opt.meter, opt.preview, opt.marks, opt.tap,
      preview.key === pv.key && putts.key === putts.pend ? "" : performance.now() - Math.max(pv.since, putts.since) > 90 ? "due" : "wait"].join(",");
    if (sig === idleSig) return;
    idleSig = sig;
    try { paint(); } catch (e) { console.warn("aim helpers", e); }
  };
  requestAnimationFrame(idle);
  mount();
  const api = {
    opt, preview, stats, putts,
    // once per drawn frame, after the picture (js/play.js): the game and its 2D frame (the HUD's colour under the small meter)
    present(game, image) { lastGame = game; lastImage = image; try { paint(game); } catch (e) { console.warn("aim helpers", e); } },
    set(k, v) { if (!(k in OPTIONS)) return; opt[k] = v; keep(OPTIONS[k].key, v); const s = document.getElementById("ap" + k); if (s) s.value = v; paint(); },
    paint,
  };
  window.__aimPower = api;
  return api;
}
