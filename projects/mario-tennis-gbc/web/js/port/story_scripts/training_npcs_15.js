// The training court's people (bank $15, $4D07-$55E1): the water sprite's swing contest and its racket reward
// (silver from 100 swings, gold from 150), the serve, net and stroke challengers and coaches (which match or lesson
// comes next, or the coach's line while a lesson waits), the court's init script (the rank tier, the intro tour,
// the challengers hidden, then the result of the match or practice just played) and the re-entry scenes that set
// the party on the court it played. The map-script tables and the jump tables are data.
// Port of src/story/training_npcs_15.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss1_coach*.mtrec, out/port/ss2_lesson*.mtrec (the coaches, the results and re-entries),
// out/port/ss2_watersprite*.mtrec (scripted: the swing contest, the silver and the gold racket).
import {
  ACTOR_PARTNER, ACTOR_PLAYER, ANIM_BOUNCE, ANIM_NOD, FACE_DOWN, FACE_LEFT, FACE_RIGHT, FACE_UP, actorState,
  advanceText, face, fadeIn, fadeOutAndWait, jumpTableTarget, jumpVelocity, loadPalettesImmediate, lockFacing,
  movePlayer, movePlayerToActor, moveTarget, nullScript, playerSpeed, rd, scene, setActive, setAnim, setFlag,
  setObjdef, setPosition, setSpeed, setText, sound, speak, testFlag, unlockFacing, wait, waitFadeEnd, waitIdle,
  waitJump, waitMove, waitPlayerMove,
} from "./common.js";
import { computeStoryRankTier } from "./twins.js";
import {
  serviceAceMatchChallengeScene, centerLineServeMatchChallengeScene, academyRulesServeMatchChallengeScene,
  serveCoachJuniorLessonScene, serveCoachSeniorLessonScene, serveCoachVarsityLessonScene,
} from "./serve_coach_15.js";
import {
  volleyMatchChallengeScene, smashMatchChallengeScene, dropShotMatchChallengeScene, strokeMatchChallengeScene,
  lobMatchChallengeScene, returnMatchChallengeScene, returnCoachReturnLessonScene, returnCoachLobLessonScene,
  returnCoachPassingShotLessonScene,
} from "./challenge_scenes_15.js";
import {
  netCoachVolleyLessonScene, netCoachSmashLessonScene, netCoachDropShotLessonScene, hideServeChallengerActor,
  hideStrokeChallengerActor, hideNetChallengerActor,
} from "./coach_lessons_15.js";
import { walkChallengerOntoCourt } from "./challenger_15.js";
import { placeSwingPracticeKidActor, startPendingLessonScene } from "./practice_results_15.js";
import { waterSpriteSwingContestScene, trainingCourtIntroTourScene } from "./water_15.js";

