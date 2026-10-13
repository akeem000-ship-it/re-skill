// The story-mode overworld loop (bank $0A, $4E0E-$51CE): entering a location (its header, entry point, actors,
// scene graphics, arrival and init scripts, fade-in and name popup) and its frame loop (event requests: step-on
// triggers, exits, the menu, talking, facing-tile actions, tile triggers, the debug menu), and the clear-status
// menu's flag lists.
// Port of story_loop_0a.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm),
// whose routine names these are.
//
// The location model. wStoryModeCurrentLocation picks a 6-byte record of StoryLocationTable_0a (scene_triggers.js):
// [id, scene, map scripts (slot, bank), music, 0]; the map scripts' 14 bytes are 7 pointers into that bank
// (wMapEntryPointsPtr...wMapInitScriptPtr): entry points, exits, actors, NPC talk records, facing-tile actions,
// tile triggers and the init handler. wStoryModeEntryPoint picks an 8-byte entry record [id, facing, X(2), Y(2),
// arrival script(2)] ($FF: keep the saved position). A location runs until an exit changes the location.
// While nothing is asked (wStoryModeTriggerScript..wStoryModeMenuRequest all 0, set by the player's controller)
// the player walks; a request stops the player (its script set to ActorScript_0a) until it has been handled.
// Tests: web/tests/port/routines_story.mjs; lockstep on out/engine/rec2.mtrec and out/port/story1.mtrec.
import {
  FZ, FN, FH, FC, WRAM_ACTORS, BANK_ACTORS, BANK_STORY, wActors, ACTORF_ANIM_SPEED, FLAG_ENDING_CREDITS_RUNNING,
  FLAG_HIDE_OVERWORLD_ACTORS, FLAG_DEBUG_SHOW_PLAYER_POS, FLAG_STORY_MENU_LOCKED, hook, hookGen, farcall,
  testFlag, setFlag, clearFlag, setFlagOp, clearFlagOp, advanceFrame, waitFrames, ClearFrameTasks,
  DisableLCDSafely, EnableLCD, PrintHexWord, addFlags, incFlags, decFlags, zf, subFlags, testFlagF,
} from "./common.js";
import { copyMemoryBC } from "../home/memory.js";
import { farReadByte, farCopyBytes } from "../home/palettes.js";
import { copyDataFromBank } from "../home/decompress.js";
import { beginFadeOut, beginFadeIn, waitFadeEnd, registerFrameTask } from "../home/colorfade.js";
import { playSoundManaged } from "../audio/requests.js";
import { setActorScript, attachActorControllerScript } from "./actor_slots.js";
import {
  initLocationActors, loadStoryObjPalettes, runLocationInitScript, findActorFacingPlayer, runNpcInteraction,
  getFacingTileInteractionId, getTileTriggerAtPlayer, showLocationNamePopup,
} from "./story_interact.js";
import {
  getStoryLocationRecordPtr, initSceneScroll, loadStorySceneGraphics, runQueuedTriggerScript, runLocationExit,
  runFacingTileScript, runTileTriggerScript,
} from "./scene_triggers.js";
import { copyScrolledSceneTilemapToVram } from "./scene_collision.js";
import { waitPlayerMoveDone } from "./actor_waits.js";
import { runClearStatusSetupMenu } from "./match.js";
import { ActorScript_0a } from "./script.js";

