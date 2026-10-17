// Bank $10's menu helpers, the cafeteria and the restaurant ($56E9-$61B0): the minigame's drill id, the exhibition's
// character slots copied, an unused check for any saved story slot, where a saved story continues, the question
// whether to drop an exhibition match quit with save (its player's slot erased); the cafeteria's NPCs and init
// script; the restaurant's arrival walk, exit, NPCs (lines by the story stage; questions; the student who steps
// aside, the one who shuffles back once per stage, the balloon next to the player) and init script. The tables
// (drill ids, text ids by stage, flags by stage) and the map tables are data (read from the ROM).
// Port of src/story/restaurant_10.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/engine/rec1.mtrec, rec2.mtrec (the main menu: a story slot continued), out/port/ss2_cafe*.mtrec,
// ss2_talk_cafeteria*.mtrec, ss2_talk_restaurant*.mtrec (scripted: the cafeteria's arrival, its and the
// restaurant's NPCs).
import {
  ACTORF_X, ACTORF_Y, ACTOR_PLAYER, ANIM_BOUNCE, ANIM_NOD, ANIM_SHAKE, FACE_DOWN, FACE_RIGHT, FACE_UP, FLAG_DOUBLES,
  FZ, WRAM_ACTORS, WRAM_SCREEN, actorState, advanceText, askYesNo, clearFlag, copySceneToVram, disableLCDSafely,
  enableLCD, face, faceToward, gesture, hook, hookGen, jumpVelocity, lockFacing, moveAngle, moveTarget, scene,
  setAnim, setFlag, setFlagTableEntry, setPosition, setPositionRaw, setSpeed, setText, sound, speak, testFlag,
  testFlagF, testFlagTableEntry, unlockFacing, wait, waitMove, withWram,
} from "./common.js";
import { getRegs } from "../home/cpu.js";
import { rom, romWait } from "../menus/equipment/defs.js";
import { tableText, sra, flagCmdF, addToHL } from "./shared2.js";
import { setStoryDialogueStage, mapArrivalWalkPair } from "./walks_10.js";
import { arrivalWalkUp } from "./twins.js";

