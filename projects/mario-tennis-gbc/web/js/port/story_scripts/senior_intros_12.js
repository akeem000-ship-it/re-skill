// The senior court's ranking matches (bank $12, $5E91-$6A40): the partner's sprite by gender, the walk onto the
// court, Emily's offer of the next ranking match (singles and doubles: her lines by the ranks won; accepted: the
// opponents' intro and the match's confirmation), the start of each ranking match (the walk to its court, the match
// with the court's return entry $0F), the rally pairs stepping aside or placed, and the opponents' intros. The jump
// tables and actor scripts are data.
// Port of src/story/senior_intros_12.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/engine/rec1.mtrec, rec2.mtrec (the senior court's first offers), out/port/ss2_senior*.mtrec
// (scripted: each rank's offer, accepted and declined, singles and doubles).
import {
  ACTOR_PARTNER, ACTOR_PLAYER, ACTOR_PLAYER_SHADOW, ANIM_BOUNCE, ANIM_NOD, ANIM_WALK, FACE_DOWN, FACE_LEFT,
  FACE_RIGHT, FACE_UP, FLAG_DOUBLES, MATCHLIST_DOUBLES, MATCHLIST_SINGLES, advanceText, askYesNo, endCutscene, face,
  facePair, faceToward, followPlayer, jumpTableTarget, lockFacing, moveAngle, movePlayer, movePlayerToActor,
  moveTarget, nullScript, playStoryMatch, playerSpeed, requestExit, scene, setActorScript, setAnim, setPosition,
  setSpeed, setText, speak, testFlag, unlockFacing, wait, waitActorScript, waitIdle, waitMove, waitPlayerMove,
} from "./common.js";
import { loadObjdef } from "./twins.js";
import { tableText, shadowFollow } from "./shared2.js";
import { seniorSinglesMatchConfirm, seniorDoublesMatchConfirm } from "./senior_matches_12.js";

const OBJ_HARRY = 0x28;
const STORYMATCH_SENIOR_4 = 0x06, STORYMATCH_SENIOR_3 = 0x07, STORYMATCH_SENIOR_2 = 0x08, STORYMATCH_SENIOR_1 = 0x09;
const BANK = 0x12;
const STAGE_SINGLES_RANK4 = 0x02;                       // the court's first ranking stage (wMapSceneStage2)
// data of this bank (read from the ROM)
const StartSeniorRankingMatchTable = 0x60B6, SeniorRankingMatchIntroPtrs = 0x64F2;
const ACTOR_SENIOR_COURT_ALLIE = 0x05;
const ACTOR_SENIOR_COURT_A_ALLIE = 0x05;
const ACTOR_SENIOR_COURT_A_BETH = 0x08;
const ACTOR_SENIOR_COURT_A_BRIAN = 0x07;
const ACTOR_SENIOR_COURT_A_EMILY = 0x03;
const ACTOR_SENIOR_COURT_A_FAY = 0x04;
const ACTOR_SENIOR_COURT_A_JOY = 0x06;
const ACTOR_SENIOR_COURT_A_KATE = 0x0C;
const ACTOR_SENIOR_COURT_A_RACKET_STUDENT_1 = 0x0D;
const ACTOR_SENIOR_COURT_A_RACKET_STUDENT_2 = 0x0E;
const ACTOR_SENIOR_COURT_A_RACKET_STUDENT_3 = 0x0F;
const ACTOR_SENIOR_COURT_A_RACKET_STUDENT_4 = 0x10;
const ACTOR_SENIOR_COURT_BETH = 0x08;
const ACTOR_SENIOR_COURT_BRIAN = 0x07;
const ACTOR_SENIOR_COURT_B_CURT = 0x09;
const ACTOR_SENIOR_COURT_B_FAY = 0x04;
const ACTOR_SENIOR_COURT_B_JOY = 0x06;
const ACTOR_SENIOR_COURT_EMILY = 0x03;
const ACTOR_SENIOR_COURT_RACKET_STUDENT_1 = 0x0D;
const ACTOR_SENIOR_COURT_RACKET_STUDENT_2 = 0x0E;
const ActorScript_12_00 = 0x6C0D;
const ActorScript_12_01 = 0x6C18;
const ActorScript_12_04 = 0x6C51;
const ActorScript_12_05 = 0x6C62;
const ActorScript_12_08 = 0x6C95;
const ActorScript_12_11 = 0x6CDA;
const ActorScript_12_13 = 0x6CEC;
const ActorScript_12_14 = 0x6CFD;
const ActorScript_12_15 = 0x6D0E;
const ActorScript_12_16 = 0x6D1F;
const ActorScript_12_17 = 0x6D30;
const ActorScript_12_18 = 0x6D3F;
const ActorScript_12_19 = 0x6D4E;
const ActorScript_12_20 = 0x6D5D;
const ActorScript_12_21 = 0x782D;
const ActorScript_12_22 = 0x7838;
const ActorScript_12_25 = 0x786B;
const ActorScript_12_26 = 0x7876;
const ActorScript_12_29 = 0x78AB;
const ActorScript_12_30 = 0x78C2;
const ActorScript_12_31 = 0x78D9;
const ActorScript_12_32 = 0x78EA;
const ActorScript_12_37 = 0x7953;
const ActorScript_12_38 = 0x795E;
const ActorScript_12_39 = 0x796F;
const ActorScript_12_40 = 0x7980;
const ActorScript_12_53 = 0x7ABF;
const ActorScript_12_54 = 0x7B22;
const ActorScript_12_55 = 0x7B89;
const ActorScript_12_56 = 0x7BF0;
const FLAG_WON_SENIOR_DOUBLES_RANK_2 = 0x45;
const FLAG_WON_SENIOR_DOUBLES_RANK_3 = 0x44;
const FLAG_WON_SENIOR_SINGLES_RANK_2 = 0x56;
const FLAG_WON_SENIOR_SINGLES_RANK_3 = 0x55;
const FLAG_WON_SENIOR_SINGLES_RANK_4 = 0x54;
const Text_34_110 = 0x106E;
const Text_34_112 = 0x1070;
const Text_34_113 = 0x1071;
const Text_34_122 = 0x107A;
const Text_34_124 = 0x107C;
const Text_34_126 = 0x107E;
const Text_34_54 = 0x1036;
const Text_34_56 = 0x1038;
const Text_34_58 = 0x103A;
const Text_34_60 = 0x103C;
const Text_34_62 = 0x103E;
const Text_34_64 = 0x1040;

