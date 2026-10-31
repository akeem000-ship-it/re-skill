// The play page's 3D layers (web/js/g3d): render-only options over the native game. With the 3D view off the page shows the exact
// 2D picture it always did; on, a WebGL canvas lies over the game's screen (wherever the page's layout puts it) and shows the hole in
// 3D with the game's HUD on top; elsewhere (menus, the clubhouse) the 2D picture shows through, unless a layer draws that screen too
// (the title's fly-over, the 3D overworld). Every layer only reads the game's memory; with all of them on the game runs frame for
// frame as with none (web/tests/g3d_layers_same.mjs).
// The page calls afterStep(game) after each game frame and present(game) once per drawn frame (js/play.js, the "3D LAYERS" blocks).
// Settings: remembered in this browser ("mg3d"); URL ?g3d=on|off|all|none|key,key ?g3dq=lite|full ?g3dcam=follow|course|behind|tv
// ?g3dhour=auto|clock|<hour> ?g3dtrees=courtyard|original.
import { Golf3D } from "./scene.js";
import { installOamTags } from "./hud3d.js";
import { PRESETS } from "./camera3d.js";
import { HOURS } from "./light3d.js";
import { FX } from "./fx.js";
import { TREE_STYLES } from "./trees3d.js";

export const LAYERS = [
  // [key, label, phase, what it does]
  ["view3d", "3D view", 1, "the hole in 3D: the course map as ground, the golfer, the pin, the trees and the ball at its true height, a camera that follows the game's views"],
  ["hills", "Hills", 1, "cosmetic contours from the slope data (the green's slopes, the fairway's slope cells), wooded mounds out of bounds, hollow bunkers; the game keeps its flat values"],
  ["sky", "Sky", 2, "a sky and a horizon round each course at the hour of the round"],
  ["light", "Light", 2, "the time of day: the sun's light and shadows, night with floodlights"],
  ["terrain", "Terrain", 2, "surfaces by terrain type in the hole's own colours: fairway stripes, rough blades, sand ripples, the green's mowing, moving water"],
  ["wear", "Wear", 2, "divots, ball marks on the green, footprints in the bunkers; they stay for the hole"],
  ["ballfx", "Ball FX", 2, "a trail by shot type, the spin's seam, the landing's burst, the splash"],
  ["ambience", "Ambience", 2, "leaves and grass blown by the game's wind, mist over water, sand puffs"],
  ["replay", "Replay", 2, "the big shots again from a camera following the ball (chip-ins, long putts, holes in one, eagles)"],
  ["closecall", "Close calls", 2, "a review panel for a lip-out or a ball just short of the water"],
  ["moments", "Big moments", 2, "hole in one, eagle, a tournament won: fireworks, the camera circling the green"],
  ["gallery", "Gallery", 2, "a gallery along the ropes at tournament rounds, caddies, their reactions"],
  ["titleshow", "Title fly-over", 2, "a fly-over of the course behind PRESS START"],
  ["field3d", "3D overworld", 3, "the story mode's maps in 3D: walls and buildings stood up, trees, the people"],
  ["fieldlife", "Field life", 3, "birds, butterflies and swaying flowers on the 3D overworld"],
];
const DEFAULTS = { on: Object.fromEntries(LAYERS.map(([k]) => [k, k !== "view3d"])), quality: "full", camera: "follow", hour: "auto", trees: "courtyard" };
const KEY = "mg3d";

export class Layers {
  constructor() {
    let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { saved = null; }
    const s = { ...DEFAULTS, ...(saved || {}) }, map = { ...DEFAULTS.on, ...((saved && saved.on) || {}) };
    const q = new URLSearchParams(location.search), g = q.get("g3d");
    if (g === "on") map.view3d = true;
    else if (g === "off") map.view3d = false;
    else if (g === "all") for (const [k] of LAYERS) map[k] = true;
    else if (g === "none") for (const [k] of LAYERS) map[k] = false;
    else if (g) { for (const [k] of LAYERS) map[k] = false; for (const k of g.split(",")) map[k] = true; map.view3d = true; }
    this.map = map;
    this.quality = q.get("g3dq") || s.quality; this.camera = q.get("g3dcam") || s.camera; this.hour = q.get("g3dhour") || s.hour;
    this.trees = q.get("g3dtrees") || s.trees; if (!(this.trees in TREE_STYLES)) this.trees = "courtyard";
    this.fx = [];
  }
  on(k) { return !!this.map[k]; }
  set(k, v) { this.map[k] = !!v; this.save(); }
  save() { try { localStorage.setItem(KEY, JSON.stringify({ on: this.map, quality: this.quality, camera: this.camera, hour: this.hour, trees: this.trees })); } catch (e) { /* private mode */ } }
}

