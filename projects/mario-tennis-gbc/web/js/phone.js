// Phone conveniences in the GAME menu (full.js attachPhone; the Android wrapper's MTennApp bridge where there is one):
//   VIBRATE      a short buzz when your player hits the ball, a longer one when you win a point (the score $C8E0-$C8E5, the rally's
//                shot count $C4B6 and the ball's side $C404 at the hit); read only
//   SHOT         saves a picture of the game view to Downloads/MTenn3D (a download in a browser)
//   SAVE / LOAD  two quick slots holding the exact moment (the machine state, as save states), kept in this browser's IndexedDB;
//                with CODE: ROM only: the JS port's game is partly JavaScript (its coroutines), which a machine state can't hold
//   BATTERY      saver: the 3D view drawn at most 60 times a second and the lighting at its low quality
//   WHAT'S NEW   the changelog (web/whatsnew.md)
const stored = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const keep = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
const quickStore = (mode, fn) => new Promise((ok, fail) => {
  try {
    const open = indexedDB.open("mt-quick", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("slots");
    open.onerror = () => fail(open.error);
    open.onsuccess = () => { const tx = open.result.transaction("slots", mode), r = fn(tx.objectStore("slots")); tx.oncomplete = () => ok(r && r.result); tx.onerror = () => fail(tx.error); };
  } catch (e) { fail(e); }
});

export class Phone {
  // ctx: gb(), voxel(), view3d(), redraw(), saveState(), loadState(s), romHash(), hint(text), status(text), isPort()
  constructor(ctx) {
    this.ctx = ctx; this.vibrate = stored("mt-vibrate") !== "off"; this.battery = stored("mt-battery") === "on"; this.prev = null; this.lastDraw = 0;
  }
  buzz(ms) {
    if (!this.vibrate) return;
    if (window.MTennApp && window.MTennApp.vibrate) { try { window.MTennApp.vibrate(ms); } catch (e) { /* old app */ } }
    else if (navigator.vibrate) navigator.vibrate(ms);
  }
  // per game frame (full.js frame)
  frame(gb) {
    const w = gb.mem.wram[0]; if (w[0x32E] > 15) { this.prev = null; return; }          // matches only (wCurMapID: a court)
    const S = { p1: w[0x8E4] + 16 * w[0x8E2] + 256 * w[0x8E0], p2: w[0x8E5] + 16 * w[0x8E3] + 256 * w[0x8E1], hits: w[0x4B6], y: (w[0x404] | w[0x405] << 8 | w[0x406] << 16 | w[0x407] << 24) / 65536 }, p = this.prev;
    this.prev = S; if (!p) return;
    if (S.hits === p.hits + 1 && S.y > 0) this.buzz(18);                                  // a shot from the near side (P1, yours)
    if (S.p1 > p.p1) this.buzz(70);                                                        // your point: a longer buzz
  }
  // full.js loop: false when the battery saver skips this display frame (at most 60 pictures a second)
  allowDraw(now) { if (!this.battery) return true; if (now - this.lastDraw < 15.5) return false; this.lastDraw = now; return true; }
  applyBattery() {
    const L = this.ctx.voxel() && this.ctx.voxel().light; if (!L) return;
    if (this.battery) { L.tierWant = 0; L.tier = 0; L.auto = false; }
    else { const q = L.cfg && L.cfg.quality; L.auto = !q || q === "auto"; if (!L.auto) L.tierWant = L.tier = { low: 0, medium: 1, high: 2 }[q] ?? 1; }
  }
  screenshot() {
    const c = this.ctx; if (!c.gb()) return;
    c.redraw();                                       // (the 3D canvas keeps its picture only until the frame is shown: draw it now)
    const cv = document.getElementById(c.view3d() ? "gl" : "screen"), url = cv.toDataURL("image/png"), b64 = url.slice(url.indexOf(",") + 1);
    const d = new Date(), pad = n => String(n).padStart(2, "0");
    const name = `mtenn3d-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
    if (window.MTennApp && window.MTennApp.saveImage) window.MTennApp.saveImage(name, b64);
    else { const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
    c.hint("Picture saved: " + name);
  }
  portBlocked() { if (!this.ctx.isPort || !this.ctx.isPort()) return false; this.ctx.hint("Quick save works with CODE: ROM only (GAME menu): the JS port's game can't be saved mid-play yet. The game's own save works."); return true; }
  async quickSave(slot) {
    const c = this.ctx; if (!c.gb() || this.portBlocked()) return;
    try { const s = JSON.stringify(c.saveState()); await quickStore("readwrite", st => st.put({ s, rom: c.romHash(), at: Date.now() }, "slot" + slot)); c.hint("Saved to slot " + slot); }   // (as JSON: the state holds a function IndexedDB cannot store)
    catch (e) { c.hint("Could not save: " + e); }
  }
  async quickLoad(slot) {
    const c = this.ctx; if (!c.gb() || this.portBlocked()) return;
    try {
      const r = await quickStore("readonly", st => st.get("slot" + slot));
      if (!r) { c.hint("Slot " + slot + " is empty"); return; }
      if (r.rom && c.romHash() && r.rom !== c.romHash()) { c.hint("Slot " + slot + " is from another ROM"); return; }
      c.loadState(typeof r.s === "string" ? JSON.parse(r.s) : r.s); c.hint("Loaded slot " + slot);
    } catch (e) { c.hint("Could not load: " + e); }
  }
  async whatsNew() {
    let el = document.getElementById("whatsnew");
    if (el) { el.remove(); return; }
    el = document.createElement("div"); el.id = "whatsnew";
    el.style.cssText = "position:fixed;inset:6% 6%;z-index:30;overflow:auto;padding:18px 22px;border-radius:14px;background:rgba(14,16,24,.96);color:#e8ecf4;font:14px/1.45 sans-serif;box-shadow:0 8px 40px rgba(0,0,0,.6)";
    el.innerHTML = "<div style='text-align:right'><span class='k' id='wnclose'>CLOSE</span></div><div id='wnbody'>Loading…</div>";
    document.body.appendChild(el); el.querySelector("#wnclose").addEventListener("pointerdown", e => { e.stopPropagation(); el.remove(); });
    try { el.querySelector("#wnbody").innerHTML = markdown(await (await fetch(new URL("../whatsnew.md", import.meta.url))).text()); }
    catch (e) { el.querySelector("#wnbody").textContent = "The changelog could not be read."; }
  }
}
// the little Markdown the changelog uses: headings, bullets (two levels), bold, paragraphs
function markdown(md) {
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), inl = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  let html = "", list = 0;
  const close = () => { while (list > 0) { html += "</ul>"; list--; } };
  for (const line of md.split("\n")) {
    const h = line.match(/^(#{1,3}) (.*)/), li = line.match(/^(\s*)[-*] (.*)/);
    if (h) { close(); html += `<h${h[1].length + 1} style="margin:14px 0 6px">${inl(h[2])}</h${h[1].length + 1}>`; }
    else if (li) { const d = li[1].length >= 2 ? 2 : 1; while (list < d) { html += "<ul style='margin:2px 0;padding-left:20px'>"; list++; } while (list > d) { html += "</ul>"; list--; } html += `<li>${inl(li[2])}</li>`; }
    else if (/^-{3,}$/.test(line.trim())) { close(); html += "<hr style='border:0;border-top:1px solid #333'>"; }
    else if (line.trim()) { close(); html += `<p style="margin:6px 0">${inl(line)}</p>`; }
  }
  close(); return html;
}

export function attachPhone(hud, ctx) {
  const ph = new Phone(ctx), btn = (id, title, label, fn) => {
    const b = document.createElement("span"); b.className = "k"; b.id = id; b.title = title; b.textContent = label;
    b.addEventListener("pointerdown", e => { e.stopPropagation(); fn(b); }); hud.appendChild(document.createTextNode(" ")); hud.appendChild(b); return b;
  };
  const vib = btn("vibratebtn", "a short buzz when you hit the ball, a longer one when you win a point", "", b => { ph.vibrate = !ph.vibrate; keep("mt-vibrate", ph.vibrate ? "on" : "off"); show(); if (ph.vibrate) ph.buzz(40); });
  const bat = btn("batterybtn", "battery saver: the 3D view at most 60 frames a second and the lighting at low quality", "", b => { ph.battery = !ph.battery; keep("mt-battery", ph.battery ? "on" : "off"); ph.applyBattery(); show(); });
  const show = () => { vib.textContent = "VIBRATE: " + (ph.vibrate ? "on" : "off"); vib.classList.toggle("on", ph.vibrate); bat.textContent = "BATTERY: " + (ph.battery ? "saver" : "normal"); bat.classList.toggle("on", ph.battery); };
  btn("shotbtn", "save a picture of the game to Downloads/MTenn3D", "SHOT", () => ph.screenshot());
  for (const k of [1, 2]) btn("qsave" + k, "save this exact moment in quick slot " + k, "SAVE " + k, () => ph.quickSave(k));
  for (const k of [1, 2]) btn("qload" + k, "go back to the moment in quick slot " + k, "LOAD " + k, () => ph.quickLoad(k));
  btn("whatsnewbtn", "the changelog: what is new in this version", "WHAT'S NEW", () => ph.whatsNew());
  show(); return ph;
}
