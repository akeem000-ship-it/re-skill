// MENU: Wheel, the sub-menus: the main menu's ball-wheel look carried on through the screens after it. The game's own screens keep
// running underneath (they take the pad, play their sounds, and decide); the port's menu loops only say which screen is up and where
// its cursor is (P.menuWheel.skin = { id, at: the frame, ... }, read-only, written every frame of the loop), and the overlay
// (menuwheel.js) draws the screen again here:
//   format   the exhibition's match format (bank $3B RunMatchFormatSelect): players, games and sets as three pills by the ball,
//            each with its choices, the chosen row gold; the panel shows the row's options large and the game's own caption
//   court    the court select (bank $3E, four or nine courts): the courts round the ball; the panel plays a little film of the
//            chosen court (its own picture from the ROM, the camera gliding in over it while a ball is hit back and forth),
//            with its name and its ball speed and bounce (the court table 08:5DC4: friction, bounce)
import { courtImage } from "./assets.js";
import { Rom } from "./rom.js";

const FONT = "MT Luckiest Guy", BODY = "Itim, system-ui, sans-serif";
const COURT_TABLE = 0x5DC4;                                          // 08:5DC4: per court 4 bytes: friction, bounce, map, music
const COURT_NAMES = ["HARD", "CLAY", "GRASS", "COMPOSITION", "MARIO COURT", "PEACH COURT", "YOSHI COURT", "DK COURT", "WARIO COURT"];
const COURT_LINES = ["A fast, true bounce", "Slow and high: long rallies", "Quick and low: serve and volley", "Lively, a fair bounce"];   // (bonus courts: "A bonus court")

// the menu's text lines from the HD reader (the game's own words), at a screen row band
function gameText(hd, y0, y1) {
  const L = (hd && hd.screen && hd.screen.lines) || (hd && hd.lines) || [];
  return L.filter(l => l.y >= y0 && l.y < y1).sort((a, b) => a.y - b.y || a.x - b.x).map(l => l.text.trim()).join("  ");
}

export class MenuSkins {
  constructor(mw) { this.mw = mw; this.courts = new Map(); this.rom = null; this.pos = 0; this.id = ""; }
  // draw `skin` (P.menuWheel.skin) into the overlay canvas g (W x H device pixels)
  draw(g, W, H, skin, gb, hd) {
    if (skin.id !== this.id) { this.id = skin.id; this.pos = skin.sel ?? skin.row ?? 0; this.t0 = performance.now() / 1000; }
    g.clearRect(0, 0, W, H);
    const k = Math.min(W / 1280, H / 720);
    if (skin.id === "court") this.court(g, W, H, k, skin, gb);
    else if (skin.id === "format") this.format(g, W, H, k, skin, hd);
  }
  // the turning: the ball's position eases to the chosen item, the shorter way round n
  ease(sel, n) { let d = sel - this.pos; if (n > 5) { if (d > n / 2) d -= n; if (d < -n / 2) d += n; } this.pos += d * 0.3; if (Math.abs(d) < 0.01) this.pos = sel; return this.pos; }   // (a short list does not wrap)
  // the ball on the left and the items on its arc (the main menu's layout); labels: [text], the chosen one on a gold pill
  arc(g, k, H, labels, sel, step = 0.3) {
    const mw = this.mw, cy = H / 2, br = 250 * k, bx = -60 * k, n = labels.length, pos = this.ease(sel, n);
    mw.menuBall(g, bx, cy, br, -pos * 0.35);
    for (let i = 0; i < n; i++) {
      let o = i - pos; if (n > 5) { if (o > n / 2) o -= n; if (o < -n / 2) o += n; } if (Math.abs(o) > 3.6) continue;
      const a = o * step, rr = br + 80 * k + (Math.abs(o) < 0.5 ? 40 * k * (1 - Math.abs(o) * 2) : 0), x = bx + rr * Math.cos(a), y = cy + rr * Math.sin(a), label = labels[i];
      if (i === sel) {
        g.font = `${44 * k}px "${FONT}", ${BODY}`; const tw = g.measureText(label).width;
        g.fillStyle = "#ffd65a"; mw.pill(g, x - 20 * k, y - 36 * k, tw + 60 * k, 72 * k, 36 * k); g.fill();
        g.fillStyle = "#281e0a"; g.textBaseline = "middle"; g.fillText(label, x + 10 * k, y + 3 * k);
      } else {
        g.globalAlpha = Math.max(0.25, 1 - Math.abs(o) * 0.22); g.font = `${30 * k}px "${FONT}", ${BODY}`; g.textBaseline = "middle";
        g.fillStyle = "#000"; g.fillText(label, x + 2 * k, y + 2 * k); g.fillStyle = "#c8d0eb"; g.fillText(label, x, y); g.globalAlpha = 1;
      }
    }
  }
  // the white panel on the right with its gold rim; returns its box
  panel(g, W, k, top = 110, h = 470) {
    const px = W - 520 * k, py = top * k, pw = 460 * k, ph = h * k;
    g.fillStyle = "rgba(250,250,255,0.94)"; this.mw.pill(g, px, py, pw, ph, 30 * k); g.fill(); g.lineWidth = 4 * k; g.strokeStyle = "#ffd65a"; g.stroke();
    return { px, py, pw, ph };
  }
  title(g, k, text) {
    g.font = `${54 * k}px "${FONT}", ${BODY}`; g.textBaseline = "top"; g.fillStyle = "rgba(0,0,0,0.5)"; g.fillText(text, 404 * k, 34 * k);
    g.fillStyle = "#ffd65a"; g.fillText(text, 400 * k, 30 * k); g.textBaseline = "alphabetic";
  }
  hint(g, W, H, k, text) { g.fillStyle = "#dce2f5"; g.font = `${24 * k}px ${BODY}`; g.textAlign = "right"; g.fillText(text, W - 60 * k, H - 40 * k); g.textAlign = "start"; }

