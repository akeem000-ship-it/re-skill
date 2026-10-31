// The course camera (bank 11, run by the ball display task 11:4113 in the course and green views) and the
// view redraw's state (13:411D): goal $D42E/$D430, position $D432/$D434, $D436/$D437 the goal's high bytes,
// the map scroll $C320/$C322 (course view), mode wCameraMode $D438 (0 scroll, 1 ball, 2 target marker,
// 3 look cursor $D422, 4 cup; bit 4: snap). Its position decides how many frames the hole's fly-over and the
// look at the pin take.
import * as g from "./math.js";
import { rd16, wr16 } from "./memory.js";
import { drawHoleViewTiles, holeAsset } from "./render/holeview.js";
import { disableLCDSafely, enableLCD, setWramBank, farDispatchIndexed } from "./render/display.js";

export function computeGoal(w) {                 // 11:413C CameraComputeGoal: [bc = x, de = y]
  const r6 = w.wram[6], w0 = w.wram[0];
  const mode = r6[0x438] & 0x0F;
  let bc, de;
  if (mode === 0) {                              // the scroll as it is
    bc = rd16(w0, 0x320); de = rd16(w0, 0x322);
  } else {
    const src = { 1: [0x401, 0x404], 2: [0x426, 0x428], 3: [0x422, 0x424], 4: [0x43D, 0x43F] }[mode];
    if (!src) throw new Error(`camera mode ${mode} (11:413C) has no goal`);
    bc = rd16(r6, src[0]); de = rd16(r6, src[1]);
    r6[0x437] = de >> 8; r6[0x436] = bc >> 8;
    let hl = (bc + 0xF600) & 0xFFFF;             // clamped so the view stays on the map ($C329-$C32C)
    if (((hl >> 8) - w0[0x329]) & 0x80) hl = w0[0x329] << 8;
    else {
      const d = (w0[0x32B] - 0x14) & 0xFF;
      if (!(((hl >> 8) - d) & 0x80)) hl = d << 8;
    }
    bc = hl;
    hl = (de + 0xF700) & 0xFFFF;
    if (((hl >> 8) - w0[0x32A]) & 0x80) hl = w0[0x32A] << 8;
    else {
      const d = (w0[0x32C] - 0x12) & 0xFF;
      if (!(((hl >> 8) - d) & 0x80)) hl = d << 8;
    }
    de = hl;
  }
  wr16(r6, 0x42E, bc); wr16(r6, 0x430, de);
  return [bc, de];
}

export function atGoal(w) {                      // 11:41F7 CameraAtGoal (always on the green views)
  const r6 = w.wram[6];
  if (r6[0x443]) return true;
  for (let k = 0; k < 4; k++) if (r6[0x42E + k] !== r6[0x432 + k]) return false;
  return true;
}

function snapPos(w) { w.wram[6].copyWithin(0x432, 0x42E, 0x432); }

