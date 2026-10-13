// Minigame targets (bank $0A, $6596-$6E3F): the targets of the target-shooting minigames, each run by a little
// script, drawn, hit by the ball (which they deflect, or score), and the digit sprites of a score.
// Port of minigame_0a.asm (and CheckBallHitsMinigameTargetAlt, at the start of credits_0a.asm) of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm), whose routine names these are.
//
// The target model. 15 targets of 14 bytes at wMinigameTargets (WRAM 4 $DC00): [flags (bit 0 active, 1 moving,
// 2 hit), type (0-3), hit-flash countdown, script wait, script pointer(2), X(2), Y(2), goal X(2), goal Y(2)].
// Each frame UpdateMinigameTargets copies each active target into wMinigameTargetWork (16 bytes: the copies back
// spill 2 bytes into the next target, as in the ROM), runs its script, steps it 1/16 tile toward its goal, draws
// it and checks the ball. Two kinds: deflecting targets (they bounce the ball, a type's push), and the "alt" ones
// (wMinigameTargetsAltMode: hit ones are reported in wMinigameHitTargetType for scoring).
// Target scripts (bank $0A): 0 yield; 1 n: wait n frames; 2 rel: jump; 3 addr: call native; 4: wait until arrived;
// 5 x, y: stand there; 6 angle, length: go that far; 7 type: set the type; 8 n: turn the type by n.
// Tests: web/tests/port/routines_story.mjs (no recording reaches the target minigames).
import {
  FZ, FN, FH, FC, WRAM_ACTORS, BANK_STORY, hook, testFlagF, addFlags, zf, bitFlags, spAddFlags,
} from "./common.js";
import { clearMemory16, copyMemoryFast } from "../home/memory.js";
import { vectorFromLengthAndAngle, vectorFromLengthAndAngleRaw } from "../home/math.js";
import { queueSprite, queueSpriteTemplate } from "../home/fade.js";
import { playSoundManaged } from "../audio/requests.js";

const BANK = BANK_STORY;
const wMinigameTargets = 0xDC00, NUM_TARGETS = 0x0F, TARGET_SIZE = 0x0E, wMinigameTargetWork = 0xDCF0;
const T_FLAGS = 0, T_TYPE = 1, T_FLASH = 2, T_WAIT = 3, T_SCRIPT = 4, T_X = 6, T_Y = 8, T_GOAL_X = 10, T_GOAL_Y = 12;
const TARGET_ACTIVE = 0x01, TARGET_MOVING = 0x02, TARGET_HIT = 0x04;
const work = off => wMinigameTargetWork + off;
const MinigameTargetTable = 0x66F6, DrawMinigameTargetTable = 0x66FE, DrawMinigameTarget_SpriteTemplate = 0x670E;
const MinigameTargetAltTable = 0x6DA5, DrawMinigameTargetAltTable = 0x6DAD, DrawMinigameTargetAlt_SpriteTemplate = 0x6DBD;
const MinigameTargetOpHandlers_0a = 0x6809, SpawnMinigameTargetFormationTable = 0x6C7D;
const TARGET_STEP = 0x0010, HIT_WINDOW = 0x0200, ALT_HIT_WINDOW = 0x0400, HIT_FLASH = 0x20;
const SFX_BALL_CONTACT = 0x77, SFX_CHIME = 0x97;
const BANK_MATCH = 0x08, ApplyCameraProjection = 0x59BB, FormatDecimalNumber = 0x1972;
const BALL_X = 30, BALL_Y = 32;                   // the ball's position in wBallHistory
const DIGIT_TILES = 0x08, DIGIT_WIDTH = 8;

