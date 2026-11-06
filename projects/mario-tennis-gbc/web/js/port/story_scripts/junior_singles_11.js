// The junior class's singles court (bank $11, $681F-$70A2): the coach's step-on and ranking match offer, the
// students' lines by the junior singles ranks won (Brian's practice match), the NPC record lists by the story's
// progress, and back from a ranking match: the win's scene (entry $0D) by the match beaten (rank 4 Pam, 3 Curt,
// 2 Beth, 1 Bob: the junior title).
// The tables (JuniorClassCourtSinglesMapScripts_11, its lists, the NPC record lists A-D, ActorScript_11_22..29) are
// data.
// Port of src/story/junior_singles_11.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/engine/rec1.mtrec, rec2.mtrec (the court's init and the coach) and out/port/ss1_jrsingles*.mtrec
// (scripted: the court by the singles ranks, the match returns).
import {
  ACTOR_PLAYER, FACE_DOWN, FACE_UP, FACE_LEFT, FACE_RIGHT, ANIM_BOUNCE, ANIM_NOD, WRAM_ACTORS, MATCHLIST_SINGLES,
  testFlag, setText, advanceText, speak, askYesNo, setAnim, waitIdle, wait, face, faceToward, lockFacing,
  unlockFacing, setPosition, moveTarget, waitMove, movePlayer, waitPlayerMove, setSpeed, playerSpeed, jumpVelocity,
  waitJump, setActorScript, fadeIn, waitFadeEnd, fadeOutAndWait, sound, goToLocation, returnHereAfter,
  playStoryMatch, setNpcScripts, jumpTableTarget, hook, scene,
} from "./common.js";
import {
  parkMiddleCourtPracticePair, parkLeftCourtPracticePairRightSide, resumeMiddleCourtPractice, resumeLeftCourtPractice,
} from "./court_practice_11.js";

const BANK = 0x11;
// the singles court's actors (JuniorClassCourtSinglesActors_11)
const ACTOR_JUNIOR_CLASS_COURT_SINGLES_WALK_72_00 = 0x03, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BOB = 0x04;
const ACTOR_JUNIOR_CLASS_COURT_SINGLES_BETH = 0x05, ACTOR_JUNIOR_CLASS_COURT_SINGLES_CURT = 0x06;
const ACTOR_JUNIOR_CLASS_COURT_SINGLES_PAM = 0x07, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BRIAN = 0x08;
const ACTOR_JUNIOR_CLASS_COURT_SINGLES_FAY = 0x09, ACTOR_JUNIOR_CLASS_COURT_SINGLES_ALLIE = 0x0A;
const ACTOR_JUNIOR_CLASS_COURT_SINGLES_JOY = 0x0B, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BALLOON_SWEAT = 0x12;
const STORYLOC_JUNIOR_CLASS_COURT_SINGLES = 0x0B;
const STORYMATCH_JUNIOR_PRACTICE = 0x00;
const WINLOSE_WIN = 0x01, MATCH_EXIT_REQUESTED = 0x01;
const SFX_APPEAR2 = 0x96;
const FLAG_WON_ISLAND_OPEN_DOUBLES_FINAL = 0x35, FLAG_WON_JUNIOR_SINGLES_RANK_4 = 0x50, FLAG_WON_JUNIOR_SINGLES_RANK_3 = 0x51;
const FLAG_WON_JUNIOR_SINGLES_RANK_2 = 0x52, FLAG_WON_JUNIOR_SINGLES_RANK_1 = 0x53, FLAG_WON_SENIOR_SINGLES_RANK_1 = 0x57;
const FLAG_JUNIOR_COURT_NPC0A_TALKED = 0x82, FLAG_REACHED_ISLAND_OPEN_SINGLES = 0xAE, FLAG_STORY_COMPLETE_SINGLES = 0xB0;
const Text_32_51 = 0x0833, Text_32_53 = 0x0835, Text_32_54 = 0x0836, Text_32_55 = 0x0837, Text_32_62 = 0x083E;
const Text_32_65 = 0x0841, Text_32_69 = 0x0845, Text_32_70 = 0x0846, Text_32_75 = 0x084B, Text_32_77 = 0x084D;
const Text_32_81 = 0x0851, Text_32_82 = 0x0852, Text_32_83 = 0x0853, Text_32_86 = 0x0856, Text_32_87 = 0x0857;
const Text_32_88 = 0x0858, Text_32_89 = 0x0859, Text_33_15 = 0x0C0F, Text_33_16 = 0x0C10, Text_33_31 = 0x0C1F;
// data of this bank (read from the ROM)
const JuniorClassCourtSinglesNpcScriptsA_11 = 0x6BA5, JuniorClassCourtSinglesNpcScriptsB_11 = 0x6BE6;
const JuniorClassCourtSinglesNpcScriptsC_11 = 0x6C27, JuniorClassCourtSinglesNpcScriptsD_11 = 0x6C68;
const ActorScript_11_33 = 0x7682, ActorScript_11_37 = 0x76DE, ActorScript_11_40 = 0x7717, ActorScript_11_47 = 0x7BBD;
const Entry0dSceneJumpTable = 0x6EA9;                 // (after its rst $00: four scenes)
// routines not ported here (src/story/ranking_challenge_11.asm); bank $1E's stub
const OfferSinglesRankingMatch = 0x7784, BANK_EXP = 0x1E, StubNop_1e = 0x6533;
const YES = 0;

