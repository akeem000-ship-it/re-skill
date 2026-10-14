// Questions about the overworld and the actors, and drawing one actor (bank 4, $533D-$5769): is a point blocked
// (by terrain, or by a solid actor near the player), is it in a box, is it near the player, which actor stands
// there; the lists of nearby solid actors and of talkable actors those queries walk; drawing an actor's sprite
// with its jump height, running its animation script, choosing the facing it shows and queueing its frame's
// tiles; and the waits for an actor's jump or walk to end.
// Port of actor_queries_04.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm),
// whose routine names these are.
//
// An actor's animation script (in its walk-sprite bank): words [frame, delay]; [$FF, n]: go to the script's
// start + n; [$FE, n]: start animation n; any other [$F0-$FD, _]: hold the frame for ever. The delay counts down
// by the actor's animation speed (ACTORF_ANIM_SPEED, or ACTORF_ANIM_SPEED_MOVING while it walks). Its frame's
// tiles (4, by its drawn facing) go to its VRAM slot when the frame or the facing changes.
// Tests: web/tests/port/routines_story.mjs; lockstep on out/engine/rec2.mtrec and out/port/story1.mtrec.
import {
  FZ, FN, FH, FC, WRAM_ACTORS, BANK_ACTORS, BANK_STORY, wActors, ACTOR_SIZE, NUM_ACTORS, ACTORF_FLAGS,
  ACTORF_TARGET_X, ACTORF_TARGET_Y, ACTORF_X, ACTORF_Y, ACTORF_HEIGHT, ACTORF_JUMP_VEL, ACTORF_HEADING,
  ACTORF_ANIM_SPEED, ACTORF_ANIM_SPEED_MOVING, ACTORF_GFX_BANK, ACTORF_FRAME_TABLE, ACTORF_VRAM_DEST,
  ACTORF_ANIM_BASE, ACTORF_ANIM_PTR, ACTORF_ANIM_DELAY, ACTORF_STATUS, ACTORF_DRAWN_FACING, ACTORF_ANIM_FRAME,
  ACTORF_FACING, ACTORF_FACING_COUNT, ACTORF_TILE, ACTORFLAG_SOLID, ACTORFLAG_TALKABLE, ACTORFLAG_MOVING,
  ACTORSTATUS_FACING_LOCKED, ACTORSTATUS_ANIM_HELD, ACTORSTATUS_ANIM_OFFSCREEN, ACTORSTATUS_FRAME_DIRTY,
  ACTORSTATUS_LIVE, FLAG_ACTORS_FROZEN, a8, a16, w8, w16, setBits, clearBits, hook, hookGen, testFlag, farcall,
  advanceFrame, cpFlags, subFlags, zf, addFlags, incFlags, addHLFlags, bitFlags, pushWord, dropWords,
} from "./common.js";
import { farReadWord } from "../home/palettes.js";
import { getSquareOfByte } from "../home/math.js";
import { queueSprite16 } from "../home/fade.js";
import { queueVRAMCopyFromBank } from "../home/memory.js";
import { setActorAnimation } from "./scripted.js";
import { readCollisionMapCell } from "./scene_collision.js";

const BANK = BANK_ACTORS;
const DirectionToFacing_04 = 0x56B3;          // 16 sectors of the facing angle -> FACE_*
const NEAR_PLAYER_LIMIT = 0x4000;             // squared half-tile distance under $C000 counts as near
const ACTOR_AT_POINT_LIMIT = 0x1F00;          // squared distance under $E100 (1/256 tiles, low bytes)
const NEARBY_TILES_MASK = 0xFE;               // within 2 tiles on both axes
const TERRAIN_BLOCKED = 0x80;
const OAM_PAGE_END = 0xA0;
const SCREEN_Y_BIAS = 0x0090, SCREEN_X_BIAS = 0x0010, SCREEN_ROWS = 0x14, SCREEN_COLUMNS = 0x16;
const ANIM_LOOP = 0xFF, ANIM_SET = 0xFE, ANIM_COMMANDS = 0xF0, ANIM_FOREVER = 0xFF;
const FRAME_TILE_BLOCKS = 4;
const JUMP_WAIT_FRAMES = 0xB4, MOVE_WAIT_FRAMES = 0x0258;
const neg16 = v => (-v) & 0xFFFF, abs16 = v => (v & 0x8000 ? neg16(v) : v);

