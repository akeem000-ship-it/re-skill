// Center Court and the academy's arrival square (bank $11, $4082-$46CE): Center Court's NPCs (by the Island Open's
// stage), its init script (the stage, the court sprites, the arrival walk), the walk-off to the final (entry $0F);
// the arrival square's NPCs (by the story rank), its step-on trigger and init script.
// The locations' tables (the bank's DataPtr_* slots, CenterCourtMapScripts_11, AcademyArrivalMapScripts_11, the
// actor lists, the NPCs' text-id tables, ActorScript_11_00/01) are data.
// Port of src/story/center_11.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are; the arrival walks are src/twins/academy_main_bldg_
// arrival01/02.asm (twins.js).
// Recordings: out/engine/rec2.mtrec, out/port/cs_story_new2.mtrec (the arrival square's init) and
// out/port/ss1_center*.mtrec, ss1_arrival*.mtrec (scripted).
import {
  ACTOR_PLAYER, ACTOR_PARTNER, ANIM_SHAKE, ANIM_NOD, FLAG_DOUBLES, testFlag, setText, advanceText, speak, askYesNo,
  setAnim, waitIdle, wait, setPosition, movePlayer, setActorScript, waitActorScript, respawnActors, beginCutscene,
  fadeIn, requestExit, hook, scene,
} from "./common.js";
import { arrivalWalkUp, arrivalWalkDown, loadCourtPlayerPartnerObjDefs, computeRankingProgressIndex } from "./twins.js";
import { enableAcademyCampusExit, moveCampusGateGuardAside, academyArrivalEntry0cScene } from "./junior_doubles_11.js";

const BANK = 0x11;
// Center Court's actors (CenterCourtActors_11)
const ACTOR_CENTER_COURT_WALK_6F_07_1 = 0x03, ACTOR_CENTER_COURT_WALK_6F_07_2 = 0x04, ACTOR_CENTER_COURT_WALK_72_02 = 0x05;
const ACTOR_CENTER_COURT_SLOT_0A = 0x0A;
// the arrival square's actors (AcademyArrivalActors_11)
const ACTOR_ACADEMY_ARRIVAL_WALK_71_03_1 = 0x03, ACTOR_ACADEMY_ARRIVAL_WALK_71_05 = 0x04;
const ACTOR_ACADEMY_ARRIVAL_WALK_72_02 = 0x05, ACTOR_ACADEMY_ARRIVAL_WALK_71_03_2 = 0x14;
const ISLANDOPENSTAGE_SINGLES_ROUND1 = 0x00, ISLANDOPENSTAGE_SINGLES_ROUND2 = 0x01;
const ISLANDOPENSTAGE_SINGLES_SEMIFINAL = 0x02, ISLANDOPENSTAGE_SINGLES_FINAL = 0x03;
const ISLANDOPENSTAGE_DOUBLES_ROUND1 = 0x04, ISLANDOPENSTAGE_DOUBLES_SEMIFINAL = 0x05, ISLANDOPENSTAGE_DOUBLES_FINAL = 0x06;
const STORYRANK_SINGLES_JUNIOR_CHAMP = 0x02, STORYRANK_SINGLES_SENIOR_CHAMP = 0x04, STORYRANK_SINGLES_COMPLETE = 0x08;
const FLAG_WON_ISLAND_OPEN_DOUBLES_SEMIFINAL = 0x36, FLAG_WON_ISLAND_OPEN_DOUBLES_ROUND_1 = 0x37;
const FLAG_WON_ISLAND_OPEN_SINGLES_SEMIFINAL = 0x3D, FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_2 = 0x3E;
const FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_1 = 0x3F;
const FLAG_REACHED_ISLAND_OPEN_SINGLES = 0xAE, FLAG_REACHED_ISLAND_OPEN_DOUBLES = 0xAF;
const FLAG_STORY_COMPLETE_SINGLES = 0xB0, FLAG_STORY_COMPLETE_DOUBLES = 0xB1;
const Text_1f_80 = 0x2450, Text_1f_81 = 0x2451, Text_1f_91 = 0x245B, Text_1f_96 = 0x2460, Text_1f_101 = 0x2465;
const Text_36_96 = 0x1860;
// data of this bank (read from the ROM)
const CenterCourtNpc05TextIds = 0x413C, CenterCourtNpc06TextIds = 0x4161, CenterCourtSceneVariantActors_11 = 0x4213;
const ActorScript_11_00 = 0x43ED, ActorScript_11_01 = 0x43F4;
const AcademyArrivalNpc03TextIds = 0x45E1, AcademyArrivalNpc04TextIds = 0x460C, AcademyArrivalNpc05TextIds = 0x4639;
// routines of this bank not ported here (src/story/student_11.asm)
const LateStudentCrashCutscene = 0x46CF, ResumeAcademyGuideTour = 0x4F40;
const AcademyArrivalInitScript_11_scriptRespawnLocationActors = 0x4FCF;
const YES = 0;

