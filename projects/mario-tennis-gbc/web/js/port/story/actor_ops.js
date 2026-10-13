// The camera that follows an actor, and the actor-script bytecode (bank 4, $4402-$48C2): the 22 opcode handlers
// StepActorScript (actor_slots.js) dispatches through ActorScriptOpHandlers_04 ($447D).
// Port of actor_ops_04.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm),
// whose routine names these are; the opcodes' macros are in its include/macros/actor_script.inc.
//
// An opcode handler gets the actor in bc (also in hActorPtr, which it reads again after anything that may have
// changed bc) and de pointing at its opcode byte, in the script's bank (wActorScriptBank: every operand is read
// with FarReadByte / FarReadWord). It returns de past what it consumed and a = 0 to end the actor's turn for this
// frame, or a != 0 to run the next opcode now. Several handlers address the actor's fields by adding the field
// offset to hActorPtr's low byte alone (the records are $40-aligned, so it never carries).
// Tests: web/tests/port/routines_story.mjs; lockstep on out/engine/rec2.mtrec and out/port/story1.mtrec.
import {
  FZ, FN, FH, FC, WRAM_ACTORS, BANK_ACTORS, ACTORF_FLAGS, ACTORF_WAIT, ACTORF_SPEED, ACTORF_TARGET_X, ACTORF_TARGET_Y,
  ACTORF_X, ACTORF_Y, ACTORF_HEADING, ACTORF_LEADER, ACTORF_MODE, ACTORF_STATUS, ACTORFLAG_PATH, ACTORFLAG_MOVING,
  ACTOR_MODE_CAMERA, a16, w16, setBits, clearBits, actorPtr, hook, addFlags, addHLFlags, cpFlags, subFlags,
} from "./common.js";
import { farReadByte, farReadWord, farCopyBytes } from "../home/palettes.js";
import { vectorFromLengthAndAngle, getSquareOfByte } from "../home/math.js";
import { playSoundManaged } from "../audio/requests.js";
import { setActorAnimationChecked } from "./scripted.js";
import { tryPickRandomReachableTarget, actorScriptOpWaitMove2, actorScriptOpFlag } from "./actor_objdefs.js";
import { isTerrainBlockedAtPoint } from "./actor_queries.js";

const BANK = BANK_ACTORS;
const ActorScriptOpHandlers_04 = 0x447D;       // 22 words, the handler of each opcode
const ActorFieldTypeTable_04 = 0x47FD;         // per field offset: 2 a word, 1 a byte, 0 not settable
const FIELD_WORD = 2, FIELD_BYTE = 1;
const CAMERA_X_OFFSET = 0xF610, CAMERA_Y_OFFSET = 0xF710;   // the camera's corner is the actor less (9.94, 8.94) tiles
const SCREEN_WIDTH_TILES = 0x14, SCREEN_HEIGHT_TILES = 0x12;
const CAMERA_FINE_MASK = 0xE0;                 // the camera moves in 1/8-tile (one pixel) steps

// The field of the actor at hActorPtr at offset off, by the ROM's `add off` to the low byte alone
const field = (P, off) => { const a = actorPtr(P); return (a & 0xFF00) | ((a + off) & 0xFF); };
const fieldFlags = (P, off) => addFlags(actorPtr(P) & 0xFF, off);   // the flags that `add off` leaves
const scriptBank = P => P.bus.u8(P.A.actorScriptBank);

