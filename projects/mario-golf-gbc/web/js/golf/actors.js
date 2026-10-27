// Bank 04's map actors (the people and objects of the overworld and of the result screens): 24 records of $40 bytes
// in WRAM4 at $D000. ActorsUpdateTask runs each actor's script (a bytecode in a ROM bank: +0 pointer, +2 bank),
// its push velocity, its walk toward a target and the camera that follows it; ActorsDrawTask places each visible
// actor's 16x16 sprite, steps its animation and uploads a new frame's tiles. Record fields as far as used here:
// +0/+2 script and bank, +4/+6 x / y (8.8 tiles), +8 push velocity (up), +$0A/+$0C target, +$0E speed, +$10 facing,
// +$11 turn limit, +$12 walking, +$15 wait, +$16 camera / draw mode (1 the camera follows, 2 drawn), +$17 active,
// +$18 leader (or home tile / per-script data), +$1A flags (bit 0 no script, bit 1 no move), +$1B collision check,
// +$1C push acceleration, +$20 / +$22 frame and animation tables, +$2B bank, +$2C slot, +$2D palette, +$2E draw
// delay, +$2F on screen, +$32 / +$33 facing override, +$37 animate off screen, +$38 VRAM tiles; the character /
// animation code is render/actors.js (04:4D42 ActorSetCharacter, 04:4E51 ActorSetAnim, 04:4ACD ActorAnimStep).
// All access goes through the CPU view (render/display.js rd / wr) with WRAM4 mapped as the ROM maps it.
import { rb } from "./rom.js";
import { mulHLByA, mulHLByDE, divHLByDE, vectorFromLengthAndAngle, vectorFromLengthAndAngleRaw, angleFromVectorCoarse } from "./math.js";
import { advanceRandomSeed } from "./round.js";
import { registerFrameTask } from "./tasks.js";
import * as D from "./render/display.js";
import { actorSetCharacter, actorSetAnim, actorAnimStep } from "./render/actors.js";

const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
const r16 = (w, a) => rd(w, a) | rd(w, (a + 1) & 0xFFFF) << 8;
const w16 = (w, a, v) => { wr(w, a, v & 0xFF); wr(w, (a + 1) & 0xFFFF, (v >> 8) & 0xFF); };
const far = (bank, a) => rb(a < 0x4000 ? 0 : bank, a & 0xFFFF);                 // 00:0611 FarReadByte
const farWord = (bank, a) => far(bank, a) | far(bank, (a + 1) & 0xFFFF) << 8;   // 00:0626 FarReadWord
const sub16 = (a, b) => (a - b) & 0xFFFF;                                        // 00:08AC SubDEFromHL
const neg8 = v => (-v) & 0xFF;
const testFlag = (w, n) => w.wram[0][0x840 + (n >> 3)] & (0x80 >> (n & 7));
const cur = w => w.high[0x1E0] | w.high[0x1E1] << 8;                            // hFFE0: the actor being run
const setCur = (w, p) => { w.high[0x1E0] = p & 0xFF; w.high[0x1E1] = p >> 8; };
const f = (w, n) => (cur(w) + n) & 0xFFFF;                                       // ($FFE0) + n (16-bit)

// ---- bank 0A helpers ----
export function actorSlotAddr(a) {               // 0A:42E0 ActorSlotAddr: $FF -> 0; $18 and up -> $D000
  if (a === 0xFF) return 0;
  return a >= 0x18 ? 0xD000 : 0xD000 + ((a << 6) & 0xFFFF);
}
export function actorSetPos(w, a, bc, de) {      // 0A:43C6 ActorSetPos: x bc, y de; not walking; leaves WRAM4 mapped
  if (a === 0xFF) return;
  setCur(w, actorSlotAddr(a));
  setW(w, 4);
  w16(w, f(w, 4), bc); w16(w, f(w, 6), de);      // 0A:43F5 ActorCopyPos (from a copy on the stack)
  wr(w, f(w, 0x12), 0);
}
export function actorSetFacing(w, a, b) {        // 0A:4644 ActorSetFacing: +$10 = b; leaves WRAM4 mapped
  if (a === 0xFF) return;
  setCur(w, actorSlotAddr(a));
  setW(w, 4);
  wr(w, f(w, 0x10), b);
}

