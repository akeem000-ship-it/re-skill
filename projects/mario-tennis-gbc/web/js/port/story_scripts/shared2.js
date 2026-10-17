// Pieces part 2 of the story scripts (src/story/lessonmenu_10 .. water_15 of the gerbiljames/mario-tennis-gbc-disasm,
// MIT) repeats in several banks: the four map-script stubs every story bank carries (a `ret`, the active-flag
// clear, the story cue sound, the location name hidden), the short-text argument routine, and the idioms of the
// NPC handlers (a text id from a table by the story stage, the stage's tier).
// Covered with the modules that use them (see each module's header for its recordings).
import { FZ, FH, FC, BANK_ACTORS, ACTOR_SIZE, wActors, actorState, farcall, sound, fetchShortText, pushTextString, hook } from "./common.js";
import { attachActorWaypointFollower } from "../story/actor_slots.js";
import { pushWord, dropWords } from "../story/common.js";
import { spAddFlags } from "../home/cpu.js";

const SFX_STORY_CUE = 0xA2;
const WRAM_CHAR1 = 0x05, WRAM_CHAR3 = 0x07;
export const wTextArgFetchBuffer = 0xDF00;             // (WRAM 5)

// MapScriptNop_<bank>, Unused_<bank>_MapScriptClearActiveFlag, Unused_<bank>_MapScriptPlaySoundA2 and
// Unused_<bank>_MapScriptHideLocationName at their addresses in a bank: `ret`; `xor a / ld [wStoryScriptRan], a`;
// `sound SFX_STORY_CUE`; `xor a / ld [wStoryModeShowLocationName], a`
export function mapScriptStubs(bank, nop, clear, cue, hide) {
  return [
    [bank, nop, hook(() => {})],
    [bank, clear, hook(P => { P.V.storyScriptRan = 0; return { a: 0, f: FZ }; })],
    [bank, cue, hook(P => { sound(P, SFX_STORY_CUE); })],
    [bank, hide, hook(P => { P.V.storyModeShowLocationName = 0; return { a: 0, f: FZ }; })],
  ];
}
// PushTextArgFetchedString (12:7A68) and its kind: WRAM 7 pushed, WRAM 5 mapped, short text hl into
// wTextArgFetchBuffer, pushed as the next message's string argument. The text routines keep every register, so it
// leaves de = hl = the buffer and a, F as at the call (pop_wram_bank).
export function pushTextArgFetchedString(P, id, entryF = P.cpu.f) {
  const old = P.V.wramBank;
  P.wramBank(WRAM_CHAR3);
  P.wramBank(WRAM_CHAR1);
  fetchShortText(P, id, wTextArgFetchBuffer);
  pushTextString(P, wTextArgFetchBuffer);
  P.wramBank(old);
  return { a: old, f: entryF, de: wTextArgFetchBuffer, hl: wTextArgFetchBuffer };
}

// ld a, [index] / add a / ld_hl_indexed table / ld a, [hl+] / ld h, [hl] / ld l, a: the text id (a word) of a
// bank's table at the index (the doubled index wraps at 8 bits, the table address carries)
export const tableText = (P, bank, table, index) => P.rom.u16(bank, (table + ((index * 2) & 0xFF)) & 0xFFFF);
// ld a, [wMapSceneStage] / sra a: the story stage's tier
export const sra = v => ((v >> 1) | (v & 0x80)) & 0xFF;
// the F a set_flag / clear_flag (rst $20 / $28) leaves in a routine running at sp (its return address on top):
// that of the handler's `ld hl, sp+4`
export const flagCmdF = P => spAddFlags((P.cpu.sp - 6) & 0xFFFF, 4);
// add l / ld l, a / jr nc / inc h (hl = base + a): hl and the flags
export function addToHL(base, a) {
  const sum = (base & 0xFF) + a, l = sum & 0xFF;
  if (sum <= 0xFF) return { hl: (base & 0xFF00) | l, f: (l ? 0 : FZ) | (((base & 0xF) + (a & 0xF)) > 0xF ? FH : 0) };
  const h = ((base >> 8) + 1) & 0xFF;
  return { hl: h << 8 | l, f: (h ? 0 : FZ) | ((h & 0xF) === 0 ? FH : 0) | FC };
}
// ld bc, wActors + 1 * ACTOR_SIZE / script_get_actor_state actor / ld e, l / ld d, h / farcall
// AttachActorWaypointFollower: the player's shadow (actor 1) follows the actor's steps
export function shadowFollow(P, actor) {
  const leader = actorState(P, actor);
  farcall(P, BANK_ACTORS, () => attachActorWaypointFollower(P, wActors + ACTOR_SIZE, leader));
}
// `farcall X` (the rst at rst) of a JS routine at the ROM's stack depth: FarCall's words under the callee (the
// return past the inline bytes, hl, a with the caller's bank, and FarCallReturn), so routines that keep things on
// the stack (a point buffer at sp - 4) see the ROM's sp. regs: the a and hl at the rst.
const FarCallReturn = 0x01D5;
export function farcallAt(P, rst, bank, fn, regs = {}) {
  pushWord(P, (rst + 3) & 0xFFFF);
  pushWord(P, (regs.hl ?? P.cpu.hl) & 0xFFFF);
  pushWord(P, ((regs.a ?? P.cpu.a) & 0xFF) << 8 | P.V.romBank);
  pushWord(P, FarCallReturn);
  try { return farcall(P, bank, fn); } finally { dropWords(P, 4); }
}
