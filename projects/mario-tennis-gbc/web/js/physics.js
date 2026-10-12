// Ball physics: port of tools/ball_sim.py (= BallStep 08:576B), verified against PyBoy to
// 0.03 px (spinning serve) and 0.27 px over 124 frames. Units: positions 16.16, velocities 8.16
// (both stored as plain integers here), spins raw 16-bit.
export const FX = 65536;
export const COURT = {
  baseline: 1248, serviceLine: 672, singles: 432, doubles: 576, net: 96,
  fenceNear: 1760, fenceFar: -1792, fenceSide: 928,
};
const GRAVITY = 0x4A00, DAMP = 0xCD;

const mshr = (p, n) => (p >= 0 ? 1 : -1) * Math.floor(Math.abs(p) / (1 << n));
const hi8 = v => Math.floor(v / 256);              // 8.16 -> 8.8 (arithmetic shift)

export function newBall() {
  return { X: 0, Y: 0, Z: 0, vX: 0, vY: 0, vZ: 0, top: 0, side: 0, head: 0,
           bounces: 0, event: 0, lastHitter: -1, netHit: false };
}

function damp(b) {                                  // 08:46B0
  b.vX = Math.floor(b.vX * DAMP / 256); b.vY = Math.floor(b.vY * DAMP / 256); b.vZ = Math.floor(b.vZ * DAMP / 256);
}
const not24 = v => -v - 1;                           // one's complement (cpl)

export function step(b) {
  b.event = 0;
  const spdxy = Math.floor(Math.hypot(b.vX / FX, b.vY / FX) * 256);
  b.head = (Math.round(Math.atan2(b.vY, b.vX) / (2 * Math.PI) * 65536 / 64) * 64) & 0xFFFF;
  const prevY = b.Y;
  b.X += b.vX; b.Y += b.vY; b.Z += b.vZ;
  // fences 08:5949
  const yi = Math.floor(b.Y / FX);
  if (yi >= COURT.fenceNear || yi < COURT.fenceFar) { b.vY = not24(b.vY); b.Y += b.vY; damp(b); damp(b); b.event = 2; }
  if (Math.abs(Math.floor(b.X / FX)) >= COURT.fenceSide) { b.vX = not24(b.vX); b.X += b.vX; damp(b); damp(b); b.event = 2; }
  // net 08:5814: crossing Y = 0 below the tape -> bounce back off the net (approximation of the
  // full routine: Y mirrored, horizontal speed cut)
  if ((prevY < 0) !== (b.Y < 0) && b.Z + COURT.net * FX >= 0) {
    b.Y = not24(b.Y); b.vX = Math.floor(b.vX / 4); b.vY = -Math.floor(b.vY / 4); b.netHit = true; b.event = 3;
  }
  // drag 08:55B4
  const speed = Math.floor(Math.hypot(b.vX / FX, b.vY / FX, b.vZ / FX));
  const k = (speed >> 4) + 1;
  b.vX -= Math.floor(b.vX * k / 512); b.vY -= Math.floor(b.vY * k / 512); b.vZ -= Math.floor(b.vZ * k / 512);
  // spin 08:5613
  if (b.side) {
    const dX = -mshr(b.side * hi8(b.vY), 12), dY = mshr(b.side * hi8(b.vX), 12);
    b.vY += dY; b.vX += dX; b.side -= 3 * (b.side >> 8);
  }
  if (b.top) {
    const t1 = -mshr(b.top * hi8(b.vZ), 13);
    b.vZ += mshr(b.top * spdxy, 12);
    const a = b.head / 65536 * 2 * Math.PI;
    b.vY += Math.trunc(2 * t1 * Math.sin(a)); b.vX += Math.trunc(2 * t1 * Math.cos(a));
    b.top -= 3 * (b.top >> 8);
  }
  // gravity / ground 08:57BC, 08:46B0
  if (b.Z < 0) b.vZ += GRAVITY;
  else {
    b.Z = -b.Z; b.vZ = not24(b.vZ); damp(b); b.bounces++; b.event = 1;
    if (b.vZ > -0x0250 * 256) { b.Z = 0; b.vZ = 0; }      // stops bouncing
  }
}

// LaunchBall 08:45A9: speed (px/frame), elevation & heading (radians)
export function launch(b, speed, elev, heading, top = 0, side = 0) {
  const h = speed * Math.cos(elev);
  b.vX = Math.round(h * Math.cos(heading) * FX); b.vY = Math.round(h * Math.sin(heading) * FX);
  b.vZ = Math.round(-speed * Math.sin(elev) * FX);
  b.top = top; b.side = side; b.bounces = 0; b.netHit = false;
}

// Simulate a copy until the first bounce; returns {X, Y, frames, clearsNet}
export function predictBounce(b, maxFrames = 240) {
  const c = { ...b, bounces: 0 };
  let clears = true;
  for (let f = 0; f < maxFrames; f++) {
    step(c);
    if (c.event === 3) clears = false;
    if (c.bounces > 0) return { X: c.X / FX, Y: c.Y / FX, frames: f + 1, clearsNet: clears && !c.netHit };
  }
  return { X: c.X / FX, Y: c.Y / FX, frames: maxFrames, clearsNet: false };
}
