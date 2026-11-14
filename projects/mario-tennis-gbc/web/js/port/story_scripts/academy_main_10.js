// The academy's main building (bank $10, $73EE-$7AC7) and helpers of the academy wing next to it: the wing's
// coach lines by format, its door triggers and trophies, its dialogue stage; the main building's NPCs (their
// lines by the story rank), its init script, the new student's cutscene, the arrival walks, and the frame task
// that hides the player and partner behind the scene's foreground tiles (UpdatePlayerPairTileAnimState_10).
// The location's tables (AcademyMainBldgMapScripts_10 ..., the NPCs' text-id tables) and ActorScript_10_0 are data.
// Port of src/story/academy_main_10.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are; the arrival walks are src/twins/academy_main_bldg_
// arrival01/02.asm (twins.js).
// Recordings: out/engine/rec2.mtrec (the main building, the tile frame task) and out/port/ss1_acmain*.mtrec.
import {
  ACTOR_PLAYER, FACE_DOWN, FACE_UP, FACE_RIGHT, ANIM_BOUNCE, ANIM_NOD, WRAM_ACTORS, BEHAVIOR_TRIGGER, FLAG_DOUBLES,
  testFlag, testFlagF, setText, advanceText, speak, speakRestore, askYesNo, setAnim, waitIdle, wait, face,
  faceToward, facePair, setPosition, moveTarget, waitMove, movePlayer, waitPlayerMove, setActorScript,
  writeBehaviorCell, beginCutscene, endCutscene, respawnActors, fadeIn, sound, registerFrameTask, requestExit, hook,
  scene, ACTORF_X, ACTORF_Y, wActors,
} from "./common.js";
import { arrivalWalkUp, arrivalWalkDown, readSceneTilemapTile } from "./twins.js";

const BANK = 0x10;
// actors of the academy wing's second list (AcademyWingInit1Actors_10, academy_wing_10.asm)
const ACTOR_ACADEMY_WING_INIT1_WALK_75_06 = 0x03, ACTOR_ACADEMY_WING_INIT1_TROPHY_1 = 0x04;
const ACTOR_ACADEMY_WING_INIT1_TROPHY_2 = 0x05;
// actors of the main building (AcademyMainBldgActors_10, AcademyMainBldgNewStudentActors_10)
const ACTOR_ACADEMY_MAIN_BLDG_WALK_72_08_1 = 0x03, ACTOR_ACADEMY_MAIN_BLDG_WALK_73_00 = 0x04;
const ACTOR_ACADEMY_MAIN_BLDG_WALK_72_08_2 = 0x05, ACTOR_ACADEMY_MAIN_BLDG_WALK_73_01 = 0x06;
const ACTOR_ACADEMY_MAIN_BLDG_NEW_STUDENT_EMILY = 0x03, ACTOR_ACADEMY_MAIN_BLDG_NEW_STUDENT_WALK_72_08 = 0x04, ACTOR_ACADEMY_MAIN_BLDG_NEW_STUDENT_BALLOON_QUESTION = 0x06;
const ANIM_TROPHY_SINGLES = 0x06;
const SFX_EMOTE = 0x98;
const ACADEMYWINGSTAGE_PRE_SENIOR_CHAMP = 0x00, ACADEMYWINGSTAGE_SENIOR_CHAMP = 0x01;
const ACADEMYWINGSTAGE_ISLAND_OPEN = 0x02, ACADEMYWINGSTAGE_COMPLETE = 0x03;
const STORYTIER_SENIOR_CHAMP = 0x02, STORYTIER_ISLAND_OPEN = 0x03;
const FLAG_WON_ISLAND_OPEN_DOUBLES_FINAL = 0x35, FLAG_WON_ISLAND_OPEN_SINGLES_FINAL = 0x3C;
const FLAG_WON_SENIOR_DOUBLES_RANK_1 = 0x46, FLAG_WON_SENIOR_SINGLES_RANK_1 = 0x57;
const FLAG_REACHED_ISLAND_OPEN_SINGLES = 0xAE, FLAG_REACHED_ISLAND_OPEN_DOUBLES = 0xAF;
const FLAG_STORY_COMPLETE_SINGLES = 0xB0, FLAG_STORY_COMPLETE_DOUBLES = 0xB1;
const Text_30_430 = 0x01AE, Text_30_462 = 0x01CE, Text_30_469 = 0x01D5;
// data of this bank (read from the ROM): the NPCs' text ids by story tier, the new student's actor list, scripts
const AcademyMainBldgNpc03TextIds = 0x7627, AcademyMainBldgNpc04TextIds = 0x764A, AcademyMainBldgNpc05TextIds = 0x7698;
const AcademyMainBldgNpc05TextIds2 = 0x76C7, AcademyMainBldgNpc06TextIds = 0x76EA;
const AcademyMainBldgNewStudentActors_10 = 0x7980, ActorScript_10_1 = 0x7B8B;
// routines of this bank not ported here (src/story/walks_10.asm)
const GetDoublesProgressStage_10 = 0x7BB6, SetStoryDialogueStage_10 = 0x7DBD;
export const UpdatePlayerPairTileAnimState_10 = 0x79D0;
const ACTORF_MODE = 0x20, ACTOR_MODE_DRAWN = 0x02;
const TILE_FOREGROUND = 0x06;                          // a scene tile's attribute low bits: drawn over the sprites
const YES = 0;

