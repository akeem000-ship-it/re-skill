// The training court's net coach Beth and return coach Bob after their practices (bank $15, $757A-$7B95): their
// greetings, their words for each result of the net-game and stroke practices (wDrillLessonResult, the stroke
// practices' through jump tables), the retry prompts that start the lesson again, the scenes that set the party in
// front of them; the swing-practice kid placed, the lesson pending after a briefing started, and the serve and
// net coaches' walks to their courts (the gesture cutscene, then the drill). The jump tables, Table_15 and the
// actor scripts are data.
// Port of src/story/practice_results_15.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss1_tc_*.mtrec (part 1's scripted lessons and results), out/port/ss2_tc_res_*.mtrec
// (scripted: each net-game and stroke practice's results, retried and not).
import {
  ACTOR_PARTNER, ACTOR_PLAYER, ANIM_BOUNCE, ANIM_NOD, ANIM_SHAKE, FACE_DOWN, FACE_RIGHT, FACE_UP, FLAG_DOUBLES,
  advanceText, askYesNo, endCutscene, face, faceToward, fadeIn, gesture, goToLocation, jumpTableTarget, movePlayer,
  nullScript, playerSpeed, rd, scene, setActorScript, setFlag, setPosition, setText, speak, testFlag, wait,
  waitActorScript, waitFadeEnd, waitPlayerMove,
} from "./common.js";
import { initServeCoachScene } from "./coach_lessons_15.js";
import { returnCoachWalkToCourtAndStartLesson, playerPartnerGesture, runTrainingDrill, STORYLOC_TRAINING_COURT } from "./coach_walks_15.js";

const BANK = 0x15;
const ACTOR_TRAINING_COURT_CURT = 0x07, ACTOR_TRAINING_COURT_BOB_2 = 0x0D, ACTOR_TRAINING_COURT_BETH = 0x12;
const ACTOR_TRAINING_COURT_WALK_71_06_3 = 0x13;
const ActorScript_15_13 = 0x7B03, ActorScript_15_14 = 0x7B1A, ActorScript_15_15 = 0x7B25;
const ActorScript_15_16 = 0x7B96, ActorScript_15_17 = 0x7BB3, ActorScript_15_18 = 0x7BBE;
const FLAG_SWING_PRACTICE_KID_PLACED = 0x80, FLAG_WON_JUNIOR_SINGLES_RANK_1 = 0x53;
const FLAG_WON_SENIOR_SINGLES_RANK_1 = 0x57, FLAG_NET_COACH_GREETED = 0xBE, FLAG_RETURN_COACH_GREETED = 0xBF;
const MINIGAME_NET_GAME_MATCH_1 = 0x06, NET_LESSONS_END = 0x0C, RETURN_LESSONS_END = 0x12;
const RACKET_SWING_PRACTICE = 0x03;                      // the racket (low nibble) the swing-practice kid comes for
const LESSON_ENTRY = 0x0A;                               // the training court's entry after a lesson's drill
const Text_37_106 = 0x1C6A, Text_37_107 = 0x1C6B, Text_37_111 = 0x1C6F, Text_37_115 = 0x1C73, Text_37_119 = 0x1C77;
const Text_37_123 = 0x1C7B, Text_37_126 = 0x1C7E, Text_37_130 = 0x1C82, Text_37_144 = 0x1C90, Text_37_148 = 0x1C94;
const Text_37_151 = 0x1C97, Text_37_155 = 0x1C9B, Text_37_172 = 0x1CAC, Text_37_176 = 0x1CB0, Text_37_180 = 0x1CB4;
const Text_37_183 = 0x1CB7, Text_37_188 = 0x1CBC, Text_37_192 = 0x1CC0, Text_37_203 = 0x1CCB, Text_37_207 = 0x1CCF;
const Text_37_211 = 0x1CD3, Text_37_215 = 0x1CD7, Text_37_218 = 0x1CDA, Text_37_221 = 0x1CDD, Text_37_225 = 0x1CE1;
const Text_37_233 = 0x1CE9, Text_37_236 = 0x1CEC, Text_37_239 = 0x1CEF, Text_37_242 = 0x1CF2, Text_37_245 = 0x1CF5;
const Text_37_255 = 0x1CFF, Text_6e_3 = 0x2003, Text_6e_7 = 0x2007, Text_6e_11 = 0x200B, Text_6e_15 = 0x200F;
const BETH = ACTOR_TRAINING_COURT_BETH, BOB = ACTOR_TRAINING_COURT_BOB_2;

