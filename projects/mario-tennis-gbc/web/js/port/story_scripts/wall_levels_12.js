// The wall practice room's levels (bank $12, $49CD-$52F6): the master level relaunched or its record saved, the
// level results (a level cleared: its line, the record of level 3 set to 50; else the retry prompt by how the
// point ended), the walk back off the court, the level tiles' prompts (a level only once the one before it is
// cleared) and their drills, the room's init script (the scene tilemap, the level signs, back from a drill or
// re-entered), the level signs and the stage (the first level not cleared), the attendant's prompts and the drill
// launch. The text-id tables, the jump tables and the drill table are data.
// Port of src/story/wall_levels_12.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss2_wall*.mtrec (scripted: the wall practice room, its levels won and lost, the master
// level, the re-entries).
import {
  ACTOR_PARTNER, ACTOR_PLAYER, ANIM_BOUNCE, ANIM_NOD, FACE_DOWN, FACE_RIGHT, FACE_UP, FLAG_DOUBLES, askYesNo,
  advanceText, beginCutscene, clearFlag, copySceneRect, copySceneToVram, disableLCDSafely, enableLCD, endCutscene,
  face, facePair, fadeIn, fadeInAndWait, fadeOutAndWait, followPlayer, goToLocation, jumpTableTarget, moveTarget,
  movePlayer, nullScript, pushTextNumber, rd, scene, setAnim, setFlag, setPosition, setSpeed, setText, speak,
  testFlag, wait, waitIdle, waitMove, waitPlayerMove, withWram,
} from "./common.js";
import { tableText } from "./shared2.js";
import { runTrainingDrill } from "./coach_walks_15.js";
import { wallPracticeScoreRetryPrompt, wallPracticeMasterResultScript } from "./wall_room_12.js";

const BANK = 0x12;
const BANK_SAVE_RECORDS = 0x03, UpdateMinigameRecord = 0x5072, ReadMinigameRecord = 0x5015;
const WRAM_SOUND = 0x07;                                 // (the minigame records' bank)
const MINIGAME_RECORD_WALL = 0x00;                       // the records' a: the wall practice's
const ACTOR_WALL_PRACTICE_ROOM_WALK_72_06 = 0x07;        // the attendant
const NPC = ACTOR_WALL_PRACTICE_ROOM_WALK_72_06;
const FLAG_PRACTICE_ROOM_SESSION_ACTIVE = 0x7D, FLAG_TEMP_SCENE_VARIANT_A = 0xE0;
const FLAG_CLEARED_WALL_LEVEL_1 = 0xD6, FLAG_CLEARED_WALL_LEVEL_2 = 0xD7, FLAG_CLEARED_WALL_LEVEL_3 = 0xD8;
const FLAG_CLEARED_WALL_LEVEL_4 = 0xD9, FLAG_CLEARED_WALL_MASTER = 0xDB, FLAG_CLEARED_WALL_EXPERT = 0xDD;
const WALLPRACTICESTAGE_LEVEL1 = 0x00, WALLPRACTICESTAGE_LEVEL2 = 0x01, WALLPRACTICESTAGE_LEVEL3 = 0x02;
const WALLPRACTICESTAGE_LEVEL4 = 0x03, WALLPRACTICESTAGE_MASTER = 0x04, WALLPRACTICESTAGE_EXPERT = 0x05;
const WALLPRACTICESTAGE_COMPLETE = 0x06;
const MINIGAME_WALL_PRACTICE_1 = 0x16, MINIGAME_WALL_PRACTICE_HIGH_SCORE = 0x1B;
export const STORYLOC_WALL_PRACTICE_ROOM = 0x13;
const ENTRY_FROM_DRILL = 0x0A, ENTRY_REENTRY = 0x0B;     // back from a level's drill / from a retried one
export const POINTOUTCOME_BALL_HIT_PLAYER = 0x09;
const WINLOSE_WIN = 0x01;
const LEVEL3_RECORD = 50;                                // the record level 3 sets
const Text_31_131 = 0x0483, Text_35_246 = 0x14F6, Text_35_251 = 0x14FB, Text_35_252 = 0x14FC, Text_35_253 = 0x14FD;
const Text_35_254 = 0x14FE, Text_35_255 = 0x14FF, Text_35_264 = 0x1508, Text_36_48 = 0x1830, Text_36_49 = 0x1831;
const Text_36_50 = 0x1832, Text_36_51 = 0x1833, Text_36_52 = 0x1834, Text_36_53 = 0x1835;
// data of this bank (read from the ROM)
const WallPracticeLevelResults = 0x4AC8;                 // WallPracticeLevelResultScript's jump table
const WallPracticeLevelResultScriptTextIds = 0x4B9C, WallPracticeRoomNpc07TextIds = 0x5271;
const WallPracticeRoomNpc07TextIds2 = 0x527F, LaunchWallPracticeMinigameTable = 0x52B9;

