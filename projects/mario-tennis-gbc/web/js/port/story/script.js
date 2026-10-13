// The cutscene scripts' commands, part 1 (bank $0A, $40A4-$43D7): the cutscene mode (the follower stops, the
// debug fast-forward), script waits, the dialogue cursor (the next message id of a script's dialogue), speaker
// dialogue, the yes/no prompt and menus, and the actor commands addressed by slot number.
// Port of script_0a.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm),
// whose routine names these are; the scripts (src/story/, still the ROM's) call these through bank $0A's $4000
// table (FarPtr_*), with their macros in include/macros/story_script.inc.
//
// A script's actor commands take the actor as its slot (a; $18 or more: the player's slot 0) and work in WRAM 4.
// Commands that take a point (ScriptSetActorPosition, ...) build it on the stack, 4 bytes below the return
// address, and hand its address to the *Raw routine (actor_moves.js), with hActorPtr = the actor.
// Tests: web/tests/port/routines_story.mjs; lockstep on out/engine/rec2.mtrec and out/port/story1.mtrec.
import {
  FZ, FN, FH, FC, WRAM_ACTORS, WRAM_TEXT, BANK_ACTORS, BANK_STORY, wActors, ACTOR_SIZE, NUM_ACTORS, wFollowerActor,
  ACTORF_SPEED, ACTORF_MODE, ACTORF_HEADING, FLAG_CUTSCENE_FAST_FORWARD, hook, hookGen, farcall, farcallGen,
  testFlag, setFlag, clearFlag, advanceFrame, waitFrames, withWramBank, setActorPtr, addFlags, incFlags, cpFlags,
  spAddFlags, testFlagF,
} from "./common.js";
import { farReadByte } from "../home/palettes.js";
import { registerFrameTask, unregisterFrameTask } from "../home/colorfade.js";
import { pushWord } from "../home/memory.js";
import { setActorScript, attachActorWaypointFollower } from "./actor_slots.js";
import { waitActorMoveDone, waitActorJumpDone } from "./actor_queries.js";
import { initLocationActors } from "./story_interact.js";
import { setActorPositionRaw } from "./actor_moves.js";
import { waitPlayerMoveDone } from "./actor_waits.js";

const BANK = BANK_STORY;
export const ToggleCutsceneFastForward = 0x40A4, ActorScript_0a = 0x4766;
const PADF_START = 0x08, MESSAGE_INSTANT = 0x80;
const BANK_TEXT = 0x05;
const SetActiveWindowTextId = 0x55E6, ShowSpeakerDialogue = 0x581F, ShowSpeakerDialogueRestoreBG = 0x58F0;
const CloseActiveDialogueWindow = 0x5A93, RenderMenuWindowText = 0x7232, RunMenuSelection = 0x477F;
const CloseWindow = 0x72BD, AddTextIdOffset = 0x5D2B, FetchDialogueText = 0x5C18;
const CreateMenuWindowFromText = 0x46B0, RestoreShadowTilemap = 0x436F;
const Text_30_26 = 0x001A;                     // "Yes / No"
const wTextBuffer = 0xC600, TEXT_SCAN_LENGTH = 0x0180, TEXT_END = 0x00, TEXT_PAGE = 0x02;
const SPEAKER_NONE = 0x80, PROMPT_ROW_UPPER = 0x01, PROMPT_ROW_LOWER = 0x0A, PROMPT_COLUMN = 0x02;
const SPEAKER_LOW_ROWS = 0x09, ACTOR_LOW_ON_SCREEN = 0x0A;
const SCRIPT_WAIT_TIMEOUT = 0x0258, FAST_FORWARD_FRAMES = 2;