const BANK = 0x10;
const NUM_STORY_SLOTS = 3, SLOT_EMPTY = 0xFE;
const STORYTIER_ACADEMY = 0x00, STORYTIER_JUNIOR_CHAMP = 0x01, STORYTIER_ISLAND_OPEN = 0x03, STORYTIER_COMPLETE = 0x04;
const STORYRANK_DOUBLES_ACADEMY = 0x01, STORYRANK_DOUBLES_JUNIOR_CHAMP = 0x03, STORYRANK_DOUBLES_SENIOR_CHAMP = 0x05;
const STORYRANK_SINGLES_ISLAND_OPEN = 0x06, STORYRANK_DOUBLES_COMPLETE = 0x09;
const FLAG_RESTAURANT_NPC08_MOVED = 0x7B, FLAG_TEMP_SCENE_VARIANT_B = 0xE1;
const FLAG_WON_ISLAND_OPEN_DOUBLES_FINAL = 0x35, FLAG_WON_ISLAND_OPEN_SINGLES_FINAL = 0x3C;
const FLAG_STORY_COMPLETE_SINGLES = 0xB0, FLAG_STORY_COMPLETE_DOUBLES = 0xB1;
const FLAG_REACHED_MARIO_WORLD_SINGLES = 0xB2, FLAG_REACHED_MARIO_WORLD_DOUBLES = 0xB3;
const SFX_CHIME = 0x97;
const ERASE_CONFIRM_EXHIB = 0x02;                       // RunEraseDataConfirmMenu's b: the suspended match's question
const Text_33_169 = 0x0CA9, Text_33_171 = 0x0CAB, Text_33_221 = 0x0CDD, Text_33_222 = 0x0CDE;
const ACTOR_CAFETERIA_WALK_71_03_1 = 0x03, ACTOR_CAFETERIA_WALK_71_03_2 = 0x04, ACTOR_CAFETERIA_WALK_72_03_1 = 0x05;
const ACTOR_CAFETERIA_WALK_72_03_2 = 0x06, ACTOR_CAFETERIA_WALK_72_04_1 = 0x07, ACTOR_CAFETERIA_WALK_72_05 = 0x08;
const ACTOR_CAFETERIA_WALK_72_04_2 = 0x09;
const ACTOR_RESTAURANT_WALK_71_02_1 = 0x03, ACTOR_RESTAURANT_WALK_71_02_2 = 0x04, ACTOR_RESTAURANT_WALK_71_03_1 = 0x05;
const ACTOR_RESTAURANT_WALK_71_04 = 0x06, ACTOR_RESTAURANT_BALLOON_EXCLAIM = 0x07, ACTOR_RESTAURANT_WALK_71_06_1 = 0x08;
const ACTOR_RESTAURANT_WALK_71_07 = 0x09, ACTOR_RESTAURANT_WALK_71_03_2 = 0x0A, ACTOR_RESTAURANT_WALK_72_03_1 = 0x0B;
const ACTOR_RESTAURANT_WALK_71_06_2 = 0x0C, ACTOR_RESTAURANT_WALK_72_05_1 = 0x0D, ACTOR_RESTAURANT_WALK_72_04_1 = 0x0E;
const ACTOR_RESTAURANT_WALK_72_05_2 = 0x0F, ACTOR_RESTAURANT_WALK_72_04_2 = 0x10;
const ACTOR_RESTAURANT_BALLOON_ELLIPSIS = 0x11, ACTOR_RESTAURANT_WALK_72_03_2 = 0x12;
// data of this bank (read from the ROM)
const MinigameDrillIdTable = 0x56F3, RestaurantNpc12StageFlagTable_10 = 0x6150;
const CafeteriaNpc03TextIds = 0x5899, CafeteriaNpc04TextIds = 0x5921, CafeteriaNpc05TextIds = 0x5961;
const CafeteriaNpc06TextIds = 0x5982, CafeteriaNpc07TextIds = 0x59AD, CafeteriaNpc08TextIds = 0x59D8;
const CafeteriaNpc09TextIds = 0x5A03;
const RestaurantNpc03TextIds = 0x5C13, RestaurantNpc04TextIds = 0x5C34, RestaurantNpc05TextIds = 0x5C9C;
const RestaurantNpc06TextIds_10 = 0x5CFB, RestaurantNpc12TextIds = 0x5DDC, RestaurantNpc08TextIds = 0x5E81;
const RestaurantNpc09TextIds = 0x5EDE, RestaurantNpc0ATextIds = 0x5F30, RestaurantNpc0BTextIds = 0x5F65;
const RestaurantNpc0CTextIds = 0x5FBF, RestaurantNpc0DTextIds = 0x6009, RestaurantNpc0ETextIds = 0x602A;
const RestaurantNpc0FTextIds = 0x604B, RestaurantNpc10TextIds = 0x606C;
// routines of other banks (run as the ROM's, or the JS another part hooked there)
const CheckStorySlot = [0x03, 0x4D64], ReadExhibitionSaveBlock = [0x03, 0x4FEA];
const WriteExhibitionSaveBlock = [0x03, 0x4FAE], RunEraseDataConfirmMenu = [0x3E, 0x4C12];
// the cafeteria's scroll limits and map size (tiles)
const CAFETERIA_SCROLL_MIN_X = 0x22, CAFETERIA_SCROLL_MIN_Y = 0x26, CAFETERIA_WIDTH = 0x40, CAFETERIA_HEIGHT = 0x3E;