export function attach3D({ screen, getGame }) { return new Page(new Layers(), screen, getGame); }

class Page {
  constructor(L, screen, getGame) {
    this.L = L; this.screen = screen; this.getGame = getGame; this.scene = null; this.failed = null;
    this.stats = { drawn: 0, fps: 0, t0: performance.now(), n: 0, ms: 0 };
    installOamTags();
    this.canvas = document.createElement("canvas");
    this.canvas.id = "view3d"; this.canvas.setAttribute("aria-hidden", "true");
    Object.assign(this.canvas.style, { position: "absolute", left: "0", top: "0", pointerEvents: "none", display: "none", zIndex: "5", imageRendering: "auto" });
    document.body.appendChild(this.canvas);
    this.fx = FX.map(F => new F());
    this.buildPanel();
    window.__g3d = this;
    // while the game is not stepping (the page paused, a stopped round) the picture is still drawn from the last frame, so the
    // camera, the effects and a changed option keep showing
    const idle = () => { requestAnimationFrame(idle); const t = performance.now(); if (this.lastGame && t - this.presentAt > 120) this.present(this.lastGame, this.lastFrame, true); };
    requestAnimationFrame(idle);
  }
  get active() { return this.L.on("view3d") && !this.failed; }
  ensure() {
    if (this.scene || this.failed) return this.scene;
    try { this.scene = new Golf3D(this.canvas, this.L); } catch (e) { this.failed = e.message; console.warn("3D view", e); this.showStatus(); }
    return this.scene;
  }
  refreshFx() { this.L.fx = this.fx.filter(f => this.L.on(f.key)); }
  // after each game frame (the effects that follow the play)
  afterStep(game) {
    if (!this.active || !game || !game.w) return;
    try { const sc = this.ensure(); if (!sc) return; this.refreshFx(); sc.frame(game); }
    catch (e) { this.fail(e); }
  }
  // once per drawn frame: true when the 3D view drew this frame (the 2D canvas is covered)
  present(game, frame2d, idle = false) {
    if (!idle) { this.lastGame = game; this.lastFrame = frame2d; }
    this.presentAt = performance.now();
    if (!this.active || !game || !game.w) { this.hide(); return false; }
    try {
      const sc = this.ensure(); if (!sc) { this.hide(); return false; }
      this.place();
      const t = performance.now(), drew = sc.render(game, frame2d);
      if (!drew) { this.hide(); return false; }
      this.canvas.style.display = "block";
      const st = this.stats; st.n++; st.drawn++; st.ms += performance.now() - t;
      if (t - st.t0 > 1000) { st.fps = st.n * 1000 / (t - st.t0); st.cpu = st.ms / st.n; st.n = 0; st.ms = 0; st.t0 = t; this.showStatus(); }
      return true;
    } catch (e) { this.fail(e); this.hide(); return false; }
  }
  fail(e) { console.warn("3D view stopped", e); this.failed = e.message; this.hide(); this.showStatus(); }
  hide() { if (this.canvas.style.display !== "none") this.canvas.style.display = "none"; }
  // the canvas over the game's screen (its size in device pixels; Lite at a lower resolution)
  place() {
    const r = this.screen.getBoundingClientRect(), c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2);
    // the resolution: Lite at 0.6; both come down by themselves while the pictures come slower than ~40 a second, and go back up
    const now = performance.now(), dtp = this.lastPlace ? now - this.lastPlace : 16; this.lastPlace = now;
    this.avg = this.avg ? this.avg * 0.9 + Math.min(dtp, 200) * 0.1 : 16;
    if (!this.resK) this.resK = 1;
    if ((this.adjustAt = (this.adjustAt || 0) + 1) % 20 === 0) { if (this.avg > 25 && this.resK > 0.4) this.resK *= 0.85; else if (this.avg < 19 && this.resK < 1) this.resK = Math.min(1, this.resK * 1.1); }
    const k = (this.L.quality === "lite" ? 0.6 : 1) * this.resK;
    const W = Math.max(160, Math.round(r.width * dpr * k)), H = Math.max(144, Math.round(r.height * dpr * k));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const x = r.left + window.scrollX, y = r.top + window.scrollY;
    if (this.px !== x || this.py !== y || this.pw !== r.width || this.ph !== r.height) {
      this.px = x; this.py = y; this.pw = r.width; this.ph = r.height;
      Object.assign(c.style, { left: x + "px", top: y + "px", width: r.width + "px", height: r.height + "px" });
    }
  }
  showStatus() {
    const el = document.getElementById("g3dstatus"); if (!el) return;
    const st = this.stats, sc = this.scene;
    el.textContent = this.failed ? `3D view unavailable: ${this.failed}` : !this.L.on("view3d") ? "3D view off (the 2D picture)"
      : `3D ${st.fps.toFixed(0)} fps, ${(st.cpu || 0).toFixed(1)} ms a frame${sc && sc.status ? " · " + sc.status : ""}`;
  }
  // ---- the panel of options (the page's #layers3d section, or made here) ----
  buildPanel() {
    let p = document.getElementById("layers3d");
    if (!p) { p = document.createElement("section"); p.id = "layers3d"; p.className = "panel dim"; const m = document.getElementById("modes"); (m ? m.parentNode : document.body).insertBefore(p, m ? m.nextSibling : null); }
    const L = this.L, el = (t, a = {}, ...kids) => { const e = document.createElement(t); Object.assign(e, a); for (const k of kids) e.append(k); return e; };
    p.innerHTML = "";
    const head = el("div", { className: "g3dhead" });
    const sel = (label, opts, cur, set) => { const s = el("select"); for (const [v, t] of Object.entries(opts)) s.append(el("option", { value: v, textContent: t, selected: String(v) === String(cur) })); s.onchange = () => { set(s.value); L.save(); }; return el("label", {}, label + " ", s); };
    head.append(sel("Camera", PRESETS, L.camera, v => { L.camera = v; }), " ", sel("Hour", HOURS, L.hour, v => { L.hour = v; }), " ",
      sel("Quality", { full: "Full", lite: "Lite (phones)" }, L.quality, v => { L.quality = v; if (this.scene && this.scene.hole) this.scene.hole.id = -1; }), " ",
      sel("Trees", TREE_STYLES, L.trees, v => { L.trees = v; }));
    const list = el("div", { className: "g3dlist" });
    for (const [k, label, phase, what] of LAYERS) {
      const cb = el("input", { type: "checkbox", checked: L.on(k) });
      cb.onchange = () => { L.set(k, cb.checked); if (k === "view3d") { this.showStatus(); if (!cb.checked) this.hide(); } };
      list.append(el("label", { title: what, className: k === "view3d" ? "master" : "" }, cb, " " + label));
    }
    const status = el("div", { id: "g3dstatus" });
    const notes = el("details", { className: "g3dnotes" }, el("summary", { textContent: "What's new in 3D" }));
    fetch("whatsnew3d.md").then(r => r.ok ? r.text() : "").then(t => { if (t) notes.append(mdToHtml(t)); }).catch(() => {});
    p.append(el("div", { className: "g3dtitle", innerHTML: "<b>3D layers</b> <span class=dim>(render only: the game runs the same with them on or off)</span>" }), head, list, status, notes);
    const css = document.createElement("style");
    css.textContent = "#layers3d .g3dlist{display:flex;flex-wrap:wrap;gap:4px 12px;margin:6px 0}#layers3d .g3dlist label.master{font-weight:bold}" +
      "#layers3d select{font:inherit;background:var(--btn);color:var(--fg);border:1px solid var(--line);border-radius:6px}#layers3d .g3dnotes{margin-top:6px}" +
      "#layers3d .g3dnotes h3{font-size:13px;margin:8px 0 2px}#layers3d .g3dnotes ul{margin:2px 0 6px;padding-left:18px}";
    document.head.appendChild(css);
    this.showStatus();
  }
}
// a small markdown reader for the notes (headings, lists, paragraphs, `code`, **bold**)
function mdToHtml(t) {
  const d = document.createElement("div"); let html = "", inList = false;
  const inline = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  for (const line of t.split("\n")) {
    if (/^\s*[-*] /.test(line)) { if (!inList) { html += "<ul>"; inList = true; } html += "<li>" + inline(line.replace(/^\s*[-*] /, "")) + "</li>"; continue; }
    if (inList) { html += "</ul>"; inList = false; }
    if (/^#+ /.test(line)) html += "<h3>" + inline(line.replace(/^#+ /, "")) + "</h3>";
    else if (line.trim()) html += "<p>" + inline(line) + "</p>";
  }
  if (inList) html += "</ul>";
  d.innerHTML = html; return d;
}
