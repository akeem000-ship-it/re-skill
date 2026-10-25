// The display side of the round as the engine calls it. The frame-task registrations always happen (their order
// in the task table decides the order every task runs in, the engine's own included); the drawing happens only when
// the engine's memory has a display model (render/display.js initDisplay: w.vram), so the engine also runs headless.
import { registerFrameTask, unregisterFrameTask } from "../tasks.js";
import * as Dp from "./display.js";
import * as M from "./misc.js";
import * as H from "./hud.js";
import * as A from "./actors.js";
import * as V from "./holeview.js";
import * as O from "./objects.js";
import * as Bh from "./behind.js";
import * as G from "./golfer.js";

const on = w => !!w.vram;
function notPorted(what) { throw new Error(`${what} is not ported`); }

export function resetSprites(w) { if (on(w)) Dp.resetSprites(w); else { w.high[0x19B] = w.high[0x19C] = 0; } }   // 00:2683

export function hudInit(sh) {                    // 12:442C HudInit
  const w = sh.w;
  if (on(w)) H.hudInit(w);
  registerFrameTask(w, 0x0F, 0x12, 0x449F);      // 12:449F HudTask
}

export function mapScrollTaskStart(w) { registerFrameTask(w, 0x07, 0x04, 0x4072); }   // 04:4062 MapScrollTaskStart
export function mapScrollTaskStop(w) { unregisterFrameTask(w, 0x04, 0x4072); }        // 04:406B MapScrollTaskStop

export function golferActorShow(sh) {            // 04:57BA GolferActorShow (actor 0: the golfer's map sprite)
  const w = sh.w;
  if (on(w)) Dp.inBank(w, 0x04, () => A.golferActorShow(w));
  registerFrameTask(w, 0x01, 0x04, 0x573F);      // 04:573F GolferActorTask
}
export function golferActorTaskStop(w) { unregisterFrameTask(w, 0x04, 0x573F); }    // 04:5801 GolferActorTaskStop

export function shotLengthTaskStart(w) { registerFrameTask(w, 0x10, 0x12, 0x4F07); } // 12:4F14 ShotLengthTaskStart
export function shotLengthTaskStop(w) { unregisterFrameTask(w, 0x12, 0x4F07); }      // 12:4F1D ShotLengthTaskStop

export function golfAnimDraw(sh, loaded) {       // the drawing part of 11:6E3E GolfAnimTask
  if (on(sh.w)) Dp.inBank(sh.w, 0x11, () => G.golfAnimDraw(sh.w, loaded));
}

// frame tasks that only draw: no-ops headless
export function displayTasks(sh) {
  const w = sh.w;
  const draw = (name, fn) => () => { if (on(w)) (fn || (() => notPorted(name)))(); };
  return {
    "0f:4160": draw("", () => M.courseTitleWaveTask(w)),
    "12:449f": draw("", () => H.hudTask(w)),
    "04:4072": draw("", () => V.mapScrollTask(w)),
    "04:573f": draw("", () => A.golferActorTask(w, id => sh.sound(id))),
    "50:71b3": draw("", () => V.holeTileAnimTask(w)),
    "15:47ad": draw("", () => Bh.drawFlagSprite(w)),
    "15:47b8": () => { w.wram[0][0x3B6] = (w.wram[0][0x3B6] + 1) & 0xFF; },   // 15:47B8 CountLoadFramesTask_15
    "12:4f07": draw("", () => H.shotLengthTask(w)),
  };
}

// ---- the hole's views (render/holeview.js) ----
export function holeLoadTilesAndMaps(w) {        // 13:43E3: HoleLoadTiles 13:40CA, HoleLoadMaps 13:4014
  if (!on(w)) return;
  V.holeLoadTiles(w);
  V.holeLoadMaps(w);
}
export function loadViewGraphics(w, view) { if (on(w)) V.loadViewGraphics(w, view); }
export function loadViewAfterDraw(w, view) { if (on(w)) V.loadViewAfterDraw(w, view); }

// ---- the ball display's sprites (render/objects.js) and the marker icons (render/hud.js) ----
export function lookCursor(w) { if (on(w)) O.lookCursor(w); }
export function drawBallObject(w, id) { if (on(w)) O.drawBallObject(w, id); }
export function cupView(w) { if (on(w)) O.cupView(w); }
export function view4Ball(w, p) { if (on(w)) O.view4Ball(w, p); }
export function previewMarkerView4(w) { if (on(w)) O.previewMarkerView4(w); }
export function markerIconNormal(w) { if (on(w)) H.markerIconNormal(w); }
export function markerIconFrame(w, a) { if (on(w)) H.markerIconFrame(w, a); }

// a HUD part by name (render/hud.js), in bank 12
export function hud(w, name, ...args) { if (on(w)) Dp.inBank(w, 0x12, () => H[name](w, ...args)); }
export function cupViewLeave(w) { if (on(w)) notPorted("13:4528 CupViewLeave"); }

// ---- the view behind the golfer (render/behind.js) ----
export function behind(w, part) {
  if (!on(w)) return;
  Dp.inBank(w, 0x15, () => [null, Bh.buildPart1, Bh.buildPart2, Bh.buildPart3][part](w));
}
export function holeLoadCourseMaps(w) { if (on(w)) { const k = w.high[0x1B0]; w.high[0x1B0] = 0; V.holeLoadMaps(w); w.high[0x1B0] = k; } }
export function enableLCD(w) { if (on(w)) Dp.enableLCD(w); }
export function golfAnimInit(w) {                // 11:6D69: the golfer's sprite tiles (11:6E1E LoadGolferSpriteTiles)
  if (!on(w)) return;
  Dp.setWramBank(w, 6);
  Dp.inBank(w, 0x11, () => G.loadGolferSpriteTiles(w, w.wram[6][0x332], 0, 0xA000));
}
export function behindViewTaskStop(w) { unregisterFrameTask(w, 0x15, 0x47AD); }      // 15:47B1 BehindViewTaskStop
export function golferActorSetAnim(w, a) { if (on(w)) A.golferActorSetAnim(w, a); }   // 04:57A1
export function golferActorAnim3(w) { if (on(w)) A.golferActorAnim3(w); }             // 04:5808