// InitMinigameTargets (0A:6596): no targets; on; no hit. WRAM 4.
export function initMinigameTargets(P) {
  P.wramBank(WRAM_ACTORS);
  const hl = clearMemory16(P, wMinigameTargets, 0x10);
  P.V.minigameTargetsActive = 1;
  P.V.minigameHitTargetType = 0xFF;
  return { a: 0xFF, c: 0, hl, f: FZ | FN };
}
// ActivateMinigameTarget (0A:65AF): target bc runs script de, type 0.
export function activateMinigameTarget(P, bc, script, f = 0) {
  const { bus } = P;
  bus.w16(bc + T_SCRIPT, script);
  bus.w8(bc + T_TYPE, 0);
  bus.w8(bc, bus.u8(bc) | TARGET_ACTIVE);
  return { a: script & 0xFF, hl: bc, f: f & FZ };
}
// UpdateMinigameTargets (0A:65C3): every target, while they are on.
export function updateMinigameTargets(P) {
  const a = P.V.minigameTargetsActive;
  if (!a) return { a, f: FZ | FH };
  let hl = wMinigameTargets;
  for (let c = NUM_TARGETS; c > 0; c--) { updateMinigameTarget(P, hl); hl = (hl + TARGET_SIZE) & 0xFFFF; }
  return { a, c: 0, de: TARGET_SIZE, hl, f: FZ | FN };
}
// UpdateMinigameTarget (0A:65D8): one active target (above). Returns its flags test's (bit 0 of the target).
export function updateMinigameTarget(P, hl, f = 0) {
  const { bus } = P;
  if (!(bus.u8(hl) & TARGET_ACTIVE)) return { f: bitFlags(false, f & FC) };
  copyMemoryFast(P, hl, wMinigameTargetWork, 1);
  if (bus.u8(work(T_FLASH))) bus.w8(work(T_FLASH), bus.u8(work(T_FLASH)) - 1);
  runMinigameTargetScript(P);
  moveMinigameTargetTowardGoal(P);
  if (!P.V.minigameTargetsAltMode) {
    drawMinigameTarget(P);
    checkBallHitsMinigameTarget(P);
    handleMinigameTargetHit(P);
  } else {
    drawMinigameTargetAlt(P);
    checkBallHitsMinigameTargetAlt(P);
    handleMinigameTargetHitAlt(P);
  }
  copyMemoryFast(P, wMinigameTargetWork, hl, 1);
  return { f: bitFlags(true, f & FC) };
}
// MoveMinigameTargetTowardGoal (0A:661E): a moving target steps $10 toward its goal on each axis; there, it stops.
export function moveMinigameTargetTowardGoal(P) {
  const { bus } = P;
  if (!(bus.u8(work(T_FLAGS)) & TARGET_MOVING)) return { hl: work(T_FLAGS), f: FZ | FH };
  const step = (pos, goal) => {
    const d = (bus.u16(work(goal)) - bus.u16(work(pos))) & 0xFFFF;
    if (d) bus.w16(work(pos), bus.u16(work(pos)) + (d & 0x8000 ? -TARGET_STEP : TARGET_STEP));
  };
  step(T_X, T_GOAL_X);
  step(T_Y, T_GOAL_Y);
  const x = bus.u16(work(T_X)), dx = (bus.u16(work(T_GOAL_X)) - x) & 0xFFFF;
  if (dx) return { a: (dx >> 8) | (dx & 0xFF), f: 0, de: x, hl: dx };
  const y = bus.u16(work(T_Y)), dy = (bus.u16(work(T_GOAL_Y)) - y) & 0xFFFF;
  if (dy) return { a: (dy >> 8) | (dy & 0xFF), f: 0, de: y, hl: dy };
  bus.w8(work(T_FLAGS), bus.u8(work(T_FLAGS)) & ~TARGET_MOVING);
  return { a: 0, f: FZ, de: y, hl: work(T_FLAGS) };
}
// the target's screen position (bank 8's ApplyCameraProjection of (X, Y)): d, e
function projectTarget(P) {
  const r = P.callRom(BANK_MATCH, ApplyCameraProjection, { hl: P.bus.u16(work(T_X)), bc: P.bus.u16(work(T_Y)) });
  return { d: r.d, e: r.e };
}
// DrawMinigameTarget (0A:66AE): a deflecting target's 2 sprites, shaken along its type's direction while it
// flashes. Returns QueueSpriteTemplate's registers.
export function drawMinigameTarget(P) {
  const { bus } = P;
  let { d, e } = projectTarget(P);
  const flash = bus.u8(work(T_FLASH)) & 0x0F;
  if (flash) {
    const len = P.rom.u8(BANK, (DrawMinigameTargetTable + flash) & 0xFFFF);
    const t = bus.u8(work(T_TYPE)), angle = ((t >> 2) | (t << 6)) & 0xC0;
    const v = vectorFromLengthAndAngleRaw(P, len, angle);
    const c = e, b = d;
    e = (c + v.de) & 0xFF; d = (b + v.hl) & 0xFF;
  }
  const at = (MinigameTargetTable + ((bus.u8(work(T_TYPE)) * 2) & 0xFF)) & 0xFFFF;
  return queueSpriteTemplate(P, DrawMinigameTarget_SpriteTemplate, d, e, P.rom.u8(BANK, at), P.rom.u8(BANK, at + 1), P.cpu.sp - 2);
}
// HandleMinigameTargetHit (0A:6717): a hit deflecting target sounds, flashes and pushes the ball.
export function handleMinigameTargetHit(P) {
  const { bus } = P;
  if (!(bus.u8(work(T_FLAGS)) & TARGET_HIT)) return { hl: work(T_FLAGS), f: FZ | FH };
  bus.w8(work(T_FLAGS), bus.u8(work(T_FLAGS)) & ~TARGET_HIT);
  playSoundManaged(P, SFX_BALL_CONTACT);
  bus.w8(work(T_FLASH), HIT_FLASH);
  return deflectBallOffMinigameTarget(P, bus.u8(work(T_TYPE)));
}
// CheckBallHitsMinigameTarget (0A:672D) / CheckBallHitsMinigameTargetAlt (0A:6DF4): once the ball has crossed the
// net, a hit when it is within 2 tiles (4 for the alt targets) before the target on both axes. The alt check
// also notes wMinigameHitPending.
export function checkBallHitsMinigameTarget(P) { return checkHit(P, HIT_WINDOW, false); }
export function checkBallHitsMinigameTargetAlt(P) { return checkHit(P, ALT_HIT_WINDOW, true); }
function checkHit(P, window, alt) {
  const { bus } = P, crossed = bus.u8(P.A.ballCrossedNetFlag);
  if (!crossed) return { a: 0, f: FZ | FH };
  if (alt) P.V.minigameHitPending = 1;
  // one axis: hit when -window <= pos - ball < 0 (bit 7 of the difference, then of it + window)
  const axis = (pos, ball) => {
    const de = bus.u16(P.A.ballHistory + ball), p = bus.u16(work(pos)), d = (p - de) & 0xFFFF, a = d >> 8;
    if (!(d & 0x8000)) return { ok: false, a, de, hl: d, f: bitFlags(false, p < de ? FC : 0) };
    const sum = d + window, h = sum & 0xFFFF, carry = sum > 0xFFFF ? FC : 0;
    return { ok: !(h & 0x8000), a, de: window, hl: h, f: bitFlags(!!(h & 0x8000), carry) };
  };
  let r = axis(T_X, BALL_X);
  if (!r.ok) { const { ok, ...out } = r; return out; }
  r = axis(T_Y, BALL_Y);
  if (!r.ok) { const { ok, ...out } = r; return out; }
  bus.w8(work(T_FLAGS), bus.u8(work(T_FLAGS)) | TARGET_HIT);
  return { a: r.a, de: r.de, hl: work(T_FLAGS), f: r.f };
}
// DeflectBallOffMinigameTarget (0A:6774): push the ball by type & 3: 0 +6 tiles in X, 1 up and half the depth
// speed, 2 -6 tiles in X, 3 down and half the depth speed.
export function deflectBallOffMinigameTarget(P, type) {
  const { bus } = P, t = type & 3;
  const addX = de => {
    const at = P.A.ballVelocityX, lo = bus.u8(at) + (de & 0xFF), carry = lo > 0xFF ? 1 : 0, old = bus.u8(at + 1);
    const hi = (old + (de >> 8) + carry) & 0xFF;
    bus.w8(at, lo); bus.w8(at + 1, hi);
    return { a: hi, de, hl: at + 2, f: addFlags(old, de >> 8, carry) };
  };
  const halveDepth = bc => {
    bus.w16(P.A.ballVelocityHeight, bc);
    const d = bus.u16(P.A.ballVelocityDepth), half = ((d >> 1) | (d & 0x8000)) & 0xFFFF;
    bus.w16(P.A.ballVelocityDepth, half);
    return { a: half & 0xFF, bc, de: half, hl: P.A.ballVelocityDepth + 1, f: zf(half & 0xFF) | (d & 1 ? FC : 0) };
  };
  if (t === 0) return addX(0x0600);
  if (t === 1) return halveDepth(0x0800);
  if (t === 2) return addX(0xFA00);
  return halveDepth(0xF400);
}

