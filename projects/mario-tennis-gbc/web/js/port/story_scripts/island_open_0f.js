// The Island Open's tournament site (bank $0F, $5F7A-$6F17): whether the ceremony's rival scene was seen, the
// site's exit, NPCs, the bracket board (facing action), the step-on cells that call the round, its init script
// (in a round: the round's lists; otherwise the arrival, the match returns, the lists of the rounds reached), the
// frame task that hides the player and partner behind the scene's foreground tiles, the arrival cutscene, the
// round computed from the flags, and the rounds' NPCs.
// The tables (TournamentMapScripts_0f, the rounds' actor and NPC record lists, ActorScript_0f_01/02) are data.
// Port of src/story/island_open_0f.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are; ReadSceneTilemapTile_0f is
// src/twins/read_scene_tilemap_tile.asm (twins.js).
// Recordings: out/port/ss1_island*.mtrec (scripted: the tournament site by round and format).
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FACE_DOWN, FACE_UP, FACE_LEFT, FACE_RIGHT, ANIM_BOUNCE, ANIM_NOD, ANIM_SHAKE,
  WRAM_ACTORS, BANK_SAVE, BEHAVIOR_TRIGGER, FLAG_DOUBLES, STORYENTRY_NONE, testFlag, testFlagF, setFlag, clearFlag,
  setText, advanceText, speak, question, setAnim, waitIdle, wait, face, faceToward, setPosition, moveTarget, waitMove,
  movePlayer, waitPlayerMove, playerSpeed, nullScript, setActorScript, waitActorScript, followPlayer,
  writeBehaviorCell, beginCutscene, respawnActors, setNpcScripts, fadeIn, waitFadeEnd, clearFrameTasks,
  registerFrameTask, returnHereAfter, farcallGen, hook, scene, wActors, ACTORF_X, ACTORF_Y,
} from "./common.js";
import { readSceneTilemapTile } from "./twins.js";
import { replacePartnerWithStandInActor, setPlayerAndPartnerObjectDefs, walkActorsInFromEntryPoint } from "./actor_0f.js";
import {
  islandOpenRoundCallCutscene, islandOpenSinglesMatchReturn, islandOpenDoublesMatchReturn, getIslandOpenRoundParams,
} from "./island_rounds_0f.js";
import { showRankingBoard } from "../menus/ranking/board.js";

