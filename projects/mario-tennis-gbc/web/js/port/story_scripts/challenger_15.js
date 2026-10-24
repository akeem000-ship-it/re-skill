// The training court's challengers after their matches (bank $15, $5D74-$6253): the net and stroke challengers'
// result scenes (the party placed, then by wPointWinLoseFlag: won, lost, drawn, or for the stroke match the
// player's jump for joy), the serve challenger's three matches' texts, the challenger's lines and question (play
// again: the drill again; no: the challenger walks onto its court), and its walk away once beaten. The challenger
// is the actor in wMapSceneStage2; its texts are kept in wChallenger*TextId.
// Port of src/story/challenger_15.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss1_coach*.mtrec (scripted: the challengers' results).
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FACE_DOWN, FACE_LEFT, FACE_RIGHT, FACE_UP, ANIM_BOUNCE,
  testFlag, setFlag, rd, rd16, wr16, setText, advanceText, speak, speakRestore, yesNo, closeDialogue, wait, setAnim,
  waitIdle, face, setPosition, setPositionRaw, moveTarget, moveTargetRaw, moveAngleRaw, waitMove, waitJump,
  jumpVelocity, setSpeed, playerSpeed, movePlayer, waitPlayerMove, nullScript, lockFacing, unlockFacing,
  followPlayer, actorState, fadeInAndWait, goToLocation, endCutscene, jumpTableTarget, scene,
} from "./common.js";
import { runTrainingDrill, STORYLOC_TRAINING_COURT } from "./coach_walks_15.js";

const BANK = 0x15;
const FLAG_SERVE_CHALLENGER_DEFEATED = 0xBA, FLAG_NET_CHALLENGER_DEFEATED = 0xBB;
const FLAG_STROKE_CHALLENGER_DEFEATED = 0xBC, FLAG_WON_JUNIOR_SINGLES_RANK_1 = 0x53;
const Text_6e_29 = 0x201D, Text_6e_32 = 0x2020, Text_6e_34 = 0x2022, Text_6e_35 = 0x2023, Text_6e_36 = 0x2024;  // (34, 35: raw ids in the disassembly)
const Text_6e_49 = 0x2031, Text_6e_50 = 0x2032, Text_6e_61 = 0x203D, Text_6e_62 = 0x203E, Text_6e_74 = 0x204A;
const Text_6e_120 = 0x2078;
const ACTOR_RECORD_BYTE_18 = 0x18;                      // a byte of the actor record the disassembly leaves unnamed
const NET_CHALLENGER = 0x11, STROKE_CHALLENGER = 0x0C;  // their slots (wMapSceneStage2)
// the challenge's drill (wCurrentMinigameStoryMatch + 1): below 4 the serve matches, below $0A the net games
const FIRST_NET_MATCH = 0x04, FIRST_STROKE_MATCH = 0x0A;
// serve_coach_15.asm and water_15.asm (not ported here)
const ServeChallengerResultScene = 0x5CF3, MovePlayerToLessonCourtSpot = 0x6253;
const ResultTable = { net: 0x5DEC, stroke: 0x5E6B };    // the rst $00 tables after the two result scenes

const challenger = P => P.V.mapSceneStage2;
const drill = P => rd(P, "currentMinigameStoryMatch", 1);

// the party placed for the result: the player at (px, 42) facing up, the challenger at (cx, 37) facing down, the
// partner (its script detached) at (qx, 45) facing qFace; the player steps up to (px, py); a fade in
function* placeForResult(P, slot, px, py, cx, qx, qFace) {
  P.V.storyModeShowLocationName = 0;
  P.V.mapSceneStage2 = slot;
  setPosition(P, ACTOR_PLAYER, px, 42.0);
  face(P, ACTOR_PLAYER, FACE_UP);
  setPositionRaw(P, challenger(P), cx << 8, 0x2500);
  face(P, challenger(P), FACE_DOWN);
  nullScript(P, ACTOR_PARTNER);
  setPosition(P, ACTOR_PARTNER, qx, 45.0);
  face(P, ACTOR_PARTNER, qFace);
  playerSpeed(P, 7.5);
  yield* movePlayer(P, px, py);
  yield* waitPlayerMove(P);
  yield* fadeInAndWait(P, 8);
}
// .dispatch: by wPointWinLoseFlag + 1 through the scene's table (a loss, flag 0, also leaves loseText in
// wUnusedChallengerLoseTextId); an index past the table is the ROM's jump
function* dispatchResult(P, table, loseText) {
  const index = (P.V.pointWinLoseFlag + 1) & 0xFF;
  if (index === 0x01) wr16(P, "unusedChallengerLoseTextId", loseText);
  const target = jumpTableTarget(P, BANK, table, index);
  const scenes = { 0x5F58: challengerResultFinish, 0x5F07: challengerResultLose, 0x5FC2: challengerResultDraw,
    0x5E74: challengerResultJumpForJoy };
  if (scenes[target]) return yield* scenes[target](P);
  yield* P.runRom(BANK, target);
}
// NetChallengerResultScene (15:5D74): Brian's (slot $11) court
export function* netChallengerResultScene(P) {
  yield* placeForResult(P, NET_CHALLENGER, 40.0, 41.0, 0x28, 45.0, FACE_LEFT);
  yield* dispatchResult(P, ResultTable.net, Text_6e_74);
}
// StrokeChallengerResultScene (15:5DF3): Allie's (slot $0C) court
export function* strokeChallengerResultScene(P) {
  yield* placeForResult(P, STROKE_CHALLENGER, 24.0, 40.0, 0x18, 19.0, FACE_RIGHT);
  yield* dispatchResult(P, ResultTable.stroke, Text_6e_120);
}
// ChallengerResultJumpForJoy (15:5E74): the player's jump, then the won scene
export function* challengerResultJumpForJoy(P) {
  jumpVelocity(P, ACTOR_PLAYER, -3.0);
  yield* waitJump(P, ACTOR_PLAYER);
  yield* challengerResultFinish(P);
}

