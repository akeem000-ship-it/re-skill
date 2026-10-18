// INSTANT REPLAY (3D court, the original code only): the machine is copied when a point starts (the score changes) and the buttons of every
// frame after it are kept. When a rally of 5 shots or more ends, a "REPLAY" chip shows for a few seconds; tapping it puts the copy back,
// plays the point again from those buttons (silent, the game is exact so it runs the same) under a TV camera beside the court that follows
// the ball, then puts the live machine back as it was. Any tap ends the replay early. Nothing is recorded or saved from the replay.
// ctx: gb(), voxel(), canRun() (3D court view, the original code), settle()
import { snapshot, restore } from "./gb/state.js";
const MAX = 60 * 40;                                  // a point longer than 40 s is not kept

export class InstantReplay {
  constructor(ctx) {
    this.ctx = ctx; this.cur = null; this.last = null; this.sig = ""; this.playing = null; this.cam = null;
    this.chip = document.createElement("div"); this.chip.textContent = "▶ REPLAY"; this.chip.hidden = true;
    this.chip.style.cssText = "position:fixed;left:50%;top:14%;transform:translateX(-50%);z-index:20;padding:8px 18px;border-radius:20px;background:rgba(200,30,40,.92);color:#fff;font:bold 15px sans-serif;letter-spacing:.06em;box-shadow:0 4px 16px rgba(0,0,0,.45)";
    this.badge = document.createElement("div"); this.badge.hidden = true;
    this.badge.innerHTML = "<span style='display:inline-block;width:10px;height:10px;border-radius:50%;background:#e22;margin-right:8px;animation:rpblink 1s infinite'></span>REPLAY";
    this.badge.style.cssText = "position:fixed;left:max(18px,env(safe-area-inset-left));top:18px;z-index:20;padding:6px 14px;border-radius:8px;background:rgba(0,0,0,.6);color:#fff;font:bold 14px sans-serif;pointer-events:none";
    const st = document.createElement("style"); st.textContent = "@keyframes rpblink{50%{opacity:.2}}"; document.head.appendChild(st);
    document.body.appendChild(this.chip); document.body.appendChild(this.badge);
    this.chip.addEventListener("pointerdown", e => { e.stopPropagation(); this.play(); });
    addEventListener("pointerdown", e => { if (this.playing && e.target !== this.chip) { e.stopPropagation(); this.stop(); } }, true);
  }
  // after every real game frame (full.js frame): the buttons of this frame, and a new point when the score changed
  afterFrame(gb, inp) {
    const w = gb.mem.wram[0];
    if (!this.ctx.canRun() || w[0x32E] > 15) { this.cur = null; this.sig = ""; return; }
    const sig = [w[0x8E0], w[0x8E1], w[0x8E2], w[0x8E3], w[0x8E4], w[0x8E5]].join();
    if (this.cur) { this.cur.inputs.push(inp); this.cur.hits = Math.max(this.cur.hits, w[0x4B6]); if (this.cur.inputs.length > MAX) this.cur = null; }
    if (sig !== this.sig) {
      if (this.cur && this.sig && this.cur.hits >= 5) { this.last = this.cur; this.offer(); }
      this.sig = sig; this.ctx.settle(); this.cur = { snap: snapshot(gb), inputs: [], hits: 0 };
    }
  }
  offer() { clearTimeout(this.chipT); this.chip.hidden = false; this.chipT = setTimeout(() => { this.chip.hidden = true; }, 5000); }
  play() {
    const gb = this.ctx.gb(), v = this.ctx.voxel(); this.chip.hidden = true;
    if (!this.last || !gb || !v || this.playing) return;
    this.ctx.settle();
    this.playing = { live: snapshot(gb), i: 0, rec: this.last };
    restore(gb, this.last.snap);
    v.replaying = true; this.cam = null; if (v.matchfx) v.matchfx.cine = null;
    v.replayCam = (aspect, m4, clip, state) => this.camera(aspect, m4, clip, state);
    this.badge.hidden = false;
  }
  // one game frame of the replay (full.js loop, in place of frame())
  step() {
    const P = this.playing, gb = this.ctx.gb(), v = this.ctx.voxel(); if (!P) return;
    if (P.i >= P.rec.inputs.length) { this.stop(); return; }
    gb.setInput(P.rec.inputs[P.i++]); gb.runFrame(); gb.apu.outPos = 0;
    if (v && v.mode === "3d") v.tick();
  }
  stop() {
    const P = this.playing, gb = this.ctx.gb(), v = this.ctx.voxel(); if (!P) return;
    restore(gb, P.live); this.playing = null; this.badge.hidden = true;
    if (v) { v.replaying = false; v.replayCam = null; v.lastFrame = -1; v.cur = v.prev = null; if (v.intro) v.intro.lastCourt = gb.ppu.frames; if (v.stadium) v.stadium.ev = null; if (v.matchfx) v.matchfx.prev = null; }
  }
  // the TV camera: high above the right-hand stand, panning with the ball (eased so it does not jitter)
  camera(aspect, m4, clip, state) {
    const b = (state && state.ball) || { X: 0, Y: 0 }, want = [b.X * 0.35, b.Y * 0.8];
    this.cam = this.cam ? [this.cam[0] + (want[0] - this.cam[0]) * 0.08, this.cam[1] + (want[1] - this.cam[1]) * 0.08] : want;
    const [cx, cz] = this.cam, eye = [1650, 900, cz + 650], at = [cx, 60, cz];   // (above the right-hand stand, clear of the seats)
    return { mvp: m4.mul(m4.perspective(0.62, aspect, clip.near, clip.far), m4.lookAt(eye, at, [0, 1, 0])), tilt: 0 };
  }
}
