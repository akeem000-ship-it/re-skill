// Bank 0A's script API (the exports of 0A:4000 the map scripts of banks 30-35 far-call: REVERSE.md "Script API"):
// the script actor's begin / end, the actors moved, turned, animated and waited for, the screen shake. The text
// calls (ScriptSetText, ScriptShowText, ScriptAskYesNo ...) are msgbox.js. Waits are generators (yield* at every
// caller: each AdvanceFrame is a frame of the engine). Most of these leave WRAM bank 4 mapped as the ROM does.
import * as D from "./render/display.js";
import { rb } from "./rom.js";
import { actorSlotAddr, actorSetPos, actorSetFacing } from "./actors.js";
import { actorSetAnim } from "./render/actors.js";
import { angleFromVectorCoarse, vectorFromLengthAndAngle } from "./math.js";
import { advanceRandomSeed } from "./round.js";
import { registerFrameTask, unregisterFrameTask } from "./tasks.js";
import * as Scr from "./screen.js";
import { restoreShadowFromMap } from "./shadow.js";
import * as W from "./windows.js";

export { actorSlotAddr, actorSetPos, actorSetFacing };
const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
const r16 = (w, a) => rd(w, a) | rd(w, (a + 1) & 0xFFFF) << 8;
const w16 = (w, a, v) => { wr(w, a, v & 0xFF); wr(w, (a + 1) & 0xFFFF, (v >> 8) & 0xFF); };
const testFlag = (w, n) => w.wram[0][0x840 + (n >> 3)] & (0x80 >> (n & 7));
const setFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] |= 0x80 >> (n & 7); };
const clearFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] &= ~(0x80 >> (n & 7)); };
const sub16 = (a, b) => (a - b) & 0xFFFF;        // 00:08AC SubDEFromHL
function notPorted(what) { throw new Error(`${what} is not ported`); }
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}
// hFFE0 = actor slot a's record; WRAM4 mapped (the head of most of these routines)
const select = (w, a) => {
  const hl = actorSlotAddr(a);
  w.high[0x1E0] = hl & 0xFF; w.high[0x1E1] = hl >> 8;
  setW(w, 4);
  return hl;
};
const fld = (w, n) => (w.high[0x1E1] << 8) | ((w.high[0x1E0] + n) & 0xFF);   // ($FFE0) + n, an 8-bit add on l
// the slot of the actor at wScriptActor $C292 (bits 6-7 of l and 0-3 of h), 0 for none
export const scriptActorSlot = w => {
  const hl = r16(w, 0xC292);
  return ((((hl >> 8) & 0x0F) << 2) | (hl & 0xFF) >> 6) & 0xFF;
};

