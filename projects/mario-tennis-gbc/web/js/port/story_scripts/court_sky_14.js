// Court 1 and the island sky (bank $14, $4FAC-$5427). Court 1 (the Island Open's first court): the NPCs' lines
// (by the tournament stage for two of them), the init script choosing the stage (the final's actors) and the walk
// in. The island sky: the plane's flight to the island (the plane sprite placed by wMapSceneStage/Stage2, its
// sound every other step), the landing with the water splashes and the students walking off, then on to the
// tournament courtyard or the dorm; its other entries are the firework, sky-effect and plane scenes
// (firework_14, island_14 and plane_14.asm). The location tables and ActorScript data are data.
// Port of src/story/court_sky_14.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are; LoadCourtPlayerPartnerObjDefs_14 is src/twins/
// load_court_player_partner_obj_defs.asm (twins.js).
// Recordings: out/port/ss1_court1*.mtrec, out/port/ss1_sky*.mtrec (scripted: Court 1, the flight).
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FACE_DOWN, FACE_LEFT, FACE_RIGHT, FACE_UP, ANIM_BOUNCE, FLAG_DOUBLES,
  testFlag, setFlag, setText, speak, setPosition, setActive, face, moveTarget, waitMove, movePlayerToActor,
  playerSpeed, nullScript, setActorScript, gesture, wait, wr, fadeInAndWait, fadeOutAndWait, waitFadeEnd, sound,
  disableLCDSafely, enableLCD, clearFrameTasks, registerFrameTask, respawnActors, beginCutscene, goToLocation,
  requestExit, hook, scene,
} from "./common.js";
import { arrivalWalk, loadCourtPlayerPartnerObjDefs, loadObjdef, OBJ_ALEX_B, OBJ_HARRY_B } from "./twins.js";
import { islandSkyFireworkScene, islandSkyEntry0fAnd0dScene } from "./firework_14.js";
import { islandSkyEntry0eScene, playPlaneMoveSfx } from "./island_14.js";

const BANK = 0x14;
const ACTOR_COURT1_WALK_6F_07_1 = 0x03, ACTOR_COURT1_WALK_6F_07_2 = 0x04, ACTOR_COURT1_WALK_72_02_1 = 0x05;
const ACTOR_COURT1_WALK_71_05 = 0x06;
const ACTOR_ISLAND_SKY_WALK_75_06 = 0x03, ACTOR_ISLAND_SKY_WALK_74_08 = 0x04, ACTOR_ISLAND_SKY_WALK_74_07 = 0x05;
const ACTOR_ISLAND_SKY_WALK_74_06 = 0x06;
const SKY_STUDENTS = [ACTOR_ISLAND_SKY_WALK_75_06, ACTOR_ISLAND_SKY_WALK_74_08, ACTOR_ISLAND_SKY_WALK_74_07, ACTOR_ISLAND_SKY_WALK_74_06];
const FLAG_WON_ISLAND_OPEN_DOUBLES_SEMIFINAL = 0x36, FLAG_WON_ISLAND_OPEN_DOUBLES_ROUND_1 = 0x37;
const FLAG_WON_ISLAND_OPEN_SINGLES_SEMIFINAL = 0x3D, FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_2 = 0x3E;
const FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_1 = 0x3F, FLAG_ISLAND_SKY_SCENE_ACTIVE = 0x4F;
const FLAG_REACHED_ISLAND_OPEN_SINGLES = 0xAE, FLAG_REACHED_ISLAND_OPEN_DOUBLES = 0xAF;
const ISLANDOPENSTAGE_SINGLES_ROUND1 = 0x00, ISLANDOPENSTAGE_SINGLES_ROUND2 = 0x01;
const ISLANDOPENSTAGE_SINGLES_SEMIFINAL = 0x02, ISLANDOPENSTAGE_SINGLES_FINAL = 0x03;
const ISLANDOPENSTAGE_DOUBLES_ROUND1 = 0x04, ISLANDOPENSTAGE_DOUBLES_SEMIFINAL = 0x05;
const ISLANDOPENSTAGE_DOUBLES_FINAL = 0x06;
const SFX_FIREWORK_LAUNCH = 0x7A, SFX_PLANE = 0x7B, SFX_FIREWORK_SPARKLE = 0x7D;
const STORYLOC_DORM_ROOM = 0x0A, STORYLOC_TOURNAMENT_COURTYARD = 0x15;
const Text_1f_132 = 0x2484, Text_1f_133 = 0x2485;
// data and the routines of plane_14.asm (not ported here)
const Court1Npc05TextIds = 0x5093, Court1Npc06TextIds = 0x50B8, Court1ActorsAlt_14 = 0x5162;
const ActorScript_14_1 = 0x563B;
const LoadPlaneObjGfx_14 = 0x5E79, QueuePlaneSpriteByHeight_14 = 0x5E9C, LoadWaterSplashObjGfx_14 = 0x60A1;
const UpdateWaterSplash0_14 = 0x60C4, UpdateWaterSplash1_14 = 0x617E, IslandSkyEntry02Scene = 0x628B;
const ENTRY_RETURN_FLIGHT = 0x0C;                       // the flight seen again (from the pause menu's records)