// a coach's lines: the first, then turned to the player, each gesture played before the next line; then the coach
// turns back (facing) and the greeting's flag is set; beforeSecond runs after the first gesture (a text set)
function* coachLines(P, coach, anims, facing, flag, beforeSecond = function* () {}) {
  yield* speak(P, coach);
  faceToward(P, ACTOR_PLAYER, coach);
  for (let i = 0; i < anims.length; i++) {
    yield* gesture(P, coach, anims[i]);
    if (i === 0) yield* beforeSecond();
    yield* speak(P, coach);
  }
  face(P, coach, facing);
  setFlag(P, flag);
}

// ---- the net coach (Beth) ----
// InitNetCoachScene (15:7752): no location name; the player and the partner placed in front of Beth, facing her;
// a quick fade in
export function* initNetCoachScene(P) {
  P.V.storyModeShowLocationName = 0;
  playerSpeed(P, 7.5);
  setPosition(P, ACTOR_PLAYER, 45.0, 43.0);
  setPosition(P, ACTOR_PARTNER, 47.0, 43.0);
  yield* movePlayer(P, 45.0, 43.0);
  yield* waitPlayerMove(P);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, ACTOR_PARTNER, FACE_UP);
  face(P, BETH, FACE_DOWN);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
}
// InitNetCoachScene.speak (15:779D): her next line, then she turns back to her court
export function* netCoachLastLine(P) {
  yield* speak(P, BETH);
  face(P, BETH, FACE_RIGHT);
}
// NetCoachIntroDialogue_15 (15:757A): her greeting (its second line another once the junior singles are won)
export function* netCoachIntroDialogue(P) {
  yield* setText(P, Text_37_126);
  yield* initNetCoachScene(P);
  yield* speak(P, BETH);
  faceToward(P, ACTOR_PLAYER, BETH);
  if (testFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_1)) yield* setText(P, Text_37_130);
  for (const anim of [ANIM_NOD, ANIM_BOUNCE, ANIM_SHAKE]) {   // .animate
    yield* gesture(P, BETH, anim);
    yield* speak(P, BETH);
  }
  face(P, BETH, FACE_RIGHT);
  setFlag(P, FLAG_NET_COACH_GREETED);
}
// NetGamePractice2Result0 (15:75D9): the second practice's opening (from the senior singles on, another second line)
export function* netGamePractice2Result0(P) {
  yield* initNetCoachScene(P);
  yield* setText(P, Text_37_151);
  yield* coachLines(P, BETH, [ANIM_NOD, ANIM_BOUNCE, ANIM_SHAKE], FACE_RIGHT, FLAG_NET_COACH_GREETED, function* () {
    if (testFlag(P, FLAG_WON_SENIOR_SINGLES_RANK_1)) yield* setText(P, Text_37_155);
  });
}
// NetGamePractice3Result0 (15:7638): the third practice's opening
export function* netGamePractice3Result0(P) {
  yield* initNetCoachScene(P);
  yield* setText(P, Text_37_183);
  yield* coachLines(P, BETH, [ANIM_NOD, ANIM_BOUNCE, ANIM_NOD], FACE_RIGHT, FLAG_NET_COACH_GREETED);
}
// NetCoachResultRetryPrompt (15:7728): her line, then NetCoachRetryPrompt
export function* netCoachResultRetryPrompt(P) {
  yield* speak(P, BETH);
  yield* netCoachRetryPrompt(P);
}
// NetCoachRetryPrompt (15:772D): yes, her line and the walk to the court for the lesson; no, her other line
export function* netCoachRetryPrompt(P) {
  if ((yield* askYesNo(P, BETH)) !== 0) {
    advanceText(P);
    return yield* netCoachLastLine(P);
  }
  yield* speak(P, BETH);                                   // .retry
  yield* netCoachWalkToCourtAndStartLesson(P);
}
// NetGamePractice*Result* (after a net-game practice): Beth's words for the result, then a prompt
function netCoachResult(text, prompt) {
  return function* (P) {
    yield* initNetCoachScene(P);
    yield* setText(P, text);
    yield* prompt(P);
  };
}
// ---- the return coach (Bob) ----
// InitReturnCoachScene (15:79CB): the party in front of Bob, facing him; a quick fade in
export function* initReturnCoachScene(P) {
  P.V.storyModeShowLocationName = 0;
  playerSpeed(P, 7.5);
  setPosition(P, ACTOR_PLAYER, 19.0, 43.0);
  setPosition(P, ACTOR_PARTNER, 17.0, 43.0);
  yield* movePlayer(P, 19.0, 43.0);
  yield* waitPlayerMove(P);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, ACTOR_PARTNER, FACE_UP);
  face(P, BOB, FACE_DOWN);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
}
// InitReturnCoachScene.speak (15:7A16): his next line, then he turns back to his court
export function* returnCoachLastLine(P) {
  yield* speak(P, BOB);
  face(P, BOB, FACE_UP);
}
// ReturnCoachIntroDialogue_15 (15:77E3): his greeting (two of its lines others once the junior singles are won)
export function* returnCoachIntroDialogue(P) {
  const juniorWon = () => testFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_1);
  yield* initReturnCoachScene(P);
  yield* setText(P, Text_37_221);
  yield* speak(P, BOB);
  faceToward(P, ACTOR_PLAYER, BOB);
  yield* gesture(P, BOB, ANIM_NOD);
  yield* speak(P, BOB);
  yield* gesture(P, BOB, ANIM_BOUNCE);
  if (juniorWon()) advanceText(P);
  yield* speak(P, BOB);                                    // .speak
  yield* setText(P, Text_37_225);
  yield* gesture(P, BOB, ANIM_SHAKE);
  if (juniorWon()) advanceText(P);
  yield* speak(P, BOB);                                    // .speak2
  face(P, BOB, FACE_UP);
  setFlag(P, FLAG_RETURN_COACH_GREETED);
}
// StrokePractice2Result0 (15:784D) / StrokePractice3Result0 (15:78A1): the second / third practice's opening
export function* strokePractice2Result0(P) {
  yield* initReturnCoachScene(P);
  yield* setText(P, Text_37_245);
  yield* coachLines(P, BOB, [ANIM_NOD, ANIM_BOUNCE, ANIM_SHAKE], FACE_UP, FLAG_RETURN_COACH_GREETED);
}
export function* strokePractice3Result0(P) {
  yield* initReturnCoachScene(P);
  yield* setText(P, Text_6e_15);
  yield* coachLines(P, BOB, [ANIM_NOD, ANIM_BOUNCE, ANIM_NOD], FACE_UP, FLAG_RETURN_COACH_GREETED);
}
// ReturnCoachResultRetryPrompt (15:799E): his line, then ReturnCoachRetryPrompt
export function* returnCoachResultRetryPrompt(P) {
  yield* speak(P, BOB);
  yield* returnCoachRetryPrompt(P);
}
// ReturnCoachRetryPrompt (15:79A3): yes, his next line, the walk to the court for the lesson (the cutscene mode
// ended after); no, his line
export function* returnCoachRetryPrompt(P) {
  if ((yield* askYesNo(P, BOB)) !== 0) return yield* returnCoachLastLine(P);
  advanceText(P);                                          // .retry
  yield* speak(P, BOB);
  yield* returnCoachWalkToCourtAndStartLesson(P);
  endCutscene(P);
}
function returnCoachResult(text, prompt) {
  return function* (P) {
    yield* initReturnCoachScene(P);
    yield* setText(P, text);
    yield* prompt(P);
  };
}

