// A shot (tools/shot_py.py): BallTask 10:4D45 complete, and the shot's main thread from the golfer addressing
// the ball (AddressBall 10:56B0) through the swing, ShotLaunch, the flight-camera loop and ShotMainLoop
// 10:6E99 to the outcome. Graphics, sprites and sounds are left out; what they would do goes to fx.
import { rb } from "./rom.js";
import * as g from "./math.js";
import * as B from "./ball.js";
import * as C from "./cup.js";
import * as L from "./launch.js";
import * as S from "./swing.js";
import * as Cam from "./camera.js";
import { fadeVBlank, updateGameTimer } from "./screen.js";
import * as V from "./view.js";
import { ballInGreenArea } from "./view.js";
import { readJoypad } from "./joypad.js";
import { taskFacade, runFrameTasks } from "./tasks.js";
import { showCaption, captionMotionTask, captionAnimTask } from "./captions.js";
import * as P from "./pictures.js";
import { scorecardStrokesTask, scorecardMatchPlayTask } from "./scorecard.js";
import { matchStandingsTask } from "./standings.js";
import { menuCursorTask } from "./windows.js";
import { demoTasks } from "./title.js";
import { actorsUpdateTask, actorsDrawTask } from "./actors.js";
import { confettiTask, resultPaletteCycleTask, resultSpriteTask } from "./result.js";
import { mapScrollTask } from "./render/holeview.js";
import { contestLeaderSpriteTask } from "./match.js";
import { vblankDisplay, clearUnusedSprites } from "./render/display.js";
import * as D from "./render/hooks.js";
import { ball, rd16, wr16, playerField } from "./memory.js";

export function applyFx(w, fx) {                 // what the ported branches do outside $D400-$D4FF
  for (const f of fx) {
    if (Array.isArray(f) && f[0] === "bunker") { // PlayerField $15 bit 0, $3F = plug depth
      w.wram[0][playerField(w, 0x15)] |= 1;
      if (f[1]) w.wram[0][playerField(w, 0x3F)] = f[1];
    }
  }
}

export function terrainCheck(w, hole, s) {       // 10:527C BallTerrainCheck: the last safe spot -> $D51D
  let hl = rd16(s, 0x01), de = rd16(s, 0x04);
  const v = s[0x43];
  if (v && v !== 4) {
    const d = ((de >> 8) - s[0x42]) & 0xFF, h = ((hl >> 8) - s[0x41]) & 0xFF;
    if (h >= 5 || d >= 4) return;
    hl = ((h << 8 | hl & 0xFF) << 2) & 0xFFFF;
    de = ((d << 8 | de & 0xFF) << 2) & 0xFFFF;
  }
  const t = hole.terrainAt(hl, de);
  if (t === 3 || t === 7) return;
  w.wram[6].set(s.subarray(0, 6), 0x51D);
}

export function treeCheck(w, hole, s, fx) {      // 08:51D2 TreeCheck: tiles with bit 7 in the $D700 table
  const r6 = w.wram[6];
  if (r6[0x519] === s[0x05] && r6[0x516] === s[0x02]) return;   // this tile was hit already
  if (s[0x43] === 1 || s[0x43] === 2) return;
  const attr = hole.slope[hole.tmap[(s[0x05] & 0x3F) << 6 | (s[0x02] & 0x3F)]];
  if (!(attr & 0x80)) return;
  const a = (((s[0x07] | s[0x08] << 8) << 3) & 0xFFFF) >> 8;
  if (a >= 0x18) return;                         // above the tree
  const c = r6[0x4F3 + (a & 0x1F)];              // the half width at this height (bit 0: solid)
  if (!c) return;
  const e = (s[0x04] & 0xF0) | (s[0x01] >> 4);
  const de = g.vectorFromLengthAndAngleRaw(S.treeDist(e), (S.treeAngle(e) - s[0x14]) & 0xFF)[1];
  if ((g.abs16(de) & 0xFF) >= (c & 0xFE)) return;   // passes beside it
  r6[0x519] = s[0x05]; r6[0x516] = s[0x02];
  if (c & 1) {                                   // the trunk: mirrored direction, half speed
    const b = (2 * S.treeAngle(e) - s[0x14] + 0x80) & 0xFF;
    const [hl, d2] = g.mulSinCos((s[0x13] >> 1) << 8, b << 8);
    wr16(s, 0x0B, d2);
    wr16(s, 0x09, hl);
    s[0x8E] |= 0x10;
    if (s[0x13]) fx.push(["sound", "tree", 0]);
  } else {                                       // through the leaves: slowed
    for (const [o, f] of [[0x09, 0xE6], [0x0B, 0xE6], [0x0D, 0xF0]]) wr16(s, o, g.mulHLByAFracSigned(rd16(s, o), f));
    s[0x8E] |= 0x10;
    if (s[0x13]) fx.push(["sound", "tree", 1]);
  }
}