const BANK = 0x0F;
// the site's actors (TournamentActors_0f) and the rounds' lists
const ACTOR_TOURNAMENT_ELDEN = 0x0B;
const ACTOR_ISLAND_OPEN_ROUND_WALK_74_08 = 0x03, ACTOR_ISLAND_OPEN_ROUND_WALK_74_06 = 0x04;
const ACTOR_ISLAND_OPEN_ROUND_WALK_74_07 = 0x05;
const ACTOR_ISLAND_OPEN_ROUND_SINGLES_WALK_74_08 = 0x03, ACTOR_ISLAND_OPEN_ROUND_SINGLES_WALK_74_06 = 0x04;
const ACTOR_ISLAND_OPEN_ROUND_DOUBLES_WALK_74_08 = 0x03, ACTOR_ISLAND_OPEN_ROUND_DOUBLES_WALK_74_06 = 0x04;
const ACTOR_ISLAND_OPEN_ROUND1_DOUBLES_SAMMI = 0x0A, ACTOR_ISLAND_OPEN_ROUND1_DOUBLES_SEAN = 0x0B;
const ACTOR_ISLAND_OPEN_ROUND1_DOUBLES_B_COZ = 0x0D, ACTOR_ISLAND_OPEN_SEMIFINAL_DOUBLES_SAMMI = 0x08;
const ACTOR_ISLAND_OPEN_SEMIFINAL_DOUBLES_B_COZ = 0x0D, ACTOR_ISLAND_OPEN_FINAL_DOUBLES_B_COZ = 0x0B;
const ACTOR_ISLAND_OPEN_FINAL_DOUBLES_SAMMI = 0x0C;
const ISLANDOPENROUND_ROUND1 = 0x00, ISLANDOPENROUND_ROUND2 = 0x01, ISLANDOPENROUND_SEMIFINAL = 0x02;
const ISLANDOPENROUND_FINAL = 0x03;
const FLAG_WON_ISLAND_OPEN_DOUBLES_SEMIFINAL = 0x36, FLAG_WON_ISLAND_OPEN_DOUBLES_ROUND_1 = 0x37;
const FLAG_WON_ISLAND_OPEN_SINGLES_SEMIFINAL = 0x3D, FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_2 = 0x3E;
const FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_1 = 0x3F, FLAG_AWARDS_CEREMONY_SEEN_SINGLES = 0x83;
const FLAG_AWARDS_CEREMONY_SEEN_DOUBLES = 0x84, FLAG_REACHED_ISLAND_OPEN_SINGLES = 0xAE;
const FLAG_REACHED_ISLAND_OPEN_DOUBLES = 0xAF, FLAG_ISLAND_OPEN_IN_PROGRESS = 0xB9;
const Text_1f_21 = 0x2415, Text_1f_163 = 0x24A3, Text_25_30 = 0x281E, Text_25_33 = 0x2821, Text_25_37 = 0x2825;
const Text_25_44 = 0x282C, Text_25_51 = 0x2833, Text_25_61 = 0x283D, Text_25_64 = 0x2840;
// data of this bank (read from the ROM)
const ActorScript_0f_01 = 0x61E0, ActorScript_0f_02 = 0x61EB;
const IslandOpenRoundActors_0f = 0x65C2, IslandOpenRoundNpcScripts_0f = 0x65F6;
const IslandOpenRound2Actors_0f = 0x6714, IslandOpenRound2NpcScripts_0f = 0x67E2;
const IslandOpenSemifinalActors_0f = 0x684B, IslandOpenSemifinalNpcScripts_0f = 0x6919;
const IslandOpenFinalActors_0f = 0x6982, IslandOpenFinalNpcScripts_0f = 0x6A50;
const IslandOpenRound1ActorsDoubles_0f = 0x6AB9, IslandOpenRound1NpcScriptsDoubles_0f = 0x6B79;
const IslandOpenSemifinalActorsDoubles_0f = 0x6C46, IslandOpenSemifinalNpcScriptsDoubles_0f = 0x6D06;
const IslandOpenFinalActorsDoubles_0f = 0x6DAF, IslandOpenFinalNpcScriptsDoubles_0f = 0x6E6F;
const IslandOpenRoundActorsSingles_0f = 0x75B7, IslandOpenRoundNpcScriptsSingles_0f = 0x7615;
const IslandOpenRoundActorsDoubles_0f = 0x7842, IslandOpenRoundNpcScriptsDoubles_0f = 0x78A0;
export const UpdateTournamentActorDrawModes_0f = 0x6310;
const BANK_RANKING = 0x1B, RANKING_BOARD_ISLAND_OPEN = 0x03;
const SaveStorySlotWithTimer = 0x4D10;
const ACTORF_MODE = 0x20, ACTOR_MODE_DRAWN = 0x02;
const TILE_FOREGROUND = 0x05;                          // the site's foreground tiles' attribute low bits

