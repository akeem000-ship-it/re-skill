// The overworld actor engine's slots and its per-frame update (bank 4, $4032-$4401): clearing the 24 actor
// records, spawning an actor into the first free slot, setting its script, position and mode, the three movers
// the engine attaches (the player's controller, the waypoint follower, the step mover), and the UpdateActors
// frame task: each live actor runs its script, falls back to the ground after a jump, walks toward its target
// and, if the camera follows it, moves the camera.
// Port of actor_slots_04.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm),
// whose routine names these are. The actor model is in common.js.
// Tests: web/tests/port/routines_story.mjs; lockstep on out/engine/rec2.mtrec and out/port/story1.mtrec.
import {
  FZ, FN, FH, FC, WRAM_ACTORS, wActors, ACTOR_SIZE, NUM_ACTORS, ACTORF_SCRIPT, ACTORF_SCRIPT_BANK, ACTORF_WAIT,
  ACTORF_FLAGS, ACTORF_SPEED, ACTORF_TARGET_X, ACTORF_TARGET_Y, ACTORF_X, ACTORF_Y, ACTORF_HEIGHT, ACTORF_JUMP_VEL,
  ACTORF_HEADING, ACTORF_TURN_RATE, ACTORF_LEADER, ACTORF_MODE, ACTORF_VRAM_DEST, ACTORF_TILE, ACTORF_STATUS,
  ACTORF_DRAWN_FACING, ACTORFLAG_PAUSED, ACTORFLAG_PATH, ACTORFLAG_SOLID, ACTORFLAG_TALKABLE, ACTORFLAG_BLOCKED,
  ACTORFLAG_MOVING, ACTORFLAG_FROZEN, ACTORSTATUS_FACING_LOCKED, ACTOR_MODE_CAMERA,
  a8, a16, w8, w16, setBits, clearBits, actorPtr, setActorPtr, hook, addFlags, decFlags, BANK_ACTORS,
} from "./common.js";
import { clearMemory16, copyMemoryBC } from "../home/memory.js";
import { registerFrameTask } from "../home/colorfade.js";
import { angleFromVectorCoarse, vectorFromLengthAndAngleRaw } from "../home/math.js";
import { farReadByte } from "../home/palettes.js";
import { updateCameraIfActorIsCameraTarget, runActorScriptOp } from "./actor_ops.js";
import { isPointNearPlayer } from "./actor_queries.js";

const BANK = BANK_ACTORS;
const VRAM_ACTOR_TILES = 0xB000;        // vTiles2 + VRAM_BANK1: added to a slot's address, gives its 4 tiles' slot
const ACTOR_SPAWN_TURN_RATE = 0x10, ACTOR_SPAWN_SPEED = 0x0020, MOVER_TURN_RATE = 0x40;
const ACTOR_MODE_CAMERA_FOLLOWER = 1;
// the scripts the engine installs (bank 4)
export const ActorScript_Idle = 0x41D1, ActorScript_PlayerControl = 0x41D2;
export const ActorScript_FollowWaypoints = 0x41D8, ActorScript_StepToTarget = 0x41DC;
export const ActorScript_Deactivate = 0x41E2;
export const UpdateActors = 0x41E7, DrawActors = 0x4A82;
const UPDATE_ACTORS_PRIORITY = 0x10, DRAW_ACTORS_PRIORITY = 0x01;

// `inc b / dec b / ret z`: the flags of the null test of an actor pointer bc (C kept)
const nullTestFlags = (b, f) => (b === 0 ? FZ : 0) | FN | (((b + 1) & 0x0F) === 0 ? FH : 0) | (f & FC);

// ClearActorSlots (04:4032): all 24 records zeroed (WRAM bank 4 left mapped).
export function clearActorSlots(P) {
  P.wramBank(WRAM_ACTORS);
  const hl = clearMemory16(P, wActors, (NUM_ACTORS * ACTOR_SIZE) / 16);
  return { a: 0, c: 0, hl, f: FZ | FN };
}

// InitActorEngine (04:4041): clear the slots and start the two frame tasks, UpdateActors (priority $10) and
// DrawActors (1), in this bank. sp: the stack pointer at the call (RegisterFrameTask builds its entry below it).
export function initActorEngine(P, sp) {
  clearActorSlots(P);
  registerFrameTask(P, UPDATE_ACTORS_PRIORITY, UpdateActors, sp - 2);
  return registerFrameTask(P, DRAW_ACTORS_PRIORITY, DrawActors, sp - 2);
}

