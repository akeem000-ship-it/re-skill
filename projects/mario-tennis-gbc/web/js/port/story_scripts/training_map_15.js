// The tournament courtyard and the training court (bank $15, $4100-$4D0F): the courtyard's NPC, init script, the
// site by the Island Open's rounds, the group's arrival scene, the partner's stand-in and the walk in; the
// training court's arrival, NPC flags and students, and the swing-practice kid. The map tables, actor lists, NPC
// script lists, text-id tables and facings are data.
// Port of src/story/training_map_15.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are; SetPlayerPartnerActorSprites is src/twins/
// load_court_player_partner_obj_defs.asm (twins.js).
// Recordings: out/engine/rec2.mtrec (the training court), out/port/ss1_coach*.mtrec, ss1_tourn*.mtrec (part 1's
// scripted training court and tournament), out/port/ss2_tcourt*.mtrec (scripted: the courtyard's arrival and
// rounds, the training court's students, the swing kid).
import {
  ACTOR_PARTNER, ACTOR_PLAYER, ANIM_BOUNCE, ANIM_NOD, ANIM_SHAKE, ANIM_WALK, BEHAVIOR_TRIGGER, FACE_DOWN, FACE_LEFT,
  FACE_RIGHT, FACE_UP, FLAG_DOUBLES, STORYENTRY_NONE, actorState, advanceText, askYesNo, beginCutscene, clearFlag,
  face, fadeIn, fadeOutAndWait, gesture, goToLocation, lockFacing, moveAngle, moveAngleRaw, movePlayer,
  movePlayerToActor, moveTarget, nullScript, playerSpeed, respawnActors, hook, scene, setAnim, setFlag, setNpcScripts,
  setPosition, setSpeed, setText, sound, speak, testFlag, unlockFacing, wait, waitFadeEnd, waitIdle, waitMove,
  waitPlayerMove, writeBehaviorCell,
} from "./common.js";
import { loadObjdef, loadCourtPlayerPartnerObjDefs, OBJ_HARRY_B } from "./twins.js";
import { tableText } from "./shared2.js";

