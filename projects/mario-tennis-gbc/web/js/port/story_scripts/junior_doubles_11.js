// The end of the academy tour, the campus exit, and the junior class's doubles court (bank $11, $53DB-$5B13): the
// tour's last scene (entry $0C: on to the Island Sky), the campus exit and gate guard by the story's progress; the
// doubles court's NPCs (their lines by the junior doubles ranks won; Allie and Joy's practice match), its init
// script (the NPC lists by the doubles progress, the entries).
// The tables (the actor lists, JuniorClassCourtDoublesMapScripts_11, the NPC record lists A-D, ActorScript_11_03..21)
// are data.
// Port of src/story/junior_doubles_11.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/engine/rec2.mtrec, out/port/cs_story_new2.mtrec (the campus exit and the guard) and
// out/port/ss1_jrdoubles*.mtrec (scripted: the court by the doubles ranks).
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FACE_DOWN, FACE_UP, FACE_RIGHT, ANIM_NOD, ANIM_BOUNCE, ANIM_SHAKE, BEHAVIOR_EXIT, FLAG_DOUBLES,
  STORYENTRY_NONE, MATCHLIST_DOUBLES, testFlag, setFlag, setText, advanceText, speak, askYesNo, setAnim, waitIdle,
  wait, face, faceToward, facePair, setPosition, moveTarget, waitMove, movePlayer, waitPlayerMove, setSpeed,
  playerSpeed, lockFacing, unlockFacing, nullScript, setActorScript, waitActorScript, writeBehaviorCell, respawnActors, beginCutscene, fadeIn,
  waitFadeEnd, fadeOutAndWait, goToLocation, returnHereAfter, playStoryMatch, setNpcScripts, hook, scene,
} from "./common.js";
import {
  juniorClassCourtDoublesMatchReturn, juniorClassCourtDoublesEntry0eScene, juniorClassCourtDoublesEntry0dScene,
  offerDoublesRankingMatch,
} from "./doubles_11.js";

const BANK = 0x11;
// the tour's last actors (ActorList_11_1)
const ACTOR_LIST_11_1_WALK_71_03 = 0x03;
// the arrival square's gate guard (AcademyArrivalActors_11)
const ACTOR_ACADEMY_ARRIVAL_WALK_71_03_2 = 0x14;
// the doubles court's actors (JuniorClassCourtDoublesActors_11)
const ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BOB = 0x04, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BETH = 0x05;
const ACTOR_JUNIOR_CLASS_COURT_DOUBLES_CURT = 0x06, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_PAM = 0x07;
const ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BRIAN = 0x08, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_FAY = 0x09;
const ACTOR_JUNIOR_CLASS_COURT_DOUBLES_ALLIE = 0x0A, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_JOY = 0x0B;
const STORYLOC_ISLAND_SKY = 0x1B;
const STORYRANK_SINGLES_ISLAND_OPEN = 0x06;
const STORYMATCH_JUNIOR_PRACTICE = 0x00;
const FLAG_WON_JUNIOR_DOUBLES_RANK_3 = 0x40, FLAG_WON_JUNIOR_DOUBLES_RANK_2 = 0x41, FLAG_WON_JUNIOR_DOUBLES_RANK_1 = 0x42;
const FLAG_WON_SENIOR_DOUBLES_RANK_1 = 0x46, FLAG_JUNIOR_COURT_NPC0A_TALKED = 0x82;
const FLAG_REACHED_ISLAND_OPEN_DOUBLES = 0xAF, FLAG_STORY_COMPLETE_SINGLES = 0xB0, FLAG_STORY_COMPLETE_DOUBLES = 0xB1;
const Text_32_82 = 0x0852, Text_32_105 = 0x0869, Text_32_108 = 0x086C, Text_32_120 = 0x0878, Text_32_123 = 0x087B;
const Text_32_126 = 0x087E, Text_32_128 = 0x0880, Text_32_130 = 0x0882, Text_32_131 = 0x0883, Text_32_135 = 0x0887;
const Text_32_136 = 0x0888, Text_32_151 = 0x0897, Text_32_186 = 0x08BA, Text_32_191 = 0x08BF;
const Text_33_15 = 0x0C0F, Text_33_24 = 0x0C18, Text_33_30 = 0x0C1E;
// data of this bank (read from the ROM)
const ActorList_11_1 = 0x546A, ActorScript_11_11 = 0x5BC6, ActorScript_11_12 = 0x5BE0;
const JuniorClassCourtDoublesNpcScriptsA_11 = 0x586B, JuniorClassCourtDoublesNpcScriptsB_11 = 0x58B4;
const JuniorClassCourtDoublesNpcScriptsC_11 = 0x58FD, JuniorClassCourtDoublesNpcScriptsD_11 = 0x599F;
const ActorScript_11_45 = 0x7BA9, ActorScript_11_46 = 0x7BB3;
const YES = 0;