// IsPointBlocked (04:533D): terrain at (hl, de) (a = its kind | $80), else the solid actor there (a = its slot
// index, FindActorAtPoint), else 0.
export function isPointBlocked(P, x, y) {
  const t = isTerrainBlockedAtPoint(P, x, y);
  if (t.a) { const a = t.a | TERRAIN_BLOCKED; return { a, f: zf(a) }; }
  return findActorAtPoint(P, x, y);
}
// IsTerrainBlockedAtPoint (04:534B): a = $0F when the collision cell under (hl, de) is solid ($F), else 0 (a
// kind of 0 is walkable; the ROM treats every kind but $F as walkable). Keeps de.
export function isTerrainBlockedAtPoint(P, x, y) {
  const kind = farcall(P, BANK_STORY, () => readCollisionMapCell(P, x >> 8, y >> 8)) & 0x0F;
  if (!kind) return { a: 0, f: FZ | FH };
  if (kind === 0x0F) return { a: kind, f: FZ | FN };
  return { a: 0, f: FZ };
}
// TestPointInBox (04:535C): a = 0 when the tile (d, e) lies within h columns and l rows of (b, c) (strictly, by
// the ROM's 8-bit compares of b - 1 -/+ h), else $FF. home = b << 8 | c.
export function testPointInBox(P, home, x, y, halfW, halfD) {
  const b = home >> 8, c = home & 0xFF;
  let a = (b - 1 - halfW) & 0xFF;
  if (a >= x) return { a: 0xFF, f: cpFlags(a, x) };
  a = (b - 1 + halfW) & 0xFF;
  if (a < x) return { a: 0xFF, f: cpFlags(a, x) };
  a = (c - 1 - halfD) & 0xFF;
  if (a >= y) return { a: 0xFF, f: cpFlags(a, y) };
  a = (c - 1 + halfD) & 0xFF;
  if (a < y) return { a: 0xFF, f: cpFlags(a, y) };
  return { a: 0, f: FZ };
}
// IsPointNearPlayer (04:537A): a = 1 when (hl, de) is near the player's walk target: the squared distance in
// half-tile units (each axis under 256 half tiles) under $C000. Keeps bc, de, hl.
export function isPointNearPlayer(P, x, y) {
  const { bus } = P;
  const dy = abs16((bus.u16(wActors + ACTORF_TARGET_Y) - y) & 0xFFFF) >> 1;
  if (dy >> 8) return { a: 0, f: FZ };
  const dx = abs16((bus.u16(wActors + ACTORF_TARGET_X) - x) & 0xFFFF) >> 1;
  if (dx >> 8) return { a: 0, f: FZ };
  const sum = getSquareOfByte(dy) + getSquareOfByte(dx);
  if (sum > 0xFFFF || (sum & 0xFFFF) + NEAR_PLAYER_LIMIT > 0xFFFF) return { a: 0, f: FZ };
  return { a: 1, f: FZ };          // (Z left from the `and a` before the squares)
}
// FindActorAtPoint (04:53D7): the first actor of wNearbyActorList within reach of (hl, de) (both axes' distance
// under 256, the sum of their squares under $E100): its slot index in a, else 0. The point is kept in
// wActorQueryPointX/Y. Keeps bc, de, hl.
export function findActorAtPoint(P, x, y) {
  const { bus } = P;
  bus.w16(P.A.actorQueryPointX, x); bus.w16(P.A.actorQueryPointY, y);
  for (let hl = P.A.nearbyActorList; ; hl += 2) {
    const bc = bus.u16(hl);
    if (!(bc >> 8)) return { a: 0, f: FZ | FH };
    const dy = abs16((a16(P, bc, ACTORF_Y) - bus.u16(P.A.actorQueryPointY)) & 0xFFFF);
    if (dy >> 8) continue;
    const sy = getSquareOfByte(dy);
    const dx = abs16((a16(P, bc, ACTORF_X) - bus.u16(P.A.actorQueryPointX)) & 0xFFFF);
    if (dx >> 8) continue;
    const sum = getSquareOfByte(dx) + sy;
    if (sum > 0xFFFF || (sum & 0xFFFF) + ACTOR_AT_POINT_LIMIT > 0xFFFF) continue;
    return actorSlotPtrToIndex(bc);
  }
}
// BuildNearbyActorList (04:5456): wNearbyActorList = the drawn, solid actors within 2 tiles of the player (on
// both axes), ended by a null word. Keeps the registers.
export function buildNearbyActorList(P) {
  const { bus } = P;
  let hl = P.A.nearbyActorList;
  for (let n = 0, bc = wActors; n < NUM_ACTORS; n++, bc += ACTOR_SIZE) {
    if (!bus.u8((bc & 0xFF00) | ((bc + 1) & 0xFF))) continue;
    if (!(bus.u8(bc + ACTORF_STATUS) & ACTORSTATUS_LIVE)) continue;
    if (!(bus.u8(bc + ACTORF_FLAGS) & ACTORFLAG_SOLID)) continue;
    if (abs16((a16(P, bc, ACTORF_Y) - bus.u16(wActors + ACTORF_Y)) & 0xFFFF) >> 8 & NEARBY_TILES_MASK) continue;
    if (abs16((a16(P, bc, ACTORF_X) - bus.u16(wActors + ACTORF_X)) & 0xFFFF) >> 8 & NEARBY_TILES_MASK) continue;
    bus.w16(hl, bc); hl += 2;
  }
  bus.w16(hl, 0);
}
// BuildActorQueryList (04:54D7): wNearbyActorList = the drawn, talkable actors. Keeps the registers.
export function buildActorQueryList(P) {
  const { bus } = P;
  let hl = P.A.nearbyActorList;
  for (let n = 0, bc = wActors; n < NUM_ACTORS; n++, bc += ACTOR_SIZE) {
    if (!bus.u8((bc & 0xFF00) | ((bc + 1) & 0xFF))) continue;
    if (!(bus.u8(bc + ACTORF_STATUS) & ACTORSTATUS_LIVE)) continue;
    if (!(bus.u8(bc + ACTORF_FLAGS) & ACTORFLAG_TALKABLE)) continue;
    bus.w16(hl, bc); hl += 2;
  }
  bus.w16(hl, 0);
}
// ActorSlotPtrToIndex (04:5514): the slot index (0-23) of record hl; $FF for a null pointer.
export function actorSlotPtrToIndex(hl) {
  if (!(hl >> 8)) return { a: 0xFF, f: FZ | FN };
  const x = (hl + 0x3000) & 0xFFFF, y = (x << 1) & 0xFFFF, z = (y << 1) & 0xFFFF;
  return { a: z >> 8, f: (y & 0x0800 ? FH : 0) | (y & 0x8000 ? FC : 0) };
}

