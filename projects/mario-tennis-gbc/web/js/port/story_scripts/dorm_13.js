// The dorm room (bank $13, $4CDC-$56BA): the academy tour's pointer sprite, the door animation the dorm and the
// restaurant use, and the dorm room's scenes: entering (by the entry point: the morning, back from a match, the
// night's narration), the roommate's talk, the cat, the window, the step-on cell that sends the player to the
// varsity's courts.
// The location's tables (DormRoomMapScripts_13, the actor list, entries, NPC/facing/step-on records, the cat's idle
// scripts DormRoomNpc04IdleScripts_13) are data, read from the ROM by the engine.
// Port of src/story/dorm_13.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/engine/rec2.mtrec (the dorm room in Tour mode) and out/port/ss1_dorm*.mtrec (scripted).
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FACE_DOWN, FACE_UP, ANIM_WALK, ANIM_BOUNCE, ANIM_NOD, ANIM_SHAKE, ACTORFLAG_TALKABLE,
  WRAM_STAGING, WRAM_ACTORS, BANK_SAVE, BEHAVIOR_NONE, BEHAVIOR_TRIGGER, STORYENTRY_NONE, FLAG_DOUBLES,
  FLAG_TEMP_SCENE_VARIANT_A, FLAG_TEMP_SCENE_VARIANT_B, testFlag, testFlagF, setFlag, setText, advanceText, speak,
  askYesNo, setAnim, waitIdle, wait, face, faceToward, setPosition, moveTarget, waitMove, movePlayer, waitPlayerMove,
  setSpeed, playerSpeed, jumpVelocity, waitJump, nullScript, setObjdef, setActorScript, followPlayer, setActorFlag,
  copySceneRect, copyCollisionRect, copyBehaviorRect, copySceneToVram, writeBehaviorCell, beginCutscene, endCutscene,
  fadeIn, fadeOut, waitFadeEnd, fadeOutAndWait, waitJingleEnd, sound, randomWord, disableLCDSafely, enableLCD,
  queueVRAMCopy, loadPaletteShadow, queueSpriteTemplate, goToLocation, requestExit, saveReturnPoint, withWram, hook,
  scene,
} from "./common.js";
import {
  runPlayDoublesTodayPrompt, runAcademyQuestionsMenu, getDormRoomStoryStage, dormRoomArrivalCutscene,
  dormRoomEntry0aScene, dormRoomEntry09Scene, dormRoomEntry08Scene,
} from "./academy_13.js";

const BANK = 0x13;
// actors of the dorm room (DormRoomActors_13)
const ACTOR_DORM_ROOM_KATE = 0x03, ACTOR_DORM_ROOM_CAT = 0x04, ACTOR_DORM_ROOM_BALLOON_EXCLAIM = 0x05;
const ACTOR_DORM_ROOM_SLOT_6 = 0x06;                   // the slot after the list (the emote balloon of the bounce)
const OBJ_HARRY = 0x28;
const BGM_NONE = 0x00, BGM_DORM_ROOM = 0x1C, JINGLE_DONE_FOR_THE_DAY = 0x41, SFX_DOOR = 0x71, SFX_CHIME = 0x97;
const STORYLOC_ACADEMY_WING = 0x06, STORYLOC_DORM_ROOM = 0x0A;
const FLAG_WON_JUNIOR_DOUBLES_RANK_1 = 0x42, FLAG_WON_SENIOR_DOUBLES_RANK_1 = 0x46, FLAG_WON_VARSITY_DOUBLES_RANK_2 = 0x48;
const FLAG_WON_VARSITY_SINGLES_RANK_4 = 0x58, FLAG_REACHED_ISLAND_OPEN_SINGLES = 0xAE, FLAG_REACHED_ISLAND_OPEN_DOUBLES = 0xAF;
// text ids (include/text_ids.inc)
const Text_31_131 = 0x0483, Text_31_244 = 0x04F4, Text_31_255 = 0x04FF, Text_31_256 = 0x0500, Text_31_257 = 0x0501;
const Text_31_258 = 0x0502, Text_31_263 = 0x0507, Text_31_278 = 0x0516, Text_31_289 = 0x0521, Text_31_290 = 0x0522;
const Text_31_291 = 0x0523, Text_31_324 = 0x0544, Text_31_328 = 0x0548;
// the morning's first text ids (the operands of DormRoomEntry02Scene's ld de): variant A / B
const MORNING_TEXT_A = 0x052A, MORNING_TEXT_B = 0x0524;
// the cat's lines: a random one of 8 from $053C (DormRoomNpc04_13's add $3c / adc $05)
const CAT_TEXT_FIRST = 0x053C;
// data of this bank (read from the ROM)
const QueueTourPointerSprite_13_SpriteTemplate = 0x4D20, TourPointerTiles_13 = 0x4D30, TourPointerPalette_13 = 0x4D70;
const DormRoomNpc04IdleScripts_13 = 0x526A;
const TOUR_POINTER_BLOCKS = (TourPointerPalette_13 - TourPointerTiles_13) / 16;
const vTiles0 = 0x8000, VRAM_BANK1 = 0x2000, OAM_BANK1 = 0x08, OBJ_PALETTES = 8;
// routines of this bank not ported here (src/story/varsity_courtyard_13.asm, team_bracket_13.asm)
const ComputeEmoteActorPosition_13 = 0x5BFB, PlaceEmoteActorAtComputedPosition_13 = 0x5C27;
const PlaceRoommateAtPlayerTarget_13 = 0x5C39, ComputeStoryRankTier_13 = 0x7D58;
const SaveStorySlotWithTimer = 0x4D10;
// the step-on cells in front of the door that send the player to the varsity courts (their trigger id 15)
const DORM_TRIGGER = BEHAVIOR_TRIGGER | 15 << 4;
const DORM_TRIGGER_CELLS = [[8, 14], [10, 14], [12, 14], [8, 16], [10, 16], [12, 16], [8, 18], [10, 18], [12, 18]];
const YES = 0;

