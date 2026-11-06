// The varsity courts' Kevin and the traveling team (bank $13, $6C13-$7987): Kevin's offer of the varsity match
// (court A singles, court B doubles: two questions; yes: the walk to the court and the match; no then yes: not
// now), the students back to their places, and the traveling team's victory cutscenes (singles and doubles: the
// team's welcome, the partner-to-be's lines by gender, the team's screens, then the main menu). The actor lists
// are data.
// Port of src/story/varsity_team_13.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss2_varsity*.mtrec, ss2_team*.mtrec (scripted: Kevin's offers, the team's victories,
// singles and doubles, both partner genders).
import {
  ACTOR_PARTNER, ACTOR_PLAYER, ACTOR_PLAYER_SHADOW, ANIM_BOUNCE, ANIM_NOD, ANIM_SHAKE, FACE_DOWN, FACE_LEFT,
  FACE_RIGHT, FACE_UP, MATCHLIST_DOUBLES, MATCHLIST_SINGLES, WRAM_ACTORS, WRAM_SCENE, actorState, advanceText,
  askYesNo, beginCutscene, face, faceToward, fadeIn, fadeOutAndWait, followPlayer, gesture, goToLocation, lockFacing,
  moveAngle, movePlayer, movePlayerToActor, moveTarget, nullScript, playStoryMatch, playerSpeed, respawnActors,
  scene, setActorScript, setAnim, setFlag, setPosition, setSpeed, setText, sound, speak, testFlag, unlockFacing,
  wait, waitActorScript, waitFadeEnd, waitIdle, waitMove, waitPlayerMove,
} from "./common.js";
import { applyPartnerCharacterVariant } from "./varsity_tour_13.js";

const DoublesTravelingTeamActors_13 = 0x78D7;
const STORYMATCH_VARSITY_2 = 0x0D;
const STORYMATCH_VARSITY_4 = 0x0B;
const SinglesTravelingTeamActors_13 = 0x739C;
const BANK = 0x13;
const WINLOSE_WIN = 0x01;
const ACTOR_RECORD_BYTE_18 = 0x18;                      // a byte of the actor record the disassembly leaves unnamed
const SCENE_MODE_TEAM = 0x00;                           // RunStorySceneByMode's b: the traveling team's screens
// routines of other banks (run as the ROM's, or the JS another part hooked there)
const RunStorySceneByMode = [0x18, 0x7617];
const ACTOR_DOUBLES_TRAVELING_TEAM_BALLOON_SWEAT = 0x0A;
const ACTOR_DOUBLES_TRAVELING_TEAM_BOB = 0x04;
const ACTOR_DOUBLES_TRAVELING_TEAM_EMILY = 0x08;
const ACTOR_DOUBLES_TRAVELING_TEAM_KEVIN = 0x03;
const ACTOR_DOUBLES_TRAVELING_TEAM_MARK = 0x09;
const ACTOR_SINGLES_TRAVELING_TEAM_BALLOON_QUESTION = 0x0C;
const ACTOR_SINGLES_TRAVELING_TEAM_BOB = 0x04;
const ACTOR_SINGLES_TRAVELING_TEAM_EMILY = 0x08;
const ACTOR_SINGLES_TRAVELING_TEAM_KATE = 0x0D;
const ACTOR_SINGLES_TRAVELING_TEAM_KEVIN = 0x03;
const ACTOR_SINGLES_TRAVELING_TEAM_MARK = 0x09;
const ACTOR_VARSITY_COURT_A_BETH = 0x07;
const ACTOR_VARSITY_COURT_A_BOB = 0x04;
const ACTOR_VARSITY_COURT_A_CURT = 0x06;
const ACTOR_VARSITY_COURT_A_FAY = 0x05;
const ACTOR_VARSITY_COURT_A_KEVIN = 0x03;
const ACTOR_VARSITY_COURT_B_BETH = 0x07;
const ACTOR_VARSITY_COURT_B_BOB = 0x04;
const ACTOR_VARSITY_COURT_B_CURT = 0x06;
const ACTOR_VARSITY_COURT_B_FAY = 0x05;
const ACTOR_VARSITY_COURT_B_KEVIN = 0x03;
const ACTOR_VARSITY_COURT_B_MARK = 0x09;
const ActorScript_13_04 = 0x6B19;
const ActorScript_13_05 = 0x6B24;
const ActorScript_13_06 = 0x6B31;
const ActorScript_13_07 = 0x6B3C;
const ActorScript_13_08 = 0x6B47;
const ActorScript_13_09 = 0x6B58;
const ActorScript_13_12 = 0x6B97;
const ActorScript_13_13 = 0x6BAE;
const ActorScript_13_14 = 0x6BC5;
const ActorScript_13_15 = 0x6BDC;
const ActorScript_13_16 = 0x6BE7;
const ActorScript_13_17 = 0x6BF2;
const ActorScript_13_18 = 0x6BFD;
const ActorScript_13_19 = 0x6C08;
const ActorScript_13_21 = 0x7A43;
const ActorScript_13_22 = 0x7A60;
const ActorScript_13_23 = 0x7A7D;
const ActorScript_13_24 = 0x7AA0;
const ActorScript_13_25 = 0x7AA7;
const ActorScript_13_26 = 0x7AC9;
const FLAG_TEMP_SCENE_VARIANT_A = 0xE0;
const FLAG_WON_JUNIOR_DOUBLES_RANK_1 = 0x42;
const FLAG_WON_JUNIOR_SINGLES_RANK_1 = 0x53;
const FLAG_WON_SENIOR_DOUBLES_RANK_1 = 0x46;
const FLAG_WON_SENIOR_SINGLES_RANK_1 = 0x57;
const SFX_APPEAR2 = 0x96;
const SFX_EMOTE = 0x98;
const STORYLOC_COURTYARD = 0x07;
const STORYLOC_MAIN_MENU = 0x00;
const Text_30_544 = 0x220;
const Text_30_548 = 0x224;
const Text_30_554 = 0x22A;
const Text_31_12 = 0x40C;
const Text_31_16 = 0x410;
const Text_31_22 = 0x416;
const Text_31_24 = 0x418;
const Text_31_26 = 0x41A;
const Text_31_28 = 0x41C;

