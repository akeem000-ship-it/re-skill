// The cutscene scripts' commands, part 2 (bank $0A, $43D8-$466E): putting an actor somewhere or sending it
// somewhere (from a point on the stack, see script.js), by a delta or along an angle; its facing lock and
// facing; turning one actor toward another.
// Port of actor_moves_0a.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm),
// whose routine names these are.
// Tests: web/tests/port/routines_story.mjs; lockstep on out/engine/rec2.mtrec and out/port/story1.mtrec.
import {
  FZ, FN, FH, FC, WRAM_ACTORS, BANK_STORY, ACTORF_FLAGS, ACTORF_TARGET_X, ACTORF_TARGET_Y, ACTORF_X, ACTORF_Y,
  ACTORF_HEADING, ACTORF_STATUS, ACTORF_FACING, ACTORFLAG_MOVING, ACTORSTATUS_FACING_LOCKED, hook, actorPtr,
  setActorPtr, addFlags, addHLFlags, spAddFlags, zf,
} from "./common.js";
import { copyMemoryBC } from "../home/memory.js";
import { angleFromVectorCoarse, vectorFromLengthAndAngle, vectorFromLengthAndAngleRaw } from "../home/math.js";
import { getActorStateAddr, withStackPoint, addToHL } from "./script.js";

const BANK = BANK_STORY;
// the field off of the actor at hActorPtr, by the ROM's add to its low byte, and the flags of that add
const field = (P, off) => { const a = actorPtr(P); return (a & 0xFF00) | ((a + off) & 0xFF); };
const fieldF = (P, off) => addFlags(actorPtr(P) & 0xFF, off);

// SetActorPositionRaw (0A:43D8) / SetActorMoveTargetRaw (0A:441F): the 4 bytes at bc (x, y) into the position
// (it stands) / the target (it walks) of the actor at hActorPtr. Returns the registers they leave.
export function setActorPositionRaw(P, bc) { return setPointRaw(P, bc, ACTORF_X, false); }
export function setActorMoveTargetRaw(P, bc) { return setPointRaw(P, bc, ACTORF_TARGET_X, true); }
function setPointRaw(P, bc, off, moving) {
  const r = copyMemoryBC(P, bc, field(P, off), 4);
  const hl = field(P, ACTORF_FLAGS);
  P.bus.w8(hl, moving ? P.bus.u8(hl) | ACTORFLAG_MOVING : P.bus.u8(hl) & ~ACTORFLAG_MOVING);
  return { a: hl & 0xFF, f: fieldF(P, ACTORF_FLAGS), de: r.de, hl };
}
// ScriptSetActorMoveTarget (0A:43F9): actor a walks to (bc, de).
export function scriptSetActorMoveTarget(P, slot, x, y) { return withStackPoint(P, slot, x, y, setActorMoveTargetRaw); }

// Unused_0a_MoveActorTowardPoint (0A:4440): a 5-byte record (bc, de, l) on the stack for the Raw routine below.
// Nothing calls it. Returns the registers it leaves.
export function unusedMoveActorTowardPoint(P, slot, bc, de, l) {
  const { cpu, bus } = P, buf = (cpu.sp - 5) & 0xFFFF;
  cpu.sp = buf;                                                   // add sp, -5
  bus.w16(buf, bc); bus.w16(buf + 2, de); bus.w8(buf + 4, l);
  const actor = getActorStateAddr(P, slot).hl;
  setActorPtr(P, actor);
  const r = unusedMoveActorTowardPointRaw(P, buf, de);
  cpu.sp = (buf + 5) & 0xFFFF;                                    // add sp, 5
  return { ...r, f: spAddFlags(buf, 5) };
}
// Unused_0a_MoveActorTowardPointRaw (0A:4465): the target is (w2, w1) + a vector of the record's length byte
// along the angle from (X - de, Y - the record's address + 4); a muddle nothing calls.
export function unusedMoveActorTowardPointRaw(P, bc, de) {
  const { bus } = P;
  const w1 = bus.u16(bc), w2 = bus.u16(bc + 2), len = bus.u8(bc + 4), after = (bc + 4) & 0xFFFF;
  const actor = actorPtr(P);
  const dx = (bus.u16(actor + ACTORF_X) - de) & 0xFFFF, dy = (bus.u16(actor + ACTORF_Y) - after) & 0xFFFF;
  const angle = angleFromVectorCoarse(P, dy, dx).a;
  const v = vectorFromLengthAndAngleRaw(P, len, angle);
  const tx = (v.hl + w2) & 0xFFFF, ty = (w1 + v.de) & 0xFFFF;
  const t = field(P, ACTORF_TARGET_X);
  bus.w16(t, tx); bus.w16(t + 2, ty);
  const hl = field(P, ACTORF_FLAGS);
  bus.w8(hl, bus.u8(hl) | ACTORFLAG_MOVING);
  return { a: hl & 0xFF, bc: (bc + ACTORF_FLAGS) & 0xFFFF, de: ty, hl };
}