// ---- the main menu's helpers ----
// GetMinigameDrillId (10:56E9): the drill of minigame a (MinigameDrillIdTable). Returns a, hl and the flags of the
// address's `add l` (or `inc h`)
export function getMinigameDrillId(P, a) {
  const { hl, f } = addToHL(MinigameDrillIdTable, a);
  return { a: P.rom.u8(BANK, hl), f, hl };
}
// CopyExhibitionCharSlotIds (10:56FC): the character select's four slot characters (WRAM 3) into
// wMatchSlotCharRefs. af kept; de and hl left past the copies.
export function copyExhibitionCharSlotIds(P, entry) {
  const from = P.A.charSelectSlotChars, to = P.A.matchSlotCharRefs;
  withWram(P, WRAM_SCREEN, () => { for (let i = 0; i < 4; i++) P.bus.w8(to + i, P.bus.u8(from + i)); });
  return { a: entry.a, f: entry.f, de: (to + 3) & 0xFFFF, hl: (from + 4) & 0xFFFF };
}
// Unused_10_CheckAnyStorySlot (10:571E): whether any story slot holds a game (CheckStorySlot not SLOT_EMPTY for
// slot 0, 1 or 2): a = 1 and the slot chosen kept (F as at the call); none: a = 0 and slot 0
export function unusedCheckAnyStorySlot(P, entryF) {
  const saved = P.V.currentStorySlot;
  let r;
  for (let slot = 0; slot < NUM_STORY_SLOTS; slot++) {
    P.V.currentStorySlot = slot;
    r = rom(P, CheckStorySlot);
    if (r.a !== SLOT_EMPTY) {
      P.V.currentStorySlot = saved;
      return { ...r, a: 0x01, f: entryF };
    }
  }
  P.V.currentStorySlot = 0;
  return { ...r, a: 0x00, f: FZ };
}
// GetStoryContinueDestination (10:5752): where a saved story continues (singles or doubles flags): 2 before the
// Island Open final is won, 4 before the story is complete, 5 before Mario World is reached, then 2. Returns a and
// the last flag test's F.
export function getStoryContinueDestination(P) {
  const doubles = testFlag(P, FLAG_DOUBLES);
  const steps = doubles
    ? [[FLAG_WON_ISLAND_OPEN_DOUBLES_FINAL, 0x02], [FLAG_STORY_COMPLETE_DOUBLES, 0x04], [FLAG_REACHED_MARIO_WORLD_DOUBLES, 0x05]]
    : [[FLAG_WON_ISLAND_OPEN_SINGLES_FINAL, 0x02], [FLAG_STORY_COMPLETE_SINGLES, 0x04], [FLAG_REACHED_MARIO_WORLD_SINGLES, 0x05]];
  for (const [flag, a] of steps) if (!testFlag(P, flag)) return { a, f: testFlagF(false) };
  return { a: 0x02, f: testFlagF(true) };
}
// ConfirmDiscardSuspendedExhibMatch (10:578A): an exhibition match quit with save (its save block in use and
// wSaveAndQuitRequest) that one of the slot's characters plays in (wMatchSlotCharRefs: bit 7 set, the slot in
// bits 1-6): the question (RunEraseDataConfirmMenu b = 2); a no: the match dropped (the flags cleared, the block
// written) and a = 0; a yes: a = 1. Otherwise a kept. F, b and c as at the call.
export function* confirmDiscardSuspendedExhibMatch(P, entry) {
  const keep = { f: entry.f, b: entry.b, c: entry.c };
  const r = rom(P, ReadExhibitionSaveBlock);
  const done = { d: r.d, e: r.e, h: r.h, l: r.l, a: entry.a, ...keep };
  if (r.a & 0x80 || !P.V.saveAndQuitRequest) return done;
  const slot = P.V.currentStorySlot;
  const plays = i => {
    const v = P.bus.u8(P.A.matchSlotCharRefs + i);
    return (v & 0x80) !== 0 && ((v & 0x7F) >> 1) === slot;
  };
  if (![0, 1, 2, 3].some(plays)) return done;
  const m = yield* romWait(P, RunEraseDataConfirmMenu, { a: slot, b: ERASE_CONFIRM_EXHIB });
  if (m.a === 0) return { d: m.d, e: m.e, h: m.h, l: m.l, a: 0x01, ...keep };   // .discarded
  P.V.saveAndQuitRequest = 0;
  P.V.keepMatchStatsFlag = 0;
  const w = rom(P, WriteExhibitionSaveBlock);
  return { d: w.d, e: w.e, h: w.h, l: w.l, a: 0x00, ...keep };
}