// ---- allocation and set-up ----
export function actorsInit(w) {                  // 04:410D ActorsInit (leaves WRAM4 mapped)
  setW(w, 4);
  D.clearMemory16(w, 0xD000, 0x60);
  D.inBank(w, 0x04, () => {
    registerFrameTask(w, 0x0A, 0x04, 0x4234);    // ActorsUpdateTask
    registerFrameTask(w, 0x05, 0x04, 0x4B69);    // ActorsDrawTask
  });
  wr(w, 0xC289, 0); wr(w, 0xDA00, 0);
}

// 04:4139 ActorAlloc: the first free record (+1 = 0) -> its address (0: none): slot +$2C, tiles +$38 = $8000 + slot x
// $40, +$11 = $10, speed $20, position $0800 / $0800 (two random numbers drawn and dropped), +$18 / +$19 = the
// position's tiles; then ActorSetScript (de, bank a)
export function actorAlloc(w, de, a) {
  let hl = 0xD000;
  for (let c = 0x18; c; c--, hl += 0x40) {
    if (rd(w, hl + 1)) continue;
    const slot = 0x18 - c;
    wr(w, hl + 0x2C, slot);
    w16(w, hl + 0x38, 0x8000 + (slot << 6));
    wr(w, hl + 0x11, 0x10);
    wr(w, hl + 0x0E, 0x20); wr(w, hl + 0x0F, 0);
    advanceRandomSeed(w); w16(w, hl + 4, 0x0800);
    advanceRandomSeed(w); w16(w, hl + 6, 0x0800);
    wr(w, hl + 0x18, rd(w, hl + 5));
    wr(w, hl + 0x19, rd(w, hl + 7));
    actorSetScript(w, hl, de, a);
    return hl;
  }
  return 0;
}
export function actorSetScript(w, hl, de, a) {   // 04:41DA ActorSetScript
  if (!(hl >> 8)) return;
  w16(w, hl, de); wr(w, hl + 2, a);
}
export function actorSetField16(w, hl, a) {      // 04:41EA ActorSetField16
  if (hl >> 8) wr(w, hl + 0x16, a);
}
export function actorSetLeader(w, hl, de) {      // 04:41FC ActorSetLeader (+$18: an 8-bit add on l)
  if (!(hl >> 8)) return;
  const p = (hl & 0xFF00) | ((hl + 0x18) & 0xFF);
  wr(w, p, de & 0xFF); wr(w, (p + 1) & 0xFFFF, de >> 8);
}
export function loadActorPalettes(w) {           // 04:4D2B LoadActorPalettes: OBJ palettes 4-7 from 04:4D0B
  if (w.vram) D.inBank(w, 0x04, () => D.loadPalettesMasterOnly(w, 0x4D0B, 0x0C, 0x04));
}
export function actorSlotOf(hl) {                // 04:4F7E ActorSlotOf
  return hl >> 8 ? (((hl - 0xD000) & 0xFFFF) << 2 >> 8) & 0xFF : 0xFF;
}
export function actorSetPosHLDE(w, bc, hl, de) { // 04:4F92 ActorSetPosHLDE: position and target
  if (!(bc >> 8)) return;
  w16(w, bc + 6, de); w16(w, bc + 0x0C, de);
  w16(w, bc + 4, hl); w16(w, bc + 0x0A, hl);
}
// 04:4FBE TestSpawnFlag: de = flag number (00:2D10 TestGameFlag on de << 5); the ROM's z = spawn: a plain flag spawns the
// actor while the flag is clear, one with bit 15 while it is set
function testSpawnFlag(w, de) {
  const n = (de << 5 & 0xFFFF) >> 5;
  const set = !!testFlag(w, n);                  // 00:2D10 TestGameFlag
  return de & 0x8000 ? set : !set;
}