const BANK = 0x15;
const ACTOR_TRAINING_COURT_CURT = 0x07, ACTOR_TRAINING_COURT_BOB_2 = 0x0D, ACTOR_TRAINING_COURT_BETH = 0x12;
const ACTOR_TRAINING_COURT_WALK_71_06_3 = 0x13, ACTOR_TRAINING_COURT_WALK_76_06 = 0x14;
const ACTOR_TRAINING_COURT_RACKET = 0x15, ACTOR_TRAINING_COURT_BALLOON_SCRIBBLE = 0x16;
const ACTOR_TRAINING_COURT_BALLOON_SWEAT = 0x17;
const SPRITE = ACTOR_TRAINING_COURT_WALK_76_06, RACKET = ACTOR_TRAINING_COURT_RACKET;
const ACTORF_OAM_ATTR = 0x37;
const FLAG_CLEARED_SERVICE_MATCH_1 = 0xC0, FLAG_CLEARED_SERVICE_MATCH_2 = 0xC1;
const FLAG_CLEARED_SERVICE_PRACTICE_1 = 0xC3, FLAG_CLEARED_SERVICE_PRACTICE_2 = 0xC4;
const FLAG_CLEARED_SERVICE_PRACTICE_3 = 0xC5, FLAG_CLEARED_NET_GAME_MATCH_1 = 0xC6;
const FLAG_CLEARED_NET_GAME_MATCH_2 = 0xC7, FLAG_CLEARED_NET_GAME_PRACTICE_1 = 0xC9;
const FLAG_CLEARED_NET_GAME_PRACTICE_2 = 0xCA, FLAG_CLEARED_NET_GAME_PRACTICE_3 = 0xCB;
const FLAG_CLEARED_STROKE_MATCH_1 = 0xCC, FLAG_CLEARED_STROKE_MATCH_2 = 0xCD;
const FLAG_CLEARED_STROKE_PRACTICE_1 = 0xCF, FLAG_CLEARED_STROKE_PRACTICE_2 = 0xD0;
const FLAG_CLEARED_STROKE_PRACTICE_3 = 0xD1;
const FLAG_HAVE_SILVER_RACKET = 0x64, FLAG_HAVE_GOLD_RACKET = 0x65;
const FLAG_WON_JUNIOR_SINGLES_RANK_1 = 0x53, FLAG_WON_SENIOR_SINGLES_RANK_1 = 0x57;
const FLAG_SERVE_COACH_GREETED = 0xBD, FLAG_NET_COACH_GREETED = 0xBE, FLAG_RETURN_COACH_GREETED = 0xBF;
const OBJ_BALLOON_EXCLAIM = 0x4C, OBJ_BALLOON_QUESTION = 0x4D;
const SFX_WATER_SPRITE_MAGIC = 0x8A, SFX_WATER_SPRITE_APPEAR = 0x8E, SFX_WATER_SPRITE_FLY = 0x8F;
const SFX_RACKET_GET = 0x90, SFX_APPEAR2 = 0x96, SFX_CHIME = 0x97, SFX_EMOTE = 0x98;
const RACKET_GOLD = 0x04, RACKET_SILVER = 0x05;          // wEquippedRacket's low nibble
const SILVER_SWINGS = 100, GOLD_SWINGS = 150;
const MINIGAME_TENNIS_MACHINE_1 = 0x12;                  // the drills below it are the training court's
const ENTRY_TOUR = 0x0F, ENTRY_PENDING_LESSON = 0x09, ENTRY_RESULT = 0x0A;
const Text_36_675 = 0x1AA3, Text_36_677 = 0x1AA5, Text_36_683 = 0x1AAB, Text_37_33 = 0x1C21, Text_37_34 = 0x1C22;
const Text_37_50 = 0x1C32, Text_37_61 = 0x1C3D, Text_37_128 = 0x1C80, Text_37_131 = 0x1C83, Text_37_156 = 0x1C9C;
const Text_37_158 = 0x1C9E, Text_37_187 = 0x1CBB, Text_37_225 = 0x1CE1, Text_37_226 = 0x1CE2, Text_37_248 = 0x1CF8;
const Text_6e_18 = 0x2012;
// data of this bank (read from the ROM)
const WaterSpriteRacketRewardScenePalettes0 = 0x5910, WaterSpriteRacketRewardScenePalettes1 = 0x5950;
const WaterSpriteRacketRewardScenePalettes2 = 0x5990;
const TrainingCourtResultScenes = 0x5385;                // TrainingCourtResultDispatch's jump table

const hide = (P, actor) => setPosition(P, actor, 63.0, 63.0);
const drill = P => rd(P, "currentMinigameStoryMatch", 1);

