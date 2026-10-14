// Talking and looking (bank $0A, $51CF-$5573): the points ahead of the player its interactions probe, the actor
// or tile it faces, the map record lookup (id, facing mask, condition), running a record's handler (a message,
// or a script with the cutscene mode on), the return point the story saves before a match, the location-name
// popup, spawning a location's actors, its init script, and talking to an NPC.
// Port of story_interact_0a.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm), whose routine names these are; the map record format is in scene_triggers.js.
//
// An NPC talk record's arg6 (NPC_*): bit 0 turn to the player first (bit 1: and back after), bit 3 hold the walk
// animation while talking, bit 4 freeze the actor meanwhile. The record's id is the actor's slot.
// Tests: web/tests/port/routines_story.mjs; lockstep on out/engine/rec2.mtrec and out/port/story1.mtrec.
import {
  FZ, FN, FH, FC, WRAM_ACTORS, WRAM_TEXT, BANK_ACTORS, BANK_STORY, wActors, ACTORF_FLAGS, ACTORF_X, ACTORF_Y,
  ACTORF_HEADING, ACTORF_ANIM_SPEED_MOVING, ACTORF_ANIM_ID, ACTORF_STATUS, ACTORF_DRAWN_FACING,
  ACTORSTATUS_FACING_LOCKED, hook, hookGen, farcall, farcallGen, advanceFrame, withWramBank, cpFlags, testFlagOp,
  testFlagF, call, farcallRom, callHLInBankA, pushWord, dropWords,
} from "./common.js";
import { farReadWord, farCopyBytes, loadPaletteShadow } from "../home/palettes.js";
import { copyMemoryBC } from "../home/memory.js";
import { vectorFromLengthAndAngle } from "../home/math.js";
import { buildActorQueryList, findActorAtPoint } from "./actor_queries.js";
import { evalFlagCondition, setActorAnimationChecked, spawnMainCharacterActor, spawnCompanionActor, spawnActorsFromList } from "./scripted.js";
import { initActorEngine } from "./actor_slots.js";
import { readBehaviorMapCell } from "./scene_viewer.js";
import { getActorStateAddr, beginCutsceneScriptMode, endCutsceneScriptMode } from "./script.js";
import { waitPlayerMoveDone } from "./actor_waits.js";

const BANK = BANK_STORY;
const FacingMaskTable_0a = 0x53B9;        // the player's quadrant (angle >> 6) -> FACEMASK_* (right down left up)
const StoryObjPalettes = 0x5341, STORY_OBJ_PALETTES_FIRST = 8 + 3, STORY_OBJ_PALETTES = 5;
const FACEMASK_ANY = 0xFF, RECORD_END = 0xFF, RECORD_SIZE = 8;
const BEHAVIOR_TRIGGER = 0x01, BEHAVIOR_ACTION = 0x08, BEHAVIOR_TALK_REACH = 0x0C;
const NPC_FACE_PLAYER = 0x01, NPC_RESTORE_FACING = 0x02, NPC_IDLE_ANIM = 0x08, NPC_FREEZE = 0x10;
const ACTORF_BUSY = ACTORF_ANIM_SPEED_MOVING;   // ($19) set to 1 while the actor talks
const ANIM_WALK = 0x01, NO_TALK_ACTOR = 0x02;
const TALK_REACH = 0x01C0, TALK_REACH_FAR = 0x03C0, TALK_REACH_SIDE = 0x0180, TALK_SIDE_ANGLE = 0x10;
const SCRIPT_ADDR_BITS = 0xC0;                   // a handler with any of these in its high byte is a script, else a message
const SPEAKER_LOCATION_NAME = 0x83, NAME_POPUP_FRAMES = 0x50, rWY = 0xFF4A, WY_HIDDEN = 0x90;
const BANK_TEXT = 0x05, ShowSpeakerDialogue = 0x581F, ShowSpeakerDialogueRestoreBG = 0x58F0;
const CloseActiveDialogueWindow = 0x5A93;