// ServiceMatch1ResultScene (15:5E85) / 2 (15:5EB7) / 3 (15:5EDF): the serve challenger's texts for the match
// (the win line of match 1 by whether the junior singles are won), then ServeChallengerResultScene (15:5CF3)
function* serviceMatchResult(P, win, draw) {
  wr16(P, "challengerFollowupTextId", Text_6e_32);
  wr16(P, "challengerLoseTextId", Text_6e_29);
  wr16(P, "challengerWinTextId", win);
  wr16(P, "challengerDrawTextId", draw);
  yield* P.runRom(BANK, ServeChallengerResultScene);
}
export const serviceMatch1ResultScene = P => serviceMatchResult(P,
  testFlag(P, FLAG_WON_JUNIOR_SINGLES_RANK_1) ? Text_6e_35 : Text_6e_34, Text_6e_36);   // (.celebrateWait/Loop)
export const serviceMatch2ResultScene = P => serviceMatchResult(P, Text_6e_49, Text_6e_50);
export const serviceMatch3ResultScene = P => serviceMatchResult(P, Text_6e_61, Text_6e_62);

// the challenger's question on text: true for a yes (speak_restore, the prompt, the window closed, 5 frames)
function* challengerAsks(P, text) {
  yield* setText(P, text);
  yield* speakRestore(P, challenger(P));
  const choice = yield* yesNo(P);
  yield* closeDialogue(P);
  yield* wait(P, 5);
  return choice === 0;
}
// a yes: back to the training court (entry $0A) after the drill again
function* playAgain(P) {
  goToLocation(P, STORYLOC_TRAINING_COURT, 0x0A);
  yield* runTrainingDrill(P, drill(P));
  endCutscene(P);
}
// ChallengerResultLose (15:5F07): the player lost: the challenger offers another try
export function* challengerResultLose(P) {
  if (yield* challengerAsks(P, rd16(P, "challengerLoseTextId"))) {
    yield* speak(P, challenger(P));
    return yield* playAgain(P);
  }
  advanceText(P);                                       // .loseSpeak
  yield* speak(P, challenger(P));
  yield* walkChallengerOntoCourt(P);
  endCutscene(P);
}
// ChallengerResultFinish (15:5F58): the player won (or drew the serve match): the challenger asks again; the
// follow-up line either way (the next one for a no, then the walk onto the court)
export function* challengerResultFinish(P) {
  const yes = yield* challengerAsks(P, rd16(P, "challengerWinTextId"));
  yield* setText(P, rd16(P, "challengerFollowupTextId"));
  if (yes) {
    yield* speak(P, challenger(P));
    return yield* playAgain(P);
  }
  advanceText(P);                                       // .finishDoubles
  yield* speak(P, challenger(P));
  yield* walkChallengerOntoCourt(P);
  endCutscene(P);
}
// ChallengerResultDraw (15:5FC2): the challenger beaten: its bounce and line, two steps back (facing kept), a
// bounce and its last line; it walks away (WalkChallengerAwayDefeated), is put out of sight; the player to the
// lesson court's spot (MovePlayerToLessonCourtSpot, water_15.asm)
export function* challengerResultDraw(P) {
  const c = challenger(P);
  setAnim(P, c, ANIM_BOUNCE);
  yield* waitIdle(P, c);
  yield* setText(P, rd16(P, "challengerDrawTextId"));
  yield* speak(P, c);
  lockFacing(P, c);
  for (let i = 0; i < 2; i++) {
    if (i) yield* wait(P, 40);
    moveAngleRaw(P, c, FACE_UP, 0x0100);
    yield* waitMove(P, c);
  }
  setAnim(P, c, ANIM_BOUNCE);
  yield* waitIdle(P, c);
  yield* speak(P, c);
  unlockFacing(P, c);
  yield* walkChallengerAwayDefeated(P);
  setPositionRaw(P, challenger(P), 0x3F00, 0x3F00);
  yield* P.runRom(BANK, MovePlayerToLessonCourtSpot);
  endCutscene(P);
}
// the challenger's walk: speed 1.5, its byte $18 set to 4, through the points (raw x, y words; the player turns
// down before the point marked), and its defeated flag
function* walkAway(P, points, turnBefore, flag) {
  const c = challenger(P);
  setSpeed(P, c, 1.5);
  P.bus.w8((actorState(P, challenger(P)) + ACTOR_RECORD_BYTE_18) & 0xFFFF, 0x04);
  for (const [i, [x, y]] of points.entries()) {
    if (i === turnBefore) face(P, ACTOR_PLAYER, FACE_DOWN);
    moveTargetRaw(P, challenger(P), x, y);
    yield* waitMove(P, challenger(P));
  }
  setFlag(P, flag);
}
// WalkChallengerAwayDefeated (15:6042): by the drill: the serve challenger, the net challenger, or (from the stroke
// matches) a turn up, two bounces and a line first
export function* walkChallengerAwayDefeated(P) {
  if (drill(P) >= FIRST_STROKE_MATCH) {                 // .done
    const c = challenger(P);
    face(P, c, FACE_UP);
    for (let i = 0; i < 2; i++) {
      setAnim(P, c, ANIM_BOUNCE);
      yield* waitIdle(P, c);
    }
    yield* speak(P, c);
    return yield* walkAway(P, [[0x1F00, 0x2500], [0x1F00, 0x2900], [0x1F00, 0x3500]], 2, FLAG_STROKE_CHALLENGER_DEFEATED);
  }
  if (drill(P) < FIRST_NET_MATCH) {                     // .serveChallenger
    return yield* walkAway(P, [[0x1F00, 0x0B00], [0x1F00, 0x1100], [0x1F00, 0x1F00]], 2, FLAG_SERVE_CHALLENGER_DEFEATED);
  }
  yield* walkAway(P, [[0x2100, 0x2500], [0x1F00, 0x3500]], 1, FLAG_NET_CHALLENGER_DEFEATED);   // .netChallenger
}
// WalkChallengerOntoCourt (15:6179): the challenger back to its court and the player after it (the partner
// following again), by the drill: the north court (stroke), the south one (serve), the east one (net)
export function* walkChallengerOntoCourt(P) {
  if (drill(P) >= FIRST_STROKE_MATCH) {                 // .northCourt
    moveTargetRaw(P, challenger(P), 0x1300, 0x2500);
    yield* waitMove(P, challenger(P));
    moveTargetRaw(P, challenger(P), 0x1300, 0x2700);
    moveTarget(P, ACTOR_PLAYER, 19.0, 43.0);
    yield* waitMove(P, ACTOR_PLAYER);
    followPlayer(P, ACTOR_PARTNER);
    yield* waitMove(P, challenger(P));
    face(P, challenger(P), FACE_DOWN);
    return;
  }
  const [cx, cy, px, py] = drill(P) < FIRST_NET_MATCH
    ? [0x1300, 0x0B00, 19.0, 19.0]                      // .southCourt
    : [0x2D00, 0x2100, 45.0, 43.0];                     // .eastCourt
  moveTargetRaw(P, challenger(P), cx, cy);
  yield* wait(P, 30);
  moveTarget(P, ACTOR_PLAYER, px, py);
  yield* waitMove(P, ACTOR_PLAYER);
  followPlayer(P, ACTOR_PARTNER);
  yield* waitMove(P, challenger(P));
  face(P, challenger(P), FACE_RIGHT);
}

export const HOOKS = [
  scene(BANK, 0x5D74, netChallengerResultScene),
  scene(BANK, 0x5DF3, strokeChallengerResultScene),
  scene(BANK, 0x5E74, challengerResultJumpForJoy),
  scene(BANK, 0x5E85, serviceMatch1ResultScene),
  scene(BANK, 0x5EB7, serviceMatch2ResultScene),
  scene(BANK, 0x5EDF, serviceMatch3ResultScene),
  scene(BANK, 0x5F07, challengerResultLose),
  scene(BANK, 0x5F58, challengerResultFinish),
  scene(BANK, 0x5FC2, challengerResultDraw),
  scene(BANK, 0x6042, walkChallengerAwayDefeated),
  scene(BANK, 0x6179, walkChallengerOntoCourt),
];
