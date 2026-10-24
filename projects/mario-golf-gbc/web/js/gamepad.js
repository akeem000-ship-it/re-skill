
// Controllers: the Gamepad API (standard mapping: 0 A, 1 B, 8 Select, 9 Start, 12-15 d-pad, axes 0/1)
// and the Android wrapper's bridge (window.__padmask set from the Activity's key/joystick events:
// bits 0 A, 1 B, 2 Select, 3 Start, 4 Right, 5 Left, 6 Up, 7 Down). poll(keys) merges the state into the
// page's key map (KeyZ, KeyX, KeyQ, Enter, Arrow*; the left stick works as the d-pad) and marks the body "gamepad" while a controller is used.
const CODES = ["KeyZ", "KeyX", "KeyQ", "Enter", "ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"];
let lastMask = 0, lastActive = 0;

export function pollGamepad(keys) {
  let mask = window.__padmask | 0;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const g of pads) {
    if (!g) continue;
    const b = i => g.buttons[i] && (g.buttons[i].pressed || g.buttons[i].value > 0.5);
    if (b(0) || b(2)) mask |= 1; if (b(1) || b(3)) mask |= 2; if (b(8)) mask |= 4; if (b(9)) mask |= 8;
    if (b(15)) mask |= 16; if (b(14)) mask |= 32; if (b(12)) mask |= 64; if (b(13)) mask |= 128;
    const ax = g.axes[0] || 0, ay = g.axes[1] || 0;            // the left stick as a d-pad
    if (ax > 0.5) mask |= 16; if (ax < -0.5) mask |= 32; if (ay < -0.5) mask |= 64; if (ay > 0.5) mask |= 128;
  }
  if (mask !== lastMask || mask) { if (mask) lastActive = performance.now(); }
  for (let i = 0; i < 8; i++) { const on = !!(mask & (1 << i)), was = !!(lastMask & (1 << i)); if (on !== was) keys[CODES[i]] = on; }
  lastMask = mask;
  const active = performance.now() - lastActive < 3000 && lastActive > 0;
  document.body.classList.toggle("gamepad", active);
  return mask;
}
