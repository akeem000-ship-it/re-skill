// OPTIONS: every setting of the play page on one screen, by category, as Mario Tennis's OPTIONS (its menuwheel.js OPTION_CATS): a list
// of categories (PLAY, PICTURE, 3D VIEW, EFFECTS, STORY, CONTROLS, SOUND, ABOUT), one shown at a time, each a panel of rows: the
// setting's name and its value on a pill, the row under the pad gold, its help at the bottom.
// Opened from the button bar's OPTIONS (touch screens: the app's Back or the gear), the OPTIONS button under the picture (a computer)
// or the O key; BACK, Escape or the app's Back close it. The game keeps running behind it, as it did with the old panels; while it is
// open the keys and the controller drive the options instead of the game (as Mario Tennis's): ▲ ▼ a category, A (or ▶) opens it; then
// ▲ ▼ a setting, A / ◀ ▶ change it, B back to the categories; B on the categories or START closes.
// The rows are the page's own controls (made by view.js, portrait.js, aimpower.js, page.js and g3d/layers.js, with the same ids, the
// same handlers, the same storage keys and URL parameters as before): this screen only moves them into its rows and restyles them, so
// a setting saved before keeps working. Nothing here touches the game's memory.
const NAMES = {
  mode: "Start", optcourse: "Course", opthole: "Hole", apmeter: "Meter", appreview: "Preview", apmarks: "Markers", aptap: "Tap area",
  g3dputt: "Putting", hdview: "View", hdfont: "Text", hdui: "Menus", hddeck: "Deck", g3dq: "Quality", hdshot: "Picture",
  g3dcam: "Camera", g3dhour: "Hour", g3dtrees: "Trees", g3dgrass: "Grass", g3dsand: "Sand", g3dgreen: "Green", hdpad: "Touch",
  hdvibrate: "Vibrate", optsound: "Sound",
};
const HELP = {
  mode: "where the game starts: power-on (the title and the menus), straight into a Stroke or Match round, or two Game Boys joined by a cable. Changing it starts again",
  optcourse: "the Stroke start's course (?course=)", opthole: "the Stroke start's first hole (?hole=)",
  apmeter: "Big: the swing meter grows into the middle of the picture while you swing (the game's own timing)",
  appreview: "a helper: the flight of a perfect full-power swing with this club, aim, lie and wind",
  apmarks: "the aim line, the target's yards, rings every 50 y and the pin's distance",
  aptap: "touch screens: the lower half of the screen is the A button while you swing",
  g3dputt: "3D: Green camera puts the camera low behind the ball at the cup while you aim a putt, with the break of four putts",
  hdview: "the picture's shape: 10:9 (the Game Boy's), 4:3, Fill (the space it has) or Wide 16:9, the real map at the sides",
  hdfont: "the game's text in its own font or redrawn in a high-resolution one", hdui: "HD: menus, windows, cursors and the HUD redrawn as clean art",
  hddeck: "a phone held upright: the controls' background during golf, a live shot map of the hole or the hole's art",
  g3dq: "3D: Full, or Lite (a lower resolution) for slower phones", hdshot: "save a picture of the game view",
  g3dcam: "3D: the camera, Follow (the game's views), Course, Behind or TV", g3dhour: "3D: the time of day of the round",
  g3dtrees: "3D: Courtyard trees (Mario Tennis's courtyard design) or the Original ones", g3dgrass: "3D: Carpet, a real-looking lawn, or Pixel (the look before)",
  g3dsand: "3D: Fine sand with ripples and rakes, or Pixel (the look before)", g3dgreen: "3D (Grass: Carpet): Clean mown turf moving downhill with the slope, or the painted Arrows",
  hdpad: "touch screens: the analog stick (where the thumb lands) or the D-pad", hdvibrate: "a short buzz at the impact and on the game's big moments",
  optsound: "the game's music and sounds (the M key)",
};
// [label, description, rows]: a row is a control's id ("g3d-<layer>" for the 3D layers' switches), "info:<what>" or "about"
export const CATEGORIES = [
  ["PLAY", "where the game starts, the aim and swing helpers, putting", ["mode", "optcourse", "opthole", "apmeter", "appreview", "apmarks", "aptap", "g3dputt"]],
  ["PICTURE", "the picture's shape, its text and menus, the deck", ["hdview", "hdfont", "hdui", "hddeck", "g3dq", "hdshot"]],
  ["3D VIEW", "the hole in 3D: the camera, the light, the ground", ["g3d-view3d", "g3dcam", "g3dhour", "g3d-light", "g3d-sky", "g3d-hills", "g3dtrees", "g3dgrass", "g3dsand", "g3dgreen", "g3d-terrain", "g3d-wear", "info:g3dstatus"]],
  ["EFFECTS", "the 3D view's extras round the shots", ["g3d-ballfx", "g3d-ambience", "g3d-replay", "g3d-closecall", "g3d-moments", "g3d-gallery", "g3d-titleshow"]],
  ["STORY", "the story mode's maps between the clubs", ["g3d-field3d", "g3d-fieldlife"]],
  ["CONTROLS", "touch, vibration, the keys and controllers", ["hdpad", "hdvibrate", "info:keys"]],
  ["SOUND", "the game's music and sounds", ["optsound"]],
  ["ABOUT", "this page, how to play, what's new", ["about"]],
];
const KEYS_HTML = `<p><b>Keys</b>: arrows, <kbd>Z</kbd> A, <kbd>X</kbd> B, <kbd>Shift</kbd> Select, <kbd>Enter</kbd> Start, <kbd>P</kbd> pause the page,
  <kbd>Space</kbd> fast, <kbd>M</kbd> mute, <kbd>O</kbd> these options, <kbd>Tab</kbd> the other Game Boy (link).</p>
  <p><b>Controllers</b> work too: the d-pad or the left stick, A, B, Select (L1), Start (R1); R2 held runs the game fast, L2 switches the view.
  In the Android app Back opens the button bar.</p>
  <p><b>Golf</b>: aim with ◀ ▶, change club with ▲ ▼, B for the shot type, Select to look at the pin, A to address the ball, then A for power
  and A for the impact. Start while aiming opens the game's pause menu.</p>`;