// ---- the academy tour's pointer sprite ----
// LoadTourPointerSpriteGfx_13 (13:4CDC): its tiles to VRAM bank 1's $8000 and its palette to object palette 0
// (with WRAM 1 mapped meanwhile). Returns the registers it leaves: a and F of its pushed hWramBank, b from the
// VRAM copy, the palette load's.
export function loadTourPointerSpriteGfx(P, entry) {
  const old = P.V.wramBank;
  P.wramBank(WRAM_STAGING);
  const q = queueVRAMCopy(P, TourPointerTiles_13, vTiles0 + VRAM_BANK1, TOUR_POINTER_BLOCKS);
  const r = loadPaletteShadow(P, TourPointerPalette_13, OBJ_PALETTES + 0, 1);
  P.wramBank(old);
  return { b: q.b ?? entry.b, d: OBJ_PALETTES + 0, e: 1, ...r, a: old, f: entry.f };
}
// QueueTourPointerSprite_13 (13:4CFF): the pointer's two sprites at (d, e), from VRAM bank 1
export function queueTourPointerSprite(P, x, y) {
  return queueSpriteTemplate(P, QueueTourPointerSprite_13_SpriteTemplate, x, y, 0x00, OAM_BANK1);
}
// AnimateTourPointerSprite_13 (13:4D0A), a frame task: the pointer at (wMapSceneStage, wMapSceneStage2 + 8),
// bobbing up 0-7 pixels with the frame counter
export function animateTourPointerSprite(P) {
  const x = P.V.mapSceneStage, bob = (P.V.vBlankCounter >> 1) & 0x07;
  return queueTourPointerSprite(P, x, (P.V.mapSceneStage2 + 8 - bob) & 0xFF);
}

// ---- the door ----
// AnimateDoorOpen_13 (13:4D78) / AnimateDoorClose_13 (13:4DCC): the dorm's door frames (scene cells (0..6, 21))
// copied over the door at (20, 8), two frames apart (one when closing)
export function* animateDoorOpen(P) {
  sound(P, SFX_DOOR);
  yield* copySceneRect(P, 20, 8, 6, 21, 2, 2);                       // (the closed door kept at (6, 21))
  yield* copySceneRect(P, 0, 21, 20, 8, 2, 2);
  yield* wait(P, 2);
  yield* copySceneRect(P, 2, 21, 20, 8, 2, 2);
  yield* wait(P, 2);
  yield* copySceneRect(P, 4, 21, 20, 8, 2, 2);
  yield* wait(P, 2);
}
export function* animateDoorClose(P) {
  sound(P, SFX_DOOR);
  yield* copySceneRect(P, 4, 21, 20, 8, 2, 2);
  yield* wait(P, 1);
  yield* copySceneRect(P, 2, 21, 20, 8, 2, 2);
  yield* wait(P, 1);
  yield* copySceneRect(P, 0, 21, 20, 8, 2, 2);
  yield* wait(P, 1);
  yield* copySceneRect(P, 6, 21, 20, 8, 2, 2);
}