// script_set_anim actor, anim / script_wait_idle actor
function* animIdle(P, actor, anim) {
  setAnim(P, actor, anim);
  yield* waitIdle(P, actor);
}

// JuniorClassCourtSinglesNpc03FaceUp_11 (11:693D): the coach's step-on: the player backs up to him (facing kept),
// then the ranking match offer (JuniorClassCourtSinglesNpc03_11, next)
export function* juniorClassCourtSinglesNpc03FaceUp(P) {
  setSpeed(P, ACTOR_PLAYER, 0.25);
  lockFacing(P, ACTOR_PLAYER);
  moveTarget(P, ACTOR_PLAYER, 19.0, 21.0);
  yield* waitMove(P, ACTOR_PLAYER);
  unlockFacing(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* juniorClassCourtSinglesNpc03(P);
}
// JuniorClassCourtSinglesNpc03_11 (11:696A): the coach: the singles ranking match offer (ranking_challenge_11.asm)
export function* juniorClassCourtSinglesNpc03(P) { yield* P.runRom(BANK, OfferSinglesRankingMatch); }
// JuniorClassCourtSinglesNpc04_11 (11:696E): Bob: his line, the next while rank 1 is not won, the third while
// rank 2 is not won either
export function* juniorClassCourtSinglesNpc04(P) {
  yield* setText(P, Text_32_62);
  if (!testFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_1)) {
    advanceText(P);
    if (!testFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_2)) advanceText(P);
  }
  yield* speak(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BOB);
}
// JuniorClassCourtSinglesNpc05_11 (11:698A): Beth: once rank 2 is won her line; with rank 3 won (not 2) a
// question (no: the other answer); before both another line
export function* juniorClassCourtSinglesNpc05(P) {
  const BETH = ACTOR_JUNIOR_CLASS_COURT_SINGLES_BETH;
  yield* setText(P, Text_32_65);
  if (!testFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_2)) {
    advanceText(P);
    if (testFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_3)) {                // .speak
      if ((yield* askYesNo(P, BETH)) !== YES) advanceText(P);
      yield* speak(P, BETH);                                          // .done
      return;
    }
    yield* setText(P, Text_32_69);
  }
  yield* speak(P, BETH);                                              // .altText
}
// JuniorClassCourtSinglesNpc06_11 (11:69C7): Curt: his line, the next while rank 3 is not won, then with rank 4
// not won either a question (no: the other answer)
export function* juniorClassCourtSinglesNpc06(P) {
  const CURT = ACTOR_JUNIOR_CLASS_COURT_SINGLES_CURT;
  yield* setText(P, Text_32_70);
  if (!testFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_3)) {
    advanceText(P);
    if (!testFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_4)) {
      advanceText(P);
      if ((yield* askYesNo(P, CURT)) !== YES) advanceText(P);
    }
  }
  yield* speak(P, CURT);                                              // .speak
}
// JuniorClassCourtSinglesNpc07_11 (11:69FB): Pam: her line, the next before rank 4 is won
export function* juniorClassCourtSinglesNpc07(P) {
  yield* setText(P, Text_32_75);
  if (!testFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_4)) advanceText(P);
  yield* speak(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_PAM);
}
// JuniorClassCourtSinglesNpc08_11 (11:6A0F): Brian: once rank 4 is won a line; otherwise two questions and on
// two yeses the practice match against him (STORYMATCH_JUNIOR_PRACTICE), the player back at the same place after.
export function* juniorClassCourtSinglesNpc08(P) {
  const BRIAN = ACTOR_JUNIOR_CLASS_COURT_SINGLES_BRIAN;
  if (testFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_4)) {
    yield* setText(P, Text_32_86);
    yield* speak(P, BRIAN);
    return;
  }
  yield* setText(P, Text_32_77);                                      // .altText
  if ((yield* askYesNo(P, BRIAN)) !== YES) { yield* speak(P, BRIAN); return; }   // .speak
  advanceText(P);                                                     // .done
  if ((yield* askYesNo(P, BRIAN)) !== YES) { yield* speak(P, BRIAN); return; }
  yield* animIdle(P, ACTOR_PLAYER, ANIM_NOD);
  yield* movePlayer(P, 43.0, 17.0);
  moveTarget(P, ACTOR_PLAYER, 39.0, 25.0);
  yield* wait(P, 30);
  moveTarget(P, BRIAN, 43.0, 9.0);
  yield* waitMove(P, BRIAN);
  face(P, BRIAN, FACE_DOWN);
  yield* waitMove(P, ACTOR_PLAYER);
  moveTarget(P, ACTOR_PLAYER, 45.0, 25.0);
  yield* waitMove(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* wait(P, 60);
  returnHereAfter(P);
  yield* playStoryMatch(P, MATCHLIST_SINGLES, STORYMATCH_JUNIOR_PRACTICE);
}
// JuniorClassCourtSinglesNpc09_11 (11:6AE9) / Npc0A (11:6B00): Fay and Allie: a line, another once rank 4 is won
function* lineThenWon(P, text, wonText, actor) {
  yield* setText(P, text);
  if (testFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_4)) yield* setText(P, wonText);
  yield* speak(P, actor);
}
export const juniorClassCourtSinglesNpc09 = P => lineThenWon(P, Text_32_81, Text_32_87, ACTOR_JUNIOR_CLASS_COURT_SINGLES_FAY);
export const juniorClassCourtSinglesNpc0A = P => lineThenWon(P, Text_32_82, Text_32_88, ACTOR_JUNIOR_CLASS_COURT_SINGLES_ALLIE);
// JuniorClassCourtSinglesNpc0B_11 (11:6B17): Joy: once rank 4 is won a line, else a question (no: the other answer)
export function* juniorClassCourtSinglesNpc0B(P) {
  const JOY = ACTOR_JUNIOR_CLASS_COURT_SINGLES_JOY;
  faceToward(P, ACTOR_PLAYER, JOY);
  if (testFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_4)) {
    yield* setText(P, Text_32_89);
    yield* speak(P, JOY);
    return;
  }
  yield* setText(P, Text_32_83);                                      // .setText
  if ((yield* askYesNo(P, JOY)) !== YES) advanceText(P);
  yield* speak(P, JOY);                                               // .speak
}
// JuniorClassCourtSinglesDNpc0A_11 (11:6CA9): Allie (list D): a line, or once talked to (FLAG_JUNIOR_COURT_NPC0A_
// TALKED) a question (no: the other answer), after which, once the doubles Island Open is won, a last line
export function* juniorClassCourtSinglesDNpc0A(P) {
  const ALLIE = ACTOR_JUNIOR_CLASS_COURT_SINGLES_ALLIE;
  if (!testFlag(P, FLAG_JUNIOR_COURT_NPC0A_TALKED)) {
    yield* setText(P, Text_33_15);
    yield* speak(P, ALLIE);
    return;
  }
  yield* setText(P, Text_33_16);                                      // .altText
  if ((yield* askYesNo(P, ALLIE)) !== YES) advanceText(P);
  if (!testFlag(P, FLAG_WON_ISLAND_OPEN_DOUBLES_FINAL)) { yield* speak(P, ALLIE); return; }   // .speak
  yield* animIdle(P, ALLIE, ANIM_NOD);                                // .done
  yield* setText(P, Text_33_31);
  yield* speak(P, ALLIE);
}