export function restWatch(s) {                   // 10:7077 RestWatch: $D4D3 counts frames at the same spot
  if (s[0x01] === s[0xCF] && s[0x02] === s[0xD0] && s[0x04] === s[0xD1] && s[0x05] === s[0xD2] && ((s[0x07] + 1) & 0xFF) < 2) {
    s[0xD3] = (s[0xD3] + 1) & 0xFF;
    return;
  }
  s[0xCF] = s[0x01]; s[0xD0] = s[0x02]; s[0xD1] = s[0x04]; s[0xD2] = s[0x05];
  s[0xD3] = 0;
}

export function ballTask(w, hole, out) {         // 10:4D45 BallTask (out collects its sounds and effects)
  const s = ball(w), fx = [];
  hole.use(s[0x43] >= 1 && s[0x43] <= 3);
  if (s[0x15]) {
    if (B.flightStep(s, w.wram[0][0x815], w.wram[0][0x816])) {
      B.bounce(s, hole, fx);
      w.wram[6][0x331] = 1;                      // 10:500D, 10:522C
    }
    B.landCheck(s, fx);
  } else if (B.rollStep(s, hole, fx) === "water") w.wram[6][0x331] = 1;
  applyFx(w, fx);
  terrainCheck(w, hole, s);
  treeCheck(w, hole, s, fx);
  if (w.high[0x194] & 2) w.wram[6][0x360] = 2;   // B pressed
  restWatch(s);
  w.wram[0][0xAAB] = s[0x07]; w.wram[0][0xAAC] = s[0x08];
  out.push(...fx);
  s[0xC1] = s[0x07]; s[0xC2] = s[0x08];
}

const lieFairway = i => rb(0x10, 0x70DB + i);    // lie quality by position: fairway (10:70DB), rough (10:7112)
const lieRough = i => rb(0x10, 0x7112 + i);

export { ballInGreenArea };                      // 10:5617 BallInGreenArea (view.js)

export function lieTerrain(hole, s) {            // 10:648B BallLieTerrain
  let hl = rd16(s, 0x01), de = rd16(s, 0x04);
  if (s[0x43] && s[0x43] !== 4) {
    de = ((((((de >> 8) - s[0x42]) & 0xFF) << 8) | (de & 0xFF)) << 2) & 0xFFFF;
    hl = ((((((hl >> 8) - s[0x41]) & 0xFF) << 8) | (hl & 0xFF)) << 2) & 0xFFFF;
  }
  hole.use(s[0x43] >= 1 && s[0x43] <= 3);
  return hole.terrainAt(hl, de);
}

export function initBallCamera(w) {             // 11:476E InitBallCamera: view-4 camera at the ball, angle $C000 - aim
  const r6 = w.wram[6];
  wr16(r6, 0x456, rd16(r6, 0x401));
  wr16(r6, 0x458, rd16(r6, 0x404));
  wr16(r6, 0x45A, (0xC000 - rd16(r6, 0x418)) & 0xFFFF);
}

export function registered(w, bank, addr) {      // bank:addr in the frame task table ($C1C0: 16 x flags, addr, bank)?
  const t = w.wram[0];
  for (let i = 0x1C0; i < 0x200; i += 4)
    if (t[i] && !(t[i] & 0x80) && (t[i + 1] | t[i + 2] << 8) === addr && t[i + 3] === bank) return true;
  return false;
}