const ISLANDOPENSTAGE_DOUBLES_FINAL = 0x06;
const ISLANDOPENSTAGE_DOUBLES_ROUND1 = 0x04;
const ISLANDOPENSTAGE_DOUBLES_SEMIFINAL = 0x05;
const ISLANDOPENSTAGE_SINGLES_FINAL = 0x03;
const ISLANDOPENSTAGE_SINGLES_ROUND1 = 0x00;
const ISLANDOPENSTAGE_SINGLES_ROUND2 = 0x01;
const ISLANDOPENSTAGE_SINGLES_SEMIFINAL = 0x02;
const TournamentCourtyardNpc05TextIds = 0x414B;
const TournamentSiteDoublesFinalNpcScripts_15 = 0x4414;
const TournamentSiteDoublesRound1NpcScripts_15 = 0x43A2;
const TournamentSiteDoublesSemifinalNpcScripts_15 = 0x43DB;
const TournamentSiteFinalNpcScripts_15 = 0x4369;
const TournamentSiteRespawnActors_15 = 0x41CD;
const TournamentSiteRound2NpcScripts_15 = 0x42F7;
const TournamentSiteSemifinalNpcScripts_15 = 0x4330;
const TrainingCourtNpc03TextIds = 0x4991;
const TrainingCourtNpc04TextIds = 0x49B2;
const TrainingCourtNpc05TextIds = 0x49D3;
const TrainingCourtNpc08TextIds = 0x49F4;
const TrainingCourtNpc09TextIds_15 = 0x4A15;
const TrainingCourtNpc0ATextIds = 0x4A36;
const TrainingCourtNpc0BTextIds = 0x4A76;
const TrainingCourtNpc0ETextIds = 0x4A97;
const TrainingCourtNpc0FTextIds = 0x4AD7;
const TrainingCourtNpc10TextIds_15 = 0x4B17;
const BANK = 0x15;
const STORYTIER_JUNIOR_CHAMP = 0x01, STORYTIER_SENIOR_CHAMP = 0x02;
const OBJ_KATE_B = 0x59;
const TournamentSiteEntryWalkInFacings = 0x4757;
const ACTOR_TOURNAMENT_COURTYARD_WALK_71_06 = 0x05;
const ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_06 = 0x04;
const ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_07 = 0x05;
const ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_08 = 0x06;
const ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_75_06 = 0x03;
const ACTOR_TRAINING_COURT_BALLOON_SCRIBBLE = 0x16;
const ACTOR_TRAINING_COURT_PAM = 0x0B;
const ACTOR_TRAINING_COURT_WALK_71_05_1 = 0x04;
const ACTOR_TRAINING_COURT_WALK_71_05_2 = 0x0F;
const ACTOR_TRAINING_COURT_WALK_71_06_1 = 0x03;
const ACTOR_TRAINING_COURT_WALK_71_06_2 = 0x0A;
const ACTOR_TRAINING_COURT_WALK_71_06_3 = 0x13;
const ACTOR_TRAINING_COURT_WALK_71_07_1 = 0x05;
const ACTOR_TRAINING_COURT_WALK_71_07_2 = 0x08;
const ACTOR_TRAINING_COURT_WALK_71_07_3 = 0x10;
const ACTOR_TRAINING_COURT_WALK_72_02_1 = 0x09;
const ANIM_SWING_LOOP = 0x06;
const FLAG_NET_CHALLENGER_DEFEATED = 0xBB;
const FLAG_NET_COACH_GREETED = 0xBE;
const FLAG_RETURN_COACH_GREETED = 0xBF;
const FLAG_SERVE_CHALLENGER_DEFEATED = 0xBA;
const FLAG_SERVE_COACH_GREETED = 0xBD;
const FLAG_STROKE_CHALLENGER_DEFEATED = 0xBC;
const FLAG_SWING_PRACTICE_KID_PLACED = 0x80;
const FLAG_TOURNAMENT_NPC05_TALKED_DOUBLES = 0x77;
const FLAG_TOURNAMENT_NPC05_TALKED_SINGLES = 0x76;
const FLAG_WON_ISLAND_OPEN_DOUBLES_ROUND_1 = 0x37;
const FLAG_WON_ISLAND_OPEN_DOUBLES_SEMIFINAL = 0x36;
const FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_1 = 0x3F;
const FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_2 = 0x3E;
const FLAG_WON_ISLAND_OPEN_SINGLES_SEMIFINAL = 0x3D;
const SFX_APPEAR1 = 0x99;
const STORYLOC_TOURNAMENT = 0x19;
const Text_1f_13 = 0x240D;
const Text_1f_32 = 0x2420;
const Text_36_671 = 0x1A9F;

// TournamentCourtyardNpc05_15 (15:4100): her line by the round, the first time (by format) with a bounce and a
// second line; later Text_1f_32
export function* tournamentCourtyardNpc05(P) {
  yield* setText(P, tableText(P, BANK, TournamentCourtyardNpc05TextIds, P.V.mapSceneStage));
  const talked = testFlag(P, FLAG_DOUBLES) ? FLAG_TOURNAMENT_NPC05_TALKED_DOUBLES : FLAG_TOURNAMENT_NPC05_TALKED_SINGLES;
  if (testFlag(P, talked)) {                              // .done: talked to before
    yield* setText(P, Text_1f_32);
    yield* speak(P, ACTOR_TOURNAMENT_COURTYARD_WALK_71_06);
    return;
  }
  setFlag(P, talked);
  yield* speak(P, ACTOR_TOURNAMENT_COURTYARD_WALK_71_06);   // .speak
  yield* gesture(P, ACTOR_TOURNAMENT_COURTYARD_WALK_71_06, ANIM_BOUNCE);
  yield* speak(P, ACTOR_TOURNAMENT_COURTYARD_WALK_71_06);
}

// TournamentCourtyardFacing01_15 (15:419B) / TournamentCourtyardTile01_15 (15:41A5): `ret`
export function* tournamentCourtyardFacing01(P) {
}

export function* tournamentCourtyardTile01(P) {
}