// ---- the dorm room's handlers ----
// DormRoomNpc04_13 (13:4EA4): the cat says one of its eight lines, at random
export function* dormRoomNpc04(P) {
  yield* setText(P, (CAT_TEXT_FIRST + (randomWord(P) & 0x07)) & 0xFFFF);
  yield* speak(P, ACTOR_DORM_ROOM_CAT);
}
// DormRoomFacing01_13 (13:4ED4): the window (looking out of it)
export function* dormRoomFacing01(P) {
  beginCutscene(P);
  fadeIn(P, 16);
  yield* setText(P, Text_31_131);
  yield* speak(P, ACTOR_PLAYER);
  endCutscene(P);
}
// DormRoomTile0F_13 (13:4EF4): stepping to the door once the varsity rank is won (before the Island Open): the
// roommate jumps up surprised (the "!" balloon over her), tells the news and bounces; the player jumps, nods, and
// they leave for the academy wing (entry $0D). In doubles the roommate follows the player.
export function* dormRoomTile0F(P) {
  nullScript(P, ACTOR_DORM_ROOM_KATE);
  yield* setText(P, Text_31_324);
  if (testFlag(P, FLAG_TEMP_SCENE_VARIANT_A)) yield* setText(P, Text_31_328);
  jumpVelocity(P, ACTOR_DORM_ROOM_KATE, -2.0);
  P.callRom(BANK, ComputeEmoteActorPosition_13, { a: ACTOR_DORM_ROOM_KATE });   // the balloon above her
  P.callRom(BANK, PlaceEmoteActorAtComputedPosition_13);
  sound(P, SFX_CHIME);
  yield* wait(P, 70);
  setPosition(P, ACTOR_DORM_ROOM_BALLOON_EXCLAIM, 63.0, 63.0);
  yield* speak(P, ACTOR_DORM_ROOM_KATE);
  faceToward(P, ACTOR_PLAYER, ACTOR_DORM_ROOM_KATE);
  faceToward(P, ACTOR_DORM_ROOM_KATE, ACTOR_PLAYER);
  setPosition(P, ACTOR_DORM_ROOM_SLOT_6, 12.0, 8.0);
  setAnim(P, ACTOR_DORM_ROOM_KATE, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_DORM_ROOM_KATE);
  setPosition(P, ACTOR_DORM_ROOM_SLOT_6, 63.0, 63.0);
  yield* speak(P, ACTOR_DORM_ROOM_KATE);
  jumpVelocity(P, ACTOR_PLAYER, -2.0);
  yield* waitJump(P, ACTOR_PLAYER);
  const doubles = testFlag(P, FLAG_DOUBLES);
  if (doubles) advanceText(P);
  yield* speak(P, ACTOR_DORM_ROOM_KATE);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  if (doubles) followPlayer(P, ACTOR_DORM_ROOM_KATE);
  setSpeed(P, ACTOR_PLAYER, 1.5);
  moveTarget(P, ACTOR_PLAYER, 11.0, 20.0);
  yield* wait(P, 10);
  if (!doubles) faceToward(P, ACTOR_PLAYER, ACTOR_DORM_ROOM_KATE);
  goToLocation(P, STORYLOC_ACADEMY_WING, 0x0D);
  fadeOut(P, 4);
  yield* wait(P, 20);
}

// DormRoomInitScript_13 (13:502A): no location name. The night's narrations (entries $0A, $09, $08); otherwise the
// story's rank tier, the room's variant (the partner's gender), the roommate's place, the step-on cells, then the
// scene of the entry: $0F the evening, $01 back from the academy, $02 the morning.
export function* dormRoomInitScript(P) {
  const { V } = P;
  V.storyModeShowLocationName = 0;
  switch (V.storyModeEntryPoint) {
    case 0x0A: return yield* dormRoomEntry0aScene(P);
    case 0x09: return yield* dormRoomEntry09Scene(P);
    case 0x08: return yield* dormRoomEntry08Scene(P);
  }
  P.callRom(BANK, ComputeStoryRankTier_13);
  yield* setupDormRoomSceneVariant(P);
  yield* placeDormRoomArrivalActors(P);
  setDormRoomEventTriggerCells(P);
  if (V.storyModeEntryPoint === 0x0F) return yield* dormRoomEntry0fScene(P);
  sound(P, BGM_DORM_ROOM);
  switch (V.storyModeEntryPoint) {
    case 0x01: return yield* dormRoomEntry01Scene(P);
    case 0x02: return yield* dormRoomEntry02Scene(P);
  }
  endCutscene(P);
}