// CheckAwardsCeremonyRivalSceneDone (0F:5F7A): a = 1 once the ceremony of the format played was seen (its
// FLAG_AWARDS_CEREMONY_SEEN_*), else 0. F: that flag test's.
export function checkAwardsCeremonyRivalSceneDone(P) {
  const seen = testFlag(P, testFlag(P, FLAG_DOUBLES) ? FLAG_AWARDS_CEREMONY_SEEN_DOUBLES : FLAG_AWARDS_CEREMONY_SEEN_SINGLES);
  return { a: seen ? 1 : 0, f: testFlagF(seen) };
}
// TournamentExit_0f (0F:60DA): leaving the site ends the tournament in progress
export function tournamentExit(P) { clearFlag(P, FLAG_ISLAND_OPEN_IN_PROGRESS); }
// TournamentNpc0A_0f (0F:60DE): Elden's question (no: the other answer)
export const tournamentNpc0A = P => question(P, Text_1f_163, ACTOR_TOURNAMENT_ELDEN);
// TournamentFacing01_0f (0F:6174): the bracket board: the scroll, camera and frame tasks reset, the Island Open's
// ranking board (by the round's parameters), and back to this place
export function* tournamentFacing01(P) {
  const { V } = P;
  V.bGColumnBlitPending = 0;
  V.bGRowBlitPending = 0;
  V.scrollY = 0;
  V.scrollX = 0;
  P.bus.w8(P.A.cameraX + 1, 0);
  P.bus.w8(P.A.cameraY + 1, 0);
  clearFrameTasks(P);
  const r = getIslandOpenRoundParams(P);
  yield* farcallGen(P, BANK_RANKING, showRankingBoard(P, r.b, r.c, RANKING_BOARD_ISLAND_OPEN));
  returnHereAfter(P);
}
// TournamentTile0E_0f (0F:61B7) / TournamentTile0F_0f (0F:61F6): the call cells: in doubles both walk to the
// round's spot (wMapSceneStage2 = 1), in singles the player (0); then the round is called
export function* tournamentTile0E(P) {
  P.V.mapSceneStage2 = 1;
  nullScript(P, ACTOR_PARTNER);
  setActorScript(P, ACTOR_PLAYER, ActorScript_0f_01);
  setActorScript(P, ACTOR_PARTNER, ActorScript_0f_02);
  yield* waitActorScript(P, ACTOR_PLAYER);
  yield* islandOpenRoundCallCutscene(P);
}
export function* tournamentTile0F(P) {
  P.V.mapSceneStage2 = 0;
  setActorScript(P, ACTOR_PLAYER, ActorScript_0f_02);
  yield* waitActorScript(P, ACTOR_PLAYER);
  yield* islandOpenRoundCallCutscene(P);
}