// RunWaterSpriteSwingContestAndReward (15:4D07): (the player's record byte $18 set) the player walks to the
// fountain (51, 12) and speaks; the contest; without a racket from it yet and with 100 swings or more, the reward
export function* runWaterSpriteSwingContestAndReward(P) {
  P.bus.w8((actorState(P, ACTOR_PLAYER) + 0x18) & 0xFFFF, 0x01);
  yield* movePlayerToActor(P, ACTOR_PLAYER);
  yield* waitPlayerMove(P);
  yield* movePlayer(P, 51.0, 12.0);
  yield* waitPlayerMove(P);
  yield* setText(P, Text_36_675);
  yield* speak(P, ACTOR_PLAYER);
  hide(P, ACTOR_TRAINING_COURT_BALLOON_SCRIBBLE);
  yield* waterSpriteSwingContestScene(P);
  if (testFlag(P, FLAG_HAVE_SILVER_RACKET) || testFlag(P, FLAG_HAVE_GOLD_RACKET)) return;
  if ((P.V.swingContestSwings & 0xFF) < SILVER_SWINGS) return;   // (the count's low byte)
  yield* waterSpriteRacketRewardScene(P);
}
// the water sprite flickers: state `on` for 4 frames, then `off` for d frames, d from $10 down by 2 to 2
function* flicker(P, on, off) {
  for (let d = 0x10; d > 0; d -= 2) {
    setActive(P, SPRITE, on);
    yield* wait(P, 4);
    setActive(P, SPRITE, off);
    yield* wait(P, d);
  }
}
// WaterSpriteRacketRewardScene (15:4D5D): the player looks around, a question balloon; the water sprite appears
// (the fountain's palettes changed, flickering in), the player jumps with the chime; under 150 swings the silver
// racket (its sprite on palette 7), else the gold one, the equipped racket's low nibble set; faded out, the racket
// appears and flies to the player, a sweat balloon, the sprite's last line; it flickers away, the palettes back
export function* waterSpriteRacketRewardScene(P) {
  yield* wait(P, 60);
  yield* setText(P, Text_36_677);
  yield* speak(P, SPRITE);
  for (const dir of [FACE_LEFT, FACE_RIGHT, FACE_LEFT, FACE_RIGHT, FACE_DOWN]) {
    yield* wait(P, 30);
    face(P, ACTOR_PLAYER, dir);
  }
  yield* wait(P, 30);
  setObjdef(P, OBJ_BALLOON_QUESTION, ACTOR_TRAINING_COURT_BALLOON_SCRIBBLE);
  setObjdef(P, OBJ_BALLOON_EXCLAIM, ACTOR_TRAINING_COURT_WALK_71_06_3);
  setPosition(P, ACTOR_TRAINING_COURT_BALLOON_SCRIBBLE, 52.5, 11.5);
  sound(P, SFX_EMOTE);
  yield* wait(P, 60);
  setPosition(P, SPRITE, 51.0, 7.0);
  setActive(P, SPRITE, 0x00);
  playerSpeed(P, 0.5);
  yield* movePlayerToActor(P, SPRITE);
  loadPalettesImmediate(P, WaterSpriteRacketRewardScenePalettes1, 2, 6);
  yield* wait(P, 30);
  loadPalettesImmediate(P, WaterSpriteRacketRewardScenePalettes2, 2, 6);
  sound(P, SFX_WATER_SPRITE_MAGIC);
  yield* flicker(P, 0x02, 0x00);                         // .handOver
  setActive(P, SPRITE, 0x02);
  yield* wait(P, 60);
  hide(P, ACTOR_TRAINING_COURT_BALLOON_SCRIBBLE);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* wait(P, 30);
  setPosition(P, ACTOR_TRAINING_COURT_WALK_71_06_3, 52.5, 11.5);
  sound(P, SFX_CHIME);
  yield* wait(P, 20);
  jumpVelocity(P, ACTOR_TRAINING_COURT_WALK_71_06_3, -3.0);
  jumpVelocity(P, ACTOR_PLAYER, -3.0);
  yield* waitJump(P, ACTOR_PLAYER);
  hide(P, ACTOR_TRAINING_COURT_WALK_71_06_3);
  setAnim(P, SPRITE, ANIM_NOD);
  yield* waitIdle(P, SPRITE);
  yield* speak(P, SPRITE);
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_PLAYER);
  setAnim(P, SPRITE, ANIM_NOD);
  yield* waitIdle(P, SPRITE);
  let racket;
  if ((P.V.swingContestSwings & 0xFF) < GOLD_SWINGS) {
    advanceText(P);
    const attr = (actorState(P, RACKET) + ACTORF_OAM_ATTR) & 0xFFFF;
    P.bus.w8(attr, (P.bus.u8(attr) & 0xF8) | 0x07);
    setFlag(P, FLAG_HAVE_SILVER_RACKET);
    racket = RACKET_SILVER;
  } else {                                               // .goldRacket
    setFlag(P, FLAG_HAVE_GOLD_RACKET);
    racket = RACKET_GOLD;
  }
  P.V.equippedRacket = (P.V.equippedRacket & 0xF0) | racket;   // .speak
  yield* speak(P, SPRITE);
  yield* wait(P, 10);
  yield* fadeOutAndWait(P, 3);
  sound(P, SFX_WATER_SPRITE_APPEAR);
  setPosition(P, RACKET, 51.0, 9.0);
  yield* wait(P, 30);
  fadeIn(P, 3);
  yield* waitFadeEnd(P);
  yield* wait(P, 60);
  sound(P, SFX_WATER_SPRITE_FLY);
  setSpeed(P, RACKET, 0.15625);
  moveTarget(P, RACKET, 51.0, 13.0);
  yield* waitMove(P, RACKET);
  yield* wait(P, 60);
  advanceText(P);
  yield* speak(P, ACTOR_PLAYER);
  setPosition(P, ACTOR_TRAINING_COURT_BALLOON_SWEAT, 52.5, 11.5);
  sound(P, SFX_APPEAR2);
  yield* wait(P, 120);
  hide(P, ACTOR_TRAINING_COURT_BALLOON_SWEAT);
  setAnim(P, SPRITE, ANIM_NOD);
  yield* waitIdle(P, SPRITE);
  yield* setText(P, Text_36_683);
  yield* speak(P, SPRITE);
  yield* wait(P, 50);
  sound(P, SFX_RACKET_GET);
  yield* flicker(P, 0x00, 0x02);                         // .done
  setActive(P, SPRITE, 0x00);
  yield* wait(P, 30);
  setPosition(P, SPRITE, 51.0, 11.0);
  yield* speak(P, SPRITE);
  hide(P, RACKET);
  loadPalettesImmediate(P, WaterSpriteRacketRewardScenePalettes1, 2, 6);
  yield* wait(P, 30);
  loadPalettesImmediate(P, WaterSpriteRacketRewardScenePalettes0, 2, 6);
  yield* wait(P, 30);
  for (const dir of [FACE_LEFT, FACE_RIGHT, FACE_LEFT, FACE_RIGHT]) {
    face(P, ACTOR_PLAYER, dir);
    yield* wait(P, 20);
  }
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* movePlayerToActor(P, ACTOR_PLAYER);
  yield* waitPlayerMove(P);
  yield* wait(P, 30);
}

