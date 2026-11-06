// Bank 04's player on the overworld: the player's actor script 04:527A (op $12 -> PlayerWalkControl 04:538C, op $0C
// back) reads the joypad each frame: A asks for an action ($C442), Start for the menu ($C444), B held runs (flag
// #17); the d-pad's facing (04:5500) walks a step at speed $20 ($10 on terrain $0B, $40 running), probing ahead and
// $20 to each side for blocked terrain or an actor in the way (a bump: $C28C / $C443), the step's end checked for a
// trigger or a warp cell (CheckEventAtPoint 04:5360); with no direction it snaps to the $20 grid. Also the actor
// proximity lists ($CAC0) the talk and bump checks use.
import { rb } from "./rom.js";
import * as D from "./render/display.js";
import { mulHLByDE, vectorFromLengthAndAngle } from "./math.js";
import { actorSlotOf, mapTerrainAt, NATIVES } from "./actors.js";

const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
const r16 = (w, a) => rd(w, a) | rd(w, (a + 1) & 0xFFFF) << 8;
const w16 = (w, a, v) => { wr(w, a, v & 0xFF); wr(w, (a + 1) & 0xFFFF, (v >> 8) & 0xFF); };
const testFlag = (w, n) => w.wram[0][0x840 + (n >> 3)] & (0x80 >> (n & 7));
const setFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] |= 0x80 >> (n & 7); };
const clearFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] &= ~(0x80 >> (n & 7)); };
const abs16 = v => (v & 0x8000 ? (-v) & 0xFFFF : v);
const sub16 = (a, b) => (a - b) & 0xFFFF;
const cur = w => w.high[0x1E0] | w.high[0x1E1] << 8;

// 04:5658 BuildNearbyActorList: the player's position -> $C470-$C473; the active (+1), on-screen (+$2F) actors with
// +$17 within 3 tiles of it on each axis (the player included) -> $CAC0, 0-terminated ($C474 counts the 24 slots)
export function buildNearbyActorList(w) {
  const p = r16(w, 0xC290);
  for (let k = 0; k < 4; k++) wr(w, 0xC470 + k, rd(w, (p + 4 + k) & 0xFFFF));
  wr(w, 0xC474, 0x18);
  let hl = 0xCAC0;
  for (let bc = 0xD000; ; bc += 0x40) {
    if (rd(w, bc + 1) && rd(w, bc + 0x2F) && rd(w, bc + 0x17)
      && (abs16(sub16(r16(w, bc + 6), r16(w, 0xC472))) >> 8) < 3
      && (abs16(sub16(r16(w, bc + 4), r16(w, 0xC470))) >> 8) < 3) { w16(w, hl, bc); hl += 2; }
    const n = (rd(w, 0xC474) - 1) & 0xFF;
    wr(w, 0xC474, n);
    if (!n) break;
  }
  w16(w, hl, 0);
}
// 04:56FD BuildActiveActorList: the active, on-screen actors with +$1E -> $CAC0, 0-terminated ($C470 counts)
export function buildActiveActorList(w) {
  wr(w, 0xC470, 0x18);
  let hl = 0xCAC0;
  for (let bc = 0xD000; ; bc += 0x40) {
    if (rd(w, bc + 1) && rd(w, bc + 0x2F) && rd(w, bc + 0x1E)) { w16(w, hl, bc); hl += 2; }
    const n = (rd(w, 0xC470) - 1) & 0xFF;
    wr(w, 0xC470, n);
    if (!n) break;
  }
  w16(w, hl, 0);
}
// 04:55C4 FindActorNear: the point (x hl, y de; kept at $C470-$C473): the slot of the first actor of the $CAC0 list
// within it (each distance under $200, times 8, squared by 00:0CB5 MulHLByDE's high word, the sum under $50); 0
export function findActorNear(w, hl, de) {
  w16(w, 0xC470, hl); w16(w, 0xC472, de);
  for (let p = 0xCAC0; ; p += 2) {
    const bc = r16(w, p);
    if (!(bc >> 8)) return 0;
    const dy = abs16(sub16(r16(w, bc + 6), r16(w, 0xC472)));
    if (dy & 0xFE00) continue;
    const dx = abs16(sub16(r16(w, bc + 4), r16(w, 0xC470)));
    if (dx & 0xFE00) continue;
    const sq = v => mulHLByDE((v << 3) & 0xFFFF, (v << 3) & 0xFFFF);
    if (((sq(dy) + sq(dx)) & 0xFFFF) < 0x50) return actorSlotOf(bc);   // 04:4F7E
  }
}
// 04:551E TerrainBlockedAt: the point's terrain cell (0B:45C9) is $0F
function terrainBlockedAt(w, hl, de) { return (mapTerrainAt(w, hl >> 8, de >> 8) & 0x0F) === 0x0F ? 0x0F : 0; }
// 04:5510 PlayerBlockedAt: blocked terrain (| $80), else an actor's slot there
function playerBlockedAt(w, [hl, de]) {
  const t = terrainBlockedAt(w, hl, de);
  return t ? t | 0x80 : findActorNear(w, hl, de);
}
// 04:52FA PlayerProbePoint: facing a (a $20 step) -> the actor's position + the probe offset (04:52BA walking,
// 04:52DA running: flag #17)
function playerProbePoint(w, bc, a) {
  const t = (testFlag(w, 17) ? 0x52DA : 0x52BA) + (((a >> 3) | (a << 5)) & 0x1C);
  const dx = rb(0x04, t) | rb(0x04, t + 1) << 8, dy = rb(0x04, t + 2) | rb(0x04, t + 3) << 8;
  return [(r16(w, bc + 4) + dx) & 0xFFFF, (r16(w, bc + 6) + dy) & 0xFFFF];
}
// 04:5360 CheckEventAtPoint: the event cell there (0B:461D MapEventAt): type 1 -> wMapEvent $C440 = its id (a
// trigger stepped on), type 3 -> sound $92 and wMapWarpRequest $C441 = its id
export function checkEventAtPoint(w, hl, de, sound) {
  const a = mapEventAt(w, hl >> 8, de >> 8);
  if ((a & 0x0F) === 1) wr(w, 0xC440, a >> 4);
  else if ((a & 0x0F) === 3) { sound(0x92); wr(w, 0xC441, a >> 4); }
}
// 0B:461D MapEventAt (0B:45FF MapEventCellAddr): the WRAM6 $D400 cell of tile (d, e), as MapTerrainAt's $D000
export function mapEventAt(w, d, e) {
  const hl = (0xD400 + ((e & 0xFE) << 4) + ((d & 0x80 ? d | 0xFF00 : d) >> 1 & 0xFF)) & 0xFFFF;
  return w.wram[6][hl - 0xD000];
}

