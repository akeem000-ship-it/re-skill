// Animations, flag conditions and spawning (bank 4, $4BBB-$4F74): starting an actor's animation, the condition
// words of the map records (EvalFlagCondition), spawning one actor from a 14-byte map_actor record or a list of
// them, and the player, its follower and the doubles partner that every location spawns first.
// Port of scripted_04.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm),
// whose routine names these are.
//
// A map_actor record (wActorTemplate, 14 bytes): [condition(2), script(2), X(2), Y(2), facing, 0, object,
// animation, attribute (0: the object's), 0]; a list ends with a record whose byte 9 is $FF. The condition
// (EvalFlagCondition): 0 always; flag n: only while event flag n is clear; $8000 | n: only while it is set.
// An actor whose condition fails is still spawned (it keeps its slot) but idle and invisible.
// Tests: web/tests/port/routines_story.mjs; lockstep on out/engine/rec2.mtrec and out/port/story1.mtrec.
import {
  FZ, FN, FH, FC, WRAM_ACTORS, BANK_ACTORS, wActors, ACTORF_FLAGS, ACTORF_X, ACTORF_Y, ACTORF_TARGET_X,
  ACTORF_TARGET_Y, ACTORF_HEADING, ACTORF_ANIM_SPEED, ACTORF_ANIM_SPEED_MOVING, ACTORF_GFX_BANK, ACTORF_ANIM_TABLE,
  ACTORF_ANIM_BASE, ACTORF_ANIM_PTR, ACTORF_ANIM_ID, ACTORF_ANIM_DELAY, ACTORF_DRAW_DELAY, ACTORF_OAM_ATTR,
  ACTORFLAG_SOLID, ACTORFLAG_TALKABLE, FLAG_DOUBLES, a16, w8, w16, setBits, hook, testFlagOp, testFlag, testFlagF,
  addFlags, flagOperand,
} from "./common.js";
import { farReadWord, farCopyBytes } from "../home/palettes.js";
import {
  spawnActor, setActorPosition, setActorMode, attachActorControllerScript, attachActorWaypointFollower,
  attachActorStepMover, ActorScript_Idle,
} from "./actor_slots.js";
import { loadActorObjectDef } from "./actor_objdefs.js";

const BANK = BANK_ACTORS;
const ObjectIdList_04 = 0x4F75, CharObjectIdTable = 0x4C29;
const ScriptedActorListPtrs_04 = 0x4E5F;       // the player's map_actor record per walk sprite (Alex, Nina, Harry, Kate)
const ActorList_04_1 = 0x4DA5, ScriptedActorSceneActorList0 = 0x4E05, ScriptedActorSceneActorList1 = 0x4E1D;
const CompanionActorPartnerActorList0 = 0x4EC8, CompanionActorPartnerActorList1 = 0x4EE0;
const CompanionActorPartnerActorList2 = 0x4EF8;
const TEMPLATE_SIZE = 14, TEMPLATE_END_BYTE = 9;
const NO_COMPANION = 0xFF;
const PLAYER_PALETTE_BASE = 3;                 // the player's palette: its colour choice + 3
const wCharSpriteAttr = 0xDF37;                // (in the actor bank: SetActorAnimation clears its flip bits)
const nullTestFlags = (b, f) => (b === 0 ? FZ : 0) | FN | (((b + 1) & 0x0F) === 0 ? FH : 0) | (f & FC);
const fieldAt = (actor, off) => (actor & 0xFF00) | ((actor + off) & 0xFF);

// SetActorAnimationChecked (04:4BBB) / SetActorAnimation (04:4BBE): start animation d of actor bc (unless it is
// running already): the script's start from the object's animation table, in its walk-sprite bank. Keeps the
// registers (the checked one returns the flags of its null test of bc). WRAM bank 4.
export function setActorAnimationChecked(P, actor, anim, f = 0) {
  if (actor >> 8) setActorAnimation(P, actor, anim);
  return nullTestFlags(actor >> 8, f);
}
export function setActorAnimation(P, actor, anim) {
  const { bus } = P;
  P.wramBank(WRAM_ACTORS);
  const idAt = actor + ACTORF_ANIM_ID;
  if (bus.u8(idAt) === anim) return;
  bus.w8(idAt, anim);
  bus.w8(actor + ACTORF_ANIM_DELAY, 0);
  bus.w8(wCharSpriteAttr, bus.u8(wCharSpriteAttr) & 0x0F);
  const table = a16(P, actor, ACTORF_ANIM_TABLE);
  const entry = (table + ((anim * 2) & 0xFF)) & 0xFFFF;
  const script = farReadWord(P, bus.u8(actor + ACTORF_GFX_BANK), entry);
  w16(P, actor, ACTORF_ANIM_BASE, script);
  w16(P, actor, ACTORF_ANIM_PTR, script);
}

