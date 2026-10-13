// The cutscene scripts' commands, part 3 (bank $0A, $4702-$4930): animations, waits for an actor to settle,
// jumps, active flags, moving "the player" (the scripts move its follower, slot 1, which the player trails;
// optionally with a fade and a jump cut), and the screen shake.
// Port of actor_waits_0a.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm),
// whose routine names these are (FaceActorsTowardEachOther, at its start, is in actor_moves.js).
// Tests: web/tests/port/routines_story.mjs; lockstep on out/engine/rec2.mtrec and out/port/story1.mtrec.
import {
  FZ, FN, FH, FC, WRAM_ACTORS, BANK_ACTORS, BANK_STORY, wFollowerActor, ACTORF_FLAGS, ACTORF_SPEED, ACTORF_JUMP_VEL,
  ACTORF_LEADER, ACTORF_ANIM_ID, ACTORF_MODE, ACTORFLAG_MOVING, FLAG_CUTSCENE_FAST_FORWARD, hook, hookGen, farcall,
  testFlag, testFlagF, advanceFrame, randomSeed, setActorPtr, cpFlags, zf, addHLFlags,
} from "./common.js";
import { beginFadeOut, beginFadeIn, waitFadeEnd, registerFrameTask, unregisterFrameTask } from "../home/colorfade.js";
import { setActorAnimationChecked } from "./scripted.js";
import { getActorStateAddr, addToHL, waitScriptFrames } from "./script.js";
import { setActorPositionRaw, setActorMoveTargetRaw } from "./actor_moves.js";

const BANK = BANK_STORY;
export const UpdateScreenShake = 0x4908;
const IDLE_WAIT_FRAMES = 0x00F0, PLAYER_WAIT_FRAMES = 0x0258;
const ANIM_STILL = 0x00, ANIM_WALK = 0x01;
const CUT_FADE_SPEED = 127;
const SHAKE_OFF = 0xFF, SHAKE_MAX = 3;
const BANK_TEXT = 0x05, RestoreShadowTilemap = 0x436F;

