// Bank $0E, $5005-$5937: the repair counter's return after an equipment change (the clerk checks what changed,
// hands it over or asks again), the player sprite's left-handed mirror; and Mario World: its NPCs' lines by the
// story stage, its init script by entry point (the arrival, the return, the cast placed), its progress index and
// the singles arrival (Toad and Peach's welcome, Bowser's challenge, Luigi defending the champion, the exhibition
// demand, the offer). The actor scripts, Mario World's map tables and NPC records are data.
// Port of src/story/mario_world_0e.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss2_mw*.mtrec (scripted: Mario World, the first visit in singles, its NPCs),
// ss2_repair*.mtrec (the counter's returns); tests: web/tests/port/routines_story_scripts2.mjs.
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FACE_RIGHT, FACE_DOWN, FACE_LEFT, FACE_UP, ANIM_BOUNCE, ANIM_NOD, ANIM_WALK,
  FLAG_DOUBLES, SPEAKER_NONE, FZ, FN, FH, FC, testFlag, testFlagF, setFlag, setText, speak, askYesNo, setAnim,
  waitIdle, wait, face, faceToward, setPosition, moveTarget, waitMove, movePlayer, waitPlayerMove, setSpeed,
  playerSpeed, setActorScript, nullScript, menuFromText, fadeIn, waitFadeEnd, sound, requestExit, actorState, hook,
  scene,
} from "./common.js";
import { pushTextArgFetchedString } from "./shared2.js";
import {
  repairCounterServiceMenu, repairCounterFarewell, repairCounterChangeRackets, repairCounterChangeShoes,
  pushEquipmentNameTextArg, initEquipmentHandoutDialogue,
} from "./repair_0e.js";
import {
  marioWorldEntry0eScene, marioWorldEntry0eSingles, placeMarioWorldActors, marioWorldArrivalIntroCutscene,
  marioWorldWelcomeCutscene, marioWorldLuigiDefendsChampCutscene, marioWorldExhibitionDemandCutscene,
} from "./mario_scenes_0e.js";
import { exhibitionAcceptedSingles, marioWorldArrivalDoubles } from "./exhibition_0e.js";
import { exhibitionDeclinedCutscene } from "./specialcourt_0e.js";