const stage = P => P.V.mapSceneStage;
// push_wram_bank WRAM_SOUND / ... a = 0 / farcall ReadMinigameRecord / UpdateMinigameRecord / pop_wram_bank
export function readWallRecord(P) {
  return withWram(P, WRAM_SOUND, () => {
    P.callRom(BANK_SAVE_RECORDS, ReadMinigameRecord, { a: MINIGAME_RECORD_WALL });
    return P.V.minigameRecordValue;
  });
}
export function updateWallRecord(P, value) {
  withWram(P, WRAM_SOUND, () => {
    P.V.minigameRecordValue = value;
    P.callRom(BANK_SAVE_RECORDS, UpdateMinigameRecord, { a: MINIGAME_RECORD_WALL });
  });
}
// the retry line by how the point ended: hit by the ball, else the outcome's low 2 bits through a text table
export function* outcomeText(P, ballHitText, table) {
  const outcome = P.V.pointOutcome;
  yield* setText(P, outcome === POINTOUTCOME_BALL_HIT_PLAYER ? ballHitText : tableText(P, BANK, table, outcome & 0x03));
}
// the player walks off the court at walking speed, to (5, 57); the attendant back to (5, 55), facing down
export function* walkBackFromCourt(P) {
  setSpeed(P, ACTOR_PLAYER, 1.0);
  moveTarget(P, ACTOR_PLAYER, 5.0, 49.0);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* movePlayer(P, 5.0, 55.0);
  moveTarget(P, ACTOR_PLAYER, 5.0, 57.0);
  yield* waitMove(P, ACTOR_PLAYER);
  moveTarget(P, NPC, 5.0, 55.0);
  yield* waitMove(P, NPC);
  face(P, NPC, FACE_DOWN);
}
// in doubles: the pair turn to each other and nod, the partner follows the player again (waits before and after)
function* partnerNodsAndFollows(P, before, after) {
  if (!testFlag(P, FLAG_DOUBLES)) return false;
  yield* wait(P, before);
  facePair(P, ACTOR_PARTNER, ACTOR_PLAYER);
  yield* wait(P, 30);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  setAnim(P, ACTOR_PARTNER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PARTNER);
  followPlayer(P, ACTOR_PARTNER);
  yield* wait(P, after);
  return true;
}
// a drill: a fade out, back to the room at the entry after it, RunTrainingDrillByID
function* startDrill(P, entry, drill) {
  yield* fadeOutAndWait(P, 4);
  goToLocation(P, STORYLOC_WALL_PRACTICE_ROOM, entry);
  yield* runTrainingDrill(P, drill);
}

// RelaunchWallPracticeMasterLevel (12:49CD): the high-score level again, back at entry $0A
export function* relaunchWallPracticeMasterLevel(P) {
  goToLocation(P, STORYLOC_WALL_PRACTICE_ROOM, ENTRY_FROM_DRILL);
  yield* runTrainingDrill(P, MINIGAME_WALL_PRACTICE_HIGH_SCORE);
}
// RelaunchWallPracticeMasterLevel.carry (12:49E5): the score saved as the record; the walk back, the attendant
// bounces and speaks; then .checkDoubles
export function* saveWallRecordAndWalkBack(P) {
  updateWallRecord(P, P.V.minigamesCurrentScore);
  yield* walkBackFromCourt(P);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* wait(P, 50);
  setAnim(P, NPC, ANIM_BOUNCE);
  yield* waitIdle(P, NPC);
  yield* speak(P, NPC);
  yield* wallMasterPartnerFollows(P);
}
// RelaunchWallPracticeMasterLevel.checkDoubles (12:4A6C): in doubles the partner nods and follows
export function* wallMasterPartnerFollows(P) { yield* partnerNodsAndFollows(P, 40, 40); }

