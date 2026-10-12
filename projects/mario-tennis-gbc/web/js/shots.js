// Shot selection — port of the game's aiming / trajectory-table code (REVERSE.md "Aiming and launch").
// Everything is read from the ROM at run time: bank-07 spin/speed rows, the trajectory tables of
// banks 20-24, 2C and 29-2B and their index tables. Units are the game's: positions in world units
// (ball X/Y/Z integer parts), speeds 8.8 px/frame, angles 65536 = one turn (elevation negative = up).
import { COURT } from "./physics.js";

const TURN = 65536, RAD = 2 * Math.PI / TURN;
const s16 = v => (v & 0x8000 ? v - 0x10000 : v);

// 07:5161 handlers: bank-07 row table, spin row stat (D), speed row stat (E), incoming-speed term
// (shift: 2 = -|vy|/4 `52F1`, 3 = -|vy|/8 `531D`, 4 = -3(|vy|>>4) `5301`), charge term scale (`5345` 128, `535C` 64)
const HANDLER = {
  0: { tab: 0x4D31, spin: "Top", speed: "Stroke", v: 2, c: 128 },
  1: { tab: 0x4D81, spin: "Top", speed: "Stroke", v: 2, c: 128 },
  2: { tab: 0x4DD1, spin: "Slice", speed: "Stroke", v: 3, c: 64 },
  3: { tab: 0x4E21, spin: "Slice", speed: "Stroke", v: 3, c: 64 },
  4: { tab: 0x4E71, spin: null, speed: "Stroke", v: 2, c: 128 },
  9: { tab: 0x4EC1, spin: null, speed: "Serve", v: 4, c: 128 },
  8: { tab: 0x4F11, spin: null, speed: "Volley", v: 4 },
  6: { tab: 0x4F61, spin: null, speed: "Volley", v: 2 },
  7: { tab: 0x4FB1, spin: null, speed: "Volley", v: 3 },
  5: { tab: 0x5001, spin: null, speed: "Volley", v: 4 },
  10: { tab: 0x5051, spin: "lobRow", speed: null },
  11: { tab: 0x5061, spin: "dropRow", speed: null },
  12: { tab: 0x5071, spin: "Top", speed: "Serve" },
  13: { tab: 0x50C1, spin: "Slice", speed: "Serve" },
  14: { tab: 0x5111, spin: null, speed: "Serve" },
};
// 07:559E: aim depth past the net per type; 54DE/54ED/54FE adjustments by charge / forward speed
const DEPTH = [0x280, 0x3C0, 0x280, 0x3C0, 0x3C0, 0x3C0, 0x480, 0x380, 0x3C0, 0x440, 0x200, 0x200, 0x2A0, 0x2A0, 0x2A0];
const DEPTH_MINUS_CHARGE = new Set([0, 2, 5, 6, 7, 8, 11]);
// bank handlers: trajectory table + index tables; "fb" = weak-hit fallback 24:57FD
const BANK = {
  0: { bank: 0x22, table: 0x427D, hband: 0x7E98, stat: "Top", statTab: 0x7ED8, size: 6, search: true, fb: true },
  1: { bank: 0x23, table: 0x427D, hband: 0x7E98, stat: "Top", statTab: 0x7ED8, size: 6, search: true, fb: true },
  2: { bank: 0x20, table: 0x427D, hband: 0x7E98, stat: "Slice", statTab: 0x7ED8, size: 6, search: true, fb: true },
  3: { bank: 0x21, table: 0x427D, hband: 0x7E98, stat: "Slice", statTab: 0x7ED8, size: 6, search: true, fb: true },
  4: { bank: 0x24, table: 0x5844, hband: 0x6656, size: 4, search: true, fb: true },
  5: { bank: 0x24, table: 0x6707, hband: 0x7719, size: 4, search: true, fb: true },
  6: { bank: 0x2C, table: 0x4281, hband: 0x7293, size: 4, search: true },
  7: { bank: 0x2C, table: 0x4E81, hband: 0x72E5, size: 6, search: true },
  8: { bank: 0x2C, table: 0x6081, hband: 0x7337, size: 6, search: true },
  10: { bank: 0x24, table: 0x4289, stat: "lobRow", statTab: 0x459C, size: 6, exact: true },
  11: { bank: 0x24, table: 0x45A0, distTab: 0x51B9, stat: "dropRow", statTab: 0x51F9, size: 6, exact: true },
  12: { bank: 0x29, spinTab: 0x5EBF, serveTab: 0x5ED3, hband: 0x5EE7, stat: "Top" },
  13: { bank: 0x2A, spinTab: 0x5EBF, serveTab: 0x5ED3, hband: 0x5EE7, stat: "Slice" },
  14: { bank: 0x2B, spinTab: 0x5EBD, serveTab: 0x5ED1, hband: 0x5EE5, stat: null },
};
const sra = (v, n) => Math.floor(v / (1 << n));        // arithmetic shift of a signed value
const hband = z => ((-z) >> 4) & 0x1F;                   // 424C: height band index from ball Z (negative = up)

