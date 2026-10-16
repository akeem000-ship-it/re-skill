// The junior class's doubles ranking matches (bank $11, $5D38-$67F6): back from a match (the win: the ranking
// scene, entry $0D: the pair beaten congratulates the player by the match index), the coach's offer of the next
// ranking match and the walk to the opponents, the start of the match, and the opponents' walks on the
// ranking-challenge screen.
// Port of src/story/doubles_11.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss1_jrdoubles*.mtrec (scripted: the court by the doubles ranks, the match returns).
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FACE_DOWN, FACE_UP, FACE_LEFT, FACE_RIGHT, ANIM_WALK, ANIM_BOUNCE, ANIM_NOD,
  ANIM_SHAKE, WRAM_ACTORS, MATCHLIST_DOUBLES, setFlag, testFlag, setText, advanceText, speak, askYesNo, setAnim,
  waitIdle, wait, face, facePair, setPosition, moveTarget, waitMove, movePlayer, movePlayerToActor, waitPlayerMove,
  setSpeed, playerSpeed, jumpVelocity, waitJump, nullScript, setActorScript, waitActorScript, followPlayer, fadeIn,
  waitFadeEnd, fadeOutAndWait, goToLocation, requestExit, playStoryMatch, jumpTableTarget, scene,
} from "./common.js";
import { parkLeftCourtPracticePairLeftSide, resumeLeftCourtPractice } from "./court_practice_11.js";

const BANK = 0x11;
// the doubles court's actors (JuniorClassCourtDoublesActors_11)
const ACTOR_JUNIOR_CLASS_COURT_DOUBLES_WALK_72_00 = 0x03, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BOB = 0x04;
const ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BETH = 0x05, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_CURT = 0x06;
const ACTOR_JUNIOR_CLASS_COURT_DOUBLES_PAM = 0x07, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BRIAN = 0x08;
const ACTOR_JUNIOR_CLASS_COURT_DOUBLES_FAY = 0x09, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_RACKET_STUDENT_1 = 0x0C;
const ACTOR_JUNIOR_CLASS_COURT_DOUBLES_RACKET_STUDENT_2 = 0x0D;
// the roles of slots 8 and 9 across the court's lists (include/actor_roles.inc)
const ACTOR_ROLE_JUNIOR_CLASS_COURT_BRIAN = 0x08, ACTOR_ROLE_JUNIOR_CLASS_COURT_FAY = 0x09;
const STORYLOC_JUNIOR_CLASS_COURT_DOUBLES = 0x0C;
const STORYMATCH_JUNIOR_3 = 0x02, STORYMATCH_JUNIOR_2 = 0x03, STORYMATCH_JUNIOR_1 = 0x04;
const WINLOSE_WIN = 0x01, MATCH_EXIT_REQUESTED = 0x01;
const FLAG_WON_JUNIOR_DOUBLES_RANK_3 = 0x40, FLAG_WON_JUNIOR_DOUBLES_RANK_2 = 0x41, FLAG_WON_JUNIOR_DOUBLES_RANK_1 = 0x42;
const Text_32_90 = 0x085A, Text_32_95 = 0x085F, Text_32_97 = 0x0861, Text_32_99 = 0x0863, Text_32_101 = 0x0865;
const Text_32_104 = 0x0868, Text_32_113 = 0x0871, Text_32_117 = 0x0875;
// the actor scripts (data, this bank)
const ActorScript_11_03 = 0x5B14, ActorScript_11_04 = 0x5B28, ActorScript_11_05 = 0x5B42, ActorScript_11_06 = 0x5B56;
const ActorScript_11_07 = 0x5B70, ActorScript_11_08 = 0x5B84, ActorScript_11_09 = 0x5B98, ActorScript_11_10 = 0x5BB2;
const ActorScript_11_13 = 0x5BFA, ActorScript_11_14 = 0x5C14, ActorScript_11_15 = 0x5C2E, ActorScript_11_16 = 0x5C45;
const ActorScript_11_17 = 0x5C5F, ActorScript_11_18 = 0x5C7F, ActorScript_11_19 = 0x5CBF, ActorScript_11_20 = 0x5CFF;
const ActorScript_11_21 = 0x5D27, ActorScript_11_22 = 0x681F, ActorScript_11_27 = 0x6DF8, ActorScript_11_28 = 0x6E07;
const ActorScript_11_38 = 0x76E9, ActorScript_11_41 = 0x7728, ActorScript_11_44 = 0x7773, ActorScript_11_45 = 0x7BA9;
const ActorScript_11_52 = 0x7D86;
const Entry0dSceneJumpTable = 0x5DB1;                 // (after its rst $00: .setFlag, .setFlag2, .setFlag3)
// routines of this bank not ported here (src/story/ranking_challenge_11.asm); bank $1E's stub
const PromptChallengeRankingOpponent = 0x7288, BANK_EXP = 0x1E, StubNop_1e = 0x6533;
const YES = 0;

