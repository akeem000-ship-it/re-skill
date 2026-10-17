// Pieces part 2 of the story scripts (src/story/lessonmenu_10 .. water_15 of the gerbiljames/mario-tennis-gbc-disasm,
// MIT) repeats in several banks: the four map-script stubs every story bank carries (a `ret`, the active-flag
// clear, the story cue sound, the location name hidden) and the short-text argument routine.
// Covered with the modules that use them (see each module's header for its recordings).
import { FZ, sound, fetchShortText, pushTextString, hook } from "./common.js";

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
