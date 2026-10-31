// The senior court's ranking matches, before and after (bank $12, $6A41-$7070): the opponents back on their
// scripts, Emily's confirmation (yes: the match; no, then yes: not now, the opponents back to their rallies), the
// court's return entries after a match (the victory scene of the stage, or back to Emily) and the doubles rank-2
// and rank-1 victory scenes. The dispatch tables and actor scripts are data.
// Port of src/story/senior_matches_12.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss2_senior*.mtrec (scripted: each rank's confirmation and its match's return, won and
// lost).
import {
  ACTOR_PARTNER, ACTOR_PLAYER, ACTOR_PLAYER_SHADOW, ANIM_BOUNCE, ANIM_NOD, ANIM_SHAKE, FACE_DOWN, FACE_LEFT,
  FACE_RIGHT, FACE_UP, WRAM_ACTORS, advanceText, askYesNo, endCutscene, face, facePair, fadeIn, followPlayer,
  gesture, goToLocation, jumpVelocity, movePlayer, moveTarget, nullScript, playerSpeed, scene, setActorScript,
  setAnim, setPosition, setText, sound, speak, testFlag, wait, waitActorScript, waitFadeEnd, waitIdle, waitJump,
  waitMove, waitPlayerMove,
} from "./common.js";
import { tableText } from "./shared2.js";
import { startSeniorRankingMatch, startSeniorCourtPairBRally } from "./senior_intros_12.js";
import { computeSeniorCourtStage, fadeInSeniorCourtNearPairB, SENIOR_VICTORY_SCENES } from "./senior_victory_12.js";

const BANK = 0x12;
const STAGE_SINGLES_RANK4 = 0x02;                       // the court's first ranking stage (wMapSceneStage2)
const WINLOSE_WIN = 0x01;
// data of this bank (read from the ROM)
const ResumeSeniorOpponentScriptsPtrs = 0x6A55, SeniorMatchVictorySceneDispatchPtrs = 0x6E0D;
const StubNop_1e = [0x1E, 0x6533];
const ACTOR_SENIOR_COURT_A_ALLIE = 0x05;
const ACTOR_SENIOR_COURT_A_BETH = 0x08;
const ACTOR_SENIOR_COURT_A_BRIAN = 0x07;
const ACTOR_SENIOR_COURT_A_EMILY = 0x03;
const ACTOR_SENIOR_COURT_A_FAY = 0x04;
const ACTOR_SENIOR_COURT_A_JOY = 0x06;
const ACTOR_SENIOR_COURT_B_BALLOON_SWEAT = 0x11;
const ACTOR_SENIOR_COURT_B_CURT = 0x09;
const ACTOR_SENIOR_COURT_B_FAY = 0x04;
const ACTOR_SENIOR_COURT_B_JOY = 0x06;
const ACTOR_SENIOR_COURT_EMILY = 0x03;
const ActorScript_12_02 = 0x6C29;
const ActorScript_12_06 = 0x6C73;
const ActorScript_12_09 = 0x6CAC;
const ActorScript_12_12 = 0x6CE5;
const ActorScript_12_23 = 0x7849;
const ActorScript_12_24 = 0x7854;
const ActorScript_12_27 = 0x7887;
const ActorScript_12_28 = 0x7894;
const ActorScript_12_33 = 0x78FB;
const ActorScript_12_34 = 0x7912;
const ActorScript_12_35 = 0x7929;
const ActorScript_12_36 = 0x7940;
const ActorScript_12_41 = 0x7991;
const ActorScript_12_42 = 0x79A2;
const ActorScript_12_57 = 0x7C59;
const FLAG_WON_SENIOR_DOUBLES_RANK_2 = 0x45;
const FLAG_WON_SENIOR_SINGLES_RANK_4 = 0x54;
const SFX_APPEAR2 = 0x96;
const STORYLOC_SENIOR_CLASS_COURT = 0x10;
const Text_34_116 = 0x1074;
const Text_34_118 = 0x1076;
const Text_34_119 = 0x1077;
const Text_34_121 = 0x1079;
const Text_34_128 = 0x1080;
const Text_34_129 = 0x1081;
const Text_34_68 = 0x1044;
const Text_34_70 = 0x1046;
const Text_34_71 = 0x1047;
const Text_34_72 = 0x1048;