// TournamentCourtyardInitScript_15 (15:41A6): entry $0F the arrival; else the court sprites, the site by the
// rounds won, the walk in
export function* tournamentCourtyardInitScript(P) {
  if (P.V.storyModeEntryPoint === 0x0F) {
    return yield* tournamentSiteArrivalScene(P);
  }
  loadCourtPlayerPartnerObjDefs(P);                       // SetPlayerPartnerActorSprites
  yield* initTournamentSiteSceneVariant(P);
  yield* tournamentSiteEntryWalkIn(P);
}

// InitTournamentSiteSceneVariant (15:4271): the Island Open's stage (wMapSceneStage) and the NPC scripts by the
// rounds won (singles: the trigger cell (14, 20) for the tournament's gate first)
export function* initTournamentSiteSceneVariant(P) {
  P.V.mapSceneStage = ISLANDOPENSTAGE_SINGLES_ROUND1;
  if (!testFlag(P, FLAG_DOUBLES)) {
    writeBehaviorCell(P, 14, 20, BEHAVIOR_TRIGGER | 15 << 4);
    if (testFlag(P, FLAG_WON_ISLAND_OPEN_SINGLES_SEMIFINAL)) {
      setNpcScripts(P, TournamentSiteFinalNpcScripts_15);
      P.V.mapSceneStage = ISLANDOPENSTAGE_SINGLES_FINAL;
      return;
    }
    if (testFlag(P, FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_2)) {
      setNpcScripts(P, TournamentSiteSemifinalNpcScripts_15);
      P.V.mapSceneStage = ISLANDOPENSTAGE_SINGLES_SEMIFINAL;
      return;
    }
    if (testFlag(P, FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_1)) {
      setNpcScripts(P, TournamentSiteRound2NpcScripts_15);
      P.V.mapSceneStage = ISLANDOPENSTAGE_SINGLES_ROUND2;
    }
    return;
  }
  if (testFlag(P, FLAG_WON_ISLAND_OPEN_DOUBLES_SEMIFINAL)) {
    setNpcScripts(P, TournamentSiteDoublesFinalNpcScripts_15);
    P.V.mapSceneStage = ISLANDOPENSTAGE_DOUBLES_FINAL;
    return;
  }
  if (testFlag(P, FLAG_WON_ISLAND_OPEN_DOUBLES_ROUND_1)) {
    setNpcScripts(P, TournamentSiteDoublesSemifinalNpcScripts_15);
    P.V.mapSceneStage = ISLANDOPENSTAGE_DOUBLES_SEMIFINAL;
    return;
  }
  setNpcScripts(P, TournamentSiteDoublesRound1NpcScripts_15);
  P.V.mapSceneStage = ISLANDOPENSTAGE_DOUBLES_ROUND1;
}