// ---- the NPCs ----
// the line of the table's entry for the index (wMapSceneStage or wMapSceneStage2)
function* tableLine(P, table, index, actor) {
  yield* setText(P, tableText(P, BANK, table, index));
  yield* speak(P, actor);
}
const stage = P => P.V.mapSceneStage, tier = P => P.V.mapSceneStage2;
// the question of the line set: a no shows the other answer (AdvanceDialogueTextCursor)
function* askOrOther(P, actor) {
  if ((yield* askYesNo(P, actor)) !== 0) advanceText(P);
}

// CafeteriaNpc03_10 .. CafeteriaNpc09_10 (10:5882 ..): the cafeteria's students; 04 and 05 ask questions
export const cafeteriaNpc03 = P => tableLine(P, CafeteriaNpc03TextIds, stage(P), ACTOR_CAFETERIA_WALK_71_03_1);
// CafeteriaNpc04_10 (10:58AD): his line by tier; at the Island Open (or later but complete) a question; complete:
// another question (doubles complete: its second line), answered with Text_33_221 (yes: the ROM's .declined) or
// Text_33_222
export function* cafeteriaNpc04(P) {
  const actor = ACTOR_CAFETERIA_WALK_71_03_2;
  yield* setText(P, tableText(P, BANK, CafeteriaNpc04TextIds, tier(P)));
  if (tier(P) >= STORYTIER_ISLAND_OPEN) {
    if (tier(P) !== STORYTIER_COMPLETE) yield* askOrOther(P, actor);
    else {                                                // .prompt
      if (stage(P) === STORYRANK_DOUBLES_COMPLETE) advanceText(P);
      yield* setText(P, (yield* askYesNo(P, actor)) !== 0 ? Text_33_222 : Text_33_221);   // .askQuestion
    }
  }
  yield* speak(P, actor);
}
// CafeteriaNpc05_10 (10:592B): her line by tier; as junior champion a question
export function* cafeteriaNpc05(P) {
  const actor = ACTOR_CAFETERIA_WALK_72_03_1;
  yield* setText(P, tableText(P, BANK, CafeteriaNpc05TextIds, tier(P)));
  if (tier(P) === STORYTIER_JUNIOR_CHAMP) yield* askOrOther(P, actor);
  yield* speak(P, actor);
}
export const cafeteriaNpc06 = P => tableLine(P, CafeteriaNpc06TextIds, stage(P), ACTOR_CAFETERIA_WALK_72_03_2);
export const cafeteriaNpc07 = P => tableLine(P, CafeteriaNpc07TextIds, stage(P), ACTOR_CAFETERIA_WALK_72_04_1);
export const cafeteriaNpc08 = P => tableLine(P, CafeteriaNpc08TextIds, stage(P), ACTOR_CAFETERIA_WALK_72_05);
export const cafeteriaNpc09 = P => tableLine(P, CafeteriaNpc09TextIds, stage(P), ACTOR_CAFETERIA_WALK_72_04_2);
// CafeteriaInitScript_10 (10:5A52): the stage and its tier; the scroll limits and the map's size; the scene drawn
// (LCD off); the arrival walk
export function* cafeteriaInitScript(P) {
  setStoryDialogueStage(P);
  P.V.mapSceneStage2 = sra(P.V.mapSceneStage);
  P.V.mapScrollMinX = CAFETERIA_SCROLL_MIN_X;
  P.V.mapScrollMinY = CAFETERIA_SCROLL_MIN_Y;
  P.V.mapWidthTiles = CAFETERIA_WIDTH;
  P.V.mapHeightTiles = CAFETERIA_HEIGHT;
  disableLCDSafely(P);
  copySceneToVram(P, 0x00);
  enableLCD(P);
  yield* mapArrivalWalkPair(P);
}