// ResumeSeniorOpponentScripts (12:6A41): the stage's opponents back on their rally scripts (the table by
// wMapSceneStage2 - 2)
export function* resumeSeniorOpponentScripts(P) {
  yield* byStage(P, ResumeSeniorOpponentScriptsPtrs, RESUME_OPPONENTS);
}

// ResumeSeniorDoublesRank3Opponents (12:6A63) .. ResumeSeniorSinglesRank1Opponents (12:6ADC): each stage's
// opponents' scripts (the doubles rank-1 pair: Allie back to her own after it)
export function* resumeSeniorDoublesRank3Opponents(P) {
  setActorScript(P, ACTOR_SENIOR_COURT_B_CURT, ActorScript_12_23);
  setActorScript(P, ACTOR_SENIOR_COURT_A_BETH, ActorScript_12_27);
}

export function* resumeSeniorDoublesRank2Opponents(P) {
  setActorScript(P, ACTOR_SENIOR_COURT_A_BRIAN, ActorScript_12_33);
  setActorScript(P, ACTOR_SENIOR_COURT_B_JOY, ActorScript_12_34);
}

export function* resumeSeniorDoublesRank1Opponents(P) {
  setActorScript(P, ACTOR_SENIOR_COURT_A_ALLIE, ActorScript_12_41);
  setActorScript(P, ACTOR_SENIOR_COURT_B_FAY, ActorScript_12_42);
  yield* waitActorScript(P, ACTOR_SENIOR_COURT_A_ALLIE);
  setActorScript(P, ACTOR_SENIOR_COURT_A_ALLIE, ActorScript_12_57);
}

export function* resumeSeniorSinglesRank4Opponents(P) {
  setActorScript(P, ACTOR_SENIOR_COURT_A_BRIAN, ActorScript_12_02);
}

export function* resumeSeniorSinglesRank3Opponents(P) {
  setActorScript(P, ACTOR_SENIOR_COURT_A_JOY, ActorScript_12_06);
}

export function* resumeSeniorSinglesRank2Opponents(P) {
  setActorScript(P, ACTOR_SENIOR_COURT_A_ALLIE, ActorScript_12_09);
}

export function* resumeSeniorSinglesRank1Opponents(P) {
  setActorScript(P, ACTOR_SENIOR_COURT_A_FAY, ActorScript_12_12);
}

// SeniorSinglesMatchConfirm (12:6AE8): Emily's question (another line from rank 4 on): yes, two nods and the
// match; no: another question: yes, not now (the opponent back to the rally); no, a nod and the match
export function* seniorSinglesMatchConfirm(P) {
  yield* setText(P, Text_34_68);
  if (testFlag(P, FLAG_WON_SENIOR_SINGLES_RANK_4)) {
    advanceText(P);
  }
  const yes = (yield* askYesNo(P, ACTOR_SENIOR_COURT_A_EMILY)) === 0;
  if (yes) yield* gesture(P, ACTOR_SENIOR_COURT_EMILY, ANIM_NOD);
  else {                                                  // .done: the second question
    yield* setText(P, Text_34_71);
    if ((yield* askYesNo(P, ACTOR_SENIOR_COURT_A_EMILY)) === 0) {   // .accepted: not now, the opponent back
      yield* setText(P, Text_34_72);
      if (testFlag(P, FLAG_WON_SENIOR_SINGLES_RANK_4)) advanceText(P);
      yield* speak(P, ACTOR_SENIOR_COURT_EMILY);
      yield* resumeSeniorOpponentScripts(P);
      yield* wait(P, 30);
      endCutscene(P);
      return;
    }
  }
  yield* gesture(P, ACTOR_SENIOR_COURT_EMILY, ANIM_NOD);  // .declined: the match
  yield* setText(P, Text_34_70);
  yield* speak(P, ACTOR_SENIOR_COURT_EMILY);
  yield* startSeniorRankingMatch(P);
  endCutscene(P);
}