// TournamentInitScript_0f (0F:620F): the foreground frame task; arriving by an entry point ends any round in
// progress. In a round (FLAG_ISLAND_OPEN_IN_PROGRESS: back with no entry point) the round's lists (the first with
// the officials placed; later rounds by format); otherwise by the entry: $0F the arrival, $0A / $0B back from a
// singles / doubles match, else the lists of the rounds reached and the arrival walk.
export function* tournamentInitScript(P) {
  const { V } = P;
  registerFrameTask(P, 1, UpdateTournamentActorDrawModes_0f);
  if (V.storyModeEntryPoint !== STORYENTRY_NONE) clearFlag(P, FLAG_ISLAND_OPEN_IN_PROGRESS);
  if (testFlag(P, FLAG_ISLAND_OPEN_IN_PROGRESS)) {                    // .inProgress
    computeIslandOpenRound(P);
    if (!V.mapSceneStage) {
      respawnActors(P, IslandOpenRoundActors_0f);
      setNpcScripts(P, IslandOpenRoundNpcScripts_0f);
      beginCutscene(P);
      setPosition(P, ACTOR_ISLAND_OPEN_ROUND_WALK_74_08, 28.0, 28.0);
      setPosition(P, ACTOR_ISLAND_OPEN_ROUND_WALK_74_06, 28.0, 31.0);
      setPosition(P, ACTOR_ISLAND_OPEN_ROUND_WALK_74_07, 29.0, 33.0);
      face(P, ACTOR_ISLAND_OPEN_ROUND_WALK_74_08, FACE_DOWN);
      face(P, ACTOR_ISLAND_OPEN_ROUND_WALK_74_06, FACE_DOWN);
      face(P, ACTOR_ISLAND_OPEN_ROUND_WALK_74_07, FACE_LEFT);
      if (testFlag(P, FLAG_DOUBLES)) setPosition(P, ACTOR_ISLAND_OPEN_ROUND_WALK_74_07, 63.0, 63.0);
      setPlayerAndPartnerObjectDefs(P);                               // .setObjectDefs
      return;
    }
    if (!testFlag(P, FLAG_DOUBLES)) {                                 // .singles
      respawnActors(P, IslandOpenRoundActorsSingles_0f);
      setNpcScripts(P, IslandOpenRoundNpcScriptsSingles_0f);
      beginCutscene(P);
      setPlayerAndPartnerObjectDefs(P);
      face(P, ACTOR_ISLAND_OPEN_ROUND_SINGLES_WALK_74_08, FACE_RIGHT);
      setPosition(P, ACTOR_ISLAND_OPEN_ROUND_SINGLES_WALK_74_06, 39.0, 19.0);
      face(P, ACTOR_ISLAND_OPEN_ROUND_SINGLES_WALK_74_06, FACE_LEFT);
      return;
    }
    respawnActors(P, IslandOpenRoundActorsDoubles_0f);                // .doubles
    setNpcScripts(P, IslandOpenRoundNpcScriptsDoubles_0f);
    beginCutscene(P);
    setPlayerAndPartnerObjectDefs(P);
    faceToward(P, ACTOR_PLAYER, ACTOR_ISLAND_OPEN_ROUND_DOUBLES_WALK_74_06);
    face(P, ACTOR_ISLAND_OPEN_ROUND_DOUBLES_WALK_74_08, FACE_RIGHT);
    return;
  }
  switch (V.storyModeEntryPoint) {                                    // .notInProgress
    case 0x0F: return yield* islandOpenArrivalCutscene(P);
    case 0x0A: return yield* islandOpenSinglesMatchReturn(P);
    case 0x0B: return yield* islandOpenDoublesMatchReturn(P);
  }
  loadIslandOpenRoundNpcs(P);                                         // .done
  setPlayerAndPartnerObjectDefs(P);
  yield* walkActorsInFromEntryPoint(P);
}

// UpdateTournamentActorDrawModes_0f (0F:6310), a frame task: the player, and in doubles the partner, drawn or
// hidden by the scene tiles where they stand
export function updateTournamentActorDrawModes(P) {
  setActorDrawModeFromSceneTile(P, 0);
  if (testFlag(P, FLAG_DOUBLES)) setActorDrawModeFromSceneTile(P, 2);
}
// SetActorDrawModeFromSceneTile_0f (0F:631F): actor slot a over the scene tilemap (read from the actor's own record
// address) at column (x - 0.3125 tiles), row (y + 0.25 tiles) - 1 (3 up for any slot but 0): on a foreground tile
// (attribute low bits 5; above: bit 7 clear too) its drawn mode flips, else it is drawn (mode 2). Returns a, bc, de,
// hl as the ROM leaves them.
export function setActorDrawModeFromSceneTile(P, slot, rowsUp = slot ? 3 : 1) {
  const { bus } = P;
  P.wramBank(WRAM_ACTORS);
  const actor = (wActors + (((slot & 0xFF) << 6) & 0xFFFF)) & 0xFFFF;
  const col = ((bus.u16(actor + ACTORF_X) + 0xFFB0) & 0xFFFF) >> 8;
  const row = (((bus.u16(actor + ACTORF_Y) + 0x40) >> 8) - rowsUp) & 0xFF;
  let r = readSceneTilemapTile(P, actor, col, row), de = (col << 8 | row) & 0xFFFF;
  if ((r.a & 0x87) !== TILE_FOREGROUND) {                             // .checkBelow
    r = readSceneTilemapTile(P, actor, (col + 1) & 0xFF, row);
    de = r.de;
    if ((r.a & 0x07) !== TILE_FOREGROUND) {                           // .actorLoop
      P.wramBank(WRAM_ACTORS);
      bus.w8(actor + ACTORF_MODE, ACTOR_MODE_DRAWN);
      return { a: ACTOR_MODE_DRAWN, bc: actor, de, hl: actor + ACTORF_MODE };
    }
  }
  P.wramBank(WRAM_ACTORS);
  const mode = bus.u8(actor + ACTORF_MODE) ^ 0x01;
  bus.w8(actor + ACTORF_MODE, mode);
  return { a: mode, bc: actor, de, hl: actor + ACTORF_MODE };
}
// UnusedSetActorDrawModeFromSceneTileSingle_0f (0F:6396): the same with the row always 3 up. Nothing calls it.
export const unusedSetActorDrawModeFromSceneTileSingle = (P, slot) => setActorDrawModeFromSceneTile(P, slot, 3);
// ReadSceneTilemapTile_0f (0F:6408): twins.js (hl, de, a returned; bc kept)
export const readSceneTilemapTile0f = (P, bc, d, e) => readSceneTilemapTile(P, bc, d, e);

