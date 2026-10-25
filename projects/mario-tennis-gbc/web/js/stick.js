// Analog sticks on an 8-way game: the touch screen's virtual stick (lower-left zone: touching anywhere drops the stick there) and a
// controller's left stick (gamepad.js; the Android wrapper's stick, window.__padstick) are read here and turned into the d-pad the game
// reads. STICK FEEL (remembered, mt-stickfeel):
//   Tuned    (default) the stick is read for tennis: left and right take wider sectors (60 degrees each) than the diagonals, so running
//            along the baseline does not drift into a diagonal; a direction holds until the stick is 8 degrees past its edge (no
//            flicker between two directions on the boundary); on the touch screen the stick's centre follows the thumb when it is pushed
//            past the rim, so a quick change from left to right needs only a short move back
//   Analog   Tuned, and in a match your player runs the way the stick points (any angle, not only eight) at a speed set by how far
//            it is pushed: with CODE: PORT the stick's angle and tilt go to the match code itself (stickAnalog, chars.js ANALOG; a
//            recording keeps them as events "stick:<angle>,<speed>"). With CODE: ROM, which reads only the d-pad, a light tilt walks
//            instead: below two thirds of the way out the direction is pressed in blocks of 4 frames with 3 to 8 frames off between
//            them (the game reads the pad every other frame and runs on for a moment after a release: shorter pulses do nothing or
//            run at full speed), about 40-55% of the running speed, in short steps (this was STICK FEEL: Walk)
//   Classic  eight equal 45-degree sectors, the stick fixed where the thumb first lands (as before)
// The pressing is decided once per game frame (stickFrame), so a recording replays exactly. With CODE: ROM nothing in the game is changed.
const KEY = "mt-stickfeel";
export const STICK = { x: 0, y: 0, src: "", at: 0 };   // the latest stick vector (x right, y down, 0..1) and where it came from
const FEELS = ["tuned", "analog", "classic"];
export let stickFeel = (() => { try { let f = localStorage.getItem(KEY); if (f === "walk") f = "analog"; return FEELS.includes(f) ? f : "tuned"; } catch (e) { return "tuned"; } })();
export function setStickFeel(f) { stickFeel = FEELS.includes(f) ? f : "tuned"; try { localStorage.setItem(KEY, stickFeel); } catch (e) { /* private mode */ } }
const DEAD = 0.28, DEAD_T = 0.22, HYST = 8, WALK = 0.66, FULL = 0.85, SLOWEST = 0.3;
// the sectors (angle from the right, degrees, up positive): [from, to, right, left, up, down]
const SECT = [[-30, 30, 1, 0, 0, 0], [30, 68, 1, 0, 1, 0], [68, 112, 0, 0, 1, 0], [112, 150, 0, 1, 1, 0], [150, 210, 0, 1, 0, 0], [210, 248, 0, 1, 0, 1], [248, 292, 0, 0, 0, 1], [292, 330, 1, 0, 0, 1]];
let cur = -1;
const inSect = (a, s, m) => { const [f, t] = SECT[s]; let x = ((a - f + m) % 360 + 360) % 360; return x <= t - f + 2 * m; };
// the classic rule (equal sectors, no memory), kept for STICK FEEL: Classic
export function dirFromVector(x, y) {            // x right, y down, |v| in 0..1 -> {right,left,up,down}
  const m = Math.hypot(x, y); if (m < DEAD) return { right: false, left: false, up: false, down: false };
  const nx = x / m, ny = y / m, c = 0.3827;      // cos(67.5deg): each direction covers 135 degrees, diagonals 45
  return { right: nx > c, left: nx < -c, up: ny < -c, down: ny > c };
}
// the stick's direction as the game should see it now ({right, left, up, down, mag}); remembers the sector for the hysteresis
export function stickDir(x = STICK.x, y = STICK.y) {
  if (stickFeel === "classic") { const d = dirFromVector(x, y); d.mag = Math.min(1, Math.hypot(x, y)); return d; }
  const m = Math.min(1, Math.hypot(x, y)); if (m < DEAD_T) { cur = -1; return { right: false, left: false, up: false, down: false, mag: 0 }; }
  const a = ((Math.atan2(-y, x) * 180 / Math.PI) + 360 + 30) % 360 - 30;           // -30..330, as the sectors run
  if (cur < 0 || !inSect(a, cur, HYST)) { cur = SECT.findIndex((s, i) => inSect(a, i, 0)); if (cur < 0) cur = 0; }
  const s = SECT[cur]; return { right: !!s[2], left: !!s[3], up: !!s[4], down: !!s[5], mag: m };
}
const live = () => STICK.src && (STICK.held || performance.now() - STICK.at <= 400);
// once per game frame: the directions the stick presses this frame (inp: the page's input, its d-pad keys included; walk: a match
// on CODE: ROM, the light tilt may walk)
let ph = 0;
export function stickFrame(inp, walk) {
  if (!live()) return inp;
  const d = stickDir(); if (!d.mag) { ph = 0; return inp; }
  let on = true;
  if (stickFeel === "analog" && walk && d.mag < WALK) {                               // walking: 4 frames on, 3 (a firmer tilt) to 8 off
    const k = Math.max(0, Math.min(1, (d.mag - DEAD_T) / (WALK - DEAD_T))), off = Math.round(8 - 5 * k); on = ph < 4; ph = (ph + 1) % (4 + off);
  } else ph = 0;
  return { ...inp, right: inp.right || (on && d.right), left: inp.left || (on && d.left), up: inp.up || (on && d.up), down: inp.down || (on && d.down) };
}
// STICK FEEL: Analog with CODE: PORT, once per game frame: { facing: the angle 0-255 (0 right, $40 down: the game's facing), speed:
// 0.3-1 of the running speed, in steps of 0.05 } while the stick is pushed, else null. analogEvent / parseAnalogEvent: as a recording
// keeps it
export function stickAnalog() {
  if (stickFeel !== "analog" || !live()) return null;
  const x = STICK.x, y = STICK.y, m = Math.min(1, Math.hypot(x, y)); if (m < DEAD_T) return null;
  const k = Math.max(SLOWEST, Math.min(1, (m - DEAD_T) / (FULL - DEAD_T)));
  return { facing: Math.round(Math.atan2(y, x) * 128 / Math.PI) & 0xFF, speed: Math.round(k * 20) / 20 };
}
export const analogEvent = A => (A ? `stick:${A.facing},${Math.round(A.speed * 100)}` : "stick:");
export function parseAnalogEvent(e) {             // undefined: not a stick event
  if (typeof e !== "string" || !e.startsWith("stick:")) return undefined;
  const [f, v] = e.slice(6).split(","); return f === "" ? null : { facing: +f & 0xFF, speed: +v / 100 };
}
export function mountStick(zone, keys) {
  const base = document.createElement("div"), knob = document.createElement("div");
  base.className = "stick-base"; knob.className = "stick-knob"; base.appendChild(knob); zone.appendChild(base);
  let id = null, cx = 0, cy = 0, R = 60, enabled = true, zr = null;
  const set = (x, y, held) => { STICK.x = x; STICK.y = y; STICK.src = held ? "touch" : ""; STICK.held = held; STICK.at = performance.now(); };
  const home = () => { base.style.left = ""; base.style.top = ""; base.style.width = base.style.height = ""; base.classList.remove("active"); knob.style.transform = "translate(-50%, -50%)"; };
  const move = e => {
    let dx = e.clientX - cx, dy = e.clientY - cy; const m = Math.hypot(dx, dy);
    if (m > R) {
      if (stickFeel !== "classic") { cx = e.clientX - dx * R / m; cy = e.clientY - dy * R / m; base.style.left = (cx - zr.left) + "px"; base.style.top = (cy - zr.top) + "px"; }   // the centre follows the thumb
      dx *= R / m; dy *= R / m;
    }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    set(dx / R, dy / R, true);
  };
  zone.addEventListener("pointerdown", e => {
    if (!enabled || id !== null) return; e.preventDefault();
    id = e.pointerId; try { zone.setPointerCapture(id); } catch (err) { /* ignore */ }
    const r = zr = zone.getBoundingClientRect(), rest = base.getBoundingClientRect().width;
    R = document.body.classList.contains("portrait") ? rest / 2 : Math.max(40, Math.min(80, Math.min(innerWidth, innerHeight) * 0.11));   // portrait: the deck's stick keeps its size
    cx = e.clientX; cy = e.clientY; base.style.left = (cx - r.left) + "px"; base.style.top = (cy - r.top) + "px"; base.classList.add("active");
    base.style.width = base.style.height = 2 * R + "px"; move(e);
  });
  zone.addEventListener("pointermove", e => { if (e.pointerId === id) move(e); });
  const up = e => { if (e.pointerId !== id) return; id = null; set(0, 0, false); home(); };
  zone.addEventListener("pointerup", up); zone.addEventListener("pointercancel", up); zone.addEventListener("lostpointercapture", up);
  home();
  return { setEnabled(on) { enabled = on; zone.hidden = !on; if (!on && id !== null) { id = null; set(0, 0, false); home(); } } };
}
// the HUD button "STICK FEEL: Tuned / Analog / Classic" (OPTIONS > Play)
export function addStickFeelButton(hud) {
  if (!hud) return null;
  const b = document.createElement("span"); b.className = "k"; b.id = "stickfeelbtn"; b.title = "how an analog stick (touch or controller) moves your player: Tuned (wider left / right, no flicker between directions, the touch stick follows your thumb), Analog (Tuned, and in a match you run the way the stick points at the speed of its tilt; with CODE: ROM a light tilt walks in short steps) or Classic (eight equal directions, as before)";
  const show = () => { b.textContent = "STICK FEEL: " + stickFeel[0].toUpperCase() + stickFeel.slice(1); b.classList.toggle("on", stickFeel !== "classic"); };
  b.addEventListener("pointerdown", () => { setStickFeel(FEELS[(FEELS.indexOf(stickFeel) + 1) % FEELS.length]); show(); });
  hud.appendChild(document.createTextNode(" ")); hud.appendChild(b); show(); return b;
}