// JuniorClassCourtSinglesInitScript_11 (11:6CFE): with rank 4 won Pam stands at the side; by the entry the
// match's return ($0F) or the ranking scenes ($0E, $0D); otherwise the NPC records of the singles progress (A
// junior rank 1, B senior rank 1, C Island Open, D complete; in A and B Allie walks about, ActorScript_11_47) with
// Bob away at (63, 41).
export function* juniorClassCourtSinglesInitScript(P) {
  if (testFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_4)) {
    setPosition(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_PAM, 37.0, 11.0);
    face(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_PAM, FACE_RIGHT);
  }
  switch (P.V.storyModeEntryPoint) {                                  // .stage2
    case 0x0F: return yield* juniorClassCourtSinglesMatchReturn(P);
    case 0x0E: return yield* juniorClassCourtSinglesEntry0eScene(P);
    case 0x0D: return yield* juniorClassCourtSinglesEntry0dScene(P);
  }
  let list, allieWalks = false;
  if (testFlag(P, FLAG_STORY_COMPLETE_SINGLES)) list = JuniorClassCourtSinglesNpcScriptsD_11;
  else if (testFlag(P, FLAG_REACHED_ISLAND_OPEN_SINGLES)) list = JuniorClassCourtSinglesNpcScriptsC_11;
  else if (testFlag(P, FLAG_WON_SENIOR_SINGLES_RANK_1)) { list = JuniorClassCourtSinglesNpcScriptsB_11; allieWalks = true; }
  else if (testFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_1)) { list = JuniorClassCourtSinglesNpcScriptsA_11; allieWalks = true; }
  else return;
  setNpcScripts(P, list);
  if (allieWalks) {
    setPosition(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_ALLIE, 61.0, 17.0);
    setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_ALLIE, ActorScript_11_47);
  }
  setPosition(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BOB, 63.0, 41.0);
}