const BANK = BANK_STORY;
const SinglesRankingClearFlagList_0a = 0x4E4B, DoublesRankingClearFlagList_0a = 0x4EA8;
const ClearStatusResultCodeIndexTable = 0x4EEE;
const RANKING_FLAGS_FIRST = 0x0A00, RANKING_FLAGS = 9, FLAG_STEP = 0x20;
const wClearStatusDoubles = 0xDF01, wClearStatusFormat = 0xDF02, wClearStatusClass = 0xDF03;
const wClearStatusRank = 0xDF04, wClearStatusResultCode = 0xDF06;
export const DrawPlayerPositionDebugOverlay = 0x4EFC;
const DEBUG_POS_X_CELL = 0x1000, DEBUG_POS_Y_CELL = 0x1001;
const GAMEMODE_NONE = 0x00, BGM_UNCHANGED = 0xFF, STORYENTRY_NONE = 0xFF;
const LOCATION_NAME_TEXT_BASE = 0x0179;            // text id of location 0's name
const EVENT_REQUESTS = 6;                          // wStoryModeTriggerScript .. wStoryModeMenuRequest
const AUTO_INTERACT_FRAMES = 0x1E;                 // walking into the same thing this long talks to it
const FADE_OUT_SPEED = 12, FADE_IN_SPEED = 8, ENTER_WAIT_FRAMES = 4;
const ANIM_SPEED_STILL = 1;
const BANK_TEXT = 0x05, ResetTextWindowState = 0x6E09, RunDebugMenu = 0x66A0;
const BANK_GAME = 0x01, LoadMenuFontGfx = 0x50E2;
const BANK_MENU = 0x06, RunStoryModeMenu = 0x6E17;

// SetSinglesRankingClearFlags (0A:4E0E) / SetDoublesRankingClearFlags (0A:4E75): clear the 9 ranking flags from
// $0A00, then set the list's flags up to the entry for the chosen class and rank (singles: class * 5 + the rank,
// or 0 for format 0; doubles: class * 4 + rank). Zero entries are skipped. Return the registers they leave.
export function setSinglesRankingClearFlags(P) {
  const { bus } = P;
  clearRankingFlags(P);
  const level = bus.u8(wClearStatusFormat) ? bus.u8(wClearStatusRank) : 0;
  const cls = bus.u8(wClearStatusClass), c5 = (cls * 5) & 0xFF;
  return setRankingFlags(P, SinglesRankingClearFlagList_0a, level, c5, addFlags(level, c5));
}
export function setDoublesRankingClearFlags(P) {
  const { bus } = P;
  clearRankingFlags(P);
  const c4 = (bus.u8(wClearStatusClass) * 4) & 0xFF, rank = bus.u8(wClearStatusRank);
  const { b, ...r } = setRankingFlags(P, DoublesRankingClearFlagList_0a, rank, c4, addFlags(rank, c4));
  return r;                                          // (b is the caller's here)
}
function clearRankingFlags(P) {
  let de = RANKING_FLAGS_FIRST;
  for (let c = RANKING_FLAGS; c > 0; c--) { clearFlagOp(P, de); de = (de + FLAG_STEP) & 0xFFFF; }
}
// the flags of list entries 1 .. level + base (c counts down from level + base + 1); returns the registers left
function setRankingFlags(P, list, b, base, addF) {
  let c = (b + base + 1) & 0xFF, hl = list, de, carry = addF & FC;
  for (;;) {
    de = P.rom.u16(BANK, hl); hl = (hl + 2) & 0xFFFF;
    const f = decFlags(c, carry);
    c = (c - 1) & 0xFF;
    if (!c) return { a: de & 0xFF, f, b, c, de, hl };
    carry = 0;                                       // (`or e` clears it)
    if (de) setFlagOp(P, de);
  }
}
// GetClearStatusResultCode (0A:4ECA): the clear-status result: ClearStatusResultCodeIndexTable[rank] for format 0,
// else [(class + 2) * 2 + doubles].
export function getClearStatusResultCode(P) {
  const { bus } = P, format = bus.u8(wClearStatusFormat);
  let b = format, a;
  if (format) { b = ((bus.u8(wClearStatusClass) + 2) * 2) & 0xFF; a = bus.u8(wClearStatusDoubles); }
  else a = bus.u8(wClearStatusRank);
  const i = (a + b) & 0xFF, sum = (ClearStatusResultCodeIndexTable & 0xFF) + i, hl = (ClearStatusResultCodeIndexTable + i) & 0xFFFF;
  const code = P.rom.u8(BANK, hl);
  bus.w8(wClearStatusResultCode, code);
  const f = sum > 0xFF ? incFlags(ClearStatusResultCodeIndexTable >> 8, FC) : addFlags(i, ClearStatusResultCodeIndexTable & 0xFF);
  return { a: code, b, hl, f };
}
// ClearStatusSetupMenuEntry (0A:4EF8)
export function* clearStatusSetupMenuEntry(P) { return yield* runClearStatusSetupMenu(P); }