// GetObjectDefCount (04:4C0B): the number of objects in ObjectIdList_04 (up to its 0, 0 end).
export function getObjectDefCount(P) {
  let c = 0;
  for (let at = ObjectIdList_04; P.rom.u16(BANK, at); at += 2) c++;
  return { a: c & 0xFF, f: FZ };
}
// Unused_04_GetCharObjectId (04:4C1D): the overworld object of character id a. Nothing calls it.
export function unusedGetCharObjectId(P, a) {
  return { a: P.rom.u8(BANK, (CharObjectIdTable + a) & 0xFFFF), f: addFlags(a, CharObjectIdTable & 0xFF) };
}

// EvalFlagCondition (04:4C49): a map record's condition de. Z (a = 0) when it holds: 0; flag n clear; $8000 | n
// with n set. Returns { holds, a, f, de } (TestGameFlag leaves de = the flag's byte index).
export function evalFlagCondition(P, cond) {
  if (!cond) return { holds: true, a: 0, f: FZ };
  const d = cond >> 8, e = cond & 0xFF;
  if (!(d & 0x80)) {
    const set = testFlagOp(P, cond);
    return { holds: !set, a: d | e, f: testFlagF(set), de: d };
  }
  const set = testFlagOp(P, cond & 0x7FFF);
  return set ? { holds: true, a: 0, f: FZ, de: d & 0x7F } : { holds: false, a: 1, f: 0, de: d & 0x7F };
}

// SpawnActorFromTemplate (04:4C60): spawn the map_actor record at hl (its script in bank a): position (and
// target), facing, object, animation, attribute override, solid and talkable; it is first drawn after a delay
// that staggers the slots ((slot * 4) >> 8 & $0F frames), and animates at speed 1 (2 while moving). If the
// condition fails: an idle actor (ActorScript_Idle, in the bank mapped now). Returns the slot (bc).
export function spawnActorFromTemplate(P, bank, rec) {
  const { bus } = P, rd = i => bus.u8((rec + i) & 0xFFFF);
  if (!evalFlagCondition(P, rd(0) | rd(1) << 8).holds) return spawnActor(P, P.V.romBank, ActorScript_Idle);
  const slot = spawnActor(P, bank, rd(2) | rd(3) << 8);
  if (!(slot >> 8)) return slot;
  bus.w8(fieldAt(slot, ACTORF_X), rd(4)); bus.w8(fieldAt(slot, ACTORF_X) + 1, rd(5));
  bus.w8(fieldAt(slot, ACTORF_TARGET_X), rd(4)); bus.w8(fieldAt(slot, ACTORF_TARGET_X) + 1, rd(5));
  bus.w8(fieldAt(slot, ACTORF_Y), rd(6)); bus.w8(fieldAt(slot, ACTORF_Y) + 1, rd(7));
  bus.w8(fieldAt(slot, ACTORF_TARGET_Y), rd(6)); bus.w8(fieldAt(slot, ACTORF_TARGET_Y) + 1, rd(7));
  bus.w8(fieldAt(slot, ACTORF_HEADING), rd(8));
  loadActorObjectDef(P, slot, rd(10));
  setActorAnimation(P, slot, rd(11));
  if (rd(12)) bus.w8(fieldAt(slot, ACTORF_OAM_ATTR), rd(12));
  setBits(P, slot + ACTORF_FLAGS, ACTORFLAG_SOLID);
  setBits(P, slot + ACTORF_FLAGS, ACTORFLAG_TALKABLE);
  w8(P, slot, ACTORF_DRAW_DELAY, ((slot << 2) >> 8) & 0x0F);
  w8(P, slot, ACTORF_ANIM_SPEED, 1);
  w8(P, slot, ACTORF_ANIM_SPEED_MOVING, 2);
  return slot;
}

// SpawnActorsFromList (04:4CF7): spawn every map_actor record of the list at hl in bank a (each copied to
// wActorTemplate first, the list's bank mapped for the copy). WRAM bank 4 meanwhile. Keeps the registers.
export function spawnActorsFromList(P, bank, list) {
  const { bus } = P, old = P.V.wramBank;
  P.wramBank(WRAM_ACTORS);
  let hl = list;
  for (;;) {
    hl = farCopyBytes(P, bank, hl, P.A.actorTemplate, TEMPLATE_SIZE).hl;
    if (bus.u8(P.A.actorTemplate + TEMPLATE_END_BYTE) === 0xFF) break;
    spawnActorFromTemplate(P, bank, P.A.actorTemplate);
  }
  P.wramBank(old);
}