const BANK = 0x0E;
const ACTOR_TRAINING_GYM_WALK_72_02_2 = 0x0E;         // the repair counter's clerk
// Mario World's actors (MarioWorldActors_0e)
const ACTOR_MARIO_WORLD_BALLOON_SWEAT_1 = 0x04, ACTOR_MARIO_WORLD_BALLOON_SWEAT_2 = 0x05;
const ACTOR_MARIO_WORLD_BALLOON_SWEAT_3 = 0x06, ACTOR_MARIO_WORLD_BALLOON_ANGRY = 0x07, ACTOR_MARIO_WORLD_PEACH = 0x08;
const ACTOR_MARIO_WORLD_YOSHI = 0x09, ACTOR_MARIO_WORLD_BABY_MARIO = 0x0A, ACTOR_MARIO_WORLD_LUIGI = 0x0B;
const ACTOR_MARIO_WORLD_DK = 0x0C, ACTOR_MARIO_WORLD_BOO = 0x0D, ACTOR_MARIO_WORLD_WALUIGI = 0x0E;
const ACTOR_MARIO_WORLD_BOWSER = 0x0F, ACTOR_MARIO_WORLD_WARIO = 0x10, ACTOR_MARIO_WORLD_WALK_77_05 = 0x11;
const ACTOR_MARIO_WORLD_MARIO = 0x12, ACTOR_MARIO_WORLD_TOAD = 0x13, ACTOR_MARIO_WORLD_BOB_OMB = 0x14;
const ANIM_SWING_BACK = 0x09;
const FLAG_WON_DREAM_MATCH_DOUBLES = 0x34, FLAG_WON_DREAM_MATCH_SINGLES = 0x3B, FLAG_WON_SENIOR_SINGLES_RANK_1 = 0x57;
const FLAG_ENDING_CREDITS_RUNNING = 0x6E, FLAG_REPAIR_COUNTER_EQUIP_CHANGED = 0x7F;
const FLAG_REACHED_MARIO_WORLD_SINGLES = 0xB2, FLAG_REACHED_MARIO_WORLD_DOUBLES = 0xB3;
const SFX_THUD = 0x86, SFX_VOICE_YOSHI = 0x87, SFX_PEACH_FANFARE = 0x88, SFX_VOICE_BABY_MARIO = 0x89, SFX_APPEAR2 = 0x96;
const Text_1f_1 = 0x2401, Text_6e_232 = 0x20E8, Text_6e_236 = 0x20EC, Text_6e_239 = 0x20EF, Text_6e_241 = 0x20F1;
const Text_6e_242 = 0x20F2, Text_5e_75 = 0x304B, Text_5e_96 = 0x3060, Text_5e_142 = 0x308E, Text_5e_143 = 0x308F;
const Text_5e_147 = 0x3093, Text_5e_151 = 0x3097, Text_5e_152 = 0x3098, Text_5e_153 = 0x3099, Text_5e_154 = 0x309A;
const Text_5e_155 = 0x309B, Text_5e_159 = 0x309F, Text_5e_163 = 0x30A3, Text_5e_167 = 0x30A7, Text_5e_168 = 0x30A8;
const ActorScript_0e_03 = 0x51D7, ActorScript_0e_04 = 0x51E4;
const SHORT_TEXT_COUNTER = 0x00E6;                     // the counter's name (FetchAndPushShortTextArg)
const MENU_CANCELLED = 0xFF, MENU_RACKETS = 0, MENU_LEAVE = 2;
const SCRATCH_RACKET = 8, SCRATCH_CHOICE = 10;
const SaveStorySlotWithTimer = [0x03, 0x4D10];
const OFFSTAGE = 63.0;
const ACTORF_SPRITE_ATTR = 0x37, OAM_XFLIP = 0x20;
const scratch = (P, off) => P.bus.u8(P.A.mapScratch + off);