// WallPracticeLevelResultScript (12:4AB5): no location name; a level won: its line by the stage (rst $00 on the
// stage - 1: levels 4, 3, 2 and 1 of the table, i.e. stages 1-4); lost: the master level's retry prompt, else a
// fade in and the retry line by the outcome: yes, the drill again; no, the exit
export function* wallPracticeLevelResultScript(P) {
  P.V.storyModeShowLocationName = 0;
  if (P.V.pointWinLoseFlag === WINLOSE_WIN) {
    const target = jumpTableTarget(P, BANK, WallPracticeLevelResults, (stage(P) - 1) & 0xFF);
    if (LEVEL_RESULTS[target]) return yield* LEVEL_RESULTS[target](P);
    return yield* P.runRom(BANK, target);
  }
  if (stage(P) === WALLPRACTICESTAGE_MASTER) return yield* wallPracticeScoreRetryPrompt(P);   // .checkLevel
  yield* fadeInAndWait(P, 6);
  yield* outcomeText(P, Text_35_246, WallPracticeLevelResultScriptTextIds);
  yield* retryOrExit(P);                                 // .speak
}
// the attendant's retry prompt (text set): no, the exit; yes, he turns up and bounces, the drill again
export function* retryOrExit(P) {
  if ((yield* askYesNo(P, NPC)) !== 0) return yield* wallPracticeExitCourtScript(P);
  face(P, NPC, FACE_UP);
  setAnim(P, NPC, ANIM_BOUNCE);
  yield* waitIdle(P, NPC);
  yield* launchWallPracticeMinigame(P);
}
// WallPracticeExitCourtScript (12:4B2E): the attendant's line, the walk back, the partner following again
export function* wallPracticeExitCourtScript(P) {
  yield* setText(P, Text_35_251);
  yield* speak(P, NPC);
  yield* walkBackFromCourt(P);
  if (testFlag(P, FLAG_DOUBLES)) followPlayer(P, ACTOR_PARTNER);
  yield* wait(P, 10);                                    // .done
}
// WallPracticeLevelResultScript.variant1-4 (12:4BA2 / 4BB2 / 4BDE / 4BEE): the level's line (variant 2, level 3:
// the record set to 50), a fade in, then .speakAndLeave
function levelResult(text, record) {
  return function* (P) {
    if (record !== undefined) updateWallRecord(P, record);
    yield* setText(P, text);
    yield* fadeInAndWait(P, 6);
    yield* wallLevelSpeakAndLeave(P);
  };
}
const LEVEL_RESULTS = {
  0x4BA2: levelResult(Text_35_255), 0x4BB2: levelResult(Text_35_254, LEVEL3_RECORD),
  0x4BDE: levelResult(Text_35_253), 0x4BEE: levelResult(Text_35_252),
};
// WallPracticeLevelResultScript.speakAndLeave (12:4BFC): the attendant bounces and speaks; the walk back; in
// doubles the pair nod and the partner follows; .wait
function* wallLevelSpeakAndLeave(P) {
  setAnim(P, NPC, ANIM_BOUNCE);
  yield* waitIdle(P, NPC);
  yield* speak(P, NPC);
  yield* walkBackFromCourt(P);
  yield* partnerNodsAndFollows(P, 30, 20);
  yield* wait(P, 10);
}