// RestaurantExit01_10 (10:5BEE): the student who stepped aside back at his place next time
export function restaurantExit01(P) {
  clearFlag(P, FLAG_RESTAURANT_NPC08_MOVED);
  return { f: flagCmdF(P) };
}
// RestaurantNpc03_10 (10:5BF2): his line by tier (doubles junior champion: its second line)
export function* restaurantNpc03(P) {
  yield* setText(P, tableText(P, BANK, RestaurantNpc03TextIds, tier(P)));
  if (stage(P) === STORYRANK_DOUBLES_JUNIOR_CHAMP) advanceText(P);
  yield* speak(P, ACTOR_RESTAURANT_WALK_71_02_1);
}
export const restaurantNpc04 = P => tableLine(P, RestaurantNpc04TextIds, tier(P), ACTOR_RESTAURANT_WALK_71_02_2);
// RestaurantNpc05_10 (10:5C3E): turned to the player, three lines: a bounce looking down, a shake facing the player
export function* restaurantNpc05(P) {
  const actor = ACTOR_RESTAURANT_WALK_71_03_1;
  faceToward(P, ACTOR_PLAYER, actor);
  yield* setText(P, tableText(P, BANK, RestaurantNpc05TextIds, stage(P)));
  yield* speak(P, actor);
  face(P, actor, FACE_DOWN);
  yield* gesture(P, actor, ANIM_BOUNCE);
  yield* speak(P, actor);
  faceToward(P, ACTOR_PLAYER, actor);
  yield* gesture(P, actor, ANIM_SHAKE);
  yield* speak(P, actor);
  yield* wait(P, 20);
  face(P, actor, FACE_DOWN);
}
// RestaurantNpc06_10 (10:5CB0): a shake, his line by tier (doubles senior champion: its third); at the academy the
// balloon by the player; a nod, his next line
export function* restaurantNpc06(P) {
  const actor = ACTOR_RESTAURANT_WALK_71_04;
  yield* gesture(P, actor, ANIM_SHAKE);
  yield* setText(P, tableText(P, BANK, RestaurantNpc06TextIds_10, tier(P)));
  if (stage(P) === STORYRANK_DOUBLES_SENIOR_CHAMP) { advanceText(P); advanceText(P); }
  yield* speak(P, actor);
  if (tier(P) === STORYTIER_ACADEMY) yield* restaurantShowActor11NearPlayer(P);
  yield* gesture(P, actor, ANIM_NOD);
  yield* speak(P, actor);
}
// RestaurantNpc12_10 (10:5D05): the first time at a stage (its flag, RestaurantNpc12StageFlagTable_10): a nod, her
// line, the "!" balloon over her (a chime, a bounce), her next line, looking down she shuffles back a tile (facing
// kept), the stage's flag set, and her line after; later only that line (the table's id + 2)
export function* restaurantNpc12(P) {
  const actor = ACTOR_RESTAURANT_WALK_72_03_2;
  const after = () => addToHL(tableText(P, BANK, RestaurantNpc12TextIds, tier(P)), 0x02).hl;
  if (!(testRestaurantNpc12StageFlag(P).f & FZ)) {        // .speak
    faceToward(P, ACTOR_PLAYER, actor);
    yield* setText(P, after());
    yield* speak(P, actor);
    return;
  }
  yield* gesture(P, actor, ANIM_NOD);
  yield* setText(P, tableText(P, BANK, RestaurantNpc12TextIds, tier(P)));
  yield* speak(P, actor);
  faceToward(P, ACTOR_PLAYER, actor);
  setPosition(P, ACTOR_RESTAURANT_BALLOON_EXCLAIM, 28.0, 17.0);
  sound(P, SFX_CHIME);
  setAnim(P, actor, ANIM_BOUNCE);
  yield* wait(P, 40);
  setPosition(P, ACTOR_RESTAURANT_BALLOON_EXCLAIM, 63.0, 63.0);
  yield* speak(P, actor);
  face(P, actor, FACE_DOWN);
  yield* wait(P, 20);
  lockFacing(P, actor);
  moveAngle(P, actor, FACE_UP, 1.0);
  setRestaurantNpc12StageFlag(P);
  faceToward(P, ACTOR_PLAYER, actor);
  yield* setText(P, after());                             // .altText
  yield* speak(P, actor);
  unlockFacing(P, actor);
  face(P, actor, FACE_DOWN);
}
// RestaurantNpc08FaceDown_10 (10:5DE6): RestaurantNpc08_10 with the player hopping out of the way first
export function* restaurantNpc08FaceDown(P) {
  setFlag(P, FLAG_TEMP_SCENE_VARIANT_B);
  yield* restaurantNpc08(P);
}
// RestaurantNpc08_10 (10:5DE9): the first time, his line, then he steps aside to (33.25, 15) (the player hopping
// to (31, 15) when talked to from below), a bounce facing right (FLAG_RESTAURANT_NPC08_MOVED); later his next line
export function* restaurantNpc08(P) {
  const actor = ACTOR_RESTAURANT_WALK_71_06_1;
  const text = tableText(P, BANK, RestaurantNpc08TextIds, tier(P));
  if (testFlag(P, FLAG_RESTAURANT_NPC08_MOVED)) {         // .speak
    yield* setText(P, addToHL(text, 0x01).hl);
    yield* speak(P, actor);
    face(P, actor, FACE_RIGHT);
    return;
  }
  yield* setText(P, text);
  yield* speak(P, actor);
  setSpeed(P, actor, 0.5);
  if (testFlag(P, FLAG_TEMP_SCENE_VARIANT_B)) {
    jumpVelocity(P, ACTOR_PLAYER, -2.0);
    moveTarget(P, ACTOR_PLAYER, 31.0, 15.0);
    yield* waitMove(P, ACTOR_PLAYER);
    face(P, ACTOR_PLAYER, FACE_RIGHT);
  }
  moveTarget(P, actor, 33.25, 15.0);                      // .altText
  yield* waitMove(P, actor);
  yield* wait(P, 10);
  setAnim(P, actor, ANIM_BOUNCE);
  face(P, actor, FACE_RIGHT);
  setFlag(P, FLAG_RESTAURANT_NPC08_MOVED);
  clearFlag(P, FLAG_TEMP_SCENE_VARIANT_B);
}
// RestaurantNpc09_10 (10:5E8B): his line by stage; from the Island Open a question: yes Text_33_169 (doubles: its
// second line), no Text_33_171
export function* restaurantNpc09(P) {
  const actor = ACTOR_RESTAURANT_WALK_71_07;
  yield* setText(P, tableText(P, BANK, RestaurantNpc09TextIds, stage(P)));
  if (stage(P) >= STORYRANK_SINGLES_ISLAND_OPEN) {
    if ((yield* askYesNo(P, actor)) !== 0) yield* setText(P, Text_33_171);
    else {
      yield* setText(P, Text_33_169);
      if (testFlag(P, FLAG_DOUBLES)) advanceText(P);
    }
  }
  yield* speak(P, actor);
}
// RestaurantNpc0A_10 (10:5EF2): turned to the player, her line by stage; before the Island Open a question
export function* restaurantNpc0A(P) {
  const actor = ACTOR_RESTAURANT_WALK_71_03_2;
  faceToward(P, ACTOR_PLAYER, actor);
  yield* setText(P, tableText(P, BANK, RestaurantNpc0ATextIds, stage(P)));
  if (stage(P) < STORYRANK_SINGLES_ISLAND_OPEN) yield* askOrOther(P, actor);
  yield* speak(P, actor);
}
// RestaurantNpc0B_10 (10:5F44): her line by tier (doubles at the academy: its second line)
export function* restaurantNpc0B(P) {
  yield* setText(P, tableText(P, BANK, RestaurantNpc0BTextIds, tier(P)));
  if (stage(P) === STORYRANK_DOUBLES_ACADEMY) advanceText(P);
  yield* speak(P, ACTOR_RESTAURANT_WALK_72_03_1);
}
// RestaurantNpc0C_10 (10:5F6F): his line by tier; as a champion (tiers 1, 2) a question (a no: the other answer,
// doubles senior champion: the one after it); from the Island Open doubles' line the next
export function* restaurantNpc0C(P) {
  const actor = ACTOR_RESTAURANT_WALK_71_06_2;
  yield* setText(P, tableText(P, BANK, RestaurantNpc0CTextIds, tier(P)));
  if (tier(P) >= STORYTIER_ISLAND_OPEN) {
    if (stage(P) & 0x01) advanceText(P);                  // .ge03
  } else if (tier(P) !== STORYTIER_ACADEMY && (yield* askYesNo(P, actor)) !== 0) {
    advanceText(P);
    if (stage(P) === STORYRANK_DOUBLES_SENIOR_CHAMP) advanceText(P);
  }
  yield* speak(P, actor);
}
// RestaurantNpc0D_10 (10:5FC9): her line by tier; at the Island Open a question; doubles junior champion: the next
export function* restaurantNpc0D(P) {
  const actor = ACTOR_RESTAURANT_WALK_72_05_1;
  yield* setText(P, tableText(P, BANK, RestaurantNpc0DTextIds, tier(P)));
  if (tier(P) === STORYTIER_ISLAND_OPEN) yield* askOrOther(P, actor);
  if (stage(P) === STORYRANK_DOUBLES_JUNIOR_CHAMP) advanceText(P);   // .advanceDialogueTextCursor
  yield* speak(P, actor);
}
export const restaurantNpc0E = P => tableLine(P, RestaurantNpc0ETextIds, tier(P), ACTOR_RESTAURANT_WALK_72_04_1);
export const restaurantNpc0F = P => tableLine(P, RestaurantNpc0FTextIds, tier(P), ACTOR_RESTAURANT_WALK_72_05_2);
export const restaurantNpc10 = P => tableLine(P, RestaurantNpc10TextIds, tier(P), ACTOR_RESTAURANT_WALK_72_04_2);
// RestaurantInitScript_10 (10:60F1): the stage and its tier; the two students who moved back where they went
export function* restaurantInitScript(P) {
  setStoryDialogueStage(P);
  P.V.mapSceneStage2 = sra(P.V.mapSceneStage);
  restaurantRestoreNpc12Position(P);
  restaurantRestoreNpc08Position(P);
}
// RestaurantRestoreNpc08Position_10 (10:6103): moved aside: at (33.25, 15) facing right
export function restaurantRestoreNpc08Position(P) {
  if (!testFlag(P, FLAG_RESTAURANT_NPC08_MOVED)) return;
  setPosition(P, ACTOR_RESTAURANT_WALK_71_06_1, 33.25, 15.0);
  face(P, ACTOR_RESTAURANT_WALK_71_06_1, FACE_RIGHT);
}
// RestaurantRestoreNpc12Position_10 (10:611B): shuffled back at this stage: at (27, 17)
export function restaurantRestoreNpc12Position(P) {
  if (testRestaurantNpc12StageFlag(P).f & FZ) return;
  setPosition(P, ACTOR_RESTAURANT_WALK_72_03_2, 27.0, 17.0);
}
// TestRestaurantNpc12StageFlag_10 (10:612C) / SetRestaurantNpc12StageFlag_10 (10:613E): the flag of the tier
// (RestaurantNpc12StageFlagTable_10)
export const testRestaurantNpc12StageFlag = P => testFlagTableEntry(P, BANK, RestaurantNpc12StageFlagTable_10, tier(P));
export const setRestaurantNpc12StageFlag = P => setFlagTableEntry(P, BANK, RestaurantNpc12StageFlagTable_10, tier(P));
// RestaurantShowActor11NearPlayer_10 (10:615A): the "..." balloon (actor $11) at the player's position + (1.5,
// -1.5) tiles (kept in wMapScratch + 6 / + 8) for 70 frames. WRAM 4 left mapped.
export function* restaurantShowActor11NearPlayer(P) {
  P.wramBank(WRAM_ACTORS);
  const bc = actorState(P, ACTOR_PLAYER);
  const x = (P.bus.u16((bc + ACTORF_X) & 0xFFFF) + 0x0180) & 0xFFFF;
  const y = (P.bus.u16((bc + ACTORF_Y) & 0xFFFF) + 0xFE80) & 0xFFFF;
  P.bus.w16((P.A.mapScratch + 6) & 0xFFFF, x);
  P.bus.w16((P.A.mapScratch + 8) & 0xFFFF, y);
  setPositionRaw(P, ACTOR_RESTAURANT_BALLOON_ELLIPSIS, x, y);
  yield* wait(P, 70);
  setPosition(P, ACTOR_RESTAURANT_BALLOON_ELLIPSIS, 63.0, 63.0);
}