export function attachOptions({ keys, hdPage, g3d, sound }) {
  const body = document.body, $ = id => document.getElementById(id);
  const el = (t, a = {}, ...kids) => { const e = document.createElement(t); Object.assign(e, a); for (const k of kids) if (k != null) e.append(k); return e; };
  const q = new URLSearchParams(location.search);
  // ---- the page's controls this screen adds itself: the Stroke start's course and hole (the URL's ?course= ?hole=), the sound ----
  const urlSel = (id, param, n) => {
    const s = el("select", { id });
    s.append(el("option", { value: "", textContent: "Default" }));
    for (let i = 1; i <= n; i++) s.append(el("option", { value: String(i), textContent: String(i) }));
    const v = q.get(param); s.value = v && +v >= 1 && +v <= n ? String(+v) : "";
    s.addEventListener("change", () => {
      const u = new URL(location.href); if (s.value) u.searchParams.set(param, s.value); else u.searchParams.delete(param);
      history.replaceState(history.state, "", u.pathname + u.search + u.hash);
      const m = $("mode"); if (m && m.value === "stroke") m.dispatchEvent(new Event("change"));   // (a Stroke start: from there)
    });
    return s;
  };
  const made = { optcourse: urlSel("optcourse", "course", 4), opthole: urlSel("opthole", "hole", 18) };
  if (sound) {
    const s = el("select", { id: "optsound" });
    for (const [v, t] of [["on", "On"], ["off", "Off (muted)"]]) s.append(el("option", { value: v, textContent: t }));
    s.value = sound.muted() ? "off" : "on"; s.addEventListener("change", () => sound.set(s.value === "off"));
    sound.onChange = m => { s.value = m ? "off" : "on"; };
    made.optsound = s;
  }
  // the 3D layers' switches: their labels (the help is the label's title)
  const layerBox = id => { const cb = $(id); return cb && cb.type === "checkbox" ? cb : null; };

  // ---- the screen ----
  const root = el("div", { id: "mgopts" }); root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Options");
  const close = el("button", { className: "mo-close", textContent: "BACK", title: "back to the game (Back, Escape)" });
  const head = el("div", { className: "mo-head" }, el("span", { className: "mo-title", textContent: "OPTIONS" }), close);
  const cats = el("nav", { className: "mo-cats" }), panel = el("div", { className: "mo-panel" });
  const desc = el("div", { className: "mo-desc" }), rowsBox = el("div", { className: "mo-rows" }), help = el("div", { className: "mo-help" });
  panel.append(desc, rowsBox, help);
  const keysLine = el("div", { className: "mo-keys" });
  root.append(head, cats, panel, keysLine);
  body.appendChild(root);

  // each category's rows: [{ id, row, ctl (the control: select / checkbox / button / null), help }]
  const sections = CATEGORIES.map(([name, what, ids], ci) => {
    const tab = el("button", { className: "mo-tab", textContent: name }); tab.dataset.cat = name.toLowerCase().replace(/\W+/g, "");
    tab.addEventListener("click", () => { show(ci); state.inCat = false; paint(); });
    cats.appendChild(tab);
    const box = el("div", { className: "mo-sec" }); box.dataset.cat = tab.dataset.cat; box.hidden = true;
    const rows = [];
    for (const id of ids) {
      if (id === "about") { box.append(about()); continue; }
      if (id.startsWith("info:")) {
        const what = id.slice(5), row = el("div", { className: "mo-info" });
        if (what === "keys") row.innerHTML = KEYS_HTML;
        else { const s = $(what); if (!s) continue; row.append(s); }
        box.append(row); continue;
      }
      let ctl = made[id] || $(id), name = NAMES[id], hint = HELP[id] || "";
      if (!ctl) continue;                                                     // (a control this screen has none of here: the touch ones on a computer)
      const row = el("div", { className: "mo-row" }); row.dataset.id = id;
      if (ctl.type === "checkbox") {                                          // a 3D layer's switch: the row is its label, an On / Off pill
        const lab = ctl.closest("label"); hint = hint || (lab && lab.title) || "";
        name = name || (lab ? lab.textContent.trim() : id);
        const t = el("label", { className: "mo-toggle" }, ctl, el("span", { className: "mo-pill" })); ctl.classList.add("mo-check");
        row.append(el("span", { className: "mo-name", textContent: name }), t);
        if (lab) lab.remove();
      } else if (ctl.tagName === "SELECT") {
        const lab = ctl.closest("label"); ctl.classList.add("mo-pill"); hint = hint || ctl.title || "";
        row.append(el("span", { className: "mo-name", textContent: name || id }), ctl);
        if (lab) lab.remove();
      } else if (ctl.tagName === "BUTTON") {
        ctl.textContent = "Save"; ctl.classList.add("mo-pill");
        row.append(el("span", { className: "mo-name", textContent: name || id }), ctl);
      } else continue;
      row.addEventListener("pointerdown", () => { state.cat = ci; state.row = rows.findIndex(r => r.row === row); state.inCat = true; paint(); });
      rows.push({ id, row, ctl, help: hint }); box.append(row);
    }
    rowsBox.append(box);
    return { name, what, tab, box, rows };
  });
  // ABOUT: the page's notes, the keys and the 3D view's news, folded
  function about() {
    const d = el("div", { className: "mo-about" });
    const fold = (title, ...kids) => el("details", {}, el("summary", { textContent: title }), ...kids);
    const note = $("note");
    if (note) { const inner = el("div"); while (note.firstChild) inner.append(note.firstChild); note.remove(); d.append(fold("This page", inner)); }
    const news = document.querySelector("#layers3d .g3dnotes");
    if (news) { news.removeAttribute("open"); news.className = "g3dnotes"; d.append(news); }
    return d;
  }
  // the old panels' remains (now empty): out of the page
  for (const id of ["modes", "hdopts", "layers3d"]) { const p = $(id); if (p) p.remove(); }
  // a computer: the OPTIONS button under the picture (touch screens have the gear and the button bar)
  const msg = $("message");
  const btn = el("button", { id: "optsbtn", textContent: "⚙ OPTIONS", title: "every setting: play, picture, 3D view, controls (O)" });
  btn.addEventListener("click", () => open());
  const bar = el("div", { id: "optrow" }, btn);
  if (msg) msg.after(bar); else body.appendChild(bar);
  close.addEventListener("click", () => closeIt());

  // ---- state, the pad ----
  let saved = 0; try { saved = Math.max(0, CATEGORIES.findIndex(c => c[0] === localStorage.getItem("mg-optcat"))); } catch (e) { saved = 0; }
  const state = { open: false, cat: saved, row: 0, inCat: false, held: 0 };
  function show(ci) {
    state.cat = ci; state.row = 0;
    try { localStorage.setItem("mg-optcat", CATEGORIES[ci][0]); } catch (e) { /* private mode */ }
  }
  function paint() {
    const s = sections[state.cat];
    sections.forEach((x, i) => { x.tab.classList.toggle("on", i === state.cat); x.tab.classList.toggle("focus", i === state.cat && !state.inCat); x.box.hidden = i !== state.cat; });
    desc.textContent = s.what;
    const visible = s.rows.filter(r => !r.row.hidden);
    if (state.row >= visible.length) state.row = Math.max(0, visible.length - 1);
    s.rows.forEach(r => r.row.classList.toggle("cur", state.inCat && r === visible[state.row]));
    const cur = state.inCat ? visible[state.row] : null;   // (the help: of the row under the pad, or the one last touched)
    help.textContent = cur ? cur.help : "";
    help.hidden = !cur || !cur.help;
    if (state.inCat && cur) cur.row.scrollIntoView({ block: "nearest" });
    keysLine.textContent = state.inCat ? "▲ ▼ setting   A ◀ ▶ change   B back" : "▲ ▼ category   A open   B close";
    s.tab.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function open() {
    if (state.open) return;
    state.open = true; state.inCat = false; state.held = 0xFFFF;               // (what is down as it opens is not a press)
    body.classList.remove("showside"); body.classList.add("showopts");
    if (g3d && g3d.showStatus) g3d.showStatus();
    paint(); requestAnimationFrame(loop);
  }
  function closeIt() {
    if (!state.open) return;
    state.open = false; body.classList.remove("showopts");
    const c = $("screen"); if (c && !body.classList.contains("touch")) c.focus();
  }
  // a setting changed from the pad: the next (or previous) value, as a tap would
  function change(r, dir) {
    const c = r.ctl;
    if (c.type === "checkbox" || c.tagName === "BUTTON") { c.click(); return; }
    const n = c.options.length; if (!n) return;
    c.selectedIndex = (c.selectedIndex + dir + n) % n; c.dispatchEvent(new Event("change", { bubbles: true })); c.blur();
  }
  const MASK = { KeyZ: 1, KeyX: 2, Backspace: 2, Enter: 8, ArrowRight: 0x10, ArrowLeft: 0x20, ArrowUp: 0x40, ArrowDown: 0x80, KeyQ: 4, ShiftLeft: 4 };
  function input(edge) {
    const s = sections[state.cat], rows = s.rows.filter(r => !r.row.hidden), n = sections.length;
    if (edge & 8 || (edge & 2 && !state.inCat)) { closeIt(); return; }      // START, or B on the categories: back to the game
    if (edge & 2) { state.inCat = false; paint(); return; }                   // B in a category: back to the categories
    if (!state.inCat) {
      if (edge & 0xC0) { show((state.cat + (edge & 0x80 ? 1 : -1) + n) % n); paint(); }
      else if (edge & 0x30) { show((state.cat + (edge & 0x10 ? 1 : -1) + n) % n); paint(); }
      else if (edge & 1 && rows.length) { state.inCat = true; state.row = 0; paint(); }
      return;
    }
    if (edge & 0xC0 && rows.length) { state.row = (state.row + (edge & 0x80 ? 1 : -1) + rows.length) % rows.length; paint(); return; }
    const r = rows[state.row]; if (!r) return;
    if (edge & 0x11) { change(r, 1); paint(); } else if (edge & 0x20) { change(r, -1); paint(); }
  }
  function loop() {
    if (!state.open) return;
    requestAnimationFrame(loop);
    let m = 0; for (const [k, b] of Object.entries(MASK)) if (keys[k]) m |= b;
    if (keys.ShiftRight) m |= 4;
    const edge = m & ~state.held; state.held = m;
    if (edge) input(edge);
  }
  addEventListener("keydown", e => {
    if (e.code === "Escape" && state.open) { e.preventDefault(); closeIt(); return; }
    if (e.code === "KeyO" && !e.repeat && !(e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))) { if (state.open) closeIt(); else open(); }
    if (state.open && e.code === "Backspace") e.preventDefault();
  });
  paint();
  // a button the page makes later (REC: play.js) as a row of a category: its text is its value
  function addButton(cat, { id, name, help: hint = "", button }) {
    const ci = CATEGORIES.findIndex(c => c[0] === cat); if (ci < 0 || !button) return;
    const s = sections[ci], row = el("div", { className: "mo-row" }); row.dataset.id = id; button.classList.add("mo-pill");
    row.append(el("span", { className: "mo-name", textContent: name }), button);
    const r = { id, row, ctl: button, help: hint }; s.rows.push(r);
    row.addEventListener("pointerdown", () => { state.cat = ci; state.row = s.rows.filter(x => !x.row.hidden).indexOf(r); state.inCat = true; paint(); });
    const info = s.box.querySelector(".mo-info"); s.box.insertBefore(row, info);
  }
  const api = { addButton, get isOpen() { return state.open; }, get muted() { return !!(sound && sound.muted()); }, open, close: closeIt, toggle() { if (state.open) closeIt(); else open(); }, sections, state, show(name) { const i = CATEGORIES.findIndex(c => c[0] === name); if (i >= 0) { show(i); state.inCat = false; paint(); } } };
  window.__options = api;
  return api;
}