// SetDormRoomEventTriggerCells_13 (13:5067): the step-on trigger 15 on the nine cells in front of the door while
// the varsity rank is won (singles rank 4, doubles rank 2) and the Island Open not reached; cleared otherwise.
// Returns the registers it leaves: the value and the last cell (a, d, e), F of the last flag test.
export function setDormRoomEventTriggerCells(P) {
  let on, last;
  if (!testFlag(P, FLAG_DOUBLES)) {
    on = (last = testFlag(P, FLAG_WON_VARSITY_SINGLES_RANK_4)) && !(last = testFlag(P, FLAG_REACHED_ISLAND_OPEN_SINGLES));
  } else {
    on = (last = testFlag(P, FLAG_WON_VARSITY_DOUBLES_RANK_2)) && !(last = testFlag(P, FLAG_REACHED_ISLAND_OPEN_DOUBLES));
  }
  const v = on ? DORM_TRIGGER : BEHAVIOR_NONE;
  for (const [col, row] of DORM_TRIGGER_CELLS) writeBehaviorCell(P, col, row, v);
  return { a: v, d: 12, e: 18, f: testFlagF(last) };
}

// SetupDormRoomSceneVariant (13:5130): with a partner of gender 0 the room is the other dorm room (variant A: the
// scene's right half copied over the left, collision and behaviour too; the roommate is Harry; the cat put away;
// the scroll limits of the smaller room) and the screen redrawn; otherwise the cat gets a random idle script.
export function* setupDormRoomSceneVariant(P) {
  const { V } = P;
  if (V.storyModeGenderOfPartnerCharacter) { setRandomDormRoomNpc04Script(P); return; }
  yield* waitPlayerMove(P);
  copyCollisionRect(P, 0x16, 0x16, 0x20, 0x00, 0x00, 0x00);
  copyBehaviorRect(P, 0x16, 0x16, 0x20, 0x00, 0x00, 0x00);
  yield* copySceneRect(P, 32, 0, 0, 0, 22, 24);
  setObjdef(P, OBJ_HARRY, ACTOR_DORM_ROOM_KATE);
  setAnim(P, ACTOR_DORM_ROOM_KATE, ANIM_WALK);
  setPosition(P, ACTOR_DORM_ROOM_CAT, 31.0, 21.0);
  nullScript(P, ACTOR_DORM_ROOM_CAT);
  setFlag(P, FLAG_TEMP_SCENE_VARIANT_A);
  V.mapScrollMinX = 0x02; V.mapScrollMinY = 0x02;
  V.mapWidthTiles = 0x16; V.mapHeightTiles = 0x14;
  disableLCDSafely(P);
  copySceneToVram(P, 0);
  enableLCD(P);
}