// 04:4FFB ActorSpawn: hl = a 12-byte record in bank a (read through the mapped bank): script, x, y, flag (0: always),
// (a byte), facing, animation, character; returns the actor (0 when none was free or the flag says no)
export function actorSpawn(w, a, read) {
  setW(w, 4);
  const de = read(0) | read(1) << 8;
  const bc = actorAlloc(w, de, a);
  if (!(bc >> 8)) return bc;
  wr(w, bc + 4, read(2)); wr(w, bc + 5, read(3));
  wr(w, bc + 0x0A, read(2)); wr(w, bc + 0x0B, read(3));
  wr(w, bc + 6, read(4)); wr(w, bc + 7, read(5));
  wr(w, bc + 0x0C, read(4)); wr(w, bc + 0x0D, read(5));
  const flag = read(6) | read(7) << 8;
  if (flag && !testSpawnFlag(w, flag)) return bc;
  wr(w, bc + 0x10, read(9));
  const anim = read(10);
  actorSetCharacter(w, bc, read(11));            // 04:4D42
  actorSetAnim(w, bc, anim);                     // 04:4E51
  wr(w, bc + 0x17, 1); wr(w, bc + 0x1E, 1); wr(w, bc + 0x16, 2);
  wr(w, bc + 0x2E, rd(w, bc + 0x2C) & 0x0F);
  return bc;
}

// 04:5084 SpawnActorList: hl = a list of 12-byte records in bank a, ending at a record whose byte 8 is $FF (each
// is copied to wMapRecord $C400 first, 00:0654 FarCopyBytes)
export function spawnActorList(w, a, hl) {
  for (;; hl = (hl + 0x0C) & 0xFFFF) {
    for (let k = 0; k < 0x0C; k++) wr(w, 0xC400 + k, far(a, hl + k));
    if (rd(w, 0xC408) === 0xFF) return;
    actorSpawn(w, a, k => rd(w, 0xC400 + k));
  }
}

// 04:510A SpawnPlayerActor: hl / de = position, c = facing: the player's actor (records 04:50FE by wCharId $C810 & 3)
// -> wPlayerActor $C290 (slot $C296, facing $C28A), and a second actor chasing it (script 04:5106) -> $C292 / $C297
export function spawnPlayerActor(w, hl, de, c) {
  setW(w, 4);
  const rec = farWord(0x04, 0x50FE + ((rd(w, 0xC810) & 3) << 1));
  const p = actorSpawn(w, 0x04, k => far(0x04, rec + k));
  w16(w, 0xC290, p);
  wr(w, 0xC296, actorSlotOf(p));
  wr(w, p + 0x10, c);
  wr(w, 0xC28A, c);
  actorSetPosHLDE(w, p, hl, de);
  const q = actorAlloc(w, 0x5106, 0x04);
  actorSetField16(w, q, 1);
  actorSetLeader(w, q, r16(w, 0xC290));
  actorSetPosHLDE(w, q, hl, de);
  w16(w, 0xC292, q);
  wr(w, 0xC297, actorSlotOf(q));
}

// ---- 04:4234 ActorsUpdateTask ----
// the native code actor scripts call (op $12), by "bb:aaaa": fn(w, sound) -> a (player.js adds the player's)
export const NATIVES = {};
export function actorsUpdateTask(w, natives = NATIVES, sound = () => {}) {
  setW(w, 4);
  for (let p = 0xD000, c = 0x18; c; c--, p += 0x40) {
    if (!rd(w, p + 1)) continue;
    setCur(w, p);
    if (!(rd(w, p + 0x1A) & 1)) {
      if (rd(w, p + 0x15)) wr(w, p + 0x15, rd(w, p + 0x15) - 1);
      else runScript(w, p, natives, sound);
    }
    pushVelocity(w, p);
    if (rd(w, p + 0x1A) & 2) continue;
    if (rd(w, p + 0x12)) walk(w, p);
    followCamera(w, p);
  }
  const pl = r16(w, 0xC290);
  if (pl >> 8) {
    wr(w, 0xC2A0, rd(w, pl + 4)); wr(w, 0xC2A1, rd(w, pl + 5));
    wr(w, 0xC2A2, rd(w, pl + 6)); wr(w, 0xC2A3, rd(w, pl + 7));
    wr(w, 0xC2A4, rd(w, pl + 0x29));
  }
}