// the result scenes, by address
const RESULT_SCENES = {
  0x757A: netCoachIntroDialogue, 0x75D9: netGamePractice2Result0, 0x7638: netGamePractice3Result0,
  0x768C: netCoachResult(Text_37_107, netCoachResultRetryPrompt), 0x7699: netCoachResult(Text_37_111, netCoachResultRetryPrompt),
  0x76A6: netCoachResult(Text_37_115, netCoachResultRetryPrompt), 0x76B3: netCoachResult(Text_37_119, netCoachResultRetryPrompt),
  0x76C0: netCoachResult(Text_37_123, netCoachRetryPrompt), 0x76CD: netCoachResult(Text_37_144, netCoachResultRetryPrompt),
  0x76DA: netCoachResult(Text_37_148, netCoachRetryPrompt), 0x76E7: netCoachResult(Text_37_172, netCoachResultRetryPrompt),
  0x76F4: netCoachResult(Text_37_176, netCoachResultRetryPrompt), 0x7701: netCoachResult(Text_37_180, netCoachRetryPrompt),
  0x770E: netCoachResult(Text_37_188, netCoachResultRetryPrompt), 0x771B: netCoachResult(Text_37_192, netCoachResultRetryPrompt),
  0x77E3: returnCoachIntroDialogue, 0x784D: strokePractice2Result0, 0x78A1: strokePractice3Result0,
  0x78F5: returnCoachResult(Text_37_203, returnCoachResultRetryPrompt), 0x7902: returnCoachResult(Text_37_207, returnCoachResultRetryPrompt),
  0x790F: returnCoachResult(Text_37_211, returnCoachResultRetryPrompt), 0x791C: returnCoachResult(Text_37_215, returnCoachRetryPrompt),
  0x7929: returnCoachResult(Text_37_218, returnCoachRetryPrompt), 0x7936: returnCoachResult(Text_37_233, returnCoachRetryPrompt),
  0x7943: returnCoachResult(Text_37_236, returnCoachRetryPrompt), 0x7950: returnCoachResult(Text_37_239, returnCoachRetryPrompt),
  0x795D: returnCoachResult(Text_37_242, returnCoachRetryPrompt), 0x796A: returnCoachResult(Text_37_255, returnCoachResultRetryPrompt),
  0x7977: returnCoachResult(Text_6e_3, returnCoachResultRetryPrompt), 0x7984: returnCoachResult(Text_6e_7, returnCoachResultRetryPrompt),
  0x7991: returnCoachResult(Text_6e_11, returnCoachResultRetryPrompt),
};
// StrokePractice1ResultScene (15:77AA) .. StrokePractice3ResultScene (15:77D0): rst $00 on wDrillLessonResult
// through the table after it
function* resultScene(P, table) {
  const target = jumpTableTarget(P, BANK, table, P.V.drillLessonResult);
  if (RESULT_SCENES[target]) return yield* RESULT_SCENES[target](P);
  yield* P.runRom(BANK, target);
}

