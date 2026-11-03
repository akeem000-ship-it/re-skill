// The play page's HD extras in one place (js/play.js calls attachHD once and then only present() and input()):
//   the picture options (view.js: HD text, HD menus, wide), the touch layouts (portrait.js: upright phones get the game on top and
//   a golf deck below; landscape phones the pad beside the picture), the games-handheld profile (handheld.js), the analog stick
//   (stick.js) and the phone's buzz and pictures (phone.js). On touch screens the options open from the gear button (and the
//   Android app's Back). A controller's R2 held runs the game fast (as Space), L2 switches the view.
//   A test can script the buttons per frame with window.__golfInput = game => mask (web/tests/play_hd.mjs).
// Everything here draws or reads; the game's memory is never written.
import { handheld } from "./handheld.js";           // (first: a handheld's defaults are in place before the settings are read)
import { HDView, VIEWS } from "./view.js";
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
  let pad = (q.get("pad") || stored("mg-pad") || (touch ? "stick" : "dpad")) === "stick" ? "stick" : "dpad";   // (a touch screen: the stick, as Mario Tennis, unless the d-pad was chosen)
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
  // the game keeps running. OPTIONS there opens the OPTIONS screen (options.js: every setting by category); GAMES (inside the
  // MTenn3D app, which carries this game) goes back to the screen where you pick a game. Back again closes what is open.
  const gear = document.createElement("button"); gear.id = "hdgear"; gear.textContent = "⚙"; gear.title = "menu"; gear.setAttribute("aria-label", "menu");
  body.appendChild(gear);
  const side = document.createElement("div"); side.id = "mgside";
  const sideBtn = (label, title, fn) => { const b = document.createElement("button"); b.textContent = label; b.title = title; b.addEventListener("click", e => { e.stopPropagation(); fn(); }); side.appendChild(b); return b; };
  sideBtn("OPTIONS", "every setting: play, picture, 3D view, controls", () => { body.classList.remove("showside"); if (window.__options) window.__options.open(); else body.classList.add("showopts"); });
  sideBtn("PICTURE", "save a picture of the game view", () => { const n = phone.screenshot(canvas); const m = document.getElementById("message"); if (m) m.textContent = "Picture saved: " + n; body.classList.remove("showside"); });
  if (/MarioTennisWrapper/.test(navigator.userAgent) || q.has("games"))
    sideBtn("GAMES", "back to the screen where you pick a game", () => { location.href = new URL("../../web/picker.html", location.href).href; });
  body.appendChild(side);
  const toggleOpts = () => {
    if (body.classList.contains("showopts")) { if (window.__options) window.__options.close(); else body.classList.remove("showopts"); }
    else body.classList.toggle("showside");
    return true;
  };
  gear.addEventListener("click", toggleOpts);
  window.__backPressed = toggleOpts;
  // the layout: portrait's game and deck heights, the canvas's shape
  // FULL SCREEN (as Mario Tennis on a phone): everywhere but an upright phone (the deck), the picture edge to edge on black and the
  // controls over it, see-through; a big screen (a foldable's inner one) bigger buttons; inside the app (Back opens the bar) no gear
  body.classList.toggle("inapp", /MarioGolfWrapper|MarioTennisWrapper/.test(navigator.userAgent));
  const layout = () => {
    const area = portraitArea();
    const full = touch && !area; body.classList.toggle("full", full); body.classList.toggle("big", full && Math.min(innerWidth, innerHeight) >= 600);
    body.classList.toggle("tall", full && innerHeight / innerWidth > 144 / 160);   // (taller than the picture: it goes to the top, the controls below it)
    deck.resize();
    // the controls clear the game's bottom bar (the swing meter, its last 26 of 144 rows) wherever it runs under them: a picture no wider
    // than the screen's middle leaves the corners free (the 3D view keeps the bar in its middle: g3d/hud3d.js), else they sit above it
    requestAnimationFrame(lift);
  };
  // (in 3D the bar is at most 3.4 screen pixels to the game's, in the bottom's middle: g3d/hud3d.js HUD_PX; checked again each second, as
  // the 3D view comes and goes)
  const lift = () => {
    const v3 = document.getElementById("view3d"), on3 = v3 && v3.style.display === "block", de = document.documentElement;
    const r = !full() ? null : on3 ? { top: 0, width: de.clientWidth, height: de.clientHeight } : $screen() ? $screen().getBoundingClientRect() : null;   // (3D: the whole screen, g3d/layers.js)
    const barW = r ? (on3 ? Math.min(r.width, 160 * 3.4, r.height * 160 / 144) : r.width) : 0, barH = on3 ? barW * 144 / 160 * 26 / 144 : r ? r.height * 26 / 144 : 0;
    const v = r && (r.width - barW) / 2 < 190 ? Math.max(26, Math.round(innerHeight - (r.top + r.height) + barH + 10)) : 26;
    body.style.setProperty("--padlift", v + "px");
  };
  const full = () => body.classList.contains("full");
  setInterval(lift, 1000);
  const $screen = () => document.getElementById("screen");
  addEventListener("resize", layout); view.onChange(layout); layout();
  // a controller's L2 / R2 (gamepad.js): the view, the fast run (as the page's Space key)
  let l2 = false, r2 = false;
  const pads = () => {
    requestAnimationFrame(pads);
    if (!!keys.PadR2 !== r2) { r2 = !!keys.PadR2; dispatchEvent(new KeyboardEvent(r2 ? "keydown" : "keyup", { code: "Space", key: " " })); }
    if (keys.PadL2 && !l2) view.set("view", VIEWS[(VIEWS.indexOf(view.view) + 1) % VIEWS.length]);
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