// TournamentSiteArrivalScene (15:444D): the arrival: the academy's group walks up to the site, Emily's talk and
// the group's answers, the player looks around; Alex's line; they go in (the tournament at entry $0F)
export function* tournamentSiteArrivalScene(P) {
  respawnActors(P, TournamentSiteRespawnActors_15);
  beginCutscene(P);
  yield* setupTournamentSitePartnerActor(P);
  playerSpeed(P, 7.96875);
  yield* movePlayer(P, 18.0, 41.0);
  yield* waitPlayerMove(P);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  moveTarget(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_75_06, 18.0, 41.0);
  moveTarget(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_06, 17.0, 44.0);
  moveTarget(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_07, 19.0, 46.0);
  moveTarget(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_08, 19.0, 44.0);
  moveTarget(P, ACTOR_PLAYER, 17.0, 46.0);
  yield* waitMove(P, ACTOR_PLAYER);
  playerSpeed(P, 1.0);
  yield* movePlayer(P, 18.0, 16.0);
  moveTarget(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_75_06, 18.0, 16.0);
  moveTarget(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_06, 17.0, 19.0);
  moveTarget(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_07, 19.0, 21.0);
  moveTarget(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_08, 19.0, 19.0);
  moveTarget(P, ACTOR_PLAYER, 17.0, 21.0);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* wait(P, 40);
  face(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_75_06, FACE_DOWN);
  yield* setText(P, Text_1f_13);
  yield* speak(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_75_06);
  setAnim(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_06, ANIM_NOD);
  setAnim(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_07, ANIM_NOD);
  setAnim(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_08, ANIM_NOD);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  setAnim(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_75_06, ANIM_SHAKE);
  yield* waitIdle(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_75_06);
  yield* speak(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_75_06);
  setAnim(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_08, ANIM_NOD);
  yield* waitIdle(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_08);
  yield* speak(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_08);
  setAnim(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_07, ANIM_NOD);
  yield* waitIdle(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_07);
  yield* speak(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_07);
  setAnim(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_75_06, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_75_06);
  yield* speak(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_75_06);
  setAnim(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_06, ANIM_NOD);
  yield* waitIdle(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_06);
  yield* speak(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_06);
  setAnim(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_75_06, ANIM_NOD);
  yield* waitIdle(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_75_06);
  yield* speak(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_75_06);
  setAnim(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_06, ANIM_NOD);
  setAnim(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_07, ANIM_NOD);
  setAnim(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_08, ANIM_NOD);
  yield* waitIdle(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_08);
  setAnim(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_75_06, ANIM_NOD);
  yield* waitIdle(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_75_06);
  face(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_75_06, FACE_RIGHT);
  yield* wait(P, 5);
  moveAngle(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_75_06, FACE_UP, 8.0);
  yield* wait(P, 60);
  face(P, ACTOR_PLAYER, FACE_LEFT);
  yield* wait(P, 40);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  yield* wait(P, 40);
  face(P, ACTOR_PLAYER, FACE_LEFT);
  yield* wait(P, 40);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* wait(P, 40);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  yield* wait(P, 40);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* wait(P, 40);
  moveTarget(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_08, 18.0, 16.0);
  yield* waitMove(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_08);
  face(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_08, FACE_DOWN);
  yield* speak(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_08);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  setAnim(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_06, ANIM_NOD);
  setAnim(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_07, ANIM_NOD);
  yield* waitIdle(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_07);
  goToLocation(P, STORYLOC_TOURNAMENT, 0x0F);
  moveAngle(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_06, FACE_UP, 10.0);
  moveAngle(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_07, FACE_UP, 10.0);
  moveAngle(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_08, FACE_UP, 10.0);
  moveAngle(P, ACTOR_PLAYER, FACE_UP, 10.0);
  yield* wait(P, 30);
  yield* fadeOutAndWait(P, 8);
}

// SetupTournamentSitePartnerActor (15:46B7): the court sprites; doubles: the group's partner as the player's partner
// (Harry or Kate by gender), the partner itself put away
export function* setupTournamentSitePartnerActor(P) {
  loadCourtPlayerPartnerObjDefs(P);                       // SetPlayerPartnerActorSprites
  if (!testFlag(P, FLAG_DOUBLES)) return;                 // .noPartner
  loadObjdef(P, ACTOR_TOURNAMENT_SITE_RESPAWN_WALK_74_07, P.V.storyModeGenderOfPartnerCharacter ? OBJ_KATE_B : OBJ_HARRY_B);
  nullScript(P, ACTOR_PARTNER);                           // .apply
  setPosition(P, ACTOR_PARTNER, 63.0, 63.0);
}

// TournamentSiteEntryWalkIn (15:46F0): (unless entering keeping the position) the walk in from the entry point:
// in doubles the partner steps 2 tiles out at full speed (TournamentSiteEntryWalkInFacings + 4 by the entry) and
// turns (the entry's facing); the player walks 2 tiles on the entry's facing (not waited for)
export function* tournamentSiteEntryWalkIn(P) {
  const entry = P.V.storyModeEntryPoint;
  if (entry === STORYENTRY_NONE) return;
  const facing = k => P.rom.u8(BANK, (TournamentSiteEntryWalkInFacings + k + ((entry - 1) & 0xFF)) & 0xFFFF);
  if (testFlag(P, FLAG_DOUBLES)) {
    setSpeed(P, ACTOR_PARTNER, 7.96875);
    moveAngleRaw(P, ACTOR_PARTNER, facing(4), 0x0200);
    yield* waitMove(P, ACTOR_PARTNER);
    face(P, ACTOR_PARTNER, facing(0));
    setSpeed(P, ACTOR_PARTNER, 0.5);
  }
  setSpeed(P, ACTOR_PLAYER, 0.5);                         // .walkOff
  moveAngleRaw(P, ACTOR_PLAYER, facing(0), 0x0200);
}