// the story tier of wMapSceneStage (`sra a`: the doubles bit shifted out)
const sra = v => ((v >> 1) | (v & 0x80)) & 0xFF;
const storyTier = P => sra(P.V.mapSceneStage);
// `add a / ld_hl_indexed table / ld a, [hl+] / ld h, [hl] / ld l, a`: a word of a table in this bank
const tableWord = (P, table, i) => P.rom.u16(BANK, (table + ((i * 2) & 0xFF)) & 0xFFFF);

// ---- the academy wing's helpers (academy_wing_10.asm calls them) ----
// SpeakNpc03SinglesOrDoublesLine_10 (10:73EE) / ShowNpc03SinglesOrDoublesPrompt_10 (10:7405): the wing coach's
// line of the format: of two messages, the first in singles (the second skipped after), the second in doubles
export function* speakNpc03SinglesOrDoublesLine(P) {
  if (testFlag(P, FLAG_DOUBLES)) { advanceText(P); yield* speak(P, ACTOR_ACADEMY_WING_INIT1_WALK_75_06); return; }
  yield* speak(P, ACTOR_ACADEMY_WING_INIT1_WALK_75_06);
  advanceText(P);
}
export function* showNpc03SinglesOrDoublesPrompt(P) {
  if (testFlag(P, FLAG_DOUBLES)) { advanceText(P); yield* speakRestore(P, ACTOR_ACADEMY_WING_INIT1_WALK_75_06); return; }
  yield* speakRestore(P, ACTOR_ACADEMY_WING_INIT1_WALK_75_06);
  advanceText(P);
}
// AcademyWingInstallDoorTriggers_10 (10:7429): once the story is complete, the wing's two doors become exits 1 and 2
export function academyWingInstallDoorTriggers(P) {
  if (P.V.mapSceneStage !== ACADEMYWINGSTAGE_COMPLETE) return;
  writeBehaviorCell(P, 32, 58, BEHAVIOR_TRIGGER | 1 << 4);
  writeBehaviorCell(P, 32, 54, BEHAVIOR_TRIGGER | 2 << 4);
}
// AcademyWingHideActorByProgressFlag_10 (10:7443): the trophy case: the singles trophy shown; the Island Open
// trophy of the format played put away until won
export function academyWingHideActorByProgressFlag(P) {
  setAnim(P, ACTOR_ACADEMY_WING_INIT1_TROPHY_1, ANIM_TROPHY_SINGLES);
  if (testFlag(P, FLAG_DOUBLES)) {
    if (!testFlag(P, FLAG_WON_ISLAND_OPEN_SINGLES_FINAL)) setPosition(P, ACTOR_ACADEMY_WING_INIT1_TROPHY_1, 1.0, 1.0);
  } else if (!testFlag(P, FLAG_WON_ISLAND_OPEN_DOUBLES_FINAL)) setPosition(P, ACTOR_ACADEMY_WING_INIT1_TROPHY_2, 1.0, 1.0);
}
// SetAcademyWingDialogueStage_10 (10:7472): wMapSceneStage = the wing's stage (ACADEMYWINGSTAGE_*): before the
// senior title, senior champion, at the Island Open, complete. Returns a and F of the last flag test.
export function setAcademyWingDialogueStage(P) {
  const doubles = testFlag(P, FLAG_DOUBLES);
  const steps = doubles ? [FLAG_WON_SENIOR_DOUBLES_RANK_1, FLAG_REACHED_ISLAND_OPEN_DOUBLES, FLAG_STORY_COMPLETE_DOUBLES]
    : [FLAG_WON_SENIOR_SINGLES_RANK_1, FLAG_REACHED_ISLAND_OPEN_SINGLES, FLAG_STORY_COMPLETE_SINGLES];
  let stage = ACADEMYWINGSTAGE_PRE_SENIOR_CHAMP, set = true;
  for (const flag of steps) {
    if (!(set = testFlag(P, flag))) break;
    stage++;
  }
  P.V.mapSceneStage = stage;
  return { a: stage, f: testFlagF(set) };
}