// ToggleCutsceneFastForward (0A:40A4), a frame task in debug mode: START toggles the fast-forward (messages shown
// at once). Keeps the registers.
export function toggleCutsceneFastForward(P) {
  const { V } = P;
  if (!(V.inputRisingEdge & PADF_START)) return;
  if (testFlag(P, FLAG_CUTSCENE_FAST_FORWARD)) { clearFlag(P, FLAG_CUTSCENE_FAST_FORWARD); V.messageSpeed |= MESSAGE_INSTANT; }
  else { setFlag(P, FLAG_CUTSCENE_FAST_FORWARD); V.messageSpeed &= ~MESSAGE_INSTANT & 0xFF; }
}
// BeginCutsceneScriptMode (0A:40D0): no screen shake, the follower (slot 1) on ActorScript_0a (it stops), and in
// debug mode the fast-forward toggle. Keeps the registers.
export function beginCutsceneScriptMode(P, sp = P.cpu.sp) {
  const { V } = P;
  withWramBank(P, WRAM_TEXT, () => {});
  V.screenShakeMagnitude = 0xFF;
  V.screenShakeOffsetX = 0; V.screenShakeOffsetY = 0;
  setActorNullScript(P, 1);
  if (V.debugStepMode) registerFrameTask(P, 1, ToggleCutsceneFastForward, sp - 2);
}
// EndCutsceneScriptMode (0A:4105): the follower walks after the player again; no fast-forward; the player's
// walking direction from its heading. Keeps the registers.
export function endCutsceneScriptMode(P, sp = P.cpu.sp) {
  const { bus, V } = P;
  V.screenShakeOffsetX = 0; V.screenShakeOffsetY = 0;
  farcall(P, BANK_ACTORS, () => attachActorWaypointFollower(P, wFollowerActor, wActors));
  unregisterFrameTask(P, ToggleCutsceneFastForward, sp - 2);
  clearFlag(P, FLAG_CUTSCENE_FAST_FORWARD);
  withWramBank(P, WRAM_ACTORS, () => bus.w8(P.A.playerMoveAngle, bus.u8(wActors + ACTORF_HEADING)));
}
// WaitScriptFrames (0A:413F): wait a frames (2 when fast-forwarding). Keeps the registers. With a = 0 (and no
// fast-forward) the ROM returns through its pushed bc (a jump to the caller's bc, the pushed af left on the
// stack): returns { jumpTo: bc } then.
export function* waitScriptFrames(P, a) {
  const n = testFlag(P, FLAG_CUTSCENE_FAST_FORWARD) ? FAST_FORWARD_FRAMES : a;
  if (!n) return { jump: true };
  yield* waitFrames(P, n);
  return { jump: false };
}
// ScriptRespawnLocationActors (0A:4152): InitLocationActors (list hl, bank a).
export function scriptRespawnLocationActors(P, bank, list) { initLocationActors(P, bank, list); }

// InitDialogueTextCursor (0A:4156): the script's dialogue starts at text id hl (SetActiveWindowTextId, bank 5's,
// returns it in hl). Returns that routine's bc, de, hl.
export function* initDialogueTextCursor(P, regs) {
  const r = yield* withWramBankGen(P, WRAM_TEXT, P.runRom(BANK_TEXT, SetActiveWindowTextId, regs));
  return r;
}
function* withWramBankGen(P, bank, gen) {
  const old = P.V.wramBank;
  P.wramBank(bank);
  const r = yield* gen;
  if (r && r.hl !== undefined) P.bus.w16(P.A.scriptDialogueTextId, r.hl);
  P.wramBank(old);
  return r;
}
// AdvanceDialogueTextCursor (0A:4172): skip a message. Keeps the registers.
export function advanceDialogueTextCursor(P) {
  withWramBank(P, WRAM_TEXT, () => P.bus.w16(P.A.scriptDialogueTextId, P.bus.u16(P.A.scriptDialogueTextId) + 1));
}
// ScriptShowSpeakerDialogue (0A:4192) / ScriptShowSpeakerDialogueRestoreBG (0A:41C1): once the player stands, the
// next message of the dialogue spoken by actor a (unless fast-forwarding: skipped); the cursor moves on (from the
// id the dialogue routine leaves in hl). Returns b = a and the dialogue routine's bc, de.
export function* scriptShowSpeakerDialogue(P, regs, restoreBG = false) {
  const { bus, V } = P, old = V.wramBank;
  yield* waitPlayerMoveDone(P);
  P.wramBank(WRAM_TEXT);
  let hl = bus.u16(P.A.scriptDialogueTextId), out = { b: regs.a };
  if (!testFlag(P, FLAG_CUTSCENE_FAST_FORWARD)) {
    const r = yield* P.runRom(BANK_TEXT, restoreBG ? ShowSpeakerDialogueRestoreBG : ShowSpeakerDialogue, { ...regs, b: regs.a, hl });
    hl = r.hl; out = { bc: r.bc, de: r.de };
  }
  bus.w16(P.A.scriptDialogueTextId, hl + 1);
  P.wramBank(old);
  return out;
}
// ScriptCloseDialogueWindow (0A:41F2): bank 5's CloseActiveDialogueWindow. Returns its registers.
export function* scriptCloseDialogueWindow(P, regs) { return yield* P.runRom(BANK_TEXT, CloseActiveDialogueWindow, regs); }

