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

export function golfAnimDraw(sh) {               // the drawing part of 11:6E3E GolfAnimTask
  if (on(sh.w)) notPorted("11:6E3E GolfAnimTask's sprites");
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
    "15:47ad": draw("15:47AD BehindViewTask"),
    "15:47b8": draw("15:47B8 CountLoadFramesTask_15"),
    "12:4f07": draw("12:4F07 ShotLengthTask"),
    "3b:4433": draw("3B:4433"),
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
export function previewMarkerView4(w) { if (on(w)) notPorted("11:48AB PreviewMarkerView4"); }
export function markerIconNormal(w) { if (on(w)) H.markerIconNormal(w); }
export function markerIconFrame(w, a) { if (on(w)) H.markerIconFrame(w, a); }

// a HUD part by name (render/hud.js), in bank 12
export function hud(w, name, ...args) { if (on(w)) Dp.inBank(w, 0x12, () => H[name](w, ...args)); }
export function cupViewLeave(w) { if (on(w)) notPorted("13:4528 CupViewLeave"); }