export const TASKS = {
  taskOn: [1, 0x10, 0x4D45],                     // BallTask
  meterOn: [1, 0x10, 0x55AC],                    // the swing's d-pad task
  animOn: [0x0F, 0x11, 0x6E3E],                  // the golfer's animation
  displayOn: [0x0C, 0x11, 0x4113],               // the ball display
};


// The main thread of a shot (and the frame runner the round's code uses). ev(kind) is called at the points
// tools/emu_shot_record.py records: F at each AdvanceFrame, T at each BallTask, L / P at the loop tops, and
// M (ev("M", name)) at the steps tools/emu_hole_setup.py marks; a test compares the RAM there. input(), if set,
// gives the buttons held for each frame (else the joypad bytes are left as they are, e.g. set by a test).
export class Shot {
  constructor(w, hole, ev = () => {}, input = null) {
    this.w = w; this.hole = hole; this.ev = ev; this.input = input;
    w.sh = this;                                 // (the frame runner of this memory: a test replays lag VBlanks with it)
    if (!w.tasks) w.tasks = taskFacade(w, TASKS); // the task table $C1C0 (tasks.js) as on/off flags
    this.t = w.tasks;
    this.fx = this.newFx();
    this.dispatch = {                            // the frame tasks by ROM address
      "10:4d45": () => { this.ev("T"); ballTask(w, this.hole, this.fx); },   // 10:4D45 BallTask
      "10:55ac": () => S.meterTask(w),           // 10:55AC
      "11:6e3e": () => D.golfAnimDraw(this, S.animTask(w)),        // 11:6E3E GolfAnimTask
      "11:4113": () => this.displayTask(),       // 11:4113 BallDisplayTask
      "3b:4433": () => captionMotionTask(w),     // 3B:4433 CaptionMotionTask
      "4f:62a7": () => captionAnimTask(w),       // 4F:62A7 CaptionAnimTask
      "77:7033": () => P.storyPictureAnimTask(w),      // 77:7033
      "77:6f8e": () => P.storyPicturePaletteTask(w),   // 77:6F8E
      "77:70b6": () => P.storyPictureTimerTask(w),     // 77:70B6
      "4a:62a3": () => P.pictureCycleTask(w),          // 4A:62A3
      "48:5ee9": () => P.pictureAnimTiles(w),          // 48:5EE9
      "0e:6d47": () => scorecardStrokesTask(w),        // 0E:6D47
      "0e:76f5": () => scorecardMatchPlayTask(w),      // 0E:76F5
      "3e:465a": () => matchStandingsTask(w),          // 3E:465A
      "05:4f20": () => menuCursorTask(w),              // 05:4F20 MenuCursorTask
      "04:4234": () => actorsUpdateTask(w),            // 04:4234
      "04:4b69": () => actorsDrawTask(w, id => this.sound(id)),   // 04:4B69
      "0b:4784": () => mapScrollTask(w),               // 0B:4784 MapGfxScrollTask: farcall 04:4072
      "0b:5de1": () => confettiTask(w),                // 0B:5DE1
      "0b:648f": () => resultPaletteCycleTask(w),      // 0B:648F
      "0b:6694": () => resultSpriteTask(w),            // 0B:6694
      "08:439e": () => contestLeaderSpriteTask(w, 0),  // 08:439E
      "08:43ab": () => contestLeaderSpriteTask(w, 1),  // 08:43AB
      ...demoTasks(w),                           // the title and its demo (bank 40)
      ...D.displayTasks(this),                   // tasks that only draw (render/hooks.js)
    };
  }