// ---- the main building ----
// AcademyMainBldgArrival02_10 (10:7532) / AcademyMainBldgArrival01_10 (10:7578): the arrival walks (twins.js)

// AcademyMainBldgNpc03_10 (10:75E7): the student's line of the tier; at the Island Open a yes/no question (no:
// the other answer)
export function* academyMainBldgNpc03(P) {
  yield* setText(P, tableWord(P, AcademyMainBldgNpc03TextIds, storyTier(P)));
  if (storyTier(P) !== STORYTIER_ISLAND_OPEN) { yield* speak(P, ACTOR_ACADEMY_MAIN_BLDG_WALK_72_08_1); return; }
  if ((yield* askYesNo(P, ACTOR_ACADEMY_MAIN_BLDG_WALK_72_08_1)) !== YES) advanceText(P);
  yield* speak(P, ACTOR_ACADEMY_MAIN_BLDG_WALK_72_08_1);
}
// AcademyMainBldgNpc04_10 (10:7631) / AcademyMainBldgNpc06_10 (10:76D1): a student's line of the tier
export function* academyMainBldgNpc04(P) {
  yield* setText(P, tableWord(P, AcademyMainBldgNpc04TextIds, storyTier(P)));
  yield* speak(P, ACTOR_ACADEMY_MAIN_BLDG_WALK_73_00);
}
export function* academyMainBldgNpc06(P) {
  yield* setText(P, tableWord(P, AcademyMainBldgNpc06TextIds, storyTier(P)));
  yield* speak(P, ACTOR_ACADEMY_MAIN_BLDG_WALK_73_01);
}
// AcademyMainBldgNpc05_10 (10:7654): the notice-board student: a line, then (facing down) the news of the tier, or
// in doubles another line and the news of the doubles progress (GetDoublesProgressStage_10); then he turns to the
// player for the last one (.loop)
export function* academyMainBldgNpc05(P) {
  yield* setText(P, Text_30_462);
  yield* speak(P, ACTOR_ACADEMY_MAIN_BLDG_WALK_72_08_2);
  face(P, ACTOR_ACADEMY_MAIN_BLDG_WALK_72_08_2, FACE_DOWN);
  if (testFlag(P, FLAG_DOUBLES)) {                                    // AcademyMainBldgNpc05_10.setText
    yield* setText(P, Text_30_469);
    yield* wait(P, 20);
    yield* speak(P, ACTOR_ACADEMY_MAIN_BLDG_WALK_72_08_2);
    const stage = P.callRom(BANK, GetDoublesProgressStage_10).a;
    yield* setText(P, tableWord(P, AcademyMainBldgNpc05TextIds2, stage));
  } else {
    yield* speak(P, ACTOR_ACADEMY_MAIN_BLDG_WALK_72_08_2);
    yield* setText(P, tableWord(P, AcademyMainBldgNpc05TextIds, storyTier(P)));
  }
  yield* wait(P, 20);                                                 // .loop
  faceToward(P, ACTOR_PLAYER, ACTOR_ACADEMY_MAIN_BLDG_WALK_72_08_2);
  yield* speak(P, ACTOR_ACADEMY_MAIN_BLDG_WALK_72_08_2);
}