// RunDialogueYesNoPrompt (0A:41F6): the dialogue's yes/no question: the text resumes after its choice marker; a
// Yes/No menu near the speaker; returns the choice in a. Keeps the other registers.
export function* runDialogueYesNoPrompt(P) {
  const { bus, V } = P, old = V.wramBank;
  P.wramBank(WRAM_TEXT);
  yield* findDialogueChoiceMarker(P);
  const guard = bus.u8(P.A.textRedrawGuard);
  bus.w8(P.A.textRedrawGuard, 0);
  yield* showYesNoPromptWindow(P);
  yield* P.runRom(BANK_TEXT, RenderMenuWindowText);
  const choice = (yield* P.runRom(BANK_TEXT, RunMenuSelection)).a;
  yield* findDialogueChoiceMarker(P);
  yield* P.runRom(BANK_TEXT, CloseWindow, { a: bus.u8(P.A.menuWindowId) });
  bus.w8(P.A.textResumePtr + 1, 0);
  bus.w8(P.A.menuWindowId, 0xFF);
  bus.w8(P.A.textRedrawGuard, guard);
  P.wramBank(old);
  return choice;
}
// ShowYesNoPromptWindow (0A:4237): the Yes/No menu window: in the upper rows when the speaking actor stands low on
// the screen (10 tiles or more below the camera), else the lower; with no speaker by the speaker's low bits.
export function* showYesNoPromptWindow(P) {
  const { bus, V } = P, old = V.wramBank, speaker = bus.u8(P.A.dialogueSpeaker);
  let e;
  if (speaker & SPEAKER_NONE) e = (speaker & 0x7F) < SPEAKER_LOW_ROWS ? PROMPT_ROW_LOWER : PROMPT_ROW_UPPER;
  else {
    const actor = getActorStateAddr(P, speaker & 0x7F).hl, camY = V.cameraY >> 8;
    setActorPtr(P, actor);
    P.wramBank(WRAM_ACTORS);
    const yAt = ((actor & 0xFF00) | ((actor + 0x0C) & 0xFF)) + 3;
    e = ((bus.u8(yAt) - camY) & 0xFF) < ACTOR_LOW_ON_SCREEN ? PROMPT_ROW_UPPER : PROMPT_ROW_LOWER;
  }
  P.wramBank(old);
  yield* P.runRom(BANK_TEXT, CreateMenuWindowFromText, { d: PROMPT_COLUMN, e, hl: Text_30_26 });
}
// FindDialogueChoiceMarker (0A:4291): fetch the dialogue's current message into wTextBuffer and point
// wTextResumePtr after its last page break ($02), if any. Keeps the registers.
export function* findDialogueChoiceMarker(P) {
  const { bus } = P;
  const id = (bus.u16(P.A.scriptDialogueTextId) - 1) & 0xFFFF;
  const r = yield* P.runRom(BANK_TEXT, AddTextIdOffset, { a: 0, hl: id });
  yield* P.runRom(BANK_TEXT, FetchDialogueText, r);
  let hl = wTextBuffer, de = 0;
  for (let bc = TEXT_SCAN_LENGTH; bc > 0; bc--) {
    const v = bus.u8(hl);
    if (v === TEXT_END) break;
    hl++;
    if (v === TEXT_PAGE) de = hl;
  }
  if (de) bus.w16(P.A.textResumePtr, de);
}
// RunMenuFromText (0A:42CF): a menu from text hl at (d, e): returns the choice (a), the window closed after.
export function* runMenuFromText(P, regs) {
  const w = yield* P.runRom(BANK_TEXT, CreateMenuWindowFromText, regs);
  yield* P.runRom(BANK_TEXT, RestoreShadowTilemap);
  yield* P.runRom(BANK_TEXT, RenderMenuWindowText);
  const choice = (yield* P.runRom(BANK_TEXT, RunMenuSelection)).a;
  const r = yield* P.runRom(BANK_TEXT, CloseWindow, { a: w.a, c: choice });
  return { a: choice, f: r.f };
}
// Unused_0a_ScriptSkipSpeakerDialogue (0A:42E9): the cursor moved on without the message. Keeps the registers.
export function unusedScriptSkipSpeakerDialogue(P) {
  withWramBank(P, WRAM_TEXT, () => {
    testFlag(P, FLAG_CUTSCENE_FAST_FORWARD);
    P.bus.w16(P.A.scriptDialogueTextId, P.bus.u16(P.A.scriptDialogueTextId) + 1);
  });
}