  mark(name) { this.ev("M", name); }
  sound(id) { if (this.w.onSound) this.w.onSound(id); }   // rst $08 PlaySoundCmd 00:2BBB: to the sound driver, if any
  // the list the ported routines put their sounds and effects in: a ["sound", id] entry is played as it is added, a
  // ["splash", x, y] one drawn
  // (["sound", "tree", k]: 08:5526 TreeSound, k = 0 the trunk / 1 the leaves, by course from the table 08:553F)
  newFx() {
    const a = [];
    a.push = (...xs) => {
      for (const x of xs) {
        if (Array.isArray(x) && x[0] === "splash") {   // the water splash (display)
          D.hud(this.w, "waterSplashAt", x[1], x[2]);
          D.hud(this.w, "waterSplashGfx");
        }
        if (!Array.isArray(x) || x[0] !== "sound") continue;
        if (typeof x[1] === "number") this.sound(x[1]);
        else if (x[1] === "tree") this.sound(rb(0x08, 0x553F + (((this.w.wram[0][0x836] & 0x0F) * 2 + (x[2] & 1)) & 0xFF)));
      }
      return Array.prototype.push.apply(a, xs);
    };
    return a;
  }

  // 00:2E3B AdvanceFrame: VBlank 00:2EF9 (its display work, ReadJoypad 00:02EB, the fades, the VBlank tasks), then
  // ClearUnusedSprites 00:2688 and the frame tasks in table order
  *advance(n = 1) {                              // (a generator: the round is a coroutine, yield* at every caller)
    const w = this.w, h = w.high;
    for (let k = 0; k < n; k++) {
      yield;                                     // (the frame: a caller running the round frame by frame steps here)
      this.ev("F");
      this.fx = this.newFx();                    // this frame's sounds and effects
      if (w.vram) vblankDisplay(w);              // palettes, scroll, OAM DMA, the VRAM queues
      else if (!h[0x18D]) { h[0x18D] = 1; h[0x18C] = (h[0x18C] + 1) & 0xFF; }
      if (this.input) readJoypad(h, this.input());
      updateGameTimer(w, id => this.sound(id));  // 00:2C6B
      fadeVBlank(w);                             // 00:25DF / 00:25C9
      runFrameTasks(w, true, this.dispatch);     // 00:247D with a = $80
      if (this.ev.v) this.ev("V");               // (VBlank done: AdvanceFrame leaves its wait, 00:2EBF)
      if (w.vram) clearUnusedSprites(w);
      runFrameTasks(w, false, this.dispatch);    // 00:247D (off while $FF8F is 0)
      h[0x18D] = 0;
      w.wram[0][0x4B2] = (w.wram[0][0x4B2] + 1) & 0xFF;   // wFrameCounter
    }
  }

  displayTask() {                                // 11:4113 BallDisplayTask by view (the sprites are display)
    const w = this.w, r6 = w.wram[6], v = r6[0x443] & 7;
    if (v <= 1) {                                // 11:4361 course view / 11:4970 green view
      Cam.step(w);                               // 11:422F
      if (r6[0x485] & 0x10) S.previewFrame(w, this.hole, this.fx);   // 11:4E5E
      D.lookCursor(w);                           // 11:4704 / 11:4C12
      S.drawSortedBallObjects(w, id => D.drawBallObject(w, id));     // 11:4D79
    } else if (v === 2) {
      D.cupView(w);                              // 11:4CBB BallDisplayCupView
    } else if (v === 3) {
      initBallCamera(w);                         // 11:476E
    } else if (v >= 4 && v <= 6) {               // 11:4795 BallView4
      if (r6[0x485] & 0x10) { S.previewFrame(w, this.hole, this.fx); D.previewMarkerView4(w); }   // 11:48AB
      D.view4Ball(w, S.ballViewCut(w));          // 11:47A2
    }
  }