// AcademyMainBldgInitScript_10 (10:7717): the dialogue stage (SetStoryDialogueStage_10); as senior champion the
// first student walks about (ActorScript_10_1); the foreground tiles' frame task; entry $0F: the new student.
export function* academyMainBldgInitScript(P) {
  P.callRom(BANK, SetStoryDialogueStage_10);
  if (storyTier(P) === STORYTIER_SENIOR_CHAMP) setActorScript(P, ACTOR_ACADEMY_MAIN_BLDG_WALK_72_08_1, ActorScript_10_1);
  registerFrameTask(P, 1, UpdatePlayerPairTileAnimState_10);
  if (P.V.storyModeEntryPoint === 0x0F) yield* academyMainBldgNewStudentCutscene(P);
}

// AcademyMainBldgNewStudentCutscene_10 (10:7741): the new student (Emily) arrives with a teacher, who introduces
// her to the player (a line by the player's gender); they walk up the hall together and the player leaves by
// exit $0F.
export function* academyMainBldgNewStudentCutscene(P) {
  const EMILY = ACTOR_ACADEMY_MAIN_BLDG_NEW_STUDENT_EMILY, TEACHER = ACTOR_ACADEMY_MAIN_BLDG_NEW_STUDENT_WALK_72_08;
  respawnActors(P, AcademyMainBldgNewStudentActors_10);
  beginCutscene(P);
  setPosition(P, ACTOR_PLAYER, 34.0, 37.5);
  setPosition(P, EMILY, 34.0, 36.0);
  fadeIn(P, 4);
  yield* wait(P, 30);
  face(P, EMILY, FACE_UP);
  yield* wait(P, 10);
  setAnim(P, TEACHER, ANIM_BOUNCE);
  yield* wait(P, 30);
  moveTarget(P, EMILY, 34.0, 23.0);
  yield* movePlayer(P, 34.0, 23.0);
  yield* wait(P, 10);
  moveTarget(P, ACTOR_PLAYER, 34.0, 25.0);
  face(P, TEACHER, FACE_RIGHT);
  yield* waitPlayerMove(P);
  yield* setText(P, Text_30_430);
  yield* speak(P, TEACHER);
  yield* waitMove(P, EMILY);
  yield* wait(P, 10);
  yield* movePlayer(P, 29.0, 25.0);
  faceToward(P, TEACHER, EMILY);
  yield* wait(P, 30);
  faceToward(P, TEACHER, ACTOR_PLAYER);
  yield* wait(P, 30);
  yield* waitPlayerMove(P);
  yield* animThenIdle(P, TEACHER, ANIM_NOD);
  yield* speak(P, TEACHER);
  yield* wait(P, 10);
  yield* animThenIdle(P, EMILY, ANIM_NOD);
  yield* speak(P, EMILY);
  faceToward(P, ACTOR_PLAYER, EMILY);
  yield* wait(P, 50);
  faceToward(P, TEACHER, EMILY);
  yield* wait(P, 30);
  // of two lines, the first for a boy, the second for a girl (the other skipped)
  if (P.V.storyModeGenderOfMainCharacter) advanceText(P);
  yield* speak(P, EMILY);                                             // .speak
  if (!P.V.storyModeGenderOfMainCharacter) advanceText(P);
  yield* wait(P, 15);                                                 // .wait
  yield* animThenIdle(P, TEACHER, ANIM_NOD);
  yield* speak(P, TEACHER);
  yield* wait(P, 15);
  yield* animThenIdle(P, ACTOR_PLAYER, ANIM_NOD);
  yield* wait(P, 15);
  yield* animThenIdle(P, TEACHER, ANIM_NOD);
  yield* speak(P, TEACHER);
  yield* wait(P, 15);
  yield* animThenIdle(P, EMILY, ANIM_BOUNCE);
  yield* speak(P, EMILY);
  faceToward(P, EMILY, ACTOR_PLAYER);
  setPosition(P, ACTOR_ACADEMY_MAIN_BLDG_NEW_STUDENT_BALLOON_QUESTION, 35.0, 23.0);
  sound(P, SFX_EMOTE);
  yield* wait(P, 60);
  setPosition(P, ACTOR_ACADEMY_MAIN_BLDG_NEW_STUDENT_BALLOON_QUESTION, 63.0, 63.0);
  yield* animThenIdle(P, TEACHER, ANIM_NOD);
  yield* speak(P, TEACHER);
  yield* animThenIdle(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* wait(P, 10);
  faceToward(P, TEACHER, ACTOR_PLAYER);
  yield* animThenIdle(P, ACTOR_PLAYER, ANIM_NOD);
  yield* wait(P, 15);
  facePair(P, TEACHER, EMILY);
  setAnim(P, EMILY, ANIM_NOD);
  yield* animThenIdle(P, TEACHER, ANIM_NOD);
  yield* movePlayer(P, 34.0, 23.0);
  yield* wait(P, 40);
  moveTarget(P, EMILY, 34.0, 3.0);
  yield* wait(P, 10);
  yield* movePlayer(P, 34.0, 3.0);
  moveTarget(P, ACTOR_PLAYER, 34.0, 3.0);
  yield* waitMove(P, ACTOR_PLAYER);
  requestExit(P, 0x0F);
  endCutscene(P);
}
// script_set_anim actor, anim / script_wait_idle actor
function* animThenIdle(P, actor, anim) {
  setAnim(P, actor, anim);
  yield* waitIdle(P, actor);
}

// ---- the foreground tiles ----
// UpdatePlayerPairTileAnimState_10 (10:79D0), a frame task: the player, and in doubles the partner, drawn or
// hidden by the scene tiles where they stand
export function updatePlayerPairTileAnimState(P) {
  updateActorTileAnimState(P, 0);
  if (testFlag(P, FLAG_DOUBLES)) updateActorTileAnimState(P, 2);
}
// UpdateActorTileAnimState_10 (10:79DF): actor slot a over the scene tilemap (ReadSceneTilemapTile_10, from the
// actor's own record address: the slot's offset moves the row read) at column (x - 0.3125 tiles), row (y + 0.25
// tiles) - 1 (3 rows up for any slot but 0): on a foreground tile (attribute low bits 6; above: bit 7 clear too)
// its drawn mode flips (ACTORF_MODE ^ 1), else it is drawn (mode 2). Returns a, bc, de, hl as the ROM leaves them.
export function updateActorTileAnimState(P, slot) {
  const { bus } = P;
  P.wramBank(WRAM_ACTORS);
  const actor = (wActors + ((slot << 6) & 0xFFFF)) & 0xFFFF;
  const col = ((bus.u16(actor + ACTORF_X) + 0xFFB0) & 0xFFFF) >> 8;
  const row = (((bus.u16(actor + ACTORF_Y) + 0x40) >> 8) - (slot ? 3 : 1)) & 0xFF;
  let r = readSceneTilemapTile(P, actor, col, row);
  let de = (col << 8 | row) & 0xFFFF;                                 // (push de / pop de around the first read)
  if ((r.a & 0x87) !== TILE_FOREGROUND) {                             // .checkBelow: the tile below
    r = readSceneTilemapTile(P, actor, (col + 1) & 0xFF, row);
    de = r.de;
    if ((r.a & 0x07) !== TILE_FOREGROUND) {                           // .actorLoop
      P.wramBank(WRAM_ACTORS);
      bus.w8(actor + ACTORF_MODE, ACTOR_MODE_DRAWN);
      return { a: ACTOR_MODE_DRAWN, bc: actor, de, hl: actor + ACTORF_MODE };
    }
  }
  P.wramBank(WRAM_ACTORS);
  const mode = bus.u8(actor + ACTORF_MODE) ^ 0x01;
  bus.w8(actor + ACTORF_MODE, mode);
  return { a: mode, bc: actor, de, hl: actor + ACTORF_MODE };
}
// Unused_10_UpdateActorTileAnimStateByIndex (10:7A56): the same for slot a with the row always 3 up. Nothing calls it.
export function unusedUpdateActorTileAnimStateByIndex(P, slot) {
  const { bus } = P;
  P.wramBank(WRAM_ACTORS);
  const actor = (wActors + (((slot & 0xFF) << 6) & 0xFFFF)) & 0xFFFF;
  const col = ((bus.u16(actor + ACTORF_X) + 0xFFB0) & 0xFFFF) >> 8;
  const row = (((bus.u16(actor + ACTORF_Y) + 0x40) >> 8) - 3) & 0xFF;
  let r = readSceneTilemapTile(P, actor, col, row), de = (col << 8 | row) & 0xFFFF;
  if ((r.a & 0x87) !== TILE_FOREGROUND) {                             // .nextActor
    r = readSceneTilemapTile(P, actor, (col + 1) & 0xFF, row);
    de = r.de;
    if ((r.a & 0x07) !== TILE_FOREGROUND) {                           // .done
      P.wramBank(WRAM_ACTORS);
      bus.w8(actor + ACTORF_MODE, ACTOR_MODE_DRAWN);
      return { a: ACTOR_MODE_DRAWN, bc: actor, de, hl: actor + ACTORF_MODE };
    }
  }
  P.wramBank(WRAM_ACTORS);
  const mode = bus.u8(actor + ACTORF_MODE) ^ 0x01;
  bus.w8(actor + ACTORF_MODE, mode);
  return { a: mode, bc: actor, de, hl: actor + ACTORF_MODE };
}

export const HOOKS = [
  scene(BANK, 0x73EE, speakNpc03SinglesOrDoublesLine),
  scene(BANK, 0x7405, showNpc03SinglesOrDoublesPrompt),
  [BANK, 0x7429, hook(P => { academyWingInstallDoorTriggers(P); })],
  [BANK, 0x7443, hook(P => { academyWingHideActorByProgressFlag(P); })],
  [BANK, 0x7472, hook(P => setAcademyWingDialogueStage(P))],
  scene(BANK, 0x7532, arrivalWalkDown),
  scene(BANK, 0x7578, arrivalWalkUp),
  scene(BANK, 0x75E7, academyMainBldgNpc03),
  scene(BANK, 0x7631, academyMainBldgNpc04),
  scene(BANK, 0x7654, academyMainBldgNpc05),
  scene(BANK, 0x76D1, academyMainBldgNpc06),
  scene(BANK, 0x7717, academyMainBldgInitScript),
  scene(BANK, 0x7741, academyMainBldgNewStudentCutscene),
  [BANK, 0x79D0, hook(P => { updatePlayerPairTileAnimState(P); })],
  [BANK, 0x79DF, hook((P, c) => updateActorTileAnimState(P, c.a))],
  [BANK, 0x7A56, hook((P, c) => unusedUpdateActorTileAnimStateByIndex(P, c.a))],
];