function runScript(w, p, natives, sound) {           // the opcode loop (return point 04:4288 ActorsUpdateOpReturn)
  for (;;) {
    let bc = r16(w, p);
    const d = rd(w, p + 2);
    const op = far(d, bc);
    const h = OPS[op];
    if (!h) throw new Error(`actor script op $${op.toString(16)} (~04:420C ActorScriptOpcodeTable) is not ported (script ${d.toString(16)}:${bc.toString(16)})`);
    const r = h(w, bc, d, natives, sound);
    w16(w, p, r.bc);
    if (!r.a) return;
  }
}

function pushVelocity(w, p) {                    // 04:4299: +8 += +$1C + $10 while it stays negative
  let de = r16(w, p + 0x1C), hl = r16(w, p + 8);
  if (!(hl | de)) return;
  de = (de + 0x10) & 0xFFFF;
  hl = (hl + de) & 0xFFFF;
  if (!(hl & 0x8000)) { w16(w, p + 8, 0); w16(w, p + 0x1C, 0); }
  else { w16(w, p + 0x1C, de); w16(w, p + 8, hl); }
}

function walk(w, p) {                            // 04:42F2: turn toward the target (limit +$11), step by speed +$0E
  const dx = sub16(r16(w, p + 4), r16(w, p + 0x0A));
  const dy = sub16(r16(w, p + 6), r16(w, p + 0x0C));
  const ang = (angleFromVectorCoarse(dy, dx, a => rb(0, a)) + 0x80) & 0xFF;   // 00:0A7B
  let c = rd(w, p + 0x10);
  let b = (ang - c) & 0xFF;
  let a = b & 0x80 ? neg8(b) : b;
  if (a >= 0x60) {
    c = (c + 0x80) & 0xFF;
    b = neg8((0x80 - b) & 0xFF);
    a = b & 0x80 ? neg8(b) : b;
  }
  const d = rd(w, p + 0x11);
  if (a < d) a = b;
  else a = b & 0x80 ? neg8(d) : d;
  const face = (a + c) & 0xFF;
  wr(w, p + 0x10, face);
  const [vx, vy] = vectorFromLengthAndAngleRaw(r16(w, p + 0x0E), face);   // 00:0B31
  if (rd(w, p + 0x1B)) {
    if (pointNearPlayer(w, (r16(w, p + 4) + vx) & 0xFFFF, (r16(w, p + 6) + vy) & 0xFFFF)) return;
  }
  let bits = 0;
  const cmask = ((ang + 0x20) & 0x40) ? 2 : 1;
  const ny = (r16(w, p + 6) + vy) & 0xFFFF;
  w16(w, p + 6, ny);
  const ry = sub16(ny, r16(w, p + 0x0C));
  if (!ry) bits |= 2;
  if ((ry ^ dy) & 0x8000) bits |= 2;
  const nx = (r16(w, p + 4) + vx) & 0xFFFF;
  w16(w, p + 4, nx);
  const rx = sub16(nx, r16(w, p + 0x0A));
  if (!rx) bits |= 1;
  if ((rx ^ dx) & 0x8000) bits |= 1;
  if (!(bits & cmask)) return;
  wr(w, p + 0x12, 0);
  for (let k = 0; k < 4; k++) wr(w, p + 4 + k, rd(w, p + 0x0A + k));
}