// UpdateCameraIfActorIsCameraTarget (04:4402): UpdateCameraToActor for an actor in mode 1.
export function updateCameraIfActorIsCameraTarget(P, actor) {
  const hl = actor + ACTORF_MODE, mode = P.bus.u8(hl);
  if (mode !== ACTOR_MODE_CAMERA) return { a: mode, f: cpFlags(mode, ACTOR_MODE_CAMERA), hl };
  updateCameraToActor(P, actor);
  return { a: mode, f: FZ | FN, hl };
}
// UpdateCameraToActor (04:440A): put the camera's corner (wCameraX/Y) on actor bc less (9.94, 8.94) tiles,
// clamped to the map's scroll area [min, size - screen], in pixel steps. Keeps the registers; WRAM bank 4.
export function updateCameraToActor(P, actor) {
  const { V } = P;
  P.wramBank(WRAM_ACTORS);
  V.cameraX = clampCamera(a16(P, actor, ACTORF_X) + CAMERA_X_OFFSET, V.mapScrollMinX, V.mapWidthTiles - SCREEN_WIDTH_TILES);
  V.cameraY = clampCamera(a16(P, actor, ACTORF_Y) + CAMERA_Y_OFFSET, V.mapScrollMinY, V.mapHeightTiles - SCREEN_HEIGHT_TILES);
}
// below min (by the sign of tile - min): min; at or past max: max; then the fraction cut to pixels
function clampCamera(pos, min, max) {
  let hl = pos & 0xFFFF;
  if (((hl >> 8) - min) & 0x80) hl = min << 8;
  else if (!(((hl >> 8) - (max & 0xFF)) & 0x80)) hl = (max & 0xFF) << 8;
  return hl & 0xFF00 | hl & CAMERA_FINE_MASK;
}

// ---- the opcodes ----
// The flags a handler is entered with: those of the dispatch's `ld_hl_indexed` (its `sub l`).
function dispatchFlags(op) {
  const a = (op * 2) & 0xFF, sum = a + (ActorScriptOpHandlers_04 & 0xFF), l = sum & 0xFF;
  const x = (l + (ActorScriptOpHandlers_04 >> 8) + (sum > 0xFF ? 1 : 0)) & 0xFF;
  return subFlags(x, l);
}
// Run opcode op of actor bc at de through the ROM's handler table. Returns the handler's registers.
export function runActorScriptOp(P, op, actor, de) {
  const handler = P.rom.u16(BANK, (ActorScriptOpHandlers_04 + ((op * 2) & 0xFF)) & 0xFFFF);
  const fn = HANDLERS.get(handler);
  if (!fn) throw new Error(`actor script opcode ${op} at ${de.toString(16)}: no handler ($${handler.toString(16)})`);
  return fn(P, actor, de, dispatchFlags(op));
}

