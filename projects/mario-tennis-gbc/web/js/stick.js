// Virtual analog stick for touch screens: touching anywhere in the lower-left zone drops the stick there and
// the thumb's direction drives the d-pad keys. The game reads an 8-way d-pad, so the stick is quantised into
// eight 45-degree sectors around the centre, with a dead zone; the knob shows the analog position.
// mount(zone, keys) -> { setEnabled(on) }. The same sector rule is exported for physical sticks.
const DEAD = 0.28;                               // fraction of the radius that does nothing
export function dirFromVector(x, y) {            // x right, y down, |v| in 0..1 -> {right,left,up,down}
  const m = Math.hypot(x, y); if (m < DEAD) return { right: false, left: false, up: false, down: false };
  const nx = x / m, ny = y / m, c = 0.3827;      // cos(67.5deg): each direction covers 135 degrees, diagonals 45
  return { right: nx > c, left: nx < -c, up: ny < -c, down: ny > c };
}
export function mountStick(zone, keys) {
  const base = document.createElement("div"), knob = document.createElement("div");
  base.className = "stick-base"; knob.className = "stick-knob"; base.appendChild(knob); zone.appendChild(base);
  let id = null, cx = 0, cy = 0, R = 60, enabled = true;
  const set = d => { keys.ArrowRight = d.right; keys.ArrowLeft = d.left; keys.ArrowUp = d.up; keys.ArrowDown = d.down; };
  const home = () => { base.style.left = ""; base.style.top = ""; base.classList.remove("active"); knob.style.transform = "translate(-50%, -50%)"; };
  const move = e => {
    let dx = e.clientX - cx, dy = e.clientY - cy; const m = Math.hypot(dx, dy);
    if (m > R) { dx *= R / m; dy *= R / m; }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    set(dirFromVector(dx / R, dy / R));
  };
  zone.addEventListener("pointerdown", e => {
    if (!enabled || id !== null) return; e.preventDefault();
    id = e.pointerId; try { zone.setPointerCapture(id); } catch (err) { /* ignore */ }
    const r = zone.getBoundingClientRect(); R = Math.max(40, Math.min(80, Math.min(innerWidth, innerHeight) * 0.11));
    cx = e.clientX; cy = e.clientY; base.style.left = (cx - r.left) + "px"; base.style.top = (cy - r.top) + "px"; base.classList.add("active");
    base.style.width = base.style.height = 2 * R + "px"; move(e);
  });
  zone.addEventListener("pointermove", e => { if (e.pointerId === id) move(e); });
  const up = e => { if (e.pointerId !== id) return; id = null; set({}); home(); };
  zone.addEventListener("pointerup", up); zone.addEventListener("pointercancel", up); zone.addEventListener("lostpointercapture", up);
  home();
  return { setEnabled(on) { enabled = on; zone.hidden = !on; if (!on && id !== null) { id = null; set({}); home(); } } };
}
