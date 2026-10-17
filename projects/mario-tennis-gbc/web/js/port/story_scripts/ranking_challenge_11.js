// The junior class's ranking challenges (bank $11, $7288-$7883): the coach's offer of the next singles ranking match
// (the rank to beat by the ranks won: 4 Pam, 3 Curt, 2 Beth, 1 Bob), the opponent stepping up and introduced, the
// challenge's question, the walk to the court and the match; the doubles ones go to doubles_11.asm's routines.
// The actor scripts (ActorScript_11_30..44) are data.
// Port of src/story/ranking_challenge_11.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/engine/rec1.mtrec, rec2.mtrec (the coach's offers: rank 4 and on), out/port/ss1_jrsingles*.mtrec
// (part 1's scripted junior singles court), ss2_rank*.mtrec (scripted: each rank's challenge, accepted and declined).
import {
  ACTOR_PARTNER, ACTOR_PLAYER, ACTOR_SIZE, ANIM_BOUNCE, ANIM_NOD, BANK_ACTORS, FACE_DOWN, FACE_LEFT, FACE_RIGHT,
  FACE_UP, FLAG_DOUBLES, MATCHLIST_SINGLES, actorState, advanceText, askYesNo, face, faceToward, farcall,
  initMatchSettings, loadMatchSettings, movePlayer, movePlayerToActor, moveTarget, playerSpeed, requestExit,
  restoreAfterMatch, runMatch, scene, setActorScript, setAnim, setSpeed, setText, speak, testFlag, unlockFacing,
  wActors, wait, waitActorScript, waitIdle, waitMove, waitPlayerMove,
} from "./common.js";
import { attachActorWaypointFollower } from "../story/actor_slots.js";
import { startNextDoublesRankingMatch, loadDoublesRankingOpponentGraphics } from "./doubles_11.js";

const BANK = 0x11;
const STORYMATCH_JUNIOR_4 = 0x01, STORYMATCH_JUNIOR_3 = 0x02, STORYMATCH_JUNIOR_2 = 0x03, STORYMATCH_JUNIOR_1 = 0x04;
const EXIT_COURT = 0x0F;
const ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BETH = 0x05;
const ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BOB = 0x04;
const ACTOR_JUNIOR_CLASS_COURT_DOUBLES_CURT = 0x06;
const ACTOR_JUNIOR_CLASS_COURT_DOUBLES_PAM = 0x07;
const ACTOR_JUNIOR_CLASS_COURT_DOUBLES_RACKET_STUDENT_1 = 0x0C;
const ACTOR_JUNIOR_CLASS_COURT_DOUBLES_RACKET_STUDENT_2 = 0x0D;
const ACTOR_JUNIOR_CLASS_COURT_DOUBLES_RACKET_STUDENT_3 = 0x0E;
const ACTOR_JUNIOR_CLASS_COURT_DOUBLES_RACKET_STUDENT_4 = 0x0F;
const ACTOR_JUNIOR_CLASS_COURT_DOUBLES_WALK_72_00 = 0x03;
const ACTOR_JUNIOR_CLASS_COURT_SINGLES_BETH = 0x05;
const ACTOR_JUNIOR_CLASS_COURT_SINGLES_BOB = 0x04;
const ACTOR_JUNIOR_CLASS_COURT_SINGLES_CURT = 0x06;
const ACTOR_JUNIOR_CLASS_COURT_SINGLES_PAM = 0x07;
const ACTOR_JUNIOR_CLASS_COURT_SINGLES_WALK_72_00 = 0x03;
const ActorScript_11_23 = 0x6DBC;
const ActorScript_11_24 = 0x6DCB;
const ActorScript_11_25 = 0x6DDA;
const ActorScript_11_26 = 0x6DE9;
const ActorScript_11_30 = 0x7643;
const ActorScript_11_31 = 0x765A;
const ActorScript_11_32 = 0x766B;
const ActorScript_11_34 = 0x76AB;
const ActorScript_11_35 = 0x76BC;
const ActorScript_11_36 = 0x76CD;
const ActorScript_11_38 = 0x76E9;
const ActorScript_11_39 = 0x7700;
const ActorScript_11_41 = 0x7728;
const ActorScript_11_42 = 0x7745;
const ActorScript_11_43 = 0x7762;
const ActorScript_11_44 = 0x7773;
const FLAG_WON_JUNIOR_SINGLES_RANK_1 = 0x53;
const FLAG_WON_JUNIOR_SINGLES_RANK_2 = 0x52;
const FLAG_WON_JUNIOR_SINGLES_RANK_3 = 0x51;
const FLAG_WON_JUNIOR_SINGLES_RANK_4 = 0x50;
const Text_32_28 = 0x81C;
const Text_32_34 = 0x822;
const Text_32_37 = 0x825;
const Text_32_40 = 0x828;
const Text_32_42 = 0x82A;
const Text_32_44 = 0x82C;
const Text_32_46 = 0x82E;
const Text_32_48 = 0x830;