// `ld a, [wMapSceneStage] / (sra a) / add a / ld_hl_indexed table`: the stage's word of a table of this bank
const tableWord = (P, table, i) => P.rom.u16(BANK, (table + ((i * 2) & 0xFF)) & 0xFFFF);
const sra = v => ((v >> 1) | (v & 0x80)) & 0xFF;

// ---- Center Court ----
// CenterCourtNpc03_11 (11:4082): an official: his line, another before the final
export function* centerCourtNpc03(P) {
  yield* setText(P, Text_1f_80);
  const final = testFlag(P, FLAG_DOUBLES) ? ISLANDOPENSTAGE_DOUBLES_FINAL : ISLANDOPENSTAGE_SINGLES_FINAL;
  if (P.V.mapSceneStage === final) yield* setText(P, Text_1f_91);
  yield* speak(P, ACTOR_CENTER_COURT_WALK_6F_07_1);
}
// CenterCourtNpc04_11 (11:40AF): the other official: in doubles his line (another before the final); in singles
// a question (no: the other answer; yes: before the final the answer two messages on)
export function* centerCourtNpc04(P) {
  const { V } = P, NPC = ACTOR_CENTER_COURT_WALK_6F_07_2;
  if (testFlag(P, FLAG_DOUBLES)) {
    yield* setText(P, Text_1f_96);
    if (V.mapSceneStage === ISLANDOPENSTAGE_DOUBLES_FINAL) yield* setText(P, Text_1f_101);
  } else {                                                            // .altText
    yield* setText(P, Text_1f_81);
    if ((yield* askYesNo(P, NPC)) !== YES) {
      advanceText(P);
      yield* speak(P, NPC);
      return;
    }
    if (V.mapSceneStage === ISLANDOPENSTAGE_SINGLES_FINAL) { advanceText(P); advanceText(P); }   // .speak
  }
  yield* speak(P, NPC);                                               // .done
}
// CenterCourtNpc05_11 (11:4100): a spectator's line of the stage; before the singles final a question (no: the
// other answer)
export function* centerCourtNpc05(P) {
  yield* setText(P, tableWord(P, CenterCourtNpc05TextIds, P.V.mapSceneStage));
  if (P.V.mapSceneStage === ISLANDOPENSTAGE_SINGLES_FINAL) {
    if ((yield* askYesNo(P, ACTOR_CENTER_COURT_WALK_72_02)) !== YES) advanceText(P);
  }
  yield* speak(P, ACTOR_CENTER_COURT_WALK_72_02);
}
// CenterCourtNpc06_11 (11:414A): another spectator's line of the stage (said by the same actor slot)
export function* centerCourtNpc06(P) {
  yield* setText(P, tableWord(P, CenterCourtNpc06TextIds, P.V.mapSceneStage));
  yield* speak(P, ACTOR_CENTER_COURT_WALK_72_02);
}
// CenterCourtInitScript_11 (11:41A4): the stage; the court sprites; entry $0F the walk to the final, else the
// arrival walk
export function* centerCourtInitScript(P) {
  setupCenterCourtSceneVariant(P);
  setPlayerAndPartnerObjectDefs(P);
  if (P.V.storyModeEntryPoint === 0x0F) return yield* centerCourtEntry0fScene(P);
  yield* mapArrivalWalk(P);
}
// SetupCenterCourtSceneVariant (11:41B6): wMapSceneStage = the Island Open's stage (ISLANDOPENSTAGE_*: the rounds
// won, by format); before a final the court's other actor list (the finalists), with the cutscene mode on
export function setupCenterCourtSceneVariant(P) {
  const { V } = P;
  V.mapSceneStage = ISLANDOPENSTAGE_SINGLES_ROUND1;
  if (!testFlag(P, FLAG_DOUBLES)) {
    if (testFlag(P, FLAG_WON_ISLAND_OPEN_SINGLES_SEMIFINAL)) return finalists(P, ISLANDOPENSTAGE_SINGLES_FINAL);
    if (testFlag(P, FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_2)) V.mapSceneStage = ISLANDOPENSTAGE_SINGLES_SEMIFINAL;
    else if (testFlag(P, FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_1)) V.mapSceneStage = ISLANDOPENSTAGE_SINGLES_ROUND2;
    return;
  }
  if (testFlag(P, FLAG_WON_ISLAND_OPEN_DOUBLES_SEMIFINAL)) return finalists(P, ISLANDOPENSTAGE_DOUBLES_FINAL);   // .doneEarly
  V.mapSceneStage = testFlag(P, FLAG_WON_ISLAND_OPEN_DOUBLES_ROUND_1) ? ISLANDOPENSTAGE_DOUBLES_SEMIFINAL : ISLANDOPENSTAGE_DOUBLES_ROUND1;
}
function finalists(P, stage) {
  P.V.mapSceneStage = stage;
  respawnActors(P, CenterCourtSceneVariantActors_11);
  beginCutscene(P);
}
// MapArrivalWalk_11 (11:42FD): the arrival walk, the player walking up (twins.js)
export const mapArrivalWalk = arrivalWalkUp;
// SetPlayerAndPartnerObjectDefs_11 (11:4343): the court sprites (the twin body, written out here)
export const setPlayerAndPartnerObjectDefs = P => loadCourtPlayerPartnerObjDefs(P);
// CenterCourtEntry0fScene (11:437A): to the final: the player bows (ActorScript_11_00), walks to the court
// (ActorScript_11_01), and takes exit 1.
export function* centerCourtEntry0fScene(P) {
  setPosition(P, ACTOR_CENTER_COURT_SLOT_0A, 37.0, 36.0);
  if (testFlag(P, FLAG_DOUBLES)) setPosition(P, ACTOR_PARTNER, 12.0, 51.0);
  P.V.storyModeShowLocationName = 0;                                  // .notDoubles2
  fadeIn(P, 4);
  setActorScript(P, ACTOR_PLAYER, ActorScript_11_00);
  yield* wait(P, 80);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 30);
  yield* waitActorScript(P, ACTOR_PLAYER);
  yield* movePlayer(P, 35.0, 36.0);
  setActorScript(P, ACTOR_PLAYER, ActorScript_11_01);
  yield* wait(P, 240);
  requestExit(P, 0x01);
}

