// The training gym's runners and the repair counter (bank $0E, $4C37-$5004): each runner's check that the runner
// ahead is clear of its path (both coordinates within 5 tiles), the repair counter's dialogue by the story's
// progress (the rackets and shoes it hands out), its service menu (change rackets, change shoes: the equipment
// select screens of bank $3E), the screen set up for and restored after them, the equipment names as the next
// message's argument and the returns to the counter.
// Port of src/story/repair_0e.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/engine/rec2.mtrec (the training gym's runners), out/port/ss2_repair*.mtrec (scripted: the counter
// by the story's progress, its menus); tests: web/tests/port/routines_story_scripts2.mjs.
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FACE_RIGHT, FLAG_DOUBLES, FZ, FN, FH, FC, ACTORF_X, ACTORF_Y,
  testFlag, setFlag, setText, speak, askYesNo, wait, face, faceToward, setPosition, movePlayer, waitPlayerMove,
  playerSpeed, menuFromText, fadeOutAndWait, clearFrameTasks, disableLCDSafely, enableLCD, goToLocation, farcall,
  BANK_STORY, hook, scene,
} from "./common.js";
import { getActorStateAddr } from "../story/script.js";
import { pushTextArgFetchedString } from "./shared2.js";
import { repairCounterCheckEquipChanged } from "./mario_world_0e.js";

const BANK = 0x0E;
// the training gym's actors (TrainingGymActors_0e, training_0e.asm)
const ACTOR_TRAINING_GYM_WALK_72_04_1 = 0x0A, ACTOR_TRAINING_GYM_WALK_72_05 = 0x0B;
const ACTOR_TRAINING_GYM_WALK_72_04_2 = 0x0C, ACTOR_TRAINING_GYM_WALK_72_02_2 = 0x0E;   // (the counter's clerk)
const ACTORF_FLAGS = 0x05, ACTORF_TARGET_X = 0x08, ACTORF_TARGET_Y = 0x0A, ACTORFLAG_PAUSED = 0x01;
const FLAG_HAVE_LARGE_RACKET = 0x61, FLAG_HAVE_SMALL_RACKET = 0x62, FLAG_HAVE_LIGHT_SHOES = 0x68;
const FLAG_REPAIR_COUNTER_GREETED = 0x7E, FLAG_REPAIR_COUNTER_EQUIP_CHANGED = 0x7F;
const FLAG_WON_JUNIOR_SINGLES_RANK_1 = 0x53, FLAG_WON_SENIOR_SINGLES_RANK_1 = 0x57;
const STORYLOC_TRAINING_CENTER = 0x11;
const Text_6e_227 = 0x20E3, Text_6e_228 = 0x20E4, Text_6e_229 = 0x20E5, Text_6e_230 = 0x20E6, Text_6e_231 = 0x20E7;
const Text_6e_232 = 0x20E8, Text_6e_233 = 0x20E9, Text_6e_234 = 0x20EA, Text_6e_235 = 0x20EB, Text_6e_236 = 0x20EC;
const Text_6e_237 = 0x20ED, Text_6e_238 = 0x20EE, Text_6e_242 = 0x20F2, Text_1f_3 = 0x2403, Text_1f_10 = 0x240A;
// the short texts of the rackets ($E5 + n) and shoes ($F4 + n)
const RACKET_NAMES = 0x00E5, SHOES_NAMES = 0x00F4;
const MENU_CANCELLED = 0xFF, MENU_RACKETS = 0, MENU_LEAVE = 2;
const RunRacketSelectScreen = [0x3E, 0x54BD], RunShoesSelectScreen = [0x3E, 0x5645], LoadMenuFontGfx = [0x01, 0x50E2];
const CLEAR_RANGE = 5;                                 // tiles
// wMapScratch: +0 / +2 the runner's x / y, +4 / +6 the runner ahead's target x / y, +8 the racket before, +10 the
// service menu's choice (0 rackets, 1 shoes)
const SCRATCH_RACKET = 8, SCRATCH_CHOICE = 10;
const scratch = (P, off) => P.bus.u8(P.A.mapScratch + off);