// script_set_anim actor, anim / script_wait_idle actor
function* animIdle(P, actor, anim) {
  setAnim(P, actor, anim);
  yield* waitIdle(P, actor);
}

// JuniorClassCourtDoublesMatchReturn (11:5D38): back from a ranking match: a win (not given up) goes on to the
// ranking scene (JuniorClassCourtDoublesEntry0eScene); otherwise the pair walks back to the coach.
export function* juniorClassCourtDoublesMatchReturn(P) {
  const { bus } = P;
  P.wramBank(WRAM_ACTORS);
  if (bus.u8(P.A.matchExitRequest) !== MATCH_EXIT_REQUESTED && bus.u8(P.A.matchWinLoseFlag) === WINLOSE_WIN)
    return yield* juniorClassCourtDoublesEntry0eScene(P);
  playerSpeed(P, 2.0);                                                // .eq01
  yield* movePlayer(P, 19.0, 21.0);
  setPosition(P, ACTOR_PLAYER, 19.0, 21.0);
  setPosition(P, ACTOR_PARTNER, 19.0, 23.0);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, ACTOR_PARTNER, FACE_UP);
  yield* waitPlayerMove(P);
}
// JuniorClassCourtDoublesEntry0eScene (11:5D85): the court again, at entry $0D (the ranking scene)
export function* juniorClassCourtDoublesEntry0eScene(P) {
  goToLocation(P, STORYLOC_JUNIOR_CLASS_COURT_DOUBLES, 0x0D);
  P.callRom(BANK_EXP, StubNop_1e);
}
// JuniorClassCourtDoublesEntry0dScene (11:5D9B): the ranking scene of the match won (its index - 2 through the
// jump table: rank 3, 2, 1 won and set)
export function* juniorClassCourtDoublesEntry0dScene(P) {
  P.V.storyModeShowLocationName = 0;
  nullScript(P, ACTOR_PARTNER);
  playerSpeed(P, 2.0);
  const index = (P.bus.u8(P.A.currentMinigameStoryMatch + 1) - 2) & 0xFF;
  const target = jumpTableTarget(P, BANK, Entry0dSceneJumpTable, index);
  const scenes = { 0x5DB7: rank3Won, 0x5EC0: rank2Won, 0x5FBD: rank1Won };
  if (scenes[target]) return yield* scenes[target](P);
  yield* P.runRom(BANK, target);                                      // (an index past the table: the ROM's jump)
}
// .setFlag: rank 3 won (Brian and Fay beaten)
function* rank3Won(P) {
  const COACH = ACTOR_JUNIOR_CLASS_COURT_DOUBLES_WALK_72_00, BRIAN = ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BRIAN;
  const FAY = ACTOR_JUNIOR_CLASS_COURT_DOUBLES_FAY;
  setFlag(P, FLAG_WON_JUNIOR_DOUBLES_RANK_3);
  playerSpeed(P, 2.0);
  yield* movePlayer(P, 25.0, 17.0);
  nullScript(P, BRIAN);
  nullScript(P, FAY);
  setAnim(P, BRIAN, ANIM_WALK);
  setAnim(P, FAY, ANIM_WALK);
  setPosition(P, BRIAN, 25.0, 13.0);
  setPosition(P, FAY, 27.0, 13.0);
  setPosition(P, ACTOR_PLAYER, 27.0, 21.0);
  setPosition(P, ACTOR_PARTNER, 25.0, 21.0);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, ACTOR_PARTNER, FACE_UP);
  face(P, BRIAN, FACE_DOWN);
  face(P, FAY, FACE_DOWN);
  face(P, COACH, FACE_RIGHT);
  yield* waitPlayerMove(P);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  yield* setText(P, Text_32_101);
  setAnim(P, BRIAN, ANIM_BOUNCE);
  yield* speak(P, BRIAN);
  setAnim(P, FAY, ANIM_SHAKE);
  yield* speak(P, FAY);
  jumpVelocity(P, COACH, -2.0);
  yield* waitJump(P, COACH);
  yield* speak(P, COACH);
  setActorScript(P, BRIAN, ActorScript_11_04);
  setActorScript(P, FAY, ActorScript_11_06);
  moveTarget(P, ACTOR_PLAYER, 19.0, 23.0);
  moveTarget(P, ACTOR_PARTNER, 19.0, 21.0);
  face(P, COACH, FACE_DOWN);
  yield* waitMove(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  yield* wait(P, 40);
  followPlayer(P, ACTOR_PARTNER);
}
// .setFlag2: rank 2 won (Pam and Beth beaten; the left court's practice pair stopped meanwhile)
function* rank2Won(P) {
  const COACH = ACTOR_JUNIOR_CLASS_COURT_DOUBLES_WALK_72_00, PAM = ACTOR_JUNIOR_CLASS_COURT_DOUBLES_PAM;
  const BETH = ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BETH;
  setFlag(P, FLAG_WON_JUNIOR_DOUBLES_RANK_2);
  yield* parkLeftCourtPracticePairLeftSide(P);
  playerSpeed(P, 2.0);
  yield* movePlayer(P, 11.0, 15.0);
  setPosition(P, PAM, 11.0, 13.0);
  setPosition(P, BETH, 9.0, 13.0);
  setPosition(P, ACTOR_PLAYER, 9.0, 21.0);
  setPosition(P, ACTOR_PARTNER, 11.0, 25.0);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, ACTOR_PARTNER, FACE_UP);
  face(P, PAM, FACE_DOWN);
  face(P, BETH, FACE_DOWN);
  face(P, COACH, FACE_LEFT);
  yield* waitPlayerMove(P);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  yield* setText(P, Text_32_101);
  setAnim(P, PAM, ANIM_BOUNCE);
  yield* speak(P, PAM);
  setAnim(P, BETH, ANIM_SHAKE);
  yield* speak(P, BETH);
  yield* setText(P, Text_32_104);
  jumpVelocity(P, COACH, -2.0);
  yield* waitJump(P, COACH);
  yield* speak(P, COACH);
  setActorScript(P, PAM, ActorScript_11_14);
  setActorScript(P, BETH, ActorScript_11_17);
  moveTarget(P, ACTOR_PLAYER, 19.0, 23.0);
  moveTarget(P, ACTOR_PARTNER, 19.0, 21.0);
  yield* resumeLeftCourtPractice(P);
  face(P, COACH, FACE_DOWN);
  yield* wait(P, 60);
  yield* waitMove(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  followPlayer(P, ACTOR_PARTNER);
}
// .setFlag3: rank 1 won (Bob and Curt beaten): the junior doubles title; the coach's speech; on to the court's
// entry 1
function* rank1Won(P) {
  const COACH = ACTOR_JUNIOR_CLASS_COURT_DOUBLES_WALK_72_00, BOB = ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BOB;
  const CURT = ACTOR_JUNIOR_CLASS_COURT_DOUBLES_CURT, BRIAN = ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BRIAN;
  const FAY = ACTOR_JUNIOR_CLASS_COURT_DOUBLES_FAY;
  setFlag(P, FLAG_WON_JUNIOR_DOUBLES_RANK_1);
  playerSpeed(P, 2.0);
  yield* movePlayer(P, 25.0, 13.0);
  setPosition(P, BRIAN, 37.0, 9.0);
  face(P, BRIAN, FACE_RIGHT);
  setActorScript(P, BRIAN, ActorScript_11_45);
  setPosition(P, FAY, 37.0, 11.0);
  face(P, FAY, FACE_RIGHT);
  setPosition(P, COACH, 19.0, 31.0);
  setPosition(P, BOB, 25.0, 14.0);
  setPosition(P, CURT, 27.0, 14.0);
  setPosition(P, ACTOR_PLAYER, 27.0, 19.0);
  setPosition(P, ACTOR_PARTNER, 25.0, 19.0);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, ACTOR_PARTNER, FACE_UP);
  face(P, BOB, FACE_DOWN);
  face(P, CURT, FACE_DOWN);
  face(P, COACH, FACE_UP);
  yield* waitPlayerMove(P);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  yield* wait(P, 30);
  yield* setText(P, Text_32_113);
  setAnim(P, BOB, ANIM_BOUNCE);
  yield* speak(P, BOB);
  setAnim(P, CURT, ANIM_SHAKE);
  yield* speak(P, CURT);
  setAnim(P, COACH, ANIM_NOD);
  yield* speak(P, COACH);
  setAnim(P, BOB, ANIM_BOUNCE);
  setAnim(P, CURT, ANIM_BOUNCE);
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  setAnim(P, ACTOR_PARTNER, ANIM_BOUNCE);
  yield* wait(P, 30);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  face(P, ACTOR_PARTNER, FACE_DOWN);
  playerSpeed(P, 0.5);
  setSpeed(P, COACH, 0.5);
  yield* movePlayer(P, 21.0, 23.0);
  yield* waitPlayerMove(P);
  moveTarget(P, COACH, 19.0, 27.0);
  yield* waitMove(P, COACH);
  yield* waitPlayerMove(P);
  yield* movePlayer(P, 26.0, 19.0);
  moveTarget(P, COACH, 26.0, 23.0);
  yield* waitMove(P, COACH);
  face(P, COACH, FACE_UP);
  yield* animIdle(P, COACH, ANIM_BOUNCE);
  yield* speak(P, COACH);
  facePair(P, ACTOR_PARTNER, ACTOR_PLAYER);
  yield* wait(P, 30);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  face(P, ACTOR_PARTNER, FACE_DOWN);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* animIdle(P, ACTOR_PARTNER, ANIM_NOD);
  yield* wait(P, 30);
  yield* setText(P, Text_32_117);
  yield* animIdle(P, COACH, ANIM_NOD);
  yield* speak(P, COACH);
  moveTarget(P, COACH, 27.0, 21.0);
  yield* waitMove(P, COACH);
  yield* speak(P, ACTOR_PLAYER);
  yield* wait(P, 30);
  setAnim(P, COACH, ANIM_BOUNCE);
  yield* speak(P, COACH);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* animIdle(P, ACTOR_PARTNER, ANIM_NOD);
  yield* animIdle(P, COACH, ANIM_NOD);
  facePair(P, CURT, BOB);
  yield* wait(P, 30);
  face(P, BOB, FACE_DOWN);
  face(P, CURT, FACE_DOWN);
  setAnim(P, CURT, ANIM_BOUNCE);
  yield* speak(P, CURT);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, ACTOR_PARTNER, FACE_UP);
  yield* animIdle(P, BOB, ANIM_NOD);
  yield* speak(P, CURT);
  facePair(P, ACTOR_PARTNER, ACTOR_PLAYER);
  yield* wait(P, 20);
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* animIdle(P, ACTOR_PARTNER, ANIM_BOUNCE);
  yield* wait(P, 30);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, ACTOR_PARTNER, FACE_UP);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* animIdle(P, ACTOR_PARTNER, ANIM_NOD);
  yield* wait(P, 30);
  setAnim(P, BOB, ANIM_NOD);
  yield* animIdle(P, CURT, ANIM_NOD);
  yield* wait(P, 60);
  setAnim(P, COACH, ANIM_NOD);
  goToLocation(P, STORYLOC_JUNIOR_CLASS_COURT_DOUBLES, 0x01);
  yield* wait(P, 60);
  yield* fadeOutAndWait(P, 4);
  yield* wait(P, 30);
}