// IslandOpenArrivalCutscene (0F:6426): first arrival at the Island Open (the round in progress from now on): the
// officials and the friends (the partner shown by its stand-in) welcome the player; the Island Open reached is
// flagged (in doubles the stand-in then follows the player), round 1, the story saved.
export function* islandOpenArrivalCutscene(P) {
  const FRIEND = ACTOR_ISLAND_OPEN_ROUND_WALK_74_08, OFFICIAL = ACTOR_ISLAND_OPEN_ROUND_WALK_74_06;
  const STAND_IN = ACTOR_ISLAND_OPEN_ROUND_WALK_74_07;
  setFlag(P, FLAG_ISLAND_OPEN_IN_PROGRESS);
  respawnActors(P, IslandOpenRoundActors_0f);
  setNpcScripts(P, IslandOpenRoundNpcScripts_0f);
  beginCutscene(P);
  replacePartnerWithStandInActor(P);
  playerSpeed(P, 7.96875);
  yield* movePlayer(P, 28.0, 37.0);
  yield* waitPlayerMove(P);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  playerSpeed(P, 0.75);
  yield* movePlayer(P, 28.0, 27.0);
  moveTarget(P, FRIEND, 28.0, 28.0);
  moveTarget(P, OFFICIAL, 28.0, 31.0);
  moveTarget(P, STAND_IN, 29.0, 33.0);
  moveTarget(P, ACTOR_PLAYER, 27.0, 33.0);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* wait(P, 40);
  face(P, FRIEND, FACE_DOWN);
  yield* setText(P, Text_1f_21);
  for (const facing of [FACE_DOWN, FACE_LEFT, FACE_UP, FACE_RIGHT, FACE_DOWN]) {   // the player looks around
    face(P, ACTOR_PLAYER, facing);
    yield* wait(P, 40);
  }
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_PLAYER);
  face(P, OFFICIAL, FACE_RIGHT);
  face(P, OFFICIAL, FACE_DOWN);
  face(P, STAND_IN, FACE_LEFT);
  yield* wait(P, 20);
  setAnim(P, OFFICIAL, ANIM_SHAKE);
  yield* waitIdle(P, OFFICIAL);
  yield* speak(P, OFFICIAL);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* wait(P, 40);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  setAnim(P, FRIEND, ANIM_BOUNCE);
  yield* waitIdle(P, FRIEND);
  yield* speak(P, FRIEND);
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_PLAYER);
  if (!testFlag(P, FLAG_DOUBLES)) {
    setAnim(P, STAND_IN, ANIM_NOD);
    yield* waitIdle(P, STAND_IN);
    yield* speak(P, STAND_IN);
    setFlag(P, FLAG_REACHED_ISLAND_OPEN_SINGLES);
  } else {                                                            // .doubles
    advanceText(P);
    setAnim(P, OFFICIAL, ANIM_NOD);
    yield* waitIdle(P, OFFICIAL);
    yield* speak(P, OFFICIAL);
    followPlayer(P, STAND_IN);
    setFlag(P, FLAG_REACHED_ISLAND_OPEN_DOUBLES);
  }
  playerSpeed(P, 0.75);                                               // .walkOn
  yield* movePlayer(P, 28.0, 29.0);
  yield* waitPlayerMove(P);
  P.V.mapSceneStage = ISLANDOPENROUND_ROUND1;
  yield* P.runRom(BANK_SAVE, SaveStorySlotWithTimer);
}

