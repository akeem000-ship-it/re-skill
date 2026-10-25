// The shot views (wOnGreen $D443: 0 course, 1 green, 2 cup close-up, 4 behind the golfer; $FF none yet) and the
// frames it takes to change them. The maps a view uses come from Hole (ball.js); its graphics are display.
import * as Cam from "./camera.js";
import * as Scr from "./screen.js";
import * as S from "./swing.js";
import * as g from "./math.js";
import { ball, rd16, wr16 } from "./memory.js";

function notPorted(what) { throw new Error(`${what} is not ported`); }

export const ballInGreenArea = s => (((s[0x05] - s[0x42]) & 0xFF) < 4 && ((s[0x02] - s[0x41]) & 0xFF) < 5 ? 1 : 0);   // 10:5617

// 13:432B LoadShotView: the state it sets, with its frames
export function loadShotView(sh, view) {
  const w = sh.w, r6 = w.wram[6], w0 = w.wram[0];
  Cam.computeGoal(w);                            // 11:413C
  r6[0x444] = 0;
  w0[0xA80] = w0[0xA81] = 0;
  sh.t.animOn = false;                           // 11:6D88 GolfAnimStop
  if (view === 4) {                              // the view behind the golfer
    r6[0x328] = 1;
    buildBehindView(sh);                         // 15:46AB
    S.animStart(w, 0);                           // 11:6D69 GolfAnimInit (and its frame task)
    sh.t.animOn = true;
    r6[0x443] = 4;
    r6[0x480] = 0;
    hudDrawWind(w);                              // 12:4A81
    Scr.beginFadeIn(w, 0x10);
    Scr.waitFade(sh);
    r6[0x328] = 0;
    return;
  }
  if (view) w0.fill(0, 0x320, 0x324);
  r6[0x443] = view;
  if (w0[0x870]) notPorted("golf event hooks (~10:4CC3)");
  Cam.drawHoleViewAtCamera(w, view);             // 13:411D
  r6[0x36C] = r6[0x36B] = 0;
  sh.advance();                                  // 13:4462
}

function buildBehindView(sh) {                   // 15:46AB BuildBehindView: two frames (the picture is display)
  const w = sh.w;
  w.wram[0][0x4BF] = 0x50;                       // wMapLoadPhase
  sh.advance();
  Scr.beginWhiteFadeOut(w, 6);
  w.high[0x18F] = 0;                             // frame tasks off while it draws
  sh.advance();
  w.high[0x18F] = 1;                             // (00:23E8 RegisterFrameTask of 15:47AD BehindViewTask: display)
}

export function hudDrawWind(w) {                 // 12:4A81 HudDrawWind (the tiles are display): the wind animation reset
  const r6 = w.wram[6];
  r6[0x326] = r6[0x327] = r6[0x328] = 0;
}

export function viewLeave(sh) {                  // 3B:431F ShotViewLeave: one frame
  sh.w.wram[6][0x337] = 0;
  sh.advance();
}

export function aimMarker(w) {                   // 10:6145 AimMarker: the aim arrow's end ($D481-$D484), across the aim
  const r6 = w.wram[6];
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