// GetPointAheadOfActor (0A:51CF): the point de (a length) ahead of actor hl along its drawn facing + a. WRAM 4.
export function getPointAheadOfActor(P, actor, length, turn) {
  P.wramBank(WRAM_ACTORS);
  const v = vectorFromLengthAndAngle(P, length, (turn + P.bus.u8(actor + ACTORF_DRAWN_FACING)) & 0xFF);
  const y = (P.bus.u16(actor + ACTORF_Y) + v.de) & 0xFFFF, x = (P.bus.u16(actor + ACTORF_X) + v.hl) & 0xFFFF;
  return { hl: x, de: y };
}
// GetFacingTileInteractionId (0A:5200): the action id (high nibble) of the behaviour cell 1.75 tiles ahead of
// the player when it is an action cell, else 0.
export function getFacingTileInteractionId(P) {
  const p = getPointAheadOfActor(P, wActors, TALK_REACH, 0);
  const cell = farcall(P, BANK, () => readBehaviorMapCell(P, p.hl >> 8, p.de >> 8));
  if ((cell & 0x0F) !== BEHAVIOR_ACTION) return { a: 0, f: cpFlags(cell & 0x0F, BEHAVIOR_ACTION) };
  const id = cell >> 4;
  return { a: id, f: (id ? 0 : FZ) | FH };
}
// FindActorFacingPlayer (0A:5227): the talkable actor in front of the player: 1.75 tiles ahead (3.75 over a
// long-reach cell), then 1.5 tiles ahead turned $10 either way. Its slot index in a (0: none).
export function findActorFacingPlayer(P) {
  P.wramBank(WRAM_ACTORS);
  farcall(P, BANK_ACTORS, () => buildActorQueryList(P));
  let p = getPointAheadOfActor(P, wActors, TALK_REACH, 0);
  const cell = farcall(P, BANK, () => readBehaviorMapCell(P, p.hl >> 8, p.de >> 8));
  if ((cell & 0x0F) === BEHAVIOR_TALK_REACH) p = getPointAheadOfActor(P, wActors, TALK_REACH_FAR, 0);
  let r = farcall(P, BANK_ACTORS, () => findActorAtPoint(P, p.hl, p.de));
  if (r.a) return { a: r.a, f: FH };
  p = getPointAheadOfActor(P, wActors, TALK_REACH_SIDE, (-TALK_SIDE_ANGLE) & 0xFF);
  r = farcall(P, BANK_ACTORS, () => findActorAtPoint(P, p.hl, p.de));
  if (r.a) return { a: r.a, f: FH };
  p = getPointAheadOfActor(P, wActors, TALK_REACH_SIDE, TALK_SIDE_ANGLE);
  r = farcall(P, BANK_ACTORS, () => findActorAtPoint(P, p.hl, p.de));
  return { a: r.a, f: r.f };
}