// PlaceDormRoomArrivalActors_13 (13:51B0): the roommate's place by the entry: with no entry point (back from a
// menu) in doubles she follows the player again; entry 1 at her place (in doubles the partner put away and she can
// be talked to); the others at her place, in doubles walking in from the door (.isDoubles).
export function* placeDormRoomArrivalActors(P) {
  const entry = P.V.storyModeEntryPoint;
  if (entry === STORYENTRY_NONE) {                                    // .stage3
    if (!testFlag(P, FLAG_DOUBLES)) return roommateAtHerPlace(P);
    nullScript(P, ACTOR_PARTNER);
    setPosition(P, ACTOR_PARTNER, 1.0, 1.0);
    P.callRom(BANK, PlaceRoommateAtPlayerTarget_13);
    followPlayer(P, ACTOR_DORM_ROOM_KATE);
    setActorFlag(P, ACTOR_DORM_ROOM_KATE, ACTORFLAG_TALKABLE);
    return;
  }
  if (entry === 0x01) {                                               // .stage2
    if (!testFlag(P, FLAG_DOUBLES)) return roommateAtHerPlace(P);
    roommateAtHerPlace(P);
    nullScript(P, ACTOR_PARTNER);
    setPosition(P, ACTOR_PARTNER, 1.0, 1.0);
    setActorFlag(P, ACTOR_DORM_ROOM_KATE, ACTORFLAG_TALKABLE);
    return;
  }
  P.wramBank(WRAM_ACTORS);
  if (testFlag(P, FLAG_DOUBLES)) return yield* placeDormRoomArrivalActorsIsDoubles(P);
  setPosition(P, ACTOR_DORM_ROOM_KATE, 11.0, 10.0);
}
// .stage2Singles: at her place, facing down
function roommateAtHerPlace(P) {
  setPosition(P, ACTOR_DORM_ROOM_KATE, 11.0, 10.0);
  face(P, ACTOR_DORM_ROOM_KATE, FACE_DOWN);
}
// PlaceDormRoomArrivalActors_13.isDoubles (13:527A): the partner put away; the roommate walks in from the door
export function* placeDormRoomArrivalActorsIsDoubles(P) {
  nullScript(P, ACTOR_PARTNER);
  setPosition(P, ACTOR_PARTNER, 21.0, 31.0);
  setPosition(P, ACTOR_DORM_ROOM_KATE, 11.0, 16.0);
  face(P, ACTOR_DORM_ROOM_KATE, FACE_UP);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  moveTarget(P, ACTOR_DORM_ROOM_KATE, 11.0, 10.0);
}
// SetRandomDormRoomNpc04Script_13 (13:524E): the cat runs one of its eight idle scripts, at random
export function setRandomDormRoomNpc04Script(P) {
  const i = (randomWord(P) & 0x07) * 2;
  setActorScript(P, ACTOR_DORM_ROOM_CAT, P.rom.u16(BANK, DormRoomNpc04IdleScripts_13 + i));
}

// DormRoomNpc03_13 (13:52B0): talking to the roommate: "any questions?" (the questions menu on yes), then the
// doubles prompt
export function* dormRoomNpc03(P) {
  faceToward(P, ACTOR_PLAYER, ACTOR_DORM_ROOM_KATE);
  yield* setText(P, testFlag(P, FLAG_TEMP_SCENE_VARIANT_A) ? Text_31_289 : Text_31_255);
  if ((yield* askYesNo(P, ACTOR_DORM_ROOM_KATE)) === YES) yield* runAcademyQuestionsMenu(P);
  yield* runPlayDoublesTodayPrompt(P);
}

// DormRoomEntry01Scene (13:52E7): back from the academy: at the Island Open stage the arrival cutscene; otherwise
// the roommate's word of the day (in doubles by the wins: the junior and senior doubles ranks move it on), the
// player nods, and in doubles she follows the player.
export function* dormRoomEntry01Scene(P) {
  if (getDormRoomStoryStage(P).a === 1) return yield* dormRoomArrivalCutscene(P);
  yield* setText(P, testFlag(P, FLAG_TEMP_SCENE_VARIANT_A) ? Text_31_263 : Text_31_258);
  nullScript(P, ACTOR_PARTNER);                                       // .placeActors
  setPosition(P, ACTOR_PARTNER, 11.0, 30.0);
  face(P, ACTOR_PARTNER, FACE_DOWN);
  roommateAtHerPlace(P);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  if (!testFlag(P, FLAG_DOUBLES)) {                                   // .speakShort
    yield* speak(P, ACTOR_DORM_ROOM_KATE);
    setAnim(P, ACTOR_PLAYER, ANIM_NOD);
    yield* waitIdle(P, ACTOR_PLAYER);
    return;
  }
  advanceText(P);
  if (!testFlag(P, FLAG_REACHED_ISLAND_OPEN_DOUBLES)) {
    yield* speak(P, ACTOR_DORM_ROOM_KATE);
    if (testFlag(P, FLAG_WON_JUNIOR_DOUBLES_RANK_1)) {
      advanceText(P);
      if (testFlag(P, FLAG_WON_SENIOR_DOUBLES_RANK_1)) advanceText(P);
    }
  }
  yield* speak(P, ACTOR_DORM_ROOM_KATE);                              // .speak
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  followPlayer(P, ACTOR_DORM_ROOM_KATE);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  setActorFlag(P, ACTOR_DORM_ROOM_KATE, ACTORFLAG_TALKABLE);
  yield* wait(P, 5);
}