// DrawPlayerPositionDebugOverlay (0A:4EFC), a frame task: with the debug flag, the player's X and Y in hex at
// (16, 0) and (16, 1). Returns the registers it leaves.
export function drawPlayerPositionDebugOverlay(P) {
  if (!testFlag(P, FLAG_DEBUG_SHOW_PLAYER_POS)) return { f: testFlagF(false) };
  P.wramBank(WRAM_ACTORS);
  P.callRom(0, PrintHexWord, { hl: P.V.storyModePlayersXPosition, de: DEBUG_POS_X_CELL });
  const y = P.V.storyModePlayersYPosition;
  const r = P.callRom(0, PrintHexWord, { hl: y, de: DEBUG_POS_Y_CELL });
  return { a: r.a, f: r.f, bc: r.bc, hl: y };
}

// RunStoryModeOverworld (0A:4F2C): the story mode, for ever: each location in turn (the frame tasks reset, the
// position readout registered first).
export function* runStoryModeOverworld(P) {
  P.V.overworldEnterFlag = 0;
  for (;;) {
    P.callRom(0, ClearFrameTasks);
    registerFrameTask(P, 1, DrawPlayerPositionDebugOverlay, P.cpu.sp - 2);
    yield* runStoryLocation(P);
  }
}

// RunStoryLocation (0A:4F40): enter the current location and run it until an exit (above). Keeps the registers.
export function* runStoryLocation(P) {
  const { bus, V } = P;
  beginFadeOut(P, FADE_OUT_SPEED);
  clearTemporaryStoryFlags(P);
  clearStoryEventRequests(P);
  loadStoryLocationHeader(P);
  loadStoryEntryPointRecord(P);
  V.gameMode = GAMEMODE_NONE;
  yield* advanceFrame(P);
  if (!testFlag(P, FLAG_ENDING_CREDITS_RUNNING) && V.storyLocationBGM !== BGM_UNCHANGED) playSoundManaged(P, V.storyLocationBGM);
  yield* P.runRom(BANK_TEXT, ResetTextWindowState);
  initLocationActors(P, V.storyLocationBank, V.mapActorsPtr);
  bus.w8(wActors + ACTORF_ANIM_SPEED, ANIM_SPEED_STILL);
  setFlag(P, FLAG_HIDE_OVERWORLD_ACTORS);
  yield* waitFadeEnd(P, cpuRegs(P));
  clearFlag(P, FLAG_HIDE_OVERWORLD_ACTORS);
  loadStoryObjPalettes(P);
  P.callRom(0, DisableLCDSafely);
  yield* P.runRom(BANK_TEXT, ResetTextWindowState);
  initSceneScroll(P);
  loadStorySceneGraphics(P, V.storyLocationScene);
  copyScrolledSceneTilemapToVram(P, 0);
  if (!testFlag(P, FLAG_ENDING_CREDITS_RUNNING)) yield* P.runRom(BANK_GAME, LoadMenuFontGfx);
  P.callRom(0, EnableLCD);
  const arrival = V.storyArrivalScript;
  if (arrival) yield* P.runRom(V.storyLocationBank, arrival, { a: V.storyLocationBank, hl: arrival });
  yield* runLocationInitScript(P, cpuRegs(P));
  const exit = V.storyModeExitTriggerRequest;
  if (exit) { V.storyModeExitTriggerRequest = 0; yield* runLocationExit(P, exit); return; }
  beginFadeIn(P, FADE_IN_SPEED);
  yield* waitFadeEnd(P, cpuRegs(P));
  if (V.storyModeShowLocationName) yield* showLocationNamePopup(P, { ...cpuRegs(P), hl: V.storyModeLocationNameTextId });
  else yield* waitFrames(P, ENTER_WAIT_FRAMES);
  for (;;) {                                         // .frameLoop
    P.wramBank(WRAM_ACTORS);
    if (!checkStoryEventRequests(P).a) {             // nothing asked: the player walks until something is
      yield* waitFadeEnd(P, cpuRegs(P));
      farcall(P, BANK_ACTORS, () => attachActorControllerScript(P, wActors));
      do yield* advanceFrame(P); while (!checkStoryEventRequests(P).a);
      continue;
    }
    const bank = P.V.romBank;
    farcall(P, BANK_ACTORS, () => setActorScript(P, wActors, bank, ActorScript_0a));
    bus.w8(wActors + ACTORF_ANIM_SPEED, ANIM_SPEED_STILL);
    const trigger = V.storyModeTriggerScript;
    if (trigger) { V.storyModeTriggerScript = 0; yield* runQueuedTriggerScript(P, trigger); }
    const exitId = V.storyModeExitTriggerRequest;
    if (exitId) { V.storyModeExitTriggerRequest = 0; yield* runLocationExit(P, exitId); return; }
    if (V.storyModeMenuRequest) {
      V.storyModeMenuRequest = 0;
      yield* waitPlayerMoveDone(P);
      if (!testFlag(P, FLAG_STORY_MENU_LOCKED)) { yield* P.runRom(BANK_MENU, RunStoryModeMenu); continue; }
    }
    V.storyAutoInteractFired = 0;
    if (V.storyAutoInteractArmed) {                  // walking into the same thing for a while talks to it
      V.storyAutoInteractArmed = 0;
      P.wramBank(WRAM_ACTORS);
      const applied = bus.u8(P.A.playerMoveAngleApplied);
      if (applied && applied === bus.u8(P.A.playerMoveAnglePrev) && bus.u8(P.A.playerMoving) >= AUTO_INTERACT_FRAMES) {
        bus.w8(P.A.playerMoving, 0);
        V.storyAutoInteractFired = 0xFF;
        V.storyModeInteractRequest = 1;
      }
    }
    V.storyScriptRan = 0;
    if (!V.storyModeInteractRequest) continue;
    V.storyModeInteractRequest = 0;
    const npc = findActorFacingPlayer(P).a;
    if (npc) { yield* runNpcInteraction(P, npc); if (V.storyScriptRan) continue; }
    const action = getFacingTileInteractionId(P).a;
    if (action) { yield* runFacingTileScript(P, action); if (V.storyScriptRan) continue; }
    const tile = getTileTriggerAtPlayer(P).a;
    if (tile) { yield* runTileTriggerScript(P, tile); continue; }
    if (V.storyAutoInteractFired || !V.debugStepMode) continue;
    yield* waitPlayerMoveDone(P);
    yield* P.runRom(BANK_TEXT, RunDebugMenu);
  }
}
const cpuRegs = P => ({ a: P.cpu.a, f: P.cpu.f, b: P.cpu.b, c: P.cpu.c, d: P.cpu.d, e: P.cpu.e, h: P.cpu.h, l: P.cpu.l });