// the rank to beat next: 0 rank 4 (Pam), 1 rank 3 (Curt), 2 rank 2 (Beth), 3 rank 1 (Bob); -1 when all are won
function nextRank(P) {
  const flags = [FLAG_WON_JUNIOR_SINGLES_RANK_4, FLAG_WON_JUNIOR_SINGLES_RANK_3, FLAG_WON_JUNIOR_SINGLES_RANK_2,
    FLAG_WON_JUNIOR_SINGLES_RANK_1];
  const i = flags.findIndex(flag => !testFlag(P, flag));
  return i;
}
// PromptChallengeRankingOpponent (11:7288): "shall we play?" (its other line once rank 4 is won); yes: the nods and
// the match (StartNextRankingMatch); no: "really?" (yes: the opponent back to its place; no: the match after all)
export function* promptChallengeRankingOpponent(P) {
  yield* setText(P, Text_32_34);
  if (testFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_4)) advanceText(P);
  if ((yield* askYesNo(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_WALK_72_00)) === 0) {   // .prompt
    setAnim(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_WALK_72_00, ANIM_NOD);
    yield* waitIdle(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_WALK_72_00);
  } else {
    yield* setText(P, Text_32_37);                                   // .done: "are you sure?"
    if ((yield* askYesNo(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_WALK_72_00)) === 0) {
      yield* speak(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_WALK_72_00);   // .accepted (not to play): the opponent back
      yield* loadRankingOpponentGraphics(P);
      return;
    }
  }
  setAnim(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_WALK_72_00, ANIM_NOD);  // .declined (the match on)
  yield* waitIdle(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_WALK_72_00);
  yield* setText(P, Text_32_40);
  yield* speak(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_WALK_72_00);
  yield* startNextRankingMatch(P);
  setSpeed(P, ACTOR_PLAYER, 0.75);
  setSpeed(P, ACTOR_PARTNER, 0.75);
}

// LoadRankingOpponentGraphics (11:730A): the opponent back to its place (its actor script); doubles: the doubles
// court's (doubles_11.asm)
export function* loadRankingOpponentGraphics(P) {
  if (testFlag(P, FLAG_DOUBLES)) return yield* loadDoublesRankingOpponentGraphics(P);
  const back = [[ACTOR_JUNIOR_CLASS_COURT_DOUBLES_PAM, ActorScript_11_32], [ACTOR_JUNIOR_CLASS_COURT_DOUBLES_CURT, ActorScript_11_36],
    [ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BETH, ActorScript_11_39], [ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BOB, ActorScript_11_42]][nextRank(P)];
  if (!back) return;
  setActorScript(P, back[0], back[1]);
  yield* waitActorScript(P, back[0]);
}