// 04:554D PointNearPlayer: the point (x hl, y de) within sqrt($C0) / 8 of the player actor's target (+$0A / +$0C):
// each distance (absolute, under $200) times 8, squared (00:0CB5 MulHLByDE: the high 16 bits), summed, below $C0
function pointNearPlayer(w, hl, de) {
  const p = r16(w, 0xC290);
  const dist = (t, v) => { const d = sub16(t, v); return d & 0x8000 ? (-d) & 0xFFFF : d; };
  const dy = dist(r16(w, p + 0x0C), de);
  if (dy & 0xFE00) return 0;
  const dx = dist(r16(w, p + 0x0A), hl);
  if (dx & 0xFE00) return 0;
  const sq = v => mulHLByDE((v << 3) & 0xFFFF, (v << 3) & 0xFFFF);
  return ((sq(dx) + sq(dy)) & 0xFFFF) < 0xC0 ? 1 : 0;
}
// 0B:45C9 MapTerrainAt (0B:45AB MapTerrainCellAddr): the WRAM6 $D000 cell of tile (d, e): 32 x 32 cells of 2 x 2
// tiles (d >> 1 taken arithmetically: a tile $80 and up reads before the row)
export function mapTerrainAt(w, d, e) {
  const hl = (0xD000 + ((e & 0xFE) << 4) + ((d & 0x80 ? d | 0xFF00 : d) >> 1 & 0xFF)) & 0xFFFF;
  return w.wram[6][hl - 0xD000];
}
// 04:551E TerrainBlockedAt: the point's terrain cell is $0F (low nibble)
function terrainBlockedAt(w, hl, de) {
  const a = mapTerrainAt(w, hl >> 8, de >> 8) & 0x0F;
  return a === 0x0F ? 0x0F : 0;
}
// 04:534E PointAddPolar: the point + VectorFromLengthAndAngle(bc, a)
function pointAddPolar(hl, de, a, bc) {
  const [x, y] = vectorFromLengthAndAngle(bc, a);   // 00:0AF2
  return [(hl + x) & 0xFFFF, (de + y) & 0xFFFF];
}
// 04:552F TileInHomeArea: home (b x, c y), half size (h, l), tile (d, e): 0 inside, $FF outside
function tileInHomeArea(b, c, h, l, d, e) {
  if (((b - 1 - h) & 0xFF) >= d || ((b - 1 + h) & 0xFF) < d) return 0xFF;
  if (((c - 1 - l) & 0xFF) >= e || ((c - 1 + l) & 0xFF) < e) return 0xFF;
  return 0;
}
// 04:47A2 ActorOpWander: while the actor is on screen (+$2F), up to 4 tries: a random heading (the facing + $E0..$1F,
// to $10 steps: $C28F), the point a tile ahead (04:5332 ActorPointAtAngle) inside the home box (+$18 / +$19, 2
// tiles) and clear of blocked terrain $E0 further at the heading and at +-$20: the target (04:5289 ActorSetTarget),
// walking, the next opcode; else the facing turns $41 and the next try; after 4 (or off screen) it yields
function opWander(w, bc) {
  const p = cur(w);
  for (let e = 4; e; e--) {
    if (!rd(w, p + 0x2F)) return { a: 0, bc };
    const a = (((advanceRandomSeed(w) & 0x3F) - 0x20 + rd(w, p + 0x10)) & 0xF0);
    wr(w, 0xC28F, a);
    const [vx, vy] = vectorFromLengthAndAngle(0x100, a);   // 04:5332 ActorPointAtAngle
    const x = (r16(w, p + 4) + vx) & 0xFFFF, y = (r16(w, p + 6) + vy) & 0xFFFF;
    let ok = !tileInHomeArea(rd(w, p + 0x19), rd(w, p + 0x18), 2, 2, x >> 8, y >> 8);
    for (const t of [0, 0x20, 0xE0]) if (ok && terrainBlockedAt(w, ...pointAddPolar(x, y, (a + t) & 0xFF, 0xE0))) ok = false;
    if (ok) {
      w16(w, p + 0x0C, y); w16(w, p + 0x0A, x);   // 04:5289 ActorSetTarget
      wr(w, p + 0x12, 1);
      return { a: 1, bc: (bc + 1) & 0xFFFF };
    }
    wr(w, p + 0x10, (rd(w, p + 0x10) + 0x41) & 0xFF);
  }
  return { a: 0, bc };
}