// 08:706B: shot type from buttons (1 A, 2 B, 3 A+B) and press variant; volley zone = inside the service line
export function shotType(button, variant, volleyZone) {
  const t = volleyZone ? [8, 8, 8, 4, 8, 6, 11, 4, 8, 10, 7, 4] : [0, 0, 2, 4, 0, 1, 11, 4, 0, 10, 3, 4];
  return t[4 * Math.min(variant, 2) + Math.min(button, 3)];
}

// 07:5876 / 5899: contact height used for the table lookup (and the launch)
export function contactHeight(type, z) {
  if (type === 10 || type === 11) return z + 0x80 < 0 ? z + 0x20 : -0xA0;
  if (type >= 12) return z;
  return z + 0x60 >= 0 ? z - sra(z + 0x60, 1) : z;
}

// 07:55E9 rally aim table: deuce [-416,-224,-36], ad [36,224,416], symmetric [-224,0,224]; minus playerX/16
export function rallyTargetX(rom, posCode, aimDir, playerX, symmetric = false) {
  const base = symmetric ? 0x563E : (posCode & 1 ? 0x5636 : 0x562E);
  const off = rom.s16(0x07, base + 2 * (Math.max(-1, Math.min(1, aimDir)) + 1));
  return off - sra(Math.trunc(playerX), 4);
}

/* ctx: { type, stats {Stroke, Serve, Volley, Top, Slice}, lobRow, dropRow, charge (0-63),
         ball {X, Y, Z, vy} (world units; vy 8.8/frame), player {X, vy (1/256 px/frame), moving (wDF0F bit1)},
         posCode (bit0 ad court, bit1 far end), aimDir (-1..1), mirror (0/1), targetX (optional override) }
   Returns null when the type is not handled, else { speed, elev, heading (game units), top, side,
   launchZ, landing {X, Y}, S, dMin, dMax, iMin, iMax, recAddr, bank, fallback }                       */