// a challenger: its first match until it is cleared, then the second, then the third
function* challenger(P, cleared1, cleared2, match1, match2, match3) {
  if (!testFlag(P, cleared1)) yield* match1(P);
  else if (!testFlag(P, cleared2)) yield* match2(P);
  else yield* match3(P);
}
// spoken to from the side the coach faces: the player steps back to (x, y) at 0.25, facing kept, then turns
function* stepInFront(P, x, y, dir) {
  setSpeed(P, ACTOR_PLAYER, 0.25);
  lockFacing(P, ACTOR_PLAYER);
  moveTarget(P, ACTOR_PLAYER, x, y);
  yield* waitMove(P, ACTOR_PLAYER);
  unlockFacing(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, dir);
}
// a coach's text: the first, then the second when the flag is set; spoken
function* coachLine(P, coach, text, flag, text2) {
  yield* setText(P, text);
  if (flag !== undefined && testFlag(P, flag)) yield* setText(P, text2);
  yield* speak(P, coach);
}

// TrainingCourtNpc06_15 (15:50FC): the serve challenger: the service-ace, center-line and academy-rules matches
export const trainingCourtNpc06 = P => challenger(P, FLAG_CLEARED_SERVICE_MATCH_1, FLAG_CLEARED_SERVICE_MATCH_2,
  serviceAceMatchChallengeScene, centerLineServeMatchChallengeScene, academyRulesServeMatchChallengeScene);