// Unused_04_SpawnScriptedActorScene (04:4D2C): a test scene: a pad-controlled Alex, a follower at (23, 29), a
// Mario trailing the player and four more Marios. Nothing calls it. Returns the registers it leaves.
export function unusedSpawnScriptedActorScene(P, f) {
  const bank = P.V.romBank;
  let bc = spawnActorFromTemplate(P, bank, ActorList_04_1);
  attachActorControllerScript(P, bc);
  bc = spawnActor(P, P.V.romBank, ActorScript_Idle);
  setActorPosition(P, bc, 0x1700, 0x1D00);
  attachActorWaypointFollower(P, bc, wActors);
  bc = spawnActorFromTemplate(P, P.V.romBank, ScriptedActorSceneActorList0);
  const ff = attachActorStepMover(P, bc, wActors, f);
  spawnActorsFromList(P, P.V.romBank, ScriptedActorSceneActorList1);
  return { a: P.V.romBank, f: ff, bc, de: wActors, hl: ScriptedActorSceneActorList1 };
}

// SpawnMainCharacterActor (04:4E6B): the player at (hl, de) facing c, as its walk sprite (one of four records),
// with its palette choice; and its follower (slot 1) at the same place, walking after it. (The ROM spawns the
// follower with hl, the X position, as its script and a mode of $41 from d; both are set right after.) Keeps the
// registers. WRAM bank 4.
export function spawnMainCharacterActor(P, x, y, facing) {
  const { bus, V } = P;
  P.wramBank(WRAM_ACTORS);
  const rec = P.rom.u16(BANK, (ScriptedActorListPtrs_04 + ((V.storyModeMainCharacterOverworldSprite & 3) * 2)) & 0xFFFF);
  spawnActorFromTemplate(P, P.V.romBank, rec);
  bus.w8(wActors + ACTORF_HEADING, facing);
  bus.w8(P.A.playerMoveAngle, facing);
  setActorPosition(P, wActors, x, y);
  const follower = spawnActor(P, P.V.romBank, x);
  setActorMode(P, follower, ActorScript_Idle >> 8);
  attachActorWaypointFollower(P, follower, wActors);
  setActorPosition(P, follower, x, y);
  bus.w8(wActors + ACTORF_OAM_ATTR, (V.storyModeMainCharacterOverworldSpriteColor + PLAYER_PALETTE_BASE) & 0xFF);
}

// SpawnCompanionActor (04:4F10): in doubles, the partner (Harry or Kate by the partner's gender; its slot noted in
// wCompanionActorSlot) trailing the player, facing and standing where the player is; in singles a placeholder
// that deactivates itself (wCompanionActorSlot = $FF). Keeps the registers. WRAM bank 4.
export function spawnCompanionActor(P) {
  const { bus, V } = P;
  P.wramBank(WRAM_ACTORS);
  let list, slot;
  if (!V.storyModeGenderOfPartnerCharacter) { list = CompanionActorPartnerActorList0; slot = 2; }
  else { list = CompanionActorPartnerActorList1; slot = 3; }
  if (!testFlag(P, FLAG_DOUBLES)) { list = CompanionActorPartnerActorList2; slot = NO_COMPANION; }
  V.companionActorSlot = slot;
  const bc = spawnActorFromTemplate(P, P.V.romBank, list);
  if (V.companionActorSlot === NO_COMPANION) return;
  attachActorStepMover(P, bc, wActors);
  bus.w8(bc + ACTORF_HEADING, bus.u8(wActors + ACTORF_HEADING));
  setActorPosition(P, bc, bus.u16(wActors + ACTORF_X), bus.u16(wActors + ACTORF_Y));
}

export const HOOKS = [
  [BANK, 0x4BBB, hook((P, c) => ({ f: setActorAnimationChecked(P, c.bc, c.d, c.f) }))],
  [BANK, 0x4BBE, hook((P, c) => { setActorAnimation(P, c.bc, c.d); })],
  [BANK, 0x4C0B, hook(P => getObjectDefCount(P))],
  [BANK, 0x4C1D, hook((P, c) => unusedGetCharObjectId(P, c.a))],
  [BANK, 0x4C49, hook((P, c) => { const { holds, ...r } = evalFlagCondition(P, c.de); return r; })],
  [BANK, 0x4C60, hook((P, c) => ({ bc: spawnActorFromTemplate(P, c.a, c.hl) }))],
  [BANK, 0x4CF7, hook((P, c) => { spawnActorsFromList(P, c.a, c.hl); })],
  [BANK, 0x4D2C, hook((P, c) => unusedSpawnScriptedActorScene(P, c.f))],
  [BANK, 0x4E6B, hook((P, c) => { spawnMainCharacterActor(P, c.hl, c.de, c.c); })],
  [BANK, 0x4F10, hook(P => { spawnCompanionActor(P); })],
];