// WallPracticeRoomFacing01_12 (12:4CA9): (a cutscene) a slow fade in, the player's line
export function* wallPracticeRoomFacing01(P) {
  beginCutscene(P);
  fadeIn(P, 16);
  yield* setText(P, Text_31_131);
  yield* speak(P, ACTOR_PLAYER);
  endCutscene(P);
}
// WallPracticeRoomTile02_12 (12:4CE9): stepping off the court: the player to (5, 57), the attendant back; the
// session over; the partner follows again
export function* wallPracticeRoomTile02(P) {
  moveTarget(P, ACTOR_PLAYER, 5.0, 57.0);
  yield* waitMove(P, ACTOR_PLAYER);
  moveTarget(P, NPC, 5.0, 55.0);
  yield* waitMove(P, NPC);
  face(P, NPC, FACE_DOWN);
  clearFlag(P, FLAG_TEMP_SCENE_VARIANT_A);
  clearFlag(P, FLAG_PRACTICE_ROOM_SESSION_ACTIVE);
  if (testFlag(P, FLAG_DOUBLES)) followPlayer(P, ACTOR_PARTNER);
}
// WallPracticeRoomTile03_12 .. Tile06_12 (12:4D29 / 4D98 / 4E0D / 4E82): a level's tile (A pressed): locked
// unless the flag is set (none for level 1); the prompt; yes: the attendant turns and bounces, the player walks
// over the tile at (x, 49) to (12, 49), the level's drill (back at entry $0B), the cutscene ended
function levelTile(flag, text, x, drill) {
  return function* (P) {
    if (flag !== undefined && !testFlag(P, flag)) return yield* wallPracticeLevelLockedScript(P);
    yield* setText(P, text);
    if ((yield* askYesNo(P, NPC)) !== 0) return;
    face(P, NPC, FACE_UP);
    setAnim(P, NPC, ANIM_BOUNCE);
    setSpeed(P, ACTOR_PLAYER, 1.0);
    moveTarget(P, ACTOR_PLAYER, x, 49.0);
    yield* waitMove(P, ACTOR_PLAYER);
    moveTarget(P, ACTOR_PLAYER, 12.0, 49.0);
    yield* startDrill(P, ENTRY_REENTRY, drill);
    endCutscene(P);
  };
}
export const wallPracticeRoomTile03 = levelTile(undefined, Text_36_48, 3.0, MINIGAME_WALL_PRACTICE_1);
export const wallPracticeRoomTile04 = levelTile(FLAG_CLEARED_WALL_LEVEL_2, Text_36_49, 7.0, MINIGAME_WALL_PRACTICE_1 + 1);
export const wallPracticeRoomTile05 = levelTile(FLAG_CLEARED_WALL_LEVEL_3, Text_36_50, 17.0, MINIGAME_WALL_PRACTICE_1 + 2);
export const wallPracticeRoomTile06 = levelTile(FLAG_CLEARED_WALL_LEVEL_4, Text_36_51, 21.0, MINIGAME_WALL_PRACTICE_1 + 3);
// WallPracticeLevelLockedScript (12:4EF7)
export function* wallPracticeLevelLockedScript(P) {
  yield* setText(P, Text_36_52);
  yield* speak(P, NPC);
}

// the partner (no script) at (7, 57) facing up, in doubles
function placePartner(P) {
  if (!testFlag(P, FLAG_DOUBLES)) return;
  nullScript(P, ACTOR_PARTNER);
  setPosition(P, ACTOR_PARTNER, 7.0, 57.0);
  face(P, ACTOR_PARTNER, FACE_UP);
}
// the attendant by the court at (3, 55), facing right
function placeAttendant(P) {
  setPosition(P, NPC, 3.0, 55.0);
  face(P, NPC, FACE_RIGHT);
}
// WallPracticeRoomInitScript_12 (12:4F03): the player standing; the scroll limits and the size (24 x 60 tiles from
// (0, $27)), the scene drawn with the LCD off, the level signs; entry $0A: back from a drill (left: the exit; the
// expert and complete stages the master result, else the level result); entry $0B: back from a retried drill
// (won: another go?; else the retry line); else the session's actors put back
export function* wallPracticeRoomInitScript(P) {
  const { V } = P;
  yield* waitPlayerMove(P);
  V.mapScrollMinX = 0x00; V.mapScrollMinY = 0x27;
  V.mapWidthTiles = 0x18; V.mapHeightTiles = 0x3C;
  disableLCDSafely(P);
  copySceneToVram(P, 0x00);
  enableLCD(P);
  yield* setupWallPracticeLevelSigns(P);
  if (V.storyModeEntryPoint === ENTRY_FROM_DRILL) {       // .fromMatch
    placePartner(P);
    placeAttendant(P);                                    // .placeNpc
    if (V.matchExitRequest === 0x01) {
      yield* fadeInAndWait(P, 6);
      V.storyModeShowLocationName = 0;
      return yield* wallPracticeExitCourtScript(P);
    }
    if (stage(P) >= WALLPRACTICESTAGE_EXPERT) return yield* wallPracticeMasterResultScript(P);   // .showResult
    return yield* wallPracticeLevelResultScript(P);
  }
  if (V.storyModeEntryPoint !== ENTRY_REENTRY) return restoreWallPracticeRoomActors(P);
  placePartner(P);                                        // .reentry
  setFlag(P, FLAG_TEMP_SCENE_VARIANT_A);                  // .reentryPlaceNpc
  placeAttendant(P);
  yield* fadeInAndWait(P, 6);
  V.storyModeShowLocationName = 0;
  if (V.matchExitRequest === 0x01) return;
  if (V.pointWinLoseFlag === WINLOSE_WIN) yield* setText(P, Text_36_53);
  else yield* outcomeText(P, Text_35_246, WallPracticeLevelResultScriptTextIds);   // .checkSession
  if ((yield* askYesNo(P, NPC)) !== 0) return;
  face(P, NPC, FACE_UP);                                  // .placeActors
  setAnim(P, NPC, ANIM_BOUNCE);
  yield* waitIdle(P, NPC);
  yield* startDrill(P, ENTRY_REENTRY, rd(P, "currentMinigameStoryMatch", 1));
}