// ComputeIslandOpenRound (0F:660F): wMapSceneStage = the round to play (ISLANDOPENROUND_*) from the rounds won
// (doubles has no second round). Returns a and F of the last flag test.
export function computeIslandOpenRound(P) {
  const doubles = testFlag(P, FLAG_DOUBLES);
  const steps = doubles
    ? [[FLAG_WON_ISLAND_OPEN_DOUBLES_SEMIFINAL, ISLANDOPENROUND_FINAL], [FLAG_WON_ISLAND_OPEN_DOUBLES_ROUND_1, ISLANDOPENROUND_SEMIFINAL]]
    : [[FLAG_WON_ISLAND_OPEN_SINGLES_SEMIFINAL, ISLANDOPENROUND_FINAL], [FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_2, ISLANDOPENROUND_SEMIFINAL],
      [FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_1, ISLANDOPENROUND_ROUND2]];
  let round = ISLANDOPENROUND_ROUND1, set = false;
  for (const [flag, r] of steps) if ((set = testFlag(P, flag))) { round = r; break; }
  P.V.mapSceneStage = round;
  return { a: round, f: testFlagF(set) };
}
// LoadIslandOpenRoundNpcs (0F:6651): the site between rounds: round 1, the call cell (trigger 15 at (14, 20)),
// and the lists of the latest round reached (singles: round 2, semi-final, final)
export function loadIslandOpenRoundNpcs(P) {
  P.V.mapSceneStage = ISLANDOPENROUND_ROUND1;
  if (testFlag(P, FLAG_DOUBLES)) return loadIslandOpenRoundNpcsDoubles(P);
  writeBehaviorCell(P, 14, 20, BEHAVIOR_TRIGGER | 15 << 4);
  if (testFlag(P, FLAG_WON_ISLAND_OPEN_SINGLES_SEMIFINAL))
    return roundLists(P, IslandOpenFinalActors_0f, IslandOpenFinalNpcScripts_0f, ISLANDOPENROUND_FINAL);
  if (testFlag(P, FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_2))             // .round2
    return roundLists(P, IslandOpenSemifinalActors_0f, IslandOpenSemifinalNpcScripts_0f, ISLANDOPENROUND_SEMIFINAL);
  if (testFlag(P, FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_1))             // .round1
    roundLists(P, IslandOpenRound2Actors_0f, IslandOpenRound2NpcScripts_0f, ISLANDOPENROUND_ROUND2);
}
// LoadIslandOpenRoundNpcsDoubles (0F:66B8): the same in doubles: the two call cells (trigger 14 at (14, 20) and
// (16, 20)) and round 1's, the semi-final's or the final's lists
export function loadIslandOpenRoundNpcsDoubles(P) {
  writeBehaviorCell(P, 14, 20, BEHAVIOR_TRIGGER | 14 << 4);
  writeBehaviorCell(P, 16, 20, BEHAVIOR_TRIGGER | 14 << 4);
  if (testFlag(P, FLAG_WON_ISLAND_OPEN_DOUBLES_SEMIFINAL))
    return roundLists(P, IslandOpenFinalActorsDoubles_0f, IslandOpenFinalNpcScriptsDoubles_0f, ISLANDOPENROUND_FINAL);
  if (testFlag(P, FLAG_WON_ISLAND_OPEN_DOUBLES_ROUND_1))             // .round2
    return roundLists(P, IslandOpenSemifinalActorsDoubles_0f, IslandOpenSemifinalNpcScriptsDoubles_0f, ISLANDOPENROUND_SEMIFINAL);
  roundLists(P, IslandOpenRound1ActorsDoubles_0f, IslandOpenRound1NpcScriptsDoubles_0f, null);   // .round1
}
// a round's actor list respawned and its NPC records installed; wMapSceneStage = the round (unless null)
function roundLists(P, actors, npcScripts, round) {
  respawnActors(P, actors);
  setNpcScripts(P, npcScripts);
  if (round !== null) P.V.mapSceneStage = round;
}