// TrainingCourtArrival01_15 (15:490D): (unless entering keeping the position) the court's NPC flags cleared; in
// doubles the partner steps aside; the player walks 2 tiles right
export function* trainingCourtArrival01(P) {
  if (P.V.storyModeEntryPoint === STORYENTRY_NONE) return;
  yield* clearTrainingCourtNpcFlags(P);
  if (testFlag(P, FLAG_DOUBLES)) {
    setSpeed(P, ACTOR_PARTNER, 7.96875);
    moveAngle(P, ACTOR_PARTNER, FACE_LEFT, 2.0);
    yield* waitMove(P, ACTOR_PARTNER);
    face(P, ACTOR_PARTNER, FACE_RIGHT);
    setSpeed(P, ACTOR_PARTNER, 0.5);
  }
  setSpeed(P, ACTOR_PLAYER, 0.5);
  moveAngle(P, ACTOR_PLAYER, FACE_RIGHT, 2.0);
}

// ClearTrainingCourtNpcFlags (15:4967): the challengers beaten and the coaches greeted forgotten
export function* clearTrainingCourtNpcFlags(P) {
  clearFlag(P, FLAG_SERVE_CHALLENGER_DEFEATED);
  clearFlag(P, FLAG_SERVE_COACH_GREETED);
  clearFlag(P, FLAG_NET_CHALLENGER_DEFEATED);
  clearFlag(P, FLAG_NET_COACH_GREETED);
  clearFlag(P, FLAG_STROKE_CHALLENGER_DEFEATED);
  clearFlag(P, FLAG_RETURN_COACH_GREETED);
}

// TrainingCourtNpc03_15 (15:497A) .. TrainingCourtNpc10_15 (15:4AE1): the court's students' lines by tier (Pam
// before junior champion, 0F before it, 10 from senior champion: a question)
export function* trainingCourtNpc03(P) {
  yield* setText(P, tableText(P, BANK, TrainingCourtNpc03TextIds, P.V.mapSceneStage));
  yield* speak(P, ACTOR_TRAINING_COURT_WALK_71_06_1);
}

export function* trainingCourtNpc04(P) {
  yield* setText(P, tableText(P, BANK, TrainingCourtNpc04TextIds, P.V.mapSceneStage));
  yield* speak(P, ACTOR_TRAINING_COURT_WALK_71_05_1);
}

export function* trainingCourtNpc05(P) {
  yield* setText(P, tableText(P, BANK, TrainingCourtNpc05TextIds, P.V.mapSceneStage));
  yield* speak(P, ACTOR_TRAINING_COURT_WALK_71_07_1);
}

export function* trainingCourtNpc08(P) {
  yield* setText(P, tableText(P, BANK, TrainingCourtNpc08TextIds, P.V.mapSceneStage));
  yield* speak(P, ACTOR_TRAINING_COURT_WALK_71_07_2);
}

export function* trainingCourtNpc09(P) {
  yield* setText(P, tableText(P, BANK, TrainingCourtNpc09TextIds_15, P.V.mapSceneStage));
  yield* speak(P, ACTOR_TRAINING_COURT_WALK_72_02_1);
}

export function* trainingCourtNpc0A(P) {
  yield* setText(P, tableText(P, BANK, TrainingCourtNpc0ATextIds, P.V.mapSceneStage));
  yield* speak(P, ACTOR_TRAINING_COURT_WALK_71_06_2);
}

