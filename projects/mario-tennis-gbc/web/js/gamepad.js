import { STICK } from "./stick.js";
// Controllers: the Gamepad API (standard mapping: 0 A, 1 B, 8 Select, 9 Start, 12-15 d-pad, axes 0/1)
// and the Android wrapper's bridge (window.__padmask set from the Activity's key/joystick events:
// bits 0 A, 1 B, 2 Select, 3 Start, 4 Right, 5 Left, 6 Up, 7 Down). poll(keys) merges the state into the
// page's key map (KeyZ, KeyX, KeyQ, Enter, Arrow*) and marks the body "gamepad" while a controller is used.
const CODES = ["KeyZ", "KeyX", "KeyQ", "Enter", "ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"];
let lastMask = 0, lastActive = 0;
// a controller's stick into stick.js's STICK (while it is off centre; the touch stick's own while that is held)
function stick(x, y) { if (STICK.src === "touch" && STICK.held) return; const on = Math.hypot(x, y) > 0.15; if (on || STICK.src === "pad") { STICK.x = on ? x : 0; STICK.y = on ? y : 0; STICK.src = on ? "pad" : ""; STICK.held = on; STICK.at = performance.now(); if (on) lastActive = performance.now(); } }
export function pollGamepad(keys) {
  let mask = window.__padmask | 0;
  const ps = window.__padstick; if (ps) stick(ps[0], ps[1]);      // (the Android wrapper's stick)
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const g of pads) {
    if (!g) continue;
    const b = i => g.buttons[i] && (g.buttons[i].pressed || g.buttons[i].value > 0.5);
    if (b(0) || b(2)) mask |= 1; if (b(1) || b(3)) mask |= 2; if (b(8)) mask |= 4; if (b(9)) mask |= 8;
    if (b(15)) mask |= 16; if (b(14)) mask |= 32; if (b(12)) mask |= 64; if (b(13)) mask |= 128;
    stick(g.axes[0] || 0, g.axes[1] || 0);                     // the left stick: read by stick.js (STICK FEEL)
  }
  if (mask !== lastMask || mask) { if (mask) lastActive = performance.now(); }
  for (let i = 0; i < 8; i++) { const on = !!(mask & (1 << i)), was = !!(lastMask & (1 << i)); if (on !== was) keys[CODES[i]] = on; }
  lastMask = mask;
  const active = performance.now() - lastActive < 3000 && lastActive > 0;
  document.body.classList.toggle("gamepad", active);
  return mask;
}
