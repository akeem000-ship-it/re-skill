// The training court's coaches (bank $15, $6F51-$757A): Allie's walk to the stroke challenge court, the net coach
// Beth's volley, smash and drop-shot lessons, the three challengers hidden once beaten, and the serve coach Curt:
// his greeting and his words after each serve practice by its result (wDrillLessonResult, through jump tables),
// with the retry prompts that start the lesson again. The net-game practices' result tables lead to
// practice_results_15.asm's scenes. The actor scripts (ActorScript_15_10..12) and the challengers' flag tables are
// data.
// Port of src/story/coach_lessons_15.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss1_coach*.mtrec (scripted: the training court's lessons and their results).
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FACE_DOWN, FACE_LEFT, FACE_UP, ANIM_NOD, ANIM_BOUNCE, ANIM_SHAKE, testFlag,
  testFlagF, setFlag, wr, setText, advanceText, speak, askYesNo, agrees, gesture, faceToward, face, setPosition,
  movePlayer, waitPlayerMove, playerSpeed, nullScript, setActorScript, waitActorScript, fadeInAndWait,
  fadeOutAndWait, goToLocation, jumpTableTarget, wait, FZ, FC, hook, scene,
} from "./common.js";
import { testGameFlag, setGameFlag, flagOperand } from "../home/flags.js";
import { movePartyToNetCoachSpot, playerPartnerGesture, STORYLOC_TRAINING_COURT } from "./coach_walks_15.js";

const BANK = 0x15;
const BANK_BRIEFING = 0x17, ShowDrillBriefingScreen = 0x4487;
const ServeCoachWalkToCourtAndStartLesson = 0x7A96;      // practice_results_15.asm (not ported here)
const ACTOR_TRAINING_COURT_BOB_1 = 0x06, ACTOR_TRAINING_COURT_CURT = 0x07, ACTOR_TRAINING_COURT_ALLIE = 0x0C;
const ACTOR_TRAINING_COURT_BRIAN = 0x11, ACTOR_TRAINING_COURT_BETH = 0x12;
const ActorScript_15_10 = 0x6F9C, ActorScript_15_11 = 0x6FA7, ActorScript_15_12 = 0x6FBE;
const FLAG_WON_JUNIOR_SINGLES_RANK_1 = 0x53, FLAG_WON_SENIOR_SINGLES_RANK_1 = 0x57;
const FLAG_SERVE_CHALLENGER_DEFEATED = 0xBA, FLAG_NET_CHALLENGER_DEFEATED = 0xBB;
const FLAG_STROKE_CHALLENGER_DEFEATED = 0xBC, FLAG_SERVE_COACH_GREETED = 0xBD;
const MINIGAME_NET_GAME_PRACTICE_1 = 0x09, MINIGAME_NET_GAME_PRACTICE_2 = 0x0A, MINIGAME_NET_GAME_PRACTICE_3 = 0x0B;
const Text_37_28 = 0x1C1C, Text_37_31 = 0x1C1F, Text_37_42 = 0x1C2A, Text_37_46 = 0x1C2E, Text_37_57 = 0x1C39;
const Text_37_62 = 0x1C3E, Text_37_65 = 0x1C41, Text_37_67 = 0x1C43, Text_37_71 = 0x1C47, Text_37_72 = 0x1C48;
const Text_37_75 = 0x1C4B, Text_37_78 = 0x1C4E, Text_37_81 = 0x1C51, Text_37_84 = 0x1C54, Text_37_87 = 0x1C57;
const Text_37_90 = 0x1C5A, Text_37_93 = 0x1C5D, Text_37_99 = 0x1C63, Text_37_100 = 0x1C64, Text_37_134 = 0x1C86;
const Text_37_159 = 0x1C9F;
// the challengers' flag tables (a flag number per wMapSceneStage)
const TestServeChallengerGameFlagTable = 0x71F8, TestNetChallengerGameFlagTable = 0x723E;
const TestStrokeChallengerGameFlagTable = 0x7284;
const LESSON_ENTRY = 0x09;                              // the training court's entry after a lesson's drill
const FADE_SPEED = 16;