// DrawNumberWithSprites (0A:67CA): hl in decimal (padded to a digits) as sprites from (d, e), attribute b (the
// digits built on the stack by FormatDecimalNumber). Returns de moved past the digits.
export function drawNumberWithSprites(P, a, b, de, hl) {
  const { cpu } = P, sp = cpu.sp, buf = (sp - 16) & 0xFFFF;
  cpu.sp = (sp - 20) & 0xFFFF;                                    // push af, bc, hl; add sp, -10; push bc, de
  P.callRom(0, FormatDecimalNumber, { a, hl, de: buf, bc: buf });
  const r = drawDigitSpritesString(P, buf, b, de);
  cpu.sp = sp;
  return { de: r.de };
}
// DrawDigitSpritesString (0A:67EB): the digits of the string at hl (non-digits leave a gap), 8 pixels apart.
export function drawDigitSpritesString(P, hl, b, de) {
  let r = { de };
  for (;;) {
    const a = P.bus.u8(hl); hl = (hl + 1) & 0xFFFF;
    if (!a) return { ...r, a: 0, f: FZ | FH, hl };
    r = { ...r, ...drawDigitSprite(P, a, b, r.de) };
  }
}
// DrawDigitSprite_0a (0A:67F5): one digit character's sprite (tile 8 + 2 * digit) at (d, e); d += 8.
export function drawDigitSprite(P, a, b, de) {
  const digit = (a - 0x30) & 0xFF;
  let out = {};
  if (a >= 0x30) {
    const c = (digit * 2 + DIGIT_TILES) & 0xFF;
    queueSprite(P, b, c, de >> 8, de & 0xFF);
    out = { c };
  }
  const d = ((de >> 8) + DIGIT_WIDTH) & 0xFF;
  return { ...out, a: d, de: d << 8 | (de & 0xFF), f: addFlags((de >> 8), DIGIT_WIDTH) };
}