// the rounds' NPC questions (no: the other answer)
// IslandOpenRound1DoublesNpc0A_0f (0F:6BDA) / Npc0B (0F:6BFE) / Npc0D (0F:6C22),
// IslandOpenSemifinalDoublesNpc08_0f (0F:6D67) / Npc0D (0F:6D8B),
// IslandOpenFinalDoublesNpc0C_0f (0F:6ED0) / Npc0B (0F:6EF4)
export const islandOpenRound1DoublesNpc0A = P => question(P, Text_25_30, ACTOR_ISLAND_OPEN_ROUND1_DOUBLES_SAMMI);
export const islandOpenRound1DoublesNpc0B = P => question(P, Text_25_33, ACTOR_ISLAND_OPEN_ROUND1_DOUBLES_SEAN);
export const islandOpenRound1DoublesNpc0D = P => question(P, Text_25_37, ACTOR_ISLAND_OPEN_ROUND1_DOUBLES_B_COZ);
export const islandOpenSemifinalDoublesNpc08 = P => question(P, Text_25_44, ACTOR_ISLAND_OPEN_SEMIFINAL_DOUBLES_SAMMI);
export const islandOpenSemifinalDoublesNpc0D = P => question(P, Text_25_51, ACTOR_ISLAND_OPEN_SEMIFINAL_DOUBLES_B_COZ);
export const islandOpenFinalDoublesNpc0C = P => question(P, Text_25_64, ACTOR_ISLAND_OPEN_FINAL_DOUBLES_SAMMI);
export const islandOpenFinalDoublesNpc0B = P => question(P, Text_25_61, ACTOR_ISLAND_OPEN_FINAL_DOUBLES_B_COZ);

export const HOOKS = [
  [BANK, 0x5F7A, hook(P => checkAwardsCeremonyRivalSceneDone(P))],
  [BANK, 0x60DA, hook(P => { tournamentExit(P); })],
  scene(BANK, 0x60DE, tournamentNpc0A),
  scene(BANK, 0x6174, tournamentFacing01),
  scene(BANK, 0x61B7, tournamentTile0E),
  scene(BANK, 0x61F6, tournamentTile0F),
  scene(BANK, 0x620F, tournamentInitScript),
  [BANK, 0x6310, hook(P => { updateTournamentActorDrawModes(P); })],
  [BANK, 0x631F, hook((P, c) => setActorDrawModeFromSceneTile(P, c.a))],
  [BANK, 0x6396, hook((P, c) => unusedSetActorDrawModeFromSceneTileSingle(P, c.a))],
  [BANK, 0x6408, hook((P, c) => readSceneTilemapTile0f(P, c.bc, c.d, c.e))],
  scene(BANK, 0x6426, islandOpenArrivalCutscene),
  [BANK, 0x660F, hook(P => computeIslandOpenRound(P))],
  [BANK, 0x6651, hook(P => { loadIslandOpenRoundNpcs(P); })],
  [BANK, 0x66B8, hook(P => { loadIslandOpenRoundNpcsDoubles(P); })],
  scene(BANK, 0x6BDA, islandOpenRound1DoublesNpc0A),
  scene(BANK, 0x6BFE, islandOpenRound1DoublesNpc0B),
  scene(BANK, 0x6C22, islandOpenRound1DoublesNpc0D),
  scene(BANK, 0x6D67, islandOpenSemifinalDoublesNpc08),
  scene(BANK, 0x6D8B, islandOpenSemifinalDoublesNpc0D),
  scene(BANK, 0x6ED0, islandOpenFinalDoublesNpc0C),
  scene(BANK, 0x6EF4, islandOpenFinalDoublesNpc0B),
];