// SaveStoryReturnPoint (0A:527F): where the story goes back to after a match or scene: location b and entry c,
// or (b = $FF) here, at the player's position. Keeps the registers.
export function saveStoryReturnPoint(P, b, c) {
  const { V } = P;
  if (b !== 0xFF) { V.storyReturnLocation = b; V.storyReturnEntryPoint = c; return; }
  V.storyReturnLocation = V.storyModeCurrentLocation;
  V.storyReturnEntryPoint = 0xFF;
  copyMemoryBC(P, P.A.storyModePlayersXPosition, P.A.storyReturnPosition, 5);
}
// RestoreStoryReturnPoint (0A:52AE): go there (as an exit: the location is left at once). Keeps the registers.
export function restoreStoryReturnPoint(P) {
  const { V } = P;
  if (V.storyReturnEntryPoint !== 0xFF) {
    V.storyModeCurrentLocation = V.storyReturnLocation;
    V.storyModeEntryPoint = V.storyReturnEntryPoint;
  } else {
    copyMemoryBC(P, P.A.storyReturnPosition, P.A.storyModeSpawnPosition, 5);
    V.storyModeCurrentLocation = V.storyReturnLocation;
    V.storyModeEntryPoint = 0xFF;
  }
  V.unusedExitTriggerIdMirror = 0xFF;
  V.storyModeExitTriggerRequest = 0xFF;
}
// ShowLocationNamePopup (0A:52F5): the location's name (text id hl) in a window, at once, for $50 frames or until
// a button is held. Keeps the registers. regs: the CPU registers at the call.
export function* showLocationNamePopup(P, regs) {
  const { V } = P, old = V.wramBank;
  pushRegs(P, regs, old);                                      // (push af ... push hl, the WRAM bank)
  yield* call(P, 0x52FF, waitPlayerMoveDone(P));
  P.wramBank(WRAM_TEXT);
  V.messageSpeed |= 0x80;
  yield* farcallRom(P, 0x530F, BANK_TEXT, ShowSpeakerDialogueRestoreBG, { ...regs, a: SPEAKER_LOCATION_NAME });
  for (let b = NAME_POPUP_FRAMES; b > 0; b--) {
    yield* advanceFrame(P);
    if (V.playerInputFlags) break;
  }
  yield* farcallRom(P, 0x531F, BANK_TEXT, CloseActiveDialogueWindow);
  P.wramBank(WRAM_TEXT);
  V.messageSpeed &= 0x7F;
  P.wramBank(old);
  dropWords(P, 5);
}
// push af, push bc, push de, push hl, and the WRAM bank (ldh a, [hWramBank] / push af), as these routines start
function pushRegs(P, regs, wram) {
  const c = P.cpu, a = regs.a ?? c.a;
  pushWord(P, a << 8 | (regs.f ?? c.f)); pushWord(P, regs.bc ?? c.bc); pushWord(P, regs.de ?? c.de);
  pushWord(P, regs.hl ?? c.hl); pushWord(P, wram << 8 | (regs.f ?? c.f));
}
// LoadStoryObjPalettes (0A:5337): the overworld's OBJ palettes 3-7.
export function loadStoryObjPalettes(P) {
  const r = loadPaletteShadow(P, StoryObjPalettes, STORY_OBJ_PALETTES_FIRST, STORY_OBJ_PALETTES);
  return { de: STORY_OBJ_PALETTES_FIRST << 8 | STORY_OBJ_PALETTES, ...r };
}
// GetTileTriggerAtPlayer (0A:5369): the trigger id of the behaviour cell under the player, when it is a trigger
// cell with a record in the location's tile triggers; else 0.
export function getTileTriggerAtPlayer(P) {
  const { bus } = P;
  const cell = farcall(P, BANK, () => readBehaviorMapCell(P, bus.u8(wActors + ACTORF_X + 1), bus.u8(wActors + ACTORF_Y + 1)));
  if ((cell & 0x0F) !== BEHAVIOR_TRIGGER) return { a: 0, f: cpFlags(cell & 0x0F, BEHAVIOR_TRIGGER) };
  const id = cell >> 4;
  if (findStoryScriptEntry(P, bus.u16(P.A.mapTileTriggersPtr), id)) return { a: id, f: 0 };
  return { a: 0, f: FZ };
}
// CheckTriggerFacingMask (0A:53BD): a = 1 when a record's facing mask b ($FF: any) has the player's quadrant.
export function checkTriggerFacingMask(P, mask) {
  P.wramBank(WRAM_ACTORS);
  if (mask === FACEMASK_ANY) return { a: 1, f: FZ | FN };
  const q = (P.bus.u8(P.A.playerMoveAngle) >> 6) & 3;
  if (P.rom.u8(BANK, FacingMaskTable_0a + q) & mask) return { a: 1, f: FH };
  return { a: 0, f: FZ | FH };
}
// FindStoryScriptEntry (0A:53E4): the record for id d in the list at hl (in the location's bank) whose facing
// mask and condition hold; 0 for none. Keeps the other registers.
export function findStoryScriptEntry(P, list, id) {
  for (let hl = list; ; hl = (hl + RECORD_SIZE) & 0xFFFF) {
    const w = farReadWord(P, P.V.storyLocationBank, hl), rid = w & 0xFF;
    if (rid === RECORD_END) return 0;
    if (rid !== id) continue;
    if (!checkTriggerFacingMask(P, w >> 8).a) continue;
    const cond = farReadWord(P, P.V.storyLocationBank, (hl + 2) & 0xFFFF);
    if (farcall(P, BANK_ACTORS, () => evalFlagCondition(P, cond)).holds) return hl;
  }
}
// RunStoryScriptOrDialogue (0A:541D): a record's handler hl with speaker a: none (0); a message (below $4000;
// shown once the player stands); or a script in the location's bank, run with the cutscene mode on and the
// player's facing unlocked and turned to its walking direction. wStoryScriptRan = 1. Keeps the registers (and
// the WRAM bank). regs: the CPU registers at the call (the script gets them).
export function* runStoryScriptOrDialogue(P, speaker, handler, regs = {}) {
  const { bus, V } = P, old = V.wramBank;
  pushRegs(P, { ...regs, a: speaker, hl: handler }, old);
  V.storyScriptRan = 1;
  if (handler) {
    if (!(handler >> 8 & SCRIPT_ADDR_BITS)) {
      yield* call(P, 0x5436, waitPlayerMoveDone(P));
      yield* farcallRom(P, 0x5437, BANK_TEXT, ShowSpeakerDialogue, { ...regs, a: speaker, b: speaker, hl: handler });
    } else {
      beginCutsceneScriptMode(P, P.cpu.sp - 8);
      P.wramBank(WRAM_ACTORS);
      bus.w8(wActors + ACTORF_STATUS, bus.u8(wActors + ACTORF_STATUS) & ~ACTORSTATUS_FACING_LOCKED);
      bus.w8(wActors + ACTORF_HEADING, bus.u8(P.A.playerMoveAngle));
      yield* callHLInBankA(P, V.storyLocationBank, handler, { ...regs, b: speaker });
      endCutsceneScriptMode(P, P.cpu.sp - 8);
    }
  }
  P.wramBank(old);
  dropWords(P, 5);
}
// InitLocationActors (0A:5466): start the actor engine and spawn the player (at wStoryModeSpawnPosition) with its
// follower, the partner, and the map_actor list hl in bank a. Keeps the registers.
export function initLocationActors(P, bank, list, sp = P.cpu.sp) {
  const { bus } = P, at = P.A.storyModeSpawnPosition;
  P.wramBank(WRAM_ACTORS);
  farcall(P, BANK_ACTORS, () => initActorEngine(P, sp - 2));
  farcall(P, BANK_ACTORS, () => spawnMainCharacterActor(P, bus.u16(at), bus.u16(at + 2), bus.u8(at + 4)));
  farcall(P, BANK_ACTORS, () => spawnCompanionActor(P));
  farcall(P, BANK_ACTORS, () => spawnActorsFromList(P, bank, list));
}
// RunLocationInitScript (0A:5495): the location's init handler (the window parked below the screen first).
// regs: the CPU registers at the call (bc and de reach the script).
export function* runLocationInitScript(P, regs = {}) {
  const old = P.V.wramBank;
  pushRegs(P, regs, old);
  P.bus.w8(rWY, WY_HIDDEN);
  yield* call(P, 0x54AB, runStoryScriptOrDialogue(P, 0, P.bus.u16(P.A.mapInitScriptPtr), regs));
  P.wramBank(old);
  dropWords(P, 5);
}
// RunNpcInteraction (0A:54B5): talk to actor a (not 2, the partner): its talk record's handler, with the
// record's NPC_* behaviour round it (the actor marked busy meanwhile). Keeps the registers but F (cp 2).
export function* runNpcInteraction(P, slot) {
  const { bus, V } = P;
  V.unusedStoryScriptId = slot;
  if (slot === NO_TALK_ACTOR) return;
  const c = P.cpu;
  pushWord(P, slot << 8 | c.f); pushWord(P, c.bc); pushWord(P, c.de); pushWord(P, c.hl);   // (push af ... push hl)
  yield* talk(P, slot);
  dropWords(P, 4);
}
function* talk(P, slot) {
  const { bus, V } = P;
  const at = findStoryScriptEntry(P, bus.u16(P.A.mapNpcScriptsPtr), slot);
  if (!at) return;
  const rec = P.A.storyMapRecord;
  farCopyBytes(P, V.storyLocationBank, at, rec, 8);
  const flags = bus.u8(rec + 6);
  let saved = 0;                                       // c: the actor's heading kept while it faces the player
  P.wramBank(WRAM_ACTORS);
  const actor = getActorStateAddr(P, bus.u8(rec)).hl;
  bus.w8(P.A.storyScriptSavedActorBusy, bus.u8(actor + ACTORF_BUSY));
  bus.w8(actor + ACTORF_BUSY, 1);
  if (flags & NPC_IDLE_ANIM) {
    bus.w8(P.A.storyScriptSavedActorAnim, bus.u8(actor + ACTORF_ANIM_ID));
    farcall(P, BANK_ACTORS, () => setActorAnimationChecked(P, actor, ANIM_WALK));
  }
  if (flags & NPC_FREEZE) bus.w8(actor + ACTORF_FLAGS, bus.u8(actor + ACTORF_FLAGS) | 0x03);
  if (flags & NPC_FACE_PLAYER) {
    saved = bus.u8(actor + ACTORF_HEADING);
    bus.w8(actor + ACTORF_HEADING, bus.u8(P.A.playerMoveAngle) + 0x80);
  }
  pushWord(P, actor);                                          // (push de)
  yield* call(P, 0x553D, runStoryScriptOrDialogue(P, bus.u8(rec), bus.u16(rec + 4), { bc: flags << 8 | saved, de: actor }));
  dropWords(P, 1);
  if (flags & NPC_RESTORE_FACING) bus.w8(actor + ACTORF_HEADING, saved);
  if (flags & NPC_FREEZE) bus.w8(actor + ACTORF_FLAGS, bus.u8(actor + ACTORF_FLAGS) & ~0x03);
  if (flags & NPC_IDLE_ANIM) farcall(P, BANK_ACTORS, () => setActorAnimationChecked(P, actor, bus.u8(P.A.storyScriptSavedActorAnim)));
  bus.w8(actor + ACTORF_BUSY, bus.u8(P.A.storyScriptSavedActorBusy));
}