// MoveActorByDelta (0A:44CB): actor a walks by (bc, de). MoveActorByDeltaRaw (0A:44F1): from the 4 bytes at bc.
export function moveActorByDelta(P, slot, dx, dy) { return withStackPoint(P, slot, dx, dy, moveActorByDeltaRaw); }
export function moveActorByDeltaRaw(P, bc) {
  const { bus } = P, dx = bus.u16(bc), dy = bus.u16(bc + 2);
  bus.w16(field(P, ACTORF_TARGET_X), bus.u16(field(P, ACTORF_X)) + dx);
  const ty = (bus.u16(field(P, ACTORF_Y)) + dy) & 0xFFFF;
  bus.w16(field(P, ACTORF_TARGET_Y), ty);
  const hl = field(P, ACTORF_FLAGS);
  bus.w8(hl, bus.u8(hl) | ACTORFLAG_MOVING);
  return { a: hl & 0xFF, f: fieldF(P, ACTORF_FLAGS), bc: (bc + 4) & 0xFFFF, de: ty, hl };
}
// MoveActorByAngle (0A:4545): actor a walks de (a length) along angle b. MoveActorByAngleRaw (0A:4569): from the
// 3 bytes at bc (angle, length).
export function moveActorByAngle(P, slot, angle, length) {
  const { cpu, bus } = P, buf = (cpu.sp - 3) & 0xFFFF;
  cpu.sp = buf;                                                   // add sp, -3
  bus.w8(buf, angle); bus.w16(buf + 1, length);
  const actor = getActorStateAddr(P, slot).hl;
  setActorPtr(P, actor);
  P.wramBank(WRAM_ACTORS);
  const r = moveActorByAngleRaw(P, buf);
  cpu.sp = (buf + 3) & 0xFFFF;                                    // add sp, 3
  return { ...r, bc: (buf + 3) & 0xFFFF, f: spAddFlags(buf, 3) };
}
export function moveActorByAngleRaw(P, bc) {
  const { bus } = P, angle = bus.u8(bc), length = bus.u16(bc + 1);
  const v = vectorFromLengthAndAngle(P, length, angle);
  bus.w16(field(P, ACTORF_TARGET_X), bus.u16(field(P, ACTORF_X)) + v.hl);
  const ty = (bus.u16(field(P, ACTORF_Y)) + v.de) & 0xFFFF;
  bus.w16(field(P, ACTORF_TARGET_Y), ty);
  const hl = field(P, ACTORF_FLAGS);
  bus.w8(hl, bus.u8(hl) | ACTORFLAG_MOVING);
  return { a: hl & 0xFF, f: fieldF(P, ACTORF_FLAGS), bc: (bc + 3) & 0xFFFF, de: ty, hl };
}