export function* trainingCourtNpc0B(P) {
  yield* setText(P, tableText(P, BANK, TrainingCourtNpc0BTextIds, P.V.mapSceneStage));
  if (P.V.mapSceneStage !== STORYTIER_JUNIOR_CHAMP) {
    if ((yield* askYesNo(P, ACTOR_TRAINING_COURT_PAM)) !== 0) advanceText(P);
  }
  yield* speak(P, ACTOR_TRAINING_COURT_PAM);
}

export function* trainingCourtNpc0E(P) {
  yield* setText(P, tableText(P, BANK, TrainingCourtNpc0ETextIds, P.V.mapSceneStage));
  yield* speak(P, ACTOR_TRAINING_COURT_WALK_71_05_2);
}

export function* trainingCourtNpc0F(P) {
  yield* setText(P, tableText(P, BANK, TrainingCourtNpc0FTextIds, P.V.mapSceneStage));
  if (!(P.V.mapSceneStage >= STORYTIER_JUNIOR_CHAMP)) {
    if ((yield* askYesNo(P, ACTOR_TRAINING_COURT_WALK_71_05_2)) !== 0) advanceText(P);
  }
  yield* speak(P, ACTOR_TRAINING_COURT_WALK_71_05_2);
}

export function* trainingCourtNpc10(P) {
  yield* setText(P, tableText(P, BANK, TrainingCourtNpc10TextIds_15, P.V.mapSceneStage));
  if (!(P.V.mapSceneStage < STORYTIER_SENIOR_CHAMP)) {
    if ((yield* askYesNo(P, ACTOR_TRAINING_COURT_WALK_71_07_3)) !== 0) advanceText(P);
  }
  yield* speak(P, ACTOR_TRAINING_COURT_WALK_71_07_3);
}

