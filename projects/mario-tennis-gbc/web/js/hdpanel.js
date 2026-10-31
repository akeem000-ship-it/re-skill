// An HD panel over the game in the menus' style (tour.js TOUR, modes.js RECORDS): a row of page tabs, a scrolling body, the game paused
// while it is open. LEFT / RIGHT change the page, UP / DOWN scroll, B or START close it; the tabs and the backdrop work by touch, the
// arrows and Escape by keyboard. Also the shared toast (a short note at the top of the screen) and the small chips the panels' owners
// show over the game (.hdchip). A subclass gives pages() (the tab names) and pageFns() (each page's HTML, called on the subclass).
let css = false, toastEl = null, toastT = 0;
const STYLE = `
.hdpanel { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; background: rgba(6,12,30,.72); font: 16px Itim, system-ui, sans-serif; }
.hdpanel .tp { width: min(760px, 94vw); height: min(560px, 88vh); background: #f6f4ee; border-radius: 18px; border: 4px solid #ffcf3a; box-shadow: 0 10px 40px rgba(0,0,0,.5); display: flex; flex-direction: column; overflow: hidden; color: #2a2016; }
.hdpanel .tabs { display: flex; gap: 4px; padding: 10px 12px 0; background: #1d2b7a; flex-wrap: wrap; }
.hdpanel .tab { font: 18px "MT Luckiest Guy", Impact, sans-serif; color: #c9d2ff; padding: 6px 12px 4px; border-radius: 10px 10px 0 0; cursor: pointer; letter-spacing: .5px; }
.hdpanel .tab.on { background: #f6f4ee; color: #1d2b7a; }
.hdpanel .body { flex: 1; overflow-y: auto; padding: 14px 18px; }
.hdpanel h3 { font: 20px "MT Luckiest Guy", Impact, sans-serif; color: #1d2b7a; margin: 10px 0 4px; letter-spacing: .5px; }
.hdpanel table { border-collapse: collapse; width: 100%; margin-bottom: 6px; }
.hdpanel td { padding: 3px 6px; border-bottom: 1px solid #e4dfd2; }
.hdpanel tr.you td { background: #ffe58a; font-weight: bold; }
.hdpanel .n { text-align: right; color: #6a5d48; white-space: nowrap; }
.hdpanel td.rk { width: 34px; }
.hdpanel .hint { color: #6a5d48; font-size: 14px; }
.hdpanel .bar { height: 12px; border-radius: 6px; background: #e4dfd2; overflow: hidden; }
.hdpanel .bar i { display: block; height: 100%; border-radius: 6px; }
.hdpanel .foot { padding: 6px 16px 10px; color: #6a5d48; font-size: 14px; text-align: right; }
.hdpanel .chip { display: inline-block; padding: 1px 8px; border-radius: 9px; background: #1d2b7a; color: #fff; font-size: 13px; margin-left: 6px; }
.hdpanel .up { color: #2e9e3e; } .hdpanel .dn { color: #d03030; }
.hdpanel .sp { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid #e4dfd2; }
.hdpanel .sp b { font: 17px "MT Luckiest Guy", Impact, sans-serif; letter-spacing: .5px; min-width: 170px; }
.hdpanel .sp.off { opacity: .45; }
.hdpanel .big { font: 30px "MT Luckiest Guy", Impact, sans-serif; color: #1d2b7a; letter-spacing: .5px; }
.hdchip { position: fixed; z-index: 30; left: 50%; bottom: 8%; transform: translateX(-50%); background: rgba(29,43,122,.92); color: #fff; border: 3px solid #ffcf3a; border-radius: 14px; padding: 6px 16px; font: 17px Itim, system-ui, sans-serif; pointer-events: none; display: none; text-align: center; }
.hdchip b { font: 19px "MT Luckiest Guy", Impact, sans-serif; color: #ffcf3a; letter-spacing: .5px; }
.hdtoast { position: fixed; z-index: 35; left: 50%; top: 12%; transform: translateX(-50%); background: rgba(246,244,238,.96); color: #1d2b7a; border: 3px solid #ffcf3a; border-radius: 14px; padding: 8px 18px; font: 18px Itim, system-ui, sans-serif; pointer-events: none; transition: opacity .6s; box-shadow: 0 6px 20px rgba(0,0,0,.4); }`;
export function hdStyle() { if (css || typeof document === "undefined") return; css = true; const st = document.createElement("style"); st.textContent = STYLE; document.head.appendChild(st); }
// while the game shows a message window (full.js: the HD text reader has a sentence on screen), a toast waits for it to close (at
// most 12 s): it would cover the game's own words
let holdFn = null, holdT = 0;
export function setToastHold(f) { holdFn = f; }
export function toast(msg, waited = 0) {
  if (typeof document === "undefined") return;
  if (holdFn && waited < 12000) { let busy = false; try { busy = !!holdFn(); } catch (e) { /* no reader yet */ }
    if (busy) { clearTimeout(holdT); holdT = setTimeout(() => toast(msg, waited + 300), 300); return; } }
  hdStyle();
  if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "hdtoast"; document.body.appendChild(toastEl); }
  toastEl.textContent = msg; toastEl.style.opacity = "1"; toastEl.style.display = "block";
  clearTimeout(toastT); toastT = setTimeout(() => { toastEl.style.opacity = "0"; }, 3200);
}
export const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