// SetPartnerObjDefByGender_12 (12:5E91): a boy partner: Harry's sprite in Kate's place
export function setPartnerObjDefByGender(P) {
  if (P.V.storyModeGenderOfPartnerCharacter) return;
  loadObjdef(P, ACTOR_SENIOR_COURT_A_KATE, OBJ_HARRY);
}

// SeniorCourtWalkPlayersOntoCourt (12:5EAB): entry 1: the partner (doubles) steps out of the way and turns;
// the player walks 2 tiles up onto the court (not waited for)
export function* seniorCourtWalkPlayersOntoCourt(P) {
  if (P.V.storyModeEntryPoint !== 0x01) return;
  if (testFlag(P, FLAG_DOUBLES)) {
    setSpeed(P, ACTOR_PARTNER, 7.96875);
    moveAngle(P, ACTOR_PARTNER, FACE_DOWN, 2.0);
    yield* waitMove(P, ACTOR_PARTNER);
    face(P, ACTOR_PARTNER, FACE_UP);
    setSpeed(P, ACTOR_PARTNER, 0.5);
  }
  setSpeed(P, ACTOR_PLAYER, 0.5);
  moveAngle(P, ACTOR_PLAYER, FACE_UP, 2.0);
}

// SeniorRankOfferScenePrep (12:5EF1): Emily's offer, the player at half speed
export function* seniorRankOfferScenePrep(P) {
  setSpeed(P, ACTOR_PLAYER, 0.5);
  if (!testFlag(P, FLAG_DOUBLES)) return yield* seniorSinglesRankOfferScene(P);
  yield* seniorDoublesRankOfferScene(P);
}

// SeniorRankOfferScenePrepFacingUp (12:5F03): the same backing up facing her
export function* seniorRankOfferScenePrepFacingUp(P) {
  setSpeed(P, ACTOR_PLAYER, 0.25);
  face(P, ACTOR_PLAYER, FACE_UP);
  lockFacing(P, ACTOR_PLAYER);
  if (!testFlag(P, FLAG_DOUBLES)) return yield* seniorSinglesRankOfferScene(P);
  yield* seniorDoublesRankOfferScene(P);
}

// SeniorSinglesRankOfferScene (12:5F22): the player to (45, 27) facing Emily; her offer (another line from rank 4
// on); declined: her line, the cutscene mode ended; accepted: her line by the ranks won, the opponent's intro, the
// confirmation
export function* seniorSinglesRankOfferScene(P) {
  moveTarget(P, ACTOR_PLAYER, 45.0, 27.0);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* wait(P, 10);
  unlockFacing(P, ACTOR_PLAYER);
  faceToward(P, ACTOR_SENIOR_COURT_EMILY, ACTOR_PLAYER);
  faceToward(P, ACTOR_PLAYER, ACTOR_SENIOR_COURT_EMILY);
  yield* setText(P, Text_34_60);
  if (testFlag(P, FLAG_WON_SENIOR_SINGLES_RANK_4)) {
    advanceText(P);
  }
  if ((yield* askYesNo(P, ACTOR_SENIOR_COURT_A_EMILY)) !== 0) {   // .done: declined
    yield* setText(P, Text_34_62);
    yield* speak(P, ACTOR_SENIOR_COURT_EMILY);
    endCutscene(P);
    return;
  }
  yield* setText(P, Text_34_64);                          // her line by the ranks won (4, 3, 2)
  for (const flag of [FLAG_WON_SENIOR_SINGLES_RANK_4, FLAG_WON_SENIOR_SINGLES_RANK_3, FLAG_WON_SENIOR_SINGLES_RANK_2]) {
    if (!testFlag(P, flag)) break;
    advanceText(P);
  }
  yield* speak(P, ACTOR_SENIOR_COURT_EMILY);
  yield* runSeniorRankingMatchIntro(P);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* wait(P, 15);
  setAnim(P, ACTOR_SENIOR_COURT_EMILY, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_EMILY);
  yield* seniorSinglesMatchConfirm(P);
}