export const HOOKS = [
  [BANK, 0x56E9, hook((P, c) => getMinigameDrillId(P, c.a))],
  [BANK, 0x56FC, hook((P, c) => copyExhibitionCharSlotIds(P, getRegs(c)))],
  [BANK, 0x571E, hook((P, c) => unusedCheckAnyStorySlot(P, c.f))],
  [BANK, 0x5752, hook(getStoryContinueDestination)],
  [BANK, 0x578A, hookGen((P, c) => confirmDiscardSuspendedExhibMatch(P, getRegs(c)))],
  scene(BANK, 0x5882, cafeteriaNpc03),
  scene(BANK, 0x58AD, cafeteriaNpc04),
  scene(BANK, 0x592B, cafeteriaNpc05),
  scene(BANK, 0x596B, cafeteriaNpc06),
  scene(BANK, 0x5996, cafeteriaNpc07),
  scene(BANK, 0x59C1, cafeteriaNpc08),
  scene(BANK, 0x59EC, cafeteriaNpc09),
  scene(BANK, 0x5A52, cafeteriaInitScript),
  scene(BANK, 0x5B97, arrivalWalkUp),                    // RestaurantArrival01_10 (src/twins/academy_main_bldg_arrival01)
  [BANK, 0x5BEE, hook(restaurantExit01)],
  scene(BANK, 0x5BF2, restaurantNpc03),
  scene(BANK, 0x5C1D, restaurantNpc04),
  scene(BANK, 0x5C3E, restaurantNpc05),
  scene(BANK, 0x5CB0, restaurantNpc06),
  scene(BANK, 0x5D05, restaurantNpc12),
  scene(BANK, 0x5DE6, restaurantNpc08FaceDown),
  scene(BANK, 0x5DE9, restaurantNpc08),
  scene(BANK, 0x5E8B, restaurantNpc09),
  scene(BANK, 0x5EF2, restaurantNpc0A),
  scene(BANK, 0x5F44, restaurantNpc0B),
  scene(BANK, 0x5F6F, restaurantNpc0C),
  scene(BANK, 0x5FC9, restaurantNpc0D),
  scene(BANK, 0x6013, restaurantNpc0E),
  scene(BANK, 0x6034, restaurantNpc0F),
  scene(BANK, 0x6055, restaurantNpc10),
  // (script-macro routines: the registers they leave are read by no caller, and put back as at the call)
  scene(BANK, 0x60F1, restaurantInitScript),
  scene(BANK, 0x6103, function* (P) { restaurantRestoreNpc08Position(P); }),
  scene(BANK, 0x611B, function* (P) { restaurantRestoreNpc12Position(P); }),
  [BANK, 0x612C, hook(testRestaurantNpc12StageFlag)],
  [BANK, 0x613E, hook(setRestaurantNpc12StageFlag)],
  scene(BANK, 0x615A, restaurantShowActor11NearPlayer),
];