  // 10:56B0 AddressBall: Up / Down change club (view 4), Left / Right nudge the aim, A swings, B goes back.
  // entered: start at the loop top 10:5713 (after its AdvanceFrame)
  *address(entered = false) {
    const w = this.w, s = ball(w), r6 = w.wram[6];
    this.t.taskOn = false;
    if (!entered) s[0x60] = s[0x61] = 0;
    let label = entered ? "5713" : "56B6";
    for (;;) {
      if (label === "56B6") {
        S.meterReset(w);
        yield* this.advance();
        if (s[0xD7]) return yield* this.cpuSwing();
        s[0x53] = 0;
        s[0x51] = 1;
        label = "56CC";
      }
      if (label === "56CC") {
        r6[0x321] = S.missTable(w);
        D.hud(w, "hudDrawShotPanel");            // 12:46A6
        D.hud(w, "hudDrawClubIcon");             // 12:465C
        yield* this.advance();
        D.hud(w, "hudDrawPinDistance");          // 12:4CB1
        yield* this.advance();
        D.hud(w, "hudDrawLieIcon");              // 12:45F4
        L.clubParams(w);
        label = "56E7";
      }
      if (label === "56E7") {
        s[0x80] = 0;
        r6[0x382] = 1;
        S.marker(w);
      }
      if (label !== "5713") yield* this.advance();
      label = "5710";
      const joy = w.high[0x194];
      if (joy & 1) {
        const r = yield* this.swing();
        if (r === "again") { label = "56B6"; continue; }
        return r;
      }
      if (joy & 2) return 0xFF;                  // back to the aiming menu
      if (s[0x43] !== 4) continue;
      const rep = w.high[0x191], club = r6[0x329];
      if (rep & 0x40 || rep & 0x80) {
        if (s[0xCD] !== 6 && ((rep & 0x40 && club !== 0) || (!(rep & 0x40) && club !== 0x0C))) {
          r6[0x329] = rep & 0x40 ? club - 1 : club + 1;
          this.sound(0x8C);                      // 10:5750 / 10:576D
          label = "56CC";
        }
        continue;
      }
      const held = w.high[0x190];
      let bc;
      if (held & 0x20) bc = (s[0x61] - 0xF8) & 0x80 ? 0 : 0xFF80;
      else if (held & 0x10) bc = (s[0x61] - 0x08) & 0x80 ? 0x80 : 0;
      else continue;
      wr16(s, 0x18, (rd16(s, 0x18) + bc) & 0xFFFF);
      wr16(s, 0x60, (rd16(s, 0x60) + bc) & 0xFFFF);
      label = "56E7";
    }
  }

  *swing() {                                      // 10:57C0 / SwingMeterLoop 10:57E0: A for power, A for impact
    const w = this.w, s = ball(w), r6 = w.wram[6];
    s[0x4D] = 0;
    s[0x51] = 0;
    this.sound(0x90);                            // 10:57C0
    if (r6[0x329] !== 0x0D) this.t.meterOn = true;
    S.animStart(w, 1);
    let b = 0;
    for (;;) {
      yield* this.advance();
      const a = s[0x4E];
      s[0x4F] = a >= 0x3C ? (0x78 - a) & 0xFF : a;
      if (s[0x4E] >= 0x78 && !b) return yield* this.swingOff();
      let c;
      if (!(s[0x4E] & 1)) c = w.high[0x194] | s[0x53];
      else { s[0x53] = w.high[0x194]; c = 0; }
      if (c & 2 && !b) return yield* this.swingOff();
      if (c & 1) {
        this.sound(0x90);                        // 10:5822
        if (b) return this.swingEnd(true);
        s[0x50] = s[0x4F];
        b = 1;
        if (r6[0x329] === 0x0D) {                // the putter: one press
          r6[0x32A] = r6[0x32B];
          return this.swingEnd(false);
        }
        if (s[0x50] === 0x3C) { s[0x52] = 1; this.sound(0x5E); }   // 10:5850
      }
      s[0x4E] = (s[0x4E] + 1) & 0xFF;
      if (s[0x4E] === 0x8A) return b ? this.swingEnd(true) : yield* this.swingOff();
    }
  }