// DrawRankingOpponentInfo (11:7369): the next opponent introduced
export function* drawRankingOpponentInfo(P) {
  const rank = nextRank(P);
  if (rank < 0) return;
  return yield* [introPam, introCurt, introBeth, introBob][rank](P);
}
// .rank2 .. .done: the opponent (Pam, Curt, Beth, Bob) walks up to the coach, is introduced, says a word
function* introPam(P) {
  yield* wait(P, 15);
  faceToward(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_PAM, ACTOR_JUNIOR_CLASS_COURT_SINGLES_WALK_72_00);
  yield* wait(P, 30);
  faceToward(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_PAM, ACTOR_PLAYER);
  yield* wait(P, 30);
  playerSpeed(P, 1.0);
  yield* movePlayerToActor(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_PAM);
  yield* waitPlayerMove(P);
  faceToward(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_WALK_72_00, ACTOR_JUNIOR_CLASS_COURT_SINGLES_PAM);
  setAnim(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_PAM, ANIM_NOD);
  yield* waitIdle(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_PAM);
  yield* wait(P, 10);
  setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_PAM, ActorScript_11_30);
  yield* wait(P, 10);
  yield* movePlayerToActor(P, ACTOR_PLAYER);
  face(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_WALK_72_00, FACE_DOWN);
  yield* waitPlayerMove(P);
  yield* waitActorScript(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_PAM);
  faceToward(P, ACTOR_PLAYER, ACTOR_JUNIOR_CLASS_COURT_SINGLES_PAM);
  setAnim(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_PAM, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_PAM);
  yield* setText(P, Text_32_42);
  yield* speak(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_PAM);
  setAnim(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_PAM, ANIM_NOD);
  yield* waitIdle(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_PAM);
  yield* speak(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_PAM);
  yield* wait(P, 15);
  face(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_PAM, FACE_UP);
}
function* introCurt(P) {
  yield* wait(P, 15);
  faceToward(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_CURT, ACTOR_JUNIOR_CLASS_COURT_SINGLES_WALK_72_00);
  yield* wait(P, 30);
  faceToward(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_CURT, ACTOR_PLAYER);
  yield* wait(P, 30);
  playerSpeed(P, 1.0);
  yield* movePlayerToActor(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_CURT);
  yield* waitPlayerMove(P);
  faceToward(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_WALK_72_00, ACTOR_JUNIOR_CLASS_COURT_SINGLES_CURT);
  setAnim(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_CURT, ANIM_NOD);
  yield* waitIdle(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_CURT);
  setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_CURT, ActorScript_11_34);
  yield* movePlayerToActor(P, ACTOR_PLAYER);
  face(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_WALK_72_00, FACE_DOWN);
  yield* waitActorScript(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_CURT);
  faceToward(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_CURT, ACTOR_PLAYER);
  yield* waitActorScript(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_CURT);
  setAnim(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_CURT, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_CURT);
  yield* setText(P, Text_32_44);
  yield* speak(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_CURT);
  setAnim(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_CURT, ANIM_NOD);
  yield* waitIdle(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_CURT);
  yield* speak(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_CURT);
  yield* wait(P, 15);
  face(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_CURT, FACE_UP);
}
function* introBeth(P) {
  yield* wait(P, 15);
  faceToward(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BETH, ACTOR_JUNIOR_CLASS_COURT_SINGLES_WALK_72_00);
  yield* wait(P, 30);
  faceToward(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BETH, ACTOR_PLAYER);
  yield* wait(P, 30);
  playerSpeed(P, 1.0);
  yield* movePlayerToActor(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BETH);
  yield* waitPlayerMove(P);
  faceToward(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_WALK_72_00, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BETH);
  setAnim(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BETH, ANIM_NOD);
  yield* waitIdle(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BETH);
  setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BETH, ActorScript_11_38);
  yield* wait(P, 10);
  yield* movePlayerToActor(P, ACTOR_PLAYER);
  face(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_WALK_72_00, FACE_DOWN);
  yield* waitActorScript(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BETH);
  faceToward(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BETH, ACTOR_PLAYER);
  setAnim(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BETH, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BETH);
  yield* setText(P, Text_32_46);
  yield* speak(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BETH);
  setAnim(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BETH, ANIM_NOD);
  yield* waitIdle(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BETH);
  yield* speak(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BETH);
  yield* wait(P, 15);
  face(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BETH, FACE_UP);
}
function* introBob(P) {
  yield* wait(P, 15);
  faceToward(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BOB, ACTOR_JUNIOR_CLASS_COURT_SINGLES_WALK_72_00);
  yield* wait(P, 30);
  faceToward(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BOB, ACTOR_PLAYER);
  yield* wait(P, 30);
  playerSpeed(P, 1.0);
  yield* movePlayerToActor(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BOB);
  yield* waitPlayerMove(P);
  const leader = actorState(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BOB);   // the player's shadow follows Bob
  farcall(P, BANK_ACTORS, () => attachActorWaypointFollower(P, wActors + ACTOR_SIZE, leader));
  faceToward(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_WALK_72_00, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BOB);
  setAnim(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BOB, ANIM_NOD);
  yield* waitIdle(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BOB);
  setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BOB, ActorScript_11_41);
  face(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_WALK_72_00, FACE_DOWN);
  yield* movePlayerToActor(P, ACTOR_PLAYER);
  yield* waitActorScript(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BOB);
  faceToward(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BOB, ACTOR_PLAYER);
  setAnim(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BOB, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BOB);
  yield* setText(P, Text_32_48);
  yield* speak(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BOB);
  setAnim(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BOB, ANIM_NOD);
  yield* waitIdle(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BOB);
  yield* speak(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BOB);
  yield* wait(P, 15);
  face(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_BOB, FACE_UP);
}