// WalkToStrokeChallengeCourtCutscene (15:6F51): the party after Allie to the stroke challenge court (the player to
// (24, 39)); the gesture cutscene; back to the training court at entry $0A after the match
export function* walkToStrokeChallengeCourtCutscene(P) {
  nullScript(P, ACTOR_PARTNER);
  yield* movePlayer(P, 24.0, 39.0);
  setActorScript(P, ACTOR_TRAINING_COURT_ALLIE, ActorScript_15_10);
  setActorScript(P, ACTOR_PLAYER, ActorScript_15_11);
  setActorScript(P, ACTOR_PARTNER, ActorScript_15_12);
  yield* waitActorScript(P, ACTOR_PLAYER);
  yield* playerPartnerGesture(P);
  goToLocation(P, STORYLOC_TRAINING_COURT, 0x0A);
}

// a lesson agreed: drill (wCurrentMinigameStoryMatch + 1), back to the training court at entry 9, a fade out and
// the drill's briefing screen (ShowDrillBriefingScreen, 17:4487)
function* startLessonAfterBriefing(P, drill) {
  wr(P, "currentMinigameStoryMatch", drill, 1);
  goToLocation(P, STORYLOC_TRAINING_COURT, LESSON_ENTRY);
  yield* fadeOutAndWait(P, FADE_SPEED);
  yield* P.runRom(BANK_BRIEFING, ShowDrillBriefingScreen);
}

// ---- the net coach (Beth) ----
// NetCoachVolleyLessonScene.loop (15:7068): her line for a no
function* netCoachDecline(P) { yield* speak(P, ACTOR_TRAINING_COURT_BETH); }
// her lessons: she turns to the party; the questions (n of them, from the text text(P) picks), then the walk to
// her spot and her lines
function* netCoachLesson(P, text, questions, lines, drill) {
  const BETH = ACTOR_TRAINING_COURT_BETH;
  faceToward(P, BETH, ACTOR_PARTNER);
  yield* setText(P, text(P));
  if (!(yield* agrees(P, BETH, questions))) return yield* netCoachDecline(P);
  yield* speak(P, BETH);
  yield* movePartyToNetCoachSpot(P);
  face(P, BETH, FACE_LEFT);
  yield* speak(P, BETH);
  yield* lines(P, BETH);
  yield* startLessonAfterBriefing(P, drill);
}
// NetCoachVolleyLessonScene (15:6FCF): its text by whether the junior singles are won; a bounce, the last line
export const netCoachVolleyLessonScene = P => netCoachLesson(P,
  P => testFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_1) ? Text_37_100 : Text_37_93, 2, function* (P, BETH) {
    yield* gesture(P, BETH, ANIM_BOUNCE);
    yield* setText(P, Text_37_99);
    yield* speak(P, BETH);
  }, MINIGAME_NET_GAME_PRACTICE_1);
// NetCoachSmashLessonScene (15:706E): three questions; a bounce and a nod with their lines
export const netCoachSmashLessonScene = P => netCoachLesson(P, () => Text_37_134, 3, function* (P, BETH) {
  yield* gesture(P, BETH, ANIM_BOUNCE);
  yield* speak(P, BETH);
  yield* gesture(P, BETH, ANIM_NOD);
  yield* speak(P, BETH);
}, MINIGAME_NET_GAME_PRACTICE_2);
// NetCoachDropShotLessonScene (15:711D): three questions; a bounce with its line
export const netCoachDropShotLessonScene = P => netCoachLesson(P, () => Text_37_159, 3, function* (P, BETH) {
  yield* gesture(P, BETH, ANIM_BOUNCE);
  yield* speak(P, BETH);
}, MINIGAME_NET_GAME_PRACTICE_3);