// VarsityCourtANpc03FaceUp_13 (13:6C13) / VarsityCourtBNpc03FaceUp_13 (13:6E20): talked to from below: the player
// backs up to (13, 31) facing him first
export function* varsityCourtANpc03FaceUp(P) {
  setSpeed(P, ACTOR_PLAYER, 0.25);
  lockFacing(P, ACTOR_PLAYER);
  moveTarget(P, ACTOR_PLAYER, 13.0, 31.0);
  yield* waitMove(P, ACTOR_PLAYER);
  unlockFacing(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* varsityCourtANpc03(P);
}

// VarsityCourtANpc03_13 (13:6C40): Kevin at court A (singles): his question; yes: the player to (13, 31), Bob
// steps up and aside, Kevin's second question (no: a third: yes, not now); the varsity rank-4 match, back to the
// courtyard's entry $0D after it
export function* varsityCourtANpc03(P) {
  yield* setText(P, Text_30_544);
  if ((yield* askYesNo(P, ACTOR_VARSITY_COURT_A_KEVIN)) !== 0) return yield* courtNpc03DeclinedA(P);   // .stage3
  advanceText(P);
  setSpeed(P, ACTOR_PLAYER, 0.5);
  moveTarget(P, ACTOR_PLAYER, 13.0, 31.0);
  yield* waitMove(P, ACTOR_PLAYER);
  faceToward(P, ACTOR_VARSITY_COURT_A_KEVIN, ACTOR_PLAYER);
  yield* wait(P, 30);
  faceToward(P, ACTOR_PLAYER, ACTOR_VARSITY_COURT_A_KEVIN);
  yield* speak(P, ACTOR_VARSITY_COURT_A_KEVIN);
  setSpeed(P, ACTOR_PLAYER, 1.0);
  yield* wait(P, 15);
  faceToward(P, ACTOR_VARSITY_COURT_A_BOB, ACTOR_VARSITY_COURT_A_KEVIN);
  yield* wait(P, 30);
  faceToward(P, ACTOR_VARSITY_COURT_A_BOB, ACTOR_PLAYER);
  yield* wait(P, 30);
  playerSpeed(P, 1.0);
  yield* movePlayerToActor(P, ACTOR_VARSITY_COURT_A_BOB);
  yield* waitPlayerMove(P);
  setAnim(P, ACTOR_VARSITY_COURT_A_BOB, ANIM_NOD);
  yield* waitIdle(P, ACTOR_VARSITY_COURT_A_BOB);
  moveTarget(P, ACTOR_VARSITY_COURT_A_BOB, 11.0, 31.0);
  yield* movePlayerToActor(P, ACTOR_PLAYER);
  yield* waitMove(P, ACTOR_VARSITY_COURT_A_BOB);
  face(P, ACTOR_VARSITY_COURT_A_KEVIN, FACE_DOWN);
  yield* wait(P, 15);
  face(P, ACTOR_VARSITY_COURT_A_BOB, FACE_UP);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* wait(P, 15);
  setAnim(P, ACTOR_VARSITY_COURT_A_KEVIN, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_VARSITY_COURT_A_KEVIN);
  if ((yield* askYesNo(P, ACTOR_VARSITY_COURT_A_KEVIN)) !== 0) {      // .speak: another question
    advanceText(P);
    if ((yield* askYesNo(P, ACTOR_VARSITY_COURT_A_KEVIN)) === 0) return yield* courtNpc03NotNowA(P);   // .done
  } else yield* gesture(P, ACTOR_VARSITY_COURT_A_KEVIN, ANIM_NOD);
  yield* setText(P, Text_30_548);
  setAnim(P, ACTOR_VARSITY_COURT_A_KEVIN, ANIM_NOD);
  yield* waitIdle(P, ACTOR_VARSITY_COURT_A_KEVIN);
  yield* speak(P, ACTOR_VARSITY_COURT_A_KEVIN);
  goToLocation(P, STORYLOC_COURTYARD, 0x0D);
  nullScript(P, ACTOR_VARSITY_COURT_A_BETH);
  setSpeed(P, ACTOR_PLAYER, 1.0);
  setSpeed(P, ACTOR_PARTNER, 1.0);
  setSpeed(P, ACTOR_VARSITY_COURT_A_BETH, 0.75);
  setActorScript(P, ACTOR_VARSITY_COURT_A_BOB, ActorScript_13_12);
  setActorScript(P, ACTOR_PLAYER, ActorScript_13_16);
  setActorScript(P, ACTOR_VARSITY_COURT_A_BETH, ActorScript_13_08);
  setActorScript(P, ACTOR_VARSITY_COURT_A_KEVIN, ActorScript_13_04);
  setActorScript(P, ACTOR_VARSITY_COURT_A_FAY, ActorScript_13_05);
  setActorScript(P, ACTOR_VARSITY_COURT_A_CURT, ActorScript_13_06);
  yield* movePlayer(P, 12.0, 27.0);
  yield* waitPlayerMove(P);
  yield* waitActorScript(P, ACTOR_VARSITY_COURT_A_BOB);
  yield* playStoryMatch(P, MATCHLIST_SINGLES, STORYMATCH_VARSITY_4);
}
// VarsityCourtANpc03_13.stage3 (13:6DF5): declined, his line
function* courtNpc03DeclinedA(P) { yield* speak(P, ACTOR_VARSITY_COURT_A_KEVIN); }
// VarsityCourtANpc03_13.done (13:6E17): not now: his line, Bob back to his place
function* courtNpc03NotNowA(P) {
  yield* speak(P, ACTOR_VARSITY_COURT_A_KEVIN);
  yield* returnVarsityCourtANpc04ToSpawn(P);
}

export function* varsityCourtBNpc03FaceUp(P) {
  setSpeed(P, ACTOR_PLAYER, 0.25);
  lockFacing(P, ACTOR_PLAYER);
  moveTarget(P, ACTOR_PLAYER, 13.0, 31.0);
  yield* waitMove(P, ACTOR_PLAYER);
  unlockFacing(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* varsityCourtBNpc03(P);
}

// VarsityCourtBNpc03_13 (13:6E4D): the same at court B (doubles: Bob and Mark; the rank-2 doubles match)
export function* varsityCourtBNpc03(P) {
  nullScript(P, ACTOR_PARTNER);
  yield* setText(P, Text_31_12);
  if ((yield* askYesNo(P, ACTOR_VARSITY_COURT_B_KEVIN)) !== 0) return yield* courtNpc03DeclinedB(P);   // .stage3
  advanceText(P);
  setSpeed(P, ACTOR_PLAYER, 0.5);
  setSpeed(P, ACTOR_PARTNER, 0.5);
  moveTarget(P, ACTOR_PARTNER, 13.0, 33.0);
  moveTarget(P, ACTOR_PLAYER, 13.0, 31.0);
  yield* waitMove(P, ACTOR_PLAYER);
  faceToward(P, ACTOR_VARSITY_COURT_B_KEVIN, ACTOR_PLAYER);
  yield* waitMove(P, ACTOR_PARTNER);
  faceToward(P, ACTOR_VARSITY_COURT_B_KEVIN, ACTOR_PARTNER);
  yield* wait(P, 30);
  setSpeed(P, ACTOR_PLAYER, 1.0);
  setSpeed(P, ACTOR_PARTNER, 1.0);
  faceToward(P, ACTOR_PLAYER, ACTOR_VARSITY_COURT_B_KEVIN);
  yield* speak(P, ACTOR_VARSITY_COURT_B_KEVIN);
  yield* wait(P, 15);
  faceToward(P, ACTOR_VARSITY_COURT_B_BOB, ACTOR_VARSITY_COURT_B_KEVIN);
  yield* wait(P, 30);
  faceToward(P, ACTOR_VARSITY_COURT_B_MARK, ACTOR_PLAYER);
  faceToward(P, ACTOR_VARSITY_COURT_B_BOB, ACTOR_PARTNER);
  yield* wait(P, 30);
  playerSpeed(P, 1.0);
  yield* movePlayerToActor(P, ACTOR_VARSITY_COURT_B_BOB);
  yield* waitPlayerMove(P);
  faceToward(P, ACTOR_PLAYER, ACTOR_VARSITY_COURT_B_BOB);
  faceToward(P, ACTOR_PLAYER, ACTOR_VARSITY_COURT_B_MARK);
  setAnim(P, ACTOR_VARSITY_COURT_B_BOB, ANIM_NOD);
  yield* waitIdle(P, ACTOR_VARSITY_COURT_B_BOB);
  moveTarget(P, ACTOR_VARSITY_COURT_B_BOB, 11.0, 33.0);
  moveTarget(P, ACTOR_VARSITY_COURT_B_MARK, 11.0, 31.0);
  yield* movePlayerToActor(P, ACTOR_PLAYER);
  yield* wait(P, 15);
  face(P, ACTOR_VARSITY_COURT_B_KEVIN, FACE_DOWN);
  yield* wait(P, 15);
  yield* waitMove(P, ACTOR_VARSITY_COURT_B_BOB);
  face(P, ACTOR_VARSITY_COURT_B_BOB, FACE_UP);
  face(P, ACTOR_VARSITY_COURT_B_MARK, FACE_UP);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, ACTOR_PARTNER, FACE_UP);
  yield* wait(P, 15);
  setAnim(P, ACTOR_VARSITY_COURT_B_KEVIN, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_VARSITY_COURT_B_KEVIN);
  if ((yield* askYesNo(P, ACTOR_VARSITY_COURT_B_KEVIN)) !== 0) {      // .speak: another question
    advanceText(P);
    if ((yield* askYesNo(P, ACTOR_VARSITY_COURT_B_KEVIN)) === 0) return yield* courtNpc03NotNowB(P);   // .done
  } else yield* gesture(P, ACTOR_VARSITY_COURT_B_KEVIN, ANIM_NOD);
  yield* setText(P, Text_31_16);
  setAnim(P, ACTOR_VARSITY_COURT_B_KEVIN, ANIM_NOD);
  yield* waitIdle(P, ACTOR_VARSITY_COURT_B_KEVIN);
  yield* speak(P, ACTOR_VARSITY_COURT_B_KEVIN);
  goToLocation(P, STORYLOC_COURTYARD, 0x0D);
  setSpeed(P, ACTOR_PLAYER, 1.0);
  setSpeed(P, ACTOR_PARTNER, 1.0);
  setActorScript(P, ACTOR_VARSITY_COURT_B_BOB, ActorScript_13_13);
  setActorScript(P, ACTOR_VARSITY_COURT_B_MARK, ActorScript_13_14);
  setActorScript(P, ACTOR_PLAYER, ActorScript_13_16);
  setActorScript(P, ACTOR_PARTNER, ActorScript_13_15);
  nullScript(P, ACTOR_VARSITY_COURT_B_BETH);
  setSpeed(P, ACTOR_VARSITY_COURT_B_BETH, 0.75);
  setActorScript(P, ACTOR_VARSITY_COURT_B_KEVIN, ActorScript_13_04);
  setActorScript(P, ACTOR_VARSITY_COURT_B_FAY, ActorScript_13_05);
  setActorScript(P, ACTOR_VARSITY_COURT_B_CURT, ActorScript_13_07);
  setActorScript(P, ACTOR_VARSITY_COURT_B_BETH, ActorScript_13_09);
  yield* movePlayer(P, 12.0, 27.0);
  yield* waitPlayerMove(P);
  yield* waitActorScript(P, ACTOR_VARSITY_COURT_B_BOB);
  yield* playStoryMatch(P, MATCHLIST_DOUBLES, STORYMATCH_VARSITY_2);
}
// VarsityCourtBNpc03_13.stage3 (13:707D): declined, his line; the partner follows again
function* courtNpc03DeclinedB(P) {
  yield* speak(P, ACTOR_VARSITY_COURT_B_KEVIN);
  followPlayer(P, ACTOR_PARTNER);
}
// VarsityCourtBNpc03_13.done (13:70AC): not now: his line, Bob and Mark back to their places, the partner follows
function* courtNpc03NotNowB(P) {
  yield* speak(P, ACTOR_VARSITY_COURT_B_KEVIN);
  yield* returnVarsityCourtBNpcsToSpawn(P);
  yield* wait(P, 60);
  followPlayer(P, ACTOR_PARTNER);
}

// ReturnVarsityCourtANpc04ToSpawn_13 (13:70C9) / ReturnVarsityCourtBNpcsToSpawn_13 (13:70D5): their walks back
export function* returnVarsityCourtANpc04ToSpawn(P) {
  setActorScript(P, ACTOR_VARSITY_COURT_A_BOB, ActorScript_13_17);
}

export function* returnVarsityCourtBNpcsToSpawn(P) {
  setActorScript(P, ACTOR_VARSITY_COURT_B_BOB, ActorScript_13_18);
  setActorScript(P, ACTOR_VARSITY_COURT_B_MARK, ActorScript_13_19);
}

// Unused_13_RunSinglesTravelingTeamVictoryIfWon (13:70EC) / Unused_13_RunDoublesTravelingTeamVictoryIfWon
// (13:7440): (WRAM 4 mapped) the victory cutscene after a won match (nothing calls them)
export function* unused_13_RunSinglesTravelingTeamVictoryIfWon(P) {
  P.wramBank(WRAM_ACTORS);
  if (P.V.matchWinLoseFlag === WINLOSE_WIN) yield* singlesTravelingTeamVictoryCutscene(P);
}

// SinglesTravelingTeamVictoryCutscene (13:70FB): (WRAM 6 mapped) the traveling team welcomes the player: Bob,
// the partner-to-be Kate (her lines by the partner's gender), Mark, Emily, Kevin; faded out, the team's screens
// (by the player's gender), then the main menu (entry $0A)
export function* singlesTravelingTeamVictoryCutscene(P) {
  P.wramBank(WRAM_SCENE);
  respawnActors(P, SinglesTravelingTeamActors_13);
  nullScript(P, ACTOR_PLAYER_SHADOW);
  playerSpeed(P, 2.0);
  applyPartnerCharacterVariant(P);
  setPosition(P, ACTOR_PLAYER, 11.0, 29.0);
  setPosition(P, ACTOR_PARTNER, 13.0, 35.0);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, ACTOR_PARTNER, FACE_UP);
  yield* movePlayer(P, 11.0, 17.0);
  yield* waitPlayerMove(P);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  yield* wait(P, 60);
  yield* setText(P, Text_30_554);
  playerSpeed(P, 1.0);
  yield* movePlayer(P, 11.0, 23.0);
  yield* waitPlayerMove(P);
  moveTarget(P, ACTOR_SINGLES_TRAVELING_TEAM_BOB, 11.0, 23.0);
  yield* waitMove(P, ACTOR_SINGLES_TRAVELING_TEAM_BOB);
  yield* speak(P, ACTOR_SINGLES_TRAVELING_TEAM_BOB);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* speak(P, ACTOR_SINGLES_TRAVELING_TEAM_KATE);
  setPosition(P, ACTOR_SINGLES_TRAVELING_TEAM_BALLOON_QUESTION, 12.25, 27.75);
  sound(P, SFX_EMOTE);
  yield* wait(P, 40);
  setPosition(P, ACTOR_SINGLES_TRAVELING_TEAM_BALLOON_QUESTION, 63.0, 63.0);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  yield* movePlayerToActor(P, ACTOR_SINGLES_TRAVELING_TEAM_KATE);
  yield* waitPlayerMove(P);
  yield* wait(P, 40);
  yield* movePlayerToActor(P, ACTOR_PLAYER);
  setActorScript(P, ACTOR_SINGLES_TRAVELING_TEAM_EMILY, ActorScript_13_21);
  setActorScript(P, ACTOR_SINGLES_TRAVELING_TEAM_MARK, ActorScript_13_25);
  setActorScript(P, ACTOR_SINGLES_TRAVELING_TEAM_KATE, ActorScript_13_24);
  yield* wait(P, 10);
  setActorScript(P, ACTOR_SINGLES_TRAVELING_TEAM_KEVIN, ActorScript_13_23);
  yield* waitPlayerMove(P);
  yield* waitActorScript(P, ACTOR_SINGLES_TRAVELING_TEAM_KEVIN);
  faceToward(P, ACTOR_PLAYER, ACTOR_SINGLES_TRAVELING_TEAM_KATE);
  const variantA = testFlag(P, FLAG_TEMP_SCENE_VARIANT_A);   // (a boy partner-to-be: her other lines)
  if (variantA) advanceText(P);
  setAnim(P, ACTOR_SINGLES_TRAVELING_TEAM_KATE, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_SINGLES_TRAVELING_TEAM_KATE);
  yield* speak(P, ACTOR_SINGLES_TRAVELING_TEAM_KATE);
  faceToward(P, ACTOR_SINGLES_TRAVELING_TEAM_KATE, ACTOR_PLAYER);
  setAnim(P, ACTOR_SINGLES_TRAVELING_TEAM_KATE, ANIM_NOD);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  if (!variantA) advanceText(P);                          // (.variantB)
  face(P, ACTOR_SINGLES_TRAVELING_TEAM_MARK, FACE_DOWN);
  setAnim(P, ACTOR_SINGLES_TRAVELING_TEAM_MARK, ANIM_SHAKE);
  yield* waitIdle(P, ACTOR_SINGLES_TRAVELING_TEAM_MARK);
  face(P, ACTOR_SINGLES_TRAVELING_TEAM_MARK, FACE_RIGHT);
  faceToward(P, ACTOR_SINGLES_TRAVELING_TEAM_MARK, ACTOR_PLAYER);
  yield* speak(P, ACTOR_SINGLES_TRAVELING_TEAM_MARK);
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 20);
  moveTarget(P, ACTOR_SINGLES_TRAVELING_TEAM_EMILY, 10.0, 31.0);
  yield* waitMove(P, ACTOR_SINGLES_TRAVELING_TEAM_EMILY);
  yield* wait(P, 20);
  faceToward(P, ACTOR_SINGLES_TRAVELING_TEAM_EMILY, ACTOR_PLAYER);
  faceToward(P, ACTOR_SINGLES_TRAVELING_TEAM_EMILY, ACTOR_SINGLES_TRAVELING_TEAM_KATE);
  yield* wait(P, 20);
  setAnim(P, ACTOR_SINGLES_TRAVELING_TEAM_EMILY, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SINGLES_TRAVELING_TEAM_EMILY);
  yield* speak(P, ACTOR_SINGLES_TRAVELING_TEAM_EMILY);
  yield* wait(P, 20);
  moveTarget(P, ACTOR_SINGLES_TRAVELING_TEAM_KEVIN, 12.0, 31.0);
  yield* waitMove(P, ACTOR_SINGLES_TRAVELING_TEAM_KEVIN);
  yield* wait(P, 20);
  setAnim(P, ACTOR_SINGLES_TRAVELING_TEAM_KEVIN, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_SINGLES_TRAVELING_TEAM_KEVIN);
  yield* speak(P, ACTOR_SINGLES_TRAVELING_TEAM_KEVIN);
  setAnim(P, ACTOR_SINGLES_TRAVELING_TEAM_KATE, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_SINGLES_TRAVELING_TEAM_KATE);
  faceToward(P, ACTOR_PLAYER, ACTOR_SINGLES_TRAVELING_TEAM_KATE);
  if (testFlag(P, FLAG_TEMP_SCENE_VARIANT_A)) {
    advanceText(P);
  }
  yield* speak(P, ACTOR_SINGLES_TRAVELING_TEAM_KATE);
  faceToward(P, ACTOR_SINGLES_TRAVELING_TEAM_KATE, ACTOR_PLAYER);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 10);
  faceToward(P, ACTOR_SINGLES_TRAVELING_TEAM_EMILY, ACTOR_PLAYER);
  yield* wait(P, 10);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* fadeOutAndWait(P, 2);
  yield* P.runRom(...RunStorySceneByMode, { b: SCENE_MODE_TEAM, c: (P.V.storyModeGenderOfMainCharacter + 0x04) & 0xFF });
  goToLocation(P, STORYLOC_MAIN_MENU, 0x0A);
}