  // 10:5643 SwingMeterCPU: the computer's swing, no buttons: the cursor runs up the whole meter ($3C frames) and
  // the power is taken where it passes wSwingTargetPower (the putter swings there and then); with the d-pad of
  // wSwingTargetPad, back down to wSwingTargetImpact (perfect at 0). (Sounds $90, $5E, ~10:5534 MaxMissSound.)
  *cpuSwing() {
    const w = this.w, s = ball(w), r6 = w.wram[6];
    s[0x4D] = 0;
    S.animStart(w, 1);                           // 11:6D8F
    this.sound(0x90);                            // 10:564C
    for (let c = 0x3C; c; c--) {
      s[0x4E] = (s[0x4E] + 1) & 0xFF;
      s[0x4F] = s[0x4E];
      yield* this.advance();
      if (r6[0x4D8] === s[0x4E]) {
        this.sound(0x90);                        // 10:5661
        s[0x50] = r6[0x4D8];
        if (r6[0x329] === 0x0D) { S.animStart(w, 2); return 0; }
      }
    }
    if (s[0x50] === 0x3C) { s[0x52] = 1; this.sound(0x5E); }   // wSwingFullPower (10:567C)
    s[0x4D] = r6[0x4DA];
    S.setImpactFromPad(w, r6[0x4DA]);
    do {
      s[0x4E] = (s[0x4E] - 1) & 0xFF;
      s[0x4F] = s[0x4E];
      yield* this.advance();
    } while (r6[0x4D9] !== s[0x4E]);
    this.sound(0x90);                            // 10:5697
    if (s[0x4F] === 0) { s[0x51] = 1; this.sound(0x5E); }   // wSwingPerfect (10:56A4)
    this.maxMissSound();                         // 10:56A6
    S.animStart(w, 2);
    return 0;
  }

  swingEnd(impact) {                             // 10:587A (downswing; perfect at cursor 0) and 10:588D
    const w = this.w, s = ball(w);
    if (impact) {
      S.animStart(w, 2);
      if (s[0x4F] === 0) { s[0x51] = 1; this.sound(0x5E); }   // 10:588B
    }
    this.t.meterOn = false;
    this.maxMissSound();                         // 10:5893
    return 0;
  }

  maxMissSound() {                               // 10:5534 MaxMissSound: not the putter, sound $5F at |MissIndex| 9
    if (this.w.wram[6][0x329] === 0x0D) return;
    let a = L.missIndex(this.w);
    if (a & 0x80) a = (-a) & 0xFF;
    if (a === 9) this.sound(0x5F);
  }

  *swingOff() {                                   // 10:5861: no power or B: back to the address after 20 frames
    const w = this.w, s = ball(w);
    this.sound(0x5F);                            // 10:5861
    s[0x4D] = 0xF0;
    this.t.meterOn = false;
    S.animStart(w, 3);
    yield* this.advance(20);
    return "again";
  }

  *afterSwing() {                                 // 10:4921-10:49A0: from the swing to ShotLaunch
    const w = this.w, s = ball(w), r6 = w.wram[6], w0 = w.wram[0];
    s[0x85] &= 0xEF;
    S.shotRecord(w);                             // 02:46B0 (~02:48B8 is for link play)
    s[0x85] = 0x2D;
    if (s[0x43] === 4) {
      for (;;) { yield* this.advance(); if (s[0x64]) break; }   // 11:6E34: until the club meets the ball
    } else {                                     // 10:4AEF PuttWait: the golfer's map sprite swings (04:57A1)
      const [anim, n] = r6[0x329] === 0x0D ? [4, 0x30] : r6[0x32A] >= 2 ? [8, 0x24] : [3, 0x32];
      D.golferActorSetAnim(w, anim);
      yield* this.advance(n);
    }
    r6[0x35A] = w0[0x8A0]; r6[0x35B] = w0[0x8A1];
    r6[0x35D] = r6[0x32A]; r6[0x35E] = r6[0x32B];
    r6[0x35C] = w0[playerField(w, 0x2B)];
    r6[0x369] = s[0x18]; r6[0x36A] = s[0x19];
    r6[0x359] = w0[playerField(w, 0x29)];
    s[0x47] = s[0x46];
    const f = playerField(w, 0x20);              // 10:477C CountStroke
    if (w0[f] < 0x14) {
      w0[f]++;
      D.hud(w, w0[0x835] ? "hudDrawPlayer2" : "hudDrawPlayer1");   // 10:4786 HudRedrawCurPlayer
      yield* this.advance();
    }
    r6[0x35F] = r6[0x360] = 0;
    r6[0x519] = s[0x05]; r6[0x516] = s[0x02];
    s[0x85] |= 4;
    return yield* this.launch();
  }