// GetActorStateAddr (0A:4312): hl = actor slot a's record ($18 or more: slot 0), a = its mode; WRAM 4. Its flags
// (of `inc h / dec h`) are never Z, so the commands' `ret z` checks never return.
export function getActorStateAddr(P, slot) {
  const hl = slot < NUM_ACTORS ? wActors + slot * ACTOR_SIZE : wActors;
  P.wramBank(WRAM_ACTORS);
  const h = hl >> 8;
  return { hl, a: P.bus.u8(hl + ACTORF_MODE), f: FN | (((h + 1) & 0x0F) === 0 ? FH : 0) };
}
// the low-byte add with carry into h (`ld a, n / add l / ld l, a / jr nc / inc h`): { hl, a, f }
export function addToHL(hl, n) {
  const sum = (hl & 0xFF) + n, l = sum & 0xFF;
  if (sum <= 0xFF) return { hl: (hl & 0xFF00) | l, a: l, f: addFlags(hl & 0xFF, n) };
  const h = ((hl >> 8) + 1) & 0xFF;
  return { hl: h << 8 | l, a: l, f: incFlags((hl >> 8) & 0xFF, FC) };
}
// ScriptSetActorMoveSpeed (0A:433B): actor a's speed = bc.
export function scriptSetActorMoveSpeed(P, slot, speed) {
  const r = addToHL(getActorStateAddr(P, slot).hl, ACTORF_SPEED);
  P.wramBank(WRAM_ACTORS);
  P.bus.w16(r.hl, speed);
  return { a: r.a, f: r.f, hl: (r.hl + 1) & 0xFFFF };
}
// ScriptSetActorScript (0A:4350): actor a runs script de of bank b.
export function scriptSetActorScript(P, slot, bank, script) {
  const actor = getActorStateAddr(P, slot).hl;
  P.wramBank(WRAM_ACTORS);
  const f = farcall(P, BANK_ACTORS, () => setActorScript(P, actor, bank, script, 0));
  return { a: bank, f, bc: actor, hl: script };
}
// SetActorNullScript (0A:4364): actor a on ActorScript_0a (stopped; set ACTORF_MODE 0 if it is run on).
export function setActorNullScript(P, slot) {
  const actor = getActorStateAddr(P, slot).hl, bank = P.V.romBank;
  const f = farcall(P, BANK_ACTORS, () => setActorScript(P, actor, bank, ActorScript_0a, 0));
  return { a: bank, f, bc: actor, hl: ActorScript_0a };
}
// WaitActorScriptDone (0A:4372): wait (up to $258 frames) until actor a's script sits on an as_halt.
export function* waitActorScriptDone(P, slot) {
  const r = getActorStateAddr(P, slot);
  for (let bc = SCRIPT_WAIT_TIMEOUT; bc > 0; bc--) {
    if (checkActorScriptEnd(P, r.hl).done) break;
    yield* advanceFrame(P);
  }
  return r;
}
// CheckActorScriptEnd (0A:438A): Z when actor hl's next opcode is 0 (as_halt); a = the opcode. WRAM 4.
export function checkActorScriptEnd(P, actor, f = 0) {
  if (!(actor >> 8)) return { done: true, f: FZ | FN | (f & FC) };
  P.wramBank(WRAM_ACTORS);
  const op = farReadByte(P, P.bus.u8(actor + 2), P.bus.u16(actor));
  return { done: op === 0, a: op, f: cpFlags(op, 0) };
}
// ScriptWaitActorMoveDone (0A:43A4) / ScriptWaitActorJumpDone (0A:43AB): wait for actor a's walk / jump to end.
export function* scriptWaitActorMoveDone(P, slot) {
  const r = getActorStateAddr(P, slot);
  yield* farcallGen(P, BANK_ACTORS, waitActorMoveDone(P, r.hl));
  return r;
}
export function* scriptWaitActorJumpDone(P, slot) {
  const r = getActorStateAddr(P, slot);
  yield* farcallGen(P, BANK_ACTORS, waitActorJumpDone(P, r.hl));
  return r;
}
// ScriptSetActorPosition (0A:43B2): actor a stands at (bc, de) (the point on the stack, for SetActorPositionRaw).
export function scriptSetActorPosition(P, slot, x, y) { return withStackPoint(P, slot, x, y, setActorPositionRaw); }
// the point (bc, de) as 4 bytes on the stack, its address passed to raw(P, buffer) with hActorPtr = actor a
export function withStackPoint(P, slot, x, y, raw) {
  const { cpu, bus } = P, buf = (cpu.sp - 4) & 0xFFFF;
  cpu.sp = buf;                                                   // add sp, -4
  bus.w16(buf, x); bus.w16(buf + 2, y);
  const actor = getActorStateAddr(P, slot).hl;
  setActorPtr(P, actor);
  P.wramBank(WRAM_ACTORS);
  const r = raw(P, buf);
  cpu.sp = (buf + 4) & 0xFFFF;                                    // add sp, 4
  return { bc: buf, ...r, f: spAddFlags(buf, 4) };          // (bc: the buffer, unless raw moved it)
}

