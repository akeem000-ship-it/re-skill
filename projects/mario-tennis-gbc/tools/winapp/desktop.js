// MTenn3D for Windows (tools/winapp, MTenn3D.exe): injected first into every page the launcher serves. The pages are the Android app's
// (the game picker, Mario Tennis, Mario Golf), shown as the app shows them: they are told they run in the app (the wrapper's names in
// the user agent), the keyboard counts as a built-in controller (no touch buttons), Esc does what Back does (the button bar, golf's
// bar), and the app's bridges are the launcher's: a recording or a picture saved to Downloads\MTenn3D, golf's ROM kept for next time.
(() => {
  const ua = navigator.userAgent + " MarioTennisWrapper MarioGolfWrapper MTenn3DDesktop";
  try { Object.defineProperty(Navigator.prototype, "userAgent", { get: () => ua, configurable: true }); } catch (e) { /* (left as it is) */ }
  window.__device = { builtinPad: true, desktop: true };
  const post = (url, body) => { fetch(url, { method: "POST", body }).catch(() => {}); };
  const save = (name, b64) => post("/app/save?name=" + encodeURIComponent(name), b64);
  window.MTennApp = { saveFile: save, saveImage: save, vibrate() {} };
  window.MGolfApp = { saveRom: b64 => post("/app/golfrom", b64), forgetRom: () => post("/app/golfrom/forget", "") };
  // the pages' phone layouts are for touch screens held sideways (pointer: coarse); on a PC: the same, the picture as big as the window
  // allows and in its middle, and no touch buttons (the keyboard and any controller play)
  document.documentElement.classList.add("mtdesktop");
  const st = document.createElement("style");
  st.textContent = `
    html.mtdesktop body.app { background: #101216; }
    html.mtdesktop body.app main { max-width: none; height: 100vh; padding: 8px; box-sizing: border-box; display: grid; grid-template: "screen" 1fr / 1fr; }
    html.mtdesktop body.app header, html.mtdesktop body.app footer { display: none; }
    html.mtdesktop body.app #stage { grid-area: screen; display: flex; align-items: center; justify-content: center; }
    html.mtdesktop body.app #screen { width: auto; height: calc(100vh - 16px); max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); }
    html.mtdesktop body.app #pad, html.mtdesktop body.app #stickzone { display: none !important; }`;
  (document.head || document.documentElement).appendChild(st);
  addEventListener("keydown", e => {
    if (e.key === "Escape" && typeof window.__backPressed === "function") { e.preventDefault(); e.stopPropagation(); window.__backPressed(); }
  }, true);
})();
