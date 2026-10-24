// The senior class court (bank $12, $5591-$5E90): its exit, Emily (the stage's offer of a ranking match, the
// doubles pair's turn to her on the first visit, her line as champion), the students' lines by the court's stage
// (wMapSceneStage2: questions; Beth's and Bob's practice matches), the tile where Bob and Pam step up, the init
// script (the stage, the behavior map, the actor lists by progress, the return entries of the matches) and the
// actors placed by progress. The map tables, actor lists and text-id tables are data.
// Port of src/story/senior_court_12.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/engine/rec1.mtrec, rec2.mtrec (the senior court: the stages reached), out/port/ss2_senior*.mtrec
// (scripted: each stage's NPCs, the practice matches, singles and doubles, both partner genders).
import {
  ACTOR_PARTNER, ACTOR_PLAYER, ANIM_BOUNCE, ANIM_NOD, ANIM_WALK, FACE_DOWN, FACE_LEFT, FACE_UP, FLAG_DOUBLES,
  MATCHLIST_DOUBLES, MATCHLIST_SINGLES, actorState, advanceText, askYesNo, clearFlag, copyBehaviorRect, endCutscene,
  face, faceToward, fadeOut, followPlayer, gesture, lockFacing, moveAngle, movePlayer, moveTarget, nullScript,
  playStoryMatch, question, respawnActors, returnHereAfter, scene, setActorScript, setAnim, setFlag, setPosition,
  setSpeed, setText, speak, testFlag, unlockFacing, wait, waitActorScript, waitIdle, waitMove, waitPlayerMove,
} from "./common.js";
import { computeRankingProgressIndex, loadObjdef } from "./twins.js";
import { pushTextArgFetchedString, tableText } from "./shared2.js";
import { seniorRankOfferScenePrep, seniorRankOfferScenePrepFacingUp, setPartnerObjDefByGender,
  seniorCourtWalkPlayersOntoCourt } from "./senior_intros_12.js";
import { seniorCourtPostMatchReturn, seniorCourtReloadIntoVictoryScene, seniorMatchVictorySceneDispatch } from "./senior_matches_12.js";
import { computeSeniorCourtStage } from "./senior_victory_12.js";

const BANK = 0x12;
// the court's stages (wMapSceneStage2)
const STAGE_SINGLES_RANK4 = 0x02, STAGE_SINGLES_RANK3 = 0x03, STAGE_SINGLES_RANK2 = 0x04;
const STAGE_DOUBLES_RANK3 = 0x06, STAGE_DOUBLES_RANK2 = 0x07, STAGE_SINGLES_SENIOR_CHAMP = 0x09;
const STAGE_DOUBLES_SENIOR_CHAMP = 0x0A, STAGE_SINGLES_ISLAND_OPEN = 0x0B, STAGE_DOUBLES_ISLAND_OPEN = 0x0C;
const STAGE_OFFERS_END = 0x09, STAGE_EMILY_RECOLORED_END = 0x0D;
const STORYMATCH_SENIOR_PRACTICE = 0x05;
const ANIM_SWING_LOOP = 0x06, OBJ_WALK_72_04 = 0x3B;
const ACTOR_SENIOR_COURT_EMILY = 0x03, ACTOR_ROLE_SENIOR_COURT_FAY = 0x04, ACTOR_SENIOR_COURT_ALLIE = 0x05;
const ACTOR_ROLE_SENIOR_COURT_JOY = 0x06, ACTOR_SENIOR_COURT_BRIAN = 0x07, ACTOR_SENIOR_COURT_BETH = 0x08;
const ACTOR_ROLE_SENIOR_COURT_CURT = 0x09, ACTOR_ROLE_SENIOR_COURT_BOB = 0x0A, ACTOR_ROLE_SENIOR_COURT_PAM = 0x0B;
const ACTOR_SENIOR_COURT_KATE = 0x0C, ACTOR_SENIOR_COURT_CURT = 0x09;
const EMILY = ACTOR_SENIOR_COURT_EMILY, FAY = ACTOR_ROLE_SENIOR_COURT_FAY, ALLIE = ACTOR_SENIOR_COURT_ALLIE;
const JOY = ACTOR_ROLE_SENIOR_COURT_JOY, BETH = ACTOR_SENIOR_COURT_BETH, BOB = ACTOR_ROLE_SENIOR_COURT_BOB;
const PAM = ACTOR_ROLE_SENIOR_COURT_PAM, BRIAN = ACTOR_SENIOR_COURT_BRIAN, CURT = ACTOR_SENIOR_COURT_CURT;
const ActorScript_12_45 = 0x79F1, ActorScript_12_46 = 0x79FC, ActorScript_12_47 = 0x7A07, ActorScript_12_48 = 0x7A24;
const ActorScript_12_49 = 0x7A41, ActorScript_12_50 = 0x7A5A;
const FLAG_WON_JUNIOR_DOUBLES_RANK_1 = 0x42, FLAG_WON_JUNIOR_SINGLES_RANK_1 = 0x53;
const FLAG_SENIOR_COURT_NPC03_TURNED = 0x74, FLAG_SENIOR_COURT_TILE01_TRIGGERED = 0x7C;
const Text_34_4 = 0x1004, Text_34_7 = 0x1007, Text_34_10 = 0x100A, Text_34_11 = 0x100B;
const TEXT_GENDER_NAMES = 0x001D;                        // the short text of the player's gender's word (+ gender)
// data of this bank (read from the ROM)
const SeniorCourtActorsA_12 = 0x53B7, SeniorCourtActorsB_12 = 0x5493;
const SeniorCourtExit01TextIds = 0x55DC, SeniorCourtNpc04TextIds = 0x5847, SeniorCourtNpc05TextIds_12 = 0x5895;
const SeniorCourtNpc06TextIds_12 = 0x58F8, SeniorCourtNpc07TextIds = 0x592D, SeniorCourtNpc08TextIds = 0x5A2B;
const SeniorCourtNpc09TextIds = 0x5A6E, SeniorCourtNpc0ATextIds = 0x5B75, SeniorCourtNpc0BTextIds = 0x5BBF;
const SeniorCourtNpc0CTextIds = 0x5C11, SeniorCourtNpc0C_12Table = 0x5C2F;
const stage2 = P => P.V.mapSceneStage2;
// the NPC's line of the table's entry for the court's stage
const stageText = (P, table) => setText(P, tableText(P, BANK, table, stage2(P)));