// ---- the academy's arrival square ----
// AcademyArrivalArrival01_11 (11:4536): the arrival walk, the player walking down (twins.js)
export const academyArrivalArrival01 = arrivalWalkDown;
// AcademyArrivalNpc03_11 (11:459D): a student's line of the story rank (wMapSceneStage); before the junior title
// (ranks 0-1) and from the senior title until complete (4-7) it is a question (no: the other answer)
export function* academyArrivalNpc03(P) {
  const rank = P.V.mapSceneStage, NPC = ACTOR_ACADEMY_ARRIVAL_WALK_71_03_1;
  yield* setText(P, tableWord(P, AcademyArrivalNpc03TextIds, rank));
  const question = rank < STORYRANK_SINGLES_COMPLETE && (rank >= STORYRANK_SINGLES_SENIOR_CHAMP || rank < STORYRANK_SINGLES_JUNIOR_CHAMP);
  if (!question) { yield* speak(P, NPC); return; }                    // .altText
  if ((yield* askYesNo(P, NPC)) !== YES) advanceText(P);              // .speak
  yield* speak(P, NPC);                                               // .done
}
// AcademyArrivalNpc04_11 (11:45F5) / AcademyArrivalNpc05_11 (11:4620): students' lines of the rank (the second
// by the tier)
export function* academyArrivalNpc04(P) {
  yield* setText(P, tableWord(P, AcademyArrivalNpc04TextIds, P.V.mapSceneStage));
  yield* speak(P, ACTOR_ACADEMY_ARRIVAL_WALK_71_05);
}
export function* academyArrivalNpc05(P) {
  yield* setText(P, tableWord(P, AcademyArrivalNpc05TextIds, sra(P.V.mapSceneStage)));
  yield* speak(P, ACTOR_ACADEMY_ARRIVAL_WALK_72_02);
}
// AcademyArrivalNpc14_11 (11:4643): the gatekeeper shakes his head: his line, one more for the Island Open reached
// and one more for the story complete (of the format played)
export function* academyArrivalNpc14(P) {
  yield* setText(P, Text_36_96);
  const doubles = testFlag(P, FLAG_DOUBLES);
  if (testFlag(P, doubles ? FLAG_REACHED_ISLAND_OPEN_DOUBLES : FLAG_REACHED_ISLAND_OPEN_SINGLES)) {
    advanceText(P);
    if (testFlag(P, doubles ? FLAG_STORY_COMPLETE_DOUBLES : FLAG_STORY_COMPLETE_SINGLES)) advanceText(P);
  }
  setAnim(P, ACTOR_ACADEMY_ARRIVAL_WALK_71_03_2, ANIM_SHAKE);         // .loop
  yield* waitIdle(P, ACTOR_ACADEMY_ARRIVAL_WALK_71_03_2);
  yield* speak(P, ACTOR_ACADEMY_ARRIVAL_WALK_71_03_2);
}
// AcademyArrivalTile0F_11 (11:46AD): the guide's tour goes on (student_11.asm)
export function* academyArrivalTile0F(P) { yield* P.runRom(BANK, ResumeAcademyGuideTour); }
// AcademyArrivalInitScript_11 (11:46B1): the story rank, the campus exit and the gate guard; by the entry: $0A the
// arrival scene (student_11.asm), $0C the end of the tour, $0F the late student.
export function* academyArrivalInitScript(P) {
  computeRankingProgressIndex(P);
  enableAcademyCampusExit(P);
  moveCampusGateGuardAside(P);
  switch (P.V.storyModeEntryPoint) {
    case 0x0A: return yield* P.runRom(BANK, AcademyArrivalInitScript_11_scriptRespawnLocationActors);
    case 0x0C: return yield* academyArrivalEntry0cScene(P);
    case 0x0F: yield* P.runRom(BANK, LateStudentCrashCutscene);
  }
}

