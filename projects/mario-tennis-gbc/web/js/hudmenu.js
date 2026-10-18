// The button bar (Back on a phone shows it) in categories: a short row of tabs (VIEW, STADIUM, LOOK, GAME, and REC as a button of its own);
// a tab opens its buttons in a row underneath, tapping it again (or another tab) closes or switches. The buttons themselves are the page's
// own elements (full.js and the attach* modules make them and keep their handlers): they are only moved into their category, also the
// ones added later (the 3D view's buttons appear when it is first turned on), by watching the bar. A button nobody listed goes to GAME.
const CATS = [
  ["VIEW", "3D view, camera, picture", ["view3d", "cam", "aspect", "smoothbtn", "voxstylebtn"]],
  ["STADIUM", "lighting, stadium, crowd, effects, intro", ["lightbtn", "stadiumbtn", "crowdsndbtn", "ballfxbtn", "introbtn"]],
  ["LOOK", "your character, sprites, menus and text", ["lookbtn", "sprbtn", "uibtn", "fontbtn"]],
  ["GAME", "physics, code, run-ahead, controls", ["physbtn", "engbtn", "runaheadbtn", "padmode", "turbo", "reset"]],
];
const STATUS = ["romstatus", "fps", "savestatus"], OWN = new Set(["rec"]);
const CSS = `
#hud .hm-tabs { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
#hud .hm-tab { font-weight: bold; letter-spacing: .04em; }
#hud .hm-tab.open { background: var(--acc, #e24); opacity: .95; }
#hud .hm-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; padding: 6px; border-radius: 10px; background: rgba(20,22,32,.55); }
#hud .hm-row[hidden] { display: none; }
#hud .hm-status { font-size: 11px; opacity: .8; margin-bottom: 4px; }
#hud .hm-status > * { margin-right: 10px; }
`;
export function organizeHud(hud) {
  if (!hud || hud.dataset.hm) return; hud.dataset.hm = "1";
  const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
  const status = document.createElement("div"); status.className = "hm-status";
  const tabs = document.createElement("div"); tabs.className = "hm-tabs";
  const rows = new Map(), home = new Map();
  let open = null;
  const show = name => { open = open === name ? null : name; for (const [n, r] of rows) { r.row.hidden = n !== open; r.tab.classList.toggle("open", n === open); } };
  for (const [name, title, ids] of CATS) {
    const tab = document.createElement("span"); tab.className = "k hm-tab"; tab.textContent = name; tab.title = title;
    tab.addEventListener("pointerdown", e => { e.stopPropagation(); show(name); });
    const row = document.createElement("div"); row.className = "hm-row"; row.hidden = true;
    tabs.appendChild(tab); rows.set(name, { tab, row }); for (const id of ids) home.set(id, name);
  }
  // put one element where it belongs (status line, its category, or the tabs row for REC)
  const place = el => {
    if (!el || el.nodeType !== 1 || el.classList.contains("hm-tabs") || el.classList.contains("hm-row") || el.classList.contains("hm-status")) return;
    if (STATUS.includes(el.id)) { status.appendChild(el); return; }
    if (OWN.has(el.id)) { tabs.appendChild(el); return; }
    rows.get(home.get(el.id) || "GAME").row.appendChild(el);
  };
  const loose = [...hud.childNodes];
  hud.replaceChildren(status, tabs, ...[...rows.values()].map(r => r.row));
  for (const n of loose) place(n);                                  // (the spaces between the old buttons are dropped: the rows have gaps)
  new MutationObserver(list => { for (const m of list) for (const n of m.addedNodes) if (n.parentNode === hud) { if (n.nodeType === 1) place(n); else n.remove(); } })
    .observe(hud, { childList: true });
}