export class HdPanel {
  constructor({ pause, pad, toast: t }) { this.pause = pause; this.pad = pad; this.toastFn = t; this.root = null; this.page = 0; this.open = false; this.needs = ""; }
  pages() { return []; }
  pageFns() { return []; }
  toast(msg) { if (this.toastFn) this.toastFn(msg); else toast(msg); }
  esc(s) { return esc(s); }
  build() {
    if (this.root) return; hdStyle();
    const r = this.root = document.createElement("div"); r.className = "hdpanel"; r.hidden = true;
    r.innerHTML = `<div class="tp"><div class="tabs"></div><div class="body"></div><div class="foot">◀ ▶ page &nbsp; ▲ ▼ scroll &nbsp; B close</div></div>`;
    r.addEventListener("pointerdown", e => { if (e.target === r) this.close(); });
    document.body.appendChild(r);
  }
  show() {
    this.build(); this.open = true; this.root.hidden = false; this.wasPaused = this.pause(true); this.render();
    this.lastPad = null; const loop = () => { if (!this.open) return; this.padStep(); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
    this.keyH = e => { const k = { ArrowLeft: 0x20, ArrowRight: 0x10, ArrowUp: 0x40, ArrowDown: 0x80, Escape: 2, KeyX: 2, Enter: 8 }[e.code]; if (k) { e.preventDefault(); e.stopPropagation(); this.input(k); } };
    addEventListener("keydown", this.keyH, true);
  }
  close() { if (!this.open) return; this.open = false; this.root.hidden = true; removeEventListener("keydown", this.keyH, true); this.pause(this.wasPaused); }
  toggle() { if (this.open) this.close(); else this.show(); }
  padStep() {
    if (!this.pad) return; const p = this.pad(), m = (p.a ? 1 : 0) | (p.b ? 2 : 0) | (p.start ? 8 : 0) | (p.right ? 0x10 : 0) | (p.left ? 0x20 : 0) | (p.up ? 0x40 : 0) | (p.down ? 0x80 : 0);
    if (this.lastPad === null) { this.lastPad = m; return; }                // (the press that opened the panel)
    const edge = m & ~this.lastPad; this.lastPad = m; if (edge) this.input(edge);
  }
  input(edge) {
    const n = this.pages().length, body = this.root.querySelector(".body");
    if (edge & 0x0A) { this.close(); return; }
    if (edge & 0x30) { this.page = (this.page + (edge & 0x10 ? 1 : n - 1)) % n; this.render(); return; }
    if (edge & 0xC0) body.scrollTop += edge & 0x80 ? 90 : -90;
  }
  render() {
    const tabs = this.root.querySelector(".tabs"), body = this.root.querySelector(".body");
    tabs.innerHTML = this.pages().map((p, i) => `<span class="tab${i === this.page ? " on" : ""}" data-i="${i}">${p}</span>`).join("");
    tabs.querySelectorAll(".tab").forEach(t => t.addEventListener("pointerdown", e => { e.stopPropagation(); this.page = +t.dataset.i; this.render(); }));
    body.scrollTop = 0;
    try { body.innerHTML = this.pageFns()[this.page].call(this); }
    catch (e) { body.innerHTML = `<p class="hint">${this.needs || "Nothing to show yet."}</p>`; console.warn("panel", e); }
  }
}