// SeniorDoublesMatchConfirm (12:6B76): the same for doubles (not now: the partner follows again)
export function* seniorDoublesMatchConfirm(P) {
  yield* setText(P, Text_34_116);
  if (testFlag(P, FLAG_WON_SENIOR_DOUBLES_RANK_2)) {
    advanceText(P);
  }
  if ((yield* askYesNo(P, ACTOR_SENIOR_COURT_A_EMILY)) === 0) {
    yield* gesture(P, ACTOR_SENIOR_COURT_EMILY, ANIM_NOD);
    yield* gesture(P, ACTOR_SENIOR_COURT_EMILY, ANIM_NOD);
    yield* setText(P, Text_34_118);
    yield* speak(P, ACTOR_SENIOR_COURT_EMILY);
  } else {                                                // .done: the second question
    yield* setText(P, Text_34_119);
    if ((yield* askYesNo(P, ACTOR_SENIOR_COURT_A_EMILY)) === 0) {   // .accepted: not now, the opponents back
      yield* speak(P, ACTOR_SENIOR_COURT_EMILY);
      yield* resumeSeniorOpponentScripts(P);
      yield* wait(P, 30);
      followPlayer(P, ACTOR_PARTNER);
      endCutscene(P);
      return;
    }
    yield* setText(P, Text_34_121);
    yield* speak(P, ACTOR_SENIOR_COURT_EMILY);
  }
  yield* startSeniorRankingMatch(P);                      // .declined: the match
  endCutscene(P);
}

// SeniorCourtReloadIntoVictoryScene (12:6D8A): the court again at entry $0D (the victory scene)
export function* seniorCourtReloadIntoVictoryScene(P) {
  goToLocation(P, STORYLOC_SENIOR_CLASS_COURT, 0x0D);
  P.callRom(...StubNop_1e);
}

// SeniorCourtPostMatchReturn (12:6DA0): after a ranking match (WRAM 4 mapped): won (not quit): the stage's
// victory scene; else the pair placed back in front of Emily
export function* seniorCourtPostMatchReturn(P) {
  P.wramBank(WRAM_ACTORS);
  if (P.V.matchExitRequest !== 0x01 && P.V.matchWinLoseFlag === WINLOSE_WIN) return yield* seniorMatchVictorySceneDispatch(P);
  playerSpeed(P, 2.0);
  yield* movePlayer(P, 45.0, 27.0);
  setPosition(P, ACTOR_PLAYER, 45.0, 27.0);
  face(P, ACTOR_PLAYER, FACE_UP);
  setPosition(P, ACTOR_PARTNER, 45.0, 29.0);
  face(P, ACTOR_PARTNER, FACE_UP);
  yield* waitPlayerMove(P);
}

// SeniorMatchVictorySceneDispatch (12:6DED): no location name, the shadow stopped; the stage's victory scene,
// then the court's stage again
export function* seniorMatchVictorySceneDispatch(P) {
  P.V.storyModeShowLocationName = 0;
  nullScript(P, ACTOR_PLAYER_SHADOW);
  yield* byStage(P, SeniorMatchVictorySceneDispatchPtrs, victoryScenes());
  computeSeniorCourtStage(P);
}