// ---- the challengers, hidden once beaten ----
// Test*ChallengerGameFlag: whether the flag of the table's entry for wMapSceneStage is set. Returns the ROM's
// registers: f (Z when clear), de = the flag number, a = its low byte, hl = past the entry's first byte.
function challengerFlagEntry(P, table) {
  const hl = (table + ((P.V.mapSceneStage * 2) & 0xFF)) & 0xFFFF, de = P.rom.u16(BANK, hl);
  return { a: de & 0xFF, de, hl: (hl + 1) & 0xFFFF };
}
export function testChallengerGameFlag(P, table) {
  const r = challengerFlagEntry(P, table);
  return { ...r, f: testFlagF(testGameFlag(P, flagOperand(r.de))) };
}
// Unused_15_Set*ChallengerGameFlag: the same entry's flag set; f from the last `rl d` of SetGameFlagByNumber
export function unusedSetChallengerGameFlag(P, table) {
  const r = challengerFlagEntry(P, table);
  setGameFlag(P, flagOperand(r.de));
  const d4 = (r.de << 4) >> 8 & 0xFF, out = (r.de << 5) >> 8 & 0xFF;
  return { ...r, f: (out ? 0 : FZ) | (d4 & 0x80 ? FC : 0) };
}
// Hide*ChallengerActor: the challenger out of sight (at (63, 63)) when beaten, or when the stage's flag is set
function hideChallenger(P, defeated, table, actor) {
  if (testFlag(P, defeated) || !(testChallengerGameFlag(P, table).f & FZ)) setPosition(P, actor, 63.0, 63.0);
}
// HideServeChallengerActor (15:71BE) / HideNetChallengerActor (15:7204) / HideStrokeChallengerActor (15:724A)
export const hideServeChallengerActor = P => hideChallenger(P, FLAG_SERVE_CHALLENGER_DEFEATED,
  TestServeChallengerGameFlagTable, ACTOR_TRAINING_COURT_BOB_1);
export const hideNetChallengerActor = P => hideChallenger(P, FLAG_NET_CHALLENGER_DEFEATED,
  TestNetChallengerGameFlagTable, ACTOR_TRAINING_COURT_BRIAN);
export const hideStrokeChallengerActor = P => hideChallenger(P, FLAG_STROKE_CHALLENGER_DEFEATED,
  TestStrokeChallengerGameFlagTable, ACTOR_TRAINING_COURT_ALLIE);

// ---- the serve coach (Curt) ----
// InitServeCoachScene (15:74E1): no location name; the player and the partner placed in front of Curt, facing him;
// a quick fade in
export function* initServeCoachScene(P) {
  P.V.storyModeShowLocationName = 0;
  playerSpeed(P, 7.5);
  setPosition(P, ACTOR_PLAYER, 19.0, 19.0);
  setPosition(P, ACTOR_PARTNER, 19.0, 17.0);
  yield* movePlayer(P, 19.0, 19.0);
  yield* waitPlayerMove(P);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  face(P, ACTOR_PARTNER, FACE_DOWN);
  face(P, ACTOR_TRAINING_COURT_CURT, FACE_UP);
  yield* fadeInAndWait(P, 4);
}
// InitServeCoachScene.speak (15:752C): his next line, then he turns back to his court
export function* serveCoachLastLine(P) {
  yield* speak(P, ACTOR_TRAINING_COURT_CURT);
  face(P, ACTOR_TRAINING_COURT_CURT, FACE_LEFT);
}
// ServeCoachIntroDialogue_15 (15:72C7): his greeting (other lines once the junior singles are won)
export function* serveCoachIntroDialogue(P) {
  const CURT = ACTOR_TRAINING_COURT_CURT, juniorWon = () => testFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_1);
  yield* initServeCoachScene(P);
  yield* setText(P, Text_37_28);
  yield* speak(P, CURT);
  if (juniorWon()) advanceText(P);
  faceToward(P, ACTOR_PLAYER, CURT);                    // .greet
  yield* gesture(P, CURT, ANIM_NOD);
  yield* speak(P, CURT);
  yield* gesture(P, CURT, ANIM_BOUNCE);
  yield* setText(P, Text_37_31);
  yield* speak(P, CURT);
  yield* gesture(P, CURT, ANIM_SHAKE);
  yield* speak(P, CURT);
  if (juniorWon()) advanceText(P);
  yield* speak(P, CURT);                                // .speakGreeting
  face(P, CURT, FACE_LEFT);
  setFlag(P, FLAG_SERVE_COACH_GREETED);
}
// his lines with gestures before each (after the first)
function* serveCoachLines(P, anims) {
  const CURT = ACTOR_TRAINING_COURT_CURT;
  yield* speak(P, CURT);
  faceToward(P, ACTOR_PLAYER, CURT);
  for (const anim of anims) {
    yield* gesture(P, CURT, anim);
    yield* speak(P, CURT);
  }
  face(P, CURT, FACE_LEFT);
}
// ServicePractice2Result0 (15:7336): the second practice's opening (its text from the senior singles on)
export function* servicePractice2Result0(P) {
  yield* initServeCoachScene(P);
  yield* setText(P, Text_37_42);
  if (testFlag(P, FLAG_WON_SENIOR_SINGLES_RANK_1)) yield* setText(P, Text_37_46);
  yield* serveCoachLines(P, [ANIM_NOD, ANIM_BOUNCE, ANIM_SHAKE]);  // (.lesson1Speak)
  yield* wait(P, 5);
  setFlag(P, FLAG_SERVE_COACH_GREETED);
}
// ServicePractice3Result0 (15:739C): the third practice's opening
export function* servicePractice3Result0(P) {
  yield* initServeCoachScene(P);
  yield* setText(P, Text_37_57);
  yield* serveCoachLines(P, [ANIM_NOD, ANIM_BOUNCE, ANIM_NOD]);
  setFlag(P, FLAG_SERVE_COACH_GREETED);
}