// ActorScriptOp_Call (04:44A9), as_call: call the native routine (operand) in the script's bank with the actor in
// bc. It returns a = 0: go on with the next opcode next frame; a != 0 and b = 0: go on now; a != 0 and b != 0:
// call it again next frame. Returns the routine's bc and hl.
export function actorScriptOpCall(P, actor, de, f) {
  const at = (de + 1) & 0xFFFF, bank = scriptBank(P), target = farReadWord(P, bank, at), me = actorPtr(P);
  const r = P.callRom(bank, target, { a: bank, f, b: me >> 8, c: me & 0xFF, d: at >> 8, e: at & 0xFF, h: target >> 8, l: target & 0xFF });
  const out = { bc: r.bc, hl: r.hl };
  if (!r.a) return { ...out, a: 0, f: FZ | FH, de: (at + 2) & 0xFFFF };
  if (!r.b) return { ...out, a: r.a, f: FZ | FN, de: (at + 2) & 0xFFFF };
  return { ...out, a: 0, f: FN | (((r.b + 1) & 0x0F) === 0 ? FH : 0), de };
}
// ActorScriptOp_Jump (04:44D0), as_jump: de = the operand's address + the signed word there.
export function actorScriptOpJump(P, actor, de, f) {
  const at = (de + 1) & 0xFFFF, off = farReadWord(P, scriptBank(P), at), hl = (at + off) & 0xFFFF;
  return { a: 1, de: hl, hl, bc: off, f: addHLFlags(at, off, f) };
}
// ActorScriptOp_Move (04:44DF), as_move angle, distance: walk to the point that far along the angle.
export function actorScriptOpMove(P, actor, de) {
  const at = (de + 1) & 0xFFFF, angle = farReadByte(P, scriptBank(P), at);
  return applyActorHeadingStep(P, (at + 1) & 0xFFFF, angle);
}
// ActorScriptOp_MoveRel (04:44EB), as_move_rel: the same with the angle relative to the actor's heading.
export function actorScriptOpMoveRel(P, actor, de) {
  const at = (de + 1) & 0xFFFF, angle = farReadByte(P, scriptBank(P), at);
  return applyActorHeadingStep(P, (at + 1) & 0xFFFF, (angle + P.bus.u8(field(P, ACTORF_HEADING))) & 0xFF);
}
// ApplyActorHeadingStep (04:4500): the target = the position + (distance at de) along angle a; the actor moves.
export function applyActorHeadingStep(P, de, angle) {
  const { bus } = P, distance = farReadWord(P, scriptBank(P), de);
  const v = vectorFromLengthAndAngle(P, distance, angle);
  w16(P, field(P, ACTORF_TARGET_Y), 0, bus.u16(field(P, ACTORF_Y)) + v.de);
  w16(P, field(P, ACTORF_TARGET_X), 0, bus.u16(field(P, ACTORF_X)) + v.hl);
  const hl = field(P, ACTORF_FLAGS);
  setBits(P, hl, ACTORFLAG_MOVING);
  return { a: 1, bc: distance, de: (de + 2) & 0xFFFF, hl, f: fieldFlags(P, ACTORF_FLAGS) };
}
// ActorScriptOp_SetPos (04:4556), as_set_pos x, y: stand at the point. ActorScriptOp_SetTarget (04:457B),
// as_set_target x, y: walk there.
export function actorScriptOpSetPos(P, actor, de) { return setPointOp(P, de, ACTORF_X, false); }
export function actorScriptOpSetTarget(P, actor, de) { return setPointOp(P, de, ACTORF_TARGET_X, true); }
function setPointOp(P, de, off, moving) {
  const r = farCopyBytes(P, scriptBank(P), (de + 1) & 0xFFFF, field(P, off), 4);
  const hl = field(P, ACTORF_FLAGS);
  if (moving) setBits(P, hl, ACTORFLAG_MOVING); else clearBits(P, hl, ACTORFLAG_MOVING);
  return { a: 1, bc: 0, de: r.hl, hl, f: fieldFlags(P, ACTORF_FLAGS) };
}
// ActorScriptOp_TargetRel (04:45A0), as_target_rel dx, dy: walk to the position + (dx, dy).
export function actorScriptOpTargetRel(P, actor, de) {
  const { bus } = P, bank = scriptBank(P);
  let at = (de + 1) & 0xFFFF;
  const dx = farReadWord(P, bank, at); at = (at + 2) & 0xFFFF;
  bus.w16(field(P, ACTORF_TARGET_X), bus.u16(field(P, ACTORF_X)) + dx);
  const dy = farReadWord(P, bank, at); at = (at + 2) & 0xFFFF;
  const ty = (bus.u16(field(P, ACTORF_Y)) + dy) & 0xFFFF;
  bus.w16(field(P, ACTORF_TARGET_Y), ty);
  const hl = field(P, ACTORF_FLAGS);
  setBits(P, hl, ACTORFLAG_MOVING);
  return { a: 1, bc: ty, de: at, hl, f: fieldFlags(P, ACTORF_FLAGS) };
}
// ActorScriptOp_WaitMove (04:45F8), as_wait_move: yield until the walk is over, then go on.
export function actorScriptOpWaitMove(P, actor, de) {
  const hl = field(P, ACTORF_FLAGS);
  if (P.bus.u8(hl) & ACTORFLAG_MOVING) return { a: 0, f: FZ, de, hl };
  return { a: 1, f: FZ | FH, de: (de + 1) & 0xFFFF, hl };
}
// ActorScriptOp_Halt (04:460A), as_halt (opcodes 0, 5, $0F): yield, staying on the opcode.
export function actorScriptOpHalt(P, actor, de) { return { a: 0, f: FZ, de }; }
// ActorScriptOp_Wait (04:460C), as_wait n: wait n frames (the countdown is n - 1 after this one).
export function actorScriptOpWait(P, actor, de) {
  const at = (de + 1) & 0xFFFF, b = (farReadByte(P, scriptBank(P), at) - 1) & 0xFF, hl = field(P, ACTORF_WAIT);
  P.bus.w8(hl, b);
  return { a: 0, f: FZ, b, de: (at + 1) & 0xFFFF, hl };
}
// ActorScriptOp_FollowWaypoint (04:4623), as_follow_wp: walk toward the leader (ACTORF_LEADER), faster the farther
// it is: speed $10, $18, $20, $40 for a squared tile distance under 1, 4, 9, 16, else $80. Yields.
const FOLLOW_SPEEDS = [[1, 0x10], [4, 0x18], [9, 0x20], [0x10, 0x40]], FOLLOW_SPEED_FAR = 0x80;
export function actorScriptOpFollowWaypoint(P, actor, de) {
  const { bus } = P, me = actorPtr(P), leader = a16(P, me, ACTORF_LEADER);
  const dest = (me & 0xFF00) | ((me + ACTORF_TARGET_X) & 0xFF);
  for (let i = 0; i < 4; i++) bus.w8(dest + i, bus.u8(leader + ACTORF_X + i));
  const at = isActorAtTarget(P, me);
  let hl = at.hl;
  if (!at.at) {
    const d2 = (squaredTileDelta(P, me, ACTORF_TARGET_X + 1, ACTORF_X + 1) + squaredTileDelta(P, me, ACTORF_TARGET_Y + 1, ACTORF_Y + 1)) & 0xFFFF;
    let speed = FOLLOW_SPEED_FAR;
    if (!(d2 >> 8)) for (const [limit, s] of FOLLOW_SPEEDS) if (d2 < limit) { speed = s; break; }
    w16(P, me, ACTORF_SPEED, speed);
    hl = me + ACTORF_FLAGS;
    setBits(P, hl, ACTORFLAG_MOVING);
  }
  return { a: 0, f: FZ, bc: me, de: (de + 1) & 0xFFFF, hl };
}
// the square of the difference of two tile bytes of an actor (GetSquareOfByte of |a - b|)
function squaredTileDelta(P, actor, offA, offB) {
  const d = (P.bus.u8(actor + offA) - P.bus.u8(actor + offB)) & 0xFF;
  return getSquareOfByte(d & 0x80 ? (-d) & 0xFF : d);
}
// ActorScriptOp_Step (04:46B0), as_step: trail the leader: unless within $8 (squared tiles, low byte) of it, take
// its speed and walk to the point 2 tiles behind it (its heading turned back), if that point is free. Yields.
const TRAIL_DISTANCE = 0x0200, TRAIL_NEAR = 8;
export function actorScriptOpStep(P, actor, de) {
  const { bus } = P, at1 = (de + 1) & 0xFFFF;
  const leader = a16(P, actorPtr(P), ACTORF_LEADER);
  const ly = (leader & 0xFF00) | ((leader + ACTORF_Y) & 0xFF);   // the ROM's base: the leader's Y, by its low byte
  const leaderY = bus.u16(ly), leaderX = bus.u16(ly - 2), heading = bus.u8(ly + 6), speed = bus.u16(ly - 8);
  const me = actorPtr(P);
  const dx = ((leaderX >> 8) - bus.u8(me + ACTORF_X + 1)) & 0xFF, dy = ((leaderY >> 8) - bus.u8(me + ACTORF_Y + 1)) & 0xFF;
  const d2 = (getSquareOfByte(dx & 0x80 ? (-dx) & 0xFF : dx) + getSquareOfByte(dy & 0x80 ? (-dy) & 0xFF : dy)) & 0xFFFF;
  if ((d2 & 0xFF) < TRAIL_NEAR) return { a: 0, f: FZ, bc: me, de: at1, hl: d2 };
  w16(P, me, ACTORF_SPEED, speed);
  const v = vectorFromLengthAndAngle(P, TRAIL_DISTANCE, (heading + 0x80) & 0xFF);
  const tx = (leaderX + v.hl) & 0xFFFF, ty = (leaderY + v.de) & 0xFFFF;
  if (isTerrainBlockedAtPoint(P, tx, ty).a) return { a: 0, f: FZ, bc: tx, de: at1, hl: tx };
  const t = field(P, ACTORF_TARGET_X);
  bus.w16(t, tx); bus.w16(t + 2, ty);
  const me2 = actorPtr(P), there = isActorAtTarget(P, me2);
  if (there.at) return { a: 0, f: FZ, bc: me2, de: at1, hl: there.hl };
  const me3 = actorPtr(P);
  setBits(P, me3 + ACTORF_FLAGS, ACTORFLAG_MOVING);
  return { a: 0, f: FZ, bc: me3, de: at1, hl: me3 + ACTORF_FLAGS };
}
// IsActorAtTarget (04:475A): Z (a = 0) when actor bc stands on its target. Returns { at, a, f, de, hl }.
export function isActorAtTarget(P, actor) {
  const { bus } = P;
  let hl = (actor + ACTORF_X) & 0xFFFF, de = (actor & 0xFF00) | ((actor + ACTORF_TARGET_X) & 0xFF);
  for (let i = 0; i < 4; i++) {
    if (bus.u8(de) !== bus.u8(hl)) return { at: false, a: 1, f: 0, de, hl };
    if (i < 3) { hl = (hl + 1) & 0xFFFF; de = (de + 1) & 0xFFFF; }
  }
  return { at: true, a: 0, f: FZ, de, hl };
}
// ActorScriptOp_SetField (04:477F), as_set_field off, value: write a field of the actor, a word or a byte as
// ActorFieldTypeTable_04 says (or nothing).
export function actorScriptOpSetField(P, actor, de) { return fieldOp(P, de, false); }
// ActorScriptOp_AddField (04:47BA), as_add_field off, value: add to it. The ROM reads the value from the
// selector's address (it does not move hl on), so the value is (offset, low byte of the operand).
export function actorScriptOpAddField(P, actor, de) { return fieldOp(P, de, true); }
function fieldOp(P, de, add) {
  const { bus } = P, bank = scriptBank(P), at = (de + 1) & 0xFFFF;
  const off = farReadByte(P, bank, at);
  const value = farReadWord(P, bank, add ? at : (at + 1) & 0xFFFF);
  const next = (at + 3) & 0xFFFF, a = actorPtr(P);
  const hl = (a & 0xFF00) | ((off + a) & 0xFF);
  const type = P.rom.u8(BANK, (ActorFieldTypeTable_04 + off) & 0xFFFF);
  if (type === FIELD_WORD) {
    if (!add) { bus.w16(hl, value); return { a: 1, bc: value, de: next, hl: hl + 1, f: FZ | FN }; }
    const old = bus.u16(hl), sum = (old + value) & 0xFFFF;
    bus.w16(hl, sum);
    return { a: 1, bc: sum, de: next, hl: hl + 1, f: FZ | (addHLFlags(old, value, 0) & (FH | FC)) };
  }
  if (type === FIELD_BYTE) {
    if (!add) { bus.w8(hl, value); return { a: 1, bc: value, de: next, hl, f: FZ | FN }; }
    const old = bus.u8(hl);
    bus.w8(hl, old + value);
    return { a: 1, bc: value, de: next, hl, f: addFlags(old, value & 0xFF) };
  }
  return { a: 1, bc: value, de: next, hl, f: cpFlags(type, FIELD_BYTE) };
}
// ActorScriptOp_Anim (04:4824), as_anim n: start animation n.
export function actorScriptOpAnim(P, actor, de) {
  const at = (de + 1) & 0xFFFF, anim = farReadByte(P, scriptBank(P), at), me = actorPtr(P);
  setActorAnimationChecked(P, me, anim);
  return { a: 1, bc: me, de: (at + 1) & 0xFFFF, hl: P.A.actorPtr + 1 };
}
// ActorScriptOp_Sound (04:483D), as_sound id: play sound id.
export function actorScriptOpSound(P, actor, de) {
  const at = (de + 1) & 0xFFFF, id = farReadByte(P, scriptBank(P), at);
  playSoundManaged(P, id);
  return { a: 1, b: id, de: (at + 1) & 0xFFFF, hl: at };
}
// ActorScriptOp_BeginPath (04:484E), as_begin_path: path mode (it stops short of the player) from home = the tile
// it stands on (ACTORF_LEADER = X tile << 8 | Y tile), speed 8. Yields.
const PATH_SPEED = 0x0008;
export function actorScriptOpBeginPath(P, actor, de) {
  const { bus } = P, b = bus.u8(field(P, ACTORF_X + 1)), c = bus.u8(field(P, ACTORF_Y + 1));
  bus.w16(field(P, ACTORF_LEADER), b << 8 | c);
  bus.w16(field(P, ACTORF_SPEED), PATH_SPEED);
  const hl = field(P, ACTORF_FLAGS);
  setBits(P, hl, ACTORFLAG_PATH);
  return { a: 0, bc: b << 8 | c, de: (de + 1) & 0xFFFF, hl, f: fieldFlags(P, ACTORF_FLAGS) };
}
// ActorScriptOp_RandBox (04:4886), as_rand_box w, d: if the actor wanders (status bit 7), up to 4 tries at a
// random reachable point within w x d tiles of home (TryPickRandomReachableTarget); after 4 failures it yields.
// Without bit 7 it goes on (a is the low byte of the status field's address, never 0).
const WANDER_TRIES = 4;
export function actorScriptOpRandBox(P, actor, de) {
  const { bus } = P, status = field(P, ACTORF_STATUS), next = (de + 3) & 0xFFFF;
  if (!(bus.u8(status) & 0x80)) return { a: status & 0xFF, f: FZ | FH, de: next, hl: status };
  const box = farReadWord(P, scriptBank(P), (de + 1) & 0xFFFF);
  bus.w8(P.A.actorRandBoxHalfWidth, box & 0xFF);
  bus.w8(P.A.actorRandBoxHalfDepth, box >> 8);
  let r;
  for (let i = 0; i < WANDER_TRIES; i++) { r = tryPickRandomReachableTarget(P); if (r.a) break; }
  return { ...r, a: r.a, f: r.a ? FH : FZ | FH, bc: box, de: next };
}