// PlaceSwingPracticeKidActor (15:7A45): in singles, with the swing-practice racket and the kid not yet placed: the
// kid at (53, 15)
export function placeSwingPracticeKidActor(P) {
  if (testFlag(P, FLAG_DOUBLES)) return;
  if ((P.V.equippedRacket & 0x0F) !== RACKET_SWING_PRACTICE) return;
  if (testFlag(P, FLAG_SWING_PRACTICE_KID_PLACED)) return;
  setPosition(P, ACTOR_TRAINING_COURT_WALK_71_06_3, 53.0, 15.0);
}
// StartPendingLessonScene (15:7A67): the lesson chosen (wCurrentMinigameStoryMatch + 1) started from its coach:
// serve (below the net-game matches), net (Beth's line first; below $0C), return (below $12)
export function* startPendingLessonScene(P) {
  const lesson = rd(P, "currentMinigameStoryMatch", 1);
  if (lesson < MINIGAME_NET_GAME_MATCH_1) {
    yield* initServeCoachScene(P);
    yield* serveCoachWalkToCourtAndStartLesson(P);
  } else if (lesson < NET_LESSONS_END) {                   // .netLesson
    yield* initNetCoachScene(P);
    yield* setText(P, Text_37_106);
    yield* speak(P, BETH);
    yield* netCoachWalkToCourtAndStartLesson(P);
  } else if (lesson < RETURN_LESSONS_END) {                // .returnLesson
    yield* initReturnCoachScene(P);
    yield* returnCoachWalkToCourtAndStartLesson(P);
  }
}
// the gesture cutscene, then back to the training court at entry $0A after the lesson's drill
function* startLesson(P) {
  yield* playerPartnerGesture(P);
  goToLocation(P, STORYLOC_TRAINING_COURT, LESSON_ENTRY);
  yield* runTrainingDrill(P, rd(P, "currentMinigameStoryMatch", 1));
}
// ServeCoachWalkToCourtAndStartLesson (15:7A96): Curt, the player and the partner on their walk scripts to the
// serve court (the player to (24, 15)), then the lesson
export function* serveCoachWalkToCourtAndStartLesson(P) {
  nullScript(P, ACTOR_PARTNER);
  playerSpeed(P, 1.0);
  yield* wait(P, 20);
  setActorScript(P, ACTOR_TRAINING_COURT_CURT, ActorScript_15_13);
  setActorScript(P, ACTOR_PLAYER, ActorScript_15_14);
  setActorScript(P, ACTOR_PARTNER, ActorScript_15_15);
  yield* movePlayer(P, 24.0, 15.0);
  yield* waitActorScript(P, ACTOR_PLAYER);
  yield* waitPlayerMove(P);
  yield* waitActorScript(P, ACTOR_TRAINING_COURT_CURT);
  yield* wait(P, 5);
  yield* startLesson(P);
}
// NetCoachWalkToCourtAndStartLesson (15:7B30): Beth, the player and the partner to the net court (the player to
// (40, 38)), then the lesson
export function* netCoachWalkToCourtAndStartLesson(P) {
  playerSpeed(P, 1.0);
  nullScript(P, ACTOR_PARTNER);
  setActorScript(P, BETH, ActorScript_15_16);
  setActorScript(P, ACTOR_PLAYER, ActorScript_15_17);
  setActorScript(P, ACTOR_PARTNER, ActorScript_15_18);
  yield* movePlayer(P, 40.0, 38.0);
  yield* waitActorScript(P, ACTOR_PLAYER);
  yield* waitPlayerMove(P);
  yield* waitActorScript(P, BETH);
  yield* wait(P, 5);
  yield* startLesson(P);
}

