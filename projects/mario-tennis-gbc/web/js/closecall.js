// "CALLS: on / off": a TV line-call review after a close bounce. When the first bounce of a shot lands within about 20 cm of a line, a
// panel in the corner shows the ball coming down on the line from above, its mark, and the call. Read only: the call is the game's own
// (EvaluateBounceOutcome 08:4379: wPointOutcome $C4D8 turning OUT on that frame), the distance is the ball's centre from the limit the game
// tests (CheckBallOutOfBounds 08:463A: |X| against -wCourtLimitX $C484, |depth| against -wCourtLimitDepth $C486; on a serve those are the
// service box, and its middle line is X = 0). 105 world units to the metre.
const KEY = "mt-closecall", CLOSE = 21, SHOW = 3.2, U2CM = 100 / 105;
const OUT_OUT = 5;
const COURT_COL = ["#3767b8", "#c0683c", "#4f9848", "#8c7b5c"];          // wCurrentlyUsedCourt $C8F4: hard, clay, grass, composition
const C2 = x => Math.round(x * 100) / 100;
const s16 = (w, a) => (w[a] | (w[a + 1] << 8)) << 16 >> 16;

export class CloseCall {
  constructor(v) {
    this.v = v; this.on = (() => { try { return localStorage.getItem(KEY) !== "off"; } catch (e) { return true; } })();
    this.prevBounce = 0; this.prevOutcome = 0; this.call = null; this.log = []; this.cv = null; this.raf = 0;   // (log: the last calls, for tests)
  }
  setOn(on) { this.on = on; try { localStorage.setItem(KEY, on ? "on" : "off"); } catch (e) { /* private mode */ } if (!on) this.hide(); }
  // per game frame (voxel.js tick)
  step(v) {
    const w = v.gb.mem.wram[0], ev = w[0x4B3], out = w[0x4D8];
    const edge = ev === 1 && this.prevBounce !== 1, was = this.prevOutcome; this.prevBounce = ev; this.prevOutcome = out;
    if (!this.on || v.replaying || !edge || w[0x32E] > 15 || w[0x4B2] !== 1 || !w[0x4B6]) return;
    if (was) return;                                                       // the point was already over
    if (v.isDrill && v.isDrill()) return;                                  // (drills: no line calls)
    const x = s16(w, 0x402), d = s16(w, 0x406), lx = -s16(w, 0x484), ld = -s16(w, 0x486), serve = w[0x4B6] === 1;
    if (!(lx > 0 && ld > 0) || ((w[0x4B0] ^ w[0x4BE]) & 2) === 0) return;  // (own side: into the net, nothing to call)
    // the nearest line: the side line, the base (or service) line, on a serve the middle line too; positive = inside
    const cand = [{ m: lx - Math.abs(x), kind: "side" }, { m: ld - Math.abs(d), kind: "base" }];
    if (serve) cand.push({ m: ((w[0x4B0] ^ w[0x4BE]) & 1) ? Math.abs(x) : -Math.abs(x), kind: "centre" });
    const near = cand.reduce((a, b) => (Math.abs(b.m) < Math.abs(a.m) ? b : a));
    if (Math.abs(near.m) > CLOSE) return;
    const vx = s16(w, 0x421), vd = s16(w, 0x424);
    const isOut = out === OUT_OUT;
    // the ball's travel in the panel (x along the line, y down = inwards: the panel has the outside at the top)
    let tx, ty;
    if (near.kind === "base") { tx = vx; ty = -vd * Math.sign(d || 1); }
    else if (near.kind === "side") { tx = vd; ty = -vx * Math.sign(x || 1); }
    else { tx = vd; ty = vx * Math.sign(x || 1); }
    const n = Math.hypot(tx, ty) || 1;
    this.call = { t0: performance.now() / 1000, m: isOut && near.m > 0 ? -Math.max(0.5, Math.abs(near.m)) : !isOut && near.m < 0 ? Math.max(0.5, -near.m) : near.m, out: isOut, kind: near.kind, tx: tx / n, ty: ty / n, court: w[0x8F4] & 3 };
    this.log.push({ fr: v.gb.ppu.frames, m: C2(this.call.m), out: isOut, kind: near.kind }); if (this.log.length > 20) this.log.shift();
    this.show();
  }
  ui() {
    if (this.cv) return;
    const c = this.cv = document.createElement("canvas"); c.width = 360; c.height = 220;
    Object.assign(c.style, { position: "fixed", zIndex: 7, pointerEvents: "none", borderRadius: "12px", boxShadow: "0 6px 24px rgba(0,0,0,.55)", transition: "opacity .35s", opacity: "0", maxWidth: "none", aspectRatio: "auto", background: "transparent" });
    document.body.appendChild(c);
  }
  show() {
    if (typeof document === "undefined" || !this.v.cv) return;
    this.ui(); const r = this.v.cv.getBoundingClientRect(), W = Math.round(Math.min(300, r.width * 0.3)), H = Math.round(W * 220 / 360);
    Object.assign(this.cv.style, { left: Math.round(r.left + r.width * 0.025) + "px", top: Math.round(r.bottom - H - r.height * 0.05) + "px", width: W + "px", height: H + "px", opacity: "1" });
    cancelAnimationFrame(this.raf); const loop = () => { const u = performance.now() / 1000 - this.call.t0; this.draw(u); if (u < SHOW) this.raf = requestAnimationFrame(loop); else this.hide(); }; loop();
  }
  hide() { cancelAnimationFrame(this.raf); if (this.cv) this.cv.style.opacity = "0"; }
  // the picture: the court seen from straight above, 5 px to the unit; the line's outer edge through the middle, the ball dropping onto it
  draw(u) {
    const C = this.call, g = this.cv.getContext("2d"), W = 360, H = 220, k = 5, ly = 126, lw = 6 * k;
    g.clearRect(0, 0, W, H);
    g.fillStyle = "#0c0f1c"; g.fillRect(0, 0, W, H);
    g.save(); g.beginPath(); g.rect(8, 34, W - 16, H - 42); g.clip();
    g.fillStyle = COURT_COL[C.court]; g.fillRect(8, 34, W - 16, H - 42);
    g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(8, 34, W - 16, ly - 34);                        // outside: a shade darker
    g.fillStyle = "#f4f6f0"; g.fillRect(8, ly, W - 16, lw);                                         // the line (inside its outer edge)
    g.fillStyle = "rgba(0,0,0,0.12)"; for (let i = 0; i < 60; i++) g.fillRect(8 + ((i * 97) % (W - 16)), ly + ((i * 53) % lw), 3, 1);   // its paint
    // the ball's centre: m units inside the outer edge (down = inside)
    const bx = W / 2, by = ly + C.m * k, R = C.out ? Math.min(3.5 * k * 1.25, -C.m * k * 0.8) : 3.5 * k * 1.25;   // (the game calls the ball's centre: an OUT ball is drawn clear of the line)
    const fall = Math.min(1, u / 0.55), e = 1 - (1 - fall) ** 2, far = 120 * (1 - e);
    if (fall >= 1) {                                                                                // the mark: squashed along the travel
      const a = Math.atan2(C.ty, C.tx); g.save(); g.translate(bx, by); g.rotate(a); g.fillStyle = "rgba(60,50,30,0.35)"; g.beginPath(); g.ellipse(0, 0, R * 1.6, R * 0.95, 0, 0, 6.2832); g.fill(); g.restore();
    }
    const px = bx - C.tx * far, py = by - C.ty * far;
    g.fillStyle = "rgba(0,0,0,0.3)"; g.beginPath(); g.arc(bx - C.tx * far * 0.5 + 6 * (1 - e), by - C.ty * far * 0.5 + 6 * (1 - e), R, 0, 6.2832); g.fill();   // its shadow
    const gr = g.createRadialGradient(px - R * 0.35, py - R * 0.4, R * 0.1, px, py, R); gr.addColorStop(0, "#f6ffa0"); gr.addColorStop(0.6, "#d4e83c"); gr.addColorStop(1, "#8ea018");
    g.fillStyle = gr; g.beginPath(); g.arc(px, py, R * (1 + 0.6 * (1 - e)), 0, 6.2832); g.fill();
    g.restore();
    // the labels
    g.font = "700 15px Itim, system-ui, sans-serif"; g.fillStyle = "#ffdc5a"; g.textBaseline = "middle"; g.fillText("CLOSE CALL", 14, 18);
    g.font = "12px Itim, system-ui, sans-serif"; g.fillStyle = "#aab"; g.textAlign = "right"; g.fillText(C.kind === "side" ? "SIDE LINE" : C.kind === "centre" ? "CENTRE LINE" : "BASE LINE", W - 14, 18); g.textAlign = "start";
    g.fillStyle = "rgba(255,255,255,0.55)"; g.font = "11px Itim, system-ui, sans-serif"; g.fillText("OUT", 16, 46); g.fillText("IN", 16, H - 18);
    if (u > 0.75) {
      const pop = Math.min(1, (u - 0.75) / 0.18), s = 1 + 0.25 * (1 - pop), cm = Math.abs(C.m) * U2CM;
      g.save(); g.translate(W - 74, H - 52); g.scale(s, s); g.globalAlpha = pop;
      g.fillStyle = C.out ? "#e03a3a" : "#2fb35a"; g.beginPath(); g.roundRect ? g.roundRect(-58, -30, 116, 60, 12) : g.rect(-58, -30, 116, 60); g.fill();
      g.fillStyle = "#fff"; g.textAlign = "center"; g.font = "700 30px Itim, system-ui, sans-serif"; g.fillText(C.out ? "OUT" : "IN", 0, -6);
      g.font = "12px Itim, system-ui, sans-serif"; g.fillText((cm < 1 ? cm.toFixed(1) : Math.round(cm)) + " cm " + (C.out ? "wide" : "inside"), 0, 16); g.restore();
    }
  }
}
export function addCloseCallButton(hud, cc) {
  if (!hud || !cc) return null;
  const b = document.createElement("span"); b.className = "k"; b.id = "callsbtn"; b.title = "3D court: a TV line-call review after a bounce that lands close to a line (the game's own call, the distance from the line)";
  const show = () => { b.textContent = "CALLS: " + (cc.on ? "on" : "off"); b.classList.toggle("on", cc.on); };
  b.addEventListener("pointerdown", () => { cc.setOn(!cc.on); show(); });
  hud.appendChild(document.createTextNode(" ")); hud.appendChild(b); show(); return b;
}
export function attachCloseCall(voxel, hud) { const cc = voxel.closecall = new CloseCall(voxel); addCloseCallButton(hud, cc); return cc; }
