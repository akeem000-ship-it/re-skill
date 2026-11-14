// The touch screen's analog stick (copied from the Mario Tennis project, web/js/stick.js, and cut down for golf): a zone over the
// lower left of the screen; the stick appears where the thumb lands, its centre follows the thumb when pushed past the rim, and its
// direction is read as the d-pad (8 directions; left and right take wider sectors, 60 degrees each, so aiming does not drift into a
// diagonal; a direction holds until the stick is 8 degrees past its edge). Touch: D-pad or Stick in the page's options (mg-pad).
export const STICK = { x: 0, y: 0, held: false };
const DEAD = 0.25, HYST = 8;
// sectors (angle from the right, degrees, up positive): [from, to, d-pad bits]
const SECT = [[-30, 30, 0x10], [30, 68, 0x50], [68, 112, 0x40], [112, 150, 0x60], [150, 210, 0x20], [210, 248, 0xA0], [248, 292, 0x80], [292, 330, 0x90]];
let cur = -1;
const inSect = (a, s, m) => { const [f, t] = SECT[s]; const x = ((a - f + m) % 360 + 360) % 360; return x <= t - f + 2 * m; };
// the d-pad bits the stick presses now (0 when it is let go)
export function stickBits() {
  if (!STICK.held) { cur = -1; return 0; }
  const m = Math.min(1, Math.hypot(STICK.x, STICK.y)); if (m < DEAD) { cur = -1; return 0; }
  const a = ((Math.atan2(-STICK.y, STICK.x) * 180 / Math.PI) + 360 + 30) % 360 - 30;
  if (cur < 0 || !inSect(a, cur, HYST)) { cur = SECT.findIndex((s, i) => inSect(a, i, 0)); if (cur < 0) cur = 0; }
  return SECT[cur][2];
}
export function mountStick(zone) {
  const base = document.createElement("div"), knob = document.createElement("div");
  base.className = "stick-base"; knob.className = "stick-knob"; base.appendChild(knob); zone.appendChild(base);
  let id = null, cx = 0, cy = 0, R = 50, zr = null;
  const set = (x, y, held) => { STICK.x = x; STICK.y = y; STICK.held = held; };
  const home = () => { base.style.left = ""; base.style.top = ""; base.classList.remove("active"); knob.style.transform = "translate(-50%, -50%)"; };
  const move = e => {
    let dx = e.clientX - cx, dy = e.clientY - cy; const m = Math.hypot(dx, dy);
    if (m > R) { cx = e.clientX - dx * R / m; cy = e.clientY - dy * R / m; base.style.left = (cx - zr.left) + "px"; base.style.top = (cy - zr.top) + "px"; dx *= R / m; dy *= R / m; }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    set(dx / R, dy / R, true);
  };
  zone.addEventListener("pointerdown", e => {
    if (id !== null) return; e.preventDefault();
    id = e.pointerId; try { zone.setPointerCapture(id); } catch (err) { /* ignore */ }
    zr = zone.getBoundingClientRect(); R = base.getBoundingClientRect().width / 2 || 50;
    cx = e.clientX; cy = e.clientY; base.style.left = (cx - zr.left) + "px"; base.style.top = (cy - zr.top) + "px"; base.classList.add("active"); move(e);
  });
  zone.addEventListener("pointermove", e => { if (e.pointerId === id) move(e); });
  const up = e => { if (e.pointerId !== id) return; id = null; set(0, 0, false); home(); };
  zone.addEventListener("pointerup", up); zone.addEventListener("pointercancel", up); zone.addEventListener("lostpointercapture", up);
  home();
  return { setEnabled(on) { zone.hidden = !on; if (!on && id !== null) { id = null; set(0, 0, false); home(); } } };
}