// SetupWallPracticeLevelSigns (12:505F): each level cleared turns its sign (a 2 x 2 from the scene's column 30
// to the sign at row 44); the stage is the first level not cleared (then the master, the expert, complete)
const SIGNS = [
  [FLAG_CLEARED_WALL_LEVEL_1, 44, 2], [FLAG_CLEARED_WALL_LEVEL_2, 48, 6], [FLAG_CLEARED_WALL_LEVEL_3, 52, 16],
  [FLAG_CLEARED_WALL_LEVEL_4, 56, 20],
];
export function* setupWallPracticeLevelSigns(P) {
  const stages = [WALLPRACTICESTAGE_LEVEL1, WALLPRACTICESTAGE_LEVEL2, WALLPRACTICESTAGE_LEVEL3, WALLPRACTICESTAGE_LEVEL4];
  let a = WALLPRACTICESTAGE_COMPLETE;
  find: {
    for (let i = 0; i < SIGNS.length; i++) {
      const [flag, row, col] = SIGNS[i];
      if (!testFlag(P, flag)) { a = stages[i]; break find; }
      yield* copySceneRect(P, 30, row, col, 44, 2, 2);
    }
    if (!testFlag(P, FLAG_CLEARED_WALL_MASTER)) a = WALLPRACTICESTAGE_MASTER;
    else if (!testFlag(P, FLAG_CLEARED_WALL_EXPERT)) a = WALLPRACTICESTAGE_EXPERT;
  }
  P.V.mapSceneStage = a;                                 // .step
}

