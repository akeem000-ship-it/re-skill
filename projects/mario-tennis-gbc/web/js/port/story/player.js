// The player's walking (bank 4, $4F75-$532C): the pad as an angle, the probes ahead of the player that slide it
// along walls and round other actors, step-on triggers, and the points ahead of an actor the probes use.
// Port of player_04.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm),
// whose routine names these are.
//
// The player's actor runs ActorScript_PlayerControl: `as_call UpdatePlayerControl` every frame. With the d-pad
// held it faces that way and probes the point a step ahead (ActorMoveVectors_04: 8 directions, 3 lengths); if
// that is blocked it tries $20 to either side and slides that way, else walks straight. A blocked probe arms the
// auto-interaction (walking into something talks to it after a while, story_loop.js). Walking (B: running) sets
// the speed $20 ($40); a tile can end the walk on a step-on trigger or exit (CheckTileTriggerAtPoint). With the
// pad released it stands, snapped to the pixel grid.
// Tests: web/tests/port/routines_story.mjs; lockstep on out/engine/rec2.mtrec and out/port/story1.mtrec.
import {
  FZ, FN, FH, FC, WRAM_ACTORS, BANK_ACTORS, BANK_STORY, ACTORF_FLAGS, ACTORF_SPEED, ACTORF_TARGET_X, ACTORF_TARGET_Y,
  ACTORF_X, ACTORF_Y, ACTORF_HEADING, ACTORF_TURN_RATE, ACTORF_FACING, ACTORF_ANIM_SPEED, ACTORFLAG_MOVING,
  FLAG_PLAYER_RUNNING, FLAG_DEBUG_NOCLIP, a16, w8, w16, setBits, clearBits, actorPtr, hook, testFlag, setFlag,
  clearFlag, farcall, addHLFlags,
} from "./common.js";
import { vectorFromLengthAndAngle } from "../home/math.js";
import { buildNearbyActorList, isPointBlocked } from "./actor_queries.js";
import { readBehaviorMapCell } from "./scene_viewer.js";
import { readCollisionMapCell } from "./scene_collision.js";

const BANK = BANK_ACTORS;
const ActorMoveVectors_04 = 0x5072;          // 24 x (dx, dy) words: 8 directions x lengths $120, $140, $110
const DpadMaskToAngleTable_04 = 0x532D;      // per d-pad nibble (right left up down): the angle, $FF none
const PROBE_FIXED_INDEX = 0x40;              // the $110 row
const PADF_A = 0x01, PADF_B = 0x02, PADF_START = 0x08, PAD_DPAD = 0xF0;
const BEHAVIOR_TRIGGER = 0x01, BEHAVIOR_EXIT = 0x03;
const WALK_SPEED = 0x0020, RUN_SPEED = 0x0040, SLOW_SPEED = 0x0010, PLAYER_TURN_RATE = 0x40;
const ANIM_SPEED_STANDING = 1, ANIM_SPEED_DPAD = 3, ANIM_SPEED_WALKING = 2;
const COLLISION_SLOW = 0x0B;                 // a collision kind that would slow the player (the ROM never sees it)
const SNAP_ROUND = 0x0010, SNAP_MASK = 0xE0;

// SetActorMoveTarget (04:5061): actor bc's target = (hl, de). Leaves de = x, hl = bc + 9.
export function setActorMoveTarget(P, actor, x, y) {
  w16(P, actor, ACTORF_TARGET_Y, y);
  w16(P, actor, ACTORF_TARGET_X, x);
  return { de: x, hl: (actor + ACTORF_TARGET_X + 1) & 0xFFFF };
}

// GetPointAheadOfActorFixed (04:50D2) / GetPointAheadOfActorRanged (04:50DC) / IndexPlayerControlTable
// (04:50EA): the point ActorMoveVectors_04[row + octant of angle a] from actor bc: row $40 (fixed), or
// wActorProbeRange * $20. Returns { hl: x, de: y, a }.
export function getPointAheadOfActorFixed(P, actor, angle) {
  return indexPlayerControlTable(P, actor, PROBE_FIXED_INDEX, octantOffset(angle));
}
export function getPointAheadOfActorRanged(P, actor, angle) {
  return indexPlayerControlTable(P, actor, (P.bus.u8(P.A.actorProbeRange) * 0x20) & 0xFF, octantOffset(angle));
}
const octantOffset = angle => (((angle >> 3) | (angle << 5)) & 0x1C);   // rrca x3, and $1C: the octant * 4
export function indexPlayerControlTable(P, actor, a, d) {
  const at = (ActorMoveVectors_04 + ((a + d) & 0xFF)) & 0xFFFF;
  const dx = P.rom.u16(BANK, at), dy = P.rom.u16(BANK, at + 2);
  return { hl: (a16(P, actor, ACTORF_X) + dx) & 0xFFFF, de: (a16(P, actor, ACTORF_Y) + dy) & 0xFFFF, a: dy >> 8 };
}
// ProjectPointFromActor (04:5113): the point hl (a length) along angle a from actor bc. Returns { hl: x, de: y }.
export function projectPointFromActor(P, actor, length, angle) {
  const v = vectorFromLengthAndAngle(P, length, angle);
  const y = (a16(P, actor, ACTORF_Y) + v.de) & 0xFFFF, x = (a16(P, actor, ACTORF_X) + v.hl) & 0xFFFF;
  return { hl: x, de: y, a: v.a, f: addHLFlags(a16(P, actor, ACTORF_X), v.hl, v.f) };
}
// OffsetPointByPolarVector (04:512F): the point (hl, de) moved bc (a length) along angle a. Returns hl = bc = x, de = y.
export function offsetPointByPolarVector(P, x, y, angle, length) {
  const v = vectorFromLengthAndAngle(P, length, angle);
  const nx = (v.hl + x) & 0xFFFF;
  return { hl: nx, bc: nx, de: (y + v.de) & 0xFFFF, a: v.a };
}

