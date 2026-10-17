// The training court's challenge matches (bank $15, $688F-$6F51): Brian's net-game challenges (volley, smash, drop
// shot) and the walk to his court, Allie's stroke challenges (stroke, lob, return), and the return coach Bob's
// lessons (return, lob, passing shot) with the walk to his spot. Each asks first, then the challenger's lines
// with gestures and the drill (RunTrainingDrillByID) or, for a lesson, its briefing screen.
// The actor scripts (ActorScript_15_07..09) are data.
// Port of src/story/challenge_scenes_15.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss1_coach*.mtrec (scripted: the training court's challengers and the return coach).
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FACE_LEFT, FACE_RIGHT, ANIM_NOD, ANIM_BOUNCE, ANIM_SHAKE, testFlag, wr, setText,
  advanceText, speak, speakRestore, yesNo, closeDialogue, askYesNo, agrees, gesture, faceToward, face, movePlayer,
  nullScript, setActorScript, waitActorScript, wait, fadeOutAndWait, goToLocation, scene,
} from "./common.js";
import { movePartyToReturnCoachSpot, playerPartnerGesture, runTrainingDrill, STORYLOC_TRAINING_COURT } from "./coach_walks_15.js";
import { walkToStrokeChallengeCourtCutscene } from "./coach_lessons_15.js";

const BANK = 0x15;
const BANK_BRIEFING = 0x17, ShowDrillBriefingScreen = 0x4487;
const ACTOR_TRAINING_COURT_ALLIE = 0x0C, ACTOR_TRAINING_COURT_BOB_2 = 0x0D, ACTOR_TRAINING_COURT_BRIAN = 0x11;
const ActorScript_15_07 = 0x6B49, ActorScript_15_08 = 0x6B54, ActorScript_15_09 = 0x6B71;
const FLAG_WON_JUNIOR_SINGLES_RANK_1 = 0x53;
const MINIGAME_NET_GAME_MATCH_1 = 0x06, MINIGAME_NET_GAME_MATCH_2 = 0x07, MINIGAME_NET_GAME_MATCH_3 = 0x08;
const MINIGAME_STROKE_MATCH_1 = 0x0C, MINIGAME_STROKE_MATCH_2 = 0x0D, MINIGAME_STROKE_MATCH_3 = 0x0E;
const MINIGAME_STROKE_PRACTICE_1 = 0x0F, MINIGAME_STROKE_PRACTICE_2 = 0x10, MINIGAME_STROKE_PRACTICE_3 = 0x11;
const Text_37_196 = 0x1CC4, Text_37_198 = 0x1CC6, Text_37_202 = 0x1CCA, Text_37_227 = 0x1CE3, Text_37_249 = 0x1CF9;
const Text_6e_64 = 0x2040, Text_6e_69 = 0x2045, Text_6e_70 = 0x2046, Text_6e_85 = 0x2055, Text_6e_98 = 0x2062;
const Text_6e_111 = 0x206F, Text_6e_133 = 0x2085, Text_6e_149 = 0x2095;
const LESSON_ENTRY = 0x09;                              // the training court's entry after a lesson's drill

// the challenger's lines, a gesture before each (anims; null: a line without one)
function* lines(P, actor, anims) {
  for (const anim of anims) {
    if (anim !== null) yield* gesture(P, actor, anim);
    yield* speak(P, actor);
  }
}
// a challenge accepted: the challenger turns to its court for 40 frames and the player to it (turnTo)
function* turnAway(P, actor, facing) {
  face(P, actor, facing);
  yield* wait(P, 40);
  faceToward(P, ACTOR_PLAYER, actor);
}