// TrainingCourtNpc07FaceDown_15 (15:5112): spoken to from below: the player in front of Curt at (19, 19)
export function* trainingCourtNpc07FaceDown(P) {
  yield* stepInFront(P, 19.0, 19.0, FACE_DOWN);
  yield* trainingCourtNpc07(P);
}
// TrainingCourtNpc07_15 (15:513F): the serve coach Curt: lesson 1; lesson 2 when not greeted with the junior
// singles won, else his line; lesson 3 likewise with the senior singles; all done, his last line
export function* trainingCourtNpc07(P) {
  const CURT = ACTOR_TRAINING_COURT_CURT;
  if (!testFlag(P, FLAG_CLEARED_SERVICE_PRACTICE_1)) return yield* serveCoachJuniorLessonScene(P);
  if (!testFlag(P, FLAG_CLEARED_SERVICE_PRACTICE_2)) {
    if (!testFlag(P, FLAG_SERVE_COACH_GREETED) && testFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_1))
      return yield* serveCoachSeniorLessonScene(P);
    return yield* coachLine(P, CURT, Text_37_33, FLAG_WON_JUNIOR_SINGLES_RANK_1, Text_37_34);
  }
  if (!testFlag(P, FLAG_CLEARED_SERVICE_PRACTICE_3)) {
    if (!testFlag(P, FLAG_SERVE_COACH_GREETED) && testFlag(P, FLAG_WON_SENIOR_SINGLES_RANK_1))
      return yield* serveCoachVarsityLessonScene(P);
    return yield* coachLine(P, CURT, Text_37_50, FLAG_WON_SENIOR_SINGLES_RANK_1, Text_37_34);
  }
  yield* coachLine(P, CURT, Text_37_61);
}
// TrainingCourtNpc11_15 (15:51A8): the net challenger Brian: the volley, smash and drop-shot matches
export const trainingCourtNpc11 = P => challenger(P, FLAG_CLEARED_NET_GAME_MATCH_1, FLAG_CLEARED_NET_GAME_MATCH_2,
  volleyMatchChallengeScene, smashMatchChallengeScene, dropShotMatchChallengeScene);
// TrainingCourtNpc12FaceUp_15 (15:51BE): spoken to from above: the player in front of Beth at (45, 43)
export function* trainingCourtNpc12FaceUp(P) {
  yield* stepInFront(P, 45.0, 43.0, FACE_UP);
  yield* trainingCourtNpc12(P);
}
// TrainingCourtNpc12_15 (15:51EB): the net coach Beth, as Curt (lesson 2's line by the senior singles)
export function* trainingCourtNpc12(P) {
  const BETH = ACTOR_TRAINING_COURT_BETH;
  if (!testFlag(P, FLAG_CLEARED_NET_GAME_PRACTICE_1)) return yield* netCoachVolleyLessonScene(P);
  if (!testFlag(P, FLAG_CLEARED_NET_GAME_PRACTICE_2)) {
    if (!testFlag(P, FLAG_NET_COACH_GREETED) && testFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_1))
      return yield* netCoachSmashLessonScene(P);
    return yield* coachLine(P, BETH, Text_37_128, FLAG_WON_SENIOR_SINGLES_RANK_1, Text_37_131);
  }
  if (!testFlag(P, FLAG_CLEARED_NET_GAME_PRACTICE_3)) {
    if (!testFlag(P, FLAG_NET_COACH_GREETED) && testFlag(P, FLAG_WON_SENIOR_SINGLES_RANK_1))
      return yield* netCoachDropShotLessonScene(P);
    return yield* coachLine(P, BETH, Text_37_158, FLAG_WON_SENIOR_SINGLES_RANK_1, Text_37_156);
  }
  yield* coachLine(P, BETH, Text_37_187);
}
// TrainingCourtNpc0C_15 (15:5254): the stroke challenger Allie: the stroke, lob and return matches
export const trainingCourtNpc0C = P => challenger(P, FLAG_CLEARED_STROKE_MATCH_1, FLAG_CLEARED_STROKE_MATCH_2,
  strokeMatchChallengeScene, lobMatchChallengeScene, returnMatchChallengeScene);
