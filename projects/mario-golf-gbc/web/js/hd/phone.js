// Phone conveniences (after the Mario Tennis project's web/js/phone.js; the Android app's MGolfApp bridge where there is one):
//   Vibrate   a short buzz when a shot comes to rest, a longer one when a hole is finished (the page's own counts of shots and
//             holes, window.__golf; read only)
//   Picture   saves a picture of the game view (the app: to Downloads/MarioGolf; a browser: a download)
const stored = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const keep = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };

export class Phone {
  constructor() { this.vibrate = stored("mg-vibrate") !== "off"; this.prev = null; }
  buzz(ms) {
    if (!this.vibrate) return;
    const app = window.MGolfApp;
    if (app && app.vibrate) { try { app.vibrate(ms); } catch (e) { /* an older app */ } }
    else if (navigator.vibrate) navigator.vibrate(ms);
  }
  setVibrate(on) { this.vibrate = !!on; keep("mg-vibrate", on ? "on" : "off"); }
  frame(game) {                                      // per drawn frame
    if (!game) return;
    const s = { g: game, shots: game.shots.length, holes: game.holes || 0 }, p = this.prev; this.prev = s;
    if (!p || p.g !== game) return;
    if (s.holes > p.holes) this.buzz(90); else if (s.shots > p.shots) this.buzz(25);
  }
  screenshot(canvas) {
    const url = canvas.toDataURL("image/png"), b64 = url.slice(url.indexOf(",") + 1);
    const d = new Date(), pad = n => String(n).padStart(2, "0");
    const name = `mariogolf-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
    const app = window.MGolfApp;
    if (app && app.saveImage) app.saveImage(name, b64);
    else { const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
    return name;
  }
}
