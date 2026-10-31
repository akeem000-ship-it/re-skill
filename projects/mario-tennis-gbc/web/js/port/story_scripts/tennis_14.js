// The tennis machine room (bank $14, $4063-$45F7): the arrival, the two students' lines, the levels' failed
// prompts (the target and the score shown) and cleared scenes, the tiles in front of the level boards and at the
// door, the init script (the scroll limits, the room drawn, the machine court's progress and the return entries),
// the result after a machine-court match, the attendant's offer of the next level (or of the record, or of a
// practice session) and the walk into the machine court. The map tables, text-id tables and the drill table are
// data; the room's other routines are court_machine_14's.
// Port of src/story/tennis_14.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss1_machine*.mtrec, ss1_mx_*.mtrec (part 1's scripted machine room), out/port/ss2_mach_*.mtrec
// (scripted: the levels failed and cleared, the game over, the attendant's partner).
import {
  ACTOR_PARTNER, ACTOR_PLAYER, ANIM_NOD, FACE_DOWN, FACE_LEFT, FACE_RIGHT, FACE_UP, FLAG_DOUBLES,
  FLAG_TEMP_SCENE_VARIANT_A, FLAG_TEMP_SCENE_VARIANT_B, FZ, STORYENTRY_NONE, advanceText, askYesNo, clearFlag,
  copySceneRect, copySceneToVram, disableLCDSafely, enableLCD, endCutscene, face, fadeIn, fadeOutAndWait,
  followPlayer, goToLocation, jumpTableTarget, movePlayer, moveTarget, nullScript, pushTextNumber, rd16, scene,
  setActorScript, setAnim, setFlag, setPosition, setSpeed, setText, speak, testFlag, wait, waitFadeEnd, waitIdle,
  waitMove, waitPlayerMove, withWram,
} from "./common.js";
import { runTrainingDrill } from "./coach_walks_15.js";
import { tableText } from "./shared2.js";
import { machinePracticeLevelPrompt, machineCourtHandleRetryChoice, machineExpertResultScene,
  machinePracticeResultScene, machineCourtWalkToAttendantCutscene, tennisMachineRoomNoEntryScene } from "./court_machine_14.js";

const BANK = 0x14;
const ACTOR_TENNIS_MACHINE_ROOM_WALK_72_06_1 = 0x03, ACTOR_TENNIS_MACHINE_ROOM_WALK_72_06_2 = 0x04;
const ATTENDANT = 0x05;                                  // ACTOR_TENNIS_MACHINE_ROOM_WALK_72_07
const ActorScript_14_0 = 0x4808;
const FLAG_PRACTICE_ROOM_SESSION_ACTIVE = 0x7D, FLAG_CLEARED_MACHINE_LEVEL_1 = 0xD2;
const FLAG_CLEARED_MACHINE_LEVEL_2 = 0xD3, FLAG_CLEARED_MACHINE_LEVEL_3 = 0xD4, FLAG_CLEARED_MACHINE_LEVEL_4 = 0xD5;
const FLAG_CLEARED_MACHINE_MASTER = 0xDA, FLAG_CLEARED_MACHINE_EXPERT = 0xDC;
// the machine court's stages (wMapSceneStage)
const STAGE_LEVEL2 = 0x01, STAGE_MASTER = 0x04, STAGE_EXPERT = 0x05, STAGE_COMPLETE = 0x06;
const STORYLOC_TENNIS_MACHINE_ROOM = 0x12, ENTRY_MATCH_RESULT = 0x05, ENTRY_PRACTICE_RESULT = 0x07;
const WINLOSE_WIN = 0x01, WRAM_SOUND = 0x07, MINIGAME_RECORD_MACHINE = 0x01;
const Text_6e_175 = 0x20AF, Text_6e_183 = 0x20B7, Text_6e_190 = 0x20BE, Text_6e_197 = 0x20C5, Text_6e_204 = 0x20CC;
const Text_6e_219 = 0x20DB, Text_6e_220 = 0x20DC, Text_6e_222 = 0x20DE;
// data of this bank (read from the ROM)
const TennisMachineRoomNpc03TextIds = 0x40A6, TennisMachineRoomNpc04TextIds = 0x40EC;
const TennisMachineRoomNpc05TextIds = 0x4600, MachineCourtStartLevelSceneTable = 0x45F8;
const MACHINE_EXPERT_RESULT = 0x4842;                  // court_machine_14's MachineExpertResultScene
const FailedPromptTable = 0x4318, ClearedSceneTable = 0x432C;   // the rst $00 tables of MachineCourtResultScene
// the room's scroll limits and map size (tiles)
const ROOM_SCROLL_MIN_X = 0x26, ROOM_SCROLL_MIN_Y = 0x23, ROOM_WIDTH = 0x40, ROOM_HEIGHT = 0x3C;
// routines of other banks (run as the ROM's, or the JS another part hooked there)
const ReadMinigameRecord = [0x03, 0x5015];
const stage = P => P.V.mapSceneStage;