// JuniorClassCourtSinglesMatchReturn (11:6E4D): back from a ranking match: a win (not given up) goes on to the
// ranking scene; otherwise the player walks back to the coach.
export function* juniorClassCourtSinglesMatchReturn(P) {
  const { bus } = P;
  P.wramBank(WRAM_ACTORS);
  if (bus.u8(P.A.matchExitRequest) !== MATCH_EXIT_REQUESTED && bus.u8(P.A.matchWinLoseFlag) === WINLOSE_WIN)
    return yield* juniorClassCourtSinglesEntry0eScene(P);
  playerSpeed(P, 2.0);                                                // .eq01
  yield* movePlayer(P, 19.0, 21.0);
  setPosition(P, ACTOR_PLAYER, 19.0, 21.0);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* waitPlayerMove(P);
}
// JuniorClassCourtSinglesEntry0eScene (11:6E88): the court again, at entry $0D (the ranking scene)
export function* juniorClassCourtSinglesEntry0eScene(P) {
  goToLocation(P, STORYLOC_JUNIOR_CLASS_COURT_SINGLES, 0x0D);
  P.callRom(BANK_EXP, StubNop_1e);
}
// JuniorClassCourtSinglesEntry0dScene (11:6E9E): the ranking scene of the match won (its index - 1 through the
// jump table)
export function* juniorClassCourtSinglesEntry0dScene(P) {
  P.V.storyModeShowLocationName = 0;
  const index = (P.bus.u8(P.A.currentMinigameStoryMatch + 1) - 1) & 0xFF;
  const target = jumpTableTarget(P, BANK, Entry0dSceneJumpTable, index);
  const scenes = { 0x6EB1: pamBeaten, 0x6F44: curtBeaten, 0x6FDD: bethBeaten, 0x7076: bobBeaten };
  if (scenes[target]) return yield* scenes[target](P);
  yield* P.runRom(BANK, target);                                      // (an index past the table: the ROM's jump)
}
// a beaten student and the coach by the court (the court's practice pair parked meanwhile): the student's line,
// the coach jumps and speaks, the student walks off, the player back to the coach, the pair resumes
function* beatenScene(P, park, student, sx, sy, px, coachFacing, lines, script, resume) {
  const COACH = ACTOR_JUNIOR_CLASS_COURT_SINGLES_WALK_72_00;
  yield* park(P);
  playerSpeed(P, 2.0);
  setPosition(P, student, sx, sy);
  setPosition(P, ACTOR_PLAYER, px, 20.0);
  yield* movePlayer(P, px, 15.0);
  yield* waitPlayerMove(P);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, student, FACE_DOWN);
  face(P, COACH, coachFacing);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  yield* setText(P, lines[0]);
  yield* speak(P, student);
  jumpVelocity(P, COACH, -2.0);
  yield* waitJump(P, COACH);
  if (lines[1]) yield* setText(P, lines[1]);
  yield* speak(P, COACH);
  setActorScript(P, student, script);
  moveTarget(P, ACTOR_PLAYER, 19.0, 21.0);
  yield* waitMove(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  yield* resume(P);
  face(P, COACH, FACE_DOWN);
}
// .parkMiddleCourtPracticePair: rank 4 (Pam) beaten
const pamBeaten = P => beatenScene(P, function* () { parkMiddleCourtPracticePair(P); }, ACTOR_JUNIOR_CLASS_COURT_SINGLES_PAM,
  26.0, 9.0, 26.0, FACE_RIGHT, [Text_32_51, 0], ActorScript_11_33, resumeMiddleCourtPractice);