// ScriptSetActorFacingLock (0A:45C0): lock actor a's facing (b != 0), or unlock it, its facing taken from its
// heading.
export function scriptSetActorFacingLock(P, slot, lock) {
  const { bus } = P, bc = getActorStateAddr(P, slot).hl, hl = (bc + ACTORF_STATUS) & 0xFFFF;
  if (lock) {
    bus.w8(hl, bus.u8(hl) | ACTORSTATUS_FACING_LOCKED);
    return { a: lock, bc, hl, f: addHLFlags(ACTORF_STATUS, bc, 0) };
  }
  const heading = bus.u8(bc + ACTORF_HEADING);
  bus.w8(bc + ACTORF_FACING, heading);
  bus.w8(hl, bus.u8(hl) & ~ACTORSTATUS_FACING_LOCKED);
  return { a: heading, bc, hl, f: addHLFlags(ACTORF_STATUS, bc, FZ) };
}
// SetActorFacing (0A:45E2): actor a's heading = b.
export function setActorFacing(P, slot, heading) {
  const r = addToHL(getActorStateAddr(P, slot).hl, ACTORF_HEADING);
  P.wramBank(WRAM_ACTORS);
  P.bus.w8(r.hl, heading);
  return r;
}
// FaceActorTowardActor (0A:45F5): actor a's heading toward actor b. Keeps the registers (hActorPtr = actor a).
export function faceActorTowardActor(P, from, to) { faceActors(P, from, to, false); }
// FaceActorsTowardEachOther (0A:466F): both (hActorPtr = actor b after).
export function faceActorsTowardEachOther(P, from, to) { faceActors(P, from, to, true); }
function faceActors(P, from, to, both) {
  const { bus } = P;
  getActorStateAddr(P, from);
  const target = getActorStateAddr(P, to).hl;
  setActorPtr(P, target);
  P.wramBank(WRAM_ACTORS);
  const tx = bus.u16(field(P, ACTORF_X)), ty = bus.u16(field(P, ACTORF_X) + 2);
  setActorPtr(P, getActorStateAddr(P, from).hl);
  const dy = (ty - bus.u16(field(P, ACTORF_Y))) & 0xFFFF, dx = (tx - bus.u16(field(P, ACTORF_X))) & 0xFFFF;
  const angle = angleFromVectorCoarse(P, dy, dx).a;
  bus.w8(field(P, ACTORF_HEADING), angle);
  if (!both) return;
  setActorPtr(P, target);
  bus.w8(field(P, ACTORF_HEADING), angle + 0x80);
}

export const HOOKS = [
  [BANK, 0x43D8, hook((P, c) => setActorPositionRaw(P, c.bc))],
  [BANK, 0x43F9, hook((P, c) => scriptSetActorMoveTarget(P, c.a, c.bc, c.de))],
  [BANK, 0x441F, hook((P, c) => setActorMoveTargetRaw(P, c.bc))],
  [BANK, 0x4440, hook((P, c) => unusedMoveActorTowardPoint(P, c.a, c.bc, c.de, c.l))],
  [BANK, 0x4465, hook((P, c) => unusedMoveActorTowardPointRaw(P, c.bc, c.de))],
  [BANK, 0x44CB, hook((P, c) => moveActorByDelta(P, c.a, c.bc, c.de))],
  [BANK, 0x44F1, hook((P, c) => moveActorByDeltaRaw(P, c.bc))],
  [BANK, 0x4545, hook((P, c) => moveActorByAngle(P, c.a, c.b, c.de))],
  [BANK, 0x4569, hook((P, c) => moveActorByAngleRaw(P, c.bc))],
  [BANK, 0x45C0, hook((P, c) => scriptSetActorFacingLock(P, c.a, c.b))],
  [BANK, 0x45E2, hook((P, c) => setActorFacing(P, c.a, c.b))],
  [BANK, 0x45F5, hook((P, c) => { faceActorTowardActor(P, c.a, c.b); })],
  [BANK, 0x466F, hook((P, c) => { faceActorsTowardEachOther(P, c.a, c.b); })],
];