// TennisMachineRoomArrival01_14 (14:4063): (unless entering keeping the position) the practice session over; the
// partner placed by the door (43, 59) facing up
export function* tennisMachineRoomArrival01(P) {
  if (P.V.storyModeEntryPoint === STORYENTRY_NONE) return;
  clearFlag(P, FLAG_PRACTICE_ROOM_SESSION_ACTIVE);
  if (!testFlag(P, FLAG_DOUBLES)) return;
  setPosition(P, ACTOR_PARTNER, 43.0, 59.0);
  face(P, ACTOR_PARTNER, FACE_UP);
}
// TennisMachineRoomNpc03_14 (14:408F): her line by the stage
export function* tennisMachineRoomNpc03(P) {
  yield* setText(P, tableText(P, BANK, TennisMachineRoomNpc03TextIds, stage(P)));
  yield* speak(P, ACTOR_TENNIS_MACHINE_ROOM_WALK_72_06_1);
}
// TennisMachineRoomNpc04_14 (14:40B4): his line by the stage; at level 2 a question
export function* tennisMachineRoomNpc04(P) {
  const actor = ACTOR_TENNIS_MACHINE_ROOM_WALK_72_06_2;
  yield* setText(P, tableText(P, BANK, TennisMachineRoomNpc04TextIds, stage(P)));
  if (stage(P) === STAGE_LEVEL2 && (yield* askYesNo(P, actor)) !== 0) advanceText(P);
  yield* speak(P, actor);
}
// MachineLevel1FailedPrompt (14:4113) .. MachineLevel4FailedPrompt (14:41B1): the attendant's line with the
// level's target and the score, then the retry question (court_machine_14)
function* failedPrompt(P, target) {
  yield* setText(P, Text_6e_219);
  pushTextNumber(P, target);
  pushTextNumber(P, rd16(P, "minigamesCurrentScore"));
  yield* machineCourtHandleRetryChoice(P);
}
// MachineLevel1ClearedScene (14:412B) .. MachineLevel4ClearedScene (14:41CA): back to the attendant, the level's
// line; the partner follows again
function* clearedScene(P, text) {
  yield* machineCourtWalkToAttendantCutscene(P);
  yield* setText(P, text);
  yield* speak(P, ATTENDANT);
  followPlayer(P, ACTOR_PARTNER);
}
export const machineLevel1FailedPrompt = P => failedPrompt(P, 0x0F);
export const machineLevel1ClearedScene = P => clearedScene(P, Text_6e_175);
export const machineLevel2FailedPrompt = P => failedPrompt(P, 0x1E);
export const machineLevel2ClearedScene = P => clearedScene(P, Text_6e_183);
export const machineLevel3FailedPrompt = P => failedPrompt(P, 0x3C);
export const machineLevel3ClearedScene = P => clearedScene(P, Text_6e_190);
export const machineLevel4FailedPrompt = P => failedPrompt(P, 0x64);
export const machineLevel4ClearedScene = P => clearedScene(P, Text_6e_197);
// TennisMachineRoomTile01_14 (14:4227): at the door: the session's flags cleared, the attendant back to the
// counter (45, 43), facing the player; the partner follows again
export function* tennisMachineRoomTile01(P) {
  clearFlag(P, FLAG_TEMP_SCENE_VARIANT_B);
  clearFlag(P, FLAG_PRACTICE_ROOM_SESSION_ACTIVE);
  moveTarget(P, ACTOR_PLAYER, 42.75, 43.0);
  yield* waitMove(P, ACTOR_PLAYER);
  moveTarget(P, ATTENDANT, 45.0, 43.0);
  yield* waitMove(P, ATTENDANT);
  yield* wait(P, 5);
  face(P, ATTENDANT, FACE_LEFT);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  followPlayer(P, ACTOR_PARTNER);
}
// TennisMachineRoomInitScript_14 (14:4278): the scroll limits and size; the room drawn (LCD off); the machine
// court's progress; entry 5 the match's result, 7 the practice's, none the session (court_machine_14)
export function* tennisMachineRoomInitScript(P) {
  P.V.mapScrollMinX = ROOM_SCROLL_MIN_X;
  P.V.mapScrollMinY = ROOM_SCROLL_MIN_Y;
  P.V.mapWidthTiles = ROOM_WIDTH;
  P.V.mapHeightTiles = ROOM_HEIGHT;
  disableLCDSafely(P);
  copySceneToVram(P, 0x00);
  enableLCD(P);
  yield* computeMachineCourtProgress(P);
  yield* waitPlayerMove(P);
  const entry = P.V.storyModeEntryPoint;
  if (entry === ENTRY_MATCH_RESULT) return yield* machineCourtResultScene(P);
  if (entry === ENTRY_PRACTICE_RESULT) return yield* machinePracticeResultScene(P);
  if (entry === STORYENTRY_NONE) yield* tennisMachineRoomNoEntryScene(P);
}
// the result scenes by address (the rst $00 tables' targets)
const RESULT_SCENES = {
  0x4113: machineLevel1FailedPrompt, 0x4147: machineLevel2FailedPrompt, 0x417C: machineLevel3FailedPrompt,
  0x41B1: machineLevel4FailedPrompt, 0x412B: machineLevel1ClearedScene, 0x4160: machineLevel2ClearedScene,
  0x4195: machineLevel3ClearedScene, 0x41CA: machineLevel4ClearedScene, [MACHINE_EXPERT_RESULT]: machineExpertResultScene,
};
function* resultScene(P, table, index) {
  const target = jumpTableTarget(P, BANK, table, index);
  if (RESULT_SCENES[target]) return yield* RESULT_SCENES[target](P);
  yield* P.runRom(BANK, target);
}
// MachineCourtResultScene (14:42B0): back from a machine-court match: the partner and the attendant placed, a fade
// in; game over: the walk back; lost: the level's failed prompt (rst $00 on the stage); won: the cleared scene of
// the level before the stage (the stage is the next one now)
export function* machineCourtResultScene(P) {
  if (testFlag(P, FLAG_DOUBLES)) {
    nullScript(P, ACTOR_PARTNER);
    yield* wait(P, 10);
    setPosition(P, ACTOR_PARTNER, 41.0, 43.0);
    face(P, ACTOR_PARTNER, FACE_RIGHT);
  }
  setPosition(P, ATTENDANT, 45.0, 41.0);                  // .win
  face(P, ATTENDANT, FACE_DOWN);
  fadeIn(P, 6);
  yield* waitFadeEnd(P);
  yield* wait(P, 40);
  setSpeed(P, ACTOR_PLAYER, 1.0);
  P.V.storyModeShowLocationName = 0;                      // .clearShowLocationName
  if (P.V.matchExitRequest) return yield* machineCourtGameOverExitScene(P);
  if (P.V.pointWinLoseFlag !== WINLOSE_WIN) return yield* resultScene(P, FailedPromptTable, stage(P));
  yield* resultScene(P, ClearedSceneTable, (stage(P) - 1) & 0xFF);   // .done
}
// MachineCourtGameOverExitScene (14:433A): the attendant's line, the player out of the court back to him; the
// partner follows again
export function* machineCourtGameOverExitScene(P) {
  yield* setText(P, Text_6e_220);
  yield* speak(P, ATTENDANT);
  moveTarget(P, ACTOR_PLAYER, 51.0, 54.0);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* movePlayer(P, 47.0, 45.0);
  moveTarget(P, ACTOR_PLAYER, 51.0, 43.0);
  yield* waitMove(P, ACTOR_PLAYER);
  moveTarget(P, ACTOR_PLAYER, 43.0, 43.0);
  yield* waitMove(P, ACTOR_PLAYER);
  moveTarget(P, ATTENDANT, 45.0, 43.0);
  yield* waitMove(P, ATTENDANT);
  face(P, ATTENDANT, FACE_LEFT);
  followPlayer(P, ACTOR_PARTNER);
}
// ReadMinigameRecord (03:5015) a = 1: the machine record into WRAM 7's wMinigameRecordValue. Returns its registers.
const readMachineRecord = (P, regs) => P.callRom(...ReadMinigameRecord, { a: MINIGAME_RECORD_MACHINE, ...regs });
// ComputeMachineCourtProgress (14:43A4): the machine court's stage (wMapSceneStage) by the levels cleared: 0-3 the
// levels (each cleared one's board lit: its scene cells (48, 44 + 4n) from (30, 44 + 4n)), 4 master (the record
// read), 5 expert, 6 complete
export function* computeMachineCourtProgress(P) {
  const levels = [FLAG_CLEARED_MACHINE_LEVEL_1, FLAG_CLEARED_MACHINE_LEVEL_2, FLAG_CLEARED_MACHINE_LEVEL_3,
    FLAG_CLEARED_MACHINE_LEVEL_4];
  for (let n = 0; n < levels.length; n++) {
    if (!testFlag(P, levels[n])) { P.V.mapSceneStage = n; return; }
    const row = 44 + 4 * n;
    yield* copySceneRect(P, 30, row, 48, row, 2, 2);
  }
  let a = readMachineRecord(P, { b: STAGE_MASTER }).b;    // (ld a, b: the b the record's routine leaves; the
  withWram(P, WRAM_SOUND, () => P.V.minigameRecordValue);  // record then read in WRAM 7 and dropped)
  if (testFlag(P, FLAG_CLEARED_MACHINE_MASTER)) a = testFlag(P, FLAG_CLEARED_MACHINE_EXPERT) ? STAGE_COMPLETE : STAGE_EXPERT;
  P.V.mapSceneStage = a;                                  // .machineCourtStartLevelScene
}
// TennisMachineRoomNpc05_14 (14:442D): the attendant. Variant A (a level accepted before): the level at once. Else
// his offer by the stage (from expert, with the record): yes, (variant A set, at level 1 his next line) a nod and
// the level; no, from level 1 cleared the practice session's question (yes: the session), else his other line
export function* tennisMachineRoomNpc05(P) {
  if (testFlag(P, FLAG_TEMP_SCENE_VARIANT_A)) return yield* machineCourtStartLevelScene(P);
  yield* setText(P, tableText(P, BANK, TennisMachineRoomNpc05TextIds, stage(P)));
  if (stage(P) >= STAGE_EXPERT) {                         // the record as the line's number
    pushTextNumber(P, withWram(P, WRAM_SOUND, () => { readMachineRecord(P, {}); return P.V.minigameRecordValue; }));
  }
  face(P, ACTOR_PARTNER, FACE_RIGHT);                     // .prompt
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  if ((yield* askYesNo(P, ATTENDANT)) === 0) {
    setFlag(P, FLAG_TEMP_SCENE_VARIANT_A);
    advanceText(P);
    if (!stage(P)) yield* speak(P, ATTENDANT);
    setAnim(P, ATTENDANT, ANIM_NOD);                      // .declined
    if (!((yield* waitIdle(P, ATTENDANT)).f & FZ)) return yield* machineCourtStartLevelScene(P);
  }
  if (testFlag(P, FLAG_CLEARED_MACHINE_LEVEL_1)) {        // .accepted
    yield* setText(P, Text_6e_222);
    if ((yield* askYesNo(P, ATTENDANT)) === 0) return yield* machineCourtStartSession(P);
  }
  yield* setText(P, tableText(P, BANK, TennisMachineRoomNpc05TextIds, stage(P)));   // .done
  advanceText(P);
  yield* speak(P, ATTENDANT);
}
// MachineCourtStartLevelScene (14:44E4): his line; he steps to the court's gate; the partner to the stands
// (doubles); the player walks into the machine court; from master his line; faded out, back to the room's entry 5
// after the stage's drill (MachineCourtStartLevelSceneTable)
export function* machineCourtStartLevelScene(P) {
  yield* speak(P, ATTENDANT);
  moveTarget(P, ATTENDANT, 45.0, 41.0);
  yield* waitMove(P, ATTENDANT);
  face(P, ATTENDANT, FACE_DOWN);
  if (testFlag(P, FLAG_DOUBLES)) {
    nullScript(P, ACTOR_PARTNER);
    setActorScript(P, ACTOR_PARTNER, ActorScript_14_0);
  }
  setSpeed(P, ACTOR_PLAYER, 1.0);                         // .walkOff
  yield* movePlayer(P, 56.0, 51.0);
  for (const [x, y] of [[51.0, 43.0], [51.0, 51.0], [56.0, 53.0]]) {
    moveTarget(P, ACTOR_PLAYER, x, y);
    yield* waitMove(P, ACTOR_PLAYER);
  }
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* wait(P, 10);
  if (stage(P) >= STAGE_MASTER) {
    yield* setText(P, Text_6e_204);
    yield* speak(P, ATTENDANT);
  }
  yield* fadeOutAndWait(P, 6);                            // .lt04
  clearFlag(P, FLAG_TEMP_SCENE_VARIANT_A);
  goToLocation(P, STORYLOC_TENNIS_MACHINE_ROOM, ENTRY_MATCH_RESULT);
  yield* runTrainingDrill(P, P.rom.u8(BANK, (MachineCourtStartLevelSceneTable + stage(P)) & 0xFFFF));
  endCutscene(P);
}
// MachineCourtStartLevelScene.speak (14:45A6): the practice session: his line; he steps to the gate, the partner
// to the stands, the player to (49, 43) facing down; the session's flags set
function* machineCourtStartSession(P) {
  yield* speak(P, ATTENDANT);
  setFlag(P, FLAG_TEMP_SCENE_VARIANT_B);
  moveTarget(P, ATTENDANT, 45.0, 41.0);
  yield* waitMove(P, ATTENDANT);
  face(P, ATTENDANT, FACE_DOWN);
  nullScript(P, ACTOR_PARTNER);
  setSpeed(P, ACTOR_PLAYER, 1.0);
  setActorScript(P, ACTOR_PARTNER, ActorScript_14_0);
  moveTarget(P, ACTOR_PLAYER, 49.0, 43.0);
  yield* waitMove(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  setFlag(P, FLAG_PRACTICE_ROOM_SESSION_ACTIVE);
}

export const HOOKS = [
  scene(BANK, 0x4063, tennisMachineRoomArrival01),
  scene(BANK, 0x408F, tennisMachineRoomNpc03),
  scene(BANK, 0x40B4, tennisMachineRoomNpc04),
  ...Object.entries(RESULT_SCENES).filter(([addr]) => +addr < 0x4200).map(([addr, fn]) => scene(BANK, +addr, fn)),
  ...[0x4210, 0x4216, 0x421C, 0x4222].map((addr, level) => scene(BANK, addr, P => machinePracticeLevelPrompt(P, level))),
  scene(BANK, 0x4227, tennisMachineRoomTile01),
  scene(BANK, 0x4278, tennisMachineRoomInitScript),
  scene(BANK, 0x42B0, machineCourtResultScene),
  scene(BANK, 0x433A, machineCourtGameOverExitScene),
  scene(BANK, 0x43A4, computeMachineCourtProgress),
  scene(BANK, 0x442D, tennisMachineRoomNpc05),
  scene(BANK, 0x44E4, machineCourtStartLevelScene),
];