const tableWord = (P, table, i) => P.rom.u16(BANK, (table + ((i * 2) & 0xFF)) & 0xFFFF);

// ---- Court 1 ----
// Court1Npc03_14 (14:5064) / Court1Npc04_14 (14:5070)
function* line(P, text, actor) {
  yield* setText(P, text);
  yield* speak(P, actor);
}
export const court1Npc03 = P => line(P, Text_1f_132, ACTOR_COURT1_WALK_6F_07_1);
export const court1Npc04 = P => line(P, Text_1f_133, ACTOR_COURT1_WALK_6F_07_2);
// Court1Npc05_14 (14:507C) / Court1Npc06_14 (14:50A1): a line by the stage
export const court1Npc05 = P => line(P, tableWord(P, Court1Npc05TextIds, P.V.mapSceneStage), ACTOR_COURT1_WALK_72_02_1);
export const court1Npc06 = P => line(P, tableWord(P, Court1Npc06TextIds, P.V.mapSceneStage), ACTOR_COURT1_WALK_71_05);

// Court1InitScript_14 (14:50FB): the stage, the player's and partner's object defs, the walk in
export function* court1InitScript(P) {
  initCourt1SceneVariant(P);
  loadCourtPlayerPartnerObjDefs(P);
  yield* court1EntryWalkIn(P);
}
// InitCourt1SceneVariant (14:5105): wMapSceneStage from the rounds won; at the final the court's other actors
// (Court1ActorsAlt_14) and the cutscene mode on
export function initCourt1SceneVariant(P) {
  const { V } = P;
  V.mapSceneStage = ISLANDOPENSTAGE_SINGLES_ROUND1;
  const final = stage => {
    V.mapSceneStage = stage;
    respawnActors(P, Court1ActorsAlt_14);
    beginCutscene(P);
  };
  if (testFlag(P, FLAG_DOUBLES)) {                      // .doubles
    if (testFlag(P, FLAG_WON_ISLAND_OPEN_DOUBLES_SEMIFINAL)) final(ISLANDOPENSTAGE_DOUBLES_FINAL);
    else if (testFlag(P, FLAG_WON_ISLAND_OPEN_DOUBLES_ROUND_1)) V.mapSceneStage = ISLANDOPENSTAGE_DOUBLES_SEMIFINAL;
    else V.mapSceneStage = ISLANDOPENSTAGE_DOUBLES_ROUND1;
  } else if (testFlag(P, FLAG_WON_ISLAND_OPEN_SINGLES_SEMIFINAL)) final(ISLANDOPENSTAGE_SINGLES_FINAL);
  else if (testFlag(P, FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_2)) V.mapSceneStage = ISLANDOPENSTAGE_SINGLES_SEMIFINAL;
  else if (testFlag(P, FLAG_WON_ISLAND_OPEN_SINGLES_ROUND_1)) V.mapSceneStage = ISLANDOPENSTAGE_SINGLES_ROUND2;
}
// Court1EntryWalkIn (14:51A4): the arrival walk to the right (the code of the twins' arrival walks, written out
// once more in this bank): in doubles the partner steps out left and turns back; the player walks 2 tiles right
export const court1EntryWalkIn = P => arrivalWalk(P, FACE_LEFT, FACE_RIGHT, FACE_RIGHT);