// ScriptSetActorAnimation (0A:4702): actor a starts animation d.
export function scriptSetActorAnimation(P, slot, anim) {
  const r = getActorStateAddr(P, slot);
  const f = farcall(P, BANK_ACTORS, () => setActorAnimationChecked(P, r.hl, anim, 0));
  return { a: r.a, f, bc: r.hl, hl: r.hl };
}
// ScriptWaitActorIdle (0A:470B): unless fast-forwarding, wait until actor a's animation is back to still or walk.
export function* scriptWaitActorIdle(P, slot) {
  if (testFlag(P, FLAG_CUTSCENE_FAST_FORWARD)) return { f: testFlagF(true) };
  const r = getActorStateAddr(P, slot);
  yield* waitActorIdle(P, r.hl);
  return { a: r.a, f: r.f, bc: r.hl, hl: r.hl };
}
// ScriptSetActorJumpVelocity (0A:4719): actor a jumps with velocity de (negative: up).
export function scriptSetActorJumpVelocity(P, slot, vel) {
  const r = addToHL(getActorStateAddr(P, slot).hl, ACTORF_JUMP_VEL);
  P.wramBank(WRAM_ACTORS);
  P.bus.w16(r.hl, vel);
  return { a: r.a, f: r.f, hl: (r.hl + 1) & 0xFFFF };
}
// SetActorActive (0A:472E): actor a's mode = b.
export function setActorActive(P, slot, mode) {
  const r = addToHL(getActorStateAddr(P, slot).hl, ACTORF_MODE);
  P.wramBank(WRAM_ACTORS);
  P.bus.w8(r.hl, mode);
  return r;
}
// UnusedSubDEFromHL (0A:4741): hl -= de (de = 0: a = 0, Z). Nothing calls it.
export function unusedSubDEFromHL(hl, de) {
  const d = de >> 8, e = de & 0xFF;
  if (!(d | e)) return { a: 0, f: FZ };
  const ne = ((~e & 0xFF) + 1) & 0xFF, carry = e === 0 ? 1 : 0;
  const a = (d - carry) & 0xFF, nd = ~a & 0xFF, neg = nd << 8 | ne;
  return { a: nd, de: neg, hl: (hl + neg) & 0xFFFF, f: addHLFlags(hl, neg, zf(a)) };
}
// UnusedSetActorMoveTarget (0A:4750): actor hl's leader / home = de (by the low byte alone). Nothing calls it.
export function unusedSetActorMoveTarget(P, actor, de, f) {
  const h = actor >> 8, flags = (h === 0 ? FZ : 0) | FN | (((h + 1) & 0x0F) === 0 ? FH : 0) | (f & FC);
  if (!h) return { f: flags };
  const at = (actor & 0xFF00) | ((actor + ACTORF_LEADER) & 0xFF);
  P.bus.w8(at, de); P.bus.w8(at + 1, de >> 8);
  return { f: flags };
}
// IsActorBusy (0A:476C): a = 1 while actor hl plays an animation other than still or walk (0 for a null hl).
export function isActorBusy(P, actor) {
  if (!(actor >> 8)) return { busy: false, a: 0, f: FZ | FN };
  P.wramBank(WRAM_ACTORS);
  const anim = P.bus.u8(actor + ACTORF_ANIM_ID);
  if (anim === ANIM_STILL || anim === ANIM_WALK) return { busy: false, a: 0, f: FZ };
  return { busy: true, a: 1, f: cpFlags(anim, ANIM_WALK) };
}
// WaitActorIdle (0A:478D): wait (up to $F0 frames) until it is not. Keeps the registers.
export function* waitActorIdle(P, actor) {
  for (let bc = IDLE_WAIT_FRAMES; bc > 0; bc--) {
    if (!isActorBusy(P, actor).busy) return;
    yield* advanceFrame(P);
  }
}
// SetPlayerMoveSpeed (0A:47A3): the follower's (the player's) walking speed = bc. Keeps the registers.
export function setPlayerMoveSpeed(P, speed) {
  P.wramBank(WRAM_ACTORS);
  P.bus.w16(wFollowerActor + ACTORF_SPEED, speed);
}
// MovePlayerToPosition (0A:47B4): the player walks to (bc, de); with a != 0 it is put there instead behind a
// fade out and in. MovePlayerToActor (0A:4813): to where actor a stands (b: the fade), a = $FF: nothing.
// Keep the registers.
export function* movePlayerToPosition(P, x, y, cut) {
  yield* movePlayerTo(P, x, y, cut);
}
export function* movePlayerToActor(P, slot, cut) {
  if (slot === 0xFF) return;
  P.wramBank(WRAM_ACTORS);
  const actor = getActorStateAddr(P, slot).hl;
  setActorPtr(P, actor);
  const base = (actor & 0xFF00) | ((actor + 0x0C) & 0xFF);
  yield* movePlayerTo(P, P.bus.u16(base), P.bus.u16(base + 2), cut);
}
function* movePlayerTo(P, x, y, cut) {
  const { cpu, bus } = P, buf = (cpu.sp - 4) & 0xFFFF;
  cpu.sp = buf;                                                   // add sp, -4: the point on the stack
  bus.w16(buf, x); bus.w16(buf + 2, y);
  setActorPtr(P, wFollowerActor);
  P.wramBank(WRAM_ACTORS);
  if (!cut) setActorMoveTargetRaw(P, buf);
  else {
    beginFadeOut(P, CUT_FADE_SPEED);
    yield* waitFadeEnd(P, { a: 0, f: 0, b: 0, c: CUT_FADE_SPEED, d: 0, e: 0, h: 0, l: 0 });
    setActorPtr(P, wFollowerActor);
    setActorPositionRaw(P, buf);
    yield* advanceFrame(P);
    yield* P.runRom(BANK_TEXT, RestoreShadowTilemap);
    yield* advanceFrame(P);
    beginFadeIn(P, CUT_FADE_SPEED);
    yield* waitFadeEnd(P, { a: 0, f: 0, b: 5, c: CUT_FADE_SPEED, d: 0, e: 0, h: 0, l: 0 });
  }
  cpu.sp = (buf + 4) & 0xFFFF;                                    // add sp, 4
}
// WaitPlayerMoveDone (0A:4892): wait (frame by frame, WaitScriptFrames; up to $258) until the follower stands.
// Keeps the registers (hActorPtr = the follower; WRAM 4).
export function* waitPlayerMoveDone(P) {
  setActorPtr(P, wFollowerActor);
  P.wramBank(WRAM_ACTORS);
  const hl = wFollowerActor + ACTORF_FLAGS;
  for (let bc = PLAYER_WAIT_FRAMES; bc > 0; bc--) {
    yield* waitScriptFrames(P, 1);
    if (!(P.bus.u8(hl) & ACTORFLAG_MOVING)) return;
  }
}
// SetScreenShake (0A:48C0): shake the screen with magnitude a (at most 3; 0 stops it), from the UpdateScreenShake
// frame task (started when it was off). Keeps the registers.
export function setScreenShake(P, magnitude, sp = P.cpu.sp) {
  const { V } = P, old = V.wramBank;
  let a;
  if (magnitude) {
    if (V.screenShakeMagnitude === SHAKE_OFF) registerFrameTask(P, 1, UpdateScreenShake, sp - 2);
    a = magnitude < 4 ? magnitude : SHAKE_MAX;
  } else if (V.screenShakeMagnitude === SHAKE_OFF) a = 0;          // (already off: the ROM stores 0)
  else {
    V.screenShakeOffsetX = 0; V.screenShakeOffsetY = 0;
    unregisterFrameTask(P, UpdateScreenShake, sp - 2);
    a = SHAKE_OFF;
  }
  V.screenShakeMagnitude = a;
  P.wramBank(old);
}
// UpdateScreenShake (0A:4908), a frame task: random offsets within the magnitude's bits (the ROM's sign tests use
// the carry, which `and` clears: the offsets are never negated). Keeps the registers.
export function updateScreenShake(P) {
  const { V } = P;
  let a = V.screenShakeMagnitude, c = 0;
  do { c = ((c << 1) | 1) & 0xFF; a = (a - 1) & 0xFF; } while (a);
  const seed = randomSeed(P);
  V.screenShakeOffsetX = (seed >> 8) & c;
  V.screenShakeOffsetY = seed & c;
}