  // ---- the match format ----
  format(g, W, H, k, s, hd) {
    const rows = [["PLAYERS", ["SINGLES", "DOUBLES"], s.doubles], ["GAMES", ["2 GAMES", "6 GAMES"], s.games], ["SETS", ["1 SET", "3 SETS", "5 SETS"], s.sets]];
    this.title(g, k, "MATCH");
    this.arc(g, k, H, rows.map(r => r[1][r[2]] || r[0]), s.row, 0.42);
    const { px, py, pw } = this.panel(g, W, k, 130, 430), r = rows[s.row] || rows[0];
    g.textAlign = "center"; g.fillStyle = "#8a7a50"; g.font = `${26 * k}px "${FONT}", ${BODY}`; g.fillText(r[0], px + pw / 2, py + 60 * k);
    // the row's choices as chips, the chosen one gold, with the arrows that change it
    const n = r[1].length, cw = 128 * k, gap = 12 * k, x0 = px + (pw - (n * cw + (n - 1) * gap)) / 2, cy = py + 110 * k;
    for (let i = 0; i < n; i++) {
      const on = i === r[2], x = x0 + i * (cw + gap);
      g.fillStyle = on ? "#ffd65a" : "#e4e6f0"; this.mw.pill(g, x, cy, cw, 64 * k, 20 * k); g.fill();
      g.fillStyle = on ? "#281e0a" : "#7a7f98"; g.font = `${(r[1][i].length > 7 ? 22 : 26) * k}px "${FONT}", ${BODY}`; g.fillText(r[1][i], x + cw / 2, cy + 42 * k);
    }
    g.fillStyle = "#c79a2a"; g.font = `${36 * k}px ${BODY}`; g.fillText("◀", px + 36 * k, cy + 46 * k); g.fillText("▶", px + pw - 36 * k, cy + 46 * k);
    // the game's own caption for the choice ("One-on-One", "Play Alone", ...)
    const cap = gameText(hd, 120, 144);
    g.fillStyle = "#281e0a"; g.font = `${40 * k}px "${FONT}", ${BODY}`; g.fillText(cap ? cap.toUpperCase() : r[1][r[2]], px + pw / 2, py + 260 * k);
    g.fillStyle = "#464a64"; g.font = `${24 * k}px ${BODY}`;
    const sum = `${rows[0][1][s.doubles] || ""}  ·  ${rows[1][1][s.games] || ""}  ·  ${rows[2][1][s.sets] || ""}`;
    g.fillText(sum.toLowerCase().replace(/^./, c => c.toUpperCase()), px + pw / 2, py + 320 * k); g.textAlign = "start";
    this.hint(g, W, H, k, "▲ ▼ choose   ◀ ▶ change   A play   B back");
  }