export const HOOKS = [
  scene(BANK, 0x4082, centerCourtNpc03),
  scene(BANK, 0x40AF, centerCourtNpc04),
  scene(BANK, 0x4100, centerCourtNpc05),
  scene(BANK, 0x414A, centerCourtNpc06),
  [BANK, 0x4199, hook(() => {})],                                     // CenterCourtFacing01_11
  [BANK, 0x41A3, hook(() => {})],                                     // CenterCourtTile01_11
  scene(BANK, 0x41A4, centerCourtInitScript),
  [BANK, 0x41B6, hook(P => { setupCenterCourtSceneVariant(P); })],
  scene(BANK, 0x42FD, mapArrivalWalk),
  [BANK, 0x4343, hook(P => { setPlayerAndPartnerObjectDefs(P); })],
  scene(BANK, 0x437A, centerCourtEntry0fScene),
  scene(BANK, 0x4536, academyArrivalArrival01),
  scene(BANK, 0x459D, academyArrivalNpc03),
  scene(BANK, 0x45F5, academyArrivalNpc04),
  scene(BANK, 0x4620, academyArrivalNpc05),
  scene(BANK, 0x4643, academyArrivalNpc14),
  scene(BANK, 0x46AD, academyArrivalTile0F),
  scene(BANK, 0x46B1, academyArrivalInitScript),
];