// SeniorDoublesRankOfferScene (12:5FC7): the pair to (45, 27) / (45, 29) facing Emily; the same for doubles
// (declined: the partner follows the player again)
export function* seniorDoublesRankOfferScene(P) {
  nullScript(P, ACTOR_PARTNER);
  yield* wait(P, 10);
  moveTarget(P, ACTOR_PARTNER, 45.0, 29.0);
  moveTarget(P, ACTOR_PLAYER, 45.0, 27.0);
  yield* wait(P, 10);
  yield* waitMove(P, ACTOR_PLAYER);
  unlockFacing(P, ACTOR_PLAYER);
  faceToward(P, ACTOR_SENIOR_COURT_EMILY, ACTOR_PLAYER);
  yield* waitMove(P, ACTOR_PARTNER);
  faceToward(P, ACTOR_SENIOR_COURT_EMILY, ACTOR_PARTNER);
  yield* wait(P, 30);
  faceToward(P, ACTOR_PLAYER, ACTOR_SENIOR_COURT_EMILY);
  yield* setText(P, Text_34_110);
  if (testFlag(P, FLAG_WON_SENIOR_DOUBLES_RANK_3)) {
    advanceText(P);
  }
  if ((yield* askYesNo(P, ACTOR_SENIOR_COURT_A_EMILY)) !== 0) {   // .setText: declined; the partner follows again
    yield* setText(P, Text_34_112);
    yield* speak(P, ACTOR_SENIOR_COURT_EMILY);
    followPlayer(P, ACTOR_PARTNER);
    return;
  }
  yield* setText(P, Text_34_113);                         // her line by the ranks won (3, 2)
  for (const flag of [FLAG_WON_SENIOR_DOUBLES_RANK_3, FLAG_WON_SENIOR_DOUBLES_RANK_2]) {
    if (!testFlag(P, flag)) break;
    advanceText(P);
  }
  yield* speak(P, ACTOR_SENIOR_COURT_EMILY);
  yield* runSeniorRankingMatchIntro(P);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, ACTOR_PARTNER, FACE_UP);
  yield* wait(P, 15);
  setAnim(P, ACTOR_SENIOR_COURT_EMILY, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_EMILY);
  yield* seniorDoublesMatchConfirm(P);
}