export const HOOKS = [
  ...Object.entries(RESULT_SCENES).map(([addr, fn]) => scene(BANK, +addr, fn)),
  scene(BANK, 0x7728, netCoachResultRetryPrompt),
  scene(BANK, 0x772D, netCoachRetryPrompt),
  scene(BANK, 0x7752, initNetCoachScene),
  scene(BANK, 0x779D, netCoachLastLine),                  // InitNetCoachScene.speak
  scene(BANK, 0x77AA, P => resultScene(P, 0x77AF)),       // StrokePractice1ResultScene
  scene(BANK, 0x77BD, P => resultScene(P, 0x77C2)),       // StrokePractice2ResultScene
  scene(BANK, 0x77D0, P => resultScene(P, 0x77D5)),       // StrokePractice3ResultScene
  scene(BANK, 0x799E, returnCoachResultRetryPrompt),
  scene(BANK, 0x79A3, returnCoachRetryPrompt),
  scene(BANK, 0x79CB, initReturnCoachScene),
  scene(BANK, 0x7A16, returnCoachLastLine),               // InitReturnCoachScene.speak
  // (a script-macro routine: the registers it leaves are read by no caller, and put back as at the call)
  scene(BANK, 0x7A45, function* (P) { placeSwingPracticeKidActor(P); }),
  scene(BANK, 0x7A67, startPendingLessonScene),
  scene(BANK, 0x7A96, serveCoachWalkToCourtAndStartLesson),
  scene(BANK, 0x7B30, netCoachWalkToCourtAndStartLesson),
];
