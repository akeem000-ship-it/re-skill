// The dorm entrance and the wall practice room's people (bank $12, $4006-$49CC). The dorm entrance: its arrival
// walks, the walk in through the door (back to the dorm room), and the first night's scene (entry $0F): Emily
// shows the player around, the roommate (Kate, or Harry for a male partner) arrives, the yes/no reply, the story
// saved (the return point the dorm room's entry $0F) and the fade to the dorm room. The wall practice room: the
// partner placed on arrival, the NPCs' lines by the stage (one with a yes/no), and the master level's results (the
// retry prompt by how the point ended, a new record saved, the maximum score). The map trees, actor and entry
// lists, the exit triggers, the map-script tables and the text-id tables are data.
// Port of src/story/wall_room_12.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are; DormEntranceArrival02_12 and DormEntranceArrival01_12
// are src/twins/academy_main_bldg_arrival02.asm and academy_main_bldg_arrival01.asm (twins.js).
// Recordings: out/port/ss2_dorm*.mtrec (scripted: the first night at the dorm entrance, both replies),
// out/port/ss2_wall*.mtrec (scripted: the wall practice room).
import {
  ACTOR_PARTNER, ACTOR_PLAYER, ANIM_BOUNCE, ANIM_NOD, ANIM_SHAKE, ANIM_WALK, FACE_DOWN, FACE_UP, FLAG_DOUBLES,
  advanceText, askYesNo, clearFlag, closeDialogue, face, facePair, faceToward, fadeIn, fadeInAndWait, fadeOut,
  fadeOutAndWait, jumpTableTarget, jumpVelocity, moveTarget, movePlayer, playerSpeed, pushTextNumber, requestExit,
  saveReturnPoint, scene, setActive, setAnim, setObjdef, setPosition, setSpeed, setText, sound, speak, speakRestore,
  testFlag, wait, waitFadeEnd, waitIdle, waitJump, waitMove, waitPlayerMove, withWram, yesNo,
} from "./common.js";
import { arrivalWalkUp, arrivalWalkDown } from "./twins.js";
import { tableText } from "./shared2.js";
import {
  outcomeText, readWallRecord, updateWallRecord, retryOrExit,
  setupWallPracticeLevelSigns, relaunchWallPracticeMasterLevel, saveWallRecordAndWalkBack, walkBackFromCourt,
  wallMasterPartnerFollows, wallPracticeExitCourtScript, launchWallPracticeMinigame,
} from "./wall_levels_12.js";

const BANK = 0x12;
const BANK_SAVE = 0x03, SaveStorySlotWithTimer = 0x4D10, EraseStorySlotSaveData = 0x4E13;
const BANK_SAVE_RECORDS = 0x03, ReadMinigameRecord = 0x5015;
const WRAM_SOUND = 0x07;
const ACTOR_DORM_ENTRANCE_EMILY = 0x03, ACTOR_DORM_ENTRANCE_KATE = 0x04;
const ACTOR_DORM_ENTRANCE_BALLOON_EXCLAIM = 0x05, ACTOR_DORM_ENTRANCE_BALLOON_QUESTION = 0x06;
const EMILY = ACTOR_DORM_ENTRANCE_EMILY, KATE = ACTOR_DORM_ENTRANCE_KATE;
const BALLOON_EXCLAIM = ACTOR_DORM_ENTRANCE_BALLOON_EXCLAIM, BALLOON_QUESTION = ACTOR_DORM_ENTRANCE_BALLOON_QUESTION;
const ACTOR_WALL_PRACTICE_ROOM_WALK_72_02 = 0x03, ACTOR_WALL_PRACTICE_ROOM_WALK_71_05 = 0x04;
const ACTOR_WALL_PRACTICE_ROOM_WALK_71_03 = 0x05, ACTOR_WALL_PRACTICE_ROOM_WALK_72_07 = 0x06;
const ACTOR_WALL_PRACTICE_ROOM_WALK_72_06 = 0x07, NPC = ACTOR_WALL_PRACTICE_ROOM_WALK_72_06;   // the attendant
const OBJ_HARRY = 0x28;
const BGM_NONE = 0x00, SFX_CHIME = 0x97, SFX_EMOTE = 0x98;
const FLAG_PRACTICE_ROOM_SESSION_ACTIVE = 0x7D, FLAG_CLEARED_WALL_EXPERT = 0xDD;
const STORYENTRY_NONE = 0xFF, STORYLOC_DORM_ROOM = 0x0A, ENTRY_FIRST_NIGHT = 0x0F;
const DORM_ROOM_EXIT = 0x01;                             // the exit trigger through the door
const WALLPRACTICESTAGE_MASTER = 0x04, WINLOSE_WIN = 0x01;
const RECORD_MAX = 9999;
const EXIT_FIRST_NIGHT = 0x0F;                           // the exit trigger to the dorm room's entry $0F
const Text_31_74 = 0x044A, Text_31_90 = 0x045A, Text_31_92 = 0x045C, Text_35_250 = 0x14FA;
const Text_36_40 = 0x1828, Text_36_41 = 0x1829, Text_36_43 = 0x182B;
// data of this bank (read from the ROM)
const WallPracticeRoomNpc03Speeches = 0x4735;            // WallPracticeRoomNpc03_12's jump table
const WallPracticeRoomNpc03TextIds = 0x4773, WallPracticeRoomNpc04TextIds = 0x4798;
const WallPracticeRoomNpc05TextIds = 0x47E5, WallPracticeRoomNpc06TextIds = 0x480A;
const WallPracticeScoreRetryPromptTextIds = 0x4AAF;
const NPC03_ALT_TEXT = 0x4743, NPC03_SPEAK = 0x475B, NPC03_DONE = 0x4761;   // its .altText / .speak / .done