// DormRoomEntry0fScene (13:53A1): the evening ("done for the day"): the player walks to the bed; the roommate's
// questions (two yes/no exchanges, a no to the first sets variant B), her pacing, the questions menu on a yes, and
// her good-night line by the room's variants.
export function* dormRoomEntry0fScene(P) {
  sound(P, JINGLE_DONE_FOR_THE_DAY);
  setSpeed(P, ACTOR_PLAYER, 0.5);
  playerSpeed(P, 2.0);
  yield* setText(P, testFlag(P, FLAG_TEMP_SCENE_VARIANT_A) ? Text_31_278 : Text_31_244);
  setPosition(P, ACTOR_PLAYER, 11.0, 14.0);                          // .bedScene
  setPosition(P, ACTOR_DORM_ROOM_KATE, 11.0, 10.0);
  yield* movePlayer(P, 11.0, 10.0);
  yield* waitPlayerMove(P);
  yield* wait(P, 120);
  yield* wait(P, 180);
  fadeIn(P, 4);
  yield* waitJingleEnd(P);
  sound(P, BGM_DORM_ROOM);
  yield* wait(P, 10);
  yield* answerOneOfTwo(P, () => setFlag(P, FLAG_TEMP_SCENE_VARIANT_B));
  setSpeed(P, ACTOR_DORM_ROOM_KATE, 0.5);                             // .roommateWalks
  setAnim(P, ACTOR_DORM_ROOM_KATE, ANIM_NOD);
  yield* waitIdle(P, ACTOR_DORM_ROOM_KATE);
  yield* speak(P, ACTOR_DORM_ROOM_KATE);
  moveTarget(P, ACTOR_DORM_ROOM_KATE, 9.0, 10.0);
  yield* speak(P, ACTOR_DORM_ROOM_KATE);
  yield* waitMove(P, ACTOR_DORM_ROOM_KATE);
  moveTarget(P, ACTOR_DORM_ROOM_KATE, 13.0, 10.0);
  yield* speak(P, ACTOR_DORM_ROOM_KATE);
  yield* waitMove(P, ACTOR_DORM_ROOM_KATE);
  moveTarget(P, ACTOR_DORM_ROOM_KATE, 11.0, 10.0);
  yield* waitMove(P, ACTOR_DORM_ROOM_KATE);
  faceToward(P, ACTOR_PLAYER, ACTOR_DORM_ROOM_KATE);
  yield* answerOneOfTwo(P, () => {});
  moveTarget(P, ACTOR_DORM_ROOM_KATE, 11.0, 11.0);                    // .continueScene
  yield* waitMove(P, ACTOR_DORM_ROOM_KATE);
  yield* roommateAnim(P, ANIM_BOUNCE);
  yield* speak(P, ACTOR_DORM_ROOM_KATE);
  yield* roommateAnim(P, ANIM_NOD);
  yield* speak(P, ACTOR_DORM_ROOM_KATE);
  yield* roommateAnim(P, ANIM_NOD);
  if ((yield* askYesNo(P, ACTOR_DORM_ROOM_KATE)) === YES) yield* runAcademyQuestionsMenu(P);
  const a = testFlag(P, FLAG_TEMP_SCENE_VARIANT_A), b = testFlag(P, FLAG_TEMP_SCENE_VARIANT_B);   // .sleepScene
  yield* wait(P, 20);
  yield* roommateAnim(P, ANIM_NOD);
  yield* setText(P, a ? (b ? Text_31_290 : Text_31_291) : (b ? Text_31_257 : Text_31_256));
  yield* speak(P, ACTOR_DORM_ROOM_KATE);
}
// a yes/no exchange of the roommate: yes, her answer then the other one skipped; no, the other one (and onNo)
function* answerOneOfTwo(P, onNo) {
  if ((yield* askYesNo(P, ACTOR_DORM_ROOM_KATE)) === YES) {
    yield* speak(P, ACTOR_DORM_ROOM_KATE);
    advanceText(P);
  } else {
    advanceText(P);
    yield* speak(P, ACTOR_DORM_ROOM_KATE);
    onNo();
  }
}
// script_set_anim ACTOR_DORM_ROOM_KATE, anim / script_wait_idle ACTOR_DORM_ROOM_KATE
function* roommateAnim(P, anim) {
  setAnim(P, ACTOR_DORM_ROOM_KATE, anim);
  yield* waitIdle(P, ACTOR_DORM_ROOM_KATE);
}