// script_get_actor_state actor (GetActorStateAddr through FarCall): the actor's record (WRAM 4 mapped) and the
// registers it leaves
const stateOf = (P, actor) => farcall(P, BANK_STORY, () => getActorStateAddr(P, actor));
// `ld hl, field / add hl, bc`: bc + field and the flags (Z kept)
const fieldAt = (f, bc, field) => ({ hl: (bc + field) & 0xFFFF,
  f: (f & FZ) | ((bc & 0xFFF) + field > 0xFFF ? FH : 0) | (bc + field > 0xFFFF ? FC : 0) });
// TrainingGymRunnerCheckClearance (0E:4D3C): a = b = 1 when the runner (wMapScratch +0 / +2) and the target of the
// one ahead (+4 / +6) are within 5 tiles in y and in x, else 0. Leaves de = the last pair read, hl = the last
// distance (the absolute difference), F of its `cp 5`.
export function trainingGymRunnerCheckClearance(P) {
  const word = off => P.bus.u16(P.A.mapScratch + off);
  const distance = (a, b) => { const d = (a - b) & 0xFFFF; return d & 0x8000 ? (0x10000 - d) & 0xFFFF : d; };
  let de = word(2), hl = distance(word(6), de);
  const check = h => ({ f: (h === CLEAR_RANGE ? FZ : 0) | FN | ((h & 0xF) < CLEAR_RANGE ? FH : 0) | (h < CLEAR_RANGE ? FC : 0) });
  if ((hl >> 8) >= CLEAR_RANGE) return { a: 0, b: 0, de, hl, ...check(hl >> 8) };
  de = word(0); hl = distance(word(4), de);
  if ((hl >> 8) >= CLEAR_RANGE) return { a: 0, b: 0, de, hl, ...check(hl >> 8) };
  return { a: 1, b: 1, de, hl, ...check(hl >> 8) };
}
// TrainingGymRunner0A/0B/0CWaitWaypointClear (0E:4C37 / 4C8E / 4CE5): runner `self`'s position and runner `ahead`'s
// target into wMapScratch, then TrainingGymRunnerCheckClearance (a = 1: clear to go on). c: the low byte of the
// second record read.
function runnerWaitWaypointClear(P, self, ahead) {
  const me = stateOf(P, self).hl;
  P.bus.w16(P.A.mapScratch + 2, P.bus.u16(me + ACTORF_Y));
  P.bus.w16(P.A.mapScratch, P.bus.u16(me + ACTORF_X));
  const other = stateOf(P, ahead).hl;
  P.bus.w16(P.A.mapScratch + 6, P.bus.u16(other + ACTORF_TARGET_Y));
  P.bus.w16(P.A.mapScratch + 4, P.bus.u16(other + ACTORF_TARGET_X));
  return { ...trainingGymRunnerCheckClearance(P), c: other & 0xFF };
}
// UnusedTrainingGymRunner0A/0B/0CClearWaypoint (0E:4C7C / 4CD3 / 4D2A): actor slot's paused flag cleared; a = b = 0.
// Nothing calls them.
function unusedRunnerClearWaypoint(P, slot) {
  const st = stateOf(P, slot), at = fieldAt(st.f, st.hl, ACTORF_FLAGS);
  P.bus.w8(at.hl, P.bus.u8(at.hl) & ~ACTORFLAG_PAUSED);
  return { a: 0, b: 0, c: st.hl & 0xFF, hl: at.hl, f: at.f };
}
// RunRepairCounterDialogue (0E:4D88): the clerk. Before the junior singles title a greeting (the first time its own
// line; doubles: their pair); with it, before the senior title the large racket handed out (its line once, then
// another), after it the small racket and light shoes too; then "anything to change?" (yes: the service menu)
export function* runRepairCounterDialogue(P) {
  faceToward(P, ACTOR_PLAYER, ACTOR_TRAINING_GYM_WALK_72_02_2);
  if (!testFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_1)) {
    const doubles = testFlag(P, FLAG_DOUBLES), greeted = testFlag(P, FLAG_REPAIR_COUNTER_GREETED);
    yield* setText(P, doubles ? (greeted ? Text_6e_230 : Text_6e_229) : (greeted ? Text_6e_228 : Text_6e_227));
    if (!greeted) setFlag(P, FLAG_REPAIR_COUNTER_GREETED);
    yield* speak(P, ACTOR_TRAINING_GYM_WALK_72_02_2);
    face(P, ACTOR_TRAINING_GYM_WALK_72_02_2, FACE_RIGHT);
    return;
  }
  if (!testFlag(P, FLAG_WON_SENIOR_SINGLES_RANK_1)) {              // .noRepair
    setFlag(P, FLAG_HAVE_LARGE_RACKET);
    if (testFlag(P, FLAG_REPAIR_COUNTER_EQUIP_CHANGED)) yield* setText(P, Text_6e_233);
    else {
      yield* setText(P, Text_6e_231);
      setFlag(P, FLAG_REPAIR_COUNTER_EQUIP_CHANGED);
    }
  } else {                                                          // .repairMenu
    setFlag(P, FLAG_HAVE_LARGE_RACKET);
    setFlag(P, FLAG_HAVE_SMALL_RACKET);
    setFlag(P, FLAG_HAVE_LIGHT_SHOES);
    yield* setText(P, Text_6e_233);
  }
  faceToward(P, ACTOR_PLAYER, ACTOR_TRAINING_GYM_WALK_72_02_2);      // .done
  if ((yield* askYesNo(P, ACTOR_TRAINING_GYM_WALK_72_02_2)) === 0) return yield* repairCounterFarewellAlt(P);
  return yield* repairCounterFarewell(P);
}
// RepairCounterFarewell (0E:4E43): the clerk's goodbye
export function* repairCounterFarewell(P) {
  yield* setText(P, Text_6e_234);
  yield* speak(P, ACTOR_TRAINING_GYM_WALK_72_02_2);
}
// RepairCounterFarewell.altLine (0E:4E4F): "what shall it be?", then the service menu
export function* repairCounterFarewellAlt(P) {
  yield* setText(P, Text_6e_235);
  yield* speak(P, ACTOR_TRAINING_GYM_WALK_72_02_2);
  yield* wait(P, 5);
  return yield* repairCounterServiceMenu(P);
}
// RepairCounterServiceMenu (0E:4E61): the menu (rackets, shoes, leave); its .loop with a choice already made: leave
// or cancel: goodbye; rackets: the racket screen; shoes: the shoe screen once the senior title is won, else "not
// yet" and "anything else?" (yes: the menu again)
export function* repairCounterServiceMenu(P, choice) {
  for (;;) {
    if (choice === undefined) choice = yield* menuFromText(P, Text_6e_236, 1, 1);
    const c = choice;
    choice = undefined;
    P.bus.w8(P.A.mapScratch + SCRATCH_CHOICE, c);
    if (c === MENU_CANCELLED || c === MENU_LEAVE) return yield* repairCounterFarewell(P);
    if (c === MENU_RACKETS) return yield* repairCounterChangeRackets(P);
    if (testFlag(P, FLAG_WON_SENIOR_SINGLES_RANK_1)) return yield* repairCounterChangeShoes(P);
    yield* setText(P, Text_6e_232);
    yield* speak(P, ACTOR_TRAINING_GYM_WALK_72_02_2);
    yield* setText(P, Text_6e_242);
    if ((yield* askYesNo(P, ACTOR_TRAINING_GYM_WALK_72_02_2)) !== 0) return yield* repairCounterFarewell(P);
  }
}
// PrepareEquipmentSelectScreen (0E:4EB2): the racket before the change kept (wMapScratch + 8); back here (the
// training center at entry wMapSceneStage2) when the scene ends; fade out, the frame tasks and the LCD off, the
// menu font, the scroll and camera reset
export function* prepareEquipmentSelectScreen(P) {
  P.bus.w8(P.A.mapScratch + SCRATCH_RACKET, P.V.equippedRacket);
  goToLocation(P, STORYLOC_TRAINING_CENTER, P.V.mapSceneStage2);
  yield* fadeOutAndWait(P, 16);
  clearFrameTasks(P);
  disableLCDSafely(P);
  yield* P.runRom(...LoadMenuFontGfx);
  P.V.bGColumnBlitPending = 0; P.V.bGRowBlitPending = 0; P.V.scrollY = 0; P.V.scrollX = 0;
  P.bus.w8(P.A.cameraX + 1, 0);
}
// RepairCounterChangeRackets / ChangeShoes (0E:4EE9 / 0E:4EFF): the clerk's line, the equipment select screen;
// a change made: the next return stage (RestoreScreenAfterEquipSelect.advanceStage), else the screen restored
function* changeEquipment(P, text, screen) {
  yield* setText(P, text);
  yield* speak(P, ACTOR_TRAINING_GYM_WALK_72_02_2);
  yield* prepareEquipmentSelectScreen(P);
  const r = yield* P.runRom(...screen);
  if (r.a) return yield* restoreScreenAfterEquipSelectAdvance(P);
  return yield* restoreScreenAfterEquipSelect(P);
}
export const repairCounterChangeRackets = P => changeEquipment(P, Text_6e_237, RunRacketSelectScreen);
export const repairCounterChangeShoes = P => changeEquipment(P, Text_6e_238, RunShoesSelectScreen);
// RestoreScreenAfterEquipSelect (0E:4F13): the LCD off, the menu font, the LCD on
export function* restoreScreenAfterEquipSelect(P) {
  disableLCDSafely(P);
  yield* P.runRom(...LoadMenuFontGfx);
  enableLCD(P);
}
// RestoreScreenAfterEquipSelect.advanceStage (0E:4F1D): wMapSceneStage2 + 2 (the changed return's entry point),
// back to the training center there, the screen restored
export function* restoreScreenAfterEquipSelectAdvance(P) {
  P.V.mapSceneStage2 = (P.V.mapSceneStage2 + 2) & 0xFF;
  goToLocation(P, STORYLOC_TRAINING_CENTER, P.V.mapSceneStage2);
  yield* restoreScreenAfterEquipSelect(P);
}
// GetEquippedRacketNibble (0E:4F5D): the equipment of the menu's choice: the racket (wEquippedRacket's low nibble)
// or the shoes (its high nibble). F: of the `and`.
export function getEquippedRacketNibble(P) {
  const v = P.V.equippedRacket;
  if (!scratch(P, SCRATCH_CHOICE)) { const a = v & 0x0F; return { a, f: (a ? 0 : FZ) | FH }; }
  const a = (v & 0xF0) >> 4;
  return { a, f: a ? 0 : FZ };                                      // (`swap a`)
}
// short text base + the nibble: `ld hl, base / add l / ld l, a / jr nc / inc h`, hl and the flags
function nameText(P, base) {
  const n = getEquippedRacketNibble(P).a, l = (base & 0xFF) + n;
  const hl = (base + n) & 0xFFFF;
  return { hl, f: l > 0xFF ? (((base >> 8) + 1) & 0xFF ? 0 : FZ) | (((base >> 8) & 0xF) === 0xF ? FH : 0) | FC
    : ((l & 0xFF) ? 0 : FZ) | ((base & 0xF) + (n & 0xF) > 0xF ? FH : 0) };
}
// PushEquipmentNameTextArg (0E:4F73): the chosen equipment's name (short text $E5 + racket / $F4 + shoes) as the
// next message's string argument (FetchAndPushShortTextArg's registers)
export function pushEquipmentNameTextArg(P) {
  const t = nameText(P, scratch(P, SCRATCH_CHOICE) ? SHOES_NAMES : RACKET_NAMES);
  return pushTextArgFetchedString(P, t.hl, t.f);
}
// InitEquipmentHandoutDialogue (0E:4F99): the dialogue goes on from the chosen equipment's hand-out text
// (Text_1f_3 + racket / Text_1f_10 + shoes)
export function* initEquipmentHandoutDialogue(P) {
  yield* setText(P, nameText(P, scratch(P, SCRATCH_CHOICE) ? Text_1f_10 : Text_1f_3).hl);
}
// RepairCounterReturnA / B (0E:4FBF / 0E:4FDB): back from the select screen without a change (entry $0B: the
// partner placed; $0C: the player walked to the counter first), then RepairCounterCheckEquipChanged
export function* repairCounterReturnA(P) {
  P.V.mapSceneStage2 = 0x0B;
  faceToward(P, ACTOR_PLAYER, ACTOR_TRAINING_GYM_WALK_72_02_2);
  setPosition(P, ACTOR_PARTNER, 15.0, 15.0);
  return yield* repairCounterCheckEquipChanged(P);
}
export function* repairCounterReturnB(P) {
  P.V.mapSceneStage2 = 0x0C;
  yield* waitPlayerMove(P);
  playerSpeed(P, 7.5);
  yield* movePlayer(P, 13.0, 17.0);
  yield* waitPlayerMove(P);
  setPosition(P, ACTOR_PARTNER, 19.0, 19.0);
  return yield* repairCounterCheckEquipChanged(P);
}