// ServeCoachChainedRetryPrompt (15:7465): a no ends it (his last line); a yes goes on to ServeCoachRetryPrompt
export function* serveCoachChainedRetryPrompt(P) {
  if ((yield* askYesNo(P, ACTOR_TRAINING_COURT_CURT)) !== 0) return yield* serveCoachLastLine(P);
  advanceText(P);
  yield* serveCoachRetryPrompt(P);
}
// ServeCoachRetryPrompt (15:747E): yes, the lesson again (ServeCoachTwoStageRetryPrompt.setText); no, his line
export function* serveCoachRetryPrompt(P) {
  if ((yield* askYesNo(P, ACTOR_TRAINING_COURT_CURT)) === 0) return yield* serveCoachRetryLesson(P);
  advanceText(P);
  yield* serveCoachLastLine(P);
}
// ServeCoachTwoStageRetryPrompt (15:749A): two questions (a yes to the first moves the dialogue on); a yes to the
// second, the lesson again; a no, his Text_37_71 line
export function* serveCoachTwoStageRetryPrompt(P) {
  if ((yield* askYesNo(P, ACTOR_TRAINING_COURT_CURT)) === 0) advanceText(P);
  if ((yield* askYesNo(P, ACTOR_TRAINING_COURT_CURT)) === 0) return yield* serveCoachRetryLesson(P);  // (.nonZero)
  yield* setText(P, Text_37_71);
  yield* serveCoachLastLine(P);
}
// ServeCoachTwoStageRetryPrompt.setText (15:74D2): his Text_37_65 line and the walk to the court for the lesson
// (ServeCoachWalkToCourtAndStartLesson, 15:7A96)
export function* serveCoachRetryLesson(P) {
  yield* setText(P, Text_37_65);
  yield* speak(P, ACTOR_TRAINING_COURT_CURT);
  yield* P.runRom(BANK, ServeCoachWalkToCourtAndStartLesson);
}
// ServicePractice*Result*: after a serve practice: Curt's words for the result, then a prompt
function serveCoachResult(text, prompt) {
  return function* (P) {
    yield* initServeCoachScene(P);
    yield* setText(P, text);
    yield* prompt(P);
  };
}
export const servicePractice1Result1 = serveCoachResult(Text_37_62, serveCoachChainedRetryPrompt);   // 15:73F0
export const servicePractice1Result2 = serveCoachResult(Text_37_67, serveCoachTwoStageRetryPrompt);  // 15:73FD
export const servicePractice1Result3 = serveCoachResult(Text_37_72, serveCoachRetryPrompt);          // 15:740A
export const servicePractice2Result3 = serveCoachResult(Text_37_75, serveCoachRetryPrompt);          // 15:7417
export const servicePractice2Result4 = serveCoachResult(Text_37_78, serveCoachRetryPrompt);          // 15:7424
export const servicePractice2Result5 = serveCoachResult(Text_37_81, serveCoachRetryPrompt);          // 15:7431
export const servicePractice2Result6 = serveCoachResult(Text_37_84, serveCoachRetryPrompt);          // 15:743E
export const servicePractice3Result4 = serveCoachResult(Text_37_87, serveCoachRetryPrompt);          // 15:744B
export const servicePractice3Result5 = serveCoachResult(Text_37_90, serveCoachRetryPrompt);          // 15:7458