export function step(w) {                        // 11:422F CameraStep: toward the goal by $10-$80 per frame
  const r6 = w.wram[6], w0 = w.wram[0];
  const [bc, de] = computeGoal(w);
  if (rd16(r6, 0x432) === bc && rd16(r6, 0x434) === de) return;
  if (r6[0x438] & 0x10) snapPos(w);
  else {
    const dx = (rd16(r6, 0x432) - bc) & 0xFFFF, dy = (rd16(r6, 0x434) - de) & 0xFFFF;
    const dir = ((g.angleFromVector16(dy, dx) >> 8) + 0x80) & 0xFF;
    const habs = v => ((v >> 8) & 0x80 ? (-(v >> 8)) & 0xFF : v >> 8);   // |high byte| (cpl / inc)
    const sq = (habs(dy) * habs(dy) + habs(dx) * habs(dx)) & 0xFFFF;
    const len = sq >> 8 ? 0x80 : sq < 1 ? 0x10 : sq < 4 ? 0x18 : sq < 9 ? 0x20 : sq < 0x10 ? 0x40 : 0x80;
    const [vx, vy] = g.vectorFromLengthAndAngleRaw(len, dir);
    wr16(r6, 0x434, rd16(r6, 0x434) + vy);
    wr16(r6, 0x432, rd16(r6, 0x432) + vx);
    let b = 0;
    const c = ((dir + 0x20) & 0x40) ? 2 : 1;     // the main axis of the move
    const ny = (rd16(r6, 0x434) - rd16(r6, 0x430)) & 0xFFFF;
    if (!ny || ((ny ^ dy) & 0x8000)) b |= 2;      // reached or passed the goal's y
    const nx = (rd16(r6, 0x432) - rd16(r6, 0x42E)) & 0xFFFF;
    if (!nx || ((nx ^ dx) & 0x8000)) b |= 1;
    if (b & c) snapPos(w);
  }
  if (r6[0x443]) return;
  w0.set(r6.subarray(0x432, 0x436), 0x320);      // the course view scrolls with it
}

// 13:411D DrawHoleViewAtCamera (the state it leaves; it draws the BG map): in the course view the scroll is
// the goal, in the green views it stays (LoadShotView zeroed it); the camera is put at the scroll
export function drawHoleViewAtCamera(w, view) {
  const r6 = w.wram[6], w0 = w.wram[0];
  if (!view) {
    w0[0x320] = r6[0x42E]; w0[0x321] = r6[0x42F]; w0[0x324] = r6[0x42F];
    w0[0x322] = r6[0x430]; w0[0x323] = r6[0x431]; w0[0x325] = r6[0x431];
  }
  r6.set(w0.subarray(0x320, 0x324), 0x432);
  if (w.vram) drawHoleViewTiles(w);              // the BG map, SCX / SCY
}

// 13:4276 SnapCameraToGoal (course view): a new goal tile redraws the view there (one frame)
export function* snapToGoal(sh) {
  const w = sh.w, r6 = w.wram[6], w0 = w.wram[0];
  if (r6[0x443]) return;
  w.high[0x1B0] = 0;                             // hFFB0
  computeGoal(w);
  if (w0[0x321] === r6[0x42F] && w0[0x323] === r6[0x431]) return;
  if (w.vram) disableLCDSafely(w);
  drawHoleViewAtCamera(w, 0);
  if (w.vram) enableLCD(w);
  r6[0x36C] = 0;                                 // wMarkerBlink
  yield* sh.advance();
}

// 13:42A8 ReloadHoleViewMaps (export $10; nothing calls it): hFFB0 = wOnGreen; WRAM6, LCD off; the course view's maps
// (the hole's asset ref 1 entries 0 / 1 into WRAM2 / WRAM3 $D000, ref 0 entry 4 into WRAM1 $D800) or, on a green view,
// ref 3 entries 1 / 2 (WRAM2 / WRAM3); WRAM6, DrawHoleViewAtCamera (13:411D, by hFFB0), LCD on, wMarkerBlink 0, a frame
export function* reloadHoleViewMaps(sh) {
  const w = sh.w, r6 = w.wram[6];
  w.high[0x1B0] = r6[0x443];
  setWramBank(w, 6);
  if (w.vram) disableLCDSafely(w);
  const put = (bank, ref, entry, de) => { setWramBank(w, bank); farDispatchIndexed(w, holeAsset(w, ref), entry, de); };
  if (!w.high[0x1B0]) { put(2, 1, 0, 0xD000); put(3, 1, 1, 0xD000); put(1, 0, 4, 0xD800); }
  else { put(2, 3, 1, 0xD000); put(3, 3, 2, 0xD000); }
  setWramBank(w, 6);
  drawHoleViewAtCamera(w, w.high[0x1B0]);
  if (w.vram) enableLCD(w);
  r6[0x36C] = 0;
  yield* sh.advance();
}