// StartSeniorRankingMatch (12:60A0): full speed; the stage's ranking match (rst $00 on wMapSceneStage2 - 2)
export function* startSeniorRankingMatch(P) {
  setSpeed(P, ACTOR_PLAYER, 1.0);
  setSpeed(P, ACTOR_PARTNER, 1.0);
  const target = jumpTableTarget(P, BANK, StartSeniorRankingMatchTable, (P.V.mapSceneStage2 - STAGE_SINGLES_RANK4) & 0xFF);
  if (RANK_MATCHES[target]) return yield* RANK_MATCHES[target](P);
  yield* P.runRom(BANK, target);
}
// StartSeniorRankingMatch.rank1 (12:60C4): doubles, Curt and Beth: the walk to the court (36, 23), the match
function* rankMatch1(P) {
  face(P, ACTOR_SENIOR_COURT_EMILY, FACE_LEFT);
  yield* wait(P, 15);
  setActorScript(P, ACTOR_SENIOR_COURT_B_CURT, ActorScript_12_26);
  setActorScript(P, ACTOR_SENIOR_COURT_BETH, ActorScript_12_22);
  setActorScript(P, ACTOR_PARTNER, ActorScript_12_15);
  setActorScript(P, ACTOR_PLAYER, ActorScript_12_13);
  yield* movePlayer(P, 36.0, 23.0);
  yield* waitPlayerMove(P);
  yield* waitActorScript(P, ACTOR_SENIOR_COURT_BETH);
  yield* wait(P, 30);
  requestExit(P, 0x0F);
  yield* playStoryMatch(P, MATCHLIST_DOUBLES, STORYMATCH_SENIOR_3);
}
// StartSeniorRankingMatch.rank2 (12:6136): doubles, Joy and Brian: the walk to the right court
function* rankMatch2(P) {
  face(P, ACTOR_SENIOR_COURT_EMILY, FACE_RIGHT);
  yield* wait(P, 15);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  face(P, ACTOR_PARTNER, FACE_RIGHT);
  face(P, ACTOR_SENIOR_COURT_BRIAN, FACE_RIGHT);
  face(P, ACTOR_SENIOR_COURT_B_JOY, FACE_RIGHT);
  yield* approachSeniorCourtPairB(P);
  setActorScript(P, ACTOR_SENIOR_COURT_B_JOY, ActorScript_12_31);
  setActorScript(P, ACTOR_SENIOR_COURT_BRIAN, ActorScript_12_32);
  setActorScript(P, ACTOR_PARTNER, ActorScript_12_16);
  yield* waitPlayerMove(P);
  yield* waitActorScript(P, ACTOR_SENIOR_COURT_BRIAN);
  yield* wait(P, 30);
  requestExit(P, 0x0F);
  yield* playStoryMatch(P, MATCHLIST_DOUBLES, STORYMATCH_SENIOR_2);
}
// StartSeniorRankingMatch.rank3 (12:61B2): doubles, Allie and Fay: the walk to the left court
function* rankMatch3(P) {
  face(P, ACTOR_SENIOR_COURT_EMILY, FACE_LEFT);
  yield* wait(P, 15);
  face(P, ACTOR_PLAYER, FACE_LEFT);
  face(P, ACTOR_SENIOR_COURT_BRIAN, FACE_LEFT);
  setActorScript(P, ACTOR_SENIOR_COURT_ALLIE, ActorScript_12_39);
  setActorScript(P, ACTOR_SENIOR_COURT_B_FAY, ActorScript_12_40);
  setActorScript(P, ACTOR_PARTNER, ActorScript_12_15);
  setActorScript(P, ACTOR_PLAYER, ActorScript_12_13);
  yield* movePlayer(P, 36.0, 23.0);
  yield* waitPlayerMove(P);
  yield* waitActorScript(P, ACTOR_SENIOR_COURT_B_FAY);
  yield* wait(P, 30);
  requestExit(P, 0x0F);
  yield* playStoryMatch(P, MATCHLIST_DOUBLES, STORYMATCH_SENIOR_1);
}
// StartSeniorRankingMatch.rank4 (12:6232): singles, Brian: the rally pair A steps aside, the walk
function* rankMatch4(P) {
  face(P, ACTOR_SENIOR_COURT_EMILY, FACE_LEFT);
  yield* wait(P, 15);
  face(P, ACTOR_PLAYER, FACE_LEFT);
  face(P, ACTOR_SENIOR_COURT_BRIAN, FACE_LEFT);
  yield* approachSeniorCourtPairA(P);
  setActorScript(P, ACTOR_SENIOR_COURT_BRIAN, ActorScript_12_01);
  yield* waitPlayerMove(P);
  yield* waitActorScript(P, ACTOR_SENIOR_COURT_BRIAN);
  yield* wait(P, 30);
  requestExit(P, 0x0F);
  yield* playStoryMatch(P, MATCHLIST_SINGLES, STORYMATCH_SENIOR_4);
}
// StartSeniorRankingMatch.rank5 (12:628A): singles, Joy: pair B steps aside
function* rankMatch5(P) {
  face(P, ACTOR_SENIOR_COURT_EMILY, FACE_RIGHT);
  yield* wait(P, 15);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  face(P, ACTOR_SENIOR_COURT_A_JOY, FACE_RIGHT);
  yield* wait(P, 30);
  yield* approachSeniorCourtPairB(P);
  setActorScript(P, ACTOR_SENIOR_COURT_A_JOY, ActorScript_12_05);
  yield* waitPlayerMove(P);
  yield* waitActorScript(P, ACTOR_SENIOR_COURT_A_JOY);
  yield* wait(P, 30);
  requestExit(P, 0x0F);
  yield* playStoryMatch(P, MATCHLIST_SINGLES, STORYMATCH_SENIOR_3);
}
// StartSeniorRankingMatch.rank6 (12:62E9): singles, Allie: pair B steps aside
function* rankMatch6(P) {
  face(P, ACTOR_SENIOR_COURT_EMILY, FACE_RIGHT);
  yield* wait(P, 15);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  face(P, ACTOR_SENIOR_COURT_ALLIE, FACE_RIGHT);
  yield* wait(P, 30);
  yield* approachSeniorCourtPairB(P);
  setActorScript(P, ACTOR_SENIOR_COURT_ALLIE, ActorScript_12_05);
  yield* waitPlayerMove(P);
  yield* wait(P, 120);
  yield* waitMove(P, ACTOR_PLAYER);
  requestExit(P, 0x0F);
  yield* playStoryMatch(P, MATCHLIST_SINGLES, STORYMATCH_SENIOR_2);
}
// StartSeniorRankingMatch.rank7 (12:6348): singles, Fay: pair A steps aside
function* rankMatch7(P) {
  face(P, ACTOR_SENIOR_COURT_EMILY, FACE_LEFT);
  yield* wait(P, 15);
  face(P, ACTOR_PLAYER, FACE_LEFT);
  face(P, ACTOR_SENIOR_COURT_A_FAY, FACE_LEFT);
  yield* wait(P, 30);
  yield* approachSeniorCourtPairA(P);
  setActorScript(P, ACTOR_SENIOR_COURT_A_FAY, ActorScript_12_01);
  yield* waitPlayerMove(P);
  yield* wait(P, 180);
  requestExit(P, 0x0F);
  yield* playStoryMatch(P, MATCHLIST_SINGLES, STORYMATCH_SENIOR_1);
}