  *fromAddress(entered = false) {                 // the swing as played, then the shot: the outcome
    const r = yield* this.address(entered);
    if (r !== 0) return r;
    return yield* this.afterSwing();
  }

  // -- the view changes: maps and graphics; only their RAM effects on the shot state are kept --
  *viewLeave() { yield* V.viewLeave(this); }             // 3B:431F ShotViewLeave

  *loadView(c) { yield* V.loadShotView(this, c); }       // 13:432B LoadShotView

  cupView(v) {                                   // 13:44A4 CupViewEnter (v = 2) / 13:4528 CupViewLeave (v = 1): display only
    if (v === 2) D.cupViewEnter(this.w); else D.cupViewLeave(this.w);
  }

  *launch() {                                     // 10:5F94 ShotLaunch and 10:49A0-10:49D8 after it
    const w = this.w, s = ball(w), r6 = w.wram[6];
    L.shotLaunch(w, this.fx);
    for (let o = 0xCF; o < 0xD5; o++) s[o] = 0;  // 10:706C
    s[0x46] = 0;
    D.shotLengthTaskStart(w);                    // 12:4F14
    if (r6[0x32A] === 1 && r6[0x329] !== 0x0D && !(r6[0x44F] === 0 && r6[0x450] === 0x3C)) {
      const f = playerField(w, 0x28);            // 10:433B PowerShotUse (unless perfect)
      w.wram[0][f] = (w.wram[0][f] - 1) & 0xFF;
    }
    s[0x38] = 0x11;
    this.t.taskOn = true;                        // 10:49B7 ShotFly: RegisterFrameTask(1, BallTask)
    if (s[0x43] !== 4) return yield* this.afterFlight();   // on the green views: no flight camera
    r6[0x331] = w.wram[0][0x33F] && s[0x17] < 8 ? 1 : 0;
    yield* this.advance();
    this.ev("P");
    return yield* this.flightCam(0x5A);
  }

  *flightCam(c) {                                 // 10:49DD: the flight-camera loop from its top, counter c
    const w = this.w, s = ball(w);
    while (!(ballInGreenArea(s) || w.wram[6][0x331])) {
      c = (c - 1) & 0xFF;
      if (!c) break;
      yield* this.advance();
      this.ev("P");
    }
    D.behindViewTaskStop(w);                     // 15:47B1
    D.golferActorShow(this);                     // 04:57BA
    D.golferActorAnim3(w);                       // 04:5808
    D.mapScrollTaskStart(w);                     // 04:4062
    yield* this.loadView(ballInGreenArea(s));           // 10:4A00
    V.hudDrawWind(w);                            // 12:4A81
    yield* this.advance();                              // 10:4A0A WaitFramesCmd 1
    return yield* this.afterFlight();
  }

  *afterFlight() {                                // 10:4A0E
    const s = ball(this.w);
    if (!(s[0x8E] & 0x10) && s[0x8E] & 0x08) { this.fx.push(["cue", 8]); yield* showCaption(this, 8); }   // 3B:4339
    yield* this.advance();                              // 10:4A1E WaitFramesCmd 1
    return yield* this.mainLoop();
  }

  *mainLoop(entered = false) {                    // 10:6E99 ShotMainLoop; entered: at its top (after AdvanceFrame)
    const s = ball(this.w);
    if (!entered) {
      s[0xBB] = s[0xBC] = s[0xBD] = s[0xBE] = 0;
      s[0xB9] = 0;
      s[0x44] = 0;
    }
    return yield* this.loop(entered);
  }

  *loop(entered) {                                // 10:6EA7 / 10:6EAA
    for (;;) {
      if (entered) entered = false;
      else { yield* this.advance(); this.ev("L"); }
      const r = yield* this.body();
      if (r !== null) return r;
    }
  }

