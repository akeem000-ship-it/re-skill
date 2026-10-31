// The training court's serve coach and challengers (bank $15, $6253-$688E): the player to the lesson's court
// spot, the net-game and stroke matches' result texts (then challenger_15's result scenes), the serve
// challenger Bob's three challenges (two questions, his lines, the walk to the serve court, the match), the
// gesture cutscene after the walks, and the serve coach Curt's lessons by class (junior, senior, varsity: two
// questions, the party at his spot, the briefing screen). The actor scripts are data.
// Port of src/story/serve_coach_15.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss1_tc_*.mtrec (part 1's scripted lessons and results), out/port/ss2_tc_curt_*.mtrec,
// ss2_tc_npc06.mtrec, ss2_tc_stm3_*.mtrec (scripted: the serve challenger and coach, the stroke match 3's results).
import {
  ACTOR_PARTNER, ACTOR_PLAYER, ANIM_BOUNCE, ANIM_NOD, ANIM_SHAKE, FACE_RIGHT, FACE_UP, FLAG_DOUBLES, agrees, face,
  faceToward, fadeOutAndWait, followPlayer, gesture, goToLocation, movePlayer, moveTarget, nullScript, rd, scene,
  setActorScript, setText, speak, testFlag, wait, waitActorScript, waitMove, wr, wr16,
} from "./common.js";
import { runTrainingDrill, movePartyToServeCoachSpot, STORYLOC_TRAINING_COURT } from "./coach_walks_15.js";
import { netChallengerResultScene, strokeChallengerResultScene } from "./challenger_15.js";

const BANK = 0x15;
const ACTOR_TRAINING_COURT_BOB_1 = 0x06, ACTOR_TRAINING_COURT_CURT = 0x07;
const BOB = ACTOR_TRAINING_COURT_BOB_1, CURT = ACTOR_TRAINING_COURT_CURT;
const ActorScript_15_04 = 0x66C8, ActorScript_15_05 = 0x66D3, ActorScript_15_06 = 0x66E4;
const FLAG_WON_JUNIOR_SINGLES_RANK_1 = 0x53;
const MINIGAME_SERVICE_MATCH_1 = 0x00, MINIGAME_SERVICE_MATCH_2 = 0x01, MINIGAME_SERVICE_MATCH_3 = 0x02;
const MINIGAME_SERVICE_PRACTICE_1 = 0x03, MINIGAME_SERVICE_PRACTICE_2 = 0x04, MINIGAME_SERVICE_PRACTICE_3 = 0x05;
const FIRST_NET_MATCH = 0x04, FIRST_RETURN_LESSON = 0x0A;   // the drills (wCurrentMinigameStoryMatch + 1) by court
const MATCH_ENTRY = 0x0A, LESSON_ENTRY = 0x09;          // the training court's entries after a match / a lesson
const Text_6e_20 = 0x2014, Text_6e_38 = 0x2026, Text_6e_52 = 0x2034, Text_6e_74 = 0x204A, Text_6e_77 = 0x204D;
const Text_6e_79 = 0x204F, Text_6e_80 = 0x2050, Text_6e_81 = 0x2051, Text_6e_83 = 0x2053, Text_6e_95 = 0x205F;
const Text_6e_96 = 0x2060, Text_6e_108 = 0x206C, Text_6e_109 = 0x206D, Text_6e_120 = 0x2078, Text_6e_123 = 0x207B;
const Text_6e_125 = 0x207D, Text_6e_126 = 0x207E, Text_6e_127 = 0x207F, Text_6e_130 = 0x2082, Text_6e_145 = 0x2091;
const Text_6e_146 = 0x2092, Text_6e_163 = 0x20A3, Text_6e_164 = 0x20A4;
const Text_37_16 = 0x1C10, Text_37_22 = 0x1C16, Text_37_36 = 0x1C24, Text_37_51 = 0x1C33;
// routines of other banks (run as the ROM's, or the JS another part hooked there)
const ShowDrillBriefingScreen = [0x17, 0x4487];
const juniorWon = P => testFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_1);

// MovePlayerToLessonCourtSpot (15:6253): the player to the court of the drill (wCurrentMinigameStoryMatch + 1):
// the serve court (19, 19) below the net games, the net-game court (45, 43) below the return lessons, else the
// return court (19, 43); the partner follows again
export function* movePlayerToLessonCourtSpot(P) {
  const drill = rd(P, "currentMinigameStoryMatch", 1);
  const [x, y] = drill >= FIRST_RETURN_LESSON ? [19.0, 43.0] : drill < FIRST_NET_MATCH ? [19.0, 19.0] : [45.0, 43.0];
  moveTarget(P, ACTOR_PLAYER, x, y);
  yield* waitMove(P, ACTOR_PLAYER);
  followPlayer(P, ACTOR_PARTNER);
}