// SeniorDoublesRank2Victory (12:6E1F): the rank-3 doubles pair (Curt and Beth) beaten: their reactions, Emily's
// jump and line, the pair back to her
export function* seniorDoublesRank2Victory(P) {
  nullScript(P, ACTOR_PARTNER);
  nullScript(P, ACTOR_SENIOR_COURT_A_BETH);
  face(P, ACTOR_SENIOR_COURT_A_EMILY, FACE_LEFT);
  setPosition(P, ACTOR_SENIOR_COURT_A_BETH, 37.0, 19.0);
  face(P, ACTOR_SENIOR_COURT_A_BETH, FACE_DOWN);
  setPosition(P, ACTOR_SENIOR_COURT_B_CURT, 35.0, 15.0);
  face(P, ACTOR_SENIOR_COURT_B_CURT, FACE_DOWN);
  yield* setText(P, Text_34_128);
  setPosition(P, ACTOR_PLAYER, 37.0, 27.0);
  setPosition(P, ACTOR_PARTNER, 35.0, 27.0);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, ACTOR_PARTNER, FACE_UP);
  playerSpeed(P, 2.0);
  yield* movePlayer(P, 38.0, 23.0);
  yield* waitPlayerMove(P);
  fadeIn(P, 8);
  yield* waitFadeEnd(P);
  yield* wait(P, 60);
  moveTarget(P, ACTOR_SENIOR_COURT_B_CURT, 35.0, 19.0);
  yield* waitMove(P, ACTOR_SENIOR_COURT_B_CURT);
  facePair(P, ACTOR_SENIOR_COURT_B_CURT, ACTOR_SENIOR_COURT_A_BETH);
  yield* wait(P, 20);
  setPosition(P, ACTOR_SENIOR_COURT_B_BALLOON_SWEAT, 36.0, 17.5);
  sound(P, SFX_APPEAR2);
  yield* wait(P, 30);
  setAnim(P, ACTOR_SENIOR_COURT_A_BETH, ANIM_SHAKE);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_BETH);
  setPosition(P, ACTOR_SENIOR_COURT_B_BALLOON_SWEAT, 63.0, 63.0);
  jumpVelocity(P, ACTOR_SENIOR_COURT_A_EMILY, -2.0);
  yield* waitJump(P, 0x03);
  yield* speak(P, ACTOR_SENIOR_COURT_A_EMILY);
  setActorScript(P, ACTOR_SENIOR_COURT_A_BETH, ActorScript_12_28);
  setActorScript(P, ACTOR_SENIOR_COURT_B_CURT, ActorScript_12_24);
  yield* wait(P, 60);
  moveTarget(P, ACTOR_SENIOR_COURT_A_EMILY, 45.0, 25.0);
  yield* movePlayer(P, 45.0, 27.0);
  moveTarget(P, ACTOR_PLAYER, 45.0, 27.0);
  moveTarget(P, ACTOR_PARTNER, 45.0, 29.0);
  yield* wait(P, 60);
  face(P, ACTOR_SENIOR_COURT_A_EMILY, FACE_DOWN);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  followPlayer(P, ACTOR_PARTNER);
  endCutscene(P);
}