// DrawAndAnimateActor (04:5526): draw actor bc; if it is on screen, run its animation, choose its facing and
// queue its frame's tiles; off screen it animates only if status bit 3 says so. Returns the registers it leaves.
export function drawAndAnimateActor(P, actor) {
  let r = drawActorSprite(P, actor);
  const status = actor + ACTORF_STATUS;
  if (P.bus.u8(status) & ACTORSTATUS_LIVE) {
    r = { ...r, ...advanceActorAnimation(P, actor, r.de) };
    r = { ...r, ...updateActorFacingFromHeading(P, actor, r.de) };
    return { ...r, ...queueActorFrameTileCopy(P, actor, r.de) };
  }
  if (!(P.bus.u8(status) & ACTORSTATUS_ANIM_OFFSCREEN)) return { ...r, hl: status, f: FZ | FH };
  return { ...r, ...advanceActorAnimation(P, actor, r.de) };
}
// DrawActorSprite (04:5542): queue actor bc's 16x16 sprite at its place on screen (raised by half its jump
// height), unless it is off screen; status bit 7 says whether it was drawn. Returns the registers it leaves.
export function drawActorSprite(P, actor) {
  const { bus } = P;
  clearBits(P, actor + ACTORF_STATUS, ACTORSTATUS_LIVE);
  let originY = bus.u16(P.A.actorScreenOriginY), height = a16(P, actor, ACTORF_HEIGHT), hl;
  if (height & 0x8000) {                                    // in the air: the sprite raised by half the height
    originY = (neg16(height) >> 1) + neg16(originY) & 0xFFFF;
    hl = (a16(P, actor, ACTORF_Y) - originY) & 0xFFFF;
  } else hl = (a16(P, actor, ACTORF_Y) + originY) & 0xFFFF;
  hl = (hl + SCREEN_Y_BIAS) & 0xFFFF;
  if ((hl >> 8) >= SCREEN_ROWS) return { a: hl >> 8, f: cpFlags(hl >> 8, SCREEN_ROWS), de: SCREEN_Y_BIAS, hl };
  const y = ((hl << 3) & 0xFFFF) >> 8;                       // (d is SCREEN_Y_BIAS's high byte, 0, from here)
  hl = (a16(P, actor, ACTORF_X) + bus.u16(P.A.actorScreenOriginX) + SCREEN_X_BIAS) & 0xFFFF;
  const col = ((hl >> 8) + 1) & 0xFF;
  if (col >= SCREEN_COLUMNS) return { a: col, f: cpFlags(col, SCREEN_COLUMNS), de: y, hl };
  const x = ((hl << 3) & 0xFFFF) >> 8;
  const index = P.V.spriteQueueIndex;
  const q = queueSprite16(P, a8(P, actor, ACTORF_TILE + 1), a8(P, actor, ACTORF_TILE), x, y);
  setBits(P, actor + ACTORF_STATUS, ACTORSTATUS_LIVE);
  // f: Z when QueueSprite16 stopped with the OAM page full at or after its first sprite (its `cp $a0`), then
  // H and C of the `add hl, bc` to the status field
  const full = index === OAM_PAGE_END || index + 4 === OAM_PAGE_END;
  return { a: q.a, f: addHLFlags(ACTORF_STATUS, actor, full ? FZ : 0), de: x << 8 | y, hl: actor + ACTORF_STATUS };
}
// AdvanceActorAnimation (04:55C1): run actor bc's animation script (above) while no frame is waiting; the frame
// shown goes to ACTORF_ANIM_FRAME (marking the frame dirty when it changes). de: the registers' de at the call
// (d is passed on). Returns the registers it leaves.
export function advanceActorAnimation(P, actor, de = 0) {
  const { bus } = P;
  let d = de >> 8, e = de & 0xFF;
  const held = bus.u8(actor + ACTORF_STATUS) & ACTORSTATUS_ANIM_HELD;
  let fromScript = false;
  if (!held && !a8(P, actor, ACTORF_ANIM_DELAY)) {
    for (;;) {
      const cmd = farReadWord(P, a8(P, actor, ACTORF_GFX_BANK), a16(P, actor, ACTORF_ANIM_PTR));
      e = cmd & 0xFF; d = cmd >> 8;
      if (e < ANIM_COMMANDS) {                              // a frame: show it for d frames
        w8(P, actor, ACTORF_ANIM_DELAY, d);
        w16(P, actor, ACTORF_ANIM_PTR, a16(P, actor, ACTORF_ANIM_PTR) + 2);
        fromScript = true;
        break;
      }
      if (e === ANIM_LOOP) { w16(P, actor, ACTORF_ANIM_PTR, a16(P, actor, ACTORF_ANIM_BASE) + d); continue; }
      if (e === ANIM_SET) { setActorAnimation(P, actor, d); continue; }
      w8(P, actor, ACTORF_ANIM_DELAY, ANIM_FOREVER);         // any other command: hold
      break;
    }
  }
  if (!fromScript) e = a8(P, actor, ACTORF_ANIM_FRAME);
  const speed = a8(P, actor, bus.u8(actor + ACTORF_FLAGS) & ACTORFLAG_MOVING ? ACTORF_ANIM_SPEED_MOVING : ACTORF_ANIM_SPEED);
  const delay = a8(P, actor, ACTORF_ANIM_DELAY);
  w8(P, actor, ACTORF_ANIM_DELAY, delay >= speed ? delay - speed : 0);
  const frameAt = actor + ACTORF_ANIM_FRAME, old = bus.u8(frameAt);
  if (old === e) return { a: old, f: FZ | FN, de: d << 8 | e, hl: frameAt };
  bus.w8(frameAt, e);
  setBits(P, actor + ACTORF_STATUS, ACTORSTATUS_FRAME_DIRTY);
  return { a: old, f: addHLFlags(ACTORF_STATUS, actor, cpFlags(old, e)), de: d << 8 | e, hl: actor + ACTORF_STATUS };
}
// UpdateActorFacingFromHeading (04:5673): unless locked, the facing follows the heading; the facing shown is
// FACE_* of its 16th of a turn (or FACE_RIGHT for a one-facing object); a change marks the frame dirty.
// Returns the registers it leaves (d = the facing shown; e is passed on).
export function updateActorFacingFromHeading(P, actor, de = 0) {
  const { bus } = P;
  if (!(bus.u8(actor + ACTORF_STATUS) & ACTORSTATUS_FACING_LOCKED)) w8(P, actor, ACTORF_FACING, a8(P, actor, ACTORF_HEADING));
  let d = 0;
  if (a8(P, actor, ACTORF_FACING_COUNT) !== 1) {
    const sector = (((a8(P, actor, ACTORF_FACING) + 8) & 0xFF) >> 4) & 0x0F;
    d = P.rom.u8(BANK, DirectionToFacing_04 + sector);
  }
  const at = actor + ACTORF_DRAWN_FACING, old = bus.u8(at), de2 = d << 8 | (de & 0xFF);
  if (old === d) return { a: old, f: FZ | FN, de: de2, hl: at };
  bus.w8(at, d);
  setBits(P, actor + ACTORF_STATUS, ACTORSTATUS_FRAME_DIRTY);
  return { a: old, f: addHLFlags(ACTORF_STATUS, actor, cpFlags(old, d)), de: de2, hl: actor + ACTORF_STATUS };
}
// QueueActorFrameTileCopy (04:56C3): when actor bc's frame is dirty (and the actors are not frozen), queue its
// frame e's tiles for the facing d (an offset into the frame's tiles) to its VRAM slot, from its walk-sprite
// bank. Returns the registers it leaves.
export function queueActorFrameTileCopy(P, actor, de) {
  const { bus } = P;
  if (testFlag(P, FLAG_ACTORS_FROZEN)) return { f: FH };
  const status = actor + ACTORF_STATUS;
  if (!(bus.u8(status) & ACTORSTATUS_FRAME_DIRTY)) return { hl: status, f: FZ | FH };
  clearBits(P, status, ACTORSTATUS_FRAME_DIRTY);
  const d = de >> 8, e = de & 0xFF, bank = bus.u8(P.A.actorScriptBank);
  const table = a16(P, actor, ACTORF_FRAME_TABLE), entry = (table + ((e * 2) & 0xFF)) & 0xFFFF;
  const frame = farReadWord(P, bank, entry);
  const src = (frame + d) & 0xFFFF;
  const zFlag = ((frame & 0xFF) + d) > 0xFF ? zf((frame >> 8) + 1) : zf(frame + d);
  const f = addHLFlags(0x26, actor, zFlag);
  const r = queueVRAMCopyFromBank(P, bus.u8(P.A.actorScriptBank), src, a16(P, actor, ACTORF_VRAM_DEST), FRAME_TILE_BLOCKS);
  const { b, c, bc, ...rest } = r;
  return { ...rest, f };
}