// ApproachSeniorCourtPairA (12:63A2) / ApproachSeniorCourtPairB (12:63D3): the court's rally pair steps aside;
// the player walks onto it (36, 23) / (53, 23)
export function* approachSeniorCourtPairA(P) {
  setActorScript(P, ACTOR_SENIOR_COURT_RACKET_STUDENT_1, ActorScript_12_17);
  setActorScript(P, ACTOR_SENIOR_COURT_RACKET_STUDENT_2, ActorScript_12_18);
  yield* waitActorScript(P, ACTOR_SENIOR_COURT_RACKET_STUDENT_2);
  yield* movePlayer(P, 36.0, 23.0);
  setActorScript(P, ACTOR_PLAYER, ActorScript_12_13);
}

export function* approachSeniorCourtPairB(P) {
  setActorScript(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_3, ActorScript_12_19);
  setActorScript(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_4, ActorScript_12_20);
  yield* waitActorScript(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_3);
  yield* movePlayer(P, 53.0, 23.0);
  setActorScript(P, ACTOR_PLAYER, ActorScript_12_14);
}

// PlaceSeniorCourtPairA (12:6404) / PlaceSeniorCourtPairB (12:6433): the pair placed aside facing left
export function* placeSeniorCourtPairA(P) {
  nullScript(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_1);
  nullScript(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_2);
  setPosition(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_1, 41.0, 19.0);
  setPosition(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_2, 41.0, 25.0);
  face(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_1, FACE_LEFT);
  face(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_2, FACE_LEFT);
}

export function* placeSeniorCourtPairB(P) {
  nullScript(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_3);
  nullScript(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_4);
  setPosition(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_3, 57.0, 19.0);
  setPosition(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_4, 57.0, 25.0);
  face(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_3, FACE_LEFT);
  face(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_4, FACE_LEFT);
  yield* wait(P, 20);
}

// StartSeniorCourtPairARally (12:6469) / StartSeniorCourtPairBRally (12:64A0): the pair back to its court's
// ends and on its rally scripts
export function* startSeniorCourtPairARally(P) {
  moveTarget(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_1, 34.0, 17.0);
  moveTarget(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_2, 37.0, 29.0);
  yield* waitMove(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_1);
  yield* waitMove(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_2);
  setActorScript(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_1, ActorScript_12_53);
  setActorScript(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_2, ActorScript_12_54);
}

export function* startSeniorCourtPairBRally(P) {
  moveTarget(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_3, 50.0, 17.0);
  moveTarget(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_4, 54.0, 29.0);
  yield* waitMove(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_3);
  yield* waitMove(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_4);
  face(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_4, FACE_UP);
  setActorScript(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_3, ActorScript_12_55);
  setActorScript(P, ACTOR_SENIOR_COURT_A_RACKET_STUDENT_4, ActorScript_12_56);
}

// RunSeniorRankingMatchIntro (12:64DE): the stage's opponents' intro (SeniorRankingMatchIntroPtrs)
export function* runSeniorRankingMatchIntro(P) {
  const target = tableText(P, BANK, SeniorRankingMatchIntroPtrs, (P.V.mapSceneStage2 - STAGE_SINGLES_RANK4) & 0xFF);
  if (MATCH_INTROS[target]) return yield* MATCH_INTROS[target](P);
  yield* P.runRom(BANK, target);
}

// SeniorDoublesRank3Intro (12:6500) .. SeniorSinglesRank1Intro (12:69A9): the opponents step up (the player's
// shadow walking along to them), their lines, then they face their court
export function* seniorDoublesRank3Intro(P) {
  yield* wait(P, 15);
  faceToward(P, ACTOR_SENIOR_COURT_B_CURT, ACTOR_SENIOR_COURT_A_EMILY);
  yield* wait(P, 30);
  faceToward(P, ACTOR_SENIOR_COURT_B_CURT, ACTOR_PLAYER);
  faceToward(P, ACTOR_SENIOR_COURT_B_CURT, ACTOR_PARTNER);
  yield* wait(P, 30);
  playerSpeed(P, 1.0);
  yield* movePlayerToActor(P, ACTOR_SENIOR_COURT_B_CURT);
  yield* waitPlayerMove(P);
  shadowFollow(P, ACTOR_SENIOR_COURT_B_CURT);
  faceToward(P, ACTOR_SENIOR_COURT_A_EMILY, ACTOR_SENIOR_COURT_B_CURT);
  nullScript(P, ACTOR_SENIOR_COURT_A_BETH);
  setAnim(P, ACTOR_SENIOR_COURT_A_BETH, ANIM_WALK);
  faceToward(P, ACTOR_SENIOR_COURT_A_EMILY, ACTOR_SENIOR_COURT_A_BETH);
  setAnim(P, ACTOR_SENIOR_COURT_B_CURT, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_B_CURT);
  setActorScript(P, ACTOR_SENIOR_COURT_B_CURT, ActorScript_12_21);
  setActorScript(P, ACTOR_SENIOR_COURT_A_BETH, ActorScript_12_25);
  face(P, ACTOR_SENIOR_COURT_A_EMILY, FACE_DOWN);
  yield* waitActorScript(P, ACTOR_SENIOR_COURT_B_CURT);
  nullScript(P, ACTOR_PLAYER_SHADOW);
  yield* movePlayerToActor(P, ACTOR_PLAYER);
  yield* waitPlayerMove(P);
  faceToward(P, ACTOR_SENIOR_COURT_B_CURT, ACTOR_PLAYER);
  yield* setText(P, Text_34_126);
  setAnim(P, ACTOR_SENIOR_COURT_A_BETH, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_BETH);
  yield* speak(P, ACTOR_SENIOR_COURT_A_BETH);
  setAnim(P, ACTOR_SENIOR_COURT_B_CURT, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_B_CURT);
  yield* speak(P, ACTOR_SENIOR_COURT_B_CURT);
  face(P, ACTOR_SENIOR_COURT_B_CURT, FACE_UP);
  face(P, ACTOR_SENIOR_COURT_A_BETH, FACE_UP);
  face(P, ACTOR_PARTNER, FACE_UP);
}