// TrainingCourtNpc0DFaceUp_15 (15:526A): spoken to from above: the player in front of Bob at (19, 43)
export function* trainingCourtNpc0DFaceUp(P) {
  yield* stepInFront(P, 19.0, 43.0, FACE_UP);
  yield* trainingCourtNpc0D(P);
}
// TrainingCourtNpc0D_15 (15:5297): the return coach Bob, as Curt (lesson 2's line: Text_37_226 set again with
// the senior singles won; lesson 3's a single line)
export function* trainingCourtNpc0D(P) {
  const BOB = ACTOR_TRAINING_COURT_BOB_2;
  if (!testFlag(P, FLAG_CLEARED_STROKE_PRACTICE_1)) return yield* returnCoachReturnLessonScene(P);
  if (!testFlag(P, FLAG_CLEARED_STROKE_PRACTICE_2)) {
    if (!testFlag(P, FLAG_RETURN_COACH_GREETED) && testFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_1))
      return yield* returnCoachLobLessonScene(P);
    yield* setText(P, Text_37_225);                      // .lesson2Line
    if (testFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_1)) {
      yield* setText(P, Text_37_226);
      if (testFlag(P, FLAG_WON_SENIOR_SINGLES_RANK_1)) yield* setText(P, Text_37_226);
    }
    return yield* speak(P, BOB);
  }
  if (!testFlag(P, FLAG_CLEARED_STROKE_PRACTICE_3)) {
    if (!testFlag(P, FLAG_RETURN_COACH_GREETED) && testFlag(P, FLAG_WON_SENIOR_SINGLES_RANK_1))
      return yield* returnCoachPassingShotLessonScene(P);
    return yield* coachLine(P, BOB, Text_37_248);
  }
  yield* coachLine(P, BOB, Text_6e_18);
}