const regsOf = c => ({ a: c.a, f: c.f, bc: c.bc, de: c.de, hl: c.hl });
export const HOOKS = [
  [BANK, 0x51CF, hook((P, c) => getPointAheadOfActor(P, c.hl, c.de, c.a))],
  [BANK, 0x5200, hook(P => getFacingTileInteractionId(P))],
  [BANK, 0x5227, hook(P => findActorFacingPlayer(P))],
  [BANK, 0x527F, hook((P, c) => { saveStoryReturnPoint(P, c.b, c.c); })],
  [BANK, 0x52AE, hook(P => { restoreStoryReturnPoint(P); })],
  [BANK, 0x52F5, hookGen((P, c) => showLocationNamePopup(P, regsOf(c)))],
  [BANK, 0x5337, hook(P => loadStoryObjPalettes(P))],
  [BANK, 0x5369, hook(P => getTileTriggerAtPlayer(P))],
  [BANK, 0x53A2, hook((P, c) => { const { holds, ...r } = evalFlagCondition(P, c.de); return r; })],
  [BANK, 0x53BD, hook((P, c) => checkTriggerFacingMask(P, c.b))],
  [BANK, 0x53E4, hook((P, c) => ({ hl: findStoryScriptEntry(P, c.hl, c.d) }))],
  [BANK, 0x541D, hookGen((P, c) => runStoryScriptOrDialogue(P, c.a, c.hl, regsOf(c)))],
  [BANK, 0x5466, hook((P, c) => { initLocationActors(P, c.a, c.hl, c.sp); })],
  [BANK, 0x5495, hookGen((P, c) => runLocationInitScript(P, regsOf(c)))],
  [BANK, 0x54B5, hookGen(function* (P, c) { const a = c.a; yield* runNpcInteraction(P, a); return { f: cpFlags(a, NO_TALK_ACTOR) }; })],
];
