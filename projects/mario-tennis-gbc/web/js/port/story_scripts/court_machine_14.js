// The tennis machine room and Court 2 (bank $14, $4600-$4F66). The machine room: the attendant's level prompt
// (a level only once the one before is cleared), the practice and expert results with the retry prompt, the new
// record (saved to the minigame records) and the walk back to the attendant. Court 2 (the Island Open's second
// court): the NPCs' lines by the tournament stage, the two spectators' chat, the init script choosing the stage
// (and the final's actors). The location tables, text-id tables, flag table and ActorScript_14_0 are data.
// Port of src/story/court_machine_14.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are; Court2EntryWalkIn is src/twins/
// restaurant_plaza_arrival06.asm (twins.js).
// Recordings: out/port/ss1_machine*.mtrec, out/port/ss1_court2*.mtrec (scripted: the machine room, Court 2).
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FACE_DOWN, FACE_LEFT, FACE_RIGHT, FACE_UP, ANIM_NOD, ANIM_BOUNCE, ANIM_SHAKE,
  FLAG_DOUBLES, FLAG_TEMP_SCENE_VARIANT_B, testFlag, setFlag, rd, wr, setText, speak, askYesNo, gesture, setAnim,
  waitIdle, faceToward, face, setPosition, moveTarget, moveAngle, waitMove, movePlayer, setSpeed, nullScript, wait,
  fadeInAndWait, fadeOutAndWait, sound, goToLocation, pushTextNumber, followPlayer, respawnActors, beginCutscene,
  endCutscene, withWram, testFlagTableEntry, setFlagTableEntry, sub16, FZ, FC, hook, hookGen, scene,
} from "./common.js";
import { arrivalWalkLeft, loadCourtPlayerPartnerObjDefs } from "./twins.js";
import { runTrainingDrill } from "./coach_walks_15.js";

const BANK = 0x14;
const BANK_SAVE_RECORDS = 0x03, ReadMinigameRecord = 0x5015, UpdateMinigameRecord = 0x5072;
const ComputeMachineCourtProgress = 0x43A4;             // tennis_14.asm (not ported here)
const WRAM_SOUND = 7;                                   // (the minigame records' bank)
const MINIGAME_RECORD_MACHINE = 0x01;                   // ReadMinigameRecord's a: the machine expert's record
const ACTOR_TENNIS_MACHINE_ROOM_WALK_72_07 = 0x05;      // the attendant
const ACTOR_COURT2_WALK_6F_07_1 = 0x03, ACTOR_COURT2_WALK_6F_07_2 = 0x04, ACTOR_COURT2_WALK_71_03 = 0x05;
const ACTOR_ROLE_COURT2_SPECTATOR = 0x06, ACTOR_COURT2_WALK_72_02_3 = 0x08, ACTOR_COURT2_WALK_72_03_1 = 0x09;
const ACTOR_COURT2_WALK_6F_05 = 0x0A, ACTOR_COURT2_BALLOON_EXCLAIM = 0x0C, ACTOR_COURT2_BALLOON_SWEAT = 0x0D;
const ACTOR_COURT2_BALLOON_QUESTION = 0x0E;
const FLAG_WON_ISLAND_OPEN_DOUBLES_SEMIFINAL = 0x36, FLAG_WON_ISLAND_OPEN_DOUBLES_ROUND_1 = 0x37;
const FLAG_WON_ISLAND_OPEN_SINGLES_SEMIFINAL = 0x3D, FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_2 = 0x3E;
const FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_1 = 0x3F, FLAG_COURT2_SPECTATORS_TALKED_SINGLES = 0x78;
const FLAG_COURT2_SPECTATORS_TALKED_DOUBLES = 0x79, FLAG_PRACTICE_ROOM_SESSION_ACTIVE = 0x7D;
const FLAG_CLEARED_MACHINE_EXPERT = 0xDC;
const ISLANDOPENSTAGE_SINGLES_ROUND1 = 0x00, ISLANDOPENSTAGE_SINGLES_ROUND2 = 0x01;
const ISLANDOPENSTAGE_SINGLES_SEMIFINAL = 0x02, ISLANDOPENSTAGE_SINGLES_FINAL = 0x03;
const ISLANDOPENSTAGE_DOUBLES_ROUND1 = 0x04, ISLANDOPENSTAGE_DOUBLES_SEMIFINAL = 0x05;
const ISLANDOPENSTAGE_DOUBLES_FINAL = 0x06;
const MINIGAME_TENNIS_MACHINE_1 = 0x12, MINIGAME_TENNIS_MACHINE_HIGH_SCORE = 0x1A;
const STORYLOC_TENNIS_MACHINE_ROOM = 0x12;
const MACHINE_ROOM_LEVEL_ENTRY = 0x07, MACHINE_ROOM_FIRST_ENTRY = 0x05;   // back after a level / a first try
const WINLOSE_WIN = 0x01;
const SFX_APPEAR2 = 0x96, SFX_CHIME = 0x97, SFX_EMOTE = 0x98;
const RECORD_MAX = 9999;
const Text_1f_106 = 0x246A, Text_1f_111 = 0x246F, Text_1f_113 = 0x2471, Text_1f_145 = 0x2491;
const Text_6e_206 = 0x20CE, Text_6e_212 = 0x20D4, Text_6e_219 = 0x20DB, Text_6e_220 = 0x20DC;
const Text_6e_221 = 0x20DD, Text_6e_224 = 0x20E0, Text_6e_225 = 0x20E1;
// data of this bank
const TestMachineLevelClearedFlagTable = 0x46BD, Court2Npc04TextIds = 0x4B84, Court2Npc05TextIds = 0x4BA9;
const Court2Npc06TextIds = 0x4BCE, Court2SpectatorChatTextIds = 0x4D5F, Court2ActorsAlt_14 = 0x4EB4;
const ATTENDANT = ACTOR_TENNIS_MACHINE_ROOM_WALK_72_07;