const score = P => P.V.minigamesCurrentScore;
const stageText = (P, table) => setText(P, tableText(P, BANK, table, P.V.mapSceneStage));

// ---- the dorm entrance ----
// DormEntranceTile01_12 (12:411F): the door: the player (inactive) walks up into it at half speed, a fade out;
// through exit 1 (whatever the gender)
export function* dormEntranceTile01(P) {
  setActive(P, ACTOR_PLAYER, 0x00);
  moveTarget(P, ACTOR_PLAYER, 22.0, 9.0);
  yield* waitMove(P, ACTOR_PLAYER);
  playerSpeed(P, 0.5);
  yield* movePlayer(P, 22.0, 8.0);
  yield* wait(P, 15);
  fadeOut(P, 4);
  yield* waitPlayerMove(P);
  yield* waitFadeEnd(P);
  requestExit(P, DORM_ROOM_EXIT);
}
// DormEntranceInitScript_12 (12:4170): entry $0F, the first night
export function* dormEntranceInitScript(P) {
  if (P.V.storyModeEntryPoint === ENTRY_FIRST_NIGHT) yield* dormEntranceEntry0fScene(P);
}
// a balloon over (x, y) with its sound
function balloon(P, actor, x, y, sfx) {
  setPosition(P, actor, x, y);
  sound(P, sfx);
}
// DormEntranceEntry0fScene (12:4179): Emily walks the player up to the dorm; the player looks around, shakes,
// jumps; the roommate (Harry when the partner is male, with his text) comes down; the roommate's question (yes:
// his line, then the next; no: the next line first); more words; Emily leaves; the pair go in; the story saved
// with the dorm room's entry $0F as its return point (EraseStorySlotSaveData a = 1 between two saves), the music
// off, a fade out
export function* dormEntranceEntry0fScene(P) {
  setSpeed(P, EMILY, 0.5);
  setSpeed(P, KATE, 0.5);
  setSpeed(P, ACTOR_PLAYER, 0.5);
  playerSpeed(P, 0.5);
  setPosition(P, ACTOR_PLAYER, 22.0, 31.0);
  setPosition(P, EMILY, 22.0, 29.0);
  face(P, EMILY, FACE_UP);
  fadeIn(P, 32);
  yield* wait(P, 20);
  moveTarget(P, EMILY, 22.0, 17.0);
  yield* movePlayer(P, 22.0, 15.0);
  moveTarget(P, ACTOR_PLAYER, 22.0, 20.0);
  yield* waitMove(P, ACTOR_PLAYER);
  moveTarget(P, EMILY, 22.0, 17.0);
  moveTarget(P, ACTOR_PLAYER, 22.0, 19.0);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* wait(P, 20);
  yield* waitMove(P, EMILY);
  faceToward(P, ACTOR_PLAYER, EMILY);
  yield* setText(P, Text_31_74);
  yield* speak(P, EMILY);
  setAnim(P, EMILY, ANIM_NOD);
  yield* waitIdle(P, EMILY);
  yield* speak(P, EMILY);
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  playerSpeed(P, 0.75);
  for (const [x, frames] of [[22.0, 20], [17.0, 10], [26.0, 10], [22.0, 30]]) {
    yield* movePlayer(P, x, 11.0);
    yield* waitPlayerMove(P);
    yield* wait(P, frames);
  }
  yield* movePlayer(P, 22.0, 16.0);
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 20);
  playerSpeed(P, 0.5);
  balloon(P, BALLOON_EXCLAIM, 23.5, 15.0, SFX_CHIME);
  setAnim(P, EMILY, ANIM_BOUNCE);
  yield* waitIdle(P, EMILY);
  setPosition(P, BALLOON_EXCLAIM, 1.0, 1.0);
  yield* speak(P, EMILY);
  moveTarget(P, EMILY, 22.0, 11.0);
  yield* waitMove(P, EMILY);
  setPosition(P, KATE, 23.0, 11.0);
  yield* wait(P, 160);
  moveTarget(P, ACTOR_PLAYER, 22.0, 21.0);
  yield* waitMove(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  yield* wait(P, 20);
  setAnim(P, ACTOR_PLAYER, ANIM_SHAKE);
  yield* waitIdle(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* wait(P, 160);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  yield* wait(P, 20);
  setAnim(P, ACTOR_PLAYER, ANIM_SHAKE);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 20);
  setActive(P, EMILY, 0x00);
  setPosition(P, EMILY, 23.0, 25.0);
  yield* speak(P, EMILY);
  moveTarget(P, ACTOR_PLAYER, 22.5, 18.0);
  jumpVelocity(P, ACTOR_PLAYER, -2.0);
  yield* waitJump(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_UP);
  setActive(P, EMILY, 0x02);
  setPosition(P, EMILY, 21.0, 11.0);
  if (!P.V.storyModeGenderOfPartnerCharacter) {
    yield* setText(P, Text_31_92);
    setObjdef(P, OBJ_HARRY, KATE);
    setAnim(P, KATE, ANIM_WALK);
  }
  moveTarget(P, EMILY, 21.0, 15.0);                      // .doubles
  yield* waitMove(P, EMILY);
  moveTarget(P, KATE, 23.0, 15.0);
  yield* waitMove(P, KATE);
  balloon(P, BALLOON_QUESTION, 24.0, 17.0, SFX_EMOTE);
  yield* wait(P, 60);
  setAnim(P, EMILY, ANIM_SHAKE);
  yield* waitIdle(P, EMILY);
  setPosition(P, BALLOON_QUESTION, 1.0, 1.0);
  yield* speak(P, EMILY);
  faceToward(P, KATE, EMILY);
  yield* wait(P, 60);
  faceToward(P, ACTOR_PLAYER, EMILY);
  yield* speak(P, EMILY);
  setAnim(P, KATE, ANIM_NOD);
  yield* waitIdle(P, KATE);
  yield* speak(P, KATE);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 20);
  setAnim(P, EMILY, ANIM_NOD);
  yield* waitIdle(P, EMILY);
  yield* speak(P, EMILY);
  faceToward(P, EMILY, KATE);
  setAnim(P, KATE, ANIM_SHAKE);
  yield* waitIdle(P, KATE);
  yield* speak(P, KATE);
  faceToward(P, KATE, EMILY);
  yield* speak(P, EMILY);
  setAnim(P, KATE, ANIM_NOD);
  yield* waitIdle(P, KATE);
  faceToward(P, ACTOR_PLAYER, KATE);
  yield* speakRestore(P, KATE);
  faceToward(P, ACTOR_PLAYER, EMILY);
  const reply = yield* yesNo(P);
  yield* closeDialogue(P);
  yield* wait(P, 5);
  if (reply === 0) {
    yield* speak(P, KATE);
    advanceText(P);
  } else {                                               // .finish
    advanceText(P);
    yield* speak(P, KATE);
  }
  setAnim(P, EMILY, ANIM_NOD);                           // .done
  yield* waitIdle(P, EMILY);
  yield* speak(P, EMILY);
  setAnim(P, KATE, ANIM_NOD);
  yield* waitIdle(P, KATE);
  setAnim(P, EMILY, ANIM_BOUNCE);
  yield* waitIdle(P, EMILY);
  yield* speak(P, EMILY);
  balloon(P, BALLOON_QUESTION, 24.0, 17.0, SFX_EMOTE);
  yield* wait(P, 60);
  setPosition(P, BALLOON_QUESTION, 1.0, 1.0);
  setAnim(P, KATE, ANIM_NOD);
  yield* waitIdle(P, KATE);
  yield* speak(P, KATE);
  faceToward(P, KATE, EMILY);
  yield* wait(P, 30);
  faceToward(P, ACTOR_PLAYER, EMILY);
  yield* wait(P, 30);
  setAnim(P, EMILY, ANIM_NOD);
  yield* waitIdle(P, EMILY);
  yield* setText(P, Text_31_90);
  yield* speak(P, KATE);
  faceToward(P, EMILY, KATE);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  setAnim(P, KATE, ANIM_NOD);
  yield* waitIdle(P, KATE);
  yield* movePlayer(P, 22.0, 19.0);
  moveTarget(P, EMILY, 21.0, 19.0);
  yield* waitMove(P, EMILY);
  face(P, KATE, FACE_DOWN);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  moveTarget(P, EMILY, 21.0, 21.0);
  yield* waitMove(P, EMILY);
  face(P, EMILY, FACE_UP);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  yield* speak(P, KATE);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  setAnim(P, KATE, ANIM_NOD);
  yield* waitIdle(P, KATE);
  setAnim(P, EMILY, ANIM_NOD);
  yield* waitIdle(P, EMILY);
  face(P, EMILY, FACE_DOWN);
  yield* wait(P, 30);
  moveTarget(P, EMILY, 21.0, 31.0);
  yield* wait(P, 120);
  facePair(P, ACTOR_PLAYER, KATE);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  setAnim(P, KATE, ANIM_NOD);
  yield* waitIdle(P, KATE);
  yield* movePlayer(P, 21.0, 15.0);
  moveTarget(P, ACTOR_PLAYER, 21.0, 15.0);
  yield* waitMove(P, ACTOR_PLAYER);
  moveTarget(P, KATE, 23.0, 11.0);
  moveTarget(P, ACTOR_PLAYER, 21.0, 11.0);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* movePlayer(P, 22.0, 11.0);
  saveReturnPoint(P, STORYLOC_DORM_ROOM, ENTRY_FIRST_NIGHT);
  yield* P.runRom(BANK_SAVE, SaveStorySlotWithTimer);
  yield* P.runRom(BANK_SAVE, EraseStorySlotSaveData, { a: 0x01 });
  yield* P.runRom(BANK_SAVE, SaveStorySlotWithTimer);
  sound(P, BGM_NONE);
  yield* fadeOutAndWait(P, 4);
  requestExit(P, EXIT_FIRST_NIGHT);
}