// TrainingCourtNpc13_15 (15:4B21): the swing-practice kid: his question; yes: a nod, his line; no: the kid shows
// the swing (the scribble balloon), the player tries it, the kid runs off
export function* trainingCourtNpc13(P) {
  yield* movePlayerToActor(P, ACTOR_TRAINING_COURT_WALK_71_06_3);
  yield* waitPlayerMove(P);
  P.bus.w8((actorState(P, ACTOR_PLAYER) + 0x18) & 0xFFFF, 0x01);   // (the record's byte $18)
  yield* setText(P, Text_36_671);
  if ((yield* askYesNo(P, ACTOR_TRAINING_COURT_WALK_71_06_3)) === 0) {   // yes: a nod, his line
    setAnim(P, ACTOR_PLAYER, ANIM_NOD);
    yield* waitIdle(P, ACTOR_PLAYER);
    yield* speak(P, ACTOR_TRAINING_COURT_WALK_71_06_3);
    yield* wait(P, 10);
    return;
  }
  setFlag(P, FLAG_SWING_PRACTICE_KID_PLACED);
  setAnim(P, ACTOR_PLAYER, ANIM_SHAKE);
  yield* waitIdle(P, ACTOR_PLAYER);
  setAnim(P, ACTOR_TRAINING_COURT_WALK_71_06_3, ANIM_WALK);
  yield* waitIdle(P, ACTOR_TRAINING_COURT_WALK_71_06_3);
  face(P, ACTOR_TRAINING_COURT_WALK_71_06_3, FACE_LEFT);
  P.bus.w8((actorState(P, ACTOR_TRAINING_COURT_WALK_71_06_3) + 0x18) & 0xFFFF, 0x02);   // (the record's byte $18)
  setAnim(P, ACTOR_TRAINING_COURT_WALK_71_06_3, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_TRAINING_COURT_WALK_71_06_3);
  P.bus.w8((actorState(P, ACTOR_TRAINING_COURT_WALK_71_06_3) + 0x18) & 0xFFFF, 0x01);   // (the record's byte $18)
  setPosition(P, ACTOR_TRAINING_COURT_BALLOON_SCRIBBLE, 54.5, 13.5);
  sound(P, SFX_APPEAR1);
  advanceText(P);
  yield* speak(P, ACTOR_TRAINING_COURT_WALK_71_06_3);
  setSpeed(P, ACTOR_PLAYER, 0.5625);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  moveTarget(P, ACTOR_PLAYER, 51.0, 15.0);
  yield* waitMove(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  yield* wait(P, 10);
  setPosition(P, ACTOR_TRAINING_COURT_BALLOON_SCRIBBLE, 63.0, 63.0);
  yield* wait(P, 20);
  setAnim(P, ACTOR_PLAYER, ANIM_SWING_LOOP);
  yield* wait(P, 180);
  setAnim(P, ACTOR_PLAYER, ANIM_WALK);
  yield* waitIdle(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  face(P, ACTOR_TRAINING_COURT_WALK_71_06_3, FACE_DOWN);
  yield* wait(P, 1);
  setAnim(P, ACTOR_TRAINING_COURT_WALK_71_06_3, ANIM_SHAKE);
  yield* waitIdle(P, ACTOR_TRAINING_COURT_WALK_71_06_3);
  face(P, ACTOR_TRAINING_COURT_WALK_71_06_3, FACE_LEFT);
  yield* wait(P, 1);
  yield* speak(P, ACTOR_TRAINING_COURT_WALK_71_06_3);
  yield* wait(P, 30);
  setSpeed(P, ACTOR_PLAYER, 1.0);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  yield* wait(P, 1);
  lockFacing(P, ACTOR_PLAYER);
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  moveTarget(P, ACTOR_PLAYER, 51.0, 13.0);
  moveTarget(P, ACTOR_TRAINING_COURT_WALK_71_06_3, 51.0, 15.0);
  yield* waitMove(P, ACTOR_TRAINING_COURT_WALK_71_06_3);
  moveTarget(P, ACTOR_TRAINING_COURT_WALK_71_06_3, 51.0, 21.0);
  yield* waitMove(P, ACTOR_TRAINING_COURT_WALK_71_06_3);
  moveTarget(P, ACTOR_TRAINING_COURT_WALK_71_06_3, 31.0, 21.0);
  yield* waitMove(P, ACTOR_TRAINING_COURT_WALK_71_06_3);
  setPosition(P, ACTOR_TRAINING_COURT_WALK_71_06_3, 63.0, 63.0);
  unlockFacing(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  P.bus.w8((actorState(P, ACTOR_PLAYER) + 0x18) & 0xFFFF, 0x02);   // (the record's byte $18)
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  setPosition(P, ACTOR_TRAINING_COURT_BALLOON_SCRIBBLE, 52.5, 11.5);
  sound(P, SFX_APPEAR1);
  yield* wait(P, 80);
}

export const HOOKS = [
  [BANK, 0x475F, hook(P => { loadCourtPlayerPartnerObjDefs(P); })],          // SetPlayerPartnerActorSprites (twin)
  scene(BANK, 0x4100, tournamentCourtyardNpc05),
  scene(BANK, 0x419B, tournamentCourtyardFacing01),
  scene(BANK, 0x41A5, tournamentCourtyardTile01),
  scene(BANK, 0x41A6, tournamentCourtyardInitScript),
  scene(BANK, 0x4271, initTournamentSiteSceneVariant),
  scene(BANK, 0x444D, tournamentSiteArrivalScene),
  scene(BANK, 0x46B7, setupTournamentSitePartnerActor),
  scene(BANK, 0x46F0, tournamentSiteEntryWalkIn),
  scene(BANK, 0x490D, trainingCourtArrival01),
  scene(BANK, 0x4967, clearTrainingCourtNpcFlags),
  scene(BANK, 0x497A, trainingCourtNpc03),
  scene(BANK, 0x499B, trainingCourtNpc04),
  scene(BANK, 0x49BC, trainingCourtNpc05),
  scene(BANK, 0x49DD, trainingCourtNpc08),
  scene(BANK, 0x49FE, trainingCourtNpc09),
  scene(BANK, 0x4A1F, trainingCourtNpc0A),
  scene(BANK, 0x4A40, trainingCourtNpc0B),
  scene(BANK, 0x4A80, trainingCourtNpc0E),
  scene(BANK, 0x4AA1, trainingCourtNpc0F),
  scene(BANK, 0x4AE1, trainingCourtNpc10),
  scene(BANK, 0x4B21, trainingCourtNpc13),
];