const tableWord = (P, table, i) => P.rom.u16(BANK, (table + ((i * 2) & 0xFF)) & 0xFFFF);
const score = P => P.V.minigamesCurrentScore;
// the machine expert's record (ReadMinigameRecord 03:5015 with a = 1, WRAM_SOUND mapped: wMinigameRecordValue)
function readMachineRecord(P) {
  return withWram(P, WRAM_SOUND, () => {
    P.callRom(BANK_SAVE_RECORDS, ReadMinigameRecord, { a: MINIGAME_RECORD_MACHINE });
    return P.V.minigameRecordValue;
  });
}

// ---- the machine room ----
// TestMachineLevelClearedFlag (14:469F): whether level a is cleared (the ROM's registers: f, de, a, hl);
// Unused_14_SetMachineLevelClearedFlag (14:46AE): that flag set
export const testMachineLevelClearedFlag = (P, level) => testFlagTableEntry(P, BANK, TestMachineLevelClearedFlagTable, level);
export const unusedSetMachineLevelClearedFlag = (P, level) => setFlagTableEntry(P, BANK, TestMachineLevelClearedFlagTable, level);
const levelCleared = (P, level) => !(testMachineLevelClearedFlag(P, level).f & FZ);

// MachinePracticeLevelPrompt (14:4612), a = the level (0-based, kept in wMapScratch + 6): when its flag is set,
// the attendant asks about it (its number shown); a yes: the player walks into the machine court, a fade out and
// the level's drill, back to the room at entry 7
export function* machinePracticeLevelPrompt(P, level) {
  wr(P, "mapScratch", level, 6);
  if (!levelCleared(P, level)) return yield* machineLevelNotClearedMessage(P);
  yield* setText(P, Text_6e_224);
  pushTextNumber(P, (rd(P, "mapScratch", 6) + 1) & 0xFF);
  if ((yield* askYesNo(P, ATTENDANT)) !== 0) return;
  face(P, ATTENDANT, FACE_UP);
  setSpeed(P, ACTOR_PLAYER, 1.0);
  moveAngle(P, ACTOR_PLAYER, FACE_RIGHT, 2.0);
  yield* waitMove(P, ACTOR_PLAYER);
  moveTarget(P, ACTOR_PLAYER, 53.0, 53.0);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* fadeOutAndWait(P, 8);
  goToLocation(P, STORYLOC_TENNIS_MACHINE_ROOM, MACHINE_ROOM_LEVEL_ENTRY);
  yield* runTrainingDrill(P, (rd(P, "mapScratch", 6) + MINIGAME_TENNIS_MACHINE_1) & 0xFF);
  endCutscene(P);
}
// MachineLevelNotClearedMessage (14:4693)
export function* machineLevelNotClearedMessage(P) {
  yield* setText(P, Text_6e_225);
  yield* speak(P, ATTENDANT);
}