// ---- target scripts (in bank $0A, read through the bank mapped) ----
const rd = (P, at) => P.bus.u8(at & 0xFFFF);
// MinigameTargetOp_00 (0A:681B): yield.
export const minigameTargetOp00 = (P, de) => ({ a: 0, f: FZ, de });
// MinigameTargetOp_01 (0A:681D) n: wait n frames.
export function minigameTargetOp01(P, de) {
  P.bus.w8(work(T_WAIT), rd(P, de + 1) - 1);
  return { a: 0, f: FZ, de: (de + 2) & 0xFFFF };
}
// MinigameTargetOp_02 (0A:6826) rel: de = the operand's address + the word there.
export function minigameTargetOp02(P, de) {
  const at = (de + 1) & 0xFFFF, hl = (at + (rd(P, at) | rd(P, at + 1) << 8)) & 0xFFFF;
  return { a: 1, de: hl, hl };
}
// MinigameTargetOp_03 (0A:6833) addr: call native code (with de past the operand).
export function minigameTargetOp03(P, de) {
  const hl = rd(P, de + 1) | rd(P, de + 2) << 8, next = (de + 3) & 0xFFFF;
  const r = P.callRom(P.V.romBank, hl, { a: hl >> 8, de: next, hl });
  return { a: r.a, f: r.f, bc: r.bc, hl: r.hl, de: next };
}
// MinigameTargetOp_04 (0A:6840): wait until the target has arrived.
export function minigameTargetOp04(P, de) {
  if (P.bus.u8(work(T_FLAGS)) & TARGET_MOVING) return { a: 0, f: FZ, hl: work(T_FLAGS), de };
  return { a: 1, f: FZ | FH, hl: work(T_FLAGS), de: (de + 1) & 0xFFFF };
}
// MinigameTargetOp_05 (0A:684D) x, y: stand there.
export function minigameTargetOp05(P, de) {
  const { bus } = P;
  for (let i = 0; i < 4; i++) bus.w8(work(T_X) + i, rd(P, de + 1 + i));
  bus.w8(work(T_FLAGS), bus.u8(work(T_FLAGS)) & ~TARGET_MOVING);
  return { a: 1, de: (de + 5) & 0xFFFF, hl: work(T_FLAGS) };
}
// MinigameTargetOp_06 (0A:6869) angle, length: the goal that far along the angle; it moves.
export function minigameTargetOp06(P, de) {
  const { bus } = P, angle = rd(P, de + 1), len = rd(P, de + 2) | rd(P, de + 3) << 8;
  const v = vectorFromLengthAndAngle(P, len, angle);
  const gx = (bus.u16(work(T_X)) + v.hl) & 0xFFFF;
  bus.w16(work(T_GOAL_X), gx);
  bus.w16(work(T_GOAL_Y), bus.u16(work(T_Y)) + v.de);
  bus.w8(work(T_FLAGS), bus.u8(work(T_FLAGS)) | TARGET_MOVING);
  return { a: 1, bc: gx, de: (de + 4) & 0xFFFF, hl: work(T_FLAGS) };
}
// MinigameTargetOp_07 (0A:68A1) type: set the type.
export function minigameTargetOp07(P, de) {
  const t = rd(P, de + 1);
  P.bus.w8(work(T_TYPE), t);
  return { a: 1, de: (de + 2) & 0xFFFF };
}
// MinigameTargetOp_08 (0A:68AA) n: the type turned by n (of 4).
export function minigameTargetOp08(P, de) {
  const t = (rd(P, de + 1) + P.bus.u8(work(T_TYPE))) & 3;
  P.bus.w8(work(T_TYPE), t);
  return { a: 1, de: (de + 2) & 0xFFFF, hl: work(T_TYPE) };
}
const TARGET_OPS = new Map([
  [0x681B, minigameTargetOp00], [0x681D, minigameTargetOp01], [0x6826, minigameTargetOp02], [0x6833, minigameTargetOp03],
  [0x6840, minigameTargetOp04], [0x684D, minigameTargetOp05], [0x6869, minigameTargetOp06], [0x68A1, minigameTargetOp07],
  [0x68AA, minigameTargetOp08],
]);
// RunMinigameTargetScript (0A:68B7): the target's wait counts down, else its script runs (ops while they return
// a != 0), the pointer kept after each.
export function runMinigameTargetScript(P) {
  const { bus } = P;
  const waitAt = work(T_WAIT), wait = bus.u8(waitAt);
  if (wait) { bus.w8(waitAt, wait - 1); return { a: wait, hl: waitAt, f: zf(wait - 1) | FN | ((wait & 0x0F) === 0 ? FH : 0) }; }
  let de = bus.u16(work(T_SCRIPT)), r;
  do {
    const op = rd(P, de), handler = P.rom.u16(BANK, (MinigameTargetOpHandlers_0a + ((op * 2) & 0xFF)) & 0xFFFF);
    const fn = TARGET_OPS.get(handler);
    if (!fn) throw new Error(`minigame target op ${op} at ${de.toString(16)}: no handler`);
    r = fn(P, de);
    de = r.de;
    bus.w16(work(T_SCRIPT), de);
  } while (r.a);
  return { ...r, a: 0, f: FZ | FH, de, hl: work(T_SCRIPT) + 1 };
}
// SpawnMinigameTargetFormation (0A:6C7B): formation a (0-8) of targets, each with its script.
export function spawnMinigameTargetFormation(P, a) {
  const entry = P.rom.u16(BANK, (SpawnMinigameTargetFormationTable + ((a * 2) & 0xFF)) & 0xFFFF);
  // each SpawnMinigameTargetFormationN is `ld hl, list / call SpawnMinigameTargetsFromList / ret`
  return spawnMinigameTargetsFromList(P, P.rom.u16(BANK, entry + 1));
}
// SpawnMinigameTargetsFromList (0A:6D52): a target for each script of the 0-ended list hl, from the first slot.
export function spawnMinigameTargetsFromList(P, hl) {
  let bc = wMinigameTargets;
  for (;;) {
    const de = P.rom.u16(BANK, hl); hl = (hl + 2) & 0xFFFF;
    if (!de) return { a: 0, f: FZ, bc, de, hl };
    activateMinigameTarget(P, bc, de);
    bc = (bc + TARGET_SIZE) & 0xFFFF;
  }
}
// DrawMinigameTargetAlt (0A:6D6E): an alt target's 8 sprites, shaken sideways while it flashes.
export function drawMinigameTargetAlt(P) {
  const { bus } = P;
  let { d, e } = projectTarget(P);
  const flash = bus.u8(work(T_FLASH)) & 0x0F;
  if (flash) d = (P.rom.u8(BANK, (DrawMinigameTargetAltTable + flash) & 0xFFFF) + d) & 0xFF;
  const at = (MinigameTargetAltTable + ((bus.u8(work(T_TYPE)) * 2) & 0xFF)) & 0xFFFF;
  return queueSpriteTemplate(P, DrawMinigameTargetAlt_SpriteTemplate, d, e, P.rom.u8(BANK, at), P.rom.u8(BANK, at + 1), P.cpu.sp - 2);
}
// HandleMinigameTargetHitAlt (0A:6DDE): a hit alt target chimes, flashes and reports its type.
export function handleMinigameTargetHitAlt(P) {
  const { bus } = P;
  if (!(bus.u8(work(T_FLAGS)) & TARGET_HIT)) return { hl: work(T_FLAGS), f: FZ | FH };
  bus.w8(work(T_FLAGS), bus.u8(work(T_FLAGS)) & ~TARGET_HIT);
  playSoundManaged(P, SFX_CHIME);
  bus.w8(work(T_FLASH), HIT_FLASH);
  const a = bus.u8(work(T_TYPE));
  P.V.minigameHitTargetType = a;
  return { a, hl: work(T_FLAGS) };
}

