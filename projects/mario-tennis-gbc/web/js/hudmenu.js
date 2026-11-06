// The button bar (Back on a phone shows it): only what you reach for while playing. On a phone it is a column down the left-hand
// side (hm-side), on a computer a row at the top.
//   PANEL      the buttons on the bar: 3D, CAMERA, REC, TURBO, OPTIONS (the game's settings menu, from anywhere: full.js), ONLINE (online.js), GAMES
//              (the game picker), WHAT'S NEW, RESET
//   OPTIONS    every other setting lives in the game's own OPTIONS menu only (menuwheel.js OPTION_CATS); its button is kept here,
//              out of sight, so its handler and its "NAME: value" are still what the menu reads and presses
//   STANDARD   settings hardly anyone changes are now simply how the game plays (their usual value, STANDARD below): they are in no
//              menu, unless the player had switched one away from it before: then it stays in OPTIONS for them (decided the first
//              time it is asked, so it does not vanish while they are in the menu), and their choice is kept
//   DEV        test tools (the engine switch, run-ahead, the quick save slots, +9000 EXP, SHOT): only in a browser driven by the tests
//              or with ?dev, under their own DEV tab
// The buttons themselves are the page's own elements (full.js and the attach* modules make them and keep their handlers): they are only
// moved where they belong, also the ones added later (the 3D view's buttons appear when it is first turned on), by watching the bar.
import { handheld } from "./handheld.js";
export const PANEL = ["view3d", "cam", "rec", "turbo", "optionsbtn", "onlinebtn", "gamesbtn", "whatsnewbtn", "reset"];
const DEVS = ["engbtn", "runaheadbtn", "qsave1", "qsave2", "qload1", "qload2", "expbtn", "shotbtn"];
const STATUS = ["romstatus", "fps", "savestatus"];
// the standard: the button's value (after its "NAME:") when it plays the usual way; a list: any of them is standard
const STANDARD = {
  smoothbtn: "on", fieldlifebtn: "on", resbtn: ["auto", "100%"], stadiumqbtn: [handheld && handheld.id === "rpclassic" ? "lite" : "full"],
  treesbtn: "original", uibtn: "hd", menubtn: "ball wheel", "mode-fastText": "hold b",
  crossbtn: "instant", stickfeelbtn: "tuned", plusbtn: "on", learnbtn: "on", vibratebtn: "on", batterybtn: "normal",
  courtbtn: "tour", farendbtn: "walls", vsbtn: "faces", kitbtn: "class", callsbtn: "on", aimbtn: "on", ballfxbtn: "on", crowdsndbtn: "on", matchfxbtn: "on",
};
const valueOf = el => { const t = (el.textContent || "").trim(), i = t.indexOf(":"); return (i > 0 ? t.slice(i + 1) : t).trim().toLowerCase(); };
const kept = new Map();
// is this setting one of the STANDARD ones the player has left as it is (so it is in no menu)? Decided once a session.
export function isStandard(id) {
  if (!(id in STANDARD)) return false;
  if (!kept.has(id)) { const el = document.getElementById(id); if (!el) return true; kept.set(id, [].concat(STANDARD[id]).includes(valueOf(el))); }
  return kept.get(id);
}
const dev = () => { try { return !!navigator.webdriver || new URLSearchParams(location.search).has("dev"); } catch (e) { return false; } };
const CSS = `
#hud .hm-tabs { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
#hud .hm-tab { font-weight: bold; letter-spacing: .04em; }
#hud .hm-tab.open { background: var(--acc, #e24); opacity: .95; }
#hud .hm-row { display: flex; flex-wrap: wrap; gap: 6px; flex-basis: 100%; padding: 6px; border-radius: 10px; background: rgba(20,22,32,.55); }
#hud #optionsbtn { font-weight: bold; }
body.touch #hud.hm-side { top: max(env(safe-area-inset-top, 0px), var(--cut-t, 0px)); bottom: 0; left: max(env(safe-area-inset-left, 0px), var(--cut-l, 0px)); right: auto;
  width: min(230px, 42vw); overflow-y: auto; padding: 10px 8px; background: rgba(12,14,22,.9); border-radius: 0 14px 14px 0; box-sizing: border-box; }
body.touch #hud.hm-side .hm-tabs { flex-direction: column; align-items: stretch; }
body.touch #hud.hm-side .hm-row { flex-direction: column; align-items: stretch; }
body.touch #hud.hm-side .k { opacity: .95; padding: 10px 12px; font-size: 14px; text-align: left; }
body.touch #hud.hm-side .hm-tab { font-size: 14px; }
body.touch #hud.hm-side .hm-status { display: flex; flex-direction: column; gap: 2px; }
#hud .hm-row[hidden], #hud .hm-away { display: none !important; }
#hud .hm-status { font-size: 11px; opacity: .8; margin-bottom: 4px; }
#hud .hm-status > * { margin-right: 10px; }
`;
export function organizeHud(hud) {
  if (!hud || hud.dataset.hm) return; hud.dataset.hm = "1";
  const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
  const status = document.createElement("div"); status.className = "hm-status";
  const tabs = document.createElement("div"); tabs.className = "hm-tabs";
  const away = document.createElement("div"); away.className = "hm-away";              // OPTIONS and STANDARD: out of sight, still working
  let devRow = null;
  if (dev()) {                                                                          // DEV: the test tools and everything off the bar
    const tab = document.createElement("span"); tab.className = "k hm-tab"; tab.textContent = "DEV"; tab.title = "test tools, and every setting the bar no longer carries";
    devRow = document.createElement("div"); devRow.className = "hm-row"; devRow.hidden = true;
    tab.addEventListener("pointerdown", e => { e.stopPropagation(); devRow.hidden = !devRow.hidden; tab.classList.toggle("open", !devRow.hidden); });
    tabs.appendChild(tab);
  }
  const order = el => PANEL.indexOf(el.id);
  const place = el => {
    if (!el || el.nodeType !== 1 || el === tabs || el === status || el === away || el === devRow) return;
    if (STATUS.includes(el.id)) { status.appendChild(el); return; }
    if (order(el) >= 0) {                                                               // the bar, in PANEL's order
      const next = [...tabs.children].find(c => order(c) > order(el)); tabs.insertBefore(el, next || null); return;
    }
    (devRow || away).appendChild(el);                                                   // (DEVS: only ever under DEV)
    if (!devRow && DEVS.includes(el.id)) el.hidden = true;
  };
  if (document.body.classList.contains("touch")) hud.classList.add("hm-side");
  const loose = [...hud.childNodes];
  hud.replaceChildren(status, tabs, away);
  if (devRow) tabs.after(devRow);
  for (const n of loose) place(n);                                                     // (the spaces between the old buttons are dropped: the rows have gaps)
  new MutationObserver(list => { for (const m of list) for (const n of m.addedNodes) if (n.parentNode === hud) { if (n.nodeType === 1) place(n); else n.remove(); } })
    .observe(hud, { childList: true });
}
