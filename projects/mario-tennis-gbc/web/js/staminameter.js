// STAMINA METER (PLAY+ stamina, engine/plus.js plusStaminaGauge): during a match a bar for each player over the top corners of the
// picture: your side on the left (red), your opponent's on the right (blue), each with the player's name (the match records'
// names, $CA00 + 64 * slot); in doubles the partners' bars under them. A bar drains as its player runs and swings (the charged
// swings most), turns amber once they are tiring (past the tick: they run slower and hit softer from there), and fills again at
// the next point. Shown only with PLAY+ stamina on, on a court in a match (not the drills or the mini-games). Read only.
import { plusStaminaGauge } from "./engine/plus.js";

const RECORD = [0xCA00, 0xCA80, 0xCA40, 0xCAC0];            // the match records by character index (P1, P2, P1's partner, P2's partner)
const GAMEMODE_TRAINING_DRILL = 0x05, GAMEMODE_MARIO_MINIGAME = 0x08;
const COLOURS = [["#ff7a50", "#ff3c3c"], ["#5ab4ff", "#3c78ff"]], TIRED = ["#ffd24a", "#ff9a2a"];

export class StaminaMeter {
  constructor() { this.el = null; this.bars = []; this.shown = false; }
  // per frame (full.js): port the JS port (its engine P.E), canvas the picture on screen, court whether a court map is up
  frame(port, canvas, court) {
    if (typeof document === "undefined") return;
    const E = port && port.E, m = E && E.mem, mode = m ? m.u8(0xC8A6) : 0;
    const live = !!(court && E && E.plus && E.plus.stamina && E.effort && mode !== GAMEMODE_TRAINING_DRILL && mode !== GAMEMODE_MARIO_MINIGAME);
    if (!live) { if (this.shown) { this.el.style.opacity = "0"; this.shown = false; } return; }
    const n = E.S.onCourtCharCount === 4 ? 4 : 2;
    if (!this.el || this.bars.length !== n) this.build(n);
    const r = canvas.getBoundingClientRect(), W = Math.round(Math.max(90, Math.min(220, r.width * 0.2)));
    for (let i = 0; i < n; i++) {
      const b = this.bars[i], g = plusStaminaGauge(E, i), side = i & 1, row = i >> 1;
      if (!g) continue;
      b.box.style.width = W + "px";
      b.box.style.top = Math.round(r.top + r.height * 0.03 + row * 30) + "px";
      b.box.style.left = side ? Math.round(r.right - r.width * 0.03 - W) + "px" : Math.round(r.left + r.width * 0.03) + "px";
      const name = this.name(m, i); if (b.name.textContent !== name) b.name.textContent = name;
      const c = g.tiring ? TIRED : COLOURS[side];
      b.fill.style.width = (g.left * 100).toFixed(1) + "%";
      b.fill.style.background = `linear-gradient(90deg,${c[0]},${c[1]})`;
      b.fill.style.left = side ? "auto" : "0"; b.fill.style.right = side ? "0" : "auto";
      b.tick.style.left = ((side ? 1 - g.mark : g.mark) * 100).toFixed(1) + "%";
      b.box.classList.toggle("tiring", g.tiring);
    }
    if (!this.shown) { this.el.style.opacity = "1"; this.shown = true; }
  }
  // the player's name from their match record (up to 7 letters, 0-ended: wPlayer1MainName etc.)
  name(m, i) {
    let s = ""; for (let k = 0; k < 7; k++) { const c = m.u8(RECORD[i] + k); if (c < 0x20 || c > 0x7E) break; s += String.fromCharCode(c); }
    return s.trim().toUpperCase() || (i & 1 ? "OPPONENT" : "YOU");
  }
  build(n) {
    if (this.el) this.el.remove();
    const el = this.el = document.createElement("div");
    el.style.cssText = "position:fixed;inset:0;z-index:6;pointer-events:none;transition:opacity .4s;opacity:0";
    const css = document.createElement("style");
    css.textContent = "@keyframes mtStamPulse{0%,100%{box-shadow:0 0 0 rgba(255,180,40,0)}50%{box-shadow:0 0 8px rgba(255,180,40,.9)}}" +
      ".mt-stam.tiring .mt-stam-bar{animation:mtStamPulse .8s ease-in-out infinite}";
    el.appendChild(css);
    this.bars = [];
    for (let i = 0; i < n; i++) {
      const side = i & 1, box = document.createElement("div");
      box.className = "mt-stam";
      box.style.cssText = `position:fixed;white-space:nowrap;text-align:${side ? "right" : "left"};font:700 11px Itim,system-ui,sans-serif;letter-spacing:.08em;color:#fff;text-shadow:0 1px 2px #000`;
      const label = document.createElement("div"), name = document.createElement("span"), tag = document.createElement("span");
      tag.textContent = "STAMINA"; tag.style.cssText = `color:${side ? "#8ab8ff" : "#ff8a6a"};font-size:.85em`;
      label.style.cssText = `display:flex;gap:.35em;justify-content:${side ? "flex-end" : "flex-start"}`;   // (a long name runs inwards, over the court)
      if (side) label.append(name, tag); else label.append(tag, name);
      const bar = document.createElement("div"), fill = document.createElement("i"), tick = document.createElement("b");
      bar.className = "mt-stam-bar";
      bar.style.cssText = "position:relative;height:9px;margin-top:2px;border-radius:5px;background:rgba(14,16,26,.72);border:1px solid rgba(255,255,255,.3);overflow:hidden";
      fill.style.cssText = "position:absolute;top:0;bottom:0;border-radius:4px;transition:width .15s linear";
      tick.style.cssText = "position:absolute;top:-1px;bottom:-1px;width:2px;margin-left:-1px;background:rgba(255,255,255,.75)";
      bar.append(fill, tick); box.append(label, bar); el.appendChild(box);
      this.bars.push({ box, name, fill, tick });
    }
    document.body.appendChild(el);
  }
}