// TrainingCourtFacing01_15 (15:5309): nothing
export function* trainingCourtFacing01() {}
// TrainingCourtTile01_15 (15:5313): stepping up onto the fountain's tile: the player to (51, 13), facing down; the
// swing contest
export function* trainingCourtTile01(P) {
  moveTarget(P, ACTOR_PLAYER, 51.0, 13.0);
  yield* waitMove(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  yield* runWaterSpriteSwingContestAndReward(P);
}

// TrainingCourtInitScript_15 (15:532E): the rank tier into wMapSceneStage (from 5 up, less 6); entry $0F the intro
// tour; else the defeated challengers hidden, the swing-practice kid placed, then entry $0A the result of the
// drill played, entry $09 the pending lesson
export function* trainingCourtInitScript(P) {
  computeStoryRankTier(P);
  if (P.V.mapSceneStage >= 0x05) P.V.mapSceneStage = (P.V.mapSceneStage - 0x06) & 0xFF;
  if (P.V.storyModeEntryPoint === ENTRY_TOUR) return yield* trainingCourtIntroTourScene(P);
  hideServeChallengerActor(P);
  hideStrokeChallengerActor(P);
  hideNetChallengerActor(P);
  placeSwingPracticeKidActor(P);
  if (P.V.storyModeEntryPoint === ENTRY_RESULT) yield* trainingCourtResultDispatch(P);
  else if (P.V.storyModeEntryPoint === ENTRY_PENDING_LESSON) yield* startPendingLessonScene(P);
}
// TrainingCourtResultDispatch (15:536D): the match left early (wMatchExitRequest 1): back on the court; else the
// drill's result scene (rst $00 on wCurrentMinigameStoryMatch + 1); the tennis machines' none
export function* trainingCourtResultDispatch(P) {
  if (P.V.matchExitRequest === 0x01) return yield* trainingCourtReentryDispatch(P);
  if (drill(P) >= MINIGAME_TENNIS_MACHINE_1) return;
  yield* P.runRom(BANK, jumpTableTarget(P, BANK, TrainingCourtResultScenes, drill(P)));
}

// the re-entries by a challenger: (wMapSceneStage2 the challenger) the player at (x, y) facing up, the
// challenger at (cx, cy) facing down, the partner (no script) at (px, py) facing pdir; the player steps up to
// (x, ty); a slow fade in (then the challenger walks on)
function* enterChallengerCourt(P, challenger, x, y, cx, cy, px, py, pdir, ty) {
  P.V.storyModeShowLocationName = 0;
  P.V.mapSceneStage2 = challenger;
  setPosition(P, ACTOR_PLAYER, x, y);
  face(P, ACTOR_PLAYER, FACE_UP);
  setPosition(P, P.V.mapSceneStage2, cx, cy);
  face(P, P.V.mapSceneStage2, FACE_DOWN);
  nullScript(P, ACTOR_PARTNER);
  setPosition(P, ACTOR_PARTNER, px, py);
  face(P, ACTOR_PARTNER, pdir);
  playerSpeed(P, 7.5);
  yield* movePlayer(P, x, ty);
  yield* waitPlayerMove(P);
  fadeIn(P, 8);
  yield* waitFadeEnd(P);
}
// by the serve challenger (also ServeChallengerResultScene's start)
export const enterServeChallengerCourt = P => enterChallengerCourt(P, 0x06, 24.0, 17.0, 24.0, 13.0, 19.0, 17.0,
  FACE_RIGHT, 15.0);
function* challengerCourt(P, enter) {
  yield* enter(P);
  yield* walkChallengerOntoCourt(P);
}
// the re-entries by a coach: the player at (x, y), the partner at (px, py), both facing dir, the coach facing
// cdir; a quick fade in
function* coachCourt(P, x, y, px, py, dir, coach, cdir) {
  P.V.storyModeShowLocationName = 0;
  playerSpeed(P, 7.5);
  setPosition(P, ACTOR_PLAYER, x, y);
  setPosition(P, ACTOR_PARTNER, px, py);
  yield* movePlayer(P, x, y);
  yield* waitPlayerMove(P);
  face(P, ACTOR_PLAYER, dir);
  face(P, ACTOR_PARTNER, dir);
  face(P, coach, cdir);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
}
// TrainingCourtReentryDispatch (15:53A9): back on the court of the drill played (rst $00 on its index, three per
// court): by the serve challenger, the serve coach Curt, the net challenger, the net coach Beth, the stroke
// challenger and the return coach Bob (the ROM's .serveCourt, .netCourt, .strokeCourt, .serveCourtDoubles,
// .netCourtDoubles and .strokeCourtDoubles)
const REENTRIES = [
  P => challengerCourt(P, enterServeChallengerCourt),
  P => coachCourt(P, 19.0, 19.0, 19.0, 17.0, FACE_DOWN, ACTOR_TRAINING_COURT_CURT, FACE_LEFT),
  P => challengerCourt(P, P => enterChallengerCourt(P, 0x11, 40.0, 42.0, 40.0, 37.0, 45.0, 45.0, FACE_LEFT, 41.0)),
  P => coachCourt(P, 45.0, 43.0, 47.0, 43.0, FACE_UP, ACTOR_TRAINING_COURT_BETH, FACE_RIGHT),
  P => challengerCourt(P, P => enterChallengerCourt(P, 0x0C, 24.0, 42.0, 24.0, 37.0, 19.0, 45.0, FACE_RIGHT, 40.0)),
  P => coachCourt(P, 19.0, 43.0, 17.0, 43.0, FACE_UP, ACTOR_TRAINING_COURT_BOB_2, FACE_UP),
];
export function* trainingCourtReentryDispatch(P) {
  const index = drill(P);
  if (index < 18) return yield* REENTRIES[(index / 3) | 0](P);
  yield* P.runRom(BANK, jumpTableTarget(P, BANK, 0x53AE, index));
}

export const HOOKS = [
  scene(BANK, 0x4D07, runWaterSpriteSwingContestAndReward),
  scene(BANK, 0x4D5D, waterSpriteRacketRewardScene),
  scene(BANK, 0x50FC, trainingCourtNpc06),
  scene(BANK, 0x5112, trainingCourtNpc07FaceDown),
  scene(BANK, 0x513F, trainingCourtNpc07),
  scene(BANK, 0x51A8, trainingCourtNpc11),
  scene(BANK, 0x51BE, trainingCourtNpc12FaceUp),
  scene(BANK, 0x51EB, trainingCourtNpc12),
  scene(BANK, 0x5254, trainingCourtNpc0C),
  scene(BANK, 0x526A, trainingCourtNpc0DFaceUp),
  scene(BANK, 0x5297, trainingCourtNpc0D),
  scene(BANK, 0x5309, trainingCourtFacing01),
  scene(BANK, 0x5313, trainingCourtTile01),
  scene(BANK, 0x532E, trainingCourtInitScript),
  scene(BANK, 0x536D, trainingCourtResultDispatch),
  scene(BANK, 0x53A9, trainingCourtReentryDispatch),
];