export function* unused_13_RunDoublesTravelingTeamVictoryIfWon(P) {
  P.wramBank(WRAM_ACTORS);
  if (P.V.matchWinLoseFlag === WINLOSE_WIN) yield* doublesTravelingTeamVictoryCutscene(P);
}

// DoublesTravelingTeamVictoryCutscene (13:744F): the same for the pair (the partner's reactions by gender)
export function* doublesTravelingTeamVictoryCutscene(P) {
  yield* setText(P, Text_31_22);
  respawnActors(P, DoublesTravelingTeamActors_13);
  beginCutscene(P);
  applyPartnerCharacterVariant(P);
  nullScript(P, ACTOR_PARTNER);
  nullScript(P, ACTOR_PLAYER_SHADOW);
  playerSpeed(P, 2.0);
  setPosition(P, ACTOR_PLAYER, 11.0, 29.0);
  setPosition(P, ACTOR_PARTNER, 13.0, 35.0);
  face(P, ACTOR_PLAYER, FACE_UP);
  face(P, ACTOR_PARTNER, FACE_UP);
  yield* movePlayer(P, 11.0, 17.0);
  yield* waitPlayerMove(P);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  yield* wait(P, 60);
  playerSpeed(P, 1.0);
  yield* movePlayer(P, 11.0, 23.0);
  yield* waitPlayerMove(P);
  moveTarget(P, ACTOR_PARTNER, 13.0, 29.0);
  moveTarget(P, ACTOR_DOUBLES_TRAVELING_TEAM_MARK, 11.0, 23.0);
  yield* waitMove(P, ACTOR_DOUBLES_TRAVELING_TEAM_MARK);
  setAnim(P, ACTOR_DOUBLES_TRAVELING_TEAM_MARK, ANIM_SHAKE);
  yield* waitIdle(P, ACTOR_DOUBLES_TRAVELING_TEAM_MARK);
  yield* speak(P, ACTOR_DOUBLES_TRAVELING_TEAM_MARK);
  setAnim(P, ACTOR_DOUBLES_TRAVELING_TEAM_BOB, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_DOUBLES_TRAVELING_TEAM_BOB);
  yield* speak(P, ACTOR_DOUBLES_TRAVELING_TEAM_BOB);
  setAnim(P, ACTOR_PARTNER, ANIM_NOD);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  faceToward(P, ACTOR_PLAYER, ACTOR_PARTNER);
  yield* wait(P, 30);
  setAnim(P, ACTOR_PARTNER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PARTNER);
  if (testFlag(P, FLAG_TEMP_SCENE_VARIANT_A)) {      // a boy partner
    yield* setText(P, Text_31_26);
    yield* speak(P, ACTOR_PARTNER);
    faceToward(P, ACTOR_PARTNER, ACTOR_PLAYER);
    setAnim(P, ACTOR_PARTNER, ANIM_BOUNCE);
    yield* waitIdle(P, ACTOR_PARTNER);
    yield* speak(P, ACTOR_PARTNER);
    face(P, ACTOR_PLAYER, FACE_LEFT);
    setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
    setPosition(P, ACTOR_DOUBLES_TRAVELING_TEAM_BALLOON_SWEAT, 12.0, 27.5);
    sound(P, SFX_APPEAR2);
    yield* wait(P, 40);
    setPosition(P, ACTOR_DOUBLES_TRAVELING_TEAM_BALLOON_SWEAT, 63.0, 63.0);
    faceToward(P, ACTOR_PARTNER, ACTOR_PLAYER);
    yield* wait(P, 10);
    lockFacing(P, ACTOR_PLAYER);
    yield* wait(P, 10);
    moveAngle(P, ACTOR_PLAYER, FACE_RIGHT, 1.0);
    yield* waitMove(P, ACTOR_PLAYER);
    setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
    yield* waitIdle(P, ACTOR_PLAYER);
    moveAngle(P, ACTOR_PLAYER, FACE_LEFT, 1.0);
    yield* waitMove(P, ACTOR_PLAYER);
    P.bus.w8((actorState(P, ACTOR_PARTNER) + ACTOR_RECORD_BYTE_18) & 0xFFFF, 0x04);
    setAnim(P, ACTOR_PARTNER, ANIM_BOUNCE);
    yield* waitIdle(P, ACTOR_PARTNER);
    face(P, ACTOR_PARTNER, FACE_UP);
    setAnim(P, ACTOR_PARTNER, ANIM_BOUNCE);
    yield* waitIdle(P, ACTOR_PARTNER);
    setAnim(P, ACTOR_PARTNER, ANIM_BOUNCE);
    yield* waitIdle(P, ACTOR_PARTNER);
    face(P, ACTOR_PARTNER, FACE_DOWN);
    setAnim(P, ACTOR_PARTNER, ANIM_BOUNCE);
    yield* waitIdle(P, ACTOR_PARTNER);
    face(P, ACTOR_PARTNER, FACE_UP);
    setAnim(P, ACTOR_PARTNER, ANIM_BOUNCE);
    yield* waitIdle(P, ACTOR_PARTNER);
    setAnim(P, ACTOR_PARTNER, ANIM_BOUNCE);
    yield* waitIdle(P, ACTOR_PARTNER);
    P.bus.w8((actorState(P, ACTOR_PARTNER) + ACTOR_RECORD_BYTE_18) & 0xFFFF, 0x01);
    face(P, ACTOR_PARTNER, FACE_LEFT);
    yield* wait(P, 20);
    setAnim(P, ACTOR_PARTNER, ANIM_NOD);
    yield* waitIdle(P, ACTOR_PARTNER);
    yield* wait(P, 20);
    setAnim(P, ACTOR_PLAYER, ANIM_NOD);
    yield* waitIdle(P, ACTOR_PLAYER);
  } else {                                             // .variantB
    yield* setText(P, Text_31_24);
    yield* speak(P, ACTOR_PARTNER);
    setAnim(P, ACTOR_PARTNER, ANIM_BOUNCE);
    yield* waitIdle(P, ACTOR_PARTNER);
    yield* speak(P, ACTOR_PARTNER);
    faceToward(P, ACTOR_PARTNER, ACTOR_PLAYER);
    setPosition(P, ACTOR_DOUBLES_TRAVELING_TEAM_BALLOON_SWEAT, 12.0, 27.5);
    sound(P, SFX_APPEAR2);
    yield* wait(P, 40);
    setPosition(P, ACTOR_DOUBLES_TRAVELING_TEAM_BALLOON_SWEAT, 63.0, 63.0);
    yield* wait(P, 10);
    lockFacing(P, ACTOR_PLAYER);
    yield* wait(P, 10);
    moveAngle(P, ACTOR_PLAYER, FACE_RIGHT, 1.0);
    yield* waitMove(P, ACTOR_PLAYER);
    setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
    yield* waitIdle(P, ACTOR_PLAYER);
    moveAngle(P, ACTOR_PLAYER, FACE_LEFT, 1.0);
    yield* waitMove(P, ACTOR_PLAYER);
    P.bus.w8((actorState(P, ACTOR_PARTNER) + ACTOR_RECORD_BYTE_18) & 0xFFFF, 0x03);
    setAnim(P, ACTOR_PARTNER, ANIM_BOUNCE);
    yield* waitIdle(P, ACTOR_PARTNER);
    face(P, ACTOR_PARTNER, FACE_DOWN);
    setAnim(P, ACTOR_PARTNER, ANIM_BOUNCE);
    yield* waitIdle(P, ACTOR_PARTNER);
    yield* wait(P, 40);
    setAnim(P, ACTOR_PARTNER, ANIM_BOUNCE);
    yield* waitIdle(P, ACTOR_PARTNER);
    P.bus.w8((actorState(P, ACTOR_PARTNER) + ACTOR_RECORD_BYTE_18) & 0xFFFF, 0x01);
    face(P, ACTOR_PARTNER, FACE_LEFT);
    yield* wait(P, 20);
    setAnim(P, ACTOR_PARTNER, ANIM_NOD);
    yield* waitIdle(P, ACTOR_PARTNER);
    yield* wait(P, 20);
    setAnim(P, ACTOR_PLAYER, ANIM_NOD);
    yield* waitIdle(P, ACTOR_PLAYER);
  }
  yield* setText(P, Text_31_28);
  yield* wait(P, 20);
  yield* speak(P, ACTOR_DOUBLES_TRAVELING_TEAM_EMILY);
  unlockFacing(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  face(P, ACTOR_PARTNER, FACE_RIGHT);
  setActorScript(P, ACTOR_DOUBLES_TRAVELING_TEAM_EMILY, ActorScript_13_21);
  setActorScript(P, ACTOR_DOUBLES_TRAVELING_TEAM_KEVIN, ActorScript_13_22);
  yield* wait(P, 20);
  setActorScript(P, ACTOR_DOUBLES_TRAVELING_TEAM_MARK, ActorScript_13_26);
  yield* movePlayer(P, 11.0, 29.0);
  yield* waitPlayerMove(P);
  yield* waitActorScript(P, ACTOR_DOUBLES_TRAVELING_TEAM_MARK);
  faceToward(P, ACTOR_PLAYER, ACTOR_DOUBLES_TRAVELING_TEAM_MARK);
  faceToward(P, ACTOR_DOUBLES_TRAVELING_TEAM_KEVIN, ACTOR_PARTNER);
  setAnim(P, ACTOR_DOUBLES_TRAVELING_TEAM_MARK, ANIM_SHAKE);
  yield* waitIdle(P, ACTOR_DOUBLES_TRAVELING_TEAM_MARK);
  faceToward(P, ACTOR_DOUBLES_TRAVELING_TEAM_MARK, ACTOR_PLAYER);
  yield* speak(P, ACTOR_DOUBLES_TRAVELING_TEAM_MARK);
  moveTarget(P, ACTOR_DOUBLES_TRAVELING_TEAM_EMILY, 10.0, 31.0);
  yield* waitMove(P, ACTOR_DOUBLES_TRAVELING_TEAM_EMILY);
  faceToward(P, ACTOR_DOUBLES_TRAVELING_TEAM_EMILY, ACTOR_PLAYER);
  faceToward(P, ACTOR_DOUBLES_TRAVELING_TEAM_KEVIN, ACTOR_PARTNER);
  setAnim(P, ACTOR_DOUBLES_TRAVELING_TEAM_EMILY, ANIM_NOD);
  yield* waitIdle(P, ACTOR_DOUBLES_TRAVELING_TEAM_EMILY);
  yield* speak(P, ACTOR_DOUBLES_TRAVELING_TEAM_EMILY);
  moveTarget(P, ACTOR_DOUBLES_TRAVELING_TEAM_KEVIN, 12.0, 31.0);
  yield* waitMove(P, ACTOR_DOUBLES_TRAVELING_TEAM_KEVIN);
  setAnim(P, ACTOR_DOUBLES_TRAVELING_TEAM_KEVIN, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_DOUBLES_TRAVELING_TEAM_KEVIN);
  yield* speak(P, ACTOR_DOUBLES_TRAVELING_TEAM_KEVIN);
  faceToward(P, ACTOR_PLAYER, ACTOR_PARTNER);
  setAnim(P, ACTOR_PARTNER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PARTNER);
  if (testFlag(P, FLAG_TEMP_SCENE_VARIANT_A)) {
    advanceText(P);
  }
  yield* speak(P, ACTOR_PARTNER);
  faceToward(P, ACTOR_PARTNER, ACTOR_PLAYER);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 10);
  faceToward(P, ACTOR_DOUBLES_TRAVELING_TEAM_EMILY, ACTOR_PLAYER);
  faceToward(P, ACTOR_DOUBLES_TRAVELING_TEAM_KEVIN, ACTOR_PARTNER);
  yield* wait(P, 10);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  setAnim(P, ACTOR_PARTNER, ANIM_NOD);
  yield* fadeOutAndWait(P, 2);
  yield* playDoublesTravelingTeamScreenSequence(P);
  goToLocation(P, STORYLOC_MAIN_MENU, 0x0A);
}

