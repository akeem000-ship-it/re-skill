// The play page's HD extras in one place (js/play.js calls attachHD once and then only present() and input()):
//   the picture options (view.js: HD text, HD menus, wide), the touch layouts (portrait.js: upright phones get the game on top and
//   a golf deck below; landscape phones the pad beside the picture), the games-handheld profile (handheld.js), the analog stick
//   (stick.js) and the phone's buzz and pictures (phone.js). On touch screens the options open from the gear button (and the
//   Android app's Back). A controller's R2 held runs the game fast (as Space), L2 switches the view.
//   A test can script the buttons per frame with window.__golfInput = game => mask (web/tests/play_hd.mjs).
// Everything here draws or reads; the game's memory is never written.
import { handheld } from "./handheld.js";           // (first: a handheld's defaults are in place before the settings are read)
import { HDView } from "./view.js";
import "./hudtext.js";                               // (the HUD glyph tracker from the start, as the text one)
import { portraitArea, attachDeck } from "./portrait.js";
import { mountStick, stickBits } from "./stick.js";
import { Phone } from "./phone.js";

const stored = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const keep = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };

export function attachHD({ canvas, keys, getRom, getGame }) {
  const link = document.createElement("link"); link.rel = "stylesheet"; link.href = new URL("../../hd.css", import.meta.url).href;
  document.head.appendChild(link);
  const q = new URLSearchParams(location.search), body = document.body;
  const touch = /MarioGolfWrapper|MarioTennisWrapper/.test(navigator.userAgent) || q.has("touch") || (typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches);
  body.classList.toggle("touch", touch);
  if (handheld) body.classList.add("handheld");
  const view = new HDView(canvas, getRom);
  const modes = document.getElementById("modes");
  const opts = modes ? view.mountControls(modes) : null;
  const phone = new Phone(), deck = attachDeck();
  // touch: D-pad or the analog stick (remembered), the vibration, a picture
  const zone = document.createElement("div"); zone.id = "stickzone"; body.appendChild(zone);
  const stick = mountStick(zone);
  let pad = (q.get("pad") || stored("mg-pad")) === "stick" ? "stick" : "dpad";
  const applyPad = () => { const on = touch && pad === "stick"; body.classList.toggle("stick", on); stick.setEnabled(on); };
  if (opts && touch) {
    const l = document.createElement("label"); l.textContent = "Touch ";
    const s = document.createElement("select"); s.id = "hdpad";
    for (const [v, t] of [["dpad", "D-pad"], ["stick", "Stick"]]) { const o = document.createElement("option"); o.value = v; o.textContent = t; s.appendChild(o); }
    s.value = pad; s.addEventListener("change", () => { pad = s.value; keep("mg-pad", pad); applyPad(); s.blur(); });
    l.appendChild(s); opts.appendChild(l);
    const vib = document.createElement("label"), cb = document.createElement("input"); cb.type = "checkbox"; cb.id = "hdvibrate"; cb.checked = phone.vibrate;
    cb.addEventListener("change", () => { phone.setVibrate(cb.checked); if (cb.checked) phone.buzz(40); }); vib.append(cb, " Vibrate"); opts.appendChild(vib);
  }
  if (opts) {
    const b = document.createElement("button"); b.id = "hdshot"; b.textContent = "Picture"; b.title = "save a picture of the game view";
    b.addEventListener("click", () => { const n = phone.screenshot(canvas); const m = document.getElementById("message"); if (m) m.textContent = "Picture saved: " + n; });
    opts.appendChild(b);
  }
  applyPad();
  // the button bar on touch screens, as Mario Tennis's: Back (the app's, or the gear) shows a column of buttons down the left-hand side,
  // the game keeps running. OPTIONS there opens the settings (the start mode, the picture, the 3D layers); GAMES (inside the
  // MTenn3D app, which carries this game) goes back to the screen where you pick a game. Back again closes what is open.
  const gear = document.createElement("button"); gear.id = "hdgear"; gear.textContent = "⚙"; gear.title = "menu"; gear.setAttribute("aria-label", "menu");
  body.appendChild(gear);
  const side = document.createElement("div"); side.id = "mgside";
  const sideBtn = (label, title, fn) => { const b = document.createElement("button"); b.textContent = label; b.title = title; b.addEventListener("click", e => { e.stopPropagation(); fn(); }); side.appendChild(b); return b; };
  sideBtn("OPTIONS", "the start mode, the picture, the 3D view", () => { body.classList.remove("showside"); body.classList.add("showopts"); });
  sideBtn("PICTURE", "save a picture of the game view", () => { const n = phone.screenshot(canvas); const m = document.getElementById("message"); if (m) m.textContent = "Picture saved: " + n; body.classList.remove("showside"); });
  if (/MarioTennisWrapper/.test(navigator.userAgent) || q.has("games"))
    sideBtn("GAMES", "back to the screen where you pick a game", () => { location.href = new URL("../../web/picker.html", location.href).href; });
  body.appendChild(side);
  const toggleOpts = () => {
    if (body.classList.contains("showopts")) body.classList.remove("showopts");
    else body.classList.toggle("showside");
    return true;
  };
  gear.addEventListener("click", toggleOpts);
  window.__backPressed = toggleOpts;
  // the layout: portrait's game and deck heights, the canvas's shape
  const layout = () => { portraitArea(); deck.resize(); };
  addEventListener("resize", layout); view.onChange(layout); layout();
  // a controller's L2 / R2 (gamepad.js): the view, the fast run (as the page's Space key)
  let l2 = false, r2 = false;
  const pads = () => {
    requestAnimationFrame(pads);
    if (!!keys.PadR2 !== r2) { r2 = !!keys.PadR2; dispatchEvent(new KeyboardEvent(r2 ? "keydown" : "keyup", { code: "Space", key: " " })); }
    if (keys.PadL2 && !l2) view.set("view", view.view === "wide" ? "normal" : "wide");
    l2 = !!keys.PadL2;
  };
  requestAnimationFrame(pads);
  const api = {
    view, phone, deck,
    present(w, frames, image) {
      const r = view.present(w, frames, image);
      const game = getGame(); deck.frame(game); phone.frame(game);
      return r;
    },
    // the buttons for this frame instead of the page's keys (undefined: the page's own): a test's script, or the touch stick's
    // directions added to them
    input(game, b) {
      if (typeof window.__golfInput === "function" && game) return window.__golfInput(game) | 0;
      const s = stickBits(); return s ? (b | s) : undefined;
    },
  };
  window.__hd = api;
  return api;
}