export function* seniorDoublesRank2Intro(P) {
  yield* wait(P, 15);
  faceToward(P, ACTOR_SENIOR_COURT_B_JOY, ACTOR_SENIOR_COURT_A_EMILY);
  yield* wait(P, 30);
  faceToward(P, ACTOR_SENIOR_COURT_A_BRIAN, ACTOR_PLAYER);
  faceToward(P, ACTOR_SENIOR_COURT_B_JOY, ACTOR_PARTNER);
  yield* wait(P, 30);
  playerSpeed(P, 1.0);
  yield* movePlayerToActor(P, ACTOR_SENIOR_COURT_A_BRIAN);
  yield* waitPlayerMove(P);
  shadowFollow(P, ACTOR_SENIOR_COURT_A_BRIAN);
  faceToward(P, ACTOR_SENIOR_COURT_A_EMILY, ACTOR_SENIOR_COURT_A_BRIAN);
  setAnim(P, ACTOR_SENIOR_COURT_A_BRIAN, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_BRIAN);
  setActorScript(P, ACTOR_SENIOR_COURT_A_BRIAN, ActorScript_12_29);
  setActorScript(P, ACTOR_SENIOR_COURT_B_JOY, ActorScript_12_30);
  face(P, ACTOR_SENIOR_COURT_A_EMILY, FACE_DOWN);
  yield* waitActorScript(P, ACTOR_SENIOR_COURT_A_BRIAN);
  nullScript(P, ACTOR_PLAYER_SHADOW);
  yield* movePlayerToActor(P, ACTOR_PLAYER);
  yield* waitPlayerMove(P);
  yield* setText(P, Text_34_124);
  setAnim(P, ACTOR_SENIOR_COURT_B_JOY, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_B_JOY);
  yield* speak(P, ACTOR_SENIOR_COURT_B_JOY);
  setAnim(P, ACTOR_SENIOR_COURT_A_BRIAN, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_BRIAN);
  yield* speak(P, ACTOR_SENIOR_COURT_A_BRIAN);
  face(P, ACTOR_SENIOR_COURT_A_BRIAN, FACE_UP);
  face(P, ACTOR_SENIOR_COURT_B_JOY, FACE_UP);
}

export function* seniorDoublesRank1Intro(P) {
  yield* wait(P, 15);
  faceToward(P, ACTOR_SENIOR_COURT_A_ALLIE, ACTOR_SENIOR_COURT_A_EMILY);
  yield* wait(P, 30);
  faceToward(P, ACTOR_SENIOR_COURT_B_FAY, ACTOR_PLAYER);
  faceToward(P, ACTOR_SENIOR_COURT_A_ALLIE, ACTOR_PARTNER);
  nullScript(P, ACTOR_SENIOR_COURT_B_FAY);
  setAnim(P, ACTOR_SENIOR_COURT_B_FAY, ANIM_WALK);
  yield* wait(P, 30);
  playerSpeed(P, 1.0);
  nullScript(P, ACTOR_SENIOR_COURT_B_FAY);
  face(P, ACTOR_SENIOR_COURT_B_FAY, FACE_DOWN);
  moveTarget(P, ACTOR_SENIOR_COURT_A_ALLIE, 43.0, 17.0);
  yield* movePlayerToActor(P, ACTOR_SENIOR_COURT_A_ALLIE);
  yield* waitPlayerMove(P);
  face(P, ACTOR_SENIOR_COURT_A_ALLIE, FACE_DOWN);
  faceToward(P, ACTOR_SENIOR_COURT_A_EMILY, ACTOR_SENIOR_COURT_A_ALLIE);
  setAnim(P, ACTOR_SENIOR_COURT_A_ALLIE, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_ALLIE);
  setActorScript(P, ACTOR_SENIOR_COURT_A_ALLIE, ActorScript_12_37);
  yield* wait(P, 15);
  yield* movePlayerToActor(P, ACTOR_PLAYER);
  setActorScript(P, ACTOR_SENIOR_COURT_B_FAY, ActorScript_12_38);
  face(P, ACTOR_SENIOR_COURT_A_EMILY, FACE_DOWN);
  yield* waitActorScript(P, ACTOR_SENIOR_COURT_B_FAY);
  faceToward(P, ACTOR_SENIOR_COURT_B_FAY, ACTOR_PLAYER);
  faceToward(P, ACTOR_SENIOR_COURT_A_ALLIE, ACTOR_PARTNER);
  yield* setText(P, Text_34_122);
  setAnim(P, ACTOR_SENIOR_COURT_B_FAY, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_B_FAY);
  yield* speak(P, ACTOR_SENIOR_COURT_B_FAY);
  setAnim(P, ACTOR_SENIOR_COURT_A_ALLIE, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_ALLIE);
  yield* speak(P, ACTOR_SENIOR_COURT_A_ALLIE);
  face(P, ACTOR_SENIOR_COURT_A_ALLIE, FACE_UP);
  face(P, ACTOR_SENIOR_COURT_B_FAY, FACE_UP);
}