function followCamera(w, p) {                    // 04:4439: the camera on the actor with +$16 = 1 (unless $DA00)
  if (rd(w, p + 0x16) !== 1 || rd(w, 0xDA00)) return;
  const clamp = (v, lo, hi) => {
    let h = v >> 8, l = v & 0xFF;
    if (((h - lo) & 0xFF) & 0x80) { h = lo; l = 0; }
    else if (!(((h - hi) & 0xFF) & 0x80)) { h = hi; l = 0; }
    return [l & 0xE0, h];
  };
  const [xl, xh] = clamp((r16(w, p + 4) + 0xF610) & 0xFFFF, rd(w, 0xC329), (rd(w, 0xC32B) - 0x14) & 0xFF);
  wr(w, 0xC320, xl); wr(w, 0xC321, xh);
  const [yl, yh] = clamp((r16(w, p + 6) + 0xF510) & 0xFFFF, rd(w, 0xC32A), (rd(w, 0xC32C) - 0x12) & 0xFF);
  wr(w, 0xC322, yl); wr(w, 0xC323, yh);
}

// the script opcodes (ActorScriptOpcodeTable 04:420C): (bc = the opcode's address, d = bank) -> { a: go on, bc }
const OPS = {
  0x00: (w, bc) => ({ a: 0, bc }),               // 04:45C1 ActorOpEnd
  0x01: (w, bc, d) => {                          // 04:45C3 ActorOpWait n
    bc = (bc + 1) & 0xFFFF;
    wr(w, f(w, 0x15), (far(d, bc) - 1) & 0xFF);
    return { a: 0, bc: (bc + 1) & 0xFFFF };
  },
  0x02: (w, bc) => {                             // 04:45D8 ActorOpWaitMove
    const a = (rd(w, f(w, 0x12)) & 1) ^ 1;
    return { a, bc: a ? (bc + 1) & 0xFFFF : bc };
  },
  0x03: (w, bc, d) => {                          // 04:45E9 ActorOpSetPos x y
    for (let k = 0; k < 4; k++) wr(w, f(w, 4 + k), far(d, bc + 1 + k));
    wr(w, f(w, 0x12), 0);
    return { a: 1, bc: (bc + 5) & 0xFFFF };
  },
  0x04: (w, bc, d) => {                          // 04:4679 ActorOpWalkTo x y
    for (let k = 0; k < 4; k++) wr(w, f(w, 0x0A + k), far(d, bc + 1 + k));
    wr(w, f(w, 0x12), 1);
    return { a: 1, bc: (bc + 5) & 0xFFFF };
  },
  0x06: (w, bc, d) => {                          // 04:46A2 ActorOpWalkBy dx dy
    w16(w, f(w, 0x0A), (r16(w, f(w, 4)) + farWord(d, bc + 1)) & 0xFFFF);
    w16(w, f(w, 0x0C), (r16(w, f(w, 6)) + farWord(d, bc + 3)) & 0xFFFF);
    wr(w, f(w, 0x12), 1);
    return { a: 1, bc: (bc + 5) & 0xFFFF };
  },
  0x07: (w, bc, d) => walkAngle(w, (bc + 1) & 0xFFFF, d, 0),   // 04:46FB ActorOpWalkAngle
  0x08: (w, bc, d) => walkAngle(w, (bc + 1) & 0xFFFF, d, rd(w, f(w, 0x10))),   // 04:4756 ActorOpWalkTurn
  0x09: (w, bc) => opWander(w, bc),              // 04:47A2 ActorOpWander
  0x0B: (w, bc) => {                             // 04:48FC ActorOpChase
    const ld = r16(w, f(w, 0x18));
    const x = r16(w, ld + 4), y = r16(w, ld + 6);
    wr(w, f(w, 0x11), 0x40);
    w16(w, f(w, 0x0C), y); w16(w, f(w, 0x0A), x);
    if (actorHasTarget(w)) {
      const ax = Math.abs(((rd(w, f(w, 0x0B)) - rd(w, f(w, 5))) << 24) >> 24) & 0xFF;
      const ay = Math.abs(((rd(w, f(w, 0x0D)) - rd(w, f(w, 7))) << 24) >> 24) & 0xFF;
      const hl = (mulHLByA(ax, ax) + mulHLByA(ay, ay)) & 0xFFFF;
      let de = 0x80;
      if (!(hl >> 8)) { const l = hl & 0xFF; de = l < 1 ? 0x10 : l < 4 ? 0x18 : l < 9 ? 0x20 : l < 0x10 ? 0x40 : 0x80; }
      w16(w, f(w, 0x0E), de);
      wr(w, f(w, 0x12), 1);
    }
    return { a: 0, bc: (bc + 1) & 0xFFFF };
  },
  0x0C: (w, bc, d) => {                          // 04:49A2 ActorOpJump ofs
    bc = (bc + 1) & 0xFFFF;
    return { a: 1, bc: (bc + farWord(d, bc)) & 0xFFFF };
  },
  0x0D: (w, bc, d) => setField(w, bc, d, false), // 04:49B1 ActorOpSetField
  0x0E: (w, bc, d) => setField(w, bc, d, true),  // 04:49EC ActorOpAddField
  0x0F: (w, bc) => ({ a: 1, bc: (bc + 1) & 0xFFFF }),   // 04:4A57 (a no-op)
  0x10: (w, bc, d) => {                          // 04:4A5B ActorOpSetAnim (04:4E4C ActorSetAnimChecked)
    const a = far(d, bc + 1);
    const p = cur(w);
    if (p >> 8) actorSetAnim(w, p, a);
    return { a: 1, bc: (bc + 2) & 0xFFFF };
  },
  0x11: (w, bc) => ({ a: 1, bc: (bc + 2) & 0xFFFF }),   // 04:4A71 ActorOpSkipByte
  0x12: (w, bc, d, natives, sound) => {               // 04:4A7C ActorOpCallNative (00:015E CallHLInBankA)
    const addr = farWord(d, bc + 1), key = `${d.toString(16).padStart(2, "0")}:${addr.toString(16).padStart(4, "0")}`;
    const fn = natives[key];
    if (!fn) throw new Error(`actor script native ${key} is not ported`);
    const a = D.inBank(w, d, () => fn(w, sound));
    return { a: a & 0xFF, bc: (bc + 3) & 0xFFFF };
  },
  0x13: (w, bc) => {                             // 04:476C ActorOpSetHome (returns a = the low byte of +$1B's address)
    wr(w, f(w, 0x18), rd(w, f(w, 7)));
    wr(w, f(w, 0x19), rd(w, f(w, 5)));
    wr(w, f(w, 0x0E), 8); wr(w, f(w, 0x0F), 0);
    wr(w, f(w, 0x1B), 1);
    return { a: (w.high[0x1E0] + 0x1B) & 0xFF, bc: (bc + 1) & 0xFFFF };
  },
};
function walkAngle(w, bc, d, add) {
  const ang = (far(d, bc) + add) & 0xFF;
  const len = farWord(d, bc + 1);
  const [x, y] = vectorFromLengthAndAngle(len, ang);   // 00:0AF2
  w16(w, f(w, 0x0A), (r16(w, f(w, 4)) + x) & 0xFFFF);
  w16(w, f(w, 0x0C), (r16(w, f(w, 6)) + y) & 0xFFFF);
  wr(w, f(w, 0x12), 1);
  return { a: 1, bc: (bc + 3) & 0xFFFF };
}
function setField(w, bc, d, add) {               // ActorFieldSizeTable 04:4A31: 2, 1 or 0 bytes; the field at ($FFE0) + n (8-bit)
  const n = far(d, bc + 1), v = farWord(d, bc + 2);
  const p = (w.high[0x1E1] << 8) | ((w.high[0x1E0] + n) & 0xFF);
  const size = rb(0x04, 0x4A31 + n);
  if (size === 2) w16(w, p, add ? (r16(w, p) + v) & 0xFFFF : v);
  else if (size === 1) wr(w, p, add ? (rd(w, p) + v) & 0xFF : v);
  return { a: 1, bc: (bc + 4) & 0xFFFF };
}
function actorHasTarget(w) {                     // 04:4A8D ActorHasTarget
  for (let k = 0; k < 4; k++) if (rd(w, f(w, 4 + k)) !== rd(w, f(w, 0x0A + k))) return true;
  return false;
}