// SeniorDoublesRank1Victory (12:6F6A): the rank-2 pair (Brian and Joy) beaten: the same, the rally pair B back
export function* seniorDoublesRank1Victory(P) {
  nullScript(P, ACTOR_PARTNER);
  face(P, ACTOR_SENIOR_COURT_A_EMILY, FACE_RIGHT);
  setPosition(P, ACTOR_SENIOR_COURT_A_BRIAN, 51.0, 17.0);
  face(P, ACTOR_SENIOR_COURT_A_BRIAN, FACE_DOWN);
  setPosition(P, ACTOR_SENIOR_COURT_B_JOY, 53.0, 19.0);
  face(P, ACTOR_SENIOR_COURT_B_JOY, FACE_DOWN);
  setPosition(P, ACTOR_PLAYER, 51.0, 27.0);
  setPosition(P, ACTOR_PARTNER, 53.0, 27.0);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, ACTOR_PARTNER, FACE_UP);
  yield* fadeInSeniorCourtNearPairB(P);
  yield* setText(P, Text_34_129);
  yield* wait(P, 40);
  setAnim(P, ACTOR_SENIOR_COURT_A_BRIAN, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_SENIOR_COURT_A_BRIAN);
  yield* wait(P, 20);
  jumpVelocity(P, ACTOR_SENIOR_COURT_A_EMILY, -2.0);
  yield* waitJump(P, 0x03);
  jumpVelocity(P, ACTOR_SENIOR_COURT_A_EMILY, -2.0);
  yield* waitJump(P, 0x03);
  yield* speak(P, ACTOR_SENIOR_COURT_A_EMILY);
  yield* wait(P, 60);
  moveTarget(P, ACTOR_SENIOR_COURT_A_EMILY, 45.0, 25.0);
  yield* movePlayer(P, 45.0, 27.0);
  moveTarget(P, ACTOR_PLAYER, 45.0, 27.0);
  moveTarget(P, ACTOR_PARTNER, 45.0, 29.0);
  setActorScript(P, ACTOR_SENIOR_COURT_A_BRIAN, ActorScript_12_36);
  setActorScript(P, ACTOR_SENIOR_COURT_B_JOY, ActorScript_12_35);
  yield* startSeniorCourtPairBRally(P);
  face(P, ACTOR_SENIOR_COURT_A_EMILY, FACE_DOWN);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  face(P, ACTOR_PARTNER, FACE_DOWN);
  followPlayer(P, ACTOR_PARTNER);
  endCutscene(P);
}

// the stage's routine of a table (by wMapSceneStage2 - 2), from the routines here (or run as the ROM's)
function* byStage(P, table, routines) {
  const target = tableText(P, BANK, table, (P.V.mapSceneStage2 - STAGE_SINGLES_RANK4) & 0xFF);
  if (routines[target]) return yield* routines[target](P);
  yield* P.runRom(BANK, target);
}
const RESUME_OPPONENTS = {
  0x6A63: resumeSeniorDoublesRank3Opponents, 0x6A7A: resumeSeniorDoublesRank2Opponents,
  0x6A91: resumeSeniorDoublesRank1Opponents, 0x6AB8: resumeSeniorSinglesRank4Opponents,
  0x6AC4: resumeSeniorSinglesRank3Opponents, 0x6AD0: resumeSeniorSinglesRank2Opponents,
  0x6ADC: resumeSeniorSinglesRank1Opponents,
};
const victoryScenes = () => ({                          // (built at the call: senior_victory_12 imports this module)
  0x6E1F: seniorDoublesRank2Victory, 0x6F6A: seniorDoublesRank1Victory, ...SENIOR_VICTORY_SCENES,
});

export const HOOKS = [
  scene(BANK, 0x6A41, resumeSeniorOpponentScripts),
  scene(BANK, 0x6A63, resumeSeniorDoublesRank3Opponents),
  scene(BANK, 0x6A7A, resumeSeniorDoublesRank2Opponents),
  scene(BANK, 0x6A91, resumeSeniorDoublesRank1Opponents),
  scene(BANK, 0x6AB8, resumeSeniorSinglesRank4Opponents),
  scene(BANK, 0x6AC4, resumeSeniorSinglesRank3Opponents),
  scene(BANK, 0x6AD0, resumeSeniorSinglesRank2Opponents),
  scene(BANK, 0x6ADC, resumeSeniorSinglesRank1Opponents),
  scene(BANK, 0x6AE8, seniorSinglesMatchConfirm),
  scene(BANK, 0x6B76, seniorDoublesMatchConfirm),
  scene(BANK, 0x6D8A, seniorCourtReloadIntoVictoryScene),
  scene(BANK, 0x6DA0, seniorCourtPostMatchReturn),
  scene(BANK, 0x6DED, seniorMatchVictorySceneDispatch),
  scene(BANK, 0x6E1F, seniorDoublesRank2Victory),
  scene(BANK, 0x6F6A, seniorDoublesRank1Victory),
];
