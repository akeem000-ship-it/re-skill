// The shot views (wOnGreen $D443: 0 course, 1 green, 2 cup close-up, 4 behind the golfer; $FF none yet) and the
// frames it takes to change them. The maps a view uses come from Hole (ball.js); its graphics are display.
import * as Cam from "./camera.js";
import * as Scr from "./screen.js";
import * as S from "./swing.js";
import * as g from "./math.js";
import { ball, rd16, wr16 } from "./memory.js";
import * as D from "./render/hooks.js";
import { registerFrameTask, unregisterFrameTask } from "./tasks.js";
import { startCourseAnimTask, stopCourseAnimTasks } from "./render/holeview.js";

function notPorted(what) { throw new Error(`${what} is not ported`); }

export const ballInGreenArea = s => (((s[0x05] - s[0x42]) & 0xFF) < 4 && ((s[0x02] - s[0x41]) & 0xFF) < 5 ? 1 : 0);   // 10:5617

// 13:432B LoadShotView: the state it sets, with its frames
export function loadShotView(sh, view) {
  const w = sh.w, r6 = w.wram[6], w0 = w.wram[0];
  w.high[0x1B0] = view;                          // hFFB0
  Cam.computeGoal(w);                            // 11:413C
  r6[0x444] = 0;
  w0[0xA80] = w0[0xA81] = 0;
  sh.t.animOn = false;                           // 11:6D88 GolfAnimStop
  if (view === 4) {                              // the view behind the golfer
    if (r6[0x443]) D.holeLoadCourseMaps(w);      // 13:434A: the course view's maps back
    r6[0x328] = 1;
    D.mapScrollTaskStop(w);                      // 04:406B
    buildBehindView(sh);                         // 15:46AB
    D.golfAnimInit(w);                           // 11:6D69 GolfAnimInit: the golfer's tiles,
    S.animStart(w, 0);                           // the address pose
    sh.t.animOn = true;                          // and its frame task
    r6[0x443] = 4;
    D.enableLCD(w);
    r6[0x480] = 0;
    hudDrawWind(w);                              // 12:4A81
    Scr.beginFadeIn(w, 0x10);
    Scr.waitFade(sh);
    r6[0x328] = 0;
    return;
  }
  if (view) w0.fill(0, 0x320, 0x324);
  D.holeLoadTilesAndMaps(w);                     // 13:40CA HoleLoadTiles, 13:4014 HoleLoadMaps
  r6[0x443] = view;
  if (w0[0x870]) notPorted("golf event hooks (~10:4CC3)");
  D.loadViewGraphics(w, view);                   // 13:43F9-13:442E: tiles, palettes
  Cam.drawHoleViewAtCamera(w, view);             // 13:411D
  if (r6[0x443]) stopCourseAnimTasks(w);         // 13:70A2
  r6[0x36C] = r6[0x36B] = 0;
  D.loadViewAfterDraw(w, view);                  // 13:4442 EnableLCD, the slope map
  sh.advance();                                  // 13:4462
  if (!r6[0x443]) startCourseAnimTask(w);        // 13:7076
}

function buildBehindView(sh) {                   // 15:46AB BuildBehindView: two frames
  const w = sh.w, w0 = w.wram[0];
  w0[0x4BF] = 0x50;                              // wMapLoadPhase
  sh.advance();                                  // (and the BG blits done)
  w0[0x3B6] = 0;                                 // wLoadFrameCount
  registerFrameTask(w, 0x81, 0x15, 0x47B8);      // 15:47B8 CountLoadFramesTask_15 (in VBlank)
  Scr.beginWhiteFadeOut(w, 6);
  stopCourseAnimTasks(w);                        // 13:70A2
  w.high[0x18F] = 0;                             // frame tasks off while it draws
  D.behind(w, 1);                                // 15:46E0-15:46FD: the projection and the ground (render/behind.js)
  sh.advance();
  D.behind(w, 2);                                // 15:4701-15:4777: the scenery, VRAM
  registerFrameTask(w, 0x01, 0x15, 0x47AD);      // 15:47AD BehindViewTask (and $FF8F on)
  unregisterFrameTask(w, 0x15, 0x47B8);
  D.behind(w, 3);                                // 15:4787: the slope map back in WRAM1
  w0[0x4BF] = 0x51;
}

export function hudDrawWind(w) {                 // 12:4A81 HudDrawWind: the wind's tiles; the wind animation reset
  const r6 = w.wram[6];
  D.hud(w, "hudDrawWind");
  r6[0x326] = r6[0x327] = r6[0x328] = 0;
}

export function viewLeave(sh) {                  // 3B:431F ShotViewLeave: one frame
  const w = sh.w;
  w.wram[6][0x337] = 0;                          // wCaptionActive
  unregisterFrameTask(w, 0x3B, 0x4433);          // 3B:4433 CaptionMotionTask
  sh.advance();
  w.wram[6][0x455] = 0;                          // 12:4B24 HudPanelsShow
  w.wram[6][0x454] = 1;                          // 12:4B19 HudFlags
}

export function aimMarker(w) {                   // 10:6145 AimMarker: the aim arrow's end ($D481-$D484), across the aim
  const r6 = w.wram[6];
  const b = ((r6[0x419] + (r6[0x333] & 1 ? 0x40 : 0xC0)) & 0xFF);   // the golfer sprite's facing (actor 0 +$10)
  w.wram[4][0x010] = r6[0x333] ? (-b) & 0xFF : (0x80 + b) & 0xFF;
  const turn = r6[0x333] & 1 ? 0x4000 : 0xC000;
  const hl = r6[0x443] ? 0x20 : 0x80;
  const [c, s] = g.mulSinCos(hl, (rd16(r6, 0x418) + turn) & 0xFFFF);
  wr16(r6, 0x481, (rd16(r6, 0x401) + c) & 0xFFFF);
  wr16(r6, 0x483, (rd16(r6, 0x404) + s) & 0xFFFF);
}

export function shotViewUpdate(sh) {             // 10:5632 ShotViewUpdate: the view for the ball; the aim arrow
  const c = ballInGreenArea(ball(sh.w));
  if (sh.w.wram[6][0x443] !== c) loadShotView(sh, c);
  aimMarker(sh.w);
}