// ---- Brian's net-game challenges ----
// VolleyMatchChallengeScene (15:688F): three questions (a no to the first two: his line, the end); a no to the
// third asks again (Text_6e_69) until yes
export function* volleyMatchChallengeScene(P) {
  const BRIAN = ACTOR_TRAINING_COURT_BRIAN;
  faceToward(P, BRIAN, ACTOR_PARTNER);
  yield* setText(P, Text_6e_64);
  if (!(yield* agrees(P, BRIAN, 2))) return yield* speak(P, BRIAN);   // (.done)
  if ((yield* askYesNo(P, BRIAN)) !== 0) {
    do yield* setText(P, Text_6e_69);                   // .prompt
    while ((yield* askYesNo(P, BRIAN)) !== 0);
  }
  yield* setText(P, Text_6e_70);                        // .accepted
  yield* gesture(P, BRIAN, ANIM_NOD);
  yield* turnAway(P, BRIAN, FACE_LEFT);
  yield* lines(P, BRIAN, [null, ANIM_NOD, null, ANIM_NOD]);
  yield* walkToNetChallengeCourtCutscene(P);
  yield* runTrainingDrill(P, MINIGAME_NET_GAME_MATCH_1);
}
// SmashMatchChallengeScene (15:6963) / DropShotMatchChallengeScene (15:6A2D): a question; his lines; a second
// question; then (smash) a nod before his last line, (drop shot) the dialogue on first
function* netMatchChallenge(P, text, dropShot, drill) {
  const BRIAN = ACTOR_TRAINING_COURT_BRIAN;
  faceToward(P, BRIAN, ACTOR_PARTNER);
  yield* setText(P, text);
  if (!(yield* agrees(P, BRIAN, 1))) return yield* speak(P, BRIAN);   // (.speak)
  yield* speak(P, BRIAN);
  yield* gesture(P, BRIAN, ANIM_NOD);
  yield* turnAway(P, BRIAN, FACE_LEFT);
  yield* lines(P, BRIAN, [null, ANIM_NOD, ANIM_SHAKE, ANIM_BOUNCE]);
  yield* gesture(P, BRIAN, ANIM_NOD);
  if ((yield* askYesNo(P, BRIAN)) !== 0) return yield* speak(P, BRIAN);
  if (dropShot) advanceText(P);
  yield* gesture(P, BRIAN, ANIM_NOD);
  if (!dropShot) advanceText(P);
  yield* speak(P, BRIAN);
  yield* walkToNetChallengeCourtCutscene(P);
  yield* runTrainingDrill(P, drill);
}
export const smashMatchChallengeScene = P => netMatchChallenge(P, Text_6e_85, false, MINIGAME_NET_GAME_MATCH_2);
export const dropShotMatchChallengeScene = P => netMatchChallenge(P, Text_6e_98, true, MINIGAME_NET_GAME_MATCH_3);

// WalkToNetChallengeCourtCutscene (15:6AF7): the party after Brian to the net court (the player to (40, 39)); the
// gesture cutscene; back to the training court at entry $0A after the match
export function* walkToNetChallengeCourtCutscene(P) {
  nullScript(P, ACTOR_PARTNER);
  yield* movePlayer(P, 40.0, 39.0);
  setActorScript(P, ACTOR_TRAINING_COURT_BRIAN, ActorScript_15_07);
  setActorScript(P, ACTOR_PLAYER, ActorScript_15_08);
  yield* wait(P, 10);
  setActorScript(P, ACTOR_PARTNER, ActorScript_15_09);
  yield* waitActorScript(P, ACTOR_PLAYER);
  yield* playerPartnerGesture(P);
  goToLocation(P, STORYLOC_TRAINING_COURT, 0x0A);
}

// ---- Allie's stroke challenges ----
// SpeakStrokeChallengerDeclineLine (15:6B8E): her line for a no
export function* speakStrokeChallengerDeclineLine(P) { yield* speak(P, ACTOR_TRAINING_COURT_ALLIE); }
// two questions (a line between them for the return match), her lines, the walk and the match
function* strokeMatchChallenge(P, text, between, beforeTurn, anims, drill) {
  const ALLIE = ACTOR_TRAINING_COURT_ALLIE;
  faceToward(P, ALLIE, ACTOR_PARTNER);
  yield* setText(P, text);
  if (!(yield* agrees(P, ALLIE, 1))) return yield* speakStrokeChallengerDeclineLine(P);
  if (between) yield* speak(P, ALLIE);
  if (!(yield* agrees(P, ALLIE, 1))) return yield* speakStrokeChallengerDeclineLine(P);
  yield* beforeTurn(P, ALLIE);
  yield* turnAway(P, ALLIE, FACE_RIGHT);
  yield* lines(P, ALLIE, anims);
  yield* walkToStrokeChallengeCourtCutscene(P);
  yield* runTrainingDrill(P, drill);
}
// StrokeMatchChallengeScene (15:6B94)
export const strokeMatchChallengeScene = P => strokeMatchChallenge(P, Text_6e_111, false, function* () {},
  [null, ANIM_NOD, ANIM_BOUNCE, ANIM_SHAKE, ANIM_NOD], MINIGAME_STROKE_MATCH_1);
// LobMatchChallengeScene (15:6C3C): a line before she turns
export const lobMatchChallengeScene = P => strokeMatchChallenge(P, Text_6e_133, false, (P, a) => speak(P, a),
  [ANIM_NOD, ANIM_BOUNCE, ANIM_SHAKE, ANIM_NOD], MINIGAME_STROKE_MATCH_2);