// .parkLeftCourtPracticePairRightSide: rank 3 (Curt) beaten
const curtBeaten = P => beatenScene(P, parkLeftCourtPracticePairRightSide, ACTOR_JUNIOR_CLASS_COURT_SINGLES_CURT,
  9.0, 9.0, 11.0, FACE_LEFT, [Text_32_70, Text_32_53], ActorScript_11_37, resumeLeftCourtPractice);
// .parkLeftCourtPracticePairRightSide2: rank 2 (Beth) beaten
const bethBeaten = P => beatenScene(P, parkLeftCourtPracticePairRightSide, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BETH,
  9.0, 9.0, 11.0, FACE_LEFT, [Text_32_65, Text_32_54], ActorScript_11_40, resumeLeftCourtPractice);
// .waitPlayerMoveDone: rank 1 (Bob) beaten: the junior singles title: the coach's speech, Bob's sweat; on to the
// court's entry 1
function* bobBeaten(P) {
  const COACH = ACTOR_JUNIOR_CLASS_COURT_SINGLES_WALK_72_00, BOB = ACTOR_JUNIOR_CLASS_COURT_SINGLES_BOB;
  playerSpeed(P, 2.0);
  setPosition(P, COACH, 19.0, 31.0);
  setPosition(P, BOB, 26.0, 11.0);
  setPosition(P, ACTOR_PLAYER, 26.0, 20.0);
  yield* movePlayer(P, 26.0, 17.0);
  yield* waitPlayerMove(P);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, BOB, FACE_DOWN);
  face(P, COACH, FACE_UP);
  parkMiddleCourtPracticePair(P);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  yield* wait(P, 60);
  yield* setText(P, Text_32_55);
  moveTarget(P, BOB, 26.0, 13.0);
  yield* waitMove(P, BOB);
  setAnim(P, BOB, ANIM_BOUNCE);
  yield* speak(P, BOB);
  setAnim(P, COACH, ANIM_NOD);
  yield* speak(P, COACH);
  setAnim(P, BOB, ANIM_BOUNCE);
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  playerSpeed(P, 0.5);
  setSpeed(P, COACH, 0.5);
  yield* movePlayer(P, 19.0, 25.0);
  moveTarget(P, COACH, 19.0, 27.0);
  yield* waitMove(P, COACH);
  yield* waitPlayerMove(P);
  yield* movePlayer(P, 26.0, 20.0);
  moveTarget(P, COACH, 26.0, 23.0);
  yield* waitMove(P, COACH);
  face(P, COACH, FACE_UP);
  yield* animIdle(P, COACH, ANIM_BOUNCE);
  yield* speak(P, COACH);
  yield* animIdle(P, ACTOR_PLAYER, ANIM_NOD);
  yield* animIdle(P, COACH, ANIM_NOD);
  yield* speak(P, COACH);
  moveTarget(P, COACH, 26.0, 22.0);
  yield* waitMove(P, COACH);
  yield* animIdle(P, COACH, ANIM_BOUNCE);
  yield* wait(P, 30);
  setAnim(P, COACH, ANIM_NOD);
  yield* animIdle(P, ACTOR_PLAYER, ANIM_NOD);
  yield* speak(P, ACTOR_PLAYER);
  yield* animIdle(P, COACH, ANIM_BOUNCE);
  yield* speak(P, COACH);
  yield* animIdle(P, ACTOR_PLAYER, ANIM_NOD);
  yield* animIdle(P, COACH, ANIM_NOD);
  yield* animIdle(P, ACTOR_PLAYER, ANIM_BOUNCE);
  face(P, ACTOR_PLAYER, FACE_UP);
  setPosition(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BALLOON_SWEAT, 27.5, 18.5);
  sound(P, SFX_APPEAR2);
  yield* wait(P, 40);
  setAnim(P, BOB, ANIM_BOUNCE);
  yield* wait(P, 40);
  moveTarget(P, BOB, 26.0, 14.0);
  yield* waitMove(P, BOB);
  setPosition(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BALLOON_SWEAT, 63.0, 63.0);
  yield* speak(P, BOB);
  goToLocation(P, STORYLOC_JUNIOR_CLASS_COURT_SINGLES, 0x01);
  yield* animIdle(P, COACH, ANIM_NOD);
  yield* wait(P, 40);
  yield* animIdle(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* wait(P, 40);
  yield* fadeOutAndWait(P, 4);
}