// PlayDoublesTravelingTeamScreenSequence_13 (13:78C4): the team's screens for the pair (c: the player's gender
// in bit 1, whether the partner's differs in bit 0)
export function* playDoublesTravelingTeamScreenSequence(P) {
  const main = P.V.storyModeGenderOfMainCharacter, c = ((main << 1) | (P.V.storyModeGenderOfPartnerCharacter ^ main)) & 0xFF;
  yield* P.runRom(...RunStorySceneByMode, { b: SCENE_MODE_TEAM, c, d: main });
}

// Unused_13_DoublesTravelingTeamInitScript (13:797B): the junior and senior titles (singles and doubles) set
export function* unused_13_DoublesTravelingTeamInitScript(P) {
  setFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_1);
  setFlag(P, FLAG_WON_SENIOR_SINGLES_RANK_1);
  setFlag(P, FLAG_WON_JUNIOR_DOUBLES_RANK_1);
  setFlag(P, FLAG_WON_SENIOR_DOUBLES_RANK_1);
}

export const HOOKS = [
  scene(BANK, 0x6C13, varsityCourtANpc03FaceUp),
  scene(BANK, 0x6C40, varsityCourtANpc03),
  scene(BANK, 0x6E20, varsityCourtBNpc03FaceUp),
  scene(BANK, 0x6E4D, varsityCourtBNpc03),
  scene(BANK, 0x70C9, returnVarsityCourtANpc04ToSpawn),
  scene(BANK, 0x70D5, returnVarsityCourtBNpcsToSpawn),
  scene(BANK, 0x70EC, unused_13_RunSinglesTravelingTeamVictoryIfWon),
  scene(BANK, 0x70FB, singlesTravelingTeamVictoryCutscene),
  scene(BANK, 0x7440, unused_13_RunDoublesTravelingTeamVictoryIfWon),
  scene(BANK, 0x744F, doublesTravelingTeamVictoryCutscene),
  scene(BANK, 0x78C4, playDoublesTravelingTeamScreenSequence),
  scene(BANK, 0x797B, unused_13_DoublesTravelingTeamInitScript),
];
