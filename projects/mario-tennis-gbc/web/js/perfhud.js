// PERF (the menu bar and OPTIONS > PICTURE): a small readout in the top-left corner, once a second, of what a frame costs on this
// device: the view's and the game's frames a second, the milliseconds of script per frame for the game (the port's frames) and for
// the picture (building and sending the 3D view; the GPU's own time is not in it: a view frame rate under the display's is), the 3D
// view's draw calls and render-target switches per frame (counted on its WebGL context while PERF is on) and its RESOLUTION scale.
// full.js times the game and the picture through perf.time(kind, ms) and counts the frames through perf.frame(kind).
const KEY = "mt-perf";

export class PerfHud {
  constructor(hud, getVoxel) {
    this.getVoxel = getVoxel; this.on = false; this.reset(performance.now()); this.gl = null;
    try { this.on = localStorage.getItem(KEY) === "on"; } catch (e) { /* private mode */ }
    const b = this.btn = document.createElement("span"); b.className = "k"; b.id = "perfbtn";
    b.title = "a readout of what each frame costs on this device: frames a second, script time for the game and the picture, the 3D view's draw calls and its resolution";
    b.addEventListener("pointerdown", () => this.toggle());
    hud.appendChild(document.createTextNode(" ")); hud.appendChild(b);
    const el = this.el = document.createElement("div");
    el.style.cssText = "position:fixed;left:6px;top:6px;z-index:60;pointer-events:none;font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#e8ffe8;background:rgba(0,0,0,.62);padding:4px 7px;border-radius:6px;white-space:pre;display:none";
    document.body.appendChild(el);
    this.label();
  }
  reset(now) { this.t0 = now; this.n = { view: 0, game: 0 }; this.ms = { game: 0, draw: 0 }; this.calls = { draw: 0, fb: 0 }; }
  label() { this.btn.textContent = "PERF: " + (this.on ? "On" : "Off"); this.btn.classList.toggle("on", this.on); this.el.style.display = this.on ? "block" : "none"; }
  toggle() { this.on = !this.on; try { localStorage.setItem(KEY, this.on ? "on" : "off"); } catch (e) { /* private mode */ } this.label(); this.reset(performance.now()); }
  // the 3D view's context, counted once PERF has been on (its draws and render-target switches; a wrapper stays, costing a branch)
  hook() {
    const v = this.getVoxel(), gl = v && v.gl; if (!gl || gl === this.gl) return; this.gl = gl;
    const self = this, wrap = (name, kind) => { const f = gl[name].bind(gl); gl[name] = function (...a) { if (self.on) self.calls[kind]++; return f(...a); }; };
    for (const n of ["drawArrays", "drawArraysInstanced", "drawElements", "drawElementsInstanced"]) if (gl[n]) wrap(n, "draw");
    wrap("bindFramebuffer", "fb");
  }
  frame(kind) { if (this.on) this.n[kind]++; }
  time(kind, ms) { if (this.on) this.ms[kind] += ms; }
  tick(now, view3d) {
    if (!this.on) return;
    this.hook();
    const dt = now - this.t0; if (dt < 1000) return;
    const s = dt / 1000, vf = Math.max(1, this.n.view), gf = Math.max(1, this.n.game), v = this.getVoxel();
    const lines = [`${Math.round(this.n.view / s)} fps view · ${Math.round(this.n.game / s)} game`,
      `game ${(this.ms.game / gf).toFixed(1)} ms · picture ${(this.ms.draw / vf).toFixed(1)} ms`];
    if (view3d && v) lines.push(`${Math.round(this.calls.draw / vf)} draws · ${Math.round(this.calls.fb / vf)} passes · res ${Math.round((typeof v.res === "number" ? v.res : v.resK || 1) * 100)}%`);
    if (performance.memory) lines.push(`heap ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} MB`);
    this.el.textContent = lines.join("\n");
    this.reset(now);
  }
}