// IsActorJumping (04:5703): NZ when actor hl is in the air (height or jump velocity not 0); a = their OR. A null
// hl returns Z. WRAM bank 4.
export function isActorJumping(P, actor, f = 0) {
  if (!(actor >> 8)) return { jumping: false, f: FZ | FN | (f & FC) };
  P.wramBank(WRAM_ACTORS);
  const v = a16(P, actor, ACTORF_JUMP_VEL), h = a16(P, actor, ACTORF_HEIGHT);
  const a = (h & 0xFF) | (h >> 8) | (v >> 8) | (v & 0xFF);
  return { jumping: a !== 0, a, f: zf(a) };
}
// WaitActorJumpDone (04:5726): wait (up to $B4 frames) until actor hl has landed. Keeps the registers.
export function* waitActorJumpDone(P, actor) {
  const cpu = P.cpu;
  pushWord(P, cpu.a << 8 | cpu.f); pushWord(P, cpu.bc);          // (push af, push bc)
  for (let c = JUMP_WAIT_FRAMES; c > 0; c--) {
    if (!isActorJumping(P, actor).jumping) break;
    yield* advanceFrame(P);
  }
  dropWords(P, 2);
}
// IsActorMoving (04:5738): a = 1 (NZ) while actor hl walks (flags bit 7). A null hl returns Z. WRAM bank 4.
export function isActorMoving(P, actor, f = 0) {
  if (!(actor >> 8)) return { moving: false, f: FZ | FN | (f & FC) };
  P.wramBank(WRAM_ACTORS);
  const at = (actor + ACTORF_FLAGS) & 0xFFFF, carry = (actor & 0xFF) + ACTORF_FLAGS > 0xFF ? FC : 0;
  const moving = (P.bus.u8(at) & ACTORFLAG_MOVING) !== 0;
  return { moving, a: moving ? 1 : 0, f: bitFlags(moving, carry) };
}
// WaitActorMoveDone (04:5755): wait (up to $258 frames) until actor hl stands. Keeps the registers.
export function* waitActorMoveDone(P, actor) {
  const cpu = P.cpu;
  pushWord(P, cpu.a << 8 | cpu.f); pushWord(P, cpu.bc);          // (push af, push bc)
  for (let bc = MOVE_WAIT_FRAMES; bc > 0; bc--) {
    if (!isActorMoving(P, actor).moving) break;
    yield* advanceFrame(P);
  }
  dropWords(P, 2);
}