// DormRoomEntry02Scene (13:5593): the morning: the player gets up; the roommate's morning lines (their first id in
// wMapScratch: + 2, or + 5 from the Island Open stage); "done for the day?" yes: the jingle, the fade, exit 2 with
// the dorm room (entry 1) as the return point, the story saved; no: her questions and the doubles prompt.
export function* dormRoomEntry02Scene(P) {
  const { bus } = P, at = P.A.mapScratch;
  bus.w16(at, testFlag(P, FLAG_TEMP_SCENE_VARIANT_A) ? MORNING_TEXT_A : MORNING_TEXT_B);
  const first = () => bus.u16(at);
  yield* setText(P, first());
  if (testFlag(P, FLAG_DOUBLES)) advanceText(P);
  yield* wait(P, 30);                                                 // .dayStart
  moveTarget(P, ACTOR_PLAYER, 11.0, 14.0);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  yield* movePlayer(P, 11.0, 12.25);
  yield* waitPlayerMove(P);
  face(P, ACTOR_DORM_ROOM_KATE, FACE_DOWN);
  yield* roommateAnim(P, ANIM_NOD);
  yield* speak(P, ACTOR_DORM_ROOM_KATE);
  const stage = getDormRoomStoryStage(P).a;
  yield* setText(P, (first() + (stage ? 0x05 : 0x02)) & 0xFFFF);      // .dayText / .daySpeak
  yield* roommateAnim(P, ANIM_SHAKE);
  if ((yield* askYesNo(P, ACTOR_DORM_ROOM_KATE)) === YES) {
    yield* setText(P, (first() + 0x03) & 0xFFFF);                     // .dayEnd
    yield* speak(P, ACTOR_DORM_ROOM_KATE);
    sound(P, BGM_NONE);
    yield* wait(P, 2);
    sound(P, JINGLE_DONE_FOR_THE_DAY);
    setAnim(P, ACTOR_PLAYER, ANIM_NOD);
    yield* roommateAnim(P, ANIM_NOD);
    yield* waitJingleEnd(P);
    yield* fadeOutAndWait(P, 4);
    requestExit(P, 0x02);
    saveReturnPoint(P, STORYLOC_DORM_ROOM, 0x01);
    yield* P.runRom(BANK_SAVE, SaveStorySlotWithTimer);
    return;
  }
  yield* setText(P, (first() + 0x04) & 0xFFFF);                       // .finalText
  if ((yield* askYesNo(P, ACTOR_DORM_ROOM_KATE)) === YES) yield* runAcademyQuestionsMenu(P);
  yield* runPlayDoublesTodayPrompt(P);                                // .done
}

export const HOOKS = [
  [BANK, 0x4CDC, hook((P, c) => loadTourPointerSpriteGfx(P, { b: c.b, f: c.f }))],
  [BANK, 0x4CFF, hook((P, c) => queueTourPointerSprite(P, c.d, c.e))],
  [BANK, 0x4D0A, hook(P => animateTourPointerSprite(P))],
  scene(BANK, 0x4D78, animateDoorOpen),
  scene(BANK, 0x4DCC, animateDoorClose),
  scene(BANK, 0x4EA4, dormRoomNpc04),
  scene(BANK, 0x4ED4, dormRoomFacing01),
  scene(BANK, 0x4EF4, dormRoomTile0F),
  scene(BANK, 0x502A, dormRoomInitScript),
  [BANK, 0x5067, hook(P => setDormRoomEventTriggerCells(P))],
  scene(BANK, 0x5130, setupDormRoomSceneVariant),
  scene(BANK, 0x51B0, placeDormRoomArrivalActors),
  scene(BANK, 0x524E, P => (function* () { setRandomDormRoomNpc04Script(P); })()),
  scene(BANK, 0x527A, placeDormRoomArrivalActorsIsDoubles),
  scene(BANK, 0x52B0, dormRoomNpc03),
  scene(BANK, 0x52E7, dormRoomEntry01Scene),
  scene(BANK, 0x53A1, dormRoomEntry0fScene),
  scene(BANK, 0x5593, dormRoomEntry02Scene),
];