// handler address -> port (the opcodes' table is the ROM's)
const HANDLERS = new Map([
  [0x44A9, actorScriptOpCall], [0x44D0, actorScriptOpJump], [0x44DF, actorScriptOpMove], [0x44EB, actorScriptOpMoveRel],
  [0x4556, actorScriptOpSetPos], [0x457B, actorScriptOpSetTarget], [0x45A0, actorScriptOpTargetRel],
  [0x45F8, actorScriptOpWaitMove], [0x460A, actorScriptOpHalt], [0x460C, actorScriptOpWait],
  [0x4623, actorScriptOpFollowWaypoint], [0x46B0, actorScriptOpStep], [0x477F, actorScriptOpSetField],
  [0x47BA, actorScriptOpAddField], [0x4824, actorScriptOpAnim], [0x483D, actorScriptOpSound],
  [0x484E, actorScriptOpBeginPath], [0x4886, actorScriptOpRandBox],
  [0x4949, (P, actor, de) => actorScriptOpWaitMove2(P, de)], [0x49DE, (P, actor, de) => actorScriptOpFlag(P, actor, de)],
]);

export const HOOKS = [
  [BANK, 0x4402, hook((P, c) => updateCameraIfActorIsCameraTarget(P, c.bc))],
  [BANK, 0x440A, hook((P, c) => { updateCameraToActor(P, c.bc); })],
  ...[...HANDLERS].map(([addr, fn]) => [BANK, addr, hook((P, c) => fn(P, c.bc, c.de, c.f))]),
  [BANK, 0x4500, hook((P, c) => applyActorHeadingStep(P, c.de, c.a))],
  [BANK, 0x475A, hook((P, c) => { const { at, ...r } = isActorAtTarget(P, c.bc); return r; })],
];