// CompareEquippedRacketToMinigameFlag (0E:5005): a = $FF when the racket is the one before the change (wMapScratch
// + 8), else 0; b = that racket, F of the `cp`
export function compareEquippedRacketToMinigameFlag(P) {
  const b = scratch(P, SCRATCH_RACKET), v = P.V.equippedRacket;
  const f = (v === b ? FZ : 0) | FN | ((v & 0xF) < (b & 0xF) ? FH : 0) | (v < b ? FC : 0);
  return { a: v === b ? 0xFF : 0, b, f };
}
// RepairCounterCheckEquipChanged (0E:5015): faded in at the counter. Nothing changed: "anything wrong with the
// <equipment>?" (yes: the service menu's choice taken up again). Changed: the old one handed back, the new one's
// line; then "anything else?" (yes: the service menu, no: goodbye)
export function* repairCounterCheckEquipChanged(P) {
  P.V.storyModeShowLocationName = 0;
  fadeIn(P, 8);
  yield* waitFadeEnd(P);
  if (compareEquippedRacketToMinigameFlag(P).a === 0xFF) {
    yield* setText(P, (Text_1f_1 + scratch(P, SCRATCH_CHOICE)) & 0xFFFF);
    pushEquipmentNameTextArg(P);
    if ((yield* askYesNo(P, ACTOR_TRAINING_GYM_WALK_72_02_2)) === 0) return yield* repairCounterServiceMenu(P, scratch(P, SCRATCH_CHOICE));
  } else {
    P.bus.w8(P.A.mapScratch + SCRATCH_RACKET, P.V.equippedRacket);  // .repairRacket
    yield* initEquipmentHandoutDialogue(P);
    yield* speak(P, ACTOR_TRAINING_GYM_WALK_72_02_2);
    yield* showEquipChangeConfirmation(P);
    setFlag(P, FLAG_REPAIR_COUNTER_EQUIP_CHANGED);
    faceToward(P, ACTOR_PLAYER, ACTOR_TRAINING_GYM_WALK_72_02_2);
    yield* setText(P, Text_6e_241);
    pushEquipmentNameTextArg(P);
    yield* speak(P, ACTOR_TRAINING_GYM_WALK_72_02_2);
  }
  yield* setText(P, Text_6e_242);                                    // .noChange
  if ((yield* askYesNo(P, ACTOR_TRAINING_GYM_WALK_72_02_2)) === 0) return yield* repairCounterServiceMenu(P);
  return yield* repairCounterFarewell(P);
}
// RepairCounterChangedReturnA / B (0E:509F / 0E:50B3): back from a change (entry $0B: the partner placed; $0C: the
// player walked to the counter), the service menu reopened
export function* repairCounterChangedReturnA(P) {
  P.V.mapSceneStage2 = 0x0B;
  setPosition(P, ACTOR_PARTNER, 15.0, 15.0);
  return yield* repairCounterReopenServiceMenu(P);
}
export function* repairCounterChangedReturnB(P) {
  P.V.mapSceneStage2 = 0x0C;
  yield* waitPlayerMove(P);
  playerSpeed(P, 7.5);
  yield* movePlayer(P, 13.0, 19.0);
  yield* waitPlayerMove(P);
  setPosition(P, ACTOR_PARTNER, 19.0, 19.0);
  return yield* repairCounterReopenServiceMenu(P);
}
// RepairCounterReopenServiceMenu (0E:50DD): faded in at the counter, its service menu (as RepairCounterServiceMenu)
export function* repairCounterReopenServiceMenu(P) {
  P.V.storyModeShowLocationName = 0;
  yield* setText(P, Text_6e_239);
  pushTextArgFetchedString(P, SHORT_TEXT_COUNTER);
  setFlag(P, FLAG_REPAIR_COUNTER_EQUIP_CHANGED);
  faceToward(P, ACTOR_PLAYER, ACTOR_TRAINING_GYM_WALK_72_02_2);
  fadeIn(P, 8);
  yield* waitFadeEnd(P);
  const c = yield* menuFromText(P, Text_6e_236, 1, 1);
  P.bus.w8(P.A.mapScratch + SCRATCH_CHOICE, c);
  if (c === MENU_CANCELLED || c === MENU_LEAVE) return yield* repairCounterFarewell(P);
  if (c === MENU_RACKETS) return yield* repairCounterChangeRackets(P);
  if (testFlag(P, FLAG_WON_SENIOR_SINGLES_RANK_1)) return yield* repairCounterChangeShoes(P);
  yield* setText(P, Text_6e_232);
  yield* speak(P, ACTOR_TRAINING_GYM_WALK_72_02_2);
  yield* setText(P, Text_6e_242);
  if ((yield* askYesNo(P, ACTOR_TRAINING_GYM_WALK_72_02_2)) === 0) return yield* repairCounterServiceMenu(P);
  return yield* repairCounterFarewell(P);
}
// ShowEquipChangeConfirmation (0E:5153): the change's message (Text_6e_239 + choice) with the equipment's name; a
// racket: the player swings it (mirrored for a left-hander) on ActorScript_0e_03; shoes: ActorScript_0e_04 at speed
// 1; the clerk turns to the player
export function* showEquipChangeConfirmation(P) {
  yield* setText(P, (Text_6e_239 + scratch(P, SCRATCH_CHOICE)) & 0xFFFF);
  pushEquipmentNameTextArg(P);
  if (!scratch(P, SCRATCH_CHOICE)) {
    mirrorPlayerSpriteIfLeftHanded(P);
    setAnim(P, ACTOR_PLAYER, ANIM_SWING_BACK);
    face(P, ACTOR_PLAYER, FACE_DOWN);
    setActorScript(P, ACTOR_PLAYER, ActorScript_0e_03);
    yield* speak(P, SPEAKER_NONE | 12);
    nullScript(P, ACTOR_PLAYER);
    setAnim(P, ACTOR_PLAYER, ANIM_WALK);
    faceToward(P, ACTOR_TRAINING_GYM_WALK_72_02_2, ACTOR_PLAYER);
    mirrorPlayerSpriteIfLeftHanded(P);
    return;
  }
  face(P, ACTOR_PLAYER, FACE_DOWN);                                  // .handOver
  setActorScript(P, ACTOR_PLAYER, ActorScript_0e_04);
  yield* speak(P, SPEAKER_NONE | 12);
  nullScript(P, ACTOR_PLAYER);
  setAnim(P, ACTOR_PLAYER, ANIM_WALK);
  setSpeed(P, ACTOR_PLAYER, 1.0);
  faceToward(P, ACTOR_TRAINING_GYM_WALK_72_02_2, ACTOR_PLAYER);
}
// MirrorPlayerSpriteIfLeftHanded (0E:520F, src/twins/mirror_player_sprite_if_left_handed.asm): for a left-handed
// player, the player's sprite attributes' x flip toggled. Returns a, F (of the `xor` or the `and`), bc = the
// record, hl = the attribute byte.
export function mirrorPlayerSpriteIfLeftHanded(P) {
  const left = P.V.storyModeMainCharacterLeftHanded;
  if (!left) return { a: 0, f: FZ | FH };
  const bc = actorState(P, ACTOR_PLAYER), hl = (bc + ACTORF_SPRITE_ATTR) & 0xFFFF;
  const a = P.bus.u8(hl) ^ OAM_XFLIP;
  P.bus.w8(hl, a);
  return { a, f: a ? 0 : FZ, bc, hl };
}
// the NPCs: a line, or one by the story stage (text + wMapSceneStage), with a voice for some
function* npcLine(P, actor, text, byStage = false, voice = null) {
  yield* setText(P, byStage ? (text + P.V.mapSceneStage) & 0xFFFF : text);
  if (voice !== null) sound(P, voice);
  yield* speak(P, actor);
}
// MarioWorldInitScript_0e (0E:54D2): the progress index; entries $0A and $0F the arrival (singles; doubles from
// it), $0E the return scene; else, once Mario World was reached (singles or doubles), the player walks in from the
// gate (unless entering keeping the position) and the cast is placed
export function* marioWorldInitScript(P) {
  computeMarioWorldProgressIndex(P);
  const entry = P.V.storyModeEntryPoint;
  if (entry === 0x0A || entry === 0x0F) return yield* marioWorldArrivalSingles(P);
  if (entry === 0x0E) return yield* marioWorldEntry0eScene(P);
  if (!testFlag(P, testFlag(P, FLAG_DOUBLES) ? FLAG_REACHED_MARIO_WORLD_DOUBLES : FLAG_REACHED_MARIO_WORLD_SINGLES)) return;
  if (((P.V.storyModeEntryPoint + 1) & 0xFF) !== 0) {
    setSpeed(P, ACTOR_PLAYER, 0.625);
    moveTarget(P, ACTOR_PLAYER, 18.0, 29.0);
  }
  placeMarioWorldActors(P);
}
// ComputeMarioWorldProgressIndex (0E:555D): wMapSceneStage = 0 / 1 (singles, the dream match won), 2 / 3 (doubles).
// Returns a and F (the flag test's, or of the `inc a` after it).
export function computeMarioWorldProgressIndex(P) {
  const doubles = testFlag(P, FLAG_DOUBLES);
  let a = doubles ? 2 : 0;
  const won = testFlag(P, doubles ? FLAG_WON_DREAM_MATCH_DOUBLES : FLAG_WON_DREAM_MATCH_SINGLES);
  if (won) a++;
  P.V.mapSceneStage = a;
  return { a, f: won ? 0 : testFlagF(false) };
}
// MarioWorldArrivalSingles (0E:5579): in doubles the doubles arrival; on a return (not during the credits) the
// return scene; else the first visit: the intro walk and Toad's welcome, up the path to Peach (during the credits:
// to exit 1), the welcome, Bowser's challenge, Luigi defends the champion, the exhibition demand, the villains step
// aside; Mario World reached and the game saved; Peach's offer (yes: the exhibition; no: the declined scene)
export function* marioWorldArrivalSingles(P) {
  if (testFlag(P, FLAG_DOUBLES)) return yield* marioWorldArrivalDoubles(P);
  const credits = () => testFlag(P, FLAG_ENDING_CREDITS_RUNNING);
  if (!credits() && testFlag(P, FLAG_REACHED_MARIO_WORLD_SINGLES)) return yield* marioWorldEntry0eSingles(P);
  setPosition(P, ACTOR_PLAYER, OFFSTAGE, OFFSTAGE);                  // .arrive
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  yield* wait(P, 40);
  yield* marioWorldArrivalIntroCutscene(P);
  setPosition(P, ACTOR_PLAYER, 18.0, 37.0);
  setSpeed(P, ACTOR_PLAYER, 0.5);
  moveTarget(P, ACTOR_PLAYER, 18.0, 32.5);
  playerSpeed(P, 0.5);
  yield* movePlayer(P, 18.0, 27.0);
  yield* wait(P, 80);
  face(P, ACTOR_MARIO_WORLD_TOAD, FACE_UP);
  yield* wait(P, 10);
  if (!credits()) {
    yield* setText(P, Text_5e_75);
    yield* speak(P, ACTOR_MARIO_WORLD_TOAD);
    yield* speak(P, ACTOR_MARIO_WORLD_TOAD);
  }
  playerSpeed(P, 1.0);                                               // .walkIn
  yield* movePlayer(P, 18.0, 24.0);
  yield* waitPlayerMove(P);
  yield* wait(P, 10);
  setAnim(P, ACTOR_MARIO_WORLD_PEACH, ANIM_NOD);
  yield* waitIdle(P, ACTOR_MARIO_WORLD_PEACH);
  if (!credits()) yield* speak(P, ACTOR_MARIO_WORLD_PEACH);
  playerSpeed(P, 0.625);                                             // .approach
  setSpeed(P, ACTOR_PLAYER, 0.625);
  setSpeed(P, ACTOR_MARIO_WORLD_TOAD, 0.625);
  setSpeed(P, ACTOR_MARIO_WORLD_PEACH, 0.625);
  moveTarget(P, ACTOR_PLAYER, 18.0, 17.0);
  moveTarget(P, ACTOR_MARIO_WORLD_TOAD, 18.0, 23.0);
  yield* wait(P, 40);
  yield* movePlayer(P, 18.0, 13.0);
  yield* waitMove(P, ACTOR_MARIO_WORLD_TOAD);
  moveTarget(P, ACTOR_MARIO_WORLD_PEACH, 18.0, 9.0);
  moveTarget(P, ACTOR_MARIO_WORLD_TOAD, 18.0, 19.0);
  yield* waitMove(P, ACTOR_MARIO_WORLD_TOAD);
  moveTarget(P, ACTOR_MARIO_WORLD_TOAD, 13.0, 19.0);
  yield* waitMove(P, ACTOR_MARIO_WORLD_PEACH);
  if (credits()) {
    face(P, ACTOR_MARIO_WORLD_PEACH, FACE_DOWN);
    yield* wait(P, 20);
    requestExit(P, 0x01);
    return;
  }
  yield* marioWorldWelcomeCutscene(P);                               // .done
  setSpeed(P, ACTOR_MARIO_WORLD_BOWSER, 1.0);
  setSpeed(P, ACTOR_MARIO_WORLD_BALLOON_ANGRY, 1.0);
  yield* wait(P, 40);
  setAnim(P, ACTOR_MARIO_WORLD_BOWSER, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_MARIO_WORLD_BOWSER);
  moveTarget(P, ACTOR_MARIO_WORLD_BOWSER, 15.0, 14.0);
  moveTarget(P, ACTOR_MARIO_WORLD_BALLOON_ANGRY, 16.0, 12.0);
  yield* waitMove(P, ACTOR_MARIO_WORLD_BALLOON_ANGRY);
  setPosition(P, ACTOR_MARIO_WORLD_BALLOON_ANGRY, OFFSTAGE, OFFSTAGE);
  face(P, ACTOR_MARIO_WORLD_BOWSER, FACE_UP);
  yield* wait(P, 20);
  yield* speak(P, ACTOR_MARIO_WORLD_BOWSER);
  yield* wait(P, 20);
  setSpeed(P, ACTOR_MARIO_WORLD_WARIO, 1.0);
  setSpeed(P, ACTOR_MARIO_WORLD_WALUIGI, 1.0);
  // the three step up one by one (to the right, then up): Bowser, Wario, Waluigi, twice
  const stepUp = function* (actor, x, y, after) {
    face(P, actor, FACE_RIGHT);
    moveTarget(P, actor, x, y);
    yield* waitMove(P, actor);
    face(P, actor, FACE_UP);
    yield* wait(P, after);
  };
  moveTarget(P, ACTOR_MARIO_WORLD_BOWSER, 16.0, 13.0);
  yield* waitMove(P, ACTOR_MARIO_WORLD_BOWSER);
  yield* wait(P, 10);
  yield* stepUp(ACTOR_MARIO_WORLD_WARIO, 13.0, 13.0, 10);
  yield* stepUp(ACTOR_MARIO_WORLD_WALUIGI, 14.0, 16.0, 40);
  sound(P, SFX_APPEAR2);
  setPosition(P, ACTOR_MARIO_WORLD_BALLOON_SWEAT_1, 15.0, 9.0);
  yield* wait(P, 4);
  sound(P, SFX_APPEAR2);
  setPosition(P, ACTOR_MARIO_WORLD_BALLOON_SWEAT_2, 19.0, 7.0);
  yield* wait(P, 4);
  sound(P, SFX_APPEAR2);
  setPosition(P, ACTOR_MARIO_WORLD_BALLOON_SWEAT_3, 23.0, 9.0);
  yield* wait(P, 4);
  yield* stepUp(ACTOR_MARIO_WORLD_BOWSER, 17.0, 13.0, 10);
  yield* stepUp(ACTOR_MARIO_WORLD_WARIO, 15.0, 13.0, 10);
  yield* stepUp(ACTOR_MARIO_WORLD_WALUIGI, 17.0, 15.0, 10);
  yield* marioWorldLuigiDefendsChampCutscene(P);
  sound(P, SFX_APPEAR2);
  setPosition(P, ACTOR_MARIO_WORLD_BALLOON_SWEAT_1, 19.5, 15.5);
  yield* wait(P, 20);
  face(P, ACTOR_MARIO_WORLD_MARIO, FACE_LEFT);
  yield* wait(P, 40);
  setAnim(P, ACTOR_MARIO_WORLD_PEACH, ANIM_NOD);
  setAnim(P, ACTOR_MARIO_WORLD_MARIO, ANIM_NOD);
  yield* waitIdle(P, ACTOR_MARIO_WORLD_MARIO);
  yield* wait(P, 10);
  face(P, ACTOR_MARIO_WORLD_PEACH, FACE_DOWN);
  yield* wait(P, 10);
  setSpeed(P, ACTOR_MARIO_WORLD_PEACH, 1.0);
  moveTarget(P, ACTOR_MARIO_WORLD_PEACH, 18.0, 11.0);
  yield* waitMove(P, ACTOR_MARIO_WORLD_PEACH);
  face(P, ACTOR_MARIO_WORLD_WALK_77_05, FACE_DOWN);
  face(P, ACTOR_MARIO_WORLD_MARIO, FACE_DOWN);
  setPosition(P, ACTOR_MARIO_WORLD_BALLOON_SWEAT_1, OFFSTAGE, OFFSTAGE);
  yield* speak(P, ACTOR_MARIO_WORLD_PEACH);
  yield* wait(P, 10);
  yield* marioWorldExhibitionDemandCutscene(P);
  moveTarget(P, ACTOR_MARIO_WORLD_BOWSER, 19.0, 15.0);
  moveTarget(P, ACTOR_MARIO_WORLD_WARIO, 17.0, 15.0);
  moveTarget(P, ACTOR_MARIO_WORLD_WALUIGI, 20.0, 17.0);
  yield* waitMove(P, ACTOR_MARIO_WORLD_WALUIGI);
  moveTarget(P, ACTOR_MARIO_WORLD_WALUIGI, 19.0, 19.0);
  yield* waitMove(P, ACTOR_MARIO_WORLD_WALUIGI);
  face(P, ACTOR_MARIO_WORLD_WALUIGI, FACE_UP);
  yield* wait(P, 40);
  setFlag(P, FLAG_REACHED_MARIO_WORLD_SINGLES);
  yield* P.runRom(...SaveStorySlotWithTimer);
  if ((yield* askYesNo(P, ACTOR_MARIO_WORLD_PEACH)) === 0) return yield* exhibitionAcceptedSingles(P);
  yield* setText(P, Text_5e_96);
  yield* exhibitionDeclinedCutscene(P);
}