// SpawnActor (04:4055): take the first free slot (script pointer high byte 0) for script hl in bank a: its VRAM
// tile slot, mode 0, turn rate $10, speed $20, then the script. Returns the slot in bc (0: none free). WRAM bank 4.
export function spawnActor(P, bank, script) {
  P.wramBank(WRAM_ACTORS);
  let slot = wActors;
  for (let n = NUM_ACTORS; n > 0; n--, slot += ACTOR_SIZE) {
    if (P.bus.u8(slot + 1)) continue;
    const dest = (slot + VRAM_ACTOR_TILES) & 0xFFFF;
    w16(P, slot, ACTORF_VRAM_DEST, dest);
    w8(P, slot, ACTORF_TILE, ((slot << 4) & 0xFFFF) >> 8);
    w8(P, slot, ACTORF_MODE, 0);
    w8(P, slot, ACTORF_TURN_RATE, ACTOR_SPAWN_TURN_RATE);
    w16(P, slot, ACTORF_SPEED, ACTOR_SPAWN_SPEED);
    initActorSlotFields(P, slot, bank, script);
    return slot;
  }
  return 0;
}

// SetActorScript (04:40AC): actor bc (0: none) runs script hl in bank a from now (its wait cleared). Returns f.
export function setActorScript(P, actor, bank, script, f = 0) {
  const b = actor >> 8;
  if (b) initActorSlotFields(P, actor, bank, script);
  return nullTestFlags(b, f);
}
// InitActorSlotFields (04:40AF): the script pointer, its bank and a zero wait. WRAM bank 4.
export function initActorSlotFields(P, actor, bank, script) {
  P.wramBank(WRAM_ACTORS);
  w16(P, actor, ACTORF_SCRIPT, script);
  w8(P, actor, ACTORF_SCRIPT_BANK, bank);
  w8(P, actor, ACTORF_WAIT, 0);
}

// SetActorPosition (04:40C6): put actor bc at (hl, de) and make that its target (it stands). Returns f.
export function setActorPosition(P, actor, x, y, f = 0) {
  const b = actor >> 8;
  if (b) {
    P.wramBank(WRAM_ACTORS);
    w16(P, actor, ACTORF_Y, y); w16(P, actor, ACTORF_TARGET_Y, y);
    w16(P, actor, ACTORF_X, x); w16(P, actor, ACTORF_TARGET_X, x);
  }
  return nullTestFlags(b, f);
}
// Unused_04_SetActorTarget (04:40F4): the target alone. Its pops are out of order (af, hl, de for pushes af, de,
// hl), so it returns with af = the caller's hl, hl = the caller's de, de = the caller's af. Nothing calls it.
export function unusedSetActorTarget(P, actor, x, y, a, f) {
  const b = actor >> 8, ff = nullTestFlags(b, f);
  if (!b) return { f: ff };
  P.wramBank(WRAM_ACTORS);
  w16(P, actor, ACTORF_TARGET_Y, y); w16(P, actor, ACTORF_TARGET_X, x);
  return { a: x >> 8, f: x & 0xF0, hl: y, de: a << 8 | ff };
}
// Unused_04_SetActorTargetRelative (04:4114): the target at the position + (hl, de); the same pops.
export function unusedSetActorTargetRelative(P, actor, dx, dy, a, f) {
  const b = actor >> 8, ff = nullTestFlags(b, f);
  if (!b) return { f: ff };
  P.wramBank(WRAM_ACTORS);
  w16(P, actor, ACTORF_TARGET_Y, a16(P, actor, ACTORF_Y) + dy);
  w16(P, actor, ACTORF_TARGET_X, a16(P, actor, ACTORF_X) + dx);
  return { a: dx >> 8, f: dx & 0xF0, hl: dy, de: a << 8 | ff };
}
// SetActorMode (04:4148): actor bc's mode = d (0 inactive, 1 the camera follows it, 2 drawn). Returns f.
export function setActorMode(P, actor, mode, f = 0) {
  const b = actor >> 8;
  if (b) { P.wramBank(WRAM_ACTORS); w8(P, actor, ACTORF_MODE, mode); }
  return nullTestFlags(b, f);
}