// ---- the island sky ----
const stage = P => P.V.mapSceneStage, stage2 = P => P.V.mapSceneStage2;
const setStage = (P, v) => { P.V.mapSceneStage = v & 0xFF; };
const setStage2 = (P, v) => { P.V.mapSceneStage2 = v & 0xFF; };
// a run of the flight's steps: for h = n down to 1, `frames` frames, the plane's sound (PlayPlaneMoveSfx_14, by
// h), then step(h)
function* flightSteps(P, n, frames, step, sfx = true) {
  for (let h = n; h > 0; h--) {
    yield* wait(P, frames);
    if (sfx) playPlaneMoveSfx(P, h);
    step(h);
  }
}
const climb = P => setStage2(P, stage2(P) + 1);

// IslandSkyInitScript_14 (14:52B7): the students out of sight; by the entry point the plane's arrival
// (IslandSkyEntry02Scene, plane_14.asm), the fireworks (entry 8), the sky effects (entry $0E), the departure
// (entries $0D and $0F), or the flight to the island (.loadScene; entry $0C: its last part, seen again)
export function* islandSkyInitScript(P) {
  for (const actor of SKY_STUDENTS) setPosition(P, actor, 63.0, 63.0);
  switch (P.V.storyModeEntryPoint) {
    case 0x02: return yield* P.runRom(BANK, IslandSkyEntry02Scene);
    case 0x08: return yield* islandSkyFireworkScene(P);
    case 0x0E: return yield* islandSkyEntry0eScene(P);
    case 0x0F: case 0x0D: return yield* islandSkyEntry0fAnd0dScene(P);
    default: return yield* islandSkyFlight(P);
  }
}
// IslandSkyInitScript_14.loadScene (14:5303): the flight
function* islandSkyFlight(P) {
  const { V } = P;
  const replay = () => V.storyModeEntryPoint === ENTRY_RETURN_FLIGHT;
  setFlag(P, FLAG_ISLAND_SKY_SCENE_ACTIVE);
  disableLCDSafely(P);
  P.callRom(BANK, LoadPlaneObjGfx_14);
  P.callRom(BANK, LoadWaterSplashObjGfx_14);
  enableLCD(P);
  setStage(P, 0x50);
  setStage2(P, 0x88);
  registerFrameTask(P, 0x01, QueuePlaneSpriteByHeight_14);
  if (testFlag(P, FLAG_DOUBLES)) {                      // the partner's sprite on the student walking off with him
    nullScript(P, ACTOR_PARTNER);
    setPosition(P, ACTOR_PARTNER, 63.0, 63.0);
    loadObjdef(P, ACTOR_ISLAND_SKY_WALK_74_07, (V.storyModeGenderOfPartnerCharacter + OBJ_HARRY_B) & 0xFF);
  }
  loadObjdef(P, ACTOR_PLAYER, (V.storyModeGenderOfMainCharacter + OBJ_ALEX_B) & 0xFF);   // .setPlayerObjDef
  setActive(P, ACTOR_PLAYER, 0x00);
  if (replay()) {
    setPosition(P, ACTOR_PLAYER, 6.0, 39.0);
    V.storyModeShowLocationName = 0;
    yield* fadeInAndWait(P, 4);
    setStage(P, 0x3B);
    setStage2(P, 0xA8);
  } else {
    V.storyModeShowLocationName = 0;                    // .fadeIn
    yield* fadeInAndWait(P, 6);
    sound(P, SFX_FIREWORK_LAUNCH);
    yield* wait(P, 60);
    setPosition(P, ACTOR_PLAYER, 6.0, 39.0);
    yield* flightSteps(P, 8, 6, () => climb(P));                                        // .planeLoop
    yield* flightSteps(P, 8, 5, h => { if (h & 1) setStage(P, stage(P) - 1); climb(P); });  // .planeLoop2
    yield* flightSteps(P, 8, 4, () => { setStage(P, stage(P) - 1); climb(P); });        // .checkStage
    playerSpeed(P, 0.5625);
    yield* movePlayerToActor(P, ACTOR_PLAYER);
    yield* flightSteps(P, 0x1C, 3, h => { if (h & 1) setStage(P, stage(P) - 1); climb(P); });  // .descend
  }
  let h = 0;                                            // .afterFlight: down to height $20
  do {                                                  // .placeActors
    yield* wait(P, 3);
    h = (h + 1) & 0xFF;
    playPlaneMoveSfx(P, h);
    climb(P);
    if ((stage2(P) & 0x03) === 0x03) setStage(P, stage(P) - 1);
  } while (stage(P) !== 0x20);
  yield* flightSteps(P, 8, 4, () => climb(P));          // .walkOff
  sound(P, SFX_PLANE);
  yield* flightSteps(P, 8, 6, () => climb(P), false);   // .speak
  sound(P, SFX_FIREWORK_SPARKLE);
  yield* flightSteps(P, 4, 8, () => climb(P), false);   // .speakDoubles
  const reached = testFlag(P, FLAG_DOUBLES) ? FLAG_REACHED_ISLAND_OPEN_DOUBLES : FLAG_REACHED_ISLAND_OPEN_SINGLES;
  if (!replay() && testFlag(P, reached)) {              // .transition: on to the tournament courtyard
    yield* fadeOutAndWait(P, 4);
    clearFrameTasks(P);
    goToLocation(P, STORYLOC_TOURNAMENT_COURTYARD, 0x04);
    return;
  }
  yield* islandSkyLanding(P);
}
// IslandSkyInitScript_14.setLocation (14:54DF): the landing: the two water splashes, the students and the player
// off the plane; the replay leaves through exit 1, else to the dorm (entry 9)
function* islandSkyLanding(P) {
  const { V } = P;
  const splash = (i, x, y, task) => {
    wr(P, "cutsceneObjX", x, i);
    wr(P, "cutsceneObjY", y, i);
    wr(P, "cutsceneObjPhase", 0, i);
    wr(P, "cutsceneObjRiseTimer", 0x10, i);
    wr(P, "cutsceneObjActive", 0, i);
    registerFrameTask(P, 0x01, task);
  };
  splash(0, 0x40, 0x00, UpdateWaterSplash0_14);
  yield* wait(P, 10);
  splash(1, 0x50, 0x02, UpdateWaterSplash1_14);
  yield* wait(P, 80);
  for (const actor of SKY_STUDENTS) setPosition(P, actor, 6.0, 41.0);
  for (const [i, actor] of SKY_STUDENTS.entries()) {
    setActorScript(P, actor, ActorScript_14_1);
    yield* wait(P, i < SKY_STUDENTS.length - 1 ? 30 : 80);
  }
  setPosition(P, ACTOR_PLAYER, 6.0, 41.0);
  setActive(P, ACTOR_PLAYER, 0x02);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  yield* wait(P, 30);
  moveTarget(P, ACTOR_PLAYER, 11.0, 41.0);
  yield* waitMove(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* wait(P, 30);
  yield* gesture(P, ACTOR_PLAYER, ANIM_BOUNCE);
  if (V.storyModeEntryPoint === ENTRY_RETURN_FLIGHT) {
    wr(P, "cutsceneObjActive", 1, 0);
    wr(P, "cutsceneObjActive", 1, 1);
    requestExit(P, 0x01);
    return;
  }
  moveTarget(P, ACTOR_PLAYER, 11.0, 39.0);              // .done
  yield* waitMove(P, ACTOR_PLAYER);
  setActive(P, ACTOR_PLAYER, 0x00);
  yield* fadeOutAndWait(P, 4);
  yield* waitFadeEnd(P);
  clearFrameTasks(P);
  goToLocation(P, STORYLOC_DORM_ROOM, 0x09);
}

const nop = hook(() => {});
export const HOOKS = [
  scene(BANK, 0x5064, court1Npc03),
  scene(BANK, 0x5070, court1Npc04),
  scene(BANK, 0x507C, court1Npc05),
  scene(BANK, 0x50A1, court1Npc06),
  [BANK, 0x50F0, nop],                                                  // Court1Facing01_14
  [BANK, 0x50FA, nop],                                                  // Court1Tile01_14
  scene(BANK, 0x50FB, court1InitScript),
  [BANK, 0x5105, hook(P => { initCourt1SceneVariant(P); })],
  scene(BANK, 0x51A4, court1EntryWalkIn),
  [BANK, 0x51EA, hook(P => { loadCourtPlayerPartnerObjDefs(P); })],    // LoadCourtPlayerPartnerObjDefs_14
  [BANK, 0x52AB, nop],                                                  // Unused_14_StubNop
  scene(BANK, 0x52B7, islandSkyInitScript),
];
