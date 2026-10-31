// The 3D hole view's camera: it follows the game's views (wOnGreen $D443: the course view 0, the green view 1, the cup close-up 2,
// the view behind the golfer 4), the shot (the ball in the air $D415) and the game's own course camera (the scroll $C320 / $C322),
// with presets: FOLLOW (behind the golfer at the address, chasing the ball in flight, behind the ball towards the pin on the green),
// COURSE (the game's own framing: the course view's camera centre seen from above at a slant, the green view's, the behind view's),
// BEHIND (always low behind the ball along the aim or the flight) and TV (a broadcast camera beside the shot). Effects may take the
// camera for a while (scene.camOverride: the replay, the big moments, the title's fly-over). Reads the game's state; writes nothing.
import { m4, norm, sub, lerp, clamp } from "./gl.js";

export const PRESETS = { follow: "Follow", course: "Course", behind: "Behind", tv: "TV" };
const DEG = Math.PI / 180;

export class CameraRig {
  constructor(scene) { this.scene = scene; this.eye = null; this.at = null; this.fov = 50 * DEG; this.lastView = -1; this.fovK = 1; }
  yawToEye = (x, z) => Math.atan2(this.eye[0] - x, this.eye[2] - z);
  // the golfer turns to the camera, but no further than 75 degrees from facing back along the aim
  golferYaw = (back, x, z) => { const y = this.yawToEye(x, z); let d = ((y - back + Math.PI * 3) % (Math.PI * 2)) - Math.PI; d = clamp(d, -75 * DEG, 75 * DEG); return back + d; };
  goal(s) {
    const sc = this.scene, H = sc.hole.H, preset = sc.layers.camera;
    const b = sc.ballWorld(), [cx, cz] = s.cup, cy = H(cx, cz);
    const ad = [Math.cos(s.aim), Math.sin(s.aim)];                 // the aim along the map (x, z)
    const v = s.vel, vh = Math.hypot(v[0], v[2]), fd = vh > 0.02 ? [v[0] / vh, v[2] / vh] : ad;
    const toCup = (() => { const dx = cx - b[0], dz = cz - b[2], l = Math.hypot(dx, dz); return l > 0.5 ? [dx / l, dz / l] : ad; })();
    const flying = s.air || (sc.inShot && s.mark === "address" && vh > 0.01);
    const behind = (d, back, up, ahead, lift = 1) => ({ eye: [b[0] - d[0] * back, b[1] + up, b[2] - d[1] * back], at: [b[0] + d[0] * ahead, b[1] + lift, b[2] + d[1] * ahead] });
    if (preset === "tv") {
      const d = flying ? fd : ad, side = [-d[1], d[0]];
      return { eye: [b[0] + side[0] * 70 - d[0] * 30, b[1] + 40, b[2] + side[1] * 70 - d[1] * 30], at: [b[0] + d[0] * 20, b[1], b[2] + d[1] * 20], fov: 45, rate: 3 };
    }
    if (preset === "behind") {
      const d = flying ? fd : ad;
      return { ...behind(d, flying ? 26 : 20, flying ? 9 : 6, 40), fov: 52, rate: flying ? 5 : 4 };
    }
    if (preset === "course" && s.view !== 4) {
      let c;
      if (s.view === 0) c = [s.scroll[0] + 80, s.scroll[1] + 64];
      else if (s.view === 1) c = [s.green[0] + 20, s.green[1] + 16];
      else c = [cx, cz];
      const k = s.view === 0 ? 1 : s.view === 1 ? 0.3 : 0.12, cyy = H(c[0], c[1]);
      return { eye: [c[0], cyy + 125 * k, c[1] + 95 * k], at: [c[0], cyy, c[1] - 4 * k], fov: 50, rate: 6 };
    }
    // FOLLOW
    if (s.view === 4 && !flying) return { ...behind(ad, 20, 7, 50, 2.5), fov: 50, rate: 8 };   // the game's view: $280 units behind the ball
    if (flying) {
      const up = clamp(10 + s.ball[1] * 0.5, 10, 30);
      return { eye: [b[0] - fd[0] * 30, Math.max(b[1] + up * 0.6, H(b[0] - fd[0] * 30, b[2] - fd[1] * 30) + 4) + up * 0.4, b[2] - fd[1] * 30], at: [b[0] + fd[0] * 12, b[1], b[2] + fd[1] * 12], fov: 52, rate: s.air ? 3.5 : 2.5 };
    }
    if (s.view === 2) return { eye: [cx - toCup[0] * 7, cy + 3.5, cz - toCup[1] * 7], at: [cx, cy, cz], fov: 45, rate: 4 };
    if (s.view === 1) {
      const d = toCup, dist = Math.hypot(cx - b[0], cz - b[2]);
      return { eye: [b[0] - d[0] * 20, b[1] + 7 + dist * 0.2, b[2] - d[1] * 20], at: [lerp(b[0], cx, 0.6), cy, lerp(b[2], cz, 0.6)], fov: 50, rate: 4 };
    }
    if (s.mark === "flyover" || s.mark === "hole" || s.mark === "windintro") {     // the game's fly-over: its camera's centre
      const c = [s.scroll[0] + 80, s.scroll[1] + 64], d = toCup;
      return { eye: [c[0] - d[0] * 70, H(c[0], c[1]) + 55, c[1] - d[1] * 70], at: [c[0] + d[0] * 10, H(c[0], c[1]), c[1] + d[1] * 10], fov: 50, rate: 2.5 };
    }
    // aiming on the course: high behind the ball, looking down the aim
    return { ...behind(ad, 34, 26, 55, 0), fov: 52, rate: 4 };
  }
  update(s, dt, aspect) {
    const sc = this.scene;
    let g = sc.camOverride ? sc.camOverride(s, dt) : null;
    if (!g) g = this.goal(s);
    const snap = !this.eye || g.snap || (s.view !== this.lastView && (s.view === 4 || this.lastView === 4) && !sc.camOverride);
    this.lastView = s.view;
    if (snap) { this.eye = g.eye.slice(); this.at = g.at.slice(); this.fov = g.fov * DEG; }
    else {
      const k = 1 - Math.exp(-(g.rate || 4) * dt);
      for (let i = 0; i < 3; i++) { this.eye[i] = lerp(this.eye[i], g.eye[i], k); this.at[i] = lerp(this.at[i], g.at[i], k); }
      this.fov = lerp(this.fov, g.fov * DEG, k);
    }
    // keep the eye above the ground
    const gy = sc.hole.H(this.eye[0], this.eye[2]) + 1.2; if (this.eye[1] < gy) this.eye[1] = gy;
    const view = m4.lookAt(this.eye, this.at, [0, 1, 0]);
    const fovY = this.fov * Math.min(1, 1.11 / aspect * 1.0 + 0.0);   // (a tall view keeps the width)
    const proj = m4.perspective(fovY, aspect, 0.4, 9000);
    this.fovK = Math.tan(fovY / 2) / Math.tan(25 * DEG);
    return { view, proj, eye: this.eye, focus: this.at };
  }
}