// AttachActorControllerScript (04:415B): actor bc becomes the pad-controlled player (ActorScript_PlayerControl in
// the bank mapped now): no longer solid or talkable, its facing locked. Returns f.
export function attachActorControllerScript(P, actor, f = 0) {
  const b = actor >> 8;
  if (b) {
    setActorScript(P, actor, P.V.romBank, ActorScript_PlayerControl);
    clearBits(P, actor + ACTORF_FLAGS, ACTORFLAG_SOLID);
    clearBits(P, actor + ACTORF_FLAGS, ACTORFLAG_TALKABLE);
    setBits(P, actor + ACTORF_STATUS, ACTORSTATUS_FACING_LOCKED);
  }
  return nullTestFlags(b, f);
}
// AttachActorWaypointFollower (04:417B): actor bc walks after actor de (the camera follows it). Returns f.
export function attachActorWaypointFollower(P, actor, leader, f = 0) {
  const b = actor >> 8;
  if (b) {
    P.wramBank(WRAM_ACTORS);
    w16(P, actor, ACTORF_LEADER, leader);
    setActorScript(P, actor, P.V.romBank, ActorScript_FollowWaypoints);
    w8(P, actor, ACTORF_MODE, ACTOR_MODE_CAMERA_FOLLOWER);
    w8(P, actor, ACTORF_TURN_RATE, MOVER_TURN_RATE);
  }
  return nullTestFlags(b, f);
}
// AttachActorStepMover (04:41A6): actor bc trails actor de a step behind (the doubles partner): not solid nor
// talkable. The leader is written in the WRAM bank mapped at the call (SetActorScript maps bank 4 after).
export function attachActorStepMover(P, actor, leader, f = 0) {
  const b = actor >> 8;
  if (b) {
    w16(P, actor, ACTORF_LEADER, leader);
    setActorScript(P, actor, P.V.romBank, ActorScript_StepToTarget);
    clearBits(P, actor + ACTORF_FLAGS, ACTORFLAG_SOLID);
    w8(P, actor, ACTORF_TURN_RATE, MOVER_TURN_RATE);
    clearBits(P, actor + ACTORF_FLAGS, ACTORFLAG_TALKABLE);
  }
  return nullTestFlags(b, f);
}

// UpdateActors (04:41E7), a frame task: every live actor (hActorPtr = it) runs its script, its jump, its walk
// and moves the camera if it is the camera's; then the player's position and facing are copied out to
// wStoryModePlayersXPosition / wStoryModePlayerFacing. Returns the registers it leaves.
export function updateActors(P) {
  P.wramBank(WRAM_ACTORS);
  for (let n = 0, actor = wActors; n < NUM_ACTORS; n++, actor += ACTOR_SIZE) {
    if (!P.bus.u8(actor + 1)) continue;
    setActorPtr(P, actor);
    stepActorScript(P, actor);
    updateActorJumpPhysics(P, actor);
    advanceActorTowardTarget(P, actor);
    updateCameraIfActorIsCameraTarget(P, actor);
  }
  copyMemoryBC(P, wActors + ACTORF_X, P.A.storyModePlayersXPosition, 4);
  const a = P.bus.u8(wActors + ACTORF_DRAWN_FACING);
  P.V.storyModePlayerFacing = a;
  return { a, bc: 0, de: P.A.storyModePlayersXPosition + 4, hl: wActors + ACTORF_X + 4, f: FZ | FN };
}

// StepActorScript (04:4229): run actor bc's script for this frame, unless it is paused (flags bit 0) or waiting
// (its wait counts down instead). Opcodes run one after another while their handler returns a != 0; the script
// pointer is stored after each. The script's bank is kept in wActorScriptBank for the handlers' operand reads.
// Returns the registers it leaves.
export function stepActorScript(P, actor) {
  const { bus } = P, flagsAt = actor + ACTORF_FLAGS;
  if (bus.u8(flagsAt) & ACTORFLAG_PAUSED) return { hl: flagsAt, f: FH };
  const waitAt = actor + ACTORF_WAIT, wait = bus.u8(waitAt);
  if (wait) { bus.w8(waitAt, wait - 1); return { a: wait, hl: waitAt, f: decFlags(wait, 0) }; }
  let de = a16(P, actor, ACTORF_SCRIPT);
  bus.w8(P.A.actorScriptBank, a8(P, actor, ACTORF_SCRIPT_BANK));
  for (;;) {
    const op = farReadByte(P, bus.u8(P.A.actorScriptBank), de);
    const r = runActorScriptOp(P, op, actor, de);
    de = r.de;
    w16(P, actor, ACTORF_SCRIPT, de);
    if (!r.a) break;
  }
  return { a: 0, f: FZ, bc: actor, de, hl: actor + ACTORF_SCRIPT + 2 };
}