export const HOOKS = [
  [BANK, 0x692B, hook(() => {})],                                     // Unused_11_NullScriptC
  scene(BANK, 0x693D, juniorClassCourtSinglesNpc03FaceUp),
  scene(BANK, 0x696A, juniorClassCourtSinglesNpc03),
  scene(BANK, 0x696E, juniorClassCourtSinglesNpc04),
  scene(BANK, 0x698A, juniorClassCourtSinglesNpc05),
  scene(BANK, 0x69C7, juniorClassCourtSinglesNpc06),
  scene(BANK, 0x69FB, juniorClassCourtSinglesNpc07),
  scene(BANK, 0x6A0F, juniorClassCourtSinglesNpc08),
  scene(BANK, 0x6AE9, juniorClassCourtSinglesNpc09),
  scene(BANK, 0x6B00, juniorClassCourtSinglesNpc0A),
  scene(BANK, 0x6B17, juniorClassCourtSinglesNpc0B),
  scene(BANK, 0x6CA9, juniorClassCourtSinglesDNpc0A),
  scene(BANK, 0x6CFE, juniorClassCourtSinglesInitScript),
  scene(BANK, 0x6E4D, juniorClassCourtSinglesMatchReturn),
  scene(BANK, 0x6E88, juniorClassCourtSinglesEntry0eScene),
  scene(BANK, 0x6E9E, juniorClassCourtSinglesEntry0dScene),
];