// 04:538C PlayerWalkControl (the native of the player's script; hFFE0 = the player's actor): returns a = 0 (yield)
export function playerWalkControl(w, sound) {
  setW(w, 4);
  buildNearbyActorList(w);
  const bc = cur(w), held = w.high[0x190], pressed = w.high[0x194];
  wr(w, 0xC2AB, 0);
  if (pressed & 1) wr(w, 0xC442, 1);
  if (pressed & 8) wr(w, 0xC444, 1);
  if (held & 2) setFlag(w, 17);
  wr(w, bc + 0x35, held & 0xF0 ? 3 : 1);
  wr(w, 0xC28D, rd(w, 0xC28C));
  wr(w, 0xC28C, 0);
  const f = held & 0xF0 ? rb(0x04, 0x5500 + (held >> 4)) : 0xFF;
  if (!(held & 0xF0)) wr(w, 0xC28E, 0);
  if (f === 0xFF) {                              // 04:54C0: snap to the grid, not walking
    w16(w, bc + 6, (r16(w, bc + 6) + 0x10) & 0xFFE0);
    w16(w, bc + 4, (r16(w, bc + 4) + 0x10) & 0xFFE0);
    wr(w, bc + 0x12, 0);
    return 0;
  }
  wr(w, 0xC28A, f);
  wr(w, bc + 0x32, f);
  wr(w, bc + 0x11, 0x40);
  let speed = (mapTerrainAt(w, rd(w, bc + 5), rd(w, bc + 7)) & 0x0F) === 0x0B ? 0x10 : 0x20;
  if (testFlag(w, 17)) speed = 0x40;
  w16(w, bc + 0x0E, speed);
  let d = 0, move = true;
  if (!testFlag(w, 16)) {
    const r = playerBlockedAt(w, playerProbePoint(w, bc, f));
    if (r) { wr(w, 0xC28C, r); wr(w, 0xC443, 1); move = false; }
    else if (playerBlockedAt(w, playerProbePoint(w, bc, (f + 0x20) & 0xFF))) {
      if (playerBlockedAt(w, playerProbePoint(w, bc, (f + 0xE0) & 0xFF))) move = false;
      else d = 0xE0;
    } else d = playerBlockedAt(w, playerProbePoint(w, bc, (f + 0xE0) & 0xFF)) ? 0x20 : 0;
  }
  if (!move) wr(w, bc + 0x10, f);                // 04:5485
  else {                                         // 04:548F
    const [vx, vy] = vectorFromLengthAndAngle(r16(w, bc + 0x0E), (f + d) & 0xFF);   // 04:5332 ActorPointAtAngle
    const x = (r16(w, bc + 4) + vx) & 0xFFFF, y = (r16(w, bc + 6) + vy) & 0xFFFF;
    checkEventAtPoint(w, x, y, sound);
    w16(w, bc + 0x0C, y); w16(w, bc + 0x0A, x);   // 04:5289 ActorSetTarget
    wr(w, bc + 0x12, 1);
    wr(w, 0xC2AB, 1);
  }
  wr(w, 0xC28E, (rd(w, 0xC28E) + 1) & 0xFF);     // 04:54AE
  if (!rd(w, 0xC28C)) wr(w, 0xC28E, 0);
  clearFlag(w, 17);
  return 0;
}
NATIVES["04:538c"] = (w, sound) => playerWalkControl(w, sound);
