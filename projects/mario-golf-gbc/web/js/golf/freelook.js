// The pause menu's Camera Mode: FreeLookCursor 12:6D3D moves a look cursor ($D422 x, $D424 y) over the hole with the
// d-pad, the camera following it (wCameraMode 3), switching between the course and the green view as it enters or
// leaves the green (FreeLookViewSwitch 12:6EB8), until B or Start.
import { rb } from "./rom.js";
import * as g from "./math.js";
import * as L from "./launch.js";
import * as D from "./render/display.js";
import { rd16, wr16 } from "./memory.js";
import { loadShotView } from "./view.js";

const B = 0x12;
function notPorted(what) { throw new Error(`${what} is not ported`); }
const below = (lim, v) => !((lim - v) & 0x8000);   // "limit - v, bit 7 of h clear": v <= limit (signed 16-bit difference)

// 10:5A3C PlaceTargetMarkerClamped: wTargetMarker $D426 / $D428 = the ball + the club's distance along the aim
// (10:5EE2 TargetMarker); in the course view kept within the hole's bounds ($C329-$C32C: + $80 / - $80 in x, + $80
// / - $280 in y), in the green and cup views within the green's 5 x 4 tiles ($20 in from the edges); wMarkerEdge
// $D36B gets bit 1 / 0 / 3 / 2 for the left / right / top / bottom edge
export function placeTargetMarkerClamped(w) {
  const r6 = w.wram[6], w0 = w.wram[0];
  r6[0x36B] = 0;
  const [dx, dy] = g.mulSinCos(L.baseDistance(w), rd16(r6, 0x418));
  const y = (rd16(r6, 0x404) + dy) & 0xFFFF;
  let x = (rd16(r6, 0x401) + dx) & 0xFFFF;
  const green = r6[0x443] === 1 || r6[0x443] === 2;
  const clamp = (v, lo, hi, bLo, bHi) => {
    if (below(lo, v)) { r6[0x36B] |= bLo; return lo; }
    if (!below(hi, v)) { r6[0x36B] |= bHi; return hi; }
    return v;
  };
  const xLo = green ? (r6[0x441] << 8) + 0x20 : (w0[0x329] << 8) + 0x80;
  const xHi = green ? ((((r6[0x441] + 5) & 0xFF) << 8) - 0x20) & 0xFFFF : ((w0[0x32B] << 8) - 0x80) & 0xFFFF;
  x = clamp(x, xLo & 0xFFFF, xHi, 2, 1);
  wr16(r6, 0x426, x);
  const yLo = green ? (r6[0x442] << 8) + 0x20 : (w0[0x32A] << 8) + 0x80;
  const yHi = green ? ((((r6[0x442] + 4) & 0xFF) << 8) - 0x20) & 0xFFFF : ((w0[0x32C] << 8) - 0x280) & 0xFFFF;
  wr16(r6, 0x428, clamp(y, yLo & 0xFFFF, yHi, 8, 4));
}

// 12:6ED5 CursorInGreen: 1 when the cursor is inside the green view's window (from the green's corner + $40, 5 tiles
// across and 4 down, less $40)
function cursorInGreen(w) {
  const r6 = w.wram[6];
  let hl = (rd16(r6, 0x424) - 0x40 - (r6[0x442] << 8)) & 0xFFFF;
  if (hl & 0x8000) return 0;
  if (!(((hl - 0x380) & 0xFFFF) & 0x8000)) return 0;
  hl = (rd16(r6, 0x422) - 0x40 - (r6[0x441] << 8)) & 0xFFFF;
  if (hl & 0x8000) return 0;
  if (!(((hl - 0x480) & 0xFFFF) & 0x8000)) return 0;
  return 1;
}
// 12:6EB8 FreeLookViewSwitch: the cursor in or out of the green unlike wOnGreen $D443: the target marker cleared, the
// view loaded (13:432B), the marker's blink off, the marker placed again (10:5A3C)
function* freeLookViewSwitch(sh) {
  const w = sh.w, r6 = w.wram[6];
  const c = cursorInGreen(w);
  if (r6[0x443] === c) return;
  r6.fill(0, 0x426, 0x42A);
  yield* loadShotView(sh, c);
  r6[0x36C] = 0;
  placeTargetMarkerClamped(w);
}

// 12:6D3D FreeLookCursor: the cursor's icon (OBJ palette $0B from 12:7300, its tiles 12:7040 to VRAM1 $82C0); $D4D4
// cleared; the cursor at the target marker, wCameraMode 3; each frame: the view switch, then the buttons: A does
// nothing (with hDebugMode it would move the ball there), B or Start leave (returning $FF; $D4D4 and wCameraMode get
// the pressed buttons: the pause menu restores the camera mode), a d-pad direction (the angle from 12:6EA8 by the
// held bits) moves the cursor by ([$D486] / 8 + 8), x 4 off the green, along it (00:0B31), kept within the hole's
// bounds; [$D486] counts up to $40 while held, 0 otherwise
export function* freeLookCursor(sh) {
  const w = sh.w, r6 = w.wram[6], w0 = w.wram[0];
  D.inBank(w, B, () => {
    D.loadPalettesImmediate(w, 0x7300, 0x0B, 0x01);
    D.queueVRAMCopy(w, 0x7040, 0xA2C0, 0x04);
  });
  yield* sh.advance();
  D.setWramBank(w, 6);
  r6[0x4D4] = 0;
  r6.copyWithin(0x422, 0x426, 0x42A);
  r6[0x438] = 3;
  for (;;) {
    yield* freeLookViewSwitch(sh);
    yield* sh.advance();
    const p = w.high[0x194];
    if (p & 1) {
      if (w.high[0x19E]) notPorted("the debug ball move (~12:6D8E)");
      r6[0x486] = 0;
      continue;
    }
    if (p & 0x0A) {                              // B or Start
      r6[0x4D4] = p; r6[0x438] = p;
      return 0xFF;
    }
    const held = w.high[0x190] & 0xF0;
    if (!held) { r6[0x486] = 0; continue; }
    const angle = rb(B, 0x6EA8 + (held >> 4));
    let len = ((r6[0x486] >> 3) + 8) & 0xFF;
    if (!r6[0x443]) len = (len * 4) & 0xFFFF;
    const [vx, vy] = g.vectorFromLengthAndAngleRaw(len, angle);
    const clamp = (v, lo, hi) => (below(lo, v) ? lo : below(hi, v) ? v : hi);
    wr16(r6, 0x424, clamp((rd16(r6, 0x424) + vy) & 0xFFFF, ((w0[0x32A] << 8) + 0x80) & 0xFFFF, ((w0[0x32C] << 8) - 0x280) & 0xFFFF));
    wr16(r6, 0x422, clamp((rd16(r6, 0x422) + vx) & 0xFFFF, ((w0[0x329] << 8) + 0x80) & 0xFFFF, ((w0[0x32B] << 8) - 0x80) & 0xFFFF));
    if (w.high[0x19E] >= 2) notPorted("the debug readout (~12:6F16 FreeLookDebugReadout)");
    if (r6[0x486] < 0x40) r6[0x486]++;
  }
}