// OfferSinglesRankingMatch (11:7784): the coach's offer of a ranking match (no: his answer); yes: the player steps
// back, the coach names the opponent (the rank to beat), the opponent's introduction, then the challenge
export function* offerSinglesRankingMatch(P) {
  yield* setText(P, Text_32_28);
  if ((yield* askYesNo(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_WALK_72_00)) !== 0) {
    yield* speak(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_WALK_72_00);   // .speak2
    return;
  }
  unlockFacing(P, ACTOR_PLAYER);
  setSpeed(P, ACTOR_PLAYER, 0.75);
  moveTarget(P, ACTOR_PLAYER, 19.0, 21.0);
  yield* waitMove(P, ACTOR_PLAYER);
  faceToward(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_WALK_72_00, ACTOR_PLAYER);
  yield* wait(P, 30);
  faceToward(P, ACTOR_PLAYER, ACTOR_JUNIOR_CLASS_COURT_SINGLES_WALK_72_00);
  advanceText(P);                                                    // (the line of the rank to beat)
  for (const flag of [FLAG_WON_JUNIOR_SINGLES_RANK_4, FLAG_WON_JUNIOR_SINGLES_RANK_3, FLAG_WON_JUNIOR_SINGLES_RANK_2]) {
    if (!testFlag(P, flag)) break;
    advanceText(P);
  }
  yield* speak(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_WALK_72_00);
  yield* drawRankingOpponentInfo(P);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* wait(P, 15);
  setAnim(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_WALK_72_00, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_JUNIOR_CLASS_COURT_SINGLES_WALK_72_00);
  yield* promptChallengeRankingOpponent(P);
}