// CheckTileTriggerAtPoint (04:5141): the behaviour cell under the point (h, d: tiles) asks for its step-on
// script (wStoryModeTriggerScript) or exit (wStoryModeExitTriggerRequest), the cell's high nibble. Keeps the
// registers.
export function checkTileTriggerAtPoint(P, xTile, yTile) {
  const cell = farcall(P, BANK_STORY, () => readBehaviorMapCell(P, xTile, yTile));
  const kind = cell & 0x0F, id = cell >> 4;
  if (kind === BEHAVIOR_TRIGGER) P.V.storyModeTriggerScript = id;
  else if (kind === BEHAVIOR_EXIT) P.V.storyModeExitTriggerRequest = id;
}

// UpdatePlayerControl (04:516B), the player's as_call: the pad (A: interact, and a step-on trigger under the
// player; START: the menu; B: run), then walking as above. Returns a = 0 (go on next frame) and the registers
// it leaves.
export function updatePlayerControl(P) {
  const { bus, V } = P;
  P.wramBank(WRAM_ACTORS);
  buildNearbyActorList(P);
  const bc = actorPtr(P);
  if (V.inputRisingEdge & PADF_A) {
    V.storyModeInteractRequest = 1;
    checkTileTriggerAtPoint(P, bus.u8(bc + ACTORF_X + 1), bus.u8(bc + ACTORF_Y + 1));
  }
  if (V.inputRisingEdge & PADF_START) V.storyModeMenuRequest = 1;
  if (V.playerInputFlags & PADF_B) setFlag(P, FLAG_PLAYER_RUNNING);
  w8(P, bc, ACTORF_ANIM_SPEED, V.playerInputFlags & PAD_DPAD ? ANIM_SPEED_DPAD : ANIM_SPEED_STANDING);
  bus.w8(P.A.playerMoveAnglePrev, bus.u8(P.A.playerMoveAngleApplied));
  bus.w8(P.A.playerMoveAngleApplied, 0);
  const dpad = V.playerInputFlags & PAD_DPAD;
  if (!dpad) { bus.w8(P.A.playerMoving, 0); return standStill(P, bc); }
  const angle = P.rom.u8(BANK, DpadMaskToAngleTable_04 + (dpad >> 4));
  if (angle === 0xFF) return standStill(P, bc);
  bus.w8(P.A.playerMoveAngle, angle);
  const me = actorPtr(P);
  w8(P, me, ACTORF_FACING, bus.u8(P.A.playerMoveAngle));
  w8(P, me, ACTORF_TURN_RATE, PLAYER_TURN_RATE);
  if (testFlag(P, FLAG_PLAYER_RUNNING)) {
    bus.w8(P.A.actorProbeRange, 1); w16(P, me, ACTORF_SPEED, RUN_SPEED);
  } else {
    farcall(P, BANK_STORY, () => readCollisionMapCell(P, bus.u8(me + ACTORF_X + 1), bus.u8(me + ACTORF_Y + 1)));
    const kind = 0x00;                         // (the ROM loads a = 0 over the cell it read: never slowed)
    if (kind === COLLISION_SLOW) { bus.w8(P.A.actorProbeRange, 2); w16(P, me, ACTORF_SPEED, SLOW_SPEED); }
    else { bus.w8(P.A.actorProbeRange, 0); w16(P, me, ACTORF_SPEED, WALK_SPEED); }
  }
  // probe: null = walk this way (turned by d); a value = blocked (it is the probe's result)
  const move = angle0 => {
    const a = bus.u8(P.A.playerMoveAngle);
    let p = getPointAheadOfActorFixed(P, me, a);
    let r = isPointBlocked(P, p.hl, p.de);
    if (!r.a) {                                 // straight ahead is free: unless both sides are blocked too
      p = getPointAheadOfActorRanged(P, me, (bus.u8(P.A.playerMoveAngle) + 0x20) & 0xFF);
      r = isPointBlocked(P, p.hl, p.de);
      if (!r.a) {
        p = getPointAheadOfActorRanged(P, me, (bus.u8(P.A.playerMoveAngle) + 0xE0) & 0xFF);
        r = isPointBlocked(P, p.hl, p.de);
        if (!r.a) return { turn: 0x00 };
        p = getPointAheadOfActorFixed(P, me, (bus.u8(P.A.playerMoveAngle) + 0x40) & 0xFF);
        r = isPointBlocked(P, p.hl, p.de);
        if (!r.a) return { turn: 0x20 };
        return { face: true, de: p.de };
      }
      p = getPointAheadOfActorRanged(P, me, (bus.u8(P.A.playerMoveAngle) + 0xE0) & 0xFF);
      r = isPointBlocked(P, p.hl, p.de);
      if (r.a) return { blocked: r.a, de: p.de };
      p = getPointAheadOfActorFixed(P, me, (bus.u8(P.A.playerMoveAngle) + 0xC0) & 0xFF);
      r = isPointBlocked(P, p.hl, p.de);
      if (!r.a) return { turn: 0xE0 };
      return { face: true, de: p.de };
    }
    return { blocked: r.a, de: p.de };
  };
  const m = testFlag(P, FLAG_DEBUG_NOCLIP) ? { turn: 0x00 } : move();
  let de;
  if (m.turn !== undefined) {                   // walk: the target a speed's length ahead, turned by m.turn
    const p = projectPointFromActor(P, me, a16(P, me, ACTORF_SPEED), (bus.u8(P.A.playerMoveAngle) + m.turn) & 0xFF);
    checkTileTriggerAtPoint(P, p.hl >> 8, p.de >> 8);
    de = setActorMoveTarget(P, me, p.hl, p.de).de;
    setBits(P, me + ACTORF_FLAGS, ACTORFLAG_MOVING);
    w8(P, me, ACTORF_ANIM_SPEED, ANIM_SPEED_WALKING);
  } else {
    if (m.blocked !== undefined) {               // walked into something: arm the auto-interaction
      bus.w8(P.A.playerMoveAngleApplied, m.blocked);
      V.storyAutoInteractArmed = 1;
    }
    w8(P, me, ACTORF_HEADING, bus.u8(P.A.playerMoveAngle));
    de = m.de;
  }
  const moving = P.A.playerMoving;
  bus.w8(moving, bus.u8(moving) + 1);
  if (!bus.u8(P.A.playerMoveAngleApplied)) bus.w8(moving, 0);
  clearFlag(P, FLAG_PLAYER_RUNNING);
  return { a: 0, f: FZ, bc, de, hl: moving };
}
// UpdatePlayerControl.done: no d-pad: stand, the position snapped to the nearest pixel.
function standStill(P, bc) {
  const me = actorPtr(P);
  const y = ((a16(P, me, ACTORF_Y) + SNAP_ROUND) & 0xFF00) | ((a16(P, me, ACTORF_Y) + SNAP_ROUND) & SNAP_MASK);
  w16(P, me, ACTORF_Y, y);
  const x = ((a16(P, me, ACTORF_X) + SNAP_ROUND) & 0xFF00) | ((a16(P, me, ACTORF_X) + SNAP_ROUND) & SNAP_MASK);
  w16(P, me, ACTORF_X, x);
  clearBits(P, me + ACTORF_FLAGS, ACTORFLAG_MOVING);
  w8(P, me, ACTORF_ANIM_SPEED, ANIM_SPEED_STANDING);
  return { a: 0, f: FZ, bc, de: x & 0xFFFF, hl: (me + ACTORF_ANIM_SPEED) & 0xFFFF };
}

export const HOOKS = [
  [BANK, 0x5061, hook((P, c) => setActorMoveTarget(P, c.bc, c.hl, c.de))],
  [BANK, 0x50D2, hook((P, c) => getPointAheadOfActorFixed(P, c.bc, c.a))],
  [BANK, 0x50DC, hook((P, c) => getPointAheadOfActorRanged(P, c.bc, c.a))],
  [BANK, 0x50EA, hook((P, c) => indexPlayerControlTable(P, c.bc, c.a, c.d))],
  [BANK, 0x5113, hook((P, c) => projectPointFromActor(P, c.bc, c.hl, c.a))],
  [BANK, 0x512F, hook((P, c) => offsetPointByPolarVector(P, c.hl, c.de, c.a, c.bc))],
  [BANK, 0x5141, hook((P, c) => { checkTileTriggerAtPoint(P, c.h, c.d); })],
  [BANK, 0x516B, hook(P => updatePlayerControl(P))],
];