// ---- the wall practice room ----
// WallPracticeRoomArrival01_12 (12:46F3): (with an entry point) the session over; in doubles the partner at
// (15, 59) facing up
export function wallPracticeRoomArrival01(P) {
  if (P.V.storyModeEntryPoint === STORYENTRY_NONE) return;
  clearFlag(P, FLAG_PRACTICE_ROOM_SESSION_ACTIVE);
  if (!testFlag(P, FLAG_DOUBLES)) return;
  setPosition(P, ACTOR_PARTNER, 15.0, 59.0);
  face(P, ACTOR_PARTNER, FACE_UP);
}
// WallPracticeRoomNpc03_12 (12:471F): the stage's line; at stages 0, 2 and 3 a yes/no (no: the next text);
// stages 4 and 5 a bounce first (rst $00 on the stage)
export function* wallPracticeRoomNpc03(P) {
  const A = ACTOR_WALL_PRACTICE_ROOM_WALK_72_02;
  yield* stageText(P, WallPracticeRoomNpc03TextIds);
  const target = jumpTableTarget(P, BANK, WallPracticeRoomNpc03Speeches, P.V.mapSceneStage);
  if (target === NPC03_ALT_TEXT) {
    if ((yield* askYesNo(P, A)) !== 0) advanceText(P);
  } else if (target === NPC03_DONE) {
    setAnim(P, A, ANIM_BOUNCE);
    yield* waitIdle(P, A);
  } else if (target !== NPC03_SPEAK) return yield* P.runRom(BANK, target);
  yield* speak(P, A);
}
// WallPracticeRoomNpc04_12 (12:4781) / WallPracticeRoomNpc06_12 (12:47F3): the stage's line
export function* wallPracticeRoomNpc04(P) {
  yield* stageText(P, WallPracticeRoomNpc04TextIds);
  yield* speak(P, ACTOR_WALL_PRACTICE_ROOM_WALK_71_05);
}
export function* wallPracticeRoomNpc06(P) {
  yield* stageText(P, WallPracticeRoomNpc06TextIds);
  yield* speak(P, ACTOR_WALL_PRACTICE_ROOM_WALK_72_07);
}
// WallPracticeRoomNpc05_12 (12:47A6): the stage's line; before the master level two of them, turned to the wall
// between (the player turned to him)
export function* wallPracticeRoomNpc05(P) {
  const A = ACTOR_WALL_PRACTICE_ROOM_WALK_71_03;
  yield* stageText(P, WallPracticeRoomNpc05TextIds);
  if (P.V.mapSceneStage >= WALLPRACTICESTAGE_MASTER) return yield* speak(P, A);
  face(P, A, FACE_UP);                                   // .face
  yield* speak(P, A);
  faceToward(P, ACTOR_PLAYER, A);
  yield* speak(P, A);
  face(P, A, FACE_UP);
}