export const HOOKS = [
  [BANK, 0x6596, hook(P => initMinigameTargets(P))],
  [BANK, 0x65AF, hook((P, c) => activateMinigameTarget(P, c.bc, c.de, c.f))],
  [BANK, 0x65C3, hook(P => updateMinigameTargets(P))],
  [BANK, 0x65D8, hook((P, c) => updateMinigameTarget(P, c.hl, c.f))],
  [BANK, 0x661E, hook(P => moveMinigameTargetTowardGoal(P))],
  [BANK, 0x66AE, hook(P => drawMinigameTarget(P))],
  [BANK, 0x6717, hook(P => handleMinigameTargetHit(P))],
  [BANK, 0x672D, hook(P => checkBallHitsMinigameTarget(P))],
  [BANK, 0x6774, hook((P, c) => deflectBallOffMinigameTarget(P, c.a))],
  [BANK, 0x67CA, hook((P, c) => drawNumberWithSprites(P, c.a, c.b, c.de, c.hl))],
  [BANK, 0x67EB, hook((P, c) => drawDigitSpritesString(P, c.hl, c.b, c.de))],
  [BANK, 0x67F5, hook((P, c) => drawDigitSprite(P, c.a, c.b, c.de))],
  ...[...TARGET_OPS].map(([addr, fn]) => [BANK, addr, hook((P, c) => fn(P, c.de))]),
  [BANK, 0x68B7, hook(P => runMinigameTargetScript(P))],
  [BANK, 0x6C7B, hook((P, c) => spawnMinigameTargetFormation(P, c.a))],
  [BANK, 0x6D52, hook((P, c) => spawnMinigameTargetsFromList(P, c.hl))],
  [BANK, 0x6D6E, hook(P => drawMinigameTargetAlt(P))],
  [BANK, 0x6DDE, hook(P => handleMinigameTargetHitAlt(P))],
  [BANK, 0x6DF4, hook(P => checkBallHitsMinigameTargetAlt(P))],
];