// 0A:4066 ScriptDebugSkipTask (hDebugMode only: Start toggles flag #22 and wTextSpeed bit 7)
export function scriptDebugSkipTask(w) {
  if (!(w.high[0x194] & 8)) return;
  if (testFlag(w, 22)) { clearFlag(w, 22); wr(w, 0xC82D, rd(w, 0xC82D) | 0x80); }
  else { setFlag(w, 22); wr(w, 0xC82D, rd(w, 0xC82D) & 0x7F); }
}
// 0A:4092 ScriptBegin: wShakeLevel $FF, wScrollShake 0, the script actor's script reset; the debug task
export function scriptBegin(w) {
  wr(w, 0xC363, 0xFF); wr(w, 0xC368, 0); wr(w, 0xC369, 0);
  actorResetScript(w, scriptActorSlot(w));
  if (w.high[0x19E]) D.inBank(w, 0x0A, () => registerFrameTask(w, 0x01, 0x0A, 0x4066));
}
// 0A:40D6 ScriptEnd: the script actor's script 0A:4109 (ScriptActorIdleScriptData) in hROMBank (0A: it is always
// far-called), the debug task off, flag #22 cleared
export function scriptEnd(w) {
  wr(w, 0xC368, 0); wr(w, 0xC369, 0);
  actorSetScript(w, scriptActorSlot(w), 0x4109, 0x0A);
  unregisterFrameTask(w, 0x0A, 0x4066);
  clearFlag(w, 22);
}
// 0A:4120 ScriptRespawnActors: MapInitObjects (mapengine.js) with the list hl in bank a
// 0A:42FC ActorSetSpeed: +$0E = bc
export function actorSetSpeed(w, a, bc) {
  if (a === 0xFF) return;
  select(w, a);
  w16(w, fld(w, 0x0E), bc);
}
// 0A:431E ActorSetScript: +0 = de, +2 = b
export function actorSetScript(w, a, de, b) {
  if (a === 0xFF) return;
  select(w, a);
  w16(w, fld(w, 0), de); wr(w, fld(w, 2), b);
}
// 0A:4342 ActorResetScript: the script 0A:435D (a 0: the end) in hROMBank (0A)
export function actorResetScript(w, a) {
  if (a === 0xFF) return;
  const hl = actorSlotAddr(a);
  setW(w, 4);
  wr(w, hl, 0x5D); wr(w, hl + 1, 0x43); wr(w, hl + 2, 0x0A);
}
// 0A:410D ScriptWaitFrames: a frames (2 while flag #22 skips); a = 0: returns at once with af / bc left on the
// stack (never called so)
export function* scriptWaitFrames(sh, a) {
  if (testFlag(sh.w, 22)) a = 2;
  if (!a) notPorted("ScriptWaitFrames with a = 0 (~0A:411F: returns into its own pushes)");
  yield* sh.advance(a);                          // 00:2EF0 WaitFrames
}
// 0A:435E WaitActorScriptEnd: until the byte at the actor's script pointer is 0, at most 600 times; each wait is
// ScriptWaitFrames with whatever a holds: first the low byte of the actor's address ($00 / $40 / $80 / $C0), then
// the script byte just read (a quirk: the waits are long)
export function* waitActorScriptEnd(sh, a) {
  if (a === 0xFF) return;
  const w = sh.w;
  const hl = select(w, a);
  let wait = hl & 0xFF;
  for (let bc = 0x258; ;) {
    yield* scriptWaitFrames(sh, wait);
    const de = r16(w, hl);
    wait = de < 0x8000 ? rb(de < 0x4000 ? 0 : 0x0A, de) : rd(w, de);   // (read in bank 0A, not the script's)
    if (wait === 0) return;
    bc = (bc - 1) & 0xFFFF;
    if (!bc) return;
  }
}
// 0A:4393 WaitActorMoveDone: a frame at a time while +$12 bit 0 (at most 600)
export function* waitActorMoveDone(sh, a) {
  if (a === 0xFF) return;
  const w = sh.w;
  select(w, a);
  const hl = fld(w, 0x12);
  for (let bc = 0x258; ;) {
    yield* scriptWaitFrames(sh, 1);
    if (!(rd(w, hl) & 1)) return;
    bc = (bc - 1) & 0xFFFF;
    if (!bc) return;
  }
}
// 0A:4416 ActorMoveTo (0A:4445 ActorStartMoveTo): the target +$0A / +$0C = bc / de, +$12 = 1
export function actorMoveTo(w, a, bc, de) {
  if (a === 0xFF) return;
  select(w, a);
  actorStartMoveTo(w, bc, de);
}
function actorStartMoveTo(w, bc, de) {           // 0A:4445
  w16(w, fld(w, 0x0A), bc); w16(w, fld(w, 0x0C), de);
  wr(w, fld(w, 0x12), 1);
}
function actorCopyPos(w, bc, de) {               // 0A:43F5 ActorCopyPos: +4 / +6 = bc / de, +$12 = 0
  w16(w, fld(w, 4), bc); w16(w, fld(w, 6), de);
  wr(w, fld(w, 0x12), 0);
}
// 0A:4503 ActorMoveBy (0A:4532 ActorMoveByCalc; no callers): the target = the position + bc / de, +$12 = 1
export function actorMoveBy(w, a, bc, de) {
  if (a === 0xFF) return;
  select(w, a);
  w16(w, fld(w, 0x0A), (r16(w, fld(w, 4)) + bc) & 0xFFFF);
  w16(w, fld(w, 0x0C), (r16(w, fld(w, 6)) + de) & 0xFFFF);
  wr(w, fld(w, 0x12), 1);
}
// 0A:4587 ActorMoveDir (0A:45B6 ActorMoveDirCalc): the target = the position + VectorFromLengthAndAngle(de, b)
export function actorMoveDir(w, a, b, de) {
  if (a === 0xFF) return;
  select(w, a);
  const [x, y] = vectorFromLengthAndAngle(de, b);   // 00:0AF2
  w16(w, fld(w, 0x0A), (r16(w, fld(w, 4)) + x) & 0xFFFF);
  w16(w, fld(w, 0x0C), (r16(w, fld(w, 6)) + y) & 0xFFFF);
  wr(w, fld(w, 0x12), 1);
}
// 0A:460E ActorLockSpriteFacing: +$33 = b; b = 0 first turns the actor (+$10) to its drawn facing +$32
export function actorLockSpriteFacing(w, a, b) {
  if (a === 0xFF) return;
  select(w, a);
  if (!b) wr(w, fld(w, 0x10), rd(w, fld(w, 0x32)));
  wr(w, fld(w, 0x33), b);
}
// the angle from actor a to actor b (AngleFromVectorCoarse 00:0A7B of b's position less a's); hFFE0 left on a
function angleBetween(w, a, b) {
  select(w, b);
  const bx = r16(w, fld(w, 4)), by = r16(w, fld(w, 6));
  const ha = actorSlotAddr(a);
  w.high[0x1E0] = ha & 0xFF; w.high[0x1E1] = ha >> 8;
  const dy = sub16(by, r16(w, fld(w, 6))), dx = sub16(bx, r16(w, fld(w, 4)));
  return angleFromVectorCoarse(dy, dx, x => rb(0, x));
}
// 0A:4662 ActorFaceActor: actor a turns toward actor b
export function actorFaceActor(w, a, b) {
  if (a === 0xFF || b === 0xFF) return;
  const ang = angleBetween(w, a, b);             // (it points hFFE0 at actor a)
  wr(w, fld(w, 0x10), ang);
}
// 0A:46D4 ActorsFaceEachOther: a toward b, b the opposite way
export function actorsFaceEachOther(w, a, b) {
  if (a === 0xFF || b === 0xFF) return;
  const ang = angleBetween(w, a, b);
  wr(w, fld(w, 0x10), ang);
  const hb = actorSlotAddr(b);
  w.high[0x1E0] = hb & 0xFF; w.high[0x1E1] = hb >> 8;
  wr(w, fld(w, 0x10), (ang + 0x80) & 0xFF);
}
// 0A:475B ActorPlayAnim: actor b's animation a (04:4E4C ActorSetAnimChecked: none for slot $FF)
export function actorPlayAnim(w, b, a) {
  if (a === 0xFF) return;
  const hl = actorSlotAddr(b);
  if (hl >> 8) actorSetAnim(w, hl, a);           // 04:4E51
}
// 04:4E15 ActorAnimBusy: its animation +$31 is not 0 or 1
function actorAnimBusy(w, hl) {
  if (!(hl >> 8)) return 0;
  setW(w, 4);
  const a = rd(w, hl + 0x31);
  return a === 0 || a === 1 ? 0 : 1;
}
// 0A:4768 WaitActorAnimDone (04:4E36 WaitActorAnimIdle): unless flag #22, frames while the animation plays (<= $F0)
export function* waitActorAnimDone(sh, a) {
  const w = sh.w;
  if (testFlag(w, 22)) return;
  const hl = actorSlotAddr(a);
  for (let bc = 0xF0; actorAnimBusy(w, hl);) {
    yield* sh.advance();
    bc--;
    if (!bc) return;
  }
}
// 0A:4774 ActorJump: +$1C = de
export function actorJump(w, a, de) {
  if (a === 0xFF) return;
  const hl = actorSlotAddr(a);
  setW(w, 4);
  w16(w, (hl & 0xFF00) | ((hl + 0x1C) & 0xFF), de);
}
// 04:4551 ActorIsPushed
function actorIsPushed(w, hl) {
  if (!(hl >> 8)) return 0;
  setW(w, 4);
  return r16(w, hl + 0x1C) | r16(w, hl + 8);
}
// 0A:4788 WaitActorLanded (04:4575 WaitActorPushEnd): unless flag #22, frames while pushed (at most $78)
export function* waitActorLanded(sh, a) {
  const w = sh.w;
  if (testFlag(w, 22)) return;
  const hl = actorSlotAddr(a);
  for (let c = 0x78; actorIsPushed(w, hl);) {
    yield* sh.advance();
    c--;
    if (!c) return;
  }
}
// 0A:4794 ActorSetState: +$16 = b
export function actorSetState(w, a, b) {
  if (a === 0xFF) return;
  const hl = actorSlotAddr(a);
  setW(w, 4);
  wr(w, (hl + 0x16) & 0xFFFF, b);
}
// the script actor (wScriptActor) selected
const selectScriptActor = w => {
  const hl = r16(w, 0xC292);
  w.high[0x1E0] = hl & 0xFF; w.high[0x1E1] = hl >> 8;
  setW(w, 4);
};
// 0A:47A6 ScriptActorSetSpeed: the script actor's +$0E = bc
export function scriptActorSetSpeed(w, bc) {
  selectScriptActor(w);
  w16(w, fld(w, 0x0E), bc);
}
// the jump of ScriptActorGoTo / GoToActor: fade out ($7F), the position set, a frame, the shadow from the map, a
// frame, fade in
function* goToJump(sh, bc, de) {
  const w = sh.w;
  Scr.beginFadeOut(w, 0x7F);
  yield* Scr.waitFade(sh);
  actorCopyPos(w, bc, de);                       // (hFFE0 kept: still the script actor)
  yield* sh.advance();
  yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));   // 05:4492
  yield* sh.advance();
  Scr.beginFadeIn(w, 0x7F);
  yield* Scr.waitFade(sh);
}
// 0A:47C8 ScriptActorGoTo: the script actor to bc / de: a = 0 walks, else jumps there with a fade
export function* scriptActorGoTo(sh, a, bc, de) {
  selectScriptActor(sh.w);
  if (!a) actorStartMoveTo(sh.w, bc, de);
  else yield* goToJump(sh, bc, de);
}
// 0A:482A ScriptActorGoToActor: the same to actor a's position (b = 0 walks)
export function* scriptActorGoToActor(sh, a, b) {
  if (a === 0xFF) return;
  const w = sh.w;
  setW(w, 4);
  select(w, a);
  const bc = r16(w, fld(w, 4)), de = r16(w, fld(w, 6));
  selectScriptActor(w);
  if (!b) actorStartMoveTo(w, bc, de);
  else yield* goToJump(sh, bc, de);
}
// 0A:48AC WaitScriptActorIdle: a frame at a time while the script actor's +$12 bit 0 (at most 600)
export function* waitScriptActorIdle(sh) {
  const w = sh.w;
  selectScriptActor(w);
  const hl = fld(w, 0x12);
  for (let bc = 0x258; ;) {
    yield* scriptWaitFrames(sh, 1);
    if (!(rd(w, hl) & 1)) return;
    bc = (bc - 1) & 0xFFFF;
    if (!bc) return;
  }
}
// 0A:48DF ScriptShakeScreen: a = 0 stops it (when on), 1-3 (4 and up: 3) its strength, ScreenShakeTask registered
export function scriptShakeScreen(w, a) {
  const old = w.high[0x196];
  let v;
  if (a) {
    if (rd(w, 0xC363) === 0xFF) D.inBank(w, 0x0A, () => registerFrameTask(w, 0x01, 0x0A, 0x4927));
    v = a >= 4 ? 3 : a;
  } else if (rd(w, 0xC363) === 0xFF) v = 0;
  else {
    wr(w, 0xC368, 0); wr(w, 0xC369, 0);
    unregisterFrameTask(w, 0x0A, 0x4927);
    v = 0xFF;
  }
  wr(w, 0xC363, v);
  setW(w, old);
}
// 0A:4927 ScreenShakeTask: wScrollShake x / y = the random bytes & (2^level - 1) (the negate branch is dead: `and c`
// clears the carry)
export function screenShakeTask(w) {
  let a = rd(w, 0xC363), c = 0;
  do { c = ((c << 1) | 1) & 0xFF; a = (a - 1) & 0xFF; } while (a);
  const hl = advanceRandomSeed(w);               // 00:0A61
  wr(w, 0xC368, (hl >> 8) & c);
  wr(w, 0xC369, hl & c);
}

// 0A:42BF ScriptRunMenu (export $44): hl = the options' text id, (d, e) = the window's position: OpenMenuWindow
// 05:4BB0, the screen redrawn (05:4492, 05:4949), RunMenu 05:4CD7, CloseWindow 05:4C5C, redrawn again -> the row
// ($FF: B)
export function* scriptRunMenu(sh, hl, d, e) {
  const w = sh.w;
  const b = yield* inBankGen(w, 0x05, W.openMenuWindow(sh, hl, d, e));
  yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));
  yield* inBankGen(w, 0x05, W.updateWindows(sh));
  const c = yield* inBankGen(w, 0x05, W.runMenu05(sh));
  D.inBank(w, 0x05, () => W.closeWindow(w, b));
  yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));
  yield* inBankGen(w, 0x05, W.updateWindows(sh));
  return c;
}