// WallPracticeRoomNpc07_12 (12:50CC): the attendant: during a session his short line; else the stage's line (the
// expert stage's with the record), "want a go?": yes (the ROM's .doublesDeclined): he nods and steps aside, the
// partner waits by the court (the pair nod), the player walks onto the court and the stage's drill; no: the
// stage's second question: no, its other line; yes (from level 2 on) he steps aside, the partner waits, the player
// walks to (5, 53) and the session starts (from level 1: just his line)
export function* wallPracticeRoomNpc07(P) {
  if (testFlag(P, FLAG_TEMP_SCENE_VARIANT_A)) {
    yield* setText(P, Text_35_264);
    return yield* speak(P, NPC);
  }
  yield* setText(P, tableText(P, BANK, WallPracticeRoomNpc07TextIds, stage(P)));   // .scoreLine
  if (stage(P) === WALLPRACTICESTAGE_EXPERT) pushTextNumber(P, readWallRecord(P));
  if ((yield* askYesNo(P, NPC)) === 0) return yield* npc07StartDrill(P);          // .prompt
  yield* setText(P, tableText(P, BANK, WallPracticeRoomNpc07TextIds2, stage(P)));
  if ((yield* askYesNo(P, NPC)) !== 0) {
    advanceText(P);                                      // .declined
    return yield* speak(P, NPC);
  }
  if (stage(P) === 0) return yield* speak(P, NPC);       // .speakDeclined
  moveTarget(P, NPC, 3.0, 55.0);
  yield* waitMove(P, NPC);
  face(P, NPC, FACE_RIGHT);
  yield* speak(P, NPC);
  if (testFlag(P, FLAG_DOUBLES)) {
    nullScript(P, ACTOR_PARTNER);
    moveTarget(P, ACTOR_PARTNER, 7.0, 57.0);
    yield* waitMove(P, ACTOR_PARTNER);
    face(P, ACTOR_PARTNER, FACE_UP);
  }
  setSpeed(P, ACTOR_PLAYER, 1.0);                         // .walkToCourt
  moveTarget(P, ACTOR_PLAYER, 5.0, 53.0);
  yield* waitMove(P, ACTOR_PLAYER);
  setFlag(P, FLAG_TEMP_SCENE_VARIANT_A);
  setFlag(P, FLAG_PRACTICE_ROOM_SESSION_ACTIVE);
}
// WallPracticeRoomNpc07_12.doublesDeclined (12:51BA)
function* npc07StartDrill(P) {
  setAnim(P, NPC, ANIM_NOD);
  yield* waitIdle(P, NPC);
  yield* speak(P, NPC);
  moveTarget(P, NPC, 3.0, 55.0);
  yield* waitMove(P, NPC);
  face(P, NPC, FACE_RIGHT);
  if (testFlag(P, FLAG_DOUBLES)) {
    yield* wait(P, 20);
    nullScript(P, ACTOR_PARTNER);
    moveTarget(P, ACTOR_PARTNER, 7.0, 57.0);
    yield* waitMove(P, ACTOR_PARTNER);
    facePair(P, ACTOR_PARTNER, ACTOR_PLAYER);
    yield* wait(P, 30);
    setAnim(P, ACTOR_PLAYER, ANIM_NOD);
    setAnim(P, ACTOR_PARTNER, ANIM_NOD);
    yield* waitIdle(P, ACTOR_PARTNER);
    yield* wait(P, 20);
  }
  setSpeed(P, ACTOR_PLAYER, 1.0);                         // .done
  moveTarget(P, ACTOR_PLAYER, 5.0, 55.0);
  yield* waitMove(P, ACTOR_PLAYER);
  moveTarget(P, ACTOR_PLAYER, 5.0, 49.0);
  yield* waitMove(P, ACTOR_PLAYER);
  face(P, NPC, FACE_UP);
  setAnim(P, NPC, ANIM_BOUNCE);
  moveTarget(P, ACTOR_PLAYER, 12.0, 49.0);
  yield* launchWallPracticeMinigame(P);
}
// LaunchWallPracticeMinigame (12:528D): the stage's drill (LaunchWallPracticeMinigameTable), back at entry $0A;
// the cutscene ended
export function* launchWallPracticeMinigame(P) {
  yield* startDrill(P, ENTRY_FROM_DRILL, P.rom.u8(BANK, (LaunchWallPracticeMinigameTable + stage(P)) & 0xFFFF));
  endCutscene(P);
}
// RestoreWallPracticeRoomActors (12:52C0): during a session: the attendant by the court, the partner waiting
export function restoreWallPracticeRoomActors(P) {
  if (!testFlag(P, FLAG_PRACTICE_ROOM_SESSION_ACTIVE)) return;
  setFlag(P, FLAG_TEMP_SCENE_VARIANT_A);
  placeAttendant(P);
  placePartner(P);
}

export const HOOKS = [
  scene(BANK, 0x49CD, relaunchWallPracticeMasterLevel),
  scene(BANK, 0x4AB5, wallPracticeLevelResultScript),
  scene(BANK, 0x4B2E, wallPracticeExitCourtScript),
  scene(BANK, 0x4CA9, wallPracticeRoomFacing01),
  scene(BANK, 0x4CE9, wallPracticeRoomTile02),
  scene(BANK, 0x4D29, wallPracticeRoomTile03),
  scene(BANK, 0x4D98, wallPracticeRoomTile04),
  scene(BANK, 0x4E0D, wallPracticeRoomTile05),
  scene(BANK, 0x4E82, wallPracticeRoomTile06),
  scene(BANK, 0x4EF7, wallPracticeLevelLockedScript),
  scene(BANK, 0x4F03, wallPracticeRoomInitScript),
  scene(BANK, 0x505F, setupWallPracticeLevelSigns),
  scene(BANK, 0x50CC, wallPracticeRoomNpc07),
  scene(BANK, 0x528D, launchWallPracticeMinigame),
  scene(BANK, 0x52C0, function* (P) { restoreWallPracticeRoomActors(P); }),
];