// MachinePracticeResultScene (14:46C5): back from a level: the partner and the attendant placed, a fade in; unless
// the match was left, the attendant gives the target and the score and asks to try again
export function* machinePracticeResultScene(P) {
  P.V.storyModeShowLocationName = 0;
  setFlag(P, FLAG_TEMP_SCENE_VARIANT_B);
  if (testFlag(P, FLAG_DOUBLES)) {
    nullScript(P, ACTOR_PARTNER);
    setPosition(P, ACTOR_PARTNER, 41.0, 43.0);
    face(P, ACTOR_PARTNER, FACE_RIGHT);
    yield* wait(P, 10);
  }
  setPosition(P, ATTENDANT, 45.0, 41.0);                // .placeActors
  face(P, ATTENDANT, FACE_DOWN);
  yield* fadeInAndWait(P, 6);
  yield* wait(P, 40);
  if (P.V.matchExitRequest) return;
  yield* setText(P, Text_6e_219);
  pushTextNumber(P, P.V.minigamesTargetScore);
  pushTextNumber(P, score(P));
  setSpeed(P, ACTOR_PLAYER, 1.0);
  if ((yield* askYesNo(P, ATTENDANT)) === 0) yield* machineCourtRestartLevel(P);
}
// MachineCourtHandleRetryChoice (14:474E): yes, the level again; no, the attendant's line, the walk back to him
// and the partner following again
export function* machineCourtHandleRetryChoice(P) {
  if ((yield* askYesNo(P, ATTENDANT)) === 0) return yield* machineCourtRestartLevel(P);
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
// MachineCourtRestartLevel (14:47CD): the drill again (wCurrentMinigameStoryMatch + 1); back at entry 7, or at 5
// for the high-score level and a level not cleared yet
export function* machineCourtRestartLevel(P) {
  const drill = rd(P, "currentMinigameStoryMatch", 1);
  const again = drill !== MINIGAME_TENNIS_MACHINE_HIGH_SCORE && levelCleared(P, (drill - MINIGAME_TENNIS_MACHINE_1) & 0xFF);
  goToLocation(P, STORYLOC_TENNIS_MACHINE_ROOM, again ? MACHINE_ROOM_LEVEL_ENTRY : MACHINE_ROOM_FIRST_ENTRY);
  yield* runTrainingDrill(P, rd(P, "currentMinigameStoryMatch", 1));
}
// UnusedMachineRecordOverrideAndReturn_14 (14:4813): the machine record read and overwritten with 80; back to the
// room at entry 1
export function unusedMachineRecordOverrideAndReturn(P) {
  withWram(P, WRAM_SOUND, () => {
    P.callRom(BANK_SAVE_RECORDS, ReadMinigameRecord, { a: MINIGAME_RECORD_MACHINE });
    P.V.minigameRecordValue = 0x0050;
  });
  goToLocation(P, STORYLOC_TENNIS_MACHINE_ROOM, 0x01);
}

// MachineExpertResultScene (14:4842): after the expert level: once it is cleared, a win goes to the counter-max
// scene; a score of 0 or 1, or a record near 9999, to the retry prompt; a score above the record, the new record
// scene; else the retry prompt. (The ROM's 9999 tests are `jp z` after the 16-bit `sub`/`sbc`: Z of the high
// byte only, so a record whose difference to 9999 is under 256 counts as at the top.)
export function* machineExpertResultScene(P) {
  if (testFlag(P, FLAG_CLEARED_MACHINE_EXPERT) && P.V.pointWinLoseFlag === WINLOSE_WIN) {
    return yield* machineExpertCounterMaxScene(P);
  }
  if (!(sub16(0x0001, score(P)).f & FC)) return yield* machineExpertRetryPrompt(P);   // (.notClearedMachineExpert)
  if (sub16(RECORD_MAX, readMachineRecord(P)).f & FZ) return yield* machineExpertRetryPrompt(P);
  const record = withWram(P, WRAM_SOUND, () => P.V.minigameRecordValue);
  if (!(sub16(score(P), (record + 1) & 0xFFFF).f & FC)) return yield* machineExpertNewRecordScene(P);
  yield* machineExpertRetryPrompt(P);
}
// MachineExpertRetryPrompt (14:48BE): the score said, then MachineCourtHandleRetryChoice
export function* machineExpertRetryPrompt(P) {
  yield* setText(P, Text_6e_221);
  pushTextNumber(P, score(P));
  yield* machineCourtHandleRetryChoice(P);
}
// MachineExpertNewRecordScene (14:48D1): the record saved, the walk to the attendant, his line on the new record
export function* machineExpertNewRecordScene(P) {
  yield* saveMachineExpertRecord(P);
  yield* setText(P, Text_6e_206);
  pushTextNumber(P, score(P));
  yield* machineCourtWalkToAttendantCutscene(P);
  yield* speak(P, ATTENDANT);
  followPlayer(P, ACTOR_PARTNER);
}
// MachineExpertCounterMaxScene (14:48F9): a win after the expert level is cleared: a record at 9999 goes to the
// retry prompt; else the record saved and his two lines (Text_6e_212 set twice, the score pushed between)
export function* machineExpertCounterMaxScene(P) {
  if (sub16(readMachineRecord(P), RECORD_MAX).f & FZ) return yield* machineExpertRetryPrompt(P);
  yield* saveMachineExpertRecord(P);
  yield* setText(P, Text_6e_212);
  pushTextNumber(P, score(P));
  yield* setText(P, Text_6e_212);
  yield* machineCourtWalkToAttendantCutscene(P);
  yield* speak(P, ATTENDANT);
  yield* speak(P, ATTENDANT);
  followPlayer(P, ACTOR_PARTNER);
}
// Unused_14_CompareMinigameScoreToRecord (14:4951): hl = the score - the record (a = h, f of the `sbc`), bc = the
// score, de = the record
export function unusedCompareMinigameScoreToRecord(P) {
  const bc = score(P), de = withWram(P, WRAM_SOUND, () => P.V.minigameRecordValue);
  return { ...sub16(bc, de), bc, de };
}
// SaveMachineExpertRecord (14:4974): the score as the machine record (UpdateMinigameRecord 03:5072, a = 1), then
// the machine court's progress (ComputeMachineCourtProgress 14:43A4)
export function* saveMachineExpertRecord(P) {
  withWram(P, WRAM_SOUND, () => {
    P.V.minigameRecordValue = score(P);
    P.callRom(BANK_SAVE_RECORDS, UpdateMinigameRecord, { a: MINIGAME_RECORD_MACHINE });
  });
  yield* P.runRom(BANK, ComputeMachineCourtProgress);
}
// MachineCourtWalkToAttendantCutscene (14:4997): the player out of the machine court to the attendant
export function* machineCourtWalkToAttendantCutscene(P) {
  moveTarget(P, ACTOR_PLAYER, 51.0, 54.0);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* movePlayer(P, 47.0, 45.0);
  moveTarget(P, ACTOR_PLAYER, 51.0, 43.0);
  yield* waitMove(P, ACTOR_PLAYER);
  moveTarget(P, ACTOR_PLAYER, 42.5, 43.0);
  yield* waitMove(P, ACTOR_PLAYER);
  moveTarget(P, ATTENDANT, 45.0, 43.0);
  yield* waitMove(P, ATTENDANT);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  moveTarget(P, ACTOR_PLAYER, 43.0, 43.0);
  yield* waitMove(P, ACTOR_PLAYER);
  face(P, ATTENDANT, FACE_LEFT);
}
// TennisMachineRoomNoEntryScene (14:4A00): during a practice session, the attendant and the partner at their
// places
export function* tennisMachineRoomNoEntryScene(P) {
  if (!testFlag(P, FLAG_PRACTICE_ROOM_SESSION_ACTIVE)) return;
  setFlag(P, FLAG_TEMP_SCENE_VARIANT_B);
  setPosition(P, ATTENDANT, 45.0, 41.0);
  face(P, ATTENDANT, FACE_DOWN);
  nullScript(P, ACTOR_PARTNER);
  yield* wait(P, 1);
  setPosition(P, ACTOR_PARTNER, 41.0, 43.0);
  face(P, ACTOR_PARTNER, FACE_RIGHT);
}

// ---- Court 2 ----
// Court2Npc03_14 (14:4B61)
export function* court2Npc03(P) {
  yield* setText(P, Text_1f_145);
  yield* speak(P, ACTOR_COURT2_WALK_6F_07_1);
}
// Court2Npc04_14 (14:4B6D) / Court2Npc05_14 (14:4B92) / Court2Npc06_14 (14:4BB7): a line by the stage
function* stageLine(P, table, actor) {
  yield* setText(P, tableWord(P, table, P.V.mapSceneStage));
  yield* speak(P, actor);
}
export const court2Npc04 = P => stageLine(P, Court2Npc04TextIds, ACTOR_COURT2_WALK_6F_07_2);
export const court2Npc05 = P => stageLine(P, Court2Npc05TextIds, ACTOR_COURT2_WALK_71_03);
export const court2Npc06 = P => stageLine(P, Court2Npc06TextIds, ACTOR_ROLE_COURT2_SPECTATOR);

// a balloon over a spectator for a moment: placed at (x, 33.5) with its sound; 63, 63 hides it
const balloon = (P, actor, x) => setPosition(P, actor, x, 33.5);
const hide = (P, actor) => setPosition(P, actor, 63.0, 63.0);
// Court2SpectatorChat_14 (14:4BDC): the two spectators' talk by the stage, once per format (then
// Court2SpectatorsRepeatChat): their balloons, nods and bounces
export function* court2SpectatorChat(P) {
  const A = ACTOR_COURT2_WALK_72_02_3, B = ACTOR_COURT2_WALK_72_03_1;
  const talked = testFlag(P, FLAG_DOUBLES) ? FLAG_COURT2_SPECTATORS_TALKED_DOUBLES : FLAG_COURT2_SPECTATORS_TALKED_SINGLES;
  if (testFlag(P, talked)) return yield* court2SpectatorsRepeatChat(P);
  setFlag(P, talked);
  yield* setText(P, tableWord(P, Court2SpectatorChatTextIds, P.V.mapSceneStage));   // .step
  yield* gesture(P, A, ANIM_SHAKE);
  yield* speak(P, A);
  balloon(P, ACTOR_COURT2_BALLOON_EXCLAIM, 12.5);
  sound(P, SFX_CHIME);
  yield* wait(P, 20);
  yield* speak(P, B);
  hide(P, ACTOR_COURT2_BALLOON_EXCLAIM);
  yield* gesture(P, A, ANIM_NOD);
  yield* speak(P, A);
  yield* gesture(P, B, ANIM_BOUNCE);
  yield* speak(P, B);
  faceToward(P, ACTOR_PLAYER, A);
  yield* wait(P, 20);
  balloon(P, ACTOR_COURT2_BALLOON_EXCLAIM, 10.5);
  sound(P, SFX_CHIME);
  yield* gesture(P, A, ANIM_BOUNCE);
  hide(P, ACTOR_COURT2_BALLOON_EXCLAIM);
  yield* wait(P, 10);
  balloon(P, ACTOR_COURT2_BALLOON_SWEAT, 10.5);
  sound(P, SFX_APPEAR2);
  yield* wait(P, 20);
  yield* speak(P, A);
  hide(P, ACTOR_COURT2_BALLOON_SWEAT);
  balloon(P, ACTOR_COURT2_BALLOON_QUESTION, 12.5);
  sound(P, SFX_EMOTE);
  yield* wait(P, 60);
  hide(P, ACTOR_COURT2_BALLOON_QUESTION);
  faceToward(P, ACTOR_PLAYER, B);
  yield* wait(P, 20);
  balloon(P, ACTOR_COURT2_BALLOON_EXCLAIM, 12.5);
  sound(P, SFX_CHIME);
  yield* gesture(P, B, ANIM_BOUNCE);
  hide(P, ACTOR_COURT2_BALLOON_EXCLAIM);
  yield* wait(P, 10);
  balloon(P, ACTOR_COURT2_BALLOON_SWEAT, 12.5);
  sound(P, SFX_APPEAR2);
  yield* wait(P, 20);
  yield* speak(P, B);
  hide(P, ACTOR_COURT2_BALLOON_SWEAT);
  yield* nodTogether(P, A, B);
}
// both nod, twice (the wait on the second)
function* nodTogether(P, A, B) {
  for (let i = 0; i < 2; i++) {
    setAnim(P, A, ANIM_NOD);
    setAnim(P, B, ANIM_NOD);
    yield* waitIdle(P, B);
  }
}
// Court2SpectatorsRepeatChat (14:4D6D): their short talk after the first
export function* court2SpectatorsRepeatChat(P) {
  const A = ACTOR_COURT2_WALK_72_02_3, B = ACTOR_COURT2_WALK_72_03_1;
  yield* gesture(P, A, ANIM_BOUNCE);
  faceToward(P, ACTOR_PLAYER, A);
  yield* setText(P, Text_1f_111);
  yield* speak(P, A);
  yield* gesture(P, B, ANIM_BOUNCE);
  faceToward(P, ACTOR_PLAYER, B);
  yield* speak(P, B);
  yield* nodTogether(P, A, B);
}
// Court2Npc0A_14 (14:4DCC): his line, another one at the final
export function* court2Npc0A(P) {
  yield* setText(P, Text_1f_106);
  const final = testFlag(P, FLAG_DOUBLES) ? ISLANDOPENSTAGE_DOUBLES_FINAL : ISLANDOPENSTAGE_SINGLES_FINAL;
  if (P.V.mapSceneStage === final) yield* setText(P, Text_1f_113);
  yield* speak(P, ACTOR_COURT2_WALK_6F_05);             // .speak
}

// Court2InitScript_14 (14:4E56): the stage, the player's and partner's object defs, the walk in
export function* court2InitScript(P) {
  initCourt2SceneVariant(P);
  loadCourtPlayerPartnerObjDefs(P);
  yield* arrivalWalkLeft(P);
}
// InitCourt2SceneVariant (14:4E60): wMapSceneStage from the rounds won; at the final the court's other actors
// (Court2ActorsAlt_14) and the cutscene mode on. (Singles with no round won keeps round 1; doubles start at
// ISLANDOPENSTAGE_DOUBLES_ROUND1.)
export function initCourt2SceneVariant(P) {
  const { V } = P;
  V.mapSceneStage = ISLANDOPENSTAGE_SINGLES_ROUND1;
  const final = stage => {
    respawnActors(P, Court2ActorsAlt_14);
    beginCutscene(P);
    V.mapSceneStage = stage;
  };
  if (testFlag(P, FLAG_DOUBLES)) {                      // .doubles
    if (testFlag(P, FLAG_WON_ISLAND_OPEN_DOUBLES_SEMIFINAL)) final(ISLANDOPENSTAGE_DOUBLES_FINAL);
    else if (testFlag(P, FLAG_WON_ISLAND_OPEN_DOUBLES_ROUND_1)) V.mapSceneStage = ISLANDOPENSTAGE_DOUBLES_SEMIFINAL;
    else V.mapSceneStage = ISLANDOPENSTAGE_DOUBLES_ROUND1;
  } else if (testFlag(P, FLAG_WON_ISLAND_OPEN_SINGLES_SEMIFINAL)) final(ISLANDOPENSTAGE_SINGLES_FINAL);
  else if (testFlag(P, FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_2)) V.mapSceneStage = ISLANDOPENSTAGE_SINGLES_SEMIFINAL;
  else if (testFlag(P, FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_1)) V.mapSceneStage = ISLANDOPENSTAGE_SINGLES_ROUND2;
}

const nop = hook(() => {});
export const HOOKS = [
  [BANK, 0x4612, hookGen((P, cpu) => machinePracticeLevelPrompt(P, cpu.a))],
  scene(BANK, 0x4693, machineLevelNotClearedMessage),
  [BANK, 0x469F, hook((P, cpu) => testMachineLevelClearedFlag(P, cpu.a))],
  [BANK, 0x46AE, hook((P, cpu) => unusedSetMachineLevelClearedFlag(P, cpu.a))],
  scene(BANK, 0x46C5, machinePracticeResultScene),
  scene(BANK, 0x474E, machineCourtHandleRetryChoice),
  scene(BANK, 0x47CD, machineCourtRestartLevel),
  [BANK, 0x4813, hook(P => { unusedMachineRecordOverrideAndReturn(P); })],
  scene(BANK, 0x4842, machineExpertResultScene),
  scene(BANK, 0x48BE, machineExpertRetryPrompt),
  scene(BANK, 0x48D1, machineExpertNewRecordScene),
  scene(BANK, 0x48F9, machineExpertCounterMaxScene),
  [BANK, 0x4951, hook(P => unusedCompareMinigameScoreToRecord(P))],
  scene(BANK, 0x4974, saveMachineExpertRecord),
  scene(BANK, 0x4997, machineCourtWalkToAttendantCutscene),
  scene(BANK, 0x4A00, tennisMachineRoomNoEntryScene),
  scene(BANK, 0x4B61, court2Npc03),
  scene(BANK, 0x4B6D, court2Npc04),
  scene(BANK, 0x4B92, court2Npc05),
  scene(BANK, 0x4BB7, court2Npc06),
  scene(BANK, 0x4BDC, court2SpectatorChat),
  scene(BANK, 0x4D6D, court2SpectatorsRepeatChat),
  scene(BANK, 0x4DCC, court2Npc0A),
  [BANK, 0x4E4B, nop],                                                  // Court2Facing01_14
  [BANK, 0x4E55, nop],                                                  // Court2Tile01_14
  scene(BANK, 0x4E56, court2InitScript),
  [BANK, 0x4E60, hook(P => { initCourt2SceneVariant(P); })],
  scene(BANK, 0x4F66, arrivalWalkLeft),                                 // Court2EntryWalkIn
];
