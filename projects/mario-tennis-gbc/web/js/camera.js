// Exact port of ProjectPoint 00:2D8C and the match camera 08:61DC/6281 (REVERSE.md "Projection and
// camera"). World units in, 1/32-pixel screen units out; the court map is 256x256 px, screen 160x144.
const sra = (v, n) => Math.floor(v / (1 << n));
const tbl = (x, k) => {                       // 2F:4000 / 2F:6000: sign(x) * (((|x| & ~1) * k) >> 16)
  const v = Math.floor((Math.abs(Math.trunc(x)) & ~1) * k / 65536);
  return x < 0 ? -v : v;
};
const mul8x16 = (hl, a) => {                  // 00:0DFA: sign(hl) * ((|hl| * a) >> 8)
  const v = Math.floor(Math.abs(Math.trunc(hl)) * a / 256);
  return hl < 0 ? -v : v;
};
export function project(X, Y, Z = 0) {       // camera tilt 23.76 deg (26368/59904 per 65536), focal 16384
  const P = tbl(Y, 26368) + tbl(Z, 59904), Q = tbl(Y, 59904) - tbl(Z, 26368);
  const s = Math.min(255, Math.floor(128 * 16384 / (16384 - Q)));
  return { xp: 8 * mul8x16(X, s) + 16, pp: 8 * mul8x16(P, s) + 16, Q, s };
}

export class Camera {
  constructor() { this.x = this.tx = 0; this.y = this.ty = -384; }
  startPoint(farServer) { this.x = this.tx = 0; this.y = this.ty = farServer ? -1920 : -384; }   // 08:6199/61AA
  followGround(X, Y) { const p = project(X, Y, 0); this.tx = p.xp; this.ty = p.pp; }           // wC46C/6E while the serve flies
  step() {                                    // 64 units per frame towards the target, snap on overshoot
    const dx = this.tx - this.x, dy = this.ty - this.y;
    if (!dx && !dy) return;
    const a = Math.atan2(dy, dx);
    let nx = this.x + Math.round(64 * Math.cos(a)), ny = this.y + Math.round(64 * Math.sin(a));
    if (dx && Math.sign(this.tx - nx) !== Math.sign(dx)) nx = this.tx;
    if (dy && Math.sign(this.ty - ny) !== Math.sign(dy)) ny = this.ty;
    this.x = nx; this.y = ny;
  }
  scroll() {                                  // 08:6281-6300: hSCX/hSCY and wC478/wC47A
    const sx = Math.max(0, Math.min(0xC00, sra(this.x, 1) + 0x620)) & ~0x1F;
    const sy = (sra(this.y, 2) + sra(this.y, 3) + 0x720) & ~0x1F;
    return { scx: sx >> 5, scy: sy >> 5, offX: 0x1010 - sx, offY: 0x1010 - sy };
  }
  // screen position (pixels, fractional) of a world point with the current scroll
  screen(X, Y, Z = 0) {
    const p = project(X, Y, Z), o = this.scroll();
    return [(o.offX + p.xp) / 32, (o.offY + p.pp) / 32];
  }
}