// OfferDoublesRankingMatch (11:629E): the coach: "a ranking match?" no: his other line; yes: the pair steps up,
// he names the next opponents (a message on for each rank won), they are shown (DrawDoublesRankingOpponentInfo)
// and the challenge prompt follows (ranking_challenge_11.asm).
export function* offerDoublesRankingMatch(P) {
  const COACH = ACTOR_JUNIOR_CLASS_COURT_DOUBLES_WALK_72_00;
  yield* setText(P, Text_32_90);
  if ((yield* askYesNo(P, COACH)) !== YES) { yield* speak(P, COACH); return; }   // .speak
  setSpeed(P, ACTOR_PLAYER, 0.5);
  setSpeed(P, ACTOR_PARTNER, 0.5);
  moveTarget(P, ACTOR_PLAYER, 19.0, 21.0);
  moveTarget(P, ACTOR_PARTNER, 19.0, 23.0);
  advanceText(P);
  for (const rank of [FLAG_WON_JUNIOR_DOUBLES_RANK_3, FLAG_WON_JUNIOR_DOUBLES_RANK_2, FLAG_WON_JUNIOR_DOUBLES_RANK_1]) {
    if (!testFlag(P, rank)) break;
    advanceText(P);
  }
  yield* waitMove(P, ACTOR_PLAYER);                                   // .wait
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, COACH, FACE_DOWN);
  moveTarget(P, ACTOR_PARTNER, 19.0, 23.0);
  yield* waitMove(P, ACTOR_PARTNER);
  face(P, ACTOR_PARTNER, FACE_UP);
  yield* speak(P, COACH);
  yield* drawDoublesRankingOpponentInfo(P);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* wait(P, 15);
  yield* animIdle(P, COACH, ANIM_BOUNCE);
  yield* P.runRom(BANK, PromptChallengeRankingOpponent);
}
// DrawDoublesRankingOpponentInfo (11:6351): the next opponents introduce themselves: the player walks to them
// and back; rank 3 Brian and Fay, rank 2 Beth and Pam, rank 1 Bob and Curt (nothing once all are won)
export function* drawDoublesRankingOpponentInfo(P) {
  const COACH = ACTOR_JUNIOR_CLASS_COURT_DOUBLES_WALK_72_00;
  if (!testFlag(P, FLAG_WON_JUNIOR_DOUBLES_RANK_3)) {                 // .rank2: Brian and Fay
    const BRIAN = ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BRIAN, FAY = ACTOR_JUNIOR_CLASS_COURT_DOUBLES_FAY;
    playerSpeed(P, 1.0);
    face(P, COACH, FACE_RIGHT);
    yield* movePlayerToActor(P, BRIAN);
    yield* waitPlayerMove(P);
    nullScript(P, BRIAN);
    nullScript(P, FAY);
    setAnim(P, FAY, ANIM_WALK);
    face(P, BRIAN, FACE_LEFT);
    face(P, FAY, FACE_LEFT);
    yield* wait(P, 50);
    face(P, ACTOR_PLAYER, FACE_RIGHT);
    face(P, ACTOR_PARTNER, FACE_RIGHT);
    yield* setText(P, Text_32_95);
    yield* animIdle(P, BRIAN, ANIM_BOUNCE);
    moveTarget(P, BRIAN, 21.0, 21.0);
    moveTarget(P, FAY, 21.0, 23.0);
    yield* waitMove(P, FAY);
    face(P, FAY, FACE_LEFT);
    yield* movePlayerToActor(P, ACTOR_PLAYER);
    face(P, COACH, FACE_DOWN);
    yield* animIdle(P, BRIAN, ANIM_BOUNCE);
    yield* speak(P, BRIAN);
    setAnim(P, FAY, ANIM_NOD);
    yield* speak(P, FAY);
    yield* wait(P, 15);
    for (const actor of [ACTOR_PLAYER, ACTOR_PARTNER, BRIAN, FAY]) face(P, actor, FACE_UP);
    return;
  }
  if (!testFlag(P, FLAG_WON_JUNIOR_DOUBLES_RANK_2)) {                 // .rank3: Beth and Pam
    const BETH = ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BETH, PAM = ACTOR_JUNIOR_CLASS_COURT_DOUBLES_PAM;
    playerSpeed(P, 1.0);
    face(P, COACH, FACE_LEFT);
    yield* movePlayerToActor(P, BETH);
    yield* waitPlayerMove(P);
    face(P, ACTOR_PLAYER, FACE_LEFT);
    face(P, ACTOR_PARTNER, FACE_LEFT);
    yield* wait(P, 30);
    yield* setText(P, Text_32_97);
    setActorScript(P, BETH, ActorScript_11_38);
    setActorScript(P, PAM, ActorScript_11_15);
    yield* movePlayerToActor(P, ACTOR_PLAYER);
    face(P, COACH, FACE_DOWN);
    yield* waitPlayerMove(P);
    yield* wait(P, 30);
    yield* animIdle(P, BETH, ANIM_SHAKE);
    yield* speak(P, BETH);
    facePair(P, PAM, BETH);
    yield* wait(P, 30);
    setAnim(P, PAM, ANIM_NOD);
    yield* speak(P, PAM);
    for (const actor of [ACTOR_PLAYER, ACTOR_PARTNER, BETH, PAM]) face(P, actor, FACE_UP);
    return;
  }
  if (testFlag(P, FLAG_WON_JUNIOR_DOUBLES_RANK_1)) return;
  const BOB = ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BOB, CURT = ACTOR_JUNIOR_CLASS_COURT_DOUBLES_CURT;   // .done
  playerSpeed(P, 1.0);
  face(P, COACH, FACE_RIGHT);
  yield* wait(P, 20);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  face(P, ACTOR_PARTNER, FACE_RIGHT);
  yield* movePlayerToActor(P, BOB);
  yield* waitPlayerMove(P);
  face(P, CURT, FACE_LEFT);
  yield* animIdle(P, CURT, ANIM_BOUNCE);
  yield* setText(P, Text_32_99);
  setActorScript(P, BOB, ActorScript_11_41);
  yield* wait(P, 15);
  setActorScript(P, CURT, ActorScript_11_20);
  yield* movePlayerToActor(P, ACTOR_PLAYER);
  face(P, COACH, FACE_DOWN);
  yield* waitPlayerMove(P);
  yield* wait(P, 15);
  yield* animIdle(P, BOB, ANIM_BOUNCE);
  yield* speak(P, BOB);
  setAnim(P, CURT, ANIM_NOD);
  yield* speak(P, CURT);
  yield* wait(P, 20);
  for (const actor of [ACTOR_PLAYER, ACTOR_PARTNER, BOB, CURT]) face(P, actor, FACE_UP);
}