export function computeShot(rom, ctx) {
  const h = HANDLER[ctx.type], bk = BANK[ctx.type];
  if (!h) return null;
  const st = ctx.stats, stat = k => k === "lobRow" ? ctx.lobRow | 0 : k === "dropRow" ? ctx.dropRow | 0 : Math.max(0, Math.min(9, st[k] | 0));
  const z = ctx.noAdjust ? ctx.ball.Z : contactHeight(ctx.type, ctx.ball.Z);
  // --- spin and speed rows (07:52A0) ---
  const D = h.spin ? stat(h.spin) : 0, E = h.speed ? stat(h.speed) : 0;
  const top = rom.s16(0x07, h.tab + 8 * D), side0 = rom.s16(0x07, h.tab + 8 * D + 2);
  let side = ctx.mirror ? -side0 : side0;
  let S = rom.u16(0x07, h.tab + 8 * E + 4);
  if (h.v) {                                   // incoming-speed term, always <= 0
    const vy = ctx.ball.vy | 0;
    const t = h.v === 2 ? sra(vy, 2) : h.v === 3 ? sra(vy, 3) : 3 * sra(vy, 4);
    S -= Math.abs(t);
  }
  if (h.c) {                                   // charge term (charge - 32) * c, half scale when negative
    const d = ctx.charge - 32;
    S += d * (d < 0 ? h.c / 2 : h.c);
  }
  if (h.speed) {                               // movement term 52D7: +-playerVy/2 towards the net, -$C00 while running
    const m = sra(ctx.player.vy | 0, 1);
    S += ctx.posCode & 2 ? m : -m;
    if (ctx.player.moving) S -= 0xC00;
    S = Math.max(S, 0x100);
  }
  // --- aim (557E / 571E / 5740) ---
  let depth = DEPTH[ctx.type];
  if (DEPTH_MINUS_CHARGE.has(ctx.type)) depth -= 4 * ctx.charge;
  if (ctx.type === 10) depth += 12 * ctx.charge + sra(ctx.player.vy | 0, 4) * (ctx.posCode & 2 ? 1 : -1);
  const aim = aimAt(rom, ctx, depth);
  const res = { ...aim, S, top, side, launchZ: z, bank: bk && bk.bank, fallback: false };

  // --- smash 24:6696: speed = S, elevation from the height ---
  if (ctx.type === 9) {
    const elev = angleOf(rom, sra(-z * 3, 1), Math.abs(ctx.ball.Y) + aim.dMax) + rom.s16(0x24, 0x66F2 + 2 * stat("Serve"));
    return { ...res, speed: S, elev, heading: aim.heading, landing: landingPoint(ctx, aim.heading, aim.dMax - 256) };
  }
  // --- serves 29-2B:5E9D + 4098 ---
  if (ctx.type >= 12) {
    const b = bk.bank, spin = bk.stat ? stat(bk.stat) : 0;
    const addr = 0x427D + rom.u16(b, bk.spinTab + 2 * spin) + rom.u16(b, bk.serveTab + 2 * stat("Serve")) + rom.u16(b, bk.hband + 2 * hband(z));
    const base = rom.u16(b, addr), elev = rom.s16(b, addr + 2), hoff = rom.s16(b, addr + 4);
    const speed = base + 4 * ((2 * Math.abs(aim.dX) * (base >> 8)) >> 8);
    const heading = (aim.heading + (ctx.mirror ? -hoff : hoff)) & 0xFFFF;
    return { ...res, recAddr: addr, speed, elev, heading, landing: landingPoint(ctx, heading, divSin(rom, Math.abs(ctx.ball.Y) + 0x2C0, heading)) };
  }
  // --- table-driven shots ---
  const b = bk.bank;
  let table = bk.table;
  if (bk.hband) table += rom.u16(b, bk.hband + 2 * hband(z));
  if (bk.distTab) table += rom.u16(b, bk.distTab + 2 * (((Math.round(aim.dist) * 2) >> 8) & 0x1F));
  if (bk.statTab) table += rom.u16(b, bk.statTab + 2 * stat(bk.stat));
  if (bk.exact) {
    const d = Math.min(aim.dist, aim.dMax);
    return launchRecord(rom, b, table + 6 * (Math.floor(d) >> 6), 6, aim, ctx, res, d);
  }
  // search 401F/403E: from record iMin, first record with speed >= S, bounded by iMax
  let i = aim.iMin, addr = table + bk.size * i;
  if (bk.fb && rom.u16(b, addr) >= S) return weakHit(rom, ctx, res, rom.u16(b, addr) - S);
  while (rom.u16(b, addr) < S && i < aim.iMax) { i++; addr += bk.size; }
  return launchRecord(rom, b, addr, bk.size, aim, ctx, res, i * 64);
}

function launchRecord(rom, b, addr, size, aim, ctx, res, dist) {
  const speed = rom.u16(b, addr), elev = rom.s16(b, addr + 2), hoff = size === 6 ? rom.s16(b, addr + 4) : 0;
  const heading = (aim.heading + (ctx.mirror ? -hoff : hoff)) & 0xFFFF;
  return { ...res, recAddr: addr, speed, elev, heading, dist, landing: landingPoint(ctx, aim.heading, dist) };
}