// the challenger's texts for the match's result scene (wChallenger*TextId), then the scene
function* challengerResult(P, scene, followup, lose, win, draw) {
  wr16(P, "challengerFollowupTextId", followup);
  wr16(P, "challengerLoseTextId", lose);
  wr16(P, "challengerWinTextId", win);
  wr16(P, "challengerDrawTextId", draw);
  yield* scene(P);
}
// NetGameMatch1ResultScene (15:62BF) .. NetGameMatch3ResultScene (15:6328): Brian's lines (match 1's win and draw
// lines others once the junior singles are won)
export const netGameMatch1ResultScene = P => challengerResult(P, netChallengerResultScene, Text_6e_77, Text_6e_74,
  juniorWon(P) ? Text_6e_80 : Text_6e_79, juniorWon(P) ? Text_6e_83 : Text_6e_81);
export const netGameMatch2ResultScene = P => challengerResult(P, netChallengerResultScene, Text_6e_77, Text_6e_74,
  Text_6e_95, Text_6e_96);
export const netGameMatch3ResultScene = P => challengerResult(P, netChallengerResultScene, Text_6e_77, Text_6e_74,
  Text_6e_108, Text_6e_109);
// StrokeMatch1ResultScene (15:6350) .. StrokeMatch3ResultScene (15:63B9): Allie's lines
export const strokeMatch1ResultScene = P => challengerResult(P, strokeChallengerResultScene, Text_6e_123, Text_6e_120,
  juniorWon(P) ? Text_6e_126 : Text_6e_125, juniorWon(P) ? Text_6e_130 : Text_6e_127);
export const strokeMatch2ResultScene = P => challengerResult(P, strokeChallengerResultScene, Text_6e_123, Text_6e_120,
  Text_6e_145, Text_6e_146);
export const strokeMatch3ResultScene = P => challengerResult(P, strokeChallengerResultScene, Text_6e_123, Text_6e_120,
  Text_6e_163, Text_6e_164);

// the serve challenger Bob's challenge: turned to the pair, two questions (a no: his last line,
// ServiceAceMatchChallengeScene.loop); his lines, each after a gesture or a pause ([anim] or frames); the walk to
// the serve court, back to the training court at entry $0A after the match
function* serveChallenge(P, text, lines, match) {
  faceToward(P, BOB, ACTOR_PARTNER);
  yield* setText(P, text);
  if (!(yield* agrees(P, BOB, 2))) return yield* speak(P, BOB);
  yield* speak(P, BOB);
  yield* gesture(P, BOB, ANIM_NOD);
  face(P, BOB, FACE_RIGHT);
  yield* wait(P, 40);
  faceToward(P, ACTOR_PLAYER, BOB);
  yield* speak(P, BOB);
  for (const [pause, anim] of lines) {
    if (pause) yield* wait(P, pause);
    if (anim !== null) yield* gesture(P, BOB, anim);
    yield* speak(P, BOB);
  }
  yield* walkToServeChallengeCourtCutscene(P);
  goToLocation(P, STORYLOC_TRAINING_COURT, MATCH_ENTRY);
  yield* runTrainingDrill(P, match);
}
// ServiceAceMatchChallengeScene (15:63E1) / CenterLineServeMatchChallengeScene (15:64A8) /
// AcademyRulesServeMatchChallengeScene (15:6586): the three serve matches
export const serviceAceMatchChallengeScene = P => serveChallenge(P, Text_6e_20,
  [[0, ANIM_NOD], [40, ANIM_BOUNCE], [0, ANIM_NOD]], MINIGAME_SERVICE_MATCH_1);
export const centerLineServeMatchChallengeScene = P => serveChallenge(P, Text_6e_38,
  [[0, ANIM_SHAKE], [20, null], [0, ANIM_NOD], [20, ANIM_BOUNCE], [0, ANIM_NOD]], MINIGAME_SERVICE_MATCH_2);
export const academyRulesServeMatchChallengeScene = P => serveChallenge(P, Text_6e_52,
  [[0, ANIM_NOD], [40, ANIM_BOUNCE], [0, ANIM_NOD]], MINIGAME_SERVICE_MATCH_3);
// ServiceAceMatchChallengeScene.loop (15:64A2): his line (a challenge declined)
export function* serveChallengerDeclineLine(P) { yield* speak(P, BOB); }