// UpdateActorJumpPhysics (04:426E): a jumping actor (height or velocity not 0) rises and falls: the velocity
// grows by $10 a frame (gravity; the ROM adds the constant ACTORF_HEIGHT) and is added to the height; when the
// height is back to 0 or below ground (bit 15 clear) both are zeroed. Returns the registers it leaves.
const GRAVITY = 0x0010;
export function updateActorJumpPhysics(P, actor) {
  const vel = a16(P, actor, ACTORF_JUMP_VEL), height = a16(P, actor, ACTORF_HEIGHT);
  if (!(height | vel)) return { a: 0, f: FZ, de: vel, hl: height };
  const newVel = (vel + GRAVITY) & 0xFFFF, sum = height + newVel, newHeight = sum & 0xFFFF;
  if (!(newHeight & 0x8000)) {                          // landed
    w16(P, actor, ACTORF_HEIGHT, 0); w16(P, actor, ACTORF_JUMP_VEL, 0);
    return { a: 0, f: FZ, de: newVel, hl: actor + ACTORF_JUMP_VEL + 2 };
  }
  w16(P, actor, ACTORF_JUMP_VEL, newVel);
  w16(P, actor, ACTORF_HEIGHT, newHeight);
  return { a: newHeight & 0xFF, f: FH | (sum > 0xFFFF ? FC : 0), de: newHeight, hl: actor + ACTORF_HEIGHT + 1 };
}

// AdvanceActorTowardTarget (04:42AE): a moving actor (flags bit 7; not frozen, bit 1) turns its heading toward
// its target by at most its turn rate a frame (turning the short way; a target behind it, $60 or more off,
// makes it walk backwards: heading and difference both turned a half turn), and steps its speed along the
// heading. In path mode (bit 2) a step that would come near the player is not taken: the actor is marked
// blocked (bit 6) instead. When the step reaches or passes the target on the main axis of the direction to it
// (X for headings within $20 of left/right, Y otherwise), it stops on the target. Returns the registers it leaves.
const BACKWARDS_ANGLE = 0x60;
export function advanceActorTowardTarget(P, actor) {
  const { bus } = P, flagsAt = actor + ACTORF_FLAGS;
  clearBits(P, flagsAt, ACTORFLAG_BLOCKED);
  if (bus.u8(flagsAt) & ACTORFLAG_FROZEN) return { hl: flagsAt, f: FH };
  if (!(bus.u8(flagsAt) & ACTORFLAG_MOVING)) return { hl: flagsAt, f: FZ | FH };
  const dx = (a16(P, actor, ACTORF_X) - a16(P, actor, ACTORF_TARGET_X)) & 0xFFFF;
  const dy = (a16(P, actor, ACTORF_Y) - a16(P, actor, ACTORF_TARGET_Y)) & 0xFFFF;
  const toward = angleFromVectorCoarse(P, dy, dx).a;        // the angle from the target to the actor
  const dir = (toward + 0x80) & 0xFF, dirF = addFlags(toward, 0x80);   // ... and from the actor to the target
  let heading = a8(P, actor, ACTORF_HEADING), diff = (dir - heading) & 0xFF;
  let size = diff & 0x80 ? (-diff) & 0xFF : diff;
  if (size >= BACKWARDS_ANGLE) {
    heading = (heading + 0x80) & 0xFF; diff = (diff + 0x80) & 0xFF;
    size = diff & 0x80 ? (-diff) & 0xFF : diff;
  }
  const rate = a8(P, actor, ACTORF_TURN_RATE);
  const turn = size < rate ? diff : (diff & 0x80 ? (-rate) & 0xFF : rate);
  heading = (heading + turn) & 0xFF;
  w8(P, actor, ACTORF_HEADING, heading);
  const step = vectorFromLengthAndAngleRaw(P, a16(P, actor, ACTORF_SPEED), heading);
  const vx = step.hl, vy = step.de;
  const me = actorPtr(P);
  if (bus.u8(me + ACTORF_FLAGS) & ACTORFLAG_PATH) {
    const nx = (a16(P, me, ACTORF_X) + vx) & 0xFFFF, ny = (a16(P, me, ACTORF_Y) + vy) & 0xFFFF;
    if (isPointNearPlayer(P, nx, ny).a) {
      setBits(P, me + ACTORF_FLAGS, ACTORFLAG_BLOCKED);
      return { a: dir, f: dirF, bc: actor, de: dx, hl: dy };
    }
  }
  const axis = ((dir + 0x20) & 0x40) ? 2 : 1;               // c: bit 0 X is the main axis, bit 1 Y
  let reached = 0;                                          // b: bit 0 X reached or passed, bit 1 Y
  const base = actorPtr(P) & 0xFF00 | ((actorPtr(P) & 0xFF) + ACTORF_Y) & 0xFF;   // (the ROM adds to l alone)
  const ny = (bus.u16(base) + vy) & 0xFFFF;
  bus.w16(base, ny);
  const tyAt = actorPtr(P) & 0xFF00 | ((actorPtr(P) & 0xFF) + ACTORF_TARGET_Y) & 0xFF;
  const ry = (ny - bus.u16(tyAt)) & 0xFFFF;
  if (!ry) reached |= 2;
  if ((ry ^ dy) & 0x8000) reached |= 2;
  const bx = actorPtr(P) & 0xFF00 | ((actorPtr(P) & 0xFF) + ACTORF_X) & 0xFF;
  const nx = (bus.u16(bx) + vx) & 0xFFFF;
  bus.w16(bx, nx);
  const txAt = actorPtr(P) & 0xFF00 | ((actorPtr(P) & 0xFF) + ACTORF_TARGET_X) & 0xFF;
  const tx = bus.u16(txAt), rx = (nx - tx) & 0xFFFF;
  if (!rx) reached |= 1;
  if ((rx ^ dx) & 0x8000) reached |= 1;
  if (!(reached & axis)) return { a: 0, f: FZ | FH, bc: actor, de: tx, hl: dx };
  const a = actorPtr(P);                                    // arrived: stand on the target
  clearBits(P, a + ACTORF_FLAGS, ACTORFLAG_MOVING);
  const dest = (a & 0xFF00) | ((a + ACTORF_X) & 0xFF);
  let last = 0;
  for (let i = 0; i < 4; i++) { last = bus.u8(a + ACTORF_TARGET_X + i); bus.w8(dest + i, last); }
  return { a: last, f: addFlags(ACTORF_X, a & 0xFF), bc: actor, de: dest + 3, hl: a + ACTORF_TARGET_X + 4 };
}