// the result scenes of this bank, by address (the jump tables' targets)
const RESULT_SCENES = {
  0x72C7: serveCoachIntroDialogue, 0x7336: servicePractice2Result0, 0x739C: servicePractice3Result0,
  0x73F0: servicePractice1Result1, 0x73FD: servicePractice1Result2, 0x740A: servicePractice1Result3,
  0x7417: servicePractice2Result3, 0x7424: servicePractice2Result4, 0x7431: servicePractice2Result5,
  0x743E: servicePractice2Result6, 0x744B: servicePractice3Result4, 0x7458: servicePractice3Result5,
};
// *ResultScene: rst $00 on wDrillLessonResult through the table after it (the net-game practices' scenes are
// practice_results_15.asm's: the ROM's)
function* resultScene(P, table) {
  const target = jumpTableTarget(P, BANK, table, P.V.drillLessonResult);
  if (RESULT_SCENES[target]) return yield* RESULT_SCENES[target](P);
  yield* P.runRom(BANK, target);
}
export const servicePractice1ResultScene = P => resultScene(P, 0x7295);   // ServicePractice1ResultScene (15:7290)
export const servicePractice2ResultScene = P => resultScene(P, 0x72A4);   // ServicePractice2ResultScene (15:729F)
export const servicePractice3ResultScene = P => resultScene(P, 0x72B9);   // ServicePractice3ResultScene (15:72B4)
export const netGamePractice1ResultScene = P => resultScene(P, 0x753E);   // NetGamePractice1ResultScene (15:7539)
export const netGamePractice2ResultScene = P => resultScene(P, 0x7553);   // NetGamePractice2ResultScene (15:754E)
export const netGamePractice3ResultScene = P => resultScene(P, 0x7568);   // NetGamePractice3ResultScene (15:7563)

export const HOOKS = [
  scene(BANK, 0x6F51, walkToStrokeChallengeCourtCutscene),
  scene(BANK, 0x6FCF, netCoachVolleyLessonScene),
  scene(BANK, 0x7068, netCoachDecline),                                // NetCoachVolleyLessonScene.loop
  scene(BANK, 0x706E, netCoachSmashLessonScene),
  scene(BANK, 0x711D, netCoachDropShotLessonScene),
  [BANK, 0x71BE, hook(P => { hideServeChallengerActor(P); })],
  [BANK, 0x71D4, hook(P => testChallengerGameFlag(P, TestServeChallengerGameFlagTable))],
  [BANK, 0x71E6, hook(P => unusedSetChallengerGameFlag(P, TestServeChallengerGameFlagTable))],
  [BANK, 0x7204, hook(P => { hideNetChallengerActor(P); })],
  [BANK, 0x721A, hook(P => testChallengerGameFlag(P, TestNetChallengerGameFlagTable))],
  [BANK, 0x722C, hook(P => unusedSetChallengerGameFlag(P, TestNetChallengerGameFlagTable))],
  [BANK, 0x724A, hook(P => { hideStrokeChallengerActor(P); })],
  [BANK, 0x7260, hook(P => testChallengerGameFlag(P, TestStrokeChallengerGameFlagTable))],
  [BANK, 0x7272, hook(P => unusedSetChallengerGameFlag(P, TestStrokeChallengerGameFlagTable))],
  scene(BANK, 0x7290, servicePractice1ResultScene),
  scene(BANK, 0x729F, servicePractice2ResultScene),
  scene(BANK, 0x72B4, servicePractice3ResultScene),
  ...Object.entries(RESULT_SCENES).map(([addr, fn]) => scene(BANK, +addr, fn)),
  scene(BANK, 0x7465, serveCoachChainedRetryPrompt),
  scene(BANK, 0x747E, serveCoachRetryPrompt),
  scene(BANK, 0x749A, serveCoachTwoStageRetryPrompt),
  scene(BANK, 0x74D2, serveCoachRetryLesson),                         // ServeCoachTwoStageRetryPrompt.setText
  scene(BANK, 0x74E1, initServeCoachScene),
  scene(BANK, 0x752C, serveCoachLastLine),                            // InitServeCoachScene.speak
  scene(BANK, 0x7539, netGamePractice1ResultScene),
  scene(BANK, 0x754E, netGamePractice2ResultScene),
  scene(BANK, 0x7563, netGamePractice3ResultScene),
];