// ClearTemporaryStoryFlags (0A:50E4): wGameFlagsTemp's 4 bytes cleared. Keeps the registers.
export function clearTemporaryStoryFlags(P) { for (let i = 0; i < 4; i++) P.bus.w8(P.A.gameFlagsTemp + i, 0); }
// ClearStoryEventRequests (0A:50F1) / CheckStoryEventRequests (0A:5104): the 6 request bytes cleared / ORed (a).
export function clearStoryEventRequests(P) { for (let i = 0; i < EVENT_REQUESTS; i++) P.bus.w8(P.A.storyModeTriggerScript + i, 0); }
export function checkStoryEventRequests(P) {
  let a = 0;
  for (let i = 0; i < EVENT_REQUESTS; i++) a |= P.bus.u8(P.A.storyModeTriggerScript + i);
  return { a, f: zf(a) };
}
// LoadStoryLocationHeader (0A:5114): the current location's record into wStoryModeCurrentLocation..+5, its map
// scripts' 7 pointers into wMapEntryPointsPtr.., its bank, its name's text id, and whether to show the name (not
// when entered without an entry point). Keeps the registers.
export function loadStoryLocationHeader(P) {
  const { V } = P;
  const rec = getStoryLocationRecordPtr(V.storyModeCurrentLocation).hl;
  copyMemoryBC(P, rec, P.A.storyModeCurrentLocation, 6);
  const slot = V.storyLocationMapScriptsSlot;
  V.storyLocationBank = slot >> 8;
  copyDataFromBank(P, slot >> 8, slot & 0xFF, P.A.mapEntryPointsPtr, 0x0E);
  V.storyModeLocationNameTextId = (V.storyModeCurrentLocation + LOCATION_NAME_TEXT_BASE) & 0xFFFF;
  V.storyModeShowLocationName = (V.storyModeEntryPoint - STORYENTRY_NONE) & 0xFF;
}
// WriteStoryStateWord (0A:5161): the word hl at wStoryModeCurrentLocation + de. Keeps the registers.
export function writeStoryStateWord(P, off, value) { P.bus.w16((P.A.storyModeCurrentLocation + off) & 0xFFFF, value); }
// LoadStoryEntryPointRecord (0A:516F): the entry record of wStoryModeEntryPoint (or the first) into
// wStoryMapRecord: the spawn facing and position, and the arrival script. Nothing with no entry point ($FF).
// Keeps the registers.
export function loadStoryEntryPointRecord(P) {
  const { V } = P, id = V.storyModeEntryPoint;
  if (id === STORYENTRY_NONE) return;
  let hl = V.mapEntryPointsPtr;
  for (;;) {
    const v = farReadByte(P, V.storyLocationBank, hl);
    if (v === STORYENTRY_NONE) { hl = V.mapEntryPointsPtr; break; }
    if (v === id) break;
    hl = (hl + 8) & 0xFFFF;
  }
  const rec = P.A.storyMapRecord;
  farCopyBytes(P, V.storyLocationBank, hl, rec, 8);
  P.bus.w8(P.A.storyModeSpawnPosition + 4, P.bus.u8(rec + 1));
  copyMemoryBC(P, rec + 2, P.A.storyModeSpawnPosition, 4);
  V.storyArrivalScript = P.bus.u16(rec + 6);
}

export const HOOKS = [
  [BANK, 0x4E0E, hook(P => setSinglesRankingClearFlags(P))],
  [BANK, 0x4E75, hook(P => setDoublesRankingClearFlags(P))],
  [BANK, 0x4ECA, hook(P => getClearStatusResultCode(P))],
  [BANK, 0x4EF8, hookGen(function* (P) { return { a: yield* clearStatusSetupMenuEntry(P) }; })],
  [BANK, 0x4EFC, hook(P => drawPlayerPositionDebugOverlay(P))],
  [BANK, 0x4F2C, hookGen(P => runStoryModeOverworld(P))],
  [BANK, 0x4F40, hookGen(P => runStoryLocation(P))],
  [BANK, 0x50E4, hook(P => { clearTemporaryStoryFlags(P); })],
  [BANK, 0x50F1, hook(P => { clearStoryEventRequests(P); })],
  [BANK, 0x5104, hook(P => checkStoryEventRequests(P))],
  [BANK, 0x5114, hook(P => { loadStoryLocationHeader(P); })],
  [BANK, 0x5161, hook((P, c) => { writeStoryStateWord(P, c.de, c.hl); })],
  [BANK, 0x516F, hook(P => { loadStoryEntryPointRecord(P); })],
];