// ReturnMatchChallengeScene (15:6CE4): a line between the questions, a nod before she turns
export const returnMatchChallengeScene = P => strokeMatchChallenge(P, Text_6e_149, true, (P, a) => gesture(P, a, ANIM_NOD),
  [null, ANIM_NOD, ANIM_BOUNCE, ANIM_SHAKE, ANIM_BOUNCE, ANIM_NOD], MINIGAME_STROKE_MATCH_3);

// ---- the return coach (Bob) ----
// ReturnMatchChallengeScene.loop (15:6DAE): his line for a no
export function* returnCoachDecline(P) { yield* speak(P, ACTOR_TRAINING_COURT_BOB_2); }
// a lesson agreed: his line, the walk to his spot, his lines (text: the first of them, if given), a bounce; the
// drill (wCurrentMinigameStoryMatch + 1), back to the training court at entry 9, a fade out and the briefing
function* returnCoachLesson(P, text, drill) {
  const BOB = ACTOR_TRAINING_COURT_BOB_2;
  yield* speak(P, BOB);
  yield* movePartyToReturnCoachSpot(P);
  face(P, BOB, FACE_RIGHT);
  if (text !== null) yield* setText(P, text);
  yield* speak(P, BOB);
  yield* gesture(P, BOB, ANIM_BOUNCE);
  wr(P, "currentMinigameStoryMatch", drill, 1);
  goToLocation(P, STORYLOC_TRAINING_COURT, LESSON_ENTRY);
  yield* fadeOutAndWait(P, 16);
  yield* P.runRom(BANK_BRIEFING, ShowDrillBriefingScreen);
}
// ReturnCoachReturnLessonScene (15:6DB4): his greeting (the next one once the junior singles are won), then the
// questions on Text_37_198
export function* returnCoachReturnLessonScene(P) {
  const BOB = ACTOR_TRAINING_COURT_BOB_2;
  yield* setText(P, Text_37_196);
  if (testFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_1)) advanceText(P);
  faceToward(P, BOB, ACTOR_PARTNER);                    // .face
  yield* speakRestore(P, BOB);
  yield* setText(P, Text_37_198);
  const choice = yield* yesNo(P);
  yield* closeDialogue(P);
  yield* wait(P, 5);
  if (choice !== 0) return yield* returnCoachDecline(P);
  advanceText(P);
  if (!(yield* agrees(P, BOB, 1))) return yield* returnCoachDecline(P);
  yield* returnCoachLesson(P, Text_37_202, MINIGAME_STROKE_PRACTICE_1);
}
// ReturnCoachLobLessonScene (15:6E4B) / ReturnCoachPassingShotLessonScene (15:6ECE): two questions, the lesson
function* returnCoachQuestionsLesson(P, text, drill) {
  const BOB = ACTOR_TRAINING_COURT_BOB_2;
  faceToward(P, BOB, ACTOR_PARTNER);
  yield* setText(P, text);
  if (!(yield* agrees(P, BOB, 2))) return yield* returnCoachDecline(P);
  yield* returnCoachLesson(P, null, drill);
}
export const returnCoachLobLessonScene = P => returnCoachQuestionsLesson(P, Text_37_227, MINIGAME_STROKE_PRACTICE_2);
export const returnCoachPassingShotLessonScene = P => returnCoachQuestionsLesson(P, Text_37_249, MINIGAME_STROKE_PRACTICE_3);

export const HOOKS = [
  scene(BANK, 0x688F, volleyMatchChallengeScene),
  scene(BANK, 0x6963, smashMatchChallengeScene),
  scene(BANK, 0x6A2D, dropShotMatchChallengeScene),
  scene(BANK, 0x6AF7, walkToNetChallengeCourtCutscene),
  scene(BANK, 0x6B8E, speakStrokeChallengerDeclineLine),
  scene(BANK, 0x6B94, strokeMatchChallengeScene),
  scene(BANK, 0x6C3C, lobMatchChallengeScene),
  scene(BANK, 0x6CE4, returnMatchChallengeScene),
  scene(BANK, 0x6DAE, returnCoachDecline),                            // ReturnMatchChallengeScene.loop
  scene(BANK, 0x6DB4, returnCoachReturnLessonScene),
  scene(BANK, 0x6E4B, returnCoachLobLessonScene),
  scene(BANK, 0x6ECE, returnCoachPassingShotLessonScene),
];