// StartNextDoublesRankingMatch (11:6596): the challenge accepted: both sides walk to the court (by the next rank:
// Brian and Fay, Beth and Pam with the racket students out of the way, Bob and Curt), the match's return as exit
// $0F, the ranking match.
export function* startNextDoublesRankingMatch(P) {
  const COACH = ACTOR_JUNIOR_CLASS_COURT_DOUBLES_WALK_72_00;
  setSpeed(P, ACTOR_PLAYER, 1.0);
  setSpeed(P, ACTOR_PARTNER, 1.0);
  if (!testFlag(P, FLAG_WON_JUNIOR_DOUBLES_RANK_3)) {                 // .rank2
    face(P, COACH, FACE_RIGHT);
    yield* wait(P, 30);
    nullScript(P, ACTOR_PARTNER);
    yield* movePlayer(P, 25.0, 17.0);
    setActorScript(P, ACTOR_ROLE_JUNIOR_CLASS_COURT_BRIAN, ActorScript_11_07);
    setActorScript(P, ACTOR_ROLE_JUNIOR_CLASS_COURT_FAY, ActorScript_11_08);
    yield* toTheCourt(P, 10);
    return yield* rankingMatch(P, STORYMATCH_JUNIOR_3);
  }
  if (!testFlag(P, FLAG_WON_JUNIOR_DOUBLES_RANK_2)) {                 // .rank3
    face(P, COACH, FACE_LEFT);
    yield* wait(P, 15);
    for (const actor of [ACTOR_PLAYER, ACTOR_PARTNER, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BETH, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_PAM])
      face(P, actor, FACE_LEFT);
    setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_RACKET_STUDENT_1, ActorScript_11_27);
    setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_RACKET_STUDENT_2, ActorScript_11_28);
    yield* waitActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_RACKET_STUDENT_2);
    nullScript(P, ACTOR_PARTNER);
    yield* movePlayer(P, 11.0, 17.0);
    setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BETH, ActorScript_11_09);
    setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_PAM, ActorScript_11_10);
    yield* wait(P, 30);
    setActorScript(P, ACTOR_PLAYER, ActorScript_11_44);
    setActorScript(P, ACTOR_PARTNER, ActorScript_11_21);
    yield* waitActorScript(P, ACTOR_PLAYER);
    face(P, ACTOR_PLAYER, FACE_UP);
    face(P, ACTOR_PARTNER, FACE_UP);
    yield* wait(P, 60);
    return yield* rankingMatch(P, STORYMATCH_JUNIOR_2);
  }
  if (testFlag(P, FLAG_WON_JUNIOR_DOUBLES_RANK_1)) return;
  face(P, COACH, FACE_RIGHT);                                         // .done
  yield* wait(P, 15);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  face(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_PAM, FACE_RIGHT);
  yield* wait(P, 30);
  nullScript(P, ACTOR_PARTNER);
  yield* movePlayer(P, 25.0, 17.0);
  setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BOB, ActorScript_11_07);
  setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_CURT, ActorScript_11_08);
  yield* toTheCourt(P, 20);
  yield* rankingMatch(P, STORYMATCH_JUNIOR_1);
}
// the pair to its side of the right court (the partner a few frames later)
function* toTheCourt(P, partnerDelay) {
  moveTarget(P, ACTOR_PLAYER, 27.0, 25.0);
  yield* wait(P, partnerDelay);
  moveTarget(P, ACTOR_PARTNER, 25.0, 21.0);
  yield* waitMove(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, ACTOR_PARTNER, FACE_UP);
  yield* wait(P, 60);
}
// exit $0F (the court's match return) and the ranking match
function* rankingMatch(P, index) {
  requestExit(P, 0x0F);
  yield* playStoryMatch(P, MATCHLIST_DOUBLES, index);
}

