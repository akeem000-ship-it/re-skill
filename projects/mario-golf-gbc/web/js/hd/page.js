// The play page's HD extras in one place (js/play.js calls attachHD once and then only present() and input()):
//   the picture options (view.js: HD text, HD menus, wide), the touch layouts (portrait.js: upright phones get the game on top and
//   a golf deck below; landscape phones the pad beside the picture), the games-handheld profile (handheld.js) and the analog stick
//   (stick.js). A test can script the buttons per frame with window.__golfInput = game => mask (web/tests/play_hd.mjs).
// Everything here draws or reads; the game's memory is never written.
import { HDView } from "./view.js";
import "./hudtext.js";                               // (the HUD glyph tracker from the start, as the text one)

export function attachHD({ canvas, keys, getRom, getGame }) {
  const link = document.createElement("link"); link.rel = "stylesheet"; link.href = new URL("../../hd.css", import.meta.url).href;
  document.head.appendChild(link);
  const view = new HDView(canvas, getRom);
  const modes = document.getElementById("modes");
  if (modes) view.mountControls(modes);
  const api = {
    view,
    present(w, frames, image) { return view.present(w, frames, image); },
    // the buttons for this frame instead of the page's keys (undefined: the page's own)
    input(game) { return typeof window.__golfInput === "function" && game ? window.__golfInput(game) | 0 : undefined; },
  };
  window.__hd = api;
  return api;
}