export const HOOKS = [
  [BANK, 0x4032, hook(P => clearActorSlots(P))],
  [BANK, 0x4041, hook((P, c) => initActorEngine(P, c.sp))],
  [BANK, 0x4055, hook((P, c) => ({ bc: spawnActor(P, c.a, c.hl) }))],
  [BANK, 0x40AC, hook((P, c) => ({ f: setActorScript(P, c.bc, c.a, c.hl, c.f) }))],
  [BANK, 0x40AF, hook((P, c) => { initActorSlotFields(P, c.bc, c.a, c.hl); })],
  [BANK, 0x40C6, hook((P, c) => ({ f: setActorPosition(P, c.bc, c.hl, c.de, c.f) }))],
  [BANK, 0x40F4, hook((P, c) => unusedSetActorTarget(P, c.bc, c.hl, c.de, c.a, c.f))],
  [BANK, 0x4114, hook((P, c) => unusedSetActorTargetRelative(P, c.bc, c.hl, c.de, c.a, c.f))],
  [BANK, 0x4148, hook((P, c) => ({ f: setActorMode(P, c.bc, c.d, c.f) }))],
  [BANK, 0x415B, hook((P, c) => ({ f: attachActorControllerScript(P, c.bc, c.f) }))],
  [BANK, 0x417B, hook((P, c) => ({ f: attachActorWaypointFollower(P, c.bc, c.de, c.f) }))],
  [BANK, 0x41A6, hook((P, c) => ({ f: attachActorStepMover(P, c.bc, c.de, c.f) }))],
  [BANK, 0x41E7, hook(P => updateActors(P))],
  [BANK, 0x4229, hook((P, c) => stepActorScript(P, c.bc))],
  [BANK, 0x426E, hook((P, c) => updateActorJumpPhysics(P, c.bc))],
  [BANK, 0x42AE, hook((P, c) => advanceActorTowardTarget(P, c.bc))],
];