export const HOOKS = [
  [BANK, 0x4702, hook((P, c) => scriptSetActorAnimation(P, c.a, c.d))],
  [BANK, 0x470B, hookGen((P, c) => scriptWaitActorIdle(P, c.a))],
  [BANK, 0x4719, hook((P, c) => scriptSetActorJumpVelocity(P, c.a, c.de))],
  [BANK, 0x472E, hook((P, c) => setActorActive(P, c.a, c.b))],
  [BANK, 0x4741, hook((P, c) => unusedSubDEFromHL(c.hl, c.de))],
  [BANK, 0x4750, hook((P, c) => unusedSetActorMoveTarget(P, c.hl, c.de, c.f))],
  [BANK, 0x476C, hook((P, c) => { const { busy, ...r } = isActorBusy(P, c.hl); return r; })],
  [BANK, 0x478D, hookGen((P, c) => waitActorIdle(P, c.hl))],
  [BANK, 0x47A3, hook((P, c) => { setPlayerMoveSpeed(P, c.bc); })],
  [BANK, 0x47B4, hookGen((P, c) => movePlayerToPosition(P, c.bc, c.de, c.a))],
  [BANK, 0x4813, hookGen(function* (P, c) { const a = c.a; yield* movePlayerToActor(P, a, c.b); return { f: cpFlags(a, 0xFF) }; })],
  [BANK, 0x4892, hookGen(P => waitPlayerMoveDone(P))],
  [BANK, 0x48C0, hook((P, c) => { setScreenShake(P, c.a, c.sp); })],
  [BANK, 0x4908, hook(P => { updateScreenShake(P); })],
];