// ---- 04:4B69 ActorsDrawTask ----
export function actorsDrawTask(w, sound = () => {}) {
  if (testFlag(w, 20)) return;
  setW(w, 4);
  const shake = v => ((v & 0x80 ? v | 0xFF00 : v) << 5) & 0xFFFF;
  w16(w, 0xC29A, (r16(w, 0xC320) + shake(rd(w, 0xC368))) & 0xFFFF);
  w16(w, 0xC29C, (r16(w, 0xC322) + shake(rd(w, 0xC369))) & 0xFFFF);
  wr(w, 0xC288, 0x18);
  for (let p = 0xD000; ; p += 0x40) {
    draw: {
      if (!rd(w, p + 1) || rd(w, p + 0x16) !== 2) break draw;
      if (rd(w, p + 0x2E)) { wr(w, p + 0x2E, rd(w, p + 0x2E) - 1); break draw; }
      wr(w, 0xC286, rd(w, p + 0x2B));            // wActorBank
      wr(w, p + 0x2F, 0);
      let cy = r16(w, 0xC29C);
      const up = r16(w, p + 8);
      if (up & 0x8000) cy = (cy + (((-up) & 0xFFFF) >> 1)) & 0xFFFF;   // 00:0C60 NegHL
      let y = (sub16(r16(w, p + 6), cy) + 0x90) & 0xFFFF;
      let onScreen = (y >> 8) < 0x14;
      let x = 0;
      if (onScreen) {
        wr(w, 0xC285, ((y << 3) >> 8) & 0xFF);
        x = (sub16(r16(w, p + 4), r16(w, 0xC29A)) + 0x10) & 0xFFFF;
        onScreen = (((x >> 8) + 1) & 0xFF) < 0x16;
      }
      if (!onScreen) {
        if (rd(w, p + 0x37)) actorAnimStep(w, p - 0xD000, sound);
        break draw;
      }
      wr(w, 0xC284, ((x << 3) >> 8) & 0xFF);
      wr(w, p + 0x2F, 1);
      if (w.vram) D.queueSprite16(w, rd(w, 0xC285), rd(w, 0xC284), (rd(w, p + 0x2C) << 2) & 0xFF, rd(w, p + 0x2D));   // 00:26A4
      const c = actorAnimStep(w, p - 0xD000, sound);   // 04:4ACD
      if (!rd(w, p + 0x33)) wr(w, p + 0x32, rd(w, p + 0x10));
      const b = rb(0x04, 0x4ABD + ((((rd(w, p + 0x32) + 8) & 0xFF) >> 4) & 0x0F));   // FacingFrameTable 04:4ABD
      if (rd(w, p + 0x28) === c && rd(w, p + 0x29) === b) break draw;
      wr(w, p + 0x29, b); wr(w, p + 0x28, c);
      actorCopyFrameTiles(w, rd(w, 0xC286), r16(w, p + 0x20), r16(w, p + 0x38), c, b);
    }
    const n = (rd(w, 0xC288) - 1) & 0xFF;
    wr(w, 0xC288, n);
    if (!n) return;
  }
}

// 26:4012 ActorCopyFrameTiles (the same code at 4012 in banks 20-26): hROMBank = a (left so: the far call
// restores it), the word [hl + 2c] + b queued to VRAM de (4 blocks)
export function actorCopyFrameTiles(w, a, hl, de, c, b) {
  const src = (farWord(a, (hl + ((c << 1) & 0xFF)) & 0xFFFF) + b) & 0xFFFF;
  D.inBank(w, a, () => D.queueVRAMCopy(w, src, de, 4));
}