export const HOOKS = [
  [BANK, 0x4C37, hook(P => runnerWaitWaypointClear(P, ACTOR_TRAINING_GYM_WALK_72_04_2, ACTOR_TRAINING_GYM_WALK_72_04_1))],
  [BANK, 0x4C7C, hook(P => unusedRunnerClearWaypoint(P, 0x0A))],
  [BANK, 0x4C8E, hook(P => runnerWaitWaypointClear(P, ACTOR_TRAINING_GYM_WALK_72_04_1, ACTOR_TRAINING_GYM_WALK_72_05))],
  [BANK, 0x4CD3, hook(P => unusedRunnerClearWaypoint(P, 0x0B))],
  [BANK, 0x4CE5, hook(P => runnerWaitWaypointClear(P, ACTOR_TRAINING_GYM_WALK_72_05, ACTOR_TRAINING_GYM_WALK_72_04_2))],
  [BANK, 0x4D2A, hook(P => unusedRunnerClearWaypoint(P, 0x0C))],
  [BANK, 0x4D3C, hook(P => trainingGymRunnerCheckClearance(P))],
  scene(BANK, 0x4D88, runRepairCounterDialogue),
  scene(BANK, 0x4E43, repairCounterFarewell),
  scene(BANK, 0x4E61, P => repairCounterServiceMenu(P)),
  scene(BANK, 0x4EB2, prepareEquipmentSelectScreen),
  scene(BANK, 0x4EE9, repairCounterChangeRackets),
  scene(BANK, 0x4EFF, repairCounterChangeShoes),
  scene(BANK, 0x4F13, restoreScreenAfterEquipSelect),
  [BANK, 0x4F3C, hook((P, c) => pushTextArgFetchedString(P, c.hl, c.f))],   // FetchAndPushShortTextArg
  [BANK, 0x4F5D, hook(P => getEquippedRacketNibble(P))],
  [BANK, 0x4F73, hook(P => pushEquipmentNameTextArg(P))],
  scene(BANK, 0x4F99, initEquipmentHandoutDialogue),
  scene(BANK, 0x4FBF, repairCounterReturnA),
  scene(BANK, 0x4FDB, repairCounterReturnB),
];