// AcademyArrivalEntry0cScene (11:53DB): the tour's end: the player (and partner) walk out of the gate while the
// guide nods; on to the Island Sky (entry $0F).
export function* academyArrivalEntry0cScene(P) {
  respawnActors(P, ActorList_11_1);
  beginCutscene(P);
  playerSpeed(P, 7.96875);
  yield* movePlayer(P, 24.0, 47.0);
  yield* waitPlayerMove(P);
  if (testFlag(P, FLAG_DOUBLES)) {
    setPosition(P, ACTOR_PARTNER, 24.0, 29.0);
    moveTarget(P, ACTOR_PARTNER, 24.0, 57.0);
  }
  setPosition(P, ACTOR_PLAYER, 24.0, 31.0);                          // .placeActors
  moveTarget(P, ACTOR_PLAYER, 24.0, 59.0);
  P.V.storyModeShowLocationName = 0;
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  yield* wait(P, 60);
  setAnim(P, ACTOR_LIST_11_1_WALK_71_03, ANIM_NOD);
  yield* waitIdle(P, ACTOR_LIST_11_1_WALK_71_03);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* fadeOutAndWait(P, 4);
  goToLocation(P, STORYLOC_ISLAND_SKY, 0x0F);
}

// EnableAcademyCampusExit (11:5482): once the story of the format played is complete, the two gate cells become
// exit 3
export function enableAcademyCampusExit(P) {
  const complete = testFlag(P, testFlag(P, FLAG_DOUBLES) ? FLAG_STORY_COMPLETE_DOUBLES : FLAG_STORY_COMPLETE_SINGLES);
  if (!complete) return;
  writeBehaviorCell(P, 22, 52, BEHAVIOR_EXIT | 3 << 4);              // .writeBehaviorMapCell
  writeBehaviorCell(P, 24, 52, BEHAVIOR_EXIT | 3 << 4);
}
// MoveCampusGateGuardAside (11:54A6): from the Island Open on (story rank 6), the gate guard stands aside
export function moveCampusGateGuardAside(P) {
  if (P.V.mapSceneStage < STORYRANK_SINGLES_ISLAND_OPEN) return;
  setPosition(P, ACTOR_ACADEMY_ARRIVAL_WALK_71_03_2, 21.0, 48.0);
  face(P, ACTOR_ACADEMY_ARRIVAL_WALK_71_03_2, FACE_RIGHT);
}

// ---- the junior class's doubles court ----
// a line of three messages: the first, or the next while the first rank is not won, the third while neither is
function* lineByRanks(P, text, firstRank, secondRank, actor) {
  yield* setText(P, text);
  if (!testFlag(P, firstRank)) {
    advanceText(P);
    if (!testFlag(P, secondRank)) advanceText(P);
  }
  yield* speak(P, actor);
}
// JuniorClassCourtDoublesNpc04_11 (11:55B0) / Npc05 (11:55CC) / Npc07 (11:561C): Bob, Beth and Pam
export const juniorClassCourtDoublesNpc04 = P => lineByRanks(P, Text_32_105, FLAG_WON_JUNIOR_DOUBLES_RANK_1,
  FLAG_WON_JUNIOR_DOUBLES_RANK_2, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BOB);
export const juniorClassCourtDoublesNpc05 = P => lineByRanks(P, Text_32_120, FLAG_WON_JUNIOR_DOUBLES_RANK_2,
  FLAG_WON_JUNIOR_DOUBLES_RANK_3, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BETH);
export const juniorClassCourtDoublesNpc07 = P => lineByRanks(P, Text_32_123, FLAG_WON_JUNIOR_DOUBLES_RANK_2,
  FLAG_WON_JUNIOR_DOUBLES_RANK_3, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_PAM);