// SeniorCourtExit01_12 (12:5591): leaving: the tile trigger re-armed; the party steps down, faded out
export function* seniorCourtExit01(P) {
  clearFlag(P, FLAG_SENIOR_COURT_TILE01_TRIGGERED);
  moveAngle(P, ACTOR_PLAYER, FACE_DOWN, 2.0);
  moveAngle(P, ACTOR_PARTNER, FACE_DOWN, 2.0);
  fadeOut(P, 16);
  yield* wait(P, 30);
}
// SeniorCourtExit01_12.loop (12:55B5): Emily's line as champion (from the senior champion stage on), with the
// word for the player's gender as its argument
function* emilyChampionLine(P) {
  yield* setText(P, tableText(P, BANK, SeniorCourtExit01TextIds, (stage2(P) - STAGE_SINGLES_SENIOR_CHAMP) & 0xFF));
  pushTextArgFetchedString(P, (TEXT_GENDER_NAMES + P.V.storyModeGenderOfMainCharacter) & 0xFFFF);
  yield* speak(P, EMILY);
}
// SeniorCourtNpc03_12 (12:55E8) / SeniorCourtNpc03FaceUpFlag0000_12 (12:55F7): Emily. Before the ranking
// stages, her question (doubles: the pair's turn to her); during them, the offer of the next ranking match (talked
// to from below: the player facing up); after them, her line as champion
function* emilyByStage(P, offer) {
  if (stage2(P) < STAGE_SINGLES_RANK4) return yield* emilyBeforeRanks(P);
  if (stage2(P) >= STAGE_OFFERS_END) return yield* emilyChampionLine(P);
  yield* offer(P);
}
export const seniorCourtNpc03 = P => emilyByStage(P, seniorRankOfferScenePrep);
export const seniorCourtNpc03FaceUpFlag0000 = P => emilyByStage(P, seniorRankOfferScenePrepFacingUp);
// SeniorCourtNpc03FaceUpFlag0000_12.checkDoubles (12:5606): doubles, the pair's turn (from the left); singles her
// question
function* emilyBeforeRanks(P) {
  if (testFlag(P, FLAG_DOUBLES)) return yield* pairTurnFromLeft(P);
  yield* question(P, Text_34_4, EMILY);
}
// SeniorCourtNpc03FaceRight_12 (12:5630): doubles, talked to from the right: the pair walks round to her (the
// partner by (39, 29) and (43, 29)); singles as SeniorCourtNpc03_12
export function* seniorCourtNpc03FaceRight(P) {
  if (!testFlag(P, FLAG_DOUBLES)) return yield* seniorCourtNpc03(P);
  if (testFlag(P, FLAG_SENIOR_COURT_NPC03_TURNED)) return yield* pairLine(P);
  setSpeed(P, ACTOR_PLAYER, 0.5);
  setSpeed(P, ACTOR_PARTNER, 0.5);
  nullScript(P, ACTOR_PARTNER);
  moveTarget(P, ACTOR_PLAYER, 41.0, 27.0);
  for (const [x, y] of [[39.0, 29.0], [43.0, 29.0], [43.0, 25.0]]) {
    moveTarget(P, ACTOR_PARTNER, x, y);
    yield* waitMove(P, ACTOR_PARTNER);
  }
  faceToward(P, EMILY, ACTOR_PARTNER);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* pairTurn(P);
}
// SeniorCourtNpc03FaceUpFlag0840_12 (12:569B): doubles, talked to from below: the player backs up facing her
// while the partner goes round by (43, 27); singles as SeniorCourtNpc03FaceUpFlag0000_12
export function* seniorCourtNpc03FaceUpFlag0840(P) {
  if (!testFlag(P, FLAG_DOUBLES)) return yield* seniorCourtNpc03FaceUpFlag0000(P);
  if (testFlag(P, FLAG_SENIOR_COURT_NPC03_TURNED)) return yield* pairLine(P);
  setSpeed(P, ACTOR_PARTNER, 0.5);
  setSpeed(P, ACTOR_PLAYER, 0.25);
  face(P, ACTOR_PLAYER, FACE_UP);
  lockFacing(P, ACTOR_PLAYER);
  nullScript(P, ACTOR_PARTNER);
  moveTarget(P, ACTOR_PLAYER, 41.0, 27.0);
  moveTarget(P, ACTOR_PARTNER, 43.0, 27.0);
  yield* waitMove(P, ACTOR_PARTNER);
  moveTarget(P, ACTOR_PARTNER, 43.0, 25.0);
  yield* waitMove(P, ACTOR_PARTNER);
  faceToward(P, EMILY, ACTOR_PARTNER);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* pairTurn(P);
}
// SeniorCourtNpc03FaceUpFlag0840_12.checkFlag (12:5704): the pair to her from the left
function* pairTurnFromLeft(P) {
  if (testFlag(P, FLAG_SENIOR_COURT_NPC03_TURNED)) return yield* pairLine(P);
  setSpeed(P, ACTOR_PLAYER, 0.5);
  setSpeed(P, ACTOR_PARTNER, 0.5);
  nullScript(P, ACTOR_PARTNER);
  moveTarget(P, ACTOR_PLAYER, 41.0, 27.0);
  moveTarget(P, ACTOR_PARTNER, 43.0, 25.0);
  yield* waitMove(P, ACTOR_PARTNER);
  faceToward(P, EMILY, ACTOR_PARTNER);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* pairTurn(P);
}
// SeniorCourtNpc03FaceUpFlag0840_12.face (12:5747): the first time: Emily nods to both, her lines to the pair
// (Text_34_7; Text_34_11 for a girl partner), the partner's answer, the partner back to (43, 27); then .setText
function* pairTurn(P) {
  faceToward(P, EMILY, ACTOR_PLAYER);
  faceToward(P, ACTOR_PARTNER, EMILY);
  yield* gesture(P, EMILY, ANIM_NOD);
  yield* wait(P, 30);
  faceToward(P, ACTOR_PLAYER, EMILY);
  yield* gesture(P, EMILY, ANIM_NOD);
  unlockFacing(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* setText(P, Text_34_7);
  setFlag(P, FLAG_SENIOR_COURT_NPC03_TURNED);
  if (!P.V.storyModeGenderOfPartnerCharacter) yield* setText(P, Text_34_11);
  yield* speak(P, EMILY);                                 // .speak
  faceToward(P, ACTOR_PARTNER, EMILY);
  yield* speak(P, EMILY);
  yield* gesture(P, ACTOR_PARTNER, ANIM_NOD);
  yield* speak(P, ACTOR_PARTNER);
  setSpeed(P, ACTOR_PLAYER, 0.75);
  setSpeed(P, ACTOR_PARTNER, 0.75);
  moveTarget(P, ACTOR_PARTNER, 43.0, 27.0);
  yield* waitMove(P, ACTOR_PARTNER);
  faceToward(P, EMILY, ACTOR_PARTNER);
  faceToward(P, ACTOR_PARTNER, EMILY);
  yield* pairLine(P);
}
// SeniorCourtNpc03FaceUpFlag0840_12.setText (12:57F4): her line to the pair; both nod; the partner follows the
// player again
function* pairLine(P) {
  yield* setText(P, Text_34_10);
  yield* speak(P, EMILY);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  setAnim(P, ACTOR_PARTNER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PARTNER);
  followPlayer(P, ACTOR_PARTNER);
}

// SeniorCourtNpc04_12 (12:5820): Fay's line by stage
export function* seniorCourtNpc04(P) {
  yield* stageText(P, SeniorCourtNpc04TextIds);
  yield* speak(P, FAY);
}
// SeniorCourtNpc05_12 (12:5859): Allie's line by stage; at the singles rank-2 stage a question
export function* seniorCourtNpc05(P) {
  yield* stageText(P, SeniorCourtNpc05TextIds_12);
  if (stage2(P) === STAGE_SINGLES_RANK2 && (yield* askYesNo(P, ALLIE)) !== 0) advanceText(P);
  yield* speak(P, ALLIE);
}
// SeniorCourtNpc06_12 (12:58B3): Joy's line by stage; at the doubles rank-3 stage a question (a no: the other
// answer, for a boy partner the one after)
export function* seniorCourtNpc06(P) {
  yield* stageText(P, SeniorCourtNpc06TextIds_12);
  if (stage2(P) === STAGE_DOUBLES_RANK3 && (yield* askYesNo(P, JOY)) !== 0) {
    advanceText(P);
    if (!P.V.storyModeGenderOfPartnerCharacter) advanceText(P);
  }
  yield* speak(P, JOY);
}
// SeniorCourtNpc07_12 (12:5916): Brian's line by stage
export function* seniorCourtNpc07(P) {
  yield* stageText(P, SeniorCourtNpc07TextIds);
  yield* speak(P, BRIAN);
}
// SeniorCourtNpc08_12 (12:594B): Beth's line by stage (before the ranks back to her swing practice); at the
// singles rank-4 stage two questions: yes to both, her practice match (singles) from here, coming back here
export function* seniorCourtNpc08(P) {
  yield* stageText(P, SeniorCourtNpc08TextIds);
  if (stage2(P) !== STAGE_SINGLES_RANK4) {
    if (stage2(P) < STAGE_SINGLES_RANK4) {
      face(P, BETH, FACE_UP);
      setAnim(P, BETH, ANIM_SWING_LOOP);
    }
    return yield* speak(P, BETH);                         // .altText
  }
  if ((yield* askYesNo(P, BETH)) !== 0) return yield* speak(P, BETH);   // .speak
  advanceText(P);                                         // .doublesLine
  yield* gesture(P, BETH, ANIM_BOUNCE);
  if ((yield* askYesNo(P, BETH)) !== 0) return yield* speak(P, BETH);
  yield* wait(P, 10);                                     // .done
  setActorScript(P, ACTOR_PLAYER, ActorScript_12_50);
  moveTarget(P, BETH, 12.0, 21.0);
  yield* waitMove(P, BETH);
  setActorScript(P, BETH, ActorScript_12_49);
  yield* movePlayer(P, 10.0, 17.0);
  yield* waitPlayerMove(P);
  yield* waitActorScript(P, BETH);
  returnHereAfter(P);
  yield* playStoryMatch(P, MATCHLIST_SINGLES, STORYMATCH_SENIOR_PRACTICE);
}
// SeniorCourtNpc09_12 (12:5A49): Curt's line by stage (before the ranks he turns down first)
export function* seniorCourtNpc09(P) {
  yield* stageText(P, SeniorCourtNpc09TextIds);
  if (stage2(P) < STAGE_SINGLES_RANK4) face(P, CURT, FACE_DOWN);
  yield* speak(P, ACTOR_ROLE_SENIOR_COURT_CURT);
}
// SeniorCourtNpc0A_12 (12:5A8C): Bob's line by stage; at the doubles rank-3 stage two questions: yes to both,
// Bob and Pam's practice match (doubles) from here (Bob's actor flags 0 and 1 cleared first)
export function* seniorCourtNpc0A(P) {
  yield* stageText(P, SeniorCourtNpc0ATextIds);
  if (stage2(P) !== STAGE_DOUBLES_RANK3) return yield* speak(P, BOB);
  if ((yield* askYesNo(P, BOB)) !== 0) return yield* speak(P, BOB);    // .altText
  advanceText(P);                                         // .speak
  if ((yield* askYesNo(P, BOB)) !== 0) return yield* speak(P, BOB);
  const flags = (actorState(P, BOB) + 0x05) & 0xFFFF;     // .done
  P.bus.w8(flags, P.bus.u8(flags) & ~0x03);
  setSpeed(P, ACTOR_PLAYER, 1.0);
  setSpeed(P, ACTOR_PARTNER, 1.0);
  setActorScript(P, ACTOR_PLAYER, ActorScript_12_47);
  yield* wait(P, 32);
  setActorScript(P, ACTOR_PARTNER, ActorScript_12_48);
  setActorScript(P, BOB, ActorScript_12_45);
  setActorScript(P, PAM, ActorScript_12_46);
  yield* movePlayer(P, 10.0, 17.0);
  yield* waitPlayerMove(P);
  yield* waitActorScript(P, ACTOR_PLAYER);
  returnHereAfter(P);
  yield* playStoryMatch(P, MATCHLIST_DOUBLES, STORYMATCH_SENIOR_PRACTICE);
}
// SeniorCourtNpc0B_12 (12:5B93): Pam's line by stage (doubles at the Island Open with a boy partner: the next one)
export function* seniorCourtNpc0B(P) {
  yield* stageText(P, SeniorCourtNpc0BTextIds);
  if (stage2(P) >= STAGE_DOUBLES_ISLAND_OPEN && testFlag(P, FLAG_DOUBLES) && !P.V.storyModeGenderOfPartnerCharacter) {
    advanceText(P);
  }
  yield* speak(P, PAM);
}
// SeniorCourtNpc0C_12 (12:5BDD): Kate's line by stage, from one table for a girl partner, another for a boy
export function* seniorCourtNpc0C(P) {
  yield* stageText(P, P.V.storyModeGenderOfPartnerCharacter ? SeniorCourtNpc0CTextIds : SeniorCourtNpc0C_12Table);
  yield* speak(P, ACTOR_SENIOR_COURT_KATE);
}
// Bob and Pam stepping up to (20, 19) / (20, 15) (walk: walking there, else placed), the player facing them
function* bobAndPamStepUp(P, walk) {
  nullScript(P, BOB);
  nullScript(P, PAM);
  setAnim(P, BOB, ANIM_WALK);
  setAnim(P, PAM, ANIM_WALK);
  if (walk) {
    moveTarget(P, BOB, 20.0, 19.0);
    moveTarget(P, PAM, 20.0, 15.0);
    yield* waitMove(P, BOB);
    yield* waitMove(P, PAM);
  } else {
    setPosition(P, BOB, 20.0, 19.0);
    setPosition(P, PAM, 20.0, 15.0);
  }
  faceToward(P, ACTOR_PLAYER, BOB);
  faceToward(P, ACTOR_PLAYER, PAM);
}
// SeniorCourtTile01_12 (12:5CD0): Bob and Pam step up to the player (once until leaving)
export function* seniorCourtTile01(P) {
  setFlag(P, FLAG_SENIOR_COURT_TILE01_TRIGGERED);
  yield* bobAndPamStepUp(P, true);
}
// SeniorCourtInitScript_12 (12:5D1C): the story rank and the court's stage; before the ranks the behavior map's
// rect (8 x 14 from (0, $2A) to ($10, $0A)), and Bob and Pam where they stepped up; the actors by the junior titles
// (list A singles, B doubles) and by progress, the partner's sprite; entries $0F / $0E / $0D the matches' returns;
// else the rest placed by progress, the cutscene mode ended and the walk onto the court
export function* seniorCourtInitScript(P) {
  computeRankingProgressIndex(P);
  computeSeniorCourtStage(P);
  if (stage2(P) < STAGE_SINGLES_RANK4) {
    copyBehaviorRect(P, 0x08, 0x0E, 0x00, 0x2A, 0x10, 0x0A);
    if (testFlag(P, FLAG_SENIOR_COURT_TILE01_TRIGGERED)) yield* bobAndPamStepUp(P, false);
  }
  const doubles = testFlag(P, FLAG_DOUBLES);              // .fromMatch
  if (testFlag(P, doubles ? FLAG_WON_JUNIOR_DOUBLES_RANK_1 : FLAG_WON_JUNIOR_SINGLES_RANK_1)) {
    respawnActors(P, doubles ? SeniorCourtActorsB_12 : SeniorCourtActorsA_12);
  }
  seniorCourtPositionActorsByProgressA(P);                // .placeActors
  setPartnerObjDefByGender(P);
  const entry = P.V.storyModeEntryPoint;
  if (entry === 0x0F) return yield* seniorCourtPostMatchReturn(P);
  if (entry === 0x0E) return yield* seniorCourtReloadIntoVictoryScene(P);
  if (entry === 0x0D) return yield* seniorMatchVictorySceneDispatch(P);
  seniorCourtPositionActorsByProgressB(P);
  endCutscene(P);
  yield* seniorCourtWalkPlayersOntoCourt(P);
}
// SeniorCourtPositionActorsByProgressB (12:5DBE): at the Island Open stages Emily's other sprite; Fay gone from
// the senior champion stage on (doubles: Allie too)
export function seniorCourtPositionActorsByProgressB(P) {
  if (stage2(P) >= STAGE_SINGLES_ISLAND_OPEN && stage2(P) < STAGE_EMILY_RECOLORED_END) loadObjdef(P, EMILY, OBJ_WALK_72_04);
  if (!testFlag(P, FLAG_DOUBLES)) {                       // .checkDoubles
    if (stage2(P) >= STAGE_SINGLES_SENIOR_CHAMP) setPosition(P, FAY, 63.0, 63.0);
    return;
  }
  if (stage2(P) < STAGE_DOUBLES_SENIOR_CHAMP) return;     // .doubles
  setPosition(P, FAY, 63.0, 63.0);
  setPosition(P, ALLIE, 63.0, 63.0);
}
// SeniorCourtPositionActorsByProgressA (12:5E12): singles from rank 3: Brian at (27, 13) facing left. Doubles at
// ranks 2-1: Curt and Beth at (27, 11) / (27, 13) facing left (Beth's script stopped); from the senior champion
// stage Fay and Allie gone
export function seniorCourtPositionActorsByProgressA(P) {
  if (!testFlag(P, FLAG_DOUBLES)) {
    if (stage2(P) >= STAGE_SINGLES_RANK3) {
      setPosition(P, BRIAN, 27.0, 13.0);
      face(P, BRIAN, FACE_LEFT);
    }
    return;
  }
  if (stage2(P) >= STAGE_DOUBLES_RANK2 && stage2(P) < STAGE_OFFERS_END) {   // .isDoubles
    setPosition(P, CURT, 27.0, 11.0);
    setPosition(P, BETH, 27.0, 13.0);
    face(P, CURT, FACE_LEFT);
    face(P, BETH, FACE_LEFT);
    nullScript(P, BETH);
    setAnim(P, BETH, ANIM_WALK);
  }
  if (stage2(P) < STAGE_DOUBLES_SENIOR_CHAMP) return;     // .checkStage10
  setPosition(P, FAY, 63.0, 63.0);
  setPosition(P, ALLIE, 63.0, 63.0);
}

export const HOOKS = [
  scene(BANK, 0x5591, seniorCourtExit01),
  scene(BANK, 0x55E8, seniorCourtNpc03),
  scene(BANK, 0x55F7, seniorCourtNpc03FaceUpFlag0000),
  scene(BANK, 0x5630, seniorCourtNpc03FaceRight),
  scene(BANK, 0x569B, seniorCourtNpc03FaceUpFlag0840),
  scene(BANK, 0x5820, seniorCourtNpc04),
  scene(BANK, 0x5859, seniorCourtNpc05),
  scene(BANK, 0x58B3, seniorCourtNpc06),
  scene(BANK, 0x5916, seniorCourtNpc07),
  scene(BANK, 0x594B, seniorCourtNpc08),
  scene(BANK, 0x5A49, seniorCourtNpc09),
  scene(BANK, 0x5A8C, seniorCourtNpc0A),
  scene(BANK, 0x5B93, seniorCourtNpc0B),
  scene(BANK, 0x5BDD, seniorCourtNpc0C),
  scene(BANK, 0x5CD0, seniorCourtTile01),
  scene(BANK, 0x5D1C, seniorCourtInitScript),
  // (script-macro routines: the registers they leave are read by no caller, and put back as at the call)
  scene(BANK, 0x5DBE, function* (P) { seniorCourtPositionActorsByProgressB(P); }),
  scene(BANK, 0x5E12, function* (P) { seniorCourtPositionActorsByProgressA(P); }),
];