// PlayerPartnerGestureCutscene (15:6647): the player nods (doubles: the partner turned to the player nods too, the
// player then facing up); 10 frames
export function* playerPartnerGestureCutscene(P) {
  if (testFlag(P, FLAG_DOUBLES)) {
    faceToward(P, ACTOR_PARTNER, ACTOR_PLAYER);
    yield* gesture(P, ACTOR_PLAYER, ANIM_NOD);
    yield* gesture(P, ACTOR_PARTNER, ANIM_NOD);
    face(P, ACTOR_PLAYER, FACE_UP);
  } else yield* gesture(P, ACTOR_PLAYER, ANIM_NOD);     // .playerOnly
  yield* wait(P, 10);
}
// WalkToServeChallengeCourtCutscene (15:668F): Bob, the player and the partner on their walk scripts to the serve
// court (the player to (24, 15)); the gesture cutscene
export function* walkToServeChallengeCourtCutscene(P) {
  nullScript(P, ACTOR_PARTNER);
  yield* movePlayer(P, 24.0, 15.0);
  setActorScript(P, ACTOR_PLAYER, ActorScript_15_05);
  setActorScript(P, BOB, ActorScript_15_04);
  setActorScript(P, ACTOR_PARTNER, ActorScript_15_06);
  yield* waitActorScript(P, ACTOR_PLAYER);
  yield* playerPartnerGestureCutscene(P);
}

// SpeakServeCoachDeclineLine (15:66EF): Curt's line (a lesson declined)
export function* speakServeCoachDeclineLine(P) { yield* speak(P, CURT); }
// Curt's lesson: turned to the pair, two questions (a no: his decline line); his line, the party at his spot, his
// next line; the lesson's drill set, back to the training court at entry 9 after it; faded out, its briefing
function* serveCoachLesson(P, text, lesson) {
  faceToward(P, CURT, ACTOR_PARTNER);
  yield* setText(P, text);
  if (!(yield* agrees(P, CURT, 2))) return yield* speakServeCoachDeclineLine(P);
  yield* speak(P, CURT);
  yield* movePartyToServeCoachSpot(P);
  face(P, CURT, FACE_RIGHT);
  yield* wait(P, 20);
  yield* speak(P, CURT);
  wr(P, "currentMinigameStoryMatch", lesson, 1);
  goToLocation(P, STORYLOC_TRAINING_COURT, LESSON_ENTRY);
  yield* fadeOutAndWait(P, 16);
  yield* P.runRom(...ShowDrillBriefingScreen);
}
// ServeCoachJuniorLessonScene (15:66F5) / ServeCoachSeniorLessonScene (15:677E) / ServeCoachVarsityLessonScene
// (15:67FC): the serve practices 1-3 (the junior lesson's text another once the junior singles are won)
export const serveCoachJuniorLessonScene = P => serveCoachLesson(P, juniorWon(P) ? Text_37_22 : Text_37_16,
  MINIGAME_SERVICE_PRACTICE_1);
export const serveCoachSeniorLessonScene = P => serveCoachLesson(P, Text_37_36, MINIGAME_SERVICE_PRACTICE_2);
export const serveCoachVarsityLessonScene = P => serveCoachLesson(P, Text_37_51, MINIGAME_SERVICE_PRACTICE_3);
// Unused_15_SpeakServeCoachLines (15:687A): four of Curt's lines (nothing calls it)
export function* unusedSpeakServeCoachLines(P) {
  for (let i = 0; i < 4; i++) yield* speak(P, CURT);
}

export const HOOKS = [
  scene(BANK, 0x6253, movePlayerToLessonCourtSpot),
  scene(BANK, 0x62BF, netGameMatch1ResultScene),
  scene(BANK, 0x6300, netGameMatch2ResultScene),
  scene(BANK, 0x6328, netGameMatch3ResultScene),
  scene(BANK, 0x6350, strokeMatch1ResultScene),
  scene(BANK, 0x6391, strokeMatch2ResultScene),
  scene(BANK, 0x63B9, strokeMatch3ResultScene),
  scene(BANK, 0x63E1, serviceAceMatchChallengeScene),
  scene(BANK, 0x64A2, serveChallengerDeclineLine),        // ServiceAceMatchChallengeScene.loop
  scene(BANK, 0x64A8, centerLineServeMatchChallengeScene),
  scene(BANK, 0x6586, academyRulesServeMatchChallengeScene),
  scene(BANK, 0x6647, playerPartnerGestureCutscene),
  scene(BANK, 0x668F, walkToServeChallengeCourtCutscene),
  scene(BANK, 0x66EF, speakServeCoachDeclineLine),
  scene(BANK, 0x66F5, serveCoachJuniorLessonScene),
  scene(BANK, 0x677E, serveCoachSeniorLessonScene),
  scene(BANK, 0x67FC, serveCoachVarsityLessonScene),
  scene(BANK, 0x687A, unusedSpeakServeCoachLines),
];