// JuniorClassCourtDoublesNpc06_11 (11:55E8): Curt: the same, but with neither rank won his line is a question
// (no: the other answer)
export function* juniorClassCourtDoublesNpc06(P) {
  const CURT = ACTOR_JUNIOR_CLASS_COURT_DOUBLES_CURT;
  yield* setText(P, Text_32_108);
  if (!testFlag(P, FLAG_WON_JUNIOR_DOUBLES_RANK_1)) {
    advanceText(P);
    if (!testFlag(P, FLAG_WON_JUNIOR_DOUBLES_RANK_2)) {
      advanceText(P);
      if ((yield* askYesNo(P, CURT)) !== YES) advanceText(P);
    }
  }
  yield* speak(P, CURT);                                              // .speak
}
// JuniorClassCourtDoublesNpc08_11 (11:5638): Brian: his line, the next before rank 3 is won
export function* juniorClassCourtDoublesNpc08(P) {
  yield* setText(P, Text_32_126);
  if (!testFlag(P, FLAG_WON_JUNIOR_DOUBLES_RANK_3)) advanceText(P);
  yield* speak(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BRIAN);            // .loop
}
// JuniorClassCourtDoublesNpc09_11 (11:564C): Fay: once rank 3 is won Brian answers instead (Npc08's .loop)
export function* juniorClassCourtDoublesNpc09(P) {
  yield* setText(P, Text_32_128);
  if (testFlag(P, FLAG_WON_JUNIOR_DOUBLES_RANK_3)) { yield* speak(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BRIAN); return; }
  advanceText(P);
  yield* speak(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_FAY);
}
// JuniorClassCourtDoublesNpc09_11.loop: Allie speaks and Joy turns to her
function* allieSpeaks(P) {
  yield* speak(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_ALLIE);
  facePair(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_JOY, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_ALLIE);
}
// JuniorClassCourtDoublesNpc0A_11 (11:566E): Allie: once rank 3 is won a line; otherwise two questions (a no to
// either: her answer) and the practice match against Allie and Joy (STORYMATCH_JUNIOR_PRACTICE); the player is
// back at the same place after it.
export function* juniorClassCourtDoublesNpc0A(P) {
  const ALLIE = ACTOR_JUNIOR_CLASS_COURT_DOUBLES_ALLIE, JOY = ACTOR_JUNIOR_CLASS_COURT_DOUBLES_JOY;
  yield* setText(P, Text_32_135);
  if (testFlag(P, FLAG_WON_JUNIOR_DOUBLES_RANK_3)) return yield* allieSpeaks(P);
  yield* setText(P, Text_32_131);
  if ((yield* askYesNo(P, ALLIE)) !== YES) return yield* allieSpeaks(P);
  advanceText(P);
  faceToward(P, ACTOR_PLAYER, JOY);
  if ((yield* askYesNo(P, ALLIE)) !== YES) return yield* allieSpeaks(P);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  nullScript(P, ACTOR_PARTNER);
  setSpeed(P, ACTOR_PARTNER, 1.0);
  setSpeed(P, ACTOR_PLAYER, 1.0);
  setActorScript(P, ACTOR_PLAYER, ActorScript_11_11);                 // to the court
  yield* wait(P, 20);
  setActorScript(P, ACTOR_PARTNER, ActorScript_11_12);
  yield* wait(P, 30);
  yield* movePlayer(P, 53.0, 17.0);
  moveTarget(P, ALLIE, 55.0, 13.0);
  moveTarget(P, JOY, 53.0, 9.0);
  yield* waitMove(P, ALLIE);
  face(P, ALLIE, FACE_DOWN);
  face(P, JOY, FACE_DOWN);
  yield* waitActorScript(P, ACTOR_PLAYER);
  returnHereAfter(P);                                                 // (back here after the match)
  yield* waitPlayerMove(P);
  setAnim(P, ALLIE, ANIM_NOD);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* playStoryMatch(P, MATCHLIST_DOUBLES, STORYMATCH_JUNIOR_PRACTICE);
}
// JuniorClassCourtDoublesNpc0B_11 (11:5771): Joy: once rank 3 is won a line; otherwise she and Allie ask for the
// practice match (JuniorClassCourtDoublesNpc0A_11)
export function* juniorClassCourtDoublesNpc0B(P) {
  yield* setText(P, Text_32_136);
  if (testFlag(P, FLAG_WON_JUNIOR_DOUBLES_RANK_3)) { yield* speak(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_JOY); return; }
  yield* setText(P, Text_32_130);
  yield* speak(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_JOY);
  faceToward(P, ACTOR_PLAYER, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_ALLIE);
  setAnim(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_ALLIE, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_ALLIE);
  yield* juniorClassCourtDoublesNpc0A(P);
}
// Unused_11_JuniorClassCourtDoublesNpcSpeech (11:579E): a line of slot $0A shaking its head (slot $0B turns to it).
// Nothing calls it (its .speak tail is Npc0B's).
export function* unusedJuniorClassCourtDoublesNpcSpeech(P) {
  yield* setText(P, Text_32_82);
  faceToward(P, ACTOR_PLAYER, 0x0A);
  setAnim(P, 0x0A, ANIM_SHAKE);
  yield* waitIdle(P, 0x0A);
  yield* speak(P, 0x0A);
  faceToward(P, 0x0B, 0x0A);
}
// JuniorClassCourtDoublesANpc0A_11 (11:57CC): Allie (list A): two lines, shaking her head between
export function* juniorClassCourtDoublesANpc0A(P) {
  yield* setText(P, Text_32_151);
  yield* speak(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_ALLIE);
  setAnim(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_ALLIE, ANIM_SHAKE);
  yield* waitIdle(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_ALLIE);
  yield* speak(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_ALLIE);
}
// JuniorClassCourtDoublesNpc03FaceUp_11 (11:57E9): the coach's step-on: the player backs up to him (facing kept),
// then the doubles ranking match offer (JuniorClassCourtDoublesNpc03_11, next)
export function* juniorClassCourtDoublesNpc03FaceUp(P) {
  setSpeed(P, ACTOR_PLAYER, 0.25);
  lockFacing(P, ACTOR_PLAYER);
  moveTarget(P, ACTOR_PLAYER, 19.0, 21.0);
  yield* waitMove(P, ACTOR_PLAYER);
  unlockFacing(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* juniorClassCourtDoublesNpc03(P);
}
// JuniorClassCourtDoublesNpc03_11 (11:5816): the coach: the doubles ranking match offer (doubles_11.asm)
export function* juniorClassCourtDoublesNpc03(P) { yield* offerDoublesRankingMatch(P); }
// a question of Pam's or Allie's (no: the other answer)
function* question(P, text, actor) {
  yield* setText(P, text);
  if ((yield* askYesNo(P, actor)) !== YES) advanceText(P);
  yield* speak(P, actor);                                             // .speak
}
// JuniorClassCourtDoublesCNpc07_11 (11:5946) / DNpc07 (11:596B): Pam (lists C and D)
export const juniorClassCourtDoublesCNpc07 = P => question(P, Text_32_186, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_PAM);
export const juniorClassCourtDoublesDNpc07 = P => question(P, Text_33_24, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_PAM);
// JuniorClassCourtDoublesCNpc0A_11 (11:5990): Allie (list C): her line; FLAG_JUNIOR_COURT_NPC0A_TALKED set
export function* juniorClassCourtDoublesCNpc0A(P) {
  yield* setText(P, Text_32_191);
  yield* speak(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_ALLIE);
  setFlag(P, FLAG_JUNIOR_COURT_NPC0A_TALKED);
}
// JuniorClassCourtDoublesDNpc0A_11 (11:59E8): Allie (list D): a line, or a question once talked to in list C
export function* juniorClassCourtDoublesDNpc0A(P) {
  if (!testFlag(P, FLAG_JUNIOR_COURT_NPC0A_TALKED)) {
    yield* setText(P, Text_33_15);
    yield* speak(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_ALLIE);
    return;
  }
  yield* question(P, Text_33_30, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_ALLIE);   // .setText
}

// JuniorClassCourtDoublesInitScript_11 (11:5A22): with rank 3 won but not rank 1, Brian and Fay stand at the side
// (ActorScript_11_45); by the entry the match's return ($0F) or the ranking scenes ($0E, $0D); otherwise the NPC
// records of the doubles progress (A junior rank 1, B senior rank 1, C Island Open, D complete), Curt walking
// about (ActorScript_11_46) and in list A Allie facing down.
export function* juniorClassCourtDoublesInitScript(P) {
  const BRIAN = ACTOR_JUNIOR_CLASS_COURT_DOUBLES_BRIAN, FAY = ACTOR_JUNIOR_CLASS_COURT_DOUBLES_FAY;
  if (!testFlag(P, FLAG_WON_JUNIOR_DOUBLES_RANK_1) && testFlag(P, FLAG_WON_JUNIOR_DOUBLES_RANK_3)) {
    setPosition(P, BRIAN, 37.0, 9.0);
    face(P, BRIAN, FACE_RIGHT);
    setActorScript(P, BRIAN, ActorScript_11_45);
    setPosition(P, FAY, 37.0, 11.0);
    face(P, FAY, FACE_RIGHT);
    setActorScript(P, FAY, ActorScript_11_45);
  }
  switch (P.V.storyModeEntryPoint) {                                  // .stage2
    case 0x0F: return yield* juniorClassCourtDoublesMatchReturn(P);
    case 0x0E: return yield* juniorClassCourtDoublesEntry0eScene(P);
    case 0x0D: return yield* juniorClassCourtDoublesEntry0dScene(P);
  }
  let list;
  if (testFlag(P, FLAG_STORY_COMPLETE_DOUBLES)) list = JuniorClassCourtDoublesNpcScriptsD_11;
  else if (testFlag(P, FLAG_REACHED_ISLAND_OPEN_DOUBLES)) list = JuniorClassCourtDoublesNpcScriptsC_11;
  else if (testFlag(P, FLAG_WON_SENIOR_DOUBLES_RANK_1)) list = JuniorClassCourtDoublesNpcScriptsB_11;
  else if (testFlag(P, FLAG_WON_JUNIOR_DOUBLES_RANK_1)) list = JuniorClassCourtDoublesNpcScriptsA_11;
  else return;
  setNpcScripts(P, list);
  setPosition(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_CURT, 32.0, 25.0);
  setActorScript(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_CURT, ActorScript_11_46);
  if (list === JuniorClassCourtDoublesNpcScriptsA_11) face(P, ACTOR_JUNIOR_CLASS_COURT_DOUBLES_ALLIE, FACE_DOWN);
}

export const HOOKS = [
  scene(BANK, 0x53DB, academyArrivalEntry0cScene),
  [BANK, 0x5482, hook(P => { enableAcademyCampusExit(P); })],
  [BANK, 0x54A6, hook(P => { moveCampusGateGuardAside(P); })],
  scene(BANK, 0x55B0, juniorClassCourtDoublesNpc04),
  scene(BANK, 0x55CC, juniorClassCourtDoublesNpc05),
  scene(BANK, 0x55E8, juniorClassCourtDoublesNpc06),
  scene(BANK, 0x561C, juniorClassCourtDoublesNpc07),
  scene(BANK, 0x5638, juniorClassCourtDoublesNpc08),
  scene(BANK, 0x564C, juniorClassCourtDoublesNpc09),
  scene(BANK, 0x566E, juniorClassCourtDoublesNpc0A),
  scene(BANK, 0x5771, juniorClassCourtDoublesNpc0B),
  scene(BANK, 0x579E, unusedJuniorClassCourtDoublesNpcSpeech),
  scene(BANK, 0x57CC, juniorClassCourtDoublesANpc0A),
  scene(BANK, 0x57E9, juniorClassCourtDoublesNpc03FaceUp),
  scene(BANK, 0x5816, juniorClassCourtDoublesNpc03),
  scene(BANK, 0x5946, juniorClassCourtDoublesCNpc07),
  scene(BANK, 0x596B, juniorClassCourtDoublesDNpc07),
  scene(BANK, 0x5990, juniorClassCourtDoublesCNpc0A),
  scene(BANK, 0x59E8, juniorClassCourtDoublesDNpc0A),
  [BANK, 0x5A1F, hook(() => {})],                                     // Unused_11_NullScriptA
  [BANK, 0x5A21, hook(() => {})],                                     // Unused_11_NullScriptB
  scene(BANK, 0x5A22, juniorClassCourtDoublesInitScript),
];