  *body() {                                       // one pass of 10:6EAA; null = next frame, else the outcome
    const w = this.w, s = ball(w), fx = this.fx, w0 = w.wram[0], w6 = w.wram[6];
    const x = s[0x02], y = s[0x05];
    if (w0[0x329] > x || x >= w0[0x32B] || w0[0x32A] > y || y >= ((w0[0x32C] - 2) & 0xFF)) {
      fx.push(["sound", 0x40]);                  // 10:6E90 ShotOutOfBounds
      yield* this.advance(30);
      return 7;
    }
    let to6F28 = true;
    if (s[0x43] === 1) {
      if (C.nearCup(s)) {
        C.pinCheck(s, fx);
        if (!s[0x08] && s[0x07] < 0x20) { this.cupView(2); s[0x43] = 2; to6F28 = false; }
      }
    } else if (s[0x43] === 2) {
      C.pinCheck(s, fx);
      const low = s[0x08] & 0x80 || (!s[0x08] && s[0x07] < 0x20);
      if (!(low && C.nearCup(s))) { this.cupView(1); s[0x43] = 1; }
      to6F28 = false;
    }
    if (to6F28) {
      const c = ballInGreenArea(s);
      if (s[0x43] !== c) { yield* this.viewLeave(); s[0x43] = c; yield* this.loadView(c); }
    }
    if (s[0x43] === 2) {                         // 10:6F43
      if (C.flyIn(s)) return yield* this.holed();
      if (!((((s[0x07] | s[0x08] << 8) - 4)) & 0x8000)) return null;
      if (C.cupClose(s) < 6) {
        C.rollIn(s);
        return s[0xB1] ? yield* this.holed() : null;
      }
    }
    if (B.cupPull(s)) return null;               // 10:6F9E
    if (s[0xD3] >= 0x28) return this.atRest();
    if (!w6[0x35F] || w6[0x367] & 0x80) return null;
    const joy = w.high[0x194];
    if (joy & 2) return this.atRest();
    if (!(joy & 1)) return null;
    return yield* this.retry();
  }

  *holed() {                                      // 10:7052 ShotHoled
    const s = ball(this.w);
    s[0x44] = 1;
    this.t.taskOn = false;
    const a = yield* C.cupDrop(s, n => this.advance(n), []);
    this.t.taskOn = true;
    if (a === 2) return yield* this.loop(false);        // jp 10:6EA7: back into the loop without its set-up
    this.fx.push(["sound", 0x5A]);
    yield* C.holeOutPlace(s, n => this.advance(n));
    s[0x85] &= 0xFB;
    return 0x80;
  }

  atRest() {                                     // 10:7029 ShotAtRest
    const w = this.w, s = ball(w);
    s[0x0D] = s[0x0E] = 0;
    s[0x06] = s[0x07] = s[0x08] = 0;
    const t = lieTerrain(this.hole, s);
    const table = t === 0 || t === 0x0E ? lieFairway : t === 1 ? lieRough : null;
    if (table) {
      const q = table(((s[0x03] >> 4) + (s[0x00] >> 4)) & 0x0F);
      w.wram[0][playerField(w, 0x3F)] = q;
      s[0x46] = q;
    }
    return t;
  }

  *retry() {                                      // 10:6FC9: A after the ball stopped, with $D35F set
    const w = this.w, s = ball(w), w6 = w.wram[6];
    s.set(w6.subarray(0x361, 0x367), 0);
    w6.copyWithin(0x51D, 0x36D, 0x373);
    w.wram[0][playerField(w, 0x3F)] = w6[0x368];
    s[0x46] = w6[0x368];
    for (let o = 0x06; o < 0x0F; o++) s[o] = 0;
    s[0x15] = 0;
    this.fx.push(["sound", 0x40]);
    const c = ballInGreenArea(s);
    if (c) yield* this.loadView(1);
    else if (s[0x43]) yield* this.loadView(0);
    else throw new Error("~13:4276 is not ported");
    w6[0x360] = 0;
    return w6[0x367];
  }
}

// run a generator (a part of the round) to its end at once: the tests and tools that do not step it frame by frame
export function runSync(g) {
  let r;
  do r = g.next(); while (!r.done);
  return r.value;
}