export function* seniorSinglesRank4Intro(P) {
  yield* wait(P, 15);
  faceToward(P, ACTOR_SENIOR_COURT_A_BRIAN, ACTOR_SENIOR_COURT_A_EMILY);
  yield* wait(P, 30);
  faceToward(P, ACTOR_SENIOR_COURT_A_BRIAN, ACTOR_PLAYER);
  yield* wait(P, 30);
  playerSpeed(P, 1.0);
  yield* movePlayerToActor(P, ACTOR_SENIOR_COURT_A_BRIAN);
  yield* waitPlayerMove(P);
  shadowFollow(P, ACTOR_SENIOR_COURT_A_BRIAN);
  faceToward(P, ACTOR_SENIOR_COURT_A_EMILY, ACTOR_SENIOR_COURT_A_BRIAN);
  setAnim(P, ACTOR_SENIOR_COURT_A_BRIAN, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_BRIAN);
  setActorScript(P, ACTOR_SENIOR_COURT_A_BRIAN, ActorScript_12_00);
  face(P, ACTOR_SENIOR_COURT_A_EMILY, FACE_DOWN);
  yield* waitActorScript(P, ACTOR_SENIOR_COURT_A_BRIAN);
  nullScript(P, ACTOR_PLAYER_SHADOW);
  faceToward(P, ACTOR_SENIOR_COURT_A_BRIAN, ACTOR_PLAYER);
  setAnim(P, ACTOR_SENIOR_COURT_A_BRIAN, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_BRIAN);
  setAnim(P, ACTOR_SENIOR_COURT_A_BRIAN, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_BRIAN);
  face(P, ACTOR_SENIOR_COURT_A_BRIAN, FACE_UP);
}

export function* seniorSinglesRank3Intro(P) {
  yield* wait(P, 15);
  faceToward(P, ACTOR_SENIOR_COURT_A_JOY, ACTOR_SENIOR_COURT_A_EMILY);
  yield* wait(P, 30);
  faceToward(P, ACTOR_SENIOR_COURT_A_JOY, ACTOR_PLAYER);
  yield* wait(P, 30);
  playerSpeed(P, 1.0);
  yield* movePlayerToActor(P, ACTOR_SENIOR_COURT_A_JOY);
  yield* waitPlayerMove(P);
  shadowFollow(P, ACTOR_SENIOR_COURT_A_JOY);
  faceToward(P, ACTOR_SENIOR_COURT_A_EMILY, ACTOR_SENIOR_COURT_A_JOY);
  setAnim(P, ACTOR_SENIOR_COURT_A_JOY, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_JOY);
  setActorScript(P, ACTOR_SENIOR_COURT_A_JOY, ActorScript_12_04);
  face(P, ACTOR_SENIOR_COURT_A_EMILY, FACE_DOWN);
  yield* movePlayerToActor(P, ACTOR_PLAYER);
  yield* waitActorScript(P, ACTOR_SENIOR_COURT_A_JOY);
  nullScript(P, ACTOR_PLAYER_SHADOW);
  facePair(P, ACTOR_PLAYER, ACTOR_SENIOR_COURT_A_JOY);
  setAnim(P, ACTOR_SENIOR_COURT_A_JOY, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_JOY);
  yield* setText(P, Text_34_58);
  yield* speak(P, ACTOR_SENIOR_COURT_A_JOY);
  setAnim(P, ACTOR_SENIOR_COURT_A_JOY, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_JOY);
  yield* speak(P, ACTOR_SENIOR_COURT_A_JOY);
  yield* wait(P, 15);
  face(P, ACTOR_SENIOR_COURT_A_JOY, FACE_UP);
}