export const HOOKS = [
  [BANK, 0x40A4, hook(P => { toggleCutsceneFastForward(P); })],
  [BANK, 0x40D0, hook((P, c) => { beginCutsceneScriptMode(P, c.sp); })],
  [BANK, 0x4105, hook((P, c) => { endCutsceneScriptMode(P, c.sp); })],
  [BANK, 0x413F, function* (P, c) {
    const a = c.a, f = c.f, bc = c.bc, de = c.de, hl = c.hl;
    const r = yield* waitScriptFrames(P, a);
    Object.assign(c, { a, f, bc, de, hl });
    if (r.jump) { pushWord(P, a << 8 | f); pushWord(P, bc); c.f = FZ; }   // its ret pops the pushed bc
  }],
  [BANK, 0x4152, hook((P, c) => { scriptRespawnLocationActors(P, c.a, c.hl); })],
  [BANK, 0x4156, hookGen(function* (P, c) { const r = yield* initDialogueTextCursor(P, { a: WRAM_TEXT, bc: c.bc, de: c.de, hl: c.hl }); return { bc: r.bc, de: r.de, hl: r.hl }; })],
  [BANK, 0x4172, hook(P => { advanceDialogueTextCursor(P); })],
  [BANK, 0x4192, hookGen((P, c) => scriptShowSpeakerDialogue(P, { a: c.a, bc: c.bc, de: c.de }))],
  [BANK, 0x41C1, hookGen((P, c) => scriptShowSpeakerDialogue(P, { a: c.a, bc: c.bc, de: c.de }, true))],
  [BANK, 0x41F2, hookGen(function* (P, c) { const r = yield* scriptCloseDialogueWindow(P, { a: c.a, f: c.f, bc: c.bc, de: c.de, hl: c.hl }); return r; })],
  [BANK, 0x41F6, hookGen(function* (P) { return { a: yield* runDialogueYesNoPrompt(P) }; })],
  [BANK, 0x4237, hookGen(function* (P) { yield* showYesNoPromptWindow(P); })],
  [BANK, 0x4291, hookGen(function* (P) { yield* findDialogueChoiceMarker(P); })],
  [BANK, 0x42CF, hookGen((P, c) => runMenuFromText(P, { a: c.a, bc: c.bc, de: c.de, hl: c.hl }))],
  [BANK, 0x42E9, hook(P => { unusedScriptSkipSpeakerDialogue(P); })],
  [BANK, 0x4312, hook((P, c) => getActorStateAddr(P, c.a))],
  [BANK, 0x433B, hook((P, c) => scriptSetActorMoveSpeed(P, c.a, c.bc))],
  [BANK, 0x4350, hook((P, c) => scriptSetActorScript(P, c.a, c.b, c.de))],
  [BANK, 0x4364, hook((P, c) => setActorNullScript(P, c.a))],
  [BANK, 0x4372, hookGen((P, c) => waitActorScriptDone(P, c.a))],
  [BANK, 0x438A, hook((P, c) => { const { done, ...r } = checkActorScriptEnd(P, c.hl, c.f); return r; })],
  [BANK, 0x43A4, hookGen((P, c) => scriptWaitActorMoveDone(P, c.a))],
  [BANK, 0x43AB, hookGen((P, c) => scriptWaitActorJumpDone(P, c.a))],
  [BANK, 0x43B2, hook((P, c) => scriptSetActorPosition(P, c.a, c.bc, c.de))],
];