export const HOOKS = [
  [BANK, 0x5005, hook(P => compareEquippedRacketToMinigameFlag(P))],
  scene(BANK, 0x5015, repairCounterCheckEquipChanged),
  scene(BANK, 0x509F, repairCounterChangedReturnA),
  scene(BANK, 0x50B3, repairCounterChangedReturnB),
  scene(BANK, 0x50DD, repairCounterReopenServiceMenu),
  scene(BANK, 0x5153, showEquipChangeConfirmation),
  [BANK, 0x520F, hook(P => mirrorPlayerSpriteIfLeftHanded(P))],
  scene(BANK, 0x538E, P => npcLine(P, ACTOR_MARIO_WORLD_MARIO, Text_5e_142)),              // MarioWorldNpc12Mario_0e
  scene(BANK, 0x539A, P => npcLine(P, ACTOR_MARIO_WORLD_WALK_77_05, Text_5e_143, true)),   // MarioWorldNpc11_0e
  scene(BANK, 0x53AE, P => npcLine(P, ACTOR_MARIO_WORLD_LUIGI, Text_5e_147, true)),        // MarioWorldNpc0BLuigi_0e
  scene(BANK, 0x53C2, P => npcLine(P, ACTOR_MARIO_WORLD_YOSHI, Text_5e_151, false, SFX_VOICE_YOSHI)),
  scene(BANK, 0x53D0, P => npcLine(P, ACTOR_MARIO_WORLD_BABY_MARIO, Text_5e_152, false, SFX_VOICE_BABY_MARIO)),
  scene(BANK, 0x53DE, P => npcLine(P, ACTOR_MARIO_WORLD_DK, Text_5e_153, false, SFX_PEACH_FANFARE)),   // MarioWorldNpc0C_0e
  scene(BANK, 0x53EC, P => npcLine(P, ACTOR_MARIO_WORLD_BOO, Text_5e_154, false, SFX_THUD)),           // MarioWorldNpc0D_0e
  scene(BANK, 0x53FA, P => npcLine(P, ACTOR_MARIO_WORLD_BOWSER, Text_5e_155, true)),       // MarioWorldNpc0FBowser_0e
  scene(BANK, 0x540E, P => npcLine(P, ACTOR_MARIO_WORLD_WARIO, Text_5e_159, true)),        // MarioWorldNpc10Wario_0e
  scene(BANK, 0x5422, P => npcLine(P, ACTOR_MARIO_WORLD_WALUIGI, Text_5e_163, true)),      // MarioWorldNpc0EWaluigi_0e
  scene(BANK, 0x5436, P => npcLine(P, ACTOR_MARIO_WORLD_TOAD, Text_5e_167)),               // MarioWorldNpc13_0e
  scene(BANK, 0x5442, P => npcLine(P, ACTOR_MARIO_WORLD_BOB_OMB, Text_5e_168)),            // MarioWorldNpc14_0e
  [BANK, 0x54D1, hook(() => {})],                                                          // Unused_0e_StubNop
  scene(BANK, 0x54D2, marioWorldInitScript),
  [BANK, 0x555D, hook(P => computeMarioWorldProgressIndex(P))],
  scene(BANK, 0x5579, marioWorldArrivalSingles),
];