// LoadDoublesRankingOpponentGraphics (11:67A0): the next opponents take their places on the challenge screen's
// court: rank 3 Brian and Fay, rank 2 Beth and Pam, rank 1 Bob and Curt
export function* loadDoublesRankingOpponentGraphics(P) {
  if (!testFlag(P, FLAG_WON_JUNIOR_DOUBLES_RANK_3)) {                 // .rank2
    setActorScript(P, ACTOR_ROLE_JUNIOR_CLASS_COURT_BRIAN, ActorScript_11_03);
    setActorScript(P, ACTOR_ROLE_JUNIOR_CLASS_COURT_FAY, ActorScript_11_05);
    yield* waitActorScript(P, ACTOR_ROLE_JUNIOR_CLASS_COURT_FAY);
    setActorScript(P, ACTOR_ROLE_JUNIOR_CLASS_COURT_FAY, ActorScript_11_22);
    yield* waitActorScript(P, ACTOR_ROLE_JUNIOR_CLASS_COURT_BRIAN);
    setActorScript(P, ACTOR_ROLE_JUNIOR_CLASS_COURT_BRIAN, ActorScript_11_52);
    return;
  }
  if (!testFlag(P, FLAG_WON_JUNIOR_DOUBLES_RANK_2)) {                 // .rank3
    setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BETH, ActorScript_11_13);
    setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_PAM, ActorScript_11_16);
    yield* waitActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BETH);
    return;
  }
  if (testFlag(P, FLAG_WON_JUNIOR_DOUBLES_RANK_1)) return;
  setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BOB, ActorScript_11_18);   // .done
  setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_CURT, ActorScript_11_19);
  yield* waitActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BOB);
}

export const HOOKS = [
  scene(BANK, 0x5D38, juniorClassCourtDoublesMatchReturn),
  scene(BANK, 0x5D85, juniorClassCourtDoublesEntry0eScene),
  scene(BANK, 0x5D9B, juniorClassCourtDoublesEntry0dScene),
  scene(BANK, 0x629E, offerDoublesRankingMatch),
  scene(BANK, 0x6351, drawDoublesRankingOpponentInfo),
  scene(BANK, 0x6596, startNextDoublesRankingMatch),
  scene(BANK, 0x67A0, loadDoublesRankingOpponentGraphics),
];