  // ---- the court select ----
  courtPic(gb, mapId) {
    if (!this.rom) this.rom = new Rom(gb.mem.rom);
    if (!this.courts.has(mapId)) { let c = null; try { c = courtImage(this.rom, mapId); } catch (e) { /* not a court picture */ } this.courts.set(mapId, c); }
    return this.courts.get(mapId);
  }
  court(g, W, H, k, s, gb) {
    const names = s.ids.map((c, i) => s.locked[i] ? "? ? ?" : COURT_NAMES[c] || "COURT " + (c + 1));
    this.title(g, k, "COURT");
    this.arc(g, k, H, names, s.sel);
    const c = s.ids[s.sel] ?? 0, locked = s.locked[s.sel], rom = gb.mem.rom, row = 8 * 0x4000 + COURT_TABLE - 0x4000 + c * 4;
    const fr = rom[row], bo = rom[row + 1], mapId = rom[row + 2];
    const { px, py, pw } = this.panel(g, W, k, 96, 520);
    // the film: the court's own picture, the camera gliding over it (a ground plane drawn row by row), a rally on it
    const fx = px + 24 * k, fy = py + 24 * k, fw = pw - 48 * k, fh = 250 * k, T = performance.now() / 1000 - this.t0;
    g.save(); this.mw.pill(g, fx, fy, fw, fh, 18 * k); g.clip();
    const pic = locked ? null : this.courtPic(gb, mapId);
    if (pic) this.film(g, pic, fx, fy, fw, fh, T); else { g.fillStyle = "#2a2f45"; g.fillRect(fx, fy, fw, fh); g.fillStyle = "#8a90b0"; g.font = `${90 * k}px "${FONT}", ${BODY}`; g.textAlign = "center"; g.fillText("?", fx + fw / 2, fy + fh / 2 + 32 * k); g.textAlign = "start"; }
    g.restore();
    g.textAlign = "center"; g.fillStyle = "#281e0a"; g.font = `${42 * k}px "${FONT}", ${BODY}`; g.fillText(names[s.sel], px + pw / 2, fy + fh + 64 * k);
    g.fillStyle = "#464a64"; g.font = `${23 * k}px ${BODY}`; g.fillText(locked ? "Not unlocked yet" : COURT_LINES[c] || "A bonus court", px + pw / 2, fy + fh + 102 * k); g.textAlign = "start";
    if (!locked) {                                                        // ball speed and bounce, from the court's own bytes
      const bar = (label, v, y) => {
        g.fillStyle = "#7a7f98"; g.font = `${22 * k}px "${FONT}", ${BODY}`; g.fillText(label, px + 40 * k, y + 18 * k);
        const bx = px + 200 * k, bw = pw - 240 * k; g.fillStyle = "#e4e6f0"; this.mw.pill(g, bx, y, bw, 22 * k, 11 * k); g.fill();
        g.fillStyle = "#ffb43a"; this.mw.pill(g, bx, y, Math.max(22 * k, bw * Math.min(1, Math.max(0.08, v))), 22 * k, 11 * k); g.fill();
      };
      bar("BALL SPEED", (fr - 150) / 100, fy + fh + 128 * k); bar("BOUNCE", (bo - 130) / 110, fy + fh + 166 * k);
    }
    this.hint(g, W, H, k, "▲ ▼ ◀ ▶ choose   A play   B back");
  }
  // a court seen from a camera gliding in low over its near baseline: each screen row below the horizon is a row of the picture
  // (the ground plane), scaled by its distance; a ball crosses it on an arc, bouncing once each way
  film(g, pic, x, y, w, h, T) {
    const N = Math.min(256, pic.width), hy = y + h * 0.3, rows = Math.ceil(y + h - hy), cam = 0.5 + 0.5 * Math.sin(T * 0.25);   // (the court: the map's first 32 x 32 tiles)
    const camY = N * (1.02 - 0.16 * cam), camX = N / 2 + N * 0.05 * Math.sin(T * 0.17), H0 = N * 0.17, tan = 0.95;
    const sky = g.createLinearGradient(0, y, 0, hy); sky.addColorStop(0, "#1a2a5a"); sky.addColorStop(1, "#6a8ac8"); g.fillStyle = sky; g.fillRect(x, y, w, hy - y + 1);
    g.imageSmoothingEnabled = false;
    for (let r = 0; r < rows; r++) {
      const p = (r + 0.5) / rows, dist = H0 / p, v = camY - dist; if (v < 0) continue;
      const hw = dist * tan, sx = camX - hw;
      g.drawImage(pic, Math.max(0, sx), v, Math.min(N, sx + 2 * hw) - Math.max(0, sx), 1, x + (Math.max(0, sx) - sx) / (2 * hw) * w, hy + r, (Math.min(N, sx + 2 * hw) - Math.max(0, sx)) / (2 * hw) * w, 1.5);
    }
    // the ball: from the near court to the far one and back (2 s a crossing), a bounce in each half
    const u = (T % 4) / 2, back = u > 1, q = back ? u - 1 : u, by = back ? N * (0.25 + 0.5 * q) : N * (0.75 - 0.5 * q), bxx = N / 2 + N * 0.12 * Math.sin(T * 1.3);
    const hgt = Math.abs(Math.sin(q * Math.PI * 2)) * N * 0.05, dist = camY - by; if (dist <= 2) return;
    const p = H0 / dist, sy = hy + p * rows, sxx = x + w / 2 + (bxx - camX) / (dist * tan) * w / 2, rr = Math.max(2, 3 * p * w / N * 2.2);
    g.fillStyle = "rgba(0,0,0,0.35)"; g.beginPath(); g.ellipse(sxx, sy, rr, rr * 0.4, 0, 0, 6.2832); g.fill();
    const gy = sy - hgt * p * (w / N) * 2.4; g.fillStyle = "#e8f04a"; g.beginPath(); g.arc(sxx, gy - rr, rr, 0, 6.2832); g.fill();
  }
}