// WallPracticeMasterResultScript (12:4841): a fade in, no location name; the expert level won (once cleared):
// the maximum-score script, else the retry prompt
export function* wallPracticeMasterResultScript(P) {
  yield* fadeInAndWait(P, 6);
  P.V.storyModeShowLocationName = 0;
  if (testFlag(P, FLAG_CLEARED_WALL_EXPERT) && P.V.pointWinLoseFlag === WINLOSE_WIN) return yield* wallPracticeMaxScoreScript(P);
  yield* wallPracticeScoreRetryPrompt(P);
}
// WallPracticeScoreRetryPrompt (12:485C): a fade in, no location name; a score above the record: the new record;
// else the line by how the point ended with the score, and the retry prompt
export function* wallPracticeScoreRetryPrompt(P) {
  yield* fadeInAndWait(P, 6);
  P.V.storyModeShowLocationName = 0;
  // (bc = the score across ReadMinigameRecord, then hl = bc; the record + 1 subtracted)
  const record = withWram(P, WRAM_SOUND, () => {
    P.callRom(BANK_SAVE_RECORDS, ReadMinigameRecord, { a: 0x00, bc: score(P) });
    return P.V.minigameRecordValue;
  });
  if (P.cpu.bc >= ((record + 1) & 0xFFFF)) return yield* wallPracticeNewRecordScript(P);
  yield* outcomeText(P, Text_35_250, WallPracticeScoreRetryPromptTextIds);
  pushTextNumber(P, score(P));                           // .pushTextArgNumber
  yield* retryOrExit(P);
}
// WallPracticeNewRecordScript (12:48EB): the score saved as the record, the signs and stage again; the record line
// with the score; yes: the drill again, no: the exit
export function* wallPracticeNewRecordScript(P) {
  updateWallRecord(P, score(P));
  yield* setupWallPracticeLevelSigns(P);
  yield* setText(P, Text_36_40);
  pushTextNumber(P, score(P));
  yield* retryOrExitNoBounce(P);
}
// (the retry prompt without the attendant's bounce)
function* retryOrExitNoBounce(P) {
  if ((yield* askYesNo(P, NPC)) !== 0) return yield* wallPracticeExitCourtScript(P);
  yield* launchWallPracticeMinigame(P);
}
// WallPracticeMaxScoreScript (12:4936): the attendant's line; a record under 9999: the score saved as the record
// and the walk back (RelaunchWallPracticeMasterLevel.carry); else another go? yes: the master level again; no:
// the walk back, the partner following (.checkDoubles)
export function* wallPracticeMaxScoreScript(P) {
  yield* setText(P, Text_36_41);
  yield* speak(P, NPC);
  if (readWallRecord(P) < RECORD_MAX) return yield* saveWallRecordAndWalkBack(P);
  yield* setText(P, Text_36_43);
  if ((yield* askYesNo(P, NPC)) === 0) return yield* relaunchWallPracticeMasterLevel(P);
  yield* walkBackFromCourt(P);
  yield* wallMasterPartnerFollows(P);
}

export const HOOKS = [
  scene(BANK, 0x406F, arrivalWalkDown),                  // DormEntranceArrival02_12
  scene(BANK, 0x40B5, arrivalWalkUp),                    // DormEntranceArrival01_12
  scene(BANK, 0x411F, dormEntranceTile01),
  scene(BANK, 0x4170, dormEntranceInitScript),
  scene(BANK, 0x4179, dormEntranceEntry0fScene),
  scene(BANK, 0x46F3, function* (P) { wallPracticeRoomArrival01(P); }),
  scene(BANK, 0x471F, wallPracticeRoomNpc03),
  scene(BANK, 0x4781, wallPracticeRoomNpc04),
  scene(BANK, 0x47A6, wallPracticeRoomNpc05),
  scene(BANK, 0x47F3, wallPracticeRoomNpc06),
  scene(BANK, 0x4841, wallPracticeMasterResultScript),
  scene(BANK, 0x485C, wallPracticeScoreRetryPrompt),
  scene(BANK, 0x48EB, wallPracticeNewRecordScript),
  scene(BANK, 0x4936, wallPracticeMaxScoreScript),
];