export function* seniorSinglesRank2Intro(P) {
  yield* wait(P, 15);
  faceToward(P, ACTOR_SENIOR_COURT_A_ALLIE, ACTOR_SENIOR_COURT_A_EMILY);
  yield* wait(P, 30);
  faceToward(P, ACTOR_SENIOR_COURT_A_ALLIE, ACTOR_PLAYER);
  yield* wait(P, 30);
  playerSpeed(P, 1.0);
  yield* movePlayerToActor(P, ACTOR_SENIOR_COURT_A_ALLIE);
  yield* waitPlayerMove(P);
  shadowFollow(P, ACTOR_SENIOR_COURT_A_ALLIE);
  faceToward(P, ACTOR_SENIOR_COURT_A_EMILY, ACTOR_SENIOR_COURT_A_ALLIE);
  setAnim(P, ACTOR_SENIOR_COURT_A_ALLIE, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_ALLIE);
  setActorScript(P, ACTOR_SENIOR_COURT_A_ALLIE, ActorScript_12_08);
  face(P, ACTOR_SENIOR_COURT_A_EMILY, FACE_DOWN);
  nullScript(P, ACTOR_PLAYER_SHADOW);
  yield* movePlayerToActor(P, ACTOR_PLAYER);
  yield* waitPlayerMove(P);
  faceToward(P, ACTOR_PLAYER, ACTOR_SENIOR_COURT_A_ALLIE);
  setAnim(P, ACTOR_SENIOR_COURT_A_ALLIE, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_ALLIE);
  yield* setText(P, Text_34_56);
  yield* speak(P, ACTOR_SENIOR_COURT_A_ALLIE);
  setAnim(P, ACTOR_SENIOR_COURT_A_ALLIE, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_ALLIE);
  yield* speak(P, ACTOR_SENIOR_COURT_A_ALLIE);
  yield* wait(P, 15);
  face(P, ACTOR_SENIOR_COURT_A_ALLIE, FACE_UP);
}

export function* seniorSinglesRank1Intro(P) {
  yield* wait(P, 15);
  faceToward(P, ACTOR_SENIOR_COURT_A_FAY, ACTOR_SENIOR_COURT_A_EMILY);
  yield* wait(P, 30);
  faceToward(P, ACTOR_SENIOR_COURT_A_FAY, ACTOR_PLAYER);
  yield* wait(P, 30);
  playerSpeed(P, 1.0);
  yield* movePlayerToActor(P, ACTOR_SENIOR_COURT_A_FAY);
  yield* waitPlayerMove(P);
  faceToward(P, ACTOR_SENIOR_COURT_A_EMILY, ACTOR_SENIOR_COURT_A_FAY);
  setAnim(P, ACTOR_SENIOR_COURT_A_FAY, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_FAY);
  setActorScript(P, ACTOR_SENIOR_COURT_A_FAY, ActorScript_12_11);
  face(P, ACTOR_SENIOR_COURT_A_EMILY, FACE_DOWN);
  yield* movePlayerToActor(P, ACTOR_PLAYER);
  yield* waitPlayerMove(P);
  faceToward(P, ACTOR_PLAYER, ACTOR_SENIOR_COURT_A_FAY);
  yield* setText(P, Text_34_54);
  yield* speak(P, ACTOR_SENIOR_COURT_A_FAY);
  setAnim(P, ACTOR_SENIOR_COURT_A_FAY, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_FAY);
  yield* speak(P, ACTOR_SENIOR_COURT_A_FAY);
  yield* wait(P, 15);
  face(P, ACTOR_SENIOR_COURT_A_FAY, FACE_UP);
}

// the ranking matches and their intros, by address (the jump tables' targets)
const RANK_MATCHES = {
  0x60C4: rankMatch1, 0x6136: rankMatch2, 0x61B2: rankMatch3, 0x6232: rankMatch4, 0x628A: rankMatch5,
  0x62E9: rankMatch6, 0x6348: rankMatch7,
};
const MATCH_INTROS = {
  0x67A1: seniorSinglesRank4Intro, 0x683B: seniorSinglesRank3Intro, 0x68F3: seniorSinglesRank2Intro,
  0x69A9: seniorSinglesRank1Intro, 0x6500: seniorDoublesRank3Intro, 0x65E9: seniorDoublesRank2Intro,
  0x66AF: seniorDoublesRank1Intro,
};

export const HOOKS = [
  // (a script-macro routine: the registers it leaves are read by no caller, and put back as at the call)
  scene(BANK, 0x5E91, function* (P) { setPartnerObjDefByGender(P); }),
  scene(BANK, 0x5EAB, seniorCourtWalkPlayersOntoCourt),
  scene(BANK, 0x5EF1, seniorRankOfferScenePrep),
  scene(BANK, 0x5F03, seniorRankOfferScenePrepFacingUp),
  scene(BANK, 0x5F22, seniorSinglesRankOfferScene),
  scene(BANK, 0x5FC7, seniorDoublesRankOfferScene),
  scene(BANK, 0x60A0, startSeniorRankingMatch),
  scene(BANK, 0x63A2, approachSeniorCourtPairA),
  scene(BANK, 0x63D3, approachSeniorCourtPairB),
  scene(BANK, 0x6404, placeSeniorCourtPairA),
  scene(BANK, 0x6433, placeSeniorCourtPairB),
  scene(BANK, 0x6469, startSeniorCourtPairARally),
  scene(BANK, 0x64A0, startSeniorCourtPairBRally),
  scene(BANK, 0x64DE, runSeniorRankingMatchIntro),
  scene(BANK, 0x6500, seniorDoublesRank3Intro),
  scene(BANK, 0x65E9, seniorDoublesRank2Intro),
  scene(BANK, 0x66AF, seniorDoublesRank1Intro),
  scene(BANK, 0x67A1, seniorSinglesRank4Intro),
  scene(BANK, 0x683B, seniorSinglesRank3Intro),
  scene(BANK, 0x68F3, seniorSinglesRank2Intro),
  scene(BANK, 0x69A9, seniorSinglesRank1Intro),
];