// StartNextRankingMatch (11:781D): the match against the rank to beat (doubles: doubles_11.asm's)
export function* startNextRankingMatch(P) {
  setSpeed(P, ACTOR_PLAYER, 1.0);
  if (testFlag(P, FLAG_DOUBLES)) return yield* startNextDoublesRankingMatch(P);
  const rank = nextRank(P);
  if (rank < 0) return;
  return yield* [matchPam, matchCurt, matchBeth, matchBob][rank](P);
}
// the ranking match (exit $0F back here after): the opponent and the player walk to the court, the match
function* rankingMatch(P, match) {
  requestExit(P, EXIT_COURT);
  initMatchSettings(P);
  loadMatchSettings(P, MATCHLIST_SINGLES, match);
  yield* runMatch(P);
  yield* restoreAfterMatch(P);
}
// .rank2 .. .done: the racket students make way, the opponent and the player take the court
function* matchPam(P) {
  face(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_WALK_72_00, FACE_RIGHT);
  yield* wait(P, 15);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  face(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_PAM, FACE_RIGHT);
  yield* wait(P, 30);
  setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_RACKET_STUDENT_3, ActorScript_11_23);
  setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_RACKET_STUDENT_4, ActorScript_11_24);
  yield* waitActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_RACKET_STUDENT_4);
  yield* movePlayer(P, 27.0, 17.0);
  setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_PAM, ActorScript_11_31);
  setActorScript(P, ACTOR_PLAYER, ActorScript_11_43);
  yield* waitPlayerMove(P);
  yield* waitActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_PAM);
  yield* wait(P, 20);
  yield* rankingMatch(P, STORYMATCH_JUNIOR_4);
}
function* matchCurt(P) {
  face(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_WALK_72_00, FACE_LEFT);
  yield* wait(P, 15);
  face(P, ACTOR_PLAYER, FACE_LEFT);
  face(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_CURT, FACE_LEFT);
  yield* wait(P, 30);
  setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_RACKET_STUDENT_1, ActorScript_11_25);
  setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_RACKET_STUDENT_2, ActorScript_11_26);
  yield* wait(P, 120);
  yield* movePlayer(P, 11.0, 17.0);
  setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_CURT, ActorScript_11_35);
  setActorScript(P, ACTOR_PLAYER, ActorScript_11_44);
  yield* waitPlayerMove(P);
  yield* waitActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_CURT);
  yield* wait(P, 40);
  yield* rankingMatch(P, STORYMATCH_JUNIOR_3);
}
function* matchBeth(P) {
  face(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_WALK_72_00, FACE_LEFT);
  yield* wait(P, 15);
  face(P, ACTOR_PLAYER, FACE_LEFT);
  face(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BETH, FACE_LEFT);
  yield* wait(P, 30);
  setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_RACKET_STUDENT_1, ActorScript_11_25);
  setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_RACKET_STUDENT_2, ActorScript_11_26);
  yield* wait(P, 120);
  yield* movePlayer(P, 11.0, 17.0);
  setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BETH, ActorScript_11_35);
  setActorScript(P, ACTOR_PLAYER, ActorScript_11_44);
  yield* waitActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BETH);
  yield* wait(P, 40);
  yield* rankingMatch(P, STORYMATCH_JUNIOR_2);
}
function* matchBob(P) {
  face(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_WALK_72_00, FACE_RIGHT);
  yield* wait(P, 15);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  face(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BOB, FACE_RIGHT);
  yield* wait(P, 30);
  setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_RACKET_STUDENT_3, ActorScript_11_23);
  setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_RACKET_STUDENT_4, ActorScript_11_24);
  yield* wait(P, 120);
  yield* movePlayer(P, 23.0, 19.0);
  setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BOB, ActorScript_11_31);
  setActorScript(P, ACTOR_PLAYER, ActorScript_11_43);
  yield* waitPlayerMove(P);
  yield* waitActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BOB);
  yield* wait(P, 40);
  yield* rankingMatch(P, STORYMATCH_JUNIOR_1);
}

export const HOOKS = [
  scene(BANK, 0x7288, promptChallengeRankingOpponent),
  scene(BANK, 0x730A, loadRankingOpponentGraphics),
  scene(BANK, 0x7369, drawRankingOpponentInfo),
  scene(BANK, 0x7784, offerSinglesRankingMatch),
  scene(BANK, 0x781D, startNextRankingMatch),
];