export const HOOKS = [
  [BANK, 0x533D, hook((P, c) => isPointBlocked(P, c.hl, c.de))],
  [BANK, 0x534B, hook((P, c) => isTerrainBlockedAtPoint(P, c.hl, c.de))],
  [BANK, 0x535C, hook((P, c) => testPointInBox(P, c.bc, c.d, c.e, c.h, c.l))],
  [BANK, 0x537A, hook((P, c) => isPointNearPlayer(P, c.hl, c.de))],
  [BANK, 0x53D7, hook((P, c) => findActorAtPoint(P, c.hl, c.de))],
  [BANK, 0x5456, hook(P => { buildNearbyActorList(P); })],
  [BANK, 0x54D7, hook(P => { buildActorQueryList(P); })],
  [BANK, 0x5514, hook((P, c) => actorSlotPtrToIndex(c.hl))],
  [BANK, 0x5526, hook((P, c) => drawAndAnimateActor(P, c.bc))],
  [BANK, 0x5542, hook((P, c) => drawActorSprite(P, c.bc))],
  [BANK, 0x55C1, hook((P, c) => advanceActorAnimation(P, c.bc, c.de))],
  [BANK, 0x5673, hook((P, c) => updateActorFacingFromHeading(P, c.bc, c.de))],
  [BANK, 0x56C3, hook((P, c) => queueActorFrameTileCopy(P, c.bc, c.de))],
  [BANK, 0x5703, hook((P, c) => { const { jumping, ...r } = isActorJumping(P, c.hl, c.f); return r; })],
  [BANK, 0x5726, hookGen((P, c) => waitActorJumpDone(P, c.hl))],
  [BANK, 0x5738, hook((P, c) => { const { moving, ...r } = isActorMoving(P, c.hl, c.f); return r; })],
  [BANK, 0x5755, hookGen((P, c) => waitActorMoveDone(P, c.hl))],
];