// 24:57FD: the player is too weak for the shortest trajectory -> slower "deficit" tables, re-aimed shorter
function weakHit(rom, ctx, res, deficit) {
  const cat = (deficit >> 8) >> 1;
  let depth = 0x280, tab = cat;
  if (cat === 4) { tab = 3; depth = 0x140; } else if (cat > 4) { tab = 0; depth = 0xE0; }
  const aim = aimAt(rom, ctx, depth);
  const table = 0x51FD + rom.u16(0x24, 0x583C + 2 * tab), d = Math.min(aim.dist, aim.dMax);
  const out = launchRecord(rom, 0x24, table + 6 * (Math.floor(d) >> 6), 6, aim, ctx, { ...res, ...aim, top: 0, side: 0, fallback: true }, d);
  return out;
}

// 07:571E + 5740: target, heading and the landing-distance window [|Y|+$140, |Y|+$480] along the heading
export function aimAt(rom, ctx, depth) {
  const bx = ctx.ball.X, by = ctx.ball.Y;
  const targetY = ctx.posCode & 2 ? depth : -depth;
  const targetX = ctx.targetX !== undefined ? ctx.targetX : rallyTargetX(rom, ctx.posCode, ctx.aimDir, ctx.player.X, ctx.symmetric);
  const dX = targetX - bx, dY = targetY - by;
  const heading = angleOf(rom, dY, dX);
  const dMin = divSin(rom, Math.abs(by) + 0x140, heading);
  let dMax = divSin(rom, Math.abs(by) + 0x480, heading);
  const c = mulCos(rom, dMax, heading), lateral = Math.abs(c);   // 07:57D7: shorten to the sideline (-32) when the line leaves the court
  if (lateral >= 32) {
    const room = Math.abs(bx + (c < 0 ? 1 : -1) * (COURT.singles - 32));
    if (room < lateral) dMax = (Math.floor(dMax * 256 / lateral) * room) >> 8;
  }
  return { targetX, targetY, dX, dY, heading, dMin, dMax, iMin: dMin >> 6, iMax: dMax >> 6, dist: Math.hypot(dX, dY) };
}

// 00:1416 Atan2(HL = y, DE = x): 256*|y|/|x| looked up in the tangent table 00:15E3 (128 entries of
// 128 angle units, binary search from 00:1663) with a half-step refinement; quadrant fix-up afterwards.
export function atan2Rom(rom, y, x) {
  let bc;
  if (y === 0) bc = 0;
  else if (x === 0) bc = 0x4000;
  else {
    const q = Math.floor(Math.abs(y) * 256 / Math.abs(x));
    if (q > 0xFFFF) bc = 0x3FC0;
    else {
      let hl = 0x1663, b = 0;
      for (const step of [0x80, 0x40, 0x20, 0x10, 8, 4, 2]) {
        if (rom.u16(0, hl) < q) { hl += step; b |= step; } else hl -= step;
      }
      if (rom.u16(0, hl) < q) b++;
      hl += 2;
      if (b === 0xFF && rom.u16(0, hl) < q) bc = 0x4000;
      else bc = (b * 64) & 0xFFFF;
    }
  }
  if (x < 0) bc = (0x8000 - bc) & 0xFFFF;
  if (y < 0) bc = (-bc) & 0xFFFF;
  return bc;
}
export const angleOf = (rom, y, x) => atan2Rom(rom, y, x);
// 00:13CE: d / sin(h) through the half-cosecant table (result >> 14), |.| taken by the callers
const divSin = (rom, d, h) => Math.abs((d * rom.u16(0x2D, 0x5000 + 2 * ((h & 0x7FFF) >> 4))) >> 14);
// 00:1340: d*cos(h) through the sine table (2d * sin(h + 90deg) >> 16)
function mulCos(rom, d, h) {
  const a = (h + 0x4000) & 0xFFFF, s = rom.u16(0x2D, 0x4000 + 2 * ((a & 0x7FFF) >> 4));
  const v = (2 * d * s) >> 16;
  return a & 0x8000 ? -v : v;
}
function landingPoint(ctx, heading, dist) {
  return { X: ctx.ball.X + dist * Math.cos(heading * RAD), Y: ctx.ball.Y + dist * Math.sin(heading * RAD) };
}

// convert to physics.launch() arguments
export function toLaunch(r) {
  return { speed: r.speed / 256, elev: -r.elev * RAD, heading: r.heading * RAD, top: r.top, side: r.side };
}
